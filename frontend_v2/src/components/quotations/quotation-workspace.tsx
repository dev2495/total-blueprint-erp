"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
    AlertTriangle,
    ArrowLeft,
    ArrowRight,
    ArrowUpRight,
    BadgeIndianRupee,
    Building2,
    CheckCircle2,
    ChevronRight,
    Clock,
    Copy,
    Download,
    Eye,
    FileText,
    GitBranch,
    Info,
    Loader2,
    Mail,
    MessageSquare,
    Package,
    Plus,
    Save,
    Search,
    Send,
    ShieldAlert,
    ShieldCheck,
    Sparkles,
    Trash2,
    Truck,
    Users,
    Wand2,
    XCircle,
} from "lucide-react"

import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import {
    quotationService,
    type CustomerSummary,
    type QuotationItem,
    type QuotationListItem,
} from "@/services/quotation"
import QuotationLineCard, { type DraftItem } from "@/components/quotations/quotation-line-card"

const STATUS_LABEL: Record<string, string> = {
    DRAFT: "Draft",
    SENT: "Sent",
    APPROVED: "Approved",
    REJECTED: "Rejected",
    EXPIRED: "Expired",
    CONVERTED: "Converted",
}

const STATUS_DOT: Record<string, string> = {
    DRAFT: "bg-slate-400",
    SENT: "bg-brand-blue",
    APPROVED: "bg-emerald-500",
    REJECTED: "bg-brand-red",
    EXPIRED: "bg-brand-orange",
    CONVERTED: "bg-brand-navy",
}

const PRESET_TERMS = [
    {
        id: "net45-exworks",
        label: "Net 45 EOM · Ex-works",
        body: "Payment: Net 45 days end of month.\nDelivery: Ex-works our plant.\nGST extra at applicable rate.",
    },
    {
        id: "net30-cif-mumbai",
        label: "Net 30 · CIF Mumbai",
        body: "Payment: Net 30 days.\nDelivery: CIF Mumbai.\nGST extra at applicable rate.",
    },
    {
        id: "advance-50",
        label: "50% Advance · Balance against PI",
        body: "50% advance with PO. Balance against pro-forma invoice before dispatch.\nDelivery: Ex-works.",
    },
]

interface QuotationWorkspaceProps {
    mode: "new" | "edit"
    quotationId?: string
}

function inrFmt(v: number | string | undefined | null): string {
    const n = Number(v ?? 0)
    if (!Number.isFinite(n)) return "—"
    return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n)
}

function makeLocalId(): string {
    return `draft-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`
}

function toDraftItems(items: QuotationItem[] | undefined): DraftItem[] {
    if (!items) return []
    return items.map((it, idx) => {
        const lineKind = (it.line_kind as DraftItem["line_kind"]) || "CATALOG"
        const spec = (it.spec_snapshot || {}) as DraftItem["spec_snapshot"]
        const costing = (it.costing_snapshot || {}) as Record<string, unknown>
        return {
            id: it.id,
            local_id: it.id || makeLocalId(),
            line_no: idx + 1,
            line_kind: lineKind,
            line_name: it.line_name || (lineKind === "AD_HOC" ? "Ad-hoc line" : "Catalog line"),
            qty: Number(it.qty_value || 0),
            uom: (it.qty_uom as DraftItem["uom"]) || "KG",
            rate: Number(it.quoted_unit_price || 0),
            margin_pct: Number((costing.margin_pct as number) ?? 0) || null,
            margin_lock: Boolean(it.margin_lock ?? true),
            spec_snapshot: spec,
            costing_snapshot: costing,
        }
    })
}

function toApiItems(drafts: DraftItem[]): QuotationItem[] {
    return drafts.map((d) => ({
        id: d.id,
        line_kind: d.line_kind,
        line_name: d.line_name,
        qty_value: d.qty,
        qty_uom: d.uom,
        price_basis: d.uom,
        quoted_unit_price: d.rate,
        quoted_line_total: Number((d.qty * d.rate).toFixed(4)),
        spec_snapshot: d.spec_snapshot,
        costing_snapshot: d.costing_snapshot,
        margin_lock: d.margin_lock,
    }))
}

export default function QuotationWorkspace({ mode, quotationId }: QuotationWorkspaceProps) {
    const queryClient = useQueryClient()
    const router = useRouter()
    const { toast } = useToast()
    const [drafts, setDrafts] = useState<DraftItem[]>([])
    const [openId, setOpenId] = useState<string | null>(null)
    const [lastSavedAt, setLastSavedAt] = useState<number | null>(null)
    const [savedTick, setSavedTick] = useState<number>(0) // re-render every 10s for "saved Xs ago"
    const [dirty, setDirty] = useState<boolean>(false)
    const [sendDialog, setSendDialog] = useState<null | "open">(null)
    const [rejectDialog, setRejectDialog] = useState<null | "open">(null)
    const [rejectReason, setRejectReason] = useState("")
    const [sendVia, setSendVia] = useState<"email" | "whatsapp" | "pdf_only">("pdf_only")
    const [convertDialog, setConvertDialog] = useState<null | "open">(null)
    const [approveDialog, setApproveDialog] = useState<null | "open">(null)
    const seededRef = useRef<string | null>(null)

    // Commercials local state (synced into payload on save)
    const [discountPct, setDiscountPct] = useState<number>(0)
    const [discountAmount, setDiscountAmount] = useState<number>(0)
    const [freightAmount, setFreightAmount] = useState<number>(0)
    const [freightIncluded, setFreightIncluded] = useState<boolean>(true)
    const [otherCharges, setOtherCharges] = useState<Array<{ label: string; amount: number }>>([])
    const [gstRate, setGstRate] = useState<number>(18)
    const [customTerms, setCustomTerms] = useState<string>("")
    const [termsTemplate, setTermsTemplate] = useState<string>("")

    const quoteQuery = useQuery({
        queryKey: ["quotation", quotationId],
        queryFn: () => (quotationId ? quotationService.get(quotationId) : Promise.resolve(null)),
        enabled: mode === "edit" && Boolean(quotationId),
    })

    const quote = quoteQuery.data as QuotationListItem | null

    // Seed local draft + commercials from server payload (once per refetch).
    useEffect(() => {
        if (!quote) return
        const key = `${quote.id}|${quote.updated_at}`
        if (seededRef.current === key) return
        seededRef.current = key
        const seeded = toDraftItems(quote.items)
        setDrafts(seeded)
        if (seeded.length > 0 && !openId) setOpenId(seeded[0].local_id)
        setDiscountPct(Number(quote.discount_pct || 0))
        setDiscountAmount(Number(quote.discount_amount || 0))
        setFreightAmount(Number(quote.freight_amount || 0))
        setFreightIncluded(quote.freight_included !== false)
        setOtherCharges(Array.isArray(quote.other_charges) ? quote.other_charges : [])
        setGstRate(Number(quote.gst_rate || 18))
        setCustomTerms(quote.custom_terms || "")
        setDirty(false)
    }, [quote?.id, quote?.updated_at]) // eslint-disable-line react-hooks/exhaustive-deps

    // Tick "saved Xs ago" every 10s.
    useEffect(() => {
        if (!lastSavedAt) return
        const t = setInterval(() => setSavedTick((n) => n + 1), 10_000)
        return () => clearInterval(t)
    }, [lastSavedAt])

    // Local-edit dirty flag — comparison-by-stringify is cheap for our payload.
    useEffect(() => {
        if (!quote) return
        // Skip until first seed runs.
        if (seededRef.current !== `${quote.id}|${quote.updated_at}`) return
        setDirty(true)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [drafts, discountPct, discountAmount, freightAmount, freightIncluded, otherCharges, gstRate, customTerms])

    // ─────────────────────────── Mutations ───────────────────────────

    const cloneMut = useMutation({
        mutationFn: (id: string) => quotationService.cloneRevision(id),
        onSuccess: (q) => {
            void queryClient.invalidateQueries({ queryKey: ["quotations", "list"] })
            toast({ title: "Revision created", description: `New ${q.quote_number} opened.` })
            router.push(`/sales/quotations/${q.id}`)
        },
        onError: (e: Error) =>
            toast({ title: "Clone failed", description: e.message, variant: "destructive" }),
    })

    const sendMut = useMutation({
        mutationFn: ({ id, via }: { id: string; via: "email" | "whatsapp" | "pdf_only" }) =>
            quotationService.send(id, { via, recipients: [] }),
        onSuccess: () => {
            setSendDialog(null)
            void queryClient.invalidateQueries({ queryKey: ["quotation", quotationId] })
            void queryClient.invalidateQueries({ queryKey: ["quotations", "list"] })
            toast({ title: "Quotation sent", description: "Customer notification recorded." })
        },
        onError: (e: Error) =>
            toast({ title: "Send failed", description: e.message, variant: "destructive" }),
    })

    const approveMut = useMutation({
        mutationFn: (id: string) => quotationService.approve(id),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: ["quotation", quotationId] })
            toast({ title: "Quote approved", description: "Ready to convert to sales order." })
        },
        onError: (e: Error) =>
            toast({ title: "Approve failed", description: e.message, variant: "destructive" }),
    })

    const rejectMut = useMutation({
        mutationFn: ({ id, reason }: { id: string; reason: string }) =>
            quotationService.reject(id, reason),
        onSuccess: () => {
            setRejectDialog(null)
            setRejectReason("")
            void queryClient.invalidateQueries({ queryKey: ["quotation", quotationId] })
            toast({ title: "Quote rejected", description: "Reason captured on the timeline." })
        },
        onError: (e: Error) =>
            toast({ title: "Reject failed", description: e.message, variant: "destructive" }),
    })

    const expireMut = useMutation({
        mutationFn: (id: string) => quotationService.expire(id),
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: ["quotation", quotationId] })
            toast({ title: "Quote marked expired" })
        },
        onError: (e: Error) =>
            toast({ title: "Mark expired failed", description: e.message, variant: "destructive" }),
    })

    const convertMut = useMutation({
        mutationFn: (id: string) => quotationService.convertToOrder(id),
        onSuccess: (res) => {
            void queryClient.invalidateQueries({ queryKey: ["quotation", quotationId] })
            toast({
                title: "Converted to sales order",
                description: `SO ${res.sales_order_number} created.`,
            })
            router.push(`/sales/orders/${res.sales_order_id}`)
        },
        onError: (e: Error) =>
            toast({ title: "Convert failed", description: e.message, variant: "destructive" }),
    })

    const createMut = useMutation({
        mutationFn: (body: Record<string, unknown>) => quotationService.create(body),
        onSuccess: (created) => {
            void queryClient.invalidateQueries({ queryKey: ["quotations", "list"] })
            toast({ title: "Quotation started", description: `New ${created.quote_number} opened.` })
            router.push(`/sales/quotations/${created.id}`)
        },
        onError: (e: Error) =>
            toast({ title: "Could not create quotation", description: e.message, variant: "destructive" }),
    })

    const saveMut = useMutation({
        mutationFn: async () => {
            if (!quotationId) {
                throw new Error("Save the quotation header first before persisting lines.")
            }
            // Patch commercials header first
            await quotationService.update(quotationId, {
                discount_pct: discountPct,
                discount_amount: discountAmount,
                freight_amount: freightAmount,
                freight_included: freightIncluded,
                other_charges: otherCharges,
                gst_rate: gstRate,
                custom_terms: customTerms,
            })
            // Then push items
            return quotationService.bulkUpdateItems(quotationId, toApiItems(drafts))
        },
        onMutate: () => {
            // Optimistic — show pulse via lastSavedAt clearing
        },
        onSuccess: () => {
            setLastSavedAt(Date.now())
            setDirty(false)
            void queryClient.invalidateQueries({ queryKey: ["quotation", quotationId] })
            toast({ title: "Saved", description: "Quotation persisted." })
        },
        onError: (e: Error) =>
            toast({ title: "Save failed", description: e.message, variant: "destructive" }),
    })

    // ⌘+S / Ctrl+S triggers save.
    const triggerSave = useCallback(() => {
        if (!quotationId) return
        if (saveMut.isPending) return
        saveMut.mutate()
    }, [quotationId, saveMut])

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
                e.preventDefault()
                triggerSave()
            }
        }
        window.addEventListener("keydown", onKey)
        return () => window.removeEventListener("keydown", onKey)
    }, [triggerSave])

    // ─────────────────── Customer context fetch ──────────────────────

    const customerId = (quote as { customer?: string } | null)?.customer || undefined
    const customerQuery = useQuery<CustomerSummary>({
        queryKey: ["customer", customerId],
        queryFn: () => quotationService.getCustomer(customerId!),
        enabled: Boolean(customerId),
    })
    const lastOrderQuery = useQuery({
        queryKey: ["customer-orders", customerId],
        queryFn: () => quotationService.listCustomerOrders(customerId!, { limit: 1 }),
        enabled: Boolean(customerId),
    })

    // ─────────────────────────── Derived ──────────────────────────────

    const validDays = useMemo(() => {
        if (!quote?.valid_until) return null
        const target = new Date(quote.valid_until).getTime()
        const now = Date.now()
        if (!Number.isFinite(target)) return null
        return Math.max(0, Math.ceil((target - now) / (24 * 60 * 60 * 1000)))
    }, [quote?.valid_until])

    const totals = (quote?.totals_snapshot || {}) as Record<string, number | boolean | undefined>
    const subtotal = drafts.reduce((s, d) => s + d.qty * d.rate, 0)
    const computedDiscount =
        discountAmount > 0 ? discountAmount : (subtotal * discountPct) / 100
    const freightExtra = freightIncluded ? 0 : freightAmount
    const otherChargesTotal = otherCharges.reduce((s, c) => s + Number(c.amount || 0), 0)
    const taxable = Math.max(0, subtotal - computedDiscount + freightExtra + otherChargesTotal)
    const tax = (taxable * gstRate) / 100
    const grand = taxable + tax

    // Production readiness check
    const readiness: { level: "GREEN" | "AMBER" | "RED"; reasons: string[] } = useMemo(() => {
        const reasons: string[] = []
        let amber = false
        let red = false
        if (drafts.length === 0) {
            red = true
            reasons.push("No quote lines.")
        }
        for (const d of drafts) {
            if (d.line_kind === "AD_HOC") {
                const layers = (d.spec_snapshot?.layers as Array<{ material_id?: string }>) || []
                if (layers.length === 0 || layers.some((l) => !l.material_id)) {
                    amber = true
                    reasons.push(`${d.line_name}: layer missing material.`)
                }
                const costing = d.costing_snapshot as { is_indicative?: boolean } | undefined
                if (costing?.is_indicative) {
                    amber = true
                    reasons.push(`${d.line_name}: rate card is indicative.`)
                }
            }
        }
        if (validDays !== null && validDays === 0 && quote?.status !== "CONVERTED") {
            red = true
            reasons.push("Validity has expired.")
        }
        if (customerQuery.data) {
            const cl = Number(customerQuery.data.credit_limit || 0)
            if (cl > 0 && grand > cl) {
                red = true
                reasons.push(`Quote ${inrFmt(grand)} exceeds credit limit ${inrFmt(cl)}.`)
            }
        }
        if (red) return { level: "RED", reasons }
        if (amber) return { level: "AMBER", reasons }
        return { level: "GREEN", reasons: ["All lines have valid BOM, costing, and credit headroom."] }
    }, [drafts, validDays, quote?.status, customerQuery.data, grand])

    const status = quote?.status || "DRAFT"

    if (mode === "edit" && quoteQuery.isLoading) {
        return (
            <main className="mx-auto max-w-[1480px] px-5 py-7 lg:px-8 lg:py-8">
                <div className="rounded-2xl bg-white ring-1 ring-slate-200/60 p-10 text-center text-sm font-semibold text-slate-500">
                    Loading quotation…
                </div>
            </main>
        )
    }

    if (mode === "edit" && !quote) {
        return (
            <main className="mx-auto max-w-[1480px] px-5 py-7 lg:px-8 lg:py-8">
                <div className="rounded-2xl bg-white ring-1 ring-slate-200/60 p-10 text-center">
                    <AlertTriangle className="h-10 w-10 mx-auto text-amber-500" />
                    <div className="mt-3 font-bold text-slate-800">Quotation not found.</div>
                    <Link
                        href="/sales/quotations"
                        className="mt-4 inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-indigo-600 text-white font-extrabold text-sm hover:bg-indigo-700"
                    >
                        <ArrowLeft className="h-4 w-4" strokeWidth={2.5} />
                        Back to list
                    </Link>
                </div>
            </main>
        )
    }

    if (mode === "new" && !quotationId) {
        return (
            <NewQuotationOnboarding
                onPick={(customer, repeatFromId) => {
                    if (repeatFromId) {
                        cloneMut.mutate(repeatFromId)
                    } else {
                        createMut.mutate({
                            customer: customer.id,
                            customer_name: customer.name,
                            status: "DRAFT",
                            currency: "INR",
                        })
                    }
                }}
                creating={createMut.isPending || cloneMut.isPending}
            />
        )
    }

    const headerNumber = quote?.quote_number || "NEW QUOTE"
    const headerStatus = quote ? STATUS_LABEL[quote.status] || quote.status : "draft"
    const customerLabel = quote?.customer_name || "Pick customer"
    const showValidChip = validDays !== null
    const isRevision = Boolean(quote?.parent_quotation) && (quote?.revision_no ?? 1) > 1
    const canPersist = Boolean(quotationId)

    const handleAddCatalog = () => {
        const id = makeLocalId()
        setDrafts((prev) => [
            ...prev,
            {
                local_id: id,
                line_no: prev.length + 1,
                line_kind: "CATALOG",
                line_name: "New catalog line",
                qty: 1,
                uom: "KG",
                rate: 0,
                margin_pct: 25,
                margin_lock: true,
                spec_snapshot: {},
            },
        ])
        setOpenId(id)
    }

    const handleAddAdhoc = () => {
        const id = makeLocalId()
        setDrafts((prev) => [
            ...prev,
            {
                local_id: id,
                line_no: prev.length + 1,
                line_kind: "AD_HOC",
                line_name: "Ad-hoc pouch",
                qty: 100,
                uom: "KG",
                rate: 0,
                margin_pct: 25,
                margin_lock: true,
                spec_snapshot: {
                    width_mm: 200,
                    height_mm: 305,
                    gusset_mm: 90,
                    flap_mm: 0,
                    layers: [
                        { position: "L1", material_code: "", material_name: "PET 12", micron: 12, gsm: 14.4, rate_per_kg: 142 },
                        { position: "L2", material_code: "", material_name: "MET-PE 25", micron: 25, gsm: 22.5, rate_per_kg: 198 },
                        { position: "L3", material_code: "", material_name: "PE 65", micron: 65, gsm: 59.5, rate_per_kg: 128 },
                    ],
                    adhesive_gsm: 4.0,
                    adhesive_rate_per_kg: 280,
                    ink_gsm: 3.2,
                    ink_rate_per_kg: 410,
                    addons: [],
                    features: {},
                },
            },
        ])
        setOpenId(id)
    }

    const handleChange = (local_id: string, next: DraftItem) => {
        setDrafts((prev) => prev.map((d) => (d.local_id === local_id ? next : d)))
    }

    const handleRemove = (local_id: string) => {
        setDrafts((prev) => {
            const filtered = prev.filter((d) => d.local_id !== local_id)
            return filtered.map((d, idx) => ({ ...d, line_no: idx + 1 }))
        })
        if (openId === local_id) setOpenId(null)
    }

    const handleDuplicate = (local_id: string) => {
        setDrafts((prev) => {
            const source = prev.find((d) => d.local_id === local_id)
            if (!source) return prev
            const clone: DraftItem = {
                ...source,
                local_id: makeLocalId(),
                id: undefined,
                line_no: prev.length + 1,
                line_name: `${source.line_name} (copy)`,
            }
            return [...prev, clone]
        })
    }

    const handleApplyTermsTemplate = (templateId: string) => {
        setTermsTemplate(templateId)
        const tpl = PRESET_TERMS.find((t) => t.id === templateId)
        if (tpl) setCustomTerms(tpl.body)
    }

    const counts = {
        total: drafts.length,
        catalog: drafts.filter((d) => d.line_kind === "CATALOG").length,
        adhoc: drafts.filter((d) => d.line_kind === "AD_HOC").length,
    }

    const creditLimit = Number(customerQuery.data?.credit_limit || 0)
    const creditWarning =
        creditLimit > 0 && grand > creditLimit
            ? { level: "RED" as const, msg: `Exceeds credit limit by ₹${inrFmt(grand - creditLimit)}.` }
            : creditLimit > 0 && grand > creditLimit * 0.9
            ? { level: "AMBER" as const, msg: `Within 10% of credit limit.` }
            : null

    // ── Send / approve / convert client-side guards ──────────────────────────
    const hasCustomer = Boolean(quote?.customer || quote?.customer_name)
    const hasLines = drafts.length > 0
    const linesValid = drafts.length > 0 && drafts.every((d) => d.qty > 0 && d.rate > 0)
    const sendBlockedReason = !quote
        ? "Save the quotation first."
        : !hasCustomer
        ? "Pick a customer before sending."
        : !hasLines
        ? "Add at least one line."
        : !linesValid
        ? "Every line needs qty > 0 and rate > 0."
        : null
    const approveBlockedReason = !quote
        ? "Save the quotation first."
        : !hasLines
        ? "Add at least one line."
        : !linesValid
        ? "Every line needs qty > 0 and rate > 0."
        : null

    // Blended margin across all lines.
    const totalCost = drafts.reduce((s, d) => {
        const costing = d.costing_snapshot as { total_cost_per_kg?: number } | undefined
        const cost = Number(costing?.total_cost_per_kg || 0)
        return s + cost * d.qty
    }, 0)
    const blendedMargin = subtotal > 0 ? ((subtotal - totalCost) / subtotal) * 100 : 0
    const totalKg = drafts.reduce((s, d) => s + (d.uom === "KG" ? d.qty : 0), 0)
    // Margin colour bucket.
    const marginColor =
        blendedMargin >= 20
            ? "text-emerald-700 bg-emerald-50 ring-emerald-200"
            : blendedMargin >= 10
            ? "text-amber-700 bg-amber-50 ring-amber-200"
            : "text-rose-700 bg-rose-50 ring-rose-200"
    const lowestLineMargin = drafts.reduce<number | null>((min, d) => {
        const m = Number((d.costing_snapshot as { margin_pct?: number } | undefined)?.margin_pct ?? d.margin_pct ?? NaN)
        if (!Number.isFinite(m)) return min
        return min === null ? m : Math.min(min, m)
    }, null)
    const marginFloor = 10
    const needsMarginConfirm = lowestLineMargin !== null && lowestLineMargin < marginFloor

    return (
        <main className="mx-auto max-w-[1480px] px-5 py-7 lg:px-8 lg:py-8 pb-32 space-y-5">
            {/* Hero */}
            <section className="relative overflow-hidden rounded-[28px] bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 p-6 text-white shadow-[0_24px_60px_-36px_rgba(79,70,229,0.6)]">
                <div className="absolute -right-20 -top-20 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
                <div className="absolute -left-10 -bottom-20 h-56 w-56 rounded-full bg-fuchsia-300/20 blur-3xl" />
                <div className="relative flex flex-wrap items-start justify-between gap-4">
                    <div>
                        <div className="flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[.22em] text-indigo-100">
                            <Link href="/sales/quotations" className="inline-flex items-center gap-1 hover:underline">
                                <ArrowLeft className="h-3 w-3" strokeWidth={2.5} />
                                Quotations
                            </Link>
                            <span>·</span>
                            <span>Workspace v37</span>
                        </div>
                        <h1 className="text-3xl font-extrabold tracking-tight mt-1.5">
                            <span className="font-mono">{headerNumber}</span>
                            <span className="ml-2 text-base font-bold text-indigo-100">
                                {headerStatus.toLowerCase()}
                            </span>
                        </h1>
                        <p className="text-sm font-semibold text-indigo-100 mt-1">
                            Quote any pouch — repeat catalog or build from scratch. Material BOM and costing computed live.
                        </p>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                            <span className="inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-[11px] font-extrabold bg-white/15 backdrop-blur text-white ring-1 ring-white/20">
                                CUSTOMER · {customerLabel}
                            </span>
                            {showValidChip ? (
                                <span className="inline-flex items-center h-6 px-2.5 rounded-full text-[11px] font-extrabold bg-emerald-400/30 text-emerald-50 ring-1 ring-emerald-300/40">
                                    VALID {validDays} DAYS
                                </span>
                            ) : null}
                            {isRevision ? (
                                <span className="inline-flex items-center h-6 px-2.5 rounded-full text-[11px] font-extrabold bg-amber-400/30 text-amber-50 ring-1 ring-amber-300/40">
                                    REV {quote?.revision_no}
                                </span>
                            ) : null}
                            {/* Production readiness chip */}
                            <span
                                className={cn(
                                    "inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-[11px] font-extrabold ring-1",
                                    readiness.level === "GREEN" &&
                                        "bg-emerald-400/30 text-emerald-50 ring-emerald-300/40",
                                    readiness.level === "AMBER" &&
                                        "bg-amber-400/30 text-amber-50 ring-amber-300/40",
                                    readiness.level === "RED" && "bg-rose-400/30 text-rose-50 ring-rose-300/40",
                                )}
                                title={readiness.reasons.join(" · ")}
                            >
                                <span className={cn("h-1.5 w-1.5 rounded-full", {
                                    "bg-emerald-300": readiness.level === "GREEN",
                                    "bg-amber-300": readiness.level === "AMBER",
                                    "bg-rose-300": readiness.level === "RED",
                                })} />
                                {readiness.level === "GREEN"
                                    ? "Ready"
                                    : readiness.level === "AMBER"
                                    ? "Needs review"
                                    : "Blocked"}
                            </span>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        {quote ? (
                            <a
                                href={quotationService.pdfUrl(quote.id)}
                                target="_blank"
                                rel="noopener"
                                className="h-10 px-4 inline-flex items-center gap-2 rounded-xl bg-white/10 backdrop-blur text-white font-bold text-sm ring-1 ring-white/20 hover:bg-white/15"
                            >
                                <Download className="h-4 w-4" strokeWidth={2.5} />
                                Preview PDF
                            </a>
                        ) : null}
                        {quote && quote.status === "APPROVED" ? (
                            <button
                                onClick={() => setConvertDialog("open")}
                                disabled={convertMut.isPending}
                                className="h-10 px-4 inline-flex items-center gap-2 rounded-xl bg-white text-indigo-700 font-extrabold text-sm hover:bg-indigo-50 shadow-md disabled:opacity-60"
                            >
                                {convertMut.isPending ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    <Truck className="h-4 w-4" strokeWidth={2.5} />
                                )}
                                Convert to Sales Order
                            </button>
                        ) : null}
                    </div>
                </div>
            </section>

            {/* Status-driven banner */}
            {quote ? (
                <StatusBanner
                    quote={quote}
                    drafts={drafts}
                    onConvert={() => setConvertDialog("open")}
                    onClone={() => cloneMut.mutate(quote.id)}
                    onSend={() => setSendDialog("open")}
                    sendBlockedReason={sendBlockedReason}
                />
            ) : null}

            {/* Live summary chip */}
            {quote ? (
                <section className="rounded-2xl bg-white ring-1 ring-slate-200/60 p-3 flex flex-wrap items-center gap-3 shadow-[0_18px_42px_-34px_rgba(15,23,42,0.32)]">
                    <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[11px] font-extrabold bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200">
                        <FileText className="h-3 w-3" /> {counts.total} lines
                    </span>
                    <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[11px] font-extrabold bg-sky-50 text-sky-700 ring-1 ring-sky-200 font-mono">
                        {inrFmt(totalKg)} KG
                    </span>
                    <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[11px] font-extrabold bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 font-mono">
                        ₹ {inrFmt(grand)}
                    </span>
                    {subtotal > 0 ? (
                        <span className={cn(
                            "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[11px] font-extrabold ring-1 font-mono",
                            marginColor,
                        )}>
                            {blendedMargin.toFixed(1)}% blended margin
                        </span>
                    ) : null}
                    {dirty ? (
                        <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[11px] font-extrabold bg-amber-50 text-amber-700 ring-1 ring-amber-200">
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                            Unsaved changes
                        </span>
                    ) : lastSavedAt ? (
                        <span className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[11px] font-extrabold bg-slate-50 text-slate-600 ring-1 ring-slate-200">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            Saved {savedAgo(lastSavedAt, savedTick)}
                        </span>
                    ) : null}
                </section>
            ) : null}

            <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-5">
                <div className="space-y-5 min-w-0">
                    {/* Meta strip */}
                    <section className="rounded-2xl bg-white ring-1 ring-slate-200/60 p-4 shadow-[0_18px_42px_-34px_rgba(15,23,42,0.32)]">
                        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-[11px] font-extrabold uppercase tracking-widest text-slate-500">
                            <div>
                                <div>Customer</div>
                                <div className="mt-1 text-sm font-bold text-slate-900 normal-case tracking-normal truncate">
                                    {quote?.customer_name || "—"}
                                </div>
                            </div>
                            <div>
                                <div>Plant</div>
                                <div className="mt-1 text-sm font-bold text-slate-900 normal-case tracking-normal">
                                    {quote?.plant_name || "—"}
                                </div>
                            </div>
                            <div>
                                <div>Currency</div>
                                <div className="mt-1 text-sm font-bold text-slate-900 font-mono normal-case tracking-normal">
                                    {quote?.currency || "INR"}
                                </div>
                            </div>
                            <div>
                                <div>Status</div>
                                <div className="mt-1 text-sm font-bold text-slate-900 normal-case tracking-normal flex items-center gap-2">
                                    <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[status])} />
                                    {headerStatus}
                                </div>
                            </div>
                            <div>
                                <div>Valid until</div>
                                <div className="mt-1 text-sm font-bold text-slate-900 font-mono normal-case tracking-normal">
                                    {quote?.valid_until || "—"}
                                </div>
                            </div>
                            <div>
                                <div>Revision</div>
                                <div className="mt-1 text-sm font-bold text-slate-900 font-mono normal-case tracking-normal">
                                    v{quote?.revision_no || 1}
                                </div>
                            </div>
                        </div>
                    </section>

                    {/* Action rail */}
                    {quote ? (
                        <section className="rounded-2xl bg-white ring-1 ring-slate-200/60 p-4 flex flex-wrap gap-2 items-center shadow-[0_18px_42px_-34px_rgba(15,23,42,0.32)]">
                            <button
                                onClick={() => cloneMut.mutate(quote.id)}
                                disabled={cloneMut.isPending}
                                className="h-10 px-3 inline-flex items-center gap-2 rounded-xl bg-slate-100 text-slate-800 font-bold text-sm hover:bg-slate-200 disabled:opacity-60"
                            >
                                {cloneMut.isPending ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    <Copy className="h-4 w-4" strokeWidth={2.2} />
                                )}
                                Clone revision
                            </button>
                            {quote.status !== "APPROVED" && quote.status !== "CONVERTED" ? (
                                <>
                                    <button
                                        onClick={() => setSendDialog("open")}
                                        disabled={sendMut.isPending || Boolean(sendBlockedReason)}
                                        title={sendBlockedReason || "Send PDF to customer"}
                                        className="h-10 px-3 inline-flex items-center gap-2 rounded-xl bg-brand-blue text-white font-bold text-sm hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
                                    >
                                        {sendMut.isPending ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                            <Send className="h-4 w-4" strokeWidth={2.2} />
                                        )}
                                        Send to customer
                                    </button>
                                    <button
                                        onClick={() => {
                                            if (needsMarginConfirm) {
                                                setApproveDialog("open")
                                            } else {
                                                approveMut.mutate(quote.id)
                                            }
                                        }}
                                        disabled={approveMut.isPending || Boolean(approveBlockedReason)}
                                        title={approveBlockedReason || "Approve quote"}
                                        className="h-10 px-3 inline-flex items-center gap-2 rounded-xl bg-emerald-600 text-white font-bold text-sm hover:bg-emerald-700 disabled:opacity-60 disabled:cursor-not-allowed"
                                    >
                                        {approveMut.isPending ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                            <ShieldCheck className="h-4 w-4" strokeWidth={2.2} />
                                        )}
                                        Approve
                                    </button>
                                    <button
                                        onClick={() => setRejectDialog("open")}
                                        disabled={rejectMut.isPending}
                                        className="h-10 px-3 inline-flex items-center gap-2 rounded-xl bg-rose-50 text-rose-700 ring-1 ring-rose-200 font-bold text-sm hover:bg-rose-100 disabled:opacity-60"
                                    >
                                        <XCircle className="h-4 w-4" strokeWidth={2.2} />
                                        Reject
                                    </button>
                                </>
                            ) : (
                                <span className="inline-flex items-center gap-2 h-10 px-4 rounded-xl bg-emerald-50 text-emerald-700 font-bold text-sm ring-1 ring-emerald-200">
                                    <CheckCircle2 className="h-4 w-4" strokeWidth={2.5} />
                                    {STATUS_LABEL[quote.status]}
                                </span>
                            )}
                            {quote.status !== "CONVERTED" && quote.status !== "EXPIRED" ? (
                                <button
                                    onClick={() => expireMut.mutate(quote.id)}
                                    disabled={expireMut.isPending}
                                    className="h-10 px-3 inline-flex items-center gap-2 rounded-xl text-amber-700 hover:bg-amber-50 font-bold text-sm disabled:opacity-60"
                                >
                                    <Clock className="h-4 w-4" strokeWidth={2.2} />
                                    Mark expired
                                </button>
                            ) : null}
                            <a
                                href={quotationService.pdfUrl(quote.id, { customerView: true })}
                                target="_blank"
                                rel="noopener"
                                className="h-10 px-3 inline-flex items-center gap-2 rounded-xl text-slate-600 hover:bg-slate-100 font-bold text-sm ml-auto"
                            >
                                <Eye className="h-4 w-4" strokeWidth={2.2} />
                                Customer view
                            </a>
                        </section>
                    ) : null}

                    {/* Lines */}
                    <section className="space-y-3">
                        <div className="flex items-center justify-between flex-wrap gap-2">
                            <div className="flex items-center gap-3">
                                <FileText className="h-5 w-5 text-indigo-600" />
                                <h3 className="text-base font-extrabold text-slate-900">Quote Lines</h3>
                                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                                    {counts.total} lines · {counts.catalog} catalog · {counts.adhoc} ad-hoc · ₹ {inrFmt(subtotal)}
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={handleAddCatalog}
                                    className="h-9 px-3 inline-flex items-center gap-2 rounded-lg bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 font-extrabold text-xs uppercase tracking-widest hover:bg-emerald-100"
                                >
                                    <Package className="h-3.5 w-3.5" />
                                    <Plus className="h-3.5 w-3.5 -ml-1" />
                                    Catalog line
                                </button>
                                <button
                                    onClick={handleAddAdhoc}
                                    className="h-9 px-3 inline-flex items-center gap-2 rounded-lg bg-violet-50 text-violet-700 ring-1 ring-violet-200 font-extrabold text-xs uppercase tracking-widest hover:bg-violet-100"
                                >
                                    <Wand2 className="h-3.5 w-3.5" />
                                    <Plus className="h-3.5 w-3.5 -ml-1" />
                                    Ad-hoc pouch
                                </button>
                            </div>
                        </div>

                        {drafts.length === 0 ? (
                            <div className="rounded-2xl bg-white ring-1 ring-slate-200/60 p-10 text-center">
                                <div className="text-sm font-extrabold text-slate-700">No lines yet.</div>
                                <p className="mt-1 text-[12px] font-semibold text-slate-500">
                                    Add a catalog line for repeat product masters, or build an ad-hoc pouch from scratch.
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {drafts.map((draft) => (
                                    <QuotationLineCard
                                        key={draft.local_id}
                                        item={draft}
                                        customerId={customerId}
                                        plantId={(quote as { plant?: string } | null)?.plant || undefined}
                                        isOpen={openId === draft.local_id}
                                        onToggle={() => setOpenId((cur) => (cur === draft.local_id ? null : draft.local_id))}
                                        onChange={(next) => handleChange(draft.local_id, next)}
                                        onRemove={() => handleRemove(draft.local_id)}
                                        onDuplicate={() => handleDuplicate(draft.local_id)}
                                        onSaveLine={() => saveMut.mutate()}
                                        canPersist={canPersist}
                                    />
                                ))}
                            </div>
                        )}
                    </section>

                    {/* Commercials */}
                    <section className="rounded-2xl bg-white ring-1 ring-slate-200/60 p-5 shadow-[0_18px_42px_-34px_rgba(15,23,42,0.32)] space-y-4">
                        <div className="flex items-center gap-2">
                            <BadgeIndianRupee className="h-5 w-5 text-emerald-600" />
                            <h3 className="text-base font-extrabold text-slate-900">Commercials</h3>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <label className="block">
                                <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500">Discount %</span>
                                <input
                                    type="number"
                                    value={discountPct}
                                    onChange={(e) => {
                                        setDiscountPct(Number(e.target.value))
                                        setDiscountAmount(0)
                                    }}
                                    className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-bold font-mono text-right outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200"
                                />
                            </label>
                            <label className="block">
                                <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500">Discount ₹</span>
                                <input
                                    type="number"
                                    value={discountAmount}
                                    onChange={(e) => {
                                        setDiscountAmount(Number(e.target.value))
                                        if (e.target.value) setDiscountPct(0)
                                    }}
                                    className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-bold font-mono text-right outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200"
                                />
                            </label>
                            <label className="block">
                                <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500">Freight ₹</span>
                                <input
                                    type="number"
                                    value={freightAmount}
                                    onChange={(e) => setFreightAmount(Number(e.target.value))}
                                    className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-bold font-mono text-right outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200"
                                />
                            </label>
                            <label className="block">
                                <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500">GST %</span>
                                <input
                                    type="number"
                                    value={gstRate}
                                    onChange={(e) => setGstRate(Number(e.target.value))}
                                    className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm font-bold font-mono text-right outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200"
                                />
                            </label>
                        </div>
                        <label className="inline-flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-widest text-slate-600">
                            <input
                                type="checkbox"
                                checked={freightIncluded}
                                onChange={(e) => setFreightIncluded(e.target.checked)}
                            />
                            Freight included in line rate (otherwise charged extra)
                        </label>

                        {/* Other charges */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <div className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500">
                                    Other charges (tooling, samples, dies)
                                </div>
                                <button
                                    onClick={() =>
                                        setOtherCharges((prev) => [...prev, { label: "Charge", amount: 0 }])
                                    }
                                    className="inline-flex items-center gap-1 h-7 px-2 rounded-lg bg-slate-100 text-slate-700 text-[11px] font-extrabold uppercase tracking-wider hover:bg-slate-200"
                                >
                                    <Plus className="h-3 w-3" strokeWidth={2.5} />
                                    Add
                                </button>
                            </div>
                            {otherCharges.length === 0 ? (
                                <div className="text-[11px] font-bold text-slate-400">None.</div>
                            ) : (
                                otherCharges.map((c, idx) => (
                                    <div key={idx} className="grid grid-cols-[1fr_140px_auto] gap-2 items-center">
                                        <input
                                            type="text"
                                            value={c.label}
                                            onChange={(e) =>
                                                setOtherCharges((prev) =>
                                                    prev.map((x, i) => (i === idx ? { ...x, label: e.target.value } : x)),
                                                )
                                            }
                                            className="h-9 rounded-lg border border-slate-200 px-2 text-sm font-bold outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200"
                                        />
                                        <input
                                            type="number"
                                            value={c.amount}
                                            onChange={(e) =>
                                                setOtherCharges((prev) =>
                                                    prev.map((x, i) =>
                                                        i === idx ? { ...x, amount: Number(e.target.value) } : x,
                                                    ),
                                                )
                                            }
                                            className="h-9 rounded-lg border border-slate-200 px-2 text-sm font-bold font-mono text-right outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200"
                                        />
                                        <button
                                            onClick={() =>
                                                setOtherCharges((prev) => prev.filter((_, i) => i !== idx))
                                            }
                                            className="h-9 w-9 inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>

                        {/* Totals summary */}
                        <div className="rounded-xl border border-slate-200 p-4 bg-slate-50/50 space-y-1.5">
                            <Row label="Subtotal" value={`₹ ${inrFmt(subtotal)}`} />
                            {computedDiscount > 0 ? (
                                <Row label="Discount" value={`- ₹ ${inrFmt(computedDiscount)}`} color="text-rose-700" />
                            ) : null}
                            {freightAmount > 0 ? (
                                <Row
                                    label={freightIncluded ? "Freight (incl.)" : "Freight (extra)"}
                                    value={freightIncluded ? "Included" : `₹ ${inrFmt(freightAmount)}`}
                                />
                            ) : null}
                            {otherCharges.length > 0 ? (
                                <Row label="Other charges" value={`₹ ${inrFmt(otherChargesTotal)}`} />
                            ) : null}
                            <Row label="Taxable" value={`₹ ${inrFmt(taxable)}`} bold />
                            <Row label={`GST ${gstRate}%`} value={`₹ ${inrFmt(tax)}`} />
                            <div className="border-t border-slate-200 my-2" />
                            <Row label="Grand total" value={`₹ ${inrFmt(grand)}`} bold huge />
                        </div>

                        {/* Terms */}
                        <div className="space-y-2 pt-2">
                            <div className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500">
                                Terms preset
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                                {PRESET_TERMS.map((t) => (
                                    <button
                                        key={t.id}
                                        onClick={() => handleApplyTermsTemplate(t.id)}
                                        className={cn(
                                            "h-8 px-3 rounded-full text-[11px] font-extrabold uppercase tracking-wider ring-1 transition",
                                            termsTemplate === t.id
                                                ? "bg-slate-900 text-white ring-slate-900"
                                                : "bg-slate-50 text-slate-600 ring-slate-200 hover:bg-slate-100",
                                        )}
                                    >
                                        {t.label}
                                    </button>
                                ))}
                            </div>
                            <textarea
                                value={customTerms}
                                onChange={(e) => setCustomTerms(e.target.value)}
                                placeholder="Custom terms — payment, delivery, conditions…"
                                rows={4}
                                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200"
                            />
                        </div>
                    </section>
                </div>

                {/* Right rail */}
                <aside className="space-y-4">
                    {/* Customer context */}
                    {quote ? (
                        <section className="rounded-2xl bg-white ring-1 ring-slate-200/60 p-4 shadow-[0_18px_42px_-34px_rgba(15,23,42,0.32)]">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Building2 className="h-4 w-4 text-brand-navy" />
                                    <div className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500">
                                        Customer
                                    </div>
                                </div>
                                {customerId ? (
                                    <Link
                                        href={`/sales/customers/${customerId}`}
                                        className="text-[11px] font-extrabold uppercase tracking-wider text-indigo-600 hover:underline inline-flex items-center gap-1"
                                    >
                                        Open <ArrowUpRight className="h-3 w-3" strokeWidth={2.5} />
                                    </Link>
                                ) : null}
                            </div>
                            <div className="mt-2 text-sm font-extrabold text-slate-900 truncate">
                                {customerQuery.data?.name || quote.customer_name}
                            </div>
                            <div className="text-[11px] font-bold text-slate-500 font-mono">
                                {customerQuery.data?.code || "—"}
                            </div>
                            <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] font-bold text-slate-600">
                                <div>
                                    <div className="text-[9px] uppercase tracking-widest text-slate-400">Credit limit</div>
                                    <div className="font-mono text-slate-900">
                                        ₹ {inrFmt(customerQuery.data?.credit_limit)}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-[9px] uppercase tracking-widest text-slate-400">Credit days</div>
                                    <div className="font-mono text-slate-900">{customerQuery.data?.credit_days ?? "—"}</div>
                                </div>
                                <div>
                                    <div className="text-[9px] uppercase tracking-widest text-slate-400">Outstanding</div>
                                    <div className="font-mono text-slate-500 italic">
                                        — <span className="text-[9px]">AR not yet wired</span>
                                    </div>
                                </div>
                                <div>
                                    <div className="text-[9px] uppercase tracking-widest text-slate-400">Last order</div>
                                    <div className="font-mono text-slate-900">
                                        {lastOrderQuery.data && lastOrderQuery.data.length > 0
                                            ? new Date(lastOrderQuery.data[0].created_at).toLocaleDateString()
                                            : "—"}
                                    </div>
                                </div>
                            </div>
                            {creditWarning ? (
                                <div
                                    className={cn(
                                        "mt-3 rounded-lg px-3 py-2 text-[11px] font-extrabold flex items-start gap-2",
                                        creditWarning.level === "RED"
                                            ? "bg-rose-50 text-rose-800 ring-1 ring-rose-200"
                                            : "bg-amber-50 text-amber-800 ring-1 ring-amber-200",
                                    )}
                                >
                                    <ShieldAlert className="h-3.5 w-3.5 mt-0.5 shrink-0" strokeWidth={2.5} />
                                    {creditWarning.msg}
                                </div>
                            ) : null}
                        </section>
                    ) : null}

                    {/* Lifecycle timeline */}
                    {quote ? (
                        <section className="rounded-2xl bg-white ring-1 ring-slate-200/60 p-4 shadow-[0_18px_42px_-34px_rgba(15,23,42,0.32)]">
                            <div className="flex items-center gap-2 mb-3">
                                <Clock className="h-4 w-4 text-brand-blue" />
                                <div className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500">
                                    Lifecycle
                                </div>
                            </div>
                            <ul className="space-y-2">
                                <TimelineRow
                                    label="Created"
                                    at={quote.created_at}
                                    actor="System"
                                    dot="bg-slate-400"
                                />
                                {quote.sent_at ? (
                                    <TimelineRow
                                        label="Sent"
                                        at={quote.sent_at}
                                        actor={quote.sent_by_name || "—"}
                                        dot="bg-brand-blue"
                                    />
                                ) : null}
                                {quote.approved_at ? (
                                    <TimelineRow
                                        label="Approved"
                                        at={quote.approved_at}
                                        actor={quote.approved_by_name || "—"}
                                        dot="bg-emerald-500"
                                    />
                                ) : null}
                                {(quote.status_history || []).map((entry, idx) => (
                                    <TimelineRow
                                        key={idx}
                                        label={STATUS_LABEL[entry.status] || entry.status}
                                        at={entry.at}
                                        actor={entry.by_name || "—"}
                                        note={entry.note}
                                        dot={STATUS_DOT[entry.status] || "bg-slate-400"}
                                    />
                                ))}
                                {quote.converted_sales_order_number ? (
                                    <TimelineRow
                                        label={`Converted → ${quote.converted_sales_order_number}`}
                                        at={quote.updated_at}
                                        actor="—"
                                        dot="bg-brand-navy"
                                    />
                                ) : null}
                            </ul>
                        </section>
                    ) : null}

                    {/* Revisions */}
                    {quote ? (
                        <section className="rounded-2xl bg-white ring-1 ring-slate-200/60 p-4 shadow-[0_18px_42px_-34px_rgba(15,23,42,0.32)]">
                            <div className="flex items-center gap-2 mb-2">
                                <GitBranch className="h-4 w-4 text-brand-orange" />
                                <div className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500">
                                    Revisions
                                </div>
                            </div>
                            <div className="text-[12px] font-bold text-slate-700">
                                v{quote.revision_no || 1}{" "}
                                {quote.parent_quotation ? (
                                    <Link
                                        href={`/sales/quotations/${quote.parent_quotation}`}
                                        className="ml-2 text-indigo-600 hover:underline inline-flex items-center gap-1"
                                    >
                                        Parent <ChevronRight className="h-3 w-3" />
                                    </Link>
                                ) : (
                                    <span className="text-slate-400">(original)</span>
                                )}
                            </div>
                        </section>
                    ) : null}
                </aside>
            </div>

            {/* Sticky bottom action bar */}
            <div className="fixed bottom-0 inset-x-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur shadow-[0_-12px_28px_-12px_rgba(15,23,42,0.16)]">
                <div className="mx-auto max-w-[1480px] px-5 lg:px-8 py-3 flex items-center gap-3 flex-wrap">
                    <div className="flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-widest text-slate-500">
                        {saveMut.isPending ? (
                            <>
                                <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-600" />
                                Saving…
                            </>
                        ) : dirty ? (
                            <>
                                <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                                Unsaved changes
                            </>
                        ) : lastSavedAt ? (
                            <>
                                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                                Saved {savedAgo(lastSavedAt, savedTick)}
                            </>
                        ) : (
                            <>
                                <span className="h-2 w-2 rounded-full bg-slate-300" />
                                Idle
                            </>
                        )}
                        <span className="hidden md:inline text-slate-400 ml-2">⌘S to save</span>
                    </div>
                    <div className="font-mono text-[12px] font-bold text-slate-600">
                        {counts.total} lines · {counts.adhoc} ad-hoc · {counts.catalog} catalog · ₹ {inrFmt(grand)} total
                    </div>
                    <div className="ml-auto flex items-center gap-2">
                        {quote ? (
                            <a
                                href={quotationService.pdfUrl(quote.id, { customerView: true })}
                                target="_blank"
                                rel="noopener"
                                className="h-10 px-3 inline-flex items-center gap-2 rounded-xl text-slate-600 hover:bg-slate-100 font-bold text-sm"
                            >
                                <Eye className="h-4 w-4" strokeWidth={2.2} />
                                Customer view
                            </a>
                        ) : null}
                        {canPersist ? (
                            <button
                                onClick={() => saveMut.mutate()}
                                disabled={saveMut.isPending}
                                className="h-10 px-4 inline-flex items-center gap-2 rounded-xl bg-indigo-600 text-white font-extrabold text-sm hover:bg-indigo-700 disabled:opacity-60"
                            >
                                {saveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                Save draft
                            </button>
                        ) : null}
                        {quote && quote.status !== "APPROVED" && quote.status !== "CONVERTED" ? (
                            <button
                                onClick={() => setSendDialog("open")}
                                disabled={Boolean(sendBlockedReason) || sendMut.isPending}
                                title={sendBlockedReason || "Send PDF to customer"}
                                className="h-10 px-4 inline-flex items-center gap-2 rounded-xl bg-brand-blue text-white font-extrabold text-sm hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                                <Send className="h-4 w-4" />
                                Send
                            </button>
                        ) : null}
                    </div>
                </div>
            </div>

            {/* Send dialog */}
            {sendDialog === "open" && quote ? (
                <Dialog onClose={() => setSendDialog(null)}>
                    <div className="flex items-center gap-2 mb-3">
                        <Send className="h-5 w-5 text-brand-blue" />
                        <h3 className="text-base font-extrabold text-slate-900">Send to customer</h3>
                    </div>
                    <p className="text-[12px] font-semibold text-slate-500 mb-4">
                        Pick how the customer should receive {quote.quote_number}.
                    </p>
                    <div className="grid grid-cols-1 gap-2 mb-4">
                        {(
                            [
                                { id: "email", label: "Email", icon: Mail },
                                { id: "whatsapp", label: "WhatsApp", icon: MessageSquare },
                                { id: "pdf_only", label: "PDF only (manual share)", icon: FileText },
                            ] as Array<{ id: typeof sendVia; label: string; icon: typeof Mail }>
                        ).map(({ id, label, icon: Icon }) => (
                            <button
                                key={id}
                                onClick={() => setSendVia(id)}
                                className={cn(
                                    "flex items-center gap-3 px-3 h-12 rounded-xl ring-1 text-left",
                                    sendVia === id
                                        ? "bg-indigo-50 ring-indigo-300 text-indigo-800 font-extrabold"
                                        : "bg-white ring-slate-200 text-slate-700 font-bold hover:bg-slate-50",
                                )}
                            >
                                <Icon className="h-4 w-4" />
                                {label}
                            </button>
                        ))}
                    </div>
                    <div className="flex justify-end gap-2">
                        <button
                            onClick={() => setSendDialog(null)}
                            className="h-10 px-4 rounded-xl text-slate-600 hover:bg-slate-100 font-bold"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={() => sendMut.mutate({ id: quote.id, via: sendVia })}
                            disabled={sendMut.isPending}
                            className="h-10 px-4 inline-flex items-center gap-2 rounded-xl bg-brand-blue text-white font-extrabold hover:opacity-90 disabled:opacity-60"
                        >
                            {sendMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                            Send
                        </button>
                    </div>
                </Dialog>
            ) : null}

            {/* Reject dialog */}
            {rejectDialog === "open" && quote ? (
                <Dialog onClose={() => setRejectDialog(null)}>
                    <div className="flex items-center gap-2 mb-3">
                        <XCircle className="h-5 w-5 text-rose-600" />
                        <h3 className="text-base font-extrabold text-slate-900">Reject quotation</h3>
                    </div>
                    <p className="text-[12px] font-semibold text-slate-500 mb-3">
                        Capture a short reason so future revisions know what changed.
                    </p>
                    <textarea
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                        placeholder="E.g. Customer asked for revised pricing on the 25-micron layer."
                        rows={4}
                        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold outline-none focus:border-rose-400 focus:ring-2 focus:ring-rose-200 mb-4"
                    />
                    <div className="flex justify-end gap-2">
                        <button
                            onClick={() => setRejectDialog(null)}
                            className="h-10 px-4 rounded-xl text-slate-600 hover:bg-slate-100 font-bold"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={() => rejectMut.mutate({ id: quote.id, reason: rejectReason })}
                            disabled={rejectMut.isPending}
                            className="h-10 px-4 inline-flex items-center gap-2 rounded-xl bg-rose-600 text-white font-extrabold hover:bg-rose-700 disabled:opacity-60"
                        >
                            {rejectMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
                            Reject
                        </button>
                    </div>
                </Dialog>
            ) : null}

            {/* Convert-to-SO dialog */}
            {convertDialog === "open" && quote ? (
                <Dialog onClose={() => setConvertDialog(null)}>
                    <div className="flex items-center gap-2 mb-3">
                        <Truck className="h-5 w-5 text-brand-navy" />
                        <h3 className="text-base font-extrabold text-slate-900">Convert to Sales Order</h3>
                    </div>
                    <p className="text-[13px] font-semibold text-slate-600 mb-4">
                        Convert <span className="font-mono font-extrabold text-slate-900">{quote.quote_number}</span> to a Sales Order? This locks the quotation as <span className="font-extrabold">CONVERTED</span> and creates a new SO ready for production planning.
                    </p>
                    <div className="rounded-lg bg-slate-50 ring-1 ring-slate-200 p-3 mb-4 text-[12px] text-slate-700">
                        <div className="font-extrabold text-slate-900">{counts.total} lines · ₹ {inrFmt(grand)}</div>
                        <div className="text-[11px] text-slate-500 mt-0.5">{quote.customer_name}</div>
                    </div>
                    <div className="flex justify-end gap-2">
                        <button
                            onClick={() => setConvertDialog(null)}
                            className="h-10 px-4 rounded-xl text-slate-600 hover:bg-slate-100 font-bold"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={() => {
                                setConvertDialog(null)
                                convertMut.mutate(quote.id)
                            }}
                            disabled={convertMut.isPending}
                            className="h-10 px-4 inline-flex items-center gap-2 rounded-xl bg-brand-navy text-white font-extrabold hover:bg-brand-navy-600 disabled:opacity-60"
                        >
                            {convertMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                            Convert
                        </button>
                    </div>
                </Dialog>
            ) : null}

            {/* Margin-floor confirmation dialog */}
            {approveDialog === "open" && quote ? (
                <Dialog onClose={() => setApproveDialog(null)}>
                    <div className="flex items-center gap-2 mb-3">
                        <ShieldAlert className="h-5 w-5 text-amber-600" />
                        <h3 className="text-base font-extrabold text-slate-900">Margin below floor</h3>
                    </div>
                    <p className="text-[13px] font-semibold text-slate-600 mb-4">
                        Lowest line margin is{" "}
                        <span className="font-mono font-extrabold text-rose-700">
                            {lowestLineMargin !== null ? lowestLineMargin.toFixed(1) : "—"}%
                        </span>
                        , below the {marginFloor}% floor. Approve anyway?
                    </p>
                    <div className="flex justify-end gap-2">
                        <button
                            onClick={() => setApproveDialog(null)}
                            className="h-10 px-4 rounded-xl text-slate-600 hover:bg-slate-100 font-bold"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={() => {
                                setApproveDialog(null)
                                approveMut.mutate(quote.id)
                            }}
                            disabled={approveMut.isPending}
                            className="h-10 px-4 inline-flex items-center gap-2 rounded-xl bg-emerald-600 text-white font-extrabold hover:bg-emerald-700 disabled:opacity-60"
                        >
                            {approveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                            Approve anyway
                        </button>
                    </div>
                </Dialog>
            ) : null}
        </main>
    )
}

function Row({
    label,
    value,
    color,
    bold,
    huge,
}: {
    label: string
    value: string
    color?: string
    bold?: boolean
    huge?: boolean
}) {
    return (
        <div className="flex items-center justify-between">
            <span
                className={cn(
                    "text-[11px] font-bold uppercase tracking-wider",
                    bold ? "text-slate-800" : "text-slate-500",
                )}
            >
                {label}
            </span>
            <span
                className={cn(
                    "font-mono",
                    huge ? "text-lg font-extrabold text-slate-900" : bold ? "text-sm font-extrabold text-slate-900" : "text-sm font-bold text-slate-700",
                    color,
                )}
            >
                {value}
            </span>
        </div>
    )
}

function TimelineRow({
    label,
    at,
    actor,
    note,
    dot,
}: {
    label: string
    at: string
    actor?: string
    note?: string
    dot: string
}) {
    let display = at
    try {
        display = new Date(at).toLocaleString()
    } catch {
        /* ignore */
    }
    return (
        <li className="flex items-start gap-2">
            <span className={cn("mt-1.5 h-2 w-2 rounded-full shrink-0", dot)} />
            <div className="min-w-0 flex-1">
                <div className="text-[12px] font-extrabold text-slate-800">{label}</div>
                <div className="text-[10px] font-mono text-slate-500">{display}</div>
                {actor ? <div className="text-[10px] font-bold text-slate-500">{actor}</div> : null}
                {note ? <div className="text-[10px] italic text-slate-500 mt-0.5">{note}</div> : null}
            </div>
        </li>
    )
}

function Dialog({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
    return (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
            <div className="relative w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">{children}</div>
        </div>
    )
}

// ────────────────────────────────────────────────────────────────────────────
// Status-driven banner shown below the hero.
// ────────────────────────────────────────────────────────────────────────────

interface StatusBannerProps {
    quote: QuotationListItem
    drafts: DraftItem[]
    onConvert: () => void
    onClone: () => void
    onSend: () => void
    sendBlockedReason: string | null
}

function StatusBanner({ quote, drafts, onConvert, onClone, onSend, sendBlockedReason }: StatusBannerProps) {
    const fmt = (iso?: string | null) => {
        if (!iso) return "—"
        try {
            return new Date(iso).toLocaleDateString()
        } catch {
            return iso
        }
    }
    let body: { tone: "amber" | "sky" | "emerald" | "rose" | "violet"; icon: React.ReactNode; title: string; subtitle?: string; action?: React.ReactNode } = {
        tone: "sky",
        icon: <Info className="h-4 w-4" />,
        title: "Quotation ready",
    }
    if (quote.status === "DRAFT" && drafts.length === 0) {
        body = {
            tone: "amber",
            icon: <AlertTriangle className="h-4 w-4" />,
            title: "Empty quotation",
            subtitle: "Add at least one line to proceed.",
        }
    } else if (quote.status === "DRAFT" && drafts.length > 0) {
        body = {
            tone: "sky",
            icon: <Info className="h-4 w-4" />,
            title: "Draft ready",
            subtitle: "Review the lines and Send to customer when ready.",
            action: (
                <button
                    onClick={onSend}
                    disabled={Boolean(sendBlockedReason)}
                    title={sendBlockedReason || undefined}
                    className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg bg-sky-600 text-white text-[12px] font-extrabold hover:bg-sky-700 disabled:opacity-60"
                >
                    <Send className="h-3.5 w-3.5" /> Send
                </button>
            ),
        }
    } else if (quote.status === "SENT") {
        body = {
            tone: "sky",
            icon: <Send className="h-4 w-4" />,
            title: `Sent on ${fmt(quote.sent_at)}`,
            subtitle: "Waiting for customer response.",
        }
    } else if (quote.status === "APPROVED") {
        body = {
            tone: "emerald",
            icon: <CheckCircle2 className="h-4 w-4" />,
            title: `Customer approved on ${fmt(quote.approved_at)}`,
            subtitle: "Convert to a Sales Order to start production.",
            action: (
                <button
                    onClick={onConvert}
                    className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 text-white text-[12px] font-extrabold hover:bg-emerald-800"
                >
                    Convert <ArrowRight className="h-3.5 w-3.5" />
                </button>
            ),
        }
    } else if (quote.status === "REJECTED") {
        body = {
            tone: "rose",
            icon: <XCircle className="h-4 w-4" />,
            title: "Rejected",
            subtitle: quote.rejection_reason ? `Reason: ${quote.rejection_reason}. Clone to revise.` : "Clone to revise.",
            action: (
                <button
                    onClick={onClone}
                    className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg bg-rose-700 text-white text-[12px] font-extrabold hover:bg-rose-800"
                >
                    <Copy className="h-3.5 w-3.5" /> Clone
                </button>
            ),
        }
    } else if (quote.status === "EXPIRED") {
        body = {
            tone: "amber",
            icon: <Clock className="h-4 w-4" />,
            title: `Validity ended on ${fmt(quote.valid_until)}`,
            subtitle: "Clone or extend validity.",
            action: (
                <button
                    onClick={onClone}
                    className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg bg-amber-700 text-white text-[12px] font-extrabold hover:bg-amber-800"
                >
                    <Copy className="h-3.5 w-3.5" /> Clone
                </button>
            ),
        }
    } else if (quote.status === "CONVERTED") {
        body = {
            tone: "violet",
            icon: <Truck className="h-4 w-4" />,
            title: `Converted to ${quote.converted_sales_order_number || "SO"}`,
            subtitle: `On ${fmt(quote.updated_at)}.`,
            action: quote.converted_sales_order ? (
                <Link
                    href={`/sales/orders/${quote.converted_sales_order}`}
                    className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg bg-violet-700 text-white text-[12px] font-extrabold hover:bg-violet-800"
                >
                    Open SO <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
            ) : undefined,
        }
    }
    const toneClasses: Record<typeof body.tone, string> = {
        amber: "bg-amber-50 text-amber-900 ring-amber-200",
        sky: "bg-sky-50 text-sky-900 ring-sky-200",
        emerald: "bg-emerald-50 text-emerald-900 ring-emerald-200",
        rose: "bg-rose-50 text-rose-900 ring-rose-200",
        violet: "bg-violet-50 text-violet-900 ring-violet-200",
    }
    const dotClasses: Record<typeof body.tone, string> = {
        amber: "bg-amber-500",
        sky: "bg-sky-500",
        emerald: "bg-emerald-500",
        rose: "bg-rose-500",
        violet: "bg-violet-500",
    }
    return (
        <section
            className={cn(
                "rounded-2xl ring-1 p-4 flex items-start gap-3 shadow-[0_18px_42px_-34px_rgba(15,23,42,0.32)]",
                toneClasses[body.tone],
            )}
        >
            <span className={cn("h-7 w-7 inline-flex items-center justify-center rounded-full text-white shrink-0", dotClasses[body.tone])}>
                {body.icon}
            </span>
            <div className="flex-1 min-w-0">
                <div className="text-sm font-extrabold">{body.title}</div>
                {body.subtitle ? <div className="text-[12px] font-semibold opacity-90 mt-0.5">{body.subtitle}</div> : null}
            </div>
            {body.action ? <div>{body.action}</div> : null}
        </section>
    )
}

// ────────────────────────────────────────────────────────────────────────────
// "Saved Xs ago" helper.
// ────────────────────────────────────────────────────────────────────────────

function savedAgo(ts: number, _tick: number): string {
    const secs = Math.max(0, Math.floor((Date.now() - ts) / 1000))
    if (secs < 5) return "just now"
    if (secs < 60) return `${secs}s ago`
    const mins = Math.floor(secs / 60)
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    return `${hrs}h ago`
}

// ────────────────────────────────────────────────────────────────────────────
// New-quote onboarding card.
// ────────────────────────────────────────────────────────────────────────────

interface NewQuotationOnboardingProps {
    onPick: (customer: CustomerSummary, repeatFromId?: string) => void
    creating: boolean
}

function NewQuotationOnboarding({ onPick, creating }: NewQuotationOnboardingProps) {
    const [search, setSearch] = useState("")
    const [selected, setSelected] = useState<CustomerSummary | null>(null)
    const customersQuery = useQuery({
        queryKey: ["sales", "customers", "list"],
        queryFn: () => quotationService.listCustomers({ page_size: 200 }),
    })
    const customers = customersQuery.data || []
    const filtered = useMemo(() => {
        const t = search.trim().toLowerCase()
        if (!t) return customers.slice(0, 20)
        return customers.filter((c) => `${c.name} ${c.code}`.toLowerCase().includes(t)).slice(0, 20)
    }, [customers, search])

    // Recent customers — last 5 the user has interacted with via quotes.
    const recentQuotesQuery = useQuery({
        queryKey: ["quotations", "list", "recent"],
        queryFn: () => quotationService.list({ page_size: 25 }),
    })
    const recents = useMemo(() => {
        const seen = new Set<string>()
        const out: { id: string; name: string }[] = []
        for (const q of recentQuotesQuery.data || []) {
            const cid = q.customer || `name:${q.customer_name}`
            if (!cid || seen.has(cid)) continue
            seen.add(cid)
            out.push({ id: cid, name: q.customer_name })
            if (out.length >= 5) break
        }
        return out
    }, [recentQuotesQuery.data])

    // Customer's last quote — for "repeat last quote" hint.
    const lastQuoteQuery = useQuery({
        queryKey: ["quotations", "list", "for-customer", selected?.id],
        queryFn: () => quotationService.listCustomerQuotes(selected!.id, { limit: 1 }),
        enabled: Boolean(selected?.id),
    })
    const lastQuote = lastQuoteQuery.data && lastQuoteQuery.data.length > 0 ? lastQuoteQuery.data[0] : null

    return (
        <main className="mx-auto max-w-[920px] px-5 py-10 lg:px-8 lg:py-12">
            <div className="rounded-[28px] bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 p-1 shadow-[0_40px_80px_-40px_rgba(79,70,229,0.6)]">
                <div className="rounded-[26px] bg-white px-6 py-8 lg:px-10 lg:py-12">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                        <div>
                            <div className="text-[11px] font-extrabold uppercase tracking-[.22em] text-indigo-600 inline-flex items-center gap-2">
                                <Sparkles className="h-3.5 w-3.5" />
                                New quotation
                            </div>
                            <h1 className="mt-2 text-2xl lg:text-3xl font-extrabold tracking-tight text-slate-900">
                                Start a new quotation
                            </h1>
                            <p className="mt-1 text-sm font-semibold text-slate-500">
                                Pick a customer to begin. Their pricing rules and credit profile load automatically.
                            </p>
                        </div>
                        <Link
                            href="/sales/quotations"
                            className="h-10 px-3 inline-flex items-center gap-1.5 rounded-lg text-slate-500 hover:bg-slate-100 font-bold text-sm"
                        >
                            <ArrowLeft className="h-4 w-4" /> Quotations
                        </Link>
                    </div>

                    {/* Customer combobox */}
                    <div className="mt-6">
                        <label className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500">
                            Customer
                        </label>
                        <div className="mt-1 flex items-center gap-2 h-12 rounded-xl border-2 border-indigo-200 focus-within:border-indigo-500 px-3 bg-white">
                            <Search className="h-4 w-4 text-slate-400" />
                            <input
                                autoFocus
                                value={search}
                                onChange={(e) => {
                                    setSearch(e.target.value)
                                    setSelected(null)
                                }}
                                placeholder="Search customer by name or code…"
                                className="flex-1 bg-transparent outline-none text-sm font-semibold text-slate-900"
                            />
                            {customersQuery.isLoading ? <Loader2 className="h-4 w-4 animate-spin text-indigo-500" /> : null}
                        </div>

                        {customersQuery.isError ? (
                            <div className="mt-3 rounded-lg bg-rose-50 ring-1 ring-rose-200 p-3 text-[12px] font-bold text-rose-700 flex items-center justify-between">
                                Couldn&apos;t load customers.
                                <button
                                    onClick={() => customersQuery.refetch()}
                                    className="text-rose-700 underline font-extrabold"
                                >
                                    Retry
                                </button>
                            </div>
                        ) : !customersQuery.isLoading && customers.length === 0 ? (
                            <div className="mt-3 rounded-lg bg-amber-50 ring-1 ring-amber-200 p-4 text-[12px] font-bold text-amber-800">
                                No customers in the system yet.
                                <Link href="/sales/customers/new" className="ml-2 underline">
                                    Add a customer
                                </Link>{" "}
                                first to start quoting.
                            </div>
                        ) : (
                            <div className="mt-2 max-h-72 overflow-y-auto rounded-xl ring-1 ring-slate-200 bg-slate-50">
                                {filtered.length === 0 ? (
                                    <div className="p-4 text-[12px] font-bold text-slate-400">No matches.</div>
                                ) : (
                                    filtered.map((c) => (
                                        <button
                                            key={c.id}
                                            onClick={() => {
                                                setSelected(c)
                                                setSearch(c.name)
                                            }}
                                            className={cn(
                                                "w-full text-left flex items-center gap-3 px-3 py-2.5 hover:bg-indigo-50 border-b border-slate-100 last:border-b-0",
                                                selected?.id === c.id && "bg-indigo-50",
                                            )}
                                        >
                                            <Users className="h-4 w-4 text-indigo-500 shrink-0" />
                                            <div className="flex-1 min-w-0">
                                                <div className="text-sm font-extrabold text-slate-900 truncate">{c.name}</div>
                                                <div className="text-[11px] font-mono text-slate-500">{c.code}</div>
                                            </div>
                                            {selected?.id === c.id ? (
                                                <CheckCircle2 className="h-4 w-4 text-indigo-600 shrink-0" />
                                            ) : null}
                                        </button>
                                    ))
                                )}
                            </div>
                        )}

                        {/* Recent customers chips */}
                        {recents.length > 0 && !selected ? (
                            <div className="mt-4">
                                <div className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500">
                                    Or pick from recent customers
                                </div>
                                <div className="mt-1.5 flex flex-wrap gap-1.5">
                                    {recents.map((r) => (
                                        <button
                                            key={r.id}
                                            onClick={() => {
                                                const match = customers.find((c) => c.id === r.id || c.name === r.name)
                                                if (match) {
                                                    setSelected(match)
                                                    setSearch(match.name)
                                                }
                                            }}
                                            className="h-8 px-3 rounded-full text-[11px] font-extrabold uppercase tracking-wider bg-indigo-50 text-indigo-700 ring-1 ring-indigo-200 hover:bg-indigo-100"
                                        >
                                            {r.name}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ) : null}

                        {/* Last quote callout */}
                        {selected && lastQuote ? (
                            <div className="mt-4 rounded-xl bg-emerald-50 ring-1 ring-emerald-200 p-3 flex items-center justify-between gap-2 flex-wrap">
                                <div className="text-[12px] text-emerald-900 font-bold">
                                    Repeat last quote:{" "}
                                    <span className="font-mono font-extrabold">{lastQuote.quote_number}</span>
                                    {lastQuote.items ? ` · ${lastQuote.items.length} lines` : ""}
                                </div>
                                <button
                                    onClick={() => onPick(selected, lastQuote.id)}
                                    disabled={creating}
                                    className="h-8 px-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-700 text-white text-[11px] font-extrabold uppercase tracking-wider hover:bg-emerald-800 disabled:opacity-60"
                                >
                                    <Copy className="h-3 w-3" /> Clone
                                </button>
                            </div>
                        ) : null}
                    </div>

                    {/* Primary action */}
                    <div className="mt-8 flex items-center justify-end gap-2">
                        <Link
                            href="/sales/quotations"
                            className="h-11 px-4 rounded-xl text-slate-500 hover:bg-slate-100 font-bold text-sm"
                        >
                            Cancel
                        </Link>
                        <button
                            onClick={() => selected && onPick(selected)}
                            disabled={!selected || creating}
                            className="h-11 px-5 inline-flex items-center gap-2 rounded-xl bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 text-white font-extrabold text-sm shadow-md hover:opacity-95 disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                            Start quotation
                        </button>
                    </div>
                </div>
            </div>
        </main>
    )
}

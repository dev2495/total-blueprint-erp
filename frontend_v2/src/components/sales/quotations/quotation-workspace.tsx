"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
    ArrowUpRight,
    BadgeIndianRupee,
    Calculator,
    CheckCircle2,
    CircleDot,
    Copy,
    FileText,
    Layers3,
    Loader2,
    Package,
    Plus,
    RefreshCw,
    Save,
    Sparkles,
    Trash2,
    Waves,
} from "lucide-react"

import { PageHeader } from "@/components/ui-custom/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { costingService } from "@/services/costing"
import { factoryService } from "@/services/factory"
import { filmFamilyService } from "@/services/film-families"
import { filmVariantService } from "@/services/film-variants"
import { masterDataService } from "@/services/master-data"
import {
    type Quotation,
    type QuotationCommercialSnapshot,
    type QuotationLinePayload,
    type QuotationPreview,
    type QuotationProcessRow,
    salesService,
} from "@/services/sales"
import { templateService } from "@/services/templates"

type AdjustmentDraft = {
    localId: string
    name: string
    value: number
    impact: "WIDTH" | "HEIGHT" | "BOTH"
}

type LayerDraft = {
    localId: string
    family_id: string
    variant_id: string
    thickness_micron: number
    roll_width_mm: number
}

type AddonDraft = {
    localId: string
    addon_id: string
    qty: number
    applies_to: "WIDTH" | "HEIGHT" | "NONE" | "PER_PIECE" | "FIXED"
}

type LineDraft = {
    localId: string
    template_id: string
    line_name: string
    finished_good_type: "POUCH" | "ROLL"
    roll_form: "FLAT" | "FOLDED" | "TUBING" | ""
    qty_value: number
    qty_uom: "PCS" | "KG"
    price_basis: "PCS" | "KG"
    geometry: {
        base: {
            width_mm: number
            height_mm: number
        }
        adjustments: AdjustmentDraft[]
        multipliers: {
            faces: number
        }
    }
    film_layers: LayerDraft[]
    printing: {
        enabled: boolean
        type: "FLEXO" | "ROTO" | "DIGITAL"
        substrate_mode: "SHEET" | "TUBING"
        front_colors_count: number
        back_colors_count: number
        ink_gsm_total: number
    }
    chemicals: {
        adhesive_gsm: number
        solvent_gsm: number
    }
    addons: AddonDraft[]
    packaging_snapshot: {
        pod: {
            enabled: boolean
            pod_profile_id: string
        }
        note: string
    }
    process_cost_rows: QuotationProcessRow[]
    commercial_snapshot: QuotationCommercialSnapshot
    savedPreview?: QuotationPreview | null
}

type QuoteDraft = {
    id?: string
    quote_number?: string
    customer: string
    customer_name: string
    plant: string
    status: Quotation["status"]
    valid_until: string
    currency: string
    terms: string
    notes: string
    items: LineDraft[]
    totals_snapshot?: Quotation["totals_snapshot"]
    converted_sales_order?: string | null
    converted_sales_order_number?: string | null
}

function makeId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
        return crypto.randomUUID()
    }
    return `tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function makeAdjustment(): AdjustmentDraft {
    return { localId: makeId(), name: "Seal", value: 0, impact: "WIDTH" }
}

function makeLayer(): LayerDraft {
    return { localId: makeId(), family_id: "", variant_id: "", thickness_micron: 0, roll_width_mm: 0 }
}

function makeAddon(): AddonDraft {
    return { localId: makeId(), addon_id: "", qty: 1, applies_to: "PER_PIECE" }
}

function makeProcessRow(): QuotationProcessRow {
    return { sequence: 1, process_id: "", setup_hours: 0, run_hours: 0, hourly_rate: 0, notes: "" }
}

function emptyLineDraft(): LineDraft {
    return {
        localId: makeId(),
        template_id: "",
        line_name: "New line",
        finished_good_type: "POUCH",
        roll_form: "",
        qty_value: 1000,
        qty_uom: "PCS",
        price_basis: "PCS",
        geometry: {
            base: { width_mm: 120, height_mm: 180 },
            adjustments: [],
            multipliers: { faces: 1 },
        },
        film_layers: [makeLayer()],
        printing: {
            enabled: false,
            type: "FLEXO",
            substrate_mode: "SHEET",
            front_colors_count: 0,
            back_colors_count: 0,
            ink_gsm_total: 0,
        },
        chemicals: { adhesive_gsm: 0, solvent_gsm: 0 },
        addons: [],
        packaging_snapshot: { pod: { enabled: false, pod_profile_id: "" }, note: "" },
        process_cost_rows: [],
        commercial_snapshot: {
            margin_target_percent: 15,
            tax_percent: 18,
            packing_value: 0,
            freight_value: 0,
            misc_value: 0,
            discount_percent: 0,
            discount_value: 0,
            wastage_percent: 0,
            manual_unit_price: 0,
            manual_line_total: 0,
        },
    }
}

function emptyQuoteDraft(): QuoteDraft {
    const firstLine = emptyLineDraft()
    return {
        customer: "",
        customer_name: "",
        plant: "",
        status: "DRAFT",
        valid_until: new Date().toISOString().slice(0, 10),
        currency: "INR",
        terms: "Freight extra. Taxes as applicable.",
        notes: "",
        items: [firstLine],
    }
}

function asNumber(value: unknown, fallback = 0) {
    const num = Number(value)
    return Number.isFinite(num) ? num : fallback
}

function formatMoney(value: number | undefined, currency = "INR") {
    const amount = Number(value || 0)
    const prefix = currency === "INR" ? "₹" : `${currency} `
    return `${prefix}${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function statusTone(status: string) {
    const normalized = String(status || "").toUpperCase()
    if (normalized === "APPROVED" || normalized === "CONVERTED") return "bg-emerald-50 text-emerald-700 border-emerald-200"
    if (normalized === "REJECTED" || normalized === "EXPIRED") return "bg-rose-50 text-rose-700 border-rose-200"
    if (normalized === "SENT") return "bg-indigo-50 text-indigo-700 border-indigo-200"
    return "bg-amber-50 text-amber-700 border-amber-200"
}

function mapQuotationToDraft(quotation: Quotation): QuoteDraft {
    return {
        id: quotation.id,
        quote_number: quotation.quote_number,
        customer: quotation.customer || "",
        customer_name: quotation.customer_name || "",
        plant: quotation.plant || "",
        status: quotation.status,
        valid_until: quotation.valid_until || new Date().toISOString().slice(0, 10),
        currency: quotation.currency || "INR",
        terms: quotation.terms || "",
        notes: quotation.notes || "",
        items: (quotation.items || []).map((item) => ({
            localId: item.id,
            template_id: item.template || "",
            line_name: item.line_name || item.template_name || "Quote line",
            finished_good_type: item.finished_good_type,
            roll_form: (item.roll_form || "") as LineDraft["roll_form"],
            qty_value: asNumber(item.qty_value, 0),
            qty_uom: item.qty_uom,
            price_basis: item.price_basis,
            geometry: {
                base: {
                    width_mm: asNumber(item.geometry_snapshot?.base?.width_mm || item.geometry_snapshot?.width_mm, 0),
                    height_mm: asNumber(item.geometry_snapshot?.base?.height_mm || item.geometry_snapshot?.height_mm, 0),
                },
                adjustments: Array.isArray(item.geometry_snapshot?.adjustments)
                    ? item.geometry_snapshot.adjustments.map((adjustment: any) => ({
                        localId: makeId(),
                        name: String(adjustment?.name || "Adjustment"),
                        value: asNumber(adjustment?.value, 0),
                        impact: (String(adjustment?.impact || "WIDTH").toUpperCase() as AdjustmentDraft["impact"]),
                    }))
                    : [],
                multipliers: {
                    faces: asNumber(item.geometry_snapshot?.multipliers?.faces, 1),
                },
            },
            film_layers: Array.isArray(item.layer_snapshot)
                ? item.layer_snapshot.map((layer: any) => ({
                    localId: makeId(),
                    family_id: String(layer?.family_id || ""),
                    variant_id: String(layer?.variant_id || ""),
                    thickness_micron: asNumber(layer?.thickness_micron, 0),
                    roll_width_mm: asNumber(layer?.roll_width_mm || layer?.width_mm, 0),
                }))
                : [makeLayer()],
            printing: {
                enabled: Boolean(item.printing_snapshot?.enabled),
                type: (String(item.printing_snapshot?.type || "FLEXO").toUpperCase() as LineDraft["printing"]["type"]),
                substrate_mode: (String(item.printing_snapshot?.substrate_mode || "SHEET").toUpperCase() as LineDraft["printing"]["substrate_mode"]),
                front_colors_count: asNumber(item.printing_snapshot?.front_colors_count, 0),
                back_colors_count: asNumber(item.printing_snapshot?.back_colors_count, 0),
                ink_gsm_total: asNumber(item.printing_snapshot?.ink_gsm_total, 0),
            },
            chemicals: {
                adhesive_gsm: asNumber(item.chemicals_snapshot?.adhesive_gsm, 0),
                solvent_gsm: asNumber(item.chemicals_snapshot?.solvent_gsm, 0),
            },
            addons: Array.isArray(item.addons_snapshot)
                ? item.addons_snapshot.map((addon: any) => ({
                    localId: makeId(),
                    addon_id: String(addon?.addon_id || ""),
                    qty: asNumber(addon?.qty || addon?.quantity, 1),
                    applies_to: (String(addon?.applies_to || "PER_PIECE").toUpperCase() as AddonDraft["applies_to"]),
                }))
                : [],
            packaging_snapshot: {
                pod: {
                    enabled: Boolean(item.packaging_snapshot?.pod?.enabled),
                    pod_profile_id: String(item.packaging_snapshot?.pod?.pod_profile_id || ""),
                },
                note: String(item.packaging_snapshot?.note || ""),
            },
            process_cost_rows: Array.isArray(item.process_cost_rows) ? item.process_cost_rows : [],
            commercial_snapshot: item.commercial_snapshot || {},
            savedPreview: {
                unit_weight_g: asNumber(item.unit_weight_g, 0),
                total_weight_kg: asNumber(item.total_weight_kg, 0),
                physics: item.physics_snapshot || {},
                roll_preview: item.physics_snapshot?.roll_preview,
                final_product_type: item.finished_good_type,
                bom: item.bom_snapshot || {},
                bom_preview: item.bom_snapshot?.bom_preview || { components: [] },
                costing: item.costing_snapshot,
                process_cost_rows: item.process_cost_rows || [],
                commercial_snapshot: item.commercial_snapshot || {},
                line_name: item.line_name,
                qty_value: asNumber(item.qty_value, 0),
                qty_uom: item.qty_uom,
                price_basis: item.price_basis,
            },
        })),
        totals_snapshot: quotation.totals_snapshot,
        converted_sales_order: quotation.converted_sales_order,
        converted_sales_order_number: quotation.converted_sales_order_number,
    }
}

export default function QuotationWorkspace() {
    const { toast } = useToast()
    const queryClient = useQueryClient()
    const [draft, setDraft] = useState<QuoteDraft>(emptyQuoteDraft())
    const [activeLineId, setActiveLineId] = useState<string>(draft.items[0].localId)
    const [activePreview, setActivePreview] = useState<QuotationPreview | null>(null)
    const [previewError, setPreviewError] = useState<string>("")

    const { data: quotations = [], isLoading: quotationsLoading } = useQuery({
        queryKey: ["sales-quotations"],
        queryFn: salesService.getQuotations,
    })
    const { data: customers = [] } = useQuery({ queryKey: ["customers"], queryFn: masterDataService.getCustomers })
    const { data: plants = [] } = useQuery({ queryKey: ["plants"], queryFn: factoryService.getPlants })
    const { data: templates = [] } = useQuery({ queryKey: ["quote-templates"], queryFn: () => templateService.getTemplates({ status: "LIVE" }) })
    const { data: families = [] } = useQuery({ queryKey: ["quote-families"], queryFn: filmFamilyService.getAll })
    const { data: variants = [] } = useQuery({ queryKey: ["quote-variants"], queryFn: filmVariantService.getAll })
    const { data: addons = [] } = useQuery({ queryKey: ["quote-addons"], queryFn: masterDataService.getAddons })
    const { data: podProfiles = [] } = useQuery({ queryKey: ["pod-profiles"], queryFn: masterDataService.getPODMaterials })
    const { data: processes = [] } = useQuery({ queryKey: ["quote-processes"], queryFn: factoryService.getProcesses })
    const { data: processRates = [] } = useQuery({ queryKey: ["quote-process-rates"], queryFn: costingService.getProcessRates })

    const activeLine = draft.items.find((item) => item.localId === activeLineId) || draft.items[0] || null

    useEffect(() => {
        if (!activeLine) {
            setActivePreview(null)
            return
        }
        const handle = window.setTimeout(async () => {
            try {
                setPreviewError("")
                const preview = await salesService.previewQuotationLine(buildLinePayload(activeLine, families, variants))
                setActivePreview(preview)
                if ((!activeLine.process_cost_rows || activeLine.process_cost_rows.length === 0) && preview.process_cost_rows?.length) {
                    setDraft((current) => ({
                        ...current,
                        items: current.items.map((item) =>
                            item.localId === activeLine.localId
                                ? { ...item, process_cost_rows: preview.process_cost_rows }
                                : item
                        ),
                    }))
                }
            } catch (error: any) {
                setPreviewError(error?.response?.data?.detail || error?.message || "Unable to calculate this line.")
            }
        }, 450)
        return () => window.clearTimeout(handle)
    }, [activeLine, families, variants])

    const saveMutation = useMutation({
        mutationFn: async () => {
            const payload = {
                customer: draft.customer || null,
                customer_name: draft.customer_name,
                plant: draft.plant || null,
                status: draft.status,
                valid_until: draft.valid_until || null,
                currency: draft.currency,
                terms: draft.terms,
                notes: draft.notes,
                items: draft.items.map((item) => buildLinePayload(item, families, variants)),
            }
            return draft.id
                ? salesService.updateQuotation(draft.id, payload)
                : salesService.createQuotation(payload)
        },
        onSuccess: (quotation) => {
            queryClient.invalidateQueries({ queryKey: ["sales-quotations"] })
            const mapped = mapQuotationToDraft(quotation)
            setDraft(mapped)
            setActiveLineId(mapped.items[0]?.localId || "")
            toast({
                title: draft.id ? "Quotation updated" : "Quotation saved",
                description: `${quotation.quote_number} is ready for sales use.`,
            })
        },
        onError: (error: any) => {
            toast({
                title: "Save failed",
                description: error?.response?.data?.detail || error?.message || "Unable to save quotation.",
                variant: "destructive",
            })
        },
    })

    const duplicateMutation = useMutation({
        mutationFn: (id: string) => salesService.duplicateQuotation(id),
        onSuccess: (quotation) => {
            queryClient.invalidateQueries({ queryKey: ["sales-quotations"] })
            const mapped = mapQuotationToDraft(quotation)
            setDraft(mapped)
            setActiveLineId(mapped.items[0]?.localId || "")
            toast({ title: "Quotation duplicated", description: `${quotation.quote_number} opened as a fresh draft.` })
        },
        onError: (error: any) => {
            toast({ title: "Duplicate failed", description: error?.response?.data?.detail || error?.message || "Unable to duplicate.", variant: "destructive" })
        },
    })

    const convertMutation = useMutation({
        mutationFn: (id: string) => salesService.convertQuotationToOrder(id),
        onSuccess: (result) => {
            queryClient.invalidateQueries({ queryKey: ["sales-quotations"] })
            toast({
                title: "Converted to sales order",
                description: `${result.sales_order_number} created from ${result.quotation_number}.`,
            })
            window.open(`/sales/orders/${result.sales_order_id}`, "_blank", "noopener,noreferrer")
        },
        onError: (error: any) => {
            const detail = error?.response?.data?.detail
            toast({
                title: "Conversion blocked",
                description: typeof detail === "string" ? detail : JSON.stringify(detail || "Template mapping is incomplete."),
                variant: "destructive",
            })
        },
    })

    const openNewQuote = () => {
        const fresh = emptyQuoteDraft()
        setDraft(fresh)
        setActiveLineId(fresh.items[0].localId)
        setActivePreview(null)
        setPreviewError("")
    }

    const loadQuotation = (quotation: Quotation) => {
        const mapped = mapQuotationToDraft(quotation)
        setDraft(mapped)
        setActiveLineId(mapped.items[0]?.localId || "")
        setActivePreview(mapped.items[0]?.savedPreview || null)
        setPreviewError("")
    }

    const updateDraft = (patch: Partial<QuoteDraft>) => {
        setDraft((current) => ({ ...current, ...patch }))
    }

    const updateLine = (lineId: string, updater: (line: LineDraft) => LineDraft) => {
        setDraft((current) => ({
            ...current,
            items: current.items.map((line) => (line.localId === lineId ? updater(line) : line)),
        }))
    }

    const addLine = () => {
        const line = emptyLineDraft()
        setDraft((current) => ({ ...current, items: [...current.items, line] }))
        setActiveLineId(line.localId)
    }

    const duplicateLine = (lineId: string) => {
        const source = draft.items.find((line) => line.localId === lineId)
        if (!source) return
        const clone: LineDraft = {
            ...source,
            localId: makeId(),
            line_name: `${source.line_name} Copy`,
            geometry: {
                ...source.geometry,
                adjustments: source.geometry.adjustments.map((adjustment) => ({ ...adjustment, localId: makeId() })),
            },
            film_layers: source.film_layers.map((layer) => ({ ...layer, localId: makeId() })),
            addons: source.addons.map((addon) => ({ ...addon, localId: makeId() })),
            process_cost_rows: source.process_cost_rows.map((row, index) => ({ ...row, sequence: index + 1 })),
        }
        setDraft((current) => ({ ...current, items: [...current.items, clone] }))
        setActiveLineId(clone.localId)
    }

    const removeLine = (lineId: string) => {
        if (draft.items.length === 1) return
        const remaining = draft.items.filter((line) => line.localId !== lineId)
        setDraft((current) => ({ ...current, items: remaining }))
        if (activeLineId === lineId) {
            setActiveLineId(remaining[0]?.localId || "")
        }
    }

    const onCustomerChange = (customerId: string) => {
        const customer = customers.find((row) => row.id === customerId)
        updateDraft({ customer: customerId, customer_name: customer?.name || "" })
    }

    const onProcessSelect = (lineId: string, rowIndex: number, processId: string) => {
        const process = processes.find((entry) => entry.id === processId)
        const rate = processRates.find((entry) => entry.process === processId)
        updateLine(lineId, (line) => ({
            ...line,
            process_cost_rows: line.process_cost_rows.map((row, index) =>
                index === rowIndex
                    ? {
                        ...row,
                        process_id: processId,
                        process_code: process?.code,
                        process_name: process?.name,
                        rate_id: rate?.id || null,
                        hourly_rate: asNumber(rate?.cost_per_hour, 0),
                    }
                    : row
            ),
        }))
    }

    const metrics = {
        open: quotations.filter((quote) => ["DRAFT", "SENT"].includes(quote.status)).length,
        converted: quotations.filter((quote) => quote.status === "CONVERTED").length,
        value: quotations.reduce((sum, quote) => sum + Number(quote.totals_snapshot?.grand_total || 0), 0),
        avgMargin: quotations.length
            ? quotations.reduce((sum, quote) => sum + Number(quote.totals_snapshot?.margin_percent || 0), 0) / quotations.length
            : 0,
    }

    const summaryTotals = draft.totals_snapshot || {
        grand_total: activePreview?.costing?.grand_total || 0,
        subtotal: activePreview?.costing?.net_total || 0,
        tax_total: activePreview?.costing?.tax_value || 0,
        margin_percent: activePreview?.costing?.margin_percent || 0,
    }

    return (
        <div className="min-h-screen bg-premium-mesh p-4 md:p-8" data-testid="quotation-workspace">
            <div className="mx-auto max-w-[1600px] space-y-8">
                <PageHeader
                    title="Sales Quotations"
                    description="Multi-line commercial quoting for pouch and roll products, backed by live physics, BOM, and costing."
                    actions={
                        <>
                            <Button variant="outline" className="rounded-2xl" onClick={openNewQuote}>
                                <Plus className="mr-2 h-4 w-4" /> New Quote
                            </Button>
                            <Button
                                className="rounded-2xl bg-slate-900 hover:bg-slate-800"
                                data-testid="quotation-save"
                                onClick={() => saveMutation.mutate()}
                                disabled={saveMutation.isPending}
                            >
                                {saveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                                Save Quote
                            </Button>
                        </>
                    }
                />

                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <MetricCard label="Open Quotations" value={String(metrics.open)} note="Draft or sent" icon={<FileText className="h-4 w-4" />} />
                    <MetricCard label="Converted" value={String(metrics.converted)} note="Turned into orders" icon={<CheckCircle2 className="h-4 w-4" />} />
                    <MetricCard label="Commercial Value" value={formatMoney(metrics.value, draft.currency)} note="Saved grand totals" icon={<BadgeIndianRupee className="h-4 w-4" />} />
                    <MetricCard label="Avg Margin" value={`${metrics.avgMargin.toFixed(1)}%`} note="Across saved quotes" icon={<Sparkles className="h-4 w-4" />} />
                </div>

                <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_420px]">
                    <div className="space-y-6">
                        <Card className="overflow-hidden rounded-[2rem] border-0 bg-white/80 shadow-premium backdrop-blur-xl animate-in fade-in duration-700">
                            <CardHeader className="border-b border-slate-100 bg-white/70">
                                <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                                    <div>
                                        <CardTitle className="text-2xl font-black tracking-tight text-slate-900" data-testid="quotation-number">
                                            {draft.quote_number || "Draft quotation workspace"}
                                        </CardTitle>
                                        <CardDescription className="mt-1 text-slate-500">
                                            Load a saved quote, build a fresh one, or convert a validated quote into a sales order.
                                        </CardDescription>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {draft.id ? (
                                            <>
                                                <Button variant="outline" className="rounded-2xl" onClick={() => duplicateMutation.mutate(draft.id!)} disabled={duplicateMutation.isPending}>
                                                    {duplicateMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Copy className="mr-2 h-4 w-4" />}
                                                    Duplicate
                                                </Button>
                                                <Button
                                                    variant="outline"
                                                    className="rounded-2xl"
                                                    data-testid="quotation-open-pdf"
                                                    onClick={() => window.open(salesService.getQuotationPdfUrl(draft.id!), "_blank", "noopener,noreferrer")}
                                                >
                                                    <ArrowUpRight className="mr-2 h-4 w-4" /> Open PDF
                                                </Button>
                                                <Button
                                                    className="rounded-2xl bg-indigo-600 hover:bg-indigo-500"
                                                    onClick={() => convertMutation.mutate(draft.id!)}
                                                    disabled={convertMutation.isPending}
                                                >
                                                    {convertMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                                                    Convert To Order
                                                </Button>
                                            </>
                                        ) : null}
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent className="space-y-6 p-6">
                                <div className="grid gap-3 lg:grid-cols-3">
                                    <div className="space-y-1.5">
                                        <Label className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">Customer</Label>
                                        <Select value={draft.customer || "NONE"} onValueChange={(value) => onCustomerChange(value === "NONE" ? "" : value)}>
                                            <SelectTrigger className="h-12 rounded-2xl border-slate-200 bg-white" data-testid="quotation-customer">
                                                <SelectValue placeholder="Select customer" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="NONE">Unlinked customer</SelectItem>
                                                {customers.map((customer) => (
                                                    <SelectItem key={customer.id} value={customer.id}>
                                                        {customer.name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">Plant</Label>
                                        <Select value={draft.plant || "NONE"} onValueChange={(value) => updateDraft({ plant: value === "NONE" ? "" : value })}>
                                            <SelectTrigger className="h-12 rounded-2xl border-slate-200 bg-white" data-testid="quotation-plant">
                                                <SelectValue placeholder="Select plant" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="NONE">No legal plant</SelectItem>
                                                {plants.map((plant) => (
                                                    <SelectItem key={plant.id} value={plant.id}>
                                                        {plant.name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">Status</Label>
                                        <Select value={draft.status} onValueChange={(value) => updateDraft({ status: value as QuoteDraft["status"] })}>
                                            <SelectTrigger className="h-12 rounded-2xl border-slate-200 bg-white">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {["DRAFT", "SENT", "APPROVED", "REJECTED", "EXPIRED", "CONVERTED"].map((status) => (
                                                    <SelectItem key={status} value={status}>
                                                        {status.replaceAll("_", " ")}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>

                                <div className="grid gap-3 lg:grid-cols-4">
                                    <div className="space-y-1.5 lg:col-span-1">
                                        <Label className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">Customer Name Override</Label>
                                        <Input
                                            className="h-12 rounded-2xl border-slate-200 bg-white"
                                            data-testid="quotation-customer-name"
                                            value={draft.customer_name}
                                            onChange={(event) => updateDraft({ customer_name: event.target.value })}
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">Valid Until</Label>
                                        <Input type="date" className="h-12 rounded-2xl border-slate-200 bg-white" value={draft.valid_until} onChange={(event) => updateDraft({ valid_until: event.target.value })} />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">Currency</Label>
                                        <Input className="h-12 rounded-2xl border-slate-200 bg-white uppercase" value={draft.currency} onChange={(event) => updateDraft({ currency: event.target.value.toUpperCase() })} />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">Saved Quote Status</Label>
                                        <div className={`inline-flex h-12 items-center rounded-2xl border px-4 text-sm font-black ${statusTone(draft.status)}`}>
                                            {draft.status.replaceAll("_", " ")}
                                        </div>
                                    </div>
                                </div>

                                <div className="grid gap-3 lg:grid-cols-2">
                                    <div className="space-y-1.5">
                                        <Label className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">Commercial Terms</Label>
                                        <Textarea className="min-h-[120px] rounded-[1.5rem] border-slate-200 bg-white" value={draft.terms} onChange={(event) => updateDraft({ terms: event.target.value })} />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">Internal Notes</Label>
                                        <Textarea className="min-h-[120px] rounded-[1.5rem] border-slate-200 bg-white" value={draft.notes} onChange={(event) => updateDraft({ notes: event.target.value })} />
                                    </div>
                                </div>

                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <p className="text-sm font-black uppercase tracking-[0.2em] text-slate-500">Saved Quotations</p>
                                            <p className="text-sm text-slate-500">Jump between customer-ready commercial documents.</p>
                                        </div>
                                        {quotationsLoading ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : null}
                                    </div>
                                    <ScrollArea className="w-full whitespace-nowrap">
                                        <div className="flex gap-3 pb-2">
                                            {quotations.map((quotation) => (
                                                <button
                                                    key={quotation.id}
                                                    type="button"
                                                    onClick={() => loadQuotation(quotation)}
                                                    className={`w-[260px] rounded-[1.5rem] border p-4 text-left transition-all hover:-translate-y-1 hover:shadow-premium ${draft.id === quotation.id ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-900"
                                                        }`}
                                                >
                                                    <div className="flex items-start justify-between gap-3">
                                                        <div>
                                                            <p className="text-[11px] font-black uppercase tracking-[0.2em] opacity-70">{quotation.quote_number}</p>
                                                            <p className="mt-2 text-base font-black">{quotation.customer_name}</p>
                                                        </div>
                                                        <Badge className={`border ${draft.id === quotation.id ? "border-white/20 bg-white/10 text-white" : statusTone(quotation.status)}`}>
                                                            {quotation.status}
                                                        </Badge>
                                                    </div>
                                                    <div className="mt-4 flex items-end justify-between text-sm">
                                                        <span className="opacity-70">{quotation.items.length} lines</span>
                                                        <span className="font-black">{formatMoney(quotation.totals_snapshot?.grand_total, quotation.currency)}</span>
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    </ScrollArea>
                                </div>
                            </CardContent>
                        </Card>

                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h2 className="text-xl font-black tracking-tight text-slate-900">Quote Lines</h2>
                                    <p className="text-sm text-slate-500">Build a commercial mix of pouch and roll products in one quotation.</p>
                                </div>
                                <Button className="rounded-2xl bg-indigo-600 hover:bg-indigo-500" data-testid="quotation-add-line" onClick={addLine}>
                                    <Plus className="mr-2 h-4 w-4" /> Add Line
                                </Button>
                            </div>

                            {draft.items.map((line, index) => {
                                const isActive = line.localId === activeLineId
                                const familyScopedVariants = variants.filter((variant) => !line.film_layers[0]?.family_id || variant.parent_family === line.film_layers[0]?.family_id)
                                return (
                                    <Card
                                        key={line.localId}
                                        data-testid={`quotation-line-card-${index}`}
                                        className={`overflow-hidden rounded-[2rem] border-0 transition-all duration-300 ${isActive ? "bg-white shadow-2xl shadow-slate-200/70 ring-1 ring-slate-900/10" : "bg-white/80 shadow-premium"
                                            }`}
                                    >
                                        <CardHeader className="border-b border-slate-100">
                                            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                                <div className="space-y-2">
                                                    <div className="flex items-center gap-3">
                                                        <button
                                                            type="button"
                                                            onClick={() => setActiveLineId(line.localId)}
                                                            className={`inline-flex h-9 w-9 items-center justify-center rounded-2xl ${isActive ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500"}`}
                                                        >
                                                            <CircleDot className="h-4 w-4" />
                                                        </button>
                                                        <div>
                                                            <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">Line {index + 1}</p>
                                                            <Input
                                                                className="mt-1 h-11 w-full rounded-2xl border-slate-200 bg-slate-50 text-lg font-black"
                                                                data-testid={`quotation-line-name-${index}`}
                                                                value={line.line_name}
                                                                onFocus={() => setActiveLineId(line.localId)}
                                                                onChange={(event) => updateLine(line.localId, (current) => ({ ...current, line_name: event.target.value }))}
                                                            />
                                                        </div>
                                                    </div>
                                                    <div className="flex flex-wrap gap-2">
                                                        <Badge className={`border ${line.finished_good_type === "POUCH" ? "bg-rose-50 text-rose-700 border-rose-200" : "bg-sky-50 text-sky-700 border-sky-200"}`}>
                                                            {line.finished_good_type}
                                                        </Badge>
                                                        {line.template_id ? (
                                                            <Badge className="border border-indigo-200 bg-indigo-50 text-indigo-700">
                                                                Template seeded
                                                            </Badge>
                                                        ) : (
                                                            <Badge className="border border-slate-200 bg-slate-50 text-slate-600">Freeform</Badge>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="flex flex-wrap gap-2">
                                                    <Button variant="outline" className="rounded-2xl" onClick={() => duplicateLine(line.localId)}>
                                                        <Copy className="mr-2 h-4 w-4" /> Clone
                                                    </Button>
                                                    <Button variant="outline" className="rounded-2xl text-rose-600" onClick={() => removeLine(line.localId)} disabled={draft.items.length === 1}>
                                                        <Trash2 className="mr-2 h-4 w-4" /> Remove
                                                    </Button>
                                                </div>
                                            </div>
                                        </CardHeader>
                                        <CardContent className="p-6">
                                            <Tabs defaultValue="spec" className="space-y-5">
                                                    <TabsList className="grid h-12 grid-cols-3 rounded-2xl bg-slate-100 p-1">
                                                        <TabsTrigger value="spec" className="rounded-2xl font-black" data-testid={`quotation-line-${index}-tab-spec`}>Specification</TabsTrigger>
                                                        <TabsTrigger value="materials" className="rounded-2xl font-black" data-testid={`quotation-line-${index}-tab-materials`}>Materials</TabsTrigger>
                                                        <TabsTrigger value="pricing" className="rounded-2xl font-black" data-testid={`quotation-line-${index}-tab-pricing`}>Pricing</TabsTrigger>
                                                </TabsList>

                                                <TabsContent value="spec" className="space-y-5">
                                                    <div className="grid gap-4 lg:grid-cols-4">
                                                        <div className="space-y-2 lg:col-span-2">
                                                            <Label className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">Product Type</Label>
                                                            <div className="grid grid-cols-2 gap-2">
                                                                {(["POUCH", "ROLL"] as const).map((type) => (
                                                                    <button
                                                                        key={type}
                                                                        type="button"
                                                                        onClick={() =>
                                                                            updateLine(line.localId, (current) => ({
                                                                                ...current,
                                                                                finished_good_type: type,
                                                                                roll_form: type === "ROLL" ? (current.roll_form || "FLAT") : "",
                                                                                qty_uom: type === "ROLL" ? "KG" : current.qty_uom,
                                                                                price_basis: type === "ROLL" ? "KG" : current.price_basis,
                                                                                geometry: {
                                                                                    ...current.geometry,
                                                                                    base: {
                                                                                        ...current.geometry.base,
                                                                                        height_mm: type === "ROLL" ? 0 : current.geometry.base.height_mm,
                                                                                    },
                                                                                },
                                                                            }))
                                                                        }
                                                                        className={`rounded-2xl border px-4 py-4 text-left transition-all ${line.finished_good_type === type ? "border-slate-900 bg-slate-900 text-white shadow-xl" : "border-slate-200 bg-white text-slate-700"
                                                                            }`}
                                                                    >
                                                                        <p className="text-[11px] font-black uppercase tracking-[0.2em]">{type}</p>
                                                                        <p className="mt-2 text-sm opacity-80">{type === "POUCH" ? "Discrete pouch quote" : "KG-authoritative roll quote"}</p>
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        </div>
                                                        <div className="space-y-2">
                                                            <Label className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">Template Seed</Label>
                                                            <Select value={line.template_id || "NONE"} onValueChange={(value) => updateLine(line.localId, (current) => ({ ...current, template_id: value === "NONE" ? "" : value }))}>
                                                                <SelectTrigger className="h-12 rounded-2xl border-slate-200 bg-white">
                                                                    <SelectValue placeholder="Optional template" />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    <SelectItem value="NONE">Freeform line</SelectItem>
                                                                    {templates
                                                                        .filter((template) => template.fg_type === line.finished_good_type)
                                                                        .map((template) => (
                                                                            <SelectItem key={template.id} value={template.id}>
                                                                                {template.name}
                                                                            </SelectItem>
                                                                        ))}
                                                                </SelectContent>
                                                            </Select>
                                                        </div>
                                                        <div className="space-y-2">
                                                            <Label className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">Roll Form</Label>
                                                            <Select
                                                                value={line.finished_good_type === "ROLL" ? (line.roll_form || "FLAT") : "NONE"}
                                                                onValueChange={(value) => updateLine(line.localId, (current) => ({ ...current, roll_form: value as LineDraft["roll_form"] }))}
                                                                disabled={line.finished_good_type !== "ROLL"}
                                                            >
                                                                <SelectTrigger className="h-12 rounded-2xl border-slate-200 bg-white">
                                                                    <SelectValue />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    {line.finished_good_type !== "ROLL" ? <SelectItem value="NONE">Not applicable</SelectItem> : null}
                                                                    <SelectItem value="FLAT">Flat</SelectItem>
                                                                    <SelectItem value="FOLDED">Folded</SelectItem>
                                                                    <SelectItem value="TUBING">Tubing</SelectItem>
                                                                </SelectContent>
                                                            </Select>
                                                        </div>
                                                    </div>

                                                    <div className="grid gap-4 lg:grid-cols-4">
                                                        <FieldNumber label="Width (mm)" value={line.geometry.base.width_mm} onChange={(value) => updateLine(line.localId, (current) => ({ ...current, geometry: { ...current.geometry, base: { ...current.geometry.base, width_mm: value } } }))} />
                                                        <FieldNumber label="Height (mm)" value={line.geometry.base.height_mm} disabled={line.finished_good_type === "ROLL"} onChange={(value) => updateLine(line.localId, (current) => ({ ...current, geometry: { ...current.geometry, base: { ...current.geometry.base, height_mm: value } } }))} />
                                                        <FieldNumber label="Quantity" value={line.qty_value} onChange={(value) => updateLine(line.localId, (current) => ({ ...current, qty_value: value }))} />
                                                        <div className="grid grid-cols-2 gap-3">
                                                            <div className="space-y-2">
                                                                <Label className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">Qty UOM</Label>
                                                                <Select value={line.qty_uom} onValueChange={(value) => updateLine(line.localId, (current) => ({ ...current, qty_uom: value as LineDraft["qty_uom"] }))} disabled={line.finished_good_type === "ROLL"}>
                                                                    <SelectTrigger className="h-12 rounded-2xl border-slate-200 bg-white">
                                                                        <SelectValue />
                                                                    </SelectTrigger>
                                                                    <SelectContent>
                                                                        <SelectItem value="PCS">PCS</SelectItem>
                                                                        <SelectItem value="KG">KG</SelectItem>
                                                                    </SelectContent>
                                                                </Select>
                                                            </div>
                                                            <div className="space-y-2">
                                                                <Label className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">Price Basis</Label>
                                                                <Select value={line.price_basis} onValueChange={(value) => updateLine(line.localId, (current) => ({ ...current, price_basis: value as LineDraft["price_basis"] }))} disabled={line.finished_good_type === "ROLL"}>
                                                                    <SelectTrigger className="h-12 rounded-2xl border-slate-200 bg-white">
                                                                        <SelectValue />
                                                                    </SelectTrigger>
                                                                    <SelectContent>
                                                                        <SelectItem value="PCS">PCS</SelectItem>
                                                                        <SelectItem value="KG">KG</SelectItem>
                                                                    </SelectContent>
                                                                </Select>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    <Card className="rounded-[1.5rem] border border-slate-200 bg-slate-50/60 shadow-none">
                                                        <CardHeader className="pb-3">
                                                            <CardTitle className="text-base font-black text-slate-800">Geometry Adjustments</CardTitle>
                                                            <CardDescription>Seal allowances, fold take-up, or width/height modifiers for quick technical estimation.</CardDescription>
                                                        </CardHeader>
                                                        <CardContent className="space-y-3">
                                                            {line.geometry.adjustments.map((adjustment, adjustmentIndex) => (
                                                                <div key={adjustment.localId} className="grid gap-3 rounded-2xl bg-white p-3 md:grid-cols-[1.4fr_120px_140px_auto]">
                                                                    <Input value={adjustment.name} onChange={(event) => updateLine(line.localId, (current) => ({
                                                                        ...current,
                                                                        geometry: {
                                                                            ...current.geometry,
                                                                            adjustments: current.geometry.adjustments.map((row, idx) => idx === adjustmentIndex ? { ...row, name: event.target.value } : row),
                                                                        },
                                                                    }))} />
                                                                    <Input type="number" value={adjustment.value} onChange={(event) => updateLine(line.localId, (current) => ({
                                                                        ...current,
                                                                        geometry: {
                                                                            ...current.geometry,
                                                                            adjustments: current.geometry.adjustments.map((row, idx) => idx === adjustmentIndex ? { ...row, value: asNumber(event.target.value, 0) } : row),
                                                                        },
                                                                    }))} />
                                                                    <Select value={adjustment.impact} onValueChange={(value) => updateLine(line.localId, (current) => ({
                                                                        ...current,
                                                                        geometry: {
                                                                            ...current.geometry,
                                                                            adjustments: current.geometry.adjustments.map((row, idx) => idx === adjustmentIndex ? { ...row, impact: value as AdjustmentDraft["impact"] } : row),
                                                                        },
                                                                    }))}>
                                                                        <SelectTrigger className="rounded-2xl bg-white">
                                                                            <SelectValue />
                                                                        </SelectTrigger>
                                                                        <SelectContent>
                                                                            <SelectItem value="WIDTH">Width</SelectItem>
                                                                            <SelectItem value="HEIGHT">Height</SelectItem>
                                                                            <SelectItem value="BOTH">Both</SelectItem>
                                                                        </SelectContent>
                                                                    </Select>
                                                                    <Button variant="outline" className="rounded-2xl text-rose-600" onClick={() => updateLine(line.localId, (current) => ({
                                                                        ...current,
                                                                        geometry: {
                                                                            ...current.geometry,
                                                                            adjustments: current.geometry.adjustments.filter((_, idx) => idx !== adjustmentIndex),
                                                                        },
                                                                    }))}>
                                                                        <Trash2 className="h-4 w-4" />
                                                                    </Button>
                                                                </div>
                                                            ))}
                                                            <div className="flex flex-wrap items-center gap-3">
                                                                <Button variant="outline" className="rounded-2xl" onClick={() => updateLine(line.localId, (current) => ({
                                                                    ...current,
                                                                    geometry: { ...current.geometry, adjustments: [...current.geometry.adjustments, makeAdjustment()] },
                                                                }))}>
                                                                    <Plus className="mr-2 h-4 w-4" /> Add adjustment
                                                                </Button>
                                                                <FieldNumber small label="Faces" value={line.geometry.multipliers.faces} onChange={(value) => updateLine(line.localId, (current) => ({
                                                                    ...current,
                                                                    geometry: { ...current.geometry, multipliers: { faces: value || 1 } },
                                                                }))} />
                                                            </div>
                                                        </CardContent>
                                                    </Card>

                                                    <Card className="rounded-[1.5rem] border border-slate-200 bg-slate-50/60 shadow-none">
                                                        <CardHeader className="pb-3">
                                                            <CardTitle className="text-base font-black text-slate-800">Packaging Hooks</CardTitle>
                                                            <CardDescription>Keep the quote calculator fast while still capturing POD and dispatch notes used in customer discussions.</CardDescription>
                                                        </CardHeader>
                                                        <CardContent className="space-y-4">
                                                            <div className="flex items-center justify-between rounded-2xl bg-white p-4">
                                                                <div>
                                                                    <p className="font-black text-slate-900">POD Profile</p>
                                                                    <p className="text-sm text-slate-500">Enable only when the pouch uses POD film.</p>
                                                                </div>
                                                                <Switch checked={line.packaging_snapshot.pod.enabled} onCheckedChange={(checked) => updateLine(line.localId, (current) => ({
                                                                    ...current,
                                                                    packaging_snapshot: {
                                                                        ...current.packaging_snapshot,
                                                                        pod: { ...current.packaging_snapshot.pod, enabled: checked },
                                                                    },
                                                                }))} />
                                                            </div>
                                                            {line.packaging_snapshot.pod.enabled ? (
                                                                <div className="space-y-2">
                                                                    <Label className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">POD Material</Label>
                                                                    <Select value={line.packaging_snapshot.pod.pod_profile_id || "NONE"} onValueChange={(value) => updateLine(line.localId, (current) => ({
                                                                        ...current,
                                                                        packaging_snapshot: {
                                                                            ...current.packaging_snapshot,
                                                                            pod: {
                                                                                ...current.packaging_snapshot.pod,
                                                                                pod_profile_id: value === "NONE" ? "" : value,
                                                                            },
                                                                        },
                                                                    }))}>
                                                                        <SelectTrigger className="h-12 rounded-2xl border-slate-200 bg-white">
                                                                            <SelectValue placeholder="Select POD profile" />
                                                                        </SelectTrigger>
                                                                        <SelectContent>
                                                                            <SelectItem value="NONE">No POD profile</SelectItem>
                                                                            {podProfiles.map((profile) => (
                                                                                <SelectItem key={profile.id} value={profile.id}>
                                                                                    {profile.name}
                                                                                </SelectItem>
                                                                            ))}
                                                                        </SelectContent>
                                                                    </Select>
                                                                </div>
                                                            ) : null}
                                                            <div className="space-y-2">
                                                                <Label className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">Packaging Note</Label>
                                                                <Textarea className="min-h-[90px] rounded-[1.25rem] border-slate-200 bg-white" value={line.packaging_snapshot.note} onChange={(event) => updateLine(line.localId, (current) => ({
                                                                    ...current,
                                                                    packaging_snapshot: { ...current.packaging_snapshot, note: event.target.value },
                                                                }))} />
                                                            </div>
                                                        </CardContent>
                                                    </Card>
                                                </TabsContent>

                                                <TabsContent value="materials" className="space-y-5">
                                                    <Card className="rounded-[1.5rem] border border-slate-200 bg-slate-50/60 shadow-none">
                                                        <CardHeader className="pb-3">
                                                            <div className="flex items-center justify-between">
                                                                <div>
                                                                    <CardTitle className="text-base font-black text-slate-800">Film Stack</CardTitle>
                                                                    <CardDescription>Use family or variant selections to drive density and BOM explosion.</CardDescription>
                                                                </div>
                                                                <Button variant="outline" className="rounded-2xl" onClick={() => updateLine(line.localId, (current) => ({ ...current, film_layers: [...current.film_layers, makeLayer()] }))}>
                                                                    <Plus className="mr-2 h-4 w-4" /> Add Layer
                                                                </Button>
                                                            </div>
                                                        </CardHeader>
                                                        <CardContent className="space-y-3">
                                                            {line.film_layers.map((layer, layerIndex) => (
                                                                <div key={layer.localId} className="grid gap-3 rounded-2xl bg-white p-3 md:grid-cols-[1.2fr_1.2fr_130px_130px_auto]">
                                                                    <Select value={layer.family_id || "NONE"} onValueChange={(value) => updateLine(line.localId, (current) => ({
                                                                        ...current,
                                                                        film_layers: current.film_layers.map((row, idx) => idx === layerIndex ? { ...row, family_id: value === "NONE" ? "" : value } : row),
                                                                    }))}>
                                                                        <SelectTrigger className="rounded-2xl bg-white">
                                                                            <SelectValue placeholder="Film family" />
                                                                        </SelectTrigger>
                                                                        <SelectContent>
                                                                            <SelectItem value="NONE">Select family</SelectItem>
                                                                            {families.map((family) => (
                                                                                <SelectItem key={family.id} value={String(family.id)}>
                                                                                    {family.name}
                                                                                </SelectItem>
                                                                            ))}
                                                                        </SelectContent>
                                                                    </Select>
                                                                    <Select value={layer.variant_id || "NONE"} onValueChange={(value) => updateLine(line.localId, (current) => ({
                                                                        ...current,
                                                                        film_layers: current.film_layers.map((row, idx) => idx === layerIndex ? { ...row, variant_id: value === "NONE" ? "" : value } : row),
                                                                    }))}>
                                                                        <SelectTrigger className="rounded-2xl bg-white">
                                                                            <SelectValue placeholder="Variant (optional)" />
                                                                        </SelectTrigger>
                                                                        <SelectContent>
                                                                            <SelectItem value="NONE">Family only</SelectItem>
                                                                            {familyScopedVariants
                                                                                .filter((variant) => !layer.family_id || variant.parent_family === layer.family_id)
                                                                                .map((variant) => (
                                                                                    <SelectItem key={variant.id} value={variant.id}>
                                                                                        {variant.name}
                                                                                    </SelectItem>
                                                                                ))}
                                                                        </SelectContent>
                                                                    </Select>
                                                                    <Input type="number" placeholder="Thickness μ" value={layer.thickness_micron} onChange={(event) => updateLine(line.localId, (current) => ({
                                                                        ...current,
                                                                        film_layers: current.film_layers.map((row, idx) => idx === layerIndex ? { ...row, thickness_micron: asNumber(event.target.value, 0) } : row),
                                                                    }))} />
                                                                    <Input type="number" placeholder={line.finished_good_type === "ROLL" ? "Roll width mm" : "Optional width"} value={layer.roll_width_mm} onChange={(event) => updateLine(line.localId, (current) => ({
                                                                        ...current,
                                                                        film_layers: current.film_layers.map((row, idx) => idx === layerIndex ? { ...row, roll_width_mm: asNumber(event.target.value, 0) } : row),
                                                                    }))} />
                                                                    <Button variant="outline" className="rounded-2xl text-rose-600" onClick={() => updateLine(line.localId, (current) => ({ ...current, film_layers: current.film_layers.filter((_, idx) => idx !== layerIndex) }))} disabled={line.film_layers.length === 1}>
                                                                        <Trash2 className="h-4 w-4" />
                                                                    </Button>
                                                                </div>
                                                            ))}
                                                        </CardContent>
                                                    </Card>

                                                    <Card className="rounded-[1.5rem] border border-slate-200 bg-slate-50/60 shadow-none">
                                                        <CardHeader className="pb-3">
                                                            <CardTitle className="text-base font-black text-slate-800">Printing & Chemistry</CardTitle>
                                                            <CardDescription>Printing stays optional, but when enabled the quote calculator includes inks and chemical GSM.</CardDescription>
                                                        </CardHeader>
                                                        <CardContent className="space-y-4">
                                                            <div className="flex items-center justify-between rounded-2xl bg-white p-4">
                                                                <div>
                                                                    <p className="font-black text-slate-900">Printing Enabled</p>
                                                                    <p className="text-sm text-slate-500">Turn on for roto/flexo/digital cost and BOM estimates.</p>
                                                                </div>
                                                                <Switch checked={line.printing.enabled} onCheckedChange={(checked) => updateLine(line.localId, (current) => ({ ...current, printing: { ...current.printing, enabled: checked } }))} />
                                                            </div>
                                                            {line.printing.enabled ? (
                                                                <>
                                                                    <div className="grid gap-4 lg:grid-cols-5">
                                                                        <div className="space-y-2">
                                                                            <Label className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">Method</Label>
                                                                            <Select value={line.printing.type} onValueChange={(value) => updateLine(line.localId, (current) => ({ ...current, printing: { ...current.printing, type: value as LineDraft["printing"]["type"] } }))}>
                                                                                <SelectTrigger className="h-12 rounded-2xl bg-white">
                                                                                    <SelectValue />
                                                                                </SelectTrigger>
                                                                                <SelectContent>
                                                                                    <SelectItem value="FLEXO">FLEXO</SelectItem>
                                                                                    <SelectItem value="ROTO">ROTO</SelectItem>
                                                                                    <SelectItem value="DIGITAL">DIGITAL</SelectItem>
                                                                                </SelectContent>
                                                                            </Select>
                                                                        </div>
                                                                        <div className="space-y-2">
                                                                            <Label className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">Substrate</Label>
                                                                            <Select value={line.printing.substrate_mode} onValueChange={(value) => updateLine(line.localId, (current) => ({ ...current, printing: { ...current.printing, substrate_mode: value as LineDraft["printing"]["substrate_mode"] } }))}>
                                                                                <SelectTrigger className="h-12 rounded-2xl bg-white">
                                                                                    <SelectValue />
                                                                                </SelectTrigger>
                                                                                <SelectContent>
                                                                                    <SelectItem value="SHEET">SHEET</SelectItem>
                                                                                    <SelectItem value="TUBING">TUBING</SelectItem>
                                                                                </SelectContent>
                                                                            </Select>
                                                                        </div>
                                                                        <FieldNumber label="Front Colors" value={line.printing.front_colors_count} onChange={(value) => updateLine(line.localId, (current) => ({ ...current, printing: { ...current.printing, front_colors_count: value } }))} />
                                                                        <FieldNumber label="Back Colors" value={line.printing.back_colors_count} onChange={(value) => updateLine(line.localId, (current) => ({ ...current, printing: { ...current.printing, back_colors_count: value } }))} />
                                                                        <FieldNumber label="Ink GSM" value={line.printing.ink_gsm_total} onChange={(value) => updateLine(line.localId, (current) => ({ ...current, printing: { ...current.printing, ink_gsm_total: value } }))} />
                                                                    </div>
                                                                    <div className="grid gap-4 lg:grid-cols-2">
                                                                        <FieldNumber label="Adhesive GSM" value={line.chemicals.adhesive_gsm} onChange={(value) => updateLine(line.localId, (current) => ({ ...current, chemicals: { ...current.chemicals, adhesive_gsm: value } }))} />
                                                                        <FieldNumber label="Solvent GSM" value={line.chemicals.solvent_gsm} onChange={(value) => updateLine(line.localId, (current) => ({ ...current, chemicals: { ...current.chemicals, solvent_gsm: value } }))} />
                                                                    </div>
                                                                </>
                                                            ) : null}
                                                        </CardContent>
                                                    </Card>

                                                    <Card className="rounded-[1.5rem] border border-slate-200 bg-slate-50/60 shadow-none">
                                                        <CardHeader className="pb-3">
                                                            <div className="flex items-center justify-between">
                                                                <div>
                                                                    <CardTitle className="text-base font-black text-slate-800">Add-ons</CardTitle>
                                                                    <CardDescription>Zippers, valves, fitments, or dimensional extras tied to add-on master data.</CardDescription>
                                                                </div>
                                                                <Button variant="outline" className="rounded-2xl" onClick={() => updateLine(line.localId, (current) => ({ ...current, addons: [...current.addons, makeAddon()] }))}>
                                                                    <Plus className="mr-2 h-4 w-4" /> Add Add-on
                                                                </Button>
                                                            </div>
                                                        </CardHeader>
                                                        <CardContent className="space-y-3">
                                                            {line.addons.length === 0 ? <p className="text-sm text-slate-400">No add-ons linked to this line yet.</p> : null}
                                                            {line.addons.map((addon, addonIndex) => (
                                                                <div key={addon.localId} className="grid gap-3 rounded-2xl bg-white p-3 md:grid-cols-[1.5fr_120px_160px_auto]">
                                                                    <Select value={addon.addon_id || "NONE"} onValueChange={(value) => updateLine(line.localId, (current) => ({
                                                                        ...current,
                                                                        addons: current.addons.map((row, idx) => idx === addonIndex ? { ...row, addon_id: value === "NONE" ? "" : value } : row),
                                                                    }))}>
                                                                        <SelectTrigger className="rounded-2xl bg-white">
                                                                            <SelectValue placeholder="Select add-on" />
                                                                        </SelectTrigger>
                                                                        <SelectContent>
                                                                            <SelectItem value="NONE">Select add-on</SelectItem>
                                                                            {addons.map((entry) => (
                                                                                <SelectItem key={entry.id} value={entry.id}>
                                                                                    {entry.name}
                                                                                </SelectItem>
                                                                            ))}
                                                                        </SelectContent>
                                                                    </Select>
                                                                    <Input type="number" value={addon.qty} onChange={(event) => updateLine(line.localId, (current) => ({
                                                                        ...current,
                                                                        addons: current.addons.map((row, idx) => idx === addonIndex ? { ...row, qty: asNumber(event.target.value, 1) } : row),
                                                                    }))} />
                                                                    <Select value={addon.applies_to} onValueChange={(value) => updateLine(line.localId, (current) => ({
                                                                        ...current,
                                                                        addons: current.addons.map((row, idx) => idx === addonIndex ? { ...row, applies_to: value as AddonDraft["applies_to"] } : row),
                                                                    }))}>
                                                                        <SelectTrigger className="rounded-2xl bg-white">
                                                                            <SelectValue />
                                                                        </SelectTrigger>
                                                                        <SelectContent>
                                                                            <SelectItem value="WIDTH">Width</SelectItem>
                                                                            <SelectItem value="HEIGHT">Height</SelectItem>
                                                                            <SelectItem value="NONE">None</SelectItem>
                                                                            <SelectItem value="PER_PIECE">Per Piece</SelectItem>
                                                                            <SelectItem value="FIXED">Fixed</SelectItem>
                                                                        </SelectContent>
                                                                    </Select>
                                                                    <Button variant="outline" className="rounded-2xl text-rose-600" onClick={() => updateLine(line.localId, (current) => ({ ...current, addons: current.addons.filter((_, idx) => idx !== addonIndex) }))}>
                                                                        <Trash2 className="h-4 w-4" />
                                                                    </Button>
                                                                </div>
                                                            ))}
                                                        </CardContent>
                                                    </Card>
                                                </TabsContent>

                                                <TabsContent value="pricing" className="space-y-5">
                                                    <Card className="rounded-[1.5rem] border border-slate-200 bg-slate-50/60 shadow-none">
                                                        <CardHeader className="pb-3">
                                                            <div className="flex items-center justify-between">
                                                                <div>
                                                                    <CardTitle className="text-base font-black text-slate-800">Process Cost Rows</CardTitle>
                                                                    <CardDescription>Template-seeded when available, or manually add the commercial route you want to price.</CardDescription>
                                                                </div>
                                                                <Button variant="outline" className="rounded-2xl" onClick={() => updateLine(line.localId, (current) => ({ ...current, process_cost_rows: [...current.process_cost_rows, { ...makeProcessRow(), sequence: current.process_cost_rows.length + 1 }] }))}>
                                                                    <Plus className="mr-2 h-4 w-4" /> Add Process
                                                                </Button>
                                                            </div>
                                                        </CardHeader>
                                                        <CardContent className="space-y-3">
                                                            {line.process_cost_rows.length === 0 ? <p className="text-sm text-slate-400">No process rows yet. Select a template or add commercial route steps manually.</p> : null}
                                                            {line.process_cost_rows.map((row, rowIndex) => (
                                                                <div key={`${line.localId}-${rowIndex}`} className="grid gap-3 rounded-2xl bg-white p-3 md:grid-cols-[1.3fr_110px_110px_110px_auto]">
                                                                    <Select value={row.process_id || "NONE"} onValueChange={(value) => onProcessSelect(line.localId, rowIndex, value === "NONE" ? "" : value)}>
                                                                        <SelectTrigger className="rounded-2xl bg-white">
                                                                            <SelectValue placeholder="Select process" />
                                                                        </SelectTrigger>
                                                                        <SelectContent>
                                                                            <SelectItem value="NONE">Select process</SelectItem>
                                                                            {processes.map((process) => (
                                                                                <SelectItem key={process.id} value={process.id}>
                                                                                    {process.name}
                                                                                </SelectItem>
                                                                            ))}
                                                                        </SelectContent>
                                                                    </Select>
                                                                    <Input type="number" placeholder="Rate/hr" value={row.hourly_rate ?? 0} onChange={(event) => updateLine(line.localId, (current) => ({
                                                                        ...current,
                                                                        process_cost_rows: current.process_cost_rows.map((entry, idx) => idx === rowIndex ? { ...entry, hourly_rate: asNumber(event.target.value, 0) } : entry),
                                                                    }))} />
                                                                    <Input type="number" placeholder="Setup hr" value={row.setup_hours ?? 0} onChange={(event) => updateLine(line.localId, (current) => ({
                                                                        ...current,
                                                                        process_cost_rows: current.process_cost_rows.map((entry, idx) => idx === rowIndex ? { ...entry, setup_hours: asNumber(event.target.value, 0) } : entry),
                                                                    }))} />
                                                                    <Input type="number" placeholder="Run hr" value={row.run_hours ?? 0} onChange={(event) => updateLine(line.localId, (current) => ({
                                                                        ...current,
                                                                        process_cost_rows: current.process_cost_rows.map((entry, idx) => idx === rowIndex ? { ...entry, run_hours: asNumber(event.target.value, 0) } : entry),
                                                                    }))} />
                                                                    <Button variant="outline" className="rounded-2xl text-rose-600" onClick={() => updateLine(line.localId, (current) => ({ ...current, process_cost_rows: current.process_cost_rows.filter((_, idx) => idx !== rowIndex).map((entry, idx) => ({ ...entry, sequence: idx + 1 })) }))}>
                                                                        <Trash2 className="h-4 w-4" />
                                                                    </Button>
                                                                </div>
                                                            ))}
                                                        </CardContent>
                                                    </Card>

                                                    <Card className="rounded-[1.5rem] border border-slate-200 bg-slate-50/60 shadow-none">
                                                        <CardHeader className="pb-3">
                                                            <CardTitle className="text-base font-black text-slate-800">Commercial Overrides</CardTitle>
                                                            <CardDescription>Set the commercial model the sales team wants to quote from this cost baseline.</CardDescription>
                                                        </CardHeader>
                                                        <CardContent className="grid gap-4 lg:grid-cols-3">
                                                            <FieldNumber label="Margin %" value={asNumber(line.commercial_snapshot.margin_target_percent, 15)} onChange={(value) => updateLine(line.localId, (current) => ({ ...current, commercial_snapshot: { ...current.commercial_snapshot, margin_target_percent: value } }))} />
                                                            <FieldNumber label="Tax %" value={asNumber(line.commercial_snapshot.tax_percent, 18)} onChange={(value) => updateLine(line.localId, (current) => ({ ...current, commercial_snapshot: { ...current.commercial_snapshot, tax_percent: value } }))} />
                                                            <FieldNumber label="Wastage %" value={asNumber(line.commercial_snapshot.wastage_percent, 0)} onChange={(value) => updateLine(line.localId, (current) => ({ ...current, commercial_snapshot: { ...current.commercial_snapshot, wastage_percent: value } }))} />
                                                            <FieldNumber label="Packing Value" value={asNumber(line.commercial_snapshot.packing_value, 0)} onChange={(value) => updateLine(line.localId, (current) => ({ ...current, commercial_snapshot: { ...current.commercial_snapshot, packing_value: value } }))} />
                                                            <FieldNumber label="Freight Value" value={asNumber(line.commercial_snapshot.freight_value, 0)} onChange={(value) => updateLine(line.localId, (current) => ({ ...current, commercial_snapshot: { ...current.commercial_snapshot, freight_value: value } }))} />
                                                            <FieldNumber label="Misc Value" value={asNumber(line.commercial_snapshot.misc_value, 0)} onChange={(value) => updateLine(line.localId, (current) => ({ ...current, commercial_snapshot: { ...current.commercial_snapshot, misc_value: value } }))} />
                                                            <FieldNumber label="Discount %" value={asNumber(line.commercial_snapshot.discount_percent, 0)} onChange={(value) => updateLine(line.localId, (current) => ({ ...current, commercial_snapshot: { ...current.commercial_snapshot, discount_percent: value } }))} />
                                                            <FieldNumber label="Discount Value" value={asNumber(line.commercial_snapshot.discount_value, 0)} onChange={(value) => updateLine(line.localId, (current) => ({ ...current, commercial_snapshot: { ...current.commercial_snapshot, discount_value: value } }))} />
                                                            <FieldNumber
                                                                label="Manual Unit Price"
                                                                inputTestId={`quotation-line-${index}-manual-unit-price`}
                                                                value={asNumber(line.commercial_snapshot.manual_unit_price, 0)}
                                                                onChange={(value) => updateLine(line.localId, (current) => ({ ...current, commercial_snapshot: { ...current.commercial_snapshot, manual_unit_price: value } }))}
                                                            />
                                                        </CardContent>
                                                    </Card>
                                                </TabsContent>
                                            </Tabs>
                                        </CardContent>
                                    </Card>
                                )
                            })}
                        </div>
                    </div>

                    <div className="space-y-6">
                        <Card className="sticky top-8 overflow-hidden rounded-[2rem] border-0 bg-slate-950 text-white shadow-2xl animate-in fade-in duration-700" data-testid="quotation-preview">
                            <CardHeader className="border-b border-white/10">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <CardTitle className="text-2xl font-black tracking-tight">Live Preview</CardTitle>
                                        <CardDescription className="text-slate-400">
                                            Physics, BOM, and commercial response for the active quote line.
                                        </CardDescription>
                                    </div>
                                    <div className="rounded-2xl bg-white/10 p-3">
                                        <Calculator className="h-5 w-5 text-indigo-200" />
                                    </div>
                                </div>
                            </CardHeader>
                            <CardContent className="space-y-5 p-6">
                                {activeLine ? (
                                    <>
                                        <div className="rounded-[1.5rem] bg-white/5 p-4">
                                            <div className="flex items-center justify-between gap-3">
                                                <div>
                                                    <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">Active Line</p>
                                                    <h3 className="mt-2 text-xl font-black">{activeLine.line_name}</h3>
                                                </div>
                                                <Badge className="border border-white/10 bg-white/10 text-white">{activeLine.finished_good_type}</Badge>
                                            </div>
                                            <div className="mt-4 grid grid-cols-2 gap-3">
                                                <PreviewPill label="Quantity" value={`${activeLine.qty_value} ${activeLine.qty_uom}`} />
                                                <PreviewPill label="Basis" value={activeLine.price_basis} />
                                            </div>
                                        </div>

                                        {previewError ? (
                                            <div className="rounded-[1.5rem] border border-rose-400/30 bg-rose-500/10 p-4 text-sm text-rose-100">
                                                {previewError}
                                            </div>
                                        ) : null}

                                        {activePreview ? (
                                            <>
                                                <div className="grid grid-cols-2 gap-3">
                                                    <PreviewPill label="Unit Weight" value={`${asNumber(activePreview.unit_weight_g, 0).toFixed(3)} g`} />
                                                    <PreviewPill label="Total Weight" value={`${asNumber(activePreview.total_weight_kg, 0).toFixed(3)} kg`} />
                                                    <PreviewPill label="Area" value={`${asNumber(activePreview.physics?.geometry_snapshot?.area_m2, 0).toFixed(4)} m²`} />
                                                    <PreviewPill label="Width" value={`${asNumber(activePreview.physics?.geometry_snapshot?.effective_width_mm, 0).toFixed(1)} mm`} />
                                                </div>

                                                {activePreview.roll_preview ? (
                                                    <div className="rounded-[1.5rem] bg-white/5 p-4">
                                                        <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">Roll Breakdown</p>
                                                        <div className="mt-3 grid grid-cols-2 gap-3">
                                                            <PreviewPill label="Derived Length" value={`${asNumber(activePreview.roll_preview.derived_length_m, 0).toFixed(2)} m`} />
                                                            <PreviewPill label="Thickness" value={`${asNumber(activePreview.roll_preview.thickness_micron, 0).toFixed(2)} μ`} />
                                                        </div>
                                                    </div>
                                                ) : null}

                                                <div className="rounded-[1.5rem] bg-white/5 p-4">
                                                    <div className="flex items-center justify-between">
                                                        <div>
                                                            <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">Cost Stack</p>
                                                            <p className="mt-1 text-2xl font-black">{formatMoney(activePreview.costing.grand_total, draft.currency)}</p>
                                                        </div>
                                                        <Badge className="border border-emerald-400/20 bg-emerald-400/10 text-emerald-200">
                                                            {activePreview.costing.margin_percent.toFixed(1)}% margin
                                                        </Badge>
                                                    </div>
                                                    <div className="mt-4 space-y-2 text-sm">
                                                        <PreviewRow label="Material Cost" value={formatMoney(activePreview.costing.material_cost, draft.currency)} />
                                                        <PreviewRow label="Process Cost" value={formatMoney(activePreview.costing.process_cost, draft.currency)} />
                                                        <PreviewRow label="Landed Cost" value={formatMoney(activePreview.costing.landed_cost, draft.currency)} />
                                                        <PreviewRow label="Net Total" value={formatMoney(activePreview.costing.net_total, draft.currency)} highlight />
                                                        <PreviewRow label="Tax" value={formatMoney(activePreview.costing.tax_value, draft.currency)} />
                                                        <PreviewRow label="Grand Total" value={formatMoney(activePreview.costing.grand_total, draft.currency)} highlight />
                                                    </div>
                                                    {activePreview.costing.warnings?.length ? (
                                                        <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-400/10 p-3 text-xs text-amber-100">
                                                            {activePreview.costing.warnings.join(" ")}
                                                        </div>
                                                    ) : null}
                                                </div>

                                                <div className="rounded-[1.5rem] bg-white/5 p-4">
                                                    <div className="flex items-center justify-between">
                                                        <div>
                                                            <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">BOM Preview</p>
                                                            <p className="mt-1 text-sm text-slate-300">Top commercial material lines from the current breakdown.</p>
                                                        </div>
                                                        <Layers3 className="h-5 w-5 text-slate-400" />
                                                    </div>
                                                    <div className="mt-4 space-y-3">
                                                        {(((activePreview.bom_preview as any)?.planned_issue_lines || activePreview.bom_preview?.components || []) as any[]).slice(0, 6).map((component: any, index: number) => (
                                                            <div key={`${component.material_name || component.material_code || component.material_name || index}`} className="flex items-center justify-between gap-3 rounded-2xl bg-white/5 px-3 py-2 text-sm">
                                                                <div>
                                                                    <p className="font-bold text-white">{component.material_name || component.material_code || component.material_name || "Component"}</p>
                                                                    <p className="text-xs text-slate-400">{component.category_code || component.uom || "KG"}</p>
                                                                </div>
                                                                <span className="font-black text-slate-100">
                                                                    {component.planned_issue_qty || component.qty || component.theoretical_qty || 0} {component.uom || "KG"}
                                                                </span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            </>
                                        ) : (
                                            <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-5 text-sm text-slate-300">
                                                Edit any line to trigger the live calculation engine.
                                            </div>
                                        )}

                                        <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4">
                                            <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">Quotation Summary</p>
                                            <div className="mt-4 space-y-2 text-sm">
                                                <PreviewRow label="Subtotal" value={formatMoney(summaryTotals.subtotal, draft.currency)} />
                                                <PreviewRow label="Tax Total" value={formatMoney(summaryTotals.tax_total, draft.currency)} />
                                                <PreviewRow label="Grand Total" value={formatMoney(summaryTotals.grand_total, draft.currency)} highlight />
                                                <PreviewRow label="Margin" value={`${asNumber(summaryTotals.margin_percent, 0).toFixed(1)}%`} />
                                            </div>
                                            {draft.converted_sales_order_number ? (
                                                <Link href={`/sales/orders/${draft.converted_sales_order}`} className="mt-4 inline-flex items-center gap-2 text-sm font-black text-indigo-200 hover:text-white">
                                                    Open Converted Order <ArrowUpRight className="h-4 w-4" />
                                                </Link>
                                            ) : null}
                                        </div>
                                    </>
                                ) : (
                                    <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-5 text-sm text-slate-300">
                                        Add a quotation line to begin.
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </div>
                </div>
            </div>
        </div>
    )
}

function buildLinePayload(line: LineDraft, families: any[], variants: any[]): QuotationLinePayload {
    const filmLayers = line.film_layers.map((layer) => {
        const variant = variants.find((entry) => entry.id === layer.variant_id)
        const family = families.find((entry) => String(entry.id) === String(layer.family_id))
        const density = asNumber(variant?.density_gcm3 ?? family?.density_gcm3, 0)
        return {
            family_id: layer.family_id || null,
            variant_id: layer.variant_id || null,
            thickness_micron: asNumber(layer.thickness_micron, 0),
            roll_width_mm: asNumber(layer.roll_width_mm || line.geometry.base.width_mm, 0),
            density_g_cm3: density,
        }
    })

    return {
        template_id: line.template_id || null,
        line_name: line.line_name,
        finished_good_type: line.finished_good_type,
        roll_form: line.roll_form,
        qty_value: asNumber(line.qty_value, 0),
        qty_uom: line.finished_good_type === "ROLL" ? "KG" : line.qty_uom,
        price_basis: line.finished_good_type === "ROLL" ? "KG" : line.price_basis,
        geometry: {
            base: {
                width_mm: asNumber(line.geometry.base.width_mm, 0),
                height_mm: line.finished_good_type === "ROLL" ? 0 : asNumber(line.geometry.base.height_mm, 0),
            },
            adjustments: line.geometry.adjustments.map((adjustment) => ({
                name: adjustment.name,
                value: asNumber(adjustment.value, 0),
                impact: adjustment.impact,
            })),
            multipliers: {
                faces: asNumber(line.geometry.multipliers.faces, 1) || 1,
            },
        },
        film_layers: filmLayers,
        printing: {
            enabled: line.printing.enabled,
            type: line.printing.type,
            substrate_mode: line.printing.substrate_mode,
            front_colors_count: asNumber(line.printing.front_colors_count, 0),
            back_colors_count: asNumber(line.printing.back_colors_count, 0),
            ink_gsm_total: asNumber(line.printing.ink_gsm_total, 0),
        },
        chemicals: {
            adhesive_gsm: asNumber(line.chemicals.adhesive_gsm, 0),
            solvent_gsm: asNumber(line.chemicals.solvent_gsm, 0),
        },
        addons: line.addons.map((addon) => ({
            addon_id: addon.addon_id,
            qty: asNumber(addon.qty, 1),
            applies_to: addon.applies_to,
        })),
        packaging_snapshot: {
            primary_inner_pack: { enabled: false, material_id: null, pcs_per_pack: 0 },
            roll_dispatch_pack: { enabled: false, lines: [] },
            pod: {
                enabled: Boolean(line.packaging_snapshot.pod.enabled),
                pod_profile_id: line.packaging_snapshot.pod.pod_profile_id || null,
            },
            note: line.packaging_snapshot.note,
        },
        process_cost_rows: line.process_cost_rows.map((row, index) => ({
            ...row,
            sequence: index + 1,
            hourly_rate: asNumber(row.hourly_rate, 0),
            setup_hours: asNumber(row.setup_hours, 0),
            run_hours: asNumber(row.run_hours, 0),
        })),
        commercial_snapshot: {
            ...line.commercial_snapshot,
            wastage_percent: asNumber(line.commercial_snapshot.wastage_percent, 0),
            freight_value: asNumber(line.commercial_snapshot.freight_value, 0),
            packing_value: asNumber(line.commercial_snapshot.packing_value, 0),
            misc_value: asNumber(line.commercial_snapshot.misc_value, 0),
            discount_percent: asNumber(line.commercial_snapshot.discount_percent, 0),
            discount_value: asNumber(line.commercial_snapshot.discount_value, 0),
            tax_percent: asNumber(line.commercial_snapshot.tax_percent, 18),
            margin_target_percent: asNumber(line.commercial_snapshot.margin_target_percent, 15),
            manual_unit_price: asNumber(line.commercial_snapshot.manual_unit_price, 0),
            manual_line_total: asNumber(line.commercial_snapshot.manual_line_total, 0),
        },
    }
}

function MetricCard({ label, value, note, icon }: { label: string; value: string; note: string; icon: React.ReactNode }) {
    return (
        <Card className="rounded-[1.75rem] border-0 bg-white/80 shadow-premium backdrop-blur-xl hover-lift">
            <CardContent className="flex items-start justify-between p-5">
                <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">{label}</p>
                    <p className="mt-3 text-2xl font-black tracking-tight text-slate-900">{value}</p>
                    <p className="mt-1 text-sm text-slate-500">{note}</p>
                </div>
                <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">{icon}</div>
            </CardContent>
        </Card>
    )
}

function PreviewPill({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-2xl bg-white/5 p-3">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">{label}</p>
            <p className="mt-2 text-sm font-black text-white">{value}</p>
        </div>
    )
}

function PreviewRow({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
    return (
        <div className={`flex items-center justify-between rounded-2xl px-3 py-2 ${highlight ? "bg-white/10" : "bg-transparent"}`}>
            <span className="text-slate-300">{label}</span>
            <span className={`font-black ${highlight ? "text-white" : "text-slate-100"}`}>{value}</span>
        </div>
    )
}

function FieldNumber({
    label,
    value,
    onChange,
    disabled,
    small,
    inputTestId,
}: {
    label: string
    value: number
    onChange: (value: number) => void
    disabled?: boolean
    small?: boolean
    inputTestId?: string
}) {
    return (
        <div className={`space-y-2 ${small ? "max-w-[140px]" : ""}`}>
            <Label className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">{label}</Label>
            <Input
                type="number"
                className="h-12 rounded-2xl border-slate-200 bg-white"
                data-testid={inputTestId}
                value={value}
                disabled={disabled}
                onChange={(event) => onChange(asNumber(event.target.value, 0))}
            />
        </div>
    )
}

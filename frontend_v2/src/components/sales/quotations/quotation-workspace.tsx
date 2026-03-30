"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
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

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { classifyAddonMaster, isGussetStyle, isSpoutStyle, normalizePouchStyle } from "@/components/sales/shared/order-draft"
import { PremiumHero, PremiumMetricCard, PremiumMetricStrip, PremiumPageShell, PremiumSection } from "@/components/ui-custom/premium-page-shell"
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
    type SalesSku,
    type SalesSkuVariant,
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
    applies_to: "WIDTH" | "HEIGHT" | "BOTH" | "NONE" | "PER_PIECE" | "FIXED"
}

type LineDraft = {
    localId: string
    source_mode: "SKU" | "CUSTOM"
    sku_variant_id: string
    sku_variant_code?: string
    sku_variant_name?: string
    sku_name?: string
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
        pouch_style?: string
        gusset_mm?: number
        trim_loss_mm?: number
        flap_tape_mm?: number
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
            pod_sku_variant_id?: string
            pod_sku_code?: string
            pod_sku_name?: string
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
        source_mode: "SKU",
        sku_variant_id: "",
        sku_variant_code: "",
        sku_variant_name: "",
        sku_name: "",
        template_id: "",
        line_name: "New line",
        finished_good_type: "POUCH",
        roll_form: "",
        qty_value: 1000,
        qty_uom: "PCS",
        price_basis: "PCS",
        geometry: {
            base: { width_mm: 120, height_mm: 180 },
            pouch_style: "",
            gusset_mm: 0,
            trim_loss_mm: 0,
            flap_tape_mm: 0,
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
        packaging_snapshot: { pod: { enabled: false, pod_profile_id: "", pod_sku_variant_id: "", pod_sku_code: "", pod_sku_name: "" }, note: "" },
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

function describeErrorDetail(detail: unknown): string {
    if (!detail) return ""
    if (typeof detail === "string") return detail
    if (Array.isArray(detail)) return detail.map((entry) => describeErrorDetail(entry)).filter(Boolean).join(" ")
    if (typeof detail === "object") {
        return Object.entries(detail as Record<string, unknown>)
            .map(([key, value]) => {
                const rendered = describeErrorDetail(value)
                return rendered ? `${key}: ${rendered}` : key
            })
            .filter(Boolean)
            .join(" • ")
    }
    return String(detail)
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
            source_mode: item.source_mode || (item.sku_variant ? "SKU" : "CUSTOM"),
            sku_variant_id: item.sku_variant || "",
            sku_variant_code: item.sku_variant_code || "",
            sku_variant_name: item.sku_variant_name || "",
            sku_name: item.sku_variant_name || "",
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
                pouch_style: String(item.geometry_snapshot?.pouch_style || "").toUpperCase(),
                gusset_mm: asNumber(item.geometry_snapshot?.gusset_mm, 0),
                trim_loss_mm: asNumber(item.geometry_snapshot?.trim_loss_mm, 0),
                flap_tape_mm: asNumber(item.geometry_snapshot?.flap_tape_mm, 0),
                adjustments: Array.isArray(item.geometry_snapshot?.adjustments)
                    ? item.geometry_snapshot.adjustments.map((adjustment: any) => ({
                        localId: makeId(),
                        name: String(adjustment?.name || "Adjustment"),
                        value: asNumber(adjustment?.value, 0),
                        impact: String(adjustment?.impact || "WIDTH").toUpperCase() as AdjustmentDraft["impact"],
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
                type: String(item.printing_snapshot?.type || "FLEXO").toUpperCase() as LineDraft["printing"]["type"],
                substrate_mode: String(item.printing_snapshot?.substrate_mode || "SHEET").toUpperCase() as LineDraft["printing"]["substrate_mode"],
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
                    applies_to: String(addon?.applies_to || "PER_PIECE").toUpperCase() as AddonDraft["applies_to"],
                }))
                : [],
            packaging_snapshot: {
                pod: {
                    enabled: Boolean(item.packaging_snapshot?.pod?.enabled),
                    pod_profile_id: String(item.packaging_snapshot?.pod?.pod_profile_id || ""),
                    pod_sku_variant_id: String(item.packaging_snapshot?.pod?.pod_sku_variant_id || ""),
                    pod_sku_code: String(item.packaging_snapshot?.pod?.pod_sku_code || ""),
                    pod_sku_name: String(item.packaging_snapshot?.pod?.pod_sku_name || ""),
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

function hydrateLineFromSkuVariant(variant: SalesSkuVariant, sku?: SalesSku | null): LineDraft {
    const geometry = variant.geometry_snapshot || {}
    const base = geometry.base || geometry || {}
    const printing = variant.printing_snapshot || {}
    const chemicals = variant.chemicals_snapshot || {}
    const packaging = variant.packaging_snapshot || {}
    const pod = packaging.pod || {}
    return {
        localId: makeId(),
        source_mode: "SKU",
        sku_variant_id: variant.id,
        sku_variant_code: variant.code,
        sku_variant_name: variant.name,
        sku_name: sku?.name || variant.sku_name || "",
        template_id: variant.template || "",
        line_name: variant.name || sku?.default_line_name || sku?.name || "SKU quote line",
        finished_good_type: variant.finished_good_type,
        roll_form: (variant.roll_form || "") as LineDraft["roll_form"],
        qty_value: variant.finished_good_type === "ROLL" ? 250 : 1000,
        qty_uom: variant.finished_good_type === "ROLL" ? "KG" : "PCS",
        price_basis: variant.finished_good_type === "ROLL" ? "KG" : "PCS",
        geometry: {
            base: {
                width_mm: asNumber(base.width_mm, 0),
                height_mm: asNumber(base.height_mm, 0),
            },
            pouch_style: String(geometry.pouch_style || "").toUpperCase(),
            gusset_mm: asNumber(geometry.gusset_mm, 0),
            trim_loss_mm: asNumber(geometry.trim_loss_mm, 0),
            flap_tape_mm: asNumber(geometry.flap_tape_mm, 0),
            adjustments: Array.isArray(geometry.adjustments)
                ? geometry.adjustments.map((adjustment: any) => ({
                    localId: makeId(),
                    name: String(adjustment?.name || "Adjustment"),
                    value: asNumber(adjustment?.value, 0),
                    impact: String(adjustment?.impact || "WIDTH").toUpperCase() as AdjustmentDraft["impact"],
                }))
                : [],
            multipliers: { faces: asNumber(geometry?.multipliers?.faces, 1) || 1 },
        },
        film_layers: Array.isArray(variant.layer_snapshot) && variant.layer_snapshot.length > 0
            ? variant.layer_snapshot.map((layer: any) => ({
                localId: makeId(),
                family_id: String(layer?.family_id || ""),
                variant_id: String(layer?.variant_id || ""),
                thickness_micron: asNumber(layer?.thickness_micron, 0),
                roll_width_mm: asNumber(layer?.roll_width_mm || base.width_mm, 0),
            }))
            : [makeLayer()],
        printing: {
            enabled: Boolean(printing.enabled),
            type: String(printing.type || "FLEXO").toUpperCase() as LineDraft["printing"]["type"],
            substrate_mode: String(printing.substrate_mode || "SHEET").toUpperCase() as LineDraft["printing"]["substrate_mode"],
            front_colors_count: asNumber(printing.front_colors_count, 0),
            back_colors_count: asNumber(printing.back_colors_count, 0),
            ink_gsm_total: asNumber(printing.ink_gsm_total, 0),
        },
        chemicals: {
            adhesive_gsm: asNumber(chemicals.adhesive_gsm, 0),
            solvent_gsm: asNumber(chemicals.solvent_gsm, 0),
        },
        addons: Array.isArray(variant.addons_snapshot)
            ? variant.addons_snapshot.map((addon: any) => ({
                localId: makeId(),
                addon_id: String(addon?.addon_id || ""),
                qty: asNumber(addon?.qty || addon?.quantity, 1),
                applies_to: String(addon?.applies_to || "PER_PIECE").toUpperCase() as AddonDraft["applies_to"],
            }))
            : [],
        packaging_snapshot: {
            pod: {
                enabled: Boolean(pod.enabled),
                pod_profile_id: String(pod.pod_profile_id || ""),
                pod_sku_variant_id: String(pod.pod_sku_variant_id || ""),
                pod_sku_code: String(pod.pod_sku_code || ""),
                pod_sku_name: String(pod.pod_sku_name || ""),
            },
            note: String(packaging.note || ""),
        },
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

export default function QuotationWorkspace() {
    const { toast } = useToast()
    const queryClient = useQueryClient()
    const [draft, setDraft] = useState<QuoteDraft>(emptyQuoteDraft())
    const [activeLineId, setActiveLineId] = useState<string>(draft.items[0].localId)
    const [activePreview, setActivePreview] = useState<QuotationPreview | null>(null)
    const [previewError, setPreviewError] = useState("")
    const [showAdvancedLineEditor, setShowAdvancedLineEditor] = useState(false)

    const { data: quotations = [], isLoading: quotationsLoading } = useQuery({
        queryKey: ["sales-quotations"],
        queryFn: salesService.getQuotations,
    })
    const { data: customers = [] } = useQuery({ queryKey: ["customers"], queryFn: masterDataService.getCustomers })
    const { data: plants = [] } = useQuery({ queryKey: ["plants"], queryFn: factoryService.getPlants })
    const { data: skus = [] } = useQuery({
        queryKey: ["quotation-skus", draft.customer || "ALL"],
        queryFn: () => salesService.getSalesSkus({ customer_id: draft.customer || undefined, active: true }),
    })
    const { data: skuVariants = [] } = useQuery({
        queryKey: ["quotation-sku-variants", draft.customer || "ALL"],
        queryFn: () => salesService.getSalesSkuVariants({ customer_id: draft.customer || undefined, active: true }),
    })
    const { data: templates = [] } = useQuery({ queryKey: ["quote-templates"], queryFn: () => templateService.getTemplates({ status: "LIVE" }) })
    const { data: families = [] } = useQuery({ queryKey: ["quote-families"], queryFn: filmFamilyService.getAll })
    const { data: variants = [] } = useQuery({ queryKey: ["quote-variants"], queryFn: filmVariantService.getAll })
    const { data: addons = [] } = useQuery({ queryKey: ["quote-addons"], queryFn: masterDataService.getAddons })
    const { data: podProfiles = [] } = useQuery({ queryKey: ["pod-sku-variants", "quotation-workspace"], queryFn: () => masterDataService.getPodSkuVariants({ active: true }) })
    const { data: processes = [] } = useQuery({ queryKey: ["quote-processes"], queryFn: factoryService.getProcesses })
    const { data: processRates = [] } = useQuery({ queryKey: ["quote-process-rates"], queryFn: costingService.getProcessRates })

    const activeLineIndex = draft.items.findIndex((item) => item.localId === activeLineId)
    const activeLine = draft.items[activeLineIndex] || draft.items[0] || null
    const activeSkuVariant = skuVariants.find((variant) => String(variant.id) === String(activeLine?.sku_variant_id || ""))
    const activeSku = skus.find((sku) => String(sku.id) === String(activeSkuVariant?.sku || ""))
    const activeTemplate = templates.find((template) => String(template.id) === String(activeLine?.template_id || ""))
    const lockedPouchStyle = normalizePouchStyle(activeTemplate?.pouch_style || activeLine?.geometry.pouch_style || "")
    const showGussetField = activeLine?.finished_good_type === "POUCH" && isGussetStyle(lockedPouchStyle)
    const spoutStyle = activeLine?.finished_good_type === "POUCH" && isSpoutStyle(lockedPouchStyle)
    const familyScopedVariants = useMemo(
        () =>
            variants.filter((variant: any) =>
                !activeLine?.film_layers[0]?.family_id || variant.parent_family === activeLine?.film_layers[0]?.family_id
            ),
        [variants, activeLine]
    )
    const skuVariantOptions = useMemo(
        () =>
            skuVariants
                .filter((variant) => variant.active)
                .map((variant) => ({
                    ...variant,
                    label: variant.name || `${variant.sku_name || "SKU"} ${variant.code || ""}`.trim(),
                    detailLabel: `${variant.sku_name || "SKU"}${variant.code ? ` • ${variant.code}` : ""}`,
                })),
        [skuVariants]
    )

    useEffect(() => {
        if (!activeLine || activeLine.source_mode !== "SKU") return
        if (!draft.customer && !activeLine.sku_variant_id) return
        const currentVariantExists = skuVariantOptions.some((variant) => String(variant.id) === String(activeLine.sku_variant_id || ""))
        if (currentVariantExists) return
        const preferred = skuVariantOptions[0]
        if (!preferred) return
        applySkuVariantToLine(activeLine.localId, preferred.id)
    }, [activeLine?.localId, activeLine?.source_mode, activeLine?.sku_variant_id, draft.customer, skuVariantOptions])

    useEffect(() => {
        if (!activeLine) {
            setActivePreview(null)
            return
        }
        const handle = window.setTimeout(async () => {
            try {
                setPreviewError("")
                const preview = await salesService.previewQuotationLine(buildLinePayload(activeLine, families, variants, addons, draft.plant))
                setActivePreview(preview)
                if ((!activeLine.process_cost_rows || activeLine.process_cost_rows.length === 0) && preview.process_cost_rows?.length) {
                    setDraft((current) => ({
                        ...current,
                        items: current.items.map((item) =>
                            item.localId === activeLine.localId ? { ...item, process_cost_rows: preview.process_cost_rows } : item
                        ),
                    }))
                }
            } catch (error: any) {
                setPreviewError(error?.response?.data?.detail || error?.message || "Unable to calculate this line.")
            }
        }, 450)
        return () => window.clearTimeout(handle)
    }, [activeLine, families, variants, addons])

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
                items: draft.items.map((item) => buildLinePayload(item, families, variants, addons, draft.plant)),
            }
            return draft.id ? salesService.updateQuotation(draft.id, payload) : salesService.createQuotation(payload)
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
                description: describeErrorDetail(error?.response?.data?.detail) || error?.message || "Unable to save quotation.",
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
            toast({ title: "Duplicate failed", description: describeErrorDetail(error?.response?.data?.detail) || error?.message || "Unable to duplicate.", variant: "destructive" })
        },
    })

    const convertMutation = useMutation({
        mutationFn: (id: string) => salesService.convertQuotationToOrder(id),
        onSuccess: (result) => {
            queryClient.invalidateQueries({ queryKey: ["sales-quotations"] })
            toast({ title: "Converted to sales order", description: `${result.sales_order_number} created from ${result.quotation_number}.` })
            window.open(`/sales/orders/${result.sales_order_id}`, "_blank", "noopener,noreferrer")
        },
        onError: (error: any) => {
            const detail = describeErrorDetail(error?.response?.data?.detail)
            toast({
                title: "Conversion blocked",
                description: detail || error?.message || "Template mapping is incomplete.",
                variant: "destructive",
            })
        },
    })

    const metrics = {
        open: quotations.filter((quote) => ["DRAFT", "SENT"].includes(quote.status)).length,
        converted: quotations.filter((quote) => quote.status === "CONVERTED").length,
        value: quotations.reduce((sum, quote) => sum + Number(quote.totals_snapshot?.grand_total || 0), 0),
        avgMargin: quotations.length
            ? quotations.reduce((sum, quote) => sum + Number(quote.totals_snapshot?.margin_percent || 0), 0) / quotations.length
            : 0,
    }

    const quoteSummary = draft.totals_snapshot || {
        grand_total: activePreview?.costing?.grand_total || 0,
        subtotal: activePreview?.costing?.net_total || 0,
        tax_total: activePreview?.costing?.tax_value || 0,
        margin_percent: activePreview?.costing?.margin_percent || 0,
    }

    const updateDraft = (updates: Partial<QuoteDraft>) => setDraft((current) => ({ ...current, ...updates }))
    const updateLine = (lineId: string, updater: (line: LineDraft) => LineDraft) => {
        setDraft((current) => ({
            ...current,
            items: current.items.map((line) => (line.localId === lineId ? updater(line) : line)),
        }))
    }
    const setLineSourceMode = (lineId: string, mode: "SKU" | "CUSTOM") => {
        setShowAdvancedLineEditor(mode === "CUSTOM")
        setDraft((current) => ({
            ...current,
            items: current.items.map((line) => {
                if (line.localId !== lineId) return line
                if (mode === "SKU") {
                    return {
                        ...emptyLineDraft(),
                        localId: line.localId,
                        commercial_snapshot: { ...emptyLineDraft().commercial_snapshot, ...line.commercial_snapshot },
                    }
                }
                return {
                    ...line,
                    source_mode: "CUSTOM",
                    sku_variant_id: "",
                    sku_variant_code: "",
                    sku_variant_name: "",
                    sku_name: "",
                }
            }),
        }))
    }
    const applySkuVariantToLine = (lineId: string, variantId: string) => {
        const variant = skuVariants.find((entry) => String(entry.id) === String(variantId))
        if (!variant) return
        const sku = skus.find((entry) => String(entry.id) === String(variant.sku))
        const hydrated = hydrateLineFromSkuVariant(variant, sku)
        setDraft((current) => ({
            ...current,
            items: current.items.map((line) =>
                line.localId === lineId
                    ? {
                        ...hydrated,
                        localId: line.localId,
                        qty_value: line.qty_value > 0 ? line.qty_value : hydrated.qty_value,
                        commercial_snapshot: {
                            ...hydrated.commercial_snapshot,
                            ...line.commercial_snapshot,
                        },
                    }
                    : line
            ),
        }))
    }
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
    }
    const addLine = () => {
        const nextLine = activeLine?.source_mode === "CUSTOM"
            ? { ...emptyLineDraft(), source_mode: "CUSTOM" as const }
            : emptyLineDraft()
        setDraft((current) => ({ ...current, items: [...current.items, nextLine] }))
        setActiveLineId(nextLine.localId)
    }
    const duplicateLine = (lineId: string) => {
        const source = draft.items.find((line) => line.localId === lineId)
        if (!source) return
        const clone: LineDraft = {
            ...source,
            localId: makeId(),
            line_name: `${source.line_name} Copy`,
            geometry: { ...source.geometry, adjustments: source.geometry.adjustments.map((adjustment) => ({ ...adjustment, localId: makeId() })) },
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
        const customer = customers.find((row: any) => row.id === customerId)
        setDraft((current) => ({
            ...current,
            customer: customerId,
            customer_name: customer?.name || "",
            items: current.items.map((line) =>
                line.source_mode === "SKU"
                    ? {
                        ...line,
                        sku_variant_id: "",
                        sku_variant_code: "",
                        sku_variant_name: "",
                        sku_name: "",
                        template_id: "",
                        line_name: "New line",
                    }
                    : line
            ),
        }))
    }
    const onProcessSelect = (lineId: string, rowIndex: number, processId: string) => {
        const process = processes.find((entry: any) => entry.id === processId)
        const rate = processRates.find((entry: any) => entry.process === processId)
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

    const quotedUnitPrice = asNumber(activeLine?.commercial_snapshot?.manual_unit_price, 0) > 0
        ? asNumber(activeLine?.commercial_snapshot?.manual_unit_price, 0)
        : asNumber(activePreview?.costing?.unit_price, 0)

    return (
        <PremiumPageShell dataTestId="quotation-workspace" className="min-h-screen">
            <PremiumHero
                eyebrow="Quotation Studio"
                title={draft.quote_number || "Sales Quote Studio"}
                description="Lead with SKU-first commercial quoting. Keep the first viewport focused on customer, live SKU, quantity, quoted price, then save or PDF while the ERP keeps estimated cost guidance in view."
                actions={
                    <>
                        <Button variant="outline" className="rounded-2xl border-white/20 bg-white/10 text-white hover:bg-white/15" onClick={openNewQuote}>
                            <Plus className="mr-2 h-4 w-4" /> New Quote
                        </Button>
                        <Button
                            className="rounded-2xl bg-white text-slate-900 hover:bg-slate-100"
                            data-testid="quotation-save"
                            onClick={() => saveMutation.mutate()}
                            disabled={saveMutation.isPending}
                        >
                            {saveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                            Save Quote
                        </Button>
                    </>
                }
                metrics={
                    <PremiumMetricStrip className="xl:grid-cols-4">
                        <PremiumMetricCard label="Open Quotations" value={String(metrics.open)} hint="Draft or sent" tone="dark" />
                        <PremiumMetricCard label="Converted" value={String(metrics.converted)} hint="Already turned into orders" tone="dark" />
                        <PremiumMetricCard label="Saved Value" value={formatMoney(metrics.value, draft.currency)} hint="From saved commercial totals" tone="dark" />
                        <PremiumMetricCard label="Avg Margin" value={`${metrics.avgMargin.toFixed(1)}%`} hint="Estimated quote margin" tone="dark" />
                    </PremiumMetricStrip>
                }
            />

            <div className="grid gap-6 xl:grid-cols-[290px_minmax(0,1fr)]">
                <aside className="min-w-0 xl:sticky xl:top-6 xl:self-start">
                    <div className="overflow-hidden rounded-[2rem] border border-slate-200/80 bg-[linear-gradient(180deg,#0f172a_0%,#18233f_48%,#f8f5ed_48%,#fffdf7_100%)] shadow-[0_28px_70px_-46px_rgba(15,23,42,0.38)]">
                        <div className="px-5 py-5 text-white">
                            <div className="text-[11px] font-black uppercase tracking-[0.24em] text-sky-200/80">Quote rail</div>
                            <div className="mt-3 text-2xl font-black tracking-tight">Keep one commercial thread visible.</div>
                            <div className="mt-2 text-sm leading-6 text-slate-300">
                                Saved quotes, active lines, and the next line action stay together so sales never has to hunt around the page.
                            </div>
                        </div>

                        <div className="space-y-5 px-4 pb-4 pt-1">
                            <div className="rounded-[1.6rem] border border-white/8 bg-white/5 px-4 py-4 text-white">
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-300">Open quotes</div>
                                        <div className="mt-2 text-2xl font-black">{metrics.open}</div>
                                    </div>
                                    <Button variant="outline" className="rounded-2xl border-white/10 bg-white/5 text-white hover:bg-white/10" onClick={openNewQuote}>
                                        <Plus className="mr-2 h-4 w-4" /> New
                                    </Button>
                                </div>
                            </div>

                            <div className="rounded-[1.8rem] border border-slate-200/80 bg-white p-4 shadow-[0_20px_40px_-36px_rgba(15,23,42,0.24)]">
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <div className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">Saved quotations</div>
                                        <div className="mt-1 text-base font-black text-slate-950">Recent commercial drafts</div>
                                    </div>
                                    <Badge className="rounded-full border border-slate-200 bg-slate-50 text-slate-700">{quotations.length}</Badge>
                                </div>
                                <ScrollArea className="mt-4 h-[250px] pr-2">
                                    <div className="space-y-3">
                                        {quotationsLoading ? (
                                            <div className="rounded-[1.2rem] border border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                                                Loading saved quotations...
                                            </div>
                                        ) : null}
                                        {quotations.map((quotation) => (
                                            <button
                                                key={quotation.id}
                                                type="button"
                                                onClick={() => loadQuotation(quotation)}
                                                className={`w-full rounded-[1.35rem] border px-4 py-4 text-left transition ${draft.id === quotation.id ? "border-slate-900 bg-slate-900 text-white shadow-xl" : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white"}`}
                                            >
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="min-w-0">
                                                        <div className="text-[10px] font-black uppercase tracking-[0.22em] opacity-70">{quotation.quote_number}</div>
                                                        <div className="mt-2 truncate text-sm font-black">{quotation.customer_name}</div>
                                                    </div>
                                                    <Badge className={`border ${draft.id === quotation.id ? "border-white/10 bg-white/10 text-white" : statusTone(quotation.status)}`}>
                                                        {quotation.status}
                                                    </Badge>
                                                </div>
                                                <div className="mt-3 flex items-end justify-between text-xs">
                                                    <span className="opacity-70">{quotation.items.length} lines</span>
                                                    <span className="font-black">{formatMoney(quotation.totals_snapshot?.grand_total, quotation.currency)}</span>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                </ScrollArea>
                            </div>

                            <div className="rounded-[1.8rem] border border-slate-200/80 bg-white p-4 shadow-[0_20px_40px_-36px_rgba(15,23,42,0.24)]">
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <div className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">Active lines</div>
                                        <div className="mt-1 text-base font-black text-slate-950">One line at a time</div>
                                    </div>
                                    <Button className="rounded-2xl bg-slate-900 hover:bg-slate-800" data-testid="quotation-add-line" onClick={addLine}>
                                        <Plus className="mr-2 h-4 w-4" /> Add
                                    </Button>
                                </div>
                                <div className="mt-4 space-y-3">
                                    {draft.items.map((line, index) => (
                                        <button
                                            key={line.localId}
                                            type="button"
                                            onClick={() => setActiveLineId(line.localId)}
                                            className={`w-full rounded-[1.35rem] border px-4 py-4 text-left transition ${line.localId === activeLineId ? "border-slate-900 bg-slate-900 text-white shadow-xl" : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white"}`}
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                    <div className="text-[10px] font-black uppercase tracking-[0.22em] opacity-70">Line {index + 1}</div>
                                                    <div className="mt-2 truncate text-base font-black">{line.line_name}</div>
                                                    <div className="mt-1 text-xs opacity-70">{line.qty_value} {line.qty_uom} • {line.source_mode}</div>
                                                </div>
                                                <CircleDot className="mt-0.5 h-4 w-4 shrink-0 opacity-80" />
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </aside>

                <div className="space-y-5">
                    <section className="overflow-hidden rounded-[2rem] border border-slate-200/80 bg-[linear-gradient(180deg,#fffdf8_0%,#ffffff_58%,#f7f9fc_100%)] shadow-[0_24px_60px_-42px_rgba(15,23,42,0.22)]">
                        <div className="grid gap-5 border-b border-slate-200 px-6 py-6 xl:grid-cols-[minmax(0,1.2fr)_300px]">
                            <div className="space-y-4">
                                <div>
                                    <div className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">Commercial header</div>
                                    <div className="mt-2 text-3xl font-black tracking-tight text-slate-950">
                                        Build the quote from one calm surface, then move.
                                    </div>
                                    <div className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
                                        Customer, plant, validity, and quote status stay fixed here. The active line below should feel like one working plane, not a document made of small cards.
                                    </div>
                                </div>
                                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                                    <FieldSelect label="Customer" testId="quotation-customer" value={draft.customer || "NONE"} onChange={(value) => onCustomerChange(value === "NONE" ? "" : value)}>
                                        <SelectItem value="NONE">Unlinked customer</SelectItem>
                                        {customers.map((customer: any) => (
                                            <SelectItem key={customer.id} value={customer.id}>{customer.name}</SelectItem>
                                        ))}
                                    </FieldSelect>
                                    <FieldSelect label="Plant" testId="quotation-plant" value={draft.plant || "NONE"} onChange={(value) => updateDraft({ plant: value === "NONE" ? "" : value })}>
                                        <SelectItem value="NONE">No legal plant</SelectItem>
                                        {plants.map((plant: any) => (
                                            <SelectItem key={plant.id} value={plant.id}>{plant.name}</SelectItem>
                                        ))}
                                    </FieldSelect>
                                    <FieldShell label="Valid Until">
                                        <Input type="date" className="h-12 rounded-2xl border-slate-200 bg-white" value={draft.valid_until} onChange={(event) => updateDraft({ valid_until: event.target.value })} />
                                    </FieldShell>
                                    <FieldShell label="Currency">
                                        <Input className="h-12 rounded-2xl border-slate-200 bg-white uppercase" value={draft.currency} onChange={(event) => updateDraft({ currency: event.target.value.toUpperCase() })} />
                                    </FieldShell>
                                </div>
                            </div>

                            <div className="rounded-[1.7rem] border border-slate-900/5 bg-slate-950 px-5 py-5 text-white shadow-[0_22px_56px_-42px_rgba(15,23,42,0.8)]">
                                <div className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-300">Quote identity</div>
                                <div className="mt-3 text-2xl font-black tracking-tight" data-testid="quotation-number">{draft.quote_number || "Unsaved draft"}</div>
                                <div className="mt-2 text-sm text-slate-300">
                                    {draft.customer_name || "Customer will mirror the selected account unless sales overrides the commercial name below."}
                                </div>
                                <div className="mt-4 flex flex-wrap gap-2">
                                    <Badge className={`rounded-full border ${statusTone(draft.status)}`}>{draft.status.replaceAll("_", " ")}</Badge>
                                    <Badge className="rounded-full border border-white/10 bg-white/10 text-white">SKU-first by default</Badge>
                                    <Badge className="rounded-full border border-white/10 bg-white/10 text-white">Cost mode: ESTIMATED</Badge>
                                </div>
                                <FieldShell label="Customer Name Override">
                                    <Input
                                        className="mt-4 h-12 rounded-2xl border-white/10 bg-white/10 text-white placeholder:text-slate-400"
                                        data-testid="quotation-customer-name"
                                        value={draft.customer_name}
                                        onChange={(event) => updateDraft({ customer_name: event.target.value })}
                                    />
                                </FieldShell>
                            </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
                            <div className="text-sm text-slate-500">Launch deck below: use SKU Quote for speed, switch to Custom Quote only when a sales line genuinely needs expert technical shaping.</div>
                            {draft.id ? (
                                <div className="flex flex-wrap gap-2">
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
                                        data-testid="quotation-convert-order"
                                        onClick={() => convertMutation.mutate(draft.id!)}
                                        disabled={convertMutation.isPending}
                                    >
                                        {convertMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                                        Convert To Order
                                    </Button>
                                </div>
                            ) : null}
                        </div>
                    </section>

                    <QuoteWorkbench
                        activeLine={activeLine}
                        activeLineIndex={activeLineIndex}
                        activePreview={activePreview}
                        activeSku={activeSku}
                        activeSkuVariant={activeSkuVariant}
                        activeTemplate={activeTemplate}
                        addons={addons}
                        draft={draft}
                        families={families}
                        familyScopedVariants={familyScopedVariants}
                        lockedPouchStyle={lockedPouchStyle}
                        podProfiles={podProfiles}
                        previewError={previewError}
                        processRates={processRates}
                        processes={processes}
                        showGussetField={showGussetField}
                        showAdvancedLineEditor={showAdvancedLineEditor}
                        skuVariantOptions={skuVariantOptions}
                        templates={templates}
                        quotedUnitPrice={quotedUnitPrice}
                        onCloneLine={duplicateLine}
                        onRemoveLine={removeLine}
                        onToggleAdvanced={() => setShowAdvancedLineEditor((current) => !current)}
                        onSetLineSourceMode={setLineSourceMode}
                        onApplySkuVariant={applySkuVariantToLine}
                        onUpdateLine={updateLine}
                        onUpdateDraft={updateDraft}
                        onProcessSelect={onProcessSelect}
                    />
                </div>
            </div>
        </PremiumPageShell>
    )
}

function QuoteWorkbench({
    activeLine,
    activeLineIndex,
    activePreview,
    activeSku,
    activeSkuVariant,
    activeTemplate,
    addons,
    draft,
    families,
    familyScopedVariants,
    lockedPouchStyle,
    podProfiles,
    previewError,
    processRates,
    processes,
    quotedUnitPrice,
    showAdvancedLineEditor,
    showGussetField,
    skuVariantOptions,
    templates,
    onCloneLine,
    onRemoveLine,
    onToggleAdvanced,
    onSetLineSourceMode,
    onApplySkuVariant,
    onUpdateLine,
    onUpdateDraft,
    onProcessSelect,
}: {
    activeLine: LineDraft | null
    activeLineIndex: number
    activePreview: QuotationPreview | null
    activeSku?: SalesSku | undefined
    activeSkuVariant?: SalesSkuVariant | undefined
    activeTemplate?: any
    addons: any[]
    draft: QuoteDraft
    families: any[]
    familyScopedVariants: any[]
    lockedPouchStyle: string
    podProfiles: any[]
    previewError: string
    processRates: any[]
    processes: any[]
    quotedUnitPrice: number
    showAdvancedLineEditor: boolean
    showGussetField: boolean
    skuVariantOptions: Array<SalesSkuVariant & { label: string; detailLabel: string }>
    templates: any[]
    onCloneLine: (lineId: string) => void
    onRemoveLine: (lineId: string) => void
    onToggleAdvanced: () => void
    onSetLineSourceMode: (lineId: string, mode: "SKU" | "CUSTOM") => void
    onApplySkuVariant: (lineId: string, variantId: string) => void
    onUpdateLine: (lineId: string, updater: (line: LineDraft) => LineDraft) => void
    onUpdateDraft: (updates: Partial<QuoteDraft>) => void
    onProcessSelect: (lineId: string, rowIndex: number, processId: string) => void
}) {
    if (!activeLine) {
        return (
            <PremiumSection title="Sales Quote Studio" description="Pick a saved quote or add a line to begin.">
                <div className="rounded-[1.5rem] border border-dashed border-slate-200 bg-slate-50 px-6 py-10 text-sm text-slate-500">
                    Add a quotation line to begin.
                </div>
            </PremiumSection>
        )
    }

    const isSkuMode = activeLine.source_mode === "SKU"
    const sourceLabel = isSkuMode ? "SKU Quote" : "Custom Quote"
    const productLabel = activeSkuVariant
        ? `${activeSku?.name || activeSkuVariant.sku_name || "SKU"}`
        : activeTemplate?.name || "Custom quote line"
    const quoteSummary = draft.totals_snapshot || {
        grand_total: activePreview?.costing?.grand_total || 0,
        subtotal: activePreview?.costing?.net_total || 0,
        tax_total: activePreview?.costing?.tax_value || 0,
        margin_percent: activePreview?.costing?.margin_percent || 0,
    }

    return (
        <div className="overflow-hidden rounded-[2.2rem] border border-slate-200/90 bg-[linear-gradient(180deg,#f6f3eb_0%,#ffffff_55%,#f8fafc_100%)] shadow-[0_38px_90px_-62px_rgba(15,23,42,0.45)]">
                <div className="border-b border-slate-800/10 bg-[linear-gradient(135deg,#0f172a_0%,#172554_62%,#1d4ed8_100%)] px-6 py-6 text-white">
                    <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
                        <div className="max-w-3xl">
                            <div className="text-[11px] font-black uppercase tracking-[0.28em] text-cyan-200/80">Midnight commercial studio</div>
                            <div className="mt-3 text-3xl font-black tracking-tight">Launch from the right mode, then keep the line on one commercial plane.</div>
                            <div className="mt-3 max-w-2xl text-sm leading-6 text-slate-200">
                                The default path is SKU-first: choose the saleable variant, keep only light size edits visible, enter the quoted price, and move. Custom Quote stays available, but it no longer contaminates the fast lane.
                            </div>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-3">
                            <StatPill label="Mode" value={sourceLabel} subtle />
                            <StatPill label="Cost" value="ESTIMATED" subtle />
                            <StatPill label="Line" value={`Line ${activeLineIndex + 1}`} subtle />
                        </div>
                    </div>

                    <div className="mt-6 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                        <button
                            type="button"
                            onClick={() => onSetLineSourceMode(activeLine.localId, "SKU")}
                            className={`rounded-[1.8rem] border px-5 py-5 text-left transition ${isSkuMode ? "border-cyan-300/45 bg-white/14 shadow-[inset_0_1px_0_rgba(255,255,255,0.16)]" : "border-white/10 bg-white/5 hover:bg-white/10"}`}
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <div className="text-sm font-black text-white">SKU Quote</div>
                                    <div className="mt-2 text-2xl font-black tracking-tight text-white">Pick a live variant, check the size, quote the price, and move.</div>
                                    <div className="mt-2 text-xs leading-5 text-slate-300">Fast lane for normal sales work. Geometry, layers, print, and packaging stay inherited from the SKU so the user only touches commercial fields.</div>
                                </div>
                                <CheckCircle2 className={`mt-0.5 h-5 w-5 ${isSkuMode ? "text-cyan-300" : "text-white/30"}`} />
                            </div>
                        </button>
                        <button
                            type="button"
                            onClick={() => onSetLineSourceMode(activeLine.localId, "CUSTOM")}
                            className={`rounded-[1.8rem] border px-5 py-5 text-left transition ${!isSkuMode ? "border-amber-300/35 bg-amber-200/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.16)]" : "border-white/10 bg-white/5 hover:bg-white/10"}`}
                        >
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <div className="text-sm font-black text-white">Custom Quote</div>
                                    <div className="mt-2 text-lg font-black tracking-tight text-white">Use only when the job is not ready for SKU-led selling.</div>
                                    <div className="mt-2 text-xs leading-5 text-slate-300">Secondary expert path for pre-catalogue work, unusual structures, or deliberate template-led technical editing.</div>
                                </div>
                                <Layers3 className={`mt-0.5 h-5 w-5 ${!isSkuMode ? "text-amber-300" : "text-white/30"}`} />
                            </div>
                        </button>
                    </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/80 px-6 py-4">
                    <div className="text-sm text-slate-500">Use the left rail to switch saved quotes or lines. This surface only shows the active commercial path.</div>
                    <div className="flex flex-wrap gap-2">
                        <Button variant="outline" className="rounded-2xl" onClick={() => onCloneLine(activeLine.localId)}>
                            <Copy className="mr-2 h-4 w-4" /> Clone Line
                        </Button>
                        <Button variant="outline" className="rounded-2xl text-rose-600" onClick={() => onRemoveLine(activeLine.localId)} disabled={draft.items.length === 1}>
                            <Trash2 className="mr-2 h-4 w-4" /> Remove
                        </Button>
                        {!isSkuMode ? (
                            <Button variant="outline" className="rounded-2xl" onClick={onToggleAdvanced}>
                                {showAdvancedLineEditor ? "Hide Advanced" : "Advanced Details"}
                            </Button>
                        ) : null}
                    </div>
                </div>

                <div className="grid gap-6 px-6 py-6 2xl:grid-cols-[minmax(0,1fr)_320px]">
                    <div className="min-w-0 space-y-6">
                        <div className="grid gap-4 rounded-[1.8rem] border border-slate-200/80 bg-white/90 px-5 py-5 shadow-[0_22px_44px_-40px_rgba(15,23,42,0.3)] lg:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]">
                            <div>
                                <div className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">Launch deck</div>
                                <div className="mt-2 text-2xl font-black tracking-tight text-slate-950">{productLabel}</div>
                                <div className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
                                    {isSkuMode
                                        ? "This is the commercial fast lane. The active line inherits structure from the SKU and stays readable for a normal sales user."
                                        : "Start from a live template and reveal technical sections only if the line genuinely needs expert shaping."}
                                </div>
                            </div>
                            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
                                <div className={`rounded-[1.45rem] border px-4 py-4 text-left transition ${isSkuMode ? "border-slate-900 bg-slate-900 text-white shadow-[0_18px_40px_-32px_rgba(15,23,42,0.65)]" : "border-slate-200 bg-slate-50 text-slate-700"}`}>
                                    <div className="text-[11px] font-black uppercase tracking-[0.22em] opacity-70">Default mode</div>
                                    <div className="mt-2 text-lg font-black">SKU Quote</div>
                                    <div className="mt-1 text-sm leading-6 opacity-80">Choose a live variant, confirm size, quote the price, and move.</div>
                                </div>
                                <div className={`rounded-[1.45rem] border px-4 py-4 text-left transition ${!isSkuMode ? "border-amber-300 bg-amber-50 text-amber-900" : "border-slate-200 bg-slate-50 text-slate-700"}`}>
                                    <div className="text-[11px] font-black uppercase tracking-[0.22em] opacity-70">Expert path</div>
                                    <div className="mt-2 text-lg font-black">Custom Quote</div>
                                    <div className="mt-1 text-sm leading-6 opacity-80">Only for jobs that need template-led or technical overrides.</div>
                                </div>
                            </div>
                        </div>

                        {isSkuMode ? (
                            <SkuQuoteLane
                                activeLine={activeLine}
                                activeLineIndex={activeLineIndex}
                                activePreview={activePreview}
                                activeSku={activeSku}
                                activeSkuVariant={activeSkuVariant}
                                families={families}
                                familyScopedVariants={familyScopedVariants}
                                lockedPouchStyle={lockedPouchStyle}
                                previewError={previewError}
                                quotedUnitPrice={quotedUnitPrice}
                                skuVariantOptions={skuVariantOptions}
                                templates={templates}
                                onRevealCustomEditor={() => {
                                    if (!showAdvancedLineEditor) {
                                        onToggleAdvanced()
                                    }
                                }}
                                onApplySkuVariant={onApplySkuVariant}
                                onUpdateLine={onUpdateLine}
                            />
                        ) : (
                            <CustomQuoteLane
                                activeLine={activeLine}
                                activeLineIndex={activeLineIndex}
                                activePreview={activePreview}
                                activeTemplate={activeTemplate}
                                addons={addons}
                                draft={draft}
                                families={families}
                                familyScopedVariants={familyScopedVariants}
                                lockedPouchStyle={lockedPouchStyle}
                                podProfiles={podProfiles}
                                previewError={previewError}
                                processRates={processRates}
                                processes={processes}
                                quotedUnitPrice={quotedUnitPrice}
                                showAdvancedLineEditor={showAdvancedLineEditor}
                                showGussetField={showGussetField}
                                templates={templates}
                                onToggleAdvanced={onToggleAdvanced}
                                onUpdateDraft={onUpdateDraft}
                                onUpdateLine={onUpdateLine}
                                onProcessSelect={onProcessSelect}
                            />
                        )}
                    </div>

                    <div className="space-y-4 2xl:sticky 2xl:top-6">
                        <div className="rounded-[1.7rem] border border-slate-200 bg-slate-950 px-5 py-5 text-white shadow-[0_26px_60px_-48px_rgba(15,23,42,0.78)]">
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <div className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-300">Commercial inspector</div>
                                    <div className="mt-2 text-xl font-black text-white">{activeLine.line_name}</div>
                                    <div className="mt-1 text-sm text-slate-300">{activeLine.qty_value} {activeLine.qty_uom} • {activeLine.finished_good_type}</div>
                                </div>
                                <div className="rounded-2xl bg-white/10 p-3 text-white">
                                    <BadgeIndianRupee className="h-5 w-5" />
                                </div>
                            </div>
                            <div className="mt-4 grid grid-cols-2 gap-3">
                                <StatPill label="Cost Mode" value="ESTIMATED" subtle />
                                <StatPill label="Source" value={activeLine.source_mode} subtle />
                                <StatPill label="Quote Basis" value={activeLine.price_basis} subtle />
                                <StatPill label="Preview" value={`${activeLine.qty_value} ${activeLine.qty_uom}`} subtle />
                            </div>
                            <div className="mt-5 space-y-2">
                                <InspectorRow inverted label="System Estimated Cost" value={formatMoney(activePreview?.costing?.landed_cost, draft.currency)} />
                                <InspectorRow inverted label="Suggested Output" value={formatMoney(activePreview?.costing?.net_total, draft.currency)} />
                                <InspectorRow inverted label="Sales Quoted Price" value={formatMoney(quotedUnitPrice, draft.currency)} highlight />
                                <InspectorRow inverted label="Estimated Margin" value={`${asNumber(activePreview?.costing?.margin_percent, 0).toFixed(1)}%`} />
                            </div>
                        </div>

                        <div className="rounded-[1.6rem] border border-slate-200 bg-slate-50 px-4 py-4">
                            <div className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-400">Preview summary</div>
                            {previewError ? (
                                <div className="mt-4 rounded-[1.2rem] border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700">{previewError}</div>
                            ) : activePreview ? (
                                <div className="mt-4 grid gap-3 sm:grid-cols-2 2xl:grid-cols-1">
                                    <StatPill label="Unit Weight" value={`${asNumber(activePreview.unit_weight_g, 0).toFixed(3)} g`} />
                                    <StatPill label="Total Weight" value={`${asNumber(activePreview.total_weight_kg, 0).toFixed(3)} kg`} />
                                    <StatPill label="Effective Width" value={`${asNumber(activePreview.physics?.geometry_snapshot?.effective_width_mm, 0).toFixed(1)} mm`} />
                                    <StatPill label="Area" value={`${asNumber(activePreview.physics?.geometry_snapshot?.area_m2, 0).toFixed(4)} m²`} />
                                    {activePreview.roll_preview ? <StatPill label="Derived Length" value={`${asNumber(activePreview.roll_preview.derived_length_m, 0).toFixed(2)} m`} /> : null}
                                    {activePreview.roll_preview ? <StatPill label="Roll Thickness" value={`${asNumber(activePreview.roll_preview.thickness_micron, 0).toFixed(2)} μ`} /> : null}
                                </div>
                            ) : (
                                <div className="mt-4 rounded-[1.2rem] border border-dashed border-slate-200 bg-white px-4 py-5 text-sm text-slate-500">
                                    Choose a SKU or template and the inspector will render geometry, weight, and commercial guidance here.
                                </div>
                            )}
                        </div>

                        <div className="rounded-[1.7rem] border border-slate-200 bg-white px-5 py-5 shadow-[0_22px_48px_-44px_rgba(15,23,42,0.35)]">
                            <div className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">Quotation summary</div>
                            <div className="mt-4 space-y-2">
                                <InspectorRow label="Subtotal" value={formatMoney(quoteSummary.subtotal, draft.currency)} />
                                <InspectorRow label="Tax Total" value={formatMoney(quoteSummary.tax_total, draft.currency)} />
                                <InspectorRow label="Grand Total" value={formatMoney(quoteSummary.grand_total, draft.currency)} highlight />
                                <InspectorRow label="Margin" value={`${asNumber(quoteSummary.margin_percent, 0).toFixed(1)}%`} />
                            </div>
                            {draft.converted_sales_order_number ? (
                                <Link href={`/sales/orders/${draft.converted_sales_order}`} className="mt-4 inline-flex items-center gap-2 text-sm font-black text-indigo-600 hover:text-indigo-500">
                                    Open Converted Order <ArrowUpRight className="h-4 w-4" />
                                </Link>
                            ) : null}
                        </div>
                    </div>
                </div>
            </div>
    )
}

function SkuQuoteLane({
    activeLine,
    activeLineIndex,
    activePreview,
    activeSku,
    activeSkuVariant,
    families,
    familyScopedVariants,
    lockedPouchStyle,
    previewError,
    quotedUnitPrice,
    skuVariantOptions,
    templates,
    onRevealCustomEditor,
    onApplySkuVariant,
    onUpdateLine,
}: {
    activeLine: LineDraft
    activeLineIndex: number
    activePreview: QuotationPreview | null
    activeSku?: SalesSku
    activeSkuVariant?: SalesSkuVariant
    families: any[]
    familyScopedVariants: any[]
    lockedPouchStyle: string
    previewError: string
    quotedUnitPrice: number
    skuVariantOptions: Array<SalesSkuVariant & { label: string; detailLabel: string }>
    templates: any[]
    onRevealCustomEditor: () => void
    onApplySkuVariant: (lineId: string, variantId: string) => void
    onUpdateLine: (lineId: string, updater: (line: LineDraft) => LineDraft) => void
}) {
    const isRoll = activeLine.finished_good_type === "ROLL"
    const [compatibilityTab, setCompatibilityTab] = useState<"spec" | "materials" | "pricing">("spec")
    const featuredVariants = skuVariantOptions.slice(0, 3)
    const specChips = [
        activeSkuVariant?.code || "",
        lockedPouchStyle ? lockedPouchStyle.replaceAll("_", " ") : "",
        isRoll ? activeLine.roll_form || "ROLL" : `${activeLine.geometry.base.width_mm} × ${activeLine.geometry.base.height_mm} mm`,
    ].filter(Boolean)

    return (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_292px]">
            <div className="overflow-hidden rounded-[1.95rem] border border-slate-200/90 bg-white shadow-[0_26px_60px_-48px_rgba(15,23,42,0.35)]">
                <div className="border-b border-slate-200 bg-[linear-gradient(135deg,#f9f4ea_0%,#ffffff_40%,#f3f6fb_100%)] px-6 py-6">
                    <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                        <div className="max-w-3xl">
                            <div className="text-[11px] font-black uppercase tracking-[0.24em] text-slate-400">SKU fast lane</div>
                            <div className="mt-2 text-3xl font-black tracking-tight text-slate-950">Pick the live variant, change only what sales owns, and finish the quote in one screen.</div>
                            <div className="mt-2 text-sm leading-6 text-slate-500">
                                The normal path is now simple: live SKU first, light size edits, quantity, salesperson price, then save or PDF. Deep technical structure stays inherited from the SKU.
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {specChips.map((chip) => (
                                <Badge key={chip} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-slate-700 shadow-sm">
                                    {chip}
                                </Badge>
                            ))}
                            <Badge className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-slate-700 shadow-sm">
                                {activeLine.qty_uom} basis
                            </Badge>
                        </div>
                    </div>
                </div>

                <div className="grid gap-0 xl:grid-cols-[minmax(0,1.15fr)_320px]">
                    <div className="relative z-10 min-w-0">
                        <div className="border-b border-slate-200 px-6 py-6">
                            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_240px]">
                                <FieldSelect
                                    label="Live SKU Variant"
                                    testId={`quotation-line-${activeLineIndex}-sku-variant`}
                                    value={activeLine.sku_variant_id || "NONE"}
                                    onChange={(value) => onApplySkuVariant(activeLine.localId, value === "NONE" ? "" : value)}
                                >
                                    <SelectItem value="NONE">Select live SKU variant</SelectItem>
                                    {skuVariantOptions.map((variant) => (
                                        <SelectItem key={variant.id} value={variant.id}>{variant.label}</SelectItem>
                                    ))}
                                </FieldSelect>
                                <FieldSelect
                                    label="Template-led fallback"
                                    testId={`quotation-line-${activeLineIndex}-template`}
                                    value={activeLine.template_id || "NONE"}
                                    onChange={(value) => {
                                        if (value === "NONE") return
                                        const selectedTemplate = templates.find((template: any) => String(template.id) === String(value))
                                        onRevealCustomEditor()
                                        onUpdateLine(activeLine.localId, (current) => ({
                                            ...current,
                                            source_mode: "CUSTOM",
                                            sku_variant_id: "",
                                            sku_variant_code: "",
                                            sku_variant_name: "",
                                            sku_name: "",
                                            template_id: value,
                                            line_name: selectedTemplate?.name || current.line_name,
                                            geometry: {
                                                ...current.geometry,
                                                pouch_style: current.finished_good_type === "POUCH"
                                                    ? normalizePouchStyle(selectedTemplate?.pouch_style || current.geometry.pouch_style || "")
                                                    : "",
                                            },
                                        }))
                                    }}
                                >
                                    <SelectItem value="NONE">Switch to template-led custom line</SelectItem>
                                    {templates
                                        .filter((template: any) => template.fg_type === activeLine.finished_good_type)
                                        .map((template: any) => (
                                            <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>
                                        ))}
                                </FieldSelect>
                                <FieldShell label="Line Label">
                                    <div className="flex gap-2">
                                        <Input
                                            className="h-12 rounded-2xl border-slate-200 bg-white"
                                            data-testid={`quotation-line-name-${activeLineIndex}`}
                                            value={activeLine.line_name}
                                            onChange={(event) => onUpdateLine(activeLine.localId, (current) => ({ ...current, line_name: event.target.value }))}
                                        />
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="h-12 rounded-2xl border-slate-200 px-4 text-[11px] font-black uppercase tracking-[0.18em] text-slate-600"
                                        >
                                            Pricing
                                        </Button>
                                    </div>
                                </FieldShell>
                            </div>

                            <div className="relative z-20 mt-4 flex flex-wrap gap-2">
                                <Button
                                    type="button"
                                    variant={compatibilityTab === "spec" ? "default" : "outline"}
                                    className="rounded-2xl"
                                    data-testid={`quotation-line-${activeLineIndex}-tab-spec`}
                                    onClick={() => setCompatibilityTab("spec")}
                                >
                                    Specification
                                </Button>
                                <Button
                                    type="button"
                                    variant={compatibilityTab === "materials" ? "default" : "outline"}
                                    className="rounded-2xl"
                                    data-testid={`quotation-line-${activeLineIndex}-tab-materials`}
                                    onClick={() => setCompatibilityTab("materials")}
                                >
                                    Materials
                                </Button>
                                <Button
                                    type="button"
                                    variant={compatibilityTab === "pricing" ? "default" : "outline"}
                                    className="rounded-2xl"
                                    data-testid={`quotation-line-${activeLineIndex}-tab-pricing`}
                                    onClick={() => setCompatibilityTab("pricing")}
                                >
                                    Pricing
                                </Button>
                            </div>

                            {featuredVariants.length ? (
                                <div className="mt-5 grid gap-3 md:grid-cols-3">
                                    {featuredVariants.map((variant, index) => {
                                        const selected = String(variant.id) === String(activeLine.sku_variant_id || "")
                                        return (
                                            <button
                                                key={variant.id}
                                                type="button"
                                                onClick={() => onApplySkuVariant(activeLine.localId, variant.id)}
                                                className={`rounded-[1.45rem] border px-4 py-4 text-left transition ${
                                                    selected
                                                        ? "border-slate-900 bg-slate-900 text-white shadow-[0_18px_40px_-34px_rgba(15,23,42,0.75)]"
                                                        : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white"
                                                }`}
                                            >
                                                <div className="text-[10px] font-black uppercase tracking-[0.22em] opacity-60">
                                                    {index === 0 ? "Recommended" : "Quick pick"}
                                                </div>
                                                <div className="mt-2 text-sm font-black leading-5">{variant.label}</div>
                                                <div className="mt-2 text-xs opacity-70">{variant.detailLabel}</div>
                                            </button>
                                        )
                                    })}
                                </div>
                            ) : null}
                        </div>

                        <div className="grid gap-5 px-6 py-6">
                            {compatibilityTab === "materials" ? (
                                <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 px-5 py-5">
                                    <div className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">Material compatibility</div>
                                    <div className="mt-3 grid gap-4 md:grid-cols-2">
                                        <FieldSelect
                                            label="Layer 1 Family"
                                            testId={`quotation-line-${activeLineIndex}-layer-0-family`}
                                            value={activeLine.film_layers[0]?.family_id || "NONE"}
                                            onChange={(value) => onUpdateLine(activeLine.localId, (current) => ({
                                                ...current,
                                                film_layers: current.film_layers.map((row, idx) => idx === 0 ? { ...row, family_id: value === "NONE" ? "" : value, variant_id: "" } : row),
                                            }))}
                                        >
                                            <SelectItem value="NONE">Select family</SelectItem>
                                            {families.map((family: any) => (
                                                <SelectItem key={family.id} value={family.id}>{family.name}</SelectItem>
                                            ))}
                                        </FieldSelect>
                                        <FieldSelect
                                            label="Layer 1 Variant"
                                            testId={`quotation-line-${activeLineIndex}-layer-0-variant`}
                                            value={activeLine.film_layers[0]?.variant_id || "NONE"}
                                            onChange={(value) => onUpdateLine(activeLine.localId, (current) => ({
                                                ...current,
                                                film_layers: current.film_layers.map((row, idx) => idx === 0 ? { ...row, variant_id: value === "NONE" ? "" : value } : row),
                                            }))}
                                        >
                                            <SelectItem value="NONE">Select variant</SelectItem>
                                            {familyScopedVariants.map((variant: any) => (
                                                <SelectItem key={variant.id} value={variant.id}>{variant.name}</SelectItem>
                                            ))}
                                        </FieldSelect>
                                    </div>
                                </div>
                            ) : null}

                            <div>
                                <div className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">Commercial edits</div>
                                <div className="mt-2 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                                    <FieldNumber
                                        label="Width (mm)"
                                        value={activeLine.geometry.base.width_mm}
                                        onChange={(value) => onUpdateLine(activeLine.localId, (current) => ({ ...current, geometry: { ...current.geometry, base: { ...current.geometry.base, width_mm: value } } }))}
                                    />
                                    <FieldNumber
                                        label="Height (mm)"
                                        value={activeLine.geometry.base.height_mm}
                                        disabled={isRoll}
                                        onChange={(value) => onUpdateLine(activeLine.localId, (current) => ({ ...current, geometry: { ...current.geometry, base: { ...current.geometry.base, height_mm: value } } }))}
                                    />
                                    <FieldNumber
                                        label="Quantity"
                                        inputTestId={`quotation-line-${activeLineIndex}-qty`}
                                        value={activeLine.qty_value}
                                        onChange={(value) => onUpdateLine(activeLine.localId, (current) => ({ ...current, qty_value: value }))}
                                    />
                                    <FieldNumber
                                        label="Sales Quoted Unit Price"
                                        inputTestId={`quotation-line-${activeLineIndex}-manual-unit-price`}
                                        value={asNumber(activeLine.commercial_snapshot.manual_unit_price, 0)}
                                        onChange={(value) => onUpdateLine(activeLine.localId, (current) => ({ ...current, commercial_snapshot: { ...current.commercial_snapshot, manual_unit_price: value } }))}
                                    />
                                </div>
                            </div>

                            <div className="rounded-[1.6rem] border border-slate-200 bg-slate-50/80 px-5 py-5">
                                <div className="grid gap-4 md:grid-cols-3">
                                    <StatPill label="System Estimated Cost" value={formatMoney(activePreview?.costing?.landed_cost, "INR")} />
                                    <StatPill label="Suggested Output" value={formatMoney(activePreview?.costing?.net_total, "INR")} />
                                    <StatPill label="Estimated Margin" value={`${asNumber(activePreview?.costing?.margin_percent, 0).toFixed(1)}%`} />
                                </div>
                            </div>

                            {previewError ? (
                                <div className="rounded-[1.4rem] border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700">{previewError}</div>
                            ) : null}
                        </div>
                    </div>

                    <aside className="relative z-0 border-t border-slate-200 bg-slate-950/95 px-5 py-5 text-white xl:border-l xl:border-t-0 xl:border-slate-800/50">
                        <div className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-300">Seeded from SKU</div>
                        <div className="mt-3 text-2xl font-black tracking-tight">{activeSkuVariant?.name || "No variant selected yet"}</div>
                        <div className="mt-2 text-sm leading-6 text-slate-300">
                            {activeSku ? `${activeSku.code} • ${activeSku.name}` : "Choose a live SKU variant and the line will inherit geometry, layers, print, and packaging."}
                        </div>
                        <div className="mt-5 grid gap-3">
                            <StatPill label="Template" value={activeSkuVariant?.template_name || "Will inherit on selection"} subtle />
                            <StatPill label="Style" value={lockedPouchStyle ? lockedPouchStyle.replaceAll("_", " ") : "Template-led"} subtle />
                            <StatPill label="Quoted Unit Price" value={formatMoney(quotedUnitPrice, "INR")} subtle />
                            <StatPill label="Preview Basis" value={`${activeLine.qty_value} ${activeLine.qty_uom}`} subtle />
                        </div>
                        <div className="mt-6 rounded-[1.35rem] border border-white/10 bg-white/5 px-4 py-4 text-sm leading-6 text-slate-300">
                            Deep material, print, or route edits do not belong in this lane. If the line needs that much shaping, switch it to <span className="font-black text-white">Custom Quote</span>.
                        </div>
                    </aside>
                </div>
            </div>
        </div>
    )
}

function CustomQuoteLane({
    activeLine,
    activeLineIndex,
    activePreview,
    activeTemplate,
    addons,
    draft,
    families,
    familyScopedVariants,
    lockedPouchStyle,
    podProfiles,
    previewError,
    processRates,
    processes,
    quotedUnitPrice,
    showAdvancedLineEditor,
    showGussetField,
    templates,
    onToggleAdvanced,
    onUpdateDraft,
    onUpdateLine,
    onProcessSelect,
}: {
    activeLine: LineDraft
    activeLineIndex: number
    activePreview: QuotationPreview | null
    activeTemplate?: any
    addons: any[]
    draft: QuoteDraft
    families: any[]
    familyScopedVariants: any[]
    lockedPouchStyle: string
    podProfiles: any[]
    previewError: string
    processRates: any[]
    processes: any[]
    quotedUnitPrice: number
    showAdvancedLineEditor: boolean
    showGussetField: boolean
    templates: any[]
    onToggleAdvanced: () => void
    onUpdateDraft: (updates: Partial<QuoteDraft>) => void
    onUpdateLine: (lineId: string, updater: (line: LineDraft) => LineDraft) => void
    onProcessSelect: (lineId: string, rowIndex: number, processId: string) => void
}) {
    const spoutStyle = activeLine.finished_good_type === "POUCH" && isSpoutStyle(lockedPouchStyle)
    return (
        <div className="space-y-5">
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
                <div className="rounded-[1.6rem] border border-slate-200 bg-slate-50/80 px-5 py-5">
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
                        <FieldSelect label="Template" testId={`quotation-line-${activeLineIndex}-template`} value={activeLine.template_id || "NONE"} onChange={(value) => {
                            const selectedTemplate = templates.find((template: any) => String(template.id) === String(value))
                            onUpdateLine(activeLine.localId, (current) => ({
                                ...current,
                                template_id: value === "NONE" ? "" : value,
                                line_name: value === "NONE" ? current.line_name : selectedTemplate?.name || current.line_name,
                                geometry: {
                                    ...current.geometry,
                                    pouch_style: current.finished_good_type === "POUCH" ? normalizePouchStyle(selectedTemplate?.pouch_style || "") : "",
                                },
                            }))
                        }}>
                            <SelectItem value="NONE">Freeform line</SelectItem>
                            {templates.filter((template: any) => template.fg_type === activeLine.finished_good_type).map((template: any) => (
                                <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>
                            ))}
                        </FieldSelect>
                        <FieldShell label="Line Name">
                            <Input className="h-12 rounded-2xl border-slate-200 bg-white" data-testid={`quotation-line-name-${activeLineIndex}`} value={activeLine.line_name} onChange={(event) => onUpdateLine(activeLine.localId, (current) => ({ ...current, line_name: event.target.value }))} />
                        </FieldShell>
                        <FieldNumber label="Width (mm)" value={activeLine.geometry.base.width_mm} onChange={(value) => onUpdateLine(activeLine.localId, (current) => ({ ...current, geometry: { ...current.geometry, base: { ...current.geometry.base, width_mm: value } } }))} />
                        <FieldNumber label="Height (mm)" value={activeLine.geometry.base.height_mm} disabled={activeLine.finished_good_type === "ROLL"} onChange={(value) => onUpdateLine(activeLine.localId, (current) => ({ ...current, geometry: { ...current.geometry, base: { ...current.geometry.base, height_mm: value } } }))} />
                        <FieldNumber inputTestId={`quotation-line-${activeLineIndex}-qty`} label="Quantity" value={activeLine.qty_value} onChange={(value) => onUpdateLine(activeLine.localId, (current) => ({ ...current, qty_value: value }))} />
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                        <Badge className="border border-slate-200 bg-white text-slate-700">{activeTemplate?.name || "Template-led custom line"}</Badge>
                        {lockedPouchStyle ? <Badge className="border border-violet-200 bg-violet-50 text-violet-700">{lockedPouchStyle.replaceAll("_", " ")}</Badge> : null}
                        <Badge className="border border-amber-200 bg-amber-50 text-amber-700">Expert mode</Badge>
                    </div>
                </div>
                <div className="rounded-[1.6rem] border border-slate-200 bg-white px-5 py-5">
                    <div className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-400">Commercial response</div>
                    <div className="mt-3 space-y-2">
                        <InspectorRow label="System Estimated Cost" value={formatMoney(activePreview?.costing?.landed_cost, draft.currency)} />
                        <InspectorRow label="Suggested Output" value={formatMoney(activePreview?.costing?.net_total, draft.currency)} />
                        <InspectorRow label="Sales Quoted Price" value={formatMoney(quotedUnitPrice, draft.currency)} highlight />
                        <InspectorRow label="Estimated Margin" value={`${asNumber(activePreview?.costing?.margin_percent, 0).toFixed(1)}%`} />
                    </div>
                    <div className="mt-5">
                        <Button variant="outline" className="w-full rounded-2xl" onClick={onToggleAdvanced}>
                            {showAdvancedLineEditor ? "Hide Advanced Details" : "Open Advanced Details"}
                        </Button>
                    </div>
                </div>
            </div>

            <div className="rounded-[1.5rem] border border-slate-200 bg-slate-950 px-5 py-5 text-white">
                <div className="grid gap-4 xl:grid-cols-[minmax(0,220px)_repeat(3,minmax(0,1fr))]">
                    <FieldNumber
                        label="Sales Quoted Unit Price"
                        inputTestId={`quotation-line-${activeLineIndex}-manual-unit-price`}
                        value={asNumber(activeLine.commercial_snapshot.manual_unit_price, 0)}
                        onChange={(value) => onUpdateLine(activeLine.localId, (current) => ({ ...current, commercial_snapshot: { ...current.commercial_snapshot, manual_unit_price: value } }))}
                    />
                    <StatPill label="System Cost" value={formatMoney(activePreview?.costing?.landed_cost, draft.currency)} />
                    <StatPill label="Suggested Output" value={formatMoney(activePreview?.costing?.net_total, draft.currency)} />
                    <StatPill label="Estimated Margin" value={`${asNumber(activePreview?.costing?.margin_percent, 0).toFixed(1)}%`} />
                </div>
            </div>

            {previewError ? (
                <div className="rounded-[1.4rem] border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700">{previewError}</div>
            ) : null}

            {showAdvancedLineEditor ? (
                <>
                    <Tabs defaultValue="spec" className="space-y-5">
                        <TabsList className="grid h-12 grid-cols-3 rounded-2xl bg-slate-100 p-1">
                            <TabsTrigger value="spec" className="rounded-2xl font-black" data-testid={`quotation-line-${activeLineIndex}-tab-spec`}>Specification</TabsTrigger>
                            <TabsTrigger value="materials" className="rounded-2xl font-black" data-testid={`quotation-line-${activeLineIndex}-tab-materials`}>Materials</TabsTrigger>
                            <TabsTrigger value="pricing" className="rounded-2xl font-black" data-testid={`quotation-line-${activeLineIndex}-tab-pricing`}>Pricing</TabsTrigger>
                        </TabsList>

                        <TabsContent value="spec" className="space-y-5">
                            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                                <FieldShell label="Product Type">
                                    <div className="grid grid-cols-2 gap-2">
                                        {(["POUCH", "ROLL"] as const).map((type) => (
                                            <button
                                                key={type}
                                                type="button"
                                                onClick={() => onUpdateLine(activeLine.localId, (current) => ({
                                                    ...current,
                                                    finished_good_type: type,
                                                    roll_form: type === "ROLL" ? (current.roll_form || "FLAT") : "",
                                                    qty_uom: type === "ROLL" ? "KG" : current.qty_uom,
                                                    price_basis: type === "ROLL" ? "KG" : current.price_basis,
                                                    geometry: { ...current.geometry, base: { ...current.geometry.base, height_mm: type === "ROLL" ? 0 : current.geometry.base.height_mm } },
                                                }))}
                                                className={`rounded-2xl border px-4 py-3 text-left text-sm transition ${activeLine.finished_good_type === type ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white"}`}
                                            >
                                                <div className="font-black">{type}</div>
                                            </button>
                                        ))}
                                    </div>
                                </FieldShell>
                                <FieldSelect label="Roll Form" value={activeLine.finished_good_type === "ROLL" ? (activeLine.roll_form || "FLAT") : "NONE"} onChange={(value) => onUpdateLine(activeLine.localId, (current) => ({ ...current, roll_form: value as LineDraft["roll_form"] }))}>
                                    {activeLine.finished_good_type !== "ROLL" ? <SelectItem value="NONE">Not applicable</SelectItem> : null}
                                    <SelectItem value="FLAT">Flat</SelectItem>
                                    <SelectItem value="FOLDED">Folded</SelectItem>
                                    <SelectItem value="TUBING">Tubing</SelectItem>
                                </FieldSelect>
                                {showGussetField ? <FieldNumber label="Gusset (mm)" value={asNumber(activeLine.geometry.gusset_mm, 0)} onChange={(value) => onUpdateLine(activeLine.localId, (current) => ({ ...current, geometry: { ...current.geometry, gusset_mm: value } }))} /> : null}
                                <FieldNumber label="Faces" value={asNumber(activeLine.geometry.multipliers.faces, 1)} onChange={(value) => onUpdateLine(activeLine.localId, (current) => ({ ...current, geometry: { ...current.geometry, multipliers: { faces: value || 1 } } }))} />
                            </div>
                        </TabsContent>

                        <TabsContent value="materials" className="space-y-5">
                            <div className="rounded-[1.4rem] border border-slate-200 bg-slate-50 px-4 py-4">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <div className="text-sm font-black text-slate-800">Layer stack</div>
                                        <div className="text-sm text-slate-500">Use only when the line truly needs technical deviation from the template.</div>
                                    </div>
                                    <Button variant="outline" className="rounded-2xl" onClick={() => onUpdateLine(activeLine.localId, (current) => ({ ...current, film_layers: [...current.film_layers, makeLayer()] }))}>
                                        <Plus className="mr-2 h-4 w-4" /> Add Layer
                                    </Button>
                                </div>
                                <div className="mt-4 space-y-3">
                                    {activeLine.film_layers.map((layer, layerIndex) => (
                                        <div key={layer.localId} className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-3 xl:grid-cols-[1.2fr_1.2fr_140px_auto]">
                                            <FieldSelect label={`Layer ${layerIndex + 1} Family`} testId={`quotation-line-${activeLineIndex}-layer-${layerIndex}-family`} value={layer.family_id || "NONE"} onChange={(value) => onUpdateLine(activeLine.localId, (current) => ({ ...current, film_layers: current.film_layers.map((row, idx) => idx === layerIndex ? { ...row, family_id: value === "NONE" ? "" : value, variant_id: "" } : row) }))}>
                                                <SelectItem value="NONE">Select family</SelectItem>
                                                {families.map((family: any) => (
                                                    <SelectItem key={family.id} value={family.id}>{family.name}</SelectItem>
                                                ))}
                                            </FieldSelect>
                                            <FieldSelect label={`Layer ${layerIndex + 1} Variant`} testId={`quotation-line-${activeLineIndex}-layer-${layerIndex}-variant`} value={layer.variant_id || "NONE"} onChange={(value) => onUpdateLine(activeLine.localId, (current) => ({ ...current, film_layers: current.film_layers.map((row, idx) => idx === layerIndex ? { ...row, variant_id: value === "NONE" ? "" : value } : row) }))}>
                                                <SelectItem value="NONE">Select variant</SelectItem>
                                                {familyScopedVariants.map((variant: any) => (
                                                    <SelectItem key={variant.id} value={variant.id}>{variant.name}</SelectItem>
                                                ))}
                                            </FieldSelect>
                                            <FieldNumber label="Thickness (μ)" value={layer.thickness_micron} onChange={(value) => onUpdateLine(activeLine.localId, (current) => ({ ...current, film_layers: current.film_layers.map((row, idx) => idx === layerIndex ? { ...row, thickness_micron: value } : row) }))} />
                                            <Button variant="outline" className="rounded-2xl text-rose-600 self-end" onClick={() => onUpdateLine(activeLine.localId, (current) => ({ ...current, film_layers: current.film_layers.filter((_, idx) => idx !== layerIndex) }))} disabled={activeLine.film_layers.length === 1}>
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div className="grid gap-4 lg:grid-cols-2">
                                <div className="rounded-[1.4rem] border border-slate-200 bg-slate-50 px-4 py-4">
                                    <div className="flex items-center justify-between">
                                        <div className="text-sm font-black text-slate-800">Printing</div>
                                        <div className="flex items-center gap-2 text-sm text-slate-600">
                                            <Switch checked={activeLine.printing.enabled} onCheckedChange={(checked) => onUpdateLine(activeLine.localId, (current) => ({ ...current, printing: { ...current.printing, enabled: checked } }))} />
                                            Enabled
                                        </div>
                                    </div>
                                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                                        <FieldSelect label="Print Type" value={activeLine.printing.type} onChange={(value) => onUpdateLine(activeLine.localId, (current) => ({ ...current, printing: { ...current.printing, type: value as LineDraft["printing"]["type"] } }))}>
                                            <SelectItem value="FLEXO">FLEXO</SelectItem>
                                            <SelectItem value="ROTO">ROTO</SelectItem>
                                            <SelectItem value="DIGITAL">DIGITAL</SelectItem>
                                        </FieldSelect>
                                        <FieldNumber label="Ink GSM" value={activeLine.printing.ink_gsm_total} onChange={(value) => onUpdateLine(activeLine.localId, (current) => ({ ...current, printing: { ...current.printing, ink_gsm_total: value } }))} />
                                    </div>
                                </div>
                                <div className="rounded-[1.4rem] border border-slate-200 bg-slate-50 px-4 py-4">
                                    <div className="text-sm font-black text-slate-800">POD and additives</div>
                                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                                        <FieldNumber label="Adhesive GSM" value={activeLine.chemicals.adhesive_gsm} onChange={(value) => onUpdateLine(activeLine.localId, (current) => ({ ...current, chemicals: { ...current.chemicals, adhesive_gsm: value } }))} />
                                        <FieldNumber label="Solvent GSM" value={activeLine.chemicals.solvent_gsm} onChange={(value) => onUpdateLine(activeLine.localId, (current) => ({ ...current, chemicals: { ...current.chemicals, solvent_gsm: value } }))} />
                                    </div>
                                    <div className="mt-4">
                                        <FieldSelect label="POD Profile" value={activeLine.packaging_snapshot.pod.pod_profile_id || "NONE"} onChange={(value) => {
                                            const selected = podProfiles.find((entry: any) => String(entry.id) === String(value))
                                            onUpdateLine(activeLine.localId, (current) => ({
                                                ...current,
                                                packaging_snapshot: {
                                                    ...current.packaging_snapshot,
                                                    pod: {
                                                        ...current.packaging_snapshot.pod,
                                                        enabled: value !== "NONE",
                                                        pod_profile_id: value === "NONE" ? "" : value,
                                                        pod_sku_variant_id: selected?.id || "",
                                                        pod_sku_code: selected?.code || "",
                                                        pod_sku_name: selected?.name || "",
                                                    },
                                                },
                                            }))
                                        }}>
                                            <SelectItem value="NONE">No POD profile</SelectItem>
                                            {podProfiles.map((entry: any) => (
                                                <SelectItem key={entry.id} value={entry.id}>{entry.code} • {entry.name}</SelectItem>
                                            ))}
                                        </FieldSelect>
                                    </div>
                                </div>
                            </div>
                            <div className="rounded-[1.4rem] border border-slate-200 bg-slate-50 px-4 py-4">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <div className="text-sm font-black text-slate-800">Approved add-ons</div>
                                        <div className="text-sm text-slate-500">{spoutStyle ? "Spout-compatible add-ons are ranked first." : "Optional add-ons stay out of the common flow until explicitly opened."}</div>
                                    </div>
                                    <Button variant="outline" className="rounded-2xl" onClick={() => onUpdateLine(activeLine.localId, (current) => ({ ...current, addons: [...current.addons, makeAddon()] }))}>
                                        <Plus className="mr-2 h-4 w-4" /> Add Add-on
                                    </Button>
                                </div>
                                <div className="mt-4 space-y-3">
                                    {activeLine.addons.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-4 text-sm text-slate-500">No add-ons configured.</div> : null}
                                    {activeLine.addons.map((addon, addonIndex) => {
                                        const addonMeta = addons.find((entry: any) => String(entry.id) === String(addon.addon_id))
                                        const mode = String(addonMeta?.weight_mode || "PER_PIECE").toUpperCase()
                                        return (
                                            <div key={addon.localId} className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-3 xl:grid-cols-[1.2fr_120px_180px_auto]">
                                                <FieldSelect label={`Add-on ${addonIndex + 1}`} value={addon.addon_id || "NONE"} onChange={(value) => onUpdateLine(activeLine.localId, (current) => ({ ...current, addons: current.addons.map((row, idx) => idx === addonIndex ? { ...row, addon_id: value === "NONE" ? "" : value } : row) }))}>
                                                    <SelectItem value="NONE">Select add-on</SelectItem>
                                                    {addons.map((entry: any) => (
                                                        <SelectItem key={entry.id} value={entry.id}>{entry.name}</SelectItem>
                                                    ))}
                                                </FieldSelect>
                                                <FieldNumber label="Qty" value={addon.qty} onChange={(value) => onUpdateLine(activeLine.localId, (current) => ({ ...current, addons: current.addons.map((row, idx) => idx === addonIndex ? { ...row, qty: value } : row) }))} />
                                                {mode === "PER_MM" ? (
                                                    <FieldSelect label="Applies To" value={addon.applies_to} onChange={(value) => onUpdateLine(activeLine.localId, (current) => ({ ...current, addons: current.addons.map((row, idx) => idx === addonIndex ? { ...row, applies_to: value as AddonDraft["applies_to"] } : row) }))}>
                                                        <SelectItem value="WIDTH">Per MM - Width</SelectItem>
                                                        <SelectItem value="HEIGHT">Per MM - Height</SelectItem>
                                                        <SelectItem value="BOTH">Per MM - Both</SelectItem>
                                                    </FieldSelect>
                                                ) : (
                                                    <div className="self-end rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-500">{mode === "FIXED" ? "Fixed weight add-on" : "Per piece add-on"}</div>
                                                )}
                                                <Button variant="outline" className="rounded-2xl text-rose-600 self-end" onClick={() => onUpdateLine(activeLine.localId, (current) => ({ ...current, addons: current.addons.filter((_, idx) => idx !== addonIndex) }))}>
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        )
                                    })}
                                </div>
                            </div>
                        </TabsContent>

                        <TabsContent value="pricing" className="space-y-5">
                            <div className="rounded-[1.4rem] border border-slate-200 bg-slate-50 px-4 py-4">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <div className="text-sm font-black text-slate-800">Commercial route</div>
                                        <div className="text-sm text-slate-500">Template-seeded when available. Sales can refine commercial route assumptions without touching the manufacturing route master.</div>
                                    </div>
                                    <Button variant="outline" className="rounded-2xl" onClick={() => onUpdateLine(activeLine.localId, (current) => ({ ...current, process_cost_rows: [...current.process_cost_rows, { ...makeProcessRow(), sequence: current.process_cost_rows.length + 1 }] }))}>
                                        <Plus className="mr-2 h-4 w-4" /> Add Process
                                    </Button>
                                </div>
                                <div className="mt-4 space-y-3">
                                    {activeLine.process_cost_rows.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-4 text-sm text-slate-500">No process rows yet. Add them only if this custom quote needs route-specific commercial logic.</div> : null}
                                    {activeLine.process_cost_rows.map((row, rowIndex) => (
                                        <div key={`${activeLine.localId}-${rowIndex}`} className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-3 xl:grid-cols-[1.2fr_120px_120px_120px_auto]">
                                            <FieldSelect label={`Process ${rowIndex + 1}`} value={row.process_id || "NONE"} onChange={(value) => onProcessSelect(activeLine.localId, rowIndex, value === "NONE" ? "" : value)}>
                                                <SelectItem value="NONE">Select process</SelectItem>
                                                {processes.map((process: any) => (
                                                    <SelectItem key={process.id} value={process.id}>{process.name}</SelectItem>
                                                ))}
                                            </FieldSelect>
                                            <FieldShell label="Rate / Hr">
                                                <Input type="number" value={row.hourly_rate ?? processRates.find((entry: any) => entry.process === row.process_id)?.cost_per_hour ?? 0} onChange={(event) => onUpdateLine(activeLine.localId, (current) => ({ ...current, process_cost_rows: current.process_cost_rows.map((entry, idx) => idx === rowIndex ? { ...entry, hourly_rate: asNumber(event.target.value, 0) } : entry) }))} />
                                            </FieldShell>
                                            <FieldShell label="Setup Hr">
                                                <Input type="number" value={row.setup_hours ?? 0} onChange={(event) => onUpdateLine(activeLine.localId, (current) => ({ ...current, process_cost_rows: current.process_cost_rows.map((entry, idx) => idx === rowIndex ? { ...entry, setup_hours: asNumber(event.target.value, 0) } : entry) }))} />
                                            </FieldShell>
                                            <FieldShell label="Run Hr">
                                                <Input type="number" value={row.run_hours ?? 0} onChange={(event) => onUpdateLine(activeLine.localId, (current) => ({ ...current, process_cost_rows: current.process_cost_rows.map((entry, idx) => idx === rowIndex ? { ...entry, run_hours: asNumber(event.target.value, 0) } : entry) }))} />
                                            </FieldShell>
                                            <Button variant="outline" className="rounded-2xl text-rose-600 self-end" onClick={() => onUpdateLine(activeLine.localId, (current) => ({ ...current, process_cost_rows: current.process_cost_rows.filter((_, idx) => idx !== rowIndex).map((entry, idx) => ({ ...entry, sequence: idx + 1 })) }))}>
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div className="rounded-[1.4rem] border border-slate-200 bg-slate-50 px-4 py-4">
                                <div className="text-sm font-black text-slate-800">Commercial overrides</div>
                                <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                                    <FieldNumber label="Margin %" value={asNumber(activeLine.commercial_snapshot.margin_target_percent, 15)} onChange={(value) => onUpdateLine(activeLine.localId, (current) => ({ ...current, commercial_snapshot: { ...current.commercial_snapshot, margin_target_percent: value } }))} />
                                    <FieldNumber label="Tax %" value={asNumber(activeLine.commercial_snapshot.tax_percent, 18)} onChange={(value) => onUpdateLine(activeLine.localId, (current) => ({ ...current, commercial_snapshot: { ...current.commercial_snapshot, tax_percent: value } }))} />
                                    <FieldNumber label="Wastage %" value={asNumber(activeLine.commercial_snapshot.wastage_percent, 0)} onChange={(value) => onUpdateLine(activeLine.localId, (current) => ({ ...current, commercial_snapshot: { ...current.commercial_snapshot, wastage_percent: value } }))} />
                                    <FieldNumber label="Packing Value" value={asNumber(activeLine.commercial_snapshot.packing_value, 0)} onChange={(value) => onUpdateLine(activeLine.localId, (current) => ({ ...current, commercial_snapshot: { ...current.commercial_snapshot, packing_value: value } }))} />
                                    <FieldNumber label="Freight Value" value={asNumber(activeLine.commercial_snapshot.freight_value, 0)} onChange={(value) => onUpdateLine(activeLine.localId, (current) => ({ ...current, commercial_snapshot: { ...current.commercial_snapshot, freight_value: value } }))} />
                                    <FieldNumber label="Misc Value" value={asNumber(activeLine.commercial_snapshot.misc_value, 0)} onChange={(value) => onUpdateLine(activeLine.localId, (current) => ({ ...current, commercial_snapshot: { ...current.commercial_snapshot, misc_value: value } }))} />
                                </div>
                            </div>
                        </TabsContent>
                    </Tabs>
                    <div className="grid gap-4 lg:grid-cols-2">
                        <FieldArea label="Commercial Terms" value={draft.terms} onChange={(value) => onUpdateDraft({ terms: value })} />
                        <FieldArea label="Notes" value={draft.notes} onChange={(value) => onUpdateDraft({ notes: value })} />
                    </div>
                </>
            ) : null}
        </div>
    )
}

function buildLinePayload(line: LineDraft, families: any[], variants: any[], addons: any[], plantId?: string): QuotationLinePayload {
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
        plant: plantId || null,
        sku_variant_id: line.sku_variant_id || null,
        source_mode: line.sku_variant_id ? "SKU" : "CUSTOM",
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
            pouch_style: line.finished_good_type === "POUCH" ? String(line.geometry.pouch_style || "").toUpperCase() : "",
            gusset_mm: line.finished_good_type === "POUCH" ? asNumber(line.geometry.gusset_mm, 0) : 0,
            trim_loss_mm: line.finished_good_type === "POUCH" ? asNumber(line.geometry.trim_loss_mm, 0) : 0,
            flap_tape_mm: line.finished_good_type === "POUCH" ? asNumber(line.geometry.flap_tape_mm, 0) : 0,
            adjustments: line.geometry.adjustments.map((adjustment) => ({ name: adjustment.name, value: asNumber(adjustment.value, 0), impact: adjustment.impact })),
            multipliers: { faces: asNumber(line.geometry.multipliers.faces, 1) || 1 },
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
        addons: line.addons.map((addon) => {
            const master = addons.find((entry: any) => String(entry.id) === String(addon.addon_id))
            const masterMode = String(master?.weight_mode || "PER_PIECE").toUpperCase()
            const finalWeightMode = masterMode === "PER_MM" ? "PER_MM" : masterMode === "FIXED" ? "FIXED" : "PER_PIECE"
            const finalAppliesTo = finalWeightMode === "PER_MM"
                ? (addon.applies_to === "HEIGHT" ? "HEIGHT" : addon.applies_to === "BOTH" ? "BOTH" : "WIDTH")
                : "NONE"
            return {
                addon_id: addon.addon_id,
                code: String(master?.code || ""),
                name: String(master?.name || ""),
                qty: asNumber(addon.qty, 1),
                applies_to: finalAppliesTo,
                weight_mode: finalWeightMode,
                weight_value: asNumber(master?.weight_value, 0),
            }
        }),
        packaging_snapshot: {
            primary_inner_pack: { enabled: false, material_id: null, pcs_per_pack: 0 },
            roll_dispatch_pack: { enabled: false, lines: [] },
            pod: {
                enabled: Boolean(line.packaging_snapshot.pod.enabled),
                pod_profile_id: line.packaging_snapshot.pod.pod_profile_id || null,
                pod_sku_variant_id: line.packaging_snapshot.pod.pod_sku_variant_id || null,
                pod_sku_code: line.packaging_snapshot.pod.pod_sku_code || null,
                pod_sku_name: line.packaging_snapshot.pod.pod_sku_name || null,
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

function FieldShell({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="space-y-2">
            {label ? <Label className="text-[11px] font-black uppercase tracking-[0.2em] text-slate-500">{label}</Label> : null}
            {children}
        </div>
    )
}

function FieldArea({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
    return (
        <FieldShell label={label}>
            <Textarea className="min-h-[128px] rounded-[1.4rem] border-slate-200 bg-white" value={value} onChange={(event) => onChange(event.target.value)} />
        </FieldShell>
    )
}

function FieldSelect({
    label,
    value,
    onChange,
    children,
    testId,
}: {
    label: string
    value: string
    onChange: (value: string) => void
    children: React.ReactNode
    testId?: string
}) {
    return (
        <FieldShell label={label}>
            <Select value={value} onValueChange={onChange}>
                <SelectTrigger className="h-12 rounded-2xl border-slate-200 bg-white" data-testid={testId}>
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>{children}</SelectContent>
            </Select>
        </FieldShell>
    )
}

function FieldNumber({
    label,
    value,
    onChange,
    disabled,
    inputTestId,
}: {
    label: string
    value: number
    onChange: (value: number) => void
    disabled?: boolean
    inputTestId?: string
}) {
    return (
        <FieldShell label={label}>
            <Input
                type="number"
                className="h-12 rounded-2xl border-slate-200 bg-white"
                data-testid={inputTestId}
                value={value}
                disabled={disabled}
                onChange={(event) => onChange(asNumber(event.target.value, 0))}
            />
        </FieldShell>
    )
}

function StatPill({ label, value, subtle = false }: { label: string; value: string; subtle?: boolean }) {
    return (
        <div className={`rounded-2xl border px-3 py-3 ${subtle ? "border-slate-200 bg-white" : "border-slate-200 bg-slate-50"}`}>
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">{label}</div>
            <div className="mt-2 text-sm font-black text-slate-900">{value}</div>
        </div>
    )
}

function InspectorRow({
    label,
    value,
    highlight = false,
    inverted = false,
}: {
    label: string
    value: string
    highlight?: boolean
    inverted?: boolean
}) {
    return (
        <div className={`flex items-center justify-between rounded-2xl px-3 py-2 ${highlight ? (inverted ? "bg-white/10" : "bg-white") : "bg-transparent"}`}>
            <span className={inverted ? "text-slate-300" : "text-slate-500"}>{label}</span>
            <span className={`font-black ${inverted ? "text-white" : "text-slate-900"}`}>{value}</span>
        </div>
    )
}

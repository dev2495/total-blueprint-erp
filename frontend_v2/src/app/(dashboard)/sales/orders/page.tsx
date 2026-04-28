"use client"

import Link from "next/link"
import { useDeferredValue, useEffect, useMemo, useState, type ReactNode } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
    Activity,
    ArrowUpDown,
    CalendarDays,
    CheckCircle2,
    Download,
    Grid2X2,
    Loader2,
    Plus,
    Search,
    SlidersHorizontal,
    XCircle,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
    formatSalesDate,
    formatSalesMoney,
    SalesOverflowChipGroup,
    SalesSavedViewsBar,
    SalesSmartRangeFilter,
    SalesSpecChip,
    SALES_GRADE_PRIORITY,
    SALES_MATERIAL_PRIORITY,
    SALES_SUPPORTED_FG_TYPES,
    salesMaterialFilterLabel,
    salesSortChipOptions,
    salesSpecMatchesMaterialFilter,
    salesUniqueText,
    type SalesOverflowChipOption,
    type SalesSavedViewFilters,
} from "@/components/sales/sales-flow-ui"
import { cn } from "@/lib/utils"
import { normalizeProductSpec, type ProductSpec } from "@/lib/product-spec"
import { filmFamilyService } from "@/services/film-families"
import { filmVariantService } from "@/services/film-variants"
import { recipeService } from "@/services/recipes"
import { type SalesOrder, salesService } from "@/services/sales"

type OrderTab = "queue" | "history"
type StatusFilter = "ALL" | "DRAFT" | "CONFIRMED" | "PLANNING_REQUIRED" | "PLANNED" | "RELEASED" | "PACKING_READY" | "DISPATCH_READY" | "COMPLETED" | "CANCELLED"
type CreatedWindow = "ALL" | "TODAY" | "LAST_7" | "LAST_30" | "OLDER_30" | "NO_DATE"

type EnrichedOrder = {
    order: SalesOrder
    spec: ProductSpec
    normalizedStatus: string
    searchable: string
}

const PAGE_SIZE = 80

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
    { value: "PLANNING_REQUIRED", label: "Planning" },
    { value: "PLANNED", label: "Planned" },
    { value: "RELEASED", label: "Released" },
    { value: "PACKING_READY", label: "Packing" },
    { value: "DISPATCH_READY", label: "Dispatch" },
]

function safeNumber(value: unknown) {
    const num = Number(value)
    return Number.isFinite(num) ? num : 0
}

function compact(value: number | null | undefined, maxDigits = 1) {
    const num = Number(value)
    if (!Number.isFinite(num)) return ""
    if (Number.isInteger(num)) return num.toLocaleString("en-IN")
    return num.toLocaleString("en-IN", { maximumFractionDigits: maxDigits })
}

function isCompletedOrder(order: SalesOrder) {
    return ["COMPLETED", "CANCELLED"].includes(String(order.status || "").toUpperCase())
}

function canCancelBeforeRelease(order: SalesOrder) {
    return ["DRAFT", "CONFIRMED", "PLANNING_REQUIRED", "PLANNED"].includes(String(order.status || "").toUpperCase())
}

function orderCreatedDate(order: SalesOrder) {
    return order.created_at || (order as any).order_created_at || null
}

function createdMatches(value: string | null | undefined, window: CreatedWindow) {
    if (window === "ALL") return true
    if (!value) return window === "NO_DATE"
    const ts = new Date(value).getTime()
    if (Number.isNaN(ts)) return window === "NO_DATE"
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const oneDay = 24 * 60 * 60 * 1000
    if (window === "TODAY") return ts >= today.getTime() && ts < today.getTime() + oneDay
    if (window === "LAST_7") return ts >= today.getTime() - oneDay * 7
    if (window === "LAST_30") return ts >= today.getTime() - oneDay * 30
    if (window === "OLDER_30") return ts < today.getTime() - oneDay * 30
    return true
}

function orderQuantityLabel(order: SalesOrder) {
    const qty = order.qty_summary || {}
    if (qty.ordered_pcs != null) return `${safeNumber(qty.ordered_pcs).toLocaleString("en-IN")} pcs`
    return `${safeNumber(qty.ordered_kg).toLocaleString("en-IN", { maximumFractionDigits: 2 })} kg`
}

function progressParts(order: SalesOrder) {
    const summary = order.fulfillment_summary || {}
    const qty = order.qty_summary || {}
    const orderedBasis = safeNumber(qty.ordered_pcs ?? qty.ordered_kg)
    const producedBasis = qty.ordered_pcs != null ? safeNumber(summary.produced_pcs) : safeNumber(summary.produced_kg)
    const dispatchedBasis = qty.ordered_pcs != null ? safeNumber(summary.dispatched_pcs) : safeNumber(summary.dispatched_kg)
    const remainingBasis = qty.ordered_pcs != null ? safeNumber(summary.remaining_pcs) : safeNumber(summary.remaining_kg)
    const total = Math.max(orderedBasis, producedBasis, dispatchedBasis + remainingBasis, 0)
    if (!total) return { pct: 0, producedLabel: "0", totalLabel: orderQuantityLabel(order), dispatchedPct: 0, producedOpenPct: 0, remainingPct: 100 }
    const dispatchedPct = Math.max(0, Math.min(100, (dispatchedBasis / total) * 100))
    const producedOpenPct = Math.max(0, Math.min(100 - dispatchedPct, ((producedBasis - dispatchedBasis) / total) * 100))
    return {
        pct: Math.max(0, Math.min(100, safeNumber(summary.completion_percent) || ((producedBasis / total) * 100))),
        producedLabel: qty.ordered_pcs != null ? compact(producedBasis, 0) : `${compact(producedBasis, 1)} kg`,
        totalLabel: qty.ordered_pcs != null ? `${compact(total, 0)} pcs` : `${compact(total, 1)} kg`,
        dispatchedPct,
        producedOpenPct,
        remainingPct: Math.max(0, 100 - dispatchedPct - producedOpenPct),
    }
}

function statusTone(status: string) {
    const normalized = String(status || "").toUpperCase()
    if (normalized === "COMPLETED") return "border-emerald-200 bg-emerald-50 text-emerald-700"
    if (normalized === "CANCELLED") return "border-rose-200 bg-rose-50 text-rose-700"
    if (normalized === "PLANNING_REQUIRED") return "border-amber-200 bg-amber-50 text-amber-700"
    if (normalized === "PLANNED") return "border-blue-200 bg-blue-50 text-blue-700"
    if (normalized === "RELEASED") return "border-blue-200 bg-blue-50 text-blue-700"
    if (normalized === "PACKING_READY" || normalized === "DISPATCH_READY") return "border-cyan-200 bg-cyan-50 text-cyan-700"
    return "border-slate-200 bg-slate-50 text-slate-700"
}

function fgTone(value?: string) {
    const normalized = String(value || "").toUpperCase()
    if (normalized === "ROLL") return "fgRoll" as const
    if (normalized === "POUCH") return "fgPouch" as const
    return "muted" as const
}

function layerChipLabel(layer: ProductSpec["layers"][number]) {
    return [
        `L${layer.index}`,
        layer.variantName || layer.variantCode,
        layer.grade,
        layer.thicknessMicron !== null ? `${compact(layer.thicknessMicron, 1)}μ` : "",
        layer.widthMm !== null ? `${compact(layer.widthMm, 0)}mm` : "",
    ].filter(Boolean).join(" · ")
}

function uniqueNonEmpty(values: Array<string | null | undefined>, limit = 40) {
    return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean))).slice(0, limit)
}

function parseRange(value: string) {
    const raw = value.trim()
    if (!raw) return { min: null as number | null, max: null as number | null }
    const parts = raw.split(/[,-]/).map((part) => Number(part.trim())).filter(Number.isFinite)
    if (!parts.length) return { min: null, max: null }
    if (parts.length === 1) return { min: parts[0], max: parts[0] }
    return { min: Math.min(parts[0], parts[1]), max: Math.max(parts[0], parts[1]) }
}

function numberInRange(value: number | null, rangeText: string) {
    const { min, max } = parseRange(rangeText)
    if (min === null && max === null) return true
    if (value === null) return false
    if (min !== null && max !== null && min === max) return Math.round(value) === Math.round(min)
    if (min !== null && value < min) return false
    if (max !== null && value > max) return false
    return true
}

function specMatches({
    spec,
    fgTypeFilter,
    materialFilter,
    gradeFilter,
    sizeFilter,
    heightFilter,
    thicknessFilter,
}: {
    spec: ProductSpec
    fgTypeFilter: string
    materialFilter: string
    gradeFilter: string
    sizeFilter: string
    heightFilter: string
    thicknessFilter: string
}) {
    const fgType = String(spec.size.finishedGoodType || "").toUpperCase()
    if (fgTypeFilter !== "all" && fgType !== fgTypeFilter.toUpperCase()) return false
    if (materialFilter !== "all") {
        if (!salesSpecMatchesMaterialFilter(spec, materialFilter)) return false
    }
    if (gradeFilter !== "all") {
        const haystack = spec.layers.map((layer) => layer.grade).join(" ").toLowerCase()
        if (!haystack.includes(gradeFilter.toLowerCase())) return false
    }
    if (sizeFilter.trim()) {
        const q = sizeFilter.trim().toLowerCase()
        const numericMatch = numberInRange(spec.size.widthMm, q)
        if (!numericMatch && !spec.size.label.toLowerCase().includes(q)) return false
    }
    if (heightFilter.trim() && !numberInRange(spec.size.heightMm, heightFilter)) return false
    if (thicknessFilter.trim()) {
        const rangeMatch = spec.layers.some((layer) => numberInRange(layer.thicknessMicron, thicknessFilter))
        if (!rangeMatch) return false
    }
    return true
}

function HeroMetric({
    label,
    value,
    sub,
}: {
    label: string
    value: string | number
    sub?: string
}) {
    return (
        <div className="rounded-xl border border-white/20 bg-white/10 px-3 py-2.5 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] backdrop-blur">
            <div className="text-[9px] font-black uppercase tracking-[0.18em] text-white/65">{label}</div>
            <div className="mt-1.5 text-2xl font-black tracking-tight">{value}</div>
            {sub ? <div className="mt-0.5 text-[11px] font-semibold text-white/65">{sub}</div> : null}
        </div>
    )
}

function FilterPill({
    active,
    children,
    onClick,
}: {
    active?: boolean
    children: ReactNode
    onClick: () => void
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                "inline-flex h-9 shrink-0 items-center gap-2 rounded-full border px-3 text-xs font-black transition hover:border-violet-300 hover:bg-violet-50",
                active ? "border-violet-500 bg-violet-600 text-white shadow-[0_14px_24px_-18px_rgba(124,58,237,0.72)]" : "border-slate-200 bg-white text-slate-700"
            )}
        >
            {children}
        </button>
    )
}

function makeRangePresets(values: Array<number | null | undefined>, suffix: string) {
    const counts = new Map<number, number>()
    values.forEach((value) => {
        const num = Number(value)
        if (!Number.isFinite(num) || num <= 0) return
        const rounded = Math.round(num)
        counts.set(rounded, (counts.get(rounded) || 0) + 1)
    })
    return Array.from(counts.entries())
        .sort((left, right) => right[1] - left[1] || left[0] - right[0])
        .slice(0, 10)
        .map(([value, count]) => ({ value: String(value), label: `${value} ${suffix}`, count }))
}

function StatusBadge({ status }: { status: string }) {
    return (
        <span className={cn("inline-flex rounded-lg border px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.08em]", statusTone(status))}>
            {String(status || "Status").replaceAll("_", " ")}
        </span>
    )
}

function AttributeChips({ order, spec }: { order: SalesOrder; spec: ProductSpec }) {
    const fg = String(spec.size.finishedGoodType || order.item_summary?.finished_good_type || "").toUpperCase()
    const printLabel = order.item_summary?.printing_summary || (spec.podLabels.find((label) => /print|flexo|roto|color/i.test(label)) || "No print")
    const addons = spec.hasAddons ? spec.addonLabels.slice(0, 2) : []
    const pod = spec.hasPod ? spec.podLabels.filter((label) => !/print|flexo|roto|color/i.test(label)).slice(0, 1) : []
    const layers = spec.layers.slice(0, 3)
    return (
        <div className="flex min-w-0 flex-wrap gap-1.5">
            {fg ? <SalesSpecChip tone={fgTone(fg)}>{fg}</SalesSpecChip> : null}
            <SalesSpecChip tone="size">{spec.size.label}</SalesSpecChip>
            {layers.map((layer) => (
                <SalesSpecChip key={`${layer.index}-${layer.label}`} tone="material" className="max-w-[18rem] truncate">
                    {layerChipLabel(layer)}
                </SalesSpecChip>
            ))}
            {spec.layers.length > layers.length ? <SalesSpecChip tone="material">+{spec.layers.length - layers.length} layers</SalesSpecChip> : null}
            {printLabel ? <SalesSpecChip tone={printLabel === "No print" ? "muted" : "print"}>{printLabel}</SalesSpecChip> : null}
            {spec.templateName ? <SalesSpecChip tone="template">{spec.templateName}</SalesSpecChip> : null}
            {pod.length ? pod.map((label) => <SalesSpecChip key={`pod-${label}`} tone="pack">POD {label}</SalesSpecChip>) : null}
            {addons.length ? addons.map((label) => <SalesSpecChip key={`addon-${label}`} tone="pack">{label}</SalesSpecChip>) : null}
        </div>
    )
}

function OrderQueueRow({
    item,
    tab,
    onCancel,
    cancelPending,
}: {
    item: EnrichedOrder
    tab: OrderTab
    onCancel: (order: SalesOrder) => void
    cancelPending: boolean
}) {
    const { order, spec } = item
    const progress = progressParts(order)
    const variantId = spec.variantCode || order.item_summary?.variant_code || order.item_summary?.template_tag || "Variant pending"
    const variantLabel = spec.variantName || order.item_summary?.variant_name || order.line_name || spec.productName
    const isHistory = tab === "history"

    return (
        <div className="grid min-h-[5.5rem] min-w-[1120px] grid-cols-[10rem_13rem_minmax(27rem,1fr)_15rem_12rem_10rem] items-center gap-4 border-b border-slate-100 px-4 py-3 transition hover:bg-blue-50/45">
            <div className="min-w-0">
                <div className="font-mono text-sm font-black text-blue-900">{order.order_number}</div>
                <div className="mt-1 truncate text-xs font-bold text-slate-600">{order.customer_name || "Customer"}</div>
                <div className="mt-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">{order.order_type || "MTO"}</div>
            </div>
            <div className="min-w-0">
                <div className="truncate font-mono text-xs font-black text-slate-950">{variantId}</div>
                <div className="mt-1 line-clamp-2 text-xs font-bold text-slate-500">{variantLabel}</div>
            </div>
            <AttributeChips order={order} spec={spec} />
            <div className="min-w-0">
                <div className="text-xs font-black text-slate-700">
                    {progress.producedLabel} / {progress.totalLabel} · {compact(progress.pct, 0)}%
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
                    <div className="flex h-full">
                        <div className="bg-emerald-500" style={{ width: `${progress.dispatchedPct}%` }} />
                        <div className="bg-blue-500" style={{ width: `${progress.producedOpenPct}%` }} />
                        <div className="bg-slate-200" style={{ width: `${progress.remainingPct}%` }} />
                    </div>
                </div>
            </div>
            <div className="min-w-0 text-xs">
                <div className="font-black text-slate-900">{formatSalesDate(orderCreatedDate(order))}</div>
                <div className="mt-1 truncate font-semibold text-slate-500">{order.plant_name || order.ship_to_customer_name || "Plant pending"}</div>
            </div>
            <div className="flex items-center justify-end gap-2">
                <StatusBadge status={order.status} />
                {canCancelBeforeRelease(order) && !isHistory ? (
                    <button
                        type="button"
                        aria-label={`Cancel ${order.order_number}`}
                        disabled={cancelPending}
                        onClick={() => onCancel(order)}
                        className="flex h-8 w-8 items-center justify-center rounded-full border border-rose-100 bg-white text-rose-600 transition hover:bg-rose-50 disabled:opacity-60"
                    >
                        <XCircle className="h-4 w-4" />
                    </button>
                ) : null}
                <Button asChild variant="outline" size="sm" className="h-8 rounded-full bg-white px-3 text-[11px] font-black">
                    <Link href={`/sales/orders/${order.id}/tracking`}>
                        <Activity className="mr-1.5 h-3.5 w-3.5" />
                        Track
                    </Link>
                </Button>
            </div>
        </div>
    )
}

export default function SalesOrdersPage() {
    const queryClient = useQueryClient()
    const [tab, setTab] = useState<OrderTab>("queue")
    const [searchText, setSearchText] = useState("")
    const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL")
    const [fgTypeFilter, setFgTypeFilter] = useState("all")
    const [materialFilter, setMaterialFilter] = useState("all")
    const [gradeFilter, setGradeFilter] = useState("all")
    const [thicknessFilter, setThicknessFilter] = useState("")
    const [sizeFilter, setSizeFilter] = useState("")
    const [heightFilter, setHeightFilter] = useState("")
    const [createdWindow, setCreatedWindow] = useState<CreatedWindow>("ALL")
    const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE)
    const deferredSearchText = useDeferredValue(searchText.trim())
    const serverStatusFilter = statusFilter !== "ALL"
        ? statusFilter
        : tab === "history"
            ? "COMPLETED,CANCELLED"
            : undefined
    const serverLimit = deferredSearchText || tab === "history" ? 500 : 220

    const { data: orders = [], isLoading } = useQuery({
        queryKey: ["sales-orders", { q: deferredSearchText, status: serverStatusFilter || "ALL", limit: serverLimit }],
        queryFn: () => salesService.getOrders({
            q: deferredSearchText || undefined,
            status: serverStatusFilter,
            limit: serverLimit,
        }),
    })
    const { data: masterGrades = [] } = useQuery({
        queryKey: ["recipe-grades"],
        queryFn: () => recipeService.getGrades(),
    })
    const { data: filmFamilies = [] } = useQuery({
        queryKey: ["film-families"],
        queryFn: filmFamilyService.getAll,
    })
    const { data: filmVariants = [] } = useQuery({
        queryKey: ["film-variants"],
        queryFn: filmVariantService.getAll,
    })

    const cancelOrder = useMutation({
        mutationFn: ({ id, reason }: { id: string; reason: string }) => salesService.cancelOrder(id, reason),
        onSuccess: () => {
            toast.success("Sales order cancelled")
            queryClient.invalidateQueries({ queryKey: ["sales-orders"] })
        },
        onError: (error: any) => {
            toast.error("Sales order was not cancelled", {
                description: error?.response?.data?.detail || error?.message || "Planner may have already released this order.",
            })
        },
    })

    const enrichedOrders = useMemo<EnrichedOrder[]>(() => (
        orders.map((order) => {
            const spec = normalizeProductSpec(order)
            const normalizedStatus = String(order.status || "").toUpperCase()
            return {
                order,
                spec,
                normalizedStatus,
                searchable: [
                    order.order_number,
                    order.order_name,
                    order.customer_name,
                    order.ship_to_customer_name,
                    order.status,
                    order.remarks,
                    spec.searchText,
                ].join(" ").toLowerCase(),
            }
        })
    ), [orders])

    const activeOrders = useMemo(() => enrichedOrders.filter((item) => !isCompletedOrder(item.order)), [enrichedOrders])
    const historyOrders = useMemo(() => enrichedOrders.filter((item) => isCompletedOrder(item.order)), [enrichedOrders])
    const totalValue = useMemo(() => enrichedOrders.reduce((sum, item) => sum + safeNumber(item.order.total_value), 0), [enrichedOrders])
    const awaitingPlanning = activeOrders.filter((item) => item.normalizedStatus === "PLANNING_REQUIRED").length
    const createdToday = enrichedOrders.filter((item) => createdMatches(orderCreatedDate(item.order), "TODAY")).length
    const createdLast7 = enrichedOrders.filter((item) => createdMatches(orderCreatedDate(item.order), "LAST_7")).length
    const createdLast30 = enrichedOrders.filter((item) => createdMatches(orderCreatedDate(item.order), "LAST_30")).length
    const olderThan30 = activeOrders.filter((item) => createdMatches(orderCreatedDate(item.order), "OLDER_30")).length

    const materialOptions = useMemo<SalesOverflowChipOption[]>(() => {
        const labels = salesUniqueText([
            ...SALES_MATERIAL_PRIORITY,
            ...filmFamilies.flatMap((family: any) => [family?.code, family?.name]),
            ...filmVariants.flatMap((variant: any) => [variant?.code, variant?.name, variant?.parent_family_name]),
            ...enrichedOrders.flatMap((item) => item.spec.layers.flatMap((layer) => [salesMaterialFilterLabel(layer.variantName), salesMaterialFilterLabel(layer.variantCode)])),
        ]).map(salesMaterialFilterLabel).filter(Boolean)
        return salesSortChipOptions(
            salesUniqueText(labels).map((material) => ({
                value: material,
                label: material,
                count: enrichedOrders.filter((item) => salesSpecMatchesMaterialFilter(item.spec, material)).length,
                tone: "material" as const,
            })),
            SALES_MATERIAL_PRIORITY
        )
    }, [enrichedOrders, filmFamilies, filmVariants])
    const gradeOptions = useMemo<SalesOverflowChipOption[]>(() => (
        salesSortChipOptions(
            uniqueNonEmpty([
                ...SALES_GRADE_PRIORITY,
                ...masterGrades.map((grade: any) => grade?.name || grade?.code),
                ...enrichedOrders.flatMap((item) => item.spec.layers.map((layer) => layer.grade)),
            ]).map((grade) => ({
                value: grade,
                label: grade,
                count: enrichedOrders.filter((item) => item.spec.layers.some((layer) => String(layer.grade || "").toLowerCase().includes(grade.toLowerCase()))).length,
                tone: "grade" as const,
            })),
            SALES_GRADE_PRIORITY
        )
    ), [enrichedOrders, masterGrades])

    const widthPresets = useMemo(() => makeRangePresets(enrichedOrders.flatMap((item) => [item.spec.size.widthMm, ...item.spec.layers.map((layer) => layer.widthMm)]), "mm"), [enrichedOrders])
    const heightPresets = useMemo(() => makeRangePresets(enrichedOrders.map((item) => item.spec.size.heightMm), "mm"), [enrichedOrders])
    const thicknessPresets = useMemo(() => makeRangePresets(enrichedOrders.flatMap((item) => item.spec.layers.map((layer) => layer.thicknessMicron)), "μ"), [enrichedOrders])

    const statusCounts = useMemo(() => {
        const counts: Record<string, number> = {}
        for (const item of activeOrders) counts[item.normalizedStatus] = (counts[item.normalizedStatus] || 0) + 1
        return counts
    }, [activeOrders])

    const currentFilters: SalesSavedViewFilters = {
        tab,
        searchText,
        statusFilter,
        fgTypeFilter,
        materialFilter,
        gradeFilter,
        thicknessFilter,
        sizeFilter,
        heightFilter,
        createdWindow,
    }

    const applySavedFilters = (filters: SalesSavedViewFilters) => {
        if (typeof filters.tab === "string") {
            setTab(filters.tab === "history" ? "history" : "queue")
        }
        if (typeof filters.searchText === "string") setSearchText(filters.searchText)
        if (typeof filters.statusFilter === "string") setStatusFilter(filters.statusFilter as StatusFilter)
        if (typeof filters.fgTypeFilter === "string") setFgTypeFilter(filters.fgTypeFilter)
        if (typeof filters.materialFilter === "string") setMaterialFilter(filters.materialFilter)
        if (typeof filters.variantFilter === "string") setMaterialFilter(filters.variantFilter)
        if (typeof filters.gradeFilter === "string") setGradeFilter(filters.gradeFilter)
        if (typeof filters.thicknessFilter === "string") setThicknessFilter(filters.thicknessFilter)
        if (typeof filters.sizeFilter === "string") setSizeFilter(filters.sizeFilter)
        if (typeof filters.heightFilter === "string") setHeightFilter(filters.heightFilter)
        if (typeof filters.createdWindow === "string") setCreatedWindow(filters.createdWindow as CreatedWindow)
        if (typeof filters.deliveryWindow === "string") {
            const legacyMap: Record<string, CreatedWindow> = { THIS_WEEK: "LAST_7", OVERDUE: "OLDER_30", NO_DATE: "NO_DATE", ALL: "ALL" }
            setCreatedWindow(legacyMap[String(filters.deliveryWindow)] || "ALL")
        }
    }

    const shownOrders = useMemo(() => {
        const list = tab === "history" ? historyOrders : activeOrders
        const q = searchText.trim().toLowerCase()
        return list.filter((item) => {
            if (q && !item.searchable.includes(q)) return false
            if (!specMatches({ spec: item.spec, fgTypeFilter, materialFilter, gradeFilter, sizeFilter, heightFilter, thicknessFilter })) return false
            if (statusFilter !== "ALL" && item.normalizedStatus !== statusFilter) return false
            if (!createdMatches(orderCreatedDate(item.order), createdWindow)) return false
            return true
        })
    }, [activeOrders, createdWindow, fgTypeFilter, gradeFilter, heightFilter, historyOrders, materialFilter, searchText, sizeFilter, statusFilter, tab, thicknessFilter])

    const visibleOrders = shownOrders.slice(0, visibleLimit)

    useEffect(() => {
        setVisibleLimit(PAGE_SIZE)
    }, [createdWindow, fgTypeFilter, gradeFilter, heightFilter, materialFilter, searchText, sizeFilter, statusFilter, tab, thicknessFilter])

    function resetFilters() {
        setSearchText("")
        setStatusFilter("ALL")
        setFgTypeFilter("all")
        setMaterialFilter("all")
        setGradeFilter("all")
        setThicknessFilter("")
        setSizeFilter("")
        setHeightFilter("")
        setCreatedWindow("ALL")
    }

    function handleCancel(order: SalesOrder) {
        const reason = window.prompt("Reason for cancelling this sales order before planner release?")
        if (reason === null) return
        cancelOrder.mutate({ id: order.id, reason })
    }

    return (
        <div className="min-h-screen space-y-4 bg-[#f8fafc] p-3 lg:p-4" data-testid="sales-orders-list-page">
            <section className="overflow-hidden rounded-[1.55rem] bg-[radial-gradient(circle_at_85%_0%,rgba(168,85,247,0.46),transparent_45%),linear-gradient(135deg,#2e1b82_0%,#5b21b6_54%,#7c3aed_100%)] p-4 text-white shadow-[0_24px_62px_-42px_rgba(76,29,149,0.72)]">
                <div className="relative z-10 flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                    <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-violet-200">Sales · Order operations</div>
                        <h1 className="mt-1.5 text-2xl font-black tracking-tight lg:text-3xl">Sales Orders</h1>
                        <p className="mt-1 max-w-4xl text-sm font-semibold leading-snug text-violet-100">
                            One bounded order queue with product size, layers, material, grade, thickness, created-age, and history in the same lens.
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <Button asChild variant="outline" className="h-9 rounded-full border-white/20 bg-white/10 text-xs font-black text-white hover:bg-white hover:text-violet-900">
                            <Link href="/sales/sku-catalog">SKU Studio</Link>
                        </Button>
                        <Button asChild className="h-9 rounded-full bg-white px-4 text-xs font-black uppercase tracking-[0.14em] text-violet-900 hover:bg-violet-50">
                            <Link href="/sales/orders/create">
                                <Plus className="mr-2 h-4 w-4" />
                                New order
                            </Link>
                        </Button>
                    </div>
                </div>
                <div className="relative z-10 mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
                    <HeroMetric label="Active" value={activeOrders.length} sub="open orders" />
                    <HeroMetric label="Awaiting planning" value={awaitingPlanning} sub="needs action" />
                    <HeroMetric label="Created 7d" value={createdLast7} sub={`${createdToday} today`} />
                    <HeroMetric label="Older 30d" value={olderThan30} sub="open orders" />
                    <HeroMetric label="Total value" value={formatSalesMoney(totalValue)} sub="in flight" />
                    <HeroMetric label="On-time %" value="-" sub="trailing 30d" />
                </div>
            </section>

            <SalesSavedViewsBar
                scope="orders"
                currentFilters={currentFilters}
                onApply={applySavedFilters}
                viewCounts={{
                    "My active queue": activeOrders.length,
                    "Awaiting planning": awaitingPlanning,
                    "Created last 7d": createdLast7,
                    "Older 30d": olderThan30,
                    "Pouches this month": activeOrders.filter((item) => String(item.spec.size.finishedGoodType || item.order.item_summary?.finished_good_type || "").toUpperCase() === "POUCH" && createdMatches(orderCreatedDate(item.order), "LAST_30")).length,
                    "LDPE rolls": activeOrders.filter((item) => item.spec.searchText.includes("ldpe") && String(item.spec.size.finishedGoodType || "").toUpperCase() === "ROLL").length,
                }}
            />

            <section className="rounded-[1.15rem] border border-slate-200 bg-white p-3 shadow-[0_12px_30px_-28px_rgba(15,23,42,0.32)]" data-testid="sales-order-filters">
                <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
                    <div className="relative min-w-[16rem] flex-1">
                        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <Input
                            value={searchText}
                            onChange={(event) => setSearchText(event.target.value)}
                            placeholder="Search SO number, customer, SKU code, size, grade, addon..."
                            className="h-10 rounded-xl border-slate-200 bg-white pl-10 text-sm font-semibold shadow-none"
                        />
                    </div>
                    <Button type="button" variant="outline" className="h-10 rounded-xl bg-white text-xs font-black">
                        <ArrowUpDown className="mr-2 h-4 w-4" />
                        Sort: created date
                    </Button>
                    <Button type="button" variant="outline" className="h-10 rounded-xl bg-white text-xs font-black">
                        <Grid2X2 className="mr-2 h-4 w-4" />
                        Layout
                    </Button>
                    <Button type="button" variant="outline" className="h-10 rounded-xl bg-white text-xs font-black">
                        <Download className="mr-2 h-4 w-4" />
                        Export
                    </Button>
                </div>
                <div className="mt-2 grid gap-2 xl:grid-cols-[minmax(0,1.1fr)_auto_auto_auto] xl:items-center">
                    <SalesOverflowChipGroup
                        label="Finished good"
                        value={fgTypeFilter}
                        onChange={setFgTypeFilter}
                        maxInline={3}
                        options={SALES_SUPPORTED_FG_TYPES.map((value) => ({
                            value,
                            label: value,
                            count: enrichedOrders.filter((item) => String(item.spec.size.finishedGoodType || item.order.item_summary?.finished_good_type || "").toUpperCase() === value).length,
                            tone: fgTone(value),
                        }))}
                    />
                    <SalesSmartRangeFilter label="Width" value={sizeFilter} placeholder="440" suffix="mm" presets={widthPresets} onChange={setSizeFilter} />
                    <SalesSmartRangeFilter label="Height" value={heightFilter} placeholder="200-320" suffix="mm" presets={heightPresets} onChange={setHeightFilter} />
                    <SalesSmartRangeFilter label="Thickness" value={thicknessFilter} placeholder="20-80" suffix="μ" presets={thicknessPresets} onChange={setThicknessFilter} />
                </div>
                <div className="mt-2 grid gap-2 border-t border-slate-100 pt-2 xl:grid-cols-2">
                    <SalesOverflowChipGroup label="Material" value={materialFilter} onChange={setMaterialFilter} options={materialOptions} maxInline={4} />
                    <SalesOverflowChipGroup label="Grade" value={gradeFilter} onChange={setGradeFilter} options={gradeOptions} maxInline={4} />
                </div>
                <div className="mt-2 flex flex-wrap gap-2 border-t border-slate-100 pt-2">
                    <SalesOverflowChipGroup
                        label="Status"
                        value={statusFilter}
                        allValue="ALL"
                        allLabel={`All · ${activeOrders.length}`}
                        onChange={(value) => setStatusFilter(value as StatusFilter)}
                        maxInline={3}
                        options={STATUS_FILTERS.map((status) => ({
                            value: status.value,
                            label: `${status.label} · ${statusCounts[status.value] || 0}`,
                            tone: status.value === "PLANNING_REQUIRED" ? "fgPouch" : status.value === "PLANNED" ? "size" : status.value === "RELEASED" ? "material" : "pack",
                        }))}
                    />
                    <span className="inline-flex h-9 shrink-0 items-center text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Created</span>
                    {([
                        ["ALL", "All dates"],
                        ["TODAY", "Today"],
                        ["LAST_7", "Last 7d"],
                        ["LAST_30", "Last 30d"],
                        ["OLDER_30", "Older 30d"],
                        ["NO_DATE", "No date"],
                    ] as Array<[CreatedWindow, string]>).map(([value, label]) => (
                        <FilterPill key={value} active={createdWindow === value} onClick={() => setCreatedWindow(createdWindow === value ? "ALL" : value)}>
                            <CalendarDays className="h-3.5 w-3.5" />
                            {label}
                        </FilterPill>
                    ))}
                    <Button type="button" variant="outline" onClick={resetFilters} className="h-9 shrink-0 rounded-full bg-white px-4 text-xs font-black">
                        Reset
                    </Button>
                </div>
            </section>

            <section className="overflow-hidden rounded-[1.4rem] border border-slate-200 bg-white shadow-[0_16px_44px_-40px_rgba(15,23,42,0.38)]">
                <div className="flex flex-col gap-3 border-b border-slate-200 px-4 pt-3 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex items-center overflow-x-auto">
                        {[
                            ["queue", "Order queue", activeOrders.length],
                            ["history", "All history", historyOrders.length],
                        ].map(([value, label, count]) => (
                            <button
                                key={String(value)}
                                type="button"
                                onClick={() => setTab(value as OrderTab)}
                                className={cn(
                                    "inline-flex h-11 shrink-0 items-center gap-2 border-b-2 px-4 text-sm font-black transition",
                                    tab === value ? "border-violet-600 text-violet-700" : "border-transparent text-slate-500 hover:text-slate-900"
                                )}
                            >
                                {label}
                                <span className="text-slate-400">{count}</span>
                            </button>
                        ))}
                    </div>
                    <div className="flex items-center gap-2 pb-3 text-xs font-black text-slate-600">
                        <span className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-2">
                            <SlidersHorizontal className="h-4 w-4 text-slate-400" />
                            {shownOrders.length} visible
                        </span>
                        <span className="hidden rounded-full border border-slate-200 bg-slate-50 px-3 py-2 md:inline-flex">
                            Rendering {visibleOrders.length} for speed
                        </span>
                    </div>
                </div>

                {isLoading ? (
                    <div className="flex h-[360px] items-center justify-center">
                        <div className="text-center">
                            <Loader2 className="mx-auto h-7 w-7 animate-spin text-slate-500" />
                            <div className="mt-3 text-sm font-bold text-slate-500">Loading sales queue...</div>
                        </div>
                    </div>
                ) : shownOrders.length ? (
                    <div className="overflow-x-auto">
                        <div className="grid min-w-[1120px] grid-cols-[10rem_13rem_minmax(27rem,1fr)_15rem_12rem_10rem] gap-4 border-b border-slate-200 bg-slate-50 px-4 py-3 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">
                            <div>Order # · Customer</div>
                            <div>SKU / Variant ID</div>
                            <div>Variant attributes</div>
                            <div>Progress</div>
                            <div>Created · Plant</div>
                            <div className="text-right">Status</div>
                        </div>
                        {visibleOrders.map((item) => (
                            <OrderQueueRow key={item.order.id} item={item} tab={tab} onCancel={handleCancel} cancelPending={cancelOrder.isPending} />
                        ))}
                        {visibleOrders.length < shownOrders.length ? (
                            <div className="flex justify-center p-4">
                                <Button type="button" variant="outline" className="rounded-full bg-white px-5 text-xs font-black" onClick={() => setVisibleLimit((value) => value + PAGE_SIZE)}>
                                    Show next {Math.min(PAGE_SIZE, shownOrders.length - visibleOrders.length)} orders
                                </Button>
                            </div>
                        ) : null}
                    </div>
                ) : (
                    <div className="flex min-h-[320px] items-center justify-center px-4 py-12 text-center">
                        <div>
                            <CheckCircle2 className="mx-auto h-10 w-10 text-slate-300" />
                            <div className="mt-3 text-lg font-black text-slate-900">No orders match this view</div>
                            <p className="mt-1 text-sm font-semibold text-slate-500">Clear filters or open a saved view to bring the queue back.</p>
                        </div>
                    </div>
                )}
            </section>
        </div>
    )
}

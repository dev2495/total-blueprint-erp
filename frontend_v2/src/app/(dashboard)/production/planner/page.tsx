"use client"

import Link from "next/link"
import { Fragment, useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
    AlertTriangle,
    CheckCircle2,
    ChevronDown,
    ClipboardList,
    Flame,
    GitMerge,
    Layers3,
    Loader2,
    Package,
    PackageCheck,
    Plus,
    Rocket,
    Zap,
} from "lucide-react"

import { useToast } from "@/hooks/use-toast"
import {
    plannerService,
    ClaimCandidate,
    PlannerAllocationPayload,
    ControlHubResponse,
    PlannerControlOrder,
    PlannerInventoryOption,
} from "@/services/planner"
import { engineeringService } from "@/services/engineering"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent } from "@/components/ui/tabs"
import {
    SalesOverflowChipGroup,
    SalesSavedViewsBar,
    SalesSmartRangeFilter,
    SALES_GRADE_PRIORITY,
    SALES_MATERIAL_PRIORITY,
    SALES_SUPPORTED_FG_TYPES,
    salesMaterialFilterLabel,
    salesSortChipOptions,
    salesUniqueText,
    type SalesOverflowChipOption,
    type SalesSavedViewFilters,
} from "@/components/sales/sales-flow-ui"
import { recipeService } from "@/services/recipes"
import { masterDataService } from "@/services/master-data"
import styles from "./planner-tower.module.css"

type PlannerTab = "planning" | "active" | "jobs" | "history"
type PlanOption = "FG" | "WIP_CONTINUE" | "FRESH"
type QueueFilter = "ALL" | "ARTWORK_GATE" | "BLOCKED" | "READY"
type DetailSectionKey = "route" | "material"
type WipMode = "EXACT" | "INVARIANT"
type HistoryDaysFilter = "TODAY" | "7" | "30" | "90" | "ALL"
type PlannerDueFilter = "ALL" | "TODAY" | "THREE_DAYS" | "THIS_WEEK" | "OVERDUE" | "NO_DATE"
type PlannerSourceFilter = "ALL" | "FG" | "WIP" | "FRESH"

type AllocationState = {
    inventory_type: "ROLL" | "FG_BATCH"
    inventory_id: string
    qty: number
}

type OrderPlanState = {
    option: PlanOption
    allocations: Record<string, AllocationState>
}

const rowKey = (row: PlannerControlOrder) => {
    const kind = String(row.order_kind || "").trim().toLowerCase()
    return `${kind}:${row.order_id}`
}
const parsePlannerRowKey = (value: string) => {
    const [kind, ...idParts] = String(value || "").split(":")
    const orderKind = kind?.trim().toLowerCase()
    const orderId = idParts.join(":").trim()
    if (!orderKind || !orderId) return null
    return { orderKind, orderId }
}
const inventoryKey = (row: PlannerInventoryOption) => `${row.inventory_type}:${row.inventory_id}`

function defaultPlanState(row: PlannerControlOrder): OrderPlanState {
    const stats = sourceStats(row)
    const hasFg = Boolean(stats.hasFg)
    const hasWip = Boolean(stats.hasWip)
    const option: PlanOption = hasFg ? "FG" : hasWip ? "WIP_CONTINUE" : "FRESH"
    return { option, allocations: {} }
}

function policyLabel(mode?: string | null, value?: number | null): string {
    const safeMode = String(mode || "NONE").toUpperCase()
    const safeValue = Number(value || 0)
    if (safeMode === "PERCENT_OVER_THEORY") return `${safeValue}% over theory`
    if (safeMode === "FIXED_EXTRA_KG") return `+${safeValue} KG`
    if (safeMode === "MINIMUM_ISSUE_KG") return `Min ${safeValue} KG`
    return "No uplift"
}

function sourceStats(row: PlannerControlOrder) {
    const fallbackOptions = row.workspace?.inventory_options || row.inventory_options || []
    const fgMatchCount = Number(row.source_availability?.fg_match_count ?? fallbackOptions.filter((inv) => Boolean(inv.is_final_step)).length)
    const continuation = row.continuation
    const wipMatchCount = Number(
        row.source_availability?.wip_match_count ??
            (Number(continuation?.exact_stock_route_count || 0) +
                Number(continuation?.carry_forward_wip_count || 0) +
                Number(continuation?.shared_invariant_count || 0) +
                Number(continuation?.upstream_route_count || 0) ||
                fallbackOptions.filter((inv) => !Boolean(inv.is_final_step) && Number(inv.completed_step_index || 0) >= Number(row.required_start_step || 0)).length)
    )
    return {
        fgMatchCount,
        wipMatchCount,
        hasFg: Boolean(row.source_availability?.has_fg || fgMatchCount > 0),
        hasWip: Boolean(row.source_availability?.has_wip || wipMatchCount > 0),
    }
}

function hasHardBlocker(row: PlannerControlOrder) {
    return (row.blockers || []).some((b) => String(b.severity || "").toUpperCase() === "HIGH")
}

function isSourceOptionEnabled(row: PlannerControlOrder, option: PlanOption) {
    const stats = sourceStats(row)
    if (option === "FG") return stats.hasFg
    if (option === "WIP_CONTINUE") return stats.hasWip
    return !hasHardBlocker(row)
}

function checklistToneClass(status?: string) {
    const normalized = String(status || "").toUpperCase()
    if (normalized === "READY") return styles.checklistItemReady
    if (normalized === "BLOCKED") return styles.checklistItemBlocked
    return styles.checklistItemAttention
}

function formatDateLabel(value?: string | null) {
    if (!value) return "Not set"
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) return value
    return parsed.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
}

function completedOrdersStateLabel(row: PlannerControlOrder): string {
    const status = String(row.status || "").toUpperCase()
    const completedJobs = Number(row.jobs_completed || 0)
    const totalJobs = Number(row.job_count || 0)
    if (status === "DISPATCHED" || status === "DELIVERED") return "Dispatched"
    if (totalJobs > 0 && completedJobs >= totalJobs) return "Production complete"
    if (totalJobs > 0) return "Jobs created"
    if (status === "CANCELLED") return "Cancelled"
    return status ? status.replaceAll("_", " ") : "Open"
}

function completedOrdersStateToneClass(row: PlannerControlOrder): string {
    const status = String(row.status || "").toUpperCase()
    const completedJobs = Number(row.jobs_completed || 0)
    const totalJobs = Number(row.job_count || 0)
    if (status === "DISPATCHED" || status === "DELIVERED") return styles.badgeEmerald
    if (status === "CANCELLED") return styles.badgeRose
    if (totalJobs > 0 && completedJobs >= totalJobs) return styles.badgeGreen
    if (completedJobs > 0) return styles.badgeAmber
    return styles.badgeMuted
}

function completedOrdersSourceLabel(row: PlannerControlOrder): string {
    const option = String(row.source_summary?.recommended_option || row.action_recommendation?.key || "").toUpperCase()
    if (option === "FG") return "Used existing FG"
    if (option === "WIP_CONTINUE") return "Continued from WIP"
    return "Fresh production"
}

function completedOrdersSourceValue(row: PlannerControlOrder): "FG" | "WIP" | "FRESH" {
    const option = String(row.source_summary?.recommended_option || row.action_recommendation?.key || "").toUpperCase()
    if (option === "FG") return "FG"
    if (option === "WIP_CONTINUE") return "WIP"
    return "FRESH"
}

function selectedDateNumber(value?: string | null) {
    if (!value) return Number.MAX_SAFE_INTEGER
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) return Number.MAX_SAFE_INTEGER
    return parsed.getTime()
}

function parsePlannerRange(value: string) {
    const raw = value.trim()
    if (!raw) return { min: null as number | null, max: null as number | null }
    const parts = raw.split(/[,-]/).map((part) => Number(part.trim())).filter(Number.isFinite)
    if (!parts.length) return { min: null, max: null }
    if (parts.length === 1) return { min: parts[0], max: parts[0] }
    return { min: Math.min(parts[0], parts[1]), max: Math.max(parts[0], parts[1]) }
}

function plannerNumberInRange(value: number | null | undefined, rangeText: string) {
    const { min, max } = parsePlannerRange(rangeText)
    if (min === null && max === null) return true
    const num = Number(value)
    if (!Number.isFinite(num)) return false
    if (min !== null && max !== null && min === max) return Math.round(num) === Math.round(min)
    if (min !== null && num < min) return false
    if (max !== null && num > max) return false
    return true
}

function plannerRangePresets(values: Array<number | null | undefined>, suffix: string) {
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

function plannerDateMatches(value: string | null | undefined, filter: PlannerDueFilter) {
    if (filter === "ALL") return true
    if (!value) return filter === "NO_DATE"
    const ts = new Date(value).getTime()
    if (!Number.isFinite(ts)) return filter === "NO_DATE"
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const oneDay = 24 * 60 * 60 * 1000
    if (filter === "OVERDUE") return ts < today.getTime()
    if (filter === "TODAY") return ts >= today.getTime() && ts < today.getTime() + oneDay
    if (filter === "THREE_DAYS") return ts >= today.getTime() && ts <= today.getTime() + oneDay * 3
    if (filter === "THIS_WEEK") return ts >= today.getTime() && ts <= today.getTime() + oneDay * 7
    return true
}

function plannerRowBlob(row: PlannerControlOrder) {
    const layerText = [
        ...(Array.isArray(row.display_layers) ? row.display_layers : []),
        ...(Array.isArray(row.layer_summary) ? row.layer_summary : []),
        ...(Array.isArray(row.layer_snapshot) ? row.layer_snapshot.map((layer, index) => summarizeLayerRow(layer, index)) : []),
    ].join(" ")
    const materialText = (row.workspace?.material_plan_lines || row.material_plan_lines || [])
        .map((line) => [line.material_code, line.material_name, line.category_code].filter(Boolean).join(" "))
        .join(" ")
    return [
        row.order_number,
        row.customer_name,
        row.display_name,
        row.template_name,
        row.fg_type,
        row.final_product_type,
        row.planned_output_type,
        row.stock_strategy,
        (row as any).planner_stock_class,
        row.spec_signature,
        row.order_fact_sheet?.customer_name,
        row.order_fact_sheet?.display_name,
        row.order_fact_sheet?.template_name,
        row.order_fact_sheet?.release_risk,
        (row.order_fact_sheet as any)?.packaging_summary,
        layerText,
        materialText,
    ].filter(Boolean).join(" ").toLowerCase()
}

function plannerRowWidth(row: PlannerControlOrder) {
    return Number(row.effective_dims?.width_mm ?? row.geometry_override?.width_mm ?? row.roll_invariants?.width_mm ?? row.geometry_snapshot?.base?.width_mm ?? row.geometry_snapshot?.width_mm ?? null)
}

function plannerRowHeight(row: PlannerControlOrder) {
    return Number(row.effective_dims?.height_mm ?? row.geometry_override?.height_mm ?? row.geometry_snapshot?.base?.height_mm ?? row.geometry_snapshot?.height_mm ?? null)
}

function plannerRowThicknesses(row: PlannerControlOrder) {
    const values = Array.isArray(row.layer_snapshot)
        ? row.layer_snapshot.map((layer) => Number(layer?.thickness_micron || layer?.gauge_micron || 0)).filter((value) => value > 0)
        : []
    const invariantThickness = Number(row.roll_invariants?.thickness_micron || 0)
    if (invariantThickness > 0) values.push(invariantThickness)
    return values
}

function plannerRowSource(row: PlannerControlOrder): PlannerSourceFilter {
    const stats = sourceStats(row)
    if (stats.hasFg) return "FG"
    if (stats.hasWip) return "WIP"
    return "FRESH"
}

function plannerSpecChips(row: PlannerControlOrder) {
    const fgType = String(row.fg_type || row.final_product_type || row.planned_output_type || "").toUpperCase()
    const width = plannerRowWidth(row)
    const height = plannerRowHeight(row)
    const thickness = plannerRowThicknesses(row)[0]
    const blob = plannerRowBlob(row)
    const material = ["PET", "PE", "LDPE", "LLDPE", "HDPE", "POLYESTER", "CPP", "BOPP", "PP"].find((value) => blob.includes(value.toLowerCase()))
    const grade = ["GP", "SP", "MET10", "FG", "SLIP"].find((value) => blob.includes(value.toLowerCase()))
    return [
        fgType ? { label: fgType, className: "border-rose-200 bg-rose-50 text-rose-700" } : null,
        width || height ? { label: `${Number.isFinite(width) && width > 0 ? width.toFixed(0) : "-"} × ${Number.isFinite(height) && height > 0 ? height.toFixed(0) : "-"} mm`, className: "border-sky-200 bg-sky-50 text-sky-700" } : null,
        thickness ? { label: `${thickness.toFixed(thickness % 1 ? 1 : 0)}μ`, className: "border-blue-200 bg-blue-50 text-blue-700" } : null,
        material ? { label: material, className: "border-blue-200 bg-blue-50 text-blue-700" } : null,
        grade ? { label: grade, className: "border-emerald-200 bg-emerald-50 text-emerald-700" } : null,
    ].filter(Boolean) as Array<{ label: string; className: string }>
}

function queuePriorityScore(row: PlannerControlOrder): number {
    const artworkGate = row.artwork_gate?.active ? 100 : 0
    const blockerCount = Number(row.release_checklist?.blocked_count ?? (row.blockers || []).length)
    const releaseRisk = String(row.order_fact_sheet?.release_risk || "").toUpperCase()
    const riskScore = releaseRisk === "HIGH" ? 30 : releaseRisk === "MEDIUM" ? 15 : 0
    return artworkGate + blockerCount * 10 + riskScore
}

function isSalesPlannerRow(row?: PlannerControlOrder | null) {
    return String(row?.order_kind || "").trim().toLowerCase() === "sales"
}

function coverageFillClass(pct: number) {
    if (pct >= 80) return styles.coverageGreen
    if (pct >= 40) return styles.coverageAmber
    return styles.coverageRed
}

function planOptionLabel(option?: PlanOption | string | null) {
    const normalized = String(option || "").toUpperCase()
    if (normalized === "FG") return "FG"
    if (normalized === "WIP_CONTINUE") return "WIP"
    return "Fresh"
}

function summarizeLayerRow(layer: any, index: number) {
    const name = String(
        layer?.variant_name ||
            layer?.film_variant_name ||
            layer?.material_name ||
            layer?.label ||
            layer?.family_name ||
            `Layer ${index + 1}`
    ).trim()
    const thickness = Number(layer?.thickness_micron || layer?.gauge_micron || 0)
    const width = Number(layer?.roll_width_mm || layer?.width_mm || 0)
    const parts = [name]
    if (thickness > 0) parts.push(`${thickness.toFixed(thickness % 1 ? 2 : 0)}μ`)
    if (width > 0) parts.push(`${width.toFixed(width % 1 ? 1 : 0)} mm`)
    return parts.join(" · ")
}

function buildLayerCard(layer: any, index: number, fallbackSummary?: string) {
    const badge = `Layer ${index + 1}`
    const fallbackRaw = String(fallbackSummary || "").trim()
    const fallbackParts = fallbackRaw.split("·").map((part) => part.trim()).filter(Boolean)
    if (layer && typeof layer === "object" && !Array.isArray(layer)) {
        const explicitTitle = String(
            layer?.variant_name ||
            layer?.film_variant_name ||
            layer?.material_name ||
            layer?.material_code ||
            layer?.name ||
            ""
        ).trim() || badge
        const subtitleParts: string[] = []
        const metrics: string[] = []
        const materialCode = String(layer?.material_code || "").trim()
        const materialName = String(layer?.material_name || "").trim()
        const familyName = String(layer?.family_name || "").trim()
        const grade = String(layer?.grade_code || layer?.grade_name || "").trim()
        const thickness = Number(layer?.thickness_micron || layer?.gauge_micron || 0)
        const width = Number(layer?.roll_width_mm || layer?.width_mm || 0)
        for (const part of [materialCode, materialName, familyName, grade]) {
            if (part && part !== explicitTitle && !subtitleParts.includes(part)) subtitleParts.push(part)
        }
        if (thickness > 0) metrics.push(`${thickness.toFixed(thickness % 1 ? 2 : 0)}μ`)
        if (width > 0) metrics.push(`${width.toFixed(width % 1 ? 1 : 0)} mm`)
        const fallbackTitle = fallbackParts[0] || badge
        const resolvedTitle = explicitTitle === badge && fallbackTitle && fallbackTitle !== badge ? fallbackTitle : explicitTitle
        const fallbackSubtitle = fallbackParts.slice(1)
        for (const part of fallbackSubtitle) {
            if (part && part !== resolvedTitle && !subtitleParts.includes(part) && !metrics.includes(part)) subtitleParts.push(part)
        }
        const normalizedResolvedTitle = resolvedTitle || fallbackTitle || badge
        const normalizedSubtitle =
            subtitleParts.join(" · ") ||
            (fallbackParts.length > 1 ? fallbackParts.slice(1).join(" · ") : "") ||
            (fallbackRaw && fallbackRaw !== normalizedResolvedTitle ? fallbackRaw : "") ||
            "Layer detail captured"
        return {
            key: `${badge}-${normalizedResolvedTitle}-${normalizedSubtitle}-${metrics.join("-")}`,
            badge,
            title: normalizedResolvedTitle,
            subtitle: normalizedSubtitle,
            metrics,
        }
    }
    const raw = String(layer || fallbackSummary || "").trim()
    const parts = raw.split("·").map((part) => part.trim()).filter(Boolean)
    const title = parts[0] || badge
    const subtitle = parts.slice(1).join(" · ") || "Layer detail captured"
    return {
        key: `${badge}-${raw}`,
        badge,
        title,
        subtitle,
        metrics: [],
    }
}

function summarizeAddon(addon: any) {
    const base = String(addon?.name || addon?.addon_name || addon?.addon_code || addon?.addon_id || "Addon").trim()
    const qty = Number(addon?.qty || 0)
    const appliesTo = String(addon?.applies_to || "").trim().toUpperCase()
    const parts = [base]
    if (qty > 0) parts.push(`x${qty}`)
    if (appliesTo && appliesTo !== "NONE") parts.push(appliesTo)
    return parts.join(" · ")
}

function summarizePackaging(snapshot: any, podCount: number, packagingCount: number) {
    const labels: string[] = []
    if (snapshot?.primary_inner_pack?.enabled) {
        labels.push(`Inner ${Number(snapshot.primary_inner_pack.pcs_per_pack || 0)} pcs`)
    }
    if (snapshot?.roll_dispatch_pack?.enabled) {
        const lineCount = Array.isArray(snapshot.roll_dispatch_pack.lines) ? snapshot.roll_dispatch_pack.lines.length : 0
        labels.push(`Dispatch ${lineCount} line${lineCount === 1 ? "" : "s"}`)
    }
    if (packagingCount > 0) labels.push(`Packaging ${packagingCount} stock`)
    if (podCount > 0) labels.push(`POD ${podCount} stock`)
    return labels.length ? labels : ["None"]
}

function continuationCandidateKey(candidate: any) {
    if (!candidate || typeof candidate !== "object") return ""
    if (candidate.candidate_kind === "stock_order" || candidate.order_id) return `stock:${String(candidate.order_id || "")}`
    return `inv:${String(candidate.inventory_type || "")}:${String(candidate.inventory_id || "")}`
}

function continuationCandidateQty(candidate: any) {
    const allocatable = Number(candidate?.allocatable_qty_kg || 0)
    if (allocatable > 0) return allocatable
    const remaining = Number(candidate?.remaining_qty_kg || 0)
    if (remaining > 0) return remaining
    return 0
}

function continuationCandidateLabel(candidate: any) {
    return String(
        candidate?.display_name ||
        candidate?.label ||
        candidate?.order_number ||
        candidate?.candidate_label ||
        "Candidate"
    ).trim()
}

function continuationCandidateStepLabel(candidate: any) {
    const stopIndex = Number(candidate?.stop_step_index ?? candidate?.completed_step_index)
    if (Number.isFinite(stopIndex) && stopIndex >= 0) {
        return `Stopped after step ${stopIndex}`
    }
    if (candidate?.route_span_label) return String(candidate.route_span_label)
    if (candidate?.reason_label) return String(candidate.reason_label)
    return "Ready for continuation"
}

export default function PlannerControlTowerPage() {
    const queryClient = useQueryClient()
    const { toast } = useToast()

    const [activeTab, setActiveTab] = useState<PlannerTab>("planning")
    const [selectedPlanningRowKey, setSelectedPlanningRowKey] = useState("")
    const [queueFilter, setQueueFilter] = useState<QueueFilter>("ALL")
    const [queueSearch, setQueueSearch] = useState("")
    const [fgTypeFilter, setFgTypeFilter] = useState("all")
    const [materialFilter, setMaterialFilter] = useState("all")
    const [gradeFilter, setGradeFilter] = useState("all")
    const [widthFilter, setWidthFilter] = useState("")
    const [heightFilter, setHeightFilter] = useState("")
    const [thicknessFilter, setThicknessFilter] = useState("")
    const [dueFilter, setDueFilter] = useState<PlannerDueFilter>("ALL")
    const [plantFilter, setPlantFilter] = useState("all")
    const [sourcePathFilter, setSourcePathFilter] = useState<PlannerSourceFilter>("ALL")
    const [historyDaysFilter, setHistoryDaysFilter] = useState<HistoryDaysFilter>("30")
    const [historySearch, setHistorySearch] = useState("")
    const [historySourceFilter, setHistorySourceFilter] = useState<"ALL" | "FG" | "WIP" | "FRESH">("ALL")
    const [historyOrderKindFilter, setHistoryOrderKindFilter] = useState<"ALL" | "SALES" | "STOCK">("ALL")
    const [historyExpandedRows, setHistoryExpandedRows] = useState<Record<string, boolean>>({})
    const [planStateMap, setPlanStateMap] = useState<Record<string, OrderPlanState>>({})
    const [wipModeMap, setWipModeMap] = useState<Record<string, WipMode>>({})
    const [wipCandidateMap, setWipCandidateMap] = useState<Record<string, string>>({})
    const [expandedSections, setExpandedSections] = useState<Record<DetailSectionKey, boolean>>({
        route: true,
        material: false,
    })

    const [claimDialogOpen, setClaimDialogOpen] = useState(false)
    const [claimOrder, setClaimOrder] = useState<PlannerControlOrder | null>(null)
    const [claimCandidates, setClaimCandidates] = useState<ClaimCandidate[]>([])
    const [claimCandidatesLoading, setClaimCandidatesLoading] = useState(false)
    const [selectedClaimKey, setSelectedClaimKey] = useState("")
    const [artworkItemSelection, setArtworkItemSelection] = useState<Record<string, string>>({})
    const [artworkSelection, setArtworkSelection] = useState<Record<string, string>>({})
    const queuePreferenceInitialized = useRef(false)

    const historyDaysValue = historyDaysFilter === "TODAY" ? 1 : historyDaysFilter === "ALL" ? null : Number(historyDaysFilter)
    const selectedDetailKey = parsePlannerRowKey(selectedPlanningRowKey)
    const { data: hubData, isLoading, isError, error, refetch } = useQuery({
        queryKey: [
            "planner-control-hub-v2",
            historyDaysFilter,
            historySearch,
            historySourceFilter,
            historyOrderKindFilter,
            selectedDetailKey?.orderKind || "",
            selectedDetailKey?.orderId || "",
        ],
        queryFn: () =>
            plannerService.getControlHub({
                planning_limit: 18,
                active_limit: 24,
                history_limit: 48,
                history_days: historyDaysValue,
                history_query: historySearch.trim() || undefined,
                history_source: historySourceFilter,
                history_order_kind: historyOrderKindFilter,
                detail_order_kind: selectedDetailKey?.orderKind,
                detail_order_id: selectedDetailKey?.orderId,
            }),
        refetchInterval: 60000,
        refetchOnWindowFocus: true,
        retry: 1,
        retryDelay: 1500,
    })

    const { data: jobs = [] } = useQuery({
        queryKey: ["planner-jobs-v2"],
        queryFn: plannerService.getJobs,
        refetchInterval: 60000,
        refetchOnWindowFocus: true,
        retry: 1,
        retryDelay: 1500,
    })
    const { data: masterGrades = [] } = useQuery({
        queryKey: ["recipe-grades"],
        queryFn: () => recipeService.getGrades(),
    })
    const { data: filmFamilies = [] } = useQuery({
        queryKey: ["film-families"],
        queryFn: masterDataService.getFilmFamilies,
    })
    const { data: filmVariants = [] } = useQuery({
        queryKey: ["film-variants"],
        queryFn: masterDataService.getFilmVariants,
    })

    const queueRows = useMemo(() => hubData?.orders || [], [hubData])
    const prioritizedQueueRows = useMemo(
        () =>
            [...queueRows].sort((left, right) => {
                const scoreDelta = queuePriorityScore(right) - queuePriorityScore(left)
                if (scoreDelta !== 0) return scoreDelta
                const leftDue = selectedDateNumber(left.delivery_date || left.order_fact_sheet?.delivery_date)
                const rightDue = selectedDateNumber(right.delivery_date || right.order_fact_sheet?.delivery_date)
                if (leftDue !== rightDue) return leftDue - rightDue
                return String(left.order_number || "").localeCompare(String(right.order_number || ""))
            }),
        [queueRows]
    )
    const plannerFgTypeOptions = useMemo<SalesOverflowChipOption[]>(() => {
        const counts = new Map<string, number>()
        prioritizedQueueRows.forEach((row) => {
            const value = String(row.fg_type || row.final_product_type || row.planned_output_type || "").trim().toUpperCase()
            if (!value) return
            counts.set(value, (counts.get(value) || 0) + 1)
        })
        return SALES_SUPPORTED_FG_TYPES.map((value) => ({
            value,
            label: value,
            count: counts.get(value) || 0,
            tone: value === "ROLL" ? "fgRoll" as const : "fgPouch" as const,
        }))
    }, [prioritizedQueueRows])
    const plannerMaterialOptions = useMemo<SalesOverflowChipOption[]>(() => {
        const candidates = salesUniqueText([
            ...SALES_MATERIAL_PRIORITY,
            ...filmFamilies.flatMap((family: any) => [family?.code, family?.name]),
            ...filmVariants.flatMap((variant: any) => [variant?.code, variant?.name, variant?.parent_family_name]),
        ]).map(salesMaterialFilterLabel).filter(Boolean)
        return salesSortChipOptions(
            salesUniqueText(candidates).map((value) => ({
                value,
                label: value,
                count: prioritizedQueueRows.filter((row) => plannerRowBlob(row).includes(value.toLowerCase())).length,
                tone: "material" as const,
            })),
            SALES_MATERIAL_PRIORITY
        )
    }, [filmFamilies, filmVariants, prioritizedQueueRows])
    const plannerGradeOptions = useMemo<SalesOverflowChipOption[]>(() => {
        const values = new Set<string>()
        const starterGrades = SALES_GRADE_PRIORITY
        masterGrades.forEach((grade: any) => {
            const value = String(grade?.name || grade?.code || grade || "").trim()
            if (value) values.add(value)
        })
        starterGrades.forEach((value) => values.add(value))
        return Array.from(values)
            .map((value) => ({
                value,
                label: value,
                count: prioritizedQueueRows.filter((row) => plannerRowBlob(row).includes(value.toLowerCase())).length,
                tone: "grade" as const,
            }))
            .sort((left, right) => {
                const priority = SALES_GRADE_PRIORITY
                const leftIndex = priority.indexOf(left.value.toUpperCase())
                const rightIndex = priority.indexOf(right.value.toUpperCase())
                if (leftIndex !== -1 || rightIndex !== -1) return (leftIndex === -1 ? 999 : leftIndex) - (rightIndex === -1 ? 999 : rightIndex)
                return right.count - left.count || left.label.localeCompare(right.label)
            })
    }, [masterGrades, prioritizedQueueRows])
    const plannerWidthPresets = useMemo(
        () => plannerRangePresets(prioritizedQueueRows.map((row) => plannerRowWidth(row)), "mm"),
        [prioritizedQueueRows]
    )
    const plannerHeightPresets = useMemo(
        () => plannerRangePresets(prioritizedQueueRows.map((row) => plannerRowHeight(row)), "mm"),
        [prioritizedQueueRows]
    )
    const plannerThicknessPresets = useMemo(
        () => plannerRangePresets(prioritizedQueueRows.flatMap((row) => plannerRowThicknesses(row)), "μ"),
        [prioritizedQueueRows]
    )
    const plannerPlantOptions = useMemo<SalesOverflowChipOption[]>(() => {
        const counts = new Map<string, number>()
        prioritizedQueueRows.forEach((row) => {
            const value = String((row as any).plant_name || (row as any).default_plant_name || (row as any).plant || "").trim()
            if (!value) return
            counts.set(value, (counts.get(value) || 0) + 1)
        })
        return Array.from(counts.entries())
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([value, count]) => ({ value, label: value, count, tone: "muted" as const }))
    }, [prioritizedQueueRows])
    const visibleQueueRows = useMemo(
        () =>
            prioritizedQueueRows.filter((row) => {
                const blockerCount = Number(row.release_checklist?.blocked_count ?? (row.blockers || []).length)
                if (queueFilter === "ARTWORK_GATE") return Boolean(row.artwork_gate?.active)
                if (queueFilter === "BLOCKED") return blockerCount > 0
                if (queueFilter === "READY") return blockerCount === 0 && !row.artwork_gate?.active
                return true
            }).filter((row) => {
                const blob = plannerRowBlob(row)
                const fgType = String(row.fg_type || row.final_product_type || row.planned_output_type || "").trim().toUpperCase()
                if (fgTypeFilter !== "all" && fgType !== fgTypeFilter.toUpperCase()) return false
                if (materialFilter !== "all" && !blob.includes(materialFilter.toLowerCase())) return false
                if (gradeFilter !== "all" && !blob.includes(gradeFilter.toLowerCase())) return false
                if (sourcePathFilter !== "ALL" && plannerRowSource(row) !== sourcePathFilter) return false
                if (!plannerDateMatches(row.delivery_date || row.order_fact_sheet?.delivery_date, dueFilter)) return false
                if (plantFilter !== "all") {
                    const plantText = String((row as any).plant_name || (row as any).default_plant_name || (row as any).plant || "").trim()
                    if (plantText !== plantFilter) return false
                }
                if (!plannerNumberInRange(plannerRowWidth(row), widthFilter)) return false
                if (!plannerNumberInRange(plannerRowHeight(row), heightFilter)) return false
                if (thicknessFilter.trim()) {
                    const values = plannerRowThicknesses(row)
                    if (!values.length || !values.some((value) => plannerNumberInRange(value, thicknessFilter))) return false
                }
                return true
            }).filter((row) => {
                const search = queueSearch.trim().toLowerCase()
                if (!search) return true
                return plannerRowBlob(row).includes(search)
            }),
        [
            prioritizedQueueRows,
            queueFilter,
            queueSearch,
            fgTypeFilter,
            materialFilter,
            gradeFilter,
            widthFilter,
            heightFilter,
            thicknessFilter,
            dueFilter,
            plantFilter,
            sourcePathFilter,
        ]
    )
    const artworkGateRows = useMemo(
        () => prioritizedQueueRows.filter((row) => Boolean(row.artwork_gate?.active)),
        [prioritizedQueueRows]
    )
    const activeRows = useMemo(() => hubData?.active_orders || [], [hubData])
    const historyRows = useMemo(() => hubData?.order_history || [], [hubData])
    const prioritizedActiveRows = useMemo(
        () =>
            [...activeRows].sort((left, right) => {
                const leftPlanned = String(left.status || "").toUpperCase() === "PLANNED" ? 0 : 1
                const rightPlanned = String(right.status || "").toUpperCase() === "PLANNED" ? 0 : 1
                if (leftPlanned !== rightPlanned) return leftPlanned - rightPlanned
                const leftDue = selectedDateNumber(left.delivery_date || left.order_fact_sheet?.delivery_date)
                const rightDue = selectedDateNumber(right.delivery_date || right.order_fact_sheet?.delivery_date)
                if (leftDue !== rightDue) return leftDue - rightDue
                return String(left.order_number || "").localeCompare(String(right.order_number || ""))
            }),
        [activeRows]
    )
    const readyStockReleaseRows = useMemo(
        () =>
            prioritizedActiveRows.filter((row) =>
                String(row.order_kind || "").toLowerCase() === "stock" &&
                String(row.status || "").toUpperCase() === "PLANNED" &&
                !Boolean(row.artwork_assignment_required)
            ),
        [prioritizedActiveRows]
    )
    const historyAuditRows = useMemo(
        () =>
            [...historyRows].sort((left, right) => {
                const leftDate = selectedDateNumber(left.completed_at || left.created_at || left.delivery_date || left.order_fact_sheet?.delivery_date)
                const rightDate = selectedDateNumber(right.completed_at || right.created_at || right.delivery_date || right.order_fact_sheet?.delivery_date)
                if (leftDate !== rightDate) return rightDate - leftDate
                return String(left.order_number || "").localeCompare(String(right.order_number || ""))
            }),
        [historyRows]
    )
    const selectedPlanningRow = useMemo(
        () => prioritizedQueueRows.find((row) => rowKey(row) === selectedPlanningRowKey) || null,
        [prioritizedQueueRows, selectedPlanningRowKey]
    )
    const selectedClaimCandidate = useMemo(
        () => claimCandidates.find((c) => `${c.inventory_type}:${c.inventory_id}` === selectedClaimKey) || null,
        [claimCandidates, selectedClaimKey]
    )
    const selectedArtworkGateItems = selectedPlanningRow?.pending_artwork_items || []
    const selectedArtworkGateItemId = selectedPlanningRow
        ? artworkItemSelection[rowKey(selectedPlanningRow)] || selectedArtworkGateItems[0]?.id || ""
        : ""
    const selectedArtworkGateItem =
        selectedArtworkGateItems.find((item) => item.id === selectedArtworkGateItemId) || selectedArtworkGateItems[0]
    const selectedArtworkId = selectedPlanningRow ? artworkSelection[rowKey(selectedPlanningRow)] || "" : ""
    const artworkGateActive = Boolean(selectedPlanningRow?.artwork_gate?.active && selectedArtworkGateItems.length > 0)
    const artworkGatePrintType = String(
        selectedArtworkGateItem?.print_type || selectedPlanningRow?.print_type || ""
    ).toUpperCase()
    const artworkGateFrontCount = Number(
        selectedArtworkGateItem?.front_colors_count ?? selectedPlanningRow?.front_colors_count ?? 0
    )
    const artworkGateBackCount = Number(
        selectedArtworkGateItem?.back_colors_count ?? selectedPlanningRow?.back_colors_count ?? 0
    )

    const { data: artworkOptions = [], isLoading: artworkOptionsLoading } = useQuery({
        queryKey: [
            "planner-artwork-options",
            artworkGateActive ? selectedPlanningRow?.order_id : "none",
            selectedArtworkGateItemId || "none",
            artworkGatePrintType || "none",
            artworkGateFrontCount,
            artworkGateBackCount,
        ],
        queryFn: () =>
            engineeringService.getArtworks({
                status: "APPROVED",
                print_type: artworkGatePrintType || undefined,
                front_colors_count: artworkGateFrontCount,
                back_colors_count: artworkGateBackCount,
                cylinder_ready: artworkGatePrintType === "ROTO" ? "true" : undefined,
            }),
        enabled: artworkGateActive,
    })

    const selectedChecklist = selectedPlanningRow?.release_checklist?.items || []
    const selectedFactSheet = selectedPlanningRow?.order_fact_sheet
    const releaseChecklistReadyCount = selectedChecklist.filter((item) => String(item.status).toUpperCase() === "READY").length
    const releaseReady = Boolean(selectedPlanningRow?.release_checklist?.release_ready) && !artworkGateActive
    const selectedLayerSummary = Array.isArray(selectedPlanningRow?.layer_summary) ? selectedPlanningRow.layer_summary : []
    const selectedAddonSummary = Array.isArray(selectedPlanningRow?.addons_snapshot) ? selectedPlanningRow.addons_snapshot : []
    const selectedPackagingSnapshot = (selectedPlanningRow?.packaging_snapshot && typeof selectedPlanningRow.packaging_snapshot === "object")
        ? selectedPlanningRow.packaging_snapshot
        : {}
    const selectedLayerDetails = Array.isArray(selectedPlanningRow?.display_layers) && selectedPlanningRow.display_layers.length
        ? selectedPlanningRow.display_layers
        : Array.isArray(selectedPlanningRow?.layer_snapshot)
        ? selectedPlanningRow.layer_snapshot.map((layer, index) => summarizeLayerRow(layer, index))
        : selectedLayerSummary
    const selectedLayerCards = Array.isArray(selectedPlanningRow?.layer_snapshot) && selectedPlanningRow.layer_snapshot.length
        ? selectedPlanningRow.layer_snapshot.map((layer, index) => buildLayerCard(layer, index, selectedLayerDetails[index]))
        : selectedLayerDetails.map((line, index) => buildLayerCard(line, index, String(line || "")))
    const selectedAddonDetails = selectedAddonSummary.length
        ? selectedAddonSummary.map((addon: any) => summarizeAddon(addon))
        : []
    const selectedPackagingCardLabel = [
        selectedPackagingSnapshot?.primary_inner_pack?.enabled
            ? `Inner ${Number(selectedPackagingSnapshot.primary_inner_pack.pcs_per_pack || 0)} pcs`
            : "",
        selectedPackagingSnapshot?.roll_dispatch_pack?.enabled
            ? `Dispatch ${Array.isArray(selectedPackagingSnapshot.roll_dispatch_pack.lines) ? selectedPackagingSnapshot.roll_dispatch_pack.lines.length : 0} line${Array.isArray(selectedPackagingSnapshot.roll_dispatch_pack.lines) && selectedPackagingSnapshot.roll_dispatch_pack.lines.length === 1 ? "" : "s"}`
            : "",
    ].filter(Boolean).join(" · ") || "No packaging rules"
    const selectedPodCardLabel = String((selectedFactSheet as any)?.pod_label || "").trim() || "No POD stock linked"
    const plannerSavedFilters: SalesSavedViewFilters = {
        activeTab,
        queueFilter,
        queueSearch,
        fgTypeFilter,
        materialFilter,
        gradeFilter,
        widthFilter,
        heightFilter,
        thicknessFilter,
        dueFilter,
        plantFilter,
        sourcePathFilter,
    }
    const applyPlannerSavedFilters = (filters: SalesSavedViewFilters) => {
        if (typeof filters.activeTab === "string") setActiveTab(filters.activeTab as PlannerTab)
        if (typeof filters.queueFilter === "string") setQueueFilter(filters.queueFilter as QueueFilter)
        setQueueSearch(String(filters.queueSearch || ""))
        setFgTypeFilter(String(filters.fgTypeFilter || "all"))
        setMaterialFilter(String(filters.materialFilter || "all"))
        setGradeFilter(String(filters.gradeFilter || "all"))
        setWidthFilter(String(filters.widthFilter || ""))
        setHeightFilter(String(filters.heightFilter || ""))
        setThicknessFilter(String(filters.thicknessFilter || ""))
        setDueFilter(String(filters.dueFilter || "ALL") as PlannerDueFilter)
        setPlantFilter(String(filters.plantFilter || "all"))
        setSourcePathFilter(String(filters.sourcePathFilter || "ALL") as PlannerSourceFilter)
    }
    const resetPlannerFilters = () => {
        setQueueFilter("ALL")
        setQueueSearch("")
        setFgTypeFilter("all")
        setMaterialFilter("all")
        setGradeFilter("all")
        setWidthFilter("")
        setHeightFilter("")
        setThicknessFilter("")
        setDueFilter("ALL")
        setPlantFilter("all")
        setSourcePathFilter("ALL")
    }

    useEffect(() => {
        if (queuePreferenceInitialized.current) return
        if (!prioritizedQueueRows.length) return
        if (artworkGateRows.length) {
            setQueueFilter("ARTWORK_GATE")
            setSelectedPlanningRowKey(rowKey(artworkGateRows[0]))
        } else {
            setSelectedPlanningRowKey(rowKey(prioritizedQueueRows[0]))
        }
        queuePreferenceInitialized.current = true
    }, [artworkGateRows, prioritizedQueueRows])

    useEffect(() => {
        if (!visibleQueueRows.length) {
            setSelectedPlanningRowKey("")
            return
        }
        const hasSelection = visibleQueueRows.some((row) => rowKey(row) === selectedPlanningRowKey)
        if (!hasSelection) {
            setSelectedPlanningRowKey(rowKey(visibleQueueRows[0]))
        }
    }, [visibleQueueRows, selectedPlanningRowKey])

    useEffect(() => {
        setExpandedSections({
            route: true,
            material: false,
        })
    }, [selectedPlanningRowKey])

    useEffect(() => {
        if (!selectedPlanningRow) return
        const current = getPlanState(selectedPlanningRow)
        if (isSourceOptionEnabled(selectedPlanningRow, current.option)) return
        const fallback: PlanOption = isSourceOptionEnabled(selectedPlanningRow, "FG")
            ? "FG"
            : isSourceOptionEnabled(selectedPlanningRow, "WIP_CONTINUE")
                ? "WIP_CONTINUE"
                : "FRESH"
        updatePlanState(selectedPlanningRow, { option: fallback })
    }, [selectedPlanningRow, planStateMap])

    useEffect(() => {
        if (!selectedPlanningRow || !artworkGateActive) return
        const rowId = rowKey(selectedPlanningRow)
        const defaultItemId = selectedArtworkGateItems[0]?.id || ""
        if (defaultItemId && !artworkItemSelection[rowId]) {
            setArtworkItemSelection((prev) => ({ ...prev, [rowId]: defaultItemId }))
        }
    }, [selectedPlanningRow, artworkGateActive, artworkItemSelection, selectedArtworkGateItems])

    useEffect(() => {
        if (!selectedPlanningRow || !artworkGateActive) return
        if (selectedArtworkId) return
        const defaultArtworkId = String(selectedArtworkGateItem?.artwork_id || "").trim()
        if (!defaultArtworkId) return
        const rowId = rowKey(selectedPlanningRow)
        setArtworkSelection((prev) => ({ ...prev, [rowId]: defaultArtworkId }))
    }, [selectedPlanningRow, artworkGateActive, selectedArtworkId, selectedArtworkGateItem])

    const getPlanState = (row: PlannerControlOrder): OrderPlanState =>
        planStateMap[rowKey(row)] || defaultPlanState(row)

    const getWipMode = (row: PlannerControlOrder): WipMode => {
        const key = rowKey(row)
        const saved = wipModeMap[key]
        if (saved) return saved
        const continuation = row.continuation
        const exactCount = Number(continuation?.exact_stock_route_count || 0) + Number(continuation?.carry_forward_wip_count || 0)
        return exactCount > 0 ? "EXACT" : "INVARIANT"
    }

    const getWipCandidates = (row: PlannerControlOrder, mode: WipMode) => {
        const continuation = row.continuation
        if (!continuation) return []
        if (mode === "EXACT") {
            return [
                ...(continuation.exact_stock_route_candidates || []),
                ...(continuation.carry_forward_wip_candidates || []),
            ]
        }
        return [
            ...(continuation.shared_invariant_candidates || []),
            ...(continuation.stopped_invariant_route_candidates || []),
            ...(continuation.upstream_candidates || []),
            ...(continuation.stopped_upstream_route_candidates || []),
        ]
    }

    const getSelectedWipCandidate = (row: PlannerControlOrder, mode = getWipMode(row)) => {
        const candidates = getWipCandidates(row, mode)
        if (!candidates.length) return null
        const saved = wipCandidateMap[rowKey(row)]
        if (!saved) return null
        return candidates.find((candidate) => continuationCandidateKey(candidate) === saved) || null
    }

    const buildPlannerAllocations = (row: PlannerControlOrder): PlannerAllocationPayload[] => {
        const state = getPlanState(row)
        const fromManual = Object.values(state.allocations || {})
            .filter((allocation) => Number(allocation.qty) > 0)
            .map((allocation) => ({
                inventory_type: allocation.inventory_type,
                inventory_id: allocation.inventory_id,
                allocated_qty_kg: Number(allocation.qty),
            }))
        if (fromManual.length) return fromManual

        const remainingQty = Number(row.order_fact_sheet?.required_qty_kg || row.required_qty_kg || 0)
        const allocateQty = (qty: number) => Math.max(0, Math.min(remainingQty || qty, qty))

        if (state.option === "FG") {
            const candidate = (row.continuation?.exact_fg_candidates || [])[0]
            if (candidate?.inventory_type && candidate?.inventory_id) {
                const qty = allocateQty(continuationCandidateQty(candidate))
                if (qty > 0) {
                    return [{
                        inventory_type: candidate.inventory_type as "ROLL" | "FG_BATCH",
                        inventory_id: candidate.inventory_id,
                        allocated_qty_kg: qty,
                    }]
                }
            }
        }

        if (state.option === "WIP_CONTINUE") {
            const mode = getWipMode(row)
            const candidate = getSelectedWipCandidate(row, mode)
            if (candidate?.inventory_type && candidate?.inventory_id) {
                const qty = allocateQty(continuationCandidateQty(candidate))
                if (qty > 0) {
                    return [{
                        inventory_type: candidate.inventory_type as "ROLL" | "FG_BATCH",
                        inventory_id: candidate.inventory_id,
                        allocated_qty_kg: qty,
                    }]
                }
            }
        }

        return []
    }

    useEffect(() => {
        if (!selectedPlanningRow) return
        if (getPlanState(selectedPlanningRow).option !== "WIP_CONTINUE") return
        const key = rowKey(selectedPlanningRow)
        const mode = getWipMode(selectedPlanningRow)
        if (!wipModeMap[key]) {
            setWipModeMap((prev) => ({ ...prev, [key]: mode }))
        }
    }, [selectedPlanningRow, planStateMap, wipModeMap])

    const updatePlanState = (row: PlannerControlOrder, patch: Partial<OrderPlanState>) => {
        const key = rowKey(row)
        setPlanStateMap((prev) => {
            const current = prev[key] || defaultPlanState(row)
            return { ...prev, [key]: { ...current, ...patch } }
        })
    }

    const toggleSection = (section: DetailSectionKey) => {
        setExpandedSections((current) => ({ ...current, [section]: !current[section] }))
    }

    const planMutation = useMutation({
        mutationFn: async ({ row, release, allocationsOverride }: { row: PlannerControlOrder; release: boolean; allocationsOverride?: PlannerAllocationPayload[] }) => {
            const state = getPlanState(row)
            const allocations: PlannerAllocationPayload[] = allocationsOverride || Object.values(state.allocations || {})
                .filter((a) => Number(a.qty) > 0)
                .map((a) => ({ inventory_type: a.inventory_type, inventory_id: a.inventory_id, allocated_qty_kg: Number(a.qty) }))
            const planRes = await plannerService.planOrder(row.order_kind, row.order_id, { option: state.option, allocations })
            if (release) await plannerService.releasePlannedOrder(row.order_kind, row.order_id)
            return planRes
        },
        onSuccess: (_res, vars) => {
            toast({
                title: vars.release ? "Plan released" : "Plan saved",
                description: vars.release ? "Order has been planned and released to production." : "Planner workspace changes were saved.",
            })
            queryClient.invalidateQueries({ queryKey: ["planner-control-hub-v2"] })
            queryClient.invalidateQueries({ queryKey: ["planner-jobs-v2"] })
        },
        onError: (err: any) => {
            toast({
                variant: "destructive",
                title: "Planner action failed",
                description: err?.response?.data?.error || err?.response?.data?.detail || err?.message || "Unknown planner error.",
            })
        },
    })

    const releasePlannerRow = (row: PlannerControlOrder) => {
        const state = getPlanState(row)
        if (state.option === "WIP_CONTINUE") {
            const mode = getWipMode(row)
            const candidate = getSelectedWipCandidate(row, mode)
            if (mode === "EXACT" && candidate?.candidate_kind === "stock_order" && candidate.resume_action_allowed && candidate.order_id) {
                resumeRouteMutation.mutate({ row, stockOrderId: candidate.order_id })
                return
            }
        }
        planMutation.mutate({ row, release: true, allocationsOverride: buildPlannerAllocations(row) })
    }

    const assignArtworkMutation = useMutation({
        mutationFn: async (row: PlannerControlOrder) => {
            const rowId = rowKey(row)
            const artworkId = String(artworkSelection[rowId] || "").trim()
            const itemId = String(artworkItemSelection[rowId] || selectedArtworkGateItems[0]?.id || "").trim()
            if (!artworkId) throw new Error("Select approved artwork before assigning.")
            if (!itemId) throw new Error("Select pending order line for artwork assignment.")
            return plannerService.assignArtworkToOrder(row.order_kind, row.order_id, { artwork_id: artworkId, item_id: itemId })
        },
        onSuccess: async (result, row) => {
            const assignedArtworkId = String(result?.artwork_id || "").trim()
            const clearedItemId = String(result?.item_id || "").trim()
            const targetRowKey = rowKey(row)
            queryClient.setQueriesData<ControlHubResponse>({ queryKey: ["planner-control-hub-v2"] }, (current) => {
                if (!current) return current
                const patchRow = (entry: PlannerControlOrder): PlannerControlOrder => {
                    if (rowKey(entry) !== targetRowKey) return entry
                    const nextPendingItems = (entry.pending_artwork_items || []).filter((item) => item.id !== clearedItemId)
                    const gateActive = Boolean(entry.printing_enabled) && nextPendingItems.length > 0
                    return {
                        ...entry,
                        artwork_assignment_required: gateActive,
                        assigned_artwork_id: assignedArtworkId || entry.assigned_artwork_id,
                        pending_artwork_items: nextPendingItems,
                        artwork_gate: {
                            active: gateActive,
                            message: gateActive ? "Printing was confirmed without final artwork. Planner must assign approved artwork before release." : "",
                            pending_count: nextPendingItems.length,
                            selected_item: nextPendingItems[0],
                            items: nextPendingItems,
                            print_type: String(nextPendingItems[0]?.print_type || entry.print_type || entry.artwork_gate?.print_type || "").toUpperCase(),
                            front_colors_count: Number(nextPendingItems[0]?.front_colors_count ?? entry.front_colors_count ?? entry.artwork_gate?.front_colors_count ?? 0),
                            back_colors_count: Number(nextPendingItems[0]?.back_colors_count ?? entry.back_colors_count ?? entry.artwork_gate?.back_colors_count ?? 0),
                        },
                    }
                }
                return {
                    ...current,
                    orders: (current.orders || []).map(patchRow),
                    active_orders: (current.active_orders || []).map(patchRow),
                    order_history: (current.order_history || []).map(patchRow),
                }
            })
            setQueueFilter("ALL")
            setSelectedPlanningRowKey(targetRowKey)
            toast({ title: "Artwork assigned", description: "Planner gate cleared for the selected printing line." })
            await refetch()
        },
        onError: (err: any) => {
            toast({
                variant: "destructive",
                title: "Artwork assignment failed",
                description: err?.response?.data?.error || err?.response?.data?.detail || err?.message || "Could not assign artwork.",
            })
        },
    })

    const claimMutation = useMutation({
        mutationFn: async () => {
            if (!claimOrder?.sales_order_item_id) throw new Error("This row has no sales order item for stock claim.")
            if (!selectedClaimCandidate) throw new Error("Select a claim candidate first.")
            if (selectedClaimCandidate.requires_split_for_partial) throw new Error("Split required before partial claim.")
            return plannerService.claimStockToSales(claimOrder.sales_order_item_id, {
                inventory_type: selectedClaimCandidate.inventory_type,
                inventory_id: selectedClaimCandidate.inventory_id,
                claim_qty_kg: Number(selectedClaimCandidate.claimable_qty_kg || 0),
            })
        },
        onSuccess: () => {
            toast({ title: "Stock claimed", description: "Inventory was linked to the selected sales item." })
            setClaimDialogOpen(false)
            setClaimOrder(null)
            setClaimCandidates([])
            setSelectedClaimKey("")
            queryClient.invalidateQueries({ queryKey: ["planner-control-hub-v2"] })
        },
        onError: (err: any) => {
            toast({ variant: "destructive", title: "Stock claim failed", description: err?.response?.data?.error || err?.message || "Claim action failed." })
        },
    })

    const resumeRouteMutation = useMutation({
        mutationFn: async ({ row, stockOrderId }: { row: PlannerControlOrder; stockOrderId: string }) => {
            if (!row.sales_order_item_id) throw new Error("This row has no sales order item for route continuation.")
            return plannerService.resumeStockRouteToSales(row.sales_order_item_id, stockOrderId)
        },
        onSuccess: () => {
            toast({ title: "Route continuation created", description: "Planner resumed the exact stopped MTS route for this sales row." })
            queryClient.invalidateQueries({ queryKey: ["planner-control-hub-v2"] })
        },
        onError: (err: any) => {
            toast({ variant: "destructive", title: "Could not resume stock route", description: err?.response?.data?.error || err?.message || "Resume action failed." })
        },
    })

    const releaseOrderMutation = useMutation({
        mutationFn: async (row: PlannerControlOrder) => plannerService.releasePlannedOrder(row.order_kind, row.order_id),
        onSuccess: (_result, row) => {
            toast({
                title: "Order released",
                description: `${row.order_number} was released to production.`,
            })
            queryClient.invalidateQueries({ queryKey: ["planner-control-hub-v2"] })
            queryClient.invalidateQueries({ queryKey: ["planner-jobs-v2"] })
        },
        onError: (err: any) => {
            toast({
                variant: "destructive",
                title: "Release failed",
                description: err?.response?.data?.error || err?.response?.data?.detail || err?.message || "Could not release this order.",
            })
        },
    })

    const releaseStockBatchMutation = useMutation({
        mutationFn: async (rows: PlannerControlOrder[]) => {
            for (const row of rows) {
                await plannerService.releasePlannedOrder(row.order_kind, row.order_id)
            }
            return rows.length
        },
        onSuccess: (count) => {
            toast({
                title: "Stock orders released",
                description: `${count} planned stock order${count === 1 ? "" : "s"} moved to production.`,
            })
            queryClient.invalidateQueries({ queryKey: ["planner-control-hub-v2"] })
            queryClient.invalidateQueries({ queryKey: ["planner-jobs-v2"] })
        },
        onError: (err: any) => {
            toast({
                variant: "destructive",
                title: "Batch release failed",
                description: err?.response?.data?.error || err?.response?.data?.detail || err?.message || "Could not release the selected stock orders.",
            })
        },
    })

    const openClaimDialog = async (row: PlannerControlOrder) => {
        if (!row.sales_order_item_id) {
            toast({ variant: "destructive", title: "No sales item", description: "This row cannot claim stock because sales-order item id is missing." })
            return
        }
        try {
            setClaimCandidatesLoading(true)
            setClaimOrder(row)
            const payload = await plannerService.getClaimCandidates(row.sales_order_item_id)
            const next = payload.candidates || []
            setClaimCandidates(next)
            setSelectedClaimKey(next[0] ? `${next[0].inventory_type}:${next[0].inventory_id}` : "")
            setClaimDialogOpen(true)
        } catch (err: any) {
            toast({ variant: "destructive", title: "Could not load claim candidates", description: err?.response?.data?.error || err?.message || "Claim candidate lookup failed." })
        } finally {
            setClaimCandidatesLoading(false)
        }
    }

    // ─── MAIN RENDER ────────────────────────────────────────────────
    const selectedPlanState = selectedPlanningRow ? getPlanState(selectedPlanningRow) : null
    const selectedStats = selectedPlanningRow ? sourceStats(selectedPlanningRow) : { fgMatchCount: 0, wipMatchCount: 0, hasFg: false, hasWip: false }
    const selectedAllInventoryOptions = selectedPlanningRow
        ? (selectedPlanningRow.workspace?.inventory_options || selectedPlanningRow.inventory_options || [])
        : []
    const selectedFgInventoryOptions = selectedAllInventoryOptions.filter((inv) => Boolean(inv.is_final_step))
    const selectedWipInventoryOptions = selectedAllInventoryOptions.filter((inv) => !Boolean(inv.is_final_step))
    const selectedInventoryOptions = selectedPlanningRow
        ? (selectedAllInventoryOptions.filter((inv) => {
            if (!selectedPlanState) return false
            if (selectedPlanState.option === "FG") return Boolean(inv.is_final_step)
            if (selectedPlanState.option === "WIP_CONTINUE") return !Boolean(inv.is_final_step)
            return false
        }))
        : []
    const selectedMaterialLines = selectedPlanningRow?.workspace?.material_plan_lines || selectedPlanningRow?.material_plan_lines || []
    const selectedCoveragePct = Number(selectedPlanningRow?.summary?.coverage_pct || 0)
    const routeStart = Number(selectedPlanningRow?.required_start_step || 0)
    const routeLast = Number(selectedPlanningRow?.route_last_step_index || 0)
    const selectedSourcePathHelp = selectedPlanState?.option === "FG"
        ? "Ship from matching FG stock"
        : selectedPlanState?.option === "WIP_CONTINUE"
            ? "Resume from the matched stopped route"
            : "Run from the first required step"
    const selectedRouteSpanLabel = selectedPlanningRow
        ? selectedPlanState?.option === "FG"
            ? "Direct dispatch"
            : selectedPlanState?.option === "WIP_CONTINUE"
                ? "Continue remaining route"
                : "Run full route"
        : "Route pending"
    const selectedRouteWindowLabel = selectedPlanningRow
        ? selectedPlanState?.option === "FG"
            ? "No new jobs are required"
            : selectedPlanState?.option === "WIP_CONTINUE"
                ? "Resume after the matched stock stop step"
                : `Starts at step ${routeStart} and finishes at step ${routeLast}`
        : "Route pending"
    const selectedAllocationsChosen = selectedInventoryOptions.filter((inv) => Number(selectedPlanState?.allocations[inventoryKey(inv)]?.qty || 0) > 0)
    const selectedStockUseLabel = selectedPlanState?.option === "FRESH"
        ? "No stock claim needed"
        : selectedAllocationsChosen.length
            ? `${selectedAllocationsChosen.length} stock source${selectedAllocationsChosen.length === 1 ? "" : "s"} selected`
            : selectedPlanState?.option === "FG"
                ? `${selectedStats.fgMatchCount} finished lot${selectedStats.fgMatchCount === 1 ? "" : "s"} ready`
                : `${selectedStats.wipMatchCount} continuation lot${selectedStats.wipMatchCount === 1 ? "" : "s"} ready`
    const selectedTemplateLabel = selectedPlanningRow?.template_name || selectedFactSheet?.template_name || "Template pending"
    const selectedDueLabel = formatDateLabel(selectedPlanningRow?.delivery_date || selectedFactSheet?.delivery_date)
    const selectedDemandLabel = [selectedPlanningRow?.display_qty_kg, selectedPlanningRow?.display_qty_pcs].filter(Boolean).join(" · ")
        || `${Number(selectedFactSheet?.required_qty_kg || selectedPlanningRow?.required_qty_kg || 0).toFixed(1)} KG${selectedFactSheet?.required_qty_pcs ? ` · ${Number(selectedFactSheet.required_qty_pcs).toFixed(0)} PCS` : ""}`
    const selectedDueCompactLabel = selectedDueLabel === "Not set" ? "Due not set" : `Due ${selectedDueLabel}`
    const selectedSizeLabel = selectedPlanningRow?.display_geometry_label || (
        selectedPlanningRow
            ? selectedPlanningRow.final_product_type === "ROLL"
                ? `${Number(selectedPlanningRow.roll_invariants?.width_mm || selectedPlanningRow.effective_dims?.width_mm || 0).toFixed(0)} mm roll`
                : `${Number(selectedPlanningRow.effective_dims?.width_mm || 0).toFixed(0)} × ${Number(selectedPlanningRow.effective_dims?.height_mm || 0).toFixed(0)} mm`
            : "Size pending"
    )
    const selectedPrintingLabel = selectedPlanningRow?.display_printing_label || (
        selectedPlanningRow?.printing_enabled
            ? `${selectedPlanningRow.print_type || "PRINT"} · F${Number(selectedPlanningRow.front_colors_count || 0)}/B${Number(selectedPlanningRow.back_colors_count || 0)}`
            : "No printing"
    )
    const selectedArtworkLabel = selectedPlanningRow?.artwork_gate?.selected_item?.label || (artworkGateActive ? "Artwork still needs assignment" : "Artwork cleared or not needed")
    const selectedAddonsLabel = selectedPlanningRow?.display_addons_label || (selectedAddonDetails.length ? selectedAddonDetails.join(" · ") : "No add-ons")
    const selectedSkuLabel = String(
        selectedFactSheet?.display_name ||
        selectedPlanningRow?.display_name ||
        selectedPlanningRow?.template_name ||
        "Spec pending"
    ).trim()
    const selectedVariantLabel = String(
        (selectedPlanningRow as any)?.sku_name ||
        (selectedPlanningRow as any)?.sku_code ||
        selectedFactSheet?.template_name ||
        selectedPlanningRow?.template_name ||
        "Variant pending"
    ).trim()
    const selectedSkuSubLabel = selectedSkuLabel === selectedVariantLabel
        ? selectedTemplateLabel
        : `${selectedSkuLabel} · ${selectedTemplateLabel}`
    const selectedGeometrySubLabel = String(selectedPlanningRow?.final_product_type || "").toUpperCase() === "ROLL" ? "Finished roll" : "Finished pouch"
    const selectedPackagingSubLabel = selectedPackagingSnapshot?.primary_inner_pack?.enabled
        ? "Inner-pack linked"
        : selectedPackagingSnapshot?.roll_dispatch_pack?.enabled
            ? "Roll packing linked"
            : "No packing rule"
    const selectedPodSubLabel = selectedPodCardLabel === "No POD stock linked"
        ? "No POD support"
        : "POD support linked"
    const selectedWipMode = selectedPlanningRow ? getWipMode(selectedPlanningRow) : "EXACT"
    const selectedExactCandidates = selectedPlanningRow ? getWipCandidates(selectedPlanningRow, "EXACT") : []
    const selectedInvariantCandidates = selectedPlanningRow ? getWipCandidates(selectedPlanningRow, "INVARIANT") : []
    const selectedWipCandidates = selectedWipMode === "EXACT" ? selectedExactCandidates : selectedInvariantCandidates
    const selectedWipCandidate = selectedPlanningRow ? getSelectedWipCandidate(selectedPlanningRow, selectedWipMode) : null
    const selectedFgQtyAvailable = selectedFgInventoryOptions.reduce((sum, inv) => sum + Number(inv.allocatable_qty_kg || 0), 0)
    const selectedWipQtyAvailable = selectedWipCandidates.reduce((sum, candidate) => sum + continuationCandidateQty(candidate), 0)
    const selectedRouteAccordionMeta = selectedPlanState?.option === "FRESH"
        ? `Fresh route · ${selectedRouteSpanLabel}`
        : selectedPlanState?.option === "FG"
            ? `FG dispatch · ${selectedStats.fgMatchCount} lot${selectedStats.fgMatchCount === 1 ? "" : "s"}`
            : selectedWipMode === "EXACT"
                ? `Exact WIP · ${selectedExactCandidates.length} match${selectedExactCandidates.length === 1 ? "" : "es"}`
                : `Invariant WIP · ${selectedInvariantCandidates.length} match${selectedInvariantCandidates.length === 1 ? "" : "es"}`
    const selectedSuggestedAction = selectedPlanState?.option === "FG"
        ? "Ship FG directly"
        : selectedPlanState?.option === "WIP_CONTINUE"
            ? selectedWipMode === "EXACT"
                ? "Continue exact WIP"
                : "Continue from invariant"
            : "Run fresh production"
    const selectedInventoryHeadline = selectedPlanState?.option === "FG"
        ? `${selectedStats.fgMatchCount} FG lot${selectedStats.fgMatchCount === 1 ? "" : "s"} ready`
        : selectedPlanState?.option === "WIP_CONTINUE"
            ? selectedWipMode === "EXACT"
                ? `${selectedExactCandidates.length} exact WIP match${selectedExactCandidates.length === 1 ? "" : "es"}`
                : `${selectedInvariantCandidates.length} invariant match${selectedInvariantCandidates.length === 1 ? "" : "es"}`
            : "Fresh route will run"
    const selectedStockSnapshot = selectedPlanState?.option === "FG"
        ? `${selectedStats.fgMatchCount} FG ready`
        : selectedPlanState?.option === "WIP_CONTINUE"
            ? `Exact ${selectedExactCandidates.length} · Invariant ${selectedInvariantCandidates.length}`
            : `Fresh route · ${Number(selectedPlanningRow?.job_count || 0)} job${Number(selectedPlanningRow?.job_count || 0) === 1 ? "" : "s"}`
    const selectedStockChoiceLabel = selectedPlanState?.option === "WIP_CONTINUE"
        ? selectedWipCandidate
            ? continuationCandidateLabel(selectedWipCandidate)
            : selectedWipMode === "EXACT"
                ? "Pick an exact stopped route"
                : "Pick an invariant source"
        : selectedPlanState?.option === "FG"
            ? `${selectedStats.fgMatchCount} FG lot${selectedStats.fgMatchCount === 1 ? "" : "s"}`
            : "Fresh run from step 0"
    const selectedRouteSimpleMeta = selectedPlanState?.option === "FG"
        ? "Ship from matching FG stock"
        : selectedPlanState?.option === "WIP_CONTINUE"
            ? selectedWipMode === "EXACT"
                ? "Resume the same stopped route"
                : "Continue from approved invariant stock"
            : "Run the full route from the first step"
    const selectedMaterialSimpleMeta = selectedPlanningRow?.display_material_summary || (
        selectedMaterialLines.length
            ? `${selectedMaterialLines.length} material line${selectedMaterialLines.length === 1 ? "" : "s"} ready`
            : "Material issue list not ready"
    )
    const releaseBlockedBySelection = selectedPlanState?.option === "WIP_CONTINUE"
        ? selectedWipMode === "EXACT"
            ? (selectedExactCandidates.length > 0 && !selectedWipCandidate) || Boolean(selectedWipCandidate && !selectedWipCandidate.resume_action_allowed)
            : selectedInvariantCandidates.length > 0 && !selectedWipCandidate
        : selectedPlanState?.option === "FG"
            ? selectedStats.fgMatchCount === 0
            : false
    const selectedReleaseHint = selectedPlanState?.option === "FG"
        ? selectedStats.fgMatchCount > 0
            ? "FG lots are ready. Release will dispatch from matching finished stock."
            : "No matching FG lot is ready for direct dispatch."
        : selectedPlanState?.option === "WIP_CONTINUE"
            ? selectedWipMode === "EXACT"
                ? selectedWipCandidate
                    ? selectedWipCandidate.resume_action_allowed
                        ? `Selected exact WIP: ${continuationCandidateLabel(selectedWipCandidate)}`
                        : "Selected WIP cannot resume yet."
                    : "Pick the stopped lot to continue before release."
                : selectedWipCandidate
                    ? `Selected invariant source: ${continuationCandidateLabel(selectedWipCandidate)}`
                    : "Pick the invariant source before release."
            : "Release will create a fresh production route."
    const releaseActionDisabled = planMutation.isPending || resumeRouteMutation.isPending || !releaseReady || releaseBlockedBySelection
    const today = Date.now()
    const msPerDay = 24 * 60 * 60 * 1000
    const releaseBlockedCount = prioritizedQueueRows.filter((row) => {
        const blockerCount = Number(row.release_checklist?.blocked_count ?? (row.blockers || []).length)
        return blockerCount > 0 || Boolean(row.artwork_gate?.active)
    }).length
    const readyNowCount = prioritizedQueueRows.filter((row) => {
        const blockerCount = Number(row.release_checklist?.blocked_count ?? (row.blockers || []).length)
        return blockerCount === 0 && !row.artwork_gate?.active
    }).length
    const overdueCount = prioritizedQueueRows.filter((row) => {
        const raw = row.delivery_date || row.order_fact_sheet?.delivery_date
        if (!raw) return false
        const parsed = new Date(raw).getTime()
        return Number.isFinite(parsed) && parsed < today
    }).length
    const dueSoonCount = prioritizedQueueRows.filter((row) => {
        const raw = row.delivery_date || row.order_fact_sheet?.delivery_date
        if (!raw) return false
        const parsed = new Date(raw).getTime()
        if (!Number.isFinite(parsed)) return false
        const delta = parsed - today
        return delta >= 0 && delta <= msPerDay * 3
    }).length
    const fgDirectCount = prioritizedQueueRows.filter((row) => plannerRowSource(row) === "FG").length
    const wipConvertibleCount = prioritizedQueueRows.filter((row) => plannerRowSource(row) === "WIP").length
    const freshRequiredCount = prioritizedQueueRows.filter((row) => plannerRowSource(row) === "FRESH").length
    const awaitingMaterialCount = prioritizedQueueRows.filter((row) => Number(row.summary?.coverage_pct || 0) > 0 && Number(row.summary?.coverage_pct || 0) < 100).length
    const heroKpis = [
        {
            key: "open",
            label: "Open jobs",
            value: queueRows.length + activeRows.length,
            sub: `${activeRows.length} released / in production`,
        },
        {
            key: "overdue",
            label: "Overdue",
            value: overdueCount,
            sub: `${dueSoonCount} due in 3 days`,
        },
        {
            key: "artwork",
            label: "Awaiting artwork",
            value: artworkGateRows.length,
            sub: `${releaseBlockedCount} blocked rows`,
        },
        {
            key: "material",
            label: "Awaiting material",
            value: awaitingMaterialCount,
            sub: "short coverage rows",
        },
        {
            key: "fg",
            label: "FG-direct ready",
            value: fgDirectCount,
            sub: "ship without conversion",
        },
        {
            key: "wip",
            label: "WIP-convertible",
            value: wipConvertibleCount,
            sub: "resume stopped stock",
        },
        {
            key: "fresh",
            label: "Fresh required",
            value: freshRequiredCount,
            sub: "no inventory match",
        },
    ]

    const planningWorkspace = isLoading && queueRows.length === 0 ? (
        <div className={styles.emptyState} style={{ marginTop: 8 }}>
            <Loader2 className={cn(styles.emptyIcon, styles.spin, "h-12 w-12")} />
            <div className={styles.emptyTitle}>Loading planner queue</div>
            <p className={styles.emptySub}>Building the operating desk and selected match details.</p>
        </div>
    ) : queueRows.length === 0 ? (
        <div className={styles.emptyState} style={{ marginTop: 8 }}>
            <PackageCheck className={cn(styles.emptyIcon, "h-12 w-12")} />
            <div className={styles.emptyTitle}>Queue empty</div>
            <p className={styles.emptySub}>All rows planned or closed.</p>
        </div>
    ) : (
        <div className={styles.planningDesk}>
            <aside className={styles.queueDock}>
                <div className={styles.queueDockHeader}>
                    <div className={styles.queueDockTitleRow}>
                        <div className={styles.queueDockTitle}>
                            <Layers3 className="h-4 w-4" />
                            Planning queue
                        </div>
                        <span className={styles.queueDockCount}>{visibleQueueRows.length} / {queueRows.length}</span>
                    </div>
                    <div className={styles.queueDockFilters}>
                        {([
                            ["ALL", "All"],
                            ["ARTWORK_GATE", "Artwork"],
                            ["BLOCKED", "Blocked"],
                            ["READY", "Ready"],
                        ] as const).map(([value, label]) => (
                            <button
                                key={value}
                                type="button"
                                data-testid={`planner-filter-${String(value).toLowerCase()}`}
                                onClick={() => setQueueFilter(value)}
                                className={cn(styles.queueDockFilter, queueFilter === value && styles.queueDockFilterActive)}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                    <Input
                        value={queueSearch}
                        onChange={(event) => setQueueSearch(event.target.value)}
                        placeholder="Search order, customer, template..."
                        className={styles.queueSearchInput}
                    />
                    {artworkGateRows.length > 0 ? (
                        <button
                            type="button"
                            className={styles.queueFocusBanner}
                            onClick={() => {
                                setQueueFilter("ARTWORK_GATE")
                                setSelectedPlanningRowKey(rowKey(artworkGateRows[0]))
                            }}
                        >
                            <span>{artworkGateRows.length} row{artworkGateRows.length === 1 ? "" : "s"} need artwork</span>
                            <span className={styles.queueFocusBannerAction}>Focus</span>
                        </button>
                    ) : null}
                </div>

                <div className={styles.queueDockBody}>
                    {visibleQueueRows.map((row) => {
                        const key = rowKey(row)
                        const selected = selectedPlanningRowKey === key
                        const blockerCount = Number(row.release_checklist?.blocked_count ?? (row.blockers || []).length)
                        const coverage = Number(row.summary?.coverage_pct || 0)
                        const artworkPending = Boolean(row.artwork_gate?.active)
                        const dueLabel = formatDateLabel(row.delivery_date || row.order_fact_sheet?.delivery_date)
                        const stats = sourceStats(row)
                        return (
                            <div
                                key={key}
                                role="button"
                                tabIndex={0}
                                data-testid={`planner-queue-row-${key}`}
                                className={cn(styles.queueDockRow, selected && styles.queueDockRowActive)}
                                onClick={() => setSelectedPlanningRowKey(key)}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter" || event.key === " ") {
                                        event.preventDefault()
                                        setSelectedPlanningRowKey(key)
                                    }
                                }}
                            >
                                <div className={styles.queueDockRowTop}>
                                    <div className={styles.queueDockRowIdentity}>
                                        <span className={styles.queueDockOrder}>{row.order_number}</span>
                                        <span className={styles.queueDockCustomer}>{row.customer_name || row.display_name || row.template_name}</span>
                                    </div>
                                    <span className={cn(
                                        styles.queueDockBadge,
                                        artworkPending ? styles.queueDockBadgeArtwork : blockerCount > 0 ? styles.queueDockBadgeBlocked : styles.queueDockBadgeReady
                                    )}>
                                        {artworkPending ? "Artwork" : blockerCount > 0 ? `${blockerCount} blocked` : "Ready"}
                                    </span>
                                </div>
                                <div className={styles.queueDockMeta}>
                                    <span>{String(row.order_kind || "").toUpperCase()}</span>
                                    <span>{dueLabel}</span>
                                    <span>{Number(row.required_qty_kg || 0).toFixed(1)} KG</span>
                                </div>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                    {plannerSpecChips(row).slice(0, 5).map((chip) => (
                                        <span
                                            key={`${key}-spec-${chip.label}`}
                                            className={cn("inline-flex min-h-6 items-center rounded-full border px-2 py-0.5 text-[10px] font-black", chip.className)}
                                        >
                                            {chip.label}
                                        </span>
                                    ))}
                                </div>
                                <div className={styles.queueDockSignals}>
                                    <span className={styles.queueSignal}>FG {stats.fgMatchCount}</span>
                                    <span className={styles.queueSignal}>WIP {stats.wipMatchCount}</span>
                                    <span className={styles.queueSignal}>Run {Number(row.required_start_step || 0)}-{Number(row.route_last_step_index || 0)}</span>
                                </div>
                                <div className={styles.queueCoverageTrack}>
                                    <div
                                        className={cn(styles.queueCoverageFill, coverageFillClass(coverage))}
                                        style={{ width: `${Math.min(100, coverage)}%` }}
                                        title={`Coverage ${coverage.toFixed(0)}%`}
                                        aria-label={`Coverage ${coverage.toFixed(0)} percent`}
                                    />
                                </div>
                                <div className={styles.queueDockRowActions}>
                                    <button
                                        type="button"
                                        className={styles.queueDockRowAction}
                                        data-testid={`planner-toggle-details-${key}`}
                                        onClick={(event) => {
                                            event.stopPropagation()
                                            setSelectedPlanningRowKey(key)
                                        }}
                                    >
                                        {selected ? "Selected" : "Open"}
                                    </button>
                                </div>
                            </div>
                        )
                    })}
                    {visibleQueueRows.length === 0 ? (
                        <div className={styles.emptyDashed}>No rows match the current filter.</div>
                    ) : null}
                </div>
            </aside>

            <div className={styles.workspaceOuter}>
                <div className={styles.workspaceMain}>
                    {!selectedPlanningRow ? (
                        <div className={styles.workspaceCard}>
                            <div className={styles.emptyState}>
                                <ClipboardList className={cn(styles.emptyIcon, "h-10 w-10")} />
                                <div className={styles.emptyTitle}>Select a row</div>
                                <p className={styles.emptySub}>Pick an order from the queue to start.</p>
                            </div>
                        </div>
                    ) : (
                        <>
                            <div className={cn(styles.workspaceCard, styles.operatingDeskCard)}>
                                <div className={styles.commandDeckTop}>
                                    <div className={styles.commandDeckIdentity}>
                                        <div className={styles.orderKindLabel}>
                                            {String(selectedPlanningRow.order_kind || "").toUpperCase()}
                                        </div>
                                        <div className={styles.commandDeckTitle}>{selectedPlanningRow.order_number}</div>
                                        <div className={styles.commandDeckSub}>
                                            {selectedFactSheet?.customer_name || selectedFactSheet?.display_name || selectedPlanningRow.customer_name || selectedPlanningRow.display_name || selectedPlanningRow.template_name}
                                        </div>
                                    </div>
                                    <div className={styles.commandDeckMetaStrip}>
                                        <span className={styles.metaChip}>{selectedPlanningRow.template_name || "Custom"}</span>
                                        <span className={styles.metaChip}>{formatDateLabel(selectedPlanningRow.delivery_date || selectedFactSheet?.delivery_date)}</span>
                                        <span className={styles.metaChip}>
                                            {Number(selectedFactSheet?.required_qty_kg || selectedPlanningRow.required_qty_kg || 0).toFixed(1)} KG
                                            {selectedFactSheet?.required_qty_pcs ? ` · ${Number(selectedFactSheet.required_qty_pcs).toFixed(0)} PCS` : ""}
                                        </span>
                                    </div>
                                    <div className={styles.commandActions}>
                                        <div className={styles.sourcePillGroup}>
                                            {(["FG", "WIP_CONTINUE", "FRESH"] as const).map((option) => {
                                                const active = selectedPlanState?.option === option
                                                const enabled = isSourceOptionEnabled(selectedPlanningRow, option)
                                                return (
                                                    <button
                                                        key={option}
                                                        type="button"
                                                        onClick={() => {
                                                            if (!enabled) return
                                                            updatePlanState(selectedPlanningRow, { option })
                                                            if (option !== "WIP_CONTINUE") {
                                                                setWipCandidateMap((prev) => ({ ...prev, [rowKey(selectedPlanningRow)]: "" }))
                                                            }
                                                        }}
                                                        disabled={!enabled}
                                                        className={cn(styles.sourcePill, active && styles.sourcePillActive)}
                                                    >
                                                        {option === "FG" && <PackageCheck className="h-3 w-3" />}
                                                        {option === "WIP_CONTINUE" && <GitMerge className="h-3 w-3" />}
                                                        {option === "FRESH" && <Flame className="h-3 w-3" />}
                                                        {option === "FG" ? "FG" : option === "WIP_CONTINUE" ? "WIP" : "Fresh"}
                                                    </button>
                                                )
                                            })}
                                        </div>
                                        {isSalesPlannerRow(selectedPlanningRow) &&
                                        selectedPlanState?.option === "FG" &&
                                        isSourceOptionEnabled(selectedPlanningRow, "FG") ? (
                                            <button
                                                type="button"
                                                className={styles.secondaryAction}
                                                onClick={() => openClaimDialog(selectedPlanningRow)}
                                                disabled={claimCandidatesLoading}
                                            >
                                                {claimCandidatesLoading ? <Loader2 className={cn("h-3.5 w-3.5", styles.spin)} /> : null}
                                                Claim
                                            </button>
                                        ) : null}
                                        <button
                                            type="button"
                                            className={styles.btnSave}
                                            onClick={() => planMutation.mutate({ row: selectedPlanningRow, release: false, allocationsOverride: buildPlannerAllocations(selectedPlanningRow) })}
                                            disabled={planMutation.isPending || releaseBlockedBySelection}
                                        >
                                            Save
                                        </button>
                                        <button
                                            type="button"
                                            className={styles.btnRelease}
                                            onClick={() => releasePlannerRow(selectedPlanningRow)}
                                            disabled={releaseActionDisabled}
                                        >
                                            {planMutation.isPending || resumeRouteMutation.isPending ? <Loader2 className={cn("h-3.5 w-3.5", styles.spin)} /> : <Rocket className="h-3.5 w-3.5" />}
                                            Release
                                        </button>
                                        {releaseActionDisabled || artworkGateActive || selectedPlanState?.option === "WIP_CONTINUE" ? (
                                            <div className={styles.commandActionHint}>{selectedReleaseHint}</div>
                                        ) : null}
                                    </div>
                                </div>

                                <div className={styles.operatingDeskSheet} data-testid="planner-operating-sheet">
                                    <section className={styles.specDeckCard}>
                                        <div className={styles.specDeckTop}>
                                            <div>
                                                <div className={styles.specDeckLabel}>Spec · what is this</div>
                                                <div className={styles.specDeckTitle}>{selectedSkuLabel}</div>
                                                <div className={styles.specDeckSub}>{selectedSkuSubLabel}</div>
                                            </div>
                                            <div className={styles.specDeckSig}>
                                                spec_sig · {String(selectedPlanningRow.spec_signature || "").slice(0, 12) || "pending"}
                                            </div>
                                        </div>
                                        <div className={styles.specDeckChipRow}>
                                            {plannerSpecChips(selectedPlanningRow).map((chip) => (
                                                <span
                                                    key={`sheet-spec-${chip.label}`}
                                                    className={cn("inline-flex min-h-7 items-center rounded-full border px-3 py-1 text-[11px] font-black", chip.className)}
                                                >
                                                    {chip.label}
                                                </span>
                                            ))}
                                        </div>

                                        <div className={styles.salesDetailGrid}>
                                            <div className={styles.salesDetailCell}>
                                                <div className={styles.detailLabel}>Customer</div>
                                                <div className={styles.detailValue}>{selectedFactSheet?.customer_name || selectedPlanningRow.customer_name || "Customer pending"}</div>
                                            </div>
                                            <div className={styles.salesDetailCell}>
                                                <div className={styles.detailLabel}>Demand</div>
                                                <div className={styles.detailValue}>{selectedDemandLabel}</div>
                                                <div className={styles.detailSub}>{selectedDueCompactLabel}</div>
                                            </div>
                                            <div className={styles.salesDetailCell}>
                                                <div className={styles.detailLabel}>SKU / variant</div>
                                                <div className={styles.detailValue}>{selectedVariantLabel}</div>
                                                <div className={styles.detailSub}>{selectedSkuSubLabel}</div>
                                            </div>
                                            <div className={styles.salesDetailCell}>
                                                <div className={styles.detailLabel}>Geometry</div>
                                                <div className={styles.detailValue}>{selectedSizeLabel}</div>
                                                <div className={styles.detailSub}>{selectedGeometrySubLabel}</div>
                                            </div>
                                            <div className={styles.salesDetailCell}>
                                                <div className={styles.detailLabel}>Printing</div>
                                                <div className={styles.detailValue}>{selectedPrintingLabel}</div>
                                                <div className={styles.detailSub}>{selectedArtworkLabel}</div>
                                            </div>
                                            <div className={styles.salesDetailCell}>
                                                <div className={styles.detailLabel}>Add-ons</div>
                                                <div className={styles.detailValue}>{selectedAddonsLabel}</div>
                                                <div className={styles.detailSub}>{selectedAddonDetails.length ? `${selectedAddonDetails.length} linked` : "No add-ons"}</div>
                                            </div>
                                            <div className={styles.salesDetailCell}>
                                                <div className={styles.detailLabel}>Packaging</div>
                                                <div className={styles.detailValue}>{selectedPackagingCardLabel}</div>
                                                <div className={styles.detailSub}>{selectedPackagingSubLabel}</div>
                                            </div>
                                            <div className={styles.salesDetailCell}>
                                                <div className={styles.detailLabel}>POD</div>
                                                <div className={styles.detailValue}>{selectedPodCardLabel}</div>
                                                <div className={styles.detailSub}>{selectedPodSubLabel}</div>
                                            </div>
                                        </div>

                                        <div className={styles.layerSection}>
                                            <div className={styles.layerSectionHeader}>
                                                <div className={styles.detailLabel}>Layers</div>
                                                <div className={styles.layerSectionMeta}>
                                                    {selectedLayerCards.length
                                                    ? `${selectedLayerCards.length} layer${selectedLayerCards.length === 1 ? "" : "s"}`
                                                    : "No layer stack captured"}
                                                </div>
                                            </div>
                                            <div className={styles.layerVisibleList}>
                                                {selectedLayerCards.length ? selectedLayerCards.map((layerCard, index) => (
                                                    <div
                                                        key={`${rowKey(selectedPlanningRow)}-sheet-layer-${index}-${layerCard.key}`}
                                                        className={styles.layerVisibleRow}
                                                        title={[layerCard.title, layerCard.subtitle, ...(layerCard.metrics || [])].filter(Boolean).join(" · ")}
                                                    >
                                                        <div className={styles.layerVisibleRowTop}>
                                                            <div className={styles.layerVisibleBadge}>{layerCard.badge}</div>
                                                            <div className={styles.layerVisibleMetrics}>
                                                                {(layerCard.metrics || []).map((metric) => (
                                                                    <span key={`${layerCard.key}-${metric}`} className={styles.layerVisibleMetric}>
                                                                        {metric}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        </div>
                                                        <div className={styles.layerVisibleTitle}>{layerCard.title}</div>
                                                        <div className={styles.layerVisibleText}>{layerCard.subtitle}</div>
                                                    </div>
                                                )) : <span className={styles.detailMuted}>No layer stack captured.</span>}
                                            </div>
                                        </div>
                                    </section>

                                    <section className={styles.releaseLogicCard} id="release-logic-card">
                                        <div className={styles.releaseLogicHeader}>
                                            <div>
                                                <div className={styles.specDeckLabel}>Release logic · how to ship this</div>
                                                <div className={styles.releaseLogicSub}>Match engine · invariant signature · {String((selectedPlanningRow as any).invariant_signature || selectedPlanningRow.spec_signature || "").slice(0, 12) || "pending"}</div>
                                            </div>
                                            <div className={styles.releaseLogicNow}>{selectedSuggestedAction}</div>
                                        </div>
                                        <div className={styles.releasePathGrid}>
                                            <div className={cn(
                                                styles.releasePathCard,
                                                styles.releasePathFg,
                                                selectedPlanState?.option === "FG" && styles.releasePathChosen,
                                                !isSourceOptionEnabled(selectedPlanningRow, "FG") && styles.releasePathMuted
                                            )}>
                                                <div className={styles.releasePathBadge}>{selectedPlanState?.option === "FG" ? "Chosen" : isSourceOptionEnabled(selectedPlanningRow, "FG") ? "Available" : "Skipped"}</div>
                                                <div className={styles.releasePathKicker}>Path 1 · FG-direct</div>
                                                <div className={styles.releasePathTitle}>Ship FG directly</div>
                                                <div className={styles.releasePathCopy}>No conversion. Pull from existing finished-goods lots.</div>
                                                <div className={styles.releasePathStats}>
                                                    <span>Lots matched</span><strong>{selectedStats.fgMatchCount}</strong>
                                                    <span>Total qty</span><strong>{selectedFgQtyAvailable.toFixed(0)} KG</strong>
                                                    <span>Plant</span><strong>Best same-plant lot</strong>
                                                    <span>Confidence</span><strong>{selectedStats.fgMatchCount > 0 ? "100%" : "0%"}</strong>
                                                </div>
                                                <button
                                                    type="button"
                                                    className={styles.releasePathAction}
                                                    disabled={!isSourceOptionEnabled(selectedPlanningRow, "FG")}
                                                    onClick={() => updatePlanState(selectedPlanningRow, { option: "FG" })}
                                                >
                                                    Use FG-direct →
                                                </button>
                                            </div>

                                            <div className={cn(
                                                styles.releasePathCard,
                                                styles.releasePathWip,
                                                selectedPlanState?.option === "WIP_CONTINUE" && styles.releasePathChosen,
                                                !isSourceOptionEnabled(selectedPlanningRow, "WIP_CONTINUE") && styles.releasePathMuted
                                            )}>
                                                <div className={styles.releasePathBadge}>{selectedPlanState?.option === "WIP_CONTINUE" ? "Chosen" : isSourceOptionEnabled(selectedPlanningRow, "WIP_CONTINUE") ? "Available" : "Skipped"}</div>
                                                <div className={styles.releasePathKicker}>Path 2 · INV-convert</div>
                                                <div className={styles.releasePathTitle}>Convert WIP roll</div>
                                                <div className={styles.releasePathCopy}>Take a shared invariant roll or stopped route, finish the remaining steps.</div>
                                                <div className={styles.releasePathStats}>
                                                    <span>WIP lots matched</span><strong>{selectedStats.wipMatchCount || selectedWipInventoryOptions.length}</strong>
                                                    <span>Total qty</span><strong>{selectedWipQtyAvailable.toFixed(0)} KG</strong>
                                                    <span>Mode</span><strong>{selectedWipMode === "EXACT" ? "Exact route" : "Invariant"}</strong>
                                                    <span>Confidence</span><strong>{selectedStats.wipMatchCount > 0 ? "85%" : "0%"}</strong>
                                                </div>
                                                <button
                                                    type="button"
                                                    className={styles.releasePathAction}
                                                    disabled={!isSourceOptionEnabled(selectedPlanningRow, "WIP_CONTINUE")}
                                                    onClick={() => updatePlanState(selectedPlanningRow, { option: "WIP_CONTINUE" })}
                                                >
                                                    Use INV-convert
                                                </button>
                                            </div>

                                            <div className={cn(
                                                styles.releasePathCard,
                                                styles.releasePathFresh,
                                                selectedPlanState?.option === "FRESH" && styles.releasePathChosen
                                            )}>
                                                <div className={styles.releasePathBadge}>{selectedPlanState?.option === "FRESH" ? "Chosen" : "Available"}</div>
                                                <div className={styles.releasePathKicker}>Path 3 · Fresh run</div>
                                                <div className={styles.releasePathTitle}>Schedule fresh job</div>
                                                <div className={styles.releasePathCopy}>Use the planner recipe and release a full route only when FG/WIP cannot cover it.</div>
                                                <div className={styles.releasePathStats}>
                                                    <span>Planner recipe</span><strong>{selectedVariantLabel}</strong>
                                                    <span>ETA</span><strong>{routeLast > routeStart ? `${routeLast - routeStart + 1} steps` : "Direct"}</strong>
                                                    <span>Capacity window</span><strong>Check on release</strong>
                                                    <span>Confidence</span><strong>100%</strong>
                                                </div>
                                                <button
                                                    type="button"
                                                    className={styles.releasePathAction}
                                                    onClick={() => updatePlanState(selectedPlanningRow, { option: "FRESH" })}
                                                >
                                                    Schedule fresh
                                                </button>
                                            </div>
                                        </div>
                                    </section>

                                    {selectedPlanState?.option === "WIP_CONTINUE" ? (
                                        <div className={styles.wipChooserCard}>
                                            <div className={styles.wipChooserHeader}>
                                                <div>
                                                    <div className={styles.operatingDeskRowHeader}>WIP source</div>
                                                    <div className={styles.wipChooserSub}>Choose the stopped route or invariant stock to continue from.</div>
                                                </div>
                                                <div className={styles.wipChooserModeRow}>
                                                    <button
                                                        type="button"
                                                        className={cn(styles.wipModePill, selectedWipMode === "EXACT" && styles.wipModePillActive)}
                                                        onClick={() => {
                                                            const key = rowKey(selectedPlanningRow)
                                                            setWipModeMap((prev) => ({ ...prev, [key]: "EXACT" }))
                                                            setWipCandidateMap((prev) => ({ ...prev, [key]: "" }))
                                                        }}
                                                        disabled={!selectedExactCandidates.length}
                                                    >
                                                        Continue exact
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className={cn(styles.wipModePill, selectedWipMode === "INVARIANT" && styles.wipModePillActive)}
                                                        onClick={() => {
                                                            const key = rowKey(selectedPlanningRow)
                                                            setWipModeMap((prev) => ({ ...prev, [key]: "INVARIANT" }))
                                                            setWipCandidateMap((prev) => ({ ...prev, [key]: "" }))
                                                        }}
                                                        disabled={!selectedInvariantCandidates.length}
                                                    >
                                                        Use invariant
                                                    </button>
                                                </div>
                                            </div>
                                            <div className={styles.wipChooserList}>
                                                {(selectedWipMode === "EXACT" ? selectedExactCandidates : selectedInvariantCandidates).length ? (
                                                    (selectedWipMode === "EXACT" ? selectedExactCandidates : selectedInvariantCandidates).map((candidate) => {
                                                        const candidateKey = continuationCandidateKey(candidate)
                                                        const active = selectedWipCandidate && continuationCandidateKey(selectedWipCandidate) === candidateKey
                                                        return (
                                                            <button
                                                                key={candidateKey}
                                                                type="button"
                                                                className={cn(styles.wipChooserOption, active && styles.wipChooserOptionActive)}
                                                                onClick={() => setWipCandidateMap((prev) => ({ ...prev, [rowKey(selectedPlanningRow)]: candidateKey }))}
                                                            >
                                                                <div className={styles.wipChooserOptionTop}>
                                                                    <span className={styles.wipChooserOptionTitle}>{continuationCandidateLabel(candidate)}</span>
                                                                    <span className={styles.wipChooserOptionQty}>{continuationCandidateQty(candidate).toFixed(1)} KG</span>
                                                                </div>
                                                                <div className={styles.wipChooserOptionMeta}>
                                                                    {candidate.reason_label || candidate.candidate_label || candidate.route_span_label || "Ready for continuation"}
                                                                </div>
                                                            </button>
                                                        )
                                                    })
                                                ) : (
                                                    <div className={styles.emptyDashed}>
                                                        {selectedWipMode === "EXACT" ? "No exact continuation is available." : "No invariant continuation is available."}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ) : null}

                                    <section className={styles.inventoryDrillCard}>
                                        <div className={styles.inventoryDrillHeader}>
                                            <div>
                                                <div className={styles.specDeckLabel}>Available inventory · drill-down</div>
                                                <div className={styles.releaseLogicSub}>{selectedInventoryHeadline} · ranked by freshness × distance × qty fit</div>
                                            </div>
                                            <button type="button" className={styles.inventoryLink}>View match-engine →</button>
                                        </div>
                                        {selectedPlanState?.option === "FRESH" ? (
                                            <div className={styles.emptyDashed}>Fresh route selected. No inventory source has to be claimed before release.</div>
                                        ) : selectedPlanState?.option === "WIP_CONTINUE" ? (
                                            <div className={styles.inventoryList}>
                                                {selectedWipCandidates.length ? selectedWipCandidates.slice(0, 5).map((candidate) => {
                                                    const candidateKey = continuationCandidateKey(candidate)
                                                    const active = selectedWipCandidate && continuationCandidateKey(selectedWipCandidate) === candidateKey
                                                    return (
                                                        <button
                                                            key={`inventory-wip-${candidateKey}`}
                                                            type="button"
                                                            className={cn(styles.inventoryRow, active && styles.inventoryRowActive)}
                                                            onClick={() => setWipCandidateMap((prev) => ({ ...prev, [rowKey(selectedPlanningRow)]: candidateKey }))}
                                                        >
                                                            <span className={styles.inventoryKind}>WIP</span>
                                                            <span className={styles.inventoryMain}>
                                                                <strong>{continuationCandidateLabel(candidate)}</strong>
                                                                <small>{continuationCandidateStepLabel(candidate)}</small>
                                                            </span>
                                                            <span className={styles.inventoryQty}>{continuationCandidateQty(candidate).toFixed(1)} KG</span>
                                                            <span className={styles.inventoryAction}>{active ? "Selected" : "Use lot →"}</span>
                                                        </button>
                                                    )
                                                }) : <div className={styles.emptyDashed}>No WIP source matches this row.</div>}
                                            </div>
                                        ) : (
                                            <div className={styles.inventoryList}>
                                                {selectedFgInventoryOptions.length ? selectedFgInventoryOptions.slice(0, 5).map((inv) => {
                                                    const invRecord = inv as unknown as Record<string, unknown>
                                                    const name = String(invRecord.batch_number || invRecord.roll_number || inv.display_name || inv.label || "FG lot").trim()
                                                    const sub = [
                                                        inv.process_state_label || "FG ready",
                                                        invRecord.age_label,
                                                        invRecord.completed_step_label,
                                                    ].filter(Boolean).join(" · ")
                                                    return (
                                                        <button
                                                            key={`inventory-fg-${inventoryKey(inv)}`}
                                                            type="button"
                                                            className={styles.inventoryRow}
                                                            onClick={() => updatePlanState(selectedPlanningRow, { option: "FG" })}
                                                        >
                                                            <span className={styles.inventoryKind}>FG</span>
                                                            <span className={styles.inventoryMain}>
                                                                <strong>{name}</strong>
                                                                <small>{sub || selectedSourcePathHelp}</small>
                                                            </span>
                                                            <span className={styles.inventoryQty}>{Number(inv.allocatable_qty_kg || 0).toFixed(1)} KG</span>
                                                            <span className={styles.inventoryAction}>Use this lot →</span>
                                                        </button>
                                                    )
                                                }) : <div className={styles.emptyDashed}>No finished-goods lot matches this row.</div>}
                                            </div>
                                        )}
                                    </section>
                                </div>
                            </div>

                            <div className={styles.workspaceCard}>
                                <div className={styles.sectionWrap}>
                                    <button
                                            type="button"
                                            className={styles.accordionTrigger}
                                            onClick={() => toggleSection("route")}
                                        >
                                        <div className={styles.accordionTriggerLeft}>
                                                <div className={styles.accordionTriggerLabel}>Route</div>
                                            <span className={styles.accordionTriggerMeta}>{selectedRouteAccordionMeta}</span>
                                        </div>
                                        <ChevronDown className={cn(styles.accordionChevron, expandedSections.route && styles.accordionChevronOpen)} />
                                    </button>
                                    {expandedSections.route ? (
                                        <div className={styles.accordionBody}>
                                            <div className={styles.routePlanGrid}>
                                                <div className={styles.routePlanCard}>
                                                    <div className={styles.detailLabel}>What to run</div>
                                                    <div className={styles.detailValue}>{selectedSuggestedAction}</div>
                                                    <div className={styles.detailSub}>{selectedRouteSimpleMeta}</div>
                                                </div>
                                                <div className={styles.routePlanCard}>
                                                    <div className={styles.detailLabel}>Route steps</div>
                                                    <div className={styles.detailValue}>{selectedRouteSpanLabel}</div>
                                                    <div className={styles.detailSub}>{selectedRouteWindowLabel}</div>
                                                </div>
                                                <div className={styles.routePlanCard}>
                                                    <div className={styles.detailLabel}>Stock to use</div>
                                                    <div className={styles.detailValue}>{selectedStockUseLabel}</div>
                                                    <div className={styles.detailSub}>{selectedStockSnapshot}</div>
                                                </div>
                                            </div>
                                            <div className={styles.routeNote}>
                                                {selectedPlanState?.option === "WIP_CONTINUE"
                                                    ? selectedWipCandidate
                                                        ? `${selectedStockChoiceLabel} will continue this order after release.`
                                                        : "Pick the WIP source above, then release to continue from the next pending step."
                                                    : selectedPlanState?.option === "FG"
                                                        ? "No new jobs are needed. Release will use matching FG stock."
                                                        : "Fresh release will create the full route for the shop floor."}
                                            </div>
                                        </div>
                                    ) : null}
                                </div>
                            </div>

                            <div className={styles.workspaceCard}>
                                <div className={styles.sectionWrap}>
                                    <button
                                            type="button"
                                            className={styles.accordionTrigger}
                                            onClick={() => toggleSection("material")}
                                    >
                                            <div className={styles.accordionTriggerLeft}>
                                                <div className={styles.accordionTriggerLabel}>Material</div>
                                                <span className={styles.accordionTriggerMeta}>{selectedMaterialSimpleMeta}</span>
                                            </div>
                                        <ChevronDown className={cn(styles.accordionChevron, expandedSections.material && styles.accordionChevronOpen)} />
                                    </button>
                                    {expandedSections.material ? (
                                        <div className={styles.accordionBody}>
                                            {selectedMaterialLines.length ? (
                                                <>
                                                    {selectedMaterialLines.map((line, index) => (
                                                        <div key={`${line.policy_key}-${line.material_id || "material"}-${line.step_sequence ?? index}-${index}`} className={styles.materialLineCard}>
                                                            <div className={styles.materialLineHeader}>
                                                                <div>
                                                                    <div className={styles.materialLineName}>{line.material_name}</div>
                                                                    <div className={styles.materialLineSub}>
                                                                        {line.category_code} · Need {Number(line.theoretical_qty || 0).toFixed(3)} {line.uom}
                                                                        {line.consumption_basis ? ` · ${String(line.consumption_basis).replaceAll("_", " ").toLowerCase()}` : ""}
                                                                    </div>
                                                                </div>
                                                                <span className={cn(styles.badge, styles.badgeMuted, styles.materialLineBadge)}>
                                                                    {String(line.policy_source || "").replaceAll("_", " ").toLowerCase()}
                                                                </span>
                                                            </div>
                                                            <div className={styles.policyRow}>
                                                                <div className={styles.policyPill}>
                                                                    <span className={styles.policyPillLabel}>Base rule</span>
                                                                    <span className={styles.policyPillValue}>{policyLabel(line.template_issue_policy_mode, line.template_issue_policy_value)}</span>
                                                                </div>
                                                                <div className={styles.policyPill}>
                                                                    <span className={styles.policyPillLabel}>Issue rule</span>
                                                                    <span className={styles.policyPillValue}>{policyLabel(line.effective_issue_policy_mode, line.effective_issue_policy_value)}</span>
                                                                </div>
                                                                <div className={styles.policyPill}>
                                                                    <span className={styles.policyPillLabel}>Material to issue</span>
                                                                    <span className={styles.policyPillValue}>{Number(line.planned_issue_qty || 0).toFixed(3)} {line.uom}</span>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                    <div className={styles.materialPlanFooter}>
                                                        Shop floor can adjust issue quantities during execution if needed.
                                                    </div>
                                                </>
                                            ) : (
                                                    <div className={styles.emptyDashed}>No material issue plan is ready yet.</div>
                                                )}
                                        </div>
                                    ) : null}
                                </div>
                            </div>
                        </>
                    )}
                </div>

                <div className={styles.releaseRail} data-testid="planner-release-rail">
                    {!selectedPlanningRow ? (
                        <div className={styles.railCard}>
                            <div className={styles.emptyState} style={{ padding: "28px 12px" }}>
                                <Rocket className={cn(styles.emptyIcon, "h-8 w-8")} />
                                <div className={styles.emptyTitle} style={{ fontSize: 13 }}>Select a row</div>
                            </div>
                        </div>
                    ) : (
                        <>
                            <div className={artworkGateActive ? styles.artworkRailCard : styles.railCard} data-testid={`planner-artwork-gate-${rowKey(selectedPlanningRow)}`}>
                                {artworkGateActive ? (
                                    <>
                                    <div className={styles.artworkRailTitle}>
                                        <Zap className="h-3.5 w-3.5" />
                                        Artwork gate
                                    </div>
                                    {selectedArtworkGateItems.length > 1 ? (
                                        <div style={{ marginBottom: 8 }}>
                                            <Label className="mb-1 block text-[11px] font-bold uppercase text-blue-700">Pending line</Label>
                                            <Select
                                                value={selectedArtworkGateItemId}
                                                onValueChange={(v) => setArtworkItemSelection((prev) => ({ ...prev, [rowKey(selectedPlanningRow)]: v }))}
                                            >
                                                <SelectTrigger
                                                    className={cn("min-h-9 h-auto bg-white text-xs [&>span]:line-clamp-none [&>span]:whitespace-normal [&>span]:pr-2", styles.railSelectTrigger)}
                                                    data-testid="planner-artwork-order-line"
                                                >
                                                    <SelectValue placeholder="Select pending line" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {selectedArtworkGateItems.map((line) => (
                                                        <SelectItem key={line.id} value={line.id}>
                                                            {line.label} · {line.print_type} · F{Number(line.front_colors_count || 0)}/B{Number(line.back_colors_count || 0)}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    ) : null}
                                    <div style={{ marginBottom: 10 }}>
                                        <Label className="mb-1 block text-[11px] font-bold uppercase text-blue-700">Approved artwork</Label>
                                        <Select
                                            value={selectedArtworkId}
                                            onValueChange={(v) => setArtworkSelection((prev) => ({ ...prev, [rowKey(selectedPlanningRow)]: v }))}
                                        >
                                            <SelectTrigger
                                                className={cn("min-h-9 h-auto bg-white text-xs [&>span]:line-clamp-none [&>span]:whitespace-normal [&>span]:pr-2", styles.railSelectTrigger)}
                                                data-testid={`planner-approved-artwork-select-${rowKey(selectedPlanningRow)}`}
                                            >
                                                <SelectValue placeholder={artworkOptionsLoading ? "Loading…" : "Select artwork"} />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {(artworkOptions || []).map((option: any) => (
                                                    <SelectItem key={option.id} value={option.id}>
                                                        {option.design_code} · {option.name}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        {!artworkOptionsLoading && (artworkOptions || []).length === 0 ? (
                                            <p style={{ fontSize: 11, color: "#92400e", marginTop: 4 }}>
                                                No compatible artworks found.{" "}
                                                <Link href="/engineering/artworks/create" style={{ textDecoration: "underline" }}>Create artwork →</Link>
                                            </p>
                                        ) : null}
                                    </div>
                                    <Button
                                        className="w-full h-8 text-xs"
                                        variant="outline"
                                        style={{ borderColor: "#bfdbfe", background: "#ffffff", color: "#1d4ed8" }}
                                        onClick={() => assignArtworkMutation.mutate(selectedPlanningRow)}
                                        data-testid={`planner-assign-artwork-${rowKey(selectedPlanningRow)}`}
                                        disabled={
                                            assignArtworkMutation.isPending || artworkOptionsLoading ||
                                            !selectedArtworkId || !(artworkOptions || []).some((o: any) => o.id === selectedArtworkId)
                                        }
                                        >
                                            {assignArtworkMutation.isPending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                                            Assign &amp; clear gate
                                        </Button>
                                    </>
                                ) : (
                                    <>
                                        <div className={styles.railCardTitle}>
                                            <Zap />
                                            Artwork
                                        </div>
                                        <div className={cn(styles.checklistItem, styles.checklistItemReady)}>
                                            <div className={styles.checklistIcon}>
                                                <CheckCircle2 className="h-3.5 w-3.5" />
                                            </div>
                                            <div className={styles.checklistItemContent}>
                                                <div className={styles.checklistItemLabel}>Artwork cleared</div>
                                                <div className={styles.checklistItemMsg}>The selected order can move without an artwork stop.</div>
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>

                            <div className={styles.railCard}>
                                <div className={styles.railCardTitle}>
                                    <CheckCircle2 />
                                    Preflight
                                </div>
                                <div className={cn(styles.releaseBanner, releaseReady ? styles.releaseBannerReady : styles.releaseBannerBlocked)}>
                                    <div className={styles.releaseBannerLabel}>
                                        {releaseReady ? "Ready" : "Blocked"}
                                    </div>
                                    <div className={styles.releaseBannerDesc}>
                                        {releaseReady
                                            ? `${selectedChecklist.length}/${selectedChecklist.length} passing`
                                            : `${releaseChecklistReadyCount}/${selectedChecklist.length} passing`}
                                    </div>
                                </div>
                                {selectedChecklist.map((item) => (
                                    <div key={item.code} className={cn(styles.checklistItem, checklistToneClass(item.status))}>
                                        <div className={styles.checklistIcon}>
                                            {String(item.status).toUpperCase() === "READY"
                                                ? <CheckCircle2 className="h-3.5 w-3.5" />
                                                : <AlertTriangle className="h-3.5 w-3.5" />}
                                        </div>
                                        <div className={styles.checklistItemContent}>
                                            <div className={styles.checklistItemLabel}>{item.label}</div>
                                            <div className={styles.checklistItemMsg}>{item.message}</div>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {(selectedPlanningRow.blockers || []).length > 0 ? (
                                <div className={styles.railCard}>
                                    <div className={styles.railCardTitle}>
                                        <AlertTriangle />
                                        Blockers
                                    </div>
                                    {(selectedPlanningRow.blockers || []).map((b) => (
                                        <div key={b.code} className={styles.blockerCard}>
                                            <div className={styles.blockerCode}>{b.code.replaceAll("_", " ")}</div>
                                            <div className={styles.blockerMsg}>{b.message}</div>
                                        </div>
                                    ))}
                                </div>
                            ) : null}
                        </>
                    )}
                </div>
            </div>
        </div>
    )

    return (
        <div className={styles.shell} data-testid="planner-control-tower-page">

            {/* ── PAGE HEADER ── */}
            <header className={styles.pageHeader}>
                <div className={styles.heroTop}>
                    <div className={styles.heroCopy}>
                        <div className={styles.eyebrow}><Zap className="h-3 w-3" /> Production / Planner</div>
                        <h1 className={styles.pageTitle}>Planner Operating Desk</h1>
                        <p className={styles.heroSubtitle}>
                            Triage incoming sales orders. Match against finished goods, work-in-process, or schedule fresh runs. Same chip taxonomy as sales, so planners can filter and release faster.
                        </p>
                    </div>
                    <div className={styles.headerActions}>
                        <Link href="/production/planner/stock-orders/create" className={cn(styles.headerBtn, styles.headerBtnPrimary)}>
                            <Plus className="h-3.5 w-3.5" />
                            Stock Order
                        </Link>
                        <Link href="/production/planner/sku-catalog" className={styles.headerBtn}>
                            SKU Library
                        </Link>
                        <Link href="/engineering/templates" className={styles.headerBtn}>
                            Templates
                        </Link>
                        <button type="button" className={styles.headerBtn} onClick={() => refetch()}>
                            {isLoading ? <Loader2 className={cn("h-3.5 w-3.5", styles.spin)} /> : null}
                            Refresh
                        </button>
                    </div>
                </div>
                <div className={styles.heroKpiGrid} data-testid="planner-status-ribbon">
                    {heroKpis.map((item) => (
                        <div key={item.key} className={styles.heroGlassCard}>
                            <div className={styles.heroGlassLabel}>{item.label}</div>
                            <div className={styles.heroGlassValue}>{item.value}</div>
                            <div className={styles.heroGlassSub}>{item.sub}</div>
                        </div>
                    ))}
                </div>
            </header>

            {isError ? (
                <section className={styles.inlineError} role="alert">
                    <div>
                        <div className={styles.inlineErrorTitle}>
                            <AlertTriangle className="h-4 w-4" />
                            Planner data is delayed
                        </div>
                        <p>{(error as any)?.response?.data?.error || (error as Error)?.message || "Could not load planner control-hub payload."}</p>
                    </div>
                    <button type="button" onClick={() => refetch()} className={styles.inlineErrorAction}>Retry</button>
                </section>
            ) : null}

            <SalesSavedViewsBar
                scope="planner_queue"
                currentFilters={plannerSavedFilters}
                onApply={applyPlannerSavedFilters}
                viewCounts={{
                    "My planning queue": queueRows.length,
                    "Ready to release": readyNowCount,
                    "Artwork blocked": artworkGateRows.length,
                    "FG direct": prioritizedQueueRows.filter((row) => plannerRowSource(row) === "FG").length,
                    "WIP convertible": prioritizedQueueRows.filter((row) => plannerRowSource(row) === "WIP").length,
                }}
                className="mb-4"
            />

            <section className="mb-4 rounded-[1.35rem] border border-slate-200 bg-white p-4 shadow-[0_16px_38px_-34px_rgba(15,23,42,0.35)]" data-testid="planner-filter-surface">
                <div className="grid gap-3 xl:grid-cols-[minmax(18rem,1fr)_auto] xl:items-start">
                    <Input
                        value={queueSearch}
                        onChange={(event) => setQueueSearch(event.target.value)}
                        placeholder="Search order, customer, SKU, size, grade, material..."
                        className="h-11 rounded-2xl border-slate-200 bg-slate-50 text-sm font-semibold"
                    />
                    <div className="flex flex-wrap gap-2">
                        <button
                            type="button"
                            className={cn(
                                "inline-flex h-10 items-center rounded-full border px-4 text-xs font-black transition",
                                sourcePathFilter === "ALL" && queueFilter === "ALL" && !queueSearch && fgTypeFilter === "all" && materialFilter === "all" && gradeFilter === "all" && !widthFilter && !heightFilter && !thicknessFilter && dueFilter === "ALL" && plantFilter === "all"
                                    ? "border-slate-950 bg-slate-950 text-white"
                                    : "border-slate-200 bg-white text-slate-700 hover:border-blue-300 hover:bg-blue-50"
                            )}
                            onClick={resetPlannerFilters}
                        >
                            Reset
                        </button>
                    </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                    <SalesOverflowChipGroup
                        label="Finished good"
                        value={fgTypeFilter}
                        onChange={setFgTypeFilter}
                        options={plannerFgTypeOptions}
                        maxInline={3}
                    />
                    <SalesSmartRangeFilter label="Width" value={widthFilter} onChange={setWidthFilter} placeholder="300-1200" suffix="mm" presets={plannerWidthPresets} />
                    <SalesSmartRangeFilter label="Height" value={heightFilter} onChange={setHeightFilter} placeholder="120-320" suffix="mm" presets={plannerHeightPresets} />
                    <SalesSmartRangeFilter label="Thickness" value={thicknessFilter} onChange={setThicknessFilter} placeholder="20-80" suffix="μ" presets={plannerThicknessPresets} />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-3">
                    <SalesOverflowChipGroup label="Material" value={materialFilter} onChange={setMaterialFilter} options={plannerMaterialOptions} maxInline={4} />
                    <SalesOverflowChipGroup label="Grade" value={gradeFilter} onChange={setGradeFilter} options={plannerGradeOptions} maxInline={4} />
                    <SalesOverflowChipGroup
                        label="Source"
                        value={sourcePathFilter}
                        onChange={(value) => setSourcePathFilter(value as PlannerSourceFilter)}
                        allValue="ALL"
                        options={[
                            { value: "FG", label: "FG ready", count: prioritizedQueueRows.filter((row) => plannerRowSource(row) === "FG").length, tone: "pack" },
                            { value: "WIP", label: "WIP ready", count: prioritizedQueueRows.filter((row) => plannerRowSource(row) === "WIP").length, tone: "template" },
                            { value: "FRESH", label: "Fresh", count: prioritizedQueueRows.filter((row) => plannerRowSource(row) === "FRESH").length, tone: "muted" },
                        ]}
                        maxInline={3}
                    />
                    <SalesOverflowChipGroup
                        label="Due"
                        value={dueFilter}
                        onChange={(value) => setDueFilter(value as PlannerDueFilter)}
                        allValue="ALL"
                        options={[
                            { value: "OVERDUE", label: "Overdue", count: overdueCount, tone: "fgRoll" },
                            { value: "TODAY", label: "Today", tone: "fgPouch" },
                            { value: "THREE_DAYS", label: "3 days", count: dueSoonCount, tone: "template" },
                            { value: "THIS_WEEK", label: "This week", tone: "pack" },
                            { value: "NO_DATE", label: "No date", tone: "muted" },
                        ]}
                        maxInline={3}
                    />
                    {plannerPlantOptions.length ? (
                        <SalesOverflowChipGroup label="Plant" value={plantFilter} onChange={setPlantFilter} options={plannerPlantOptions} maxInline={3} />
                    ) : null}
                </div>
            </section>

            {/* ── TABS ── */}
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as PlannerTab)}>
                <div className={styles.tabsBar}>
                    {([
                        ["planning", "Planning Queue", queueRows.length],
                        ["active", "Release / In Production", activeRows.length],
                        ["jobs", "Job Board", jobs.length],
                        ["history", "Completed Orders", historyRows.length],
                    ] as const).map(([tab, label, count]) => (
                        <button
                            key={tab}
                            type="button"
                            role="tab"
                            aria-selected={activeTab === tab}
                            data-testid={`planner-tab-${tab}`}
                            onClick={() => setActiveTab(tab)}
                            className={cn(styles.tabBtn, activeTab === tab && styles.tabBtnActive)}
                        >
                            {label}
                            <span className={styles.tabCount}>{count}</span>
                        </button>
                    ))}
                </div>

                <TabsContent value="planning">
                    {planningWorkspace}
                </TabsContent>

                {/* ══════════════════════════════════════════════════════
                    TAB: IN PRODUCTION (active orders)
                    ══════════════════════════════════════════════════════ */}
                <TabsContent value="active">
                    {prioritizedActiveRows.length === 0 ? (
                        <div className={styles.emptyState} style={{ marginTop: 8 }}>
                            <Package className={cn(styles.emptyIcon, "h-12 w-12")} />
                            <div className={styles.emptyTitle}>No active orders</div>
                            <p className={styles.emptySub}>Release-ready and in-production orders appear here.</p>
                        </div>
                    ) : (
                        <div className={styles.tableCard}>
                            <div className={styles.activeToolbar}>
                                <div className={styles.activeToolbarMeta}>
                                    <strong>{readyStockReleaseRows.length}</strong> stock order{readyStockReleaseRows.length === 1 ? "" : "s"} ready for one-click release
                                </div>
                                <div className={styles.activeToolbarActions}>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => releaseStockBatchMutation.mutate(readyStockReleaseRows)}
                                        disabled={releaseStockBatchMutation.isPending || readyStockReleaseRows.length === 0}
                                    >
                                        {releaseStockBatchMutation.isPending ? <Loader2 className={cn("h-3.5 w-3.5", styles.spin)} /> : <Rocket className="h-3.5 w-3.5" />}
                                        Release planned stock
                                    </Button>
                                </div>
                            </div>
                            <table className={styles.dataTable}>
                                <thead>
                                    <tr>
                                        <th>Order</th>
                                        <th>Template</th>
                                        <th>Status</th>
                                        <th>Required</th>
                                        <th>Jobs</th>
                                        <th>Lane</th>
                                        <th className={styles.cellRight}>Due date</th>
                                        <th className={styles.cellRight}>Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {prioritizedActiveRows.map((row) => {
                                        const jobPct = Number(row.job_count || 0) > 0
                                            ? (Number(row.jobs_completed || 0) / Number(row.job_count)) * 100
                                            : 0
                                        const isPlanned = String(row.status || "").toUpperCase() === "PLANNED"
                                        const isReleasing = releaseOrderMutation.isPending && rowKey(releaseOrderMutation.variables || row) === rowKey(row)
                                        return (
                                            <tr key={rowKey(row)}>
                                                <td>
                                                    <div className={styles.cellBold}>{row.order_number}</div>
                                                    <div className={styles.cellSub}>{row.customer_name || row.display_name || ""}</div>
                                                </td>
                                                <td style={{ fontSize: 12, color: "#64748b" }}>{row.template_name}</td>
                                                <td>
                                                    <span className={cn(
                                                        styles.badge,
                                                        isPlanned ? styles.badgeMuted
                                                            : String(row.status || "").toUpperCase() === "RELEASED" ? styles.badgeIndigo
                                                            : String(row.status || "").toUpperCase() === "EXECUTING" ? styles.badgeSky
                                                                : styles.badgeMuted
                                                    )}>
                                                        {String(row.status || "").replaceAll("_", " ")}
                                                    </span>
                                                </td>
                                                <td style={{ fontSize: 13, fontWeight: 600 }}>
                                                    {Number(row.required_qty_kg || 0).toFixed(3)} KG
                                                </td>
                                                <td>
                                                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                                        <div className={styles.progressBar}>
                                                            <div className={styles.progressBarFill} style={{ width: `${jobPct}%` }} />
                                                        </div>
                                                        <span style={{ fontSize: 11, color: "#64748b", whiteSpace: "nowrap" }}>
                                                            {Number(row.jobs_completed || 0)}/{Number(row.job_count || 0)}
                                                        </span>
                                                    </div>
                                                </td>
                                                <td style={{ fontSize: 12, color: "#64748b" }}>
                                                    {isPlanned ? "Ready to release" : "Running"}
                                                </td>
                                                <td className={styles.cellRight} style={{ fontSize: 12, color: "#64748b" }}>
                                                    {formatDateLabel(row.delivery_date || row.order_fact_sheet?.delivery_date)}
                                                </td>
                                                <td className={styles.cellRight}>
                                                    {isPlanned ? (
                                                        <button
                                                            type="button"
                                                            className={styles.secondaryAction}
                                                            onClick={() => releaseOrderMutation.mutate(row)}
                                                            disabled={isReleasing || Boolean(row.artwork_assignment_required)}
                                                        >
                                                            {isReleasing ? <Loader2 className={cn("h-3.5 w-3.5", styles.spin)} /> : null}
                                                            {row.artwork_assignment_required ? "Artwork needed" : "Release"}
                                                        </button>
                                                    ) : (
                                                        <span style={{ fontSize: 11, color: "#94a3b8" }}>Live</span>
                                                    )}
                                                </td>
                                            </tr>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </TabsContent>

                {/* ══════════════════════════════════════════════════════
                    TAB: JOB BOARD
                    ══════════════════════════════════════════════════════ */}
                <TabsContent value="jobs">
                    <div className={styles.kanbanGrid}>
                        {([
                            ["RELEASED", "Released", styles.kanbanReleasedDot],
                            ["EXECUTING", "Executing", styles.kanbanExecutingDot],
                            ["PAUSED", "Paused", styles.kanbanPausedDot],
                            ["COMPLETED", "Completed", styles.kanbanCompletedDot],
                        ] as const).map(([state, label, dotClass]) => {
                            const colJobs = (jobs as any[]).filter((job) => String(job.job_state || "").toUpperCase() === state)
                            return (
                                <div key={state} className={styles.kanbanCol}>
                                    <div className={styles.kanbanColHead}>
                                        <div className={styles.kanbanColTitle}>
                                            <span className={cn(styles.kanbanColDot, dotClass)} />
                                            {label}
                                        </div>
                                        <span className={styles.kanbanColBadge}>{colJobs.length}</span>
                                    </div>
                                    <div className={styles.kanbanColBody}>
                                        {colJobs.length === 0 ? (
                                            <div className={styles.emptyDashed} style={{ margin: 4 }}>No jobs</div>
                                        ) : (
                                            colJobs.map((job: any) => (
                                                <div key={job.id} className={styles.kanbanCard}>
                                                    <div className={styles.kanbanCardNum}>{job.job_number || job.id}</div>
                                                    <div className={styles.kanbanCardSub}>{job.template_name || "Template"}</div>
                                                    <div className={styles.kanbanCardQty}>{Number(job.quantity || 0).toFixed(3)} {job.uom || "KG"}</div>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </TabsContent>

                {/* ══════════════════════════════════════════════════════
                    TAB: COMPLETED ORDERS
                    ══════════════════════════════════════════════════════ */}
                <TabsContent value="history">
                    {historyAuditRows.length === 0 ? (
                        <div className={styles.emptyState} style={{ marginTop: 8 }}>
                            <CheckCircle2 className={cn(styles.emptyIcon, "h-12 w-12")} />
                            <div className={styles.emptyTitle}>No history</div>
                            <p className={styles.emptySub}>Completed orders appear here.</p>
                        </div>
                    ) : (
                        <div className={styles.tableCard}>
                            <div className={styles.auditToolbar}>
                                <div className={styles.auditToolbarGroup}>
                                    {([
                                        ["TODAY", "Today"],
                                        ["7", "7 days"],
                                        ["30", "30 days"],
                                        ["90", "90 days"],
                                        ["ALL", "All"],
                                    ] as const).map(([value, label]) => (
                                        <button
                                            key={value}
                                            type="button"
                                            className={cn(styles.auditPill, historyDaysFilter === value && styles.auditPillActive)}
                                            onClick={() => setHistoryDaysFilter(value)}
                                        >
                                            {label}
                                        </button>
                                    ))}
                                </div>
                                <div className={styles.auditToolbarControls}>
                                    <Input
                                        value={historySearch}
                                        onChange={(event) => setHistorySearch(event.target.value)}
                                        placeholder="Search order, customer, template, job..."
                                        className={styles.auditSearch}
                                    />
                                    <Select value={historySourceFilter} onValueChange={(value) => setHistorySourceFilter(value as "ALL" | "FG" | "WIP" | "FRESH")}>
                                        <SelectTrigger className={cn(styles.auditSelect, "[&>span]:line-clamp-none [&>span]:whitespace-normal [&>span]:pr-2")}>
                                            <SelectValue placeholder="Source used" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="ALL">All sources</SelectItem>
                                            <SelectItem value="FG">FG</SelectItem>
                                            <SelectItem value="WIP">WIP</SelectItem>
                                            <SelectItem value="FRESH">Fresh</SelectItem>
                                        </SelectContent>
                                    </Select>
                                    <Select value={historyOrderKindFilter} onValueChange={(value) => setHistoryOrderKindFilter(value as "ALL" | "SALES" | "STOCK")}>
                                        <SelectTrigger className={cn(styles.auditSelect, "[&>span]:line-clamp-none [&>span]:whitespace-normal [&>span]:pr-2")}>
                                            <SelectValue placeholder="Order kind" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="ALL">All orders</SelectItem>
                                            <SelectItem value="SALES">Sales</SelectItem>
                                            <SelectItem value="STOCK">Stock</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <table className={styles.dataTable}>
                                <thead>
                                    <tr>
                                        <th>Order</th>
                                        <th>Customer</th>
                                        <th>Template</th>
                                        <th>Source used</th>
                                        <th>Required</th>
                                        <th>Jobs closed</th>
                                        <th>Completed on</th>
                                        <th className={styles.cellRight}>Created on</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {historyAuditRows.map((row) => {
                                        const key = rowKey(row)
                                        const expanded = Boolean(historyExpandedRows[key])
                                        const completedJobs = Array.isArray(row.completed_jobs) ? row.completed_jobs : []
                                        const sourceUsedValue = completedOrdersSourceValue(row)
                                        const sourceUsedLabel = completedOrdersSourceLabel(row)
                                        const stateLabel = completedOrdersStateLabel(row)
                                        const stateBadgeClass = completedOrdersStateToneClass(row)
                                        const sourceBadgeClass = sourceUsedValue === "FG"
                                            ? styles.badgeEmerald
                                            : sourceUsedValue === "WIP"
                                                ? styles.badgeIndigo
                                                : styles.badgeAmber
                                        const orderKindLabel = String(row.order_kind || "").toUpperCase()
                                        return (
                                            <Fragment key={key}>
                                                <tr>
                                                    <td>
                                                        <div className={styles.auditOrderCell}>
                                                            <div className={styles.cellBold}>{row.order_number}</div>
                                                            <div className={styles.auditOrderMeta}>
                                                                <span className={cn(styles.badge, stateBadgeClass)}>{stateLabel}</span>
                                                                <span className={cn(styles.badge, styles.badgeMuted)}>{orderKindLabel}</span>
                                                                {(row.job_numbers || []).length ? (
                                                                    <span className={cn(styles.badge, styles.badgeSky)}>
                                                                        {(row.job_numbers || []).length} job{(row.job_numbers || []).length === 1 ? "" : "s"}
                                                                    </span>
                                                                ) : null}
                                                            </div>
                                                            {(row.job_numbers || []).length ? (
                                                                <div className={styles.auditRowSubtle}>
                                                                    {(row.job_numbers || []).slice(0, 3).join(", ")}
                                                                </div>
                                                            ) : null}
                                                        </div>
                                                    </td>
                                                    <td>
                                                        <div className={styles.auditCustomerCell}>{row.customer_name || "Stock order"}</div>
                                                    </td>
                                                    <td>
                                                        <div className={styles.auditTemplateText}>{row.template_name || "—"}</div>
                                                    </td>
                                                    <td>
                                                        <div className={styles.auditSourceCell}>
                                                            <span className={cn(styles.badge, sourceBadgeClass)}>{sourceUsedLabel}</span>
                                                        </div>
                                                    </td>
                                                    <td>
                                                        <div className={styles.auditRequiredText}>
                                                            <div className={styles.auditMetricPillRow}>
                                                                {([row.display_qty_kg, row.display_qty_pcs].filter(Boolean) as string[]).length ? (
                                                                    ([row.display_qty_kg, row.display_qty_pcs].filter(Boolean) as string[]).map((label) => (
                                                                        <span key={`${key}-${label}`} className={cn(styles.badge, styles.badgeSky, styles.auditMetricPill)}>
                                                                            {label}
                                                                        </span>
                                                                    ))
                                                                ) : (
                                                                    <span className={cn(styles.badge, styles.badgeSky, styles.auditMetricPill)}>
                                                                        {`${Number(row.required_qty_kg || 0).toFixed(1)} KG`}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                        <div className={styles.auditRequiredSub}>
                                                            <span className={cn(styles.badge, styles.badgeMuted, styles.auditTemplatePill)}>
                                                                {row.template_name || "Production order"}
                                                            </span>
                                                        </div>
                                                    </td>
                                                    <td>
                                                        <div className={styles.auditJobsCell}>
                                                            <span className={cn(styles.badge, Number(row.jobs_completed || 0) > 0 ? styles.badgeGreen : styles.badgeMuted, styles.auditJobsPill)}>
                                                                {Number(row.jobs_completed || 0)} / {Number(row.job_count || 0)} jobs
                                                            </span>
                                                            <button
                                                                type="button"
                                                                className={styles.auditExpandButton}
                                                                onClick={() => setHistoryExpandedRows((prev) => ({ ...prev, [key]: !expanded }))}
                                                                disabled={!completedJobs.length}
                                                            >
                                                                {completedJobs.length ? (expanded ? "Hide jobs" : `Show jobs (${completedJobs.length})`) : "No jobs"}
                                                                {completedJobs.length ? <ChevronDown className={cn(styles.auditExpandChevron, expanded && styles.auditExpandChevronOpen)} /> : null}
                                                            </button>
                                                        </div>
                                                    </td>
                                                    <td><div className={styles.auditDateText}>{formatDateLabel(row.completed_at || row.created_at || null)}</div></td>
                                                    <td className={styles.cellRight}>
                                                        {formatDateLabel(row.created_at || null)}
                                                    </td>
                                                </tr>
                                                {expanded ? (
                                                    <tr className={styles.auditExpandedRow}>
                                                        <td colSpan={8} className={styles.auditExpandedCell}>
                                                            <div className={styles.historyJobsPanel}>
                                                                <div className={styles.historyJobsHeader}>
                                                                    <div className={styles.historyJobsTitle}>Completed jobs</div>
                                                                    <div className={styles.historyJobsMeta}>Trace by work center, machine, operator, output, and close user</div>
                                                                </div>
                                                                <div className={styles.historyTracePillRow}>
                                                                    <span className={cn(styles.badge, styles.badgeGreen)}>Closed trace</span>
                                                                    <span className={cn(styles.badge, styles.badgeSky)}>{sourceUsedLabel}</span>
                                                                    <span className={cn(styles.badge, styles.badgeMuted)}>{orderKindLabel}</span>
                                                                    <span className={cn(styles.badge, styles.badgeIndigo)}>
                                                                        {completedJobs.length} job{completedJobs.length === 1 ? "" : "s"}
                                                                    </span>
                                                                </div>
                                                                <div className={styles.historyJobsGrid}>
                                                                    {completedJobs.map((job) => (
                                                                        <div key={job.id} className={styles.historyJobCard}>
                                                                            <div className={styles.historyJobTop}>
                                                                                <div>
                                                                                    <div className={styles.historyJobNumber}>{job.job_number}</div>
                                                                                    <div className={styles.historyJobStep}>{job.step_label}{job.process_code ? ` · ${job.process_code}` : ""}</div>
                                                                                </div>
                                                                                <div className={styles.historyJobClosedAt}>{formatDateLabel(job.closed_at || null)}</div>
                                                                            </div>
                                                                            <div className={styles.historyJobPillRow}>
                                                                                <span className={cn(styles.badge, styles.badgeSky)}>Input {job.input_form || "—"}</span>
                                                                                <span className={cn(styles.badge, styles.badgeIndigo)}>Output {job.output_form || "—"}</span>
                                                                                {job.work_center_name ? <span className={cn(styles.badge, styles.badgeMuted)}>{job.work_center_name}</span> : null}
                                                                                {job.machine_name ? <span className={cn(styles.badge, styles.badgeMuted)}>{job.machine_name}</span> : null}
                                                                            </div>
                                                                            <div className={styles.historyJobMetaGrid}>
                                                                                <div className={styles.historyJobMetaItem}>
                                                                                    <span className={styles.historyJobMetaLabel}>Input</span>
                                                                                    <span className={styles.historyJobMetaValue}>{job.input_form || "—"}</span>
                                                                                </div>
                                                                                <div className={styles.historyJobMetaItem}>
                                                                                    <span className={styles.historyJobMetaLabel}>Output</span>
                                                                                    <span className={styles.historyJobMetaValue}>{job.output_form || "—"}</span>
                                                                                </div>
                                                                                <div className={styles.historyJobMetaItem}>
                                                                                    <span className={styles.historyJobMetaLabel}>Planned</span>
                                                                                    <span className={styles.historyJobMetaValue}>{Number(job.planned_qty || 0).toFixed(3)} {job.uom || "KG"}</span>
                                                                                </div>
                                                                                <div className={styles.historyJobMetaItem}>
                                                                                    <span className={styles.historyJobMetaLabel}>Output qty</span>
                                                                                    <span className={styles.historyJobMetaValue}>{Number(job.produced_qty || 0).toFixed(3)} {job.uom || "KG"}</span>
                                                                                </div>
                                                                                <div className={styles.historyJobMetaItem}>
                                                                                    <span className={styles.historyJobMetaLabel}>Remaining</span>
                                                                                    <span className={styles.historyJobMetaValue}>{Number(job.remaining_qty || 0).toFixed(3)} {job.uom || "KG"}</span>
                                                                                </div>
                                                                                <div className={styles.historyJobMetaItem}>
                                                                                    <span className={styles.historyJobMetaLabel}>Scrap / variance</span>
                                                                                    <span className={styles.historyJobMetaValue}>{Number(job.scrap_qty || 0).toFixed(3)} KG</span>
                                                                                </div>
                                                                                <div className={styles.historyJobMetaItem}>
                                                                                    <span className={styles.historyJobMetaLabel}>Work center</span>
                                                                                    <span className={styles.historyJobMetaValue}>{job.work_center_name || "—"}</span>
                                                                                </div>
                                                                                <div className={styles.historyJobMetaItem}>
                                                                                    <span className={styles.historyJobMetaLabel}>Machine</span>
                                                                                    <span className={styles.historyJobMetaValue}>{job.machine_name || "—"}</span>
                                                                                </div>
                                                                                <div className={styles.historyJobMetaItem}>
                                                                                    <span className={styles.historyJobMetaLabel}>Operator</span>
                                                                                    <span className={styles.historyJobMetaValue}>{job.operator_name || "—"}</span>
                                                                                </div>
                                                                                <div className={styles.historyJobMetaItem}>
                                                                                    <span className={styles.historyJobMetaLabel}>Closed by</span>
                                                                                    <span className={styles.historyJobMetaValue}>{job.closed_by_name || "—"}</span>
                                                                                </div>
                                                                            </div>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ) : null}
                                            </Fragment>
                                        )
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </TabsContent>
            </Tabs>

            {/* ── CLAIM STOCK DIALOG ── */}
            <Dialog
                open={claimDialogOpen}
                onOpenChange={(open) => {
                    setClaimDialogOpen(open)
                    if (!open) { setClaimOrder(null); setClaimCandidates([]); setSelectedClaimKey("") }
                }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Claim stock to sales order</DialogTitle>
                        <DialogDescription>
                            Select an invariant-compatible inventory candidate for {claimOrder?.order_number || "this row"}.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                        <Label className="text-xs font-semibold text-slate-600">Eligible candidate</Label>
                        <Select value={selectedClaimKey} onValueChange={setSelectedClaimKey}>
                            <SelectTrigger>
                                <SelectValue placeholder="Select candidate" />
                            </SelectTrigger>
                            <SelectContent>
                                {claimCandidates.map((candidate) => (
                                    <SelectItem key={`${candidate.inventory_type}:${candidate.inventory_id}`} value={`${candidate.inventory_type}:${candidate.inventory_id}`}>
                                        {candidate.label} · {Number(candidate.claimable_qty_kg || 0).toFixed(3)} KG
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {selectedClaimCandidate ? (
                            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs space-y-1">
                                <div><span className="font-semibold">Source order:</span> {selectedClaimCandidate.source_stock_order_no || "N/A"}</div>
                                <div><span className="font-semibold">Claimable:</span> {Number(selectedClaimCandidate.claimable_qty_kg || 0).toFixed(3)} KG</div>
                                <div><span className="font-semibold">Current qty:</span> {Number(selectedClaimCandidate.current_qty_kg || 0).toFixed(3)} KG</div>
                            </div>
                        ) : null}
                        {selectedClaimCandidate?.requires_split_for_partial ? (
                            <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
                                <AlertTriangle className="h-4 w-4" />
                                Split required before partial claim.
                            </div>
                        ) : null}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setClaimDialogOpen(false)}>Cancel</Button>
                        <Button
                            onClick={() => claimMutation.mutate()}
                            disabled={claimMutation.isPending || !selectedClaimCandidate || Boolean(selectedClaimCandidate?.requires_split_for_partial)}
                        >
                            {claimMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                            Claim selected
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}

"use client"

import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
    AlertTriangle,
    CalendarDays,
    CheckCircle2,
    ClipboardList,
    Layers3,
    Loader2,
    PackageCheck,
    Plus,
    Rocket,
    Sparkles,
} from "lucide-react"

import { useToast } from "@/hooks/use-toast"
import {
    plannerService,
    ClaimCandidate,
    PlannerAllocationPayload,
    PlannerControlOrder,
    PlannerInventoryOption,
} from "@/services/planner"
import { engineeringService } from "@/services/engineering"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

type PlannerTab = "planning" | "active" | "jobs" | "history"
type PlanOption = "FG" | "WIP_CONTINUE" | "FRESH"
type QueueFilter = "ALL" | "ARTWORK_GATE" | "BLOCKED" | "READY"

type AllocationState = {
    inventory_type: "ROLL" | "FG_BATCH"
    inventory_id: string
    qty: number
}

type OrderPlanState = {
    option: PlanOption
    allocations: Record<string, AllocationState>
}

const rowKey = (row: PlannerControlOrder) => `${row.order_kind}:${row.order_id}`
const inventoryKey = (row: PlannerInventoryOption) => `${row.inventory_type}:${row.inventory_id}`

function defaultPlanState(row: PlannerControlOrder): OrderPlanState {
    const fallbackHasFg = (row.inventory_options || []).some((inv) => Boolean(inv.is_final_step))
    const fallbackHasWip = (row.inventory_options || []).some((inv) => !Boolean(inv.is_final_step))
    const hasFg = Boolean(row.source_availability?.has_fg ?? fallbackHasFg)
    const hasWip = Boolean(row.source_availability?.has_wip ?? fallbackHasWip)
    const option: PlanOption = hasFg ? "FG" : hasWip ? "WIP_CONTINUE" : "FRESH"
    return {
        option,
        allocations: {},
    }
}

function policyLabel(mode?: string | null, value?: number | null): string {
    const safeMode = String(mode || "NONE").toUpperCase()
    const safeValue = Number(value || 0)
    if (safeMode === "PERCENT_OVER_THEORY") return `${safeValue}% over theory`
    if (safeMode === "FIXED_EXTRA_KG") return `+${safeValue} KG`
    if (safeMode === "MINIMUM_ISSUE_KG") return `Min ${safeValue} KG`
    return "No uplift"
}

function stockStrategyLabel(value?: string | null): string {
    const normalized = String(value || "").trim().toUpperCase()
    if (normalized === "INTERMEDIATE_POOL") return "Intermediate pool"
    if (normalized === "PACKAGING_STOCK") return "Packaging stock"
    return "Final stock"
}

function stockStrategyHint(value?: string | null): string {
    const normalized = String(value || "").trim().toUpperCase()
    if (normalized === "INTERMEDIATE_POOL") {
        return "Continue later from the required route step using invariant-compatible semi-finished rolls."
    }
    if (normalized === "PACKAGING_STOCK") {
        return "Packaging output stays outside planner fulfilment sourcing."
    }
    return "Direct-consumable finished stock that can satisfy compatible demand immediately."
}

function sourceStats(row: PlannerControlOrder) {
    const fallbackOptions = row.workspace?.inventory_options || row.inventory_options || []
    const fgMatchCount = Number(row.source_availability?.fg_match_count ?? fallbackOptions.filter((inv) => Boolean(inv.is_final_step)).length)
    const wipMatchCount = Number(
        row.source_availability?.wip_match_count ??
            fallbackOptions.filter((inv) => !Boolean(inv.is_final_step) && Number(inv.completed_step_index || 0) >= Number(row.required_start_step || 0)).length
    )
    return {
        fgMatchCount,
        wipMatchCount,
        hasFg: Boolean(row.source_availability?.has_fg ?? fgMatchCount > 0),
        hasWip: Boolean(row.source_availability?.has_wip ?? wipMatchCount > 0),
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

function sourceLabel(option: PlanOption) {
    if (option === "FG") return "Use Existing FG"
    if (option === "WIP_CONTINUE") return "Continue from WIP"
    return "Fresh Production"
}

function normalizeOutputType(value?: string | null): string {
    const raw = String(value || "").trim().toUpperCase()
    if (!raw) return ""
    const compact = raw.replace(/[\s-]+/g, "_")
    if (compact.startsWith("FINAL_")) return compact.slice("FINAL_".length)
    if (compact.startsWith("FG_")) return compact.slice("FG_".length)
    if (compact.startsWith("PLANNED_")) return compact.slice("PLANNED_".length)
    return compact
}

function shouldShowPlannedOutputBadge(row: PlannerControlOrder): boolean {
    const plannedRaw = String(row.planned_output_type || "").trim().toUpperCase()
    if (!plannedRaw) return false
    const finalCore = normalizeOutputType(row.final_product_type)
    const plannedCore = normalizeOutputType(plannedRaw)
    const orderKind = String(row.order_kind || "").trim().toUpperCase()
    if (orderKind !== "SALES") {
        if (plannedRaw.startsWith("WIP_") || plannedRaw === "PACKAGING_STOCK") return true
        if (plannedRaw.startsWith("FG_") && plannedCore !== finalCore) return true
    }
    return plannedCore !== finalCore
}

function plannedOutputBadgeLabel(row: PlannerControlOrder): string {
    const plannedRaw = String(row.planned_output_type || "").trim()
    if (!plannedRaw) return ""
    return plannedRaw.replaceAll("_", " ")
}

function checklistTone(status?: string) {
    const normalized = String(status || "").toUpperCase()
    if (normalized === "READY") return "border-emerald-200 bg-emerald-50 text-emerald-800"
    if (normalized === "BLOCKED") return "border-rose-200 bg-rose-50 text-rose-800"
    return "border-amber-200 bg-amber-50 text-amber-800"
}

function recommendationTone(tone?: string) {
    const normalized = String(tone || "").toLowerCase()
    if (normalized === "critical") return "border-rose-200 bg-rose-50 text-rose-900"
    if (normalized === "warning") return "border-amber-200 bg-amber-50 text-amber-900"
    return "border-indigo-200 bg-indigo-50 text-indigo-900"
}

function formatDateLabel(value?: string | null) {
    if (!value) return "Not committed"
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

function completedOrdersSourceLabel(row: PlannerControlOrder): string {
    const option = String(row.source_summary?.recommended_option || row.action_recommendation?.key || "").toUpperCase()
    if (option === "FG") return "Used existing FG"
    if (option === "WIP_CONTINUE") return "Continued from WIP"
    return "Fresh production"
}

function selectedDateNumber(value?: string | null) {
    if (!value) return Number.MAX_SAFE_INTEGER
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) return Number.MAX_SAFE_INTEGER
    return parsed.getTime()
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

export default function PlannerControlTowerPage() {
    const queryClient = useQueryClient()
    const { toast } = useToast()

    const [activeTab, setActiveTab] = useState<PlannerTab>("planning")
    const [selectedPlanningRowKey, setSelectedPlanningRowKey] = useState("")
    const [queueFilter, setQueueFilter] = useState<QueueFilter>("ALL")
    const [planStateMap, setPlanStateMap] = useState<Record<string, OrderPlanState>>({})
    const [shortCloseReasons, setShortCloseReasons] = useState<Record<string, string>>({})

    const [claimDialogOpen, setClaimDialogOpen] = useState(false)
    const [claimOrder, setClaimOrder] = useState<PlannerControlOrder | null>(null)
    const [claimCandidates, setClaimCandidates] = useState<ClaimCandidate[]>([])
    const [claimCandidatesLoading, setClaimCandidatesLoading] = useState(false)
    const [selectedClaimKey, setSelectedClaimKey] = useState("")
    const [artworkItemSelection, setArtworkItemSelection] = useState<Record<string, string>>({})
    const [artworkSelection, setArtworkSelection] = useState<Record<string, string>>({})
    const [showExtendedDetails, setShowExtendedDetails] = useState(false)
    const queuePreferenceInitialized = useRef(false)

    const { data: hubData, isLoading, isError, error, refetch } = useQuery({
        queryKey: ["planner-control-hub-v2"],
        queryFn: plannerService.getControlHub,
        refetchInterval: 15000,
        refetchOnWindowFocus: true,
    })

    const { data: jobs = [] } = useQuery({
        queryKey: ["planner-jobs-v2"],
        queryFn: plannerService.getJobs,
        refetchInterval: 15000,
        refetchOnWindowFocus: true,
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
    const visibleQueueRows = useMemo(
        () =>
            prioritizedQueueRows.filter((row) => {
                const blockerCount = Number(row.release_checklist?.blocked_count ?? (row.blockers || []).length)
                if (queueFilter === "ARTWORK_GATE") return Boolean(row.artwork_gate?.active)
                if (queueFilter === "BLOCKED") return blockerCount > 0
                if (queueFilter === "READY") return blockerCount === 0 && !row.artwork_gate?.active
                return true
            }),
        [prioritizedQueueRows, queueFilter]
    )
    const artworkGateRows = useMemo(
        () => prioritizedQueueRows.filter((row) => Boolean(row.artwork_gate?.active)),
        [prioritizedQueueRows]
    )
    const activeRows = useMemo(() => hubData?.active_orders || [], [hubData])
    const historyRows = useMemo(() => hubData?.order_history || [], [hubData])
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
    const artworkGateActive = Boolean(
        selectedPlanningRow &&
            isSalesPlannerRow(selectedPlanningRow) &&
            selectedArtworkGateItems.length > 0
    )
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
    const selectedSourceSummary = selectedPlanningRow?.source_summary
    const selectedRecommendation = selectedPlanningRow?.action_recommendation
    const releaseChecklistReadyCount = selectedChecklist.filter((item) => String(item.status).toUpperCase() === "READY").length
    const releaseReady = Boolean(selectedPlanningRow?.release_checklist?.release_ready) && !artworkGateActive

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
        setShowExtendedDetails(false)
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

    const getPlanState = (row: PlannerControlOrder): OrderPlanState => {
        return planStateMap[rowKey(row)] || defaultPlanState(row)
    }

    const updatePlanState = (row: PlannerControlOrder, patch: Partial<OrderPlanState>) => {
        const key = rowKey(row)
        setPlanStateMap((prev) => {
            const current = prev[key] || defaultPlanState(row)
            return {
                ...prev,
                [key]: {
                    ...current,
                    ...patch,
                },
            }
        })
    }

    const updateAllocation = (row: PlannerControlOrder, inv: PlannerInventoryOption, qty: number) => {
        const key = rowKey(row)
        const invKey = inventoryKey(inv)
        setPlanStateMap((prev) => {
            const current = prev[key] || defaultPlanState(row)
            const nextAlloc = { ...(current.allocations || {}) }
            if (!qty || qty <= 0) {
                delete nextAlloc[invKey]
            } else {
                nextAlloc[invKey] = {
                    inventory_type: inv.inventory_type,
                    inventory_id: inv.inventory_id,
                    qty,
                }
            }
            return {
                ...prev,
                [key]: {
                    ...current,
                    allocations: nextAlloc,
                },
            }
        })
    }

    const planMutation = useMutation({
        mutationFn: async ({ row, release }: { row: PlannerControlOrder; release: boolean }) => {
            const state = getPlanState(row)
            const allocations: PlannerAllocationPayload[] = Object.values(state.allocations || {})
                .filter((a) => Number(a.qty) > 0)
                .map((a) => ({
                    inventory_type: a.inventory_type,
                    inventory_id: a.inventory_id,
                    allocated_qty_kg: Number(a.qty),
                }))
            const option = state.option
            const planRes = await plannerService.planOrder(row.order_kind, row.order_id, {
                option,
                allocations,
            })
            if (release) {
                await plannerService.releasePlannedOrder(row.order_kind, row.order_id)
            }
            return planRes
        },
        onSuccess: (_res, vars) => {
            toast({
                title: vars.release ? "Plan released" : "Plan saved",
                description: vars.release
                    ? "Order has been planned and released to production."
                    : "Planner workspace changes were saved.",
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

    const shortCloseMutation = useMutation({
        mutationFn: async (row: PlannerControlOrder) => {
            const reason = String(shortCloseReasons[rowKey(row)] || "").trim()
            if (!reason) throw new Error("Enter a short-close reason.")
            return plannerService.shortCloseOrder(row.order_kind, row.order_id, { reason })
        },
        onSuccess: () => {
            toast({ title: "Order short-closed", description: "Order moved out of planning queue." })
            queryClient.invalidateQueries({ queryKey: ["planner-control-hub-v2"] })
        },
        onError: (err: any) => {
            toast({
                variant: "destructive",
                title: "Short-close failed",
                description: err?.response?.data?.error || err?.response?.data?.detail || err?.message || "Could not short-close this order.",
            })
        },
    })

    const assignArtworkMutation = useMutation({
        mutationFn: async (row: PlannerControlOrder) => {
            const rowId = rowKey(row)
            const artworkId = String(artworkSelection[rowId] || "").trim()
            const itemId = String(artworkItemSelection[rowId] || selectedArtworkGateItems[0]?.id || "").trim()
            if (!artworkId) throw new Error("Select approved artwork before assigning.")
            if (!itemId) throw new Error("Select pending order line for artwork assignment.")
            return plannerService.assignArtworkToOrder(row.order_kind, row.order_id, {
                artwork_id: artworkId,
                item_id: itemId,
            })
        },
        onSuccess: () => {
            toast({
                title: "Artwork assigned",
                description: "Planner gate cleared for the selected printing line.",
            })
            queryClient.invalidateQueries({ queryKey: ["planner-control-hub-v2"] })
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
            if (!claimOrder?.sales_order_item_id) {
                throw new Error("This row has no sales order item for stock claim.")
            }
            if (!selectedClaimCandidate) {
                throw new Error("Select a claim candidate first.")
            }
            if (selectedClaimCandidate.requires_split_for_partial) {
                throw new Error("Split required before partial claim.")
            }
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
            toast({
                variant: "destructive",
                title: "Stock claim failed",
                description: err?.response?.data?.error || err?.message || "Claim action failed.",
            })
        },
    })

    const openClaimDialog = async (row: PlannerControlOrder) => {
        if (!row.sales_order_item_id) {
            toast({
                variant: "destructive",
                title: "No sales item",
                description: "This row cannot claim stock because sales-order item id is missing.",
            })
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
            toast({
                variant: "destructive",
                title: "Could not load claim candidates",
                description: err?.response?.data?.error || err?.message || "Claim candidate lookup failed.",
            })
        } finally {
            setClaimCandidatesLoading(false)
        }
    }

    const kpis = useMemo(() => {
        const fallbackRequired = queueRows.reduce((acc, row) => acc + Number(row.required_qty_kg || 0), 0)
        const fallbackAllocatable = queueRows.reduce(
            (acc, row) => acc + (row.inventory_options || []).reduce((inner, option) => inner + Number(option.allocatable_qty_kg || 0), 0),
            0
        )
        return {
            planning_queue_count: Number(hubData?.kpis?.planning_queue_count ?? queueRows.length),
            ready_released_count: Number(hubData?.kpis?.ready_released_count ?? activeRows.length),
            history_count: Number(hubData?.kpis?.history_count ?? historyRows.length),
            queue_blocked_count: Number(
                hubData?.kpis?.queue_blocked_count ?? queueRows.filter((row) => (row.blockers || []).length > 0).length
            ),
            queue_required_qty_kg: Number(hubData?.kpis?.queue_required_qty_kg ?? fallbackRequired),
            queue_allocatable_qty_kg: Number(hubData?.kpis?.queue_allocatable_qty_kg ?? fallbackAllocatable),
        }
    }, [hubData, queueRows, activeRows, historyRows])

    if (isLoading) {
        return (
            <div className="flex h-[70vh] items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
            </div>
        )
    }

    if (isError) {
        return (
            <div className="p-8">
                <Card className="border-rose-200 bg-rose-50">
                    <CardHeader>
                        <CardTitle className="text-rose-900">Planner Control Tower failed to load</CardTitle>
                        <CardDescription className="text-rose-700">
                            {(error as any)?.response?.data?.error || (error as Error)?.message || "Could not load planner control-hub payload."}
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Button onClick={() => refetch()}>Retry</Button>
                    </CardContent>
                </Card>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-slate-50/40 p-6 md:p-8 space-y-6">
            <Card className="border-slate-200 bg-gradient-to-r from-slate-900 via-slate-900 to-indigo-950 text-white overflow-hidden">
                <CardContent className="p-6 md:p-8">
                    <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                            <div className="text-[11px] font-black uppercase tracking-[0.2em] text-indigo-300">Planner Control Tower</div>
                            <h1 className="mt-1 text-3xl font-black">Board + Drawer Workbench</h1>
                            <p className="mt-2 text-sm text-slate-300 max-w-2xl">
                                Pick the fulfilment path, review the material handoff, and release work in one guided workspace.
                            </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <Button asChild variant="outline" className="border-indigo-200/30 bg-indigo-500/10 text-indigo-50 hover:bg-indigo-500/20">
                                <Link href="/engineering/templates">Template Studio</Link>
                            </Button>
                            <Button asChild className="bg-indigo-600 hover:bg-indigo-700 text-white">
                                <Link href="/production/planner/stock-orders/create">
                                    <Plus className="h-4 w-4 mr-2" />
                                    Create Stock Order
                                </Link>
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>

            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
                <Card className="border-slate-200">
                    <CardContent className="p-4">
                        <div className="text-[10px] uppercase font-bold text-slate-500">Planning Queue</div>
                        <div className="mt-1 text-2xl font-black text-slate-900">{kpis.planning_queue_count}</div>
                    </CardContent>
                </Card>
                <Card className="border-slate-200">
                    <CardContent className="p-4">
                        <div className="text-[10px] uppercase font-bold text-slate-500">Ready / Released</div>
                        <div className="mt-1 text-2xl font-black text-slate-900">{kpis.ready_released_count}</div>
                    </CardContent>
                </Card>
                <Card className="border-slate-200">
                    <CardContent className="p-4">
                        <div className="text-[10px] uppercase font-bold text-slate-500">Blocked Rows</div>
                        <div className="mt-1 text-2xl font-black text-amber-600">{kpis.queue_blocked_count}</div>
                    </CardContent>
                </Card>
                <Card className="border-slate-200">
                    <CardContent className="p-4">
                        <div className="text-[10px] uppercase font-bold text-slate-500">Completed Orders</div>
                        <div className="mt-1 text-2xl font-black text-slate-900">{kpis.history_count}</div>
                    </CardContent>
                </Card>
                <Card className="border-slate-200 md:col-span-2">
                    <CardContent className="p-4">
                        <div className="text-[10px] uppercase font-bold text-slate-500">Queue KG Coverage</div>
                        <div className="mt-1 text-sm font-bold text-slate-700">
                            Required {kpis.queue_required_qty_kg.toFixed(3)} KG · Allocatable {kpis.queue_allocatable_qty_kg.toFixed(3)} KG
                        </div>
                    </CardContent>
                </Card>
            </div>

            <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as PlannerTab)} className="space-y-4">
                <TabsList className="h-auto rounded-2xl border border-slate-200 bg-white p-1">
                    <TabsTrigger value="planning" className="rounded-xl px-5 py-2 text-xs font-bold uppercase tracking-wide">
                        Planning Queue ({queueRows.length})
                    </TabsTrigger>
                    <TabsTrigger value="active" className="rounded-xl px-5 py-2 text-xs font-bold uppercase tracking-wide">
                        Ready / Released ({activeRows.length})
                    </TabsTrigger>
                    <TabsTrigger value="jobs" className="rounded-xl px-5 py-2 text-xs font-bold uppercase tracking-wide">
                        Job Board ({jobs.length})
                    </TabsTrigger>
                    <TabsTrigger value="history" className="rounded-xl px-5 py-2 text-xs font-bold uppercase tracking-wide">
                        Completed Orders ({historyRows.length})
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="planning" className="space-y-4">
                    {queueRows.length === 0 ? (
                        <Card className="border-dashed border-slate-300 bg-white">
                            <CardContent className="flex flex-col items-center justify-center py-20">
                                <PackageCheck className="h-10 w-10 text-slate-300" />
                                <h2 className="mt-3 text-lg font-black text-slate-700">No planning backlog</h2>
                                <p className="text-sm text-slate-500">All current rows are already planned, released, or closed.</p>
                            </CardContent>
                        </Card>
                    ) : (
                        <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)_360px]">
                            <Card className="border-slate-200 bg-white">
                                <CardHeader className="pb-3">
                                    <div className="flex items-center justify-between gap-2">
                                        <div>
                                            <CardTitle className="text-sm font-black text-slate-900 flex items-center gap-2">
                                                <Layers3 className="h-4 w-4 text-indigo-600" />
                                                Queue Rail
                                            </CardTitle>
                                            <CardDescription>Artwork-gated and operationally blocked rows are promoted first.</CardDescription>
                                        </div>
                                        <Badge variant="outline" className="bg-slate-50">
                                            {visibleQueueRows.length} shown · {queueRows.length} live
                                        </Badge>
                                    </div>
                                    {artworkGateRows.length > 0 ? (
                                        <div className="flex items-center justify-between rounded-2xl border border-indigo-200 bg-indigo-50 px-3 py-2">
                                            <div className="text-xs font-semibold text-indigo-900">
                                                {artworkGateRows.length} sales row{artworkGateRows.length === 1 ? "" : "s"} still need planner artwork assignment.
                                            </div>
                                            <Button
                                                size="sm"
                                                variant={queueFilter === "ARTWORK_GATE" ? "default" : "outline"}
                                                className="h-8 rounded-full px-3 text-[10px] font-black uppercase tracking-[0.18em]"
                                                onClick={() => {
                                                    setQueueFilter("ARTWORK_GATE")
                                                    setSelectedPlanningRowKey(rowKey(artworkGateRows[0]))
                                                }}
                                            >
                                                Focus gate
                                            </Button>
                                        </div>
                                    ) : null}
                                </CardHeader>
                                <CardContent className="space-y-3">
                                    <div className="flex flex-wrap gap-2">
                                        {([
                                            ["ALL", "All"],
                                            ["ARTWORK_GATE", "Artwork gate"],
                                            ["BLOCKED", "Blocked"],
                                            ["READY", "Ready"],
                                        ] as const).map(([value, label]) => (
                                            <button
                                                key={value}
                                                type="button"
                                                onClick={() => setQueueFilter(value)}
                                                data-testid={`planner-filter-${String(value).toLowerCase()}`}
                                                className={cn(
                                                    "rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] transition",
                                                    queueFilter === value
                                                        ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                                                        : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
                                                )}
                                            >
                                                {label}
                                            </button>
                                        ))}
                                    </div>
                                    <div className="space-y-2 max-h-[70vh] overflow-auto pr-1">
                                    {visibleQueueRows.map((row) => {
                                        const key = rowKey(row)
                                        const selected = selectedPlanningRowKey === key
                                        const blockerCount = Number(row.release_checklist?.blocked_count ?? (row.blockers || []).length)
                                        const coverage = Number(row.summary?.coverage_pct || 0)
                                        return (
                                            <button
                                                key={key}
                                                type="button"
                                                onClick={() => setSelectedPlanningRowKey(key)}
                                                data-testid={`planner-queue-row-${key}`}
                                                className={cn(
                                                    "w-full rounded-2xl border p-3 text-left transition",
                                                    selected
                                                        ? "border-indigo-300 bg-indigo-50/70 shadow-sm"
                                                        : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                                                )}
                                            >
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="min-w-0">
                                                        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                                                            {row.order_kind} · {row.order_fact_sheet?.release_risk || "LOW"} risk
                                                        </div>
                                                        <div className="mt-1 text-lg font-black text-slate-900">{row.order_number}</div>
                                                        <div className="truncate text-xs font-semibold text-slate-600">
                                                            {row.customer_name || row.display_name || row.template_name}
                                                        </div>
                                                    </div>
                                                    <Badge
                                                        variant="outline"
                                                        className={cn(
                                                            blockerCount > 0
                                                                ? "border-amber-300 bg-amber-50 text-amber-700"
                                                                : "border-emerald-300 bg-emerald-50 text-emerald-700"
                                                        )}
                                                    >
                                                        {blockerCount > 0 ? `${blockerCount} blocked` : "Ready"}
                                                    </Badge>
                                                </div>
                                                <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] font-semibold text-slate-600">
                                                    <div>Required {Number(row.required_qty_kg || 0).toFixed(3)} KG</div>
                                                    <div>Coverage {coverage.toFixed(1)}%</div>
                                                </div>
                                                <div className="mt-3 flex flex-wrap gap-1">
                                                    {row.final_product_type ? (
                                                        <Badge variant="outline" className="text-[10px]">{row.final_product_type}</Badge>
                                                    ) : null}
                                                    {row.artwork_gate?.active ? (
                                                        <Badge variant="outline" className="border-indigo-300 bg-indigo-50 text-[10px] text-indigo-700">
                                                            Artwork pending
                                                        </Badge>
                                                    ) : null}
                                                    {shouldShowPlannedOutputBadge(row) ? (
                                                        <Badge variant="outline" className="bg-slate-100 text-[10px]">
                                                            {plannedOutputBadgeLabel(row)}
                                                        </Badge>
                                                    ) : null}
                                                </div>
                                            </button>
                                        )
                                    })}
                                    {!visibleQueueRows.length ? (
                                        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                                            No rows match the current queue filter.
                                        </div>
                                    ) : null}
                                    </div>
                                </CardContent>
                            </Card>

                            <div className="space-y-4">
                                <Card className="border-slate-200 bg-white">
                                    <CardHeader className="pb-4">
                                        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                            <div>
                                                <div className="text-[11px] font-black uppercase tracking-[0.2em] text-indigo-600">Order Summary</div>
                                                <CardTitle className="mt-1 text-2xl font-black text-slate-950">
                                                    {selectedPlanningRow?.order_number || "Select queue row"}
                                                </CardTitle>
                                                <CardDescription className="mt-1 max-w-2xl">
                                                    {selectedPlanningRow
                                                        ? `${selectedFactSheet?.customer_name || selectedFactSheet?.display_name || selectedPlanningRow.template_name} · ${selectedPlanningRow.template_name}`
                                                        : "Select a queue row from the rail to start guided planning."}
                                                </CardDescription>
                                            </div>
                                            {selectedPlanningRow ? (
                                                <div className="flex flex-wrap gap-2">
                                                    <Badge variant="outline">{selectedPlanningRow.final_product_type || "UNSET"}</Badge>
                                                    {selectedFactSheet?.print_type ? (
                                                        <Badge variant="outline" className="bg-slate-50">{selectedFactSheet.print_type}</Badge>
                                                    ) : null}
                                                    {shouldShowPlannedOutputBadge(selectedPlanningRow) ? (
                                                        <Badge variant="outline" className="border-indigo-200 bg-indigo-50 text-indigo-700">
                                                            {plannedOutputBadgeLabel(selectedPlanningRow)}
                                                        </Badge>
                                                    ) : null}
                                                </div>
                                            ) : null}
                                        </div>
                                    </CardHeader>
                                    <CardContent>
                                        {!selectedPlanningRow ? (
                                            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center text-sm text-slate-500">
                                                Choose a queue row from the left rail.
                                            </div>
                                        ) : (
                                            <div className="space-y-4">
                                                <div className="flex flex-wrap gap-2">
                                                    {["1 Order summary", "2 Artwork gate", "3 Source decision", "4 Claim / split", "5 Release"].map((step, index) => (
                                                        <div
                                                            key={step}
                                                            className={cn(
                                                                "rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em]",
                                                                index === 1 && artworkGateActive
                                                                    ? "border-indigo-300 bg-indigo-50 text-indigo-700"
                                                                    : "border-slate-200 bg-white text-slate-500"
                                                            )}
                                                        >
                                                            {step}
                                                        </div>
                                                    ))}
                                                </div>
                                                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                                                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                                                        <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">Due date</div>
                                                        <div className="mt-1 flex items-center gap-2 text-sm font-semibold text-slate-900">
                                                            <CalendarDays className="h-4 w-4 text-indigo-600" />
                                                            {formatDateLabel(selectedFactSheet?.delivery_date)}
                                                        </div>
                                                    </div>
                                                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                                                        <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">Required output</div>
                                                        <div className="mt-1 text-sm font-semibold text-slate-900">
                                                            {Number(selectedFactSheet?.required_qty_kg || 0).toFixed(3)} KG
                                                            {selectedFactSheet?.required_qty_pcs ? ` · ${Number(selectedFactSheet.required_qty_pcs).toFixed(0)} PCS` : ""}
                                                        </div>
                                                    </div>
                                                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                                                        <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">Recommended path</div>
                                                        <div className="mt-1 text-sm font-semibold text-slate-900">
                                                            {selectedSourceSummary?.recommended_label || "Review source"}
                                                        </div>
                                                    </div>
                                                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                                                        <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">Release risk</div>
                                                        <div className="mt-1 text-sm font-semibold text-slate-900">
                                                            {selectedFactSheet?.release_risk || "LOW"}
                                                        </div>
                                                    </div>
                                                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                                                        <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">Stock strategy</div>
                                                        <div className="mt-1 text-sm font-semibold text-slate-900">
                                                            {stockStrategyLabel(selectedFactSheet?.stock_strategy || selectedPlanningRow.stock_strategy)}
                                                        </div>
                                                    </div>
                                                </div>

                                                {artworkGateActive ? (
                                                    <div className="rounded-2xl border border-indigo-200 bg-indigo-50/80 px-4 py-3">
                                                        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-700">Artwork assignment required</div>
                                                        <div className="mt-1 text-sm font-semibold text-indigo-900">
                                                            {selectedPlanningRow.artwork_gate?.message || "Planner must assign approved artwork before release."}
                                                        </div>
                                                        {selectedArtworkGateItem ? (
                                                            <div className="mt-2 text-xs text-indigo-800">
                                                                Pending line: <span className="font-black">{selectedArtworkGateItem.label}</span>
                                                            </div>
                                                        ) : null}
                                                    </div>
                                                ) : null}

                                                <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
                                                    <div className="flex items-center justify-between gap-3">
                                                        <div>
                                                            <div className="text-sm font-black text-slate-900">Order facts</div>
                                                            <div className="text-xs text-slate-500">
                                                                Keep only the critical release facts visible by default.
                                                            </div>
                                                        </div>
                                                        <Button variant="ghost" size="sm" onClick={() => setShowExtendedDetails((prev) => !prev)}>
                                                            {showExtendedDetails ? "Hide detail" : "Show more"}
                                                        </Button>
                                                    </div>
                                                    <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3 text-sm">
                                                        <div>
                                                            <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">Customer / row</div>
                                                            <div className="mt-1 font-semibold text-slate-900">{selectedFactSheet?.customer_name || "Internal stock"}</div>
                                                            <div className="text-xs text-slate-500">{selectedFactSheet?.display_name || selectedPlanningRow.template_name}</div>
                                                        </div>
                                                        <div>
                                                            <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">Print profile</div>
                                                            <div className="mt-1 font-semibold text-slate-900">
                                                                {selectedFactSheet?.print_type || "No printing"} · F{Number(selectedFactSheet?.front_colors_count || 0)} / B{Number(selectedFactSheet?.back_colors_count || 0)}
                                                            </div>
                                                        </div>
                                                        <div>
                                                            <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">Consumption mode</div>
                                                            <div className="mt-1 font-semibold text-slate-900">
                                                                {stockStrategyLabel(selectedFactSheet?.stock_strategy || selectedPlanningRow.stock_strategy)}
                                                            </div>
                                                            <div className="text-xs text-slate-500">
                                                                {stockStrategyHint(selectedFactSheet?.stock_strategy || selectedPlanningRow.stock_strategy)}
                                                            </div>
                                                        </div>
                                                        <div>
                                                            <div className="text-[10px] font-black uppercase tracking-wide text-slate-500">Current status</div>
                                                            <div className="mt-1 font-semibold text-slate-900">{selectedFactSheet?.status || selectedPlanningRow.status}</div>
                                                        </div>
                                                    </div>
                                                    {showExtendedDetails ? (
                                                        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4 text-xs text-slate-600">
                                                            <div className="rounded-xl border border-slate-200 bg-white p-3">
                                                                <div className="font-black uppercase tracking-wide text-slate-500">Geometry</div>
                                                                <div className="mt-1">{Number(selectedPlanningRow.effective_dims?.width_mm || 0).toFixed(2)} × {Number(selectedPlanningRow.effective_dims?.height_mm || 0).toFixed(2)} mm</div>
                                                            </div>
                                                            <div className="rounded-xl border border-slate-200 bg-white p-3">
                                                                <div className="font-black uppercase tracking-wide text-slate-500">Route span</div>
                                                                <div className="mt-1">Step {selectedPlanningRow.required_start_step} → {selectedPlanningRow.route_last_step_index}</div>
                                                            </div>
                                                            <div className="rounded-xl border border-slate-200 bg-white p-3">
                                                                <div className="font-black uppercase tracking-wide text-slate-500">Material lines</div>
                                                                <div className="mt-1">{Number(selectedPlanningRow.material_plan_summary?.line_count || 0)} lines · planner is read-only</div>
                                                            </div>
                                                            <div className="rounded-xl border border-slate-200 bg-white p-3">
                                                                <div className="font-black uppercase tracking-wide text-slate-500">Partial shortfall</div>
                                                                <div className="mt-1">{Number(selectedFactSheet?.partial_shortfall_kg || 0).toFixed(3)} KG</div>
                                                            </div>
                                                        </div>
                                                    ) : null}
                                                </div>
                                            </div>
                                        )}
                                    </CardContent>
                                </Card>

                                {selectedPlanningRow ? (
                                    <>
                                        <Card className="border-slate-200 bg-white">
                                            <CardHeader className="pb-3">
                                                <div className="flex items-center justify-between gap-3">
                                                    <div>
                                                        <CardTitle className="text-base font-black text-slate-900">Source decision</CardTitle>
                                                        <CardDescription>
                                                            Choose the fulfilment path first, then allocate compatible stock if needed.
                                                        </CardDescription>
                                                    </div>
                                                    <div className="flex flex-wrap gap-2">
                                                        <Badge variant="outline" className="bg-slate-50">FG {selectedSourceSummary?.fg_match_count ?? sourceStats(selectedPlanningRow).fgMatchCount}</Badge>
                                                        <Badge variant="outline" className="bg-slate-50">WIP {selectedSourceSummary?.wip_match_count ?? sourceStats(selectedPlanningRow).wipMatchCount}</Badge>
                                                        <Badge variant="outline" className="bg-slate-50">Stock orders {selectedSourceSummary?.matching_stock_order_count ?? (selectedPlanningRow.matching_stock_orders || []).length}</Badge>
                                                    </div>
                                                </div>
                                            </CardHeader>
                                            <CardContent className="space-y-4">
                                                <div className="grid gap-2 sm:grid-cols-3">
                                                    {(["FG", "WIP_CONTINUE", "FRESH"] as const).map((option) => {
                                                        const active = getPlanState(selectedPlanningRow).option === option
                                                        const enabled = isSourceOptionEnabled(selectedPlanningRow, option)
                                                        return (
                                                            <button
                                                                key={option}
                                                                type="button"
                                                                onClick={() => {
                                                                    if (!enabled) return
                                                                    updatePlanState(selectedPlanningRow, { option })
                                                                }}
                                                                disabled={!enabled}
                                                                className={cn(
                                                                    "rounded-2xl border px-4 py-3 text-left text-sm font-semibold transition",
                                                                    active
                                                                        ? "border-indigo-300 bg-indigo-50 text-indigo-700 shadow-sm"
                                                                        : enabled
                                                                            ? "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                                                                            : "cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400"
                                                                )}
                                                            >
                                                                <div className="font-black">{sourceLabel(option)}</div>
                                                                <div className="mt-1 text-xs font-medium opacity-80">
                                                                    {option === "FG"
                                                                        ? "Fastest path when final compatible stock exists."
                                                                        : option === "WIP_CONTINUE"
                                                                            ? "Resume compatible semi-finished inventory."
                                                                            : "Plan full fresh conversion from the route start."}
                                                                </div>
                                                            </button>
                                                        )
                                                    })}
                                                </div>

                                                {String(selectedPlanningRow.order_kind || "").toUpperCase() === "SALES" &&
                                                getPlanState(selectedPlanningRow).option === "FG" &&
                                                isSourceOptionEnabled(selectedPlanningRow, "FG") ? (
                                                    <div className="flex justify-end">
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            onClick={() => openClaimDialog(selectedPlanningRow)}
                                                            disabled={claimCandidatesLoading}
                                                        >
                                                            {claimCandidatesLoading ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                                                            Claim / Split Stock
                                                        </Button>
                                                    </div>
                                                ) : null}

                                                <div className="space-y-2">
                                                    <div className="text-[11px] font-black uppercase tracking-wide text-slate-500">Eligible inventory pool</div>
                                                    <div className="space-y-2">
                                                        {(selectedPlanningRow.workspace?.inventory_options || selectedPlanningRow.inventory_options || [])
                                                            .filter((inv) => {
                                                                const option = getPlanState(selectedPlanningRow).option
                                                                if (option === "FG") return Boolean(inv.is_final_step)
                                                                if (option === "WIP_CONTINUE") {
                                                                    return !Boolean(inv.is_final_step) &&
                                                                        Number(inv.completed_step_index || 0) >= Number(selectedPlanningRow.required_start_step || 0)
                                                                }
                                                                return false
                                                            })
                                                            .map((inv) => (
                                                                <div key={inventoryKey(inv)} className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 md:grid-cols-[1fr_auto_auto] md:items-center">
                                                                    <div>
                                                                        <div className="font-bold text-slate-900">{inv.label}</div>
                                                                        <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-slate-500">
                                                                            <span>Step {inv.completed_step_index}</span>
                                                                            <span>·</span>
                                                                            <span>{inv.signature_match_mode}</span>
                                                                            <Badge variant="outline" className="h-5 bg-white text-[10px] font-bold">
                                                                                {stockStrategyLabel(inv.stock_strategy)}
                                                                            </Badge>
                                                                        </div>
                                                                    </div>
                                                                    <div className="text-right text-xs">
                                                                        <div className="font-semibold text-slate-700">{Number(inv.allocatable_qty_kg || 0).toFixed(3)} KG</div>
                                                                        <div className="text-slate-500">allocatable</div>
                                                                    </div>
                                                                    <Input
                                                                        type="number"
                                                                        min={0}
                                                                        max={Number(inv.allocatable_qty_kg || 0)}
                                                                        step={0.001}
                                                                        className="h-9 w-full text-xs md:w-28"
                                                                        value={String(getPlanState(selectedPlanningRow).allocations[inventoryKey(inv)]?.qty ?? "")}
                                                                        onChange={(e) => updateAllocation(selectedPlanningRow, inv, Number(e.target.value || 0))}
                                                                    />
                                                                </div>
                                                            ))}
                                                        {getPlanState(selectedPlanningRow).option === "FRESH" ? (
                                                            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                                                                Fresh production selected. No stock allocation is required before saving the plan.
                                                            </div>
                                                        ) : null}
                                                        {getPlanState(selectedPlanningRow).option !== "FRESH" &&
                                                        (selectedPlanningRow.workspace?.inventory_options || selectedPlanningRow.inventory_options || []).length === 0 ? (
                                                            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                                                                No compatible inventory rows are available for the current source option.
                                                            </div>
                                                        ) : null}
                                                    </div>
                                                </div>
                                            </CardContent>
                                        </Card>

                                        <Card className="border-slate-200 bg-white">
                                            <CardHeader className="pb-3">
                                                <CardTitle className="text-base font-black text-slate-900">Material policy handoff</CardTitle>
                                                <CardDescription>
                                                    Planner checks the material plan here. Only the Work Center Manager can change current-step issue rules.
                                                </CardDescription>
                                            </CardHeader>
                                            <CardContent>
                                                {(selectedPlanningRow.workspace?.material_plan_lines || selectedPlanningRow.material_plan_lines || []).length === 0 ? (
                                                    <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                                                        No material lines were published for this order yet.
                                                    </div>
                                                ) : (
                                                    <div className="space-y-3 max-h-[480px] overflow-auto pr-1">
                                                        {(selectedPlanningRow.workspace?.material_plan_lines || selectedPlanningRow.material_plan_lines || []).map((line) => {
                                                            return (
                                                                <div key={line.policy_key} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 space-y-3">
                                                                    <div className="flex items-start justify-between gap-3">
                                                                        <div>
                                                                            <div className="text-sm font-black text-slate-900">{line.material_name}</div>
                                                                            <div className="text-[11px] text-slate-500">
                                                                                {line.category_code} · Theory {Number(line.theoretical_qty || 0).toFixed(3)} {line.uom}
                                                                            </div>
                                                                            <div className="text-[10px] text-slate-400">
                                                                                Basis {String(line.consumption_basis || "FIXED_KG").replaceAll("_", " ")} · Capture {String(line.capture_mode || "AUTO_FROM_OUTPUT").replaceAll("_", " ")}
                                                                            </div>
                                                                        </div>
                                                                        <Badge variant="outline" className="text-[10px] bg-white">
                                                                            {line.policy_source}
                                                                        </Badge>
                                                                    </div>
                                                                    <div className="grid gap-2 md:grid-cols-4">
                                                                        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px]">
                                                                            <div className="text-slate-500">Template</div>
                                                                            <div className="font-semibold text-slate-900">{policyLabel(line.template_issue_policy_mode, line.template_issue_policy_value)}</div>
                                                                        </div>
                                                                        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px]">
                                                                            <div className="text-slate-500">Current effective</div>
                                                                            <div className="font-semibold text-slate-900">
                                                                                {policyLabel(line.effective_issue_policy_mode, line.effective_issue_policy_value)}
                                                                            </div>
                                                                        </div>
                                                                        <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px]">
                                                                            <div className="text-slate-500">Policy owner</div>
                                                                            <div className="font-semibold text-slate-900">
                                                                                {String(line.policy_source || "TEMPLATE_DEFAULT").replaceAll("_", " ")}
                                                                            </div>
                                                                        </div>
                                                                        <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-[11px]">
                                                                            <div className="text-indigo-600">WCM next step</div>
                                                                            <div className="font-semibold text-indigo-700">Change only if the running step needs a real execution exception</div>
                                                                        </div>
                                                                    </div>
                                                                    <div className="flex items-center justify-between text-[11px] text-slate-600">
                                                                        <div>Planned issue {Number(line.planned_issue_qty || 0).toFixed(3)} {line.uom}</div>
                                                                        <div className="font-medium text-slate-500">Planner reviews only · WCM edits only</div>
                                                                    </div>
                                                                </div>
                                                            )
                                                        })}
                                                    </div>
                                                )}
                                            </CardContent>
                                        </Card>
                                    </>
                                ) : null}
                            </div>

                            <div className="space-y-4 xl:sticky xl:top-24 xl:self-start" data-testid="planner-release-rail">
                                {!selectedPlanningRow ? (
                                    <Card className="border-slate-200 bg-white">
                                        <CardContent className="py-12 text-center text-sm text-slate-500">
                                            Select a row to open the release workspace.
                                        </CardContent>
                                    </Card>
                                ) : (
                                    <>
                                        <Card className={cn("border", recommendationTone(selectedRecommendation?.tone))}>
                                            <CardHeader className="pb-3">
                                                <CardTitle className="text-sm font-black flex items-center gap-2">
                                                    <Sparkles className="h-4 w-4" />
                                                    Recommended next move
                                                </CardTitle>
                                                <CardDescription className="text-current/80">
                                                    {selectedRecommendation?.description || "Review the order, then release once the checklist is green."}
                                                </CardDescription>
                                            </CardHeader>
                                            <CardContent className="text-sm font-semibold">
                                                {selectedRecommendation?.label || "Review planner workspace"}
                                            </CardContent>
                                        </Card>

                                        <Card className="border-slate-200 bg-white">
                                            <CardHeader className="pb-2">
                                                <CardTitle className="text-sm font-black text-slate-900">Release preflight</CardTitle>
                                                <CardDescription>
                                                    {releaseChecklistReadyCount} of {selectedChecklist.length || 0} checks are currently green.
                                                </CardDescription>
                                            </CardHeader>
                                            <CardContent className="space-y-2 text-sm">
                                                <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
                                                    <div className="flex items-center justify-between gap-3">
                                                        <span className="font-semibold text-slate-700">Current source decision</span>
                                                        <span className="text-right font-black text-slate-900">{selectedSourceSummary?.recommended_label || "Review source path"}</span>
                                                    </div>
                                                </div>
                                                <div className={cn(
                                                    "rounded-2xl border px-3 py-3",
                                                    releaseReady
                                                        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                                                        : "border-amber-200 bg-amber-50 text-amber-800"
                                                )}>
                                                    <div className="text-[10px] font-black uppercase tracking-[0.18em]">
                                                        {releaseReady ? "Ready to release" : "Release still blocked"}
                                                    </div>
                                                    <div className="mt-1 text-xs font-semibold">
                                                        {releaseReady
                                                            ? "All required release checks are green. Save or release from the actions section below."
                                                            : "Finish the highlighted checklist and artwork/source decisions before pushing this job into execution."}
                                                    </div>
                                                </div>
                                            </CardContent>
                                        </Card>

                                        {artworkGateActive ? (
                                            <Card className="border-indigo-200 bg-indigo-50/70" data-testid="planner-artwork-gate">
                                                <CardHeader className="pb-3">
                                                    <CardTitle className="text-sm font-black text-indigo-900">Artwork gate</CardTitle>
                                                    <CardDescription className="text-indigo-800">
                                                        {selectedPlanningRow.artwork_gate?.message || "Planner must assign approved artwork before release."}
                                                    </CardDescription>
                                                </CardHeader>
                                                <CardContent className="space-y-3">
                                                    {selectedArtworkGateItems.length > 1 ? (
                                                        <div className="space-y-1.5">
                                                            <Label className="text-[10px] font-bold uppercase text-indigo-700">Pending order line</Label>
                                                            <Select
                                                                value={selectedArtworkGateItemId}
                                                                onValueChange={(value) =>
                                                                    setArtworkItemSelection((prev) => ({
                                                                        ...prev,
                                                                        [rowKey(selectedPlanningRow)]: value,
                                                                    }))
                                                                }
                                                            >
                                                                <SelectTrigger className="h-9 bg-white text-xs" data-testid="planner-artwork-order-line">
                                                                    <SelectValue placeholder="Select pending line" />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    {selectedArtworkGateItems.map((line) => (
                                                                        <SelectItem key={line.id} value={line.id}>
                                                                            {line.label} · {line.print_type} · F{Number(line.front_colors_count || 0)} / B{Number(line.back_colors_count || 0)}
                                                                        </SelectItem>
                                                                    ))}
                                                                </SelectContent>
                                                            </Select>
                                                        </div>
                                                    ) : null}
                                                    <div className="space-y-1.5">
                                                        <Label className="text-[10px] font-bold uppercase text-indigo-700">Approved artwork</Label>
                                                        <Select
                                                            value={selectedArtworkId}
                                                            onValueChange={(value) =>
                                                                setArtworkSelection((prev) => ({
                                                                    ...prev,
                                                                    [rowKey(selectedPlanningRow)]: value,
                                                                }))
                                                            }
                                                        >
                                                            <SelectTrigger className="h-9 bg-white text-xs" data-testid="planner-approved-artwork-select">
                                                                <SelectValue
                                                                    placeholder={
                                                                        artworkOptionsLoading
                                                                            ? "Loading compatible artworks..."
                                                                            : "Select compatible approved artwork"
                                                                    }
                                                                />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                {(artworkOptions || []).map((option: any) => (
                                                                    <SelectItem key={option.id} value={option.id}>
                                                                        {option.design_code} · {option.name}
                                                                    </SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                        {artworkOptionsLoading ? (
                                                            <p className="text-[11px] text-indigo-700">Checking approved artwork compatibility…</p>
                                                        ) : null}
                                                        {!artworkOptionsLoading && (artworkOptions || []).length === 0 ? (
                                                            <p className="text-[11px] text-amber-700">No compatible approved artwork is available for this print profile.</p>
                                                        ) : null}
                                                    </div>
                                                    <Button
                                                        className="w-full border-indigo-300 bg-white text-indigo-700 hover:bg-indigo-100"
                                                        variant="outline"
                                                        onClick={() => assignArtworkMutation.mutate(selectedPlanningRow)}
                                                        data-testid="planner-assign-artwork"
                                                        disabled={
                                                            assignArtworkMutation.isPending ||
                                                            artworkOptionsLoading ||
                                                            !selectedArtworkId ||
                                                            !(artworkOptions || []).some((option: any) => option.id === selectedArtworkId)
                                                        }
                                                    >
                                                        {assignArtworkMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                                        Assign artwork and clear gate
                                                    </Button>
                                                </CardContent>
                                            </Card>
                                        ) : null}

                                        <Card className="border-slate-200 bg-white">
                                            <CardHeader className="pb-3">
                                                <CardTitle className="text-sm font-black flex items-center gap-2 text-slate-900">
                                                    <ClipboardList className="h-4 w-4 text-indigo-600" />
                                                    Release checklist
                                                </CardTitle>
                                                <CardDescription>
                                                    Release stays disabled until every blocking item is resolved.
                                                </CardDescription>
                                            </CardHeader>
                                            <CardContent className="space-y-2">
                                                {selectedChecklist.map((item) => (
                                                    <div key={item.code} className={cn("rounded-2xl border px-3 py-3", checklistTone(item.status))}>
                                                        <div className="flex items-start justify-between gap-3">
                                                            <div>
                                                                <div className="text-xs font-black uppercase tracking-wide">{item.label}</div>
                                                                <div className="mt-1 text-xs leading-5">{item.message}</div>
                                                            </div>
                                                            {String(item.status).toUpperCase() === "READY" ? (
                                                                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                                                            ) : (
                                                                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                                                            )}
                                                        </div>
                                                    </div>
                                                ))}
                                            </CardContent>
                                        </Card>

                                        {(selectedPlanningRow.blockers || []).length > 0 ? (
                                            <Card className="border-amber-200 bg-amber-50">
                                                <CardHeader className="pb-2">
                                                    <CardTitle className="text-sm font-black text-amber-900">Operational blockers</CardTitle>
                                                </CardHeader>
                                                <CardContent className="space-y-2 text-xs text-amber-900">
                                                    {(selectedPlanningRow.blockers || []).map((b) => (
                                                        <div key={b.code} className="rounded-xl border border-amber-200 bg-white/60 px-3 py-2">
                                                            <div className="font-black">{b.code.replaceAll("_", " ")}</div>
                                                            <div className="mt-1">{b.message}</div>
                                                        </div>
                                                    ))}
                                                </CardContent>
                                            </Card>
                                        ) : null}

                                        <Card className="border-slate-200 bg-white">
                                            <CardHeader className="pb-3">
                                                <CardTitle className="text-sm font-black flex items-center gap-2 text-slate-900">
                                                    <Rocket className="h-4 w-4 text-indigo-600" />
                                                    Release actions
                                                </CardTitle>
                                            </CardHeader>
                                            <CardContent className="space-y-3">
                                                <Button
                                                    className="w-full"
                                                    onClick={() => planMutation.mutate({ row: selectedPlanningRow, release: false })}
                                                    disabled={planMutation.isPending}
                                                >
                                                    {planMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                                    Save plan
                                                </Button>
                                                <Button
                                                    variant="default"
                                                    className="w-full bg-emerald-600 hover:bg-emerald-700"
                                                    onClick={() => planMutation.mutate({ row: selectedPlanningRow, release: true })}
                                                    disabled={planMutation.isPending || !releaseReady}
                                                >
                                                    Release to production
                                                </Button>
                                                <div className="grid gap-2">
                                                    <Input
                                                        value={shortCloseReasons[rowKey(selectedPlanningRow)] || ""}
                                                        onChange={(e) =>
                                                            setShortCloseReasons((prev) => ({
                                                                ...prev,
                                                                [rowKey(selectedPlanningRow)]: e.target.value,
                                                            }))
                                                        }
                                                        placeholder="Short-close reason"
                                                    />
                                                    <Button
                                                        variant="outline"
                                                        onClick={() => shortCloseMutation.mutate(selectedPlanningRow)}
                                                        disabled={shortCloseMutation.isPending}
                                                    >
                                                        Short close row
                                                    </Button>
                                                </div>
                                            </CardContent>
                                        </Card>
                                    </>
                                )}
                            </div>
                        </div>
                    )}
                </TabsContent>

                <TabsContent value="active">
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {activeRows.map((row) => (
                            <Card key={rowKey(row)} className="border-slate-200">
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-base font-black">{row.order_number}</CardTitle>
                                    <CardDescription>{row.template_name}</CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-2 text-sm">
                                    <div className="flex items-center justify-between">
                                        <span className="text-slate-500">Status</span>
                                        <Badge>{row.status}</Badge>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-slate-500">Required</span>
                                        <span className="font-semibold">{Number(row.required_qty_kg || 0).toFixed(3)} KG</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-slate-500">Jobs</span>
                                        <span className="font-semibold">
                                            {Number(row.jobs_completed || 0)} / {Number(row.job_count || 0)} completed
                                        </span>
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                        {!activeRows.length ? (
                            <Card className="border-dashed border-slate-300 md:col-span-2 xl:col-span-3">
                                <CardContent className="py-14 text-center text-sm text-slate-500">No ready/released rows.</CardContent>
                            </Card>
                        ) : null}
                    </div>
                </TabsContent>

                <TabsContent value="jobs">
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                        {(["RELEASED", "EXECUTING", "PAUSED", "COMPLETED"] as const).map((state) => {
                            const rows = jobs.filter((job: any) => String(job.job_state || "").toUpperCase() === state)
                            return (
                                <Card key={state} className="border-slate-200">
                                    <CardHeader className="pb-2">
                                        <CardTitle className="text-sm font-black">{state}</CardTitle>
                                    </CardHeader>
                                    <CardContent className="space-y-2">
                                        {rows.length === 0 ? (
                                            <div className="rounded-lg border border-dashed border-slate-300 px-3 py-5 text-center text-xs text-slate-500">
                                                No jobs
                                            </div>
                                        ) : (
                                            rows.map((job: any) => (
                                                <div key={job.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs">
                                                    <div className="font-bold text-slate-800">{job.job_number || job.id}</div>
                                                    <div className="text-slate-600">{job.template_name || "Template"}</div>
                                                    <div className="text-slate-500">{Number(job.quantity || 0).toFixed(3)} {job.uom || "KG"}</div>
                                                </div>
                                            ))
                                        )}
                                    </CardContent>
                                </Card>
                            )
                        })}
                    </div>
                </TabsContent>

                <TabsContent value="history">
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {historyRows.map((row) => (
                            <Card key={rowKey(row)} className="border-slate-200">
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-base font-black">{row.order_number}</CardTitle>
                                    <CardDescription>{row.customer_name || row.template_name}</CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-2 text-sm">
                                    <div className="flex items-center justify-between">
                                        <span className="text-slate-500">Completion</span>
                                        <Badge variant="outline">{completedOrdersStateLabel(row)}</Badge>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-slate-500">Required</span>
                                        <span className="font-semibold">{Number(row.required_qty_kg || 0).toFixed(3)} KG</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-slate-500">Source used</span>
                                        <span className="font-semibold text-slate-700">{completedOrdersSourceLabel(row)}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-slate-500">Jobs closed</span>
                                        <span className="font-semibold">
                                            {Number(row.jobs_completed || 0)} / {Number(row.job_count || 0)}
                                        </span>
                                    </div>
                                    <div className="text-[11px] text-slate-500">
                                        {row.created_at ? `Created ${new Date(row.created_at).toLocaleString()}` : "Created date not available"}
                                    </div>
                                </CardContent>
                            </Card>
                        ))}
                        {!historyRows.length ? (
                            <Card className="border-dashed border-slate-300 md:col-span-2 xl:col-span-3">
                                <CardContent className="py-14 text-center text-sm text-slate-500">No completed orders yet.</CardContent>
                            </Card>
                        ) : null}
                    </div>
                </TabsContent>
            </Tabs>

            <Dialog
                open={claimDialogOpen}
                onOpenChange={(open) => {
                    setClaimDialogOpen(open)
                    if (!open) {
                        setClaimOrder(null)
                        setClaimCandidates([])
                        setSelectedClaimKey("")
                    }
                }}
            >
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Resolve Source: Claim Stock</DialogTitle>
                        <DialogDescription>
                            Select an invariant-compatible inventory candidate for {claimOrder?.order_number || "this row"}.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                        <Label className="text-xs font-semibold text-slate-600">Eligible Candidate</Label>
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
                            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs space-y-1">
                                <div><span className="font-semibold">Source Stock Order:</span> {selectedClaimCandidate.source_stock_order_no || "N/A"}</div>
                                <div><span className="font-semibold">Claimable:</span> {Number(selectedClaimCandidate.claimable_qty_kg || 0).toFixed(3)} KG</div>
                                <div><span className="font-semibold">Current:</span> {Number(selectedClaimCandidate.current_qty_kg || 0).toFixed(3)} KG</div>
                            </div>
                        ) : null}

                        {selectedClaimCandidate?.requires_split_for_partial ? (
                            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 flex items-center gap-2">
                                <AlertTriangle className="h-4 w-4" />
                                Split required before partial claim.
                            </div>
                        ) : null}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setClaimDialogOpen(false)}>
                            Cancel
                        </Button>
                        <Button
                            onClick={() => claimMutation.mutate()}
                            disabled={claimMutation.isPending || !selectedClaimCandidate || Boolean(selectedClaimCandidate?.requires_split_for_partial)}
                        >
                            {claimMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                            Claim Selected
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}

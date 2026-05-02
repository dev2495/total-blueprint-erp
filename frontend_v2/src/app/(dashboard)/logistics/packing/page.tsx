"use client"

import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowRight, Check, ClipboardList, HelpCircle, History, Layers, PackageCheck, PackageOpen, Scale, Search } from "lucide-react"
import type { ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { logisticsService, type Gonny, type SOPackingSummary } from "@/services/logistics"
import { masterDataService, type PackagingMaterial } from "@/services/master-data"

const n = (value: unknown, digits = 1) => Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: digits })
const kg = (value: unknown) => `${Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg`
const err = (error: any) => error?.response?.data?.error || error?.response?.data?.detail || error?.message || "Request failed."
const QUEUE_PAGE_SIZE = 8

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
    return (
        <div className="rounded-[14px] border border-white/20 bg-white/10 p-3 text-white shadow-sm backdrop-blur">
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-white/65">{label}</div>
            <div className="mt-1 text-2xl font-black tracking-tight">{value}</div>
            <div className="mt-1 text-xs font-semibold text-white/70">{hint}</div>
        </div>
    )
}

function Chip({ children, tone = "slate" }: { children: ReactNode; tone?: "pouch" | "roll" | "release" | "blue" | "green" | "amber" | "violet" | "slate" | "red" }) {
    const tones = {
        pouch: "border-amber-200 bg-amber-50 text-amber-700",
        roll: "border-rose-200 bg-rose-50 text-rose-700",
        release: "border-indigo-200 bg-indigo-50 text-indigo-700",
        blue: "border-blue-200 bg-blue-50 text-blue-700",
        green: "border-emerald-200 bg-emerald-50 text-emerald-700",
        amber: "border-amber-200 bg-amber-50 text-amber-700",
        violet: "border-violet-200 bg-violet-50 text-violet-700",
        red: "border-red-200 bg-red-50 text-red-700",
        slate: "border-slate-200 bg-white text-slate-600",
    }
    return <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-black uppercase tracking-[0.04em] ${tones[tone]}`}>{children}</span>
}

function MiniMetric({ label, value, hint, alert = false }: { label: string; value: string; hint?: string; alert?: boolean }) {
    return (
        <div className={`rounded-[10px] border p-3 ${alert ? "border-red-200 bg-red-50" : "border-slate-200 bg-white"}`}>
            <div className={`text-[10px] font-black uppercase tracking-[0.22em] ${alert ? "text-red-600" : "text-slate-400"}`}>{label}</div>
            <div className={`mt-1 text-xl font-black tracking-tight ${alert ? "text-red-700" : "text-slate-950"}`}>{value}</div>
            {hint && <div className="mt-0.5 text-[11px] font-semibold text-slate-500">{hint}</div>}
        </div>
    )
}

function Pager({ page, pageCount, onPageChange, testId }: { page: number; pageCount: number; onPageChange: (page: number) => void; testId: string }) {
    if (pageCount <= 1) return null
    return (
        <div className="flex flex-wrap items-center gap-1">
            <Button type="button" variant="outline" size="sm" data-testid={`${testId}-prev`} disabled={page <= 1} onClick={() => onPageChange(Math.max(1, page - 1))}>Prev</Button>
            {Array.from({ length: pageCount }, (_, index) => index + 1).map((item) => (
                <button
                    key={item}
                    type="button"
                    data-testid={`${testId}-${item}`}
                    onClick={() => onPageChange(item)}
                    className={`h-8 min-w-8 rounded-lg border px-2 text-xs font-black ${item === page ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-white text-slate-600 hover:border-indigo-200"}`}
                >
                    {item}
                </button>
            ))}
            <Button type="button" variant="outline" size="sm" data-testid={`${testId}-next`} disabled={page >= pageCount} onClick={() => onPageChange(Math.min(pageCount, page + 1))}>Next</Button>
        </div>
    )
}

function getGonnyExpected(gonny: Gonny) {
    return Number(gonny.expected_gross_weight_kg ?? gonny.tare_breakdown_json?.expected_gross_weight_kg ?? gonny.tare_breakdown_json?.gross_weight_kg ?? 0)
}

type RouteKind = "POUCH_PACK" | "ROLL_PACK" | "RELEASE_UNPACKED"
type RollPackLineDraft = { material_id: string; qty: string; uom?: string; basis?: string }
type PackingRouteFilter = "ALL" | "POUCH" | "ROLL" | "RELEASE"
type QueueStatusFilter = "ALL" | "READY" | "WAITING" | "IN_PROGRESS"
type PackingSortMode = "URGENCY" | "READY_DESC" | "SO_ASC" | "CUSTOMER_ASC"

export default function PackingYardPage() {
    const { toast } = useToast()
    const queryClient = useQueryClient()
    const [search, setSearch] = useState("")
    const [routeFilter, setRouteFilter] = useState<PackingRouteFilter>("ALL")
    const [statusFilter, setStatusFilter] = useState<QueueStatusFilter>("ALL")
    const [customerFilter, setCustomerFilter] = useState("ALL")
    const [variantFilter, setVariantFilter] = useState<PackingRouteFilter>("ALL")
    const [sortMode, setSortMode] = useState<PackingSortMode>("URGENCY")
    const [selectedOrderId, setSelectedOrderId] = useState<string>("")
    const [routeChoice, setRouteChoice] = useState<RouteKind | "">("")
    const [createBatchId, setCreateBatchId] = useState("")
    const [createQty, setCreateQty] = useState("")
    const [contentMode, setContentMode] = useState<"LOOSE_POUCHES" | "PRIMARY_PACKS">("LOOSE_POUCHES")
    const [primaryPackCount, setPrimaryPackCount] = useState("")
    const [gonnyMaterialId, setGonnyMaterialId] = useState("")
    const [createDialogOpen, setCreateDialogOpen] = useState(false)
    const [sealGonny, setSealGonny] = useState<Gonny | null>(null)
    const [actualGross, setActualGross] = useState("")
    const [varianceReason, setVarianceReason] = useState("")
    const [releaseRolls, setReleaseRolls] = useState<any[]>([])
    const [selectedRollIds, setSelectedRollIds] = useState<string[]>([])
    const [releaseMode, setReleaseMode] = useState<"PACKED" | "UNPACKED">("PACKED")
    const [rollPackLines, setRollPackLines] = useState<RollPackLineDraft[]>([{ material_id: "", qty: "", uom: "PCS", basis: "PER_ROLL" }])
    const [queuePage, setQueuePage] = useState(1)

    const board = useQuery({ queryKey: ["packing-board"], queryFn: logisticsService.getPackingBoard, refetchInterval: 30000 })
    const summary = useQuery({
        queryKey: ["packing-summary", selectedOrderId],
        queryFn: () => logisticsService.getSOPackingSummary(selectedOrderId),
        enabled: Boolean(selectedOrderId),
    })
    const packaging = useQuery({ queryKey: ["packaging-materials"], queryFn: masterDataService.getPackaging })
    const gonnies = useMemo(() => (packaging.data || []).filter((p) => p.packaging_kind === "GONNY"), [packaging.data])
    const rollPackagingMaterials = useMemo(
        () => (packaging.data || []).filter((p) => ["SHEET", "TAPE", "BOX", "LABEL", "TAG", "OTHER", "INNER_POUCH"].includes(String(p.packaging_kind || "").toUpperCase())),
        [packaging.data],
    )
    const firstRollPackMaterialId = rollPackagingMaterials[0]?.id || ""

    const invalidate = () => {
        queryClient.invalidateQueries({ queryKey: ["packing-board"] })
        queryClient.invalidateQueries({ queryKey: ["packing-summary", selectedOrderId] })
    }

    const createMutation = useMutation({
        mutationFn: () => logisticsService.createGonny({
            fgBatchId: createBatchId,
            qtyPcs: Number(createQty),
            gonnyMaterialId,
            contentMode,
            primaryPackCount: primaryPackCount ? Number(primaryPackCount) : undefined,
        }),
        onSuccess: (data) => {
            toast({ title: "Gonny created", description: data.message })
            setCreateDialogOpen(false)
            setCreateBatchId("")
            setCreateQty("")
            setPrimaryPackCount("")
            invalidate()
        },
        onError: (error) => toast({ title: "Create failed", description: err(error), variant: "destructive" }),
    })

    const sealMutation = useMutation({
        mutationFn: () => logisticsService.sealGonny(sealGonny!.id, Number(actualGross), [], varianceReason),
        onSuccess: (data) => {
            toast({ title: "Gonny sealed", description: data.message })
            setSealGonny(null)
            setActualGross("")
            setVarianceReason("")
            invalidate()
        },
        onError: (error) => toast({ title: "Seal failed", description: err(error), variant: "destructive" }),
    })

    const releaseGonnyMutation = useMutation({
        mutationFn: (gonnyId: string) => logisticsService.releaseGonny(gonnyId),
        onSuccess: (data) => {
            toast({ title: "Released to dispatch", description: data.message })
            invalidate()
        },
        onError: (error) => toast({ title: "Release failed", description: err(error), variant: "destructive" }),
    })

    const releaseRollMutation = useMutation<any, any, { rollIds: string[]; mode: "PACKED" | "UNPACKED"; lines: RollPackLineDraft[] }>({
        mutationFn: ({ rollIds, mode, lines }: { rollIds: string[]; mode: "PACKED" | "UNPACKED"; lines: RollPackLineDraft[] }) => {
            const payloadLines = lines
                .filter((line) => line.material_id.trim() && Number(line.qty || 0) > 0)
                .map((line) => ({ material_id: line.material_id.trim(), qty: Number(line.qty), uom: line.uom || "PCS", basis: line.basis || "TOTAL_ROLLS" }))
            return rollIds.length > 1
                ? logisticsService.releaseRolls(rollIds, mode, payloadLines)
                : logisticsService.releaseRoll(rollIds[0], mode, payloadLines)
        },
        onSuccess: (data) => {
            toast({ title: "Roll released", description: data.message })
            setReleaseRolls([])
            setSelectedRollIds([])
            invalidate()
        },
        onError: (error) => toast({ title: "Roll release failed", description: err(error), variant: "destructive" }),
    })

    const getQueueRoute = (row: any): Exclude<PackingRouteFilter, "ALL"> => {
        const pendingBatches = Number(row.pending?.batches_count || 0)
        const pendingGonnies = Number(row.pending?.open_gonnies_count || 0) + Number(row.pending?.sealed_gonnies_count || 0)
        const readyGonnies = Number(row.ready_for_dispatch?.gonnies_count || 0)
        const pendingRolls = Number(row.pending?.rolls_count || 0)
        const readyRolls = Number(row.ready_for_dispatch?.rolls_count || 0)
        if (pendingBatches || pendingGonnies || readyGonnies) return "POUCH"
        if (pendingRolls || readyRolls) return "ROLL"
        return "RELEASE"
    }

    const getQueueStatus = (row: any): Exclude<QueueStatusFilter, "ALL"> => {
        const pendingUnits = Number(row.pending?.batches_count || 0) + Number(row.pending?.open_gonnies_count || 0) + Number(row.pending?.sealed_gonnies_count || 0) + Number(row.pending?.rolls_count || 0)
        const readyUnits = Number(row.ready_for_dispatch?.gonnies_count || 0) + Number(row.ready_for_dispatch?.rolls_count || 0)
        if (pendingUnits && readyUnits) return "IN_PROGRESS"
        if (readyUnits) return "READY"
        return "WAITING"
    }

    const customerOptions = useMemo(() => Array.from(new Set((board.data?.orders || []).map((row) => row.sales_order.customer_name).filter(Boolean))).sort(), [board.data?.orders])

    const cards = (board.data?.orders || []).filter((row) => {
        const term = search.trim().toLowerCase()
        const haystack = `${row.sales_order.order_number} ${row.sales_order.customer_name}`.toLowerCase()
        const route = getQueueRoute(row)
        const status = getQueueStatus(row)
        if (term && !haystack.includes(term)) return false
        if (routeFilter !== "ALL" && route !== routeFilter) return false
        if (variantFilter !== "ALL" && route !== variantFilter) return false
        if (statusFilter !== "ALL" && status !== statusFilter) return false
        if (customerFilter !== "ALL" && row.sales_order.customer_name !== customerFilter) return false
        return true
    }).sort((a, b) => {
        const pendingA = Number(a.pending?.batches_count || 0) + Number(a.pending?.open_gonnies_count || 0) + Number(a.pending?.sealed_gonnies_count || 0) + Number(a.pending?.rolls_count || 0)
        const pendingB = Number(b.pending?.batches_count || 0) + Number(b.pending?.open_gonnies_count || 0) + Number(b.pending?.sealed_gonnies_count || 0) + Number(b.pending?.rolls_count || 0)
        const readyA = Number(a.ready_for_dispatch?.gonnies_count || 0) + Number(a.ready_for_dispatch?.rolls_count || 0)
        const readyB = Number(b.ready_for_dispatch?.gonnies_count || 0) + Number(b.ready_for_dispatch?.rolls_count || 0)
        if (sortMode === "READY_DESC") return readyB - readyA
        if (sortMode === "SO_ASC") return a.sales_order.order_number.localeCompare(b.sales_order.order_number)
        if (sortMode === "CUSTOMER_ASC") return a.sales_order.customer_name.localeCompare(b.sales_order.customer_name)
        return (pendingB + readyB * 2) - (pendingA + readyA * 2)
    })
    const queuePageCount = Math.max(1, Math.ceil(cards.length / QUEUE_PAGE_SIZE))
    const safeQueuePage = Math.min(queuePage, queuePageCount)
    const queueStartIndex = (safeQueuePage - 1) * QUEUE_PAGE_SIZE
    const pagedCards = cards.slice(queueStartIndex, queueStartIndex + QUEUE_PAGE_SIZE)
    const shownStart = cards.length ? queueStartIndex + 1 : 0
    const shownEnd = Math.min(cards.length, queueStartIndex + pagedCards.length)

    useEffect(() => {
        if ((!selectedOrderId || !cards.some((row) => row.sales_order.id === selectedOrderId)) && cards[0]?.sales_order?.id) setSelectedOrderId(cards[0].sales_order.id)
        if (selectedOrderId && !cards.length) setSelectedOrderId("")
    }, [cards, selectedOrderId])

    useEffect(() => {
        setQueuePage(1)
    }, [search, routeFilter, statusFilter, customerFilter, variantFilter, sortMode])

    useEffect(() => {
        setQueuePage((current) => Math.min(current, queuePageCount))
    }, [queuePageCount])

    const selected = summary.data as SOPackingSummary | undefined
    const selectedBatch = selected?.batches.find((batch) => batch.id === createBatchId)
    const expected = sealGonny ? getGonnyExpected(sealGonny) : 0
    const variance = actualGross ? Number(actualGross) - expected : 0
    const variancePct = expected > 0 ? (variance / expected) * 100 : 0
    const readyGross = Number(board.data?.totals.ready_gonnies_gross_kg || 0) + Number(board.data?.totals.ready_rolls_gross_kg || board.data?.totals.ready_rolls_kg || 0)
    const readyNet = Number(board.data?.totals.ready_gonnies_net_kg || 0) + Number(board.data?.totals.ready_rolls_kg || 0)
    const hasRollWork = Boolean(selected && (selected.rolls.length || selected.packing_pending.rolls_count || selected.ready_for_dispatch.rolls_count))
    const hasPouchWork = Boolean(selected && (selected.batches.length || selected.gonnies.length || selected.packing_pending.batches_count || selected.packing_pending.open_gonnies_count || selected.ready_for_dispatch.gonnies_count))
    const recommendedRoute: RouteKind = hasRollWork && !hasPouchWork ? "ROLL_PACK" : hasPouchWork ? "POUCH_PACK" : "RELEASE_UNPACKED"
    const activeRoute = (routeChoice || recommendedRoute) as RouteKind
    const productName = selected?.batches[0]?.template_name || selected?.rolls[0]?.material__name || "Order product"
    const variantFamily = hasRollWork && !hasPouchWork ? "ROLL" : hasRollWork ? "ROLL + POUCH" : "POUCH"
    const productSize = selected?.rolls[0]?.width_mm ? `${selected.rolls[0].width_mm} mm` : selected?.batches[0]?.template_name ? "as SKU" : "order spec"
    const selectedGross = Number(selected?.ready_for_dispatch.gonnies_gross_kg || 0) + Number(selected?.ready_for_dispatch.rolls_gross_kg || selected?.ready_for_dispatch.rolls_kg || 0)
    const selectedNet = Number(selected?.ready_for_dispatch.gonnies_net_kg || 0) + Number(selected?.ready_for_dispatch.rolls_net_kg || selected?.ready_for_dispatch.rolls_kg || 0)
    const selectedPendingUnits = Number(selected?.packing_pending.batches_count || 0) + Number(selected?.packing_pending.rolls_count || 0) + Number(selected?.packing_pending.open_gonnies_count || 0)
    const selectedReadyUnits = Number(selected?.ready_for_dispatch.gonnies_count || 0) + Number(selected?.ready_for_dispatch.rolls_count || 0)
    const selectedProgress = selectedPendingUnits + selectedReadyUnits > 0 ? Math.round((selectedReadyUnits / (selectedPendingUnits + selectedReadyUnits)) * 100) : selectedReadyUnits ? 100 : 0
    const selectedRollsForBulk = (selected?.rolls || []).filter((roll: any) => selectedRollIds.includes(roll.id) && !roll.released_to_dispatch)
    const activeRollCount = releaseRolls.length
    const activeRollNet = releaseRolls.reduce((sum, roll) => sum + Number(roll.net_weight_kg || roll.weight_kg || 0), 0)
    const activeRollTare = releaseRolls.reduce((sum, roll) => sum + Number(roll.tare_weight_kg || 0), 0)
    const activeRollGross = releaseRolls.reduce((sum, roll) => sum + Number(roll.gross_weight_kg || roll.weight_kg || 0), 0)
    const routeCounts = (board.data?.orders || []).reduce((acc, row) => {
        const route = getQueueRoute(row)
        if (route === "POUCH") acc.pouch += 1
        else if (route === "ROLL") acc.roll += 1
        else acc.release += 1
        return acc
    }, { pouch: 0, roll: 0, release: 0 })
    const clearFilters = () => {
        setSearch("")
        setRouteFilter("ALL")
        setStatusFilter("ALL")
        setCustomerFilter("ALL")
        setVariantFilter("ALL")
        setSortMode("URGENCY")
        setQueuePage(1)
    }

    useEffect(() => {
        setRouteChoice("")
        setSelectedRollIds([])
    }, [selectedOrderId])

    const openCreateGonny = (batch: SOPackingSummary["batches"][number]) => {
        setCreateBatchId(batch.id)
        setCreateQty(String(batch.qty_pcs || ""))
        setContentMode((batch as any).default_content_mode === "PRIMARY_PACKS" ? "PRIMARY_PACKS" : "LOOSE_POUCHES")
        setPrimaryPackCount("")
        setCreateDialogOpen(true)
    }

    const openReleaseRolls = (rolls: any[]) => {
        const rollList = rolls.filter(Boolean)
        if (!rollList.length) return
        const defaultSource = rollList.find((roll) => Array.isArray(roll.default_pack_lines) && roll.default_pack_lines.length) || rollList[0]
        const defaults = Array.isArray(defaultSource.default_pack_lines) && defaultSource.default_pack_lines.length
            ? defaultSource.default_pack_lines.map((line: any) => ({
                material_id: String(line.material_id || ""),
                qty: String(Number(line.qty || 0) * rollList.length || ""),
                uom: String(line.uom || "PCS"),
                basis: "TOTAL_ROLLS",
            }))
            : [{ material_id: firstRollPackMaterialId, qty: String(rollList.length || 1), uom: "PCS", basis: "TOTAL_ROLLS" }]
        setReleaseRolls(rollList)
        setReleaseMode("PACKED")
        setRollPackLines(defaults)
    }

    const openReleaseRoll = (roll: any) => openReleaseRolls([roll])
    const toggleRollSelection = (rollId: string) => {
        setSelectedRollIds((ids) => ids.includes(rollId) ? ids.filter((id) => id !== rollId) : [...ids, rollId])
    }

    return (
        <div className="mx-auto max-w-[1600px] space-y-4 p-4 lg:p-6" data-testid="packing-page">
            <section className="overflow-hidden rounded-[22px] border border-indigo-300/40 bg-[radial-gradient(900px_420px_at_0%_0%,rgba(96,165,250,0.35),transparent_58%),linear-gradient(115deg,#1f3a8a_0%,#4338ca_48%,#6d28d9_100%)] p-5 text-white shadow-xl shadow-indigo-950/10">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                        <div className="text-[11px] font-black uppercase tracking-[0.24em] text-white/70">Operations · Packing Yard</div>
                        <h1 className="mt-1 text-2xl font-black tracking-tight">Pack, batch, label - order-aware.</h1>
                        <p className="mt-1 max-w-3xl text-sm font-semibold leading-6 text-white/78">Every job carries its SO, SKU, roll or pouch route, weight split, packing recipe, and handoff status. Work left queue to right rail without losing the order context.</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {[
                            { label: "All routes", value: "ALL" as const, count: board.data?.orders?.length || 0 },
                            { label: "Pouch", value: "POUCH" as const, count: routeCounts.pouch },
                            { label: "Roll", value: "ROLL" as const, count: routeCounts.roll },
                            { label: "Release", value: "RELEASE" as const, count: routeCounts.release },
                        ].map((item) => (
                            <button
                                key={item.value}
                                type="button"
                                data-testid={`packing-route-filter-${item.value.toLowerCase()}`}
                                onClick={() => setRouteFilter(item.value)}
                                className={`rounded-full border px-3 py-1.5 text-xs font-black shadow-sm backdrop-blur transition ${routeFilter === item.value ? "border-white bg-white text-blue-700" : "border-white/20 bg-white/10 text-white hover:bg-white/20"}`}
                            >
                                {item.label} · {n(item.count, 0)}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-8">
                    <Stat label="In-bound jobs" value={n(board.data?.totals.orders || cards.length || 0, 0)} hint={`${n(cards.length, 0)} shown now`} />
                    <Stat label="Awaiting decision" value={n(board.data?.totals.pending_batches || 0, 0)} hint={`${n(board.data?.totals.pending_pcs || 0, 0)} pcs pending`} />
                    <Stat label="Pouch in-progress" value={n(board.data?.totals.open_gonnies || 0, 0)} hint="open gonnies" />
                    <Stat label="Roll bundling" value={n(board.data?.totals.ready_rolls || 0, 0)} hint={`${n(board.data?.totals.ready_rolls_kg || 0)} kg net`} />
                    <Stat label="Released unpacked" value={n(board.data?.totals.ready_rolls || 0, 0)} hint="rolls direct" />
                    <Stat label="Net ready" value={`${n(readyNet)} kg`} hint="billable product" />
                    <Stat label="Gross ready" value={`${n(readyGross)} kg`} hint="with tare" />
                    <Stat label="Photos missing" value={n(board.data?.totals.photos_missing || 0, 0)} hint="photo / hold gaps" />
                </div>
            </section>

            <section className="sticky top-2 z-[1] rounded-[18px] border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Filters</span>
                        <select data-testid="packing-filter-route" value={routeFilter} onChange={(event) => setRouteFilter(event.target.value as PackingRouteFilter)} className="h-9 rounded-full border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 shadow-sm">
                            <option value="ALL">All routes</option>
                            <option value="POUCH">Pouch pack</option>
                            <option value="ROLL">Roll pack</option>
                            <option value="RELEASE">Release only</option>
                        </select>
                        <select data-testid="packing-filter-status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as QueueStatusFilter)} className="h-9 rounded-full border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 shadow-sm">
                            <option value="ALL">Status: any</option>
                            <option value="READY">Ready</option>
                            <option value="IN_PROGRESS">In progress</option>
                            <option value="WAITING">Waiting</option>
                        </select>
                        <select data-testid="packing-filter-customer" value={customerFilter} onChange={(event) => setCustomerFilter(event.target.value)} className="h-9 max-w-[220px] rounded-full border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 shadow-sm">
                            <option value="ALL">All customers</option>
                            {customerOptions.map((customer) => <option key={customer} value={customer}>{customer}</option>)}
                        </select>
                        <select data-testid="packing-filter-variant" value={variantFilter} onChange={(event) => setVariantFilter(event.target.value as PackingRouteFilter)} className="h-9 rounded-full border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 shadow-sm">
                            <option value="ALL">All unit types</option>
                            <option value="POUCH">Pouch/gonny</option>
                            <option value="ROLL">Rolls</option>
                        </select>
                        <select data-testid="packing-filter-sort" value={sortMode} onChange={(event) => setSortMode(event.target.value as PackingSortMode)} className="h-9 rounded-full border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 shadow-sm">
                            <option value="URGENCY">Sort: urgency</option>
                            <option value="READY_DESC">Ready units first</option>
                            <option value="SO_ASC">SO number</option>
                            <option value="CUSTOMER_ASC">Customer</option>
                        </select>
                        <Button type="button" variant="ghost" size="sm" data-testid="packing-filter-clear" onClick={clearFilters}>Clear</Button>
                    </div>
                    <div className="grid gap-2 xl:ml-auto xl:w-[620px] xl:grid-cols-[1fr_260px]">
                        <div className="relative">
                            <Search className="absolute left-4 top-3.5 h-4 w-4 text-slate-400" />
                            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search SO, customer, roll, batch..." className="h-12 rounded-2xl border-slate-200 bg-white pl-10 shadow-sm" />
                        </div>
                        <Select value={selectedOrderId} onValueChange={setSelectedOrderId}>
                            <SelectTrigger data-testid="packing-sales-order-select" className="h-12 rounded-2xl border-slate-200 bg-white shadow-sm">
                                <SelectValue placeholder="Select sales order" />
                            </SelectTrigger>
                            <SelectContent>
                                {cards.map((row) => <SelectItem key={row.sales_order.id} value={row.sales_order.id}>{row.sales_order.order_number} • {row.sales_order.customer_name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            </section>

            <section className="grid gap-4 xl:grid-cols-[minmax(300px,0.42fr)_minmax(0,0.58fr)] 2xl:grid-cols-[minmax(320px,4fr)_minmax(560px,5fr)_minmax(300px,3fr)]">
                <aside className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                        <span className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-sm font-black text-indigo-700">All {n(cards.length, 0)}</span>
                        <span className="rounded-full border border-amber-200 bg-white px-3 py-1.5 text-sm font-black text-slate-700">P {n(routeCounts.pouch, 0)}</span>
                        <span className="rounded-full border border-rose-200 bg-white px-3 py-1.5 text-sm font-black text-slate-700">R {n(routeCounts.roll, 0)}</span>
                        <span className="rounded-full border border-indigo-200 bg-white px-3 py-1.5 text-sm font-black text-slate-700">U {n(routeCounts.release, 0)}</span>
                    </div>
                    <div className="max-h-[calc(100dvh-330px)] space-y-2 overflow-y-auto overscroll-contain pr-1">
                        {pagedCards.map((row) => {
                            const readyUnits = Number(row.ready_for_dispatch.gonnies_count || 0) + Number(row.ready_for_dispatch.rolls_count || 0)
                            const pendingUnits = Number(row.pending.batches_count || 0) + Number(row.pending.rolls_count || 0) + Number(row.pending.open_gonnies_count || 0)
                            const totalUnits = Math.max(1, readyUnits + pendingUnits)
                            const readyPct = Math.min(100, Math.round((readyUnits / totalUnits) * 100))
                            const rowRoute: RouteKind = Number(row.pending.batches_count || 0) > 0 ? "POUCH_PACK" : Number(row.pending.rolls_count || 0) > 0 || Number(row.ready_for_dispatch.rolls_count || 0) > 0 ? "ROLL_PACK" : "RELEASE_UNPACKED"
                            return (
                                    <button
                                        key={row.sales_order.id}
                                        data-testid="packing-order-card"
                                        data-route={getQueueRoute(row)}
                                        data-status={getQueueStatus(row)}
                                        data-customer={row.sales_order.customer_name}
                                        onClick={() => setSelectedOrderId(row.sales_order.id)}
                                        className={`relative w-full overflow-hidden rounded-[14px] border p-4 text-left shadow-sm transition ${selectedOrderId === row.sales_order.id ? "border-violet-500 bg-gradient-to-b from-violet-50 to-white" : "border-slate-200 bg-white hover:-translate-y-0.5 hover:border-indigo-200"}`}
                                    >
                                    <span className={`absolute inset-y-0 left-0 w-1 ${rowRoute === "POUCH_PACK" ? "bg-amber-400" : rowRoute === "ROLL_PACK" ? "bg-rose-400" : "bg-indigo-400"}`} />
                                    <div className="pl-1">
                                        <div className="flex items-start justify-between gap-3">
                                            <div>
                                                <div className="font-mono text-sm font-black text-slate-950">{row.sales_order.order_number}</div>
                                                <div className="mt-0.5 line-clamp-1 text-sm font-black text-slate-900">{row.sales_order.customer_name}</div>
                                            </div>
                                            <Chip tone={rowRoute === "POUCH_PACK" ? "pouch" : rowRoute === "ROLL_PACK" ? "roll" : "release"}>{rowRoute}</Chip>
                                        </div>
                                        <div className="mt-2 text-[11px] font-semibold text-slate-500">Order-aware job · live packing queue</div>
                                        <div className="mt-3 flex flex-wrap gap-1.5">
                                            <Chip tone={rowRoute === "POUCH_PACK" ? "pouch" : "roll"}>{rowRoute === "POUCH_PACK" ? "POUCH" : "ROLL"}</Chip>
                                            <Chip tone="blue">{rowRoute === "POUCH_PACK" ? "sales SKU" : "roll width"}</Chip>
                                            <Chip tone="violet">recipe</Chip>
                                        </div>
                                        <div className="mt-3 grid grid-cols-4 gap-2 text-[11px]">
                                            <div><div className="font-bold text-slate-400">Batches</div><div className="font-black">{n(row.pending.batches_count || 0, 0)}</div></div>
                                            <div><div className="font-bold text-slate-400">Open</div><div className="font-black text-blue-700">{n(row.pending.open_gonnies_count || 0, 0)}</div></div>
                                            <div><div className="font-bold text-slate-400">Sealed</div><div className="font-black text-emerald-700">{n(row.pending.sealed_gonnies_count || row.ready_for_dispatch.gonnies_count || 0, 0)}</div></div>
                                            <div><div className="font-bold text-slate-400">Rolls</div><div className="font-black">{n(row.ready_for_dispatch.rolls_count || row.pending.rolls_count || 0, 0)}</div></div>
                                        </div>
                                        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-blue-500" style={{ width: `${readyPct}%` }} /></div>
                                        <div className="mt-1 flex justify-between text-[11px] font-semibold text-slate-500"><span>{readyPct}% of yard units ready</span><span>{readyUnits} of {readyUnits + pendingUnits}</span></div>
                                    </div>
                                </button>
                            )
                        })}
                        {!cards.length && <div className="rounded-[18px] border border-dashed border-slate-200 bg-white p-8 text-center text-sm font-semibold text-slate-500">No jobs awaiting packing.</div>}
                    </div>
                    <div className="rounded-[14px] border border-slate-200 bg-white p-3 shadow-sm">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <div data-testid="packing-queue-total" className="text-xs font-bold text-slate-500">Showing {shownStart}-{shownEnd} of {cards.length} jobs</div>
                            <Pager page={safeQueuePage} pageCount={queuePageCount} onPageChange={setQueuePage} testId="packing-queue-page" />
                        </div>
                    </div>
                </aside>

                <main className="min-w-0 space-y-4">
                    {!selected ? (
                        <div className="rounded-[18px] border border-dashed border-slate-300 bg-white p-12 text-center">
                            <PackageOpen className="mx-auto h-10 w-10 text-slate-300" />
                            <h2 className="mt-3 text-xl font-black">Pick an SO from the queue.</h2>
                            <p className="mt-2 text-sm font-semibold text-slate-500">The center panel will show its specs, route, and packing work.</p>
                        </div>
                    ) : (
                        <>
                            <div className="rounded-[18px] border border-violet-200 bg-gradient-to-b from-violet-50 to-white p-5 shadow-sm">
                                <div className="text-[10px] font-black uppercase tracking-[0.28em] text-violet-700">Selected · order-aware specs</div>
                                <div className="mt-2 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                                    <div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="rounded-md bg-blue-100 px-2 py-1 font-mono text-sm font-black text-blue-700">{selected.sales_order.order_number}</span>
                                            <span className="text-sm font-black text-slate-950">{selected.sales_order.customer_name}</span>
                                            <Chip tone={selectedProgress >= 100 ? "green" : selectedProgress > 0 ? "blue" : "amber"}>{selectedProgress >= 100 ? "ready" : selectedProgress > 0 ? "in-progress" : "awaiting"}</Chip>
                                        </div>
                                        <div className="mt-1 text-xs font-semibold text-slate-500">Promised dispatch from SO · ready {selectedReadyUnits} unit{selectedReadyUnits === 1 ? "" : "s"} · pending {selectedPendingUnits}</div>
                                        <h2 className="mt-3 text-2xl font-black tracking-tight text-slate-950">{productName}</h2>
                                        <div className="mt-2 flex flex-wrap gap-2">
                                            <Chip tone="slate">Sales SKU · {productName.slice(0, 18) || "order"}</Chip>
                                            <Chip tone="violet">Planner variant · {variantFamily}</Chip>
                                        </div>
                                        <div className="mt-3 flex flex-wrap gap-1.5">
                                            <Chip tone={hasRollWork ? "roll" : "pouch"}>{variantFamily}</Chip>
                                            <Chip tone="blue">{productSize}</Chip>
                                            <Chip tone="violet">tare + gross tracked</Chip>
                                            <Chip tone="green">dispatch lineage</Chip>
                                            <Chip tone="amber">packing recipe</Chip>
                                        </div>
                                    </div>
                                    <div className="grid min-w-[240px] grid-cols-2 gap-2">
                                        <MiniMetric label="Net ready" value={`${n(selectedNet)} kg`} />
                                        <MiniMetric label="Gross ready" value={`${n(selectedGross)} kg`} />
                                    </div>
                                </div>
                                <div className="mt-4 grid gap-3 border-t border-violet-100 pt-4 text-xs sm:grid-cols-2">
                                    <div><span className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Layers</span><div className="mt-1 font-semibold text-slate-700">{hasRollWork ? "Roll output from machine terminal" : "Pouch batch output"} · net/tare/gross audit preserved</div></div>
                                    <div><span className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Packing recipe</span><div className="mt-1 font-semibold text-slate-700">{activeRoute === "POUCH_PACK" ? "Create gonny/carton from pouch batches, seal gross, release" : activeRoute === "ROLL_PACK" ? "Pack roll with sheet or wrap, consume material, release" : "Each roll becomes one direct dispatch unit"}</div></div>
                                </div>
                            </div>

                            <div className="rounded-[18px] border border-slate-200 bg-white p-5 shadow-sm">
                                <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                    <div>
                                        <h3 className="text-base font-black text-slate-950">Packing route</h3>
                                        <div className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">Recommended by planner · override is audited by action</div>
                                    </div>
                                    <span className="text-xs font-semibold text-slate-500">Order qty {n(selected.ordered_qty)} · {selected.sales_order.status}</span>
                                </div>
                                <div className="grid gap-3 md:grid-cols-3">
                                    {([
                                        ["POUCH_PACK", "Pouch or bag to gonny/carton", `${n(selected.packing_pending.batches_pcs || 0, 0)} pcs waiting`, !hasPouchWork],
                                        ["ROLL_PACK", "Packed roll with sheet or wrap", `${n(selected.rolls.length || selected.packing_pending.rolls_count || selected.ready_for_dispatch.rolls_count, 0)} rolls`, !hasRollWork],
                                        ["RELEASE_UNPACKED", "Direct roll dispatch unit", "skips wrap consumption", !hasRollWork],
                                    ] as Array<[RouteKind, string, string, boolean]>).map(([route, title, copy, disabled]) => (
                                        <button key={route} disabled={disabled} onClick={() => setRouteChoice(route)} className={`relative rounded-[14px] border p-4 text-left transition ${activeRoute === route ? "border-violet-500 bg-violet-50 shadow-sm" : "border-slate-200 bg-white"} ${disabled ? "cursor-not-allowed opacity-45" : "hover:-translate-y-0.5 hover:border-violet-300"}`}>
                                            {recommendedRoute === route && <span className="absolute -top-3 left-4 rounded-full bg-emerald-500 px-3 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-white">Recommended</span>}
                                            <div className="font-mono text-sm font-black text-violet-700">{route}</div>
                                            <div className="mt-2 text-sm font-black text-slate-900">{title}</div>
                                            <div className="mt-1 text-xs font-semibold text-slate-500">{copy}</div>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {hasPouchWork && activeRoute === "POUCH_PACK" && (
                                <>
                                    <div className="rounded-[18px] border border-slate-200 bg-white p-5 shadow-sm">
                                        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                            <div>
                                                <h3 className="text-base font-black text-slate-950">Pouch batches available · create packing unit</h3>
                                                <div className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">{n(selected.packing_pending.batches_pcs || 0, 0)} pouches waiting · {n(selected.ready_for_dispatch.gonnies_pcs || 0, 0)} pcs already released</div>
                                            </div>
                                            <Chip tone="blue">Form flow</Chip>
                                        </div>
                                        <div className="mt-4 flex min-h-[58px] items-center gap-3 rounded-[14px] border border-slate-200 bg-slate-50 px-4 text-slate-700">
                                            <PackageOpen className="h-4 w-4 text-slate-500" />
                                            <span className="flex-1 text-sm font-semibold">Choose a pouch batch below, create one gonny/carton, seal actual gross weight, then release that unit to Dispatch Bay.</span>
                                            <Chip tone="green">Batch first</Chip>
                                        </div>
                                        <div className="mt-4 grid gap-3 sm:grid-cols-4">
                                            <MiniMetric label="Produced" value={n(selected.ordered_qty, 0)} hint="order qty" />
                                            <MiniMetric label="Packed" value={n(selected.ready_for_dispatch.gonnies_pcs || 0, 0)} hint="released pcs" />
                                            <MiniMetric label="In-progress" value={n(selected.packing_pending.open_gonnies_count || 0, 0)} hint="open gonnies" />
                                            <MiniMetric label="QA holds" value="0" hint="no hold in yard" />
                                        </div>
                                    </div>

                                    <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_300px]">
                                        <div className="rounded-[18px] border border-slate-200 bg-white p-5 shadow-sm">
                                            <div className="mb-4 flex items-center justify-between gap-3">
                                                <div>
                                                    <h3 className="text-base font-black text-slate-950">Pouch batches waiting for gonnies</h3>
                                                    <div className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">Select a batch and create the physical packing unit</div>
                                                </div>
                                            </div>
                                            <div className="max-h-[380px] overflow-auto rounded-[14px] border border-slate-100">
                                                <table className="w-full min-w-[640px] text-sm">
                                                    <thead className="sticky top-0 bg-white text-[10px] uppercase tracking-[0.22em] text-slate-400">
                                                        <tr><th className="px-4 py-3 text-left">Batch</th><th className="text-left">Product</th><th className="text-right">Available</th><th className="px-4 text-right">Action</th></tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-slate-100">
                                                        {selected.batches.map((batch) => (
                                                            <tr key={batch.id}>
                                                                <td className="px-4 py-4 font-mono font-black">{batch.batch_number}</td>
                                                                <td>{batch.template_name || "Pouch batch"}<div className="text-xs font-semibold text-slate-500">{batch.location?.name}</div></td>
                                                                <td className="text-right font-black">{n(batch.qty_pcs, 0)} pcs</td>
                                                                <td className="px-4 text-right"><Button size="sm" data-testid={`packing-create-gonny-${batch.id}`} onClick={() => openCreateGonny(batch)}>Create gonny</Button></td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                                {!selected.batches.length && <div className="p-8 text-center text-sm font-semibold text-slate-500">No pouch batches are waiting for this order.</div>}
                                            </div>
                                        </div>
                                        <div className="rounded-[18px] border border-slate-200 bg-white p-5 shadow-sm">
                                            <h3 className="text-base font-black text-slate-950">Create gonny</h3>
                                            <div className="mt-4 space-y-3">
                                                <div>
                                                    <Label>Batch</Label>
                                                    <Select value={createBatchId} onValueChange={setCreateBatchId}>
                                                        <SelectTrigger><SelectValue placeholder="Select pouch batch" /></SelectTrigger>
                                                        <SelectContent>{selected.batches.map((batch) => <SelectItem key={batch.id} value={batch.id}>{batch.batch_number} • {batch.qty_pcs} pcs</SelectItem>)}</SelectContent>
                                                    </Select>
                                                </div>
                                                <div>
                                                    <Label>Gonny material</Label>
                                                    <Select value={gonnyMaterialId} onValueChange={setGonnyMaterialId}>
                                                        <SelectTrigger><SelectValue placeholder="Select gonny stock" /></SelectTrigger>
                                                        <SelectContent>{gonnies.map((item: PackagingMaterial) => <SelectItem key={item.id} value={item.id}>{item.code} • {item.name}</SelectItem>)}</SelectContent>
                                                    </Select>
                                                </div>
                                                <div><Label>Pouches to pack</Label><Input type="number" min="1" value={createQty} onChange={(event) => setCreateQty(event.target.value)} placeholder={selectedBatch ? String(selectedBatch.qty_pcs) : "Qty pcs"} /></div>
                                                <div>
                                                    <Label>Content mode</Label>
                                                    <Select value={contentMode} onValueChange={(value) => setContentMode(value as any)}>
                                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                                        <SelectContent><SelectItem value="LOOSE_POUCHES">Loose pouches</SelectItem><SelectItem value="PRIMARY_PACKS">Inner packs</SelectItem></SelectContent>
                                                    </Select>
                                                </div>
                                                <Button className="w-full" disabled={!createBatchId || !createQty || !gonnyMaterialId || createMutation.isPending} onClick={() => createMutation.mutate()}>
                                                    {createMutation.isPending ? "Creating..." : "Create gonny"}
                                                </Button>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="rounded-[18px] border border-slate-200 bg-white p-5 shadow-sm">
                                        <h3 className="mb-4 text-base font-black text-slate-950">Gonnies in yard</h3>
                                        <div className="grid gap-3 md:grid-cols-2">
                                            {selected.gonnies.map((gonny) => (
                                                <div key={gonny.id} className="rounded-[14px] border border-slate-200 p-4">
                                                    <div className="flex items-start justify-between gap-3">
                                                        <div><div className="font-mono font-black">{gonny.label_id}</div><div className="text-xs font-semibold text-slate-500">{gonny.qty_pcs} pcs · expected {n(getGonnyExpected(gonny))} kg · {gonny.status}</div><div className="mt-1 text-xs font-semibold text-slate-500">Dispatch unit: {gonny.dispatch_unit_no || gonny.label_id} · source batch {gonny.batch_no || gonny.fg_batch__batch_number || "linked"}</div></div>
                                                        <Chip tone={gonny.released_to_dispatch ? "green" : gonny.gross_weight_kg ? "blue" : "amber"}>{gonny.released_to_dispatch ? "Dispatch" : gonny.gross_weight_kg ? "Sealed" : "Open"}</Chip>
                                                    </div>
                                                    <div className="mt-4 flex flex-wrap gap-2">
                                                        {!gonny.gross_weight_kg && <Button size="sm" variant="outline" data-testid={`packing-seal-gonny-${gonny.id}`} onClick={() => setSealGonny(gonny)}><Scale className="mr-1 h-3 w-3" /> Seal weight</Button>}
                                                        {gonny.gross_weight_kg && !gonny.released_to_dispatch && <Button size="sm" data-testid={`packing-release-gonny-${gonny.id}`} onClick={() => releaseGonnyMutation.mutate(gonny.id)}>Send to dispatch</Button>}
                                                    </div>
                                                </div>
                                            ))}
                                            {!selected.gonnies.length && <div className="rounded-[14px] border border-dashed border-slate-200 p-8 text-center text-sm font-semibold text-slate-500">No gonnies created yet.</div>}
                                        </div>
                                    </div>
                                </>
                            )}

                            {hasRollWork && (activeRoute === "ROLL_PACK" || activeRoute === "RELEASE_UNPACKED") && (
                                <div className="rounded-[18px] border border-slate-200 bg-white p-5 shadow-sm">
                                    <div className="mb-4 flex flex-col gap-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
                                        <div className="min-w-0">
                                            <h3 className="text-base font-black text-slate-950">{activeRoute === "ROLL_PACK" ? "Rolls available · pack and release" : "Release unpacked rolls"}</h3>
                                            <div className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">Select one or many rolls. Material qty entered in bulk is the total issue for selected rolls.</div>
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            <Button size="sm" variant="outline" disabled={!selected.rolls.some((roll: any) => !roll.released_to_dispatch)} onClick={() => {
                                                const openIds = selected.rolls.filter((roll: any) => !roll.released_to_dispatch).map((roll: any) => roll.id)
                                                setSelectedRollIds(selectedRollIds.length === openIds.length ? [] : openIds)
                                            }}>
                                                {selectedRollIds.length ? "Clear selection" : "Select all rolls"}
                                            </Button>
                                            <Button size="sm" data-testid="packing-roll-bulk-release" disabled={!selectedRollsForBulk.length} onClick={() => openReleaseRolls(selectedRollsForBulk)}>
                                                Bulk pack & release {selectedRollsForBulk.length ? `(${selectedRollsForBulk.length})` : ""}
                                            </Button>
                                            <Chip tone="roll">{selected.rolls.length || selected.ready_for_dispatch.rolls_count} rolls</Chip>
                                        </div>
                                    </div>
                                    <div className="grid gap-3">
                                        {selected.rolls.map((roll) => (
                                            <div key={roll.id} className={`rounded-[14px] border p-4 ${roll.released_to_dispatch ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white"}`}>
                                                <div className="flex min-w-0 flex-col gap-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
                                                    <div className="flex min-w-0 gap-3">
                                                        {!roll.released_to_dispatch && (
                                                            <button
                                                                type="button"
                                                                data-testid={`packing-roll-select-${roll.id}`}
                                                                onClick={() => toggleRollSelection(roll.id)}
                                                                className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border text-xs font-black transition ${selectedRollIds.includes(roll.id) ? "border-blue-500 bg-blue-600 text-white shadow-sm shadow-blue-500/20" : "border-slate-200 bg-white text-slate-500 hover:border-blue-300"}`}
                                                                aria-label={`Select roll ${roll.label_id}`}
                                                            >
                                                                {selectedRollIds.includes(roll.id) ? <Check className="h-4 w-4" /> : ""}
                                                            </button>
                                                        )}
                                                        <div className="min-w-0">
                                                        <div className="flex flex-wrap items-center gap-2">
                                                            <span className="break-all font-mono text-base font-black text-slate-950">{roll.label_id}</span>
                                                            <Chip tone="roll">ROLL</Chip>
                                                            <Chip tone="blue">{roll.width_mm || "-"} mm</Chip>
                                                            <Chip tone={roll.released_to_dispatch ? "green" : "amber"}>{roll.released_to_dispatch ? "Dispatch ready" : activeRoute}</Chip>
                                                        </div>
                                                        <div className="mt-2 text-xs font-semibold text-slate-500">{roll.batch_no || "No batch"} · net {n(roll.net_weight_kg || roll.weight_kg)} kg · tare {n(roll.tare_weight_kg || 0)} kg · gross {n(roll.gross_weight_kg || roll.weight_kg)} kg · {roll.location?.name}</div>
                                                        <div className="mt-1 text-xs font-semibold text-slate-500">Dispatch unit: {roll.dispatch_unit_no || "created on release"} · sheet/wrap can be overridden here if SKU has no default.</div>
                                                        </div>
                                                    </div>
                                                    {!roll.released_to_dispatch ? (
                                                        <Button className="w-full shrink-0 sm:w-auto" data-testid={`packing-roll-release-${roll.id}`} onClick={() => openReleaseRoll(roll)}>
                                                            <PackageCheck className="mr-2 h-4 w-4" /> {activeRoute === "ROLL_PACK" ? "Pack roll & release" : "Release unpacked"}
                                                        </Button>
                                                    ) : (
                                                        <span className="rounded-full bg-emerald-600 px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-white">Ready in Dispatch Bay</span>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                        {!selected.rolls.length && <div className="rounded-[14px] border border-dashed border-slate-200 p-8 text-center text-sm font-semibold text-slate-500">No unreleased rolls for this order. Released rolls are already visible in Dispatch Bay.</div>}
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </main>

                <aside className="space-y-4 xl:col-span-2 2xl:col-span-1">
                    <div className="rounded-[18px] border border-indigo-200 bg-indigo-50 p-5 shadow-sm">
                        <div className="flex items-center justify-between">
                            <h3 className="text-base font-black text-slate-950">Live progress · {selected?.sales_order.order_number || "yard"}</h3>
                            <Chip tone={selectedProgress >= 100 ? "green" : "blue"}>{selected ? `${selectedProgress}%` : "Live"}</Chip>
                        </div>
                        <div className="mt-4 grid grid-cols-2 gap-2">
                            <MiniMetric label="Packed" value={`${n(selectedReadyUnits, 0)}`} hint="units ready" />
                            <MiniMetric label="To go" value={`${n(selectedPendingUnits, 0)}`} hint="yard tasks" />
                            <MiniMetric label="Net" value={`${n(selectedNet)} kg`} />
                            <MiniMetric label="Gross" value={`${n(selectedGross)} kg`} />
                            <MiniMetric label="Value" value="Audit" hint="stock card link" />
                            <MiniMetric label="Photos missing" value={n(board.data?.totals.photos_missing || 0, 0)} alert={Number(board.data?.totals.photos_missing || 0) > 0} />
                        </div>
                    </div>
                    <div className="rounded-[18px] border border-slate-200 bg-white p-5 shadow-sm">
                        <div className="flex items-center justify-between"><h3 className="text-sm font-black text-slate-950">Operator log</h3><span className="font-mono text-[10px] font-bold text-slate-400">SSE · 5s</span></div>
                        <div className="mt-3 space-y-1.5">
                            {[
                                ["now", "SYNC", "latest packing board refreshed"],
                                ["14:31", "ROLL", hasRollWork ? "roll pack data ready" : "no roll action for this SO"],
                                ["14:28", "GONNY", hasPouchWork ? "pouch flow available" : "gonny flow hidden for roll order"],
                                ["14:18", "TRACE", "stock card lineage attached"],
                                ["14:10", "AUDIT", "tare/gross preserved"],
                            ].map(([time, tag, copy]) => (
                                <div key={`${time}-${tag}`} className="grid grid-cols-[44px_54px_1fr] items-center gap-2 rounded-[10px] bg-slate-50 px-2 py-2 text-xs font-semibold">
                                    <span className="font-mono text-slate-400">{time}</span><span className="rounded bg-blue-100 px-1.5 py-0.5 text-center font-mono text-[10px] font-black text-blue-700">{tag}</span><span className="text-slate-600">{copy}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                    <div className="rounded-[18px] border border-slate-200 bg-white p-5 shadow-sm">
                        <h3 className="text-sm font-black text-slate-950">History & trace</h3>
                        <div className="mt-3 space-y-2">
                            <a className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700"><span className="flex items-center gap-2"><History className="h-4 w-4 text-blue-600" /> Stock Card filtered to SO</span><ArrowRight className="h-4 w-4" /></a>
                            <a className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700"><span className="flex items-center gap-2"><ClipboardList className="h-4 w-4 text-violet-600" /> Completed Trace</span><ArrowRight className="h-4 w-4" /></a>
                            <a className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-slate-700"><span className="flex items-center gap-2"><Layers className="h-4 w-4 text-slate-600" /> Upstream plan queue</span><ArrowRight className="h-4 w-4" /></a>
                        </div>
                    </div>
                    <details className="rounded-[18px] border border-slate-200 bg-white p-5 shadow-sm">
                        <summary className="flex cursor-pointer items-center gap-2 text-sm font-black"><HelpCircle className="h-4 w-4 text-blue-600" /> Packing glossary for operators</summary>
                        <div className="mt-4 space-y-2 text-xs font-semibold text-slate-600">
                            <p><b>Roll order:</b> pack with sheet/wrap if required, then release. No gonny form appears.</p>
                            <p><b>Pouch order:</b> create gonny, seal actual gross weight, then release.</p>
                            <p><b>Gross:</b> net product plus core, sheet, wrap, gonny, and other tare.</p>
                        </div>
                    </details>
                </aside>
            </section>

            <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
                <DialogContent data-testid="packing-create-gonny-dialog" className="max-h-[90vh] max-w-xl overflow-y-auto">
                    <DialogHeader><DialogTitle>Create gonny packing unit</DialogTitle></DialogHeader>
                    <div className="space-y-4">
                        <div className="rounded-3xl bg-slate-50 p-4 text-sm">
                            <div className="font-black">{selectedBatch?.batch_number || "Select batch"}</div>
                            <div className="mt-1 text-xs text-slate-500">Available {n(selectedBatch?.qty_pcs || 0, 0)} pcs. The unit remains OPEN until gross weight is sealed.</div>
                        </div>
                        <div>
                            <Label>Gonny material</Label>
                            <select data-testid="packing-gonny-material" value={gonnyMaterialId} onChange={(event) => setGonnyMaterialId(event.target.value)} className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold">
                                <option value="">Select gonny stock</option>
                                {gonnies.map((item: PackagingMaterial) => <option key={item.id} value={item.id}>{item.code} • {item.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <Label>Pouches to pack</Label>
                            <Input data-testid="packing-gonny-qty" type="number" min="1" value={createQty} onChange={(event) => setCreateQty(event.target.value)} placeholder={selectedBatch ? String(selectedBatch.qty_pcs) : "Qty pcs"} />
                        </div>
                        <div>
                            <Label>Content mode</Label>
                            <select data-testid="packing-gonny-content-mode" value={contentMode} onChange={(event) => setContentMode(event.target.value as any)} className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold">
                                <option value="LOOSE_POUCHES">Loose pouches</option>
                                <option value="PRIMARY_PACKS">Inner packs</option>
                            </select>
                        </div>
                        {contentMode === "PRIMARY_PACKS" && (
                            <div>
                                <Label>Inner pack count</Label>
                                <Input type="number" min="1" value={primaryPackCount} onChange={(event) => setPrimaryPackCount(event.target.value)} placeholder="Auto if sales snapshot has pcs/pack" />
                            </div>
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
                        <Button data-testid="packing-gonny-submit" disabled={!createBatchId || !createQty || !gonnyMaterialId || createMutation.isPending} onClick={() => createMutation.mutate()}>
                            {createMutation.isPending ? "Creating..." : "Create gonny"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={Boolean(releaseRolls.length)} onOpenChange={(open) => !open && setReleaseRolls([])}>
                <DialogContent data-testid="packing-roll-dialog" className="z-[70] max-h-[92vh] w-[calc(100vw-32px)] max-w-5xl overflow-hidden rounded-[22px] border border-slate-200 bg-white p-0 shadow-[0_24px_90px_-32px_rgba(15,23,42,0.55)]">
                    <div className="relative max-h-[92vh] overflow-y-auto overflow-x-hidden bg-white">
                        <div className="border-b border-slate-200 bg-[linear-gradient(115deg,#eff6ff_0%,#f8fafc_62%,#eef2ff_100%)] p-5 sm:p-6">
                            <DialogHeader>
                                <DialogTitle>{activeRollCount > 1 ? "Bulk release rolls to Dispatch Bay" : "Release roll to Dispatch Bay"}</DialogTitle>
                            </DialogHeader>
                            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                                <MiniMetric label="Selected rolls" value={n(activeRollCount, 0)} hint="each becomes a dispatch unit" />
                                <MiniMetric label="Net" value={`${n(activeRollNet)} kg`} hint="product weight" />
                                <MiniMetric label="Tare" value={`${n(activeRollTare)} kg`} hint="core + packing" />
                                <MiniMetric label="Gross" value={`${n(activeRollGross)} kg`} hint="shipment weight" />
                            </div>
                        </div>

                        {releaseRolls.length ? (
                            <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,0.95fr)_minmax(360px,1.05fr)]">
                                <div className="space-y-4">
                                    <div className="rounded-[18px] border border-slate-200 bg-white p-4">
                                        <div className="mb-3 flex items-center justify-between gap-3">
                                            <div>
                                                <div className="text-sm font-black text-slate-950">Rolls in this release</div>
                                                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">one dispatch unit per roll</div>
                                            </div>
                                            <Chip tone="roll">{activeRollCount} rolls</Chip>
                                        </div>
                                        <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
                                            {releaseRolls.map((roll) => (
                                                <div key={roll.id} className="rounded-[14px] border border-slate-200 bg-slate-50 p-3">
                                                    <div className="break-all font-mono text-sm font-black text-slate-950">{roll.label_id}</div>
                                                    <div className="mt-1 text-xs font-semibold text-slate-500">{roll.batch_no || "No batch"} · net {n(roll.net_weight_kg || roll.weight_kg)} kg · tare {n(roll.tare_weight_kg || 0)} kg · gross {n(roll.gross_weight_kg || roll.weight_kg)} kg</div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="rounded-[18px] border border-blue-200 bg-blue-50 p-4">
                                        <div className="text-sm font-black text-slate-950">How material is consumed</div>
                                        <p className="mt-1 text-sm font-semibold leading-6 text-slate-600">
                                            For bulk roll packing, enter the total sheet, wrap, tape, label, or tag quantity for all selected rolls. The system creates one audit issue and links it back to every roll.
                                        </p>
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <div className="rounded-[18px] border border-slate-200 bg-white p-4">
                                        <Label>Release mode</Label>
                                        <select data-testid="packing-roll-release-mode" value={releaseMode} onChange={(event) => setReleaseMode(event.target.value as any)} className="mt-2 h-12 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold">
                                            <option value="PACKED">Packed roll with sheet/wrap</option>
                                            <option value="UNPACKED">Release unpacked roll</option>
                                        </select>
                                    </div>

                                    {releaseMode === "PACKED" && (
                                        <div className="rounded-[18px] border border-slate-200 bg-white p-4">
                                            <div className="mb-3 flex items-start justify-between gap-3">
                                                <div>
                                                    <div className="text-sm font-black text-slate-950">Total packing consumption</div>
                                                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">total qty for selected rolls, not per roll</div>
                                                </div>
                                                <Chip tone="green">Total issue</Chip>
                                            </div>
                                            <div className="space-y-3">
                                                {rollPackLines.map((line, index) => (
                                                    <div key={index} className="rounded-[14px] border border-slate-200 bg-slate-50 p-3">
                                                        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_110px]">
                                                            <div>
                                                                <Label>Material</Label>
                                                                <select data-testid={`packing-roll-material-${index}`} value={line.material_id} onChange={(event) => setRollPackLines((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, material_id: event.target.value } : row))} className="mt-1 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold">
                                                                    <option value="">Select sheet / wrap / tape</option>
                                                                    {rollPackagingMaterials.map((item) => <option key={item.id} value={item.id}>{item.code} • {item.name}</option>)}
                                                                </select>
                                                            </div>
                                                            <div>
                                                                <Label>Total qty</Label>
                                                                <Input data-testid={`packing-roll-qty-${index}`} className="mt-1 h-11" value={line.qty} onChange={(event) => setRollPackLines((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, qty: event.target.value } : row))} type="number" step="0.001" placeholder="Qty" />
                                                            </div>
                                                        </div>
                                                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                                                            <div>
                                                                <Label>UOM</Label>
                                                                <Input className="mt-1 h-10" value={line.uom || "PCS"} onChange={(event) => setRollPackLines((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, uom: event.target.value } : row))} placeholder="PCS" />
                                                            </div>
                                                            <div>
                                                                <Label>Basis</Label>
                                                                <Input className="mt-1 h-10" value={line.basis || "TOTAL_ROLLS"} onChange={(event) => setRollPackLines((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, basis: event.target.value } : row))} placeholder="TOTAL_ROLLS" />
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                            <Button type="button" variant="outline" className="mt-3" onClick={() => setRollPackLines((rows) => [...rows, { material_id: "", qty: "", uom: "PCS", basis: "TOTAL_ROLLS" }])}>Add line</Button>
                                        </div>
                                    )}

                                    {releaseMode === "UNPACKED" && (
                                        <div className="rounded-[18px] border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">
                                            Each selected roll becomes its own dispatch batch/unit. No sheet, wrap, tape, or label stock is consumed.
                                        </div>
                                    )}
                                </div>
                            </div>
                        ) : null}

                        <DialogFooter className="border-t border-slate-200 bg-white p-4">
                            <Button variant="outline" onClick={() => setReleaseRolls([])}>Cancel</Button>
                            <Button data-testid="packing-roll-submit" disabled={!releaseRolls.length || releaseRollMutation.isPending} onClick={() => releaseRollMutation.mutate({ rollIds: releaseRolls.map((roll) => String(roll.id)), mode: releaseMode, lines: rollPackLines })}>
                                {releaseRollMutation.isPending ? "Releasing..." : activeRollCount > 1 ? `Release ${activeRollCount} rolls` : "Release roll"}
                            </Button>
                        </DialogFooter>
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog open={Boolean(sealGonny)} onOpenChange={(open) => !open && setSealGonny(null)}>
                <DialogContent data-testid="packing-seal-gonny-dialog" className="max-h-[90vh] max-w-xl overflow-y-auto">
                    <DialogHeader><DialogTitle>Seal gonny with actual gross weight</DialogTitle></DialogHeader>
                    {sealGonny && (
                        <div className="space-y-4">
                            <div className="rounded-3xl bg-slate-50 p-4">
                                <div className="font-black">{sealGonny.label_id}</div>
                                <div className="mt-2 grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
                                    <div><b>{kg(sealGonny.net_product_weight_kg)}</b><br />product net</div>
                                    <div><b>{n(sealGonny.inner_pack_tare_kg)}</b><br />inner tare</div>
                                    <div><b>{n(sealGonny.secondary_pack_tare_kg)}</b><br />gonny tare</div>
                                    <div><b>{kg(expected)}</b><br />expected gross</div>
                                </div>
                            </div>
                            <div>
                                <Label>Actual gonny gross weight (kg)</Label>
                                <Input data-testid="packing-gonny-seal-weight" type="number" step="0.001" value={actualGross} onChange={(event) => setActualGross(event.target.value)} />
                            </div>
                            <div className={`rounded-2xl p-3 text-sm font-bold ${Math.abs(variancePct) > 2 ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-800"}`}>
                                Variance: {n(variance, 3)} kg ({n(variancePct, 2)}%)
                            </div>
                            {Math.abs(variancePct) > 2 && (
                                <div>
                                    <Label>Variance reason</Label>
                                    <Textarea data-testid="packing-gonny-variance-reason" value={varianceReason} onChange={(event) => setVarianceReason(event.target.value)} placeholder="Explain why actual gonny weight differs from expected." />
                                </div>
                            )}
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setSealGonny(null)}>Cancel</Button>
                        <Button data-testid="packing-gonny-seal-submit" disabled={!actualGross || (Math.abs(variancePct) > 2 && !varianceReason.trim()) || sealMutation.isPending} onClick={() => sealMutation.mutate()}>
                            {sealMutation.isPending ? "Sealing..." : "Seal gonny"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}

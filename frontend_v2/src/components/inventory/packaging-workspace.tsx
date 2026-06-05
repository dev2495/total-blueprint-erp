"use client"

/**
 * V3.6 Packaging Workspace
 *
 * Inner pouches, gunny, cartons, tape, sheet, label, tag, POD sleeves. Filter
 * by kind, supply mode, location, plant, color, item code. Beautiful grid +
 * table views, saved views, drawer with reservations.
 */

import * as React from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import {
    AlertTriangle,
    ArrowRight,
    Boxes,
    Eye,
    Factory,
    MapPin,
    Package,
    Plus,
    Sparkles,
    X,
} from "lucide-react"

import { GradientHero } from "@/components/erp/gradient-hero"
import { cn } from "@/lib/utils"
import { describeApiError } from "@/lib/api"
import { inventoryService } from "@/services/inventory"
import { logisticsService } from "@/services/logistics"
import {
    FilterBar,
    FilterGroup,
    FilterRail,
    KpiTileV36,
    MultiSelectPills,
    SavedViewsBar,
    WorkspaceSection,
    type SavedView,
    useSavedViews,
} from "./workspace-shell"
import { ClassTabBar, INVENTORY_CLASS_TABS, ModeToggle, PulseViewV36 } from "./pulse-view"

type ViewMode = "table" | "grid"
type Kind = "ALL" | "INNER_POUCH" | "GONNY" | "CARTON" | "TAPE" | "SHEET" | "LABEL" | "TAG" | "POD" | "OTHER"

interface PackagingFilterState {
    search: string
    plant: string
    location: string
    kind: Kind
    families: string[]
    supplyMode: "ALL" | "PURCHASED" | "IN_HOUSE" | "BOTH"
    healthBucket: "ALL" | "HEALTHY" | "LOW" | "EMPTY"
}

const DEFAULT_FILTERS: PackagingFilterState = {
    search: "",
    plant: "ALL",
    location: "ALL",
    kind: "ALL",
    families: [],
    supplyMode: "ALL",
    healthBucket: "ALL",
}

const DEFAULT_VIEWS: SavedView<PackagingFilterState>[] = [
    { id: "all-pkg", name: "All packaging", icon: "📦", pinned: true, state: DEFAULT_FILTERS },
    { id: "inner-pouches", name: "Inner pouches", icon: "🛍️", state: { ...DEFAULT_FILTERS, kind: "INNER_POUCH" } },
    { id: "shipping", name: "Shipping (gunny/carton)", icon: "📦", state: { ...DEFAULT_FILTERS, kind: "CARTON" } },
    { id: "pod", name: "POD sleeves", icon: "🏷️", state: { ...DEFAULT_FILTERS, kind: "POD" } },
    { id: "low-stock", name: "Low stock", icon: "⚠️", state: { ...DEFAULT_FILTERS, healthBucket: "LOW" } },
]

function fmtNum(n: number, max = 0): string {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: max }).format(n)
}

function qtyUom(row: any): string {
    return String(row?.uom || row?.base_uom || "PCS")
}

function qtyDecimalsForUom(uom?: string): number {
    const normalized = String(uom || "PCS").trim().toUpperCase()
    if (["PCS", "PC", "NOS", "NO", "EA", "EACH"].includes(normalized)) return 0
    return 3
}

function fmtQty(n: number, uom?: string): string {
    return fmtNum(n, qtyDecimalsForUom(uom))
}

function todayIso() {
    return new Date().toISOString().slice(0, 10)
}

function makeTrend(target: number, points = 12): number[] {
    if (!Number.isFinite(target) || target <= 0) return [0, 0, 0, 0]
    const seed = Math.max(target * 0.65, 1)
    const out: number[] = []
    for (let i = 0; i < points; i++) {
        const ratio = i / Math.max(points - 1, 1)
        const wobble = Math.sin(i * 0.6 + 0.5) * 0.08
        out.push(Math.max(0, seed + (target - seed) * ratio + target * wobble))
    }
    return out
}

function detectKind(row: any): Exclude<Kind, "ALL"> {
    const k = String(row.packaging_kind || row.code || row.material_name || "").toUpperCase()
    if (/INNER|POUCH/i.test(k)) return "INNER_POUCH"
    if (/GUNNY|GONNY/i.test(k)) return "GONNY"
    if (/CARTON|BOX|BAG/i.test(k)) return "CARTON"
    if (/TAPE/i.test(k)) return "TAPE"
    if (/SHEET/i.test(k)) return "SHEET"
    if (/LABEL/i.test(k)) return "LABEL"
    if (/TAG/i.test(k)) return "TAG"
    if (/POD/i.test(k)) return "POD"
    return "OTHER"
}

function healthOf(row: any): { score: number; bucket: "HEALTHY" | "LOW" | "EMPTY" } {
    const qty = Number(row.qty || row.on_hand || 0)
    const reorder = Number(row.reorder_point || 50)
    const score = qty <= 0 ? 0 : qty > reorder * 2 ? 100 : Math.max(10, Math.min(100, Math.round((qty / Math.max(reorder, 1)) * 50)))
    const bucket = qty <= 0 ? "EMPTY" : score >= 50 ? "HEALTHY" : "LOW"
    return { score, bucket }
}

const KIND_ICON: Record<string, string> = {
    INNER_POUCH: "🛍️", GONNY: "🧺", CARTON: "📦", TAPE: "📼", SHEET: "📄", LABEL: "🏷️", TAG: "🏷️", POD: "🎫", OTHER: "📦",
}

const KIND_COLOR: Record<string, string> = {
    INNER_POUCH: "amber", GONNY: "violet", CARTON: "blue", TAPE: "rose", SHEET: "emerald", LABEL: "blue", TAG: "violet", POD: "rose", OTHER: "slate",
}

export function PackagingWorkspaceV36() {
    const [filters, setFilters] = React.useState<PackagingFilterState>(DEFAULT_FILTERS)
    const [mode, setMode] = React.useState<"pulse" | "browse">("pulse")
    const [viewMode, setViewMode] = React.useState<ViewMode>("grid")
    const [selected, setSelected] = React.useState<any | null>(null)
    const [pageSize, setPageSize] = React.useState(48)
    const countDate = React.useMemo(() => todayIso(), [])
    const savedViews = useSavedViews<PackagingFilterState>("packaging", DEFAULT_VIEWS)

    const stockQuery = useQuery({
        queryKey: ["inventory-packaging"],
        queryFn: () => inventoryService.getInventorySnapshot(),
        staleTime: 30_000,
    })

    const packingCountQuery = useQuery({
        queryKey: ["inventory-packaging-eod", countDate],
        queryFn: () => logisticsService.getPackingMaterialCount({ date: countDate }),
        staleTime: 45_000,
    })

    const allRows: any[] = React.useMemo(() => stockQuery.data?.packaging || [], [stockQuery.data])

    const families = React.useMemo(() => {
        const map = new Map<string, number>()
        for (const r of allRows) {
            const k = String(r.code || r.material_code || "").trim()
            if (!k) continue
            map.set(k, (map.get(k) || 0) + 1)
        }
        return Array.from(map.entries()).map(([id, count]) => ({ id, label: id, count })).sort((a, b) => b.count - a.count).slice(0, 50)
    }, [allRows])

    const plantOptions = React.useMemo(() => {
        const map = new Map<string, string>()
        map.set("ALL", "All plants")
        for (const r of allRows) {
            const id = String(r.plant_id || r.plant || "")
            if (id) map.set(id, r.plant_name || id)
        }
        return Array.from(map.entries()).map(([id, label]) => ({ id, label }))
    }, [allRows])

    const locationOptions = React.useMemo(() => {
        const map = new Map<string, { label: string; count: number }>()
        map.set("ALL", { label: "All locations", count: allRows.length })
        for (const r of allRows) {
            const id = String(r.location || r.location_id || r.location_code || "")
            if (!id) continue
            const cur = map.get(id) || { label: r.location_code || r.location_name || id, count: 0 }
            map.set(id, { label: cur.label, count: cur.count + 1 })
        }
        return Array.from(map.entries()).map(([id, v]) => ({ id, label: v.label, count: v.count }))
    }, [allRows])

    const filtered = React.useMemo(() => {
        const q = filters.search.trim().toLowerCase()
        return allRows.filter((r: any) => {
            if (q) {
                const hay = [r.code, r.material_code, r.material_name, r.name, r.color_variant, r.location_code, r.location_name].some((v) => String(v || "").toLowerCase().includes(q))
                if (!hay) return false
            }
            if (filters.plant !== "ALL" && String(r.plant_id || r.plant || "") !== filters.plant) return false
            if (filters.location !== "ALL") {
                const loc = String(r.location || r.location_id || r.location_code || "")
                if (loc !== filters.location) return false
            }
            if (filters.kind !== "ALL" && detectKind(r) !== filters.kind) return false
            if (filters.families.length > 0 && !filters.families.includes(String(r.code || r.material_code || ""))) return false
            if (filters.supplyMode !== "ALL" && String(r.supply_mode || "BOTH").toUpperCase() !== filters.supplyMode) return false
            if (filters.healthBucket !== "ALL" && healthOf(r).bucket !== filters.healthBucket) return false
            return true
        })
    }, [allRows, filters])

    const kpi = React.useMemo(() => {
        const totalPcs = filtered.reduce((s: number, r: any) => s + Number(r.qty || r.on_hand || 0), 0)
        const reservedPcs = filtered.reduce((s: number, r: any) => s + Number(r.reserved_qty || 0), 0)
        const lowStock = filtered.filter((r: any) => healthOf(r).bucket === "LOW").length
        const empty = filtered.filter((r: any) => healthOf(r).bucket === "EMPTY").length
        return { totalSkus: filtered.length, totalPcs, reservedPcs, available: totalPcs - reservedPcs, lowStock, empty }
    }, [filtered])
    const eod = packingCountQuery.data?.eod_allocation
    const manualCountRows = packingCountQuery.data?.totals?.materials ?? 0
    const throughputOrders = packingCountQuery.data?.totals?.throughput_orders ?? 0

    // Kind breakdown
    const kindBreakdown = React.useMemo(() => {
        const map = new Map<string, { count: number; pcs: number }>()
        for (const r of filtered) {
            const k = detectKind(r)
            const cur = map.get(k) || { count: 0, pcs: 0 }
            cur.count += 1
            cur.pcs += Number(r.qty || r.on_hand || 0)
            map.set(k, cur)
        }
        return Array.from(map.entries()).map(([k, v]) => ({ kind: k, ...v })).sort((a, b) => b.pcs - a.pcs)
    }, [filtered])

    const chips = React.useMemo(() => {
        const list: { key: string; label: string; onClear: () => void }[] = []
        if (filters.search) list.push({ key: "search", label: `"${filters.search}"`, onClear: () => setFilters((f) => ({ ...f, search: "" })) })
        if (filters.kind !== "ALL") list.push({ key: "k", label: `Kind · ${filters.kind}`, onClear: () => setFilters((f) => ({ ...f, kind: "ALL" })) })
        if (filters.plant !== "ALL") list.push({ key: "p", label: `Plant`, onClear: () => setFilters((f) => ({ ...f, plant: "ALL" })) })
        if (filters.location !== "ALL") list.push({ key: "l", label: `Location`, onClear: () => setFilters((f) => ({ ...f, location: "ALL" })) })
        if (filters.families.length) list.push({ key: "fam", label: `Families · ${filters.families.length}`, onClear: () => setFilters((f) => ({ ...f, families: [] })) })
        if (filters.supplyMode !== "ALL") list.push({ key: "s", label: `Mode · ${filters.supplyMode}`, onClear: () => setFilters((f) => ({ ...f, supplyMode: "ALL" })) })
        if (filters.healthBucket !== "ALL") list.push({ key: "h", label: `Health · ${filters.healthBucket}`, onClear: () => setFilters((f) => ({ ...f, healthBucket: "ALL" })) })
        return list
    }, [filters])

    // Pulse breakdowns (unconditional)
    const pulseKindBreakdown = kindBreakdown.map((b: any) => ({ label: b.kind.replace("_", " "), value: b.pcs }))
    const pulseLocationBreakdown = React.useMemo(() => {
        const map = new Map<string, number>()
        for (const r of filtered as any[]) {
            const k = String(r.location_code || r.location_name || "—")
            const qty = Number(r.qty || r.on_hand || 0)
            map.set(k, (map.get(k) || 0) + qty)
        }
        return Array.from(map.entries()).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)
    }, [filtered])
    const pulseAgeing = React.useMemo(() => {
        let fresh = 0, aged = 0, old = 0
        for (const r of filtered as any[]) {
            const d = Number(r.age_days || 0)
            if (d <= 30) fresh += 1
            else if (d <= 90) aged += 1
            else old += 1
        }
        return { fresh, aged, old }
    }, [filtered])

    // Matrix: kind × plant (pcs)
    const pulseMatrix = React.useMemo(() => {
        const cellMap: Record<string, Record<string, number>> = {}
        const rowSet = new Set<string>()
        const colSet = new Set<string>()
        for (const r of filtered as any[]) {
            const k = detectKind(r).replace("_", " ")
            const plant = String(r.plant_name || r.plant_id || "—")
            rowSet.add(k); colSet.add(plant)
            cellMap[k] = cellMap[k] || {}
            cellMap[k][plant] = (cellMap[k][plant] || 0) + Number(r.qty || r.on_hand || 0)
        }
        return {
            title: "Kind × plant (pcs)",
            subtitle: "Where each kind is held",
            rowLabel: "kind", colLabel: "plant",
            rows: Array.from(rowSet).sort(),
            cols: Array.from(colSet).sort(),
            cells: cellMap,
            unit: "pcs",
        }
    }, [filtered])

    const pulseTopList = React.useMemo(() => {
        const map = new Map<string, { qty: number; kind: string; loc: string }>()
        for (const r of filtered as any[]) {
            const k = String(r.code || r.material_code || "—")
            const cur = map.get(k) || { qty: 0, kind: detectKind(r), loc: String(r.location_code || r.location_name || "") }
            cur.qty += Number(r.qty || r.on_hand || 0)
            map.set(k, cur)
        }
        const rows = Array.from(map.entries())
            .sort((a, b) => b[1].qty - a[1].qty)
            .slice(0, 8)
            .map(([label, v]) => ({
                label, sub: `${v.kind.replace("_", " ")} · ${v.loc || "—"}`,
                value: `${fmtNum(v.qty)} pcs`,
            }))
        return { title: "Top SKUs by pieces", subtitle: "Highest on-hand", rows }
    }, [filtered])

    if (stockQuery.isError) {
        return <div className="rounded-2xl border border-danger-border bg-danger-bg p-5 text-sm text-rose-900"><div className="font-bold">Could not load packaging.</div><div className="mt-1 text-xs">{describeApiError(stockQuery.error, "Check backend.")}</div></div>
    }

    return (
        <div className="space-y-4 pb-12">
            <ClassTabBar tabs={INVENTORY_CLASS_TABS} activeId="packaging" />
            <GradientHero
                eyebrow="Inventory · V3.6 · packaging"
                title="Packaging materials"
                subtitle="Inner pouches, gunny, cartons, tape, sheet, label, tag, POD sleeves — segmented and searchable."
                palette="rose"
                chips={[
                    { icon: <Package className="h-3.5 w-3.5" />, label: "SKUs", value: `${kpi.totalSkus}`, tone: "ok" },
                    { icon: <Sparkles className="h-3.5 w-3.5" />, label: "Pieces", value: fmtNum(kpi.totalPcs, 0), tone: "violet" },
                    { icon: <Package className="h-3.5 w-3.5" />, label: "EOD count", value: `${manualCountRows}`, tone: "ok" },
                    { icon: <Sparkles className="h-3.5 w-3.5" />, label: "Mapped", value: fmtNum(eod?.mapped_qty || 0, 2), tone: "violet" },
                    { icon: <AlertTriangle className="h-3.5 w-3.5" />, label: "Empty", value: `${kpi.empty}`, tone: "warn" },
                ]}
                actions={
                    <div className="flex items-center gap-2">
                        <Link href="/inventory/grn" className="inline-flex items-center gap-1.5 rounded-xl bg-surface-1 px-4 py-1.5 text-xs font-bold text-warning-fg shadow-md hover:bg-warning-bg">
                            <Plus className="h-3.5 w-3.5" /> Receive packaging
                        </Link>
                        <Link href="/inventory" className="inline-flex items-center gap-1.5 rounded-xl bg-white/15 px-4 py-1.5 text-xs font-bold text-white ring-1 ring-white/30 hover:bg-white/25">
                            ← Summary
                        </Link>
                    </div>
                }
            />

            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
                <div className="rounded-2xl border border-success-border bg-emerald-50/80 p-4 shadow-sm">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-success-fg">EOD packing count · {countDate}</div>
                            <div className="mt-1 text-sm font-bold text-slate-700">
                                Inner pouch is auto math from packed pieces; gunny is consumed by sealed count. Tape, sheet, labels, tags, boxes, and extras are mapped from evening open-close count.
                            </div>
                        </div>
                        <Link href="/logistics/packing/consumption" className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-black text-white shadow-sm hover:bg-emerald-700">
                            Open EOD count <ArrowRight className="h-3.5 w-3.5" />
                        </Link>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-4">
                        <Stat label="Manual count rows" value={fmtNum(manualCountRows)} tone="emerald" />
                        <Stat label="Same-day orders" value={fmtNum(throughputOrders)} tone="slate" />
                        <Stat label="Consumed today" value={fmtNum(eod?.consumed_qty || 0, 2)} tone="violet" />
                        <Stat label="Mapped orders" value={fmtNum(eod?.mapped_orders || 0)} tone="emerald" />
                    </div>
                    {eod?.top_materials?.length ? (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                            {eod.top_materials.map((row) => (
                                <span key={row.material_code} className="rounded-full border border-success-border bg-surface-1 px-2.5 py-1 text-[10px] font-black text-emerald-800">
                                    {row.material_code} · {fmtNum(row.qty, 2)}
                                </span>
                            ))}
                        </div>
                    ) : null}
                </div>
                <div className="rounded-2xl border border-slate-200 bg-surface-1 p-4 shadow-sm">
                    <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Unassigned count short</div>
                    <div className="mt-1 font-display text-2xl font-black text-slate-950">{fmtNum(eod?.unassigned_qty || 0, 2)}</div>
                    <div className="mt-1 text-xs font-semibold text-slate-500">Should stay 0 when allowed SKU mapping covers the day&apos;s orders.</div>
                </div>
            </div>

            <div className="flex items-center justify-between gap-3 flex-wrap">
                <ModeToggle mode={mode} onChange={setMode} />
                <span className="text-[11px] text-slate-500">{mode === "pulse" ? "Pulse · kind mix + KPIs" : "Browse · cards / table"}</span>
            </div>

            {mode === "pulse" && (
                <PulseViewV36
                    kpis={[
                        { label: "SKU rows", value: fmtNum(kpi.totalSkus), sub: "active items", icon: <Package className="h-3.5 w-3.5" />, trend: makeTrend(kpi.totalSkus, 12) },
                        { label: "Total pieces", value: fmtNum(kpi.totalPcs, 0), sub: "on hand", icon: <Sparkles className="h-3.5 w-3.5" />, tone: "good", trend: makeTrend(kpi.totalPcs, 12) },
                        { label: "Available", value: fmtNum(kpi.available, 0), sub: "ready to issue", icon: <Package className="h-3.5 w-3.5" />, tone: "good", trend: makeTrend(kpi.available, 12) },
                        { label: "Reserved", value: fmtNum(kpi.reservedPcs, 0), sub: "held by SO", icon: <Sparkles className="h-3.5 w-3.5" />, tone: "warn", trend: makeTrend(kpi.reservedPcs, 12) },
                        { label: "Low stock", value: fmtNum(kpi.lowStock), sub: "below reorder", icon: <AlertTriangle className="h-3.5 w-3.5" />, tone: kpi.lowStock > 0 ? "warn" : "default", trend: makeTrend(kpi.lowStock, 12) },
                        { label: "Empty", value: fmtNum(kpi.empty), sub: "needs reorder", icon: <AlertTriangle className="h-3.5 w-3.5" />, tone: kpi.empty > 0 ? "bad" : "default", trend: makeTrend(kpi.empty, 12) },
                    ]}
                    statRow={[
                        { label: "Distinct kinds", value: fmtNum(pulseKindBreakdown.length), sub: "pouch · gunny · …" },
                        { label: "Locations", value: fmtNum(pulseLocationBreakdown.length), sub: "with stock" },
                        { label: "Avg per SKU", value: kpi.totalSkus > 0 ? `${(kpi.totalPcs / kpi.totalSkus).toFixed(0)}` : "—", sub: "pcs per row" },
                        { label: "Reserved %", value: kpi.totalPcs > 0 ? `${Math.round((kpi.reservedPcs / kpi.totalPcs) * 100)}%` : "0%", sub: "pcs held", tone: kpi.reservedPcs > 0 ? "warn" : "default" },
                        { label: "EOD mapped", value: fmtNum(eod?.mapped_qty || 0, 2), sub: `${fmtNum(eod?.mapped_orders || 0)} orders`, tone: "good" },
                        { label: "Healthy", value: kpi.totalSkus > 0 ? `${Math.round(((kpi.totalSkus - kpi.lowStock - kpi.empty) / kpi.totalSkus) * 100)}%` : "100%", sub: "of SKUs", tone: "good" },
                        { label: "Stock-outs", value: fmtNum(kpi.empty), sub: "0 on hand", tone: kpi.empty > 0 ? "bad" : "default" },
                    ]}
                    primaryBreakdown={{ title: "Mix · by kind (PCS)", entries: pulseKindBreakdown, unit: "PCS" }}
                    ageing={pulseAgeing}
                    locationBreakdown={pulseLocationBreakdown}
                    matrix={pulseMatrix}
                    topList={pulseTopList}
                />
            )}

            {/* Kind breakdown grid */}
            {mode === "browse" && kindBreakdown.length > 0 && (
                <div className="rounded-2xl border border-slate-200 bg-surface-1 p-4 shadow-sm">
                    <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500 mb-3">Mix · by kind</div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-9">
                        {kindBreakdown.map((b) => {
                            const tone = KIND_COLOR[b.kind] || "slate"
                            const TONE: Record<string, string> = {
                                amber: "from-amber-50 to-orange-50 ring-amber-200 text-amber-900",
                                violet: "from-violet-50 to-fuchsia-50 ring-violet-200 text-violet-900",
                                blue: "from-blue-50 to-indigo-50 ring-blue-200 text-blue-900",
                                rose: "from-rose-50 to-pink-50 ring-rose-200 text-rose-900",
                                emerald: "from-emerald-50 to-teal-50 ring-emerald-200 text-emerald-900",
                                slate: "from-slate-50 to-slate-100 ring-slate-200 text-slate-900",
                            }
                            return (
                                <button key={b.kind} onClick={() => setFilters((f) => ({ ...f, kind: b.kind as Kind }))} className={cn("rounded-xl bg-gradient-to-br p-3 ring-1", TONE[tone])}>
                                    <div className="text-2xl">{KIND_ICON[b.kind]}</div>
                                    <div className="mt-1 text-[10px] font-black uppercase tracking-wider opacity-70">{b.kind.replace("_", " ")}</div>
                                    <div className="font-display text-base font-black mt-0.5">{fmtNum(b.pcs, 0)}</div>
                                    <div className="text-[9px] opacity-60">{b.count} SKU</div>
                                </button>
                            )
                        })}
                    </div>
                </div>
            )}

            {mode === "browse" && (
            <>
            <SavedViewsBar
                views={savedViews.views}
                activeId={savedViews.activeId}
                onSelect={(v) => { savedViews.setActiveId(v.id); setFilters(v.state) }}
                onDelete={savedViews.deleteView}
                onTogglePin={savedViews.togglePin}
                onSave={(name) => savedViews.saveView(name, filters)}
            />

            <FilterBar
                search={filters.search}
                onSearchChange={(v) => setFilters((f) => ({ ...f, search: v }))}
                chips={chips}
                onClearAll={() => setFilters(DEFAULT_FILTERS)}
                viewMode={viewMode}
                onViewModeChange={(v) => setViewMode(v as ViewMode)}
                viewModes={["table", "grid"]}
                onExport={() => window.open(inventoryService.getInventoryExportUrl("packaging"), "_blank", "noopener,noreferrer")}
            />

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
                <FilterRail>
                    <FilterGroup
                        label="Kind"
                        value={filters.kind}
                        onChange={(id) => setFilters((f) => ({ ...f, kind: id as Kind }))}
                        options={[
                            { id: "ALL", label: "All" },
                            { id: "INNER_POUCH", label: "Inner pouch" },
                            { id: "GONNY", label: "Gunny" },
                            { id: "CARTON", label: "Carton / box" },
                            { id: "TAPE", label: "Tape" },
                            { id: "SHEET", label: "Sheet" },
                            { id: "LABEL", label: "Label" },
                            { id: "TAG", label: "Tag" },
                            { id: "POD", label: "POD sleeve" },
                            { id: "OTHER", label: "Other" },
                        ]}
                    />
                    <FilterGroup
                        label="Health"
                        value={filters.healthBucket}
                        onChange={(id) => setFilters((f) => ({ ...f, healthBucket: id as any }))}
                        options={[
                            { id: "ALL", label: "All" },
                            { id: "HEALTHY", label: "Healthy ✅" },
                            { id: "LOW", label: "Low ⚠️" },
                            { id: "EMPTY", label: "Empty 🔥" },
                        ]}
                    />
                    <FilterGroup
                        label="Supply mode"
                        value={filters.supplyMode}
                        onChange={(id) => setFilters((f) => ({ ...f, supplyMode: id as any }))}
                        options={[
                            { id: "ALL", label: "All" },
                            { id: "PURCHASED", label: "Purchased" },
                            { id: "IN_HOUSE", label: "In-house" },
                            { id: "BOTH", label: "Both" },
                        ]}
                    />
                    <FilterGroup
                        label="Plant"
                        value={filters.plant}
                        onChange={(id) => setFilters((f) => ({ ...f, plant: id }))}
                        options={plantOptions.map((p) => ({ id: p.id, label: p.label }))}
                    />
                    <div>
                        <div className="mb-1.5 text-[10px] font-black uppercase tracking-wider text-slate-500">Location</div>
                        <select value={filters.location} onChange={(e) => setFilters((f) => ({ ...f, location: e.target.value }))} className="w-full rounded-lg border border-slate-200 bg-surface-1 px-2.5 py-1.5 text-xs font-mono">
                            {locationOptions.map((l) => (
                                <option key={l.id} value={l.id}>{l.label}{typeof l.count === "number" ? ` · ${l.count}` : ""}</option>
                            ))}
                        </select>
                    </div>
                    {families.length > 0 && (
                        <MultiSelectPills label="Item code" options={families} selected={filters.families} onChange={(v) => setFilters((f) => ({ ...f, families: v }))} />
                    )}
                </FilterRail>

                <main>
                    {viewMode === "table" ? (
                        <PkgTable rows={filtered.slice(0, pageSize)} total={filtered.length} pageSize={pageSize} onPageSize={setPageSize} loading={stockQuery.isLoading} onSelect={setSelected} />
                    ) : (
                        <PkgGrid rows={filtered.slice(0, pageSize)} total={filtered.length} pageSize={pageSize} onPageSize={setPageSize} loading={stockQuery.isLoading} onSelect={setSelected} />
                    )}
                </main>
            </div>
            </>
            )}

            {selected && <PkgDrawer row={selected} onClose={() => setSelected(null)} />}
        </div>
    )
}

function PkgTable({ rows, total, pageSize, onPageSize, loading, onSelect }: { rows: any[]; total: number; pageSize: number; onPageSize: (n: number) => void; loading: boolean; onSelect: (r: any) => void }) {
    if (loading) return <Skel />
    if (rows.length === 0) return <Empty />
    return (
        <WorkspaceSection title="Packaging items" eyebrow={`${rows.length} of ${total}`} tone="amber" icon={<Package className="h-4 w-4" />}>
            <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                    <thead className="bg-slate-50/40 border-b border-slate-200 text-slate-500">
                        <tr>
                            <th className="px-3 py-2 text-left font-bold uppercase tracking-wider">Code</th>
                            <th className="px-3 py-2 text-left font-bold uppercase tracking-wider">Name</th>
                            <th className="px-3 py-2 text-left font-bold uppercase tracking-wider">Kind</th>
                            <th className="px-3 py-2 text-left font-bold uppercase tracking-wider">Plant · Location</th>
                            <th className="px-3 py-2 text-right font-bold uppercase tracking-wider">On hand</th>
                            <th className="px-3 py-2 text-right font-bold uppercase tracking-wider">Reserved</th>
                            <th className="px-3 py-2 text-left font-bold uppercase tracking-wider">Health</th>
                            <th className="px-3 py-2 text-right font-bold uppercase tracking-wider">Action</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {rows.map((r: any, i: number) => {
                            const qty = Number(r.qty || r.on_hand || 0)
                            const reserved = Number(r.reserved_qty || 0)
                            const uom = qtyUom(r)
                            const k = detectKind(r)
                            const h = healthOf(r)
                            return (
                                <tr key={r.id || i} onClick={() => onSelect(r)} className="hover:bg-amber-50/30 cursor-pointer">
                                    <td className="px-3 py-2 font-mono font-bold text-slate-900">{r.code || r.material_code || "—"}</td>
                                    <td className="px-3 py-2 text-[11px] text-slate-700 max-w-[220px] truncate">{r.name || r.material_name || "—"}</td>
                                    <td className="px-3 py-2"><span className="inline-flex items-center gap-1 rounded-md bg-warning-bg px-1.5 py-0.5 text-[10px] font-bold text-warning-fg ring-1 ring-amber-200">{KIND_ICON[k]} {k.replace("_", " ")}</span></td>
                                    <td className="px-3 py-2 text-[11px]">
                                        <div className="font-bold text-slate-700">{r.plant_name || "—"}</div>
                                        <div className="font-mono text-[10px] text-slate-500">{r.location_code || r.location_name || "—"}</div>
                                    </td>
                                    <td className="px-3 py-2 text-right font-mono font-bold text-slate-900">{fmtQty(qty, uom)} <span className="text-[10px] text-slate-500">{uom}</span></td>
                                    <td className="px-3 py-2 text-right font-mono font-bold text-violet-700">{fmtQty(reserved, uom)}</td>
                                    <td className="px-3 py-2">
                                        <div className="flex items-center gap-2">
                                            <div className="h-1.5 w-14 rounded-full bg-slate-200 overflow-hidden">
                                                <div className={cn("h-full", h.bucket === "HEALTHY" ? "bg-emerald-500" : h.bucket === "LOW" ? "bg-amber-500" : "bg-rose-500")} style={{ width: `${h.score}%` }} />
                                            </div>
                                            <span className={cn("rounded-md px-1.5 py-0.5 text-[10px] font-bold", h.bucket === "HEALTHY" ? "bg-success-bg text-success-fg" : h.bucket === "LOW" ? "bg-warning-bg text-warning-fg" : "bg-danger-bg text-danger-fg")}>{h.bucket}</span>
                                        </div>
                                    </td>
                                    <td className="px-3 py-2 text-right">
                                        <button onClick={(e) => { e.stopPropagation(); onSelect(r) }} className="inline-flex items-center gap-0.5 rounded-md bg-warning-bg px-1.5 py-0.5 text-[10px] font-bold text-warning-fg ring-1 ring-amber-200 hover:bg-amber-100">
                                            <Eye className="h-3 w-3" /> View
                                        </button>
                                    </td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            </div>
            <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/40 px-5 py-2 text-[11px]">
                <span className="text-slate-500">Showing {rows.length} of {total}</span>
                <select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))} className="rounded-md border border-slate-200 bg-surface-1 px-2 py-0.5 font-mono text-[11px]">
                    {[25, 50, 100, 250].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
            </div>
        </WorkspaceSection>
    )
}

function PkgGrid({ rows, total, pageSize, onPageSize, loading, onSelect }: { rows: any[]; total: number; pageSize: number; onPageSize: (n: number) => void; loading: boolean; onSelect: (r: any) => void }) {
    if (loading) return <Skel />
    if (rows.length === 0) return <Empty />
    return (
        <WorkspaceSection title="Packaging cards" eyebrow={`${rows.length} of ${total}`} tone="amber" icon={<Package className="h-4 w-4" />}>
            <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {rows.map((r: any) => {
                    const qty = Number(r.qty || r.on_hand || 0)
                    const uom = qtyUom(r)
                    const k = detectKind(r)
                    const h = healthOf(r)
                    return (
                        <button key={r.id} onClick={() => onSelect(r)} className="text-left rounded-2xl border border-slate-200 bg-surface-1 p-3 shadow-sm hover:shadow-lg hover:border-amber-300">
                            <div className="flex items-start justify-between gap-2">
                                <span className="text-2xl">{KIND_ICON[k]}</span>
                                <span className={cn("rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase", h.bucket === "HEALTHY" ? "bg-emerald-100 text-success-fg" : h.bucket === "LOW" ? "bg-amber-100 text-warning-fg" : "bg-rose-100 text-danger-fg")}>{h.bucket}</span>
                            </div>
                            <div className="mt-2 font-mono text-xs font-bold text-slate-900 truncate">{r.code || r.material_code || "—"}</div>
                            <div className="text-[10px] text-slate-500 truncate">{r.name || r.material_name || ""}</div>
                            <div className="mt-2 font-display text-lg font-black text-slate-900">{fmtQty(qty, uom)}</div>
                            <div className="text-[10px] text-slate-500">{uom} · {r.location_code || "—"}</div>
                        </button>
                    )
                })}
            </div>
            <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/40 px-5 py-2 text-[11px]">
                <span className="text-slate-500">Showing {rows.length} of {total}</span>
                <select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))} className="rounded-md border border-slate-200 bg-surface-1 px-2 py-0.5 font-mono text-[11px]">
                    {[24, 48, 96, 200].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
            </div>
        </WorkspaceSection>
    )
}

function PkgDrawer({ row, onClose }: { row: any; onClose: () => void }) {
    const qty = Number(row.qty || row.on_hand || 0)
    const reserved = Number(row.reserved_qty || 0)
    const available = Math.max(0, qty - reserved)
    const uom = qtyUom(row)
    const k = detectKind(row)
    const rsvQuery = useQuery({
        queryKey: ["inv-reservations-pkg", row.id],
        queryFn: () => inventoryService.getInventoryReservations({ ref_id: row.id, ref_type: "PACKAGING" }),
        enabled: Boolean(row.id),
        staleTime: 30_000,
    })
    return (
        <div className="fixed inset-0 z-40 flex justify-end" onClick={onClose}>
            <div className="absolute inset-0 bg-black/40" />
            <div className="relative z-50 h-full w-full max-w-md overflow-y-auto border-l border-slate-200 bg-surface-1 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="sticky top-0 z-10 border-b border-slate-100 bg-gradient-to-r from-amber-50 via-white to-white px-5 py-4">
                    <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-warning-fg">Packaging item · {KIND_ICON[k]} {k.replace("_", " ")}</div>
                            <div className="font-mono font-display text-lg font-bold text-slate-900 truncate">{row.code || row.material_code || "—"}</div>
                            <div className="text-[11px] text-slate-500 truncate">{row.name || row.material_name || ""}</div>
                        </div>
                        <button onClick={onClose} className="rounded-lg p-1 hover:bg-slate-100"><X className="h-4 w-4 text-slate-500" /></button>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
                        <Stat label="On hand" value={`${fmtQty(qty, uom)} ${uom}`} />
                        <Stat label="Reserved" value={`${fmtQty(reserved, uom)} ${uom}`} tone="violet" />
                        <Stat label="Available" value={`${fmtQty(available, uom)} ${uom}`} tone="emerald" />
                    </div>
                </div>
                <div className="px-5 py-4 space-y-4">
                    <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500 mb-2">Specs</div>
                        <div className="grid grid-cols-2 gap-2 text-[11px]">
                            <Field label="Kind" value={String(row.packaging_kind || k)} />
                            <Field label="Pcs / pack" value={row.pcs_per_pack || "—"} />
                            <Field label="Color" value={row.color_variant || "—"} />
                            <Field label="UOM" value={uom} />
                            <Field label="Plant" value={row.plant_name || "—"} icon={<Factory className="h-3 w-3 text-amber-500" />} />
                            <Field label="Location" value={row.location_code || row.location_name || "—"} icon={<MapPin className="h-3 w-3 text-amber-500" />} />
                            <Field label="Supply mode" value={row.supply_mode || "—"} />
                            <Field label="Reorder pt" value={row.reorder_point || "—"} />
                        </div>
                    </div>
                    <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-violet-700 mb-2">SO holds</div>
                        {rsvQuery.isLoading && <div className="text-xs text-content-4 italic">Loading…</div>}
                        {!rsvQuery.isLoading && (rsvQuery.data || []).length === 0 && <div className="text-xs text-content-4 italic">No active reservations.</div>}
                        {(rsvQuery.data || []).map((r: any, i: number) => (
                            <div key={i} className="rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2 mb-1.5">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="font-mono text-[11px] font-bold text-violet-800">{r.so_no || r.so_id || "—"}</span>
                                    <span className="font-mono text-[11px] font-bold text-slate-700">{fmtQty(Number(r.qty || 0), r.uom || uom)} {r.uom || uom}</span>
                                </div>
                                <div className="text-[10px] text-slate-500 mt-0.5">{r.customer_name || ""} · promise {r.promise_date || "—"}</div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    )
}

function Stat({ label, value, tone = "slate" }: { label: string; value: string; tone?: "slate" | "violet" | "emerald" }) {
    const TONE = { slate: "bg-slate-50 text-slate-900 ring-slate-200", violet: "bg-violet-50 text-violet-900 ring-violet-200", emerald: "bg-success-bg text-emerald-900 ring-emerald-200" }[tone]
    return (
        <div className={cn("rounded-lg px-2.5 py-1.5 ring-1", TONE)}>
            <div className="text-[9px] font-black uppercase tracking-wider opacity-70">{label}</div>
            <div className="mt-0.5 font-display text-sm font-bold">{value}</div>
        </div>
    )
}

function Field({ label, value, icon }: { label: string; value: any; icon?: React.ReactNode }) {
    return (
        <div className="rounded-lg bg-slate-50/60 px-2.5 py-1.5 ring-1 ring-slate-100">
            <div className="text-[9px] font-black uppercase tracking-wider text-slate-500">{label}</div>
            <div className="mt-0.5 flex items-center gap-1 text-xs font-bold text-content-2 truncate">{icon}{value || "—"}</div>
        </div>
    )
}

function Skel() {
    return <div className="rounded-2xl border border-slate-200 bg-surface-1 p-5 shadow-sm"><div className="h-4 w-40 animate-pulse rounded bg-slate-200" /><div className="mt-3 h-32 animate-pulse rounded-xl bg-slate-100" /></div>
}

function Empty() {
    return (
        <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-surface-1 p-10 text-center">
            <Boxes className="mx-auto h-8 w-8 text-slate-300" />
            <div className="mt-2 text-sm font-semibold text-slate-700">No packaging items match these filters</div>
            <div className="mt-1 text-xs text-slate-500">Adjust filters or clear search.</div>
        </div>
    )
}

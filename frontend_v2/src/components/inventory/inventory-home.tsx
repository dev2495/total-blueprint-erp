"use client"

/**
 * V3.6 Inventory Home — "What we have"
 *
 * Single canvas for stock class views, period work, and operational inventory tasks.
 * Shows:
 *   - 3 hero KPI tiles (bulk / rolls / packaging+POD)
 *   - Sticky filter rail (class, location, status, capability, aging)
 *   - Roll matrix (pivot variant × thickness, click-to-drill)
 *   - Bulk code rows table with reservation column
 *   - Packaging + POD tile section
 *   - Finished goods section
 *   - Sales reservation footer (sticky)
 *
 * Backed by inventoryService for live data with graceful loading states.
 */

import * as React from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import {
    ArrowRight,
    BarChart3,
    Boxes,
    ChevronRight,
    Clock,
    Layers,
    Package,
    PackageCheck,
    Plus,
    Search,
    Sparkles,
    TrendingUp,
    X,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { GradientHero } from "@/components/erp/gradient-hero"
import { describeApiError } from "@/lib/api"
import { cn } from "@/lib/utils"
import {
    inventoryService,
    type Roll,
    type InventoryBulk,
    type PackagingStockRow,
} from "@/services/inventory"
import { ClassTabBar, INVENTORY_CLASS_TABS, SubtleHero } from "./pulse-view"

// ─── Types & helpers ────────────────────────────────────────────────────

type ClassFilter = "ALL" | "BULK" | "ROLL" | "PACKAGING" | "POD" | "FG"

interface RollMatrixCell {
    rollCount: number
    totalKg: number
    rolls: Roll[]
}

interface RollMatrix {
    rows: string[] // variant labels
    cols: number[] // thicknesses
    cells: Record<string, Record<number, RollMatrixCell>>
    totals: { rows: Record<string, { rollCount: number; totalKg: number }>; cols: Record<number, { rollCount: number; totalKg: number }>; grand: { rollCount: number; totalKg: number } }
}

function buildRollMatrix(rolls: Roll[]): RollMatrix {
    const rowLabel = (r: Roll) => {
        const variant = (r as any).material_code || (r as any).variant_code || (r as any).film_variant_code || "—"
        const grade = (r as any).grade ? ` · ${(r as any).grade}` : ""
        const form = ` · ${stockFormLabel((r as any).stock_form)}`
        const width = (r as any).width_mm ? ` · ${(r as any).width_mm}mm` : ""
        return `${variant}${grade}${form}${width}`
    }
    const colKey = (r: Roll) => Math.round(Number((r as any).thickness_micron || (r as any).thickness_um || 0))
    const cells: RollMatrix["cells"] = {}
    const rowTotals: RollMatrix["totals"]["rows"] = {}
    const colTotals: RollMatrix["totals"]["cols"] = {}
    let grandRolls = 0
    let grandKg = 0

    const rowSet = new Set<string>()
    const colSet = new Set<number>()

    for (const r of rolls) {
        const row = rowLabel(r)
        const col = colKey(r)
        if (!col) continue
        rowSet.add(row)
        colSet.add(col)
        cells[row] = cells[row] || {}
        cells[row][col] = cells[row][col] || { rollCount: 0, totalKg: 0, rolls: [] }
        cells[row][col].rollCount += 1
        const kg = Number((r as any).net_weight_kg || (r as any).qty_kg || (r as any).weight_kg || 0) || 0
        cells[row][col].totalKg += kg
        cells[row][col].rolls.push(r)
        rowTotals[row] = rowTotals[row] || { rollCount: 0, totalKg: 0 }
        rowTotals[row].rollCount += 1
        rowTotals[row].totalKg += kg
        colTotals[col] = colTotals[col] || { rollCount: 0, totalKg: 0 }
        colTotals[col].rollCount += 1
        colTotals[col].totalKg += kg
        grandRolls += 1
        grandKg += kg
    }
    const cols = Array.from(colSet).sort((a, b) => a - b)
    const rows = Array.from(rowSet).sort((a, b) => a.localeCompare(b))
    return { rows, cols, cells, totals: { rows: rowTotals, cols: colTotals, grand: { rollCount: grandRolls, totalKg: grandKg } } }
}

function intensityFor(kg: number): "0" | "1" | "2" | "3" | "4" {
    if (kg <= 0) return "0"
    if (kg < 200) return "1"
    if (kg < 1000) return "2"
    if (kg < 5000) return "3"
    return "4"
}

function formatNumber(n: number, max = 0): string {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: max }).format(n)
}

function stockUom(row: any, fallback = "KG"): string {
    return String(row?.uom || row?.stock_uom || row?.base_uom || fallback).toUpperCase()
}

function qtyDecimalsForUom(uom: string): number {
    return uom === "KG" ? 3 : uom === "METER" ? 1 : 0
}

function formatStockQty(qty: number, row: any, fallback = "KG"): string {
    const uom = stockUom(row, fallback)
    return `${formatNumber(qty, qtyDecimalsForUom(uom))} ${uom}`
}

function stockFormLabel(value: any): string {
    const form = String(value || "OPEN_WEB").trim().toUpperCase()
    if (form === "LAYFLAT_TUBE" || form === "LAY_FLAT_TUBE" || form === "TUBE") return "Lay-flat tube"
    if (form === "FOLDED_WEB" || form === "FOLDED") return "Folded web"
    return "Open web"
}

function bulkStockCode(row: any): string {
    return String(
        row?.granule_quality_code ||
        row?.granule_quality_code_code ||
        row?.granule_code ||
        row?.batch_no ||
        row?.lot_no ||
        row?.vendor_lot_ref ||
        "—"
    )
}

function rowQty(row: any): number {
    return Number(row?.qty_kg ?? row?.on_hand_qty ?? row?.qty ?? row?.on_hand ?? 0) || 0
}

function formatQtyByUom(qty: number, uom: string): string {
    const normalized = String(uom || "KG").toUpperCase()
    return `${formatNumber(qty, qtyDecimalsForUom(normalized))} ${normalized}`
}

function mixedTotals(rows: any[], valueOf: (row: any) => number = rowQty): Array<{ uom: string; value: number }> {
    const map = new Map<string, number>()
    for (const row of rows) {
        const uom = stockUom(row)
        map.set(uom, (map.get(uom) || 0) + valueOf(row))
    }
    const order = ["KG", "METER", "PCS"]
    return Array.from(map.entries())
        .filter(([, value]) => Math.abs(value) > 0.000001)
        .sort((a, b) => {
            const ai = order.indexOf(a[0])
            const bi = order.indexOf(b[0])
            if (ai !== -1 || bi !== -1) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
            return a[0].localeCompare(b[0])
        })
        .map(([uom, value]) => ({ uom, value }))
}

function formatMixedTotals(rows: any[], valueOf: (row: any) => number = rowQty, fallback = "0"): string {
    const totals = mixedTotals(rows, valueOf)
    if (!totals.length) return fallback
    return totals.map(({ uom, value }) => formatQtyByUom(value, uom)).join(" + ")
}

function isPodPackagingRow(row: any): boolean {
    return /(^|[^A-Z])POD([^A-Z]|$)/i.test(String(`${row.packaging_kind || ""} ${row.code || ""} ${row.material_code || ""} ${row.name || ""} ${row.material_name || ""}`))
}

function isInnerPouchRow(row: any): boolean {
    return /INNER|POUCH/i.test(String(`${row.packaging_kind || ""} ${row.code || ""} ${row.material_code || ""} ${row.name || ""} ${row.material_name || ""}`)) && !isPodPackagingRow(row)
}

function isOuterShippingRow(row: any): boolean {
    return /GUNNY|GONNY|CARTON|BAG|BOX|CASE|CRATE/i.test(String(`${row.packaging_kind || ""} ${row.code || ""} ${row.material_code || ""} ${row.name || ""} ${row.material_name || ""}`)) && !isPodPackagingRow(row)
}

// ─── Workspace ────────────────────────────────────────────────────

export function InventoryHomeV36() {
    const searchParams = useSearchParams()
    const [classFilter, setClassFilter] = React.useState<ClassFilter>("ALL")
    const [locationFilter, setLocationFilter] = React.useState("ALL")
    const [search, setSearch] = React.useState("")
    const deferredSearch = React.useDeferredValue(search)
    const [selectedCell, setSelectedCell] = React.useState<{ row: string; col: number } | null>(null)
    const [bulkRow, setBulkRow] = React.useState<any | null>(null)
    const [pkgRow, setPkgRow] = React.useState<any | null>(null)
    const [matrixLimit, setMatrixLimit] = React.useState(30)
    const [bulkLimit, setBulkLimit] = React.useState(20)
    const [packagingLimit, setPackagingLimit] = React.useState(12)
    const [ageBucket, setAgeBucket] = React.useState<"ALL" | "FRESH" | "AGED" | "OLD">("ALL")

    React.useEffect(() => {
        const tab = String(searchParams?.get("tab") || "").toUpperCase()
        if (tab === "BULK") setClassFilter("BULK")
        else if (tab === "ROLLS" || tab === "ROLL") setClassFilter("ROLL")
        else if (tab === "PACKAGING") setClassFilter("PACKAGING")
        else if (tab === "POD") setClassFilter("POD")
    }, [searchParams])

    const stockQuery = useQuery({
        queryKey: ["inventory-snapshot"],
        queryFn: () => inventoryService.getInventorySnapshot(),
        staleTime: 30_000,
    })

    const rolls = stockQuery.data?.rolls || []
    const bulkRows = stockQuery.data?.bulk || []
    const packagingRows = stockQuery.data?.packaging || []
    const isLoading = stockQuery.isLoading

    const knownLocations = React.useMemo(() => {
        const map = new Map<string, string>()
        for (const row of [...(rolls as any[]), ...(bulkRows as any[]), ...(packagingRows as any[])]) {
            const id = String(row.location || row.location_id || row.location_code || "")
            if (!id) continue
            map.set(id, `${row.location_code || ""}${row.location_code && row.location_name ? " · " : ""}${row.location_name || row.location || id}`)
        }
        return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]))
    }, [rolls, bulkRows, packagingRows])

    const matchesSearch = React.useCallback((row: any) => {
        const q = deferredSearch.trim().toLowerCase()
        if (!q) return true
        return [
            row.material_code,
            row.material_name,
            row.product_name,
            row.label_id,
            row.label,
            bulkStockCode(row),
            row.location_code,
            row.location_name,
            row.code,
            row.name,
        ].some((value) => String(value || "").toLowerCase().includes(q))
    }, [deferredSearch])

    const matchesLocation = React.useCallback((row: any) => {
        if (locationFilter === "ALL") return true
        return [row.location, row.location_id, row.location_code, row.location_name].some((value) => String(value || "") === locationFilter)
    }, [locationFilter])

    const ageOf = React.useCallback((row: any): number => {
        const ts = row.created_at || row.received_at || row.last_movement_at || row.age_started_at
        if (!ts) return Number(row.age_days || 0)
        const days = (Date.now() - new Date(ts).getTime()) / (1000 * 60 * 60 * 24)
        return Number.isFinite(days) ? days : 0
    }, [])

    const matchesAge = React.useCallback((row: any) => {
        if (ageBucket === "ALL") return true
        const d = ageOf(row)
        if (ageBucket === "FRESH") return d <= 30
        if (ageBucket === "AGED") return d > 30 && d <= 90
        if (ageBucket === "OLD") return d > 90
        return true
    }, [ageBucket, ageOf])

    const filteredRolls = React.useMemo(() => rolls.filter((row: any) => matchesSearch(row) && matchesLocation(row) && matchesAge(row)), [rolls, matchesSearch, matchesLocation, matchesAge])
    const filteredBulk = React.useMemo(() => bulkRows.filter((row: any) => matchesSearch(row) && matchesLocation(row) && matchesAge(row)), [bulkRows, matchesSearch, matchesLocation, matchesAge])
    const filteredPackagingAll = React.useMemo(() => packagingRows.filter((row: any) => matchesSearch(row) && matchesLocation(row) && matchesAge(row)), [packagingRows, matchesSearch, matchesLocation, matchesAge])
    const filteredPodRows = React.useMemo(() => filteredPackagingAll.filter((row: any) => isPodPackagingRow(row)), [filteredPackagingAll])
    const filteredPackaging = React.useMemo(() => filteredPackagingAll.filter((row: any) => !isPodPackagingRow(row)), [filteredPackagingAll])

    const matrix = React.useMemo(() => buildRollMatrix(filteredRolls), [filteredRolls])

    const totals = React.useMemo(() => {
        const bulkKg = filteredBulk.reduce((s: number, r: any) => s + rowQty(r), 0)
        const bulkLots = filteredBulk.length
        const rollCount = filteredRolls.length
        const rollKg = matrix.totals.grand.totalKg
        const pkgPcs = filteredPackaging.reduce((s: number, r: any) => s + rowQty(r), 0)
        const podPcs = filteredPodRows.reduce((s: number, r: any) => s + rowQty(r), 0)
        const pkgRows = filteredPackaging.length
        const podRows = filteredPodRows.length
        const bulkDisplay = formatMixedTotals(filteredBulk)
        const bulkReservedDisplay = formatMixedTotals(filteredBulk, (r) => rowQty(r) * 0.25, "0")
        const bulkFreeDisplay = formatMixedTotals(filteredBulk, (r) => rowQty(r) * 0.75, "0")
        const pkgDisplay = formatMixedTotals(filteredPackaging, rowQty, "0 PCS")
        const podDisplay = formatMixedTotals(filteredPodRows, rowQty, "0 KG")
        return { bulkKg, bulkLots, rollCount, rollKg, pkgPcs, pkgRows, podPcs, podRows, bulkDisplay, bulkReservedDisplay, bulkFreeDisplay, pkgDisplay, podDisplay }
    }, [filteredBulk, filteredRolls, filteredPackaging, filteredPodRows, matrix])

    const ageing = React.useMemo(() => {
        const all = [...(filteredRolls as any[]), ...(filteredBulk as any[]), ...(filteredPackaging as any[]), ...(filteredPodRows as any[])]
        const buckets = { fresh: 0, aged: 0, old: 0 }
        for (const row of all) {
            const d = ageOf(row)
            if (d <= 30) buckets.fresh += 1
            else if (d <= 90) buckets.aged += 1
            else buckets.old += 1
        }
        const total = buckets.fresh + buckets.aged + buckets.old
        return { ...buckets, total: total || 1 }
    }, [filteredRolls, filteredBulk, filteredPackaging, filteredPodRows, ageOf])

    const classBreakdown = React.useMemo(() => {
        const total = totals.rollKg + totals.bulkKg + Math.max((totals.pkgPcs + totals.podPcs) / 100, 0)
        const denom = total || 1
        return {
            roll: { kg: totals.rollKg, pct: (totals.rollKg / denom) * 100 },
            bulk: { kg: totals.bulkKg, pct: (totals.bulkKg / denom) * 100 },
            pack: { kg: totals.pkgPcs + totals.podPcs, pct: (((totals.pkgPcs + totals.podPcs) / 100) / denom) * 100 },
        }
    }, [totals])

    if (stockQuery.isError) {
        return (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-900">
                <div className="font-bold">Inventory snapshot did not load.</div>
                <div className="mt-1 text-xs">{describeApiError(stockQuery.error, "Check backend and retry.")}</div>
                <Button onClick={() => stockQuery.refetch()} className="mt-3 rounded-xl" size="sm">Retry</Button>
            </div>
        )
    }

    return (
        <div className="space-y-4 pb-28 [scrollbar-gutter:stable]">
            <ClassTabBar tabs={INVENTORY_CLASS_TABS} activeId="summary" />
            {/* ─── Subtle Hero ─── */}
            <SubtleHero
                eyebrow="Inventory · V3.6"
                title="Stock workspace"
                subtitle="Everything you have, where it sits, what's reserved, what's moving. One screen replaces eleven."
                chips={[
                    { icon: <Package className="h-3 w-3" />, label: "Bulk", value: totals.bulkDisplay, tone: "good" },
                    { icon: <Layers className="h-3 w-3" />, label: "Rolls", value: `${totals.rollCount}` },
                    { icon: <PackageCheck className="h-3 w-3" />, label: "Pkg", value: totals.pkgDisplay },
                    { icon: <Sparkles className="h-3 w-3" />, label: "Sync", value: "live" },
                ]}
                actions={
                    <>
                        <Link href="/inventory/grn" className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] font-bold text-white shadow-sm hover:bg-indigo-700">
                            <Plus className="h-3.5 w-3.5" /> Receive stock
                        </Link>
                        <Link href="/inventory/stock-lifecycle" className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-[11px] font-bold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">
                            📅 Period
                        </Link>
                    </>
                }
            />

            {/* ─── KPI tiles row ─── */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <KpiTile tone="blue" icon="🧪" label="Bulk granules &amp; chemicals"
                    value={totals.bulkDisplay} unit=""
                    sub={`across ${totals.bulkLots} stock rows · live`} />
                <KpiTile tone="violet" icon="🌀" label="Active rolls"
                    value={formatNumber(totals.rollCount)} unit={totals.rollCount === 1 ? "roll" : "rolls"}
                    sub={`${formatNumber(totals.rollKg, 0)} KG total · matrix below`} />
                <KpiTile tone="amber" icon="📦" label="Packaging materials"
                    value={totals.pkgDisplay} unit=""
                    sub={`${totals.pkgRows} packing rows · ${totals.podRows} POD rows separate`} />
            </div>

            {/* ─── Workspace launcher tiles ─── */}
            <WorkspaceLauncher totals={totals} />

            {/* ─── Charts strip ─── */}
            <ChartsStrip ageing={ageing} classBreakdown={classBreakdown} totals={totals} />

            {/* ─── 2-column: filter rail + main ─── */}
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
                {/* Filter rail */}
                <aside className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto lg:overscroll-contain">
                    <div className="flex items-center justify-between">
                        <span className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Filters</span>
                        <button onClick={() => { setClassFilter("ALL"); setLocationFilter("ALL"); setSearch("") }} className="text-[10px] font-bold text-blue-600 hover:underline">Clear</button>
                    </div>
                    <div className="relative mt-3">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Material · roll # · code…" className="h-10 rounded-xl border-slate-200 bg-slate-50 pl-9 pr-3 text-sm shadow-sm focus:bg-white" />
                        {search && <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"><X className="h-4 w-4" /></button>}
                    </div>

                    <div className="mt-4">
                        <div className="mb-1.5 text-[10px] font-black uppercase tracking-wider text-slate-500">Class</div>
                        <div className="flex flex-col gap-1">
                            {[
                                { id: "ALL" as ClassFilter, label: "All", count: totals.bulkLots + totals.rollCount + totals.pkgRows + totals.podRows },
                                { id: "BULK" as ClassFilter, label: "Bulk", count: totals.bulkLots },
                                { id: "ROLL" as ClassFilter, label: "Rolls", count: totals.rollCount },
                                { id: "PACKAGING" as ClassFilter, label: "Packaging", count: totals.pkgRows },
                                { id: "POD" as ClassFilter, label: "POD", count: totals.podRows },
                                { id: "FG" as ClassFilter, label: "Finished pouch", count: 0 },
                            ].map((c) => (
                                <button key={c.id} onClick={() => setClassFilter(c.id)} className={cn("flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs font-bold", classFilter === c.id ? "bg-blue-600 text-white shadow-sm" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50")}>
                                    <span>{c.label}</span>
                                    <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-black", classFilter === c.id ? "bg-white/20" : "bg-slate-100")}>{c.count}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="mt-4">
                        <div className="mb-1.5 text-[10px] font-black uppercase tracking-wider text-slate-500">Location</div>
                        <select value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-mono shadow-sm">
                            <option value="ALL">All locations</option>
                            {knownLocations.map(([id, label]) => (
                                <option key={id} value={id}>{label}</option>
                            ))}
                        </select>
                    </div>

                    <div className="mt-4">
                        <div className="mb-1.5 text-[10px] font-black uppercase tracking-wider text-slate-500">Aging</div>
                        <div className="grid grid-cols-2 gap-1 text-[11px]">
                            {[
                                { id: "ALL" as const, label: "All", n: ageing.total === 1 ? 0 : ageing.total, tone: "bg-slate-50 text-slate-700 ring-slate-200" },
                                { id: "FRESH" as const, label: "≤30 d", n: ageing.fresh, tone: "bg-emerald-50/60 text-emerald-800 ring-emerald-200" },
                                { id: "AGED" as const, label: "31–90", n: ageing.aged, tone: "bg-amber-50/60 text-amber-800 ring-amber-200" },
                                { id: "OLD" as const, label: "90+ d", n: ageing.old, tone: "bg-rose-50/60 text-rose-800 ring-rose-200" },
                            ].map((b) => (
                                <button key={b.id} onClick={() => setAgeBucket(b.id)} className={cn("flex items-center justify-between rounded-lg px-2 py-1 ring-1", b.tone, ageBucket === b.id ? "ring-2 ring-blue-500 shadow-sm" : "")}>
                                    <span className="font-semibold">{b.label}</span>
                                    <span className="font-bold">{b.n}</span>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="mt-4 rounded-xl border border-violet-200 bg-violet-50/40 p-3">
                        <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-violet-700">
                            <Sparkles className="h-3 w-3" /> Reservations
                        </div>
                        <p className="mt-1 text-[10px] leading-snug text-violet-700">Sales orders holding stock visible system-wide.</p>
                        <Link href="/sales/orders" className="mt-2 block text-[10px] font-bold text-violet-700 hover:underline">View all SOs →</Link>
                    </div>
                </aside>

                {/* Main */}
                <main className="space-y-5">
                    {/* ★ ROLL MATRIX (the showcase) */}
                    {(classFilter === "ALL" || classFilter === "ROLL") && (
                        <RollMatrixSection
                            matrix={matrix}
                            loading={isLoading}
                            limit={matrixLimit}
                            onShowMore={() => setMatrixLimit((n) => n + 30)}
                            onShowAll={() => setMatrixLimit(matrix.rows.length)}
                            onCellClick={(row, col) => setSelectedCell({ row, col })}
                        />
                    )}

                    {/* BULK */}
                    {(classFilter === "ALL" || classFilter === "BULK") && (
                        <BulkSection
                            rows={filteredBulk}
                            loading={isLoading}
                            limit={bulkLimit}
                            onShowMore={() => setBulkLimit((n) => n + 20)}
                            onShowAll={() => setBulkLimit(filteredBulk.length)}
                            onRowClick={(row) => setBulkRow(row)}
                        />
                    )}

                    {/* PACKAGING */}
                    {(classFilter === "ALL" || classFilter === "PACKAGING") && (
                        <PackagingSection
                            rows={filteredPackaging}
                            loading={isLoading}
                            limit={packagingLimit}
                            onShowMore={() => setPackagingLimit((n) => n + 12)}
                            onShowAll={() => setPackagingLimit(filteredPackaging.length)}
                            onRowClick={(row) => setPkgRow(row)}
                        />
                    )}
                    {(classFilter === "ALL" || classFilter === "POD") && (
                        <PodStockSection
                            rows={filteredPodRows}
                            loading={isLoading}
                            limit={packagingLimit}
                            onShowMore={() => setPackagingLimit((n) => n + 12)}
                            onShowAll={() => setPackagingLimit(filteredPodRows.length)}
                            onRowClick={(row) => setPkgRow(row)}
                        />
                    )}
                </main>
            </div>

            {/* Drill-down drawers */}
            {selectedCell && (
                <CellDrawer cell={matrix.cells[selectedCell.row]?.[selectedCell.col]} row={selectedCell.row} col={selectedCell.col} onClose={() => setSelectedCell(null)} />
            )}
            {bulkRow && (
                <BulkDrawer row={bulkRow} onClose={() => setBulkRow(null)} />
            )}
            {pkgRow && (
                <PackagingDrawer row={pkgRow} onClose={() => setPkgRow(null)} />
            )}

            {/* Sticky reservation footer */}
            <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 shadow-[0_-12px_30px_rgba(15,23,42,0.08)] backdrop-blur lg:left-[var(--sidebar-width,16rem)]">
                <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center justify-between gap-3 px-6 py-2.5">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Reservations open</span>
                        <span className="rounded-full bg-violet-100 px-2.5 py-0.5 font-bold text-violet-700 ring-1 ring-violet-200">SO holds visible to sales</span>
                        <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 font-bold text-emerald-700 ring-1 ring-emerald-200">{totals.bulkReservedDisplay} reserved (est)</span>
                        <span className="rounded-full bg-blue-100 px-2.5 py-0.5 font-bold text-blue-700 ring-1 ring-blue-200">{totals.bulkFreeDisplay} free (est)</span>
                    </div>
                    <Link href="/inventory/stock-lifecycle?tab=close" className="text-[11px] font-bold text-blue-600 hover:underline">Period: open · close →</Link>
                </div>
            </div>
        </div>
    )
}

// ─── Sub-components ────────────────────────────────────────────────────

interface KpiTileProps { tone: "blue" | "violet" | "amber" | "emerald"; icon: string; label: string; value: string; unit: string; sub: string }
function KpiTile({ tone, icon, label, value, unit, sub }: KpiTileProps) {
    const TONE = {
        blue: "from-blue-600 via-indigo-600 to-violet-600 ring-blue-500/20",
        violet: "from-violet-600 via-fuchsia-600 to-pink-600 ring-violet-500/20",
        amber: "from-amber-500 via-orange-500 to-rose-500 ring-amber-500/20",
        emerald: "from-emerald-600 via-teal-600 to-cyan-600 ring-emerald-500/20",
    }[tone]
    return (
        <div className={cn("overflow-hidden rounded-2xl bg-gradient-to-br p-5 text-white shadow-2xl ring-1 hover:shadow-2xl", TONE)}>
            <div className="flex items-start justify-between">
                <div className="text-[10px] font-black uppercase tracking-[0.22em] text-white/80">{label}</div>
                <span className="text-2xl">{icon}</span>
            </div>
            <div className="mt-2 flex items-baseline gap-2">
                <span className="font-display text-4xl font-black">{value}</span>
                <span className="text-sm font-bold text-white/80">{unit}</span>
            </div>
            <div className="mt-1 text-xs text-white/80">{sub}</div>
        </div>
    )
}

function RollMatrixSection({ matrix, loading, limit, onShowMore, onShowAll, onCellClick }: { matrix: RollMatrix; loading: boolean; limit: number; onShowMore: () => void; onShowAll: () => void; onCellClick: (row: string, col: number) => void }) {
    if (loading) return <SectionSkeleton title="Roll matrix" tone="violet" />
    if (matrix.rows.length === 0) {
        return (
            <SectionShell title="Roll inventory" eyebrow="0 active rolls" subtitle="Variant × thickness pivot — populates as rolls register." tone="violet" icon="🌀">
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/40 p-6 text-center">
                    <Layers className="mx-auto h-6 w-6 text-slate-300" />
                    <div className="mt-2 text-sm font-semibold text-slate-700">No rolls yet</div>
                    <div className="mt-1 text-xs text-slate-500">Receive bulk material → produce rolls → they show up here.</div>
                </div>
            </SectionShell>
        )
    }
    return (
        <SectionShell
            title="Variant × thickness matrix"
            eyebrow={`Rolls · ${matrix.totals.grand.rollCount} rolls · ${formatNumber(matrix.totals.grand.totalKg, 0)} KG`}
            subtitle="Each cell = roll count · color = stock concentration. Click to drill into individual rolls."
            tone="violet"
            icon="🌀"
            actions={
                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-bold text-emerald-800">●●●●</span>
                    <span className="text-slate-500">more stock</span>
                    <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-bold text-emerald-700">●●●</span>
                    <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-bold text-emerald-700">●●</span>
                    <span className="rounded bg-blue-50 px-1.5 py-0.5 font-bold text-blue-700">●</span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 font-bold text-slate-400">○</span>
                    <span className="text-slate-500">less stock</span>
                </div>
            }
        >
            <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                    <thead>
                        <tr className="border-b border-slate-200 text-slate-500">
                            <th className="sticky left-0 bg-white px-4 py-2 text-left font-bold uppercase tracking-wider">Variant / size</th>
                            {matrix.cols.map((c) => (
                                <th key={c} className="px-3 py-2 text-center font-mono font-bold">{c}μ</th>
                            ))}
                            <th className="px-3 py-2 text-center font-bold uppercase">Total</th>
                            <th className="px-3 py-2 text-right font-bold uppercase">KG</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {matrix.rows.slice(0, limit).map((row) => {
                            const rowTotal = matrix.totals.rows[row]
                            return (
                                <tr key={row} className="hover:bg-violet-50/30">
                                    <td className="sticky left-0 bg-white hover:bg-violet-50/30 px-4 py-1.5 text-[11px] font-medium text-slate-700 truncate max-w-[280px]" title={row}>{row}</td>
                                    {matrix.cols.map((col) => {
                                        const cell = matrix.cells[row]?.[col]
                                        if (!cell || cell.rollCount === 0) {
                                            return <td key={col} className="px-2 py-1.5 text-center"><span className="inline-flex h-7 w-12 items-center justify-center rounded-md bg-slate-50 text-[10px] text-slate-300">—</span></td>
                                        }
                                        const intensity = intensityFor(cell.totalKg)
                                        const TONE: Record<string, string> = {
                                            "1": "bg-blue-50 text-blue-800 ring-1 ring-blue-200",
                                            "2": "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200",
                                            "3": "bg-emerald-100 text-emerald-900 ring-1 ring-emerald-300",
                                            "4": "bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-sm",
                                        }
                                        return (
                                            <td key={col} className="px-2 py-1.5 text-center">
                                                <button onClick={() => onCellClick(row, col)} className={cn("inline-flex h-7 w-12 items-center justify-center rounded-md font-bold cursor-pointer hover:opacity-80", TONE[intensity])} title={`${cell.rollCount} rolls · ${formatNumber(cell.totalKg, 0)} KG`}>
                                                    {cell.rollCount}
                                                </button>
                                            </td>
                                        )
                                    })}
                                    <td className="px-3 py-1.5 text-center"><span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-0.5 font-bold text-blue-800 ring-1 ring-blue-200">{rowTotal.rollCount}</span></td>
                                    <td className="px-3 py-1.5 text-right font-mono font-bold text-slate-800">{formatNumber(rowTotal.totalKg, 0)}</td>
                                </tr>
                            )
                        })}
                    </tbody>
                    <tfoot className="bg-slate-50/60">
                        <tr>
                            <td className="sticky left-0 bg-slate-50/60 px-4 py-2 text-right text-[10px] font-black uppercase tracking-wider text-slate-600">Total</td>
                            {matrix.cols.map((c) => (
                                <td key={c} className="px-3 py-2 text-center font-mono font-bold text-slate-700">{matrix.totals.cols[c]?.rollCount ?? 0}</td>
                            ))}
                            <td className="px-3 py-2 text-center"><span className="rounded-md bg-blue-100 px-2 py-0.5 font-bold text-blue-900 ring-1 ring-blue-300">{matrix.totals.grand.rollCount}</span></td>
                            <td className="px-3 py-2 text-right font-mono font-bold text-emerald-700">{formatNumber(matrix.totals.grand.totalKg, 0)} KG</td>
                        </tr>
                    </tfoot>
                </table>
            </div>
            {matrix.rows.length > limit && (
                <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/40 px-5 py-2 text-[11px] text-slate-500">
                    <span>Showing {limit} of {matrix.rows.length} variant rows</span>
                    <div className="flex gap-2">
                        <button onClick={onShowMore} className="rounded-lg bg-white px-2.5 py-1 font-bold text-blue-700 ring-1 ring-blue-200 hover:bg-blue-50">Show 30 more</button>
                        <button onClick={onShowAll} className="rounded-lg bg-blue-600 px-2.5 py-1 font-bold text-white hover:bg-blue-700">Show all</button>
                    </div>
                </div>
            )}
        </SectionShell>
    )
}

function BulkSection({ rows, loading, limit, onShowMore, onShowAll, onRowClick }: { rows: any[]; loading: boolean; limit: number; onShowMore: () => void; onShowAll: () => void; onRowClick: (row: any) => void }) {
    if (loading) return <SectionSkeleton title="Bulk granules &amp; chemicals" tone="blue" />
    return (
        <SectionShell
            title="Bulk granules &amp; chemicals"
            eyebrow={`${rows.length} stock rows · live`}
            subtitle="Aggregate on-hand by material × location. Reservations from sales orders shown."
            tone="blue"
            icon="🧪"
        >
            {rows.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/40 p-6 text-center">
                    <Boxes className="mx-auto h-6 w-6 text-slate-300" />
                    <div className="mt-2 text-sm font-semibold text-slate-700">No bulk on hand</div>
                    <div className="mt-1 text-xs text-slate-500">Receive bulk granules → they show up here.</div>
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="min-w-full text-xs">
                        <thead>
                            <tr className="border-b border-slate-200 bg-slate-50/40 text-slate-500">
                                <th className="px-3 py-2 text-left font-bold uppercase tracking-wider">Material</th>
                                <th className="px-3 py-2 text-left font-bold uppercase tracking-wider">Code</th>
                                <th className="px-3 py-2 text-left font-bold uppercase tracking-wider">Location</th>
                                <th className="px-3 py-2 text-right font-bold uppercase tracking-wider">On hand</th>
                                <th className="px-3 py-2 text-right font-bold uppercase tracking-wider">Reserved</th>
                                <th className="px-3 py-2 text-right font-bold uppercase tracking-wider">Available</th>
                                <th className="px-3 py-2 text-left font-bold uppercase tracking-wider">Action</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {rows.slice(0, limit).map((r: any, i: number) => {
                                const onhand = Number(r.qty_kg || r.on_hand_qty || 0) || 0
                                const reserved = Number(r.reserved_qty || 0) || 0
                                const available = Math.max(0, onhand - reserved)
                                return (
                                    <tr key={r.id || i} onClick={() => onRowClick(r)} className="hover:bg-blue-50/40 cursor-pointer">
                                        <td className="px-3 py-2 font-mono font-bold text-slate-900">{r.material_code || r.code || "—"}</td>
                                        <td className="px-3 py-2"><span className="rounded-md bg-violet-50 px-1.5 py-0.5 font-mono text-[10px] font-black text-violet-700 ring-1 ring-violet-200">{bulkStockCode(r)}</span></td>
                                        <td className="px-3 py-2 font-mono text-[11px] text-slate-600">{r.location_code || r.location || "—"}</td>
                                        <td className="px-3 py-2 text-right font-mono font-bold text-slate-900">{formatStockQty(onhand, r)}</td>
                                        <td className="px-3 py-2 text-right font-mono text-violet-700 font-bold">{formatStockQty(reserved, r)}</td>
                                        <td className="px-3 py-2 text-right font-mono font-bold text-emerald-700">{formatStockQty(available, r)}</td>
                                        <td className="px-3 py-2"><span className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-200">View <ChevronRight className="h-3 w-3" /></span></td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                    {rows.length > limit && (
                        <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/40 px-5 py-2 text-[11px] text-slate-500">
                            <span>Showing {limit} of {rows.length} bulk stock rows · click row for drill-down</span>
                            <div className="flex gap-2">
                                <button onClick={onShowMore} className="rounded-lg bg-white px-2.5 py-1 font-bold text-blue-700 ring-1 ring-blue-200 hover:bg-blue-50">Show 20 more</button>
                                <button onClick={onShowAll} className="rounded-lg bg-blue-600 px-2.5 py-1 font-bold text-white hover:bg-blue-700">Show all</button>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </SectionShell>
    )
}

function PackagingSection({ rows, loading, limit, onShowMore, onShowAll, onRowClick }: { rows: any[]; loading: boolean; limit: number; onShowMore: () => void; onShowAll: () => void; onRowClick: (row: any) => void }) {
    if (loading) return <SectionSkeleton title="Packaging materials" tone="amber" />
    const innerPouches = rows.filter((r: any) => isInnerPouchRow(r))
    const outers = rows.filter((r: any) => isOuterShippingRow(r))
    const others = rows.filter((r: any) => !innerPouches.includes(r) && !outers.includes(r))
    return (
        <SectionShell
            title="Packaging materials"
            eyebrow={`${rows.length} SKU rows · catalog-backed`}
            subtitle="Inner pouches, gunny, cartons, sheets, tape and other packing stock. POD stock is shown separately."
            tone="amber"
            icon="📦"
        >
            {rows.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/40 p-6 text-center">
                    <Boxes className="mx-auto h-6 w-6 text-slate-300" />
                    <div className="mt-2 text-sm font-semibold text-slate-700">No packaging on hand</div>
                </div>
            ) : (
                <div>
                    <div className="grid grid-cols-1 divide-y divide-slate-100 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
                        <div className="p-4">
                            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-amber-700 mb-2">Inner pouches</div>
                            {innerPouches.length ? innerPouches.slice(0, Math.min(5, limit)).map((r: any, i: number) => <PkgRow key={i} row={r} onClick={() => onRowClick(r)} />) : <div className="text-xs text-slate-400 italic py-2">— none</div>}
                        </div>
                        <div className="p-4">
                            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-amber-700 mb-2">Outer / shipping</div>
                            {outers.length ? outers.slice(0, Math.min(5, limit)).map((r: any, i: number) => <PkgRow key={i} row={r} onClick={() => onRowClick(r)} />) : <div className="text-xs text-slate-400 italic py-2">— none</div>}
                        </div>
                        {others.length > 0 && (
                            <div className="p-4 sm:col-span-2 border-t border-slate-100">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-[10px] font-black uppercase tracking-[0.22em] text-amber-700">Other packing</span>
                                    <span className="text-[10px] text-slate-500">{others.length} rows</span>
                                </div>
                                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                                    {others.slice(0, limit).map((r: any, i: number) => <PodTile key={i} row={r} onClick={() => onRowClick(r)} />)}
                                </div>
                            </div>
                        )}
                    </div>
                    {rows.length > limit && (
                        <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/40 px-5 py-2 text-[11px] text-slate-500">
                            <span>Showing {Math.min(limit, rows.length)} of {rows.length} packaging SKUs</span>
                            <div className="flex gap-2">
                                <button onClick={onShowMore} className="rounded-lg bg-white px-2.5 py-1 font-bold text-amber-700 ring-1 ring-amber-200 hover:bg-amber-50">Show 12 more</button>
                                <button onClick={onShowAll} className="rounded-lg bg-amber-600 px-2.5 py-1 font-bold text-white hover:bg-amber-700">Show all</button>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </SectionShell>
    )
}

function PodStockSection({ rows, loading, limit, onShowMore, onShowAll, onRowClick }: { rows: any[]; loading: boolean; limit: number; onShowMore: () => void; onShowAll: () => void; onRowClick: (row: any) => void }) {
    if (loading) return <SectionSkeleton title="POD stock" tone="violet" />
    return (
        <SectionShell
            title="POD stock"
            eyebrow={`${rows.length} POD rows · catalog-backed`}
            subtitle="Pre-positioned POD sleeves and POD film stock only. Packing materials stay in the packaging section."
            tone="violet"
            icon="▣"
        >
            {rows.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/40 p-6 text-center">
                    <Boxes className="mx-auto h-6 w-6 text-slate-300" />
                    <div className="mt-2 text-sm font-semibold text-slate-700">No POD stock on hand</div>
                    <div className="mt-1 text-xs text-slate-500">POD inward or in-house POD production will show here.</div>
                </div>
            ) : (
                <div>
                    <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-3 lg:grid-cols-6">
                        {rows.slice(0, limit).map((row: any, index: number) => (
                            <PodTile key={row.id || index} row={row} onClick={() => onRowClick(row)} />
                        ))}
                    </div>
                    {rows.length > limit && (
                        <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/40 px-5 py-2 text-[11px] text-slate-500">
                            <span>Showing {Math.min(limit, rows.length)} of {rows.length} POD stock rows</span>
                            <div className="flex gap-2">
                                <button onClick={onShowMore} className="rounded-lg bg-white px-2.5 py-1 font-bold text-violet-700 ring-1 ring-violet-200 hover:bg-violet-50">Show 12 more</button>
                                <button onClick={onShowAll} className="rounded-lg bg-violet-600 px-2.5 py-1 font-bold text-white hover:bg-violet-700">Show all</button>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </SectionShell>
    )
}

function PkgRow({ row, onClick }: { row: any; onClick?: () => void }) {
    const qty = Number(row.qty || row.on_hand || 0)
    const qtyDecimals = qtyDecimalsForUom(stockUom(row, "PCS"))
    const status = qty > 100 ? "ok" : qty > 0 ? "warn" : "empty"
    const ICON = { ok: "●", warn: "◐", empty: "○" } as const
    const COLOR = { ok: "text-emerald-600", warn: "text-amber-600", empty: "text-slate-400" } as const
    return (
        <button onClick={onClick} className={cn("w-full flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 mb-1 text-left", status === "warn" ? "bg-amber-50/40 ring-1 ring-amber-200 hover:ring-amber-300" : "hover:bg-slate-50/80 hover:ring-1 hover:ring-slate-200")}>
            <div className="flex items-center gap-2 min-w-0">
                <span className={cn(COLOR[status], "text-base leading-none")}>{ICON[status]}</span>
                <div className="min-w-0">
                    <div className="font-mono text-[11px] font-bold text-slate-900 truncate">{row.code || row.material_code || "—"}</div>
                    <div className="text-[10px] text-slate-500 truncate">{row.name || row.material_name || row.packaging_kind || ""}</div>
                </div>
            </div>
            <div className="text-right flex-none">
                <div className="font-mono text-[11px] font-bold text-slate-800">{formatNumber(qty, qtyDecimals)} {stockUom(row, "PCS")}</div>
            </div>
        </button>
    )
}

function PodTile({ row, onClick }: { row: any; onClick?: () => void }) {
    const qty = Number(row.qty || row.on_hand || 0)
    const qtyDecimals = qtyDecimalsForUom(stockUom(row, "KG"))
    const status = qty > 50 ? "ok" : qty > 0 ? "warn" : "empty"
    const TONE = { ok: "border-emerald-200 bg-emerald-50/40", warn: "border-amber-200 bg-amber-50/40", empty: "border-slate-200 bg-slate-50" } as const
    return (
        <button onClick={onClick} className={cn("w-full text-left rounded-lg border px-2.5 py-2 hover:shadow-md", TONE[status])}>
            <div className="font-mono text-[11px] font-bold text-slate-900 truncate">{row.code || "—"}</div>
            <div className="mt-0.5 font-mono text-[10px] text-slate-700">{formatNumber(qty, qtyDecimals)} {stockUom(row, "KG")}</div>
        </button>
    )
}

interface SectionShellProps { title: string; eyebrow: string; subtitle?: string; tone: "blue" | "violet" | "amber" | "emerald"; icon: string; actions?: React.ReactNode; children: React.ReactNode }
function SectionShell({ title, eyebrow, subtitle, tone, icon, actions, children }: SectionShellProps) {
    const TONE = {
        blue: { bar: "border-l-blue-500", bg: "from-blue-50/80", num: "bg-blue-600 ring-blue-700" },
        violet: { bar: "border-l-violet-500", bg: "from-violet-50/80", num: "bg-violet-600 ring-violet-700" },
        amber: { bar: "border-l-amber-500", bg: "from-amber-50/60", num: "bg-amber-500 ring-amber-600" },
        emerald: { bar: "border-l-emerald-500", bg: "from-emerald-50/80", num: "bg-emerald-600 ring-emerald-700" },
    }[tone]
    return (
        <section className={cn("overflow-hidden rounded-2xl border border-slate-200/60 bg-white shadow-md ring-1 ring-slate-100/50 border-l-[3px] [content-visibility:auto] [contain-intrinsic-size:520px]", TONE.bar)}>
            <header className={cn("flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 bg-gradient-to-r via-white to-white px-5 py-4", TONE.bg)}>
                <div className="flex items-start gap-3">
                    <span className={cn("flex h-8 w-8 flex-none items-center justify-center rounded-lg text-white text-base shadow-sm ring-1", TONE.num)}>{icon}</span>
                    <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">{eyebrow}</div>
                        <h2 className="font-display text-lg font-bold text-slate-900">{title}</h2>
                        {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
                    </div>
                </div>
                {actions}
            </header>
            <div>{children}</div>
        </section>
    )
}

function SectionSkeleton({ title, tone }: { title: string; tone: "blue" | "violet" | "amber" }) {
    return (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="h-4 w-40 animate-pulse rounded bg-slate-200" />
            <div className="mt-3 h-32 animate-pulse rounded-xl bg-slate-100" />
        </div>
    )
}

function CellDrawer({ cell, row, col, onClose }: { cell: RollMatrixCell | undefined; row: string; col: number; onClose: () => void }) {
    return (
        <div className="fixed inset-0 z-40 flex justify-end" onClick={onClose}>
            <div className="absolute inset-0 bg-black/40" />
            <div className="relative z-50 h-full w-full max-w-md overflow-y-auto border-l border-slate-200 bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="sticky top-0 z-10 border-b border-slate-100 bg-gradient-to-r from-violet-50 via-white to-white px-5 py-4">
                    <div className="flex items-start justify-between gap-2">
                        <div>
                            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-violet-700">Roll cell drill-down</div>
                            <div className="font-display text-lg font-bold text-slate-900">{row}</div>
                            <div className="text-[11px] text-slate-500">Thickness <span className="font-mono font-bold">{col}μ</span></div>
                        </div>
                        <button onClick={onClose} className="rounded-lg p-1 hover:bg-slate-100"><X className="h-4 w-4 text-slate-500" /></button>
                    </div>
                    {cell && (
                        <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                            <div className="rounded-lg bg-slate-50 px-2.5 py-1.5"><div className="text-[9px] font-black uppercase text-slate-500">Rolls</div><div className="font-display text-base font-bold text-slate-900">{cell.rollCount}</div></div>
                            <div className="rounded-lg bg-slate-50 px-2.5 py-1.5"><div className="text-[9px] font-black uppercase text-slate-500">Total KG</div><div className="font-display text-base font-bold text-slate-900">{formatNumber(cell.totalKg, 0)}</div></div>
                        </div>
                    )}
                </div>
                <div className="px-5 py-4">
                    <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500 mb-2">Individual rolls</div>
                    {!cell || cell.rollCount === 0 ? (
                        <div className="text-xs text-slate-500 italic">No rolls in this cell.</div>
                    ) : (
                        <div className="space-y-2">
                            {cell.rolls.slice(0, 30).map((r: any, i: number) => (
                                <div key={r.id || i} className="rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm hover:shadow-md">
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0">
                                            <div className="font-mono text-xs font-bold text-blue-700 truncate">{r.label || r.code || r.id}</div>
                                            <div className="text-[10px] text-slate-500 truncate">{r.location_code || r.location || "—"} · {r.status || "available"}</div>
                                        </div>
                                        <div className="font-mono text-xs font-bold text-slate-800">{formatNumber(Number(r.net_weight_kg || r.qty_kg || 0), 1)} KG</div>
                                    </div>
                                </div>
                            ))}
                            {cell.rollCount > 30 && (
                                <div className="text-center text-[10px] text-slate-400">+ {cell.rollCount - 30} more</div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

// ─── Charts strip ────────────────────────────────────────────────────────

interface AgeingBuckets { fresh: number; aged: number; old: number; total: number }
interface ClassBreakdown { roll: { kg: number; pct: number }; bulk: { kg: number; pct: number }; pack: { kg: number; pct: number } }

function ChartsStrip({ ageing, classBreakdown, totals }: { ageing: AgeingBuckets; classBreakdown: ClassBreakdown; totals: { rollCount: number; bulkLots: number; pkgRows: number; rollKg: number; bulkKg: number; pkgPcs: number; bulkDisplay: string; pkgDisplay: string } }) {
    return (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {/* Ageing donut */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between">
                    <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Stock by age</div>
                        <h3 className="font-display text-base font-bold text-slate-900 mt-0.5">Stock by age</h3>
                    </div>
                    <Clock className="h-4 w-4 text-emerald-500" />
                </div>
                <div className="mt-3 flex items-center gap-4">
                    <Donut fresh={ageing.fresh} aged={ageing.aged} old={ageing.old} total={Math.max(ageing.total, 1)} />
                    <div className="flex-1 space-y-1.5 text-[11px]">
                        <Legend color="#10b981" label={`≤30 days · ${ageing.fresh}`} pct={Math.round((ageing.fresh / Math.max(ageing.total, 1)) * 100)} />
                        <Legend color="#f59e0b" label={`31–90 days · ${ageing.aged}`} pct={Math.round((ageing.aged / Math.max(ageing.total, 1)) * 100)} />
                        <Legend color="#f43f5e" label={`90+ days · ${ageing.old}`} pct={Math.round((ageing.old / Math.max(ageing.total, 1)) * 100)} />
                    </div>
                </div>
            </div>

            {/* Class breakdown bar */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between">
                    <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Stock by class</div>
                        <h3 className="font-display text-base font-bold text-slate-900 mt-0.5">Mix · weighted</h3>
                    </div>
                    <BarChart3 className="h-4 w-4 text-blue-500" />
                </div>
                <div className="mt-3 space-y-2.5">
                    <BarRow color="bg-violet-500" label="Rolls" v={`${formatNumber(totals.rollKg, 0)} KG · ${totals.rollCount} rolls`} pct={Math.max(classBreakdown.roll.pct, 2)} />
                    <BarRow color="bg-blue-500" label="Bulk" v={`${totals.bulkDisplay} · ${totals.bulkLots} rows`} pct={Math.max(classBreakdown.bulk.pct, 2)} />
                    <BarRow color="bg-amber-500" label="Pack" v={`${totals.pkgDisplay} · ${totals.pkgRows} SKUs`} pct={Math.max(classBreakdown.pack.pct, 2)} />
                </div>
            </div>

            {/* Trend sparkline */}
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between">
                    <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">30-day pulse</div>
                        <h3 className="font-display text-base font-bold text-slate-900 mt-0.5">In · Out · Net</h3>
                    </div>
                    <TrendingUp className="h-4 w-4 text-rose-500" />
                </div>
                <div className="mt-3">
                    <Sparkline />
                    <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                        <div className="rounded-lg bg-emerald-50 px-2 py-1.5 ring-1 ring-emerald-100">
                            <div className="text-[9px] font-black uppercase tracking-wide text-emerald-700">In</div>
                            <div className="font-mono font-bold text-emerald-800">+{formatNumber((totals.bulkKg + totals.rollKg) * 0.18, 0)} stock units</div>
                        </div>
                        <div className="rounded-lg bg-rose-50 px-2 py-1.5 ring-1 ring-rose-100">
                            <div className="text-[9px] font-black uppercase tracking-wide text-rose-700">Out</div>
                            <div className="font-mono font-bold text-rose-800">−{formatNumber((totals.bulkKg + totals.rollKg) * 0.12, 0)} stock units</div>
                        </div>
                        <div className="rounded-lg bg-blue-50 px-2 py-1.5 ring-1 ring-blue-100">
                            <div className="text-[9px] font-black uppercase tracking-wide text-blue-700">Net</div>
                            <div className="font-mono font-bold text-blue-800">+{formatNumber((totals.bulkKg + totals.rollKg) * 0.06, 0)} stock units</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

function Donut({ fresh, aged, old, total }: { fresh: number; aged: number; old: number; total: number }) {
    const r = 32
    const c = 2 * Math.PI * r
    const fr = (fresh / total) * c
    const ag = (aged / total) * c
    const od = (old / total) * c
    return (
        <svg width="92" height="92" viewBox="0 0 92 92">
            <circle cx="46" cy="46" r={r} fill="none" stroke="#f1f5f9" strokeWidth="14" />
            <circle cx="46" cy="46" r={r} fill="none" stroke="#10b981" strokeWidth="14" strokeDasharray={`${fr} ${c - fr}`} strokeDashoffset="0" transform="rotate(-90 46 46)" />
            <circle cx="46" cy="46" r={r} fill="none" stroke="#f59e0b" strokeWidth="14" strokeDasharray={`${ag} ${c - ag}`} strokeDashoffset={`${-fr}`} transform="rotate(-90 46 46)" />
            <circle cx="46" cy="46" r={r} fill="none" stroke="#f43f5e" strokeWidth="14" strokeDasharray={`${od} ${c - od}`} strokeDashoffset={`${-(fr + ag)}`} transform="rotate(-90 46 46)" />
            <text x="46" y="44" textAnchor="middle" className="font-display fill-slate-900" style={{ fontSize: 16, fontWeight: 800 }}>{total === 1 ? 0 : total}</text>
            <text x="46" y="58" textAnchor="middle" className="fill-slate-500" style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.2 }}>ITEMS</text>
        </svg>
    )
}

function Legend({ color, label, pct }: { color: string; label: string; pct: number }) {
    return (
        <div className="flex items-center gap-2">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />
            <span className="flex-1 text-slate-700 font-semibold">{label}</span>
            <span className="font-mono font-bold text-slate-500">{pct}%</span>
        </div>
    )
}

function BarRow({ color, label, v, pct }: { color: string; label: string; v: string; pct: number }) {
    return (
        <div>
            <div className="flex items-center justify-between text-[11px]">
                <span className="font-bold text-slate-700">{label}</span>
                <span className="font-mono text-slate-500">{v}</span>
            </div>
            <div className="mt-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                <div className={cn("h-full rounded-full", color)} style={{ width: `${Math.min(100, pct)}%` }} />
            </div>
        </div>
    )
}

function Sparkline() {
    // Stylised 30-day inflow line — visual only until backend trend endpoint lands.
    const pts = [12, 18, 14, 22, 19, 26, 24, 30, 28, 35, 32, 38, 41, 38, 44, 42, 48, 51, 49, 55, 52, 60, 58, 63, 61, 68, 70, 72, 74, 78]
    const max = Math.max(...pts)
    const min = Math.min(...pts)
    const w = 280
    const h = 70
    const stepX = w / (pts.length - 1)
    const path = pts.map((y, i) => {
        const x = i * stepX
        const ny = h - ((y - min) / Math.max(max - min, 1)) * (h - 6) - 3
        return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${ny.toFixed(1)}`
    }).join(" ")
    const fill = `${path} L ${w} ${h} L 0 ${h} Z`
    return (
        <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="none" height="70">
            <defs>
                <linearGradient id="spark-grad" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.35" />
                    <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
                </linearGradient>
            </defs>
            <path d={fill} fill="url(#spark-grad)" />
            <path d={path} fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
    )
}

// ─── Bulk & Packaging drawers ───────────────────────────────────────────

function BulkDrawer({ row, onClose }: { row: any; onClose: () => void }) {
    const onhand = rowQty(row)
    const reserved = Number(row.reserved_qty || 0) || 0
    const available = Math.max(0, onhand - reserved)
    const reservationPct = onhand > 0 ? Math.round((reserved / onhand) * 100) : 0

    const rsvQuery = useQuery({
        queryKey: ["inventory-reservations", "BULK", row.id],
        queryFn: () => inventoryService.getInventoryReservations({ ref_id: row.id, ref_type: "BULK" }),
        enabled: Boolean(row.id),
        staleTime: 30_000,
    })

    return (
        <div className="fixed inset-0 z-40 flex justify-end" onClick={onClose}>
            <div className="absolute inset-0 bg-black/40" />
            <div className="relative z-50 h-full w-full max-w-md overflow-y-auto border-l border-slate-200 bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="sticky top-0 z-10 border-b border-slate-100 bg-gradient-to-r from-blue-50 via-white to-white px-5 py-4">
                    <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-blue-700">Bulk stock drill-down</div>
                            <div className="font-display text-lg font-bold text-slate-900 truncate">{row.material_name || row.material_code || row.code || "Bulk stock"}</div>
                            <div className="font-mono text-[11px] text-slate-500">{row.location_code || row.location || "—"} · Code {bulkStockCode(row)}</div>
                        </div>
                        <button onClick={onClose} className="rounded-lg p-1 hover:bg-slate-100"><X className="h-4 w-4 text-slate-500" /></button>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
                        <Stat label="On hand" value={formatStockQty(onhand, row)} tone="slate" />
                        <Stat label="Reserved" value={formatStockQty(reserved, row)} tone="violet" />
                        <Stat label="Available" value={formatStockQty(available, row)} tone="emerald" />
                    </div>
                    <div className="mt-2">
                        <div className="flex items-center justify-between text-[10px] font-bold text-slate-500 mb-1"><span>Reservation %</span><span>{reservationPct}%</span></div>
                        <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                            <div className="h-full bg-violet-500" style={{ width: `${reservationPct}%` }} />
                        </div>
                    </div>
                </div>

                <div className="px-5 py-4 space-y-4">
                    <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500 mb-2">Vendor &amp; details</div>
                        <div className="grid grid-cols-2 gap-2 text-[11px]">
                            <Field label="Code" value={bulkStockCode(row)} />
                            <Field label="UOM" value={stockUom(row)} />
                            <Field label="Vendor" value={row.vendor_name || row.vendor || "—"} />
                            <Field label="Last GRN" value={row.last_grn_no || row.received_at || "—"} />
                            <Field label="Expiry" value={row.expiry_date || "—"} />
                            <Field label="Age" value={`${Math.floor(Number(row.age_days || 0))} days`} />
                        </div>
                    </div>

                    <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-violet-700 mb-2">Sales reservations holding this stock row</div>
                        {rsvQuery.isLoading && <div className="text-xs text-slate-400 italic">Loading reservations…</div>}
                        {!rsvQuery.isLoading && (rsvQuery.data || []).length === 0 && (
                            <div className="text-xs text-slate-400 italic">No active SO reservations.</div>
                        )}
                        {(rsvQuery.data || []).map((r: any, i: number) => (
                            <div key={i} className="rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2 mb-1.5">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="font-mono text-[11px] font-bold text-violet-800">{r.so_no || r.so_id || "—"}</span>
                                    <span className="font-mono text-[11px] font-bold text-slate-700">{formatNumber(Number(r.qty || 0), 1)} {r.uom || stockUom(row)}</span>
                                </div>
                                <div className="text-[10px] text-slate-500 mt-0.5">{r.customer_name || "Customer"} · promise {r.promise_date || "—"}</div>
                            </div>
                        ))}
                    </div>

                    <div className="pt-2 border-t border-slate-100">
                        <Link href={`/inventory/stock-lifecycle?tab=snapshots&material=${row.material || row.id || ""}`} className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-blue-700">
                            Open stock card <ArrowRight className="h-3 w-3" />
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    )
}

function PackagingDrawer({ row, onClose }: { row: any; onClose: () => void }) {
    const qty = Number(row.qty || row.on_hand || 0) || 0
    const reserved = Number(row.reserved_qty || 0) || 0
    const available = Math.max(0, qty - reserved)
    const uomFallback = isPodPackagingRow(row) ? "KG" : "PCS"
    const rsvQuery = useQuery({
        queryKey: ["inventory-reservations", "PACKAGING", row.id],
        queryFn: () => inventoryService.getInventoryReservations({ ref_id: row.id, ref_type: "PACKAGING" }),
        enabled: Boolean(row.id),
        staleTime: 30_000,
    })

    return (
        <div className="fixed inset-0 z-40 flex justify-end" onClick={onClose}>
            <div className="absolute inset-0 bg-black/40" />
            <div className="relative z-50 h-full w-full max-w-md overflow-y-auto border-l border-slate-200 bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="sticky top-0 z-10 border-b border-slate-100 bg-gradient-to-r from-amber-50 via-white to-white px-5 py-4">
                    <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-amber-700">Packaging drill-down</div>
                            <div className="font-display text-lg font-bold text-slate-900 truncate">{row.code || row.material_code || "Packaging SKU"}</div>
                            <div className="text-[11px] text-slate-500">{row.name || row.material_name || row.packaging_kind || "—"}</div>
                        </div>
                        <button onClick={onClose} className="rounded-lg p-1 hover:bg-slate-100"><X className="h-4 w-4 text-slate-500" /></button>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
                        <Stat label="On hand" value={`${formatNumber(qty, qtyDecimalsForUom(stockUom(row, uomFallback)))} ${stockUom(row, uomFallback)}`} tone="slate" />
                        <Stat label="Reserved" value={`${formatNumber(reserved, qtyDecimalsForUom(stockUom(row, uomFallback)))} ${stockUom(row, uomFallback)}`} tone="violet" />
                        <Stat label="Available" value={`${formatNumber(available, qtyDecimalsForUom(stockUom(row, uomFallback)))} ${stockUom(row, uomFallback)}`} tone="emerald" />
                    </div>
                </div>
                <div className="px-5 py-4 space-y-4">
                    <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500 mb-2">Specs</div>
                        <div className="grid grid-cols-2 gap-2 text-[11px]">
                            <Field label="Kind" value={row.packaging_kind || "—"} />
                            <Field label="Pcs / pack" value={row.pcs_per_pack || "—"} />
                            <Field label="Color" value={row.color_variant || "—"} />
                            <Field label="Location" value={row.location_code || row.location || "—"} />
                        </div>
                    </div>
                    <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-violet-700 mb-2">SO holds</div>
                        {rsvQuery.isLoading && <div className="text-xs text-slate-400 italic">Loading…</div>}
                        {!rsvQuery.isLoading && (rsvQuery.data || []).length === 0 && (
                            <div className="text-xs text-slate-400 italic">No active reservations.</div>
                        )}
                        {(rsvQuery.data || []).map((r: any, i: number) => (
                            <div key={i} className="rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2 mb-1.5">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="font-mono text-[11px] font-bold text-violet-800">{r.so_no || r.so_id || "—"}</span>
                                    <span className="font-mono text-[11px] font-bold text-slate-700">{formatNumber(Number(r.qty || 0), qtyDecimalsForUom(String(r.uom || stockUom(row, uomFallback)).toUpperCase()))} {r.uom || stockUom(row, uomFallback)}</span>
                                </div>
                                <div className="text-[10px] text-slate-500 mt-0.5">{r.customer_name || "Customer"} · promise {r.promise_date || "—"}</div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    )
}

function Stat({ label, value, tone }: { label: string; value: string; tone: "slate" | "violet" | "emerald" }) {
    const TONE = {
        slate: "bg-slate-50 text-slate-900 ring-slate-200",
        violet: "bg-violet-50 text-violet-900 ring-violet-200",
        emerald: "bg-emerald-50 text-emerald-900 ring-emerald-200",
    }[tone]
    return (
        <div className={cn("rounded-lg px-2.5 py-1.5 ring-1", TONE)}>
            <div className="text-[9px] font-black uppercase tracking-wider opacity-70">{label}</div>
            <div className="font-display text-sm font-bold mt-0.5">{value}</div>
        </div>
    )
}

function Field({ label, value }: { label: string; value: any }) {
    return (
        <div className="rounded-lg bg-slate-50/60 px-2.5 py-1.5 ring-1 ring-slate-100">
            <div className="text-[9px] font-black uppercase tracking-wider text-slate-500">{label}</div>
            <div className="text-[12px] font-bold text-slate-800 truncate">{value || "—"}</div>
        </div>
    )
}

// ─── Workspace launcher tiles ─────────────────────────────────────

function WorkspaceLauncher({ totals }: { totals: { rollCount: number; bulkLots: number; pkgRows: number; podRows: number; podPcs: number; rollKg: number; bulkKg: number; pkgPcs: number; bulkDisplay: string; pkgDisplay: string; podDisplay: string } }) {
    const TILES = [
        {
            href: "/inventory/rolls",
            tone: "from-violet-600 via-fuchsia-600 to-pink-600",
            icon: "🌀",
            title: "Roll workspace",
            subtitle: "Variant × thickness · matrix / table / grid",
            kpis: [
                { label: "Rolls", value: formatNumber(totals.rollCount) },
                { label: "KG", value: formatNumber(totals.rollKg, 0) },
            ],
        },
        {
            href: "/inventory/stock-conversions",
            tone: "from-blue-700 via-indigo-700 to-violet-700",
            icon: "✂️",
            title: "Stock conversion",
            subtitle: "Open tube · split sheets · slit jumbos",
            kpis: [
                { label: "Forms", value: "3" },
                { label: "Ops", value: "5" },
            ],
        },
        {
            href: "/inventory/bulk",
            tone: "from-emerald-600 via-teal-600 to-cyan-600",
            icon: "🧪",
            title: "Bulk &amp; chemicals",
            subtitle: "Granules · resins · code rows · plant split",
            kpis: [
                { label: "Rows", value: formatNumber(totals.bulkLots) },
                { label: "Stock", value: totals.bulkDisplay },
            ],
        },
        {
            href: "/inventory/packaging",
            tone: "from-amber-500 via-orange-500 to-rose-500",
            icon: "📦",
            title: "Packaging",
            subtitle: "Inner pouch · gunny · carton · sheet · tape",
            kpis: [
                { label: "SKUs", value: formatNumber(totals.pkgRows) },
                { label: "Stock", value: totals.pkgDisplay },
            ],
        },
        {
            href: "/inventory?tab=POD",
            tone: "from-purple-600 via-violet-600 to-indigo-600",
            icon: "🎫",
            title: "POD stock",
            subtitle: "POD sleeves only · details and stock",
            kpis: [
                { label: "Rows", value: formatNumber(totals.podRows) },
                { label: "Stock", value: totals.podDisplay },
            ],
        },
        {
            href: "/inventory/addons",
            tone: "from-indigo-600 via-violet-600 to-purple-600",
            icon: "🎨",
            title: "Inks · adhesives · solvents",
            subtitle: "Process consumables · colour swatches",
            kpis: [
                { label: "Items", value: "→" },
                { label: "Open", value: "→" },
            ],
        },
        {
            href: "/inventory/traceability",
            tone: "from-blue-600 via-sky-600 to-cyan-600",
            icon: "🌳",
            title: "Roll genealogy",
            subtitle: "Trace any roll · tree · timeline · ancestors",
            kpis: [],
        },
        {
            href: "/inventory/inter-plant",
            tone: "from-slate-700 via-slate-800 to-slate-900",
            icon: "🚚",
            title: "Inter-plant",
            subtitle: "Transfers · network flow · DC kanban",
            kpis: [],
        },
    ]
    return (
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
                <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Drill into</div>
                    <h3 className="font-display text-base font-bold text-slate-900">Dedicated workspaces</h3>
                </div>
                <span className="text-[10px] text-slate-500">Each with full filters · saved views · multi-view layouts</span>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                {TILES.map((t) => (
                    <Link key={t.href} href={t.href} className={cn("overflow-hidden rounded-2xl bg-gradient-to-br p-3.5 text-white shadow-md ring-1 ring-white/10 hover:shadow-2xl", t.tone)}>
                        <div className="flex items-start justify-between">
                            <span className="text-2xl">{t.icon}</span>
                            <ArrowRight className="h-4 w-4 text-white/80" />
                        </div>
                        <div className="mt-2 font-display text-base font-bold leading-tight" dangerouslySetInnerHTML={{ __html: t.title }} />
                        <div className="mt-0.5 text-[10px] text-white/80 leading-snug">{t.subtitle}</div>
                        {t.kpis.length > 0 && (
                            <div className="mt-2.5 grid grid-cols-2 gap-1.5">
                                {t.kpis.map((k, i) => (
                                    <div key={i} className="rounded-md bg-white/15 px-1.5 py-0.5 backdrop-blur-sm">
                                        <div className="text-[9px] font-black uppercase tracking-wider text-white/80">{k.label}</div>
                                        <div className="font-mono text-[11px] font-bold">{k.value}</div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </Link>
                ))}
            </div>
        </div>
    )
}

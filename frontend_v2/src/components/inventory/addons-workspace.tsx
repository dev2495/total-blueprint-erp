"use client"

/**
 * V3.6 Add-ons Workspace
 *
 * Inks, adhesives, solvents, miscellaneous chemicals — items that ride along
 * with rolls but live in bulk lots. Pulls bulk snapshot and filters down to
 * non-granule classes. Color swatch view + table.
 */

import * as React from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import {
    AlertTriangle,
    Beaker,
    Droplets,
    Eye,
    Factory,
    MapPin,
    Palette,
    Plus,
    Sparkles,
    X,
} from "lucide-react"

import { GradientHero } from "@/components/erp/gradient-hero"
import { cn } from "@/lib/utils"
import { describeApiError } from "@/lib/api"
import { colorHexFromName } from "@/lib/color-utils"
import { inventoryService } from "@/services/inventory"
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
type Family = "ALL" | "INK" | "ADHESIVE" | "SOLVENT" | "CHEMICAL" | "OTHER"

interface AddonsFilterState {
    search: string
    plant: string
    location: string
    family: Family
    materials: string[]
    healthBucket: "ALL" | "HEALTHY" | "LOW" | "CRITICAL"
}

const DEFAULT_FILTERS: AddonsFilterState = {
    search: "",
    plant: "ALL",
    location: "ALL",
    family: "ALL",
    materials: [],
    healthBucket: "ALL",
}

const DEFAULT_VIEWS: SavedView<AddonsFilterState>[] = [
    { id: "all-addons", name: "All add-ons", icon: "🎨", pinned: true, state: DEFAULT_FILTERS },
    { id: "inks", name: "Inks", icon: "🖌️", state: { ...DEFAULT_FILTERS, family: "INK" } },
    { id: "adhesives", name: "Adhesives", icon: "🧪", state: { ...DEFAULT_FILTERS, family: "ADHESIVE" } },
    { id: "solvents", name: "Solvents", icon: "💧", state: { ...DEFAULT_FILTERS, family: "SOLVENT" } },
    { id: "low-stock", name: "Low stock", icon: "⚠️", state: { ...DEFAULT_FILTERS, healthBucket: "LOW" } },
]

function fmtNum(n: number, max = 0): string {
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
    return `${fmtNum(qty, qtyDecimalsForUom(uom))} ${uom}`
}

function makeTrend(target: number, points = 12): number[] {
    if (!Number.isFinite(target) || target <= 0) return [0, 0, 0, 0]
    const seed = Math.max(target * 0.65, 1)
    const out: number[] = []
    for (let i = 0; i < points; i++) {
        const ratio = i / Math.max(points - 1, 1)
        const wobble = Math.sin(i * 0.65 + 0.3) * 0.07
        out.push(Math.max(0, seed + (target - seed) * ratio + target * wobble))
    }
    return out
}

function detectFamily(row: any): Exclude<Family, "ALL"> {
    const k = String(row.material_class || row.category || row.material_code || row.material_name || "").toUpperCase()
    if (/INK|PIGMENT|COLOR/.test(k)) return "INK"
    if (/ADHESIVE|GLUE/.test(k)) return "ADHESIVE"
    if (/SOLVENT|THINNER/.test(k)) return "SOLVENT"
    if (/CHEM|ACID|ALK/.test(k)) return "CHEMICAL"
    if (/GRANULE|RESIN|PE\b|PET\b|HDPE|LDPE|PP\b|BOPP/.test(k)) return "OTHER"
    return "OTHER"
}

function healthOf(row: any): { score: number; bucket: "HEALTHY" | "LOW" | "CRITICAL" } {
    const onhand = Number(row.qty_kg || row.on_hand_qty || row.qty || 0)
    const reorder = Number(row.reorder_point || 50)
    const score = onhand > reorder * 2 ? 100 : Math.max(0, Math.min(100, Math.round((onhand / Math.max(reorder, 1)) * 50)))
    const bucket = score >= 60 ? "HEALTHY" : score >= 30 ? "LOW" : "CRITICAL"
    return { score, bucket }
}

const FAMILY_ICON: Record<string, string> = { INK: "🖌️", ADHESIVE: "🧪", SOLVENT: "💧", CHEMICAL: "⚗️", OTHER: "🧴" }

export function AddonsWorkspaceV36() {
    const [filters, setFilters] = React.useState<AddonsFilterState>(DEFAULT_FILTERS)
    const [mode, setMode] = React.useState<"pulse" | "browse">("pulse")
    const [viewMode, setViewMode] = React.useState<ViewMode>("grid")
    const [selected, setSelected] = React.useState<any | null>(null)
    const [pageSize, setPageSize] = React.useState(48)
    const savedViews = useSavedViews<AddonsFilterState>("addons", DEFAULT_VIEWS)

    const stockQuery = useQuery({
        queryKey: ["inventory-addons"],
        queryFn: () => inventoryService.getInventorySnapshot(),
        staleTime: 30_000,
    })

    const allRows: any[] = React.useMemo(() => {
        const bulk = stockQuery.data?.bulk || []
        // Show only non-granule items (inks, adhesives, solvents, chemicals)
        return bulk.filter((r) => {
            const f = detectFamily(r)
            return f !== "OTHER" || /INK|ADH|SOL|CHEM/.test(String(r.material_code || ""))
        })
    }, [stockQuery.data])

    const materialOptions = React.useMemo(() => {
        const map = new Map<string, number>()
        for (const r of allRows) {
            const k = String(r.material_code || r.material_name || "").trim()
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
                const hay = [r.material_code, r.material_name, r.lot_no, r.location_code, r.location_name, r.vendor_name, r.color_name].some((v) => String(v || "").toLowerCase().includes(q))
                if (!hay) return false
            }
            if (filters.plant !== "ALL" && String(r.plant_id || r.plant || "") !== filters.plant) return false
            if (filters.location !== "ALL") {
                const loc = String(r.location || r.location_id || r.location_code || "")
                if (loc !== filters.location) return false
            }
            if (filters.family !== "ALL" && detectFamily(r) !== filters.family) return false
            if (filters.materials.length > 0 && !filters.materials.includes(String(r.material_code || r.material_name || ""))) return false
            if (filters.healthBucket !== "ALL" && healthOf(r).bucket !== filters.healthBucket) return false
            return true
        })
    }, [allRows, filters])

    const kpi = React.useMemo(() => {
        const totalKg = filtered.reduce((s: number, r: any) => s + Number(r.qty_kg || r.on_hand_qty || 0), 0)
        const reservedKg = filtered.reduce((s: number, r: any) => s + Number(r.reserved_qty || 0), 0)
        const inks = filtered.filter((r) => detectFamily(r) === "INK").length
        const adhesives = filtered.filter((r) => detectFamily(r) === "ADHESIVE").length
        const solvents = filtered.filter((r) => detectFamily(r) === "SOLVENT").length
        const critical = filtered.filter((r: any) => healthOf(r).bucket === "CRITICAL").length
        return { items: filtered.length, totalKg, reservedKg, inks, adhesives, solvents, critical }
    }, [filtered])

    const chips = React.useMemo(() => {
        const list: { key: string; label: string; onClear: () => void }[] = []
        if (filters.search) list.push({ key: "s", label: `"${filters.search}"`, onClear: () => setFilters((f) => ({ ...f, search: "" })) })
        if (filters.family !== "ALL") list.push({ key: "fam", label: `Family · ${filters.family}`, onClear: () => setFilters((f) => ({ ...f, family: "ALL" })) })
        if (filters.plant !== "ALL") list.push({ key: "p", label: `Plant`, onClear: () => setFilters((f) => ({ ...f, plant: "ALL" })) })
        if (filters.location !== "ALL") list.push({ key: "l", label: `Location`, onClear: () => setFilters((f) => ({ ...f, location: "ALL" })) })
        if (filters.materials.length) list.push({ key: "m", label: `Materials · ${filters.materials.length}`, onClear: () => setFilters((f) => ({ ...f, materials: [] })) })
        if (filters.healthBucket !== "ALL") list.push({ key: "h", label: `Health · ${filters.healthBucket}`, onClear: () => setFilters((f) => ({ ...f, healthBucket: "ALL" })) })
        return list
    }, [filters])

    // Pulse breakdowns (must be unconditional — called before early return)
    const pulseFamilyBreakdown = React.useMemo(() => {
        const map = new Map<string, number>()
        for (const r of filtered as any[]) {
            const k = detectFamily(r)
            const kg = Number(r.qty_kg || r.on_hand_qty || 0)
            map.set(k, (map.get(k) || 0) + kg)
        }
        return Array.from(map.entries()).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)
    }, [filtered])
    const pulseMaterialBreakdown = React.useMemo(() => {
        const map = new Map<string, number>()
        for (const r of filtered as any[]) {
            const k = String(r.material_code || r.material_name || "—")
            const kg = Number(r.qty_kg || r.on_hand_qty || 0)
            map.set(k, (map.get(k) || 0) + kg)
        }
        return Array.from(map.entries()).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)
    }, [filtered])
    const pulseLocationBreakdown = React.useMemo(() => {
        const map = new Map<string, number>()
        for (const r of filtered as any[]) {
            const k = String(r.location_code || r.location_name || "—")
            const kg = Number(r.qty_kg || r.on_hand_qty || 0)
            map.set(k, (map.get(k) || 0) + kg)
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

    // Matrix: family × plant
    const pulseMatrix = React.useMemo(() => {
        const cellMap: Record<string, Record<string, number>> = {}
        const rowSet = new Set<string>()
        const colSet = new Set<string>()
        for (const r of filtered as any[]) {
            const fam = detectFamily(r)
            const plant = String(r.plant_name || r.plant_id || "—")
            rowSet.add(fam); colSet.add(plant)
            cellMap[fam] = cellMap[fam] || {}
            cellMap[fam][plant] = (cellMap[fam][plant] || 0) + Number(r.qty_kg || r.on_hand_qty || 0)
        }
        return {
            title: "Family × plant (kg)",
            subtitle: "Where each addon family lives",
            rowLabel: "family", colLabel: "plant",
            rows: Array.from(rowSet).sort(),
            cols: Array.from(colSet).sort(),
            cells: cellMap,
            unit: "kg",
        }
    }, [filtered])

    const pulseTopList = React.useMemo(() => {
        const rows = pulseMaterialBreakdown.slice(0, 8).map((m) => ({
            label: m.label, sub: `addon · ${kpi.totalKg > 0 ? `${((m.value / kpi.totalKg) * 100).toFixed(1)}%` : "0%"} of total`,
            value: `${fmtNum(m.value, 0)} kg`,
        }))
        return { title: "Top materials by KG", subtitle: "Most-stocked addons", rows }
    }, [pulseMaterialBreakdown, kpi.totalKg])

    if (stockQuery.isError) {
        return <div className="rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-900"><div className="font-bold">Could not load add-ons.</div><div className="mt-1 text-xs">{describeApiError(stockQuery.error, "Check backend.")}</div></div>
    }

    return (
        <div className="space-y-4 pb-12">
            <ClassTabBar tabs={INVENTORY_CLASS_TABS} activeId="addons" />
            <GradientHero
                eyebrow="Inventory · V3.6 · add-ons"
                title="Inks · adhesives · solvents"
                subtitle="Process consumables that ride along with rolls — colour-coded for inks, lot-tracked for adhesives, expiry-aware for solvents."
                palette="violet"
                chips={[
                    { icon: <Palette className="h-3.5 w-3.5" />, label: "Items", value: `${kpi.items}`, tone: "ok" },
                    { icon: <Droplets className="h-3.5 w-3.5" />, label: "KG / L", value: fmtNum(kpi.totalKg, 0), tone: "violet" },
                    { icon: <AlertTriangle className="h-3.5 w-3.5" />, label: "Critical", value: `${kpi.critical}`, tone: "warn" },
                ]}
                actions={
                    <div className="flex items-center gap-2">
                        <Link href="/inventory/grn" className="inline-flex items-center gap-1.5 rounded-xl bg-white px-4 py-1.5 text-xs font-bold text-violet-700 shadow-md hover:bg-violet-50">
                            <Plus className="h-3.5 w-3.5" /> Receive add-ons
                        </Link>
                        <Link href="/inventory" className="inline-flex items-center gap-1.5 rounded-xl bg-white/15 px-4 py-1.5 text-xs font-bold text-white ring-1 ring-white/30 hover:bg-white/25">
                            ← Summary
                        </Link>
                    </div>
                }
            />

            <div className="flex items-center justify-between gap-3 flex-wrap">
                <ModeToggle mode={mode} onChange={setMode} />
                <span className="text-[11px] text-slate-500">{mode === "pulse" ? "Pulse · family + colour mix" : "Browse · cards / table"}</span>
            </div>

            {mode === "pulse" && (
                <PulseViewV36
                    kpis={[
                        { label: "Items", value: fmtNum(kpi.items), sub: "add-on lots", icon: <Palette className="h-3.5 w-3.5" />, trend: makeTrend(kpi.items, 12) },
                        { label: "Total KG/L", value: fmtNum(kpi.totalKg, 0), sub: `${fmtNum(kpi.reservedKg, 0)} reserved`, tone: "good", trend: makeTrend(kpi.totalKg, 12) },
                        { label: "Inks", value: fmtNum(kpi.inks), sub: "colour pigments", icon: <Palette className="h-3.5 w-3.5" />, trend: makeTrend(kpi.inks, 12) },
                        { label: "Adhesives", value: fmtNum(kpi.adhesives), sub: "bonding agents", icon: <Beaker className="h-3.5 w-3.5" />, trend: makeTrend(kpi.adhesives, 12) },
                        { label: "Solvents", value: fmtNum(kpi.solvents), sub: "thinners", icon: <Droplets className="h-3.5 w-3.5" />, trend: makeTrend(kpi.solvents, 12) },
                        { label: "Critical", value: fmtNum(kpi.critical), sub: "below reorder", icon: <AlertTriangle className="h-3.5 w-3.5" />, tone: kpi.critical > 0 ? "bad" : "default", trend: makeTrend(kpi.critical, 12) },
                    ]}
                    statRow={[
                        { label: "Families", value: fmtNum(pulseFamilyBreakdown.length), sub: "ink/adh/solv/chem" },
                        { label: "Materials", value: fmtNum(pulseMaterialBreakdown.length), sub: "distinct codes" },
                        { label: "Locations", value: fmtNum(pulseLocationBreakdown.length), sub: "warehouses" },
                        { label: "Avg per item", value: kpi.items > 0 ? `${(kpi.totalKg / kpi.items).toFixed(1)} kg` : "—", sub: "per lot" },
                        { label: "Reserved %", value: kpi.totalKg > 0 ? `${Math.round((kpi.reservedKg / kpi.totalKg) * 100)}%` : "0%", sub: "kg held", tone: kpi.reservedKg > 0 ? "warn" : "default" },
                        { label: "Healthy", value: kpi.items > 0 ? `${Math.round(((kpi.items - kpi.critical) / kpi.items) * 100)}%` : "100%", sub: "of items", tone: "good" },
                    ]}
                    primaryBreakdown={{ title: "By family · KG", entries: pulseFamilyBreakdown, unit: "KG" }}
                    secondaryBreakdown={{ title: "Top materials", entries: pulseMaterialBreakdown.slice(0, 10), unit: "KG" }}
                    ageing={pulseAgeing}
                    locationBreakdown={pulseLocationBreakdown}
                    matrix={pulseMatrix}
                    topList={pulseTopList}
                />
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
                onExport={() => window.open(inventoryService.getInventoryExportUrl("addons"), "_blank", "noopener,noreferrer")}
            />

            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
                <FilterRail>
                    <FilterGroup
                        label="Family"
                        value={filters.family}
                        onChange={(id) => setFilters((f) => ({ ...f, family: id as Family }))}
                        options={[
                            { id: "ALL", label: "All" },
                            { id: "INK", label: "Inks 🖌️", count: allRows.filter((r) => detectFamily(r) === "INK").length },
                            { id: "ADHESIVE", label: "Adhesives 🧪", count: allRows.filter((r) => detectFamily(r) === "ADHESIVE").length },
                            { id: "SOLVENT", label: "Solvents 💧", count: allRows.filter((r) => detectFamily(r) === "SOLVENT").length },
                            { id: "CHEMICAL", label: "Chemicals ⚗️", count: allRows.filter((r) => detectFamily(r) === "CHEMICAL").length },
                            { id: "OTHER", label: "Other", count: allRows.filter((r) => detectFamily(r) === "OTHER").length },
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
                            { id: "CRITICAL", label: "Critical 🔥" },
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
                        <select value={filters.location} onChange={(e) => setFilters((f) => ({ ...f, location: e.target.value }))} className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-mono">
                            {locationOptions.map((l) => (
                                <option key={l.id} value={l.id}>{l.label}{typeof l.count === "number" ? ` · ${l.count}` : ""}</option>
                            ))}
                        </select>
                    </div>
                    {materialOptions.length > 0 && (
                        <MultiSelectPills label="Material code" options={materialOptions} selected={filters.materials} onChange={(v) => setFilters((f) => ({ ...f, materials: v }))} />
                    )}
                </FilterRail>

                <main>
                    {viewMode === "table" ? (
                        <AddonsTable rows={filtered.slice(0, pageSize)} total={filtered.length} pageSize={pageSize} onPageSize={setPageSize} loading={stockQuery.isLoading} onSelect={setSelected} />
                    ) : (
                        <AddonsGrid rows={filtered.slice(0, pageSize)} total={filtered.length} pageSize={pageSize} onPageSize={setPageSize} loading={stockQuery.isLoading} onSelect={setSelected} />
                    )}
                </main>
            </div>
            </>
            )}

            {selected && <AddonDrawer row={selected} onClose={() => setSelected(null)} />}
        </div>
    )
}

function AddonsTable({ rows, total, pageSize, onPageSize, loading, onSelect }: { rows: any[]; total: number; pageSize: number; onPageSize: (n: number) => void; loading: boolean; onSelect: (r: any) => void }) {
    if (loading) return <Skel />
    if (rows.length === 0) return <Empty />
    return (
        <WorkspaceSection title="Add-on items" eyebrow={`${rows.length} of ${total}`} tone="violet" icon={<Beaker className="h-4 w-4" />}>
            <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                    <thead className="bg-slate-50/40 border-b border-slate-200 text-slate-500">
                        <tr>
                            <th className="px-3 py-2 text-left font-bold uppercase tracking-wider">Item</th>
                            <th className="px-3 py-2 text-left font-bold uppercase tracking-wider">Family</th>
                            <th className="px-3 py-2 text-left font-bold uppercase tracking-wider">Plant · Loc</th>
                            <th className="px-3 py-2 text-right font-bold uppercase tracking-wider">On hand</th>
                            <th className="px-3 py-2 text-right font-bold uppercase tracking-wider">Reserved</th>
                            <th className="px-3 py-2 text-right font-bold uppercase tracking-wider">Available</th>
                            <th className="px-3 py-2 text-left font-bold uppercase tracking-wider">Health</th>
                            <th className="px-3 py-2 text-right font-bold uppercase tracking-wider">Action</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {rows.map((r: any, i: number) => {
                            const onhand = Number(r.qty_kg || r.on_hand_qty || 0)
                            const reserved = Number(r.reserved_qty || 0)
                            const available = Math.max(0, onhand - reserved)
                            const f = detectFamily(r)
                            const h = healthOf(r)
                            const isInk = f === "INK"
                            const swatch = isInk ? colorHexFromName(String(r.color_name || r.material_name || r.material_code || "")) : null
                            return (
                                <tr key={r.id || i} onClick={() => onSelect(r)} className="hover:bg-violet-50/30 cursor-pointer">
                                    <td className="px-3 py-2">
                                        <div className="flex items-center gap-2">
                                            {swatch && <span className="h-4 w-4 rounded-sm ring-1 ring-slate-300" style={{ backgroundColor: swatch }} />}
                                            <div>
                                                <div className="font-mono font-bold text-slate-900">{r.material_code || "—"}</div>
                                                <div className="text-[10px] text-slate-500 truncate max-w-[200px]">{r.material_name || ""}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="px-3 py-2"><span className="rounded-md bg-violet-50 px-1.5 py-0.5 text-[10px] font-bold text-violet-700 ring-1 ring-violet-200">{FAMILY_ICON[f]} {f}</span></td>
                                    <td className="px-3 py-2 text-[11px]">
                                        <div className="font-bold text-slate-700">{r.plant_name || "—"}</div>
                                        <div className="font-mono text-[10px] text-slate-500">{r.location_code || r.location_name || "—"}</div>
                                    </td>
                                    <td className="px-3 py-2 text-right font-mono font-bold text-slate-900">{formatStockQty(onhand, r)}</td>
                                    <td className="px-3 py-2 text-right font-mono font-bold text-violet-700">{formatStockQty(reserved, r)}</td>
                                    <td className="px-3 py-2 text-right font-mono font-bold text-emerald-700">{formatStockQty(available, r)}</td>
                                    <td className="px-3 py-2">
                                        <div className="flex items-center gap-2">
                                            <div className="h-1.5 w-14 rounded-full bg-slate-200 overflow-hidden">
                                                <div className={cn("h-full", h.bucket === "HEALTHY" ? "bg-emerald-500" : h.bucket === "LOW" ? "bg-amber-500" : "bg-rose-500")} style={{ width: `${h.score}%` }} />
                                            </div>
                                            <span className={cn("rounded-md px-1.5 py-0.5 text-[10px] font-bold", h.bucket === "HEALTHY" ? "bg-emerald-50 text-emerald-700" : h.bucket === "LOW" ? "bg-amber-50 text-amber-700" : "bg-rose-50 text-rose-700")}>{h.score}%</span>
                                        </div>
                                    </td>
                                    <td className="px-3 py-2 text-right">
                                        <button onClick={(e) => { e.stopPropagation(); onSelect(r) }} className="inline-flex items-center gap-0.5 rounded-md bg-violet-50 px-1.5 py-0.5 text-[10px] font-bold text-violet-700 ring-1 ring-violet-200 hover:bg-violet-100">
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
                <select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))} className="rounded-md border border-slate-200 bg-white px-2 py-0.5 font-mono text-[11px]">
                    {[25, 50, 100, 250].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
            </div>
        </WorkspaceSection>
    )
}

function AddonsGrid({ rows, total, pageSize, onPageSize, loading, onSelect }: { rows: any[]; total: number; pageSize: number; onPageSize: (n: number) => void; loading: boolean; onSelect: (r: any) => void }) {
    if (loading) return <Skel />
    if (rows.length === 0) return <Empty />
    return (
        <WorkspaceSection title="Add-on cards" eyebrow={`${rows.length} of ${total}`} tone="violet" icon={<Palette className="h-4 w-4" />}>
            <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {rows.map((r: any) => {
                    const onhand = Number(r.qty_kg || 0)
                    const reserved = Number(r.reserved_qty || 0)
                    const f = detectFamily(r)
                    const h = healthOf(r)
                    const isInk = f === "INK"
                    const swatch = isInk ? colorHexFromName(String(r.color_name || r.material_name || r.material_code || "")) : null
                    return (
                        <button key={r.id} onClick={() => onSelect(r)} className="text-left rounded-2xl border border-slate-200 bg-white p-3 shadow-sm hover:shadow-lg hover:border-violet-300">
                            <div className="flex items-start justify-between gap-2">
                                {swatch ? (
                                    <span className="h-9 w-9 rounded-xl ring-2 ring-white shadow-md" style={{ backgroundColor: swatch }} />
                                ) : (
                                    <span className="text-2xl">{FAMILY_ICON[f]}</span>
                                )}
                                <span className={cn("rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase", h.bucket === "HEALTHY" ? "bg-emerald-100 text-emerald-700" : h.bucket === "LOW" ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700")}>{h.bucket}</span>
                            </div>
                            <div className="mt-2 font-mono text-xs font-bold text-slate-900 truncate">{r.material_code || "—"}</div>
                            <div className="text-[10px] text-slate-500 truncate">{r.material_name || ""}</div>
                            <div className="mt-2 grid grid-cols-2 gap-1.5 rounded-lg bg-slate-50/80 p-2 text-center">
                                <div><div className="text-[8px] font-black uppercase text-slate-500">On hand</div><div className="font-mono text-sm font-bold text-slate-900">{formatStockQty(onhand, r)}</div></div>
                                <div><div className="text-[8px] font-black uppercase text-slate-500">Free</div><div className="font-mono text-sm font-bold text-emerald-700">{formatStockQty(Math.max(0, onhand - reserved), r)}</div></div>
                            </div>
                            <div className="mt-2 text-[10px] text-slate-500"><MapPin className="inline-block h-3 w-3 mr-0.5 -mt-0.5" />{r.location_code || "—"}</div>
                        </button>
                    )
                })}
            </div>
            <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/40 px-5 py-2 text-[11px]">
                <span className="text-slate-500">Showing {rows.length} of {total}</span>
                <select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))} className="rounded-md border border-slate-200 bg-white px-2 py-0.5 font-mono text-[11px]">
                    {[24, 48, 96, 200].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
            </div>
        </WorkspaceSection>
    )
}

function AddonDrawer({ row, onClose }: { row: any; onClose: () => void }) {
    const onhand = Number(row.qty_kg || row.on_hand_qty || 0)
    const reserved = Number(row.reserved_qty || 0)
    const available = Math.max(0, onhand - reserved)
    const f = detectFamily(row)
    const isInk = f === "INK"
    const swatch = isInk ? colorHexFromName(String(row.color_name || row.material_name || row.material_code || "")) : null
    const rsvQuery = useQuery({
        queryKey: ["inv-reservations-addon", row.id],
        queryFn: () => inventoryService.getInventoryReservations({ ref_id: row.id, ref_type: "BULK" }),
        enabled: Boolean(row.id),
        staleTime: 30_000,
    })
    return (
        <div className="fixed inset-0 z-40 flex justify-end" onClick={onClose}>
            <div className="absolute inset-0 bg-black/40" />
            <div className="relative z-50 h-full w-full max-w-md overflow-y-auto border-l border-slate-200 bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="sticky top-0 z-10 border-b border-slate-100 bg-gradient-to-r from-violet-50 via-white to-white px-5 py-4">
                    <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-3 min-w-0">
                            {swatch ? (
                                <span className="h-10 w-10 flex-none rounded-xl ring-2 ring-white shadow-md" style={{ backgroundColor: swatch }} />
                            ) : (
                                <span className="text-3xl">{FAMILY_ICON[f]}</span>
                            )}
                            <div className="min-w-0">
                                <div className="text-[10px] font-black uppercase tracking-[0.22em] text-violet-700">{FAMILY_ICON[f]} {f}</div>
                                <div className="font-mono font-display text-lg font-bold text-slate-900 truncate">{row.material_code || "—"}</div>
                                <div className="text-[11px] text-slate-500 truncate">{row.material_name || ""}</div>
                            </div>
                        </div>
                        <button onClick={onClose} className="rounded-lg p-1 hover:bg-slate-100"><X className="h-4 w-4 text-slate-500" /></button>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
                        <Stat label="On hand" value={formatStockQty(onhand, row)} />
                        <Stat label="Reserved" value={formatStockQty(reserved, row)} tone="violet" />
                        <Stat label="Available" value={formatStockQty(available, row)} tone="emerald" />
                    </div>
                </div>
                <div className="px-5 py-4 space-y-4">
                    <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500 mb-2">Lot details</div>
                        <div className="grid grid-cols-2 gap-2 text-[11px]">
                            <Field label="Lot #" value={row.lot_no || "—"} />
                            <Field label="Vendor" value={row.vendor_name || "—"} />
                            <Field label="Plant" value={row.plant_name || "—"} icon={<Factory className="h-3 w-3 text-violet-500" />} />
                            <Field label="Location" value={row.location_code || row.location_name || "—"} icon={<MapPin className="h-3 w-3 text-violet-500" />} />
                            <Field label="Color" value={row.color_name || "—"} />
                            <Field label="Expiry" value={row.expiry_date || "—"} />
                        </div>
                    </div>
                    <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-violet-700 mb-2">Allocations</div>
                        {rsvQuery.isLoading && <div className="text-xs text-slate-400 italic">Loading…</div>}
                        {!rsvQuery.isLoading && (rsvQuery.data || []).length === 0 && <div className="text-xs text-slate-400 italic">No active allocations.</div>}
                        {(rsvQuery.data || []).map((r: any, i: number) => (
                            <div key={i} className="rounded-xl border border-violet-200 bg-violet-50/40 px-3 py-2 mb-1.5">
                                <div className="flex items-center justify-between gap-2">
                                    <span className="font-mono text-[11px] font-bold text-violet-800">{r.so_no || r.so_id || "—"}</span>
                                    <span className="font-mono text-[11px] font-bold text-slate-700">{formatStockQty(Number(r.qty || 0), row)}</span>
                                </div>
                                <div className="text-[10px] text-slate-500 mt-0.5">{r.customer_name || ""} · {r.promise_date || "—"}</div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    )
}

function Stat({ label, value, tone = "slate" }: { label: string; value: string; tone?: "slate" | "violet" | "emerald" }) {
    const TONE = { slate: "bg-slate-50 text-slate-900 ring-slate-200", violet: "bg-violet-50 text-violet-900 ring-violet-200", emerald: "bg-emerald-50 text-emerald-900 ring-emerald-200" }[tone]
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
            <div className="mt-0.5 flex items-center gap-1 text-xs font-bold text-slate-800 truncate">{icon}{value || "—"}</div>
        </div>
    )
}

function Skel() {
    return <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="h-4 w-40 animate-pulse rounded bg-slate-200" /><div className="mt-3 h-32 animate-pulse rounded-xl bg-slate-100" /></div>
}

function Empty() {
    return (
        <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white p-10 text-center">
            <Sparkles className="mx-auto h-8 w-8 text-slate-300" />
            <div className="mt-2 text-sm font-semibold text-slate-700">No add-ons match these filters</div>
            <div className="mt-1 text-xs text-slate-500">Adjust filters or clear search.</div>
        </div>
    )
}

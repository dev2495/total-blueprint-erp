"use client"

/**
 * V3.6 Rolls Workspace
 *
 * Full-fledge roll inventory workspace. Three view modes:
 *   - Matrix: variant × thickness pivot, intensity heatmap, click cell to drill
 *   - Table: dense column-rich table with sort, paginate, status badges
 *   - Grid: card grid with QR-style label, dimensions, role
 * Plus comprehensive filter rail (variant family, width, thickness, role,
 * status, plant, location, age, behavior), saved views (localStorage), search,
 * export, columns config, detail drawer.
 */

import * as React from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import {
    ArrowRight,
    ArrowUpDown,
    Boxes,
    Disc,
    Eye,
    Factory,
    Flame,
    GitBranch,
    Layers,
    MapPin,
    Plus,
    Sparkles,
    X,
} from "lucide-react"

import { GradientHero } from "@/components/erp/gradient-hero"
import { cn } from "@/lib/utils"
import { describeApiError } from "@/lib/api"
import { inventoryService, type Roll } from "@/services/inventory"
import {
    FilterBar,
    FilterGroup,
    FilterRail,
    KpiTileV36,
    MultiSelectPills,
    RangeFilter,
    SavedViewsBar,
    WorkspaceSection,
    type SavedView,
    useSavedViews,
} from "./workspace-shell"
import { ClassTabBar, INVENTORY_CLASS_TABS, ModeToggle, PulseViewV36 } from "./pulse-view"

// ─── Types ─────────────────────────────────────────────────────────

type ViewMode = "matrix" | "table" | "grid"
type StatusFilter = "ALL" | "AVAILABLE" | "RESERVED" | "IN_PROCESS" | "CONSUMED" | "QUARANTINE"
type RoleFilter = "ALL" | "BASE" | "OUTPUT" | "REMAINDER" | "FG" | "SPLIT_OUTPUT"
type AgeBucket = "ALL" | "FRESH" | "AGED" | "OLD"
type StockFormFilter = "ALL" | "OPEN_WEB" | "LAYFLAT_TUBE" | "FOLDED_WEB"

interface RollsFilterState {
    search: string
    plant: string
    location: string
    variantFamilies: string[]
    status: StatusFilter
    role: RoleFilter
    stockForm: StockFormFilter
    ageBucket: AgeBucket
    width: [number, number]
    thickness: [number, number]
    weight: [number, number]
    behavior: string
}

const DEFAULT_FILTERS: RollsFilterState = {
    search: "",
    plant: "ALL",
    location: "ALL",
    variantFamilies: [],
    status: "ALL",
    role: "ALL",
    stockForm: "ALL",
    ageBucket: "ALL",
    width: [0, 3000],
    thickness: [0, 200],
    weight: [0, 1000],
    behavior: "ALL",
}

const DEFAULT_VIEWS: SavedView<RollsFilterState>[] = [
    { id: "all-rolls", name: "All rolls", icon: "🌀", pinned: true, state: DEFAULT_FILTERS },
    { id: "available-only", name: "Available only", icon: "✅", state: { ...DEFAULT_FILTERS, status: "AVAILABLE" } },
    { id: "open-web", name: "Open web", icon: "▭", state: { ...DEFAULT_FILTERS, stockForm: "OPEN_WEB" } },
    { id: "tubes", name: "Tubes", icon: "▯", state: { ...DEFAULT_FILTERS, stockForm: "LAYFLAT_TUBE" } },
    { id: "folded", name: "Folded", icon: "⫷", state: { ...DEFAULT_FILTERS, stockForm: "FOLDED_WEB" } },
    { id: "reserved", name: "Reserved", icon: "🔒", state: { ...DEFAULT_FILTERS, status: "RESERVED" } },
    { id: "remainders", name: "Remainders", icon: "♻️", state: { ...DEFAULT_FILTERS, role: "REMAINDER" } },
    { id: "aged-90", name: "Aged 90+", icon: "⏰", state: { ...DEFAULT_FILTERS, ageBucket: "OLD" } },
]

// ─── Helpers ────────────────────────────────────────────────────────

function ageOf(row: any): number {
    const ts = row.created_at || row.received_at
    if (!ts) return Number(row.age_days || 0)
    const d = (Date.now() - new Date(ts).getTime()) / (1000 * 60 * 60 * 24)
    return Number.isFinite(d) ? d : 0
}

function fmtNum(n: number, max = 0): string {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: max }).format(n)
}

function stockFormValue(row: any): StockFormFilter {
    const value = String(row?.stock_form || "OPEN_WEB").toUpperCase()
    if (value === "TUBE" || value === "LAY_FLAT_TUBE" || value === "LAYFLAT_TUBE") return "LAYFLAT_TUBE"
    if (value === "FOLDED" || value === "FOLDED_WEB") return "FOLDED_WEB"
    return "OPEN_WEB"
}

function stockFormLabel(value: any): string {
    const normalized = stockFormValue({ stock_form: value })
    if (normalized === "LAYFLAT_TUBE") return "Lay-flat tube"
    if (normalized === "FOLDED_WEB") return "Folded web"
    return "Open web"
}

function stockFormTone(value: any): string {
    const normalized = stockFormValue({ stock_form: value })
    if (normalized === "LAYFLAT_TUBE") return "bg-warning-bg text-amber-800 ring-amber-200"
    if (normalized === "FOLDED_WEB") return "bg-violet-50 text-violet-800 ring-violet-200"
    return "bg-blue-50 text-blue-800 ring-blue-200"
}

// Visual sparkline trend until backend trend endpoint lands.
// Generates a stable, gentle wave anchored to the current value.
function makeTrend(target: number, points = 12): number[] {
    if (!Number.isFinite(target) || target <= 0) return [0, 0, 0, 0]
    const seed = Math.max(target * 0.6, 1)
    const out: number[] = []
    for (let i = 0; i < points; i++) {
        const ratio = i / Math.max(points - 1, 1)
        const wobble = Math.sin(i * 0.7) * 0.08
        const v = seed + (target - seed) * ratio + target * wobble
        out.push(Math.max(0, v))
    }
    return out
}

function intensityFor(kg: number): "0" | "1" | "2" | "3" | "4" {
    if (kg <= 0) return "0"
    if (kg < 200) return "1"
    if (kg < 1000) return "2"
    if (kg < 5000) return "3"
    return "4"
}

function statusTone(s: string): string {
    const k = s.toUpperCase()
    if (k === "AVAILABLE") return "bg-emerald-100 text-emerald-800 ring-emerald-200"
    if (k === "RESERVED") return "bg-amber-100 text-amber-800 ring-amber-200"
    if (k === "IN_PROCESS") return "bg-blue-100 text-blue-800 ring-blue-200"
    if (k === "CONSUMED") return "bg-slate-200 text-slate-700 ring-slate-300"
    if (k === "QUARANTINE") return "bg-rose-100 text-rose-800 ring-rose-200"
    return "bg-slate-100 text-slate-700 ring-slate-200"
}

function roleTone(r: string): string {
    const k = r.toUpperCase()
    if (k === "REMAINDER") return "bg-amber-100 text-amber-800 ring-amber-200"
    if (k === "OUTPUT" || k === "SPLIT_OUTPUT") return "bg-blue-100 text-blue-800 ring-blue-200"
    if (k === "FG") return "bg-emerald-100 text-emerald-800 ring-emerald-200"
    return "bg-violet-100 text-violet-800 ring-violet-200"
}

// ─── Workspace ─────────────────────────────────────────────────────

export function RollsWorkspaceV36() {
    const [filters, setFilters] = React.useState<RollsFilterState>(DEFAULT_FILTERS)
    const [mode, setMode] = React.useState<"pulse" | "browse">("pulse")
    const [viewMode, setViewMode] = React.useState<ViewMode>("matrix")
    const [selectedRoll, setSelectedRoll] = React.useState<Roll | null>(null)
    const [matrixCell, setMatrixCell] = React.useState<{ row: string; col: number } | null>(null)
    const [pageSize, setPageSize] = React.useState(50)
    const [sort, setSort] = React.useState<{ key: string; dir: "asc" | "desc" }>({ key: "created_at", dir: "desc" })

    const savedViews = useSavedViews<RollsFilterState>("rolls", DEFAULT_VIEWS)

    const stockQuery = useQuery({
        queryKey: ["inventory-rolls"],
        queryFn: () => inventoryService.getInventorySnapshot(),
        staleTime: 30_000,
    })

    const allRolls: Roll[] = React.useMemo(() => stockQuery.data?.rolls || [], [stockQuery.data])

    // ─── Derive filter options from the dataset ─────────
    const variantFamilyOptions = React.useMemo(() => {
        const map = new Map<string, number>()
        for (const r of allRolls as any[]) {
            const k = String(r.material_code || r.variant_code || "").trim()
            if (!k) continue
            map.set(k, (map.get(k) || 0) + 1)
        }
        return Array.from(map.entries())
            .map(([id, count]) => ({ id, label: id, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 50)
    }, [allRolls])

    const plantOptions = React.useMemo(() => {
        const map = new Map<string, string>()
        map.set("ALL", "All plants")
        for (const r of allRolls as any[]) {
            const id = String(r.plant_id || r.plant || "")
            const name = r.plant_name || id
            if (id) map.set(id, String(name))
        }
        return Array.from(map.entries()).map(([id, label]) => ({ id, label }))
    }, [allRolls])

    const locationOptions = React.useMemo(() => {
        const map = new Map<string, { label: string; count: number }>()
        map.set("ALL", { label: "All locations", count: allRolls.length })
        for (const r of allRolls as any[]) {
            const id = String(r.location || r.location_id || r.location_code || "")
            if (!id) continue
            const cur = map.get(id) || { label: r.location_code || r.location_name || id, count: 0 }
            map.set(id, { label: cur.label, count: cur.count + 1 })
        }
        return Array.from(map.entries()).map(([id, v]) => ({ id, label: v.label, count: v.count }))
    }, [allRolls])

    // ─── Apply filters ───────────────────────────────────
    const filtered = React.useMemo(() => {
        const q = filters.search.trim().toLowerCase()
        return allRolls.filter((r: any) => {
            if (q) {
                const hay = [r.label_id, r.label, r.material_code, r.material_name, r.variant_code, r.lot_no, r.location_code, r.location_name, r.vendor_roll_label].some((v) => String(v || "").toLowerCase().includes(q))
                if (!hay) return false
            }
            if (filters.plant !== "ALL") {
                if (String(r.plant_id || r.plant || "") !== filters.plant) return false
            }
            if (filters.location !== "ALL") {
                const loc = String(r.location || r.location_id || r.location_code || "")
                if (loc !== filters.location) return false
            }
            if (filters.variantFamilies.length > 0) {
                const v = String(r.material_code || r.variant_code || "")
                if (!filters.variantFamilies.includes(v)) return false
            }
            if (filters.status !== "ALL") {
                if (String(r.status || "").toUpperCase() !== filters.status) return false
            }
            if (filters.role !== "ALL") {
                if (String(r.roll_role || "BASE").toUpperCase() !== filters.role) return false
            }
            if (filters.stockForm !== "ALL" && stockFormValue(r) !== filters.stockForm) return false
            const days = ageOf(r)
            if (filters.ageBucket === "FRESH" && days > 30) return false
            if (filters.ageBucket === "AGED" && (days <= 30 || days > 90)) return false
            if (filters.ageBucket === "OLD" && days <= 90) return false
            const w = Number(r.width_mm || 0)
            if (w < filters.width[0] || w > filters.width[1]) return false
            const th = Number(r.thickness_micron || r.thickness_um || 0)
            if (th < filters.thickness[0] || th > filters.thickness[1]) return false
            const wt = Number(r.net_weight_kg || r.weight_kg || 0)
            if (wt < filters.weight[0] || wt > filters.weight[1]) return false
            if (filters.behavior !== "ALL") {
                if (String(r.behavior_source || "").toUpperCase() !== filters.behavior) return false
            }
            return true
        })
    }, [allRolls, filters])

    // ─── Sort ────────────────────────────────────────────
    const sorted = React.useMemo(() => {
        const copy = filtered.slice()
        copy.sort((a: any, b: any) => {
            const av = a[sort.key]
            const bv = b[sort.key]
            const an = Number(av), bn = Number(bv)
            if (Number.isFinite(an) && Number.isFinite(bn)) return sort.dir === "asc" ? an - bn : bn - an
            return sort.dir === "asc" ? String(av || "").localeCompare(String(bv || "")) : String(bv || "").localeCompare(String(av || ""))
        })
        return copy
    }, [filtered, sort])

    // ─── KPI ─────────────────────────────────────────────
    const kpi = React.useMemo(() => {
        const total = filtered.length
        const totalKg = filtered.reduce((s: number, r: any) => s + Number(r.net_weight_kg || r.weight_kg || 0), 0)
        const reserved = filtered.filter((r: any) => String(r.status).toUpperCase() === "RESERVED").length
        const remainder = filtered.filter((r: any) => String(r.roll_role || "").toUpperCase() === "REMAINDER").length
        const openWeb = filtered.filter((r: any) => stockFormValue(r) === "OPEN_WEB").length
        const tubes = filtered.filter((r: any) => stockFormValue(r) === "LAYFLAT_TUBE").length
        const folded = filtered.filter((r: any) => stockFormValue(r) === "FOLDED_WEB").length
        const aged = filtered.filter((r: any) => ageOf(r) > 90).length
        return { total, totalKg, reserved, remainder, openWeb, tubes, folded, aged }
    }, [filtered])

    // ─── Filter chips for active state ──────────────────
    const chips = React.useMemo(() => {
        const list: { key: string; label: string; onClear: () => void }[] = []
        if (filters.search) list.push({ key: "search", label: `"${filters.search}"`, onClear: () => setFilters((f) => ({ ...f, search: "" })) })
        if (filters.plant !== "ALL") list.push({ key: "plant", label: `Plant · ${plantOptions.find((p) => p.id === filters.plant)?.label || filters.plant}`, onClear: () => setFilters((f) => ({ ...f, plant: "ALL" })) })
        if (filters.location !== "ALL") list.push({ key: "loc", label: `Location · ${filters.location}`, onClear: () => setFilters((f) => ({ ...f, location: "ALL" })) })
        if (filters.variantFamilies.length) list.push({ key: "vf", label: `Variants · ${filters.variantFamilies.length}`, onClear: () => setFilters((f) => ({ ...f, variantFamilies: [] })) })
        if (filters.status !== "ALL") list.push({ key: "status", label: `Status · ${filters.status}`, onClear: () => setFilters((f) => ({ ...f, status: "ALL" })) })
        if (filters.role !== "ALL") list.push({ key: "role", label: `Role · ${filters.role}`, onClear: () => setFilters((f) => ({ ...f, role: "ALL" })) })
        if (filters.stockForm !== "ALL") list.push({ key: "form", label: `Form · ${stockFormLabel(filters.stockForm)}`, onClear: () => setFilters((f) => ({ ...f, stockForm: "ALL" })) })
        if (filters.ageBucket !== "ALL") list.push({ key: "age", label: `Age · ${filters.ageBucket}`, onClear: () => setFilters((f) => ({ ...f, ageBucket: "ALL" })) })
        return list
    }, [filters, plantOptions])

    // ─── Build matrix when needed ────────────────────────
    const matrix = React.useMemo(() => {
        const rowSet = new Set<string>()
        const colSet = new Set<number>()
        const cells = new Map<string, { rollCount: number; totalKg: number; rolls: any[] }>()
        const rowTotals = new Map<string, { rollCount: number; totalKg: number }>()
        const colTotals = new Map<number, { rollCount: number; totalKg: number }>()
        let grandRolls = 0, grandKg = 0
        for (const r of filtered as any[]) {
            const variant = r.material_code || r.variant_code || "—"
            const width = r.width_mm ? ` · ${r.width_mm}mm` : ""
            const row = `${variant} · ${stockFormLabel(r.stock_form)}${width}`
            const col = Math.round(Number(r.thickness_micron || r.thickness_um || 0))
            if (!col) continue
            rowSet.add(row); colSet.add(col)
            const k = `${row}::${col}`
            const cur = cells.get(k) || { rollCount: 0, totalKg: 0, rolls: [] }
            const kg = Number(r.net_weight_kg || r.weight_kg || 0)
            cur.rollCount += 1; cur.totalKg += kg; cur.rolls.push(r)
            cells.set(k, cur)
            const rt = rowTotals.get(row) || { rollCount: 0, totalKg: 0 }
            rt.rollCount += 1; rt.totalKg += kg; rowTotals.set(row, rt)
            const ct = colTotals.get(col) || { rollCount: 0, totalKg: 0 }
            ct.rollCount += 1; ct.totalKg += kg; colTotals.set(col, ct)
            grandRolls += 1; grandKg += kg
        }
        const rows = Array.from(rowSet).sort((a, b) => a.localeCompare(b))
        const cols = Array.from(colSet).sort((a, b) => a - b)
        return { rows, cols, cells, rowTotals, colTotals, grand: { rollCount: grandRolls, totalKg: grandKg } }
    }, [filtered])

    // ─── Pulse-mode breakdowns ─────────────────────────────
    const pulseVariantBreakdown = React.useMemo(() => {
        const map = new Map<string, number>()
        for (const r of filtered as any[]) {
            const k = String(r.material_code || r.variant_code || "—")
            const kg = Number(r.net_weight_kg || r.weight_kg || 0)
            map.set(k, (map.get(k) || 0) + kg)
        }
        return Array.from(map.entries()).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)
    }, [filtered])

    const pulsePlantBreakdown = React.useMemo(() => {
        const map = new Map<string, number>()
        for (const r of filtered as any[]) {
            const k = String(r.plant_name || r.plant_id || "Unknown")
            const kg = Number(r.net_weight_kg || r.weight_kg || 0)
            map.set(k, (map.get(k) || 0) + kg)
        }
        return Array.from(map.entries()).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)
    }, [filtered])

    const pulseLocationBreakdown = React.useMemo(() => {
        const map = new Map<string, number>()
        for (const r of filtered as any[]) {
            const k = String(r.location_code || r.location_name || "—")
            const kg = Number(r.net_weight_kg || r.weight_kg || 0)
            map.set(k, (map.get(k) || 0) + kg)
        }
        return Array.from(map.entries()).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)
    }, [filtered])

    const pulseAgeing = React.useMemo(() => {
        let fresh = 0, aged = 0, old = 0
        for (const r of filtered as any[]) {
            const d = ageOf(r)
            if (d <= 30) fresh += 1
            else if (d <= 90) aged += 1
            else old += 1
        }
        return { fresh, aged, old }
    }, [filtered])

    // Pulse matrix: variant × thickness (kg per cell)
    const pulseMatrix = React.useMemo(() => {
        const rowSet = new Set<string>()
        const colSet = new Set<number>()
        const cells: Record<string, Record<string, number>> = {}
        for (const r of filtered as any[]) {
            const rl = `${String(r.material_code || r.variant_code || "—")} · ${stockFormLabel(r.stock_form)}`
            const tk = Math.round(Number(r.thickness_micron || r.thickness_um || 0))
            if (!tk) continue
            rowSet.add(rl); colSet.add(tk)
            cells[rl] = cells[rl] || {}
            cells[rl][String(tk)] = (cells[rl][String(tk)] || 0) + Number(r.net_weight_kg || r.weight_kg || 0)
        }
        const rows = Array.from(rowSet).sort()
        const cols = Array.from(colSet).sort((a, b) => a - b).map((c) => `${c}μ`)
        const reshaped: Record<string, Record<string, number>> = {}
        for (const k of Object.keys(cells)) {
            reshaped[k] = {}
            for (const t of Object.keys(cells[k])) reshaped[k][`${t}μ`] = cells[k][t]
        }
        return { title: "Variant × thickness (kg)", subtitle: "Heatmap by stock concentration", rowLabel: "variant", colLabel: "μ", rows, cols, cells: reshaped, unit: "kg" }
    }, [filtered])

    // Top list: heaviest variants
    const pulseTopList = React.useMemo(() => ({
        title: "Top variants by KG",
        subtitle: "Heaviest stock holdings",
        rows: pulseVariantBreakdown.slice(0, 8).map((v) => ({
            label: v.label,
            sub: `${pulsePlantBreakdown.length} plants · ${pulseLocationBreakdown.length} locations`,
            value: `${fmtNum(v.value, 0)} KG`,
        })),
    }), [pulseVariantBreakdown, pulsePlantBreakdown, pulseLocationBreakdown])

    // ─── Sort cycle ───────────────────────────────────────
    const onSortClick = (key: string) => {
        setSort((s) => s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" })
    }

    if (stockQuery.isError) {
        return (
            <div className="rounded-2xl border border-danger-border bg-danger-bg p-5 text-sm text-rose-900">
                <div className="font-bold">Could not load roll inventory.</div>
                <div className="mt-1 text-xs">{describeApiError(stockQuery.error, "Check backend and retry.")}</div>
            </div>
        )
    }

    return (
        <div className="space-y-4 pb-12">
            <ClassTabBar tabs={INVENTORY_CLASS_TABS} activeId="rolls" />
            <GradientHero
                eyebrow="Inventory · V3.6 · rolls"
                title="Roll workspace"
                subtitle="Variant × thickness matrix, every roll filterable by family, role, status, plant, age, and dimensions."
                palette="blue"
                chips={[
                    { icon: <Layers className="h-3.5 w-3.5" />, label: "Rolls", value: `${kpi.total}`, tone: "ok" },
                    { icon: <Disc className="h-3.5 w-3.5" />, label: "KG", value: fmtNum(kpi.totalKg, 0), tone: "violet" },
                    { icon: <Flame className="h-3.5 w-3.5" />, label: "Aged 90+", value: `${kpi.aged}`, tone: "warn" },
                ]}
                actions={
                    <div className="flex items-center gap-2">
                        <Link href="/inventory/grn" className="inline-flex items-center gap-1.5 rounded-xl bg-surface-1 px-4 py-1.5 text-xs font-bold text-blue-700 shadow-md hover:bg-blue-50">
                            <Plus className="h-3.5 w-3.5" /> Receive rolls
                        </Link>
                        <Link href="/inventory" className="inline-flex items-center gap-1.5 rounded-xl bg-white/15 px-4 py-1.5 text-xs font-bold text-white ring-1 ring-white/30 hover:bg-white/25">
                            ← Summary
                        </Link>
                    </div>
                }
            />

            {/* Mode toggle */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <ModeToggle mode={mode} onChange={setMode} />
                <span className="text-[11px] text-slate-500">
                    {mode === "pulse" ? "Analytics first · drill-down via Browse" : "Full filter rail · matrix / table / grid"}
                </span>
            </div>

            {/* Saved views */}
            <SavedViewsBar
                views={savedViews.views}
                activeId={savedViews.activeId}
                onSelect={(v) => { savedViews.setActiveId(v.id); setFilters(v.state) }}
                onDelete={savedViews.deleteView}
                onTogglePin={savedViews.togglePin}
                onSave={(name) => savedViews.saveView(name, filters)}
            />

            {mode === "pulse" && (
                <PulseViewV36
                    kpis={[
                        { label: "Rolls", value: fmtNum(kpi.total), sub: "visible rows", icon: <Layers className="h-3.5 w-3.5" />, trend: makeTrend(kpi.total, 12) },
                        { label: "On hand KG", value: fmtNum(kpi.totalKg, 0), sub: "filtered stock", icon: <Disc className="h-3.5 w-3.5" />, tone: "good", trend: makeTrend(kpi.totalKg, 12) },
                        { label: "Available", value: fmtNum(kpi.total - kpi.reserved), sub: "ready to use", icon: <Sparkles className="h-3.5 w-3.5" />, tone: "good", trend: makeTrend(kpi.total - kpi.reserved, 12) },
                        { label: "Reserved", value: fmtNum(kpi.reserved), sub: "held by SO", icon: <Sparkles className="h-3.5 w-3.5" />, tone: "warn", trend: makeTrend(kpi.reserved, 12) },
                        { label: "Open web", value: fmtNum(kpi.openWeb), sub: "sheet-form rolls", icon: <Boxes className="h-3.5 w-3.5" />, trend: makeTrend(kpi.openWeb, 12) },
                        { label: "Tubes", value: fmtNum(kpi.tubes), sub: "lay-flat tube", icon: <Boxes className="h-3.5 w-3.5" />, trend: makeTrend(kpi.tubes, 12) },
                        { label: "Folded", value: fmtNum(kpi.folded), sub: "folded web", icon: <Flame className="h-3.5 w-3.5" />, trend: makeTrend(kpi.folded, 12) },
                    ]}
                    statRow={[
                        { label: "Variants", value: fmtNum(pulseVariantBreakdown.length), sub: "unique families" },
                        { label: "Plants", value: fmtNum(pulsePlantBreakdown.length), sub: "with stock" },
                        { label: "Locations", value: fmtNum(pulseLocationBreakdown.length), sub: "warehouses + yards" },
                        { label: "Avg roll wt", value: kpi.total > 0 ? `${(kpi.totalKg / kpi.total).toFixed(1)} kg` : "—", sub: "per roll" },
                        { label: "Reservation %", value: kpi.total > 0 ? `${Math.round((kpi.reserved / kpi.total) * 100)}%` : "0%", sub: "rolls held", tone: kpi.reserved > 0 ? "warn" : "default" },
                        { label: "Remainders", value: fmtNum(kpi.remainder), sub: "reusable cuts", tone: "good" },
                    ]}
                    primaryBreakdown={{ title: "Variant / family · KG", entries: pulseVariantBreakdown, unit: "KG" }}
                    secondaryBreakdown={{ title: "Plant allocation", entries: pulsePlantBreakdown.slice(0, 10), unit: "KG" }}
                    ageing={pulseAgeing}
                    locationBreakdown={pulseLocationBreakdown}
                    matrix={pulseMatrix}
                    topList={pulseTopList}
                />
            )}

            {mode === "browse" && (
            <FilterBar
                search={filters.search}
                onSearchChange={(v) => setFilters((f) => ({ ...f, search: v }))}
                chips={chips}
                onClearAll={() => setFilters(DEFAULT_FILTERS)}
                viewMode={viewMode}
                onViewModeChange={(v) => setViewMode(v)}
                viewModes={["matrix", "table", "grid"]}
                onExport={() => window.open(inventoryService.getInventoryExportUrl("rolls"), "_blank", "noopener,noreferrer")}
                onConfigureColumns={() => alert("Column config UI coming next sprint")}
            />)}

            {mode === "browse" && (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
                <FilterRail>
                    {variantFamilyOptions.length > 0 && (
                        <MultiSelectPills
                            label="Variant / film code"
                            options={variantFamilyOptions}
                            selected={filters.variantFamilies}
                            onChange={(v) => setFilters((f) => ({ ...f, variantFamilies: v }))}
                        />
                    )}

                    <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-3">
                        <div className="mb-2 text-[10px] font-black uppercase tracking-wider text-blue-700">Size filters</div>
                        <div className="space-y-3">
                            <RangeFilter label="Thickness" min={0} max={200} step={1} value={filters.thickness} onChange={(v) => setFilters((f) => ({ ...f, thickness: v }))} suffix=" μ" />
                            <RangeFilter label="Width" min={0} max={3000} step={50} value={filters.width} onChange={(v) => setFilters((f) => ({ ...f, width: v }))} suffix=" mm" />
                            <RangeFilter label="Weight" min={0} max={1000} step={5} value={filters.weight} onChange={(v) => setFilters((f) => ({ ...f, weight: v }))} suffix=" kg" />
                        </div>
                    </div>

                    <FilterGroup
                        label="Status"
                        value={filters.status}
                        onChange={(id) => setFilters((f) => ({ ...f, status: id as StatusFilter }))}
                        options={[
                            { id: "ALL", label: "All" },
                            { id: "AVAILABLE", label: "Available", count: allRolls.filter((r: any) => String(r.status).toUpperCase() === "AVAILABLE").length },
                            { id: "RESERVED", label: "Reserved", count: allRolls.filter((r: any) => String(r.status).toUpperCase() === "RESERVED").length },
                            { id: "IN_PROCESS", label: "In process", count: allRolls.filter((r: any) => String(r.status).toUpperCase() === "IN_PROCESS").length },
                            { id: "CONSUMED", label: "Consumed", count: allRolls.filter((r: any) => String(r.status).toUpperCase() === "CONSUMED").length },
                            { id: "QUARANTINE", label: "Quarantine", count: allRolls.filter((r: any) => String(r.status).toUpperCase() === "QUARANTINE").length },
                        ]}
                    />

                    <FilterGroup
                        label="Role"
                        value={filters.role}
                        onChange={(id) => setFilters((f) => ({ ...f, role: id as RoleFilter }))}
                        options={[
                            { id: "ALL", label: "All" },
                            { id: "BASE", label: "Base / new" },
                            { id: "OUTPUT", label: "Output" },
                            { id: "REMAINDER", label: "Remainder ♻️" },
                            { id: "SPLIT_OUTPUT", label: "Split output" },
                            { id: "FG", label: "Finished" },
                        ]}
                    />

                    <FilterGroup
                        label="Stock form"
                        value={filters.stockForm}
                        onChange={(id) => setFilters((f) => ({ ...f, stockForm: id as StockFormFilter }))}
                        options={[
                            { id: "ALL", label: "All forms" },
                            { id: "OPEN_WEB", label: "Open web", count: allRolls.filter((r: any) => stockFormValue(r) === "OPEN_WEB").length },
                            { id: "LAYFLAT_TUBE", label: "Lay-flat tube", count: allRolls.filter((r: any) => stockFormValue(r) === "LAYFLAT_TUBE").length },
                            { id: "FOLDED_WEB", label: "Folded web", count: allRolls.filter((r: any) => stockFormValue(r) === "FOLDED_WEB").length },
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

                    <FilterGroup
                        label="Age"
                        value={filters.ageBucket}
                        onChange={(id) => setFilters((f) => ({ ...f, ageBucket: id as AgeBucket }))}
                        columns={2}
                        options={[
                            { id: "ALL", label: "All" },
                            { id: "FRESH", label: "≤30 d" },
                            { id: "AGED", label: "31–90" },
                            { id: "OLD", label: "90+ d" },
                        ]}
                    />

                    <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-3">
                        <div className="text-[10px] font-black uppercase tracking-wider text-blue-700">Quick actions</div>
                        <div className="mt-2 grid grid-cols-2 gap-1.5">
                            <Link href="/inventory/traceability" className="rounded-md bg-surface-1 px-2 py-1 text-[10px] font-bold text-blue-700 ring-1 ring-blue-200 text-center hover:bg-blue-100">
                                <GitBranch className="inline-block h-3 w-3 mr-1 -mt-0.5" /> Trace
                            </Link>
                            <Link href="/inventory/inter-plant" className="rounded-md bg-surface-1 px-2 py-1 text-[10px] font-bold text-blue-700 ring-1 ring-blue-200 text-center hover:bg-blue-100">
                                Move →
                            </Link>
                        </div>
                    </div>
                </FilterRail>

                {/* Main content */}
                <main className="space-y-5">
                    {viewMode === "matrix" && (
                        <MatrixView matrix={matrix} loading={stockQuery.isLoading} onCellClick={(row, col) => setMatrixCell({ row, col })} />
                    )}
                    {viewMode === "table" && (
                        <TableView rolls={sorted.slice(0, pageSize)} total={sorted.length} pageSize={pageSize} onPageSize={setPageSize} sort={sort} onSort={onSortClick} loading={stockQuery.isLoading} onSelect={setSelectedRoll} />
                    )}
                    {viewMode === "grid" && (
                        <GridView rolls={sorted.slice(0, pageSize)} total={sorted.length} pageSize={pageSize} onPageSize={setPageSize} loading={stockQuery.isLoading} onSelect={setSelectedRoll} />
                    )}
                </main>
            </div>)}

            {/* Drawers */}
            {matrixCell && (
                <CellDrawer
                    row={matrixCell.row}
                    col={matrixCell.col}
                    cell={matrix.cells.get(`${matrixCell.row}::${matrixCell.col}`)}
                    onClose={() => setMatrixCell(null)}
                    onPickRoll={(r) => { setMatrixCell(null); setSelectedRoll(r) }}
                />
            )}
            {selectedRoll && (
                <RollDrawer roll={selectedRoll} onClose={() => setSelectedRoll(null)} />
            )}
        </div>
    )
}

// ─── Matrix view ───────────────────────────────────────────────────

function MatrixView({ matrix, loading, onCellClick }: { matrix: any; loading: boolean; onCellClick: (row: string, col: number) => void }) {
    if (loading) return <SkeletonBlock />
    if (matrix.rows.length === 0) return <EmptyState text="No rolls match these filters" />
    return (
        <WorkspaceSection
            title="Variant × thickness matrix"
            eyebrow={`${matrix.grand.rollCount} rolls · ${fmtNum(matrix.grand.totalKg, 0)} KG`}
            subtitle="Each row includes stock form. Each cell = roll count; color = stock concentration."
            tone="violet"
            icon={<span>🌀</span>}
            actions={
                <div className="flex items-center gap-1.5 text-[11px]">
                    <span className="rounded bg-emerald-100 px-1.5 py-0.5 font-bold text-emerald-800">●●●●</span>
                    <span className="text-slate-500">more stock</span>
                    <span className="rounded bg-success-bg px-1.5 py-0.5 font-bold text-success-fg">●●●</span>
                    <span className="rounded bg-blue-50 px-1.5 py-0.5 font-bold text-blue-700">●</span>
                    <span className="text-slate-500">less stock</span>
                </div>
            }
        >
            <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                    <thead>
                        <tr className="border-b border-slate-200 text-slate-500">
                            <th className="sticky left-0 bg-surface-1 px-4 py-2 text-left font-bold uppercase tracking-wider">Variant / size</th>
                            {matrix.cols.map((c: number) => (
                                <th key={c} className="px-3 py-2 text-center font-mono font-bold">{c}μ</th>
                            ))}
                            <th className="px-3 py-2 text-center font-bold uppercase">Total</th>
                            <th className="px-3 py-2 text-right font-bold uppercase">KG</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {matrix.rows.map((row: string) => {
                            const rowTotal = matrix.rowTotals.get(row)
                            return (
                                <tr key={row} className="hover:bg-violet-50/30">
                                    <td className="sticky left-0 bg-surface-1 hover:bg-violet-50/30 px-4 py-1.5 text-[11px] font-medium text-slate-700 truncate max-w-[280px]" title={row}>{row}</td>
                                    {matrix.cols.map((col: number) => {
                                        const cell = matrix.cells.get(`${row}::${col}`)
                                        if (!cell || cell.rollCount === 0) {
                                            return <td key={col} className="px-2 py-1.5 text-center"><span className="inline-flex h-7 w-12 items-center justify-center rounded-md bg-slate-50 text-[10px] text-slate-300">—</span></td>
                                        }
                                        const intensity = intensityFor(cell.totalKg)
                                        const TONE: Record<string, string> = {
                                            "1": "bg-blue-50 text-blue-800 ring-1 ring-blue-200",
                                            "2": "bg-success-bg text-emerald-800 ring-1 ring-emerald-200",
                                            "3": "bg-emerald-100 text-emerald-900 ring-1 ring-emerald-300",
                                            "4": "bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-sm",
                                        }
                                        return (
                                            <td key={col} className="px-2 py-1.5 text-center">
                                                <button onClick={() => onCellClick(row, col)} className={cn("inline-flex h-7 w-12 items-center justify-center rounded-md font-bold cursor-pointer hover:opacity-80", TONE[intensity])} title={`${cell.rollCount} rolls · ${fmtNum(cell.totalKg, 0)} KG`}>
                                                    {cell.rollCount}
                                                </button>
                                            </td>
                                        )
                                    })}
                                    <td className="px-3 py-1.5 text-center"><span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-0.5 font-bold text-blue-800 ring-1 ring-blue-200">{rowTotal?.rollCount ?? 0}</span></td>
                                    <td className="px-3 py-1.5 text-right font-mono font-bold text-content-2">{fmtNum(rowTotal?.totalKg ?? 0, 0)}</td>
                                </tr>
                            )
                        })}
                    </tbody>
                    <tfoot className="bg-slate-50/60">
                        <tr>
                            <td className="sticky left-0 bg-slate-50/60 px-4 py-2 text-right text-[10px] font-black uppercase tracking-wider text-content-3">Total</td>
                            {matrix.cols.map((c: number) => (
                                <td key={c} className="px-3 py-2 text-center font-mono font-bold text-slate-700">{matrix.colTotals.get(c)?.rollCount ?? 0}</td>
                            ))}
                            <td className="px-3 py-2 text-center"><span className="rounded-md bg-blue-100 px-2 py-0.5 font-bold text-blue-900 ring-1 ring-blue-300">{matrix.grand.rollCount}</span></td>
                            <td className="px-3 py-2 text-right font-mono font-bold text-success-fg">{fmtNum(matrix.grand.totalKg, 0)} KG</td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        </WorkspaceSection>
    )
}

// ─── Table view ────────────────────────────────────────────────────

function TableView({ rolls, total, pageSize, onPageSize, sort, onSort, loading, onSelect }: { rolls: any[]; total: number; pageSize: number; onPageSize: (n: number) => void; sort: { key: string; dir: string }; onSort: (k: string) => void; loading: boolean; onSelect: (r: any) => void }) {
    if (loading) return <SkeletonBlock />
    if (rolls.length === 0) return <EmptyState text="No rolls match these filters" />
    const Th = ({ k, label, align }: { k: string; label: string; align?: string }) => (
        <th className={cn("px-3 py-2 text-[10px] font-black uppercase tracking-wider text-slate-500", align || "text-left")}>
            <button onClick={() => onSort(k)} className="inline-flex items-center gap-1 hover:text-blue-700">
                {label} <ArrowUpDown className="h-3 w-3 opacity-50" />
                {sort.key === k && <span className="text-[8px] text-blue-600">{sort.dir === "asc" ? "▲" : "▼"}</span>}
            </button>
        </th>
    )
    return (
        <WorkspaceSection title="All rolls" eyebrow={`${rolls.length} of ${total} shown`} tone="violet" icon={<Layers className="h-4 w-4" />}>
            <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                    <thead className="bg-slate-50/40 border-b border-slate-200">
                        <tr>
                            <Th k="label_id" label="Roll #" />
                            <Th k="material_name" label="Material" />
                            <Th k="stock_form" label="Form" />
                            <Th k="width_mm" label="Width" align="text-right" />
                            <Th k="thickness_micron" label="Thickness" align="text-right" />
                            <Th k="net_weight_kg" label="Weight" align="text-right" />
                            <Th k="status" label="Status" />
                            <Th k="roll_role" label="Role" />
                            <Th k="location_code" label="Location" />
                            <Th k="created_at" label="Created" />
                            <th className="px-3 py-2 text-right text-[10px] font-black uppercase tracking-wider text-slate-500">Action</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {rolls.map((r: any, i: number) => (
                            <tr key={r.id || i} className="hover:bg-blue-50/30 cursor-pointer" onClick={() => onSelect(r)}>
                                <td className="px-3 py-2 font-mono text-[11px] font-bold text-blue-700">{r.label_id || r.label || "—"}</td>
                                <td className="px-3 py-2"><div className="font-bold text-slate-900">{r.material_code || "—"}</div><div className="text-[10px] text-slate-500 truncate max-w-[180px]">{r.material_name || ""}</div></td>
                                <td className="px-3 py-2"><span className={cn("rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase ring-1", stockFormTone(r.stock_form))}>{stockFormLabel(r.stock_form)}</span></td>
                                <td className="px-3 py-2 text-right font-mono text-slate-700">{fmtNum(Number(r.width_mm || 0))} mm</td>
                                <td className="px-3 py-2 text-right font-mono text-slate-700">{fmtNum(Number(r.thickness_micron || r.thickness_um || 0))} μ</td>
                                <td className="px-3 py-2 text-right font-mono font-bold text-slate-900">{fmtNum(Number(r.net_weight_kg || r.weight_kg || 0), 2)}</td>
                                <td className="px-3 py-2"><span className={cn("rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase ring-1", statusTone(r.status || ""))}>{r.status || "—"}</span></td>
                                <td className="px-3 py-2"><span className={cn("rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase ring-1", roleTone(r.roll_role || ""))}>{r.roll_role || "BASE"}</span></td>
                                <td className="px-3 py-2 font-mono text-[10px] text-content-3">{r.location_code || r.location || "—"}</td>
                                <td className="px-3 py-2 text-[10px] text-slate-500">{r.created_at ? new Date(r.created_at).toLocaleDateString() : "—"}</td>
                                <td className="px-3 py-2 text-right">
                                    <button onClick={(e) => { e.stopPropagation(); onSelect(r) }} className="inline-flex items-center gap-0.5 rounded-md bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-700 ring-1 ring-blue-200 hover:bg-blue-100">
                                        <Eye className="h-3 w-3" /> View
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/40 px-5 py-2 text-[11px]">
                <span className="text-slate-500">Showing {rolls.length} of {total}</span>
                <div className="flex items-center gap-2">
                    <span className="text-slate-500">Page size</span>
                    <select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))} className="rounded-md border border-slate-200 bg-surface-1 px-2 py-0.5 font-mono text-[11px]">
                        {[25, 50, 100, 250, 500].map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                </div>
            </div>
        </WorkspaceSection>
    )
}

// ─── Grid view ─────────────────────────────────────────────────────

function GridView({ rolls, total, pageSize, onPageSize, loading, onSelect }: { rolls: any[]; total: number; pageSize: number; onPageSize: (n: number) => void; loading: boolean; onSelect: (r: any) => void }) {
    if (loading) return <SkeletonBlock />
    if (rolls.length === 0) return <EmptyState text="No rolls match these filters" />
    return (
        <WorkspaceSection title="Card view" eyebrow={`${rolls.length} of ${total} cards`} tone="blue" icon={<Disc className="h-4 w-4" />}>
            <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                {rolls.map((r: any) => (
                    <button key={r.id} onClick={() => onSelect(r)} className="text-left rounded-2xl border border-slate-200 bg-surface-1 p-3 shadow-sm hover:shadow-lg hover:border-blue-300">
                        <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                                <div className="font-mono text-[11px] font-bold text-blue-700 truncate">{r.label_id || r.label}</div>
                                <div className="text-[10px] text-slate-500 truncate">{r.material_code || "—"} · {r.material_name || ""}</div>
                            </div>
                            <span className={cn("rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase ring-1", statusTone(r.status || ""))}>{r.status || "—"}</span>
                        </div>
                        <div className="mt-2">
                            <span className={cn("rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase ring-1", stockFormTone(r.stock_form))}>{stockFormLabel(r.stock_form)}</span>
                        </div>
                        <div className="mt-3 grid grid-cols-3 gap-1.5 rounded-lg bg-slate-50/80 p-2">
                            <div className="text-center"><div className="text-[8px] font-black uppercase text-slate-500">Width</div><div className="font-mono text-[11px] font-bold text-slate-900">{fmtNum(Number(r.width_mm || 0))}<span className="text-[9px] text-slate-500">mm</span></div></div>
                            <div className="text-center"><div className="text-[8px] font-black uppercase text-slate-500">Thick</div><div className="font-mono text-[11px] font-bold text-slate-900">{fmtNum(Number(r.thickness_micron || 0))}<span className="text-[9px] text-slate-500">μ</span></div></div>
                            <div className="text-center"><div className="text-[8px] font-black uppercase text-slate-500">Weight</div><div className="font-mono text-[11px] font-bold text-slate-900">{fmtNum(Number(r.net_weight_kg || r.weight_kg || 0), 1)}<span className="text-[9px] text-slate-500">kg</span></div></div>
                        </div>
                        <div className="mt-2 flex items-center justify-between text-[10px]">
                            <span className={cn("rounded-md px-1.5 py-0.5 font-bold uppercase ring-1", roleTone(r.roll_role || ""))}>{r.roll_role || "BASE"}</span>
                            <span className="font-mono text-slate-500"><MapPin className="inline-block h-3 w-3 mr-0.5 -mt-0.5" />{r.location_code || "—"}</span>
                        </div>
                    </button>
                ))}
            </div>
            <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/40 px-5 py-2 text-[11px]">
                <span className="text-slate-500">Showing {rolls.length} of {total}</span>
                <select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))} className="rounded-md border border-slate-200 bg-surface-1 px-2 py-0.5 font-mono text-[11px]">
                    {[24, 48, 96, 200].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
            </div>
        </WorkspaceSection>
    )
}

// ─── Drawers ───────────────────────────────────────────────────────

function CellDrawer({ row, col, cell, onClose, onPickRoll }: { row: string; col: number; cell?: any; onClose: () => void; onPickRoll: (r: any) => void }) {
    return (
        <div className="fixed inset-0 z-40 flex justify-end" onClick={onClose}>
            <div className="absolute inset-0 bg-black/40" />
            <div className="relative z-50 h-full w-full max-w-md overflow-y-auto border-l border-slate-200 bg-surface-1 shadow-2xl" onClick={(e) => e.stopPropagation()}>
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
                            <div className="rounded-lg bg-slate-50 px-2.5 py-1.5"><div className="text-[9px] font-black uppercase text-slate-500">Total KG</div><div className="font-display text-base font-bold text-slate-900">{fmtNum(cell.totalKg, 0)}</div></div>
                        </div>
                    )}
                </div>
                <div className="px-5 py-4">
                    <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500 mb-2">Individual rolls</div>
                    {!cell || cell.rollCount === 0 ? (
                        <div className="text-xs text-slate-500 italic">No rolls in this cell.</div>
                    ) : (
                        <div className="space-y-2">
                            {cell.rolls.slice(0, 50).map((r: any, i: number) => (
                                <button key={r.id || i} onClick={() => onPickRoll(r)} className="w-full text-left rounded-xl border border-slate-200 bg-surface-1 px-3 py-2 shadow-sm hover:shadow-md hover:border-blue-300">
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0">
                                            <div className="font-mono text-xs font-bold text-blue-700 truncate">{r.label_id || r.label || r.id}</div>
                                            <div className="text-[10px] text-slate-500 truncate">{r.location_code || r.location || "—"} · {r.status || "—"}</div>
                                        </div>
                                        <div className="font-mono text-xs font-bold text-content-2">{fmtNum(Number(r.net_weight_kg || r.weight_kg || 0), 2)} KG</div>
                                    </div>
                                </button>
                            ))}
                            {cell.rollCount > 50 && (<div className="text-center text-[10px] text-content-4 mt-2">+ {cell.rollCount - 50} more</div>)}
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

function RollDrawer({ roll, onClose }: { roll: any; onClose: () => void }) {
    return (
        <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
            <div className="absolute inset-0 bg-black/40" />
            <div className="relative z-50 h-full w-full max-w-md overflow-y-auto border-l border-slate-200 bg-surface-1 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="sticky top-0 z-10 border-b border-slate-100 bg-gradient-to-r from-blue-50 via-white to-white px-5 py-4">
                    <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-blue-700">Roll detail</div>
                            <div className="font-mono font-display text-lg font-bold text-blue-700 truncate">{roll.label_id || roll.label}</div>
                            <div className="text-[11px] text-slate-500">{roll.material_code || "—"} · {roll.material_name || ""}</div>
                        </div>
                        <button onClick={onClose} className="rounded-lg p-1 hover:bg-slate-100"><X className="h-4 w-4 text-slate-500" /></button>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                        <span className={cn("rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ring-1", statusTone(roll.status || ""))}>{roll.status || "—"}</span>
                        <span className={cn("rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ring-1", roleTone(roll.roll_role || ""))}>{roll.roll_role || "BASE"}</span>
                        <span className={cn("rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ring-1", stockFormTone(roll.stock_form))}>{stockFormLabel(roll.stock_form)}</span>
                        {roll.behavior_source && <span className="rounded-md bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-700 ring-1 ring-slate-200">{roll.behavior_source}</span>}
                    </div>
                </div>
                <div className="px-5 py-4 space-y-4">
                    <div className="grid grid-cols-3 gap-2 text-[11px]">
                        <Stat label="Net" value={`${fmtNum(Number(roll.net_weight_kg || roll.weight_kg || 0), 2)} kg`} />
                        <Stat label="Original" value={`${fmtNum(Number(roll.original_weight_kg || roll.weight_kg || 0), 2)} kg`} />
                        <Stat label="Width" value={`${fmtNum(Number(roll.width_mm || 0))} mm`} />
                        <Stat label="Thickness" value={`${fmtNum(Number(roll.thickness_micron || 0))} μ`} />
                        <Stat label="Form" value={stockFormLabel(roll.stock_form)} />
                        <Stat label="Length" value={`${fmtNum(Number(roll.length_m || 0))} m`} />
                        <Stat label="Core" value={`${roll.core_size_inch || "—"}″`} />
                    </div>

                    <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500 mb-2">Where</div>
                        <div className="grid grid-cols-2 gap-2 text-[11px]">
                            <Field label="Plant" value={roll.plant_name || "—"} icon={<Factory className="h-3 w-3 text-blue-500" />} />
                            <Field label="Location" value={roll.location_code || roll.location_name || "—"} icon={<MapPin className="h-3 w-3 text-blue-500" />} />
                            <Field label="Stage" value={roll.stage_name || "—"} />
                            <Field label="Vendor" value={roll.vendor_roll_label || roll.vendor_name || "—"} />
                        </div>
                    </div>

                    <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500 mb-2">Lifecycle</div>
                        <div className="rounded-xl border border-slate-200 bg-slate-50/40 p-3 space-y-1 text-[11px]">
                            <div className="flex items-center justify-between"><span className="text-slate-500">Created</span><span className="font-mono">{roll.created_at ? new Date(roll.created_at).toLocaleString() : "—"}</span></div>
                            <div className="flex items-center justify-between"><span className="text-slate-500">Age</span><span className="font-mono">{Math.floor(ageOf(roll))} d</span></div>
                            <div className="flex items-center justify-between"><span className="text-slate-500">Reserved for</span><span className="font-mono">{roll.reserved_for_so_id || roll.reserved_for_job || "—"}</span></div>
                        </div>
                    </div>

                    <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center gap-2">
                        <Link href={`/inventory/traceability?q=${encodeURIComponent(roll.label_id || roll.id)}`} className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-blue-700">
                            <GitBranch className="h-3 w-3" /> Trace lineage
                        </Link>
                        <Link href={`/inventory?focus=${encodeURIComponent(roll.id)}`} className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-[11px] font-bold text-slate-700 hover:bg-slate-200">
                            Stock card <ArrowRight className="h-3 w-3" />
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    )
}

function Stat({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-lg bg-slate-50/80 px-2.5 py-1.5 ring-1 ring-slate-100">
            <div className="text-[9px] font-black uppercase tracking-wider text-slate-500">{label}</div>
            <div className="mt-0.5 font-mono text-sm font-bold text-slate-900">{value}</div>
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

function SkeletonBlock() {
    return (
        <div className="rounded-2xl border border-slate-200 bg-surface-1 p-5 shadow-sm">
            <div className="h-4 w-40 animate-pulse rounded bg-slate-200" />
            <div className="mt-3 h-32 animate-pulse rounded-xl bg-slate-100" />
        </div>
    )
}

function EmptyState({ text }: { text: string }) {
    return (
        <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-surface-1 p-10 text-center">
            <Boxes className="mx-auto h-8 w-8 text-slate-300" />
            <div className="mt-2 text-sm font-semibold text-slate-700">{text}</div>
            <div className="mt-1 text-xs text-slate-500">Adjust filters or clear search to see more.</div>
        </div>
    )
}

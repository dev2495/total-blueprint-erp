"use client"

/**
 * V3.6 Product Master list workspace.
 *
 * Two-column layout: sticky filter rail (left) + grid of master cards (right).
 *
 * Cards show:
 *   - kind icon + master code + name
 *   - capability badges (catalog-axes, print)
 *   - 4-col KPI strip (sizes / axes / variants / overlays)
 *   - health pill derived from variants_count + stock data
 *   - last-activity hint + open arrow
 *
 * All data comes from productMasterService.list() (real backend with mock fallback).
 */

import * as React from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import {
    AlertTriangle,
    ArrowRight,
    Boxes,
    Clock,
    Layers,
    Package,
    PackageCheck,
    Palette,
    Plus,
    Search,
    Sparkles,
    Users,
    UserSquare,
    X,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { GradientHero } from "@/components/erp-v3/gradient-hero"
import {
    productMasterService,
    type ProductKind,
    type ProductMaster,
} from "@/services/product-master"
import { ProductMasterCreateModal } from "./product-master-create-modal"
import { cn } from "@/lib/utils"

// ─── Helpers ───────────────────────────────────────────────────

const KIND_META: Record<string, { icon: React.ReactNode; tone: string; accent: string; ring: string; iconBg: string; barAccent: string }> = {
    POUCH:    { icon: <Package className="h-4 w-4" />,      tone: "bg-blue-50 text-blue-700 ring-blue-200",       accent: "border-l-blue-500",    ring: "ring-blue-100",    iconBg: "bg-blue-100 text-blue-700",       barAccent: "from-blue-50/80" },
    ROLL:     { icon: <Layers className="h-4 w-4" />,       tone: "bg-emerald-50 text-emerald-700 ring-emerald-200", accent: "border-l-emerald-500", ring: "ring-emerald-100", iconBg: "bg-emerald-100 text-emerald-700", barAccent: "from-emerald-50/80" },
    POD:      { icon: <PackageCheck className="h-4 w-4" />, tone: "bg-violet-50 text-violet-700 ring-violet-200", accent: "border-l-violet-500",  ring: "ring-violet-100",  iconBg: "bg-violet-100 text-violet-700",   barAccent: "from-violet-50/80" },
    PACKAGING:{ icon: <Boxes className="h-4 w-4" />,        tone: "bg-amber-50 text-amber-700 ring-amber-200",    accent: "border-l-amber-500",   ring: "ring-amber-100",   iconBg: "bg-amber-100 text-amber-700",     barAccent: "from-amber-50/60" },
    BULK:     { icon: <Sparkles className="h-4 w-4" />,     tone: "bg-slate-50 text-slate-700 ring-slate-200",    accent: "border-l-slate-400",   ring: "ring-slate-100",   iconBg: "bg-slate-100 text-slate-700",     barAccent: "from-slate-50/80" },
    OTHER:    { icon: <Palette className="h-4 w-4" />,      tone: "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200", accent: "border-l-fuchsia-500", ring: "ring-fuchsia-100", iconBg: "bg-fuchsia-100 text-fuchsia-700", barAccent: "from-fuchsia-50/80" },
}

interface KindFilter { id: "ALL" | ProductKind; label: string; emoji: string }
const KIND_FILTERS: KindFilter[] = [
    { id: "ALL",       label: "All",       emoji: "✦" },
    { id: "POUCH",     label: "Pouch",     emoji: "🧴" },
    { id: "ROLL",      label: "Roll",      emoji: "🌀" },
    { id: "PACKAGING", label: "Packaging", emoji: "📥" },
    { id: "POD",       label: "POD",       emoji: "📦" },
    { id: "OTHER",     label: "Other",     emoji: "✨" },
]

const REPORTING_OPTS = ["FG", "FILM", "LAMINATED", "SEMI_FG", "PACKAGING", "POD", "PRINTED", "OTHER"]

// Health derived from variants_count vs activity (mock heuristic; backend will replace).
function deriveHealth(m: ProductMaster): { pct: number; label: "Healthy" | "OK" | "Low"; tone: string } {
    const v = m.variants_count ?? 0
    if (!m.active) return { pct: 0, label: "Low", tone: "bg-rose-50 text-rose-700 ring-rose-200" }
    if (v >= 10) return { pct: 86, label: "Healthy", tone: "bg-emerald-50 text-emerald-700 ring-emerald-200" }
    if (v >= 3)  return { pct: 68, label: "OK",      tone: "bg-amber-50 text-amber-700 ring-amber-200" }
    return { pct: 35, label: "Low", tone: "bg-rose-50 text-rose-700 ring-rose-200" }
}

function timeAgo(iso?: string): string {
    if (!iso) return "—"
    const t = new Date(iso).getTime()
    if (Number.isNaN(t)) return "—"
    const days = Math.floor((Date.now() - t) / (1000 * 60 * 60 * 24))
    if (days <= 0) return "today"
    if (days === 1) return "1d ago"
    if (days < 14) return `${days}d ago`
    if (days < 60) return `${Math.floor(days/7)}w ago`
    return `${Math.floor(days/30)}mo ago`
}

// ─── Workspace ───────────────────────────────────────────────────

export function ProductMasterListWorkspace() {
    const [search, setSearch] = React.useState("")
    const [kind, setKind] = React.useState<"ALL" | ProductKind>("ALL")
    const [reporting, setReporting] = React.useState<string>("ALL")
    const [showInactive, setShowInactive] = React.useState(false)
    const [printOnly, setPrintOnly] = React.useState(false)
    const [catalogOnly, setCatalogOnly] = React.useState(false)
    const [overlaysOnly, setOverlaysOnly] = React.useState(false)
    const [createOpen, setCreateOpen] = React.useState(false)

    const { data: masters = [], isLoading } = useQuery({
        queryKey: ["product-masters", kind],
        queryFn: () => productMasterService.list({ product_kind: kind === "ALL" ? undefined : kind }),
        staleTime: 30_000,
    })

    const filtered = React.useMemo(() => {
        return masters.filter((m) => {
            if (!showInactive && !m.active) return false
            if (reporting !== "ALL" && m.default_reporting_group !== reporting) return false
            if (printOnly && !m.fixed_attributes?.print_capable) return false
            if (catalogOnly && !(m.variant_axes || []).some((a: any) => a.master_data_source)) return false
            if (overlaysOnly && (m.overlays_count || 0) === 0) return false
            if (search.trim()) {
                const q = search.toLowerCase()
                return (
                    m.code.toLowerCase().includes(q) ||
                    m.name.toLowerCase().includes(q) ||
                    (m.description || "").toLowerCase().includes(q) ||
                    (m.template_name || "").toLowerCase().includes(q)
                )
            }
            return true
        })
    }, [masters, kind, reporting, search, showInactive, printOnly, catalogOnly, overlaysOnly])

    const totals = React.useMemo(() => {
        const byKind: Record<string, number> = {}
        masters.forEach((m) => { byKind[m.product_kind] = (byKind[m.product_kind] || 0) + 1 })
        const variants = masters.reduce((s, m) => s + (m.variants_count || 0), 0)
        const overlays = masters.reduce((s, m) => s + (m.overlays_count || 0), 0)
        const printable = masters.filter((m) => m.fixed_attributes?.print_capable).length
        const catalogBacked = masters.filter((m) => (m.variant_axes || []).some((a: any) => a.master_data_source)).length
        return { byKind, variants, overlays, printable, catalogBacked }
    }, [masters])

    return (
        <div className="space-y-5">
            {/* Hero */}
            <GradientHero
                eyebrow="Master · Catalog"
                title="Product Master"
                subtitle="One master = one stable recipe. Variants auto-deduped at order time. Catalog-backed axes pull values live from master-data."
                palette="blue"
                chips={[
                    { icon: <Package className="h-3.5 w-3.5" />, label: "Masters", value: `${masters.length}`, tone: "ok" },
                    { icon: <Layers className="h-3.5 w-3.5" />, label: "Variants 90d", value: `${totals.variants}`, tone: "ok" },
                    { icon: <Users className="h-3.5 w-3.5" />, label: "Overlays", value: `${totals.overlays}` },
                    { icon: <Palette className="h-3.5 w-3.5" />, label: "Print capable", value: `${totals.printable}` },
                    { icon: <Sparkles className="h-3.5 w-3.5" />, label: "Catalog-axes", value: `${totals.catalogBacked}`, tone: "violet" },
                ]}
                actions={
                    <Button
                        onClick={() => setCreateOpen(true)}
                        className="gap-1.5 rounded-xl bg-white px-4 text-blue-700 shadow-md hover:bg-blue-50"
                    >
                        <Plus className="h-4 w-4" /> New Product Master
                    </Button>
                }
            />

            {/* 2-column layout */}
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">

                {/* ─── Filter rail (sticky) ─── */}
                <aside className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex items-center justify-between">
                        <span className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Filters</span>
                        <button
                            onClick={() => { setSearch(""); setKind("ALL"); setReporting("ALL"); setShowInactive(false); setPrintOnly(false); setCatalogOnly(false); setOverlaysOnly(false) }}
                            className="text-[10px] font-bold text-blue-600 hover:underline"
                        >
                            Clear all
                        </button>
                    </div>
                    {/* Search */}
                    <div className="relative mt-3">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <Input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search code or name…"
                            className="h-10 rounded-xl border-slate-200 bg-slate-50 pl-9 text-sm shadow-sm focus:bg-white"
                        />
                        {search && (
                            <button onClick={() => setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700">
                                <X className="h-4 w-4" />
                            </button>
                        )}
                    </div>

                    {/* Kind */}
                    <div className="mt-4">
                        <div className="mb-1.5 text-[10px] font-black uppercase tracking-wider text-slate-500">Kind</div>
                        <div className="flex flex-wrap gap-1.5">
                            {KIND_FILTERS.map((f) => {
                                const active = f.id === kind
                                const count = f.id === "ALL" ? masters.length : (totals.byKind[f.id] || 0)
                                return (
                                    <button
                                        key={f.id}
                                        onClick={() => setKind(f.id)}
                                        className={cn(
                                            "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold ring-1 ring-inset transition",
                                            active ? "bg-blue-600 text-white ring-blue-700" : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50"
                                        )}
                                    >
                                        <span>{f.emoji}</span>{f.label} <span className="opacity-60">{count}</span>
                                    </button>
                                )
                            })}
                        </div>
                    </div>

                    {/* Reporting group */}
                    <div className="mt-4">
                        <div className="mb-1.5 text-[10px] font-black uppercase tracking-wider text-slate-500">Reporting group</div>
                        <select
                            value={reporting}
                            onChange={(e) => setReporting(e.target.value)}
                            className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-mono shadow-sm"
                        >
                            <option value="ALL">All groups</option>
                            {REPORTING_OPTS.map((r) => <option key={r} value={r}>{r}</option>)}
                        </select>
                    </div>

                    {/* Capabilities */}
                    <div className="mt-4">
                        <div className="mb-1.5 text-[10px] font-black uppercase tracking-wider text-slate-500">Capabilities</div>
                        <FilterCheck checked={catalogOnly} onChange={setCatalogOnly} label="Catalog-backed axes" count={totals.catalogBacked} accent="violet" />
                        <FilterCheck checked={printOnly} onChange={setPrintOnly} label="Print capable" count={totals.printable} accent="fuchsia" />
                        <FilterCheck checked={overlaysOnly} onChange={setOverlaysOnly} label="Has overlays" count={masters.filter(m => (m.overlays_count||0) > 0).length} accent="amber" />
                        <FilterCheck checked={showInactive} onChange={setShowInactive} label="Include inactive" count={masters.filter(m => !m.active).length} accent="slate" />
                    </div>

                    <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2 text-[11px]">
                        <div className="font-bold text-slate-700">Showing {filtered.length} of {masters.length}</div>
                        {(kind !== "ALL" || reporting !== "ALL" || search || printOnly || catalogOnly || overlaysOnly) && (
                            <div className="mt-0.5 text-slate-500">filtered</div>
                        )}
                    </div>
                </aside>

                {/* ─── Grid ─── */}
                <main>
                    {isLoading ? (
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                            {[1, 2, 3, 4, 5, 6].map((i) => (
                                <div key={i} className="h-56 animate-pulse rounded-2xl bg-slate-100" />
                            ))}
                        </div>
                    ) : filtered.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center shadow-sm">
                            <Package className="mx-auto h-10 w-10 text-slate-300" />
                            <h3 className="mt-3 text-base font-bold text-slate-900">No matching product masters</h3>
                            <p className="mt-1 text-sm text-slate-500">Try clearing filters or create a new master.</p>
                            <Button onClick={() => setCreateOpen(true)} className="mt-4 gap-1.5 rounded-xl">
                                <Plus className="h-4 w-4" /> New Product Master
                            </Button>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                            {filtered.map((m) => (
                                <ProductMasterCard key={m.id} master={m} />
                            ))}
                        </div>
                    )}
                </main>
            </div>

            <ProductMasterCreateModal open={createOpen} onOpenChange={setCreateOpen} />
        </div>
    )
}

// ─── Sub-components ───────────────────────────────────────────────────

function FilterCheck({ checked, onChange, label, count, accent }: { checked: boolean; onChange: (v: boolean) => void; label: string; count: number; accent: "violet" | "fuchsia" | "amber" | "slate" }) {
    const TONE: Record<string, string> = {
        violet: "text-violet-700",
        fuchsia: "text-fuchsia-700",
        amber: "text-amber-700",
        slate: "text-slate-600",
    }
    return (
        <label className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-slate-50 cursor-pointer">
            <input
                type="checkbox"
                checked={checked}
                onChange={(e) => onChange(e.target.checked)}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-300"
            />
            <span className="text-slate-700">{label}</span>
            <span className={cn("ml-auto text-[10px] font-bold", TONE[accent])}>{count}</span>
        </label>
    )
}

function ProductMasterCard({ master }: { master: ProductMaster }) {
    const meta = KIND_META[master.product_kind] || KIND_META.OTHER
    const health = deriveHealth(master)
    const hasCatalog = (master.variant_axes || []).some((a: any) => a.master_data_source)
    const isPrint = !!master.fixed_attributes?.print_capable
    const sizes = master.sizes_count ?? 0
    const axes = master.variant_axes?.length ?? 0
    const variants = master.variants_count ?? 0
    const overlays = master.overlays_count ?? 0
    const updated = timeAgo(master.updated_at)

    return (
        <Link
            href={`/master/products/${master.id}`}
            className={cn(
                "group flex h-full flex-col overflow-hidden rounded-2xl border border-l-[3px] bg-white shadow-sm ring-1 transition",
                meta.accent, "border-slate-200", meta.ring,
                "hover:-translate-y-0.5 hover:shadow-lg"
            )}
        >
            {/* Top row: kind icon, badges, code, name, health */}
            <div className="flex items-start gap-3 px-4 py-3.5">
                <div className={cn("flex h-10 w-10 flex-none items-center justify-center rounded-xl ring-1 ring-current/20 shadow-sm", meta.iconBg)}>
                    {meta.icon}
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1">
                        <span className={cn("rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ring-1 ring-inset", meta.tone)}>{master.product_kind}</span>
                        {hasCatalog && (
                            <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-violet-700 ring-1 ring-violet-200">CAT-AXES</span>
                        )}
                        {isPrint && (
                            <span className="rounded-full bg-fuchsia-50 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-fuchsia-700 ring-1 ring-fuchsia-200">PRINT</span>
                        )}
                        {!master.active && (
                            <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-rose-700 ring-1 ring-rose-200">INACTIVE</span>
                        )}
                    </div>
                    <div className="mt-1 truncate font-mono text-[11px] font-bold text-blue-700">{master.code}</div>
                    <div className="line-clamp-2 text-sm font-bold leading-snug text-slate-900">{master.name}</div>
                </div>
                <span className={cn("flex-none rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wider ring-1 ring-inset", health.tone)} title={`${health.pct}% demand met from stock`}>
                    ● {health.pct}%
                </span>
            </div>

            {/* KPI strip */}
            <div className="grid grid-cols-4 gap-px bg-slate-100">
                <Kvp label="Sizes" v={sizes} />
                <Kvp label="Axes" v={axes} />
                <Kvp label="Variants" v={variants} />
                <Kvp label="Overlays" v={overlays} />
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/40 px-4 py-2">
                <div className="flex items-center gap-2 min-w-0 text-[11px] text-slate-500">
                    <Clock className="h-3 w-3 flex-none" />
                    <span className="truncate">{updated}</span>
                    {master.template_name && (
                        <>
                            <span className="text-slate-300">·</span>
                            <span className="truncate">{master.template_name}</span>
                        </>
                    )}
                </div>
                {variants === 0 && master.active ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 ring-1 ring-amber-200">
                        <AlertTriangle className="h-3 w-3" /> No variants yet
                    </span>
                ) : (
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-600 group-hover:translate-x-0.5 transition">
                        Open <ArrowRight className="h-3 w-3" />
                    </span>
                )}
            </div>
        </Link>
    )
}

function Kvp({ label, v }: { label: string; v: number }) {
    return (
        <div className="bg-white px-3 py-2 text-center">
            <div className="text-[9px] font-black uppercase tracking-wider text-slate-400">{label}</div>
            <div className="font-display text-base font-bold text-slate-900">{v}</div>
        </div>
    )
}

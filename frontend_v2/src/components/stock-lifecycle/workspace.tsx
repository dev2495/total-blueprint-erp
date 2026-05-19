"use client"

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import {
    Boxes,
    Layers,
    Package,
    Droplets,
    FlaskConical,
    Sparkles,
    Puzzle,
    Wheat,
    Wallet,
    Building2,
} from "lucide-react"

import { cn } from "@/lib/utils"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { factoryService } from "@/services/factory"
import {
    stockLifecycleService,
    type MasterCatalog,
} from "@/services/stock-lifecycle"

import { OpenStockTab } from "./open-stock-tab"
import { CountTab } from "./count-tab"
import { CloseTab } from "./close-tab"

export type StockLifecycleTab = "open" | "count" | "close"

interface CategoryDef {
    key: string
    label: string
    icon: React.ComponentType<{ className?: string }>
    accent: string
}

export const CATEGORY_META: CategoryDef[] = [
    { key: "FILM_FAMILY", label: "Bulk Film", icon: Layers, accent: "from-indigo-500 to-violet-500" },
    { key: "FILM_VARIANT", label: "Rolls", icon: Boxes, accent: "from-blue-500 to-cyan-500" },
    { key: "GRANULE", label: "Granule", icon: Wheat, accent: "from-amber-500 to-orange-500" },
    { key: "INK", label: "Ink", icon: Droplets, accent: "from-fuchsia-500 to-pink-500" },
    { key: "SOLVENT", label: "Solvent", icon: FlaskConical, accent: "from-emerald-500 to-teal-500" },
    { key: "ADHESIVE", label: "Adhesive", icon: Sparkles, accent: "from-rose-500 to-orange-500" },
    { key: "PACKAGING", label: "Packaging", icon: Package, accent: "from-violet-500 to-fuchsia-500" },
    { key: "ADDON", label: "Add-Ons", icon: Puzzle, accent: "from-sky-500 to-indigo-500" },
    { key: "POD", label: "POD", icon: Layers, accent: "from-slate-500 to-slate-700" },
]

export function StockLifecycleWorkspace() {
    const [plantId, setPlantId] = React.useState<string>("")
    const [activeTab, setActiveTab] = React.useState<StockLifecycleTab>("open")
    const [categoryFilter, setCategoryFilter] = React.useState<string | null>(null)

    const { data: plants = [], isLoading: plantsLoading } = useQuery({
        queryKey: ["stock-lifecycle", "plants"],
        queryFn: () => factoryService.getPlants(),
    })

    React.useEffect(() => {
        if (!plantId && plants.length > 0) {
            setPlantId(plants[0].id)
        }
    }, [plants, plantId])

    const { data: catalog, isLoading: catalogLoading } = useQuery<MasterCatalog>({
        queryKey: ["stock-lifecycle", "catalog", plantId],
        queryFn: () => stockLifecycleService.getCatalog(plantId),
        enabled: !!plantId,
    })

    const totalSystemQty = React.useMemo(() => {
        if (!catalog) return { qty: 0, rowCount: 0, materialCount: 0 }
        const rows = catalog.rows
        const qty = rows.reduce((sum, r) => sum + (r.system_qty || 0), 0)
        const withStock = rows.filter((r) => (r.system_qty || 0) > 0).length
        return { qty, rowCount: withStock, materialCount: rows.length }
    }, [catalog])

    const plantContext = catalog?.plant
        ? `${catalog.plant.code} · ${catalog.plant.name}`
        : plantsLoading
        ? "Loading plants…"
        : "No plant selected"

    return (
        <div data-testid="stock-lifecycle-v4-workspace" className="mx-auto flex max-w-[1600px] flex-col gap-6 pb-12">
            {/* ===== Gradient hero ===== */}
            <section
                className={cn(
                    "relative overflow-hidden rounded-3xl p-6 sm:p-8",
                    "bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600",
                    "shadow-[0_30px_80px_-40px_rgba(99,102,241,0.55)]",
                    "text-white"
                )}
            >
                <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                    <div className="space-y-4">
                        <div className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-medium uppercase tracking-wide ring-1 ring-white/20">
                            <Sparkles className="h-3.5 w-3.5" />
                            Inventory · Lifecycle
                        </div>
                        <h1 className="font-display text-3xl font-semibold leading-tight text-balance sm:text-4xl">
                            Stock Lifecycle
                        </h1>
                        <p className="max-w-xl text-sm text-white/85 sm:text-base">
                            Open · Count · Close — one workspace, full visibility across every plant, every category.
                        </p>

                        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                            <label className="inline-flex items-center gap-2 rounded-2xl bg-white/12 px-3 py-2 text-sm ring-1 ring-white/20">
                                <Building2 className="h-4 w-4 text-white/80" />
                                <span className="font-medium text-white/90">Plant</span>
                                <div className="ml-1 min-w-[200px]">
                                    <Select value={plantId} onValueChange={setPlantId}>
                                        <SelectTrigger className="h-8 border-0 bg-white/15 text-white shadow-none focus:ring-2 focus:ring-white/40">
                                            <SelectValue placeholder="Choose plant" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {plants.map((plant) => (
                                                <SelectItem key={plant.id} value={plant.id}>
                                                    {plant.code} · {plant.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </label>
                            <div className="text-xs text-white/70">
                                {plantContext}
                            </div>
                        </div>

                        {/* Category chips */}
                        <div className="flex flex-wrap gap-2 pt-1">
                            <button
                                type="button"
                                onClick={() => setCategoryFilter(null)}
                                className={cn(
                                    "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition",
                                    categoryFilter === null
                                        ? "bg-white text-indigo-700 ring-white shadow"
                                        : "bg-white/10 text-white/90 ring-white/20 hover:bg-white/20"
                                )}
                            >
                                <Sparkles className="h-3.5 w-3.5" />
                                All categories
                            </button>
                            {CATEGORY_META.map((cat) => {
                                const Icon = cat.icon
                                const active = categoryFilter === cat.key
                                return (
                                    <button
                                        key={cat.key}
                                        type="button"
                                        onClick={() => setCategoryFilter(active ? null : cat.key)}
                                        className={cn(
                                            "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ring-1 transition",
                                            active
                                                ? "bg-white text-indigo-700 ring-white shadow"
                                                : "bg-white/10 text-white/90 ring-white/20 hover:bg-white/20"
                                        )}
                                    >
                                        <Icon className="h-3.5 w-3.5" />
                                        {cat.label}
                                    </button>
                                )
                            })}
                        </div>
                    </div>

                    {/* KPI on right */}
                    <div className="flex items-stretch">
                        <div className="rounded-3xl bg-white/15 p-5 ring-1 ring-white/20 backdrop-blur min-w-[220px]">
                            <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-white/80">
                                <Wallet className="h-4 w-4" />
                                Current System Stock
                            </div>
                            <div className="mt-2 font-display text-3xl font-semibold leading-tight">
                                {totalSystemQty.qty.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                                <span className="ml-1 text-base font-medium text-white/70">kg/pcs</span>
                            </div>
                            <div className="mt-2 text-xs text-white/75">
                                {totalSystemQty.rowCount} of {totalSystemQty.materialCount} materials hold stock
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* ===== Tab pills ===== */}
            <nav className="flex w-full flex-wrap gap-2 rounded-3xl border border-slate-200 bg-white p-2 shadow-sm">
                {(
                    [
                        { key: "open", label: "Open Stock", help: "Seed opening balances for a new FY" },
                        { key: "count", label: "Stock Count", help: "Physical count vs system, flag variances" },
                        { key: "close", label: "Close Stock", help: "Preview & lock the financial year" },
                    ] as Array<{ key: StockLifecycleTab; label: string; help: string }>
                ).map((tab) => {
                    const active = activeTab === tab.key
                    return (
                        <button
                            key={tab.key}
                            type="button"
                            onClick={() => setActiveTab(tab.key)}
                            className={cn(
                                "group flex-1 min-w-[140px] rounded-2xl px-4 py-3 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
                                active
                                    ? "bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 text-white shadow"
                                    : "bg-slate-50 text-slate-700 hover:bg-slate-100"
                            )}
                        >
                            <div className="font-display text-sm font-semibold">{tab.label}</div>
                            <div className={cn("text-[11px] mt-0.5", active ? "text-white/80" : "text-slate-500")}>
                                {tab.help}
                            </div>
                        </button>
                    )
                })}
            </nav>

            {/* ===== Tab content ===== */}
            <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
                {!plantId ? (
                    <EmptyState message="Select a plant to begin." />
                ) : catalogLoading ? (
                    <EmptyState message="Loading catalog…" />
                ) : !catalog ? (
                    <EmptyState message="No catalog available for the selected plant." />
                ) : activeTab === "open" ? (
                    <OpenStockTab plantId={plantId} catalog={catalog} categoryFilter={categoryFilter} />
                ) : activeTab === "count" ? (
                    <CountTab plantId={plantId} catalog={catalog} categoryFilter={categoryFilter} />
                ) : (
                    <CloseTab plantId={plantId} catalog={catalog} />
                )}
            </section>
        </div>
    )
}

function EmptyState({ message }: { message: string }) {
    return (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/60 p-10 text-center text-sm text-slate-500">
            {message}
        </div>
    )
}

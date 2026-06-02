"use client"

import * as React from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import {
    AlertTriangle,
    BarChart3,
    CalendarClock,
    CalendarRange,
    CheckCircle2,
    ClipboardList,
    Download,
    Factory,
    History,
    Layers,
    Lock,
    Package,
    PackageCheck,
    Puzzle,
    Scale,
    ShieldCheck,
    Sparkles,
    Wheat,
    Droplets,
    FlaskConical,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { api } from "@/lib/api"
import { factoryService } from "@/services/factory"
import { inventoryService, type StockCardPayload } from "@/services/inventory"
import {
    stockLifecycleService,
    type InventoryFinancialPeriod,
    type MasterCatalog,
} from "@/services/stock-lifecycle"

import { OpenStockTab } from "./open-stock-tab"
import { CountTab } from "./count-tab"
import { CloseTab } from "./close-tab"

export type StockLifecycleTab = "overview" | "open" | "count" | "close" | "snapshots"

interface CategoryDef {
    key: string
    label: string
    icon: React.ComponentType<{ className?: string }>
    accent: string
}

export const CATEGORY_META: CategoryDef[] = [
    { key: "FILM_FAMILY", label: "Bulk Film", icon: Layers, accent: "from-indigo-500 to-violet-500" },
    { key: "FILM_VARIANT", label: "Rolls", icon: PackageCheck, accent: "from-blue-500 to-cyan-500" },
    { key: "GRANULE", label: "Granule", icon: Wheat, accent: "from-amber-500 to-orange-500" },
    { key: "INK", label: "Ink", icon: Droplets, accent: "from-fuchsia-500 to-pink-500" },
    { key: "SOLVENT", label: "Solvent", icon: FlaskConical, accent: "from-emerald-500 to-teal-500" },
    { key: "ADHESIVE", label: "Adhesive", icon: Sparkles, accent: "from-rose-500 to-orange-500" },
    { key: "PACKAGING", label: "Packaging", icon: Package, accent: "from-violet-500 to-fuchsia-500" },
    { key: "ADDON", label: "Add-ons", icon: Puzzle, accent: "from-sky-500 to-indigo-500" },
    { key: "POD", label: "POD", icon: Layers, accent: "from-slate-500 to-slate-700" },
]

const TABS: Array<{ key: StockLifecycleTab; label: string; sub: string; icon: React.ComponentType<{ className?: string }> }> = [
    { key: "overview", label: "Overview", sub: "Valuation, ageing, movement", icon: BarChart3 },
    { key: "open", label: "Open stock", sub: "FY opening balances", icon: Scale },
    { key: "count", label: "Physical count", sub: "Floor count and variance", icon: ClipboardList },
    { key: "close", label: "Period close", sub: "Preview, lock, roll forward", icon: Lock },
    { key: "snapshots", label: "Snapshots & history", sub: "Monthly count and stock card", icon: History },
]

const STOCK_CLASS_COLORS: Record<string, string> = {
    BULK: "#6366f1",
    ROLL: "#10b981",
    PACKAGING: "#f59e0b",
    TRADING: "#f43f5e",
    OTHER: "#64748b",
}

function currentFinancialYear() {
    const now = new Date()
    const year = now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1
    return `${year}-${year + 1}`
}

function monthShort(value?: string | Date | null) {
    const date = value ? new Date(value) : new Date()
    if (Number.isNaN(date.getTime())) return "Current"
    return date.toLocaleString("en-IN", { month: "short" })
}

function money(value: unknown, compact = false) {
    const number = Number(value || 0)
    if (!Number.isFinite(number) || Math.abs(number) < 1) return "Rs 0"
    if (compact) {
        if (Math.abs(number) >= 10_000_000) return `Rs ${(number / 10_000_000).toLocaleString("en-IN", { maximumFractionDigits: 2 })} Cr`
        if (Math.abs(number) >= 100_000) return `Rs ${(number / 100_000).toLocaleString("en-IN", { maximumFractionDigits: 1 })} L`
    }
    return `Rs ${number.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`
}

function qty(value: unknown, digits = 1) {
    const number = Number(value || 0)
    return number.toLocaleString("en-IN", { maximumFractionDigits: digits })
}

function pct(value: unknown) {
    const number = Number(value || 0)
    return `${number.toLocaleString("en-IN", { maximumFractionDigits: 1 })}%`
}

function rowValue(row: Record<string, any>) {
    const direct = Number(row.value ?? row.display_value ?? row.stock_value ?? row.closing_value ?? 0)
    if (Number.isFinite(direct) && direct > 0) return direct
    const qtyValue = Number(row.qty ?? row.quantity ?? row.qty_kg ?? row.weight_kg ?? 0)
    const rate = Number(row.rate ?? row.avg_cost ?? row.balance_rate ?? 0)
    if (!Number.isFinite(qtyValue) || !Number.isFinite(rate)) return 0
    return Math.max(0, qtyValue * rate)
}

function rowQty(row: Record<string, any>) {
    return Number(row.qty ?? row.quantity ?? row.qty_kg ?? row.weight_kg ?? row.system_qty ?? 0) || 0
}

function stockClass(row: Record<string, any>) {
    return String(row.stock_class || row.stockClass || row.klass || row.source_type || "OTHER").toUpperCase()
}

function materialCategory(row: Record<string, any>) {
    return String(row.material_category || row.category || "").toUpperCase()
}

function reportingClass(row: Record<string, any>) {
    const klass = stockClass(row)
    const category = materialCategory(row)
    if (klass === "PACKAGING" || category === "ADDON" || category === "PACKAGING") return "PACKAGING"
    if (klass === "ROLL") return "ROLL"
    if (klass === "BULK") return "BULK"
    return klass
}

function normalizeTab(value: string | null): StockLifecycleTab {
    const raw = String(value || "").toLowerCase()
    if (raw === "opening" || raw === "open-stock") return "open"
    if (raw === "physical-count" || raw === "stock-count") return "count"
    if (raw === "yearclose" || raw === "year-close" || raw === "period" || raw === "close") return "close"
    if (raw === "stockcard" || raw === "history" || raw === "snapshot") return "snapshots"
    if (TABS.some((tab) => tab.key === raw)) return raw as StockLifecycleTab
    return "overview"
}

function periodTone(status?: string) {
    const normalized = String(status || "").toUpperCase()
    if (normalized === "CLOSED") return "border-slate-300 bg-slate-950 text-white"
    if (normalized === "CLOSING_IN_PROGRESS") return "border-amber-200 bg-amber-50 text-amber-800"
    if (normalized === "OPEN") return "border-emerald-200 bg-emerald-50 text-emerald-800"
    return "border-slate-200 bg-white text-slate-600"
}

function firstRateGap(rows: Array<Record<string, any>>) {
    return rows.some((row) => rowQty(row) > 0 && !Number(row.rate ?? row.avg_cost ?? row.balance_rate ?? 0))
}

function movementBucket(movements: Record<string, any>, patterns: RegExp[]) {
    return Object.entries(movements || {})
        .filter(([key]) => patterns.some((pattern) => pattern.test(key)))
        .reduce((sum, [, value]) => sum + Number(value || 0), 0)
}

function ageInDays(value?: string | null) {
    if (!value) return 0
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) return 0
    return Math.max(0, Math.floor((Date.now() - parsed.getTime()) / 86_400_000))
}

function buildAgeRows(snapshot: any) {
    const rows: Array<{ code: string; name: string; stockClass: string; days: number; value: number; qty: number }> = []
    for (const row of snapshot?.bulk || []) {
        const qtyValue = Number(row.qty_kg ?? row.quantity ?? 0) || 0
        const klass = materialCategory(row) === "ADDON" ? "PACKAGING" : "BULK"
        rows.push({
            code: row.material_code || "-",
            name: row.material_name || "Bulk material",
            stockClass: klass,
            days: ageInDays(row.updated_at),
            value: qtyValue * Number(row.avg_cost || 0),
            qty: qtyValue,
        })
    }
    for (const row of snapshot?.rolls || []) {
        const qtyValue = Number(row.weight_kg || 0) || 0
        rows.push({
            code: row.label_id || row.material_code || "-",
            name: row.material_name || "Roll",
            stockClass: "ROLL",
            days: Number(row.age_days || 0),
            value: qtyValue * Number(row.avg_cost || row.rate || 0),
            qty: qtyValue,
        })
    }
    for (const row of snapshot?.packaging || []) {
        const qtyValue = Number(row.qty || row.quantity || 0) || 0
        rows.push({
            code: row.material_code || "-",
            name: row.material_name || "Packaging",
            stockClass: "PACKAGING",
            days: ageInDays(row.updated_at),
            value: qtyValue * Number(row.avg_cost || 0),
            qty: qtyValue,
        })
    }
    return rows.filter((row) => row.qty > 0)
}

function buildTopMovers(stockCard?: StockCardPayload) {
    const map = new Map<string, { label: string; qty: number; value: number }>()
    for (const row of stockCard?.rows || []) {
        const outQty = Number(row.out_qty || (Number(row.qty || 0) < 0 ? Math.abs(Number(row.qty || 0)) : 0))
        if (outQty <= 0) continue
        const key = row.material_id || row.material_code || row.reference || "movement"
        const current = map.get(key) || {
            label: [row.material_code, row.material_name].filter(Boolean).join(" - ") || row.reference || "Movement",
            qty: 0,
            value: 0,
        }
        current.qty += outQty
        current.value += Math.abs(Number(row.display_value ?? row.transaction_value ?? row.value ?? row.rate ?? row.balance_rate ?? 0) || 0)
        map.set(key, current)
    }
    return Array.from(map.values()).sort((a, b) => b.value - a.value || b.qty - a.qty).slice(0, 5)
}

function buildPeriodOptions(periods: InventoryFinancialPeriod[]) {
    const map = new Map<string, string>()
    map.set(currentFinancialYear(), currentFinancialYear())
    for (const period of periods) {
        map.set(period.financial_year, period.label || period.financial_year)
    }
    return Array.from(map, ([value, label]) => ({ value, label }))
}

function miniTrendValue(row: Record<string, any>) {
    return Number(row.value ?? row.total_value ?? row.stock_value ?? row.kpi?.stock_value ?? row.kpi?.total_value ?? 0) || 0
}

function batchWorkflow(batch: Record<string, any>) {
    return ((batch.summary_json || {}).workflow || {}) as Record<string, any>
}

function batchLabel(batch: Record<string, any>) {
    const workflow = batchWorkflow(batch)
    return workflow.label || workflow.name || batch.name || String(batch.type || "Audit sheet").replace(/_/g, " ")
}

function batchScopeText(batch: Record<string, any>) {
    const workflow = batchWorkflow(batch)
    const filters = (workflow.filters || {}) as Record<string, any>
    const scope = String(batch.scope || workflow.scope || batch.type || "").replace(/_/g, " ")
    const bits = [
        scope,
        filters.location_name ? `Location: ${filters.location_name}` : "All plant locations",
        filters.item_search ? `Item: ${filters.item_search}` : "",
        filters.category ? `Category: ${filters.category}` : "",
    ].filter(Boolean)
    return bits.join(" · ")
}

async function downloadBlob(url: string, payload: Record<string, any>, fileName: string) {
    const response = await api.post(url, payload, { responseType: "blob" })
    const blobUrl = URL.createObjectURL(response.data)
    const anchor = document.createElement("a")
    anchor.href = blobUrl
    anchor.download = fileName
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(blobUrl)
}

export function StockLifecycleWorkspace() {
    const router = useRouter()
    const pathname = usePathname()
    const searchParams = useSearchParams()
    const activeTab = normalizeTab(searchParams?.get("tab") ?? null)
    const [plantId, setPlantId] = React.useState("")
    const [financialYear, setFinancialYear] = React.useState(currentFinancialYear())
    const [categoryFilter, setCategoryFilter] = React.useState<string | null>(null)

    const { data: plants = [], isLoading: plantsLoading } = useQuery({
        queryKey: ["stock-lifecycle", "plants"],
        queryFn: () => factoryService.getPlants(),
    })

    React.useEffect(() => {
        const requestedPlant = searchParams?.get("plant")
        if (requestedPlant && (plants as any[]).some((plant) => String(plant.id) === requestedPlant)) {
            if (plantId !== requestedPlant) setPlantId(requestedPlant)
            return
        }
        if (!plantId && plants.length > 0) setPlantId(String((plants as any[])[0].id))
    }, [plantId, plants, searchParams])

    const { data: catalog, isLoading: catalogLoading } = useQuery<MasterCatalog>({
        queryKey: ["stock-lifecycle", "catalog", plantId],
        queryFn: () => stockLifecycleService.getCatalog(plantId),
        enabled: Boolean(plantId),
        staleTime: 30_000,
    })

    const { data: periods = [] } = useQuery({
        queryKey: ["stock-lifecycle", "periods"],
        queryFn: stockLifecycleService.getPeriods,
        staleTime: 30_000,
    })

    const selectedPeriod = React.useMemo(
        () => periods.find((period) => period.financial_year === financialYear) || null,
        [financialYear, periods],
    )

    const { data: closePreview, isFetching: closingFetching } = useQuery({
        queryKey: ["stock-lifecycle", "closing-preview", plantId, financialYear],
        queryFn: () => stockLifecycleService.getClosingPreview(plantId, financialYear),
        enabled: Boolean(plantId),
        staleTime: 30_000,
    })

    const { data: auditSnapshot } = useQuery({
        queryKey: ["stock-lifecycle", "audit-snapshot", plantId],
        queryFn: () => stockLifecycleService.getSnapshot(plantId),
        enabled: Boolean(plantId),
        staleTime: 30_000,
    })

    const { data: inventorySnapshot } = useQuery({
        queryKey: ["stock-lifecycle", "inventory-snapshot", plantId],
        queryFn: () => inventoryService.getInventorySnapshot({ plant_id: plantId }),
        enabled: Boolean(plantId),
        staleTime: 30_000,
    })

    const { data: trendRows = [] } = useQuery({
        queryKey: ["stock-lifecycle", "inventory-trend", plantId],
        queryFn: () => inventoryService.getInventoryTrend({ days: 245, plant_id: plantId }),
        enabled: Boolean(plantId),
        staleTime: 60_000,
    })

    const { data: batches = [] } = useQuery({
        queryKey: ["stock-lifecycle", "audit-batches", plantId, financialYear],
        queryFn: () => inventoryService.getAuditBatches({ plant: plantId, financial_year: financialYear }),
        enabled: Boolean(plantId),
        staleTime: 30_000,
    })

    const { data: stockCard } = useQuery({
        queryKey: ["stock-lifecycle", "overview-stock-card", plantId, financialYear],
        queryFn: () => inventoryService.getStockCard({ plant: plantId, financial_year: financialYear }),
        enabled: Boolean(plantId),
        staleTime: 30_000,
    })

    function setActiveTab(tab: StockLifecycleTab) {
        const next = new URLSearchParams(searchParams?.toString() || "")
        next.set("tab", tab)
        router.replace(`${pathname}?${next.toString()}`, { scroll: false })
    }

    async function exportCurrentView() {
        const payload = {
            ...(plantId ? { plant: plantId } : {}),
            ...(financialYear ? { financial_year: financialYear } : {}),
        }
        if (activeTab === "close") {
            await downloadBlob(inventoryService.getClosingPreviewExportUrl(), payload, `closing-preview-${financialYear}.xlsx`)
            return
        }
        await downloadBlob(inventoryService.getStockCardExportUrl(), payload, `stock-card-${financialYear}.xlsx`)
    }

    const snapshotRows = React.useMemo(() => {
        const rows = (auditSnapshot as any)?.rows || (closePreview as any)?.rows || []
        return Array.isArray(rows) ? rows as Array<Record<string, any>> : []
    }, [auditSnapshot, closePreview])

    const analytics = React.useMemo(() => {
        const byClass = new Map<string, { qty: number; value: number; count: number }>()
        for (const row of snapshotRows) {
            const klass = reportingClass(row)
            const current = byClass.get(klass) || { qty: 0, value: 0, count: 0 }
            current.qty += rowQty(row)
            current.value += rowValue(row)
            current.count += 1
            byClass.set(klass, current)
        }
        const totalValue = Number((closePreview as any)?.totals?.value ?? (auditSnapshot as any)?.totals?.value ?? 0) || Array.from(byClass.values()).reduce((sum, row) => sum + row.value, 0)
        const systemQty = (catalog?.rows || []).reduce((sum, row) => sum + Number(row.system_qty || 0), 0)
        const skus = (catalog?.rows || []).filter((row) => Number(row.system_qty || 0) > 0).length || snapshotRows.length
        return { byClass, totalValue, systemQty, skus }
    }, [auditSnapshot, catalog?.rows, closePreview, snapshotRows])

    const ageRows = React.useMemo(() => buildAgeRows(inventorySnapshot), [inventorySnapshot])
    const deadRows = React.useMemo(() => ageRows.filter((row) => row.days >= 90).sort((a, b) => b.value - a.value || b.days - a.days), [ageRows])
    const ageTotals = React.useMemo(() => {
        const fresh = ageRows.filter((row) => row.days <= 30).reduce((sum, row) => sum + row.value, 0)
        const slow = ageRows.filter((row) => row.days > 30 && row.days < 90).reduce((sum, row) => sum + row.value, 0)
        const dead = deadRows.reduce((sum, row) => sum + row.value, 0)
        const total = Math.max(fresh + slow + dead, 1)
        return { fresh, slow, dead, total }
    }, [ageRows, deadRows])

    const topMovers = React.useMemo(() => buildTopMovers(stockCard), [stockCard])
    const movement = React.useMemo(() => {
        const movements = (closePreview as any)?.movements || {}
        const opening = movementBucket(movements, [/opening/i])
        const inward = movementBucket(movements, [/inward/i, /grn/i, /produce/i, /receipt/i, /excess/i])
        const consumed = movementBucket(movements, [/consume/i, /short/i, /scrap/i])
        const dispatch = movementBucket(movements, [/dispatch/i, /sale/i, /issue/i])
        const adjust = movementBucket(movements, [/adjust/i, /correction/i])
        const closing = Number((closePreview as any)?.totals?.bulk_kg || 0) + Number((closePreview as any)?.totals?.roll_kg || 0) + Number((closePreview as any)?.totals?.packaging_qty || 0)
        return { opening, inward, consumed, dispatch, adjust, closing }
    }, [closePreview])

    const rateGap = React.useMemo(() => firstRateGap(snapshotRows), [snapshotRows])
    const periodOptions = React.useMemo(() => buildPeriodOptions(periods), [periods])
    const selectedPlant = React.useMemo(
        () => (plants as any[]).find((plant) => String(plant.id) === String(plantId)) || (catalog as any)?.plant,
        [catalog, plantId, plants],
    )

    return (
        <div
            data-testid="stock-lifecycle-cockpit"
            className="min-h-screen rounded-[28px] bg-[radial-gradient(circle_at_6%_-8%,rgba(79,70,229,0.10),transparent_32rem),radial-gradient(circle_at_94%_2%,rgba(16,185,129,0.08),transparent_30rem),linear-gradient(180deg,#eef2ff_0%,#f1f5f9_55%,#eef4f8_100%)] px-3 py-4 sm:px-5 lg:px-7"
        >
            <div className="mx-auto flex max-w-[1560px] flex-col gap-4">
                <Hero
                    plantName={selectedPlant?.code ? `${selectedPlant.code} ${selectedPlant.name}` : selectedPlant?.name || "No plant"}
                    financialYear={financialYear}
                    periodStatus={selectedPeriod?.status || "Not started"}
                    analytics={analytics}
                    deadValue={ageTotals.dead}
                    deadCount={deadRows.length}
                    lastClose={periods.find((period) => period.status === "CLOSED")}
                    rateGap={rateGap}
                    loading={plantsLoading || catalogLoading || closingFetching}
                />

                <section className="flex flex-col gap-3 xl:flex-row xl:items-center">
                    <nav className="flex min-w-0 flex-wrap gap-2">
                        {TABS.map((tab) => {
                            const Icon = tab.icon
                            const active = activeTab === tab.key
                            return (
                                <button
                                    key={tab.key}
                                    type="button"
                                    data-testid={`stock-lifecycle-tab-${tab.key}`}
                                    onClick={() => setActiveTab(tab.key)}
                                    className={cn(
                                        "inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-extrabold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500",
                                        active
                                            ? "bg-slate-950 text-white shadow-[0_14px_28px_-18px_rgba(15,23,42,0.8)]"
                                            : "border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50",
                                    )}
                                    title={tab.sub}
                                >
                                    <Icon className="h-4 w-4" />
                                    {tab.label}
                                </button>
                            )
                        })}
                    </nav>
                    <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row xl:justify-end">
                        <Select value={plantId || "__none__"} onValueChange={(value) => setPlantId(value === "__none__" ? "" : value)}>
                            <SelectTrigger data-testid="stock-lifecycle-plant-select" className="h-10 rounded-xl border-slate-200 bg-white text-xs font-bold sm:w-[250px]">
                                <SelectValue placeholder="Select plant" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="__none__">Select plant</SelectItem>
                                {(plants as any[]).map((plant) => (
                                    <SelectItem key={plant.id} value={String(plant.id)}>
                                        {plant.code ? `${plant.code} - ${plant.name}` : plant.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Select value={financialYear} onValueChange={setFinancialYear}>
                            <SelectTrigger data-testid="stock-lifecycle-fy-select" className="h-10 rounded-xl border-slate-200 bg-white text-xs font-bold sm:w-[210px]">
                                <SelectValue placeholder="FY period" />
                            </SelectTrigger>
                            <SelectContent>
                                {periodOptions.map((period) => (
                                    <SelectItem key={period.value} value={period.value}>{period.label}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Button type="button" onClick={exportCurrentView} className="h-10 rounded-xl bg-slate-950 px-4 text-xs font-extrabold text-white hover:bg-slate-800">
                            <Download className="mr-2 h-4 w-4" />
                            Export
                        </Button>
                    </div>
                </section>

                {activeTab === "overview" ? (
                    <OverviewPanel
                        analytics={analytics}
                        ageTotals={ageTotals}
                        deadRows={deadRows}
                        topMovers={topMovers}
                        trendRows={trendRows as Array<Record<string, any>>}
                        movement={movement}
                        financialYear={financialYear}
                        plantLabel={selectedPlant?.code || selectedPlant?.name || "Plant"}
                        rateGap={rateGap}
                    />
                ) : activeTab === "open" ? (
                    <LifecycleTabShell
                        icon={Scale}
                        title="Open stock"
                        copy="Set approved opening balances for the selected plant and FY. This is a stock lifecycle action, not a GRN."
                    >
                        {!plantId || !catalog ? <EmptyState message="Select a plant to load opening stock rows." /> : <OpenStockTab plantId={plantId} catalog={catalog} categoryFilter={categoryFilter} />}
                    </LifecycleTabShell>
                ) : activeTab === "count" ? (
                    <LifecycleTabShell
                        icon={ClipboardList}
                        title="Physical count"
                        copy="Use the live system quantity, enter floor counts, capture reasons for variance, and post only approved differences."
                    >
                        {!plantId || !catalog ? <EmptyState message="Select a plant to load physical count rows." /> : <CountTab plantId={plantId} catalog={catalog} categoryFilter={categoryFilter} />}
                    </LifecycleTabShell>
                ) : activeTab === "close" ? (
                    <LifecycleTabShell
                        icon={Lock}
                        title="Period close"
                        copy="Preview the closing snapshot, clear blockers, lock the Indian FY, and generate the next opening from the approved close."
                    >
                        {!plantId || !catalog ? <EmptyState message="Select a plant to preview period close." /> : <CloseTab plantId={plantId} catalog={catalog} />}
                    </LifecycleTabShell>
                ) : (
                    <SnapshotsPanel
                        plantId={plantId}
                        financialYear={financialYear}
                        periods={periods}
                        batches={batches as any[]}
                        trendRows={trendRows as Array<Record<string, any>>}
                        catalog={catalog}
                    />
                )}

                <CategoryRail
                    active={categoryFilter}
                    onChange={setCategoryFilter}
                    catalog={catalog}
                />
            </div>
        </div>
    )
}

function Hero({
    plantName,
    financialYear,
    periodStatus,
    analytics,
    deadValue,
    deadCount,
    lastClose,
    rateGap,
    loading,
}: {
    plantName: string
    financialYear: string
    periodStatus: string
    analytics: { totalValue: number; skus: number; systemQty: number }
    deadValue: number
    deadCount: number
    lastClose?: InventoryFinancialPeriod
    rateGap: boolean
    loading: boolean
}) {
    return (
        <section className="relative overflow-hidden rounded-[26px] bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 p-6 text-white shadow-[0_26px_70px_-42px_rgba(15,23,42,0.45)]">
            <div className="absolute -right-16 -top-16 h-60 w-60 rounded-full bg-white/10 blur-3xl" />
            <div className="relative flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                <div className="min-w-0">
                    <div className="flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[0.22em] text-indigo-100">
                        <span className="h-2 w-2 rounded-full bg-emerald-300" />
                        Stock Lifecycle · Inventory Control Cockpit
                    </div>
                    <h1 className="mt-1.5 max-w-5xl text-3xl font-extrabold tracking-tight sm:text-4xl">
                        Open · Count · Close — plus the analytics that were missing.
                    </h1>
                    <p className="mt-2 max-w-4xl text-sm font-semibold leading-6 text-indigo-100">
                        A controller cockpit for live valuation, ageing, movement waterfall, monthly snapshots, dead stock, turnover, and the full open-to-count-to-close cycle keyed to a plant and FY period.
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                        <StatusChip tone="light" icon={Factory}>{plantName}</StatusChip>
                        <StatusChip tone="light" icon={CalendarRange}>FY {financialYear}</StatusChip>
                        <StatusChip tone={String(periodStatus).toUpperCase() === "OPEN" ? "green" : "amber"} icon={ShieldCheck}>Period {periodStatus.replace(/_/g, " ")}</StatusChip>
                        {rateGap ? <StatusChip tone="amber" icon={AlertTriangle}>Some rates missing</StatusChip> : null}
                    </div>
                </div>
                <div className="grid shrink-0 grid-cols-2 gap-2 text-right sm:min-w-[430px]">
                    <HeroMetric label="Stock value" value={money(analytics.totalValue, true)} loading={loading} />
                    <HeroMetric label="SKUs on hand" value={qty(analytics.skus, 0)} loading={loading} />
                    <HeroMetric label="Ageing 90d+" value={money(deadValue, true)} sub={`${deadCount} rows`} loading={loading} tone="amber" />
                    <HeroMetric label="Last close" value={lastClose?.financial_year || "None"} sub={lastClose?.closed_at ? monthShort(lastClose.closed_at) : "pending"} loading={loading} />
                </div>
            </div>
        </section>
    )
}

function HeroMetric({ label, value, sub, tone = "default", loading }: { label: string; value: string; sub?: string; tone?: "default" | "amber"; loading?: boolean }) {
    return (
        <div className="rounded-2xl bg-white/12 p-3 ring-1 ring-white/15">
            <div className="text-[10px] font-bold uppercase tracking-widest text-indigo-100">{label}</div>
            <div className={cn("mt-1 font-mono text-2xl font-extrabold", tone === "amber" && "text-amber-200")}>
                {loading ? "..." : value}
            </div>
            {sub ? <div className="mt-1 text-[11px] font-bold text-indigo-100/80">{sub}</div> : null}
        </div>
    )
}

function StatusChip({ children, icon: Icon, tone }: { children: React.ReactNode; icon?: React.ComponentType<{ className?: string }>; tone: "light" | "green" | "amber" }) {
    const className =
        tone === "green"
            ? "bg-emerald-400/25 text-emerald-50 ring-emerald-300/40"
            : tone === "amber"
                ? "bg-amber-300/25 text-amber-50 ring-amber-200/40"
                : "bg-white/15 text-white ring-white/20"
    return (
        <span className={cn("inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[11px] font-extrabold ring-1", className)}>
            {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
            {children}
        </span>
    )
}

function OverviewPanel({
    analytics,
    ageTotals,
    deadRows,
    topMovers,
    trendRows,
    movement,
    financialYear,
    plantLabel,
    rateGap,
}: {
    analytics: { byClass: Map<string, { qty: number; value: number; count: number }>; totalValue: number; skus: number; systemQty: number }
    ageTotals: { fresh: number; slow: number; dead: number; total: number }
    deadRows: Array<{ code: string; name: string; days: number; value: number; qty: number; stockClass: string }>
    topMovers: Array<{ label: string; qty: number; value: number }>
    trendRows: Array<Record<string, any>>
    movement: { opening: number; inward: number; consumed: number; dispatch: number; adjust: number; closing: number }
    financialYear: string
    plantLabel: string
    rateGap: boolean
}) {
    const bulk = analytics.byClass.get("BULK")?.value || 0
    const rolls = analytics.byClass.get("ROLL")?.value || 0
    const packaging = analytics.byClass.get("PACKAGING")?.value || 0
    const bulkStats = analytics.byClass.get("BULK") || { qty: 0, value: 0, count: 0 }
    const rollStats = analytics.byClass.get("ROLL") || { qty: 0, value: 0, count: 0 }
    const packagingStats = analytics.byClass.get("PACKAGING") || { qty: 0, value: 0, count: 0 }
    const other = Math.max(0, analytics.totalValue - bulk - rolls - packaging)
    const totalForShare = Math.max(analytics.totalValue, 1)
    const outflow = Math.abs(movement.consumed) + Math.abs(movement.dispatch)
    const turnover = movement.closing > 0 ? (outflow / movement.closing) * 12 : 0
    const classSub = (stats: { qty: number; value: number; count: number }, value: number, uom: string, missingCopy?: string) => {
        if (stats.count === 0) return "no on-hand rows"
        if (value <= 0 && stats.qty > 0) return `${qty(stats.qty, 1)} ${uom} · ${missingCopy || "rates missing"}`
        return `${pct((value / totalForShare) * 100)} of value · ${qty(stats.qty, 1)} ${uom}`
    }

    return (
        <div data-testid="stock-overview-tab" className="space-y-4">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                <KpiCard label="Total value" value={money(analytics.totalValue)} sub={rateGap ? "excludes rows without rates" : "from stock snapshot"} />
                <KpiCard label="Bulk / granule" value={money(bulk, true)} sub={classSub(bulkStats, bulk, "KG")} />
                <KpiCard label="Rolls / WIP" value={money(rolls, true)} sub={classSub(rollStats, rolls, "KG", "roll rates missing")} />
                <KpiCard label="Packaging + addon" value={money(packaging, true)} sub={classSub(packagingStats, packaging, "qty", "packing rates missing")} />
                <KpiCard label="Turnover annualised" value={turnover > 0 ? `${qty(turnover, 1)}x` : "No outflow"} sub="from FY movement qty" />
                <KpiCard label="Dead stock 90d+" value={money(ageTotals.dead, true)} sub={`${deadRows.length} rows`} tone="amber" />
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
                <ValueMix total={analytics.totalValue} rows={[
                    { label: "Bulk", value: bulk, color: STOCK_CLASS_COLORS.BULK },
                    { label: "Rolls", value: rolls, color: STOCK_CLASS_COLORS.ROLL },
                    { label: "Packaging", value: packaging, color: STOCK_CLASS_COLORS.PACKAGING },
                    { label: "Other", value: other, color: STOCK_CLASS_COLORS.TRADING },
                ]} />
                <AgeingBuckets totals={ageTotals} />
                <TrendCard rows={trendRows} />
            </div>

            <MovementWaterfall movement={movement} financialYear={financialYear} plantLabel={plantLabel} />

            <div className="grid gap-4 lg:grid-cols-2">
                <TopMovers rows={topMovers} />
                <DeadStock rows={deadRows} />
            </div>
        </div>
    )
}

function KpiCard({ label, value, sub, tone = "default" }: { label: string; value: string; sub?: string; tone?: "default" | "amber" }) {
    return (
        <div className={cn("rounded-[18px] border p-3 shadow-sm", tone === "amber" ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-white")}>
            <div className={cn("text-[10px] font-extrabold uppercase tracking-[0.13em]", tone === "amber" ? "text-amber-700" : "text-slate-500")}>{label}</div>
            <div className={cn("mt-1 font-mono text-xl font-extrabold", tone === "amber" ? "text-amber-800" : "text-slate-950")}>{value}</div>
            {sub ? <div className={cn("mt-1 text-[11px] font-bold", tone === "amber" ? "text-amber-700" : "text-slate-500")}>{sub}</div> : null}
        </div>
    )
}

function ValueMix({ total, rows }: { total: number; rows: Array<{ label: string; value: number; color: string }> }) {
    const usableTotal = Math.max(total, rows.reduce((sum, row) => sum + row.value, 0), 1)
    let cursor = 0
    const stops = rows.map((row) => {
        const start = cursor
        const width = Math.max(0, (row.value / usableTotal) * 100)
        cursor += width
        return `${row.color} ${start}% ${cursor}%`
    }).join(", ")

    return (
        <Panel title="Value by class">
            <div className="flex items-center gap-4">
                <div
                    className="grid h-[130px] w-[130px] shrink-0 place-items-center rounded-full"
                    style={{ background: `conic-gradient(${stops || "#e2e8f0 0 100%"})` }}
                >
                    <div className="grid h-[90px] w-[90px] place-items-center rounded-full bg-white text-center">
                        <div>
                            <div className="font-mono text-base font-extrabold">{money(total, true)}</div>
                            <div className="text-[9px] font-bold uppercase text-slate-400">Total</div>
                        </div>
                    </div>
                </div>
                <div className="min-w-0 space-y-1.5 text-xs font-bold text-slate-700">
                    {rows.map((row) => (
                        <div key={row.label} className="flex min-w-0 items-center gap-2">
                            <span className="h-3 w-3 rounded" style={{ backgroundColor: row.color }} />
                            <span className="truncate">{row.label} · {money(row.value, true)}</span>
                        </div>
                    ))}
                </div>
            </div>
        </Panel>
    )
}

function AgeingBuckets({ totals }: { totals: { fresh: number; slow: number; dead: number; total: number } }) {
    return (
        <Panel title="Ageing buckets · days since last movement">
            <div className="space-y-3">
                <AgeBar label="0-30 days · fresh" value={totals.fresh} total={totals.total} tone="bg-emerald-500" text="text-emerald-700" />
                <AgeBar label="31-90 days" value={totals.slow} total={totals.total} tone="bg-amber-500" text="text-amber-700" />
                <AgeBar label="90+ days · dead" value={totals.dead} total={totals.total} tone="bg-rose-500" text="text-rose-700" />
            </div>
        </Panel>
    )
}

function AgeBar({ label, value, total, tone, text }: { label: string; value: number; total: number; tone: string; text: string }) {
    const width = total > 0 ? Math.max(4, Math.min(100, (value / total) * 100)) : 4
    return (
        <div>
            <div className="flex justify-between gap-3 text-xs font-bold">
                <span>{label}</span>
                <span className={cn("font-mono", text)}>{money(value, true)}</span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-200">
                <div className={cn("h-full rounded-full", tone)} style={{ width: `${width}%` }} />
            </div>
        </div>
    )
}

function TrendCard({ rows }: { rows: Array<Record<string, any>> }) {
    const visible = rows.slice(-8)
    const values = visible.map(miniTrendValue)
    const max = Math.max(1, ...values)
    return (
        <Panel title="Valuation trend · last snapshots">
            {visible.length ? (
                <>
                    <div className="flex h-[76px] items-end gap-1.5">
                        {visible.map((row, index) => {
                            const value = miniTrendValue(row)
                            const height = Math.max(12, (value / max) * 100)
                            return (
                                <div key={`${row.as_of || row.created_at || index}`} className="flex flex-1 flex-col items-center gap-1">
                                    <div className={cn("w-full rounded-t-md", index === visible.length - 1 ? "bg-indigo-600" : "bg-indigo-300")} style={{ height: `${height}%` }} />
                                </div>
                            )
                        })}
                    </div>
                    <div className="mt-2 flex justify-between text-[10px] font-bold text-slate-400">
                        <span>{monthShort(visible[0]?.as_of || visible[0]?.created_at)}</span>
                        <span>{monthShort(visible[Math.floor(visible.length / 2)]?.as_of || visible[Math.floor(visible.length / 2)]?.created_at)}</span>
                        <span>{monthShort(visible.at(-1)?.as_of || visible.at(-1)?.created_at)}</span>
                    </div>
                </>
            ) : (
                <EmptyState message="No historical snapshots returned yet. Run the inventory snapshot job or close a period to build this trend." compact />
            )}
            <div className="mt-3 text-[11px] font-bold leading-5 text-slate-500">
                Uses real InventorySnapshot trend rows; empty trend means no captured snapshots yet.
            </div>
        </Panel>
    )
}

function MovementWaterfall({ movement, financialYear, plantLabel }: { movement: { opening: number; inward: number; consumed: number; dispatch: number; adjust: number; closing: number }; financialYear: string; plantLabel: string }) {
    const rows = [
        { label: "Opening", value: movement.opening, tone: "bg-slate-400", text: "text-slate-700" },
        { label: "+ In / GRN", value: movement.inward, tone: "bg-emerald-500", text: "text-emerald-700" },
        { label: "- Consumed", value: Math.abs(movement.consumed), tone: "bg-rose-500", text: "text-rose-700" },
        { label: "- Dispatch", value: Math.abs(movement.dispatch), tone: "bg-rose-400", text: "text-rose-700" },
        { label: "+/- Adjust", value: Math.abs(movement.adjust), tone: "bg-amber-400", text: "text-amber-700" },
        { label: "Closing", value: movement.closing, tone: "bg-indigo-600", text: "text-indigo-700" },
    ]
    const max = Math.max(1, ...rows.map((row) => Math.abs(row.value)))
    return (
        <div className="rounded-[18px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="text-[10px] font-extrabold uppercase tracking-[0.13em] text-slate-500">
                    Movement this period · opening + ins - outs +/- adjustments = closing
                </div>
                <span className="inline-flex h-7 items-center rounded-full bg-slate-100 px-3 text-[11px] font-extrabold text-slate-600">{financialYear} · {plantLabel}</span>
            </div>
            <div className="flex h-[170px] items-end gap-2 sm:gap-3">
                {rows.map((row) => {
                    const height = Math.max(8, (Math.abs(row.value) / max) * 145)
                    return (
                        <div key={row.label} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                            <div className={cn("w-full rounded-md", row.tone)} style={{ height }} />
                            <div className={cn("truncate text-[10px] font-extrabold", row.text)}>{row.label}</div>
                            <div className="font-mono text-[11px] font-bold text-slate-700">{qty(row.value)}</div>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}

function TopMovers({ rows }: { rows: Array<{ label: string; qty: number; value: number }> }) {
    return (
        <Panel title="Top movers this FY (by outflow)">
            {rows.length ? (
                <table className="w-full text-xs font-bold">
                    <tbody>
                        {rows.map((row) => (
                            <tr key={row.label} className="border-b border-slate-50 last:border-b-0">
                                <td className="py-2 pr-2">{row.label}</td>
                                <td className="py-2 text-right font-mono text-rose-700">{row.value ? `-${money(row.value, true)}` : "-"}</td>
                                <td className="py-2 text-right text-slate-400">{qty(row.qty)} qty</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            ) : (
                <EmptyState message="No outflow rows returned by the stock-card endpoint for this FY." compact />
            )}
        </Panel>
    )
}

function DeadStock({ rows }: { rows: Array<{ code: string; name: string; days: number; value: number; qty: number; stockClass: string }> }) {
    return (
        <div className="rounded-[18px] border border-amber-200 bg-amber-50 p-4 shadow-sm">
            <div className="mb-3 text-[10px] font-extrabold uppercase tracking-[0.13em] text-amber-700">Dead stock · no movement 90d+</div>
            {rows.length ? (
                <table className="w-full text-xs font-bold">
                    <tbody>
                        {rows.slice(0, 6).map((row) => (
                            <tr key={`${row.stockClass}-${row.code}-${row.days}`} className="border-b border-amber-100 last:border-b-0">
                                <td className="py-2 pr-2">
                                    <div className="text-slate-800">{row.name}</div>
                                    <div className="text-[10px] text-amber-700">{row.code} · {row.stockClass}</div>
                                </td>
                                <td className="py-2 text-right font-mono text-amber-800">{row.value ? money(row.value, true) : qty(row.qty)}</td>
                                <td className="py-2 text-right text-amber-700">{row.days} days</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            ) : (
                <EmptyState message="No 90+ day stock found in the live snapshot." compact />
            )}
        </div>
    )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div className="rounded-[18px] border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 text-[10px] font-extrabold uppercase tracking-[0.13em] text-slate-500">{title}</div>
            {children}
        </div>
    )
}

function LifecycleTabShell({ icon: Icon, title, copy, children }: { icon: React.ComponentType<{ className?: string }>; title: string; copy: string; children: React.ReactNode }) {
    return (
        <section className="rounded-[22px] border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
            <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-950 text-white">
                        <Icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                        <h2 className="text-xl font-extrabold tracking-tight text-slate-950">{title}</h2>
                        <p className="mt-1 max-w-4xl text-sm font-semibold leading-6 text-slate-600">{copy}</p>
                    </div>
                </div>
                <div className="flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[11px] font-extrabold text-emerald-800">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Live backend workflow
                </div>
            </div>
            <div className="min-w-0">{children}</div>
        </section>
    )
}

function SnapshotsPanel({
    plantId,
    financialYear,
    periods,
    batches,
    trendRows,
    catalog,
}: {
    plantId: string
    financialYear: string
    periods: InventoryFinancialPeriod[]
    batches: Array<Record<string, any>>
    trendRows: Array<Record<string, any>>
    catalog?: MasterCatalog
}) {
    const countBatches = batches.filter((batch) => String(batch.type || "").toUpperCase() === "PHYSICAL_COUNT")
    const postedBatches = batches.filter((batch) => ["POSTED", "LOCKED"].includes(String(batch.status || "").toUpperCase()))
    const recentCounts = countBatches.slice(0, 5)
    const months = React.useMemo(() => buildFyMonthTracker(financialYear, countBatches, trendRows), [countBatches, financialYear, trendRows])

    return (
        <div className="space-y-4">
            <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
                <Panel title="Closed periods and FY locks">
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {periods.slice(0, 9).map((period) => (
                            <div key={period.id} className={cn("rounded-2xl border p-4", periodTone(period.status))}>
                                <div className="flex items-center justify-between gap-2">
                                    <div className="font-mono text-lg font-extrabold">{period.financial_year}</div>
                                    {period.status === "CLOSED" ? <Lock className="h-4 w-4" /> : <CalendarClock className="h-4 w-4" />}
                                </div>
                                <div className="mt-2 text-xs font-bold opacity-80">{period.status.replace(/_/g, " ")}</div>
                                <div className="mt-3 text-[11px] font-semibold opacity-75">
                                    Close: {period.closed_at ? new Date(period.closed_at).toLocaleDateString("en-IN") : "not closed"}
                                </div>
                            </div>
                        ))}
                        {!periods.length ? <EmptyState message="No financial periods returned yet." compact /> : null}
                    </div>
                </Panel>
                <Panel title="Monthly stock count / Tally tracker">
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                        {months.map((month) => (
                            <div key={month.key} className={cn(
                                "rounded-2xl border p-3 text-center",
                                month.counted ? "border-emerald-200 bg-emerald-50" : month.snapshot ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-slate-50",
                            )}>
                                <div className="text-sm font-extrabold text-slate-950">{month.label}</div>
                                <div className={cn("mt-1 text-[10px] font-extrabold uppercase", month.counted ? "text-emerald-700" : month.snapshot ? "text-blue-700" : "text-slate-400")}>
                                    {month.counted ? "Count posted" : month.snapshot ? "Snapshot" : "Pending"}
                                </div>
                                <div className="mt-1 font-mono text-[11px] font-bold text-slate-500">{month.count || 0} sheet(s)</div>
                            </div>
                        ))}
                    </div>
                </Panel>
            </section>

            <section className="grid gap-4 xl:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]">
                <Panel title="Audit sheet history">
                    {recentCounts.length ? (
                        <div className="mb-4 grid gap-2 sm:grid-cols-2">
                            {recentCounts.map((batch) => (
                                <div key={batch.id} className="rounded-2xl border border-indigo-100 bg-indigo-50/70 p-3">
                                    <div className="flex items-center justify-between gap-2">
                                        <div className="min-w-0">
                                            <div className="truncate text-sm font-extrabold text-slate-950">{batchLabel(batch)}</div>
                                            <div className="mt-1 line-clamp-2 text-[11px] font-bold leading-4 text-indigo-800">{batchScopeText(batch)}</div>
                                        </div>
                                        <span className="shrink-0 rounded-full bg-white px-2 py-1 font-mono text-[10px] font-extrabold text-indigo-700">
                                            {batch.line_count || batch.lines?.length || 0} lines
                                        </span>
                                    </div>
                                    <div className="mt-2 flex items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
                                        <span>{batch.batch_no || batch.id}</span>
                                        <span>{batch.posted_at ? new Date(batch.posted_at).toLocaleDateString("en-IN") : batch.status}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : null}
                    <div className="max-h-[460px] overflow-auto">
                        <table className="w-full min-w-[620px] text-sm">
                            <thead className="sticky top-0 bg-white text-left text-[10px] font-extrabold uppercase tracking-[0.13em] text-slate-500">
                                <tr><th className="py-2">Sheet</th><th>Label</th><th>Scope</th><th>Status</th><th className="text-right">Lines</th></tr>
                            </thead>
                            <tbody>
                                {batches.slice(0, 40).map((batch) => (
                                    <tr key={batch.id} className="border-t border-slate-100">
                                        <td className="py-2 pr-2 font-mono text-xs font-bold text-slate-800">{batch.batch_no || batch.id}</td>
                                        <td className="pr-2 text-xs font-bold text-slate-700">{batchLabel(batch)}</td>
                                        <td className="max-w-[240px] pr-2 text-[11px] font-semibold text-slate-500">{batchScopeText(batch)}</td>
                                        <td className="pr-2"><span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-extrabold text-slate-600">{batch.status}</span></td>
                                        <td className="text-right font-mono text-xs font-bold">{batch.line_count || batch.lines?.length || 0}</td>
                                    </tr>
                                ))}
                                {!batches.length ? <tr><td colSpan={5} className="py-10 text-center text-sm font-semibold text-slate-500">No audit sheets for this plant/FY.</td></tr> : null}
                            </tbody>
                        </table>
                    </div>
                    <div className="mt-3 rounded-2xl bg-slate-50 p-3 text-xs font-semibold leading-5 text-slate-600">
                        Posted sheets are immutable. Closed financial years are locked; stock adjustments must be posted only in an open financial year.
                    </div>
                </Panel>
                <StockCardDrill plantId={plantId} financialYear={financialYear} catalog={catalog} postedCount={postedBatches.length} />
            </section>
        </div>
    )
}

function StockCardDrill({ plantId, financialYear, catalog, postedCount }: { plantId: string; financialYear: string; catalog?: MasterCatalog; postedCount: number }) {
    const searchParams = useSearchParams()
    const initialMaterial = searchParams?.get("material") || ""
    const [material, setMaterial] = React.useState("")
    const [query, setQuery] = React.useState("")
    const materialRows = React.useMemo(() => {
        const rows = catalog?.rows || []
        const q = query.trim().toLowerCase()
        if (!q) return rows.slice(0, 120)
        return rows.filter((row) => `${row.code} ${row.name}`.toLowerCase().includes(q)).slice(0, 120)
    }, [catalog?.rows, query])

    React.useEffect(() => {
        if (!material && materialRows[0]?.id) setMaterial(materialRows[0].id)
    }, [material, materialRows])

    React.useEffect(() => {
        if (initialMaterial && initialMaterial !== material && materialRows.some((row) => row.id === initialMaterial)) {
            setMaterial(initialMaterial)
        }
    }, [initialMaterial, material, materialRows])

    const { data: card, isFetching } = useQuery({
        queryKey: ["stock-lifecycle", "stock-card-drill", plantId, financialYear, material],
        queryFn: () => inventoryService.getStockCard({ plant: plantId, financial_year: financialYear, material: material || undefined }),
        enabled: Boolean(plantId && material),
        staleTime: 30_000,
    })

    const rows = card?.rows || []
    const visible = rows.slice(-80)

    return (
        <Panel title="Stock card drill · ledger proof">
            <div className="mb-3 grid gap-2 md:grid-cols-[220px_minmax(0,1fr)_auto]">
                <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search material..." className="h-10 rounded-xl" />
                <Select value={material || "__none__"} onValueChange={(value) => setMaterial(value === "__none__" ? "" : value)}>
                    <SelectTrigger className="h-10 rounded-xl"><SelectValue placeholder="Material" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="__none__">Select material</SelectItem>
                        {materialRows.map((row) => <SelectItem key={row.id} value={row.id}>{row.code} - {row.name}</SelectItem>)}
                    </SelectContent>
                </Select>
                <div className="inline-flex h-10 items-center rounded-xl bg-slate-100 px-3 text-xs font-extrabold text-slate-600">
                    {isFetching ? "Refreshing" : `${rows.length} ledger rows · ${postedCount} posted sheets`}
                </div>
            </div>
            <div className="mb-3 grid grid-cols-3 gap-2">
                <KpiCard label="Opening" value={qty(card?.opening_qty || 0)} />
                <KpiCard label="Movement" value={qty(card?.movement_qty || 0)} />
                <KpiCard label="Closing" value={qty(card?.closing_qty || 0)} />
            </div>
            <div className="max-h-[460px] overflow-auto rounded-2xl border border-slate-200">
                <table className="w-full min-w-[860px] text-xs">
                    <thead className="sticky top-0 bg-slate-50 text-left font-extrabold uppercase tracking-[0.13em] text-slate-500">
                        <tr><th className="px-3 py-2">Date</th><th>Ref</th><th>Type</th><th className="text-right">In</th><th className="text-right">Out</th><th className="text-right">Balance</th><th className="text-right">Value</th></tr>
                    </thead>
                    <tbody className="font-bold">
                        {visible.map((row, index) => (
                            <tr key={`${row.reference}-${row.at}-${index}`} className="border-t border-slate-100">
                                <td className="px-3 py-2 text-slate-600">{row.at ? new Date(row.at).toLocaleDateString("en-IN") : "-"}</td>
                                <td className="font-mono text-blue-700">{row.reference || "-"}</td>
                                <td>{row.source || "-"}</td>
                                <td className="text-right font-mono text-emerald-700">{row.in_qty ? qty(row.in_qty) : "-"}</td>
                                <td className="text-right font-mono text-rose-700">{row.out_qty ? qty(row.out_qty) : "-"}</td>
                                <td className="text-right font-mono">{qty(row.balance_qty ?? row.qty ?? 0)}</td>
                                <td className="text-right font-mono">{row.value == null ? "-" : money(row.value, true)}</td>
                            </tr>
                        ))}
                        {!visible.length ? <tr><td colSpan={7} className="px-3 py-10 text-center text-sm font-semibold text-slate-500">No stock-card ledger rows for the selected material/FY.</td></tr> : null}
                    </tbody>
                </table>
            </div>
        </Panel>
    )
}

function buildFyMonthTracker(financialYear: string, countBatches: Array<Record<string, any>>, trendRows: Array<Record<string, any>>) {
    const [startRaw] = String(financialYear || currentFinancialYear()).split("-")
    const startYear = Number(startRaw) || new Date().getFullYear()
    const months = [
        ["Apr", startYear, 3], ["May", startYear, 4], ["Jun", startYear, 5], ["Jul", startYear, 6], ["Aug", startYear, 7], ["Sep", startYear, 8],
        ["Oct", startYear, 9], ["Nov", startYear, 10], ["Dec", startYear, 11], ["Jan", startYear + 1, 0], ["Feb", startYear + 1, 1], ["Mar", startYear + 1, 2],
    ] as const
    return months.map(([label, year, month]) => {
        const key = `${year}-${String(month + 1).padStart(2, "0")}`
        const count = countBatches.filter((batch) => {
            const date = new Date(batch.posted_at || batch.cutoff_at || batch.created_at || "")
            return !Number.isNaN(date.getTime()) && date.getFullYear() === year && date.getMonth() === month
        }).length
        const snapshot = trendRows.some((row) => {
            const date = new Date(row.as_of || row.created_at || row.snapshot_at || "")
            return !Number.isNaN(date.getTime()) && date.getFullYear() === year && date.getMonth() === month
        })
        return { key, label, counted: count > 0, snapshot, count }
    })
}

function CategoryRail({ active, onChange, catalog }: { active: string | null; onChange: (value: string | null) => void; catalog?: MasterCatalog }) {
    const counts = React.useMemo(() => {
        const map = new Map<string, number>()
        for (const row of catalog?.rows || []) map.set(row.category, (map.get(row.category) || 0) + 1)
        return map
    }, [catalog?.rows])

    return (
        <section className="rounded-[18px] border border-slate-200 bg-white/75 p-3 shadow-sm backdrop-blur">
            <div className="flex flex-wrap gap-2">
                <button
                    type="button"
                    onClick={() => onChange(null)}
                    className={cn(
                        "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[11px] font-extrabold ring-1",
                        active === null ? "bg-slate-950 text-white ring-slate-950" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50",
                    )}
                >
                    <Sparkles className="h-3.5 w-3.5" />
                    All categories
                </button>
                {CATEGORY_META.map((category) => {
                    const Icon = category.icon
                    const selected = active === category.key
                    return (
                        <button
                            key={category.key}
                            type="button"
                            onClick={() => onChange(selected ? null : category.key)}
                            className={cn(
                                "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[11px] font-extrabold ring-1",
                                selected ? "bg-slate-950 text-white ring-slate-950" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50",
                            )}
                        >
                            <Icon className="h-3.5 w-3.5" />
                            {category.label}
                            <span className="font-mono opacity-70">{counts.get(category.key) || 0}</span>
                        </button>
                    )
                })}
            </div>
        </section>
    )
}

function EmptyState({ message, compact = false }: { message: string; compact?: boolean }) {
    return (
        <div className={cn("rounded-2xl border border-dashed border-slate-300 bg-slate-50 text-center text-sm font-semibold text-slate-500", compact ? "p-5" : "p-10")}>
            {message}
        </div>
    )
}

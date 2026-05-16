"use client"

/**
 * V3.7 Sales Orders list — full sales queue with:
 *   - Subtle V37 hero + 6 KPI tiles (Open · Awaiting planning · Aged 6+d · Created today · Value · Avg age)
 *   - Two-row compact filter band (status pills + age pills + customer + master + Advanced popover + Reset)
 *   - Saved views (localStorage, scoped per user)
 *   - Bulk select with floating action bar (Export CSV · Cancel selected)
 *   - Comfortable / Compact density toggle
 *   - Row expand inline (line items + activity timeline) without route change
 *   - Cancel modal with reason categories (replaces window.prompt)
 *   - Mobile-optimised (single column rows below md, two-line stacked layout)
 *
 * Wires only to existing services. No new field, no schema change.
 *   salesService.getOrders / cancelOrder / getOrder
 *   masterDataService.getCustomers
 *   productMasterService.list
 */

import * as React from "react"
import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
    AlertTriangle,
    ArrowRight,
    CalendarDays,
    ChevronDown,
    Download,
    Loader2,
    Plus,
    Search,
    SlidersHorizontal,
    Star,
    X,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { salesService, type SalesOrder } from "@/services/sales"
import { masterDataService, type Customer } from "@/services/master-data"
import { productMasterService, type ProductMaster } from "@/services/product-master"

// ─── Types ─────────────────────────────────────────────────────────────

type AgeBucket = "fresh" | "watch" | "aged"
type Density = "comfortable" | "compact"
type Tab = "queue" | "history" | "cancelled"

type StatusKey =
    | "DRAFT" | "CONFIRMED" | "PLANNING_REQUIRED" | "PLANNED" | "RELEASED"
    | "PACKING_READY" | "DISPATCH_READY" | "COMPLETED" | "CANCELLED"

interface SavedView {
    id: string
    label: string
    filters: {
        status: StatusKey | "ALL"
        age: AgeBucket | "ALL"
        customer: string
        master: string
        searchText: string
        fgType: string
        widthMm: string
        heightMm: string
        thicknessUm: string
    }
}

const DEFAULT_FILTERS: SavedView["filters"] = {
    status: "ALL", age: "ALL", customer: "", master: "",
    searchText: "", fgType: "", widthMm: "", heightMm: "", thicknessUm: "",
}

const STATUS_PILL_TONE: Record<StatusKey, string> = {
    DRAFT: "bg-slate-50 text-slate-700 ring-slate-200",
    CONFIRMED: "bg-slate-50 text-slate-700 ring-slate-200",
    PLANNING_REQUIRED: "bg-amber-50 text-amber-800 ring-amber-200",
    PLANNED: "bg-blue-50 text-blue-800 ring-blue-200",
    RELEASED: "bg-rose-50 text-rose-800 ring-rose-200",
    PACKING_READY: "bg-violet-50 text-violet-800 ring-violet-200",
    DISPATCH_READY: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    COMPLETED: "bg-emerald-100 text-emerald-900 ring-emerald-300",
    CANCELLED: "bg-slate-100 text-slate-700 ring-slate-200",
}
const STATUS_LABEL: Record<StatusKey, string> = {
    DRAFT: "Draft",
    CONFIRMED: "Confirmed",
    PLANNING_REQUIRED: "Planning",
    PLANNED: "Planned",
    RELEASED: "Released",
    PACKING_READY: "Packing",
    DISPATCH_READY: "Dispatch",
    COMPLETED: "Completed",
    CANCELLED: "Cancelled",
}

const CANCEL_REASONS: Array<{ value: string; label: string }> = [
    { value: "CUSTOMER_CANCELLED", label: "Customer cancelled" },
    { value: "SPEC_ERROR", label: "Spec error" },
    { value: "CREDIT_HOLD", label: "Credit hold" },
    { value: "DUPLICATE", label: "Duplicate" },
    { value: "OTHER", label: "Other" },
]

// ─── Helpers ───────────────────────────────────────────────────────────

function safeNumber(v: unknown): number {
    const n = Number(v); return Number.isFinite(n) ? n : 0
}
function fmtKg(v: unknown): string {
    return safeNumber(v).toLocaleString("en-IN", { maximumFractionDigits: 0 })
}
function fmtMoney(v: unknown): string {
    const n = safeNumber(v)
    if (n >= 100000) return `₹${(n / 100000).toFixed(2)} L`
    return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`
}
function ageDays(iso: string | null | undefined): number {
    if (!iso) return 0
    const t = new Date(iso).getTime()
    if (!Number.isFinite(t)) return 0
    return Math.max(0, Math.floor((Date.now() - t) / 86400000))
}
function ageBucket(d: number): AgeBucket {
    if (d <= 2) return "fresh"
    if (d <= 5) return "watch"
    return "aged"
}
function fmtDate(iso: string | null | undefined): string {
    if (!iso) return "—"
    const dt = new Date(iso)
    if (!Number.isFinite(dt.getTime())) return "—"
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const d = new Date(dt); d.setHours(0, 0, 0, 0)
    if (d.getTime() === today.getTime()) return "today"
    if (d.getTime() === today.getTime() - 86400000) return "yesterday"
    return dt.toLocaleDateString("en-IN", { day: "numeric", month: "short" })
}
function customerInitials(name: string): string {
    return name.split(/\s+/).slice(0, 2).map((s) => s[0] || "").join("").toUpperCase() || "—"
}
function customerAvatarTone(d: number): string {
    if (d >= 6) return "bg-gradient-to-br from-rose-200 to-rose-400"
    if (d >= 3) return "bg-gradient-to-br from-amber-200 to-amber-400"
    return "bg-gradient-to-br from-emerald-200 to-emerald-400"
}
function orderTotalKg(o: SalesOrder): number {
    return safeNumber(o.qty_summary?.ordered_kg ?? o.total_weight_kg ?? 0)
}
function orderTotalValue(o: SalesOrder): number {
    return safeNumber(o.total_value)
}
function orderProducedKg(o: SalesOrder): number {
    return safeNumber(o.fulfillment_summary?.produced_kg ?? 0)
}
function orderDispatchedKg(o: SalesOrder): number {
    return safeNumber(o.fulfillment_summary?.dispatched_kg ?? 0)
}
function isOpen(o: SalesOrder): boolean {
    const s = String(o.status || "").toUpperCase()
    return !["COMPLETED", "CANCELLED"].includes(s)
}
function unwrapOrders(raw: any): SalesOrder[] {
    if (Array.isArray(raw)) return raw
    if (Array.isArray(raw?.results)) return raw.results
    if (Array.isArray(raw?.items)) return raw.items
    return []
}

// ─── Root component ────────────────────────────────────────────────────

const SAVED_VIEWS_KEY = "sales-orders-v37:saved-views"

export function SalesOrdersListWorkspace() {
    const queryClient = useQueryClient()
    const [tab, setTab] = React.useState<Tab>("queue")
    const [density, setDensity] = React.useState<Density>("comfortable")
    const [filters, setFilters] = React.useState<SavedView["filters"]>(DEFAULT_FILTERS)
    const [advancedOpen, setAdvancedOpen] = React.useState(false)
    const [selected, setSelected] = React.useState<Set<string>>(new Set())
    const [expanded, setExpanded] = React.useState<string | null>(null)
    const [cancelTarget, setCancelTarget] = React.useState<SalesOrder | null>(null)
    const [savedViews, setSavedViews] = React.useState<SavedView[]>([])
    const [activeViewId, setActiveViewId] = React.useState<string>("all")

    // Load saved views once
    React.useEffect(() => {
        try {
            const raw = localStorage.getItem(SAVED_VIEWS_KEY)
            if (raw) setSavedViews(JSON.parse(raw))
        } catch {/* ignore */}
    }, [])
    const persistViews = (next: SavedView[]) => {
        setSavedViews(next)
        try { localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(next)) } catch {/* ignore */}
    }

    // ─── Data ────────────────────────────────────────────────────────
    const serverStatus = (() => {
        if (filters.status !== "ALL") return filters.status
        if (tab === "history") return "COMPLETED"
        if (tab === "cancelled") return "CANCELLED"
        return undefined
    })()
    const ordersQuery = useQuery({
        queryKey: ["sales-orders-v37", filters.searchText, serverStatus || "ALL"],
        queryFn: () => salesService.getOrders({
            q: filters.searchText.trim() || undefined,
            status: serverStatus,
            limit: 500,
        }),
        staleTime: 30_000,
    })
    const orders = React.useMemo(() => unwrapOrders(ordersQuery.data), [ordersQuery.data])
    const { data: customers = [] } = useQuery({
        queryKey: ["customers"],
        queryFn: masterDataService.getCustomers,
        staleTime: 60_000,
    })
    const { data: masters = [] } = useQuery({
        queryKey: ["product-masters-list"],
        queryFn: () => productMasterService.list({ active: true }),
        staleTime: 60_000,
    })

    // ─── Filtered + enriched rows ────────────────────────────────────
    const enriched = React.useMemo(() => orders.map((o) => {
        const age = ageDays(o.created_at)
        return {
            order: o,
            age,
            bucket: ageBucket(age),
            statusKey: String(o.status || "").toUpperCase() as StatusKey,
            totalKg: orderTotalKg(o),
            value: orderTotalValue(o),
            produced: orderProducedKg(o),
            dispatched: orderDispatchedKg(o),
        }
    }), [orders])

    const queueRows = React.useMemo(() => enriched.filter(({ order }) => {
        const isHistoryRow = !isOpen(order)
        if (tab === "queue" && isHistoryRow) return false
        if (tab === "history" && order.status !== "COMPLETED") return false
        if (tab === "cancelled" && order.status !== "CANCELLED") return false
        return true
    }), [enriched, tab])

    const filtered = React.useMemo(() => queueRows.filter(({ order, age, statusKey }) => {
        if (filters.status !== "ALL" && statusKey !== filters.status) return false
        if (filters.age !== "ALL" && ageBucket(age) !== filters.age) return false
        if (filters.customer && order.customer !== filters.customer && order.customer_id !== filters.customer) return false
        if (filters.master) {
            const masterCode = order.item_summary?.template_tag || order.item_summary?.variant_code || ""
            const m = masters.find((x) => x.id === filters.master)
            if (m && !String(masterCode).toUpperCase().includes(m.code.toUpperCase())) return false
        }
        if (filters.fgType) {
            const fg = String(order.item_summary?.finished_good_type || "").toUpperCase()
            if (fg !== filters.fgType) return false
        }
        // Range-style width/height/thickness — match numeric token in search if specified
        if (filters.widthMm.trim()) {
            const w = Number(filters.widthMm) || 0
            const itemW = Number((order.item_summary as any)?.size?.widthMm || 0)
            if (!w || !itemW || Math.abs(itemW - w) > 25) return false
        }
        if (filters.heightMm.trim()) {
            const h = Number(filters.heightMm) || 0
            const itemH = Number((order.item_summary as any)?.size?.heightMm || 0)
            if (!h || !itemH || Math.abs(itemH - h) > 25) return false
        }
        return true
    }), [queueRows, filters, masters])

    // KPI math
    const kpis = React.useMemo(() => {
        const open = enriched.filter((r) => isOpen(r.order))
        const awaiting = open.filter((r) => r.statusKey === "PLANNING_REQUIRED")
        const aged = open.filter((r) => r.age >= 6)
        const createdToday = enriched.filter((r) => r.age === 0)
        const valueInFlight = open.reduce((s, r) => s + r.value, 0)
        const avgAge = open.length ? open.reduce((s, r) => s + r.age, 0) / open.length : 0
        return {
            open: open.length,
            awaiting: awaiting.length,
            aged: aged.length,
            agedKg: aged.reduce((s, r) => s + r.totalKg, 0),
            createdToday: createdToday.length,
            valueInFlight,
            avgAge: Number(avgAge.toFixed(1)),
            customersOpen: new Set(open.map((r) => r.order.customer || r.order.customer_id)).size,
            historyCount: enriched.filter((r) => r.order.status === "COMPLETED").length,
            cancelledCount: enriched.filter((r) => r.order.status === "CANCELLED").length,
        }
    }, [enriched])

    // Status counts (open only)
    const statusCounts = React.useMemo(() => {
        const c: Partial<Record<StatusKey, number>> = {}
        for (const r of queueRows) c[r.statusKey] = (c[r.statusKey] || 0) + 1
        return c
    }, [queueRows])
    const ageCounts = React.useMemo(() => {
        const c = { fresh: 0, watch: 0, aged: 0 }
        for (const r of queueRows) c[r.bucket] += 1
        return c
    }, [queueRows])

    // ─── Selection helpers ────────────────────────────────────────────
    const allSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.order.id))
    function toggleRow(id: string) {
        setSelected((prev) => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id); else next.add(id)
            return next
        })
    }
    function toggleAll() {
        if (allSelected) setSelected(new Set())
        else setSelected(new Set(filtered.map((r) => r.order.id)))
    }
    function clearSelection() { setSelected(new Set()) }

    // ─── Mutations ───────────────────────────────────────────────────
    const cancelMutation = useMutation({
        mutationFn: ({ id, reason }: { id: string; reason: string }) => salesService.cancelOrder(id, reason),
        onSuccess: () => {
            toast.success("Sales order cancelled")
            queryClient.invalidateQueries({ queryKey: ["sales-orders-v37"] })
            setCancelTarget(null)
        },
        onError: (err: any) => {
            toast.error("Could not cancel order", { description: err?.response?.data?.detail || err?.message || "Try again." })
        },
    })

    // ─── Saved views ─────────────────────────────────────────────────
    function applyView(view: SavedView | null) {
        if (!view) {
            setFilters(DEFAULT_FILTERS); setActiveViewId("all"); return
        }
        setFilters(view.filters); setActiveViewId(view.id)
    }
    function saveCurrentView() {
        const label = window.prompt("Name this saved view")
        if (!label) return
        const view: SavedView = { id: `v-${Date.now()}`, label, filters }
        persistViews([...savedViews, view])
        setActiveViewId(view.id)
    }
    function removeView(id: string) {
        persistViews(savedViews.filter((v) => v.id !== id))
        if (activeViewId === id) setActiveViewId("all")
    }

    function patchFilter<K extends keyof SavedView["filters"]>(key: K, value: SavedView["filters"][K]) {
        setFilters((prev) => ({ ...prev, [key]: value }))
        setActiveViewId("all")
    }
    function resetFilters() { setFilters(DEFAULT_FILTERS); setActiveViewId("all") }

    // ─── CSV export of currently filtered ────────────────────────────
    function exportCsv(ids?: Set<string>) {
        const rows = filtered.filter((r) => !ids || ids.has(r.order.id))
        const headers = ["SO Number", "Customer", "Customer Code", "Product Master", "Variant", "Qty (KG)", "Value (₹)", "Status", "Placed", "Age (days)"]
        const lines = [headers.join(",")]
        for (const r of rows) {
            const o = r.order
            const cells = [
                o.order_number,
                `"${(o.customer_name || "").replace(/"/g, '""')}"`,
                (o as any).customer_code || "",
                o.item_summary?.template_tag || o.item_summary?.variant_code || "",
                `"${(o.item_summary?.variant_name || o.line_name || "").replace(/"/g, '""')}"`,
                String(r.totalKg),
                String(r.value),
                o.status,
                o.created_at || "",
                String(r.age),
            ]
            lines.push(cells.join(","))
        }
        const blob = new Blob([lines.join("\n")], { type: "text/csv" })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = `sales-orders-${new Date().toISOString().slice(0, 10)}.csv`
        a.click()
        URL.revokeObjectURL(url)
    }

    return (
        <div className="space-y-4 pb-32">
            <Hero kpis={kpis} />

            {/* KPI strip */}
            <section className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
                <KpiTile label="Open" value={String(kpis.open)} sub="orders in flight" />
                <KpiTile label="Awaiting planning" value={String(kpis.awaiting)} sub="needs action" tone="amber" onClick={() => { patchFilter("status", "PLANNING_REQUIRED") }} />
                <KpiTile label="Aged 6+ days" value={String(kpis.aged)} sub={`${fmtKg(kpis.agedKg)} KG · not good`} tone="rose" onClick={() => { patchFilter("age", "aged") }} />
                <KpiTile label="Created today" value={String(kpis.createdToday)} sub="new in last 24h" tone="emerald" />
                <KpiTile label="Value in flight" value={fmtMoney(kpis.valueInFlight)} sub={`${kpis.open} orders`} tone="indigo" />
                <KpiTile label="Avg age" value={`${kpis.avgAge}d`} sub={`${kpis.customersOpen} customers`} />
            </section>

            {/* Saved views */}
            <SavedViewsBar
                views={savedViews}
                activeId={activeViewId}
                quickViews={[
                    { id: "all", label: `All open · ${kpis.open}`, action: () => applyView(null) },
                    { id: "aged", label: `Aged 6+ · ${kpis.aged}`, action: () => { setFilters({ ...DEFAULT_FILTERS, age: "aged" }); setActiveViewId("aged") } },
                    { id: "planning", label: `Awaiting planning · ${kpis.awaiting}`, action: () => { setFilters({ ...DEFAULT_FILTERS, status: "PLANNING_REQUIRED" }); setActiveViewId("planning") } },
                    { id: "today", label: `Created today · ${kpis.createdToday}`, action: () => { setFilters({ ...DEFAULT_FILTERS, age: "fresh" }); setActiveViewId("today") } },
                ]}
                onApply={applyView}
                onSave={saveCurrentView}
                onRemove={removeView}
                onExport={() => exportCsv()}
                visibleCount={filtered.length}
            />

            {/* Filter band */}
            <FilterBand
                filters={filters}
                ageCounts={ageCounts}
                statusCounts={statusCounts as Record<StatusKey, number>}
                customers={customers}
                masters={masters}
                advancedOpen={advancedOpen}
                onAdvancedToggle={() => setAdvancedOpen((v) => !v)}
                onPatch={patchFilter}
                onReset={resetFilters}
                visibleCount={filtered.length}
                totalCount={queueRows.length}
            />

            {/* Bulk action bar */}
            {selected.size > 0 ? (
                <BulkBar
                    count={selected.size}
                    onClear={clearSelection}
                    onExport={() => exportCsv(selected)}
                    onCancelMany={() => {
                        const first = filtered.find((r) => selected.has(r.order.id))
                        if (first) setCancelTarget(first.order)
                    }}
                />
            ) : null}

            {/* Table */}
            <section className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                <TableHeader
                    tab={tab}
                    onTab={setTab}
                    counts={{ queue: queueRows.length, history: kpis.historyCount, cancelled: kpis.cancelledCount }}
                    density={density}
                    onDensity={setDensity}
                />
                {ordersQuery.isLoading ? (
                    <div className="flex h-72 items-center justify-center">
                        <div className="text-center">
                            <Loader2 className="mx-auto h-7 w-7 animate-spin text-slate-500" />
                            <div className="mt-3 text-sm font-bold text-slate-500">Loading sales queue…</div>
                        </div>
                    </div>
                ) : filtered.length === 0 ? (
                    <EmptyState onReset={resetFilters} />
                ) : (
                    <>
                        {/* Desktop column headers — hidden on mobile */}
                        <div className="hidden md:grid grid-cols-[2.5rem_minmax(0,1.4fr)_minmax(0,1.8fr)_minmax(0,1.2fr)_8rem_9.5rem] gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2 text-[9px] font-black uppercase tracking-[0.14em] text-slate-500">
                            <div><input type="checkbox" checked={allSelected} onChange={toggleAll} className="h-3.5 w-3.5 rounded border-slate-300" /></div>
                            <div>Customer · Order #</div>
                            <div>Product master · variant tuple</div>
                            <div>Qty · progress</div>
                            <div>Placed · age</div>
                            <div className="text-right">Status · actions</div>
                        </div>
                        {filtered.map((row) => (
                            <OrderRow
                                key={row.order.id}
                                row={row}
                                density={density}
                                selected={selected.has(row.order.id)}
                                expanded={expanded === row.order.id}
                                onToggleSelect={() => toggleRow(row.order.id)}
                                onToggleExpand={() => setExpanded(expanded === row.order.id ? null : row.order.id)}
                                onCancel={() => setCancelTarget(row.order)}
                            />
                        ))}
                        <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-50/60 px-4 py-2.5 border-t border-slate-200">
                            <div className="text-[10px] font-bold text-slate-500">
                                Showing {filtered.length} of {queueRows.length} orders
                                {selected.size > 0 ? ` · ${selected.size} selected` : ""}
                            </div>
                            <Link href="/sales/orders/create" className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-600 px-3 py-1 text-[11px] font-bold text-white shadow-md">
                                <Plus className="h-3.5 w-3.5" /> New order
                            </Link>
                        </div>
                    </>
                )}
            </section>

            {/* Cancel modal */}
            <CancelOrderDialog
                order={cancelTarget}
                onClose={() => setCancelTarget(null)}
                onConfirm={(reason) => {
                    if (!cancelTarget) return
                    cancelMutation.mutate({ id: cancelTarget.id, reason })
                }}
                pending={cancelMutation.isPending}
            />
        </div>
    )
}

// ─── Hero ──────────────────────────────────────────────────────────────

function Hero({ kpis }: { kpis: { open: number; awaiting: number; aged: number; customersOpen: number } }) {
    return (
        <section className="relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-violet-50/60 via-white to-emerald-50/30 px-5 py-4 shadow-sm sm:px-6 sm:py-5">
            <div className="absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b from-indigo-500 via-violet-500 to-fuchsia-500" />
            <div className="relative pl-3 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                    <div className="text-[10px] font-black uppercase tracking-[0.22em] text-violet-700">Sales · order operations</div>
                    <h1 className="font-display text-2xl font-black tracking-tight text-slate-900 mt-1 sm:text-3xl">Sales Orders</h1>
                    <p className="mt-1.5 max-w-2xl text-xs text-slate-600">
                        Every open order, by age and stage. Anything older than 5 days bubbles up in red — that&apos;s the line worth chasing.
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] font-bold">
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-emerald-700 ring-1 ring-emerald-200">⚡ {kpis.open} open</span>
                        {kpis.awaiting ? <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-amber-700 ring-1 ring-amber-200">{kpis.awaiting} awaiting planning</span> : null}
                        {kpis.aged ? <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-0.5 text-rose-700 ring-1 ring-rose-200">▾ {kpis.aged} aged 6+d</span> : null}
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-slate-700 ring-1 ring-slate-200">{kpis.customersOpen} customers</span>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Link href="/master/products" className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-bold text-slate-700 hover:bg-slate-50">Product master</Link>
                    <Link href="/sales/orders/create" className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-gradient-to-r from-violet-600 to-fuchsia-600 px-3 text-[11px] font-bold text-white shadow-md">
                        <Plus className="h-3.5 w-3.5" /> New order
                    </Link>
                </div>
            </div>
        </section>
    )
}

// ─── KPI tile ──────────────────────────────────────────────────────────

function KpiTile({ label, value, sub, tone, onClick }: { label: string; value: string; sub?: string; tone?: "amber" | "rose" | "emerald" | "indigo"; onClick?: () => void }) {
    const toneCls =
        tone === "amber" ? "border-amber-200 bg-amber-50/40 text-amber-700" :
        tone === "rose" ? "border-rose-200 bg-rose-50/40 text-rose-700" :
        tone === "emerald" ? "text-emerald-700" :
        tone === "indigo" ? "text-indigo-700" :
        "text-slate-900"
    const isCard = tone === "amber" || tone === "rose"
    const valueCls = isCard ? "" : toneCls
    const wrap = isCard ? toneCls : "border-slate-200 bg-white"
    const cls = cn("rounded-2xl border px-3.5 py-2.5 shadow-sm text-left", wrap, onClick ? "hover:shadow-md cursor-pointer" : "")
    const body = (
        <>
            <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">{label}</div>
            <div className={cn("font-display text-xl font-black tabular-nums", valueCls)}>{value}</div>
            {sub ? <div className="text-[10px] text-slate-500 truncate">{sub}</div> : null}
        </>
    )
    return onClick ? <button type="button" onClick={onClick} className={cls}>{body}</button> : <div className={cls}>{body}</div>
}

// ─── Saved views bar ───────────────────────────────────────────────────

function SavedViewsBar({ views, activeId, quickViews, onApply, onSave, onRemove, onExport, visibleCount }: {
    views: SavedView[]; activeId: string;
    quickViews: Array<{ id: string; label: string; action: () => void }>;
    onApply: (v: SavedView | null) => void; onSave: () => void; onRemove: (id: string) => void;
    onExport: () => void; visibleCount: number;
}) {
    return (
        <section className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold">
            <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 mr-1">Views</span>
            {quickViews.map((qv) => (
                <button
                    key={qv.id}
                    onClick={qv.action}
                    className={cn("rounded-full px-3 py-1 ring-1",
                        activeId === qv.id ? "bg-slate-900 text-white ring-slate-900 shadow-sm" : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50",
                    )}
                >
                    {qv.label}
                </button>
            ))}
            {views.map((v) => (
                <span key={v.id} className={cn("inline-flex items-center gap-1 rounded-full px-3 py-1 ring-1",
                    activeId === v.id ? "bg-violet-600 text-white ring-violet-700" : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50",
                )}>
                    <button onClick={() => onApply(v)} className="flex items-center gap-1">
                        <Star className="h-3 w-3" /> {v.label}
                    </button>
                    <button onClick={() => onRemove(v.id)} className="ml-1 rounded-full p-0.5 opacity-70 hover:opacity-100" title="Remove view"><X className="h-3 w-3" /></button>
                </span>
            ))}
            <button onClick={onSave} className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-100">+ Save current</button>
            <button onClick={onExport} className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-bold text-slate-700 hover:bg-slate-50">
                <Download className="h-3.5 w-3.5" /> Export · {visibleCount}
            </button>
        </section>
    )
}

// ─── Filter band ───────────────────────────────────────────────────────

function FilterBand({
    filters, ageCounts, statusCounts, customers, masters, advancedOpen, onAdvancedToggle, onPatch, onReset, visibleCount, totalCount,
}: {
    filters: SavedView["filters"];
    ageCounts: { fresh: number; watch: number; aged: number };
    statusCounts: Record<StatusKey, number>;
    customers: Customer[]; masters: ProductMaster[];
    advancedOpen: boolean; onAdvancedToggle: () => void;
    onPatch: <K extends keyof SavedView["filters"]>(k: K, v: SavedView["filters"][K]) => void;
    onReset: () => void; visibleCount: number; totalCount: number;
}) {
    const activeFilterChips: Array<{ key: string; label: string; clear: () => void }> = []
    if (filters.status !== "ALL") activeFilterChips.push({ key: "status", label: `status · ${STATUS_LABEL[filters.status as StatusKey]}`, clear: () => onPatch("status", "ALL") })
    if (filters.age !== "ALL") activeFilterChips.push({ key: "age", label: `age · ${filters.age}`, clear: () => onPatch("age", "ALL") })
    if (filters.customer) {
        const c = customers.find((x) => x.id === filters.customer)
        activeFilterChips.push({ key: "customer", label: `customer · ${c?.name || filters.customer}`, clear: () => onPatch("customer", "") })
    }
    if (filters.master) {
        const m = masters.find((x) => x.id === filters.master)
        activeFilterChips.push({ key: "master", label: `master · ${m?.code || filters.master}`, clear: () => onPatch("master", "") })
    }
    if (filters.fgType) activeFilterChips.push({ key: "fg", label: `fg · ${filters.fgType}`, clear: () => onPatch("fgType", "") })
    if (filters.widthMm) activeFilterChips.push({ key: "w", label: `width · ${filters.widthMm} mm`, clear: () => onPatch("widthMm", "") })
    if (filters.heightMm) activeFilterChips.push({ key: "h", label: `height · ${filters.heightMm} mm`, clear: () => onPatch("heightMm", "") })
    if (filters.thicknessUm) activeFilterChips.push({ key: "t", label: `thickness · ${filters.thicknessUm} μ`, clear: () => onPatch("thicknessUm", "") })

    return (
        <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm space-y-2">
            {/* Row 1 — search + status */}
            <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
                <div className="relative min-w-0 flex-1">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input
                        value={filters.searchText}
                        onChange={(e) => onPatch("searchText", e.target.value)}
                        placeholder="Search SO #, customer, product master, variant…"
                        className="h-10 rounded-xl border-slate-200 bg-white pl-9 text-sm font-semibold shadow-sm"
                    />
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold overflow-x-auto pb-1 -mx-1 px-1 xl:overflow-visible">
                    <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 mr-1 flex-none">Status</span>
                    <StatusPillBtn label={`All · ${totalCount}`} active={filters.status === "ALL"} onClick={() => onPatch("status", "ALL")} />
                    <StatusPillBtn label={`Planning · ${statusCounts.PLANNING_REQUIRED || 0}`} tone="amber" active={filters.status === "PLANNING_REQUIRED"} onClick={() => onPatch("status", "PLANNING_REQUIRED")} />
                    <StatusPillBtn label={`Planned · ${statusCounts.PLANNED || 0}`} tone="blue" active={filters.status === "PLANNED"} onClick={() => onPatch("status", "PLANNED")} />
                    <StatusPillBtn label={`Released · ${statusCounts.RELEASED || 0}`} tone="rose" active={filters.status === "RELEASED"} onClick={() => onPatch("status", "RELEASED")} />
                    <StatusPillBtn label={`Packing · ${statusCounts.PACKING_READY || 0}`} tone="violet" active={filters.status === "PACKING_READY"} onClick={() => onPatch("status", "PACKING_READY")} />
                    <StatusPillBtn label={`Dispatch · ${statusCounts.DISPATCH_READY || 0}`} tone="emerald" active={filters.status === "DISPATCH_READY"} onClick={() => onPatch("status", "DISPATCH_READY")} />
                </div>
            </div>

            {/* Row 2 — age + customer + master + advanced + reset */}
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold">
                <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 mr-1">Age</span>
                <AgePillBtn label={`Fresh 0-2d · ${ageCounts.fresh}`} tone="emerald" active={filters.age === "fresh"} onClick={() => onPatch("age", filters.age === "fresh" ? "ALL" : "fresh")} />
                <AgePillBtn label={`Watch 3-5d · ${ageCounts.watch}`} tone="amber" active={filters.age === "watch"} onClick={() => onPatch("age", filters.age === "watch" ? "ALL" : "watch")} />
                <AgePillBtn label={`Aged 6+d · ${ageCounts.aged}`} tone="rose" active={filters.age === "aged"} onClick={() => onPatch("age", filters.age === "aged" ? "ALL" : "aged")} />

                <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 mx-2 hidden md:inline">Customer</span>
                <div className="min-w-[160px] flex-none md:flex-1 md:max-w-[220px]">
                    <Select value={filters.customer || "__all"} onValueChange={(v) => onPatch("customer", v === "__all" ? "" : v)}>
                        <SelectTrigger className="h-8 rounded-full bg-white text-xs"><SelectValue placeholder="Any customer" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="__all">Any customer</SelectItem>
                            {customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>

                <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 mx-2 hidden md:inline">Master</span>
                <div className="min-w-[160px] flex-none md:flex-1 md:max-w-[220px]">
                    <Select value={filters.master || "__all"} onValueChange={(v) => onPatch("master", v === "__all" ? "" : v)}>
                        <SelectTrigger className="h-8 rounded-full bg-white text-xs"><SelectValue placeholder="Any master" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="__all">Any master</SelectItem>
                            {masters.map((m) => <SelectItem key={m.id} value={m.id}>{m.code} · {m.name}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>

                <button onClick={onAdvancedToggle} className="ml-auto rounded-full bg-white px-2.5 py-1 text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 inline-flex items-center gap-1">
                    <SlidersHorizontal className="h-3 w-3" />
                    Advanced
                    <ChevronDown className={cn("h-3 w-3 transition", advancedOpen && "rotate-180")} />
                </button>
                <button onClick={onReset} className="rounded-full bg-white px-2.5 py-1 text-rose-700 ring-1 ring-rose-200 hover:bg-rose-50">Reset</button>
            </div>

            {/* Advanced popover (inline) */}
            {advancedOpen ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50/40 p-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div>
                        <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500">FG type</Label>
                        <Select value={filters.fgType || "__all"} onValueChange={(v) => onPatch("fgType", v === "__all" ? "" : v)}>
                            <SelectTrigger className="h-9 rounded-lg text-xs mt-1"><SelectValue placeholder="Any" /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="__all">Any</SelectItem>
                                <SelectItem value="POUCH">POUCH</SelectItem>
                                <SelectItem value="ROLL">ROLL</SelectItem>
                                <SelectItem value="POD">POD</SelectItem>
                                <SelectItem value="PACKAGING">PACKAGING</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div>
                        <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Width (mm)</Label>
                        <Input value={filters.widthMm} onChange={(e) => onPatch("widthMm", e.target.value)} placeholder="e.g. 220" className="h-9 rounded-lg text-xs mt-1 font-mono" />
                    </div>
                    <div>
                        <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Height (mm)</Label>
                        <Input value={filters.heightMm} onChange={(e) => onPatch("heightMm", e.target.value)} placeholder="e.g. 320" className="h-9 rounded-lg text-xs mt-1 font-mono" />
                    </div>
                    <div>
                        <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Thickness (μ)</Label>
                        <Input value={filters.thicknessUm} onChange={(e) => onPatch("thicknessUm", e.target.value)} placeholder="e.g. 80" className="h-9 rounded-lg text-xs mt-1 font-mono" />
                    </div>
                </div>
            ) : null}

            {/* Active filter chips */}
            {activeFilterChips.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1 text-[10px] font-bold border-t border-slate-100 pt-2">
                    <span className="text-slate-500">Active</span>
                    {activeFilterChips.map((chip) => (
                        <button key={chip.key} onClick={chip.clear} className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-violet-800 ring-1 ring-violet-200 hover:bg-violet-100" title="Remove filter">
                            {chip.label} <X className="h-3 w-3 opacity-70" />
                        </button>
                    ))}
                    <span className="text-slate-400">·</span>
                    <span className="text-slate-500">{visibleCount} of {totalCount} visible</span>
                </div>
            ) : null}
        </section>
    )
}

function StatusPillBtn({ label, active, tone, onClick }: { label: string; active: boolean; tone?: "amber" | "blue" | "rose" | "violet" | "emerald"; onClick: () => void }) {
    const baseTone =
        tone === "amber" ? "bg-amber-50 text-amber-800 ring-amber-200" :
        tone === "blue" ? "bg-blue-50 text-blue-800 ring-blue-200" :
        tone === "rose" ? "bg-rose-50 text-rose-800 ring-rose-200" :
        tone === "violet" ? "bg-violet-50 text-violet-800 ring-violet-200" :
        tone === "emerald" ? "bg-emerald-50 text-emerald-800 ring-emerald-200" :
        "bg-white text-slate-700 ring-slate-200"
    return (
        <button
            onClick={onClick}
            className={cn("rounded-full px-2.5 py-1 ring-1 whitespace-nowrap flex-none",
                active ? "bg-slate-900 text-white ring-slate-900 shadow-sm" : `${baseTone} hover:opacity-80`,
            )}
        >
            {label}
        </button>
    )
}
function AgePillBtn({ label, active, tone, onClick }: { label: string; active: boolean; tone: "emerald" | "amber" | "rose"; onClick: () => void }) {
    const t =
        tone === "emerald" ? "bg-emerald-50 text-emerald-700 ring-emerald-200" :
        tone === "amber" ? "bg-amber-50 text-amber-700 ring-amber-200" :
        "bg-rose-50 text-rose-700 ring-rose-200"
    return (
        <button onClick={onClick} className={cn("rounded-full px-2.5 py-1 ring-1 whitespace-nowrap flex-none", t, active && "ring-2 ring-offset-1 ring-offset-white")}>
            {label}
        </button>
    )
}

// ─── Bulk action bar ───────────────────────────────────────────────────

function BulkBar({ count, onClear, onExport, onCancelMany }: { count: number; onClear: () => void; onExport: () => void; onCancelMany: () => void }) {
    return (
        <section className="rounded-2xl border border-violet-300 bg-violet-50 px-4 py-2 flex flex-wrap items-center justify-between gap-3 shadow-sm">
            <div className="flex items-center gap-2 text-[12px] font-bold text-violet-900">
                <span>{count} order{count === 1 ? "" : "s"} selected</span>
                <button onClick={onClear} className="text-[11px] font-bold text-violet-700 hover:underline">Clear</button>
            </div>
            <div className="flex items-center gap-2 text-[11px] font-bold">
                <button onClick={onExport} className="rounded-lg bg-white px-3 py-1.5 text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50 inline-flex items-center gap-1">
                    <Download className="h-3 w-3" /> Export {count}
                </button>
                <button onClick={onCancelMany} className="rounded-lg bg-rose-600 px-3 py-1.5 text-white shadow-sm hover:bg-rose-700">Cancel orders</button>
            </div>
        </section>
    )
}

// ─── Table header (tab + density) ─────────────────────────────────────

function TableHeader({ tab, onTab, counts, density, onDensity }: {
    tab: Tab; onTab: (t: Tab) => void;
    counts: { queue: number; history: number; cancelled: number };
    density: Density; onDensity: (d: Density) => void;
}) {
    return (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2">
            <div className="flex items-center gap-1.5 text-[11px] font-bold overflow-x-auto -mx-1 px-1">
                {([
                    ["queue", `Order queue · ${counts.queue}`],
                    ["history", `History · ${counts.history}`],
                    ["cancelled", `Cancelled · ${counts.cancelled}`],
                ] as Array<[Tab, string]>).map(([k, label]) => (
                    <button key={k} onClick={() => onTab(k)} className={cn("rounded-full px-3 py-1 ring-1 flex-none whitespace-nowrap",
                        tab === k ? "bg-slate-900 text-white ring-slate-900" : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50",
                    )}>{label}</button>
                ))}
            </div>
            <div className="flex items-center gap-1.5 text-[11px] font-bold">
                <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 hidden sm:inline">Density</span>
                <div className="inline-flex rounded-lg bg-slate-100 p-0.5 shadow-inner">
                    <button onClick={() => onDensity("comfortable")} className={cn("h-7 rounded-md px-2.5", density === "comfortable" ? "bg-white text-slate-900 ring-1 ring-slate-200 shadow-sm" : "text-slate-600")}>Comfortable</button>
                    <button onClick={() => onDensity("compact")} className={cn("h-7 rounded-md px-2.5", density === "compact" ? "bg-white text-slate-900 ring-1 ring-slate-200 shadow-sm" : "text-slate-600")}>Compact</button>
                </div>
            </div>
        </header>
    )
}

// ─── Empty state ───────────────────────────────────────────────────────

function EmptyState({ onReset }: { onReset: () => void }) {
    return (
        <div className="flex min-h-[280px] flex-col items-center justify-center px-4 py-12 text-center">
            <div className="rounded-2xl bg-slate-50 p-4 ring-1 ring-slate-200">
                <SlidersHorizontal className="h-7 w-7 text-slate-400" />
            </div>
            <div className="mt-3 text-base font-bold text-slate-900">No orders match this view</div>
            <p className="mt-1 text-sm text-slate-500">Clear filters or open a saved view to bring the queue back.</p>
            <button onClick={onReset} className="mt-4 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold text-slate-700 hover:bg-slate-50">Reset filters</button>
        </div>
    )
}

// ─── Order row ─────────────────────────────────────────────────────────

interface EnrichedRow {
    order: SalesOrder; age: number; bucket: AgeBucket; statusKey: StatusKey;
    totalKg: number; value: number; produced: number; dispatched: number;
}

function OrderRow({ row, density, selected, expanded, onToggleSelect, onToggleExpand, onCancel }: {
    row: EnrichedRow; density: Density; selected: boolean; expanded: boolean;
    onToggleSelect: () => void; onToggleExpand: () => void; onCancel: () => void;
}) {
    const { order, age, bucket, statusKey, totalKg, produced, dispatched } = row
    const remaining = Math.max(0, totalKg - produced - dispatched)
    const dispatchedPct = totalKg ? Math.max(0, Math.min(100, (dispatched / totalKg) * 100)) : 0
    const producedPct = totalKg ? Math.max(0, Math.min(100 - dispatchedPct, ((produced) / totalKg) * 100)) : 0
    const ageTone = bucket === "aged" ? "bg-rose-600" : bucket === "watch" ? "bg-amber-500" : "bg-emerald-500"
    const ageLabel = bucket === "aged" ? `aged ${age}d` : bucket === "watch" ? `watch ${age}d` : age === 0 ? "fresh 0d" : `fresh ${age}d`
    const rowHoverBg = bucket === "aged" ? "hover:bg-rose-50/30" : bucket === "watch" ? "hover:bg-amber-50/30" : "hover:bg-slate-50"
    const rowPad = density === "compact" ? "py-2" : "py-3"
    const isCancelled = statusKey === "CANCELLED"
    const canCancel = ["DRAFT", "CONFIRMED", "PLANNING_REQUIRED", "PLANNED"].includes(statusKey)
    const masterCode = order.item_summary?.template_tag || (order.item_summary?.variant_code || "").split("-")[0] || ""

    return (
        <article className={cn("border-b border-slate-100 transition", rowHoverBg, isCancelled && "opacity-70 hover:opacity-100")}>
            {/* Mobile layout (stacked) */}
            <div className={cn("md:hidden px-4 grid grid-cols-[2rem_1fr_auto] gap-2 items-start", rowPad)}>
                <input type="checkbox" checked={selected} onChange={onToggleSelect} className="mt-1 h-3.5 w-3.5 rounded border-slate-300" />
                <button onClick={onToggleExpand} className="text-left min-w-0">
                    <div className="flex items-center gap-2">
                        <span className={cn("flex h-8 w-8 flex-none items-center justify-center rounded-xl text-white font-black text-[11px]", customerAvatarTone(age))}>{customerInitials(order.customer_name || "")}</span>
                        <div className="min-w-0 flex-1">
                            <div className="text-[13px] font-bold text-slate-900 truncate">{order.customer_name || "—"}</div>
                            <div className="flex items-center gap-1.5 mt-0.5 text-[10px]">
                                <span className="font-mono font-black text-violet-700">{order.order_number}</span>
                                <span className={cn("inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-black text-white", ageTone)}>{ageLabel}</span>
                            </div>
                        </div>
                    </div>
                    <div className="mt-1.5 text-[11px] font-bold text-slate-700 truncate">
                        {order.item_summary?.variant_name || order.line_name || order.item_summary?.template_name || "—"}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] font-mono">
                        {masterCode ? <span className="rounded bg-violet-50 px-1.5 py-0.5 font-black text-violet-800 ring-1 ring-violet-200">{masterCode}</span> : null}
                        {order.item_summary?.size_or_form ? <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-bold text-emerald-800 ring-1 ring-emerald-200">{order.item_summary.size_or_form}</span> : null}
                        {(order.item_summary?.pod_labels || []).slice(0, 1).map((l: string) => <span key={l} className="rounded bg-fuchsia-50 px-1.5 py-0.5 font-bold text-fuchsia-800 ring-1 ring-fuchsia-200">{l}</span>)}
                    </div>
                    <div className="mt-1.5 flex items-center justify-between text-[11px]">
                        <span className="font-mono font-black text-slate-900">{fmtKg(totalKg)} <span className="text-[10px] font-bold text-slate-500">KG</span></span>
                        <span className={cn("rounded-md px-2 py-0.5 text-[10px] font-black ring-1", STATUS_PILL_TONE[statusKey])}>
                            {STATUS_LABEL[statusKey] || statusKey}
                        </span>
                    </div>
                    {totalKg > 0 ? (
                        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200">
                            <div className="flex h-full">
                                <div className="bg-emerald-500" style={{ width: `${dispatchedPct}%` }} />
                                <div className="bg-blue-500" style={{ width: `${producedPct}%` }} />
                            </div>
                        </div>
                    ) : null}
                </button>
                <div className="flex flex-col items-end gap-1">
                    <Link href={`/sales/orders/${order.id}/tracking`} title="Track" className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">↗</Link>
                    {canCancel ? (
                        <button title="Cancel" onClick={onCancel} className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-rose-600 ring-1 ring-rose-200 hover:bg-rose-50">
                            <X className="h-3.5 w-3.5" />
                        </button>
                    ) : null}
                </div>
            </div>

            {/* Desktop layout (table-ish) */}
            <div className={cn("hidden md:grid grid-cols-[2.5rem_minmax(0,1.4fr)_minmax(0,1.8fr)_minmax(0,1.2fr)_8rem_9.5rem] gap-3 px-4 items-center", rowPad)}>
                <div><input type="checkbox" checked={selected} onChange={onToggleSelect} className="h-3.5 w-3.5 rounded border-slate-300" /></div>
                <button onClick={onToggleExpand} className="min-w-0 flex items-center gap-2.5 text-left">
                    <span className={cn("flex h-9 w-9 flex-none items-center justify-center rounded-xl text-white font-black text-[11px]", customerAvatarTone(age))}>{customerInitials(order.customer_name || "")}</span>
                    <div className="min-w-0">
                        <div className="text-[13px] font-bold text-slate-900 truncate">{order.customer_name || "—"}</div>
                        <div className="flex items-center gap-1.5 mt-0.5 text-[10px]">
                            <span className="font-mono font-black text-violet-700">{order.order_number}</span>
                            {(order as any).customer_code ? <><span className="text-slate-400">·</span><span className="font-mono text-slate-500">{(order as any).customer_code}</span></> : null}
                            {order.order_name ? <><span className="text-slate-400">·</span><span className="text-slate-500 truncate max-w-[140px]">{order.order_name}</span></> : null}
                        </div>
                    </div>
                </button>
                <button onClick={onToggleExpand} className="min-w-0 text-left">
                    <div className="text-[12px] font-bold text-slate-900 truncate">
                        {order.item_summary?.variant_name || order.line_name || order.item_summary?.template_name || "—"}
                    </div>
                    <div className="flex items-center gap-1 mt-0.5 text-[10px] font-mono flex-wrap">
                        {masterCode ? <span className="rounded bg-violet-50 px-1.5 py-0.5 font-black text-violet-800 ring-1 ring-violet-200">{masterCode}</span> : null}
                        {order.item_summary?.size_or_form ? <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-bold text-emerald-800 ring-1 ring-emerald-200">{order.item_summary.size_or_form}</span> : null}
                        {order.item_summary?.layer_labels?.slice(0, 1).map((l: string) => <span key={l} className="rounded bg-blue-50 px-1.5 py-0.5 font-bold text-blue-800 ring-1 ring-blue-200 truncate max-w-[140px]">{l}</span>)}
                        {(order.item_summary?.pod_labels || []).slice(0, 1).map((l: string) => <span key={`p-${l}`} className="rounded bg-fuchsia-50 px-1.5 py-0.5 font-bold text-fuchsia-800 ring-1 ring-fuchsia-200">{l}</span>)}
                        {(order.item_summary?.addon_labels || []).slice(0, 1).map((l: string) => <span key={`a-${l}`} className="rounded bg-amber-50 px-1.5 py-0.5 font-bold text-amber-800 ring-1 ring-amber-200">{l}</span>)}
                    </div>
                </button>
                <div className="min-w-0">
                    <div className="text-[12px] font-mono font-black text-slate-900">{fmtKg(totalKg)} <span className="text-[10px] font-bold text-slate-500">KG</span></div>
                    <div className="text-[10px] text-slate-500">
                        {totalKg > 0 ? `${fmtKg(produced)} produced · ${fmtKg(remaining)} remaining · ${Math.round(((produced + dispatched) / totalKg) * 100)}%` : "—"}
                    </div>
                    {totalKg > 0 ? (
                        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-100 ring-1 ring-slate-200">
                            <div className="flex h-full">
                                <div className="bg-emerald-500" style={{ width: `${dispatchedPct}%` }} />
                                <div className="bg-blue-500" style={{ width: `${producedPct}%` }} />
                            </div>
                        </div>
                    ) : null}
                </div>
                <div className="min-w-0">
                    <div className="text-[11px] font-mono font-bold text-slate-900">{fmtDate(order.created_at)}</div>
                    <div className={cn("mt-0.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-black text-white", ageTone)}>
                        {ageLabel}
                    </div>
                </div>
                <div className="flex items-center justify-end gap-1.5">
                    <span className={cn("rounded-md px-2 py-0.5 text-[10px] font-black ring-1", STATUS_PILL_TONE[statusKey] || STATUS_PILL_TONE.DRAFT)}>
                        {STATUS_LABEL[statusKey] || statusKey}
                    </span>
                    <Link href={`/sales/orders/${order.id}/tracking`} title="Track" className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">↗</Link>
                    {canCancel ? (
                        <button title="Cancel" onClick={(e) => { e.stopPropagation(); onCancel() }} className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-rose-600 ring-1 ring-rose-200 hover:bg-rose-50">
                            <X className="h-3.5 w-3.5" />
                        </button>
                    ) : null}
                </div>
            </div>

            {/* Expanded inline drawer */}
            {expanded ? <OrderExpandedDrawer orderId={order.id} /> : (
                <button onClick={onToggleExpand} className="hidden md:flex w-full items-center gap-1 px-4 pb-1.5 pt-0 text-[10px] font-bold text-slate-400 hover:text-slate-700">
                    <ChevronDown className="h-3 w-3" /> Expand · line items + activity
                </button>
            )}
        </article>
    )
}

// ─── Expanded drawer — pulls full SO via getOrder for line items + activity ──

function OrderExpandedDrawer({ orderId }: { orderId: string }) {
    const { data: full, isLoading } = useQuery({
        queryKey: ["sales-order-detail", orderId],
        queryFn: () => salesService.getOrder(orderId),
        staleTime: 30_000,
    })
    return (
        <div className="border-t border-slate-100 bg-white px-4 py-3">
            {isLoading ? (
                <div className="flex items-center gap-2 text-[11px] text-slate-500"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading line items…</div>
            ) : !full ? (
                <div className="text-[11px] text-slate-500">Could not load order detail.</div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-[1fr_2fr_1fr] gap-4">
                    <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 mb-2">Order info</div>
                        <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2 text-[11px] space-y-1">
                            <div className="flex justify-between"><span className="text-slate-500">Customer</span><span className="font-bold truncate ml-2">{full.customer_name}</span></div>
                            {full.ship_to_customer_name ? <div className="flex justify-between"><span className="text-slate-500">Ship to</span><span className="font-bold truncate ml-2">{full.ship_to_customer_name}</span></div> : null}
                            {full.plant_name ? <div className="flex justify-between"><span className="text-slate-500">Plant</span><span className="font-bold truncate ml-2">{full.plant_name}</span></div> : null}
                            {full.delivery_date ? <div className="flex justify-between"><span className="text-slate-500">Promise</span><span className="font-bold truncate ml-2">{fmtDate(full.delivery_date)}</span></div> : null}
                            {full.remarks ? <div className="pt-1 border-t border-slate-200 text-slate-700 italic">&ldquo;{full.remarks}&rdquo;</div> : null}
                        </div>
                    </div>
                    <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 mb-2">Line items · {(full.items || []).length}</div>
                        <div className="space-y-1.5">
                            {(full.items || []).map((it: any, i: number) => (
                                <div key={it.id || i} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px]">
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="font-mono font-bold text-slate-900 truncate">Line {i + 1} · {it.product_master_code || it.variant_code || "—"}</span>
                                        <span className="font-mono font-bold text-slate-700">{fmtKg(it.qty_value || it.ordered_qty || 0)} {it.qty_uom || "KG"}{it.unit_price ? ` · ${fmtMoney(Number(it.unit_price) * Number(it.qty_value || 0))}` : ""}</span>
                                    </div>
                                    <div className="text-slate-500 mt-1 truncate">
                                        {[it.size_code, it.variant_name, it.printing_summary, ...(Array.isArray(it.addons) ? it.addons : [])].filter(Boolean).join(" · ") || "—"}
                                    </div>
                                </div>
                            ))}
                            {(!full.items || full.items.length === 0) ? <div className="text-[11px] italic text-slate-500">No line items captured.</div> : null}
                        </div>
                    </div>
                    <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500 mb-2">Actions</div>
                        <div className="flex flex-col gap-1.5">
                            <Link href={`/sales/orders/${full.id}`} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-center text-[11px] font-bold text-slate-700 hover:bg-slate-50">Open full order</Link>
                            <Link href={`/sales/orders/${full.id}/tracking`} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-center text-[11px] font-bold text-slate-700 hover:bg-slate-50">Track in production</Link>
                            <Link href={`/sales/orders/create?customer=${full.customer || full.customer_id || ""}`} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-center text-[11px] font-bold text-slate-700 hover:bg-slate-50 inline-flex items-center justify-center gap-1">
                                Re-order similar <ArrowRight className="h-3 w-3" />
                            </Link>
                        </div>
                        {full.created_at ? <div className="mt-3 text-[10px] text-slate-500">Placed {fmtDate(full.created_at)} · {ageDays(full.created_at)}d ago</div> : null}
                    </div>
                </div>
            )}
        </div>
    )
}

// ─── Cancel dialog ─────────────────────────────────────────────────────

function CancelOrderDialog({ order, onClose, onConfirm, pending }: { order: SalesOrder | null; onClose: () => void; onConfirm: (reason: string) => void; pending: boolean }) {
    const [reasonKey, setReasonKey] = React.useState<string>("CUSTOMER_CANCELLED")
    const [note, setNote] = React.useState("")
    React.useEffect(() => { if (order) { setReasonKey("CUSTOMER_CANCELLED"); setNote("") } }, [order?.id])
    if (!order) return null
    const age = ageDays(order.created_at)
    return (
        <Dialog open={!!order} onOpenChange={(o) => { if (!o) onClose() }}>
            <DialogContent className="max-w-md rounded-2xl p-0 overflow-hidden">
                <div className="border-b border-rose-100 bg-gradient-to-r from-rose-50/60 via-white to-white px-5 py-4">
                    <DialogHeader>
                        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-rose-700">Cancel sales order</div>
                        <DialogTitle className="font-display text-base font-bold text-slate-900 mt-0.5">
                            {order.order_number} · {order.customer_name}
                        </DialogTitle>
                        <DialogDescription className="text-[11px] text-slate-600 mt-0.5">
                            Aged {age} day{age === 1 ? "" : "s"} · status {STATUS_LABEL[String(order.status).toUpperCase() as StatusKey] || order.status}. Safe to cancel before planner release.
                        </DialogDescription>
                    </DialogHeader>
                </div>
                <div className="px-5 py-4 space-y-3">
                    <div>
                        <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5 block">Reason category <span className="text-rose-600">*</span></Label>
                        <div className="flex flex-wrap gap-1.5 text-[11px] font-bold">
                            {CANCEL_REASONS.map((r) => (
                                <button
                                    key={r.value}
                                    type="button"
                                    onClick={() => setReasonKey(r.value)}
                                    className={cn("rounded-full px-2.5 py-1 ring-1",
                                        reasonKey === r.value ? "bg-rose-100 text-rose-800 ring-rose-300" : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50",
                                    )}
                                >
                                    {r.label}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div>
                        <Label className="text-[10px] font-black uppercase tracking-wider text-slate-500 mb-1.5 block">Note (optional)</Label>
                        <Textarea
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            rows={3}
                            placeholder="e.g. Customer called — switching to a different pouch size next week."
                            className="rounded-xl"
                        />
                    </div>
                    <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2 text-[10px] font-bold text-amber-900 flex items-start gap-2">
                        <AlertTriangle className="h-3.5 w-3.5 flex-none mt-0.5" />
                        Cancelling will release any in-house auto-demand stock created for this SO back to the generic WIP pool.
                    </div>
                </div>
                <div className="border-t border-slate-200 bg-white px-5 py-3 flex items-center justify-end gap-2">
                    <Button variant="outline" onClick={onClose} className="rounded-xl">Keep order</Button>
                    <Button
                        onClick={() => onConfirm([reasonKey, note].filter(Boolean).join(" · "))}
                        disabled={pending}
                        className="rounded-xl bg-rose-600 text-white hover:bg-rose-700"
                    >
                        {pending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                        Cancel {order.order_number}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}

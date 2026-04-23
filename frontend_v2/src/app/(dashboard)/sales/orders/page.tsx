"use client"

import Link from "next/link"
import { type ReactNode, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { type ColumnDef } from "@tanstack/react-table"
import { Activity, CheckCircle2, Loader2, Plus, Search, SlidersHorizontal, XCircle } from "lucide-react"
import { toast } from "sonner"

import { DataTable } from "@/components/ui/data-table"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { normalizeProductSpec } from "@/lib/product-spec"
import { type SalesOrder, salesService } from "@/services/sales"

type OrderTab = "active" | "completed"
type CompletedStatusFilter = "ALL" | "COMPLETED" | "CANCELLED"
type CompletedTypeFilter = "ALL" | "POUCH" | "ROLL"
type CompletedWindowFilter = "ALL" | "30" | "90" | "180"

function formatDate(value: string) {
    if (!value) return "No date"
    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value
    return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
}

function safeNumber(value: unknown) {
    const num = Number(value)
    return Number.isFinite(num) ? num : 0
}

function firstLineLabel(order: SalesOrder) {
    const summary = order.item_summary || {}
    const variantLabel = [summary.variant_code, summary.variant_name].filter(Boolean).join(" · ")
    return variantLabel || summary.template_name || order.order_name || order.order_number
}

function progressParts(order: SalesOrder) {
    const summary = order.fulfillment_summary || {}
    const qty = order.qty_summary || {}
    const orderedBasis = qty.ordered_pcs ?? qty.ordered_kg ?? 0
    const producedBasis = qty.ordered_pcs != null ? safeNumber(summary.produced_pcs) : safeNumber(summary.produced_kg)
    const dispatchedBasis = qty.ordered_pcs != null ? safeNumber(summary.dispatched_pcs) : safeNumber(summary.dispatched_kg)
    const remainingBasis = qty.ordered_pcs != null ? safeNumber(summary.remaining_pcs) : safeNumber(summary.remaining_kg)
    const total = Math.max(orderedBasis, producedBasis, dispatchedBasis + remainingBasis, 0)
    if (!total) return { dispatchedPct: 0, producedOpenPct: 0, remainingPct: 0 }
    const dispatchedPct = Math.max(0, Math.min(100, (dispatchedBasis / total) * 100))
    const producedOpenPct = Math.max(0, Math.min(100 - dispatchedPct, ((producedBasis - dispatchedBasis) / total) * 100))
    const remainingPct = Math.max(0, 100 - dispatchedPct - producedOpenPct)
    return { dispatchedPct, producedOpenPct, remainingPct }
}

function isCompletedOrder(order: SalesOrder) {
    return ["COMPLETED", "CANCELLED"].includes(String(order.status || "").toUpperCase())
}

function canCancelBeforeRelease(order: SalesOrder) {
    return ["DRAFT", "CONFIRMED", "PLANNING_REQUIRED", "PLANNED"].includes(String(order.status || "").toUpperCase())
}

function withinDays(value: string | null | undefined, days: number) {
    if (!value) return false
    const timestamp = new Date(value).getTime()
    if (Number.isNaN(timestamp)) return false
    return Date.now() - timestamp <= days * 24 * 60 * 60 * 1000
}

function badgeTone(kind: "type" | "geometry" | "layer" | "printing" | "pod" | "template" | "stock" | "packaging") {
    switch (kind) {
        case "type":
            return "border-orange-200 bg-orange-50 text-orange-700"
        case "geometry":
            return "border-teal-200 bg-teal-50 text-teal-700"
        case "layer":
            return "border-amber-200 bg-amber-50 text-amber-700"
        case "printing":
            return "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700"
        case "pod":
            return "border-rose-200 bg-rose-50 text-rose-700"
        case "template":
            return "border-violet-200 bg-violet-50 text-violet-700"
        case "stock":
            return "border-indigo-200 bg-indigo-50 text-indigo-700"
        case "packaging":
            return "border-emerald-200 bg-emerald-50 text-emerald-700"
        default:
            return "border-slate-200 bg-slate-50 text-slate-700"
    }
}

function Pill({ children, kind }: { children: ReactNode; kind: Parameters<typeof badgeTone>[0] }) {
    return (
        <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-bold", badgeTone(kind))}>
            {children}
        </span>
    )
}

function StatusPill({ status }: { status: string }) {
    const normalized = String(status || "").toUpperCase()
    const tone = normalized === "COMPLETED"
        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
        : normalized === "CANCELLED"
            ? "border-rose-200 bg-rose-50 text-rose-700"
            : normalized === "PACKING_READY"
                ? "border-violet-200 bg-violet-50 text-violet-700"
            : normalized === "DISPATCH_READY"
                ? "border-cyan-200 bg-cyan-50 text-cyan-700"
                : normalized === "RELEASED"
                    ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                    : normalized === "PLANNING_REQUIRED"
                        ? "border-amber-200 bg-amber-50 text-amber-700"
                        : "border-slate-200 bg-slate-50 text-slate-700"
    return <span className={cn("inline-flex rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em]", tone)}>{normalized}</span>
}

export default function SalesOrdersPage() {
    const queryClient = useQueryClient()
    const [tab, setTab] = useState<OrderTab>("active")
    const [searchText, setSearchText] = useState("")
    const [completedStatus, setCompletedStatus] = useState<CompletedStatusFilter>("ALL")
    const [completedType, setCompletedType] = useState<CompletedTypeFilter>("ALL")
    const [completedWindow, setCompletedWindow] = useState<CompletedWindowFilter>("90")
    const [variantFilter, setVariantFilter] = useState("")
    const [gradeFilter, setGradeFilter] = useState("")
    const [thicknessFilter, setThicknessFilter] = useState("")
    const [sizeFilter, setSizeFilter] = useState("")
    const { data: orders = [], isLoading } = useQuery({
        queryKey: ["sales-orders"],
        queryFn: () => salesService.getOrders(),
    })
    const cancelOrder = useMutation({
        mutationFn: ({ id, reason }: { id: string; reason: string }) => salesService.cancelOrder(id, reason),
        onSuccess: () => {
            toast.success("Sales order cancelled")
            queryClient.invalidateQueries({ queryKey: ["sales-orders"] })
        },
        onError: (error: any) => {
            toast.error("Sales order was not cancelled", {
                description: error?.response?.data?.detail || error?.message || "Planner may have already released this order.",
            })
        },
    })

    const activeOrders = useMemo(() => orders.filter((order) => !isCompletedOrder(order)), [orders])
    const completedOrders = useMemo(() => orders.filter((order) => isCompletedOrder(order)), [orders])
    const shownOrders = useMemo(() => {
        const list = tab === "active" ? activeOrders : completedOrders
        return list.filter((order) => {
            const haystack = [
                order.order_number,
                order.order_name,
                order.customer_name,
                order.status,
                order.item_summary?.variant_code,
                order.item_summary?.variant_name,
                order.item_summary?.template_name,
                order.item_summary?.template_tag,
                order.item_summary?.search_text,
            ]
                .filter(Boolean)
                .join(" ")
                .toLowerCase()

            if (searchText.trim() && !haystack.includes(searchText.trim().toLowerCase())) {
                return false
            }

            const spec = normalizeProductSpec(order)
            if (variantFilter.trim()) {
                const q = variantFilter.trim().toLowerCase()
                const match = [spec.variantCode, spec.variantName, ...spec.layers.flatMap((layer) => [layer.variantCode, layer.variantName, layer.label])]
                    .join(" ")
                    .toLowerCase()
                    .includes(q)
                if (!match) return false
            }
            if (gradeFilter.trim()) {
                const q = gradeFilter.trim().toLowerCase()
                if (!spec.layers.map((layer) => layer.grade).join(" ").toLowerCase().includes(q)) return false
            }
            if (thicknessFilter.trim()) {
                const q = thicknessFilter.trim().toLowerCase()
                if (!spec.layers.map((layer) => `${layer.thicknessMicron ?? ""}`).join(" ").toLowerCase().includes(q)) return false
            }
            if (sizeFilter.trim()) {
                const q = sizeFilter.trim().toLowerCase()
                if (!spec.size.label.toLowerCase().includes(q)) return false
            }

            if (tab === "completed") {
                const normalizedStatus = String(order.status || "").toUpperCase()
                const finishedGoodType = String(order.item_summary?.finished_good_type || "").toUpperCase()
                if (completedStatus !== "ALL" && normalizedStatus !== completedStatus) {
                    return false
                }
                if (completedType !== "ALL" && finishedGoodType !== completedType) {
                    return false
                }
                if (completedWindow !== "ALL" && !withinDays(order.created_at, Number(completedWindow))) {
                    return false
                }
            }

            return true
        })
    }, [activeOrders, completedOrders, completedStatus, completedType, completedWindow, gradeFilter, searchText, sizeFilter, tab, thicknessFilter, variantFilter])

    const columns: ColumnDef<SalesOrder>[] = [
        {
            accessorKey: "order_number",
            header: () => <span className="pl-2 text-[11px] font-semibold text-slate-500">ORDER</span>,
            cell: ({ row }) => (
                <div className="pl-2">
                    <div className="text-sm font-black text-slate-900">{row.original.order_number}</div>
                    <div className="mt-0.5 text-[11px] font-semibold text-slate-700">{row.original.order_name || "Single order"}</div>
                    <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                        {formatDate(row.original.created_at)}
                    </div>
                </div>
            ),
        },
        {
            accessorKey: "customer_name",
            header: () => <span className="text-[11px] font-semibold text-slate-500">CUSTOMER</span>,
            cell: ({ row }) => (
                <div>
                    <div className="text-sm font-semibold text-slate-800">{row.original.customer_name}</div>
                    <div className="mt-1 text-[11px] text-slate-500">
                        Ship to {row.original.ship_to_customer_name || row.original.customer_name}
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500">
                        {row.original.delivery_date ? `Delivery ${formatDate(row.original.delivery_date)}` : "Delivery pending"}
                    </div>
                    {row.original.remarks ? <div className="mt-1 line-clamp-1 text-[11px] text-amber-700">Note: {row.original.remarks}</div> : null}
                </div>
            ),
        },
        {
            id: "item_summary",
            header: () => <span className="text-[11px] font-semibold text-slate-500">SKU / PRODUCT TRUTH</span>,
            cell: ({ row }) => {
                const summary = row.original.item_summary || {}
                const spec = normalizeProductSpec(row.original)
                const claimed = summary.claimed_stock_order_nos || []
                return (
                    <div className="min-w-[360px]">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-black text-slate-900">{spec.productName || firstLineLabel(row.original)}</span>
                            {(summary.line_count || 0) > 1 ? (
                                <Pill kind="stock">+{(summary.line_count || 1) - 1} more</Pill>
                            ) : null}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                            {summary.finished_good_type ? <Pill kind="type">{summary.finished_good_type}</Pill> : null}
                            {spec.size.label ? <Pill kind="geometry">{spec.size.label}</Pill> : null}
                            {spec.layers.length
                                ? spec.layers.map((layer) => <Pill key={`${row.original.id}-${layer.index}-${layer.label}`} kind="layer">{layer.label}</Pill>)
                                : summary.layer_count
                                    ? <Pill kind="layer">{summary.layer_count} layer(s)</Pill>
                                    : null}
                            {spec.podLabels.length ? spec.podLabels.map((label) => <Pill key={`${row.original.id}-pod-${label}`} kind="pod">{label}</Pill>) : summary.printing_summary ? <Pill kind="printing">{summary.printing_summary}</Pill> : null}
                            {spec.addonLabels.length ? spec.addonLabels.slice(0, 4).map((label) => <Pill key={`${row.original.id}-addon-${label}`} kind="packaging">{label}</Pill>) : summary.packaging_summary ? <Pill kind="packaging">{summary.packaging_summary}</Pill> : null}
                            {summary.template_tag ? <Pill kind="template">{summary.template_tag}</Pill> : null}
                            {claimed.length ? <Pill kind="stock">Stock {claimed.join(", ")}</Pill> : null}
                        </div>
                        <div className="mt-2 grid grid-cols-3 gap-1.5 text-[10px] font-black uppercase text-slate-600">
                            <span className="rounded-lg bg-slate-50 px-2 py-1">Grade {spec.layers.map((layer) => layer.grade).filter(Boolean).slice(0, 2).join(", ") || "—"}</span>
                            <span className="rounded-lg bg-slate-50 px-2 py-1">Thick {spec.layers.map((layer) => layer.thicknessMicron).filter((value) => value != null).slice(0, 2).join(", ") || "—"}u</span>
                            <span className="rounded-lg bg-slate-50 px-2 py-1">Width {spec.layers.map((layer) => layer.widthMm).filter((value) => value != null).slice(0, 2).join(", ") || "—"}mm</span>
                        </div>
                        <div className="mt-1 text-[11px] text-slate-500">{spec.templateName || "Template pending"}</div>
                    </div>
                )
            },
        },
        {
            id: "qty_progress",
            header: () => <span className="text-[11px] font-semibold text-slate-500">QTY / FULFILLMENT</span>,
            cell: ({ row }) => {
                const qty = row.original.qty_summary || {}
                const summary = row.original.fulfillment_summary || {}
                const progress = progressParts(row.original)
                return (
                    <div className="min-w-[280px]">
                        <div className="flex flex-wrap gap-2 text-[11px] font-semibold text-slate-700">
                            <Pill kind="type">{safeNumber(qty.ordered_kg).toFixed(2)} kg</Pill>
                            <Pill kind="geometry">{qty.ordered_pcs != null ? `${safeNumber(qty.ordered_pcs)} pcs` : "— pcs"}</Pill>
                        </div>
                        <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
                            <div className="flex h-full w-full">
                                <div className="bg-emerald-500" style={{ width: `${progress.dispatchedPct}%` }} />
                                <div className="bg-indigo-500" style={{ width: `${progress.producedOpenPct}%` }} />
                                <div className="bg-slate-200" style={{ width: `${progress.remainingPct}%` }} />
                            </div>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-medium text-slate-500">
                            <span>Produced {safeNumber(summary.produced_kg).toFixed(2)} kg</span>
                            <span>Dispatched {safeNumber(summary.dispatched_kg).toFixed(2)} kg</span>
                            <span>Remaining {safeNumber(summary.remaining_kg).toFixed(2)} kg</span>
                            {summary.produced_pcs != null ? <span>Produced {safeNumber(summary.produced_pcs)} pcs</span> : null}
                            {summary.dispatched_pcs != null ? <span>Dispatched {safeNumber(summary.dispatched_pcs)} pcs</span> : null}
                            {summary.remaining_pcs != null ? <span>Remaining {safeNumber(summary.remaining_pcs)} pcs</span> : null}
                        </div>
                    </div>
                )
            },
        },
        {
            accessorKey: "status",
            header: () => <span className="text-[11px] font-semibold text-slate-500">STATUS</span>,
            cell: ({ row }) => (
                <div className="space-y-2">
                    <StatusPill status={row.original.status} />
                    <div className="text-[11px] font-medium text-slate-500">
                        {safeNumber(row.original.fulfillment_summary?.completion_percent).toFixed(0)}% complete
                    </div>
                </div>
            ),
        },
        {
            id: "actions",
            header: () => <span className="text-[11px] font-semibold text-slate-500">ACTION</span>,
            cell: ({ row }) => (
                <div className="flex items-center justify-end gap-2 pr-2">
                    {canCancelBeforeRelease(row.original) ? (
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-8 rounded-lg border-rose-200 text-rose-700 hover:bg-rose-50"
                            disabled={cancelOrder.isPending}
                            onClick={() => {
                                const reason = window.prompt("Reason for cancelling this sales order before planner release?")
                                if (reason === null) return
                                cancelOrder.mutate({ id: row.original.id, reason })
                            }}
                        >
                            <XCircle className="mr-2 h-3.5 w-3.5" />
                            Cancel
                        </Button>
                    ) : null}
                    <Link href={`/sales/orders/${row.original.id}/tracking`}>
                        <Button variant="outline" size="sm" className="h-8 rounded-lg">
                            <Activity className="mr-2 h-3.5 w-3.5" />
                            Track
                        </Button>
                    </Link>
                </div>
            ),
        },
    ]

    return (
        <div className="min-h-screen space-y-5 bg-[#f4f6fb] p-4 lg:p-6" data-testid="sales-orders-list-page">
            <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-[0_10px_30px_-24px_rgba(15,23,42,0.28)] lg:flex-row lg:items-center lg:justify-between">
                <div>
                    <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-indigo-600">Commercial Queue</div>
                    <h1 className="mt-1 text-xl font-black tracking-tight text-slate-900">Sales Orders</h1>
                    <p className="mt-1 text-sm text-slate-500">
                        Dense queue with product truth pills, KG and PCS progress, and a completed-order audit desk.
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 p-1">
                        <button
                            type="button"
                            onClick={() => setTab("active")}
                            className={cn(
                                "rounded-full px-4 py-1.5 text-[11px] font-black uppercase tracking-[0.12em]",
                                tab === "active" ? "bg-slate-950 text-white" : "text-slate-600"
                            )}
                        >
                            Active Orders {activeOrders.length}
                        </button>
                        <button
                            type="button"
                            onClick={() => setTab("completed")}
                            className={cn(
                                "rounded-full px-4 py-1.5 text-[11px] font-black uppercase tracking-[0.12em]",
                                tab === "completed" ? "bg-emerald-600 text-white" : "text-slate-600"
                            )}
                        >
                            Completed Orders {completedOrders.length}
                        </button>
                    </div>
                    <Link href="/sales/orders/create">
                        <Button className="h-9 rounded-full bg-slate-950 px-5 text-xs font-bold uppercase tracking-[0.14em] text-white hover:bg-slate-800">
                            <Plus className="mr-2 h-4 w-4" />
                            New Order
                        </Button>
                    </Link>
                </div>
            </div>

            {isLoading ? (
                <div className="flex h-[320px] items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white">
                    <div className="text-center">
                        <Loader2 className="mx-auto h-7 w-7 animate-spin text-slate-500" />
                        <div className="mt-3 text-sm font-medium text-slate-500">Loading sales queue…</div>
                    </div>
                </div>
            ) : (
                <Card className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_12px_34px_-28px_rgba(15,23,42,0.3)]">
                    <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                        <div>
                            <div className="text-[11px] font-black uppercase tracking-[0.15em] text-slate-500">
                                {tab === "active" ? "Operational queue" : "Completed order audit"}
                            </div>
                            <div className="mt-1 text-sm text-slate-500">
                                {tab === "active"
                                    ? "Watch technical truth, production progress, and dispatch readiness in one dense row."
                                    : "Track older completed and cancelled orders without leaving the queue desk."}
                            </div>
                        </div>
                        {tab === "completed" ? (
                            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-[11px] font-semibold text-emerald-700">
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                Audit-ready history
                            </div>
                        ) : null}
                    </div>
                    <div className="border-b border-slate-100 bg-slate-50/70 px-4 py-3">
                        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                            <div className="flex flex-1 flex-col gap-3 lg:flex-row lg:items-center">
                                <div className="relative min-w-0 flex-1 lg:max-w-sm">
                                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                    <Input
                                        value={searchText}
                                        onChange={(event) => setSearchText(event.target.value)}
                                        placeholder={tab === "completed" ? "Search completed order, customer, SKU, template..." : "Search order number, customer, SKU..."}
                                        className="h-10 rounded-full border-slate-200 bg-white pl-9 text-sm"
                                    />
                                </div>
                                {tab === "completed" ? (
                                    <div className="flex flex-col gap-3 sm:flex-row">
                                        <Select value={completedStatus} onValueChange={(value) => setCompletedStatus(value as CompletedStatusFilter)}>
                                            <SelectTrigger className="h-10 min-w-[150px] rounded-full border-slate-200 bg-white text-xs font-bold uppercase tracking-[0.12em]">
                                                <SelectValue placeholder="Status" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="ALL">All statuses</SelectItem>
                                                <SelectItem value="COMPLETED">Completed</SelectItem>
                                                <SelectItem value="CANCELLED">Cancelled</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <Select value={completedType} onValueChange={(value) => setCompletedType(value as CompletedTypeFilter)}>
                                            <SelectTrigger className="h-10 min-w-[150px] rounded-full border-slate-200 bg-white text-xs font-bold uppercase tracking-[0.12em]">
                                                <SelectValue placeholder="Type" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="ALL">All products</SelectItem>
                                                <SelectItem value="POUCH">Pouch</SelectItem>
                                                <SelectItem value="ROLL">Roll</SelectItem>
                                            </SelectContent>
                                        </Select>
                                        <Select value={completedWindow} onValueChange={(value) => setCompletedWindow(value as CompletedWindowFilter)}>
                                            <SelectTrigger className="h-10 min-w-[150px] rounded-full border-slate-200 bg-white text-xs font-bold uppercase tracking-[0.12em]">
                                                <SelectValue placeholder="Window" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="30">Last 30 days</SelectItem>
                                                <SelectItem value="90">Last 90 days</SelectItem>
                                                <SelectItem value="180">Last 180 days</SelectItem>
                                                <SelectItem value="ALL">All history</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>
                                ) : null}
                            </div>
                            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                                <Input
                                    value={sizeFilter}
                                    onChange={(event) => setSizeFilter(event.target.value)}
                                    placeholder="Size 180 x 240"
                                    className="h-10 rounded-full border-slate-200 bg-white text-xs font-semibold"
                                />
                                <Input
                                    value={variantFilter}
                                    onChange={(event) => setVariantFilter(event.target.value)}
                                    placeholder="Variant LDPE / PET"
                                    className="h-10 rounded-full border-slate-200 bg-white text-xs font-semibold"
                                />
                                <Input
                                    value={gradeFilter}
                                    onChange={(event) => setGradeFilter(event.target.value)}
                                    placeholder="Grade GP / slip"
                                    className="h-10 rounded-full border-slate-200 bg-white text-xs font-semibold"
                                />
                                <Input
                                    value={thicknessFilter}
                                    onChange={(event) => setThicknessFilter(event.target.value)}
                                    placeholder="Thickness 12 / 50"
                                    className="h-10 rounded-full border-slate-200 bg-white text-xs font-semibold"
                                />
                            </div>
                            <div className="flex flex-wrap items-center gap-2">
                                <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-[11px] font-semibold text-slate-600">
                                    <SlidersHorizontal className="h-3.5 w-3.5 text-slate-400" />
                                    {shownOrders.length} visible row{shownOrders.length === 1 ? "" : "s"}
                                </div>
                                {(tab === "completed" || searchText || sizeFilter || variantFilter || gradeFilter || thicknessFilter) ? (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        className="h-9 rounded-full px-4 text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500 hover:bg-white hover:text-slate-900"
                                        onClick={() => {
                                            setSearchText("")
                                            setCompletedStatus("ALL")
                                            setCompletedType("ALL")
                                            setCompletedWindow("90")
                                            setSizeFilter("")
                                            setVariantFilter("")
                                            setGradeFilter("")
                                            setThicknessFilter("")
                                        }}
                                    >
                                        Reset filters
                                    </Button>
                                ) : null}
                            </div>
                        </div>
                    </div>
                    <div className="overflow-x-auto">
                        <DataTable columns={columns} data={shownOrders} />
                    </div>
                </Card>
            )}
        </div>
    )
}

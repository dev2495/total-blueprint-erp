"use client"

import * as React from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { FileText, Plus, ShoppingCart, Truck, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { procurementService, type POStatus, type PurchaseOrderListItem } from "@/services/procurement"

const STATUS_CHIPS: Array<{ label: string; value: POStatus | "ALL" }> = [
    { label: "All", value: "ALL" },
    { label: "Draft", value: "DRAFT" },
    { label: "Sent", value: "SENT" },
    { label: "Ack", value: "ACK" },
    { label: "Partial", value: "PARTIAL" },
    { label: "Completed", value: "COMPLETED" },
    { label: "Cancelled", value: "CANCELLED" },
]

const STATUS_BADGE: Record<POStatus, string> = {
    DRAFT: "bg-slate-100 text-slate-700 border-slate-300",
    SENT: "bg-amber-50 text-amber-700 border-amber-300",
    ACK: "bg-sky-50 text-sky-700 border-sky-300",
    PARTIAL: "bg-indigo-50 text-indigo-700 border-indigo-300",
    COMPLETED: "bg-emerald-50 text-emerald-700 border-emerald-300",
    CANCELLED: "bg-rose-50 text-rose-700 border-rose-300",
}

function formatINR(value: number): string {
    if (!Number.isFinite(value)) return "0"
    return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(value)
}

export function PurchaseOrderListWorkspace() {
    const [statusFilter, setStatusFilter] = React.useState<POStatus | "ALL">("ALL")
    const [search, setSearch] = React.useState("")

    const { data, isLoading } = useQuery<PurchaseOrderListItem[]>({
        queryKey: ["procurement", "list", statusFilter, search],
        queryFn: () =>
            procurementService.list({
                status: statusFilter === "ALL" ? undefined : statusFilter,
                search: search || undefined,
            }),
    })

    const rows = data ?? []

    const totals = React.useMemo(() => {
        const open = rows.filter((r) => !["COMPLETED", "CANCELLED"].includes(r.status))
        const overdue = open.filter((r) => {
            if (!r.expected_delivery_date) return false
            return new Date(r.expected_delivery_date) < new Date()
        })
        const mtd = rows.filter((r) => {
            const d = new Date(r.order_date)
            const now = new Date()
            return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
        })
        const mtdValue = mtd.reduce((s, r) => s + (r.grand_total || 0), 0)
        return { open: open.length, overdue: overdue.length, mtdValue, total: rows.length }
    }, [rows])

    return (
        <div className="min-h-screen bg-gradient-to-b from-slate-50/80 via-white to-slate-50/40 px-4 py-4 sm:px-6">
            <div className="mx-auto max-w-7xl space-y-6">
                {/* Hero */}
                <div className="rounded-2xl border border-slate-200 bg-gradient-to-r from-brand-navy-500 via-brand-blue-500 to-indigo-700 p-6 text-white shadow-sm">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <div className="flex items-center gap-2 text-white/80 text-xs uppercase tracking-wider">
                                <ShoppingCart className="h-3.5 w-3.5" />
                                <span>Procurement</span>
                            </div>
                            <h1 className="mt-1 text-2xl font-semibold">Purchase Orders</h1>
                            <p className="mt-1 text-sm text-white/80">
                                Vendor purchasing, GRN intake, and stock posting via a single source of truth.
                            </p>
                        </div>
                        <Link href="/procurement/purchase-orders/new">
                            <Button className="bg-white text-brand-navy-500 hover:bg-white/90">
                                <Plus className="mr-2 h-4 w-4" /> New PO
                            </Button>
                        </Link>
                    </div>
                </div>

                {/* KPI tiles */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <KpiCard label="Total POs" value={String(totals.total)} icon={<FileText className="h-4 w-4" />} />
                    <KpiCard label="Open" value={String(totals.open)} accent="text-indigo-700" />
                    <KpiCard label="Overdue" value={String(totals.overdue)} accent="text-rose-700" />
                    <KpiCard label="MTD Spend (INR)" value={formatINR(totals.mtdValue)} accent="text-emerald-700" />
                </div>

                {/* Filters */}
                <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                        {STATUS_CHIPS.map((chip) => (
                            <button
                                key={chip.value}
                                onClick={() => setStatusFilter(chip.value)}
                                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                                    statusFilter === chip.value
                                        ? "bg-brand-navy-500 text-white"
                                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                                }`}
                            >
                                {chip.label}
                            </button>
                        ))}
                    </div>
                    <div className="ml-auto w-full sm:w-64">
                        <Input
                            placeholder="Search PO code…"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            className="h-9"
                        />
                    </div>
                </div>

                {/* Table */}
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                    <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                            <tr>
                                <th className="px-3 py-2 text-left">PO #</th>
                                <th className="px-3 py-2 text-left">Vendor</th>
                                <th className="px-3 py-2 text-left">Plant</th>
                                <th className="px-3 py-2 text-left">Status</th>
                                <th className="px-3 py-2 text-right">Lines</th>
                                <th className="px-3 py-2 text-right">Progress</th>
                                <th className="px-3 py-2 text-right">Grand Total</th>
                                <th className="px-3 py-2 text-left">Expected</th>
                            </tr>
                        </thead>
                        <tbody>
                            {isLoading && (
                                <tr>
                                    <td colSpan={8} className="px-3 py-10 text-center text-slate-500">
                                        <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                                    </td>
                                </tr>
                            )}
                            {!isLoading && rows.length === 0 && (
                                <tr>
                                    <td colSpan={8} className="px-3 py-10 text-center text-slate-500">
                                        <Truck className="mx-auto mb-2 h-6 w-6 text-slate-300" />
                                        No purchase orders yet. Create one from MRP or click &ldquo;New PO&rdquo;.
                                    </td>
                                </tr>
                            )}
                            {rows.map((row) => (
                                <tr key={row.id} className="border-t border-slate-100 hover:bg-slate-50">
                                    <td className="px-3 py-2 font-mono text-xs">
                                        <Link
                                            href={`/procurement/purchase-orders/${row.id}`}
                                            className="font-semibold text-brand-blue-500 hover:underline"
                                        >
                                            {row.code}
                                        </Link>
                                    </td>
                                    <td className="px-3 py-2">{row.vendor_name}</td>
                                    <td className="px-3 py-2 text-slate-600">{row.plant_name}</td>
                                    <td className="px-3 py-2">
                                        <Badge variant="outline" className={STATUS_BADGE[row.status]}>
                                            {row.status}
                                        </Badge>
                                    </td>
                                    <td className="px-3 py-2 text-right tabular-nums">{row.items_count}</td>
                                    <td className="px-3 py-2 text-right tabular-nums">
                                        <div className="flex items-center justify-end gap-2">
                                            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
                                                <div
                                                    className="h-full bg-brand-blue-500"
                                                    style={{ width: `${row.progress_pct ?? 0}%` }}
                                                />
                                            </div>
                                            <span className="text-xs text-slate-600">{row.progress_pct ?? 0}%</span>
                                        </div>
                                    </td>
                                    <td className="px-3 py-2 text-right tabular-nums">{formatINR(row.grand_total)}</td>
                                    <td className="px-3 py-2 text-slate-600">{row.expected_delivery_date || "—"}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    )
}

function KpiCard({
    label,
    value,
    icon,
    accent = "text-slate-900",
}: {
    label: string
    value: string
    icon?: React.ReactNode
    accent?: string
}) {
    return (
        <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-slate-500">
                {icon}
                <span>{label}</span>
            </div>
            <div className={`mt-1 text-2xl font-semibold tabular-nums ${accent}`}>{value}</div>
        </div>
    )
}

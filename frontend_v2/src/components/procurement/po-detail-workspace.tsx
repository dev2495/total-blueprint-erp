"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { ArrowLeft, Ban, FileDown, Loader2, Send, ShieldCheck, Truck } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { procurementService, type POStatus, type PurchaseOrder } from "@/services/procurement"

const STATUS_BADGE: Record<POStatus, string> = {
    DRAFT: "bg-slate-100 text-slate-700 border-slate-300",
    SENT: "bg-amber-50 text-amber-700 border-amber-300",
    ACK: "bg-sky-50 text-sky-700 border-sky-300",
    PARTIAL: "bg-indigo-50 text-indigo-700 border-indigo-300",
    COMPLETED: "bg-emerald-50 text-emerald-700 border-emerald-300",
    CANCELLED: "bg-rose-50 text-rose-700 border-rose-300",
}

function fmtINR(value: number | string | undefined): string {
    const n = typeof value === "string" ? parseFloat(value) : value || 0
    if (!Number.isFinite(n)) return "0"
    return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function PurchaseOrderDetailWorkspace({ poId }: { poId: string }) {
    const router = useRouter()
    const qc = useQueryClient()
    const { data: po, isLoading } = useQuery<PurchaseOrder>({
        queryKey: ["procurement", "po", poId],
        queryFn: () => procurementService.get(poId),
    })
    const [tab, setTab] = React.useState<"lines" | "receipts" | "timeline" | "notes">("lines")

    const sendMutation = useMutation({
        mutationFn: () => procurementService.send(poId),
        onSuccess: () => {
            toast.success("PO sent")
            qc.invalidateQueries({ queryKey: ["procurement"] })
        },
        onError: (e: { response?: { data?: { error?: string } } }) =>
            toast.error(e.response?.data?.error || "Failed to send PO"),
    })

    const cancelMutation = useMutation({
        mutationFn: (reason: string) => procurementService.cancel(poId, reason),
        onSuccess: () => {
            toast.success("PO cancelled")
            qc.invalidateQueries({ queryKey: ["procurement"] })
        },
        onError: (e: { response?: { data?: { error?: string } } }) =>
            toast.error(e.response?.data?.error || "Failed to cancel"),
    })

    const closeShortMutation = useMutation({
        mutationFn: (reason: string) => procurementService.closeShort(poId, null, reason),
        onSuccess: () => {
            toast.success("PO closed short")
            qc.invalidateQueries({ queryKey: ["procurement"] })
        },
        onError: (e: { response?: { data?: { error?: string } } }) =>
            toast.error(e.response?.data?.error || "Failed to close short"),
    })

    if (isLoading || !po) {
        return (
            <div className="flex h-[60vh] items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-gradient-to-b from-slate-50/80 via-white to-slate-50/40 px-4 py-4 sm:px-6">
            <div className="mx-auto max-w-7xl space-y-5">
                <Link
                    href="/procurement/purchase-orders"
                    className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-brand-blue-500"
                >
                    <ArrowLeft className="h-3 w-3" /> All Purchase Orders
                </Link>

                {/* Hero */}
                <div className="rounded-2xl border border-slate-200 bg-gradient-to-r from-brand-navy-500 to-brand-blue-500 p-5 text-white">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                            <div className="text-xs uppercase tracking-wider text-white/70">Purchase Order</div>
                            <h1 className="text-2xl font-semibold">{po.code}</h1>
                            <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-white/85">
                                <span>{po.vendor_name}</span>
                                <span>·</span>
                                <span>{po.plant_name}</span>
                                <span>·</span>
                                <span>Order {po.order_date}</span>
                                {po.expected_delivery_date && (
                                    <>
                                        <span>·</span>
                                        <span>Expected {po.expected_delivery_date}</span>
                                    </>
                                )}
                            </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline" className={`${STATUS_BADGE[po.status]} text-xs`}>
                                {po.status}
                            </Badge>
                            <a href={procurementService.pdfUrl(poId)} target="_blank" rel="noopener noreferrer">
                                <Button variant="secondary" size="sm" className="bg-white/15 text-white hover:bg-white/25">
                                    <FileDown className="mr-1 h-3.5 w-3.5" /> PDF
                                </Button>
                            </a>
                            {po.status === "DRAFT" && (
                                <Button
                                    size="sm"
                                    className="bg-white text-brand-navy-500 hover:bg-white/90"
                                    onClick={() => sendMutation.mutate()}
                                    disabled={sendMutation.isPending}
                                >
                                    <Send className="mr-1 h-3.5 w-3.5" /> Send
                                </Button>
                            )}
                            {(po.status === "SENT" || po.status === "ACK" || po.status === "PARTIAL") && (
                                <Button
                                    size="sm"
                                    className="bg-emerald-500 text-white hover:bg-emerald-600"
                                    onClick={() => router.push(`/procurement/purchase-orders/${po.id}/receive`)}
                                >
                                    <Truck className="mr-1 h-3.5 w-3.5" /> Receive
                                </Button>
                            )}
                            {(po.status === "SENT" || po.status === "ACK" || po.status === "PARTIAL") && (
                                <Button
                                    size="sm"
                                    variant="secondary"
                                    className="bg-white/15 text-white hover:bg-white/25"
                                    onClick={() => {
                                        const r = window.prompt("Reason for closing short?", "Vendor short delivery")
                                        if (r) closeShortMutation.mutate(r)
                                    }}
                                >
                                    <ShieldCheck className="mr-1 h-3.5 w-3.5" /> Close Short
                                </Button>
                            )}
                            {po.status !== "COMPLETED" && po.status !== "CANCELLED" && (
                                <Button
                                    size="sm"
                                    variant="secondary"
                                    className="bg-rose-500/80 text-white hover:bg-rose-500"
                                    onClick={() => {
                                        const r = window.prompt("Reason for cancellation?")
                                        if (r) cancelMutation.mutate(r)
                                    }}
                                >
                                    <Ban className="mr-1 h-3.5 w-3.5" /> Cancel
                                </Button>
                            )}
                        </div>
                    </div>
                </div>

                {/* Tabs */}
                <div className="flex gap-1 border-b border-slate-200">
                    {(["lines", "receipts", "timeline", "notes"] as const).map((t) => (
                        <button
                            key={t}
                            onClick={() => setTab(t)}
                            className={`px-3 py-2 text-sm font-medium transition ${
                                tab === t
                                    ? "border-b-2 border-brand-blue-500 text-brand-blue-500"
                                    : "text-slate-500 hover:text-slate-700"
                            }`}
                        >
                            {t === "lines" && `Lines (${po.items.length})`}
                            {t === "receipts" && `Receipts (${po.receipts?.length ?? 0})`}
                            {t === "timeline" && `Timeline (${po.status_history?.length ?? 0})`}
                            {t === "notes" && "Notes"}
                        </button>
                    ))}
                </div>

                {tab === "lines" && (
                    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                        <table className="w-full text-sm">
                            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                                <tr>
                                    <th className="w-12 px-3 py-2 text-left">#</th>
                                    <th className="px-3 py-2 text-left">Material</th>
                                    <th className="px-3 py-2 text-right">Ordered</th>
                                    <th className="px-3 py-2 text-right">Received</th>
                                    <th className="px-3 py-2 text-right">Open</th>
                                    <th className="px-3 py-2 text-right">Rate</th>
                                    <th className="px-3 py-2 text-right">Total</th>
                                    <th className="px-3 py-2 text-right">Progress</th>
                                </tr>
                            </thead>
                            <tbody>
                                {po.items.map((it) => (
                                    <tr key={it.id} className="border-t border-slate-100">
                                        <td className="px-3 py-2 text-slate-500">{it.line_no}</td>
                                        <td className="px-3 py-2">
                                            <div className="font-medium">{it.material_code}</div>
                                            <div className="text-xs text-slate-500">{it.material_name}</div>
                                            {it.is_closed && (
                                                <div className="mt-1 text-[10px] uppercase text-rose-600">
                                                    Closed Short: {it.close_reason}
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-3 py-2 text-right tabular-nums">
                                            {Number(it.qty_ordered).toFixed(3)} {it.uom}
                                        </td>
                                        <td className="px-3 py-2 text-right tabular-nums">
                                            {Number(it.qty_received ?? 0).toFixed(3)}
                                        </td>
                                        <td className="px-3 py-2 text-right tabular-nums">
                                            {Number(it.qty_open ?? 0).toFixed(3)}
                                        </td>
                                        <td className="px-3 py-2 text-right tabular-nums">{fmtINR(it.rate_per_uom)}</td>
                                        <td className="px-3 py-2 text-right tabular-nums font-medium">
                                            {fmtINR(it.line_total)}
                                        </td>
                                        <td className="px-3 py-2 text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                <div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100">
                                                    <div
                                                        className="h-full bg-brand-blue-500"
                                                        style={{ width: `${it.progress_pct ?? 0}%` }}
                                                    />
                                                </div>
                                                <span className="text-xs text-slate-600 tabular-nums">
                                                    {it.progress_pct ?? 0}%
                                                </span>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot className="bg-slate-50 text-sm font-medium">
                                <tr>
                                    <td colSpan={6} className="px-3 py-2 text-right text-slate-500">
                                        Subtotal
                                    </td>
                                    <td className="px-3 py-2 text-right tabular-nums">{fmtINR(po.subtotal)}</td>
                                    <td />
                                </tr>
                                <tr>
                                    <td colSpan={6} className="px-3 py-2 text-right text-slate-500">
                                        GST
                                    </td>
                                    <td className="px-3 py-2 text-right tabular-nums">{fmtINR(po.gst_total)}</td>
                                    <td />
                                </tr>
                                <tr className="text-brand-navy-500">
                                    <td colSpan={6} className="px-3 py-2 text-right">
                                        Grand Total
                                    </td>
                                    <td className="px-3 py-2 text-right tabular-nums">INR {fmtINR(po.grand_total)}</td>
                                    <td />
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                )}

                {tab === "receipts" && (
                    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                        {(po.receipts ?? []).length === 0 ? (
                            <div className="p-8 text-center text-sm text-slate-500">
                                No receipts yet. Click &ldquo;Receive&rdquo; to record a GRN against this PO.
                            </div>
                        ) : (
                            <table className="w-full text-sm">
                                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                                    <tr>
                                        <th className="px-3 py-2 text-left">GRN #</th>
                                        <th className="px-3 py-2 text-left">Received</th>
                                        <th className="px-3 py-2 text-left">Invoice</th>
                                        <th className="px-3 py-2 text-left">Vehicle</th>
                                        <th className="px-3 py-2 text-right">Lines</th>
                                        <th className="px-3 py-2 text-left">Quality</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(po.receipts ?? []).map((r) => (
                                        <tr key={r.id} className="border-t border-slate-100">
                                            <td className="px-3 py-2 font-mono text-xs">{r.code}</td>
                                            <td className="px-3 py-2 text-slate-600">
                                                {new Date(r.received_at).toLocaleString()}
                                            </td>
                                            <td className="px-3 py-2">{r.vendor_invoice_no || "—"}</td>
                                            <td className="px-3 py-2">{r.vehicle_no || "—"}</td>
                                            <td className="px-3 py-2 text-right tabular-nums">{r.lines.length}</td>
                                            <td className="px-3 py-2">
                                                <Badge variant="outline" className="text-xs">
                                                    {r.quality_status}
                                                </Badge>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                )}

                {tab === "timeline" && (
                    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                        {(po.status_history ?? []).length === 0 ? (
                            <p className="text-sm text-slate-500">No status history yet.</p>
                        ) : (
                            <ol className="space-y-3">
                                {(po.status_history ?? []).map((entry, idx) => {
                                    const e = entry as { status?: string; at?: string; by_name?: string; note?: string }
                                    return (
                                        <li key={idx} className="flex gap-3">
                                            <div className="mt-1 h-2 w-2 flex-shrink-0 rounded-full bg-brand-blue-500" />
                                            <div className="flex-1">
                                                <div className="flex items-center justify-between text-sm">
                                                    <span className="font-medium">{e.status}</span>
                                                    <span className="text-xs text-slate-500">
                                                        {e.at ? new Date(e.at).toLocaleString() : ""}
                                                    </span>
                                                </div>
                                                {e.by_name && (
                                                    <div className="text-xs text-slate-500">by {e.by_name}</div>
                                                )}
                                                {e.note && <div className="text-xs text-slate-600">{e.note}</div>}
                                            </div>
                                        </li>
                                    )
                                })}
                            </ol>
                        )}
                    </div>
                )}

                {tab === "notes" && (
                    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                        <p className="whitespace-pre-wrap text-sm text-slate-700">
                            {po.notes || "(no notes)"}
                        </p>
                    </div>
                )}
            </div>
        </div>
    )
}

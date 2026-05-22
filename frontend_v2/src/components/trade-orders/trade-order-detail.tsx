"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeft, CheckCircle2, Loader2, Pencil, Truck, XCircle, ShoppingBag, Package } from "lucide-react"

import { GradientHero } from "@/components/erp-v3/gradient-hero"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { cn } from "@/lib/utils"
import { useToast } from "@/hooks/use-toast"
import { tradeOrderService, type TradeOrder, type TradeOrderStatus } from "@/services/trade-orders"

const STATUS_TONE: Record<TradeOrderStatus, string> = {
    DRAFT: "border-slate-200 bg-slate-50 text-slate-700",
    CONFIRMED: "border-amber-200 bg-amber-50 text-amber-700",
    DISPATCHED: "border-emerald-200 bg-emerald-50 text-emerald-700",
    INVOICED: "border-indigo-200 bg-indigo-50 text-indigo-700",
    CANCELLED: "border-rose-200 bg-rose-50 text-rose-700",
}

export function TradeOrderDetail({ id }: { id: string }) {
    const router = useRouter()
    const { toast } = useToast()
    const qc = useQueryClient()

    const { data: order, isLoading } = useQuery({
        queryKey: ["trade-order", id],
        queryFn: () => tradeOrderService.get(id),
        enabled: !!id,
    })

    const invalidate = (saved: TradeOrder) => {
        qc.invalidateQueries({ queryKey: ["trade-orders"] })
        qc.invalidateQueries({ queryKey: ["trade-order", saved.id] })
    }

    const confirmMut = useMutation({
        mutationFn: () => tradeOrderService.confirm(id),
        onSuccess: (o) => { invalidate(o); toast({ title: "Order confirmed", description: o.code }) },
        onError: (err: any) => toast({ title: "Confirm failed", description: msg(err), variant: "destructive" }),
    })
    const dispatchMut = useMutation({
        mutationFn: () => tradeOrderService.dispatch(id),
        onSuccess: (o) => { invalidate(o); toast({ title: "Dispatched", description: `${o.code} · stock decremented` }) },
        onError: (err: any) => toast({ title: "Dispatch failed", description: msg(err), variant: "destructive" }),
    })
    const cancelMut = useMutation({
        mutationFn: () => tradeOrderService.cancel(id),
        onSuccess: (o) => { invalidate(o); toast({ title: "Cancelled", description: o.code }) },
        onError: (err: any) => toast({ title: "Cancel failed", description: msg(err), variant: "destructive" }),
    })

    if (isLoading || !order) {
        return (
            <div className="grid min-h-screen place-items-center text-sm text-slate-500">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading trade order…
            </div>
        )
    }

    const canEdit = order.status === "DRAFT"
    const canConfirm = order.status === "DRAFT"
    const canDispatch = order.status === "CONFIRMED"
    const canCancel = order.status === "DRAFT" || order.status === "CONFIRMED"

    return (
        <div className="min-h-screen bg-gradient-to-b from-rose-50/40 via-white to-slate-50/40 px-4 py-4 sm:px-6">
            <GradientHero
                palette="rose"
                eyebrow={`TRADE ORDER · ${order.code}`}
                title={order.customer_name || "—"}
                subtitle={`${order.order_date} · ${order.plant_name || "no plant"} · ${order.items.length} ${order.items.length === 1 ? "line" : "lines"}`}
                chips={[
                    { label: "Status", value: order.status.toLowerCase(), tone: order.status === "DISPATCHED" ? "ok" : order.status === "CANCELLED" ? "error" : "warn" },
                    { label: "Grand ₹", value: Number(order.grand_total || 0).toLocaleString(undefined, { maximumFractionDigits: 2 }), tone: "info" },
                ]}
                actions={
                    <Link href="/sales/trade-orders">
                        <Button variant="secondary" className="bg-white/95 text-rose-700 hover:bg-white">
                            <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to orders
                        </Button>
                    </Link>
                }
            />

            <div className="mt-6 grid gap-6 lg:grid-cols-3">
                <section className="rounded-3xl bg-white p-6 shadow-[0_20px_60px_-30px_rgba(15,23,42,0.25)] ring-1 ring-slate-200/60 lg:col-span-2">
                    <header className="mb-4 flex items-center justify-between">
                        <div>
                            <h3 className="text-sm font-bold text-slate-900">Line items</h3>
                            <p className="text-[11px] text-slate-500">Resold items in this order</p>
                        </div>
                        {canEdit ? (
                            <Link href={`/sales/trade-orders/${order.id}/edit`}>
                                <Button variant="outline" size="sm">
                                    <Pencil className="mr-1.5 h-3 w-3" /> Edit
                                </Button>
                            </Link>
                        ) : null}
                    </header>
                    <div className="overflow-hidden rounded-2xl ring-1 ring-slate-200">
                        <table className="w-full text-[12px]">
                            <thead className="bg-slate-50 text-left text-[10px] font-black uppercase tracking-wider text-slate-600">
                                <tr>
                                    <th className="px-3 py-2">#</th>
                                    <th className="px-3 py-2">Item</th>
                                    <th className="px-3 py-2 text-right">Qty</th>
                                    <th className="px-3 py-2">UOM</th>
                                    <th className="px-3 py-2 text-right">Rate</th>
                                    <th className="px-3 py-2 text-right">GST %</th>
                                    <th className="px-3 py-2 text-right">Total</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {order.items.map((it) => (
                                    <tr key={it.id || it.line_no}>
                                        <td className="px-3 py-2 font-mono text-slate-500">{it.line_no}</td>
                                        <td className="px-3 py-2">
                                            <span className="inline-flex items-center gap-1.5">
                                                {it.item_type === "TRADING_GOOD" ? (
                                                    <ShoppingBag className="h-3 w-3 text-emerald-600" />
                                                ) : (
                                                    <Package className="h-3 w-3 text-violet-600" />
                                                )}
                                                <span className="font-bold text-slate-900">{it.display_name}</span>
                                            </span>
                                            {it.description ? <div className="text-[10px] text-slate-400">{it.description}</div> : null}
                                        </td>
                                        <td className="px-3 py-2 text-right font-mono">{Number(it.qty).toLocaleString()}</td>
                                        <td className="px-3 py-2 font-mono uppercase">{it.uom}</td>
                                        <td className="px-3 py-2 text-right font-mono">₹ {Number(it.rate).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                                        <td className="px-3 py-2 text-right font-mono">{Number(it.gst_pct)}</td>
                                        <td className="px-3 py-2 text-right font-mono font-bold">₹ {Number(it.line_total || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>

                <section className="space-y-4">
                    <div className="rounded-3xl bg-gradient-to-br from-rose-500 via-orange-500 to-amber-500 p-6 text-white shadow-[0_20px_60px_-30px_rgba(244,63,94,0.45)]">
                        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-white/80">Totals</div>
                        <dl className="mt-3 space-y-2">
                            <Row label="Subtotal" value={`₹ ${Number(order.subtotal || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`} />
                            <Row label="GST" value={`₹ ${Number(order.gst_total || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`} />
                            <div className="my-2 h-px bg-white/30" />
                            <Row label="Grand total" value={`₹ ${Number(order.grand_total || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`} big />
                        </dl>
                    </div>

                    <div className="rounded-3xl bg-white p-6 shadow-[0_20px_60px_-30px_rgba(15,23,42,0.25)] ring-1 ring-slate-200/60">
                        <h3 className="text-sm font-bold text-slate-900">Actions</h3>
                        <p className="text-[11px] text-slate-500">Workflow controls</p>
                        <div className="mt-4 flex flex-col gap-2">
                            {canConfirm ? (
                                <Button
                                    onClick={() => confirmMut.mutate()}
                                    disabled={confirmMut.isPending}
                                    className="bg-amber-500 text-white hover:bg-amber-600"
                                >
                                    {confirmMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                                    Confirm order
                                </Button>
                            ) : null}
                            {canDispatch ? (
                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button disabled={dispatchMut.isPending} className="bg-emerald-600 text-white hover:bg-emerald-700">
                                            {dispatchMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Truck className="mr-2 h-4 w-4" />}
                                            Dispatch
                                        </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>Dispatch this order?</AlertDialogTitle>
                                            <AlertDialogDescription>
                                                This will consume stock at the order&apos;s plant and cannot be undone. Make sure the lines and quantities are correct.
                                            </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                                            <AlertDialogAction
                                                onClick={() => dispatchMut.mutate()}
                                                className="bg-emerald-600 text-white hover:bg-emerald-700"
                                            >
                                                Yes, dispatch
                                            </AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                            ) : null}
                            {canCancel ? (
                                <Button
                                    variant="outline"
                                    onClick={() => cancelMut.mutate()}
                                    disabled={cancelMut.isPending}
                                    className="border-rose-300 text-rose-700 hover:bg-rose-50"
                                >
                                    {cancelMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <XCircle className="mr-2 h-4 w-4" />}
                                    Cancel order
                                </Button>
                            ) : null}
                        </div>
                    </div>

                    {order.notes ? (
                        <div className="rounded-3xl bg-white p-6 shadow-[0_20px_60px_-30px_rgba(15,23,42,0.25)] ring-1 ring-slate-200/60">
                            <h3 className="text-sm font-bold text-slate-900">Notes</h3>
                            <p className="mt-2 whitespace-pre-wrap text-[12px] text-slate-600">{order.notes}</p>
                        </div>
                    ) : null}
                </section>
            </div>
        </div>
    )
}

function Row({ label, value, big }: { label: string; value: string; big?: boolean }) {
    return (
        <div className="flex items-baseline justify-between">
            <dt className="text-[11px] uppercase tracking-wider text-white/80">{label}</dt>
            <dd className={big ? "font-mono text-xl font-black" : "font-mono text-sm font-bold"}>{value}</dd>
        </div>
    )
}

function msg(err: any): string {
    return (
        err?.response?.data?.detail ||
        (Array.isArray(err?.response?.data) ? err.response.data.join(", ") : null) ||
        JSON.stringify(err?.response?.data || err?.message || "Error")
    )
}

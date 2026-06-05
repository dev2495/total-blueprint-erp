"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeft, CheckCircle2, Ban, Loader2, SlidersHorizontal } from "lucide-react"

import { GradientHero } from "@/components/erp/gradient-hero"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { stockAdjustmentService, type StockAdjustmentStatus } from "@/services/stock-adjustment"

export function StockAdjustmentDetail({ id }: { id: string }) {
    const router = useRouter()
    const qc = useQueryClient()
    const { toast } = useToast()

    const { data: adj, isLoading } = useQuery({
        queryKey: ["stock-adjustment", id],
        queryFn: () => stockAdjustmentService.get(id),
    })

    const [confirmPostOpen, setConfirmPostOpen] = React.useState(false)
    const [confirmVoidOpen, setConfirmVoidOpen] = React.useState(false)

    const postMut = useMutation({
        mutationFn: () => stockAdjustmentService.post(id),
        onSuccess: () => {
            toast({ title: "Adjustment posted" })
            qc.invalidateQueries({ queryKey: ["stock-adjustment", id] })
            qc.invalidateQueries({ queryKey: ["stock-adjustments"] })
            setConfirmPostOpen(false)
        },
        onError: (err: any) => {
            const msg = err?.response?.data?.detail || err?.message || "Post failed"
            toast({ title: "Post failed", description: String(msg), variant: "destructive" })
        },
    })

    const voidMut = useMutation({
        mutationFn: () => stockAdjustmentService.void(id),
        onSuccess: () => {
            toast({ title: "Adjustment voided" })
            qc.invalidateQueries({ queryKey: ["stock-adjustment", id] })
            qc.invalidateQueries({ queryKey: ["stock-adjustments"] })
            setConfirmVoidOpen(false)
        },
        onError: (err: any) => {
            const msg = err?.response?.data?.detail || err?.message || "Void failed"
            toast({ title: "Void failed", description: String(msg), variant: "destructive" })
        },
    })

    if (isLoading || !adj) {
        return (
            <div className="grid min-h-screen place-items-center text-sm text-slate-500">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading…
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-gradient-to-b from-violet-50/40 via-white to-slate-50/40 px-4 py-4 sm:px-6">
            <GradientHero
                palette="violet"
                eyebrow={`INVENTORY · ADJUSTMENT · ${adj.code}`}
                title={`${adj.plant_name || "Adjustment"} · ${adj.reason.replace(/_/g, " ").toLowerCase()}`}
                subtitle={`Created ${adj.created_at ? new Date(adj.created_at).toLocaleString() : "—"}${adj.created_by_name ? ` by ${adj.created_by_name}` : ""}.${adj.posted_at ? ` Posted ${new Date(adj.posted_at).toLocaleString()}.` : ""}`}
                actions={
                    <Link href="/inventory/adjustments">
                        <Button variant="secondary" className="bg-white/95 text-violet-700 hover:bg-surface-1">
                            <ArrowLeft className="mr-1.5 h-4 w-4" /> Back
                        </Button>
                    </Link>
                }
            />

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <StatusBadge status={adj.status} />
                    {adj.notes ? (
                        <span className="text-[12px] text-content-3">— {adj.notes}</span>
                    ) : null}
                </div>
                <div className="flex items-center gap-2">
                    {adj.status === "DRAFT" ? (
                        <Button
                            className="bg-violet-600 text-white hover:bg-violet-700"
                            onClick={() => setConfirmPostOpen(true)}
                        >
                            <CheckCircle2 className="mr-1.5 h-4 w-4" /> Post
                        </Button>
                    ) : null}
                    {adj.status !== "VOID" ? (
                        <Button
                            variant="outline"
                            className="border-red-200 text-red-600 hover:bg-red-50"
                            onClick={() => setConfirmVoidOpen(true)}
                        >
                            <Ban className="mr-1.5 h-4 w-4" /> Void
                        </Button>
                    ) : null}
                </div>
            </div>

            <section className="mt-4 overflow-hidden rounded-3xl bg-surface-1 shadow-[0_20px_60px_-30px_rgba(15,23,42,0.25)] ring-1 ring-slate-200/60">
                <header className="border-b border-slate-200 p-5">
                    <h3 className="font-display text-base font-bold text-slate-900">Lines</h3>
                    <p className="text-[11px] text-slate-500">
                        {adj.lines.length} line{adj.lines.length === 1 ? "" : "s"} — read-only.
                    </p>
                </header>
                {adj.lines.length === 0 ? (
                    <div className="p-8 text-center text-sm text-slate-500">No lines.</div>
                ) : (
                    <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-content-3">
                            <tr>
                                <th className="px-4 py-2 text-left font-bold">#</th>
                                <th className="px-4 py-2 text-left font-bold">Class</th>
                                <th className="px-4 py-2 text-left font-bold">Item</th>
                                <th className="px-4 py-2 text-left font-bold">Location</th>
                                <th className="px-4 py-2 text-right font-bold">Before</th>
                                <th className="px-4 py-2 text-right font-bold">Δ</th>
                                <th className="px-4 py-2 text-right font-bold">After</th>
                                <th className="px-4 py-2 text-right font-bold">Value ₹</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {adj.lines.map((line) => {
                                const delta = Number(line.delta_qty || 0)
                                const dColor =
                                    delta > 0 ? "text-success-fg" : delta < 0 ? "text-red-600" : "text-slate-500"
                                const itemLabel =
                                    line.stock_class === "TRADING_GOOD"
                                        ? `${line.trading_good_code || "—"} · ${line.trading_good_name || ""}`
                                        : line.stock_class === "ROLL"
                                            ? line.inventory_roll_label || line.inventory_roll || "—"
                                            : `${line.inventory_material_code || "—"} · ${line.inventory_material_name || ""}`
                                return (
                                    <tr key={line.id}>
                                        <td className="px-4 py-3 font-mono text-[11px] text-slate-500">{line.line_no}</td>
                                        <td className="px-4 py-3">
                                            <Badge variant="outline" className="border-slate-200 bg-slate-50 text-[10px] text-slate-700">
                                                {line.stock_class}
                                            </Badge>
                                        </td>
                                        <td className="px-4 py-3 text-[12px] text-content-2">{itemLabel}</td>
                                        <td className="px-4 py-3 text-[11px] text-slate-500">{line.location_name || "—"}</td>
                                        <td className="px-4 py-3 text-right font-mono text-slate-700">
                                            {Number(line.before_qty || 0).toLocaleString()}
                                        </td>
                                        <td className={`px-4 py-3 text-right font-mono font-bold ${dColor}`}>
                                            {delta > 0 ? "+" : ""}{delta.toLocaleString()}
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono text-slate-900">
                                            {Number(line.after_qty || 0).toLocaleString()}
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono text-slate-700">
                                            {Number(line.value_inr || 0).toLocaleString()}
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                )}
            </section>

            <Dialog open={confirmPostOpen} onOpenChange={setConfirmPostOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="font-display">Post adjustment?</DialogTitle>
                        <DialogDescription>
                            Posting applies every line to its stock pool. This is permanent — the only way to reverse it is to void the adjustment, which posts an inverse correction.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setConfirmPostOpen(false)}>
                            Cancel
                        </Button>
                        <Button
                            className="bg-violet-600 text-white hover:bg-violet-700"
                            disabled={postMut.isPending}
                            onClick={() => postMut.mutate()}
                        >
                            {postMut.isPending ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                                <SlidersHorizontal className="mr-2 h-4 w-4" />
                            )}
                            Post adjustment
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={confirmVoidOpen} onOpenChange={setConfirmVoidOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="font-display">Void adjustment?</DialogTitle>
                        <DialogDescription>
                            {adj.status === "POSTED"
                                ? "This will apply inverse deltas to restore stock, then mark the adjustment as voided."
                                : "This draft will be marked as voided and cannot be posted."}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setConfirmVoidOpen(false)}>
                            Cancel
                        </Button>
                        <Button
                            className="bg-red-600 text-white hover:bg-red-700"
                            disabled={voidMut.isPending}
                            onClick={() => voidMut.mutate()}
                        >
                            {voidMut.isPending ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                                <Ban className="mr-2 h-4 w-4" />
                            )}
                            Void adjustment
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}

function StatusBadge({ status }: { status: StockAdjustmentStatus }) {
    if (status === "POSTED")
        return (
            <Badge variant="outline" className="border-success-border bg-success-bg text-[11px] text-success-fg">
                posted
            </Badge>
        )
    if (status === "VOID")
        return (
            <Badge variant="outline" className="border-slate-200 bg-slate-50 text-[11px] text-slate-500">
                voided
            </Badge>
        )
    return (
        <Badge variant="outline" className="border-warning-border bg-warning-bg text-[11px] text-warning-fg">
            draft
        </Badge>
    )
}

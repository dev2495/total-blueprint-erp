"use client"

import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, CheckCircle2, Loader2, Lock, ShieldCheck, Wallet } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import {
    stockLifecycleService,
    type MasterCatalog,
} from "@/services/stock-lifecycle"

interface CloseTabProps {
    plantId: string
    catalog: MasterCatalog
}

interface ClosingPreviewRow {
    stock_class: string
    material: string
    material_code?: string
    material_name?: string
    qty: number
    rate?: number | null
    location_name?: string
}

interface ClosingPreview {
    financial_year?: string
    plant?: { id: string; name: string; code: string } | null
    rows?: ClosingPreviewRow[]
    totals?: Record<string, number>
    movements?: Record<string, number>
    blockers?: Array<string | Record<string, unknown>>
}

const STOCK_CLASSES = ["BULK", "ROLL", "PACKAGING"] as const

function defaultFinancialYear(): string {
    const now = new Date()
    const y = now.getFullYear()
    const m = now.getMonth() + 1
    if (m >= 4) return `${y}-${y + 1}`
    return `${y - 1}-${y}`
}

export function CloseTab({ plantId, catalog }: CloseTabProps) {
    const qc = useQueryClient()
    const { toast } = useToast()
    const [fy, setFy] = React.useState<string>(defaultFinancialYear())
    const [confirmOpen, setConfirmOpen] = React.useState(false)

    const { data: periods = [] } = useQuery({
        queryKey: ["stock-lifecycle", "periods"],
        queryFn: stockLifecycleService.getPeriods,
    })

    const { data: preview, isLoading } = useQuery<ClosingPreview>({
        queryKey: ["stock-lifecycle", "closing-preview", plantId, fy],
        queryFn: () => stockLifecycleService.getClosingPreview(plantId, fy),
        enabled: !!plantId,
    })

    const period = React.useMemo(
        () => periods.find((row) => row.financial_year === fy) || null,
        [periods, fy],
    )

    const startPeriodMutation = useMutation({
        mutationFn: () => stockLifecycleService.startPeriod(fy),
        onSuccess: (saved) => {
            toast({
                title: "Financial year opened",
                description: `${saved.financial_year} is ready for stock lifecycle work.`,
            })
            qc.invalidateQueries({ queryKey: ["stock-lifecycle", "periods"] })
            qc.invalidateQueries({ queryKey: ["stock-lifecycle", "closing-preview"] })
        },
        onError: (err: any) => {
            toast({
                title: "Failed to open financial year",
                description: err?.response?.data?.detail || err?.message || "Please try again.",
                variant: "destructive" as any,
            })
        },
    })

    const closeMutation = useMutation({
        mutationFn: async () => {
            if (!period?.id) throw new Error("Open this financial year before closing it.")
            return stockLifecycleService.closePeriod(period.id, plantId)
        },
        onSuccess: (saved) => {
            toast({
                title: "Financial year closed",
                description: `${saved.financial_year} locked. Next opening batch was generated.`,
            })
            setConfirmOpen(false)
            qc.invalidateQueries({ queryKey: ["stock-lifecycle", "periods"] })
            qc.invalidateQueries({ queryKey: ["stock-lifecycle", "closing-preview"] })
            qc.invalidateQueries({ queryKey: ["stock-lifecycle", "catalog"] })
        },
        onError: (err: any) => {
            const data = err?.response?.data
            const blocker = Array.isArray(data?.blockers) && data.blockers[0]
                ? data.blockers[0]?.label || data.blockers[0]?.code
                : null
            toast({
                title: "Close blocked",
                description: blocker || data?.detail || err?.message || "Clear blockers and try again.",
                variant: "destructive" as any,
            })
        },
    })

    const movements = preview?.movements || {}
    const totals = preview?.totals || {}
    const rows = preview?.rows || []
    const blockers = preview?.blockers || []

    // Aggregate rows by stock_class for the formula table
    const byClass = React.useMemo(() => {
        const map: Record<string, { qty: number; value: number; count: number }> = {}
        for (const row of rows) {
            const key = row.stock_class || "BULK"
            const qty = Number(row.qty || 0)
            const rate = Number(row.rate || 0)
            map[key] = map[key] || { qty: 0, value: 0, count: 0 }
            map[key].qty += qty
            map[key].value += qty * rate
            map[key].count += 1
        }
        return map
    }, [rows])

    const totalValue = Number(totals.value || 0)

    // Closing = Opening + Ins - Outs + Adjustments. The audit service exposes per-class movement keys.
    const buildClassRow = (cls: string) => {
        const lower = cls.toLowerCase()
        const opening = Number(movements[`${lower}_opening_kg`] || movements[`${lower}_opening`] || 0)
        // Try to find ins/outs in movements. Different stock types use different suffixes.
        const ins = Object.entries(movements)
            .filter(([k]) => k.startsWith(`${lower}_`) && /_(in|grn|receipt|adjust_in)/.test(k))
            .reduce((s, [, v]) => s + Number(v || 0), 0)
        const outs = Object.entries(movements)
            .filter(([k]) => k.startsWith(`${lower}_`) && /_(out|issue|consumption|consume|adjust_out|scrap)/.test(k))
            .reduce((s, [, v]) => s + Number(v || 0), 0)
        const adjustments = Object.entries(movements)
            .filter(([k]) => k.startsWith(`${lower}_`) && /adjust/.test(k))
            .reduce((s, [, v]) => s + Number(v || 0), 0)
        const closing = byClass[cls]?.qty || 0
        const value = byClass[cls]?.value || 0
        return { opening, ins, outs, adjustments, closing, value }
    }

    return (
        <div data-testid="close-stock-tab" className="flex flex-col gap-5">
            {/* Top KPI */}
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
                <div className="rounded-3xl bg-gradient-to-br from-violet-600 via-fuchsia-600 to-rose-500 p-6 text-white shadow-[0_30px_60px_-30px_rgba(168,85,247,0.55)]">
                    <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-white/85">
                        <ShieldCheck className="h-4 w-4" />
                        Closing snapshot
                    </div>
                    <div className="mt-1 grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                        <div>
                            <div className="font-display text-2xl font-semibold">
                                {preview?.plant?.name || catalog.plant?.name || "—"}
                            </div>
                            <div className="text-sm text-white/80">
                                Financial Year{" "}
                                <span className="font-semibold text-white">{preview?.financial_year || fy}</span>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 rounded-2xl bg-white/15 px-3 py-2 ring-1 ring-white/20">
                            <Wallet className="h-4 w-4" />
                            <div>
                                <div className="text-[11px] uppercase tracking-wide text-white/80">Total value</div>
                                <div className="font-display text-xl font-semibold">
                                    ₹ {totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-3">
                        <label className="inline-flex items-center gap-2 text-xs text-white/80">
                            FY override
                            <Input
                                data-testid="close-fy-input"
                                value={fy}
                                onChange={(e) => setFy(e.target.value)}
                                placeholder="2025-26"
                                className="h-8 w-[110px] bg-white/20 text-white placeholder:text-white/60"
                            />
                        </label>
                        <div className="inline-flex items-center gap-2 rounded-2xl bg-white/15 px-3 py-2 text-xs ring-1 ring-white/20">
                            <span className="text-white/75">Status</span>
                            <span className="font-semibold text-white">{period?.status || "Not started"}</span>
                        </div>
                        {!period ? (
                            <Button
                                type="button"
                                data-testid="close-open-fy"
                                size="sm"
                                onClick={() => startPeriodMutation.mutate()}
                                disabled={startPeriodMutation.isPending}
                                className="bg-white text-violet-700 hover:bg-white/90"
                            >
                                {startPeriodMutation.isPending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                                Open FY
                            </Button>
                        ) : null}
                    </div>
                </div>

                {/* Blockers */}
                <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-slate-500">
                        <AlertTriangle className="h-4 w-4" />
                        Close blockers
                    </div>
                    {isLoading ? (
                        <div className="mt-3 text-sm text-slate-500">Loading…</div>
                    ) : blockers.length === 0 ? (
                        <div className="mt-3 flex items-start gap-2 rounded-xl bg-emerald-50 p-3 text-xs text-emerald-800">
                            <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                            No blockers detected — you can close this financial year.
                        </div>
                    ) : (
                        <ul className="mt-3 space-y-2 text-xs text-rose-700">
                            {blockers.map((b, idx) => (
                                <li
                                    key={idx}
                                    className="flex items-start gap-2 rounded-xl bg-rose-50 p-2 ring-1 ring-rose-100"
                                >
                                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                                    <span>{typeof b === "string" ? b : JSON.stringify(b)}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>

            {/* Formula table */}
            <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 bg-gradient-to-r from-indigo-50 via-violet-50 to-fuchsia-50 px-5 py-4">
                    <div className="font-display text-sm font-semibold text-slate-800">
                        Opening + Ins − Outs ± Adjustments = Closing
                    </div>
                    <p className="text-xs text-slate-500">
                        Per-class quantity flow for {preview?.financial_year || fy}. Values shown at average cost.
                    </p>
                </div>
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[760px] text-sm">
                        <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                            <tr>
                                <th className="px-4 py-2 text-left">Class</th>
                                <th className="px-4 py-2 text-right">Opening</th>
                                <th className="px-4 py-2 text-right">+ Ins</th>
                                <th className="px-4 py-2 text-right">− Outs</th>
                                <th className="px-4 py-2 text-right">± Adjustments</th>
                                <th className="px-4 py-2 text-right">= Closing</th>
                                <th className="px-4 py-2 text-right">Value (₹)</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {STOCK_CLASSES.map((cls) => {
                                const r = buildClassRow(cls)
                                return (
                                    <tr key={cls} className="hover:bg-slate-50/50">
                                        <td className="px-4 py-3">
                                            <div className="font-display font-semibold text-slate-800">{cls}</div>
                                            <div className="text-[11px] text-slate-500">
                                                {byClass[cls]?.count || 0} row(s)
                                            </div>
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono text-xs text-slate-700">
                                            {r.opening.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono text-xs text-emerald-700">
                                            {r.ins.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono text-xs text-rose-700">
                                            {r.outs.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono text-xs text-amber-700">
                                            {r.adjustments.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono text-sm font-semibold text-slate-900">
                                            {r.closing.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono text-xs text-slate-700">
                                            ₹ {r.value.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                        <tfoot>
                            <tr className="bg-gradient-to-r from-indigo-50 via-violet-50 to-fuchsia-50">
                                <td className="px-4 py-3 font-display text-sm font-semibold text-slate-800">Totals</td>
                                <td colSpan={4} />
                                <td className="px-4 py-3 text-right font-mono text-sm font-semibold text-slate-900">
                                    {Object.values(byClass).reduce((s, r) => s + r.qty, 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                </td>
                                <td className="px-4 py-3 text-right font-mono text-sm font-semibold text-slate-900">
                                    ₹ {totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                                </td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>

            {/* Final close button */}
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-xs text-slate-500">
                    Closing the financial year locks the period and creates the next opening batch from the approved closing snapshot.
                </div>
                <Button
                    data-testid="period-close"
                    onClick={() => setConfirmOpen(true)}
                    disabled={!period || period.status === "CLOSED" || blockers.length > 0}
                    className={cn(
                        "bg-gradient-to-r from-violet-600 via-fuchsia-600 to-rose-500 text-white",
                        "hover:from-violet-500 hover:via-fuchsia-500 hover:to-rose-400"
                    )}
                >
                    <Lock className="mr-2 h-4 w-4" />
                    Close Financial Year
                </Button>
            </div>

            <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Close {preview?.financial_year || fy}?</DialogTitle>
                        <DialogDescription>
                            This will call the live period-close endpoint, lock this FY for the selected plant, and generate the next-year opening snapshot.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-700">
                        Plant <span className="font-semibold">{preview?.plant?.name || catalog.plant?.name}</span> closing value: ₹ {totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={closeMutation.isPending}>Cancel</Button>
                        <Button
                            data-testid="period-close-confirm"
                            onClick={() => closeMutation.mutate()}
                            disabled={closeMutation.isPending || !period || blockers.length > 0}
                            className="bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white"
                        >
                            {closeMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Lock className="mr-2 h-4 w-4" />}
                            Close FY
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}

"use client"

import * as React from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, CheckCircle2, Loader2, Save, Search } from "lucide-react"

import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import {
    stockLifecycleService,
    type MasterCatalog,
} from "@/services/stock-lifecycle"

const VARIANCE_THRESHOLD = 2 // percent

interface CountTabProps {
    plantId: string
    catalog: MasterCatalog
    categoryFilter: string | null
}

interface CountDraft {
    counted: string
    reason: string
}

export function CountTab({ plantId, catalog, categoryFilter }: CountTabProps) {
    const qc = useQueryClient()
    const { toast } = useToast()
    const [search, setSearch] = React.useState("")
    const [drafts, setDrafts] = React.useState<Record<string, CountDraft>>({})

    const rows = React.useMemo(() => {
        const filtered = categoryFilter
            ? catalog.rows.filter((r) => r.category === categoryFilter)
            : catalog.rows
        if (!search.trim()) return filtered
        const q = search.trim().toLowerCase()
        return filtered.filter(
            (r) =>
                r.code.toLowerCase().includes(q) ||
                (r.name || "").toLowerCase().includes(q)
        )
    }, [catalog.rows, categoryFilter, search])

    const computeVariance = (system: number, counted: number) => {
        if (system === 0 && counted === 0) return 0
        if (system === 0) return 100 // any nonzero count is 100%+
        return ((counted - system) / system) * 100
    }

    const stats = React.useMemo(() => {
        let overThreshold = 0
        let ready = 0
        let blocked = 0
        for (const row of rows) {
            const d = drafts[row.id]
            if (!d || d.counted === "") continue
            const counted = Number(d.counted)
            if (Number.isNaN(counted)) continue
            const variance = Math.abs(computeVariance(row.system_qty, counted))
            if (variance >= VARIANCE_THRESHOLD) {
                overThreshold += 1
                if (!d.reason.trim()) {
                    blocked += 1
                } else {
                    ready += 1
                }
            } else {
                ready += 1
            }
        }
        return { overThreshold, ready, blocked }
    }, [drafts, rows])

    const setDraft = (id: string, patch: Partial<CountDraft>) => {
        setDrafts((prev) => {
            const existing: CountDraft = prev[id] ?? { counted: "", reason: "" }
            return { ...prev, [id]: { ...existing, ...patch } }
        })
    }

    const mutation = useMutation({
        mutationFn: async () => {
            const lines = rows
                .map((row) => {
                    const d = drafts[row.id]
                    if (!d || d.counted === "") return null
                    const counted = Number(d.counted)
                    if (Number.isNaN(counted)) return null
                    const variance = Math.abs(computeVariance(row.system_qty, counted))
                    if (variance >= VARIANCE_THRESHOLD && !d.reason.trim()) {
                        throw new Error(
                            `Row ${row.code} has ${variance.toFixed(1)}% variance — a reason is required.`
                        )
                    }
                    const locationId = row.locations.find((l) => l.id)?.id || ""
                    if (!locationId) {
                        // Cannot count without a location reference
                        return null
                    }
                    return {
                        stock_class: row.stock_class,
                        material: row.id,
                        location: locationId,
                        quantity: row.system_qty,
                        counted_qty: counted,
                        uom: row.base_uom,
                        notes: d.reason || "",
                    }
                })
                .filter(Boolean) as Array<Record<string, unknown>>

            if (lines.length === 0) {
                throw new Error("No countable rows. Enter counted qty for at least one row with stock.")
            }

            const batch: any = await stockLifecycleService.createCountBatch({
                type: "PHYSICAL_COUNT",
                plant: plantId,
                cutoff_at: new Date().toISOString(),
                notes: "Stock Lifecycle workspace count",
                lines,
            })
            const batchId = batch?.id || batch?.batch_id
            if (batchId) {
                await stockLifecycleService.postBatch(batchId)
            }
            return batch
        },
        onSuccess: () => {
            toast({
                title: "Count batch posted",
                description: `${stats.ready} rows committed.`,
            })
            setDrafts({})
            qc.invalidateQueries({ queryKey: ["stock-lifecycle", "catalog"] })
        },
        onError: (err: any) => {
            toast({
                title: "Failed to save count",
                description: err?.response?.data?.detail || err?.message || "Please try again.",
                variant: "destructive" as any,
            })
        },
    })

    return (
        <div data-testid="stock-count-tab" className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,1fr)_260px]">
            <div className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-3">
                    <div className="relative flex-1 min-w-[240px]">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <Input
                            data-testid="count-material-search"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search materials…"
                            className="pl-9"
                        />
                    </div>
                    <div className="text-xs text-slate-500">
                        {rows.length} material{rows.length === 1 ? "" : "s"} listed
                    </div>
                </div>

                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_8px_30px_-20px_rgba(15,23,42,0.18)]">
                    <div className="hidden grid-cols-[140px_minmax(0,1fr)_110px_120px_110px_minmax(0,1fr)] gap-3 bg-slate-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 md:grid">
                        <div>Code</div>
                        <div>Material</div>
                        <div className="text-right">System</div>
                        <div>Counted</div>
                        <div className="text-right">Variance %</div>
                        <div>Reason (≥ {VARIANCE_THRESHOLD}%)</div>
                    </div>
                    <div className="divide-y divide-slate-100">
                        {rows.length === 0 ? (
                            <div className="p-10 text-center text-sm text-slate-500">
                                No materials match the current filter.
                            </div>
                        ) : (
                            rows.map((row) => {
                                const d = drafts[row.id]
                                const counted = d?.counted === "" || d?.counted == null ? null : Number(d.counted)
                                const variance = counted == null
                                    ? null
                                    : computeVariance(row.system_qty, counted)
                                const absVariance = variance == null ? 0 : Math.abs(variance)
                                const isOver = variance != null && absVariance >= VARIANCE_THRESHOLD
                                const isExact = variance != null && absVariance === 0
                                const reasonRequired = isOver && !(d?.reason || "").trim()

                                return (
                                    <div
                                        key={row.id}
                                        data-testid={`count-row-${row.id}`}
                                        className={cn(
                                            "px-4 py-2 text-sm md:grid md:grid-cols-[140px_minmax(0,1fr)_110px_120px_110px_minmax(0,1fr)] md:items-start md:gap-3",
                                            reasonRequired && "bg-rose-50/40"
                                        )}
                                    >
                                        <div className="font-mono text-xs text-slate-700">{row.code}</div>
                                        <div className="truncate">
                                            <div className="text-slate-800">{row.name}</div>
                                            <div className="text-[11px] text-slate-500">
                                                {row.category} · {row.stock_class}
                                            </div>
                                        </div>
                                        <div className="text-right font-mono text-xs text-slate-600 md:pt-1.5">
                                            {row.system_qty.toLocaleString(undefined, { maximumFractionDigits: 3 })}
                                        </div>
                                        <Input
                                            data-testid={`count-counted-${row.id}`}
                                            type="number"
                                            inputMode="decimal"
                                            min="0"
                                            step="0.001"
                                            value={d?.counted || ""}
                                            onChange={(e) => setDraft(row.id, { counted: e.target.value })}
                                            placeholder="0.000"
                                            className="h-8"
                                        />
                                        <div
                                            className={cn(
                                                "text-right font-mono text-xs md:pt-1.5",
                                                variance == null && "text-slate-400",
                                                isExact && "text-emerald-700",
                                                variance != null && !isExact && !isOver && "text-amber-700",
                                                isOver && "text-rose-700 font-semibold"
                                            )}
                                        >
                                            {variance == null ? "—" : `${variance >= 0 ? "+" : ""}${variance.toFixed(2)}%`}
                                        </div>
                                        <div>
                                            <Textarea
                                                data-testid={`count-reason-${row.id}`}
                                                value={d?.reason || ""}
                                                onChange={(e) => setDraft(row.id, { reason: e.target.value })}
                                                disabled={!isOver}
                                                placeholder={isOver ? "Required: explain variance" : "—"}
                                                className={cn(
                                                    "min-h-[34px] text-xs",
                                                    reasonRequired && "border-rose-400 ring-1 ring-rose-200"
                                                )}
                                                rows={1}
                                            />
                                            {reasonRequired && (
                                                <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-rose-700">
                                                    <AlertTriangle className="h-3 w-3" />
                                                    Reason required to save
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                )
                            })
                        )}
                    </div>
                </div>
            </div>

            {/* Side card */}
            <aside className="space-y-4">
                <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white to-slate-50 p-4 shadow-sm">
                    <div className="text-xs uppercase tracking-wide text-slate-500">Variance summary</div>
                    <dl className="mt-3 space-y-2 text-sm">
                        <div className="flex items-center justify-between">
                            <dt className="text-slate-600">Ready to post</dt>
                            <dd className="font-display text-base font-semibold text-emerald-700">{stats.ready}</dd>
                        </div>
                        <div className="flex items-center justify-between">
                            <dt className="text-slate-600">Over {VARIANCE_THRESHOLD}% threshold</dt>
                            <dd className="font-display text-base font-semibold text-amber-700">{stats.overThreshold}</dd>
                        </div>
                        <div className="flex items-center justify-between">
                            <dt className="text-slate-600">Blocked (need reason)</dt>
                            <dd className={cn(
                                "font-display text-base font-semibold",
                                stats.blocked > 0 ? "text-rose-700" : "text-slate-400"
                            )}>{stats.blocked}</dd>
                        </div>
                    </dl>
                    {stats.blocked > 0 ? (
                        <div className="mt-3 flex items-start gap-2 rounded-xl bg-rose-50 p-3 text-xs text-rose-700">
                            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                            Add a reason for each row over {VARIANCE_THRESHOLD}% variance before saving.
                        </div>
                    ) : stats.ready > 0 ? (
                        <div className="mt-3 flex items-start gap-2 rounded-xl bg-emerald-50 p-3 text-xs text-emerald-800">
                            <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                            Ready to save count batch.
                        </div>
                    ) : (
                        <div className="mt-3 text-xs text-slate-500">
                            Enter counted quantities to build a batch.
                        </div>
                    )}
                    <Button
                        data-testid="count-post-batch"
                        className="mt-4 w-full bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 text-white hover:from-indigo-500 hover:via-violet-500 hover:to-fuchsia-500"
                        disabled={stats.ready === 0 || stats.blocked > 0 || mutation.isPending}
                        onClick={() => mutation.mutate()}
                    >
                        {mutation.isPending ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                            <Save className="mr-2 h-4 w-4" />
                        )}
                        Save count batch
                    </Button>
                </div>

                <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4 text-xs text-indigo-800">
                    <div className="font-semibold text-indigo-900">How it works</div>
                    <p className="mt-1">
                        Counted qty is compared to system qty. Anything ≥ {VARIANCE_THRESHOLD}% off needs a reason. A new PHYSICAL_COUNT audit batch is created and posted in one step.
                    </p>
                </div>
            </aside>
        </div>
    )
}

"use client"

import * as React from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { Plus, SlidersHorizontal, FileText, CheckCircle2, Ban } from "lucide-react"

import { GradientHero } from "@/components/erp-v3/gradient-hero"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
    stockAdjustmentService,
    type StockAdjustment,
    type StockAdjustmentStatus,
} from "@/services/stock-adjustment"

const STATUS_FILTERS: { value: StockAdjustmentStatus | "ALL"; label: string }[] = [
    { value: "ALL", label: "All" },
    { value: "DRAFT", label: "Draft" },
    { value: "POSTED", label: "Posted" },
    { value: "VOID", label: "Voided" },
]

export function StockAdjustmentsList() {
    const [statusFilter, setStatusFilter] = React.useState<StockAdjustmentStatus | "ALL">("ALL")

    const { data: rows = [], isLoading } = useQuery({
        queryKey: ["stock-adjustments"],
        queryFn: () => stockAdjustmentService.list(),
        staleTime: 30_000,
    })

    const counts = React.useMemo(() => {
        const r = { DRAFT: 0, POSTED: 0, VOID: 0 } as Record<StockAdjustmentStatus, number>
        for (const a of rows) r[a.status] = (r[a.status] || 0) + 1
        return r
    }, [rows])

    const filtered = React.useMemo(() => {
        if (statusFilter === "ALL") return rows
        return rows.filter((r) => r.status === statusFilter)
    }, [rows, statusFilter])

    return (
        <div className="min-h-screen bg-gradient-to-b from-violet-50/40 via-white to-slate-50/40 px-4 py-4 sm:px-6">
            <GradientHero
                palette="violet"
                eyebrow="INVENTORY · STOCK ADJUSTMENTS"
                title="Stock Adjustments"
                subtitle="Unified audit trail for all stock corrections — bulk, rolls, packaging, and trading goods all flow through the same posting pipeline."
                chips={[
                    { icon: <FileText className="h-4 w-4" />, label: "Draft", value: String(counts.DRAFT), tone: "info" },
                    { icon: <CheckCircle2 className="h-4 w-4" />, label: "Posted", value: String(counts.POSTED), tone: "ok" },
                    { icon: <Ban className="h-4 w-4" />, label: "Voided", value: String(counts.VOID), tone: "violet" },
                ]}
                actions={
                    <Link href="/inventory/adjustments/new">
                        <Button className="bg-white text-violet-700 hover:bg-white/90">
                            <Plus className="mr-1.5 h-4 w-4" /> New Adjustment
                        </Button>
                    </Link>
                }
            />

            <div className="mt-4 flex flex-wrap items-center gap-2">
                {STATUS_FILTERS.map((f) => (
                    <button
                        key={f.value}
                        onClick={() => setStatusFilter(f.value)}
                        className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${statusFilter === f.value
                            ? "bg-violet-600 text-white shadow-sm"
                            : "border border-slate-200 bg-white text-slate-600 hover:border-violet-300"
                            }`}
                    >
                        {f.label}
                        {f.value !== "ALL" ? (
                            <span className="ml-1.5 font-mono text-[10px] opacity-80">
                                {counts[f.value as StockAdjustmentStatus] || 0}
                            </span>
                        ) : null}
                    </button>
                ))}
            </div>

            <section className="mt-4">
                {isLoading ? (
                    <div className="rounded-3xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
                        Loading adjustments…
                    </div>
                ) : filtered.length === 0 ? (
                    <EmptyState empty={rows.length === 0} />
                ) : (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {filtered.map((a) => (
                            <AdjustmentCard key={a.id} a={a} />
                        ))}
                    </div>
                )}
            </section>
        </div>
    )
}

function EmptyState({ empty }: { empty: boolean }) {
    return (
        <div className="flex flex-col items-center gap-3 rounded-3xl border border-slate-200 bg-white p-10 text-center">
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-violet-100 text-violet-700">
                <SlidersHorizontal className="h-7 w-7" />
            </div>
            <div>
                <div className="text-sm font-bold text-slate-800">
                    {empty ? "No stock adjustments yet" : "No adjustments match this filter"}
                </div>
                <p className="mt-1 max-w-[420px] text-[11px] text-slate-500">
                    Stock adjustments capture damage, write-offs, count corrections, and reclassifications — all in one auditable log.
                </p>
            </div>
            {empty ? (
                <Link href="/inventory/adjustments/new">
                    <Button className="bg-violet-600 text-white hover:bg-violet-700">
                        <Plus className="mr-1.5 h-4 w-4" /> Create first adjustment
                    </Button>
                </Link>
            ) : null}
        </div>
    )
}

function StatusBadge({ status }: { status: StockAdjustmentStatus }) {
    if (status === "POSTED")
        return (
            <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700">
                posted
            </Badge>
        )
    if (status === "VOID")
        return (
            <Badge variant="outline" className="border-slate-200 bg-slate-50 text-[10px] text-slate-500">
                voided
            </Badge>
        )
    return (
        <Badge variant="outline" className="border-amber-200 bg-amber-50 text-[10px] text-amber-700">
            draft
        </Badge>
    )
}

function AdjustmentCard({ a }: { a: StockAdjustment }) {
    const totalLines = a.lines?.length || 0
    const totalDelta = (a.lines || []).reduce((s, l) => s + Number(l.delta_qty || 0), 0)
    return (
        <Link href={`/inventory/adjustments/${a.id}`} className="group">
            <article className="rounded-3xl bg-white p-5 shadow-[0_20px_60px_-30px_rgba(15,23,42,0.25)] ring-1 ring-slate-200/60 transition hover:ring-violet-300">
                <header className="flex items-start justify-between gap-2">
                    <div>
                        <div className="font-mono text-[12px] font-bold text-violet-700">{a.code}</div>
                        <h3 className="mt-0.5 text-sm font-bold text-slate-900 group-hover:text-violet-700">
                            {a.plant_name || "—"}
                        </h3>
                        <p className="mt-1 text-[11px] text-slate-500">
                            {a.reason.replace(/_/g, " ").toLowerCase()}
                        </p>
                    </div>
                    <StatusBadge status={a.status} />
                </header>
                <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                    <Stat label="Lines" value={String(totalLines)} />
                    <Stat label="Net Δ" value={totalDelta.toLocaleString()} />
                    <Stat label="Created" value={a.created_at ? new Date(a.created_at).toLocaleDateString() : "—"} />
                </dl>
            </article>
        </Link>
    )
}

function Stat({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-2xl bg-slate-50 px-2 py-2">
            <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
            <div className="mt-0.5 font-mono text-sm font-bold text-slate-900">{value}</div>
        </div>
    )
}

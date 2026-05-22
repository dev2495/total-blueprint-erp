"use client"

import * as React from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { Plus, Search, ShoppingBag, Package, BadgePercent, Boxes } from "lucide-react"

import { GradientHero } from "@/components/erp-v3/gradient-hero"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { tradingGoodService, type TradingGood } from "@/services/trading-goods"

const TRADE_TYPE_LABELS: Record<string, string> = {
    READY_POUCH: "Ready pouch",
    READY_ROLL: "Ready roll",
    PACKAGING: "Packing item",
    RAW_MATERIAL: "Raw material",
    OTHER: "Other",
}

export default function TradingGoodsListPage() {
    const [q, setQ] = React.useState("")
    const [showInactive, setShowInactive] = React.useState(false)

    const { data: goods = [], isLoading } = useQuery({
        queryKey: ["trading-goods"],
        queryFn: () => tradingGoodService.list(),
        staleTime: 30_000,
    })

    const filtered = React.useMemo(() => {
        const needle = q.trim().toLowerCase()
        let rows = goods
        if (!showInactive) rows = rows.filter((g) => g.is_active)
        if (!needle) return rows
        return rows.filter((g) =>
            [g.code, g.name, g.description, g.hsn_code]
                .filter(Boolean)
                .some((v) => String(v).toLowerCase().includes(needle)),
        )
    }, [goods, q, showInactive])

    const activeCount = goods.filter((g) => g.is_active).length
    const inactiveCount = goods.length - activeCount
    const stockSum = goods.reduce((s, g) => s + Number(g.current_stock_qty || 0), 0)

    return (
        <div className="min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-slate-50/40 px-4 py-4 sm:px-6">
            <GradientHero
                palette="emerald"
                eyebrow="MASTER · TRADING GOODS"
                title="Items we resell"
                subtitle="Ready-made pouches, outsourced rolls, and other trade-only items. Separate stock pool, sold directly from a dispatch plant."
                chips={[
                    { icon: <ShoppingBag className="h-4 w-4" />, label: "Total", value: String(goods.length), tone: "ok" },
                    { icon: <Package className="h-4 w-4" />, label: "Active", value: String(activeCount), tone: "info" },
                    { icon: <Boxes className="h-4 w-4" />, label: "Stock units", value: String(Math.round(stockSum)), tone: "violet" },
                ]}
                actions={
                    <Link href="/master/trading-goods/new">
                        <Button className="bg-white text-emerald-700 hover:bg-white/90">
                            <Plus className="mr-1.5 h-4 w-4" /> New trading good
                        </Button>
                    </Link>
                }
            />

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                <div className="relative w-72">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder="Search code, name or HSN…"
                        className="pl-9"
                    />
                </div>
                <div className="flex items-center gap-3 text-[12px] text-slate-500">
                    <label className="flex items-center gap-1.5 text-[11px] font-bold">
                        <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
                        Show inactive ({inactiveCount})
                    </label>
                    <span>Showing <b className="text-slate-900">{filtered.length}</b> of {goods.length}</span>
                </div>
            </div>

            <section className="mt-4">
                {isLoading ? (
                    <div className="rounded-3xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-500">
                        Loading trading goods…
                    </div>
                ) : filtered.length === 0 ? (
                    <EmptyState empty={goods.length === 0} />
                ) : (
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {filtered.map((g) => (
                            <TradingGoodCard key={g.id} g={g} />
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
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-emerald-100 text-emerald-700">
                <ShoppingBag className="h-7 w-7" />
            </div>
            <div>
                <div className="text-sm font-bold text-slate-800">
                    {empty ? "No trading goods yet" : "No trading goods match your search"}
                </div>
                <p className="mt-1 max-w-[420px] text-[11px] text-slate-500">
                    {empty
                        ? "Add ready-made packaging items, resold films, or any item you trade as-is."
                        : "Try a different search term or clear the filter."}
                </p>
            </div>
            {empty ? (
                <Link href="/master/trading-goods/new">
                    <Button className="bg-emerald-600 text-white hover:bg-emerald-700"><Plus className="mr-1.5 h-4 w-4" /> Add first trading good</Button>
                </Link>
            ) : null}
        </div>
    )
}

function TradingGoodCard({ g }: { g: TradingGood }) {
    return (
        <Link href={`/master/trading-goods/${g.id}`} className="group">
            <article className="rounded-3xl bg-white p-5 shadow-[0_20px_60px_-30px_rgba(15,23,42,0.25)] ring-1 ring-slate-200/60 transition hover:ring-emerald-300">
                <header className="flex items-start justify-between gap-2">
                    <div>
                        <div className="font-mono text-[12px] font-bold text-emerald-700">{g.code}</div>
                        <h3 className="mt-0.5 text-sm font-bold text-slate-900 group-hover:text-emerald-700">{g.name}</h3>
                        {g.description ? (
                            <p className="mt-1 line-clamp-2 text-[11px] text-slate-500">{g.description}</p>
                        ) : null}
                    </div>
                    {g.is_active ? (
                        <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700">active</Badge>
                    ) : (
                        <Badge variant="outline" className="border-slate-200 bg-slate-50 text-[10px] text-slate-600">inactive</Badge>
                    )}
                </header>
                <div className="mt-3 flex flex-wrap gap-1.5">
                    <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-[10px] font-bold text-emerald-700">
                        {TRADE_TYPE_LABELS[g.trade_type || "OTHER"] || g.trade_type || "Other"}
                    </Badge>
                    <Badge variant="outline" className="border-slate-200 bg-white text-[10px] font-bold text-slate-600">
                        {g.hsn_code ? `HSN ${g.hsn_code}` : "No HSN"}
                    </Badge>
                </div>
                <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                    <Stat label="Stock" value={`${Number(g.current_stock_qty || 0).toLocaleString()}`} hint={g.base_uom} />
                    <Stat label="Sale ₹" value={g.default_sale_rate != null ? Number(g.default_sale_rate).toLocaleString() : "—"} />
                    <Stat label="GST %" value={String(g.default_gst_pct ?? 0)} icon={<BadgePercent className="h-3 w-3" />} />
                </dl>
            </article>
        </Link>
    )
}

function Stat({ label, value, hint, icon }: { label: string; value: string; hint?: string; icon?: React.ReactNode }) {
    return (
        <div className="rounded-2xl bg-slate-50 px-2 py-2">
            <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500">{label}</div>
            <div className="mt-0.5 flex items-center justify-center gap-1 font-mono text-sm font-bold text-slate-900">
                {icon}
                {value}
            </div>
            {hint ? <div className="text-[9px] text-slate-400">{hint}</div> : null}
        </div>
    )
}

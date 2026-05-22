"use client"

import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import {
  AlertTriangle,
  Award,
  Download,
  IndianRupee,
  Package,
  RefreshCw,
  Repeat,
  ShoppingBag,
  TrendingDown,
  TrendingUp,
} from "lucide-react"

import { analyticsApi } from "@/services/analytics"
import { factoryService, type Plant } from "@/services/factory"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

type Preset = "daily" | "weekly" | "monthly" | "custom"

const PIE_COLORS = ["#10b981", "#06b6d4", "#0ea5e9", "#6366f1", "#f59e0b", "#ef4444", "#84cc16", "#a855f7"]

function todayIso(offset = 0) {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return d.toISOString().slice(0, 10)
}

function fmtINR(value: number) {
  const n = Number(value || 0)
  if (Math.abs(n) >= 10_000_000) return `₹${(n / 10_000_000).toFixed(2)} Cr`
  if (Math.abs(n) >= 100_000) return `₹${(n / 100_000).toFixed(1)} L`
  if (Math.abs(n) >= 1_000) return `₹${(n / 1_000).toFixed(1)}K`
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`
}

function fmtNum(value: number, decimals = 0) {
  const n = Number(value || 0)
  return n.toLocaleString("en-IN", { maximumFractionDigits: decimals })
}

function fmtDate(value: string | null | undefined) {
  if (!value) return "—"
  try {
    return new Date(value).toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" })
  } catch {
    return value
  }
}

function presetRange(preset: Preset, customFrom: string, customTo: string) {
  const today = new Date()
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  if (preset === "daily") return { start_date: iso(today), end_date: iso(today) }
  if (preset === "weekly") {
    const start = new Date()
    start.setDate(today.getDate() - 6)
    return { start_date: iso(start), end_date: iso(today) }
  }
  if (preset === "monthly") {
    const start = new Date()
    start.setDate(today.getDate() - 29)
    return { start_date: iso(start), end_date: iso(today) }
  }
  return { start_date: customFrom, end_date: customTo }
}

export function TradingReportPage() {
  const [preset, setPreset] = useState<Preset>("monthly")
  const [customFrom, setCustomFrom] = useState(todayIso(-29))
  const [customTo, setCustomTo] = useState(todayIso())
  const [plantId, setPlantId] = useState<string>("all")

  const filters = useMemo(() => {
    const range = presetRange(preset, customFrom, customTo)
    const f: Record<string, string> = { ...range }
    if (plantId && plantId !== "all") f.plant_id = plantId
    return f
  }, [preset, customFrom, customTo, plantId])

  const plantsQuery = useQuery({
    queryKey: ["plants-for-trading"],
    queryFn: async () => {
      const list = await factoryService.getPlants()
      return Array.isArray(list) ? list : []
    },
    staleTime: 5 * 60_000,
  })

  const report = useQuery({
    queryKey: ["trading-report", filters],
    queryFn: () => analyticsApi.getReportTrading(filters),
    staleTime: 60_000,
  })

  const data = report.data ?? {}
  const summary = (data.summary ?? {}) as Record<string, any>
  const breakdowns = (data.breakdowns ?? {}) as Record<string, any>
  const series = (data.series ?? []) as Array<{ date: string; orders: number; revenue_inr: number; qty: number }>

  const byStatus = (breakdowns.by_status ?? []) as Array<any>
  const byItemType = (breakdowns.by_item_type ?? []) as Array<any>
  const topItems = (breakdowns.top_items ?? []) as Array<any>
  const topCustomers = (breakdowns.top_customers ?? []) as Array<any>
  const slowMoving = (breakdowns.slow_moving ?? []) as Array<any>
  const stockByPlant = (breakdowns.stock_by_plant ?? []) as Array<any>

  const marginPct = Number(summary.trade_gross_margin_pct || 0)
  const marginTone =
    marginPct >= 20
      ? "text-emerald-700"
      : marginPct >= 10
      ? "text-amber-600"
      : "text-rose-600"
  const marginBg =
    marginPct >= 20 ? "from-emerald-400 to-emerald-600" : marginPct >= 10 ? "from-amber-400 to-amber-600" : "from-rose-400 to-rose-600"

  const revenueDelta = Number(summary.trade_revenue_delta_pct || 0)
  const handleExport = () => {
    const params = new URLSearchParams(filters as Record<string, string>).toString()
    window.open(`/api/analytics/reports/trading/export-pdf/${params ? `?${params}` : ""}`, "_blank")
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* HERO */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-600 via-teal-600 to-cyan-600 p-6 text-white shadow-[0_20px_60px_-30px_rgba(16,185,129,0.6)]">
        <div className="absolute -top-20 -right-20 h-72 w-72 rounded-full bg-emerald-300/30 blur-3xl" />
        <div className="absolute -bottom-24 -left-12 h-64 w-64 rounded-full bg-cyan-300/30 blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-white/80">
              <Repeat className="h-4 w-4" /> Trading Surface
            </div>
            <h1 className="mt-2 font-display text-3xl font-extrabold tracking-tight md:text-4xl">
              Trading Pulse
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-white/80">
              Trading goods, sellable materials, orders, revenue, margin — one report.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-2xl bg-white/10 p-1 ring-1 ring-white/20 backdrop-blur">
              {(["daily", "weekly", "monthly", "custom"] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setPreset(p)}
                  className={cn(
                    "rounded-xl px-3 py-1.5 text-xs font-semibold capitalize transition",
                    preset === p ? "bg-white text-emerald-700 shadow" : "text-white/85 hover:bg-white/10",
                  )}
                >
                  {p}
                </button>
              ))}
            </div>
            <Select value={plantId} onValueChange={setPlantId}>
              <SelectTrigger className="h-9 w-40 rounded-xl border-white/20 bg-white/10 text-xs text-white">
                <SelectValue placeholder="All Plants" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Plants</SelectItem>
                {(plantsQuery.data ?? []).map((p: Plant) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.code ?? p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="secondary"
              size="sm"
              className="rounded-xl bg-white/15 text-white hover:bg-white/25"
              onClick={() => report.refetch()}
            >
              <RefreshCw className={cn("mr-1 h-3.5 w-3.5", report.isFetching && "animate-spin")} /> Refresh
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className="rounded-xl bg-white/15 text-white hover:bg-white/25"
              onClick={handleExport}
            >
              <Download className="mr-1 h-3.5 w-3.5" /> Export PDF
            </Button>
          </div>
        </div>
        {preset === "custom" && (
          <div className="relative mt-4 flex flex-wrap items-center gap-2 text-xs">
            <span className="opacity-80">From</span>
            <input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="rounded-lg border border-white/20 bg-white/10 px-2 py-1 text-white"
            />
            <span className="opacity-80">to</span>
            <input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="rounded-lg border border-white/20 bg-white/10 px-2 py-1 text-white"
            />
          </div>
        )}
      </div>

      {/* KPI GRID */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KPI
          title="Trading Stock Value"
          value={fmtINR(Number(summary.total_tradeable_value_inr || 0))}
          sub={`${fmtNum(Number(summary.trading_goods_count || 0))} trading goods · ${fmtNum(Number(summary.sellable_materials_count || 0))} sellable materials`}
          icon={<Package className="h-5 w-5" />}
          accent="from-emerald-400 to-emerald-600"
        />
        <KPI
          title="Open Trade Orders"
          value={fmtNum(Number(summary.open_trade_orders || 0))}
          sub={`${fmtNum(Number(summary.draft_count || 0))} draft · ${fmtNum(Number(summary.confirmed_count || 0))} confirmed`}
          icon={<Repeat className="h-5 w-5" />}
          accent="from-teal-400 to-teal-600"
        />
        <KPI
          title={`Revenue (${preset === "custom" ? "Range" : preset[0].toUpperCase() + preset.slice(1)})`}
          value={fmtINR(Number(summary.trade_revenue_inr || 0))}
          sub={
            <span className={cn("inline-flex items-center gap-1", revenueDelta >= 0 ? "text-emerald-600" : "text-rose-600")}>
              {revenueDelta >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
              {Math.abs(revenueDelta).toFixed(1)}% vs prev period
            </span>
          }
          icon={<IndianRupee className="h-5 w-5" />}
          accent="from-cyan-400 to-cyan-600"
        />
        <KPI
          title="Gross Margin %"
          value={`${marginPct.toFixed(1)}%`}
          sub={`${fmtINR(Number(summary.trade_gross_margin_inr || 0))} on ${fmtINR(Number(summary.trade_revenue_pre_gst_inr || 0))} (pre-GST)`}
          icon={<Award className="h-5 w-5" />}
          accent={marginBg}
          valueClassName={marginTone}
        />
      </div>

      {/* TREND CHART */}
      <Card className="rounded-3xl ring-1 ring-slate-200/60 shadow-[0_20px_60px_-30px_rgba(16,185,129,0.25)]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-display text-lg">
            <TrendingUp className="h-4 w-4 text-emerald-600" /> Trade Revenue Trend
          </CardTitle>
        </CardHeader>
        <CardContent>
          {series.length === 0 ? (
            <div className="flex h-60 items-center justify-center rounded-2xl bg-slate-50 text-sm text-slate-500">
              No trade revenue in selected period yet.
            </div>
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={series} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="tradeRevGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10b981" stopOpacity={0.55} />
                      <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,23,42,0.06)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="rev" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} tickFormatter={(v) => fmtINR(Number(v))} />
                  <YAxis yAxisId="orders" orientation="right" tick={{ fontSize: 11, fill: "#0891b2" }} axisLine={false} tickLine={false} />
                  <Tooltip
                    formatter={(value: any, name: any) => {
                      if (String(name) === "Revenue") return fmtINR(Number(value))
                      return fmtNum(Number(value), 0)
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Area
                    yAxisId="rev"
                    type="monotone"
                    dataKey="revenue_inr"
                    name="Revenue"
                    stroke="#10b981"
                    strokeWidth={2.5}
                    fill="url(#tradeRevGrad)"
                  />
                  <Line yAxisId="orders" type="monotone" dataKey="orders" name="Orders" stroke="#0891b2" strokeWidth={2} dot={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* STATUS MIX + ITEM TYPE */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="rounded-3xl ring-1 ring-slate-200/60 shadow-[0_20px_60px_-30px_rgba(15,23,42,0.15)]">
          <CardHeader>
            <CardTitle className="font-display text-base">Status mix</CardTitle>
          </CardHeader>
          <CardContent>
            {byStatus.length === 0 ? (
              <div className="flex h-56 items-center justify-center text-sm text-slate-500">No orders in window.</div>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={byStatus} dataKey="count" nameKey="status" innerRadius={40} outerRadius={70} paddingAngle={3}>
                        {byStatus.map((_, i) => (
                          <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <ul className="space-y-2 text-sm">
                  {byStatus.map((s, i) => (
                    <li key={s.status} className="flex items-center justify-between rounded-xl border border-slate-200/70 bg-white/60 px-3 py-2">
                      <span className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                        <span className="font-medium text-slate-700">{s.status}</span>
                      </span>
                      <span className="font-mono text-slate-900">{fmtNum(s.count)} · {fmtINR(s.value_inr)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-3xl ring-1 ring-slate-200/60 shadow-[0_20px_60px_-30px_rgba(15,23,42,0.15)]">
          <CardHeader>
            <CardTitle className="font-display text-base">By item type</CardTitle>
          </CardHeader>
          <CardContent>
            {byItemType.length === 0 ? (
              <div className="flex h-56 items-center justify-center text-sm text-slate-500">No dispatched lines yet.</div>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={byItemType.map((r) => ({ ...r, label: r.type.replace("_", " ") }))} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(15,23,42,0.06)" />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                    <Tooltip
                      formatter={(value: any, name: any) => {
                        if (String(name) === "Revenue") return fmtINR(Number(value))
                        return fmtNum(Number(value), 2)
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="revenue_inr" name="Revenue" fill="#0ea5e9" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="qty" name="Qty" fill="#10b981" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* TOP ITEMS + TOP CUSTOMERS */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="rounded-3xl ring-1 ring-slate-200/60 shadow-[0_20px_60px_-30px_rgba(15,23,42,0.15)]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-display text-base">
              <ShoppingBag className="h-4 w-4 text-emerald-600" /> Top items
            </CardTitle>
          </CardHeader>
          <CardContent>
            {topItems.length === 0 ? (
              <div className="flex h-32 items-center justify-center text-sm text-slate-500">No items dispatched yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200/70 text-xs uppercase tracking-wide text-slate-500">
                      <th className="px-2 py-2 text-left">#</th>
                      <th className="px-2 py-2 text-left">Code</th>
                      <th className="px-2 py-2 text-left">Name</th>
                      <th className="px-2 py-2 text-right">Qty</th>
                      <th className="px-2 py-2 text-right">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topItems.map((item, idx) => (
                      <tr key={`${item.code}-${idx}`} className="border-b border-slate-100/80 last:border-0">
                        <td className="px-2 py-2">
                          <RankBadge rank={idx + 1} />
                        </td>
                        <td className="px-2 py-2 font-mono text-xs text-slate-600">{item.code || "—"}</td>
                        <td className="px-2 py-2">
                          <div className="font-medium text-slate-800">{item.name}</div>
                          <Badge variant="outline" className="mt-1 text-[10px]">
                            {item.kind === "TRADING_GOOD" ? "Trading Good" : "Inventory Material"}
                          </Badge>
                        </td>
                        <td className="px-2 py-2 text-right font-mono">{fmtNum(item.qty, 2)}</td>
                        <td className="px-2 py-2 text-right font-mono font-semibold text-emerald-700">{fmtINR(item.revenue_inr)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-3xl ring-1 ring-slate-200/60 shadow-[0_20px_60px_-30px_rgba(15,23,42,0.15)]">
          <CardHeader>
            <CardTitle className="font-display text-base">Top customers</CardTitle>
          </CardHeader>
          <CardContent>
            {topCustomers.length === 0 ? (
              <div className="flex h-32 items-center justify-center text-sm text-slate-500">No customers yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200/70 text-xs uppercase tracking-wide text-slate-500">
                      <th className="px-2 py-2 text-left">Customer</th>
                      <th className="px-2 py-2 text-right">Orders</th>
                      <th className="px-2 py-2 text-right">Revenue</th>
                      <th className="px-2 py-2 text-right">Last order</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topCustomers.map((c, idx) => (
                      <tr key={`${c.customer}-${idx}`} className="border-b border-slate-100/80 last:border-0">
                        <td className="px-2 py-2 font-medium text-slate-800">{c.customer_name}</td>
                        <td className="px-2 py-2 text-right font-mono">{fmtNum(c.orders)}</td>
                        <td className="px-2 py-2 text-right font-mono font-semibold text-emerald-700">{fmtINR(c.revenue_inr)}</td>
                        <td className="px-2 py-2 text-right text-xs text-slate-500">{fmtDate(c.last_order_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* SLOW MOVERS */}
      <Card className="rounded-3xl ring-1 ring-amber-300/60 shadow-[0_20px_60px_-30px_rgba(245,158,11,0.3)] bg-gradient-to-br from-amber-50/60 via-white to-white">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-display text-base text-amber-800">
            <AlertTriangle className="h-4 w-4" /> Slow movers — held stock with no dispatch in 60 days
          </CardTitle>
        </CardHeader>
        <CardContent>
          {slowMoving.length === 0 ? (
            <div className="rounded-2xl bg-emerald-50 px-4 py-6 text-center text-sm font-medium text-emerald-700">
              All trading goods moved within the last 60 days.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-amber-200/70 text-xs uppercase tracking-wide text-amber-800">
                    <th className="px-2 py-2 text-left">Code</th>
                    <th className="px-2 py-2 text-left">Name</th>
                    <th className="px-2 py-2 text-right">Stock qty</th>
                    <th className="px-2 py-2 text-right">Stock value</th>
                    <th className="px-2 py-2 text-right">Last dispatched</th>
                  </tr>
                </thead>
                <tbody>
                  {slowMoving.map((row) => (
                    <tr key={row.code} className="border-b border-amber-100/70 last:border-0">
                      <td className="px-2 py-2 font-mono text-xs text-slate-700">{row.code}</td>
                      <td className="px-2 py-2 font-medium text-slate-800">{row.name}</td>
                      <td className="px-2 py-2 text-right font-mono">{fmtNum(row.stock_qty, 2)}</td>
                      <td className="px-2 py-2 text-right font-mono font-semibold text-amber-700">{fmtINR(row.stock_value_inr)}</td>
                      <td className="px-2 py-2 text-right text-xs text-slate-500">{fmtDate(row.last_dispatched_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* STOCK BY PLANT */}
      <Card className="rounded-3xl ring-1 ring-slate-200/60 shadow-[0_20px_60px_-30px_rgba(15,23,42,0.15)]">
        <CardHeader>
          <CardTitle className="font-display text-base">Stock by plant</CardTitle>
        </CardHeader>
        <CardContent>
          {stockByPlant.length === 0 ? (
            <div className="flex h-32 items-center justify-center text-sm text-slate-500">No stock recorded yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200/70 text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-2 py-2 text-left">Plant</th>
                    <th className="px-2 py-2 text-right">Trading goods value</th>
                    <th className="px-2 py-2 text-right">Sellable materials value</th>
                    <th className="px-2 py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {stockByPlant.map((row) => {
                    const total = Number(row.trading_goods_value_inr || 0) + Number(row.sellable_materials_value_inr || 0)
                    return (
                      <tr key={row.plant_id ?? row.plant_name} className="border-b border-slate-100/80 last:border-0">
                        <td className="px-2 py-2 font-medium text-slate-800">{row.plant_name}</td>
                        <td className="px-2 py-2 text-right font-mono">{fmtINR(row.trading_goods_value_inr)}</td>
                        <td className="px-2 py-2 text-right font-mono">{fmtINR(row.sellable_materials_value_inr)}</td>
                        <td className="px-2 py-2 text-right font-mono font-semibold text-emerald-700">{fmtINR(total)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {report.isError && (
        <div className="flex items-center gap-2 rounded-2xl border border-rose-200/70 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <AlertTriangle className="h-4 w-4" /> Could not load trading report. Try Refresh.
        </div>
      )}
    </div>
  )
}

function KPI({
  title,
  value,
  sub,
  icon,
  accent,
  valueClassName,
}: {
  title: string
  value: string
  sub?: React.ReactNode
  icon: React.ReactNode
  accent: string
  valueClassName?: string
}) {
  return (
    <div className="relative overflow-hidden rounded-3xl bg-white p-5 ring-1 ring-slate-200/60 shadow-[0_20px_60px_-30px_rgba(15,23,42,0.2)]">
      <div className={cn("absolute -top-12 -right-12 h-32 w-32 rounded-full bg-gradient-to-br opacity-30 blur-2xl", accent)} />
      <div className="relative flex items-start justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-slate-500">{title}</div>
          <div className={cn("mt-2 font-display text-3xl font-extrabold tracking-tight text-slate-900", valueClassName)}>{value}</div>
          {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
        </div>
        <div className={cn("flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-md", accent)}>
          {icon}
        </div>
      </div>
    </div>
  )
}

function RankBadge({ rank }: { rank: number }) {
  const tone =
    rank === 1
      ? "bg-yellow-100 text-yellow-800 ring-yellow-300"
      : rank === 2
      ? "bg-slate-200 text-slate-800 ring-slate-300"
      : rank === 3
      ? "bg-orange-100 text-orange-800 ring-orange-300"
      : "bg-slate-50 text-slate-600 ring-slate-200"
  return (
    <span className={cn("inline-flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ring-1", tone)}>
      {rank}
    </span>
  )
}

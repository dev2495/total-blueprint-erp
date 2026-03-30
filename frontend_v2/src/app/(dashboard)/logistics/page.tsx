"use client"

import Link from "next/link"
import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  Activity,
  ArrowRight,
  Boxes,
  CheckCircle2,
  Factory,
  type LucideIcon,
  Package,
  Truck,
  Waypoints,
} from "lucide-react"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { analyticsApi } from "@/services/analytics"

function KpiCard({
  label,
  value,
  helper,
  tone,
  icon: Icon,
}: {
  label: string
  value: string | number
  helper: string
  tone: string
  icon: LucideIcon
}) {
  return (
    <Card className="rounded-[1.75rem] border border-slate-200/80 bg-white shadow-sm">
      <CardContent className="p-6">
        <div className="mb-5 flex items-start justify-between">
          <div className={`flex h-12 w-12 items-center justify-center rounded-2xl ${tone}`}>
            <Icon className="h-5 w-5" strokeWidth={2.2} />
          </div>
        </div>
        <div className="text-[11px] font-black uppercase tracking-[0.22em] text-slate-500">{label}</div>
        <div className="mt-2 text-4xl font-black tracking-tight text-slate-950">{value}</div>
        <div className="mt-2 text-sm font-medium text-slate-500">{helper}</div>
      </CardContent>
    </Card>
  )
}

export default function LogisticsHubPage() {
  const { data: dispatchReport, isLoading: dispatchLoading } = useQuery({
    queryKey: ["analytics", "dispatch-report", "hub"],
    queryFn: () => analyticsApi.getReportDispatch({}),
  })
  const { data: transitReport, isLoading: transitLoading } = useQuery({
    queryKey: ["analytics", "interplant-report", "hub"],
    queryFn: () => analyticsApi.getReportTab("interplant", {}),
  })

  const loading = dispatchLoading || transitLoading
  const summary = dispatchReport?.summary || {}
  const transitSummary = transitReport?.summary || {}

  const dailyTrend = useMemo(
    () =>
      (dispatchReport?.daily_trend || []).map((row: any) => ({
        date: row.date,
        weight_kg: Number(row.weight_kg || 0),
        challans: Number(row.challans || 0),
      })),
    [dispatchReport]
  )

  const customerBars = useMemo(
    () =>
      (dispatchReport?.by_customer || []).map((row: any) => ({
        customer: row.customer,
        weight_kg: Number(row.weight_kg || 0),
      })),
    [dispatchReport]
  )

  const recentChallans = dispatchReport?.recent_challans || []
  const transitRows = (transitReport?.rows || []).slice(0, 5)

  return (
    <div className="min-h-screen space-y-8 bg-[radial-gradient(circle_at_top,#e2e8f0_0%,#f8fafc_35%,#f8fafc_100%)] p-6 lg:p-10">
      <section className="overflow-hidden rounded-[2rem] border border-slate-200/70 bg-slate-950 px-6 py-7 text-white shadow-[0_30px_90px_-48px_rgba(15,23,42,0.85)]">
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-cyan-200">
              <Truck className="h-3.5 w-3.5" />
              Live Logistics Truth
            </div>
            <div>
              <h1 className="text-4xl font-black tracking-tight">Dispatch, packing, and transit control</h1>
              <p className="mt-2 max-w-3xl text-sm font-medium text-slate-300">
                This surface now reads from live challan and inter-plant evidence. No synthetic freight graphs, no placeholder lane mix, only dispatch and transit state the team can operate from.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button asChild className="h-12 rounded-2xl bg-cyan-500 px-6 font-bold text-slate-950 hover:bg-cyan-400">
              <Link href="/logistics/dispatch">
                Open Dispatch Bay
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" className="h-12 rounded-2xl border-slate-700 bg-slate-900 px-6 text-slate-100 hover:bg-slate-800">
              <Link href="/logistics/transit">Open Transit Board</Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Draft challans"
          value={loading ? "..." : Number(summary.pending || 0)}
          helper="Open outbound paperwork still waiting in dispatch."
          tone="bg-amber-50 text-amber-700"
          icon={Package}
        />
        <KpiCard
          label="In transit"
          value={loading ? "..." : Number(transitSummary.in_transit || 0)}
          helper="Inter-plant challans still on the road."
          tone="bg-cyan-50 text-cyan-700"
          icon={Waypoints}
        />
        <KpiCard
          label="Dispatched challans"
          value={loading ? "..." : Number(summary.dispatched || 0)}
          helper="Outbound challans already moved into dispatch execution."
          tone="bg-emerald-50 text-emerald-700"
          icon={CheckCircle2}
        />
        <KpiCard
          label="Dispatch weight"
          value={loading ? "..." : `${Number(summary.total_weight_kg || 0).toFixed(1)} kg`}
          helper="Total shipped weight inside the current report window."
          tone="bg-indigo-50 text-indigo-700"
          icon={Boxes}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <Card className="rounded-[2rem] border border-slate-200/80 bg-white shadow-sm">
          <CardHeader className="border-b border-slate-100 pb-4">
            <CardTitle className="flex items-center gap-2 text-lg font-black tracking-tight text-slate-950">
              <Activity className="h-5 w-5 text-cyan-600" />
              Dispatch weight trend
            </CardTitle>
          </CardHeader>
          <CardContent className="h-[320px] p-6">
            {loading ? (
              <Skeleton className="h-full w-full rounded-[1.5rem]" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={dailyTrend} margin={{ top: 10, right: 10, left: -12, bottom: 0 }}>
                  <defs>
                    <linearGradient id="dispatchWeight" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#e2e8f0" vertical={false} strokeDasharray="3 3" />
                  <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "#64748b", fontWeight: 600 }} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "#64748b", fontWeight: 600 }} />
                  <Tooltip />
                  <Area dataKey="weight_kg" type="monotone" stroke="#0891b2" strokeWidth={3} fill="url(#dispatchWeight)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-[2rem] border border-slate-200/80 bg-white shadow-sm">
          <CardHeader className="border-b border-slate-100 pb-4">
            <CardTitle className="flex items-center gap-2 text-lg font-black tracking-tight text-slate-950">
              <Factory className="h-5 w-5 text-indigo-600" />
              Top dispatch customers
            </CardTitle>
          </CardHeader>
          <CardContent className="h-[320px] p-6">
            {loading ? (
              <Skeleton className="h-full w-full rounded-[1.5rem]" />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={customerBars} layout="vertical" margin={{ top: 0, right: 0, left: 20, bottom: 0 }}>
                  <CartesianGrid stroke="#e2e8f0" vertical={false} />
                  <XAxis type="number" hide />
                  <YAxis
                    type="category"
                    dataKey="customer"
                    width={110}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 12, fill: "#475569", fontWeight: 700 }}
                  />
                  <Tooltip />
                  <Bar dataKey="weight_kg" fill="#4f46e5" radius={[0, 10, 10, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <Card className="rounded-[2rem] border border-slate-200/80 bg-white shadow-sm">
          <CardHeader className="border-b border-slate-100 pb-4">
            <CardTitle className="text-lg font-black tracking-tight text-slate-950">Latest challans</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-6">
            {loading ? (
              <>
                <Skeleton className="h-20 w-full rounded-[1.5rem]" />
                <Skeleton className="h-20 w-full rounded-[1.5rem]" />
              </>
            ) : recentChallans.length ? (
              recentChallans.map((row: any) => (
                <div key={row.dc_no} className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-base font-black tracking-tight text-slate-950">{row.dc_no}</div>
                      <div className="mt-1 text-sm font-medium text-slate-500">{row.customer || "Unknown customer"}</div>
                    </div>
                    <div className="rounded-full bg-slate-900 px-3 py-1 text-[11px] font-black uppercase tracking-[0.2em] text-white">
                      {String(row.status || "").replace(/_/g, " ")}
                    </div>
                  </div>
                  <div className="mt-3 text-sm font-semibold text-slate-600">Vehicle: {row.vehicle || "-"}</div>
                </div>
              ))
            ) : (
              <div className="rounded-[1.5rem] border border-dashed border-slate-300 p-6 text-sm font-medium text-slate-500">
                No challans found for the selected window.
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-[2rem] border border-slate-200/80 bg-white shadow-sm">
          <CardHeader className="border-b border-slate-100 pb-4">
            <CardTitle className="text-lg font-black tracking-tight text-slate-950">Inter-plant live lanes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-6">
            {loading ? (
              <>
                <Skeleton className="h-20 w-full rounded-[1.5rem]" />
                <Skeleton className="h-20 w-full rounded-[1.5rem]" />
              </>
            ) : transitRows.length ? (
              transitRows.map((row: any) => (
                <div key={row.challan_id} className="rounded-[1.5rem] border border-slate-200 bg-slate-50/80 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-base font-black tracking-tight text-slate-950">{row.dc_no}</div>
                      <div className="mt-1 text-sm font-medium text-slate-500">
                        {row.from_plant || "Unknown"} {"->"} {row.to_plant || "Unknown"}
                      </div>
                    </div>
                    <div className="rounded-full bg-cyan-50 px-3 py-1 text-[11px] font-black uppercase tracking-[0.2em] text-cyan-700">
                      {String(row.status || "").replace(/_/g, " ")}
                    </div>
                  </div>
                  <div className="mt-3 text-sm font-semibold text-slate-600">
                    Dispatched {Number(row.dispatched_kg || 0).toFixed(3)} kg
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-[1.5rem] border border-dashed border-slate-300 p-6 text-sm font-medium text-slate-500">
                No inter-plant challans found for the selected window.
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  )
}

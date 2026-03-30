"use client"

import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Activity,
  ArrowRight,
  Boxes,
  ClipboardList,
  Factory,
  RefreshCw,
  Send,
  ShieldCheck,
  Truck,
  Users,
} from "lucide-react"
import {
  Bar,
  BarChart,
  CartesianGrid,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Cell,
} from "recharts"

import { analyticsApi } from "@/services/analytics"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { getApiErrorStatus } from "@/lib/api"
import { ReportStateBanner, hasMeaningfulData, toNullableNumber } from "@/components/analytics/report-state"

function fmt(value: unknown, decimals = 1) {
  if (value === null || value === undefined || value === "") return "—"
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric.toLocaleString("en-IN", { maximumFractionDigits: decimals }) : "—"
}

const CATEGORY_ICONS: Record<string, any> = {
  Operations: Factory,
  Performance: Activity,
  "Supply Chain": Truck,
  Sales: Users,
  Planning: ClipboardList,
}

export default function AnalyticsPage() {
  const queryClient = useQueryClient()
  const summaryQuery = useQuery({
    queryKey: ["analytics-dashboard-summary"],
    queryFn: () => analyticsApi.getDashboardSummary(),
    refetchInterval: 30_000,
    staleTime: 20_000,
  })
  const catalogQuery = useQuery({
    queryKey: ["analytics-report-catalog"],
    queryFn: () => analyticsApi.getCatalog(),
    staleTime: 60_000,
  })
  const profilesQuery = useQuery({
    queryKey: ["report-distributions"],
    queryFn: analyticsApi.getReportDistributions,
    refetchInterval: 30_000,
    staleTime: 20_000,
    retry: (failureCount, error) => getApiErrorStatus(error) !== 403 && failureCount < 2,
  })
  const runsQuery = useQuery({
    queryKey: ["report-runs", 10],
    queryFn: () => analyticsApi.getReportRuns(10),
    refetchInterval: 30_000,
    staleTime: 15_000,
    retry: (failureCount, error) => getApiErrorStatus(error) !== 403 && failureCount < 2,
  })
  const sendMutation = useMutation({
    mutationFn: async (reportCode: string) => analyticsApi.sendReportDistribution(reportCode),
    onSuccess: (run) => {
      queryClient.invalidateQueries({ queryKey: ["analytics-dashboard-summary"] })
      queryClient.invalidateQueries({ queryKey: ["report-runs"] })
      if (run) {
        queryClient.setQueryData(["report-runs", 10], (current: any) => {
          const nextRuns = Array.isArray(current) ? current : []
          return [run, ...nextRuns.filter((row: any) => String(row?.id || "") !== String(run.id || ""))].slice(0, 10)
        })
      }
    },
  })

  const summary = summaryQuery.data || {}
  const metrics = summary.metrics || {}
  const trends = summary.trends || {}
  const snapshots = summary.snapshots || {}
  const routeReuse = snapshots.route_reuse_mix || {}
  const podKpis = snapshots.pod_kpis || {}
  const userActivity = snapshots.user_activity || {}
  const topSkus = Array.isArray(snapshots.top_skus) ? snapshots.top_skus : []
  const topCustomers = Array.isArray(snapshots.top_customers) ? snapshots.top_customers : []
  const riskSignals = Array.isArray(snapshots.risk_signals) ? snapshots.risk_signals : []
  const plannerSourceMix = snapshots.planner_source_mix || {}
  const reportRuns = snapshots.recent_reports || []
  const recentRuns = Array.isArray(runsQuery.data) && runsQuery.data.length ? runsQuery.data : reportRuns
  const profiles = Array.isArray(profilesQuery.data) ? profilesQuery.data : []
  const catalog = Array.isArray(catalogQuery.data) ? catalogQuery.data : []
  const hasSummary = hasMeaningfulData([metrics, trends, snapshots, recentRuns])
  const summaryDegraded = summaryQuery.isError || catalogQuery.isError
  const supportDegraded = profilesQuery.isError || runsQuery.isError
  const isDegraded = summaryDegraded || supportDegraded
  const reportAdminLocked = getApiErrorStatus(profilesQuery.error) === 403 || getApiErrorStatus(runsQuery.error) === 403
  const productionTrend = Array.isArray(trends.production)
    ? trends.production.map((row: any) => ({
        label: String(row.date || "").slice(5) || "—",
        value: toNullableNumber(row.quantity ?? row.count ?? row.value),
      })).filter((row: any) => row.value !== null)
    : []
  const salesTrend = Array.isArray(trends.sales)
    ? trends.sales.map((row: any) => ({
        label: String(row.date || "").slice(5) || "—",
        value: toNullableNumber(row.weight ?? row.value),
      })).filter((row: any) => row.value !== null)
    : []
  const scrapReasons = Array.isArray(trends.scrap_reasons)
    ? trends.scrap_reasons.map((row: any) => ({
        name: String(row.reason || row.name || "Other"),
        value: toNullableNumber(row.total ?? row.value),
      })).filter((row: any) => row.value !== null)
    : []
  const plannerSourceData = [
    { name: "Direct FG", value: toNullableNumber(plannerSourceMix.direct_fg_orders), color: "#4f46e5" },
    { name: "Invariant", value: toNullableNumber(plannerSourceMix.invariant_orders), color: "#0891b2" },
    { name: "Upstream", value: toNullableNumber(plannerSourceMix.upstream_orders), color: "#16a34a" },
    { name: "Fresh Make", value: toNullableNumber(plannerSourceMix.fresh_make_orders), color: "#f59e0b" },
  ].filter((row) => row.value !== null)
  const reportCards = [
    { label: "OEE", value: `${fmt(metrics.oee, 1)}%`, hint: "Execution effectiveness" },
    { label: "Scrap Rate", value: `${fmt(metrics.scrap_rate, 1)}%`, hint: "Audit-backed quality loss" },
    { label: "Utilization", value: `${fmt(metrics.utilization, 1)}%`, hint: "Machine use ratio" },
    { label: "Efficiency", value: `${fmt(metrics.efficiency, 1)}%`, hint: "Operational score" },
    { label: "Revenue", value: `₹${fmt(metrics.revenue, 0)}`, hint: "From live control-tower metrics" },
    { label: "Output", value: `${fmt(metrics.production_output_kg, 0)} KG`, hint: "Current production period" },
  ]

  return (
    <div className="space-y-8 pb-8">
      <section className="rounded-[2rem] border border-slate-200/70 bg-[linear-gradient(140deg,#0f172a,#172554_42%,#1d4ed8_100%)] px-6 py-7 text-white shadow-[0_32px_100px_rgba(15,23,42,0.18)]">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-cyan-100">
              <ShieldCheck className="h-3.5 w-3.5" />
              Reports Hub
            </div>
            <div>
              <h1 className="text-4xl font-black tracking-tight">Analytics and Reports Hub</h1>
              <p className="mt-2 max-w-3xl text-sm font-medium text-slate-200">
                SKU-aware, POD-aware, and audit-aware reporting across sales, planning, production, and dispatch.
              </p>
            </div>
          </div>
          <Button variant="secondary" onClick={() => Promise.all([summaryQuery.refetch(), catalogQuery.refetch()])} disabled={summaryQuery.isFetching || catalogQuery.isFetching} className="rounded-full border-none bg-white/90 text-slate-900 hover:bg-white">
            <RefreshCw className={`h-4 w-4 ${(summaryQuery.isFetching || catalogQuery.isFetching) ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </section>

      {summaryQuery.isError ? (
        <Card className="rounded-[1.7rem] border border-rose-200 bg-rose-50/90 shadow-sm">
          <CardContent className="p-5 text-sm font-semibold text-rose-700">
            Reports Hub could not load live analytics. The backend request failed, so KPI cards and report signals are intentionally paused instead of showing misleading zeroes.
          </CardContent>
        </Card>
      ) : null}

      {catalogQuery.isError ? (
        <Card className="rounded-[1.7rem] border border-rose-200 bg-rose-50/90 shadow-sm">
          <CardContent className="p-5 text-sm font-semibold text-rose-700">
            Report catalog data could not be loaded. The report list is paused instead of showing a false empty state.
          </CardContent>
        </Card>
      ) : null}

      {supportDegraded ? (
        <ReportStateBanner
          title="Report activity degraded"
          message="Recent report runs or distribution profiles could not be loaded. Existing seeded data is still shown where available, but missing values are intentionally left blank instead of being replaced with fake zeros."
          actionLabel="Refresh"
          onAction={() => Promise.all([summaryQuery.refetch(), catalogQuery.refetch(), profilesQuery.refetch(), runsQuery.refetch()])}
        />
      ) : null}

      {!summaryQuery.isLoading && !summaryQuery.isError && !hasSummary ? (
        <Card className="rounded-[1.7rem] border border-amber-200 bg-amber-50/90 shadow-sm">
          <CardContent className="p-5 text-sm font-semibold text-amber-800">
            Reports Hub is live but does not have seeded telemetry yet. Run the green seed and controlled telemetry steps to populate SKU, POD, route-reuse, and report-run analytics.
          </CardContent>
        </Card>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        {reportCards.map((card) => (
          <SummaryCard key={card.label} label={card.label} value={card.value} hint={card.hint} />
        ))}
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="rounded-[1.85rem] border border-slate-200/80 bg-white/95 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xl font-black tracking-tight text-slate-900">Live Reporting Signals</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <SignalRow title="Final Roll Pool" value={`${fmt(routeReuse.final_roll_kg, 0)} KG`} hint="Direct FG-capable roll stock" />
            <SignalRow title="Invariant Pool" value={`${fmt(routeReuse.invariant_roll_kg, 0)} KG`} hint="Matching intermediate reuse stock" />
            <SignalRow title="Upstream Pool" value={`${fmt(routeReuse.upstream_roll_kg, 0)} KG`} hint="Downstream-compatible upstream roll stock" />
            <SignalRow title="POD Stock Target" value={`${fmt(podKpis.bulk_target_kg, 0)} KG`} hint={`${fmt(podKpis.bulk_orders, 0)} planned POD stock order(s)`} />
            <SignalRow title="Active POD SKUs" value={fmt(podKpis.active_pod_skus, 0)} hint={`${fmt(podKpis.active_pod_variants, 0)} active variants`} />
            <SignalRow title="Recent Report Runs" value={fmt(reportRuns.length, 0)} hint="Latest seeded/report-distribution activity" />
          </CardContent>
        </Card>

        <Card className="rounded-[1.85rem] border border-slate-200/80 bg-white/95 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xl font-black tracking-tight text-slate-900">Throughput Leaders</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {Array.isArray(userActivity.execution) && userActivity.execution.length ? userActivity.execution.slice(0, 5).map((row: any) => (
              <div key={row.username} className="rounded-[1.2rem] border border-slate-200 bg-slate-50/80 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-black text-slate-900">{row.username}</div>
                    <div className="text-xs font-semibold text-slate-500">{fmt(row.events, 0)} execution event(s)</div>
                  </div>
                  <div className="text-sm font-black text-indigo-700">{fmt(row.output_kg, 0)} KG</div>
                </div>
              </div>
            )) : (
              <div className="rounded-[1.35rem] border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm font-semibold text-slate-500">
                No execution telemetry has been seeded yet. The green runner now injects controlled telemetry so this section fills on the next full release pass.
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="rounded-[1.85rem] border border-slate-200/80 bg-white/95 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xl font-black tracking-tight text-slate-900">Live Trendboard</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5 lg:grid-cols-2">
            <div className="space-y-3 rounded-[1.35rem] border border-slate-200 bg-slate-50/70 p-4">
              <div>
                <div className="text-sm font-black text-slate-900">Production Output</div>
                <div className="text-xs font-semibold text-slate-500">7-day output from seeded execution and production truth.</div>
              </div>
              {productionTrend.length ? (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={productionTrend}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                      <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" />
                      <Tooltip />
                      <Bar dataKey="value" radius={[8, 8, 0, 0]} fill="#4f46e5" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <EmptyPanel text="No production trend is available for the current seed window." />
              )}
            </div>

            <div className="space-y-3 rounded-[1.35rem] border border-slate-200 bg-slate-50/70 p-4">
              <div>
                <div className="text-sm font-black text-slate-900">Sales Weight Mix</div>
                <div className="text-xs font-semibold text-slate-500">Daily shipped/order-weight demand from the control-tower sales layer.</div>
              </div>
              {salesTrend.length ? (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={salesTrend}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                      <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" />
                      <Tooltip />
                      <Bar dataKey="value" radius={[8, 8, 0, 0]} fill="#0f766e" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <EmptyPanel text="No sales trend is available for the current seed window." />
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-[1.85rem] border border-slate-200/80 bg-white/95 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xl font-black tracking-tight text-slate-900">Reuse and Exception Signals</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-[1.35rem] border border-slate-200 bg-slate-50/70 p-4">
              <div className="text-sm font-black text-slate-900">Planner Source Mix</div>
              <div className="mt-1 text-xs font-semibold text-slate-500">How current demand is being satisfied across direct FG, invariant reuse, upstream reuse, and fresh make.</div>
              {plannerSourceData.length ? (
                <div className="mt-3 h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={plannerSourceData} dataKey="value" nameKey="name" innerRadius={48} outerRadius={78} paddingAngle={3}>
                        {plannerSourceData.map((entry) => (
                          <Cell key={entry.name} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <EmptyPanel text="Planner source mix is still building. Fresh, invariant, and upstream allocations will appear here as soon as route decisions are logged." />
              )}
            </div>

            <div className="rounded-[1.35rem] border border-slate-200 bg-slate-50/70 p-4">
              <div className="text-sm font-black text-slate-900">Audit-Backed Exceptions</div>
              <div className="mt-1 text-xs font-semibold text-slate-500">Compliance and risk signals captured from the normalized audit layer.</div>
              <div className="mt-3 space-y-2">
                {riskSignals.length ? riskSignals.slice(0, 5).map((signal: any, index: number) => (
                  <div key={`${signal.code || signal.message}-${index}`} className="rounded-2xl border border-slate-200 bg-white px-3 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-black text-slate-900">{signal.message || signal.code || "Audit signal"}</div>
                      <Badge variant="outline" className="rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em]">
                        {signal.severity || "INFO"}
                      </Badge>
                    </div>
                  </div>
                )) : (
                  <EmptyPanel text="No open audit or traceability exceptions are flagged right now." />
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <Card className="rounded-[1.85rem] border border-slate-200/80 bg-white/95 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xl font-black tracking-tight text-slate-900">SKU and Customer Leaders</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3">
              <div className="text-sm font-black text-slate-900">Top SKU performers</div>
              {topSkus.length ? topSkus.slice(0, 5).map((row: any) => (
                <div key={row.sku_name} className="rounded-[1.2rem] border border-slate-200 bg-slate-50/80 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-black text-slate-900">{row.sku_name}</div>
                      <div className="text-xs font-semibold text-slate-500">{fmt(row.orders, 0)} orders · {fmt(row.repeat_orders, 0)} repeat</div>
                    </div>
                    <div className="text-sm font-black text-indigo-700">{fmt(row.weight_kg, 1)} KG</div>
                  </div>
                </div>
              )) : (
                <EmptyPanel text="SKU-wise performance will populate here as soon as seeded orders are visible to analytics." />
              )}
            </div>

            <div className="space-y-3">
              <div className="text-sm font-black text-slate-900">Top customers</div>
              {topCustomers.length ? topCustomers.slice(0, 5).map((row: any) => (
                <div key={row.customer_name} className="rounded-[1.2rem] border border-slate-200 bg-slate-50/80 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-black text-slate-900">{row.customer_name}</div>
                      <div className="text-xs font-semibold text-slate-500">{fmt(row.order_count, 0)} orders</div>
                    </div>
                    <div className="text-sm font-black text-emerald-700">{fmt(row.total_weight, 1)} KG</div>
                  </div>
                </div>
              )) : (
                <EmptyPanel text="Customer leaders will populate here after the seeded sales and quotation run is visible to analytics." />
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-[1.85rem] border border-slate-200/80 bg-white/95 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xl font-black tracking-tight text-slate-900">Scrap Reason Mix</CardTitle>
          </CardHeader>
          <CardContent>
            {scrapReasons.length ? (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={scrapReasons}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                    <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" />
                    <Tooltip />
                    <Bar dataKey="value" radius={[8, 8, 0, 0]} fill="#e11d48" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyPanel text="No scrap reasons are available for the current period." />
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <Card className="rounded-[1.85rem] border border-slate-200/80 bg-white/95 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xl font-black tracking-tight text-slate-900">Available Reports</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            {catalog.length > 0 && !summaryDegraded ? catalog.map((report: any) => {
              const Icon = CATEGORY_ICONS[report.category] || Boxes
              return (
                <Link key={report.id} href={`/analytics/reports/${report.id === "inventory-lineage" ? "inventory" : report.id}`} className="block rounded-[1.35rem] border border-slate-200 bg-slate-50/80 p-5 transition hover:border-slate-300 hover:bg-white">
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <div className="rounded-2xl bg-slate-900 p-2 text-white"><Icon className="h-4 w-4" /></div>
                        <div className="text-sm font-black text-slate-900">{report.title}</div>
                      </div>
                      <div className="text-sm font-medium text-slate-500">{report.description}</div>
                      <Badge variant="outline" className="rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em]">{report.category}</Badge>
                    </div>
                    <ArrowRight className="h-4 w-4 text-slate-400" />
                  </div>
                </Link>
              )
            }) : !catalogQuery.isError ? (
              <div className="col-span-full rounded-[1.35rem] border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm font-semibold text-slate-500">
                No report catalog entries are available for the current role.
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="rounded-[1.85rem] border border-slate-200/80 bg-white/95 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xl font-black tracking-tight text-slate-900">Recent Report Activity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {supportDegraded ? (
              <div className="rounded-[1.35rem] border border-amber-200 bg-amber-50 px-4 py-6 text-sm font-semibold text-amber-800">
                Recent report activity is degraded. The dashboard keeps this state explicit instead of replacing it with a fake empty list.
              </div>
            ) : recentRuns.length ? recentRuns.map((run: any, index: number) => (
              <div key={`${run.report_code}-${run.created_at}`} className="rounded-[1.2rem] border border-slate-200 bg-slate-50/80 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-black text-slate-900">{run.report_code}</div>
                    <div className="text-xs font-semibold text-slate-500">
                      {index === 0 ? "Latest run" : "Recent run"} · {run.report_date} · {run.created_at}
                    </div>
                  </div>
                  <Badge variant="outline" className="rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em]">
                    {run.status}
                  </Badge>
                </div>
              </div>
            )) : (
              <div className="rounded-[1.35rem] border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm font-semibold text-slate-500">
                No report runs are recorded yet. Seeded report smoke and manual sends will appear here after the next release validation pass.
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <Card className="rounded-[1.85rem] border border-slate-200/80 bg-white/95 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xl font-black tracking-tight text-slate-900">Report Dispatch Control</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {reportAdminLocked ? (
              <EmptyPanel text="Report dispatch controls are restricted to admin and owner roles." />
            ) : supportDegraded ? (
              <EmptyPanel text="Report distribution profiles or report-run history are temporarily degraded. The dashboard keeps the failure explicit instead of pretending the workspace is empty." />
            ) : profiles.length ? (
              profiles.map((profile: any) => (
                <div key={profile.report_code} className="rounded-[1.2rem] border border-slate-200 bg-slate-50/80 p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <div className="text-sm font-black text-slate-900">{profile.label}</div>
                      <div className="text-xs font-semibold text-slate-500">
                        {profile.active ? "Active distribution profile" : "Paused distribution profile"} · {String(profile.schedule_hour).padStart(2, "0")}:{String(profile.schedule_minute).padStart(2, "0")}
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-full border-slate-200 bg-white"
                      disabled={!profile.active || sendMutation.isPending}
                      onClick={() => sendMutation.mutate(profile.report_code)}
                    >
                      <Send className="mr-2 h-4 w-4" />
                      {`Send ${profile.label} now`}
                    </Button>
                  </div>
                </div>
              ))
            ) : (
              <EmptyPanel text="No report distribution profiles are configured for the current workspace." />
            )}
          </CardContent>
        </Card>

        <Card className="rounded-[1.85rem] border border-slate-200/80 bg-white/95 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xl font-black tracking-tight text-slate-900">Run History Snapshot</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {recentRuns.length ? recentRuns.slice(0, 5).map((run: any, index: number) => (
              <div key={`history-${run.id || run.created_at}-${index}`} className="rounded-[1.2rem] border border-slate-200 bg-slate-50/80 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-black text-slate-900">{run.report_code}</div>
                    <div className="text-xs font-semibold text-slate-500">
                      {index === 0 ? "Latest run" : "Recent report runs"} · {run.report_date} · {run.created_at}
                    </div>
                    <div className="mt-1 text-[11px] font-semibold text-slate-500">
                      {run.triggered_manually ? "Manual send" : "Scheduled send"}{run.triggered_by ? ` · ${run.triggered_by}` : ""}
                    </div>
                  </div>
                  <Badge variant="outline" className="rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em]">
                    {run.status}
                  </Badge>
                </div>
              </div>
            )) : (
              <EmptyPanel text="Recent report runs will appear here once seeded dispatches or manual sends are available." />
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  )
}

function EmptyPanel({ text }: { text: string }) {
  return (
    <div className="rounded-[1.2rem] border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm font-semibold text-slate-500">
      {text}
    </div>
  )
}

function SummaryCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card className="rounded-[1.7rem] border border-slate-200/70 bg-white/90 shadow-sm">
      <CardContent className="p-5">
        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">{label}</div>
        <div className="mt-2 text-3xl font-black text-slate-900">{value}</div>
        <div className="mt-1 text-xs font-semibold text-slate-500">{hint}</div>
      </CardContent>
    </Card>
  )
}

function SignalRow({ title, value, hint }: { title: string; value: string; hint: string }) {
  return (
    <div className="rounded-[1.2rem] border border-slate-200 bg-slate-50/80 p-4">
      <div className="text-sm font-black text-slate-900">{title}</div>
      <div className="mt-2 text-2xl font-black text-indigo-700">{value}</div>
      <div className="mt-1 text-xs font-semibold text-slate-500">{hint}</div>
    </div>
  )
}

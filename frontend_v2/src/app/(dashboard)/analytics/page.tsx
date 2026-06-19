"use client";

import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
} from "lucide-react";
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
} from "recharts";

import { analyticsApi } from "@/services/analytics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getApiErrorStatus } from "@/lib/api";
import {
  ReportStateBanner,
  hasMeaningfulData,
  toNullableNumber,
} from "@/components/analytics/report-state";

function fmt(value: unknown, decimals = 1) {
  if (value === null || value === undefined || value === "") return "—";
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? numeric.toLocaleString("en-IN", { maximumFractionDigits: decimals })
    : "—";
}

const CATEGORY_ICONS: Record<string, any> = {
  Operations: Factory,
  Performance: Activity,
  "Supply Chain": Truck,
  Sales: Users,
  Planning: ClipboardList,
};

export default function AnalyticsPage() {
  const queryClient = useQueryClient();
  const summaryQuery = useQuery({
    queryKey: ["analytics-dashboard-summary"],
    queryFn: () => analyticsApi.getDashboardSummary(),
    refetchInterval: 120_000,
    staleTime: 90_000,
  });
  const catalogQuery = useQuery({
    queryKey: ["analytics-report-catalog"],
    queryFn: () => analyticsApi.getCatalog(),
    staleTime: 60_000,
  });
  const profilesQuery = useQuery({
    queryKey: ["report-distributions"],
    queryFn: analyticsApi.getReportDistributions,
    refetchInterval: 180_000,
    staleTime: 120_000,
    retry: (failureCount, error) =>
      getApiErrorStatus(error) !== 403 && failureCount < 2,
  });
  const runsQuery = useQuery({
    queryKey: ["report-runs", 10],
    queryFn: () => analyticsApi.getReportRuns(10),
    refetchInterval: 180_000,
    staleTime: 120_000,
    retry: (failureCount, error) =>
      getApiErrorStatus(error) !== 403 && failureCount < 2,
  });
  const sendMutation = useMutation({
    mutationFn: async (reportCode: string) =>
      analyticsApi.sendReportDistribution(reportCode),
    onSuccess: (run) => {
      queryClient.invalidateQueries({
        queryKey: ["analytics-dashboard-summary"],
      });
      queryClient.invalidateQueries({ queryKey: ["report-runs"] });
      if (run) {
        queryClient.setQueryData(["report-runs", 10], (current: any) => {
          const nextRuns = Array.isArray(current) ? current : [];
          return [
            run,
            ...nextRuns.filter(
              (row: any) => String(row?.id || "") !== String(run.id || ""),
            ),
          ].slice(0, 10);
        });
      }
    },
  });

  const summary = summaryQuery.data || {};
  const metrics = summary.metrics || {};
  const trends = summary.trends || {};
  const snapshots = summary.snapshots || {};
  const routeReuse = snapshots.route_reuse_mix || {};
  const podKpis = snapshots.pod_kpis || {};
  const userActivity = snapshots.user_activity || {};
  const topSkus = Array.isArray(snapshots.top_skus) ? snapshots.top_skus : [];
  const topCustomers = Array.isArray(snapshots.top_customers)
    ? snapshots.top_customers
    : [];
  const riskSignals = Array.isArray(snapshots.risk_signals)
    ? snapshots.risk_signals
    : [];
  const plannerSourceMix = snapshots.planner_source_mix || {};
  const reportRuns = snapshots.recent_reports || [];
  const recentRuns =
    Array.isArray(runsQuery.data) && runsQuery.data.length
      ? runsQuery.data
      : reportRuns;
  const profiles = Array.isArray(profilesQuery.data) ? profilesQuery.data : [];
  const catalog = Array.isArray(catalogQuery.data) ? catalogQuery.data : [];
  const hasSummary = hasMeaningfulData([
    metrics,
    trends,
    snapshots,
    recentRuns,
  ]);
  const summaryDegraded = summaryQuery.isError || catalogQuery.isError;
  const supportDegraded = profilesQuery.isError || runsQuery.isError;
  const isDegraded = summaryDegraded || supportDegraded;
  const reportAdminLocked =
    getApiErrorStatus(profilesQuery.error) === 403 ||
    getApiErrorStatus(runsQuery.error) === 403;
  const productionTrend = Array.isArray(trends.production)
    ? trends.production
        .map((row: any) => ({
          label: String(row.date || "").slice(5) || "—",
          value: toNullableNumber(row.quantity ?? row.count ?? row.value),
        }))
        .filter((row: any) => row.value !== null)
    : [];
  const salesTrend = Array.isArray(trends.sales)
    ? trends.sales
        .map((row: any) => ({
          label: String(row.date || "").slice(5) || "—",
          value: toNullableNumber(row.weight ?? row.value),
        }))
        .filter((row: any) => row.value !== null)
    : [];
  const scrapReasons = Array.isArray(trends.scrap_reasons)
    ? trends.scrap_reasons
        .map((row: any) => ({
          name: String(row.reason || row.name || "Other"),
          value: toNullableNumber(row.total ?? row.value),
        }))
        .filter((row: any) => row.value !== null)
    : [];
  const plannerSourceData = [
    {
      name: "Direct FG",
      value: toNullableNumber(plannerSourceMix.direct_fg_orders),
      color: "#2563eb",
    },
    {
      name: "Invariant",
      value: toNullableNumber(plannerSourceMix.invariant_orders),
      color: "#0891b2",
    },
    {
      name: "Upstream",
      value: toNullableNumber(plannerSourceMix.upstream_orders),
      color: "#16a34a",
    },
    {
      name: "Fresh Make",
      value: toNullableNumber(plannerSourceMix.fresh_make_orders),
      color: "#f59e0b",
    },
  ].filter((row) => row.value !== null);
  const reportCards = [
    {
      label: "OEE",
      value: `${fmt(metrics.oee, 1)}%`,
      hint: "Execution effectiveness",
    },
    {
      label: "Scrap Rate",
      value: `${fmt(metrics.scrap_rate, 1)}%`,
      hint: "Audit-backed quality loss",
    },
    {
      label: "Utilization",
      value: `${fmt(metrics.utilization, 1)}%`,
      hint: "Machine use ratio",
    },
    {
      label: "Efficiency",
      value: `${fmt(metrics.efficiency, 1)}%`,
      hint: "Operational score",
    },
    {
      label: "Revenue",
      value: `₹${fmt(metrics.revenue, 0)}`,
      hint: "From live control-tower metrics",
    },
    {
      label: "Output",
      value: `${fmt(metrics.production_output_kg, 0)} KG`,
      hint: "Current production period",
    },
  ];
  const operationalPulse = [
    {
      label: "OEE",
      value: Number(metrics.oee || 0),
      target: 85,
      tone: "bg-primary",
    },
    {
      label: "Utilization",
      value: Number(metrics.utilization || 0),
      target: 90,
      tone: "bg-info-fg",
    },
    {
      label: "Efficiency",
      value: Number(metrics.efficiency || 0),
      target: 92,
      tone: "bg-success-fg",
    },
    {
      label: "Scrap",
      value: Number(metrics.scrap_rate || 0),
      target: 2.5,
      inverse: true,
      tone: "bg-danger-solid",
    },
  ];

  return (
    <div className="space-y-8 pb-8">
      <section className="rounded-[2rem] border border-line bg-[linear-gradient(140deg,#0f172a,#172554_42%,#1d4ed8_100%)] px-6 py-7 text-white shadow-[0_32px_100px_rgba(15,23,42,0.18)]">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-surface-1/15 bg-surface-1/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-info-border">
              <ShieldCheck className="h-3.5 w-3.5" />
              Reports Hub
            </div>
            <div>
              <h1 className="text-4xl font-black tracking-tight">
                Analytics and Reports Hub
              </h1>
              <p className="mt-2 max-w-3xl text-sm font-medium text-content-4">
                SKU-aware, POD-aware, and audit-aware reporting across sales,
                planning, production, and dispatch.
              </p>
            </div>
          </div>
          <Button
            variant="secondary"
            onClick={() =>
              Promise.all([summaryQuery.refetch(), catalogQuery.refetch()])
            }
            disabled={summaryQuery.isFetching || catalogQuery.isFetching}
            className="rounded-full border-none bg-surface-1/90 text-content-1 hover:bg-surface-1"
          >
            <RefreshCw
              className={`h-4 w-4 ${summaryQuery.isFetching || catalogQuery.isFetching ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        </div>
      </section>

      {summaryQuery.isError ? (
        <Card className="rounded-[1.7rem] border border-danger-border bg-danger-bg shadow-sm">
          <CardContent className="p-5 text-sm font-semibold text-danger-fg">
            Reports Hub could not load live analytics. The backend request
            failed, so KPI cards and report signals are intentionally paused
            instead of showing misleading zeroes.
          </CardContent>
        </Card>
      ) : null}

      {catalogQuery.isError ? (
        <Card className="rounded-[1.7rem] border border-danger-border bg-danger-bg shadow-sm">
          <CardContent className="p-5 text-sm font-semibold text-danger-fg">
            Report catalog data could not be loaded. The report list is paused
            instead of showing a false empty state.
          </CardContent>
        </Card>
      ) : null}

      {supportDegraded ? (
        <ReportStateBanner
          title="Report activity degraded"
          message="Recent report runs or distribution profiles could not be loaded. Existing seeded data is still shown where available, but missing values are intentionally left blank instead of being replaced with fake zeros."
          actionLabel="Refresh"
          onAction={() =>
            Promise.all([
              summaryQuery.refetch(),
              catalogQuery.refetch(),
              profilesQuery.refetch(),
              runsQuery.refetch(),
            ])
          }
        />
      ) : null}

      {!summaryQuery.isLoading && !summaryQuery.isError && !hasSummary ? (
        <Card className="rounded-[1.7rem] border border-warning-border bg-warning-bg shadow-sm">
          <CardContent className="p-5 text-sm font-semibold text-warning-fg">
            Reports Hub is live but does not have seeded telemetry yet. Run the
            green seed and controlled telemetry steps to populate SKU, POD,
            route-reuse, and report-run analytics.
          </CardContent>
        </Card>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        {reportCards.map((card) => (
          <SummaryCard
            key={card.label}
            label={card.label}
            value={card.value}
            hint={card.hint}
          />
        ))}
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="rounded-[1.85rem] border border-line bg-surface-1/95 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xl font-black tracking-tight text-content-1">
              Live Reporting Signals
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <SignalRow
              title="Final Roll Pool"
              value={`${fmt(routeReuse.final_roll_kg, 0)} KG`}
              hint="Direct FG-capable roll stock"
            />
            <SignalRow
              title="Invariant Pool"
              value={`${fmt(routeReuse.invariant_roll_kg, 0)} KG`}
              hint="Matching intermediate reuse stock"
            />
            <SignalRow
              title="Upstream Pool"
              value={`${fmt(routeReuse.upstream_roll_kg, 0)} KG`}
              hint="Downstream-compatible upstream roll stock"
            />
            <SignalRow
              title="POD Stock Target"
              value={`${fmt(podKpis.bulk_target_kg, 0)} KG`}
              hint={`${fmt(podKpis.bulk_orders, 0)} planned POD stock order(s)`}
            />
            <SignalRow
              title="Active POD SKUs"
              value={fmt(podKpis.active_pod_skus, 0)}
              hint={`${fmt(podKpis.active_pod_variants, 0)} active variants`}
            />
            <SignalRow
              title="Recent Report Runs"
              value={fmt(reportRuns.length, 0)}
              hint="Latest seeded/report-distribution activity"
            />
          </CardContent>
        </Card>

        <Card className="rounded-[1.85rem] border border-line bg-surface-1/95 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xl font-black tracking-tight text-content-1">
              Throughput Leaders
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {Array.isArray(userActivity.execution) &&
            userActivity.execution.length ? (
              userActivity.execution.slice(0, 5).map((row: any) => (
                <div
                  key={row.username}
                  className="rounded-[1.2rem] border border-line bg-surface-2 p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-black text-content-1">
                        {row.username}
                      </div>
                      <div className="text-xs font-semibold text-content-3">
                        {fmt(row.events, 0)} execution event(s)
                      </div>
                    </div>
                    <div className="text-sm font-black text-primary">
                      {fmt(row.output_kg, 0)} KG
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-[1.35rem] border border-dashed border-line bg-surface-2 px-4 py-6 text-sm font-semibold text-content-3">
                No execution telemetry has been seeded yet. The green runner now
                injects controlled telemetry so this section fills on the next
                full release pass.
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="rounded-[1.85rem] border border-line bg-surface-1/95 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xl font-black tracking-tight text-content-1">
              Live Trendboard
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5 lg:grid-cols-2">
            <div className="space-y-3 rounded-[1.35rem] border border-line bg-surface-2 p-4">
              <div>
                <div className="text-sm font-black text-content-1">
                  Production Output
                </div>
                <div className="text-xs font-semibold text-content-3">
                  7-day output from seeded execution and production truth.
                </div>
              </div>
              {productionTrend.length ? (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={productionTrend}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 11 }}
                        stroke="#94a3b8"
                      />
                      <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" />
                      <Tooltip />
                      <Bar
                        dataKey="value"
                        radius={[8, 8, 0, 0]}
                        fill="#2563eb"
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <EmptyPanel text="No production trend is available for the current seed window." />
              )}
            </div>

            <div className="space-y-3 rounded-[1.35rem] border border-line bg-surface-2 p-4">
              <div>
                <div className="text-sm font-black text-content-1">
                  Sales Weight Mix
                </div>
                <div className="text-xs font-semibold text-content-3">
                  Daily shipped/order-weight demand from the control-tower sales
                  layer.
                </div>
              </div>
              {salesTrend.length ? (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={salesTrend}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis
                        dataKey="label"
                        tick={{ fontSize: 11 }}
                        stroke="#94a3b8"
                      />
                      <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" />
                      <Tooltip />
                      <Bar
                        dataKey="value"
                        radius={[8, 8, 0, 0]}
                        fill="#0f766e"
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <EmptyPanel text="No sales trend is available for the current seed window." />
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-[1.85rem] border border-line bg-surface-1/95 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xl font-black tracking-tight text-content-1">
              Reuse and Exception Signals
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-[1.35rem] border border-line bg-surface-2 p-4">
              <div className="text-sm font-black text-content-1">
                Planner Source Mix
              </div>
              <div className="mt-1 text-xs font-semibold text-content-3">
                How current demand is being satisfied across direct FG,
                invariant reuse, upstream reuse, and fresh make.
              </div>
              {plannerSourceData.length ? (
                <div className="mt-3 h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={plannerSourceData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={48}
                        outerRadius={78}
                        paddingAngle={3}
                      >
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

            <div className="rounded-[1.35rem] border border-line bg-surface-2 p-4">
              <div className="text-sm font-black text-content-1">
                Audit-Backed Exceptions
              </div>
              <div className="mt-1 text-xs font-semibold text-content-3">
                Compliance and risk signals captured from the normalized audit
                layer.
              </div>
              <div className="mt-3 space-y-2">
                {riskSignals.length ? (
                  riskSignals.slice(0, 5).map((signal: any, index: number) => (
                    <div
                      key={`${signal.code || signal.message}-${index}`}
                      className="rounded-2xl border border-line bg-surface-1 px-3 py-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-black text-content-1">
                          {signal.message || signal.code || "Audit signal"}
                        </div>
                        <Badge
                          variant="outline"
                          className="rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em]"
                        >
                          {signal.severity || "INFO"}
                        </Badge>
                      </div>
                    </div>
                  ))
                ) : (
                  <EmptyPanel text="No open audit or traceability exceptions are flagged right now." />
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <Card className="rounded-[1.85rem] border border-line bg-surface-1/95 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xl font-black tracking-tight text-content-1">
              SKU and Customer Leaders
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            <div className="space-y-3">
              <div className="text-sm font-black text-content-1">
                Top SKU performers
              </div>
              {topSkus.length ? (
                topSkus.slice(0, 5).map((row: any) => (
                  <div
                    key={row.sku_name}
                    className="rounded-[1.2rem] border border-line bg-surface-2 p-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-black text-content-1">
                          {row.sku_name}
                        </div>
                        <div className="text-xs font-semibold text-content-3">
                          {fmt(row.orders, 0)} orders ·{" "}
                          {fmt(row.repeat_orders, 0)} repeat
                        </div>
                      </div>
                      <div className="text-sm font-black text-primary">
                        {fmt(row.weight_kg, 1)} KG
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <EmptyPanel text="SKU-wise performance will populate here as soon as seeded orders are visible to analytics." />
              )}
            </div>

            <div className="space-y-3">
              <div className="text-sm font-black text-content-1">
                Top customers
              </div>
              {topCustomers.length ? (
                topCustomers.slice(0, 5).map((row: any) => (
                  <div
                    key={row.customer_name}
                    className="rounded-[1.2rem] border border-line bg-surface-2 p-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-black text-content-1">
                          {row.customer_name}
                        </div>
                        <div className="text-xs font-semibold text-content-3">
                          {fmt(row.order_count, 0)} orders
                        </div>
                      </div>
                      <div className="text-sm font-black text-success-fg">
                        {fmt(row.total_weight, 1)} KG
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <EmptyPanel text="Customer leaders will populate here after the seeded sales and quotation run is visible to analytics." />
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-[1.85rem] border border-line bg-surface-1/95 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xl font-black tracking-tight text-content-1">
              Operational KPI Pulse
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {operationalPulse.map((metric) => {
              const normalizedTarget = metric.inverse ? metric.target : 100;
              const pct = metric.inverse
                ? Math.max(
                    0,
                    Math.min(
                      100,
                      100 - (metric.value / Math.max(metric.target, 1)) * 100,
                    ),
                  )
                : Math.max(
                    0,
                    Math.min(
                      100,
                      (metric.value / Math.max(normalizedTarget, 1)) * 100,
                    ),
                  );
              return (
                <div
                  key={metric.label}
                  className="rounded-[1.2rem] border border-line bg-surface-2 p-4"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-black text-content-1">
                        {metric.label}
                      </div>
                      <div className="text-xs font-semibold text-content-3">
                        {metric.inverse
                          ? `Target <= ${metric.target}%`
                          : `Target ${metric.target}%`}
                      </div>
                    </div>
                    <div className="text-lg font-black text-content-1">
                      {metric.value.toLocaleString("en-IN", {
                        maximumFractionDigits: 1,
                      })}
                      %
                    </div>
                  </div>
                  <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-surface-1">
                    <div
                      className={metric.tone}
                      style={{ width: `${pct}%`, height: "100%" }}
                    />
                  </div>
                </div>
              );
            })}
            {scrapReasons.length ? (
              <div className="rounded-[1.2rem] border border-line bg-surface-1 p-4">
                <div className="mb-3 text-sm font-black text-content-1">
                  Quality-loss mix
                </div>
                <div className="h-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={scrapReasons.slice(0, 5)}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis
                        dataKey="name"
                        tick={{ fontSize: 10 }}
                        stroke="#94a3b8"
                      />
                      <YAxis tick={{ fontSize: 10 }} stroke="#94a3b8" />
                      <Tooltip />
                      <Bar
                        dataKey="value"
                        radius={[8, 8, 0, 0]}
                        fill="#e11d48"
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <Card className="rounded-[1.85rem] border border-line bg-surface-1/95 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xl font-black tracking-tight text-content-1">
              Available Reports
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2">
            {catalog.length > 0 && !summaryDegraded ? (
              catalog.map((report: any) => {
                const Icon = CATEGORY_ICONS[report.category] || Boxes;
                return (
                  <Link
                    key={report.id}
                    href={`/analytics/reports/${report.id === "inventory-lineage" ? "inventory" : report.id}`}
                    className="block rounded-[1.35rem] border border-line bg-surface-2 p-5 transition hover:border-line-strong hover:bg-surface-1"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <div className="rounded-2xl bg-surface-3 p-2 text-white">
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="text-sm font-black text-content-1">
                            {report.title}
                          </div>
                        </div>
                        <div className="text-sm font-medium text-content-3">
                          {report.description}
                        </div>
                        <Badge
                          variant="outline"
                          className="rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em]"
                        >
                          {report.category}
                        </Badge>
                      </div>
                      <ArrowRight className="h-4 w-4 text-content-4" />
                    </div>
                  </Link>
                );
              })
            ) : !catalogQuery.isError ? (
              <div className="col-span-full rounded-[1.35rem] border border-dashed border-line bg-surface-2 px-4 py-6 text-sm font-semibold text-content-3">
                No report catalog entries are available for the current role.
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="rounded-[1.85rem] border border-line bg-surface-1/95 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xl font-black tracking-tight text-content-1">
              Recent Report Activity
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {supportDegraded ? (
              <div className="rounded-[1.35rem] border border-warning-border bg-warning-bg px-4 py-6 text-sm font-semibold text-warning-fg">
                Recent report activity is degraded. The dashboard keeps this
                state explicit instead of replacing it with a fake empty list.
              </div>
            ) : recentRuns.length ? (
              recentRuns.map((run: any, index: number) => (
                <div
                  key={`${run.report_code}-${run.created_at}`}
                  className="rounded-[1.2rem] border border-line bg-surface-2 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-black text-content-1">
                        {run.report_code}
                      </div>
                      <div className="text-xs font-semibold text-content-3">
                        {index === 0 ? "Latest run" : "Recent run"} ·{" "}
                        {run.report_date} · {run.created_at}
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className="rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em]"
                    >
                      {run.status}
                    </Badge>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-[1.35rem] border border-dashed border-line bg-surface-2 px-4 py-6 text-sm font-semibold text-content-3">
                No report runs are recorded yet. Daily archive generations will
                appear here after the next release validation pass.
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <Card className="rounded-[1.85rem] border border-line bg-surface-1/95 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xl font-black tracking-tight text-content-1">
              Report Generation Control
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {reportAdminLocked ? (
              <EmptyPanel text="Report generation controls are restricted to admin and owner roles." />
            ) : supportDegraded ? (
              <EmptyPanel text="Report profiles or report-run history are temporarily degraded. The dashboard keeps the failure explicit instead of pretending the workspace is empty." />
            ) : profiles.length ? (
              profiles.map((profile: any) => (
                <div
                  key={profile.report_code}
                  className="rounded-[1.2rem] border border-line bg-surface-2 p-4"
                >
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                      <div className="text-sm font-black text-content-1">
                        {profile.label}
                      </div>
                      <div className="text-xs font-semibold text-content-3">
                        {profile.active
                          ? "Active daily archive profile"
                          : "Paused daily archive profile"}{" "}
                        · Owner/Admin inbox notice
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-full border-line bg-surface-1"
                      disabled={!profile.active || sendMutation.isPending}
                      onClick={() => sendMutation.mutate(profile.report_code)}
                    >
                      <Send className="mr-2 h-4 w-4" />
                      {`Generate ${profile.label} now`}
                    </Button>
                  </div>
                </div>
              ))
            ) : (
              <EmptyPanel text="No report archive profiles are configured for the current workspace." />
            )}
          </CardContent>
        </Card>

        <Card className="rounded-[1.85rem] border border-line bg-surface-1/95 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-xl font-black tracking-tight text-content-1">
              Run History Snapshot
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {recentRuns.length ? (
              recentRuns.slice(0, 5).map((run: any, index: number) => (
                <div
                  key={`history-${run.id || run.created_at}-${index}`}
                  className="rounded-[1.2rem] border border-line bg-surface-2 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-black text-content-1">
                        {run.report_code}
                      </div>
                      <div className="text-xs font-semibold text-content-3">
                        {index === 0 ? "Latest run" : "Recent report runs"} ·{" "}
                        {run.report_date} · {run.created_at}
                      </div>
                      <div className="mt-1 text-[11px] font-semibold text-content-3">
                        {run.triggered_manually
                          ? "Manual send"
                          : "Scheduled send"}
                        {run.triggered_by ? ` · ${run.triggered_by}` : ""}
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className="rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em]"
                    >
                      {run.status}
                    </Badge>
                  </div>
                </div>
              ))
            ) : (
              <EmptyPanel text="Recent report runs will appear here once seeded dispatches or manual sends are available." />
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function EmptyPanel({ text }: { text: string }) {
  return (
    <div className="rounded-[1.2rem] border border-dashed border-line bg-surface-2 px-4 py-6 text-sm font-semibold text-content-3">
      {text}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <Card className="rounded-[1.7rem] border border-line bg-surface-1/90 shadow-sm">
      <CardContent className="min-w-0 p-4 md:p-5">
        <div className="truncate text-[10px] font-black uppercase tracking-[0.22em] text-content-4">
          {label}
        </div>
        <div className="mt-2 break-words text-[1.7rem] font-black leading-none text-content-1 md:text-[1.95rem]">
          {value}
        </div>
        <div className="mt-2 text-xs font-semibold leading-5 text-content-3">
          {hint}
        </div>
      </CardContent>
    </Card>
  );
}

function SignalRow({
  title,
  value,
  hint,
}: {
  title: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-[1.2rem] border border-line bg-surface-2 p-4">
      <div className="text-sm font-black text-content-1">{title}</div>
      <div className="mt-2 break-words text-[1.7rem] font-black leading-none text-primary">
        {value}
      </div>
      <div className="mt-2 text-xs font-semibold leading-5 text-content-3">
        {hint}
      </div>
    </div>
  );
}

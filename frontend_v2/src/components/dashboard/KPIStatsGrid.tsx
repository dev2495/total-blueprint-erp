"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { analyticsApi, type ControlTowerStats } from "@/services/analytics";
import {
  BarChart3,
  TrendingUp,
  Activity,
  AlertTriangle,
  Users,
} from "lucide-react";

type DashboardMetric = ControlTowerStats["metrics"][number];

const emptyMetric: DashboardMetric = { id: "", label: "", value: 0, unit: "" };

function formatMetric(value: string | number | undefined, unit?: string) {
  const numeric = Number(value || 0);
  if (unit === "INR")
    return `Rs ${numeric.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
  if (unit === "KG")
    return `${numeric.toLocaleString("en-IN", { maximumFractionDigits: 1 })} kg`;
  if (unit === "%")
    return `${numeric.toLocaleString("en-IN", { maximumFractionDigits: 1 })}%`;
  return typeof value === "number"
    ? numeric.toLocaleString("en-IN", { maximumFractionDigits: 1 })
    : String(value || 0);
}

export function KPIStatsGrid() {
  const { data: stats, isLoading } = useQuery<ControlTowerStats>({
    queryKey: ["control-tower-stats"],
    queryFn: () => analyticsApi.getControlTowerStats("month"),
  });

  if (isLoading)
    return (
      <div className="p-8 text-center text-content-4">Loading KPI Data...</div>
    );

  const metricRows = stats?.metrics || [];
  const getMetric = (id: string, label: string) =>
    metricRows.find(
      (m) => m.id === id || String(m.label || "").includes(label),
    ) || emptyMetric;
  const productionMetric = getMetric("production", "Production");
  const utilizationMetric = getMetric(
    "machine_utilization",
    "Machine Utilization",
  );
  const alertCount = stats?.alerts?.length || 0;
  const revenueMetric = getMetric("revenue", "Revenue");
  const recentProduction = (stats?.production_trend || []).slice(-5);
  const recentSales = (stats?.sales_trend || []).slice(-5);
  const topCustomers = (stats?.top_customers || []).slice(0, 5);
  const jobDistribution = (stats?.job_distribution || []).slice(0, 6);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Total Production
            </CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatMetric(productionMetric.value, productionMetric.unit)}
            </div>
            <p className="text-xs text-muted-foreground">
              {productionMetric.sub_value || "Logged output in selected period"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Machine Utilization
            </CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatMetric(utilizationMetric.value, utilizationMetric.unit)}
            </div>
            <p className="text-xs text-muted-foreground">
              {utilizationMetric.sub_value ||
                "Running machines from master status"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Alerts</CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{alertCount}</div>
            <p className="text-xs text-muted-foreground">
              Open inventory and production risk signals
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Gross Revenue</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatMetric(revenueMetric.value, revenueMetric.unit)}
            </div>
            <p className="text-xs text-muted-foreground">
              {revenueMetric.trend_label
                ? `${revenueMetric.trend_label}: ${revenueMetric.trend || 0}`
                : "From costing summary"}
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="col-span-4">
        <CardHeader>
          <CardTitle>Performance Evidence</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-xl border border-line p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-bold text-content-1">
                <Activity className="h-4 w-4 text-primary" />
                Recent production
              </div>
              <div className="space-y-2">
                {recentProduction.length ? (
                  recentProduction.map((row) => (
                    <div
                      key={String(row.date)}
                      className="flex items-center justify-between text-sm"
                    >
                      <span className="text-content-3">{String(row.date)}</span>
                      <span className="font-semibold text-content-1">
                        {formatMetric(row.count, "KG")}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-content-3">
                    No production logs in this period.
                  </div>
                )}
              </div>
            </div>
            <div className="rounded-xl border border-line p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-bold text-content-1">
                <Users className="h-4 w-4 text-success-fg" />
                Top customers
              </div>
              <div className="space-y-2">
                {topCustomers.length ? (
                  topCustomers.map((row) => (
                    <div
                      key={String(row.customer_name)}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <span className="truncate text-content-3">
                        {row.customer_name || "Unmapped customer"}
                      </span>
                      <span className="font-semibold text-content-1">
                        {Number(row.order_count || 0)} orders
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-content-3">
                    No customer orders in this period.
                  </div>
                )}
              </div>
            </div>
            <div className="rounded-xl border border-line p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-bold text-content-1">
                <BarChart3 className="h-4 w-4 text-order-fg" />
                Job distribution
              </div>
              <div className="space-y-2">
                {jobDistribution.length ? (
                  jobDistribution.map((row) => {
                    const status = String(row.status || "Unknown");
                    return (
                      <div
                        key={status}
                        className="flex items-center justify-between text-sm"
                      >
                        <span className="text-content-3">
                          {status.replaceAll("_", " ")}
                        </span>
                        <span className="font-semibold text-content-1">
                          {Number(row.count || 0)}
                        </span>
                      </div>
                    );
                  })
                ) : (
                  <div className="text-sm text-content-3">No jobs found.</div>
                )}
              </div>
            </div>
          </div>
          <div className="mt-4 rounded-xl border border-line p-4">
            <div className="mb-3 text-sm font-bold text-content-1">
              Recent sales trend
            </div>
            <div className="grid gap-2 md:grid-cols-5">
              {recentSales.length ? (
                recentSales.map((row) => (
                  <div
                    key={String(row.date)}
                    className="rounded-lg bg-surface-2 p-3"
                  >
                    <div className="text-[11px] font-semibold text-content-3">
                      {String(row.date)}
                    </div>
                    <div className="mt-1 text-sm font-bold text-content-1">
                      {Number(row.count || 0)} orders
                    </div>
                    <div className="text-xs text-content-3">
                      {formatMetric(row.weight, "KG")}
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-sm text-content-3">
                  No sales rows in this period.
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

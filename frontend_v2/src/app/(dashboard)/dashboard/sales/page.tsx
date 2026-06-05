"use client";

import Link from "next/link";
import { type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  Clock3,
  Layers3,
  Package2,
  ShoppingCart,
  Target,
  TrendingUp,
  Wallet,
} from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Bar,
  BarChart,
} from "recharts";

import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const CHART_COLORS = [
  "#2563eb",
  "#3b82f6",
  "#0ea5e9",
  "#10b981",
  "#f59e0b",
  "#f97316",
];

function metricValue(metrics: any[], label: string) {
  return (
    metrics.find(
      (metric) =>
        String(metric?.label || "").toLowerCase() === label.toLowerCase(),
    ) || null
  );
}

function compactValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

export default function SalesDashboard() {
  const { data: stats } = useQuery({
    queryKey: ["sales-dashboard-stats"],
    queryFn: async () => {
      const response = await api.get("/api/analytics/sales-dashboard/");
      return response.data;
    },
    refetchInterval: 30_000,
    staleTime: 20_000,
  });

  const metrics = Array.isArray(stats?.metrics) ? stats.metrics : [];
  const trendData = Array.isArray(stats?.trend_data) ? stats.trend_data : [];
  const customerDistribution = Array.isArray(stats?.customer_distribution)
    ? stats.customer_distribution
    : [];
  const statusBreakdown = Array.isArray(stats?.status_breakdown)
    ? stats.status_breakdown
    : [];
  const recentOrders = Array.isArray(stats?.recent_orders)
    ? stats.recent_orders
    : [];
  const alerts = Array.isArray(stats?.alerts) ? stats.alerts : [];
  const forecast = stats?.forecast || {
    percentage: 0,
    status_text: "No target set",
  };

  const metricCards = [
    {
      label: "Orders Today",
      value: compactValue(metricValue(metrics, "Orders Today")?.value),
      sublabel: compactValue(metricValue(metrics, "Orders Today")?.unit),
      icon: ShoppingCart,
      tone: "bg-info-bg text-info-fg",
    },
    {
      label: "Pipeline Volume",
      value: compactValue(metricValue(metrics, "Pipeline Volume")?.value),
      sublabel: compactValue(metricValue(metrics, "Pipeline Volume")?.unit),
      icon: Layers3,
      tone: "bg-info-bg text-primary",
    },
    {
      label: "Revenue (MTD)",
      value: compactValue(metricValue(metrics, "Revenue (MTD)")?.value),
      sublabel: compactValue(metricValue(metrics, "Revenue (MTD)")?.unit),
      icon: Wallet,
      tone: "bg-success-bg text-success-fg",
    },
    {
      label: "Dispatch Ready",
      value: compactValue(metricValue(metrics, "Dispatch Ready")?.value),
      sublabel: compactValue(metricValue(metrics, "Dispatch Ready")?.unit),
      icon: Package2,
      tone: "bg-warning-bg text-warning-fg",
    },
    {
      label: "Overdue Orders",
      value: compactValue(metricValue(metrics, "Overdue Orders")?.value),
      sublabel: compactValue(metricValue(metrics, "Overdue Orders")?.unit),
      icon: Clock3,
      tone: "bg-danger-bg text-danger-fg",
    },
  ];

  return (
    <div className="space-y-5 pb-8">
      <section className="overflow-hidden rounded-[2rem] border border-line bg-[linear-gradient(135deg,#1e1b4b_0%,#1d4ed8_46%,#2563eb_100%)] px-5 py-5 text-white shadow-[0_24px_80px_-36px_rgba(49,46,129,0.55)] md:px-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div className="max-w-3xl space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-surface-1/15 bg-surface-1/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-info-border">
              <Target className="h-3.5 w-3.5" />
              Commercial Command
            </div>
            <div>
              <h1 className="text-3xl font-black tracking-[-0.05em] md:text-4xl">
                Sales Command Center
              </h1>
              <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-info-border">
                Compact commercial landing with queue pressure, dispatch-ready
                demand, customer mix, and recent order movement.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              asChild
              className="h-11 rounded-full bg-surface-1 px-5 text-sm font-black text-primary hover:bg-info-bg"
            >
              <Link href="/sales/orders/create">
                <ShoppingCart className="mr-2 h-4 w-4" />
                Create Order
              </Link>
            </Button>
            <Button
              asChild
              variant="outline"
              className="h-11 rounded-full border-surface-1/20 bg-surface-1/10 px-5 text-sm font-black text-white hover:bg-surface-1/15 hover:text-white"
            >
              <Link href="/sales/orders">
                View Orders
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {metricCards.map((metric) => (
          <CompactMetricCard key={metric.label} {...metric} />
        ))}
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
        <PanelCard
          title="Sales Velocity"
          description="30-day commercial volume and order creation pulse."
          action={
            <Badge
              variant="outline"
              className="rounded-full border-info-border bg-info-bg text-primary"
            >
              Auto-refreshing
            </Badge>
          }
        >
          {trendData.length ? (
            <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="h-[280px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trendData}>
                    <defs>
                      <linearGradient
                        id="sales-volume-fill"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="5%"
                          stopColor="#2563eb"
                          stopOpacity={0.28}
                        />
                        <stop
                          offset="95%"
                          stopColor="#2563eb"
                          stopOpacity={0.02}
                        />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke="#e2e8f0"
                    />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11 }}
                      stroke="#94a3b8"
                    />
                    <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" />
                    <Tooltip />
                    <Area
                      type="monotone"
                      dataKey="weight"
                      stroke="#2563eb"
                      strokeWidth={2.5}
                      fill="url(#sales-volume-fill)"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="grid gap-3">
                <InsetStat
                  label="Latest order count"
                  value={compactValue(
                    trendData[trendData.length - 1]?.orders ?? 0,
                  )}
                  hint="Orders created on the latest visible day"
                />
                <InsetStat
                  label="Peak daily weight"
                  value={`${Math.max(...trendData.map((row: any) => Number(row.weight || 0))).toLocaleString("en-IN", { maximumFractionDigits: 1 })} KG`}
                  hint="Highest visible day in the 30-day window"
                />
                <InsetStat
                  label="Forecast"
                  value={`${Number(forecast.percentage || 0)}%`}
                  hint={compactValue(forecast.status_text)}
                />
              </div>
            </div>
          ) : (
            <EmptyState text="Sales trend data is not available yet." />
          )}
        </PanelCard>

        <PanelCard
          title="Customer and Status Mix"
          description="Where load is concentrated and which order states are dominant."
        >
          <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="rounded-[1.2rem] border border-line bg-surface-2 p-4">
              {customerDistribution.length ? (
                <>
                  <div className="h-[210px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={customerDistribution}
                          dataKey="value"
                          nameKey="name"
                          innerRadius={54}
                          outerRadius={86}
                          paddingAngle={3}
                        >
                          {customerDistribution.map((_: any, index: number) => (
                            <Cell
                              key={`customer-${index}`}
                              fill={CHART_COLORS[index % CHART_COLORS.length]}
                            />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="mt-2 space-y-2">
                    {customerDistribution
                      .slice(0, 4)
                      .map((row: any, index: number) => (
                        <div
                          key={row.name}
                          className="flex items-center justify-between gap-3 text-xs font-semibold text-content-3"
                        >
                          <div className="flex min-w-0 items-center gap-2">
                            <span
                              className="h-2.5 w-2.5 shrink-0 rounded-full"
                              style={{
                                backgroundColor:
                                  CHART_COLORS[index % CHART_COLORS.length],
                              }}
                            />
                            <span className="truncate">{row.name}</span>
                          </div>
                          <span>
                            {Number(row.value || 0).toLocaleString("en-IN", {
                              maximumFractionDigits: 1,
                            })}{" "}
                            KG
                          </span>
                        </div>
                      ))}
                  </div>
                </>
              ) : (
                <EmptyState
                  text="Customer mix will appear here once live sales volume is visible."
                  compact
                />
              )}
            </div>

            <div className="rounded-[1.2rem] border border-line bg-surface-2 p-4">
              {statusBreakdown.length ? (
                <div className="h-[290px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={statusBreakdown}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis
                        dataKey="status"
                        tick={{ fontSize: 10 }}
                        stroke="#94a3b8"
                      />
                      <YAxis tick={{ fontSize: 10 }} stroke="#94a3b8" />
                      <Tooltip />
                      <Bar
                        dataKey="count"
                        fill="#0f766e"
                        radius={[8, 8, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <EmptyState
                  text="Status breakdown is not available yet."
                  compact
                />
              )}
            </div>
          </div>
        </PanelCard>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <PanelCard
          title="Recent Commercial Activity"
          description="Latest order movement with direct jump to the register."
          action={
            <Button
              asChild
              variant="ghost"
              className="h-8 rounded-full px-3 text-xs font-black text-primary hover:bg-info-bg"
            >
              <Link href="/sales/orders">Open register</Link>
            </Button>
          }
        >
          <div className="space-y-3">
            {recentOrders.length ? (
              recentOrders.slice(0, 8).map((order: any, index: number) => (
                <div
                  key={`${order.id}-${index}`}
                  className="flex flex-col gap-3 rounded-[1.2rem] border border-line bg-surface-2 p-4 md:flex-row md:items-center md:justify-between"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-black text-content-1">
                      {order.order_number || order.id}
                    </div>
                    <div className="mt-1 text-xs font-semibold text-content-3">
                      {order.customer}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3 text-xs font-semibold text-content-3">
                    <span>{order.weight || "0 KG"}</span>
                    <Badge
                      variant="outline"
                      className="rounded-full border-line bg-surface-1 text-content-2"
                    >
                      {order.status}
                    </Badge>
                    <span>{order.date}</span>
                  </div>
                </div>
              ))
            ) : (
              <EmptyState text="No recent sales orders are visible yet." />
            )}
          </div>
        </PanelCard>

        <div className="space-y-5">
          <PanelCard
            title="Commercial Watchlist"
            description="Only actionable queue pressure and exceptions are shown here."
          >
            <div className="space-y-3">
              {alerts.length ? (
                alerts.map((alert: any, index: number) => (
                  <div
                    key={`${alert.type}-${index}`}
                    className="flex items-start gap-3 rounded-[1.2rem] border border-line bg-surface-2 p-4"
                  >
                    <div
                      className={cn(
                        "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                        alert.type === "overdue"
                          ? "bg-danger-bg text-danger-fg"
                          : "bg-info-bg text-primary",
                      )}
                    >
                      {alert.type === "overdue" ? (
                        <AlertTriangle className="h-4 w-4" />
                      ) : (
                        <TrendingUp className="h-4 w-4" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-black text-content-1">
                        {alert.title}
                      </div>
                      <div className="mt-1 text-xs font-semibold leading-5 text-content-3">
                        {alert.description}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <EmptyState
                  text="No commercial alerts are open right now."
                  compact
                />
              )}
            </div>
          </PanelCard>

          <PanelCard
            title="Monthly Target Pulse"
            description="Simple commercial forecast against the current monthly target."
          >
            <div className="rounded-[1.2rem] border border-info-border bg-[linear-gradient(135deg,#eef2ff,#eefbf7)] p-4">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <div className="text-[11px] font-black uppercase tracking-[0.16em] text-primary">
                    Progress
                  </div>
                  <div className="mt-2 text-3xl font-black tracking-[-0.05em] text-content-1">
                    {Number(forecast.percentage || 0)}%
                  </div>
                </div>
                <Badge
                  variant="outline"
                  className="rounded-full border-info-border bg-surface-1 text-primary"
                >
                  Live target
                </Badge>
              </div>
              <div className="mt-4 h-3 overflow-hidden rounded-full bg-surface-1">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-500"
                  style={{
                    width: `${Math.max(0, Math.min(100, Number(forecast.percentage || 0)))}%`,
                  }}
                />
              </div>
              <div className="mt-3 text-sm font-medium leading-6 text-content-3">
                {compactValue(forecast.status_text)}
              </div>
            </div>
          </PanelCard>
        </div>
      </section>
    </div>
  );
}

function CompactMetricCard({
  label,
  value,
  sublabel,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  sublabel: string;
  icon: any;
  tone: string;
}) {
  return (
    <Card className="rounded-[1.5rem] border border-line bg-surface-1 shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-content-4">
              {label}
            </div>
            <div className="mt-2 break-words text-[1.9rem] font-black leading-none tracking-[-0.05em] text-content-1">
              {value}
            </div>
            <div className="mt-2 text-xs font-semibold text-content-3">
              {sublabel}
            </div>
          </div>
          <div
            className={cn(
              "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl",
              tone,
            )}
          >
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PanelCard({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="rounded-[1.75rem] border border-line bg-surface-1 shadow-sm">
      <CardHeader className="space-y-2 pb-2">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <CardTitle className="text-xl font-black tracking-tight text-content-1">
              {title}
            </CardTitle>
            <div className="mt-1 text-sm font-medium leading-6 text-content-3">
              {description}
            </div>
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

function InsetStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-[1.2rem] border border-line bg-surface-2 p-4">
      <div className="text-[10px] font-black uppercase tracking-[0.16em] text-content-4">
        {label}
      </div>
      <div className="mt-2 text-xl font-black tracking-[-0.04em] text-content-1">
        {value}
      </div>
      <div className="mt-2 text-xs font-semibold leading-5 text-content-3">
        {hint}
      </div>
    </div>
  );
}

function EmptyState({
  text,
  compact = false,
}: {
  text: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-[1.2rem] border border-dashed border-line bg-surface-2 text-center text-sm font-semibold text-content-3",
        compact ? "px-4 py-8" : "px-4 py-12",
      )}
    >
      {text}
    </div>
  );
}

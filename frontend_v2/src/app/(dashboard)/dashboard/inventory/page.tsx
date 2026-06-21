"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Package,
  AlertTriangle,
  ArrowRight,
  ClipboardList,
  Activity,
  CircleDot,
  Boxes,
  Layers,
  CheckCircle2,
} from "lucide-react";
import Link from "next/link";
import { StatsGrid } from "@/components/dashboard/stats-grid";
import { observabilityApi } from "@/services/observability";
import {
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from "recharts";
import { useInView } from "react-intersection-observer";

const COLORS = ["#60a5fa", "#3b82f6", "#10b981", "#f59e0b", "#ef4444"];

function ScrollTriggeredChart({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const { ref, inView } = useInView({ threshold: 0.1 });
  return (
    <div ref={ref} className={className}>
      {inView ? children : null}
    </div>
  );
}

export default function InventoryDashboard() {
  // Fetch live inventory health
  const {
    data: health,
    isLoading: isHealthLoading,
    isError: isHealthError,
  } = useQuery({
    queryKey: ["inventory-health-stats"],
    queryFn: async () => {
      return await observabilityApi.getHealth();
    },
    refetchInterval: 30000, // Every 30s
  });

  // Fetch live alerts
  const {
    data: alerts,
    isLoading: isAlertsLoading,
    isError: isAlertsError,
  } = useQuery({
    queryKey: ["inventory-critical-alerts"],
    queryFn: async () => {
      // Only fetch unresolved
      const allAlerts = await observabilityApi.getAlerts({ resolved: false });
      // Pre-sort critical -> high -> medium -> low
      const priority: Record<string, number> = {
        CRITICAL: 0,
        HIGH: 1,
        MEDIUM: 2,
        LOW: 3,
      };
      return allAlerts.sort(
        (a, b) => priority[a.severity] - priority[b.severity],
      );
    },
    refetchInterval: 30000,
  });

  const healthUnavailable = !isHealthLoading && (isHealthError || !health);
  const alertsUnavailable =
    !isAlertsLoading && (isAlertsError || !Array.isArray(alerts));
  const safeAlerts = Array.isArray(alerts) ? alerts : [];
  const alertCounts = health?.alerts ?? null;

  const metrics = [
    {
      label: "Bulk Stock",
      value: health ? `${Math.round(health.bulk.total_kg / 1000)} t` : "—",
      unit: health
        ? `${health.bulk.sku_count} SKUs`
        : "Health payload unavailable",
      icon: Package,
      color: "text-content-2",
      bg: "bg-surface-2",
    },
    {
      label: "WIP Rolls",
      value: health
        ? `${Math.round((health.rolls.available_kg + health.rolls.reserved_kg) / 1000)} t`
        : "—",
      unit: health
        ? `${health.rolls.available_count + health.rolls.reserved_count} Rolls`
        : "Health payload unavailable",
      icon: CircleDot,
      color: "text-primary",
      bg: "bg-info-bg",
    },
    {
      label: "Finished Goods",
      value: health ? `${Math.round(health.rolls.fg_kg / 1000)} t` : "—",
      unit: health
        ? `${health.rolls.fg_count} Rolls`
        : "Health payload unavailable",
      icon: Boxes,
      color: "text-success-fg",
      bg: "bg-success-bg",
    },
    {
      label: "System Alerts",
      value: alertCounts ? String(alertCounts.total_open) : "—",
      unit: alertCounts
        ? `${alertCounts.critical} Critical`
        : "Health payload unavailable",
      icon: AlertTriangle,
      color:
        alertCounts && alertCounts.total_open > 0
          ? "text-danger-fg"
          : "text-content-4",
      bg:
        alertCounts && alertCounts.total_open > 0
          ? "bg-danger-bg"
          : "bg-surface-2",
      alert: Boolean(alertCounts && alertCounts.critical > 0),
    },
  ];

  // Graph Data formatting
  const stockDistData = health
    ? [
        { name: "Bulk Raw", value: health.bulk.total_kg },
        {
          name: "WIP Rolls",
          value: health.rolls.available_kg + health.rolls.reserved_kg,
        },
        { name: "Finished Goods", value: health.rolls.fg_kg },
      ].filter((d) => d.value > 0)
    : [];

  const alertSeverityData = alertCounts
    ? [
        { name: "Critical", count: alertCounts.critical },
        { name: "High", count: alertCounts.high },
        {
          name: "Medium",
          count: Math.max(
            0,
            alertCounts.total_open - alertCounts.critical - alertCounts.high,
          ),
        },
      ]
    : [];

  return (
    <div className="space-y-8 pb-10">
      {/* SaaS Subtle Hero Hub */}
      <div className="relative overflow-hidden rounded-3xl bg-surface-3 border border-line-strong p-8 text-white shadow-2xl ">
        <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-primary blur-3xl" />
        <div className="absolute -bottom-20 -left-20 h-64 w-64 rounded-full bg-primary blur-3xl" />

        <div className="relative flex flex-col md:flex-row items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="flex h-2 w-2 rounded-full bg-success-fg animate-pulse" />
              <span className="text-xs font-bold uppercase tracking-widest text-content-4">
                Stock Nexus
              </span>
            </div>
            <h1 className="text-4xl font-black tracking-tight mb-2 text-white">
              Inventory Control Hub
            </h1>
            <p className="text-content-4 max-w-md font-medium">
              Monitor live network-wide stock volumes, manage raw material
              allocations, and rapidly triage supply chain choke points.
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <Link href="/inventory/grn">
              <Button
                size="lg"
                className="w-full bg-success-fg text-white hover:bg-success-fg font-bold px-8 rounded-xl shadow-xl transition-all hover:scale-105 active:scale-95"
              >
                <ClipboardList className="mr-2 h-5 w-5" strokeWidth={2} />{" "}
                Create GRN
              </Button>
            </Link>
            <Link href="/analytics/inventory-health">
              <Button
                size="lg"
                variant="outline"
                className="w-full bg-surface-1/10 text-white border-surface-1/20 hover:bg-surface-1/20 font-bold px-8 rounded-xl shadow-xl transition-all active:scale-95"
              >
                <Activity className="mr-2 h-5 w-5" /> Health Diagnostics
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* 4-Card Interaction Grid */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {metrics.map((metric, i) => (
          <Card
            key={i}
            className={`group relative overflow-hidden border-none shadow-md ring-1 ring-line bg-surface-1 transition-all duration-300`}
          >
            <div
              className={`absolute top-0 right-0 p-4 opacity-5 ${metric.color}`}
            >
              <metric.icon className="h-24 w-24" />
            </div>
            <CardHeader className="pb-2">
              <CardDescription
                className={`font-bold uppercase tracking-wider text-xs ${metric.color}`}
              >
                {metric.label}
              </CardDescription>
              <CardTitle className="text-3xl font-black text-content-1">
                {isHealthLoading ? "..." : metric.value}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2 text-sm mt-1">
                <Badge
                  variant="outline"
                  className={`${metric.bg} ${metric.color} ${(metric as any).alert ? "animate-pulse" : ""} border-transparent shadow-sm font-bold`}
                >
                  {isHealthLoading ? "Loading..." : metric.unit}
                </Badge>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Recharts Analytics Matrices */}
      <div className="grid gap-8 lg:grid-cols-3">
        {/* Volume Distribution Pie */}
        <Card className="border-0 bg-surface-1 shadow-xl rounded-2xl overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-black text-content-1">
              Network Weight Topology
            </CardTitle>
            <CardDescription className="font-medium text-content-3">
              Live tonnage mapping by inventory stage.
            </CardDescription>
          </CardHeader>
          <CardContent className="h-[280px]">
            {stockDistData.length > 0 ? (
              <ScrollTriggeredChart className="w-full h-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={stockDistData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={65}
                      outerRadius={95}
                      paddingAngle={3}
                      stroke="none"
                    >
                      {stockDistData.map((entry, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={COLORS[index % COLORS.length]}
                        />
                      ))}
                    </Pie>
                    <RechartsTooltip
                      formatter={(value: any) => [
                        `${Math.round(value / 1000)} Tonnes`,
                        "Volume",
                      ]}
                      contentStyle={{
                        borderRadius: "8px",
                        border: "none",
                        boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </ScrollTriggeredChart>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-content-4">
                <Layers className="h-8 w-8 mb-2 opacity-50" />
                <span className="text-xs font-bold uppercase tracking-widest">
                  {healthUnavailable ? "Health payload unavailable" : "No stock volume"}
                </span>
                <span className="mt-1 max-w-[220px] text-center text-[11px] font-semibold text-content-4">
                  {healthUnavailable
                    ? "Inventory mix is paused until the live health feed responds."
                    : "Stock mix will appear once inventory exists in the selected stages."}
                </span>
              </div>
            )}
            {/* Legend */}
            <div className="flex items-center justify-center gap-4 pb-2">
              {stockDistData.map((d, i) => (
                <div
                  key={i}
                  className="flex items-center gap-1.5 text-[11px] font-bold text-content-3 uppercase tracking-widest"
                >
                  <div
                    className="h-2.5 w-2.5 rounded-sm"
                    style={{ backgroundColor: COLORS[i % COLORS.length] }}
                  />
                  {d.name}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Live Critical Action Center */}
        <Card className="lg:col-span-2 border-0 bg-surface-1 shadow-xl rounded-2xl overflow-hidden">
          <CardHeader className="border-b border-line bg-surface-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-xl font-black text-content-1 flex items-center gap-2">
                  <AlertTriangle
                    className="h-5 w-5 text-danger-fg"
                    strokeWidth={2.5}
                  />
                  Critical Action Center
                </CardTitle>
                <CardDescription className="font-medium text-content-3">
                  Urgent bottlenecks and structural warnings actively requiring
                  human triage.
                </CardDescription>
              </div>
              <Badge className="bg-danger-bg text-danger-fg border-0 font-bold px-3 py-1">
                {isAlertsLoading
                  ? "Loading"
                  : alertsUnavailable
                    ? "Paused"
                    : `${safeAlerts.length} Unresolved`}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-0 max-h-[300px] overflow-y-auto scrollbar-elegant">
            <div className="divide-y divide-line">
              {alertsUnavailable && (
                <div className="py-16 px-6 text-center">
                  <div className="mx-auto w-12 h-12 bg-warning-bg rounded-full flex items-center justify-center mb-3">
                    <AlertTriangle className="h-6 w-6 text-warning-fg" />
                  </div>
                  <p className="text-sm font-bold text-warning-fg uppercase tracking-widest">
                    Alert feed unavailable
                  </p>
                  <p className="mt-2 text-xs font-semibold text-content-3">
                    The page is pausing the all-clear state until live alerts
                    load again.
                  </p>
                </div>
              )}
              {safeAlerts.slice(0, 8).map((alert: any) => {
                const isAccel =
                  alert.severity === "CRITICAL" || alert.severity === "HIGH";
                return (
                  <div
                    key={alert.id}
                    className="group flex items-center justify-between p-4 hover:bg-surface-2 transition-colors"
                  >
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className={`text-[9px] font-black uppercase tracking-widest ${isAccel ? "border-danger-border text-danger-fg bg-danger-bg" : "border-warning-border text-warning-fg bg-warning-bg"}`}
                        >
                          {alert.severity}
                        </Badge>
                        <span className="text-sm font-black text-content-1">
                          {alert.type_display}
                        </span>
                      </div>
                      <p className="text-xs font-medium text-content-3 max-w-xl truncate">
                        {alert.message}
                      </p>
                    </div>
                    <Link href="/analytics/inventory-health">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="hidden group-hover:flex h-8 bg-surface-1 border border-line shadow-sm font-bold text-xs text-content-3 transition-all hover:bg-surface-2"
                      >
                        Resolve <ArrowRight className="ml-1.5 h-3 w-3" />
                      </Button>
                    </Link>
                  </div>
                );
              })}
              {safeAlerts.length === 0 &&
                !isAlertsLoading &&
                !alertsUnavailable && (
                <div className="py-20 text-center">
                  <div className="mx-auto w-12 h-12 bg-success-bg rounded-full flex items-center justify-center mb-3">
                    <CheckCircle2 className="h-6 w-6 text-success-fg" />
                  </div>
                  <p className="text-sm font-bold text-success-fg uppercase tracking-widest">
                    No active inventory alerts
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-0 bg-surface-1 shadow-xl rounded-2xl overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg font-black text-content-1">
            Warehouse Alert Distribution Matrix
          </CardTitle>
          <CardDescription className="font-medium text-content-3">
            Volumetric aggregation of inventory fragmentation warnings.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {healthUnavailable ? (
            <div className="h-[200px] mt-4 flex flex-col items-center justify-center rounded-2xl border border-warning-border bg-warning-bg text-center text-warning-fg">
              <AlertTriangle className="h-6 w-6 mb-2" />
              <div className="text-xs font-black uppercase tracking-widest">
                Health payload unavailable
              </div>
              <div className="mt-1 text-xs font-semibold">
                Alert distribution is paused until the live health endpoint
                responds.
              </div>
            </div>
          ) : (
            <ScrollTriggeredChart className="h-[200px] w-full mt-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={alertSeverityData}
                  margin={{ top: 0, right: 0, left: -20, bottom: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="#E2E8F0"
                  />
                  <XAxis
                    dataKey="name"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 12, fill: "#64748B", fontWeight: 600 }}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 12, fill: "#64748B" }}
                  />
                  <RechartsTooltip
                    cursor={{ fill: "#F1F5F9" }}
                    contentStyle={{
                      borderRadius: "8px",
                      border: "none",
                      boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                    }}
                  />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]} barSize={50}>
                    {alertSeverityData.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={
                          entry.name === "Critical"
                            ? "#ef4444"
                            : entry.name === "High"
                              ? "#f97316"
                              : "#eab308"
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </ScrollTriggeredChart>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

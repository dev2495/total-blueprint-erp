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
  const { data: health, isLoading: isHealthLoading } = useQuery({
    queryKey: ["inventory-health-stats"],
    queryFn: async () => {
      return await observabilityApi.getHealth();
    },
    refetchInterval: 30000, // Every 30s
  });

  // Fetch live alerts
  const { data: alerts, isLoading: isAlertsLoading } = useQuery({
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

  const safeHealth = health || {
    bulk: { total_kg: 0, sku_count: 0 },
    rolls: {
      available_count: 0,
      available_kg: 0,
      reserved_count: 0,
      reserved_kg: 0,
      fg_count: 0,
      fg_kg: 0,
    },
    alerts: { total_open: 0, critical: 0, high: 0 },
  };

  const safeAlerts = alerts || [];

  const metrics = [
    {
      label: "Bulk Stock",
      value: `${Math.round(safeHealth.bulk.total_kg / 1000)} t`,
      unit: `${safeHealth.bulk.sku_count} SKUs`,
      icon: Package,
      color: "text-slate-700",
      bg: "bg-slate-50",
    },
    {
      label: "WIP Rolls",
      value: `${Math.round((safeHealth.rolls.available_kg + safeHealth.rolls.reserved_kg) / 1000)} t`,
      unit: `${safeHealth.rolls.available_count + safeHealth.rolls.reserved_count} Rolls`,
      icon: CircleDot,
      color: "text-blue-600",
      bg: "bg-blue-50",
    },
    {
      label: "Finished Goods",
      value: `${Math.round(safeHealth.rolls.fg_kg / 1000)} t`,
      unit: `${safeHealth.rolls.fg_count} Rolls`,
      icon: Boxes,
      color: "text-emerald-600",
      bg: "bg-emerald-50",
    },
    {
      label: "System Alerts",
      value: String(safeHealth.alerts.total_open),
      unit: `${safeHealth.alerts.critical} Critical`,
      icon: AlertTriangle,
      color:
        safeHealth.alerts.total_open > 0 ? "text-rose-600" : "text-slate-400",
      bg: safeHealth.alerts.total_open > 0 ? "bg-rose-50" : "bg-slate-50",
      alert: safeHealth.alerts.critical > 0,
    },
  ];

  // Graph Data formatting
  const stockDistData = [
    { name: "Bulk Raw", value: safeHealth.bulk.total_kg },
    {
      name: "WIP Rolls",
      value: safeHealth.rolls.available_kg + safeHealth.rolls.reserved_kg,
    },
    { name: "Finished Goods", value: safeHealth.rolls.fg_kg },
  ].filter((d) => d.value > 0);

  const alertSeverityData = [
    { name: "Critical", count: safeHealth.alerts.critical },
    { name: "High", count: safeHealth.alerts.high },
    {
      name: "Medium",
      count:
        safeHealth.alerts.total_open -
        safeHealth.alerts.critical -
        safeHealth.alerts.high,
    },
  ];

  return (
    <div className="space-y-8 pb-10">
      {/* SaaS Subtle Hero Hub */}
      <div className="relative overflow-hidden rounded-3xl bg-slate-900 border border-slate-800 p-8 text-white shadow-2xl shadow-slate-900/20">
        <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-blue-500/10 blur-3xl" />
        <div className="absolute -bottom-20 -left-20 h-64 w-64 rounded-full bg-blue-500/5 blur-3xl" />

        <div className="relative flex flex-col md:flex-row items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs font-bold uppercase tracking-widest text-slate-400">
                Stock Nexus
              </span>
            </div>
            <h1 className="text-4xl font-black tracking-tight mb-2 text-white">
              Inventory Control Hub
            </h1>
            <p className="text-slate-400 max-w-md font-medium">
              Monitor live network-wide stock volumes, manage raw material
              allocations, and rapidly triage supply chain choke points.
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <Link href="/inventory/grn/new">
              <Button
                size="lg"
                className="w-full bg-emerald-600 text-white hover:bg-emerald-500 font-bold px-8 rounded-xl shadow-xl transition-all hover:scale-105 active:scale-95"
              >
                <ClipboardList className="mr-2 h-5 w-5" strokeWidth={2} />{" "}
                Create GRN
              </Button>
            </Link>
            <Link href="/analytics/inventory-health">
              <Button
                size="lg"
                variant="outline"
                className="w-full bg-white/10 text-white border-white/20 hover:bg-white/20 font-bold px-8 rounded-xl shadow-xl transition-all active:scale-95"
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
            className={`group relative overflow-hidden border-none shadow-md ring-1 ring-slate-200 bg-white transition-all duration-300`}
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
              <CardTitle className="text-3xl font-black text-slate-900">
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
        <Card className="border-0 bg-white shadow-xl shadow-slate-100 rounded-2xl overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-black text-slate-900">
              Network Weight Topology
            </CardTitle>
            <CardDescription className="font-medium text-slate-500">
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
              <div className="h-full flex flex-col items-center justify-center text-slate-400">
                <Layers className="h-8 w-8 mb-2 opacity-50" />
                <span className="text-xs font-bold uppercase tracking-widest">
                  Awaiting Payload
                </span>
              </div>
            )}
            {/* Legend */}
            <div className="flex items-center justify-center gap-4 pb-2">
              {stockDistData.map((d, i) => (
                <div
                  key={i}
                  className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 uppercase tracking-widest"
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
        <Card className="lg:col-span-2 border-0 bg-white shadow-xl shadow-slate-100 rounded-2xl overflow-hidden">
          <CardHeader className="border-b border-slate-50 bg-slate-50/50">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-xl font-black text-slate-900 flex items-center gap-2">
                  <AlertTriangle
                    className="h-5 w-5 text-rose-500"
                    strokeWidth={2.5}
                  />
                  Critical Action Center
                </CardTitle>
                <CardDescription className="font-medium text-slate-500">
                  Urgent bottlenecks and structural warnings actively requiring
                  human triage.
                </CardDescription>
              </div>
              <Badge className="bg-rose-100 text-rose-700 border-0 font-bold px-3 py-1">
                {safeAlerts.length} Unresolved
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="p-0 max-h-[300px] overflow-y-auto scrollbar-elegant">
            <div className="divide-y divide-slate-50">
              {safeAlerts.slice(0, 8).map((alert: any) => {
                const isAccel =
                  alert.severity === "CRITICAL" || alert.severity === "HIGH";
                return (
                  <div
                    key={alert.id}
                    className="group flex items-center justify-between p-4 hover:bg-slate-50/80 transition-colors"
                  >
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant="outline"
                          className={`text-[9px] font-black uppercase tracking-widest ${isAccel ? "border-rose-200 text-rose-600 bg-rose-50" : "border-amber-200 text-amber-600 bg-amber-50"}`}
                        >
                          {alert.severity}
                        </Badge>
                        <span className="text-sm font-black text-slate-900">
                          {alert.type_display}
                        </span>
                      </div>
                      <p className="text-xs font-medium text-slate-500 max-w-xl truncate">
                        {alert.message}
                      </p>
                    </div>
                    <Link href="/analytics/inventory-health">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="hidden group-hover:flex h-8 bg-white border border-slate-200 shadow-sm font-bold text-xs text-slate-600 transition-all hover:bg-slate-50"
                      >
                        Resolve <ArrowRight className="ml-1.5 h-3 w-3" />
                      </Button>
                    </Link>
                  </div>
                );
              })}
              {safeAlerts.length === 0 && !isAlertsLoading && (
                <div className="py-20 text-center">
                  <div className="mx-auto w-12 h-12 bg-emerald-50 rounded-full flex items-center justify-center mb-3">
                    <CheckCircle2 className="h-6 w-6 text-emerald-400" />
                  </div>
                  <p className="text-sm font-bold text-emerald-600 uppercase tracking-widest">
                    Network Secure - 0 Zero Friction Detected
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-0 bg-white shadow-xl shadow-slate-100 rounded-2xl overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg font-black text-slate-900">
            Warehouse Alert Distribution Matrix
          </CardTitle>
          <CardDescription className="font-medium text-slate-500">
            Volumetric aggregation of inventory fragmentation warnings.
          </CardDescription>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>
    </div>
  );
}

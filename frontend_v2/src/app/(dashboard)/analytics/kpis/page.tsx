"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { analyticsApi } from "@/services/analytics";
import { formatDisplayDate } from "@/lib/date-format";
import { PageHeader } from "@/components/ui-custom/page-header";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useInView } from "@/hooks/use-in-view";
import {
  RefreshCw,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Package,
  Activity,
  Loader2,
  BadgePercent,
  ShoppingCart,
  Layers,
  Trash2,
  ShieldAlert,
  Users,
  Cpu,
} from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#60a5fa"];

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

export default function KPIDashboardPage() {
  const [timeframe, setTimeframe] = useState("month");

  const {
    data: stats,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["control-tower-stats", timeframe],
    queryFn: () => analyticsApi.getControlTowerStats(timeframe),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-12 w-12 animate-spin text-primary" />
          <p className="text-content-3 font-medium">
            Aggregating Global Metrics...
          </p>
        </div>
      </div>
    );
  }

  const {
    metrics = [],
    financial_trend = [],
    financial_summary,
    active_jobs = [],
    production_trend = [],
    sales_trend = [],
    job_distribution = [],
    sku_performance = [],
    inventory_distribution = [],
    scrap_trend = [],
    top_customers = [],
    material_control = {},
    ink_control = {},
    shift_oee = [],
    risk_signals = [],
  } = (stats as any) || {};

  const revMetric = metrics.find((m: any) => m.id === "revenue") || {
    value: 0,
    trend: 0,
    trend_label: "",
  };
  const profitMetric = metrics.find((m: any) => m.id === "net_profit") || {
    value: 0,
    trend: 0,
    trend_label: "",
  };
  const prodMetric = metrics.find((m: any) => m.id === "production") || {
    value: 0,
    sub_value: "",
    status: "normal",
  };
  const invMetric = metrics.find((m: any) => m.id === "inventory") || {
    value: 0,
    sub_value: "",
  };
  const machineMetric = metrics.find(
    (m: any) => m.id === "machine_utilization",
  ) || { value: 0, sub_value: "", status: "warning" };
  const scrapMetric = metrics.find((m: any) => m.id === "scrap_mtd") || {
    value: 0,
    sub_value: "",
    status: "normal",
  };

  // Format trend data for the chart (reverse it so oldest is left, newest is right)
  const chartData = [...financial_trend].reverse().map((item) => ({
    name: item.period,
    revenue: item.revenue,
    profit: item.net_profit,
    cogs: item.total_cogs,
    overheads: item.overheads.total_overheads,
  }));

  // Format Currency
  const formatCurrency = (val: string | number) =>
    new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(Number(val));

  // Format Dates for Charts
  const formatChartDate = (dateStr: any) => {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "";
    return formatDisplayDate(d);
  };

  return (
    <div className="space-y-8 bg-surface-2 min-h-screen p-2 rounded-xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-content-1 tracking-tight flex items-center gap-2">
            Executive Control Center
          </h1>
          <p className="text-content-3 font-medium">
            Live financial posture and operational throughput.
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Tabs
            value={timeframe}
            onValueChange={setTimeframe}
            className="w-[400px]"
          >
            <TabsList className="grid w-full grid-cols-4 bg-line p-1">
              <TabsTrigger
                value="day"
                className="rounded-md data-[state=active]:bg-surface-1 data-[state=active]:shadow-sm"
              >
                Day
              </TabsTrigger>
              <TabsTrigger
                value="week"
                className="rounded-md data-[state=active]:bg-surface-1 data-[state=active]:shadow-sm"
              >
                Week
              </TabsTrigger>
              <TabsTrigger
                value="month"
                className="rounded-md data-[state=active]:bg-surface-1 data-[state=active]:shadow-sm"
              >
                Month
              </TabsTrigger>
              <TabsTrigger
                value="year"
                className="rounded-md data-[state=active]:bg-surface-1 data-[state=active]:shadow-sm"
              >
                Year
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="shadow-sm"
          >
            <RefreshCw className="h-4 w-4 mr-2 text-primary" />
            Live Sync
          </Button>
        </div>
      </div>

      {/* Top KPI Cards */}
      <div className="grid gap-6 md:grid-cols-3 lg:grid-cols-6">
        {/* REVENUE */}
        <Card className="border-none shadow-md ring-1 ring-line overflow-hidden relative">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <TrendingUp className="h-24 w-24 text-primary" />
          </div>
          <CardHeader className="pb-2">
            <CardDescription className="font-semibold text-primary uppercase tracking-wider text-xs">
              Gross Revenue (MTD)
            </CardDescription>
            <CardTitle className="text-3xl font-bold text-content-1">
              {formatCurrency(revMetric.value)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 text-sm mt-1">
              {revMetric.trend > 0 ? (
                <Badge
                  variant="outline"
                  className="bg-success-bg text-success-fg border-success-border"
                >
                  <TrendingUp className="w-3 h-3 mr-1" />{" "}
                  {revMetric.trend.toFixed(1)}% {revMetric.trend_label}
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="bg-danger-bg text-danger-fg border-danger-border"
                >
                  <TrendingDown className="w-3 h-3 mr-1" />{" "}
                  {Math.abs(revMetric.trend).toFixed(1)}%{" "}
                  {revMetric.trend_label}
                </Badge>
              )}
            </div>
          </CardContent>
          <div className="h-1 w-full bg-primary absolute bottom-0"></div>
        </Card>

        {/* NET PROFIT */}
        <Card className="border-none shadow-md ring-1 ring-line overflow-hidden relative">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <DollarSign className="h-24 w-24 text-success-fg" />
          </div>
          <CardHeader className="pb-2">
            <CardDescription className="font-semibold text-success-fg uppercase tracking-wider text-xs">
              Net Profit (MTD)
            </CardDescription>
            <CardTitle className="text-3xl font-bold text-content-1">
              {formatCurrency(profitMetric.value)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 text-sm mt-1">
              {profitMetric.trend > 0 ? (
                <Badge
                  variant="outline"
                  className="bg-success-bg text-success-fg border-success-border"
                >
                  <TrendingUp className="w-3 h-3 mr-1" />{" "}
                  {profitMetric.trend.toFixed(1)}% {profitMetric.trend_label}
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="bg-danger-bg text-danger-fg border-danger-border"
                >
                  <TrendingDown className="w-3 h-3 mr-1" />{" "}
                  {Math.abs(profitMetric.trend).toFixed(1)}%{" "}
                  {profitMetric.trend_label}
                </Badge>
              )}
            </div>
          </CardContent>
          <div className="h-1 w-full bg-success-fg absolute bottom-0"></div>
        </Card>

        {/* PRODUCTION OUTPUT */}
        <Card className="border-none shadow-md ring-1 ring-line overflow-hidden relative">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <Activity className="h-24 w-24 text-info-fg" />
          </div>
          <CardHeader className="pb-2">
            <CardDescription className="font-semibold text-info-fg uppercase tracking-wider text-xs">
              {prodMetric.label || "Production Output"}
            </CardDescription>
            <CardTitle className="text-3xl font-bold text-content-1">
              {Number(prodMetric.value).toLocaleString()}{" "}
              {prodMetric.unit || "KG"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 text-sm mt-1 text-content-3 font-medium">
              {prodMetric.status === "warning" ? (
                <Badge
                  variant="outline"
                  className="bg-warning-bg text-warning-fg border-warning-border"
                >
                  <TrendingDown className="w-3 h-3 mr-1" />
                  {prodMetric.sub_value}
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="bg-info-bg text-info-fg border-info-border"
                >
                  <TrendingUp className="w-3 h-3 mr-1" />
                  {prodMetric.sub_value}
                </Badge>
              )}
            </div>
          </CardContent>
          <div className="h-1 w-full bg-info-fg absolute bottom-0"></div>
        </Card>

        {/* INVENTORY VALUATION */}
        <Card className="border-none shadow-md ring-1 ring-line overflow-hidden relative">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <Package className="h-24 w-24 text-warning-fg" />
          </div>
          <CardHeader className="pb-2">
            <CardDescription className="font-semibold text-warning-fg uppercase tracking-wider text-xs">
              Inventory Value
            </CardDescription>
            <CardTitle className="text-3xl font-bold text-content-1">
              {formatCurrency(invMetric.value)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 text-sm mt-1 text-content-3 font-medium">
              {invMetric.sub_value}
            </div>
          </CardContent>
          <div className="h-1 w-full bg-warning-fg absolute bottom-0"></div>
        </Card>

        {/* MACHINE UTILIZATION */}
        <Card className="border-none shadow-md ring-1 ring-line overflow-hidden relative">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <Cpu className="h-24 w-24 text-primary" />
          </div>
          <CardHeader className="pb-2">
            <CardDescription className="font-semibold text-primary uppercase tracking-wider text-xs">
              OEE Utilization
            </CardDescription>
            <CardTitle className="text-3xl font-bold text-content-1">
              {machineMetric.value.toFixed(1)}{" "}
              <span className="text-lg text-content-3">%</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 text-sm mt-1">
              <Badge
                variant="outline"
                className={
                  machineMetric.status === "normal"
                    ? "bg-success-bg text-success-fg border-success-border"
                    : "bg-danger-bg text-danger-fg border-danger-border"
                }
              >
                {machineMetric.sub_value}
              </Badge>
            </div>
          </CardContent>
          <div className="h-1 w-full bg-primary absolute bottom-0"></div>
        </Card>

        {/* FACTORY SCRAP */}
        <Card className="border-none shadow-md ring-1 ring-line overflow-hidden relative text-white bg-surface-3">
          <div className="absolute top-0 right-0 p-4 opacity-10">
            <Trash2 className="h-24 w-24 text-content-4" />
          </div>
          <CardHeader className="pb-2">
            <CardDescription className="font-semibold text-content-4 uppercase tracking-wider text-xs">
              Scrap (MTD)
            </CardDescription>
            <CardTitle className="text-3xl font-bold text-white">
              {scrapMetric.value.toLocaleString()}{" "}
              <span className="text-lg text-content-4">KG</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 text-sm mt-1">
              <Badge
                variant="outline"
                className={
                  scrapMetric.status === "normal"
                    ? "bg-success-fg text-success-fg border-success-border"
                    : "bg-danger-solid text-danger-fg border-danger-border"
                }
              >
                {scrapMetric.sub_value}
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Material + Ink + Shift Control Strip */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="shadow-sm border-line">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Layers className="h-4 w-4 text-primary" />
              Material Control
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-content-3">Issue Discipline</span>
              <span className="font-black">
                {Number(material_control.issue_discipline_pct || 0).toFixed(2)}%
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-content-3">Return Efficiency</span>
              <span className="font-black">
                {Number(material_control.return_efficiency_pct || 0).toFixed(2)}
                %
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-content-3">Net Usage Discipline</span>
              <span className="font-black">
                {Number(material_control.net_usage_discipline_pct || 0).toFixed(
                  2,
                )}
                %
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-content-3">Variance</span>
              <span className="font-black">
                {Number(material_control.variance_kg || 0).toFixed(3)} KG
              </span>
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-sm border-line">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <BadgePercent className="h-4 w-4 text-success-fg" />
              Ink Control
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-content-3">Issued</span>
              <span className="font-black">
                {Number(ink_control.issued_kg || 0).toFixed(3)} KG
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-content-3">Returned</span>
              <span className="font-black">
                {Number(ink_control.returned_kg || 0).toFixed(3)} KG
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-content-3">Consumed</span>
              <span className="font-black">
                {Number(ink_control.consumed_kg || 0).toFixed(3)} KG
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-content-3">Remix Ratio</span>
              <span className="font-black">
                {Number(ink_control.remix_ratio_pct || 0).toFixed(2)}%
              </span>
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-sm border-line">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-danger-fg" />
              Shift + Risk
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-content-3">Shifts with Output</span>
              <span className="font-black">
                {Array.isArray(shift_oee) ? shift_oee.length : 0}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-content-3">Top Shift Output</span>
              <span className="font-black">
                {Number(shift_oee?.[0]?.output_kg || 0).toFixed(3)} KG
              </span>
            </div>
            <div className="text-content-3">Risk Signals</div>
            <div className="space-y-1">
              {(risk_signals || [])
                .slice(0, 2)
                .map((risk: any, idx: number) => (
                  <Badge
                    key={`risk-${idx}`}
                    variant="outline"
                    className="mr-1 mb-1 text-[10px]"
                  >
                    {risk.code || "RISK"}
                  </Badge>
                ))}
              {(!risk_signals || risk_signals.length === 0) && (
                <Badge variant="outline" className="text-[10px]">
                  No active risks
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Graphs */}
      <div className="grid gap-6 md:grid-cols-3 lg:grid-cols-3">
        {/* 6 Month Financial Trend */}
        <Card className="col-span-2 shadow-sm border-line">
          <CardHeader className="border-b border-line pb-4 bg-surface-1 rounded-t-xl">
            <CardTitle className="text-lg flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              6-Month P&L Growth
            </CardTitle>
            <CardDescription>
              Visualizing Cost of Goods vs Gross Revenue historically.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-6 bg-surface-1 rounded-b-xl">
            <ScrollTriggeredChart className="h-[350px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={chartData}
                  margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#2563eb" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient
                      id="colorProfit"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="#e2e8f0"
                  />
                  <XAxis
                    dataKey="name"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#64748b", fontSize: 12 }}
                    dy={10}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#64748b", fontSize: 12 }}
                    tickFormatter={(value) =>
                      `₹${(value / 100000).toFixed(1)}L`
                    }
                  />
                  <RechartsTooltip
                    contentStyle={{
                      borderRadius: "8px",
                      border: "none",
                      boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                    }}
                    formatter={(value: any) =>
                      new Intl.NumberFormat("en-IN", {
                        style: "currency",
                        currency: "INR",
                        maximumFractionDigits: 0,
                      }).format(Number(value))
                    }
                  />
                  <Legend
                    iconType="circle"
                    wrapperStyle={{ paddingTop: "20px" }}
                  />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    name="Rev (₹)"
                    stroke="#2563eb"
                    strokeWidth={3}
                    fillOpacity={1}
                    fill="url(#colorRev)"
                  />
                  <Area
                    type="monotone"
                    dataKey="profit"
                    name="Net Profit (₹)"
                    stroke="#10b981"
                    strokeWidth={3}
                    fillOpacity={1}
                    fill="url(#colorProfit)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </ScrollTriggeredChart>
          </CardContent>
        </Card>

        {/* Active Floor Tracking */}
        <Card className="col-span-1 shadow-sm border-line flex flex-col">
          <CardHeader className="border-b border-line pb-4 bg-surface-1 rounded-t-xl">
            <CardTitle className="text-lg flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" />
              Live Floor Activity
            </CardTitle>
            <CardDescription>
              Top active jobs on the shop floor.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0 overflow-y-auto bg-surface-2 rounded-b-xl h-[398px] max-h-[398px]">
            <div className="divide-y divide-line">
              {active_jobs.length > 0 ? (
                active_jobs.map((job: any) => (
                  <div
                    key={job.id}
                    className="p-4 bg-surface-1 hover:bg-surface-2 transition-colors"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="font-semibold text-content-2 text-sm truncate pr-4">
                        {job.product}
                      </div>
                      <Badge
                        variant="outline"
                        className="bg-info-bg text-primary shrink-0 text-xs"
                      >
                        {job.job_number}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between text-xs text-content-3 mb-1">
                      <span className="font-medium">
                        Operator: {job.operator}
                      </span>
                      <span className="font-bold text-content-2">
                        {job.progress}%
                      </span>
                    </div>
                    <div className="w-full bg-line rounded-full h-1.5 mt-2">
                      <div
                        className="bg-primary h-1.5 rounded-full transition-all duration-500"
                        style={{ width: `${job.progress}%` }}
                      ></div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-8 text-center text-content-3 flex flex-col items-center justify-center h-full">
                  <BadgePercent className="h-12 w-12 text-content-4 mb-3" />
                  <p>No active jobs running.</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Detailed MTD Cost Breakdown */}
      <Card className="shadow-sm border-line">
        <CardHeader className="bg-surface-1 rounded-t-xl border-b border-line">
          <CardTitle className="text-lg">
            MTD Financial Breakdown (Detailed)
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="grid md:grid-cols-4 divide-y md:divide-y-0 md:divide-x divide-line bg-surface-1 rounded-b-xl">
            <div className="p-6">
              <div className="text-sm font-medium text-content-3 mb-1">
                Total Material Cost (COGS)
              </div>
              <div className="text-2xl font-bold text-danger-fg">
                {formatCurrency(financial_summary?.total_cogs || 0)}
              </div>
            </div>
            <div className="p-6">
              <div className="text-sm font-medium text-content-3 mb-1">
                Fixed Overheads
              </div>
              <div className="text-2xl font-bold text-warm">
                {formatCurrency(
                  financial_summary?.overheads?.total_overheads || 0,
                )}
              </div>
              <div className="text-xs text-content-4 mt-1 uppercase tracking-wider">
                Electric / Labor / Ops
              </div>
            </div>
            <div className="p-6">
              <div className="text-sm font-medium text-content-3 mb-1">
                Gross Margin
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold text-content-2">
                  {formatCurrency(financial_summary?.gross_profit || 0)}
                </span>
                <Badge
                  variant="secondary"
                  className="bg-surface-2 text-content-3 font-bold"
                >
                  {financial_summary?.gross_margin_pct?.toFixed(1)}%
                </Badge>
              </div>
            </div>
            <div className="p-6 bg-info-bg">
              <div className="text-sm font-medium text-content-3 mb-1">
                Net Flowing Profit
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold text-primary">
                  {formatCurrency(financial_summary?.net_profit || 0)}
                </span>
                <Badge className="bg-primary hover:bg-primary font-bold">
                  NET {financial_summary?.net_margin_pct?.toFixed(1)}%
                </Badge>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Operational & Sales Charts */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-2">
        {/* Production Trend */}
        <Card className="shadow-sm border-line">
          <CardHeader className="border-b border-line pb-4 bg-surface-1 rounded-t-xl">
            <CardTitle className="text-lg flex items-center gap-2">
              <Activity className="h-5 w-5 text-success-fg" />
              Production Output (Last 30 Days)
            </CardTitle>
            <CardDescription>Daily manufactured KG weight.</CardDescription>
          </CardHeader>
          <CardContent className="p-6 bg-surface-1 rounded-b-xl">
            <ScrollTriggeredChart className="h-[250px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={production_trend}
                  margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="#e2e8f0"
                  />
                  <XAxis
                    dataKey="date"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#64748b", fontSize: 11 }}
                    dy={10}
                    tickFormatter={formatChartDate}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#64748b", fontSize: 11 }}
                  />
                  <RechartsTooltip
                    contentStyle={{
                      borderRadius: "8px",
                      border: "none",
                      boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                      fontSize: "12px",
                    }}
                    labelFormatter={formatChartDate}
                    formatter={(value: any) => [
                      `${Number(value).toFixed(1)} KG`,
                      "Production",
                    ]}
                  />
                  <Bar
                    dataKey="count"
                    fill="#10b981"
                    radius={[4, 4, 0, 0]}
                    barSize={12}
                  />
                </BarChart>
              </ResponsiveContainer>
            </ScrollTriggeredChart>
          </CardContent>
        </Card>

        {/* Scrap Trend */}
        <Card className="shadow-sm border-line">
          <CardHeader className="border-b border-line pb-4 bg-surface-1 rounded-t-xl">
            <CardTitle className="text-lg flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-danger-fg" />
              Scrap Generation (Last 30 Days)
            </CardTitle>
            <CardDescription>Daily waste measured footprint.</CardDescription>
          </CardHeader>
          <CardContent className="p-6 bg-surface-1 rounded-b-xl">
            <ScrollTriggeredChart className="h-[250px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={scrap_trend}
                  margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="colorScrap" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="#e2e8f0"
                  />
                  <XAxis
                    dataKey="date"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#64748b", fontSize: 11 }}
                    dy={10}
                    tickFormatter={formatChartDate}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#64748b", fontSize: 11 }}
                  />
                  <RechartsTooltip
                    contentStyle={{
                      borderRadius: "8px",
                      border: "none",
                      boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                      fontSize: "12px",
                    }}
                    labelFormatter={formatChartDate}
                    formatter={(value: any) => [
                      `${Number(value).toFixed(1)} KG`,
                      "Scrap Weight",
                    ]}
                  />
                  <Area
                    type="monotone"
                    dataKey="count"
                    stroke="#f43f5e"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#colorScrap)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </ScrollTriggeredChart>
          </CardContent>
        </Card>

        {/* Sales Volume */}
        <Card className="shadow-sm border-line">
          <CardHeader className="border-b border-line pb-4 bg-surface-1 rounded-t-xl">
            <CardTitle className="text-lg flex items-center gap-2">
              <ShoppingCart className="h-5 w-5 text-primary" />
              Sales Order Volume (Last 30 Days)
            </CardTitle>
            <CardDescription>Total ordered weight per day.</CardDescription>
          </CardHeader>
          <CardContent className="p-6 bg-surface-1 rounded-b-xl">
            <ScrollTriggeredChart className="h-[250px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={sales_trend}
                  margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
                >
                  <defs>
                    <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    vertical={false}
                    stroke="#e2e8f0"
                  />
                  <XAxis
                    dataKey="date"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#64748b", fontSize: 11 }}
                    dy={10}
                    tickFormatter={formatChartDate}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#64748b", fontSize: 11 }}
                  />
                  <RechartsTooltip
                    contentStyle={{
                      borderRadius: "8px",
                      border: "none",
                      boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                      fontSize: "12px",
                    }}
                    labelFormatter={formatChartDate}
                    formatter={(value: any) => [
                      `${Number(value).toFixed(1)} KG`,
                      "Order Weight",
                    ]}
                  />
                  <Area
                    type="monotone"
                    dataKey="weight"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#colorSales)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </ScrollTriggeredChart>
          </CardContent>
        </Card>

        {/* Top Customers (Volume) */}
        <Card className="shadow-sm border-line">
          <CardHeader className="border-b border-line pb-4 bg-surface-1 rounded-t-xl">
            <CardTitle className="text-lg flex items-center gap-2">
              <Users className="h-5 w-5 text-primary" />
              Top Customers (Volume)
            </CardTitle>
            <CardDescription>
              Highest ordering clients by weight.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-6 bg-surface-1 rounded-b-xl">
            <ScrollTriggeredChart className="h-[250px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={top_customers}
                  layout="vertical"
                  margin={{ top: 0, right: 10, left: 10, bottom: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    horizontal={false}
                    stroke="#e2e8f0"
                  />
                  <XAxis
                    type="number"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#64748b", fontSize: 11 }}
                  />
                  <YAxis
                    type="category"
                    dataKey="customer_name"
                    width={100}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#64748b", fontSize: 10 }}
                  />
                  <RechartsTooltip
                    contentStyle={{
                      borderRadius: "8px",
                      border: "none",
                      boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                      fontSize: "12px",
                    }}
                    formatter={(value: any) => [
                      `${Number(value).toFixed(1)} KG`,
                      "Ordered Volume",
                    ]}
                  />
                  <Bar
                    dataKey="total_weight"
                    fill="#60a5fa"
                    radius={[0, 4, 4, 0]}
                    barSize={15}
                  />
                </BarChart>
              </ResponsiveContainer>
            </ScrollTriggeredChart>
          </CardContent>
        </Card>
      </div>

      {/* Third Row: Job Distribution & More Insights */}
      <div className="grid gap-6 md:grid-cols-3 lg:grid-cols-3">
        <Card className="shadow-sm border-line col-span-1">
          <CardHeader className="border-b border-line pb-4 bg-surface-1 rounded-t-xl">
            <CardTitle className="text-lg flex items-center gap-2">
              <Layers className="h-5 w-5 text-warning-fg" />
              Active Job Distribution
            </CardTitle>
            <CardDescription>
              Current states of all shop floor jobs.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-6 bg-surface-1 rounded-b-xl">
            <ScrollTriggeredChart className="h-[250px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={job_distribution}
                  layout="vertical"
                  margin={{ top: 0, right: 10, left: 30, bottom: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    horizontal={false}
                    stroke="#e2e8f0"
                  />
                  <XAxis
                    type="number"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#64748b", fontSize: 11 }}
                  />
                  <YAxis
                    type="category"
                    dataKey="status"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#64748b", fontSize: 11, fontWeight: 500 }}
                  />
                  <RechartsTooltip
                    contentStyle={{
                      borderRadius: "8px",
                      border: "none",
                      boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                      fontSize: "12px",
                    }}
                    formatter={(value: any) => [value, "Jobs"]}
                  />
                  <Bar
                    dataKey="count"
                    fill="#fbbf24"
                    radius={[0, 4, 4, 0]}
                    barSize={20}
                  />
                </BarChart>
              </ResponsiveContainer>
            </ScrollTriggeredChart>
          </CardContent>
        </Card>

        {/* Inventory Distribution */}
        <Card className="shadow-sm border-line">
          <CardHeader className="border-b border-line pb-4 bg-surface-1 rounded-t-xl">
            <CardTitle className="text-lg flex items-center gap-2">
              <Package className="h-5 w-5 text-primary" />
              Inventory Spread
            </CardTitle>
            <CardDescription>RM vs WIP vs Finished Goods</CardDescription>
          </CardHeader>
          <CardContent className="p-6 bg-surface-1 rounded-b-xl flex justify-center items-center">
            <ScrollTriggeredChart className="h-[250px] w-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={inventory_distribution}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {inventory_distribution.map((entry: any, index: number) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={COLORS[index % COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <RechartsTooltip
                    formatter={(val: any) => `${Number(val).toFixed(1)} KG`}
                  />
                  <Legend
                    verticalAlign="bottom"
                    height={36}
                    iconType="circle"
                  />
                </PieChart>
              </ResponsiveContainer>
            </ScrollTriggeredChart>
          </CardContent>
        </Card>

        {/* Top Selling SKUs */}
        <Card className="shadow-sm border-line">
          <CardHeader className="border-b border-line pb-4 bg-surface-1 rounded-t-xl">
            <CardTitle className="text-lg flex items-center gap-2">
              <ShoppingCart className="h-5 w-5 text-success-fg" />
              Top Selling SKUs
            </CardTitle>
            <CardDescription>
              Highest volume by Template (30 Days)
            </CardDescription>
          </CardHeader>
          <CardContent className="p-6 bg-surface-1 rounded-b-xl">
            <ScrollTriggeredChart className="h-[250px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={sku_performance}
                  layout="vertical"
                  margin={{ top: 0, right: 10, left: 10, bottom: 0 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    horizontal={false}
                    stroke="#e2e8f0"
                  />
                  <XAxis
                    type="number"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#64748b", fontSize: 11 }}
                  />
                  <YAxis
                    type="category"
                    dataKey="sku_name"
                    width={100}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#64748b", fontSize: 10 }}
                  />
                  <RechartsTooltip
                    contentStyle={{
                      borderRadius: "8px",
                      border: "none",
                      boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                      fontSize: "12px",
                    }}
                    formatter={(value: any) => [
                      `${Number(value).toFixed(1)} KG`,
                      "Sold Volume",
                    ]}
                  />
                  <Bar
                    dataKey="weight_kg"
                    fill="#10b981"
                    radius={[0, 4, 4, 0]}
                    barSize={15}
                  />
                </BarChart>
              </ResponsiveContainer>
            </ScrollTriggeredChart>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Truck, Package, MoveRight, Receipt, Activity } from "lucide-react";
import Link from "next/link";
import { logisticsService } from "@/services/logistics";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

export default function LogisticsDashboard() {
  const {
    data: challanData,
    isLoading: loadingChallans,
    isError: challansError,
    isFetched: challansFetched,
    refetch: refetchChallans,
  } = useQuery({
    queryKey: ["logistics-challans-all"],
    queryFn: async () => await logisticsService.getChallans(),
  });

  const {
    data: salesOrderData,
    isLoading: loadingSO,
    isError: salesOrdersError,
    isFetched: salesOrdersFetched,
    refetch: refetchSalesOrders,
  } = useQuery({
    queryKey: ["logistics-sales-orders"],
    queryFn: async () => await logisticsService.getSalesOrdersWithFG(),
  });

  const challansReady = Array.isArray(challanData) && !challansError;
  const salesOrdersReady = Array.isArray(salesOrderData) && !salesOrdersError;
  const challans = challansReady ? challanData : [];
  const salesOrders = salesOrdersReady ? salesOrderData : [];
  const feedUnavailable =
    challansError ||
    salesOrdersError ||
    (challansFetched && !challansReady) ||
    (salesOrdersFetched && !salesOrdersReady);

  const summary = useMemo(() => {
    const draftChallans = challans.filter((c) => c.status === "DRAFT").length;
    const dispatchedChallans = challans.filter(
      (c) => c.status === "DISPATCHED",
    ).length;
    const inTransit = challans.filter((c) => c.status === "IN_TRANSIT").length;
    const received = challans.filter((c) => c.status === "RECEIVED").length;

    const today = new Date().toDateString();
    const shippedToday = challans.filter(
      (c) =>
        (c.status === "DISPATCHED" ||
          c.status === "IN_TRANSIT" ||
          c.status === "RECEIVED") &&
        c.dispatch_date &&
        new Date(c.dispatch_date).toDateString() === today,
    ).length;

    const statusCounts = {
      DRAFT: draftChallans,
      DISPATCHED: dispatchedChallans,
      IN_TRANSIT: inTransit,
      RECEIVED: received,
    };

    const chartData = [
      { name: "Drafts", count: draftChallans },
      { name: "Dispatched", count: dispatchedChallans },
      { name: "In Transit", count: inTransit },
      { name: "Received", count: received },
    ];

    return {
      draftChallans,
      shippedToday,
      inTransit,
      readyOrders: salesOrders.length,
      chartData,
      recentChallans: challans.slice(0, 5),
    };
  }, [challans, salesOrders]);

  const metrics = [
    {
      id: "drafts",
      label: "Pending Challans",
      value: challansReady ? String(summary.draftChallans) : "—",
      unit: challansReady ? "Drafts" : "Unavailable",
      icon: Receipt,
      color: "text-warning-fg",
      bg: "bg-warning-bg",
      ring: "ring-warning-border",
    },
    {
      id: "ready",
      label: "Dispatch Ready",
      value: salesOrdersReady ? String(summary.readyOrders) : "—",
      unit: salesOrdersReady ? "Orders w/ FG" : "Unavailable",
      icon: Package,
      color: "text-success-fg",
      bg: "bg-success-bg",
      ring: "ring-success-border",
    },
    {
      id: "transit",
      label: "Vehicles Loading/Transit",
      value: challansReady ? String(summary.inTransit) : "—",
      unit: challansReady ? "Active" : "Unavailable",
      icon: Truck,
      color: "text-primary",
      bg: "bg-info-bg",
      ring: "ring-info-border",
    },
    {
      id: "shipped",
      label: "Shipped Today",
      value: challansReady ? String(summary.shippedToday) : "—",
      unit: challansReady ? "Trucks" : "Unavailable",
      icon: MoveRight,
      color: "text-primary",
      bg: "bg-info-bg",
      ring: "ring-info-border",
    },
  ];

  return (
    <div className="space-y-8 pb-10 max-w-7xl mx-auto block xl:px-4">
      {/* Header / Hero Section */}
      <div className="relative overflow-hidden rounded-3xl bg-surface-1 border border-line p-8 shadow-sm">
        <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-primary blur-3xl pointer-events-none" />
        <div className="absolute -bottom-20 -left-20 h-64 w-64 rounded-full bg-warning-fg blur-3xl pointer-events-none" />

        <div className="relative flex flex-col md:flex-row items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="flex h-2 w-2 rounded-full bg-success-fg animate-pulse" />
              <span className="text-xs font-bold uppercase tracking-widest text-content-4">
                Logistics Network
              </span>
            </div>
            <h1 className="text-4xl font-black tracking-tight mb-2 text-content-1">
              Total Logistics Hub
            </h1>
            <p className="text-content-3 max-w-md font-medium">
              Govern all outbound delivery flows, print challans, and track
              active transport.
            </p>
          </div>
          <Link href="/logistics/dispatch">
            <Button
              size="lg"
              className="bg-primary text-white hover:bg-primary font-bold px-8 rounded-xl shadow-md transition-all"
            >
              <Truck className="mr-2 h-5 w-5" /> Open Dispatch Bay
            </Button>
          </Link>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {metrics.map((metric) => (
          <Card
            key={metric.id}
            className={`group relative overflow-hidden border-none shadow-sm ring-1 bg-surface-1 transition-all duration-300 ${metric.ring}`}
          >
            <div
              className={`absolute top-0 right-0 p-4 opacity-10 ${metric.color}`}
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
                {metric.value}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2 text-sm mt-1">
                <Badge
                  variant="outline"
                  className={`${metric.bg} ${metric.color} border-transparent`}
                >
                  {metric.unit}
                </Badge>
              </div>
            </CardContent>
            <div
              className={`h-1 w-full absolute bottom-0 ${metric.bg.replace("50", "400")}`}
            ></div>
          </Card>
        ))}
      </div>

      {feedUnavailable ? (
        <div className="rounded-2xl border border-warning-border bg-warning-bg p-4 text-sm font-semibold leading-6 text-warning-fg">
          Logistics data feed is unavailable. Dispatch KPIs are paused instead of showing fallback zeros.
          <Button
            variant="outline"
            className="ml-3 h-8 rounded-full"
            onClick={() => {
              refetchChallans();
              refetchSalesOrders();
            }}
          >
            Retry
          </Button>
        </div>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-3">
        {/* Protocol Metrics Bar Chart */}
        <Card className="lg:col-span-2 border border-line shadow-sm bg-surface-1 rounded-2xl overflow-hidden">
          <CardHeader className="pb-2">
            <CardTitle className="text-xl font-black text-content-1">
              Challan Flow Distribution
            </CardTitle>
            <CardDescription className="font-medium text-content-3">
              Live active tracking metrics for all generated DCs.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[250px] w-full mt-4">
              {challansReady ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={summary.chartData}
                  margin={{ top: 10, right: 10, left: -20, bottom: 0 }}
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
                  <Bar
                    dataKey="count"
                    fill="#3b82f6"
                    radius={[4, 4, 0, 0]}
                    barSize={40}
                  >
                    {summary.chartData.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={
                          entry.name === "Drafts"
                            ? "#f59e0b"
                            : entry.name === "Dispatched"
                              ? "#3b82f6"
                              : entry.name === "In Transit"
                                ? "#60a5fa"
                                : "#10b981"
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-line bg-surface-2 px-4 text-center text-sm font-semibold text-content-3">
                  Challan flow is unavailable until the logistics API syncs again.
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Recent Challans List */}
        <Card className="border border-line shadow-sm bg-surface-1 rounded-2xl overflow-hidden">
          <CardHeader className="pb-2 border-b border-line">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-lg font-black text-content-1">
                  Execution Ledger
                </CardTitle>
                <CardDescription className="text-xs font-bold text-content-4 uppercase tracking-wider">
                  Latest Validated DCs
                </CardDescription>
              </div>
              <Activity className="h-5 w-5 text-info-fg animate-pulse" />
            </div>
          </CardHeader>
          <CardContent className="space-y-0 p-0">
            {challansReady && summary.recentChallans.map((challan: any) => (
              <div
                key={challan.id}
                className="flex flex-col p-4 border-b border-line hover:bg-surface-2 transition-colors group"
              >
                <div className="flex justify-between items-start mb-1">
                  <span className="text-sm font-black text-content-1 font-mono group-hover:text-primary transition-colors">
                    {challan.dc_no}
                  </span>
                  <span
                    className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-md ${
                      challan.status === "DRAFT"
                        ? "bg-warning-bg text-warning-fg"
                        : challan.status === "DISPATCHED"
                          ? "bg-info-bg text-primary"
                          : challan.status === "IN_TRANSIT"
                            ? "bg-info-bg text-primary"
                            : "bg-success-bg text-success-fg"
                    }`}
                  >
                    {challan.status}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-content-3 capitalize truncate max-w-[150px]">
                    {challan.customer_name}
                  </span>
                  {challan.vehicle_no && (
                    <span className="text-[10px] font-black uppercase text-content-4 flex items-center gap-1">
                      <Truck className="w-3 h-3" /> {challan.vehicle_no}
                    </span>
                  )}
                </div>
              </div>
            ))}
            {(!challansReady || summary.recentChallans.length === 0) && (
              <p className="text-sm font-medium text-content-4 text-center py-6 italic">
                {challansReady ? "No recent challans found." : "Challan ledger unavailable until the logistics API syncs again."}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

"use client";

import { useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { costingService } from "@/services/costing";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import {
  Loader2,
  RefreshCw,
  Layers,
  ShoppingCart,
  Activity,
  ShieldCheck,
  ChevronRight,
  ArrowLeft,
  Target,
  TrendingUp,
  DollarSign,
} from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";

export default function OrderProfitabilityPage() {
  const params = useParams();
  const id = Array.isArray(params?.id)
    ? params.id[0]
    : String(params?.id || "");
  const queryClient = useQueryClient();

  const { data: cost, isLoading } = useQuery({
    queryKey: ["order-cost", id],
    queryFn: () =>
      costingService
        .getOrderCosts()
        .then((list) => list.find((o) => o.sales_order_item === id)),
  });

  const calculateMutation = useMutation({
    mutationFn: () => costingService.calculateOrderItemCost(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["order-cost", id] });
    },
  });

  if (isLoading) {
    return (
      <div className="flex h-[80vh] items-center justify-center bg-[#f8fafc]">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  if (!cost) {
    return (
      <div className="flex h-[80vh] flex-col items-center justify-center bg-[#f8fafc] text-center space-y-6">
        <ShieldCheck className="h-16 w-16 text-content-4" />
        <div className="space-y-2">
          <h2 className="text-xl font-black text-content-1 uppercase italic">
            Cost Data Not Found
          </h2>
          <p className="text-sm text-content-3 font-bold uppercase tracking-widest">
            Pricing engine needs a manual trigger for this specific order item
          </p>
        </div>
        <Button
          onClick={() => calculateMutation.mutate()}
          disabled={calculateMutation.isPending}
          className="h-12 px-8 rounded-xl bg-surface-3 hover:bg-primary text-white font-black uppercase text-xs tracking-[0.2em] shadow-xl"
        >
          {calculateMutation.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          Initialize Cost Calculation
        </Button>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-10 space-y-10 bg-[#f8fafc] min-h-screen">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-1">
          <Link
            href="/analytics/costing"
            className="inline-flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-content-4 hover:text-primary transition-colors mb-4 group"
          >
            <ArrowLeft className="h-3 w-3 group-hover:-translate-x-1 transition-transform" />{" "}
            Back to Center
          </Link>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-info-bg border border-info-border text-primary text-[10px] font-black uppercase tracking-widest shadow-sm">
            <ShoppingCart className="h-3 w-3 fill-info-fg" /> Order Intelligence
          </div>
          <h1 className="text-4xl font-black tracking-tight text-content-1 flex items-center gap-3 italic">
            {cost.order_number}{" "}
            <span className="text-primary">Profitability</span>
          </h1>
          <p className="text-content-3 font-medium text-sm flex items-center gap-2 uppercase tracking-wide">
            {cost.customer_name} <ChevronRight className="h-3 w-3" />{" "}
            {cost.product_name}
          </p>
        </div>
        <Button
          onClick={() => calculateMutation.mutate()}
          disabled={calculateMutation.isPending}
          variant="outline"
          className="h-12 px-6 rounded-xl border-line font-black uppercase text-xs tracking-widest active:scale-95 transition-all bg-surface-1"
        >
          {calculateMutation.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          Refresh Deep-Dive
        </Button>
      </div>

      {/* Profitability Snapshot */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <Card className="lg:col-span-1 border-none bg-surface-3 text-white rounded-[2.5rem] p-8 flex flex-col justify-between shadow-premium overflow-hidden relative">
          <div className="absolute top-0 right-0 p-8 opacity-10">
            <Target className="h-32 w-32" />
          </div>
          <div>
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-content-3 mb-2 italic">
              Net Profit Margin
            </p>
            <h2 className="text-6xl font-black tracking-tighter italic">
              {Number(cost.margin_percent).toFixed(1)}%
            </h2>
            <div className="mt-4 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-surface-1/10 text-[10px] font-black uppercase tracking-widest">
              {Number(cost.margin_percent) > 15
                ? "Healthy Profit"
                : "Low Margin Alert"}
            </div>
          </div>
          <div className="mt-12 pt-8 border-t border-surface-1/10">
            <div className="flex justify-between items-end">
              <span className="text-[10px] font-black uppercase text-content-3 italic">
                Margin Value
              </span>
              <span className="text-2xl font-black tabular-nums">
                ₹{Math.round(Number(cost.margin_value)).toLocaleString()}
              </span>
            </div>
          </div>
        </Card>

        <div className="lg:col-span-3 grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            {
              label: "Sales Price",
              value: `₹${Math.round(Number(cost.selling_price)).toLocaleString()}`,
              icon: DollarSign,
              color: "text-success-fg",
              desc: "Total billable value",
            },
            {
              label: "Material Cost",
              value: `₹${Math.round(Number(cost.material_cost)).toLocaleString()}`,
              icon: Layers,
              color: "text-primary",
              desc: "Film + Ink + POD + RM",
            },
            {
              label: "Conversion Cost",
              value: `₹${Math.round(Number(cost.conversion_cost)).toLocaleString()}`,
              icon: Activity,
              color: "text-warning-fg",
              desc: "Process hourly overheads",
            },
          ].map((kpi, i) => (
            <Card
              key={i}
              className="border-none shadow-soft rounded-[2rem] p-8 bg-surface-1 group hover:shadow-xl transition-all"
            >
              <div
                className={cn(
                  "p-3 rounded-2xl bg-surface-2 w-fit mb-6 transition-transform group-hover:scale-110",
                  kpi.color,
                )}
              >
                <kpi.icon className="h-6 w-6" />
              </div>
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-content-4 mb-1">
                {kpi.label}
              </p>
              <h3 className="text-2xl font-black text-content-1 uppercase tracking-tighter tabular-nums">
                {kpi.value}
              </h3>
              <p className="text-[10px] font-bold text-content-3 uppercase tracking-tight mt-4 italic opacity-0 group-hover:opacity-100 transition-opacity">
                {kpi.desc}
              </p>
            </Card>
          ))}

          {/* Progress Bar Visualization */}
          <Card className="md:col-span-3 border-none shadow-soft rounded-[2.5rem] p-10 bg-surface-1">
            <div className="flex items-center justify-between mb-8">
              <div className="flex flex-col">
                <span className="text-xs font-black uppercase tracking-[0.2em] text-content-1">
                  Total Lifecycle Cost Impact
                </span>
                <span className="text-[10px] font-bold text-content-4 uppercase tracking-widest mt-1">
                  ₹{Math.round(Number(cost.total_cost)).toLocaleString()} Total
                  Spending
                </span>
              </div>
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-primary" />
                  <span className="text-[10px] font-black uppercase text-content-3">
                    Materials (
                    {(
                      (Number(cost.material_cost) / Number(cost.total_cost)) *
                      100
                    ).toFixed(0)}
                    %)
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-warning-fg" />
                  <span className="text-[10px] font-black uppercase text-content-3">
                    Conversion (
                    {(
                      (Number(cost.conversion_cost) / Number(cost.total_cost)) *
                      100
                    ).toFixed(0)}
                    %)
                  </span>
                </div>
              </div>
            </div>
            <div className="h-6 w-full bg-surface-2 rounded-full overflow-hidden flex shadow-inner">
              <div
                className="h-full bg-primary transition-all duration-1000"
                style={{
                  width: `${(Number(cost.material_cost) / Number(cost.total_cost)) * 100}%`,
                }}
              />
              <div
                className="h-full bg-warning-fg transition-all duration-1000"
                style={{
                  width: `${(Number(cost.conversion_cost) / Number(cost.total_cost)) * 100}%`,
                }}
              />
            </div>
          </Card>
        </div>
      </div>

      {/* Detailed Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <Card className="border-none shadow-premium rounded-[2.5rem] overflow-hidden bg-surface-1">
          <CardHeader className="bg-surface-2 p-8 border-b border-line">
            <CardTitle className="text-xs font-black uppercase tracking-[0.2em] text-content-1 flex items-center gap-3">
              <Layers className="h-4 w-4 text-primary" />
              Material Components
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 h-[400px] overflow-auto scrollbar-hide">
            <div className="p-8 flex flex-col items-center justify-center h-full text-center opacity-30 select-none">
              <Layers className="h-12 w-12 mb-4" />
              <p className="font-black text-[10px] uppercase tracking-widest">
                Physics-Integrated BOM Breakdown
              </p>
              <p className="text-[9px] font-bold mt-2 leading-relaxed">
                Detailed material cost tracing is active.
                <br />
                Rates snapshot used from run date.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-none shadow-premium rounded-[2.5rem] overflow-hidden bg-surface-1">
          <CardHeader className="bg-surface-2 p-8 border-b border-line">
            <CardTitle className="text-xs font-black uppercase tracking-[0.2em] text-content-1 flex items-center gap-3">
              <Activity className="h-4 w-4 text-warning-fg" />
              Process Routing Costs
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 h-[400px] overflow-auto scrollbar-hide">
            <div className="p-8 flex flex-col items-center justify-center h-full text-center opacity-30 select-none">
              <Activity className="h-12 w-12 mb-4" />
              <p className="font-black text-[10px] uppercase tracking-widest">
                Routing Rule Execution Impact
              </p>
              <p className="text-[9px] font-bold mt-2 leading-relaxed">
                Stage-wise conversion cost tracing.
                <br />
                Power, labor, and overhead allocation logic.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

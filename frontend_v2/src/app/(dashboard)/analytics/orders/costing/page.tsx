"use client";

import { useQuery } from "@tanstack/react-query";
import { costingService, OrderCost } from "@/services/costing";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  Search,
  ArrowRight,
  ChevronRight,
  TrendingDown,
  AlertCircle,
  CheckCircle2,
  DollarSign,
  Filter,
  Download,
} from "lucide-react";
import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import Link from "next/link";

export default function OrderProfitabilityListPage() {
  const [search, setSearch] = useState("");

  const { data: orderCosts, isLoading } = useQuery({
    queryKey: ["order-costs-list"],
    queryFn: costingService.getOrderCosts,
  });

  const filteredCosts = useMemo(() => {
    if (!orderCosts) return [];
    return orderCosts.filter(
      (o) =>
        o.order_number.toLowerCase().includes(search.toLowerCase()) ||
        o.customer_name.toLowerCase().includes(search.toLowerCase()) ||
        o.product_name.toLowerCase().includes(search.toLowerCase()),
    );
  }, [orderCosts, search]);

  if (isLoading) {
    return (
      <div className="flex h-[80vh] items-center justify-center bg-[#f8fafc]">
        <div className="text-center space-y-4">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
          <p className="text-sm font-black uppercase tracking-[0.2em] text-content-4 italic">
            Downloading Profitability Ledger...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-10 space-y-10 bg-[#f8fafc] min-h-screen">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-info-bg border border-info-border text-primary text-[10px] font-black uppercase tracking-widest shadow-sm">
            <DollarSign className="h-3 w-3 fill-info-fg" /> Commercial Analytics
          </div>
          <h1 className="text-4xl font-black tracking-tight text-content-1 flex items-center gap-3 italic">
            Order <span className="text-primary">Profitability</span>
          </h1>
          <p className="text-content-3 font-medium text-sm flex items-center gap-2">
            Comprehensive ledger of all produced orders and their financial
            performance <ChevronRight className="h-3 w-3" /> SKU Level
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-content-4" />
            <Input
              placeholder="Filter orders, customers or SKUs..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-12 w-80 pl-12 rounded-xl border-surface-1 shadow-md font-bold text-sm bg-surface-1"
            />
          </div>
          <Button
            variant="outline"
            className="h-12 w-12 rounded-xl bg-surface-1 border-surface-1 shadow-md p-0 hover:bg-surface-2"
          >
            <Filter className="h-4 w-4 text-content-3" />
          </Button>
          <Button className="h-12 px-6 rounded-xl bg-surface-3 border-none shadow-xl hover:bg-primary text-white font-black uppercase text-[10px] tracking-widest transition-all">
            <Download className="h-4 w-4 mr-2" /> Export
          </Button>
        </div>
      </div>

      {/* Matrix Card */}
      <Card className="border-none shadow-xl rounded-[2.5rem] overflow-hidden bg-surface-1">
        <Table>
          <TableHeader className="bg-surface-2">
            <TableRow className="border-none">
              <TableHead className="text-[10px] font-black uppercase text-content-4 py-6 px-8 italic">
                Order Details
              </TableHead>
              <TableHead className="text-[10px] font-black uppercase text-content-4 py-6 italic text-center text-primary font-black tracking-widest leading-none mt-1">
                Direct Material
              </TableHead>
              <TableHead className="text-[10px] font-black uppercase text-content-4 py-6 italic text-center">
                Conversion
              </TableHead>
              <TableHead className="text-[10px] font-black uppercase text-content-4 py-6 italic text-center">
                Total Cost
              </TableHead>
              <TableHead className="text-[10px] font-black uppercase text-content-4 py-6 italic text-center">
                Sales Price
              </TableHead>
              <TableHead className="text-[10px] font-black uppercase text-content-4 py-6 italic text-right">
                Margin Health
              </TableHead>
              <TableHead className="text-right py-6 px-8"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredCosts.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="h-60 text-center">
                  <div className="flex flex-col items-center justify-center space-y-3 opacity-30">
                    <AlertCircle className="h-12 w-12 text-content-4" />
                    <p className="font-black uppercase tracking-widest text-xs">
                      No matching orders found in the ledger
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            )}
            {filteredCosts.map((o) => {
              const margin = Number(o.margin_percent);
              const isLoss = margin < 0;
              const isHealthy = margin > 15;

              return (
                <TableRow
                  key={o.id}
                  className="hover:bg-surface-2 transition-colors border-b border-line last:border-none group"
                >
                  <TableCell className="py-8 px-8">
                    <div className="flex flex-col">
                      <span className="font-black text-content-1 uppercase tracking-tight text-[14px] leading-tight italic">
                        {o.order_number}
                      </span>
                      <span className="text-[9px] font-bold text-content-4 uppercase tracking-[0.1em] mt-1">
                        {o.customer_name}
                      </span>
                      <span className="text-[10px] font-bold text-primary uppercase mt-1 italic">
                        {o.product_name}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    <span className="font-black text-content-3 text-[13px] tabular-nums">
                      ₹{Math.round(Number(o.material_cost)).toLocaleString()}
                    </span>
                  </TableCell>
                  <TableCell className="text-center">
                    <span className="font-black text-content-3 text-[13px] tabular-nums">
                      ₹{Math.round(Number(o.conversion_cost)).toLocaleString()}
                    </span>
                  </TableCell>
                  <TableCell className="text-center">
                    <div className="inline-flex flex-col items-center">
                      <span className="font-black text-content-1 text-[13px] tabular-nums">
                        ₹{Math.round(Number(o.total_cost)).toLocaleString()}
                      </span>
                      <span className="text-[8px] font-black uppercase text-content-4 mt-0.5 tracking-tighter">
                        Manufacturing Value
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    <span className="font-black text-content-1 text-[13px] tabular-nums">
                      ₹{Math.round(Number(o.selling_price)).toLocaleString()}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex flex-col items-end">
                      <span
                        className={cn(
                          "font-black text-sm tabular-nums italic",
                          isLoss
                            ? "text-danger-fg"
                            : isHealthy
                              ? "text-success-fg"
                              : "text-warning-fg",
                        )}
                      >
                        {isLoss ? "-" : "+"}₹
                        {Math.abs(
                          Math.round(Number(o.margin_value)),
                        ).toLocaleString()}
                      </span>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[8px] font-black uppercase tracking-tighter h-4 mt-1 border-none bg-opacity-10",
                          isLoss
                            ? "bg-danger-solid text-danger-fg"
                            : isHealthy
                              ? "bg-success-fg text-success-fg"
                              : "bg-warning-fg text-warning-fg",
                        )}
                      >
                        {o.margin_percent}% {isLoss ? "Loss" : "Margin"}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="text-right px-8">
                    <Link
                      href={`/analytics/orders/${o.sales_order_item}/costing`}
                    >
                      <Button
                        variant="ghost"
                        className="h-10 w-10 p-0 rounded-xl text-content-4 hover:text-primary hover:bg-info-bg border border-line group-hover:border-info-border transition-all"
                      >
                        <ArrowRight className="h-4 w-4" />
                      </Button>
                    </Link>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      {/* Legend / Stats */}
      <div className="flex items-center justify-between gap-8 px-8 opacity-60">
        <div className="flex gap-10">
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 rounded-full bg-danger-solid shadow-sm" />
            <span className="text-[10px] font-black uppercase tracking-widest text-content-3 italic">
              Loss Making / Critical
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 rounded-full bg-warning-fg shadow-sm" />
            <span className="text-[10px] font-black uppercase tracking-widest text-content-3 italic">
              Low Margin (&lt; 15%)
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div className="w-3 h-3 rounded-full bg-success-fg shadow-sm" />
            <span className="text-[10px] font-black uppercase tracking-widest text-content-3 italic">
              Target Margin Healthy
            </span>
          </div>
        </div>
        <div className="bg-surface-1 px-6 py-3 rounded-2xl border border-surface-1 shadow-md">
          <p className="text-[9px] font-black text-content-4 uppercase tracking-widest">
            Total Evaluated Orders:{" "}
            <span className="text-primary">{orderCosts?.length || 0}</span>
          </p>
        </div>
      </div>
    </div>
  );
}

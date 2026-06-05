"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Plus,
  Search,
  Repeat,
  ClipboardList,
  Truck,
  CheckCircle2,
  XCircle,
} from "lucide-react";

import { GradientHero } from "@/components/erp/gradient-hero";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  tradeOrderService,
  type TradeOrder,
  type TradeOrderStatus,
} from "@/services/trade-orders";

const STATUS_TONE: Record<TradeOrderStatus, string> = {
  DRAFT: "border-line bg-surface-2 text-content-2",
  CONFIRMED: "border-warning-border bg-warning-bg text-warning-fg",
  DISPATCHED: "border-success-border bg-success-bg text-success-fg",
  INVOICED: "border-order-border bg-order-bg text-order-fg",
  CANCELLED: "border-danger-border bg-danger-bg text-danger-fg",
};

const STATUS_FILTERS: { value: "" | TradeOrderStatus; label: string }[] = [
  { value: "", label: "All" },
  { value: "DRAFT", label: "Draft" },
  { value: "CONFIRMED", label: "Confirmed" },
  { value: "DISPATCHED", label: "Dispatched" },
  { value: "INVOICED", label: "Invoiced" },
  { value: "CANCELLED", label: "Cancelled" },
];

export default function TradeOrdersListPage() {
  const [q, setQ] = React.useState("");
  const [status, setStatus] = React.useState<"" | TradeOrderStatus>("");

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ["trade-orders"],
    queryFn: () => tradeOrderService.list(),
    staleTime: 20_000,
  });

  const filtered = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    let rows = orders;
    if (status) rows = rows.filter((o) => o.status === status);
    if (!needle) return rows;
    return rows.filter((o) =>
      [o.code, o.customer_name, o.notes, o.invoice_no]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(needle)),
    );
  }, [orders, q, status]);

  const draftCount = orders.filter((o) => o.status === "DRAFT").length;
  const confirmedCount = orders.filter((o) => o.status === "CONFIRMED").length;
  const dispatchedCount = orders.filter(
    (o) => o.status === "DISPATCHED",
  ).length;

  return (
    <div className="min-h-screen bg-gradient-to-b from-danger-bg via-white to-surface-2 px-4 py-4 sm:px-6">
      <GradientHero
        palette="rose"
        eyebrow="SALES · TRADE ORDERS"
        title="Trade Orders"
        subtitle="Resell from stock — no production cycle. Granules, film variants and trading goods flow straight from warehouse to dispatch."
        chips={[
          {
            icon: <ClipboardList className="h-4 w-4" />,
            label: "Draft",
            value: String(draftCount),
            tone: "warn",
          },
          {
            icon: <CheckCircle2 className="h-4 w-4" />,
            label: "Confirmed",
            value: String(confirmedCount),
            tone: "info",
          },
          {
            icon: <Truck className="h-4 w-4" />,
            label: "Dispatched",
            value: String(dispatchedCount),
            tone: "ok",
          },
        ]}
        actions={
          <Link href="/sales/trade-orders/new">
            <Button className="bg-surface-1 text-danger-fg hover:bg-surface-1/90">
              <Plus className="mr-1.5 h-4 w-4" /> New trade order
            </Button>
          </Link>
        }
      />

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-4" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search code, customer or invoice…"
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s.value || "all"}
              type="button"
              onClick={() => setStatus(s.value)}
              className={cn(
                "rounded-full px-3 py-1 text-[11px] font-bold ring-1",
                status === s.value
                  ? "bg-danger-solid text-white ring-danger-border"
                  : "bg-surface-1 text-content-2 ring-line hover:bg-danger-bg",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <section className="mt-4">
        {isLoading ? (
          <div className="rounded-3xl border border-line bg-surface-1 p-10 text-center text-sm text-content-3">
            Loading trade orders…
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-3xl border border-line bg-surface-1 p-10 text-center">
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-danger-bg text-danger-fg">
              <Repeat className="h-7 w-7" />
            </div>
            <div>
              <div className="text-sm font-bold text-content-2">
                {orders.length === 0
                  ? "No trade orders yet"
                  : "No orders match your filters"}
              </div>
              <p className="mt-1 max-w-[420px] text-[11px] text-content-3">
                {orders.length === 0
                  ? "Create your first trade order — pick a customer, add lines, confirm, dispatch."
                  : "Try a different search term or status filter."}
              </p>
            </div>
            {orders.length === 0 ? (
              <Link href="/sales/trade-orders/new">
                <Button className="bg-danger-solid text-white hover:bg-danger-solid">
                  <Plus className="mr-1.5 h-4 w-4" /> Create first trade order
                </Button>
              </Link>
            ) : null}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {filtered.map((o) => (
              <OrderCard key={o.id} o={o} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function OrderCard({ o }: { o: TradeOrder }) {
  return (
    <Link href={`/sales/trade-orders/${o.id}`} className="group">
      <article className="rounded-3xl bg-surface-1 p-5 shadow-[0_20px_60px_-30px_rgba(15,23,42,0.25)] ring-1 ring-line transition hover:ring-danger-border">
        <header className="flex items-start justify-between gap-2">
          <div>
            <div className="font-mono text-[12px] font-bold text-danger-fg">
              {o.code}
            </div>
            <h3 className="mt-0.5 text-sm font-bold text-content-1 group-hover:text-danger-fg">
              {o.customer_name || "—"}
            </h3>
            <div className="mt-0.5 text-[11px] text-content-3">
              {o.order_date} · {o.plant_name || "no plant"} ·{" "}
              {o.items?.length || 0}{" "}
              {(o.items?.length || 0) === 1 ? "line" : "lines"}
            </div>
          </div>
          <Badge
            variant="outline"
            className={cn("text-[10px]", STATUS_TONE[o.status])}
          >
            {o.status.toLowerCase()}
          </Badge>
        </header>
        <div className="mt-4 flex items-baseline justify-between rounded-2xl bg-surface-2 px-3 py-2">
          <div className="text-[10px] font-bold uppercase tracking-wider text-content-3">
            Grand total
          </div>
          <div className="font-mono text-base font-bold text-content-1">
            ₹{" "}
            {Number(o.grand_total || 0).toLocaleString(undefined, {
              maximumFractionDigits: 2,
            })}
          </div>
        </div>
      </article>
    </Link>
  );
}

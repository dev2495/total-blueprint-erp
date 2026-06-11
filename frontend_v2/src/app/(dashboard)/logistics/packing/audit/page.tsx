"use client";

/**
 * /logistics/packing/audit — per-order packing-consumption audit trail.
 *
 * Reads PackagingTransaction rows where type=CONSUME AND sales_order_item is
 * set. Filters by date range / customer / order / material. CSV export.
 */

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Calendar,
  Download,
  Filter,
  Loader2,
  Search,
  ShieldCheck,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { logisticsService } from "@/services/logistics";
import {
  masterDataService,
  type Customer,
  type PackagingMaterial,
} from "@/services/master-data";
import { formatDisplayDateTime } from "@/lib/date-format";

export default function PackingAuditPage() {
  const searchParams = useSearchParams();
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400_000)
    .toISOString()
    .slice(0, 10);
  const [dateFrom, setDateFrom] = React.useState(monthAgo);
  const [dateTo, setDateTo] = React.useState(today);
  const [customerId, setCustomerId] = React.useState<string>("");
  const [materialId, setMaterialId] = React.useState<string>("");
  const [orderNo, setOrderNo] = React.useState("");
  // Deep-link from Packing Yard: /audit?sales_order_id=<uuid> filters to one SO.
  const [salesOrderId, setSalesOrderId] = React.useState<string>(
    searchParams?.get("sales_order_id") || "",
  );
  React.useEffect(() => {
    const next = searchParams?.get("sales_order_id") || "";
    if (next !== salesOrderId) setSalesOrderId(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const { data: customers = [] } = useQuery({
    queryKey: ["sales-customers"],
    queryFn: () => masterDataService.getCustomers(),
    staleTime: 60_000,
  });
  const { data: materials = [] } = useQuery({
    queryKey: ["packaging-materials-all"],
    queryFn: () => masterDataService.getPackaging(),
    staleTime: 60_000,
  });

  const { data, isFetching } = useQuery({
    queryKey: [
      "packing-audit",
      { dateFrom, dateTo, customerId, materialId, orderNo, salesOrderId },
    ],
    queryFn: () =>
      logisticsService.listOrderPackingConsumption({
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        customer_id: customerId || undefined,
        material_id: materialId || undefined,
        sales_order_no: orderNo || undefined,
        sales_order_id: salesOrderId || undefined,
        limit: 250,
      }),
    staleTime: 15_000,
  });

  const rows = data?.rows || [];

  // KPI summary
  const totals = React.useMemo(() => {
    const orders = new Set(rows.map((r) => r.sales_order_no).filter(Boolean));
    const items = rows.length;
    const qty = rows.reduce((s, r) => s + Math.abs(r.qty || 0), 0);
    const customers = new Set(rows.map((r) => r.customer_id).filter(Boolean));
    return { orders: orders.size, items, qty, customers: customers.size };
  }, [rows]);

  const exportCsv = React.useCallback(() => {
    const head = [
      "When",
      "Order",
      "Customer",
      "Material code",
      "Material name",
      "Kind",
      "Qty",
      "UOM",
      "Location",
      "Ticked by",
      "Notes",
      "Reference",
    ];
    const body = rows.map((r) => [
      formatDisplayDateTime(r.created_at),
      r.sales_order_no,
      r.customer_name || "",
      r.material_code,
      r.material_name,
      r.packaging_kind,
      Math.abs(r.qty),
      r.uom,
      r.location_name,
      r.ticked_by,
      r.notes.replace(/[\r\n,]/g, " "),
      r.reference,
    ]);
    const csv = [head, ...body]
      .map((row) =>
        row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","),
      )
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `packing-audit-${dateFrom}_to_${dateTo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [rows, dateFrom, dateTo]);

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-gradient-to-br from-surface-2 via-white to-order-bg px-4 py-4 sm:px-6">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 -left-32 h-80 w-80 rounded-full bg-order-bg blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-40 -right-32 h-80 w-80 rounded-full bg-success-bg blur-3xl"
      />
      <div className="relative space-y-4 pb-12">
        {/* Hero */}
        <header className="relative overflow-hidden rounded-3xl border border-line bg-gradient-to-br from-surface-2 via-white to-order-bg px-6 py-4 shadow-lg ring-1 ring-surface-1/40">
          <div
            aria-hidden
            className="pointer-events-none absolute -top-20 -right-20 h-56 w-56 rounded-full bg-order-bg blur-3xl"
          />
          <div className="absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b from-surface-2 to-order-fg" />
          <div className="relative flex items-start justify-between gap-3 pl-3">
            <div className="flex items-start gap-3 min-w-0">
              <Link
                href="/logistics/packing"
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-surface-1/70 text-content-2 ring-1 ring-line hover:bg-surface-1"
                title="Back to Packing"
              >
                <ArrowLeft className="h-4 w-4" />
              </Link>
              <div className="min-w-0">
                <div className="text-[10px] font-black uppercase tracking-[0.22em] text-content-2">
                  Logistics › Packing › Audit
                </div>
                <h1 className="font-display text-2xl font-black text-content-1 tracking-tight">
                  Per-order packing audit
                </h1>
                <p className="mt-1 text-xs text-content-3 max-w-2xl">
                  Every gunny / sheet / tape / label / tag consumed against each
                  sales order. Source of truth for what packing actually went
                  out per order.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {salesOrderId ? (
                <Link
                  href="/logistics/packing/audit"
                  className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-danger-bg px-3.5 text-[11px] font-bold text-danger-fg ring-1 ring-danger-border hover:bg-danger-bg"
                >
                  Clear order filter
                </Link>
              ) : null}
              <Button
                onClick={exportCsv}
                disabled={rows.length === 0}
                className="rounded-xl bg-gradient-to-r from-surface-3 to-surface-3 text-white shadow-md hover:shadow-lg disabled:opacity-50"
              >
                <Download className="mr-1.5 h-4 w-4" /> Export CSV
              </Button>
            </div>
          </div>
        </header>

        {/* KPI strip */}
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <KpiTile label="Orders" value={totals.orders} tone="indigo" />
          <KpiTile label="Customers" value={totals.customers} tone="violet" />
          <KpiTile label="Records" value={totals.items} tone="emerald" />
          <KpiTile
            label="Total qty"
            value={totals.qty}
            tone="amber"
            suffix=" units"
          />
        </section>

        {/* Filter band */}
        <section className="rounded-2xl border border-line bg-surface-1 shadow-sm p-3 sm:p-4 ring-1 ring-surface-1/40">
          <div className="flex items-center gap-2 mb-3">
            <Filter className="h-3.5 w-3.5 text-content-3" />
            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-content-3">
              Filter
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <div>
              <Label className="text-[10px] font-bold uppercase tracking-wider text-content-3">
                Date from
              </Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="mt-1 h-9 rounded-xl"
              />
            </div>
            <div>
              <Label className="text-[10px] font-bold uppercase tracking-wider text-content-3">
                Date to
              </Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="mt-1 h-9 rounded-xl"
              />
            </div>
            <div>
              <Label className="text-[10px] font-bold uppercase tracking-wider text-content-3">
                Customer
              </Label>
              <Select
                value={customerId || "__all"}
                onValueChange={(v) => setCustomerId(v === "__all" ? "" : v)}
              >
                <SelectTrigger className="mt-1 h-9 rounded-xl">
                  <SelectValue placeholder="All customers" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">All customers</SelectItem>
                  {customers.map((c: Customer) => (
                    <SelectItem key={c.id} value={c.id!}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px] font-bold uppercase tracking-wider text-content-3">
                Material
              </Label>
              <Select
                value={materialId || "__all"}
                onValueChange={(v) => setMaterialId(v === "__all" ? "" : v)}
              >
                <SelectTrigger className="mt-1 h-9 rounded-xl">
                  <SelectValue placeholder="All packing SKUs" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">All packing SKUs</SelectItem>
                  {materials.map((m: PackagingMaterial) => (
                    <SelectItem key={m.id} value={m.id!}>
                      {m.code}
                      {m.name && m.name !== m.code ? ` · ${m.name}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-[10px] font-bold uppercase tracking-wider text-content-3">
                Order #
              </Label>
              <div className="relative mt-1">
                <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-content-4" />
                <Input
                  value={orderNo}
                  onChange={(e) => setOrderNo(e.target.value)}
                  placeholder="Exact match"
                  className="h-9 rounded-xl pl-9"
                />
              </div>
            </div>
          </div>
        </section>

        {/* Records */}
        <section className="rounded-2xl border border-line bg-surface-1 shadow-sm overflow-hidden ring-1 ring-surface-1/40">
          <header className="flex items-center justify-between border-b border-line bg-gradient-to-r from-surface-2 via-white to-order-bg px-5 py-2.5">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-content-3" />
              <div className="text-[10px] font-black uppercase tracking-[0.22em] text-content-3">
                Audit records · {data?.count ?? 0}
              </div>
            </div>
            {isFetching ? (
              <Loader2 className="h-4 w-4 animate-spin text-content-4" />
            ) : null}
          </header>
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs">
              <thead className="border-b border-line bg-surface-2 text-content-3">
                <tr>
                  <Th>When</Th>
                  <Th>Order</Th>
                  <Th>Customer</Th>
                  <Th>Packing SKU</Th>
                  <Th>Kind</Th>
                  <Th align="right">Qty</Th>
                  <Th>UOM</Th>
                  <Th>Location</Th>
                  <Th>Ticked by</Th>
                  <Th>Notes</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={10}
                      className="p-10 text-center text-sm text-content-4 italic"
                    >
                      {isFetching
                        ? "Loading…"
                        : "No packing consumption records in this filter window."}
                    </td>
                  </tr>
                ) : (
                  rows.map((r, idx) => (
                    <tr
                      key={r.id}
                      className={cn(
                        "hover:bg-surface-2",
                        idx % 2 === 1 && "bg-surface-2",
                      )}
                    >
                      <td className="px-3 py-2 text-content-2 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1">
                          <Calendar className="h-3 w-3 text-content-4" />
                          {formatDisplayDateTime(r.created_at)}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono font-black text-content-1">
                        {r.sales_order_no || "—"}
                      </td>
                      <td className="px-3 py-2 text-content-2 truncate max-w-[180px]">
                        {r.customer_name || "—"}
                      </td>
                      <td className="px-3 py-2 font-mono font-bold text-content-1">
                        {r.material_code}
                        {r.material_name &&
                        r.material_name !== r.material_code ? (
                          <span className="ml-1 text-[10px] font-medium text-content-3">
                            · {r.material_name}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-[10px]">
                        <span className="inline-flex items-center rounded-md bg-order-bg px-1.5 py-0.5 font-bold text-order-fg ring-1 ring-order-border">
                          {r.packaging_kind || "—"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-black text-content-1">
                        {Math.abs(r.qty).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 font-mono text-[10px] text-content-3">
                        {r.uom}
                      </td>
                      <td className="px-3 py-2 text-content-2 truncate max-w-[160px]">
                        {r.location_name}
                      </td>
                      <td className="px-3 py-2 text-content-2">
                        {r.ticked_by || "—"}
                      </td>
                      <td className="px-3 py-2 text-content-3 italic text-[11px] truncate max-w-[200px]">
                        {r.notes || "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

function Th({
  children,
  align,
}: {
  children: React.ReactNode;
  align?: "right";
}) {
  return (
    <th
      className={cn(
        "px-3 py-2 font-black uppercase tracking-wider text-[9px]",
        align === "right" ? "text-right" : "text-left",
      )}
    >
      {children}
    </th>
  );
}

const KPI_TONES: Record<
  string,
  { wrap: string; stripe: string; label: string; value: string }
> = {
  indigo: {
    wrap: "border-order-border bg-gradient-to-br from-order-bg via-white to-info-bg",
    stripe: "bg-gradient-to-r from-order-fg to-primary",
    label: "text-order-fg",
    value: "text-order-fg",
  },
  violet: {
    wrap: "border-order-border bg-gradient-to-br from-order-bg via-white to-purple-50/60",
    stripe: "bg-gradient-to-r from-order-fg to-purple-500",
    label: "text-order-fg",
    value: "text-order-fg",
  },
  emerald: {
    wrap: "border-success-border bg-gradient-to-br from-success-bg via-white to-success-bg",
    stripe: "bg-gradient-to-r from-success-fg to-success-bg0",
    label: "text-success-fg",
    value: "text-success-fg",
  },
  amber: {
    wrap: "border-warning-border bg-gradient-to-br from-warning-bg via-white to-warm",
    stripe: "bg-gradient-to-r from-warning-fg to-warm",
    label: "text-warning-fg",
    value: "text-warning-fg",
  },
};

function KpiTile({
  label,
  value,
  suffix,
  tone,
}: {
  label: string;
  value: number;
  suffix?: string;
  tone: keyof typeof KPI_TONES;
}) {
  const t = KPI_TONES[tone];
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border p-3 shadow-sm ring-1 ring-surface-1/40",
        t.wrap,
      )}
    >
      <div className={cn("absolute inset-x-0 top-0 h-1", t.stripe)} />
      <div
        className={cn(
          "text-[10px] font-black uppercase tracking-[0.16em]",
          t.label,
        )}
      >
        {label}
      </div>
      <div
        className={cn(
          "mt-1 font-display text-2xl font-black tabular-nums tracking-tight",
          t.value,
        )}
      >
        {value.toLocaleString()}
        {suffix || ""}
      </div>
    </div>
  );
}

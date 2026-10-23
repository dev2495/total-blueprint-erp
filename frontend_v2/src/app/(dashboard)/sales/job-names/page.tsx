"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Briefcase, CheckCircle2, Layers, Package, Truck } from "lucide-react";

import { BulletBar, KpiRow, KpiTile, SearchField, StackBar, Toolbar } from "@/components/planner-kit";
import { salesService, type JobNameRow } from "@/services/sales";

const kg = (value: number) => value.toLocaleString("en-IN", { maximumFractionDigits: 0 });
const day = (value: string | null) => (value ? new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" }) : "—");

/** Orders clubbed by the job name sales typed when placing them. */
export default function JobNamesPage() {
  const [query, setQuery] = React.useState("");
  const [sort, setSort] = React.useState<"open" | "ordered" | "orders" | "recent">("open");
  const report = useQuery({
    queryKey: ["sales-job-names"],
    queryFn: () => salesService.getJobNames(),
    staleTime: 60_000,
  });
  const rows: JobNameRow[] = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (report.data?.rows || []).filter(
      (row) => !q || `${row.job_name} ${row.customers.join(" ")}`.toLowerCase().includes(q),
    );
    const by = {
      open: (a: JobNameRow, b: JobNameRow) => b.open_kg - a.open_kg,
      ordered: (a: JobNameRow, b: JobNameRow) => b.ordered_kg - a.ordered_kg,
      orders: (a: JobNameRow, b: JobNameRow) => b.orders - a.orders,
      recent: (a: JobNameRow, b: JobNameRow) => String(b.last_order_at || "").localeCompare(String(a.last_order_at || "")),
    }[sort];
    return [...list].sort(by);
  }, [report.data, query, sort]);
  const t = report.data?.totals;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-content-1">Job names</h1>
          <p className="mt-1 max-w-[70ch] text-sm text-content-3">
            Orders clubbed by the job name typed when the order was placed. Click a job name to open its orders.
          </p>
        </div>
        <Link href="/sales/orders/create" className="rounded-[10px] border border-line bg-surface-1 px-3 py-2 text-sm font-semibold text-order-fg hover:bg-surface-2">
          New order
        </Link>
      </header>

      {t ? (
        <KpiRow>
          <KpiTile icon={Briefcase} label="Job names" value={kg(t.job_names)} unit="in view" sub={`${kg(t.job_names_open)} with open orders`} testId="jn-kpi-names" />
          <KpiTile icon={CheckCircle2} label="Orders with a job name" value={t.orders_total ? Math.round((t.orders_named * 100) / t.orders_total) : 0} unit="%"
            viz={<BulletBar value={t.orders_named} max={Math.max(t.orders_total, 1)} left={`${kg(t.orders_named)} named`} right={`${kg(t.orders_total)} orders`} tone="done" />}
            sub={`${kg(t.orders_unnamed)} orders have no job name`} testId="jn-kpi-named" />
          <KpiTile icon={Layers} label="Ordered" value={kg(t.ordered_kg)} unit="kg" sub="named jobs, cancelled lines left out" testId="jn-kpi-ordered" />
          <KpiTile icon={Truck} label="Dispatched" value={kg(t.dispatched_kg)} unit="kg" tone="done"
            viz={<StackBar segments={[{ label: "Dispatched", value: t.dispatched_kg, tone: "done" }, { label: "Open", value: t.open_kg, tone: "queued" }]} />} testId="jn-kpi-dispatched" />
          <KpiTile icon={Package} label="Open" value={kg(t.open_kg)} unit="kg" tone={t.open_kg ? "wait" : undefined} sub="ordered minus dispatched" testId="jn-kpi-open" />
        </KpiRow>
      ) : null}

      <Toolbar>
        <SearchField id="job-names-search" value={query} onChange={setQuery} placeholder="Search job name or customer" />
        <label className="flex items-center gap-2 text-caption text-content-3">
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} className="h-[38px] rounded-[10px] border border-line bg-surface-1 px-2 text-[13px] text-content-1">
            <option value="open">Open kg</option>
            <option value="ordered">Ordered kg</option>
            <option value="orders">Orders</option>
            <option value="recent">Last ordered</option>
          </select>
        </label>
      </Toolbar>

      <section className="overflow-x-auto rounded-[14px] border border-line bg-surface-1 shadow-[var(--shadow-sm)]" tabIndex={0} role="region" aria-label="Job names table">
        {report.isLoading ? (
          <p className="p-6 text-sm text-content-3">Loading…</p>
        ) : report.isError ? (
          <p className="p-6 text-sm text-danger-fg" role="alert">Could not load job names. Refresh to try again.</p>
        ) : !rows.length ? (
          <p className="p-6 text-sm text-content-3">
            No job names yet. Type a job name in the order composer when placing an order; it then appears here and next to the SO number everywhere.
          </p>
        ) : (
          <table className="w-full min-w-[920px] text-sm">
            <thead className="bg-surface-2 text-left text-caption font-semibold text-content-3">
              <tr>
                <th scope="col" className="px-3 py-2">Job name</th>
                <th scope="col" className="px-3 py-2 text-right">Orders</th>
                <th scope="col" className="px-3 py-2">Customers</th>
                <th scope="col" className="px-3 py-2 text-right">Ordered</th>
                <th scope="col" className="px-3 py-2">Dispatched</th>
                <th scope="col" className="px-3 py-2 text-right">Open kg</th>
                <th scope="col" className="px-3 py-2 text-right">On time</th>
                <th scope="col" className="px-3 py-2">Last order</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.job_name} className="border-t border-line align-top" data-testid="job-name-row">
                  <td className="px-3 py-2">
                    <Link href={`/sales/orders?q=${encodeURIComponent(row.job_name)}`} className="inline-block min-h-6 py-0.5 font-semibold text-order-fg underline-offset-2 hover:underline">
                      {row.job_name}
                    </Link>
                    <div className="text-caption text-content-4">{row.lines} lines</div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {row.orders}
                    {row.open_orders ? <div className="text-caption text-warning-fg">{row.open_orders} open</div> : null}
                  </td>
                  <td className="max-w-[220px] px-3 py-2 text-content-2">{row.customers.join(", ") || "—"}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">
                    {kg(row.ordered_kg)} kg
                    {row.ordered_pcs ? <div className="text-caption text-content-3">{kg(row.ordered_pcs)} pcs</div> : null}
                  </td>
                  <td className="min-w-[180px] px-3 py-2">
                    <BulletBar value={row.dispatched_kg} max={Math.max(row.ordered_kg, 1)} left={`${kg(row.dispatched_kg)} kg`} right={row.dispatched_pcs ? `${kg(row.dispatched_pcs)} pcs` : ""} tone="done" />
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{kg(row.open_kg)}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums">{row.on_time_pct === null ? "—" : `${row.on_time_pct}%`}</td>
                  <td className="px-3 py-2 font-mono text-caption text-content-3">{day(row.last_order_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

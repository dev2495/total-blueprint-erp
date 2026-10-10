"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, ChevronDown, ChevronRight, Clock } from "lucide-react";

import { Panel, PanelEmpty } from "@/components/premium";
import { cn } from "@/lib/utils";
import type { Plant } from "@/services/factory";
import type { Vendor } from "@/services/inventory";
import { jobWorkApi } from "@/services/job-work";

import { addDaysIso, Chip, ErrorBanner, fmtDate, fmtInr, fmtKg, fmtNum, inputClass, jobWorkError, todayIso } from "./job-work-common";

/** Reports tab: material at job workers by age (ITC-04) and yield / wastage by job worker. */
export function JobWorkReports({
  plant,
  vendor,
  plants,
  vendors,
  onPlant,
  onVendor,
}: {
  plant: string;
  vendor: string;
  plants: Plant[];
  vendors: Vendor[];
  onPlant: (value: string) => void;
  onVendor: (value: string) => void;
}) {
  const [from, setFrom] = useState(addDaysIso(-90));
  const [to, setTo] = useState(todayIso());
  const [open, setOpen] = useState<string | null>(null);
  const ageingQ = useQuery({ queryKey: ["jobwork", "report", "at-vendor", plant, vendor], queryFn: () => jobWorkApi.reportAtVendor({ plant, vendor }), meta: { suppressGlobalError: true } });
  const yieldQ = useQuery({
    queryKey: ["jobwork", "report", "yield", plant, vendor, from, to],
    queryFn: () => jobWorkApi.reportYield({ plant, vendor, date_from: from, date_to: to }),
    enabled: Boolean(from && to && from <= to),
    meta: { suppressGlobalError: true },
  });
  const buckets = ageingQ.data?.buckets || [];

  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="sr-only">Plant</span>
          <select value={plant} onChange={(e) => onPlant(e.target.value)} className={inputClass}>
            <option value="">All plants</option>
            {plants.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="sr-only">Job worker</span>
          <select value={vendor} onChange={(e) => onVendor(e.target.value)} className={inputClass}>
            <option value="">All job workers</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <Panel
        title="Material at job workers"
        icon={<Clock />}
        description="Open sent lines by age. GST (ITC-04): inputs must come back within one year of the challan; alerts start at 300 days."
        flush
      >
        {ageingQ.isError ? (
          <div className="p-4">
            <ErrorBanner message={jobWorkError(ageingQ.error, "The ageing report could not load.")} onRetry={() => void ageingQ.refetch()} />
          </div>
        ) : ageingQ.isLoading ? (
          <div className="m-4 h-32 animate-pulse rounded-2xl bg-surface-2" />
        ) : !ageingQ.data?.rows.length ? (
          <div className="p-4">
            <PanelEmpty icon={<Clock />} title="No material is at any job worker">Everything sent has been received back, written off or reconciled.</PanelEmpty>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-[13px]">
              <thead className="bg-surface-2 text-left text-[11.5px] uppercase tracking-wide text-content-3">
                <tr>
                  <th className="px-4 py-2 font-semibold">Job worker</th>
                  <th className="px-3 py-2 text-right font-semibold">At vendor</th>
                  <th className="px-3 py-2 text-right font-semibold">Value</th>
                  {buckets.map((b) => (
                    <th key={b.key} className="px-3 py-2 text-right font-semibold">
                      {b.label}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right font-semibold">Oldest</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {ageingQ.data.rows.map((row) => {
                  const key = row.vendor || row.vendor_name;
                  const expanded = open === key;
                  return (
                    <Fragment key={key}>
                      <tr className="align-top">
                        <td className="px-4 py-2.5">
                          <button type="button" onClick={() => setOpen(expanded ? null : key)} aria-expanded={expanded} className="inline-flex min-h-[32px] items-center gap-1.5 text-left font-semibold text-content-1">
                            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            {row.vendor_name}
                          </button>
                          <div className="pl-6 text-[12px] text-content-3">
                            {row.lines} line{row.lines === 1 ? "" : "s"} · {row.orders.length} order{row.orders.length === 1 ? "" : "s"}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{fmtKg(row.kg)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{fmtInr(row.value)}</td>
                        {buckets.map((b) => (
                          <td key={b.key} className={cn("px-3 py-2.5 text-right tabular-nums", Number(row.buckets[b.key]) > 0 && ["301_365", "over_365"].includes(b.key) ? "font-semibold text-danger-fg" : "text-content-2")}>
                            {Number(row.buckets[b.key]) > 0 ? fmtNum(row.buckets[b.key]) : "—"}
                          </td>
                        ))}
                        <td className="px-3 py-2.5 text-right tabular-nums">{row.oldest_days} d</td>
                      </tr>
                      {expanded ? (
                        <tr>
                          <td colSpan={4 + buckets.length} className="bg-surface-2/60 px-4 py-2">
                            <ul className="space-y-1">
                              {row.items.map((item, index) => (
                                <li key={index} className="flex flex-wrap items-center justify-between gap-2 text-[12.5px]">
                                  <span className="min-w-0">
                                    {item.order_id ? (
                                      <Link href={`/inventory/job-work/${item.order_id}`} className="font-mono font-semibold text-primary hover:underline">
                                        {item.order_number}
                                      </Link>
                                    ) : (
                                      <span className="font-semibold">Not linked</span>
                                    )}
                                    {item.challan_number ? <span className="font-mono text-content-3"> · {item.challan_number}</span> : null} · {item.description}
                                    {item.legacy ? <Chip>Before upgrade</Chip> : null}
                                  </span>
                                  <span className="tabular-nums text-content-2">
                                    {fmtKg(item.open_kg)} · sent {fmtDate(item.sent_at)} · {item.age_days} d
                                  </span>
                                </li>
                              ))}
                            </ul>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
              <tfoot className="bg-surface-2 font-semibold">
                <tr>
                  <td className="px-4 py-2">Total</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtKg(ageingQ.data.totals.kg)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmtInr(ageingQ.data.totals.value)}</td>
                  {buckets.map((b) => (
                    <td key={b.key} className="px-3 py-2 text-right tabular-nums">
                      {Number(ageingQ.data!.totals.buckets[b.key]) > 0 ? fmtNum(ageingQ.data!.totals.buckets[b.key]) : "—"}
                    </td>
                  ))}
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Panel>

      <Panel
        title="Yield and wastage by job worker"
        icon={<BarChart3 />}
        description="Returns received in the period. Processed = material settled minus balance returned unused."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <input type="date" aria-label="From" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={cn(inputClass, "h-10 w-auto")} />
            <input type="date" aria-label="To" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={cn(inputClass, "h-10 w-auto")} />
          </div>
        }
        flush
      >
        {yieldQ.isError ? (
          <div className="p-4">
            <ErrorBanner message={jobWorkError(yieldQ.error, "The yield report could not load.")} onRetry={() => void yieldQ.refetch()} />
          </div>
        ) : yieldQ.isLoading ? (
          <div className="m-4 h-32 animate-pulse rounded-2xl bg-surface-2" />
        ) : !yieldQ.data?.rows.length ? (
          <div className="p-4">
            <PanelEmpty icon={<BarChart3 />} title="No returns in this period">Pick a longer period or another job worker.</PanelEmpty>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-[13px]">
              <thead className="bg-surface-2 text-left text-[11.5px] uppercase tracking-wide text-content-3">
                <tr>
                  <th className="px-4 py-2 font-semibold">Job worker</th>
                  <th className="px-3 py-2 text-right font-semibold">Returns</th>
                  <th className="px-3 py-2 text-right font-semibold">Processed</th>
                  <th className="px-3 py-2 text-right font-semibold">Output</th>
                  <th className="px-3 py-2 text-right font-semibold">Pieces</th>
                  <th className="px-3 py-2 text-right font-semibold">Wastage</th>
                  <th className="px-3 py-2 text-right font-semibold">Yield</th>
                  <th className="px-3 py-2 text-right font-semibold">Wastage %</th>
                  <th className="px-3 py-2 text-right font-semibold">Unexplained</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {yieldQ.data.rows.map((row) => (
                  <tr key={row.vendor || row.vendor_name}>
                    <td className="px-4 py-2.5 font-semibold text-content-1">{row.vendor_name}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{row.returns}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{fmtKg(row.processed_kg)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{fmtKg(row.output_kg)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{row.output_pcs ? fmtNum(row.output_pcs) : "—"}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{fmtKg(row.wastage_kg)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{row.yield_pct !== null ? `${row.yield_pct}%` : "—"}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{row.wastage_pct !== null ? `${row.wastage_pct}%` : "—"}</td>
                    <td className={cn("px-3 py-2.5 text-right tabular-nums", Math.abs(Number(row.variance_kg)) > 0 ? "text-warning-fg" : "")}>{fmtKg(row.variance_kg)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

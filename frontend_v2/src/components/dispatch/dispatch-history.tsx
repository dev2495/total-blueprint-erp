"use client";

import * as React from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Check, FileText, History, Printer, Search, Send } from "lucide-react";

import { GATE_QR_STICKER_HINT, PrintGateQrLabelButton, useGateQrLabelAccess } from "@/components/gate/print-qr-label-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { JobNameTag } from "@/components/spine/job-name-tag";
import { Pager, Pill, clean, kgText as kg, num as n, titleCase } from "@/components/logistics/yard-ui";
import { cn } from "@/lib/utils";
import { logisticsService, type DeliveryChallan } from "@/services/logistics";

const LIFECYCLE = ["DRAFT", "DISPATCHED", "IN_TRANSIT", "DELIVERED"] as const;
const PAGE = 8;
type Tab = "ALL" | "DRAFT" | "POD" | "DELIVERED" | "CANCELLED";
type Range = "TODAY" | "WEEK" | "ALL";

function Lifecycle({ status }: { status: string }) {
  const current = String(status || "DRAFT").toUpperCase();
  if (current === "CANCELLED") return <Pill tone="bad">Cancelled</Pill>;
  const active = Math.max(0, LIFECYCLE.indexOf(current as (typeof LIFECYCLE)[number]));
  return (
    <ol className="flex items-center gap-1" aria-label={`Challan status ${titleCase(current)}`}>
      {LIFECYCLE.map((stage, index) => (
        <li key={stage} className="flex items-center gap-1">
          <span
            className={cn(
              "grid h-4 w-4 place-items-center rounded-full text-[9px] font-semibold",
              index <= active ? "bg-success-fg text-white" : "bg-surface-2 text-content-4 ring-1 ring-line",
            )}
            title={titleCase(stage)}
          >
            {index < active || current === "DELIVERED" ? <Check className="h-2.5 w-2.5" strokeWidth={3} /> : index + 1}
          </span>
          {index < LIFECYCLE.length - 1 ? <span className={cn("h-px w-2.5", index < active ? "bg-success-fg" : "bg-line")} aria-hidden /> : null}
        </li>
      ))}
    </ol>
  );
}

const tone = (status: string) => {
  const s = String(status || "").toUpperCase();
  if (s === "DRAFT") return "warn" as const;
  if (s === "DELIVERED") return "good" as const;
  if (s === "CANCELLED") return "bad" as const;
  return "info" as const;
};

/**
 * Dispatched and history: every slip through delivery, with reprint, dispatch of drafts and POD.
 * Paged, filtered and searched on the server, so years of slips stay fast.
 */
export function DispatchHistory({
  dispatchingId,
  onPrint,
  onDispatch,
  onPod,
  initialTab = "ALL",
  initialSearch = "",
}: {
  dispatchingId: string;
  onPrint: (row: DeliveryChallan) => void;
  onDispatch: (row: DeliveryChallan) => void;
  onPod: (row: DeliveryChallan) => void;
  initialTab?: Tab;
  /** Opens filtered, e.g. on an order number from the order page. */
  initialSearch?: string;
}) {
  const qrStickers = useGateQrLabelAccess();
  const [tab, setTab] = React.useState<Tab>(initialTab);
  const [range, setRange] = React.useState<Range>("ALL");
  const [customer, setCustomer] = React.useState("ALL");
  const [search, setSearch] = React.useState(initialSearch);
  const [confirmClosedId, setConfirmClosedId] = React.useState("");
  React.useEffect(() => {
    if (initialSearch) setSearch(initialSearch);
  }, [initialSearch]);
  const [page, setPage] = React.useState(1);
  React.useEffect(() => setTab(initialTab), [initialTab]);
  React.useEffect(() => setPage(1), [tab, range, customer, search]);
  const deferredSearch = React.useDeferredValue(search.trim());
  const history = useQuery({
    queryKey: ["challan-history", tab, range, customer, deferredSearch, page],
    queryFn: ({ signal }) =>
      logisticsService.getChallanHistory(
        { tab, range, customer, search: deferredSearch, limit: PAGE, offset: (page - 1) * PAGE },
        signal,
      ),
    placeholderData: keepPreviousData,
    refetchInterval: 60000,
  });
  const loading = history.isLoading;
  const statusOf = (row: DeliveryChallan) => String(row.status || "").toUpperCase();
  const when = (row: DeliveryChallan) => new Date(row.dispatch_date || row.created_at || 0);
  const now = new Date();
  const total = Number(history.data?.count || 0);
  const pageCount = Math.max(1, Math.ceil(total / PAGE));
  const safePage = Math.min(page, pageCount);
  const paged = history.data?.results || [];
  const customers = history.data?.customers || [];
  const counts = history.data?.tab_counts;
  const tabs: Array<[Tab, string, number]> = [
    ["ALL", "All", Number(counts?.ALL || 0)],
    ["DRAFT", "Drafts", Number(counts?.DRAFT || 0)],
    ["POD", "Awaiting POD", Number(counts?.POD || 0)],
    ["DELIVERED", "Delivered", Number(counts?.DELIVERED || 0)],
    ["CANCELLED", "Cancelled", Number(counts?.CANCELLED || 0)],
  ];

  return (
    <section className="overflow-hidden rounded-[16px] border border-line bg-surface-1 shadow-[var(--shadow-sm)]" data-testid="dispatch-history">
      <header className="flex flex-wrap items-center gap-2 px-4 py-3">
        <History className="h-4 w-4 text-content-3" aria-hidden />
        <h2 className="text-[15px] font-semibold text-content-1">Challans · dispatched &amp; history</h2>
        <span className="text-[12px] text-content-3">Every slip through delivery · reprint, dispatch drafts, confirm POD</span>
        <Pill tone="neutral" className="ml-auto">
          {n(total, 0)} of {n(Number(counts?.ALL || 0), 0)}
        </Pill>
      </header>
      <div className="flex flex-wrap items-center gap-2 border-t border-line px-3 py-2">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Slip status">
          {tabs.map(([value, label, total]) => (
            <button
              key={value}
              type="button"
              aria-pressed={tab === value}
              data-testid={`dispatch-history-tab-${value.toLowerCase()}`}
              onClick={() => setTab(value)}
              className={cn(
                "min-h-[32px] rounded-lg border px-2.5 text-[12px] font-semibold transition-colors",
                tab === value ? "border-primary bg-info-bg text-content-1" : "border-line bg-surface-1 text-content-3 hover:text-content-1",
              )}
            >
              {label} <span className="ml-0.5 tabular-nums text-content-4">{total}</span>
            </button>
          ))}
        </div>
        <div className="flex gap-1" role="group" aria-label="Date">
          {(
            [
              ["TODAY", "Today"],
              ["WEEK", "7 days"],
              ["ALL", "All"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={range === value}
              onClick={() => setRange(value)}
              className={cn(
                "min-h-[32px] rounded-lg border px-2.5 text-[12px] font-semibold transition-colors",
                range === value ? "border-primary bg-info-bg text-content-1" : "border-line bg-surface-1 text-content-3 hover:text-content-1",
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <select
          value={customer}
          onChange={(event) => setCustomer(event.target.value)}
          aria-label="Customer"
          className="h-8 max-w-[180px] rounded-lg border border-line bg-surface-1 px-2 text-[12px]"
        >
          <option value="ALL">All customers</option>
          {customers.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-content-4" aria-hidden />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search challan, customer, SO, job, vehicle"
            aria-label="Search challans"
            data-testid="dispatch-history-search"
            className="h-8 pl-8 text-[12px]"
          />
        </div>
      </div>
      {qrStickers ? (
        <p className="border-t border-line bg-surface-2/40 px-4 py-1.5 text-[11.5px] text-content-3">
          <b className="text-content-2">QR sticker:</b> {GATE_QR_STICKER_HINT}
        </p>
      ) : null}
      {paged.length ? (
        <div className="overflow-x-auto border-t border-line">
          <table className="w-full min-w-[980px] text-[12px]">
            <thead className="bg-surface-2 text-[11px] text-content-3">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Challan</th>
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-left font-medium">Customer · order · line</th>
                <th className="px-3 py-2 text-right font-medium">Units</th>
                <th className="px-3 py-2 text-left font-medium">Vehicle · transporter</th>
                <th className="px-3 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((row) => {
                const status = statusOf(row);
                const date = when(row);
                const isToday = date.toDateString() === now.toDateString();
                const location = clean(row.ship_to_address_snapshot?.location || row.ship_to_address_snapshot?.address);
                return (
                  <tr key={row.id} className="border-t border-line align-top" data-testid={`dispatch-challan-row-${row.id}`}>
                    <td className="px-3 py-2">
                      <div className="whitespace-nowrap font-mono text-[12.5px] font-semibold text-content-1">{row.dc_no}</div>
                      <div className="text-[11px] text-content-3">
                        {isToday ? "Today" : date.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} ·{" "}
                        {date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <Pill tone={tone(status)} dot>
                        {titleCase(status)}
                      </Pill>
                      <div className="mt-1">
                        <Lifecycle status={status} />
                      </div>
                      {row.line_closed || row.order_closed ? (
                        <div className="mt-1 text-[10.5px] font-semibold text-warning-fg">{row.order_closed ? "Order closed" : "Line closed"}</div>
                      ) : null}
                    </td>
                    <td className="max-w-[340px] px-3 py-2">
                      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
                        <span className="font-semibold text-content-1">{row.customer_name}</span>
                        {location ? <span className="truncate text-[11px] text-content-3">· {location}</span> : null}
                      </div>
                      <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1">
                        <span className="font-mono font-semibold text-content-2">{row.so_number}</span>
                        <JobNameTag name={row.job_name} />
                      </div>
                      <div className="truncate text-[11px] text-content-3">
                        {row.line_no ? `L${row.line_no} · ` : ""}
                        {row.line_name || "—"}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <div className="font-semibold text-content-1">
                        {row.rolls ? `${n(row.rolls, 0)} roll${row.rolls === 1 ? "" : "s"}` : `${n(row.units || 0, 0)} gonn${row.units === 1 ? "y" : "ies"}`}
                      </div>
                      <div className="text-[11px] tabular-nums text-content-3">
                        {row.pcs ? `${n(row.pcs, 0)} pcs · ` : ""}
                        {kg(row.gross_kg || 0)} gross
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-mono font-semibold text-content-1">{row.vehicle_no || "—"}</div>
                      <div className="max-w-[180px] truncate text-[11px] text-content-3">
                        {row.transporter_name || "—"}
                        {row.driver_name ? ` · ${row.driver_name}` : ""}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-start justify-end gap-1">
                        <Button size="sm" variant="outline" className="h-8 px-2.5" data-testid={`dispatch-print-${row.id}`} onClick={() => onPrint(row)}>
                          <Printer className="mr-1 h-3.5 w-3.5" aria-hidden /> Epson
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 px-2.5"
                          data-testid={`dispatch-pdf-${row.id}`}
                          onClick={() => window.open(logisticsService.getChallanPrintUrl(row.id, "pdf"), "_blank", "noopener,noreferrer")}
                        >
                          <FileText className="mr-1 h-3.5 w-3.5" aria-hidden /> PDF
                        </Button>
                        {status !== "CANCELLED" ? (
                          <PrintGateQrLabelButton kind="SALES_DC" id={row.id} reference={row.dc_no} showHint={false} className="shrink-0" />
                        ) : null}
                        {status === "DRAFT" && (row.line_closed || row.order_closed) && confirmClosedId === row.id ? (
                          <span className="flex basis-full flex-wrap items-center justify-end gap-1 rounded-lg border border-warning-border bg-warning-bg px-2 py-1 text-[11.5px] text-content-2">
                            <span>Line closed · send the goods anyway?</span>
                            <Button
                              size="sm"
                              className="h-7"
                              data-testid={`dispatch-send-confirm-${row.id}`}
                              disabled={Boolean(dispatchingId)}
                              onClick={() => {
                                setConfirmClosedId("");
                                onDispatch(row);
                              }}
                            >
                              Yes, dispatch
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7" onClick={() => setConfirmClosedId("")}>
                              No
                            </Button>
                          </span>
                        ) : status === "DRAFT" ? (
                          <Button
                            size="sm"
                            className="h-8"
                            data-testid={`dispatch-send-${row.id}`}
                            disabled={Boolean(dispatchingId)}
                            onClick={() => (row.line_closed || row.order_closed ? setConfirmClosedId(row.id) : onDispatch(row))}
                          >
                            <Send className="mr-1 h-3.5 w-3.5" aria-hidden /> {dispatchingId === row.id ? "Dispatching…" : "Dispatch"}
                          </Button>
                        ) : null}
                        {["DISPATCHED", "IN_TRANSIT"].includes(status) ? (
                          <Button size="sm" variant="outline" className="h-8" data-testid={`dispatch-deliver-history-${row.id}`} onClick={() => onPod(row)}>
                            Confirm POD
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="border-t border-line px-4 py-6 text-center text-[12.5px] text-content-3">
          <b className="block text-content-2">{loading ? "Loading slips…" : "No challans match"}</b>
          {loading ? "" : "Try another status, date or search."}
        </div>
      )}
      <footer className="flex items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-[11.5px] text-content-3">
        <span data-testid="dispatch-history-total">
          Showing {total ? (safePage - 1) * PAGE + 1 : 0}–{(safePage - 1) * PAGE + paged.length} of {n(total, 0)} challans
          {history.isError ? <span className="ml-2 text-danger-fg">· could not refresh</span> : null}
        </span>
        <Pager page={safePage} pageCount={pageCount} onPageChange={setPage} testId="dispatch-history-page" />
      </footer>
    </section>
  );
}

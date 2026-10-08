"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";
import { AlertTriangle, ChevronLeft, ChevronRight, ClipboardList, FileImage, Inbox, PackagePlus, RefreshCw, Search } from "lucide-react";

import { PageHero, Panel, PanelEmpty } from "@/components/premium";
import { cn } from "@/lib/utils";
import { factoryService } from "@/services/factory";
import { BILL_STATUS_META, gateBillsApi, RECEIPT_KIND_LABEL, type BillQueueFilter, type InwardBill } from "@/services/gate-bills";
import {
  BILL_POLL_MS,
  BillAccessDenied,
  BillStatusPill,
  BillThumb,
  billDateTime,
  billRef,
  useBillReviewAccess,
  useNowTick,
  waitingLabel,
} from "./bill-common";

const PAGE_SIZE = 25;

const TABS: Array<{ key: BillQueueFilter; label: string; hint: string }> = [
  { key: "OPEN", label: "Still to receive", hint: "Waiting for GRN + partly received" },
  { key: "PENDING_GRN", label: BILL_STATUS_META.PENDING_GRN.label, hint: BILL_STATUS_META.PENDING_GRN.hint },
  { key: "PARTIAL_GRN", label: BILL_STATUS_META.PARTIAL_GRN.label, hint: BILL_STATUS_META.PARTIAL_GRN.hint },
  { key: "RECEIPTED", label: "Received", hint: BILL_STATUS_META.RECEIPTED.hint },
  { key: "VOID", label: "Resolved, no GRN", hint: BILL_STATUS_META.VOID.hint },
];

function useDebounced<T>(value: T, delay = 350) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), delay);
    return () => window.clearTimeout(t);
  }, [value, delay]);
  return v;
}

function ago(ts: number, now: number) {
  if (!ts) return "never";
  const s = Math.max(0, Math.round((now - ts) / 1000));
  return s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`;
}

export function GateBillQueue() {
  const access = useBillReviewAccess();
  const [tab, setTab] = useState<BillQueueFilter>("OPEN");
  const [plant, setPlant] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [searchText, setSearchText] = useState("");
  const search = useDebounced(searchText.trim());
  const [page, setPage] = useState(1);
  const now = useNowTick(5_000);
  useEffect(() => setPage(1), [tab, plant, dateFrom, dateTo, search]);

  const enabled = access.allowed;
  const filters = { plant, date_from: dateFrom || undefined, date_to: dateTo || undefined, search: search || undefined };

  const listQ = useQuery({
    queryKey: ["inventory", "gate-bills", "list", tab, filters, page],
    queryFn: () => gateBillsApi.list({ ...filters, status: tab, page, page_size: PAGE_SIZE }),
    enabled,
    placeholderData: keepPreviousData,
    refetchInterval: BILL_POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    meta: { suppressGlobalError: true },
  });

  // Server counts per tab (count only, page_size=1) — never derived from a page.
  const countQs = useQueries({
    queries: TABS.map((t) => ({
      queryKey: ["inventory", "gate-bills", "count", t.key, filters],
      queryFn: () => gateBillsApi.list({ ...filters, status: t.key, page_size: 1 }),
      enabled,
      refetchInterval: BILL_POLL_MS,
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      select: (data: { count: number }) => data.count,
      meta: { suppressGlobalError: true },
    })),
  });

  const summaryQ = useQuery({
    queryKey: ["inventory", "gate-bills", "summary"],
    queryFn: () => gateBillsApi.summary(),
    enabled,
    refetchInterval: BILL_POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    meta: { suppressGlobalError: true },
  });

  const plantsQ = useQuery({
    queryKey: ["factory-plants", "gate-bills"],
    queryFn: factoryService.getPlants,
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
    meta: { suppressGlobalError: true },
  });
  const plantOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of plantsQ.data ?? []) map.set(String(p.id), p.name);
    for (const p of summaryQ.data?.plant_counts ?? []) if (!map.has(p.plant)) map.set(p.plant, p.plant_name);
    for (const b of listQ.data?.results ?? []) if (!map.has(b.plant)) map.set(b.plant, b.plant_name);
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [plantsQ.data, summaryQ.data, listQ.data]);

  if (access.loading) return <div className="h-40 animate-pulse rounded-3xl bg-surface-2" />;
  if (!access.allowed) return <BillAccessDenied />;

  const rows = listQ.data?.results ?? [];
  const count = listQ.data?.count ?? 0;
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const stalled = listQ.isError && Boolean(listQ.data);
  const pending = summaryQ.data?.pending_count;

  return (
    <div className="mx-auto max-w-[1400px] space-y-4" data-testid="gate-bill-queue">
      <PageHero
        eyebrow="Inventory · receiving"
        icon={<Inbox />}
        title="Gate bills · pending GRNs"
        description="Bills photographed at the factory gate. Open one to see the photo, then post a GRN or match an existing receipt. A bill stays here until inventory confirms every line is received."
        actions={
          <Link
            href="/inventory/grn"
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-white/10 px-4 text-[13px] font-semibold text-white hover:bg-white/15"
          >
            <PackagePlus className="h-4 w-4" /> Smart GRN
          </Link>
        }
        compact
      >
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px] text-white/80">
          <span>
            <span className="text-[22px] font-semibold tabular-nums text-white">{pending ?? "—"}</span> still to receive
          </span>
          {summaryQ.data?.unread_count ? <span>{summaryQ.data.unread_count} new alert{summaryQ.data.unread_count === 1 ? "" : "s"}</span> : null}
          <span className="inline-flex items-center gap-1.5">
            <RefreshCw className={cn("h-3.5 w-3.5", listQ.isFetching ? "animate-spin" : "")} aria-hidden />
            Updated {ago(listQ.dataUpdatedAt, now)}
          </span>
          {summaryQ.isError ? <span role="status">Pending total could not refresh — last confirmed total shown</span> : null}
        </div>
      </PageHero>

      <div className="flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Bill status">
        {TABS.map((t, i) => {
          const active = t.key === tab;
          const n = t.key === tab && !listQ.isPlaceholderData ? listQ.data?.count : countQs[i]?.data;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active}
              title={t.hint}
              onClick={() => setTab(t.key)}
              onKeyDown={(event) => {
                const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
                const next = event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : delta ? (i + delta + TABS.length) % TABS.length : -1;
                if (next < 0) return;
                event.preventDefault();
                setTab(TABS[next].key);
                (event.currentTarget.parentElement?.children[next] as HTMLButtonElement | undefined)?.focus();
              }}
              tabIndex={active ? 0 : -1}
              className={cn(
                "inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-full border px-4 text-[13px] font-semibold transition-colors",
                active ? "border-transparent bg-content-1 text-surface-1" : "border-line bg-surface-1 text-content-2 hover:bg-surface-2",
              )}
            >
              {t.label}
              <span className={cn("rounded-full px-2 py-0.5 text-[11px] tabular-nums", active ? "bg-white/15" : "bg-surface-2")}>{n ?? "–"}</span>
            </button>
          );
        })}
      </div>

      <Panel bodyClassName="space-y-3">
        {listQ.isPlaceholderData ? <p role="status" className="text-sm text-content-3">Updating filters… previous results remain visible until the current list loads.</p> : null}
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,0.8fr)]">
          <label className="relative block">
            <span className="sr-only">Search invoice number</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-4" />
            <input
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search reviewed invoice number"
              className="h-11 w-full rounded-xl border border-line bg-surface-2 pl-9 pr-3 text-[14px] text-content-1 outline-none focus:border-primary focus:ring-2 focus:ring-info-border"
            />
          </label>
          <label className="block">
            <span className="sr-only">Factory</span>
            <select
              value={plant}
              onChange={(e) => setPlant(e.target.value)}
              className="h-11 w-full rounded-xl border border-line bg-surface-2 px-3 text-[14px] text-content-1 outline-none focus:border-primary"
            >
              <option value="">All factories</option>
              {plantOptions.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="sr-only">Arrived from</span>
            <input type="date" value={dateFrom} max={dateTo || undefined} onChange={(e) => setDateFrom(e.target.value)} aria-label="Arrived from" className="h-11 w-full rounded-xl border border-line bg-surface-2 px-3 text-[14px] text-content-1" />
          </label>
          <label className="block">
            <span className="sr-only">Arrived to</span>
            <input type="date" value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} aria-label="Arrived to" className="h-11 w-full rounded-xl border border-line bg-surface-2 px-3 text-[14px] text-content-1" />
          </label>
        </div>

        {stalled || (listQ.isError && !listQ.data) ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger-border bg-danger-bg px-4 py-3 text-[13px] text-danger-fg">
            <span className="inline-flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              {stalled ? `Live refresh stopped — showing data from ${ago(listQ.dataUpdatedAt, now)}.` : "Could not load gate bills."}
            </span>
            <button type="button" onClick={() => void listQ.refetch()} className="min-h-[36px] rounded-lg bg-surface-1 px-3 font-semibold text-content-1">
              Retry now
            </button>
          </div>
        ) : null}

        {listQ.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-[84px] animate-pulse rounded-2xl bg-surface-2" />
            ))}
          </div>
        ) : rows.length ? (
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line" aria-label="Gate bills">
            {rows.map((bill) => (
              <BillRow key={bill.id} bill={bill} now={now} />
            ))}
          </ul>
        ) : !listQ.isError ? (
          <PanelEmpty icon={<ClipboardList />} title={tab === "OPEN" ? "Nothing waiting for a GRN" : "No bills for these filters"}>
            {tab === "OPEN" ? "New bill photos from the gate appear here within a few seconds." : "Try another status, factory or date range."}
          </PanelEmpty>
        ) : null}

        <div className="flex items-center justify-between gap-3 text-[13px] text-content-3">
          <span className="tabular-nums">
            {count.toLocaleString("en-IN")} bill{count === 1 ? "" : "s"}
            {tab === "PENDING_GRN" || tab === "OPEN" ? " · oldest arrival first" : ""}
          </span>
          <div className="flex items-center gap-2">
            <button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-surface-1 disabled:opacity-40">
              <ChevronLeft className="h-5 w-5" />
            </button>
            <span className="min-w-[64px] text-center tabular-nums">
              {page} / {pages}
            </span>
            <button type="button" aria-label="Next page" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-surface-1 disabled:opacity-40">
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        </div>
      </Panel>
    </div>
  );
}

function BillRow({ bill, now }: { bill: InwardBill; now: number }) {
  const open = bill.status === "PENDING_GRN" || bill.status === "PARTIAL_GRN";
  const review = bill.review_data || {};
  const refs = bill.receipt_refs || [];
  const kinds = Array.from(new Set(refs.map((r) => RECEIPT_KIND_LABEL[r.kind] ?? r.kind)));
  return (
    <li>
      <Link
        href={`/inventory/gate-bills/${bill.id}`}
        className="flex min-h-[84px] items-center gap-3 px-3 py-3 transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border sm:px-4"
      >
        <BillThumb imageUrl={bill.pages?.[0]?.image_url} alt={`Bill ${billRef(bill.id)} page 1`} className="h-16 w-12 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-[14px] font-semibold text-content-1">{bill.plant_name}</span>
            <BillStatusPill status={bill.status} />
          </div>
          <div className="mt-0.5 truncate text-[12.5px] text-content-3">
            Arrived {billDateTime(bill.arrival_at)} · by {bill.created_by_name} · <span className="font-mono">{billRef(bill.id)}</span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12.5px] text-content-2">
            <span className="inline-flex items-center gap-1">
              <FileImage className="h-3.5 w-3.5 text-content-4" aria-hidden />
              {bill.page_count} page{bill.page_count === 1 ? "" : "s"}
            </span>
            {review.invoice_number ? <span className="font-mono">Inv {review.invoice_number}</span> : null}
            {review.vendor_name ? <span className="truncate">{review.vendor_name}</span> : null}
            {refs.length ? <span>{refs.length} receipt{refs.length === 1 ? "" : "s"} · {kinds.join(", ")}</span> : null}
            {bill.duplicate_warning?.possible_duplicate ? <span className="font-semibold text-warning-fg">Possible repeat upload</span> : null}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className={cn("text-[15px] font-semibold tabular-nums", open ? "text-content-1" : "text-content-3")}>
            {waitingLabel(bill.arrival_at, now, open ? null : bill.resolved_at)}
          </div>
          <div className="text-[11px] text-content-4">{open ? "waiting" : "to close"}</div>
        </div>
        <ChevronRight className="hidden h-5 w-5 shrink-0 text-content-4 sm:block" aria-hidden />
      </Link>
    </li>
  );
}

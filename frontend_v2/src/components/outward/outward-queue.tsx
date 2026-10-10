"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, ClipboardList, FileImage, RefreshCw, Search, Truck } from "lucide-react";

import { PageHero, Panel, PanelEmpty } from "@/components/premium";
import { cn } from "@/lib/utils";
import { outwardApi, type OutwardDocument, type OutwardQueueFilter } from "@/services/outward";

import { LoadFailure, RightsDenied, docDateTime, useDebounced, useDocumentRights } from "./document-rights";
import { OutwardStatusPill, PageThumb, useNowTick, waitingSince } from "./outward-common";

const PAGE_SIZE = 25;
const POLL_MS = 15_000;

const TABS: Array<{ key: OutwardQueueFilter; label: string; hint: string }> = [
  { key: "PENDING_MATCH", label: "Pending match", hint: "Photos waiting for the office to confirm the ERP document" },
  { key: "DISCREPANCY", label: "Discrepancy", hint: "A difference was noted and needs follow-up" },
  { key: "MATCHED", label: "Matched", hint: "Linked to the ERP documents that left" },
  { key: "ALL", label: "All", hint: "Every outward photo record, including voided ones" },
];

export function OutwardQueue() {
  const rights = useDocumentRights();
  const allowed = rights.has("outward.reconcile");
  const [tab, setTab] = useState<OutwardQueueFilter>("PENDING_MATCH");
  const [plant, setPlant] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [linked, setLinked] = useState<"" | "true" | "false">("");
  const [searchText, setSearchText] = useState("");
  const search = useDebounced(searchText.trim());
  const [page, setPage] = useState(1);
  const now = useNowTick(15_000);
  useEffect(() => setPage(1), [tab, plant, dateFrom, dateTo, search, linked]);

  const filters = { plant, date_from: dateFrom || undefined, date_to: dateTo || undefined, search: search || undefined, has_links: linked || undefined };
  const listQ = useQuery({
    queryKey: ["inventory", "outward", "list", tab, filters, page],
    queryFn: () => outwardApi.list({ ...filters, status: tab, page, page_size: PAGE_SIZE }),
    enabled: allowed,
    placeholderData: keepPreviousData,
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    meta: { suppressGlobalError: true },
  });
  // Factory filter options come with the list: outward-only accounts hold no gate-pass rights.
  const plantOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of listQ.data?.plants ?? []) map.set(p.id, p.name);
    for (const row of listQ.data?.results ?? []) if (!map.has(row.plant)) map.set(row.plant, row.plant_name);
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [listQ.data]);

  if (rights.loading) return <div className="h-40 animate-pulse rounded-3xl bg-surface-2" />;
  if (!allowed) {
    return (
      <RightsDenied
        title="Outward documents are for the inventory team"
        body="Inventory users, administrators and owners match the papers the gate photographs leaving the factory. Other accounts need the “Match outward gate photos” right in the role matrix. Watchmen record departures on the gate terminal instead."
      />
    );
  }

  const rows = listQ.data?.results ?? [];
  const count = listQ.data?.count ?? 0;
  const counts = listQ.data?.counts;
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));

  return (
    <div className="mx-auto max-w-[1400px] space-y-4" data-testid="outward-queue">
      <PageHero
        eyebrow="Inventory · gate evidence"
        icon={<Truck />}
        title="Outward documents"
        description="Papers the watchman photographed as goods left the gate. QR-printed ERP papers match themselves; open the rest to link the challan, invoice or gate pass they belong to. Matching never moves stock."
        compact
      >
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px] text-white/80">
          <span>
            <span className="text-[22px] font-semibold tabular-nums text-white">{counts?.OPEN ?? "—"}</span> to follow up
          </span>
          <span className="inline-flex items-center gap-1.5">
            <RefreshCw className={cn("h-3.5 w-3.5", listQ.isFetching ? "animate-spin" : "")} aria-hidden />
            {listQ.dataUpdatedAt ? `Updated ${new Date(listQ.dataUpdatedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}` : "Loading…"}
          </span>
        </div>
      </PageHero>

      <div className="flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Outward status">
        {TABS.map((t, i) => {
          const active = t.key === tab;
          const n = counts?.[t.key as keyof typeof counts];
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active}
              title={t.hint}
              tabIndex={active ? 0 : -1}
              onClick={() => setTab(t.key)}
              onKeyDown={(event) => {
                const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
                const next = event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : delta ? (i + delta + TABS.length) % TABS.length : -1;
                if (next < 0) return;
                event.preventDefault();
                setTab(TABS[next].key);
                (event.currentTarget.parentElement?.children[next] as HTMLButtonElement | undefined)?.focus();
              }}
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
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,0.8fr)]">
          <label className="relative block">
            <span className="sr-only">Search vehicle, reference or party</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-4" />
            <input
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Vehicle, DC / invoice no. or party"
              className="h-11 w-full rounded-xl border border-line bg-surface-2 pl-9 pr-3 text-[14px] text-content-1 outline-none focus:border-primary focus:ring-2 focus:ring-info-border"
            />
          </label>
          <label className="block">
            <span className="sr-only">Factory</span>
            <select value={plant} onChange={(e) => setPlant(e.target.value)} className="h-11 w-full rounded-xl border border-line bg-surface-2 px-3 text-[14px] text-content-1 outline-none focus:border-primary">
              <option value="">All factories</option>
              {plantOptions.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="sr-only">ERP link</span>
            <select value={linked} onChange={(e) => setLinked(e.target.value as "" | "true" | "false")} className="h-11 w-full rounded-xl border border-line bg-surface-2 px-3 text-[14px] text-content-1 outline-none focus:border-primary">
              <option value="">Linked or not</option>
              <option value="true">Has an ERP link</option>
              <option value="false">No ERP link yet</option>
            </select>
          </label>
          <label className="block">
            <span className="sr-only">Left from</span>
            <input type="date" value={dateFrom} max={dateTo || undefined} onChange={(e) => setDateFrom(e.target.value)} aria-label="Left from" className="h-11 w-full rounded-xl border border-line bg-surface-2 px-3 text-[14px] text-content-1" />
          </label>
          <label className="block">
            <span className="sr-only">Left to</span>
            <input type="date" value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} aria-label="Left to" className="h-11 w-full rounded-xl border border-line bg-surface-2 px-3 text-[14px] text-content-1" />
          </label>
        </div>

        {listQ.isError ? <LoadFailure subject="Outward documents" error={listQ.error} retry={() => void listQ.refetch()} /> : null}
        {listQ.isPlaceholderData ? <p role="status" className="text-sm text-content-3">Updating… previous results stay visible until the new list loads.</p> : null}

        {listQ.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-[84px] animate-pulse rounded-2xl bg-surface-2" />
            ))}
          </div>
        ) : rows.length ? (
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line" aria-label="Outward documents">
            {rows.map((row) => (
              <OutwardRow key={row.id} row={row} now={now} />
            ))}
          </ul>
        ) : !listQ.isError ? (
          <PanelEmpty icon={<ClipboardList />} title={tab === "PENDING_MATCH" ? "Nothing waiting to be matched" : "No outward records for these filters"}>
            {tab === "PENDING_MATCH" ? "New photos from the gate appear here within a few seconds. QR-printed papers are matched automatically." : "Try another status, factory or date range."}
          </PanelEmpty>
        ) : null}

        <div className="flex items-center justify-between gap-3 text-[13px] text-content-3">
          <span className="tabular-nums">
            {count.toLocaleString("en-IN")} record{count === 1 ? "" : "s"}
            {tab === "PENDING_MATCH" || tab === "DISCREPANCY" ? " · oldest first" : ""}
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

function OutwardRow({ row, now }: { row: OutwardDocument; now: number }) {
  const open = row.status === "PENDING_MATCH" || row.status === "DISCREPANCY";
  const unknown = row.scanned_refs.filter((ref) => ref.status === "INVALID").length;
  return (
    <li>
      <Link
        href={`/inventory/outward-documents/${row.id}`}
        className="flex min-h-[84px] items-center gap-3 px-3 py-3 transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border sm:px-4"
      >
        <PageThumb url={row.pages?.[0]?.thumb_url ?? row.pages?.[0]?.image_url} alt={`Outward ${row.reference} page 1`} className="h-16 w-12 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-[14px] font-semibold text-content-1">{row.plant_name}</span>
            <OutwardStatusPill status={row.status} />
            {row.vehicle_number ? <span className="rounded-md border border-line bg-surface-1 px-1.5 py-0.5 font-mono text-[12px] font-semibold text-content-1">{row.vehicle_number}</span> : null}
          </div>
          <div className="mt-0.5 truncate text-[12.5px] text-content-3">
            Left {docDateTime(row.departed_at)} · by {row.created_by_name} · <span className="font-mono">{row.reference}</span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12.5px] text-content-2">
            <span className="inline-flex items-center gap-1">
              <FileImage className="h-3.5 w-3.5 text-content-4" aria-hidden />
              {row.page_count} page{row.page_count === 1 ? "" : "s"}
            </span>
            {row.links.length ? (
              <span className="truncate">
                {row.links.map((link) => `${link.reference}${link.party_name ? ` (${link.party_name})` : ""}`).join(", ")}
              </span>
            ) : (
              <span className="text-content-3">No ERP document linked</span>
            )}
            {unknown ? <span className="font-semibold text-warning-fg">{unknown} unrecognised code{unknown === 1 ? "" : "s"}</span> : null}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className={cn("text-[15px] font-semibold tabular-nums", open ? "text-content-1" : "text-content-3")}>{open ? waitingSince(row.departed_at, now) : row.link_count}</div>
          <div className="text-[11px] text-content-4">{open ? "waiting" : row.link_count === 1 ? "document" : "documents"}</div>
        </div>
        <ChevronRight className="hidden h-5 w-5 shrink-0 text-content-4 sm:block" aria-hidden />
      </Link>
    </li>
  );
}

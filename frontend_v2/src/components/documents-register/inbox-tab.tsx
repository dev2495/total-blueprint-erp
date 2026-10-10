"use client";

import { useEffect, useState } from "react";
import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";
import { ClipboardList, RefreshCw } from "lucide-react";

import { Panel, PanelEmpty } from "@/components/premium";
import { cn } from "@/lib/utils";
import { gateBillsApi, type BillQueueFilter } from "@/services/gate-bills";
import { BILL_POLL_MS, useNowTick } from "@/components/inventory/gate-bills/bill-common";
import { DocumentRow } from "./document-row";
import { ErrorBanner, ListSkeleton, Pager, PlantSelect } from "./shared";

const PAGE_SIZE = 25;

export const INBOX_CHIPS: Array<{ key: BillQueueFilter; label: string; hint: string; empty: string }> = [
  { key: "NEEDS_CLASSIFYING", label: "Needs classifying", hint: "New gate photos and office uploads with no category yet", empty: "Nothing new to classify. Gate photos and office uploads appear here within a few seconds." },
  { key: "WAITING_RECEIPT", label: "Waiting for receipt", hint: "Classified, nothing received or filed yet", empty: "No classified bill is waiting for a receipt or filing." },
  { key: "PARTIAL_GRN", label: "Partly received", hint: "Some receipts linked — confirm complete when every line is in", empty: "No bill is partly received." },
];

function ago(ts: number, now: number) {
  if (!ts) return "never";
  const s = Math.max(0, Math.round((now - ts) / 1000));
  return s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`;
}

export function InboxTab() {
  const [chip, setChip] = useState<BillQueueFilter>("NEEDS_CLASSIFYING");
  const [plant, setPlant] = useState("");
  const [page, setPage] = useState(1);
  const now = useNowTick(5_000);
  useEffect(() => setPage(1), [chip, plant]);

  const listQ = useQuery({
    queryKey: ["inventory", "gate-bills", "inbox", chip, plant, page],
    queryFn: () => gateBillsApi.list({ status: chip, plant, ordering: "-arrival_at", page, page_size: PAGE_SIZE }),
    placeholderData: keepPreviousData,
    refetchInterval: BILL_POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    meta: { suppressGlobalError: true },
  });
  const counts = useQueries({
    queries: INBOX_CHIPS.map((c) => ({
      queryKey: ["inventory", "gate-bills", "inbox-count", c.key, plant],
      queryFn: () => gateBillsApi.list({ status: c.key, plant, page_size: 1 }),
      refetchInterval: BILL_POLL_MS,
      refetchIntervalInBackground: false,
      select: (data: { count: number }) => data.count,
      meta: { suppressGlobalError: true },
    })),
  });

  const rows = listQ.data?.results ?? [];
  const count = listQ.data?.count ?? 0;
  const active = INBOX_CHIPS.find((c) => c.key === chip) ?? INBOX_CHIPS[0];
  return (
    <Panel bodyClassName="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-1.5 overflow-x-auto pb-1" role="radiogroup" aria-label="Inbox stage">
          {INBOX_CHIPS.map((c, i) => {
            const on = c.key === chip;
            const n = on && !listQ.isPlaceholderData ? listQ.data?.count : counts[i]?.data;
            return (
              <button
                key={c.key}
                type="button"
                role="radio"
                aria-checked={on}
                title={c.hint}
                onClick={() => setChip(c.key)}
                className={cn(
                  "inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-full border px-4 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border",
                  on ? "border-transparent bg-content-1 text-surface-1" : "border-line bg-surface-1 text-content-2 hover:bg-surface-2",
                )}
              >
                {c.label}
                <span className={cn("rounded-full px-2 py-0.5 text-[11px] tabular-nums", on ? "bg-white/15" : "bg-surface-2")}>{n ?? "–"}</span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2 sm:w-[260px]">
          <div className="flex-1">
            <PlantSelect value={plant} onChange={setPlant} />
          </div>
          <span className="hidden items-center gap-1 text-[12px] text-content-4 lg:inline-flex" title="Refreshes every 5 seconds while this tab is visible">
            <RefreshCw className={cn("h-3.5 w-3.5", listQ.isFetching ? "animate-spin" : "")} aria-hidden />
            {ago(listQ.dataUpdatedAt, now)}
          </span>
        </div>
      </div>
      <p className="text-[12.5px] text-content-3">{active.hint}. Newest first.</p>
      {listQ.isError ? <ErrorBanner error={listQ.error} onRetry={() => void listQ.refetch()} title={listQ.data ? "Live refresh stopped — showing the last list." : "Could not load the inbox."} /> : null}
      {listQ.isLoading ? (
        <ListSkeleton />
      ) : rows.length ? (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line" aria-label={active.label}>
          {rows.map((bill) => (
            <DocumentRow key={bill.id} bill={bill} now={now} />
          ))}
        </ul>
      ) : !listQ.isError ? (
        <PanelEmpty icon={<ClipboardList />} title={`${active.label}: nothing here`}>
          {active.empty}
        </PanelEmpty>
      ) : null}
      {count > PAGE_SIZE ? <Pager page={page} pages={Math.max(1, Math.ceil(count / PAGE_SIZE))} count={count} noun="document" onPage={setPage} /> : null}
    </Panel>
  );
}

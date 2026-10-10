"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ClipboardList, Plus } from "lucide-react";

import { cn } from "@/lib/utils";
import { gateApi, type GateDirection } from "@/services/gate";
import { useGate } from "./gate-shell";
import { useGateSummary } from "./gate-home";
import { DIRECTION_META } from "./gate-format";
import { EmptyState, GateAction } from "./gate-ui";
import { RegisterLedger } from "./register-ledger";
import { TodayDepartures } from "./outward-capture";

export function TodayRegister() {
  const { plantId, plant, canSubmitOutward } = useGate();
  const [filter, setFilter] = useState<"ALL" | GateDirection>("ALL");
  const summary = useGateSummary();
  // Direction is filtered by the server; pages of 100 load on demand.
  const query = useInfiniteQuery({
    queryKey: ["gate", "goods", "today", plantId, filter],
    queryFn: ({ pageParam }) =>
      gateApi.listGoods({ plant: plantId, direction: filter === "ALL" ? undefined : filter, page: pageParam, page_size: 100 }),
    initialPageParam: 1,
    getNextPageParam: (last, pages) => (last.next ? pages.length + 1 : undefined),
    enabled: Boolean(plantId),
    refetchInterval: 45_000,
    refetchOnWindowFocus: true,
    meta: { suppressGlobalError: true },
  });
  const rows = useMemo(() => (query.data?.pages ?? []).flatMap((page) => page.results), [query.data]);
  const total = query.data?.pages?.[0]?.count ?? 0;

  // Counts come from the server's today summary, never from a loaded page.
  const inward = summary.data?.inward;
  const outward = summary.data?.outward;
  const counts: Record<"ALL" | GateDirection, number | undefined> = {
    ALL: inward !== undefined && outward !== undefined ? inward + outward : filter === "ALL" ? total : undefined,
    INWARD: inward ?? (filter === "INWARD" ? total : undefined),
    OUTWARD: outward ?? (filter === "OUTWARD" ? total : undefined),
  };

  return (
    <div className="mx-auto max-w-[1100px] space-y-4">
      <div className="flex items-end justify-between gap-3 px-1 pt-1">
        <div>
          <div className="text-[13px] font-medium text-content-3">{plant?.name}</div>
          <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-content-1">Today&apos;s register</h1>
        </div>
        <Link
          href="/gate/goods"
          className="gate-press flex min-h-[48px] items-center gap-2 rounded-2xl px-4 text-[15px] font-semibold text-white"
          style={{ background: "var(--gate-in)" }}
        >
          <Plus className="h-5 w-5" /> Entry
        </Link>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Filter by direction">
        {(["ALL", "INWARD", "OUTWARD"] as const).map((key) => {
          const active = filter === key;
          const tone = key === "ALL" ? "var(--gate-ink-2)" : DIRECTION_META[key].tone;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setFilter(key)}
              className={cn(
                "gate-press flex min-h-[48px] shrink-0 items-center gap-2 rounded-full border px-4 text-[15px] font-semibold",
                active ? "border-transparent text-white" : "border-line bg-surface-1 text-content-2",
              )}
              style={active ? { background: tone } : undefined}
            >
              {key === "ALL" ? "All" : DIRECTION_META[key].label}
              <span className="gate-num text-[13px] opacity-80">{counts[key] ?? "–"}</span>
            </button>
          );
        })}
      </div>

      {query.isError ? (
        <div className="gate-card p-4 text-[14px] text-content-3">Could not load today&apos;s register. It refreshes automatically.</div>
      ) : rows.length ? (
        <>
          <RegisterLedger rows={rows} />
          {query.hasNextPage ? (
            <GateAction tone="plain" size="md" className="w-full" busy={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
              Load earlier entries ({total - rows.length} more)
            </GateAction>
          ) : (
            <p className="px-1 text-center text-[12px] text-content-4">All {total} entries shown.</p>
          )}
        </>
      ) : (
        <div className="gate-card">
          <EmptyState
            icon={<ClipboardList className="h-6 w-6" />}
            title={query.isLoading ? "Loading…" : filter === "ALL" ? "No entries yet today" : `No ${DIRECTION_META[filter].label.toLowerCase()} entries yet today`}
            body="Every inward and outward vehicle you save appears here with its server time."
          />
        </div>
      )}
      <p className="px-1 text-[12px] text-content-4">Entries cannot be edited here. The owner corrects mistakes with a recorded reason.</p>
      {canSubmitOutward ? <TodayDepartures /> : null}
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { DoorOpen, History, Loader2, Search } from "lucide-react";

import { useGate } from "./gate-shell";
import { useGateSummary, useNow, useVisitorPages } from "./gate-home";
import { EmptyState, GateAction, SectionHeading } from "./gate-ui";
import { OVERDUE_INSIDE_MINUTES, VisitorPass } from "./visitor-cards";

function useDebounced<T>(value: T, delay = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), delay);
    return () => window.clearTimeout(t);
  }, [value, delay]);
  return v;
}

/**
 * Final visitor flow: visitors record their own entry by QR, so the gate
 * screen is the Inside queue with check-out only. The API returns INSIDE
 * oldest entry first across pages; search runs on the server.
 */
export function VisitorQueue() {
  const { isOwner } = useGate();
  const [query, setQuery] = useState("");
  const search = useDebounced(query.trim());
  const now = useNow();
  const summary = useGateSummary();
  const inside = useVisitorPages("INSIDE", search);

  const rows = useMemo(
    () => Array.from(new Map((inside.data?.pages ?? []).flatMap((page) => page.results).map((v) => [v.id, v])).values()),
    [inside.data],
  );
  const total = inside.data?.pages?.[0]?.count ?? 0;
  const insideCount = summary.data?.inside_visitors ?? total;
  const overdueCount = summary.data?.overdue_visitors ?? 0;

  return (
    <div className="mx-auto max-w-[640px] space-y-4">
      <div className="flex items-end justify-between px-1 pt-1">
        <div>
          <div className="text-[13px] font-medium text-content-3">Visitors record their own entry by QR</div>
          <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-content-1">Inside now</h1>
        </div>
        <span
          className="gate-num mb-1 min-w-[40px] rounded-full px-3 py-1 text-center text-[16px] font-semibold text-white"
          style={{ background: insideCount > 0 ? "var(--gate-inside)" : "var(--content-4)" }}
          aria-label={`${insideCount} visitors inside`}
        >
          {insideCount}
        </span>
      </div>

      {overdueCount > 0 ? (
        <div className="rounded-2xl border px-4 py-3 text-[14px] font-medium" style={{ borderColor: "var(--gate-alert-edge)", background: "var(--gate-alert-soft)", color: "var(--gate-alert)" }}>
          {overdueCount} visitor{overdueCount === 1 ? "" : "s"} inside for more than {OVERDUE_INSIDE_MINUTES / 60} hours — listed first. Check out anyone who has left.
        </div>
      ) : null}

      <label className="relative block">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-content-4" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, mobile or company"
          className="gate-field !pl-12"
          inputMode="search"
          autoComplete="off"
          aria-label="Search visitors"
        />
        {inside.isFetching && search ? <Loader2 className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-content-4" /> : null}
      </label>

      {inside.isError ? (
        <div className="gate-card p-4 text-[14px] text-content-3">Could not load visitors. The list refreshes automatically.</div>
      ) : rows.length ? (
        <div className="space-y-3">
          {rows.map((visitor) => (
            <VisitorPass key={visitor.id} visitor={visitor} now={now} />
          ))}
          {inside.hasNextPage ? (
            <GateAction tone="plain" size="md" className="w-full" busy={inside.isFetchingNextPage} onClick={() => void inside.fetchNextPage()}>
              Load more ({total - rows.length} more)
            </GateAction>
          ) : (
            <p className="text-center text-[12px] text-content-4">
              All {total} shown{search ? " for this search" : ""}.
            </p>
          )}
        </div>
      ) : (
        <div className="gate-card">
          <EmptyState
            icon={<DoorOpen className="h-6 w-6" />}
            title={inside.isLoading ? "Loading…" : search ? "No visitor inside matches this search" : "No visitors inside"}
            body={search ? "Search covers every visitor inside at this gate." : "Visitors appear here as soon as they submit the gate QR form."}
          />
        </div>
      )}

      {isOwner ? <LegacyPending now={now} /> : null}
    </div>
  );
}

/** Owner-only recovery for registrations created before the final flow. */
function LegacyPending({ now }: { now: number }) {
  const pending = useVisitorPages("PENDING", "");
  const rows = useMemo(() => (pending.data?.pages ?? []).flatMap((page) => page.results), [pending.data]);
  const total = pending.data?.pages?.[0]?.count ?? 0;
  if (!total) return null;
  return (
    <section className="pt-4">
      <SectionHeading eyebrow="Owner · recovery" title={`Legacy pending registrations (${total})`} action={<History className="h-5 w-5 text-content-4" />} />
      <p className="mb-3 px-1 text-[13px] text-content-3">Created under the earlier admit flow. Record their entry if they came in, or remove them from the queue.</p>
      <div className="space-y-3">
        {rows.map((visitor) => (
          <VisitorPass key={visitor.id} visitor={visitor} now={now} />
        ))}
        {pending.hasNextPage ? (
          <GateAction tone="plain" size="md" className="w-full" busy={pending.isFetchingNextPage} onClick={() => void pending.fetchNextPage()}>
            Load more ({total - rows.length} more)
          </GateAction>
        ) : null}
      </div>
    </section>
  );
}

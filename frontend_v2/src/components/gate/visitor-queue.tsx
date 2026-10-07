"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { DoorOpen, Loader2, Search, UserPlus, Users } from "lucide-react";

import { cn } from "@/lib/utils";
import { useGateSummary, useNow, useVisitorPages } from "./gate-home";
import { EmptyState, GateAction } from "./gate-ui";
import { OVERDUE_INSIDE_MINUTES, VisitorPass } from "./visitor-cards";
import { gateMinutesSince } from "./gate-format";

function useDebounced<T>(value: T, delay = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), delay);
    return () => window.clearTimeout(t);
  }, [value, delay]);
  return v;
}

export function VisitorQueue() {
  const [tab, setTab] = useState<"PENDING" | "INSIDE">("PENDING");
  const [query, setQuery] = useState("");
  const search = useDebounced(query.trim());
  const now = useNow();
  const summary = useGateSummary();
  const pending = useVisitorPages("PENDING", tab === "PENDING" ? search : "");
  const inside = useVisitorPages("INSIDE", tab === "INSIDE" ? search : "");
  const active = tab === "PENDING" ? pending : inside;

  const loaded = useMemo(() => (active.data?.pages ?? []).flatMap((page) => page.results), [active.data]);
  const total = active.data?.pages?.[0]?.count ?? 0;
  const rows = useMemo(() => {
    // API already returns oldest wait / longest inside first; this keeps that
    // order stable after "Load more" and dedupes rows shifted between pages.
    const unique = Array.from(new Map(loaded.map((v) => [v.id, v])).values());
    return unique.sort((a, b) =>
      tab === "PENDING"
        ? String(a.submitted_at).localeCompare(String(b.submitted_at))
        : String(a.entry_at ?? "").localeCompare(String(b.entry_at ?? "")),
    );
  }, [loaded, tab]);

  // Server truth for badges: summary counts (not just the loaded page).
  const pendingCount = summary.data?.pending_visitors ?? pending.data?.pages?.[0]?.count ?? 0;
  const insideCount = summary.data?.inside_visitors ?? inside.data?.pages?.[0]?.count ?? 0;
  const overdueCount =
    summary.data?.overdue_visitors ??
    (inside.data?.pages ?? []).flatMap((p) => p.results).filter((v) => gateMinutesSince(v.entry_at, now) >= OVERDUE_INSIDE_MINUTES).length;

  return (
    <div className="mx-auto max-w-[640px] space-y-4">
      <div className="flex items-end justify-between px-1 pt-1">
        <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-content-1">Visitors</h1>
        <Link
          href="/gate/visitors/new"
          className="gate-press flex min-h-[48px] items-center gap-2 rounded-2xl px-4 text-[15px] font-semibold text-white"
          style={{ background: "var(--gate-ink-2)" }}
        >
          <UserPlus className="h-5 w-5" /> Walk-in
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-1 rounded-[20px] bg-surface-1 p-1.5 shadow-[var(--gate-shadow)]" role="tablist">
        {(
          [
            { key: "PENDING", label: "Waiting", count: pendingCount, tone: "var(--gate-pending)" },
            { key: "INSIDE", label: "Inside", count: insideCount, tone: "var(--gate-inside)" },
          ] as const
        ).map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            onClick={() => setTab(item.key)}
            className={cn(
              "gate-press flex min-h-[56px] items-center justify-center gap-2 rounded-2xl text-[16px] font-semibold",
              tab === item.key ? "bg-surface-2 text-content-1" : "text-content-3",
            )}
          >
            {item.label}
            <span
              className="gate-num min-w-[28px] rounded-full px-2 py-0.5 text-[13px] text-white"
              style={{ background: item.count > 0 ? item.tone : "var(--content-4)" }}
            >
              {item.count}
            </span>
          </button>
        ))}
      </div>

      {tab === "INSIDE" && overdueCount > 0 ? (
        <div className="rounded-2xl border px-4 py-3 text-[14px] font-medium" style={{ borderColor: "var(--gate-alert-edge)", background: "var(--gate-alert-soft)", color: "var(--gate-alert)" }}>
          {overdueCount} visitor{overdueCount === 1 ? "" : "s"} inside for more than {OVERDUE_INSIDE_MINUTES / 60} hours. They are listed first — check out anyone who has left.
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
        {active.isFetching && search ? <Loader2 className="absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-content-4" /> : null}
      </label>

      {active.isError ? (
        <div className="gate-card p-4 text-[14px] text-content-3">Could not load visitors. The list refreshes automatically.</div>
      ) : rows.length ? (
        <div className="space-y-3">
          {rows.map((visitor) => (
            <VisitorPass key={visitor.id} visitor={visitor} now={now} />
          ))}
          {active.hasNextPage ? (
            <GateAction tone="plain" size="md" className="w-full" busy={active.isFetchingNextPage} onClick={() => void active.fetchNextPage()}>
              Load more ({total - loaded.length} more)
            </GateAction>
          ) : total > 0 ? (
            <p className="text-center text-[12px] text-content-4">All {total} shown{search ? " for this search" : ""}.</p>
          ) : null}
        </div>
      ) : (
        <div className="gate-card">
          <EmptyState
            icon={tab === "PENDING" ? <Users className="h-6 w-6" /> : <DoorOpen className="h-6 w-6" />}
            title={active.isLoading ? "Loading…" : search ? "No visitor matches this search" : tab === "PENDING" ? "No one waiting" : "No visitors inside"}
            body={search ? "Search covers every waiting or inside visitor at this gate." : tab === "PENDING" ? "Scanned QR registrations appear here." : "Admitted visitors stay here until checked out."}
          />
        </div>
      )}
    </div>
  );
}

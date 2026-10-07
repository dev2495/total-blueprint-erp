"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { BarChart3, ChevronRight, ClipboardList, DoorOpen, History, QrCode, Settings, Users } from "lucide-react";

import { gateApi, type GateDirection } from "@/services/gate";
import { useGate } from "./gate-shell";
import { DIRECTION_META } from "./gate-format";
import { DirectionGlyph, EmptyState, SectionHeading } from "./gate-ui";
import { VisitorPass } from "./visitor-cards";

export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function useGateSummary() {
  const { plantId } = useGate();
  return useQuery({
    queryKey: ["gate", "summary", plantId],
    queryFn: () => gateApi.summary(plantId),
    enabled: Boolean(plantId),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    meta: { suppressGlobalError: true },
  });
}

/**
 * Server-paged visitor queue. The API sorts PENDING by oldest submission and
 * INSIDE by oldest entry, so the first page already holds the longest waits
 * and overdue visitors; `search` runs on the server and "Load more" walks the
 * remaining pages, so every active visit stays reachable.
 */
export function useVisitorPages(status: "PENDING" | "INSIDE", search: string) {
  const { plantId } = useGate();
  return useInfiniteQuery({
    queryKey: ["gate", "visitors", plantId, status, "pages", search],
    queryFn: ({ pageParam }) => gateApi.listVisitors({ plant: plantId, status, search: search || undefined, page: pageParam, page_size: 100 }),
    initialPageParam: 1,
    getNextPageParam: (last, pages) => (last.next ? pages.length + 1 : undefined),
    enabled: Boolean(plantId),
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
    meta: { suppressGlobalError: true },
  });
}

export function useVisitorQueue(status: "PENDING" | "INSIDE") {
  const { plantId } = useGate();
  return useQuery({
    queryKey: ["gate", "visitors", plantId, status],
    queryFn: () => gateApi.listVisitors({ plant: plantId, status, page_size: 100 }),
    enabled: Boolean(plantId),
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
    meta: { suppressGlobalError: true },
  });
}

const DATE_LINE = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long" });

export function GateHome() {
  const { operatorName, isOwner, canLog } = useGate();
  const now = useNow();
  const summary = useGateSummary();
  const inside = useVisitorQueue("INSIDE");
  const s = summary.data ?? {};
  const insideRows = inside.data?.results ?? [];
  const insideCount = s.inside_visitors ?? inside.data?.count ?? 0;

  if (!canLog) {
    return (
      <div className="mx-auto max-w-[560px] space-y-3 pt-2">
        <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-content-1">Gate register</h1>
        <OwnerTools />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[640px] space-y-6">
      <div className="px-1 pt-1">
        <div className="text-[13px] font-medium text-content-3">{DATE_LINE.format(now)}</div>
        <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-content-1">
          {operatorName ? `Namaste, ${operatorName}` : "Gate register"}
        </h1>
      </div>

      {/* Focal: the two lanes. One thumb, one tap. */}
      <div className="grid grid-cols-2 gap-3">
        <LaneTile direction="INWARD" count={s.inward} loading={summary.isLoading} />
        <LaneTile direction="OUTWARD" count={s.outward} loading={summary.isLoading} />
      </div>

      <Link href="/gate/visitors" className="gate-card gate-press flex items-stretch overflow-hidden">
        <VisitorStat label="Inside now" value={insideCount} tone="var(--gate-inside)" />
        <VisitorStat label="Overdue >12h" value={s.overdue_visitors} tone={(s.overdue_visitors ?? 0) > 0 ? "var(--gate-alert)" : "var(--content-4)"} pulse={(s.overdue_visitors ?? 0) > 0} />
        <span className="flex w-12 items-center justify-center text-content-4">
          <ChevronRight className="h-5 w-5" />
        </span>
      </Link>

      <section>
        <SectionHeading
          eyebrow="Visitors · check out when they leave"
          title="Inside longest"
          action={
            insideCount > 3 ? (
              <Link href="/gate/visitors" className="flex min-h-[44px] items-center text-[14px] font-semibold" style={{ color: "var(--gate-in)" }}>
                All {insideCount}
              </Link>
            ) : null
          }
        />
        {inside.isError ? (
          <div className="gate-card p-4 text-[14px] text-content-3">Could not load visitors inside. It refreshes automatically.</div>
        ) : insideRows.length ? (
          <div className="space-y-3">
            {insideRows.slice(0, 3).map((visitor) => (
              <VisitorPass key={visitor.id} visitor={visitor} now={now} />
            ))}
          </div>
        ) : (
          <div className="gate-card">
            <EmptyState
              icon={<Users className="h-6 w-6" />}
              title={inside.isLoading ? "Loading…" : "No visitors inside"}
              body="Visitors record their own entry by scanning the gate QR. They appear here until you check them out."
            />
          </div>
        )}
      </section>

      <div className="grid grid-cols-2 gap-3">
        <QuickLink href="/gate/visitors" icon={<DoorOpen className="h-5 w-5" />} label="Visitors inside" />
        <QuickLink href="/gate/register" icon={<ClipboardList className="h-5 w-5" />} label="Today's register" />
      </div>

      {isOwner ? <OwnerTools /> : null}
    </div>
  );
}

function LaneTile({ direction, count, loading }: { direction: GateDirection; count?: number; loading?: boolean }) {
  const meta = DIRECTION_META[direction];
  return (
    <Link
      href={`/gate/goods?direction=${direction}`}
      className="gate-press relative flex min-h-[148px] flex-col justify-between overflow-hidden rounded-[22px] p-4 text-white"
      style={{ background: meta.tone }}
      aria-label={`New ${meta.label.toLowerCase()} goods entry`}
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/15">
        <DirectionGlyph direction={direction} className="h-6 w-6 !text-white" />
      </span>
      <span>
        <span className="block text-[22px] font-semibold leading-tight tracking-[-0.02em]">{meta.label}</span>
        <span className="block text-[13px] text-white/80">
          {loading ? "…" : `${count ?? 0} today`} · tap to log
        </span>
      </span>
      <span aria-hidden className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/10" />
    </Link>
  );
}

function VisitorStat({ label, value, tone, pulse }: { label: string; value?: number; tone: string; pulse?: boolean }) {
  return (
    <span className="flex flex-1 flex-col justify-center border-r border-line px-4 py-3 last-of-type:border-r-0">
      <span className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-content-4">
        <span className={pulse ? "gate-pulse h-2 w-2 rounded-full" : "h-2 w-2 rounded-full"} style={{ background: tone }} />
        {label}
      </span>
      <span className="gate-num mt-0.5 text-[26px] font-semibold leading-none" style={{ color: tone === "var(--content-4)" ? "var(--content-2)" : tone }}>
        {value ?? 0}
      </span>
    </span>
  );
}

function QuickLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link href={href} className="gate-card gate-press flex min-h-[64px] items-center gap-3 px-4 text-[15px] font-semibold text-content-1">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-2 text-content-2">{icon}</span>
      {label}
    </Link>
  );
}

function OwnerTools() {
  return (
    <section>
      <SectionHeading eyebrow="Admin · Owner" title="Gate oversight" />
      <div className="grid grid-cols-2 gap-3">
        <QuickLink href="/gate/setup" icon={<Settings className="h-5 w-5" />} label="Gate setup" />
        <QuickLink href="/gate/history" icon={<History className="h-5 w-5" />} label="Gate history" />
        <QuickLink href="/gate/qr" icon={<QrCode className="h-5 w-5" />} label="Visitor QR" />
        <QuickLink href="/analytics/reports/gate" icon={<BarChart3 className="h-5 w-5" />} label="Gate report" />
      </div>
    </section>
  );
}

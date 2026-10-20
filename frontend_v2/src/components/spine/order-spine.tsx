"use client";

/**
 * The order spine: the same seven-station strip on the order page, planner, WC terminal,
 * machine screen and packing yard. Tap a station to open that page for this order.
 * Pure read: it only shows figures the backend already has.
 */
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Check, CircleDot, Minus, OctagonAlert } from "lucide-react";

import { useCanFollowLink } from "@/components/layout/use-nav-access";
import { cn } from "@/lib/utils";
import { spineService, type OrderSpine as OrderSpinePayload, type SpineStation } from "@/services/spine";

export const ORDER_SPINE_STALE_MS = 30_000;

export function useOrderSpine(args: { orderId?: string | null; jobId?: string | null; enabled?: boolean }) {
  const orderId = args.orderId ? String(args.orderId) : "";
  const jobId = args.jobId ? String(args.jobId) : "";
  return useQuery<OrderSpinePayload>({
    queryKey: ["order-spine", orderId || null, jobId || null],
    queryFn: ({ signal }) => (orderId ? spineService.forOrder(orderId, signal) : spineService.forJob(jobId, signal)),
    enabled: (args.enabled ?? true) && Boolean(orderId || jobId),
    staleTime: ORDER_SPINE_STALE_MS,
    refetchOnWindowFocus: false,
  });
}

const STATE_CLASS: Record<SpineStation["state"], string> = {
  done: "text-success-fg",
  active: "bg-primary text-primary-foreground",
  pending: "text-content-3",
  skipped: "text-content-4",
  blocked: "bg-danger-bg text-danger-fg",
};

const DARK_STATE_CLASS: Record<SpineStation["state"], string> = {
  done: "text-success-border",
  active: "bg-white text-content-1",
  pending: "text-white/70",
  skipped: "text-white/45",
  blocked: "bg-danger-bg text-danger-fg",
};

function StateIcon({ state }: { state: SpineStation["state"] }) {
  const cls = "h-3 w-3 flex-none";
  if (state === "done") return <Check className={cls} aria-hidden />;
  if (state === "active") return <CircleDot className={cls} aria-hidden />;
  if (state === "blocked") return <OctagonAlert className={cls} aria-hidden />;
  return <Minus className={cn(cls, "opacity-60")} aria-hidden />;
}

export function OrderSpineStrip({
  stations,
  dark = false,
  compact = false,
  current,
  className,
  testId = "order-spine",
}: {
  stations: SpineStation[];
  dark?: boolean;
  compact?: boolean;
  /** Station key of the page this strip is on; it is drawn as the active station. */
  current?: SpineStation["key"];
  className?: string;
  testId?: string;
}) {
  const canFollow = useCanFollowLink();
  if (!stations.length) return null;
  return (
    <nav
      aria-label="Order spine"
      data-testid={testId}
      className={cn(
        "flex max-w-full flex-wrap items-stretch overflow-hidden rounded-2xl border leading-tight",
        compact ? "text-[12px]" : "text-[13px]",
        dark ? "border-white/20 bg-white/10" : "border-line bg-surface-1 shadow-sm",
        className,
      )}
    >
      {stations.map((station, index) => {
        const state: SpineStation["state"] = current && station.key === current && station.state !== "blocked" ? "active" : station.state;
        // A station whose page is not part of this role stays as plain text.
        const href = station.href && canFollow(station.href) ? station.href : "";
        const palette = dark ? DARK_STATE_CLASS : STATE_CLASS;
        const body = (
          <>
            <StateIcon state={state} />
            <span className="font-semibold">{station.label}</span>
            {!compact && station.value && station.value !== "—" ? (
              <span className="max-w-[11rem] truncate font-mono-token tabular-nums">{station.value}</span>
            ) : null}
          </>
        );
        const cls = cn(
          "flex min-w-0 items-center gap-1.5 whitespace-nowrap transition-colors",
          compact ? "px-3 py-1.5" : "px-4 py-2.5",
          index < stations.length - 1 && (dark ? "border-r border-white/15" : "border-r border-line"),
          palette[state],
          href && (dark ? "hover:bg-white/15" : "hover:bg-surface-2"),
        );
        return href ? (
          <Link
            key={station.key}
            href={href}
            title={station.detail || station.label}
            aria-current={state === "active" ? "step" : undefined}
            data-testid={`${testId}-${station.key}`}
            className={cls}
          >
            {body}
          </Link>
        ) : (
          <span key={station.key} title={station.detail || station.label} data-testid={`${testId}-${station.key}`} className={cls}>
            {body}
          </span>
        );
      })}
    </nav>
  );
}

/** Loads and shows the spine for an order (or the order behind a job). Renders nothing for stock jobs. */
export function OrderSpine({
  orderId,
  jobId,
  current,
  dark = false,
  compact = false,
  className,
  testId,
}: {
  orderId?: string | null;
  jobId?: string | null;
  current?: SpineStation["key"];
  dark?: boolean;
  compact?: boolean;
  className?: string;
  testId?: string;
}) {
  const query = useOrderSpine({ orderId, jobId });
  if (!orderId && !jobId) return null;
  if (query.isLoading) {
    return (
      <div
        aria-hidden
        className={cn("h-8 w-full max-w-[720px] animate-pulse rounded-full", dark ? "bg-white/10" : "bg-surface-2", className)}
      />
    );
  }
  const stations = query.data?.stations || [];
  if (!stations.length) return null;
  return <OrderSpineStrip stations={stations} current={current} dark={dark} compact={compact} className={className} testId={testId} />;
}

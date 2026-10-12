"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type ChipTone = "neutral" | "good" | "warn" | "bad" | "info" | "order";

const toneClass: Record<ChipTone, string> = {
  neutral: "border-line bg-surface-2 text-content-2",
  good: "border-success-border bg-success-bg text-success-fg",
  warn: "border-warning-border bg-warning-bg text-warning-fg",
  bad: "border-danger-border bg-danger-bg text-danger-fg",
  info: "border-info-border bg-info-bg text-info-fg",
  order: "border-order-border bg-order-bg text-order-fg",
};

const dotClass: Record<ChipTone, string> = {
  neutral: "bg-content-4",
  good: "bg-success-fg",
  warn: "bg-warning-fg",
  bad: "bg-danger-fg",
  info: "bg-info-fg",
  order: "bg-order-fg",
};

/** Maps the status vocabulary used across orders, jobs, rolls, GRNs and bills to a tone. */
export function statusTone(status: string | null | undefined): ChipTone {
  const value = String(status || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (!value) return "neutral";
  if (/(^|_)(DONE|COMPLETED?|POSTED|APPROVED|ACCEPTED|DELIVERED|DISPATCHED|CLOSED|RETURNED|AVAILABLE|READY|ACTIVE|LIVE|FILED|RESOLVED|PASS(ED)?|OK|SUCCEEDED|CONVERTED|RELEASED)($|_)/.test(value)) return "good";
  if (/(^|_)(PENDING|WAITING|AWAITING|HOLD|ON_HOLD|PLANNING|PARTIAL(LY)?|PARTLY_RETURNED|DRAFT|QUEUED|QUARANTINED?|STALLED|DUE|EXPIRING|REVIEW|NEEDS_[A-Z_]+|OPEN)($|_)/.test(value)) return "warn";
  if (/(^|_)(FAILED|ERROR|REJECTED|CANCELLED|CANCELED|VOID|OVERDUE|BLOCKED|MISSING|SCRAPPED|CRITICAL|EXPIRED|NEGATIVE|DENIED|LOCKED)($|_)/.test(value)) return "bad";
  if (/(^|_)(RUNNING|IN_PROGRESS|IN_TRANSIT|SENT|SENT_JOBWORK|ISSUED|RESERVED|WIP|PROCESSING|SYNCED|INFO)($|_)/.test(value)) return "info";
  return "neutral";
}

export interface StatusChipProps {
  /** Raw status code; the tone is derived from it unless `tone` is given. */
  status?: string | null;
  tone?: ChipTone;
  children?: ReactNode;
  /** Show a leading dot in the tone colour. */
  dot?: boolean;
  size?: "sm" | "md";
  className?: string;
  title?: string;
  testId?: string;
}

function humanize(status: string): string {
  return status
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
}

/**
 * One status pill for the whole product: 12px minimum, 700-step text on a
 * 50-step background (every pair passes WCAG AA), and a tone derived from the
 * status vocabulary so the same state always looks the same.
 */
export function StatusChip({ status, tone, children, dot = true, size = "sm", className, title, testId }: StatusChipProps) {
  const resolvedTone = tone || statusTone(status);
  const label = children ?? (status ? humanize(String(status)) : "");
  return (
    <span
      data-testid={testId}
      data-status={status || undefined}
      title={title}
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full border font-semibold leading-none",
        size === "sm" ? "px-2 py-1 text-caption" : "px-2.5 py-1.5 text-label",
        toneClass[resolvedTone],
        className,
      )}
    >
      {dot ? <span aria-hidden className={cn("h-1.5 w-1.5 shrink-0 rounded-full", dotClass[resolvedTone])} /> : null}
      <span className="truncate">{label}</span>
    </span>
  );
}

export default StatusChip;

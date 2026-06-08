import { formatDisplayDate } from "./date-format";
/**
 * Order age utilities — the company prefers "days since order placed" over due date.
 * These helpers normalize the various created_at fields and produce consistent
 * "Placed Xd ago" labels with appropriate tone for urgency.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export type OrderAgeTone = "fresh" | "normal" | "warn" | "stale" | "ancient";

export interface OrderAgeResult {
  /** "Today" / "Yesterday" / "3d ago" / "2w ago" / "—" if no date */
  label: string;
  /** Short label for tight spaces — "0d" / "3d" / "14d" / "—" */
  shortLabel: string;
  /** Integer days; null if unknown */
  days: number | null;
  /** ISO date string echoed back (formatted dd MMM yyyy) — for tooltips */
  placedOn: string | null;
  /** Severity tone based on age — drive color */
  tone: OrderAgeTone;
}

/**
 * Normalize candidate keys an order row might use for "when placed".
 * Falls back through common variants seen in the codebase.
 */
export function pickOrderPlacedDate(
  order: Record<string, any> | null | undefined,
): string | null {
  if (!order) return null;
  return (
    order.order_created_at ||
    order.created_at ||
    order.placed_at ||
    order.order_date ||
    order.date_created ||
    null
  );
}

/**
 * Compute days-since-order placement and pretty-printed label.
 *
 * @example
 * const age = orderAge(order)
 * // age.label === "Placed 3d ago"
 * // age.shortLabel === "3d"
 * // age.tone === "normal"
 */
export function orderAge(
  input: Record<string, any> | string | Date | null | undefined,
): OrderAgeResult {
  const dateStr =
    input == null
      ? null
      : typeof input === "string" || input instanceof Date
        ? input
        : pickOrderPlacedDate(input);

  if (!dateStr) {
    return {
      label: "—",
      shortLabel: "—",
      days: null,
      placedOn: null,
      tone: "normal",
    };
  }

  const d = dateStr instanceof Date ? dateStr : new Date(dateStr);
  if (isNaN(d.getTime())) {
    return {
      label: "—",
      shortLabel: "—",
      days: null,
      placedOn: null,
      tone: "normal",
    };
  }

  const today = new Date();
  const startOfToday = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  ).getTime();
  const startOfThen = new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
  ).getTime();
  const days = Math.max(0, Math.floor((startOfToday - startOfThen) / DAY_MS));

  let label: string;
  let shortLabel: string;
  if (days === 0) {
    label = "Placed today";
    shortLabel = "Today";
  } else if (days === 1) {
    label = "Placed yesterday";
    shortLabel = "1d";
  } else if (days < 14) {
    label = `Placed ${days}d ago`;
    shortLabel = `${days}d`;
  } else if (days < 60) {
    const weeks = Math.floor(days / 7);
    label = `Placed ${weeks}w ago`;
    shortLabel = `${weeks}w`;
  } else {
    const months = Math.floor(days / 30);
    label = `Placed ${months}mo ago`;
    shortLabel = `${months}mo`;
  }

  let tone: OrderAgeTone = "normal";
  if (days <= 1) tone = "fresh";
  else if (days <= 7) tone = "normal";
  else if (days <= 14) tone = "warn";
  else if (days <= 30) tone = "stale";
  else tone = "ancient";

  return {
    label,
    shortLabel,
    days,
    placedOn: formatDisplayDate(d),
    tone,
  };
}

/**
 * Tailwind classes for chip rendering of an OrderAgeTone.
 * Pair with the standard rounded-full pill shape.
 */
export const ORDER_AGE_TONE_CLASSES: Record<OrderAgeTone, string> = {
  fresh: "bg-success-bg text-success-fg ring-success-border",
  normal: "bg-info-bg text-primary ring-info-border",
  warn: "bg-warning-bg text-warning-fg ring-warning-border",
  stale: "bg-warm text-warm ring-warning-border",
  ancient: "bg-danger-bg text-danger-fg ring-danger-border",
};

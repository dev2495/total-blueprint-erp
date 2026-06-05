"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import type { ChipKind } from "./chip";

export interface KpiTileProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  trend?: { delta: string; direction: "up" | "down" | "flat" };
  tone?: ChipKind;
  loading?: boolean;
  compact?: boolean;
}

const toneRing: Record<ChipKind, string> = {
  info: "ring-info-border",
  success: "ring-success-border",
  warn: "ring-warning-border",
  danger: "ring-danger-border",
  neutral: "ring-line",
  accent: "ring-order-border",
  process: "ring-info-border",
  thick: "ring-order-border",
  "fg-roll": "ring-danger-border",
  "fg-pouch": "ring-warning-border",
};

const trendColor: Record<
  NonNullable<KpiTileProps["trend"]>["direction"],
  string
> = {
  up: "text-success-fg",
  down: "text-danger-fg",
  flat: "text-content-3",
};

export const KpiTile = React.forwardRef<HTMLDivElement, KpiTileProps>(
  (
    {
      className,
      label,
      value,
      hint,
      trend,
      tone = "neutral",
      loading,
      compact,
      ...props
    },
    ref,
  ) => (
    <div
      ref={ref}
      className={cn(
        "relative flex min-w-[140px] flex-col rounded-xl bg-surface-1/80 ring-1 backdrop-blur-sm",
        "shadow-[0_1px_0_rgba(15,23,42,0.04)]",
        toneRing[tone],
        compact ? "px-3 py-2 gap-0.5" : "px-4 py-3 gap-1",
        className,
      )}
      {...props}
    >
      <div className="text-[10px] font-semibold uppercase tracking-wide text-content-3">
        {label}
      </div>
      <div
        className={cn(
          "font-display tabular-nums leading-none text-content-1",
          compact ? "text-xl" : "text-2xl",
        )}
      >
        {loading ? (
          <span className="inline-block h-5 w-12 animate-pulse rounded bg-line" />
        ) : (
          value
        )}
      </div>
      {(hint || trend) && (
        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-content-3">
          {trend && (
            <span className={cn("font-semibold", trendColor[trend.direction])}>
              {trend.direction === "up"
                ? "▲"
                : trend.direction === "down"
                  ? "▼"
                  : "•"}{" "}
              {trend.delta}
            </span>
          )}
          {hint && <span className="truncate">{hint}</span>}
        </div>
      )}
    </div>
  ),
);
KpiTile.displayName = "KpiTile";

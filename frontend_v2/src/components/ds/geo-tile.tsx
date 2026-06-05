"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Chip, type ChipKind } from "./chip";

export interface GeoTileProps extends React.HTMLAttributes<HTMLDivElement> {
  label: React.ReactNode;
  value: React.ReactNode;
  unit?: React.ReactNode;
  hint?: React.ReactNode;
  tone?: ChipKind;
  highlight?: boolean;
  chip?: { label: React.ReactNode; kind?: ChipKind };
  tooltip?: string;
}

const toneSurface: Record<ChipKind, string> = {
  info: "border-info-border bg-info-bg",
  success: "border-success-border bg-success-bg",
  warn: "border-warning-border bg-warning-bg",
  danger: "border-danger-border bg-danger-bg",
  neutral: "border-line bg-surface-1",
  accent: "border-order-border bg-order-bg",
  process: "border-info-border bg-info-bg",
  thick: "border-order-border bg-order-bg",
  "fg-roll": "border-danger-border bg-danger-bg",
  "fg-pouch": "border-warning-border bg-warning-bg",
};

export const GeoTile = React.forwardRef<HTMLDivElement, GeoTileProps>(
  (
    {
      className,
      label,
      value,
      unit,
      hint,
      tone = "neutral",
      highlight,
      chip,
      tooltip,
      ...props
    },
    ref,
  ) => (
    <div
      ref={ref}
      title={tooltip}
      className={cn(
        "flex min-h-[78px] flex-col justify-between gap-1 rounded-lg border px-3 py-2",
        toneSurface[tone],
        highlight && "ring-2 ring-info-border",
        className,
      )}
      {...props}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-content-3">
          {label}
        </span>
        {chip && (
          <Chip kind={chip.kind ?? tone} size="sm">
            {chip.label}
          </Chip>
        )}
      </div>
      <div className="flex items-baseline gap-1">
        <span className="font-mono-token text-lg font-semibold tabular-nums text-content-1">
          {value}
        </span>
        {unit && (
          <span className="text-[11px] font-medium text-content-3">{unit}</span>
        )}
      </div>
      {hint && <div className="text-[10px] text-content-3">{hint}</div>}
    </div>
  ),
);
GeoTile.displayName = "GeoTile";

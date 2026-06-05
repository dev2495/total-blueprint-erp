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
  info: "border-sky-100 bg-sky-50/40",
  success: "border-emerald-100 bg-emerald-50/40",
  warn: "border-amber-100 bg-amber-50/40",
  danger: "border-rose-100 bg-rose-50/40",
  neutral: "border-slate-200 bg-surface-1",
  accent: "border-violet-100 bg-violet-50/40",
  process: "border-blue-100 bg-blue-50/40",
  thick: "border-indigo-100 bg-indigo-50/40",
  "fg-roll": "border-rose-100 bg-rose-50/40",
  "fg-pouch": "border-amber-100 bg-amber-50/40",
};

export const GeoTile = React.forwardRef<HTMLDivElement, GeoTileProps>(
  (
    { className, label, value, unit, hint, tone = "neutral", highlight, chip, tooltip, ...props },
    ref,
  ) => (
    <div
      ref={ref}
      title={tooltip}
      className={cn(
        "flex min-h-[78px] flex-col justify-between gap-1 rounded-lg border px-3 py-2",
        toneSurface[tone],
        highlight && "ring-2 ring-blue-200",
        className,
      )}
      {...props}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
          {label}
        </span>
        {chip && (
          <Chip kind={chip.kind ?? tone} size="sm">
            {chip.label}
          </Chip>
        )}
      </div>
      <div className="flex items-baseline gap-1">
        <span className="font-mono-token text-lg font-semibold tabular-nums text-slate-900">
          {value}
        </span>
        {unit && <span className="text-[11px] font-medium text-slate-500">{unit}</span>}
      </div>
      {hint && <div className="text-[10px] text-slate-500">{hint}</div>}
    </div>
  ),
);
GeoTile.displayName = "GeoTile";

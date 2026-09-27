"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { vizColor } from "./viz";

/** Ranked horizontal bars in plain HTML: best for long category names. */
export function RankedBars({
  items,
  valueFormat = (v) => v.toLocaleString("en-IN", { maximumFractionDigits: 1 }),
  max,
  className,
  limit = 8,
  colorByIndex,
}: {
  items: { key?: string; label: React.ReactNode; value: number; sub?: React.ReactNode; color?: string }[];
  valueFormat?: (value: number) => string;
  max?: number;
  className?: string;
  limit?: number;
  colorByIndex?: boolean;
}) {
  const shown = items.slice(0, limit);
  const top = max ?? Math.max(1, ...shown.map((i) => i.value));
  return (
    <ul className={cn("space-y-3", className)}>
      {shown.map((item, index) => (
        <li key={item.key ?? index} className="min-w-0">
          <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
            <span className="min-w-0 truncate text-content-2">{item.label}</span>
            <span className="shrink-0 font-medium text-content-1 tabular-nums">{valueFormat(item.value)}</span>
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full transition-[width] duration-700 ease-out"
              style={{
                width: `${Math.max(item.value > 0 ? 2 : 0, (item.value / top) * 100)}%`,
                background: item.color ?? (colorByIndex ? vizColor(index) : "var(--viz-1)"),
              }}
            />
          </div>
          {item.sub ? <div className="mt-1 text-[11.5px] text-content-3">{item.sub}</div> : null}
        </li>
      ))}
    </ul>
  );
}

/** A single stacked bar showing composition, with legend underneath. */
export function CompositionBar({
  parts,
  valueFormat = (v) => v.toLocaleString("en-IN", { maximumFractionDigits: 1 }),
  className,
}: {
  parts: { label: string; value: number; color?: string }[];
  valueFormat?: (value: number) => string;
  className?: string;
}) {
  const total = parts.reduce((sum, p) => sum + Math.max(0, p.value), 0);
  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex h-2.5 w-full gap-[2px] overflow-hidden rounded-full bg-surface-2">
        {total > 0
          ? parts.map((p, i) =>
              p.value > 0 ? (
                <div
                  key={p.label}
                  title={`${p.label}: ${valueFormat(p.value)}`}
                  className="h-full transition-[width] duration-700 ease-out first:rounded-l-full last:rounded-r-full"
                  style={{ width: `${(p.value / total) * 100}%`, background: p.color ?? vizColor(i) }}
                />
              ) : null,
            )
          : null}
      </div>
      <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
        {parts.map((p, i) => (
          <div key={p.label} className="flex min-w-0 items-center justify-between gap-2 text-[12px]">
            <span className="flex min-w-0 items-center gap-1.5 text-content-3">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: p.color ?? vizColor(i) }} aria-hidden />
              <span className="truncate">{p.label}</span>
            </span>
            <span className="shrink-0 font-medium text-content-1 tabular-nums">{valueFormat(p.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

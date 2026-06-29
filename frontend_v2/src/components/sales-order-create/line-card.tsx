"use client";

/**
 * V3.4 Sales Order — collapsed line card.
 *
 * Shown when the line is NOT expanded. Compact summary + actions (expand,
 * duplicate, remove). Click anywhere on the body to expand.
 */

import * as React from "react";
import {
  ChevronDown,
  Copy,
  Pencil,
  Trash2,
  Sparkles,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { SalesOrderLine } from "./types";

export interface LineCardProps {
  index: number;
  line: SalesOrderLine;
  masterCode?: string;
  masterName?: string;
  onExpand: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
  issues?: string[];
}

export function LineCard({
  index,
  line,
  masterCode,
  masterName,
  onExpand,
  onDuplicate,
  onRemove,
  issues = [],
}: LineCardProps) {
  const hasIssue = issues.length > 0;
  const lineTotal = line.qty_value * (parseFloat(line.unit_price || "0") || 0);

  const summaryChips: Array<{ label: string; tone: ChipTone }> = [];
  if (line.size_code)
    summaryChips.push({ label: line.size_code, tone: "emerald" });
  if (line.customer_product_overlay)
    summaryChips.push({ label: "Customer default", tone: "blue" });
  if (line.addons.length)
    summaryChips.push({ label: line.addons.join("·"), tone: "amber" });
  if (line.axis_values.pod_variant)
    summaryChips.push({
      label: `POD ${shortCode(line.axis_values.pod_variant)}`,
      tone: "violet",
    });
  if (line.axis_values.packaging_inner)
    summaryChips.push({
      label: shortCode(line.axis_values.packaging_inner),
      tone: "sky",
    });
  if (line.axis_values.packaging_outer)
    summaryChips.push({
      label: shortCode(line.axis_values.packaging_outer),
      tone: "orange",
    });
  if (line.artwork_mode === "DEFER")
    summaryChips.push({ label: "Artwork: defer", tone: "slate" });
  else if (line.artwork_assignment?.colorway_name)
    summaryChips.push({
      label: line.artwork_assignment.colorway_name,
      tone: "fuchsia",
    });

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-2xl border bg-surface-1 shadow-sm ring-1 ring-line transition-all hover:shadow-md hover:ring-info-border",
        hasIssue ? "border-danger-border ring-danger-border" : "border-line",
      )}
    >
      {/* Top row: index badge + master + actions */}
      <button
        type="button"
        onClick={onExpand}
        className="flex w-full items-start gap-3 px-4 py-3.5 text-left"
        aria-label={`Expand line ${index + 1}`}
      >
        <span
          className={cn(
            "flex h-8 w-8 flex-none items-center justify-center rounded-xl text-xs font-black shadow-sm ring-1",
            hasIssue
              ? "bg-danger-solid text-white ring-danger-border"
              : "bg-gradient-to-br from-primary to-order-fg text-white ring-primary",
          )}
        >
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          {line.line_label ? (
            <div className="truncate font-display text-sm font-black text-content-1">
              {line.line_label}
            </div>
          ) : null}
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="font-mono text-xs font-bold text-primary">
              {masterCode || "—"}
            </span>
            {masterName && (
              <span className="truncate text-[11px] text-content-3">
                {masterName}
              </span>
            )}
          </div>
          {summaryChips.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {summaryChips.map((c, i) => (
                <Chip key={i} tone={c.tone}>
                  {c.label}
                </Chip>
              ))}
            </div>
          )}
          {hasIssue && (
            <div className="mt-1.5 flex items-center gap-1 text-[11px] font-bold text-danger-fg">
              <AlertCircle className="h-3 w-3" />
              {issues[0]}
            </div>
          )}
        </div>
        {/* qty + price */}
        <div className="flex flex-none flex-col items-end gap-0.5 text-right">
          <div className="font-display text-base font-bold text-content-1">
            {formatNumber(line.qty_value)}
            <span className="ml-0.5 text-[10px] font-bold uppercase tracking-wider text-content-4">
              {line.qty_uom}
            </span>
          </div>
          {lineTotal > 0 && (
            <div className="text-[11px] font-semibold text-content-3">
              ₹{formatNumber(lineTotal, 0)}
            </div>
          )}
        </div>
        <ChevronDown className="mt-1 h-4 w-4 flex-none text-content-4 transition group-hover:text-primary" />
      </button>
      {/* Action row */}
      <div className="flex items-center justify-between border-t border-line bg-surface-2 px-3 py-1.5">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onExpand();
            }}
            className="h-7 gap-1 rounded-lg text-[11px] font-bold text-primary hover:bg-info-bg"
          >
            <Pencil className="h-3 w-3" /> Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onDuplicate();
            }}
            className="h-7 gap-1 rounded-lg text-[11px] font-bold text-content-2 hover:bg-surface-2"
          >
            <Copy className="h-3 w-3" /> Duplicate
          </Button>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="h-7 gap-1 rounded-lg text-[11px] font-bold text-danger-fg hover:bg-danger-bg"
        >
          <Trash2 className="h-3 w-3" /> Remove
        </Button>
      </div>
    </div>
  );
}

type ChipTone =
  | "blue"
  | "emerald"
  | "violet"
  | "amber"
  | "sky"
  | "orange"
  | "fuchsia"
  | "slate";

function Chip({
  tone,
  children,
}: {
  tone: ChipTone;
  children: React.ReactNode;
}) {
  const map: Record<ChipTone, string> = {
    blue: "bg-info-bg text-primary ring-info-border",
    emerald: "bg-success-bg text-success-fg ring-success-border",
    violet: "bg-order-bg text-order-fg ring-order-border",
    amber: "bg-warning-bg text-warning-fg ring-warning-border",
    sky: "bg-info-bg text-info-fg ring-info-border",
    orange: "bg-warm text-warm ring-warning-border",
    fuchsia: "bg-order-bg text-order-fg ring-order-border",
    slate: "bg-surface-2 text-content-3 ring-line",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ring-inset shadow-sm",
        map[tone],
      )}
    >
      {children}
    </span>
  );
}

function shortCode(s: string): string {
  if (s.length <= 16) return s;
  return s.slice(0, 14) + "…";
}

function formatNumber(n: number, max: number = 2): string {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: max,
  }).format(n);
}

"use client";

import * as React from "react";
import {
  CircleCheck,
  CircleSlash,
  Clock3,
  PackageX,
  TriangleAlert,
} from "lucide-react";

import { cn } from "@/lib/utils";

export interface InkColorSwatchesProps {
  colors?: string[] | null;
  /** Maximum color names to render before collapsing into a "+N" pill. */
  max?: number;
  className?: string;
}

/**
 * Text-only artwork color names for printing steps.
 *
 * Deliberately avoids swatches here: these colors come from the artwork
 * contract, not from ink-master stock, so a fake visual swatch is misleading.
 */
export function InkColorSwatches({
  colors,
  max = 4,
  className,
}: InkColorSwatchesProps) {
  const list = Array.isArray(colors)
    ? colors.filter((c) => String(c || "").trim())
    : [];
  if (!list.length) return null;
  const shown = list.slice(0, max);
  const overflow = list.length - shown.length;

  return (
    <div
      className={cn("flex items-center gap-1.5", className)}
      aria-label={`Ink colors: ${list.join(", ")}`}
    >
      <span className="text-[10px] font-bold uppercase tracking-wider text-content-4">
        Colors
      </span>
      <div className="flex max-w-[340px] flex-wrap items-center gap-1">
        {shown.map((color, idx) => (
          <span
            key={`${color}-${idx}`}
            title={color}
            className="max-w-[120px] truncate rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-content-2"
          >
            {color}
          </span>
        ))}
      </div>
      {overflow > 0 ? (
        <span className="rounded-full border border-line bg-surface-2 px-2 py-0.5 font-mono text-[10px] font-bold text-content-3">
          +{overflow}
        </span>
      ) : null}
    </div>
  );
}

export interface CylinderReadyChipProps {
  status?: "READY" | "MISSING" | "NOT_REQUIRED" | "NA" | null;
  ready?: boolean | null;
  className?: string;
}

/**
 * Cylinder readiness pill. Emerald when ready, rose when a required cylinder
 * is missing, neutral when FLEXO/non-ROTO artwork does not need cylinders, and
 * hidden when the step is not print-capable (NA).
 */
export function CylinderReadyChip({
  status,
  ready,
  className,
}: CylinderReadyChipProps) {
  const resolved =
    status ?? (ready === true ? "READY" : ready === false ? "MISSING" : "NA");
  if (resolved === "NA") return null;
  const isReady = resolved === "READY";
  const isNotRequired = resolved === "NOT_REQUIRED";
  return (
    <span
      data-testid="wcm-cylinder-chip"
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ring-1",
        isReady || isNotRequired
          ? "bg-success-bg text-success-fg ring-success-border"
          : "bg-danger-bg text-danger-fg ring-danger-border",
        className,
      )}
    >
      {isReady || isNotRequired ? (
        <CircleCheck className="size-3.5" />
      ) : (
        <CircleSlash className="size-3.5" />
      )}
      {isNotRequired
        ? "No cylinder needed"
        : isReady
          ? "Cylinder ready"
          : "Cylinder missing"}
    </span>
  );
}

export interface MaterialBlockChipProps {
  blocked?: boolean | null;
  reason?: string | null;
  className?: string;
}

/**
 * Inline "Material short" chip for blocked queue cards so the lead sees it
 * without opening the job. Renders nothing when not blocked.
 */
export function MaterialBlockChip({
  blocked,
  reason,
  className,
}: MaterialBlockChipProps) {
  if (!blocked) return null;
  const text = String(reason || "").trim();
  return (
    <span
      data-testid="wcm-material-block-chip"
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-danger-bg px-2.5 py-1 text-xs font-bold text-danger-fg ring-1 ring-danger-border",
        className,
      )}
      title={text || "Material short"}
    >
      <PackageX className="size-3.5 shrink-0" />
      {text ? `Material short — ${text}` : "Material short"}
    </span>
  );
}

export interface ElapsedStalledBadgeProps {
  /** Minutes since the job was assigned/started. */
  elapsedMinutes?: number | null;
  /** True when EXECUTING but no logs in the stall window. */
  isStalled?: boolean | null;
  className?: string;
}

function formatElapsed(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

/**
 * Elapsed-time pill for running cards, plus a prominent rose "Stalled" badge
 * when the job is EXECUTING with no recent log activity.
 */
export function ElapsedStalledBadge({
  elapsedMinutes,
  isStalled,
  className,
}: ElapsedStalledBadgeProps) {
  const hasElapsed =
    typeof elapsedMinutes === "number" && Number.isFinite(elapsedMinutes);
  if (!hasElapsed && !isStalled) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {hasElapsed ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-1 text-xs font-bold text-content-3 ring-1 ring-line">
          <Clock3 className="size-3.5" />
          <span className="font-mono tabular-nums">
            {formatElapsed(elapsedMinutes as number)}
          </span>
          <span className="font-medium text-content-4">elapsed</span>
        </span>
      ) : null}
      {isStalled ? (
        <span
          data-testid="wcm-stalled-badge"
          className="inline-flex items-center gap-1 rounded-full bg-danger-bg px-2.5 py-1 text-xs font-bold text-danger-fg ring-1 ring-danger-border animate-pulse"
        >
          <TriangleAlert className="size-3.5" />
          {hasElapsed
            ? `Stalled — no log ${formatElapsed(elapsedMinutes as number)}`
            : "Stalled — no log"}
        </span>
      ) : null}
    </div>
  );
}

export type MachineLiveState = "IDLE" | "RUNNING" | "DOWN";

export interface MachineStateBadgeProps {
  state?: MachineLiveState | null;
  currentJobNumber?: string | null;
  className?: string;
}

/**
 * Right-aligned state badge for the assign-machine <Select> options.
 * Idle = emerald, Running = sky (with job number), Down = rose.
 */
export function MachineStateBadge({
  state,
  currentJobNumber,
  className,
}: MachineStateBadgeProps) {
  const resolved: MachineLiveState = state ?? "IDLE";
  if (resolved === "RUNNING") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full bg-info-bg px-2 py-0.5 text-[11px] font-bold text-info-fg ring-1 ring-info-border",
          className,
        )}
      >
        <span className="size-1.5 rounded-full bg-info-fg" />
        Running{currentJobNumber ? ` ${currentJobNumber}` : ""}
      </span>
    );
  }
  if (resolved === "DOWN") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full bg-danger-bg px-2 py-0.5 text-[11px] font-bold text-danger-fg ring-1 ring-danger-border",
          className,
        )}
      >
        <span className="size-1.5 rounded-full bg-danger-solid" />
        Down
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-success-bg px-2 py-0.5 text-[11px] font-bold text-success-fg ring-1 ring-success-border",
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-success-fg" />
      Idle
    </span>
  );
}

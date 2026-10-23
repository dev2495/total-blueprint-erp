"use client";

import * as React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Clock,
  Pause,
  Play,
  Repeat,
  Send,
  XCircle,
} from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Status vocabulary for the planner screens. Tier 1: one state badge per row
 * (icon + word, never colour alone). Tier 2: outline tags for type and source.
 * The route rail and the small charts in the KPI tiles use the same tones.
 */

export type Tone = "done" | "run" | "queued" | "wait" | "block" | "neutral" | "replan" | "paused" | "alert";

const TONE_CLASS: Record<Tone, string> = {
  done: "bg-success-bg text-success-fg ring-success-border",
  run: "bg-order-bg text-order-fg ring-order-border",
  queued: "bg-info-bg text-info-fg ring-info-border",
  wait: "bg-warning-bg text-warning-fg ring-warning-border",
  replan: "bg-warning-bg text-warning-fg ring-warning-border",
  paused: "bg-warning-bg text-warning-fg ring-warning-border",
  block: "bg-danger-bg text-danger-fg ring-danger-border",
  alert: "bg-danger-bg text-danger-fg ring-danger-border",
  neutral: "bg-surface-2 text-content-2 ring-line",
};

const TONE_ICON: Record<Tone, React.ElementType> = {
  done: CheckCircle2,
  run: Play,
  queued: Send,
  wait: Clock,
  replan: Repeat,
  paused: Pause,
  block: XCircle,
  alert: AlertTriangle,
  neutral: CircleDashed,
};

/** Solid fill per tone for bars, rails and charts (text never uses these). */
export const TONE_FILL: Record<Tone, string> = {
  done: "bg-success",
  run: "bg-order",
  queued: "bg-info-fg",
  wait: "bg-warning",
  replan: "bg-warning",
  paused: "bg-warning",
  block: "bg-danger",
  alert: "bg-danger",
  neutral: "bg-content-4",
};

export function StateBadge({ tone, children, size = "md", title }: { tone: Tone; children: React.ReactNode; size?: "sm" | "md"; title?: string }) {
  const Icon = TONE_ICON[tone];
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-[6px] font-semibold ring-1",
        size === "sm" ? "px-1.5 py-px text-[11px]" : "px-2 py-0.5 text-caption",
        TONE_CLASS[tone],
      )}
    >
      <Icon className={size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"} aria-hidden />
      {children}
    </span>
  );
}

export function TagChip({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "order" | "info" | "warning" | "success" }) {
  const cls = {
    neutral: "text-content-2 ring-line",
    order: "text-order-fg ring-order-border",
    info: "text-info-fg ring-info-border",
    warning: "text-warning-fg ring-warning-border",
    success: "text-success-fg ring-success-border",
  }[tone];
  return <span className={cn("inline-flex items-center whitespace-nowrap rounded-[5px] px-1.5 py-px text-caption font-medium ring-1", cls)}>{children}</span>;
}

/** Map any planner/job/line status word to a tone. */
export function toneForStatus(status: string | null | undefined): Tone {
  const s = String(status || "").toUpperCase();
  if (/BLOCK|FAIL|ERROR|SHORT\b|MISSING|HELD|REJECT/.test(s)) return "block";
  if (/REPLAN|PARTIAL/.test(s)) return "replan";
  if (/PAUSE|HOLD/.test(s)) return "paused";
  if (/RUNNING|EXECUTING|IN_PROGRESS|ACTIVE/.test(s)) return "run";
  if (/RELEASED|QUEUED|ASSIGNED|READY_FOR/.test(s)) return "queued";
  if (/WAIT|PENDING|PLANNING|ARTWORK|DRAFT|PLANNED/.test(s)) return "wait";
  if (/COMPLETE|DONE|CLOSED|DISPATCH|DELIVER|VERIFIED|READY/.test(s)) return "done";
  return "neutral";
}

export interface RailStep {
  code: string;
  tone: Tone | "out";
  /** 0–100 posted share of the step target. */
  pct?: number;
  current?: boolean;
  /** Parallel set (e.g. EXT ∥ PRT): one thin bar per lane. */
  parallel?: Array<{ tone: Tone; pct?: number }>;
  tip?: string;
}

/**
 * Route rail: one line, fixed-width steps, each filled by posted ÷ target; the
 * current step is ringed, parallel steps are stacked, a blocked step carries a
 * red notch, steps outside the line's span are dashed.
 */
export function RouteRail({ steps, label, sub }: { steps: RailStep[]; label?: string; sub?: React.ReactNode }) {
  const description = label || `Route: ${steps.map((s) => `${s.code} ${s.tone === "out" ? "not in span" : s.tone}${s.pct && s.pct < 100 ? ` ${Math.round(s.pct)}%` : ""}${s.current ? " (current)" : ""}`).join("; ")}`;
  return (
    <div className="min-w-0">
      <div className="inline-flex max-w-full items-start gap-1 py-0.5" role="img" aria-label={description} tabIndex={0}>
        {steps.map((step, index) => (
          <div key={`${step.code}-${index}`} className={cn("relative grid gap-[7px]", step.parallel ? "w-[54px]" : "w-[34px]")} title={step.tip}>
            {step.parallel ? (
              <div className="grid h-2 gap-px">
                {step.parallel.map((lane, laneIndex) => (
                  <span key={laneIndex} className="relative h-[3.5px] overflow-hidden rounded-[2px] bg-surface-2">
                    <i className={cn("absolute inset-y-0 left-0 rounded-[2px]", TONE_FILL[lane.tone])} style={{ width: `${Math.max(0, Math.min(100, lane.pct ?? (lane.tone === "done" ? 100 : 0)))}%` }} />
                  </span>
                ))}
              </div>
            ) : (
              <div
                className={cn(
                  "relative h-2 overflow-hidden rounded-[3px]",
                  step.tone === "out" ? "bg-[repeating-linear-gradient(90deg,var(--border-strong)_0_3px,transparent_3px_6px)] opacity-70" : step.tone === "block" ? "bg-danger-bg" : "bg-surface-2",
                  step.current && "ring-2 ring-order ring-offset-2 ring-offset-surface-1",
                  step.current && step.tone === "wait" && "ring-warning",
                  step.current && step.tone === "block" && "ring-danger",
                )}
              >
                {step.tone !== "out" ? (
                  <i
                    className={cn("absolute inset-y-0 left-0 rounded-[3px]", TONE_FILL[step.tone as Tone])}
                    style={{ width: `${Math.max(0, Math.min(100, step.pct ?? (step.tone === "done" ? 100 : 0)))}%` }}
                  />
                ) : null}
              </div>
            )}
            {step.tone === "block" ? (
              <span className="absolute -right-0.5 -top-[3px] h-0 w-0 rotate-90 border-l-[5px] border-t-[5px] border-l-transparent border-t-danger-solid" aria-hidden />
            ) : null}
            <b
              className={cn(
                "block whitespace-nowrap text-center font-mono text-[10px] leading-none tracking-tight",
                step.current ? "font-bold" : "font-semibold",
                step.tone === "run" ? "text-order-fg" : step.tone === "wait" || step.tone === "replan" || step.tone === "paused" ? "text-warning-fg" : step.tone === "block" ? "text-danger-fg" : step.tone === "done" ? "text-content-3" : "text-content-4",
              )}
            >
              {step.code}
            </b>
          </div>
        ))}
      </div>
      {sub ? <div className="mt-1 text-[11.5px] leading-snug text-content-3">{sub}</div> : null}
    </div>
  );
}

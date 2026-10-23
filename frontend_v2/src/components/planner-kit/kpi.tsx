"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { TONE_FILL, type Tone } from "./signals";

/**
 * KPI tiles with one small picture each: a 14-day trend, a bullet against
 * capacity, a stacked split or a distribution. A tile may be a button that
 * filters the table below (aria-pressed).
 */

const STROKE: Record<Tone, string> = {
  done: "rgb(var(--success-fg-rgb))",
  run: "rgb(var(--order-fg-rgb))",
  queued: "var(--info-fg)",
  wait: "rgb(var(--warning-fg-rgb))",
  replan: "rgb(var(--warning-fg-rgb))",
  paused: "rgb(var(--warning-fg-rgb))",
  block: "rgb(var(--danger-fg-rgb))",
  alert: "rgb(var(--danger-fg-rgb))",
  neutral: "var(--content-4)",
};

export function Sparkline({ points, tone = "run", height = 28 }: { points: number[]; tone?: Tone; height?: number }) {
  if (points.length < 2) return null;
  const w = 100;
  const max = Math.max(...points);
  const min = Math.min(...points);
  const range = max - min || 1;
  const xy = points.map((p, i) => [(i * w) / (points.length - 1), height - 2 - ((p - min) / range) * (height - 6)] as const);
  const line = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [lx, ly] = xy[xy.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="block h-7 w-full overflow-visible" aria-hidden>
      <polygon points={`${line} ${w},${height} 0,${height}`} fill={STROKE[tone]} opacity={0.12} />
      <polyline points={line} fill="none" stroke={STROKE[tone]} strokeWidth={1.6} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <circle cx={lx} cy={ly} r={2.2} fill={STROKE[tone]} />
    </svg>
  );
}

export function BulletBar({
  value,
  max,
  target,
  left,
  right,
  tone = "run",
}: {
  value: number;
  max: number;
  target?: number;
  left?: React.ReactNode;
  right?: React.ReactNode;
  tone?: Tone;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="grid w-full min-w-0 gap-[3px]">
      <div className="relative h-2 rounded-[3px] bg-surface-2">
        <i className={cn("absolute inset-y-0 left-0 rounded-[3px]", TONE_FILL[tone])} style={{ width: `${pct}%` }} />
        {target !== undefined && max > 0 ? (
          <b className="absolute -top-[3px] h-3.5 w-0.5 rounded-[1px] bg-content-2" style={{ left: `${Math.min(100, (target / max) * 100)}%` }} />
        ) : null}
      </div>
      {left || right ? (
        <div className="flex flex-wrap justify-between gap-x-2 font-mono text-[10.5px] text-content-4">
          <span className="whitespace-nowrap">{left}</span>
          <span className="whitespace-nowrap">{right}</span>
        </div>
      ) : null}
    </div>
  );
}

export function StackBar({
  segments,
  legend = true,
}: {
  segments: Array<{ label: string; value: number; tone: Tone }>;
  legend?: boolean;
}) {
  const total = segments.reduce((sum, seg) => sum + Math.max(0, seg.value), 0) || 1;
  return (
    <div className="w-full min-w-0">
      <div className="flex h-2.5 w-full gap-px overflow-hidden rounded-[3px] bg-surface-2" aria-hidden>
        {segments.filter((s) => s.value > 0).map((seg) => (
          <i key={seg.label} className={cn("block h-full", TONE_FILL[seg.tone])} style={{ width: `${(seg.value / total) * 100}%` }} title={`${seg.label} ${seg.value}`} />
        ))}
      </div>
      {legend ? (
        <div className="mt-1 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[10.5px] text-content-4">
          {segments.map((seg) => (
            <span key={seg.label} className="inline-flex items-center gap-1">
              <i className={cn("h-2 w-2 rounded-[2px]", TONE_FILL[seg.tone])} aria-hidden />
              {seg.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function MiniHistogram({ values, tones, highlight }: { values: number[]; tones?: Tone[]; highlight?: number }) {
  const max = Math.max(...values, 1);
  return (
    <div className="flex h-7 w-full items-end gap-[3px]" aria-hidden>
      {values.map((v, i) => (
        <i
          key={i}
          className={cn("block flex-1 rounded-t-[2px]", tones?.[i] ? TONE_FILL[tones[i]] : "bg-order", highlight === i ? "opacity-100" : "opacity-80")}
          style={{ height: `${Math.max(6, (v / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

export function Delta({ tone, children }: { tone: "good" | "bad" | "up" | "down" | "flat"; children: React.ReactNode }) {
  const cls = {
    good: "bg-success-bg text-success-fg",
    up: "bg-success-bg text-success-fg",
    bad: "bg-danger-bg text-danger-fg",
    down: "bg-danger-bg text-danger-fg",
    flat: "bg-surface-2 text-content-3",
  }[tone];
  return <span className={cn("rounded-[4px] px-1 font-mono text-[11px] font-semibold", cls)}>{children}</span>;
}

export function KpiTile({
  icon: Icon,
  label,
  value,
  unit,
  delta,
  viz,
  sub,
  tone,
  wide,
  onClick,
  pressed,
  testId,
}: {
  icon?: React.ElementType;
  label: string;
  value: React.ReactNode;
  unit?: string;
  delta?: React.ReactNode;
  viz?: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "done" | "wait" | "block" | "run";
  wide?: boolean;
  onClick?: () => void;
  pressed?: boolean;
  testId?: string;
}) {
  const border = {
    done: "border-success-border",
    wait: "border-warning-border",
    block: "border-danger-border",
    run: "border-order-border",
  }[tone || "run"];
  const valueTone = {
    done: "text-success-fg",
    wait: "text-warning-fg",
    block: "text-danger-fg",
    run: "text-content-1",
  }[tone || "run"];
  const inner = (
    <>
      <div className="flex items-center gap-1.5 text-caption font-medium leading-tight text-content-3">
        {Icon ? <Icon className="h-3.5 w-3.5 text-content-4" aria-hidden /> : null}
        {label}
      </div>
      <div className={cn("flex flex-wrap items-baseline gap-x-1.5 text-xl font-semibold leading-tight tracking-tight tabular-nums", valueTone)}>
        {value}
        {unit ? <span className="text-caption font-medium text-content-3">{unit}</span> : null}
        {delta}
      </div>
      <div className="mt-auto flex min-h-7 items-end">{viz}</div>
      {sub ? <div className="text-[11.5px] leading-snug text-content-4">{sub}</div> : null}
    </>
  );
  const cls = cn(
    "flex min-h-[116px] min-w-0 flex-col gap-1 rounded-[14px] border bg-surface-1 px-3.5 pb-2.5 pt-3 text-left shadow-[var(--shadow-sm)]",
    tone ? border : "border-line",
    wide && "xl:col-span-2",
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-pressed={pressed} data-testid={testId} className={cn(cls, "transition-shadow hover:shadow-[var(--shadow-md)]", pressed && "outline outline-2 -outline-offset-1 outline-order")}>
        {inner}
      </button>
    );
  }
  return (
    <div className={cls} data-testid={testId}>
      {inner}
    </div>
  );
}

/** One row on wide screens, balanced rows below (no tile left alone on a line). */
export function KpiRow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "grid grid-cols-2 gap-2 sm:grid-cols-3 xl:auto-cols-fr xl:grid-flow-col xl:grid-cols-none",
        // Odd counts: the last tile takes the free cells so no row is left with a gap.
        "[&:has(>:nth-child(5):last-child)>:last-child]:col-span-2 [&:has(>:nth-child(7):last-child)>:last-child]:col-span-2",
        "sm:[&:has(>:nth-child(5):last-child)>:last-child]:col-span-2 sm:[&:has(>:nth-child(7):last-child)>:last-child]:col-span-3",
        "xl:[&>*]:!col-span-1",
        className,
      )}
    >
      {children}
    </div>
  );
}

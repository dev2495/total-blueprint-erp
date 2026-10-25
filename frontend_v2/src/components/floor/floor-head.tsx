"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

type Tone = "good" | "info" | "warn" | "bad" | "neutral";

const toneDot: Record<Tone, string> = {
  good: "bg-success-fg",
  info: "bg-primary",
  warn: "bg-warning-fg",
  bad: "bg-danger-fg",
  neutral: "bg-content-4",
};

/** Buttons beside the floor page title: solid primary, or white with a hairline. */
export function floorButtonClass(variant: "primary" | "secondary" = "secondary") {
  return cn(
    "inline-flex h-9 items-center justify-center gap-2 rounded-[10px] px-3.5 text-[13px] font-semibold transition-[background-color,border-color,color,opacity] duration-150 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 [&>svg]:h-4 [&>svg]:w-4",
    variant === "primary"
      ? "bg-primary text-primary-foreground shadow-[0_1px_2px_rgba(16,24,40,0.08)] hover:bg-primary/90"
      : "border border-line bg-surface-1 text-content-1 hover:border-line-strong hover:bg-surface-2",
  );
}

/**
 * Head of a floor page as on the approved samples: icon and title, one or two lines on what the
 * page is for, and on the right the live state and the page's actions. No card around it.
 */
export function FloorHead({
  icon,
  title,
  description,
  status,
  alerts,
  actions,
}: {
  icon: React.ReactNode;
  title: string;
  description: React.ReactNode;
  status?: { tone: Tone; text: string };
  alerts?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 lg:flex-nowrap" data-testid="floor-head">
      <div className="min-w-0 max-w-[720px] lg:flex-1">
        <h1 className="flex items-center gap-2 text-[22px] font-semibold leading-tight tracking-[-0.015em] text-content-1 [&>svg]:size-[22px] [&>svg]:text-primary">
          {icon}
          {title}
        </h1>
        <p className="mt-1 text-[13px] leading-relaxed text-content-3">{description}</p>
        {alerts ? <div className="mt-1 flex flex-wrap gap-x-3 text-[12px] text-danger-fg">{alerts}</div> : null}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {status ? (
          <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line bg-surface-1 px-3 text-[12px] font-medium text-content-2">
            <span className={cn("h-2 w-2 rounded-full", toneDot[status.tone])} aria-hidden />
            {status.text}
          </span>
        ) : null}
        {actions}
      </div>
    </header>
  );
}

/** Row of figure tiles under a floor page head (six across on wide screens). */
export function FloorKpiGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6">{children}</div>;
}

/**
 * One figure tile: icon + label, the number large in its tone with its unit beside it, and one
 * line of detail. Tiles that switch a view are buttons and show when their view is open.
 */
export function FloorKpi({
  icon,
  label,
  value,
  unit,
  sub,
  tone = "neutral",
  active,
  onClick,
  testId,
}: {
  icon?: React.ReactNode;
  label: React.ReactNode;
  value: React.ReactNode;
  unit?: React.ReactNode;
  sub?: React.ReactNode;
  tone?: Tone;
  active?: boolean;
  onClick?: () => void;
  testId?: string;
}) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      data-testid={testId}
      aria-pressed={onClick ? Boolean(active) : undefined}
      className={cn(
        "min-w-0 rounded-[14px] border bg-surface-1 px-3.5 py-2.5 text-left shadow-[var(--shadow-sm)] transition-[border-color,box-shadow] duration-150",
        active
          ? "border-primary ring-2 ring-primary/20"
          : tone === "good"
            ? "border-success-border"
            : tone === "info"
              ? "border-info-border"
              : tone === "warn"
                ? "border-warning-border"
                : tone === "bad"
                  ? "border-danger-border"
                  : "border-line",
        onClick && "hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
      )}
    >
      <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-content-2 [&>svg]:size-[15px] [&>svg]:text-content-3">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 flex min-w-0 items-baseline gap-1.5">
        <span
          className={cn(
            "truncate text-[22px] font-semibold leading-none tracking-[-0.02em] tabular-nums",
            tone === "good"
              ? "text-success-fg"
              : tone === "info"
                ? "text-primary"
                : tone === "warn"
                  ? "text-warning-fg"
                  : tone === "bad"
                    ? "text-danger-fg"
                    : "text-content-1",
          )}
        >
          {value}
        </span>
        {unit ? <span className="truncate text-[12px] font-medium text-content-3">{unit}</span> : null}
      </div>
      {sub ? <div className="mt-1 truncate text-[11.5px] text-content-3">{sub}</div> : null}
    </Comp>
  );
}

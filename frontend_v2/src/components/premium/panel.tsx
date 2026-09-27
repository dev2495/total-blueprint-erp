"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { AnimatedNumber } from "./animated-number";
import { Sparkline } from "./sparkline";

/** Standard content card: one border, one radius, one header rhythm. */
export function Panel({
  title,
  description,
  icon,
  actions,
  children,
  className,
  bodyClassName,
  flush,
  id,
}: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  /** Remove body padding (for tables and edge-to-edge charts). */
  flush?: boolean;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={cn(
        "erp-panel min-w-0 rounded-[18px] border border-line bg-surface-1 shadow-[var(--shadow-sm)]",
        className,
      )}
    >
      {title || actions ? (
        <header className="flex flex-wrap items-start justify-between gap-3 px-5 pb-3 pt-4">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-[14.5px] font-semibold tracking-[-0.01em] text-content-1">
              {icon ? <span className="text-content-3 [&>svg]:h-4 [&>svg]:w-4">{icon}</span> : null}
              {title}
            </h2>
            {description ? (
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-content-3">{description}</p>
            ) : null}
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      <div className={cn(flush ? "" : "px-5 pb-5", !title && !actions && !flush && "pt-5", bodyClassName)}>
        {children}
      </div>
    </section>
  );
}

type StatTone = "neutral" | "good" | "warn" | "bad" | "info";

const toneText: Record<StatTone, string> = {
  neutral: "text-content-3",
  good: "text-success-fg",
  warn: "text-warning-fg",
  bad: "text-danger-fg",
  info: "text-info-fg",
};

const toneIcon: Record<StatTone, string> = {
  neutral: "bg-surface-2 text-content-2 ring-line",
  good: "bg-success-bg text-success-fg ring-success-border",
  warn: "bg-warning-bg text-warning-fg ring-warning-border",
  bad: "bg-danger-bg text-danger-fg ring-danger-border",
  info: "bg-info-bg text-info-fg ring-info-border",
};

export type StatCardProps = {
  label: React.ReactNode;
  value: number | null | undefined | React.ReactNode;
  unit?: React.ReactNode;
  format?: (value: number) => string;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  tone?: StatTone;
  /** e.g. { value: "+12%", direction: "up", good: true } */
  delta?: { label: React.ReactNode; direction: "up" | "down" | "flat"; good?: boolean } | null;
  trend?: number[];
  href?: string;
  onClick?: () => void;
  className?: string;
  loading?: boolean;
};

/** KPI card: label, animated number, optional delta and sparkline. */
export function StatCard({
  label,
  value,
  unit,
  format,
  hint,
  icon,
  tone = "neutral",
  delta,
  trend,
  href,
  onClick,
  className,
  loading,
}: StatCardProps) {
  const interactive = Boolean(href || onClick);
  const Comp: React.ElementType = href ? "a" : onClick ? "button" : "div";
  const numeric = typeof value === "number" || value === null || value === undefined;
  const deltaColor = delta
    ? delta.direction === "flat"
      ? "text-content-3"
      : (delta.good ?? delta.direction === "up")
        ? "text-success-fg"
        : "text-danger-fg"
    : "";
  return (
    <Comp
      href={href}
      onClick={onClick}
      type={onClick && !href ? "button" : undefined}
      className={cn(
        "group relative flex min-w-0 flex-col rounded-[16px] border border-line bg-surface-1 p-4 text-left shadow-[var(--shadow-sm)]",
        interactive &&
          "transition-[border-color,box-shadow,transform] duration-150 hover:-translate-y-px hover:border-line-strong hover:shadow-[var(--shadow-md)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="text-[12px] font-medium text-content-3">{label}</span>
        {icon ? (
          <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-lg ring-1 [&>svg]:h-3.5 [&>svg]:w-3.5", toneIcon[tone])}>
            {icon}
          </span>
        ) : null}
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        {loading ? (
          <span className="h-7 w-20 animate-pulse rounded-md bg-surface-2" />
        ) : (
          <span className="text-[26px] font-semibold leading-none tracking-[-0.03em] text-content-1 tabular-nums">
            {numeric ? <AnimatedNumber value={value as number | null | undefined} format={format} /> : (value as React.ReactNode)}
          </span>
        )}
        {unit && !loading ? <span className="text-[13px] font-medium text-content-3">{unit}</span> : null}
      </div>
      <div className="mt-auto flex items-end justify-between gap-3 pt-2.5">
        <div className="min-w-0 text-[12px] leading-snug text-content-3">
          {delta ? <span className={cn("mr-1.5 font-semibold", deltaColor)}>{delta.label}</span> : null}
          {hint ? <span className={delta ? undefined : toneText[tone]}>{hint}</span> : null}
        </div>
        {trend && trend.length > 1 ? (
          <Sparkline data={trend} className="h-8 w-20 shrink-0" tone={tone === "bad" ? "bad" : "info"} />
        ) : null}
      </div>
    </Comp>
  );
}

export function StatGrid({ children, className, columns = 4 }: { children: React.ReactNode; className?: string; columns?: 2 | 3 | 4 | 5 | 6 }) {
  const cols: Record<number, string> = {
    2: "sm:grid-cols-2",
    3: "sm:grid-cols-2 lg:grid-cols-3",
    4: "sm:grid-cols-2 xl:grid-cols-4",
    5: "sm:grid-cols-3 xl:grid-cols-5",
    6: "sm:grid-cols-3 xl:grid-cols-6",
  };
  return <div className={cn("grid grid-cols-1 gap-3", cols[columns], className)}>{children}</div>;
}

/** Quiet inline empty/unavailable state used inside panels. */
export function PanelEmpty({ icon, title, children, className }: { icon?: React.ReactNode; title: React.ReactNode; children?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-h-[140px] flex-col items-center justify-center rounded-xl border border-dashed border-line bg-surface-2/60 px-6 py-8 text-center", className)}>
      {icon ? <div className="mb-2 text-content-4 [&>svg]:h-5 [&>svg]:w-5">{icon}</div> : null}
      <div className="text-[13px] font-medium text-content-2">{title}</div>
      {children ? <div className="mt-1 max-w-sm text-[12px] leading-relaxed text-content-3">{children}</div> : null}
    </div>
  );
}

/** Segmented control (Apple-style) for period / view toggles. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = "md",
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: React.ReactNode }[];
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div role="tablist" className={cn("inline-flex items-center rounded-xl border border-line bg-surface-2 p-0.5", className)}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "rounded-[10px] font-medium transition-[background-color,color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              size === "sm" ? "px-2.5 py-1 text-[12px]" : "px-3 py-1.5 text-[12.5px]",
              active ? "bg-surface-1 text-content-1 shadow-[var(--shadow-sm)]" : "text-content-3 hover:text-content-1",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Horizontal meter with label and value, for share/progress breakdowns. */
export function Meter({ label, value, max, display, tone = "info", className }: { label: React.ReactNode; value: number; max: number; display?: React.ReactNode; tone?: StatTone; className?: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const bar: Record<StatTone, string> = {
    neutral: "bg-content-4",
    good: "bg-[var(--viz-good)]",
    warn: "bg-[var(--viz-warning)]",
    bad: "bg-[var(--viz-critical)]",
    info: "bg-[var(--viz-1)]",
  };
  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex items-baseline justify-between gap-3 text-[12.5px]">
        <span className="truncate text-content-2">{label}</span>
        <span className="shrink-0 font-medium text-content-1 tabular-nums">{display ?? value.toLocaleString("en-IN")}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div className={cn("h-full rounded-full transition-[width] duration-500 ease-out", bar[tone])} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

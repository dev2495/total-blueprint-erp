"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "good" | "warn" | "bad" | "info";

const toneDot: Record<Tone, string> = {
  neutral: "bg-content-4",
  good: "bg-[var(--viz-good)]",
  warn: "bg-[var(--viz-warning)]",
  bad: "bg-[var(--viz-critical)]",
  info: "bg-[var(--viz-1)]",
};

export type PageHeroProps = {
  eyebrow?: React.ReactNode;
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /** Small status chips rendered under the description. */
  meta?: React.ReactNode;
  /** Usually a <HeroStats> grid. */
  children?: React.ReactNode;
  className?: string;
  compact?: boolean;
};

/**
 * The single page header used across the ERP: a plain white card with the
 * title, a one-line description, actions on the right and quiet stat tiles
 * below. Every module renders the same surface so the product reads as one app.
 */
export function PageHero({
  eyebrow,
  icon,
  title,
  description,
  actions,
  meta,
  children,
  className,
  compact,
}: PageHeroProps) {
  return (
    <section
      className={cn(
        "erp-hero erp-enter rounded-[16px]",
        compact ? "px-5 py-4" : "px-5 py-5 md:px-6",
        className,
      )}
    >
      <div className="relative flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 max-w-3xl">
          {eyebrow ? (
            <div className="mb-1.5 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-content-3">
              {icon ? (
                <span className="inline-flex text-content-4 [&>svg]:h-3.5 [&>svg]:w-3.5">{icon}</span>
              ) : null}
              {eyebrow}
            </div>
          ) : null}
          <h1
            className={cn(
              "font-semibold tracking-[-0.02em] text-content-1",
              compact ? "text-[20px] leading-7" : "text-[22px] leading-7 md:text-[24px] md:leading-8",
            )}
          >
            {title}
          </h1>
          {description ? (
            <p className="mt-1 max-w-2xl text-[13.5px] leading-relaxed text-content-3">{description}</p>
          ) : null}
          {meta ? <div className="mt-3 flex flex-wrap items-center gap-1.5">{meta}</div> : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2 lg:justify-end">{actions}</div>
        ) : null}
      </div>
      {children ? <div className="relative mt-4">{children}</div> : null}
    </section>
  );
}

export function HeroStats({
  children,
  className,
  columns = 4,
}: {
  children: React.ReactNode;
  className?: string;
  columns?: 2 | 3 | 4 | 5 | 6;
}) {
  const cols: Record<number, string> = {
    2: "sm:grid-cols-2",
    3: "sm:grid-cols-3",
    4: "sm:grid-cols-2 lg:grid-cols-4",
    5: "sm:grid-cols-3 lg:grid-cols-5",
    6: "sm:grid-cols-3 lg:grid-cols-6",
  };
  return <div className={cn("grid grid-cols-2 gap-2", cols[columns], className)}>{children}</div>;
}

export function HeroStat({
  label,
  value,
  hint,
  tone,
  onClick,
  active,
  testId,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: Tone;
  onClick?: () => void;
  active?: boolean;
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
        "group relative min-w-0 rounded-[12px] border px-4 py-3 text-left transition-[background-color,border-color] duration-150",
        active ? "border-primary/50 bg-info-bg" : "border-line bg-surface-2/60",
        onClick &&
          "hover:border-line-strong hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2",
      )}
    >
      <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-content-3">
        {tone ? <span className={cn("h-1.5 w-1.5 rounded-full", toneDot[tone])} aria-hidden /> : null}
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 truncate text-[22px] font-semibold leading-none tracking-[-0.02em] text-content-1 tabular-nums">
        {value}
      </div>
      {hint ? <div className="mt-1.5 truncate text-caption text-content-3">{hint}</div> : null}
    </Comp>
  );
}

export function HeroChip({ children, tone = "neutral" }: { children: React.ReactNode; tone?: Tone }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-1 px-2.5 py-1 text-caption font-medium text-content-2">
      <span className={cn("h-1.5 w-1.5 rounded-full", toneDot[tone])} aria-hidden />
      {children}
    </span>
  );
}

/** Button styles for use on the hero surface: solid accent, or white with a hairline. */
export function heroButtonClass(variant: "primary" | "ghost" = "ghost") {
  return cn(
    "inline-flex h-9 items-center justify-center gap-2 rounded-[10px] px-3.5 text-[13px] font-medium transition-[background-color,border-color,color,opacity] duration-150 disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 [&>svg]:h-4 [&>svg]:w-4",
    variant === "primary"
      ? "bg-primary text-primary-foreground shadow-[0_1px_2px_rgba(16,24,40,0.08)] hover:bg-primary/90"
      : "border border-line bg-surface-1 text-content-1 hover:border-line-strong hover:bg-surface-2",
  );
}

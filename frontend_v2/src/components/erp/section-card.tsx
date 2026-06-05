"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface SectionCardV3Props {
  index?: number;
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  accent?: "blue" | "emerald" | "amber" | "violet" | "slate";
  sticky?: boolean;
}

const ACCENT_BORDER: Record<
  NonNullable<SectionCardV3Props["accent"]>,
  string
> = {
  blue: "border-l-blue-500",
  emerald: "border-l-emerald-500",
  amber: "border-l-amber-500",
  violet: "border-l-violet-500",
  slate: "border-l-slate-400",
};

const ACCENT_INDEX: Record<
  NonNullable<SectionCardV3Props["accent"]>,
  string
> = {
  blue: "bg-info-bg text-primary ring-info-border",
  emerald: "bg-success-bg text-success-fg ring-success-border",
  amber: "bg-warning-bg text-warning-fg ring-warning-border",
  violet: "bg-order-bg text-order-fg ring-order-border",
  slate: "bg-surface-2 text-content-2 ring-line",
};

const ACCENT_EYEBROW: Record<
  NonNullable<SectionCardV3Props["accent"]>,
  string
> = {
  blue: "text-primary",
  emerald: "text-success-fg",
  amber: "text-warning-fg",
  violet: "text-order-fg",
  slate: "text-content-3",
};

/**
 * V3.7 SectionCardV3 — calmer mockup-aligned section shell used by PM Edit,
 * Stock Launcher, Sales Workspace.
 *
 * - thin 3 px coloured stripe on the left
 * - flat-white header (no gradient wash) with a single bottom border
 * - small tonal-tinted numbered badge (no heavy solid colour)
 * - shadow-sm + no extra ring, so stacked cards don't visually shout
 * - coloured eyebrow line replaces the muted grey one
 */
export function SectionCardV3({
  index,
  eyebrow,
  title,
  description,
  actions,
  children,
  className,
  bodyClassName,
  accent = "blue",
  sticky,
}: SectionCardV3Props) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-2xl border border-line bg-surface-1 shadow-sm border-l-[3px]",
        ACCENT_BORDER[accent],
        className,
      )}
    >
      <header
        className={cn(
          "flex flex-wrap items-start justify-between gap-3 border-b border-line bg-surface-1 px-5 py-3 sm:px-6",
          sticky && "sticky top-0 z-10 backdrop-blur",
        )}
      >
        <div className="flex min-w-0 items-center gap-3">
          {typeof index === "number" ? (
            <span
              className={cn(
                "flex h-7 w-7 flex-none items-center justify-center rounded-lg ring-1 text-xs font-black",
                ACCENT_INDEX[accent],
              )}
            >
              {index}
            </span>
          ) : null}
          <div className="min-w-0">
            {eyebrow ? (
              <div
                className={cn(
                  "text-[10px] font-black uppercase tracking-[0.22em]",
                  ACCENT_EYEBROW[accent],
                )}
              >
                {eyebrow}
              </div>
            ) : null}
            <h2 className="text-[14px] font-bold leading-tight text-content-1">
              {title}
            </h2>
            {description ? (
              <p className="mt-0.5 text-[11px] leading-5 text-content-3">
                {description}
              </p>
            ) : null}
          </div>
        </div>
        {actions ? (
          <div className="flex items-center gap-2">{actions}</div>
        ) : null}
      </header>
      <div
        className={cn("px-5 py-5 sm:px-6", bodyClassName)}
        style={
          {
            contentVisibility: "auto",
            containIntrinsicSize: "1px 600px",
          } as React.CSSProperties
        }
      >
        {children}
      </div>
    </section>
  );
}

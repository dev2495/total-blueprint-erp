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
 * - white card, hairline border, soft shadow; no coloured stripe
 * - neutral numbered circle, 15px title, short grey description
 * - only the optional eyebrow carries the accent colour
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
        "overflow-hidden rounded-[18px] border border-line bg-surface-1 shadow-[var(--shadow-sm)]",
        className,
      )}
    >
      <header
        className={cn(
          "flex flex-wrap items-start justify-between gap-3 border-b border-line bg-surface-1 px-5 py-3.5",
          sticky && "sticky top-0 z-10 backdrop-blur",
        )}
      >
        <div className="flex min-w-0 items-center gap-3">
          {typeof index === "number" ? (
            <span className="grid h-7 w-7 flex-none place-items-center rounded-full bg-surface-2 text-[12px] font-semibold text-content-2 ring-1 ring-line">
              {index}
            </span>
          ) : null}
          <div className="min-w-0">
            {eyebrow ? (
              <div className={cn("text-[11px] font-semibold uppercase tracking-[0.09em]", ACCENT_EYEBROW[accent])}>
                {eyebrow}
              </div>
            ) : null}
            <h2 className="text-[15px] font-semibold leading-snug tracking-[-0.01em] text-content-1">
              {title}
            </h2>
            {description ? (
              <p className="mt-0.5 text-[12.5px] leading-5 text-content-3">
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
        className={cn("px-5 py-4", bodyClassName)}
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

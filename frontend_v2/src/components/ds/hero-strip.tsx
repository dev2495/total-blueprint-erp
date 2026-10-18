"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface HeroStripProps
  extends Omit<React.HTMLAttributes<HTMLElement>, "title"> {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  kpis?: React.ReactNode;
  actions?: React.ReactNode;
  variant?: "light" | "admin" | "plain";
}

export const HeroStrip = React.forwardRef<HTMLElement, HeroStripProps>(
  (
    {
      className,
      eyebrow,
      title,
      subtitle,
      kpis,
      actions,
      variant = "light",
      ...props
    },
    ref,
  ) => (
    <section
      ref={ref}
      className={cn(
        "relative isolate overflow-hidden rounded-[16px] border shadow-[var(--shadow-sm)]",
        variant === "light" && "border-line bg-surface-1",
        variant === "admin" && "erp-admin-hero border-transparent",
        variant === "plain" && "border-line bg-surface-1",
        "px-5 py-4",
        className,
      )}
      style={{ minHeight: "var(--hero-strip-h, 88px)" }}
      {...props}
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          {eyebrow && (
            <div className="text-[12.5px] font-medium text-content-3">
              {eyebrow}
            </div>
          )}
          <h1
            className={cn(
              "font-semibold leading-7 tracking-[-0.02em] text-content-1",
              "text-[22px] md:text-[24px] md:leading-8",
            )}
          >
            {title}
          </h1>
          {subtitle && (
            <div className="mt-1 max-w-2xl text-[13.5px] leading-relaxed text-content-3">
              {subtitle}
            </div>
          )}
        </div>
        {actions && (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        )}
      </div>
      {kpis && (
        <div className="mt-4 flex flex-wrap items-stretch gap-3">{kpis}</div>
      )}
    </section>
  ),
);
HeroStrip.displayName = "HeroStrip";

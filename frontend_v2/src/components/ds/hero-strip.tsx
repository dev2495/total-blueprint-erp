"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface HeroStripProps extends Omit<React.HTMLAttributes<HTMLElement>, "title"> {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  kpis?: React.ReactNode;
  actions?: React.ReactNode;
  variant?: "light" | "admin" | "plain";
}

export const HeroStrip = React.forwardRef<HTMLElement, HeroStripProps>(
  (
    { className, eyebrow, title, subtitle, kpis, actions, variant = "light", ...props },
    ref,
  ) => (
    <section
      ref={ref}
      className={cn(
        "relative isolate overflow-hidden rounded-2xl border",
        variant === "light" && "border-white/40 bg-gradient-to-br from-blue-50/70 via-white to-violet-50/40",
        variant === "admin" && "erp-admin-hero border-transparent",
        variant === "plain" && "border-slate-200 bg-surface-1",
        "px-5 py-4",
        className,
      )}
      style={{ minHeight: "var(--hero-strip-h, 88px)" }}
      {...props}
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          {eyebrow && (
            <div
              className={cn(
                "text-[11px] font-semibold uppercase tracking-[0.14em]",
                variant === "admin" ? "text-blue-200" : "text-blue-700/80",
              )}
            >
              {eyebrow}
            </div>
          )}
          <h1
            className={cn(
              "font-display leading-tight tracking-[-0.01em]",
              "text-[clamp(1.5rem,2.4vw,2.25rem)]",
              variant === "admin" ? "text-white" : "text-slate-900",
            )}
          >
            {title}
          </h1>
          {subtitle && (
            <div
              className={cn(
                "mt-1 max-w-2xl text-sm",
                variant === "admin" ? "text-blue-100/90" : "text-content-3",
              )}
            >
              {subtitle}
            </div>
          )}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      {kpis && <div className="mt-4 flex flex-wrap items-stretch gap-3">{kpis}</div>}
    </section>
  ),
);
HeroStrip.displayName = "HeroStrip";

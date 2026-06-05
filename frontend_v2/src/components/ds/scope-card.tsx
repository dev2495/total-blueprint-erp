"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import type { ChipKind } from "./chip";

export interface ScopeCardProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "title"> {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  selected?: boolean;
  badge?: React.ReactNode;
  tone?: ChipKind;
  meta?: Array<{ label: string; value: React.ReactNode }>;
}

const toneAccent: Record<ChipKind, string> = {
  info: "from-info-bg to-surface-1",
  success: "from-success-bg to-white",
  warn: "from-warning-bg to-white",
  danger: "from-danger-bg to-white",
  neutral: "from-surface-2 to-white",
  accent: "from-order-bg to-white",
  process: "from-info-bg to-surface-1",
  thick: "from-order-bg to-white",
  "fg-roll": "from-danger-bg to-white",
  "fg-pouch": "from-warning-bg to-white",
};

export const ScopeCard = React.forwardRef<HTMLButtonElement, ScopeCardProps>(
  (
    {
      className,
      title,
      description,
      icon,
      selected,
      badge,
      tone = "neutral",
      meta,
      ...props
    },
    ref,
  ) => (
    <button
      ref={ref}
      type="button"
      data-selected={selected || undefined}
      className={cn(
        "group relative flex min-h-[112px] w-full flex-col items-start gap-2 rounded-xl border bg-surface-1 p-4 text-left transition-all",
        "border-line hover:border-line-strong hover:shadow-sm",
        "data-[selected]:border-primary data-[selected]:shadow-[0_0_0_3px_rgba(37,99,235,0.12)]",
        "data-[selected]:bg-gradient-to-br data-[selected]:" + toneAccent[tone],
        className,
      )}
      {...props}
    >
      <div className="flex w-full items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          {icon && (
            <div
              className={cn(
                "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-content-3",
                "group-data-[selected]:bg-surface-1 group-data-[selected]:text-primary",
              )}
            >
              {icon}
            </div>
          )}
          <div className="min-w-0">
            <div className="font-display text-[15px] font-semibold leading-tight text-content-1">
              {title}
            </div>
            {description && (
              <div className="mt-1 text-[12px] leading-snug text-content-3">
                {description}
              </div>
            )}
          </div>
        </div>
        {badge && <div className="shrink-0">{badge}</div>}
      </div>
      {meta && meta.length > 0 && (
        <dl className="mt-2 grid w-full grid-cols-2 gap-2">
          {meta.map((m) => (
            <div key={m.label} className="flex flex-col gap-0.5">
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-content-4">
                {m.label}
              </dt>
              <dd className="font-mono-token text-[12px] text-content-2">
                {m.value}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </button>
  ),
);
ScopeCard.displayName = "ScopeCard";

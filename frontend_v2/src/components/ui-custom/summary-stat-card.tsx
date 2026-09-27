"use client";

import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

interface SummaryStatCardProps {
  label: string;
  value: string | number;
  subLabel?: string;
  icon: LucideIcon;
  toneClassName?: string;
  className?: string;
  compact?: boolean;
}

export function SummaryStatCard({
  label,
  value,
  subLabel,
  icon: Icon,
  toneClassName = "bg-surface-2 text-content-2",
  className,
  compact = false,
}: SummaryStatCardProps) {
  return (
    <div className={cn("min-w-0 rounded-[16px] border border-line bg-surface-1 shadow-[var(--shadow-sm)]", compact ? "p-3.5" : "p-4", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[12px] font-medium text-content-3">{label}</div>
          <div className={cn("font-semibold tracking-[-0.03em] text-content-1 tabular-nums", compact ? "mt-1.5 text-[20px] leading-none" : "mt-2 text-[26px] leading-none")}>
            {value}
          </div>
          {subLabel ? <div className="mt-1.5 text-[12px] leading-snug text-content-3">{subLabel}</div> : null}
        </div>
        <div className={cn("grid shrink-0 place-items-center rounded-lg ring-1 ring-line", compact ? "h-7 w-7" : "h-8 w-8", toneClassName)}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
}

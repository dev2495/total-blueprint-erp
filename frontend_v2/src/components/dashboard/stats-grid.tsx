"use client";

import { Activity, ArrowDownRight, ArrowUpRight, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Metric } from "@/services/dashboard";

type Tone = {
  shell: string;
  icon: string;
  value: string;
};

const TONES: Tone[] = [
  {
    shell:
      "border-info-border bg-[linear-gradient(180deg,rgba(240,249,255,0.92),rgba(255,255,255,0.98))]",
    icon: "bg-info-fg text-white",
    value: "text-info-fg",
  },
  {
    shell:
      "border-info-border bg-[linear-gradient(180deg,rgba(239,246,255,0.94),rgba(255,255,255,0.98))]",
    icon: "bg-primary text-white",
    value: "text-primary",
  },
  {
    shell:
      "border-success-border bg-[linear-gradient(180deg,rgba(236,253,245,0.94),rgba(255,255,255,0.98))]",
    icon: "bg-success-fg text-white",
    value: "text-success-fg",
  },
  {
    shell:
      "border-warning-border bg-[linear-gradient(180deg,rgba(255,251,235,0.94),rgba(255,255,255,0.98))]",
    icon: "bg-warning-fg text-white",
    value: "text-warning-fg",
  },
];

export function StatsGrid({ metrics }: { metrics: Metric[] }) {
  if (!metrics?.length) return null;

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {metrics.map((metric, index) => {
        const tone = TONES[index % TONES.length];
        const trend = Number(metric.trend || 0);
        const trendPositive = trend > 0;
        const trendNegative = trend < 0;
        return (
          <div
            key={`${metric.label}-${index}`}
            className={cn(
              "group relative overflow-hidden rounded-[1.7rem] border px-4 py-4 shadow-[0_24px_60px_-48px_rgba(15,23,42,0.35)] transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_30px_70px_-46px_rgba(15,23,42,0.4)] sm:px-5",
              tone.shell,
            )}
          >
            <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-surface-1/60 blur-2xl" />
            <div className="relative flex h-full flex-col gap-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="text-[10px] font-black uppercase tracking-[0.22em] text-content-3">
                    {metric.label}
                  </div>
                  <div
                    className={cn(
                      "break-words text-[1.9rem] font-black leading-none tracking-tight",
                      tone.value,
                    )}
                  >
                    {metric.value}
                  </div>
                </div>
                <div
                  className={cn(
                    "flex h-11 w-11 shrink-0 items-center justify-center rounded-[1.1rem] shadow-sm",
                    tone.icon,
                  )}
                >
                  <Activity className="h-4 w-4" />
                </div>
              </div>

              <div className="flex items-end justify-between gap-3">
                <div className="text-sm font-semibold text-content-3">
                  {metric.unit || "Live KPI"}
                </div>
                <div
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.18em]",
                    trendPositive && "bg-success-bg text-success-fg",
                    trendNegative && "bg-danger-bg text-danger-fg",
                    !trendPositive &&
                      !trendNegative &&
                      "bg-surface-1/70 text-content-3",
                  )}
                >
                  {trendPositive ? (
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  ) : null}
                  {trendNegative ? (
                    <ArrowDownRight className="h-3.5 w-3.5" />
                  ) : null}
                  {!trendPositive && !trendNegative ? (
                    <Sparkles className="h-3.5 w-3.5" />
                  ) : null}
                  {trendPositive || trendNegative
                    ? `${Math.abs(trend)} trend`
                    : "stable"}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

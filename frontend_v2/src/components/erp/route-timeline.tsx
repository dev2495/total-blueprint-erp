"use client";

import * as React from "react";
import { ArrowRight, Flag, MapPin, Palette } from "lucide-react";
import { cn } from "@/lib/utils";

export interface RouteTimelineStep {
  index: number;
  label: string;
  transition?: string;
  /** Whether this step is the first artwork-bearing step. */
  artwork_step?: boolean;
  /** Render a small process tag below the label. */
  tag?: string;
}

interface RouteTimelineProps {
  steps: RouteTimelineStep[];
  startIndex?: number;
  stopIndex?: number;
  onSelectStop?: (index: number) => void;
  onSelectStart?: (index: number) => void;
  showStartEnd?: boolean;
  helperText?: string;
  className?: string;
}

export function RouteTimeline({
  steps,
  startIndex,
  stopIndex,
  onSelectStop,
  onSelectStart,
  showStartEnd = true,
  helperText,
  className,
}: RouteTimelineProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-line bg-surface-1 p-5",
        className,
      )}
    >
      <div className="flex flex-wrap items-stretch gap-2">
        {showStartEnd ? (
          <RouteEndCap label="Start" icon={<Flag className="h-3.5 w-3.5" />} />
        ) : null}
        {steps.map((s, i) => {
          const isStart = startIndex === s.index;
          const isStop = stopIndex === s.index;
          const isInside =
            startIndex != null &&
            stopIndex != null &&
            s.index > startIndex &&
            s.index < stopIndex;
          return (
            <React.Fragment key={`${s.index}-${s.label}`}>
              <button
                type="button"
                onClick={() => onSelectStop?.(s.index)}
                onDoubleClick={() => onSelectStart?.(s.index)}
                className={cn(
                  "group flex min-w-[140px] flex-1 flex-col items-center rounded-xl border px-3 py-2 text-center transition",
                  isStop
                    ? "border-primary bg-info-bg text-primary ring-2 ring-info-border"
                    : isStart
                      ? "border-success-border bg-success-bg text-success-fg"
                      : isInside
                        ? "border-info-border bg-info-bg text-content-2"
                        : "border-line bg-surface-1 text-content-2 hover:border-info-border hover:bg-info-bg",
                )}
              >
                <span className="flex items-center gap-1.5 text-xs font-bold">
                  <span
                    className={cn(
                      "flex h-5 w-5 items-center justify-center rounded-full text-[10px]",
                      isStop
                        ? "bg-primary text-white"
                        : isStart
                          ? "bg-success-fg text-white"
                          : "bg-surface-2 text-content-3",
                    )}
                  >
                    {s.index}
                  </span>
                  {s.label}
                  {s.artwork_step ? (
                    <Palette className="h-3 w-3 text-order-fg" />
                  ) : null}
                </span>
                {s.transition || s.tag ? (
                  <span className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-content-4">
                    {s.transition || s.tag}
                  </span>
                ) : null}
                {isStop ? (
                  <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-info-bg px-2 py-0.5 text-[10px] font-bold text-primary">
                    <MapPin className="h-3 w-3" /> Stop
                  </span>
                ) : null}
              </button>
              {i < steps.length - 1 ? (
                <ArrowRight className="my-auto hidden h-4 w-4 flex-none text-content-4 sm:block" />
              ) : null}
            </React.Fragment>
          );
        })}
        {showStartEnd ? <RouteEndCap label="End" /> : null}
      </div>
      {helperText ? (
        <p className="mt-3 text-[11px] font-medium text-content-3">
          {helperText}
        </p>
      ) : null}
    </div>
  );
}

function RouteEndCap({
  label,
  icon,
}: {
  label: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex w-16 flex-col items-center justify-center rounded-xl border border-dashed border-line bg-surface-2 py-2 text-[10px] font-semibold uppercase tracking-wider text-content-4">
      {icon}
      {label}
    </div>
  );
}

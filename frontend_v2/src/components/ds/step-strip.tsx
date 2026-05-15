"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export type StepState = "complete" | "current" | "upcoming" | "disabled" | "error";

export interface Step {
  id: string;
  label: React.ReactNode;
  hint?: React.ReactNode;
  state?: StepState;
}

export interface StepStripProps extends React.HTMLAttributes<HTMLDivElement> {
  steps: Step[];
  currentId?: string;
  onStepClick?: (id: string) => void;
  variant?: "default" | "stop";
  compact?: boolean;
}

const stateRing: Record<StepState, string> = {
  complete: "bg-emerald-500 text-white",
  current: "bg-blue-600 text-white shadow-[0_0_0_3px_rgba(37,99,235,0.18)]",
  upcoming: "bg-slate-200 text-slate-600",
  disabled: "bg-slate-100 text-slate-400",
  error: "bg-rose-500 text-white",
};

export const StepStrip = React.forwardRef<HTMLDivElement, StepStripProps>(
  ({ className, steps, currentId, onStepClick, variant = "default", compact, ...props }, ref) => {
    const resolved = React.useMemo(() => {
      const idx = steps.findIndex((s) => s.id === currentId);
      return steps.map((s, i) => {
        if (s.state) return s;
        if (idx < 0) return { ...s, state: "upcoming" as StepState };
        if (i < idx) return { ...s, state: "complete" as StepState };
        if (i === idx) return { ...s, state: "current" as StepState };
        return { ...s, state: "upcoming" as StepState };
      });
    }, [steps, currentId]);

    return (
      <div
        ref={ref}
        role="tablist"
        aria-label="Step strip"
        className={cn(
          "relative flex w-full items-center gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white/80 px-2 py-2 backdrop-blur-sm",
          compact && "py-1",
          variant === "stop" && "border-amber-200 bg-amber-50/40",
          className,
        )}
        style={{ minHeight: compact ? "44px" : "var(--step-strip-h, 56px)" }}
        {...props}
      >
        {resolved.map((step, i) => {
          const isClickable = !!onStepClick && step.state !== "disabled";
          return (
            <React.Fragment key={step.id}>
              <button
                type="button"
                role="tab"
                aria-selected={step.state === "current"}
                aria-disabled={step.state === "disabled"}
                disabled={!isClickable}
                onClick={() => isClickable && onStepClick?.(step.id)}
                className={cn(
                  "group relative flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors",
                  step.state === "current"
                    ? "text-blue-700"
                    : step.state === "complete"
                      ? "text-emerald-700"
                      : step.state === "error"
                        ? "text-rose-700"
                        : step.state === "disabled"
                          ? "text-slate-400"
                          : "text-slate-600",
                  isClickable && "hover:bg-slate-50",
                )}
              >
                <span
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
                    stateRing[step.state ?? "upcoming"],
                  )}
                >
                  {step.state === "complete" ? "✓" : step.state === "error" ? "!" : i + 1}
                </span>
                <span className="flex flex-col items-start text-left leading-tight">
                  <span>{step.label}</span>
                  {step.hint && (
                    <span className="text-[10px] font-normal text-slate-500">{step.hint}</span>
                  )}
                </span>
              </button>
              {i < resolved.length - 1 && (
                <span aria-hidden className="h-px w-3 shrink-0 bg-slate-200" />
              )}
            </React.Fragment>
          );
        })}
      </div>
    );
  },
);
StepStrip.displayName = "StepStrip";

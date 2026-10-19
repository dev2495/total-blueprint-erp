"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export interface StepDef {
  id: string;
  label: string;
  description?: string;
}

interface StepStripProps {
  steps: StepDef[];
  currentId: string;
  completedIds?: string[];
  onStepClick?: (id: string) => void;
  className?: string;
}

export function StepStrip({
  steps,
  currentId,
  completedIds = [],
  onStepClick,
  className,
}: StepStripProps) {
  const completed = new Set(completedIds);
  return (
    <div
      className={cn(
        "rounded-[16px] border border-line bg-surface-1 px-4 py-3 shadow-[var(--shadow-sm)]",
        className,
      )}
    >
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-3">
        {steps.map((s, i) => {
          const isCurrent = s.id === currentId;
          const isDone = completed.has(s.id);
          const last = i === steps.length - 1;
          return (
            <li key={s.id} className="flex items-center">
              <button
                type="button"
                onClick={() => onStepClick?.(s.id)}
                className="group flex items-center gap-3 rounded-xl px-2 py-1 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <span
                  className={cn(
                    "flex h-7 w-7 flex-none items-center justify-center rounded-full text-[12px] font-semibold transition",
                    isCurrent
                      ? "bg-primary text-primary-foreground"
                      : isDone
                        ? "bg-success-bg text-success-fg"
                        : "bg-surface-2 text-content-3 ring-1 ring-line",
                  )}
                >
                  {isDone ? <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> : i + 1}
                </span>
                <span className="leading-tight">
                  <span
                    className={cn(
                      "block text-sm font-semibold",
                      isCurrent
                        ? "text-content-1"
                        : "text-content-2 group-hover:text-content-1",
                    )}
                  >
                    {s.label}
                  </span>
                  {s.description ? (
                    <span className="block text-[11.5px] text-content-3">
                      {s.description}
                    </span>
                  ) : null}
                </span>
              </button>
              {!last ? (
                <span
                  aria-hidden
                  className={cn(
                    "mx-3 hidden h-px w-8 sm:block",
                    isDone ? "bg-success-fg" : "bg-line",
                  )}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

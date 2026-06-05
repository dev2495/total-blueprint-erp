"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface FilterChipProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "value"> {
  label: React.ReactNode;
  value?: React.ReactNode;
  active?: boolean;
  count?: number;
  onClear?: () => void;
}

export const FilterChip = React.forwardRef<HTMLButtonElement, FilterChipProps>(
  (
    { className, label, value, active, count, onClear, children, ...props },
    ref,
  ) => {
    const hasValue = value !== undefined && value !== null && value !== "";
    return (
      <button
        ref={ref}
        type="button"
        data-active={active || hasValue || undefined}
        className={cn(
          "group inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-semibold transition-colors",
          "border-line bg-surface-1 text-content-2 hover:bg-surface-2",
          "data-[active]:border-info-border data-[active]:bg-info-bg data-[active]:text-primary",
          className,
        )}
        {...props}
      >
        <span className="text-content-3 group-data-[active]:text-primary">
          {label}
        </span>
        {hasValue && (
          <>
            <span aria-hidden className="text-content-4">
              ·
            </span>
            <span className="font-mono-token text-[11px]">{value}</span>
          </>
        )}
        {typeof count === "number" && count > 0 && (
          <span className="ml-1 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-white">
            {count}
          </span>
        )}
        {hasValue && onClear && (
          <span
            role="button"
            tabIndex={0}
            aria-label="Clear filter"
            onClick={(e) => {
              e.stopPropagation();
              onClear();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                onClear();
              }
            }}
            className="ml-1 inline-flex h-4 w-4 cursor-pointer items-center justify-center rounded-full text-content-4 hover:bg-surface-2 hover:text-content-2"
          >
            ×
          </span>
        )}
        {children}
      </button>
    );
  },
);
FilterChip.displayName = "FilterChip";

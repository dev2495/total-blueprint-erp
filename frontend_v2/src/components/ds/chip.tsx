"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const chipVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold leading-none transition-colors whitespace-nowrap",
  {
    variants: {
      kind: {
        info: "border-info-border bg-info-bg text-info-fg",
        success: "border-success-border bg-success-bg text-success-fg",
        warn: "border-warning-border bg-warning-bg text-warning-fg",
        danger: "border-danger-border bg-danger-bg text-danger-fg",
        neutral: "border-slate-200 bg-slate-50 text-slate-700",
        accent: "border-violet-200 bg-violet-50 text-violet-700",
        process: "border-blue-200 bg-blue-50 text-blue-700",
        thick: "border-indigo-200 bg-indigo-50 text-indigo-700",
        "fg-roll": "border-danger-border bg-danger-bg text-danger-fg",
        "fg-pouch": "border-warning-border bg-warning-bg text-warning-fg",
      },
      size: {
        sm: "px-2 py-[1px] text-[10px]",
        md: "px-2.5 py-0.5 text-[11px]",
        lg: "px-3 py-1 text-xs",
      },
      mono: {
        true: "font-mono-token tracking-tight",
        false: "",
      },
      interactive: {
        true: "cursor-pointer hover:brightness-95 active:scale-[0.98]",
        false: "",
      },
    },
    defaultVariants: {
      kind: "neutral",
      size: "md",
      mono: false,
      interactive: false,
    },
  },
);

export type ChipKind = NonNullable<VariantProps<typeof chipVariants>["kind"]>;

export interface ChipProps
  extends Omit<React.HTMLAttributes<HTMLSpanElement>, "color">,
    VariantProps<typeof chipVariants> {
  asButton?: boolean;
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
}

export const Chip = React.forwardRef<HTMLSpanElement, ChipProps>(
  (
    {
      className,
      kind,
      size,
      mono,
      interactive,
      asButton,
      leadingIcon,
      trailingIcon,
      children,
      ...props
    },
    ref,
  ) => {
    const Comp = asButton ? "button" : "span";
    return React.createElement(
      Comp,
      {
        ref,
        className: cn(
          chipVariants({ kind, size, mono, interactive: interactive || asButton }),
          className,
        ),
        type: asButton ? "button" : undefined,
        ...props,
      },
      <>
        {leadingIcon ? <span className="-ml-0.5 inline-flex">{leadingIcon}</span> : null}
        {children}
        {trailingIcon ? <span className="-mr-0.5 inline-flex">{trailingIcon}</span> : null}
      </>,
    );
  },
);
Chip.displayName = "Chip";

export interface ChipGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  wrap?: boolean;
  spacing?: "tight" | "normal" | "loose";
}

export const ChipGroup = React.forwardRef<HTMLDivElement, ChipGroupProps>(
  ({ className, wrap = true, spacing = "normal", children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "inline-flex items-center",
        wrap ? "flex-wrap" : "flex-nowrap",
        spacing === "tight" && "gap-1",
        spacing === "normal" && "gap-1.5",
        spacing === "loose" && "gap-2",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  ),
);
ChipGroup.displayName = "ChipGroup";

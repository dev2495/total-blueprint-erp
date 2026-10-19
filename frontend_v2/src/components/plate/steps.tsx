"use client";

/**
 * Calm building blocks shared by the order composer, the product master and the stock
 * launcher: numbered step sections joined by a thin line, choice cards for one-of-few
 * decisions, quiet stat tiles and the fixed action bar at the bottom of a form.
 */
import * as React from "react";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

export type StepState = "done" | "todo" | "warn" | "idle";

export function StepDot({ state = "idle", children, className }: { state?: StepState; children?: React.ReactNode; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative z-[1] grid h-7 w-7 flex-none place-items-center rounded-full text-[12px] font-semibold",
        state === "done" && "bg-success-bg text-success-fg",
        state === "warn" && "bg-warning-bg text-warning-fg",
        state === "todo" && "bg-info-bg text-primary ring-1 ring-info-border",
        state === "idle" && "bg-surface-2 text-content-2 ring-1 ring-line",
        className,
      )}
    >
      {state === "done" ? <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> : state === "warn" ? "!" : children}
    </span>
  );
}

/** One numbered section of a long form. Sections stack with a thin connecting line. */
export function StepSection({
  step,
  state = "idle",
  title,
  hint,
  aside,
  children,
  last = false,
  id,
  className,
  testId,
}: {
  step?: React.ReactNode;
  state?: StepState;
  title: React.ReactNode;
  hint?: React.ReactNode;
  aside?: React.ReactNode;
  children?: React.ReactNode;
  last?: boolean;
  id?: string;
  className?: string;
  testId?: string;
}) {
  return (
    <section id={id} className={cn("relative grid scroll-mt-28 grid-cols-[28px_minmax(0,1fr)] gap-x-4 py-5", className)} data-testid={testId}>
      {!last ? <span aria-hidden className="absolute bottom-0 left-[13.5px] top-[52px] w-px bg-line" /> : null}
      <StepDot state={state}>{step}</StepDot>
      <div className="grid min-w-0 gap-3">
        <div className="flex min-h-7 flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="text-[15.5px] font-semibold leading-snug tracking-[-0.01em] text-content-1">{title}</h3>
          {hint ? <span className="text-[12.5px] text-content-3">{hint}</span> : null}
          {aside ? <span className="ml-auto flex items-center gap-2 text-[12.5px] text-content-3">{aside}</span> : null}
        </div>
        {children}
      </div>
    </section>
  );
}

/** A selectable card for decisions with three or four answers. */
export function ChoiceCard({
  selected,
  title,
  sub,
  tag,
  icon,
  disabled,
  onClick,
  className,
  testId,
  children,
}: {
  selected?: boolean;
  title: React.ReactNode;
  sub?: React.ReactNode;
  tag?: React.ReactNode;
  icon?: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
  testId?: string;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      data-testid={testId}
      className={cn(
        "group grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-0.5 rounded-[13px] border px-3.5 py-3 text-left transition-[border-color,background-color,box-shadow] duration-150",
        selected
          ? "border-primary bg-info-bg shadow-[inset_0_0_0_1px_hsl(var(--primary))]"
          : "border-line-strong bg-surface-1 hover:border-info-border",
        disabled && "cursor-not-allowed opacity-55 hover:border-line-strong",
        className,
      )}
    >
      <span className={cn("flex min-w-0 items-center gap-2 text-[13.5px] font-semibold", selected ? "text-primary" : "text-content-1")}>
        {icon ? <span className="flex-none [&>svg]:h-4 [&>svg]:w-4">{icon}</span> : null}
        <span className="min-w-0">{title}</span>
      </span>
      {tag ? (
        <span className={cn("row-span-2 self-center font-mono text-[10.5px] font-semibold tracking-[0.04em]", selected ? "text-primary" : "text-content-4")}>
          {tag}
        </span>
      ) : (
        <span />
      )}
      {sub ? <span className="col-start-1 text-[12px] leading-snug text-content-3">{sub}</span> : null}
      {children ? <span className="col-span-2 mt-1">{children}</span> : null}
    </button>
  );
}

/** Quiet label + value tile. */
export function StatTile({
  label,
  value,
  sub,
  tone = "plain",
  className,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: "plain" | "ok" | "warn" | "bad";
  className?: string;
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-[11px] px-3 py-2",
        tone === "plain" && "bg-surface-2",
        tone === "ok" && "bg-success-bg",
        tone === "warn" && "bg-warning-bg",
        tone === "bad" && "bg-danger-bg",
        className,
      )}
    >
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-content-3">{label}</div>
      <div
        className={cn(
          "break-words text-[14px] font-semibold leading-snug",
          tone === "ok" ? "text-success-fg" : tone === "warn" ? "text-warning-fg" : tone === "bad" ? "text-danger-fg" : "text-content-1",
        )}
      >
        {value}
      </div>
      {sub ? <div className="break-words text-[11.5px] leading-snug text-content-3">{sub}</div> : null}
    </div>
  );
}

/** Readiness checklist row. */
export function CheckRow({ ok, warn, children, hint }: { ok: boolean; warn?: boolean; children: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-start gap-2.5 text-[13px] leading-snug">
      <span
        aria-hidden
        className={cn(
          "mt-[1px] grid h-[18px] w-[18px] flex-none place-items-center rounded-full text-[10px] font-bold",
          ok ? "bg-success-bg text-success-fg" : warn ? "bg-surface-2 text-content-3" : "bg-warning-bg text-warning-fg",
        )}
      >
        {ok ? "✓" : warn ? "·" : "!"}
      </span>
      <span className={cn("min-w-0", ok ? "text-content-2" : "text-content-1")}>
        {children}
        {hint ? <span className="text-content-3"> · {hint}</span> : null}
      </span>
    </div>
  );
}

/** Fixed bar at the bottom of a form; starts after the sidebar on desktop. */
export function ActionBar({ children, className, testId }: { children: React.ReactNode; className?: string; testId?: string }) {
  return (
    <div
      data-testid={testId}
      className={cn(
        "fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface-1/92 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] pt-3 shadow-[0_-10px_30px_-22px_rgba(16,24,40,0.35)] backdrop-blur-md sm:px-6 lg:left-[var(--sidebar-width,86px)]",
        className,
      )}
    >
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

/** Small rounded status pill. */
export function Pill({ tone = "plain", children, className }: { tone?: "plain" | "ok" | "warn" | "bad" | "info"; children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 max-w-full items-center gap-1.5 truncate rounded-full px-2.5 text-[12px] font-medium",
        tone === "plain" && "bg-surface-2 text-content-2",
        tone === "ok" && "bg-success-bg text-success-fg",
        tone === "warn" && "bg-warning-bg text-warning-fg",
        tone === "bad" && "bg-danger-bg text-danger-fg",
        tone === "info" && "bg-info-bg text-primary",
        className,
      )}
    >
      {children}
    </span>
  );
}

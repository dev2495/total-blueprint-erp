"use client";

import { cn } from "@/lib/utils";
import { PageHero } from "@/components/premium/page-hero";

export function PremiumPageShell({
  children,
  className,
  dataTestId,
}: {
  children: React.ReactNode;
  className?: string;
  dataTestId?: string;
}) {
  return (
    <div data-testid={dataTestId} className={cn("relative mx-auto flex min-w-0 max-w-[1600px] flex-col gap-4", className)}>
      {children}
    </div>
  );
}

/** Legacy API kept for existing pages; renders the shared PageHero. */
export function PremiumHero({
  eyebrow,
  title,
  description,
  actions,
  metrics,
  className,
  dataTestId,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  metrics?: React.ReactNode;
  className?: string;
  dataTestId?: string;
}) {
  return (
    <div data-testid={dataTestId}>
      <PageHero eyebrow={eyebrow} title={title} description={description} actions={actions} className={className}>
        {metrics}
      </PageHero>
    </div>
  );
}

export function PremiumMetricStrip({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-3 sm:grid-cols-2 xl:grid-cols-4", className)}>
      {children}
    </div>
  );
}

export function PremiumMetricCard({
  label,
  value,
  hint,
  tone = "light",
  className,
  valueClassName,
  dataTestId,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: "light" | "dark";
  className?: string;
  valueClassName?: string;
  dataTestId?: string;
}) {
  const dark = tone === "dark";
  return (
    <div
      data-testid={dataTestId}
      className={cn(
        "min-w-0 rounded-2xl border px-4 py-3",
        dark ? "border-[var(--hero-tile-edge)] bg-[var(--hero-tile)] text-white" : "border-line bg-surface-1 text-content-1 shadow-[var(--shadow-sm)]",
        className,
      )}
    >
      <div className={cn("truncate text-[11.5px] font-medium", dark ? "text-white/60" : "text-content-3")}>{label}</div>
      <div className={cn("mt-1.5 break-words text-[22px] font-semibold leading-tight tracking-[-0.025em] tabular-nums", valueClassName)}>{value}</div>
      {hint ? <div className={cn("mt-1 break-words text-[12px] leading-5", dark ? "text-white/55" : "text-content-3")}>{hint}</div> : null}
    </div>
  );
}

export function PremiumSection({
  title,
  description,
  actions,
  children,
  className,
  contentClassName,
  dataTestId,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
  dataTestId?: string;
}) {
  return (
    <section
      data-testid={dataTestId}
      className={cn(
        "overflow-hidden rounded-[18px] border border-line bg-surface-1 shadow-[var(--shadow-sm)]",
        className,
      )}
    >
      <div className="flex flex-col gap-3 px-5 pb-3 pt-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-0.5">
          <h2 className="text-[14.5px] font-semibold tracking-[-0.01em] text-content-1">
            {title}
          </h2>
          {description ? (
            <p className="max-w-3xl text-[12.5px] leading-relaxed text-content-3">
              {description}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="grid w-full gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
            {actions}
          </div>
        ) : null}
      </div>
      <div className={cn("min-w-0 px-5 pb-5", contentClassName)}>
        {children}
      </div>
    </section>
  );
}

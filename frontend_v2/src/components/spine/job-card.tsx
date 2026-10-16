"use client";

/**
 * The one job card: order · step on line 1, customer · product · due on line 2, badges on
 * line 3. Used by the planner queue and the machine queue rail so a job reads the same
 * everywhere. Presentational only; every figure is passed in.
 */
import { cn } from "@/lib/utils";

export type JobCardTone = "info" | "success" | "warning" | "danger" | "neutral";

export interface JobCardBadge {
  label: string;
  tone?: JobCardTone;
  mono?: boolean;
}

const TONE_CLASS: Record<JobCardTone, string> = {
  info: "border-info-border bg-info-bg text-info-fg",
  success: "border-success-border bg-success-bg text-success-fg",
  warning: "border-warning-border bg-warning-bg text-warning-fg",
  danger: "border-danger-border bg-danger-bg text-danger-fg",
  neutral: "border-line bg-surface-2 text-content-2",
};

const RAIL_CLASS: Record<JobCardTone, string> = {
  info: "border-l-primary",
  success: "border-l-success-fg",
  warning: "border-l-warning-fg",
  danger: "border-l-danger-fg",
  neutral: "border-l-line",
};

export function JobCardBadgePill({ badge }: { badge: JobCardBadge }) {
  return (
    <span
      className={cn(
        "inline-flex min-h-5 items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-none",
        badge.mono && "font-mono-token tabular-nums",
        TONE_CLASS[badge.tone || "neutral"],
      )}
    >
      {badge.label}
    </span>
  );
}

export function JobCard({
  title,
  step,
  figure,
  figureHint,
  subtitle,
  badges = [],
  progressPct,
  tone = "info",
  selected = false,
  onClick,
  className,
  testId,
  children,
}: {
  /** Line 1 left: order number (or job number). */
  title: string;
  /** Line 1 after the title: current step / process. */
  step?: string;
  /** Line 1 right: target or remaining figure, already formatted. */
  figure?: string;
  figureHint?: string;
  /** Line 2: customer · product · size · due. */
  subtitle?: string;
  badges?: JobCardBadge[];
  /** 0–100; drawn as a thin bar under line 2 when given. */
  progressPct?: number | null;
  tone?: JobCardTone;
  selected?: boolean;
  onClick?: () => void;
  className?: string;
  testId?: string;
  /** Extra actions rendered under the badges (buttons etc.). */
  children?: React.ReactNode;
}) {
  const Tag: "button" | "div" = onClick ? "button" : "div";
  const pct = progressPct === null || progressPct === undefined ? null : Math.max(0, Math.min(100, progressPct));
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      aria-pressed={onClick ? selected : undefined}
      data-testid={testId}
      className={cn(
        "flex w-full min-w-0 flex-col gap-1 rounded-xl border border-l-4 bg-surface-1 px-3 py-2 text-left shadow-sm transition-colors",
        RAIL_CLASS[tone],
        selected ? "border-info-border bg-info-bg" : "border-line",
        onClick && "hover:border-info-border hover:bg-info-bg",
        className,
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate font-mono-token text-[12.5px] font-semibold text-content-1">{title}</span>
          {step ? <span className="truncate text-[12px] font-semibold text-content-2">· {step}</span> : null}
        </div>
        {figure ? (
          <span className="flex-none font-mono-token text-[12.5px] font-semibold tabular-nums text-content-1" title={figureHint}>
            {figure}
          </span>
        ) : null}
      </div>
      {subtitle ? <div className="truncate text-[12px] text-content-3">{subtitle}</div> : null}
      {pct !== null ? (
        <div className="h-1 w-full overflow-hidden rounded-full bg-surface-2" aria-hidden>
          <div
            className={cn("h-full rounded-full", pct >= 100 ? "bg-success-fg" : "bg-primary")}
            style={{ width: `${pct}%` }}
          />
        </div>
      ) : null}
      {badges.length ? (
        <div className="flex flex-wrap gap-1 pt-0.5">
          {badges.map((badge, index) => (
            <JobCardBadgePill key={`${badge.label}-${index}`} badge={badge} />
          ))}
        </div>
      ) : null}
      {children}
    </Tag>
  );
}

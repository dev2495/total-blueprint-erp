"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import type { FaultStatus, JobStatus, Severity } from "@/services/maintenance";

const JOB_TONES: Record<JobStatus, string> = {
  DUE: "border-warning-border bg-warning-bg text-warning-fg",
  IN_PROGRESS: "border-info-border bg-info-bg text-info-fg",
  DONE: "border-success-border bg-success-bg text-success-fg",
  AWAITING_VERIFICATION: "border-order-border bg-order-bg text-order-fg",
  VERIFIED: "border-success-border bg-success-bg text-success-fg",
  ISSUE_FOUND: "border-danger-border bg-danger-bg text-danger-fg",
  UNABLE: "border-danger-border bg-danger-bg text-danger-fg",
  CANCELLED: "border-line bg-surface-2 text-content-3",
};

export const JOB_LABELS: Record<JobStatus, string> = {
  DUE: "Due",
  IN_PROGRESS: "In progress",
  DONE: "Done",
  AWAITING_VERIFICATION: "Awaiting verification",
  VERIFIED: "Verified",
  ISSUE_FOUND: "Issue found",
  UNABLE: "Could not complete",
  CANCELLED: "Cancelled",
};

const FAULT_TONES: Record<FaultStatus, string> = {
  OPEN: "border-danger-border bg-danger-bg text-danger-fg",
  ASSIGNED: "border-warning-border bg-warning-bg text-warning-fg",
  IN_REPAIR: "border-info-border bg-info-bg text-info-fg",
  RESOLVED: "border-success-border bg-success-bg text-success-fg",
  CLOSED: "border-line bg-surface-2 text-content-3",
  DISMISSED: "border-line bg-surface-2 text-content-3",
};

export const FAULT_LABELS: Record<FaultStatus, string> = {
  OPEN: "Open",
  ASSIGNED: "Assigned",
  IN_REPAIR: "In repair",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
  DISMISSED: "Dismissed",
};

const SEVERITY_TONES: Record<Severity, string> = {
  LOW: "border-line bg-surface-2 text-content-2",
  MEDIUM: "border-warning-border bg-warning-bg text-warning-fg",
  HIGH: "border-danger-border bg-danger-bg text-danger-fg",
  CRITICAL: "border-danger-fg bg-danger-fg text-white",
};

export function JobStatusPill({ status, overdue }: { status: JobStatus; overdue?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-caption font-semibold", JOB_TONES[status] || JOB_TONES.DUE)}>
      {JOB_LABELS[status] || status}
      {overdue && status !== "CANCELLED" ? <span className="rounded-full bg-danger-fg px-1.5 text-white">overdue</span> : null}
    </span>
  );
}

export function FaultStatusPill({ status }: { status: FaultStatus }) {
  return <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-caption font-semibold", FAULT_TONES[status] || FAULT_TONES.OPEN)}>{FAULT_LABELS[status] || status}</span>;
}

export function SeverityPill({ severity }: { severity: Severity }) {
  return <span className={cn("inline-flex rounded-full border px-2 py-0.5 text-caption font-semibold uppercase tracking-wide", SEVERITY_TONES[severity] || SEVERITY_TONES.MEDIUM)}>{severity}</span>;
}

export function fmtDate(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

export function fmtDateTime(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function fmtMinutes(minutes?: number | null): string {
  const value = Math.max(0, Number(minutes || 0));
  if (!value) return "";
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  return hours ? `${hours} h ${rest ? `${rest} min` : ""}`.trim() : `${rest} min`;
}

export function fmtInr(value?: number | string | null): string {
  const number = Number(value || 0);
  return `₹${number.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

/** A tappable list row used on every maintenance screen; phone-first. */
export function Row({ title, subtitle, right, onClick, tone, testId }: { title: ReactNode; subtitle?: ReactNode; right?: ReactNode; onClick?: () => void; tone?: "danger" | "warn" | "info" | "ok"; testId?: string }) {
  const toneClass =
    tone === "danger" ? "border-danger-border bg-danger-bg/40" : tone === "warn" ? "border-warning-border bg-warning-bg/40" : tone === "info" ? "border-info-border bg-info-bg/40" : tone === "ok" ? "border-success-border bg-success-bg/40" : "border-line bg-surface-1";
  const Inner = (
    <>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-content-1">{title}</div>
        {subtitle ? <div className="mt-0.5 text-caption text-content-3">{subtitle}</div> : null}
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </>
  );
  if (onClick) {
    return (
      <button type="button" data-testid={testId} onClick={onClick} className={cn("flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition hover:border-primary", toneClass)}>
        {Inner}
      </button>
    );
  }
  return (
    <div data-testid={testId} className={cn("flex items-center gap-3 rounded-xl border px-3 py-3", toneClass)}>
      {Inner}
    </div>
  );
}

export function SectionLabel({ children, count }: { children: ReactNode; count?: number }) {
  return (
    <div className="mb-2 mt-4 flex items-center gap-2 text-caption font-semibold uppercase tracking-[0.08em] text-content-3">
      <span>{children}</span>
      {typeof count === "number" ? <span className="rounded-full bg-surface-2 px-1.5 text-content-2">{count}</span> : null}
    </div>
  );
}

/** Large tap target for the three outcomes; English with Hindi under it. */
export function BigChoice({ label, hindi, active, onClick, tone = "neutral", testId }: { label: string; hindi?: string; active?: boolean; onClick: () => void; tone?: "ok" | "issue" | "skip" | "neutral"; testId?: string }) {
  const toneClass =
    tone === "ok" ? "border-success-fg text-success-fg bg-success-bg" : tone === "issue" ? "border-warning-fg text-warning-fg bg-warning-bg" : tone === "skip" ? "border-danger-fg text-danger-fg bg-danger-bg" : "border-line text-content-1 bg-surface-1";
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={Boolean(active)}
      onClick={onClick}
      className={cn("min-h-[56px] rounded-xl border-2 px-2 py-2 text-center text-sm font-bold leading-tight transition", active ? toneClass : "border-line bg-surface-1 text-content-2 hover:border-primary")}
    >
      <span className="block">{label}</span>
      {hindi ? <span className="block text-caption font-medium opacity-90">{hindi}</span> : null}
    </button>
  );
}

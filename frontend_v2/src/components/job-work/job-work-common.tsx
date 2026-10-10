"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Lock, RefreshCw } from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { canReviewGateBills, isGateMaster, isWatchmanUser } from "@/components/gate/gate-access";
import { describeApiError, getApiErrorStatus, extractApiErrorMap } from "@/lib/api";
import { hasGrantedPermission } from "@/lib/sidebar-nav";
import { cn } from "@/lib/utils";
import { inventoryService, type Location } from "@/services/inventory";
import { JOB_WORK_STATUS_META, type JobWorkStatus } from "@/services/job-work";

export { newClientToken } from "@/components/gate/use-gate-operation";

/* ----------------------------------------------------------------- access */

type EntitledUser = {
  entitlements?: { permissions?: string[]; permission_map?: Record<string, string[]> } | null;
} & Parameters<typeof isGateMaster>[0];

/**
 * Mirrors the backend job-work rules: watchman never; owner/admin always;
 * otherwise inventory.view to read and inventory.manage to change. Bill
 * linking also needs bill-receiving authority (Inventory store or a master).
 */
export function useJobWorkAccess() {
  const { user, effectiveRole, loading } = useAuth();
  return useMemo(() => {
    const u = user as unknown as EntitledUser;
    if (!u || isWatchmanUser(u, effectiveRole)) {
      return { loading, canView: false, canManage: false, canLinkBill: false, isOwner: false };
    }
    const master = isGateMaster(u, effectiveRole);
    const perms = u?.entitlements?.permissions || [];
    const map = u?.entitlements?.permission_map || {};
    const canManage = master || hasGrantedPermission("inventory.manage", perms, map);
    const canView = canManage || hasGrantedPermission("inventory.view", perms, map);
    return { loading, canView, canManage, canLinkBill: canReviewGateBills(u, effectiveRole), isOwner: master };
  }, [user, effectiveRole, loading]);
}

export function JobWorkAccessDenied() {
  return (
    <div className="mx-auto mt-10 max-w-[520px] rounded-3xl border border-line bg-surface-1 p-6 text-center" role="alert">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-2 text-content-3">
        <Lock className="h-6 w-6" />
      </div>
      <h1 className="mt-3 text-lg font-semibold text-content-1">Job work is for inventory and planning staff</h1>
      <p className="mt-2 text-sm leading-relaxed text-content-3">
        Viewing needs inventory view rights; sending and receiving material needs inventory manage rights (Store by default).
        Ask an administrator if you need access.
      </p>
      <Link href="/inventory" className="mt-4 inline-flex min-h-[44px] items-center rounded-xl px-4 text-sm font-semibold text-primary hover:underline">
        Inventory workspace
      </Link>
    </div>
  );
}

/* ----------------------------------------------------------------- display */

const TONE_CLASS: Record<string, string> = {
  warn: "border-warning-border bg-warning-bg text-warning-fg",
  info: "border-info-border bg-info-bg text-info-fg",
  good: "border-success-border bg-success-bg text-success-fg",
  bad: "border-danger-border bg-danger-bg text-danger-fg",
  neutral: "border-line bg-surface-2 text-content-2",
};

export function JobWorkStatusPill({ status, className }: { status: JobWorkStatus | string; className?: string }) {
  const meta = JOB_WORK_STATUS_META[status as JobWorkStatus];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11.5px] font-semibold",
        TONE_CLASS[meta?.tone ?? "neutral"],
        className,
      )}
      title={meta?.hint}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {meta?.label ?? status}
    </span>
  );
}

export function Chip({ tone = "neutral", children, title }: { tone?: keyof typeof TONE_CLASS; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold", TONE_CLASS[tone])}>
      {children}
    </span>
  );
}

const NUM = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 3 });
const INT = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const INR = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 });
const DATE = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" });
const DATETIME = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true });

export function toNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}
export const fmtKg = (value: unknown) => `${NUM.format(toNumber(value))} kg`;
export const fmtNum = (value: unknown) => NUM.format(toNumber(value));
export const fmtPcs = (value: unknown) => `${INT.format(toNumber(value))} pcs`;
export const fmtInr = (value: unknown) => (value === null || value === undefined || value === "" ? "—" : INR.format(toNumber(value)));
export function fmtDate(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : DATE.format(d);
}
export function fmtDateTime(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : DATETIME.format(d);
}
export function todayIso() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}
export function addDaysIso(days: number) {
  const d = new Date(Date.now() + days * 86_400_000);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ errors */

/** Plain message for a job-work API failure (the server sends a specific `message`). */
export function jobWorkError(error: unknown, fallback = "The request could not be completed.") {
  const status = getApiErrorStatus(error);
  if (status === null) return "No connection to the server. Check the network and retry; nothing new was saved.";
  if (status === 403) return describeApiError(error, "You do not have permission for this action.");
  if (status >= 500) return "The server had a problem. Retry in a moment; if you retry with the same form, it cannot post twice.";
  const text = describeApiError(error, fallback)
    .split(" • ")
    .filter((part) => !/^request failed\.?$/i.test(part.trim()))
    .join(" • ");
  return text || fallback;
}

export function fieldErrors(error: unknown): Record<string, string> {
  return extractApiErrorMap(error);
}

/** Network loss / timeout / 5xx: the post may have committed, so retry with the same token. */
export function isUncertain(error: unknown) {
  const status = getApiErrorStatus(error);
  return status === null || status === 0 || status === 408 || status === 429 || (status !== null && status >= 500);
}

export function ErrorBanner({ message, onRetry, retryLabel = "Retry" }: { message: string; onRetry?: () => void; retryLabel?: string }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger-border bg-danger-bg px-4 py-3 text-[13px] text-danger-fg">
      <span className="inline-flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>{message}</span>
      </span>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-surface-1 px-3 font-semibold text-content-1">
          <RefreshCw className="h-3.5 w-3.5" aria-hidden /> {retryLabel}
        </button>
      ) : null}
    </div>
  );
}

export function Notice({ tone = "info", children, title }: { tone?: "info" | "warn" | "good" | "bad"; children: React.ReactNode; title?: React.ReactNode }) {
  return (
    <div role={tone === "bad" ? "alert" : "status"} className={cn("rounded-xl border px-4 py-3 text-[13px] leading-relaxed", TONE_CLASS[tone])}>
      {title ? <div className="font-semibold">{title}</div> : null}
      <div className={title ? "mt-0.5" : undefined}>{children}</div>
    </div>
  );
}

/* ---------------------------------------------------------------- inputs */

export const inputClass =
  "h-11 w-full rounded-xl border border-line bg-surface-2 px-3 text-[14px] text-content-1 outline-none transition-colors placeholder:text-content-4 focus:border-primary focus:ring-2 focus:ring-info-border disabled:opacity-60";
export const labelClass = "mb-1 block text-[12px] font-semibold text-content-2";

export function Field({ label, hint, error, children, htmlFor, className }: { label: string; hint?: React.ReactNode; error?: string; children: React.ReactNode; htmlFor?: string; className?: string }) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className={labelClass}>
        {label}
      </label>
      {children}
      {error ? (
        <p className="mt-1 text-[12px] text-danger-fg" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1 text-[12px] text-content-3">{hint}</p>
      ) : null}
    </div>
  );
}

/** Active stock locations of a plant (job-work, transit and scrap excluded). */
export function usePlantLocations(plantId?: string | null) {
  return useQuery({
    queryKey: ["inventory", "locations", plantId],
    queryFn: () => inventoryService.getLocations(plantId || undefined),
    enabled: Boolean(plantId),
    staleTime: 5 * 60_000,
    select: (rows: Location[]) => rows.filter((row) => row.is_active !== false && !["JOBWORK", "TRANSIT", "SCRAP"].includes(String(row.type || "").toUpperCase())),
    meta: { suppressGlobalError: true },
  });
}

export function pickLocation(rows: Location[] | undefined, type: string) {
  const list = rows || [];
  return list.find((row) => String(row.type).toUpperCase() === type) ?? list[0];
}

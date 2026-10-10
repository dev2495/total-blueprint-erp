"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Lock, RotateCcw } from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { isGateMaster, isWatchmanUser } from "@/components/gate/gate-access";
import { gateErrorMessage, isUncertainFailure, type GateOperationPhase } from "@/components/gate/use-gate-operation";
import { cn } from "@/lib/utils";

export type DocumentRight = "documents.view" | "documents.upload" | "documents.manage" | "gatepass.manage" | "outward.reconcile";

/**
 * Bill & document rights from the backend entitlements (real account; role
 * previews and wildcards never add them). Owner/Admin are true server-side;
 * Watchman is always false. The API re-checks every action.
 */
export function useDocumentRights() {
  const { user, effectiveRole, loading } = useAuth();
  const watchman = isWatchmanUser(user, effectiveRole);
  const documents = user?.entitlements?.documents;
  const master = Boolean(user) && isGateMaster(user, effectiveRole);
  const has = (code: DocumentRight) => {
    if (!user || watchman) return false;
    if (documents && typeof documents[code] === "boolean") return documents[code] === true;
    if (code === "documents.view" && documents) return Object.values(documents).some(Boolean);
    return master;
  };
  return { loading, user, watchman, master, has };
}

export function RightsDenied({ title, body, href = "/inventory", linkLabel = "Inventory workspace" }: { title: string; body: string; href?: string; linkLabel?: string }) {
  return (
    <div className="mx-auto mt-10 max-w-[560px] rounded-3xl border border-line bg-surface-1 p-6 text-center" role="alert">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-2 text-content-3">
        <Lock className="h-6 w-6" />
      </div>
      <h1 className="mt-3 text-lg font-semibold text-content-1">{title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-content-3">{body}</p>
      <Link href={href} className="mt-4 inline-flex min-h-[44px] items-center rounded-xl px-4 text-sm font-semibold text-primary hover:underline">
        {linkLabel}
      </Link>
    </div>
  );
}

export function LoadFailure({ subject, error, retry }: { subject: string; error: unknown; retry: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-danger-border bg-danger-bg px-4 py-3 text-[13px] text-danger-fg">
      <span className="inline-flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          {subject} could not be loaded. {gateErrorMessage(error, "Check the connection and try again.")}
        </span>
      </span>
      <button type="button" onClick={retry} className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-surface-1 px-3 font-semibold text-content-1 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border">
        <RotateCcw className="h-4 w-4" /> Retry
      </button>
    </div>
  );
}

/** Inline result of an office action sent with useGateOperation (frozen client token). */
export function ActionFeedback({ phase, error, onRetry, onRelease, className }: { phase: GateOperationPhase; error: unknown; onRetry: () => void; onRelease: () => void; className?: string }) {
  if (phase === "uncertain" || (phase === "rejected" && isUncertainFailure(error))) {
    return (
      <div role="alert" className={cn("rounded-xl border border-warning-border bg-warning-bg px-3 py-2.5 text-[13px] text-warning-fg", className)}>
        <div className="font-semibold">Not confirmed yet</div>
        <p className="mt-0.5">{gateErrorMessage(error)} Sending again repeats the same action and cannot apply it twice.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" onClick={onRetry} className="min-h-[40px] rounded-lg bg-surface-1 px-3 font-semibold text-content-1 hover:bg-surface-2">
            Send again
          </button>
          <button type="button" onClick={onRelease} className="min-h-[40px] rounded-lg px-3 font-semibold text-content-2 hover:bg-surface-1/60">
            I checked — edit instead
          </button>
        </div>
      </div>
    );
  }
  if (phase === "rejected") {
    return (
      <p role="alert" className={cn("rounded-xl border border-danger-border bg-danger-bg px-3 py-2.5 text-[13px] text-danger-fg", className)}>
        {gateErrorMessage(error, "Not saved.")}
      </p>
    );
  }
  return null;
}

const DT = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true });
const D = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" });

export function docDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : DT.format(date);
}

export function docDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(date.getTime()) ? value : D.format(date);
}

export const TONE_CLASS: Record<"warn" | "info" | "good" | "neutral" | "bad", string> = {
  warn: "border-warning-border bg-warning-bg text-warning-fg",
  info: "border-info-border bg-info-bg text-info-fg",
  good: "border-success-border bg-success-bg text-success-fg",
  neutral: "border-line bg-surface-2 text-content-2",
  bad: "border-danger-border bg-danger-bg text-danger-fg",
};

export function TonePill({ tone, label, title, className }: { tone: keyof typeof TONE_CLASS; label: string; title?: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11.5px] font-semibold", TONE_CLASS[tone], className)} title={title}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {label}
    </span>
  );
}

/** Debounced value for server-side search boxes. */
export function useDebounced<T>(value: T, delay = 350) {
  const [state, setState] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setState(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return state;
}

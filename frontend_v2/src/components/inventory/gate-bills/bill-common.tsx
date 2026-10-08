"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FileImage, Lock } from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { canReviewGateBills } from "@/components/gate/gate-access";
import { cn } from "@/lib/utils";
import { BILL_STATUS_META, gateBillsApi, type BillStatus } from "@/services/gate-bills";

/** Inventory bill queue polling: 5 s while visible (contract), quiet when hidden. */
export const BILL_POLL_MS = 5_000;

export function useBillReviewAccess() {
  const { user, effectiveRole, loading } = useAuth();
  return { loading, allowed: Boolean(user) && canReviewGateBills(user, effectiveRole), user };
}

const TONE_CLASS: Record<string, string> = {
  warn: "border-warning-border bg-warning-bg text-warning-fg",
  info: "border-info-border bg-info-bg text-info-fg",
  good: "border-success-border bg-success-bg text-success-fg",
  neutral: "border-line bg-surface-2 text-content-2",
};

export function BillStatusPill({ status, className }: { status: BillStatus | string; className?: string }) {
  const meta = BILL_STATUS_META[status as BillStatus];
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

/** "3h 12m" since arrival; updates with `now`. */
export function waitingLabel(fromIso: string, now: number, toIso?: string | null): string {
  const start = new Date(fromIso).getTime();
  if (Number.isNaN(start)) return "—";
  const end = toIso ? new Date(toIso).getTime() : now;
  const minutes = Math.max(0, Math.floor((end - start) / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export function useNowTick(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

const DT = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: true });
export function billDateTime(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : DT.format(d);
}

export function billRef(id: string) {
  return id.slice(0, 8).toUpperCase();
}

/** First-page thumbnail fetched as an authenticated blob (memory only). */
export function BillThumb({ imageUrl, alt, className }: { imageUrl?: string; alt: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!imageUrl) return;
    setUrl(null);
    setFailed(false);
    let cancelled = false;
    let created: string | null = null;
    gateBillsApi
      .pageObjectUrl(imageUrl)
      .then((objectUrl) => {
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        created = objectUrl;
        setUrl(objectUrl);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [imageUrl]);
  return (
    <span className={cn("flex items-center justify-center overflow-hidden rounded-xl border border-line bg-surface-2 text-content-4", className)}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={alt} className="h-full w-full object-cover object-top" />
      ) : (
        <FileImage className={cn("h-5 w-5", failed ? "text-danger-fg" : "")} aria-hidden />
      )}
    </span>
  );
}

export function BillAccessDenied() {
  return (
    <div className="mx-auto mt-10 max-w-[520px] rounded-3xl border border-line bg-surface-1 p-6 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-2 text-content-3">
        <Lock className="h-6 w-6" />
      </div>
      <h1 className="mt-3 text-lg font-semibold text-content-1">Gate bills are for the inventory receiving team</h1>
      <p className="mt-2 text-sm leading-relaxed text-content-3">
        Store users, administrators and owners see gate bills waiting for a GRN by default. Other accounts need the gate bill review
        permission together with inventory or procurement receiving rights. Watchman accounts record bills at the gate instead.
      </p>
      <Link href="/inventory" className="mt-4 inline-flex min-h-[44px] items-center rounded-xl px-4 text-sm font-semibold text-primary hover:underline">
        Inventory workspace
      </Link>
    </div>
  );
}

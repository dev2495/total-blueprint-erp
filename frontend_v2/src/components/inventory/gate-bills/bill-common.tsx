"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { FileImage, Lock } from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { canReviewGateBills, isGateMaster, isWatchmanUser } from "@/components/gate/gate-access";
import { cn } from "@/lib/utils";
import { BILL_STATUS_META, CATEGORY_META, gateBillsApi, type BillStatus, type DocumentCategory, type InwardBill } from "@/services/gate-bills";

/** Inventory bill queue polling: 5 s while visible (contract), quiet when hidden. */
export const BILL_POLL_MS = 5_000;

/**
 * Bill & document rights from the real account (`entitlements.documents`).
 * Inventory (STORE) holds them by default; Owner/Admin always; others only via
 * the Role matrix or user extra permissions. Watchman never.
 */
export function useDocumentAccess() {
  const { user, effectiveRole, loading } = useAuth();
  const watchman = Boolean(user) && isWatchmanUser(user, effectiveRole);
  const docs = user?.entitlements?.documents ?? {};
  const review = Boolean(user) && !watchman && canReviewGateBills(user, effectiveRole);
  const master = Boolean(user) && !watchman && isGateMaster(user, effectiveRole);
  const manage = !watchman && (master || docs["documents.manage"] === true);
  const upload = !watchman && (master || docs["documents.upload"] === true);
  const view = !watchman && (master || review || manage || upload || docs["documents.view"] === true);
  return { loading, user, view, upload, manage, review, master, watchman };
}

/** Kept for existing call sites: anyone who may open the document register. */
export function useBillReviewAccess() {
  const access = useDocumentAccess();
  return { loading: access.loading, allowed: access.view, user: access.user };
}

const TONE_CLASS: Record<string, string> = {
  warn: "border-warning-border bg-warning-bg text-warning-fg",
  info: "border-info-border bg-info-bg text-info-fg",
  good: "border-success-border bg-success-bg text-success-fg",
  neutral: "border-line bg-surface-2 text-content-2",
  danger: "border-danger-border bg-danger-bg text-danger-fg",
};

export function TonePill({ tone, children, className, title }: { tone: keyof typeof TONE_CLASS; children: React.ReactNode; className?: string; title?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[11.5px] font-semibold", TONE_CLASS[tone], className)} title={title}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {children}
    </span>
  );
}

export function BillStatusPill({ status, className }: { status: BillStatus | string; className?: string }) {
  const meta = BILL_STATUS_META[status as BillStatus];
  return (
    <TonePill tone={meta?.tone ?? "neutral"} className={className} title={meta?.hint}>
      {meta?.label ?? status}
    </TonePill>
  );
}

/** One plain stage per document: what the office sees in lists and headers. */
export function documentStage(bill: Pick<InwardBill, "status" | "category" | "needs_followup">): { label: string; tone: keyof typeof TONE_CLASS; hint: string } {
  if (bill.status === "PENDING_GRN" && !bill.category) return { label: "Needs classifying", tone: "warn", hint: "Choose what this paper is so the next step is clear" };
  if (bill.status === "PARTIAL_GRN" && !bill.category) return { label: "Partly received", tone: "info", hint: "Receipts linked — classify it and confirm when every line is received" };
  if (bill.status === "VOID" && bill.needs_followup) return { label: "Voided · needs follow-up", tone: "warn", hint: "Voided as non-stock before the register existed. Record what it delivered." };
  const meta = BILL_STATUS_META[bill.status as BillStatus];
  if (bill.status === "PENDING_GRN" && bill.category && CATEGORY_META[bill.category as DocumentCategory]?.route === "file") {
    return { label: "Ready to file", tone: "warn", hint: "Record-only paper: file it once the header is complete" };
  }
  return { label: meta?.label ?? bill.status, tone: meta?.tone ?? "neutral", hint: meta?.hint ?? "" };
}

export function StagePill({ bill, className }: { bill: Pick<InwardBill, "status" | "category" | "needs_followup">; className?: string }) {
  const stage = documentStage(bill);
  return (
    <TonePill tone={stage.tone} className={className} title={stage.hint}>
      {stage.label}
    </TonePill>
  );
}

export function SourceChip({ source }: { source?: string }) {
  if (!source) return null;
  return (
    <span className="inline-flex items-center rounded-md border border-line bg-surface-2 px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-content-3">
      {source === "OFFICE" ? "Office" : "Gate"}
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

const D = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" });
/** "05 Oct 2026" for YYYY-MM-DD (no timezone shift). */
export function billDate(value?: string | null) {
  if (!value) return "—";
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return value;
  return D.format(new Date(y, m - 1, d));
}

const INR = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const INR0 = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
export function inr(value?: string | number | null, whole = false) {
  if (value === null || value === undefined || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  return (whole ? INR0 : INR).format(n);
}

export function billRef(id: string) {
  return id.slice(0, 8).toUpperCase();
}

/** Local YYYY-MM-DD (Asia/Kolkata users): never `toISOString()` which shifts to UTC. */
export function localIsoDate(date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Save a private blob as a file without leaving it in browser storage. */
export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
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

export function BillAccessDenied({ title = "Bills & documents are for the Inventory team", body }: { title?: string; body?: React.ReactNode }) {
  return (
    <div className="mx-auto mt-10 max-w-[520px] rounded-3xl border border-line bg-surface-1 p-6 text-center" role="alert">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-2 text-content-3">
        <Lock className="h-6 w-6" />
      </div>
      <h1 className="mt-3 text-lg font-semibold text-content-1">{title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-content-3">
        {body ?? (
          <>
            Inventory (Store) users, administrators and owners see every bill and document by default. Another account needs the
            documents view right, given through the Role matrix or as an extra permission on the user. Watchman accounts photograph
            bills at the gate instead.
          </>
        )}
      </p>
      <Link href="/inventory" className="mt-4 inline-flex min-h-[44px] items-center rounded-xl px-4 text-sm font-semibold text-primary hover:underline">
        Inventory workspace
      </Link>
    </div>
  );
}

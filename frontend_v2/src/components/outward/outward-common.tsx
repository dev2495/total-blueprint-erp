"use client";

import { useEffect, useState } from "react";
import { FileImage } from "lucide-react";

import type { WorkspaceDocument, WorkspaceTone } from "@/components/documents/bill-workspace";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { OUTWARD_STATUS_META, type OutwardDocument, type OutwardStatus } from "@/services/outward";

import { TonePill, docDateTime } from "./document-rights";

export function OutwardStatusPill({ status, className }: { status: OutwardStatus; className?: string }) {
  const meta = OUTWARD_STATUS_META[status];
  return <TonePill tone={meta?.tone ?? "neutral"} label={meta?.label ?? status} title={meta?.hint} className={className} />;
}

const WORKSPACE_TONE: Record<string, WorkspaceTone> = { warn: "warning", info: "info", good: "success", neutral: "neutral", bad: "danger" };

/** `<BillWorkspace>` document for an outward departure. */
export function outwardWorkspaceDocument(document: OutwardDocument): WorkspaceDocument {
  const meta = OUTWARD_STATUS_META[document.status];
  const refs = document.links.map((link) => link.reference).filter(Boolean);
  return {
    id: document.id,
    label: `Outward ${document.reference}${refs.length ? ` · ${refs.join(", ")}` : ""}`,
    statusLabel: meta?.label ?? document.status,
    statusTone: WORKSPACE_TONE[meta?.tone ?? "neutral"] ?? "neutral",
    meta: [`Left ${docDateTime(document.departed_at)}`, document.plant_name, document.vehicle_number || null, `${document.page_count} page${document.page_count === 1 ? "" : "s"}`].filter(Boolean).join(" · "),
    pages: document.pages,
    popoutHref: `/inventory/outward-documents/${document.id}/view`,
  };
}

/** Private page thumbnail fetched as an authenticated blob (memory only, revoked on change). */
export function PageThumb({ url, alt, className }: { url?: string | null; alt: string; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setSrc(null);
    setFailed(false);
    if (!url) return;
    let cancelled = false;
    let created: string | null = null;
    api
      .get<Blob>(url, { responseType: "blob", timeout: 30_000 })
      .then(({ data }) => {
        if (cancelled) return;
        created = URL.createObjectURL(data);
        setSrc(created);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [url]);
  return (
    <span className={cn("flex items-center justify-center overflow-hidden rounded-xl border border-line bg-surface-2 text-content-4", className)}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} className="h-full w-full object-cover object-top" />
      ) : (
        <FileImage className={cn("h-5 w-5", failed ? "text-danger-fg" : "")} aria-hidden />
      )}
    </span>
  );
}

export function waitingSince(fromIso: string, now: number) {
  const start = new Date(fromIso).getTime();
  if (Number.isNaN(start)) return "—";
  const minutes = Math.max(0, Math.floor((now - start) / 60000));
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

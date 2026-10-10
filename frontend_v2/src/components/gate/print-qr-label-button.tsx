"use client";

import { useState } from "react";
import { Loader2, QrCode } from "lucide-react";

import { useDocumentRights } from "@/components/outward/document-rights";
import { Button } from "@/components/ui/button";
import { describeApiError, getApiErrorStatus } from "@/lib/api";
import { cn } from "@/lib/utils";
import { outwardApi, type GateQrKind } from "@/services/outward";

/*
 * QR gate sticker (101.6 × 50.8 mm roll label) for one saved ERP outward
 * document. The tax invoice comes from Tally and the Epson dispatch slip keeps
 * its fixed layout, so the office prints this sticker and sticks it on the
 * paper; the watchman's scan links the departure to the ERP record.
 * Contract: GET /api/gate/qr/label.pdf?kind=&id=&copies= (apps/gate/qr_views.py).
 */

export const GATE_QR_STICKER_HINT = "Stick this on the Tally bill or dispatch slip — the gate scans it.";
const MAX_COPIES = 5;
const LABEL_PERMISSIONS = ["inventory.view", "inventory.manage", "logistics.view", "logistics.manage"];

/**
 * Mirrors backend qr_views.can_mint_tokens: never the watchman; Owner/Admin,
 * any bill & document right, or a literal inventory / logistics grant. The
 * server re-checks every request.
 */
export function useGateQrLabelAccess() {
  const rights = useDocumentRights();
  const permissions = rights.user?.entitlements?.permissions ?? [];
  const allowed =
    Boolean(rights.user) &&
    !rights.watchman &&
    (rights.master || rights.has("documents.view") || permissions.some((code) => LABEL_PERMISSIONS.includes(code)));
  return { loading: rights.loading, allowed };
}

async function stickerErrorMessage(error: unknown) {
  const status = getApiErrorStatus(error);
  if (status === 403) return "Your account cannot print gate QR stickers. Ask an administrator for inventory or logistics access.";
  const raw = (error as { response?: { data?: unknown } } | null)?.response?.data;
  let payload: unknown = raw;
  if (typeof Blob !== "undefined" && raw instanceof Blob) {
    try {
      payload = JSON.parse(await raw.text());
    } catch {
      payload = undefined;
    }
  }
  const fallback = status === 404 ? "This record is no longer in the ERP. Refresh the page." : "The QR sticker could not be prepared. Try again.";
  return describeApiError(payload ? { response: { data: payload } } : error, fallback);
}

export function PrintGateQrLabelButton({
  kind,
  id,
  reference,
  size = "sm",
  showHint = true,
  className,
}: {
  kind: GateQrKind;
  /** Saved record id (UUID). Unsaved / preview records get no sticker. */
  id: string | null | undefined;
  /** Shown in the accessible name, e.g. the DC number. */
  reference?: string;
  size?: "sm" | "default";
  showHint?: boolean;
  className?: string;
}) {
  const access = useGateQrLabelAccess();
  const [copies, setCopies] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (access.loading || !access.allowed || !id) return null;

  const print = async () => {
    // Open the tab inside the click so pop-up blockers allow it; fill it once the PDF arrives.
    const win = window.open("", "_blank");
    setBusy(true);
    setError("");
    try {
      const url = await outwardApi.qrLabelObjectUrl(kind, id, copies);
      if (win && !win.closed) {
        win.location.href = url;
      } else {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `gate-qr-${(reference || id).replace(/[^A-Za-z0-9._-]+/g, "-")}.pdf`;
        anchor.click();
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
    } catch (caught) {
      win?.close();
      setError(await stickerErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const compact = size === "sm";
  return (
    <div className={cn("flex flex-col gap-1", className)} data-testid={`gate-qr-sticker-${id}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        <select
          aria-label="Number of QR stickers"
          value={copies}
          disabled={busy}
          onChange={(event) => setCopies(Number(event.target.value))}
          className={cn(
            "rounded-[10px] border border-line bg-surface-1 px-2 text-content-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border",
            compact ? "h-8 text-[12px]" : "h-10 text-[13px]",
          )}
        >
          {Array.from({ length: MAX_COPIES }, (_, index) => index + 1).map((count) => (
            <option key={count} value={count}>
              {count} {count === 1 ? "copy" : "copies"}
            </option>
          ))}
        </select>
        <Button
          type="button"
          size={compact ? "sm" : "default"}
          variant="outline"
          disabled={busy}
          onClick={() => void print()}
          aria-label={`Print QR gate sticker${reference ? ` for ${reference}` : ""}`}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <QrCode className="h-3.5 w-3.5" />}
          {busy ? "Preparing…" : "QR sticker"}
        </Button>
      </div>
      {showHint ? <p className="text-[11.5px] leading-snug text-content-3">{GATE_QR_STICKER_HINT}</p> : null}
      {error ? (
        <p role="alert" className="max-w-[360px] rounded-lg border border-danger-border bg-danger-bg px-2.5 py-1.5 text-[12px] text-danger-fg">
          {error}
        </p>
      ) : null}
    </div>
  );
}

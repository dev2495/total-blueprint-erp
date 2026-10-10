"use client";

import { useState } from "react";
import { Loader2, Printer } from "lucide-react";
import { toast } from "sonner";

import { TonePill } from "@/components/outward/document-rights";
import { Button } from "@/components/ui/button";
import { describeApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { GATE_PASS_STATUS_META, gatePassesApi, type GatePass, type GatePassKind, type GatePassStatus } from "@/services/gate-passes";

export const KIND_HELP: Record<GatePassKind, { short: string; title: string; body: string }> = {
  RETURNABLE: {
    short: "RGP",
    title: "Returnable (RGP)",
    body: "Items come back: repair, calibration, fabrication, trial or loan. The pass stays open until every item is back, or it is short-closed with a reason.",
  },
  NON_RETURNABLE: {
    short: "NRGP",
    title: "Non-returnable (NRGP)",
    body: "Items do not come back: scrap sale, sample or return to supplier. The pass closes when the gate records it leaving.",
  },
};

export function GatePassStatusPill({ gatePass, className }: { gatePass: Pick<GatePass, "status" | "is_overdue" | "days_overdue">; className?: string }) {
  if (gatePass.is_overdue) {
    return <TonePill tone="bad" label={`Overdue ${gatePass.days_overdue} day${gatePass.days_overdue === 1 ? "" : "s"}`} className={className} />;
  }
  const meta = GATE_PASS_STATUS_META[gatePass.status as GatePassStatus];
  return <TonePill tone={meta?.tone ?? "neutral"} label={meta?.label ?? gatePass.status} className={className} />;
}

export function KindBadge({ kind, className }: { kind: GatePassKind; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-bold tracking-[0.04em]",
        kind === "RETURNABLE" ? "border-info-border bg-info-bg text-info-fg" : "border-line bg-surface-2 text-content-2",
        className,
      )}
      title={KIND_HELP[kind].title}
    >
      {KIND_HELP[kind].short}
    </span>
  );
}

/** Opens the authenticated PDF in a new tab (blob URL; no public link). */
export function PrintGatePassButton({ gatePass, variant = "outline" }: { gatePass: Pick<GatePass, "id" | "status" | "display_number">; variant?: "outline" | "default" }) {
  const [busy, setBusy] = useState(false);
  const print = async () => {
    const win = window.open("", "_blank");
    setBusy(true);
    try {
      const url = await gatePassesApi.printObjectUrl(gatePass.id);
      if (win && !win.closed) {
        win.location.href = url;
      } else {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `${gatePass.display_number.replace(/\s+/g, "-")}.pdf`;
        anchor.click();
      }
      window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
    } catch (error) {
      win?.close();
      toast.error(describeApiError(error, "The gate pass PDF could not be prepared."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button type="button" variant={variant} onClick={() => void print()} disabled={busy}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
      {gatePass.status === "DRAFT" ? "Preview PDF" : "Print PDF"}
    </Button>
  );
}

export function itemSummary(gatePass: Pick<GatePass, "lines">) {
  const names = gatePass.lines.map((line) => line.description);
  if (!names.length) return "No items";
  return names.length > 2 ? `${names.slice(0, 2).join(", ")} +${names.length - 2} more` : names.join(", ");
}

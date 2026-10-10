import { cn } from "@/lib/utils";
import type { BillPage } from "@/services/gate-bills";

/* Shared contract types for the bill workspace (SPEC §3.1) and the pop-out viewer. */

export type WorkspaceTone = "neutral" | "info" | "warning" | "success" | "danger";

export type WorkspaceDocument = {
  /** Bill / outward document id (storage key). */
  id: string;
  /** e.g. "Bill 3F2A91C0 · Vee Dee Enterprises" */
  label: string;
  /** Short chip text. */
  statusLabel?: string;
  statusTone?: WorkspaceTone;
  /** e.g. "Arrived 8 Oct, 10:42 · Factory A" */
  meta?: string;
  /** From services/gate-bills (thumb_url, display_rotation, page_kind). */
  pages: BillPage[];
  /** e.g. `/inventory/gate-bills/${id}/view` */
  popoutHref?: string;
};

const TONE_CLASS: Record<WorkspaceTone, string> = {
  neutral: "border-line bg-surface-2 text-content-2",
  info: "border-info-border bg-info-bg text-info-fg",
  warning: "border-warning-border bg-warning-bg text-warning-fg",
  success: "border-success-border bg-success-bg text-success-fg",
  danger: "border-danger-border bg-danger-bg text-danger-fg",
};

export function WorkspaceStatusChip({ label, tone = "neutral", className }: { label?: string; tone?: WorkspaceTone; className?: string }) {
  if (!label) return null;
  return (
    <span className={cn("inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold", TONE_CLASS[tone], className)}>
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {label}
    </span>
  );
}

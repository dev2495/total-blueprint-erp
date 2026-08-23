"use client";

import { ArrowRight, History, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDisplayDateTime } from "@/lib/date-format";

function names(value: unknown): string[] {
  return Array.isArray(value) ? value.map((row) => String(row || "").trim()).filter(Boolean) : [];
}

function ColorLine({ label, colors, muted = false }: { label: string; colors: string[]; muted?: boolean }) {
  return (
    <div className={cn("min-w-0 flex-1 rounded-xl border px-3 py-2", muted ? "border-line bg-surface-2" : "border-warning-border bg-surface-1")}>
      <div className="text-[10px] font-black uppercase tracking-[0.16em] text-content-3">{label}</div>
      <div className={cn("mt-1 break-words text-lg font-black leading-tight", muted ? "text-content-3 line-through decoration-danger-fg/50" : "text-content-1")}>
        {colors.join(" · ") || "None"}
      </div>
    </div>
  );
}

export function PrintColorRevisionNotice({ source, className }: { source: any; className?: string }) {
  const revisionNo = Number(source?.color_revision_no || source?.printing?.color_revision?.revision_no || 0);
  if (!revisionNo) return null;
  const current = names(source?.ink_colors || [
    ...(source?.front_colors || []),
    ...(source?.back_colors || []),
  ]);
  const previous = names([
    ...(source?.previous_front_colors || []),
    ...(source?.previous_back_colors || []),
  ]);
  const reason = String(source?.color_revision_reason || source?.printing?.color_revision?.reason || "").trim();
  const changedBy = String(source?.color_revision_changed_by || source?.printing?.color_revision?.changed_by || "Planner").trim();
  const changedAt = source?.color_revision_changed_at || source?.printing?.color_revision?.changed_at;
  return (
    <section className={cn("rounded-2xl border-2 border-warning-border bg-warning-bg p-4 shadow-sm", className)} data-testid="print-color-revision-notice">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-9 w-9 flex-none place-items-center rounded-xl bg-warning-fg text-white"><TriangleAlert className="h-5 w-5" /></span>
          <div>
            <div className="text-[11px] font-black uppercase tracking-[0.18em] text-warning-fg">Print colors changed after release · v{revisionNo}</div>
            <div className="mt-1 text-sm font-black text-content-1">Use the CURRENT colors below for this job.</div>
          </div>
        </div>
        <div className="text-right text-[10px] font-bold text-content-3">
          <div>{changedBy}</div>
          <div>{changedAt ? formatDisplayDateTime(changedAt) : "Live revision"}</div>
        </div>
      </div>
      <div className="mt-4 flex flex-col items-stretch gap-2 md:flex-row md:items-center">
        <ColorLine label="Previous · do not use" colors={previous} muted />
        <ArrowRight className="mx-auto h-5 w-5 flex-none rotate-90 text-warning-fg md:rotate-0" />
        <ColorLine label="Current · use now" colors={current} />
      </div>
      {reason ? <div className="mt-3 flex items-start gap-2 text-xs font-bold leading-5 text-content-2"><History className="mt-0.5 h-4 w-4 flex-none" /> Reason: {reason}</div> : null}
    </section>
  );
}

"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Chip } from "./chip";

export interface BomLine {
  material_name?: string;
  material_code?: string;
  qty?: number;
  uom?: string;
  kind?: string;
  supply_mode?: "PURCHASED" | "IN_HOUSE" | "BOTH";
}

export interface BomStep {
  step_sequence?: number | null;
  step_name?: string;
  lines?: BomLine[];
  planned_issue_qty?: number;
  theoretical_qty?: number;
}

export interface BomPreviewData {
  bom_by_step?: BomStep[];
  packaging_lines?: BomLine[];
  pod_lines?: BomLine[];
  errors?: string[];
  variant_code?: string | null;
  variant_created?: boolean;
}

export interface BomPreviewPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  data?: BomPreviewData | null;
  loading?: boolean;
  emptyHint?: React.ReactNode;
  sticky?: boolean;
}

const formatQty = (q: number | undefined, uom: string | undefined) => {
  if (q == null || Number.isNaN(q)) return "—";
  const fixed = Math.abs(q) >= 100 ? q.toFixed(0) : q.toFixed(3);
  return `${fixed}${uom ? ` ${uom}` : ""}`;
};

const supplyKind = (mode?: BomLine["supply_mode"]) =>
  mode === "IN_HOUSE" ? "accent" : mode === "BOTH" ? "warn" : "info";

export const BomPreviewPanel = React.forwardRef<HTMLDivElement, BomPreviewPanelProps>(
  ({ className, data, loading, emptyHint, sticky = true, ...props }, ref) => {
    const steps = data?.bom_by_step ?? [];
    const packaging = data?.packaging_lines ?? [];
    const pod = data?.pod_lines ?? [];
    const errors = data?.errors ?? [];

    return (
      <aside
        ref={ref}
        aria-label="BOM preview"
        className={cn(
          "flex flex-col gap-3 overflow-hidden rounded-2xl border border-slate-200 bg-white/80 p-4 backdrop-blur-sm",
          sticky && "sticky top-3",
          className,
        )}
        style={{ width: "var(--workbench-inspector-w, 380px)" }}
        {...props}
      >
        <header className="flex items-center justify-between gap-2">
          <h2 className="font-display text-sm font-semibold text-slate-900">BOM preview</h2>
          {data?.variant_code && (
            <Chip kind={data.variant_created ? "success" : "process"} size="sm" mono>
              {data.variant_code}
            </Chip>
          )}
        </header>

        {loading && (
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" /> Resolving variant…
          </div>
        )}

        {!loading && !data && (
          <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50/60 p-3 text-xs text-slate-500">
            {emptyHint ?? "Pick a product and axes to preview the BOM."}
          </div>
        )}

        {errors.length > 0 && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            <div className="font-semibold">Errors</div>
            <ul className="mt-1 list-disc pl-4">
              {errors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          </div>
        )}

        {steps.length > 0 && (
          <section className="flex flex-col gap-3 overflow-y-auto">
            {steps.map((step, idx) => (
              <div
                key={`${step.step_sequence ?? idx}-${step.step_name ?? idx}`}
                className="rounded-lg border border-slate-100 bg-slate-50/40 p-2.5"
              >
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white">
                      {step.step_sequence ?? idx + 1}
                    </span>
                    <span className="text-[12px] font-semibold text-slate-700">
                      {step.step_name ?? `Step ${idx + 1}`}
                    </span>
                  </div>
                  {step.theoretical_qty != null && (
                    <span className="font-mono-token text-[11px] text-slate-500">
                      {formatQty(step.theoretical_qty, "kg")}
                    </span>
                  )}
                </div>
                <ul className="flex flex-col divide-y divide-slate-100">
                  {(step.lines ?? []).map((line, i) => (
                    <li key={i} className="flex items-center justify-between gap-2 py-1 text-[12px]">
                      <span className="truncate text-slate-700">
                        {line.material_name ?? line.material_code ?? "—"}
                      </span>
                      <span className="font-mono-token tabular-nums text-slate-900">
                        {formatQty(line.qty, line.uom)}
                      </span>
                    </li>
                  ))}
                  {(step.lines ?? []).length === 0 && (
                    <li className="py-1 text-[11px] italic text-slate-400">No components</li>
                  )}
                </ul>
              </div>
            ))}
          </section>
        )}

        {packaging.length > 0 && (
          <section className="rounded-lg border border-violet-100 bg-violet-50/30 p-2.5">
            <div className="mb-1.5 flex items-center gap-2">
              <Chip kind="accent" size="sm">
                Packaging
              </Chip>
              <span className="text-[10px] text-slate-500">{packaging.length} lines</span>
            </div>
            <ul className="flex flex-col divide-y divide-violet-100">
              {packaging.map((line, i) => (
                <li key={i} className="flex items-center justify-between gap-2 py-1 text-[12px]">
                  <span className="flex items-center gap-1.5 truncate">
                    <Chip kind={supplyKind(line.supply_mode)} size="sm">
                      {line.supply_mode ?? "—"}
                    </Chip>
                    <span className="truncate text-slate-700">
                      {line.material_name ?? line.material_code ?? "—"}
                    </span>
                  </span>
                  <span className="font-mono-token tabular-nums text-slate-900">
                    {formatQty(line.qty, line.uom)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {pod.length > 0 && (
          <section className="rounded-lg border border-amber-100 bg-amber-50/30 p-2.5">
            <div className="mb-1.5 flex items-center gap-2">
              <Chip kind="warn" size="sm">
                POD
              </Chip>
              <span className="text-[10px] text-slate-500">{pod.length} lines</span>
            </div>
            <ul className="flex flex-col divide-y divide-amber-100">
              {pod.map((line, i) => (
                <li key={i} className="flex items-center justify-between gap-2 py-1 text-[12px]">
                  <span className="truncate text-slate-700">
                    {line.material_name ?? line.material_code ?? "—"}
                  </span>
                  <span className="font-mono-token tabular-nums text-slate-900">
                    {formatQty(line.qty, line.uom)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </aside>
    );
  },
);
BomPreviewPanel.displayName = "BomPreviewPanel";

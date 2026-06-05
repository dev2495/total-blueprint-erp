"use client";

import {
  AlertTriangle,
  BadgeIndianRupee,
  Lock,
  ShieldAlert,
  Unlock,
} from "lucide-react";

import type { CostingResult } from "@/services/quotation";

interface CostingRailProps {
  result: CostingResult | null;
  isLoading: boolean;
  marginLock: boolean;
  onToggleLock: (locked: boolean) => void;
  manualMargin: number;
  onManualMargin: (v: number) => void;
  manualRate: number;
  onManualRate: (v: number) => void;
  /** Customer floor margin (from cascade). If manualMargin < floor, show warning. */
  floorMargin?: number | null;
  floorSource?: string | null;
}

const SOURCE_LABEL: Record<string, string> = {
  MANUAL: "Manual override",
  CUSTOMER: "Customer overlay",
  POUCH_STYLE: "Pouch style default",
  PLANT: "Plant default",
  COMPANY_DEFAULT: "Company default",
};

function inr(v: number | undefined | null): string {
  if (v === undefined || v === null || !Number.isFinite(v)) return "—";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(v);
}

export default function CostingRail({
  result,
  isLoading,
  marginLock,
  onToggleLock,
  manualMargin,
  onManualMargin,
  manualRate,
  onManualRate,
  floorMargin,
  floorSource,
}: CostingRailProps) {
  const effectiveMargin = Number(
    result?.margin_pct || (marginLock ? manualMargin : 0),
  );
  const floorViolation =
    typeof floorMargin === "number" &&
    floorMargin > 0 &&
    effectiveMargin < floorMargin - 0.01;
  return (
    <aside className="space-y-3">
      {floorViolation ? (
        <div className="rounded-xl border-2 border-danger-border bg-danger-bg p-3 flex items-start gap-2">
          <ShieldAlert
            className="h-4 w-4 text-danger-fg mt-0.5 shrink-0"
            strokeWidth={2.5}
          />
          <div className="text-[12px] font-extrabold text-danger-fg">
            Margin {effectiveMargin.toFixed(1)}% is below{" "}
            {floorSource === "CUSTOMER" ? "customer" : "policy"} floor{" "}
            {floorMargin?.toFixed(1)}%.
            <div className="font-bold text-[11px] text-danger-fg mt-0.5">
              Approval required before sending.
            </div>
          </div>
        </div>
      ) : null}
      {/* Material rows */}
      <div className="rounded-xl border border-line p-4">
        <div className="text-[10px] font-extrabold uppercase tracking-widest text-content-3 mb-2">
          Material cost
        </div>
        <div className="space-y-1.5 text-[12px] font-semibold text-content-2">
          {(result?.breakdown?.materials || []).map((row, idx) => (
            <div key={idx} className="flex items-center justify-between gap-2">
              <span className="truncate">
                <span className="text-[10px] font-extrabold uppercase tracking-widest text-content-4 mr-1">
                  {row.kind || "MAT"}
                </span>
                {row.name}
              </span>
              <span className="font-mono font-extrabold text-content-1">
                ₹ {inr(row.contribution_per_kg)}
              </span>
            </div>
          ))}
          {(!result || result.breakdown?.materials?.length === 0) &&
          !isLoading ? (
            <div className="text-content-4 italic">No materials yet.</div>
          ) : null}
        </div>
        <div className="mt-3 pt-3 border-t border-line flex items-center justify-between">
          <span className="text-[11px] font-extrabold uppercase tracking-widest text-content-3">
            Total ₹/kg
          </span>
          <span className="font-mono font-extrabold text-content-1">
            ₹ {inr(result?.material_cost_per_kg)}
          </span>
        </div>
      </div>

      {/* Conversion */}
      <div className="rounded-xl border border-line p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[10px] font-extrabold uppercase tracking-widest text-content-3">
            Conversion cost
          </div>
          {result?.is_indicative ? (
            <span className="inline-flex items-center gap-1 h-5 px-2 rounded-full text-[9px] font-extrabold uppercase tracking-widest bg-warning-bg text-warning-fg ring-1 ring-warning-border">
              <AlertTriangle className="h-3 w-3" strokeWidth={2.5} />
              Indicative
            </span>
          ) : null}
        </div>
        <div className="space-y-1.5 text-[12px] font-semibold text-content-2">
          {(result?.breakdown?.conversion || []).map((row, idx) => (
            <div key={idx} className="flex items-center justify-between">
              <span className="capitalize">{row.stage}</span>
              <span className="font-mono font-extrabold text-content-1">
                ₹ {inr(row.rate_per_kg)}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-3 pt-3 border-t border-line flex items-center justify-between">
          <span className="text-[11px] font-extrabold uppercase tracking-widest text-content-3">
            Total ₹/kg
          </span>
          <span className="font-mono font-extrabold text-content-1">
            ₹ {inr(result?.conversion_cost_per_kg)}
          </span>
        </div>
      </div>

      {/* Sale rate card */}
      <div className="rounded-xl bg-gradient-to-br from-success-fg to-info-fg text-white p-4 shadow-[0_18px_42px_-24px_rgba(16,185,129,0.6)]">
        <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-widest text-success-border mb-1">
          <BadgeIndianRupee className="h-3.5 w-3.5" />
          Suggested sale rate
        </div>
        <div className="font-mono text-3xl font-extrabold">
          ₹ {inr(result?.suggested_rate)}
        </div>
        <div className="mt-1 text-[11px] font-bold text-success-border">
          Margin {inr(result?.margin_pct)}% · Total cost ₹{" "}
          {inr(result?.total_cost_per_kg)}
        </div>
        {result?.margin_source ? (
          <div className="mt-2 inline-flex items-center h-5 px-2 rounded-full text-[10px] font-extrabold uppercase tracking-widest bg-surface-1/15 ring-1 ring-surface-1/30">
            {SOURCE_LABEL[result.margin_source] || result.margin_source}
          </div>
        ) : null}
      </div>

      {/* Lock toggle + manual overrides */}
      <div className="rounded-xl border border-line p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[10px] font-extrabold uppercase tracking-widest text-content-3">
            Pricing mode
          </div>
          <button
            onClick={() => onToggleLock(!marginLock)}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full bg-surface-2 text-content-2 text-[11px] font-extrabold uppercase tracking-wider hover:bg-line"
          >
            {marginLock ? (
              <Lock className="h-3 w-3" />
            ) : (
              <Unlock className="h-3 w-3" />
            )}
            {marginLock ? "Margin locked" : "Rate locked"}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className={`block ${marginLock ? "" : "opacity-60"}`}>
            <span className="text-[10px] font-extrabold uppercase tracking-widest text-content-3">
              Margin %
            </span>
            <input
              type="number"
              value={manualMargin}
              disabled={!marginLock}
              onChange={(e) => onManualMargin(Number(e.target.value))}
              className="mt-1 h-10 w-full rounded-lg border border-line px-3 text-sm font-bold font-mono text-right outline-none focus:border-order-border focus:ring-2 focus:ring-order-border disabled:bg-surface-2"
            />
          </label>
          <label className={`block ${marginLock ? "opacity-60" : ""}`}>
            <span className="text-[10px] font-extrabold uppercase tracking-widest text-content-3">
              Rate ₹/kg
            </span>
            <input
              type="number"
              value={manualRate}
              disabled={marginLock}
              onChange={(e) => onManualRate(Number(e.target.value))}
              className="mt-1 h-10 w-full rounded-lg border border-line px-3 text-sm font-bold font-mono text-right outline-none focus:border-order-border focus:ring-2 focus:ring-order-border disabled:bg-surface-2"
            />
          </label>
        </div>
      </div>

      {/* Warnings */}
      {result?.warnings && result.warnings.length > 0 ? (
        <div className="rounded-xl border border-warning-border bg-warning-bg p-3 space-y-1">
          {result.warnings.map((w, idx) => (
            <div
              key={idx}
              className="flex items-start gap-2 text-[11px] font-semibold text-warning-fg"
            >
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>{w}</span>
            </div>
          ))}
        </div>
      ) : null}
    </aside>
  );
}

"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Database, ShieldCheck } from "lucide-react";

import type { QuoteLineSpec } from "@/services/quotation";

type CostOverride = NonNullable<QuoteLineSpec["cost_overrides"]>[number];

type CostRow = {
  role: string;
  sequence: number;
  material_id: string;
  code: string;
  name: string;
  qty: number;
  uom: string;
  baseline: number;
  source: string;
  sourceRef: string;
  effectiveAt?: string | null;
  available: number;
};

const number = (value: unknown) => Number(value || 0);
const money = (value: unknown) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(number(value));

function rowsFromSpec(spec: QuoteLineSpec): CostRow[] {
  const rows: CostRow[] = [];
  (spec.layers || []).forEach((row, index) => {
    if (!row.material_id) return;
    rows.push({
      role: "LAYER",
      sequence: index + 1,
      material_id: row.material_id,
      code: row.material_code || "",
      name: row.material_name || row.name || `Layer ${index + 1}`,
      qty: number(row.gsm),
      uom: "GSM",
      baseline: number(row.rate_per_kg),
      source: row.cost_source_type || "SOURCE_REQUIRED",
      sourceRef: row.cost_source_lot_ref || row.cost_source_ref || "",
      effectiveAt: row.cost_source_effective_at,
      available: number(row.cost_available_qty),
    });
  });
  let sequence = 100;
  const groups: Array<[string, Array<Record<string, unknown>>]> = [
    ["ADHESIVE", (spec.adhesives || []) as Array<Record<string, unknown>>],
    ["INK", (spec.inks || []) as Array<Record<string, unknown>>],
    ["SOLVENT", (spec.solvents || []) as Array<Record<string, unknown>>],
    ["ADDITIVE", (spec.additives || []) as Array<Record<string, unknown>>],
  ];
  for (const [role, components] of groups) {
    for (const component of components) {
      sequence += 1;
      if (!component.material_id) continue;
      rows.push({
        role,
        sequence,
        material_id: String(component.material_id),
        code: String(component.material_code || component.code || ""),
        name: String(component.material_name || component.name || role),
        qty: number(component.gsm || component.quantity),
        uom: String(component.uom || "GSM"),
        baseline: number(component.rate_per_kg),
        source: String(component.cost_source_type || "SOURCE_REQUIRED"),
        sourceRef: String(component.cost_source_lot_ref || component.cost_source_ref || ""),
        effectiveAt: component.cost_source_effective_at as string | null | undefined,
        available: number(component.cost_available_qty),
      });
    }
  }
  for (const component of spec.addons || []) {
    sequence += 1;
    if (!component.material_id) continue;
    const raw = component as unknown as Record<string, unknown>;
    rows.push({
      role: "ADDON",
      sequence,
      material_id: component.material_id,
      code: component.material_code || component.code || "",
      name: component.name || "Add-on",
      qty: number(component.qty_per_pouch),
      uom: "PER POUCH",
      baseline: number(component.rate_per_kg),
      source: String(raw.cost_source_type || "SOURCE_REQUIRED"),
      sourceRef: String(raw.cost_source_lot_ref || raw.cost_source_ref || ""),
      effectiveAt: raw.cost_source_effective_at as string | null | undefined,
      available: number(raw.cost_available_qty),
    });
  }
  return rows;
}

export default function LineBomCostEditor({
  spec,
  editable,
  onChange,
}: {
  spec: QuoteLineSpec;
  editable: boolean;
  onChange: (next: CostOverride[]) => void;
}) {
  const [open, setOpen] = useState(true);
  const rows = useMemo(() => rowsFromSpec(spec), [spec]);
  const overrides = spec.cost_overrides || [];
  const findOverride = (row: CostRow) =>
    overrides.find(
      (value) =>
        value.material_id === row.material_id &&
        value.role === row.role &&
        value.sequence === row.sequence,
    );
  const update = (row: CostRow, patch: Partial<CostOverride>) => {
    const current = findOverride(row);
    const rest = overrides.filter(
      (value) =>
        !(
          value.material_id === row.material_id &&
          value.role === row.role &&
          value.sequence === row.sequence
        ),
    );
    const next: CostOverride = {
      material_id: row.material_id,
      role: row.role,
      sequence: row.sequence,
      rate: current?.rate || 0,
      reason: current?.reason || "",
      expires_at: current?.expires_at || "",
      ...patch,
    };
    const hasInput = next.rate > 0 || next.reason.trim() || next.expires_at;
    onChange(hasInput ? [...rest, next] : rest);
  };

  return (
    <section className="mt-4 overflow-hidden rounded-xl border border-line bg-surface-1">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-3 text-left"
        aria-expanded={open}
      >
        <Database className="h-4 w-4 text-order-fg" />
        <div className="flex-1">
          <div className="text-xs font-extrabold text-content-1">BOM material cost</div>
          <div className="text-[10px] font-semibold text-content-4">
            {rows.length} governed component(s) · baseline stays read-only · quote assumption is revision-only
          </div>
        </div>
        <ChevronDown className={`h-4 w-4 text-content-3 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div className="border-t border-line">
          {rows.length === 0 ? (
            <div className="p-3 text-xs font-semibold text-warning-fg">
              Select governed RM components in the specification. No cost can be assumed without a material identity.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-[1040px] w-full text-xs">
                <thead className="bg-surface-2 text-[9px] font-extrabold uppercase tracking-wider text-content-4">
                  <tr>
                    <th className="px-3 py-2 text-left">BOM item</th>
                    <th className="px-3 py-2 text-left">Qty basis</th>
                    <th className="px-3 py-2 text-left">Master/FIFO source</th>
                    <th className="px-3 py-2 text-right">Baseline ₹/kg</th>
                    <th className="px-3 py-2 text-right">Quote ₹/kg</th>
                    <th className="px-3 py-2 text-left">Reason</th>
                    <th className="px-3 py-2 text-left">Valid until</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((row) => {
                    const override = findOverride(row);
                    const missing = row.baseline <= 0;
                    return (
                      <tr key={`${row.role}-${row.sequence}-${row.material_id}`} className="align-top">
                        <td className="px-3 py-2.5">
                          <div className="font-extrabold text-content-1">{row.code || row.name}</div>
                          <div className="text-[9px] font-bold uppercase tracking-wider text-content-4">{row.role} · {row.name}</div>
                        </td>
                        <td className="px-3 py-2.5 font-mono font-bold">{money(row.qty)} {row.uom}</td>
                        <td className="px-3 py-2.5">
                          <div className={`font-mono font-bold ${missing ? "text-warning-fg" : "text-content-2"}`}>{row.source}</div>
                          <div className="text-[10px] text-content-4">{row.sourceRef || "Source required"}</div>
                          <div className="text-[10px] text-content-4">
                            {row.effectiveAt ? new Date(row.effectiveAt).toLocaleDateString("en-IN") : "Effective date required"}
                            {row.available > 0 ? ` · avail ${money(row.available)}` : ""}
                          </div>
                        </td>
                        <td className={`px-3 py-2.5 text-right font-mono font-extrabold ${missing ? "text-warning-fg" : "text-content-1"}`}>
                          {missing ? "Missing" : `₹ ${money(row.baseline)}`}
                        </td>
                        <td className="px-3 py-2.5">
                          <input disabled={!editable} aria-label={`${row.name} quote cost`} type="number" min="0" step="0.01" value={override?.rate || ""} onChange={(event) => update(row, { rate: number(event.target.value) })} placeholder="Optional" className="h-9 w-full rounded-lg border border-line px-2 text-right font-mono disabled:bg-surface-2" />
                        </td>
                        <td className="px-3 py-2.5">
                          <input disabled={!editable} aria-label={`${row.name} override reason`} value={override?.reason || ""} onChange={(event) => update(row, { reason: event.target.value })} placeholder={override?.rate ? "Required" : "—"} className="h-9 w-full rounded-lg border border-line px-2 disabled:bg-surface-2" />
                        </td>
                        <td className="px-3 py-2.5">
                          <input disabled={!editable} aria-label={`${row.name} override expiry`} type="datetime-local" value={override?.expires_at || ""} onChange={(event) => update(row, { expires_at: event.target.value })} className="h-9 w-full rounded-lg border border-line px-2 text-[10px] disabled:bg-surface-2" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex items-start gap-2 border-t border-line bg-info-bg px-3 py-2 text-[10px] font-semibold text-info-fg">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Any quote cost needs reason, actor, validity and approval. It never updates Material Master, FIFO lots or inventory costing.
          </div>
        </div>
      ) : null}
    </section>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, BadgeCheck, Calculator, Database, LockKeyhole, Plus, Save, Trash2 } from "lucide-react";

import { useToast } from "@/hooks/use-toast";
import { quotationService, type CostBuild, type QuotationListItem } from "@/services/quotation";

type ConversionDraft = {
  localId: string;
  category: "PROCESS" | "LABOUR" | "OVERHEAD" | "WASTAGE" | "PACKING" | "FREIGHT" | "OTHER";
  label: string;
  source_type: "PROCESS_RATE" | "QUOTE_OVERRIDE";
  process_cost_rate_id?: string;
  quantity: number;
  uom: string;
  rate: number;
  basis: "PER_HOUR" | "PER_KG" | "FIXED" | "PERCENT";
  percent?: number;
  override_reason?: string;
  override_expires_at?: string;
};

type MaterialOverride = { rate: number; reason: string; expires_at: string };

const money = (value: unknown) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(Number(value || 0));

const uid = () => `cost-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

export default function CostBuildWorkspace({ quote }: { quote: QuotationListItem }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const editable = quote.status === "DRAFT";
  const [definition, setDefinition] = useState<"MARKUP_ON_COST" | "GROSS_MARGIN_ON_SALES">("GROSS_MARGIN_ON_SALES");
  const [target, setTarget] = useState(0);
  const [conversion, setConversion] = useState<ConversionDraft[]>([]);
  const [overrides, setOverrides] = useState<Record<string, MaterialOverride>>({});

  const costQuery = useQuery({
    queryKey: ["quotation", quote.id, "cost-build"],
    queryFn: () => quotationService.getCostBuild(quote.id),
  });
  const ratesQuery = useQuery({
    queryKey: ["costing", "process-rates", "quotation"],
    queryFn: () => quotationService.listProcessCostRates(),
    staleTime: 60_000,
  });

  const result = costQuery.data;
  useEffect(() => {
    if (!result?.id) return;
    setDefinition(result.pricing_definition || "GROSS_MARGIN_ON_SALES");
    setTarget(Number(result.target_percent || 0));
    const saved = (result.components || []).filter((row) => row.category !== "MATERIAL");
    setConversion(
      saved.map((row) => {
        const input = (row.provenance?.input || {}) as Record<string, unknown>;
        return {
          localId: row.id || uid(), category: row.category as ConversionDraft["category"], label: row.label,
          source_type: row.source_type === "PROCESS_RATE" ? "PROCESS_RATE" : "QUOTE_OVERRIDE",
          process_cost_rate_id: String(input.process_cost_rate_id || "") || undefined,
          quantity: Number(row.quote_quantity || 0), uom: row.quote_uom || String(input.uom || ""),
          rate: Number(row.effective_rate || 0), basis: String(row.provenance?.basis || "FIXED") as ConversionDraft["basis"],
          percent: Number(input.percent || 0), override_reason: row.override_reason || "",
          override_expires_at: row.override_expires_at?.slice(0, 16) || "",
        };
      }),
    );
    const next: Record<string, MaterialOverride> = {};
    for (const row of result.components || []) {
      if (row.category === "MATERIAL" && row.material_id && row.override_rate !== null && row.override_rate !== undefined) {
        next[row.material_id] = {
          rate: Number(row.override_rate), reason: row.override_reason || "", expires_at: row.override_expires_at?.slice(0, 16) || "",
        };
      }
    }
    setOverrides(next);
  }, [result?.id, result?.checksum]);

  const saveMutation = useMutation({
    mutationFn: () =>
      quotationService.saveCostBuild(quote.id, {
        pricing_definition: definition,
        target_percent: target,
        discount_amount: quote.discount_amount || 0,
        tax_rate: quote.gst_rate || 0,
        material_overrides: Object.entries(overrides).map(([material_id, value]) => ({ material_id, ...value })),
        conversion_components: conversion.map(({ localId: _localId, ...row }) => row),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(["quotation", quote.id, "cost-build"], data);
      void queryClient.invalidateQueries({ queryKey: ["quotation", quote.id] });
      toast({ title: data.readiness?.ready ? "Cost Build ready" : "Cost Build saved with blockers", description: data.readiness?.ready ? "All sources and commercial gates are ready for approval." : data.readiness?.errors?.[0] });
    },
    onError: (error: Error) => toast({ title: "Cost Build could not be saved", description: error.message, variant: "destructive" }),
  });

  const materials = useMemo(() => (result?.components || []).filter((row) => row.category === "MATERIAL"), [result]);
  const updateConversion = (id: string, patch: Partial<ConversionDraft>) =>
    setConversion((rows) => rows.map((row) => (row.localId === id ? { ...row, ...patch } : row)));

  return (
    <section className="rounded-2xl bg-surface-1 ring-1 ring-line shadow-[0_18px_42px_-34px_rgba(15,23,42,0.32)] overflow-hidden">
      <div className="border-b border-line bg-gradient-to-r from-brand-navy to-order-fg px-5 py-4 text-white">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[0.18em] text-order-border"><Calculator className="h-4 w-4" /> Quote-level Cost Build</div>
            <h3 className="mt-1 text-lg font-extrabold">Every cost has a source, owner and validity</h3>
            <p className="mt-1 max-w-3xl text-xs font-semibold leading-5 text-order-border">RM baselines remain intact. Quote assumptions are separate, reasoned and approved. Conversion Cost is one transparent block, and approval freezes this exact checksum.</p>
          </div>
          <div className="rounded-lg bg-white/10 px-3 py-2 text-right ring-1 ring-white/15">
            <div className="text-[9px] font-extrabold uppercase tracking-widest text-order-border">Snapshot</div>
            <div className="font-mono text-xs font-extrabold">{result?.checksum?.slice(0, 14) || "NOT SAVED"}</div>
          </div>
        </div>
      </div>

      <div className="space-y-5 p-5">
        {result?.readiness ? (
          <div className={`rounded-xl border p-3 ${result.readiness.ready ? "border-success-border bg-success-bg" : "border-warning-border bg-warning-bg"}`}>
            <div className="flex items-center gap-2 text-sm font-extrabold">
              {result.readiness.ready ? <BadgeCheck className="h-4 w-4 text-success-fg" /> : <AlertTriangle className="h-4 w-4 text-warning-fg" />}
              {result.readiness.ready ? "Commercially ready" : `${result.readiness.errors.length} blocking prerequisite(s)`}
            </div>
            {!result.readiness.ready ? <ul className="mt-2 space-y-1 text-xs font-semibold text-warning-fg">{result.readiness.errors.map((error) => <li key={error}>• {error}</li>)}</ul> : null}
          </div>
        ) : null}

        <div>
          <div className="mb-2 flex items-center gap-2"><Database className="h-4 w-4 text-order-fg" /><h4 className="text-sm font-extrabold">Raw materials · master/FIFO baseline versus quote assumption</h4></div>
          {materials.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line p-4 text-xs font-semibold text-content-3">Save quotation lines, then save Cost Build to resolve layer, ink, adhesive, solvent, additive and packing sources. No value is assumed.</div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-line"><table className="min-w-[980px] w-full text-xs">
              <thead className="bg-surface-2 text-[10px] uppercase tracking-wider text-content-3"><tr><th className="px-3 py-2 text-left">Component</th><th className="px-3 py-2 text-left">Source / lot / date</th><th className="px-3 py-2 text-right">Baseline</th><th className="px-3 py-2 text-right">Qty / available</th><th className="px-3 py-2 text-left">Quote assumption</th><th className="px-3 py-2 text-left">State</th></tr></thead>
              <tbody className="divide-y divide-line">{materials.map((row) => {
                const override = row.material_id ? overrides[row.material_id] : undefined;
                return <tr key={`${row.quotation_item_id}-${row.material_id}-${row.role}`} className="align-top">
                  <td className="px-3 py-3"><div className="font-extrabold text-content-1">{row.material_code || row.label}</div><div className="text-[10px] font-bold uppercase tracking-wider text-content-4">{row.role}</div></td>
                  <td className="px-3 py-3"><div className="font-mono font-bold">{row.source_type}</div><div className="text-content-3">{row.source_lot_ref || row.source_ref || "Source required"}</div><div className="text-content-4">{row.source_effective_at ? new Date(row.source_effective_at).toLocaleDateString("en-IN") : "No effective date"}</div></td>
                  <td className="px-3 py-3 text-right font-mono font-extrabold">₹ {money(row.baseline_rate)} / {row.baseline_uom || "—"}</td>
                  <td className="px-3 py-3 text-right font-mono"><b>{money(row.quote_quantity)} {row.quote_uom}</b><div className="text-content-4">avail {money(row.baseline_available_qty)} {row.baseline_uom}</div></td>
                  <td className="px-3 py-3">{editable ? <div className="grid grid-cols-3 gap-1.5">
                    <input aria-label={`${row.label} override rate`} type="number" placeholder="Rate" value={override?.rate ?? ""} onChange={(event) => row.material_id && setOverrides((all) => ({ ...all, [row.material_id!]: { rate: Number(event.target.value), reason: all[row.material_id!]?.reason || "", expires_at: all[row.material_id!]?.expires_at || "" } }))} className="h-8 rounded-md border border-line px-2 font-mono" />
                    <input aria-label={`${row.label} override reason`} placeholder="Reason" value={override?.reason || ""} onChange={(event) => row.material_id && setOverrides((all) => ({ ...all, [row.material_id!]: { rate: all[row.material_id!]?.rate || 0, reason: event.target.value, expires_at: all[row.material_id!]?.expires_at || "" } }))} className="h-8 rounded-md border border-line px-2" />
                    <input aria-label={`${row.label} override expiry`} type="datetime-local" value={override?.expires_at || ""} onChange={(event) => row.material_id && setOverrides((all) => ({ ...all, [row.material_id!]: { rate: all[row.material_id!]?.rate || 0, reason: all[row.material_id!]?.reason || "", expires_at: event.target.value } }))} className="h-8 rounded-md border border-line px-2" />
                  </div> : <span className="font-mono">{row.override_rate ? `₹ ${money(row.override_rate)}` : "No override"}</span>}</td>
                  <td className="px-3 py-3"><span className={`rounded-full px-2 py-1 text-[9px] font-extrabold uppercase tracking-wider ${row.readiness_status === "READY" ? "bg-success-bg text-success-fg" : "bg-warning-bg text-warning-fg"}`}>{row.override_status !== "NOT_REQUIRED" ? row.override_status : row.readiness_status}</span></td>
                </tr>;
              })}</tbody>
            </table></div>
          )}
          <p className="mt-2 text-[11px] font-semibold text-content-4">Quote assumptions never rewrite FIFO, inventory, RM or Material Cost Snapshot records.</p>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between gap-3"><div><h4 className="text-sm font-extrabold">Conversion Cost</h4><p className="text-[11px] font-semibold text-content-4">Machine/process, labour, overhead, wastage/yield, packing, freight and other applicable costs live here together.</p></div>{editable ? <button type="button" onClick={() => setConversion((rows) => [...rows, { localId: uid(), category: "PROCESS", label: "", source_type: "PROCESS_RATE", quantity: 0, uom: "HOUR", rate: 0, basis: "PER_HOUR" }])} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-order-fg px-3 text-xs font-extrabold text-white"><Plus className="h-4 w-4" /> Add component</button> : null}</div>
          <div className="space-y-2">{conversion.map((row) => <div key={row.localId} className="grid grid-cols-2 gap-2 rounded-xl border border-line p-3 md:grid-cols-[130px_1.2fr_1.2fr_90px_90px_1fr_34px]">
            <select disabled={!editable} value={row.category} onChange={(event) => updateConversion(row.localId, { category: event.target.value as ConversionDraft["category"] })} className="h-9 rounded-lg border border-line px-2 text-xs font-bold">{["PROCESS","LABOUR","OVERHEAD","WASTAGE","PACKING","FREIGHT","OTHER"].map((category) => <option key={category}>{category}</option>)}</select>
            <input disabled={!editable} placeholder="Component label" value={row.label} onChange={(event) => updateConversion(row.localId, { label: event.target.value })} className="h-9 rounded-lg border border-line px-2 text-xs font-semibold" />
            <select disabled={!editable} value={row.source_type} onChange={(event) => updateConversion(row.localId, { source_type: event.target.value as ConversionDraft["source_type"] })} className="h-9 rounded-lg border border-line px-2 text-xs font-bold"><option value="PROCESS_RATE">Process Rate Master</option><option value="QUOTE_OVERRIDE">Quote-only assumption</option></select>
            <input disabled={!editable} aria-label={`${row.label} quantity`} type="number" placeholder="Qty" value={row.quantity || ""} onChange={(event) => updateConversion(row.localId, { quantity: Number(event.target.value) })} className="h-9 rounded-lg border border-line px-2 text-right font-mono text-xs" />
            <input disabled={!editable || row.source_type === "PROCESS_RATE"} aria-label={`${row.label} rate`} type="number" placeholder="Rate" value={row.rate || ""} onChange={(event) => updateConversion(row.localId, { rate: Number(event.target.value) })} className="h-9 rounded-lg border border-line px-2 text-right font-mono text-xs" />
            {row.source_type === "PROCESS_RATE" ? <select disabled={!editable} value={row.process_cost_rate_id || ""} onChange={(event) => updateConversion(row.localId, { process_cost_rate_id: event.target.value })} className="h-9 rounded-lg border border-line px-2 text-xs font-semibold"><option value="">Select rate source</option>{(ratesQuery.data || []).filter((rate) => rate.is_active).map((rate) => <option key={rate.id} value={rate.id}>{rate.process_code} · {rate.machine_code || "all machines"} · ₹{money(rate.cost_per_hour)}/hr</option>)}</select> : <div className="grid grid-cols-2 gap-1"><input disabled={!editable} placeholder="Reason" value={row.override_reason || ""} onChange={(event) => updateConversion(row.localId, { override_reason: event.target.value })} className="h-9 rounded-lg border border-line px-2 text-xs" /><input disabled={!editable} type="datetime-local" value={row.override_expires_at || ""} onChange={(event) => updateConversion(row.localId, { override_expires_at: event.target.value })} className="h-9 rounded-lg border border-line px-2 text-[10px]" /></div>}
            {editable ? <button aria-label={`Remove ${row.label || "component"}`} type="button" onClick={() => setConversion((rows) => rows.filter((item) => item.localId !== row.localId))} className="inline-flex h-9 items-center justify-center rounded-lg text-danger-fg hover:bg-danger-bg"><Trash2 className="h-4 w-4" /></button> : <span />}
          </div>)}</div>
        </div>

        <div className="grid gap-3 rounded-xl border border-line bg-surface-2 p-4 md:grid-cols-4">
          <label className="text-[10px] font-extrabold uppercase tracking-wider text-content-3">Definition<select disabled={!editable} value={definition} onChange={(event) => setDefinition(event.target.value as typeof definition)} className="mt-1 h-10 w-full rounded-lg border border-line bg-surface-1 px-2 text-xs font-bold"><option value="GROSS_MARGIN_ON_SALES">Gross margin on net sales</option><option value="MARKUP_ON_COST">Markup on cost</option></select></label>
          <label className="text-[10px] font-extrabold uppercase tracking-wider text-content-3">Target %<input disabled={!editable} type="number" value={target} onChange={(event) => setTarget(Number(event.target.value))} className="mt-1 h-10 w-full rounded-lg border border-line bg-surface-1 px-3 text-right font-mono text-sm" /></label>
          <Metric label="Target price" value={`₹ ${money(result?.target_price)}`} />
          <Metric label="Actual line price" value={`₹ ${money(result?.list_price)}`} />
        </div>

        <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
          <Metric label="RM cost" value={`₹ ${money(result?.material_cost)}`} />
          <Metric label="Conversion" value={`₹ ${money(result?.conversion_cost)}`} />
          <Metric label="Total cost" value={`₹ ${money(result?.total_cost)}`} />
          <Metric label="Contribution" value={`₹ ${money(result?.contribution)}`} />
          <Metric label="Markup" value={`${money(result?.markup_pct)}%`} />
          <Metric label="Gross margin" value={`${money(result?.gross_margin_pct)}%`} />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-content-3"><LockKeyhole className="h-4 w-4" /> Approval freezes component sources, quantities, rates, overrides, calculation method and checksum.</div>
          {editable ? <button type="button" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()} className="inline-flex h-10 items-center gap-2 rounded-xl bg-success-fg px-4 text-xs font-extrabold uppercase tracking-wider text-white disabled:opacity-50"><Save className="h-4 w-4" /> {saveMutation.isPending ? "Resolving sources…" : "Save Cost Build"}</button> : null}
        </div>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-line bg-surface-1 p-3"><div className="text-[9px] font-extrabold uppercase tracking-widest text-content-4">{label}</div><div className="mt-1 font-mono text-sm font-extrabold text-content-1">{value}</div></div>;
}

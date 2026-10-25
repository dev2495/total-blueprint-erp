"use client";

import * as React from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, CircleCheck, PackageOpen, Scale, Send, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { JobNameTag } from "@/components/spine/job-name-tag";
import {
  Pill,
  SelectBox,
  apiError as err,
  clean,
  kgText as kg,
  lineScopeKey,
  lineScopeName,
  lineScopeSpec,
  micronText,
  num as n,
  parseLayers,
} from "@/components/logistics/yard-ui";
import { logisticsService, type Gonny, type PackingCheckSummary, type SOPackingSummary } from "@/services/logistics";
import type { PackagingMaterial } from "@/services/master-data";
import { inchesText, withInches } from "@/lib/size-naming";

/* ------------------------------------------------------------------ */
/* Order lines in the yard                                             */
/* ------------------------------------------------------------------ */

type Batch = SOPackingSummary["batches"][number];

export type PackLine = {
  /** Unique across orders: `${orderId}::${key}`. */
  uid: string;
  key: string;
  orderId: string;
  orderNumber: string;
  jobName: string;
  customer: string;
  index: number;
  name: string;
  spec: string;
  sample: any;
  batches: Batch[];
  gonnies: Gonny[];
  rolls: any[];
};

/** Every sales-order line with units in the yard, in the order they first appear. */
export function packLinesOf(summary?: SOPackingSummary): PackLine[] {
  if (!summary) return [];
  const lines = new Map<string, PackLine>();
  const lineFor = (row: any, fallback: string, fallbackName: string) => {
    const key = lineScopeKey(row, fallback);
    let line = lines.get(key);
    if (!line) {
      line = {
        uid: `${summary.sales_order.id}::${key}`,
        key,
        orderId: String(summary.sales_order.id),
        orderNumber: summary.sales_order.order_number,
        jobName: String((summary.sales_order as any).job_name || ""),
        customer: summary.sales_order.customer_name,
        index: Number(summary.line_numbers?.[clean(row?.sales_order_item_id)] || 0) || lines.size + 1,
        name: lineScopeName(row, fallbackName),
        spec: lineScopeSpec(row),
        sample: row,
        batches: [],
        gonnies: [],
        rolls: [],
      };
      lines.set(key, line);
    }
    return line;
  };
  (summary.batches || []).forEach((row) => lineFor(row, `BATCH-${row.id}`, "Pouch product").batches.push(row));
  (summary.gonnies || []).forEach((row) => lineFor(row, `GONNY-${row.id}`, "Pouch product").gonnies.push(row));
  (summary.rolls || []).forEach((row) => lineFor(row, `ROLL-${row.id}`, "Roll product").rolls.push(row));
  return Array.from(lines.values()).sort((a, b) => a.index - b.index);
}

export const gonnyStage = (gonny: Gonny) =>
  gonny.released_to_dispatch ? "RELEASED" : gonny.gross_weight_kg ? "SEALED" : "OPEN";

/** What is left to do on one line, in the order the yard does it. */
export function packLineState(line: PackLine) {
  const pendingPcs = line.batches.reduce((sum, batch) => sum + Number(batch.qty_pcs || 0), 0);
  const open = line.gonnies.filter((g) => gonnyStage(g) === "OPEN");
  const sealed = line.gonnies.filter((g) => gonnyStage(g) === "SEALED");
  const releasedGonnies = line.gonnies.filter((g) => gonnyStage(g) === "RELEASED");
  const openRolls = line.rolls.filter((roll) => !roll.released_to_dispatch);
  const releasedRolls = line.rolls.filter((roll) => roll.released_to_dispatch);
  const todo = line.batches.length + open.length + sealed.length + openRolls.length;
  const kind: "POUCH" | "ROLL" | "MIXED" = line.rolls.length
    ? line.batches.length || line.gonnies.length
      ? "MIXED"
      : "ROLL"
    : "POUCH";
  const label = !todo
    ? "All released"
    : line.batches.length
      ? `${n(pendingPcs, 0)} pcs to pack`
      : open.length
        ? `Weigh ${open.length} open`
        : sealed.length
          ? `Release ${sealed.length} sealed`
          : `${openRolls.length} roll${openRolls.length === 1 ? "" : "s"} to release`;
  const tone = !todo ? ("good" as const) : line.batches.length || openRolls.length ? ("warn" as const) : open.length ? ("info" as const) : ("accent" as const);
  return {
    pendingPcs,
    open,
    sealed,
    releasedGonnies,
    openRolls,
    releasedRolls,
    released: releasedGonnies.length + releasedRolls.length,
    todo,
    kind,
    label,
    tone,
  };
}

const trimNum = (value: string) => String(Math.round(Number(value) * 10) / 10);

/** "254 × 254" + "10 × 10 in" from a size code (254X254, 140X305G40), a label (140 × 305 mm) or a roll width. */
export function sizeParts(row: any, isRoll: boolean): { metric: string; imperial: string; unit: string } {
  const label = clean(row?.size_label);
  if (isRoll) {
    const width = Number(row?.width_mm || 0) || Number((label.match(/\d+(?:\.\d+)?/) || [])[0] || 0);
    return width ? { metric: trimNum(String(width)), imperial: inchesText(width), unit: "mm web" } : { metric: "", imperial: "", unit: "" };
  }
  const pair = label.match(/(\d+(?:\.\d+)?)\s*(?:mm)?\s*[xX×]\s*(\d+(?:\.\d+)?)(?:\s*mm)?(?:\s*(?:\+|G)\s*(\d+(?:\.\d+)?))?/);
  if (pair) {
    const [, w, h, g] = pair;
    return {
      metric: `${trimNum(w)} × ${trimNum(h)}${g ? ` + ${trimNum(g)} G` : ""}`,
      imperial: inchesText(w, h),
      unit: "mm",
    };
  }
  const [metric, imperial] = withInches(label).split(" · ");
  return { metric: metric || "", imperial: imperial || "", unit: "" };
}

/* ------------------------------------------------------------------ */
/* Packing plan                                                        */
/* ------------------------------------------------------------------ */

export type PackingPlan = {
  content_mode: "PRIMARY_PACKS" | "LOOSE_POUCHES";
  packed_at_machine: boolean;
  pcs_per_pack: number | null;
  packs_left: number | null;
  pcs_left: number;
  net_kg_per_pcs: number;
  inner_pouch: { id: string; code: string; name: string; weight_kg: number | null; weight_source: string } | null;
  gonny: { id: string; code: string; name: string; weight_kg: number | null; weight_source: string } | null;
};

/** The batch's packing plan from the API, or the same facts from the batch's own fields. */
export function packingPlanOf(batch: any): PackingPlan {
  if (batch?.packing_plan) return batch.packing_plan as PackingPlan;
  const pcsPerPack = Number(batch?.pcs_per_pack || 0) || null;
  const inner = batch?.default_content_mode === "PRIMARY_PACKS" || Boolean(batch?.primary_pack_enabled);
  const qty = Number(batch?.qty_pcs || 0);
  return {
    content_mode: inner ? "PRIMARY_PACKS" : "LOOSE_POUCHES",
    packed_at_machine: false,
    pcs_per_pack: pcsPerPack,
    packs_left: inner && pcsPerPack ? Math.ceil(qty / pcsPerPack) : null,
    pcs_left: qty,
    net_kg_per_pcs: qty > 0 ? Number(batch?.qty_kg || 0) / qty : 0,
    inner_pouch: null,
    gonny: null,
  };
}

/** Net kg still in a batch: pieces left × the plan's net per pouch (the batch's logged kg covers pouches already packed too). */
export function batchNetKg(batch: any) {
  const plan = packingPlanOf(batch);
  const perPc = Number(plan.net_kg_per_pcs || 0);
  return perPc ? Number(batch?.qty_pcs || 0) * perPc : Number(batch?.qty_kg || 0);
}

export function getGonnyExpected(gonny: Gonny) {
  return Number(
    gonny.expected_gross_weight_kg ??
      gonny.tare_breakdown_json?.expected_gross_weight_kg ??
      gonny.tare_breakdown_json?.gross_weight_kg ??
      0,
  );
}

export function getGonnyTare(gonny: Gonny) {
  const explicit =
    Number(gonny.inner_pack_tare_kg || 0) + Number(gonny.secondary_pack_tare_kg || 0) + Number(gonny.extras_tare_kg || 0);
  const gross = Number(gonny.gross_weight_kg || 0);
  const net = Number(gonny.net_product_weight_kg || 0);
  return explicit || (gross && net ? Math.max(0, gross - net) : 0);
}

const gonnyWeight = (item: PackagingMaterial) =>
  (item as any).stock_measure?.weight_kg_per_piece as number | null | undefined;

/* ------------------------------------------------------------------ */
/* Evening-count items                                                 */
/* ------------------------------------------------------------------ */

/** Evening-count packing items used: tick what was used, no quantities. Planned items come first. */
export function EodItemChecks({
  materials,
  selectedIds,
  onToggle,
  testIdPrefix,
  planIds = [],
  disabled,
}: {
  materials: PackagingMaterial[];
  selectedIds: string[];
  onToggle: (material: PackagingMaterial) => void;
  testIdPrefix: string;
  planIds?: string[];
  disabled?: boolean;
}) {
  const planned = new Set(planIds.filter(Boolean));
  const ordered = [...materials].sort(
    (a, b) =>
      Number(planned.has(String(b.id))) - Number(planned.has(String(a.id))) || String(a.code).localeCompare(String(b.code)),
  );
  if (!ordered.length) {
    return (
      <div className="rounded-xl border border-warning-border bg-warning-bg p-3 text-[12.5px] text-warning-fg">
        No active packing items. Add them in Masters › Packaging.
      </div>
    );
  }
  return (
    <div className="grid gap-1.5 sm:grid-cols-2" role="group" aria-label="Packing items used">
      {ordered.map((material) => {
        const id = String(material.id || "");
        const checked = selectedIds.includes(id);
        return (
          <label
            key={id}
            data-testid={`${testIdPrefix}-${id}`}
            className={cn(
              "flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-xl border px-2.5 py-1.5 text-left transition-colors",
              checked ? "border-success-border bg-success-bg" : "border-line bg-surface-1 hover:border-line-strong",
              disabled && "cursor-not-allowed opacity-60",
            )}
          >
            <input
              type="checkbox"
              className="h-5 w-5 shrink-0 accent-[rgb(var(--success-fg-rgb))]"
              checked={checked}
              disabled={disabled}
              onChange={() => onToggle(material)}
            />
            <span className="min-w-0">
              <span className="block truncate text-[12.5px] font-semibold text-content-1">{material.code}</span>
              <span className="block truncate text-[11.5px] text-content-3">
                {material.name || "Packing item"}
                {planned.has(id) ? " · on this order's list" : ""}
              </span>
            </span>
          </label>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The dialog                                                          */
/* ------------------------------------------------------------------ */

type LineDraft = {
  batchId: string;
  packs: string;
  pcs: string;
  gonnyMaterialId: string;
  /** Gross on the scale for the gonny being added (empty = add it open). */
  gross: string;
  reason: string;
  /** "Figures checked" on step 1. */
  confirmed: boolean;
  marks: string[];
  rollIds: string[] | null;
  rollMode: "PACKED" | "UNPACKED";
  rollMarks: string[] | null;
};

type SealDraft = { gross: string; reason: string };

function Step({
  no,
  title,
  hint,
  right,
  done,
  children,
  testId,
}: {
  no: number;
  title: string;
  hint?: React.ReactNode;
  right?: React.ReactNode;
  done?: boolean;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <section className="rounded-2xl border border-line bg-surface-1" data-testid={testId}>
      <header className="flex items-start gap-2.5 border-b border-line px-3.5 py-2.5">
        <span
          className={cn(
            "mt-px grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px] font-bold",
            done ? "bg-success-fg text-white" : "bg-content-1 text-surface-1",
          )}
          aria-hidden
        >
          {done ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : no}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[13.5px] font-semibold text-content-1">{title}</h3>
          {hint ? <p className="mt-0.5 text-[11.5px] leading-snug text-content-3">{hint}</p> : null}
        </div>
        {right ? <div className="shrink-0">{right}</div> : null}
      </header>
      <div className="p-3">{children}</div>
    </section>
  );
}

function plannedDefaults(batch: Batch | undefined, gonnyMasters: PackagingMaterial[]) {
  if (!batch) return { packs: "", pcs: "", gonnyMaterialId: gonnyMasters.length === 1 ? String(gonnyMasters[0].id) : "" };
  const plan = packingPlanOf(batch);
  const inner = plan.content_mode === "PRIMARY_PACKS";
  let packs = "";
  let pcs = String(batch.qty_pcs || "");
  if (inner && plan.pcs_per_pack) {
    const left = Math.max(0, Number(plan.packs_left ?? Math.ceil(Number(batch.qty_pcs || 0) / plan.pcs_per_pack)));
    packs = String(left || "");
    pcs = String(Math.min(left * plan.pcs_per_pack, Number(batch.qty_pcs || 0)) || "");
  }
  const planned = plan.gonny?.id && gonnyMasters.some((item) => String(item.id) === plan.gonny!.id) ? plan.gonny.id : "";
  return {
    packs,
    pcs,
    gonnyMaterialId: planned || (gonnyMasters.length === 1 ? String(gonnyMasters[0].id) : ""),
  };
}

export function PackLinesDialog({
  open,
  onOpenChange,
  summaries,
  lineKeys,
  gonnyMasters,
  markMasters,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  summaries: SOPackingSummary[];
  /** Line uids (`${orderId}::${lineKey}`), in tab order; lines may come from several orders. */
  lineKeys: string[];
  gonnyMasters: PackagingMaterial[];
  markMasters: PackagingMaterial[];
  onChanged: () => Promise<unknown> | void;
}) {
  const { toast } = useToast();
  const allLines = React.useMemo(() => summaries.flatMap((summary) => packLinesOf(summary)), [summaries]);
  const lines = React.useMemo(
    () => lineKeys.map((key) => allLines.find((line) => line.uid === key)).filter(Boolean) as PackLine[],
    [allLines, lineKeys],
  );
  const orderIds = Array.from(new Set(lines.map((line) => line.orderId)));
  const singleOrder = orderIds.length <= 1;
  const [activeKey, setActiveKey] = React.useState("");
  const [drafts, setDrafts] = React.useState<Record<string, LineDraft>>({});
  const [seals, setSeals] = React.useState<Record<string, SealDraft>>({});
  const [focusGonnyId, setFocusGonnyId] = React.useState("");
  const checks = useQuery({
    queryKey: ["packing-check-queue", "ALL"],
    queryFn: ({ signal }) => logisticsService.getPackingCheckQueue(undefined, signal),
    enabled: open,
    refetchInterval: 30_000,
  });
  const checkByBatch = React.useMemo(() => {
    const map = new Map<string, PackingCheckSummary>();
    (checks.data || []).forEach((row) => map.set(String(row.fg_batch_id), row));
    return map;
  }, [checks.data]);

  React.useEffect(() => {
    if (!open) return;
    if (!lineKeys.includes(activeKey)) setActiveKey(lineKeys[0] || "");
  }, [open, lineKeys, activeKey]);
  React.useEffect(() => {
    if (!open) {
      setDrafts({});
      setSeals({});
      setFocusGonnyId("");
    }
  }, [open]);

  const draftOf = (line: PackLine): LineDraft => {
    const saved = drafts[line.uid];
    const batch = line.batches.find((row) => row.id === saved?.batchId) || line.batches[0];
    if (saved && (saved.batchId === (batch?.id || "") || !batch)) return saved;
    const defaults = plannedDefaults(batch, gonnyMasters);
    return {
      batchId: batch?.id || "",
      packs: defaults.packs,
      pcs: defaults.pcs,
      gonnyMaterialId: saved?.gonnyMaterialId || defaults.gonnyMaterialId,
      gross: saved?.gross || "",
      reason: saved?.reason || "",
      confirmed: saved?.confirmed || false,
      marks: saved?.marks || [],
      rollIds: saved?.rollIds ?? null,
      rollMode: saved?.rollMode || "PACKED",
      rollMarks: saved?.rollMarks ?? null,
    };
  };
  const patchDraft = (line: PackLine, patch: Partial<LineDraft>) =>
    setDrafts((prev) => ({ ...prev, [line.uid]: { ...draftOf(line), ...patch } }));


  const markLines = (ids: string[], basis?: string) =>
    ids.map((materialId) => ({
      material_id: materialId,
      qty: 0,
      uom: markMasters.find((m) => String(m.id) === materialId)?.base_uom || "PCS",
      ...(basis ? { basis } : {}),
    }));

  // Pack one gonny; when the gross is already on the scale it is sealed in the same step.
  const createMutation = useMutation({
    mutationFn: async (input: {
      line: PackLine;
      batch: Batch;
      pcs: number;
      packs?: number;
      gonnyMaterialId: string;
      contentMode: "PRIMARY_PACKS" | "LOOSE_POUCHES";
      gross?: number;
      reason?: string;
    }) => {
      const created = await logisticsService.createGonny({
        fgBatchId: input.batch.id,
        qtyPcs: input.pcs,
        gonnyMaterialId: input.gonnyMaterialId,
        contentMode: input.contentMode,
        primaryPackCount: input.packs,
      });
      if (!input.gross) return { created, sealed: false, sealError: "" };
      try {
        await logisticsService.sealGonny(created.id, input.gross, [], input.reason || "");
        return { created, sealed: true, sealError: "" };
      } catch (error) {
        return { created, sealed: false, sealError: err(error) };
      }
    },
    onSuccess: async (result, input) => {
      if (result.sealError) {
        toast({
          title: `${result.created.label_id} packed, not sealed`,
          description: `${result.sealError} Weigh it again in the list below.`,
          variant: "destructive",
        });
      } else {
        toast({
          title: result.sealed ? "Gonny packed and sealed" : "Gonny packed",
          description: result.sealed ? `${result.created.label_id} is ready to release.` : `${result.created.label_id} · weigh it to seal.`,
        });
      }
      setDrafts((prev) => {
        const next = { ...prev };
        if (next[input.line.uid]) next[input.line.uid] = { ...next[input.line.uid], batchId: "", gross: "", reason: "" };
        return next;
      });
      if (!result.sealed) setFocusGonnyId(String(result.created.id));
      await onChanged();
    },
    onError: (error) => toast({ title: "Pack failed", description: err(error), variant: "destructive" }),
  });

  const sealMutation = useMutation({
    mutationFn: (input: { gonny: Gonny; gross: number; reason: string }) =>
      logisticsService.sealGonny(input.gonny.id, input.gross, [], input.reason),
    onSuccess: async (data, input) => {
      toast({ title: "Gonny sealed", description: data.message });
      setSeals((prev) => {
        const next = { ...prev };
        delete next[input.gonny.id];
        return next;
      });
      await onChanged();
    },
    onError: (error) => toast({ title: "Seal failed", description: err(error), variant: "destructive" }),
  });

  const releaseLine = async (line: PackLine) => {
    const draft = draftOf(line);
    const state = packLineState(line);
    let units = 0;
    if (state.sealed.length) {
      const lines = markLines(draft.marks);
      for (const gonny of state.sealed) {
        await logisticsService.releaseGonny(gonny.id, lines);
        units += 1;
      }
    }
    const roll = rollChoice(line, draft);
    if (roll.ids.length && roll.valid) {
      const lines = roll.mode === "PACKED" ? markLines(roll.marks, "MARKED_AT_RELEASE") : [];
      if (roll.ids.length > 1) await logisticsService.releaseRolls(roll.ids, roll.mode, lines);
      else await logisticsService.releaseRoll(roll.ids[0], roll.mode, lines);
      units += roll.ids.length;
    }
    return units;
  };

  const releaseMutation = useMutation({
    mutationFn: async (targets: PackLine[]) => {
      let units = 0;
      let done = 0;
      try {
        for (const line of targets) {
          units += await releaseLine(line);
          done += 1;
        }
      } catch (error) {
        throw Object.assign(new Error(err(error)), { done, units });
      }
      return { units, done };
    },
    onSuccess: async ({ units, done }) => {
      toast({
        title: "Released to Dispatch Bay",
        description: `${done} line${done === 1 ? "" : "s"} · ${units} unit${units === 1 ? "" : "s"}. Each line goes on its own dispatch slip and shows in History.`,
      });
      await onChanged();
    },
    onError: async (error: any) => {
      toast({
        title: error?.done ? `${error.done} line${error.done === 1 ? "" : "s"} released, then stopped` : "Release failed",
        description: error?.message || err(error),
        variant: "destructive",
      });
      await onChanged();
    },
  });

  const busy = createMutation.isPending || sealMutation.isPending || releaseMutation.isPending;
  const active = lines.find((line) => line.uid === activeKey) || lines[0];
  const order = singleOrder ? lines[0] : undefined;
  const allDone = lines.length > 0 && lines.every((line) => packLineState(line).todo === 0);
  const readyToRelease = lines.filter((line) => lineReleasable(line, draftOf(line)));
  const allReady = lines.length > 1 && lines.every((line) => packLineState(line).todo === 0 || lineReleasable(line, draftOf(line)));

  return (
    <Dialog open={open} onOpenChange={(next) => (!busy || next ? onOpenChange(next) : undefined)}>
      <DialogContent
        data-testid="packing-pack-dialog"
        className="flex h-[min(94dvh,880px)] w-[calc(100vw-16px)] max-w-[1180px] flex-col gap-0 overflow-hidden p-0"
      >
        <DialogHeader className="space-y-0 px-4 pb-0 pt-3.5 text-left sm:px-5">
          <DialogTitle className="flex flex-wrap items-center gap-x-2 gap-y-1 pr-10 text-[17px]">
            Pack {lines.length > 1 ? `${lines.length} lines` : "line"} ·
            {order ? (
              <>
                {order.jobName ? (
                  <span className="inline-flex items-center gap-1">
                    <span className="rounded bg-order-bg px-1 py-px text-[9.5px] font-bold uppercase tracking-[0.08em] text-order-fg ring-1 ring-order-border">
                      Job
                    </span>
                    <span className="font-bold">{order.jobName}</span>
                  </span>
                ) : null}
                <span className="font-mono text-[13px] font-semibold text-content-2">{order.orderNumber}</span>
                <span className="text-[14px] font-medium text-content-2">· {order.customer}</span>
              </>
            ) : (
              <span className="text-[14px] font-medium text-content-2">{orderIds.length} orders</span>
            )}
          </DialogTitle>
          <DialogDescription className="text-[12px]">
            One tab per line. Confirm the machine&apos;s figures, build and weigh gonnies, tick the packing items used,
            release. Each line goes to Dispatch Bay as its own dispatch unit(s) and <b>its own slip</b>.
          </DialogDescription>
          <div className="-mx-1 mt-2.5 flex gap-1 overflow-x-auto px-1" role="tablist" aria-label="Lines to pack">
            {lines.map((line) => {
              const state = packLineState(line);
              const selected = line.uid === active?.uid;
              const metric = sizeTitle(line);
              const total = state.pendingPcs + line.gonnies.reduce((sum, g) => sum + Number(g.qty_pcs || 0), 0);
              const packedPct = state.kind === "ROLL"
                ? line.rolls.length ? Math.round((state.releasedRolls.length / line.rolls.length) * 100) : 0
                : total ? Math.round(((total - state.pendingPcs) / total) * 100) : 0;
              return (
                <button
                  key={line.uid}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  data-testid={`packing-pack-tab-${line.index}`}
                  onClick={() => setActiveKey(line.uid)}
                  className={cn(
                    "relative grid min-h-[52px] min-w-[190px] max-w-[280px] shrink-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 rounded-t-xl border border-b-0 px-3 pb-1.5 pt-1.5 text-left transition-colors",
                    selected ? "border-line bg-surface-2 text-content-1" : "border-transparent text-content-3 hover:bg-surface-2/60",
                  )}
                >
                  <span className="row-span-2 grid h-7 min-w-7 place-items-center rounded-md border border-line-strong bg-surface-1 px-1 font-mono text-[11.5px] font-bold text-content-1">
                    L{line.index}
                  </span>
                  <span className="truncate text-[12.5px] font-semibold">
                    {!singleOrder ? `${line.orderNumber.replace(/^SO-\d{4}-/, "SO ")} · ` : ""}
                    {metric || line.name}
                  </span>
                  <span className="flex min-w-0 items-center gap-1.5 text-[11px]">
                    <span
                      className={cn(
                        "h-1.5 w-1.5 shrink-0 rounded-full",
                        !state.todo ? "bg-success-fg" : state.released || state.sealed.length || state.open.length ? "bg-warning-fg" : "bg-content-4",
                      )}
                      aria-hidden
                    />
                    <span className={cn("truncate", !state.todo ? "text-success-fg" : "text-content-3")}>
                      {!state.todo ? "Released" : state.open.length + state.sealed.length ? `${state.open.length + state.sealed.length} gonnies · ${state.label}` : state.label}
                    </span>
                  </span>
                  <span className="col-span-2 mt-1 h-1 overflow-hidden rounded-full bg-surface-2">
                    <span className={cn("block h-full rounded-full", packedPct >= 100 ? "bg-success-fg" : "bg-primary")} style={{ width: `${packedPct}%` }} />
                  </span>
                </button>
              );
            })}
          </div>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-surface-2 px-3 py-3 sm:px-4" role="tabpanel">
          {active ? (
            <LineWorkspace
              key={active.uid}
              line={active}
              showOrder={!singleOrder}
              draft={draftOf(active)}
              patchDraft={(patch) => patchDraft(active, patch)}
              seals={seals}
              setSeal={(id, patch) =>
                setSeals((prev) => ({ ...prev, [id]: { ...(prev[id] || { gross: "", reason: "" }), ...patch } }))
              }
              focusGonnyId={focusGonnyId}
              gonnyMasters={gonnyMasters}
              markMasters={markMasters}
              checkByBatch={checkByBatch}
              busy={busy}
              onPack={(input) => createMutation.mutate({ line: active, ...input })}
              packing={createMutation.isPending}
              onSeal={(gonny, gross, reason) => sealMutation.mutate({ gonny, gross, reason })}
              sealingId={sealMutation.isPending ? sealMutation.variables?.gonny.id || "" : ""}
              onRelease={() => releaseMutation.mutate([active])}
              releasing={releaseMutation.isPending}
            />
          ) : (
            <div className="grid h-full place-items-center text-[13px] text-content-3">These lines have nothing left in the yard.</div>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-surface-1 px-4 py-2.5 sm:px-5">
          <div className="flex items-center gap-1.5 text-[12px] text-content-3">
            {allDone ? (
              <>
                <CircleCheck className="h-4 w-4 text-success-fg" aria-hidden /> Every line is released. They are in History and in
                Dispatch Bay.
              </>
            ) : allReady ? (
              <>
                <CircleCheck className="h-4 w-4 text-success-fg" aria-hidden /> Every tab is ready: release them all at once, or one by one.
              </>
            ) : (
              <>Release each line from its tab, or finish every tab to release all at once.</>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              data-testid="packing-pack-close"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              {allDone ? "Done" : "Close"}
            </Button>
            {lines.length > 1 && !allDone ? (
              <Button
                type="button"
                data-testid="packing-release-all"
                disabled={!allReady || !readyToRelease.length || busy}
                onClick={() => releaseMutation.mutate(readyToRelease)}
              >
                <Send className="mr-1.5 h-4 w-4" aria-hidden /> Release all {readyToRelease.length} lines
              </Button>
            ) : null}
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers for one line                                                */
/* ------------------------------------------------------------------ */

const sizeTitle = (line: PackLine) => {
  const isRoll = line.rolls.length > 0 && !line.batches.length && !line.gonnies.length;
  const parts = sizeParts(line.sample, isRoll);
  return parts.metric ? `${parts.metric} ${parts.unit}`.trim() : "";
};

function rollPlanIds(line: PackLine): string[] {
  return Array.from(
    new Set(
      line.rolls
        .filter((roll) => !roll.released_to_dispatch)
        .flatMap((roll) => (Array.isArray(roll.default_pack_lines) ? roll.default_pack_lines : []))
        .map((row: any) => String(row.material_id || ""))
        .filter(Boolean),
    ),
  );
}

/** The rolls ticked for release on a line, the mode and the items ticked, and whether it can go. */
function rollChoice(line: PackLine, draft: LineDraft) {
  const openIds = line.rolls.filter((roll) => !roll.released_to_dispatch).map((roll) => String(roll.id));
  const ids = (draft.rollIds ?? openIds).filter((id) => openIds.includes(id));
  const marks = draft.rollMarks ?? rollPlanIds(line);
  const mode = draft.rollMode;
  return { openIds, ids, marks, mode, valid: ids.length > 0 && (mode === "UNPACKED" || marks.length > 0) };
}

/** A line can be released now: sealed gonnies waiting, or rolls ticked with what the mode needs. */
function lineReleasable(line: PackLine, draft: LineDraft) {
  const state = packLineState(line);
  if (state.sealed.length) return true;
  return rollChoice(line, draft).valid;
}

/** Splits what is left so every gonny holds about the same (≈30 inner packs or ≈5,000 pouches each, or the last gonny's size). */
function suggestedSplit(left: number, lastSize: number, inner: boolean) {
  if (left <= 0) return 0;
  const capacity = lastSize > 0 ? lastSize : inner ? 30 : 5000;
  const gonnies = Math.max(1, Math.ceil(left / capacity));
  return Math.ceil(left / gonnies);
}

function Fact({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-content-3">{label}</div>
      <div className="truncate text-[13px] font-semibold text-content-1">
        {value}
        {sub ? <span className="ml-1 text-[11.5px] font-normal text-content-3">{sub}</span> : null}
      </div>
    </div>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "order" | "done" }) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-xl border px-3 py-2",
        tone === "order" ? "border-order-border bg-order-bg" : tone === "done" ? "border-success-border bg-success-bg" : "border-line bg-surface-2/60",
      )}
    >
      <div className="truncate text-[11px] text-content-3">{label}</div>
      <div className="truncate font-mono text-[17px] font-semibold tabular-nums text-content-1">{value}</div>
      {sub ? <div className="truncate text-[11px] text-content-3">{sub}</div> : null}
    </div>
  );
}

/** "What is to be packed": the line's product plate, as on the sample. */
function Plate({ line, showOrder }: { line: PackLine; showOrder?: boolean }) {
  const isRoll = line.rolls.length > 0 && !line.batches.length && !line.gonnies.length;
  const { metric, imperial, unit } = sizeParts(line.sample, isRoll);
  const layers = parseLayers(line.sample?.layers_label);
  const thickness = micronText(line.sample?.thickness_label);
  const batch = line.batches[0];
  const plan = batch ? packingPlanOf(batch) : undefined;
  const perPc = Number(plan?.net_kg_per_pcs || 0) * 1000;
  const state = packLineState(line);
  return (
    <section className="rounded-2xl border border-line bg-surface-1 px-4 py-3" data-testid="packing-pack-plate">
      <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-content-3">
        {isRoll ? "What is to be released" : "What is to be packed"} · L{line.index}
        {showOrder ? (
          <span className="inline-flex items-center gap-1.5 normal-case tracking-normal">
            <JobNameTag name={line.jobName} />
            <span className="font-mono text-content-2">{line.orderNumber}</span>
            <span className="font-medium text-content-3">· {line.customer}</span>
          </span>
        ) : null}
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
        <span className="font-mono text-[22px] font-bold leading-tight text-content-1">{metric || line.name}</span>
        {unit ? <span className="text-[12px] text-content-3">{unit}</span> : null}
        {imperial ? <span className="text-[16px] font-semibold text-content-3">{imperial}</span> : null}
      </div>
      <div className="text-[12.5px] font-semibold uppercase text-content-2">{line.name}</div>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        {layers.map((layer, index) => (
          <span key={`${layer.material}-${index}`} className="rounded-md border border-line bg-surface-2 px-1.5 py-px font-mono text-[10.5px] text-content-2">
            {layer.material}
            {layer.micron ? ` ${layer.micron}` : ""}
          </span>
        ))}
        {thickness ? (
          <span className="rounded-md bg-content-1 px-1.5 py-px font-mono text-[10.5px] font-semibold text-surface-1">= {thickness}</span>
        ) : null}
      </div>
      <div className="mt-2.5 grid gap-x-4 gap-y-2 border-t border-line pt-2.5 sm:grid-cols-2 lg:grid-cols-4">
        {isRoll ? (
          <>
            <Fact label="Rolls in yard" value={n(state.openRolls.length, 0)} sub={`· ${kg(state.openRolls.reduce((s, r) => s + Number(r.net_weight_kg || r.weight_kg || 0), 0))} net`} />
            <Fact label="Packing" value={line.rolls[0]?.roll_pack_enabled ? "Sheet / wrap" : "None on the order"} />
            <Fact label="Packing weight" value="None" sub="rolls carry no tare marks" />
            <Fact label="Location" value={clean(line.rolls[0]?.location?.name) || "—"} />
          </>
        ) : (
          <>
            <Fact label="From the machine" value={plan?.content_mode === "PRIMARY_PACKS" ? `Inner packs of ${plan.pcs_per_pack || "?"}` : "Loose pouches"} />
            <Fact
              label="Inner pouch"
              value={plan?.inner_pouch?.code || "None on the order"}
              sub={plan?.inner_pouch?.weight_kg ? `· ${n(plan.inner_pouch.weight_kg * 1000, 2)} g` : undefined}
            />
            <Fact
              label="Gonny on the order"
              value={plan?.gonny?.code || "—"}
              sub={plan?.gonny?.weight_kg ? `· ${n(plan.gonny.weight_kg * 1000, 0)} g` : undefined}
            />
            <Fact label="Product net" value={perPc ? `${n(perPc, 2)} g` : "—"} sub="per pouch · machine log" />
          </>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* One line                                                            */
/* ------------------------------------------------------------------ */

type LineProps = {
  line: PackLine;
  showOrder?: boolean;
  draft: LineDraft;
  patchDraft: (patch: Partial<LineDraft>) => void;
  seals: Record<string, SealDraft>;
  setSeal: (id: string, patch: Partial<SealDraft>) => void;
  focusGonnyId: string;
  gonnyMasters: PackagingMaterial[];
  markMasters: PackagingMaterial[];
  checkByBatch: Map<string, PackingCheckSummary>;
  busy: boolean;
  onPack: (input: {
    batch: Batch;
    pcs: number;
    packs?: number;
    gonnyMaterialId: string;
    contentMode: "PRIMARY_PACKS" | "LOOSE_POUCHES";
    gross?: number;
    reason?: string;
  }) => void;
  packing: boolean;
  onSeal: (gonny: Gonny, gross: number, reason: string) => void;
  sealingId: string;
  onRelease: () => void;
  releasing: boolean;
};

function LineWorkspace(props: LineProps) {
  const { line, showOrder } = props;
  const hasPouch = line.batches.length > 0 || line.gonnies.length > 0;
  const hasRoll = line.rolls.length > 0;
  return (
    <div className="space-y-3">
      <Plate line={line} showOrder={showOrder} />
      {hasPouch ? <PouchLine {...props} /> : null}
      {hasRoll ? <RollLine {...props} /> : null}
    </div>
  );
}

function PouchLine({
  line,
  draft,
  patchDraft,
  seals,
  setSeal,
  focusGonnyId,
  gonnyMasters,
  markMasters,
  checkByBatch,
  busy,
  onPack,
  packing,
  onSeal,
  sealingId,
  onRelease,
  releasing,
}: LineProps) {
  const state = packLineState(line);
  const batch = line.batches.find((row) => row.id === draft.batchId) || line.batches[0];
  const plan = batch ? packingPlanOf(batch) : line.batches[0] ? packingPlanOf(line.batches[0]) : undefined;
  const inner = plan?.content_mode === "PRIMARY_PACKS";
  const chosen = gonnyMasters.find((item) => String(item.id) === draft.gonnyMaterialId);
  const perPc = Number(plan?.net_kg_per_pcs || 0);
  const pcs = Number(draft.pcs || 0);
  const packs = Number(draft.packs || 0);
  const productKg = pcs * perPc;
  const pouchKg = inner ? packs * Number(plan?.inner_pouch?.weight_kg || 0) : 0;
  const gonnyKg = Number((chosen && gonnyWeight(chosen)) || 0);
  const expected = productKg + pouchKg + gonnyKg;
  const gross = draft.gross === "" ? null : Number(draft.gross);
  const variance = gross !== null && gross > 0 ? gross - expected : null;
  const variancePct = variance !== null && expected > 0 ? (variance / expected) * 100 : null;
  const needReason = variancePct !== null && Math.abs(variancePct) > 2;
  const tooMany = batch ? pcs > Number(batch.qty_pcs || 0) : false;
  const canPack =
    Boolean(batch) &&
    pcs > 0 &&
    !tooMany &&
    Boolean(draft.gonnyMaterialId) &&
    (!inner || !plan?.pcs_per_pack || packs > 0) &&
    (!needReason || Boolean(draft.reason.trim()));
  const kg3 = (value: number) => value.toLocaleString("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  const markMaterials = markMasters.filter((m) => !["INNER_POUCH", "GONNY"].includes(String(m.packaging_kind || "").toUpperCase()));
  const toggleMark = (material: PackagingMaterial) => {
    const id = String(material.id || "");
    patchDraft({ marks: draft.marks.includes(id) ? draft.marks.filter((value) => value !== id) : [...draft.marks, id] });
  };
  const loggedPcs = state.pendingPcs + line.gonnies.reduce((sum, g) => sum + Number(g.qty_pcs || 0), 0);
  const packedPcs = loggedPcs - state.pendingPcs;
  const batchKg = line.batches.reduce((sum, row) => sum + batchNetKg(row), 0);
  const packsLeft = line.batches.reduce((sum, row) => sum + Number(packingPlanOf(row).packs_left || 0), 0);
  const sealedPcs = state.sealed.reduce((sum, g) => sum + Number(g.qty_pcs || 0), 0);
  const sealedNet = state.sealed.reduce((sum, g) => sum + Number(g.net_product_weight_kg || 0), 0);
  const sealedGross = state.sealed.reduce((sum, g) => sum + Number(g.gross_weight_kg || g.weight_kg || 0), 0);
  const heldBatch = Array.from(checkByBatch.values()).find(
    (row) => row.status === "HELD" && line.gonnies.some((g) => g.batch_no === row.batch_number),
  );
  const lineChecks = line.batches.map((row) => checkByBatch.get(String(row.id))).filter(Boolean) as PackingCheckSummary[];
  const lastGonny = [...line.gonnies].sort((a, b) => String(b.label_id).localeCompare(String(a.label_id)))[0];
  const lastSize = inner ? Number(lastGonny?.primary_pack_count || 0) : Number(lastGonny?.qty_pcs || 0);
  const leftForSplit = inner ? Number(plan?.packs_left || 0) : Number(batch?.qty_pcs || 0);
  const suggestion = suggestedSplit(leftForSplit, lastSize, inner);
  const setPacks = (value: string) => {
    if (plan?.pcs_per_pack && batch) {
      patchDraft({ packs: value, pcs: String(Math.min(Number(value || 0) * plan.pcs_per_pack, Number(batch.qty_pcs || 0)) || "") });
    } else patchDraft({ packs: value });
  };
  const gonnyRows = [...line.gonnies].sort((a, b) => {
    const rank = (g: Gonny) => (gonnyStage(g) === "OPEN" ? 0 : gonnyStage(g) === "SEALED" ? 1 : 2);
    return rank(a) - rank(b);
  });
  const openCount = state.open.length;

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Step
        no={1}
        title="Confirm the line's figures from the machine"
        done={draft.confirmed || !line.batches.length}
        hint="The machine's logged output is the product net. Nothing is typed here: it is what the packing check compares against."
        right={
          line.batches.length ? (
            <label className="flex min-h-[32px] cursor-pointer items-center gap-1.5 text-[12px] font-medium text-content-2">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={draft.confirmed}
                onChange={(event) => patchDraft({ confirmed: event.target.checked })}
                data-testid="packing-figures-checked"
              />
              Figures checked
            </label>
          ) : null
        }
      >
        {line.batches.length ? (
          <div className="grid grid-cols-2 gap-2">
            {line.batches.map((row) => {
              const check = checkByBatch.get(String(row.id));
              const selected = row.id === batch?.id;
              return (
                <button
                  key={row.id}
                  type="button"
                  data-testid={`packing-pack-batch-${row.id}`}
                  aria-pressed={selected}
                  onClick={() => {
                    const defaults = plannedDefaults(row, gonnyMasters);
                    patchDraft({ batchId: row.id, packs: defaults.packs, pcs: defaults.pcs, gonnyMaterialId: draft.gonnyMaterialId || defaults.gonnyMaterialId });
                  }}
                  className={cn(
                    "min-w-0 rounded-xl border px-3 py-2 text-left transition-colors",
                    selected ? "border-primary/50 bg-info-bg" : "border-line bg-surface-2/60 hover:border-line-strong",
                  )}
                >
                  <div className="truncate text-[11px] text-content-3">Batch {row.batch_number}</div>
                  <div className="font-mono text-[17px] font-semibold tabular-nums text-content-1">
                    {n(row.qty_pcs, 0)}
                    <span className="ml-0.5 text-[11px] font-normal text-content-3">pcs</span>
                  </div>
                  <div className="truncate text-[11px] text-content-3">
                    {kg(batchNetKg(row))} net · {row.location?.name || ""}
                    {check ? ` · check ${check.status.toLowerCase()}` : ""}
                  </div>
                </button>
              );
            })}
            <Tile label="Machine net" value={`${n(batchKg, 2)} kg`} sub={perPc ? `${n(perPc * 1000, 2)} g per pouch` : undefined} />
            {clean((line.batches[0] as any)?.machine_name) ? (
              <Tile label="Machine" value={clean((line.batches[0] as any).machine_name)} sub={line.batches[0]?.location?.name || undefined} />
            ) : null}
            {inner && plan?.inner_pouch ? (
              <Tile tone="order" label="Inner pouches" value={`${n(packsLeft, 0)} packs`} sub={`${plan.inner_pouch.code} · taken at the machine`} />
            ) : null}
          </div>
        ) : (
          <p className="text-[12px] text-content-3">Every batch of this line is in gonnies. Weigh and release them below.</p>
        )}
        {lineChecks.some((row) => row.status === "HELD") ? (
          <p className="mt-2 flex items-start gap-1.5 text-[11.5px] text-warning-fg">
            <ShieldAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden /> A batch of this line is on hold at the packing check.
          </p>
        ) : null}
      </Step>

      <Step
        no={2}
        title="How the pouches arrive"
        done={line.gonnies.length > 0}
        hint={
          inner
            ? `The order says: from the machine in inner packs of ${plan?.pcs_per_pack || "?"} pouches${plan?.inner_pouch ? `, inner pouch ${plan.inner_pouch.code}${plan.inner_pouch.weight_kg ? ` (${n(plan.inner_pouch.weight_kg * 1000, 2)} g each)` : ""}` : ""}.`
            : "The order has no inner pouch: pouches come loose from the machine."
        }
        right={
          <div className="flex rounded-xl border border-line bg-surface-2 p-0.5" role="group" aria-label="How the pouches arrive">
            {(
              [
                ["PRIMARY_PACKS", "Inner packs"],
                ["LOOSE_POUCHES", "Loose pouches"],
              ] as const
            ).map(([value, label]) => {
              const on = (inner ? "PRIMARY_PACKS" : "LOOSE_POUCHES") === value;
              return (
                <span
                  key={value}
                  aria-current={on ? "true" : undefined}
                  title={on ? "As set on the order" : "Set on the order; the yard packs it as ordered"}
                  className={cn(
                    "flex min-h-[30px] items-center gap-1 rounded-[10px] px-2.5 text-[12px] font-semibold",
                    on ? "bg-surface-1 text-content-1 shadow-[var(--shadow-sm)]" : "text-content-4",
                  )}
                >
                  {label}
                  {on ? <span className="rounded bg-order-bg px-1 text-[9.5px] font-bold uppercase text-order-fg">order</span> : null}
                </span>
              );
            })}
          </div>
        }
      >
        <div className="grid grid-cols-3 gap-2">
          {inner ? (
            <>
              <Tile tone={plan?.packs_left === 0 ? "done" : undefined} label="Inner packs available" value={n(packsLeft, 0)} sub="left to put in gonnies" />
              <Tile label="Pouches per pack" value={n(plan?.pcs_per_pack || 0, 0)} sub="from the order" />
            </>
          ) : (
            <Tile label="Loose pouches" value={n(state.pendingPcs, 0)} sub="left to put in gonnies" />
          )}
          <Tile label="Pouches available" value={n(state.pendingPcs, 0)} sub={`${n(packedPcs, 0)} already in gonnies`} />
          {!inner ? <Tile label="Gonnies so far" value={n(line.gonnies.length, 0)} sub={`${n(state.releasedGonnies.length, 0)} released`} /> : null}
        </div>
      </Step>

      <div className="lg:col-span-2">
        <Step
          no={3}
          title="Build gonnies · weigh each on the scale"
          done={!line.batches.length && !openCount}
          hint="Each sealed gonny is one dispatch unit. Dispatch weight = product net (machine) + inner pouches + gonny tare. Only inner pouches and gonnies carry weight."
          right={
            batch && suggestion ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8"
                data-testid="packing-suggest-split"
                disabled={busy}
                onClick={() => (inner ? setPacks(String(suggestion)) : patchDraft({ pcs: String(suggestion) }))}
              >
                Suggest split for {n(state.pendingPcs, 0)} pcs
              </Button>
            ) : !line.batches.length ? (
              <Pill tone="good">
                <Check className="mr-1 inline h-3 w-3" aria-hidden />
                All pouches in gonnies
              </Pill>
            ) : null
          }
        >
          {batch ? (
            <div data-testid="packing-gonny-plan">
              <div className="grid gap-2.5 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)_minmax(0,1fr)_auto] md:items-end">
                {inner && plan?.pcs_per_pack ? (
                  <div className="space-y-1">
                    <Label htmlFor="packing-gonny-inner" className="text-[11.5px]">
                      Inner packs in this gonny <b>= {n(pcs, 0)} pouches</b>
                    </Label>
                    <Input
                      id="packing-gonny-inner"
                      data-testid="packing-gonny-inner"
                      type="number"
                      min="1"
                      max={plan?.packs_left ?? undefined}
                      inputMode="numeric"
                      value={draft.packs}
                      disabled={busy}
                      onChange={(event) => setPacks(event.target.value)}
                      className="h-11 text-right font-mono text-[18px] font-semibold tabular-nums"
                    />
                  </div>
                ) : (
                  <div className="space-y-1">
                    <Label htmlFor="packing-gonny-qty" className="text-[11.5px]">
                      {inner ? "Pouches in these packs" : "Pouches in this gonny"}
                    </Label>
                    <Input
                      id="packing-gonny-qty"
                      data-testid="packing-gonny-qty"
                      type="number"
                      min="1"
                      max={batch.qty_pcs || undefined}
                      inputMode="numeric"
                      value={draft.pcs}
                      disabled={busy}
                      onChange={(event) => patchDraft({ pcs: event.target.value })}
                      className="h-11 text-right font-mono text-[18px] font-semibold tabular-nums"
                    />
                  </div>
                )}
                <div className="space-y-1">
                  <Label htmlFor="packing-gonny-material" className="text-[11.5px]">
                    Gonny type · tare
                  </Label>
                  <select
                    id="packing-gonny-material"
                    data-testid="packing-gonny-material"
                    value={draft.gonnyMaterialId}
                    disabled={busy}
                    onChange={(event) => patchDraft({ gonnyMaterialId: event.target.value })}
                    className="h-11 w-full rounded-xl border border-input bg-surface-1 px-3 text-[13px]"
                  >
                    <option value="">Select gonny</option>
                    {gonnyMasters.map((item) => {
                      const w = gonnyWeight(item);
                      return (
                        <option key={item.id} value={item.id}>
                          {item.code} · {w ? `${n(w * 1000, 0)} g` : "weight missing"}
                          {plan?.gonny?.id === String(item.id) ? " · on the order" : ""}
                        </option>
                      );
                    })}
                  </select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="packing-gonny-gross" className="text-[11.5px]">
                    Weighed gross <b>kg</b> <span className="text-content-4">(scale · optional)</span>
                  </Label>
                  <Input
                    id="packing-gonny-gross"
                    data-testid="packing-gonny-gross"
                    type="number"
                    step="0.001"
                    min="0"
                    inputMode="decimal"
                    placeholder={kg3(expected)}
                    value={draft.gross}
                    disabled={busy}
                    onChange={(event) => patchDraft({ gross: event.target.value })}
                    className="h-11 text-right font-mono text-[18px] font-semibold tabular-nums"
                  />
                </div>
                <Button
                  type="button"
                  className="h-11 md:min-w-[170px]"
                  data-testid="packing-gonny-submit"
                  disabled={!canPack || busy}
                  onClick={() =>
                    batch &&
                    onPack({
                      batch,
                      pcs,
                      packs: inner && draft.packs ? packs : undefined,
                      gonnyMaterialId: draft.gonnyMaterialId,
                      contentMode: inner ? "PRIMARY_PACKS" : "LOOSE_POUCHES",
                      gross: gross && gross > 0 ? gross : undefined,
                      reason: draft.reason.trim(),
                    })
                  }
                >
                  <PackageOpen className="mr-1.5 h-4 w-4" aria-hidden />
                  {packing ? "Packing…" : gross && gross > 0 ? "Add gonny · sealed" : "Add gonny · open"}
                </Button>
              </div>
              <div
                className="mt-2.5 flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-xl bg-surface-2 px-3 py-2 font-mono text-[12.5px] tabular-nums text-content-2"
                data-testid="packing-gonny-weight-preview"
              >
                <b className="text-content-1">{kg3(productKg)}</b>
                <span className="font-sans text-[11px] text-content-3">
                  product ({n(pcs, 0)} × {n(perPc * 1000, 2)} g)
                </span>
                {inner ? (
                  <>
                    <span>+</span>
                    <b className="text-content-1">{kg3(pouchKg)}</b>
                    <span className="font-sans text-[11px] text-content-3">inner pouches ({n(packs, 0)})</span>
                  </>
                ) : null}
                <span>+</span>
                <b className="text-content-1">{kg3(gonnyKg)}</b>
                <span className="font-sans text-[11px] text-content-3">gonny {chosen?.code || ""}</span>
                <span>=</span>
                <b className="text-[14px] text-content-1">{kg3(expected)} kg</b>
                <span className="font-sans text-[11px] text-content-3">expected gross</span>
              </div>
              {variance === null ? (
                <p className="mt-1.5 text-[11.5px] text-content-3">Put the gonny on the scale and enter the gross to seal it now, or add it open and weigh it below.</p>
              ) : (
                <div
                  className={cn(
                    "mt-1.5 flex flex-wrap items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-[12px] font-medium tabular-nums",
                    needReason ? "bg-warning-bg text-warning-fg" : "bg-success-bg text-success-fg",
                  )}
                >
                  <span>{needReason ? "Variance above ±2% · a reason is required" : "Within limit"}</span>
                  <span>
                    {variance > 0 ? "+" : ""}
                    {n(variance, 3)} kg ({n(variancePct || 0, 2)}%)
                  </span>
                  {needReason ? (
                    <Input
                      data-testid="packing-gonny-variance-reason"
                      aria-label="Variance reason"
                      placeholder="Why does the scale differ from expected?"
                      value={draft.reason}
                      disabled={busy}
                      onChange={(event) => patchDraft({ reason: event.target.value })}
                      className="h-9 w-full bg-surface-1 text-[12px] text-content-1"
                    />
                  ) : null}
                </div>
              )}
              {tooMany ? (
                <p className="mt-1.5 text-[11.5px] font-medium text-warning-fg">More than the {n(batch.qty_pcs, 0)} pouches left in {batch.batch_number}.</p>
              ) : null}
              {chosen && !gonnyWeight(chosen) ? (
                <p className="mt-1.5 text-[11.5px] text-warning-fg">This gonny has no weight on its master; enter it in Masters › Packaging.</p>
              ) : null}
              {!gonnyMasters.length ? (
                <p className="mt-1.5 text-[11.5px] text-warning-fg">No gonny packaging masters exist yet. Add one in Masters › Packaging.</p>
              ) : null}
            </div>
          ) : null}

          {gonnyRows.length ? (
            <div className={cn("overflow-x-auto rounded-xl border border-line", batch && "mt-3")}>
              <table className="w-full min-w-[760px] text-[12px]" aria-label="Gonnies of this line">
                <thead className="bg-surface-2 text-[11px] text-content-3">
                  <tr>
                    <th className="px-3 py-1.5 text-left font-medium">Gonny</th>
                    <th className="px-3 py-1.5 text-right font-medium">Packs</th>
                    <th className="px-3 py-1.5 text-right font-medium">Pcs</th>
                    <th className="px-3 py-1.5 text-right font-medium">Net</th>
                    <th className="px-3 py-1.5 text-right font-medium">Expected</th>
                    <th className="px-3 py-1.5 text-right font-medium">Gross (scale)</th>
                    <th className="px-3 py-1.5 text-right font-medium">Variance</th>
                  </tr>
                </thead>
                <tbody>
                  {gonnyRows.map((gonny) => {
                    const stage = gonnyStage(gonny);
                    const exp = getGonnyExpected(gonny);
                    const seal = seals[gonny.id] || { gross: "", reason: "" };
                    const g = Number(seal.gross || 0);
                    const v = g ? g - exp : 0;
                    const vp = exp > 0 && g ? (v / exp) * 100 : 0;
                    const reasonNeeded = Math.abs(vp) > 2;
                    const canSeal = g > 0 && (!reasonNeeded || Boolean(seal.reason.trim()));
                    const rowVar = Number(gonny.gross_variance_pct || 0);
                    return (
                      <tr
                        key={gonny.id}
                        data-testid={`packing-gonny-row-${gonny.id}`}
                        data-stage={stage}
                        className={cn("border-t border-line align-top", stage === "OPEN" && "bg-info-bg", stage === "RELEASED" && "text-content-3")}
                      >
                        <td className="px-3 py-1.5">
                          <div className="font-mono font-semibold text-content-1">{clean(gonny.dispatch_unit_no || gonny.label_id)}</div>
                          <div className="text-[11px] text-content-3">
                            {stage === "OPEN" ? "open · weigh" : stage === "SEALED" ? "sealed" : "in Dispatch Bay"} · {gonny.batch_no || ""}
                          </div>
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{gonny.primary_pack_count ?? "—"}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{n(gonny.qty_pcs, 0)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{kg(gonny.net_product_weight_kg)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{kg(exp)}</td>
                        <td className="px-3 py-1.5 text-right">
                          {stage === "OPEN" ? (
                            <form
                              className="flex items-center justify-end gap-1.5"
                              onSubmit={(event) => {
                                event.preventDefault();
                                if (canSeal && !busy) onSeal(gonny, g, seal.reason.trim());
                              }}
                            >
                              <Input
                                data-testid={`packing-gonny-gross-${gonny.id}`}
                                aria-label={`Gross weight of ${gonny.label_id} in kg`}
                                type="number"
                                step="0.001"
                                inputMode="decimal"
                                placeholder="weigh"
                                autoFocus={focusGonnyId === gonny.id}
                                value={seal.gross}
                                disabled={busy}
                                onChange={(event) => setSeal(gonny.id, { gross: event.target.value })}
                                className="h-9 w-[110px] text-right font-semibold tabular-nums"
                              />
                              <Button type="submit" size="sm" variant="outline" className="h-9" data-testid={`packing-gonny-seal-${gonny.id}`} disabled={!canSeal || busy}>
                                <Scale className="mr-1 h-3.5 w-3.5" aria-hidden />
                                {sealingId === gonny.id ? "Sealing…" : "Seal"}
                              </Button>
                            </form>
                          ) : (
                            <b className="tabular-nums">{kg(gonny.gross_weight_kg || gonny.weight_kg)}</b>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums">
                          {stage === "OPEN" ? (
                            g ? (
                              <div className="space-y-1">
                                <span className={reasonNeeded ? "font-semibold text-warning-fg" : "text-success-fg"}>
                                  {v > 0 ? "+" : ""}
                                  {n(vp, 2)}%
                                </span>
                                {reasonNeeded ? (
                                  <Input
                                    data-testid={`packing-gonny-reason-${gonny.id}`}
                                    aria-label="Variance reason (required above 2%)"
                                    placeholder="reason (required)"
                                    value={seal.reason}
                                    disabled={busy}
                                    onChange={(event) => setSeal(gonny.id, { reason: event.target.value })}
                                    className="h-8 min-w-[160px] text-[12px]"
                                  />
                                ) : null}
                              </div>
                            ) : (
                              <span className="text-content-4">—</span>
                            )
                          ) : (
                            <span className={Math.abs(rowVar) > 2 ? "font-semibold text-warning-fg" : "text-success-fg"} title={gonny.gross_variance_reason || undefined}>
                              {rowVar > 0 ? "+" : ""}
                              {n(rowVar, 1)}%
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
          <div className="mt-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-content-3">
              <span>
                <b className="text-content-1">{n(packedPcs, 0)}</b> of <b className="text-content-1">{n(loggedPcs, 0)}</b> pouches in gonnies
              </span>
              <span className="flex gap-2">
                {state.pendingPcs ? <span className="font-medium text-warning-fg">{n(state.pendingPcs, 0)} pcs to pack</span> : <span className="font-medium text-success-fg">all packed</span>}
                {openCount ? <span className="font-medium text-warning-fg">{openCount} open · weigh before release</span> : null}
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div
                className={cn("h-full rounded-full", !state.pendingPcs && !openCount ? "bg-success-fg" : "bg-primary")}
                style={{ width: `${loggedPcs ? (packedPcs / loggedPcs) * 100 : 0}%` }}
              />
            </div>
          </div>
        </Step>
      </div>

      <div className="lg:col-span-2">
        <Step
          no={4}
          title="Packing items used · evening-count marks"
          done={draft.marks.length > 0}
          hint="Tick everything used on this line other than the inner pouches and gonnies (already booked from each unit): cartons, tape, labels, sheets and extras. No quantities: the evening count gives the consumption, booked to this order."
          right={<Pill tone={draft.marks.length ? "good" : "neutral"}>{draft.marks.length} ticked</Pill>}
        >
          <EodItemChecks
            materials={markMaterials}
            selectedIds={draft.marks}
            onToggle={toggleMark}
            testIdPrefix="packing-gonny-mark-material"
            disabled={busy}
          />
        </Step>
      </div>

      <section
        className={cn(
          "flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 lg:col-span-2",
          !state.todo ? "border-success-border bg-success-bg" : state.sealed.length ? "border-primary/50 bg-info-bg" : "border-line bg-surface-1",
        )}
        data-testid="packing-release-box"
      >
        <div className="min-w-0">
          <div className="text-[15px] font-semibold text-content-1">
            {!state.todo ? (
              <span className="inline-flex items-center gap-1.5 text-success-fg">
                <CircleCheck className="h-4 w-4" aria-hidden /> Released to Dispatch Bay
              </span>
            ) : (
              `Release L${line.index} to Dispatch Bay`
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[12px] text-content-3">
            <span>
              {n(state.sealed.length, 0)} sealed gonn{state.sealed.length === 1 ? "y" : "ies"} · {n(sealedPcs, 0)} pcs · own dispatch slip
            </span>
            <span className="tabular-nums">
              {kg(sealedGross)} gross · {kg(sealedNet)} net
            </span>
            {state.pendingPcs && state.sealed.length ? (
              <span className="text-warning-fg">{n(state.pendingPcs, 0)} pcs stay in the batch for later · the packing check stays open</span>
            ) : null}
            {openCount ? <span className="text-warning-fg">{openCount} open gonn{openCount === 1 ? "y stays" : "ies stay"} in the yard until weighed</span> : null}
            {heldBatch ? (
              <span className="text-warning-fg">
                Batch {heldBatch.batch_number} is on hold at the packing check: a supervisor accepts it before release.
              </span>
            ) : null}
          </div>
        </div>
        {state.todo ? (
          <Button
            type="button"
            className="h-11"
            data-testid="packing-gonny-release-submit"
            disabled={!state.sealed.length || busy}
            onClick={onRelease}
          >
            <Send className="mr-1.5 h-4 w-4" aria-hidden />
            {releasing
              ? "Releasing…"
              : state.sealed.length
                ? `Release L${line.index}${state.pendingPcs ? " · short" : ""} · ${state.sealed.length} gonn${state.sealed.length === 1 ? "y" : "ies"}`
                : "Seal a gonny to release"}
          </Button>
        ) : (
          <Pill tone="good">In Dispatch Bay</Pill>
        )}
      </section>
    </div>
  );
}

function RollLine({ line, draft, patchDraft, markMasters, busy, onRelease, releasing }: LineProps) {
  const state = packLineState(line);
  const choice = rollChoice(line, draft);
  const planIds = rollPlanIds(line);
  const selectedRolls = state.openRolls.filter((roll) => choice.ids.includes(String(roll.id)));
  const materials = markMasters.filter(
    (m) => String(m.packaging_kind || "").toUpperCase() !== "INNER_POUCH" && (!planIds.length || planIds.includes(String(m.id))),
  );
  const net = selectedRolls.reduce((sum, roll) => sum + Number(roll.net_weight_kg || roll.weight_kg || 0), 0);
  const tare = selectedRolls.reduce((sum, roll) => sum + Number(roll.tare_weight_kg || 0), 0);
  const gross = selectedRolls.reduce((sum, roll) => sum + Number(roll.gross_weight_kg || roll.weight_kg || 0), 0);
  const toggleRoll = (id: string) =>
    patchDraft({ rollIds: choice.ids.includes(id) ? choice.ids.filter((value) => value !== id) : [...choice.ids, id] });
  const toggleMark = (material: PackagingMaterial) => {
    const id = String(material.id || "");
    patchDraft({ rollMarks: choice.marks.includes(id) ? choice.marks.filter((value) => value !== id) : [...choice.marks, id] });
  };

  return (
    <div className="grid gap-3 lg:grid-cols-2" data-testid="packing-roll-dialog">
      <Step
        no={1}
        title="Rolls in this release"
        done={choice.ids.length > 0 || !state.openRolls.length}
        hint="Each roll becomes its own dispatch unit. Weights come from the roll label: no packing weights are added."
        right={
          state.openRolls.length ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              data-testid="packing-roll-select-all"
              disabled={busy}
              onClick={() => patchDraft({ rollIds: choice.ids.length === choice.openIds.length ? [] : choice.openIds })}
            >
              {choice.ids.length === choice.openIds.length ? "Clear selection" : "Select all open"}
            </Button>
          ) : null
        }
      >
        <ul className="max-h-[320px] space-y-1.5 overflow-y-auto pr-0.5" aria-label="Rolls of this line">
          {line.rolls.map((roll, index) => {
            const released = Boolean(roll.released_to_dispatch);
            const checked = choice.ids.includes(String(roll.id));
            return (
              <li
                key={roll.id}
                className={cn(
                  "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 rounded-xl border px-2.5 py-2",
                  released ? "border-line bg-surface-2/60" : checked ? "border-primary/40 bg-info-bg" : "border-line bg-surface-1",
                )}
              >
                {released ? (
                  <span className="grid h-6 w-6 place-items-center rounded-md bg-success-bg text-success-fg">
                    <Check className="h-3.5 w-3.5" />
                  </span>
                ) : (
                  <SelectBox
                    checked={checked}
                    onChange={() => toggleRoll(String(roll.id))}
                    label={`Release roll ${roll.label_id}`}
                    testId={`packing-roll-select-${roll.id}`}
                    index={index + 1}
                    disabled={busy}
                  />
                )}
                <span className="min-w-0">
                  <span className="block truncate font-mono text-[12.5px] font-semibold text-content-1">{roll.label_id}</span>
                  <span className="block truncate text-[11.5px] text-content-3">
                    {roll.split_parent_label ? `split of ${roll.split_parent_label}` : roll.dispatch_lineage === "STOCK_CLAIM" ? "stock claim" : "full roll"}
                    {roll.location?.name ? ` · ${roll.location.name}` : ""}
                    {released ? " · in Dispatch Bay" : ""}
                  </span>
                </span>
                <span className="text-right font-mono text-[12px] tabular-nums text-content-2">
                  <b className="block text-content-1">{kg(roll.gross_weight_kg || roll.weight_kg)}</b>
                  <span className="block text-[11px] text-content-3">
                    net {kg(roll.net_weight_kg || roll.weight_kg)} · tare {kg(roll.tare_weight_kg)}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
        <div className="mt-2.5 grid grid-cols-4 gap-1.5">
          <Tile label="Rolls" value={n(choice.ids.length, 0)} sub={`of ${state.openRolls.length} open`} />
          <Tile label="Net" value={kg(net)} />
          <Tile label="Tare" value={kg(tare)} sub="cores" />
          <Tile label="Gross" value={kg(gross)} />
        </div>
      </Step>

      <div className="space-y-3">
        <Step
          no={2}
          title="Release mode"
          done
          hint={line.rolls[0]?.roll_pack_enabled ? "Suggested for this order: packed roll (sheet / wrap)." : "This order has no roll packing list."}
        >
          <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Release mode">
            {(
              [
                ["PACKED", "Packed roll · sheet / wrap"],
                ["UNPACKED", "Release unpacked roll"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                data-testid={`packing-roll-release-mode-${value}`}
                aria-pressed={choice.mode === value}
                disabled={busy}
                onClick={() => patchDraft({ rollMode: value })}
                className={cn(
                  "min-h-[44px] rounded-xl border px-2.5 py-2 text-[12.5px] font-semibold transition-colors",
                  choice.mode === value ? "border-primary bg-info-bg text-content-1 ring-1 ring-primary/30" : "border-line bg-surface-1 text-content-2 hover:border-line-strong",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {choice.mode === "UNPACKED" ? (
            <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-warning-border bg-warning-bg px-2.5 py-1.5 text-[12px] text-warning-fg">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
              Each roll ships as its own unit. No sheet, wrap, tape or label stock is marked.
            </p>
          ) : (
            <p className="mt-2 text-[12px] text-content-3">
              {planIds.length ? `The order's roll packing list has ${planIds.length} items; they come ticked below.` : "This order has no roll packing list; any evening-count item can be ticked."}
            </p>
          )}
        </Step>
        {choice.mode === "PACKED" ? (
          <Step
            no={3}
            title="Evening-count items used on these rolls"
            done={choice.marks.length > 0}
            hint="Tick what was used: wrap, sheet, tape, core plugs. No quantities; the evening count gives the consumption, booked to this order."
            right={<Pill tone={choice.marks.length ? "good" : "warn"}>{choice.marks.length} ticked</Pill>}
          >
            <div className="max-h-[220px] overflow-y-auto pr-0.5">
              <EodItemChecks
                materials={materials}
                planIds={planIds}
                selectedIds={choice.marks}
                onToggle={toggleMark}
                testIdPrefix="packing-roll-mark-material"
                disabled={busy}
              />
            </div>
          </Step>
        ) : null}
      </div>

      <section
        className={cn(
          "flex flex-wrap items-center justify-between gap-3 rounded-2xl border px-4 py-3 lg:col-span-2",
          !state.openRolls.length ? "border-success-border bg-success-bg" : choice.valid ? "border-primary/50 bg-info-bg" : "border-line bg-surface-1",
        )}
      >
        <div className="min-w-0">
          <div className="text-[15px] font-semibold text-content-1">
            {!state.openRolls.length ? (
              <span className="inline-flex items-center gap-1.5 text-success-fg">
                <CircleCheck className="h-4 w-4" aria-hidden /> Released to Dispatch Bay
              </span>
            ) : (
              `Release ${choice.ids.length} roll${choice.ids.length === 1 ? "" : "s"} · L${line.index} to Dispatch Bay`
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[12px] text-content-3">
            <span>{choice.ids.length} dispatch unit{choice.ids.length === 1 ? "" : "s"} · own dispatch slip</span>
            <span className="tabular-nums">
              {kg(gross)} gross · {kg(net)} net
            </span>
            <span>no packing check for rolls</span>
            {state.openRolls.length - choice.ids.length > 0 ? (
              <span>
                {state.openRolls.length - choice.ids.length} roll{state.openRolls.length - choice.ids.length === 1 ? "" : "s"} stay in the yard
              </span>
            ) : null}
          </div>
        </div>
        {state.openRolls.length ? (
          <Button type="button" className="h-11" data-testid="packing-roll-submit" disabled={!choice.valid || busy} onClick={onRelease}>
            <Send className="mr-1.5 h-4 w-4" aria-hidden />
            {releasing
              ? "Releasing…"
              : choice.mode === "PACKED" && !choice.marks.length
                ? "Tick the packing items used"
                : `Release ${choice.ids.length} roll${choice.ids.length === 1 ? "" : "s"}`}
          </Button>
        ) : (
          <Pill tone="good">In Dispatch Bay</Pill>
        )}
      </section>
    </div>
  );
}

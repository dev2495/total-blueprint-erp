"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Boxes,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Clock,
  Database,
  ExternalLink,
  Factory,
  FileCheck2,
  FileText,
  GitBranch,
  GitMerge,
  ImageIcon,
  Layers,
  Loader2,
  Lock,
  Package,
  PackageCheck,
  ReceiptText,
  Route,
  Scale,
  ShieldCheck,
  Sparkles,
  Tags,
  Truck,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDisplayDate } from "@/lib/date-format";
import { normalizeProductSpec } from "@/lib/product-spec";
import { cn } from "@/lib/utils";
import { analyticsApi, type OrderTrackingResponse } from "@/services/analytics";
import { customerDispatchApi, type CustomerDispatch } from "@/services/customer-dispatch";
import { salesService, type SalesOrder, type SalesOrderLine } from "@/services/sales";

const LINE_PROGRESS_TONES = [
  { fill: "#2563eb", dark: "#1e40af", light: "rgba(37,99,235,.30)", track: "rgba(37,99,235,.12)", text: "text-primary", border: "border-info-border", bg: "bg-info-bg" },
  { fill: "#10b981", dark: "#047857", light: "rgba(16,185,129,.30)", track: "rgba(16,185,129,.12)", text: "text-success-fg", border: "border-success-border", bg: "bg-success-bg" },
  { fill: "#7c3aed", dark: "#5b21b6", light: "rgba(124,58,237,.30)", track: "rgba(124,58,237,.12)", text: "text-order-fg", border: "border-order-border", bg: "bg-order-bg" },
  { fill: "#f59e0b", dark: "#b45309", light: "rgba(245,158,11,.34)", track: "rgba(245,158,11,.14)", text: "text-warning-fg", border: "border-warning-border", bg: "bg-warning-bg" },
  { fill: "#ef4444", dark: "#b91c1c", light: "rgba(239,68,68,.30)", track: "rgba(239,68,68,.12)", text: "text-danger-fg", border: "border-danger-border", bg: "bg-danger-bg" },
  { fill: "#0891b2", dark: "#0e7490", light: "rgba(8,145,178,.30)", track: "rgba(8,145,178,.12)", text: "text-primary", border: "border-info-border", bg: "bg-info-bg" },
];

const FLOW_COLORS = {
  ready: "#2563eb",
  dispatched: "#10b981",
  wip: "#8b5cf6",
  open: "rgba(148,163,184,.22)",
};

function safeNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function fmtKg(value: unknown, digits = 1): string {
  return safeNumber(value).toLocaleString("en-IN", { maximumFractionDigits: digits });
}

function fmtQty(value: unknown): string {
  return safeNumber(value).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function fmtDate(value?: string | null): string {
  if (!value) return "--";
  return formatDisplayDate(value);
}

function statusLabel(value?: string | null): string {
  const raw = String(value || "").trim();
  if (!raw) return "Status pending";
  return raw
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function percent(done: number, target: number): number {
  if (!Number.isFinite(target) || target <= 0) return 0;
  return Math.max(0, Math.min(100, (done / target) * 100));
}

function flowBandMetrics({
  orderedKg,
  producedKg,
  packedKg,
  dispatchedKg,
  wipKg = 0,
}: {
  orderedKg: number;
  producedKg: number;
  packedKg: number;
  dispatchedKg: number;
  wipKg?: number;
}) {
  const bounded = (value: number) => Math.max(0, Math.min(orderedKg, value));
  const dispatched = bounded(dispatchedKg);
  const readyGross = Math.max(bounded(producedKg), bounded(packedKg), dispatched);
  const ready = Math.max(0, readyGross - dispatched);
  const wip = Math.max(0, Math.min(bounded(wipKg), orderedKg - dispatched - ready));
  const open = Math.max(0, orderedKg - dispatched - ready - wip);
  return {
    dispatchedKg: dispatched,
    readyKg: ready,
    wipKg: wip,
    openKg: open,
    dispatchedPct: orderedKg > 0 ? (dispatched / orderedKg) * 100 : 0,
    readyPct: orderedKg > 0 ? (ready / orderedKg) * 100 : 0,
    wipPct: orderedKg > 0 ? (wip / orderedKg) * 100 : 0,
    openPct: orderedKg > 0 ? (open / orderedKg) * 100 : 0,
    completePct: orderedKg > 0 ? ((dispatched + ready) / orderedKg) * 100 : 0,
  };
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, any>) : {};
}

function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function textValue(...values: unknown[]): string {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text && !["null", "undefined", "nan", "--", "—"].includes(text.toLowerCase())) return text;
  }
  return "";
}

function lineLabel(line: any, index: number): string {
  return (
    String(line?.line_name || "").trim() ||
    String(line?.product_master_code || line?.product_master_name || "").trim() ||
    String(line?.template_name || "").trim() ||
    `Line ${index + 1}`
  );
}

function lineOrderedKg(line: any): number {
  const explicit = safeNumber(line?.total_weight_kg);
  if (explicit > 0) return explicit;
  const qty = safeNumber(line?.qty_value);
  const uom = String(line?.qty_uom || line?.uom || "").toUpperCase();
  if (uom === "KG") return qty;
  const unitWeight = safeNumber(line?.unit_weight_g);
  if (uom === "PCS" && unitWeight > 0) return (qty * unitWeight) / 1000;
  return qty;
}

function batchRows(line: any): any[] {
  return asArray(line?.production_batch_summary?.batches);
}

function batchPlannedKg(line: any, batch: any): number {
  const planned = safeNumber(batch?.planned_qty);
  const uom = String(batch?.planned_uom || line?.qty_uom || line?.uom || "").toUpperCase();
  if (planned <= 0) return 0;
  if (uom === "PCS") {
    const unitWeight = safeNumber(line?.unit_weight_g);
    return unitWeight > 0 ? (planned * unitWeight) / 1000 : 0;
  }
  return planned;
}

function isClosedBatchStatus(statusValue: unknown): boolean {
  const status = String(statusValue || "").trim().toUpperCase();
  return ["CANCELLED", "COMPLETED", "PACKED", "DISPATCHED", "CLOSED", "DISPATCH_READY", "PACKING_READY"].some((token) => status.includes(token));
}

function isPreProductionBatchStatus(statusValue: unknown): boolean {
  const status = String(statusValue || "").trim().toUpperCase();
  return ["", "PLANNED", "RELEASED", "READY", "READY_TO_START", "QUEUED"].includes(status);
}

function hasBatchOutput(batch: any): boolean {
  return safeNumber(batch?.produced_qty_kg) > 0 || safeNumber(batch?.packed_qty_kg) > 0 || safeNumber(batch?.dispatched_qty_kg) > 0;
}

function isActiveJobState(stateValue: unknown): boolean {
  const state = String(stateValue || "").trim().toUpperCase();
  return ["EXECUTING", "RUNNING", "IN_PROGRESS", "PAUSED", "WAITING_JOIN", "JOIN_WAIT", "HOLD", "ON_HOLD", "BLOCKED"].includes(state);
}

function isWipBatch(batch: any): boolean {
  const status = String(batch?.status || "").trim().toUpperCase();
  if (isClosedBatchStatus(status)) return false;
  if (["RUNNING", "EXECUTING", "IN_PROGRESS", "PAUSED", "WAITING_JOIN", "JOIN_WAIT", "HOLD", "ON_HOLD", "BLOCKED"].includes(status)) return true;
  if (hasBatchOutput(batch) && !isPreProductionBatchStatus(status)) return true;
  return asArray(batch?.jobs).some((job) => isActiveJobState(job?.job_state || job?.status));
}

function lineMetrics(line: any) {
  const batches = batchRows(line);
  const orderedKg = lineOrderedKg(line);
  const status = String(line?.line_status || "").trim().toUpperCase();
  let producedKg =
    safeNumber(line?.production_batch_summary?.produced_kg) ||
    batches.reduce((sum, batch) => sum + safeNumber(batch?.produced_qty_kg), 0) ||
    safeNumber(line?.qty_final_output);
  if (producedKg <= 0 && ["PACKING_READY", "DISPATCH_READY", "COMPLETED"].includes(status)) {
    producedKg = orderedKg;
  }
  const packedKg =
    batches.reduce((sum, batch) => sum + safeNumber(batch?.packed_qty_kg), 0) ||
    safeNumber(line?.qty_dispatchable);
  const dispatchedKg =
    safeNumber(line?.production_batch_summary?.dispatched_kg) ||
    batches.reduce((sum, batch) => sum + safeNumber(batch?.dispatched_qty_kg), 0) ||
    safeNumber(line?.qty_dispatched);
  const readyGross = Math.max(producedKg, packedKg, dispatchedKg);
  const readyKg = Math.max(0, Math.min(orderedKg, readyGross) - Math.min(orderedKg, dispatchedKg));
  const liveBatchKg = batches.reduce(
    (sum, batch) => sum + (isWipBatch(batch) ? batchPlannedKg(line, batch) : 0),
    0,
  );
  const afterReady = Math.max(0, orderedKg - readyKg - Math.min(orderedKg, dispatchedKg));
  const wipKg = Math.min(afterReady, liveBatchKg);
  const bands = flowBandMetrics({ orderedKg, producedKg, packedKg, dispatchedKg, wipKg });
  return {
    orderedKg,
    producedKg,
    packedKg,
    readyKg: bands.readyKg,
    dispatchedKg,
    wipKg: bands.wipKg,
    openKg: bands.openKg,
    completionPct: bands.completePct,
    batches,
  };
}

function orderMetrics(order: SalesOrder, tracking?: OrderTrackingResponse) {
  const items = order.items || [];
  const lineRows = items.map((line) => lineMetrics(line));
  const fallbackOrdered = items.reduce((sum, line) => sum + lineOrderedKg(line), 0) || safeNumber(order.total_weight_kg);
  const kpi = (tracking?.kpi_snapshot || {}) as Record<string, any>;
  const orderedKg = lineRows.reduce((sum, row) => sum + row.orderedKg, 0) || safeNumber(kpi.ordered_kg) || fallbackOrdered;
  const dispatchedKg = lineRows.length
    ? lineRows.reduce((sum, row) => sum + row.dispatchedKg, 0)
    : safeNumber(kpi.dispatched_kg) || safeNumber(order.fulfillment_summary?.dispatched_kg);
  const readyGross = Math.max(safeNumber(kpi.produced_kg), safeNumber(kpi.packed_kg), safeNumber(kpi.dispatchable_kg), dispatchedKg);
  const readyKg = lineRows.length ? lineRows.reduce((sum, row) => sum + row.readyKg, 0) : Math.max(0, readyGross - dispatchedKg);
  const wipKg = lineRows.length ? lineRows.reduce((sum, row) => sum + row.wipKg, 0) : safeNumber(kpi.wip_kg);
  const openKg = flowBandMetrics({
    orderedKg,
    producedKg: readyKg + dispatchedKg,
    packedKg: readyKg + dispatchedKg,
    dispatchedKg,
    wipKg,
  }).openKg;
  return {
    orderedKg,
    readyKg,
    producedKg: readyKg + dispatchedKg,
    packedKg: readyKg + dispatchedKg,
    dispatchedKg,
    wipKg,
    openKg,
    scrapKg: safeNumber(kpi.scrap_kg),
    activeJobs: safeNumber(kpi.active_jobs) || (tracking?.active_jobs || []).length,
    completedJobs: safeNumber(kpi.completed_jobs) || (tracking?.completed_jobs || []).length,
  };
}

function jobsForLine(tracking: OrderTrackingResponse | undefined, line: any): any[] {
  const lineId = String(line?.id || "").trim();
  if (!lineId) return [];
  return (tracking?.job_steps || []).filter((job) => String((job as any).sales_order_item_id || "") === lineId);
}

function routeNodesForLine(line: any, jobs: any[]) {
  const batches = batchRows(line);
  const graphBatch = batches.find((batch) => Array.isArray(batch?.route_graph?.nodes) && batch.route_graph.nodes.length);
  const nodes = asArray(graphBatch?.route_graph?.nodes)
    .map((node) => asRecord(node))
    .sort((a, b) => safeNumber(a.route_index) - safeNumber(b.route_index));
  if (nodes.length) {
    const activeNodeId = String(graphBatch?.current_route_node_id || "").trim();
    const activeIndex = safeNumber(graphBatch?.current_step_index);
    const batchIsWip = isWipBatch(graphBatch);
    const batchClosed = isClosedBatchStatus(graphBatch?.status);
    return nodes.map((node, index) => ({
      id: String(node.id || node.process_code || node.label || index),
      label: String(node.label || node.process_code || "Step"),
      code: String(node.process_code || node.label || `S${index + 1}`),
      branch: String(node.branch_key || "MAIN"),
      join: String(node.join_key || ""),
      parallel: String(node.parallel_group || ""),
      active: batchIsWip && (activeNodeId ? activeNodeId === String(node.id || "") : safeNumber(node.route_index) === activeIndex),
      next: !batchIsWip && (activeNodeId ? activeNodeId === String(node.id || "") : safeNumber(node.route_index) === activeIndex),
      done: batchClosed || safeNumber(node.route_index) < activeIndex,
    }));
  }
  return jobs.map((job, index) => ({
    id: String((job as any).route_node_id || job.job_id || index),
    label: String((job as any).route_node?.route_node_label || job.step_name || job.process_code || "Step"),
    code: String(job.process_code || job.step_name || `S${index + 1}`),
    branch: String((job as any).route_branch_key || (job as any).route_node?.route_branch_key || "MAIN"),
    join: String((job as any).route_node?.join_key || ""),
    parallel: String((job as any).route_node?.parallel_group || ""),
    active: isActiveJobState(job.state),
    next: ["PLANNED", "RELEASED"].includes(String(job.state || "").toUpperCase()),
    done: String(job.state || "").toUpperCase() === "COMPLETED",
  }));
}

function geometrySummary(line: any) {
  const geometry = asRecord(line?.geometry_snapshot);
  const base = asRecord(geometry.base);
  return {
    width: base.width_mm ?? geometry.width_mm ?? geometry.roll_width_mm ?? geometry.final_web_width_mm,
    height: base.height_mm ?? geometry.height_mm,
    gusset: base.gusset_mm ?? geometry.gusset_mm,
    rollWidth: geometry.final_web_width_mm ?? geometry.roll_width_mm,
    style: geometry.pouch_style || geometry.pouch_style_code || geometry.roll_form,
  };
}

function bomComponents(line: any): any[] {
  return asArray(line?.bom_snapshot?.components || line?.bom_snapshot?.materials || line?.material_plan_summary?.components);
}

function lineProductSpec(line: any, order?: SalesOrder) {
  return normalizeProductSpec(
    {
      ...line,
      customer_name: order?.customer_name,
      order_number: order?.order_number,
      product_name: lineLabel(line, 0),
    },
    {},
  );
}

function axisEntries(line: any): Array<{ label: string; value: string }> {
  const axis = asRecord(line?.axis_values);
  return Object.entries(axis)
    .map(([key, value]) => ({
      label: key.replace(/_/g, " "),
      value: typeof value === "object" ? textValue((value as any)?.label, (value as any)?.name, JSON.stringify(value)) : textValue(value),
    }))
    .filter((entry) => entry.value)
    .slice(0, 8);
}

function rowQtyLabel(row: any): string {
  const qty = textValue(
    row?.required_qty,
    row?.required_kg,
    row?.planned_qty,
    row?.consumed_kg,
    row?.qty,
    row?.quantity,
    row?.weight_kg,
    row?.thickness_micron,
  );
  if (!qty) return "--";
  const unit = textValue(row?.required_uom, row?.uom, row?.unit, row?.qty_uom, row?.thickness_micron ? "u" : "");
  return `${qty}${unit ? ` ${unit}` : ""}`;
}

function bomRows(line: any) {
  const components = bomComponents(line);
  if (components.length) {
    return components.map((component, index) => ({
      key: textValue(component.id, component.material_id, `${index}`),
      label: textValue(component.material_code, component.material_name, component.name, component.code, `Material ${index + 1}`),
      detail: textValue(component.material_name, component.category, component.role, component.layer_role, component.grade),
      qty: rowQtyLabel(component),
      source: "BOM",
    }));
  }

  const spec = lineProductSpec(line);
  return spec.layers.map((layer, index) => ({
    key: `layer-${index}`,
    label: textValue(layer.variantCode, layer.variantName, `Layer ${index + 1}`),
    detail: [layer.variantName, layer.grade, layer.widthMm ? `${fmtQty(layer.widthMm)} mm` : ""].filter(Boolean).join(" · "),
    qty: layer.thicknessMicron ? `${fmtQty(layer.thicknessMicron)} u` : "--",
    source: "Layer",
  }));
}

function packagingFacts(line: any): Array<{ label: string; value: string }> {
  const packaging = asRecord(line?.packaging_snapshot);
  const primary = asRecord(packaging.primary_inner_pack);
  const pod = asRecord(packaging.pod);
  const rollPack = asRecord(packaging.roll_dispatch_pack);
  const facts = [
    { label: "Inner pack", value: primary.enabled ? textValue(primary.material_code, primary.material_name, "Enabled") : "" },
    { label: "Pcs / pack", value: textValue(primary.pcs_per_pack) },
    { label: "POD", value: pod.enabled ? textValue(pod.pod_sku_code, pod.pod_sku_name, "Enabled") : "" },
    { label: "Roll dispatch pack", value: rollPack.enabled ? `${asArray(rollPack.lines).length || 1} line${asArray(rollPack.lines).length === 1 ? "" : "s"}` : "" },
  ];
  return facts.filter((fact) => fact.value);
}

function eventTone(eventType?: string | null) {
  const type = String(eventType || "").toUpperCase();
  if (type.includes("DISPATCH")) return "green";
  if (type.includes("SCRAP") || type.includes("CANCEL")) return "rose";
  if (type.includes("MATERIAL") || type.includes("CONSUM")) return "amber";
  if (type.includes("OUTPUT") || type.includes("CLOSED")) return "blue";
  return "slate";
}

function lineSpecChips(line: any): Array<{ label: string; tone: "slate" | "blue" | "green" | "amber" | "violet" }> {
  const geometry = geometrySummary(line);
  const layers = asArray(line?.layer_snapshot?.layers || line?.layer_snapshot || line?.bom_snapshot?.layers);
  const printing = asRecord(line?.printing_snapshot);
  return [
    { label: String(line?.product_master_code || line?.product_master_name || "").trim(), tone: "violet" as const },
    { label: String(line?.template_name || "").trim(), tone: "slate" as const },
    { label: String(line?.price_basis || line?.qty_uom || "").trim(), tone: "slate" as const },
    { label: geometry.style ? `Style ${geometry.style}` : "", tone: "blue" as const },
    { label: geometry.rollWidth ? `Web ${fmtQty(geometry.rollWidth)} mm` : "", tone: "green" as const },
    { label: geometry.width ? `Width ${fmtQty(geometry.width)} mm` : "", tone: "blue" as const },
    { label: geometry.height ? `Height ${fmtQty(geometry.height)} mm` : "", tone: "blue" as const },
    { label: printing.artwork_design_code ? `Art ${printing.artwork_design_code}` : "", tone: "amber" as const },
    { label: layers.length ? `${layers.length} layer${layers.length === 1 ? "" : "s"}` : "", tone: "amber" as const },
  ].filter((chip) => chip.label).slice(0, 10);
}

function chipClass(tone: "slate" | "blue" | "green" | "amber" | "violet") {
  return {
    slate: "border-line bg-surface-2 text-content-2",
    blue: "border-info-border bg-info-bg text-primary",
    green: "border-success-border bg-success-bg text-success-fg",
    amber: "border-warning-border bg-warning-bg text-warning-fg",
    violet: "border-order-border bg-order-bg text-order-fg",
  }[tone];
}

function LineSpecChips({ line }: { line: any }) {
  const chips = lineSpecChips(line);
  if (!chips.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {chips.map((chip, index) => (
        <span
          key={`${chip.label}-${index}`}
          className={cn("inline-flex max-w-full items-center truncate rounded-lg border px-2.5 py-1 text-[10px] font-black uppercase", chipClass(chip.tone))}
        >
          {chip.label}
        </span>
      ))}
    </div>
  );
}

function lineArtworkPreview(line: any) {
  const preview = asRecord(line?.artwork_preview);
  const printing = asRecord(line?.printing_snapshot);
  const code = String(preview.design_code || printing.artwork_design_code || "").trim();
  const name = String(preview.name || printing.artwork_name || "").trim();
  const thumbnailUrl = String(preview.thumbnail_url || "").trim();
  const colorCount = safeNumber(preview.color_count || printing.colors_count || printing.front_colors_count);
  if (!code && !name && !thumbnailUrl) return null;
  return { code, name, thumbnailUrl, colorCount };
}

function orderArtworkPreview(order: SalesOrder) {
  return [...(order.items || [])]
    .sort((a, b) => lineOrderedKg(b) - lineOrderedKg(a))
    .map(lineArtworkPreview)
    .find(Boolean) || null;
}

function ArtworkThumb({ preview, compact = false }: { preview: ReturnType<typeof lineArtworkPreview>; compact?: boolean }) {
  if (!preview) return null;
  const label = preview.code || preview.name || "Artwork";
  return (
    <div className={cn("flex items-center gap-2 rounded-xl border border-line bg-surface-1 p-1.5 shadow-sm", compact ? "max-w-[13rem]" : "max-w-[20rem]")}>
      <div className={cn("grid flex-none place-items-center overflow-hidden rounded-lg border border-line bg-info-bg", compact ? "h-10 w-14" : "h-16 w-24")}>
        {preview.thumbnailUrl ? (
          <img src={preview.thumbnailUrl} alt={label} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <ImageIcon className="h-4 w-4 text-primary" />
        )}
      </div>
      <div className="min-w-0">
        <div className="text-[9px] font-black uppercase tracking-[0.16em] text-content-4">Artwork</div>
        <div className="truncate font-mono text-[11px] font-black text-order-fg">{label}</div>
        {preview.colorCount ? <div className="text-[10px] font-bold text-content-3">{preview.colorCount} colors</div> : null}
      </div>
    </div>
  );
}

function LineColorIcon({ index, className }: { index: number; className?: string }) {
  const tone = LINE_PROGRESS_TONES[index % LINE_PROGRESS_TONES.length];
  return (
    <span
      className={cn("inline-flex h-5 w-5 flex-none items-center justify-center rounded-full text-[9px] font-black text-white shadow-sm ring-2 ring-surface-1", className)}
      style={{ background: tone.fill }}
      title={`Line ${index + 1}`}
    >
      {index + 1}
    </span>
  );
}

function OrderFlowBar({ lines }: { lines: SalesOrderLine[] }) {
  const rows = lines
    .map((line, index) => ({ line, index, metrics: lineMetrics(line) }))
    .filter((row) => row.metrics.orderedKg > 0);
  const totalKg = rows.reduce((sum, row) => sum + row.metrics.orderedKg, 0);
  if (!rows.length || totalKg <= 0) return null;
  const totals = rows.reduce(
    (acc, row) => ({
      ready: acc.ready + row.metrics.readyKg,
      dispatched: acc.dispatched + row.metrics.dispatchedKg,
      wip: acc.wip + row.metrics.wipKg,
      open: acc.open + row.metrics.openKg,
    }),
    { ready: 0, dispatched: 0, wip: 0, open: 0 },
  );
  const completePct = percent(totals.ready + totals.dispatched, totalKg);
  return (
    <div className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-content-4">Order fulfillment</div>
          <div className="mt-1 font-mono text-lg font-black text-content-1">{fmtKg(totalKg)} kg</div>
        </div>
        <div className="text-right font-mono text-sm font-black text-content-1">{Math.round(completePct)}%</div>
      </div>
      <div className="flex h-7 w-full overflow-hidden rounded-lg border border-line bg-surface-2 shadow-inner">
        {rows.map((row) => {
          const tone = LINE_PROGRESS_TONES[row.index % LINE_PROGRESS_TONES.length];
          const segmentPct = Math.max(2, (row.metrics.orderedKg / totalKg) * 100);
          const lineTotal = row.metrics.orderedKg || 1;
          return (
            <div
              key={row.line.id || row.index}
              className="flex h-full overflow-hidden border-r-2 border-surface-1/80 last:border-r-0"
              style={{ width: `${segmentPct}%`, background: "rgba(148,163,184,.14)" }}
              title={`${lineLabel(row.line, row.index)} · ${fmtKg(row.metrics.orderedKg)} KG · ready ${fmtKg(row.metrics.readyKg)} · dispatched ${fmtKg(row.metrics.dispatchedKg)} · WIP ${fmtKg(row.metrics.wipKg)} · open ${fmtKg(row.metrics.openKg)}`}
            >
              <div
                className="h-full"
                style={{
                  width: `${(row.metrics.dispatchedKg / lineTotal) * 100}%`,
                  background: `repeating-linear-gradient(45deg, ${tone.dark} 0 6px, ${tone.fill} 6px 10px)`,
                }}
              />
              <div className="h-full" style={{ width: `${(row.metrics.readyKg / lineTotal) * 100}%`, background: tone.fill }} />
              <div className="h-full" style={{ width: `${(row.metrics.wipKg / lineTotal) * 100}%`, background: tone.light }} />
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-3 text-[11px] font-bold text-content-3">
        <LegendSwatch label="Dispatched" value={totals.dispatched} swatch="hatch" />
        <LegendSwatch label="Ready" value={totals.ready} color={FLOW_COLORS.ready} />
        <LegendSwatch label="WIP" value={totals.wip} color={FLOW_COLORS.wip} light />
        <LegendSwatch label="Open" value={totals.open} color={FLOW_COLORS.open} />
      </div>
      <div className="flex flex-wrap gap-2">
        {rows.slice(0, 10).map((row) => {
          const tone = LINE_PROGRESS_TONES[row.index % LINE_PROGRESS_TONES.length];
          return (
            <span
              key={row.line.id || row.index}
              className={cn("inline-flex items-center gap-1.5 rounded-lg border bg-surface-1 px-2.5 py-1 text-[10px] font-black uppercase", tone.text, tone.border)}
            >
              <LineColorIcon index={row.index} className="h-4 w-4 text-[8px]" />
              L{row.index + 1}: {fmtKg(row.metrics.orderedKg)} kg
            </span>
          );
        })}
      </div>
    </div>
  );
}

function LegendSwatch({ label, value, color, swatch, light }: { label: string; value: number; color?: string; swatch?: "hatch"; light?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="h-3.5 w-3.5 rounded-[4px] border border-line"
        style={{
          background: swatch === "hatch" ? "repeating-linear-gradient(45deg, #1e40af 0 5px, #2563eb 5px 8px)" : color,
          opacity: light ? 0.75 : 1,
        }}
      />
      {label} <b className="font-mono text-content-1">{fmtKg(value)} kg</b>
    </span>
  );
}

function LineHeaderChip({ line, index }: { line: SalesOrderLine; index: number }) {
  const tone = LINE_PROGRESS_TONES[index % LINE_PROGRESS_TONES.length];
  const metrics = lineMetrics(line);
  return (
    <div className={cn("min-w-0 rounded-xl border bg-surface-1 px-3 py-2 shadow-sm", tone.border)}>
      <div className="flex items-center gap-2">
        <LineColorIcon index={index} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-xs font-black text-content-1">
            L{index + 1} · {lineLabel(line, index)} · {fmtKg(metrics.orderedKg)} kg
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {lineSpecChips(line).slice(0, 4).map((chip, chipIndex) => (
              <span key={`${chip.label}-${chipIndex}`} className={cn("rounded-md border px-1.5 py-0.5 text-[9px] font-black uppercase", chipClass(chip.tone))}>
                {chip.label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricTile({ label, value, sub, tone = "slate", icon }: { label: string; value: string; sub?: string; tone?: "slate" | "blue" | "green" | "amber" | "rose" | "violet"; icon: ReactNode }) {
  const toneClass =
    tone === "blue"
      ? "bg-info-bg text-primary ring-info-border"
      : tone === "green"
        ? "bg-success-bg text-success-fg ring-success-border"
        : tone === "amber"
          ? "bg-warning-bg text-warning-fg ring-warning-border"
          : tone === "rose"
            ? "bg-danger-bg text-danger-fg ring-danger-border"
            : tone === "violet"
              ? "bg-order-bg text-order-fg ring-order-border"
              : "bg-surface-2 text-content-2 ring-line";
  return (
    <div className="min-w-0 rounded-xl border border-line bg-surface-1 p-4 shadow-sm">
      <div className={cn("mb-3 flex h-9 w-9 items-center justify-center rounded-lg ring-1", toneClass)}>{icon}</div>
      <div className="text-[10px] font-black uppercase tracking-[0.18em] text-content-4">{label}</div>
      <div className="mt-1 font-mono text-xl font-black text-content-1">{value}</div>
      {sub ? <div className="mt-1 text-[11px] font-semibold text-content-3">{sub}</div> : null}
    </div>
  );
}

function ProgressBar({ metrics, tone }: { metrics: ReturnType<typeof lineMetrics>; tone?: (typeof LINE_PROGRESS_TONES)[number] }) {
  const t = tone || LINE_PROGRESS_TONES[0];
  const bands = flowBandMetrics({
    orderedKg: metrics.orderedKg,
    producedKg: metrics.readyKg + metrics.dispatchedKg,
    packedKg: metrics.readyKg + metrics.dispatchedKg,
    dispatchedKg: metrics.dispatchedKg,
    wipKg: metrics.wipKg,
  });
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[10px] font-black uppercase tracking-[0.16em] text-content-4">
        <span>Ready · dispatched · WIP · open</span>
        <span>{Math.round(bands.completePct)}%</span>
      </div>
      <div className="h-3 overflow-hidden rounded-full border border-line bg-surface-2">
        <div className="flex h-full">
          <div style={{ width: `${bands.dispatchedPct}%`, background: `repeating-linear-gradient(45deg, ${t.dark} 0 5px, ${t.fill} 5px 8px)` }} />
          <div style={{ width: `${bands.readyPct}%`, background: t.fill }} />
          <div style={{ width: `${bands.wipPct}%`, background: t.light }} />
          <div style={{ width: `${bands.openPct}%`, background: FLOW_COLORS.open }} />
        </div>
      </div>
    </div>
  );
}

function RouteGraph({ line, jobs }: { line: SalesOrderLine; jobs: any[] }) {
  const nodes = routeNodesForLine(line, jobs);
  if (!nodes.length) {
    return <div className="rounded-xl border border-dashed border-line bg-surface-2 px-4 py-8 text-center text-sm font-semibold text-content-3">Route graph will appear after planner release.</div>;
  }
  const stepGap = 150;
  const width = Math.max(660, 120 + (nodes.length - 1) * stepGap);
  const yFor = (node: any) => (node.branch !== "MAIN" || node.parallel ? 138 : 86);
  const doneCount = nodes.filter((node) => node.done).length;
  const liveCount = nodes.filter((node) => node.active).length;
  const nextCount = nodes.filter((node) => node.next).length;
  return (
    <div className="rounded-xl border border-line bg-surface-2 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.16em] text-content-4">
          <Route className="h-4 w-4 text-primary" /> Route graph
        </div>
        <div className="flex flex-wrap gap-2 text-[10px] font-black uppercase">
          <span className="rounded-full bg-success-bg px-2 py-1 text-success-fg ring-1 ring-success-border">Done {doneCount}</span>
          <span className="rounded-full bg-order-bg px-2 py-1 text-order-fg ring-1 ring-order-border">Live {liveCount}</span>
          <span className="rounded-full bg-warning-bg px-2 py-1 text-warning-fg ring-1 ring-warning-border">Next {nextCount}</span>
          <span className="rounded-full bg-surface-1 px-2 py-1 text-content-3 ring-1 ring-line">Open {Math.max(0, nodes.length - doneCount - liveCount - nextCount)}</span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${width} 186`} width={width} height="186" className="max-w-none">
          {nodes.map((node, index) => {
            if (index === 0) return null;
            const prev = nodes[index - 1];
            const x1 = 60 + (index - 1) * stepGap + 24;
            const x2 = 60 + index * stepGap - 24;
            const y1 = yFor(prev);
            const y2 = yFor(node);
            const activeEdge = prev.done || prev.active || node.done || node.active;
            return (
              <path
                key={`edge-${node.id}-${index}`}
                d={`M ${x1} ${y1} C ${x1 + 36} ${y1}, ${x2 - 36} ${y2}, ${x2} ${y2}`}
                fill="none"
                stroke={activeEdge ? "#10b981" : "#cbd5e1"}
                strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray={node.parallel || node.join ? "8 8" : undefined}
                opacity={activeEdge ? 0.95 : 0.7}
              />
            );
          })}
          {nodes.map((node, index) => {
            const x = 60 + index * stepGap;
            const y = yFor(node);
            const state = node.done ? "done" : node.active ? "live" : node.next ? "next" : "open";
            const circleFill = state === "done" ? "#10b981" : state === "live" ? "#2563eb" : state === "next" ? "#f59e0b" : "#f8fafc";
            const circleStroke = state === "open" ? "#cbd5e1" : circleFill;
            return (
              <g key={`${node.id}-${index}`} transform={`translate(${x}, ${y})`}>
                <circle r="24" fill={circleFill} stroke={circleStroke} strokeWidth="5" opacity={state === "open" ? 0.92 : 1} />
                <text textAnchor="middle" dy="5" fill={state === "open" ? "#64748b" : "#fff"} fontSize="16" fontWeight="900">
                  {state === "done" ? "✓" : index + 1}
                </text>
                <text textAnchor="middle" y="46" fill="#0f172a" className="fill-content-1" fontSize="11" fontWeight="900">
                  {String(node.label).slice(0, 16)}
                </text>
                <text textAnchor="middle" y="62" fill="#64748b" fontSize="10" fontWeight="700">
                  {[node.branch, node.parallel, node.join].filter(Boolean).slice(0, 2).join(" · ")}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function JobBreakdown({ jobs }: { jobs: any[] }) {
  if (!jobs.length) {
    return <div className="rounded-xl border border-dashed border-line bg-surface-1 px-4 py-6 text-center text-sm font-semibold text-content-3">No production jobs generated for this line yet.</div>;
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-black text-content-1">Job-wise breakdown</div>
        <Badge className="rounded-full bg-info-bg text-primary ring-1 ring-info-border">{jobs.filter((job) => !["COMPLETED", "CANCELLED"].includes(String(job.state || "").toUpperCase())).length} active</Badge>
      </div>
      {jobs.slice(0, 10).map((job, index) => {
        const state = String(job.state || "").toUpperCase();
        const active = isActiveJobState(state);
        const done = state === "COMPLETED";
        return (
          <div key={job.job_id || index} className={cn("grid gap-3 rounded-xl border bg-surface-1 px-4 py-3 text-sm shadow-sm md:grid-cols-[48px_minmax(0,1fr)_auto_auto]", active ? "border-info-border" : done ? "border-success-border" : "border-line")}>
            <div className="grid h-9 w-9 place-items-center rounded-lg border border-line bg-surface-2 font-mono text-[11px] font-black text-content-3">{index + 1}/{jobs.length}</div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-black text-content-1">{job.job_number || job.job_id}</span>
                <Badge variant="outline" className={cn("rounded-full text-[9px] font-black uppercase", active ? "border-info-border bg-info-bg text-primary" : done ? "border-success-border bg-success-bg text-success-fg" : "border-line bg-surface-2 text-content-3")}>
                  {statusLabel(job.state)}
                </Badge>
              </div>
              <div className="mt-1 truncate text-xs font-semibold text-content-3">
                {job.step_name || job.process_code || "Step"} · {job.production_batch_number || "batch pending"} · {job.operator || job.operator_username || "operator pending"}
              </div>
            </div>
            <div className="font-mono text-xs font-black text-content-2">{job.work_center || job.work_center_code || "WC pending"}</div>
            <div className="min-w-[110px]">
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div className={cn("h-full rounded-full", done ? "bg-success-fg" : active ? "bg-primary" : "bg-warning-fg")} style={{ width: `${done ? 100 : active ? 56 : 12}%` }} />
              </div>
              <div className="mt-1 text-right font-mono text-xs font-black text-content-1">{fmtKg(job.produced_kg)} kg</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MiniStat({ label, value, tone = "slate" }: { label: string; value: string; tone?: "slate" | "blue" | "green" | "amber" | "rose" | "violet" }) {
  const text =
    tone === "blue" ? "text-primary" : tone === "green" ? "text-success-fg" : tone === "amber" ? "text-warning-fg" : tone === "rose" ? "text-danger-fg" : tone === "violet" ? "text-order-fg" : "text-content-1";
  return (
    <div className="rounded-lg border border-line bg-surface-1 px-3 py-2">
      <div className="text-[9px] font-black uppercase tracking-wide text-content-4">{label}</div>
      <div className={cn("mt-1 font-mono text-sm font-black", text)}>{value}</div>
    </div>
  );
}

function BatchInspector({ line, jobs }: { line: SalesOrderLine; jobs: any[] }) {
  const metrics = lineMetrics(line);
  const batches = metrics.batches;
  const components = bomComponents(line);
  return (
    <aside className="space-y-4 rounded-xl border border-line bg-surface-2 p-4">
      <div className="grid grid-cols-2 gap-2">
        <MiniStat label="Ordered" value={`${fmtKg(metrics.orderedKg)} kg`} />
        <MiniStat label="Ready" value={`${fmtKg(metrics.readyKg)} kg`} tone="blue" />
        <MiniStat label="WIP" value={`${fmtKg(metrics.wipKg)} kg`} tone="violet" />
        <MiniStat label="Dispatched" value={`${fmtKg(metrics.dispatchedKg)} kg`} tone="green" />
        <MiniStat label="Open" value={`${fmtKg(metrics.openKg)} kg`} tone="rose" />
        <MiniStat label="Scrap" value={`${fmtKg(jobs.reduce((sum, job) => sum + safeNumber(job.scrap_kg), 0))} kg`} tone="amber" />
      </div>
      <div>
        <div className="mb-2 text-[11px] font-black uppercase tracking-[0.16em] text-content-4">Batches</div>
        <div className="space-y-2">
          {batches.length ? batches.slice(0, 6).map((batch) => (
            <div key={batch.id || batch.batch_number} className="rounded-lg border border-line bg-surface-1 px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-mono text-[11px] font-black text-content-1">{batch.batch_number}</div>
                  <div className="mt-1 text-[10px] font-semibold text-content-3">{batch.current_route_node_label || batch.current_route_process_code || "Route pending"}</div>
                </div>
                <Badge variant="outline" className="rounded-full text-[8px] font-black uppercase">{statusLabel(batch.status)}</Badge>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-1 text-[9px] font-semibold text-content-3">
                <span className="rounded bg-surface-2 px-1.5 py-1">Out <b className="text-content-1">{fmtKg(batch.produced_qty_kg)}</b></span>
                <span className="rounded bg-surface-2 px-1.5 py-1">Pack <b className="text-content-1">{fmtKg(batch.packed_qty_kg)}</b></span>
                <span className="rounded bg-surface-2 px-1.5 py-1">Send <b className="text-content-1">{fmtKg(batch.dispatched_qty_kg)}</b></span>
              </div>
            </div>
          )) : (
            <div className="rounded-lg border border-dashed border-line bg-surface-1 px-3 py-5 text-center text-xs font-semibold text-content-3">No batches released yet.</div>
          )}
        </div>
      </div>
      <div>
        <div className="mb-2 text-[11px] font-black uppercase tracking-[0.16em] text-content-4">Layer stack / BOM</div>
        <div className="space-y-1.5">
          {components.length ? components.slice(0, 6).map((component, index) => (
            <div key={component.id || component.material_id || index} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-1 px-3 py-2 text-xs">
              <span className="min-w-0 truncate font-bold text-content-2">{component.material_code || component.material_name || component.name || `Layer ${index + 1}`}</span>
              <span className="font-mono font-black text-primary">{component.required_qty || component.qty || component.thickness_micron || "--"}</span>
            </div>
          )) : (
            <div className="rounded-lg border border-dashed border-line bg-surface-1 px-3 py-5 text-center text-xs font-semibold text-content-3">No BOM snapshot on this line.</div>
          )}
        </div>
      </div>
    </aside>
  );
}

function LineTrackerSection({ line, index, tracking }: { line: SalesOrderLine; index: number; tracking?: OrderTrackingResponse }) {
  const metrics = lineMetrics(line);
  const jobs = jobsForLine(tracking, line);
  const tone = LINE_PROGRESS_TONES[index % LINE_PROGRESS_TONES.length];
  const artwork = lineArtworkPreview(line);
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-surface-1 shadow-sm" style={{ borderLeftColor: tone.fill, borderLeftWidth: 4 }}>
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <LineColorIcon index={index} />
            <h2 className="min-w-0 truncate font-mono text-base font-black text-content-1">
              L{index + 1} · {lineLabel(line, index)} · {fmtKg(metrics.orderedKg)} kg
            </h2>
            <Badge variant="outline" className="rounded-full text-[10px] font-black uppercase">{line.line_status_display || statusLabel(line.line_status)}</Badge>
            {metrics.batches.length ? <Badge className="rounded-full bg-info-bg text-primary ring-1 ring-info-border">{metrics.batches.length} batch{metrics.batches.length === 1 ? "" : "es"}</Badge> : null}
          </div>
          <div className="mt-1 text-xs font-semibold text-content-3">
            {line.template_name || line.product_master_name || "Template snapshot"} · Route batch production and commercial demand stay tied to this line.
          </div>
          <LineSpecChips line={line} />
        </div>
        <ArtworkThumb preview={artwork} compact />
        <div className="text-right">
          <div className="font-mono text-2xl font-black text-content-1">{Math.round(metrics.completionPct)}%</div>
          <div className="text-[10px] font-black uppercase tracking-wide text-content-4">complete</div>
        </div>
      </div>
      <div className="grid items-start gap-0 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-4 p-5">
          <ProgressBar metrics={metrics} tone={tone} />
          <RouteGraph line={line} jobs={jobs} />
          <JobBreakdown jobs={jobs} />
        </div>
        <div className="border-t border-line p-5 xl:border-l xl:border-t-0">
          <BatchInspector line={line} jobs={jobs} />
        </div>
      </div>
    </section>
  );
}

function FactBox({ label, value, tone = "slate" }: { label: string; value: string; tone?: "slate" | "blue" | "green" | "amber" | "violet" | "rose" }) {
  const toneClass =
    tone === "blue"
      ? "bg-info-bg text-primary ring-info-border"
      : tone === "green"
        ? "bg-success-bg text-success-fg ring-success-border"
        : tone === "amber"
          ? "bg-warning-bg text-warning-fg ring-warning-border"
          : tone === "violet"
            ? "bg-order-bg text-order-fg ring-order-border"
            : tone === "rose"
              ? "bg-danger-bg text-danger-fg ring-danger-border"
              : "bg-surface-1 text-content-1 ring-line";
  return (
    <div className={cn("rounded-xl px-3 py-2.5 ring-1", toneClass)}>
      <div className="text-[9px] font-black uppercase tracking-[0.16em] opacity-70">{label}</div>
      <div className="mt-1 break-words font-mono text-sm font-black">{value || "--"}</div>
    </div>
  );
}

function SectionTitle({ icon, label, sub }: { icon: ReactNode; label: string; sub?: string }) {
  return (
    <div className="mb-3 flex items-start gap-2">
      <div className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-info-bg text-primary ring-1 ring-info-border">{icon}</div>
      <div>
        <div className="text-[11px] font-black uppercase tracking-[0.18em] text-content-4">{label}</div>
        {sub ? <div className="mt-0.5 text-xs font-semibold text-content-3">{sub}</div> : null}
      </div>
    </div>
  );
}

function TechnicalLine({ line, index, order }: { line: SalesOrderLine; index: number; order: SalesOrder }) {
  const geometry = geometrySummary(line);
  const spec = lineProductSpec(line, order);
  const rows = bomRows(line);
  const metrics = lineMetrics(line);
  const printing = asRecord(line.printing_snapshot);
  const artwork = lineArtworkPreview(line);
  const packaging = packagingFacts(line);
  const axis = axisEntries(line);
  const tone = LINE_PROGRESS_TONES[index % LINE_PROGRESS_TONES.length];
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-surface-1 shadow-sm" style={{ borderLeftColor: tone.fill, borderLeftWidth: 4 }}>
      <div className="border-b border-line bg-gradient-to-r from-info-bg via-surface-1 to-success-bg px-5 py-4 dark:from-info-bg/40 dark:via-surface-1 dark:to-success-bg/30">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <LineColorIcon index={index} />
              <h2 className="min-w-0 truncate font-mono text-base font-black text-content-1">
                L{index + 1} · {spec.productName || lineLabel(line, index)}
              </h2>
              <Badge variant="outline" className="rounded-full bg-surface-1 text-[10px] font-black uppercase">{line.line_status_display || statusLabel(line.line_status)}</Badge>
              <Badge className="rounded-full bg-info-bg text-primary ring-1 ring-info-border">{fmtKg(metrics.orderedKg)} kg demand</Badge>
            </div>
            <div className="mt-1 text-xs font-semibold text-content-3">
              Product master snapshot, commercial order details, geometry, print, packaging, and frozen BOM for this line.
            </div>
            <LineSpecChips line={line} />
          </div>
          <ArtworkThumb preview={artwork} compact />
        </div>
      </div>

      <div className="grid gap-4 p-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="space-y-4">
          <div className="rounded-2xl border border-line bg-surface-2 p-4">
            <SectionTitle icon={<Package className="h-4 w-4" />} label="Product master and order snapshot" sub="What Sales committed commercially for this line." />
            <div className="grid gap-2 sm:grid-cols-2">
              <FactBox label="Product master" value={textValue(line.product_master_code, line.product_master_name, spec.productName)} tone="violet" />
              <FactBox label="Template" value={textValue(line.template_name, spec.templateName)} />
              <FactBox label="Order quantity" value={`${fmtKg(metrics.orderedKg)} kg${line.qty_uom ? ` · ${fmtQty(line.qty_value)} ${line.qty_uom}` : ""}`} tone="blue" />
              <FactBox label="Price basis" value={textValue(line.price_basis, line.qty_uom, "KG")} />
              <FactBox label="Line status" value={line.line_status_display || statusLabel(line.line_status)} tone={metrics.readyKg > 0 ? "green" : metrics.wipKg > 0 ? "violet" : "slate"} />
              <FactBox label="Open demand" value={`${fmtKg(metrics.openKg)} kg`} tone={metrics.openKg > 0 ? "amber" : "green"} />
            </div>
            {axis.length ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {axis.map((entry) => (
                  <span key={`${entry.label}-${entry.value}`} className="rounded-lg border border-line bg-surface-1 px-2.5 py-1 text-[10px] font-black uppercase text-content-2">
                    {entry.label}: <span className="text-primary">{entry.value}</span>
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-line bg-surface-2 p-4">
            <SectionTitle icon={<Scale className="h-4 w-4" />} label="Geometry and production form" sub="Dimensions used for routing, production math, and dispatch proof." />
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <FactBox label="Size" value={spec.size.label} tone="blue" />
              <FactBox label="Width" value={geometry.width ? `${fmtQty(geometry.width)} mm` : textValue(spec.size.widthMm && `${fmtQty(spec.size.widthMm)} mm`)} />
              <FactBox label="Height" value={geometry.height ? `${fmtQty(geometry.height)} mm` : textValue(spec.size.heightMm && `${fmtQty(spec.size.heightMm)} mm`)} />
              <FactBox label="Gusset" value={geometry.gusset ? `${fmtQty(geometry.gusset)} mm` : textValue(spec.size.gussetMm && `${fmtQty(spec.size.gussetMm)} mm`)} />
              <FactBox label="Roll web" value={geometry.rollWidth ? `${fmtQty(geometry.rollWidth)} mm` : "--"} tone="green" />
              <FactBox label="Finished form" value={textValue(spec.size.finishedGoodType, geometry.style, spec.size.formLabel, "ROLL/POUCH")} />
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-line bg-surface-2 p-4">
              <SectionTitle icon={<ImageIcon className="h-4 w-4" />} label="Artwork and print" />
              <div className="space-y-2">
                <FactBox label="Artwork" value={textValue(artwork?.code, artwork?.name, printing.enabled ? "Artwork required" : "No artwork on line")} tone={artwork ? "amber" : "slate"} />
                <FactBox label="Print type" value={textValue(printing.type, printing.method, printing.enabled ? "Printing enabled" : "Unprinted / no print gate")} />
                <FactBox label="Colors" value={textValue(printing.colors_count, printing.front_colors_count, printing.back_colors_count, artwork?.colorCount)} tone="blue" />
              </div>
            </div>
            <div className="rounded-2xl border border-line bg-surface-2 p-4">
              <SectionTitle icon={<PackageCheck className="h-4 w-4" />} label="Packing rules" />
              <div className="space-y-2">
                {packaging.length ? packaging.map((fact) => (
                  <FactBox key={fact.label} label={fact.label} value={fact.value} tone={fact.label === "POD" ? "green" : "slate"} />
                )) : (
                  <FactBox label="Packing snapshot" value={textValue(line.packaging_snapshot ? "Standard pack rules captured" : "Uses default packing rules")} />
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-line bg-gradient-to-br from-surface-2 via-surface-1 to-info-bg/70 p-4 dark:to-info-bg/20">
            <SectionTitle icon={<Layers className="h-4 w-4" />} label="Layer architecture" sub="Frozen on this order line from product master/template." />
            {spec.layers.length ? (
              <div className="space-y-2">
                <div className="flex h-10 overflow-hidden rounded-xl border border-line bg-surface-1">
                  {spec.layers.map((layer, layerIndex) => (
                    <div
                      key={`bar-${layer.index}-${layerIndex}`}
                      className="grid min-w-[64px] place-items-center border-r border-surface-1/80 px-2 text-[10px] font-black text-white last:border-r-0"
                      style={{ background: LINE_PROGRESS_TONES[layerIndex % LINE_PROGRESS_TONES.length].fill, width: `${100 / spec.layers.length}%` }}
                    >
                      L{layer.index}
                    </div>
                  ))}
                </div>
                {spec.layers.map((layer, layerIndex) => (
                  <div key={`${layer.label}-${layerIndex}`} className="rounded-xl border border-line bg-surface-1 px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-mono text-xs font-black text-content-1">L{layer.index} · {textValue(layer.variantCode, layer.variantName)}</div>
                        <div className="mt-0.5 truncate text-[11px] font-semibold text-content-3">{textValue(layer.variantName, layer.label)}</div>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {layer.thicknessMicron ? <Badge className="rounded-full bg-warning-bg text-warning-fg ring-1 ring-warning-border">{fmtQty(layer.thicknessMicron)}u</Badge> : null}
                        {layer.widthMm ? <Badge className="rounded-full bg-info-bg text-primary ring-1 ring-info-border">{fmtQty(layer.widthMm)}mm</Badge> : null}
                        {layer.grade ? <Badge variant="outline" className="rounded-full">{layer.grade}</Badge> : null}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-warning-border bg-warning-bg px-4 py-5 text-sm font-semibold text-warning-fg">
                Layer stack is not present on this order snapshot. Update the product/template before releasing new orders.
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-line bg-surface-2 p-4">
            <SectionTitle icon={<Boxes className="h-4 w-4" />} label="BOM and material architecture" sub={rows.length ? `${rows.length} material/layer row${rows.length === 1 ? "" : "s"}` : "No material rows available"} />
            {rows.length ? (
              <div className="space-y-2">
                {rows.slice(0, 14).map((row, cIndex) => (
                  <div key={row.key || cIndex} className="grid gap-2 rounded-xl border border-line bg-surface-1 px-3 py-2 text-xs sm:grid-cols-[minmax(0,1fr)_auto_auto]">
                    <div className="min-w-0">
                      <div className="truncate font-bold text-content-1">{row.label}</div>
                      <div className="mt-0.5 truncate text-[10px] font-semibold text-content-3">{row.detail || row.source}</div>
                    </div>
                    <Badge variant="outline" className="w-fit rounded-full text-[9px] font-black uppercase">{row.source}</Badge>
                    <div className="font-mono font-black text-primary">{row.qty}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-warning-border bg-warning-bg px-4 py-5 text-sm font-semibold text-warning-fg">
                BOM rows are not populated on this frozen snapshot. New orders will show template material rows after template/BOM data is updated.
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function DocAction({ href, label = "Open" }: { href: string; label?: string }) {
  return (
    <Button asChild variant="outline" size="sm" className="h-9 rounded-lg">
      <Link href={href}>
        {label} <ArrowRight className="ml-1 h-3.5 w-3.5" />
      </Link>
    </Button>
  );
}

function EvidenceRow({
  title,
  subtitle,
  meta,
  qty,
  tone = "slate",
}: {
  title: string;
  subtitle?: string;
  meta?: string;
  qty?: string;
  tone?: "slate" | "blue" | "green" | "amber" | "violet" | "rose";
}) {
  const toneClass =
    tone === "blue"
      ? "border-info-border bg-info-bg text-primary"
      : tone === "green"
        ? "border-success-border bg-success-bg text-success-fg"
        : tone === "amber"
          ? "border-warning-border bg-warning-bg text-warning-fg"
          : tone === "violet"
            ? "border-order-border bg-order-bg text-order-fg"
            : tone === "rose"
              ? "border-danger-border bg-danger-bg text-danger-fg"
              : "border-line bg-surface-2 text-content-2";
  return (
    <div className="grid gap-3 rounded-xl border border-line bg-surface-1 px-4 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate font-mono font-black text-content-1">{title}</span>
          {meta ? <Badge variant="outline" className={cn("rounded-full text-[9px] font-black uppercase", toneClass)}>{meta}</Badge> : null}
        </div>
        {subtitle ? <div className="mt-1 text-xs font-semibold text-content-3">{subtitle}</div> : null}
      </div>
      {qty ? <div className="font-mono text-sm font-black text-content-1">{qty}</div> : null}
    </div>
  );
}

function DocumentsTab({
  order,
  tracking,
  dispatches,
  dispatchLoading,
}: {
  order: SalesOrder;
  tracking?: OrderTrackingResponse;
  dispatches: CustomerDispatch[];
  dispatchLoading: boolean;
}) {
  const customerEvidence = asArray(tracking?.customer_dispatch_evidence);
  const productionEvidence = asArray(tracking?.dispatch_evidence);
  const batches = (order.items || []).flatMap((line, index) =>
    batchRows(line).map((batch) => ({ line, index, batch })),
  );
  const jobs = asArray(tracking?.job_steps);
  const orderId = order.id;

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-line bg-gradient-to-br from-info-bg via-surface-1 to-success-bg/70 p-5 shadow-sm dark:from-info-bg/30 dark:to-success-bg/20">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-lg font-black text-content-1">
              <ClipboardList className="h-5 w-5 text-primary" /> Order document center
            </div>
            <p className="mt-1 max-w-3xl text-sm font-semibold text-content-3">
              Commercial snapshot, line technical sheets, production batch evidence, internal challans, customer dispatches, and audit links for this order.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <DocAction href={`/sales/orders/${orderId}/dispatches`} label="Dispatch ledger" />
            <DocAction href={`/sales/orders/${orderId}/dispatches/new`} label="New dispatch" />
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="rounded-2xl border border-line bg-surface-1 p-5 shadow-sm">
          <SectionTitle icon={<ReceiptText className="h-4 w-4" />} label="Commercial and technical documents" sub="Generated from the frozen sales-order snapshot." />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-line bg-surface-2 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-mono text-sm font-black text-content-1">{order.order_number}</div>
                  <div className="mt-1 text-xs font-semibold text-content-3">Sales protocol · {order.customer_name} · {fmtDate(order.created_at)}</div>
                </div>
                <Badge className="rounded-full bg-info-bg text-primary ring-1 ring-info-border">{statusLabel(order.status)}</Badge>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <MiniStat label="Lines" value={String(order.items?.length || 0)} />
                <MiniStat label="Ordered" value={`${fmtKg(orderMetrics(order, tracking).orderedKg)} kg`} />
              </div>
            </div>
            <div className="rounded-xl border border-line bg-surface-2 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-black text-content-1">Line technical sheets</div>
                  <div className="mt-1 text-xs font-semibold text-content-3">Geometry, product master, route/BOM snapshot by line.</div>
                </div>
                <Badge className="rounded-full bg-order-bg text-order-fg ring-1 ring-order-border">{order.items?.length || 0} sheets</Badge>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {(order.items || []).slice(0, 8).map((line, index) => (
                  <span key={line.id || index} className="rounded-lg border border-line bg-surface-1 px-2 py-1 text-[10px] font-black uppercase text-content-2">
                    L{index + 1} · {fmtKg(lineMetrics(line).orderedKg)} kg
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-line bg-surface-1 p-5 shadow-sm">
          <SectionTitle icon={<FileCheck2 className="h-4 w-4" />} label="System records" sub="Useful links to the canonical records behind this tracker." />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-line bg-surface-2 p-4">
              <div className="font-black text-content-1">Order tracker</div>
              <div className="mt-1 text-xs font-semibold text-content-3">Single page with route, batch, BOM, docs, and material audit.</div>
              <div className="mt-3"><DocAction href={`/sales/orders/${orderId}`} /></div>
            </div>
            <div className="rounded-xl border border-line bg-surface-2 p-4">
              <div className="font-black text-content-1">System audit center</div>
              <div className="mt-1 text-xs font-semibold text-content-3">Search by order number for low-level system events.</div>
              <div className="mt-3"><DocAction href={`/system/audit?search=${encodeURIComponent(order.order_number)}`} /></div>
            </div>
          </div>
        </section>
      </div>

      <section className="rounded-2xl border border-line bg-surface-1 p-5 shadow-sm">
        <SectionTitle icon={<Truck className="h-4 w-4" />} label="Customer dispatch documents" sub="Actual customer dispatch records tied to this order." />
        {dispatchLoading ? (
          <div className="flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-4 py-6 text-sm font-semibold text-content-3">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading customer dispatch ledger…
          </div>
        ) : dispatches.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {dispatches.map((dispatch) => (
              <EvidenceRow
                key={dispatch.id}
                title={dispatch.code}
                subtitle={[
                  `Date ${fmtDate(dispatch.dispatch_date)}`,
                  dispatch.invoice_no ? `Invoice ${dispatch.invoice_no}` : "",
                  dispatch.lr_no ? `LR ${dispatch.lr_no}` : "",
                  dispatch.vehicle_no ? `Vehicle ${dispatch.vehicle_no}` : "",
                  `${dispatch.lines?.length || 0} line${dispatch.lines?.length === 1 ? "" : "s"}`,
                ].filter(Boolean).join(" · ")}
                meta={dispatch.status}
                qty={`${fmtKg(dispatch.lines?.reduce((sum, line) => sum + safeNumber((line as any).weight_kg || line.qty_dispatched), 0))} ${dispatch.lines?.[0]?.uom || ""}`}
                tone={dispatch.status === "DISPATCHED" || dispatch.status === "CONFIRMED" ? "green" : dispatch.status === "CANCELLED" ? "rose" : "amber"}
              />
            ))}
          </div>
        ) : customerEvidence.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {customerEvidence.map((dispatch: any) => (
              <EvidenceRow
                key={dispatch.dispatch_id || dispatch.code}
                title={textValue(dispatch.code, dispatch.dispatch_id)}
                subtitle={[
                  dispatch.dispatch_date ? `Date ${fmtDate(dispatch.dispatch_date)}` : "",
                  dispatch.invoice_no ? `Invoice ${dispatch.invoice_no}` : "",
                  dispatch.lr_no ? `LR ${dispatch.lr_no}` : "",
                  dispatch.vehicle_no ? `Vehicle ${dispatch.vehicle_no}` : "",
                  `${asArray(dispatch.items).length} line${asArray(dispatch.items).length === 1 ? "" : "s"}`,
                ].filter(Boolean).join(" · ")}
                meta={statusLabel(dispatch.status)}
                qty={`${fmtKg(dispatch.dispatched_kg)} kg`}
                tone={String(dispatch.status || "").toUpperCase().includes("DISPATCH") || String(dispatch.status || "").toUpperCase().includes("CONFIRM") ? "green" : "amber"}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-warning-border bg-warning-bg px-4 py-5 text-sm font-semibold text-warning-fg">
            No customer dispatch document has been posted yet for this order.
          </div>
        )}
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-line bg-surface-1 p-5 shadow-sm">
          <SectionTitle icon={<Factory className="h-4 w-4" />} label="Internal production challans" sub="Plant/packing dispatch evidence before customer dispatch." />
          {productionEvidence.length ? (
            <div className="space-y-3">
              {productionEvidence.map((challan: any) => (
                <EvidenceRow
                  key={challan.challan_id || challan.dc_no}
                  title={textValue(challan.dc_no, challan.challan_id)}
                  subtitle={[
                    challan.dispatch_date ? `Dispatch ${fmtDate(challan.dispatch_date)}` : "",
                    challan.received_date ? `Received ${fmtDate(challan.received_date)}` : "",
                    challan.vehicle_no ? `Vehicle ${challan.vehicle_no}` : "",
                    `${asArray(challan.items).length} item${asArray(challan.items).length === 1 ? "" : "s"}`,
                  ].filter(Boolean).join(" · ")}
                  meta={statusLabel(challan.status)}
                  qty={`${fmtKg(challan.dispatched_kg)} kg`}
                  tone={String(challan.status || "").toUpperCase().includes("DISPATCH") ? "green" : "blue"}
                />
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-line bg-surface-2 px-4 py-5 text-sm font-semibold text-content-3">
              No internal production challan is linked to this order yet.
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-line bg-surface-1 p-5 shadow-sm">
          <SectionTitle icon={<Database className="h-4 w-4" />} label="Batch and job documents" sub="Production documents generated by planner/WCM execution." />
          {batches.length || jobs.length ? (
            <div className="space-y-3">
              {batches.slice(0, 6).map(({ batch, index }) => (
                <EvidenceRow
                  key={batch.id || batch.batch_number}
                  title={batch.batch_number}
                  subtitle={`L${index + 1} · ${batch.current_route_node_label || batch.current_route_process_code || "Route pending"} · ${asArray(batch.jobs).length} job${asArray(batch.jobs).length === 1 ? "" : "s"}`}
                  meta={statusLabel(batch.status)}
                  qty={`${fmtKg(batch.produced_qty_kg)} kg out`}
                  tone={isWipBatch(batch) ? "violet" : isClosedBatchStatus(batch.status) ? "green" : "amber"}
                />
              ))}
              {!batches.length ? jobs.slice(0, 6).map((job: any) => (
                <EvidenceRow
                  key={job.job_id || job.job_number}
                  title={job.job_number}
                  subtitle={`${job.step_name || job.process_code || "Step"} · ${job.work_center || job.work_center_code || "WC pending"} · ${job.production_batch_number || "batch pending"}`}
                  meta={statusLabel(job.state)}
                  qty={`${fmtKg(job.produced_kg)} kg`}
                  tone={isActiveJobState(job.state) ? "violet" : String(job.state || "").toUpperCase() === "COMPLETED" ? "green" : "blue"}
                />
              )) : null}
            </div>
          ) : (
            <div className="rounded-xl border border-line bg-surface-2 px-4 py-5 text-sm font-semibold text-content-3">
              Production jobs have not been generated yet for this order.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function MaterialAuditTab({ order, tracking }: { order: SalesOrder; tracking?: OrderTrackingResponse }) {
  const summary = asRecord(tracking?.material_audit?.summary);
  const itemFlow = asArray(tracking?.material_audit?.item_flow);
  const materials = asArray(tracking?.material_audit?.materials);
  const events = asArray(tracking?.audit_timeline);
  const lineage = asArray(tracking?.wip_lineage);
  const interplant = asArray(tracking?.interplant_links);
  const totals = orderMetrics(order, tracking);
  const materialRequired = materials.reduce((sum, row) => sum + safeNumber(row.required_kg), 0);
  const materialConsumed = materials.reduce((sum, row) => sum + safeNumber(row.consumed_kg), 0);
  const materialRemaining = materials.reduce((sum, row) => sum + Math.max(0, safeNumber(row.remaining_kg)), 0);

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-line bg-gradient-to-br from-success-bg via-surface-1 to-warning-bg/70 p-5 shadow-sm dark:from-success-bg/20 dark:to-warning-bg/20">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-lg font-black text-content-1">
              <ShieldCheck className="h-5 w-5 text-success-fg" /> Material audit and production truth
            </div>
            <p className="mt-1 max-w-3xl text-sm font-semibold text-content-3">
              Compares ordered target, latest production output, live WIP, material consumption, scrap, and the latest system events.
            </p>
          </div>
          <Badge className="w-fit rounded-full bg-surface-1 px-3 py-1 font-mono text-[10px] font-black uppercase text-content-2 ring-1 ring-line">
            {tracking?.data_freshness?.generated_at ? `Refreshed ${fmtDate(tracking.data_freshness.generated_at)}` : "Live snapshot"}
          </Badge>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <MetricTile label="Target" value={`${fmtKg(summary.ordered_target_kg || totals.orderedKg)} kg`} tone="blue" icon={<Package className="h-5 w-5" />} />
          <MetricTile label="Latest output" value={`${fmtKg(summary.latest_output_kg || totals.producedKg)} kg`} tone="green" icon={<CheckCircle2 className="h-5 w-5" />} />
          <MetricTile label="WIP output" value={`${fmtKg(summary.wip_output_kg || totals.wipKg)} kg`} tone="violet" icon={<Activity className="h-5 w-5" />} />
          <MetricTile label="Consumed" value={`${fmtKg(summary.bulk_consumed_kg || materialConsumed)} kg`} tone="amber" icon={<Boxes className="h-5 w-5" />} />
          <MetricTile label="Scrap" value={`${fmtKg(summary.scrap_logged_kg || totals.scrapKg)} kg`} tone="rose" icon={<AlertTriangle className="h-5 w-5" />} />
          <MetricTile label="Mass gap" value={`${fmtKg(summary.mass_gap_to_target_kg || totals.openKg)} kg`} tone="slate" icon={<Scale className="h-5 w-5" />} />
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="rounded-2xl border border-line bg-surface-1 p-5 shadow-sm">
          <SectionTitle icon={<Tags className="h-4 w-4" />} label="Line material flow" sub="Target, output, WIP, consumed, scrap, and remaining gap by sales line." />
          {itemFlow.length ? (
            <div className="space-y-3">
              {itemFlow.map((row, index) => {
                const target = safeNumber(row.ordered_target_kg);
                const output = safeNumber(row.latest_output_kg);
                const pct = percent(output, target);
                const tone = LINE_PROGRESS_TONES[index % LINE_PROGRESS_TONES.length];
                return (
                  <div key={`${row.template_name}-${index}`} className="rounded-xl border border-line bg-surface-2 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <LineColorIcon index={index} />
                          <div className="truncate font-mono text-sm font-black text-content-1">L{index + 1} · {row.template_name}</div>
                        </div>
                        <div className="mt-1 text-xs font-semibold text-content-3">Target source · {row.step_target_source || "Sales snapshot"}</div>
                      </div>
                      <div className="font-mono text-sm font-black text-content-1">{Math.round(pct)}%</div>
                    </div>
                    <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-surface-1 ring-1 ring-line">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: tone.fill }} />
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
                      <MiniStat label="Target" value={`${fmtKg(target)} kg`} />
                      <MiniStat label="Output" value={`${fmtKg(output)} kg`} tone="green" />
                      <MiniStat label="WIP out" value={`${fmtKg(row.wip_output_kg)} kg`} tone="violet" />
                      <MiniStat label="Consumed" value={`${fmtKg(row.bulk_consumed_kg)} kg`} tone="amber" />
                      <MiniStat label="Scrap" value={`${fmtKg(row.scrap_logged_kg)} kg`} tone="rose" />
                      <MiniStat label="Gap" value={`${fmtKg(row.mass_gap_to_target_kg)} kg`} />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-xl border border-line bg-surface-2 px-4 py-5 text-sm font-semibold text-content-3">
              No material flow rows yet. They appear when production jobs, output, or material consumption exists for this order.
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-line bg-surface-1 p-5 shadow-sm">
            <SectionTitle icon={<Boxes className="h-4 w-4" />} label="Material ledger" sub={`${materials.length} material row${materials.length === 1 ? "" : "s"} · required ${fmtKg(materialRequired)} kg · consumed ${fmtKg(materialConsumed)} kg`} />
            {materials.length ? (
              <div className="space-y-2">
                {materials.slice(0, 12).map((row, index) => {
                  const required = safeNumber(row.required_kg);
                  const consumed = safeNumber(row.consumed_kg);
                  return (
                    <div key={`${row.material_code}-${index}`} className="rounded-xl border border-line bg-surface-2 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate font-mono text-xs font-black text-content-1">{row.material_code}</div>
                          <div className="mt-0.5 truncate text-[11px] font-semibold text-content-3">{row.material_name} · {row.category || "Material"}</div>
                        </div>
                        <Badge variant="outline" className="rounded-full text-[9px] font-black uppercase">Steps {row.steps || "--"}</Badge>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-1 ring-1 ring-line">
                        <div className="h-full bg-warning-fg" style={{ width: `${percent(consumed, required)}%` }} />
                      </div>
                      <div className="mt-2 grid grid-cols-3 gap-2 text-[10px] font-black uppercase text-content-3">
                        <span>Req <b className="text-content-1">{fmtKg(required)}</b></span>
                        <span>Used <b className="text-content-1">{fmtKg(consumed)}</b></span>
                        <span>Left <b className="text-content-1">{fmtKg(row.remaining_kg)}</b></span>
                      </div>
                    </div>
                  );
                })}
                {materialRemaining > 0 ? (
                  <div className="rounded-xl border border-info-border bg-info-bg px-3 py-2 text-xs font-bold text-primary">
                    Remaining material requirement visible: {fmtKg(materialRemaining)} kg.
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="rounded-xl border border-line bg-surface-2 px-4 py-5 text-sm font-semibold text-content-3">
                No material requirements or consumption logs are posted for this order yet.
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-line bg-surface-1 p-5 shadow-sm">
            <SectionTitle icon={<GitBranch className="h-4 w-4" />} label="WIP and interplant trace" />
            <div className="grid gap-2">
              <MiniStat label="WIP rolls" value={String(lineage.length)} tone={lineage.length ? "violet" : "slate"} />
              <MiniStat label="Interplant links" value={String(interplant.length)} tone={interplant.length ? "blue" : "slate"} />
            </div>
            <div className="mt-3 space-y-2">
              {lineage.slice(0, 4).map((roll: any) => (
                <EvidenceRow
                  key={roll.roll_id || roll.label_id}
                  title={textValue(roll.label_id, roll.roll_id)}
                  subtitle={[roll.material_code, roll.width_mm ? `${fmtQty(roll.width_mm)} mm` : "", roll.created_job_number, roll.location].filter(Boolean).join(" · ")}
                  meta={roll.roll_role || roll.status}
                  qty={`${fmtKg(roll.weight_kg)} kg`}
                  tone={roll.is_fg ? "green" : "violet"}
                />
              ))}
              {interplant.slice(0, 3).map((link: any) => (
                <EvidenceRow
                  key={link.challan_id || link.dc_no}
                  title={textValue(link.dc_no, link.challan_id)}
                  subtitle={[link.from_plant, link.to_plant, link.source_job_number, link.target_job_number].filter(Boolean).join(" -> ")}
                  meta={statusLabel(link.status)}
                  qty={`${fmtKg(link.summary?.dispatched_total_kg)} kg`}
                  tone="blue"
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-surface-1 p-5 shadow-sm">
        <SectionTitle icon={<Clock className="h-4 w-4" />} label="Latest timeline" sub="System, production, material, dispatch, and line lifecycle events." />
        {events.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {events.slice(0, 18).map((event: any, index) => {
              const tone = eventTone(event.event_type);
              return (
                <EvidenceRow
                  key={`${event.entity_id}-${event.timestamp}-${index}`}
                  title={event.message || event.event_type}
                  subtitle={[fmtDate(event.timestamp), event.actor || "system", event.reference, event.line_label].filter(Boolean).join(" · ")}
                  meta={statusLabel(event.event_type)}
                  qty={safeNumber(event.delta_qty_kg) ? `${fmtKg(event.delta_qty_kg)} kg` : undefined}
                  tone={tone as any}
                />
              );
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-line bg-surface-2 px-4 py-5 text-sm font-semibold text-content-3">
            No audit timeline events are linked to this order yet.
          </div>
        )}
      </section>
    </div>
  );
}

export default function SalesOrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const id = Array.isArray(params?.id) ? params.id[0] : String(params?.id || "");

  const orderQuery = useQuery({
    queryKey: ["sales-order", id],
    queryFn: () => salesService.getOrder(id),
    enabled: Boolean(id),
  });
  const trackingQuery = useQuery({
    queryKey: ["sales-order-tracking", id],
    queryFn: () => analyticsApi.getOrderTracking(id),
    enabled: Boolean(id),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const dispatchQuery = useQuery({
    queryKey: ["customer-dispatches", id],
    queryFn: () => customerDispatchApi.list({ sales_order: id }),
    enabled: Boolean(id),
    staleTime: 30_000,
  });

  const confirmMutation = useMutation({
    mutationFn: () => salesService.confirmOrder(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales-order", id] });
      queryClient.invalidateQueries({ queryKey: ["sales-order-tracking", id] });
    },
  });

  if (orderQuery.isLoading) {
    return (
      <div className="flex h-[70vh] items-center justify-center">
        <div className="text-center">
          <Loader2 className="mx-auto h-10 w-10 animate-spin text-primary" />
          <div className="mt-3 text-[11px] font-black uppercase tracking-[0.22em] text-content-4">Loading sales order tracker</div>
        </div>
      </div>
    );
  }

  const order = orderQuery.data;
  if (orderQuery.error || !order) {
    return (
      <div className="flex h-[70vh] flex-col items-center justify-center text-center">
        <FileText className="mb-4 h-12 w-12 text-danger-fg" />
        <h1 className="text-2xl font-black text-content-1">Sales order not found</h1>
        <Button className="mt-6 rounded-xl" onClick={() => router.back()}>Go back</Button>
      </div>
    );
  }

  const tracking = trackingQuery.data;
  const metrics = orderMetrics(order, tracking);
  const items = order.items || [];
  const completePct = percent(metrics.readyKg + metrics.dispatchedKg, metrics.orderedKg);
  const orderArtwork = orderArtworkPreview(order);

  return (
    <div className="erp-soft-canvas min-h-screen">
      <div className="mx-auto w-full max-w-[1600px] space-y-5 px-4 py-5 sm:px-5 lg:px-7">
        <section className="overflow-hidden rounded-2xl border border-line bg-surface-1 shadow-sm">
          <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="p-5 lg:p-6">
              <Button variant="ghost" size="sm" className="mb-4 h-auto p-0 text-content-4 hover:bg-transparent hover:text-content-2" onClick={() => router.back()}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Back to sales orders
              </Button>
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="rounded-full bg-info-bg px-3 py-1 font-mono text-[10px] font-black uppercase text-primary ring-1 ring-info-border">{order.order_number}</Badge>
                <Badge variant="outline" className="rounded-full border-warning-border bg-warning-bg px-3 py-1 font-mono text-[10px] font-black uppercase text-content-1">{statusLabel(order.status)}</Badge>
                {trackingQuery.isFetching ? <Badge variant="outline" className="rounded-full text-[10px] font-black uppercase"><Loader2 className="mr-1 h-3 w-3 animate-spin" /> refreshing</Badge> : null}
              </div>
              <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div className="min-w-0">
                  <h1 className="truncate text-3xl font-black tracking-tight text-content-1 lg:text-4xl">{order.customer_name}</h1>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-sm font-semibold text-content-3">
                    <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-4 w-4 text-primary" /> Placed {fmtDate(order.created_at)}</span>
                    <span className="inline-flex items-center gap-1.5"><Clock className="h-4 w-4 text-primary" /> Due {fmtDate(order.delivery_date)}</span>
                    <span>{items.length} line{items.length === 1 ? "" : "s"}</span>
                    <span>{fmtKg(metrics.orderedKg)} kg ordered</span>
                  </div>
                </div>
                <ArtworkThumb preview={orderArtwork} />
              </div>
              <div className="mt-5 grid gap-3 md:grid-cols-2 2xl:grid-cols-4">
                {items.map((line, index) => (
                  <LineHeaderChip key={line.id || index} line={line} index={index} />
                ))}
              </div>
            </div>
            <div className="border-t border-line bg-surface-2 p-5 xl:border-l xl:border-t-0">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-[0.18em] text-content-4">Fulfillment truth</div>
                  <div className="mt-1 text-xs font-semibold text-content-3">Ready output, customer dispatch, live route WIP, and open demand.</div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-3xl font-black text-primary">{Math.round(completePct)}%</div>
                  <div className="text-[9px] font-black uppercase tracking-wide text-content-4">complete</div>
                </div>
              </div>
              <div className="mt-4">
                <OrderFlowBar lines={items} />
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {order.status === "DRAFT" ? (
                  <Button className="rounded-xl bg-primary text-white" onClick={() => confirmMutation.mutate()} disabled={confirmMutation.isPending}>
                    {confirmMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Lock className="mr-2 h-4 w-4" />}
                    Confirm commercial
                  </Button>
                ) : null}
                <Button asChild variant="outline" className="rounded-xl">
                  <Link href={`/sales/orders/${id}/dispatches`}><Truck className="mr-2 h-4 w-4" /> Dispatch ledger</Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <MetricTile label="Ordered" value={`${fmtKg(metrics.orderedKg)} kg`} sub={`${items.length} commercial line${items.length === 1 ? "" : "s"}`} tone="blue" icon={<Package className="h-5 w-5" />} />
          <MetricTile label="Ready (FG)" value={`${fmtKg(metrics.readyKg)} kg`} sub="completed, not dispatched" tone="blue" icon={<CheckCircle2 className="h-5 w-5" />} />
          <MetricTile label="Dispatched" value={`${fmtKg(metrics.dispatchedKg)} kg`} sub="sent to customer" tone="green" icon={<Truck className="h-5 w-5" />} />
          <MetricTile label="WIP" value={`${fmtKg(metrics.wipKg)} kg`} sub="active route work only" tone="violet" icon={<Activity className="h-5 w-5" />} />
          <MetricTile label="Scrap" value={`${fmtKg(metrics.scrapKg)} kg`} sub="logged yield loss" tone="rose" icon={<Sparkles className="h-5 w-5" />} />
          <MetricTile label="Open" value={`${fmtKg(metrics.openKg)} kg`} sub="target - ready - dispatch - WIP" tone="slate" icon={<Clock className="h-5 w-5" />} />
        </section>

        <Tabs defaultValue="lines" className="space-y-4">
          <TabsList className="sticky top-[72px] z-20 h-auto w-full justify-start overflow-x-auto rounded-xl border border-line bg-surface-1/95 p-1 shadow-sm backdrop-blur">
            <TabsTrigger value="lines" className="rounded-lg text-[11px] font-black uppercase">Line items + live route <span className="ml-1 rounded-full bg-info-bg px-1.5 text-primary">{items.length}</span></TabsTrigger>
            <TabsTrigger value="technical" className="rounded-lg text-[11px] font-black uppercase">Technical + BOM</TabsTrigger>
            <TabsTrigger value="documents" className="rounded-lg text-[11px] font-black uppercase">Documents</TabsTrigger>
            <TabsTrigger value="audit" className="rounded-lg text-[11px] font-black uppercase">Material audit + timeline</TabsTrigger>
          </TabsList>

          <TabsContent value="lines" className="space-y-4">
            {items.map((line, index) => (
              <LineTrackerSection key={line.id || index} line={line} index={index} tracking={tracking} />
            ))}
            {!items.length ? (
              <Card className="rounded-xl border-dashed border-line bg-surface-1">
                <CardContent className="p-8 text-center text-sm font-semibold text-content-3">No sales lines captured.</CardContent>
              </Card>
            ) : null}
          </TabsContent>

          <TabsContent value="technical" className="space-y-4">
            {items.map((line, index) => (
              <TechnicalLine key={line.id || index} line={line} index={index} order={order} />
            ))}
          </TabsContent>

          <TabsContent value="documents">
            <DocumentsTab order={order} tracking={tracking} dispatches={dispatchQuery.data || []} dispatchLoading={dispatchQuery.isLoading} />
          </TabsContent>

          <TabsContent value="audit">
            <MaterialAuditTab order={order} tracking={tracking} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

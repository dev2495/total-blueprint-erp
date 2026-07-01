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
  { fill: "#2563eb", dark: "#1e40af", light: "rgba(37,99,235,.22)", track: "rgba(37,99,235,.10)", text: "text-primary", border: "border-info-border", bg: "bg-info-bg" },
  { fill: "#10b981", dark: "#047857", light: "rgba(16,185,129,.22)", track: "rgba(16,185,129,.10)", text: "text-success-fg", border: "border-success-border", bg: "bg-success-bg" },
  { fill: "#7c3aed", dark: "#5b21b6", light: "rgba(124,58,237,.21)", track: "rgba(124,58,237,.10)", text: "text-order-fg", border: "border-order-border", bg: "bg-order-bg" },
  { fill: "#f59e0b", dark: "#b45309", light: "rgba(245,158,11,.24)", track: "rgba(245,158,11,.11)", text: "text-warning-fg", border: "border-warning-border", bg: "bg-warning-bg" },
  { fill: "#ef4444", dark: "#b91c1c", light: "rgba(239,68,68,.21)", track: "rgba(239,68,68,.09)", text: "text-danger-fg", border: "border-danger-border", bg: "bg-danger-bg" },
  { fill: "#0891b2", dark: "#0e7490", light: "rgba(8,145,178,.22)", track: "rgba(8,145,178,.10)", text: "text-primary", border: "border-info-border", bg: "bg-info-bg" },
];

const FLOW_COLORS = {
  ready: "#2563eb",
  dispatched: "#10b981",
  wip: "rgba(139,92,246,.28)",
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

function cleanText(value: unknown): string {
  return String(value ?? "").trim();
}

function micronLabel(value: unknown): string {
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return `${fmtQty(n)}µ`;
  const text = cleanText(value);
  if (!text) return "";
  if (/^\d+(?:\.\d+)?(?:\+\d+(?:\.\d+)?)+$/.test(text)) return `${text}µ`;
  return text
    .replace(/\s*(?:um|u|μ)\b/gi, "µ")
    .replace(/\s*µ/gi, "µ")
    .replace(/\s*\+\s*/g, "+");
}

function isThicknessToken(value: string): boolean {
  return /^\d+(?:\.\d+)?\s*(?:µ|μ|u|um)$/i.test(value.trim());
}

function layerLabelPartsFromText(label: unknown): string[] {
  return cleanText(label)
    .split(/\s*·\s*/)
    .map((part) => cleanText(part))
    .filter((part) => {
      if (!part) return false;
      if (/^L\d+$/i.test(part)) return false;
      if (/^\d+(?:\.\d+)?\s*mm$/i.test(part)) return false;
      if (/^\d+(?:\.\d+)?\s*mm\s*(?:web|roll)$/i.test(part)) return false;
      return true;
    });
}

function layerThicknessValue(row: Record<string, any>): unknown {
  return row.thickness_micron ?? row.thickness_um ?? row.thickness_u ?? row.micron ?? row.thickness;
}

function layerGradeLabel(row: Record<string, any>): string {
  return cleanText(
    row.grade_code ||
      row.grade ||
      row.grade_name ||
      row.recipe_grade_code ||
      row.recipe_grade ||
      row.material_grade ||
      row.grade_label,
  );
}

function layerVariantLabel(row: Record<string, any>): string {
  return cleanText(
    row.variant_code ||
      row.material_code ||
      row.family_code ||
      row.code ||
      row.variant_name ||
      row.material_name ||
      row.family_name ||
      row.name,
  );
}

function layerChipParts(row: Record<string, any>): {
  label: string;
  variantLabel: string;
  gradeLabel: string;
  thicknessLabel: string;
} {
  const explicitParts = layerLabelPartsFromText(row.label);
  const variant = layerVariantLabel(row);
  const thickness = micronLabel(layerThicknessValue(row));
  const grade = layerGradeLabel(row);
  const inferredThickness = thickness || explicitParts.find((part) => isThicknessToken(part)) || "";
  const inferredVariant =
    variant ||
    explicitParts.find((part) => !isThicknessToken(part) && part.toLowerCase() !== grade.toLowerCase()) ||
    "";
  const inferredGrade =
    grade ||
    explicitParts.find((part) => !isThicknessToken(part) && part.toLowerCase() !== inferredVariant.toLowerCase()) ||
    "";
  const parts: string[] = [];
  const pushPart = (value: string) => {
    const clean = cleanText(value);
    if (!clean) return;
    if (parts.some((part) => part.toLowerCase() === clean.toLowerCase())) return;
    parts.push(clean);
  };

  pushPart(inferredVariant);
  if (inferredGrade && !inferredVariant.toLowerCase().includes(inferredGrade.toLowerCase())) {
    pushPart(inferredGrade);
  }
  pushPart(inferredThickness);

  return {
    label: parts.join(" · ") || explicitParts.join(" · "),
    variantLabel: inferredVariant,
    gradeLabel: inferredGrade && !inferredVariant.toLowerCase().includes(inferredGrade.toLowerCase()) ? inferredGrade : "",
    thicknessLabel: inferredThickness,
  };
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
    cleanText(
      line?.line_label ||
        line?.product_spec?.display_label ||
        line?.product_spec?.line_label ||
        "",
    ) ||
    cleanText(line?.line_name) ||
    cleanText(line?.product_master_code || line?.product_master_name) ||
    cleanText(line?.template_name) ||
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
    const routeDecisions = asArray((graphBatch as any)?.route_decisions || (graphBatch as any)?.meta_json?.route_decisions);
    const decisionByNode = new Map(
      routeDecisions
        .map((row) => asRecord(row))
        .filter((row) => row.route_node_id)
        .map((row) => [String(row.route_node_id), row]),
    );
    return nodes.map((node, index) => ({
      id: String(node.id || node.process_code || node.label || index),
      label: String(node.label || node.process_code || "Step"),
      code: String(node.process_code || node.label || `S${index + 1}`),
      branch: String(node.branch_key || "MAIN"),
      join: String(node.join_key || ""),
      parallel: String(node.parallel_group || ""),
      optionalAtPlanning: Boolean(node.optional_at_planning),
      skippableAfterPreviousOutput: Boolean(node.skippable_after_previous_output),
      routeStepPolicy: String(node.route_step_policy || "REQUIRED"),
      decision: decisionByNode.get(String(node.id || "")),
      skipped: ["PLANNED_SKIPPED", "RUNTIME_SKIPPED"].includes(String(decisionByNode.get(String(node.id || ""))?.decision || "").toUpperCase()),
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
    optionalAtPlanning: Boolean((job as any).route_node?.optional_at_planning),
    skippableAfterPreviousOutput: Boolean((job as any).route_node?.skippable_after_previous_output),
    routeStepPolicy: String((job as any).route_node?.route_step_policy || "REQUIRED"),
    decision: (job as any).route_step_decision || null,
    skipped: ["PLANNED_SKIPPED", "RUNTIME_SKIPPED"].includes(String((job as any).route_step_decision?.decision || "").toUpperCase()),
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

function normalizeBomSnapshotRow(row: any, defaults: Record<string, any> = {}) {
  return { ...defaults, ...asRecord(row) };
}

function materialCodeKey(row: any): string {
  return textValue(row.material_code, row.variant_code, row.code, row.sku_code, row.name).toUpperCase();
}

function extrudedFilmOutputCodes(snapshot: Record<string, any>): Set<string> {
  const hasRecipe = asArray(snapshot.granules).length > 0 || asArray(snapshot.chemicals).length > 0;
  const codes = new Set<string>();
  asArray(snapshot.films).forEach((film) => {
    const row = asRecord(film);
    const source = textValue(row.source, row.policy_source, row.capture_mode).toUpperCase();
    const code = materialCodeKey(row);
    if (code && (source.includes("EXTRUDE") || hasRecipe)) codes.add(code);
  });
  return codes;
}

function isExtrudedFilmOutputRow(row: any, snapshot: Record<string, any>): boolean {
  const category = textValue(row.category_code, row.category, row.group, row.source_key).toUpperCase();
  if (!category.includes("FILM")) return false;
  const source = textValue(row.source, row.policy_source, row.capture_mode, row.source_kind).toUpperCase();
  const code = materialCodeKey(row);
  return Boolean(code && (source.includes("EXTRUDE") || extrudedFilmOutputCodes(snapshot).has(code)));
}

function bomComponents(line: any): any[] {
  const snapshot = asRecord(line?.bom_snapshot);
  const planningLines = asArray(snapshot.planning_lines);
  if (planningLines.length) {
    return planningLines
      .map((row) => normalizeBomSnapshotRow(row, { source_kind: "Frozen BOM plan" }))
      .filter((row) => textValue(row.material_code, row.material_name, row.variant_code, row.name))
      .filter((row) => !isExtrudedFilmOutputRow(row, snapshot));
  }

  const snapshotRows: any[] = [];
  const rowSources: Array<[string, unknown, Record<string, any>]> = [
    ["films", snapshot.films, { category_code: "FILM", source_kind: "Frozen film" }],
    ["inks", snapshot.inks, { category_code: "INK", source_kind: "Frozen ink" }],
    ["granules", snapshot.granules, { category_code: "GRANULE", source_kind: "Extrusion recipe" }],
    ["chemicals", snapshot.chemicals, { category_code: "CHEMICAL", source_kind: "Frozen chemical" }],
    ["addons", snapshot.addons, { category_code: "ADDON", source_kind: "Add-on" }],
    ["pod", snapshot.pod, { category_code: "PACKAGING", source_kind: "Catalog ref" }],
    ["packaging", snapshot.packaging, { category_code: "PACKAGING", source_kind: "Packaging" }],
    ["materials", snapshot.materials, { source_kind: "Frozen BOM" }],
    ["components", snapshot.components, { source_kind: "Frozen BOM" }],
  ];
  rowSources.forEach(([sourceKey, candidate, defaults]) => {
    asArray(candidate).forEach((row) => snapshotRows.push(normalizeBomSnapshotRow(row, { ...defaults, source_key: sourceKey })));
  });

  const packaging = asRecord(line?.packaging_snapshot);
  const inner = asRecord(packaging.primary_inner_pack);
  if (inner.enabled || inner.material_code || inner.material_name) {
    snapshotRows.push(normalizeBomSnapshotRow(inner, {
      category_code: "PACKAGING",
      material_code: textValue(inner.material_code, inner.sku_code, "INNER-PACK"),
      material_name: textValue(inner.material_name, inner.name, "Inner pack"),
      source_kind: "Packing rule",
    }));
  }
  const pod = asRecord(packaging.pod);
  if (pod.enabled || pod.pod_sku_code || pod.pod_sku_name) {
    snapshotRows.push(normalizeBomSnapshotRow(pod, {
      category_code: "PACKAGING",
      material_code: textValue(pod.pod_sku_code, pod.material_code, "POD"),
      material_name: textValue(pod.pod_sku_name, pod.material_name, "POD"),
      source_kind: "POD catalog",
    }));
  }
  asArray(asRecord(packaging.roll_dispatch_pack).lines).forEach((row) => {
    snapshotRows.push(normalizeBomSnapshotRow(row, {
      category_code: "PACKAGING",
      material_code: textValue(row.material_code, row.sku_code, row.code, "ROLL-PACK"),
      material_name: textValue(row.material_name, row.name, "Roll dispatch pack"),
      source_kind: "Roll packing",
    }));
  });

  const usableSnapshotRows = snapshotRows.filter((row) => textValue(row.material_code, row.variant_code, row.code, row.material_name, row.variant_name, row.name));
  const inputRows = usableSnapshotRows.filter((row) => !isExtrudedFilmOutputRow(row, snapshot));
  if (inputRows.length) return inputRows;
  return asArray(line?.material_plan_summary?.components);
}

function createdFilmOutputs(line: any) {
  const snapshot = asRecord(line?.bom_snapshot);
  const outputCodes = extrudedFilmOutputCodes(snapshot);
  const hasRecipe = outputCodes.size > 0;
  if (!hasRecipe) return [];
  return asArray(snapshot.films)
    .map((film, index) => {
      const row = asRecord(film);
      const code = materialCodeKey(row);
      if (!code || !outputCodes.has(code)) return null;
      return {
        key: `${code}-${index}`,
        code: textValue(row.material_code, row.variant_code, row.code, `Film ${index + 1}`),
        name: textValue(row.material_name, row.variant_name, row.name, row.grade),
        qtyKg: safeNumber(row.weight_kg ?? row.planned_issue_qty ?? row.required_qty ?? row.qty),
        width: textValue(row.width_mm, row.roll_width_mm, row.final_web_width_mm),
        thickness: textValue(row.thickness_micron, row.thickness),
        grade: textValue(row.grade, row.layer_grade),
        source: textValue(row.source, "EXTRUDE"),
      };
    })
    .filter(Boolean) as Array<{ key: string; code: string; name: string; qtyKg: number; width: string; thickness: string; grade: string; source: string }>;
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
  const rawQty =
    row?.planned_issue_qty ??
    row?.required_qty ??
    row?.required_kg ??
    row?.theoretical_qty ??
    row?.planned_qty ??
    row?.consumed_kg ??
    row?.qty ??
    row?.quantity ??
    row?.weight_kg ??
    row?.thickness_micron;
  const qty = textValue(rawQty);
  if (!qty) return "Catalog ref";
  const unit = textValue(row?.required_uom, row?.uom, row?.unit, row?.qty_uom, row?.thickness_micron ? "u" : "");
  const unitKey = unit.toUpperCase();
  const formatted = unitKey === "PCS" || unitKey === "NOS" || unitKey === "EA" ? fmtQty(rawQty) : fmtKg(rawQty, 3);
  return `${formatted}${unit ? ` ${unit}` : ""}`;
}

function materialGroupName(row: any): string {
  const category = textValue(row.category_code, row.category, row.group, row.source_key).toUpperCase();
  const code = textValue(row.material_code, row.variant_code, row.code, row.material_name).toUpperCase();
  if (category.includes("GRANULE") || category.includes("MASTER") || category.includes("RESIN") || /^(LLDPE|LDPE|HDPE|PP|MASTER|METALLOCENE)/.test(code)) return "Extrusion recipe";
  if (category.includes("ADH") || category.includes("CHEM") || category.includes("SOLVENT") || category.includes("SOL") || /^(ADH|SOL)/.test(code)) return "Chemicals & solvents";
  if (category.includes("INK") || code.startsWith("INK")) return "Ink";
  if (category.includes("FILM") || /^(PET|MET|PA|EVOH|ALU|BOPP|CPP|LDNAT|MLD|UAT|PE-)/.test(code)) return "Film";
  if (category.includes("PACK") || category.includes("POD") || category.includes("ADDON") || /^(POD|INNER|OUTER|GUNNY|CARTON|BOX)/.test(code)) return "Packaging & catalog refs";
  return "Other";
}

function materialGroupMeta(group: string) {
  if (group === "Film") return { label: group, tone: "blue", title: "Film", text: "text-primary", bg: "bg-info-bg", border: "border-info-border" };
  if (group === "Ink") return { label: group, tone: "rose", title: "Ink", text: "text-danger-fg", bg: "bg-danger-bg", border: "border-danger-border" };
  if (group === "Extrusion recipe") return { label: group, tone: "green", title: "Extrusion recipe", text: "text-success-fg", bg: "bg-success-bg", border: "border-success-border" };
  if (group === "Chemicals & solvents") return { label: group, tone: "amber", title: "Chemicals & solvents", text: "text-warning-fg", bg: "bg-warning-bg", border: "border-warning-border" };
  if (group === "Packaging & catalog refs") return { label: group, tone: "violet", title: "Packaging & catalog refs", text: "text-order-fg", bg: "bg-order-bg", border: "border-order-border" };
  return { label: group, tone: "slate", title: group, text: "text-content-2", bg: "bg-surface-2", border: "border-line" };
}

function bomQtyKg(row: any): number {
  const qty = safeNumber(row.planned_issue_qty ?? row.required_qty ?? row.required_kg ?? row.theoretical_qty ?? row.weight_kg ?? row.qty ?? row.quantity);
  const unit = String(row.uom || row.required_uom || row.unit || "KG").toUpperCase();
  if (unit === "G" || unit === "GRAM" || unit === "GRAMS") return qty / 1000;
  if (unit === "KG" || unit === "KGS" || unit === "KILOGRAM") return qty;
  return qty;
}

function bomRows(line: any) {
  const components = bomComponents(line);
  if (components.length) {
    return components.map((component, index) => {
      const group = materialGroupName(component);
      const sourceRaw = textValue(component.policy_source, component.source, component.capture_mode, component.source_kind);
      const purchase = String(sourceRaw || "").toUpperCase().includes("PURCHASE");
      const source = purchase ? "Purchase film" : textValue(component.source_kind, component.policy_source, component.source, "Frozen BOM");
      const qtyKg = bomQtyKg(component);
      const gPerPc = textValue(component.g_per_pc, component.per_piece_g, component.weight_g, component.unit_weight_g);
      return {
        key: textValue(component.id, component.material_id, component.material_code, component.variant_code, `${index}`),
        label: textValue(component.material_code, component.variant_code, component.code, component.sku_code, `Material ${index + 1}`),
        name: textValue(component.material_name, component.variant_name, component.name, component.label),
        detail: textValue(component.material_name, component.variant_name, component.category_code, component.category, component.role, component.layer_role, component.grade),
        qty: rowQtyLabel(component),
        qtyKg,
        perUnit: gPerPc ? `${fmtKg(gPerPc, 3)} g` : textValue(component.gsm && `${component.gsm} gsm`, component.ink_gsm && `${component.ink_gsm} gsm`),
        source,
        group,
        step: textValue(component.step_sequence, component.route_step, component.step),
        stock: textValue(component.stock_kg && `${fmtKg(component.stock_kg)} kg`, component.available_kg && `${fmtKg(component.available_kg)} kg`, component.stock_qty && `${fmtKg(component.stock_qty)} ${component.stock_uom || ""}`),
      };
    });
  }

  const spec = lineProductSpec(line);
  return spec.layers.map((layer, index) => ({
    key: `layer-${index}`,
    label: textValue(layer.variantCode, layer.variantName, `Layer ${index + 1}`),
    name: layer.variantName,
    detail: [layer.variantName, layer.grade, layer.widthMm ? `${fmtQty(layer.widthMm)} mm` : ""].filter(Boolean).join(" · "),
    qty: layer.thicknessMicron ? `${fmtQty(layer.thicknessMicron)} u` : "Layer",
    qtyKg: 0,
    perUnit: "",
    source: "Layer stack",
    group: "Film",
    step: "",
    stock: "",
  }));
}

function bomGroupedRows(line: any): Array<{ group: string; rows: ReturnType<typeof bomRows>; totalKg: number }> {
  const rows = bomRows(line);
  if (!rows.length) return [];
  const groups: Record<string, ReturnType<typeof bomRows>> = {};
  rows.forEach((row) => {
    if (!groups[row.group]) groups[row.group] = [];
    groups[row.group].push(row);
  });
  const order = ["Film", "Extrusion recipe", "Ink", "Chemicals & solvents", "Packaging & catalog refs", "Other"];
  return order
    .filter((group) => groups[group]?.length)
    .map((group) => ({ group, rows: groups[group], totalKg: groups[group].reduce((sum, row) => sum + safeNumber(row.qtyKg), 0) }));
}

function bomStepSummary(line: any) {
  const steps: Record<string, number> = {};
  bomRows(line).forEach((row) => {
    const step = row.step || "Snapshot";
    steps[step] = (steps[step] || 0) + 1;
  });
  return Object.entries(steps).slice(0, 7).map(([step, count]) => ({ step, count }));
}

function materialAuditRowsFromOrder(order: SalesOrder) {
  return asArray(order.items).flatMap((line: any, lineIndex) =>
    bomRows(line)
      .filter((row) => row.qtyKg > 0 || row.qty !== "Catalog ref")
      .map((row) => ({
        material_code: row.label,
        material_name: row.name || row.detail || row.label,
        category: row.group,
        required_kg: row.qtyKg,
        consumed_kg: 0,
        remaining_kg: row.qtyKg,
        steps: row.step || "—",
        source: row.source || "Frozen BOM",
        line_labels: [`L${lineIndex + 1} · ${lineLabel(line, lineIndex)}`],
        row_count: 1,
      })),
  );
}

function snapshotTimelineEvents(order: SalesOrder, tracking?: OrderTrackingResponse) {
  const events: any[] = [];
  const orderAny = order as any;
  if (order.order_number) {
    events.push({
      entity_id: order.id,
      timestamp: order.created_at || orderAny.order_date,
      event_type: "ORDER_SNAPSHOT",
      message: `${order.order_number} captured for ${order.customer_name}`,
      actor: "sales",
      reference: statusLabel(order.status),
    });
  }
  asArray(order.items).forEach((line: SalesOrderLine, index) => {
    const metrics = lineMetrics(line);
    events.push({
      entity_id: line.id || `line-${index}`,
      timestamp: (line as any).updated_at || orderAny.updated_at || order.created_at,
      event_type: metrics.readyKg > 0 ? "OUTPUT_READY" : metrics.wipKg > 0 ? "ROUTE_WIP" : "LINE_SNAPSHOT",
      message: `L${index + 1} · ${lineLabel(line, index)} · ${statusLabel(line.line_status)}`,
      actor: "system",
      reference: `${fmtKg(metrics.readyKg)} kg ready · ${fmtKg(metrics.wipKg)} kg WIP · ${fmtKg(metrics.openKg)} kg open`,
      line_label: `L${index + 1}`,
      delta_qty_kg: metrics.readyKg || metrics.wipKg || metrics.openKg,
    });
    batchRows(line).forEach((batch) => {
      events.push({
        entity_id: batch.id || batch.batch_number,
        timestamp: batch.updated_at || batch.created_at || orderAny.updated_at || order.created_at,
        event_type: isClosedBatchStatus(batch.status) ? "BATCH_CLOSED" : isWipBatch(batch) ? "BATCH_WIP" : "BATCH_RELEASED",
        message: `${batch.batch_number || "Batch"} · ${statusLabel(batch.status)}`,
        actor: batch.operator || batch.operator_username || "production",
        reference: batch.current_route_node_label || batch.current_route_process_code || "Route pending",
        line_label: `L${index + 1}`,
        delta_qty_kg: safeNumber(batch.produced_qty_kg || batch.planned_qty),
      });
    });
  });
  asArray(tracking?.job_steps).slice(0, 12).forEach((job: any) => {
    events.push({
      entity_id: job.job_id || job.job_number,
      timestamp: job.updated_at || job.closed_at || job.started_at || orderAny.updated_at || order.created_at,
      event_type: String(job.state || "").toUpperCase() === "COMPLETED" ? "JOB_CLOSED" : isActiveJobState(job.state) ? "JOB_WIP" : "JOB_RELEASED",
      message: `${job.job_number || "Job"} · ${job.step_name || job.process_code || "Route step"}`,
      actor: job.operator || job.operator_username || "production",
      reference: job.work_center || job.work_center_code || job.production_batch_number,
      delta_qty_kg: safeNumber(job.produced_kg),
    });
  });
  return events.filter((event) => event.message);
}

function LineLayerBomCard({ line, index }: { line: SalesOrderLine; index: number }) {
  const tone = LINE_PROGRESS_TONES[index % LINE_PROGRESS_TONES.length];
  const spec = lineProductSpec(line);
  const rows = bomRows(line);
  const recipeRows = rows.filter((row) => row.group === "Extrusion recipe");
  const filmRows = rows.filter((row) => row.group === "Film");
  const outputs = createdFilmOutputs(line);
  const totalThickness = spec.layers.reduce((sum, layer) => sum + safeNumber(layer.thicknessMicron), 0);
  return (
    <div className="rounded-2xl border border-line bg-surface-2 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <LineColorIcon index={index} />
            <div className="truncate font-mono text-sm font-black text-content-1">L{index + 1} · {lineLabel(line, index)}</div>
          </div>
          <LineSpecChips line={line} />
        </div>
        <Badge variant="outline" className={cn("rounded-full text-[9px] font-black uppercase", tone.bg, tone.text, tone.border)}>
          {recipeRows.length ? "Recipe route" : filmRows.length ? "Purchase film" : "Snapshot"}
        </Badge>
      </div>

      {spec.layers.length ? (
        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between text-[9px] font-black uppercase tracking-wider text-content-4">
            <span>Layer stack</span>
            <span>{totalThickness ? `${fmtKg(totalThickness, 1)}u total` : `${spec.layers.length} layer${spec.layers.length === 1 ? "" : "s"}`}</span>
          </div>
          <div className="flex h-7 overflow-hidden rounded-lg border border-line bg-surface-1">
            {spec.layers.map((layer, layerIndex) => {
              const layerT = safeNumber(layer.thicknessMicron);
              const layerTone = LINE_PROGRESS_TONES[layerIndex % LINE_PROGRESS_TONES.length];
              const widthPct = totalThickness > 0 ? Math.max(10, (layerT / totalThickness) * 100) : 100 / spec.layers.length;
              return (
                <div key={`${layer.index}-${layerIndex}`} className="grid place-items-center text-[9px] font-black text-white" style={{ width: `${widthPct}%`, background: layerTone.fill }}>
                  {layerT ? `${fmtQty(layerT)}u` : `L${layer.index}`}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="mt-3 grid gap-2 lg:grid-cols-2">
        {outputs.length ? (
          <div className="rounded-xl border border-success-border bg-success-bg p-3">
            <div className="text-[9px] font-black uppercase tracking-wider text-success-fg">Created roll output</div>
            {outputs.map((output) => (
              <div key={output.key} className="mt-2 flex items-center justify-between gap-3 text-xs">
                <span className="min-w-0 truncate font-mono font-black text-content-1">{output.code}</span>
                <span className="font-mono font-black text-success-fg">{fmtKg(output.qtyKg)} kg</span>
              </div>
            ))}
          </div>
        ) : null}
        <div className="rounded-xl border border-line bg-surface-1 p-3">
          <div className="text-[9px] font-black uppercase tracking-wider text-content-4">{recipeRows.length ? "Recipe inputs" : "BOM inputs"}</div>
          {(recipeRows.length ? recipeRows : filmRows).slice(0, 8).map((row) => (
            <div key={row.key} className="mt-2 flex items-center justify-between gap-3 text-xs">
              <span className="min-w-0 truncate font-mono font-black text-content-1">{row.label}</span>
              <span className="font-mono font-black text-content-2">{row.qty}</span>
            </div>
          ))}
          {!recipeRows.length && !filmRows.length ? <div className="mt-2 text-xs font-semibold text-content-3">No material rows on this line snapshot.</div> : null}
        </div>
      </div>
    </div>
  );
}

function geometryFacts(line: any, spec: ReturnType<typeof lineProductSpec>, geometry: ReturnType<typeof geometrySummary>, metrics: ReturnType<typeof lineMetrics>) {
  const fgType = String(spec.size.finishedGoodType || asRecord(line?.geometry_snapshot).finished_good_type || "POUCH").toUpperCase();
  const width = safeNumber(geometry.width || spec.size.widthMm);
  const height = safeNumber(geometry.height || spec.size.heightMm);
  const gusset = safeNumber(geometry.gusset || spec.size.gussetMm);
  const rollWidth = safeNumber(geometry.rollWidth || spec.size.widthMm);
  const unitWeightG = safeNumber(line.unit_weight_g);
  const pcsPerKg = unitWeightG > 0 ? Math.round(1000 / unitWeightG) : 0;
  const totalPcs = String(line.qty_uom || "").toUpperCase() === "PCS" ? safeNumber(line.qty_value) : metrics.orderedKg > 0 && unitWeightG > 0 ? Math.round((metrics.orderedKg * 1000) / unitWeightG) : 0;
  const facts: Array<{ label: string; value: string; tone?: "slate" | "blue" | "green" | "amber" | "violet" }> = [];
  if (fgType === "ROLL") {
    if (rollWidth > 0) facts.push({ label: "Roll web", value: `${fmtQty(rollWidth)} mm`, tone: "green" });
    if (width > 0 && width !== rollWidth) facts.push({ label: "Width", value: `${fmtQty(width)} mm`, tone: "blue" });
    if (geometry.style || spec.size.formLabel) facts.push({ label: "Roll form", value: textValue(geometry.style, spec.size.formLabel), tone: "violet" });
  } else {
    if (width > 0 && height > 0) facts.push({ label: "Size", value: `${fmtQty(width)} x ${fmtQty(height)} mm`, tone: "blue" });
    if (width > 0) facts.push({ label: "Width", value: `${fmtQty(width)} mm` });
    if (height > 0) facts.push({ label: "Height", value: `${fmtQty(height)} mm` });
    if (gusset > 0) facts.push({ label: "Gusset", value: `${fmtQty(gusset)} mm`, tone: "amber" });
    if (rollWidth > 0 && rollWidth !== width) facts.push({ label: "Roll web", value: `${fmtQty(rollWidth)} mm`, tone: "green" });
    if (geometry.style || spec.size.formLabel || spec.size.finishedGoodType) facts.push({ label: "Form", value: textValue(geometry.style, spec.size.formLabel, spec.size.finishedGoodType), tone: "violet" });
  }
  if (unitWeightG > 0) facts.push({ label: "Unit weight", value: `${fmtKg(unitWeightG, 3)} g`, tone: "green" });
  if (pcsPerKg > 0) facts.push({ label: "Pcs / kg", value: fmtQty(pcsPerKg) });
  if (totalPcs > 0) facts.push({ label: "Total pcs", value: fmtQty(totalPcs) });
  return facts;
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

type LineSpecChipTone = "slate" | "blue" | "green" | "amber" | "violet" | "rose" | "cyan";
type LineSpecChip = {
  label: string;
  tone: LineSpecChipTone;
  kind?: "layer";
  variantLabel?: string;
  gradeLabel?: string;
  thicknessLabel?: string;
};

function lineSpecChips(line: any): LineSpecChip[] {
  const geometry = geometrySummary(line);
  const productSpec = asRecord(line?.product_spec);
  const layerStack = asRecord(productSpec.layer_stack);
  const lineLayerRows = asArray(line?.layer_snapshot?.layers || line?.layer_snapshot || line?.bom_snapshot?.layers);
  const productSpecLayerRows = asArray(productSpec.layers);
  const layers = lineLayerRows.length
    ? lineLayerRows.map((layer, index) => ({
        ...asRecord(productSpecLayerRows[index]),
        ...asRecord(layer),
      }))
    : productSpecLayerRows;
  const printing = asRecord(line?.printing_snapshot);
  const chips: LineSpecChip[] = [];
  const seen = new Set<string>();
  const push = (label: string, tone: LineSpecChipTone, extra: Partial<LineSpecChip> = {}) => {
    const clean = cleanText(label);
    if (!clean) return;
    const key = clean.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    chips.push({ label: clean, tone, ...extra });
  };

  const thicknessLabel = micronLabel(
    layerStack.thickness_label ||
      layerStack.thickness_expression ||
      productSpec.thickness_expression ||
      layers.map((layer) => micronLabel(layerThicknessValue(asRecord(layer)))).filter(Boolean).join("+"),
  );
  push(thicknessLabel, "amber");
  if (geometry.rollWidth) push(`${fmtQty(geometry.rollWidth)}mm web`, "green");
  if (geometry.width && geometry.height) push(`${fmtQty(geometry.width)} x ${fmtQty(geometry.height)} mm`, "green");

  const printType = cleanText(printing.type || printing.printing_type || line?.print_type).toUpperCase();
  const front = Number(printing.front_colors_count || printing.front_colours_count || 0);
  const back = Number(printing.back_colors_count || printing.back_colours_count || 0);
  const printingActive = Boolean(printing.enabled) || front > 0 || back > 0 || Boolean(cleanText(printing.artwork_id || printing.artwork_code || printing.artwork_design_code));
  if (printingActive && printType && printType !== "NO PRINT") {
    const colorBits = [front > 0 ? `F${front}` : "", back > 0 ? `B${back}` : ""].filter(Boolean).join("/");
    push([printType, colorBits].filter(Boolean).join(" "), "rose");
  }

  layers.forEach((layer) => {
    const parts = layerChipParts(asRecord(layer));
    push(parts.label, "blue", {
      kind: "layer",
      variantLabel: parts.variantLabel,
      gradeLabel: parts.gradeLabel,
      thicknessLabel: parts.thicknessLabel,
    });
  });
  return chips.slice(0, 8);
}

function chipClass(tone: LineSpecChipTone) {
  return {
    slate: "border-line bg-surface-2 text-content-2",
    blue: "border-info-border bg-info-bg text-primary",
    green: "border-success-border bg-success-bg text-success-fg",
    amber: "border-warning-border bg-warning-bg text-warning-fg",
    violet: "border-order-border bg-order-bg text-order-fg",
    rose: "border-danger-border bg-danger-bg text-danger-fg",
    cyan: "border-info-border bg-info-bg text-info-fg",
  }[tone];
}

function LineSpecChips({ line }: { line: any }) {
  const chips = lineSpecChips(line);
  if (!chips.length) return null;
  return (
    <div className="mt-2 flex min-w-0 flex-wrap gap-1.5">
      {chips.map((chip, index) => (
        <span
          key={`${chip.label}-${index}`}
          className={cn("inline-flex max-w-full items-center truncate rounded-lg border px-3 py-1.5 text-[12px] font-black uppercase shadow-sm ring-1 ring-inset ring-white/10", chipClass(chip.tone))}
        >
          {chip.kind === "layer" ? (
            <span className="flex min-w-0 items-center gap-1.5 truncate">
              {chip.variantLabel ? <span className="truncate font-mono font-black">{chip.variantLabel}</span> : null}
              {chip.gradeLabel ? (
                <span className="rounded-md border border-info-border/70 bg-surface-1/80 px-1.5 py-0.5 font-sans text-[0.84em] font-black uppercase tracking-wide text-primary">
                  {chip.gradeLabel}
                </span>
              ) : null}
              {chip.thicknessLabel ? <span className="font-mono font-black text-info-fg">{chip.thicknessLabel}</span> : null}
              {!chip.variantLabel && !chip.gradeLabel && !chip.thicknessLabel ? <span className="truncate">{chip.label}</span> : null}
            </span>
          ) : (
            <span className="truncate">{chip.label}</span>
          )}
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
    <div className={cn("flex w-full max-w-full items-center gap-2 rounded-xl border border-line bg-surface-1 p-1.5 shadow-sm sm:w-auto", compact ? "sm:max-w-[13rem]" : "sm:max-w-[20rem]")}>
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
          const openPct = (row.metrics.openKg / lineTotal) * 100;
          return (
            <div
              key={row.line.id || row.index}
              className="flex h-full overflow-hidden border-r-2 border-surface-1/80 last:border-r-0"
              style={{
                width: `${segmentPct}%`,
                background: `linear-gradient(90deg, ${tone.track}, rgba(148,163,184,.12))`,
              }}
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
              <div className="h-full" style={{ width: `${openPct}%`, background: FLOW_COLORS.open }} />
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
    <div className={cn("w-full min-w-0 rounded-xl border bg-surface-1 px-3 py-2 shadow-sm", tone.border)}>
      <div className="flex min-w-0 items-center gap-2">
        <LineColorIcon index={index} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-xs font-black text-content-1">
            L{index + 1} · {lineLabel(line, index)} · {fmtKg(metrics.orderedKg)} kg
          </div>
          <div className="mt-1 flex min-w-0 flex-wrap gap-1">
            {lineSpecChips(line).slice(0, 4).map((chip, chipIndex) => (
              <span key={`${chip.label}-${chipIndex}`} className={cn("max-w-full truncate rounded-md border px-1.5 py-0.5 text-[9px] font-black uppercase", chipClass(chip.tone))}>
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
      <div
        className="h-3 overflow-hidden rounded-full border border-line"
        style={{ background: `linear-gradient(90deg, ${t.track}, rgba(148,163,184,.12))` }}
      >
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
  const skippedCount = nodes.filter((node) => node.skipped).length;
  const optionalCount = nodes.filter((node) => node.optionalAtPlanning || node.skippableAfterPreviousOutput).length;
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
          {optionalCount ? <span className="rounded-full bg-info-bg px-2 py-1 text-info-fg ring-1 ring-info-border">Optional {optionalCount}</span> : null}
          {skippedCount ? <span className="rounded-full bg-warning-bg px-2 py-1 text-warning-fg ring-1 ring-warning-border">Skipped {skippedCount}</span> : null}
          <span className="rounded-full bg-surface-1 px-2 py-1 text-content-3 ring-1 ring-line">Open {Math.max(0, nodes.length - doneCount - liveCount - nextCount - skippedCount)}</span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <svg viewBox={`0 0 ${width} 222`} width={width} height="222" className="max-w-none">
          {nodes.map((node, index) => {
            if (index === 0) return null;
            const prev = nodes[index - 1];
            const x1 = 60 + (index - 1) * stepGap + 24;
            const x2 = 60 + index * stepGap - 24;
            const y1 = yFor(prev);
            const y2 = yFor(node);
            const activeEdge = prev.done || prev.active || prev.skipped || node.done || node.active || node.skipped;
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
            const state = node.skipped ? "skipped" : node.done ? "done" : node.active ? "live" : node.next ? "next" : "open";
            const circleFill = state === "skipped" ? "#f59e0b" : state === "done" ? "#10b981" : state === "live" ? "#2563eb" : state === "next" ? "#f59e0b" : "#f8fafc";
            const circleStroke = state === "open" ? "#cbd5e1" : circleFill;
            return (
              <g key={`${node.id}-${index}`} transform={`translate(${x}, ${y})`}>
                <circle r="24" fill={circleFill} stroke={circleStroke} strokeWidth="5" opacity={state === "open" ? 0.92 : 1} />
                <text textAnchor="middle" dy="5" fill={state === "open" ? "#64748b" : "#fff"} fontSize="16" fontWeight="900">
                  {state === "skipped" ? "↷" : state === "done" ? "✓" : index + 1}
                </text>
                <text textAnchor="middle" y="46" fill="#0f172a" className="fill-content-1" fontSize="11" fontWeight="900">
                  {String(node.label).slice(0, 16)}
                </text>
                <text textAnchor="middle" y="62" fill="#64748b" fontSize="10" fontWeight="700">
                  {[node.branch, node.parallel, node.join].filter(Boolean).slice(0, 2).join(" · ")}
                </text>
                {(node.skipped || node.optionalAtPlanning || node.skippableAfterPreviousOutput) ? (
                  <text textAnchor="middle" y="78" fill={node.skipped ? "#b45309" : "#2563eb"} fontSize="9" fontWeight="900">
                    {node.skipped ? "SKIPPED" : node.optionalAtPlanning && node.skippableAfterPreviousOutput ? "OPTIONAL + WCM" : node.optionalAtPlanning ? "OPTIONAL" : "WCM SKIP"}
                  </text>
                ) : null}
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
  const spec = lineProductSpec(line);
  const bom = bomRows(line);
  const recipeRows = bom.filter((row) => row.group === "Extrusion recipe");
  const filmRows = bom.filter((row) => row.group === "Film");
  const outputs = createdFilmOutputs(line);
  const inspectorRows = recipeRows.length ? recipeRows : filmRows;
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
        <div className="space-y-2">
          {spec.layers.length ? spec.layers.slice(0, 5).map((layer, layerIndex) => (
            <div key={`layer-${layer.index}-${layerIndex}`} className="flex items-center justify-between gap-3 rounded-lg border border-info-border bg-info-bg px-3 py-2 text-xs">
              <span className="min-w-0 truncate font-bold text-primary">L{layer.index} · {textValue(layer.variantCode, layer.variantName, "Layer")}</span>
              <span className="font-mono font-black text-primary">{layer.thicknessMicron ? `${fmtQty(layer.thicknessMicron)}u` : "layer"}{layer.widthMm ? ` · ${fmtQty(layer.widthMm)}mm` : ""}</span>
            </div>
          )) : null}
          {outputs.length ? outputs.slice(0, 3).map((output) => (
            <div key={output.key} className="flex items-center justify-between gap-3 rounded-lg border border-success-border bg-success-bg px-3 py-2 text-xs">
              <span className="min-w-0 truncate font-bold text-success-fg">Created output · {output.code}</span>
              <span className="font-mono font-black text-success-fg">{fmtKg(output.qtyKg)} kg</span>
            </div>
          )) : null}
          {inspectorRows.length ? inspectorRows.slice(0, 6).map((row) => (
            <div key={row.key} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-1 px-3 py-2 text-xs">
              <span className="min-w-0 truncate font-bold text-content-2">{row.label}</span>
              <span className="font-mono font-black text-content-1">{row.qty}</span>
            </div>
          )) : (
            !spec.layers.length && !outputs.length ? <div className="rounded-lg border border-dashed border-line bg-surface-1 px-3 py-5 text-center text-xs font-semibold text-content-3">No layer/BOM snapshot on this line.</div> : null
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
    <section className="erp-virtual-card erp-stable-row overflow-hidden rounded-2xl border border-line bg-surface-1 shadow-sm" style={{ borderLeftColor: tone.fill, borderLeftWidth: 4 }}>
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
      <div className="grid min-w-0 grid-cols-1 items-start gap-0 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4 p-4 sm:p-5">
          <ProgressBar metrics={metrics} tone={tone} />
          <RouteGraph line={line} jobs={jobs} />
          <JobBreakdown jobs={jobs} />
        </div>
        <div className="min-w-0 border-t border-line p-4 sm:p-5 xl:border-l xl:border-t-0">
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

// ── BOM + layer helpers for redesigned Technical tab ──
function layerThicknessTotal(line: any): number {
  return asArray(line?.layer_snapshot).reduce((sum, layer) => {
    const row = asRecord(layer);
    return sum + safeNumber(row.thickness_micron || row.thickness);
  }, 0);
}

function layerThicknessBreakdown(line: any): number[] {
  return asArray(line?.layer_snapshot)
    .map((layer) => safeNumber(asRecord(layer)?.thickness_micron || asRecord(layer)?.thickness))
    .filter((t) => t > 0);
}

function TechnicalLine({ line, index, order }: { line: SalesOrderLine; index: number; order: SalesOrder }) {
  const geometry = geometrySummary(line);
  const spec = lineProductSpec(line, order);
  const rows = bomRows(line);
  const groupedBom = bomGroupedRows(line);
  const stepSummary = bomStepSummary(line);
  const metrics = lineMetrics(line);
  const printing = asRecord(line.printing_snapshot);
  const artwork = lineArtworkPreview(line);
  const packaging = packagingFacts(line);
  const axis = axisEntries(line);
  const tone = LINE_PROGRESS_TONES[index % LINE_PROGRESS_TONES.length];
  const totalThickness = layerThicknessTotal(line) || spec.layers.reduce((s, l) => s + safeNumber(l.thicknessMicron), 0);
  const thicknessBreakdown = layerThicknessBreakdown(line).length ? layerThicknessBreakdown(line) : spec.layers.map((l) => safeNumber(l.thicknessMicron)).filter((t) => t > 0);
  const unitWeightG = safeNumber((line as any).unit_weight_g) || safeNumber(asRecord(line?.bom_snapshot)?.summary?.unit_weight_g);
  const facts = geometryFacts(line, spec, geometry, metrics);
  const fgType = String(spec.size.finishedGoodType || asRecord(line?.geometry_snapshot).finished_good_type || "POUCH").toUpperCase();
  const width = safeNumber(geometry.width || spec.size.widthMm);
  const height = safeNumber(geometry.height || spec.size.heightMm);
  const directPurchaseFilms = rows.filter((row) => row.group === "Film" && String(row.source || "").toUpperCase().includes("PURCHASE"));
  const extrusionRows = rows.filter((row) => row.group === "Extrusion recipe");
  const outputs = createdFilmOutputs(line);
  const outputKg = outputs.reduce((sum, output) => sum + safeNumber(output.qtyKg), 0);

  return (
    <section className="erp-virtual-card erp-stable-row overflow-hidden rounded-2xl border border-line bg-surface-1 shadow-sm" style={{ borderLeftColor: tone.fill, borderLeftWidth: 4 }}>
      <div className="border-b border-line bg-gradient-to-r from-surface-2 via-surface-1 to-success-bg/70 px-5 py-4 dark:to-success-bg/20">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <LineColorIcon index={index} />
              <h2 className="min-w-0 truncate font-mono text-base font-black text-content-1">
                L{index + 1} · {lineLabel(line, index)} · {fmtKg(metrics.orderedKg)} kg
              </h2>
              <Badge variant="outline" className="rounded-full text-[10px] font-black uppercase">{line.line_status_display || statusLabel(line.line_status)}</Badge>
              {metrics.batches.length ? <Badge className="rounded-full bg-info-bg text-primary ring-1 ring-info-border">{metrics.batches.length} batch{metrics.batches.length === 1 ? "" : "es"}</Badge> : null}
            </div>
            <LineSpecChips line={line} />
          </div>
          <div className="grid min-w-[280px] gap-2 sm:grid-cols-3">
            <MiniStat label={outputs.length ? "Created output" : "Direct film"} value={outputs.length ? `${fmtKg(outputKg || metrics.orderedKg)} kg` : `${directPurchaseFilms.length} row${directPurchaseFilms.length === 1 ? "" : "s"}`} tone={outputs.length ? "green" : "blue"} />
            <MiniStat label="Recipe inputs" value={`${extrusionRows.length} row${extrusionRows.length === 1 ? "" : "s"}`} tone={extrusionRows.length ? "green" : "slate"} />
            <MiniStat label="BOM rows" value={String(rows.length)} tone={rows.length ? "amber" : "slate"} />
          </div>
        </div>
      </div>
      <div className="grid gap-4 p-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.12fr)]">
        <div className="space-y-4">
          <div className="rounded-2xl border border-line bg-surface-2 p-4">
            <SectionTitle icon={<Scale className="h-4 w-4" />} label="Geometry and production form" sub="Only the dimensions that apply to this pouch/roll style are shown." />
            <div className="mt-3 flex flex-col gap-4 rounded-xl bg-surface-1 p-3 ring-1 ring-line lg:flex-row lg:items-center">
              <div className="grid place-items-center rounded-xl bg-gradient-to-br from-info-bg via-surface-1 to-success-bg p-3 ring-1 ring-line dark:from-info-bg/30 dark:to-success-bg/20">
                <svg viewBox="0 0 240 190" width="210" height="165" className="max-w-full">
                  <defs>
                    <linearGradient id={`geom-fill-${index}`} x1="0" x2="1" y1="0" y2="1">
                      <stop offset="0%" stopColor={tone.light} />
                      <stop offset="100%" stopColor="rgba(16,185,129,.28)" />
                    </linearGradient>
                  </defs>
                  {fgType === "ROLL" ? (
                    <>
                      <rect x="35" y="58" width="170" height="62" rx="8" fill={`url(#geom-fill-${index})`} stroke={tone.fill} strokeWidth="1.6" />
                      <path d="M35 72 C70 48 170 48 205 72" fill="none" stroke={tone.dark} strokeWidth="2" opacity="0.55" />
                      <path d="M35 106 C70 132 170 132 205 106" fill="none" stroke={tone.dark} strokeWidth="2" opacity="0.35" />
                      <line x1="35" y1="144" x2="205" y2="144" stroke="#94a3b8" strokeWidth="1" />
                      <text x="120" y="160" textAnchor="middle" fontSize="10" fill="#64748b" fontWeight="800">{width > 0 ? `${fmtQty(width)} mm web` : "roll web"}</text>
                      <text x="120" y="92" textAnchor="middle" fontSize="12" fill={tone.dark} fontWeight="900">ROLL</text>
                    </>
                  ) : (
                    <>
                      {(() => {
                        const maxDim = Math.max(width || 1, height || 1);
                        const drawW = width > 0 ? Math.max(68, Math.min(128, (width / maxDim) * 128)) : 92;
                        const drawH = height > 0 ? Math.max(86, Math.min(132, (height / maxDim) * 132)) : 118;
                        const x0 = (240 - drawW) / 2;
                        const y0 = (170 - drawH) / 2;
                        return (
                          <>
                            <path d={`M${x0} ${y0} L${x0 + drawW} ${y0} L${x0 + drawW + 6} ${y0 + 9} L${x0 + drawW + 6} ${y0 + drawH} L${x0 - 6} ${y0 + drawH} L${x0 - 6} ${y0 + 9} Z`} fill={`url(#geom-fill-${index})`} stroke={tone.fill} strokeWidth="1.6" />
                            <rect x={x0 - 3} y={y0 + 5} width={drawW + 6} height="7" fill={tone.dark} opacity="0.22" />
                            {artwork ? <rect x={x0 + drawW * 0.26} y={y0 + drawH * 0.34} width={drawW * 0.48} height={drawH * 0.24} rx="3" fill="rgba(255,255,255,.8)" stroke={tone.dark} strokeDasharray="4 3" /> : null}
                            <line x1={x0 - 6} y1={y0 + drawH + 13} x2={x0 + drawW + 6} y2={y0 + drawH + 13} stroke="#94a3b8" strokeWidth="1" />
                            <text x={x0 + drawW / 2} y={y0 + drawH + 28} textAnchor="middle" fontSize="10" fill="#64748b" fontWeight="800">{width > 0 ? `${fmtQty(width)} mm` : "width"}</text>
                            <line x1={x0 - 20} y1={y0} x2={x0 - 20} y2={y0 + drawH} stroke="#94a3b8" strokeWidth="1" />
                            <text x={x0 - 31} y={y0 + drawH / 2} textAnchor="middle" fontSize="10" fill="#64748b" fontWeight="800" transform={`rotate(-90 ${x0 - 31} ${y0 + drawH / 2})`}>{height > 0 ? `${fmtQty(height)} mm` : "height"}</text>
                          </>
                        );
                      })()}
                    </>
                  )}
                </svg>
              </div>
              <div className="grid flex-1 gap-2 sm:grid-cols-2">
                {facts.length ? facts.map((fact) => (
                  <FactBox key={`${fact.label}-${fact.value}`} label={fact.label} value={fact.value} tone={fact.tone || "slate"} />
                )) : (
                  <div className="rounded-lg border border-warning-border bg-warning-bg px-3 py-3 text-sm font-semibold text-warning-fg">
                    Geometry is not captured on this line snapshot.
                  </div>
                )}
              </div>
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

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-line bg-surface-2 p-4">
              <SectionTitle icon={<ImageIcon className="h-4 w-4" />} label="Artwork and print" />
              <div className="space-y-2">
                <FactBox label="Artwork" value={textValue(artwork?.code, artwork?.name, printing.artwork_design_code, printing.enabled ? "Artwork required" : "No artwork on line")} tone={artwork || printing.artwork_design_code ? "amber" : "slate"} />
                <FactBox label="Print type" value={textValue(printing.type, printing.method, printing.enabled ? "Printing enabled" : "Unprinted / no print gate")} />
                {textValue(printing.front_colors_count, printing.back_colors_count, printing.colors_count, artwork?.colorCount) ? (
                  <FactBox label="Colors" value={textValue(printing.colors_count, printing.front_colors_count && `${printing.front_colors_count} front`, printing.back_colors_count && `${printing.back_colors_count} back`, artwork?.colorCount)} tone="blue" />
                ) : null}
              </div>
            </div>
            <div className="rounded-2xl border border-line bg-surface-2 p-4">
              <SectionTitle icon={<PackageCheck className="h-4 w-4" />} label="Packing rules" />
              <div className="space-y-2">
                {packaging.length ? packaging.map((fact) => (
                  <FactBox key={fact.label} label={fact.label} value={fact.value} tone={fact.label === "POD" ? "green" : "slate"} />
                )) : (
                  <FactBox label="Packing snapshot" value={textValue(line.packaging_snapshot ? "Default packing rules captured" : "Uses default packing rules")} />
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-line bg-gradient-to-br from-surface-2 via-surface-1 to-info-bg/70 p-4 dark:to-info-bg/20">
            <SectionTitle
              icon={<Layers className="h-4 w-4" />}
              label="Layer architecture"
              sub={`${totalThickness ? `Total ${fmtKg(totalThickness, 1)}u` : "Frozen stack"}${unitWeightG ? ` · ${fmtKg(unitWeightG, 3)} g/pc` : ""}`}
            />
            {spec.layers.length ? (
              <div className="space-y-3">
                <div className="flex h-10 overflow-hidden rounded-xl border border-line bg-surface-1">
                  {spec.layers.map((layer, layerIndex) => {
                    const layerT = safeNumber(layer.thicknessMicron);
                    const layerWidthPct = totalThickness > 0 ? Math.max(8, (layerT / totalThickness) * 100) : 100 / spec.layers.length;
                    const layerTone = LINE_PROGRESS_TONES[layerIndex % LINE_PROGRESS_TONES.length];
                    return (
                      <div
                        key={`bar-${layer.index}-${layerIndex}`}
                        className="grid place-items-center text-[10px] font-black text-white"
                        style={{ background: layerTone.fill, width: `${layerWidthPct}%` }}
                        title={`L${layer.index} · ${layerT}u`}
                      >
                        {layerT > 0 ? `${layerT}u` : `L${layer.index}`}
                      </div>
                    );
                  })}
                </div>
                {spec.layers.map((layer, layerIndex) => {
                  const layerT = safeNumber(layer.thicknessMicron);
                  const pct = totalThickness > 0 && layerT > 0 ? percent(layerT, totalThickness) : 0;
                  const layerTone = LINE_PROGRESS_TONES[layerIndex % LINE_PROGRESS_TONES.length];
                  return (
                    <div key={`${layer.label}-${layerIndex}`} className="grid gap-2 rounded-xl border border-line bg-surface-1 px-3 py-2 sm:grid-cols-[70px_minmax(0,1fr)_auto] sm:items-center">
                      <span className={cn("w-fit rounded-md px-2 py-1 text-[10px] font-black uppercase", layerTone.bg, layerTone.text)}>{`L${layer.index}`}</span>
                      <div className="h-2 overflow-hidden rounded-full bg-surface-2 ring-1 ring-line"><span className="block h-full rounded-full" style={{ width: `${pct || 10}%`, background: layerTone.fill }} /></div>
                      <div className="min-w-0 font-mono text-[11px] font-black text-content-1">
                        {textValue(layer.variantCode, layer.variantName)}{layerT ? ` · ${fmtQty(layerT)}u` : ""}{layer.widthMm ? ` · ${fmtQty(layer.widthMm)}mm` : ""}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-xl border border-warning-border bg-warning-bg px-4 py-5 text-sm font-semibold text-warning-fg">
                Layer stack is not present on this order snapshot. Update the product/template before releasing new orders.
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-line bg-surface-2 p-4">
            <SectionTitle icon={<Boxes className="h-4 w-4" />} label="BOM and material architecture" sub={`${rows.length} frozen row${rows.length === 1 ? "" : "s"} · scaled to ${fmtKg(metrics.orderedKg)} kg demand`} />
            {groupedBom.length ? (
              <div className="space-y-3">
                {groupedBom.map((group) => {
                  const meta = materialGroupMeta(group.group);
                  return (
                    <div key={group.group}>
                      <div className="mb-1.5 flex items-center justify-between">
                        <div className={cn("text-[9px] font-black uppercase tracking-wider", meta.text)}>{meta.title} · {group.totalKg > 0 ? `${fmtKg(group.totalKg, 3)} kg` : `${group.rows.length} row${group.rows.length === 1 ? "" : "s"}`}</div>
                        <span className="text-[9px] font-bold text-content-3">{group.rows.length} row{group.rows.length === 1 ? "" : "s"}</span>
                      </div>
                      <div className="overflow-hidden rounded-xl border border-line bg-surface-1">
                        <div className="grid grid-cols-[minmax(0,1fr)_72px_90px_92px] gap-2 border-b border-line bg-surface-2 px-2.5 py-1.5 text-[8px] font-black uppercase tracking-wider text-content-3">
                          <div>Material</div>
                          <div className="text-right">g/pc</div>
                          <div className="text-right">Order qty</div>
                          <div className="text-right">Source</div>
                        </div>
                        {group.rows.map((bRow, ri) => (
                          <div key={`${bRow.label}-${ri}`} className="grid grid-cols-[minmax(0,1fr)_72px_90px_92px] gap-2 border-b border-line px-2.5 py-2 text-[11px] last:border-b-0">
                            <div className="min-w-0">
                              <div className="truncate font-mono font-black text-content-1">{bRow.label}</div>
                              {bRow.name || bRow.detail ? <div className="truncate text-[9px] font-semibold text-content-3">{textValue(bRow.name, bRow.detail)}</div> : null}
                            </div>
                            <div className="text-right font-mono font-bold text-content-2">{bRow.perUnit || "—"}</div>
                            <div className="text-right font-mono font-black text-content-1">{bRow.qty}</div>
                            <div className="text-right"><span className={cn("rounded-md px-1.5 py-0.5 text-[8px] font-black uppercase ring-1", meta.bg, meta.text, meta.border)}>{bRow.source}</span></div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
                {stepSummary.length ? (
                  <div className="pt-1">
                    <div className="mb-2 text-[10px] font-black uppercase tracking-[0.22em] text-content-4">BOM by route step</div>
                    <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-bold">
                      {stepSummary.map((step, stepIndex) => {
                        const stepTone = LINE_PROGRESS_TONES[stepIndex % LINE_PROGRESS_TONES.length];
                        return (
                          <span key={step.step} className={cn("rounded-lg px-2 py-1.5 text-center ring-1", stepTone.bg, stepTone.text, stepTone.border)}>
                            {step.step === "Snapshot" ? "snapshot" : `step ${step.step}`} · {step.count}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
                <div className="rounded-xl border border-info-border bg-info-bg px-3 py-2.5 text-xs font-bold text-primary">
                  {extrusionRows.length
                    ? `Extrusion recipe present: ${extrusionRows.length} raw-material row${extrusionRows.length === 1 ? "" : "s"} will feed in-house roll creation.`
                    : directPurchaseFilms.length
                      ? `Direct purchase film plan: ${directPurchaseFilms.length} film row${directPurchaseFilms.length === 1 ? "" : "s"}; no extrusion recipe is required for this line.`
                      : "Frozen BOM rows are scaled from the sales-order snapshot."}
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-warning-border bg-warning-bg px-4 py-5 text-sm font-semibold text-warning-fg">
                BOM rows are not present on this frozen snapshot. Update the product/template before releasing new orders.
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
  const apiMaterials = asArray(tracking?.material_audit?.materials);
  const materials = apiMaterials.length ? apiMaterials : materialAuditRowsFromOrder(order);
  const events = asArray(tracking?.audit_timeline);
  const timelineEvents = events.length ? events : snapshotTimelineEvents(order, tracking);
  const lineage = asArray(tracking?.wip_lineage);
  const interplant = asArray(tracking?.interplant_links);
  const totals = orderMetrics(order, tracking);
  const materialRequired = materials.reduce((sum, row) => sum + safeNumber(row.required_kg), 0);
  const materialConsumed = materials.reduce((sum, row) => sum + safeNumber(row.consumed_kg), 0);
  const materialRemaining = materials.reduce((sum, row) => sum + Math.max(0, safeNumber(row.remaining_kg)), 0);
  const targetKg = safeNumber(summary.ordered_target_kg || totals.orderedKg);
  const outputKg = safeNumber(summary.latest_output_kg || totals.producedKg);
  const wipKg = safeNumber(summary.wip_output_kg || totals.wipKg);
  const scrapKg = safeNumber(summary.scrap_logged_kg || totals.scrapKg);
  const gapKg = safeNumber(summary.mass_gap_to_target_kg || totals.openKg);
  const readyKg = Math.max(0, totals.readyKg || outputKg - totals.dispatchedKg);
  const yieldPct = outputKg + scrapKg > 0 ? percent(outputKg, outputKg + scrapKg) : 0;
  const consumedPct = percent(materialConsumed, materialRequired);

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-success-border bg-gradient-to-br from-success-bg via-surface-1 to-warning-bg/70 p-5 shadow-sm dark:from-success-bg/20 dark:to-warning-bg/20">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-lg font-black text-content-1">
              <ShieldCheck className="h-5 w-5 text-success-fg" /> Material audit and production truth
            </div>
            <p className="mt-1 max-w-3xl text-sm font-semibold text-content-3">
              Full mass-balance across ordered target, final output, live WIP, material requirements, consumption, scrap, and system events.
            </p>
          </div>
          <Badge className="w-fit rounded-full bg-surface-1 px-3 py-1 font-mono text-[10px] font-black uppercase text-content-2 ring-1 ring-line">
            {tracking?.data_freshness?.generated_at ? `Refreshed ${fmtDate(tracking.data_freshness.generated_at)}` : "Live snapshot"}
          </Badge>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
          <MetricTile label="Target" value={`${fmtKg(targetKg)} kg`} tone="blue" icon={<Package className="h-5 w-5" />} />
          <MetricTile label="Output" value={`${fmtKg(outputKg)} kg`} sub="latest final output" tone="green" icon={<CheckCircle2 className="h-5 w-5" />} />
          <MetricTile label="WIP output" value={`${fmtKg(wipKg)} kg`} sub="active route work" tone="violet" icon={<Activity className="h-5 w-5" />} />
          <MetricTile label="Consumed" value={`${fmtKg(materialConsumed)} kg`} sub={`${materials.length} material rows`} tone="amber" icon={<Boxes className="h-5 w-5" />} />
          <MetricTile label="Scrap" value={`${fmtKg(scrapKg)} kg`} sub="logged yield loss" tone="rose" icon={<AlertTriangle className="h-5 w-5" />} />
          <MetricTile label="Mass gap" value={`${fmtKg(gapKg)} kg`} sub="target minus output" tone="slate" icon={<Scale className="h-5 w-5" />} />
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-surface-1 p-5 shadow-sm">
        <SectionTitle icon={<Activity className="h-4 w-4" />} label="Order mass balance" sub="How ordered target converts into ready FG, dispatch, live WIP, scrap, and open demand." />
        <div className="mt-4 flex flex-wrap items-stretch gap-2 text-center">
          <FlowBlock label="Ordered target" value={targetKg} pct={100} className="bg-primary text-white" />
          <FlowArrow />
          <FlowBlock label="Final output" value={outputKg} pct={percent(outputKg, targetKg)} className="bg-success-fg text-white" />
          <FlowArrow label="+" />
          <FlowBlock label="Ready FG" value={readyKg} pct={percent(readyKg, targetKg)} className="bg-info-bg text-primary ring-1 ring-info-border" />
          <FlowArrow label="+" />
          <FlowBlock label="Dispatched" value={totals.dispatchedKg} pct={percent(totals.dispatchedKg, targetKg)} className="bg-success-bg text-success-fg ring-1 ring-success-border" />
          <FlowArrow label="+" />
          <FlowBlock label="Live WIP" value={wipKg} pct={percent(wipKg, targetKg)} className="bg-order-bg text-order-fg ring-1 ring-order-border" />
          <FlowArrow label="+" />
          <FlowBlock label="Open gap" value={gapKg} pct={percent(gapKg, targetKg)} className="bg-surface-2 text-content-1 ring-1 ring-line" />
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-line bg-surface-2 p-3">
            <div className="flex items-center justify-between">
              <div className="text-[10px] font-black uppercase tracking-wider text-content-4">Yield efficiency</div>
              <span className="font-mono text-sm font-black text-success-fg">{Math.round(yieldPct)}%</span>
            </div>
            <div className="mt-2 flex h-3 overflow-hidden rounded-full bg-surface-1 ring-1 ring-line">
              <div className="bg-success-fg" style={{ width: `${yieldPct}%` }} />
              <div className="bg-danger-fg" style={{ width: `${scrapKg > 0 ? Math.max(2, 100 - yieldPct) : 0}%` }} />
            </div>
            <div className="mt-1.5 flex justify-between text-[10px] font-bold text-content-3">
              <span>Output {fmtKg(outputKg)} kg</span><span className="text-danger-fg">Scrap {fmtKg(scrapKg)} kg</span>
            </div>
          </div>
          <div className="rounded-xl border border-line bg-surface-2 p-3">
            <div className="flex items-center justify-between">
              <div className="text-[10px] font-black uppercase tracking-wider text-content-4">Material consumption</div>
              <span className="font-mono text-sm font-black text-warning-fg">{fmtKg(materialConsumed)} / {fmtKg(materialRequired)} kg</span>
            </div>
            <div className="mt-2 flex h-3 overflow-hidden rounded-full bg-surface-1 ring-1 ring-line">
              <div className="bg-warning-fg" style={{ width: `${consumedPct}%` }} />
            </div>
            <div className="mt-1.5 flex justify-between text-[10px] font-bold text-content-3">
              <span>Consumed {fmtKg(materialConsumed)} kg</span><span>Required {fmtKg(materialRequired)} kg</span>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-surface-1 p-5 shadow-sm">
        <SectionTitle icon={<Layers className="h-4 w-4" />} label="Line layer stack and BOM recipe" sub="Each sales line keeps its commercial demand, created roll output, and raw-material recipe separated." />
        {asArray(order.items).length ? (
          <div className="grid gap-3 xl:grid-cols-2">
            {asArray(order.items).map((line: SalesOrderLine, index) => (
              <LineLayerBomCard key={line.id || index} line={line} index={index} />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-line bg-surface-2 px-4 py-5 text-sm font-semibold text-content-3">No sales lines are linked to this order snapshot.</div>
        )}
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
                      <MiniStat label="WIP" value={`${fmtKg(row.wip_output_kg)} kg`} tone="violet" />
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
              Line flow appears after the tracking service links sales lines to production truth.
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-line bg-surface-1 p-5 shadow-sm">
            <SectionTitle icon={<Boxes className="h-4 w-4" />} label="Material ledger" sub={`${materials.length} material row${materials.length === 1 ? "" : "s"} · required ${fmtKg(materialRequired)} kg · consumed ${fmtKg(materialConsumed)} kg`} />
            {materials.length ? (
              <div className="space-y-2 nice-scroll max-h-[420px] overflow-y-auto pr-1">
                {materials.slice(0, 24).map((row, index) => {
                  const required = safeNumber(row.required_kg);
                  const consumed = safeNumber(row.consumed_kg);
                  const group = materialGroupName({ category_code: row.category, material_code: row.material_code });
                  const meta = materialGroupMeta(group);
                  return (
                    <div key={`${row.material_code}-${index}`} className="rounded-xl border border-line bg-surface-2 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate font-mono text-xs font-black text-content-1">{row.material_code}</div>
                          <div className="mt-0.5 truncate text-[11px] font-semibold text-content-3">{row.material_name} · {row.category || "Material"}</div>
                          {asArray(row.line_labels).length ? <div className="mt-1 truncate text-[10px] font-bold text-content-4">{asArray(row.line_labels).join(" · ")}</div> : null}
                        </div>
                        <Badge variant="outline" className={cn("rounded-full text-[9px] font-black uppercase", meta.bg, meta.text, meta.border)}>{row.steps && row.steps !== "—" ? `Steps ${row.steps}` : row.source || "BOM"}</Badge>
                      </div>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-1 ring-1 ring-line">
                        <div className="h-full bg-warning-fg" style={{ width: `${percent(consumed, required)}%` }} />
                      </div>
                      <div className="mt-2 grid grid-cols-3 gap-2 text-[10px] font-black uppercase text-content-3">
                        <span>Req <b className="text-content-1">{fmtKg(required)}</b></span>
                        <span>Used <b className="text-content-1">{fmtKg(consumed)}</b></span>
                        <span>Left <b className={safeNumber(row.remaining_kg) > 0 ? "text-danger-fg" : "text-success-fg"}>{fmtKg(row.remaining_kg)}</b></span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="rounded-xl border border-warning-border bg-warning-bg px-4 py-5 text-sm font-semibold text-warning-fg">
                No frozen BOM rows or material consumption logs are linked to this order yet.
              </div>
            )}
            {materialRemaining > 0 ? (
              <div className="mt-3 rounded-xl border border-info-border bg-info-bg px-3 py-2 text-xs font-bold text-primary">
                Remaining material requirement visible: {fmtKg(materialRemaining)} kg across {materials.length} rows.
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-line bg-surface-1 p-5 shadow-sm">
            <SectionTitle icon={<GitBranch className="h-4 w-4" />} label="WIP and interplant trace" />
            <div className="grid grid-cols-2 gap-2">
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
              {!lineage.length && !interplant.length ? (
                <div className="rounded-xl border border-line bg-surface-2 px-4 py-5 text-sm font-semibold text-content-3">No live WIP roll or interplant transfer is linked yet.</div>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-surface-1 p-5 shadow-sm">
        <SectionTitle icon={<Clock className="h-4 w-4" />} label="Latest timeline" sub="System, production, material, dispatch, and line lifecycle events." />
        {timelineEvents.length ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {timelineEvents.slice(0, 18).map((event: any, index) => {
              const tone = eventTone(event.event_type) as "slate" | "blue" | "green" | "amber" | "violet" | "rose";
              return (
                <TimelineEvent
                  key={`${event.entity_id}-${event.timestamp}-${index}`}
                  title={event.message || event.event_type}
                  subtitle={[fmtDate(event.timestamp), event.actor || "system", event.reference, event.line_label].filter(Boolean).join(" · ")}
                  meta={statusLabel(event.event_type)}
                  qty={safeNumber(event.delta_qty_kg) ? `${safeNumber(event.delta_qty_kg) > 0 ? "+" : ""}${fmtKg(event.delta_qty_kg)} kg` : undefined}
                  tone={tone}
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

function FlowBlock({ label, value, pct, className }: { label: string; value: number; pct: number; className: string }) {
  return (
    <div className={cn("min-w-[132px] flex-1 rounded-xl p-3 shadow-sm", className)}>
      <div className="text-[9px] font-black uppercase tracking-wider opacity-80">{label}</div>
      <div className="mt-1 font-mono text-xl font-black">{fmtKg(value)}</div>
      <div className="text-[10px] font-bold opacity-80">kg · {Math.round(pct)}%</div>
    </div>
  );
}

function FlowArrow({ label = "->" }: { label?: string }) {
  return <div className="grid min-w-5 place-items-center text-sm font-black text-content-4">{label}</div>;
}

function TimelineEvent({ title, subtitle, meta, qty, tone }: { title: string; subtitle?: string; meta?: string; qty?: string; tone: "slate" | "blue" | "green" | "amber" | "violet" | "rose" }) {
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
  const icon = tone === "green" ? <Truck className="h-4 w-4" /> : tone === "blue" ? <CheckCircle2 className="h-4 w-4" /> : tone === "amber" ? <Boxes className="h-4 w-4" /> : tone === "rose" ? <AlertTriangle className="h-4 w-4" /> : <Clock className="h-4 w-4" />;
  return (
    <div className={cn("flex gap-3 rounded-xl border px-4 py-3", toneClass)}>
      <div className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-surface-1/80 ring-1 ring-line">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-black text-content-1">{title}</span>
          {meta ? <span className="rounded-full bg-surface-1/80 px-1.5 py-0.5 text-[9px] font-black uppercase ring-1 ring-line">{meta}</span> : null}
        </div>
        {subtitle ? <div className="mt-1 text-xs font-semibold text-content-3">{subtitle}</div> : null}
      </div>
      {qty ? <div className="font-mono text-sm font-black text-content-1">{qty}</div> : null}
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
    <div className="erp-soft-canvas erp-smooth-surface min-h-screen">
      <div className="mx-auto w-full max-w-[1600px] space-y-5 px-4 py-5 sm:px-5 lg:px-7">
        <section className="erp-stable-row overflow-hidden rounded-2xl border border-line bg-surface-1 shadow-sm">
          <div className="grid min-w-0 grid-cols-1 gap-0 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="min-w-0 p-4 sm:p-5 lg:p-6">
              <Button variant="ghost" size="sm" className="mb-4 h-auto p-0 text-content-4 hover:bg-transparent hover:text-content-2" onClick={() => router.back()}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Back to sales orders
              </Button>
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Badge className="rounded-full bg-info-bg px-3 py-1 font-mono text-[10px] font-black uppercase text-primary ring-1 ring-info-border">{order.order_number}</Badge>
                <Badge variant="outline" className="rounded-full border-warning-border bg-warning-bg px-3 py-1 font-mono text-[10px] font-black uppercase text-content-1">{statusLabel(order.status)}</Badge>
                {trackingQuery.isFetching ? <Badge variant="outline" className="rounded-full text-[10px] font-black uppercase"><Loader2 className="mr-1 h-3 w-3 animate-spin" /> refreshing</Badge> : null}
              </div>
              <div className="mt-3 flex min-w-0 flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div className="min-w-0">
                  <h1 className="max-w-full truncate text-2xl font-black tracking-tight text-content-1 sm:text-3xl lg:text-4xl">{order.customer_name}</h1>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-sm font-semibold text-content-3">
                    <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-4 w-4 text-primary" /> Placed {fmtDate(order.created_at)}</span>
                    <span className="inline-flex items-center gap-1.5"><Clock className="h-4 w-4 text-primary" /> Due {fmtDate(order.delivery_date)}</span>
                    <span>{items.length} line{items.length === 1 ? "" : "s"}</span>
                    <span>{fmtKg(metrics.orderedKg)} kg ordered</span>
                  </div>
                </div>
                <ArtworkThumb preview={orderArtwork} />
              </div>
              <div className="mt-5 grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-4">
                {items.map((line, index) => (
                  <LineHeaderChip key={line.id || index} line={line} index={index} />
                ))}
              </div>
            </div>
            <div className="min-w-0 border-t border-line bg-surface-2 p-4 sm:p-5 xl:border-l xl:border-t-0">
              <div className="flex min-w-0 items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[10px] font-black uppercase tracking-[0.18em] text-content-4">Fulfillment truth</div>
                  <div className="mt-1 text-xs font-semibold text-content-3">Ready output, customer dispatch, live route WIP, and open demand.</div>
                </div>
                <div className="flex-none text-right">
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

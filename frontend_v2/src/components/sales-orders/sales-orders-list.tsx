"use client";

/**
 * V3.7 Sales Orders list — full sales queue with:
 * - Subtle V37 hero + 6 KPI tiles (Open · Awaiting planning · Aged 6+d · Created today · Value · Avg age)
 * - Two-row compact filter band (status pills + age pills + customer + master + Advanced popover + Reset)
 * - Saved views (localStorage, scoped per user)
 * - Bulk select with floating action bar (Export CSV · Cancel selected)
 * - Comfortable / Compact density toggle
 * - Row expand inline (line items + activity timeline) without route change
 * - Cancel modal with reason categories (replaces window.prompt)
 * - Mobile-optimised (single column rows below md, two-line stacked layout)
 *
 * Wires only to existing services. No new field, no schema change.
 * salesService.getOrders / cancelOrder / getOrder
 * masterDataService.getCustomers
 * productMasterService.list
 */

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  ChevronDown,
  Download,
  ImageIcon,
  Loader2,
  Plus,
  Search,
  SlidersHorizontal,
  Star,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { salesService, type SalesOrder } from "@/services/sales";
import { masterDataService, type Customer } from "@/services/master-data";
import {
  productMasterService,
  type ProductMaster,
} from "@/services/product-master";
import { formatDisplayDate } from "@/lib/date-format";

// ─── Types ─────────────────────────────────────────────────────────────

type AgeBucket = "fresh" | "watch" | "aged";
type Density = "comfortable" | "compact";
type Tab = "queue" | "history" | "cancelled";
type AxisChipTone =
  | "slate"
  | "violet"
  | "emerald"
  | "blue"
  | "fuchsia"
  | "amber"
  | "rose"
  | "cyan";

interface AxisChip {
  key: string;
  label: string;
  tone: AxisChipTone;
  title?: string;
}

interface ArtworkPreview {
  id?: string;
  code?: string;
  name?: string;
  thumbnailUrl?: string;
  accentHex?: string;
  colorCount?: number;
  source: "line" | "order";
}

type StatusKey =
  | "DRAFT"
  | "CONFIRMED"
  | "PLANNING_REQUIRED"
  | "PLANNED"
  | "RELEASED"
  | "PACKING_READY"
  | "DISPATCH_READY"
  | "COMPLETED"
  | "CANCELLED";

interface SavedView {
  id: string;
  label: string;
  filters: {
    status: StatusKey | "ALL";
    age: AgeBucket | "ALL";
    customer: string;
    master: string;
    searchText: string;
    fgType: string;
    widthMm: string;
    heightMm: string;
    thicknessUm: string;
    pouchStyle: string;
  };
}

const DEFAULT_FILTERS: SavedView["filters"] = {
  status: "ALL",
  age: "ALL",
  customer: "",
  master: "",
  searchText: "",
  fgType: "",
  widthMm: "",
  heightMm: "",
  thicknessUm: "",
  pouchStyle: "",
};

const STATUS_PILL_TONE: Record<StatusKey, string> = {
  DRAFT: "bg-surface-2 text-content-2 ring-line",
  CONFIRMED: "bg-surface-2 text-content-2 ring-line",
  PLANNING_REQUIRED: "bg-warning-bg text-warning-fg ring-warning-border",
  PLANNED: "bg-info-bg text-primary ring-info-border",
  RELEASED: "bg-danger-bg text-danger-fg ring-danger-border",
  PACKING_READY: "bg-order-bg text-order-fg ring-order-border",
  DISPATCH_READY: "bg-success-bg text-success-fg ring-success-border",
  COMPLETED: "bg-success-bg text-success-fg ring-success-border",
  CANCELLED: "bg-surface-2 text-content-2 ring-line",
};
const STATUS_LABEL: Record<StatusKey, string> = {
  DRAFT: "Draft",
  CONFIRMED: "Confirmed",
  PLANNING_REQUIRED: "Planning",
  PLANNED: "Planned",
  RELEASED: "Released",
  PACKING_READY: "Packing",
  DISPATCH_READY: "Dispatch",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

const CANCEL_REASONS: Array<{ value: string; label: string }> = [
  { value: "CUSTOMER_CANCELLED", label: "Customer cancelled" },
  { value: "SPEC_ERROR", label: "Spec error" },
  { value: "CREDIT_HOLD", label: "Credit hold" },
  { value: "DUPLICATE", label: "Duplicate" },
  { value: "OTHER", label: "Other" },
];

const LINE_PROGRESS_TONES = [
  { fill: "#2563eb", bg: "rgba(37,99,235,.14)", text: "text-primary", border: "border-info-border" },
  { fill: "#10b981", bg: "rgba(16,185,129,.14)", text: "text-success-fg", border: "border-success-border" },
  { fill: "#7c3aed", bg: "rgba(124,58,237,.13)", text: "text-order-fg", border: "border-order-border" },
  { fill: "#f59e0b", bg: "rgba(245,158,11,.16)", text: "text-warning-fg", border: "border-warning-border" },
  { fill: "#ef4444", bg: "rgba(239,68,68,.12)", text: "text-danger-fg", border: "border-danger-border" },
  { fill: "#0891b2", bg: "rgba(8,145,178,.13)", text: "text-primary", border: "border-info-border" },
];

// ─── Helpers ───────────────────────────────────────────────────────────

function safeNumber(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function fmtKg(v: unknown): string {
  return safeNumber(v).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}
function fmtQty(v: unknown, max = 0): string {
  return safeNumber(v).toLocaleString("en-IN", { maximumFractionDigits: max });
}
function fmtMoney(v: unknown): string {
  const n = safeNumber(v);
  if (n >= 100000) return `₹${(n / 100000).toFixed(2)} L`;
  return `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}
function ageDays(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}
function ageBucket(d: number): AgeBucket {
  if (d <= 2) return "fresh";
  if (d <= 5) return "watch";
  return "aged";
}
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const dt = new Date(iso);
  if (!Number.isFinite(dt.getTime())) return "—";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(dt);
  d.setHours(0, 0, 0, 0);
  if (d.getTime() === today.getTime()) return "today";
  if (d.getTime() === today.getTime() - 86400000) return "yesterday";
  return formatDisplayDate(dt);
}
function customerInitials(name: string): string {
  return (
    name
      .split(/\s+/)
      .slice(0, 2)
      .map((s) => s[0] || "")
      .join("")
      .toUpperCase() || "—"
  );
}
function customerAvatarTone(d: number): string {
  if (d >= 6) return "bg-gradient-to-br from-danger-bg to-danger-fg";
  if (d >= 3) return "bg-gradient-to-br from-warning-bg to-warning-fg";
  return "bg-gradient-to-br from-success-bg to-success-fg";
}
function orderTotalKg(o: SalesOrder): number {
  return orderQtyPair(o).kg;
}
function orderTotalValue(o: SalesOrder): number {
  return safeNumber(o.total_value);
}
function orderProducedKg(o: SalesOrder): number {
  return safeNumber(o.fulfillment_summary?.produced_kg ?? 0);
}
function orderDispatchedKg(o: SalesOrder): number {
  return safeNumber(o.fulfillment_summary?.dispatched_kg ?? 0);
}
function orderPackedKg(o: SalesOrder): number {
  const items = Array.isArray((o as any).items) ? (o as any).items : [];
  const fromLines = items.reduce((sum: number, item: any) => {
    const summary = item?.production_batch_summary && typeof item.production_batch_summary === "object"
      ? item.production_batch_summary
      : {};
    const batches = Array.isArray(summary.batches) ? summary.batches : [];
    const batchPacked = batches.reduce((next: number, batch: any) => next + safeNumber(batch?.packed_qty_kg), 0);
    return sum + (batchPacked || safeNumber(item?.qty_dispatchable));
  }, 0);
  return fromLines || safeNumber((o.fulfillment_summary as any)?.packed_kg ?? (o.fulfillment_summary as any)?.dispatchable_kg ?? 0);
}
function flowBandMetrics({
  orderedKg,
  producedKg,
  packedKg,
  dispatchedKg,
}: {
  orderedKg: number;
  producedKg: number;
  packedKg: number;
  dispatchedKg: number;
}) {
  const bounded = (value: number) => Math.max(0, Math.min(orderedKg, value));
  const dispatched = bounded(dispatchedKg);
  const packed = Math.max(0, bounded(packedKg) - dispatched);
  const produced = Math.max(0, bounded(producedKg) - Math.max(bounded(packedKg), dispatched));
  const covered = Math.max(bounded(producedKg), bounded(packedKg), dispatched);
  return {
    dispatchedPct: orderedKg > 0 ? (dispatched / orderedKg) * 100 : 0,
    packedPct: orderedKg > 0 ? (packed / orderedKg) * 100 : 0,
    producedPct: orderedKg > 0 ? (produced / orderedKg) * 100 : 0,
    completePct: orderedKg > 0 ? (covered / orderedKg) * 100 : 0,
    openKg: Math.max(0, orderedKg - covered),
  };
}
function isOpen(o: SalesOrder): boolean {
  const s = String(o.status || "").toUpperCase();
  return !["COMPLETED", "CANCELLED"].includes(s);
}
function unwrapOrders(raw: any): SalesOrder[] {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.results)) return raw.results;
  if (Array.isArray(raw?.items)) return raw.items;
  return [];
}

interface OrderQtyPair {
  kg: number;
  pcs: number | null;
  primaryUom: "KG" | "PCS";
  finishedGoodType: string;
  source: "summary" | "items" | "fallback";
}

function itemFinishedGoodType(item: any, fallback = ""): string {
  const geometry = asRecord(item?.geometry_snapshot);
  return cleanText(
    geometry.finished_good_type || item?.finished_good_type || fallback,
  ).toUpperCase();
}

function itemUnitWeightG(item: any, fallback?: unknown): number {
  return safeNumber(
    item?.unit_weight_g ?? item?.summary?.unit_weight_g ?? fallback,
  );
}

function itemOrderedKg(item: any): number {
  const qty = safeNumber(
    item?.qty_value ?? item?.ordered_qty ?? item?.quantity,
  );
  const uom = cleanText(item?.qty_uom || item?.uom).toUpperCase();
  const total = safeNumber(item?.total_weight_kg);
  if (total > 0) return total;
  if (uom === "KG") return qty;
  const unitWeight = itemUnitWeightG(item);
  if (uom === "PCS" && qty > 0 && unitWeight > 0)
    return (qty * unitWeight) / 1000;
  return 0;
}

function itemOrderedPcs(item: any): number | null {
  if (itemFinishedGoodType(item) === "ROLL") return null;
  const qty = safeNumber(
    item?.qty_value ?? item?.ordered_qty ?? item?.quantity,
  );
  const uom = cleanText(item?.qty_uom || item?.uom).toUpperCase();
  if (uom === "PCS") return qty;
  const unitWeight = itemUnitWeightG(item);
  const kg = itemOrderedKg(item);
  if (unitWeight > 0 && kg > 0) return (kg * 1000) / unitWeight;
  return null;
}

function orderPrimaryUom(order: SalesOrder): "KG" | "PCS" {
  const firstItem = Array.isArray(order.items) ? order.items[0] : null;
  const itemUom = cleanText(firstItem?.qty_uom || firstItem?.uom).toUpperCase();
  const summaryUom = cleanText(
    (order.item_summary as any)?.spec_facets?.qty_uom,
  ).toUpperCase();
  const fgType = cleanText(
    order.item_summary?.finished_good_type || itemFinishedGoodType(firstItem),
  ).toUpperCase();
  if (fgType === "ROLL") return "KG";
  if (itemUom === "PCS" || summaryUom === "PCS") return "PCS";
  return "KG";
}

function orderQtyPair(order: SalesOrder): OrderQtyPair {
  const items = Array.isArray(order.items) ? order.items : [];
  const fgType =
    cleanText(
      order.item_summary?.finished_good_type ||
        itemFinishedGoodType(items[0], "POUCH"),
    ).toUpperCase() || "POUCH";
  const summaryKg = safeNumber(
    order.qty_summary?.ordered_kg ?? order.total_weight_kg,
  );
  const summaryPcsRaw = order.qty_summary?.ordered_pcs;
  const summaryPcs =
    summaryPcsRaw === null || summaryPcsRaw === undefined
      ? null
      : safeNumber(summaryPcsRaw);
  let kg = summaryKg;
  let pcs: number | null = summaryPcs;
  let source: OrderQtyPair["source"] = order.qty_summary
    ? "summary"
    : "fallback";

  if ((kg <= 0 || pcs === null) && items.length) {
    source = "items";
    const itemKg = items.reduce((sum, item) => sum + itemOrderedKg(item), 0);
    if (kg <= 0 && itemKg > 0) kg = itemKg;
    if (fgType !== "ROLL" && pcs === null) {
      let hasPcs = false;
      const itemPcs = items.reduce((sum, item) => {
        const next = itemOrderedPcs(item);
        if (next === null) return sum;
        hasPcs = true;
        return sum + next;
      }, 0);
      if (hasPcs) pcs = itemPcs;
    }
  }

  const summaryUnitWeight = safeNumber(order.item_summary?.unit_weight_g);
  if (fgType !== "ROLL" && pcs === null && kg > 0 && summaryUnitWeight > 0) {
    pcs = (kg * 1000) / summaryUnitWeight;
    source = "fallback";
  }
  if (kg <= 0 && pcs !== null && pcs > 0 && summaryUnitWeight > 0) {
    kg = (pcs * summaryUnitWeight) / 1000;
    source = "fallback";
  }

  return {
    kg,
    pcs: fgType === "ROLL" ? null : pcs,
    primaryUom: orderPrimaryUom(order),
    finishedGoodType: fgType,
    source,
  };
}

function lineQtyPair(item: any): OrderQtyPair {
  const fgType = itemFinishedGoodType(item, "POUCH") || "POUCH";
  const primaryUom =
    fgType === "ROLL"
      ? "KG"
      : cleanText(item?.qty_uom || item?.uom).toUpperCase() === "PCS"
        ? "PCS"
        : "KG";
  const kg = itemOrderedKg(item);
  let pcs = itemOrderedPcs(item);
  const unitWeight = itemUnitWeightG(item);
  if (fgType !== "ROLL" && pcs === null && kg > 0 && unitWeight > 0)
    pcs = (kg * 1000) / unitWeight;
  return {
    kg,
    pcs: fgType === "ROLL" ? null : pcs,
    primaryUom,
    finishedGoodType: fgType,
    source: "items",
  };
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function cleanText(value: unknown): string {
  const text = String(value ?? "").trim();
  return text &&
    !["null", "undefined", "none", "nan", "—"].includes(text.toLowerCase())
    ? text
    : "";
}

function firstCleanText(...values: unknown[]): string {
  for (const value of values) {
    const text = cleanText(value);
    if (text) return text;
  }
  return "";
}

function artworkPreviewFromSource(source: any, fallbackSource: "line" | "order"): ArtworkPreview | null {
  const record = asRecord(source);
  const preview = asRecord(record.artwork_preview || record.preview_artwork);
  const printing = asRecord(record.printing_snapshot || record.printing);
  const assignment = asRecord(record.artwork_assignment || record.assigned_artwork);
  const artwork = asRecord(record.artwork || record.committed_artwork);
  const image = asRecord(record.primary_image || record.image);

  const id = firstCleanText(
    preview.artwork_id,
    preview.id,
    record.assigned_artwork_id,
    record.artwork_id,
    printing.artwork_id,
    assignment.artwork_id,
    assignment.id,
    artwork.id,
    record.committed_artwork_id,
  );
  const code = firstCleanText(
    preview.design_code,
    preview.artwork_design_code,
    record.artwork_design_code,
    printing.artwork_design_code,
    assignment.design_family_code,
    assignment.design_code,
    assignment.code,
    artwork.design_code,
    record.committed_artwork_code,
  );
  const name = firstCleanText(
    preview.name,
    preview.artwork_name,
    assignment.design_family_name,
    assignment.colorway_name,
    assignment.name,
    artwork.name,
    record.committed_artwork_name,
  );
  const thumbnailUrl = firstCleanText(
    preview.thumbnail_url,
    preview.cover_url,
    preview.image_url,
    assignment.cover_url,
    assignment.thumbnail_url,
    assignment.primary_image,
    assignment.image,
    artwork.thumbnail_url,
    artwork.primary_image,
    artwork.image,
    image.url,
    record.thumbnail_url,
    record.preview_url,
    record.image_url,
  );
  const accentHex = firstCleanText(
    preview.accent_hex,
    assignment.accent_hex,
    artwork.accent_hex,
    record.accent_hex,
  );
  const colorCount = Number(
    preview.color_count ||
      preview.colors_count ||
    assignment.color_count ||
      artwork.color_count ||
      artwork.colors_count ||
      printing.colors_count ||
      0,
  );

  if (!id && !code && !name && !thumbnailUrl) return null;
  return {
    id: id || undefined,
    code: code || undefined,
    name: name || undefined,
    thumbnailUrl: thumbnailUrl || undefined,
    accentHex: accentHex || undefined,
    colorCount: Number.isFinite(colorCount) && colorCount > 0 ? colorCount : undefined,
    source: fallbackSource,
  };
}

function artworkPreviewForOrder(order: SalesOrder): ArtworkPreview | null {
  const items = Array.isArray((order as any).items) ? (order as any).items : [];
  for (const item of items) {
    const preview = artworkPreviewFromSource(item, "line");
    if (preview) return preview;
  }
  return artworkPreviewFromSource(order.item_summary, "order") || artworkPreviewFromSource(order, "order");
}

function compactNumber(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "";
  return n.toLocaleString("en-IN", { maximumFractionDigits: n % 1 ? 2 : 0 });
}

function humanAxisName(key: string): string {
  const mapped: Record<string, string> = {
    size: "Size",
    pouch_style: "Style",
    roll_form: "Roll type",
    layer_thicknesses: "Thickness",
    layer_grades: "Grade",
    layer_widths: "Layer width",
    addons: "Add-on",
    addon: "Add-on",
    packaging: "Packing",
    packaging_inner: "Inner pack",
    packaging_outer: "Outer pack",
    pod: "POD",
    pod_variant: "POD",
    artwork_mode: "Artwork",
    lane_up: "Lane-up",
    lanes: "Lane-up",
  };
  const normalized = key.trim();
  return (
    mapped[normalized] ||
    normalized.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase())
  );
}

function chipToneClasses(tone: AxisChipTone): string {
  switch (tone) {
    case "violet":
      return "bg-order-bg text-order-fg ring-order-border";
    case "emerald":
      return "bg-success-bg text-success-fg ring-success-border";
    case "blue":
      return "bg-info-bg text-primary ring-info-border";
    case "fuchsia":
      return "bg-order-bg text-order-fg ring-order-border";
    case "amber":
      return "bg-warning-bg text-warning-fg ring-warning-border";
    case "rose":
      return "bg-danger-bg text-danger-fg ring-danger-border";
    case "cyan":
      return "bg-info-bg text-info-fg ring-info-border";
    default:
      return "bg-surface-2 text-content-2 ring-line";
  }
}

function labelFromRow(row: Record<string, any>, fallback = ""): string {
  return cleanText(
    row.label ||
      row.name ||
      row.addon_name ||
      row.material_name ||
      row.pod_sku_name ||
      row.packaging_name ||
      row.code ||
      row.addon_code ||
      row.material_code ||
      row.pod_sku_code ||
      row.packaging_code ||
      row.value ||
      row.id ||
      fallback,
  );
}

function axisScalarLabels(value: unknown): string[] {
  if (value === null || value === undefined || value === "") return [];
  if (Array.isArray(value)) return value.flatMap(axisScalarLabels);
  if (typeof value === "object") {
    const row = asRecord(value);
    const entries = Object.entries(row);
    if (
      entries.length > 0 &&
      entries.every(
        ([, child]) =>
          child === null || typeof child !== "object" || Array.isArray(child),
      )
    ) {
      const direct = labelFromRow(row);
      if (direct && direct !== "[object Object]") return [direct];
    }
    return entries.flatMap(([layerKey, child]) =>
      axisScalarLabels(child).map((label) => `L${layerKey}: ${label}`),
    );
  }
  return [cleanText(value)].filter(Boolean);
}

function hasKeys(value: Record<string, any>): boolean {
  return Object.keys(value).length > 0;
}

function pushUnique(
  chips: AxisChip[],
  seen: Set<string>,
  label: string,
  tone: AxisChipTone,
  keyPrefix: string,
  title?: string,
) {
  const clean = cleanText(label);
  if (!clean) return;
  const dedupeKey = `${keyPrefix}:${clean.toLowerCase()}`;
  const labelKey = `label:${clean.toLowerCase()}`;
  if (seen.has(dedupeKey)) return;
  if (seen.has(labelKey)) return;
  seen.add(dedupeKey);
  seen.add(labelKey);
  chips.push({
    key: `${keyPrefix}-${chips.length}-${clean}`,
    label: clean,
    tone,
    title: title || clean,
  });
}

function geometryFromLine(line: any, summary?: SalesOrder["item_summary"]) {
  const geometry = asRecord(line?.geometry_snapshot);
  const base = asRecord(geometry.base);
  const size = asRecord(summary?.size || summary?.spec_facets?.size);
  const width =
    base.width_mm ??
    geometry.width_mm ??
    geometry.roll_width_mm ??
    geometry.child_target_width_mm ??
    size.width_mm;
  const height = base.height_mm ?? geometry.height_mm ?? size.height_mm;
  const gusset = base.gusset_mm ?? geometry.gusset_mm ?? size.gusset_mm;
  const rollWidth =
    geometry.final_web_width_mm ??
    geometry.planned_parent_width_mm ??
    geometry.roll_width_mm ??
    geometry.child_target_width_mm ??
    base.roll_width_mm ??
    width;
  return {
    raw: geometry,
    base,
    finishedGoodType: cleanText(
      summary?.finished_good_type ||
        size.finished_good_type ||
        geometry.finished_good_type ||
        line?.finished_good_type,
    ).toUpperCase(),
    rollForm: cleanText(
      size.roll_form ||
        geometry.roll_form ||
        line?.roll_form ||
        summary?.size_or_form,
    ).toUpperCase(),
    pouchStyle: cleanText(
      geometry.pouch_style ||
        base.pouch_style ||
        geometry.pouch_style_code ||
        line?.pouch_style,
    ),
    width,
    height,
    gusset,
    rollWidth,
    label: cleanText(size.label || summary?.size_or_form),
  };
}

function printingLabelFromSnapshot(
  printing: Record<string, any>,
  fallback = "",
): string {
  if (!hasKeys(printing)) return fallback;
  if (!printing.enabled) return "";
  const printType = cleanText(
    printing.type || printing.printing_type || "PRINT",
  ).toUpperCase();
  const front = Number(
    printing.front_colors_count ??
      printing.front_colours_count ??
      printing.front_colors ??
      0,
  );
  const back = Number(
    printing.back_colors_count ??
      printing.back_colours_count ??
      printing.back_colors ??
      0,
  );
  const colorBits = [front > 0 ? `F${front}` : "", back > 0 ? `B${back}` : ""]
    .filter(Boolean)
    .join("/");
  return [printType, colorBits].filter(Boolean).join(" ");
}

function materialLabelFromSnapshot(
  row: Record<string, any>,
  fallback = "",
): string {
  return labelFromRow(
    {
      label: row.label || row.display_label,
      code:
        row.material_code ||
        row.packaging_code ||
        row.pod_sku_code ||
        row.sku_code ||
        row.code,
      name:
        row.material_name ||
        row.packaging_name ||
        row.pod_sku_name ||
        row.sku_name ||
        row.name,
      value: row.value,
    },
    fallback,
  );
}

function selectedAddonLabels(
  line: any,
  axisValues: Record<string, any>,
  summary?: SalesOrder["item_summary"],
): string[] {
  const snapshotLabels = asArray(line?.addons_snapshot)
    .map((row) => materialLabelFromSnapshot(asRecord(row)))
    .filter(Boolean);
  if (snapshotLabels.length) return snapshotLabels;

  const axisLabels = axisScalarLabels(axisValues.addons || axisValues.addon);
  if (axisLabels.length) return axisLabels;

  const hasLinePayload = hasKeys(asRecord(line));
  return hasLinePayload ? [] : asArray(summary?.addon_labels);
}

function selectedPodLabels(
  line: any,
  axisValues: Record<string, any>,
  summary?: SalesOrder["item_summary"],
): string[] {
  const packaging = asRecord(line?.packaging_snapshot);
  const pod = asRecord(packaging.pod);
  const podLabel = pod.enabled ? materialLabelFromSnapshot(pod, "POD") : "";
  if (podLabel) return [podLabel];

  const axisLabels = [
    ...axisScalarLabels(axisValues.pod),
    ...axisScalarLabels(axisValues.pod_variant),
  ];
  if (axisLabels.length) return axisLabels;

  const hasLinePayload = hasKeys(asRecord(line));
  return hasLinePayload ? [] : asArray(summary?.pod_labels);
}

function selectedPackagingLabels(
  line: any,
  axisValues: Record<string, any>,
  summary?: SalesOrder["item_summary"],
): string[] {
  const packaging = asRecord(line?.packaging_snapshot);
  const labels: string[] = [];

  const primary = asRecord(packaging.primary_inner_pack);
  const primaryLabel = materialLabelFromSnapshot(primary);
  if ((primary.enabled || primaryLabel) && primaryLabel) {
    const pcs = compactNumber(
      primary.pcs_per_pack || primary.default_pcs_per_inner_pack || primary.pcs,
    );
    labels.push(`Inner pack ${primaryLabel}${pcs ? ` · ${pcs} pcs` : ""}`);
  }

  const outer = asRecord(packaging.final_outer_pack || packaging.outer_pack);
  const outerLabel = materialLabelFromSnapshot(outer);
  if ((outer.enabled || outerLabel) && outerLabel) {
    labels.push(`Outer pack ${outerLabel}`);
  }

  const rollDispatch = asRecord(packaging.roll_dispatch_pack);
  if (rollDispatch.enabled) {
    const rollLines = asArray(rollDispatch.lines)
      .map((row) => materialLabelFromSnapshot(asRecord(row)))
      .filter(Boolean);
    rollLines.slice(0, 2).forEach((label) => labels.push(`Roll pack ${label}`));
  }

  if (labels.length) return labels;

  const axisLabels: string[] = [];
  ["packaging_inner", "packaging_outer", "packaging"].forEach((key) => {
    axisScalarLabels(axisValues[key]).forEach((label) => {
      const prefix =
        key === "packaging_inner"
          ? "Inner pack"
          : key === "packaging_outer"
            ? "Outer pack"
            : humanAxisName(key);
      axisLabels.push(`${prefix} ${label}`);
    });
  });
  if (axisLabels.length) return axisLabels;

  const hasLinePayload = hasKeys(asRecord(line));
  const packagingSummary = cleanText(summary?.packaging_summary);
  if (
    !hasLinePayload &&
    packagingSummary &&
    packagingSummary.toLowerCase() !== "standard pack"
  ) {
    return [packagingSummary];
  }
  return [];
}

function buildLineAxisChips(
  line: any,
  summary?: SalesOrder["item_summary"],
): AxisChip[] {
  const chips: AxisChip[] = [];
  const seen = new Set<string>();
  const geometry = geometryFromLine(line, summary);
  const fgType =
    geometry.finishedGoodType ||
    cleanText(summary?.finished_good_type).toUpperCase();
  const lineAxisValues = asRecord(line?.axis_values);
  const axisValues = hasKeys(lineAxisValues)
    ? lineAxisValues
    : asRecord(summary?.spec_facets?.axis_values);
  const lineName = cleanText(line?.line_name || summary?.variant_name);

  if (
    line?.product_master_code ||
    line?.product_master_name ||
    summary?.spec_facets?.product_master_code
  ) {
    pushUnique(
      chips,
      seen,
      cleanText(
        line?.product_master_code ||
          line?.product_master_name ||
          summary?.spec_facets?.product_master_code,
      ),
      "violet",
      "master",
    );
  } else if (summary?.template_tag) {
    pushUnique(chips, seen, summary.template_tag, "violet", "template");
  }

  if (fgType === "ROLL") {
    const form =
      geometry.rollForm ||
      cleanText(axisValues.roll_form).toUpperCase() ||
      "ROLL";
    pushUnique(chips, seen, `Roll · ${form}`, "slate", "fg");
    const width = compactNumber(geometry.rollWidth);
    if (width)
      pushUnique(chips, seen, `Web ${width} mm`, "emerald", "roll-width");
  } else if (fgType) {
    pushUnique(
      chips,
      seen,
      fgType === "POUCH" ? "Pouch" : fgType,
      "slate",
      "fg",
    );
  }

  const sizeLabel =
    geometry.label &&
    !["ROLL", "FLAT", "FOLDED", "TUBING", "SHEET", "TUBE"].includes(
      geometry.label.toUpperCase(),
    )
      ? geometry.label
      : [compactNumber(geometry.width), compactNumber(geometry.height)]
          .filter(Boolean)
          .join(" x ");
  if (sizeLabel && fgType !== "ROLL") {
    pushUnique(
      chips,
      seen,
      sizeLabel.toLowerCase().includes("mm") ? sizeLabel : `${sizeLabel} mm`,
      "emerald",
      "size",
    );
  }
  if (geometry.pouchStyle)
    pushUnique(chips, seen, `Style ${geometry.pouchStyle}`, "cyan", "style");
  if (compactNumber(geometry.gusset))
    pushUnique(
      chips,
      seen,
      `Gusset ${compactNumber(geometry.gusset)} mm`,
      "cyan",
      "gusset",
    );

  const lineLayerRows = asArray(line?.layer_snapshot);
  const layerRows = lineLayerRows.length
    ? lineLayerRows
    : asArray(
        summary?.layers?.length
          ? summary.layers
          : summary?.spec_facets?.layers?.length
            ? summary.spec_facets.layers
            : [],
      );
  layerRows.forEach((layer, idx) => {
    const row = asRecord(layer);
    const label = cleanText(row.label);
    if (label) {
      pushUnique(chips, seen, label, "blue", `layer-${idx + 1}`);
      return;
    }
    const parts = [
      `L${idx + 1}`,
      cleanText(
        row.variant_code ||
          row.material_code ||
          row.family_code ||
          row.code ||
          row.variant_name ||
          row.material_name ||
          row.family_name ||
          row.name,
      ),
      compactNumber(row.thickness_micron || row.thickness)
        ? `${compactNumber(row.thickness_micron || row.thickness)}u`
        : "",
      cleanText(row.grade || row.grade_name || row.grade_code),
      compactNumber(row.roll_width_mm || row.width_mm || row.width)
        ? `${compactNumber(row.roll_width_mm || row.width_mm || row.width)}mm`
        : "",
    ]
      .filter(Boolean)
      .join(" · ");
    pushUnique(chips, seen, parts, "blue", `layer-${idx + 1}`);
  });

  const printingSummary = printingLabelFromSnapshot(
    asRecord(line?.printing_snapshot),
    cleanText(summary?.printing_summary),
  );
  if (printingSummary && printingSummary.toLowerCase() !== "no print") {
    pushUnique(chips, seen, printingSummary, "rose", "print");
  }

  const podLabels = selectedPodLabels(line, axisValues, summary);
  podLabels.forEach((label) =>
    pushUnique(
      chips,
      seen,
      label.startsWith("POD") ? label : `POD ${label}`,
      "fuchsia",
      "pod",
    ),
  );

  const addonLabels = selectedAddonLabels(line, axisValues, summary);
  addonLabels.forEach((label) =>
    pushUnique(chips, seen, label, "amber", "addon"),
  );

  selectedPackagingLabels(line, axisValues, summary).forEach((label) =>
    pushUnique(chips, seen, label, "cyan", "packaging"),
  );

  const hiddenAxis = new Set([
    "size",
    "roll_form",
    "pouch_style",
    "layer_thicknesses",
    "layer_grades",
    "layer_widths",
    "layer_materials",
    "layer_material_overrides",
    "film_variant_by_layer",
    "layer_film_variants",
    "material_by_layer",
    "addons",
    "addon",
    "pod",
    "pod_variant",
    "packaging",
    "packaging_inner",
    "packaging_outer",
  ]);
  Object.entries(axisValues).forEach(([key, value]) => {
    if (hiddenAxis.has(key)) return;
    axisScalarLabels(value).forEach((label) =>
      pushUnique(
        chips,
        seen,
        `${humanAxisName(key)} ${label}`,
        "slate",
        `axis-${key}`,
      ),
    );
  });

  if (!chips.length && lineName)
    pushUnique(chips, seen, lineName, "slate", "line");
  return chips;
}

function buildOrderAxisChips(order: SalesOrder): AxisChip[] {
  const firstLine =
    Array.isArray(order.items) && order.items.length ? order.items[0] : {};
  const chips = buildLineAxisChips(firstLine, order.item_summary);
  const lineCount = Number(
    order.item_summary?.line_count || order.items?.length || 0,
  );
  if (lineCount > 1) {
    chips.unshift({
      key: "line-count",
      label: `${lineCount} lines`,
      tone: "slate",
      title: `${lineCount} order lines`,
    });
  }
  return chips;
}

function AxisChipStrip({
  chips,
  compact = false,
  className,
}: {
  chips: AxisChip[];
  compact?: boolean;
  className?: string;
}) {
  if (!chips.length) return null;
  return (
    <div
      data-testid="axis-chip-strip"
      className={cn("flex flex-wrap items-center gap-1", className)}
    >
      {chips.map((chip) => (
        <span
          key={chip.key}
          title={chip.title || chip.label}
          data-axis-chip={chip.label}
          className={cn(
            "inline-flex max-w-full items-center rounded-md ring-1",
            compact ? "px-1.5 py-0.5 text-[9px]" : "px-1.5 py-0.5 text-[10px]",
            "font-mono font-bold leading-4",
            chipToneClasses(chip.tone),
          )}
        >
          <span className="truncate">{chip.label}</span>
        </span>
      ))}
    </div>
  );
}

function ArtworkPreviewButton({
  preview,
  compact = false,
  showLabel = true,
  className,
}: {
  preview: ArtworkPreview | null;
  compact?: boolean;
  showLabel?: boolean;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  if (!preview) return null;
  const label = preview.code || preview.name || "Artwork";
  const sizeClass = compact ? "h-10 w-14 rounded-lg" : "h-14 w-20 rounded-xl";
  const content = preview.thumbnailUrl ? (
    <img
      src={preview.thumbnailUrl}
      alt={label}
      className="h-full w-full object-cover"
      loading="lazy"
    />
  ) : (
    <div
      className="grid h-full w-full place-items-center"
      style={{
        background:
          preview.accentHex ||
          "linear-gradient(135deg, var(--accent-order-bg), var(--info-bg))",
      }}
    >
      <ImageIcon className="h-4 w-4 text-order-fg" />
    </div>
  );

  return (
    <>
      <button
        type="button"
        title={`Preview artwork ${label}`}
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
        className={cn(
          "group/art relative flex flex-none items-center gap-2 rounded-xl border border-line bg-surface-1 p-1 text-left shadow-sm transition hover:border-order-border hover:bg-surface-2",
          compact ? "max-w-[8.75rem]" : "max-w-[13rem]",
          className,
        )}
      >
        <span className={cn("overflow-hidden border border-line bg-surface-2", sizeClass)}>
          {content}
        </span>
        {showLabel ? (
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[10px] font-black uppercase tracking-[0.12em] text-content-4">
              Artwork
            </span>
            <span className="block truncate font-mono text-[10px] font-black text-order-fg">
              {label}
            </span>
            {preview.colorCount ? (
              <span className="block truncate text-[9px] font-bold text-content-3">
                {preview.colorCount} colors
              </span>
            ) : null}
          </span>
        ) : null}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl border-line bg-surface-1 p-0 text-content-1">
          <DialogHeader className="border-b border-line px-5 py-4">
            <DialogTitle className="font-display text-xl font-black">
              {label}
            </DialogTitle>
            <DialogDescription>
              Artwork preview from the sales order line. No navigation from this view.
            </DialogDescription>
          </DialogHeader>
          <div className="bg-surface-2 p-4">
            {preview.thumbnailUrl ? (
              <div className="overflow-hidden rounded-xl border border-line bg-surface-1">
                <img
                  src={preview.thumbnailUrl}
                  alt={label}
                  className="max-h-[72vh] w-full object-contain"
                />
              </div>
            ) : (
              <div className="grid min-h-[280px] place-items-center rounded-xl border border-line bg-surface-1 text-center">
                <div>
                  <ImageIcon className="mx-auto h-10 w-10 text-content-4" />
                  <div className="mt-3 text-sm font-black text-content-1">
                    No image file available
                  </div>
                  <div className="mt-1 text-xs font-semibold text-content-3">
                    {preview.name || preview.code || "Artwork is assigned but no thumbnail was uploaded."}
                  </div>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Root component ────────────────────────────────────────────────────

const SAVED_VIEWS_KEY = "sales-orders-v37:saved-views";

export function SalesOrdersListWorkspace() {
  const queryClient = useQueryClient();
  const [tab, setTab] = React.useState<Tab>("queue");
  const [density, setDensity] = React.useState<Density>("comfortable");
  const [filters, setFilters] =
    React.useState<SavedView["filters"]>(DEFAULT_FILTERS);
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [expanded, setExpanded] = React.useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = React.useState<SalesOrder | null>(
    null,
  );
  const [savedViews, setSavedViews] = React.useState<SavedView[]>([]);
  const [activeViewId, setActiveViewId] = React.useState<string>("all");

  // Load saved views once
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(SAVED_VIEWS_KEY);
      if (raw) setSavedViews(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, []);
  const persistViews = (next: SavedView[]) => {
    setSavedViews(next);
    try {
      localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };

  // ─── Data ────────────────────────────────────────────────────────
  const serverStatus = (() => {
    if (filters.status !== "ALL") return filters.status;
    if (tab === "history") return "COMPLETED";
    if (tab === "cancelled") return "CANCELLED";
    return undefined;
  })();
  const ordersQuery = useQuery({
    queryKey: ["sales-orders-v37", filters.searchText, serverStatus || "ALL"],
    queryFn: () =>
      salesService.getOrders({
        q: filters.searchText.trim() || undefined,
        status: serverStatus,
        limit: 50,
      }),
    staleTime: 90_000,
  });
  const orders = React.useMemo(
    () => unwrapOrders(ordersQuery.data),
    [ordersQuery.data],
  );
  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: masterDataService.getCustomers,
    staleTime: 60_000,
  });
  const { data: masters = [] } = useQuery({
    queryKey: ["product-masters-list"],
    queryFn: () => productMasterService.list({ active: true }),
    staleTime: 60_000,
  });

  // ─── Filtered + enriched rows ────────────────────────────────────
  const enriched = React.useMemo(
    () =>
      orders.map((o) => {
        const age = ageDays(o.created_at);
        const qtyPair = orderQtyPair(o);
        return {
          order: o,
          age,
          bucket: ageBucket(age),
          statusKey: String(o.status || "").toUpperCase() as StatusKey,
          qtyPair,
          totalKg: qtyPair.kg,
          totalPcs: qtyPair.pcs,
          value: orderTotalValue(o),
          produced: orderProducedKg(o),
          packed: orderPackedKg(o),
          dispatched: orderDispatchedKg(o),
          producedPcs: safeNumber(o.fulfillment_summary?.produced_pcs),
          dispatchedPcs: safeNumber(o.fulfillment_summary?.dispatched_pcs),
        };
      }),
    [orders],
  );

  const queueRows = React.useMemo(
    () =>
      enriched.filter(({ order }) => {
        const isHistoryRow = !isOpen(order);
        if (tab === "queue" && isHistoryRow) return false;
        if (tab === "history" && order.status !== "COMPLETED") return false;
        if (tab === "cancelled" && order.status !== "CANCELLED") return false;
        return true;
      }),
    [enriched, tab],
  );

  const filtered = React.useMemo(
    () =>
      queueRows.filter(({ order, age, statusKey }) => {
        if (filters.status !== "ALL" && statusKey !== filters.status)
          return false;
        if (filters.age !== "ALL" && ageBucket(age) !== filters.age)
          return false;
        if (
          filters.customer &&
          order.customer !== filters.customer &&
          order.customer_id !== filters.customer
        )
          return false;
        if (filters.master) {
          const masterCode =
            order.item_summary?.template_tag ||
            order.item_summary?.variant_code ||
            "";
          const m = masters.find((x) => x.id === filters.master);
          if (
            m &&
            !String(masterCode).toUpperCase().includes(m.code.toUpperCase())
          )
            return false;
        }
        if (filters.fgType) {
          const fg = String(
            order.item_summary?.finished_good_type || "",
          ).toUpperCase();
          if (fg !== filters.fgType) return false;
        }
        // Range-style width/height/thickness — match numeric token in search if specified
        if (filters.widthMm.trim()) {
          const w = Number(filters.widthMm) || 0;
          const itemW = Number((order.item_summary as any)?.size?.widthMm || 0);
          if (!w || !itemW || Math.abs(itemW - w) > 25) return false;
        }
        if (filters.heightMm.trim()) {
          const h = Number(filters.heightMm) || 0;
          const itemH = Number(
            (order.item_summary as any)?.size?.heightMm || 0,
          );
          if (!h || !itemH || Math.abs(itemH - h) > 25) return false;
        }
        if (filters.pouchStyle) {
          // Filter by pouch style id OR code across any item in the order
          const itemSummary = order.item_summary as any;
          const styleHits: string[] = [];
          const ps =
            itemSummary?.pouch_style ||
            itemSummary?.pouch_style_master ||
            itemSummary?.pouch_style_code;
          if (ps) styleHits.push(String(ps));
          const items: any[] = (order as any).items || [];
          for (const it of items) {
            const v =
              it?.pouch_style_master || it?.pouch_style_code || it?.pouch_style;
            if (v) styleHits.push(String(v));
          }
          if (
            !styleHits.some(
              (s) =>
                s === filters.pouchStyle ||
                s.toUpperCase() === filters.pouchStyle.toUpperCase(),
            )
          )
            return false;
        }
        return true;
      }),
    [queueRows, filters, masters],
  );

  // KPI math
  const kpis = React.useMemo(() => {
    const open = enriched.filter((r) => isOpen(r.order));
    const awaiting = open.filter((r) => r.statusKey === "PLANNING_REQUIRED");
    const aged = open.filter((r) => r.age >= 6);
    const createdToday = enriched.filter((r) => r.age === 0);
    const valueInFlight = open.reduce((s, r) => s + r.value, 0);
    const avgAge = open.length
      ? open.reduce((s, r) => s + r.age, 0) / open.length
      : 0;
    return {
      open: open.length,
      awaiting: awaiting.length,
      aged: aged.length,
      agedKg: aged.reduce((s, r) => s + r.totalKg, 0),
      createdToday: createdToday.length,
      valueInFlight,
      avgAge: Number(avgAge.toFixed(1)),
      customersOpen: new Set(
        open.map((r) => r.order.customer || r.order.customer_id),
      ).size,
      historyCount: enriched.filter((r) => r.order.status === "COMPLETED")
        .length,
      cancelledCount: enriched.filter((r) => r.order.status === "CANCELLED")
        .length,
    };
  }, [enriched]);

  // Status counts (open only)
  const statusCounts = React.useMemo(() => {
    const c: Partial<Record<StatusKey, number>> = {};
    for (const r of queueRows) c[r.statusKey] = (c[r.statusKey] || 0) + 1;
    return c;
  }, [queueRows]);
  const ageCounts = React.useMemo(() => {
    const c = { fresh: 0, watch: 0, aged: 0 };
    for (const r of queueRows) c[r.bucket] += 1;
    return c;
  }, [queueRows]);

  // ─── Selection helpers ────────────────────────────────────────────
  const allSelected =
    filtered.length > 0 && filtered.every((r) => selected.has(r.order.id));
  function toggleRow(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(filtered.map((r) => r.order.id)));
  }
  function clearSelection() {
    setSelected(new Set());
  }

  // ─── Mutations ───────────────────────────────────────────────────
  const cancelMutation = useMutation({
    mutationFn: ({
      id,
      reason,
      itemIds,
    }: {
      id: string;
      reason: string;
      itemIds?: string[];
    }) => salesService.cancelOrder(id, reason, itemIds),
    onSuccess: () => {
      toast.success("Sales order updated");
      queryClient.invalidateQueries({ queryKey: ["sales-orders-v37"] });
      setCancelTarget(null);
    },
    onError: (err: any) => {
      toast.error("Could not cancel order", {
        description:
          err?.response?.data?.detail || err?.message || "Try again.",
      });
    },
  });

  // ─── Saved views ─────────────────────────────────────────────────
  function applyView(view: SavedView | null) {
    if (!view) {
      setFilters(DEFAULT_FILTERS);
      setActiveViewId("all");
      return;
    }
    setFilters(view.filters);
    setActiveViewId(view.id);
  }
  function saveCurrentView() {
    const label = window.prompt("Name this saved view");
    if (!label) return;
    const view: SavedView = { id: `v-${Date.now()}`, label, filters };
    persistViews([...savedViews, view]);
    setActiveViewId(view.id);
  }
  function removeView(id: string) {
    persistViews(savedViews.filter((v) => v.id !== id));
    if (activeViewId === id) setActiveViewId("all");
  }

  function patchFilter<K extends keyof SavedView["filters"]>(
    key: K,
    value: SavedView["filters"][K],
  ) {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setActiveViewId("all");
  }
  function resetFilters() {
    setFilters(DEFAULT_FILTERS);
    setActiveViewId("all");
  }

  // ─── CSV export of currently filtered ────────────────────────────
  function exportCsv(ids?: Set<string>) {
    const rows = filtered.filter((r) => !ids || ids.has(r.order.id));
    const headers = [
      "SO Number",
      "Customer",
      "Customer Code",
      "Product Master",
      "Variant",
      "Primary UOM",
      "Qty (KG)",
      "Qty (PCS)",
      "Value (₹)",
      "Status",
      "Placed",
      "Age (days)",
    ];
    const lines = [headers.join(",")];
    for (const r of rows) {
      const o = r.order;
      const cells = [
        o.order_number,
        `"${(o.customer_name || "").replace(/"/g, '""')}"`,
        (o as any).customer_code || "",
        o.item_summary?.template_tag || o.item_summary?.variant_code || "",
        `"${(o.item_summary?.variant_name || o.line_name || "").replace(/"/g, '""')}"`,
        r.qtyPair.primaryUom,
        String(r.totalKg),
        r.totalPcs == null ? "" : String(Math.round(r.totalPcs)),
        String(r.value),
        o.status,
        o.created_at || "",
        String(r.age),
      ];
      lines.push(cells.join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sales-orders-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4 pb-32">
      <Hero kpis={kpis} />

      {/* KPI strip */}
      <section className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        <KpiTile
          label="Open"
          value={String(kpis.open)}
          sub="orders in flight"
        />
        <KpiTile
          label="Awaiting planning"
          value={String(kpis.awaiting)}
          sub="needs action"
          tone="amber"
          onClick={() => {
            patchFilter("status", "PLANNING_REQUIRED");
          }}
        />
        <KpiTile
          label="Aged 6+ days"
          value={String(kpis.aged)}
          sub={`${fmtKg(kpis.agedKg)} KG · not good`}
          tone="rose"
          onClick={() => {
            patchFilter("age", "aged");
          }}
        />
        <KpiTile
          label="Created today"
          value={String(kpis.createdToday)}
          sub="new in last 24h"
          tone="emerald"
        />
        <KpiTile
          label="Value in flight"
          value={fmtMoney(kpis.valueInFlight)}
          sub={`${kpis.open} orders`}
          tone="indigo"
        />
        <KpiTile
          label="Avg age"
          value={`${kpis.avgAge}d`}
          sub={`${kpis.customersOpen} customers`}
        />
      </section>

      {/* Saved views */}
      <SavedViewsBar
        views={savedViews}
        activeId={activeViewId}
        quickViews={[
          {
            id: "all",
            label: `All open · ${kpis.open}`,
            action: () => applyView(null),
          },
          {
            id: "aged",
            label: `Aged 6+ · ${kpis.aged}`,
            action: () => {
              setFilters({ ...DEFAULT_FILTERS, age: "aged" });
              setActiveViewId("aged");
            },
          },
          {
            id: "planning",
            label: `Awaiting planning · ${kpis.awaiting}`,
            action: () => {
              setFilters({ ...DEFAULT_FILTERS, status: "PLANNING_REQUIRED" });
              setActiveViewId("planning");
            },
          },
          {
            id: "today",
            label: `Created today · ${kpis.createdToday}`,
            action: () => {
              setFilters({ ...DEFAULT_FILTERS, age: "fresh" });
              setActiveViewId("today");
            },
          },
        ]}
        onApply={applyView}
        onSave={saveCurrentView}
        onRemove={removeView}
        onExport={() => exportCsv()}
        visibleCount={filtered.length}
      />

      {/* Filter band */}
      <FilterBand
        filters={filters}
        ageCounts={ageCounts}
        statusCounts={statusCounts as Record<StatusKey, number>}
        customers={customers}
        masters={masters}
        advancedOpen={advancedOpen}
        onAdvancedToggle={() => setAdvancedOpen((v) => !v)}
        onPatch={patchFilter}
        onReset={resetFilters}
        visibleCount={filtered.length}
        totalCount={queueRows.length}
      />

      {/* Bulk action bar */}
      {selected.size > 0 ? (
        <BulkBar
          count={selected.size}
          onClear={clearSelection}
          onExport={() => exportCsv(selected)}
          onCancelMany={() => {
            const first = filtered.find((r) => selected.has(r.order.id));
            if (first) setCancelTarget(first.order);
          }}
        />
      ) : null}

      {/* Table */}
      <section className="rounded-2xl border border-line bg-surface-1 shadow-sm overflow-hidden">
        <TableHeader
          tab={tab}
          onTab={setTab}
          counts={{
            queue: queueRows.length,
            history: kpis.historyCount,
            cancelled: kpis.cancelledCount,
          }}
          density={density}
          onDensity={setDensity}
        />
        {ordersQuery.isLoading ? (
          <div className="flex h-72 items-center justify-center">
            <div className="text-center">
              <Loader2 className="mx-auto h-7 w-7 animate-spin text-content-3" />
              <div className="mt-3 text-sm font-bold text-content-3">
                Loading sales queue…
              </div>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState onReset={resetFilters} />
        ) : (
          <>
            {/* Desktop column headers — hidden on mobile */}
            <div className="hidden md:grid grid-cols-[2.5rem_minmax(0,1.2fr)_minmax(0,2.05fr)_8.5rem_minmax(0,1.05fr)_9.5rem] gap-3 border-b border-line bg-surface-2 px-4 py-2 text-[9px] font-black uppercase tracking-[0.14em] text-content-3">
              <div>
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="h-3.5 w-3.5 rounded border-line-strong"
                />
              </div>
              <div>Customer · Order #</div>
              <div>Product master · variant tuple</div>
              <div>Placed · age</div>
              <div>Qty · progress</div>
              <div className="text-right">Status · actions</div>
            </div>
            {filtered.map((row) => (
              <OrderRow
                key={row.order.id}
                row={row}
                density={density}
                selected={selected.has(row.order.id)}
                expanded={expanded === row.order.id}
                onToggleSelect={() => toggleRow(row.order.id)}
                onToggleExpand={() =>
                  setExpanded(expanded === row.order.id ? null : row.order.id)
                }
                onCancel={() => setCancelTarget(row.order)}
              />
            ))}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-surface-2 px-4 py-2.5 border-t border-line">
              <div className="text-[10px] font-bold text-content-3">
                Showing {filtered.length} of {queueRows.length} orders
                {selected.size > 0 ? ` · ${selected.size} selected` : ""}
              </div>
            </div>
          </>
        )}
      </section>

      {/* Cancel modal */}
      <CancelOrderDialog
        order={cancelTarget}
        onClose={() => setCancelTarget(null)}
        onConfirm={(reason, itemIds) => {
          if (!cancelTarget) return;
          cancelMutation.mutate({ id: cancelTarget.id, reason, itemIds });
        }}
        pending={cancelMutation.isPending}
      />
    </div>
  );
}

// ─── Hero ──────────────────────────────────────────────────────────────

function Hero({
  kpis,
}: {
  kpis: { open: number; awaiting: number; aged: number; customersOpen: number };
}) {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-line bg-gradient-to-br from-order-bg via-white to-success-bg px-5 py-4 shadow-sm sm:px-6 sm:py-5">
      <div className="absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b from-order-fg via-order-fg to-order-fg" />
      <div className="relative pl-3 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="text-[10px] font-black uppercase tracking-[0.22em] text-order-fg">
            Sales · order operations
          </div>
          <h1 className="font-display text-2xl font-black tracking-tight text-content-1 mt-1 sm:text-3xl">
            Sales Orders
          </h1>
          <p className="mt-1.5 max-w-2xl text-xs text-content-3">
            Every open order, by age and stage. Anything older than 5 days
            bubbles up in red — that&apos;s the line worth chasing.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] font-bold">
            <span className="inline-flex items-center gap-1 rounded-full bg-success-bg px-2.5 py-0.5 text-success-fg ring-1 ring-success-border">
              ⚡ {kpis.open} open
            </span>
            {kpis.awaiting ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-warning-bg px-2.5 py-0.5 text-warning-fg ring-1 ring-warning-border">
                {kpis.awaiting} awaiting planning
              </span>
            ) : null}
            {kpis.aged ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-danger-bg px-2.5 py-0.5 text-danger-fg ring-1 ring-danger-border">
                ▾ {kpis.aged} aged 6+d
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2.5 py-0.5 text-content-2 ring-1 ring-line">
              {kpis.customersOpen} customers
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/master/products"
            className="inline-flex h-9 items-center rounded-lg border border-line bg-surface-1 px-3 text-[11px] font-bold text-content-2 hover:bg-surface-2"
          >
            Product master
          </Link>
          <Link
            href="/sales/orders/create"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-gradient-to-r from-order-fg to-order-fg px-3 text-[11px] font-bold text-white shadow-md"
          >
            <Plus className="h-3.5 w-3.5" /> New order
          </Link>
        </div>
      </div>
    </section>
  );
}

// ─── KPI tile ──────────────────────────────────────────────────────────

function KpiTile({
  label,
  value,
  sub,
  tone,
  onClick,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "amber" | "rose" | "emerald" | "indigo";
  onClick?: () => void;
}) {
  const toneCls =
    tone === "amber"
      ? "border-warning-border bg-warning-bg text-warning-fg"
      : tone === "rose"
        ? "border-danger-border bg-danger-bg text-danger-fg"
        : tone === "emerald"
          ? "text-success-fg"
          : tone === "indigo"
            ? "text-order-fg"
            : "text-content-1";
  const isCard = tone === "amber" || tone === "rose";
  const valueCls = isCard ? "" : toneCls;
  const wrap = isCard ? toneCls : "border-line bg-surface-1";
  const cls = cn(
    "rounded-2xl border px-3.5 py-2.5 shadow-sm text-left",
    wrap,
    onClick ? "hover:shadow-md cursor-pointer" : "",
  );
  const body = (
    <>
      <div className="text-[10px] font-black uppercase tracking-wider text-content-3">
        {label}
      </div>
      <div
        className={cn("font-display text-xl font-black tabular-nums", valueCls)}
      >
        {value}
      </div>
      {sub ? (
        <div className="text-[10px] text-content-3 truncate">{sub}</div>
      ) : null}
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className={cls}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

// ─── Saved views bar ───────────────────────────────────────────────────

function SavedViewsBar({
  views,
  activeId,
  quickViews,
  onApply,
  onSave,
  onRemove,
  onExport,
  visibleCount,
}: {
  views: SavedView[];
  activeId: string;
  quickViews: Array<{ id: string; label: string; action: () => void }>;
  onApply: (v: SavedView | null) => void;
  onSave: () => void;
  onRemove: (id: string) => void;
  onExport: () => void;
  visibleCount: number;
}) {
  return (
    <section className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold">
      <span className="text-[10px] font-black uppercase tracking-[0.18em] text-content-3 mr-1">
        Views
      </span>
      {quickViews.map((qv) => (
        <button
          key={qv.id}
          onClick={qv.action}
          className={cn(
            "rounded-full px-3 py-1 ring-1",
            activeId === qv.id
              ? "bg-surface-3 text-white ring-line-strong shadow-sm"
              : "bg-surface-1 text-content-2 ring-line hover:bg-surface-2",
          )}
        >
          {qv.label}
        </button>
      ))}
      {views.map((v) => (
        <span
          key={v.id}
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-3 py-1 ring-1",
            activeId === v.id
              ? "bg-order-fg text-white ring-order-border"
              : "bg-surface-1 text-content-2 ring-line hover:bg-surface-2",
          )}
        >
          <button
            onClick={() => onApply(v)}
            className="flex items-center gap-1"
          >
            <Star className="h-3 w-3" /> {v.label}
          </button>
          <button
            onClick={() => onRemove(v.id)}
            className="ml-1 rounded-full p-0.5 opacity-70 hover:opacity-100"
            title="Remove view"
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <button
        onClick={onSave}
        className="rounded-full bg-success-bg px-3 py-1 text-success-fg ring-1 ring-success-border hover:bg-success-bg"
      >
        + Save current
      </button>
      <button
        onClick={onExport}
        className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface-1 px-3 text-[11px] font-bold text-content-2 hover:bg-surface-2"
      >
        <Download className="h-3.5 w-3.5" /> Export · {visibleCount}
      </button>
    </section>
  );
}

// ─── Filter band ───────────────────────────────────────────────────────

function FilterBand({
  filters,
  ageCounts,
  statusCounts,
  customers,
  masters,
  advancedOpen,
  onAdvancedToggle,
  onPatch,
  onReset,
  visibleCount,
  totalCount,
}: {
  filters: SavedView["filters"];
  ageCounts: { fresh: number; watch: number; aged: number };
  statusCounts: Record<StatusKey, number>;
  customers: Customer[];
  masters: ProductMaster[];
  advancedOpen: boolean;
  onAdvancedToggle: () => void;
  onPatch: <K extends keyof SavedView["filters"]>(
    k: K,
    v: SavedView["filters"][K],
  ) => void;
  onReset: () => void;
  visibleCount: number;
  totalCount: number;
}) {
  const activeFilterChips: Array<{
    key: string;
    label: string;
    clear: () => void;
  }> = [];
  if (filters.status !== "ALL")
    activeFilterChips.push({
      key: "status",
      label: `status · ${STATUS_LABEL[filters.status as StatusKey]}`,
      clear: () => onPatch("status", "ALL"),
    });
  if (filters.age !== "ALL")
    activeFilterChips.push({
      key: "age",
      label: `age · ${filters.age}`,
      clear: () => onPatch("age", "ALL"),
    });
  if (filters.customer) {
    const c = customers.find((x) => x.id === filters.customer);
    activeFilterChips.push({
      key: "customer",
      label: `customer · ${c?.name || filters.customer}`,
      clear: () => onPatch("customer", ""),
    });
  }
  if (filters.master) {
    const m = masters.find((x) => x.id === filters.master);
    activeFilterChips.push({
      key: "master",
      label: `master · ${m?.code || filters.master}`,
      clear: () => onPatch("master", ""),
    });
  }
  if (filters.fgType)
    activeFilterChips.push({
      key: "fg",
      label: `fg · ${filters.fgType}`,
      clear: () => onPatch("fgType", ""),
    });
  if (filters.pouchStyle)
    activeFilterChips.push({
      key: "pouchStyle",
      label: `pouch · ${filters.pouchStyle}`,
      clear: () => onPatch("pouchStyle", ""),
    });
  if (filters.widthMm)
    activeFilterChips.push({
      key: "w",
      label: `width · ${filters.widthMm} mm`,
      clear: () => onPatch("widthMm", ""),
    });
  if (filters.heightMm)
    activeFilterChips.push({
      key: "h",
      label: `height · ${filters.heightMm} mm`,
      clear: () => onPatch("heightMm", ""),
    });
  if (filters.thicknessUm)
    activeFilterChips.push({
      key: "t",
      label: `thickness · ${filters.thicknessUm} μ`,
      clear: () => onPatch("thicknessUm", ""),
    });

  return (
    <section className="rounded-2xl border border-line bg-surface-1 p-3 shadow-sm space-y-2">
      {/* Row 1 — search + status */}
      <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-4" />
          <Input
            value={filters.searchText}
            onChange={(e) => onPatch("searchText", e.target.value)}
            placeholder="Search SO #, customer, product master, variant…"
            className="h-10 rounded-xl border-line bg-surface-1 pl-9 text-sm font-semibold shadow-sm"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold overflow-x-auto pb-1 -mx-1 px-1 xl:overflow-visible">
          <span className="text-[10px] font-black uppercase tracking-[0.18em] text-content-3 mr-1 flex-none">
            Status
          </span>
          <StatusPillBtn
            label={`All · ${totalCount}`}
            active={filters.status === "ALL"}
            onClick={() => onPatch("status", "ALL")}
          />
          <StatusPillBtn
            label={`Planning · ${statusCounts.PLANNING_REQUIRED || 0}`}
            tone="amber"
            active={filters.status === "PLANNING_REQUIRED"}
            onClick={() => onPatch("status", "PLANNING_REQUIRED")}
          />
          <StatusPillBtn
            label={`Planned · ${statusCounts.PLANNED || 0}`}
            tone="blue"
            active={filters.status === "PLANNED"}
            onClick={() => onPatch("status", "PLANNED")}
          />
          <StatusPillBtn
            label={`Released · ${statusCounts.RELEASED || 0}`}
            tone="rose"
            active={filters.status === "RELEASED"}
            onClick={() => onPatch("status", "RELEASED")}
          />
          <StatusPillBtn
            label={`Packing · ${statusCounts.PACKING_READY || 0}`}
            tone="violet"
            active={filters.status === "PACKING_READY"}
            onClick={() => onPatch("status", "PACKING_READY")}
          />
          <StatusPillBtn
            label={`Dispatch · ${statusCounts.DISPATCH_READY || 0}`}
            tone="emerald"
            active={filters.status === "DISPATCH_READY"}
            onClick={() => onPatch("status", "DISPATCH_READY")}
          />
        </div>
      </div>

      {/* Row 2 — age + customer + master + advanced + reset */}
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold">
        <span className="text-[10px] font-black uppercase tracking-[0.18em] text-content-3 mr-1">
          Age
        </span>
        <AgePillBtn
          label={`Fresh 0-2d · ${ageCounts.fresh}`}
          tone="emerald"
          active={filters.age === "fresh"}
          onClick={() =>
            onPatch("age", filters.age === "fresh" ? "ALL" : "fresh")
          }
        />
        <AgePillBtn
          label={`Watch 3-5d · ${ageCounts.watch}`}
          tone="amber"
          active={filters.age === "watch"}
          onClick={() =>
            onPatch("age", filters.age === "watch" ? "ALL" : "watch")
          }
        />
        <AgePillBtn
          label={`Aged 6+d · ${ageCounts.aged}`}
          tone="rose"
          active={filters.age === "aged"}
          onClick={() =>
            onPatch("age", filters.age === "aged" ? "ALL" : "aged")
          }
        />

        <span className="text-[10px] font-black uppercase tracking-[0.18em] text-content-3 mx-2 hidden md:inline">
          Customer
        </span>
        <div className="min-w-[160px] flex-none md:flex-1 md:max-w-[220px]">
          <Select
            value={filters.customer || "__all"}
            onValueChange={(v) => onPatch("customer", v === "__all" ? "" : v)}
          >
            <SelectTrigger className="h-8 rounded-full bg-surface-1 text-xs">
              <SelectValue placeholder="Any customer" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">Any customer</SelectItem>
              {customers.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <span className="text-[10px] font-black uppercase tracking-[0.18em] text-content-3 mx-2 hidden md:inline">
          Master
        </span>
        <div className="min-w-[160px] flex-none md:flex-1 md:max-w-[220px]">
          <Select
            value={filters.master || "__all"}
            onValueChange={(v) => onPatch("master", v === "__all" ? "" : v)}
          >
            <SelectTrigger className="h-8 rounded-full bg-surface-1 text-xs">
              <SelectValue placeholder="Any master" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">Any master</SelectItem>
              {masters.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.code} · {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <button
          onClick={onAdvancedToggle}
          className="ml-auto rounded-full bg-surface-1 px-2.5 py-1 text-content-2 ring-1 ring-line hover:bg-surface-2 inline-flex items-center gap-1"
        >
          <SlidersHorizontal className="h-3 w-3" />
          Advanced
          <ChevronDown
            className={cn("h-3 w-3 transition", advancedOpen && "rotate-180")}
          />
        </button>
        <button
          onClick={onReset}
          className="rounded-full bg-surface-1 px-2.5 py-1 text-danger-fg ring-1 ring-danger-border hover:bg-danger-bg"
        >
          Reset
        </button>
      </div>

      {/* Advanced popover (inline) */}
      {advancedOpen ? (
        <div className="rounded-xl border border-line bg-surface-2 p-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div>
            <Label className="text-[10px] font-black uppercase tracking-wider text-content-3">
              FG type
            </Label>
            <Select
              value={filters.fgType || "__all"}
              onValueChange={(v) => onPatch("fgType", v === "__all" ? "" : v)}
            >
              <SelectTrigger className="h-9 rounded-lg text-xs mt-1">
                <SelectValue placeholder="Any" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all">Any</SelectItem>
                <SelectItem value="POUCH">POUCH</SelectItem>
                <SelectItem value="ROLL">ROLL</SelectItem>
                <SelectItem value="POD">POD</SelectItem>
                <SelectItem value="PACKAGING">PACKAGING</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10px] font-black uppercase tracking-wider text-content-3">
              Width (mm)
            </Label>
            <Input
              value={filters.widthMm}
              onChange={(e) => onPatch("widthMm", e.target.value)}
              placeholder="e.g. 220"
              className="h-9 rounded-lg text-xs mt-1 font-mono"
            />
          </div>
          <div>
            <Label className="text-[10px] font-black uppercase tracking-wider text-content-3">
              Height (mm)
            </Label>
            <Input
              value={filters.heightMm}
              onChange={(e) => onPatch("heightMm", e.target.value)}
              placeholder="e.g. 320"
              className="h-9 rounded-lg text-xs mt-1 font-mono"
            />
          </div>
          <div>
            <Label className="text-[10px] font-black uppercase tracking-wider text-content-3">
              Thickness (μ)
            </Label>
            <Input
              value={filters.thicknessUm}
              onChange={(e) => onPatch("thicknessUm", e.target.value)}
              placeholder="e.g. 80"
              className="h-9 rounded-lg text-xs mt-1 font-mono"
            />
          </div>
          <div>
            <Label className="text-[10px] font-black uppercase tracking-wider text-content-3">
              Pouch style
            </Label>
            <PouchStyleFilterPicker
              value={filters.pouchStyle}
              onChange={(v) => onPatch("pouchStyle", v)}
            />
          </div>
        </div>
      ) : null}

      {/* Active filter chips */}
      {activeFilterChips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1 text-[10px] font-bold border-t border-line pt-2">
          <span className="text-content-3">Active</span>
          {activeFilterChips.map((chip) => (
            <button
              key={chip.key}
              onClick={chip.clear}
              className="inline-flex items-center gap-1 rounded-full bg-order-bg px-2 py-0.5 text-order-fg ring-1 ring-order-border hover:bg-order-bg"
              title="Remove filter"
            >
              {chip.label} <X className="h-3 w-3 opacity-70" />
            </button>
          ))}
          <span className="text-content-4">·</span>
          <span className="text-content-3">
            {visibleCount} of {totalCount} visible
          </span>
        </div>
      ) : null}
    </section>
  );
}

function StatusPillBtn({
  label,
  active,
  tone,
  onClick,
}: {
  label: string;
  active: boolean;
  tone?: "amber" | "blue" | "rose" | "violet" | "emerald";
  onClick: () => void;
}) {
  const baseTone =
    tone === "amber"
      ? "bg-warning-bg text-warning-fg ring-warning-border"
      : tone === "blue"
        ? "bg-info-bg text-primary ring-info-border"
        : tone === "rose"
          ? "bg-danger-bg text-danger-fg ring-danger-border"
          : tone === "violet"
            ? "bg-order-bg text-order-fg ring-order-border"
            : tone === "emerald"
              ? "bg-success-bg text-success-fg ring-success-border"
              : "bg-surface-1 text-content-2 ring-line";
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full px-2.5 py-1 ring-1 whitespace-nowrap flex-none",
        active
          ? "bg-surface-3 text-white ring-line-strong shadow-sm"
          : `${baseTone} hover:opacity-80`,
      )}
    >
      {label}
    </button>
  );
}
function AgePillBtn({
  label,
  active,
  tone,
  onClick,
}: {
  label: string;
  active: boolean;
  tone: "emerald" | "amber" | "rose";
  onClick: () => void;
}) {
  const t =
    tone === "emerald"
      ? "bg-success-bg text-success-fg ring-success-border"
      : tone === "amber"
        ? "bg-warning-bg text-warning-fg ring-warning-border"
        : "bg-danger-bg text-danger-fg ring-danger-border";
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-full px-2.5 py-1 ring-1 whitespace-nowrap flex-none",
        t,
        active && "ring-2 ring-offset-1 ring-offset-white",
      )}
    >
      {label}
    </button>
  );
}

// ─── Bulk action bar ───────────────────────────────────────────────────

function BulkBar({
  count,
  onClear,
  onExport,
  onCancelMany,
}: {
  count: number;
  onClear: () => void;
  onExport: () => void;
  onCancelMany: () => void;
}) {
  return (
    <section className="rounded-2xl border border-order-border bg-order-bg px-4 py-2 flex flex-wrap items-center justify-between gap-3 shadow-sm">
      <div className="flex items-center gap-2 text-[12px] font-bold text-order-fg">
        <span>
          {count} order{count === 1 ? "" : "s"} selected
        </span>
        <button
          onClick={onClear}
          className="text-[11px] font-bold text-order-fg hover:underline"
        >
          Clear
        </button>
      </div>
      <div className="flex items-center gap-2 text-[11px] font-bold">
        <button
          onClick={onExport}
          className="rounded-lg bg-surface-1 px-3 py-1.5 text-content-2 ring-1 ring-line hover:bg-surface-2 inline-flex items-center gap-1"
        >
          <Download className="h-3 w-3" /> Export {count}
        </button>
        <button
          onClick={onCancelMany}
          className="rounded-lg bg-danger-solid px-3 py-1.5 text-white shadow-sm hover:bg-danger-solid"
        >
          Cancel orders
        </button>
      </div>
    </section>
  );
}

// ─── Table header (tab + density) ─────────────────────────────────────

function TableHeader({
  tab,
  onTab,
  counts,
  density,
  onDensity,
}: {
  tab: Tab;
  onTab: (t: Tab) => void;
  counts: { queue: number; history: number; cancelled: number };
  density: Density;
  onDensity: (d: Density) => void;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2">
      <div className="flex items-center gap-1.5 text-[11px] font-bold overflow-x-auto -mx-1 px-1">
        {(
          [
            ["queue", `Order queue · ${counts.queue}`],
            ["history", `History · ${counts.history}`],
            ["cancelled", `Cancelled · ${counts.cancelled}`],
          ] as Array<[Tab, string]>
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => onTab(k)}
            className={cn(
              "rounded-full px-3 py-1 ring-1 flex-none whitespace-nowrap",
              tab === k
                ? "bg-surface-3 text-white ring-line-strong"
                : "bg-surface-1 text-content-2 ring-line hover:bg-surface-2",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1.5 text-[11px] font-bold">
        <span className="text-[10px] font-black uppercase tracking-[0.18em] text-content-3 hidden sm:inline">
          Density
        </span>
        <div className="inline-flex rounded-lg bg-surface-2 p-0.5 shadow-inner">
          <button
            onClick={() => onDensity("comfortable")}
            className={cn(
              "h-7 rounded-md px-2.5",
              density === "comfortable"
                ? "bg-surface-1 text-content-1 ring-1 ring-line shadow-sm"
                : "text-content-3",
            )}
          >
            Comfortable
          </button>
          <button
            onClick={() => onDensity("compact")}
            className={cn(
              "h-7 rounded-md px-2.5",
              density === "compact"
                ? "bg-surface-1 text-content-1 ring-1 ring-line shadow-sm"
                : "text-content-3",
            )}
          >
            Compact
          </button>
        </div>
      </div>
    </header>
  );
}

// ─── Empty state ───────────────────────────────────────────────────────

function EmptyState({ onReset }: { onReset: () => void }) {
  return (
    <div className="flex min-h-[280px] flex-col items-center justify-center px-4 py-12 text-center">
      <div className="rounded-2xl bg-surface-2 p-4 ring-1 ring-line">
        <SlidersHorizontal className="h-7 w-7 text-content-4" />
      </div>
      <div className="mt-3 text-base font-bold text-content-1">
        No orders match this view
      </div>
      <p className="mt-1 text-sm text-content-3">
        Clear filters or open a saved view to bring the queue back.
      </p>
      <button
        onClick={onReset}
        className="mt-4 rounded-lg border border-line bg-surface-1 px-3 py-1.5 text-[11px] font-bold text-content-2 hover:bg-surface-2"
      >
        Reset filters
      </button>
    </div>
  );
}

// ─── Order row ─────────────────────────────────────────────────────────

interface EnrichedRow {
  order: SalesOrder;
  age: number;
  bucket: AgeBucket;
  statusKey: StatusKey;
  qtyPair: OrderQtyPair;
  totalKg: number;
  totalPcs: number | null;
  value: number;
  produced: number;
  packed: number;
  dispatched: number;
  producedPcs: number;
  dispatchedPcs: number;
}

function QuantityStack({
  qtyPair,
  compact = false,
}: {
  qtyPair: OrderQtyPair;
  compact?: boolean;
}) {
  const isPcsPrimary = qtyPair.primaryUom === "PCS" && qtyPair.pcs !== null;
  const primary = isPcsPrimary
    ? { value: fmtQty(qtyPair.pcs, 0), uom: "PCS" }
    : { value: fmtQty(qtyPair.kg, qtyPair.kg % 1 ? 2 : 0), uom: "KG" };
  const secondary = isPcsPrimary
    ? { value: fmtQty(qtyPair.kg, qtyPair.kg % 1 ? 2 : 0), uom: "KG" }
    : qtyPair.pcs !== null
      ? { value: fmtQty(qtyPair.pcs, 0), uom: "PCS" }
      : null;
  return (
    <div className="min-w-0">
      <div
        className={cn(
          "font-mono font-black text-content-1",
          compact ? "text-[11px]" : "text-[12px]",
        )}
      >
        {primary.value}{" "}
        <span className="text-[10px] font-bold text-content-3">
          {primary.uom}
        </span>
        <span className="ml-1 rounded bg-surface-2 px-1 py-0.5 text-[8px] font-black uppercase tracking-wider text-content-3">
          main
        </span>
      </div>
      <div className="mt-0.5 font-mono text-[10px] font-bold text-content-3">
        {secondary
          ? `≈ ${secondary.value} ${secondary.uom}`
          : "PCS n/a for roll"}
      </div>
    </div>
  );
}

function BatchStatusStrip({ line, compact = false }: { line: any; compact?: boolean }) {
  const summary = asRecord(line?.production_batch_summary);
  const batches = asArray(summary.batches);
  const batchCount = Number(summary.batch_count || batches.length || 0);
  if (!batchCount) return null;
  const visible = batches.slice(0, compact ? 2 : 4);
  const hidden = Math.max(0, batches.length - visible.length);
  const counts = asRecord(summary.status_counts);
  const countLabel = Object.entries(counts)
    .filter(([, value]) => Number(value) > 0)
    .slice(0, 3)
    .map(([key, value]) => `${String(key).replace(/_/g, " ").toLowerCase()} ${value}`)
    .join(" · ");
  return (
    <div className={cn("flex min-w-0 flex-wrap items-center gap-1", compact ? "mt-1" : "mt-1.5")}>
      <span className="rounded-md border border-info-border bg-info-bg px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-primary">
        {batchCount} live batch{batchCount === 1 ? "" : "es"}
      </span>
      {visible.map((batch: any) => (
        <BatchChip key={batch.id || batch.batch_number} batch={batch} />
      ))}
      {hidden > 0 ? (
        <span className="rounded-md border border-line bg-surface-1 px-2 py-0.5 text-[9px] font-black text-content-3">
          +{hidden}
        </span>
      ) : null}
      {!compact && countLabel ? (
        <span className="text-[9px] font-bold text-content-4">{countLabel}</span>
      ) : null}
    </div>
  );
}

function BatchChip({ batch }: { batch: any }) {
  const routeNode = String(
    batch.current_route_node_label ||
      batch.current_route_node_name ||
      batch.current_route_node_id ||
      "",
  ).trim();
  const branch = String(batch.current_route_branch_key || "MAIN").trim() || "MAIN";
  const routeLabel = [routeNode, branch && branch !== routeNode ? branch : ""]
    .filter(Boolean)
    .join(" · ");
  const status = String(batch.status || "PLANNED").replace(/_/g, " ");
  return (
    <span
      className="max-w-[190px] truncate rounded-md border border-line bg-surface-2 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-content-2"
      title={[batch.batch_number, status, routeLabel].filter(Boolean).join(" · ")}
    >
      {batch.batch_number} · {status}
      {routeLabel ? ` · ${routeLabel}` : ""}
    </span>
  );
}

function lineProductionMetrics(line: any) {
  const qtyPair = lineQtyPair(line);
  const summary = asRecord(line?.production_batch_summary);
  const batches = asArray(summary.batches);
  const producedFromBatches = batches.reduce((sum, batch) => sum + safeNumber(batch.produced_qty_kg), 0);
  const packedFromBatches = batches.reduce((sum, batch) => sum + safeNumber(batch.packed_qty_kg), 0);
  const dispatchedFromBatches = batches.reduce((sum, batch) => sum + safeNumber(batch.dispatched_qty_kg), 0);
  const producedKg = safeNumber(summary.produced_kg || line?.qty_final_output || producedFromBatches);
  const packedKg = safeNumber(line?.qty_dispatchable || packedFromBatches);
  const dispatchedKg = safeNumber(summary.dispatched_kg || line?.qty_dispatched || dispatchedFromBatches);
  const orderedKg = qtyPair.kg;
  const bands = flowBandMetrics({ orderedKg, producedKg, packedKg, dispatchedKg });
  return {
    qtyPair,
    orderedKg,
    producedKg,
    packedKg,
    dispatchedKg,
    openKg: bands.openKg,
    batches,
    batchCount: Number(summary.batch_count || batches.length || 0),
    percent: bands.completePct,
  };
}

function FlowMeter({
  orderedKg,
  producedKg,
  packedKg,
  dispatchedKg,
}: {
  orderedKg: number;
  producedKg: number;
  packedKg: number;
  dispatchedKg: number;
}) {
  const bands = flowBandMetrics({ orderedKg, producedKg, packedKg, dispatchedKg });
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[9px] font-black uppercase tracking-wider text-content-4">
        <span>Production flow</span>
        <span>{orderedKg > 0 ? `${Math.round(bands.completePct)}%` : "0%"}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-2 ring-1 ring-line">
        <div className="flex h-full">
          <div className="bg-success-fg" style={{ width: `${bands.dispatchedPct}%` }} />
          <div className="bg-order-fg" style={{ width: `${bands.packedPct}%` }} />
          <div className="bg-primary" style={{ width: `${bands.producedPct}%` }} />
        </div>
      </div>
      <div className="mt-1 flex flex-wrap gap-2 text-[9px] font-bold text-content-3">
        <span>Produced {fmtKg(producedKg)} KG</span>
        <span>Packed {fmtKg(packedKg)} KG</span>
        <span>Dispatched {fmtKg(dispatchedKg)} KG</span>
      </div>
    </div>
  );
}

function lineRouteCompletionPercent(line: any): number {
  const summary = asRecord(line?.production_batch_summary);
  const batches = asArray(summary.batches);
  const percents = batches
    .map((batch: any) => {
      const graph = asRecord(batch?.route_graph);
      const nodes = asArray(graph.nodes)
        .map((node: any) => asRecord(node))
        .sort((a, b) => safeNumber(a.route_index) - safeNumber(b.route_index));
      if (!nodes.length) return 0;
      const status = cleanText(batch?.status).toUpperCase();
      if (["COMPLETED", "PACKED", "DISPATCHED", "CLOSED"].some((token) => status.includes(token))) return 100;
      const currentNodeId = cleanText(batch?.current_route_node_id);
      const currentIndex = safeNumber(batch?.current_step_index);
      let activePosition = currentNodeId
        ? nodes.findIndex((node) => cleanText(node.id) === currentNodeId)
        : -1;
      if (activePosition < 0 && Number.isFinite(currentIndex)) {
        activePosition = nodes.findIndex((node) => safeNumber(node.route_index) === currentIndex);
      }
      if (activePosition < 0) return 0;
      const liveCredit = status === "PLANNED" ? 0.15 : 0.5;
      return Math.max(0, Math.min(100, ((activePosition + liveCredit) / nodes.length) * 100));
    })
    .filter((value) => value > 0);
  if (!percents.length) return 0;
  return percents.reduce((sum, value) => sum + value, 0) / percents.length;
}

function LineContributionBar({
  lines,
  compact = false,
}: {
  lines: any[];
  compact?: boolean;
}) {
  const rows = lines
    .map((line, index) => {
      const metrics = lineProductionMetrics(line);
      return {
        line,
        index,
        metrics,
        progressPct: Math.max(metrics.percent, lineRouteCompletionPercent(line)),
      };
    })
    .filter((row) => row.metrics.orderedKg > 0);
  const totalKg = rows.reduce((sum, row) => sum + row.metrics.orderedKg, 0);
  if (!rows.length || totalKg <= 0) return null;
  return (
    <div className={cn(compact ? "mt-1.5" : "mt-2")}>
      <div className="mb-1 flex items-center justify-between text-[9px] font-black uppercase tracking-wider text-content-4">
        <span>Line-wise live progress</span>
        <span>{rows.length} line{rows.length === 1 ? "" : "s"}</span>
      </div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-surface-2 ring-1 ring-line">
        {rows.map((row) => {
          const tone = LINE_PROGRESS_TONES[row.index % LINE_PROGRESS_TONES.length];
          const segmentPct = Math.max(3, (row.metrics.orderedKg / totalKg) * 100);
          return (
            <div
              key={row.line.id || row.index}
              className="h-full overflow-hidden"
              style={{ width: `${segmentPct}%`, background: tone.bg }}
              title={`L${row.index + 1} · ${fmtKg(row.metrics.orderedKg)} KG · ${Math.round(row.progressPct)}% route/live complete`}
            >
              <div
                className="h-full"
                style={{ width: `${row.progressPct}%`, background: tone.fill }}
              />
            </div>
          );
        })}
      </div>
      {!compact ? (
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {rows.slice(0, 8).map((row) => {
            const tone = LINE_PROGRESS_TONES[row.index % LINE_PROGRESS_TONES.length];
            return (
              <span
                key={row.line.id || row.index}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md border bg-surface-1 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide",
                  tone.text,
                  tone.border,
                )}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: tone.fill }} />
                L{row.index + 1} · {fmtKg(row.metrics.orderedKg)} KG · {Math.round(row.progressPct)}%
              </span>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function RouteGraphPreview({ line }: { line: any }) {
  const metrics = lineProductionMetrics(line);
  const graphBatch = metrics.batches.find((batch: any) => Array.isArray(batch?.route_graph?.nodes) && batch.route_graph.nodes.length);
  const nodes = asArray(graphBatch?.route_graph?.nodes)
    .map((node: any) => asRecord(node))
    .sort((a, b) => safeNumber(a.route_index) - safeNumber(b.route_index));
  if (!nodes.length) return <BatchStatusStrip line={line} />;
  const activeNodeId = String(graphBatch?.current_route_node_id || "").trim();
  const activeIndex = safeNumber(graphBatch?.current_step_index);
  return (
    <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
      {nodes.slice(0, 8).map((node, index) => {
        const isActive =
          (activeNodeId && activeNodeId === String(node.id || "")) ||
          (!activeNodeId && safeNumber(node.route_index) === activeIndex);
        const isPast = safeNumber(node.route_index) < activeIndex;
        return (
          <span
            key={String(node.id || `${node.process_code}-${index}`)}
            className={cn(
              "max-w-[150px] truncate rounded-md border px-2 py-1 text-[9px] font-black uppercase tracking-wide",
              isActive
                ? "border-info-border bg-info-bg text-primary"
                : isPast
                  ? "border-success-border bg-success-bg text-success-fg"
                  : "border-line bg-surface-2 text-content-3",
            )}
            title={[
              node.label || node.process_code,
              node.branch_key || "MAIN",
              node.parallel_group,
              node.join_key,
            ].filter(Boolean).join(" · ")}
          >
            {index > 0 ? "→ " : ""}
            {node.label || node.process_code || "Step"}
            {node.parallel_group ? " +" : ""}
            {node.join_key ? " join" : ""}
          </span>
        );
      })}
      {nodes.length > 8 ? (
        <span className="rounded-md border border-line bg-surface-1 px-2 py-1 text-[9px] font-black text-content-3">
          +{nodes.length - 8}
        </span>
      ) : null}
    </div>
  );
}

function LineFlowCard({ line, index }: { line: any; index: number }) {
  const lineChips = buildLineAxisChips(line);
  const lineArtwork = artworkPreviewFromSource(line, "line");
  const partialNote = partialLineNote(line);
  const metrics = lineProductionMetrics(line);
  return (
    <div className="rounded-xl border border-line bg-surface-1 px-3.5 py-3 text-[12px] shadow-sm">
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,.8fr)] xl:items-start">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <ArtworkPreviewButton preview={lineArtwork} compact />
            <span className="min-w-0 truncate font-mono text-[13px] font-black text-content-1">
              {salesLineLabel(line, index)}
            </span>
            {line.line_status_display || line.line_status ? (
              <span className="rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-content-3">
                {line.line_status_display || line.line_status}
              </span>
            ) : null}
            {partialNote ? (
              <span className="rounded-full border border-warning-border bg-warning-bg px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-warning-fg">
                {partialNote}
              </span>
            ) : null}
          </div>
          <AxisChipStrip chips={lineChips} compact className="mt-1.5" />
          <RouteGraphPreview line={line} />
          {metrics.batches.length ? (
            <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
              {metrics.batches.slice(0, 4).map((batch: any) => (
                <div key={batch.id || batch.batch_number} className="rounded-lg border border-line bg-surface-2 px-2.5 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-mono text-[11px] font-black text-content-1">
                      {batch.batch_number}
                    </span>
                    <span className="rounded-full bg-surface-1 px-2 py-0.5 text-[8px] font-black uppercase text-content-3 ring-1 ring-line">
                      {String(batch.status || "PLANNED").replace(/_/g, " ")}
                    </span>
                  </div>
                  <div className="mt-1 truncate text-[10px] font-bold text-content-3">
                    {batch.current_route_node_label || batch.current_route_process_code || "Route pending"} · {batch.current_route_branch_key || "MAIN"}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <div className="rounded-xl border border-info-border bg-info-bg px-3 py-2.5">
          <div className="mb-2 flex items-start justify-between gap-2">
            <QuantityStack qtyPair={metrics.qtyPair} compact />
            <div className="text-right">
              <div className="font-mono text-[13px] font-black text-content-1">{fmtKg(metrics.orderedKg)} KG</div>
              <div className="text-[9px] font-bold uppercase tracking-wide text-content-4">line target</div>
            </div>
          </div>
          <FlowMeter
            orderedKg={metrics.orderedKg}
            producedKg={metrics.producedKg}
            packedKg={metrics.packedKg}
            dispatchedKg={metrics.dispatchedKg}
          />
          <div className="mt-2 grid grid-cols-2 gap-1.5 text-[10px]">
            <div className="rounded-md bg-surface-1 px-2 py-1">
              <span className="text-content-4">Open</span>
              <span className="ml-1 font-mono font-black text-content-1">{fmtKg(metrics.openKg)} KG</span>
            </div>
            <div className="rounded-md bg-surface-1 px-2 py-1">
              <span className="text-content-4">Batches</span>
              <span className="ml-1 font-mono font-black text-content-1">{metrics.batchCount}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function OrderRow({
  row,
  density,
  selected,
  expanded,
  onToggleSelect,
  onToggleExpand,
  onCancel,
}: {
  row: EnrichedRow;
  density: Density;
  selected: boolean;
  expanded: boolean;
  onToggleSelect: () => void;
  onToggleExpand: () => void;
  onCancel: () => void;
}) {
  const {
    order,
    age,
    bucket,
    statusKey,
    qtyPair,
    totalKg,
    totalPcs,
    produced,
    packed,
    dispatched,
    producedPcs,
    dispatchedPcs,
  } = row;
  const flowBands = flowBandMetrics({ orderedKg: totalKg, producedKg: produced, packedKg: packed, dispatchedKg: dispatched });
  const remaining = flowBands.openKg;
  const remainingPcs =
    totalPcs === null
      ? null
      : Math.max(0, totalPcs - producedPcs - dispatchedPcs);
  const progressText =
    qtyPair.primaryUom === "PCS" && totalPcs !== null
      ? `${fmtQty(producedPcs, 0)} PCS produced · ${fmtQty(remainingPcs, 0)} PCS remaining · ${Math.round(((producedPcs + dispatchedPcs) / Math.max(totalPcs, 1)) * 100)}%`
      : totalKg > 0
        ? `${fmtKg(produced)} KG produced · ${fmtKg(packed)} KG packed · ${fmtKg(dispatched)} KG dispatched · ${fmtKg(remaining)} KG open`
        : "—";
  const ageTone =
    bucket === "aged"
      ? "bg-danger-solid"
      : bucket === "watch"
        ? "bg-warning-fg"
        : "bg-success-fg";
  const ageLabel =
    bucket === "aged"
      ? `aged ${age}d`
      : bucket === "watch"
        ? `watch ${age}d`
        : age === 0
          ? "fresh 0d"
          : `fresh ${age}d`;
  const rowHoverBg =
    bucket === "aged"
      ? "hover:bg-danger-bg"
      : bucket === "watch"
        ? "hover:bg-warning-bg"
        : "hover:bg-surface-2";
  const rowPad = density === "compact" ? "py-2" : "py-3";
  const isCancelled = statusKey === "CANCELLED";
  const canCancel = [
    "DRAFT",
    "CONFIRMED",
    "PLANNING_REQUIRED",
    "PLANNED",
  ].includes(statusKey);
  const axisChips = buildOrderAxisChips(order);
  const artworkPreview = artworkPreviewForOrder(order);
  const orderLines = Array.isArray(order.items) ? order.items : [];
  const visibleLinePreview = orderLines.slice(0, 2);
  const hiddenLineCount = Math.max(0, orderLines.length - visibleLinePreview.length);

  return (
    <article
      className={cn(
        "border-b border-line transition",
        rowHoverBg,
        isCancelled && "opacity-70 hover:opacity-100",
      )}
    >
      {/* Mobile layout (stacked) */}
      <div
        className={cn(
          "md:hidden px-4 grid grid-cols-[2rem_1fr_auto] gap-2 items-start",
          rowPad,
        )}
      >
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggleSelect}
          className="mt-1 h-3.5 w-3.5 rounded border-line-strong"
        />
        <div
          role="button"
          tabIndex={0}
          onClick={onToggleExpand}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onToggleExpand();
            }
          }}
          className="min-w-0 text-left"
        >
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "flex h-8 w-8 flex-none items-center justify-center rounded-xl text-white font-black text-[11px]",
                customerAvatarTone(age),
              )}
            >
              {customerInitials(order.customer_name || "")}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-bold text-content-1 truncate">
                {order.customer_name || "—"}
              </div>
              <div className="flex items-center gap-1.5 mt-0.5 text-[10px]">
                <span className="font-mono font-black text-order-fg">
                  {order.order_number}
                </span>
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-black text-white",
                    ageTone,
                  )}
                >
                  {ageLabel}
                </span>
                <span className="rounded-full border border-line bg-surface-1 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-content-3">
                  {orderLines.length || 1} line{(orderLines.length || 1) === 1 ? "" : "s"}
                </span>
              </div>
            </div>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <div className="min-w-0 flex-1 text-[11px] font-bold text-content-2 truncate">
              {order.item_summary?.variant_name ||
                order.line_name ||
                order.item_summary?.template_name ||
                "—"}
            </div>
          </div>
          <AxisChipStrip chips={axisChips} compact className="mt-1" />
          {visibleLinePreview.length ? (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {visibleLinePreview.map((line: any, index: number) => {
                const note = partialLineNote(line);
                return (
                  <React.Fragment key={line.id || index}>
                    <span className="max-w-full truncate rounded-md border border-line bg-surface-1 px-2 py-0.5 text-[10px] font-bold text-content-2">
                      {salesLineLabel(line, index)}
                    </span>
                    {note ? (
                      <span className="rounded-md border border-warning-border bg-warning-bg px-2 py-0.5 text-[10px] font-black text-warning-fg">
                        {note}
                      </span>
                    ) : null}
                    <BatchStatusStrip line={line} compact />
                  </React.Fragment>
                );
              })}
              {hiddenLineCount > 0 ? (
                <span className="rounded-md border border-line bg-surface-2 px-2 py-0.5 text-[10px] font-black text-content-3">
                  +{hiddenLineCount} more
                </span>
              ) : null}
            </div>
          ) : null}
          <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px]">
            <div>
              <div className="text-[8px] font-black uppercase tracking-wider text-content-4">
                Total order
              </div>
              <QuantityStack qtyPair={qtyPair} compact />
            </div>
            <span
              className={cn(
                "rounded-md px-2 py-0.5 text-[10px] font-black ring-1",
                STATUS_PILL_TONE[statusKey],
              )}
            >
              {STATUS_LABEL[statusKey] || statusKey}
            </span>
          </div>
          {totalKg > 0 ? (
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-2 ring-1 ring-line">
              <div className="flex h-full">
                <div
                  className="bg-success-fg"
                  style={{ width: `${flowBands.dispatchedPct}%` }}
                />
                <div
                  className="bg-order-fg"
                  style={{ width: `${flowBands.packedPct}%` }}
                />
                <div
                  className="bg-primary"
                  style={{ width: `${flowBands.producedPct}%` }}
                />
              </div>
            </div>
          ) : null}
          {orderLines.length > 1 ? <LineContributionBar lines={orderLines} compact /> : null}
        </div>
        <div className="flex flex-col items-end gap-1">
          <Link
            href={`/sales/orders/${order.id}`}
            title="Open order tracker"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-1 text-content-2 ring-1 ring-line hover:bg-surface-2"
          >
            ↗
          </Link>
          {canCancel ? (
            <button
              title="Cancel"
              onClick={onCancel}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-1 text-danger-fg ring-1 ring-danger-border hover:bg-danger-bg"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      {/* Desktop layout (table-ish) */}
      <div
        className={cn(
          "hidden md:grid grid-cols-[2.5rem_minmax(0,1.2fr)_minmax(0,2.05fr)_8.5rem_minmax(0,1.05fr)_9.5rem] gap-3 px-4 items-center",
          rowPad,
        )}
      >
        <div>
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            className="h-3.5 w-3.5 rounded border-line-strong"
          />
        </div>
        <button
          onClick={onToggleExpand}
          className="min-w-0 flex items-center gap-2.5 text-left"
        >
          <span
            className={cn(
              "flex h-9 w-9 flex-none items-center justify-center rounded-xl text-white font-black text-[11px]",
              customerAvatarTone(age),
            )}
          >
            {customerInitials(order.customer_name || "")}
          </span>
          <div className="min-w-0">
            <div className="text-[13px] font-bold text-content-1 truncate">
              {order.customer_name || "—"}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5 text-[10px]">
              <span className="font-mono font-black text-order-fg">
                {order.order_number}
              </span>
              {(order as any).customer_code ? (
                <>
                  <span className="text-content-4">·</span>
                  <span className="font-mono text-content-3">
                    {(order as any).customer_code}
                  </span>
                </>
              ) : null}
              {order.order_name ? (
                <>
                  <span className="text-content-4">·</span>
                  <span className="text-content-3 truncate max-w-[140px]">
                    {order.order_name}
                  </span>
                </>
              ) : null}
              <span className="text-content-4">·</span>
              <span className="rounded-full border border-line bg-surface-1 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide text-content-3">
                {orderLines.length || 1} line{(orderLines.length || 1) === 1 ? "" : "s"}
              </span>
            </div>
          </div>
        </button>
        <div
          role="button"
          tabIndex={0}
          onClick={onToggleExpand}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onToggleExpand();
            }
          }}
          className="min-w-0 text-left"
        >
          <div className="flex min-w-0 items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-bold text-content-1 truncate">
                {order.item_summary?.variant_name ||
                  order.line_name ||
                  order.item_summary?.template_name ||
                  "—"}
              </div>
              <AxisChipStrip chips={axisChips} className="mt-1" />
              {visibleLinePreview.length ? (
                <div className="mt-1.5 grid gap-1">
                  {visibleLinePreview.map((line: any, index: number) => {
                    const note = partialLineNote(line);
                    return (
                      <div
                        key={line.id || index}
                        className="flex min-w-0 items-center gap-1.5 text-[10px] font-bold text-content-2"
                      >
                        <span className="min-w-0 truncate rounded-md border border-line bg-surface-1 px-2 py-0.5">
                          {salesLineLabel(line, index)}
                        </span>
                        {line.line_status_display || line.line_status ? (
                          <span className="flex-none rounded-md bg-surface-2 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wide text-content-3">
                            {line.line_status_display || line.line_status}
                          </span>
                        ) : null}
                        {note ? (
                          <span className="hidden flex-none rounded-md border border-warning-border bg-warning-bg px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wide text-warning-fg xl:inline-flex">
                            {note}
                          </span>
                        ) : null}
                        <BatchStatusStrip line={line} compact />
                      </div>
                    );
                  })}
                  {hiddenLineCount > 0 ? (
                    <div className="text-[10px] font-black text-content-3">
                      +{hiddenLineCount} more line{hiddenLineCount === 1 ? "" : "s"} on expand
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
        <div className="min-w-0 self-stretch">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[9px] font-black uppercase tracking-[0.16em] text-content-4">
                Placed
              </div>
              <div className="truncate text-[11px] font-mono font-black text-content-1">
                {fmtDate(order.created_at)}
              </div>
            </div>
            <span
              className={cn(
                "inline-flex flex-none items-center rounded-full px-1.5 py-0.5 text-[8px] font-black leading-4 text-white",
                ageTone,
              )}
            >
              {ageLabel.replace(/^fresh\s+/i, "")}
            </span>
          </div>
          <ArtworkPreviewButton
            preview={artworkPreview}
            compact
            showLabel={false}
            className="mt-2"
          />
        </div>
        <div className="min-w-0">
          <div className="text-[9px] font-black uppercase tracking-[0.14em] text-content-4">
            Total order
          </div>
          <QuantityStack qtyPair={qtyPair} />
          <div className="text-[10px] font-semibold text-content-3">{progressText}</div>
          {totalKg > 0 ? (
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-2 ring-1 ring-line">
              <div className="flex h-full">
                <div
                  className="bg-success-fg"
                  style={{ width: `${flowBands.dispatchedPct}%` }}
                />
                <div
                  className="bg-order-fg"
                  style={{ width: `${flowBands.packedPct}%` }}
                />
                <div
                  className="bg-primary"
                  style={{ width: `${flowBands.producedPct}%` }}
                />
              </div>
            </div>
          ) : null}
          {orderLines.length > 1 ? <LineContributionBar lines={orderLines} compact /> : null}
          {totalKg > 0 ? (
            <div className="mt-1 flex flex-wrap gap-2 text-[9px] font-black uppercase tracking-wide text-content-4">
              <span className="text-primary">Produced {fmtKg(produced)}</span>
              <span className="text-order-fg">Packed {fmtKg(packed)}</span>
              <span className="text-success-fg">Dispatch {fmtKg(dispatched)}</span>
              <span>Open {fmtKg(remaining)}</span>
            </div>
          ) : null}
        </div>
        <div className="flex items-center justify-end gap-1.5">
          <span
            className={cn(
              "rounded-md px-2 py-0.5 text-[10px] font-black ring-1",
              STATUS_PILL_TONE[statusKey] || STATUS_PILL_TONE.DRAFT,
            )}
          >
            {STATUS_LABEL[statusKey] || statusKey}
          </span>
          <Link
            href={`/sales/orders/${order.id}`}
            title="Open order tracker"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-1 text-content-2 ring-1 ring-line hover:bg-surface-2"
          >
            ↗
          </Link>
          {canCancel ? (
            <button
              title="Cancel"
              onClick={(e) => {
                e.stopPropagation();
                onCancel();
              }}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-1 text-danger-fg ring-1 ring-danger-border hover:bg-danger-bg"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      {/* Expanded inline drawer */}
      {expanded ? (
        <OrderExpandedDrawer orderId={order.id} />
      ) : (
        <button
          onClick={onToggleExpand}
          className="hidden md:flex w-full items-center gap-1 px-4 pb-1.5 pt-0 text-[10px] font-bold text-content-4 hover:text-content-2"
        >
          <ChevronDown className="h-3 w-3" /> Expand · line items + activity
        </button>
      )}
    </article>
  );
}

// ─── Expanded drawer — pulls full SO via getOrder for line items + activity ──

function OrderExpandedDrawer({ orderId }: { orderId: string }) {
  const { data: full, isLoading } = useQuery({
    queryKey: ["sales-order-detail", orderId],
    queryFn: () => salesService.getOrder(orderId),
    staleTime: 30_000,
  });
  const items = full?.items || [];
  const orderPair = full ? orderQtyPair(full) : null;
  const lineMetrics = items.map((line: any) => lineProductionMetrics(line));
  const totals = {
    orderedKg: lineMetrics.reduce((sum, row) => sum + row.orderedKg, 0) || safeNumber(full?.qty_summary?.ordered_kg || full?.total_weight_kg),
    producedKg: lineMetrics.reduce((sum, row) => sum + row.producedKg, 0) || safeNumber(full?.fulfillment_summary?.produced_kg),
    packedKg: lineMetrics.reduce((sum, row) => sum + row.packedKg, 0),
    dispatchedKg: lineMetrics.reduce((sum, row) => sum + row.dispatchedKg, 0) || safeNumber(full?.fulfillment_summary?.dispatched_kg),
  };
  return (
    <div className="border-t border-line bg-surface-1 px-4 py-3">
      {isLoading ? (
        <div className="flex items-center gap-2 text-[11px] text-content-3">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading line items…
        </div>
      ) : !full ? (
        <div className="text-[11px] text-content-3">
          Could not load order detail.
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-2 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1.9fr)_auto] xl:items-stretch">
            <div className="rounded-xl border border-line bg-surface-2 px-3 py-2">
              <div className="text-[9px] font-black uppercase tracking-[0.18em] text-content-4">Order snapshot</div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] font-bold text-content-2">
                <span className="truncate text-content-1">{full.customer_name}</span>
                <span className="font-mono text-order-fg">{full.order_number}</span>
                <span>{items.length} line{items.length === 1 ? "" : "s"}</span>
                {full.delivery_date ? <span>Promise {fmtDate(full.delivery_date)}</span> : null}
              </div>
              {full.remarks ? (
                <div className="mt-1 line-clamp-1 text-[10px] italic text-content-3">&ldquo;{full.remarks}&rdquo;</div>
              ) : null}
            </div>
            <div className="rounded-xl border border-line bg-surface-2 px-3 py-2">
              <div className="grid gap-2 sm:grid-cols-[minmax(120px,.65fr)_minmax(220px,1fr)] sm:items-center">
                <div>
                  <div className="text-[9px] font-black uppercase tracking-[0.18em] text-content-4">Total order demand</div>
                  <div className="mt-1 font-mono text-[15px] font-black text-content-1">
                    {fmtKg(totals.orderedKg)} <span className="text-[10px] text-content-3">KG</span>
                    {orderPair?.pcs !== null && orderPair?.pcs !== undefined ? (
                      <span className="ml-2 text-[10px] text-content-3">≈ {fmtQty(orderPair.pcs, 0)} PCS</span>
                    ) : null}
                  </div>
                </div>
                <FlowMeter
                  orderedKg={totals.orderedKg}
                  producedKg={totals.producedKg}
                  packedKg={totals.packedKg}
                  dispatchedKg={totals.dispatchedKg}
                />
              </div>
              <LineContributionBar lines={items} />
            </div>
            <div className="flex min-w-[260px] items-stretch gap-1.5 rounded-xl border border-line bg-surface-2 p-1.5">
              <Link
                href={`/sales/orders/${full.id}`}
                className="inline-flex flex-1 items-center justify-center rounded-lg bg-content-1 px-3 text-[11px] font-black text-white hover:bg-content-2"
              >
                Open tracker
              </Link>
              <Link
                href={`/sales/orders/create?customer=${full.customer || full.customer_id || ""}`}
                className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg border border-line bg-surface-1 px-3 text-[11px] font-bold text-content-2 hover:bg-surface-2"
              >
                Re-order <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-content-3">
                Line flow breakdown · {items.length}
              </div>
              {full.created_at ? (
                <div className="text-[10px] text-content-3">
                  Placed {fmtDate(full.created_at)} · {ageDays(full.created_at)}d ago
                </div>
              ) : null}
            </div>
            <div className="space-y-2">
              {items.map((it: any, i: number) => (
                <LineFlowCard key={it.id || i} line={it} index={i} />
              ))}
              {items.length === 0 ? (
                <div className="rounded-xl border border-dashed border-line bg-surface-2 px-3 py-5 text-center text-[11px] italic text-content-3">
                  No line items captured.
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Cancel dialog ─────────────────────────────────────────────────────

function salesLineLabel(line: any, index: number) {
  const title = cleanText(
    line?.line_name ||
      line?.product_master_code ||
      line?.product_master_name ||
      line?.template_name ||
      line?.template?.name ||
      `Line ${index + 1}`,
  );
  const qty = Number(line?.qty_value || 0);
  const uom = String(line?.qty_uom || "KG").toUpperCase();
  return `L${index + 1} · ${title || "Untitled line"} · ${fmtQty(qty, uom === "PCS" ? 0 : 2)} ${uom}`;
}

function partialLineNote(line: any) {
  const status = String(line?.line_status || "").toUpperCase();
  if (status !== "PARTIAL") return "";
  const uom = String(line?.qty_uom || "KG").toUpperCase();
  const dispatchable = safeNumber(line?.qty_dispatchable);
  const replan = safeNumber(line?.qty_replan_remaining);
  return `Dispatch ${fmtQty(dispatchable, uom === "PCS" ? 0 : 2)} ${uom} · Replan ${fmtQty(replan, uom === "PCS" ? 0 : 2)} ${uom}`;
}

function CancelOrderDialog({
  order,
  onClose,
  onConfirm,
  pending,
}: {
  order: SalesOrder | null;
  onClose: () => void;
  onConfirm: (reason: string, itemIds?: string[]) => void;
  pending: boolean;
}) {
  const [reasonKey, setReasonKey] =
    React.useState<string>("CUSTOMER_CANCELLED");
  const [note, setNote] = React.useState("");
  const [scope, setScope] = React.useState<"ORDER" | "LINES">("ORDER");
  const [selectedLineIds, setSelectedLineIds] = React.useState<Set<string>>(
    new Set(),
  );
  React.useEffect(() => {
    if (order) {
      setReasonKey("CUSTOMER_CANCELLED");
      setNote("");
      setScope("ORDER");
      setSelectedLineIds(new Set());
    }
  }, [order?.id]);
  if (!order) return null;
  const age = ageDays(order.created_at);
  const lines = Array.isArray(order.items) ? order.items : [];
  const releasedToPlanner = [
    "RELEASED",
    "PACKING_READY",
    "DISPATCH_READY",
    "COMPLETED",
    "CANCELLED",
  ].includes(String(order.status || "").toUpperCase());
  const selectedCount = selectedLineIds.size;
  const canSubmit = !releasedToPlanner && (scope === "ORDER" || selectedCount > 0);
  const toggleLine = (id: string) => {
    setSelectedLineIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  return (
    <Dialog
      open={!!order}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-2xl rounded-2xl p-0 overflow-hidden">
        <div className="border-b border-danger-border bg-gradient-to-r from-danger-bg via-white to-white px-5 py-4">
          <DialogHeader>
            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-danger-fg">
              Cancel sales demand
            </div>
            <DialogTitle className="font-display text-base font-bold text-content-1 mt-0.5">
              {order.order_number} · {order.customer_name}
            </DialogTitle>
            <DialogDescription className="text-[11px] text-content-3 mt-0.5">
              Aged {age} day{age === 1 ? "" : "s"} · status{" "}
              {STATUS_LABEL[String(order.status).toUpperCase() as StatusKey] ||
                order.status}
              . Sales can cancel before planner release; released lines move through Planner.
            </DialogDescription>
          </DialogHeader>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div>
            <Label className="text-[10px] font-black uppercase tracking-wider text-content-3 mb-1.5 block">
              Cancel scope
            </Label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setScope("ORDER")}
                className={cn(
                  "rounded-xl border px-3 py-2 text-left",
                  scope === "ORDER"
                    ? "border-danger-border bg-danger-bg text-danger-fg"
                    : "border-line bg-surface-1 text-content-2 hover:bg-surface-2",
                )}
              >
                <div className="text-[11px] font-black uppercase tracking-wide">
                  Full order
                </div>
                <div className="mt-0.5 text-[10px] font-semibold opacity-80">
                  Cancels every open line before release.
                </div>
              </button>
              <button
                type="button"
                onClick={() => setScope("LINES")}
                disabled={!lines.length || releasedToPlanner}
                className={cn(
                  "rounded-xl border px-3 py-2 text-left disabled:cursor-not-allowed disabled:opacity-50",
                  scope === "LINES"
                    ? "border-warning-border bg-warning-bg text-warning-fg"
                    : "border-line bg-surface-1 text-content-2 hover:bg-surface-2",
                )}
              >
                <div className="text-[11px] font-black uppercase tracking-wide">
                  Selected lines
                </div>
                <div className="mt-0.5 text-[10px] font-semibold opacity-80">
                  Cancel only chosen line items.
                </div>
              </button>
            </div>
            {releasedToPlanner ? (
              <div className="mt-2 rounded-xl border border-warning-border bg-warning-bg px-3 py-2 text-[10px] font-bold text-warning-fg">
                This order is already in planner/production lifecycle. Use Planner cancel or short-close for line-level changes.
              </div>
            ) : null}
          </div>
          {scope === "LINES" ? (
            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <Label className="text-[10px] font-black uppercase tracking-wider text-content-3">
                  Select line items
                </Label>
                <button
                  type="button"
                  className="text-[10px] font-black uppercase tracking-wide text-primary"
                  onClick={() =>
                    setSelectedLineIds(new Set(lines.map((line: any) => line.id).filter(Boolean)))
                  }
                >
                  Select all
                </button>
              </div>
              <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                {lines.map((line: any, index: number) => {
                  const id = String(line.id || "");
                  const active = selectedLineIds.has(id);
                  return (
                    <button
                      key={id || index}
                      type="button"
                      onClick={() => id && toggleLine(id)}
                      className={cn(
                        "w-full rounded-xl border px-3 py-2 text-left",
                        active
                          ? "border-warning-border bg-warning-bg"
                          : "border-line bg-surface-1 hover:bg-surface-2",
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-[12px] font-black text-content-1">
                            {salesLineLabel(line, index)}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-1.5 text-[10px] font-bold text-content-3">
                            <span className="rounded-full border border-line px-2 py-0.5">
                              {line.line_status_display || line.line_status || "Open"}
                            </span>
                            <span className="rounded-full border border-line px-2 py-0.5">
                              Open {fmtQty(Number(line.qty_open ?? line.qty_value ?? 0), 2)}
                            </span>
                          </div>
                        </div>
                        <span
                          className={cn(
                            "mt-0.5 grid h-5 w-5 place-items-center rounded-md border text-[11px] font-black",
                            active
                              ? "border-warning-fg bg-warning-fg text-white"
                              : "border-line text-content-3",
                          )}
                        >
                          {active ? "✓" : ""}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
          <div>
            <Label className="text-[10px] font-black uppercase tracking-wider text-content-3 mb-1.5 block">
              Reason category <span className="text-danger-fg">*</span>
            </Label>
            <div className="flex flex-wrap gap-1.5 text-[11px] font-bold">
              {CANCEL_REASONS.map((r) => (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => setReasonKey(r.value)}
                  className={cn(
                    "rounded-full px-2.5 py-1 ring-1",
                    reasonKey === r.value
                      ? "bg-danger-bg text-danger-fg ring-danger-border"
                      : "bg-surface-1 text-content-2 ring-line hover:bg-surface-2",
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label className="text-[10px] font-black uppercase tracking-wider text-content-3 mb-1.5 block">
              Note (optional)
            </Label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder="e.g. Customer called — switching to a different pouch size next week."
              className="rounded-xl"
            />
          </div>
          <div className="rounded-xl border border-warning-border bg-warning-bg px-3 py-2 text-[10px] font-bold text-warning-fg flex items-start gap-2">
            <AlertTriangle className="h-3.5 w-3.5 flex-none mt-0.5" />
            {scope === "LINES"
              ? "Selected line cancellation closes only those lines. Other lines stay available for Planner."
              : "Full cancellation closes all open lines and releases any in-house auto-demand stock created for this SO."}
          </div>
        </div>
        <div className="border-t border-line bg-surface-1 px-5 py-3 flex items-center justify-end gap-2">
          <Button variant="outline" onClick={onClose} className="rounded-xl">
            Keep order
          </Button>
          <Button
            onClick={() =>
              onConfirm(
                [reasonKey, note].filter(Boolean).join(" · "),
                scope === "LINES" ? Array.from(selectedLineIds) : undefined,
              )
            }
            disabled={pending || !canSubmit}
            className="rounded-xl bg-danger-solid text-white hover:bg-danger-solid"
          >
            {pending ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : null}
            {scope === "LINES"
              ? `Cancel ${selectedCount || 0} line${selectedCount === 1 ? "" : "s"}`
              : `Cancel ${order.order_number}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Pouch-style filter picker ───────────────────────────────────────────────

function PouchStyleFilterPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const { data: styles = [] } = useQuery({
    queryKey: ["pouch-styles-for-filter"],
    queryFn: async () => {
      const { pouchStyleService } = await import("@/services/pouch-style");
      return pouchStyleService.list({ page_size: 200 });
    },
    staleTime: 60_000,
  });
  return (
    <Select
      value={value || "__all"}
      onValueChange={(v) => onChange(v === "__all" ? "" : v)}
    >
      <SelectTrigger className="h-9 rounded-lg text-xs mt-1">
        <SelectValue placeholder="Any pouch style" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__all">Any pouch style</SelectItem>
        {styles.map((s: any) => (
          <SelectItem key={s.id} value={String(s.id)}>
            <span className="mr-1">{s.visual_emoji || "🛍️"}</span> {s.code} ·{" "}
            {s.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

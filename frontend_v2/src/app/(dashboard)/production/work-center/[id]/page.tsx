"use client";

import { mmWithInches } from "@/lib/size-naming";
import { useState, useMemo, useEffect, useRef, useDeferredValue, type MouseEvent } from "react";
import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  wcmService,
  WorkCenterAssignment,
  type StalledJob,
} from "@/services/wcm";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  CheckCircle2,
  ChevronDown,
  AlertCircle,
  ArrowUpRight,
  Activity,
  Trash2,
  Search,
  History,
  Scissors,
  SkipForward,
  TriangleAlert,
  ArrowRightLeft,
  Truck,
  Warehouse,
  Check,
  Lock,
  Layers,
  Factory,
  Filter,
  Bookmark,
  SlidersHorizontal,
} from "lucide-react";
import { matchesRollMaterial, distinctRollTargetSpecs } from "@/lib/roll-allocation-filters.mjs";
import { WcmRollPickerDialog } from "@/components/wcm/roll-picker-dialog";
import {
  InkColorSwatches,
  CylinderReadyChip,
  MaterialBlockChip,
  ElapsedStalledBadge,
  MachineStateBadge,
  type MachineLiveState,
} from "@/components/wcm/queue-card-chips";
import { ArtworkButton } from "@/components/machine/cylinder-artwork";
import { ProductionOrderSpecRail } from "@/components/production/production-order-spec-rail";
import { PrintColorRevisionNotice } from "@/components/production/print-color-revision-notice";
import { StalledJobsPanel } from "@/components/wcm/stalled-jobs-panel";
import { RollLanesPanel, type RollLane, type ReturnRollPayload } from "@/components/production/roll-lanes-panel";
import { SpecBlock, specFromSource } from "@/components/spine/spec-block";
import { OrderSpine, useOrderSpine } from "@/components/spine/order-spine";
import { StepFeedCard } from "@/components/spine/step-feed";
import { JobNameTag } from "@/components/spine/job-name-tag";
import { type GranuleCodeSourceOption } from "@/components/wcm/granule-code-source-picker";
import { GranuleAllocationBox } from "@/components/wcm/granule-allocation-box";
import { WcmQueueRow, queueRowModel } from "@/components/wcm/terminal/wcm-queue-row";
import { WcmJobPlate, madeLineFor } from "@/components/wcm/terminal/wcm-plate";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/components/auth-provider";
import { SavedViewBar } from "@/components/ds";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useOnlineStatus } from "@/hooks/use-online-status";
import { ConnectionLostBanner } from "@/components/system/connection-banner";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { inventoryService } from "@/services/inventory";
import { normalizeProductSpec } from "@/lib/product-spec";
import {
  ALL_PRODUCTION_FACET,
  buildProductionFacetOptions,
  hasProductionFacetFilters,
  matchesProductionFacets,
  productionFacetValues,
  type ProductionFacetFilters,
  type ProductionFacetOption,
} from "@/lib/production-facets";
import { formatDisplayDate, formatDisplayDateTime } from "@/lib/date-format";

type StepPolicyDraft = {
  issue_policy_mode:
    | "NONE"
    | "PERCENT_OVER_THEORY"
    | "FIXED_EXTRA_KG"
    | "MINIMUM_ISSUE_KG";
  issue_policy_value: number;
  reason: string;
};

type WcmMaterialIssueDraft = {
  material_id?: string;
  actual_issued_qty: string;
  actual_returned_qty: string;
  actual_scrap_qty: string;
  is_estimated: boolean;
  granule_code_allocations?: Array<{
    granule_code_id: string;
    source_location_id: string;
    qty_kg: string;
  }>;
};

function policyModeLabel(mode?: string | null, value?: number | null) {
  const normalized = String(mode || "NONE").toUpperCase();
  const safeValue = Number(value || 0);
  if (normalized === "PERCENT_OVER_THEORY") return `${safeValue}% over theory`;
  if (normalized === "FIXED_EXTRA_KG") return `+${safeValue} kg`;
  if (normalized === "MINIMUM_ISSUE_KG") return `Minimum ${safeValue} kg`;
  return "Template default";
}

function outputCaptureModeLabel(mode?: string | null) {
  const normalized = String(mode || "PROCESS_DEFAULT").toUpperCase();
  if (normalized === "KG_ONLY") return "Bulk KG only";
  if (normalized === "KG_AND_PCS") return "Bulk KG + PCS";
  if (normalized === "DISCRETE_ONLY") return "Discrete required";
  return "Template default";
}

const STOCK_FORM_LABELS: Record<string, string> = {
  OPEN_WEB: "Open web",
  LAYFLAT_TUBE: "Lay-flat tube",
  FOLDED_WEB: "Folded web",
};

const WIDTH_BASIS_LABELS: Record<string, string> = {
  OPEN_WEB_WIDTH: "open width",
  LAYFLAT_WIDTH: "lay-flat width",
  FOLDED_WIDTH: "folded width",
};

const WCM_OVERRIDE_REASON_PRESETS = [
  "Equivalent material approved by planner",
  "Exact roll unavailable, compatible width accepted",
  "Lineage WIP missing, fallback roll approved",
  "Split/remainder policy approved by supervisor",
  "Emergency release approved by plant manager",
];

const WCM_CLOSE_REASON_PRESETS: Record<"SHORT_CLOSE" | "CANCEL", string[]> = {
  SHORT_CLOSE: [
    "Customer accepted partial completion",
    "Material shortage after machine start",
    "Quality hold on remaining quantity",
    "Machine breakdown, close current output",
    "Planner stopped balance for reschedule",
  ],
  CANCEL: [
    "Planner cancelled before machine start",
    "Wrong job released to WCM",
    "Cylinder/artwork not ready",
    "Input material unavailable",
    "Machine assignment changed before start",
  ],
};

function stockFormLabel(value: unknown) {
  const key = String(value || "OPEN_WEB").toUpperCase();
  return STOCK_FORM_LABELS[key] || key.replace(/_/g, " ").toLowerCase();
}

function normalizeStockForm(value: unknown) {
  return String(value || "OPEN_WEB").toUpperCase();
}

function processCanUseRollForTarget(
  rollStockForm: unknown,
  targetStockForm: unknown,
  processCapabilities?: any,
) {
  const rollForm = normalizeStockForm(rollStockForm);
  const targetForm = targetStockForm ? normalizeStockForm(targetStockForm) : "";
  if (!targetForm) return true;

  const allowedInputs = Array.isArray(
    processCapabilities?.allowed_input_stock_forms,
  )
    ? processCapabilities.allowed_input_stock_forms
        .map(normalizeStockForm)
        .filter(Boolean)
    : [];
  const allowedOutputs = Array.isArray(
    processCapabilities?.allowed_output_stock_forms,
  )
    ? processCapabilities.allowed_output_stock_forms
        .map(normalizeStockForm)
        .filter(Boolean)
    : [];
  const outputMode = String(
    processCapabilities?.stock_form_output_mode || "PRESERVE",
  ).toUpperCase();

  if (allowedInputs.length && !allowedInputs.includes(rollForm)) return false;

  const resolvedOutput =
    outputMode === "TARGET_DECIDES" ||
    outputMode === "CONVERTS_FORM" ||
    outputMode === "OPERATOR_DECIDES"
      ? targetForm
      : rollForm;
  if (allowedOutputs.length && !allowedOutputs.includes(resolvedOutput))
    return false;
  return resolvedOutput === targetForm;
}

function widthBasisLabel(value: unknown) {
  const key = String(value || "").toUpperCase();
  return (
    WIDTH_BASIS_LABELS[key] ||
    (key ? key.replace(/_/g, " ").toLowerCase() : "stock width")
  );
}

function stockFormListLabel(values: unknown) {
  const rows = Array.isArray(values)
    ? values.map(stockFormLabel).filter(Boolean)
    : [];
  return rows.length ? rows.join(", ") : "Any configured form";
}

function toNullableNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function formatSmartValue(
  value: number | null,
  uom: "KG" | "PCS",
  digits?: number,
) {
  if (value === null) return "—";
  const precision = digits ?? (uom === "PCS" ? 0 : 3);
  return value.toLocaleString(undefined, {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  });
}

function formatDateLabel(value?: string | null) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return formatDisplayDate(parsed, String(value));
}

function firstNonEmpty(...values: unknown[]) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (
      text &&
      text !== "—" &&
      text.toLowerCase() !== "null" &&
      text.toLowerCase() !== "undefined"
    )
      return text;
  }
  return "";
}

function productionBatchLabel(row: any) {
  const batch = firstNonEmpty(
    row?.production_batch_number,
    row?.job_details?.production_batch_number,
  );
  return batch ? `Batch ${batch}` : "";
}

function routeNodeLabel(row: any) {
  const route = row?.route_node || row?.job_details?.route_node || {};
  const node = firstNonEmpty(
    route?.route_node_label,
    route?.label,
    route?.name,
    row?.route_node_id,
    row?.job_details?.route_node_id,
    route?.route_node_id,
    route?.id,
  );
  const branch = firstNonEmpty(
    row?.route_branch_key,
    row?.job_details?.route_branch_key,
    route?.route_branch_key,
    route?.branch_key,
  );
  return [node, branch && branch !== node ? branch : ""].filter(Boolean).join(" · ");
}

function assignmentHasMachineStart(assignment: any) {
  const job = assignment?.job_details || {};
  const assignmentStatus = String(assignment?.status || "").toUpperCase();
  const state = String(job?.job_state || "").toUpperCase();
  const status = String(job?.status || "").toUpperCase();
  // Started work counts as running whether the WCM pressed release or the operator started it
  // straight from the machine terminal (allowed once a machine is assigned).
  return (
    ["EXECUTION_READY", "ASSIGNED", "WC_READY"].includes(assignmentStatus) &&
    Boolean(assignment?.assigned_machine) &&
    (state === "EXECUTING" || state === "PAUSED" || status === "RUNNING")
  );
}

function assignmentIsMachineReady(assignment: any) {
  const assignmentStatus = String(assignment?.status || "").toUpperCase();
  const hasMachine = Boolean(assignment?.assigned_machine);
  if (assignmentHasMachineStart(assignment)) return true;
  return assignmentStatus === "EXECUTION_READY" && hasMachine;
}

function productNameFromJob(job: any, context?: any) {
  return normalizeProductSpec(job, context).productName;
}

function geometryFromJob(job: any, context?: any) {
  const spec = normalizeProductSpec(job, context);
  return {
    width: spec.size.widthMm != null ? String(spec.size.widthMm) : "",
    height: spec.size.heightMm != null ? String(spec.size.heightMm) : "",
    gusset: spec.size.gussetMm != null ? String(spec.size.gussetMm) : "",
    area: "",
    label: spec.size.label,
  };
}

function layerHighlightsFromJob(job: any, context?: any) {
  return normalizeProductSpec(job, context)
    .layers.slice(0, 4)
    .map((layer) => layerQueueLabel(layer));
}

function layerQueueLabel(layer: any) {
  return [
    firstNonEmpty(
      layer.variantName,
      layer.variant_name,
      layer.name,
      `Layer ${layer.index || ""}`,
    ),
    firstNonEmpty(layer.grade, layer.grade_name),
    layer.thicknessMicron != null
      ? `${layer.thicknessMicron}u`
      : firstNonEmpty(layer.thickness_micron, layer.thickness)
        ? `${firstNonEmpty(layer.thickness_micron, layer.thickness)}u`
        : "",
    layer.widthMm != null
      ? `${layer.widthMm}mm`
      : firstNonEmpty(layer.width_mm, layer.roll_width_mm)
        ? `${firstNonEmpty(layer.width_mm, layer.roll_width_mm)}mm`
        : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Numbered dossier card header: 1 What it is · 2 What it needs · 3 Ready? · 4 Where from. */
function DossierHeader({ n, title, sub, right }: { n: string; title: string; sub?: string; right?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 flex-none place-items-center rounded-xl bg-primary font-mono text-base font-bold text-white shadow-sm">{n}</span>
        <div>
          <div className="text-lg font-semibold leading-tight text-content-1">{title}</div>
          {sub ? <div className="mt-0.5 text-xs font-medium text-content-3">{sub}</div> : null}
        </div>
      </div>
      {right ? <div className="flex flex-wrap items-center gap-2">{right}</div> : null}
    </div>
  );
}

function QueueFacetSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: ProductionFacetOption[];
  onChange: (value: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={`Filter by ${label}`} className="h-9 min-w-[150px] flex-1 rounded-lg border border-line bg-surface-1 text-xs font-semibold text-content-2">
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_PRODUCTION_FACET}>All {label}</SelectItem>
        {options.map((option) => (
          <SelectItem key={`${label}-${option.value}`} value={option.value}>
            {option.label} · {option.count}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function materialIssueUom(row: any) {
  const unit = String(row?.uom || row?.mode || "KG").toUpperCase();
  return ["KG", "PCS", "METER"].includes(unit) ? unit : "KG";
}

function materialIssueQtyLabel(value: unknown, row: any, digits = 3) {
  const unit = materialIssueUom(row);
  const qty = Number(value || 0);
  const formatted = Number.isFinite(qty)
    ? qty.toFixed(unit === "PCS" ? 0 : digits)
    : "0";
  return `${formatted} ${unit.toLowerCase()}`;
}

function materialIssueTargetKg(row: any) {
  const candidates = [
    row?.planned_issue_qty,
    row?.required_qty,
    row?.estimated_qty,
    row?.theoretical_qty,
    row?.estimated_actual_qty,
    row?.actual_issued_qty,
    row?.planned_issue_qty_kg,
    row?.required_qty_kg,
    row?.estimated_qty_kg,
    row?.theoretical_qty_kg,
    row?.estimated_actual_qty_kg,
    row?.actual_issued_qty_kg,
  ];
  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return 0;
}

function materialIssueAvailableKg(row: any) {
  const candidates = [
    row?.source_location_available_qty,
    row?.available_qty,
    row?.current_plant_available_qty,
    row?.plant_available_qty,
    row?.global_available_qty,
    row?.source_location_available_qty_kg,
    row?.available_qty_kg,
    row?.current_plant_available_qty_kg,
    row?.plant_available_qty_kg,
    row?.global_available_qty_kg,
  ];
  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  return 0;
}

function materialIssueKind(row: any) {
  const category = String(
    row?.category || row?.category_code || "",
  ).toUpperCase();
  if (category === "GRANULE") return "GRANULE";
  if (category.includes("INK")) return "INK";
  if (category.includes("SOLVENT")) return "SOLVENT";
  if (category.includes("ADHESIVE")) return "ADHESIVE";
  if (category.includes("ROLL")) return "ROLL";
  return category || "BULK";
}

function materialIssueKindLabel(row: any) {
  const kind = materialIssueKind(row);
  if (kind === "GRANULE") return "Granule";
  if (kind === "ADHESIVE") return "Adhesive";
  if (kind === "SOLVENT") return "Solvent";
  if (kind === "INK") return "Ink";
  if (kind === "ROLL") return "Roll input";
  return "Bulk";
}

function materialSpecsFromJob(job: any, context?: any) {
  const specRows = normalizeProductSpec(job, context).layers;
  if (specRows.length) {
    return specRows.map((layer) => ({
      material: firstNonEmpty(
        layer.variantName,
        layer.variantCode,
        `Layer ${layer.index}`,
      ),
      code: layer.variantCode,
      thickness:
        layer.thicknessMicron != null ? String(layer.thicknessMicron) : "",
      grade: layer.grade || "Grade not set",
      width: layer.widthMm != null ? String(layer.widthMm) : "",
      qty: "",
      source: "Order spec",
    }));
  }
  const bom = context?.bom_snapshot || job?.bom_snapshot || {};
  const layers =
    Array.isArray(context?.bom_layers) && context.bom_layers.length
      ? context.bom_layers
      : Array.isArray(job?.layers)
        ? job.layers
        : [];
  const films = Array.isArray(bom?.films) ? bom.films : [];
  const planningLines = Array.isArray(bom?.planning_lines)
    ? bom.planning_lines
    : [];
  const geometry = geometryFromJob(job, context);
  const rows = layers.map((layer: any, idx: number) => {
    const film =
      films.find((item: any) => {
        const sameVariant =
          item?.variant_id &&
          layer?.variant_id &&
          String(item.variant_id) === String(layer.variant_id);
        const sameFamily =
          item?.family_id &&
          layer?.family_id &&
          String(item.family_id) === String(layer.family_id);
        const sameThickness =
          Number(item?.thickness_micron || 0) ===
          Number(layer?.thickness_micron || layer?.thickness || 0);
        return (
          sameVariant ||
          (sameFamily && (sameThickness || !layer?.thickness_micron))
        );
      }) ||
      films[idx] ||
      {};
    const policyKey = firstNonEmpty(
      film?.code,
      film?.material_code,
      layer?.code,
    );
    const plan =
      planningLines.find((item: any) => {
        const code = firstNonEmpty(item?.material_code, item?.policy_key);
        return policyKey && code.includes(policyKey);
      }) ||
      planningLines[idx] ||
      {};
    const material = firstNonEmpty(
      layer?.variant_name,
      layer?.material_name,
      film?.material_name,
      film?.code,
      plan?.material_name,
      plan?.material_code,
      layer?.name && layer.name !== "Material" ? layer.name : "",
      `Layer ${idx + 1}`,
    );
    const width = firstNonEmpty(
      Number(layer?.roll_width_mm || 0) > 0 ? layer.roll_width_mm : "",
      layer?.width_mm,
      film?.width_mm,
      geometry.width,
    );
    return {
      material,
      code: firstNonEmpty(film?.code, plan?.material_code, layer?.code),
      thickness: firstNonEmpty(
        layer?.thickness_micron,
        layer?.thickness,
        film?.thickness_micron,
      ),
      grade: firstNonEmpty(
        layer?.grade_name,
        layer?.grade,
        film?.grade_name,
        "Grade not set",
      ),
      width,
      qty: firstNonEmpty(
        plan?.planned_issue_qty,
        film?.weight_kg,
        layer?.weight_kg,
      ),
      source: firstNonEmpty(film?.source, plan?.policy_source, "Template"),
    };
  });
  if (rows.length === 0 && films.length > 0) {
    return films.map((film: any, idx: number) => {
      const plan =
        planningLines.find((item: any) =>
          firstNonEmpty(item?.material_code, item?.policy_key).includes(
            firstNonEmpty(film?.code),
          ),
        ) ||
        planningLines[idx] ||
        {};
      return {
        material: firstNonEmpty(
          film?.material_name,
          film?.code,
          plan?.material_name,
          `Film ${idx + 1}`,
        ),
        code: firstNonEmpty(film?.code, plan?.material_code),
        thickness: firstNonEmpty(film?.thickness_micron),
        grade: firstNonEmpty(film?.grade_name, "Grade not set"),
        width: firstNonEmpty(film?.width_mm, geometry.width),
        qty: firstNonEmpty(plan?.planned_issue_qty, film?.weight_kg),
        source: firstNonEmpty(film?.source, plan?.policy_source, "Template"),
      };
    });
  }
  return rows;
}

const QUEUE_SORT_OPTIONS: Array<[string, string]> = [
  ["PRIORITY_ASC", "Priority · highest first"],
  ["PRIORITY_DESC", "Priority · lowest first"],
  ["SO_DATE", "SO date · oldest first"],
  ["CUSTOMER", "Customer (A→Z)"],
  ["MACHINE", "Machine (A→Z)"],
];

type WcmStepKey = "order" | "machine" | "rolls" | "issue" | "release";
type WcmStepState = "ok" | "warn" | "bad" | "lock" | "skip" | "todo";

function WcmStepBadge({ state, no }: { state: WcmStepState; no: string }) {
  return (
    <span
      className={cn(
        "grid h-[22px] w-[22px] shrink-0 place-items-center rounded-full text-[11px] font-bold",
        state === "ok"
          ? "bg-success-fg text-white"
          : state === "warn"
            ? "bg-warning-fg text-white"
            : state === "bad"
              ? "bg-danger-fg text-white"
              : state === "lock"
                ? "bg-content-1 text-surface-1"
                : "bg-surface-2 text-content-3 ring-1 ring-line",
      )}
      aria-hidden
    >
      {state === "ok" ? <Check className="size-3" strokeWidth={3} /> : state === "lock" ? <Lock className="size-3" /> : state === "skip" ? "–" : no}
    </span>
  );
}

/** A figure tile of the job pane (Ordered / Produced / Remaining / Blockers …). */
function WcmStat({
  label,
  value,
  unit,
  sub,
  tone,
  testId,
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  sub?: React.ReactNode;
  tone?: "info" | "wait" | "block" | "done";
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className={cn(
        "min-w-0 rounded-xl border px-3 py-2",
        tone === "info"
          ? "border-info-border bg-info-bg"
          : tone === "wait"
            ? "border-warning-border bg-warning-bg"
            : tone === "block"
              ? "border-danger-border bg-danger-bg"
              : tone === "done"
                ? "border-success-border bg-success-bg"
                : "border-line bg-surface-1",
      )}
    >
      <div className="truncate text-[11.5px] font-medium text-content-3">{label}</div>
      <div
        className={cn(
          "mt-0.5 truncate font-mono text-[19px] font-bold leading-tight tabular-nums",
          tone === "info" ? "text-primary" : tone === "wait" ? "text-warning-fg" : tone === "block" ? "text-danger-fg" : "text-content-1",
        )}
      >
        {value}
        {unit ? <span className="ml-0.5 font-sans text-[11px] font-semibold text-content-3">{unit}</span> : null}
      </div>
      {sub ? <div className="mt-0.5 truncate text-[11px] text-content-3">{sub}</div> : null}
    </div>
  );
}

/** One step of the job pane: a header that says its state in one line, and its body when open. */
function WcmStepSection({
  id,
  no,
  title,
  summary,
  state,
  open,
  onToggle,
  testId,
  right,
  children,
}: {
  id: string;
  no: string;
  title: string;
  summary: string;
  state: WcmStepState;
  open: boolean;
  onToggle: () => void;
  testId?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      id={`wcm-step-${id}`}
      data-state={state}
      data-testid={testId}
      className="scroll-mt-2 overflow-hidden rounded-2xl border border-line bg-surface-1 shadow-[var(--shadow-sm)] data-[state=bad]:border-danger-border"
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        data-testid={`wcm-step-toggle-${id}`}
        className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-surface-2/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <WcmStepBadge state={state} no={no} />
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-semibold text-content-1">{title}</span>
          <span className="block truncate text-[12px] text-content-3">{summary}</span>
        </span>
        {right ? <span className="shrink-0">{right}</span> : null}
        <ChevronDown className={cn("size-4 shrink-0 text-content-3 transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open ? <div className="space-y-3 border-t border-line p-3.5">{children}</div> : null}
    </section>
  );
}

export default function WCMTerminal() {
  const params = useParams();
  const wcId = params?.id as string;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user, effectiveRole, loading: authLoading } = useAuth();
  const userRole = effectiveRole || user?.role_info?.code;
  const isManager = [
    "WORK_CENTER_MANAGER",
    "ADMIN",
    "OWNER",
    "SUPER_ADMIN",
  ].includes(userRole || "");
  const userPermissions: string[] = (user?.entitlements?.permissions ||
    []) as string[];
  const isSuperuser = Boolean(user?.is_superuser || user?.is_owner);
  const hasProductionAccess =
    isSuperuser ||
    userPermissions.includes("production.view") ||
    userPermissions.includes("production.manage") ||
    [
      "WORK_CENTER_MANAGER",
      "OPERATOR",
      "PLANT_MANAGER",
      "ADMIN",
      "OWNER",
      "SUPER_ADMIN",
    ].includes(userRole || "");

  const [activeAssignmentId, setActiveAssignmentId] = useState<string | null>(
    null,
  );
  const [activeMainTab, setActiveMainTab] = useState<
    "terminal" | "running" | "history" | "stalled"
  >("terminal");
  const [selectedMachineId, setSelectedMachineId] = useState<string>("");
  const [manualOverrideEnabled, setManualOverrideEnabled] = useState(false);
  const [tieredPickerOpen, setTieredPickerOpen] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [stepPolicyDrafts, setStepPolicyDrafts] = useState<
    Record<string, StepPolicyDraft>
  >({});
  const [activeStepPolicyOverrides, setActiveStepPolicyOverrides] = useState<
    Record<string, boolean>
  >({});
  const [materialIssueDrafts, setMaterialIssueDrafts] = useState<
    Record<string, WcmMaterialIssueDraft>
  >({});
  const [materialIssueDirty, setMaterialIssueDirty] = useState(false);
  const materialIssueDraftVersionRef = useRef(0);
  const [materialIssuePickerOpen, setMaterialIssuePickerOpen] = useState(false);
  // Granule family whose grade-code popup is open (requirement id).
  const [codesFor, setCodesFor] = useState<string | null>(null);
  const [openSteps, setOpenSteps] = useState<Record<string, string[]>>({});
  const hydratedMaterialJobRef = useRef("");
  const hydratedMaterialSignatureRef = useRef("");
  const [transferQtyDrafts, setTransferQtyDrafts] = useState<
    Record<string, string>
  >({});
  // Per-requirement explicit confirmation that an over-pick (>120% of target) is intended.
  const [overPickConfirms, setOverPickConfirms] = useState<
    Record<string, boolean>
  >({});
  const [queueSearch, setQueueSearch] = useState("");
  const [queueStatusFilter, setQueueStatusFilter] = useState<
    "ALL" | "READY" | "ASSIGNED" | "NEEDS_MACHINE"
  >("ALL");
  const [queueMaterialFilter, setQueueMaterialFilter] = useState(
    ALL_PRODUCTION_FACET,
  );
  const [queueGradeFilter, setQueueGradeFilter] = useState(
    ALL_PRODUCTION_FACET,
  );
  const [queueThicknessFilter, setQueueThicknessFilter] = useState(
    ALL_PRODUCTION_FACET,
  );
  const [queueSizeFilter, setQueueSizeFilter] = useState(
    ALL_PRODUCTION_FACET,
  );
  const [queueProcessFilter, setQueueProcessFilter] = useState(
    ALL_PRODUCTION_FACET,
  );
  // Queue + job pane fill the screen under the page head; the panels scroll inside.
  const panelsRef = useRef<HTMLElement | null>(null);
  const [panelsHeight, setPanelsHeight] = useState<number | null>(null);
  useEffect(() => {
    const measure = () => {
      const el = panelsRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      setPanelsHeight(Math.max(460, Math.floor(window.innerHeight - top - 12)));
    };
    measure();
    const frame = window.requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", measure);
    };
  });
  const [queueSortKey, setQueueSortKey] = useState<
    "PRIORITY_ASC" | "PRIORITY_DESC" | "SO_DATE" | "CUSTOMER" | "MACHINE"
  >("PRIORITY_ASC");
  const [historySearch, setHistorySearch] = useState("");
  const [historyStatusFilter, setHistoryStatusFilter] = useState("ALL");
  const [historyDaysFilter, setHistoryDaysFilter] = useState("30");
  const [queuePage, setQueuePage] = useState(1);
  const [runningPage, setRunningPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const savedWcmViewQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (activeMainTab !== "terminal") params.set("tab", activeMainTab);
    if (queueSearch.trim()) params.set("search", queueSearch.trim());
    if (queueStatusFilter !== "ALL") params.set("status", queueStatusFilter);
    if (queueSortKey !== "PRIORITY_ASC") params.set("sort", queueSortKey);
    if (queueMaterialFilter !== ALL_PRODUCTION_FACET) params.set("material", queueMaterialFilter);
    if (queueGradeFilter !== ALL_PRODUCTION_FACET) params.set("grade", queueGradeFilter);
    if (queueThicknessFilter !== ALL_PRODUCTION_FACET) params.set("thickness", queueThicknessFilter);
    if (queueSizeFilter !== ALL_PRODUCTION_FACET) params.set("size", queueSizeFilter);
    if (queueProcessFilter !== ALL_PRODUCTION_FACET) params.set("process", queueProcessFilter);
    if (historySearch.trim()) params.set("historySearch", historySearch.trim());
    if (historyStatusFilter !== "ALL") params.set("historyStatus", historyStatusFilter);
    if (historyDaysFilter !== "30") params.set("historyDays", historyDaysFilter);
    return params.toString();
  }, [
    activeMainTab,
    historyDaysFilter,
    historySearch,
    historyStatusFilter,
    queueGradeFilter,
    queueMaterialFilter,
    queueProcessFilter,
    queueSearch,
    queueSizeFilter,
    queueSortKey,
    queueStatusFilter,
    queueThicknessFilter,
  ]);
  function applySavedWcmView(query: string) {
    const params = new URLSearchParams(query || "");
    const nextTab = params.get("tab") || "terminal";
    setActiveMainTab((["terminal", "running", "history", "stalled"].includes(nextTab) ? nextTab : "terminal") as typeof activeMainTab);
    setQueueSearch(params.get("search") || "");
    setQueueStatusFilter((["ALL", "READY", "ASSIGNED", "NEEDS_MACHINE"].includes(params.get("status") || "ALL") ? params.get("status") || "ALL" : "ALL") as typeof queueStatusFilter);
    setQueueSortKey((["PRIORITY_ASC", "PRIORITY_DESC", "SO_DATE", "CUSTOMER", "MACHINE"].includes(params.get("sort") || "PRIORITY_ASC") ? params.get("sort") || "PRIORITY_ASC" : "PRIORITY_ASC") as typeof queueSortKey);
    setQueueMaterialFilter(params.get("material") || ALL_PRODUCTION_FACET);
    setQueueGradeFilter(params.get("grade") || ALL_PRODUCTION_FACET);
    setQueueThicknessFilter(params.get("thickness") || ALL_PRODUCTION_FACET);
    setQueueSizeFilter(params.get("size") || ALL_PRODUCTION_FACET);
    setQueueProcessFilter(params.get("process") || ALL_PRODUCTION_FACET);
    setHistorySearch(params.get("historySearch") || "");
    setHistoryStatusFilter(params.get("historyStatus") || "ALL");
    setHistoryDaysFilter(params.get("historyDays") || "30");
    setQueuePage(1);
    setRunningPage(1);
    setHistoryPage(1);
  }
  const [closeJobAction, setCloseJobAction] = useState<{
    assignment: any;
    mode: "SHORT_CLOSE" | "CANCEL";
  } | null>(null);
  const [closeJobReason, setCloseJobReason] = useState("");
  const [closeJobReasonPreset, setCloseJobReasonPreset] = useState("");
  const [skipNextStepAction, setSkipNextStepAction] = useState<{
    previousJob: any;
    option: any;
  } | null>(null);
  const [skipNextStepReason, setSkipNextStepReason] = useState("");
  // Tablet (md..xl): the side detail pane opens as a Sheet instead of a tall column.
  const [detailSheetOpen, setDetailSheetOpen] = useState(false);
  // Inline assign-machine conflict (HTTP 409) — surfaced under the machine Select.
  const [assignConflict, setAssignConflict] = useState<string | null>(null);
  // Live header clock; ticks every second.
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  const autoAssignRef = useRef<Set<string>>(new Set());

  // Connectivity for factory tablets: navigator.onLine + last-successful-sync clock.
  const { online, markSynced, secondsSinceSync } = useOnlineStatus();
  const isStaleSync = secondsSinceSync > 30;

  // Live header clock; one cheap state update per second.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const id = window.setInterval(() => setNowTick(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  // xl and up shows the inline detail column; below xl the detail opens as a Sheet.
  const [isWideViewport, setIsWideViewport] = useState(true);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(min-width: 1280px)");
    const apply = () => setIsWideViewport(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  // Never leave the tablet Sheet open once the layout switches to the wide column.
  useEffect(() => {
    if (isWideViewport && detailSheetOpen) setDetailSheetOpen(false);
  }, [isWideViewport, detailSheetOpen]);

  // 1. Data Fetching
  const deferredQueueSearch = useDeferredValue(queueSearch.trim());
  const {
    data: assignments,
    isLoading,
    isError: queueIsError,
    isLoadingError: queueIsLoadingError,
    isRefetchError: queueIsRefetchError,
    error: queueError,
    refetch: refetchQueue,
    dataUpdatedAt: queueUpdatedAt,
  } = useQuery({
    queryKey: ["wcm-queue", wcId, deferredQueueSearch],
    queryFn: ({ signal }) => wcmService.getQueue(wcId, 300, deferredQueueSearch, signal),
    refetchInterval:
      materialIssueDirty || materialIssuePickerOpen ? false : 30000,
    placeholderData: keepPreviousData,
  });

  // Record a healthy refetch for the connection banner / "Synced Ns ago".
  useEffect(() => {
    if (queueUpdatedAt) markSynced();
  }, [queueUpdatedAt, markSynced]);
  const secondsSinceQueueSync = queueUpdatedAt
    ? Math.max(0, Math.floor((nowTick - queueUpdatedAt) / 1000))
    : null;

  // Live company-wide shift inference (CompanyProfile.shift_boundaries).
  const { data: currentShift } = useQuery<{
    shift_code: string;
    started_at: string | null;
    ends_at: string | null;
  }>({
    queryKey: ["production-current-shift"],
    queryFn: async () => {
      const { data } = await api.get("/api/production/current-shift/");
      return data;
    },
    // Re-poll roughly every 5 min to catch shift roll-over.
    refetchInterval: 5 * 60 * 1000,
    staleTime: 60 * 1000,
  });
  const shiftLabel = currentShift?.shift_code
    ? `Shift ${currentShift.shift_code}`
    : "Shift —";

  const { data: workCenter } = useQuery({
    queryKey: ["work-center", wcId],
    queryFn: async () => {
      const { data } = await api.get(`/api/factory/work-centers/${wcId}/`);
      return data;
    },
  });

  const { data: historyJobs, isLoading: isLoadingHistory } = useQuery({
    queryKey: [
      "wcm-history",
      wcId,
      historySearch,
      historyStatusFilter,
      historyDaysFilter,
    ],
    queryFn: () =>
      wcmService.getHistory(wcId, {
        q: historySearch.trim() || undefined,
        status: historyStatusFilter,
        days:
          historyDaysFilter === "ALL" ? null : Number(historyDaysFilter || 30),
        limit: 300,
      }),
    refetchInterval: 120000, // History is a side panel; it does not need to poll every 30 s
    enabled: activeMainTab === "history",
  });

  const { data: wcStats, isLoading: isLoadingStats } = useQuery({
    queryKey: ["wcm-stats", wcId],
    queryFn: () => wcmService.getStats(wcId),
    refetchInterval:
      materialIssueDirty || materialIssuePickerOpen ? false : 60000,
    placeholderData: keepPreviousData,
  });

  // Read-only stalled-jobs surface (replacement for auto-pause), scoped to this WC.
  const {
    data: stalledJobs,
    isLoading: isLoadingStalled,
    isFetching: isFetchingStalled,
    refetch: refetchStalled,
  } = useQuery<StalledJob[]>({
    queryKey: ["wcm-stalled-jobs", wcId],
    queryFn: () => wcmService.getStalledJobs({ work_center: wcId }),
    refetchInterval: 60000,
    placeholderData: keepPreviousData,
  });
  const stalledJobsList = Array.isArray(stalledJobs) ? stalledJobs : [];

  const { data: machines } = useQuery({
    queryKey: ["wc-machines", wcId],
    queryFn: async () => {
      const { data } = await api.get(
        `/api/factory/machines/?work_center=${wcId}`,
      );
      if (Array.isArray(data)) return data;
      if (
        data &&
        typeof data === "object" &&
        Array.isArray((data as any).results)
      )
        return (data as any).results;
      return [];
    },
  });
  const machineOptions = useMemo(() => {
    const list = Array.isArray(machines) ? machines : [];
    return list
      .map((m: any) => {
        const rawState = String(m?.state || "").toUpperCase();
        const state: MachineLiveState =
          rawState === "RUNNING"
            ? "RUNNING"
            : rawState === "DOWN"
              ? "DOWN"
              : "IDLE";
        return {
          id: String(m?.id || ""),
          name: String(m?.name || m?.code || "Machine"),
          state,
          current_job_number: m?.current_job_number ?? null,
          busy_until: m?.busy_until ?? null,
        };
      })
      .filter((m: any) => m.id);
  }, [machines]);
  const machineStateById = useMemo(() => {
    const map = new Map<
      string,
      { state: MachineLiveState; current_job_number: string | null }
    >();
    machineOptions.forEach((m: any) => {
      map.set(String(m.id), {
        state: m.state,
        current_job_number: m.current_job_number,
      });
    });
    return map;
  }, [machineOptions]);
  const assignmentsList = Array.isArray(assignments) ? assignments : [];
  const activeAssignments = useMemo(
    () =>
      assignmentsList.filter((a: any) => {
        const state = String(a?.job_details?.job_state || "").toUpperCase();
        const status = String(a?.job_details?.status || "").toUpperCase();
        return (
          state !== "COMPLETED" &&
          state !== "CANCELLED" &&
          status !== "COMPLETED" &&
          status !== "CANCELLED"
        );
      }),
    [assignmentsList],
  );
  const runningAssignments = useMemo(
    () => activeAssignments.filter((a: any) => assignmentIsMachineReady(a)),
    [activeAssignments],
  );
  const baseQueueAssignments = useMemo(
    () =>
      activeAssignments.filter((a: any) => {
        const status = String(a?.status || "").toUpperCase();
        if (assignmentIsMachineReady(a)) return false;
        return (
          status === "WC_READY" ||
          status === "ASSIGNED" ||
          status === "EXECUTION_READY"
        );
      }),
    [activeAssignments],
  );
  const queueFacetFilters = useMemo<ProductionFacetFilters>(
    () => ({
      material: queueMaterialFilter,
      grade: queueGradeFilter,
      thickness: queueThicknessFilter,
      size: queueSizeFilter,
      process: queueProcessFilter,
    }),
    [
      queueMaterialFilter,
      queueGradeFilter,
      queueThicknessFilter,
      queueSizeFilter,
      queueProcessFilter,
    ],
  );
  const queueFacetOptions = useMemo(() => {
    const rows = activeAssignments as any[];
    return {
      material: buildProductionFacetOptions(rows, (assignment) =>
        productionFacetValues(assignment?.job_details || {}).material,
      ),
      grade: buildProductionFacetOptions(rows, (assignment) =>
        productionFacetValues(assignment?.job_details || {}).grade,
      ),
      thickness: buildProductionFacetOptions(rows, (assignment) =>
        productionFacetValues(assignment?.job_details || {}).thickness,
      ),
      size: buildProductionFacetOptions(rows, (assignment) =>
        productionFacetValues(assignment?.job_details || {}).size,
      ),
      process: buildProductionFacetOptions(rows, (assignment) =>
        productionFacetValues(assignment?.job_details || {}).process,
      ),
    };
  }, [activeAssignments]);
  const queueHasFacetFilters = hasProductionFacetFilters(queueFacetFilters);
  const visibleQueueAssignments = useMemo(() => {
    const filtered = baseQueueAssignments.filter((assignment: any) => {
      const job = assignment?.job_details || {};
      const status = String(assignment?.status || "").toUpperCase();
      const hasMachine = Boolean(assignment?.assigned_machine);
      if (queueStatusFilter === "READY" && status !== "WC_READY") return false;
      if (queueStatusFilter === "ASSIGNED" && status !== "ASSIGNED")
        return false;
      if (queueStatusFilter === "NEEDS_MACHINE" && hasMachine) return false;
      if (!matchesProductionFacets(job, queueFacetFilters)) return false;

      const search = queueSearch.trim().toLowerCase();
      if (!search) return true;
      const spec = normalizeProductSpec(job);
      return [
        spec.searchText,
        job?.job_number,
        job?.process_code,
        assignment?.assigned_machine_name,
      ]
        .join(" ")
        .toLowerCase()
        .includes(search);
    });

    const sorted = [...filtered];
    const cmpString = (a: string, b: string) =>
      a.localeCompare(b, undefined, { sensitivity: "base" });
    sorted.sort((a: any, b: any) => {
      const ja = a?.job_details || {};
      const jb = b?.job_details || {};
      if (queueSortKey === "PRIORITY_ASC")
        return Number(ja.priority ?? 999) - Number(jb.priority ?? 999);
      if (queueSortKey === "PRIORITY_DESC")
        return Number(jb.priority ?? 999) - Number(ja.priority ?? 999);
      if (queueSortKey === "SO_DATE") {
        const da = new Date(ja.order_placed_at || ja.created_at || 0).getTime();
        const db = new Date(jb.order_placed_at || jb.created_at || 0).getTime();
        return da - db;
      }
      if (queueSortKey === "CUSTOMER")
        return cmpString(
          String(ja.customer_name || ""),
          String(jb.customer_name || ""),
        );
      if (queueSortKey === "MACHINE")
        return cmpString(
          String(a?.assigned_machine_name || ""),
          String(b?.assigned_machine_name || ""),
        );
      return 0;
    });
    return sorted;
  }, [
    baseQueueAssignments,
    queueSearch,
    queueStatusFilter,
    queueSortKey,
    queueFacetFilters,
  ]);
  const visibleRunningAssignments = useMemo(
    () =>
      runningAssignments.filter((assignment: any) => {
        const job = assignment?.job_details || {};
        if (!matchesProductionFacets(job, queueFacetFilters)) return false;
        const search = queueSearch.trim().toLowerCase();
        if (!search) return true;
        const spec = normalizeProductSpec(job);
        return [
          spec.searchText,
          job?.job_number,
          job?.process_code,
          assignment?.assigned_machine_name,
        ]
          .join(" ")
          .toLowerCase()
          .includes(search);
      }),
    [runningAssignments, queueSearch, queueFacetFilters],
  );
  const queuePageSize = 30;
  const historyPageSize = 30;
  const queuePageCount = Math.max(
    1,
    Math.ceil(visibleQueueAssignments.length / queuePageSize),
  );
  const runningPageCount = Math.max(
    1,
    Math.ceil(visibleRunningAssignments.length / queuePageSize),
  );
  const historyPageCount = Math.max(
    1,
    Math.ceil(((historyJobs || []) as any[]).length / historyPageSize),
  );
  const pagedQueueAssignments = visibleQueueAssignments.slice(
    (queuePage - 1) * queuePageSize,
    queuePage * queuePageSize,
  );
  const pagedRunningAssignments = visibleRunningAssignments.slice(
    (runningPage - 1) * queuePageSize,
    runningPage * queuePageSize,
  );
  const pagedHistoryJobs = ((historyJobs || []) as any[]).slice(
    (historyPage - 1) * historyPageSize,
    historyPage * historyPageSize,
  );
  const activeAssignmentPool =
    activeMainTab === "running"
      ? visibleRunningAssignments
      : visibleQueueAssignments;
  const summaryActiveAssignment = activeAssignmentId
    ? activeAssignmentPool.find((a) => a.id === activeAssignmentId) || null
    : null;
  const { data: activeAssignmentDetail } = useQuery({
    queryKey: ["wcm-assignment-detail", wcId, activeAssignmentId],
    queryFn: ({ signal }) => wcmService.getAssignment(wcId, activeAssignmentId!, signal),
    enabled: Boolean(wcId && activeAssignmentId),
    placeholderData: () => undefined,
    staleTime: 3000,
  });
  const activeAssignment =
    activeAssignmentDetail &&
    String(activeAssignmentDetail.id) === String(activeAssignmentId)
      ? {
          ...(summaryActiveAssignment || {}),
          ...activeAssignmentDetail,
          job_details: {
            ...((summaryActiveAssignment as any)?.job_details || {}),
            ...((activeAssignmentDetail as any)?.job_details || {}),
          },
        }
      : summaryActiveAssignment;
  const selectedJobId = activeAssignment?.production_job
    ? String(activeAssignment.production_job)
    : "";
  const assignedMachineId = activeAssignment?.assigned_machine
    ? String(activeAssignment.assigned_machine)
    : "";
  const assignedMachineName = (activeAssignment as any)?.assigned_machine_name
    ? String((activeAssignment as any).assigned_machine_name)
    : "";
  const machineOptionsResolved = useMemo(() => {
    const base = Array.isArray(machineOptions) ? [...machineOptions] : [];
    if (
      assignedMachineId &&
      !base.some((m: any) => String(m.id) === assignedMachineId)
    ) {
      base.unshift({
        id: assignedMachineId,
        name: assignedMachineName || `Machine ${assignedMachineId.slice(0, 8)}`,
        state: "IDLE" as MachineLiveState,
        current_job_number: null,
        busy_until: null,
      });
    }
    return base;
  }, [machineOptions, assignedMachineId, assignedMachineName]);

  useEffect(() => {
    // Keep selection stable across polling and recover if selected job disappears.
    if (activeMainTab === "history" || activeMainTab === "stalled") return;
    if (!activeAssignmentPool.length) {
      setActiveAssignmentId(null);
      return;
    }
    if (!activeAssignmentId) {
      setActiveAssignmentId(activeAssignmentPool[0].id);
      return;
    }
    if (!activeAssignmentPool.some((a) => a.id === activeAssignmentId)) {
      if (materialIssueDirty || materialIssuePickerOpen) return;
      setActiveAssignmentId(activeAssignmentPool[0].id);
    }
  }, [activeAssignmentPool, activeAssignmentId, activeMainTab, materialIssueDirty, materialIssuePickerOpen]);

  useEffect(() => {
    setQueuePage(1);
    setRunningPage(1);
  }, [
    queueSearch,
    queueStatusFilter,
    queueMaterialFilter,
    queueGradeFilter,
    queueThicknessFilter,
    queueSizeFilter,
    queueProcessFilter,
  ]);

  useEffect(() => {
    setHistoryPage(1);
  }, [historySearch, historyStatusFilter, historyDaysFilter]);

  useEffect(() => {
    // Sync machine selector from latest assignment payload whenever selected job changes.
    if (activeAssignment) {
      if (activeAssignment.assigned_machine) {
        setSelectedMachineId(String(activeAssignment.assigned_machine));
      } else if (!selectedMachineId) {
        setSelectedMachineId("");
      }
    } else {
      setSelectedMachineId("");
    }
  }, [
    activeAssignment?.id,
    activeAssignment?.assigned_machine,
    selectedMachineId,
  ]);

  useEffect(() => {
    setManualOverrideEnabled(false);
    setOverrideReason("");
    setAssignConflict(null);
  }, [activeAssignment?.id]);

  // Clear a stale conflict the moment the operator picks a different machine.
  useEffect(() => {
    setAssignConflict(null);
  }, [selectedMachineId]);

  // Execution Context (Flow Engine)
  const {
    data: executionContextResponse,
    refetch: refetchContext,
  } = useQuery({
    queryKey: ["execution-context", selectedJobId],
    queryFn: ({ signal }) => wcmService.getJobContext(selectedJobId, signal),
    enabled: !!selectedJobId,
    // The app-wide query default keeps previous data during key changes. That
    // is useful for lists, but unsafe for a job execution contract: it can show
    // the previous order's target and material state beneath the newly selected
    // order. Fail closed until this job's own context arrives.
    placeholderData: () => undefined,
    refetchInterval:
      materialIssueDirty || materialIssuePickerOpen ? false : 30000,
    refetchOnWindowFocus: !(materialIssueDirty || materialIssuePickerOpen),
  });
  const executionContext = useMemo(() => {
    const contextJobId = String(
      (executionContextResponse as any)?.job?.id || "",
    );
    return contextJobId && contextJobId === selectedJobId
      ? executionContextResponse
      : undefined;
  }, [executionContextResponse, selectedJobId]);

  // Phase 68: Satisfaction Status (Universal Flow Engine)
  const { data: satisfactionStatus, refetch: refetchSatisfaction } = useQuery({
    queryKey: ["satisfaction-status", selectedJobId],
    queryFn: ({ signal }) => wcmService.getSatisfactionStatus(selectedJobId, signal),
    enabled: !!selectedJobId,
    placeholderData: () => undefined,
    refetchInterval:
      materialIssueDirty || materialIssuePickerOpen ? false : 30000,
    refetchOnWindowFocus: !(materialIssueDirty || materialIssuePickerOpen),
  });

  const { data: currentStepPolicy, refetch: refetchCurrentStepPolicy } =
    useQuery({
      queryKey: ["current-step-material-policy", selectedJobId],
      queryFn: ({ signal }) => wcmService.getCurrentStepMaterialPolicy(selectedJobId, signal),
      enabled: !!selectedJobId,
      placeholderData: () => undefined,
      refetchInterval:
        materialIssueDirty || materialIssuePickerOpen ? false : 30000,
      refetchOnWindowFocus: !(materialIssueDirty || materialIssuePickerOpen),
    });

  useEffect(() => {
    const nextDrafts: Record<string, StepPolicyDraft> = {};
    const nextActive: Record<string, boolean> = {};
    (currentStepPolicy?.items || []).forEach((item) => {
      const isOverride = String(item.policy_source || "")
        .toUpperCase()
        .includes("OVERRIDE");
      nextDrafts[item.policy_key] = {
        issue_policy_mode: (isOverride
          ? String(item.effective_issue_policy_mode || "NONE")
          : "NONE"
        ).toUpperCase() as StepPolicyDraft["issue_policy_mode"],
        issue_policy_value: isOverride
          ? Number(item.effective_issue_policy_value || 0)
          : 0,
        reason: isOverride ? String(item.override_reason || "") : "",
      };
      nextActive[item.policy_key] = isOverride;
    });
    setStepPolicyDrafts(nextDrafts);
    setActiveStepPolicyOverrides(nextActive);
  }, [currentStepPolicy]);

  // Phase 68: WIP Pool Grouped
  const { data: wipPoolGrouped } = useQuery({
    queryKey: ["wip-pool-grouped", selectedJobId],
    queryFn: ({ signal }) => wcmService.getWipPoolGrouped(selectedJobId, signal),
    enabled: !!selectedJobId,
    placeholderData: () => undefined,
    refetchInterval:
      selectedJobId && !(materialIssueDirty || materialIssuePickerOpen)
        ? 30000
        : false,
  });

  // The execution context intentionally caps its inline suggestions. Always load
  // the authoritative allocation endpoint as well, then merge by roll id so an
  // exact roll cannot disappear merely because it fell outside that context cap.
  const { data: eligibleRollsFallback } = useQuery({
    queryKey: ["eligible-rolls", selectedJobId],
    queryFn: ({ signal }) => wcmService.getEligibleRolls(selectedJobId, signal),
    enabled: !!selectedJobId,
    placeholderData: () => undefined,
  });
  const eligibleRolls = useMemo(() => {
    const normalizeRows = (raw: any): any[] => {
      if (Array.isArray(raw)) return raw;
      if (raw && typeof raw === "object" && Array.isArray(raw.results))
        return raw.results;
      return [];
    };
    const merged = new Map<string, any>();
    normalizeRows((executionContext as any)?.eligible_rolls).forEach((roll) => {
      const id = String(roll?.id || "");
      if (id) merged.set(id, roll);
    });
    normalizeRows(eligibleRollsFallback).forEach((roll) => {
      const id = String(roll?.id || "");
      if (!id) return;
      merged.set(id, { ...roll, ...(merged.get(id) || {}) });
    });
    return Array.from(merged.values());
  }, [executionContext, eligibleRollsFallback]);

  // 2. Stats Calculation
  const stats = useMemo(() => {
    return {
      running: wcStats?.running || 0,
      waiting: wcStats?.waiting || 0,
      total: wcStats?.total_active || 0,
    };
  }, [wcStats]);

  const wipPool = useMemo(() => {
    if (!wipPoolGrouped) return [];
    return Object.values(wipPoolGrouped).flat();
  }, [wipPoolGrouped]);

  const autoForwardedRolls = useMemo(() => {
    return wipPool;
  }, [wipPool]);

  const baseManualEligibleRolls = useMemo(() => {
    return [...eligibleRolls].sort((a: any, b: any) => {
      const aExact = a?.spec_exact ? 1 : 0;
      const bExact = b?.spec_exact ? 1 : 0;
      if (aExact !== bExact) return bExact - aExact;
      const aMissing = a?.spec_missing ? 1 : 0;
      const bMissing = b?.spec_missing ? 1 : 0;
      if (aMissing !== bMissing) return aMissing - bMissing;
      return String(a.label_id || "").localeCompare(String(b.label_id || ""));
    });
  }, [eligibleRolls]);

  const selectedJob = (activeAssignment as any)?.job_details;
  // Order spine + "what is to be made" for the selected job (read-only, cached 30 s).
  const spineQuery = useOrderSpine({ jobId: selectedJobId ? String(selectedJobId) : "" });
  const selectedQueueJob = ((summaryActiveAssignment as any)?.job_details ||
    {}) as Record<string, any>;
  const selectedTargetPlantId = String(
    activeAssignment?.plant_id ||
      selectedJob?.work_center?.plant_id ||
      (workCenter as any)?.plant_id ||
      (workCenter as any)?.plant ||
      "",
  );
  const selectedTargetPlantName = String(
    selectedJob?.work_center?.plant_name ||
      (workCenter as any)?.plant_name ||
      (workCenter as any)?.plant?.name ||
      "",
  );
  const bomSnapshot =
    (executionContext as any)?.bom_snapshot ||
    (selectedJob as any)?.bom_snapshot ||
    {};
  const bomFilms: any[] = Array.isArray((bomSnapshot as any)?.films)
    ? (bomSnapshot as any).films
    : [];
  const bomGranules: any[] = Array.isArray((bomSnapshot as any)?.granules)
    ? (bomSnapshot as any).granules
    : [];
  const bomInks: any[] = Array.isArray((bomSnapshot as any)?.inks)
    ? (bomSnapshot as any).inks
    : [];
  const bomChemicals: any[] = Array.isArray((bomSnapshot as any)?.chemicals)
    ? (bomSnapshot as any).chemicals
    : [];
  const bomAddons: any[] = Array.isArray((bomSnapshot as any)?.addons)
    ? (bomSnapshot as any).addons
    : [];
  const estimatedPcs =
    (executionContext as any)?.job?.estimated_pcs ??
    (selectedJob as any)?.estimated_pcs ??
    (selectedJob as any)?.quantity_pcs ??
    null;
  const stepTargetKg = Number(
    (executionContext as any)?.step_execution?.total_target_kg ??
      (executionContext as any)?.job?.target_weight_kg ??
      0,
  );
  const stepRollTargetKg = Number(
    (executionContext as any)?.step_execution?.roll_target_kg ?? 0,
  );
  const stepBulkTargetKg = Number(
    (executionContext as any)?.step_execution?.bulk_target_kg ?? 0,
  );
  const orderTotalRawKg = Number(
    (executionContext as any)?.order_progress?.weight_kg?.target ??
      (executionContext as any)?.job?.order_target_weight_kg ??
      (selectedJob as any)?.order_reference_target_kg ??
      (selectedJob as any)?.step_adjusted_total_kg ??
      (selectedJob as any)?.total_weight_kg ??
      ((selectedJob as any)?.uom === "KG"
        ? Number((selectedJob as any)?.quantity || 0)
        : 0),
  );
  const orderTotalKg = Math.max(orderTotalRawKg, Number(stepTargetKg || 0), 0);
  const selectedOutputForm = String(
    (executionContext as any)?.job?.output_form ??
      (selectedJob as any)?.output_form ??
      "",
  ).toUpperCase();
  const selectedOutputCapturePolicy =
    (executionContext as any)?.step_policy?.output_capture_policy ||
    (executionContext as any)?.roll_handling?.output_capture_policy ||
    {};
  const selectedOutputCaptureMode = String(
    selectedOutputCapturePolicy?.effective_mode ||
      (executionContext as any)?.roll_handling?.operator_entry_mode ||
      "PROCESS_DEFAULT",
  ).toUpperCase();
  const selectedInputForm = String(
    (executionContext as any)?.job?.input_form ??
      (selectedJob as any)?.input_form ??
      "",
  ).toUpperCase();
  const contextStepExecution =
    (executionContext as any)?.step_execution || {};
  const selectedPrimaryUom = String(
    contextStepExecution?.primary_uom ||
      (selectedJob as any)?.primary_uom ||
      selectedQueueJob?.primary_uom ||
      (String((selectedJob as any)?.uom || "").toUpperCase() === "PCS" &&
      selectedOutputForm === "BULK" &&
      selectedInputForm === "ROLL"
        ? "PCS"
        : "KG"),
  ).toUpperCase() as "KG" | "PCS";
  const selectedPrimaryDecimals = selectedPrimaryUom === "PCS" ? 0 : 3;
  const selectedJobPrimaryUom = String(
    (selectedJob as any)?.primary_uom || "",
  ).toUpperCase();
  const selectedQueuePrimaryUom = String(
    selectedQueueJob?.primary_uom || "",
  ).toUpperCase();
  const stepTargetPrimary =
    toNullableNumber(contextStepExecution?.target_primary) ??
    (selectedJobPrimaryUom === selectedPrimaryUom
      ? toNullableNumber((selectedJob as any)?.step_target_primary)
      : null) ??
    (selectedQueuePrimaryUom === selectedPrimaryUom
      ? toNullableNumber(selectedQueueJob?.step_target_primary)
      : null) ??
    (selectedPrimaryUom === "PCS"
      ? String((selectedJob as any)?.uom || "").toUpperCase() === "PCS"
        ? Number((selectedJob as any)?.quantity || 0)
        : null
      : Number(stepTargetKg || 0));
  const stepRemainingPrimary =
    toNullableNumber(contextStepExecution?.remaining_primary) ??
    (selectedJobPrimaryUom === selectedPrimaryUom
      ? toNullableNumber((selectedJob as any)?.step_remaining_primary)
      : null) ??
    (selectedQueuePrimaryUom === selectedPrimaryUom
      ? toNullableNumber(selectedQueueJob?.step_remaining_primary)
      : null);
  const showPrimarySupportKg = selectedPrimaryUom === "PCS" && stepTargetKg > 0;
  const showPcsSecondary = selectedOutputForm === "BULK";
  const displayPcsSecondary =
    showPcsSecondary && (selectedJob as any)?.uom === "PCS"
      ? Number((selectedJob as any)?.quantity || 0)
      : showPcsSecondary && estimatedPcs != null
        ? Number(estimatedPcs)
        : null;

  const stepPolicyMutation = useMutation({
    mutationFn: async () => {
      if (!selectedJobId) throw new Error("Select a job first.");
      const overrides = Object.entries(stepPolicyDrafts)
        .filter(
          ([policy_key, row]) =>
            Boolean(activeStepPolicyOverrides[policy_key]) &&
            row.issue_policy_mode !== "NONE",
        )
        .map(([policy_key, row]) => ({
          policy_key,
          issue_policy_mode: row.issue_policy_mode,
          issue_policy_value: Number(row.issue_policy_value || 0),
          reason: String(row.reason || "").trim(),
        }));
      return wcmService.updateCurrentStepMaterialPolicy(
        selectedJobId,
        overrides,
      );
    },
    onSuccess: async () => {
      toast({
        title: "Current-step policy updated",
        description:
          "Issue policy now reflects the execution decision for this step.",
      });
      await Promise.all([
        refetchCurrentStepPolicy(),
        refetchContext(),
        refetchSatisfaction(),
      ]);
    },
    onError: (err: any) => {
      toast({
        variant: "destructive",
        title: "Current-step policy update failed",
        description:
          err?.response?.data?.error ||
          err?.message ||
          "Could not save current-step policy overrides.",
      });
    },
  });

  const jobGeometry =
    (executionContext as any)?.job?.geometry || selectedJob?.geometry || {};
  const geometryBase = (jobGeometry as any)?.base || jobGeometry || {};
  const geometryAdjustments = (() => {
    const candidates = [
      (jobGeometry as any)?.adjustments,
      (geometryBase as any)?.adjustments,
      (jobGeometry as any)?.adjustment_schema,
      (executionContext as any)?.job?.adjustment_schema,
      (selectedJob as any)?.adjustment_schema,
      (selectedJob as any)?.geometry?.adjustments,
    ];
    for (const c of candidates) {
      if (Array.isArray(c) && c.length > 0) return c;
    }
    const derived: any[] = [];
    const pushDerived = (source: any, on: string) => {
      if (!source || typeof source !== "object") return;
      Object.entries(source).forEach(([rawKey, rawValue]) => {
        const key = String(rawKey);
        const k = key.toLowerCase();
        if (
          !(k.includes("adjust") || k.includes("gusset") || k.includes("pod"))
        )
          return;
        if (rawValue == null || rawValue === "") return;
        const value = Number(rawValue);
        if (!Number.isFinite(value)) return;
        derived.push({
          type: key.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()),
          on,
          value,
        });
      });
    };
    pushDerived(jobGeometry, "Geometry");
    pushDerived(geometryBase, "Geometry");
    pushDerived((jobGeometry as any)?.pod, "POD");
    return derived;
  })();

  const targetRollSpecs = useMemo(
    () =>
      Array.isArray((executionContext as any)?.target_roll_invariant_list)
        ? (executionContext as any).target_roll_invariant_list
        : [],
    [executionContext],
  );

  const targetSpecByLayer = useMemo(() => {
    const map = new Map<number, any>();
    targetRollSpecs.forEach((spec: any) => {
      const idx = Number(spec?.layer_index || 0);
      if (Number.isFinite(idx) && idx > 0 && !map.has(idx)) {
        map.set(idx, spec);
      }
    });
    return map;
  }, [targetRollSpecs]);

  const layerSnapshot = Array.isArray(selectedJob?.layers)
    ? selectedJob.layers
    : [];
  const displayLayers = useMemo(() => {
    const ctxLayers = (executionContext as any)?.bom_layers;
    if (Array.isArray(ctxLayers) && ctxLayers.length > 0) {
      return ctxLayers.map((layer: any, idx: number) => {
        const snap = layerSnapshot[idx] || {};
        const spec =
          targetSpecByLayer.get(Number(layer.index || idx + 1)) || {};
        const layerWeightKg =
          layer.weight_kg ??
          layer.layer_weight_kg ??
          layer.required_qty_kg ??
          snap.weight_kg ??
          snap.layer_weight_kg ??
          null;
        const normalizedMaterials = Array.isArray(layer.materials)
          ? layer.materials.map((m: any) => ({
              ...m,
              weight_kg:
                m?.weight_kg ??
                m?.required_qty_kg ??
                m?.qty_kg ??
                m?.quantity ??
                0,
            }))
          : [];
        return {
          ...layer,
          index: layer.index || idx + 1,
          variant_name:
            layer.variant_name ||
            snap.variant_name ||
            spec.variant_name ||
            snap.name ||
            layer.name,
          name:
            layer.variant_name ||
            snap.variant_name ||
            spec.variant_name ||
            snap.name ||
            layer.name ||
            `Layer ${idx + 1}`,
          thickness:
            layer.thickness ??
            snap.thickness_micron ??
            snap.thickness ??
            spec.thickness_micron,
          thickness_micron:
            layer.thickness_micron ??
            layer.thickness ??
            snap.thickness_micron ??
            snap.thickness ??
            spec.thickness_micron,
          grade:
            layer.grade || snap.grade_name || snap.grade || spec.grade_name,
          grade_name:
            layer.grade_name ||
            layer.grade ||
            snap.grade_name ||
            snap.grade ||
            spec.grade_name,
          code:
            layer.code ||
            snap.code ||
            spec.code ||
            snap.variant_code ||
            snap.material_code,
          weight_kg: layerWeightKg != null ? Number(layerWeightKg) : null,
          materials: normalizedMaterials,
        };
      });
    }
    if (layerSnapshot.length === 0 && targetRollSpecs.length > 0) {
      return targetRollSpecs.map((spec: any, idx: number) => ({
        index: Number(spec.layer_index || idx + 1),
        variant_name:
          spec.variant_name || spec.family_name || `Layer ${idx + 1}`,
        name: spec.variant_name || spec.family_name || `Layer ${idx + 1}`,
        thickness: spec.thickness_micron ?? null,
        thickness_micron: spec.thickness_micron ?? null,
        grade: spec.grade_name || null,
        grade_name: spec.grade_name || null,
        code: spec.code || null,
        weight_kg: spec.weight_kg ?? spec.required_qty_kg ?? null,
        materials: [],
      }));
    }
    return layerSnapshot.map((l: any, idx: number) => ({
      index: idx + 1,
      variant_name: l.variant_name || l.name || l.code || `Layer ${idx + 1}`,
      name: l.variant_name || l.name || l.code || `Layer ${idx + 1}`,
      thickness: l.thickness_micron ?? l.thickness,
      thickness_micron: l.thickness_micron ?? l.thickness,
      grade: l.grade_name || l.grade,
      grade_name: l.grade_name || l.grade,
      code: l.code || l.variant_code || l.material_code,
      weight_kg: l.weight_kg ?? l.layer_weight_kg ?? l.required_qty_kg ?? null,
      materials: [],
    }));
  }, [executionContext, layerSnapshot, targetRollSpecs, targetSpecByLayer]);

  const assignedRolls = useMemo(() => {
    const normalize = (roll: any) => ({
      id: String(roll?.id ?? ""),
      label_id: roll?.label_id ?? roll?.label ?? "—",
      material_name:
        roll?.material_name ??
        roll?.material?.name ??
        roll?.material_code ??
        "—",
      quantity: Number(roll?.quantity ?? roll?.weight_kg ?? 0),
      weight_kg: Number(roll?.weight_kg ?? roll?.quantity ?? 0),
      width_mm: roll?.width_mm ?? null,
      thickness_micron: roll?.thickness_micron ?? null,
      grade_name: roll?.grade_name ?? null,
      status: roll?.status ?? null,
      location_name:
        roll?.location_name ??
        roll?.location ??
        roll?.location_name_display ??
        "—",
      reservation_id: roll?.reservation_id || null,
      roll_role: roll?.roll_role || null,
      is_remainder: Boolean(roll?.is_remainder),
      stage_index: Number(roll?.stage_index ?? 0),
      current_step_index: Number(roll?.current_step_index ?? 0),
      completed_step_index: Number(roll?.completed_step_index ?? 0),
      target_lane_key: roll?.target_lane_key || null,
      target_lane_label: roll?.target_lane_label || null,
      target_layer_index: roll?.target_layer_index ?? null,
      target_variant_name: roll?.target_variant_name || null,
      target_grade_name: roll?.target_grade_name || null,
      target_thickness_micron: roll?.target_thickness_micron ?? null,
      target_width_mm: roll?.target_width_mm ?? null,
    });

    const ctxRolls = (executionContext as any)?.allocated_rolls;
    if (Array.isArray(ctxRolls)) return ctxRolls.map(normalize);

    const fallback = (activeAssignment as any)?.allocated_roll_details;
    if (Array.isArray(fallback) && fallback.length > 0)
      return fallback.map(normalize);

    const idOnly = Array.isArray((activeAssignment as any)?.allocated_rolls)
      ? (activeAssignment as any).allocated_rolls
      : [];
    if (idOnly.length > 0) {
      return idOnly.map((rollId: string) => ({
        id: String(rollId),
        label_id: `ROLL-${String(rollId).slice(0, 8).toUpperCase()}`,
        material_name: "Reserved Roll",
        quantity: 0,
        weight_kg: 0,
        width_mm: null,
        thickness_micron: null,
        grade_name: null,
        status: "RESERVED",
        location_name: "—",
        reservation_id: null,
      }));
    }

    return [];
  }, [executionContext, activeAssignment]);

  const stepRaw = (executionContext as any)?.current_step;
  const currentStepNumber =
    typeof stepRaw === "object"
      ? stepRaw?.sequence
      : (stepRaw ??
        (selectedJob?.current_step_index != null
          ? Number(selectedJob.current_step_index) + 1
          : null));
  const currentStepIndex = Math.max(
    0,
    Number(
      (executionContext as any)?.job?.current_step_index ??
        (selectedJob as any)?.current_step_index ??
        ((typeof currentStepNumber === "number" ? currentStepNumber - 1 : 0) ||
          0),
    ) || 0,
  );
  const rollBehaviorRaw =
    satisfactionStatus?.roll_behavior ||
    (executionContext as any)?.process_config?.roll_behavior ||
    (selectedJob as any)?.roll_behavior ||
    "NONE";
  const rollBehavior =
    typeof rollBehaviorRaw === "string" ? rollBehaviorRaw : "NONE";
  const assignedRollsForDisplay = useMemo(() => assignedRolls, [assignedRolls]);
  const laneGroups = useMemo(() => {
    const groups = (executionContext as any)?.wip_pool_meta?.lane_groups;
    return Array.isArray(groups) ? groups : [];
  }, [executionContext]);
  const rollBehaviorLabel = rollBehavior.replace(/_/g, " ");
  const rollBehaviorGuidance: Record<string, string> = {
    CREATE_NEW: "Create new output roll from produced size + weight.",
    MODIFY_EXISTING:
      "Use exactly one reserved parent roll and update its weight.",
    MULTI_INPUT_COMBINE:
      "Reserve required input rolls and combine into one output roll.",
    SPLIT: "Reserve one parent roll and split into multiple child rolls.",
    NONE: "Follow configured roll input requirement for this step.",
  };
  const rollsRequired = satisfactionStatus?.rolls_required ?? 0;
  // Roll contract for the step: COUNT (fixed lanes/layers) or MASS (any number of
  // rolls of the right web until the step mass is covered).
  const rollMode = String((satisfactionStatus as any)?.roll_mode || (rollsRequired > 0 ? "COUNT" : "NONE")).toUpperCase();
  const rollMassMode = rollMode === "MASS";
  // LANES: lamination lane groups, one queue per layer. MASS and LANES both run rolls
  // one after another and accept the next roll while the job runs.
  const rollLaneMode = rollMode === "LANES";
  const rollLaneFlow = rollMassMode || rollLaneMode;
  const rollTargetKg = Number((satisfactionStatus as any)?.roll_target_kg || 0);
  const rollsReservedKg = Number((satisfactionStatus as any)?.rolls_reserved_kg || 0);
  const rollShortKg = Number((satisfactionStatus as any)?.roll_short_kg || 0);
  const rollMaxCount = Number((satisfactionStatus as any)?.roll_max_count || rollsRequired || 0);
  const rollMassCovered = Boolean((satisfactionStatus as any)?.roll_mass_covered ?? true);
  const rollsReserved = satisfactionStatus?.rolls_reserved ?? 0;
  const lineageRollsAvailable = Number(
    (executionContext as any)?.wip_pool_meta?.lineage_roll_count ??
      satisfactionStatus?.rolls_available ??
      0,
  );
  const rollsPool =
    (satisfactionStatus as any)?.rolls_pool ??
    satisfactionStatus?.rolls_available ??
    0;
  const fallbackRollsAvailable = Number(
    (executionContext as any)?.wip_pool_meta?.fallback_roll_count ??
      (satisfactionStatus as any)?.rolls_fallback_available ??
      0,
  );
  const rollsMissingPool = Math.max(
    0,
    Number(
      (satisfactionStatus as any)?.rolls_missing_pool ??
        rollsRequired - rollsPool,
    ),
  );
  const missingLineageRolls = Math.max(
    0,
    Number(
      (executionContext as any)?.wip_pool_meta?.missing_lineage_rolls ??
        (satisfactionStatus as any)?.rolls_missing_lineage ??
        rollsRequired - lineageRollsAvailable,
    ),
  );
  const rollAssignmentValidation =
    (executionContext as any)?.roll_assignment_validation || {};
  const matchedSlotCount = Number(
    (rollAssignmentValidation as any)?.matched_target_slots?.length || 0,
  );
  const unmatchedSlotCount = Number(
    (rollAssignmentValidation as any)?.unmatched_target_slots?.length || 0,
  );
  const manualEligibleRolls = useMemo(() => {
    return [...baseManualEligibleRolls].sort((a: any, b: any) => {
      const sourceRank = (row: any) => {
        const value = String(row?.roll_source || "").toUpperCase();
        if (value === "LINEAGE") return 3;
        if (value === "PURCHASED_FALLBACK") return 2;
        if (value === "COMPATIBLE_FALLBACK") return 1;
        return 0;
      };
      const aSource = sourceRank(a);
      const bSource = sourceRank(b);
      if (aSource !== bSource) return bSource - aSource;
      const aExact = a?.spec_exact ? 1 : 0;
      const bExact = b?.spec_exact ? 1 : 0;
      if (aExact !== bExact) return bExact - aExact;
      const aMissing = a?.spec_missing ? 1 : 0;
      const bMissing = b?.spec_missing ? 1 : 0;
      if (aMissing !== bMissing) return aMissing - bMissing;
      return String(a.label_id || "").localeCompare(String(b.label_id || ""));
    });
  }, [baseManualEligibleRolls]);
  const assignmentReservedCount = Array.isArray(
    (activeAssignment as any)?.allocated_rolls,
  )
    ? (activeAssignment as any).allocated_rolls.length
    : 0;
  const effectiveRollsReserved = Math.max(
    rollsReserved,
    assignedRollsForDisplay.length,
    assignmentReservedCount,
  );
  const rollsMissing = rollMassMode
    ? (effectiveRollsReserved >= 1 ? 0 : 1)
    : rollLaneMode
      ? Math.max(0, Number((satisfactionStatus as any)?.rolls_missing ?? 0))
      : Math.max(0, rollsRequired - effectiveRollsReserved);
  const isRollInputStep = satisfactionStatus?.input_form === "ROLL";
  const requiresManualRollAssign = isRollInputStep && rollsMissing > 0;
  // In mass mode more rolls may be added until the step mass is covered.
  const rollLanes: RollLane[] = useMemo(() => {
    const rows = (executionContext as any)?.inputs?.roll_lanes;
    return Array.isArray(rows) ? rows : [];
  }, [executionContext]);
  // Lanes that can start but still lack film for the full order; adding rolls later is fine.
  const shortRollLanes = useMemo(
    () => (rollLaneFlow ? rollLanes.filter((lane) => !lane.covered && Number(lane.short_kg || 0) > 0.0005) : []),
    [rollLaneFlow, rollLanes],
  );
  const emptyRollLanes = useMemo(
    () => (rollLaneMode ? rollLanes.filter((lane) => Number(lane.loaded_kg || 0) <= 0.0005) : []),
    [rollLaneMode, rollLanes],
  );
  const startedRollIds = useMemo(() => {
    const ids = new Set<string>();
    rollLanes.forEach((lane) => lane.rolls.forEach((roll) => roll.started && ids.add(String(roll.id))));
    return ids;
  }, [rollLanes]);
  const canAddMoreRolls = rollMassMode
    ? effectiveRollsReserved < Math.max(1, rollMaxCount) && (effectiveRollsReserved === 0 || !rollMassCovered)
    : rollLaneMode
      ? effectiveRollsReserved < Math.max(1, rollMaxCount)
      : rollsMissing > 0;
  const rollAllocationLabel = rollMassMode
    ? `${effectiveRollsReserved} roll${effectiveRollsReserved === 1 ? "" : "s"} · ${rollsReservedKg.toFixed(1)} of ${rollTargetKg.toFixed(1)} kg`
    : rollLaneMode
      ? `${effectiveRollsReserved} roll${effectiveRollsReserved === 1 ? "" : "s"} in ${rollLanes.length || rollsRequired} lanes${rollsMissing > 0 ? ` · ${rollsMissing} lane${rollsMissing === 1 ? "" : "s"} empty` : ""}`
      : `${effectiveRollsReserved}/${rollsRequired} allocated`;
  const rollGuidanceText =
    satisfactionStatus?.input_form === "ROLL" &&
    rollsRequired > 0 &&
    rollBehavior === "NONE"
      ? "Reserve required input roll(s) for this step."
      : rollBehaviorGuidance[rollBehavior] || rollBehaviorGuidance.NONE;
  const showRollGuidance = isRollInputStep;
  const canManualAssign = isRollInputStep && canAddMoreRolls;
  const assignedRollIdSet = useMemo(
    () => new Set(assignedRollsForDisplay.map((r: any) => String(r.id || ""))),
    [assignedRollsForDisplay],
  );
  const assignedRollLabelSet = useMemo(
    () =>
      new Set(
        assignedRollsForDisplay
          .map((r: any) =>
            String(r.label_id || "")
              .trim()
              .toUpperCase(),
          )
          .filter(Boolean),
      ),
    [assignedRollsForDisplay],
  );
  const wipPoolDisplayRolls = useMemo(() => {
    const out: any[] = [];
    const seen = new Set<string>();
    for (const roll of autoForwardedRolls || []) {
      const id = String(roll?.id || "");
      if (!id) continue;
      const label = String(roll?.label_id || "")
        .trim()
        .toUpperCase();
      const dedupeKey = label || id;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      out.push({
        ...roll,
        is_assigned:
          assignedRollIdSet.has(id) ||
          (label && assignedRollLabelSet.has(label)),
      });
    }
    return out;
  }, [autoForwardedRolls, assignedRollIdSet, assignedRollLabelSet]);
  const wipPoolRolls = useMemo(
    () => wipPoolDisplayRolls,
    [wipPoolDisplayRolls],
  );
  const wipUnassignedRolls = useMemo(
    () => wipPoolDisplayRolls.filter((roll: any) => !roll?.is_assigned),
    [wipPoolDisplayRolls],
  );
  const rollAllocationCandidates = useMemo(() => {
    const map = new Map<string, any>();
    (manualEligibleRolls || []).forEach((roll: any) => {
      const id = String(roll?.id || "");
      if (!id || assignedRollIdSet.has(id)) return;
      map.set(id, roll);
    });
    (wipUnassignedRolls || []).forEach((roll: any) => {
      const id = String(roll?.id || "");
      if (!id || assignedRollIdSet.has(id) || map.has(id)) return;
      map.set(id, {
        ...roll,
        location: roll?.location || roll?.location_name || "—",
        location_name: roll?.location_name || roll?.location || "—",
        location_type: roll?.location_type || "",
        spec_exact: false,
        spec_missing: true,
      });
    });
    return Array.from(map.values());
  }, [manualEligibleRolls, wipUnassignedRolls, assignedRollIdSet]);
  const showRollAllocator = isRollInputStep;
  const showRollTransfer =
    satisfactionStatus?.input_form === "ROLL" &&
    rollsMissingPool > 0 &&
    rollAllocationCandidates.length === 0;

  const bulkRows = (satisfactionStatus?.bulk_consumption || []).map(
    (bulk: any) => {
      const required = Number(
        bulk.required_qty ??
          bulk.required_qty_kg ??
          bulk.estimated_actual_qty ??
          bulk.estimated_actual_qty_kg ??
          bulk.estimated_qty ??
          bulk.estimated_qty_kg ??
          0,
      );
      const sourceLocationAvailable = Number(
        bulk.source_location_available_qty ??
          bulk.source_location_available_qty_kg ??
          bulk.available_qty ??
          bulk.available_qty_kg ??
          0,
      );
      const currentPlantAvailable = Number(
        bulk.current_plant_available_qty ??
          bulk.current_plant_available_qty_kg ??
          bulk.plant_available_qty ??
          bulk.plant_available_qty_kg ??
          0,
      );
      const globalAvailable = Number(
        bulk.global_available_qty ?? bulk.global_available_qty_kg ?? 0,
      );
      const fallbackOtherPlants = Math.max(
        0,
        globalAvailable - currentPlantAvailable,
      );
      const otherPlantsAvailableRaw = Number(
        bulk.other_plants_available_qty ??
          bulk.other_plants_available_qty_kg ??
          fallbackOtherPlants,
      );
      const otherPlantsAvailable = Number.isFinite(otherPlantsAvailableRaw)
        ? Math.max(0, otherPlantsAvailableRaw)
        : 0;

      const localAvailable = currentPlantAvailable;
      const shortfall = Math.max(0, required - localAvailable);
      const hasNonLocalStock = otherPlantsAvailable > 0.0001;
      // Add-on shortages are flagged but not blocking unless the plant turned that on.
      const nonBlockingShort = shortfall > 0 && bulk.blocking === false;
      const isOk = shortfall <= 0 || nonBlockingShort;
      const needsTransfer =
        shortfall > 0 &&
        hasNonLocalStock &&
        Boolean(bulk.material_id || bulk.materialId);
      const statusText = nonBlockingShort
        ? `SHORT ${shortfall.toFixed(1)} ${String(bulk.uom || "").toLowerCase()} · not blocking`
        : isOk
          ? "READY"
          : hasNonLocalStock
            ? "INSUFFICIENT"
            : "NO STOCK";

      return {
        material: bulk.material_name || bulk.category_display || bulk.category,
        materialId: bulk.material_id,
        type: "BULK",
        required,
        localAvailable,
        plantInventory: otherPlantsAvailable,
        sourceLocationAvailable,
        shortfall,
        isOk,
        needsTransfer,
        statusText,
        locationName: bulk.source_location_name || bulk.location_name || null,
      };
    },
  );

  const rollRow =
    satisfactionStatus?.input_form === "ROLL"
      ? (() => {
          const rollsLocalAvailable = Number(
            (satisfactionStatus as any)?.rolls_available ?? 0,
          );
          const isOk = rollMassMode ? effectiveRollsReserved >= 1 : effectiveRollsReserved >= rollsRequired;
          const statusText = !isOk
            ? "INSUFFICIENT"
            : rollMassMode && !rollMassCovered && rollShortKg > 0
              ? `READY · SHORT ${rollShortKg.toFixed(1)} KG`
              : "READY";
          return {
            material: "Rolls",
            type: "ROLL",
            required: rollsRequired,
            localAvailable: rollsLocalAvailable,
            plantInventory: null,
            isOk,
            needsTransfer: rollsMissingPool > 0,
            statusText,
            shortfall: rollsMissingPool > 0 ? rollsMissingPool : rollsMissing,
            locationName: null,
          };
        })()
      : null;

  const requirementRows = [...bulkRows, ...(rollRow ? [rollRow] : [])];
  const materialIssueRows = useMemo(
    () =>
      (satisfactionStatus?.bulk_consumption || []).filter((row: any) => {
        const required = Number(
          row?.required_qty ??
            row?.required_qty_kg ??
            row?.estimated_actual_qty ??
            row?.estimated_actual_qty_kg ??
            row?.estimated_qty ??
            row?.estimated_qty_kg ??
            0,
        );
        const planned = Number(
          row?.planned_issue_qty ?? row?.planned_issue_qty_kg ?? 0,
        );
        const issued = Number(
          row?.actual_issued_qty ?? row?.actual_issued_qty_kg ?? 0,
        );
        const theoretical = Number(
          row?.theoretical_qty ?? row?.theoretical_qty_kg ?? 0,
        );
        return required > 0 || planned > 0 || theoretical > 0 || issued > 0;
      }),
    [satisfactionStatus],
  );
  const granuleIssueRows = useMemo(
    () =>
      materialIssueRows.filter(
        (row: any) => materialIssueKind(row) === "GRANULE",
      ),
    [materialIssueRows],
  );
  const updateMaterialIssueDraft = (
    requirementId: string,
    patch: Partial<WcmMaterialIssueDraft>,
  ) => {
    if (!requirementId) return;
    materialIssueDraftVersionRef.current += 1;
    setMaterialIssueDirty(true);
    setMaterialIssueDrafts((prev) => ({
      ...prev,
      [requirementId]: {
        ...(prev[requirementId] || {
          actual_issued_qty: "",
          actual_returned_qty: "0",
          actual_scrap_qty: "0",
          is_estimated: true,
        }),
        ...patch,
      },
    }));
  };
  useEffect(() => {
    if (!selectedJobId) {
      setMaterialIssueDrafts({});
      setMaterialIssueDirty(false);
      setMaterialIssuePickerOpen(false);
      hydratedMaterialJobRef.current = "";
      hydratedMaterialSignatureRef.current = "";
      return;
    }
    const persisted = Array.isArray(
      (executionContext as any)?.current_step_material_confirmations,
    )
      ? (executionContext as any).current_step_material_confirmations
      : [];
    const isNewJob = hydratedMaterialJobRef.current !== selectedJobId;
    const serverSignature = JSON.stringify({
      persisted,
      rows: materialIssueRows.map((row: any) => ({
        requirement_id: row?.requirement_id,
        material_id: row?.material_id,
        planned_issue_qty: row?.planned_issue_qty ?? row?.planned_issue_qty_kg,
      })),
    });
    if (!isNewJob && materialIssueDirty) return;
    if (
      !isNewJob &&
      hydratedMaterialSignatureRef.current === serverSignature
    ) {
      return;
    }
    if (isNewJob) {
      setMaterialIssueDirty(false);
      setMaterialIssuePickerOpen(false);
    }
    setMaterialIssueDrafts((prev) => {
      const next: Record<string, WcmMaterialIssueDraft> = {};
      materialIssueRows.forEach((row: any) => {
        const requirementId = String(row?.requirement_id || "").trim();
        if (!requirementId) return;
        const saved = persisted.find(
          (item: any) => String(item?.requirement_id || "") === requirementId,
        );
        const issueTarget = materialIssueTargetKg(row);
        const resolvedIssued = String(
          saved?.actual_issued_qty ??
            prev[requirementId]?.actual_issued_qty ??
            (issueTarget > 0 ? issueTarget.toFixed(3) : ""),
        );
        // Non-granule rows have no input: they are taken at the planned quantity of the step mapping.
        const autoRow = materialIssueKind(row) !== "GRANULE";
        next[requirementId] = {
          material_id: String(row?.material_id || saved?.material_id || ""),
          actual_issued_qty:
            autoRow && issueTarget > 0 && !(Number(resolvedIssued) > 0) ? issueTarget.toFixed(3) : resolvedIssued,
          actual_returned_qty: String(
            saved?.actual_returned_qty ??
              prev[requirementId]?.actual_returned_qty ??
              "0",
          ),
          actual_scrap_qty: String(
            saved?.actual_scrap_qty ??
              prev[requirementId]?.actual_scrap_qty ??
              "0",
          ),
          is_estimated: Boolean(
            saved?.is_estimated ?? prev[requirementId]?.is_estimated ?? true,
          ),
          granule_code_allocations: Array.isArray(
            saved?.granule_code_allocations,
          )
            ? saved.granule_code_allocations.map((allocation: any) => ({
                granule_code_id: String(allocation?.granule_code_id || ""),
                source_location_id: String(
                  allocation?.source_location_id ||
                    allocation?.location_id ||
                    row?.source_location_id ||
                    row?.location_id ||
                    "",
                ),
                qty_kg: String(
                  allocation?.qty_kg ?? allocation?.quantity ?? "",
                ),
              }))
            : prev[requirementId]?.granule_code_allocations || [],
        };
      });
      return next;
    });
    hydratedMaterialJobRef.current = selectedJobId;
    hydratedMaterialSignatureRef.current = serverSignature;
  }, [selectedJobId, executionContext, materialIssueRows, materialIssueDirty]);
  const materialIssuePayload = useMemo(
    () =>
      materialIssueRows
        .map((row: any) => {
          const requirementId = String(row?.requirement_id || "").trim();
          const draft = materialIssueDrafts[requirementId];
          if (!requirementId || !draft) return null;
          const isGranule =
            String(row?.category || row?.category_code || "").toUpperCase() ===
            "GRANULE";
          const issuedQty = Math.max(0, Number(draft.actual_issued_qty || 0));
          const granuleCodeAllocations =
            isGranule && issuedQty > 0
              ? (draft.granule_code_allocations || [])
                  .map((allocation) => ({
                    granule_code_id: allocation.granule_code_id,
                    source_location_id: allocation.source_location_id,
                    qty_kg: Math.max(0, Number(allocation.qty_kg || 0)),
                  }))
                  .filter(
                    (allocation) =>
                      allocation.granule_code_id && allocation.qty_kg > 0,
                  )
              : [];
          return {
            requirement_id: requirementId,
            material_id: draft.material_id || row?.material_id,
            actual_issued_qty: issuedQty,
            actual_returned_qty: 0,
            actual_scrap_qty: 0,
            is_estimated: draft.is_estimated,
            granule_code_allocations: granuleCodeAllocations.length
              ? granuleCodeAllocations
              : undefined,
          };
        })
        .filter(Boolean),
    [materialIssueDrafts, materialIssueRows],
  );
  const materialIssueErrors = useMemo(() => {
    const errors: string[] = [];
    materialIssueRows.forEach((row: any) => {
      const requirementId = String(row?.requirement_id || "").trim();
      if (!requirementId) return;
      const materialName = String(
        row?.material_name ||
          row?.category_display ||
          row?.category ||
          "Material",
      );
      const draft = materialIssueDrafts[requirementId];
      const issued = Number(draft?.actual_issued_qty ?? 0);
      if (!Number.isFinite(issued) || issued < 0) {
        errors.push(`${materialName}: issued kg is invalid`);
        return;
      }
      if (materialIssueTargetKg(row) > 0 && issued <= 0) {
        errors.push(`${materialName}: enter issued kg`);
        return;
      }
      const category = String(
        row?.category || row?.category_code || "",
      ).toUpperCase();
      const codeOptions = Array.isArray(row?.granule_code_options)
        ? row.granule_code_options
        : [];
      const allowedCodes = new Set(
        codeOptions
          .filter((option: any) => option?.can_allocate !== false)
          .map(
            (option: any) =>
              `${String(option?.granule_code_id || "")}::${String(option?.location_id || "")}`,
          ),
      );
      const allocations = draft?.granule_code_allocations || [];
      if (category === "GRANULE" && issued > 0) {
        if (!codeOptions.length) {
          errors.push(`${materialName}: no coded stock available`);
          return;
        }
        if (!allocations.length) {
          errors.push(`${materialName}: select code split`);
          return;
        }
        let allocated = 0;
        for (const allocation of allocations) {
          const codeId = String(allocation.granule_code_id || "");
          const sourceLocationId = String(
            allocation.source_location_id ||
              row?.source_location_id ||
              row?.location_id ||
              "",
          );
          const qty = Number(allocation.qty_kg || 0);
          if (!allowedCodes.has(`${codeId}::${sourceLocationId}`)) {
            errors.push(`${materialName}: select an available code and source`);
            return;
          }
          if (!Number.isFinite(qty) || qty < 0) {
            errors.push(`${materialName}: code kg is invalid`);
            return;
          }
          allocated += qty;
        }
        if (Math.abs(allocated - issued) > 0.0001) {
          errors.push(`${materialName}: code split must equal issued kg`);
        }
      }
    });
    return errors;
  }, [materialIssueDrafts, materialIssueRows]);

  // Over-pick preview/gate: issuing more than target is allowed (remainder
  // returns to stock), but a >120% over-pick needs an explicit confirmation.
  const overPickInfoByRequirement = useMemo(() => {
    const map = new Map<
      string,
      {
        target: number;
        issued: number;
        overKg: number;
        ratio: number;
        requiresConfirm: boolean;
      }
    >();
    materialIssueRows.forEach((row: any) => {
      const requirementId = String(row?.requirement_id || "").trim();
      if (!requirementId) return;
      const target = materialIssueTargetKg(row);
      const draft = materialIssueDrafts[requirementId];
      const issued = Number(draft?.actual_issued_qty ?? 0);
      if (
        !(target > 0) ||
        !Number.isFinite(issued) ||
        issued <= target + 0.0001
      )
        return;
      const overKg = issued - target;
      const ratio = issued / target;
      map.set(requirementId, {
        target,
        issued,
        overKg,
        ratio,
        requiresConfirm: ratio > 1.2 + 1e-9,
      });
    });
    return map;
  }, [materialIssueRows, materialIssueDrafts]);
  const overPickErrors = useMemo(() => {
    const errors: string[] = [];
    materialIssueRows.forEach((row: any) => {
      const requirementId = String(row?.requirement_id || "").trim();
      if (!requirementId) return;
      const info = overPickInfoByRequirement.get(requirementId);
      if (!info?.requiresConfirm) return;
      if (overPickConfirms[requirementId]) return;
      const materialName = String(
        row?.material_name ||
          row?.category_display ||
          row?.category ||
          "Material",
      );
      errors.push(
        `${materialName}: confirm over-pick (${info.issued.toFixed(3)} kg > 120% of plan)`,
      );
    });
    return errors;
  }, [materialIssueRows, overPickInfoByRequirement, overPickConfirms]);

  const stepOtherRequirementsRaw: any[] = Array.isArray(
    (executionContext as any)?.other_requirements,
  )
    ? (executionContext as any).other_requirements
    : [];
  const allOtherRequirementsRaw: any[] = Array.isArray(
    (executionContext as any)?.all_other_requirements,
  )
    ? (executionContext as any).all_other_requirements
    : [];
  const stepOtherRequirements = useMemo(() => {
    return stepOtherRequirementsRaw.map((item: any) => ({
      ...item,
      weight_kg: Number(
        item.weight_kg ||
          item.required_qty_kg ||
          item.qty_kg ||
          item.quantity ||
          0,
      ),
      scope: "STEP",
    }));
  }, [stepOtherRequirementsRaw]);
  const referenceOtherRequirements: any[] = useMemo(() => {
    const rows: any[] = [];
    const push = (item: any, category: string) => {
      if (!item || typeof item !== "object") return;
      rows.push({
        material_id: item.material_id || item.variant_id || item.id || null,
        code: item.code || item.material_code || "",
        name: item.name || item.material_name || "—",
        category,
        weight_kg: Number(
          item.weight_kg ||
            item.required_qty_kg ||
            item.qty_kg ||
            item.quantity ||
            0,
        ),
        uom: "KG",
      });
    };
    (Array.isArray(bomInks) ? bomInks : []).forEach((item: any) =>
      push(item, "INK"),
    );
    (Array.isArray(bomChemicals) ? bomChemicals : []).forEach((item: any) =>
      push(item, "CHEMICAL"),
    );
    (Array.isArray(bomAddons) ? bomAddons : []).forEach((item: any) =>
      push(item, "ADDON"),
    );
    return rows;
  }, [bomInks, bomChemicals, bomAddons]);
  const historyOtherRequirements = useMemo(() => {
    return allOtherRequirementsRaw
      .filter((item: any) => {
        const stepSeq = Number(item?.step_sequence || 0);
        const currentSeq = Number(currentStepNumber || 0);
        if (!stepSeq || !currentSeq) return false;
        // Show only historical (already passed) items, never future-step materials.
        if (!(stepSeq < currentSeq)) return false;
        const qty = Number(
          item.weight_kg ||
            item.required_qty_kg ||
            item.qty_kg ||
            item.quantity ||
            0,
        );
        return qty > 0;
      })
      .map((item: any) => ({
        ...item,
        weight_kg: Number(
          item.weight_kg ||
            item.required_qty_kg ||
            item.qty_kg ||
            item.quantity ||
            0,
        ),
        scope: "OTHER_STEP",
      }));
  }, [allOtherRequirementsRaw, currentStepNumber]);
  const displayOtherRequirements = useMemo(() => {
    const map = new Map<string, any>();
    const push = (item: any) => {
      if (!item) return;
      const codeKey = String(item.code || item.material_code || "")
        .trim()
        .toUpperCase();
      const nameKey = String(item.name || "")
        .trim()
        .toUpperCase();
      const categoryKey = String(item.category || "")
        .trim()
        .toUpperCase();
      // Prefer semantic dedupe (code/name/category) to avoid duplicate
      // "current + prior/reference" rows for the same material label.
      const materialKey = String(
        item.material_id || item.variant_id || "",
      ).trim();
      const semanticKey = `${codeKey || nameKey || "ITEM"}::${categoryKey || "UNCAT"}`;
      const key = semanticKey || materialKey;
      const incoming = {
        ...item,
        weight_kg: Number(
          item.weight_kg ||
            item.required_qty_kg ||
            item.qty_kg ||
            item.quantity ||
            0,
        ),
      };
      const existing = map.get(key);
      if (!existing) {
        map.set(key, incoming);
        return;
      }
      const scopeRank = (scope: string) => {
        if (scope === "STEP") return 3;
        if (scope === "OTHER_STEP") return 2;
        return 1;
      };
      const existingRank = scopeRank(String(existing.scope || ""));
      const incomingRank = scopeRank(String(incoming.scope || ""));
      if (incomingRank > existingRank) {
        map.set(key, incoming);
        return;
      }
      if (
        incomingRank === existingRank &&
        Number(incoming.weight_kg || 0) > Number(existing.weight_kg || 0)
      ) {
        map.set(key, incoming);
      }
    };
    stepOtherRequirements.forEach(push);
    historyOtherRequirements.forEach(push);
    // Always merge BOM reference rows; semantic dedupe above prevents noisy duplicates.
    referenceOtherRequirements.forEach(push);
    return Array.from(map.values());
  }, [
    stepOtherRequirements,
    historyOtherRequirements,
    referenceOtherRequirements,
  ]);
  const otherRequirementsLabel = "Inks, Chemicals & Add-ons";

  const isReleasedToMachine = assignmentIsMachineReady(activeAssignment);
  const selectedMachine = machineOptionsResolved.find(
    (machine: any) => String(machine.id) === String(selectedMachineId),
  );
  const selectedMachineState: MachineLiveState | "" =
    selectedMachine?.state || "";
  const selectedMachineRunningOtherJob = Boolean(
    selectedMachineId &&
      selectedMachineState === "RUNNING" &&
      selectedMachine?.current_job_number &&
      String(selectedMachine.current_job_number) !==
        String((selectedJob as any)?.job_number || ""),
  );
  const selectedMachineUnavailable = selectedMachineState === "DOWN";
  const detailInkColors: string[] = Array.isArray(
    (activeAssignment as any)?.ink_colors,
  )
    ? (activeAssignment as any).ink_colors
    : Array.isArray((selectedJob as any)?.ink_colors)
      ? (selectedJob as any).ink_colors
      : [];
  const detailArtworkId = firstNonEmpty(
    (activeAssignment as any)?.artwork_id,
    (selectedJob as any)?.artwork_id,
    (selectedJob as any)?.committed_artwork_id,
  );
  const detailArtworkCode = firstNonEmpty(
    (activeAssignment as any)?.artwork_code,
    (selectedJob as any)?.artwork_code,
    (selectedJob as any)?.committed_artwork_code,
  );
  const detailArtworkName = firstNonEmpty(
    (activeAssignment as any)?.artwork_name,
    (selectedJob as any)?.artwork_name,
    (selectedJob as any)?.committed_artwork_name,
  );
  const detailRequiresCylinderGate = Boolean(
    (activeAssignment as any)?.current_step_print_capable ||
      (selectedJob as any)?.current_step_print_capable ||
      detailArtworkId ||
      detailArtworkCode ||
      detailArtworkName ||
      detailInkColors.length > 0,
  );
  const detailCylinderStatus = (activeAssignment as any)?.cylinder_status as
    | "READY"
    | "MISSING"
    | "NOT_REQUIRED"
    | "NA"
    | undefined;
  const detailCylinderReady = (activeAssignment as any)?.cylinder_ready as
    | boolean
    | undefined;
  const detailMaterialBlocked = Boolean(
    (activeAssignment as any)?.material_blocked,
  );
  const detailMaterialBlockReason = String(
    (activeAssignment as any)?.material_block_reason || "",
  );
  const bulkOk = bulkRows.length ? bulkRows.every((r) => r.isOk) : true;
  const rollOk = rollRow ? rollRow.isOk : true;
  const requirementsSatisfied = bulkOk && rollOk;
  const pushBlockingReasons = useMemo(() => {
    const reasons: string[] = [];
    const blockedRows = requirementRows.filter((r: any) => !r.isOk);
    blockedRows.forEach((row: any) => {
      if (row.statusText && row.statusText !== "READY") {
        reasons.push(`${row.material}: ${row.statusText}`);
      } else {
        reasons.push(`${row.material}: requirement not satisfied`);
      }
    });
    if (!selectedMachineId) {
      reasons.push("Machine: not assigned");
    } else if (selectedMachineState === "DOWN") {
      reasons.push(
        `Machine: ${selectedMachine?.name || "selected machine"} is down`,
      );
    }
    if (detailMaterialBlocked) {
      reasons.push(
        `Material block: ${detailMaterialBlockReason || "queue marked material blocked"}`,
      );
    }
    if (detailRequiresCylinderGate && detailCylinderStatus === "MISSING") {
      reasons.push("Cylinders/artwork: missing or not mounted");
    }
    materialIssueErrors.forEach((error) => reasons.push(error));
    overPickErrors.forEach((error) => reasons.push(error));
    return reasons;
  }, [
    requirementRows,
    selectedMachineId,
    selectedMachineState,
    selectedMachine?.name,
    detailMaterialBlocked,
    detailMaterialBlockReason,
    detailRequiresCylinderGate,
    detailCylinderStatus,
    materialIssueErrors,
    overPickErrors,
  ]);
  const canPushToOperator =
    !isReleasedToMachine && pushBlockingReasons.length === 0;
  const wcmNextAction = !activeAssignment
    ? "Pick a job from the left queue."
    : isReleasedToMachine
      ? "Execution is ready on the machine terminal."
      : !requirementsSatisfied
        ? "Clear the blocked requirement before sending this step forward."
        : !selectedMachineId
          ? "Choose the machine for this step."
          : canPushToOperator
            ? "Assigning the machine will release this step."
            : "Review the last blocker and clear it.";
  const wcmStatusSummary = isReleasedToMachine
    ? "Preparation is locked after release."
    : requirementsSatisfied
      ? "Material and roll checks are ready."
      : "One or more inputs still need action.";

  const recalcFromMastersMutation = useMutation({
    mutationFn: async () => {
      const jobId = activeAssignment?.production_job;
      if (!jobId) throw new Error("Select a job first.");
      const { data } = await api.post(`/api/production/jobs/${jobId}/recalculate-from-masters/`, {});
      return data;
    },
    onSuccess: (data: any) => {
      toast({
        title: "Recalculated from masters",
        description: `Unit weight ${Number(data?.before?.unit_weight_g || 0).toFixed(3)} g → ${Number(data?.after?.unit_weight_g || 0).toFixed(3)} g · order ${Number(data?.before?.total_weight_kg || 0).toFixed(1)} kg → ${Number(data?.after?.total_weight_kg || 0).toFixed(1)} kg · ${data?.jobs_recalculated ?? 0} job(s) updated.`,
      });
      refetchContext();
      refetchSatisfaction();
      queryClient.invalidateQueries({ queryKey: ["wcm-queue", wcId] });
    },
    onError: (err: any) =>
      toast({
        variant: "destructive",
        title: "Could not recalculate",
        description: err?.response?.data?.error || err?.message || "Unable to recalculate this line.",
      }),
  });

  useEffect(() => {
    if (!activeAssignment || !satisfactionStatus) return;
    if (satisfactionStatus.input_form !== "ROLL") return;
    if (rollsRequired <= 0) return;
    if (rollsPool >= rollsRequired) return;
    if (effectiveRollsReserved >= rollsRequired) return;
    const jobId = activeAssignment.production_job;
    if (!jobId) return;
    if (autoAssignRef.current.has(jobId)) return;

    autoAssignRef.current.add(jobId);
    wcmService
      .autoSatisfy(jobId)
      .then(() => {
        refetchContext();
        refetchSatisfaction();
        queryClient.invalidateQueries({
          queryKey: ["wip-pool-grouped", jobId],
        });
      })
      .catch(() => {
        // Keep silent; WCM can still manually allocate if needed.
      });
  }, [
    activeAssignment?.production_job,
    satisfactionStatus?.input_form,
    rollsRequired,
    rollsPool,
    effectiveRollsReserved,
    queryClient,
    refetchContext,
    refetchSatisfaction,
  ]);

  // 3. Mutations
  const mutation = useMutation({
    mutationFn: async (action: () => Promise<any>) => await action(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wcm-queue", wcId] });
      toast({
        title: "Success",
        description: "Action completed successfully.",
      });
    },
    onError: (err: any) => {
      toast({
        variant: "destructive",
        title: "Action Failed",
        description:
          err?.response?.data?.detail ||
          err?.response?.data?.error ||
          err?.message ||
          "Unknown error occurred.",
      });
    },
  });

  const handleUnassignRoll = (reservationId: string) => {
    if (!activeAssignment) return;
    mutation.mutate(async () => {
      await wcmService.unassignRoll(activeAssignment.id, reservationId);
      await refetchContext();
      await refetchSatisfaction();
      queryClient.invalidateQueries({ queryKey: ["wcm-queue", wcId] });
    });
  };

  const handleUnassignRollByRoll = (rollId: string) => {
    if (!activeAssignment) return;
    mutation.mutate(async () => {
      await wcmService.unassignRollByRoll(activeAssignment.id, rollId);
      await refetchContext();
      await refetchSatisfaction();
      queryClient.invalidateQueries({ queryKey: ["wcm-queue", wcId] });
    });
  };

  const handleReturnRoll = async (payload: ReturnRollPayload) => {
    if (!activeAssignment) return;
    await wcmService.returnRoll(activeAssignment.id, payload.rollId, {
      mode: payload.mode,
      weight_kg: payload.weightKg,
      note: payload.note,
    });
    toast({
      title: payload.mode === "RETURN" ? "Balance returned to stock" : "Roll marked finished",
      description: "The roll keeps its label.",
    });
    await refetchContext();
    await refetchSatisfaction();
    queryClient.invalidateQueries({ queryKey: ["wcm-queue", wcId] });
  };

  const handleRequestMaterialTransfer = (
    requirementId: string,
    option: any,
    qtyValue: string,
  ) => {
    if (!activeAssignment) return;
    const qty = Number(qtyValue || 0);
    if (!Number.isFinite(qty) || qty <= 0) {
      toast({
        variant: "destructive",
        title: "Transfer quantity required",
        description: "Enter the kilograms to move from the other plant.",
      });
      return;
    }
    mutation.mutate(async () => {
      await wcmService.requestMaterialTransfer({
        assignment_id: String(activeAssignment.id),
        requirement_id: requirementId,
        granule_code_id: String(option.granule_code_id),
        source_location_id: String(option.location_id),
        qty_kg: qty,
      });
      await refetchContext();
      await refetchSatisfaction();
    });
  };

  const handleReceiveMaterialTransfer = (challanId: string) => {
    if (!activeAssignment) return;
    mutation.mutate(async () => {
      await wcmService.receiveMaterialTransfer(
        String(activeAssignment.id),
        challanId,
      );
      await refetchContext();
      await refetchSatisfaction();
    });
  };

  const handlePushToOperator = () => {
    if (!activeAssignment) return;
    const submittedDraftVersion = materialIssueDraftVersionRef.current;
    const submittedJobId = selectedJobId;
    mutation.mutate(async () => {
      if (isReleasedToMachine) {
        throw new Error("This job is already released to machine execution.");
      }
      if (!canPushToOperator) {
        throw new Error(
          pushBlockingReasons[0] || "Requirements are not fully satisfied.",
        );
      }
      if (!selectedMachineId) {
        throw new Error("Machine must be selected before push.");
      }
      // Ensure machine assignment is persisted before push.
      if (
        String(activeAssignment.assigned_machine || "") !==
        String(selectedMachineId)
      ) {
        await wcmService.assignMachine(activeAssignment.id, selectedMachineId);
      }
      if (satisfactionStatus?.input_form === "ROLL" && rollsMissingPool > 0) {
        await wcmService.autoSatisfy(activeAssignment.production_job);
      }
      // Mark ready for operator
      await wcmService.markReady(
        activeAssignment.id,
        materialIssuePayload as any[],
      );
      if (
        materialIssueDraftVersionRef.current === submittedDraftVersion &&
        hydratedMaterialJobRef.current === submittedJobId
      ) {
        setMaterialIssueDirty(false);
        setMaterialIssuePickerOpen(false);
      }
      setActiveAssignmentId(null);
      await refetchContext();
      await refetchSatisfaction();
      queryClient.invalidateQueries({ queryKey: ["wcm-queue", wcId] });
    });
  };

  const handleAssignAndMaybeRelease = (
    event?: MouseEvent<HTMLButtonElement>,
  ) => {
    event?.preventDefault();
    event?.stopPropagation();
    if (!activeAssignment) {
      toast({
        variant: "destructive",
        title: "No job selected",
        description: "Pick a queue job before assigning a machine.",
      });
      return;
    }
    if (!selectedMachineId) {
      toast({
        variant: "destructive",
        title: "Machine required",
        description: "Select a machine before release.",
      });
      return;
    }
    if (!currentStepIssueOk) {
      toast({
        variant: "destructive",
        title: "Current-step issue not done",
        description:
          currentStepIssueBlocker ||
          "Finish the current-step issue before assigning a machine.",
      });
      return;
    }
    if (selectedMachineUnavailable) {
      toast({
        variant: "destructive",
        title: "Machine unavailable",
        description:
          pushBlockingReasons.find((reason) => reason.startsWith("Machine:")) ||
          "Pick an idle machine before release.",
      });
      return;
    }
    setAssignConflict(null);
    const submittedDraftVersion = materialIssueDraftVersionRef.current;
    const submittedJobId = selectedJobId;
    mutation.mutate(async () => {
      if (isReleasedToMachine) {
        throw new Error("This job is already released to machine execution.");
      }
      if (
        String(activeAssignment.assigned_machine || "") !==
        String(selectedMachineId)
      ) {
        try {
          const updated = await wcmService.assignMachine(
            activeAssignment.id,
            selectedMachineId,
          );
          if (updated?.assigned_machine) {
            setSelectedMachineId(String(updated.assigned_machine));
          }
        } catch (err: any) {
          if (err?.response?.status === 409) {
            const conflictJob = err?.response?.data?.conflicting_job_number;
            const detail = err?.response?.data?.detail || "Machine is busy.";
            setAssignConflict(
              conflictJob ? `${detail} (running ${conflictJob})` : detail,
            );
            throw new Error(
              conflictJob ? `Machine busy — running ${conflictJob}` : detail,
            );
          }
          throw err;
        }
      }
      if (!canPushToOperator) {
        return;
      }
      if (satisfactionStatus?.input_form === "ROLL" && rollsMissingPool > 0) {
        await wcmService.autoSatisfy(activeAssignment.production_job);
      }
      const released = await wcmService.markReady(
        activeAssignment.id,
        materialIssuePayload as any[],
      );
      // Resume polling only for the draft this successful request saved.
      // An edit or job switch while the request was pending remains protected.
      if (
        materialIssueDraftVersionRef.current === submittedDraftVersion &&
        hydratedMaterialJobRef.current === submittedJobId
      ) {
        setMaterialIssueDirty(false);
        setMaterialIssuePickerOpen(false);
      }
      if (released?.assigned_machine) {
        setSelectedMachineId(String(released.assigned_machine));
      }
      setActiveAssignmentId(String(released?.id || activeAssignment.id));
      await refetchContext();
      await refetchSatisfaction();
      queryClient.invalidateQueries({ queryKey: ["wcm-queue", wcId] });
      queryClient.invalidateQueries({ queryKey: ["wcm-stats", wcId] });
    });
  };

  const handleCloseJobAction = () => {
    if (!closeJobAction) return;
    mutation.mutate(async () => {
      await wcmService.closeJob(
        closeJobAction.assignment.id,
        closeJobAction.mode,
        closeJobReason.trim(),
      );
      setCloseJobAction(null);
      setCloseJobReason("");
      setCloseJobReasonPreset("");
      setActiveAssignmentId(null);
      await refetchContext();
      await refetchSatisfaction();
      queryClient.invalidateQueries({ queryKey: ["wcm-queue", wcId] });
      queryClient.invalidateQueries({ queryKey: ["wcm-history", wcId] });
    });
  };

  const handleSkipNextStepAction = () => {
    if (!skipNextStepAction) return;
    mutation.mutate(async () => {
      await wcmService.skipNextStep(
        String(skipNextStepAction.previousJob.id),
        String(skipNextStepAction.option.job_id),
        skipNextStepReason.trim(),
      );
      setSkipNextStepAction(null);
      setSkipNextStepReason("");
      await refetchContext();
      await refetchSatisfaction();
      queryClient.invalidateQueries({ queryKey: ["wcm-queue", wcId] });
      queryClient.invalidateQueries({ queryKey: ["wcm-history", wcId] });
      queryClient.invalidateQueries({ queryKey: ["wcm-stats", wcId] });
    });
  };

  if (!authLoading && user && !hasProductionAccess) {
    return (
      <div
        className="flex min-h-[60vh] items-center justify-center p-6"
        data-testid="wcm-access-denied"
      >
        <div className="max-w-md rounded-2xl border border-danger-border bg-danger-bg p-6 text-center shadow-sm">
          <AlertCircle className="mx-auto mb-3 h-10 w-10 text-danger-fg" />
          <div className="text-lg font-semibold text-danger-fg">
            Access denied
          </div>
          <p className="mt-1 text-sm text-danger-fg">
            Your role ({userRole || "n/a"}) does not have{" "}
            <code className="font-mono">production.view</code> or
            <code className="font-mono"> production.manage</code> permission for
            the Work Center terminal.
          </p>
          <a
            href="/dashboard"
            className="mt-4 inline-flex items-center rounded-lg bg-danger-solid px-3 py-2 text-sm font-semibold text-white hover:bg-danger-solid"
          >
            Back to dashboard
          </a>
        </div>
      </div>
    );
  }

  if ((queueIsLoadingError || queueIsError) && !isLoading && assignmentsList.length === 0) {
    return (
      <div
        className="flex min-h-[60vh] items-center justify-center p-6"
        data-testid="wcm-queue-error"
      >
        <div className="max-w-md rounded-2xl border border-danger-border bg-surface-1 p-6 text-center shadow-sm">
          <AlertCircle className="mx-auto mb-3 h-10 w-10 text-danger-fg" />
          <div className="text-lg font-semibold text-danger-fg">
            Failed to load work-center queue
          </div>
          <div className="mt-1 text-xs text-content-3">
            {String((queueError as any)?.message || "Network or server error")}
          </div>
          <Button
            type="button"
            onClick={() => refetchQueue()}
            className="mt-4 bg-danger-solid text-white hover:bg-danger-solid"
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

  // First-load skeleton: render the page shell with placeholder cards instead
  // of a fullscreen spinner (queries use placeholderData: keepPreviousData, so
  // isLoading is only true before the very first response).
  const showQueueSkeleton = isLoading && assignmentsList.length === 0;
  const showStatsSkeleton =
    (isLoading || isLoadingStats) && !wcStats && assignmentsList.length === 0;

  const targetSpec = (executionContext as any)?.target_roll_invariants || {};
  const selectedTargetStockContract = ((activeAssignment as any)
    ?.target_stock_contract ||
    (selectedJob as any)?.target_stock_contract ||
    {}) as Record<string, any>;
  const selectedProcessCapabilities =
    selectedTargetStockContract?.process_capabilities || {};
  const selectedTargetStockForm = firstNonEmpty(
    selectedTargetStockContract.stock_form,
    (selectedJob as any)?.stock_form,
    (selectedJob as any)?.geometry?.stock_form,
    (selectedJob as any)?.geometry_snapshot?.stock_form,
    "OPEN_WEB",
  );
  const selectedTargetWidthBasis = firstNonEmpty(
    selectedTargetStockContract.width_basis,
    (selectedJob as any)?.width_basis,
    (selectedJob as any)?.geometry?.width_basis,
    (selectedJob as any)?.geometry_snapshot?.width_basis,
  );
  const selectedTargetWidth = toNullableNumber(
    selectedTargetStockContract.width_mm ??
      selectedTargetStockContract.film_area_width_mm ??
      (executionContext as any)?.target_roll_invariants?.min_width_mm ??
      (selectedJob as any)?.geometry?.child_target_width_mm ??
      (selectedJob as any)?.geometry_snapshot?.child_target_width_mm,
  );
  const selectedStockOutputMode = String(
    selectedProcessCapabilities?.stock_form_output_mode || "PRESERVE",
  ).toUpperCase();
  const selectedAllowedInputForms = Array.isArray(
    selectedProcessCapabilities?.allowed_input_stock_forms,
  )
    ? selectedProcessCapabilities.allowed_input_stock_forms
    : [];
  const selectedAllowedOutputForms = Array.isArray(
    selectedProcessCapabilities?.allowed_output_stock_forms,
  )
    ? selectedProcessCapabilities.allowed_output_stock_forms
    : [];
  const stockFormConversionLabel =
    selectedStockOutputMode === "TARGET_DECIDES"
      ? "Target decides output form"
      : selectedStockOutputMode === "CONVERTS_FORM"
        ? "Process converts stock form"
        : selectedStockOutputMode === "OPERATOR_DECIDES"
          ? "Operator selects allowed output form"
          : "Preserve input stock form";
  const currentStepPolicyItems = currentStepPolicy?.items || [];
  const hasEditableCurrentStepPolicy = currentStepPolicyItems.length > 0;
  const hasActiveStepPolicyOverride = currentStepPolicyItems.some((item) =>
    Boolean(activeStepPolicyOverrides[item.policy_key]),
  );
  const hasStepPolicyChangeIntent =
    hasActiveStepPolicyOverride ||
    currentStepPolicyItems.some(
      (item) =>
        String(item.policy_source || "")
          .toUpperCase()
          .includes("OVERRIDE") && !activeStepPolicyOverrides[item.policy_key],
    );
  const selectedProductName = productNameFromJob(selectedJob, executionContext);
  const selectedGeometry = geometryFromJob(selectedJob, executionContext);
  const selectedMaterialSpecs = materialSpecsFromJob(
    selectedJob,
    executionContext,
  );
  const selectedStepName = firstNonEmpty(
    currentStepPolicy?.current_process_name,
    (executionContext as any)?.current_step?.process_name,
    selectedJob?.process_code,
    "Current step",
  );

  const selectedSpec = normalizeProductSpec(selectedJob, executionContext);
  const selectedDetailStepTarget = stepTargetPrimary;
  const selectedDetailStepRemaining = stepRemainingPrimary;
  const selectedIssueUoms = Array.from(
    new Set(materialIssueRows.map((row: any) => materialIssueUom(row))),
  );
  const selectedIssueTarget = materialIssueRows.reduce(
    (sum: number, row: any) => sum + materialIssueTargetKg(row),
    0,
  );
  const selectedIssueTargetLabel =
    materialIssueRows.length > 0 && selectedIssueUoms.length === 1
      ? `${formatSmartValue(
          selectedIssueTarget,
          selectedIssueUoms[0] as "KG" | "PCS",
          selectedIssueUoms[0] === "PCS" ? 0 : 3,
        )} ${selectedIssueUoms[0]}`
      : "";
  const selectedContextPending = Boolean(selectedJobId) && !executionContext;
  const selectedStepTargetLabel = selectedContextPending
    ? "Loading current job…"
    : selectedDetailStepTarget != null
      ? `${formatSmartValue(selectedDetailStepTarget, selectedPrimaryUom, selectedPrimaryDecimals)} ${selectedPrimaryUom}`
      : `${Number(stepTargetKg || 0).toLocaleString(undefined, {
          maximumFractionDigits: 3,
        })} kg`;
  const selectedStepRemainingLabel = selectedContextPending
    ? "Loading current job…"
    : selectedDetailStepRemaining != null
      ? `${formatSmartValue(selectedDetailStepRemaining, selectedPrimaryUom, selectedPrimaryDecimals)} ${selectedPrimaryUom}`
      : "—";
  const selectedLineItemUomRaw = String(
    (selectedJob as any)?.uom || selectedPrimaryUom || "KG",
  ).toUpperCase();
  const selectedLineItemUom =
    selectedLineItemUomRaw === "PCS" ? "PCS" : "KG";
  const selectedLineItemQty =
    toNullableNumber((selectedJob as any)?.quantity) ??
    (selectedLineItemUom === "KG" ? orderTotalKg : null);
  const selectedFinalRequiredLabel =
    selectedLineItemQty != null
      ? `${formatSmartValue(
          selectedLineItemQty,
          selectedLineItemUom,
          selectedLineItemUom === "PCS" ? 0 : 3,
        )} ${selectedLineItemUom}`
      : `${formatSmartValue(orderTotalKg, "KG", 3)} KG`;
  const selectedFinalRemainingValue = toNullableNumber(
    (selectedJob as any)?.remaining_qty ??
      (selectedJob as any)?.order_remaining_primary ??
      (selectedJob as any)?.order_remaining_qty ??
      (selectedJob as any)?.remaining_qty_kg,
  );
  const selectedFinalRemainingLabel =
    selectedFinalRemainingValue != null
      ? `${formatSmartValue(
          selectedFinalRemainingValue,
          selectedLineItemUom,
          selectedLineItemUom === "PCS" ? 0 : 3,
        )} ${selectedLineItemUom}`
      : "—";
  const selectedStepContractLabel = [
    selectedInputForm || "Input",
    selectedOutputForm || "Output",
  ].join(" → ");
  const selectedStepMeasureLabel = selectedIssueTargetLabel
    ? `Issue ${selectedIssueTargetLabel}`
    : `Target ${selectedStepTargetLabel}${
        selectedStepRemainingLabel !== "—"
          ? ` · Rem ${selectedStepRemainingLabel}`
          : ""
      }`;
  const selectedFinalOutputLabel = [
    selectedOutputForm || selectedSpec.size.finishedGoodType || "Output",
    selectedSpec.size.label || selectedGeometry.label,
  ]
    .filter(Boolean)
    .join(" · ");
  const selectedOrderNumberLabel =
    selectedJob?.order_number || selectedSpec.orderNumber || "SO not captured";
  const selectedCustomerLabel =
    selectedJob?.customer_name ||
    selectedSpec.customerName ||
    "Customer not captured";
  const selectedJobNumberLabel = firstNonEmpty(
    (selectedJob as any)?.job_number,
    (activeAssignment as any)?.job_number,
  );
  const selectedProductionBatchLabel = productionBatchLabel(selectedJob);
  const selectedRouteNodeLabel = routeNodeLabel(selectedJob);
  const selectedTargetWidthLabel =
    selectedTargetWidth && selectedTargetWidth > 0
      ? mmWithInches(selectedTargetWidth)
      : "";
  const selectedContractDetailLabel = [
    stockFormLabel(selectedTargetStockForm),
    selectedTargetWidthBasis ? widthBasisLabel(selectedTargetWidthBasis) : "",
    selectedTargetWidthLabel,
  ]
    .filter(Boolean)
    .join(" · ");
  const selectedStepMaterialSource = materialIssueRows.length
    ? materialIssueRows
    : selectedMaterialSpecs.length
      ? selectedMaterialSpecs
      : currentStepPolicyItems;
  const selectedStepMaterialRows = selectedStepMaterialSource.map(
    (row: any, index: number) => {
      const hasIssueRow =
        row?.requirement_id ||
        row?.material_name ||
        row?.category_display ||
        row?.category;
      if (hasIssueRow) {
        const targetQty = materialIssueTargetKg(row);
        const availableQty = materialIssueAvailableKg(row);
        return {
          key: String(row?.requirement_id || row?.policy_key || index),
          name: firstNonEmpty(
            row?.material_name,
            row?.category_display,
            row?.category,
            `Material ${index + 1}`,
          ),
          detail: [
            materialIssueKindLabel(row),
            targetQty > 0 ? `Need ${materialIssueQtyLabel(targetQty, row)}` : "",
            availableQty > 0
              ? `Stock ${materialIssueQtyLabel(availableQty, row)}`
              : "",
            firstNonEmpty(row?.location_name),
          ]
            .filter(Boolean)
            .join(" · "),
        };
      }
      return {
        key: String(row?.code || row?.material || row?.policy_key || index),
        name: firstNonEmpty(
          row?.material,
          row?.material_name,
          row?.code,
          `Material ${index + 1}`,
        ),
        detail: [
          firstNonEmpty(row?.grade),
          firstNonEmpty(row?.thickness) ? `${row.thickness}u` : "",
          firstNonEmpty(row?.width) ? `${row.width}mm` : "",
          firstNonEmpty(row?.source),
        ]
          .filter(Boolean)
          .join(" · "),
      };
    },
  );
  const currentWorkList =
    activeMainTab === "running"
      ? pagedRunningAssignments
      : pagedQueueAssignments;
  const currentWorkTotal =
    activeMainTab === "running"
      ? visibleRunningAssignments.length
      : visibleQueueAssignments.length;
  const currentWorkPage = activeMainTab === "running" ? runningPage : queuePage;
  const currentWorkPageCount =
    activeMainTab === "running" ? runningPageCount : queuePageCount;
  const setCurrentWorkPage =
    activeMainTab === "running" ? setRunningPage : setQueuePage;
  const queueCounts = {
    all: baseQueueAssignments.length,
    ready: baseQueueAssignments.filter(
      (a: any) => String(a?.status || "").toUpperCase() === "WC_READY",
    ).length,
    assigned: baseQueueAssignments.filter(
      (a: any) => String(a?.status || "").toUpperCase() === "ASSIGNED",
    ).length,
    executionReady: baseQueueAssignments.filter(
      (a: any) => String(a?.status || "").toUpperCase() === "EXECUTION_READY",
    ).length,
    noMachine: baseQueueAssignments.filter((a: any) => !a?.assigned_machine)
      .length,
  };
  const blockerLabel = isReleasedToMachine
    ? "Execution ready"
    : pushBlockingReasons.length
      ? `${pushBlockingReasons.length} blocker${pushBlockingReasons.length > 1 ? "s" : ""}`
      : "Ready";
  const materialReleaseCheckCount =
    materialIssueErrors.length + overPickErrors.length;
  const materialReleaseLabel = materialReleaseCheckCount
    ? `${materialReleaseCheckCount} check${materialReleaseCheckCount > 1 ? "s" : ""}`
    : materialIssueRows.length
      ? "Issue ready"
      : "No issue";
  const materialGateOk =
    materialIssueErrors.length === 0 && overPickErrors.length === 0;
  const currentStepIssueOk =
    requirementsSatisfied && materialGateOk && !detailMaterialBlocked;
  const currentStepIssueBlocker = !requirementsSatisfied
    ? "Current-step input stock is not ready."
    : detailMaterialBlocked
      ? detailMaterialBlockReason || "Material is blocked for this step."
      : materialIssueErrors[0] ||
        overPickErrors[0] ||
        "Finish current-step issue before assigning a machine.";
  const machineGateLabel = isReleasedToMachine
    ? "Execution ready"
    : !currentStepIssueOk
      ? "Finish issue first"
      : !selectedMachineId
      ? "Pick machine"
      : canPushToOperator
        ? "Ready to release"
        : "Release locked";
  const machineGateHelp = isReleasedToMachine
    ? "This job is already released. Preparation controls are locked and execution continues on the machine terminal."
    : !currentStepIssueOk
      ? currentStepIssueBlocker
    : !selectedMachineId
      ? "Select a machine after the current-step issue is complete."
      : canPushToOperator
        ? "Machine and current-step input checks are clear. This action releases the job."
        : pushBlockingReasons[0] ||
          "Complete material and roll checks before release.";
  const rollGateOk = satisfactionStatus?.input_form !== "ROLL" || rollOk;
  const machineGateOk =
    isReleasedToMachine ||
    (Boolean(selectedMachineId) &&
      !assignConflict &&
      !selectedMachineUnavailable);
  const cylinderGateOk =
    !detailRequiresCylinderGate || detailCylinderStatus !== "MISSING";
  const releaseGateItems = [
    {
      key: "material",
      label: "Current-step issue",
      ok: requirementsSatisfied && materialGateOk && !detailMaterialBlocked,
    },
    { key: "rolls", label: "Rolls allocated", ok: rollGateOk },
    { key: "machine", label: "Machine assigned", ok: machineGateOk },
    detailRequiresCylinderGate
      ? { key: "cylinder", label: "Cylinders & artwork", ok: cylinderGateOk }
      : null,
  ].filter(
    (gate): gate is { key: string; label: string; ok: boolean } =>
      Boolean(gate),
  );
  const releaseGateGreenCount = releaseGateItems.filter(
    (gate) => gate.ok,
  ).length;
  const releaseGateProgress = Math.round(
    (releaseGateGreenCount / releaseGateItems.length) * 100,
  );
  const activeHasStartedExecution = assignmentHasMachineStart(activeAssignment);
  const canCancelActiveFromWcm =
    Boolean(activeAssignment) &&
    (!isReleasedToMachine || !activeHasStartedExecution);
  const canShortCloseActiveFromWcm =
    Boolean(activeAssignment) && activeHasStartedExecution;

  // Side detail pane content, shared between the inline xl column and the
  // tablet (md..xl) Sheet so a long queue never forces scrolling past it.
  // Job pane in steps (approved WC terminal sample): each step's state and one-line summary, and
  // which steps are open. The step that needs attention opens itself until the user opens others.
  const rollsNeeded = satisfactionStatus?.input_form === "ROLL";
  const issueGateOk = requirementsSatisfied && materialGateOk && !detailMaterialBlocked;
  const stepStates: Record<WcmStepKey, WcmStepState> = {
    order: detailMaterialBlocked ? "bad" : "ok",
    machine: isReleasedToMachine
      ? "lock"
      : machineGateOk
        ? "ok"
        : issueGateOk && (rollGateOk || !rollsNeeded)
          ? "warn"
          : "todo",
    rolls: !rollsNeeded ? "skip" : isReleasedToMachine ? "lock" : rollGateOk ? "ok" : "warn",
    issue: isReleasedToMachine
      ? "lock"
      : !materialIssueRows.length
        ? detailMaterialBlocked
          ? "bad"
          : "skip"
        : issueGateOk
          ? "ok"
          : detailMaterialBlocked
            ? "bad"
            : "warn",
    release: isReleasedToMachine ? "lock" : canPushToOperator ? "ok" : "warn",
  };
  const openGateCount = releaseGateItems.filter((gate) => !gate.ok).length;
  const stepSummaries: Record<WcmStepKey, string> = {
    order: [selectedProductName, selectedRouteNodeLabel].filter(Boolean).join(" · ") || String(selectedOrderNumberLabel || "Order"),
    machine: isReleasedToMachine
      ? `${assignedMachineName || selectedMachine?.name || "Machine"} · locked`
      : selectedMachine?.name || "Not assigned",
    rolls: rollsNeeded ? String(rollAllocationLabel || "Rolls") : "Bulk input · no rolls",
    issue: materialIssueRows.length
      ? `${materialIssueRows.length} material${materialIssueRows.length === 1 ? "" : "s"}${materialReleaseCheckCount ? ` · ${materialReleaseCheckCount} to fix` : ""}`
      : "None needed",
    release: isReleasedToMachine
      ? "Released to machine"
      : canPushToOperator
        ? "All gates clear"
        : `${openGateCount} gate${openGateCount === 1 ? "" : "s"} open`,
  };
  const stepPaneKey = String((activeAssignment as any)?.id || selectedJobId || "");
  const defaultOpenSteps = (): WcmStepKey[] => {
    if (activeMainTab === "running" || isReleasedToMachine) return ["order", "machine"];
    // Issue first (machine release waits for it), then rolls, then the machine. A step with
    // nothing to enter never opens on its own.
    const first = (["issue", "rolls", "machine"] as WcmStepKey[]).find(
      (key) =>
        (stepStates[key] === "warn" || stepStates[key] === "bad") && (key !== "issue" || materialIssueRows.length > 0),
    );
    const list: WcmStepKey[] = ["order", first || "release"];
    if (codesFor && !list.includes("issue")) list.push("issue");
    return list;
  };
  const stepDataReady = Boolean(stepPaneKey && executionContext && satisfactionStatus);
  const openStepList = (openSteps[stepPaneKey] as WcmStepKey[] | undefined) ?? defaultOpenSteps();
  if (stepDataReady && !openSteps[stepPaneKey]) {
    // Adjusting state while rendering (React's "previous render" pattern): runs once per job.
    setOpenSteps((prev) => (prev[stepPaneKey] ? prev : { ...prev, [stepPaneKey]: openStepList }));
  }
  const isStepOpen = (key: WcmStepKey) => openStepList.includes(key);
  const toggleStep = (key: WcmStepKey) =>
    setOpenSteps((prev) => {
      const current = (prev[stepPaneKey] as WcmStepKey[] | undefined) ?? defaultOpenSteps();
      return {
        ...prev,
        [stepPaneKey]: current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
      };
    });
  const openStep = (key: string) => {
    const step = key as WcmStepKey;
    setOpenSteps((prev) => {
      const current = (prev[stepPaneKey] as WcmStepKey[] | undefined) ?? defaultOpenSteps();
      return current.includes(step) ? { ...prev, [stepPaneKey]: current } : { ...prev, [stepPaneKey]: [...current, step] };
    });
    window.setTimeout(() => {
      const section = document.getElementById(`wcm-step-${step}`);
      const scroller = section?.closest('[data-testid="wcm-pane-scroll"]') as HTMLElement | null;
      if (!section || !scroller) return;
      const top = section.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 8;
      scroller.scrollTo({ top, behavior: "smooth" });
    }, 60);
  };
  const gateReason = (key: string) =>
    key === "material"
      ? currentStepIssueBlocker
      : key === "rolls"
        ? pushBlockingReasons.find((reason) => /roll/i.test(reason)) || "Rolls pending"
        : key === "machine"
          ? selectedMachineId
            ? "Selected machine is not available"
            : "Machine not assigned"
          : "Cylinders or artwork missing";

  const workCenterDisplayName = String(workCenter?.name || (activeAssignment as any)?.work_center_name || "Work center");
  const selectedStepPositionLabel = currentStepNumber ? `step ${currentStepNumber}` : "";
  const detailStatus = String((activeAssignment as any)?.status || "WC_READY").toUpperCase();
  const detailPriority = Number((selectedJob as any)?.priority ?? 50);
  const detailStepCount = toNullableNumber(
    (executionContext as any)?.route_step_count ??
      (executionContext as any)?.job?.route_step_count ??
      (selectedJob as any)?.route_step_count ??
      (selectedJob as any)?.total_steps,
  );
  const detailOrderedQty = selectedLineItemQty;
  const detailRemainingQty = selectedFinalRemainingValue;
  const detailProducedQty =
    toNullableNumber((selectedJob as any)?.order_produced_primary ?? (selectedJob as any)?.order_produced_qty) ??
    (detailOrderedQty != null && detailRemainingQty != null ? Math.max(0, detailOrderedQty - detailRemainingQty) : null);
  const detailOrderPercent =
    detailOrderedQty && detailOrderedQty > 0 && detailProducedQty != null
      ? Math.min(100, Math.max(0, Math.round((detailProducedQty / detailOrderedQty) * 100)))
      : 0;
  const detailQtyText = (value: number | null) =>
    value == null ? "—" : formatSmartValue(value, selectedLineItemUom, selectedLineItemUom === "PCS" ? 0 : 3);
  const detailMadeLine = madeLineFor(
    spineQuery.data?.made,
    String((selectedJob as any)?.sales_order_item_id || (selectedJob as any)?.sales_order_item || ""),
  );
  const detailSkuCode = firstNonEmpty(
    (selectedJob as any)?.sku_code,
    (selectedJob as any)?.sku_variant_code,
    selectedSpec.variantCode,
  );
  stepSummaries.order = [
    detailOrderedQty != null ? `${detailQtyText(detailOrderedQty)} ${selectedLineItemUom} ordered` : "",
    detailProducedQty != null ? `${detailQtyText(detailProducedQty)} ${selectedLineItemUom} made` : "",
    [selectedStepName, currentStepNumber ? `${currentStepNumber}${detailStepCount ? `/${detailStepCount}` : ""}` : ""].filter(Boolean).join(" "),
  ]
    .filter(Boolean)
    .join(" · ") || stepSummaries.order;
  const detailPaneContent = (
    <div className="flex h-full min-h-0 flex-col" data-testid="wcm-pane">
      <div className="shrink-0 border-b border-line bg-surface-1 px-4 pb-3 pt-3" data-testid="wcm-pane-head">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-content-3">
              <span>{selectedStepName || workCenterDisplayName}</span>
              {currentStepNumber ? (
                <span>
                  · step {currentStepNumber}
                  {detailStepCount ? ` of ${detailStepCount}` : ""}
                </span>
              ) : null}
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-md border px-1.5 py-px text-[11px] font-semibold normal-case tracking-normal",
                  activeMainTab === "running" || detailStatus === "EXECUTION_READY"
                    ? "border-success-border bg-success-bg text-success-fg"
                    : detailStatus === "ASSIGNED"
                      ? "border-success-border bg-success-bg text-success-fg"
                      : "border-info-border bg-info-bg text-info-fg",
                )}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
                {activeMainTab === "running"
                  ? "Running / ready"
                  : detailStatus === "EXECUTION_READY"
                    ? "Execution ready"
                    : detailStatus === "ASSIGNED"
                      ? `Assigned${assignedMachineName ? ` · ${assignedMachineName}` : ""}`
                      : "WC Ready"}
              </span>
              <span
                className={cn(
                  "rounded-md border px-1.5 py-px font-mono text-[11px] font-bold normal-case tracking-normal",
                  detailPriority >= 80
                    ? "border-danger-border bg-danger-bg text-danger-fg"
                    : detailPriority >= 50
                      ? "border-warning-border bg-warning-bg text-warning-fg"
                      : "border-order-border bg-order-bg text-order-fg",
                )}
              >
                ▲ {detailPriority}
              </span>
            </div>
            <div className="mt-1 flex min-w-0 items-start gap-2" data-testid="wcm-pane-job">
              <span className="mt-0.5 shrink-0 rounded bg-primary px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-white">Job</span>
              <span
                className="line-clamp-2 min-w-0 font-mono text-[18px] font-bold leading-tight tracking-[-0.01em] text-primary"
                title={String((selectedJob as any)?.job_name || selectedJobNumberLabel || "")}
              >
                {(selectedJob as any)?.job_name || selectedJobNumberLabel || selectedOrderNumberLabel}
              </span>
            </div>
            <div className="mt-1 truncate text-[12.5px] text-content-3" title={[selectedCustomerLabel, selectedOrderNumberLabel, selectedJobNumberLabel, selectedProductName].filter(Boolean).join(" · ")}>
              <b className="font-semibold text-content-1">{selectedCustomerLabel}</b>
              <span> · {selectedOrderNumberLabel}</span>
              {selectedJobNumberLabel ? <span> · Job {selectedJobNumberLabel}</span> : null}
              {selectedProductionBatchLabel ? <span> · {selectedProductionBatchLabel}</span> : null}
              {selectedProductName ? <span> · {selectedProductName}</span> : null}
            </div>
          </div>
          <TooltipProvider delayDuration={100}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-semibold",
                    isReleasedToMachine
                      ? "border-success-border bg-success-bg text-success-fg"
                      : pushBlockingReasons.length
                        ? detailMaterialBlocked
                          ? "border-danger-border bg-danger-bg text-danger-fg"
                          : "border-warning-border bg-warning-bg text-warning-fg"
                        : "border-success-border bg-success-bg text-success-fg",
                  )}
                  data-testid="wcm-pane-blockers"
                >
                  <span className="h-2 w-2 rounded-full bg-current" aria-hidden />
                  {blockerLabel}
                </span>
              </TooltipTrigger>
              <TooltipContent side="left" className="max-w-[320px] rounded-xl border-line bg-surface-1 p-3 text-content-2 shadow-xl">
                {pushBlockingReasons.length ? (
                  pushBlockingReasons.slice(0, 6).map((reason) => (
                    <div key={reason} className="text-xs font-semibold">
                      {reason}
                    </div>
                  ))
                ) : (
                  <div className="text-xs font-semibold">Machine and material checks are ready.</div>
                )}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <nav className="mt-2.5 grid grid-cols-5 gap-1.5" aria-label="Steps" data-testid="wcm-step-rail">
          {(
            [
              ["order", "1", "Order", selectedStepName || stepSummaries.order],
              ["machine", "2", "Machine", stepSummaries.machine],
              ["rolls", "3", "Rolls", rollsNeeded ? String(stepSummaries.rolls).split(" · ")[0] : "bulk input"],
              ["issue", "4", "Issue", materialIssueRows.length ? `${materialIssueRows.length} material${materialIssueRows.length === 1 ? "" : "s"}` : "none"],
              ["release", "5", "Release", stepSummaries.release],
            ] as const
          ).map(([key, no, title, sub]) => (
            <button
              key={key}
              type="button"
              data-state={stepStates[key]}
              data-testid={`wcm-rail-${key}`}
              onClick={() => openStep(key)}
              className={cn(
                "min-w-0 rounded-xl border px-2 py-1.5 text-left transition-colors hover:brightness-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                stepStates[key] === "ok"
                  ? "border-success-border bg-success-bg"
                  : stepStates[key] === "warn"
                    ? "border-warning-border bg-warning-bg"
                    : stepStates[key] === "bad"
                      ? "border-danger-border bg-danger-bg"
                      : stepStates[key] === "lock"
                        ? "border-line bg-surface-2"
                        : "border-line bg-surface-1",
                isStepOpen(key) && "ring-2 ring-primary/40",
              )}
            >
              <span className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2">
                <span className="row-span-2">
                  <WcmStepBadge state={stepStates[key]} no={no} />
                </span>
                <span className="truncate text-[12.5px] font-semibold text-content-1">{title}</span>
                <span
                  className={cn(
                    "truncate text-[11px]",
                    stepStates[key] === "warn" ? "text-warning-fg" : stepStates[key] === "bad" ? "text-danger-fg" : stepStates[key] === "ok" ? "text-success-fg" : "text-content-3",
                  )}
                >
                  {sub}
                </span>
              </span>
            </button>
          ))}
        </nav>
      </div>
      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto overscroll-contain bg-surface-2/40 p-3" data-testid="wcm-pane-scroll">
      <WcmStepSection id="order" no="1" title="Order · what it is" summary={stepSummaries.order} state={stepStates.order} open={isStepOpen("order")} onToggle={() => toggleStep("order")}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="wcm-order-stats">
          <WcmStat label="Ordered" value={detailQtyText(detailOrderedQty)} unit={selectedLineItemUom} />
          <WcmStat
            label="Produced"
            value={detailQtyText(detailProducedQty)}
            unit={selectedLineItemUom}
            sub={`${detailOrderPercent}% of order`}
          />
          <WcmStat label="Remaining" value={detailQtyText(detailRemainingQty)} unit={selectedLineItemUom} tone="info" />
          <WcmStat
            label="Blockers"
            value={isReleasedToMachine ? "Released" : pushBlockingReasons.length || "Clear"}
            sub={isReleasedToMachine ? "running on the machine terminal" : pushBlockingReasons[0] || "nothing holds release"}
            tone={isReleasedToMachine ? "done" : pushBlockingReasons.length ? (detailMaterialBlocked ? "block" : "wait") : "done"}
          />
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
          <span
            className={cn("block h-full rounded-full", detailMaterialBlocked ? "bg-danger-solid" : detailOrderPercent >= 100 ? "bg-success-fg" : "bg-primary")}
            style={{ width: `${detailOrderPercent}%` }}
          />
        </div>
        {spineQuery.data?.made ? (
          <WcmJobPlate made={spineQuery.data.made} line={detailMadeLine} code={detailSkuCode} stepName={selectedStepName} testId="wcm-made-card" />
        ) : (
          <SpecBlock data={specFromSource(selectedJob)} size="md" testId="wcm-pane-spec" />
        )}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="wcm-step-stats">
          <WcmStat
            label="Current step"
            value={<span className="font-sans text-[14px] font-semibold">{selectedStepName || "—"}</span>}
            sub={`${currentStepNumber ? `step ${currentStepNumber}${detailStepCount ? ` of ${detailStepCount}` : ""} · ` : ""}${selectedStepContractLabel}`}
          />
          <WcmStat label="Step target" value={<span className="text-[15px]">{selectedStepTargetLabel}</span>} />
          <WcmStat label="Step remaining" value={<span className="text-[15px]">{selectedStepRemainingLabel}</span>} />
          <WcmStat label="Issue plan" value={<span className="text-[15px]">{selectedIssueTargetLabel || "No issue"}</span>} />
        </div>
        {selectedJobId ? <OrderSpine jobId={String(selectedJobId)} current="floor" compact testId="wcm-order-spine" /> : null}
        <details className="group rounded-xl border border-line bg-surface-1" data-testid="wcm-order-facts">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-[12.5px] font-semibold text-content-2 marker:hidden">
            <Layers className="size-4 text-content-3" aria-hidden />
            Order facts · stock contract · production spec
            <span className="ml-auto truncate text-[11.5px] font-medium text-content-3">
              {selectedCustomerLabel} · {selectedOrderNumberLabel}
            </span>
            <ChevronDown className="size-3.5 shrink-0 text-content-3 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <div className="space-y-3 border-t border-line p-3">
            <div className="flex gap-2 rounded-lg border border-order-border bg-order-bg px-3 py-2 text-[12.5px] text-content-2">
              <Layers className="mt-0.5 size-4 shrink-0 text-order-fg" aria-hidden />
              <div>
                <b className="text-content-1">Step stock contract</b> · Required{" "}
                {selectedContractDetailLabel || stockFormLabel(selectedTargetStockForm)} · Input {stockFormListLabel(selectedAllowedInputForms)} · Output{" "}
                {stockFormListLabel(selectedAllowedOutputForms)} · {stockFormConversionLabel}
              </div>
            </div>
            <dl className="grid gap-x-4 gap-y-2.5 sm:grid-cols-2">
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-[0.06em] text-content-3">Customer · SO</dt>
                <dd className="mt-0.5 text-[13px] font-semibold text-content-1">
                  {selectedCustomerLabel} <span className="font-normal text-content-3">· {selectedOrderNumberLabel}</span>
                </dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-[0.06em] text-content-3">Job · batch</dt>
                <dd className="mt-0.5 text-[13px] font-semibold text-content-1">
                  {selectedJobNumberLabel || "—"}
                  {selectedProductionBatchLabel ? <span className="font-normal text-content-3"> · {selectedProductionBatchLabel}</span> : null}
                  {selectedRouteNodeLabel ? <span className="font-normal text-content-3"> · {selectedRouteNodeLabel}</span> : null}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-[0.06em] text-content-3">Artwork</dt>
                <dd className="mt-0.5 text-[13px]">
                  {detailArtworkId || detailArtworkCode || detailArtworkName ? (
                    <ArtworkButton artworkId={detailArtworkId || null} artworkCode={detailArtworkCode || null} artworkName={detailArtworkName || null} />
                  ) : (
                    <span className="text-content-3">none for this step</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-[0.06em] text-content-3">Final output</dt>
                <dd className="mt-0.5 text-[13px] font-semibold text-content-1">
                  {selectedFinalOutputLabel || "—"}
                  <span className="font-normal text-content-3"> · {selectedFinalRequiredLabel}</span>
                </dd>
              </div>
            </dl>
            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-content-3">Production spec rail</div>
              <div className="overflow-hidden rounded-lg bg-plate">
                <ProductionOrderSpecRail source={selectedJob} context={executionContext} className="p-2" dark />
              </div>
            </div>
          </div>
        </details>
      </WcmStepSection>
      <WcmStepSection id="machine" no="2" title="Machine" summary={stepSummaries.machine} state={stepStates.machine} open={isStepOpen("machine")} onToggle={() => toggleStep("machine")}>
        {activeMainTab === "running" ? (
          <section className="order-2 rounded-2xl border border-success-border bg-success-bg p-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-caption uppercase tracking-wider text-success-fg">
                  <span className="grid h-7 w-7 flex-none place-items-center rounded-lg bg-success-fg font-mono text-sm font-bold text-white">2</span>
                  Sent to machine
                </div>
                <div className="mt-1 text-lg font-semibold text-content-1">
                  {assignedMachineName ||
                    selectedMachine?.name ||
                    "Machine assigned"}
                </div>
                <p className="mt-1 text-xs font-semibold text-success-fg">
                  Preparation is locked. Execution changes now happen only inside
                  the machine terminal.
                </p>
              </div>
              <a
                href={
                  assignedMachineId
                    ? `/production/machine/${assignedMachineId}`
                    : "#"
                }
                onClick={(event) => {
                  if (!assignedMachineId) event.preventDefault();
                }}
                className={cn(
                  "inline-flex h-10 items-center rounded-xl px-4 text-sm font-semibold",
                  assignedMachineId
                    ? "bg-primary text-white hover:bg-primary"
                    : "bg-surface-2 text-content-4",
                )}
              >
                Open terminal
              </a>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div className="rounded-xl border border-surface-1 bg-surface-1/80 p-3">
                <div className="text-[12px] font-semibold text-content-3">
                  Machine
                </div>
                <div className="mt-1 text-sm font-semibold text-content-1">
                  {assignedMachineName || selectedMachine?.name || "—"}
                </div>
              </div>
              <div className="rounded-xl border border-surface-1 bg-surface-1/80 p-3">
                <div className="text-[12px] font-semibold text-content-3">
                  Rolls locked
                </div>
                <div className="mt-1 text-sm font-semibold text-content-1">
                  {rollAllocationLabel}
                </div>
              </div>
              <div className="rounded-xl border border-surface-1 bg-surface-1/80 p-3">
                <div className="text-[12px] font-semibold text-content-3">
                  Material policy
                </div>
                <div className="mt-1 text-sm font-semibold text-content-1">
                  {currentStepPolicyItems.length
                    ? `${currentStepPolicyItems.length} step rule${currentStepPolicyItems.length === 1 ? "" : "s"}`
                    : "No step issue rule"}
                </div>
              </div>
            </div>
            {currentStepPolicyItems.length ? (
              <div className="mt-4 space-y-2">
                {currentStepPolicyItems.map((item) => (
                  <div
                    key={`running-policy-${item.policy_key}`}
                    className="rounded-xl border border-surface-1 bg-surface-1/80 px-3 py-2 text-xs"
                  >
                    <div className="font-semibold text-content-1">
                      {item.material_name}
                    </div>
                    <div className="mt-0.5 text-content-3">
                      Template{" "}
                      {policyModeLabel(
                        item.template_issue_policy_mode,
                        item.template_issue_policy_value,
                      )}{" "}
                      · Effective{" "}
                      {policyModeLabel(
                        item.effective_issue_policy_mode,
                        item.effective_issue_policy_value,
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </section>
        ) : (
          <section className="space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-[12px] font-semibold text-content-3">
                Machine assignment
                <span className="font-normal">
                  {" "}
                  · {machineOptionsResolved.length} machine{machineOptionsResolved.length === 1 ? "" : "s"} at this work center
                </span>
              </div>
              <span
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-[11.5px] font-semibold",
                  currentStepIssueOk && canPushToOperator
                    ? "border-success-border bg-success-bg text-success-fg"
                    : currentStepIssueOk && selectedMachineId
                      ? "border-warning-border bg-warning-bg text-warning-fg"
                      : "border-line bg-surface-2 text-content-3",
                )}
              >
                {machineGateLabel}
              </span>
            </div>
            <div role="radiogroup" aria-label="Machine for this job" data-testid="wcm-machine-select" className="grid gap-1.5 sm:grid-cols-2">
              {machineOptionsResolved.map((machine: any) => {
                const machineState: MachineLiveState = machine.state || "IDLE";
                // Keep the already-assigned machine selectable even if it reads busy.
                const isUnavailable = machineState === "DOWN" && String(machine.id) !== assignedMachineId;
                const checked = String(machine.id) === String(selectedMachineId || "");
                const disabled = isReleasedToMachine || mutation.isPending || isUnavailable;
                return (
                  <button
                    key={machine.id}
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    disabled={disabled}
                    data-testid={`wcm-machine-option-${machine.id}`}
                    onClick={() => setSelectedMachineId(String(machine.id))}
                    className={cn(
                      "flex min-h-[52px] items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-55",
                      checked ? "border-primary bg-info-bg ring-1 ring-primary" : "border-line bg-surface-1 hover:bg-surface-2",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "grid h-4 w-4 shrink-0 place-items-center rounded-full border-2",
                        checked ? "border-primary" : "border-line-strong",
                      )}
                    >
                      {checked ? <span className="h-2 w-2 rounded-full bg-primary" /> : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold text-content-1">{machine.name}</span>
                      <span className="block truncate text-[11.5px] text-content-3">
                        {machineState === "DOWN"
                          ? "Down · not available"
                          : machineState === "RUNNING"
                            ? `Running ${machine.current_job_number || "another job"}`
                            : "Idle · ready"}
                      </span>
                    </span>
                    <MachineStateBadge state={machineState} currentJobNumber={machine.current_job_number} />
                  </button>
                );
              })}
              {!machineOptionsResolved.length ? (
                <div className="rounded-xl border border-dashed border-line-strong px-3 py-3 text-center text-[12.5px] text-content-3 sm:col-span-2">
                  No machine is mapped to this work center yet.
                </div>
              ) : null}
            </div>
            <div
              className={cn(
                "flex items-start gap-2 rounded-xl border px-3 py-2 text-[12.5px]",
                currentStepIssueOk && canPushToOperator
                  ? "border-success-border bg-success-bg text-success-fg"
                  : currentStepIssueOk && selectedMachineId
                    ? "border-info-border bg-info-bg text-info-fg"
                    : "border-warning-border bg-warning-bg text-warning-fg",
              )}
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <div>
                <b>{machineGateLabel}</b> · {machineGateHelp}
              </div>
            </div>
            <p className="text-[11.5px] text-content-4">
              One job runs on a machine at a time; a busy machine queues this job. Only bulk → roll steps (extrusion) run several
              orders on one machine.
            </p>
            {assignConflict ? (
              <div
                data-testid="wcm-assign-conflict"
                role="alert"
                className="mt-3 flex items-start gap-2 rounded-xl border border-danger-border bg-danger-bg px-3 py-2 text-xs font-bold text-danger-fg"
              >
                <TriangleAlert className="mt-px size-4 shrink-0" />
                <span>{assignConflict}</span>
              </div>
            ) : null}
          </section>
        )}
      </WcmStepSection>
      {activeMainTab !== "running" ? (
        <>
          <WcmStepSection id="rolls" no="3" title="Rolls by lane" summary={stepSummaries.rolls} state={stepStates.rolls} open={isStepOpen("rolls")} onToggle={() => toggleStep("rolls")} testId="wcm-dossier-needs">
            {satisfactionStatus?.input_form === "ROLL" ? (
              <section>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="wcm-roll-stats">
                  {rollMassMode ? (
                    <WcmStat label="Target" value={rollTargetKg.toFixed(1)} unit="kg" sub={rollBehaviorLabel} />
                  ) : (
                    <WcmStat label="Required" value={rollsRequired} unit="rolls" sub={rollBehaviorLabel} />
                  )}
                  <WcmStat
                    label="Reserved"
                    value={rollMassMode ? rollsReservedKg.toFixed(1) : effectiveRollsReserved}
                    unit={rollMassMode ? "kg" : "rolls"}
                    sub={`${effectiveRollsReserved} roll${Number(effectiveRollsReserved) === 1 ? "" : "s"} reserved`}
                    tone={Number(effectiveRollsReserved) ? "info" : undefined}
                  />
                  <WcmStat label="Lineage" value={lineageRollsAvailable} sub="same-order WIP" tone={Number(lineageRollsAvailable) ? "done" : undefined} />
                  <WcmStat label="Fallback" value={fallbackRollsAvailable} sub="purchased · contract applies" tone={Number(fallbackRollsAvailable) ? "wait" : undefined} />
                </div>
                <div className="mt-2.5 flex gap-2 rounded-lg border border-order-border bg-order-bg px-3 py-2 text-[12.5px] text-content-2">
                  <Layers className="mt-0.5 size-4 shrink-0 text-order-fg" aria-hidden />
                  <div>
                    <b className="text-content-1">Stock form contract</b> · Required {stockFormLabel(selectedTargetStockForm)} · Allowed input{" "}
                    {stockFormListLabel(selectedAllowedInputForms)} · Output policy {stockFormConversionLabel}
                  </div>
                </div>
                {rollGuidanceText ? <p className="mt-2 text-[12px] text-content-3">{rollGuidanceText}</p> : null}
                {rollsMissing > 0 ? (
                  <div className="mt-3 rounded-xl border border-warning-border bg-warning-bg px-3 py-2 text-xs font-semibold text-warning-fg">
                    Assign {rollsMissing} more roll{rollsMissing === 1 ? "" : "s"}{" "}
                    before release.
                    {emptyRollLanes.length ? (
                      <span className="font-normal">
                        {" "}No roll yet: {emptyRollLanes.map((lane) => lane.label).join(", ")}.
                      </span>
                    ) : null}
                  </div>
                ) : shortRollLanes.length ? (
                  <div
                    className="mt-3 rounded-xl border border-info-border bg-info-bg px-3 py-2 text-xs font-semibold text-info-fg"
                    data-testid="wcm-roll-short-note"
                  >
                    Ready to start: every {rollLaneMode ? "layer" : "input"} has a roll.
                    <span className="font-normal">
                      {" "}Still short for the full order:{" "}
                      {shortRollLanes
                        .map((lane) => `${lane.label} ${Number(lane.short_kg).toLocaleString("en-IN", { maximumFractionDigits: 1 })} kg`)
                        .join(" · ")}
                      . Add the next roll before it runs out; this does not hold the release.
                    </span>
                  </div>
                ) : (
                  <div className="mt-3 rounded-xl border border-success-border bg-success-bg px-3 py-2 text-xs font-semibold text-success-fg">
                    Roll requirement is covered for this current step.
                  </div>
                )}
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  {selectedJobId && showRollAllocator ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="border-order-border bg-order-bg text-order-fg hover:bg-order-bg"
                      onClick={() => setTieredPickerOpen(true)}
                    >
                      <Scissors className="mr-1.5 h-3.5 w-3.5" /> Pick with tiers
                    </Button>
                  ) : null}
                  {showRollAllocator ? (
                    <RollAssignmentModal
                      activeAssignment={activeAssignment}
                      targetSpec={targetSpec}
                      targetSpecs={targetRollSpecs}
                      targetStockContract={selectedTargetStockContract}
                      rollBehavior={rollBehavior}
                      targetPlantId={selectedTargetPlantId}
                      targetPlantName={selectedTargetPlantName}
                      targetLocationId={
                        (executionContext as any)?.job?.from_location_id ||
                        (selectedJob as any)?.from_location_id ||
                        (selectedJob as any)?.from_location
                      }
                      targetLocationName={
                        (executionContext as any)?.job?.from_location_name ||
                        (selectedJob as any)?.from_location_name ||
                        (selectedJob as any)?.from_location_display
                      }
                      manualEligibleRolls={rollAllocationCandidates}
                      wipPoolMeta={(executionContext as any)?.wip_pool_meta || {}}
                      rollAssignmentValidation={rollAssignmentValidation}
                      strictSpecMatch={!manualOverrideEnabled}
                      disabled={(isReleasedToMachine && !rollLaneFlow) || !canManualAssign}
                      disabledLabel={
                        isReleasedToMachine && !rollLaneFlow
                          ? "LOCKED"
                          : rollLaneFlow && canAddMoreRolls
                            ? isReleasedToMachine ? "ADD NEXT ROLL" : "ADD ROLL"
                            : rollsMissing <= 0
                              ? "ROLLS ASSIGNED"
                              : "NO FREE SLOT"
                      }
                      required={rollMassMode ? Math.max(1, rollMaxCount) : rollsRequired}
                      manualOverride={manualOverrideEnabled}
                      overrideReason={overrideReason}
                      onAssigned={() => {
                        refetchContext();
                        refetchSatisfaction();
                        queryClient.invalidateQueries({
                          queryKey: ["wip-pool-grouped", selectedJobId],
                        });
                      }}
                    />
                  ) : null}
                  {showRollTransfer ? (
                    <RollTransferModal
                      jobId={activeAssignment?.production_job}
                      targetSpec={targetSpec}
                      targetSpecs={targetRollSpecs}
                      targetStockContract={selectedTargetStockContract}
                      rollBehavior={rollBehavior}
                      targetPlantId={selectedTargetPlantId}
                      targetPlantName={selectedTargetPlantName}
                      targetLocationId={
                        (executionContext as any)?.job?.from_location_id ||
                        (selectedJob as any)?.from_location_id ||
                        (selectedJob as any)?.from_location
                      }
                      targetLocationName={
                        (executionContext as any)?.job?.from_location_name ||
                        (selectedJob as any)?.from_location_name ||
                        (selectedJob as any)?.from_location_display
                      }
                      onRequested={() => {
                        refetchContext();
                        refetchSatisfaction();
                      }}
                    />
                  ) : null}
                  {showRollGuidance ? (
                    <label
                      className={cn(
                        "inline-flex h-8 items-center gap-2 rounded-lg border border-line bg-surface-2 px-2.5 text-xs font-semibold text-content-2",
                        isReleasedToMachine && "opacity-60",
                      )}
                    >
                      <Checkbox
                        checked={manualOverrideEnabled}
                        disabled={isReleasedToMachine || rollsMissing <= 0}
                        onCheckedChange={(checked) => {
                          const enabled = Boolean(checked);
                          setManualOverrideEnabled(enabled);
                          if (!enabled) setOverrideReason("");
                        }}
                      />
                      Policy override
                    </label>
                  ) : null}
                </div>
                {manualOverrideEnabled && showRollGuidance ? (
                  <div className="mt-3 rounded-xl border border-warning-border bg-warning-bg p-3">
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {WCM_OVERRIDE_REASON_PRESETS.map((reason) => (
                        <button
                          key={`roll-override-reason-${reason}`}
                          type="button"
                          disabled={isReleasedToMachine}
                          onClick={() => setOverrideReason(reason)}
                          className={cn(
                            "rounded-full border px-2.5 py-1 text-caption font-bold",
                            overrideReason === reason
                              ? "border-warning-border bg-warning-fg text-white"
                              : "border-warning-border bg-surface-1 text-warning-fg",
                          )}
                        >
                          {reason}
                        </button>
                      ))}
                    </div>
                    <Input
                      value={overrideReason}
                      disabled={isReleasedToMachine}
                      onChange={(event) => setOverrideReason(event.target.value)}
                      placeholder="Reason required for roll policy override"
                      className="h-9 rounded-xl border-warning-border bg-surface-1 text-xs font-semibold"
                    />
                  </div>
                ) : null}
                {rollLaneFlow && rollLanes.length ? (
                  <div className="mt-4">
                    <RollLanesPanel
                      lanes={rollLanes}
                      mode={rollMode}
                      allowRemove
                      allowReturn={isReleasedToMachine}
                      busy={mutation.isPending}
                      onRemove={(roll) =>
                        roll.reservation_id
                          ? handleUnassignRoll(roll.reservation_id)
                          : handleUnassignRollByRoll(roll.id)
                      }
                      onReturn={handleReturnRoll}
                      testIdPrefix="wcm-roll-lanes"
                    />
                  </div>
                ) : null}
                <div className="mt-4 grid gap-3 lg:grid-cols-2">
                  <div className="rounded-xl border border-line bg-surface-2 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="text-[12px] font-semibold text-content-3">
                        Allocated now
                      </div>
                      <span className="text-caption font-semibold text-content-3">
                        {assignedRollsForDisplay.length} rolls
                      </span>
                    </div>
                    <div className="space-y-2">
                      {assignedRollsForDisplay.length ? (
                        assignedRollsForDisplay.map((roll: any) => (
                          <div
                            key={roll.id}
                            data-testid={`wcm-assigned-roll-${String(roll.id)}`}
                            className="flex items-center gap-2 rounded-lg border border-surface-1 bg-surface-1 px-2.5 py-2"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-xs font-semibold text-content-1">
                                {roll.label_id}
                              </div>
                              <div className="truncate text-caption font-medium text-content-3">
                                {roll.material_name} ·{" "}
                                {roll.width_mm ? `${roll.width_mm}mm` : "—"} ·{" "}
                                {Number(roll.weight_kg || 0).toFixed(3)} kg
                              </div>
                              <div className="truncate text-caption font-bold uppercase text-content-4">
                                Pick from{" "}
                                {firstNonEmpty(
                                  roll.location_code,
                                  roll.location_name,
                                  roll.location,
                                ) || "Location not set"}
                              </div>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              disabled={
                                (isReleasedToMachine && !rollLaneFlow) ||
                                startedRollIds.has(String(roll.id)) ||
                                mutation.isPending
                              }
                              title={
                                startedRollIds.has(String(roll.id))
                                  ? "Part-used: use Return balance in the lanes above"
                                  : undefined
                              }
                              className="h-8 w-8 rounded-lg text-content-4 hover:text-danger-fg"
                              data-testid={
                                roll.reservation_id
                                  ? `wcm-unassign-roll-${String(roll.reservation_id)}`
                                  : `wcm-unassign-roll-by-roll-${String(roll.id)}`
                              }
                              onClick={() =>
                                roll.reservation_id
                                  ? handleUnassignRoll(roll.reservation_id)
                                  : handleUnassignRollByRoll(roll.id)
                              }
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-lg border border-dashed border-line bg-surface-1 px-3 py-4 text-center text-xs font-semibold text-content-4">
                          No roll allocated for this step yet.
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="rounded-xl border border-line bg-surface-2 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="text-[12px] font-semibold text-content-3">
                        Available choices
                      </div>
                      <span className="text-caption font-semibold text-content-3">
                        {rollAllocationCandidates.length} candidates
                      </span>
                    </div>
                    <div className="space-y-2">
                      {rollAllocationCandidates.slice(0, 4).map((roll: any) => (
                        <div
                          key={String(roll.id || roll.label_id)}
                          className="rounded-lg border border-surface-1 bg-surface-1 px-2.5 py-2"
                        >
                          <div className="text-xs font-semibold text-content-1">
                            {roll.label_id || "Roll"}
                          </div>
                          <div className="text-caption font-medium text-content-3">
                            {roll.material_name ||
                              roll.material_code ||
                              "Material"}{" "}
                            ·{" "}
                            {roll.thickness_micron
                              ? `${roll.thickness_micron}u`
                              : "—"}{" "}
                            · {roll.width_mm ? `${roll.width_mm}mm` : "—"}
                          </div>
                          <div className="text-caption font-bold uppercase text-content-4">
                            Pick from{" "}
                            {firstNonEmpty(
                              roll.location_code,
                              roll.location_name,
                              roll.location,
                            ) || "Location not set"}
                          </div>
                        </div>
                      ))}
                      {!rollAllocationCandidates.length ? (
                        <div className="rounded-lg border border-dashed border-line bg-surface-1 px-3 py-4 text-center text-xs font-semibold text-content-4">
                          No compatible roll in the current pool.
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              </section>
            ) : null}
            {satisfactionStatus?.input_form === "ROLL" ? null : (
              <p className="rounded-xl border border-dashed border-line bg-surface-2/40 px-3 py-2.5 text-sm text-content-3">
                This step takes bulk input: rolls are made here, not consumed. Nothing to allocate.
              </p>
            )}
            <StepFeedCard
              feed={(executionContext as any)?.upstream_feed}
              className="mt-3"
              testId="wcm-step-feed"
            />
            {Array.isArray((executionContext as any)?.recent_lineage) && (executionContext as any).recent_lineage.length ? (
              <section className="mt-3 rounded-xl border border-line bg-surface-2/40 p-3" data-testid="wcm-lineage-card">
                <div className="text-sm font-semibold text-content-1">Where the rolls came from <span className="text-caption font-medium text-content-3">· newest first · full genealogy stays in Inventory › Roll Genealogy</span></div>
                <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
                  {(executionContext as any).recent_lineage.slice(0, 6).map((roll: any) => (
                    <div key={roll.id} className="flex items-center justify-between gap-2 rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs">
                      <div className="min-w-0">
                        <div className="truncate font-mono font-semibold text-content-1">{roll.label_id}</div>
                        <div className="truncate text-content-3">
                          {[roll.material_name, roll.stage, roll.location_name].filter(Boolean).join(" · ")}
                        </div>
                      </div>
                      <div className="flex-none text-right font-mono font-semibold tabular-nums text-content-2">
                        {Number(roll.weight_kg || 0).toFixed(1)} kg
                        {roll.width_mm ? <div className="text-[10px] font-medium text-content-4">{Number(roll.width_mm).toFixed(0)} mm</div> : null}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
          </WcmStepSection>
          <WcmStepSection id="issue" no="4" title="Input issue" summary={stepSummaries.issue} state={stepStates.issue} open={isStepOpen("issue")} onToggle={() => toggleStep("issue")}>
            <div className="flex flex-col" data-testid="wcm-input-issue">
              <div className="flex items-start justify-between gap-3 pb-1">
                <div>
                  <p className="mt-1 text-xs font-medium text-content-3">
                    Give each granule its grade codes. Every other material on this
                    step is taken automatically as the step mapping says. Returns,
                    scrap and variance stay on machine output.
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {materialIssueDirty ? (
                    <span className="rounded-full border border-info-border bg-info-bg px-2.5 py-1 text-caption font-semibold uppercase tracking-wider text-primary">
                      Unsaved entries protected
                    </span>
                  ) : null}
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-1 text-xs font-semibold",
                      materialReleaseCheckCount
                        ? "bg-danger-bg text-danger-fg"
                        : "bg-success-bg text-success-fg",
                    )}
                  >
                    {materialReleaseLabel}
                  </span>
                </div>
              </div>
              <div className="flex flex-col">
              {currentStepPolicyItems.length ? (
                // Closed by default: template rules apply unless WCM opens this to override one row.
                <details
                  className="group/policy order-4 mt-3 rounded-2xl border border-info-border bg-info-bg"
                  open={hasActiveStepPolicyOverride || hasStepPolicyChangeIntent}
                  data-testid="wcm-step-policy"
                >
                  <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-3 py-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                    <span className="flex min-w-0 items-center gap-2 text-xs font-semibold text-primary">
                      <ChevronDown className="size-4 shrink-0 transition-transform group-open/policy:rotate-180" aria-hidden />
                      Issue policy · template rules
                    </span>
                    <span className="text-caption font-semibold text-content-3">
                      {currentStepPolicyItems.length} material{currentStepPolicyItems.length === 1 ? "" : "s"}
                      {(() => {
                        const overridden = currentStepPolicyItems.filter(
                          (item) =>
                            activeStepPolicyOverrides[item.policy_key] ||
                            String(item.policy_source || "").toUpperCase().includes("OVERRIDE"),
                        ).length;
                        return overridden ? ` · ${overridden} overridden` : " · all template";
                      })()}
                    </span>
                  </summary>
                  <div className="border-t border-info-border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold text-primary">
                        Template issue rules apply. Override only the row that
                        needs a real shop-floor issue exception.
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      className="h-9 rounded-xl bg-primary px-3 text-xs font-semibold hover:bg-primary"
                      disabled={
                        isReleasedToMachine ||
                        stepPolicyMutation.isPending ||
                        !selectedJobId ||
                        !hasEditableCurrentStepPolicy ||
                        !hasStepPolicyChangeIntent
                      }
                      onClick={() => stepPolicyMutation.mutate()}
                    >
                      {stepPolicyMutation.isPending ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : null}
                      Save override
                    </Button>
                  </div>
                  <div
                    className={cn(
                      "mt-3 space-y-2.5",
                      isReleasedToMachine && "pointer-events-none opacity-75",
                    )}
                  >
                    {currentStepPolicyItems.map((item) => {
                      const draft = stepPolicyDrafts[item.policy_key] || {
                        issue_policy_mode: "NONE" as const,
                        issue_policy_value: 0,
                        reason: "",
                      };
                      const source = String(
                        item.policy_source || "TEMPLATE_DEFAULT",
                      ).replaceAll("_", " ");
                      const overrideActive = Boolean(
                        activeStepPolicyOverrides[item.policy_key],
                      );
                      return (
                        <div
                          key={`issue-policy-${item.policy_key}`}
                          className="rounded-xl border border-info-border bg-surface-1 px-3 py-2.5"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <div className="text-sm font-semibold text-content-1">
                                {item.material_name}
                              </div>
                              <div className="mt-0.5 text-caption font-semibold text-content-3">
                                {item.category_code || "Material"} · Theory{" "}
                                {Number(item.theoretical_qty || 0).toFixed(3)} kg
                                · Issue plan{" "}
                                {Number(item.planned_issue_qty || 0).toFixed(3)}{" "}
                                kg
                              </div>
                            </div>
                            <span
                              className={cn(
                                "rounded-full border px-2.5 py-1 text-caption font-semibold uppercase tracking-wider",
                                source.includes("OVERRIDE")
                                  ? "border-warning-border bg-warning-bg text-warning-fg"
                                  : "border-success-border bg-success-bg text-success-fg",
                              )}
                            >
                              {source}
                            </span>
                            <Button
                              type="button"
                              size="sm"
                              variant={overrideActive ? "outline" : "default"}
                              disabled={
                                isReleasedToMachine ||
                                stepPolicyMutation.isPending
                              }
                              className={cn(
                                "h-8 rounded-lg px-3 text-xs font-semibold",
                                overrideActive
                                  ? "border-line bg-surface-1 text-content-2"
                                  : "bg-[#10233f] text-white hover:bg-[#18375f]",
                              )}
                              onClick={() => {
                                if (overrideActive) {
                                  setActiveStepPolicyOverrides((prev) => ({
                                    ...prev,
                                    [item.policy_key]: false,
                                  }));
                                  setStepPolicyDrafts((prev) => ({
                                    ...prev,
                                    [item.policy_key]: {
                                      issue_policy_mode: "NONE",
                                      issue_policy_value: 0,
                                      reason: "",
                                    },
                                  }));
                                  return;
                                }
                                setActiveStepPolicyOverrides((prev) => ({
                                  ...prev,
                                  [item.policy_key]: true,
                                }));
                                setStepPolicyDrafts((prev) => ({
                                  ...prev,
                                  [item.policy_key]: {
                                    issue_policy_mode: String(
                                      item.effective_issue_policy_mode ||
                                        item.template_issue_policy_mode ||
                                        "NONE",
                                    ).toUpperCase() as StepPolicyDraft["issue_policy_mode"],
                                    issue_policy_value: Number(
                                      item.effective_issue_policy_value ??
                                        item.template_issue_policy_value ??
                                        0,
                                    ),
                                    reason: String(item.override_reason || ""),
                                  },
                                }));
                              }}
                            >
                              {overrideActive ? "Use template" : "Override"}
                            </Button>
                          </div>
                          {overrideActive ? (
                          <div className="mt-3 grid gap-2 lg:grid-cols-[1fr_1fr_132px_1fr]">
                            <div className="rounded-lg border border-line bg-surface-2 px-3 py-2">
                              <div className="text-[12px] font-semibold text-content-3">
                                Template rule
                              </div>
                              <div className="mt-1 text-xs font-bold text-content-1">
                                {policyModeLabel(
                                  item.template_issue_policy_mode,
                                  item.template_issue_policy_value,
                                )}
                              </div>
                            </div>
                            <Select
                              value={draft.issue_policy_mode}
                              disabled={isReleasedToMachine || !overrideActive}
                              onValueChange={(value) =>
                                setStepPolicyDrafts((prev) => ({
                                  ...prev,
                                  [item.policy_key]: {
                                    ...draft,
                                    issue_policy_mode:
                                      value as StepPolicyDraft["issue_policy_mode"],
                                  },
                                }))
                              }
                            >
                              <SelectTrigger aria-label="Issue policy" className="h-10 rounded-lg border-line bg-surface-1 text-xs font-semibold">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="NONE">
                                  Use template policy
                                </SelectItem>
                                <SelectItem value="PERCENT_OVER_THEORY">
                                  % over theory
                                </SelectItem>
                                <SelectItem value="FIXED_EXTRA_KG">
                                  Fixed extra kg
                                </SelectItem>
                                <SelectItem value="MINIMUM_ISSUE_KG">
                                  Minimum issue kg
                                </SelectItem>
                              </SelectContent>
                            </Select>
                            <Input
                              type="number"
                              disabled={
                                isReleasedToMachine ||
                                !overrideActive ||
                                draft.issue_policy_mode === "NONE"
                              }
                              className="h-10 rounded-lg border-line bg-surface-1 text-right text-xs font-semibold"
                              value={String(draft.issue_policy_value ?? 0)}
                              onChange={(event) =>
                                setStepPolicyDrafts((prev) => ({
                                  ...prev,
                                  [item.policy_key]: {
                                    ...draft,
                                    issue_policy_value: Number(
                                      event.target.value || 0,
                                    ),
                                  },
                                }))
                              }
                            />
                            <Input
                              disabled={
                                isReleasedToMachine ||
                                !overrideActive ||
                                draft.issue_policy_mode === "NONE"
                              }
                              className="h-10 rounded-lg border-line bg-surface-1 text-xs font-semibold"
                              placeholder="Reason for override"
                              value={draft.reason}
                              onChange={(event) =>
                                setStepPolicyDrafts((prev) => ({
                                  ...prev,
                                  [item.policy_key]: {
                                    ...draft,
                                    reason: event.target.value,
                                  },
                                }))
                              }
                            />
                          </div>
                          ) : (
                            <div className="mt-1.5 text-caption font-semibold text-content-3">
                              Template rule:{" "}
                              <span className="text-content-1">
                                {policyModeLabel(
                                  item.template_issue_policy_mode,
                                  item.template_issue_policy_value,
                                )}
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  </div>
                </details>
              ) : null}
              <fieldset
                disabled={isReleasedToMachine || mutation.isPending}
                className={cn(
                  "order-2 mt-4 min-w-0 space-y-2.5",
                  isReleasedToMachine && "opacity-75",
                )}
              >
                {materialIssueRows.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-line bg-surface-2 p-4 text-sm font-medium text-content-3">
                    No current-step material issue is needed for this step.
                  </div>
                ) : (
                  [...materialIssueRows]
                    .sort(
                      (a: any, b: any) =>
                        Number(materialIssueKind(b) === "GRANULE") - Number(materialIssueKind(a) === "GRANULE"),
                    )
                    .map((row: any, index: number) => {
                    const requirementId = String(row?.requirement_id || "");
                    const issueTarget = materialIssueTargetKg(row);
                    const theoreticalQty = Number(
                      row?.theoretical_qty ?? row?.theoretical_qty_kg ?? issueTarget,
                    );
                    const issueAllowance = Math.max(
                      0,
                      issueTarget -
                        (Number.isFinite(theoreticalQty) ? theoreticalQty : issueTarget),
                    );
                    const availableKg = materialIssueAvailableKg(row);
                    const issueUom = materialIssueUom(row);
                    const materialName = String(
                      row?.material_name ||
                        row?.category_display ||
                        row?.category ||
                        "Material",
                    );
                    const draft = materialIssueDrafts[requirementId] || {
                      material_id: String(row?.material_id || ""),
                      actual_issued_qty:
                        issueTarget > 0 ? issueTarget.toFixed(3) : "",
                      actual_returned_qty: "0",
                      actual_scrap_qty: "0",
                      is_estimated: true,
                      granule_code_allocations: [],
                    };
                    const codeOptions = Array.isArray(row?.granule_code_options)
                      ? row.granule_code_options
                      : [];
                    const allocatableCodeOptions = codeOptions.filter(
                      (option: any) => option?.can_allocate !== false,
                    );
                    const otherPlantCodeOptions = codeOptions.filter(
                      (option: any) => option?.transfer_required === true,
                    );
                    const unavailableCodeOptions = codeOptions.filter(
                      (option: any) =>
                        option?.can_allocate === false &&
                        option?.transfer_required !== true,
                    );
                    const interplantTransfers = Array.isArray(
                      row?.interplant_transfers,
                    )
                      ? row.interplant_transfers
                      : [];
                    const isGranule = materialIssueKind(row) === "GRANULE";
                    const allocations = draft.granule_code_allocations || [];
                    const issuedKg = Number(draft.actual_issued_qty || 0);
                    const allocatedKg = allocations.reduce(
                      (sum, item) => sum + Number(item.qty_kg || 0),
                      0,
                    );
                    const splitOk =
                      !isGranule ||
                      issuedKg <= 0 ||
                      (allocations.length > 0 &&
                        allocations.every(
                          (item) =>
                            Boolean(item.granule_code_id) &&
                            Boolean(item.source_location_id) &&
                            Number(item.qty_kg || 0) > 0,
                        ) &&
                        Math.abs(allocatedKg - issuedKg) <= 0.0001);
                    const overPick = overPickInfoByRequirement.get(requirementId);
                    const rowErrors = materialIssueErrors.filter((error) =>
                      error.startsWith(`${materialName}:`),
                    );
                    if (!isGranule) {
                      // Only rolls and granule grade codes are entered here; everything else on the
                      // step is taken at its planned quantity, as the step mapping says.
                      return (
                        <div
                          key={requirementId || index}
                          data-testid={`wcm-auto-issue-${requirementId}`}
                          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-line bg-surface-1 px-3 py-2"
                        >
                          <span className="text-sm font-semibold text-content-1">{materialName}</span>
                          <span className="rounded-full bg-info-bg px-2 py-0.5 text-caption font-semibold uppercase tracking-wider text-primary">
                            {materialIssueKindLabel(row)}
                          </span>
                          <span className="text-caption font-semibold text-content-3">
                            Planned {issueTarget > 0 ? materialIssueQtyLabel(issueTarget, row) : "not planned"}
                            {" · "}Stock {materialIssueQtyLabel(availableKg, row)}
                            {row?.source_location_name || row?.location_name
                              ? ` · from ${row.source_location_name || row.location_name}`
                              : ""}
                          </span>
                          <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-success-border bg-success-bg px-2 py-0.5 text-caption font-semibold text-success-fg">
                            <CheckCircle2 className="size-3.5" aria-hidden />
                            Auto · step mapping
                          </span>
                          {overPick?.requiresConfirm ? (
                            <label className="flex w-full cursor-pointer items-center gap-2 text-xs font-semibold text-warning-fg">
                              <Checkbox
                                checked={Boolean(overPickConfirms[requirementId])}
                                onCheckedChange={(checked) =>
                                  setOverPickConfirms((prev) => ({ ...prev, [requirementId]: Boolean(checked) }))
                                }
                                className="border-warning-border data-[state=checked]:border-warning-border data-[state=checked]:bg-warning-fg"
                              />
                              Confirm over-pick — the saved issue is more than 120% of plan.
                            </label>
                          ) : null}
                          {rowErrors.length ? (
                            <div className="w-full text-xs font-semibold text-danger-fg">
                              {rowErrors.map((error) => error.replace(`${materialName}: `, "")).join(" · ")}
                            </div>
                          ) : null}
                        </div>
                      );
                    }
                    const granuleNeedsCodes = materialIssueRows.filter((other: any) => {
                      if (materialIssueKind(other) !== "GRANULE") return false;
                      const otherId = String(other?.requirement_id || "");
                      if (!otherId || otherId === requirementId) return false;
                      const otherDraft = materialIssueDrafts[otherId];
                      const otherIssued = Number(otherDraft?.actual_issued_qty || 0);
                      const otherAllocated = (otherDraft?.granule_code_allocations || []).reduce(
                        (sum, item) => sum + Number(item.qty_kg || 0),
                        0,
                      );
                      return otherIssued > 0 && Math.abs(otherAllocated - otherIssued) > 0.0001;
                    });
                    const nextFamily = granuleNeedsCodes[0];
                    const codeLabelOf = (allocation: { granule_code_id: string; source_location_id: string }) =>
                      String(
                        codeOptions.find(
                          (option: any) =>
                            String(option?.granule_code_id || "") === allocation.granule_code_id &&
                            String(option?.location_id || "") === String(allocation.source_location_id || ""),
                        )?.code || "Code",
                      );
                    return (
                      <div
                        key={requirementId || index}
                        className="rounded-xl border border-line bg-surface-2 p-3"
                      >
                        <div className="grid gap-3 md:grid-cols-[1fr_122px] md:items-start">
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <div className="font-semibold text-content-1">
                                {materialName}
                              </div>
                              <span
                                className={cn(
                                  "rounded-full px-2 py-0.5 text-caption font-semibold uppercase tracking-wider",
                                  isGranule
                                    ? "bg-success-bg text-success-fg"
                                    : "bg-info-bg text-primary",
                                )}
                              >
                                {materialIssueKindLabel(row)}
                              </span>
                            </div>
                            <div className="mt-1 flex flex-wrap gap-1.5 text-caption font-semibold text-content-3">
                              <span>
                                Recipe {materialIssueQtyLabel(theoreticalQty, row)}
                              </span>
                              <span>·</span>
                              <span>
                                Planned issue {issueTarget > 0 ? materialIssueQtyLabel(issueTarget, row) : "not planned"}
                                {issueAllowance > 0 ? ` (+${issueAllowance.toFixed(3)} kg allowance)` : ""}
                              </span>
                              <span>·</span>
                              <span>
                                Stock {materialIssueQtyLabel(availableKg, row)}
                              </span>
                              {row?.source_location_name || row?.location_name ? (
                                <>
                                  <span>·</span>
                                  <span>Pick from {row.source_location_name || row.location_name}</span>
                                </>
                              ) : null}
                            </div>
                          </div>
                          <label className="block">
                            <span className="mb-1 block text-[12px] font-semibold text-content-3">
                              Issued {issueUom.toLowerCase()}
                            </span>
                            <Input
                              value={draft.actual_issued_qty}
                              onChange={(event) =>
                                updateMaterialIssueDraft(requirementId, {
                                  actual_issued_qty: event.target.value,
                                  actual_returned_qty: "0",
                                  actual_scrap_qty: "0",
                                  is_estimated: false,
                                })
                              }
                              className={cn(
                                "h-10 rounded-xl border-line bg-surface-1 text-right font-semibold",
                                overPick &&
                                  "border-warning-border ring-1 ring-warning-border",
                              )}
                              placeholder="0.000"
                            />
                          </label>
                        </div>
                        {overPick ? (
                          <div
                            data-testid={`wcm-over-pick-${requirementId}`}
                            className="mt-2 rounded-xl border border-warning-border bg-warning-bg px-3 py-2 text-xs font-semibold text-warning-fg"
                          >
                            <div className="flex items-center gap-1.5">
                              <ArrowUpRight className="size-3.5 shrink-0" />
                              <span>
                                <span className="font-mono tabular-nums">
                                  {overPick.overKg.toFixed(3)}
                                </span>{" "}
                                {issueUom.toLowerCase()} above plan
                                {" · "}
                                <span className="font-mono tabular-nums">
                                  {overPick.overKg.toFixed(3)}
                                </span>{" "}
                                {issueUom.toLowerCase()} returns to stock
                              </span>
                            </div>
                            {overPick.requiresConfirm ? (
                              <label className="mt-2 flex cursor-pointer items-center gap-2 text-warning-fg">
                                <Checkbox
                                  checked={Boolean(
                                    overPickConfirms[requirementId],
                                  )}
                                  onCheckedChange={(checked) =>
                                    setOverPickConfirms((prev) => ({
                                      ...prev,
                                      [requirementId]: Boolean(checked),
                                    }))
                                  }
                                  className="border-warning-border data-[state=checked]:bg-warning-fg data-[state=checked]:border-warning-border"
                                />
                                <span>
                                  Confirm over-pick — issued is more than 120% of
                                  plan.
                                </span>
                              </label>
                            ) : null}
                          </div>
                        ) : null}
                        {isGranule ? (
                          <>
                          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-success-border bg-surface-1 px-3 py-2">
                            <span
                              data-testid={`wcm-granule-coded-${requirementId}`}
                              className={cn(
                                "rounded-lg px-2.5 py-1 text-xs font-semibold tabular-nums",
                                splitOk ? "bg-success-fg text-white" : "bg-danger-bg text-danger-fg",
                              )}
                            >
                              {allocatedKg.toFixed(3)} / {Math.max(0, issuedKg).toFixed(3)} kg coded
                            </span>
                            {allocations
                              .filter((item) => Number(item.qty_kg || 0) > 0)
                              .slice(0, 4)
                              .map((item) => (
                                <span
                                  key={`${item.granule_code_id}::${item.source_location_id}`}
                                  className="rounded-full border border-line bg-surface-2 px-2 py-0.5 font-mono text-caption font-semibold text-content-1"
                                >
                                  {codeLabelOf(item)} · {Number(item.qty_kg || 0).toFixed(3)}
                                </span>
                              ))}
                            {allocations.length > 4 ? (
                              <span className="text-caption font-semibold text-content-3">+{allocations.length - 4} more</span>
                            ) : null}
                            <Button
                              type="button"
                              size="sm"
                              variant={splitOk ? "outline" : "default"}
                              data-testid={`wcm-granule-codes-${requirementId}`}
                              className="ml-auto h-10 rounded-lg px-3 text-xs font-bold"
                              onClick={() => setCodesFor(requirementId)}
                            >
                              <Warehouse className="mr-1.5 size-4" aria-hidden />
                              {allocations.length ? "Grade codes" : "Add grade codes"}
                            </Button>
                          </div>
                          <Dialog
                            open={codesFor === requirementId}
                            onOpenChange={(open) => setCodesFor(open ? requirementId : null)}
                          >
                            <DialogContent
                              data-testid="wcm-granule-codes-dialog"
                              className="flex max-h-[min(94dvh,780px)] w-[calc(100vw-16px)] max-w-[780px] flex-col gap-3 overflow-hidden p-4 sm:p-5"
                            >
                              <DialogHeader className="pb-3">
                                <DialogTitle className="pr-10 text-[17px]">Grade codes · {materialName}</DialogTitle>
                                <DialogDescription className="text-xs">
                                  Recipe {materialIssueQtyLabel(theoreticalQty, row)} · issuing {Math.max(0, issuedKg).toFixed(3)} kg. One
                                  granule can come from several codes: tap a code, or pick a code with a kg, until every kilogram has one.
                                </DialogDescription>
                              </DialogHeader>
                              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-0.5">
                          <div className="overflow-hidden rounded-2xl border border-success-border bg-surface-1">
                            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line bg-success-bg px-3.5 py-3">
                              <div>
                                <div className="flex items-center gap-2 text-sm font-semibold text-content-1">
                                  <Warehouse className="size-4 text-success-fg" />
                                  Allocate grade/code and source
                                </div>
                                <p className="mt-1 text-xs font-medium text-content-3">
                                  This recipe is family-based. Choose the actual internal grade codes WCM will issue.
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                <div
                                  className={cn(
                                    "rounded-lg px-2.5 py-1 text-xs font-semibold tabular-nums",
                                    splitOk
                                      ? "bg-success-fg text-white"
                                      : "bg-danger-bg text-danger-fg",
                                  )}
                                >
                                  {allocatedKg.toFixed(3)} / {Math.max(0, issuedKg).toFixed(3)} kg
                                </div>
                              </div>
                            </div>

                            <div className="space-y-3 p-3">
                              {allocatableCodeOptions.length === 0 && !allocations.length ? (
                                <div className="rounded-xl border border-warning-border bg-warning-bg px-3 py-2.5 text-xs font-semibold text-warning-fg">
                                  {otherPlantCodeOptions.length > 0
                                    ? "No coded stock is ready in this plant. Start an inter-plant transfer from an available source below."
                                    : unavailableCodeOptions.some(
                                          (option: any) =>
                                            option?.eligibility_status === "ZERO_STOCK",
                                        )
                                      ? "The grade codes exist, but none has eligible physical stock in this plant. Receive or reclassify the exact code before release."
                                      : "No active coded stock is ready for this granule family."}
                                </div>
                              ) : (
                                <GranuleAllocationBox
                                  materialName={materialName}
                                  issuedKg={issuedKg}
                                  allocations={allocations}
                                  options={allocatableCodeOptions as GranuleCodeSourceOption[]}
                                  disabled={isReleasedToMachine || mutation.isPending}
                                  onPickerOpenChange={setMaterialIssuePickerOpen}
                                  onChange={(next) =>
                                    updateMaterialIssueDraft(requirementId, {
                                      granule_code_allocations: next,
                                      is_estimated: false,
                                    })
                                  }
                                />
                              )}

                              {interplantTransfers.length ? (
                                <div className="space-y-2 rounded-xl border border-info-border bg-info-bg p-3">
                                  <div className="flex items-center gap-2 text-xs font-semibold text-primary">
                                    <Truck className="size-4" />
                                    Transfers waiting for destination receipt
                                  </div>
                                  {interplantTransfers.map((transfer: any) => (
                                    <div key={transfer.challan_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-1 px-3 py-2 text-xs">
                                      <div>
                                        <div className="font-bold text-content-1">
                                          {transfer.code} · {Number(transfer.qty_kg || 0).toFixed(3)} kg
                                        </div>
                                        <div className="text-content-3">
                                          {transfer.dc_no} · {transfer.from_location_name} → {transfer.to_location_name}
                                        </div>
                                      </div>
                                      <Button
                                        type="button"
                                        size="sm"
                                        className="h-8 rounded-lg text-xs font-bold"
                                        disabled={mutation.isPending}
                                        onClick={() => handleReceiveMaterialTransfer(String(transfer.challan_id))}
                                      >
                                        Confirm received
                                      </Button>
                                    </div>
                                  ))}
                                </div>
                              ) : null}

                              {otherPlantCodeOptions.length ? (
                                <details className="group rounded-xl border border-line bg-surface-2">
                                  <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-xs font-bold text-content-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                                    <span className="flex items-center gap-2">
                                      <Truck className="size-4 text-primary" />
                                      Stock available at another plant
                                    </span>
                                    <span>{otherPlantCodeOptions.length} source{otherPlantCodeOptions.length === 1 ? "" : "s"}</span>
                                  </summary>
                                  <div className="space-y-2 border-t border-line p-2.5">
                                    {otherPlantCodeOptions.map((option: any) => {
                                      const transferKey = `${requirementId}:${option.granule_code_id}:${option.location_id}`;
                                      const suggestedQty = Math.min(
                                        Math.max(issuedKg - allocatedKg, 0) || issueTarget,
                                        Number(option.available_qty_kg || 0),
                                      );
                                      const transferValue = transferQtyDrafts[transferKey] ?? suggestedQty.toFixed(3);
                                      return (
                                        <div key={transferKey} className="grid gap-2 rounded-lg bg-surface-1 p-2 md:grid-cols-[minmax(0,1fr)_112px_auto] md:items-center">
                                          <div className="min-w-0 text-xs">
                                            <div className="font-bold text-content-1">{option.code}</div>
                                            <div className="truncate text-content-3">
                                              {option.plant_name} / {option.location_name} · {Number(option.available_qty_kg || 0).toFixed(3)} kg available
                                            </div>
                                          </div>
                                          <Input
                                            value={transferValue}
                                            inputMode="decimal"
                                            aria-label={`Transfer kilograms of ${option.code}`}
                                            onChange={(event) =>
                                              setTransferQtyDrafts((prev) => ({
                                                ...prev,
                                                [transferKey]: event.target.value,
                                              }))
                                            }
                                            className="h-9 rounded-lg text-right text-xs font-bold tabular-nums"
                                          />
                                          <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            className="h-9 rounded-lg border-info-border text-xs font-bold text-primary"
                                            disabled={mutation.isPending}
                                            onClick={() =>
                                              handleRequestMaterialTransfer(
                                                requirementId,
                                                option,
                                                transferValue,
                                              )
                                            }
                                          >
                                            Start transfer
                                          </Button>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </details>
                              ) : null}

                              {unavailableCodeOptions.length ? (
                                <details className="group rounded-xl border border-warning-border bg-warning-bg">
                                  <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-xs font-bold text-warning-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                                    <span className="flex items-center gap-2">
                                      <TriangleAlert className="size-4" />
                                      Grade codes not ready to issue
                                    </span>
                                    <span>
                                      {unavailableCodeOptions.length} code{unavailableCodeOptions.length === 1 ? "" : "s"}
                                    </span>
                                  </summary>
                                  <div className="space-y-2 border-t border-warning-border p-2.5">
                                    {unavailableCodeOptions.map((option: any, unavailableIndex: number) => (
                                      <div
                                        key={`${option.granule_code_id}-${option.location_id || "no-stock"}-${unavailableIndex}`}
                                        className="flex flex-wrap items-start justify-between gap-3 rounded-lg bg-surface-1 px-3 py-2.5 text-xs"
                                      >
                                        <div className="min-w-0">
                                          <div className="flex flex-wrap items-center gap-2">
                                            <span className="font-semibold text-content-1">{option.code}</span>
                                            <span className="rounded-full bg-warning-bg px-2 py-0.5 text-caption font-semibold uppercase tracking-wider text-warning-fg">
                                              {String(option.eligibility_status || "UNAVAILABLE").replaceAll("_", " ")}
                                            </span>
                                          </div>
                                          <div className="mt-1 text-content-3">
                                            {option.status_reason || "This code cannot be issued from the selected plant."}
                                            {option.location_name
                                              ? ` · ${option.plant_name} / ${option.location_name}`
                                              : ""}
                                          </div>
                                        </div>
                                        {option.eligibility_status === "ZERO_STOCK" ? (
                                          <a
                                            href="/inventory/grn"
                                            className="inline-flex h-8 items-center rounded-lg border border-warning-border bg-surface-1 px-2.5 text-caption font-semibold text-warning-fg hover:bg-warning-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                                          >
                                            Receive exact code
                                          </a>
                                        ) : null}
                                      </div>
                                    ))}
                                  </div>
                                </details>
                              ) : null}

                              <div
                                className={cn(
                                  "flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-bold",
                                  splitOk
                                    ? "bg-success-bg text-success-fg"
                                    : "bg-danger-bg text-danger-fg",
                                )}
                              >
                                {splitOk ? <CheckCircle2 className="size-4" /> : <AlertCircle className="size-4" />}
                                {splitOk
                                  ? "All issued kilograms are assigned to explicit grade codes and sources."
                                  : "Allocate the full issued quantity before machine release."}
                              </div>
                            </div>
                          </div>
                              </div>
                              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-3">
                                {nextFamily ? (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    data-testid="wcm-granule-codes-next"
                                    onClick={() => setCodesFor(String(nextFamily?.requirement_id || ""))}
                                  >
                                    Next:{" "}
                                    {String(nextFamily?.material_name || nextFamily?.category_display || "granule")}
                                  </Button>
                                ) : null}
                                <Button type="button" data-testid="wcm-granule-codes-done" onClick={() => setCodesFor(null)}>
                                  {splitOk ? "Done" : "Close"}
                                </Button>
                              </div>
                            </DialogContent>
                          </Dialog>
                          </>
                        ) : (
                          <div className="mt-2 rounded-xl border border-line bg-surface-1 px-3 py-2 text-xs font-semibold text-content-3">
                            No code split for this input. Enter issued{" "}
                            {issueUom.toLowerCase()} only.
                          </div>
                        )}
                        {rowErrors.length ? (
                          <div className="mt-2 rounded-xl border border-danger-border bg-danger-bg px-3 py-2 text-xs font-semibold text-danger-fg">
                            {rowErrors
                              .map((error) =>
                                error.replace(`${materialName}: `, ""),
                              )
                              .join(" · ")}
                          </div>
                        ) : null}
                      </div>
                    );
                  })
                )}
              </fieldset>
              {granuleIssueRows.length ? (
                <div className="order-3 mt-3 rounded-xl border border-success-border bg-success-bg px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-caption font-semibold uppercase tracking-wider text-success-fg">
                      Granule split status
                    </div>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-caption font-semibold uppercase tracking-wider",
                        materialIssueErrors.some((error) =>
                          granuleIssueRows.some((row: any) =>
                            error.startsWith(
                              `${String(row?.material_name || row?.category_display || row?.category || "Material")}:`,
                            ),
                          ),
                        )
                          ? "bg-danger-bg text-danger-fg"
                          : "bg-success-fg text-white",
                      )}
                    >
                      {granuleIssueRows.length} row
                      {granuleIssueRows.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="mt-2 grid gap-1.5">
                    {granuleIssueRows.map((row: any) => {
                      const requirementId = String(row?.requirement_id || "");
                      const draft = materialIssueDrafts[requirementId];
                      const issuedKg = Number(
                        draft?.actual_issued_qty ||
                          materialIssueTargetKg(row) ||
                          0,
                      );
                      const allocations = draft?.granule_code_allocations || [];
                      const allocatedKg = allocations.reduce(
                        (sum: number, item: any) =>
                          sum + Number(item.qty_kg || 0),
                        0,
                      );
                      const codeOptions = Array.isArray(row?.granule_code_options)
                        ? row.granule_code_options
                        : [];
                      const splitOk =
                        issuedKg <= 0 ||
                        Math.abs(allocatedKg - issuedKg) <= 0.0001;
                      const materialName = String(
                        row?.material_name ||
                          row?.category_display ||
                          row?.category ||
                          "Granule",
                      );
                      return (
                        <div
                          key={`granule-compact-${requirementId || materialName}`}
                          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-surface-1 bg-surface-1 px-2.5 py-1.5 text-xs"
                        >
                          <span className="min-w-0 font-semibold text-content-1">
                            {materialName}
                          </span>
                          <span
                            className={cn(
                              "font-semibold tabular-nums",
                              splitOk && codeOptions.length
                                ? "text-success-fg"
                                : "text-danger-fg",
                            )}
                          >
                            {allocatedKg.toFixed(3)} /{" "}
                            {Math.max(0, issuedKg).toFixed(3)} kg
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}
              </div>
            </div>
            <section className="mt-3 rounded-xl border border-line bg-surface-2/40 p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-[12px] font-semibold text-content-3">
                    Current-step materials
                  </div>
                  <div className="mt-1 text-lg font-semibold text-content-1">
                    {selectedStepMaterialRows.length
                      ? `${selectedStepMaterialRows.length} material${selectedStepMaterialRows.length === 1 ? "" : "s"}`
                      : "No material list"}
                  </div>
                </div>
                <span className="rounded-full border border-info-border bg-info-bg px-2.5 py-1 text-xs font-semibold text-primary">
                  {selectedStepContractLabel}
                </span>
              </div>
              <div className="mt-3 max-h-[360px] space-y-2 overflow-y-auto pr-1">
                {selectedStepMaterialRows.length ? (
                  selectedStepMaterialRows.map(
                    (row: { key: string; name: string; detail: string }) => (
                      <div
                        key={`selected-step-material-${row.key}`}
                        className="rounded-xl border border-line bg-surface-2 px-3 py-2.5"
                      >
                        <div className="text-sm font-semibold leading-tight text-content-1">
                          {row.name}
                        </div>
                        {row.detail ? (
                          <div className="mt-1 text-xs font-medium leading-snug text-content-3">
                            {row.detail}
                          </div>
                        ) : null}
                      </div>
                    ),
                  )
                ) : (
                  <div className="rounded-xl border border-dashed border-line bg-surface-2 px-3 py-4 text-sm font-medium text-content-3">
                    No current-step material captured.
                  </div>
                )}
              </div>
            </section>
          </WcmStepSection>
        </>
      ) : (
        <>
        {Array.isArray((executionContext as any)?.recent_lineage) && (executionContext as any).recent_lineage.length ? (
          <section className="mt-3 rounded-xl border border-line bg-surface-2/40 p-3" data-testid="wcm-lineage-card">
            <div className="text-sm font-semibold text-content-1">Where the rolls came from <span className="text-caption font-medium text-content-3">· newest first · full genealogy stays in Inventory › Roll Genealogy</span></div>
            <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
              {(executionContext as any).recent_lineage.slice(0, 6).map((roll: any) => (
                <div key={roll.id} className="flex items-center justify-between gap-2 rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs">
                  <div className="min-w-0">
                    <div className="truncate font-mono font-semibold text-content-1">{roll.label_id}</div>
                    <div className="truncate text-content-3">
                      {[roll.material_name, roll.stage, roll.location_name].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <div className="flex-none text-right font-mono font-semibold tabular-nums text-content-2">
                    {Number(roll.weight_kg || 0).toFixed(1)} kg
                    {roll.width_mm ? <div className="text-[10px] font-medium text-content-4">{Number(roll.width_mm).toFixed(0)} mm</div> : null}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}
        </>
      )}
      <WcmStepSection id="release" no="5" title="Release · readiness" summary={stepSummaries.release} state={stepStates.release} open={isStepOpen("release")} onToggle={() => toggleStep("release")}>
        <div className="grid gap-1.5" data-testid="wcm-release-checklist">
          {releaseGateItems.map((gate) => (
            <div
              key={`release-check-${gate.key}`}
              className={cn(
                "flex items-center gap-2.5 rounded-xl border px-3 py-2 text-xs",
                gate.ok ? "border-success-border bg-success-bg" : "border-warning-border bg-warning-bg",
              )}
            >
              <span className={cn("grid h-6 w-6 shrink-0 place-items-center rounded-full font-bold", gate.ok ? "bg-success-fg text-white" : "bg-warning-fg text-white")}>
                {gate.ok ? <CheckCircle2 className="size-3.5" /> : "!"}
              </span>
              <span className="min-w-0 flex-1">
                <b className="block text-sm text-content-1">{gate.label}</b>
                <span className="block text-content-3">{gate.ok ? "Clear" : gateReason(gate.key)}</span>
              </span>
              {!gate.ok ? (
                <Button type="button" size="sm" variant="outline" className="h-8 rounded-lg text-xs" onClick={() => openStep(gate.key === "material" ? "issue" : gate.key === "cylinder" ? "release" : gate.key)}>
                  Fix
                </Button>
              ) : null}
            </div>
          ))}
        </div>
        {activeMainTab !== "running" ? (
          <>
            {detailRequiresCylinderGate ? (
              <section
                className={cn(
                  "rounded-xl border px-3 py-2.5",
                  cylinderGateOk && !detailMaterialBlocked
                    ? "border-success-border bg-success-bg"
                    : "border-danger-border bg-danger-bg",
                )}
                data-testid="wcm-cylinder-gate"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-0 flex-1 text-[12.5px] text-content-2">
                    <b className="text-content-1">Cylinders &amp; artwork</b> ·{" "}
                    {detailCylinderStatus === "MISSING" ? "Cylinder or artwork missing" : "Print readiness checked"} · ink colours,
                    cylinder readiness and the material block are checked before release.
                  </div>
                  <ArtworkButton artworkId={detailArtworkId || null} artworkCode={detailArtworkCode || null} artworkName={detailArtworkName || null} />
                  <CylinderReadyChip status={detailCylinderStatus} ready={detailCylinderReady} />
                  <MaterialBlockChip blocked={detailMaterialBlocked} reason={detailMaterialBlockReason} />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <InkColorSwatches colors={detailInkColors} />
                  {!detailInkColors.length ? (
                    <span className="text-[12px] text-content-3">No print ink colours for this step, or the artwork is not attached.</span>
                  ) : null}
                </div>
              </section>
            ) : null}
            <PrintColorRevisionNotice source={(activeAssignment as any) || (selectedJob as any)} />
          </>
        ) : null}
        {pushBlockingReasons.length > 1 ? (
          <details className="group rounded-xl border border-line bg-surface-2 px-3 py-2">
            <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-semibold text-content-2">
              All open reasons <span className="tabular-nums text-content-4">{pushBlockingReasons.length}</span>
            </summary>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-content-3">
              {pushBlockingReasons.map((reason) => (
                <li key={`open-reason-${reason}`}>{reason}</li>
              ))}
            </ul>
          </details>
        ) : null}
        <p className="text-[11.5px] text-content-4">
          Release = assign the machine, lock the reserved rolls and the issue plan, and hand the job to the machine terminal. Close short and
          Cancel are in the ⋯ menu beside the release button.
        </p>
      </WcmStepSection>
      </div>
      <section className="shrink-0 border-t border-line bg-surface-1 px-4 py-2.5 shadow-[0_-12px_30px_-28px_rgba(15,23,42,.45)]" data-testid="wcm-release-bar">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="min-w-[240px] flex-1">
            <div
              className={cn(
                "truncate text-[13px] font-semibold",
                isReleasedToMachine ? "text-content-2" : canPushToOperator ? "text-success-fg" : detailMaterialBlocked ? "text-danger-fg" : "text-content-2",
              )}
              title={pushBlockingReasons.join(" · ")}
              data-testid="wcm-release-reason"
            >
              {isReleasedToMachine
                ? "Already released to machine terminal."
                : canPushToOperator
                  ? "All gates are clear. Release this job to the selected machine."
                  : pushBlockingReasons[0] ||
                    "Pick a job and clear the readiness gates."}
            </div>
            {Array.isArray((satisfactionStatus as any)?.addon_shortages) && (satisfactionStatus as any).addon_shortages.length ? (
              <div className="mt-1 text-caption font-semibold text-warning-fg" data-testid="wcm-addon-shortage">
                Add-on stock short (not blocking):{" "}
                {(satisfactionStatus as any).addon_shortages
                  .map((row: any) => `${row.material_name} ${Number(row.short_qty || 0).toFixed(1)} ${String(row.uom || "").toLowerCase()}`)
                  .join(", ")}
                . Receive it into the ERP so the issue can be recorded.
              </div>
            ) : null}
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              <div className="mr-1 h-1.5 w-16 overflow-hidden rounded-full bg-surface-2">
                <span
                  className="block h-full rounded-full bg-success-fg transition-all"
                  style={{ width: `${releaseGateProgress}%` }}
                />
              </div>
              {releaseGateItems.map((gate) => (
                <button
                  type="button"
                  key={`release-bar-gate-${gate.key}`}
                  onClick={() => openStep(gate.key === "material" ? "issue" : gate.key === "cylinder" ? "release" : gate.key)}
                  title={gate.ok ? `${gate.label} · clear` : gateReason(gate.key)}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11.5px] font-semibold",
                    gate.ok
                      ? "border-success-border bg-success-bg text-success-fg"
                      : gate.key === "material" && detailMaterialBlocked
                        ? "border-danger-border bg-danger-bg text-danger-fg"
                        : "border-warning-border bg-warning-bg text-warning-fg",
                  )}
                >
                  {gate.ok ? <Check className="size-3" strokeWidth={3} aria-hidden /> : null}
                  {gate.key === "material" ? "Issue" : gate.key === "rolls" ? "Rolls" : gate.key === "machine" ? "Machine" : "Cylinders"}
                </button>
              ))}
              {pushBlockingReasons.length > 1 ? (
                <TooltipProvider delayDuration={100}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="cursor-help rounded-md border border-line bg-surface-2 px-1.5 py-0.5 text-[11.5px] font-semibold text-content-2">
                        +{pushBlockingReasons.length - 1} more
                      </span>
                    </TooltipTrigger>
                    <TooltipContent
                      side="top"
                      className="max-w-[360px] rounded-xl border-line bg-surface-1 p-3 text-content-2 shadow-xl"
                    >
                      <div className="space-y-1">
                        {pushBlockingReasons.slice(1, 8).map((reason) => (
                          <div key={`sticky-blocker-${reason}`} className="text-xs font-semibold">
                            {reason}
                          </div>
                        ))}
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="h-11 w-11 rounded-xl border-line p-0 text-lg font-bold text-content-2"
                  aria-label="More job actions"
                  data-testid="wcm-job-actions"
                >
                  ⋯
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuItem
                  disabled={!canShortCloseActiveFromWcm}
                  onSelect={() => {
                    if (!activeAssignment) return;
                    setCloseJobAction({ assignment: activeAssignment, mode: "SHORT_CLOSE" });
                    setCloseJobReason("");
                    setCloseJobReasonPreset("");
                  }}
                >
                  Close short…
                  <span className="ml-auto text-caption text-content-4">{canShortCloseActiveFromWcm ? "after output" : "needs output"}</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!canCancelActiveFromWcm}
                  className="text-danger-fg"
                  onSelect={() => {
                    if (!activeAssignment) return;
                    setCloseJobAction({ assignment: activeAssignment, mode: "CANCEL" });
                    setCloseJobReason("");
                    setCloseJobReasonPreset("");
                  }}
                >
                  Cancel job…
                </DropdownMenuItem>
                <DropdownMenuItem
                  data-testid="wcm-recalc-from-masters"
                  disabled={!activeAssignment || recalcFromMastersMutation.isPending}
                  title="Rebuild this line's weights, targets and issue plan from the current masters. Allowed only before any output is logged."
                  onSelect={() => recalcFromMastersMutation.mutate()}
                >
                  {recalcFromMastersMutation.isPending ? "Recalculating…" : "Recalculate from masters"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              type="button"
              data-testid="wcm-sticky-release"
              className={cn(
                "h-11 rounded-xl px-5 text-sm font-semibold text-white shadow-md",
                canPushToOperator
                  ? "bg-success-fg hover:bg-success-fg"
                  : "bg-surface-3 hover:bg-line",
              )}
              disabled={
                isReleasedToMachine ||
                !activeAssignment ||
                !selectedMachineId ||
                !currentStepIssueOk ||
                selectedMachineUnavailable ||
                mutation.isPending
              }
              onClick={handleAssignAndMaybeRelease}
            >
              {mutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {isReleasedToMachine
                ? "Execution ready"
                : !currentStepIssueOk
                  ? "Finish issue first"
                : selectedMachineRunningOtherJob
                  ? "Queue on machine"
                : canPushToOperator
                  ? "Release to machine"
                  : selectedMachineId
                    ? "Save machine"
                    : "Assign machine"}
            </Button>
          </div>
        </div>
      </section>
    </div>
  );

  const queueFacetCount = [
    queueMaterialFilter,
    queueGradeFilter,
    queueThicknessFilter,
    queueSizeFilter,
    queueProcessFilter,
  ].filter((value) => value !== ALL_PRODUCTION_FACET).length;
  const clearQueueFilters = () => {
    setQueueSearch("");
    setQueueStatusFilter("ALL");
    setQueueMaterialFilter(ALL_PRODUCTION_FACET);
    setQueueGradeFilter(ALL_PRODUCTION_FACET);
    setQueueThicknessFilter(ALL_PRODUCTION_FACET);
    setQueueSizeFilter(ALL_PRODUCTION_FACET);
    setQueueProcessFilter(ALL_PRODUCTION_FACET);
  };
  const queueSortLabel = (QUEUE_SORT_OPTIONS.find(([value]) => value === queueSortKey) || QUEUE_SORT_OPTIONS[0])[1];
  const queueTabsBar = (
    <div className="flex items-end gap-0.5 overflow-x-auto border-b border-line px-2 pt-1" role="tablist" aria-label="Work center views">
      {(
        [
          ["terminal", "Queue", queueCounts.all],
          ["running", "Running / ready", visibleRunningAssignments.length],
          ["stalled", "Stalled", stalledJobsList.length],
          ["history", "History", null],
        ] as const
      ).map(([value, label, count]) => {
        const selected = activeMainTab === value;
        return (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={selected}
            data-testid={value === "stalled" ? "wcm-stalled-tab" : `wcm-tab-${value}`}
            onClick={() => setActiveMainTab(value)}
            className={cn(
              "relative inline-flex h-10 shrink-0 items-center gap-1.5 px-2 text-[12.5px] font-semibold transition-colors 2xl:px-2.5 2xl:text-[13px]",
              selected ? "text-primary" : "text-content-3 hover:text-content-1",
            )}
          >
            {value === "running" ? <span className="h-2 w-2 rounded-full bg-success-fg" aria-hidden /> : null}
            {value === "stalled" ? <span className="h-2 w-2 rounded-full bg-warning-fg" aria-hidden /> : null}
            {value === "history" ? <History className="size-3.5" aria-hidden /> : null}
            {label}
            {count != null ? (
              <span className={cn("rounded px-1 font-mono text-[10.5px] tabular-nums", selected ? "bg-info-bg text-primary" : "bg-surface-2 text-content-3")}>{count}</span>
            ) : null}
            {selected ? <span className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-primary" aria-hidden /> : null}
          </button>
        );
      })}
    </div>
  );

  return (
    <div
      className="wcm-terminal-canvas min-h-screen text-content-1"
      data-testid="wcm-terminal-page"
    >
      <ConnectionLostBanner
        online={online}
        stale={isStaleSync}
        secondsSinceSync={secondsSinceSync}
        onRetry={() => {
          refetchQueue();
          refetchStalled();
        }}
      />
      {queueIsRefetchError && assignmentsList.length > 0 ? (
        <div
          role="status"
          data-testid="wcm-background-refresh-warning"
          className="sticky top-14 z-20 flex items-center justify-between gap-3 border-b border-warning-border bg-warning-bg px-6 py-2 text-xs font-bold text-warning-fg"
        >
          <span>
            Live queue refresh paused. The current job and unsaved material entries are preserved.
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 border-warning-border bg-surface-1 px-2 text-caption font-bold"
            onClick={() => refetchQueue()}
          >
            Retry
          </Button>
        </div>
      ) : null}
      <main className="mx-auto w-full max-w-[1760px] px-3 py-3 lg:px-4" data-testid="wcm-main">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 xl:flex-nowrap">
          <div className="min-w-0 xl:flex-1">
            <h1 className="flex min-w-0 items-center gap-2 whitespace-nowrap text-[18px] font-semibold leading-tight tracking-[-0.01em] text-content-1 2xl:text-[20px]">
              <Factory className="size-5 text-primary" aria-hidden />
              Work Center Terminal
              <span className="min-w-0 truncate rounded-lg border border-line bg-surface-1 px-2 py-0.5 text-[14px] font-semibold text-content-1 2xl:text-[15px]" data-testid="wcm-wc-name">
                {workCenter?.name || (activeAssignment as any)?.work_center_name || "Work Center"}
              </span>
              <Link href="/production/work-center" className="text-[12px] font-medium text-primary hover:underline">
                Change
              </Link>
            </h1>
            <div className="mt-0.5 flex min-w-0 items-center gap-x-1.5 overflow-hidden whitespace-nowrap text-[12.5px] text-content-3">
              <b className="font-semibold text-content-2">
                {workCenter?.plant_name || (workCenter as any)?.plant?.name || "Production plant"} ·{" "}
                <span data-testid="wcm-shift-label">{shiftLabel}</span>
              </b>
              <span>·</span>
              <span className="font-mono tabular-nums" data-testid="wcm-live-clock">
                {new Date(nowTick).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
              <span>·</span>
              <span className="inline-flex items-center gap-1">
                <span className={cn("h-2 w-2 rounded-full", !online ? "bg-danger-solid" : isStaleSync ? "bg-warning-fg" : "bg-success-fg")} />
                {!online ? "Offline" : secondsSinceQueueSync == null ? "Connecting…" : `Synced ${secondsSinceQueueSync}s ago`}
              </span>
              <span className="hidden truncate 2xl:inline">
                · Pick one job, clear its gates in order — machine, rolls, issue — then release it to the machine terminal.
              </span>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {(
              [
                ["running", "Running / ready", visibleRunningAssignments.length, "on machines now", "border-info-border text-info-fg"],
                ["waiting", "Waiting", stats.waiting, "blocked or upstream", "border-warning-border text-warning-fg"],
                ["queue", "Queue", visibleQueueAssignments.length, "lines at this WC", "border-primary/50 text-primary"],
                ["nomachine", "No machine", queueCounts.noMachine, "assign first", "border-danger-border text-danger-fg"],
              ] as const
            ).map(([key, label, value, sub, tone]) => {
              const pressed =
                key === "running"
                  ? activeMainTab === "running"
                  : key === "nomachine"
                    ? activeMainTab === "terminal" && queueStatusFilter === "NEEDS_MACHINE"
                    : key === "queue"
                      ? activeMainTab === "terminal" && queueStatusFilter === "ALL"
                      : false;
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={pressed}
                  data-testid={`wcm-kpi-${key}`}
                  onClick={() => {
                    if (key === "running") {
                      setActiveMainTab("running");
                      return;
                    }
                    setActiveMainTab("terminal");
                    if (key === "nomachine") setQueueStatusFilter("NEEDS_MACHINE");
                    if (key === "queue") setQueueStatusFilter("ALL");
                  }}
                  className={cn(
                    "grid min-w-[112px] grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 rounded-xl border bg-surface-1 px-2.5 py-1 text-left shadow-[var(--shadow-sm)] transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                    tone,
                    pressed && "ring-2 ring-primary/30",
                  )}
                >
                  <span className="row-span-2 text-[22px] font-semibold leading-none tabular-nums">{showStatsSkeleton ? "—" : value}</span>
                  <span className="truncate text-[12px] font-semibold text-content-1">{label}</span>
                  <span className="truncate text-[11px] text-content-3">{sub}</span>
                </button>
              );
            })}
            <Link
              className="inline-flex h-[42px] items-center gap-1.5 rounded-xl border border-line bg-surface-1 px-3 text-[12.5px] font-semibold text-content-2 shadow-[var(--shadow-sm)] hover:bg-surface-2"
              href={selectedMachineId ? `/production/machine/${selectedMachineId}` : "/production/machine-selector"}
            >
              <span className="hidden 2xl:inline">Machine terminal</span>
              <span className="2xl:hidden">Machine</span>
              <ArrowUpRight className="size-3.5" aria-hidden />
            </Link>
          </div>
        </div>

        {activeMainTab === "stalled" || activeMainTab === "history" ? (
          <section className="mt-3 overflow-hidden rounded-2xl border border-line bg-surface-1 shadow-[var(--shadow-sm)]">
            {queueTabsBar}
            <div className="p-3">
              {activeMainTab === "stalled" ? (
                <StalledJobsPanel
                  jobs={stalledJobsList}
                  isLoading={isLoadingStalled && stalledJobsList.length === 0}
                  isFetching={isFetchingStalled}
                  onRefresh={() => refetchStalled()}
                />
              ) : (
                  <div className="p-1">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <div className="text-caption uppercase tracking-wider text-content-3">
                          History
                        </div>
                        <div className="text-lg font-semibold text-content-1">
                          WCM audit and production history
                        </div>
                        <p className="mt-1 text-sm text-content-3">
                          Search actions, material issue, machine release,
                          output, scrap, and close records.
                        </p>
                      </div>
                      {isLoadingHistory && (
                        <Loader2 className="h-5 w-5 animate-spin text-primary" />
                      )}
                    </div>
                    <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_160px_140px]">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-4" />
                        <Input
                          value={historySearch}
                          onChange={(event) =>
                            setHistorySearch(event.target.value)
                          }
                          placeholder="Search customer, SO, material, code, machine, user, reason..."
                          className="h-11 rounded-xl border-line bg-surface-2 pl-10"
                        />
                      </div>
                      <Select
                        value={historyStatusFilter}
                        onValueChange={setHistoryStatusFilter}
                      >
                        <SelectTrigger className="h-11 rounded-xl border-line bg-surface-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ALL">All statuses</SelectItem>
                          <SelectItem value="RELEASED">Released</SelectItem>
                          <SelectItem value="EXECUTING">Executing</SelectItem>
                          <SelectItem value="PAUSED">Paused</SelectItem>
                          <SelectItem value="COMPLETED">Completed</SelectItem>
                          <SelectItem value="CANCELLED">Cancelled</SelectItem>
                          <SelectItem value="MATERIAL_ISSUE">
                            Material issue
                          </SelectItem>
                          <SelectItem value="SHORT_CLOSE">
                            Short close
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <Select
                        value={historyDaysFilter}
                        onValueChange={setHistoryDaysFilter}
                      >
                        <SelectTrigger className="h-11 rounded-xl border-line bg-surface-1">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="30">Last 30 days</SelectItem>
                          <SelectItem value="7">Last 7 days</SelectItem>
                          <SelectItem value="1">Today</SelectItem>
                          <SelectItem value="ALL">All history</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="mt-5 space-y-3">
                      {pagedHistoryJobs.map((assignment: any) => {
                        const job = assignment?.job_details || {};
                        const spec = normalizeProductSpec(job);
                        const summary = assignment?.history_summary || {};
                        const events = Array.isArray(assignment?.audit_events)
                          ? assignment.audit_events
                          : [];
                        const latestEvent = events[0];
                        const runtimeSkipOptions = Array.isArray(job.runtime_skip_options)
                          ? job.runtime_skip_options
                          : [];
                        return (
                          <div
                            key={assignment.id}
                            className="rounded-2xl border border-line bg-surface-2 p-4"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-4">
                              <div className="min-w-[260px] flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                  <div className="font-semibold text-content-1">
                                    {job.customer_name ||
                                      spec.customerName ||
                                      "Customer"}
                                  </div>
                                  <span className="text-sm font-semibold text-primary">
                                    {job.order_number ||
                                      spec.orderNumber ||
                                      "SO —"}
                                  </span>
                                </div>
                                <div className="text-sm text-content-3">
                                  {spec.productName} · {spec.size.label}
                                </div>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  {spec.layers.slice(0, 4).map((layer) => (
                                    <span
                                      key={`${assignment.id}-${layer.index}`}
                                      className="rounded-full border border-line bg-surface-1 px-2 py-0.5 text-caption font-semibold text-content-2"
                                    >
                                      {layerQueueLabel(layer)}
                                    </span>
                                  ))}
                                  {spec.podLabels.map((label) => (
                                    <span
                                      key={`${assignment.id}-pod-${label}`}
                                      className="rounded-full border border-info-border bg-surface-1 px-2 py-0.5 text-caption font-semibold text-info-fg"
                                    >
                                      PoD · {label}
                                    </span>
                                  ))}
                                  {spec.addonLabels.map((label) => (
                                    <span
                                      key={`${assignment.id}-addon-${label}`}
                                      className="rounded-full border border-warning-border bg-surface-1 px-2 py-0.5 text-caption font-semibold text-warm"
                                    >
                                      + {label}
                                    </span>
                                  ))}
                                </div>
                                <div className="mt-3 grid gap-2 text-xs md:grid-cols-4">
                                  <div className="rounded-xl border border-line bg-surface-1 px-3 py-2">
                                    <span className="block text-content-4">
                                      Output
                                    </span>
                                    <b>
                                      {Number(
                                        summary.output_qty ||
                                          job.produced_qty ||
                                          0,
                                      ).toFixed(3)}{" "}
                                      {job.uom || "KG"}
                                    </b>
                                  </div>
                                  <div className="rounded-xl border border-line bg-surface-1 px-3 py-2">
                                    <span className="block text-content-4">
                                      Scrap
                                    </span>
                                    <b>
                                      {Number(summary.scrap_qty || 0).toFixed(
                                        3,
                                      )}{" "}
                                      KG
                                    </b>
                                  </div>
                                  <div className="rounded-xl border border-line bg-surface-1 px-3 py-2">
                                    <span className="block text-content-4">
                                      Machine
                                    </span>
                                    <b>
                                      {assignment.assigned_machine_name || "—"}
                                    </b>
                                  </div>
                                  <div className="rounded-xl border border-line bg-surface-1 px-3 py-2">
                                    <span className="block text-content-4">
                                      Closed by
                                    </span>
                                    <b>{summary.closed_by || "—"}</b>
                                  </div>
                                </div>
                                <div className="mt-3 space-y-1">
                                  {events.slice(0, 4).map((event: any) => (
                                    <div
                                      key={event.id}
                                      className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface-1 px-3 py-2 text-xs"
                                    >
                                      <span className="font-semibold uppercase tracking-wider text-content-3">
                                        {String(event.action || "").replace(
                                          /_/g,
                                          " ",
                                        )}
                                      </span>
                                      <span className="text-content-4">by</span>
                                      <span className="font-semibold text-content-2">
                                        {event.actor || "system"}
                                      </span>
                                      <span className="text-content-4">·</span>
                                      <span className="text-content-3">
                                        {event.occurred_at
                                          ? formatDisplayDateTime(event.occurred_at)
                                          : "—"}
                                      </span>
                                      {event.reason ? (
                                        <span className="ml-auto text-content-3">
                                          {event.reason}
                                        </span>
                                      ) : null}
                                    </div>
                                  ))}
                                </div>
                                <div className="mt-2 text-xs text-content-3">
                                  {summary.closed_at
                                    ? `Closed ${formatDisplayDateTime(summary.closed_at)}`
                                    : latestEvent
                                      ? `Latest ${String(
                                          latestEvent.action || "",
                                        )
                                          .replace(/_/g, " ")
                                          .toLowerCase()}`
                                      : "Latest activity"}{" "}
                                  ·{" "}
                                  {summary.force_reason ||
                                    job.completion_force_reason ||
                                    "No variance note"}
                                </div>
                              </div>
                              <div className="flex flex-col items-end gap-2">
                                <Badge variant="outline">
                                  {job.job_state || job.status || "Closed"}
                                </Badge>
                                {runtimeSkipOptions.map((option: any) => (
                                  <Button
                                    key={`${assignment.id}-${option.job_id}`}
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-8 rounded-xl border-warning-border bg-warning-bg text-xs font-semibold text-warning-fg hover:bg-warning-bg"
                                    onClick={() => {
                                      setSkipNextStepAction({
                                        previousJob: job,
                                        option,
                                      });
                                      setSkipNextStepReason("");
                                    }}
                                  >
                                    <SkipForward className="mr-1.5 h-3.5 w-3.5" />
                                    Skip {option.process_code || "next step"}
                                  </Button>
                                ))}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      {!isLoadingHistory && !(historyJobs || []).length && (
                        <div className="rounded-xl border border-dashed border-line-strong p-8 text-center text-sm font-medium text-content-3">
                          No history rows yet.
                        </div>
                      )}
                      {((historyJobs || []) as any[]).length >
                      historyPageSize ? (
                        <div className="flex items-center justify-between rounded-2xl border border-line bg-surface-1 px-4 py-3 text-sm font-semibold text-content-3">
                          <span>
                            History page {historyPage} of {historyPageCount} ·{" "}
                            {((historyJobs || []) as any[]).length} jobs
                            {((historyJobs || []) as any[]).length >= 300 ? (
                              <span className="font-normal"> · newest 300 shown — search or narrow the dates to reach older jobs</span>
                            ) : null}
                          </span>
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              className="h-9 rounded-xl"
                              disabled={historyPage <= 1}
                              onClick={() =>
                                setHistoryPage(Math.max(1, historyPage - 1))
                              }
                            >
                              Previous
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              className="h-9 rounded-xl"
                              disabled={historyPage >= historyPageCount}
                              onClick={() =>
                                setHistoryPage(
                                  Math.min(historyPageCount, historyPage + 1),
                                )
                              }
                            >
                              Next
                            </Button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>
              )}
            </div>
          </section>
        ) : (
          <section
            ref={panelsRef}
            className="mt-3 grid gap-3 xl:grid-cols-[minmax(380px,420px)_minmax(0,1fr)] 2xl:grid-cols-[460px_minmax(0,1fr)]"
            style={{ ["--wcm-fill" as any]: panelsHeight ? `${panelsHeight}px` : undefined }}
          >
            <div
              className="flex flex-col overflow-hidden rounded-2xl border border-line bg-surface-1 shadow-[var(--shadow-sm)] xl:h-[var(--wcm-fill,calc(100dvh-212px))] xl:min-h-[460px]"
              data-testid="wcm-queue-panel"
            >
              {queueTabsBar}
              <div className="flex items-center gap-1.5 px-2.5 pt-2.5">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-content-4" />
                  <Input
                    value={queueSearch}
                    onChange={(event) => setQueueSearch(event.target.value)}
                    placeholder="Customer, SO #, product, size, grade, addon…"
                    aria-label="Search the queue"
                    className="h-9 rounded-lg border-line bg-surface-1 pl-8 pr-11 text-[13px]"
                  />
                  <span className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-line bg-surface-2 px-1 font-mono text-[10.5px] text-content-3 md:inline">
                    ⌘K
                  </span>
                </div>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button type="button" variant="outline" className="relative h-9 w-9 rounded-lg p-0" aria-label="Filters" data-testid="wcm-filters">
                      <Filter className="size-4" />
                      {queueFacetCount ? (
                        <span className="absolute -right-1.5 -top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] font-bold text-white">
                          {queueFacetCount}
                        </span>
                      ) : null}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-[340px] rounded-xl p-3">
                    <div className="grid gap-2">
                      <QueueFacetSelect label="material" value={queueMaterialFilter} options={queueFacetOptions.material} onChange={setQueueMaterialFilter} />
                      <QueueFacetSelect label="grade" value={queueGradeFilter} options={queueFacetOptions.grade} onChange={setQueueGradeFilter} />
                      <QueueFacetSelect label="thickness" value={queueThicknessFilter} options={queueFacetOptions.thickness} onChange={setQueueThicknessFilter} />
                      <QueueFacetSelect label="size" value={queueSizeFilter} options={queueFacetOptions.size} onChange={setQueueSizeFilter} />
                      <QueueFacetSelect label="process" value={queueProcessFilter} options={queueFacetOptions.process} onChange={setQueueProcessFilter} />
                    </div>
                    <div className="mt-3 flex justify-end">
                      <Button type="button" variant="ghost" size="sm" onClick={clearQueueFilters}>
                        Clear all
                      </Button>
                    </div>
                  </PopoverContent>
                </Popover>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button type="button" variant="outline" className="h-9 rounded-lg px-2.5 text-[12.5px]" data-testid="wcm-views">
                      <Bookmark className="mr-1 size-3.5" /> Views
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-[380px] rounded-xl p-3">
                    <SavedViewBar
                      pageId={`wcm-work-center-${wcId}-queue`}
                      currentQuery={savedWcmViewQuery}
                      defaultQuery=""
                      onApply={applySavedWcmView}
                    />
                  </PopoverContent>
                </Popover>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 w-9 rounded-lg p-0"
                      aria-label={`Sort the queue · ${queueSortLabel}`}
                      title={`Sort · ${queueSortLabel}`}
                    >
                      <SlidersHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    {QUEUE_SORT_OPTIONS.map(([value, label]) => (
                      <DropdownMenuItem key={value} onSelect={() => setQueueSortKey(value as typeof queueSortKey)}>
                        <Check className={cn("mr-2 size-3.5", queueSortKey === value ? "opacity-100" : "opacity-0")} />
                        {label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              {activeMainTab === "terminal" ? (
                <div className="flex flex-wrap items-center gap-1 px-2.5 pt-2" role="group" aria-label="Queue status">
                  {(
                    [
                      ["ALL", "All", queueCounts.all],
                      ["READY", "WC Ready", queueCounts.ready],
                      ["ASSIGNED", "Assigned", queueCounts.assigned],
                      ["NEEDS_MACHINE", "No machine", queueCounts.noMachine],
                    ] as const
                  ).map(([value, label, count]) => {
                    const isActive = queueStatusFilter === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={isActive}
                        disabled={value !== "ALL" && count === 0 && !isActive}
                        onClick={() => setQueueStatusFilter(value)}
                        className={cn(
                          "inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12.5px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                          isActive ? "border-content-1 bg-content-1 text-surface-1" : "border-line bg-surface-1 text-content-2 hover:bg-surface-2",
                        )}
                      >
                        {label}
                        <span className={cn("rounded px-1 font-mono text-[10.5px] tabular-nums", isActive ? "bg-surface-1/20" : "bg-surface-2 text-content-3")}>{count}</span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="px-3 pt-2 text-[12px] text-content-3">
                  Released jobs. Preparation is locked; execution continues on the machine terminal.
                </p>
              )}
              {queueSearch || queueStatusFilter !== "ALL" || queueHasFacetFilters ? (
                <div className="flex flex-wrap items-center gap-1 px-2.5 pt-2 text-[11.5px]">
                  {[
                    queueSearch ? ["Search", queueSearch, () => setQueueSearch("")] : null,
                    queueStatusFilter !== "ALL" ? ["Status", queueStatusFilter.replace("_", " ").toLowerCase(), () => setQueueStatusFilter("ALL")] : null,
                    queueMaterialFilter !== ALL_PRODUCTION_FACET ? ["Material", queueMaterialFilter, () => setQueueMaterialFilter(ALL_PRODUCTION_FACET)] : null,
                    queueGradeFilter !== ALL_PRODUCTION_FACET ? ["Grade", queueGradeFilter, () => setQueueGradeFilter(ALL_PRODUCTION_FACET)] : null,
                    queueThicknessFilter !== ALL_PRODUCTION_FACET ? ["Thickness", queueThicknessFilter, () => setQueueThicknessFilter(ALL_PRODUCTION_FACET)] : null,
                    queueSizeFilter !== ALL_PRODUCTION_FACET ? ["Size", queueSizeFilter, () => setQueueSizeFilter(ALL_PRODUCTION_FACET)] : null,
                    queueProcessFilter !== ALL_PRODUCTION_FACET ? ["Process", queueProcessFilter, () => setQueueProcessFilter(ALL_PRODUCTION_FACET)] : null,
                  ]
                    .filter(Boolean)
                    .map((token) => {
                      const [label, value, clear] = token as [string, string, () => void];
                      return (
                        <span key={label} className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-2 py-0.5 pl-2 pr-1 text-content-3">
                          {label} · <b className="text-content-1">{value}</b>
                          <button type="button" aria-label={`Remove ${label} filter`} className="grid h-4 w-4 place-items-center rounded-full hover:bg-surface-1" onClick={clear}>
                            ×
                          </button>
                        </span>
                      );
                    })}
                  <button type="button" onClick={clearQueueFilters} className="font-semibold text-primary hover:underline">
                    Clear all
                  </button>
                </div>
              ) : null}
              <div className="mt-2 border-t border-line xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:overscroll-contain" data-testid="wcm-queue-list">
                {showQueueSkeleton ? (
                  <div className="space-y-3" data-testid="wcm-queue-skeleton">
                    {[0, 1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className="overflow-hidden rounded-2xl border border-line bg-surface-1 p-5 shadow-sm"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 space-y-2">
                            <Skeleton className="h-3 w-24" />
                            <Skeleton className="h-6 w-2/3" />
                            <Skeleton className="h-4 w-1/2" />
                          </div>
                          <Skeleton className="h-7 w-28 rounded-full" />
                        </div>
                        <div className="mt-4 flex gap-2">
                          <Skeleton className="h-7 w-24 rounded-full" />
                          <Skeleton className="h-7 w-32 rounded-full" />
                          <Skeleton className="h-7 w-20 rounded-full" />
                        </div>
                        <Skeleton className="mt-4 h-2 w-full rounded-full" />
                      </div>
                    ))}
                  </div>
                ) : currentWorkList.length === 0 ? (
                  <div className="p-3">
                    <div className="rounded-2xl border border-dashed border-line-strong bg-surface-1 p-10 text-center shadow-sm">
                      <div className="text-lg font-semibold text-content-1">
                        {activeMainTab === "running"
                          ? "No released or running jobs right now."
                          : "No jobs in this queue right now."}
                      </div>
                      <p className="mt-1 text-sm text-content-3">
                        Try clearing filters or widening the date range.
                      </p>
                      <Button
                        type="button"
                        variant="outline"
                        className="mt-4 rounded-xl"
                        onClick={() => {
                          setQueueSearch("");
                          setQueueStatusFilter("ALL");
                          setQueueMaterialFilter(ALL_PRODUCTION_FACET);
                          setQueueGradeFilter(ALL_PRODUCTION_FACET);
                          setQueueThicknessFilter(ALL_PRODUCTION_FACET);
                          setQueueSizeFilter(ALL_PRODUCTION_FACET);
                          setQueueProcessFilter(ALL_PRODUCTION_FACET);
                        }}
                      >
                        Clear filters
                      </Button>
                    </div>
                  </div>
                ) : (
                  currentWorkList.map((assignment: any) => (
                    <WcmQueueRow
                      key={assignment.id}
                      assignment={assignment}
                      selected={activeAssignmentId === assignment.id}
                      running={activeMainTab === "running"}
                      onSelect={() => {
                        setActiveAssignmentId(assignment.id);
                        setDetailSheetOpen(true);
                      }}
                      onShortClose={() => {
                        setCloseJobAction({ assignment, mode: "SHORT_CLOSE" });
                        setCloseJobReason("");
                        setCloseJobReasonPreset("");
                      }}
                      onCancel={() => {
                        setCloseJobAction({ assignment, mode: "CANCEL" });
                        setCloseJobReason("");
                        setCloseJobReasonPreset("");
                      }}
                    />
                  ))
                )}
              </div>
              <footer className="flex items-center justify-between gap-2 border-t border-line px-3 py-2 text-[11.5px] text-content-3">
                <span className="truncate" data-testid="wcm-queue-footer">
                  {currentWorkTotal
                    ? `${(currentWorkPage - 1) * queuePageSize + 1}–${Math.min(currentWorkTotal, currentWorkPage * queuePageSize)} of ${currentWorkTotal} lines`
                    : "0 lines"}{" "}
                  · {queueSortLabel.toLowerCase()}
                  {assignmentsList.length >= 300 ? " · first 300 loaded, search to reach the rest" : ""}
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  {currentWorkPageCount > 1 ? (
                    <>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-[11.5px]"
                        disabled={currentWorkPage <= 1}
                        onClick={() => setCurrentWorkPage(Math.max(1, currentWorkPage - 1))}
                      >
                        Previous
                      </Button>
                      <span className="tabular-nums">
                        {currentWorkPage}/{currentWorkPageCount}
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7 px-2 text-[11.5px]"
                        disabled={currentWorkPage >= currentWorkPageCount}
                        onClick={() => setCurrentWorkPage(Math.min(currentWorkPageCount, currentWorkPage + 1))}
                      >
                        Next
                      </Button>
                    </>
                  ) : (
                    <span>Auto-refresh 30 s</span>
                  )}
                </span>
              </footer>
            </div>
            {isWideViewport ? (
              <aside
                className="hidden overflow-hidden rounded-2xl border border-line bg-surface-1 shadow-[var(--shadow-sm)] xl:flex xl:h-[var(--wcm-fill,calc(100dvh-212px))] xl:min-h-[460px] xl:flex-col"
                data-testid="wcm-pane-column"
              >
                {activeAssignment ? (
                  detailPaneContent
                ) : (
                    <div className="grid place-items-center h-full rounded-[18px] bg-surface-1 px-6 py-12 text-center" data-testid="wcm-detail-empty">
                      <div className="text-[15px] font-semibold text-content-1">No job selected</div>
                      <p className="mt-1 max-w-sm text-[13px] text-content-3">
                        Pick a job from the list to see what it is, what it needs and release it to a machine.
                      </p>
                      <ol className="mt-4 grid w-full max-w-sm gap-1.5 text-left" data-testid="wcm-detail-empty-steps">
                        {[
                          ["Order · what it is", "what is to be made and how much"],
                          ["Machine", "pick the machine that runs it"],
                          ["Rolls by lane", "the rolls this step runs on"],
                          ["Input issue", "granule codes; the rest is taken by step mapping"],
                          ["Release · readiness", "every gate clear, then release to the machine"],
                        ].map(([title, line], index) => (
                          <li key={title} className="flex items-start gap-2.5 rounded-[10px] bg-surface-2 px-3 py-2 ring-1 ring-line">
                            <span className="grid h-5 w-5 flex-none place-items-center rounded-full bg-surface-1 text-[11px] font-semibold text-content-2 ring-1 ring-line">
                              {index + 1}
                            </span>
                            <span className="text-[13px] leading-5">
                              <span className="font-semibold text-content-1">{title}</span>
                              <span className="text-content-3"> · {line}</span>
                            </span>
                          </li>
                        ))}
                      </ol>
                      {activeMainTab !== "running" && visibleRunningAssignments.length > 0 ? (
                        <Button variant="outline" className="mt-4 rounded-[10px]" onClick={() => setActiveMainTab("running")}>
                          Open Running / ready · {visibleRunningAssignments.length}
                        </Button>
                      ) : null}
                    </div>
                )}
              </aside>
            ) : null}
          </section>
        )}
      </main>
      {/* Tablet (md..xl): the detail pane opens as a drawer instead of stacking under the queue. */}
      <Sheet
        open={
          detailSheetOpen &&
          !isWideViewport &&
          activeMainTab !== "history" &&
          activeMainTab !== "stalled" &&
          Boolean(activeAssignment)
        }
        onOpenChange={setDetailSheetOpen}
      >
        <SheetContent
          side="right"
          className="flex w-[min(40rem,calc(100vw-1rem))] max-w-[calc(100vw-1rem)] flex-col gap-0 p-0 sm:max-w-[40rem] xl:hidden"
          data-testid="wcm-detail-sheet"
        >
          <SheetHeader className="sr-only">
            <SheetTitle className="font-display tracking-tight">
              Job preparation
            </SheetTitle>
            <SheetDescription>
              Review final-product details, step stock contract, release gates,
              and machine assignment before releasing this WCM job.
            </SheetDescription>
          </SheetHeader>
          <div className="min-h-0 flex-1">{detailPaneContent}</div>
        </SheetContent>
      </Sheet>
      <Dialog
        open={Boolean(closeJobAction)}
        onOpenChange={(open) => {
          if (!open) {
            setCloseJobAction(null);
            setCloseJobReason("");
            setCloseJobReasonPreset("");
          }
        }}
      >
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>
              {closeJobAction?.mode === "CANCEL"
                ? "Cancel job"
                : "Short close step"}
            </DialogTitle>
            <DialogDescription>
              This writes an audit reason to the production job and removes it
              from the active WCM queue.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-xl border border-line bg-surface-2 p-3 text-sm">
              <div className="font-semibold text-content-1">
                {closeJobAction?.assignment?.job_details?.customer_name ||
                  "Selected job"}
              </div>
              <div className="text-content-3">
                {closeJobAction?.assignment?.job_details?.product_name ||
                  closeJobAction?.assignment?.job_details?.template_name ||
                  "Production job"}
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-[12px] font-semibold text-content-3">
                Reason master
              </label>
              <Select
                value={closeJobReasonPreset}
                onValueChange={(value) => {
                  setCloseJobReasonPreset(value);
                  setCloseJobReason(value);
                }}
              >
                <SelectTrigger className="h-10 rounded-xl border-line bg-surface-1 text-sm font-semibold">
                  <SelectValue placeholder="Choose controlled reason..." />
                </SelectTrigger>
                <SelectContent>
                  {(
                    WCM_CLOSE_REASON_PRESETS[
                      closeJobAction?.mode || "CANCEL"
                    ] || []
                  ).map((reason) => (
                    <SelectItem key={`close-reason-${reason}`} value={reason}>
                      {reason}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex flex-wrap gap-1.5">
                {(
                  WCM_CLOSE_REASON_PRESETS[closeJobAction?.mode || "CANCEL"] ||
                  []
                ).map((reason) => (
                  <button
                    key={`close-reason-chip-${reason}`}
                    type="button"
                    onClick={() => {
                      setCloseJobReasonPreset(reason);
                      setCloseJobReason(reason);
                    }}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-caption font-bold",
                      closeJobReasonPreset === reason
                        ? "border-[#10233f] bg-[#10233f] text-white"
                        : "border-line bg-surface-2 text-content-2",
                    )}
                  >
                    {reason}
                  </button>
                ))}
              </div>
            </div>
            <Textarea
              value={closeJobReason}
              onChange={(event) => {
                setCloseJobReason(event.target.value);
                if (event.target.value !== closeJobReasonPreset)
                  setCloseJobReasonPreset("");
              }}
              placeholder="Reason required for audit history"
              className="min-h-24 rounded-xl"
            />
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                className="rounded-xl"
                onClick={() => {
                  setCloseJobAction(null);
                  setCloseJobReason("");
                  setCloseJobReasonPreset("");
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className={cn(
                  "rounded-xl",
                  closeJobAction?.mode === "CANCEL"
                    ? "bg-danger-solid hover:bg-danger-solid"
                    : "bg-surface-3 hover:bg-line",
                )}
                disabled={
                  closeJobReason.trim().length < 5 || mutation.isPending
                }
                onClick={handleCloseJobAction}
              >
                {mutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Confirm
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(skipNextStepAction)}
        onOpenChange={(open) => {
          if (!open) {
            setSkipNextStepAction(null);
            setSkipNextStepReason("");
          }
        }}
      >
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>Skip next route step</DialogTitle>
            <DialogDescription>
              This applies only to the next job for this produced batch. The
              template route stays unchanged.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-xl border border-warning-border bg-warning-bg p-3 text-sm">
              <div className="font-semibold text-warning-fg">
                {skipNextStepAction?.option?.process_code || "Next step"}
              </div>
              <div className="mt-1 text-warning-fg/80">
                {skipNextStepAction?.option?.process_name ||
                  skipNextStepAction?.option?.route_node_label ||
                  "Configured as skippable after previous output."}
              </div>
            </div>
            <Textarea
              value={skipNextStepReason}
              onChange={(event) => setSkipNextStepReason(event.target.value)}
              placeholder="Reason required, e.g. customer does not need slitting for this batch"
              className="min-h-24 rounded-xl"
            />
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                className="rounded-xl"
                onClick={() => {
                  setSkipNextStepAction(null);
                  setSkipNextStepReason("");
                }}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="rounded-xl border border-warning-border bg-warning-bg text-warning-fg hover:bg-warning-bg"
                disabled={skipNextStepReason.trim().length < 3 || mutation.isPending}
                onClick={handleSkipNextStepAction}
              >
                {mutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <SkipForward className="mr-2 h-4 w-4" />
                )}
                Confirm skip
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {selectedJobId ? (
        <WcmRollPickerDialog
          jobId={selectedJobId}
          open={tieredPickerOpen}
          onOpenChange={setTieredPickerOpen}
          onAssigned={() => {
            refetchContext();
            refetchSatisfaction();
            queryClient.invalidateQueries({
              queryKey: ["wip-pool-grouped", selectedJobId],
            });
          }}
        />
      ) : null}
    </div>
  );
}

function RollAssignmentModal({
  activeAssignment,
  targetSpec,
  targetSpecs = [],
  targetStockContract = {},
  rollBehavior,
  targetPlantId,
  targetPlantName,
  targetLocationId,
  targetLocationName,
  manualEligibleRolls,
  wipPoolMeta = {},
  rollAssignmentValidation = {},
  onAssigned,
  disabled,
  disabledLabel = "ROLLS ASSIGNED",
  required,
  strictSpecMatch = true,
  manualOverride = false,
  overrideReason = "",
}: any) {
  const [open, setOpen] = useState(false);
  const [transferKey, setTransferKey] = useState(() => crypto.randomUUID());
  const [activeTab, setActiveTab] = useState<"local" | "external">("local");
  const [selectedRollIds, setSelectedRollIds] = useState<string[]>([]);
  const [selectedExternalRollIds, setSelectedExternalRollIds] = useState<
    string[]
  >([]);
  const [rollSearch, setRollSearch] = useState("");

  // New Precise Filters
  const [filterVariant, setFilterVariant] = useState<string>("ALL");
  const [filterThickness, setFilterThickness] = useState<string>("ALL");
  const [filterGrade, setFilterGrade] = useState<string>("ALL");
  const [filterWidth, setFilterWidth] = useState<string>("ALL");
  const [filterStockForm, setFilterStockForm] = useState<string>("ALL");
  const [selectedTransferPlantId, setSelectedTransferPlantId] =
    useState<string>("");
  const [selectedSourceLocationId, setSelectedSourceLocationId] =
    useState<string>("ALL");
  const [selectedTargetLocationId, setSelectedTargetLocationId] =
    useState<string>(targetLocationId ? String(targetLocationId) : "");

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const effectiveTargetPlantId = String(
    targetPlantId || activeAssignment?.plant_id || "",
  );
  const behaviorNormalized = String(rollBehavior || "")
    .trim()
    .toUpperCase();
  const isMultiInputCombine =
    behaviorNormalized === "MULTI_INPUT_COMBINE" ||
    behaviorNormalized === "MULTI_INPUT" ||
    (behaviorNormalized.includes("MULTI") &&
      behaviorNormalized.includes("COMBINE"));

  const mutation = useMutation({
    mutationFn: async (rollIds: string[]) => {
      if (manualOverride && !String(overrideReason || "").trim()) {
        throw new Error("Override reason is required for manual override.");
      }
      await wcmService.allocateRolls(activeAssignment.id, rollIds, {
        manual_override: manualOverride,
        override_reason: String(overrideReason || "").trim() || undefined,
      });
    },
    onSuccess: () => {
      onAssigned();
      setOpen(false);
      setSelectedRollIds([]);
      setSelectedExternalRollIds([]);
      queryClient.invalidateQueries({ queryKey: ["wcm-queue"] });
      toast({ title: "Success", description: "Rolls assigned successfully." });
    },
    onError: (err: any) => {
      toast({
        variant: "destructive",
        title: "Assignment Failed",
        description: err.response?.data?.error || "Error assigning rolls.",
      });
    },
  });

  const variants = useMemo<string[]>(() => {
    const set = new Set(
      manualEligibleRolls.map((r: any) =>
        String(r.material_name || r.material_code || ""),
      ),
    );
    return ["ALL", ...Array.from(set).filter(Boolean).sort()] as string[];
  }, [manualEligibleRolls]);
  const lineageCandidateCount = useMemo(
    () =>
      manualEligibleRolls.filter(
        (r: any) => String(r?.roll_source || "").toUpperCase() === "LINEAGE",
      ).length,
    [manualEligibleRolls],
  );
  const fallbackCandidateCount = Math.max(
    0,
    manualEligibleRolls.length - lineageCandidateCount,
  );
  const matchedSlotCount = Number(
    (rollAssignmentValidation as any)?.matched_target_slots?.length || 0,
  );
  const unmatchedSlotCount = Number(
    (rollAssignmentValidation as any)?.unmatched_target_slots?.length || 0,
  );

  const thicknesses = useMemo<string[]>(() => {
    const set = new Set(
      manualEligibleRolls.map((r: any) => String(r.thickness_micron || "")),
    );
    return ["ALL", ...Array.from(set).filter(Boolean).sort()] as string[];
  }, [manualEligibleRolls]);

  const grades = useMemo<string[]>(() => {
    const set = new Set(
      manualEligibleRolls.map((r: any) => String(r.grade_name || "")),
    );
    return ["ALL", ...Array.from(set).filter(Boolean).sort()] as string[];
  }, [manualEligibleRolls]);

  const widths = useMemo<string[]>(() => {
    const set = new Set(
      manualEligibleRolls.map((r: any) => String(r.width_mm || "")),
    );
    return ["ALL", ...Array.from(set).filter(Boolean).sort()] as string[];
  }, [manualEligibleRolls]);

  const stockForms = useMemo<string[]>(() => {
    const set = new Set(
      manualEligibleRolls.map((r: any) =>
        String(r.stock_form || "OPEN_WEB").toUpperCase(),
      ),
    );
    return ["ALL", ...Array.from(set).filter(Boolean).sort()] as string[];
  }, [manualEligibleRolls]);

  const normalizedSpecs = useMemo(
    () => distinctRollTargetSpecs(targetSpec, targetSpecs),
    [targetSpec, targetSpecs],
  );

  const { data: externalAvailability } = useQuery({
    queryKey: [
      "roll-allocation-external-availability",
      normalizedSpecs,
      effectiveTargetPlantId,
      isMultiInputCombine,
    ],
    queryFn: async () => {
      if (!effectiveTargetPlantId) return [];
      const strictSingleSpec =
        normalizedSpecs.length === 1 && !isMultiInputCombine;
      const single = strictSingleSpec ? normalizedSpecs[0] : null;
      const { data } = await api.get("/api/inventory/rolls/availability/", {
        params: {
          variant_id: single?.variant_id,
          family_id: single?.family_id,
          thickness_micron: single?.thickness_micron,
          grade_id: single?.grade_id,
          min_width_mm: single?.min_width_mm,
          stock_form: single?.stock_form,
          width_basis: single?.width_basis,
          exclude_plant: effectiveTargetPlantId,
        },
      });
      const primary = Array.isArray(data) ? data : [];
      const primaryRolls = primary.reduce(
        (sum: number, plant: any) => sum + Number(plant?.total_rolls || 0),
        0,
      );
      if (normalizedSpecs.length > 1 && primaryRolls <= 1) {
        const { data: broadData } = await api.get(
          "/api/inventory/rolls/availability/",
          {
            params: { exclude_plant: effectiveTargetPlantId },
          },
        );
        const broad = Array.isArray(broadData) ? broadData : [];
        const broadRolls = broad.reduce(
          (sum: number, plant: any) => sum + Number(plant?.total_rolls || 0),
          0,
        );
        if (broadRolls > primaryRolls) return broad;
      }
      return primary;
    },
    enabled: open && Boolean(effectiveTargetPlantId),
  });

  const { data: targetLocations } = useQuery({
    queryKey: ["roll-allocation-target-locations", effectiveTargetPlantId],
    queryFn: async () => {
      if (!effectiveTargetPlantId) return [];
      try {
        return await inventoryService.getLocations(
          String(effectiveTargetPlantId),
        );
      } catch {
        return [];
      }
    },
    enabled: open && Boolean(effectiveTargetPlantId),
  });

  const matchesAnyTargetSpec = (roll: any) => {
    if (!normalizedSpecs.length) return true;
    return normalizedSpecs.some((spec: any) => {
      const materialOk = matchesRollMaterial(roll, spec);
      const thicknessOk =
        spec?.thickness_micron != null
          ? Number(roll?.thickness_micron || 0) ===
            Number(spec.thickness_micron)
          : true;
      const gradeOk = spec?.grade_id
        ? String(roll?.grade_id || "") === String(spec.grade_id)
        : true;
      const minWidth =
        spec?.min_width_mm != null ? Number(spec.min_width_mm) : null;
      const maxAutoWidth =
        spec?.max_auto_width_mm != null ? Number(spec.max_auto_width_mm) : null;
      const rollWidth = Number(roll?.width_mm || 0);
      const widthMinOk = minWidth != null ? rollWidth >= minWidth : true;
      const slitPolicy = String(
        spec?.slit_policy || targetStockContract?.slit_policy || "",
      ).toUpperCase();
      const exactWidthOk =
        minWidth == null || Math.abs(rollWidth - minWidth) <= 0.01;
      const widthMaxOk =
        !strictSpecMatch || maxAutoWidth == null
          ? true
          : rollWidth <= maxAutoWidth;
      const widthOk =
        (slitPolicy === "EXACT_ONLY" ? exactWidthOk : widthMinOk) &&
        widthMaxOk;
      const targetForm = spec?.stock_form || targetStockContract?.stock_form;
      const stockFormOk = targetForm
        ? String(roll?.stock_form || "OPEN_WEB").toUpperCase() ===
          String(targetForm).toUpperCase()
        : false;
      return materialOk && thicknessOk && gradeOk && widthOk && stockFormOk;
    });
  };

  const rollWidthPlanLabel = (roll: any) => {
    const mode = String(roll?.width_match_mode || "").toUpperCase();
    const spec = normalizedSpecs.find((candidate: any) => {
      const materialOk = matchesRollMaterial(roll, candidate);
      const thicknessOk =
        candidate?.thickness_micron != null
          ? Number(roll?.thickness_micron || 0) ===
            Number(candidate.thickness_micron)
          : true;
      const gradeOk = candidate?.grade_id
        ? String(roll?.grade_id || "") === String(candidate.grade_id)
        : true;
      return materialOk && thicknessOk && gradeOk;
    });
    const requiredWidth = Number(
      roll?.required_width_mm ||
        roll?.target_width_mm ||
        spec?.min_width_mm ||
        0,
    );
    const stockWidth = Number(roll?.stock_width_mm || roll?.width_mm || 0);
    if (!requiredWidth || !stockWidth) return "";
    if (mode === "EXACT_WIDTH" || Math.abs(stockWidth - requiredWidth) <= 0.01) {
      return `Exact width ${requiredWidth.toFixed(0)}mm`;
    }
    if (stockWidth > requiredWidth || mode === "WIDER_SLITTABLE") {
      return `Slit ${stockWidth.toFixed(0)}mm to required ${requiredWidth.toFixed(0)}mm`;
    }
    return `Too narrow: ${stockWidth.toFixed(0)}mm for ${requiredWidth.toFixed(0)}mm`;
  };

  const filtered = useMemo(() => {
    return manualEligibleRolls.filter((r: any) => {
      // Manual override changes source approval, never roll physics.
      if (!matchesAnyTargetSpec(r)) return false;
      if (
        filterVariant !== "ALL" &&
        r.material_name !== filterVariant &&
        r.material_code !== filterVariant
      )
        return false;
      if (
        filterThickness !== "ALL" &&
        String(r.thickness_micron) !== filterThickness
      )
        return false;
      if (filterGrade !== "ALL" && r.grade_name !== filterGrade) return false;
      if (filterWidth !== "ALL" && String(r.width_mm) !== filterWidth)
        return false;
      if (
        filterStockForm !== "ALL" &&
        String(r.stock_form || "OPEN_WEB").toUpperCase() !== filterStockForm
      )
        return false;

      const q = rollSearch.toLowerCase().trim();
      if (q) {
        const searchStr =
          `${r.label_id} ${r.supplier_roll || ""} ${r.batch_no || ""} ${r.location_name || ""} ${r.material_name} ${r.material_code} ${r.family_name}`.toLowerCase();
        if (!searchStr.includes(q)) return false;
      }
      return true;
    });
  }, [
    manualEligibleRolls,
    filterVariant,
    filterThickness,
    filterGrade,
    filterWidth,
    filterStockForm,
    rollSearch,
    normalizedSpecs,
    strictSpecMatch,
    targetStockContract,
  ]);
  const hasCandidateFilters =
    Boolean(rollSearch.trim()) ||
    filterVariant !== "ALL" ||
    filterThickness !== "ALL" ||
    filterGrade !== "ALL" ||
    filterWidth !== "ALL" ||
    filterStockForm !== "ALL";

  const transferPlantOptions = useMemo(() => {
    const rows = Array.isArray(externalAvailability)
      ? externalAvailability
      : [];
    return rows
      .filter((p: any) => Number(p?.total_rolls || 0) > 0)
      .map((p: any) => ({
        id: String(p.plant_id),
        name: String(p.plant_name || p.plant_id || "Plant"),
        totalRolls: Number(p.total_rolls || 0),
        totalWeightKg: Number(p.total_weight_kg || 0),
        rolls: Array.isArray(p.rolls) ? p.rolls : [],
      }))
      .sort(
        (a: any, b: any) =>
          Number(b.totalWeightKg || 0) - Number(a.totalWeightKg || 0),
      );
  }, [externalAvailability]);

  const selectedTransferPlant = useMemo(
    () =>
      transferPlantOptions.find(
        (p: any) => String(p.id) === String(selectedTransferPlantId),
      ),
    [transferPlantOptions, selectedTransferPlantId],
  );

  const sourceLocationOptions = useMemo(() => {
    const rows = Array.isArray(selectedTransferPlant?.rolls)
      ? selectedTransferPlant.rolls
      : [];
    const map = new Map<string, string>();
    rows.forEach((roll: any) => {
      const locationId = String(roll.location_id || "");
      const locationName = String(roll.location_name || "Location");
      if (locationId) map.set(locationId, locationName);
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [selectedTransferPlant]);

  const filteredExternalRolls = useMemo(() => {
    const rows = Array.isArray(selectedTransferPlant?.rolls)
      ? selectedTransferPlant.rolls
      : [];
    return rows.filter((r: any) => {
      if (!matchesAnyTargetSpec(r)) return false;
      if (
        selectedSourceLocationId !== "ALL" &&
        String(r.location_id || "") !== String(selectedSourceLocationId)
      )
        return false;
      if (
        filterVariant !== "ALL" &&
        String(r.material_name || "") !== filterVariant &&
        String(r.material_code || "") !== filterVariant
      )
        return false;
      if (
        filterThickness !== "ALL" &&
        String(r.thickness_micron || "") !== filterThickness
      )
        return false;
      if (filterGrade !== "ALL" && String(r.grade_name || "") !== filterGrade)
        return false;
      if (filterWidth !== "ALL" && String(r.width_mm || "") !== filterWidth)
        return false;
      if (
        filterStockForm !== "ALL" &&
        String(r.stock_form || "OPEN_WEB").toUpperCase() !== filterStockForm
      )
        return false;
      const q = rollSearch.toLowerCase().trim();
      if (q) {
        const searchStr =
          `${r.label_id} ${r.supplier_roll || ""} ${r.batch_no || ""} ${r.location_name || ""} ${r.material_name} ${r.material_code} ${r.location_name}`.toLowerCase();
        if (!searchStr.includes(q)) return false;
      }
      return true;
    });
  }, [
    selectedTransferPlant,
    selectedSourceLocationId,
    strictSpecMatch,
    filterVariant,
    filterThickness,
    filterGrade,
    filterWidth,
    filterStockForm,
    rollSearch,
    normalizedSpecs,
  ]);

  const externalEligibleCount = useMemo(() => {
    const rows = Array.isArray(externalAvailability)
      ? externalAvailability
      : [];
    let total = 0;
    rows.forEach((plant: any) => {
      const rolls = Array.isArray(plant?.rolls) ? plant.rolls : [];
      rolls.forEach((roll: any) => {
        if (matchesAnyTargetSpec(roll)) total += 1;
      });
    });
    return total;
  }, [externalAvailability, strictSpecMatch, normalizedSpecs]);

  const normalizedTargetLocations = useMemo(() => {
    const rows = Array.isArray(targetLocations) ? targetLocations : [];
    const normalized = rows
      .map((loc: any) => ({
        id: String(loc.id || loc.location_id || ""),
        name: String(loc.name || loc.location_name || loc.code || "Location"),
      }))
      .filter((loc: any) => loc.id);
    const preset = targetLocationId ? String(targetLocationId) : "";
    if (preset && !normalized.some((loc: any) => loc.id === preset)) {
      normalized.unshift({
        id: preset,
        name: String(targetLocationName || `Location ${preset.slice(0, 8)}`),
      });
    }
    return normalized;
  }, [targetLocations, targetLocationId, targetLocationName]);

  const transferMutation = useMutation({
    mutationFn: async () => {
      if (!selectedTransferPlantId || selectedExternalRollIds.length === 0) {
        throw new Error("Select source plant and at least one roll");
      }
      const destinationLocationId = String(
        selectedTargetLocationId || targetLocationId || "",
      );
      if (!destinationLocationId) {
        throw new Error("Target location missing");
      }
      await inventoryService.createAndDispatchChallan({
        from_plant: selectedTransferPlantId,
        to_plant: effectiveTargetPlantId,
        target_job: activeAssignment.production_job,
        dispatch: { target_location_id: destinationLocationId, roll_ids: selectedExternalRollIds },
      }, transferKey);
    },
    onSuccess: () => {
      toast({
        title: "Transfer Requested",
        description:
          "DC created for selected rolls. Receive it, then allocate.",
      });
      setOpen(false);
      setSelectedExternalRollIds([]);
      setTransferKey(crypto.randomUUID());
      onAssigned();
    },
    onError: (err: any) => {
      toast({
        variant: "destructive",
        title: "Transfer Failed",
        description:
          err?.message ||
          err?.response?.data?.error ||
          "Unable to create roll transfer.",
      });
    },
  });

  const toggleRoll = (rollId: string) => {
    setSelectedRollIds((prev) => {
      if (prev.includes(rollId)) return prev.filter((id) => id !== rollId);
      return [...prev, rollId];
    });
  };

  const toggleExternalRoll = (rollId: string) => {
    setSelectedExternalRollIds((prev) => {
      if (prev.includes(rollId)) return prev.filter((id) => id !== rollId);
      return [...prev, rollId];
    });
  };

  useEffect(() => {
    if (!open) return;
    if (filtered.length === 0 && externalEligibleCount > 0) {
      setActiveTab("external");
    } else {
      setActiveTab("local");
    }
    setSelectedRollIds([]);
    setSelectedExternalRollIds([]);
  }, [open]);


  useEffect(() => {
    if (!open) return;
    if (!transferPlantOptions.length) {
      setSelectedTransferPlantId("");
      setSelectedSourceLocationId("ALL");
      return;
    }
    if (
      !transferPlantOptions.some(
        (p: any) => String(p.id) === String(selectedTransferPlantId),
      )
    ) {
      setSelectedTransferPlantId(String(transferPlantOptions[0].id));
      setSelectedSourceLocationId("ALL");
    }
  }, [open, transferPlantOptions, selectedTransferPlantId]);

  useEffect(() => {
    if (!open) return;
    setSelectedSourceLocationId("ALL");
    setSelectedExternalRollIds([]);
  }, [open, selectedTransferPlantId]);

  useEffect(() => {
    if (!open) return;
    const preset = targetLocationId ? String(targetLocationId) : "";
    if (
      preset &&
      normalizedTargetLocations.some((loc: any) => String(loc.id) === preset)
    ) {
      setSelectedTargetLocationId(preset);
      return;
    }
    if (
      normalizedTargetLocations.length > 0 &&
      !normalizedTargetLocations.some(
        (loc: any) => String(loc.id) === String(selectedTargetLocationId),
      )
    ) {
      setSelectedTargetLocationId(String(normalizedTargetLocations[0].id));
    }
  }, [
    open,
    normalizedTargetLocations,
    selectedTargetLocationId,
    targetLocationId,
  ]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="h-7 border-info-border text-primary bg-info-bg hover:bg-info-bg font-bold px-3 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {disabled ? disabledLabel : "ALLOCATE ROLLS"}
      </Button>
      <DialogContent
        data-testid="wcm-allocation-dialog"
        className="flex h-[min(85vh,900px)] max-h-[85vh] max-w-5xl flex-col overflow-hidden p-0"
      >
        <DialogHeader className="p-6 bg-surface-2 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2">
            Resource Discovery & Allocation
            <Badge variant="secondary" className="font-mono text-caption">
              {activeAssignment?.job_details?.job_number}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            Select roll inputs matching BOM specs. Allocation persists as WCM
            reservation.
          </DialogDescription>
          <div className="mt-2 text-caption text-content-3">
            Spec:{" "}
            {normalizedSpecs.length > 0
              ? normalizedSpecs
                  .map((s: any) =>
                    [
                      s.variant_name || s.family_name || "Roll",
                      s.thickness_micron ? `${s.thickness_micron}μ` : null,
                      s.grade_name || (s.grade_id ? "Grade: required" : null),
                      s.stock_form ? stockFormLabel(s.stock_form) : null,
                    ]
                      .filter(Boolean)
                      .join(" • "),
                  )
                  .join(" | ")
              : "—"}
            {normalizedSpecs.some((s: any) => s?.min_width_mm != null)
              ? ` • Min Width: ${Number(
                  normalizedSpecs
                    .map((s: any) => s?.min_width_mm || 0)
                    .filter((v: number) => v > 0)
                    .sort((a: number, b: number) => a - b)[0] || 0,
                ).toFixed(0)}mm`
              : ""}
          </div>
          {required && filtered.length === 0 && externalEligibleCount > 0 && (
            <div className="mt-2 rounded-md border border-warning-border bg-warning-bg px-3 py-2 text-caption font-medium text-warning-fg">
              No eligible roll in current plant. Open{" "}
              <span className="font-bold">Other Plants / Transfer</span> tab to
              raise transfer request.
            </div>
          )}
          <div className="mt-3 overflow-hidden rounded-xl border border-line bg-surface-1">
            <div className="grid divide-y divide-line sm:grid-cols-4 sm:divide-x sm:divide-y-0">
              {[
                {
                  label: "Required",
                  value: Number(required || 0),
                  help: "rolls for this step",
                  tone: "text-primary",
                },
                {
                  label: "Slot coverage",
                  value: `${matchedSlotCount}/${Math.max(
                    Number(required || 0),
                    Number(
                      (rollAssignmentValidation as any)?.required_rolls || 0,
                    ),
                  )}`,
                  help:
                    unmatchedSlotCount > 0
                      ? `${unmatchedSlotCount} slot open`
                      : "mapped cleanly",
                  tone: "text-content-1",
                },
                {
                  label: "True WIP",
                  value: Number(
                    (wipPoolMeta as any)?.lineage_roll_count ||
                      lineageCandidateCount ||
                      0,
                  ),
                  help: "same-order lineage",
                  tone: "text-success-fg",
                },
                {
                  label: "Fallback",
                  value: Number(
                    (wipPoolMeta as any)?.fallback_roll_count ||
                      fallbackCandidateCount ||
                      0,
                  ),
                  help: "physical contract still applies",
                  tone: "text-warning-fg",
                },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between gap-3 px-3 py-2 sm:block">
                  <div className="text-caption font-semibold uppercase tracking-[0.08em] text-content-4">
                    {item.label}
                  </div>
                  <div className={cn("text-lg font-semibold", item.tone)}>
                    {item.value}
                  </div>
                  <div className="text-caption font-medium text-content-3">
                    {item.help}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-6">
            <div className="space-y-1.5">
              <label className="text-caption font-semibold text-content-3 uppercase">
                Search
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-content-4" />
                <Input
                  placeholder="Roll ID / Label..."
                  value={rollSearch}
                  onChange={(e) => setRollSearch(e.target.value)}
                  className="h-9 pl-9"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-caption font-semibold text-content-3 uppercase">
                Variant
              </label>
              <Select value={filterVariant} onValueChange={setFilterVariant}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {variants.map((v) => (
                    <SelectItem key={v} value={v}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-caption font-semibold text-content-3 uppercase">
                Thickness
              </label>
              <Select
                value={filterThickness}
                onValueChange={setFilterThickness}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {thicknesses.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t === "ALL" ? t : `${t}μ`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-caption font-semibold text-content-3 uppercase">
                Grade
              </label>
              <Select value={filterGrade} onValueChange={setFilterGrade}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {grades.map((g) => (
                    <SelectItem key={g} value={g}>
                      {g}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-caption font-semibold text-content-3 uppercase">
                Width
              </label>
              <Select value={filterWidth} onValueChange={setFilterWidth}>
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {widths.map((w) => (
                    <SelectItem key={w} value={w}>
                      {w === "ALL" ? w : `${w}mm`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-caption font-semibold text-content-3 uppercase">
                Stock form
              </label>
              <Select
                value={filterStockForm}
                onValueChange={setFilterStockForm}
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {stockForms.map((form) => (
                    <SelectItem key={form} value={form}>
                      {form === "ALL" ? "ALL" : stockFormLabel(form)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto bg-surface-1 p-6 pb-28">
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as "local" | "external")}
            className="space-y-4"
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="local" className="text-xs font-bold">
                Current Plant ({filtered.length})
              </TabsTrigger>
              <TabsTrigger value="external" className="text-xs font-bold">
                Other Plants / Transfer ({externalEligibleCount})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="local" className="space-y-3">
              <div className="grid grid-cols-1 gap-3">
                {filtered.map((roll: any) => {
                  const rollId = String(roll.id);
                  return (
                    <div
                      key={rollId}
                      data-testid={`wcm-local-roll-select-${rollId}`}
                      data-roll-id={rollId}
                      onClick={() => toggleRoll(rollId)}
                      className={cn(
                        "flex items-center gap-4 p-4 rounded-xl border-2 transition-all cursor-pointer group",
                        selectedRollIds.includes(rollId)
                          ? "border-primary bg-info-bg shadow-sm"
                          : "border-line hover:border-line",
                      )}
                    >
                      <div
                        className={cn(
                          "h-6 w-6 rounded-md border-2 flex items-center justify-center transition-all",
                          selectedRollIds.includes(rollId)
                            ? "bg-primary border-primary text-white"
                            : "bg-surface-1 border-line group-hover:border-info-border",
                        )}
                      >
                        {selectedRollIds.includes(rollId) && (
                          <CheckCircle2 className="h-4 w-4" />
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-semibold text-content-1 uppercase">
                            {roll.label_id}
                          </span>
                          {roll.spec_exact && (
                            <Badge className="bg-success-bg text-success-fg text-caption font-bold">
                              EXACT MATCH
                            </Badge>
                          )}
                          {!roll.spec_exact &&
                            String(roll.width_match_mode || "").toUpperCase() ===
                              "WIDER_SLITTABLE" && (
                              <Badge className="bg-warning-bg text-warning-fg text-caption font-bold">
                                WIDER · SLIT REQUIRED
                              </Badge>
                            )}
                          {String(roll.roll_source || "").toUpperCase() ===
                            "LINEAGE" && (
                            <Badge className="bg-[#10233f] text-white text-caption font-bold">
                              TRUE WIP
                            </Badge>
                          )}
                          {String(roll.roll_source || "").toUpperCase() ===
                            "PURCHASED_FALLBACK" && (
                            <Badge className="bg-warning-bg text-warning-fg text-caption font-bold">
                              PURCHASED FALLBACK
                            </Badge>
                          )}
                          {String(roll.roll_source || "").toUpperCase() ===
                            "COMPATIBLE_FALLBACK" && (
                            <Badge className="bg-info-bg text-primary text-caption font-bold">
                              COMPATIBLE FALLBACK
                            </Badge>
                          )}
                          <Badge className="border-info-border bg-info-bg text-info-fg text-caption font-bold">
                            {stockFormLabel(roll.stock_form)}
                          </Badge>
                        </div>
                        <div className="text-caption font-medium text-content-3">
                          {roll.material_name} • {roll.thickness_micron}μ •{" "}
                          {roll.width_mm}mm ({widthBasisLabel(roll.width_basis)}
                          ) • Grade: {roll.grade_name || "—"}
                        </div>
                        {rollWidthPlanLabel(roll) ? (
                          <div className="mt-1 text-caption font-semibold uppercase tracking-[0.08em] text-info-fg">
                            {rollWidthPlanLabel(roll)}
                          </div>
                        ) : null}
                        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-caption font-bold text-success-fg">
                          <span>✓ Material</span>
                          <span>✓ Gauge</span>
                          <span>✓ Width</span>
                          <span>✓ Stock form</span>
                          {normalizedSpecs.some((spec: any) => spec?.grade_id) ? (
                            <span>✓ Grade</span>
                          ) : null}
                        </div>
                        <div className="text-caption text-content-4 font-bold uppercase mt-1">
                          Loc: {roll.location || roll.location_name}{" "}
                          {roll.location_type ? `(${roll.location_type})` : ""}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2 text-right">
                        <div className="text-lg font-semibold text-content-1 leading-none">
                          {roll.weight_kg}{" "}
                          <span className="text-caption text-content-3">KG</span>
                        </div>
                        <div className="text-xs font-bold text-content-3">
                          {roll.width_mm}{" "}
                          <span className="text-caption">MM</span> ·{" "}
                          {stockFormLabel(roll.stock_form)}
                        </div>
                        <Button
                          size="sm"
                          variant={
                            selectedRollIds.includes(rollId)
                              ? "default"
                              : "outline"
                          }
                          className={cn(
                            "relative z-10 h-7 shrink-0 px-4 text-caption font-semibold uppercase tracking-tighter",
                            selectedRollIds.includes(rollId)
                              ? "bg-primary"
                              : "text-primary border-info-border",
                          )}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            toggleRoll(rollId);
                          }}
                        >
                          {selectedRollIds.includes(rollId)
                            ? "SELECTED"
                            : "SELECT"}
                        </Button>
                      </div>
                    </div>
                  );
                })}
                {filtered.length === 0 && (
                  <div className="mx-auto max-w-2xl py-12 text-center text-content-4">
                    <Activity className="mx-auto mb-3 h-9 w-9 opacity-15" />
                    <p className="font-semibold text-content-2">
                      {hasCandidateFilters
                        ? "No eligible rolls match these search filters"
                        : "No roll satisfies the current-step contract"}
                    </p>
                    <p className="mx-auto mt-1 max-w-xl text-xs leading-relaxed text-content-3">
                      {hasCandidateFilters
                        ? "Clear the optional filters to return to every physically eligible roll."
                        : "The system requires the same material, exact gauge and grade, correct stock form, and sufficient width. Physical constraints cannot be overridden."}
                    </p>
                    {!hasCandidateFilters && normalizedSpecs.length > 0 ? (
                      <div className="mt-4 flex flex-wrap justify-center gap-2">
                        {normalizedSpecs.slice(0, 4).map((spec: any, index: number) => (
                          <span
                            key={`${String(spec?.variant_id || spec?.family_id || "roll")}-${index}`}
                            className="rounded-md border border-line bg-surface-2 px-2.5 py-1 text-caption font-bold text-content-2"
                          >
                            {spec?.variant_name || spec?.family_name || "Roll"}
                            {spec?.thickness_micron != null
                              ? ` · ${Number(spec.thickness_micron)}µ`
                              : ""}
                            {spec?.min_width_mm != null
                              ? ` · ${String(spec?.slit_policy || "").toUpperCase() === "EXACT_ONLY" ? "=" : "≥"}${Number(spec.min_width_mm).toFixed(0)}mm`
                              : ""}
                            {spec?.stock_form
                              ? ` · ${stockFormLabel(spec.stock_form)}`
                              : ""}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {externalEligibleCount > 0 && (
                      <Button
                        variant="outline"
                        className="mt-4 text-xs"
                        onClick={() => setActiveTab("external")}
                      >
                        View Other Plants & Request Transfer
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="external" className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-caption font-semibold uppercase text-content-3">
                    From Plant
                  </label>
                  <Select
                    value={selectedTransferPlantId}
                    onValueChange={(val) => {
                      setSelectedTransferPlantId(val);
                      setSelectedExternalRollIds([]);
                    }}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Select plant" />
                    </SelectTrigger>
                    <SelectContent>
                      {transferPlantOptions.map((p: any) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name} ({p.totalRolls} rolls,{" "}
                          {p.totalWeightKg.toFixed(1)} kg)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-caption font-semibold uppercase text-content-3">
                    From Location
                  </label>
                  <Select
                    value={selectedSourceLocationId}
                    onValueChange={setSelectedSourceLocationId}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="All locations" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">All locations</SelectItem>
                      {sourceLocationOptions.map((loc: any) => (
                        <SelectItem key={loc.id} value={loc.id}>
                          {loc.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-caption font-semibold uppercase text-content-3">
                    To Location
                  </label>
                  <Select
                    value={selectedTargetLocationId}
                    onValueChange={setSelectedTargetLocationId}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="Select location" />
                    </SelectTrigger>
                    <SelectContent>
                      {normalizedTargetLocations.map((loc: any) => (
                        <SelectItem key={loc.id} value={loc.id}>
                          {loc.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="text-caption text-content-3">
                Destination plant:{" "}
                <span className="font-bold text-content-2">
                  {targetPlantName || targetPlantId || "—"}
                </span>
              </div>
              <div className="space-y-2 max-h-[360px] overflow-y-auto rounded-lg border border-line bg-surface-2 p-3">
                {filteredExternalRolls.length === 0 && (
                  <div className="text-center py-14 text-content-4">
                    <p className="font-bold">
                      No transferable rolls found in other plants for this spec.
                    </p>
                  </div>
                )}
                {filteredExternalRolls.map((roll: any) => {
                  const rollId = String(roll.id);
                  const checked = selectedExternalRollIds.includes(rollId);
                  return (
                    <div
                      key={rollId}
                      onClick={() => toggleExternalRoll(rollId)}
                      className={cn(
                        "flex items-center justify-between rounded-lg border p-3 bg-surface-1 cursor-pointer",
                        checked
                          ? "border-warning-border bg-warning-bg"
                          : "border-line",
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <div onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={checked}
                            onCheckedChange={() => toggleExternalRoll(rollId)}
                          />
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-content-1 uppercase">
                            {roll.label_id}
                          </div>
                          <div className="text-caption text-content-3">
                            {roll.material_name} • {roll.thickness_micron}μ •{" "}
                            {roll.width_mm}mm ({stockFormLabel(roll.stock_form)}
                            ) • {roll.grade_name || "—"}
                          </div>
                          {rollWidthPlanLabel(roll) ? (
                            <div className="text-caption font-bold uppercase tracking-[0.06em] text-info-fg">
                              {rollWidthPlanLabel(roll)}
                            </div>
                          ) : null}
                          <div className="text-caption font-medium text-content-3">
                            {roll.location_name || "—"}
                          </div>
                        </div>
                      </div>
                      <div className="text-right text-xs font-bold text-content-2">
                        {Number(roll.weight_kg || 0).toFixed(3)} kg
                      </div>
                    </div>
                  );
                })}
              </div>
            </TabsContent>
          </Tabs>
        </div>

        <div className="p-6 bg-surface-2 border-t shrink-0 flex justify-between items-center">
          <div className="text-sm">
            {activeTab === "local" ? (
              <>
                <span className="font-bold text-content-1">
                  {selectedRollIds.length}
                </span>{" "}
                rolls selected for allocation
              </>
            ) : (
              <>
                <span className="font-bold text-content-1">
                  {selectedExternalRollIds.length}
                </span>{" "}
                rolls selected for transfer
              </>
            )}
          </div>
          <div className="flex gap-3">
            <Button
              variant="ghost"
              onClick={() => setOpen(false)}
              className="font-bold"
            >
              CANCEL
            </Button>
            {activeTab === "local" ? (
              <Button
                className="bg-primary hover:bg-primary font-semibold px-8"
                disabled={
                  selectedRollIds.length === 0 ||
                  mutation.isPending ||
                  (manualOverride && !String(overrideReason || "").trim())
                }
                onClick={() => mutation.mutate(selectedRollIds)}
              >
                {mutation.isPending ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  "FINALIZE ALLOCATION"
                )}
              </Button>
            ) : (
              <Button
                className="bg-warning-fg hover:bg-warning-fg text-white font-semibold px-8"
                disabled={
                  selectedExternalRollIds.length === 0 ||
                  transferMutation.isPending ||
                  !selectedTransferPlantId ||
                  !selectedTargetLocationId
                }
                onClick={() => transferMutation.mutate()}
              >
                {transferMutation.isPending ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  "CREATE TRANSFER REQUEST"
                )}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RollTransferModal({
  jobId,
  targetSpec,
  targetSpecs = [],
  targetStockContract = {},
  rollBehavior,
  targetPlantId,
  targetPlantName,
  targetLocationId,
  targetLocationName,
  onRequested,
}: any) {
  const [open, setOpen] = useState(false);
  const [transferKey, setTransferKey] = useState(() => crypto.randomUUID());
  const [selectedPlantId, setSelectedPlantId] = useState<string>("");
  const [selectedSourceLocationId, setSelectedSourceLocationId] =
    useState<string>("ALL");
  const [selectedTargetLocationId, setSelectedTargetLocationId] =
    useState<string>(targetLocationId ? String(targetLocationId) : "");
  const [selectedRollIds, setSelectedRollIds] = useState<string[]>([]);
  const { toast } = useToast();
  const behaviorNormalized = String(rollBehavior || "")
    .trim()
    .toUpperCase();
  const isMultiInputCombine =
    behaviorNormalized === "MULTI_INPUT_COMBINE" ||
    behaviorNormalized === "MULTI_INPUT" ||
    (behaviorNormalized.includes("MULTI") &&
      behaviorNormalized.includes("COMBINE"));

  const normalizedSpecs = useMemo(
    () => distinctRollTargetSpecs(targetSpec, targetSpecs),
    [targetSpec, targetSpecs],
  );

  const { data: availability } = useQuery({
    queryKey: ["roll-availability", normalizedSpecs, targetPlantId],
    queryFn: async () => {
      const strictSingleSpec =
        normalizedSpecs.length === 1 && !isMultiInputCombine;
      const single = strictSingleSpec ? normalizedSpecs[0] : null;
      const { data } = await api.get("/api/inventory/rolls/availability/", {
        params: {
          variant_id: single?.variant_id,
          family_id: single?.family_id,
          thickness_micron: single?.thickness_micron,
          grade_id: single?.grade_id,
          min_width_mm: single?.min_width_mm,
          stock_form: single?.stock_form,
          width_basis: single?.width_basis,
          exclude_plant: targetPlantId,
        },
      });
      const primary = Array.isArray(data) ? data : [];
      const primaryRolls = primary.reduce(
        (sum: number, plant: any) => sum + Number(plant?.total_rolls || 0),
        0,
      );
      if (normalizedSpecs.length > 1 && primaryRolls <= 1) {
        const { data: broadData } = await api.get(
          "/api/inventory/rolls/availability/",
          {
            params: { exclude_plant: targetPlantId },
          },
        );
        const broad = Array.isArray(broadData) ? broadData : [];
        const broadRolls = broad.reduce(
          (sum: number, plant: any) => sum + Number(plant?.total_rolls || 0),
          0,
        );
        if (broadRolls > primaryRolls) return broad;
      }
      return primary;
    },
    enabled: open,
  });

  const selectedPlant = (availability || []).find(
    (p: any) => String(p.plant_id) === String(selectedPlantId),
  );
  const rollsRaw = selectedPlant?.rolls || [];
  const sourceLocationOptions = useMemo(() => {
    const map = new Map<string, string>();
    (Array.isArray(rollsRaw) ? rollsRaw : []).forEach((roll: any) => {
      const id = String(roll.location_id || roll.location || "");
      const name = String(roll.location_name || roll.location || "Location");
      if (id) map.set(id, name);
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [rollsRaw]);
  const { data: targetLocations } = useQuery({
    queryKey: ["roll-transfer-target-locations", targetPlantId],
    queryFn: async () => {
      if (!targetPlantId) return [];
      try {
        return await inventoryService.getLocations(String(targetPlantId));
      } catch {
        return [];
      }
    },
    enabled: open && Boolean(targetPlantId),
  });
  const normalizedTargetLocations = useMemo(() => {
    const rows = Array.isArray(targetLocations) ? targetLocations : [];
    const normalized = rows
      .map((loc: any) => ({
        id: String(loc.id || loc.location_id || ""),
        name: String(loc.name || loc.location_name || loc.code || "Location"),
      }))
      .filter((loc: any) => loc.id);
    const preset = targetLocationId ? String(targetLocationId) : "";
    if (preset && !normalized.some((loc: any) => loc.id === preset)) {
      normalized.unshift({
        id: preset,
        name: String(targetLocationName || `Location ${preset.slice(0, 8)}`),
      });
    }
    return normalized;
  }, [targetLocations, targetLocationId, targetLocationName]);
  const specMatchedRolls = useMemo(() => {
    const matchSpec = (roll: any, spec: any) => {
      if (!spec) return true;
      const materialOk = matchesRollMaterial(roll, spec);
      const thicknessOk =
        spec.thickness_micron != null
          ? Math.abs(Number(roll.thickness_micron) - Number(spec.thickness_micron)) <= 0.01
          : true;
      const gradeOk = spec.grade_id
        ? String(spec.grade_id) === String(roll.grade_id || "")
        : true;
      const widthOk = spec.min_width_mm != null
        ? Number(roll.width_mm) >= Number(spec.min_width_mm)
        : true;
      const targetForm = spec?.stock_form || targetStockContract?.stock_form;
      const stockFormOk = processCanUseRollForTarget(
        roll?.stock_form,
        targetForm,
        targetStockContract?.process_capabilities,
      );
      return (
        materialOk &&
        thicknessOk &&
        gradeOk &&
        widthOk &&
        stockFormOk
      );
    };
    if (!normalizedSpecs.length) return [];
    const filtered = rollsRaw.filter((r: any) =>
      normalizedSpecs.some((s: any) => matchSpec(r, s)),
    );
    return filtered;
  }, [rollsRaw, normalizedSpecs, isMultiInputCombine, targetStockContract]);
  const rolls = useMemo(() => {
    if (selectedSourceLocationId === "ALL") return specMatchedRolls;
    return specMatchedRolls.filter(
      (r: any) =>
        String(r.location_id || r.location || "") ===
        String(selectedSourceLocationId),
    );
  }, [specMatchedRolls, selectedSourceLocationId]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!selectedPlantId || selectedRollIds.length === 0) {
        throw new Error("Select at least one roll from a source plant");
      }
      if (!targetPlantId) {
        throw new Error("Target plant missing");
      }
      const effectiveTargetLocationId = String(
        selectedTargetLocationId || targetLocationId || "",
      );
      if (!effectiveTargetLocationId) {
        throw new Error("Target location missing");
      }
      await inventoryService.createAndDispatchChallan({
        from_plant: selectedPlantId,
        to_plant: targetPlantId,
        target_job: jobId,
        dispatch: { target_location_id: effectiveTargetLocationId, roll_ids: selectedRollIds },
      }, transferKey);
    },
    onSuccess: () => {
      toast({
        title: "Transfer Requested",
        description: "DC created and dispatched for selected rolls.",
      });
      setOpen(false);
      setSelectedRollIds([]);
      setTransferKey(crypto.randomUUID());
      if (onRequested) onRequested();
    },
    onError: (err: any) => {
      toast({
        variant: "destructive",
        title: "Transfer Failed",
        description:
          err.message || err.response?.data?.error || "Unknown error",
      });
    },
  });

  useEffect(() => {
    if (!open) return;
    if (
      !selectedPlantId &&
      Array.isArray(availability) &&
      availability.length > 0
    ) {
      setSelectedPlantId(String(availability[0].plant_id));
    }
  }, [open, availability, selectedPlantId]);
  useEffect(() => {
    if (!open) return;
    setSelectedSourceLocationId("ALL");
    setSelectedRollIds([]);
  }, [open, selectedPlantId]);
  useEffect(() => {
    if (!open) return;
    const preset = targetLocationId ? String(targetLocationId) : "";
    if (
      preset &&
      normalizedTargetLocations.some((loc: any) => String(loc.id) === preset)
    ) {
      setSelectedTargetLocationId(preset);
      return;
    }
    if (
      normalizedTargetLocations.length > 0 &&
      !normalizedTargetLocations.some(
        (loc: any) => String(loc.id) === String(selectedTargetLocationId),
      )
    ) {
      setSelectedTargetLocationId(String(normalizedTargetLocations[0].id));
    }
  }, [
    open,
    normalizedTargetLocations,
    targetLocationId,
    selectedTargetLocationId,
  ]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-caption font-semibold text-warning-fg border-warning-border bg-warning-bg hover:bg-warning-bg"
        >
          TRANSFER
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Request Roll Transfer</DialogTitle>
          <DialogDescription>
            Create a delivery challan for matching rolls from another plant to
            this work center plant.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="text-xs text-content-3">
            Required specs:{" "}
            <span className="font-bold text-content-2">
              {normalizedSpecs.length > 0
                ? normalizedSpecs
                    .map((s: any) =>
                      [
                        s.variant_name || s.family_name || "Roll",
                        s.thickness_micron ? `${s.thickness_micron}μ` : null,
                        s.grade_name || null,
                        s.stock_form ? stockFormLabel(s.stock_form) : null,
                      ]
                        .filter(Boolean)
                        .join(" • "),
                    )
                    .join(" | ")
                : "—"}
            </span>
          </div>
          <div className="text-xs text-content-3">
            To plant:{" "}
            <span className="font-bold text-content-2">
              {targetPlantName || targetPlantId || "—"}
            </span>
          </div>

          <div>
            <label className="text-caption font-semibold uppercase text-content-3">
              From Plant
            </label>
            <Select
              value={selectedPlantId}
              onValueChange={(val) => {
                setSelectedPlantId(val);
                setSelectedRollIds([]);
              }}
            >
              <SelectTrigger className="h-10">
                <SelectValue placeholder="Select Plant" />
              </SelectTrigger>
              <SelectContent>
                {(availability || []).map((p: any) => (
                  <SelectItem key={p.plant_id} value={p.plant_id}>
                    {p.plant_name} ({p.total_rolls} rolls,{" "}
                    {Number(p.total_weight_kg || 0).toFixed(1)} kg)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-caption font-semibold uppercase text-content-3">
              From Location
            </label>
            <Select
              value={selectedSourceLocationId}
              onValueChange={setSelectedSourceLocationId}
            >
              <SelectTrigger className="h-10">
                <SelectValue placeholder="All locations" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All locations</SelectItem>
                {sourceLocationOptions.map((loc: any) => (
                  <SelectItem key={loc.id} value={loc.id}>
                    {loc.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-caption font-semibold uppercase text-content-3">
              To Location
            </label>
            {normalizedTargetLocations.length > 0 ? (
              <Select
                value={selectedTargetLocationId}
                onValueChange={setSelectedTargetLocationId}
              >
                <SelectTrigger className="h-10">
                  <SelectValue placeholder="Select destination location" />
                </SelectTrigger>
                <SelectContent>
                  {normalizedTargetLocations.map((loc: any) => (
                    <SelectItem key={loc.id} value={loc.id}>
                      {loc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                value={
                  targetLocationName ||
                  targetLocationId ||
                  "No destination location found"
                }
                readOnly
                className="h-10 bg-surface-2"
              />
            )}
          </div>

          <div className="space-y-2 max-h-[240px] overflow-y-auto border rounded-lg p-3 bg-surface-2">
            {rolls.length === 0 && (
              <div className="text-xs text-content-4">
                No rolls available for this spec.
              </div>
            )}
            {rolls.map((r: any) => {
              const checked = selectedRollIds.includes(r.id);
              return (
                <div
                  key={r.id}
                  className="flex items-center justify-between bg-surface-1 border rounded-md p-2"
                >
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => {
                        if (checked)
                          setSelectedRollIds(
                            selectedRollIds.filter((id) => id !== r.id),
                          );
                        else setSelectedRollIds([...selectedRollIds, r.id]);
                      }}
                    />
                    <div>
                      <div className="text-xs font-bold text-content-2">
                        {r.label_id}
                      </div>
                      <div className="text-caption text-content-3">
                        {r.thickness_micron}μ • {r.width_mm}mm (
                        {stockFormLabel(r.stock_form)}) • {r.weight_kg}kg •{" "}
                        {r.grade_name || "—"}
                      </div>
                    </div>
                  </div>
                  <div className="text-caption text-content-4">
                    {r.location_name}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => mutation.mutate()}
              disabled={
                mutation.isPending ||
                selectedRollIds.length === 0 ||
                !selectedTargetLocationId
              }
              className="bg-warning-fg hover:bg-warning-fg text-white"
            >
              {mutation.isPending ? "Requesting..." : "Create DC Transfer"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

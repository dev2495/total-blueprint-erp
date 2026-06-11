"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  History,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NumPadPopover } from "@/components/ui/num-pad";
import { formatDisplayDateTime } from "@/lib/date-format";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { normalizeProductSpec } from "@/lib/product-spec";
import { toast } from "@/hooks/use-toast";
import {
  useOnlineStatus,
  STALE_THRESHOLD_SECONDS,
} from "@/hooks/use-online-status";
import { ConnectionLostBanner } from "@/components/system/connection-banner";
import { inventoryService } from "@/services/inventory";
import {
  masterDataService,
  type GranuleQualityCode,
  type Material,
} from "@/services/master-data";
import { machineService, type MachineJobEvent } from "@/services/machine";
import {
  reasonCodesService,
  groupReasonCodes,
  type ReasonCode,
  type ReasonCodeGroup,
} from "@/services/reason-codes";
import {
  ArtworkButton,
  CylinderSetCard,
} from "@/components/machine/cylinder-artwork";

type QueueFilter = "ALL" | "RUNNING" | "READY" | "PAUSED";
type TerminalTab = "run" | "history";
type SublogKind = "scrap" | "downtime" | "consumption" | "quality" | null;
type EntryMode = "KG" | "PCS";

type SplitRow = {
  id: number;
  width_mm: string;
  weight_kg: string;
  tare_weight_kg: string;
  gross_weight_kg: string;
};

type CreateRollRow = {
  id: number;
  width_mm: string;
  weight_kg: string;
  length_m: string;
  tare_weight_kg: string;
  gross_weight_kg: string;
};

type MaterialConfirmationDraft = {
  requirement_id: string;
  material_id?: string;
  actual_issued_qty: string;
  actual_returned_qty: string;
  actual_scrap_qty: string;
  is_estimated: boolean;
  return_mode?: "EXACT_COLOR_RETURN" | "REMIXED_RETURN";
  target_ink_material_id?: string;
  granule_code_allocations?: Array<{ granule_code_id: string; qty_kg: string }>;
};

type MaterialReleaseRow = {
  requirement_id: string;
  material_id?: string;
  code: string;
  name: string;
  category: string;
  uom: string;
  requiredQty: number;
  theoreticalQty: number;
  plannedIssueQty: number;
  issuedQty: number;
  returnedQty: number;
  scrapQty: number;
  consumedQty: number;
  varianceQty: number;
  estimatedQty: number;
  availableQty: number;
  currentPlantAvailableQty: number;
  otherPlantsAvailableQty: number;
  sourceLocationName: string;
  captureMode: string;
  policyLabel: string;
  granuleCodeOptions: Array<{
    granule_code_id: string;
    code: string;
    available_qty_kg?: number;
    location_name?: string;
    plant_name?: string;
  }>;
};

type QualityDraft = {
  code: string;
  label: string;
  value: string;
  spec_min?: number;
  spec_max?: number;
  textMode?: boolean;
  in_spec: boolean;
};

const POLL_MS = 8000;
const EVENTS_POLL_MS = 5000;
const DEFAULT_REMAINDER = "__DEFAULT__";
const SELECT_NONE = "__NONE__";

const surfaceClass =
  "rounded-[18px] border border-line bg-surface-1 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-14px_rgba(15,23,42,0.12)]";
const labelClass =
  "text-[10px] font-bold uppercase tracking-[0.18em] text-content-3";
const inputClass =
  "h-10 rounded-lg border-line bg-surface-1 text-sm font-semibold text-content-1 focus-visible:ring-primary";

const STOCK_FORM_OPTIONS = [
  { value: "OPEN_WEB", label: "Open web", basis: "full sheet width" },
  { value: "LAYFLAT_TUBE", label: "Lay-flat tube", basis: "folded/tube width" },
  { value: "FOLDED_WEB", label: "Folded web", basis: "folded width" },
] as const;

function normalizeStockForm(value?: unknown) {
  const raw = String(value || "OPEN_WEB")
    .trim()
    .toUpperCase();
  if (raw === "TUBE" || raw === "LAYFLAT" || raw === "LAY_FLAT_TUBE")
    return "LAYFLAT_TUBE";
  if (raw === "FOLDED" || raw === "FOLDED_SHEET") return "FOLDED_WEB";
  return raw || "OPEN_WEB";
}

function stockFormLabel(value?: unknown) {
  const form = normalizeStockForm(value);
  if (form === "LAYFLAT_TUBE") return "Lay-flat tube";
  if (form === "FOLDED_WEB") return "Folded web";
  return "Open web";
}

function widthBasisLabel(value?: unknown, stockForm?: unknown) {
  const basis = String(value || "")
    .trim()
    .toUpperCase();
  if (basis === "LAYFLAT_WIDTH") return "lay-flat width";
  if (basis === "FOLDED_WIDTH") return "folded width";
  if (basis === "OPEN_WEB_WIDTH") return "open-web width";
  const form = normalizeStockForm(stockForm);
  if (form === "LAYFLAT_TUBE") return "lay-flat width";
  if (form === "FOLDED_WEB") return "folded width";
  return "open-web width";
}

function widthBasisForStockForm(stockForm?: unknown) {
  const form = normalizeStockForm(stockForm);
  if (form === "LAYFLAT_TUBE") return "LAYFLAT_WIDTH";
  if (form === "FOLDED_WEB") return "FOLDED_WIDTH";
  return "OPEN_WEB_WIDTH";
}

function targetStockContractFromContext(context?: any) {
  const specs = Array.isArray(context?.target_roll_invariant_list)
    ? context.target_roll_invariant_list
    : [];
  const firstSpec =
    specs.find(
      (spec: any) => spec?.stock_form || spec?.width_basis || spec?.slit_policy,
    ) || {};
  const direct =
    context?.target_stock_contract || context?.target_roll_invariants || {};
  const stockForm = normalizeStockForm(
    firstSpec.stock_form || direct.stock_form,
  );
  return {
    stock_form: stockForm,
    width_basis: String(firstSpec.width_basis || direct.width_basis || "")
      .trim()
      .toUpperCase(),
    slit_policy: String(firstSpec.slit_policy || direct.slit_policy || "")
      .trim()
      .toUpperCase(),
  };
}

function toNumber(value: unknown, fallback = 0): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function toNullableNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function firstNonEmpty(...values: unknown[]) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (
      text &&
      text !== "-" &&
      text !== "—" &&
      text.toLowerCase() !== "null" &&
      text.toLowerCase() !== "undefined"
    )
      return text;
  }
  return "";
}

function kg(value: unknown, digits = 3) {
  return `${toNumber(value, 0).toFixed(digits)} kg`;
}

function kgInput(value: unknown, digits = 3) {
  const num = toNumber(value, NaN);
  return Number.isFinite(num) && num > 0 ? num.toFixed(digits) : "";
}

function netWeightInput(
  grossValue: unknown,
  tareValue: unknown,
): string | null {
  const gross = toNumber(grossValue, NaN);
  if (!Number.isFinite(gross) || gross <= 0) return null;
  const tare = Math.max(0, toNumber(tareValue, 0));
  const net = gross - tare;
  return net > 0 ? net.toFixed(3) : "";
}

function qtyLabel(value: unknown, uom = "KG", digits = 3) {
  const unit = String(uom || "KG").toUpperCase();
  if (unit === "KG") return kg(value, digits);
  return `${toNumber(value, 0).toFixed(unit === "PCS" ? 0 : digits)} ${unit.toLowerCase()}`;
}

function formatShortDateTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return formatDisplayDateTime(date);
}

function formatTime(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toDateTimeLocal(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function behaviorLabel(raw?: string | null) {
  const value = String(raw || "NONE").toUpperCase();
  if (value === "MULTI_INPUT_COMBINE") return "MULTI INPUT";
  if (value === "MODIFY_EXISTING") return "MODIFY";
  return value;
}

function behaviorVariant(
  behavior: string,
  inputForm: string,
  outputForm: string,
) {
  if (inputForm === "ROLL" && outputForm === "BULK") return "pouching";
  if (behavior === "CREATE_NEW") return "extrusion";
  if (behavior === "MODIFY_EXISTING") return "printing";
  if (behavior === "MULTI_INPUT_COMBINE") return "lamination";
  if (behavior === "SPLIT") return "slitting";
  if (outputForm === "ROLL") return "extrusion";
  return "standard";
}

function variantTitle(variant: string, stepName: string, behavior: string) {
  if (variant === "pouching") return `${stepName} · ROLL → BULK`;
  if (variant === "extrusion")
    return `${stepName} · ${behavior === "CREATE_NEW" ? "CREATE_NEW" : "ROLL OUTPUT"}`;
  if (variant === "printing") return `${stepName} · MODIFY_EXISTING`;
  if (variant === "lamination") return `${stepName} · MULTI_INPUT_COMBINE`;
  if (variant === "slitting") return `${stepName} · SPLIT`;
  return `${stepName} · ${behavior || "STANDARD"}`;
}

function outputCaptureModeLabel(mode?: string | null) {
  const value = String(mode || "PROCESS_DEFAULT").toUpperCase();
  if (value === "KG_ONLY") return "Bulk KG only";
  if (value === "KG_AND_PCS") return "Bulk KG + PCS";
  if (value === "DISCRETE_ONLY") return "Discrete required";
  return "Process default";
}

function qualityPreset(variant: string): QualityDraft[] {
  if (variant === "printing") {
    return [
      {
        code: "REGISTRATION",
        label: "Registration",
        value: "PASS",
        textMode: true,
        in_spec: true,
      },
      {
        code: "COLOR_MATCH_DE",
        label: "Color match ΔE",
        value: "1.8",
        spec_min: 0,
        spec_max: 3,
        in_spec: true,
      },
      {
        code: "DRYER_TEMP_C",
        label: "Dryer temp °C",
        value: "78",
        spec_min: 65,
        spec_max: 90,
        in_spec: true,
      },
    ];
  }
  if (variant === "lamination") {
    return [
      {
        code: "NIP_PRESSURE",
        label: "Nip pressure",
        value: "",
        spec_min: 0,
        spec_max: 0,
        in_spec: true,
      },
      {
        code: "OVEN_TEMP_C",
        label: "Oven temp °C",
        value: "",
        spec_min: 55,
        spec_max: 90,
        in_spec: true,
      },
      { code: "WEB_TENSION", label: "Web tension", value: "", in_spec: true },
      {
        code: "COAT_WEIGHT_GSM",
        label: "Coat weight GSM",
        value: "",
        in_spec: true,
      },
    ];
  }
  if (variant === "slitting") {
    return [
      {
        code: "KNIFE_WEAR",
        label: "Knife wear",
        value: "OK",
        textMode: true,
        in_spec: true,
      },
      {
        code: "EDGE_TRIM_MM",
        label: "Edge trim mm",
        value: "",
        spec_min: 0,
        spec_max: 20,
        in_spec: true,
      },
      { code: "WEB_TENSION", label: "Web tension", value: "", in_spec: true },
    ];
  }
  if (variant === "pouching") {
    return [
      {
        code: "SEAL_INTEGRITY",
        label: "Seal integrity",
        value: "PASS",
        textMode: true,
        in_spec: true,
      },
      {
        code: "PRINT_CLARITY",
        label: "Print clarity",
        value: "PASS",
        textMode: true,
        in_spec: true,
      },
      {
        code: "DIMENSIONAL",
        label: "Dimensional",
        value: "PASS",
        textMode: true,
        in_spec: true,
      },
      {
        code: "SEAL_TEMP_C",
        label: "Seal temp °C",
        value: "",
        spec_min: 120,
        spec_max: 170,
        in_spec: true,
      },
    ];
  }
  return [
    {
      code: "MELT_TEMP_C",
      label: "Melt temp °C",
      value: "",
      spec_min: 215,
      spec_max: 225,
      in_spec: true,
    },
    {
      code: "SCREW_RPM",
      label: "Screw RPM",
      value: "",
      spec_min: 70,
      spec_max: 90,
      in_spec: true,
    },
    {
      code: "DIE_PRESSURE_BAR",
      label: "Die pressure bar",
      value: "",
      spec_min: 130,
      spec_max: 160,
      in_spec: true,
    },
    {
      code: "LINE_SPEED_MPM",
      label: "Line speed m/min",
      value: "",
      spec_min: 20,
      spec_max: 25,
      in_spec: true,
    },
    {
      code: "GAUGE_VARIATION_MICRON",
      label: "Gauge variation μ",
      value: "",
      spec_min: -2,
      spec_max: 2,
      in_spec: true,
    },
  ];
}

function resolveCreateNewDefaultWidth(context?: any): number | null {
  const specs = Array.isArray(context?.target_roll_invariant_list)
    ? context.target_roll_invariant_list
    : [];
  for (const spec of [...specs].sort(
    (a: any, b: any) =>
      toNumber(a?.layer_index, 999) - toNumber(b?.layer_index, 999),
  )) {
    const width = toNullableNumber(spec?.min_width_mm);
    if (width && width > 0) return width;
  }
  const fallback = toNullableNumber(
    context?.target_roll_invariants?.min_width_mm,
  );
  return fallback && fallback > 0 ? fallback : null;
}

function stateBadgeClass(state?: string) {
  const normalized = String(state || "").toUpperCase();
  if (normalized === "EXECUTING")
    return "border-info-border bg-info-bg text-primary";
  if (normalized === "PAUSED")
    return "border-warning-border bg-warning-bg text-warning-fg";
  if (normalized === "RELEASED" || normalized === "READY")
    return "border-success-border bg-success-bg text-success-fg";
  if (normalized === "COMPLETED")
    return "border-line bg-surface-2 text-content-2";
  return "border-line bg-surface-1 text-content-2";
}

function terminalStateBadgeClass(state?: string) {
  const normalized = String(state || "").toUpperCase();
  if (normalized === "RUNNING")
    return "bg-success-fg text-success-border ring-success-border";
  if (normalized === "READY")
    return "bg-info-fg text-info-border ring-info-border";
  if (normalized === "PAUSED")
    return "bg-warning-fg text-warning-border ring-warning-border";
  if (normalized === "COMPLETE")
    return "bg-order-fg text-order-border ring-order-border";
  return "bg-surface-1/10 text-content-4 ring-surface-1/10";
}

function specChips(spec: any, selectedJob: any, context: any) {
  const layers = Array.isArray(spec.layers) ? spec.layers : [];
  const primaryLayer = layers[0] || {};
  const targetStock = targetStockContractFromContext(context);
  const grade = firstNonEmpty(
    primaryLayer.grade,
    primaryLayer.gradeName,
    selectedJob?.grade_name,
  );
  const thickness = firstNonEmpty(
    primaryLayer.thicknessMicron ? `${primaryLayer.thicknessMicron}μ` : "",
    selectedJob?.thickness_micron ? `${selectedJob.thickness_micron}μ` : "",
  );
  const variant = firstNonEmpty(
    spec.variantName,
    primaryLayer.variantName,
    primaryLayer.label,
    selectedJob?.variant_name,
  );
  const template = firstNonEmpty(
    context?.display?.template_name,
    selectedJob?.template_name,
  );
  return [
    {
      label: spec.fgType || selectedJob?.output_form || "FG",
      tone: "bg-danger-bg text-danger-fg border-danger-border",
    },
    {
      label: spec.size?.label || "Size not captured",
      tone: "bg-info-bg text-info-fg border-info-border",
    },
    thickness
      ? { label: thickness, tone: "bg-info-bg text-primary border-info-border" }
      : null,
    variant
      ? { label: variant, tone: "bg-info-bg text-primary border-info-border" }
      : null,
    grade
      ? {
          label: grade,
          tone: "bg-success-bg text-success-fg border-success-border",
        }
      : null,
    targetStock.stock_form
      ? {
          label: stockFormLabel(targetStock.stock_form),
          tone: "bg-info-bg text-info-fg border-info-border",
        }
      : null,
    spec.printingLabel
      ? {
          label: spec.printingLabel,
          tone: "bg-info-bg text-info-fg border-info-border",
        }
      : null,
    template
      ? { label: template, tone: "bg-info-bg text-primary border-info-border" }
      : null,
  ].filter(Boolean) as Array<{ label: string; tone: string }>;
}

function firstNumber(row: any, keys: string[], fallback = 0) {
  for (const key of keys) {
    const value = toNullableNumber(row?.[key]);
    if (value !== null) return value;
  }
  return fallback;
}

function buildMaterialReleaseRows(
  context: any,
  reconcilableBulkRows: any[],
  materialConfirmations: Record<string, MaterialConfirmationDraft>,
): MaterialReleaseRow[] {
  const savedConfirmations = new Map<string, any>();
  for (const row of Array.isArray(context?.current_step_material_confirmations)
    ? context.current_step_material_confirmations
    : []) {
    const requirementId = String(row?.requirement_id || "").trim();
    const materialId = String(row?.material_id || "").trim();
    if (requirementId) savedConfirmations.set(`req:${requirementId}`, row);
    if (materialId) savedConfirmations.set(`mat:${materialId}`, row);
  }

  return (Array.isArray(reconcilableBulkRows) ? reconcilableBulkRows : [])
    .map((row: any, index: number) => {
      const requirementId = String(
        row?.requirement_id || row?.id || `material-${index}`,
      ).trim();
      const materialId = row?.material_id ? String(row.material_id) : undefined;
      const draft = materialConfirmations[requirementId];
      const saved =
        savedConfirmations.get(`req:${requirementId}`) ||
        (materialId ? savedConfirmations.get(`mat:${materialId}`) : null) ||
        {};
      const plannedIssueQty = firstNumber(row, [
        "planned_issue_qty_kg",
        "planned_issue_qty",
        "estimated_actual_qty_kg",
        "estimated_actual_qty",
        "required_qty_kg",
        "required_qty",
      ]);
      const issuedQty = firstNumber(
        {
          ...row,
          ...saved,
          draft_actual_issued_qty: draft?.actual_issued_qty,
        },
        [
          "draft_actual_issued_qty",
          "actual_issued_qty_kg",
          "actual_issued_qty",
          "estimated_actual_qty_kg",
          "estimated_actual_qty",
          "planned_issue_qty_kg",
          "planned_issue_qty",
        ],
        plannedIssueQty,
      );
      const returnedQty = firstNumber(
        {
          ...row,
          ...saved,
          draft_actual_returned_qty: draft?.actual_returned_qty,
        },
        [
          "draft_actual_returned_qty",
          "actual_returned_qty_kg",
          "actual_returned_qty",
        ],
        0,
      );
      const scrapQty = firstNumber(
        {
          ...row,
          ...saved,
          draft_actual_scrap_qty: draft?.actual_scrap_qty,
        },
        ["draft_actual_scrap_qty", "actual_scrap_qty_kg", "actual_scrap_qty"],
        0,
      );
      const consumedQty = Math.max(
        0,
        firstNumber(
          row,
          ["actual_consumed_qty_kg", "actual_consumed_qty"],
          Math.max(0, issuedQty - returnedQty),
        ),
      );
      const granuleCodeOptions = Array.isArray(row?.granule_code_options)
        ? row.granule_code_options
            .map((option: any) => ({
              granule_code_id: String(
                option?.granule_code_id || option?.id || "",
              ),
              code: String(option?.code || option?.label || ""),
              available_qty_kg: toNumber(
                option?.available_qty_kg ?? option?.available_qty,
                0,
              ),
              location_name: option?.location_name || "",
              plant_name: option?.plant_name || "",
            }))
            .filter((option: any) => option.granule_code_id)
        : [];

      return {
        requirement_id: requirementId,
        material_id: materialId,
        code: String(row?.material_code || row?.code || ""),
        name: firstNonEmpty(
          row?.material_name,
          row?.name,
          row?.material_code,
          "Material",
        ),
        category: String(
          row?.category ||
            row?.category_display ||
            row?.material_category ||
            "",
        ).toUpperCase(),
        uom: String(row?.uom || row?.mode || "KG").toUpperCase(),
        requiredQty: firstNumber(row, [
          "required_qty_kg",
          "required_qty",
          "weight_kg",
        ]),
        theoreticalQty: firstNumber(row, [
          "theoretical_qty_kg",
          "theoretical_qty",
        ]),
        plannedIssueQty,
        issuedQty,
        returnedQty,
        scrapQty,
        consumedQty,
        varianceQty: firstNumber(
          row,
          ["variance_qty_kg", "variance_qty"],
          consumedQty -
            firstNumber(row, ["theoretical_qty_kg", "theoretical_qty"]),
        ),
        estimatedQty: firstNumber(
          row,
          ["estimated_actual_qty_kg", "estimated_actual_qty"],
          plannedIssueQty,
        ),
        availableQty: firstNumber(row, [
          "source_location_available_qty_kg",
          "source_location_available_qty",
          "available_qty_kg",
          "available_qty",
        ]),
        currentPlantAvailableQty: firstNumber(row, [
          "current_plant_available_qty_kg",
          "current_plant_available_qty",
          "plant_available_qty_kg",
          "plant_available_qty",
        ]),
        otherPlantsAvailableQty: firstNumber(row, [
          "other_plants_available_qty_kg",
          "other_plants_available_qty",
        ]),
        sourceLocationName: firstNonEmpty(
          row?.location_name,
          row?.source_location_name,
          "Source location",
        ),
        captureMode: String(
          row?.capture_mode || row?.strategy || "MANUAL",
        ).toUpperCase(),
        policyLabel: firstNonEmpty(
          row?.effective_issue_policy_mode,
          row?.template_issue_policy_mode,
          row?.policy_source,
          "Planned issue",
        ),
        granuleCodeOptions,
      };
    })
    .filter((row) => row.requirement_id && row.name);
}

export default function MachineExecutionPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { online, markSynced, secondsSinceSync } = useOnlineStatus();

  const machineIdParam = params?.machine_id;
  const machineId = Array.isArray(machineIdParam)
    ? machineIdParam[0]
    : String(machineIdParam || "");

  const [activeTab, setActiveTab] = useState<TerminalTab>("run");
  const [selectedJobId, setSelectedJobId] = useState("");
  const [queueSearch, setQueueSearch] = useState("");
  const [queueStatusFilter, setQueueStatusFilter] =
    useState<QueueFilter>("ALL");
  const [historyDateFrom, setHistoryDateFrom] = useState("");
  const [historyDateTo, setHistoryDateTo] = useState("");
  const [historyStatus, setHistoryStatus] = useState<
    "ALL" | "NORMAL" | "FORCED_VARIANCE"
  >("ALL");

  const [outputWeightKg, setOutputWeightKg] = useState("");
  const [outputPcs, setOutputPcs] = useState("");
  const [outputEntryMode, setOutputEntryMode] = useState<EntryMode>("KG");
  const [outputWidthMm, setOutputWidthMm] = useState("");
  const [outputLengthM, setOutputLengthM] = useState("");
  const [outputTareKg, setOutputTareKg] = useState("");
  const [outputGrossKg, setOutputGrossKg] = useState("");
  const [outputStockForm, setOutputStockForm] = useState("OPEN_WEB");
  const [outputWidthDirty, setOutputWidthDirty] = useState(false);
  const [outputWeightDirty, setOutputWeightDirty] = useState(false);
  const [rollSetupCount, setRollSetupCount] = useState("1");
  const [rollSetupTareKg, setRollSetupTareKg] = useState("");
  const [createRollRows, setCreateRollRows] = useState<CreateRollRow[]>([]);
  const [splitRows, setSplitRows] = useState<SplitRow[]>([
    {
      id: 1,
      width_mm: "",
      weight_kg: "",
      tare_weight_kg: "",
      gross_weight_kg: "",
    },
  ]);
  const [trimInput, setTrimInput] = useState("0");
  const [scrapInput, setScrapInput] = useState("0");
  const [scrapEntryMode, setScrapEntryMode] = useState<EntryMode>("KG");
  const [scrapReason, setScrapReason] = useState("TRIM");
  const [remainderLocationId, setRemainderLocationId] =
    useState(DEFAULT_REMAINDER);
  const [forceReason, setForceReason] = useState("");
  const [materialConfirmations, setMaterialConfirmations] = useState<
    Record<string, MaterialConfirmationDraft>
  >({});

  const [sublog, setSublog] = useState<SublogKind>(null);
  const [scrapDialogQty, setScrapDialogQty] = useState("0");
  const [scrapDialogReason, setScrapDialogReason] = useState("TRIM");
  const [scrapDialogReasonId, setScrapDialogReasonId] = useState<string | null>(
    null,
  );
  const [scrapDialogNotes, setScrapDialogNotes] = useState("");
  const [downtimeReason, setDowntimeReason] = useState("MATERIAL");
  const [downtimeReasonId, setDowntimeReasonId] = useState<string | null>(null);
  const [downtimeStart, setDowntimeStart] = useState(toDateTimeLocal());
  const [downtimeEnd, setDowntimeEnd] = useState("");
  const [downtimeAutoStop, setDowntimeAutoStop] = useState(true);
  const [downtimeNotes, setDowntimeNotes] = useState("");
  const [consumptionMaterialId, setConsumptionMaterialId] = useState("");
  const [consumptionGranuleCodeId, setConsumptionGranuleCodeId] =
    useState(SELECT_NONE);
  const [consumptionRollId, setConsumptionRollId] = useState(SELECT_NONE);
  const [consumptionQty, setConsumptionQty] = useState("");
  const [consumptionEstimated, setConsumptionEstimated] = useState(false);
  const [qualityRows, setQualityRows] = useState<QualityDraft[]>(
    qualityPreset("extrusion"),
  );

  const splitCounterRef = useRef(2);
  const createCounterRef = useRef(1);
  const initializedJobIdRef = useRef<string | null>(null);

  const {
    data: machineDetail,
    isLoading: machineLoading,
    error: machineError,
  } = useQuery({
    queryKey: ["machine-detail", machineId],
    queryFn: () => machineService.getMachineDetail(machineId),
    enabled: Boolean(machineId),
    refetchInterval: POLL_MS,
  });

  const {
    data: queueData = [],
    isLoading: queueLoading,
    error: queueError,
  } = useQuery({
    queryKey: ["machine-queue", machineId],
    queryFn: () => machineService.getQueue(machineId),
    enabled: Boolean(machineId),
    refetchInterval: POLL_MS,
  });

  const queueItems = useMemo(
    () => (Array.isArray(queueData) ? queueData : []),
    [queueData],
  );
  const visibleQueueItems = useMemo(() => {
    return queueItems.filter((job: any) => {
      const state = String(job?.job_state || "").toUpperCase();
      if (queueStatusFilter === "RUNNING" && state !== "EXECUTING")
        return false;
      if (
        queueStatusFilter === "READY" &&
        !["RELEASED", "READY", "QUEUED", "PLANNED", "WAITING"].includes(state)
      )
        return false;
      if (queueStatusFilter === "PAUSED" && state !== "PAUSED") return false;
      const search = queueSearch.trim().toLowerCase();
      if (!search) return true;
      const spec = normalizeProductSpec(job);
      return [
        spec.searchText,
        job?.job_number,
        job?.process_code,
        job?.template_name,
      ]
        .join(" ")
        .toLowerCase()
        .includes(search);
    });
  }, [queueItems, queueSearch, queueStatusFilter]);

  const selectedJob = useMemo(() => {
    if (!queueItems.length) return null;
    const explicit = queueItems.find(
      (job: any) => String(job.id) === String(selectedJobId),
    );
    if (explicit) return explicit;
    return (
      queueItems.find(
        (job: any) => String(job.job_state).toUpperCase() === "EXECUTING",
      ) || queueItems[0]
    );
  }, [queueItems, selectedJobId]);

  const selectedId = String(selectedJob?.id || "");

  const {
    data: context,
    isLoading: contextLoading,
    isSuccess: contextSuccess,
    dataUpdatedAt: contextUpdatedAt,
  } = useQuery({
    queryKey: ["machine-job-context", machineId, selectedId],
    queryFn: () => machineService.getJobContext(machineId, selectedId),
    enabled: Boolean(machineId && selectedId),
    refetchInterval: POLL_MS,
  });

  // Record a healthy sync whenever the job-context refetch lands so the
  // connection-lost banner clears (React Query v5 has no useQuery onSuccess).
  useEffect(() => {
    if (contextSuccess && contextUpdatedAt) markSynced();
  }, [contextSuccess, contextUpdatedAt, markSynced]);

  const { data: events = [], isLoading: eventsLoading } = useQuery({
    queryKey: ["machine-job-events", machineId, selectedId],
    queryFn: () => machineService.getJobEvents(machineId, selectedId, 20),
    enabled: Boolean(machineId && selectedId),
    refetchInterval: activeTab === "run" ? EVENTS_POLL_MS : false,
  });

  const { data: historyData, isLoading: historyLoading } = useQuery({
    queryKey: [
      "machine-history",
      machineId,
      historyDateFrom,
      historyDateTo,
      historyStatus,
    ],
    queryFn: () =>
      machineService.getMachineHistory(machineId, {
        date_from: historyDateFrom || undefined,
        date_to: historyDateTo || undefined,
        status: historyStatus,
      }),
    enabled: Boolean(machineId) && activeTab === "history",
  });

  const plantId = String(machineDetail?.machine?.plant_id || "");
  const { data: plantLocations = [] } = useQuery({
    queryKey: ["machine-plant-locations", plantId],
    queryFn: () => inventoryService.getLocations(plantId),
    enabled: Boolean(plantId),
    staleTime: 30_000,
  });

  const { data: materialLibrary = [] } = useQuery({
    queryKey: ["machine-material-library"],
    queryFn: async () => {
      const data = await masterDataService.getLibrary({});
      return Array.isArray(data) ? data : (data as any)?.results || [];
    },
    staleTime: 60_000,
  });

  const { data: granuleCodes = [] } = useQuery({
    queryKey: ["machine-granule-codes"],
    queryFn: () => masterDataService.getGranuleCodes({ status: "ACTIVE" }),
    staleTime: 60_000,
  });

  const { data: scrapReasons = [] } = useQuery<ReasonCode[]>({
    queryKey: ["machine-scrap-reasons"],
    queryFn: () => reasonCodesService.scrap.list(),
    staleTime: 5 * 60_000,
  });

  const { data: downtimeReasons = [] } = useQuery<ReasonCode[]>({
    queryKey: ["machine-downtime-reasons"],
    queryFn: () => reasonCodesService.downtime.list(),
    staleTime: 5 * 60_000,
  });

  const scrapReasonGroups = useMemo(
    () => groupReasonCodes(Array.isArray(scrapReasons) ? scrapReasons : []),
    [scrapReasons],
  );
  const downtimeReasonGroups = useMemo(
    () =>
      groupReasonCodes(Array.isArray(downtimeReasons) ? downtimeReasons : []),
    [downtimeReasons],
  );

  useEffect(() => {
    if (!queueItems.length) {
      setSelectedJobId("");
      return;
    }
    if (
      !selectedJobId ||
      !queueItems.some((job: any) => String(job.id) === String(selectedJobId))
    ) {
      const executing = queueItems.find(
        (job: any) => String(job.job_state).toUpperCase() === "EXECUTING",
      );
      setSelectedJobId(String((executing || queueItems[0]).id));
    }
  }, [queueItems, selectedJobId]);

  const behavior = String(
    context?.roll_handling?.behavior ||
      context?.display?.roll_behavior ||
      context?.job?.roll_behavior ||
      selectedJob?.roll_behavior ||
      "NONE",
  ).toUpperCase();
  const currentInputForm = String(
    context?.current_step?.input_form ||
      context?.job?.input_form ||
      selectedJob?.input_form ||
      "BULK",
  ).toUpperCase();
  const currentOutputFormRaw = firstNonEmpty(
    context?.current_step?.output_form,
    context?.job?.output_form,
    selectedJob?.output_form,
    (context?.roll_handling as any)?.output_form,
    (context?.step_policy as any)?.output_form,
  );
  const hasTargetRollContract =
    (Array.isArray(context?.target_roll_invariant_list) &&
      context.target_roll_invariant_list.length > 0) ||
    Boolean(
      (context as any)?.target_stock_contract ||
        (context as any)?.target_roll_invariants,
    );
  const rollBehaviorImpliesRollOutput = [
    "CREATE_NEW",
    "MULTI_INPUT_COMBINE",
    "SPLIT",
    "MODIFY_EXISTING",
  ].includes(behavior);
  const currentOutputForm = String(
    currentOutputFormRaw ||
      (rollBehaviorImpliesRollOutput || hasTargetRollContract
        ? "ROLL"
        : "BULK"),
  ).toUpperCase();
  const variant = behaviorVariant(
    behavior,
    currentInputForm,
    currentOutputForm,
  );
  const supportsDiscreteOutputRolls =
    currentOutputForm === "ROLL" &&
    behavior !== "SPLIT" &&
    behavior !== "MODIFY_EXISTING";
  const outputCapturePolicy =
    context?.step_policy?.output_capture_policy ||
    context?.roll_handling?.output_capture_policy ||
    {};
  const outputCaptureMode = String(
    outputCapturePolicy?.effective_mode ||
      context?.roll_handling?.operator_entry_mode ||
      "PROCESS_DEFAULT",
  ).toUpperCase();
  const isRollToBulkOutput =
    currentInputForm === "ROLL" && currentOutputForm === "BULK";
  const showPcsEntry = isRollToBulkOutput && outputCaptureMode !== "KG_ONLY";
  const stepName = firstNonEmpty(
    context?.display?.step_name,
    context?.current_step?.process_name,
    selectedJob?.process_code,
    "Current step",
  );
  const stepTransform = `${currentInputForm.toLowerCase()} → ${currentOutputForm.toLowerCase()}`;
  const spec = normalizeProductSpec(selectedJob, context);
  const targetStockContract = useMemo(
    () => targetStockContractFromContext(context),
    [context],
  );
  const targetStockForm = targetStockContract.stock_form || "OPEN_WEB";
  const chips = specChips(spec, selectedJob, context);

  // Full process route derived from the existing job-context payload (no backend changes):
  // - sequence/name pairs come from all_other_requirements[] (covers upstream + current steps)
  // - merged with the live current_step + current_step_index for state.
  // Sequences are 1-based; current_step_index is 0-based.
  const currentStepAny = context?.current_step as any;
  const currentJobAny = context?.job as any;
  const selectedJobAny = selectedJob as any;
  const currentStepSequence = Math.max(
    1,
    toNumber(
      currentStepAny?.sequence,
      toNumber(
        currentJobAny?.current_step_index ?? selectedJobAny?.current_step_index,
        0,
      ) + 1,
    ),
  );
  const routeSteps = useMemo(() => {
    const bySeq = new Map<number, { sequence: number; name: string }>();
    const otherReqs = Array.isArray(context?.all_other_requirements)
      ? context.all_other_requirements
      : [];
    for (const row of otherReqs) {
      const seq = toNullableNumber(row?.step_sequence);
      const name = firstNonEmpty(row?.step_name);
      if (seq && seq > 0 && name && !bySeq.has(seq))
        bySeq.set(seq, { sequence: seq, name });
    }
    // Always ensure the current step is present with its live process name.
    const currentName = firstNonEmpty(
      context?.current_step?.process_name,
      context?.display?.step_name,
      stepName,
      "Current step",
    );
    bySeq.set(currentStepSequence, {
      sequence: currentStepSequence,
      name: currentName,
    });
    const ordered = Array.from(bySeq.values()).sort(
      (a, b) => a.sequence - b.sequence,
    );
    return ordered.map((step) => ({
      sequence: step.sequence,
      name: step.name,
      state:
        step.sequence < currentStepSequence
          ? "done"
          : step.sequence === currentStepSequence
            ? "current"
            : "pending",
      transform: step.sequence === currentStepSequence ? stepTransform : "",
      isCurrent: step.sequence === currentStepSequence,
    }));
  }, [context, currentStepSequence, stepName, stepTransform]);

  const stepExecution: any = context?.step_execution || {};
  const progressWeight: any =
    context?.progress?.weight_kg ||
    context?.execution_profile?.progress?.weight_kg ||
    {};
  const primaryTarget = toNullableNumber(
    progressWeight?.target ??
      stepExecution?.total_target_kg ??
      selectedJob?.quantity,
  );
  const primaryProduced = toNullableNumber(
    progressWeight?.produced ??
      stepExecution?.produced_kg ??
      selectedJob?.produced_qty,
  );
  const primaryRemaining = toNullableNumber(
    progressWeight?.remaining ??
      stepExecution?.remaining_kg ??
      selectedJob?.remaining_qty,
  );
  const targetKg = primaryTarget ?? 0;
  const producedKg = primaryProduced ?? 0;
  const remainingKg = Math.max(
    0,
    primaryRemaining ?? Math.max(0, targetKg - producedKg),
  );
  const progressPct =
    targetKg > 0
      ? Math.min(100, Math.max(0, (producedKg / targetKg) * 100))
      : 0;
  const unitWeightG = toNumber(
    context?.execution_profile?.unit_weight_g ??
      context?.job?.unit_weight_g ??
      selectedJob?.unit_weight_g,
    0,
  );
  const stepToleranceKg = Math.max(
    0,
    toNumber(stepExecution?.tolerance_kg, 0.25),
  );
  const primaryUom = String(
    stepExecution?.primary_uom ||
      context?.execution_profile?.primary_unit ||
      "KG",
  ).toUpperCase();
  const remainingPrimary = Math.max(
    0,
    toNumber(
      stepExecution?.remaining_primary ??
        context?.execution_profile?.step_remaining_primary ??
        remainingKg,
      remainingKg,
    ),
  );
  const stepTolerancePrimary = Math.max(
    0,
    toNumber(
      stepExecution?.tolerance_primary ??
        context?.execution_profile?.tolerance_primary ??
        stepToleranceKg,
      stepToleranceKg,
    ),
  );

  const reservedRolls = useMemo(
    () =>
      (context?.inputs?.reserved_rolls || context?.allocated_rolls || []).map(
        (row: any) => ({
          id: String(row.id),
          label_id: row.label_id || row.id,
          material_id: row.material_id || row.variant_id,
          material_name:
            row.material_name || row.variant || row.variant_name || "Material",
          weight_kg: toNumber(row.weight_kg, 0),
          width_mm: toNullableNumber(row.width_mm),
          thickness_micron: toNullableNumber(
            row.thickness_micron ?? row.thickness,
          ),
          stock_form: normalizeStockForm(row.stock_form),
          width_basis: row.width_basis || "",
          grade: row.grade || row.grade_name || "-",
          location_name: row.location_name || "-",
          target_lane_label: row.target_lane_label || null,
          target_layer_index: row.target_layer_index ?? null,
          target_variant_name: row.target_variant_name || null,
          target_grade_name: row.target_grade_name || null,
          target_thickness_micron: toNullableNumber(
            row.target_thickness_micron,
          ),
          target_width_mm: toNullableNumber(row.target_width_mm),
        }),
      ),
    [context],
  );
  const wipPool = (context?.wip_pool || context?.wip_recent_lineage || []).map(
    (row: any) => ({
      id: String(row.id),
      label_id: row.label_id,
      material_name: row.material_name || "Material",
      weight_kg: toNumber(row.weight_kg, 0),
      width_mm: toNullableNumber(row.width_mm),
      thickness_micron: toNullableNumber(row.thickness_micron),
      stock_form: normalizeStockForm(row.stock_form),
      width_basis: row.width_basis || "",
      grade: row.grade || "-",
      location_name: row.location_name || "-",
      stage: row.stage || "-",
    }),
  );
  const rightRailRolls = reservedRolls.length
    ? reservedRolls
    : wipPool.slice(0, 5);
  const reconcilableBulkRows = useMemo(
    () =>
      (
        context?.inputs?.bulk_preview_theoretical ||
        context?.inputs?.bulk_preview ||
        context?.satisfaction?.bulk_consumption ||
        []
      ).filter((row: any) => {
        const mode = String(
          row?.capture_mode || row?.strategy || "",
        ).toUpperCase();
        return mode !== "AUTO_FROM_OUTPUT";
      }),
    [context],
  );
  const wipPoolMeta: any = context?.wip_pool_meta || {};
  const allocationRequired = Boolean(context?.step_policy?.allocation_required);
  const laneGroupMode = Boolean(wipPoolMeta?.lane_group_mode);
  const requiredLaneCount = Math.max(
    0,
    toNumber(wipPoolMeta?.input_lane_count, 0),
  );
  const reservedLaneCount = new Set(
    reservedRolls
      .map((row: any) =>
        String(row.target_lane_label || row.target_layer_index || "").trim(),
      )
      .filter(Boolean),
  ).size;
  const allocationReady =
    !allocationRequired ||
    (laneGroupMode
      ? requiredLaneCount <= 0
        ? reservedRolls.length > 0
        : reservedLaneCount >= requiredLaneCount
      : reservedRolls.length >= 1);
  const reservedInputTotalKg = reservedRolls.reduce(
    (sum: number, row: any) => sum + toNumber(row.weight_kg, 0),
    0,
  );
  const inventoryCounters: any = context?.telemetry?.inventory_counters || {};
  const consumedInputTotalKg = Math.max(
    0,
    toNumber(
      inventoryCounters?.bulk_consumed_kg ??
        context?.telemetry?.bulk_consumed_kg,
      0,
    ) +
      toNumber(
        inventoryCounters?.rolls_consumed_kg ??
          context?.telemetry?.rolls_consumed_kg,
        0,
      ),
  );
  const heldInputTotalKg = Math.max(
    0,
    reservedInputTotalKg - consumedInputTotalKg,
  );
  const contextMaxOutputKg = toNullableNumber(
    stepExecution?.max_output_kg ?? context?.execution_profile?.max_output_kg,
  );
  const maxOutputWithoutScrapKg =
    currentInputForm === "ROLL"
      ? Math.max(
          0,
          Math.min(
            contextMaxOutputKg ?? remainingKg,
            reservedInputTotalKg || (contextMaxOutputKg ?? remainingKg),
          ),
        )
      : Math.max(0, contextMaxOutputKg ?? remainingKg);
  const trimKgValue = useMemo(() => {
    const raw = toNumber(trimInput, 0);
    if (scrapEntryMode === "PCS") {
      return unitWeightG > 0 ? (Math.max(0, raw) * unitWeightG) / 1000 : 0;
    }
    return Math.max(0, raw);
  }, [scrapEntryMode, trimInput, unitWeightG]);
  const processScrapKgValue = useMemo(() => {
    const raw = toNumber(scrapInput, 0);
    if (scrapEntryMode === "PCS") {
      return unitWeightG > 0 ? (Math.max(0, raw) * unitWeightG) / 1000 : 0;
    }
    return Math.max(0, raw);
  }, [scrapInput, scrapEntryMode, unitWeightG]);
  const wasteKgValue = trimKgValue + processScrapKgValue;
  const maxOutputWithScrapKg =
    currentInputForm === "ROLL"
      ? Math.max(
          0,
          Math.min(
            maxOutputWithoutScrapKg,
            Math.max(0, reservedInputTotalKg - wasteKgValue),
          ),
        )
      : maxOutputWithoutScrapKg;

  const splitRowsParsed = useMemo(
    () =>
      splitRows
        .map((row) => ({
          id: row.id,
          width_mm: toNumber(row.width_mm, 0),
          weight_kg: toNumber(row.weight_kg, 0),
          tare_weight_kg: toNullableNumber(row.tare_weight_kg),
          gross_weight_kg: toNullableNumber(row.gross_weight_kg),
        }))
        .filter((row) => row.width_mm > 0 && row.weight_kg > 0),
    [splitRows],
  );
  const splitTotalKg = splitRowsParsed.reduce(
    (sum, row) => sum + row.weight_kg,
    0,
  );
  const createRollRowsParsed = useMemo(() => {
    const rows: Array<{
      id: number;
      width_mm: number;
      weight_kg: number;
      length_m?: number | null;
      tare_weight_kg?: number | null;
      gross_weight_kg?: number | null;
    }> = [];
    const baseWidth = toNumber(outputWidthMm, 0);
    const baseWeight = toNumber(outputWeightKg, 0);
    if (baseWidth > 0 && baseWeight > 0) {
      rows.push({
        id: 0,
        width_mm: baseWidth,
        weight_kg: baseWeight,
        length_m: toNullableNumber(outputLengthM),
        tare_weight_kg: toNullableNumber(outputTareKg),
        gross_weight_kg: toNullableNumber(outputGrossKg),
      });
    }
    for (const row of createRollRows) {
      const width = toNumber(row.width_mm, 0);
      const weight = toNumber(row.weight_kg, 0);
      if (width > 0 && weight > 0) {
        rows.push({
          id: row.id,
          width_mm: width,
          weight_kg: weight,
          length_m: toNullableNumber(row.length_m),
          tare_weight_kg: toNullableNumber(row.tare_weight_kg),
          gross_weight_kg: toNullableNumber(row.gross_weight_kg),
        });
      }
    }
    return rows;
  }, [
    createRollRows,
    outputGrossKg,
    outputLengthM,
    outputTareKg,
    outputWeightKg,
    outputWidthMm,
  ]);
  const createRollTotalKg = createRollRowsParsed.reduce(
    (sum, row) => sum + row.weight_kg,
    0,
  );
  const previewOutputKg = useMemo(() => {
    if (behavior === "SPLIT") return splitTotalKg;
    if (supportsDiscreteOutputRolls) return createRollTotalKg;
    if (showPcsEntry && outputEntryMode === "PCS") {
      const pcs = toNumber(outputPcs, NaN);
      if (Number.isFinite(pcs) && pcs > 0 && unitWeightG > 0)
        return (Math.round(pcs) * unitWeightG) / 1000;
    }
    const kgValue = toNumber(outputWeightKg, NaN);
    if (Number.isFinite(kgValue) && kgValue > 0) return kgValue;
    if (showPcsEntry && unitWeightG > 0) {
      const pcs = toNumber(outputPcs, NaN);
      if (Number.isFinite(pcs) && pcs > 0)
        return (Math.round(pcs) * unitWeightG) / 1000;
    }
    return 0;
  }, [
    behavior,
    splitTotalKg,
    supportsDiscreteOutputRolls,
    createRollTotalKg,
    showPcsEntry,
    outputEntryMode,
    outputPcs,
    unitWeightG,
    outputWeightKg,
  ]);
  const previewOutputPcs =
    showPcsEntry && unitWeightG > 0 && previewOutputKg > 0
      ? Math.max(1, Math.round((previewOutputKg * 1000) / unitWeightG))
      : toNullableNumber(outputPcs);
  const exceedsOutputCap = previewOutputKg > maxOutputWithScrapKg + 0.001;
  const hasLoggableOutput =
    behavior === "SPLIT"
      ? splitTotalKg > 0
      : supportsDiscreteOutputRolls
        ? createRollTotalKg > 0
        : previewOutputKg > 0;

  const jobState = String(
    selectedJob?.job_state || context?.job?.job_state || "",
  ).toUpperCase();
  const isExecuting = jobState === "EXECUTING";
  const isPaused = jobState === "PAUSED";
  const canStart = Boolean(
    selectedJob &&
      !isExecuting &&
      !["COMPLETED", "CANCELLED"].includes(jobState) &&
      allocationReady,
  );
  const canStop = Boolean(selectedJob && isExecuting);
  const canLogOutput = Boolean(
    selectedJob &&
      isExecuting &&
      allocationReady &&
      hasLoggableOutput &&
      !exceedsOutputCap,
  );
  const needsForceComplete = remainingPrimary > stepTolerancePrimary;
  const forceReasonValid =
    !needsForceComplete || forceReason.trim().length >= 5;
  const canComplete = Boolean(
    selectedJob &&
      ["EXECUTING", "PAUSED"].includes(jobState) &&
      forceReasonValid,
  );
  const operatorNextStep = !selectedJob
    ? "No released jobs are waiting here."
    : !allocationReady
      ? "Reserve the required input roll before starting."
      : canStart
        ? "Start / resume this step when setup is ready."
        : canLogOutput
          ? "Log output for the current step."
          : isPaused
            ? "Step is paused. Resume before logging output."
            : canComplete
              ? "Complete step when production and material actuals are ready."
              : "Idle machine.";

  const materialRowsFromContext = useMemo(() => {
    const rows = reconcilableBulkRows
      .map((row: any) => ({
        id: String(row.material_id || ""),
        code: String(row.material_code || row.code || ""),
        name: String(row.material_name || row.name || ""),
        category: String(row.category || row.material_category || ""),
      }))
      .filter((row: any) => row.id && row.name);
    return rows;
  }, [reconcilableBulkRows]);
  const materialOptions = useMemo(() => {
    const byId = new Map<string, any>();
    for (const row of materialRowsFromContext) byId.set(row.id, row);
    const library = Array.isArray(materialLibrary) ? materialLibrary : [];
    for (const material of library as Material[]) {
      if (!material?.id) continue;
      byId.set(material.id, {
        id: material.id,
        code: material.code,
        name: material.name,
        category: material.category,
      });
    }
    return Array.from(byId.values()).sort((a, b) =>
      String(a.name).localeCompare(String(b.name)),
    );
  }, [materialRowsFromContext, materialLibrary]);
  const materialReleaseRows = useMemo(
    () =>
      buildMaterialReleaseRows(
        context,
        reconcilableBulkRows,
        materialConfirmations,
      ),
    [context, reconcilableBulkRows, materialConfirmations],
  );
  const inkTargetOptions = useMemo(() => {
    const byId = new Map<
      string,
      { id: string; name: string; code?: string; category?: string }
    >();
    for (const row of materialReleaseRows) {
      if (row.material_id && row.category === "INK") {
        byId.set(row.material_id, {
          id: row.material_id,
          name: row.name,
          code: row.code,
          category: row.category,
        });
      }
    }
    for (const material of materialOptions) {
      const category = String(material?.category || "").toUpperCase();
      if (material?.id && category === "INK") {
        byId.set(String(material.id), {
          id: String(material.id),
          name: material.name,
          code: material.code,
          category,
        });
      }
    }
    return Array.from(byId.values()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
  }, [materialOptions, materialReleaseRows]);
  const selectedMaterial = materialOptions.find(
    (material: any) => String(material.id) === String(consumptionMaterialId),
  );
  const filteredGranuleCodes = useMemo(
    () =>
      (Array.isArray(granuleCodes) ? granuleCodes : []).filter(
        (code: GranuleQualityCode) => {
          if (!consumptionMaterialId) return true;
          return String(code.granule) === String(consumptionMaterialId);
        },
      ),
    [granuleCodes, consumptionMaterialId],
  );
  const remainderLocations = useMemo(
    () =>
      (plantLocations || []).filter(
        (loc: any) => loc?.is_active && loc?.type !== "IN_TRANSIT",
      ),
    [plantLocations],
  );

  useEffect(() => {
    const nextJobId = selectedJob?.id ? String(selectedJob.id) : null;
    if (!nextJobId || initializedJobIdRef.current === nextJobId) return;
    initializedJobIdRef.current = nextJobId;
    const initialKg = Math.max(0, maxOutputWithoutScrapKg || remainingKg || 0);
    setOutputWeightKg(
      !supportsDiscreteOutputRolls && initialKg > 0
        ? initialKg.toFixed(3)
        : "",
    );
    setOutputPcs(
      unitWeightG > 0 && showPcsEntry && initialKg > 0
        ? String(Math.max(1, Math.round((initialKg * 1000) / unitWeightG)))
        : "",
    );
    setOutputEntryMode(showPcsEntry ? "PCS" : "KG");
    setOutputWidthMm("");
    setOutputLengthM("");
    setOutputTareKg("");
    setOutputGrossKg("");
    setRollSetupCount("1");
    setRollSetupTareKg("");
    setOutputStockForm(targetStockForm);
    setOutputWidthDirty(false);
    setOutputWeightDirty(false);
    setCreateRollRows([]);
    createCounterRef.current = 1;
    setSplitRows([
      {
        id: 1,
        width_mm: "",
        weight_kg: "",
        tare_weight_kg: "",
        gross_weight_kg: "",
      },
    ]);
    splitCounterRef.current = 2;
    setTrimInput("0");
    setScrapInput("0");
    setScrapEntryMode("KG");
    setScrapReason(
      behavior === "CREATE_NEW"
        ? "SETUP"
        : behavior === "SPLIT"
          ? "TRIM"
          : "DEFECT",
    );
    setRemainderLocationId(DEFAULT_REMAINDER);
    setForceReason("");
    setConsumptionMaterialId(materialRowsFromContext[0]?.id || "");
    setConsumptionQty("");
    setQualityRows(qualityPreset(variant));
  }, [
    selectedJob?.id,
    behavior,
    maxOutputWithoutScrapKg,
    remainingKg,
    showPcsEntry,
    supportsDiscreteOutputRolls,
    targetStockForm,
    unitWeightG,
    variant,
    materialRowsFromContext,
  ]);

  useEffect(() => {
    if (behavior !== "CREATE_NEW" || outputWidthDirty || outputWidthMm) return;
    const defaultWidth = resolveCreateNewDefaultWidth(context);
    if (defaultWidth && defaultWidth > 0)
      setOutputWidthMm(String(Math.round(defaultWidth)));
  }, [behavior, context, outputWidthDirty, outputWidthMm]);

  useEffect(() => {
    if (
      !showPcsEntry ||
      outputEntryMode !== "PCS" ||
      unitWeightG <= 0 ||
      outputWeightDirty
    )
      return;
    const pcs = toNumber(outputPcs, NaN);
    if (Number.isFinite(pcs) && pcs > 0)
      setOutputWeightKg(((Math.round(pcs) * unitWeightG) / 1000).toFixed(3));
  }, [
    outputEntryMode,
    outputPcs,
    outputWeightDirty,
    showPcsEntry,
    unitWeightG,
  ]);

  useEffect(() => {
    setMaterialConfirmations((prev) => {
      const next: Record<string, MaterialConfirmationDraft> = { ...prev };
      const active = new Set<string>();
      let changed = false;
      for (const row of reconcilableBulkRows) {
        const requirementId = String(row?.requirement_id || "").trim();
        if (!requirementId) continue;
        active.add(requirementId);
        if (!next[requirementId]) {
          const issued = toNumber(
            row?.actual_issued_qty ??
              row?.actual_issued_qty_kg ??
              row?.estimated_actual_qty ??
              row?.estimated_actual_qty_kg ??
              row?.actual_consumed_qty ??
              row?.actual_consumed_qty_kg ??
              row?.required_qty ??
              row?.required_qty_kg,
            0,
          );
          next[requirementId] = {
            requirement_id: requirementId,
            material_id: row?.material_id ? String(row.material_id) : undefined,
            actual_issued_qty: issued > 0 ? issued.toFixed(3) : "",
            actual_returned_qty: toNumber(
              row?.actual_returned_qty ?? row?.actual_returned_qty_kg,
              0,
            ).toFixed(3),
            actual_scrap_qty: toNumber(
              row?.actual_scrap_qty ?? row?.actual_scrap_qty_kg,
              0,
            ).toFixed(3),
            is_estimated: true,
            return_mode: "EXACT_COLOR_RETURN",
            granule_code_allocations: [],
          };
          changed = true;
        }
      }
      for (const key of Object.keys(next)) {
        if (!active.has(key)) {
          delete next[key];
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [reconcilableBulkRows]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
        return;
      if (event.key === "Escape") setSublog(null);
      if (event.key.toLowerCase() === "s") setSublog("scrap");
      if (event.key.toLowerCase() === "d") setSublog("downtime");
      if (event.key.toLowerCase() === "c") setSublog("consumption");
      if (event.key.toLowerCase() === "q") setSublog("quality");
      if (event.key.toLowerCase() === "o")
        document
          .getElementById("machine-output-panel")
          ?.scrollIntoView({ block: "center" });
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const refreshAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["machine-detail", machineId],
      }),
      queryClient.invalidateQueries({ queryKey: ["machine-queue", machineId] }),
      queryClient.invalidateQueries({
        queryKey: ["machine-job-context", machineId, selectedId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["machine-job-events", machineId, selectedId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["machine-history", machineId],
      }),
    ]);
  };

  const startMutation = useMutation({
    mutationFn: async () => {
      if (!selectedJob) throw new Error("Select a job first.");
      return machineService.startJob(machineId, String(selectedJob.id));
    },
    onSuccess: async () => {
      toast({
        title: isPaused ? "Job resumed" : "Job started",
        description: "Machine execution is live.",
      });
      await refreshAll();
    },
    onError: (err: any) =>
      toast({
        variant: "destructive",
        title: "Start failed",
        description:
          err?.response?.data?.error?.message ||
          err?.message ||
          "Unable to start job.",
      }),
  });

  const stopMutation = useMutation({
    mutationFn: async () => {
      if (!selectedJob) throw new Error("Select a job first.");
      return machineService.stopJob(
        machineId,
        String(selectedJob.id),
        "Operator pause",
      );
    },
    onSuccess: async () => {
      toast({
        title: "Job paused",
        description: "Output logging is locked until resume.",
      });
      await refreshAll();
    },
    onError: (err: any) =>
      toast({
        variant: "destructive",
        title: "Pause failed",
        description:
          err?.response?.data?.error?.message ||
          err?.message ||
          "Unable to pause job.",
      }),
  });

  const logOutputMutation = useMutation({
    mutationFn: async () => {
      if (!selectedJob) throw new Error("Select a job first.");
      const payload: {
        actual_qty: number;
        output_width_mm?: number;
        output_length_m?: number;
        output_pcs?: number;
        output_stock_form?: string;
        stock_form?: string;
        scrap_qty?: number;
        trim_qty?: number;
        process_scrap_qty?: number;
        roll_outputs?: Array<{
          width_mm: number;
          weight_kg: number;
          length_m?: number;
          tare_weight_kg?: number;
          gross_weight_kg?: number;
          stock_form?: string;
          width_basis?: string;
        }>;
        split_outputs?: Array<{
          width_mm: number;
          weight_kg: number;
          tare_weight_kg?: number;
          gross_weight_kg?: number;
          stock_form?: string;
          width_basis?: string;
        }>;
        remainder_location_id?: string;
      } = {
        actual_qty: 0,
        scrap_qty: wasteKgValue,
        trim_qty: trimKgValue,
        process_scrap_qty: processScrapKgValue,
      };
      const selectedOutputStockForm = normalizeStockForm(
        outputStockForm || targetStockForm,
      );
      const selectedWidthBasis = String(
        targetStockContract.width_basis ||
          widthBasisForStockForm(selectedOutputStockForm),
      ).toUpperCase();

      if (remainderLocationId && remainderLocationId !== DEFAULT_REMAINDER)
        payload.remainder_location_id = remainderLocationId;

      if (behavior === "SPLIT") {
        if (!splitRowsParsed.length)
          throw new Error("Add at least one split output row.");
        if (splitTotalKg > maxOutputWithScrapKg + 0.001)
          throw new Error(
            `Split output exceeds physical cap ${kg(maxOutputWithScrapKg)}.`,
          );
        payload.split_outputs = splitRowsParsed.map((row) => ({
          width_mm: row.width_mm,
          weight_kg: row.weight_kg,
          ...(toNumber(row.tare_weight_kg, 0) > 0
            ? { tare_weight_kg: toNumber(row.tare_weight_kg, 0) }
            : {}),
          ...(toNumber(row.gross_weight_kg, 0) > 0
            ? { gross_weight_kg: toNumber(row.gross_weight_kg, 0) }
            : {}),
          stock_form: selectedOutputStockForm,
          width_basis: selectedWidthBasis,
        }));
        payload.output_stock_form = selectedOutputStockForm;
        payload.stock_form = selectedOutputStockForm;
        payload.actual_qty = splitTotalKg;
      } else if (supportsDiscreteOutputRolls) {
        if (!createRollRowsParsed.length)
          throw new Error(
            "Enter at least one roll row with gross weight greater than tare.",
          );
        if (createRollTotalKg > maxOutputWithScrapKg + 0.001)
          throw new Error(
            `Roll output exceeds physical cap ${kg(maxOutputWithScrapKg)}.`,
          );
        payload.roll_outputs = createRollRowsParsed.map((row) => ({
          width_mm: row.width_mm,
          weight_kg: row.weight_kg,
          ...(row.length_m && row.length_m > 0
            ? { length_m: row.length_m }
            : {}),
          ...(toNumber(row.tare_weight_kg, 0) > 0
            ? { tare_weight_kg: toNumber(row.tare_weight_kg, 0) }
            : {}),
          ...(toNumber(row.gross_weight_kg, 0) > 0
            ? { gross_weight_kg: toNumber(row.gross_weight_kg, 0) }
            : {}),
          stock_form: selectedOutputStockForm,
          width_basis: selectedWidthBasis,
        }));
        payload.output_stock_form = selectedOutputStockForm;
        payload.stock_form = selectedOutputStockForm;
        payload.actual_qty = createRollTotalKg;
      } else {
        let qty = toNumber(outputWeightKg, NaN);
        if (showPcsEntry) {
          const pcs = toNumber(outputPcs, NaN);
          if (!Number.isFinite(pcs) || pcs <= 0)
            throw new Error("Output PCS is required for roll to bulk steps.");
          payload.output_pcs = Math.max(1, Math.round(pcs));
          if (!Number.isFinite(qty) || qty <= 0) {
            if (unitWeightG <= 0)
              throw new Error("Unit weight is required to convert PCS to KG.");
            qty = (payload.output_pcs * unitWeightG) / 1000;
          }
        }
        if (!Number.isFinite(qty) || qty <= 0)
          throw new Error("Output weight must be greater than zero.");
        if (qty > maxOutputWithScrapKg + 0.001)
          throw new Error(
            `Output exceeds physical cap ${kg(maxOutputWithScrapKg)}.`,
          );
        payload.actual_qty = qty;
      }

      if (supportsDiscreteOutputRolls) {
        const width = toNumber(outputWidthMm, NaN);
        if (!Number.isFinite(width) || width <= 0)
          throw new Error("Output width is required for roll output.");
        payload.output_width_mm = width;
        payload.output_stock_form = selectedOutputStockForm;
        payload.stock_form = selectedOutputStockForm;
        const length = toNumber(outputLengthM, NaN);
        if (Number.isFinite(length) && length > 0)
          payload.output_length_m = length;
      }
      return machineService.logOutput(
        machineId,
        String(selectedJob.id),
        payload,
      );
    },
    onSuccess: async () => {
      toast({
        title: "Output logged",
        description: "Progress, scrap, and inventory math refreshed.",
      });
      await refreshAll();
    },
    onError: (err: any) =>
      toast({
        variant: "destructive",
        title: "Log output failed",
        description:
          err?.response?.data?.error?.message ||
          err?.message ||
          "Unable to log output.",
      }),
  });

  const completeMutation = useMutation({
    mutationFn: async () => {
      if (!selectedJob) throw new Error("Select a job first.");
      const material_confirmations = Object.values(materialConfirmations)
        .map((draft) => ({
          requirement_id: draft.requirement_id,
          material_id: draft.material_id,
          actual_issued_qty: Math.max(0, toNumber(draft.actual_issued_qty, 0)),
          actual_returned_qty: Math.max(
            0,
            toNumber(draft.actual_returned_qty, 0),
          ),
          actual_scrap_qty: Math.max(0, toNumber(draft.actual_scrap_qty, 0)),
          is_estimated: draft.is_estimated,
          return_mode: draft.return_mode || "EXACT_COLOR_RETURN",
          target_ink_material_id:
            draft.return_mode === "REMIXED_RETURN"
              ? draft.target_ink_material_id
              : undefined,
          granule_code_allocations: (draft.granule_code_allocations || [])
            .map((row) => ({
              granule_code_id: row.granule_code_id,
              qty_kg: Math.max(0, toNumber(row.qty_kg, 0)),
            }))
            .filter((row) => row.granule_code_id && row.qty_kg > 0),
        }))
        .filter((row) => row.requirement_id);
      return machineService.completeJob(machineId, String(selectedJob.id), {
        force_reason: forceReason.trim() || undefined,
        material_confirmations: material_confirmations.length
          ? material_confirmations
          : undefined,
      });
    },
    onSuccess: async (data) => {
      toast({
        title:
          data?.completion_mode === "FORCED_VARIANCE"
            ? "Step force-completed"
            : "Step completed",
        description:
          data?.completion_mode === "FORCED_VARIANCE"
            ? `Variance ${kg(data?.variance_kg)}`
            : "Routing advanced with current-step actuals.",
      });
      await refreshAll();
    },
    onError: (err: any) =>
      toast({
        variant: "destructive",
        title: "Complete failed",
        description:
          err?.response?.data?.error?.message ||
          err?.message ||
          "Unable to complete step.",
      }),
  });

  const scrapMutation = useMutation({
    mutationFn: async () => {
      if (!selectedJob) throw new Error("Select a job first.");
      return machineService.logScrap(machineId, String(selectedJob.id), {
        quantity: Math.max(0, toNumber(scrapDialogQty, 0)),
        reason: scrapDialogReason,
        reason_master_id: scrapDialogReasonId || undefined,
        notes: scrapDialogNotes,
      });
    },
    onSuccess: async () => {
      setSublog(null);
      setScrapDialogQty("0");
      toast({
        title: "Scrap logged",
        description: "Scrap is now visible in live events.",
      });
      await refreshAll();
    },
    onError: (err: any) =>
      toast({
        variant: "destructive",
        title: "Scrap failed",
        description:
          err?.response?.data?.error?.message ||
          err?.message ||
          "Unable to log scrap.",
      }),
  });

  const downtimeMutation = useMutation({
    mutationFn: async () => {
      if (!selectedJob) throw new Error("Select a job first.");
      return machineService.logDowntime(machineId, String(selectedJob.id), {
        reason: downtimeReason,
        reason_master_id: downtimeReasonId || undefined,
        start_time: downtimeStart
          ? new Date(downtimeStart).toISOString()
          : undefined,
        end_time: downtimeEnd ? new Date(downtimeEnd).toISOString() : undefined,
        notes: downtimeNotes,
        auto_stop: downtimeAutoStop,
      });
    },
    onSuccess: async () => {
      setSublog(null);
      toast({
        title: "Downtime logged",
        description: downtimeAutoStop
          ? "Machine step was paused."
          : "Downtime event was recorded.",
      });
      await refreshAll();
    },
    onError: (err: any) =>
      toast({
        variant: "destructive",
        title: "Downtime failed",
        description:
          err?.response?.data?.error?.message ||
          err?.message ||
          "Unable to log downtime.",
      }),
  });

  const consumptionMutation = useMutation({
    mutationFn: async () => {
      if (!selectedJob) throw new Error("Select a job first.");
      if (!consumptionMaterialId && consumptionRollId === SELECT_NONE)
        throw new Error("Select material or roll.");
      const qty = toNumber(consumptionQty, NaN);
      if (!Number.isFinite(qty) || qty <= 0)
        throw new Error("Consumption quantity must be greater than zero.");
      return machineService.logConsumption(machineId, String(selectedJob.id), {
        material_id: consumptionMaterialId || undefined,
        granule_code_id:
          consumptionGranuleCodeId !== SELECT_NONE
            ? consumptionGranuleCodeId
            : undefined,
        roll_id:
          consumptionRollId !== SELECT_NONE ? consumptionRollId : undefined,
        quantity: qty,
        uom: "KG",
        is_estimated: consumptionEstimated,
      });
    },
    onSuccess: async () => {
      setSublog(null);
      setConsumptionQty("");
      toast({
        title: "Consumption logged",
        description: "Manual material usage is now in the job event stream.",
      });
      await refreshAll();
    },
    onError: (err: any) =>
      toast({
        variant: "destructive",
        title: "Consumption failed",
        description:
          err?.response?.data?.error ||
          err?.message ||
          "Unable to log consumption.",
      }),
  });

  const qualityMutation = useMutation({
    mutationFn: async () => {
      if (!selectedJob) throw new Error("Select a job first.");
      const readings = qualityRows
        .filter((row) => row.value.trim())
        .map((row) => ({
          code: row.code,
          value_numeric: row.textMode ? null : toNumber(row.value, NaN),
          value_text: row.textMode ? row.value : "",
          spec_min: row.spec_min,
          spec_max: row.spec_max,
          in_spec: row.in_spec,
        }))
        .filter(
          (row) =>
            row.value_text || Number.isFinite(row.value_numeric as number),
        );
      if (!readings.length)
        throw new Error("Enter at least one quality reading.");
      return machineService.logQuality(machineId, String(selectedJob.id), {
        readings,
      });
    },
    onSuccess: async () => {
      setSublog(null);
      toast({
        title: "Quality logged",
        description: "Readings are attached to this job and process.",
      });
      await refreshAll();
    },
    onError: (err: any) =>
      toast({
        variant: "destructive",
        title: "Quality failed",
        description:
          err?.response?.data?.error?.message ||
          err?.message ||
          "Unable to log quality.",
      }),
  });

  const handleOutputWeightChange = (value: string) => {
    setOutputWeightDirty(true);
    let next = value;
    const parsed = toNumber(value, NaN);
    if (
      Number.isFinite(parsed) &&
      parsed > maxOutputWithScrapKg &&
      maxOutputWithScrapKg > 0
    )
      next = maxOutputWithScrapKg.toFixed(3);
    setOutputWeightKg(next);
    if (showPcsEntry && outputEntryMode === "KG" && unitWeightG > 0) {
      const kgValue = toNumber(next, NaN);
      setOutputPcs(
        Number.isFinite(kgValue) && kgValue > 0
          ? String(Math.max(1, Math.round((kgValue * 1000) / unitWeightG)))
          : "",
      );
    }
  };

  const handleOutputPcsChange = (value: string) => {
    setOutputPcs(value);
    if (!showPcsEntry || outputEntryMode !== "PCS" || unitWeightG <= 0) return;
    const pcs = toNumber(value, NaN);
    setOutputWeightDirty(false);
    setOutputWeightKg(
      Number.isFinite(pcs) && pcs > 0
        ? ((Math.round(pcs) * unitWeightG) / 1000).toFixed(3)
        : "",
    );
  };

  const addCreateRollRow = () => {
    const width =
      outputWidthMm || String(resolveCreateNewDefaultWidth(context) || "");
    const tare = rollSetupTareKg || outputTareKg || "";
    setCreateRollRows((prev) => [
      ...prev,
      {
        id: createCounterRef.current++,
        width_mm: width,
        weight_kg: "",
        length_m: outputLengthM,
        tare_weight_kg: tare,
        gross_weight_kg: "",
      },
    ]);
  };
  const generateCreateRollRows = () => {
    const requested = Math.floor(toNumber(rollSetupCount, 1));
    const rowCount = Math.max(1, Math.min(200, requested || 1));
    const width =
      outputWidthMm || String(resolveCreateNewDefaultWidth(context) || "");
    const tare = rollSetupTareKg || outputTareKg || "";
    setRollSetupCount(String(rowCount));
    setOutputWidthMm(width);
    setOutputTareKg(tare);
    setOutputGrossKg("");
    setOutputWeightDirty(false);
    setOutputWeightKg("");
    setCreateRollRows(
      Array.from({ length: Math.max(0, rowCount - 1) }, () => ({
        id: createCounterRef.current++,
        width_mm: width,
        weight_kg: "",
        length_m: outputLengthM,
        tare_weight_kg: tare,
        gross_weight_kg: "",
      })),
    );
  };
  const addSplitRow = () =>
    setSplitRows((prev) => [
      ...prev,
      {
        id: splitCounterRef.current++,
        width_mm: "",
        weight_kg: "",
        tare_weight_kg: "",
        gross_weight_kg: "",
      },
    ]);
  const updatePrimaryRollGrossTare = (
    key: "tare_weight_kg" | "gross_weight_kg",
    value: string,
  ) => {
    const nextGross = key === "gross_weight_kg" ? value : outputGrossKg;
    const nextTare = key === "tare_weight_kg" ? value : outputTareKg;
    if (key === "gross_weight_kg") setOutputGrossKg(value);
    if (key === "tare_weight_kg") setOutputTareKg(value);
    const nextNet = netWeightInput(nextGross, nextTare);
    if (nextNet !== null) {
      setOutputWeightDirty(false);
      setOutputWeightKg(nextNet);
      if (showPcsEntry && outputEntryMode === "KG" && unitWeightG > 0) {
        const kgValue = toNumber(nextNet, NaN);
        setOutputPcs(
          Number.isFinite(kgValue) && kgValue > 0
            ? String(Math.max(1, Math.round((kgValue * 1000) / unitWeightG)))
            : "",
        );
      }
    }
  };
  const updateCreateRow = (
    id: number,
    key: keyof CreateRollRow,
    value: string,
  ) =>
    setCreateRollRows((prev) =>
      prev.map((row) => {
        if (row.id !== id) return row;
        const next = { ...row, [key]: value };
        if (key === "tare_weight_kg" || key === "gross_weight_kg") {
          const nextNet = netWeightInput(
            next.gross_weight_kg,
            next.tare_weight_kg,
          );
          if (nextNet !== null) next.weight_kg = nextNet;
        }
        return next;
      }),
    );
  const updateSplitRow = (id: number, key: keyof SplitRow, value: string) =>
    setSplitRows((prev) =>
      prev.map((row) => {
        if (row.id !== id) return row;
        const next = { ...row, [key]: value };
        if (key === "tare_weight_kg" || key === "gross_weight_kg") {
          const nextNet = netWeightInput(
            next.gross_weight_kg,
            next.tare_weight_kg,
          );
          if (nextNet !== null) next.weight_kg = nextNet;
        }
        return next;
      }),
    );
  const updateMaterialConfirmation = (
    requirementId: string,
    patch: Partial<MaterialConfirmationDraft>,
  ) => {
    const baseDraft: MaterialConfirmationDraft = {
      requirement_id: requirementId,
      actual_issued_qty: "",
      actual_returned_qty: "0.000",
      actual_scrap_qty: "0.000",
      is_estimated: false,
      return_mode: "EXACT_COLOR_RETURN",
      granule_code_allocations: [],
    };
    setMaterialConfirmations((prev) => ({
      ...prev,
      [requirementId]: {
        ...baseDraft,
        ...(prev[requirementId] || {}),
        ...(patch as Partial<MaterialConfirmationDraft>),
      },
    }));
  };
  const autoSplitEqual = (parts?: number) => {
    const rowCount = Math.max(1, parts || createRollRows.length + 1);
    const total = Math.max(
      previewOutputKg,
      toNumber(outputWeightKg, 0),
      maxOutputWithScrapKg,
    );
    const width =
      outputWidthMm || String(resolveCreateNewDefaultWidth(context) || "");
    if (rowCount <= 1 || total <= 0) return;
    const each = (total / rowCount).toFixed(3);
    const firstTare = rollSetupTareKg || outputTareKg || "";
    const firstGross = (
      toNumber(each, 0) + Math.max(0, toNumber(firstTare, 0))
    ).toFixed(3);
    setCreateRollRows((prev) => {
      const next = [...prev];
      while (next.length < rowCount - 1) {
        next.push({
          id: createCounterRef.current++,
          width_mm: width,
          weight_kg: "",
          length_m: outputLengthM,
          tare_weight_kg: firstTare,
          gross_weight_kg: "",
        });
      }
      return next
        .slice(0, rowCount - 1)
        .map((row) => {
          const tare = row.tare_weight_kg || firstTare;
          return {
          ...row,
          width_mm: row.width_mm || width,
          weight_kg: each,
          length_m: row.length_m || outputLengthM,
            tare_weight_kg: tare,
            gross_weight_kg: (
              toNumber(each, 0) + Math.max(0, toNumber(tare, 0))
            ).toFixed(3),
          };
        });
    });
    setOutputWeightKg(each);
    setOutputTareKg(firstTare);
    setOutputGrossKg(firstGross);
  };

  if (!machineId) {
    return (
      <div className="p-6 text-sm text-danger-fg">
        Missing machine id in route.
      </div>
    );
  }

  if (machineLoading || queueLoading) {
    return (
      <div className="min-h-screen bg-surface-2 p-6">
        <div
          className={cn(
            surfaceClass,
            "p-8 text-center text-sm font-semibold text-content-3",
          )}
        >
          Loading machine terminal...
        </div>
      </div>
    );
  }

  if (machineError || queueError) {
    return (
      <div className="min-h-screen bg-surface-2 p-6">
        <div
          className={cn(
            surfaceClass,
            "flex items-start gap-3 border-danger-border p-6 text-danger-fg",
          )}
          data-testid="machine-terminal-error"
        >
          <AlertCircle className="mt-0.5 h-5 w-5" />
          <div className="flex-1">
            <div className="font-black">Failed to load machine terminal</div>
            <div className="text-sm font-semibold text-danger-fg">
              {String(
                (machineError as any)?.message ||
                  (queueError as any)?.message ||
                  "Network or server error",
              )}
            </div>
            <Button
              type="button"
              onClick={() => refreshAll()}
              className="mt-3 h-9 rounded-[10px] bg-danger-solid text-xs font-bold text-white hover:bg-danger-solid"
              data-testid="machine-terminal-retry"
            >
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Retry
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const machineName = firstNonEmpty(
    machineDetail?.machine?.name,
    machineDetail?.machine?.code,
    "Machine Terminal",
  );
  const machineCode = firstNonEmpty(
    machineDetail?.machine?.code,
    machineDetail?.machine?.name,
    "Machine",
  );
  const customerName = firstNonEmpty(
    spec.customerName,
    context?.job?.customer_name,
    selectedJob?.customer_name,
    "Stock production",
  );
  const orderNumber = firstNonEmpty(
    spec.orderNumber,
    context?.job?.order_number,
    selectedJob?.order_number,
    selectedJob?.job_number,
    "STOCK",
  );
  const historyRows = Array.isArray((historyData as any)?.jobs)
    ? (historyData as any).jobs
    : [];
  const terminalState = !selectedJob
    ? "IDLE"
    : isExecuting
      ? "RUNNING"
      : isPaused
        ? "PAUSED"
        : jobState === "COMPLETED"
          ? "COMPLETE"
          : canStart
            ? "READY"
            : jobState || "READY";
  const syncLabel = !online
    ? "Offline"
    : secondsSinceSync > STALE_THRESHOLD_SECONDS
      ? `Stale ${secondsSinceSync}s`
      : secondsSinceSync <= 1
        ? "Synced now"
        : `Synced ${secondsSinceSync}s ago`;
  const templateName = firstNonEmpty(
    context?.display?.template_name,
    selectedJob?.template_name,
    spec.productName,
    "Production job",
  );
  const plannerNote = firstNonEmpty(
    (context?.display as any)?.planner_note,
    (context?.job as any)?.planner_note,
    selectedJobAny?.planner_note,
    selectedJobAny?.notes,
  );
  const yieldPct =
    targetKg > 0
      ? Math.max(0, Math.min(999, (producedKg / targetKg) * 100))
      : 0;

  return (
    <div
      className="min-h-screen bg-[radial-gradient(900px_500px_at_0%_-10%,#e0f2fe_0%,transparent_55%),radial-gradient(900px_500px_at_100%_-10%,#ddd6fe_0%,transparent_55%),linear-gradient(180deg,#fff_0%,#f8fafc_100%)] text-[#0b1220]"
      data-testid="machine-execution-page"
    >
      <ConnectionLostBanner
        online={online}
        stale={secondsSinceSync > STALE_THRESHOLD_SECONDS}
        secondsSinceSync={secondsSinceSync}
        onRetry={() => refreshAll()}
      />
      <span className="sr-only">
        Kiosk focus for operators Select job Start / resume Log output Idle
        machine
      </span>
      <div className="mx-auto max-w-[1640px] px-3 py-4 md:px-6">
        <section className="mb-4 overflow-hidden rounded-[20px] bg-surface-1 shadow-[0_26px_70px_-42px_rgba(15,23,42,0.55)] ring-1 ring-line">
          <div className="flex flex-col gap-2 bg-surface-3 px-4 py-3 text-sm text-white lg:flex-row lg:items-center">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                className="h-8 rounded-lg px-2 text-xs font-black text-white hover:bg-surface-1/10 hover:text-white"
                onClick={() => router.push("/production/machine-selector")}
              >
                <ArrowLeft className="mr-1 h-4 w-4" />
                Machines
              </Button>
              <span className="min-w-0 break-words font-black">
                {machineName}
              </span>
              <span className="text-content-4">· {machineCode}</span>
              <span className="text-content-4">
                · {machineDetail?.machine?.plant_name || "Plant"}
              </span>
              <span className="text-content-4">
                · {machineDetail?.machine?.work_center_name || "Assigned line"}
              </span>
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-black uppercase tracking-wider ring-1",
                  terminalStateBadgeClass(terminalState),
                )}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-current" />
                {terminalState}
              </span>
              <span className="rounded-full bg-surface-1/10 px-2.5 py-1 text-[11px] font-bold text-content-4">
                Shift live
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
              <span
                className={cn(
                  "rounded-full px-2.5 py-1 text-[11px] font-bold ring-1",
                  online
                    ? "bg-surface-1/10 text-content-4 ring-surface-1/10"
                    : "bg-danger-solid text-danger-border ring-danger-border",
                )}
              >
                {syncLabel}
              </span>
              <Button
                type="button"
                variant={activeTab === "run" ? "secondary" : "ghost"}
                className={cn(
                  "h-8 rounded-lg px-3 text-xs font-black",
                  activeTab === "run"
                    ? "bg-surface-1 text-content-1 hover:bg-surface-2"
                    : "text-white hover:bg-surface-1/10 hover:text-white",
                )}
                onClick={() => setActiveTab("run")}
              >
                Run
              </Button>
              <Button
                type="button"
                variant={activeTab === "history" ? "secondary" : "ghost"}
                className={cn(
                  "h-8 rounded-lg px-3 text-xs font-black",
                  activeTab === "history"
                    ? "bg-surface-1 text-content-1 hover:bg-surface-2"
                    : "text-white hover:bg-surface-1/10 hover:text-white",
                )}
                onClick={() => setActiveTab("history")}
              >
                <History className="mr-1.5 h-3.5 w-3.5" />
                History
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-8 rounded-lg px-3 text-xs font-black text-white hover:bg-surface-1/10 hover:text-white"
                onClick={() => refreshAll()}
              >
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                Refresh
              </Button>
            </div>
          </div>
          <div className="grid gap-3 px-4 py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
            <div className="min-w-0">
              <div className={labelClass}>Machine Terminal</div>
              <h1 className="mt-1 break-words text-2xl font-black tracking-tight text-content-1">
                {templateName}
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs font-semibold text-content-3">
                <span>{customerName}</span>
                <span className="text-content-4">/</span>
                <span className="font-mono">{orderNumber}</span>
                <span className="text-content-4">/</span>
                <span>{stepName}</span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {isExecuting ? (
                <Button
                  type="button"
                  className="h-11 rounded-[12px] bg-warning-fg px-5 text-sm font-black text-white hover:bg-warning-fg"
                  data-testid="machine-stop-step"
                  disabled={!canStop || stopMutation.isPending}
                  onClick={() => stopMutation.mutate()}
                >
                  <Pause className="mr-2 h-4 w-4" />
                  Pause
                </Button>
              ) : (
                <Button
                  type="button"
                  className="h-11 rounded-[12px] bg-success-fg px-5 text-sm font-black text-white hover:bg-success-fg"
                  data-testid="machine-start-step"
                  disabled={!canStart || startMutation.isPending}
                  onClick={() => startMutation.mutate()}
                >
                  <Play className="mr-2 h-4 w-4" />
                  {isPaused ? "Resume job" : "Start job"}
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                className="h-11 rounded-[12px] bg-surface-1 px-4 text-sm font-black"
                onClick={() =>
                  document
                    .getElementById("machine-output-panel")
                    ?.scrollIntoView({ block: "center" })
                }
              >
                Output
              </Button>
            </div>
          </div>
        </section>

        {activeTab === "history" ? (
          <HistoryPanel
            historyRows={historyRows}
            historySummary={(historyData as any)?.summary}
            historyLoading={historyLoading}
            historyDateFrom={historyDateFrom}
            historyDateTo={historyDateTo}
            historyStatus={historyStatus}
            setHistoryDateFrom={setHistoryDateFrom}
            setHistoryDateTo={setHistoryDateTo}
            setHistoryStatus={setHistoryStatus}
          />
        ) : (
          <>
            <div className="grid min-w-0 gap-4 xl:grid-cols-[280px_minmax(0,1fr)_300px]">
              <aside className="order-2 min-w-0 space-y-4 xl:order-1">
                <QueueRail
                  visibleQueueItems={visibleQueueItems}
                  queueItems={queueItems}
                  selectedId={selectedId}
                  queueSearch={queueSearch}
                  setQueueSearch={setQueueSearch}
                  queueStatusFilter={queueStatusFilter}
                  setQueueStatusFilter={setQueueStatusFilter}
                  setSelectedJobId={setSelectedJobId}
                  refreshAll={refreshAll}
                />
                <InputFeedCard
                  reservedRolls={reservedRolls}
                  wipRolls={rightRailRolls}
                  materialRows={materialReleaseRows}
                  materialConfirmations={materialConfirmations}
                  updateMaterialConfirmation={updateMaterialConfirmation}
                  inkTargetOptions={inkTargetOptions}
                  contextLoading={contextLoading}
                />
              </aside>

              <main className="order-1 min-w-0 space-y-4 xl:order-2">
                <FocusedJobHero
                  selectedJob={selectedJob}
                  spec={spec}
                  chips={chips}
                  customerName={customerName}
                  orderNumber={orderNumber}
                  templateName={templateName}
                  plannerNote={plannerNote}
                  stepName={stepName}
                  behavior={behavior}
                  targetKg={targetKg}
                  producedKg={producedKg}
                  remainingKg={remainingKg}
                  yieldPct={yieldPct}
                  progressPct={progressPct}
                />

                <RouteStepper
                  stepName={stepName}
                  stepTransform={stepTransform}
                  behavior={behavior}
                  jobState={jobState}
                  isExecuting={isExecuting}
                  isPaused={isPaused}
                  allocationReady={allocationReady}
                  producedKg={producedKg}
                  remainingKg={remainingKg}
                  targetKg={targetKg}
                  progressPct={progressPct}
                  canStart={canStart}
                  canLogOutput={canLogOutput}
                  canComplete={canComplete}
                  nextAction={operatorNextStep}
                  routeSteps={routeSteps}
                />

                <div className="grid gap-4 lg:grid-cols-2">
                  {selectedJob &&
                  (selectedJob?.current_step_print_capable ||
                    selectedJob?.committed_artwork_id) ? (
                    <CylinderSetCard
                      artworkId={selectedJob?.committed_artwork_id || null}
                      artworkCode={selectedJob?.committed_artwork_code || null}
                      artworkName={selectedJob?.committed_artwork_name || null}
                      printCapable={Boolean(
                        selectedJob?.current_step_print_capable,
                      )}
                    />
                  ) : (
                    <section className={cn(surfaceClass, "p-4")}>
                      <div className={labelClass}>Artwork / tooling</div>
                      <div className="mt-1 text-sm font-black text-content-1">
                        No print tooling for this step
                      </div>
                      <div className="mt-1 text-xs font-semibold leading-5 text-content-3">
                        When an artwork or cylinder set is committed, it appears
                        here beside reserved material.
                      </div>
                    </section>
                  )}
                  <ReservationSummaryCard
                    reservedInputKg={reservedInputTotalKg}
                    consumedInputKg={consumedInputTotalKg}
                    heldInputKg={heldInputTotalKg}
                    reservedRolls={reservedRolls}
                    materialRows={materialReleaseRows}
                  />
                </div>

                <section
                  className={cn(surfaceClass, "min-w-0 overflow-hidden")}
                  id="machine-output-panel"
                  data-testid="machine-output-panel"
                >
                  <span className="sr-only">
                    Enter only the fields this step needs.
                  </span>
                  <div className="flex items-center justify-between gap-3 border-b border-line bg-surface-1 px-5 py-4">
                    <div className="min-w-0">
                      <div className={labelClass}>Production controls</div>
                      <div className="mt-0.5 break-words text-lg font-black text-content-1">
                        {variantTitle(variant, stepName, behavior)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 rounded-lg bg-surface-1 text-xs font-bold"
                        data-testid="machine-stage-output"
                        onClick={() =>
                          document
                            .getElementById("machine-output-panel")
                            ?.scrollIntoView({ block: "center" })
                        }
                      >
                        Focus
                      </Button>
                    </div>
                  </div>

                  {isPaused ? (
                    <div className="border-b border-warning-border bg-warning-bg px-5 py-3 text-sm font-semibold text-warning-fg">
                      Step is paused. Resume the job before logging output.
                    </div>
                  ) : null}
                  {!allocationReady ? (
                    <div className="border-b border-danger-border bg-danger-bg px-5 py-3 text-sm font-semibold text-danger-fg">
                      Required input allocation is not ready for this step.
                    </div>
                  ) : null}

                  <div className="p-5">
                    <div className="mb-4 grid gap-3 sm:grid-cols-3">
                      <MetricTile
                        label="Output handling"
                        value={
                          supportsDiscreteOutputRolls
                            ? "ROLL ROWS"
                            : variant === "pouching"
                              ? outputCaptureModeLabel(outputCaptureMode)
                              : behaviorLabel(behavior)
                        }
                        tone="blue"
                      />
                      <MetricTile
                        label="Max this log"
                        value={kg(maxOutputWithScrapKg)}
                        tone="slate"
                      />
                      <MetricTile
                        label="Close tolerance"
                        value={qtyLabel(stepTolerancePrimary, primaryUom)}
                        tone="amber"
                      />
                    </div>

                    <ProcessLogForm
                      variant={variant}
                      behavior={behavior}
                      currentOutputForm={currentOutputForm}
                      showPcsEntry={showPcsEntry}
                      outputCaptureMode={outputCaptureMode}
                      supportsDiscreteOutputRolls={supportsDiscreteOutputRolls}
                      outputEntryMode={outputEntryMode}
                      setOutputEntryMode={setOutputEntryMode}
                      outputWeightKg={outputWeightKg}
                      handleOutputWeightChange={handleOutputWeightChange}
                      outputPcs={outputPcs}
                      handleOutputPcsChange={handleOutputPcsChange}
                      unitWeightG={unitWeightG}
                      outputWidthMm={outputWidthMm}
                      setOutputWidthMm={(value: string) => {
                        setOutputWidthDirty(true);
                        setOutputWidthMm(value);
                      }}
                      outputStockForm={outputStockForm}
                      setOutputStockForm={setOutputStockForm}
                      targetStockContract={targetStockContract}
                      outputLengthM={outputLengthM}
                      setOutputLengthM={setOutputLengthM}
                      outputTareKg={outputTareKg}
                      outputGrossKg={outputGrossKg}
                      updatePrimaryRollGrossTare={updatePrimaryRollGrossTare}
                      rollSetupCount={rollSetupCount}
                      setRollSetupCount={setRollSetupCount}
                      rollSetupTareKg={rollSetupTareKg}
                      setRollSetupTareKg={setRollSetupTareKg}
                      generateCreateRollRows={generateCreateRollRows}
                      createRollRows={createRollRows}
                      addCreateRollRow={addCreateRollRow}
                      updateCreateRow={updateCreateRow}
                      removeCreateRow={(id: number) =>
                        setCreateRollRows((prev) =>
                          prev.filter((row) => row.id !== id),
                        )
                      }
                      autoSplitEqual={autoSplitEqual}
                      splitRows={splitRows}
                      addSplitRow={addSplitRow}
                      updateSplitRow={updateSplitRow}
                      removeSplitRow={(id: number) =>
                        setSplitRows((prev) =>
                          prev.length <= 1
                            ? prev
                            : prev.filter((row) => row.id !== id),
                        )
                      }
                      reservedRolls={reservedRolls}
                      reservedInputTotalKg={reservedInputTotalKg}
                      maxOutputWithScrapKg={maxOutputWithScrapKg}
                      wasteKgValue={wasteKgValue}
                      previewOutputKg={previewOutputKg}
                      previewOutputPcs={previewOutputPcs}
                      trimInput={trimInput}
                      setTrimInput={setTrimInput}
                      scrapInput={scrapInput}
                      setScrapInput={setScrapInput}
                      scrapEntryMode={scrapEntryMode}
                      setScrapEntryMode={setScrapEntryMode}
                      remainderLocations={remainderLocations}
                      remainderLocationId={remainderLocationId}
                      setRemainderLocationId={setRemainderLocationId}
                      selectedMaterial={selectedMaterial}
                      reconcilableBulkRows={reconcilableBulkRows}
                    />

                    {exceedsOutputCap ? (
                      <div className="mt-3 rounded-xl border border-danger-border bg-danger-bg px-3 py-2 text-xs font-semibold text-danger-fg">
                        Output preview {kg(previewOutputKg)} exceeds the current
                        physical cap {kg(maxOutputWithScrapKg)}.
                      </div>
                    ) : null}
                  </div>

                  <div className="sticky bottom-0 z-10 flex flex-col gap-3 border-t border-line bg-surface-1/95 px-5 py-3 backdrop-blur supports-[backdrop-filter]:bg-surface-1/80 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <Button
                        type="button"
                        variant="outline"
                        className="h-9 rounded-[10px] bg-surface-1 text-xs font-semibold"
                        onClick={() => {
                          setScrapDialogQty(scrapInput || "0");
                          setScrapDialogReason(scrapReason);
                          setScrapDialogReasonId(null);
                          setSublog("scrap");
                        }}
                      >
                        + Scrap
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-9 rounded-[10px] bg-surface-1 text-xs font-semibold"
                        onClick={() => {
                          setDowntimeStart(toDateTimeLocal());
                          setDowntimeReasonId(null);
                          setSublog("downtime");
                        }}
                      >
                        + Downtime
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-9 rounded-[10px] bg-surface-1 text-xs font-semibold"
                        onClick={() => setSublog("consumption")}
                      >
                        + Consumption
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-9 rounded-[10px] bg-surface-1 text-xs font-semibold"
                        onClick={() => {
                          setQualityRows(qualityPreset(variant));
                          setSublog("quality");
                        }}
                      >
                        + Quality
                      </Button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {needsForceComplete ? (
                        <Input
                          value={forceReason}
                          onChange={(event) =>
                            setForceReason(event.target.value)
                          }
                          placeholder="Variance reason required"
                          className="h-9 min-w-[220px] rounded-[10px] border-warning-border bg-warning-bg text-xs font-semibold"
                        />
                      ) : null}
                      <Button
                        type="button"
                        className="h-10 rounded-[10px] bg-gradient-to-br from-info-fg to-primary text-sm font-semibold text-white"
                        data-testid="machine-log-output"
                        disabled={!canLogOutput || logOutputMutation.isPending}
                        onClick={() => logOutputMutation.mutate()}
                      >
                        <Save className="mr-2 h-4 w-4" />
                        Log output
                      </Button>
                      <Button
                        type="button"
                        className="h-10 rounded-[10px] bg-gradient-to-br from-success-fg to-success-fg text-sm font-semibold text-white"
                        data-testid="machine-finalize-step"
                        disabled={!canComplete || completeMutation.isPending}
                        onClick={() => completeMutation.mutate()}
                      >
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                        Complete step →
                      </Button>
                    </div>
                  </div>
                </section>
              </main>

              <aside className="order-3 min-w-0">
                <TelemetryPanel
                  events={events}
                  loading={eventsLoading}
                  inventoryCounters={inventoryCounters}
                  producedKg={producedKg}
                  targetKg={targetKg}
                  remainingKg={remainingKg}
                  nextAction={operatorNextStep}
                  allocationReady={allocationReady}
                  shortage={toNumber(
                    (context?.telemetry?.execution_health as any)
                      ?.roll_shortage_count ??
                      (context?.satisfaction as any)?.rolls_missing,
                    0,
                  )}
                  contextLoading={contextLoading}
                  reservedInputKg={reservedInputTotalKg}
                  consumedInputKg={consumedInputTotalKg}
                  heldInputKg={heldInputTotalKg}
                  onRefresh={refreshAll}
                />
              </aside>
            </div>
          </>
        )}
      </div>

      <SublogDialog
        sublog={sublog}
        setSublog={setSublog}
        selectedJob={selectedJob}
        scrapDialogQty={scrapDialogQty}
        setScrapDialogQty={setScrapDialogQty}
        scrapDialogReason={scrapDialogReason}
        setScrapDialogReason={setScrapDialogReason}
        scrapDialogReasonId={scrapDialogReasonId}
        setScrapDialogReasonId={setScrapDialogReasonId}
        scrapReasonGroups={scrapReasonGroups}
        scrapDialogNotes={scrapDialogNotes}
        setScrapDialogNotes={setScrapDialogNotes}
        scrapMutationPending={scrapMutation.isPending}
        onSaveScrap={() => scrapMutation.mutate()}
        downtimeReason={downtimeReason}
        setDowntimeReason={setDowntimeReason}
        downtimeReasonId={downtimeReasonId}
        setDowntimeReasonId={setDowntimeReasonId}
        downtimeReasonGroups={downtimeReasonGroups}
        downtimeStart={downtimeStart}
        setDowntimeStart={setDowntimeStart}
        downtimeEnd={downtimeEnd}
        setDowntimeEnd={setDowntimeEnd}
        downtimeAutoStop={downtimeAutoStop}
        setDowntimeAutoStop={setDowntimeAutoStop}
        downtimeNotes={downtimeNotes}
        setDowntimeNotes={setDowntimeNotes}
        downtimeMutationPending={downtimeMutation.isPending}
        onSaveDowntime={() => downtimeMutation.mutate()}
        materialOptions={materialOptions}
        consumptionMaterialId={consumptionMaterialId}
        setConsumptionMaterialId={setConsumptionMaterialId}
        filteredGranuleCodes={filteredGranuleCodes}
        consumptionGranuleCodeId={consumptionGranuleCodeId}
        setConsumptionGranuleCodeId={setConsumptionGranuleCodeId}
        reservedRolls={reservedRolls}
        consumptionRollId={consumptionRollId}
        setConsumptionRollId={setConsumptionRollId}
        consumptionQty={consumptionQty}
        setConsumptionQty={setConsumptionQty}
        consumptionEstimated={consumptionEstimated}
        setConsumptionEstimated={setConsumptionEstimated}
        consumptionPending={consumptionMutation.isPending}
        onSaveConsumption={() => consumptionMutation.mutate()}
        qualityRows={qualityRows}
        setQualityRows={setQualityRows}
        qualityPending={qualityMutation.isPending}
        onSaveQuality={() => qualityMutation.mutate()}
      />
    </div>
  );
}

function MetricTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "blue" | "slate" | "amber";
}) {
  const classes =
    tone === "blue"
      ? "border-info-border bg-info-bg text-primary"
      : tone === "amber"
        ? "border-warning-border bg-warning-bg text-warning-fg"
        : "border-line bg-surface-2 text-content-1";
  return (
    <div className={cn("rounded-xl border px-3 py-2", classes)}>
      <div
        className={cn(
          labelClass,
          tone === "blue" && "text-primary",
          tone === "amber" && "text-warning-fg",
        )}
      >
        {label}
      </div>
      <div className="mt-1 text-sm font-black">{value}</div>
    </div>
  );
}

function FocusedJobHero({
  selectedJob,
  spec,
  chips,
  customerName,
  orderNumber,
  templateName,
  plannerNote,
  stepName,
  behavior,
  targetKg,
  producedKg,
  remainingKg,
  yieldPct,
  progressPct,
}: any) {
  if (!selectedJob) {
    return (
      <section className="overflow-hidden rounded-[20px] bg-gradient-to-br from-surface-3 to-surface-3 p-6 text-white shadow-[0_26px_70px_-42px_rgba(15,23,42,0.65)]">
        <div className="text-[11px] font-black uppercase tracking-[0.22em] text-content-4">
          Idle
        </div>
        <div className="mt-2 text-2xl font-black">No job selected</div>
        <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-content-4">
          Choose a released job from the queue drawer. This terminal starts the
          machine step, logs output, and captures returns or scrap for material
          already issued upstream.
        </p>
      </section>
    );
  }

  const jobNumber = firstNonEmpty(
    selectedJob?.job_number,
    selectedJob?.number,
    "Job",
  );
  const priority = firstNonEmpty(
    selectedJob?.priority,
    selectedJob?.priority_score,
  );
  const displayChips = chips?.length
    ? chips
    : [
        {
          label: spec?.size?.label || "Size not captured",
          tone: "border-surface-1/20 bg-surface-1/10 text-white",
        },
      ];
  const safeProgress = Math.max(0, Math.min(100, progressPct));
  const gaugeStyle = {
    background: `conic-gradient(#10b981 ${safeProgress}%, rgba(255,255,255,0.18) 0)`,
  } as any;

  return (
    <section
      className="overflow-hidden rounded-[20px] bg-gradient-to-br from-surface-3 via-surface-3 to-order-fg p-5 text-white shadow-[0_26px_70px_-42px_rgba(15,23,42,0.65)]"
      data-testid="machine-job-briefing"
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_150px]">
        <div className="min-w-0">
          <div className="text-[11px] font-black uppercase tracking-[0.22em] text-order-border">
            Now selected · {jobNumber} · {orderNumber}
          </div>
          <h2 className="mt-1 break-words text-2xl font-black tracking-tight md:text-3xl">
            {spec?.productName || templateName}
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm font-semibold text-order-border">
            <span>{customerName}</span>
            <span className="text-order-border">/</span>
            <span>{stepName}</span>
            <span className="text-order-border">/</span>
            <span>{behaviorLabel(behavior)}</span>
            {priority ? (
              <span className="rounded-full bg-warning-fg px-2.5 py-1 text-[11px] font-black text-warning-border ring-1 ring-warning-border">
                Priority {priority}
              </span>
            ) : null}
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {displayChips.map((chip: any) => (
              <span
                key={chip.label}
                className="inline-flex min-h-7 items-center rounded-full bg-surface-1/12 px-3 py-1 text-[11px] font-black text-white ring-1 ring-surface-1/20"
              >
                {chip.label}
              </span>
            ))}
          </div>
          {plannerNote ? (
            <div className="mt-3 rounded-xl bg-surface-1/10 px-3 py-2 text-xs font-semibold leading-5 text-order-border ring-1 ring-surface-1/15">
              Planner note: {plannerNote}
            </div>
          ) : null}
          <div className="mt-4 grid gap-2 sm:grid-cols-4">
            <HeroMetric label="Target" value={kg(targetKg, 1)} />
            <HeroMetric
              label="Produced"
              value={kg(producedKg, 1)}
              tone="emerald"
            />
            <HeroMetric label="Remaining" value={kg(remainingKg, 1)} />
            <HeroMetric label="Yield" value={`${yieldPct.toFixed(1)}%`} />
          </div>
        </div>
        <div className="flex flex-row items-center justify-between gap-3 lg:flex-col lg:items-end">
          <ArtworkButton
            artworkId={selectedJob?.committed_artwork_id || null}
            artworkCode={selectedJob?.committed_artwork_code || null}
            artworkName={selectedJob?.committed_artwork_name || null}
          />
          <div
            className="grid h-28 w-28 place-items-center rounded-full p-2"
            style={gaugeStyle}
          >
            <div className="grid h-full w-full place-items-center rounded-full bg-surface-1 text-center text-content-1">
              <div>
                <div className="font-mono text-2xl font-black">
                  {Math.round(safeProgress)}%
                </div>
                <div className="text-[9px] font-black uppercase tracking-wider text-content-3">
                  Done
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function HeroMetric({
  label,
  value,
  tone = "slate",
}: {
  label: string;
  value: string;
  tone?: "slate" | "emerald";
}) {
  return (
    <div className="rounded-xl bg-surface-1/10 p-3 ring-1 ring-surface-1/10">
      <div className="text-[9px] font-black uppercase tracking-[0.18em] text-order-border">
        {label}
      </div>
      <div
        className={cn(
          "mt-1 break-words font-mono text-lg font-black text-white",
          tone === "emerald" && "text-success-border",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function ReservationSummaryCard({
  reservedInputKg,
  consumedInputKg,
  heldInputKg,
  reservedRolls,
  materialRows,
}: any) {
  const pct =
    reservedInputKg > 0
      ? Math.max(0, Math.min(100, (consumedInputKg / reservedInputKg) * 100))
      : 0;
  const issuedQty = materialRows.reduce(
    (sum: number, row: MaterialReleaseRow) =>
      sum +
      toNumber(row.issuedQty || row.plannedIssueQty || row.requiredQty, 0),
    0,
  );
  return (
    <section
      className={cn(surfaceClass, "p-4")}
      data-testid="machine-reserved-material-card"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className={labelClass}>Reserved / issued material</div>
          <div className="mt-1 text-base font-black text-content-1">
            Upstream release truth
          </div>
        </div>
        <span className="rounded-full border border-success-border bg-success-bg px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-success-fg">
          Read only issue
        </span>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl border border-line bg-surface-2 p-2">
          <div className="font-mono text-sm font-black">
            {kg(reservedInputKg, 1)}
          </div>
          <div className="mt-1 text-[9px] font-black uppercase tracking-wider text-content-4">
            Reserved
          </div>
        </div>
        <div className="rounded-xl border border-success-border bg-success-bg p-2">
          <div className="font-mono text-sm font-black text-success-fg">
            {kg(consumedInputKg, 1)}
          </div>
          <div className="mt-1 text-[9px] font-black uppercase tracking-wider text-success-fg">
            Consumed
          </div>
        </div>
        <div className="rounded-xl border border-warning-border bg-warning-bg p-2">
          <div className="font-mono text-sm font-black text-warning-fg">
            {kg(heldInputKg, 1)}
          </div>
          <div className="mt-1 text-[9px] font-black uppercase tracking-wider text-warning-fg">
            Held
          </div>
        </div>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full bg-success-fg"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-bold text-content-3">
        <span>{reservedRolls.length} reserved rolls</span>
        <span className="text-content-4">/</span>
        <span>{materialRows.length} bulk or ink rows</span>
        <span className="text-content-4">/</span>
        <span>{kg(issuedQty, 1)} issued qty shown</span>
      </div>
    </section>
  );
}

function InputFeedCard({
  reservedRolls,
  wipRolls,
  materialRows,
  materialConfirmations,
  updateMaterialConfirmation,
  inkTargetOptions,
  contextLoading,
}: {
  reservedRolls: any[];
  wipRolls: any[];
  materialRows: MaterialReleaseRow[];
  materialConfirmations: Record<string, MaterialConfirmationDraft>;
  updateMaterialConfirmation: (
    requirementId: string,
    patch: Partial<MaterialConfirmationDraft>,
  ) => void;
  inkTargetOptions: Array<{ id: string; name: string; code?: string }>;
  contextLoading: boolean;
}) {
  return (
    <section
      className={cn(surfaceClass, "min-w-0 overflow-hidden")}
      data-testid="machine-material-release-card"
    >
      <div className="border-b border-line bg-surface-1 px-4 py-3">
        <div className={labelClass}>Inputs (read only)</div>
        <div className="mt-0.5 text-base font-black text-content-1">
          WCM issued material
        </div>
        <div className="mt-1 text-[11px] font-semibold leading-4 text-content-3">
          Issue happens upstream. This terminal only confirms returns, scrap,
          and output.
        </div>
      </div>
      <div className="max-h-[760px] space-y-4 overflow-y-auto p-4">
        <div>
          <div className="mb-2 flex items-center justify-between">
            <div className={labelClass}>Reserved input rolls</div>
            <span className="font-mono text-[11px] font-bold text-content-3">
              {reservedRolls.length} rows
            </span>
          </div>
          <div className="space-y-2">
            {reservedRolls.length ? (
              reservedRolls.map((roll) => (
                <div
                  key={roll.id}
                  className="rounded-xl border border-line bg-surface-2 p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="break-words font-mono text-xs font-black text-content-1">
                        {roll.label_id || roll.id}
                      </div>
                      <div className="mt-0.5 break-words text-[11px] font-semibold text-content-3">
                        {roll.material_name}
                      </div>
                    </div>
                    <div className="shrink-0 font-mono text-sm font-black">
                      {kg(roll.weight_kg)}
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className="rounded bg-surface-1 px-2 py-1 text-[10px] font-bold text-content-3">
                      {toNumber(roll.width_mm, 0).toFixed(0)} mm
                    </span>
                    <span className="rounded bg-surface-1 px-2 py-1 text-[10px] font-bold text-content-3">
                      {toNumber(roll.thickness_micron, 0).toFixed(1)} um
                    </span>
                    <span className="rounded bg-surface-1 px-2 py-1 text-[10px] font-bold text-content-3">
                      {roll.grade || "-"}
                    </span>
                    <StockFormPills roll={roll} />
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-lg border border-dashed border-line bg-surface-2 p-3 text-center text-xs italic text-content-3">
                No reserved input roll is visible for this step.
              </div>
            )}
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <div className={labelClass}>Issued bulk / ink</div>
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wider",
                contextLoading
                  ? "border-warning-border bg-warning-bg text-warning-fg"
                  : "border-success-border bg-success-bg text-success-fg",
              )}
            >
              {contextLoading ? "Syncing" : `${materialRows.length} items`}
            </span>
          </div>
          <div className="space-y-2">
            {materialRows.length ? (
              materialRows.map((row) => {
                const draft = materialConfirmations[row.requirement_id] || {
                  requirement_id: row.requirement_id,
                  material_id: row.material_id,
                  actual_issued_qty:
                    row.issuedQty > 0 ? row.issuedQty.toFixed(3) : "",
                  actual_returned_qty: row.returnedQty.toFixed(3),
                  actual_scrap_qty: row.scrapQty.toFixed(3),
                  is_estimated: true,
                  return_mode: "EXACT_COLOR_RETURN" as const,
                  granule_code_allocations: [],
                };
                return (
                  <div
                    key={row.requirement_id}
                    className="rounded-xl border border-line bg-surface-1 p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="break-words text-sm font-black text-content-1">
                          {row.name}
                        </div>
                        <div className="mt-0.5 flex flex-wrap gap-1.5 text-[10px] font-bold uppercase tracking-wider text-content-3">
                          {row.code ? <span>{row.code}</span> : null}
                          {row.category ? <span>{row.category}</span> : null}
                          <span>{row.captureMode.replaceAll("_", " ")}</span>
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div
                          className="font-mono text-sm font-black text-content-1"
                          data-testid={`machine-material-issued-${row.requirement_id}`}
                        >
                          {qtyLabel(
                            row.issuedQty ||
                              row.plannedIssueQty ||
                              row.requiredQty,
                            row.uom,
                          )}
                        </div>
                        <div className="text-[10px] font-bold uppercase tracking-wider text-content-4">
                          issued
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-center">
                      <div className="rounded-lg border border-line bg-surface-2 px-2 py-1.5">
                        <div className="font-mono text-xs font-black">
                          {qtyLabel(row.requiredQty, row.uom, 3)}
                        </div>
                        <div className="text-[9px] font-bold uppercase tracking-wider text-content-4">
                          Required
                        </div>
                      </div>
                      <div className="rounded-lg border border-line bg-surface-2 px-2 py-1.5">
                        <div className="font-mono text-xs font-black text-success-fg">
                          {qtyLabel(row.availableQty, row.uom, 3)}
                        </div>
                        <div className="text-[9px] font-bold uppercase tracking-wider text-content-4">
                          At source
                        </div>
                      </div>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <InlineNumber
                        label="Returned"
                        value={draft.actual_returned_qty}
                        testId={`machine-material-returned-${row.requirement_id}`}
                        onChange={(value) =>
                          updateMaterialConfirmation(row.requirement_id, {
                            material_id: row.material_id,
                            actual_returned_qty: value,
                            is_estimated: false,
                          })
                        }
                      />
                      <InlineNumber
                        label="Material scrap"
                        value={draft.actual_scrap_qty}
                        testId={`machine-material-scrap-${row.requirement_id}`}
                        onChange={(value) =>
                          updateMaterialConfirmation(row.requirement_id, {
                            material_id: row.material_id,
                            actual_scrap_qty: value,
                            is_estimated: false,
                          })
                        }
                      />
                    </div>
                    {row.category === "INK" ? (
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        <div>
                          <Label className={labelClass}>Return mode</Label>
                          <Select
                            value={draft.return_mode || "EXACT_COLOR_RETURN"}
                            onValueChange={(value) =>
                              updateMaterialConfirmation(row.requirement_id, {
                                material_id: row.material_id,
                                return_mode:
                                  value as MaterialConfirmationDraft["return_mode"],
                                is_estimated: false,
                              })
                            }
                          >
                            <SelectTrigger
                              className={cn(inputClass, "mt-1")}
                              data-testid={`machine-material-return-mode-${row.requirement_id}`}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="EXACT_COLOR_RETURN">
                                Exact color return
                              </SelectItem>
                              <SelectItem value="REMIXED_RETURN">
                                Remixed return
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        {draft.return_mode === "REMIXED_RETURN" ? (
                          <div>
                            <Label className={labelClass}>Target ink</Label>
                            <Select
                              value={
                                draft.target_ink_material_id || SELECT_NONE
                              }
                              onValueChange={(value) =>
                                updateMaterialConfirmation(row.requirement_id, {
                                  material_id: row.material_id,
                                  target_ink_material_id:
                                    value === SELECT_NONE ? undefined : value,
                                  is_estimated: false,
                                })
                              }
                            >
                              <SelectTrigger
                                className={cn(inputClass, "mt-1")}
                                data-testid={`machine-material-target-ink-${row.requirement_id}`}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={SELECT_NONE}>
                                  Select target ink
                                </SelectItem>
                                {inkTargetOptions
                                  .filter(
                                    (option) =>
                                      String(option.id) !==
                                      String(row.material_id),
                                  )
                                  .map((option) => (
                                    <SelectItem
                                      key={option.id}
                                      value={option.id}
                                    >
                                      {option.name}
                                      {option.code ? ` · ${option.code}` : ""}
                                    </SelectItem>
                                  ))}
                              </SelectContent>
                            </Select>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })
            ) : (
              <div className="rounded-lg border border-dashed border-line bg-surface-2 p-3 text-center text-xs italic text-content-3">
                No issued bulk material is required for this step.
              </div>
            )}
          </div>
        </div>

        {wipRolls.length ? (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <div className={labelClass}>WIP pool</div>
              <span className="font-mono text-[11px] font-bold text-content-3">
                {wipRolls.length} rows
              </span>
            </div>
            <div className="space-y-2">
              {wipRolls.slice(0, 4).map((roll) => (
                <div
                  key={roll.id}
                  className="rounded-xl border border-line bg-surface-2 p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="break-words font-mono text-xs font-black text-content-1">
                        {roll.label_id || roll.id}
                      </div>
                      <div className="mt-0.5 break-words text-[11px] font-semibold text-content-3">
                        {roll.material_name}
                      </div>
                    </div>
                    <div className="shrink-0 font-mono text-sm font-black">
                      {kg(roll.weight_kg)}
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className="rounded bg-surface-1 px-2 py-1 text-[10px] font-bold text-content-3">
                      {toNumber(roll.width_mm, 0).toFixed(0)} mm
                    </span>
                    <StockFormPills roll={roll} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function TelemetryPanel({
  events,
  loading,
  inventoryCounters,
  producedKg,
  targetKg,
  remainingKg,
  nextAction,
  allocationReady,
  shortage,
  contextLoading,
  reservedInputKg,
  consumedInputKg,
  heldInputKg,
  onRefresh,
}: any) {
  const bulkConsumedKg = toNumber(inventoryCounters?.bulk_consumed_kg, 0);
  const rollsConsumedKg = toNumber(inventoryCounters?.rolls_consumed_kg, 0);
  const rollsConsumedCount = toNumber(
    inventoryCounters?.rolls_consumed_count,
    0,
  );
  const rollsCreatedKg = toNumber(inventoryCounters?.rolls_created_kg, 0);
  const rollsCreatedCount = toNumber(inventoryCounters?.rolls_created_count, 0);
  const scrapKg = toNumber(
    inventoryCounters?.scrap_kg ?? inventoryCounters?.scrap_total_kg,
    0,
  );
  const fallbackLiveLogs = Array.isArray(inventoryCounters?.live_logs)
    ? inventoryCounters.live_logs.map((row: any, index: number) => ({
        id: `live-${index}-${row?.timestamp || row?.type || index}`,
        type: row?.type || "LOG",
        ts: row?.timestamp || row?.ts || null,
        quantity: row?.quantity ?? row?.quantity_kg,
        uom: row?.uom || "KG",
        label: row?.roll_label || row?.label,
        reason: row?.reason,
        material: row?.material,
        granule_code: row?.granule_code,
      }))
    : [];
  const visibleEvents =
    Array.isArray(events) && events.length ? events : fallbackLiveLogs;
  return (
    <section className={cn(surfaceClass, "min-w-0 overflow-hidden")}>
      <div className="border-b border-line bg-surface-1 px-4 py-3">
        <div className={labelClass}>Live consumption / telemetry</div>
        <div className="mt-0.5 text-base font-black text-content-1">
          Current step truth
        </div>
      </div>
      <div className="space-y-3 p-4">
        <TelemetryMetric label="Bulk consumed" value={kg(bulkConsumedKg)} />
        <TelemetryMetric
          label="Rolls consumed"
          value={`${rollsConsumedCount} rolls · ${kg(rollsConsumedKg)}`}
        />
        <TelemetryMetric
          label="Rolls created"
          value={`${rollsCreatedCount} rolls · ${kg(rollsCreatedKg)}`}
        />
        <TelemetryMetric
          label="Scrap"
          value={kg(scrapKg)}
          tone={scrapKg > 0 ? "rose" : "slate"}
        />
        <div className="grid grid-cols-2 gap-2">
          <TelemetryMetric
            label="Input ready"
            value={contextLoading ? "..." : allocationReady ? "Yes" : "No"}
            tone={allocationReady ? "slate" : "rose"}
          />
          <TelemetryMetric label="Roll shortage" value={String(shortage)} />
          <TelemetryMetric
            label="Step progress"
            value={`${kg(producedKg)} / ${kg(targetKg)}`}
          />
          <TelemetryMetric label="Remaining" value={kg(remainingKg)} />
        </div>
        <div
          className="rounded-xl border border-info-border bg-info-bg p-3"
          data-testid="machine-reservation-usage"
        >
          <div className={cn(labelClass, "text-primary")}>
            Reservation usage
          </div>
          <div className="mt-2 text-xs font-semibold leading-5 text-primary">
            Reserved {kg(reservedInputKg, 1)} · consumed{" "}
            {kg(consumedInputKg, 1)} · {kg(heldInputKg, 1)} held
          </div>
        </div>
        <div className="rounded-xl border border-line bg-surface-2 p-3">
          <div className={labelClass}>Next action</div>
          <div className="mt-1 text-sm font-black leading-5 text-content-1">
            {nextAction}
          </div>
        </div>
        <div className="rounded-xl border border-line bg-surface-1 p-3">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <div className={labelClass}>Live logs</div>
              <div className="text-sm font-black text-content-1">Last 20</div>
            </div>
            <span className="flex items-center gap-1.5 text-[10px] font-semibold text-content-3">
              <span className="h-2 w-2 rounded-full bg-success-fg" />
              poll 5s
            </span>
          </div>
          <div className="space-y-1.5">
            {loading ? (
              <div className="rounded-lg border border-line bg-surface-2 p-3 text-xs font-semibold text-content-3">
                Loading events...
              </div>
            ) : visibleEvents.length ? (
              visibleEvents.slice(0, 8).map((event: MachineJobEvent | any) => {
                const details = eventDetailParts(event);
                return (
                <div
                  key={event.id}
                  className={cn(
                    "rounded-lg border px-2.5 py-2 text-xs",
                    eventToneClass(event),
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-black text-content-1">
                      {eventTitle(event)}
                    </span>
                    <span className="font-mono text-[10px] text-content-3">
                      {formatTime(event.ts || event.timestamp)}
                    </span>
                  </div>
                  {event.label ? (
                    <div className="mt-0.5 text-[11px] font-semibold text-content-3">
                      {event.label}
                    </div>
                  ) : null}
                  {details.length ? (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {details.map((detail) => (
                        <span
                          key={detail}
                          className="rounded-md border border-line bg-surface-1 px-1.5 py-0.5 font-mono text-[10px] font-bold text-content-3 shadow-sm"
                        >
                          {detail}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
                );
              })
            ) : (
              <div className="rounded-lg border border-dashed border-line bg-surface-2 p-3 text-center text-xs font-semibold text-content-3">
                No events yet.
              </div>
            )}
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          className="h-10 w-full rounded-[12px] bg-surface-1 text-sm font-semibold"
          onClick={onRefresh}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>
    </section>
  );
}

function eventTitle(event: any) {
  const type = String(event?.type || "LOG").replaceAll("_", " ");
  if (
    String(event?.type || "").toUpperCase() === "CONSUMPTION" &&
    String(event?.material || "").toUpperCase().includes("INK")
  ) {
    return "INK CONSUMPTION";
  }
  return type;
}

function eventToneClass(event: any) {
  const type = String(event?.type || "").toUpperCase();
  if (type.includes("SCRAP"))
    return "border-danger-border bg-danger-bg";
  if (type.includes("DOWNTIME"))
    return "border-warning-border bg-warning-bg";
  if (type.includes("OUTPUT"))
    return "border-success-border bg-success-bg";
  if (type.includes("CONSUMPTION")) return "border-info-border bg-info-bg";
  if (type.includes("QUALITY") && event?.in_spec === false)
    return "border-danger-border bg-danger-bg";
  return "border-line bg-surface-2";
}

function eventDetailParts(event: any) {
  const parts: string[] = [];
  const qty = toNullableNumber(
    event?.quantity ??
      event?.quantity_kg ??
      event?.actual_qty ??
      event?.output_qty_kg,
  );
  const uom = String(event?.uom || "KG").toUpperCase();
  if (qty !== null && qty > 0)
    parts.push(
      uom === "KG"
        ? kg(qty)
        : `${qty.toFixed(uom === "PCS" ? 0 : 3)} ${uom.toLowerCase()}`,
    );
  const pcs = toNullableNumber(event?.output_pcs ?? event?.pcs);
  if (pcs !== null && pcs > 0) parts.push(`${pcs.toFixed(0)} pcs`);
  if (event?.material) parts.push(String(event.material));
  if (event?.granule_code) parts.push(String(event.granule_code));
  if (event?.roll_label) parts.push(String(event.roll_label));
  if (event?.reason) parts.push(String(event.reason));
  if (event?.parameter) parts.push(`${event.parameter}: ${event?.value ?? "-"}`);
  if (event?.duration_min)
    parts.push(`${toNumber(event.duration_min, 0).toFixed(0)} min`);
  if (event?.in_spec === false) parts.push("out of spec");
  if (event?.in_spec === true) parts.push("in spec");
  return parts.slice(0, 6);
}

function TelemetryMetric({
  label,
  value,
  tone = "slate",
}: {
  label: string;
  value: string;
  tone?: "slate" | "rose";
}) {
  return (
    <div className="rounded-xl border border-line bg-surface-2 p-3">
      <div className={labelClass}>{label}</div>
      <div
        className={cn(
          "mt-1 break-words font-mono text-base font-black",
          tone === "rose" ? "text-danger-fg" : "text-content-1",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function StockFormPills({ roll }: { roll: any }) {
  const form = normalizeStockForm(roll?.stock_form);
  const basis = roll?.width_basis || widthBasisForStockForm(form);
  return (
    <>
      <span className="rounded bg-info-bg px-2 py-1 text-[10px] font-bold text-info-fg ring-1 ring-info-border">
        {stockFormLabel(form)}
      </span>
      <span className="rounded bg-info-bg px-2 py-1 text-[10px] font-bold text-info-fg ring-1 ring-info-border">
        {widthBasisLabel(basis, form)}
      </span>
    </>
  );
}

function QueueRail({
  visibleQueueItems,
  queueItems,
  selectedId,
  queueSearch,
  setQueueSearch,
  queueStatusFilter,
  setQueueStatusFilter,
  setSelectedJobId,
  refreshAll,
}: any) {
  return (
    <section className={cn(surfaceClass, "p-4")} id="machine-queue-rail">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className={labelClass}>Queue</div>
          <div className="mt-0.5 text-base font-black">
            {visibleQueueItems.length} visible
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 rounded-[10px] bg-surface-1"
          onClick={() => refreshAll()}
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-4" />
        <Input
          value={queueSearch}
          onChange={(event) => setQueueSearch(event.target.value)}
          placeholder="Search customer, size, grade"
          className={cn(inputClass, "pl-9")}
        />
      </div>
      <div className="mb-3 grid grid-cols-2 gap-1.5 text-xs">
        {(
          [
            ["ALL", "All"],
            ["RUNNING", "Run"],
            ["READY", "Ready"],
            ["PAUSED", "Hold"],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value}
            type="button"
            variant="outline"
            className={cn(
              "h-9 rounded-full text-xs font-semibold",
              queueStatusFilter === value
                ? "border-transparent bg-gradient-to-br from-info-fg to-primary text-white"
                : "border-line bg-surface-1 text-content-2",
            )}
            onClick={() => setQueueStatusFilter(value)}
          >
            {label}
          </Button>
        ))}
      </div>
      <div className="max-h-[calc(100vh-430px)] space-y-2 overflow-y-auto pr-1">
        {visibleQueueItems.length ? (
          visibleQueueItems.map((job: any) => {
            const spec = normalizeProductSpec(job);
            const selected = String(job.id) === String(selectedId);
            return (
              <button
                key={job.id}
                type="button"
                data-testid={`machine-job-card-${job.id}`}
                className={cn(
                  "w-full rounded-[14px] border p-3 text-left transition",
                  selected
                    ? "border-primary bg-gradient-to-b from-info-bg to-surface-1 shadow-[0_8px_18px_-10px_rgba(59,130,246,0.4)]"
                    : "border-line bg-surface-1 hover:border-primary",
                )}
                onClick={() => setSelectedJobId(String(job.id))}
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <div className="truncate text-sm font-semibold">
                    {spec.customerName}
                  </div>
                  <span
                    className={cn(
                      "rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase",
                      stateBadgeClass(job.job_state),
                    )}
                  >
                    {job.job_state || "ready"}
                  </span>
                </div>
                <div className="mb-1 break-words font-mono text-[11px] text-content-3">
                  {job.job_number} · {spec.productName} ·{" "}
                  {kg(job.step_remaining_kg ?? job.quantity, 0)}
                </div>
                <div className="mt-1 rounded-lg border border-info-border bg-info-bg p-2 text-[11px]">
                  <div className="font-semibold text-primary">
                    {spec.size?.label || "Size not captured"}
                  </div>
                  <div className="font-mono text-content-3">
                    {(spec.layers || [])
                      .slice(0, 2)
                      .map((layer: any) => layer.label)
                      .join(" · ") ||
                      job.process_code ||
                      "Step"}
                  </div>
                </div>
              </button>
            );
          })
        ) : (
          <div className="rounded-[14px] border border-dashed border-line bg-surface-2 p-5 text-center text-xs font-semibold text-content-3">
            {queueItems.length
              ? "No jobs match this filter."
              : "No released jobs are waiting here."}
          </div>
        )}
      </div>
    </section>
  );
}

function RouteStepper({
  stepName,
  stepTransform,
  behavior,
  jobState,
  isExecuting,
  isPaused,
  allocationReady,
  producedKg,
  remainingKg,
  targetKg,
  progressPct,
  canStart,
  canLogOutput,
  canComplete,
  nextAction,
  routeSteps = [],
}: any) {
  const hasJob = Boolean(jobState);
  const statusLabel = !hasJob
    ? "Waiting for job"
    : isExecuting
      ? "Running live"
      : isPaused
        ? "Paused"
        : canStart
          ? "Ready to start"
          : jobState;
  const statusTone = !hasJob
    ? "border-line bg-surface-2 text-content-3"
    : isExecuting
      ? "border-info-border bg-info-bg text-primary"
      : isPaused
        ? "border-warning-border bg-warning-bg text-warning-fg"
        : canStart
          ? "border-success-border bg-success-bg text-success-fg"
          : "border-line bg-surface-1 text-content-2";
  const nextLabel = !hasJob
    ? "Select released job"
    : !allocationReady
      ? "Reserve input"
      : canStart
        ? "Start job"
        : isPaused
          ? "Resume job"
          : canLogOutput
            ? "Log output"
            : canComplete
              ? "Complete step"
              : nextAction;
  return (
    <section className={cn(surfaceClass, "p-4 md:p-5")}>
      <div className="mb-4 grid gap-3 lg:grid-cols-[1fr_auto] lg:items-start">
        <div>
          <div className={labelClass}>Current status</div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-3 py-1.5 text-sm font-black",
                statusTone,
              )}
            >
              {statusLabel}
            </span>
            <span className="inline-flex items-center rounded-full border border-warning-border bg-warning-bg px-3 py-1.5 text-sm font-black text-warning-fg">
              Remaining {kg(remainingKg)}
            </span>
            <span className="inline-flex items-center rounded-full border border-info-border bg-info-bg px-3 py-1.5 text-sm font-black text-info-fg">
              Next · {nextLabel}
            </span>
          </div>
        </div>
        <div className="min-w-[170px] rounded-[16px] border border-line bg-surface-1 p-3 shadow-sm">
          <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.18em] text-content-4">
            <span>Progress</span>
            <span>{Math.round(progressPct)}%</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-gradient-to-r from-info-fg to-success-fg"
              style={{ width: `${Math.max(0, Math.min(100, progressPct))}%` }}
            />
          </div>
          <div className="mt-2 text-xs font-semibold text-content-3">
            {kg(producedKg)} / {kg(targetKg)}
          </div>
        </div>
      </div>
      <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className={labelClass}>Live route</div>
          <div className="text-xs font-semibold text-content-3">
            Upstream done, current process live, downstream pending.
          </div>
        </div>
        <span className="inline-flex w-fit rounded-full border border-line bg-surface-2 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-content-3">
          {stepName} · {behaviorLabel(behavior)}
        </span>
      </div>
      <ProcessRouteStrip
        routeSteps={routeSteps}
        remainingKg={remainingKg}
        producedKg={producedKg}
        behavior={behavior}
        fallbackName={stepName}
        fallbackTransform={stepTransform}
      />
    </section>
  );
}

function ProcessRouteStrip({
  routeSteps,
  remainingKg,
  producedKg,
  behavior,
  fallbackName,
  fallbackTransform,
}: any) {
  const steps: any[] =
    Array.isArray(routeSteps) && routeSteps.length
      ? routeSteps
      : [
          {
            sequence: 1,
            name: fallbackName || "Current step",
            state: "current",
            transform: fallbackTransform || "",
            isCurrent: true,
          },
        ];
  return (
    <div className="overflow-x-auto" data-testid="machine-process-route">
      <div className="flex min-w-max items-stretch gap-2">
        {steps.map((step: any, index: number) => (
          <div
            key={`${step.sequence}-${step.name}`}
            className="flex items-center gap-2"
          >
            <div
              className={cn(
                "flex min-h-[78px] min-w-[140px] flex-col justify-between rounded-[14px] border px-3 py-2.5 transition",
                step.state === "done" &&
                  "border-success-border bg-success-bg text-success-fg",
                step.state === "current" &&
                  "border-transparent bg-gradient-to-br from-info-fg to-primary text-white shadow-[0_14px_28px_-18px_rgba(37,99,235,0.9)]",
                step.state === "pending" &&
                  "border-line bg-surface-2 text-content-3",
              )}
              data-state={step.state}
            >
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-black",
                    step.state === "current"
                      ? "bg-surface-1 text-info-fg"
                      : step.state === "done"
                        ? "bg-success-fg text-white"
                        : "bg-line text-content-3",
                  )}
                >
                  {step.state === "done" ? "✓" : step.sequence}
                </span>
                <span className="truncate text-sm font-black leading-tight">
                  {step.name}
                </span>
              </div>
              <div
                className={cn(
                  "mt-1.5 text-[11px] font-semibold leading-4",
                  step.state === "current" ? "text-white/85" : "text-content-3",
                )}
              >
                {step.isCurrent
                  ? `${step.transform || "current"}${behavior && behavior !== "NONE" ? ` · ${behaviorLabel(behavior)}` : ""}`
                  : step.state === "done"
                    ? "Completed"
                    : "Pending"}
              </div>
              {step.isCurrent ? (
                <div className="mt-1 inline-flex w-fit items-center rounded-md bg-surface-1/20 px-1.5 py-0.5 font-mono text-[10px] font-bold">
                  {remainingKg > 0
                    ? `${kg(remainingKg, 1)} left`
                    : `${kg(producedKg, 1)} done`}
                </div>
              ) : null}
            </div>
            {index < steps.length - 1 ? (
              <span className="shrink-0 text-content-4">→</span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function ProcessLogForm(props: any) {
  const {
    variant,
    showPcsEntry,
    outputCaptureMode,
    supportsDiscreteOutputRolls,
    outputEntryMode,
    setOutputEntryMode,
    outputWeightKg,
    handleOutputWeightChange,
    outputPcs,
    handleOutputPcsChange,
    unitWeightG,
    outputWidthMm,
    setOutputWidthMm,
    outputStockForm,
    setOutputStockForm,
    targetStockContract,
    outputLengthM,
    setOutputLengthM,
    outputTareKg,
    outputGrossKg,
    updatePrimaryRollGrossTare,
    rollSetupCount,
    setRollSetupCount,
    rollSetupTareKg,
    setRollSetupTareKg,
    generateCreateRollRows,
    createRollRows,
    addCreateRollRow,
    updateCreateRow,
    removeCreateRow,
    autoSplitEqual,
    splitRows,
    addSplitRow,
    updateSplitRow,
    removeSplitRow,
    reservedRolls,
    reservedInputTotalKg = 0,
    maxOutputWithScrapKg = 0,
    wasteKgValue = 0,
    previewOutputKg,
    previewOutputPcs,
    trimInput,
    setTrimInput,
    scrapInput,
    setScrapInput,
    scrapEntryMode,
    setScrapEntryMode,
    remainderLocations,
    remainderLocationId,
    setRemainderLocationId,
    reconcilableBulkRows,
    behavior,
    currentOutputForm,
  } = props;
  // Remainder roll is created whenever input is consumed but output + waste < input.
  const remainderKgEstimate = Math.max(
    0,
    toNumber(reservedInputTotalKg, 0) -
      toNumber(previewOutputKg, 0) -
      toNumber(wasteKgValue, 0),
  );
  const showRemainderPicker =
    toNumber(reservedInputTotalKg, 0) > 0 && remainderKgEstimate > 0.001;
  const activeOutputForm = normalizeStockForm(
    outputStockForm || targetStockContract?.stock_form,
  );
  const activeWidthBasis =
    targetStockContract?.width_basis ||
    widthBasisForStockForm(activeOutputForm);
  const showStockFormControl =
    String(currentOutputForm || "").toUpperCase() === "ROLL" &&
    variant !== "pouching";

  return (
    <div className="space-y-4">
      {variant === "pouching" ? (
        <div className="rounded-xl border border-line bg-surface-2 px-3 py-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className={labelClass}>Template output policy</div>
              <div className="text-xs font-semibold text-content-3">
                {showPcsEntry
                  ? unitWeightG > 0
                    ? `PCS and KG are linked at ${unitWeightG} g/pc.`
                    : "PCS is required by the template; enter KG carefully."
                  : "This template captures final pouch output in KG without mandatory PCS."}
              </div>
            </div>
            {showPcsEntry ? (
              <div className="flex gap-1">
                {(["PCS", "KG"] as EntryMode[]).map((mode) => (
                  <Button
                    key={mode}
                    type="button"
                    size="sm"
                    variant="outline"
                    className={cn(
                      "h-8 rounded-lg text-xs font-bold",
                      outputEntryMode === mode
                        ? "border-transparent bg-surface-3 text-white"
                        : "bg-surface-1",
                    )}
                    onClick={() => setOutputEntryMode(mode)}
                  >
                    {mode}
                  </Button>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-success-border bg-success-bg px-3 py-1 text-xs font-black uppercase tracking-[0.14em] text-success-fg">
                {outputCaptureModeLabel(outputCaptureMode)}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {showStockFormControl ? (
        <div
          className="rounded-xl border border-info-border bg-info-bg p-3"
          data-testid="machine-output-stock-form"
        >
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_240px] md:items-center">
            <div>
              <div className={cn(labelClass, "text-info-fg")}>
                Output stock form
              </div>
              <div className="mt-1 text-xs font-semibold leading-5 text-info-fg">
                This creates the next WIP roll as{" "}
                {stockFormLabel(activeOutputForm)}. Width is interpreted as{" "}
                {widthBasisLabel(activeWidthBasis, activeOutputForm)}.
              </div>
              {targetStockContract?.slit_policy ? (
                <div className="mt-1 text-[11px] font-bold uppercase tracking-wider text-info-fg">
                  Target policy ·{" "}
                  {String(targetStockContract.slit_policy).replaceAll("_", " ")}
                </div>
              ) : null}
            </div>
            <Select
              value={activeOutputForm}
              onValueChange={(value) => setOutputStockForm(value)}
            >
              <SelectTrigger
                className="h-11 rounded-[12px] border-info-border bg-surface-1 font-semibold text-info-fg"
                data-testid="machine-output-stock-form-select"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STOCK_FORM_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label} · {option.basis}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      ) : null}

      {variant === "slitting" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className={labelClass}>Input roll</Label>
            <Select value={reservedRolls[0]?.id || SELECT_NONE}>
              <SelectTrigger className={cn(inputClass, "mt-1 font-mono")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {reservedRolls.length ? (
                  reservedRolls.map((roll: any) => (
                    <SelectItem key={roll.id} value={roll.id}>
                      {roll.label_id} · {stockFormLabel(roll.stock_form)} ·{" "}
                      {kg(roll.weight_kg)}
                    </SelectItem>
                  ))
                ) : (
                  <SelectItem value={SELECT_NONE}>No roll reserved</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="rounded-lg border border-line bg-surface-2 p-3">
            <div className={labelClass}>Width math</div>
            <div className="mt-1 font-mono text-sm font-bold">
              {(reservedRolls[0]?.width_mm || 0).toFixed?.(0) || "0"} ={" "}
              {splitRows
                .map((row: SplitRow) => row.width_mm || "0")
                .join(" + ")}
            </div>
            <div className="mt-0.5 text-[11px] font-semibold text-success-fg">
              Checked before save by output cap.
            </div>
          </div>
        </div>
      ) : variant === "pouching" && showPcsEntry ? (
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <Label className={labelClass}>Input roll</Label>
            <Select value={reservedRolls[0]?.id || SELECT_NONE}>
              <SelectTrigger className={cn(inputClass, "mt-1 font-mono")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {reservedRolls.length ? (
                  reservedRolls.map((roll: any) => (
                    <SelectItem key={roll.id} value={roll.id}>
                      {roll.label_id} · {stockFormLabel(roll.stock_form)} ·{" "}
                      {kg(roll.weight_kg)}
                    </SelectItem>
                  ))
                ) : (
                  <SelectItem value={SELECT_NONE}>No roll reserved</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className={labelClass}>Good output PCS</Label>
            <div className="mt-1">
              <NumPadPopover
                value={outputPcs}
                onChange={handleOutputPcsChange}
                unit="pcs"
                step={1}
                decimals={0}
                label="Good output PCS"
                min={0}
                inputProps={{ "data-testid": "machine-output-pcs" } as any}
                inputClassName="h-10 text-base"
              />
            </div>
            <div className="mt-1 text-[10px] text-content-3">
              ≈ <b className="font-mono">{kg(previewOutputKg)}</b>
            </div>
          </div>
          <div>
            <Label className={labelClass}>Output kg</Label>
            <div className="mt-1">
              <NumPadPopover
                value={outputWeightKg}
                onChange={handleOutputWeightChange}
                unit="kg"
                step={1}
                decimals={3}
                label="Output KG"
                min={0}
                inputProps={{ "data-testid": "machine-output-weight" } as any}
                inputClassName="h-10"
              />
            </div>
          </div>
        </div>
      ) : variant === "pouching" ? (
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <Label className={labelClass}>Input roll</Label>
            <Select value={reservedRolls[0]?.id || SELECT_NONE}>
              <SelectTrigger className={cn(inputClass, "mt-1 font-mono")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {reservedRolls.length ? (
                  reservedRolls.map((roll: any) => (
                    <SelectItem key={roll.id} value={roll.id}>
                      {roll.label_id} · {stockFormLabel(roll.stock_form)} ·{" "}
                      {kg(roll.weight_kg)}
                    </SelectItem>
                  ))
                ) : (
                  <SelectItem value={SELECT_NONE}>No roll reserved</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className={labelClass}>Good output KG</Label>
            <div className="mt-1">
              <NumPadPopover
                value={outputWeightKg}
                onChange={handleOutputWeightChange}
                unit="kg"
                step={1}
                decimals={3}
                label="Good output KG"
                min={0}
                inputProps={{ "data-testid": "machine-output-weight" } as any}
                inputClassName="h-10 text-base"
              />
            </div>
          </div>
        </div>
      ) : supportsDiscreteOutputRolls ? (
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <Label className={labelClass}>Default output width</Label>
            <div className="mt-1">
              <NumPadPopover
                value={outputWidthMm}
                onChange={setOutputWidthMm}
                unit="mm"
                step={1}
                decimals={0}
                label="Default output width"
                min={0}
                inputProps={{ "data-testid": "machine-output-width" } as any}
                inputClassName="h-10"
              />
            </div>
          </div>
          <div>
            <Label className={labelClass}>Output length opt</Label>
            <div className="mt-1">
              <NumPadPopover
                value={outputLengthM}
                onChange={setOutputLengthM}
                unit="m"
                step={1}
                decimals={1}
                label="Output length"
                min={0}
                inputProps={{ "data-testid": "machine-output-length" } as any}
                inputClassName="h-10"
              />
            </div>
          </div>
          <div className="rounded-xl border border-success-border bg-success-bg px-3 py-2">
            <div className={cn(labelClass, "text-success-fg")}>
              Total produced
            </div>
            <div
              className="mt-1 font-mono text-lg font-black text-success-fg"
              data-testid="machine-roll-row-total"
            >
              {kg(previewOutputKg)}
            </div>
            <div className="text-[10px] font-semibold text-success-fg">
              From roll net rows only
            </div>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <Label className={labelClass}>
              {variant === "printing"
                ? "Throughput good qty"
                : "Total produced"}
            </Label>
            <div className="mt-1">
              <NumPadPopover
                value={outputWeightKg}
                onChange={handleOutputWeightChange}
                unit="kg"
                step={1}
                decimals={3}
                label={
                  variant === "printing"
                    ? "Throughput good qty"
                    : "Total produced"
                }
                min={0}
                inputProps={{ "data-testid": "machine-output-weight" } as any}
                inputClassName="h-10 text-base"
              />
            </div>
          </div>
          <div>
            <Label className={labelClass}>Output width</Label>
            <div className="mt-1">
              <NumPadPopover
                value={outputWidthMm}
                onChange={setOutputWidthMm}
                unit="mm"
                step={1}
                decimals={0}
                label="Output width"
                min={0}
                inputProps={{ "data-testid": "machine-output-width" } as any}
                inputClassName="h-10"
              />
            </div>
          </div>
          <div>
            <Label className={labelClass}>Output length opt</Label>
            <div className="mt-1">
              <NumPadPopover
                value={outputLengthM}
                onChange={setOutputLengthM}
                unit="m"
                step={1}
                decimals={1}
                label="Output length"
                min={0}
                inputProps={{ "data-testid": "machine-output-length" } as any}
                inputClassName="h-10"
              />
            </div>
          </div>
        </div>
      )}

      {supportsDiscreteOutputRolls ? (
        <div className="overflow-hidden rounded-xl border border-line">
          <div className="grid gap-3 border-b border-line bg-surface-2 p-3 2xl:grid-cols-[minmax(0,1fr)_auto] 2xl:items-end">
            <div>
              <div className={labelClass}>Roll outputs · auto labels</div>
              <div className="mt-0.5 text-xs text-content-3">
                {createRollRows.length + 1} roll rows · total net{" "}
                {kg(previewOutputKg)} · cap {kg(maxOutputWithScrapKg)}
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-[130px_150px_minmax(140px,auto)]">
                <NumPadCell
                  testId="machine-roll-count"
                  value={rollSetupCount}
                  onChange={setRollSetupCount}
                  decimals={0}
                  label="Number of rolls"
                  width="w-full"
                />
                <NumPadCell
                  testId="machine-roll-default-tare"
                  value={rollSetupTareKg}
                  onChange={setRollSetupTareKg}
                  decimals={3}
                  label="Default core tare (kg)"
                  width="w-full"
                />
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 rounded-[10px] bg-surface-1 text-xs font-semibold"
                  onClick={generateCreateRollRows}
                >
                  Generate rows
                </Button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 2xl:justify-end">
              <Button
                type="button"
                variant="outline"
                className="h-9 rounded-[10px] bg-surface-1 text-xs font-semibold"
                disabled={createRollRows.length < 1}
                onClick={() => autoSplitEqual(createRollRows.length + 1)}
              >
                Balance current rows
              </Button>
              <Button
                type="button"
                className="h-9 rounded-[10px] bg-gradient-to-br from-info-fg to-primary text-xs font-semibold text-white"
                data-testid="machine-add-create-row"
                onClick={addCreateRollRow}
              >
                <Plus className="mr-1 h-3 w-3" />
                Add roll
              </Button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-[10px] uppercase tracking-wider text-content-3">
                <tr>
                  <th className="p-2 pl-4 text-left">#</th>
                  <th className="p-2 text-left">Label</th>
                  <th className="p-2 text-right">Gross</th>
                  <th className="p-2 text-right">Core tare</th>
                  <th className="p-2 text-right">Net auto</th>
                  <th className="p-2 text-right">Width</th>
                  <th className="p-2 text-right">Length</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-line">
                  <td className="p-2 pl-4 font-mono text-xs text-content-3">
                    1
                  </td>
                  <td className="p-2 font-mono text-xs font-semibold">
                    Auto label on save
                  </td>
                  <td className="p-2 text-right">
                    <NumPadCell
                      testId="machine-create-row-gross-0"
                      value={outputGrossKg}
                      onChange={(value) =>
                        updatePrimaryRollGrossTare("gross_weight_kg", value)
                      }
                      decimals={3}
                      label="Gross weight (kg)"
                      width="w-28"
                    />
                  </td>
                  <td className="p-2 text-right">
                    <NumPadCell
                      testId="machine-create-row-tare-0"
                      value={outputTareKg}
                      onChange={(value) =>
                        updatePrimaryRollGrossTare("tare_weight_kg", value)
                      }
                      decimals={3}
                      label="Core tare (kg)"
                      width="w-24"
                    />
                  </td>
                  <td className="p-2 text-right">
                    <ReadOnlyWeightCell
                      testId="machine-create-row-weight-0"
                      value={outputWeightKg}
                    />
                  </td>
                  <td className="p-2 text-right">
                    <NumPadCell
                      testId="machine-create-row-width-0"
                      value={outputWidthMm}
                      onChange={setOutputWidthMm}
                      decimals={0}
                      label="Width (mm)"
                      width="w-24"
                    />
                  </td>
                  <td className="p-2 text-right">
                    <NumPadCell
                      testId="machine-create-row-length-0"
                      value={outputLengthM}
                      onChange={setOutputLengthM}
                      decimals={1}
                      label="Length (m)"
                      width="w-24"
                    />
                  </td>
                  <td />
                </tr>
                {createRollRows.map((row: CreateRollRow, index: number) => (
                  <tr key={row.id} className="border-t border-line">
                    <td className="p-2 pl-4 font-mono text-xs text-content-3">
                      {index + 2}
                    </td>
                    <td className="p-2 font-mono text-xs font-semibold">
                      Auto label on save
                    </td>
                    <td className="p-2 text-right">
                      <NumPadCell
                        testId={`machine-create-row-gross-${index + 1}`}
                        value={row.gross_weight_kg}
                        onChange={(value) =>
                          updateCreateRow(row.id, "gross_weight_kg", value)
                        }
                        decimals={3}
                        label="Gross weight (kg)"
                        width="w-28"
                      />
                    </td>
                    <td className="p-2 text-right">
                      <NumPadCell
                        testId={`machine-create-row-tare-${index + 1}`}
                        value={row.tare_weight_kg}
                        onChange={(value) =>
                          updateCreateRow(row.id, "tare_weight_kg", value)
                        }
                        decimals={3}
                        label="Core tare (kg)"
                        width="w-24"
                      />
                    </td>
                    <td className="p-2 text-right">
                      <ReadOnlyWeightCell
                        testId={`machine-create-row-weight-${index + 1}`}
                        value={row.weight_kg}
                      />
                    </td>
                    <td className="p-2 text-right">
                      <NumPadCell
                        testId={`machine-create-row-width-${index + 1}`}
                        value={row.width_mm}
                        onChange={(value) =>
                          updateCreateRow(row.id, "width_mm", value)
                        }
                        decimals={0}
                        label="Width (mm)"
                        width="w-24"
                      />
                    </td>
                    <td className="p-2 text-right">
                      <NumPadCell
                        testId={`machine-create-row-length-${index + 1}`}
                        value={row.length_m}
                        onChange={(value) =>
                          updateCreateRow(row.id, "length_m", value)
                        }
                        decimals={1}
                        label="Length (m)"
                        width="w-24"
                      />
                    </td>
                    <td className="p-2 text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-danger-fg"
                        onClick={() => removeCreateRow(row.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="border-t border-line bg-success-bg px-4 py-2 text-right text-xs font-black uppercase tracking-wider text-success-fg">
            Total produced from rows:{" "}
            <span className="font-mono text-sm">{kg(previewOutputKg)}</span>
          </div>
        </div>
      ) : null}

      {variant === "slitting" ? (
        <div className="overflow-hidden rounded-xl border border-line">
          <div className="flex items-center justify-between border-b border-line bg-surface-2 p-3">
            <div>
              <div className={labelClass}>Split outputs · child rolls</div>
              <div className="mt-0.5 text-xs text-content-3">
                Sum of children + edge trim must stay within input roll weight.
              </div>
            </div>
            <Button
              type="button"
              className="h-9 rounded-[10px] bg-gradient-to-br from-info-fg to-primary text-xs font-semibold text-white"
              onClick={addSplitRow}
            >
              <Plus className="mr-1 h-3 w-3" />
              Add child
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-[10px] uppercase tracking-wider text-content-3">
                <tr>
                  <th className="p-2 pl-4 text-left">#</th>
                  <th className="p-2 text-left">Label</th>
                  <th className="p-2 text-right">Width</th>
                  <th className="p-2 text-right">Gross</th>
                  <th className="p-2 text-right">Core tare</th>
                  <th className="p-2 text-right">Net auto</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody>
                {splitRows.map((row: SplitRow, index: number) => (
                  <tr key={row.id} className="border-t border-line">
                    <td className="p-2 pl-4 font-mono text-xs text-content-3">
                      {index + 1}
                    </td>
                    <td className="p-2 font-mono text-xs font-semibold">
                      Auto child label
                    </td>
                    <td className="p-2 text-right">
                      <NumPadCell
                        testId={`machine-split-row-width-${index}`}
                        value={row.width_mm}
                        onChange={(value) =>
                          updateSplitRow(row.id, "width_mm", value)
                        }
                        decimals={0}
                        label="Child width (mm)"
                        width="w-24"
                      />
                    </td>
                    <td className="p-2 text-right">
                      <NumPadCell
                        testId={`machine-split-row-gross-${index}`}
                        value={row.gross_weight_kg}
                        onChange={(value) =>
                          updateSplitRow(row.id, "gross_weight_kg", value)
                        }
                        decimals={3}
                        label="Gross weight (kg)"
                        width="w-28"
                      />
                    </td>
                    <td className="p-2 text-right">
                      <NumPadCell
                        testId={`machine-split-row-tare-${index}`}
                        value={row.tare_weight_kg}
                        onChange={(value) =>
                          updateSplitRow(row.id, "tare_weight_kg", value)
                        }
                        decimals={3}
                        label="Core tare (kg)"
                        width="w-24"
                      />
                    </td>
                    <td className="p-2 text-right">
                      <ReadOnlyWeightCell
                        testId={`machine-split-row-weight-${index}`}
                        value={row.weight_kg}
                      />
                    </td>
                    <td className="p-2 text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-danger-fg"
                        onClick={() => removeSplitRow(row.id)}
                        disabled={splitRows.length <= 1}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {reconcilableBulkRows.length ? (
        <div className="rounded-xl border border-info-border bg-info-bg p-3">
          <div className={cn(labelClass, "text-primary")}>
            Issued inputs linked
          </div>
          <div className="mt-1 text-[11px] font-semibold leading-4 text-primary">
            Issued quantities come from release. This terminal records output
            plus any material return or scrap before Complete step.
          </div>
        </div>
      ) : null}

      <div className="rounded-xl border border-danger-border bg-danger-bg p-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className={cn(labelClass, "text-danger-fg")}>
              Trim and scrap · optional
            </div>
            <div className="mt-0.5 text-[11px] text-danger-fg">
              Enter either, both, or none. The output log sends the combined
              waste weight to inventory.
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div>
              <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-danger-fg">
                Trim
              </div>
              <NumPadCell
                testId="machine-trim-input"
                value={trimInput}
                onChange={setTrimInput}
                decimals={scrapEntryMode === "PCS" ? 0 : 3}
                label={`Trim (${scrapEntryMode.toLowerCase()})`}
                width="w-24"
                tone="rose"
              />
            </div>
            <div>
              <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-danger-fg">
                Scrap
              </div>
              <NumPadCell
                testId="machine-scrap-input"
                value={scrapInput}
                onChange={setScrapInput}
                decimals={scrapEntryMode === "PCS" ? 0 : 3}
                label={`Scrap (${scrapEntryMode.toLowerCase()})`}
                width="w-24"
                tone="rose"
              />
            </div>
            <Select
              value={scrapEntryMode}
              onValueChange={(value) => setScrapEntryMode(value as EntryMode)}
            >
              <SelectTrigger className="h-10 w-24 rounded-lg border-danger-border bg-surface-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="KG">KG</SelectItem>
                <SelectItem value="PCS">PCS</SelectItem>
              </SelectContent>
            </Select>
            <div className="rounded-lg border border-danger-border bg-surface-1 px-3 py-2 text-xs font-bold text-danger-fg">
              Total{" "}
              {kg(
                (toNumber(trimInput, 0) + toNumber(scrapInput, 0)) *
                  (scrapEntryMode === "PCS" && unitWeightG > 0
                    ? unitWeightG / 1000
                    : 1),
              )}
            </div>
          </div>
        </div>
      </div>

      {showRemainderPicker ? (
        <div
          className="rounded-xl border-2 border-warning-border bg-warning-bg p-3"
          data-testid="machine-remainder-picker"
        >
          <div className="mb-2 grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg border border-success-border bg-success-bg px-3 py-2">
              <div className={cn(labelClass, "text-success-fg")}>
                For this job
              </div>
              <div className="mt-0.5 font-mono text-sm font-black text-success-fg">
                {kg(previewOutputKg)}
              </div>
              <div className="text-[10px] font-semibold text-success-fg">
                Good output going to next step / FG
              </div>
            </div>
            <div className="rounded-lg border border-warning-border bg-warning-bg px-3 py-2">
              <div className={cn(labelClass, "text-warning-fg")}>
                Remainder back to stock
              </div>
              <div className="mt-0.5 font-mono text-sm font-black text-warning-fg">
                {kg(remainderKgEstimate)}
              </div>
              <div className="text-[10px] font-semibold text-warning-fg">
                Input balance returned as a remainder roll
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className={cn(labelClass, "text-warning-fg")}>
                Remainder location
              </div>
              <div className="text-[11px] text-warning-fg">
                {behavior === "SPLIT"
                  ? "Uncut input balance + edge trim is returned to the selected location."
                  : "Input roll balance is returned to the selected remainder location."}
              </div>
            </div>
            <Select
              value={remainderLocationId}
              onValueChange={setRemainderLocationId}
            >
              <SelectTrigger
                className="h-10 min-w-[220px] rounded-lg border-warning-border bg-surface-1"
                data-testid="machine-remainder-location"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DEFAULT_REMAINDER}>
                  Use job output location
                </SelectItem>
                {remainderLocations.map((loc: any) => (
                  <SelectItem key={loc.id} value={String(loc.id)}>
                    {loc.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function InlineNumber({
  label,
  value,
  onChange,
  testId,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  testId?: string;
}) {
  return (
    <div>
      <Label className={labelClass}>{label}</Label>
      <NumPadPopover
        value={value}
        onChange={onChange}
        decimals={3}
        step={1}
        min={0}
        label={label}
        className="mt-1"
        inputClassName="h-9 rounded-lg text-base"
        inputProps={testId ? ({ "data-testid": testId } as any) : undefined}
      />
    </div>
  );
}

/**
 * Compact, table-friendly numpad input. Renders a fixed-width NumPadPopover
 * trigger sized to fit dense output tables while still opening the tap keypad
 * and accepting direct keyboard entry.
 */
function NumPadCell({
  testId,
  value,
  onChange,
  decimals = 3,
  label,
  width = "w-24",
  tone = "slate",
}: {
  testId?: string;
  value: string;
  onChange: (value: string) => void;
  decimals?: number;
  label?: string;
  width?: string;
  tone?: "slate" | "emerald" | "rose";
}) {
  const toneClass =
    tone === "emerald"
      ? "border-success-border bg-success-bg font-semibold text-success-fg"
      : tone === "rose"
        ? "border-danger-border bg-surface-1"
        : "border-line bg-surface-1";
  return (
    <NumPadPopover
      value={value}
      onChange={onChange}
      decimals={decimals}
      step={1}
      min={0}
      label={label}
      className={cn("ml-auto", width)}
      inputClassName={cn("h-9 rounded-lg px-2 text-sm", toneClass)}
      inputProps={testId ? ({ "data-testid": testId } as any) : undefined}
    />
  );
}

function ReadOnlyWeightCell({
  testId,
  value,
}: {
  testId?: string;
  value: string;
}) {
  return (
    <div
      data-testid={testId}
      className="ml-auto flex h-9 w-28 items-center justify-end rounded-lg border border-success-border bg-success-bg px-2 font-mono text-sm font-black text-success-fg"
    >
      {kgInput(value) || "—"}
    </div>
  );
}

function HistoryPanel({
  historyRows,
  historySummary: rawHistorySummary,
  historyLoading,
  historyDateFrom,
  historyDateTo,
  historyStatus,
  setHistoryDateFrom,
  setHistoryDateTo,
  setHistoryStatus,
}: any) {
  const rows = Array.isArray(historyRows) ? historyRows : [];
  const rowSummary = rows.reduce(
    (
      summary: { jobs: number; producedKg: number; varianceKg: number },
      row: any,
    ) => ({
      jobs: summary.jobs + 1,
      producedKg: summary.producedKg + Number(row?.produced_kg || 0),
      varianceKg: summary.varianceKg + Number(row?.variance_kg || 0),
    }),
    { jobs: 0, producedKg: 0, varianceKg: 0 },
  );
  const apiSummary =
    rawHistorySummary && typeof rawHistorySummary === "object"
      ? rawHistorySummary
      : null;
  const historySummary = {
    jobs: Number(apiSummary?.jobs_completed ?? rowSummary.jobs),
    producedKg: Number(apiSummary?.produced_kg ?? rowSummary.producedKg),
    varianceKg: Number(apiSummary?.variance_kg ?? rowSummary.varianceKg),
  };
  const showLoading = Boolean(
    historyLoading && rows.length === 0 && !apiSummary,
  );
  const fixed2 = (value: number) => Number(value || 0).toFixed(2);

  return (
    <section className={cn(surfaceClass, "p-5")}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className={cn(labelClass, "text-primary")}>Machine history</div>
          <h2 className="mt-1 text-3xl font-black tracking-tight">
            Closed and forced jobs
          </h2>
          <p className="mt-1 text-sm font-semibold text-content-3">
            Date and variance filters use the same machine history API.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          <Input
            type="date"
            value={historyDateFrom}
            onChange={(event) => setHistoryDateFrom(event.target.value)}
            className={inputClass}
          />
          <Input
            type="date"
            value={historyDateTo}
            onChange={(event) => setHistoryDateTo(event.target.value)}
            className={inputClass}
          />
          <Select value={historyStatus} onValueChange={setHistoryStatus}>
            <SelectTrigger className={inputClass}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All status</SelectItem>
              <SelectItem value="NORMAL">Normal</SelectItem>
              <SelectItem value="FORCED_VARIANCE">Forced variance</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-line bg-surface-2 px-4 py-3">
          <div className={cn(labelClass, "text-content-3")}>Jobs completed</div>
          <div className="mt-1 font-mono text-2xl font-black text-content-1">
            {showLoading ? "..." : historySummary.jobs}
          </div>
        </div>
        <div className="rounded-xl border border-success-border bg-success-bg px-4 py-3">
          <div className={cn(labelClass, "text-success-fg")}>Produced</div>
          <div className="mt-1 font-mono text-2xl font-black text-success-fg">
            {showLoading ? "..." : `${fixed2(historySummary.producedKg)} kg`}
          </div>
        </div>
        <div className="rounded-xl border border-warning-border bg-warning-bg px-4 py-3">
          <div className={cn(labelClass, "text-warning-fg")}>Variance</div>
          <div className="mt-1 font-mono text-2xl font-black text-warning-fg">
            {showLoading ? "..." : `${fixed2(historySummary.varianceKg)} kg`}
          </div>
        </div>
      </div>
      <div className="mt-5 overflow-hidden rounded-xl border border-line">
        <div className="grid min-w-[760px] grid-cols-[1.2fr_1.1fr_0.8fr_0.8fr_0.8fr] bg-surface-2 px-4 py-3 text-[10px] font-black uppercase tracking-[0.2em] text-content-3">
          <div>Product</div>
          <div>Completed</div>
          <div>Output</div>
          <div>Variance</div>
          <div>Status</div>
        </div>
        <div className="overflow-x-auto">
          {showLoading ? (
            <div className="px-4 py-10 text-center text-sm font-semibold text-content-3">
              Loading history...
            </div>
          ) : rows.length ? (
            rows.map((row: any) => (
              <div
                key={row.job_id}
                className="grid min-w-[760px] grid-cols-[1.2fr_1.1fr_0.8fr_0.8fr_0.8fr] border-t border-line px-4 py-3 text-sm"
              >
                <div className="min-w-0">
                  <div className="truncate font-black">{row.job_number}</div>
                  <div className="truncate text-xs font-semibold text-content-3">
                    {row.template_name} · {row.step_name}
                  </div>
                </div>
                <div className="font-semibold text-content-3">
                  {formatShortDateTime(row.completed_at)}
                </div>
                <div className="font-mono font-black">
                  {kg(row.produced_kg)}
                </div>
                <div className="font-mono font-black">
                  {kg(row.variance_kg)}
                </div>
                <div>
                  <span
                    className={cn(
                      "rounded-full border px-2 py-1 text-[10px] font-bold uppercase",
                      stateBadgeClass(row.completion_mode),
                    )}
                  >
                    {row.completion_mode}
                  </span>
                </div>
              </div>
            ))
          ) : (
            <div className="px-4 py-10 text-center text-sm font-semibold text-content-3">
              No history rows for this filter.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

type ReasonMasterPickerProps = {
  groups?: ReasonCodeGroup[];
  fallbackReasons: string[];
  allowedLegacyCodes?: string[];
  value: string;
  valueId: string | null;
  onChange: (code: string, id: string | null) => void;
};

function ReasonMasterPicker(props: ReasonMasterPickerProps) {
  return <ReasonMasterPickerBody {...props} />;
}

function SublogDialog(props: any) {
  const {
    sublog,
    setSublog,
    selectedJob,
    scrapDialogQty,
    setScrapDialogQty,
    scrapDialogReason,
    setScrapDialogReason,
    scrapDialogReasonId,
    setScrapDialogReasonId,
    scrapReasonGroups,
    scrapDialogNotes,
    setScrapDialogNotes,
    scrapMutationPending,
    onSaveScrap,
    downtimeReason,
    setDowntimeReason,
    downtimeReasonId,
    setDowntimeReasonId,
    downtimeReasonGroups,
    downtimeStart,
    setDowntimeStart,
    downtimeEnd,
    setDowntimeEnd,
    downtimeAutoStop,
    setDowntimeAutoStop,
    downtimeNotes,
    setDowntimeNotes,
    downtimeMutationPending,
    onSaveDowntime,
    materialOptions,
    consumptionMaterialId,
    setConsumptionMaterialId,
    filteredGranuleCodes,
    consumptionGranuleCodeId,
    setConsumptionGranuleCodeId,
    reservedRolls,
    consumptionRollId,
    setConsumptionRollId,
    consumptionQty,
    setConsumptionQty,
    consumptionEstimated,
    setConsumptionEstimated,
    consumptionPending,
    onSaveConsumption,
    qualityRows,
    setQualityRows,
    qualityPending,
    onSaveQuality,
  } = props;
  const open = Boolean(sublog);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setSublog(null);
      }}
    >
      <DialogContent className="max-h-[86vh] overflow-y-auto rounded-[18px] sm:max-w-xl">
        {!selectedJob ? (
          <DialogHeader>
            <DialogTitle>Select a job first</DialogTitle>
            <DialogDescription>
              Sublogs are attached to the active machine job.
            </DialogDescription>
          </DialogHeader>
        ) : sublog === "scrap" ? (
          <>
            <DialogHeader>
              <DialogTitle>Log scrap</DialogTitle>
              <DialogDescription>
                Quantity, reason, and notes are written to ScrapLog.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label className={labelClass}>Quantity</Label>
                <NumPadPopover
                  value={scrapDialogQty}
                  onChange={setScrapDialogQty}
                  unit="kg"
                  decimals={3}
                  step={1}
                  min={0}
                  label="Scrap quantity"
                  className="mt-1"
                  inputProps={
                    { "data-testid": "machine-scrap-dialog-qty" } as any
                  }
                  inputClassName="h-10"
                />
              </div>
              <div>
                <Label className={labelClass}>UOM</Label>
                <Input
                  value="KG"
                  disabled
                  className={cn(inputClass, "mt-1 font-mono")}
                />
              </div>
            </div>
            <ReasonMasterPicker
              groups={scrapReasonGroups}
              fallbackReasons={[
                "SETUP",
                "TRIM",
                "DEFECT",
                "MACHINE",
                "MATERIAL",
                "OTHER",
              ]}
              value={scrapDialogReason}
              valueId={scrapDialogReasonId}
              onChange={(code: string, id: string | null) => {
                setScrapDialogReason(code);
                setScrapDialogReasonId(id);
              }}
            />
            <Textarea
              value={scrapDialogNotes}
              onChange={(event) => setScrapDialogNotes(event.target.value)}
              placeholder="Notes"
              className="min-h-20 rounded-lg"
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setSublog(null)}>
                Cancel
              </Button>
              <Button
                className="bg-gradient-to-br from-danger-solid to-danger-solid text-white"
                disabled={scrapMutationPending}
                onClick={onSaveScrap}
              >
                Save scrap
              </Button>
            </div>
          </>
        ) : sublog === "downtime" ? (
          <>
            <DialogHeader>
              <DialogTitle>Log downtime</DialogTitle>
              <DialogDescription>
                Downtime can pause the running step for breakdown or power
                events.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label className={labelClass}>Start time</Label>
                <Input
                  value={downtimeStart}
                  onChange={(event) => setDowntimeStart(event.target.value)}
                  className={cn(inputClass, "mt-1 font-mono")}
                  type="datetime-local"
                />
              </div>
              <div>
                <Label className={labelClass}>End time</Label>
                <Input
                  value={downtimeEnd}
                  onChange={(event) => setDowntimeEnd(event.target.value)}
                  className={cn(inputClass, "mt-1 font-mono")}
                  type="datetime-local"
                />
              </div>
            </div>
            <ReasonMasterPicker
              groups={downtimeReasonGroups}
              fallbackReasons={[
                "BREAKDOWN",
                "MAINTENANCE",
                "MATERIAL",
                "MANPOWER",
                "POWER",
                "OTHER",
              ]}
              allowedLegacyCodes={[
                "BREAKDOWN",
                "MAINTENANCE",
                "MATERIAL",
                "MANPOWER",
                "POWER",
                "OTHER",
              ]}
              value={downtimeReason}
              valueId={downtimeReasonId}
              onChange={(code: string, id: string | null) => {
                setDowntimeReason(code);
                setDowntimeReasonId(id);
              }}
            />
            <label className="flex items-center gap-2 text-xs font-semibold text-content-2">
              <Checkbox
                checked={downtimeAutoStop}
                onCheckedChange={(value) => setDowntimeAutoStop(Boolean(value))}
              />{" "}
              Auto-stop the running step
            </label>
            <Textarea
              value={downtimeNotes}
              onChange={(event) => setDowntimeNotes(event.target.value)}
              placeholder="Notes"
              className="min-h-20 rounded-lg"
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setSublog(null)}>
                Cancel
              </Button>
              <Button
                className="bg-gradient-to-br from-warning-fg to-warm text-white"
                disabled={downtimeMutationPending}
                onClick={onSaveDowntime}
              >
                Save downtime
              </Button>
            </div>
          </>
        ) : sublog === "consumption" ? (
          <>
            <DialogHeader>
              <DialogTitle>Log material consumption</DialogTitle>
              <DialogDescription>
                Manual usage rows are added to MaterialConsumptionLog for this
                job.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label className={labelClass}>Material</Label>
                <Select
                  value={consumptionMaterialId || SELECT_NONE}
                  onValueChange={(value) => {
                    setConsumptionMaterialId(
                      value === SELECT_NONE ? "" : value,
                    );
                    setConsumptionGranuleCodeId(SELECT_NONE);
                  }}
                >
                  <SelectTrigger className={cn(inputClass, "mt-1")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SELECT_NONE}>Select material</SelectItem>
                    {materialOptions.map((material: any) => (
                      <SelectItem key={material.id} value={material.id}>
                        {material.code ? `${material.code} · ` : ""}
                        {material.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className={labelClass}>Granule code</Label>
                <Select
                  value={consumptionGranuleCodeId}
                  onValueChange={setConsumptionGranuleCodeId}
                >
                  <SelectTrigger className={cn(inputClass, "mt-1")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SELECT_NONE}>No code</SelectItem>
                    {filteredGranuleCodes.map((code: GranuleQualityCode) => (
                      <SelectItem key={code.id} value={code.id}>
                        {code.code} ·{" "}
                        {code.granule_material_code || code.granule_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label className={labelClass}>From roll</Label>
                <Select
                  value={consumptionRollId}
                  onValueChange={setConsumptionRollId}
                >
                  <SelectTrigger className={cn(inputClass, "mt-1 font-mono")}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SELECT_NONE}>
                      No specific roll
                    </SelectItem>
                    {reservedRolls.map((roll: any) => (
                      <SelectItem key={roll.id} value={roll.id}>
                        {roll.label_id} · {stockFormLabel(roll.stock_form)} ·{" "}
                        {kg(roll.weight_kg)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className={labelClass}>Quantity kg</Label>
                <NumPadPopover
                  value={consumptionQty}
                  onChange={setConsumptionQty}
                  unit="kg"
                  decimals={3}
                  step={1}
                  min={0}
                  label="Consumption qty"
                  className="mt-1"
                  inputProps={
                    { "data-testid": "machine-consumption-qty" } as any
                  }
                  inputClassName="h-10"
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs font-semibold text-content-2">
              <Checkbox
                checked={consumptionEstimated}
                onCheckedChange={(value) =>
                  setConsumptionEstimated(Boolean(value))
                }
              />{" "}
              Estimated quantity
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setSublog(null)}>
                Cancel
              </Button>
              <Button
                className="bg-gradient-to-br from-primary to-primary text-white"
                disabled={consumptionPending}
                onClick={onSaveConsumption}
              >
                Save consumption
              </Button>
            </div>
          </>
        ) : sublog === "quality" ? (
          <>
            <DialogHeader>
              <DialogTitle>Quality readings</DialogTitle>
              <DialogDescription>
                Parameter set follows the current process type.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-2 sm:grid-cols-2">
              {qualityRows.map((row: QualityDraft, index: number) => (
                <div
                  key={row.code}
                  className="rounded-lg border border-info-border bg-info-bg p-2"
                >
                  <Label className={labelClass}>{row.label}</Label>
                  <Input
                    value={row.value}
                    onChange={(event) =>
                      setQualityRows((prev: QualityDraft[]) =>
                        prev.map((item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, value: event.target.value }
                            : item,
                        ),
                      )
                    }
                    className={cn(inputClass, "mt-1 font-mono")}
                  />
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="text-[10px] text-content-3">
                      {row.spec_min !== undefined || row.spec_max !== undefined
                        ? `spec ${row.spec_min ?? "-"}-${row.spec_max ?? "-"}`
                        : "observation"}
                    </span>
                    <label className="flex items-center gap-1 text-[10px] font-semibold text-content-3">
                      <Checkbox
                        checked={row.in_spec}
                        onCheckedChange={(value) =>
                          setQualityRows((prev: QualityDraft[]) =>
                            prev.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, in_spec: Boolean(value) }
                                : item,
                            ),
                          )
                        }
                      />{" "}
                      In spec
                    </label>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setSublog(null)}>
                Cancel
              </Button>
              <Button
                className="bg-gradient-to-br from-info-fg to-info-fg text-white"
                disabled={qualityPending}
                onClick={onSaveQuality}
              >
                Save readings
              </Button>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ReasonChips({
  reasons,
  value,
  onChange,
}: {
  reasons: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <Label className={labelClass}>Reason</Label>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {reasons.map((reason) => (
          <Button
            key={reason}
            type="button"
            variant="outline"
            className={cn(
              "h-9 rounded-full text-xs font-semibold",
              value === reason
                ? "border-transparent bg-gradient-to-br from-info-fg to-primary text-white"
                : "bg-surface-1",
            )}
            onClick={() => onChange(reason)}
          >
            {reason}
          </Button>
        ))}
      </div>
    </div>
  );
}

/**
 * Two-level reason picker backed by the reason-code masters.
 * Renders parent reasons then their sub-codes as grouped chips. Selecting any
 * node reports both the master id and a legacy code string for back-compat.
 * When `allowedLegacyCodes` is supplied (e.g. the fixed downtime enum) the
 * emitted legacy code is constrained to that set. Falls back to the plain
 * hardcoded chips when the master list is empty so the flow never breaks.
 */
function ReasonMasterPickerBody({
  groups,
  fallbackReasons,
  allowedLegacyCodes,
  value,
  valueId,
  onChange,
}: ReasonMasterPickerProps) {
  const safeGroups = Array.isArray(groups) ? groups : [];
  if (!safeGroups.length) {
    // No masters configured — keep the original behavior (legacy code only).
    return (
      <ReasonChips
        reasons={fallbackReasons}
        value={value}
        onChange={(code) => onChange(code, null)}
      />
    );
  }

  const allowed = allowedLegacyCodes
    ? new Set(allowedLegacyCodes.map((code) => code.toUpperCase()))
    : null;
  const deriveLegacyCode = (node: ReasonCode, parent?: ReasonCode): string => {
    const selfCode = String(node.code || "").toUpperCase();
    const parentCode = String(
      parent?.code || node.parent_code || "",
    ).toUpperCase();
    if (!allowed) return selfCode || parentCode || value;
    if (selfCode && allowed.has(selfCode)) return selfCode;
    if (parentCode && allowed.has(parentCode)) return parentCode;
    if (allowed.has("OTHER")) return "OTHER";
    return selfCode || parentCode || value;
  };

  const chip = (node: ReasonCode, parent?: ReasonCode) => {
    const selected = String(valueId) === String(node.id);
    return (
      <Button
        key={node.id}
        type="button"
        variant="outline"
        data-testid={`reason-chip-${node.code}`}
        className={cn(
          "h-9 rounded-full px-3 text-xs font-semibold",
          selected
            ? "border-transparent bg-gradient-to-br from-info-fg to-primary text-white"
            : "bg-surface-1",
        )}
        onClick={() =>
          onChange(deriveLegacyCode(node, parent), String(node.id))
        }
      >
        {node.label || node.code}
      </Button>
    );
  };

  return (
    <div>
      <Label className={labelClass}>Reason</Label>
      <div className="mt-2 space-y-2.5">
        {safeGroups.map((group) => (
          <div
            key={group.parent.id}
            className="rounded-xl border border-line bg-surface-2 p-2"
          >
            <div className="flex flex-wrap items-center gap-2">
              {chip(group.parent)}
              <span className="font-mono text-[10px] uppercase tracking-wider text-content-4">
                {group.parent.code}
              </span>
            </div>
            {group.children.length ? (
              <div className="mt-2 flex flex-wrap gap-1.5 border-t border-line pl-2 pt-2">
                {group.children.map((child) => chip(child, group.parent))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

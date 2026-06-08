"use client";

import { useState, useMemo, useEffect, useRef, type MouseEvent } from "react";
import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import { useParams } from "next/navigation";
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
  AlertCircle,
  ArrowUpRight,
  Activity,
  Trash2,
  Search,
  History,
  Scissors,
  TriangleAlert,
} from "lucide-react";
import { WcmRollPickerDialog } from "@/components/wcm/roll-picker-dialog";
import {
  InkColorSwatches,
  CylinderReadyChip,
  MaterialBlockChip,
  ElapsedStalledBadge,
  MachineStateBadge,
  type MachineLiveState,
} from "@/components/wcm/queue-card-chips";
import { StalledJobsPanel } from "@/components/wcm/stalled-jobs-panel";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/components/auth-provider";
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
  granule_code_allocations?: Array<{ granule_code_id: string; qty_kg: string }>;
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

function assignmentHasMachineStart(assignment: any) {
  const job = assignment?.job_details || {};
  const assignmentStatus = String(assignment?.status || "").toUpperCase();
  const state = String(job?.job_state || "").toUpperCase();
  const status = String(job?.status || "").toUpperCase();
  return (
    assignmentStatus === "EXECUTION_READY" &&
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

function podLabelFromJob(job: any, context?: any) {
  const spec = normalizeProductSpec(job, context);
  return spec.podLabels.length ? spec.podLabels.join(", ") : "No POD";
}

function addonsLabelFromJob(job: any, context?: any) {
  const spec = normalizeProductSpec(job, context);
  return spec.addonLabels.length
    ? spec.addonLabels.slice(0, 4).join(", ") +
        (spec.addonLabels.length > 4 ? ` +${spec.addonLabels.length - 4}` : "")
    : "No add-ons";
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
  // Per-requirement explicit confirmation that an over-pick (>120% of target) is intended.
  const [overPickConfirms, setOverPickConfirms] = useState<
    Record<string, boolean>
  >({});
  const [queueSearch, setQueueSearch] = useState("");
  const [queueStatusFilter, setQueueStatusFilter] = useState<
    "ALL" | "READY" | "ASSIGNED" | "NEEDS_MACHINE"
  >("ALL");
  const [queueSortKey, setQueueSortKey] = useState<
    "PRIORITY_ASC" | "PRIORITY_DESC" | "SO_DATE" | "CUSTOMER" | "MACHINE"
  >("PRIORITY_ASC");
  const [historySearch, setHistorySearch] = useState("");
  const [historyStatusFilter, setHistoryStatusFilter] = useState("ALL");
  const [historyDaysFilter, setHistoryDaysFilter] = useState("30");
  const [queuePage, setQueuePage] = useState(1);
  const [runningPage, setRunningPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const [closeJobAction, setCloseJobAction] = useState<{
    assignment: any;
    mode: "SHORT_CLOSE" | "CANCEL";
  } | null>(null);
  const [closeJobReason, setCloseJobReason] = useState("");
  const [closeJobReasonPreset, setCloseJobReasonPreset] = useState("");
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
  const {
    data: assignments,
    isLoading,
    isError: queueIsError,
    error: queueError,
    refetch: refetchQueue,
    dataUpdatedAt: queueUpdatedAt,
  } = useQuery({
    queryKey: ["wcm-queue", wcId],
    queryFn: () => wcmService.getQueue(wcId),
    refetchInterval: 5000, // Polling for new jobs
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
    refetchInterval: 30000, // History can update less frequently
    enabled: activeMainTab === "history",
  });

  const { data: wcStats, isLoading: isLoadingStats } = useQuery({
    queryKey: ["wcm-stats", wcId],
    queryFn: () => wcmService.getStats(wcId),
    refetchInterval: 5000,
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
    refetchInterval: 30000,
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
  const visibleQueueAssignments = useMemo(() => {
    const filtered = baseQueueAssignments.filter((assignment: any) => {
      const job = assignment?.job_details || {};
      const status = String(assignment?.status || "").toUpperCase();
      const hasMachine = Boolean(assignment?.assigned_machine);
      if (queueStatusFilter === "READY" && status !== "WC_READY") return false;
      if (queueStatusFilter === "ASSIGNED" && status !== "ASSIGNED")
        return false;
      if (queueStatusFilter === "NEEDS_MACHINE" && hasMachine) return false;

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
  }, [baseQueueAssignments, queueSearch, queueStatusFilter, queueSortKey]);
  const visibleRunningAssignments = useMemo(
    () =>
      runningAssignments.filter((assignment: any) => {
        const job = assignment?.job_details || {};
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
    [runningAssignments, queueSearch],
  );
  const queuePageSize = 20;
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
  const activeAssignment = activeAssignmentId
    ? activeAssignmentPool.find((a) => a.id === activeAssignmentId) || null
    : null;
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
      setActiveAssignmentId(activeAssignmentPool[0].id);
    }
  }, [activeAssignmentPool, activeAssignmentId, activeMainTab]);

  useEffect(() => {
    setQueuePage(1);
    setRunningPage(1);
  }, [queueSearch, queueStatusFilter]);

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
  const { data: executionContext, refetch: refetchContext } = useQuery({
    queryKey: ["execution-context", selectedJobId],
    queryFn: () => wcmService.getJobContext(selectedJobId),
    enabled: !!selectedJobId,
    refetchInterval: 5000,
  });

  // Phase 68: Satisfaction Status (Universal Flow Engine)
  const { data: satisfactionStatus, refetch: refetchSatisfaction } = useQuery({
    queryKey: ["satisfaction-status", selectedJobId],
    queryFn: () => wcmService.getSatisfactionStatus(selectedJobId),
    enabled: !!selectedJobId,
    refetchInterval: 5000,
  });

  const { data: currentStepPolicy, refetch: refetchCurrentStepPolicy } =
    useQuery({
      queryKey: ["current-step-material-policy", selectedJobId],
      queryFn: () => wcmService.getCurrentStepMaterialPolicy(selectedJobId),
      enabled: !!selectedJobId,
      refetchInterval: 10000,
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
    queryFn: () => wcmService.getWipPoolGrouped(selectedJobId),
    enabled: !!selectedJobId,
    refetchInterval: selectedJobId ? 5000 : false,
  });

  // Use Context specific eligible rolls if available, else fallback to WC endpoint
  const { data: eligibleRollsFallback } = useQuery({
    queryKey: ["eligible-rolls", selectedJobId],
    queryFn: () => wcmService.getEligibleRolls(selectedJobId),
    enabled: !!selectedJobId && !executionContext,
  });
  const eligibleRolls = useMemo(() => {
    const raw =
      (executionContext as any)?.eligible_rolls ?? eligibleRollsFallback;
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === "object" && Array.isArray((raw as any).results))
      return (raw as any).results;
    return [];
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
  const selectedPrimaryUom = String(
    (selectedJob as any)?.primary_uom ||
      (String((selectedJob as any)?.uom || "").toUpperCase() === "PCS" &&
      selectedOutputForm === "BULK" &&
      selectedInputForm === "ROLL"
        ? "PCS"
        : "KG"),
  ).toUpperCase() as "KG" | "PCS";
  const selectedPrimaryDecimals = selectedPrimaryUom === "PCS" ? 0 : 3;
  const stepTargetPrimary =
    toNullableNumber((selectedJob as any)?.step_target_primary) ??
    (selectedPrimaryUom === "PCS"
      ? String((selectedJob as any)?.uom || "").toUpperCase() === "PCS"
        ? Number((selectedJob as any)?.quantity || 0)
        : null
      : Number(stepTargetKg || 0));
  const stepRemainingPrimary = toNullableNumber(
    (selectedJob as any)?.step_remaining_primary,
  );
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
  const rollsMissing = Math.max(0, rollsRequired - effectiveRollsReserved);
  const isRollInputStep = satisfactionStatus?.input_form === "ROLL";
  const requiresManualRollAssign = isRollInputStep && rollsMissing > 0;
  const rollGuidanceText =
    satisfactionStatus?.input_form === "ROLL" &&
    rollsRequired > 0 &&
    rollBehavior === "NONE"
      ? "Reserve required input roll(s) for this step."
      : rollBehaviorGuidance[rollBehavior] || rollBehaviorGuidance.NONE;
  const showRollGuidance = isRollInputStep;
  const canManualAssign = isRollInputStep && rollsMissing > 0;
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
      const isOk = shortfall <= 0;
      const needsTransfer =
        shortfall > 0 &&
        hasNonLocalStock &&
        Boolean(bulk.material_id || bulk.materialId);
      const statusText = isOk
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
        locationName: bulk.location_name || null,
      };
    },
  );

  const rollRow =
    satisfactionStatus?.input_form === "ROLL"
      ? (() => {
          const rollsLocalAvailable = Number(
            (satisfactionStatus as any)?.rolls_available ?? 0,
          );
          const isOk = effectiveRollsReserved >= rollsRequired;
          const statusText = isOk ? "READY" : "INSUFFICIENT";
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
      return;
    }
    const persisted = Array.isArray(
      (executionContext as any)?.current_step_material_confirmations,
    )
      ? (executionContext as any).current_step_material_confirmations
      : [];
    setMaterialIssueDrafts((prev) => {
      const next: Record<string, WcmMaterialIssueDraft> = {};
      materialIssueRows.forEach((row: any) => {
        const requirementId = String(row?.requirement_id || "").trim();
        if (!requirementId) return;
        const saved = persisted.find(
          (item: any) => String(item?.requirement_id || "") === requirementId,
        );
        const issueTarget = materialIssueTargetKg(row);
        const codeOptions = Array.isArray(row?.granule_code_options)
          ? row.granule_code_options
          : [];
        next[requirementId] = {
          material_id: String(row?.material_id || saved?.material_id || ""),
          actual_issued_qty: String(
            saved?.actual_issued_qty ??
              prev[requirementId]?.actual_issued_qty ??
              (issueTarget > 0 ? issueTarget.toFixed(3) : ""),
          ),
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
                qty_kg: String(
                  allocation?.qty_kg ?? allocation?.quantity ?? "",
                ),
              }))
            : prev[requirementId]?.granule_code_allocations ||
              (String(row?.category || "").toUpperCase() === "GRANULE" &&
              codeOptions.length
                ? [
                    {
                      granule_code_id: String(
                        codeOptions[0]?.granule_code_id || "",
                      ),
                      qty_kg: issueTarget > 0 ? issueTarget.toFixed(3) : "",
                    },
                  ]
                : []),
        };
      });
      return next;
    });
  }, [selectedJobId, executionContext, materialIssueRows]);
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
        codeOptions.map((option: any) => String(option?.granule_code_id || "")),
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
          const qty = Number(allocation.qty_kg || 0);
          if (!allowedCodes.has(codeId)) {
            errors.push(`${materialName}: code is not allowed`);
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
  const selectedMachineUnavailable =
    selectedMachineState === "DOWN" || selectedMachineRunningOtherJob;
  const detailInkColors: string[] = Array.isArray(
    (activeAssignment as any)?.ink_colors,
  )
    ? (activeAssignment as any).ink_colors
    : [];
  const detailCylinderStatus = (activeAssignment as any)?.cylinder_status as
    | "READY"
    | "MISSING"
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
    } else if (selectedMachineRunningOtherJob) {
      reasons.push(
        `Machine: already running ${selectedMachine?.current_job_number}`,
      );
    }
    if (detailMaterialBlocked) {
      reasons.push(
        `Material block: ${detailMaterialBlockReason || "queue marked material blocked"}`,
      );
    }
    if (detailCylinderStatus === "MISSING") {
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
    selectedMachine?.current_job_number,
    selectedMachineRunningOtherJob,
    detailMaterialBlocked,
    detailMaterialBlockReason,
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

  const handlePushToOperator = () => {
    if (!activeAssignment) return;
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

  if (queueIsError && !isLoading) {
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
  const selectedPodLabel = podLabelFromJob(selectedJob, executionContext);
  const selectedAddonsLabel = addonsLabelFromJob(selectedJob, executionContext);
  const selectedMaterialSpecs = materialSpecsFromJob(
    selectedJob,
    executionContext,
  );
  const selectedLayerChips = selectedMaterialSpecs.length
    ? selectedMaterialSpecs
    : (displayLayers.length
        ? displayLayers
        : layerHighlightsFromJob(selectedJob, executionContext)
      ).slice(0, 4);
  const selectedStepName = firstNonEmpty(
    currentStepPolicy?.current_process_name,
    (executionContext as any)?.current_step?.process_name,
    selectedJob?.process_code,
    "Current step",
  );

  const selectedSpec = normalizeProductSpec(selectedJob, executionContext);
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
  const machineGateLabel = isReleasedToMachine
    ? "Execution ready"
    : !selectedMachineId
      ? "Pick machine"
      : canPushToOperator
        ? "Ready to release"
        : "Release locked";
  const machineGateHelp = isReleasedToMachine
    ? "This job is already released. Preparation controls are locked and execution continues on the machine terminal."
    : !selectedMachineId
      ? "Select a production line. Release unlocks after current-step inputs are confirmed."
      : canPushToOperator
        ? "Machine and current-step input checks are clear. This action releases the job."
        : pushBlockingReasons[0] ||
          "Complete material and roll checks before release.";
  const materialGateOk =
    materialIssueErrors.length === 0 && overPickErrors.length === 0;
  const rollGateOk = satisfactionStatus?.input_form !== "ROLL" || rollOk;
  const machineGateOk =
    isReleasedToMachine ||
    (Boolean(selectedMachineId) &&
      !assignConflict &&
      !selectedMachineUnavailable);
  const cylinderGateOk = detailCylinderStatus !== "MISSING";
  const releaseGateItems = [
    {
      key: "material",
      label: "Current-step issue",
      ok: requirementsSatisfied && materialGateOk && !detailMaterialBlocked,
    },
    { key: "rolls", label: "Rolls allocated", ok: rollGateOk },
    { key: "machine", label: "Machine assigned", ok: machineGateOk },
    { key: "cylinder", label: "Cylinders & artwork", ok: cylinderGateOk },
  ];
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
  const detailPaneContent = (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-[24px] border border-primary bg-gradient-to-br from-[#10233f] via-[#153f73] to-[#1f3f86] p-5 text-white shadow-[0_26px_70px_-42px_rgba(15,23,42,.7)]">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[11px] font-black uppercase tracking-[0.22em] text-info-border">
              Selected job · release cockpit
            </div>
            <h2 className="mt-1 text-2xl font-black leading-tight tracking-tight text-white">
              {selectedSpec.productName}
            </h2>
            <div className="mt-2 flex flex-wrap gap-1.5 text-xs font-semibold">
              <span className="rounded-full border border-surface-1/10 bg-surface-1/10 px-2.5 py-1 text-info-border">
                {selectedJob?.customer_name ||
                  selectedSpec.customerName ||
                  "Customer not captured"}
              </span>
              <span className="rounded-full border border-info-border bg-info-fg px-2.5 py-1 text-info-border">
                {selectedJob?.order_number ||
                  selectedSpec.orderNumber ||
                  "SO not captured"}
              </span>
              {selectedSpec.templateName || selectedJob?.template_name ? (
                <span className="rounded-full border border-surface-1/10 bg-surface-1/10 px-2.5 py-1 text-info-border">
                  {selectedSpec.templateName || selectedJob?.template_name}
                </span>
              ) : null}
            </div>
          </div>
          <TooltipProvider delayDuration={100}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className={cn(
                    "shrink-0 rounded-full border px-3 py-1.5 text-xs font-black uppercase tracking-wider",
                    pushBlockingReasons.length
                      ? "border-danger-border bg-danger-solid text-danger-border"
                      : "border-success-border bg-success-fg text-success-border",
                  )}
                >
                  {blockerLabel}
                </span>
              </TooltipTrigger>
              <TooltipContent
                side="left"
                className="max-w-[320px] rounded-xl border-line bg-surface-1 p-3 text-content-2 shadow-xl"
              >
                {pushBlockingReasons.length ? (
                  pushBlockingReasons.slice(0, 6).map((reason) => (
                    <div key={reason} className="text-xs font-semibold">
                      {reason}
                    </div>
                  ))
                ) : (
                  <div className="text-xs font-semibold">
                    Machine and material checks are ready.
                  </div>
                )}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-surface-1/10 bg-surface-1/10 p-3">
            <div className="text-[10px] font-black uppercase tracking-wider text-info-border">
              Final product size
            </div>
            <div className="mt-1 text-lg font-black leading-tight text-white">
              {selectedSpec.size.label || selectedGeometry.label}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-semibold text-info-border">
              <span>
                Width{" "}
                {selectedSpec.size.widthMm != null
                  ? `${selectedSpec.size.widthMm} mm`
                  : "—"}
              </span>
              <span>
                Height{" "}
                {selectedSpec.size.heightMm != null
                  ? `${selectedSpec.size.heightMm} mm`
                  : "—"}
              </span>
              {selectedSpec.size.gussetMm != null &&
              selectedSpec.size.gussetMm > 0 ? (
                <span>Gusset {selectedSpec.size.gussetMm} mm</span>
              ) : null}
            </div>
          </div>
          <div className="rounded-xl border border-surface-1/10 bg-surface-1/10 p-3">
            <div className="text-[10px] font-black uppercase tracking-wider text-info-border">
              Output form
            </div>
            <div className="mt-1 text-lg font-black leading-tight text-white">
              {selectedOutputForm ||
                selectedSpec.size.finishedGoodType ||
                "Output"}
            </div>
            <div className="mt-2 text-[11px] font-semibold text-info-border">
              {selectedInputForm === "ROLL" && selectedOutputForm === "BULK"
                ? outputCaptureModeLabel(selectedOutputCaptureMode)
                : `${selectedSpec.layers.length || 0} layer${selectedSpec.layers.length === 1 ? "" : "s"} in this sales specification`}
            </div>
          </div>
          <div className="rounded-xl border border-surface-1/10 bg-surface-1/10 p-3">
            <div className="text-[10px] font-black uppercase tracking-wider text-info-border">
              POD
            </div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {selectedSpec.podLabels.length ? (
                selectedSpec.podLabels.map((label) => (
                  <span
                    key={`selected-pod-${label}`}
                    className="rounded-full border border-info-border bg-info-fg px-2 py-1 text-xs font-semibold text-info-border"
                  >
                    {label}
                  </span>
                ))
              ) : (
                <span className="text-sm font-semibold text-info-border">
                  {selectedPodLabel}
                </span>
              )}
            </div>
          </div>
          <div className="rounded-xl border border-surface-1/10 bg-surface-1/10 p-3">
            <div className="text-[10px] font-black uppercase tracking-wider text-warm">
              Add-ons
            </div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {selectedSpec.addonLabels.length ? (
                selectedSpec.addonLabels.map((label) => (
                  <span
                    key={`selected-addon-${label}`}
                    className="rounded-full border border-warning-border bg-warm px-2 py-1 text-xs font-semibold text-warm"
                  >
                    {label}
                  </span>
                ))
              ) : (
                <span className="text-sm font-semibold text-warm">
                  {selectedAddonsLabel}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] font-black uppercase tracking-wider text-info-border">
                Layer build
              </div>
              <div className="text-sm font-semibold text-info-border">
                Variant, grade, thickness, and stock width by layer
              </div>
            </div>
            <span className="rounded-full border border-surface-1/10 bg-surface-1/10 px-2.5 py-1 text-xs font-semibold text-info-border">
              {selectedSpec.layers.length || 0} layers
            </span>
          </div>
          <div className="space-y-2">
            {selectedSpec.layers.length ? (
              selectedSpec.layers.map((layer) => (
                <div
                  key={`selected-layer-card-${layer.index}`}
                  className="rounded-xl border border-line bg-surface-2 p-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[10px] font-black uppercase tracking-wider text-success-fg">
                        Layer {layer.index}
                      </div>
                      <div className="mt-0.5 text-sm font-semibold leading-tight text-content-1">
                        {firstNonEmpty(
                          layer.variantName,
                          layer.variantCode,
                          `Layer ${layer.index}`,
                        )}
                      </div>
                      {layer.variantCode &&
                      layer.variantCode !== layer.variantName ? (
                        <div className="mt-0.5 text-[11px] font-semibold text-content-3">
                          {layer.variantCode}
                        </div>
                      ) : null}
                    </div>
                    <div className="grid min-w-[260px] flex-1 grid-cols-3 gap-2 text-xs font-semibold">
                      <div className="rounded-lg border border-surface-1 bg-surface-1 px-2.5 py-2">
                        <div className="text-[9px] font-black uppercase tracking-wider text-content-4">
                          Grade
                        </div>
                        <div className="mt-0.5 truncate text-content-2">
                          {firstNonEmpty(layer.grade, "—")}
                        </div>
                      </div>
                      <div className="rounded-lg border border-surface-1 bg-surface-1 px-2.5 py-2">
                        <div className="text-[9px] font-black uppercase tracking-wider text-content-4">
                          Thickness
                        </div>
                        <div className="mt-0.5 text-content-2">
                          {layer.thicknessMicron != null
                            ? `${layer.thicknessMicron}u`
                            : "—"}
                        </div>
                      </div>
                      <div className="rounded-lg border border-surface-1 bg-surface-1 px-2.5 py-2">
                        <div className="text-[9px] font-black uppercase tracking-wider text-content-4">
                          Stock width
                        </div>
                        <div className="mt-0.5 text-content-2">
                          {layer.widthMm != null ? `${layer.widthMm} mm` : "—"}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-dashed border-line bg-surface-2 px-3 py-4 text-center text-xs font-semibold text-content-4">
                No layer details captured for this sales product.
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-[22px] border border-order-border bg-surface-1 p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-black uppercase tracking-[0.18em] text-order-fg">
              Stock form contract
            </div>
            <div className="mt-1 text-lg font-semibold text-content-1">
              {stockFormLabel(selectedTargetStockForm)}
            </div>
            <p className="mt-1 text-xs font-semibold text-content-3">
              Input and output form policy for this WCM step. Machine terminal
              logs output against this contract.
            </p>
          </div>
          <span className="rounded-full border border-order-border bg-order-bg px-2.5 py-1 text-xs font-bold text-order-fg">
            {stockFormConversionLabel}
          </span>
        </div>
        <div className="mt-4 grid gap-2 md:grid-cols-4">
          <div className="rounded-xl border border-line bg-surface-2 px-3 py-2">
            <div className="text-[10px] font-black uppercase tracking-wider text-content-3">
              Step input
            </div>
            <div className="mt-1 text-sm font-bold text-content-1">
              {selectedInputForm || "—"}
            </div>
          </div>
          <div className="rounded-xl border border-line bg-surface-2 px-3 py-2">
            <div className="text-[10px] font-black uppercase tracking-wider text-content-3">
              Step output
            </div>
            <div className="mt-1 text-sm font-bold text-content-1">
              {selectedOutputForm || "—"}
            </div>
          </div>
          <div className="rounded-xl border border-line bg-surface-2 px-3 py-2">
            <div className="text-[10px] font-black uppercase tracking-wider text-content-3">
              Allowed input forms
            </div>
            <div className="mt-1 text-sm font-bold text-content-1">
              {stockFormListLabel(selectedAllowedInputForms)}
            </div>
          </div>
          <div className="rounded-xl border border-line bg-surface-2 px-3 py-2">
            <div className="text-[10px] font-black uppercase tracking-wider text-content-3">
              Target width
            </div>
            <div className="mt-1 text-sm font-bold text-content-1">
              {selectedTargetWidth
                ? `${selectedTargetWidth.toLocaleString(undefined, { maximumFractionDigits: 2 })} mm`
                : "—"}
              {selectedTargetWidthBasis ? (
                <span className="ml-1 text-xs text-content-3">
                  ({widthBasisLabel(selectedTargetWidthBasis)})
                </span>
              ) : null}
            </div>
          </div>
        </div>
        <div className="mt-2 rounded-xl border border-order-border bg-order-bg px-3 py-2 text-xs font-semibold text-order-fg">
          Allowed output forms: {stockFormListLabel(selectedAllowedOutputForms)}
        </div>
      </section>

      <section className="rounded-[22px] border border-info-border bg-surface-1 p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-black uppercase tracking-[0.18em] text-primary">
              Release readiness
            </div>
            <div className="text-sm font-semibold text-content-3">
              {releaseGateGreenCount} of {releaseGateItems.length} gates green ·
              one action releases to machine
            </div>
          </div>
          <div className="min-w-[180px] flex-1 sm:max-w-[260px]">
            <div className="h-2 overflow-hidden rounded-full bg-surface-2">
              <span
                className="block h-full rounded-full bg-gradient-to-r from-success-fg to-primary transition-all"
                style={{ width: `${releaseGateProgress}%` }}
              />
            </div>
          </div>
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-4">
          {releaseGateItems.map((gate, index) => (
            <div
              key={gate.key}
              className={cn(
                "rounded-2xl border px-3 py-2.5",
                gate.ok
                  ? "border-success-border bg-success-bg text-success-fg"
                  : "border-warning-border bg-warning-bg text-warning-fg",
              )}
            >
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "grid size-6 place-items-center rounded-full text-xs font-black text-white",
                    gate.ok ? "bg-success-fg" : "bg-warning-fg",
                  )}
                >
                  {gate.ok ? "✓" : index + 1}
                </span>
                <span className="text-xs font-black">{gate.label}</span>
              </div>
            </div>
          ))}
        </div>
        <div
          className={cn(
            "mt-3 rounded-2xl border px-3 py-2",
            pushBlockingReasons.length
              ? "border-danger-border bg-danger-bg text-danger-fg"
              : "border-success-border bg-success-bg text-success-fg",
          )}
        >
          <div className="text-[10px] font-black uppercase tracking-wider">
            {pushBlockingReasons.length
              ? "Release blockers"
              : "Release blockers clear"}
          </div>
          <div className="mt-1 grid gap-1 text-xs font-semibold">
            {pushBlockingReasons.length ? (
              pushBlockingReasons.slice(0, 8).map((reason) => (
                <div
                  key={`release-blocker-${reason}`}
                  className="flex items-start gap-1.5"
                >
                  <span className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
                  <span>{reason}</span>
                </div>
              ))
            ) : (
              <div>
                Machine, current-step issue, roll, and cylinder gates are clear.
              </div>
            )}
          </div>
        </div>
      </section>

      {activeMainTab === "running" ? (
        <section className="rounded-2xl border border-success-border bg-success-bg p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="text-[11px] uppercase tracking-wider text-success-fg">
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
              <div className="text-[10px] font-black uppercase tracking-wider text-content-3">
                Machine
              </div>
              <div className="mt-1 text-sm font-semibold text-content-1">
                {assignedMachineName || selectedMachine?.name || "—"}
              </div>
            </div>
            <div className="rounded-xl border border-surface-1 bg-surface-1/80 p-3">
              <div className="text-[10px] font-black uppercase tracking-wider text-content-3">
                Rolls locked
              </div>
              <div className="mt-1 text-sm font-semibold text-content-1">
                {effectiveRollsReserved}/{rollsRequired} allocated
              </div>
            </div>
            <div className="rounded-xl border border-surface-1 bg-surface-1/80 p-3">
              <div className="text-[10px] font-black uppercase tracking-wider text-content-3">
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
        <>
          {satisfactionStatus?.input_form === "ROLL" ? (
            <section className="rounded-2xl border border-line bg-surface-1 p-5 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] font-black uppercase tracking-wider text-content-3">
                    Roll allocation detail
                  </div>
                  <div className="mt-1 text-lg font-semibold text-content-1">
                    {rollBehaviorLabel}
                  </div>
                  <p className="mt-1 text-xs font-medium text-content-3">
                    {rollGuidanceText}
                  </p>
                </div>
                <span
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs font-semibold",
                    rollOk
                      ? "bg-success-bg text-success-fg"
                      : "bg-warning-bg text-warning-fg",
                  )}
                >
                  {effectiveRollsReserved}/{rollsRequired} allocated
                </span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                <div className="rounded-xl border border-line bg-surface-2 px-3 py-2">
                  <div className="text-[10px] font-black uppercase tracking-wider text-content-4">
                    Required
                  </div>
                  <div className="mt-1 text-lg font-semibold text-content-1">
                    {rollsRequired}
                  </div>
                </div>
                <div className="rounded-xl border border-info-border bg-info-bg px-3 py-2">
                  <div className="text-[10px] font-black uppercase tracking-wider text-primary">
                    Reserved
                  </div>
                  <div className="mt-1 text-lg font-semibold text-primary">
                    {effectiveRollsReserved}
                  </div>
                </div>
                <div className="rounded-xl border border-success-border bg-success-bg px-3 py-2">
                  <div className="text-[10px] font-black uppercase tracking-wider text-success-fg">
                    Lineage
                  </div>
                  <div className="mt-1 text-lg font-semibold text-success-fg">
                    {lineageRollsAvailable}
                  </div>
                </div>
                <div className="rounded-xl border border-warning-border bg-warning-bg px-3 py-2">
                  <div className="text-[10px] font-black uppercase tracking-wider text-warning-fg">
                    Fallback
                  </div>
                  <div className="mt-1 text-lg font-semibold text-warning-fg">
                    {fallbackRollsAvailable}
                  </div>
                </div>
              </div>
              <div className="mt-3 grid gap-2 text-xs md:grid-cols-3">
                <div className="rounded-xl border border-order-border bg-order-bg px-3 py-2">
                  <div className="text-[10px] font-black uppercase tracking-wider text-order-fg">
                    Required stock form
                  </div>
                  <div className="mt-1 font-bold text-order-fg">
                    {stockFormLabel(selectedTargetStockForm)}
                  </div>
                </div>
                <div className="rounded-xl border border-order-border bg-order-bg px-3 py-2">
                  <div className="text-[10px] font-black uppercase tracking-wider text-order-fg">
                    Allowed input
                  </div>
                  <div className="mt-1 font-bold text-order-fg">
                    {stockFormListLabel(selectedAllowedInputForms)}
                  </div>
                </div>
                <div className="rounded-xl border border-order-border bg-order-bg px-3 py-2">
                  <div className="text-[10px] font-black uppercase tracking-wider text-order-fg">
                    Output policy
                  </div>
                  <div className="mt-1 font-bold text-order-fg">
                    {stockFormConversionLabel}
                  </div>
                </div>
              </div>
              {rollsMissing > 0 ? (
                <div className="mt-3 rounded-xl border border-warning-border bg-warning-bg px-3 py-2 text-xs font-semibold text-warning-fg">
                  Assign {rollsMissing} more roll{rollsMissing === 1 ? "" : "s"}{" "}
                  before release.
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
                    disabled={isReleasedToMachine || !canManualAssign}
                    disabledLabel={
                      isReleasedToMachine
                        ? "LOCKED"
                        : rollsMissing <= 0
                          ? "ROLLS ASSIGNED"
                          : "NO FREE SLOT"
                    }
                    required={rollsRequired}
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
                          "rounded-full border px-2.5 py-1 text-[11px] font-bold",
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
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                <div className="rounded-xl border border-line bg-surface-2 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-[10px] font-black uppercase tracking-wider text-content-3">
                      Allocated now
                    </div>
                    <span className="text-[11px] font-semibold text-content-3">
                      {assignedRollsForDisplay.length} rolls
                    </span>
                  </div>
                  <div className="space-y-2">
                    {assignedRollsForDisplay.length ? (
                      assignedRollsForDisplay.map((roll: any) => (
                        <div
                          key={roll.id}
                          className="flex items-center gap-2 rounded-lg border border-surface-1 bg-surface-1 px-2.5 py-2"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-xs font-semibold text-content-1">
                              {roll.label_id}
                            </div>
                            <div className="truncate text-[11px] font-medium text-content-3">
                              {roll.material_name} ·{" "}
                              {roll.width_mm ? `${roll.width_mm}mm` : "—"} ·{" "}
                              {Number(roll.weight_kg || 0).toFixed(3)} kg
                            </div>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={isReleasedToMachine || mutation.isPending}
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
                    <div className="text-[10px] font-black uppercase tracking-wider text-content-3">
                      Available choices
                    </div>
                    <span className="text-[11px] font-semibold text-content-3">
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
                        <div className="text-[11px] font-medium text-content-3">
                          {roll.material_name ||
                            roll.material_code ||
                            "Material"}{" "}
                          ·{" "}
                          {roll.thickness_micron
                            ? `${roll.thickness_micron}u`
                            : "—"}{" "}
                          · {roll.width_mm ? `${roll.width_mm}mm` : "—"}
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

          <section className="rounded-2xl border border-line bg-surface-1 p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[11px] font-black uppercase tracking-wider text-content-3">
                  Machine assignment detail
                </div>
                <div className="text-lg font-semibold text-content-1">
                  {selectedMachine?.name || "Select production line"}
                </div>
              </div>
              <span
                className={cn(
                  "rounded-full px-2.5 py-1 text-xs font-semibold",
                  canPushToOperator
                    ? "bg-success-bg text-success-fg"
                    : selectedMachineId
                      ? "bg-warning-bg text-warning-fg"
                      : "bg-surface-2 text-content-3",
                )}
              >
                {machineGateLabel}
              </span>
            </div>
            <div
              className={cn(
                "mt-3 rounded-xl border px-3 py-2 text-xs font-semibold",
                canPushToOperator
                  ? "border-success-border bg-success-bg text-success-fg"
                  : selectedMachineId
                    ? "border-warning-border bg-warning-bg text-warning-fg"
                    : "border-line bg-surface-2 text-content-3",
              )}
            >
              {machineGateHelp}
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-[1fr_auto]">
              <Select
                value={selectedMachineId}
                onValueChange={setSelectedMachineId}
                disabled={isReleasedToMachine || mutation.isPending}
              >
                <SelectTrigger
                  data-testid="wcm-machine-select"
                  className="h-11 rounded-xl border-line bg-surface-2"
                >
                  <SelectValue placeholder="Select machine..." />
                </SelectTrigger>
                <SelectContent>
                  {machineOptionsResolved.map((machine: any) => {
                    const machineState: MachineLiveState =
                      machine.state || "IDLE";
                    // Keep the already-assigned machine selectable even if it reads busy.
                    const isUnavailable =
                      (machineState === "RUNNING" || machineState === "DOWN") &&
                      String(machine.id) !== assignedMachineId;
                    return (
                      <SelectItem
                        key={machine.id}
                        value={machine.id}
                        disabled={isUnavailable}
                        className={cn(isUnavailable && "opacity-60")}
                      >
                        <span className="flex w-full items-center justify-between gap-3">
                          <span className="truncate font-semibold text-content-2">
                            {machine.name}
                          </span>
                          <MachineStateBadge
                            state={machineState}
                            currentJobNumber={machine.current_job_number}
                          />
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              <Button
                type="button"
                data-testid="wcm-assign-release"
                className={cn(
                  "h-11 rounded-xl px-5 font-semibold text-white",
                  canPushToOperator
                    ? "bg-success-fg hover:bg-success-fg"
                    : "bg-surface-3 hover:bg-line",
                )}
                disabled={
                  isReleasedToMachine ||
                  !activeAssignment ||
                  !selectedMachineId ||
                  selectedMachineUnavailable ||
                  mutation.isPending
                }
                onClick={handleAssignAndMaybeRelease}
              >
                {isReleasedToMachine
                  ? "Execution ready"
                  : canPushToOperator
                    ? "Assign + release"
                    : selectedMachineId
                      ? "Save machine"
                      : "Assign machine"}
              </Button>
            </div>
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

          <section
            className={cn(
              "rounded-2xl border p-5 shadow-sm",
              cylinderGateOk && !detailMaterialBlocked
                ? "border-success-border bg-success-bg"
                : "border-danger-border bg-danger-bg",
            )}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-[11px] font-black uppercase tracking-wider text-content-3">
                  Cylinders & artwork detail
                </div>
                <div className="mt-1 text-lg font-semibold text-content-1">
                  {detailCylinderStatus === "MISSING"
                    ? "Cylinder or artwork missing"
                    : "Print readiness checked"}
                </div>
                <p className="mt-1 text-xs font-medium text-content-3">
                  Queue serializer truth: ink colors, cylinder readiness, and
                  material blocking are shown here before release.
                </p>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <CylinderReadyChip
                  status={detailCylinderStatus}
                  ready={detailCylinderReady}
                />
                <MaterialBlockChip
                  blocked={detailMaterialBlocked}
                  reason={detailMaterialBlockReason}
                />
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border border-surface-1 bg-surface-1/80 px-3 py-2">
              <InkColorSwatches colors={detailInkColors} />
              {!detailInkColors.length ? (
                <span className="text-xs font-semibold text-content-3">
                  No print ink colors required or artwork not attached for this
                  step.
                </span>
              ) : null}
            </div>
          </section>

          <section className="rounded-2xl border border-line bg-surface-1 p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] font-black uppercase tracking-wider text-content-3">
                  Material issue detail
                </div>
                <div className="text-lg font-semibold text-content-1">
                  Current-step issue
                </div>
                <p className="mt-1 text-xs font-medium text-content-3">
                  Issue input material only. Returns, scrap, and variance stay
                  on machine output.
                </p>
              </div>
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
            {granuleIssueRows.length ? (
              <div className="mt-4 rounded-2xl border border-success-border bg-success-bg p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-wider text-success-fg">
                      Granule issue card
                    </div>
                    <p className="mt-1 text-xs font-semibold text-success-fg">
                      Every granule issue must name the actual granule code
                      split before release.
                    </p>
                  </div>
                  <span
                    className={cn(
                      "rounded-full px-2.5 py-1 text-xs font-bold",
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
                    {granuleIssueRows.length} granule row
                    {granuleIssueRows.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="mt-3 grid gap-2">
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
                        key={`granule-summary-${requirementId || materialName}`}
                        className="rounded-xl border border-surface-1 bg-surface-1 px-3 py-2"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="text-sm font-black text-content-1">
                              {materialName}
                            </div>
                            <div className="mt-0.5 text-[11px] font-semibold text-content-3">
                              Need{" "}
                              {materialIssueQtyLabel(
                                materialIssueTargetKg(row),
                                row,
                              )}{" "}
                              · Stock{" "}
                              {materialIssueQtyLabel(
                                materialIssueAvailableKg(row),
                                row,
                              )}{" "}
                              · {codeOptions.length} code option
                              {codeOptions.length === 1 ? "" : "s"}
                            </div>
                          </div>
                          <span
                            className={cn(
                              "rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider",
                              splitOk && codeOptions.length
                                ? "bg-success-bg text-success-fg"
                                : "bg-danger-bg text-danger-fg",
                            )}
                          >
                            {splitOk && codeOptions.length
                              ? "Code split ready"
                              : codeOptions.length
                                ? "Split mismatch"
                                : "No coded stock"}
                          </span>
                        </div>
                        <div className="mt-2 text-xs font-semibold text-content-3">
                          Code split {allocatedKg.toFixed(3)} /{" "}
                          {Math.max(0, issuedKg).toFixed(3)} kg
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
            {currentStepPolicyItems.length ? (
              <div className="mt-4 rounded-2xl border border-info-border bg-info-bg p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-wider text-primary">
                      Template policy and WCM override
                    </div>
                    <p className="mt-1 text-xs font-semibold text-primary">
                      Template issue rules are shown first. Change only the row
                      that needs a real shop-floor issue exception.
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
                        className="rounded-xl border border-info-border bg-surface-1 p-3"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-black text-content-1">
                              {item.material_name}
                            </div>
                            <div className="mt-0.5 text-[11px] font-semibold text-content-3">
                              {item.category_code || "Material"} · Theory{" "}
                              {Number(item.theoretical_qty || 0).toFixed(3)} kg
                              · Issue plan{" "}
                              {Number(item.planned_issue_qty || 0).toFixed(3)}{" "}
                              kg
                            </div>
                          </div>
                          <span
                            className={cn(
                              "rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wider",
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
                        <div className="mt-3 grid gap-2 lg:grid-cols-[1fr_1fr_132px_1fr]">
                          <div className="rounded-lg border border-line bg-surface-2 px-3 py-2">
                            <div className="text-[10px] font-black uppercase tracking-wide text-content-3">
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
                            <SelectTrigger className="h-10 rounded-lg border-line bg-surface-1 text-xs font-semibold">
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
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
            <div
              className={cn(
                "mt-4 space-y-2.5",
                isReleasedToMachine && "pointer-events-none opacity-75",
              )}
            >
              {materialIssueRows.length === 0 ? (
                <div className="rounded-xl border border-dashed border-line bg-surface-2 p-4 text-sm font-medium text-content-3">
                  No current-step material issue is needed for this step.
                </div>
              ) : (
                materialIssueRows.map((row: any, index: number) => {
                  const requirementId = String(row?.requirement_id || "");
                  const issueTarget = materialIssueTargetKg(row);
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
                  const isGranule = materialIssueKind(row) === "GRANULE";
                  const allocations =
                    draft.granule_code_allocations &&
                    draft.granule_code_allocations.length
                      ? draft.granule_code_allocations
                      : isGranule && codeOptions.length
                        ? [
                            {
                              granule_code_id: String(
                                codeOptions[0]?.granule_code_id || "",
                              ),
                              qty_kg:
                                issueTarget > 0 ? issueTarget.toFixed(3) : "",
                            },
                          ]
                        : [];
                  const issuedKg = Number(draft.actual_issued_qty || 0);
                  const allocatedKg = allocations.reduce(
                    (sum, item) => sum + Number(item.qty_kg || 0),
                    0,
                  );
                  const splitOk =
                    !isGranule ||
                    issuedKg <= 0 ||
                    Math.abs(allocatedKg - issuedKg) <= 0.0001;
                  const overPick = overPickInfoByRequirement.get(requirementId);
                  const rowErrors = materialIssueErrors.filter((error) =>
                    error.startsWith(`${materialName}:`),
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
                                "rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider",
                                isGranule
                                  ? "bg-success-bg text-success-fg"
                                  : "bg-info-bg text-primary",
                              )}
                            >
                              {materialIssueKindLabel(row)}
                            </span>
                          </div>
                          <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] font-semibold text-content-3">
                            <span>
                              Need{" "}
                              {issueTarget > 0
                                ? materialIssueQtyLabel(issueTarget, row)
                                : "not planned"}
                            </span>
                            <span>·</span>
                            <span>
                              Stock {materialIssueQtyLabel(availableKg, row)}
                            </span>
                            {row?.location_name ? (
                              <>
                                <span>·</span>
                                <span>{row.location_name}</span>
                              </>
                            ) : null}
                          </div>
                        </div>
                        <label className="block">
                          <span className="mb-1 block text-[10px] font-black uppercase tracking-wider text-content-3">
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
                        <div className="mt-3 rounded-xl border border-success-border bg-surface-1 p-2.5">
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <div className="text-[11px] font-semibold text-success-fg">
                              Code split {allocatedKg.toFixed(3)} /{" "}
                              {Math.max(0, issuedKg).toFixed(3)} kg
                            </div>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8 rounded-lg border-success-border px-2.5 text-xs font-semibold"
                              disabled={
                                !requirementId || codeOptions.length === 0
                              }
                              onClick={() =>
                                updateMaterialIssueDraft(requirementId, {
                                  granule_code_allocations: [
                                    ...allocations,
                                    {
                                      granule_code_id: String(
                                        codeOptions[0]?.granule_code_id || "",
                                      ),
                                      qty_kg: "",
                                    },
                                  ],
                                  is_estimated: false,
                                })
                              }
                            >
                              Add code
                            </Button>
                          </div>
                          {codeOptions.length === 0 ? (
                            <div className="rounded-lg border border-warning-border bg-warning-bg px-3 py-2 text-xs font-semibold text-warning-fg">
                              No coded stock is available for this granule at
                              the issue location.
                            </div>
                          ) : (
                            <div className="space-y-2">
                              {allocations.map(
                                (allocation, allocationIndex) => (
                                  <div
                                    key={`${requirementId}-${allocationIndex}`}
                                    className="grid gap-2 md:grid-cols-[minmax(0,1fr)_112px_34px]"
                                  >
                                    <Select
                                      value={
                                        allocation.granule_code_id ||
                                        String(
                                          codeOptions[0]?.granule_code_id || "",
                                        )
                                      }
                                      onValueChange={(value) =>
                                        updateMaterialIssueDraft(
                                          requirementId,
                                          {
                                            granule_code_allocations:
                                              allocations.map(
                                                (item, rowIndex) =>
                                                  rowIndex === allocationIndex
                                                    ? {
                                                        ...item,
                                                        granule_code_id: value,
                                                      }
                                                    : item,
                                              ),
                                            is_estimated: false,
                                          },
                                        )
                                      }
                                    >
                                      <SelectTrigger className="h-9 rounded-lg border-line bg-surface-1 text-xs font-semibold">
                                        <SelectValue placeholder="Code" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {codeOptions.map((option: any) => (
                                          <SelectItem
                                            key={option.granule_code_id}
                                            value={String(
                                              option.granule_code_id,
                                            )}
                                          >
                                            {option.code} ·{" "}
                                            {Number(
                                              option.available_qty_kg || 0,
                                            ).toFixed(3)}{" "}
                                            kg
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                    <Input
                                      value={allocation.qty_kg}
                                      onChange={(event) =>
                                        updateMaterialIssueDraft(
                                          requirementId,
                                          {
                                            granule_code_allocations:
                                              allocations.map(
                                                (item, rowIndex) =>
                                                  rowIndex === allocationIndex
                                                    ? {
                                                        ...item,
                                                        qty_kg:
                                                          event.target.value,
                                                      }
                                                    : item,
                                              ),
                                            is_estimated: false,
                                          },
                                        )
                                      }
                                      placeholder="kg"
                                      className="h-9 rounded-lg border-line bg-surface-1 text-right text-xs font-semibold"
                                    />
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      className="h-9 w-9 rounded-lg text-content-4 hover:text-danger-fg"
                                      disabled={allocations.length <= 1}
                                      onClick={() =>
                                        updateMaterialIssueDraft(
                                          requirementId,
                                          {
                                            granule_code_allocations:
                                              allocations.filter(
                                                (_, rowIndex) =>
                                                  rowIndex !== allocationIndex,
                                              ),
                                            is_estimated: false,
                                          },
                                        )
                                      }
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </div>
                                ),
                              )}
                            </div>
                          )}
                          <div
                            className={cn(
                              "mt-2 text-[11px] font-semibold",
                              splitOk ? "text-success-fg" : "text-danger-fg",
                            )}
                          >
                            {splitOk
                              ? "Code split matches issued kg."
                              : "Code split must equal issued kg before release."}
                          </div>
                        </div>
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
            </div>
          </section>
        </>
      )}
      <section className="sticky bottom-0 z-10 rounded-[22px] border border-line bg-surface-1/95 p-3 shadow-[0_26px_70px_-45px_rgba(15,23,42,.55)] backdrop-blur">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-[240px] flex-1">
            <div className="text-[11px] font-black uppercase tracking-[0.18em] text-content-3">
              Release bar
            </div>
            <div
              className={cn(
                "text-sm font-bold",
                canPushToOperator ? "text-success-fg" : "text-content-2",
              )}
            >
              {isReleasedToMachine
                ? "Already released to machine terminal."
                : canPushToOperator
                  ? "All gates are clear. Release this job to the selected machine."
                  : pushBlockingReasons[0] ||
                    "Pick a job and clear the readiness gates."}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-11 rounded-xl border-line bg-surface-2 px-4 text-xs font-bold text-content-2"
              disabled={!canShortCloseActiveFromWcm}
              onClick={() => {
                if (!activeAssignment) return;
                setCloseJobAction({
                  assignment: activeAssignment,
                  mode: "SHORT_CLOSE",
                });
                setCloseJobReason("");
                setCloseJobReasonPreset("");
              }}
            >
              Close short…
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11 rounded-xl border-danger-border bg-danger-bg px-4 text-xs font-bold text-danger-fg hover:bg-danger-bg"
              disabled={!canCancelActiveFromWcm}
              onClick={() => {
                if (!activeAssignment) return;
                setCloseJobAction({
                  assignment: activeAssignment,
                  mode: "CANCEL",
                });
                setCloseJobReason("");
                setCloseJobReasonPreset("");
              }}
            >
              Cancel job
            </Button>
            <Button
              type="button"
              data-testid="wcm-sticky-release"
              className={cn(
                "h-11 rounded-xl px-5 text-sm font-black text-white shadow-md",
                canPushToOperator
                  ? "bg-success-fg hover:bg-success-fg"
                  : "bg-surface-3 hover:bg-line",
              )}
              disabled={
                isReleasedToMachine ||
                !activeAssignment ||
                !selectedMachineId ||
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
      <header className="sticky top-0 z-30 border-b border-primary bg-[#10233f]/95 text-white shadow-[0_18px_50px_-35px_rgba(15,23,42,.75)] backdrop-blur-xl">
        <div className="flex h-14 w-full items-center gap-4 px-6">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-sm font-black text-white shadow-sm">
            W
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold tracking-tight">
              ERP · Production
            </div>
            <div className="text-[11px] text-info-border">
              Work Center Terminal
            </div>
          </div>
          <nav className="ml-4 hidden items-center gap-1 md:flex">
            <button
              type="button"
              onClick={() => setActiveMainTab("terminal")}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm transition",
                activeMainTab === "terminal"
                  ? "bg-surface-1 text-[#10233f]"
                  : "text-info-border hover:bg-surface-1/10",
              )}
            >
              Queue
            </button>
            <button
              type="button"
              onClick={() => setActiveMainTab("running")}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm transition",
                activeMainTab === "running"
                  ? "bg-surface-1 text-[#10233f]"
                  : "text-info-border hover:bg-surface-1/10",
              )}
            >
              Running / ready
            </button>
            <button
              type="button"
              data-testid="wcm-stalled-tab"
              onClick={() => setActiveMainTab("stalled")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition",
                activeMainTab === "stalled"
                  ? "bg-warning-fg text-[#10233f]"
                  : "text-info-border hover:bg-surface-1/10",
              )}
            >
              <TriangleAlert className="size-3.5" />
              Stalled
              {stalledJobsList.length > 0 ? (
                <span
                  className={cn(
                    "rounded-full px-1.5 font-mono text-[10px] font-bold tabular-nums",
                    activeMainTab === "stalled"
                      ? "bg-surface-1/25 text-white"
                      : "bg-warning-bg text-warning-fg",
                  )}
                >
                  {stalledJobsList.length}
                </span>
              ) : null}
            </button>
            <a
              className="rounded-md px-3 py-1.5 text-sm text-info-border transition hover:bg-surface-1/10"
              href={
                selectedMachineId
                  ? `/production/machine/${selectedMachineId}`
                  : "/production/machine-selector"
              }
            >
              Machine Terminal
            </a>
            <button
              type="button"
              onClick={() => setActiveMainTab("history")}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm transition",
                activeMainTab === "history"
                  ? "bg-surface-1 text-[#10233f]"
                  : "text-info-border hover:bg-surface-1/10",
              )}
            >
              History
            </button>
          </nav>
          <div className="ml-auto hidden items-center gap-3 text-xs text-info-border md:flex">
            <span className="font-mono tabular-nums text-info-border">
              {new Date(nowTick).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span
                className={cn(
                  "h-2 w-2 rounded-full",
                  !online
                    ? "bg-danger-solid shadow-[0_0_0_5px_rgba(244,63,94,0.12)]"
                    : isStaleSync
                      ? "bg-warning-fg shadow-[0_0_0_5px_rgba(245,158,11,0.12)]"
                      : "bg-success-fg shadow-[0_0_0_5px_rgba(16,185,129,0.12)]",
                )}
              />
              {!online
                ? "Offline"
                : secondsSinceQueueSync == null
                  ? "Connecting…"
                  : `Synced ${secondsSinceQueueSync}s ago`}
            </span>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1660px] px-5 py-6 lg:px-8">
        <section className="overflow-hidden rounded-[26px] bg-gradient-to-br from-[#143b70] via-[#1e4f8f] to-[#263d86] p-5 text-white shadow-[0_26px_70px_-42px_rgba(15,23,42,.7)]">
          <div className="flex flex-wrap items-end gap-4">
            <div className="min-w-[280px] flex-1">
              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-info-border">
                <span>
                  {workCenter?.plant_name ||
                    (workCenter as any)?.plant?.name ||
                    "Production plant"}
                </span>
                <span>·</span>
                <span data-testid="wcm-shift-label">{shiftLabel}</span>
                <span>·</span>
                <span
                  className="font-mono tabular-nums"
                  data-testid="wcm-live-clock"
                >
                  {new Date(nowTick).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </span>
              </div>
              <h1 className="mt-1 text-[30px] font-black tracking-tight text-white">
                {workCenter?.name ||
                  (activeAssignment as any)?.work_center_name ||
                  "Work Center"}
                <span className="text-xl font-semibold text-info-border">
                  {" · "}
                  {activeMainTab === "running"
                    ? "Running / ready"
                    : activeMainTab === "history"
                      ? "History"
                      : activeMainTab === "stalled"
                        ? "Stalled jobs"
                        : "Queue"}
                </span>
              </h1>
              <p className="mt-1 max-w-3xl text-sm font-semibold text-info-border">
                Plan to ready to release. Pick one job, clear the readiness
                gates, then send it to the machine terminal.
              </p>
            </div>
            <div className="grid w-full grid-cols-2 gap-3 md:w-auto md:grid-cols-4">
              {[
                ["Running / ready", visibleRunningAssignments.length],
                ["Waiting", stats.waiting],
                ["Queue", visibleQueueAssignments.length],
                ["No machine", queueCounts.noMachine],
              ].map(([label, value]) => (
                <div
                  key={String(label)}
                  className="rounded-xl border border-surface-1/10 bg-surface-1/10 px-4 py-3 shadow-sm"
                >
                  <div className="text-[11px] font-black uppercase tracking-wider text-info-border">
                    {label}
                  </div>
                  {showStatsSkeleton ? (
                    <Skeleton className="mt-1 h-6 w-10 bg-surface-1/20" />
                  ) : (
                    <div className="text-xl font-black tabular-nums text-white">
                      {value}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {activeMainTab === "stalled" ? (
          <StalledJobsPanel
            jobs={stalledJobsList}
            isLoading={isLoadingStalled && stalledJobsList.length === 0}
            isFetching={isFetchingStalled}
            onRefresh={() => refetchStalled()}
            className="mt-5"
          />
        ) : (
          <>
            <section className="mt-5 rounded-[20px] border border-line bg-surface-1/95 p-4 shadow-[0_26px_70px_-50px_rgba(15,23,42,.45)]">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-4" />
                  <Input
                    value={queueSearch}
                    onChange={(event) => setQueueSearch(event.target.value)}
                    placeholder="Search by customer, SO #, product, size, grade, addon..."
                    className="h-11 rounded-xl border-line bg-surface-2 pl-10 pr-20 text-sm"
                  />
                  <div className="absolute right-2 top-1/2 hidden -translate-y-1/2 items-center gap-1 md:flex">
                    <span className="rounded-md border border-line bg-surface-1 px-1.5 py-0.5 font-mono text-[11px] text-content-3">
                      ⌘
                    </span>
                    <span className="rounded-md border border-line bg-surface-1 px-1.5 py-0.5 font-mono text-[11px] text-content-3">
                      K
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {(
                    [
                      ["ALL", `Queue · ${queueCounts.all}`, queueCounts.all],
                      [
                        "READY",
                        `WC Ready · ${queueCounts.ready}`,
                        queueCounts.ready,
                      ],
                      [
                        "ASSIGNED",
                        `Assigned · ${queueCounts.assigned}`,
                        queueCounts.assigned,
                      ],
                      [
                        "NEEDS_MACHINE",
                        `No Machine · ${queueCounts.noMachine}`,
                        queueCounts.noMachine,
                      ],
                    ] as const
                  ).map(([value, label, count]) => {
                    const isActive =
                      activeMainTab !== "running" &&
                      activeMainTab !== "history" &&
                      queueStatusFilter === value;
                    // "ALL" is always available as a reset; other chips disable at count 0.
                    const isEmptyDisabled =
                      value !== "ALL" && count === 0 && !isActive;
                    return (
                      <button
                        key={value}
                        type="button"
                        disabled={isEmptyDisabled}
                        onClick={() => {
                          setActiveMainTab("terminal");
                          setQueueStatusFilter(value);
                        }}
                        className={cn(
                          "h-9 rounded-lg border px-3 text-sm font-medium transition",
                          isActive
                            ? "border-[#10233f] bg-[#10233f] text-white"
                            : "border-line bg-surface-1 text-content-2 hover:bg-surface-2",
                          isEmptyDisabled &&
                            "cursor-not-allowed opacity-40 hover:bg-surface-1",
                        )}
                      >
                        {label}
                      </button>
                    );
                  })}
                  <Select
                    value={queueSortKey}
                    onValueChange={(value) =>
                      setQueueSortKey(value as typeof queueSortKey)
                    }
                  >
                    <SelectTrigger className="h-9 w-[200px] rounded-lg border border-line bg-surface-1 text-sm font-medium text-content-2">
                      <SelectValue placeholder="Sort by" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PRIORITY_ASC">
                        Priority · highest first
                      </SelectItem>
                      <SelectItem value="PRIORITY_DESC">
                        Priority · lowest first
                      </SelectItem>
                      <SelectItem value="SO_DATE">
                        SO date · oldest first
                      </SelectItem>
                      <SelectItem value="CUSTOMER">Customer (A→Z)</SelectItem>
                      <SelectItem value="MACHINE">Machine (A→Z)</SelectItem>
                    </SelectContent>
                  </Select>
                  <button
                    type="button"
                    onClick={() => setActiveMainTab("running")}
                    className={cn(
                      "h-9 rounded-lg border px-3 text-sm font-medium transition",
                      activeMainTab === "running"
                        ? "border-success-border bg-success-fg text-white"
                        : "border-success-border bg-success-bg text-success-fg hover:bg-success-bg",
                    )}
                  >
                    Running / ready · {visibleRunningAssignments.length}
                  </button>
                </div>
              </div>
              {(queueSearch || queueStatusFilter !== "ALL") && (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-xs">
                  <span className="text-content-3">Filters:</span>
                  {queueSearch && (
                    <span className="rounded-full border border-line bg-surface-2 px-2 py-1 font-medium text-content-3">
                      Search · {queueSearch}
                    </span>
                  )}
                  {queueStatusFilter !== "ALL" && (
                    <span className="rounded-full border border-line bg-surface-2 px-2 py-1 font-medium text-content-3">
                      Status · {queueStatusFilter}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setQueueSearch("");
                      setQueueStatusFilter("ALL");
                    }}
                    className="font-semibold text-primary hover:underline"
                  >
                    Clear all
                  </button>
                </div>
              )}
            </section>

            <section
              className={cn(
                "mt-5 grid gap-5",
                activeMainTab === "history"
                  ? "xl:grid-cols-1"
                  : "xl:grid-cols-[360px_minmax(0,1fr)]",
              )}
            >
              <div
                className={cn(
                  "space-y-3",
                  activeMainTab === "history"
                    ? "xl:col-span-1"
                    : "max-h-[calc(100vh-300px)] overflow-y-auto pr-2 xl:col-span-1",
                )}
              >
                {activeMainTab === "history" ? (
                  <div className="rounded-2xl border border-line bg-surface-1 p-6 shadow-sm">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <div className="text-[11px] uppercase tracking-wider text-content-3">
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
                                      className="rounded-full border border-line bg-surface-1 px-2 py-0.5 text-[11px] font-semibold text-content-2"
                                    >
                                      {layerQueueLabel(layer)}
                                    </span>
                                  ))}
                                  {spec.podLabels.map((label) => (
                                    <span
                                      key={`${assignment.id}-pod-${label}`}
                                      className="rounded-full border border-info-border bg-surface-1 px-2 py-0.5 text-[11px] font-semibold text-info-fg"
                                    >
                                      PoD · {label}
                                    </span>
                                  ))}
                                  {spec.addonLabels.map((label) => (
                                    <span
                                      key={`${assignment.id}-addon-${label}`}
                                      className="rounded-full border border-warning-border bg-surface-1 px-2 py-0.5 text-[11px] font-semibold text-warm"
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
                                      <span className="font-black uppercase tracking-wider text-content-3">
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
                              <Badge variant="outline">
                                {job.job_state || job.status || "Closed"}
                              </Badge>
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
                ) : showQueueSkeleton ? (
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
                      }}
                    >
                      Clear filters
                    </Button>
                  </div>
                ) : (
                  currentWorkList.map((assignment: any) => {
                    const job = assignment?.job_details || {};
                    const spec = normalizeProductSpec(job);
                    const status = String(
                      assignment?.status || "WC_READY",
                    ).toUpperCase();
                    const isQueueReleased = status === "EXECUTION_READY";
                    const jobState = String(job?.job_state || "").toUpperCase();
                    const jobStatus = String(job?.status || "").toUpperCase();
                    const hasStartedExecution =
                      jobState === "EXECUTING" ||
                      jobState === "PAUSED" ||
                      jobStatus === "RUNNING" ||
                      Number(
                        job?.produced_qty || job?.step_produced_primary || 0,
                      ) > 0;
                    const canCancelFromWcm =
                      activeMainTab !== "running" || !hasStartedExecution;
                    const canShortCloseFromWcm =
                      activeMainTab === "running" && hasStartedExecution;
                    const queueOutputFormRaw = String(
                      job?.output_form ||
                        spec.size.finishedGoodType ||
                        "OUTPUT",
                    ).toUpperCase();
                    const queueInputFormRaw = String(
                      job?.input_form || "",
                    ).toUpperCase();
                    const queueOrderUom = String(job?.uom || "").toUpperCase();
                    const queuePrimaryUom = String(
                      job?.primary_uom ||
                        (queueOrderUom === "PCS" &&
                        queueOutputFormRaw === "BULK" &&
                        queueInputFormRaw === "ROLL"
                          ? "PCS"
                          : "KG"),
                    ).toUpperCase() as "KG" | "PCS";
                    const queuePrimaryDecimals =
                      queuePrimaryUom === "PCS" ? 0 : 3;
                    const target =
                      toNullableNumber(job?.step_target_primary) ??
                      Number(job?.step_target_kg || job?.quantity || 0);
                    const remaining = toNullableNumber(
                      job?.step_remaining_primary,
                    );
                    const produced = Math.max(
                      0,
                      Number(target || 0) - Number(remaining ?? target ?? 0),
                    );
                    const percent =
                      target && target > 0
                        ? Math.min(100, Math.max(0, (produced / target) * 100))
                        : 0;
                    const priority = Number(job?.priority ?? 50);
                    // Two-emerald fix: priority uses a violet→amber→rose intensity ramp,
                    // kept distinct from the status palette (sky/emerald/slate/cyan).
                    const rail =
                      priority >= 80
                        ? "from-danger-solid via-danger-fg to-danger-fg"
                        : priority >= 50
                          ? "from-warning-fg via-warning-fg to-warning-fg"
                          : "from-order-fg via-order-fg to-order-fg";
                    const priorityPill =
                      priority >= 80
                        ? "border-danger-border bg-danger-bg text-danger-fg"
                        : priority >= 50
                          ? "border-warning-border bg-warning-bg text-warning-fg"
                          : "border-order-border bg-order-bg text-order-fg";
                    // Queue-row enrichment from the WCM queue serializer.
                    const inkColors: string[] = Array.isArray(
                      (assignment as any)?.ink_colors,
                    )
                      ? (assignment as any).ink_colors
                      : [];
                    const cylinderStatus = (assignment as any)
                      ?.cylinder_status as
                      | "READY"
                      | "MISSING"
                      | "NA"
                      | undefined;
                    const cylinderReady = (assignment as any)
                      ?.cylinder_ready as boolean | undefined;
                    const materialBlocked = Boolean(
                      (assignment as any)?.material_blocked,
                    );
                    const materialBlockReason = String(
                      (assignment as any)?.material_block_reason || "",
                    );
                    const elapsedMinutes = (assignment as any)
                      ?.elapsed_minutes as number | null | undefined;
                    const isStalledRow = Boolean(
                      (assignment as any)?.is_stalled,
                    );
                    const queueSkuLabel = firstNonEmpty(
                      (job as any)?.sku_name,
                      (job as any)?.sku_display_name,
                      spec.variantName,
                      (job as any)?.sku_variant_name,
                      spec.variantCode,
                      (job as any)?.sku_variant_code,
                    );
                    const queueTargetStockContract = ((assignment as any)
                      ?.target_stock_contract ||
                      (job as any)?.target_stock_contract ||
                      {}) as Record<string, any>;
                    const queueTargetStockForm = firstNonEmpty(
                      queueTargetStockContract.stock_form,
                      (job as any)?.stock_form,
                      (job as any)?.geometry?.stock_form,
                      (job as any)?.geometry_snapshot?.stock_form,
                      "OPEN_WEB",
                    );
                    const queueTargetWidthBasis = firstNonEmpty(
                      queueTargetStockContract.width_basis,
                      (job as any)?.width_basis,
                      (job as any)?.geometry?.width_basis,
                      (job as any)?.geometry_snapshot?.width_basis,
                    );
                    const queueTargetWidth = toNullableNumber(
                      queueTargetStockContract.width_mm ??
                        queueTargetStockContract.film_area_width_mm ??
                        (job as any)?.geometry?.child_target_width_mm ??
                        (job as any)?.geometry_snapshot?.child_target_width_mm,
                    );
                    const queueFinalProduct = [
                      queueOutputFormRaw,
                      spec.size.label,
                      spec.layers.length
                        ? `${spec.layers.length} layer${spec.layers.length > 1 ? "s" : ""}`
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" · ");
                    const queueFinalQtyReq = `${formatSmartValue(target || 0, queuePrimaryUom, queuePrimaryDecimals)} ${queuePrimaryUom}`;
                    const showQueueSkuLine =
                      queueSkuLabel &&
                      queueSkuLabel.toLowerCase() !==
                        String(spec.productName || "").toLowerCase();
                    return (
                      <article
                        key={assignment.id}
                        data-testid={`wcm-assignment-row-${assignment.id}`}
                        role="button"
                        tabIndex={0}
                        aria-pressed={activeAssignmentId === assignment.id}
                        onClick={() => {
                          setActiveAssignmentId(assignment.id);
                          setDetailSheetOpen(true);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setActiveAssignmentId(assignment.id);
                            setDetailSheetOpen(true);
                          }
                        }}
                        className={cn(
                          "cursor-pointer overflow-hidden rounded-2xl border bg-surface-1 shadow-sm transition hover:border-line-strong hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
                          materialBlocked
                            ? "border-danger-border ring-1 ring-danger-border"
                            : activeAssignmentId === assignment.id
                              ? "border-primary ring-2 ring-info-border"
                              : "border-line",
                        )}
                      >
                        <div className="flex flex-col xl:flex-row">
                          <div
                            className={cn(
                              "h-1 w-full bg-gradient-to-r xl:h-auto xl:w-1.5 xl:bg-gradient-to-b",
                              materialBlocked
                                ? "from-danger-solid via-danger-solid to-danger-solid"
                                : rail,
                            )}
                          />
                          <div className="flex-1 p-5">
                            <div className="flex flex-wrap items-start gap-3">
                              <div className="min-w-[240px] flex-1">
                                <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-content-3">
                                  <span>Sales Order</span>
                                  <span className="text-content-4">/</span>
                                  <span>Customer</span>
                                </div>
                                <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                                  <span className="text-xl font-semibold tracking-tight text-content-1">
                                    {job.customer_name ||
                                      spec.customerName ||
                                      "Customer not captured"}
                                  </span>
                                  <span className="font-semibold text-primary">
                                    {job.order_number ||
                                      spec.orderNumber ||
                                      "SO not captured"}
                                  </span>
                                </div>
                                <div className="mt-0.5 text-sm font-semibold text-content-3">
                                  <span className="font-medium text-content-2">
                                    {spec.productName}
                                  </span>
                                  {showQueueSkuLine ? (
                                    <span className="text-content-4">
                                      {" "}
                                      ·{" "}
                                      <span className="text-content-2">
                                        {queueSkuLabel}
                                      </span>
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <span
                                  className={cn(
                                    "inline-flex rounded-full px-2.5 py-1 text-xs font-semibold",
                                    status === "EXECUTION_READY"
                                      ? "bg-success-bg text-success-fg"
                                      : status === "ASSIGNED"
                                        ? "bg-info-bg text-info-fg"
                                        : "bg-info-bg text-info-fg",
                                  )}
                                >
                                  {status === "EXECUTION_READY"
                                    ? "✓ Execution Ready"
                                    : status === "ASSIGNED"
                                      ? `● Assigned${assignment.assigned_machine_name ? ` to ${assignment.assigned_machine_name}` : ""}`
                                      : "◷ WC Ready"}
                                </span>
                                <span
                                  className={cn(
                                    "rounded-full border px-2.5 py-1 text-xs font-semibold",
                                    priorityPill,
                                  )}
                                >
                                  ▲ Priority {priority}
                                </span>
                                <span className="rounded-full border border-order-border bg-order-bg px-2.5 py-1 text-xs font-semibold text-order-fg">
                                  {queueInputFormRaw || "INPUT"} →{" "}
                                  {queueOutputFormRaw || "OUTPUT"}
                                </span>
                              </div>
                            </div>

                            {inkColors.length > 0 ||
                            (cylinderStatus && cylinderStatus !== "NA") ||
                            materialBlocked ||
                            isStalledRow ||
                            (activeMainTab === "running" &&
                              typeof elapsedMinutes === "number") ? (
                              <div className="mt-3 flex flex-wrap items-center gap-2">
                                <InkColorSwatches colors={inkColors} />
                                <CylinderReadyChip
                                  status={cylinderStatus}
                                  ready={cylinderReady}
                                />
                                <MaterialBlockChip
                                  blocked={materialBlocked}
                                  reason={materialBlockReason}
                                />
                                {activeMainTab === "running" ? (
                                  <ElapsedStalledBadge
                                    elapsedMinutes={elapsedMinutes}
                                    isStalled={isStalledRow}
                                  />
                                ) : isStalledRow ? (
                                  <ElapsedStalledBadge
                                    elapsedMinutes={elapsedMinutes}
                                    isStalled
                                  />
                                ) : null}
                              </div>
                            ) : null}

                            <div className="mt-3 flex flex-wrap gap-1.5">
                              <span className="rounded-full border border-info-border bg-info-bg px-2.5 py-1 text-xs font-semibold text-primary">
                                Size · {spec.size.label}
                              </span>
                              <span className="rounded-full border border-order-border bg-order-bg px-2.5 py-1 text-xs font-semibold text-order-fg">
                                Target stock ·{" "}
                                {stockFormLabel(queueTargetStockForm)}
                                {queueTargetWidthBasis
                                  ? ` · ${widthBasisLabel(queueTargetWidthBasis)}`
                                  : ""}
                                {queueTargetWidth && queueTargetWidth > 0
                                  ? ` · ${queueTargetWidth.toLocaleString(undefined, { maximumFractionDigits: 2 })} mm`
                                  : ""}
                              </span>
                              <span
                                className={cn(
                                  "rounded-full border px-2.5 py-1 text-xs font-semibold",
                                  materialBlocked
                                    ? "border-danger-border bg-danger-bg text-danger-fg"
                                    : "border-success-border bg-success-bg text-success-fg",
                                )}
                              >
                                {materialBlocked
                                  ? "Material blocked"
                                  : "Material gate clear"}
                              </span>
                              <span
                                className={cn(
                                  "rounded-full border px-2.5 py-1 text-xs font-semibold",
                                  Number(
                                    (assignment as any)?.allocated_roll_details
                                      ?.length || 0,
                                  ) > 0
                                    ? "border-info-border bg-info-bg text-primary"
                                    : "border-line bg-surface-2 text-content-3",
                                )}
                              >
                                Rolls ·{" "}
                                {Number(
                                  (assignment as any)?.allocated_roll_details
                                    ?.length || 0,
                                )}
                              </span>
                              {spec.layers.slice(0, 4).map((layer) => (
                                <span
                                  key={`${assignment.id}-layer-${layer.index}`}
                                  className="rounded-full border border-success-border bg-success-bg px-2.5 py-1 text-xs font-semibold text-success-fg"
                                >
                                  {layerQueueLabel(layer)}
                                </span>
                              ))}
                              {spec.podLabels.map((label) => (
                                <span
                                  key={label}
                                  className="rounded-full border border-info-border bg-info-bg px-2.5 py-1 text-xs font-semibold text-info-fg"
                                >
                                  PoD · {label}
                                </span>
                              ))}
                              {spec.addonLabels.map((label) => (
                                <span
                                  key={label}
                                  className="rounded-full border border-warning-border bg-warm px-2.5 py-1 text-xs font-semibold text-warm"
                                >
                                  + {label}
                                </span>
                              ))}
                            </div>

                            <div className="mt-4 grid items-center gap-4">
                              <div>
                                <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-content-3">
                                  <span>
                                    Step{" "}
                                    {Number(job.current_step_index ?? 0) + 1} ·{" "}
                                    {job.process_code || selectedStepName}
                                  </span>
                                  <span>{Math.round(percent)}%</span>
                                </div>
                                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-2">
                                  <span
                                    className="block h-full rounded-full bg-gradient-to-r from-primary to-primary"
                                    style={{ width: `${percent}%` }}
                                  />
                                </div>
                                <div className="mt-2 flex flex-wrap items-start gap-x-5 gap-y-2">
                                  <div>
                                    <div className="text-lg font-semibold tabular-nums">
                                      {formatSmartValue(
                                        target || 0,
                                        queuePrimaryUom,
                                        queuePrimaryDecimals,
                                      )}{" "}
                                      <span className="text-sm font-medium text-content-4">
                                        {queuePrimaryUom}
                                      </span>
                                    </div>
                                    <div className="text-[11px] uppercase tracking-wider text-content-3">
                                      Step target
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-lg font-semibold tabular-nums">
                                      {formatSmartValue(
                                        remaining ?? 0,
                                        queuePrimaryUom,
                                        queuePrimaryDecimals,
                                      )}{" "}
                                      <span className="text-sm font-medium text-content-4">
                                        {queuePrimaryUom}
                                      </span>
                                    </div>
                                    <div className="text-[11px] uppercase tracking-wider text-content-3">
                                      Remaining
                                    </div>
                                  </div>
                                  <div className="min-w-[180px] max-w-[280px]">
                                    <div className="text-lg font-semibold tabular-nums text-success-fg">
                                      {queueFinalQtyReq}
                                    </div>
                                    <div className="text-xs font-semibold leading-snug text-success-fg">
                                      {queueFinalProduct}
                                    </div>
                                    <div className="text-[11px] uppercase tracking-wider text-content-3">
                                      Final output req
                                    </div>
                                  </div>
                                </div>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <span className="rounded-full border border-line bg-surface-2 px-2.5 py-1 text-xs font-medium text-content-3">
                                  Machine ·{" "}
                                  {assignment.assigned_machine_name || "assign"}
                                </span>
                                <TooltipProvider delayDuration={100}>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="rounded-full border border-line bg-surface-2 px-2.5 py-1 text-xs font-medium text-content-3">
                                        WIP ·{" "}
                                        {Number(
                                          (assignment as any)
                                            ?.allocated_roll_details?.length ||
                                            0,
                                        )}{" "}
                                        rolls
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent
                                      side="top"
                                      className="max-w-[320px] rounded-xl border-line bg-surface-1 p-3 text-content-2 shadow-xl"
                                    >
                                      <div className="text-[11px] font-black uppercase tracking-wider text-content-3">
                                        WIP rolls in this flow
                                      </div>
                                      <div className="mt-2 space-y-1">
                                        {Array.isArray(
                                          (assignment as any)
                                            ?.allocated_roll_details,
                                        ) &&
                                        (assignment as any)
                                          .allocated_roll_details.length ? (
                                          (
                                            assignment as any
                                          ).allocated_roll_details
                                            .slice(0, 6)
                                            .map((roll: any) => (
                                              <div
                                                key={String(
                                                  roll.id || roll.label_id,
                                                )}
                                                className="flex justify-between gap-4 text-xs"
                                              >
                                                <span className="font-semibold">
                                                  {roll.label_id ||
                                                    roll.roll_number ||
                                                    "Roll"}
                                                </span>
                                                <span className="text-content-3">
                                                  {Number(
                                                    roll.current_qty ||
                                                      roll.quantity_kg ||
                                                      roll.net_weight_kg ||
                                                      0,
                                                  ).toFixed(3)}{" "}
                                                  kg
                                                </span>
                                              </div>
                                            ))
                                        ) : (
                                          <div className="text-xs text-content-3">
                                            No WIP rolls assigned yet.
                                          </div>
                                        )}
                                      </div>
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                                <span className="rounded-full border border-line bg-surface-2 px-2.5 py-1 text-xs font-medium text-content-3">
                                  Order placed ·{" "}
                                  {formatDateLabel(
                                    job.order_placed_at || job.created_at,
                                  )}
                                </span>
                              </div>
                              <div className="flex justify-end gap-2">
                                {activeMainTab === "running" ? (
                                  <a
                                    href={
                                      assignment.assigned_machine
                                        ? `/production/machine/${assignment.assigned_machine}`
                                        : "#"
                                    }
                                    onClick={(event) => {
                                      if (!assignment.assigned_machine)
                                        event.preventDefault();
                                    }}
                                    className={cn(
                                      "inline-flex h-10 items-center rounded-xl px-4 text-sm font-semibold",
                                      assignment.assigned_machine
                                        ? "bg-primary text-white hover:bg-primary"
                                        : "bg-surface-2 text-content-4",
                                    )}
                                  >
                                    Open terminal
                                  </a>
                                ) : null}
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <button
                                      type="button"
                                      aria-label="Job actions"
                                      onClick={(event) =>
                                        event.stopPropagation()
                                      }
                                      onKeyDown={(event) =>
                                        event.stopPropagation()
                                      }
                                      className="grid h-10 w-10 place-items-center rounded-xl border border-line bg-surface-1 text-content-3 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                                    >
                                      ⋯
                                    </button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent
                                    align="end"
                                    className="w-56"
                                  >
                                    <DropdownMenuItem
                                      disabled={!canShortCloseFromWcm}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        setCloseJobAction({
                                          assignment,
                                          mode: "SHORT_CLOSE",
                                        });
                                        setCloseJobReason("");
                                        setCloseJobReasonPreset("");
                                      }}
                                    >
                                      Short close step
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      disabled={!canCancelFromWcm}
                                      className="text-danger-fg focus:text-danger-fg"
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        setCloseJobAction({
                                          assignment,
                                          mode: "CANCEL",
                                        });
                                        setCloseJobReason("");
                                        setCloseJobReasonPreset("");
                                      }}
                                    >
                                      Cancel job
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                            </div>
                          </div>
                        </div>
                      </article>
                    );
                  })
                )}
                {currentWorkTotal > queuePageSize ? (
                  <div className="flex items-center justify-between rounded-2xl border border-line bg-surface-1 px-4 py-3 text-sm font-semibold text-content-3 shadow-sm">
                    <span>
                      {activeMainTab === "running"
                        ? "Running / ready"
                        : "Queue"}{" "}
                      page {currentWorkPage} of {currentWorkPageCount} ·{" "}
                      {currentWorkTotal} jobs
                    </span>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="h-9 rounded-xl"
                        disabled={currentWorkPage <= 1}
                        onClick={() =>
                          setCurrentWorkPage(Math.max(1, currentWorkPage - 1))
                        }
                      >
                        Previous
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-9 rounded-xl"
                        disabled={currentWorkPage >= currentWorkPageCount}
                        onClick={() =>
                          setCurrentWorkPage(
                            Math.min(currentWorkPageCount, currentWorkPage + 1),
                          )
                        }
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>

              {activeMainTab !== "history" && isWideViewport ? (
                <aside className="hidden max-h-[calc(100vh-300px)] overflow-y-auto pr-1 xl:col-span-1 xl:block">
                  {detailPaneContent}
                </aside>
              ) : null}
            </section>
          </>
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
          className="w-[min(36rem,calc(100vw-1rem))] max-w-[calc(100vw-1rem)] sm:max-w-[36rem] xl:hidden"
          data-testid="wcm-detail-sheet"
        >
          <SheetHeader className="mb-2 text-left">
            <SheetTitle className="font-display tracking-tight">
              Job preparation
            </SheetTitle>
          </SheetHeader>
          {detailPaneContent}
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
              <label className="text-[10px] font-black uppercase tracking-wider text-content-3">
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
                      "rounded-full border px-2.5 py-1 text-[11px] font-bold",
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

  const normalizedSpecs = useMemo(() => {
    const list =
      Array.isArray(targetSpecs) && targetSpecs.length > 0
        ? targetSpecs
        : [targetSpec];
    const byKey = new Map<string, any>();
    list.filter(Boolean).forEach((spec: any) => {
      const key = [
        String(spec?.variant_id || ""),
        String(spec?.family_id || ""),
        String(spec?.thickness_micron ?? ""),
      ].join("|");
      if (!byKey.has(key)) {
        byKey.set(key, spec);
        return;
      }
      const prev = byKey.get(key);
      const prevGrade = Boolean(prev?.grade_id);
      const nextGrade = Boolean(spec?.grade_id);
      const prevWidth = Number(prev?.min_width_mm || 0);
      const nextWidth = Number(spec?.min_width_mm || 0);
      if (
        (!prevGrade && nextGrade) ||
        (nextGrade === prevGrade && nextWidth > prevWidth)
      ) {
        byKey.set(key, spec);
      }
    });
    return Array.from(byKey.values());
  }, [targetSpec, targetSpecs]);

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
      const variantOk = spec?.variant_id
        ? String(roll?.material_id || "") === String(spec.variant_id)
        : true;
      const familyOk = spec?.family_id
        ? String(roll?.family_id || "") === String(spec.family_id)
        : true;
      const materialOk =
        spec?.variant_id || spec?.family_id ? variantOk || familyOk : true;
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
      const widthMaxOk =
        !strictSpecMatch || maxAutoWidth == null
          ? true
          : rollWidth <= maxAutoWidth;
      const widthOk = widthMinOk && widthMaxOk;
      const targetForm = spec?.stock_form || targetStockContract?.stock_form;
      const stockFormOk = processCanUseRollForTarget(
        roll?.stock_form,
        targetForm,
        targetStockContract?.process_capabilities,
      );
      return materialOk && thicknessOk && gradeOk && widthOk && stockFormOk;
    });
  };

  const filtered = useMemo(() => {
    return manualEligibleRolls.filter((r: any) => {
      if (strictSpecMatch && !matchesAnyTargetSpec(r)) return false;
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
          `${r.label_id} ${r.material_name} ${r.material_code} ${r.family_name}`.toLowerCase();
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
      if (strictSpecMatch && !matchesAnyTargetSpec(r)) return false;
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
          `${r.label_id} ${r.material_name} ${r.material_code} ${r.location_name}`.toLowerCase();
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
        if (!strictSpecMatch || matchesAnyTargetSpec(roll)) total += 1;
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
      const challan = await inventoryService.createChallan({
        from_plant: selectedTransferPlantId,
        to_plant: effectiveTargetPlantId,
      });
      const challanId = (challan as any)?.data?.id || (challan as any)?.id;
      await inventoryService.dispatchChallan(challanId, {
        target_location_id: destinationLocationId,
        roll_ids: selectedExternalRollIds,
      });
    },
    onSuccess: () => {
      toast({
        title: "Transfer Requested",
        description:
          "DC created for selected rolls. Receive it, then allocate.",
      });
      setOpen(false);
      setSelectedExternalRollIds([]);
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
    if (selectedRollIds.length > 0 || selectedExternalRollIds.length > 0)
      return;
    if (filtered.length === 0 && externalEligibleCount > 0) {
      setActiveTab("external");
    } else {
      setActiveTab("local");
    }
  }, [
    open,
    filtered.length,
    externalEligibleCount,
    selectedRollIds.length,
    selectedExternalRollIds.length,
  ]);

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
            <Badge variant="secondary" className="font-mono text-[10px]">
              {activeAssignment?.job_details?.job_number}
            </Badge>
          </DialogTitle>
          <DialogDescription>
            Select roll inputs matching BOM specs. Allocation persists as WCM
            reservation.
          </DialogDescription>
          <div className="mt-2 text-[11px] text-content-3">
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
            <div className="mt-2 rounded-md border border-warning-border bg-warning-bg px-3 py-2 text-[11px] font-medium text-warning-fg">
              No eligible roll in current plant. Open{" "}
              <span className="font-bold">Other Plants / Transfer</span> tab to
              raise transfer request.
            </div>
          )}
          <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-xl border border-line bg-surface-1 px-3 py-3">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-content-4">
                True WIP
              </div>
              <div className="mt-2 text-2xl font-black text-content-1">
                {Number(
                  (wipPoolMeta as any)?.lineage_roll_count ||
                    lineageCandidateCount ||
                    0,
                )}
              </div>
              <div className="text-[11px] text-content-3">
                Strict lineage choices
              </div>
            </div>
            <div className="rounded-xl border border-warning-border bg-warning-bg px-3 py-3">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-warning-fg">
                Fallback
              </div>
              <div className="mt-2 text-2xl font-black text-warning-fg">
                {Number(
                  (wipPoolMeta as any)?.fallback_roll_count ||
                    fallbackCandidateCount ||
                    0,
                )}
              </div>
              <div className="text-[11px] text-warning-fg">
                Manual assignment only
              </div>
            </div>
            <div className="rounded-xl border border-info-border bg-info-bg px-3 py-3">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-primary">
                Required
              </div>
              <div className="mt-2 text-2xl font-black text-primary">
                {Number(required || 0)}
              </div>
              <div className="text-[11px] text-primary">
                Rolls needed for this step
              </div>
            </div>
            <div className="rounded-xl border border-[#10233f] bg-[#10233f] px-3 py-3 text-white">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-content-4">
                Slot Coverage
              </div>
              <div className="mt-2 text-2xl font-black">
                {matchedSlotCount}/
                {Math.max(
                  Number(required || 0),
                  Number(
                    (rollAssignmentValidation as any)?.required_rolls || 0,
                  ),
                )}
              </div>
              <div className="text-[11px] text-content-4">
                {unmatchedSlotCount > 0
                  ? `${unmatchedSlotCount} target slot(s) still open`
                  : "Current set maps cleanly"}
              </div>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-6">
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-content-3 uppercase">
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
              <label className="text-[10px] font-black text-content-3 uppercase">
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
              <label className="text-[10px] font-black text-content-3 uppercase">
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
              <label className="text-[10px] font-black text-content-3 uppercase">
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
              <label className="text-[10px] font-black text-content-3 uppercase">
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
              <label className="text-[10px] font-black text-content-3 uppercase">
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
                          <span className="text-sm font-black text-content-1 uppercase">
                            {roll.label_id}
                          </span>
                          {roll.spec_exact && (
                            <Badge className="bg-success-bg text-success-fg text-[10px] font-bold">
                              EXACT MATCH
                            </Badge>
                          )}
                          {String(roll.roll_source || "").toUpperCase() ===
                            "LINEAGE" && (
                            <Badge className="bg-[#10233f] text-white text-[10px] font-bold">
                              TRUE WIP
                            </Badge>
                          )}
                          {String(roll.roll_source || "").toUpperCase() ===
                            "PURCHASED_FALLBACK" && (
                            <Badge className="bg-warning-bg text-warning-fg text-[10px] font-bold">
                              PURCHASED FALLBACK
                            </Badge>
                          )}
                          {String(roll.roll_source || "").toUpperCase() ===
                            "COMPATIBLE_FALLBACK" && (
                            <Badge className="bg-info-bg text-primary text-[10px] font-bold">
                              COMPATIBLE FALLBACK
                            </Badge>
                          )}
                          <Badge className="border-info-border bg-info-bg text-info-fg text-[10px] font-bold">
                            {stockFormLabel(roll.stock_form)}
                          </Badge>
                        </div>
                        <div className="text-[11px] font-medium text-content-3">
                          {roll.material_name} • {roll.thickness_micron}μ •{" "}
                          {roll.width_mm}mm ({widthBasisLabel(roll.width_basis)}
                          ) • Grade: {roll.grade_name || "—"}
                        </div>
                        <div className="text-[10px] text-content-4 font-bold uppercase mt-1">
                          Loc: {roll.location || roll.location_name}{" "}
                          {roll.location_type ? `(${roll.location_type})` : ""}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-2 text-right">
                        <div className="text-lg font-black text-content-1 leading-none">
                          {roll.weight_kg}{" "}
                          <span className="text-[10px] text-content-3">KG</span>
                        </div>
                        <div className="text-xs font-bold text-content-3">
                          {roll.width_mm}{" "}
                          <span className="text-[10px]">MM</span> ·{" "}
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
                            "relative z-10 h-7 shrink-0 px-4 text-[10px] font-black uppercase tracking-tighter",
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
                  <div className="text-center py-20 text-content-4">
                    <Activity className="h-12 w-12 mx-auto mb-4 opacity-10" />
                    <p className="font-bold">
                      No eligible rolls in current plant with current filters
                    </p>
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
                  <label className="text-[10px] font-black uppercase text-content-3">
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
                  <label className="text-[10px] font-black uppercase text-content-3">
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
                  <label className="text-[10px] font-black uppercase text-content-3">
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
              <div className="text-[11px] text-content-3">
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
                          <div className="text-xs font-black text-content-1 uppercase">
                            {roll.label_id}
                          </div>
                          <div className="text-[11px] text-content-3">
                            {roll.material_name} • {roll.thickness_micron}μ •{" "}
                            {roll.width_mm}mm ({stockFormLabel(roll.stock_form)}
                            ) • {roll.grade_name || "—"}
                          </div>
                          <div className="text-[10px] font-medium text-content-3">
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
                className="bg-primary hover:bg-primary font-black px-8"
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
                className="bg-warning-fg hover:bg-warning-fg text-white font-black px-8"
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

  const normalizedSpecs = useMemo(() => {
    const list =
      Array.isArray(targetSpecs) && targetSpecs.length > 0
        ? targetSpecs
        : [targetSpec];
    const byKey = new Map<string, any>();
    list.filter(Boolean).forEach((spec: any) => {
      const key = [
        String(spec?.variant_id || ""),
        String(spec?.family_id || ""),
        String(spec?.thickness_micron ?? ""),
      ].join("|");
      if (!byKey.has(key)) {
        byKey.set(key, spec);
        return;
      }
      const prev = byKey.get(key);
      const prevGrade = Boolean(prev?.grade_id);
      const nextGrade = Boolean(spec?.grade_id);
      const prevWidth = Number(prev?.min_width_mm || 0);
      const nextWidth = Number(spec?.min_width_mm || 0);
      if (
        (!prevGrade && nextGrade) ||
        (nextGrade === prevGrade && nextWidth > prevWidth)
      ) {
        byKey.set(key, spec);
      }
    });
    return Array.from(byKey.values());
  }, [targetSpec, targetSpecs]);

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
      const rollVariantId = roll?.material_id ? String(roll.material_id) : null;
      const rollFamilyId = roll?.family_id ? String(roll.family_id) : null;
      const variantOk = spec.variant_id
        ? String(spec.variant_id) === rollVariantId
        : true;
      const familyOk = spec.family_id
        ? String(spec.family_id) === rollFamilyId
        : true;
      const thicknessOk =
        spec.thickness_micron != null
          ? Number(roll.thickness_micron) === Number(spec.thickness_micron)
          : true;
      const gradeOk = spec.grade_id
        ? String(spec.grade_id) === String(roll.grade_id || "")
        : true;
      const widthOk = isMultiInputCombine
        ? true
        : spec.min_width_mm != null
          ? Number(roll.width_mm) >= Number(spec.min_width_mm)
          : true;
      const targetForm = spec?.stock_form || targetStockContract?.stock_form;
      const stockFormOk = processCanUseRollForTarget(
        roll?.stock_form,
        targetForm,
        targetStockContract?.process_capabilities,
      );
      return (
        (variantOk || familyOk) &&
        thicknessOk &&
        gradeOk &&
        widthOk &&
        stockFormOk
      );
    };
    if (!normalizedSpecs.length) return rollsRaw;
    const filtered = rollsRaw.filter((r: any) =>
      normalizedSpecs.some((s: any) => matchSpec(r, s)),
    );
    if (isMultiInputCombine && filtered.length === 0) {
      return rollsRaw;
    }
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
      const challan = await inventoryService.createChallan({
        from_plant: selectedPlantId,
        to_plant: targetPlantId,
      });
      const challanId = (challan as any)?.data?.id || (challan as any)?.id;
      await inventoryService.dispatchChallan(challanId, {
        target_location_id: effectiveTargetLocationId,
        roll_ids: selectedRollIds,
      });
    },
    onSuccess: () => {
      toast({
        title: "Transfer Requested",
        description: "DC created and dispatched for selected rolls.",
      });
      setOpen(false);
      setSelectedRollIds([]);
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
          className="h-7 text-[10px] font-black text-warning-fg border-warning-border bg-warning-bg hover:bg-warning-bg"
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
            <label className="text-[10px] font-black uppercase text-content-3">
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
            <label className="text-[10px] font-black uppercase text-content-3">
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
            <label className="text-[10px] font-black uppercase text-content-3">
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
                      <div className="text-[10px] text-content-3">
                        {r.thickness_micron}μ • {r.width_mm}mm (
                        {stockFormLabel(r.stock_form)}) • {r.weight_kg}kg •{" "}
                        {r.grade_name || "—"}
                      </div>
                    </div>
                  </div>
                  <div className="text-[10px] text-content-4">
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

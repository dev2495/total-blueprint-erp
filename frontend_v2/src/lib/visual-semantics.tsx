import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AlertCircle,
  ArrowRightLeft,
  BadgeCheck,
  BellRing,
  Box,
  CheckCircle2,
  CircleAlert,
  CircleHelp,
  Factory,
  FlaskConical,
  Layers,
  Package,
  PackageCheck,
  PackageOpen,
  Palette,
  PauseCircle,
  PlayCircle,
  ShoppingCart,
  ShieldAlert,
  ShieldCheck,
  Truck,
  Wrench,
  Workflow,
} from "lucide-react";

export type SemanticKind =
  | "origin"
  | "stockStrategy"
  | "planningChoice"
  | "rollRole"
  | "processState"
  | "materialCategory"
  | "packagingKind"
  | "packingMode"
  | "toolingStatus"
  | "dispatchStatus"
  | "jobState"
  | "severity"
  | "approval"
  | "notification";

export interface SemanticMeta {
  label: string;
  icon: LucideIcon;
  badgeClassName: string;
  softSurfaceClassName: string;
  chartColor: string;
}

const DEFAULT_META: SemanticMeta = {
  label: "Unknown",
  icon: CircleHelp,
  badgeClassName: "border-line bg-surface-2 text-content-2",
  softSurfaceClassName: "border-line bg-surface-2 text-content-2",
  chartColor: "#94A3B8",
};

function normalizeToken(value?: string | null) {
  return String(value || "")
    .trim()
    .replace(/[\s-]+/g, "_")
    .toUpperCase();
}

const originRegistry: Record<string, SemanticMeta> = {
  IN_HOUSE: {
    label: "In-house made",
    icon: Factory,
    badgeClassName: "border-info-border bg-info-bg text-primary",
    softSurfaceClassName: "border-info-border bg-info-bg text-primary",
    chartColor: "#4F46E5",
  },
  PURCHASED: {
    label: "Purchased",
    icon: ShoppingCart,
    badgeClassName: "border-success-border bg-success-bg text-success-fg",
    softSurfaceClassName: "border-success-border bg-success-bg text-success-fg",
    chartColor: "#10B981",
  },
  JOBWORK_RETURN: {
    label: "Jobwork return",
    icon: Workflow,
    badgeClassName: "border-info-border bg-info-bg text-info-fg",
    softSurfaceClassName: "border-info-border bg-info-bg text-info-fg",
    chartColor: "#C026D3",
  },
  INTERPLANT_IN: {
    label: "Inter-plant",
    icon: ArrowRightLeft,
    badgeClassName: "border-info-border bg-info-bg text-info-fg",
    softSurfaceClassName: "border-info-border bg-info-bg text-info-fg",
    chartColor: "#0891B2",
  },
  REMAINDER: {
    label: "Remainder",
    icon: Layers,
    badgeClassName: "border-warning-border bg-warm text-warm",
    softSurfaceClassName: "border-warning-border bg-warm text-warm",
    chartColor: "#F97316",
  },
};

const stockStrategyRegistry: Record<string, SemanticMeta> = {
  FINAL_STOCK: {
    label: "Final stock",
    icon: PackageCheck,
    badgeClassName: "border-success-border bg-success-bg text-success-fg",
    softSurfaceClassName: "border-success-border bg-success-bg text-success-fg",
    chartColor: "#059669",
  },
  INTERMEDIATE_POOL: {
    label: "Intermediate pool",
    icon: Layers,
    badgeClassName: "border-warning-border bg-warning-bg text-warning-fg",
    softSurfaceClassName: "border-warning-border bg-warning-bg text-warning-fg",
    chartColor: "#D97706",
  },
  PACKAGING_STOCK: {
    label: "Packaging",
    icon: Box,
    badgeClassName: "border-line bg-surface-2 text-content-2",
    softSurfaceClassName: "border-line bg-surface-2 text-content-1",
    chartColor: "#64748B",
  },
};

const rollRoleRegistry: Record<string, SemanticMeta> = {
  FG: {
    label: "FG",
    icon: PackageCheck,
    badgeClassName: "border-success-border bg-success-bg text-success-fg",
    softSurfaceClassName: "border-success-border bg-success-bg text-success-fg",
    chartColor: "#059669",
  },
  OUTPUT: {
    label: "Output",
    icon: Activity,
    badgeClassName: "border-info-border bg-info-bg text-primary",
    softSurfaceClassName: "border-info-border bg-info-bg text-primary",
    chartColor: "#2563EB",
  },
  SPLIT_OUTPUT: {
    label: "Split output",
    icon: Activity,
    badgeClassName: "border-info-border bg-info-bg text-primary",
    softSurfaceClassName: "border-info-border bg-info-bg text-primary",
    chartColor: "#2563EB",
  },
  REMAINDER: {
    label: "Remainder",
    icon: Layers,
    badgeClassName: "border-warning-border bg-warm text-warm",
    softSurfaceClassName: "border-warning-border bg-warm text-warm",
    chartColor: "#F97316",
  },
};

const processStateRegistry: Record<string, SemanticMeta> = {
  PLAIN: {
    label: "Plain / Extruded",
    icon: Layers,
    badgeClassName: "border-line bg-surface-2 text-content-2",
    softSurfaceClassName: "border-line bg-surface-2 text-content-1",
    chartColor: "#64748B",
  },
  EXTRUDED: {
    label: "Plain / Extruded",
    icon: Layers,
    badgeClassName: "border-line bg-surface-2 text-content-2",
    softSurfaceClassName: "border-line bg-surface-2 text-content-1",
    chartColor: "#64748B",
  },
  RAW_MATERIAL: {
    label: "Raw material",
    icon: Layers,
    badgeClassName: "border-line bg-surface-2 text-content-2",
    softSurfaceClassName: "border-line bg-surface-2 text-content-1",
    chartColor: "#64748B",
  },
  PRINTED: {
    label: "Printed",
    icon: Palette,
    badgeClassName: "border-info-border bg-info-bg text-primary",
    softSurfaceClassName: "border-info-border bg-info-bg text-primary",
    chartColor: "#2563EB",
  },
  LAMINATED: {
    label: "Laminated",
    icon: Layers,
    badgeClassName: "border-info-border bg-info-bg text-primary",
    softSurfaceClassName: "border-info-border bg-info-bg text-primary",
    chartColor: "#7C3AED",
  },
  SLIT: {
    label: "Slit",
    icon: Layers,
    badgeClassName: "border-info-border bg-info-bg text-primary",
    softSurfaceClassName: "border-info-border bg-info-bg text-primary",
    chartColor: "#7C3AED",
  },
  FINISHED_GOOD: {
    label: "Finished good",
    icon: BadgeCheck,
    badgeClassName: "border-success-border bg-success-bg text-success-fg",
    softSurfaceClassName: "border-success-border bg-success-bg text-success-fg",
    chartColor: "#059669",
  },
};

const materialCategoryRegistry: Record<string, SemanticMeta> = {
  FILM: {
    label: "Film",
    icon: Layers,
    badgeClassName: "border-info-border bg-info-bg text-primary",
    softSurfaceClassName: "border-info-border bg-info-bg text-primary",
    chartColor: "#4F46E5",
  },
  INK: {
    label: "Ink",
    icon: Palette,
    badgeClassName: "border-info-border bg-info-bg text-info-fg",
    softSurfaceClassName: "border-info-border bg-info-bg text-info-fg",
    chartColor: "#0891B2",
  },
  ADHESIVE: {
    label: "Adhesive",
    icon: FlaskConical,
    badgeClassName: "border-warning-border bg-warning-bg text-warning-fg",
    softSurfaceClassName: "border-warning-border bg-warning-bg text-warning-fg",
    chartColor: "#D97706",
  },
  SOLVENT: {
    label: "Solvent",
    icon: FlaskConical,
    badgeClassName: "border-warning-border bg-warm text-warm",
    softSurfaceClassName: "border-warning-border bg-warm text-warm",
    chartColor: "#EA580C",
  },
  GRANULE: {
    label: "Granule",
    icon: Package,
    badgeClassName: "border-success-border bg-success-bg text-success-fg",
    softSurfaceClassName: "border-success-border bg-success-bg text-success-fg",
    chartColor: "#10B981",
  },
  ADD_ON: {
    label: "Add-on",
    icon: PackageCheck,
    badgeClassName: "border-danger-border bg-danger-bg text-danger-fg",
    softSurfaceClassName: "border-danger-border bg-danger-bg text-danger-fg",
    chartColor: "#E11D48",
  },
  PACKAGING: {
    label: "Packaging",
    icon: Box,
    badgeClassName: "border-line bg-surface-2 text-content-2",
    softSurfaceClassName: "border-line bg-surface-2 text-content-1",
    chartColor: "#64748B",
  },
};

const packagingKindRegistry: Record<string, SemanticMeta> = {
  INNER_POUCH: {
    label: "Inner pouch",
    icon: PackageOpen,
    badgeClassName: "border-info-border bg-info-bg text-primary",
    softSurfaceClassName: "border-info-border bg-info-bg text-primary",
    chartColor: "#7C3AED",
  },
  GONNY: {
    label: "Gonny",
    icon: Package,
    badgeClassName: "border-warning-border bg-warning-bg text-warning-fg",
    softSurfaceClassName: "border-warning-border bg-warning-bg text-warning-fg",
    chartColor: "#D97706",
  },
  SHEET: {
    label: "Sheet",
    icon: Layers,
    badgeClassName: "border-info-border bg-info-bg text-info-fg",
    softSurfaceClassName: "border-info-border bg-info-bg text-info-fg",
    chartColor: "#0891B2",
  },
  FILM: {
    label: "Film",
    icon: Layers,
    badgeClassName: "border-info-border bg-info-bg text-primary",
    softSurfaceClassName: "border-info-border bg-info-bg text-primary",
    chartColor: "#4F46E5",
  },
  BOX: {
    label: "Box",
    icon: Box,
    badgeClassName: "border-line bg-surface-2 text-content-2",
    softSurfaceClassName: "border-line bg-surface-2 text-content-1",
    chartColor: "#64748B",
  },
  TAPE: {
    label: "Tape",
    icon: PackageCheck,
    badgeClassName: "border-danger-border bg-danger-bg text-danger-fg",
    softSurfaceClassName: "border-danger-border bg-danger-bg text-danger-fg",
    chartColor: "#E11D48",
  },
};

const packingModeRegistry: Record<string, SemanticMeta> = {
  LOOSE_POUCHES: {
    label: "Loose pouch to gonny",
    icon: PackageOpen,
    badgeClassName: "border-info-border bg-info-bg text-info-fg",
    softSurfaceClassName: "border-info-border bg-info-bg text-info-fg",
    chartColor: "#0891B2",
  },
  PRIMARY_PACKS: {
    label: "Primary packs to gonny",
    icon: PackageCheck,
    badgeClassName: "border-info-border bg-info-bg text-primary",
    softSurfaceClassName: "border-info-border bg-info-bg text-primary",
    chartColor: "#7C3AED",
  },
};

const toolingStatusRegistry: Record<string, SemanticMeta> = {
  READY: {
    label: "Ready",
    icon: Wrench,
    badgeClassName: "border-success-border bg-success-bg text-success-fg",
    softSurfaceClassName: "border-success-border bg-success-bg text-success-fg",
    chartColor: "#10B981",
  },
  IN_USE: {
    label: "In use",
    icon: Activity,
    badgeClassName: "border-info-border bg-info-bg text-primary",
    softSurfaceClassName: "border-info-border bg-info-bg text-primary",
    chartColor: "#2563EB",
  },
  SERVICE_DUE: {
    label: "Service due",
    icon: AlertCircle,
    badgeClassName: "border-warning-border bg-warning-bg text-warning-fg",
    softSurfaceClassName: "border-warning-border bg-warning-bg text-warning-fg",
    chartColor: "#D97706",
  },
  MAINTENANCE: {
    label: "Maintenance",
    icon: Wrench,
    badgeClassName: "border-warning-border bg-warm text-warm",
    softSurfaceClassName: "border-warning-border bg-warm text-warm",
    chartColor: "#F97316",
  },
  RETIRED: {
    label: "Retired",
    icon: ShieldAlert,
    badgeClassName: "border-line bg-surface-2 text-content-3",
    softSurfaceClassName: "border-line bg-surface-2 text-content-2",
    chartColor: "#94A3B8",
  },
};

const dispatchStatusRegistry: Record<string, SemanticMeta> = {
  DRAFT: {
    label: "Draft",
    icon: CircleHelp,
    badgeClassName: "border-line bg-surface-2 text-content-2",
    softSurfaceClassName: "border-line bg-surface-2 text-content-1",
    chartColor: "#94A3B8",
  },
  DISPATCHED: {
    label: "Dispatched",
    icon: Truck,
    badgeClassName: "border-info-border bg-info-bg text-primary",
    softSurfaceClassName: "border-info-border bg-info-bg text-primary",
    chartColor: "#2563EB",
  },
  IN_TRANSIT: {
    label: "In transit",
    icon: Truck,
    badgeClassName: "border-info-border bg-info-bg text-primary",
    softSurfaceClassName: "border-info-border bg-info-bg text-primary",
    chartColor: "#7C3AED",
  },
  DELIVERED: {
    label: "Delivered",
    icon: CheckCircle2,
    badgeClassName: "border-success-border bg-success-bg text-success-fg",
    softSurfaceClassName: "border-success-border bg-success-bg text-success-fg",
    chartColor: "#10B981",
  },
  RECEIVED: {
    label: "Received",
    icon: CheckCircle2,
    badgeClassName: "border-success-border bg-success-bg text-success-fg",
    softSurfaceClassName: "border-success-border bg-success-bg text-success-fg",
    chartColor: "#10B981",
  },
};

const jobStateRegistry: Record<string, SemanticMeta> = {
  READY: {
    label: "Ready",
    icon: CheckCircle2,
    badgeClassName: "border-success-border bg-success-bg text-success-fg",
    softSurfaceClassName: "border-success-border bg-success-bg text-success-fg",
    chartColor: "#10B981",
  },
  WC_READY: {
    label: "Ready",
    icon: CheckCircle2,
    badgeClassName: "border-success-border bg-success-bg text-success-fg",
    softSurfaceClassName: "border-success-border bg-success-bg text-success-fg",
    chartColor: "#10B981",
  },
  EXECUTION_READY: {
    label: "Execution ready",
    icon: CheckCircle2,
    badgeClassName: "border-info-border bg-info-bg text-primary",
    softSurfaceClassName: "border-info-border bg-info-bg text-primary",
    chartColor: "#2563EB",
  },
  ASSIGNED: {
    label: "Assigned",
    icon: Activity,
    badgeClassName: "border-info-border bg-info-bg text-primary",
    softSurfaceClassName: "border-info-border bg-info-bg text-primary",
    chartColor: "#2563EB",
  },
  RUNNING: {
    label: "Running",
    icon: PlayCircle,
    badgeClassName: "border-info-border bg-info-bg text-primary",
    softSurfaceClassName: "border-info-border bg-info-bg text-primary",
    chartColor: "#2563EB",
  },
  EXECUTING: {
    label: "Running",
    icon: PlayCircle,
    badgeClassName: "border-info-border bg-info-bg text-primary",
    softSurfaceClassName: "border-info-border bg-info-bg text-primary",
    chartColor: "#2563EB",
  },
  PAUSED: {
    label: "Paused",
    icon: PauseCircle,
    badgeClassName: "border-warning-border bg-warning-bg text-warning-fg",
    softSurfaceClassName: "border-warning-border bg-warning-bg text-warning-fg",
    chartColor: "#D97706",
  },
  BLOCKED: {
    label: "Blocked",
    icon: ShieldAlert,
    badgeClassName: "border-danger-border bg-danger-bg text-danger-fg",
    softSurfaceClassName: "border-danger-border bg-danger-bg text-danger-fg",
    chartColor: "#E11D48",
  },
  DELAYED: {
    label: "Delayed",
    icon: AlertCircle,
    badgeClassName: "border-danger-border bg-danger-bg text-danger-fg",
    softSurfaceClassName: "border-danger-border bg-danger-bg text-danger-fg",
    chartColor: "#E11D48",
  },
  COMPLETED: {
    label: "Completed",
    icon: BadgeCheck,
    badgeClassName: "border-success-border bg-success-bg text-success-fg",
    softSurfaceClassName: "border-success-border bg-success-bg text-success-fg",
    chartColor: "#059669",
  },
};

const severityRegistry: Record<string, SemanticMeta> = {
  INFO: {
    label: "Info",
    icon: CircleHelp,
    badgeClassName: "border-info-border bg-info-bg text-info-fg",
    softSurfaceClassName: "border-info-border bg-info-bg text-info-fg",
    chartColor: "#0EA5E9",
  },
  LOW: {
    label: "Watch",
    icon: CircleAlert,
    badgeClassName: "border-warning-border bg-warning-bg text-warning-fg",
    softSurfaceClassName: "border-warning-border bg-warning-bg text-warning-fg",
    chartColor: "#D97706",
  },
  MEDIUM: {
    label: "Attention",
    icon: AlertCircle,
    badgeClassName: "border-warning-border bg-warm text-warm",
    softSurfaceClassName: "border-warning-border bg-warm text-warm",
    chartColor: "#F97316",
  },
  HIGH: {
    label: "Blocked",
    icon: ShieldAlert,
    badgeClassName: "border-danger-border bg-danger-bg text-danger-fg",
    softSurfaceClassName: "border-danger-border bg-danger-bg text-danger-fg",
    chartColor: "#E11D48",
  },
  CRITICAL: {
    label: "Critical",
    icon: ShieldAlert,
    badgeClassName: "border-danger-border bg-danger-bg text-danger-fg",
    softSurfaceClassName: "border-danger-border bg-danger-bg text-danger-fg",
    chartColor: "#DC2626",
  },
};

const approvalRegistry: Record<string, SemanticMeta> = {
  APPROVED: {
    label: "Approved",
    icon: ShieldCheck,
    badgeClassName: "border-success-border bg-success-bg text-success-fg",
    softSurfaceClassName: "border-success-border bg-success-bg text-success-fg",
    chartColor: "#10B981",
  },
  PENDING: {
    label: "Pending",
    icon: CircleAlert,
    badgeClassName: "border-warning-border bg-warning-bg text-warning-fg",
    softSurfaceClassName: "border-warning-border bg-warning-bg text-warning-fg",
    chartColor: "#D97706",
  },
  REJECTED: {
    label: "Rejected",
    icon: ShieldAlert,
    badgeClassName: "border-danger-border bg-danger-bg text-danger-fg",
    softSurfaceClassName: "border-danger-border bg-danger-bg text-danger-fg",
    chartColor: "#E11D48",
  },
};

const notificationRegistry: Record<string, SemanticMeta> = {
  SENT: {
    label: "Sent",
    icon: BellRing,
    badgeClassName: "border-success-border bg-success-bg text-success-fg",
    softSurfaceClassName: "border-success-border bg-success-bg text-success-fg",
    chartColor: "#10B981",
  },
  SKIPPED: {
    label: "Skipped",
    icon: CircleAlert,
    badgeClassName: "border-warning-border bg-warning-bg text-warning-fg",
    softSurfaceClassName: "border-warning-border bg-warning-bg text-warning-fg",
    chartColor: "#D97706",
  },
  FAILED: {
    label: "Failed",
    icon: ShieldAlert,
    badgeClassName: "border-danger-border bg-danger-bg text-danger-fg",
    softSurfaceClassName: "border-danger-border bg-danger-bg text-danger-fg",
    chartColor: "#E11D48",
  },
};

function registryFor(kind: SemanticKind) {
  if (kind === "origin") return originRegistry;
  if (kind === "stockStrategy") return stockStrategyRegistry;
  if (kind === "planningChoice") return stockStrategyRegistry;
  if (kind === "rollRole") return rollRoleRegistry;
  if (kind === "processState") return processStateRegistry;
  if (kind === "materialCategory") return materialCategoryRegistry;
  if (kind === "packagingKind") return packagingKindRegistry;
  if (kind === "packingMode") return packingModeRegistry;
  if (kind === "toolingStatus") return toolingStatusRegistry;
  if (kind === "dispatchStatus") return dispatchStatusRegistry;
  if (kind === "jobState") return jobStateRegistry;
  if (kind === "severity") return severityRegistry;
  if (kind === "approval") return approvalRegistry;
  return notificationRegistry;
}

export function getSemanticMeta(
  kind: SemanticKind,
  value?: string | null,
  fallbackLabel?: string,
): SemanticMeta {
  const token = normalizeToken(value);
  const registry = registryFor(kind);
  const match = registry[token];
  if (match) return match;
  if (token === "FG" && kind === "processState")
    return processStateRegistry.FINISHED_GOOD;
  return {
    ...DEFAULT_META,
    label: fallbackLabel || String(value || DEFAULT_META.label),
  };
}

export function getStatusSemantic(
  value?: string | boolean | null,
  fallbackLabel?: string,
): SemanticMeta {
  if (typeof value === "boolean") {
    return value ? approvalRegistry.APPROVED : severityRegistry.LOW;
  }
  const token = normalizeToken(value);
  if (token in jobStateRegistry) return jobStateRegistry[token];
  if (token in approvalRegistry) return approvalRegistry[token];
  if (token in severityRegistry) return severityRegistry[token];
  if (token in notificationRegistry) return notificationRegistry[token];
  if (
    token === "SUCCESS" ||
    token === "VERIFIED" ||
    token === "ACTIVE" ||
    token === "YES" ||
    token === "TRUE"
  ) {
    return approvalRegistry.APPROVED;
  }
  if (token === "ERROR" || token === "RISK") {
    return severityRegistry.HIGH;
  }
  if (token === "WARNING" || token === "DRAFT" || token === "REVIEW") {
    return severityRegistry.MEDIUM;
  }
  if (
    token === "DISABLED" ||
    token === "INACTIVE" ||
    token === "NO" ||
    token === "FALSE"
  ) {
    return {
      label: fallbackLabel || "Inactive",
      icon: PauseCircle,
      badgeClassName: "border-line bg-surface-2 text-content-3",
      softSurfaceClassName: "border-line bg-surface-2 text-content-2",
      chartColor: "#94A3B8",
    };
  }
  return getSemanticMeta("jobState", value, fallbackLabel);
}

export function humanizeToken(value?: string | null, fallback = "Unknown") {
  const raw = String(value || "").trim();
  if (!raw) return fallback;
  return raw.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

import type { LucideIcon } from "lucide-react"
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
  Palette,
  PauseCircle,
  PlayCircle,
  ShoppingCart,
  ShieldAlert,
  ShieldCheck,
  Truck,
  Workflow,
} from "lucide-react"

export type SemanticKind =
  | "origin"
  | "stockStrategy"
  | "rollRole"
  | "processState"
  | "materialCategory"
  | "jobState"
  | "severity"
  | "approval"
  | "notification"

export interface SemanticMeta {
  label: string
  icon: LucideIcon
  badgeClassName: string
  softSurfaceClassName: string
  chartColor: string
}

const DEFAULT_META: SemanticMeta = {
  label: "Unknown",
  icon: CircleHelp,
  badgeClassName: "border-slate-200 bg-slate-50 text-slate-700",
  softSurfaceClassName: "border-slate-200 bg-slate-50 text-slate-700",
  chartColor: "#94A3B8",
}

function normalizeToken(value?: string | null) {
  return String(value || "")
    .trim()
    .replace(/[\s-]+/g, "_")
    .toUpperCase()
}

const originRegistry: Record<string, SemanticMeta> = {
  IN_HOUSE: {
    label: "In-house made",
    icon: Factory,
    badgeClassName: "border-indigo-200 bg-indigo-50 text-indigo-700",
    softSurfaceClassName: "border-indigo-100 bg-indigo-50/70 text-indigo-900",
    chartColor: "#4F46E5",
  },
  PURCHASED: {
    label: "Purchased",
    icon: ShoppingCart,
    badgeClassName: "border-emerald-200 bg-emerald-50 text-emerald-700",
    softSurfaceClassName: "border-emerald-100 bg-emerald-50/70 text-emerald-900",
    chartColor: "#10B981",
  },
  JOBWORK_RETURN: {
    label: "Jobwork return",
    icon: Workflow,
    badgeClassName: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700",
    softSurfaceClassName: "border-fuchsia-100 bg-fuchsia-50/70 text-fuchsia-900",
    chartColor: "#C026D3",
  },
  INTERPLANT_IN: {
    label: "Inter-plant",
    icon: ArrowRightLeft,
    badgeClassName: "border-cyan-200 bg-cyan-50 text-cyan-700",
    softSurfaceClassName: "border-cyan-100 bg-cyan-50/70 text-cyan-900",
    chartColor: "#0891B2",
  },
  REMAINDER: {
    label: "Remainder",
    icon: Layers,
    badgeClassName: "border-orange-200 bg-orange-50 text-orange-700",
    softSurfaceClassName: "border-orange-100 bg-orange-50/70 text-orange-900",
    chartColor: "#F97316",
  },
}

const stockStrategyRegistry: Record<string, SemanticMeta> = {
  FINAL_STOCK: {
    label: "Final stock",
    icon: PackageCheck,
    badgeClassName: "border-emerald-200 bg-emerald-50 text-emerald-700",
    softSurfaceClassName: "border-emerald-100 bg-emerald-50/70 text-emerald-900",
    chartColor: "#059669",
  },
  INTERMEDIATE_POOL: {
    label: "Intermediate pool",
    icon: Layers,
    badgeClassName: "border-amber-200 bg-amber-50 text-amber-700",
    softSurfaceClassName: "border-amber-100 bg-amber-50/70 text-amber-900",
    chartColor: "#D97706",
  },
  PACKAGING_STOCK: {
    label: "Packaging",
    icon: Box,
    badgeClassName: "border-slate-200 bg-slate-100 text-slate-700",
    softSurfaceClassName: "border-slate-200 bg-slate-100 text-slate-900",
    chartColor: "#64748B",
  },
}

const rollRoleRegistry: Record<string, SemanticMeta> = {
  FG: {
    label: "FG",
    icon: PackageCheck,
    badgeClassName: "border-emerald-200 bg-emerald-50 text-emerald-700",
    softSurfaceClassName: "border-emerald-100 bg-emerald-50/70 text-emerald-900",
    chartColor: "#059669",
  },
  OUTPUT: {
    label: "Output",
    icon: Activity,
    badgeClassName: "border-blue-200 bg-blue-50 text-blue-700",
    softSurfaceClassName: "border-blue-100 bg-blue-50/70 text-blue-900",
    chartColor: "#2563EB",
  },
  SPLIT_OUTPUT: {
    label: "Split output",
    icon: Activity,
    badgeClassName: "border-blue-200 bg-blue-50 text-blue-700",
    softSurfaceClassName: "border-blue-100 bg-blue-50/70 text-blue-900",
    chartColor: "#2563EB",
  },
  REMAINDER: {
    label: "Remainder",
    icon: Layers,
    badgeClassName: "border-orange-200 bg-orange-50 text-orange-700",
    softSurfaceClassName: "border-orange-100 bg-orange-50/70 text-orange-900",
    chartColor: "#F97316",
  },
}

const processStateRegistry: Record<string, SemanticMeta> = {
  PLAIN: {
    label: "Plain / Extruded",
    icon: Layers,
    badgeClassName: "border-slate-200 bg-slate-50 text-slate-700",
    softSurfaceClassName: "border-slate-200 bg-slate-50 text-slate-900",
    chartColor: "#64748B",
  },
  EXTRUDED: {
    label: "Plain / Extruded",
    icon: Layers,
    badgeClassName: "border-slate-200 bg-slate-50 text-slate-700",
    softSurfaceClassName: "border-slate-200 bg-slate-50 text-slate-900",
    chartColor: "#64748B",
  },
  RAW_MATERIAL: {
    label: "Raw material",
    icon: Layers,
    badgeClassName: "border-slate-200 bg-slate-50 text-slate-700",
    softSurfaceClassName: "border-slate-200 bg-slate-50 text-slate-900",
    chartColor: "#64748B",
  },
  PRINTED: {
    label: "Printed",
    icon: Palette,
    badgeClassName: "border-blue-200 bg-blue-50 text-blue-700",
    softSurfaceClassName: "border-blue-100 bg-blue-50/70 text-blue-900",
    chartColor: "#2563EB",
  },
  LAMINATED: {
    label: "Laminated",
    icon: Layers,
    badgeClassName: "border-violet-200 bg-violet-50 text-violet-700",
    softSurfaceClassName: "border-violet-100 bg-violet-50/70 text-violet-900",
    chartColor: "#7C3AED",
  },
  SLIT: {
    label: "Slit",
    icon: Layers,
    badgeClassName: "border-violet-200 bg-violet-50 text-violet-700",
    softSurfaceClassName: "border-violet-100 bg-violet-50/70 text-violet-900",
    chartColor: "#7C3AED",
  },
  FINISHED_GOOD: {
    label: "Finished good",
    icon: BadgeCheck,
    badgeClassName: "border-emerald-200 bg-emerald-50 text-emerald-700",
    softSurfaceClassName: "border-emerald-100 bg-emerald-50/70 text-emerald-900",
    chartColor: "#059669",
  },
}

const materialCategoryRegistry: Record<string, SemanticMeta> = {
  FILM: {
    label: "Film",
    icon: Layers,
    badgeClassName: "border-indigo-200 bg-indigo-50 text-indigo-700",
    softSurfaceClassName: "border-indigo-100 bg-indigo-50/70 text-indigo-900",
    chartColor: "#4F46E5",
  },
  INK: {
    label: "Ink",
    icon: Palette,
    badgeClassName: "border-cyan-200 bg-cyan-50 text-cyan-700",
    softSurfaceClassName: "border-cyan-100 bg-cyan-50/70 text-cyan-900",
    chartColor: "#0891B2",
  },
  ADHESIVE: {
    label: "Adhesive",
    icon: FlaskConical,
    badgeClassName: "border-amber-200 bg-amber-50 text-amber-700",
    softSurfaceClassName: "border-amber-100 bg-amber-50/70 text-amber-900",
    chartColor: "#D97706",
  },
  SOLVENT: {
    label: "Solvent",
    icon: FlaskConical,
    badgeClassName: "border-orange-200 bg-orange-50 text-orange-700",
    softSurfaceClassName: "border-orange-100 bg-orange-50/70 text-orange-900",
    chartColor: "#EA580C",
  },
  GRANULE: {
    label: "Granule",
    icon: Package,
    badgeClassName: "border-emerald-200 bg-emerald-50 text-emerald-700",
    softSurfaceClassName: "border-emerald-100 bg-emerald-50/70 text-emerald-900",
    chartColor: "#10B981",
  },
  ADD_ON: {
    label: "Add-on",
    icon: PackageCheck,
    badgeClassName: "border-rose-200 bg-rose-50 text-rose-700",
    softSurfaceClassName: "border-rose-100 bg-rose-50/70 text-rose-900",
    chartColor: "#E11D48",
  },
  PACKAGING: {
    label: "Packaging",
    icon: Box,
    badgeClassName: "border-slate-200 bg-slate-100 text-slate-700",
    softSurfaceClassName: "border-slate-200 bg-slate-100 text-slate-900",
    chartColor: "#64748B",
  },
}

const jobStateRegistry: Record<string, SemanticMeta> = {
  READY: {
    label: "Ready",
    icon: CheckCircle2,
    badgeClassName: "border-emerald-200 bg-emerald-50 text-emerald-700",
    softSurfaceClassName: "border-emerald-100 bg-emerald-50/70 text-emerald-900",
    chartColor: "#10B981",
  },
  WC_READY: {
    label: "Ready",
    icon: CheckCircle2,
    badgeClassName: "border-emerald-200 bg-emerald-50 text-emerald-700",
    softSurfaceClassName: "border-emerald-100 bg-emerald-50/70 text-emerald-900",
    chartColor: "#10B981",
  },
  EXECUTION_READY: {
    label: "Execution ready",
    icon: CheckCircle2,
    badgeClassName: "border-blue-200 bg-blue-50 text-blue-700",
    softSurfaceClassName: "border-blue-100 bg-blue-50/70 text-blue-900",
    chartColor: "#2563EB",
  },
  ASSIGNED: {
    label: "Assigned",
    icon: Activity,
    badgeClassName: "border-blue-200 bg-blue-50 text-blue-700",
    softSurfaceClassName: "border-blue-100 bg-blue-50/70 text-blue-900",
    chartColor: "#2563EB",
  },
  RUNNING: {
    label: "Running",
    icon: PlayCircle,
    badgeClassName: "border-blue-200 bg-blue-50 text-blue-700",
    softSurfaceClassName: "border-blue-100 bg-blue-50/70 text-blue-900",
    chartColor: "#2563EB",
  },
  EXECUTING: {
    label: "Running",
    icon: PlayCircle,
    badgeClassName: "border-blue-200 bg-blue-50 text-blue-700",
    softSurfaceClassName: "border-blue-100 bg-blue-50/70 text-blue-900",
    chartColor: "#2563EB",
  },
  PAUSED: {
    label: "Paused",
    icon: PauseCircle,
    badgeClassName: "border-amber-200 bg-amber-50 text-amber-700",
    softSurfaceClassName: "border-amber-100 bg-amber-50/70 text-amber-900",
    chartColor: "#D97706",
  },
  BLOCKED: {
    label: "Blocked",
    icon: ShieldAlert,
    badgeClassName: "border-rose-200 bg-rose-50 text-rose-700",
    softSurfaceClassName: "border-rose-100 bg-rose-50/70 text-rose-900",
    chartColor: "#E11D48",
  },
  DELAYED: {
    label: "Delayed",
    icon: AlertCircle,
    badgeClassName: "border-rose-200 bg-rose-50 text-rose-700",
    softSurfaceClassName: "border-rose-100 bg-rose-50/70 text-rose-900",
    chartColor: "#E11D48",
  },
  COMPLETED: {
    label: "Completed",
    icon: BadgeCheck,
    badgeClassName: "border-emerald-200 bg-emerald-50 text-emerald-700",
    softSurfaceClassName: "border-emerald-100 bg-emerald-50/70 text-emerald-900",
    chartColor: "#059669",
  },
}

const severityRegistry: Record<string, SemanticMeta> = {
  INFO: {
    label: "Info",
    icon: CircleHelp,
    badgeClassName: "border-sky-200 bg-sky-50 text-sky-700",
    softSurfaceClassName: "border-sky-100 bg-sky-50/70 text-sky-900",
    chartColor: "#0EA5E9",
  },
  LOW: {
    label: "Watch",
    icon: CircleAlert,
    badgeClassName: "border-amber-200 bg-amber-50 text-amber-700",
    softSurfaceClassName: "border-amber-100 bg-amber-50/70 text-amber-900",
    chartColor: "#D97706",
  },
  MEDIUM: {
    label: "Attention",
    icon: AlertCircle,
    badgeClassName: "border-orange-200 bg-orange-50 text-orange-700",
    softSurfaceClassName: "border-orange-100 bg-orange-50/70 text-orange-900",
    chartColor: "#F97316",
  },
  HIGH: {
    label: "Blocked",
    icon: ShieldAlert,
    badgeClassName: "border-rose-200 bg-rose-50 text-rose-700",
    softSurfaceClassName: "border-rose-100 bg-rose-50/70 text-rose-900",
    chartColor: "#E11D48",
  },
  CRITICAL: {
    label: "Critical",
    icon: ShieldAlert,
    badgeClassName: "border-red-200 bg-red-50 text-red-700",
    softSurfaceClassName: "border-red-100 bg-red-50/70 text-red-900",
    chartColor: "#DC2626",
  },
}

const approvalRegistry: Record<string, SemanticMeta> = {
  APPROVED: {
    label: "Approved",
    icon: ShieldCheck,
    badgeClassName: "border-emerald-200 bg-emerald-50 text-emerald-700",
    softSurfaceClassName: "border-emerald-100 bg-emerald-50/70 text-emerald-900",
    chartColor: "#10B981",
  },
  PENDING: {
    label: "Pending",
    icon: CircleAlert,
    badgeClassName: "border-amber-200 bg-amber-50 text-amber-700",
    softSurfaceClassName: "border-amber-100 bg-amber-50/70 text-amber-900",
    chartColor: "#D97706",
  },
  REJECTED: {
    label: "Rejected",
    icon: ShieldAlert,
    badgeClassName: "border-rose-200 bg-rose-50 text-rose-700",
    softSurfaceClassName: "border-rose-100 bg-rose-50/70 text-rose-900",
    chartColor: "#E11D48",
  },
}

const notificationRegistry: Record<string, SemanticMeta> = {
  SENT: {
    label: "Sent",
    icon: BellRing,
    badgeClassName: "border-emerald-200 bg-emerald-50 text-emerald-700",
    softSurfaceClassName: "border-emerald-100 bg-emerald-50/70 text-emerald-900",
    chartColor: "#10B981",
  },
  SKIPPED: {
    label: "Skipped",
    icon: CircleAlert,
    badgeClassName: "border-amber-200 bg-amber-50 text-amber-700",
    softSurfaceClassName: "border-amber-100 bg-amber-50/70 text-amber-900",
    chartColor: "#D97706",
  },
  FAILED: {
    label: "Failed",
    icon: ShieldAlert,
    badgeClassName: "border-rose-200 bg-rose-50 text-rose-700",
    softSurfaceClassName: "border-rose-100 bg-rose-50/70 text-rose-900",
    chartColor: "#E11D48",
  },
}

function registryFor(kind: SemanticKind) {
  if (kind === "origin") return originRegistry
  if (kind === "stockStrategy") return stockStrategyRegistry
  if (kind === "rollRole") return rollRoleRegistry
  if (kind === "processState") return processStateRegistry
  if (kind === "materialCategory") return materialCategoryRegistry
  if (kind === "jobState") return jobStateRegistry
  if (kind === "severity") return severityRegistry
  if (kind === "approval") return approvalRegistry
  return notificationRegistry
}

export function getSemanticMeta(kind: SemanticKind, value?: string | null, fallbackLabel?: string): SemanticMeta {
  const token = normalizeToken(value)
  const registry = registryFor(kind)
  const match = registry[token]
  if (match) return match
  if (token === "FG" && kind === "processState") return processStateRegistry.FINISHED_GOOD
  return {
    ...DEFAULT_META,
    label: fallbackLabel || String(value || DEFAULT_META.label),
  }
}

export function getStatusSemantic(value?: string | boolean | null, fallbackLabel?: string): SemanticMeta {
  if (typeof value === "boolean") {
    return value ? approvalRegistry.APPROVED : severityRegistry.LOW
  }
  const token = normalizeToken(value)
  if (token in jobStateRegistry) return jobStateRegistry[token]
  if (token in approvalRegistry) return approvalRegistry[token]
  if (token in severityRegistry) return severityRegistry[token]
  if (token in notificationRegistry) return notificationRegistry[token]
  if (token === "SUCCESS" || token === "VERIFIED" || token === "ACTIVE" || token === "YES" || token === "TRUE") {
    return approvalRegistry.APPROVED
  }
  if (token === "ERROR" || token === "RISK") {
    return severityRegistry.HIGH
  }
  if (token === "WARNING" || token === "DRAFT" || token === "REVIEW") {
    return severityRegistry.MEDIUM
  }
  if (token === "DISABLED" || token === "INACTIVE" || token === "NO" || token === "FALSE") {
    return {
      label: fallbackLabel || "Inactive",
      icon: PauseCircle,
      badgeClassName: "border-slate-200 bg-slate-100 text-slate-600",
      softSurfaceClassName: "border-slate-200 bg-slate-100 text-slate-800",
      chartColor: "#94A3B8",
    }
  }
  return getSemanticMeta("jobState", value, fallbackLabel)
}

export function humanizeToken(value?: string | null, fallback = "Unknown") {
  const raw = String(value || "").trim()
  if (!raw) return fallback
  return raw
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

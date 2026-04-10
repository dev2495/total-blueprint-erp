"use client"

import { type ElementType, useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  Activity,
  AlertTriangle,
  ArrowRightLeft,
  BarChart3,
  CalendarDays,
  Download,
  DollarSign,
  Factory,
  Gauge,
  LineChart as LineChartIcon,
  Package,
  PieChart as PieChartIcon,
  RefreshCw,
  Rows3,
  Scissors,
  Sparkles,
} from "lucide-react"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { analyticsApi, type ReportTabResponse } from "@/services/analytics"
import { factoryService } from "@/services/factory"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { describeApiError } from "@/lib/api"
import { ReportStateBanner, formatMaybeCurrency, formatMaybeNumber, hasMeaningfulData, hasTruthyValue } from "@/components/analytics/report-state"

type FilterPreset = "daily" | "weekly" | "custom"

type ReportTabPageProps = {
  tab: string
  title: string
  description: string
  accent?: "indigo" | "emerald" | "amber" | "cyan" | "rose"
}

const PIE_COLORS = ["#1d4ed8", "#7c3aed", "#0f766e", "#f59e0b", "#ea580c", "#e11d48", "#0ea5e9", "#65a30d"]

const ACCENT_STYLES: Record<NonNullable<ReportTabPageProps["accent"]>, { panel: string; chip: string; badge: string }> = {
  indigo: {
    panel: "from-slate-950 via-indigo-900 to-blue-600",
    chip: "border-indigo-200 bg-indigo-50 text-indigo-700",
    badge: "bg-indigo-500",
  },
  emerald: {
    panel: "from-slate-950 via-emerald-900 to-emerald-500",
    chip: "border-emerald-200 bg-emerald-50 text-emerald-700",
    badge: "bg-emerald-500",
  },
  amber: {
    panel: "from-slate-950 via-amber-900 to-orange-500",
    chip: "border-amber-200 bg-amber-50 text-amber-700",
    badge: "bg-amber-500",
  },
  cyan: {
    panel: "from-slate-950 via-cyan-900 to-sky-500",
    chip: "border-cyan-200 bg-cyan-50 text-cyan-700",
    badge: "bg-cyan-500",
  },
  rose: {
    panel: "from-slate-950 via-rose-900 to-fuchsia-500",
    chip: "border-rose-200 bg-rose-50 text-rose-700",
    badge: "bg-rose-500",
  },
}

function todayIso(offsetDays = 0) {
  const value = new Date()
  value.setDate(value.getDate() + offsetDays)
  return value.toISOString().slice(0, 10)
}

function toLabel(value: string) {
  return String(value || "")
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (match) => match.toUpperCase())
}

function labelFromRow(row: Record<string, any>, index: number) {
  return (
    row.date ||
    row.name ||
    row.machine ||
    row.customer ||
    row.process ||
    row.status ||
    row.range ||
    row.category ||
    row.shift_code ||
    row.operator ||
    row.job_number ||
    `Row ${index + 1}`
  )
}

function pickMetricKeys(rows: Array<Record<string, any>>) {
  const preferred = [
    "value",
    "output_kg",
    "weight_kg",
    "revenue",
    "count",
    "challans",
    "created",
    "completed",
    "oee",
    "yield_pct",
    "scrap_kg",
    "downtime_minutes",
    "margin",
    "consumed",
    "variance",
  ]
  const numericKeys = new Set<string>()
  for (const row of rows) {
    Object.entries(row).forEach(([key, value]) => {
      if (typeof value === "number" && Number.isFinite(value)) numericKeys.add(key)
    })
  }
  const ordered = preferred.filter((key) => numericKeys.has(key))
  for (const key of Array.from(numericKeys)) {
    if (!ordered.includes(key)) ordered.push(key)
  }
  return ordered
}

function normalizeChartRows(rows: unknown) {
  if (!Array.isArray(rows)) return { rows: [], primaryKey: "", secondaryKey: "" }
  const typed = rows.filter((row): row is Record<string, any> => !!row && typeof row === "object")
  const metricKeys = pickMetricKeys(typed)
  const primaryKey = metricKeys[0] || ""
  const secondaryKey = metricKeys[1] || ""
  return {
    rows: typed.map((row, index) => ({
      ...row,
      label: labelFromRow(row, index),
    })),
    primaryKey,
    secondaryKey,
  }
}

function normalizeBreakdownGroups(payload: ReportTabResponse) {
  const groups: Array<{ key: string; title: string; rows: Array<Record<string, any>> }> = []
  const fallbackBreakdowns =
    !payload.breakdowns && Array.isArray(payload.charts?.distribution) && payload.charts.distribution.length
      ? { distribution: payload.charts.distribution }
      : payload.breakdowns || {}
  for (const [key, value] of Object.entries(fallbackBreakdowns)) {
    if (Array.isArray(value) && value.length) {
      groups.push({
        key,
        title: toLabel(key),
        rows: value.filter((row): row is Record<string, any> => !!row && typeof row === "object"),
      })
    }
  }
  return groups
}

function metricTone(label: string) {
  const key = label.toLowerCase()
  if (key.includes("scrap") || key.includes("overdue") || key.includes("variance")) {
    return "border-rose-200 bg-rose-50 text-rose-700"
  }
  if (key.includes("yield") || key.includes("otif") || key.includes("completion") || key.includes("margin")) {
    return "border-emerald-200 bg-emerald-50 text-emerald-700"
  }
  if (key.includes("cost") || key.includes("revenue") || key.includes("value")) {
    return "border-amber-200 bg-amber-50 text-amber-700"
  }
  return "border-slate-200 bg-white text-slate-700"
}

function formatMetricValue(key: string, value: unknown) {
  const normalized = key.toLowerCase()
  if (!hasTruthyValue(value) && value !== 0) return "—"
  if (normalized.includes("revenue") || normalized.includes("value") || normalized.includes("cost") || normalized.includes("margin")) {
    return formatMaybeCurrency(value)
  }
  if (normalized.includes("pct") || normalized.includes("rate") || normalized.includes("yield") || normalized.includes("otif")) {
    const numeric = Number(value)
    return Number.isFinite(numeric) ? `${numeric.toFixed(1)}%` : String(value)
  }
  if (normalized.includes("kg")) {
    const numeric = Number(value)
    return Number.isFinite(numeric) ? `${numeric.toLocaleString("en-IN", { maximumFractionDigits: 2 })} kg` : String(value)
  }
  return typeof value === "number" ? value.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : String(value)
}

function inferTableColumns(rows: Array<Record<string, any>>) {
  const excluded = new Set(["id", "fill", "color"])
  const ordered: string[] = []
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (excluded.has(key)) continue
      if (!ordered.includes(key)) ordered.push(key)
    }
  }
  return ordered.slice(0, 7)
}

function formatTableValue(key: string, value: unknown) {
  if (!hasTruthyValue(value) && value !== 0) return "—"
  if (typeof value === "number") {
    return formatMetricValue(key, value)
  }
  return String(value)
}

function toNumber(value: unknown) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : 0
}

function sortRowsByKey(rows: Array<Record<string, any>>, key: string) {
  return [...rows].sort((left, right) => toNumber(right[key]) - toNumber(left[key]))
}

function asRecordRows(value: unknown) {
  return Array.isArray(value) ? value.filter((row): row is Record<string, any> => !!row && typeof row === "object") : []
}

function compactAxisLabel(value: unknown, max = 18) {
  const text = String(value || "")
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function isGenericCoverageWarning(message: unknown) {
  const text = String(message || "").toLowerCase()
  return [
    "no telemetry",
    "no machine telemetry",
    "no shift-tagged telemetry",
    "no shift tags",
    "no shift schedule",
    "no material actuals captured",
  ].some((marker) => text.includes(marker))
}

function hasReportEvidence(values: unknown[]): boolean {
  const visit = (value: unknown): boolean => {
    if (value === null || value === undefined || value === "") return false
    if (typeof value === "number") return Number.isFinite(value) && value !== 0
    if (typeof value === "boolean") return value
    if (typeof value === "string") {
      const text = value.trim()
      return text.length > 0 && !["0", "0.0", "0.00"].includes(text)
    }
    if (Array.isArray(value)) return value.length > 0 && value.some(visit)
    if (typeof value === "object") return Object.values(value as Record<string, unknown>).some(visit)
    return false
  }
  return values.some(visit)
}

function scrapSignalTone(label: string) {
  const key = label.toLowerCase()
  if (key.includes("reason")) return "border-rose-200 bg-rose-50 text-rose-700"
  if (key.includes("machine")) return "border-indigo-200 bg-indigo-50 text-indigo-700"
  if (key.includes("cost")) return "border-amber-200 bg-amber-50 text-amber-700"
  if (key.includes("yield")) return "border-emerald-200 bg-emerald-50 text-emerald-700"
  return "border-slate-200 bg-slate-50 text-slate-700"
}

export function ReportTabPage({ tab, title, description, accent = "indigo" }: ReportTabPageProps) {
  const accentStyle = ACCENT_STYLES[accent]
  const isScrapTab = tab === "scrap"
  const isOeeTab = tab === "oee"
  const isMaterialVarianceTab = tab === "material-variance"
  const isMrpTab = tab === "mrp" || isMaterialVarianceTab
  const isInkTab = tab === "ink-intelligence"
  const isInterplantTab = tab === "interplant"
  const isInventoryTab = tab === "inventory" || tab === "inventory-lineage"
  const isProductionTab = tab === "production"
  const isSalesTab = tab === "sales"
  const isDispatchTab = tab === "dispatch"
  const isDowntimeTab = tab === "downtime"
  const isOperatorTab = tab === "operator"
  const isCostingTab = tab === "costing"
  const isShiftTab = tab === "shift-performance"
  const suppressGenericSharedShell = [
    isMrpTab,
    isInkTab,
    isInterplantTab,
    isInventoryTab,
    isProductionTab,
    isSalesTab,
    isDispatchTab,
    isDowntimeTab,
    isOperatorTab,
    isCostingTab,
    isShiftTab,
  ].some(Boolean)
  const prefersWideDefaultWindow = ["scrap", "mrp", "material-variance", "ink-intelligence", "interplant", "inventory", "inventory-lineage"].includes(tab)
  const [preset, setPreset] = useState<FilterPreset>(prefersWideDefaultWindow ? "custom" : "weekly")
  const [dateFrom, setDateFrom] = useState(prefersWideDefaultWindow ? todayIso(-30) : todayIso(-6))
  const [dateTo, setDateTo] = useState(todayIso(0))
  const [plant, setPlant] = useState("ALL")
  const [processId, setProcessId] = useState("ALL")
  const [shift, setShift] = useState("ALL")

  useEffect(() => {
    if (preset === "daily") {
      setDateFrom(todayIso(-1))
      setDateTo(todayIso(0))
    } else if (preset === "weekly") {
      setDateFrom(todayIso(-6))
      setDateTo(todayIso(0))
    }
  }, [preset])

  const filters = useMemo(
    () => ({
      plant: plant !== "ALL" ? plant : undefined,
      process: processId !== "ALL" ? processId : undefined,
      shift: shift !== "ALL" ? shift : undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
    }),
    [dateFrom, dateTo, plant, processId, shift],
  )

  const plantsQuery = useQuery({
    queryKey: ["report-tab-plants"],
    queryFn: factoryService.getPlants,
    staleTime: 300_000,
  })
  const processesQuery = useQuery({
    queryKey: ["report-tab-processes"],
    queryFn: factoryService.getProcesses,
    staleTime: 300_000,
  })
  const shiftsQuery = useQuery({
    queryKey: ["report-tab-shifts", plant],
    queryFn: () => factoryService.getShifts(plant !== "ALL" ? plant : undefined),
    staleTime: 120_000,
  })
  const reportQuery = useQuery({
    queryKey: ["report-tab-rich", tab, filters],
    queryFn: () => analyticsApi.getReportTab(tab, filters),
    refetchInterval: 120_000,
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  })

  const payload = reportQuery.data ?? ({ tab, summary: {}, rows: [], breakdowns: {}, series: [], warnings: [] } satisfies Partial<ReportTabResponse>)
  const rawPayload = payload as ReportTabResponse & Record<string, any>
  const reportPending = !reportQuery.data && (reportQuery.isPending || reportQuery.isFetching)
  const normalizedSummary = (payload.summary || payload.kpis || {}) as Record<string, any>
  const summaryEntries = Object.entries(normalizedSummary).filter(([, value]) => value !== null && value !== undefined && value !== "").slice(0, 12)
  const seriesSource = Array.isArray(payload.series) && payload.series.length ? payload.series : payload.charts?.trend || []
  const chartSeries = useMemo(() => normalizeChartRows(seriesSource), [seriesSource])
  const breakdownGroups = useMemo(() => normalizeBreakdownGroups(payload as ReportTabResponse), [payload])
  const firstBreakdown = breakdownGroups[0]
  const secondBreakdown = breakdownGroups[1]
  const visibleBreakdowns = breakdownGroups.slice(0, 6)
  const tableRows = useMemo(() => {
    if (Array.isArray(payload.rows) && payload.rows.length) {
      return payload.rows.filter((row): row is Record<string, any> => !!row && typeof row === "object")
    }
    return firstBreakdown?.rows || []
  }, [payload.rows, firstBreakdown])
  const tableColumns = useMemo(() => inferTableColumns(tableRows), [tableRows])
  const reportHasVisibleEvidence = hasReportEvidence([normalizedSummary, seriesSource, payload.rows, payload.breakdowns, payload.charts])
  const degraded = !reportPending && (!reportHasVisibleEvidence || Boolean((payload as any)?.degraded))
  const degradedMessage = suppressGenericSharedShell
    ? "The current filter window returned limited report evidence. Expand the date range, plant, or process filters to surface more live activity."
    : isMrpTab || isInkTab
    ? "The current filter window returned limited material evidence. Expand the date range or run jobs with issue and return actuals to widen the view."
    : "The current filter window returned limited operating evidence. Change the date lens or process filters to widen the view."
  const visibleWarnings = useMemo(() => {
    const warnings = payload.warnings || []
    return reportHasVisibleEvidence ? warnings.filter((warning) => !isGenericCoverageWarning(warning)) : warnings
  }, [payload.warnings, reportHasVisibleEvidence])
  const scrapPrimaryKeys = useMemo(
    () =>
      new Set([
        "total_scrap_kg",
        "total_output_kg",
        "total_good_kg",
        "total_processed_kg",
        "yield_pct",
        "scrap_rate",
        "cost_of_scrap",
        "avg_scrap_per_event_kg",
        "jobs_with_scrap",
        "top_reason",
        "top_machine",
      ]),
    [],
  )
  const visibleSummaryEntries = useMemo(() => {
    if (!isScrapTab) return summaryEntries
    return summaryEntries.filter(([key]) => !scrapPrimaryKeys.has(key))
  }, [isScrapTab, scrapPrimaryKeys, summaryEntries])
  const oeeSpotlightCards = useMemo(() => {
    if (!isOeeTab) return []
    return [
      { label: "Average OEE", value: formatMetricValue("avg_oee", normalizedSummary.avg_oee), hint: "Availability x performance x quality" },
      { label: "Availability", value: formatMetricValue("global_availability", normalizedSummary.global_availability), hint: "Machine ready-time ratio" },
      { label: "Performance", value: formatMetricValue("global_performance", normalizedSummary.global_performance), hint: "Actual versus rated throughput" },
      { label: "Quality", value: formatMetricValue("global_quality", normalizedSummary.global_quality), hint: "Good output as a share of processed mass" },
      { label: "Top machine", value: formatMetricValue("top_machine", normalizedSummary.top_machine), hint: "Highest visible OEE in current window" },
      { label: "Output", value: formatMetricValue("output_kg", normalizedSummary.output_kg), hint: "Produced quantity in current lens" },
    ]
  }, [isOeeTab, normalizedSummary])
  const mrpFlowRows = useMemo(() => {
    if (!isMrpTab) return []
    return [
      { label: "Theoretical", value: toNumber(normalizedSummary.theoretical_kg), color: "#334155" },
      { label: "Required", value: toNumber(normalizedSummary.required_kg), color: "#f59e0b" },
      { label: "Planned issue", value: toNumber(normalizedSummary.planned_issue_kg), color: "#6366f1" },
      { label: "Actual issued", value: toNumber(normalizedSummary.actual_issued_kg), color: "#0ea5e9" },
      { label: "Consumed", value: toNumber(normalizedSummary.consumed_kg), color: "#10b981" },
      { label: "Returned", value: toNumber(normalizedSummary.returned_kg), color: "#94a3b8" },
      { label: "Scrap", value: toNumber(normalizedSummary.scrap_kg), color: "#ef4444" },
    ]
  }, [isMrpTab, normalizedSummary])
  const mrpBreakdowns = useMemo(() => {
    if (!isMrpTab) return { byMaterial: [], jobVariance: [], waterfall: [] }
    const raw = payload.breakdowns || {}
    return {
      byMaterial: Array.isArray(raw.by_material)
        ? raw.by_material.filter((row): row is Record<string, any> => !!row && typeof row === "object")
        : tableRows,
      jobVariance: Array.isArray(raw.job_variance)
        ? raw.job_variance.filter((row): row is Record<string, any> => !!row && typeof row === "object")
        : [],
      waterfall: Array.isArray(raw.waterfall)
        ? raw.waterfall.filter((row): row is Record<string, any> => !!row && typeof row === "object")
        : [],
    }
  }, [isMrpTab, payload.breakdowns, tableRows])
  const mrpKpis = useMemo(() => {
    if (!isMrpTab) return []
    return [
      { label: "Net variance", value: formatMetricValue("variance_kg", normalizedSummary.variance_kg), hint: "Consumed minus theoretical need", tone: "border-rose-200 bg-rose-50 text-rose-700" },
      { label: "Returned", value: formatMetricValue("returned_kg", normalizedSummary.returned_kg), hint: "Material booked back to stock", tone: "border-slate-200 bg-slate-50 text-slate-700" },
      { label: "Scrap", value: formatMetricValue("scrap_kg", normalizedSummary.scrap_kg), hint: "Material lost in execution", tone: "border-amber-200 bg-amber-50 text-amber-700" },
      { label: "Planning accuracy", value: formatMetricValue("planning_accuracy_pct", normalizedSummary.planning_accuracy_pct), hint: "Theory versus actual consumption", tone: "border-emerald-200 bg-emerald-50 text-emerald-700" },
      { label: "Issue accuracy", value: formatMetricValue("issue_accuracy_pct", normalizedSummary.issue_accuracy_pct), hint: "Planned issue versus actual issue", tone: "border-cyan-200 bg-cyan-50 text-cyan-700" },
      { label: "Material coverage", value: `${formatMaybeNumber(payload.coverage?.material_actual_coverage, 0)}%`, hint: "Actual material logging coverage", tone: "border-indigo-200 bg-indigo-50 text-indigo-700" },
    ]
  }, [isMrpTab, normalizedSummary, payload.coverage])
  const interplantRows = useMemo(
    () => (isInterplantTab ? tableRows.filter((row) => row.dc_no || row.from_plant || row.to_plant) : []),
    [isInterplantTab, tableRows],
  )
  const interplantStatusRows = useMemo(() => {
    if (!isInterplantTab) return []
    return [
      { label: "Draft", value: toNumber(normalizedSummary.draft), color: "#64748b" },
      { label: "In transit", value: toNumber(normalizedSummary.in_transit), color: "#f59e0b" },
      { label: "Received", value: toNumber(normalizedSummary.received), color: "#10b981" },
    ]
  }, [isInterplantTab, normalizedSummary])
  const interplantRouteRows = useMemo(() => {
    if (!isInterplantTab) return []
    const grouped = new Map<string, { route: string; challans: number; weight_kg: number }>()
    for (const row of interplantRows) {
      const route = `${row.from_plant || "Unknown"} → ${row.to_plant || "Unknown"}`
      const bucket = grouped.get(route) || { route, challans: 0, weight_kg: 0 }
      bucket.challans += 1
      bucket.weight_kg += toNumber(row.dispatched_kg)
      grouped.set(route, bucket)
    }
    return [...grouped.values()].sort((left, right) => right.weight_kg - left.weight_kg).slice(0, 8)
  }, [isInterplantTab, interplantRows])
  const interplantKpis = useMemo(() => {
    if (!isInterplantTab) return []
    return [
      { label: "Challans", value: formatMetricValue("count", normalizedSummary.total_challans), hint: "Visible transfer documents", tone: "border-slate-200 bg-slate-50 text-slate-700" },
      { label: "Dispatched", value: formatMetricValue("dispatched_total_kg", normalizedSummary.dispatched_total_kg), hint: "Total kg sent between plants", tone: "border-indigo-200 bg-indigo-50 text-indigo-700" },
      { label: "Received", value: formatMetricValue("received_total_kg", normalizedSummary.received_total_kg), hint: "Total kg booked in at destination", tone: "border-emerald-200 bg-emerald-50 text-emerald-700" },
      { label: "Output in transit", value: formatMetricValue("output_in_transit_kg", normalizedSummary.output_in_transit_kg), hint: "Saleable mass still moving", tone: "border-amber-200 bg-amber-50 text-amber-700" },
      { label: "Remainder in transit", value: formatMetricValue("remainder_in_transit_kg", normalizedSummary.remainder_in_transit_kg), hint: "Remainder rolls still moving", tone: "border-cyan-200 bg-cyan-50 text-cyan-700" },
      { label: "Execution coverage", value: `${formatMaybeNumber(payload.coverage?.execution_log_coverage, 0)}%`, hint: "Transfer telemetry linked to execution", tone: "border-slate-200 bg-slate-50 text-slate-700" },
    ]
  }, [isInterplantTab, normalizedSummary, payload.coverage])
  const inventoryBreakdowns = useMemo(() => {
    if (!isInventoryTab) return { byFamily: [], byVariant: [], byStage: [], byItemType: [], aging: [], rows: [] }
    const raw = payload.breakdowns || {}
    const asRows = (value: unknown) => Array.isArray(value) ? value.filter((row): row is Record<string, any> => !!row && typeof row === "object") : []
    return {
      byFamily: sortRowsByKey(asRows(raw.by_family), "weight_kg"),
      byVariant: sortRowsByKey(asRows(raw.by_variant), "weight_kg"),
      byStage: sortRowsByKey(asRows(raw.by_stage), "weight_kg"),
      byItemType: sortRowsByKey(asRows(raw.by_item_type), "weight_kg"),
      aging: sortRowsByKey(asRows(raw.aging), "weight_kg"),
      rows: tableRows,
    }
  }, [isInventoryTab, payload.breakdowns, tableRows])
  const inventoryKpis = useMemo(() => {
    if (!isInventoryTab) return []
    return [
      { label: "Roll stock", value: formatMetricValue("total_weight_kg", normalizedSummary.total_weight_kg), hint: `${formatMetricValue("total_items", normalizedSummary.total_items)} physical rolls`, tone: "border-cyan-200 bg-cyan-50 text-cyan-700" },
      { label: "Families", value: formatMetricValue("count", inventoryBreakdowns.byFamily.length), hint: "Business-facing stock groups", tone: "border-indigo-200 bg-indigo-50 text-indigo-700" },
      { label: "Variants", value: formatMetricValue("count", inventoryBreakdowns.byVariant.length), hint: "Material variants currently visible", tone: "border-slate-200 bg-slate-50 text-slate-700" },
      { label: "Aged 90d+", value: formatMetricValue("aged_stock_weight_kg", normalizedSummary.aged_stock_weight_kg), hint: `${formatMetricValue("count", normalizedSummary.aged_stock_items)} aged rolls`, tone: "border-amber-200 bg-amber-50 text-amber-700" },
      { label: "Bulk stock", value: formatMetricValue("bulk_stock_kg", normalizedSummary.bulk_stock_kg), hint: `${formatMetricValue("count", normalizedSummary.bulk_items)} bulk rows`, tone: "border-emerald-200 bg-emerald-50 text-emerald-700" },
      { label: "Stock value", value: formatMetricValue("estimated_value", normalizedSummary.estimated_value), hint: "Estimated live valuation", tone: "border-violet-200 bg-violet-50 text-violet-700" },
    ]
  }, [isInventoryTab, inventoryBreakdowns.byFamily.length, inventoryBreakdowns.byVariant.length, normalizedSummary])

  const productionBreakdowns = useMemo(() => {
    if (!isProductionTab) {
      return { byProcess: [], byWorkCenter: [], byMachine: [], byShift: [], byState: [], byOperator: [], scrapReasons: [], rows: [] }
    }
    const raw = payload.breakdowns || {}
    return {
      byProcess: sortRowsByKey(asRecordRows(raw.by_process), "value"),
      byWorkCenter: sortRowsByKey(asRecordRows(raw.by_work_center), "output_kg"),
      byMachine: sortRowsByKey(asRecordRows(raw.by_machine), "actual_output"),
      byShift: sortRowsByKey(asRecordRows(raw.by_shift), "output_kg"),
      byState: sortRowsByKey(asRecordRows(raw.by_job_state), "count"),
      byOperator: sortRowsByKey(asRecordRows(raw.by_operator), "output_kg"),
      scrapReasons: sortRowsByKey(asRecordRows(raw.scrap_reasons), "scrap_kg"),
      rows: tableRows,
    }
  }, [isProductionTab, payload.breakdowns, tableRows])
  const productionKpis = useMemo(() => {
    if (!isProductionTab) return []
    return [
      { label: "Output", value: formatMetricValue("total_output_kg", normalizedSummary.total_output_kg), hint: "Logged good output in the active window", tone: "border-cyan-200 bg-cyan-50 text-cyan-700" },
      { label: "Yield", value: formatMetricValue("yield_pct", normalizedSummary.yield_pct), hint: `${formatMetricValue("total_scrap_kg", normalizedSummary.total_scrap_kg)} scrap booked`, tone: "border-emerald-200 bg-emerald-50 text-emerald-700" },
      { label: "Completion", value: formatMetricValue("completion_rate", normalizedSummary.completion_rate), hint: `${formatMetricValue("completed_jobs", normalizedSummary.completed_jobs)} finished jobs`, tone: "border-indigo-200 bg-indigo-50 text-indigo-700" },
      { label: "Active machines", value: formatMetricValue("active_machines", normalizedSummary.active_machines), hint: `${formatMetricValue("active_work_centers", normalizedSummary.active_work_centers)} work centers engaged`, tone: "border-slate-200 bg-slate-50 text-slate-700" },
      { label: "Jobs with scrap", value: formatMetricValue("jobs_with_scrap", normalizedSummary.jobs_with_scrap), hint: `${formatMetricValue("total_jobs", normalizedSummary.total_jobs)} total jobs in the lens`, tone: "border-amber-200 bg-amber-50 text-amber-700" },
      { label: "Output trend", value: formatMetricValue("output_trend_pct", normalizedSummary.output_trend_pct), hint: `${formatMetricValue("target_daily_output", normalizedSummary.target_daily_output)} daily target`, tone: "border-violet-200 bg-violet-50 text-violet-700" },
    ]
  }, [isProductionTab, normalizedSummary])

  const salesAnalytics = useMemo(() => {
    if (!isSalesTab) {
      return {
        pipeline: [],
        topCustomers: [],
        skuBreakdown: [],
        overdue: [],
        trend: [],
        repeatMix: { repeat: 0, custom: 0, template: 0 },
        quoteConversion: { total_quotes: 0, converted_quotes: 0, conversion_pct: 0 },
      }
    }
    return {
      pipeline: sortRowsByKey(asRecordRows(payload.breakdowns?.pipeline || rawPayload.pipeline), "count"),
      topCustomers: sortRowsByKey(asRecordRows(payload.breakdowns?.top_customers || rawPayload.top_customers), "weight_kg"),
      skuBreakdown: sortRowsByKey(asRecordRows(rawPayload.sku_breakdown), "weight_kg"),
      overdue: asRecordRows(rawPayload.overdue_orders),
      trend: asRecordRows(rawPayload.trend || payload.series),
      repeatMix: rawPayload.repeat_mix || { repeat: 0, custom: 0, template: 0 },
      quoteConversion: rawPayload.quote_conversion || { total_quotes: 0, converted_quotes: 0, conversion_pct: 0 },
    }
  }, [isSalesTab, payload.breakdowns, payload.series, rawPayload])
  const salesKpis = useMemo(() => {
    if (!isSalesTab) return []
    return [
      { label: "Backlog", value: formatMetricValue("backlog_count", normalizedSummary.backlog_count), hint: "Open orders still in the system", tone: "border-slate-200 bg-slate-50 text-slate-700" },
      { label: "Overdue", value: formatMetricValue("overdue_count", normalizedSummary.overdue_count), hint: "Delivery dates already missed", tone: "border-rose-200 bg-rose-50 text-rose-700" },
      { label: "OTIF", value: formatMetricValue("otif_rate", normalizedSummary.otif_rate), hint: "Completed orders on time and in full", tone: "border-emerald-200 bg-emerald-50 text-emerald-700" },
      { label: "Revenue", value: formatMetricValue("total_revenue", normalizedSummary.total_revenue), hint: `${formatMetricValue("total_weight_ordered_kg", normalizedSummary.total_weight_ordered_kg)} ordered`, tone: "border-amber-200 bg-amber-50 text-amber-700" },
      { label: "Repeat share", value: formatMetricValue("repeat_share_pct", normalizedSummary.repeat_share_pct), hint: "Repeat demand across order items", tone: "border-indigo-200 bg-indigo-50 text-indigo-700" },
      { label: "Quote conversion", value: formatMetricValue("quote_conversion_pct", normalizedSummary.quote_conversion_pct), hint: `${formatMetricValue("count", salesAnalytics.quoteConversion.converted_quotes)} converted quotes`, tone: "border-cyan-200 bg-cyan-50 text-cyan-700" },
    ]
  }, [isSalesTab, normalizedSummary, salesAnalytics.quoteConversion])

  const dispatchAnalytics = useMemo(() => {
    if (!isDispatchTab) {
      return { pipeline: [], byCustomer: [], dailyTrend: [], recent: [] }
    }
    return {
      pipeline: sortRowsByKey(asRecordRows(payload.breakdowns?.pipeline || rawPayload.pipeline), "count"),
      byCustomer: sortRowsByKey(asRecordRows(payload.breakdowns?.by_customer || rawPayload.by_customer), "weight_kg"),
      dailyTrend: asRecordRows(rawPayload.daily_trend || payload.series),
      recent: asRecordRows(rawPayload.recent_challans || payload.rows),
    }
  }, [isDispatchTab, payload.breakdowns, payload.rows, payload.series, rawPayload])
  const dispatchKpis = useMemo(() => {
    if (!isDispatchTab) return []
    return [
      { label: "Challans", value: formatMetricValue("total_challans", normalizedSummary.total_challans), hint: "Visible dispatch documents", tone: "border-slate-200 bg-slate-50 text-slate-700" },
      { label: "Dispatched", value: formatMetricValue("dispatched", normalizedSummary.dispatched), hint: "In transit, delivered, or dispatched", tone: "border-emerald-200 bg-emerald-50 text-emerald-700" },
      { label: "Pending", value: formatMetricValue("pending", normalizedSummary.pending), hint: "Draft challans not yet sent", tone: "border-amber-200 bg-amber-50 text-amber-700" },
      { label: "Gross load", value: formatMetricValue("total_weight_kg", normalizedSummary.total_weight_kg), hint: `${formatMetricValue("count", normalizedSummary.total_pcs)} pieces on challans`, tone: "border-cyan-200 bg-cyan-50 text-cyan-700" },
      { label: "Customers", value: formatMetricValue("count", dispatchAnalytics.byCustomer.length), hint: "Accounts visible in this dispatch window", tone: "border-indigo-200 bg-indigo-50 text-indigo-700" },
      { label: "Execution coverage", value: `${formatMaybeNumber(payload.coverage?.execution_log_coverage, 0)}%`, hint: "Dispatch window tied to execution telemetry", tone: "border-violet-200 bg-violet-50 text-violet-700" },
    ]
  }, [dispatchAnalytics.byCustomer.length, isDispatchTab, normalizedSummary, payload.coverage])

  const downtimeAnalytics = useMemo(() => {
    if (!isDowntimeTab) {
      return { pareto: [], topMachines: [], dailyTrend: [] }
    }
    return {
      pareto: sortRowsByKey(asRecordRows(rawPayload.pareto), "minutes"),
      topMachines: sortRowsByKey(asRecordRows(rawPayload.top_machines), "minutes"),
      dailyTrend: asRecordRows(rawPayload.daily_trend || payload.series),
    }
  }, [isDowntimeTab, payload.series, rawPayload])
  const downtimeKpis = useMemo(() => {
    if (!isDowntimeTab) return []
    return [
      { label: "Downtime", value: formatMetricValue("total_downtime_hours", normalizedSummary.total_downtime_hours), hint: `${formatMetricValue("total_downtime_minutes", normalizedSummary.total_downtime_minutes)} total minutes`, tone: "border-rose-200 bg-rose-50 text-rose-700" },
      { label: "Events", value: formatMetricValue("total_events", normalizedSummary.total_events), hint: "Recorded machine stoppages", tone: "border-slate-200 bg-slate-50 text-slate-700" },
      { label: "MTTR", value: `${formatMaybeNumber(normalizedSummary.mttr_minutes, 1)} min`, hint: "Mean time to recovery", tone: "border-amber-200 bg-amber-50 text-amber-700" },
      { label: "Events / day", value: formatMetricValue("avg_events_per_day", normalizedSummary.avg_events_per_day), hint: "Average stop count per active day", tone: "border-indigo-200 bg-indigo-50 text-indigo-700" },
    ]
  }, [isDowntimeTab, normalizedSummary])

  const operatorAnalytics = useMemo(() => {
    if (!isOperatorTab) {
      return { leaderboard: [], best: null, worst: null }
    }
    return {
      leaderboard: sortRowsByKey(asRecordRows(rawPayload.leaderboard || payload.rows), "produced_kg"),
      best: rawPayload.best || null,
      worst: rawPayload.worst || null,
    }
  }, [isOperatorTab, payload.rows, rawPayload])
  const operatorKpis = useMemo(() => {
    if (!isOperatorTab) return []
    return [
      { label: "Operators", value: formatMetricValue("active_operators", normalizedSummary.active_operators), hint: "Users with work in the lens", tone: "border-slate-200 bg-slate-50 text-slate-700" },
      { label: "Output", value: formatMetricValue("total_output_kg", normalizedSummary.total_output_kg), hint: "Production attributed to operators", tone: "border-cyan-200 bg-cyan-50 text-cyan-700" },
      { label: "Avg efficiency", value: formatMetricValue("avg_efficiency", normalizedSummary.avg_efficiency), hint: "Good output share of processed mass", tone: "border-emerald-200 bg-emerald-50 text-emerald-700" },
      { label: "Best", value: formatMetricValue("best_operator", normalizedSummary.best_operator), hint: "Top operator in the visible leaderboard", tone: "border-indigo-200 bg-indigo-50 text-indigo-700" },
      { label: "Worst", value: formatMetricValue("worst_operator", normalizedSummary.worst_operator), hint: "Lowest efficiency in the same lens", tone: "border-amber-200 bg-amber-50 text-amber-700" },
    ]
  }, [isOperatorTab, normalizedSummary])

  const costingAnalytics = useMemo(() => {
    if (!isCostingTab) {
      return { costSplit: [], customerMargin: [], monthlyTrend: [], overheadTrend: [], costPerKgTrend: [] }
    }
    return {
      costSplit: asRecordRows(rawPayload.cost_split),
      customerMargin: sortRowsByKey(asRecordRows(rawPayload.customer_margin), "revenue"),
      monthlyTrend: asRecordRows(rawPayload.monthly_trend || payload.series),
      overheadTrend: asRecordRows(rawPayload.overhead_trend),
      costPerKgTrend: asRecordRows(rawPayload.cost_per_kg_trend),
    }
  }, [isCostingTab, payload.series, rawPayload])
  const costingKpis = useMemo(() => {
    if (!isCostingTab) return []
    return [
      { label: "Revenue", value: formatMetricValue("total_revenue", normalizedSummary.total_revenue), hint: "Order-side selling value", tone: "border-emerald-200 bg-emerald-50 text-emerald-700" },
      { label: "Production cost", value: formatMetricValue("total_production_cost", normalizedSummary.total_production_cost), hint: "Material + conversion + absorbed overhead", tone: "border-rose-200 bg-rose-50 text-rose-700" },
      { label: "Contribution", value: formatMetricValue("total_contribution", normalizedSummary.total_contribution), hint: "Contribution margin across costed orders", tone: "border-cyan-200 bg-cyan-50 text-cyan-700" },
      { label: "Margin", value: formatMetricValue("total_margin", normalizedSummary.total_margin), hint: `${formatMetricValue("avg_margin_pct", normalizedSummary.avg_margin_pct)} average margin`, tone: "border-indigo-200 bg-indigo-50 text-indigo-700" },
      { label: "Cost / kg", value: formatMetricValue("avg_cost_per_kg", normalizedSummary.avg_cost_per_kg), hint: `${formatMetricValue("total_jobs_costed", normalizedSummary.total_jobs_costed)} jobs costed`, tone: "border-amber-200 bg-amber-50 text-amber-700" },
      { label: "Coverage", value: formatMetricValue("avg_actual_cost_coverage_pct", normalizedSummary.avg_actual_cost_coverage_pct), hint: `${formatMetricValue("avg_order_coverage_pct", normalizedSummary.avg_order_coverage_pct)} order coverage`, tone: "border-slate-200 bg-slate-50 text-slate-700" },
    ]
  }, [isCostingTab, normalizedSummary])

  const shiftAnalytics = useMemo(() => {
    if (!isShiftTab) {
      return { rows: [], series: [] }
    }
    return {
      rows: sortRowsByKey(asRecordRows(payload.breakdowns?.shift_oee_like || payload.rows), "output_kg"),
      series: asRecordRows(payload.series),
    }
  }, [isShiftTab, payload.breakdowns, payload.rows, payload.series])
  const shiftKpis = useMemo(() => {
    if (!isShiftTab) return []
    return [
      { label: "Output", value: formatMetricValue("total_output_kg", normalizedSummary.total_output_kg), hint: "Shift-tagged output in the window", tone: "border-cyan-200 bg-cyan-50 text-cyan-700" },
      { label: "Scrap", value: formatMetricValue("total_scrap_kg", normalizedSummary.total_scrap_kg), hint: "Scrap attributed to shifts", tone: "border-rose-200 bg-rose-50 text-rose-700" },
      { label: "Downtime", value: `${formatMaybeNumber(normalizedSummary.total_downtime_minutes, 0)} min`, hint: "Downtime linked to shift tags", tone: "border-amber-200 bg-amber-50 text-amber-700" },
      { label: "Shift count", value: formatMetricValue("shift_count", normalizedSummary.shift_count), hint: "Visible shift buckets", tone: "border-indigo-200 bg-indigo-50 text-indigo-700" },
    ]
  }, [isShiftTab, normalizedSummary])

  const inkAnalytics = useMemo(() => {
    if (!isInkTab) {
      return {
        topVariance: [],
        flow: [],
      }
    }
    return {
      topVariance: sortRowsByKey(asRecordRows(payload.breakdowns?.top_variance || payload.rows), "variance_qty"),
      flow: [
        { label: "Theoretical", value: toNumber(normalizedSummary.ink_theoretical_kg) },
        { label: "Planned issue", value: toNumber(normalizedSummary.ink_planned_issue_kg) },
        { label: "Actual issued", value: toNumber(normalizedSummary.ink_actual_issued_kg) },
        { label: "Returned", value: toNumber(normalizedSummary.ink_returned_kg) },
        { label: "Consumed", value: toNumber(normalizedSummary.ink_consumed_kg) },
        { label: "Variance", value: Math.abs(toNumber(normalizedSummary.ink_variance_kg)) },
      ],
    }
  }, [isInkTab, normalizedSummary, payload.breakdowns, payload.rows])
  const inkKpis = useMemo(() => {
    if (!isInkTab) return []
    return [
      { label: "Color families", value: formatMetricValue("count", normalizedSummary.color_families), hint: "Resolved CMYK and custom ink groups in the window", tone: "border-slate-200 bg-slate-50 text-slate-700" },
      { label: "Theoretical", value: formatMetricValue("kg", normalizedSummary.ink_theoretical_kg), hint: "Artwork-driven ink requirement", tone: "border-indigo-200 bg-indigo-50 text-indigo-700" },
      { label: "Planned issue", value: formatMetricValue("kg", normalizedSummary.ink_planned_issue_kg), hint: "Planner-issued ink expectation", tone: "border-cyan-200 bg-cyan-50 text-cyan-700" },
      { label: "Actual issued", value: formatMetricValue("kg", normalizedSummary.ink_actual_issued_kg), hint: "What the machine actually drew", tone: "border-amber-200 bg-amber-50 text-amber-700" },
      { label: "Returned", value: formatMetricValue("kg", normalizedSummary.ink_returned_kg), hint: "Ink booked back after run close", tone: "border-emerald-200 bg-emerald-50 text-emerald-700" },
      { label: "Consumed", value: formatMetricValue("kg", normalizedSummary.ink_consumed_kg), hint: "Net ink absorbed by the job", tone: "border-violet-200 bg-violet-50 text-violet-700" },
      { label: "Net variance", value: formatMetricValue("kg", normalizedSummary.ink_variance_kg), hint: "Consumed minus theoretical expectation", tone: "border-rose-200 bg-rose-50 text-rose-700" },
    ]
  }, [isInkTab, normalizedSummary])
  const scrapBreakdowns = useMemo(() => {
    const raw = payload.breakdowns || {}
    return {
      byReason: sortRowsByKey(Array.isArray(raw.by_reason) ? raw.by_reason : [], "scrap_kg"),
      byProcess: sortRowsByKey(Array.isArray(raw.by_process) ? raw.by_process : [], "scrap_kg"),
      byOperator: sortRowsByKey(Array.isArray(raw.by_operator) ? raw.by_operator : [], "scrap_kg"),
      byMachine: sortRowsByKey(Array.isArray(raw.by_machine) ? raw.by_machine : [], "scrap_kg"),
      topJobs: sortRowsByKey(Array.isArray(raw.top_jobs) ? raw.top_jobs : [], "scrap_kg"),
    }
  }, [payload.breakdowns])
  const scrapKpis = useMemo(() => {
    if (!isScrapTab) return []
    const summary = payload.summary || {}
    return [
      { key: "total_scrap_kg", label: "Total scrap", value: formatMetricValue("total_scrap_kg", summary.total_scrap_kg), tone: "border-rose-200 bg-rose-50 text-rose-700", icon: Scissors },
      { key: "total_processed_kg", label: "Processed", value: formatMetricValue("total_processed_kg", summary.total_processed_kg), tone: "border-slate-200 bg-slate-50 text-slate-700", icon: Factory },
      { key: "yield_pct", label: "Yield", value: formatMetricValue("yield_pct", summary.yield_pct), tone: "border-emerald-200 bg-emerald-50 text-emerald-700", icon: Activity },
      { key: "scrap_rate", label: "Scrap rate", value: formatMetricValue("scrap_rate", summary.scrap_rate), tone: "border-amber-200 bg-amber-50 text-amber-700", icon: AlertTriangle },
      { key: "cost_of_scrap", label: "Scrap cost", value: formatMetricValue("cost_of_scrap", summary.cost_of_scrap), tone: "border-rose-200 bg-rose-50 text-rose-700", icon: DollarSign },
      { key: "avg_scrap_per_event_kg", label: "Avg per event", value: formatMetricValue("avg_scrap_per_event_kg", summary.avg_scrap_per_event_kg), tone: "border-slate-200 bg-slate-50 text-slate-700", icon: Gauge },
      { key: "jobs_with_scrap", label: "Jobs hit", value: formatMetricValue("jobs_with_scrap", summary.jobs_with_scrap), tone: "border-slate-200 bg-slate-50 text-slate-700", icon: Package },
      { key: "top_reason", label: "Top reason", value: formatMetricValue("top_reason", summary.top_reason), tone: "border-indigo-200 bg-indigo-50 text-indigo-700", icon: BarChart3 },
    ]
  }, [isScrapTab, payload.summary])
  const scrapBenchmarks = useMemo(() => ((payload as any)?.benchmarks || {}) as Record<string, any>, [payload])
  const scrapSignalCards = useMemo(() => {
    if (!isScrapTab) return []
    const summary = payload.summary || {}
    return [
      {
        label: "Top reason",
        value: formatMetricValue("top_reason", summary.top_reason),
        hint: `${formatMetricValue("total_events", summary.total_events)} logged scrap events`,
      },
      {
        label: "Top machine",
        value: formatMetricValue("top_machine", summary.top_machine),
        hint: `${formatMetricValue("jobs_with_scrap", summary.jobs_with_scrap)} jobs hit`,
      },
      {
        label: "Target scrap rate",
        value: formatMetricValue("target_scrap_rate", scrapBenchmarks.target_scrap_rate),
        hint: `Live rate ${formatMetricValue("scrap_rate", summary.scrap_rate)}`,
      },
      {
        label: "Target yield",
        value: formatMetricValue("target_yield", scrapBenchmarks.target_yield),
        hint: `Live yield ${formatMetricValue("yield_pct", summary.yield_pct)}`,
      },
    ]
  }, [isScrapTab, payload.summary, scrapBenchmarks])
  const scrapMassBalance = useMemo(() => {
    if (!isScrapTab) return []
    const summary = payload.summary || {}
    return [
      { label: "Good output", value: formatMetricValue("total_good_kg", summary.total_good_kg), hint: "Net saleable quantity" },
      { label: "Processed", value: formatMetricValue("total_processed_kg", summary.total_processed_kg), hint: "Good + scrap" },
      { label: "Consumed", value: formatMetricValue("total_consumed_kg", summary.total_consumed_kg), hint: "Material drawdown" },
      { label: "Avg cost / kg", value: formatMetricValue("avg_cost_per_kg", summary.avg_cost_per_kg), hint: "Used in scrap costing" },
    ]
  }, [isScrapTab, payload.summary])
  const scrapKgBoards = useMemo(
    () =>
      isScrapTab
        ? [
            { key: "reason-kg", title: "Reason kg split", rows: scrapBreakdowns.byReason, labelKey: "reason" },
            { key: "process-kg", title: "Process kg split", rows: scrapBreakdowns.byProcess, labelKey: "process" },
            { key: "machine-kg", title: "Machine kg split", rows: scrapBreakdowns.byMachine, labelKey: "machine" },
          ]
        : [],
    [isScrapTab, scrapBreakdowns],
  )

  const reportErrorMessage = reportQuery.isError ? describeApiError(reportQuery.error, "Report request failed.") : ""

  const handleExport = () => {
    const url = analyticsApi.getReportTabPdfDownloadUrl(tab, filters)
    window.open(url, "_blank", "noopener,noreferrer")
  }

  return (
    <div className="space-y-6 pb-8 animate-in fade-in duration-500">
      <section className={cn("overflow-hidden rounded-[2rem] border border-white/10 bg-gradient-to-br px-6 py-6 text-white shadow-[0_32px_90px_-42px_rgba(15,23,42,0.45)]", accentStyle.panel)}>
        <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.26em] text-white/90">
              <Sparkles className="h-3.5 w-3.5" />
              Data-Rich Report
            </div>
            <div>
              <h1 className="text-3xl font-black tracking-[-0.04em]">{title}</h1>
              <p className="mt-2 max-w-3xl text-sm text-white/80">{description}</p>
            </div>
            <div className="flex flex-wrap gap-2 text-[11px] font-semibold text-white/85">
              <Badge className="rounded-full border border-white/15 bg-white/10 text-white">Window {dateFrom} to {dateTo}</Badge>
              <Badge className="rounded-full border border-white/15 bg-white/10 text-white">Generated {payload.generated_at ? new Date(payload.generated_at).toLocaleString() : "—"}</Badge>
              <Badge className="rounded-full border border-white/15 bg-white/10 text-white">Rows {tableRows.length}</Badge>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="border-white/20 bg-white/10 text-white hover:bg-white/15 hover:text-white"
              onClick={() => reportQuery.refetch()}
            >
              <RefreshCw className={cn("mr-2 h-4 w-4", reportQuery.isFetching && "animate-spin")} />
              Refresh
            </Button>
            <Button
              variant="outline"
              className="border-white/20 bg-white/10 text-white hover:bg-white/15 hover:text-white"
              onClick={handleExport}
            >
              <Download className="mr-2 h-4 w-4" />
              Download PDF
            </Button>
          </div>
        </div>
      </section>

      <section className="rounded-[1.75rem] border border-slate-200 bg-white/90 p-4 shadow-sm">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            {(["daily", "weekly", "custom"] as FilterPreset[]).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setPreset(value)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-xs font-black uppercase tracking-[0.18em] transition",
                  preset === value ? accentStyle.chip : "border-slate-200 bg-slate-50 text-slate-500 hover:bg-slate-100",
                )}
              >
                {value}
              </button>
            ))}
            <div className="ml-auto inline-flex items-center gap-2 rounded-full bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
              <CalendarDays className="h-3.5 w-3.5 text-slate-400" />
              Daily, weekly, or custom audit lens
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            <div className="space-y-1.5">
              <Label className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Date from</Label>
              <Input type="date" value={dateFrom} onChange={(event) => { setPreset("custom"); setDateFrom(event.target.value) }} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Date to</Label>
              <Input type="date" value={dateTo} onChange={(event) => { setPreset("custom"); setDateTo(event.target.value) }} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Plant</Label>
              <Select value={plant} onValueChange={setPlant}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All plants</SelectItem>
                  {(plantsQuery.data || []).map((row: any) => <SelectItem key={row.id} value={row.id}>{row.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Process</Label>
              <Select value={processId} onValueChange={setProcessId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All processes</SelectItem>
                  {(processesQuery.data || []).map((row: any) => <SelectItem key={row.id} value={row.id}>{row.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Shift</Label>
              <Select value={shift} onValueChange={setShift}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All shifts</SelectItem>
                  {(shiftsQuery.data || []).map((row: any) => <SelectItem key={row.id} value={row.code}>{row.code}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Card className="border-slate-200 bg-slate-50">
              <CardContent className="flex h-full flex-col justify-center gap-1 p-4">
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">
                  {suppressGenericSharedShell ? "Data lens" : "Coverage"}
                </div>
                <div className="text-sm font-semibold text-slate-900">
                  {suppressGenericSharedShell
                    ? `Rows ${tableRows.length} · Splits ${breakdownGroups.length}`
                    : `Exec ${formatMaybeNumber(payload.coverage?.execution_log_coverage, 0)}% · Material ${formatMaybeNumber(payload.coverage?.material_actual_coverage, 0)}%`}
                </div>
                <div className="text-xs text-slate-500">
                  {suppressGenericSharedShell
                    ? "Telemetry is not the gating source for this report."
                    : `Shift ${formatMaybeNumber(payload.coverage?.shift_coverage, 0)}%`}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {reportQuery.isError ? (
        <ReportStateBanner
          title="Report failed to load"
          message={reportErrorMessage}
          tone="degraded"
          actionLabel="Refresh"
          onAction={() => reportQuery.refetch()}
        />
      ) : null}

      {!reportPending && visibleWarnings.length ? (
        <ReportStateBanner
          title="Report needs attention"
          message={visibleWarnings.join(" ")}
          tone="degraded"
          actionLabel="Refresh"
          onAction={() => reportQuery.refetch()}
        />
      ) : null}

      {degraded ? (
        <ReportStateBanner
          title="Report is live but thin"
          message={degradedMessage}
          tone="info"
        />
      ) : null}

      {isScrapTab ? (
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {scrapKpis.map((metric) => {
            const Icon = metric.icon
            return (
              <Card key={metric.key} className={cn("overflow-hidden border shadow-sm", metric.tone)}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.16em]">
                    <Icon className="h-4 w-4" />
                    {metric.label}
                  </div>
                  <div className="mt-3 text-2xl font-black tracking-[-0.04em] text-slate-900">{metric.value}</div>
                </CardContent>
              </Card>
            )
          })}
        </section>
      ) : null}

      {isOeeTab ? (
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {oeeSpotlightCards.map((metric) => (
            <Card key={metric.label} className="rounded-[1.55rem] border border-slate-200 bg-white shadow-sm">
              <CardContent className="p-4">
                <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">{metric.label}</div>
                <div className="mt-3 text-[1.8rem] font-black tracking-[-0.05em] text-slate-900">{metric.value}</div>
                <div className="mt-1 text-xs font-semibold text-slate-500">{metric.hint}</div>
              </CardContent>
            </Card>
          ))}
        </section>
      ) : null}

      {isScrapTab ? (
        <section className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr] xl:items-start">
          <Card className="rounded-[1.75rem] border-slate-200 shadow-sm">
            <CardHeader className="pb-0">
              <CardTitle className="flex items-center gap-2 text-xl font-black text-slate-900">
                <Scissors className={cn("h-5 w-5 rounded-full p-1 text-white", accentStyle.badge)} />
                Scrap Hotspots
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 pt-4 md:grid-cols-2">
              <InsightListCard title="By reason" rows={scrapBreakdowns.byReason} labelKey="reason" />
              <InsightListCard title="By process" rows={scrapBreakdowns.byProcess} labelKey="process" />
              <InsightListCard title="By machine" rows={scrapBreakdowns.byMachine} labelKey="machine" />
              <InsightListCard title="By operator" rows={scrapBreakdowns.byOperator} labelKey="operator" />
            </CardContent>
          </Card>

          <Card className="rounded-[1.75rem] border-slate-200 shadow-sm">
            <CardHeader className="pb-0">
              <CardTitle className="flex items-center gap-2 text-xl font-black text-slate-900">
                <AlertTriangle className={cn("h-5 w-5 rounded-full p-1 text-white", accentStyle.badge)} />
                Top Scrap Jobs
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-4">
              {scrapBreakdowns.topJobs.length ? (
                scrapBreakdowns.topJobs.slice(0, 8).map((row, index) => (
                  <div key={`${row.job_id || row.job_number || index}`} className="rounded-[1.1rem] border border-slate-200 bg-slate-50 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-sm font-black text-slate-900">{row.job_number || `Job ${index + 1}`}</div>
                        <div className="text-xs text-slate-500">{row.template_name || "Template pending"} · {row.process_name || "Process pending"}</div>
                      </div>
                      <Badge className="rounded-full border border-rose-200 bg-rose-50 text-rose-700">
                        {formatMetricValue("scrap_kg", row.scrap_kg)}
                      </Badge>
                    </div>
                    <div className="mt-3 grid gap-2 text-sm text-slate-600 sm:grid-cols-3">
                      <div className="rounded-xl bg-white px-3 py-2">
                        <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Good</div>
                        <div className="mt-1 font-semibold text-slate-900">{formatMetricValue("good_kg", row.good_kg)}</div>
                      </div>
                      <div className="rounded-xl bg-white px-3 py-2">
                        <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Yield</div>
                        <div className="mt-1 font-semibold text-slate-900">{formatMetricValue("yield_pct", row.yield_pct)}</div>
                      </div>
                      <div className="rounded-xl bg-white px-3 py-2">
                        <div className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">Events</div>
                        <div className="mt-1 font-semibold text-slate-900">{formatMetricValue("events", row.events)}</div>
                      </div>
                    </div>
                    <div className="mt-2 text-xs text-slate-500">{row.machine_name || "Unassigned machine"}</div>
                  </div>
                ))
              ) : (
                <div className="rounded-[1.2rem] border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm font-semibold text-slate-500">
                  No scrap-heavy jobs were returned for this filter window.
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      ) : null}

      {isScrapTab ? (
        <section className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr] xl:items-start">
          <Card className="rounded-[1.75rem] border-slate-200 shadow-sm">
            <CardHeader className="pb-0">
              <CardTitle className="flex items-center gap-2 text-xl font-black text-slate-900">
                <Factory className={cn("h-5 w-5 rounded-full p-1 text-white", accentStyle.badge)} />
                Mass Balance
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 pt-4 md:grid-cols-2">
              {scrapMassBalance.map((metric) => (
                <div key={metric.label} className="rounded-[1.2rem] border border-slate-200 bg-slate-50 p-4">
                  <div className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">{metric.label}</div>
                  <div className="mt-3 text-2xl font-black tracking-[-0.04em] text-slate-900">{metric.value}</div>
                  <div className="mt-2 text-xs text-slate-500">{metric.hint}</div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="rounded-[1.75rem] border-slate-200 shadow-sm">
            <CardHeader className="pb-0">
              <CardTitle className="flex items-center gap-2 text-xl font-black text-slate-900">
                <Sparkles className={cn("h-5 w-5 rounded-full p-1 text-white", accentStyle.badge)} />
                Signal Board
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 pt-4 sm:grid-cols-2">
              {scrapSignalCards.map((metric) => (
                <div key={metric.label} className={cn("rounded-[1.2rem] border p-4", scrapSignalTone(metric.label))}>
                  <div className="text-[11px] font-black uppercase tracking-[0.16em]">{metric.label}</div>
                  <div className="mt-3 text-lg font-black text-slate-900">{metric.value}</div>
                  <div className="mt-2 text-xs text-slate-500">{metric.hint}</div>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
      ) : null}

      {isMrpTab ? (
        <>
          <section className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr] xl:items-start">
            <Card className="rounded-[1.85rem] border-slate-200 shadow-sm">
              <CardHeader className="pb-0">
                <CardTitle className="flex items-center gap-2 text-xl font-black text-slate-900">
                  <LineChartIcon className={cn("h-5 w-5 rounded-full p-1 text-white", accentStyle.badge)} />
                  Theory vs issue vs use
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="h-[360px] min-w-0">
                  {mrpFlowRows.some((row) => row.value > 0) ? (
                    <ResponsiveContainer width="100%" height={360}>
                      <BarChart data={mrpFlowRows} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="#94a3b8" tickLine={false} axisLine={false} />
                        <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" tickLine={false} axisLine={false} />
                        <Tooltip formatter={(value) => formatMetricValue("kg", value)} />
                        <Bar dataKey="value" radius={[12, 12, 0, 0]}>
                          {mrpFlowRows.map((row) => (
                            <Cell key={row.label} fill={row.color} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  ) : reportPending ? (
                    <div className="flex h-full items-center justify-center rounded-[1.35rem] border border-dashed border-slate-200 bg-slate-50 text-sm font-semibold text-slate-500">
                      Loading live material movement…
                    </div>
                  ) : (
                    <div className="flex h-full items-center justify-center rounded-[1.35rem] border border-dashed border-slate-200 bg-slate-50 text-sm font-semibold text-slate-500">
                      No material movement was captured for this filter window.
                    </div>
                  )}
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-[1.15rem] border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Theory to required</div>
                    <div className="mt-2 text-lg font-black text-slate-900">{formatMetricValue("kg", toNumber(normalizedSummary.required_kg) - toNumber(normalizedSummary.theoretical_kg))}</div>
                  </div>
                  <div className="rounded-[1.15rem] border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Issue delta</div>
                    <div className="mt-2 text-lg font-black text-slate-900">{formatMetricValue("kg", toNumber(normalizedSummary.actual_issued_kg) - toNumber(normalizedSummary.planned_issue_kg))}</div>
                  </div>
                  <div className="rounded-[1.15rem] border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Consumption delta</div>
                    <div className="mt-2 text-lg font-black text-slate-900">{formatMetricValue("kg", toNumber(normalizedSummary.consumed_kg) - toNumber(normalizedSummary.actual_issued_kg))}</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-[1.85rem] border-slate-200 shadow-sm">
              <CardHeader className="pb-0">
                <CardTitle className="flex items-center gap-2 text-xl font-black text-slate-900">
                  <Gauge className={cn("h-5 w-5 rounded-full p-1 text-white", accentStyle.badge)} />
                  Control signals
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 pt-4 sm:grid-cols-2 xl:grid-cols-1">
                {mrpKpis.map((metric) => (
                  <div key={metric.label} className={cn("rounded-[1.2rem] border p-4", metric.tone)}>
                    <div className="text-[11px] font-black uppercase tracking-[0.16em]">{metric.label}</div>
                    <div className="mt-3 text-[1.65rem] font-black tracking-[-0.05em] text-slate-900">{metric.value}</div>
                    <div className="mt-2 text-xs text-slate-500">{metric.hint}</div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </section>

          <section className="grid gap-5 xl:grid-cols-[1.05fr_0.95fr] xl:items-start">
            <Card className="rounded-[1.85rem] border-slate-200 shadow-sm">
              <CardHeader className="pb-0">
                <CardTitle className="flex items-center gap-2 text-xl font-black text-slate-900">
                  <BarChart3 className={cn("h-5 w-5 rounded-full p-1 text-white", accentStyle.badge)} />
                  Material pressure
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="h-[360px] min-w-0">
                  {mrpBreakdowns.byMaterial.length ? (
                    <ResponsiveContainer width="100%" height={360}>
                      <BarChart data={mrpBreakdowns.byMaterial.slice(0, 8)} layout="vertical" margin={{ top: 8, right: 8, left: 24, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 11 }} stroke="#94a3b8" tickLine={false} axisLine={false} />
                        <YAxis type="category" dataKey="name" width={138} tick={{ fontSize: 11 }} stroke="#94a3b8" tickLine={false} axisLine={false} />
                        <Tooltip formatter={(value, name) => [formatMetricValue("kg", value), toLabel(String(name || ""))]} />
                        <Legend />
                        <Bar dataKey="consumed" name="Consumed" fill="#0f766e" radius={[0, 8, 8, 0]} />
                        <Bar dataKey="variance" name="Variance" fill="#f97316" radius={[0, 8, 8, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : reportPending ? (
                    <div className="flex h-full items-center justify-center rounded-[1.35rem] border border-dashed border-slate-200 bg-slate-50 text-sm font-semibold text-slate-500">
                      Loading material pressure…
                    </div>
                  ) : (
                    <div className="flex h-full items-center justify-center rounded-[1.35rem] border border-dashed border-slate-200 bg-slate-50 text-sm font-semibold text-slate-500">
                      No material rows returned for this filter window.
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-[1.85rem] border-slate-200 shadow-sm">
              <CardHeader className="pb-0">
                <CardTitle className="flex items-center gap-2 text-xl font-black text-slate-900">
                  <Rows3 className={cn("h-5 w-5 rounded-full p-1 text-white", accentStyle.badge)} />
                  Variance waterfall
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 pt-4">
                {mrpBreakdowns.waterfall.length ? (
                  mrpBreakdowns.waterfall.map((row, index) => (
                    <div key={`${row.name || index}`} className="flex items-center justify-between gap-4 rounded-[1.15rem] border border-slate-200 bg-slate-50 px-4 py-3">
                      <div>
                        <div className="text-sm font-black text-slate-900">{String(row.name || `Step ${index + 1}`)}</div>
                        <div className="text-xs text-slate-500">{toLabel(String(row.type || "detail"))}</div>
                      </div>
                      <Badge className={cn(
                        "rounded-full border",
                        row.type === "add"
                          ? "border-amber-200 bg-amber-50 text-amber-700"
                          : row.type === "subtract"
                          ? "border-slate-200 bg-slate-50 text-slate-700"
                          : row.type === "total"
                          ? "border-rose-200 bg-rose-50 text-rose-700"
                          : "border-indigo-200 bg-indigo-50 text-indigo-700",
                      )}>
                        {formatMetricValue("kg", row.value)}
                      </Badge>
                    </div>
                  ))
                ) : reportPending ? (
                  <div className="rounded-[1.35rem] border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm font-semibold text-slate-500">
                    Loading variance cascade…
                  </div>
                ) : (
                  <div className="rounded-[1.35rem] border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm font-semibold text-slate-500">
                    No variance cascade is available for this filter window.
                  </div>
                )}
              </CardContent>
            </Card>
          </section>
        </>
      ) : isInterplantTab ? (
        <>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {interplantKpis.map((metric) => (
              <Card key={metric.label} className={cn("overflow-hidden border shadow-sm", metric.tone)}>
                <CardContent className="p-4">
                  <div className="text-[11px] font-black uppercase tracking-[0.18em]">{metric.label}</div>
                  <div className="mt-3 text-2xl font-black tracking-[-0.04em] text-slate-900">{metric.value}</div>
                  <div className="mt-2 text-xs text-slate-500">{metric.hint}</div>
                </CardContent>
              </Card>
            ))}
          </section>

          <section className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr] xl:items-start">
            <Card className="rounded-[1.85rem] border-slate-200 shadow-sm">
              <CardHeader className="pb-0">
                <CardTitle className="flex items-center gap-2 text-xl font-black text-slate-900">
                  <LineChartIcon className={cn("h-5 w-5 rounded-full p-1 text-white", accentStyle.badge)} />
                  Dispatch vs receipts over time
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="h-[360px] min-w-0">
                  {chartSeries.rows.length && chartSeries.primaryKey ? (
                    <ResponsiveContainer width="100%" height={360}>
                      <AreaChart data={chartSeries.rows}>
                        <defs>
                          <linearGradient id={`${tab}-flow-fill`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.28} />
                            <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0.03} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                        <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" />
                        <Tooltip formatter={(value, name) => [String(name).includes("challan") ? formatMetricValue("count", value) : formatMetricValue("kg", value), String(name || "")]} />
                        <Area type="monotone" dataKey="weight_kg" name="Weight kg" stroke="#0ea5e9" fill={`url(#${tab}-flow-fill)`} strokeWidth={2.5} />
                        <Line type="monotone" dataKey="challans" name="Challans" stroke="#6366f1" strokeWidth={2.2} dot={false} />
                        <Legend />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : reportPending ? (
                    <div className="flex h-full items-center justify-center rounded-[1.35rem] border border-dashed border-slate-200 bg-slate-50 text-sm font-semibold text-slate-500">
                      Loading inter-plant movement trend…
                    </div>
                  ) : (
                    <div className="flex h-full items-center justify-center rounded-[1.35rem] border border-dashed border-slate-200 bg-slate-50 text-sm font-semibold text-slate-500">
                      No inter-plant movement trend is available for this filter window.
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-[1.85rem] border-slate-200 shadow-sm">
              <CardHeader className="pb-0">
                <CardTitle className="flex items-center gap-2 text-xl font-black text-slate-900">
                  <BarChart3 className={cn("h-5 w-5 rounded-full p-1 text-white", accentStyle.badge)} />
                  Transit posture
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 pt-4 md:grid-cols-[0.95fr_1.05fr]">
                <div className="h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={interplantStatusRows} dataKey="value" nameKey="label" innerRadius={56} outerRadius={82} stroke="none" paddingAngle={4}>
                        {interplantStatusRows.map((row) => (
                          <Cell key={row.label} fill={row.color} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value) => formatMetricValue("count", value)} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-3">
                  {interplantStatusRows.map((row) => (
                    <div key={row.label} className="rounded-[1.1rem] border border-slate-200 bg-slate-50 px-4 py-3">
                      <div className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">{row.label}</div>
                      <div className="mt-2 text-xl font-black text-slate-900">{formatMetricValue("count", row.value)}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </section>

          <section className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr] xl:items-start">
            <Card className="rounded-[1.85rem] border-slate-200 shadow-sm">
              <CardHeader className="pb-0">
                <CardTitle className="text-xl font-black text-slate-900">Busy routes</CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="h-[320px] min-w-0">
                  {interplantRouteRows.length ? (
                    <ResponsiveContainer width="100%" height={320}>
                      <BarChart data={interplantRouteRows} layout="vertical" margin={{ top: 8, right: 8, left: 20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 11 }} stroke="#94a3b8" tickLine={false} axisLine={false} />
                        <YAxis type="category" dataKey="route" width={156} tick={{ fontSize: 11 }} stroke="#94a3b8" tickLine={false} axisLine={false} />
                        <Tooltip formatter={(value, name) => [String(name) === "challans" ? formatMetricValue("count", value) : formatMetricValue("kg", value), toLabel(String(name || ""))]} />
                        <Legend />
                        <Bar dataKey="weight_kg" name="Weight kg" fill="#0ea5e9" radius={[0, 8, 8, 0]} />
                        <Bar dataKey="challans" name="Challans" fill="#6366f1" radius={[0, 8, 8, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : reportPending ? (
                    <div className="flex h-full items-center justify-center rounded-[1.35rem] border border-dashed border-slate-200 bg-slate-50 text-sm font-semibold text-slate-500">
                      Loading busy routes…
                    </div>
                  ) : (
                    <div className="flex h-full items-center justify-center rounded-[1.35rem] border border-dashed border-slate-200 bg-slate-50 text-sm font-semibold text-slate-500">
                      No route concentration is available for this filter window.
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="overflow-hidden rounded-[1.85rem] border-slate-200 shadow-sm">
              <CardHeader className="pb-0">
                <CardTitle className="text-xl font-black text-slate-900">Recent challans</CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="max-h-[520px] overflow-auto rounded-[1.2rem] border border-slate-200">
                  <table className="min-w-full text-sm">
                    <thead className="sticky top-0 bg-slate-50">
                      <tr>
                        {["dc_no", "status", "from_plant", "to_plant", "dispatched_kg", "received_kg"].map((column) => (
                          <th key={column} className="border-b border-slate-200 px-4 py-3 text-left text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">
                            {toLabel(column)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {interplantRows.slice(0, 25).map((row, index) => (
                        <tr key={`${row.dc_no || index}`} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/80">
                          <td className="px-4 py-3 font-semibold text-slate-900">{String(row.dc_no || "—")}</td>
                          <td className="px-4 py-3 text-slate-700">{String(row.status || "—")}</td>
                          <td className="px-4 py-3 text-slate-700">{String(row.from_plant || "—")}</td>
                          <td className="px-4 py-3 text-slate-700">{String(row.to_plant || "—")}</td>
                          <td className="px-4 py-3 text-slate-700">{formatMetricValue("kg", row.dispatched_kg)}</td>
                          <td className="px-4 py-3 text-slate-700">{formatMetricValue("kg", row.received_kg)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </section>
        </>
      ) : isInventoryTab ? (
        <>
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            {inventoryKpis.map((metric) => (
              <Card key={metric.label} className={cn("overflow-hidden border shadow-sm", metric.tone)}>
                <CardContent className="p-4">
                  <div className="text-[11px] font-black uppercase tracking-[0.18em]">{metric.label}</div>
                  <div className="mt-3 text-2xl font-black tracking-[-0.04em] text-slate-900">{metric.value}</div>
                  <div className="mt-2 text-xs font-semibold text-slate-500">{metric.hint}</div>
                </CardContent>
              </Card>
            ))}
          </section>

          <section className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr] xl:items-start">
            <Card className="rounded-[1.85rem] border-slate-200 shadow-sm">
              <CardHeader className="pb-0">
                <CardTitle className="flex items-center gap-2 text-xl font-black text-slate-900">
                  <BarChart3 className={cn("h-5 w-5 rounded-full p-1 text-white", accentStyle.badge)} />
                  Family stock standing
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="h-[380px] min-w-0">
                  {inventoryBreakdowns.byFamily.length ? (
                    <ResponsiveContainer width="100%" height={380}>
                      <BarChart data={inventoryBreakdowns.byFamily.slice(0, 10)} layout="vertical" margin={{ top: 8, right: 12, left: 26, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 11 }} stroke="#94a3b8" tickLine={false} axisLine={false} />
                        <YAxis type="category" dataKey="family" width={154} tick={{ fontSize: 11 }} stroke="#94a3b8" tickLine={false} axisLine={false} />
                        <Tooltip formatter={(value, name) => [formatMetricValue("kg", value), toLabel(String(name || ""))]} />
                        <Legend />
                        <Bar dataKey="available_kg" name="Available" stackId="stock" fill="#0f766e" radius={[0, 8, 8, 0]} />
                        <Bar dataKey="reserved_kg" name="Reserved" stackId="stock" fill="#f59e0b" radius={[0, 8, 8, 0]} />
                        <Bar dataKey="blocked_kg" name="Blocked" stackId="stock" fill="#e11d48" radius={[0, 8, 8, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : reportPending ? (
                    <div className="flex h-full items-center justify-center rounded-[1.35rem] border border-dashed border-slate-200 bg-slate-50 text-sm font-semibold text-slate-500">Loading inventory family stock...</div>
                  ) : (
                    <div className="flex h-full items-center justify-center rounded-[1.35rem] border border-dashed border-slate-200 bg-slate-50 text-sm font-semibold text-slate-500">No family stock is visible for this filter window.</div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-[1.85rem] border-slate-200 shadow-sm">
              <CardHeader className="pb-0">
                <CardTitle className="flex items-center gap-2 text-xl font-black text-slate-900">
                  <PieChartIcon className={cn("h-5 w-5 rounded-full p-1 text-white", accentStyle.badge)} />
                  Stage posture
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 pt-4 md:grid-cols-[0.95fr_1.05fr] xl:grid-cols-1">
                <div className="h-[230px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={inventoryBreakdowns.byStage} dataKey="weight_kg" nameKey="stage" innerRadius={58} outerRadius={92} stroke="none" paddingAngle={4}>
                        {inventoryBreakdowns.byStage.map((row, index) => (
                          <Cell key={String(row.stage || index)} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value) => formatMetricValue("kg", value)} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-3">
                  {inventoryBreakdowns.byStage.slice(0, 5).map((row) => (
                    <div key={String(row.stage)} className="flex items-center justify-between rounded-[1.1rem] border border-slate-200 bg-slate-50 px-4 py-3">
                      <div>
                        <div className="text-sm font-black text-slate-900">{String(row.stage || "Unknown")}</div>
                        <div className="text-xs text-slate-500">{formatMetricValue("count", row.count)} rolls</div>
                      </div>
                      <Badge className="rounded-full border border-cyan-200 bg-cyan-50 text-cyan-700">{formatMetricValue("kg", row.weight_kg)}</Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </section>

          <section className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr] xl:items-start">
            <Card className="rounded-[1.85rem] border-slate-200 shadow-sm">
              <CardHeader className="pb-0">
                <CardTitle className="text-xl font-black text-slate-900">Aging pressure</CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="h-[280px] min-w-0">
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={inventoryBreakdowns.aging} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                      <XAxis dataKey="range" tick={{ fontSize: 11 }} stroke="#94a3b8" tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" tickLine={false} axisLine={false} />
                      <Tooltip formatter={(value, name) => [String(name) === "count" ? formatMetricValue("count", value) : formatMetricValue("kg", value), toLabel(String(name || ""))]} />
                      <Legend />
                      <Bar dataKey="weight_kg" name="Weight kg" fill="#0ea5e9" radius={[10, 10, 0, 0]} />
                      <Bar dataKey="count" name="Roll count" fill="#6366f1" radius={[10, 10, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card className="overflow-hidden rounded-[1.85rem] border-slate-200 shadow-sm">
              <CardHeader className="pb-0">
                <CardTitle className="text-xl font-black text-slate-900">Variant ledger</CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="max-h-[360px] overflow-auto rounded-[1.2rem] border border-slate-200">
                  <table className="min-w-full text-sm">
                    <thead className="sticky top-0 bg-slate-50">
                      <tr>
                        {["variant", "weight_kg", "count"].map((column) => (
                          <th key={`inventory-variant-${column}`} className="border-b border-slate-200 px-4 py-3 text-left text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">{toLabel(column)}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {inventoryBreakdowns.byVariant.slice(0, 18).map((row, index) => (
                        <tr key={`${row.variant || index}`} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/80">
                          <td className="px-4 py-3 font-semibold text-slate-900">{String(row.variant || row.material_name || "Unknown")}</td>
                          <td className="px-4 py-3 text-slate-700">{formatMetricValue("kg", row.weight_kg)}</td>
                          <td className="px-4 py-3 text-slate-700">{formatMetricValue("count", row.count)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </section>
        </>
      ) : isProductionTab ? (
        <>
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            {productionKpis.map((metric) => (
              <Card key={metric.label} className={cn("overflow-hidden border shadow-sm", metric.tone)}>
                <CardContent className="p-4">
                  <div className="text-[11px] font-black uppercase tracking-[0.18em]">{metric.label}</div>
                  <div className="mt-3 text-2xl font-black tracking-[-0.04em] text-slate-900">{metric.value}</div>
                  <div className="mt-2 text-xs font-semibold text-slate-500">{metric.hint}</div>
                </CardContent>
              </Card>
            ))}
          </section>

          <section className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr] xl:items-start">
            <Card className="rounded-[1.85rem] border-slate-200 shadow-sm">
              <CardHeader className="pb-0">
                <CardTitle className="flex items-center gap-2 text-xl font-black text-slate-900">
                  <LineChartIcon className={cn("h-5 w-5 rounded-full p-1 text-white", accentStyle.badge)} />
                  Throughput cadence
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="h-[360px] min-w-0">
                  {chartSeries.rows.length ? (
                    <ResponsiveContainer width="100%" height={360}>
                      <AreaChart data={chartSeries.rows}>
                        <defs>
                          <linearGradient id={`${tab}-production-fill`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#2563eb" stopOpacity={0.24} />
                            <stop offset="95%" stopColor="#2563eb" stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                        <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" />
                        <Tooltip formatter={(value, name) => [String(name).includes("yield") ? formatMetricValue("yield_pct", value) : formatMetricValue("kg", value), toLabel(String(name || ""))]} />
                        <Legend />
                        <Area type="monotone" dataKey="output_kg" name="Output kg" stroke="#2563eb" fill={`url(#${tab}-production-fill)`} strokeWidth={2.4} />
                        <Line type="monotone" dataKey="scrap_kg" name="Scrap kg" stroke="#e11d48" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="yield_pct" name="Yield %" stroke="#0f766e" strokeWidth={2} dot={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full items-center justify-center rounded-[1.35rem] border border-dashed border-slate-200 bg-slate-50 text-sm font-semibold text-slate-500">
                      No production trend is available for this filter window.
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-[1.85rem] border-slate-200 shadow-sm">
              <CardHeader className="pb-0">
                <CardTitle className="text-xl font-black text-slate-900">Process mix and queue posture</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 pt-4">
                {productionBreakdowns.byProcess.slice(0, 5).map((row, index) => (
                  <div key={`${row.name || index}`} className="rounded-[1.15rem] border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-black text-slate-900">{String(row.name || "Unassigned")}</div>
                        <div className="text-xs text-slate-500">Primary throughput contributor</div>
                      </div>
                      <Badge className="rounded-full border border-cyan-200 bg-cyan-50 text-cyan-700">{formatMetricValue("kg", row.value)}</Badge>
                    </div>
                  </div>
                ))}
                <div className="grid gap-3 sm:grid-cols-2">
                  {productionBreakdowns.byState.slice(0, 4).map((row, index) => (
                    <div key={`${row.state || index}`} className="rounded-[1rem] border border-slate-200 bg-white px-4 py-3 shadow-sm">
                      <div className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">{toLabel(String(row.state || "unknown"))}</div>
                      <div className="mt-2 text-lg font-black text-slate-900">{formatMetricValue("count", row.count)}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </section>

          <section className="grid gap-5 xl:grid-cols-[0.92fr_1.08fr] xl:items-start">
            <Card className="rounded-[1.85rem] border-slate-200 shadow-sm">
              <CardHeader className="pb-0">
                <CardTitle className="text-xl font-black text-slate-900">Work-center loadboard</CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="h-[320px] min-w-0">
                  {productionBreakdowns.byWorkCenter.length ? (
                    <ResponsiveContainer width="100%" height={320}>
                      <BarChart data={productionBreakdowns.byWorkCenter.slice(0, 8)} layout="vertical" margin={{ top: 8, right: 8, left: 18, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 11 }} stroke="#94a3b8" tickLine={false} axisLine={false} />
                        <YAxis type="category" dataKey="work_center" width={112} tickFormatter={(value) => compactAxisLabel(value, 16)} tick={{ fontSize: 10 }} stroke="#94a3b8" tickLine={false} axisLine={false} />
                        <Tooltip formatter={(value, name) => [String(name).includes("job") ? formatMetricValue("count", value) : formatMetricValue("kg", value), toLabel(String(name || ""))]} />
                        <Legend />
                        <Bar dataKey="output_kg" name="Output kg" fill="#2563eb" radius={[0, 8, 8, 0]} />
                        <Bar dataKey="job_count" name="Jobs" fill="#0f766e" radius={[0, 8, 8, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full items-center justify-center rounded-[1.35rem] border border-dashed border-slate-200 bg-slate-50 text-sm font-semibold text-slate-500">
                      No work-center load data is available for this filter window.
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="overflow-hidden rounded-[1.85rem] border-slate-200 shadow-sm">
              <CardHeader className="pb-0">
                <CardTitle className="text-xl font-black text-slate-900">Recent job truth</CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="max-h-[360px] overflow-auto rounded-[1.2rem] border border-slate-200">
                  <table className="min-w-full text-sm">
                    <thead className="sticky top-0 bg-slate-50">
                      <tr>
                        {['job_number', 'process', 'work_center', 'status', 'produced_qty_kg', 'remaining_qty_kg', 'yield_pct'].map((column) => (
                          <th key={`production-${column}`} className="border-b border-slate-200 px-4 py-3 text-left text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">{toLabel(column)}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {productionBreakdowns.rows.slice(0, 18).map((row, index) => (
                        <tr key={`${row.job_number || index}`} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/80">
                          <td className="px-4 py-3 font-semibold text-slate-900">{String(row.job_number || '—')}</td>
                          <td className="px-4 py-3 text-slate-700">{String(row.process || '—')}</td>
                          <td className="px-4 py-3 text-slate-700">{String(row.work_center || '—')}</td>
                          <td className="px-4 py-3 text-slate-700">{String(row.status || row.job_state || '—')}</td>
                          <td className="px-4 py-3 text-slate-700">{formatMetricValue('kg', row.produced_qty_kg)}</td>
                          <td className="px-4 py-3 text-slate-700">{formatMetricValue('kg', row.remaining_qty_kg)}</td>
                          <td className="px-4 py-3 text-slate-700">{formatMetricValue('yield_pct', row.yield_pct)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </section>
        </>
      ) : isSalesTab ? (
        <>
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            {salesKpis.map((metric) => (
              <Card key={metric.label} className={cn("overflow-hidden border shadow-sm", metric.tone)}>
                <CardContent className="p-4">
                  <div className="text-[11px] font-black uppercase tracking-[0.18em]">{metric.label}</div>
                  <div className="mt-3 text-2xl font-black tracking-[-0.04em] text-slate-900">{metric.value}</div>
                  <div className="mt-2 text-xs font-semibold text-slate-500">{metric.hint}</div>
                </CardContent>
              </Card>
            ))}
          </section>

          <section className="grid gap-5 xl:grid-cols-[1.08fr_0.92fr] xl:items-start">
            <Card className="rounded-[1.85rem] border-slate-200 shadow-sm">
              <CardHeader className="pb-0">
                <CardTitle className="flex items-center gap-2 text-xl font-black text-slate-900">
                  <LineChartIcon className={cn("h-5 w-5 rounded-full p-1 text-white", accentStyle.badge)} />
                  Order creation versus closure
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="h-[340px] min-w-0">
                  {salesAnalytics.trend.length ? (
                    <ResponsiveContainer width="100%" height={340}>
                      <AreaChart data={salesAnalytics.trend.map((row, index) => ({ ...row, label: labelFromRow(row, index) }))}>
                        <defs>
                          <linearGradient id={`${tab}-sales-fill`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#2563eb" stopOpacity={0.24} />
                            <stop offset="95%" stopColor="#2563eb" stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                        <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" />
                        <Tooltip formatter={(value) => formatMetricValue('count', value)} />
                        <Legend />
                        <Area type="monotone" dataKey="created" name="Created" stroke="#2563eb" fill={`url(#${tab}-sales-fill)`} strokeWidth={2.4} />
                        <Line type="monotone" dataKey="completed" name="Completed" stroke="#0f766e" strokeWidth={2} dot={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full items-center justify-center rounded-[1.35rem] border border-dashed border-slate-200 bg-slate-50 text-sm font-semibold text-slate-500">
                      No sales creation trend is available for this filter window.
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-[1.85rem] border-slate-200 shadow-sm">
              <CardHeader className="pb-0">
                <CardTitle className="text-xl font-black text-slate-900">Pipeline posture</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 pt-4">
                {salesAnalytics.pipeline.map((row, index) => (
                  <div key={`${row.status || index}`} className="flex items-center justify-between rounded-[1.1rem] border border-slate-200 bg-slate-50 px-4 py-3">
                    <div>
                      <div className="text-sm font-black text-slate-900">{String(row.status || 'Unknown')}</div>
                      <div className="text-xs text-slate-500">Commercial queue status</div>
                    </div>
                    <Badge className="rounded-full border border-indigo-200 bg-indigo-50 text-indigo-700">{formatMetricValue('count', row.count)}</Badge>
                  </div>
                ))}
                <div className="grid gap-3 sm:grid-cols-2">
                  {Object.entries(salesAnalytics.repeatMix).map(([key, value]) => (
                    <div key={key} className="rounded-[1rem] border border-slate-200 bg-white px-4 py-3 shadow-sm">
                      <div className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">{toLabel(key)}</div>
                      <div className="mt-2 text-lg font-black text-slate-900">{formatMetricValue('count', value)}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </section>

          <section className="grid gap-5 xl:grid-cols-[0.96fr_1.04fr] xl:items-start">
            <Card className="rounded-[1.85rem] border-slate-200 shadow-sm">
              <CardHeader className="pb-0">
                <CardTitle className="text-xl font-black text-slate-900">Top customers by ordered weight</CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="h-[320px] min-w-0">
                  {salesAnalytics.topCustomers.length ? (
                    <ResponsiveContainer width="100%" height={320}>
                      <BarChart data={salesAnalytics.topCustomers.slice(0, 8)} layout="vertical" margin={{ top: 8, right: 8, left: 20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 11 }} stroke="#94a3b8" tickLine={false} axisLine={false} />
                        <YAxis type="category" dataKey="name" width={134} tick={{ fontSize: 11 }} stroke="#94a3b8" tickLine={false} axisLine={false} />
                        <Tooltip formatter={(value, name) => [String(name) === 'orders' ? formatMetricValue('count', value) : formatMetricValue('kg', value), toLabel(String(name || ''))]} />
                        <Legend />
                        <Bar dataKey="weight_kg" name="Weight kg" fill="#2563eb" radius={[0, 8, 8, 0]} />
                        <Bar dataKey="orders" name="Orders" fill="#0f766e" radius={[0, 8, 8, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full items-center justify-center rounded-[1.35rem] border border-dashed border-slate-200 bg-slate-50 text-sm font-semibold text-slate-500">
                      No customer concentration is available for this filter window.
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="overflow-hidden rounded-[1.85rem] border-slate-200 shadow-sm">
              <CardHeader className="pb-0">
                <CardTitle className="text-xl font-black text-slate-900">SKU pressure and overdue desk</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 pt-4">
                <div className="max-h-[260px] overflow-auto rounded-[1.2rem] border border-slate-200">
                  <table className="min-w-full text-sm">
                    <thead className="sticky top-0 bg-slate-50">
                      <tr>
                        {['sku', 'weight_kg', 'orders', 'repeat_orders', 'value'].map((column) => (
                          <th key={`sales-sku-${column}`} className="border-b border-slate-200 px-4 py-3 text-left text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">{toLabel(column)}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {salesAnalytics.skuBreakdown.slice(0, 10).map((row, index) => (
                        <tr key={`${row.sku || index}`} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/80">
                          <td className="px-4 py-3 font-semibold text-slate-900">{String(row.sku || '—')}</td>
                          <td className="px-4 py-3 text-slate-700">{formatMetricValue('kg', row.weight_kg)}</td>
                          <td className="px-4 py-3 text-slate-700">{formatMetricValue('count', row.orders)}</td>
                          <td className="px-4 py-3 text-slate-700">{formatMetricValue('count', row.repeat_orders)}</td>
                          <td className="px-4 py-3 text-slate-700">{formatMetricValue('value', row.value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="rounded-[1.2rem] border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-black text-slate-900">Overdue queue</div>
                  <div className="mt-3 space-y-2">
                    {salesAnalytics.overdue.length ? salesAnalytics.overdue.slice(0, 5).map((row, index) => (
                      <div key={`${row.order_number || index}`} className="flex items-center justify-between gap-3 rounded-[1rem] bg-white px-3 py-2 shadow-sm">
                        <div>
                          <div className="text-sm font-black text-slate-900">{String(row.order_number || 'Order')}</div>
                          <div className="text-xs text-slate-500">{String(row.customer_name || 'Customer')}</div>
                        </div>
                        <Badge className="rounded-full border border-rose-200 bg-rose-50 text-rose-700">{formatMetricValue('count', row.days_overdue)} d</Badge>
                      </div>
                    )) : <div className="text-sm font-semibold text-slate-500">No overdue orders in the selected window.</div>}
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>
        </>
      ) : isDispatchTab ? (
        <>
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            {dispatchKpis.map((metric) => (
              <Card key={metric.label} className={cn("overflow-hidden border shadow-sm", metric.tone)}>
                <CardContent className="p-4">
                  <div className="text-[11px] font-black uppercase tracking-[0.18em]">{metric.label}</div>
                  <div className="mt-3 text-2xl font-black tracking-[-0.04em] text-slate-900">{metric.value}</div>
                  <div className="mt-2 text-xs font-semibold text-slate-500">{metric.hint}</div>
                </CardContent>
              </Card>
            ))}
          </section>

          <section className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr] xl:items-start">
            <Card className="rounded-[1.85rem] border-slate-200 shadow-sm">
              <CardHeader className="pb-0">
                <CardTitle className="flex items-center gap-2 text-xl font-black text-slate-900">
                  <LineChartIcon className={cn("h-5 w-5 rounded-full p-1 text-white", accentStyle.badge)} />
                  Dispatch cadence
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="h-[340px] min-w-0">
                  {dispatchAnalytics.dailyTrend.length ? (
                    <ResponsiveContainer width="100%" height={340}>
                      <AreaChart data={dispatchAnalytics.dailyTrend.map((row, index) => ({ ...row, label: labelFromRow(row, index) }))}>
                        <defs>
                          <linearGradient id={`${tab}-dispatch-fill`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#2563eb" stopOpacity={0.24} />
                            <stop offset="95%" stopColor="#2563eb" stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                        <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" />
                        <Tooltip formatter={(value, name) => [String(name).includes('challan') ? formatMetricValue('count', value) : formatMetricValue('kg', value), toLabel(String(name || ''))]} />
                        <Legend />
                        <Area type="monotone" dataKey="weight_kg" name="Weight kg" stroke="#2563eb" fill={`url(#${tab}-dispatch-fill)`} strokeWidth={2.4} />
                        <Line type="monotone" dataKey="challans" name="Challans" stroke="#0f766e" strokeWidth={2} dot={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full items-center justify-center rounded-[1.35rem] border border-dashed border-slate-200 bg-slate-50 text-sm font-semibold text-slate-500">
                      No dispatch trend is available for this filter window.
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-[1.85rem] border-slate-200 shadow-sm">
              <CardHeader className="pb-0">
                <CardTitle className="text-xl font-black text-slate-900">Pipeline posture</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 pt-4">
                {dispatchAnalytics.pipeline.map((row, index) => (
                  <div key={`${row.status || index}`} className="flex items-center justify-between rounded-[1.1rem] border border-slate-200 bg-slate-50 px-4 py-3">
                    <div>
                      <div className="text-sm font-black text-slate-900">{String(row.status || 'Unknown')}</div>
                      <div className="text-xs text-slate-500">Dispatch document status</div>
                    </div>
                    <Badge className="rounded-full border border-indigo-200 bg-indigo-50 text-indigo-700">{formatMetricValue('count', row.count)}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          </section>

          <section className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr] xl:items-start">
            <Card className="rounded-[1.85rem] border-slate-200 shadow-sm">
              <CardHeader className="pb-0">
                <CardTitle className="text-xl font-black text-slate-900">Customer lift</CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="h-[320px] min-w-0">
                  {dispatchAnalytics.byCustomer.length ? (
                    <ResponsiveContainer width="100%" height={320}>
                      <BarChart data={dispatchAnalytics.byCustomer.slice(0, 8)} layout="vertical" margin={{ top: 8, right: 8, left: 20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 11 }} stroke="#94a3b8" tickLine={false} axisLine={false} />
                        <YAxis type="category" dataKey="customer" width={138} tick={{ fontSize: 11 }} stroke="#94a3b8" tickLine={false} axisLine={false} />
                        <Tooltip formatter={(value, name) => [String(name).includes('challan') ? formatMetricValue('count', value) : formatMetricValue('kg', value), toLabel(String(name || ''))]} />
                        <Legend />
                        <Bar dataKey="weight_kg" name="Weight kg" fill="#2563eb" radius={[0, 8, 8, 0]} />
                        <Bar dataKey="challans" name="Challans" fill="#0f766e" radius={[0, 8, 8, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full items-center justify-center rounded-[1.35rem] border border-dashed border-slate-200 bg-slate-50 text-sm font-semibold text-slate-500">
                      No customer dispatch split is available for this filter window.
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="overflow-hidden rounded-[1.85rem] border-slate-200 shadow-sm">
              <CardHeader className="pb-0">
                <CardTitle className="text-xl font-black text-slate-900">Challan history</CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="max-h-[360px] overflow-auto rounded-[1.2rem] border border-slate-200">
                  <table className="min-w-full text-sm">
                    <thead className="sticky top-0 bg-slate-50">
                      <tr>
                        {['dc_no', 'customer', 'status', 'date', 'vehicle'].map((column) => (
                          <th key={`dispatch-${column}`} className="border-b border-slate-200 px-4 py-3 text-left text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">{toLabel(column)}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {dispatchAnalytics.recent.slice(0, 18).map((row, index) => (
                        <tr key={`${row.dc_no || index}`} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/80">
                          <td className="px-4 py-3 font-semibold text-slate-900">{String(row.dc_no || '—')}</td>
                          <td className="px-4 py-3 text-slate-700">{String(row.customer || '—')}</td>
                          <td className="px-4 py-3 text-slate-700">{String(row.status || '—')}</td>
                          <td className="px-4 py-3 text-slate-700">{String(row.date || '—')}</td>
                          <td className="px-4 py-3 text-slate-700">{String(row.vehicle || '—')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </section>
        </>
      ) : isDowntimeTab ? (
        <>
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {downtimeKpis.map((metric) => (
              <Card key={metric.label} className={cn("overflow-hidden border shadow-sm", metric.tone)}>
                <CardContent className="p-4">
                  <div className="text-[11px] font-black uppercase tracking-[0.18em]">{metric.label}</div>
                  <div className="mt-3 text-2xl font-black tracking-[-0.04em] text-slate-900">{metric.value}</div>
                  <div className="mt-2 text-xs font-semibold text-slate-500">{metric.hint}</div>
                </CardContent>
              </Card>
            ))}
          </section>

          <section className="grid gap-5 xl:grid-cols-2 xl:items-start">
            <Card className="rounded-[1.85rem] border-slate-200 shadow-sm">
              <CardHeader className="pb-0">
                <CardTitle className="flex items-center gap-2 text-xl font-black text-slate-900">
                  <LineChartIcon className={cn("h-5 w-5 rounded-full p-1 text-white", accentStyle.badge)} />
                  Daily downtime pulse
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="h-[320px] min-w-0">
                  {downtimeAnalytics.dailyTrend.length ? (
                    <ResponsiveContainer width="100%" height={320}>
                      <AreaChart data={downtimeAnalytics.dailyTrend.map((row, index) => ({ ...row, label: labelFromRow(row, index) }))}>
                        <defs>
                          <linearGradient id={`${tab}-downtime-fill`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#e11d48" stopOpacity={0.24} />
                            <stop offset="95%" stopColor="#e11d48" stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                        <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" />
                        <Tooltip formatter={(value, name) => [String(name).includes('event') ? formatMetricValue('count', value) : `${formatMaybeNumber(value, 0)} min`, toLabel(String(name || ''))]} />
                        <Legend />
                        <Area type="monotone" dataKey="minutes" name="Minutes" stroke="#e11d48" fill={`url(#${tab}-downtime-fill)`} strokeWidth={2.4} />
                        <Line type="monotone" dataKey="events" name="Events" stroke="#f59e0b" strokeWidth={2} dot={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full items-center justify-center rounded-[1.35rem] border border-dashed border-slate-200 bg-slate-50 text-sm font-semibold text-slate-500">
                      No downtime trend is available for this filter window.
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-[1.85rem] border-slate-200 shadow-sm">
              <CardHeader className="pb-0">
                <CardTitle className="text-xl font-black text-slate-900">Pareto of stoppage reasons</CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="h-[320px] min-w-0">
                  {downtimeAnalytics.pareto.length ? (
                    <ResponsiveContainer width="100%" height={320}>
                      <BarChart data={downtimeAnalytics.pareto.slice(0, 8)} layout="vertical" margin={{ top: 8, right: 8, left: 12, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 11 }} stroke="#94a3b8" tickLine={false} axisLine={false} />
                        <YAxis type="category" dataKey="reason" width={148} tick={{ fontSize: 11 }} stroke="#94a3b8" tickLine={false} axisLine={false} />
                        <Tooltip formatter={(value, name) => [String(name).includes('pct') ? formatMetricValue('pct', value) : `${formatMaybeNumber(value, 0)} min`, toLabel(String(name || ''))]} />
                        <Legend />
                        <Bar dataKey="minutes" name="Minutes" fill="#e11d48" radius={[0, 8, 8, 0]} />
                        <Bar dataKey="count" name="Events" fill="#f59e0b" radius={[0, 8, 8, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full items-center justify-center rounded-[1.35rem] border border-dashed border-slate-200 bg-slate-50 text-sm font-semibold text-slate-500">
                      No downtime reasons were logged in this filter window.
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </section>

          <section className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr] xl:items-start">
            <Card className="rounded-[1.85rem] border-slate-200 shadow-sm">
              <CardHeader className="pb-0">
                <CardTitle className="text-xl font-black text-slate-900">Top offending machines</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 pt-4">
                {downtimeAnalytics.topMachines.length ? downtimeAnalytics.topMachines.slice(0, 8).map((row, index) => (
                  <div key={`${row.machine || index}`} className="flex items-center justify-between rounded-[1.1rem] border border-slate-200 bg-slate-50 px-4 py-3">
                    <div>
                      <div className="text-sm font-black text-slate-900">{String(row.machine || 'Unknown')}</div>
                      <div className="text-xs text-slate-500">{formatMetricValue('count', row.count)} stoppages</div>
                    </div>
                    <Badge className="rounded-full border border-rose-200 bg-rose-50 text-rose-700">{formatMaybeNumber(row.minutes, 0)} min</Badge>
                  </div>
                )) : <div className="text-sm font-semibold text-slate-500">No machine downtime rows are visible in this window.</div>}
              </CardContent>
            </Card>

            <Card className="overflow-hidden rounded-[1.85rem] border-slate-200 shadow-sm">
              <CardHeader className="pb-0">
                <CardTitle className="text-xl font-black text-slate-900">Reason detail</CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="max-h-[360px] overflow-auto rounded-[1.2rem] border border-slate-200">
                  <table className="min-w-full text-sm">
                    <thead className="sticky top-0 bg-slate-50">
                      <tr>
                        {['reason', 'minutes', 'count', 'pct', 'cumulative_pct'].map((column) => (
                          <th key={`downtime-${column}`} className="border-b border-slate-200 px-4 py-3 text-left text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">{toLabel(column)}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {downtimeAnalytics.pareto.slice(0, 12).map((row, index) => (
                        <tr key={`${row.reason || index}`} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/80">
                          <td className="px-4 py-3 font-semibold text-slate-900">{String(row.reason || 'Unknown')}</td>
                          <td className="px-4 py-3 text-slate-700">{formatMaybeNumber(row.minutes, 0)} min</td>
                          <td className="px-4 py-3 text-slate-700">{formatMetricValue('count', row.count)}</td>
                          <td className="px-4 py-3 text-slate-700">{formatMetricValue('pct', row.pct)}</td>
                          <td className="px-4 py-3 text-slate-700">{formatMetricValue('pct', row.cumulative_pct)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </section>
        </>
      ) : isOperatorTab ? (
        <>
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            {operatorKpis.map((metric) => (
              <Card key={metric.label} className={cn("overflow-hidden border shadow-sm", metric.tone)}>
                <CardContent className="p-4">
                  <div className="text-[11px] font-black uppercase tracking-[0.18em]">{metric.label}</div>
                  <div className="mt-3 text-2xl font-black tracking-[-0.04em] text-slate-900">{metric.value}</div>
                  <div className="mt-2 text-xs font-semibold text-slate-500">{metric.hint}</div>
                </CardContent>
              </Card>
            ))}
          </section>

          <section className="grid gap-5 xl:grid-cols-[1fr_0.9fr] xl:items-start">
            <Card className="rounded-[1.85rem] border-slate-200 shadow-sm">
              <CardHeader className="pb-0">
                <CardTitle className="text-xl font-black text-slate-900">Operator leaderboard</CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="h-[340px] min-w-0">
                  {operatorAnalytics.leaderboard.length ? (
                    <ResponsiveContainer width="100%" height={340}>
                      <BarChart data={operatorAnalytics.leaderboard.slice(0, 8)} layout="vertical" margin={{ top: 8, right: 8, left: 18, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 11 }} stroke="#94a3b8" tickLine={false} axisLine={false} />
                        <YAxis type="category" dataKey="full_name" width={148} tick={{ fontSize: 11 }} stroke="#94a3b8" tickLine={false} axisLine={false} />
                        <Tooltip formatter={(value, name) => [String(name).includes('rate') || String(name).includes('achievement') || String(name).includes('efficiency') ? formatMetricValue('pct', value) : formatMetricValue('kg', value), toLabel(String(name || ''))]} />
                        <Legend />
                        <Bar dataKey="produced_kg" name="Output kg" fill="#2563eb" radius={[0, 8, 8, 0]} />
                        <Bar dataKey="efficiency" name="Efficiency %" fill="#0f766e" radius={[0, 8, 8, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full items-center justify-center rounded-[1.35rem] border border-dashed border-slate-200 bg-slate-50 text-sm font-semibold text-slate-500">
                      No operator leaderboard is available for this filter window.
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-5">
              {[operatorAnalytics.best, operatorAnalytics.worst].map((row, index) => (
                <Card key={index} className="rounded-[1.85rem] border-slate-200 shadow-sm">
                  <CardHeader className="pb-0">
                    <CardTitle className="text-xl font-black text-slate-900">{index === 0 ? 'Best spotlight' : 'Watchpoint'}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 pt-4">
                    <div className="rounded-[1.1rem] border border-slate-200 bg-slate-50 px-4 py-3">
                      <div className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">Operator</div>
                      <div className="mt-2 text-lg font-black text-slate-900">{String(row?.full_name || row?.name || '—')}</div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <StatInset icon={Activity} label="Efficiency" value={formatMetricValue('efficiency', row?.efficiency)} />
                      <StatInset icon={Package} label="Output" value={formatMetricValue('kg', row?.produced_kg)} />
                      <StatInset icon={Gauge} label="Completion" value={formatMetricValue('completion_rate', row?.completion_rate)} />
                      <StatInset icon={Factory} label="Target" value={formatMetricValue('target_achievement', row?.target_achievement)} />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>

          <Card className="overflow-hidden rounded-[1.85rem] border-slate-200 shadow-sm">
            <CardHeader className="pb-0">
              <CardTitle className="text-xl font-black text-slate-900">Operator detail</CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="max-h-[420px] overflow-auto rounded-[1.2rem] border border-slate-200">
                <table className="min-w-full text-sm">
                  <thead className="sticky top-0 bg-slate-50">
                    <tr>
                      {['full_name', 'jobs', 'completed', 'produced_kg', 'scrap_kg', 'efficiency', 'completion_rate', 'target_achievement'].map((column) => (
                        <th key={`operator-${column}`} className="border-b border-slate-200 px-4 py-3 text-left text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">{toLabel(column)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {operatorAnalytics.leaderboard.slice(0, 20).map((row, index) => (
                      <tr key={`${row.name || index}`} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/80">
                        <td className="px-4 py-3 font-semibold text-slate-900">{String(row.full_name || row.name || '—')}</td>
                        <td className="px-4 py-3 text-slate-700">{formatMetricValue('count', row.jobs)}</td>
                        <td className="px-4 py-3 text-slate-700">{formatMetricValue('count', row.completed)}</td>
                        <td className="px-4 py-3 text-slate-700">{formatMetricValue('kg', row.produced_kg)}</td>
                        <td className="px-4 py-3 text-slate-700">{formatMetricValue('kg', row.scrap_kg)}</td>
                        <td className="px-4 py-3 text-slate-700">{formatMetricValue('efficiency', row.efficiency)}</td>
                        <td className="px-4 py-3 text-slate-700">{formatMetricValue('completion_rate', row.completion_rate)}</td>
                        <td className="px-4 py-3 text-slate-700">{formatMetricValue('target_achievement', row.target_achievement)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      ) : isCostingTab ? (
        <>
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
            {costingKpis.map((metric) => (
              <Card key={metric.label} className={cn("overflow-hidden border shadow-sm", metric.tone)}>
                <CardContent className="p-4">
                  <div className="text-[11px] font-black uppercase tracking-[0.18em]">{metric.label}</div>
                  <div className="mt-3 text-2xl font-black tracking-[-0.04em] text-slate-900">{metric.value}</div>
                  <div className="mt-2 text-xs font-semibold text-slate-500">{metric.hint}</div>
                </CardContent>
              </Card>
            ))}
          </section>

          <section className="grid gap-5 xl:grid-cols-[1.08fr_0.92fr] xl:items-start">
            <Card className="rounded-[1.85rem] border-slate-200 shadow-sm">
              <CardHeader className="pb-0">
                <CardTitle className="flex items-center gap-2 text-xl font-black text-slate-900">
                  <LineChartIcon className={cn("h-5 w-5 rounded-full p-1 text-white", accentStyle.badge)} />
                  Revenue, cost, and margin trend
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="h-[340px] min-w-0">
                  {costingAnalytics.monthlyTrend.length ? (
                    <ResponsiveContainer width="100%" height={340}>
                      <AreaChart data={costingAnalytics.monthlyTrend.map((row, index) => ({ ...row, label: labelFromRow(row, index) }))}>
                        <defs>
                          <linearGradient id={`${tab}-costing-fill`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.24} />
                            <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                        <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" />
                        <Tooltip formatter={(value) => formatMetricValue('value', value)} />
                        <Legend />
                        <Area type="monotone" dataKey="revenue" name="Revenue" stroke="#10b981" fill={`url(#${tab}-costing-fill)`} strokeWidth={2.4} />
                        <Line type="monotone" dataKey="cost" name="Cost" stroke="#e11d48" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="margin" name="Margin" stroke="#2563eb" strokeWidth={2} dot={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full items-center justify-center rounded-[1.35rem] border border-dashed border-slate-200 bg-slate-50 text-sm font-semibold text-slate-500">
                      No costing trend is available for this filter window.
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-[1.85rem] border-slate-200 shadow-sm">
              <CardHeader className="pb-0">
                <CardTitle className="text-xl font-black text-slate-900">Cost split</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 pt-4 md:grid-cols-[0.92fr_1.08fr] xl:grid-cols-1">
                <div className="h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={costingAnalytics.costSplit} dataKey="value" nameKey="name" innerRadius={56} outerRadius={84} stroke="none" paddingAngle={4}>
                        {costingAnalytics.costSplit.map((row, index) => (
                          <Cell key={`${row.name || index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value) => formatMetricValue('value', value)} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-3">
                  {costingAnalytics.costSplit.map((row, index) => (
                    <div key={`${row.name || index}`} className="flex items-center justify-between rounded-[1.1rem] border border-slate-200 bg-slate-50 px-4 py-3">
                      <div>
                        <div className="text-sm font-black text-slate-900">{String(row.name || 'Cost')}</div>
                        <div className="text-xs text-slate-500">Share of live costing stack</div>
                      </div>
                      <Badge className="rounded-full border border-indigo-200 bg-indigo-50 text-indigo-700">{formatMetricValue('value', row.value)}</Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </section>

          <section className="grid gap-5 xl:grid-cols-[1fr_1fr] xl:items-start">
            <Card className="overflow-hidden rounded-[1.85rem] border-slate-200 shadow-sm">
              <CardHeader className="pb-0">
                <CardTitle className="text-xl font-black text-slate-900">Customer margin desk</CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="max-h-[360px] overflow-auto rounded-[1.2rem] border border-slate-200">
                  <table className="min-w-full text-sm">
                    <thead className="sticky top-0 bg-slate-50">
                      <tr>
                        {['customer', 'revenue', 'cost', 'margin', 'margin_pct', 'coverage_pct', 'orders'].map((column) => (
                          <th key={`costing-${column}`} className="border-b border-slate-200 px-4 py-3 text-left text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">{toLabel(column)}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {costingAnalytics.customerMargin.slice(0, 12).map((row, index) => (
                        <tr key={`${row.customer || index}`} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/80">
                          <td className="px-4 py-3 font-semibold text-slate-900">{String(row.customer || 'Unknown')}</td>
                          <td className="px-4 py-3 text-slate-700">{formatMetricValue('value', row.revenue)}</td>
                          <td className="px-4 py-3 text-slate-700">{formatMetricValue('value', row.cost)}</td>
                          <td className="px-4 py-3 text-slate-700">{formatMetricValue('value', row.margin)}</td>
                          <td className="px-4 py-3 text-slate-700">{formatMetricValue('pct', row.margin_pct)}</td>
                          <td className="px-4 py-3 text-slate-700">{formatMetricValue('pct', row.coverage_pct)}</td>
                          <td className="px-4 py-3 text-slate-700">{formatMetricValue('count', row.orders)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-[1.85rem] border-slate-200 shadow-sm">
              <CardHeader className="pb-0">
                <CardTitle className="text-xl font-black text-slate-900">Overhead and cost per kg</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5 pt-4">
                <div className="h-[180px] min-w-0">
                  {costingAnalytics.overheadTrend.length ? (
                    <ResponsiveContainer width="100%" height={180}>
                      <BarChart data={costingAnalytics.overheadTrend.slice().reverse()}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                        <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                        <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" />
                        <Tooltip formatter={(value) => formatMetricValue('value', value)} />
                        <Legend />
                        <Bar dataKey="electricity" stackId="cost" fill="#f59e0b" radius={[6, 6, 0, 0]} />
                        <Bar dataKey="labor" stackId="cost" fill="#2563eb" radius={[6, 6, 0, 0]} />
                        <Bar dataKey="other" stackId="cost" fill="#0f766e" radius={[6, 6, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : <div className="flex h-full items-center justify-center rounded-[1.2rem] border border-dashed border-slate-200 bg-slate-50 text-sm font-semibold text-slate-500">No overhead months are visible in this filter window.</div>}
                </div>
                <div className="h-[180px] min-w-0">
                  {costingAnalytics.costPerKgTrend.length ? (
                    <ResponsiveContainer width="100%" height={180}>
                      <LineChart data={costingAnalytics.costPerKgTrend.map((row, index) => ({ ...row, label: labelFromRow(row, index) }))}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                        <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" />
                        <Tooltip formatter={(value) => formatMetricValue('value', value)} />
                        <Line type="monotone" dataKey="cost_per_kg" stroke="#7c3aed" strokeWidth={2.2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : <div className="flex h-full items-center justify-center rounded-[1.2rem] border border-dashed border-slate-200 bg-slate-50 text-sm font-semibold text-slate-500">No cost-per-kg series is visible in this filter window.</div>}
                </div>
              </CardContent>
            </Card>
          </section>
        </>
      ) : isShiftTab ? (
        <>
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {shiftKpis.map((metric) => (
              <Card key={metric.label} className={cn("overflow-hidden border shadow-sm", metric.tone)}>
                <CardContent className="p-4">
                  <div className="text-[11px] font-black uppercase tracking-[0.18em]">{metric.label}</div>
                  <div className="mt-3 text-2xl font-black tracking-[-0.04em] text-slate-900">{metric.value}</div>
                  <div className="mt-2 text-xs font-semibold text-slate-500">{metric.hint}</div>
                </CardContent>
              </Card>
            ))}
          </section>

          <section className="grid gap-5 xl:grid-cols-[1fr_1fr] xl:items-start">
            <Card className="rounded-[1.85rem] border-slate-200 shadow-sm">
              <CardHeader className="pb-0">
                <CardTitle className="text-xl font-black text-slate-900">Shift output rhythm</CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="h-[320px] min-w-0">
                  {shiftAnalytics.series.length ? (
                    <ResponsiveContainer width="100%" height={320}>
                      <LineChart data={shiftAnalytics.series.map((row, index) => ({ ...row, label: labelFromRow(row, index) }))}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                        <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" />
                        <Tooltip formatter={(value) => formatMetricValue('kg', value)} />
                        <Legend />
                        <Line type="monotone" dataKey="value" name="Output kg" stroke="#2563eb" strokeWidth={2.2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : <div className="flex h-full items-center justify-center rounded-[1.35rem] border border-dashed border-slate-200 bg-slate-50 text-sm font-semibold text-slate-500">No shift rhythm is available for this filter window.</div>}
                </div>
              </CardContent>
            </Card>

            <Card className="overflow-hidden rounded-[1.85rem] border-slate-200 shadow-sm">
              <CardHeader className="pb-0">
                <CardTitle className="text-xl font-black text-slate-900">Shift performance board</CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="max-h-[320px] overflow-auto rounded-[1.2rem] border border-slate-200">
                  <table className="min-w-full text-sm">
                    <thead className="sticky top-0 bg-slate-50">
                      <tr>
                        {['shift_code', 'output_kg', 'scrap_kg', 'yield_pct', 'downtime_minutes', 'events'].map((column) => (
                          <th key={`shift-${column}`} className="border-b border-slate-200 px-4 py-3 text-left text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">{toLabel(column)}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {shiftAnalytics.rows.slice(0, 12).map((row, index) => (
                        <tr key={`${row.shift_code || index}`} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/80">
                          <td className="px-4 py-3 font-semibold text-slate-900">{String(row.shift_code || 'UNASSIGNED')}</td>
                          <td className="px-4 py-3 text-slate-700">{formatMetricValue('kg', row.output_kg)}</td>
                          <td className="px-4 py-3 text-slate-700">{formatMetricValue('kg', row.scrap_kg)}</td>
                          <td className="px-4 py-3 text-slate-700">{formatMetricValue('yield_pct', row.yield_pct)}</td>
                          <td className="px-4 py-3 text-slate-700">{formatMaybeNumber(row.downtime_minutes, 0)} min</td>
                          <td className="px-4 py-3 text-slate-700">{formatMetricValue('count', row.events)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </section>
        </>
      ) : isInkTab ? (
        <>
          <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {inkKpis.map((metric) => (
              <Card key={metric.label} className={cn("overflow-hidden border shadow-sm", metric.tone)}>
                <CardContent className="p-4">
                  <div className="text-[11px] font-black uppercase tracking-[0.18em]">{metric.label}</div>
                  <div className="mt-3 text-2xl font-black tracking-[-0.04em] text-slate-900">{metric.value}</div>
                  <div className="mt-2 text-xs font-semibold text-slate-500">{metric.hint}</div>
                </CardContent>
              </Card>
            ))}
          </section>

          <section className="grid gap-5 xl:grid-cols-[1.02fr_0.98fr] xl:items-start">
            <Card className="rounded-[1.85rem] border-slate-200 shadow-sm">
              <CardHeader className="pb-0">
                <CardTitle className="flex items-center gap-2 text-xl font-black text-slate-900">
                  <LineChartIcon className={cn("h-5 w-5 rounded-full p-1 text-white", accentStyle.badge)} />
                  Ink issue / return / consume stack
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="h-[320px] min-w-0">
                  {inkAnalytics.flow.some((row) => row.value > 0) ? (
                    <ResponsiveContainer width="100%" height={320}>
                      <BarChart data={inkAnalytics.flow} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="#94a3b8" tickLine={false} axisLine={false} />
                        <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" tickLine={false} axisLine={false} />
                        <Tooltip formatter={(value) => formatMetricValue('kg', value)} />
                        <Bar dataKey="value" fill="#7c3aed" radius={[10, 10, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full items-center justify-center rounded-[1.35rem] border border-dashed border-slate-200 bg-slate-50 text-sm font-semibold text-slate-500">
                      No ink movement is visible for this filter window.
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-[1.85rem] border-slate-200 shadow-sm">
              <CardHeader className="pb-0">
                <CardTitle className="text-xl font-black text-slate-900">Color-family variance watch</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 pt-4">
                {inkAnalytics.topVariance.length ? inkAnalytics.topVariance.slice(0, 6).map((row, index) => (
                  <div key={`${row.color_family || index}`} className="rounded-[1.1rem] border border-slate-200 bg-slate-50 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-black text-slate-900">{String(row.color_family || 'Custom')}</div>
                        <div className="text-xs text-slate-500">{formatMetricValue('count', row.job_count)} jobs · {formatMetricValue('kg', row.actual_consumed_qty)} consumed</div>
                      </div>
                      <Badge className="rounded-full border border-rose-200 bg-rose-50 text-rose-700">{formatMetricValue('kg', row.variance_qty)}</Badge>
                    </div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-3">
                      <StatInset icon={Package} label="Theoretical" value={formatMetricValue('kg', row.theoretical_qty)} />
                      <StatInset icon={Factory} label="Issued" value={formatMetricValue('kg', row.actual_issued_qty)} />
                      <StatInset icon={ArrowRightLeft} label="Returned" value={formatMetricValue('kg', row.actual_returned_qty)} />
                    </div>
                  </div>
                )) : <div className="text-sm font-semibold text-slate-500">No color-family variance rows are visible in this window.</div>}
              </CardContent>
            </Card>
          </section>

          <Card className="overflow-hidden rounded-[1.85rem] border-slate-200 shadow-sm">
            <CardHeader className="pb-0">
              <CardTitle className="text-xl font-black text-slate-900">Ink intelligence ledger</CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <div className="max-h-[360px] overflow-auto rounded-[1.2rem] border border-slate-200">
                <table className="min-w-full text-sm">
                  <thead className="sticky top-0 bg-slate-50">
                    <tr>
                      {['color_family', 'theoretical_qty', 'planned_issue_qty', 'actual_issued_qty', 'actual_returned_qty', 'actual_consumed_qty', 'variance_qty', 'job_count'].map((column) => (
                        <th key={`ink-${column}`} className="border-b border-slate-200 px-4 py-3 text-left text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">{toLabel(column)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {inkAnalytics.topVariance.slice(0, 12).map((row, index) => (
                      <tr key={`${row.color_family || index}`} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/80">
                        <td className="px-4 py-3 font-semibold text-slate-900">{String(row.color_family || 'Custom')}</td>
                        <td className="px-4 py-3 text-slate-700">{formatMetricValue('kg', row.theoretical_qty)}</td>
                        <td className="px-4 py-3 text-slate-700">{formatMetricValue('kg', row.planned_issue_qty)}</td>
                        <td className="px-4 py-3 text-slate-700">{formatMetricValue('kg', row.actual_issued_qty)}</td>
                        <td className="px-4 py-3 text-slate-700">{formatMetricValue('kg', row.actual_returned_qty)}</td>
                        <td className="px-4 py-3 text-slate-700">{formatMetricValue('kg', row.actual_consumed_qty)}</td>
                        <td className="px-4 py-3 text-slate-700">{formatMetricValue('kg', row.variance_qty)}</td>
                        <td className="px-4 py-3 text-slate-700">{formatMetricValue('count', row.job_count)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      ) : (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {visibleSummaryEntries.map(([key, value]) => (
            <Card key={key} className={cn("overflow-hidden border shadow-sm", metricTone(key))}>
              <CardContent className="p-4">
                <div className="text-[11px] font-black uppercase tracking-[0.18em]">{toLabel(key)}</div>
                <div className="mt-3 text-2xl font-black tracking-[-0.04em] text-slate-900">{formatMetricValue(key, value)}</div>
              </CardContent>
            </Card>
          ))}
        </section>
      )}

      {isScrapTab ? (
        <section className="grid gap-5 xl:grid-cols-3 xl:items-start">
          {scrapKgBoards.map((group) => (
            <Card key={group.key} className="rounded-[1.75rem] border-slate-200 shadow-sm">
              <CardHeader className="pb-0">
                <CardTitle className="text-lg font-black text-slate-900">{group.title}</CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="h-[240px] min-w-0">
                  {group.rows.length ? (
                    <ResponsiveContainer width="100%" height={240}>
                      <BarChart data={group.rows.slice(0, 6)} layout="vertical" margin={{ left: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                        <XAxis type="number" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                        <YAxis type="category" dataKey={group.labelKey} width={108} tick={{ fontSize: 11 }} stroke="#94a3b8" />
                        <Tooltip />
                        <Bar dataKey="scrap_kg" radius={[0, 8, 8, 0]} fill="#e11d48" />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="flex h-full items-center justify-center rounded-[1.2rem] border border-dashed border-slate-200 bg-slate-50 text-sm font-semibold text-slate-500">
                      No kg split returned for this filter window.
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </section>
      ) : null}

      {!suppressGenericSharedShell ? (
      <section className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr] xl:items-start">
        <Card className="rounded-[1.75rem] border-slate-200 shadow-sm">
          <CardHeader className="pb-0">
            <CardTitle className="flex items-center gap-2 text-xl font-black text-slate-900">
              <LineChartIcon className={cn("h-5 w-5 text-white rounded-full p-1", accentStyle.badge)} />
              Trendboard
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="h-[360px] min-w-0">
              {chartSeries.rows.length && chartSeries.primaryKey ? (
                <ResponsiveContainer width="100%" height={360}>
                  <AreaChart data={chartSeries.rows}>
                    <defs>
                      <linearGradient id={`${tab}-fill`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#2563eb" stopOpacity={0.28} />
                        <stop offset="95%" stopColor="#2563eb" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                    <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" />
                    <Tooltip />
                    <Area type="monotone" dataKey={chartSeries.primaryKey} stroke="#2563eb" fill={`url(#${tab}-fill)`} strokeWidth={2.5} />
                    {chartSeries.secondaryKey ? <Line type="monotone" dataKey={chartSeries.secondaryKey} stroke="#0f766e" strokeWidth={2} dot={false} /> : null}
                    <Legend />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center rounded-[1.35rem] border border-dashed border-slate-200 bg-slate-50 text-sm font-semibold text-slate-500">
                  No trend series available for this filter window.
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-[1.75rem] border-slate-200 shadow-sm">
          <CardHeader className="pb-0">
            <CardTitle className="flex items-center gap-2 text-xl font-black text-slate-900">
              <BarChart3 className={cn("h-5 w-5 text-white rounded-full p-1", accentStyle.badge)} />
              Breakdown Snapshot
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="h-[360px] min-w-0">
              {firstBreakdown?.rows?.length ? (
                <ResponsiveContainer width="100%" height={360}>
                  <PieChart>
                    <Pie
                      data={normalizeChartRows(firstBreakdown.rows).rows.slice(0, 8)}
                      dataKey={normalizeChartRows(firstBreakdown.rows).primaryKey || "value"}
                      nameKey="label"
                      innerRadius={72}
                      outerRadius={118}
                      paddingAngle={2}
                    >
                      {normalizeChartRows(firstBreakdown.rows).rows.slice(0, 8).map((_, index) => (
                        <Cell key={`${firstBreakdown.key}-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center rounded-[1.35rem] border border-dashed border-slate-200 bg-slate-50 text-sm font-semibold text-slate-500">
                  No categorical split available yet.
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </section>
      ) : null}

      {!suppressGenericSharedShell ? (
      <section className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr] xl:items-start">
        <Card className="rounded-[1.75rem] border-slate-200 shadow-sm">
          <CardHeader className="pb-0">
            <CardTitle className="flex items-center gap-2 text-xl font-black text-slate-900">
              <Gauge className={cn("h-5 w-5 text-white rounded-full p-1", accentStyle.badge)} />
              Operational Narrative
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-4">
            <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50 p-4">
              <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Primary driver</div>
              <div className="mt-2 text-lg font-black text-slate-900">
                {isOeeTab
                  ? "Machine OEE spread"
                  : firstBreakdown?.title || (chartSeries.primaryKey ? toLabel(chartSeries.primaryKey) : "No dominant signal")}
              </div>
              <div className="mt-2 text-sm text-slate-600">
                {isOeeTab && breakdownGroups.find((group) => group.key === "by_machine")?.rows?.length
                  ? `${String(normalizedSummary.top_machine || "Top machine")} is leading the visible machine field while ${String(normalizedSummary.lowest_machine || "the lowest machine")} is the current floor.`
                  : firstBreakdown?.rows?.length
                  ? `${labelFromRow(firstBreakdown.rows[0], 0)} is the highest visible contributor in the active filter lens.`
                  : "Change the date range or plant filter to surface the main contributor."}
              </div>
            </div>
            <div className="rounded-[1.25rem] border border-slate-200 bg-slate-50 p-4">
              <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Secondary watchpoint</div>
              <div className="mt-2 text-lg font-black text-slate-900">{isOeeTab ? "Loss pressure" : secondBreakdown?.title || "Coverage health"}</div>
              <div className="mt-2 text-sm text-slate-600">
                {isOeeTab
                  ? `${formatMetricValue("scrap_kg", normalizedSummary.scrap_kg)} scrap against ${formatMetricValue("output_kg", normalizedSummary.output_kg)} output in the current filter window.`
                  : secondBreakdown?.rows?.length
                  ? `${secondBreakdown.rows.length} visible records support the secondary split.`
                  : `Execution ${formatMaybeNumber(payload.coverage?.execution_log_coverage, 0)}% · Material ${formatMaybeNumber(payload.coverage?.material_actual_coverage, 0)}% · Shift ${formatMaybeNumber(payload.coverage?.shift_coverage, 0)}%`}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <StatInset icon={Factory} label="Visible rows" value={String(tableRows.length)} />
              <StatInset icon={Package} label="Breakdown groups" value={String(breakdownGroups.length)} />
              <StatInset icon={Activity} label="Trend points" value={String(chartSeries.rows.length)} />
              <StatInset icon={AlertTriangle} label="Warnings" value={String(payload.warnings?.length || 0)} />
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-[1.75rem] border-slate-200 shadow-sm">
          <CardHeader className="pb-0">
            <CardTitle className="flex items-center gap-2 text-xl font-black text-slate-900">
              <Rows3 className={cn("h-5 w-5 text-white rounded-full p-1", accentStyle.badge)} />
              Breakdown Board
            </CardTitle>
          </CardHeader>
          <CardContent className="max-h-[620px] space-y-4 overflow-y-auto pr-2 pt-4">
            {visibleBreakdowns.map((group) => {
              const normalized = normalizeChartRows(group.rows)
              return (
                <div key={group.key} className="rounded-[1.25rem] border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-black text-slate-900">{group.title}</div>
                      <div className="text-xs text-slate-500">{group.rows.length} record(s)</div>
                    </div>
                    <Badge className={cn("rounded-full border", accentStyle.chip)}>{normalized.primaryKey ? toLabel(normalized.primaryKey) : "detail"}</Badge>
                  </div>
                  <div className="mt-4 h-[180px] min-w-0">
                    {normalized.rows.length && normalized.primaryKey ? (
                      <ResponsiveContainer width="100%" height={180}>
                        <BarChart data={normalized.rows.slice(0, 8)} layout="vertical" margin={{ left: 20 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                          <XAxis type="number" tick={{ fontSize: 11 }} stroke="#94a3b8" />
                          <YAxis type="category" dataKey="label" width={110} tick={{ fontSize: 11 }} stroke="#94a3b8" />
                          <Tooltip />
                          <Bar dataKey={normalized.primaryKey} radius={[0, 8, 8, 0]} fill="#2563eb" />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>
      </section>
      ) : null}

      {visibleBreakdowns.length && !suppressGenericSharedShell ? (
        <section className="grid gap-5 xl:grid-cols-2 xl:items-start">
          {visibleBreakdowns.map((group) => {
            const columns = inferTableColumns(group.rows)
            return (
              <Card key={`table-${group.key}`} className="overflow-hidden rounded-[1.85rem] border-slate-200 shadow-sm">
                <CardHeader className="pb-0">
                  <CardTitle className="text-lg font-black text-slate-900">{group.title}</CardTitle>
                </CardHeader>
                <CardContent className="pt-4">
                  <div className="max-h-[320px] overflow-auto rounded-[1.15rem] border border-slate-200">
                    <table className="min-w-full text-sm">
                      <thead className="sticky top-0 bg-slate-50">
                        <tr>
                          {columns.map((column) => (
                            <th key={`${group.key}-${column}`} className="border-b border-slate-200 px-3 py-2 text-left text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">
                              {toLabel(column)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {group.rows.slice(0, 18).map((row, index) => (
                          <tr key={`${group.key}-${index}`} className="border-b border-slate-100 last:border-b-0">
                            {columns.map((column) => (
                              <td key={`${group.key}-${index}-${column}`} className="px-3 py-2 text-slate-700">
                                {formatTableValue(column, row[column])}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </section>
      ) : null}

      {!suppressGenericSharedShell ? (
      <Card className="overflow-hidden rounded-[1.85rem] border-slate-200 shadow-sm">
        <CardHeader className="pb-0">
          <CardTitle className="text-xl font-black text-slate-900">Detailed Rows</CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {tableRows.length ? (
            <div className="max-h-[680px] overflow-auto rounded-[1.2rem] border border-slate-200">
              <table className="min-w-full text-sm">
                <thead className="sticky top-0 bg-slate-50">
                  <tr>
                    {tableColumns.map((column) => (
                      <th key={column} className="border-b border-slate-200 px-4 py-3 text-left text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">
                        {toLabel(column)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tableRows.slice(0, 60).map((row, index) => (
                    <tr key={`${labelFromRow(row, index)}-${index}`} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/80">
                      {tableColumns.map((column) => (
                        <td key={column} className="px-4 py-3 text-slate-700">
                          {formatTableValue(column, row[column])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-[1.35rem] border border-dashed border-slate-200 bg-slate-50 px-4 py-10 text-center text-sm font-semibold text-slate-500">
              No detailed rows are available for the current filter window.
            </div>
          )}
        </CardContent>
      </Card>
      ) : null}
    </div>
  )
}

function StatInset({ icon: Icon, label, value }: { icon: ElementType; label: string; value: string }) {
  return (
    <div className="rounded-[1rem] border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">
        <Icon className="h-3.5 w-3.5 text-slate-400" />
        {label}
      </div>
      <div className="mt-2 text-lg font-black text-slate-900">{value}</div>
    </div>
  )
}

function InsightListCard({
  title,
  rows,
  labelKey,
}: {
  title: string
  rows: Array<Record<string, any>>
  labelKey: string
}) {
  return (
    <div className="rounded-[1.2rem] border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-black text-slate-900">{title}</div>
        <Badge className="rounded-full border border-slate-200 bg-white text-slate-600">{rows.length} rows</Badge>
      </div>
      <div className="mt-4 space-y-2">
        {rows.length ? (
          rows.slice(0, 6).map((row, index) => (
            <div key={`${title}-${row[labelKey] || index}`} className="flex items-center justify-between gap-3 rounded-xl bg-white px-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-900">{String(row[labelKey] || `Row ${index + 1}`)}</div>
                <div className="text-xs text-slate-500">{formatMetricValue("events", row.events)} event(s)</div>
              </div>
              <Badge className="shrink-0 rounded-full border border-rose-200 bg-rose-50 text-rose-700">
                {formatMetricValue("scrap_kg", row.scrap_kg)}
              </Badge>
            </div>
          ))
        ) : (
          <div className="rounded-xl border border-dashed border-slate-200 bg-white px-3 py-6 text-center text-sm font-semibold text-slate-500">
            No rows in this split.
          </div>
        )}
      </div>
    </div>
  )
}

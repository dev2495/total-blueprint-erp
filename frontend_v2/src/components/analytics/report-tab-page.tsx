"use client"

import { type ElementType, useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  Activity,
  AlertTriangle,
  BarChart3,
  CalendarDays,
  Download,
  DollarSign,
  Factory,
  Gauge,
  LineChart as LineChartIcon,
  Package,
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
  const prefersWideDefaultWindow = tab === "scrap"
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
  const degraded = !hasMeaningfulData([normalizedSummary, seriesSource, payload.rows, payload.breakdowns, payload.charts]) || Boolean((payload as any)?.degraded)
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
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">Coverage</div>
                <div className="text-sm font-semibold text-slate-900">
                  Exec {formatMaybeNumber(payload.coverage?.execution_log_coverage, 0)}% · Material {formatMaybeNumber(payload.coverage?.material_actual_coverage, 0)}%
                </div>
                <div className="text-xs text-slate-500">Shift {formatMaybeNumber(payload.coverage?.shift_coverage, 0)}%</div>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {payload.warnings?.length ? (
        <ReportStateBanner
          title="Report needs attention"
          message={payload.warnings.join(" ")}
          tone="degraded"
          actionLabel="Refresh"
          onAction={() => reportQuery.refetch()}
        />
      ) : null}

      {degraded ? (
        <ReportStateBanner
          title="Report is live but thin"
          message="The current filter window returned limited telemetry. Change the date lens or process filters to widen the view."
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

      {visibleBreakdowns.length ? (
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

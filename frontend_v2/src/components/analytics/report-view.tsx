"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ArrowUpDown,
  BarChart3,
  Download,
  FileSpreadsheet,
  Lightbulb,
  RefreshCw,
  Search,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { analyticsApi, type ReportTabResponse } from "@/services/analytics";
import { factoryService } from "@/services/factory";
import {
  CompositionBar,
  HeroChip,
  PageHero,
  Panel,
  PanelEmpty,
  RankedBars,
  Segmented,
  StatCard,
  heroButtonClass,
  vizColor,
} from "@/components/premium";
import { Bars, Donut, TrendArea } from "@/components/premium/charts";
import { Pager } from "@/components/logistics/yard-ui";
import {
  DEFAULT_CONFIG,
  REPORT_CONFIG,
  type KpiDef,
  type MetricFormat,
  type SectionDef,
} from "./report-config";

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

const ACRONYMS: Record<string, string> = {
  oee: "OEE",
  mttr: "MTTR",
  otif: "OTIF",
  kg: "kg",
  pct: "%",
  inr: "₹",
  so: "SO",
  dc: "DC",
  id: "ID",
  sku: "SKU",
  wip: "WIP",
  fg: "FG",
  qty: "qty",
};

export function humanize(key: string) {
  const words = String(key)
    .replace(/__/g, " ")
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((word) => ACRONYMS[word.toLowerCase()] ?? word.toLowerCase());
  const text = words.join(" ").replace(/ %/g, " %");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function inferFormat(key: string, value?: unknown): MetricFormat {
  const k = key.toLowerCase();
  if (typeof value === "string" && !/^-?\d+(\.\d+)?$/.test(value)) {
    if (/(date|_at|timestamp)$/.test(k)) return "text";
    return "text";
  }
  if (/(_pct|_rate|percent|yield|oee|efficiency|accuracy|coverage|availability|performance|quality|conversion|achievement|discipline)$/.test(k) || /^(oee|availability|performance|quality)$/.test(k)) return "pct";
  if (k === "value") return "num";
  if (/(revenue|cost|value|margin|contribution|price|amount|_inr)$/.test(k) || /cost_of_scrap/.test(k)) return "inr";
  if (/(_kg|weight|^weight|scrap$|consumed|issued|theoretical|required|variance|output|produced)/.test(k)) return "kg";
  if (/minutes$/.test(k)) return "min";
  if (/hours$/.test(k)) return "hrs";
  if (/days$|age_days/.test(k)) return "days";
  if (/(count|jobs|events|orders|challans|items|machines|operators|pcs|completed)$/.test(k)) return "count";
  return "num";
}

const INR = (value: number) => {
  const abs = Math.abs(value);
  if (abs >= 1e7) return `₹${(value / 1e7).toLocaleString("en-IN", { maximumFractionDigits: 2 })} Cr`;
  if (abs >= 1e5) return `₹${(value / 1e5).toLocaleString("en-IN", { maximumFractionDigits: 2 })} L`;
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
};

export function formatValue(value: unknown, format: MetricFormat): string {
  if (value === null || value === undefined || value === "") return "—";
  if (format === "text") {
    const text = String(value);
    if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
      const d = new Date(text);
      if (!Number.isNaN(d.getTime())) return d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      const d = new Date(`${text}T00:00:00`);
      if (!Number.isNaN(d.getTime())) return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
    }
    // Enum-like values (PLANNING_REQUIRED, DISPATCH READY) read better in sentence case.
    if (/^[A-Z][A-Z_ ]{3,}$/.test(text)) {
      const words = text.replace(/_/g, " ").toLowerCase();
      return words.charAt(0).toUpperCase() + words.slice(1);
    }
    return text.replace(/_/g, " ");
  }
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  switch (format) {
    case "kg":
      return Math.abs(n) >= 1000
        ? `${(n / 1000).toLocaleString("en-IN", { maximumFractionDigits: 2 })} t`
        : `${n.toLocaleString("en-IN", { maximumFractionDigits: 1 })} kg`;
    case "pct":
      return `${n.toLocaleString("en-IN", { maximumFractionDigits: 1 })}%`;
    case "inr":
      return INR(n);
    case "min":
      return n >= 120 ? `${(n / 60).toLocaleString("en-IN", { maximumFractionDigits: 1 })} h` : `${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })} min`;
    case "hrs":
      return `${n.toLocaleString("en-IN", { maximumFractionDigits: 1 })} h`;
    case "days":
      return `${n.toLocaleString("en-IN", { maximumFractionDigits: 0 })} d`;
    case "count":
      return n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
    default:
      return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  }
}

function hasMetricCohort(key: string, summary: Record<string, any>) {
  if (key === "scrap_rate" || key === "yield_pct") {
    return Number(summary.total_processed_kg) > 0 || Number(summary.total_output_kg) > 0;
  }
  if (key === "planning_accuracy_pct" || key === "issue_accuracy_pct") {
    return Number(summary.total_materials) > 0;
  }
  if (key.includes("coverage")) {
    return Number(summary.total_jobs) > 0 ||
      (key === "material_actual_coverage" && Number(summary.total_materials) > 0);
  }
  return true;
}

const isNum = (v: unknown) => v !== null && v !== "" && v !== undefined && Number.isFinite(Number(v)) && typeof v !== "boolean";
const asRows = (v: unknown): Record<string, any>[] => (Array.isArray(v) ? v.filter((r) => r && typeof r === "object" && !Array.isArray(r)) : []);

const LABEL_KEYS = [
  "name", "label", "full_name", "reason", "machine", "machine_name", "process", "status", "customer", "customer_name",
  "work_center", "shift_code", "stage", "range", "family", "sku", "operator", "category", "color_family", "item_type",
  "location", "plant", "variant", "job_number", "order_number", "dc_no", "date", "state", "band",
];
const VALUE_PRIORITY = [
  "value", "weight_kg", "output_kg", "actual_output", "produced_kg", "scrap_kg", "scrap", "minutes", "count",
  "variance", "variance_qty", "margin", "total", "weight", "challans", "orders", "days_overdue",
];

function pickLabel(row: Record<string, any>, candidates?: string[]) {
  for (const key of [...(candidates || []), ...LABEL_KEYS]) {
    const v = row[key];
    if (v !== null && v !== undefined && String(v).trim() !== "") return formatValue(v, "text");
  }
  const first = Object.values(row).find((v) => typeof v === "string" && v.trim());
  return first ? String(first) : "—";
}

function pickValueKey(rows: Record<string, any>[], preferred?: string) {
  if (preferred && rows.some((r) => isNum(r[preferred]))) return preferred;
  for (const key of VALUE_PRIORITY) if (rows.some((r) => isNum(r[key]))) return key;
  const first = rows[0] ? Object.keys(rows[0]).find((k) => isNum(rows[0][k]) && !/(_id|^id)$/.test(k)) : undefined;
  return first;
}

const DATE_KEYS = ["date", "day", "period", "month", "week"];
function detectDateKey(rows: Record<string, any>[]) {
  return DATE_KEYS.find((k) => rows.some((r) => typeof r[k] === "string" && /^\d{4}-\d{2}/.test(r[k])));
}

const shortDate = (value: string) => {
  const d = new Date(value.length <= 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(d.getTime())) return value;
  return value.length === 7
    ? d.toLocaleDateString("en-IN", { month: "short", year: "2-digit" })
    : d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
};

/* ------------------------------------------------------------------ */
/* Period                                                              */
/* ------------------------------------------------------------------ */

type Period = "7d" | "30d" | "90d" | "mtd" | "ytd" | "custom";
const iso = (d: Date) => {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};
function periodRange(period: Period): { from: string; to: string } | null {
  const now = new Date();
  const to = iso(now);
  const back = (days: number) => iso(new Date(now.getTime() - days * 86400000));
  switch (period) {
    case "7d":
      return { from: back(6), to };
    case "30d":
      return { from: back(29), to };
    case "90d":
      return { from: back(89), to };
    case "mtd":
      return { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to };
    case "ytd": {
      // Indian financial year starts 1 April.
      const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
      return { from: iso(new Date(fyStartYear, 3, 1)), to };
    }
    default:
      return null;
  }
}
const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "90d", label: "90D" },
  { value: "mtd", label: "MTD" },
  { value: "ytd", label: "FY" },
  { value: "custom", label: "Custom" },
];

/* ------------------------------------------------------------------ */
/* Insights                                                            */
/* ------------------------------------------------------------------ */

type Insight = { tone: "good" | "bad" | "info" | "warn"; text: string };

function resolveTarget(def: KpiDef, summary: Record<string, any>, benchmarks: Record<string, any>) {
  if (typeof def.target === "number") return def.target;
  if (typeof def.target === "string") {
    const v = benchmarks[def.target] ?? summary[def.target];
    return isNum(v) ? Number(v) : undefined;
  }
  return undefined;
}

function buildInsights({
  kpis,
  summary,
  benchmarks,
  sections,
  trend,
}: {
  kpis: KpiDef[];
  summary: Record<string, any>;
  benchmarks: Record<string, any>;
  sections: { def: SectionDef; items: { label: string; value: number }[] }[];
  trend: { measure: string; format: MetricFormat; rows: Record<string, any>[]; dateKey?: string } | null;
}): Insight[] {
  const out: Insight[] = [];
  for (const def of kpis) {
    const target = resolveTarget(def, summary, benchmarks);
    const value = summary[def.key];
    if (target === undefined || !isNum(value)) continue;
    const v = Number(value);
    const good = def.higherIsBetter === false ? v <= target : v >= target;
    out.push({
      tone: good ? "good" : "bad",
      text: `${def.label} is ${formatValue(v, def.format || "pct")} — ${good ? "meeting" : "missing"} the ${formatValue(target, def.format || "pct")} target.`,
    });
  }
  if (trend && trend.rows.length >= 4) {
    const values = trend.rows.map((r) => Number(r[trend.measure]) || 0);
    const mid = Math.floor(values.length / 2);
    const avg = (arr: number[]) => arr.reduce((s, x) => s + x, 0) / Math.max(1, arr.length);
    const first = avg(values.slice(0, mid));
    const second = avg(values.slice(mid));
    if (first > 0) {
      const change = ((second - first) / first) * 100;
      if (Math.abs(change) >= 5) {
        out.push({
          tone: "info",
          text: `${humanize(trend.measure)} averaged ${formatValue(second, trend.format)} a day in the second half of the period, ${change > 0 ? "up" : "down"} ${Math.abs(change).toFixed(0)}% on the first half.`,
        });
      }
    }
    const peak = trend.rows.reduce((best, r) => (Number(r[trend.measure]) > Number(best[trend.measure]) ? r : best), trend.rows[0]);
    const dateKey = trend.dateKey || detectDateKey(trend.rows);
    if (dateKey && Number(peak[trend.measure]) > 0) {
      out.push({ tone: "info", text: `Peak ${humanize(trend.measure).toLowerCase()} was ${formatValue(peak[trend.measure], trend.format)} on ${shortDate(String(peak[dateKey]))}.` });
    }
  }
  for (const { def, items } of sections) {
    if (items.length < 2 || def.kind === "bars") continue;
    const total = items.reduce((s, i) => s + Math.max(0, i.value), 0);
    if (total <= 0) continue;
    const top = items[0];
    const share = (top.value / total) * 100;
    if (share >= 35) {
      out.push({
        tone: share >= 60 ? "warn" : "info",
        text: `${top.label} accounts for ${share.toFixed(0)}% of ${def.title.toLowerCase()}.`,
      });
    }
  }
  return out.slice(0, 6);
}

/* ------------------------------------------------------------------ */
/* View                                                                */
/* ------------------------------------------------------------------ */

export type ReportViewProps = {
  tab: string;
  title: string;
  description?: string;
};

const REPORT_ACTIONS: Record<string, { label: string; href: string; detail: string }[]> = {
  production: [{ label: "Resolve waiting jobs", href: "/production/planner", detail: "Check the current step, materials and machine before release." }],
  oee: [{ label: "Review machine setup", href: "/production/machine-selector", detail: "Inspect downtime and missing rated capacity; calendar estimates are not shift OEE." }],
  scrap: [{ label: "Review production exceptions", href: "/production/planner", detail: "Use the job and process breakdown below to investigate the largest measured loss." }],
  inventory: [{ label: "Find available rolls", href: "/inventory/rolls", detail: "Check material, grade, gauge, width, form and location." }, { label: "Review stock exceptions", href: "/inventory/alerts", detail: "Investigate aged or blocked stock before allocating it." }],
  "inventory-lineage": [{ label: "Trace an exact roll", href: "/inventory/traceability", detail: "Use ERP ID, supplier roll reference or QR; compare physical location." }],
  sales: [{ label: "Review overdue orders", href: "/sales/orders", detail: "Check the promised date and dispatch evidence before contacting the customer." }],
  interplant: [{ label: "Receive an incoming transfer", href: "/inventory/inter-plant", detail: "Confirm the challan and physical receipt, then allocate at the receiving plant." }],
  dispatch: [{ label: "Open dispatch bay", href: "/logistics/dispatch", detail: "Resolve packing and delivery blockers on the linked challan." }],
  mrp: [{ label: "Review material demand", href: "/analytics/mrp", detail: "Compare demand with available stock before creating purchase orders." }],
};

const ROW_PAGE_SIZE = 25;

function ReportViewInner({ tab, title, description }: ReportViewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const config = REPORT_CONFIG[tab] || DEFAULT_CONFIG;

  const initialFrom = searchParams?.get("date_from") || "";
  const initialTo = searchParams?.get("date_to") || "";
  const [period, setPeriod] = useState<Period>((searchParams?.get("period") as Period) || (initialFrom || initialTo ? "custom" : "30d"));
  const [dateFrom, setDateFrom] = useState(initialFrom || (periodRange(period) || periodRange("30d"))!.from);
  const [dateTo, setDateTo] = useState(initialTo || (periodRange(period) || periodRange("30d"))!.to);
  const [plant, setPlant] = useState(searchParams?.get("plant") || "ALL");
  const [processId, setProcessId] = useState(searchParams?.get("process") || "ALL");
  const [shift, setShift] = useState(searchParams?.get("shift") || "ALL");
  const [measure, setMeasure] = useState<string>("");
  const [rowSearch, setRowSearch] = useState("");
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);
  const [rowPage, setRowPage] = useState(1);

  useEffect(() => {
    const range = periodRange(period);
    if (range) {
      setDateFrom(range.from);
      setDateTo(range.to);
    }
  }, [period]);

  useEffect(() => {
    if (!pathname) return;
    const params = new URLSearchParams();
    if (period !== "30d") params.set("period", period);
    if (period === "custom") {
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);
    }
    if (plant !== "ALL") params.set("plant", plant);
    if (processId !== "ALL") params.set("process", processId);
    if (shift !== "ALL") params.set("shift", shift);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [dateFrom, dateTo, pathname, period, plant, processId, router, shift]);

  const filters = useMemo(
    () => ({
      plant: plant !== "ALL" ? plant : undefined,
      process: processId !== "ALL" ? processId : undefined,
      shift: shift !== "ALL" ? shift : undefined,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
    }),
    [dateFrom, dateTo, plant, processId, shift],
  );

  const plantsQuery = useQuery({ queryKey: ["report-plants"], queryFn: factoryService.getPlants, staleTime: 600_000 });
  const processesQuery = useQuery({ queryKey: ["report-processes"], queryFn: factoryService.getProcesses, staleTime: 600_000 });
  const shiftsQuery = useQuery({
    queryKey: ["report-shifts", plant],
    queryFn: () => factoryService.getShifts(plant !== "ALL" ? plant : undefined),
    staleTime: 300_000,
  });
  const reportQuery = useQuery<ReportTabResponse>({
    queryKey: ["report-view", tab, filters],
    queryFn: () => analyticsApi.getReportTab(tab, filters),
    staleTime: 60_000,
    refetchInterval: 180_000,
  });

  const payload = (reportQuery.data || {}) as ReportTabResponse & Record<string, any>;
  const summary = (payload.summary || payload.kpis || {}) as Record<string, any>;
  const benchmarks = (payload.benchmarks || {}) as Record<string, any>;
  const coverage = payload.coverage || {};
  const warnings = (payload.warnings || []).filter(Boolean);
  const loading = !reportQuery.data && reportQuery.isFetching;

  /* KPIs: configured first, then any remaining numeric summary values. */
  const kpiDefs = useMemo(() => {
    const defs = config.kpis.filter((def) => summary[def.key] !== undefined && summary[def.key] !== null);
    if (defs.length >= 4) return defs.slice(0, 8);
    const used = new Set(defs.map((d) => d.key));
    const extra = Object.entries(summary)
      .filter(([key, value]) => !used.has(key) && (isNum(value) || (typeof value === "string" && value.length < 40)))
      .slice(0, 8 - defs.length)
      .map(([key, value]) => ({ key, label: humanize(key), format: inferFormat(key, value) }) as KpiDef);
    return [...defs, ...extra];
  }, [config.kpis, summary]);

  /* Series */
  const rawSeriesRows = useMemo(
    () => (asRows(payload.series).length ? asRows(payload.series) : asRows(payload.charts?.trend)),
    [payload.series, payload.charts],
  );
  const dateKey = config.dateKey && rawSeriesRows.some((r) => r[config.dateKey!] != null) ? config.dateKey : detectDateKey(rawSeriesRows);
  /* Daily series only list days with activity; fill the gaps with zero so the
     chart shows quiet days honestly instead of interpolating across them. */
  const seriesRows = useMemo(() => {
    if (!dateKey || tab === "shift-performance") return rawSeriesRows;
    const daily = rawSeriesRows.every((r) => /^\d{4}-\d{2}-\d{2}$/.test(String(r[dateKey]).slice(0, 10)));
    if (!daily || !dateFrom || !dateTo) return rawSeriesRows;
    const start = new Date(`${dateFrom}T00:00:00`);
    const end = new Date(`${dateTo}T00:00:00`);
    const days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
    if (!(days > 0 && days <= 400)) return rawSeriesRows;
    const numericKeys = Array.from(new Set(rawSeriesRows.flatMap((r) => Object.keys(r).filter((k) => k !== dateKey && isNum(r[k])))));
    const byDay = new Map(rawSeriesRows.map((r) => [String(r[dateKey]).slice(0, 10), r]));
    const out: Record<string, any>[] = [];
    for (let i = 0; i < days; i += 1) {
      const key = iso(new Date(start.getTime() + i * 86400000));
      out.push(byDay.get(key) || { [dateKey]: key, ...Object.fromEntries(numericKeys.map((k) => [k, 0])) });
    }
    return out;
  }, [dateFrom, dateKey, dateTo, rawSeriesRows, tab]);
  const isShiftPivot = tab === "shift-performance" && seriesRows.some((r) => r.shift_code);
  const pivotShift = useMemo(() => {
    if (!isShiftPivot || !dateKey) return null;
    const shifts = Array.from(new Set(seriesRows.map((r) => String(r.shift_code))));
    const byDate = new Map<string, Record<string, any>>();
    for (const r of seriesRows) {
      const key = String(r[dateKey]);
      const bucket = byDate.get(key) || { [dateKey]: key };
      bucket[String(r.shift_code)] = (Number(bucket[String(r.shift_code)]) || 0) + (Number(r.value) || 0);
      byDate.set(key, bucket);
    }
    return { shifts, rows: Array.from(byDate.values()).sort((a, b) => String(a[dateKey]).localeCompare(String(b[dateKey]))) };
  }, [dateKey, isShiftPivot, seriesRows]);
  const measureOptions = useMemo(() => {
    if (!seriesRows.length) return [] as string[];
    const keys = Array.from(new Set(seriesRows.flatMap((r) => Object.keys(r)))).filter(
      (k) => k !== dateKey && !/(_id|^id)$/.test(k) && seriesRows.some((r) => isNum(r[k]) && Number(r[k]) !== 0),
    );
    const preferred = (config.trendMeasures || []).filter((k) => keys.includes(k));
    return [...preferred, ...keys.filter((k) => !preferred.includes(k))].slice(0, 5);
  }, [config.trendMeasures, dateKey, seriesRows]);
  const activeMeasure = measureOptions.includes(measure) ? measure : measureOptions[0] || "";
  const measureFormat: MetricFormat = config.seriesFormats?.[activeMeasure] ?? inferFormat(activeMeasure);

  /* Breakdown sections */
  const breakdowns = (payload.breakdowns || {}) as Record<string, any>;
  const sectionData = useMemo(() => {
    const defs: SectionDef[] = [...config.sections];
    const configured = new Set(defs.map((d) => d.key));
    for (const [key, value] of Object.entries(breakdowns)) {
      if (configured.has(key)) continue;
      if (["daily_trend", "monthly_trend", "recent_challans", "recent_events", "cost_per_kg_trend"].includes(key)) continue;
      const rows = asRows(value);
      if (rows.length < 1) continue;
      defs.push({ key, title: humanize(key.replace(/^by_/, "by ")), kind: rows.length <= 6 ? "donut" : "ranked" });
    }
    return defs
      .map((def) => {
        const rows = asRows(breakdowns[def.key] ?? payload[def.key]);
        const valueKey = pickValueKey(rows, def.value);
        if (!valueKey) return null;
        const format = def.format || inferFormat(valueKey);
        const items = rows
          .map((row) => ({
            label: pickLabel(row, def.label),
            value: Number(row[valueKey]) || 0,
            row,
          }))
          .filter((item) => item.value !== 0 || def.kind === "composition");
        if (def.kind !== "bars" && def.kind !== "composition") items.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
        if (!items.length) return null;
        return { def, items, format, valueKey };
      })
      .filter(Boolean) as { def: SectionDef; items: { label: string; value: number; row: Record<string, any> }[]; format: MetricFormat; valueKey: string }[];
  }, [breakdowns, config.sections, payload]);

  const insights = useMemo(
    () =>
      buildInsights({
        kpis: kpiDefs,
        summary,
        benchmarks,
        sections: sectionData,
        trend: activeMeasure && dateKey ? { measure: activeMeasure, format: measureFormat, rows: seriesRows, dateKey } : null,
      }),
    [activeMeasure, benchmarks, dateKey, kpiDefs, measureFormat, sectionData, seriesRows, summary],
  );

  /* Detail rows */
  const rows = useMemo(() => asRows(payload.rows), [payload.rows]);
  const columns = useMemo(() => {
    const keys = Array.from(new Set(rows.slice(0, 40).flatMap((r) => Object.keys(r)))).filter(
      (k) => !/(_id|^id|fill|color)$/.test(k) && rows.some((r) => r[k] !== null && r[k] !== undefined && r[k] !== "" && typeof r[k] !== "object"),
    );
    const preferred = (config.columns || []).filter((k) => keys.includes(k));
    return [...preferred, ...keys.filter((k) => !preferred.includes(k))].slice(0, config.maxColumns ?? 10);
  }, [config.columns, config.maxColumns, rows]);
  const columnFormats = useMemo(
    () => Object.fromEntries(columns.map((c) => [c, inferFormat(c, rows.find((r) => r[c] !== null && r[c] !== undefined)?.[c])])) as Record<string, MetricFormat>,
    [columns, rows],
  );
  const filteredRows = useMemo(() => {
    const term = rowSearch.trim().toLowerCase();
    let out = term ? rows.filter((r) => columns.some((c) => String(r[c] ?? "").toLowerCase().includes(term))) : rows;
    if (sort) {
      out = [...out].sort((a, b) => {
        const av = a[sort.key];
        const bv = b[sort.key];
        const cmp = isNum(av) && isNum(bv) ? Number(av) - Number(bv) : String(av ?? "").localeCompare(String(bv ?? ""));
        return sort.dir === "asc" ? cmp : -cmp;
      });
    }
    return out;
  }, [columns, rowSearch, rows, sort]);
  const rowPageCount = Math.max(1, Math.ceil(filteredRows.length / ROW_PAGE_SIZE));
  const safeRowPage = Math.min(rowPage, rowPageCount);
  const pagedRows = filteredRows.slice((safeRowPage - 1) * ROW_PAGE_SIZE, safeRowPage * ROW_PAGE_SIZE);
  useEffect(() => setRowPage(1), [rowSearch, sort, tab, filters]);

  const exportCsv = () => {
    if (reportQuery.isFetching || reportQuery.isError) return;
    const esc = (v: unknown) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [columns.map((c) => esc(humanize(c))).join(","), ...filteredRows.map((r) => columns.map((c) => esc(r[c])).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${tab}-${dateFrom}-to-${dateTo}.csv`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const periodLabel = `${formatValue(dateFrom, "text")} – ${formatValue(dateTo, "text")}`;
  const coverageChips = [
    { key: "execution_log_coverage", label: "Machine logs" },
    { key: "material_actual_coverage", label: "Material actuals" },
    { key: "shift_coverage", label: "Shift tags" },
  ].filter((c) => isNum((coverage as any)[c.key]));

  const selectClass =
    "h-9 rounded-xl border border-line bg-surface-1 pl-3 pr-8 text-[12.5px] font-medium text-content-1 shadow-[var(--shadow-sm)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <div className="mx-auto max-w-[1600px] space-y-4" data-testid={`report-page-${tab}`}>
      <PageHero
        compact
        eyebrow={`Reports · ${config.domain}`}
        icon={<BarChart3 />}
        title={title}
        description={description}
        meta={
          <>
            <HeroChip tone="info">{periodLabel}</HeroChip>
            {payload.generated_at ? <HeroChip>Updated {formatValue(payload.generated_at, "text")}</HeroChip> : null}
            {coverageChips.map((c) => {
              const v = Number((coverage as any)[c.key]);
              const hasCohort = hasMetricCohort(c.key, summary);
              return (
                <HeroChip key={c.key} tone={!hasCohort ? "neutral" : v >= 80 ? "good" : v >= 30 ? "warn" : "bad"}>
                  {c.label} {hasCohort ? `${v.toFixed(0)}%` : "N/A"}
                </HeroChip>
              );
            })}
          </>
        }
        actions={
          <>
            <Link href="/analytics/reports" className={heroButtonClass("ghost")}>
              <ArrowLeft /> All reports
            </Link>
            <a href={analyticsApi.getReportTabPdfDownloadUrl(tab, filters)} target="_blank" rel="noreferrer" className={heroButtonClass("ghost")}>
              <Download /> PDF
            </a>
            <button type="button" onClick={() => void reportQuery.refetch()} disabled={reportQuery.isFetching} className={heroButtonClass("primary")}>
              <RefreshCw className={cn(reportQuery.isFetching && "animate-spin motion-reduce:animate-none")} /> Refresh
            </button>
          </>
        }
      />

      <section className="flex flex-wrap items-center gap-2 rounded-[18px] border border-line bg-surface-1 p-2.5 shadow-[var(--shadow-sm)]">
        <Segmented value={period} onChange={setPeriod} options={PERIOD_OPTIONS} />
        {period === "custom" ? (
          <div className="flex items-center gap-1.5">
            <Input type="date" value={dateFrom} max={dateTo} onChange={(e) => setDateFrom(e.target.value)} className="h-9 w-[150px] rounded-xl" aria-label="From date" />
            <span className="text-content-4">–</span>
            <Input type="date" value={dateTo} min={dateFrom} onChange={(e) => setDateTo(e.target.value)} className="h-9 w-[150px] rounded-xl" aria-label="To date" />
          </div>
        ) : null}
        <select value={plant} onChange={(e) => setPlant(e.target.value)} className={selectClass} aria-label="Plant">
          <option value="ALL">All plants</option>
          {(plantsQuery.data || []).map((row: any) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </select>
        <select value={processId} onChange={(e) => setProcessId(e.target.value)} className={selectClass} aria-label="Process">
          <option value="ALL">All processes</option>
          {(processesQuery.data || []).map((row: any) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </select>
        <select value={shift} onChange={(e) => setShift(e.target.value)} className={selectClass} aria-label="Shift">
          <option value="ALL">All shifts</option>
          {(shiftsQuery.data || []).map((row: any) => (
            <option key={row.id} value={row.code}>
              {row.name || row.code}
            </option>
          ))}
        </select>
        {reportQuery.isFetching && reportQuery.data ? <span className="ml-auto text-[12px] text-content-3">Updating…</span> : null}
      </section>

      {reportQuery.isError ? (
        <div role="alert" className="flex items-center gap-2 rounded-xl border border-danger-border bg-danger-bg px-4 py-3 text-[13px] text-danger-fg">
          <AlertTriangle className="h-4 w-4" /> This report could not be loaded. Try refreshing.
        </div>
      ) : null}
      {warnings.length ? (
        <div className="flex flex-wrap items-start gap-2 rounded-xl border border-warning-border bg-warning-bg px-4 py-3 text-[12.5px] text-warning-fg">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="space-y-0.5">
            {warnings.map((w: string, i: number) => (
              <div key={i}>{w}</div>
            ))}
          </div>
        </div>
      ) : null}

      {REPORT_ACTIONS[tab] && !loading && !reportQuery.isError && <section className="rounded-xl border border-line bg-surface-1 p-4" aria-label="Next actions">
        <h2 className="mb-3 text-sm font-semibold text-content-1">Turn this report into action</h2>
        <div className="grid gap-3 sm:grid-cols-2">{REPORT_ACTIONS[tab].map(action => <a key={action.href} href={action.href} className="rounded-lg bg-surface-2 p-3 transition-colors hover:bg-surface-3">
          <span className="text-sm font-semibold text-primary">{action.label} →</span><p className="mt-1 text-xs text-content-3">{action.detail}</p>
        </a>)}</div>
      </section>}

      {/* KPIs */}
      <div className="erp-stagger grid grid-cols-2 gap-3 lg:grid-cols-4">
        {loading
          ? Array.from({ length: 8 }).map((_, i) => <div key={i} className="erp-skeleton h-[118px] rounded-[16px]" />)
          : kpiDefs.map((def) => {
              const raw = hasMetricCohort(def.key, summary) ? summary[def.key] : null;
              const format = def.format || inferFormat(def.key, raw);
              const target = resolveTarget(def, summary, benchmarks);
              const numeric = isNum(raw) ? Number(raw) : null;
              let tone: "neutral" | "good" | "bad" = "neutral";
              if (numeric !== null && target !== undefined) {
                tone = (def.higherIsBetter === false ? numeric <= target : numeric >= target) ? "good" : "bad";
              }
              return (
                <StatCard
                  key={def.key}
                  label={def.label}
                  value={format === "text" ? formatValue(raw, "text") : numeric}
                  format={(v) => formatValue(v, format)}
                  tone={tone}
                  hint={target !== undefined ? `Target ${formatValue(target, format)}` : def.hint}
                  delta={
                    target !== undefined && numeric !== null
                      ? {
                          label: tone === "good" ? "On target" : "Below target",
                          direction: tone === "good" ? "up" : "down",
                          good: tone === "good",
                        }
                      : null
                  }
                />
              );
            })}
        {!loading && !kpiDefs.length ? (
          <div className="col-span-full">
            <PanelEmpty title="No figures for this period">Widen the period or clear filters.</PanelEmpty>
          </div>
        ) : null}
      </div>

      {/* OEE decomposition */}
      {tab === "oee" && isNum(summary.global_availability) ? (
        <Panel title="Where OEE is lost" description="OEE = availability × performance × quality. The weakest factor is where effort pays back first.">
          <div className="grid gap-4 md:grid-cols-3">
            {[
              { key: "global_availability", label: "Availability", target: benchmarks.target_availability, copy: "running time vs planned time" },
              { key: "global_performance", label: "Performance", target: benchmarks.target_performance, copy: "actual speed vs rated speed" },
              { key: "global_quality", label: "Quality", target: benchmarks.target_quality, copy: "good output vs total output" },
            ].map((f) => {
              const v = Number(summary[f.key]) || 0;
              const t = Number(f.target) || 0;
              return (
                <div key={f.key} className="rounded-2xl border border-line bg-surface-2/60 p-4">
                  <div className="flex items-baseline justify-between">
                    <span className="text-[13px] font-medium text-content-2">{f.label}</span>
                    <span className={cn("text-[22px] font-semibold tabular-nums", t && v < t ? "text-danger-fg" : "text-content-1")}>{formatValue(v, "pct")}</span>
                  </div>
                  <div className="relative mt-3 h-2 rounded-full bg-surface-1 ring-1 ring-line">
                    <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${Math.min(100, v)}%`, background: t && v < t ? "var(--viz-critical)" : "var(--viz-good)" }} />
                    {t ? <div className="absolute -top-1 h-4 w-0.5 rounded bg-content-1" style={{ left: `${Math.min(100, t)}%` }} title={`Target ${t}%`} /> : null}
                  </div>
                  <div className="mt-2 text-[11.5px] text-content-3">
                    {f.copy}
                    {t ? ` · target ${t}%` : ""}
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      ) : null}

      {/* Trend + insights */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(300px,1fr)]">
        <Panel
          title={dateKey ? "Trend" : config.seriesTitle || "Distribution"}
          description={dateKey ? `Daily ${humanize(activeMeasure || "value").toLowerCase()} across the period` : undefined}
          actions={
            dateKey && measureOptions.length > 1 && !pivotShift ? (
              <Segmented size="sm" value={activeMeasure} onChange={setMeasure} options={measureOptions.map((m) => ({ value: m, label: tab === "oee" && m === "value" ? "OEE %" : humanize(m) }))} />
            ) : null
          }
        >
          {loading ? (
            <div className="erp-skeleton h-[260px] rounded-xl" />
          ) : pivotShift ? (
            <Bars
              data={pivotShift.rows}
              xKey={dateKey as string}
              series={pivotShift.shifts.map((s, i) => ({ key: s, label: `Shift ${s}`, color: vizColor(i) }))}
              stacked
              height={260}
              xFormat={shortDate}
              valueFormat={(v) => formatValue(v, "kg")}
            />
          ) : dateKey && activeMeasure ? (
            <TrendArea
              data={seriesRows}
              xKey={dateKey}
              series={[{ key: activeMeasure, label: tab === "oee" && activeMeasure === "value" ? "OEE %" : humanize(activeMeasure) }]}
              height={260}
              xFormat={shortDate}
              valueFormat={(v) => formatValue(v, measureFormat)}
            />
          ) : seriesRows.length && activeMeasure ? (
            <Bars
              data={seriesRows.map((r) => ({ ...r, __label: pickLabel(r) }))}
              xKey="__label"
              series={[{ key: activeMeasure, label: humanize(activeMeasure) }]}
              colorByIndex
              height={260}
              valueFormat={(v) => formatValue(v, measureFormat)}
            />
          ) : (
            <PanelEmpty title="No time series in this period" />
          )}
        </Panel>
        <Panel title="Insights" icon={<Lightbulb />} description="Computed from this period's data">
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="erp-skeleton h-12 rounded-xl" />
              ))}
            </div>
          ) : insights.length ? (
            <ul className="space-y-2">
              {insights.map((insight, i) => (
                <li
                  key={i}
                  className={cn(
                    "flex gap-2.5 rounded-xl border px-3 py-2.5 text-[12.5px] leading-relaxed",
                    insight.tone === "good" && "border-success-border bg-success-bg text-content-1",
                    insight.tone === "bad" && "border-danger-border bg-danger-bg text-content-1",
                    insight.tone === "warn" && "border-warning-border bg-warning-bg text-content-1",
                    insight.tone === "info" && "border-line bg-surface-2 text-content-1",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 shrink-0",
                      insight.tone === "good" ? "text-success-fg" : insight.tone === "bad" ? "text-danger-fg" : insight.tone === "warn" ? "text-warning-fg" : "text-info-fg",
                    )}
                  >
                    {insight.tone === "good" ? <TrendingUp className="h-4 w-4" /> : insight.tone === "bad" ? <TrendingDown className="h-4 w-4" /> : <Lightbulb className="h-4 w-4" />}
                  </span>
                  {insight.text}
                </li>
              ))}
            </ul>
          ) : (
            <PanelEmpty title="Not enough data for insights yet" />
          )}
        </Panel>
      </div>

      {/* Breakdowns */}
      {sectionData.length ? (
        <div className="gap-4 lg:columns-2 2xl:columns-3 [&>*]:mb-4 [&>*]:break-inside-avoid">
          {sectionData.map(({ def, items, format }) => {
            const total = items.reduce((s, i) => s + Math.max(0, i.value), 0);
            return (
              <Panel
                key={def.key}
                title={def.title}
                description={def.description || `${items.length} ${items.length === 1 ? "entry" : "entries"} · total ${formatValue(total, format)}`}
              >
                {def.kind === "donut" && items.length <= 7 ? (
                  <div className="grid items-center gap-4 sm:grid-cols-[180px_minmax(0,1fr)]">
                    <Donut data={items.map((i) => ({ name: i.label, value: i.value }))} height={180} centerValue={formatValue(total, format)} centerLabel="total" valueFormat={(v) => formatValue(v, format)} />
                    <ul className="space-y-2">
                      {items.map((item, i) => (
                        <li key={item.label + i} className="flex items-center justify-between gap-3 text-[12.5px]">
                          <span className="flex min-w-0 items-center gap-2 text-content-2">
                            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: vizColor(i) }} />
                            <span className="truncate">{item.label}</span>
                          </span>
                          <span className="shrink-0 tabular-nums text-content-1">
                            {formatValue(item.value, format)}
                            <span className="ml-1.5 text-content-4">{total ? ((item.value / total) * 100).toFixed(0) : 0}%</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : def.kind === "composition" ? (
                  <CompositionBar parts={items.map((i) => ({ label: i.label, value: i.value }))} valueFormat={(v) => formatValue(v, format)} />
                ) : def.kind === "bars" ? (
                  <Bars
                    data={items.map((i) => ({ label: i.label.length > 14 ? `${i.label.slice(0, 13)}…` : i.label, value: i.value }))}
                    xKey="label"
                    series={[{ key: "value", label: def.title }]}
                    colorByIndex
                    height={220}
                    valueFormat={(v) => formatValue(v, format)}
                  />
                ) : def.kind === "pareto" ? (
                  <RankedBars
                    items={(() => {
                      let running = 0;
                      return items.map((item) => {
                        running += item.value;
                        return {
                          key: item.label,
                          label: item.label,
                          value: item.value,
                          sub: `${total ? ((item.value / total) * 100).toFixed(0) : 0}% · cumulative ${total ? ((running / total) * 100).toFixed(0) : 0}%`,
                        };
                      });
                    })()}
                    valueFormat={(v) => formatValue(v, format)}
                    limit={def.limit || 8}
                  />
                ) : (
                  <RankedBars
                    items={items.map((item) => ({
                      key: item.label,
                      label: item.label,
                      value: item.value,
                      sub: def.sub
                        ?.map((s) => {
                          const v = item.row[s.key];
                          if (v === null || v === undefined || v === "") return null;
                          const text = formatValue(v, s.format || inferFormat(s.key, v));
                          return s.label ? `${s.label} ${text}` : text;
                        })
                        .filter(Boolean)
                        .join(" · "),
                    }))}
                    valueFormat={(v) => formatValue(v, format)}
                    limit={def.limit || 8}
                  />
                )}
              </Panel>
            );
          })}
        </div>
      ) : null}

      {/* Detail */}
      <Panel
        flush
        title={config.rowsTitle || "Detail"}
        description={`${filteredRows.length.toLocaleString("en-IN")} of ${rows.length.toLocaleString("en-IN")} rows`}
        actions={
          <div className="flex items-center gap-2">
            <div className="relative w-56">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-content-4" />
              <Input value={rowSearch} onChange={(e) => setRowSearch(e.target.value)} placeholder="Filter rows" className="h-8 rounded-lg pl-8 text-[12.5px]" />
            </div>
            <button
              type="button"
              onClick={exportCsv}
              disabled={reportQuery.isFetching || reportQuery.isError || !filteredRows.length}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface-1 px-2.5 text-[12.5px] font-medium text-content-2 transition hover:bg-surface-2 disabled:opacity-40"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" /> CSV
            </button>
          </div>
        }
      >
        {rows.length && columns.length ? (
          <div className="max-h-[560px] overflow-auto border-t border-line">
            <table className="w-full border-separate border-spacing-0 text-[12.5px]">
              <thead>
                <tr>
                  {columns.map((c) => {
                    const numeric = !["text"].includes(columnFormats[c]);
                    const active = sort?.key === c;
                    return (
                      <th key={c} scope="col" className={cn("sticky top-0 z-[1] border-b border-line bg-surface-2/95 px-3 py-2.5 font-medium text-content-3 backdrop-blur", numeric ? "text-right" : "text-left")}>
                        <button
                          type="button"
                          onClick={() => setSort((s) => (s?.key === c ? (s.dir === "desc" ? { key: c, dir: "asc" } : null) : { key: c, dir: "desc" }))}
                          className={cn("inline-flex items-center gap-1 whitespace-nowrap hover:text-content-1", active && "text-content-1")}
                        >
                          {humanize(c)}
                          {active ? sort?.dir === "desc" ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" /> : <ArrowUpDown className="h-3 w-3 opacity-40" />}
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {pagedRows.map((row, i) => (
                  <tr key={i} className="erp-manifest-row">
                    {columns.map((c) => {
                      const f = columnFormats[c];
                      const v = row[c];
                      const isStatus = /status|state/.test(c) && typeof v === "string";
                      return (
                        <td key={c} className={cn("border-b border-line px-3 py-2.5", f === "text" ? "text-left text-content-2" : "text-right tabular-nums text-content-1")}>
                          {isStatus ? (
                            <span className="inline-flex rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[11px] font-medium text-content-2">{formatValue(v, "text")}</span>
                          ) : (
                            formatValue(v, f)
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-5 pb-5">
            <PanelEmpty title={loading ? "Loading…" : "No detail rows for this period"} />
          </div>
        )}
        {rowPageCount > 1 ? (
          <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-[11.5px] text-content-3">
            <span>
              Page {safeRowPage} of {rowPageCount}
            </span>
            <Pager page={safeRowPage} pageCount={rowPageCount} onPageChange={setRowPage} testId={`report-${tab}-rows`} />
          </div>
        ) : null}
      </Panel>
    </div>
  );
}

export function ReportView(props: ReportViewProps) {
  return (
    <Suspense fallback={<div className="erp-skeleton h-[420px] rounded-[18px]" />}>
      <ReportViewInner {...props} />
    </Suspense>
  );
}

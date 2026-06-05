"use client";

/**
 * V3.6 GRN History workspace
 *
 * Track every inward (BULK / ROLL / PACKAGING) GRN. Filter by source type,
 * vendor, plant, date range, search. Correct rows via an audit-stamped
 * dialog — corrections are blocked when the period is year-closed.
 */

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  Download,
  Edit3,
  Filter,
  Layers,
  Lock,
  Package,
  PackageOpen,
  Search,
  ShieldCheck,
  Truck,
  Warehouse,
  X,
} from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { GradientHero } from "@/components/erp/gradient-hero";
import { cn } from "@/lib/utils";
import { describeApiError } from "@/lib/api";
import {
  inventoryService,
  type GrnHistoryRow,
  type GrnCorrectionPayload,
} from "@/services/inventory";
import { factoryService } from "@/services/factory";
import {
  tradingGoodReceiptService,
  type TradingGoodReceipt,
} from "@/services/trading-goods";
import {
  FilterRail,
  FilterGroup,
  FilterBar,
  SavedViewsBar,
  WorkspaceSection,
  type SavedView,
  useSavedViews,
} from "./workspace-shell";
import {
  ClassTabBar,
  INVENTORY_CLASS_TABS,
  ModeToggle,
  PulseViewV36,
} from "./pulse-view";

// ─── Types ─────────────────────────────────────────────────────────

type SourceFilter = "ALL" | "ROLL" | "BULK" | "PACKAGING" | "TRADING";
type WindowFilter = "ALL" | "TODAY" | "7D" | "30D" | "FY";

interface GrnHistoryFilterState {
  search: string;
  source: SourceFilter;
  window: WindowFilter;
  plant: string;
  vendor: string;
}

const DEFAULT_FILTERS: GrnHistoryFilterState = {
  search: "",
  source: "ALL",
  window: "30D",
  plant: "ALL",
  vendor: "ALL",
};

const DEFAULT_VIEWS: SavedView<GrnHistoryFilterState>[] = [
  {
    id: "30d",
    name: "Last 30 days",
    icon: "📅",
    pinned: true,
    state: DEFAULT_FILTERS,
  },
  {
    id: "today",
    name: "Today",
    icon: "⚡",
    state: { ...DEFAULT_FILTERS, window: "TODAY" },
  },
  {
    id: "7d",
    name: "Last 7 days",
    icon: "📆",
    state: { ...DEFAULT_FILTERS, window: "7D" },
  },
  {
    id: "rolls",
    name: "Roll GRNs",
    icon: "🌀",
    state: { ...DEFAULT_FILTERS, source: "ROLL" },
  },
  {
    id: "bulk",
    name: "Bulk GRNs",
    icon: "🧪",
    state: { ...DEFAULT_FILTERS, source: "BULK" },
  },
  {
    id: "packaging",
    name: "Packaging GRNs",
    icon: "📦",
    state: { ...DEFAULT_FILTERS, source: "PACKAGING" },
  },
  {
    id: "trading",
    name: "Trading GRNs",
    icon: "🛒",
    state: { ...DEFAULT_FILTERS, source: "TRADING" },
  },
  {
    id: "all",
    name: "All time",
    icon: "🗂️",
    state: { ...DEFAULT_FILTERS, window: "ALL" },
  },
];

function fmtNum(n: number, max = 0): string {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: max,
  }).format(n);
}

function fmtQty(qty: number, uom?: string): string {
  return `${fmtNum(qty, 2)} ${uom || ""}`;
}

function fmtMoney(value: number): string {
  return `Rs ${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function makeTrend(target: number, points = 12): number[] {
  if (!Number.isFinite(target) || target <= 0) return [0, 0, 0, 0];
  const seed = Math.max(target * 0.65, 1);
  const out: number[] = [];
  for (let i = 0; i < points; i++) {
    const ratio = i / Math.max(points - 1, 1);
    const wobble = Math.sin(i * 0.7 + 0.4) * 0.08;
    out.push(Math.max(0, seed + (target - seed) * ratio + target * wobble));
  }
  return out;
}

function fmtDate(s?: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString();
}

function fyOf(d: Date): {
  startYear: number;
  endYear: number;
  label: string;
  start: Date;
} {
  const m = d.getMonth() + 1;
  const y = d.getFullYear();
  const startYear = m >= 4 ? y : y - 1;
  return {
    startYear,
    endYear: startYear + 1,
    label: `FY ${startYear}-${String(startYear + 1).slice(-2)}`,
    start: new Date(startYear, 3, 1),
  };
}

function withinWindow(
  rowDate: string | null | undefined,
  w: WindowFilter,
): boolean {
  if (w === "ALL") return true;
  if (!rowDate) return false;
  const d = new Date(rowDate);
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  if (w === "TODAY") {
    return d.toDateString() === now.toDateString();
  }
  if (w === "7D") {
    return d.getTime() >= now.getTime() - 7 * 24 * 3600 * 1000;
  }
  if (w === "30D") {
    return d.getTime() >= now.getTime() - 30 * 24 * 3600 * 1000;
  }
  if (w === "FY") {
    return d.getTime() >= fyOf(now).start.getTime();
  }
  return true;
}

const SOURCE_ICON: Record<string, string> = {
  ROLL: "🌀",
  BULK: "🧪",
  PACKAGING: "📦",
  TRADING: "🛒",
};
const SOURCE_TONE: Record<string, string> = {
  ROLL: "bg-success-bg text-success-fg ring-success-border",
  BULK: "bg-info-bg text-primary ring-info-border",
  PACKAGING: "bg-order-bg text-order-fg ring-order-border",
  TRADING: "bg-warning-bg text-warning-fg ring-warning-border",
};

// ─── Workspace ─────────────────────────────────────────────────────

export function GrnHistoryV36() {
  const [filters, setFilters] =
    React.useState<GrnHistoryFilterState>(DEFAULT_FILTERS);
  const [mode, setMode] = React.useState<"pulse" | "browse">("browse");
  const [selected, setSelected] = React.useState<GrnHistoryRow | null>(null);
  const [pageSize, setPageSize] = React.useState(50);
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("desc");
  const savedViews = useSavedViews<GrnHistoryFilterState>(
    "grn-history",
    DEFAULT_VIEWS,
  );
  const queryClient = useQueryClient();

  const grnQuery = useQuery({
    queryKey: ["grn-history"],
    queryFn: () => inventoryService.getGrnHistory({}),
    staleTime: 30_000,
  });

  const tradingQuery = useQuery({
    queryKey: ["grn-history-trading"],
    queryFn: () => tradingGoodReceiptService.list(),
    staleTime: 30_000,
  });

  const allRows = React.useMemo(() => {
    const base = Array.isArray(grnQuery.data)
      ? (grnQuery.data as GrnHistoryRow[])
      : [];
    const trading = Array.isArray(tradingQuery.data)
      ? (tradingQuery.data as TradingGoodReceipt[])
      : [];
    const tradingNormalized: GrnHistoryRow[] = trading.map((t) => ({
      id: t.id,
      source_type: "TRADING",
      source_id: t.id,
      material_code: t.trading_good_code,
      material_name: t.trading_good_name,
      material_category: "TRADING",
      plant: t.plant,
      plant_name: t.plant_name,
      quantity: Number(t.qty_received || 0),
      uom: t.base_uom || "",
      avg_cost: Number(t.rate || 0),
      reference: t.code || "",
      vendor: t.vendor,
      vendor_code: t.vendor_code,
      vendor_name: t.vendor_name,
      created_at: t.received_at || t.created_at || null,
      batch_no: t.vendor_invoice_no || "",
    }));
    return [...base, ...tradingNormalized];
  }, [grnQuery.data, tradingQuery.data]);

  // Filter options
  const plantOptions = React.useMemo(() => {
    const map = new Map<string, string>();
    map.set("ALL", "All plants");
    for (const r of allRows as any[]) {
      const id = String(r.plant || "");
      if (id) map.set(id, r.plant_name || id);
    }
    return Array.from(map.entries()).map(([id, label]) => ({ id, label }));
  }, [allRows]);

  const vendorOptions = React.useMemo(() => {
    const map = new Map<string, string>();
    map.set("ALL", "All vendors");
    for (const r of allRows as any[]) {
      const id = String(r.vendor || "");
      if (id) map.set(id, r.vendor_name || r.vendor_code || id);
    }
    return Array.from(map.entries()).map(([id, label]) => ({ id, label }));
  }, [allRows]);

  const filtered = React.useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    return (allRows as GrnHistoryRow[]).filter((r) => {
      if (q) {
        const hay = [
          r.material_code,
          r.material_name,
          r.label_id,
          r.batch_no,
          r.reference,
          r.plant_name,
          r.location_name,
          r.vendor_name,
          r.vendor_code,
        ].some((v) =>
          String(v || "")
            .toLowerCase()
            .includes(q),
        );
        if (!hay) return false;
      }
      if (filters.source !== "ALL" && r.source_type !== filters.source)
        return false;
      if (!withinWindow(r.created_at, filters.window)) return false;
      if (filters.plant !== "ALL" && String(r.plant || "") !== filters.plant)
        return false;
      if (filters.vendor !== "ALL" && String(r.vendor || "") !== filters.vendor)
        return false;
      return true;
    });
  }, [allRows, filters]);

  const sorted = React.useMemo(() => {
    const copy = filtered.slice();
    copy.sort((a, b) => {
      const at = new Date(a.created_at || "").getTime();
      const bt = new Date(b.created_at || "").getTime();
      const aN = Number.isFinite(at) ? at : 0;
      const bN = Number.isFinite(bt) ? bt : 0;
      return sortDir === "asc" ? aN - bN : bN - aN;
    });
    return copy;
  }, [filtered, sortDir]);

  // KPI
  const kpi = React.useMemo(() => {
    const total = filtered.length;
    const rollCount = filtered.filter((r) => r.source_type === "ROLL").length;
    const bulkCount = filtered.filter((r) => r.source_type === "BULK").length;
    const packagingCount = filtered.filter(
      (r) => r.source_type === "PACKAGING",
    ).length;
    const tradingCount = filtered.filter(
      (r) => r.source_type === "TRADING",
    ).length;
    const totalQty = filtered.reduce((s, r) => s + Number(r.quantity || 0), 0);
    return {
      total,
      rollCount,
      bulkCount,
      packagingCount,
      tradingCount,
      totalQty,
    };
  }, [filtered]);

  const pulseSourceBreakdown = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const r of filtered) {
      map.set(
        r.source_type,
        (map.get(r.source_type) || 0) + Number(r.quantity || 0),
      );
    }
    return Array.from(map.entries()).map(([label, value]) => ({
      label,
      value,
    }));
  }, [filtered]);
  const pulseVendorBreakdown = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const r of filtered) {
      const k = r.vendor_name || r.vendor_code || "—";
      map.set(k, (map.get(k) || 0) + Number(r.quantity || 0));
    }
    return Array.from(map.entries())
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
  }, [filtered]);
  const pulsePlantBreakdown = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const r of filtered) {
      const k = r.plant_name || "—";
      map.set(k, (map.get(k) || 0) + Number(r.quantity || 0));
    }
    return Array.from(map.entries())
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
  }, [filtered]);

  // Matrix: source × plant (row counts)
  const pulseMatrix = React.useMemo(() => {
    const cellMap: Record<string, Record<string, number>> = {};
    const rowSet = new Set<string>();
    const colSet = new Set<string>();
    for (const r of filtered) {
      const src = r.source_type;
      const plant = r.plant_name || "—";
      rowSet.add(src);
      colSet.add(plant);
      cellMap[src] = cellMap[src] || {};
      cellMap[src][plant] = (cellMap[src][plant] || 0) + 1;
    }
    return {
      title: "Source × plant (rows)",
      subtitle: "Where receipts land",
      rowLabel: "src",
      colLabel: "plant",
      rows: Array.from(rowSet).sort(),
      cols: Array.from(colSet).sort(),
      cells: cellMap,
      unit: "",
    };
  }, [filtered]);

  const pulseTopList = React.useMemo(() => {
    const map = new Map<
      string,
      { qty: number; rows: number; sources: Set<string> }
    >();
    for (const r of filtered) {
      const k = r.vendor_name || r.vendor_code || "—";
      const cur = map.get(k) || { qty: 0, rows: 0, sources: new Set<string>() };
      cur.qty += Number(r.quantity || 0);
      cur.rows += 1;
      cur.sources.add(r.source_type);
      map.set(k, cur);
    }
    const rows = Array.from(map.entries())
      .sort((a, b) => b[1].qty - a[1].qty)
      .slice(0, 8)
      .map(([label, v]) => ({
        label,
        sub: `${v.rows} GRN${v.rows === 1 ? "" : "s"} · ${Array.from(v.sources).join(" · ")}`,
        value: `${fmtNum(v.qty, 0)}`,
      }));
    return { title: "Top vendors by qty", subtitle: "In current window", rows };
  }, [filtered]);

  // Year-closed check: hide Correct button when row pre-dates current FY start
  const fyStart = React.useMemo(() => fyOf(new Date()).start, []);
  function isYearClosed(r: GrnHistoryRow): boolean {
    if (!r.created_at) return false;
    const d = new Date(r.created_at);
    return Number.isFinite(d.getTime()) && d.getTime() < fyStart.getTime();
  }

  const chips = React.useMemo(() => {
    const list: { key: string; label: string; onClear: () => void }[] = [];
    if (filters.search)
      list.push({
        key: "s",
        label: `"${filters.search}"`,
        onClear: () => setFilters((f) => ({ ...f, search: "" })),
      });
    if (filters.source !== "ALL")
      list.push({
        key: "src",
        label: `Source · ${filters.source}`,
        onClear: () => setFilters((f) => ({ ...f, source: "ALL" })),
      });
    if (filters.window !== "30D")
      list.push({
        key: "w",
        label: `Window · ${filters.window}`,
        onClear: () => setFilters((f) => ({ ...f, window: "30D" })),
      });
    if (filters.plant !== "ALL")
      list.push({
        key: "p",
        label: `Plant`,
        onClear: () => setFilters((f) => ({ ...f, plant: "ALL" })),
      });
    if (filters.vendor !== "ALL")
      list.push({
        key: "v",
        label: `Vendor`,
        onClear: () => setFilters((f) => ({ ...f, vendor: "ALL" })),
      });
    return list;
  }, [filters]);

  return (
    <div className="space-y-4 pb-12">
      <ClassTabBar tabs={INVENTORY_CLASS_TABS} activeId="grn" />

      <GradientHero
        eyebrow="Inventory · V3.6 · GRN history"
        title="GRN history &amp; corrections"
        subtitle="Every inward GRN — bulk, roll, packaging and trading. Audit-stamped corrections allowed until FY closes."
        palette="indigo"
        chips={[
          {
            icon: <PackageOpen className="h-3.5 w-3.5" />,
            label: "Inward rows",
            value: `${kpi.total}`,
            tone: "ok",
          },
          {
            icon: <Warehouse className="h-3.5 w-3.5" />,
            label: "Total qty",
            value: fmtNum(kpi.totalQty, 0),
            tone: "violet",
          },
          {
            icon: <ShieldCheck className="h-3.5 w-3.5" />,
            label: "Policy",
            value: "Immutable + delta",
            tone: "ok",
          },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Link
              href="/inventory/grn"
              className="inline-flex items-center gap-1.5 rounded-xl bg-surface-1 px-4 py-1.5 text-xs font-bold text-order-fg shadow-md hover:bg-order-bg"
            >
              <PackageOpen className="h-3.5 w-3.5" /> New GRN
            </Link>
            <Link
              href="/inventory"
              className="inline-flex items-center gap-1.5 rounded-xl bg-surface-1/15 px-4 py-1.5 text-xs font-bold text-white ring-1 ring-surface-1/30 hover:bg-surface-1/25"
            >
              ← Summary
            </Link>
          </div>
        }
      />

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <ModeToggle mode={mode} onChange={setMode} />
        <span className="text-[11px] text-content-3">
          {mode === "pulse"
            ? "Vendor / plant / source mix"
            : `${sorted.length} rows in window`}
        </span>
      </div>

      {mode === "pulse" && (
        <PulseViewV36
          kpis={[
            {
              label: "Inward rows",
              value: fmtNum(kpi.total),
              sub: "in window",
              icon: <PackageOpen className="h-3.5 w-3.5" />,
              trend: makeTrend(kpi.total, 12),
            },
            {
              label: "Roll GRNs",
              value: fmtNum(kpi.rollCount),
              sub: "roll receipts",
              icon: <Layers className="h-3.5 w-3.5" />,
              trend: makeTrend(kpi.rollCount, 12),
            },
            {
              label: "Bulk GRNs",
              value: fmtNum(kpi.bulkCount),
              sub: "bulk receipts",
              icon: <Warehouse className="h-3.5 w-3.5" />,
              trend: makeTrend(kpi.bulkCount, 12),
            },
            {
              label: "Packaging GRNs",
              value: fmtNum(kpi.packagingCount),
              sub: "pkg receipts",
              icon: <Package className="h-3.5 w-3.5" />,
              trend: makeTrend(kpi.packagingCount, 12),
            },
            {
              label: "Vendors",
              value: fmtNum(pulseVendorBreakdown.length),
              sub: "active suppliers",
              icon: <ShieldCheck className="h-3.5 w-3.5" />,
              trend: makeTrend(pulseVendorBreakdown.length, 12),
            },
            {
              label: "Total qty",
              value: fmtNum(kpi.totalQty, 0),
              sub: "across UoMs",
              icon: <CalendarDays className="h-3.5 w-3.5" />,
              tone: "good",
              trend: makeTrend(kpi.totalQty, 12),
            },
          ]}
          statRow={[
            {
              label: "Window",
              value:
                filters.window === "30D"
                  ? "30 days"
                  : filters.window === "7D"
                    ? "7 days"
                    : filters.window === "TODAY"
                      ? "Today"
                      : filters.window === "FY"
                        ? "This FY"
                        : "All time",
            },
            {
              label: "Plants",
              value: fmtNum(pulsePlantBreakdown.length),
              sub: "with receipts",
            },
            {
              label: "Avg / day",
              value:
                filters.window === "30D"
                  ? `${Math.round(kpi.total / 30)}`
                  : filters.window === "7D"
                    ? `${Math.round(kpi.total / 7)}`
                    : "—",
              sub: "GRNs / day",
            },
            {
              label: "Roll mix",
              value:
                kpi.total > 0
                  ? `${Math.round((kpi.rollCount / kpi.total) * 100)}%`
                  : "0%",
              sub: "of receipts",
            },
            {
              label: "Bulk mix",
              value:
                kpi.total > 0
                  ? `${Math.round((kpi.bulkCount / kpi.total) * 100)}%`
                  : "0%",
              sub: "of receipts",
            },
            {
              label: "Pkg mix",
              value:
                kpi.total > 0
                  ? `${Math.round((kpi.packagingCount / kpi.total) * 100)}%`
                  : "0%",
              sub: "of receipts",
            },
          ]}
          primaryBreakdown={{
            title: "Top vendors · qty",
            entries: pulseVendorBreakdown.slice(0, 10),
            unit: "",
          }}
          secondaryBreakdown={{
            title: "By source",
            entries: pulseSourceBreakdown,
            unit: "",
          }}
          locationBreakdown={pulsePlantBreakdown}
          matrix={pulseMatrix}
          topList={pulseTopList}
        />
      )}

      {mode === "browse" && (
        <>
          <SavedViewsBar
            views={savedViews.views}
            activeId={savedViews.activeId}
            onSelect={(v) => {
              savedViews.setActiveId(v.id);
              setFilters(v.state);
            }}
            onDelete={savedViews.deleteView}
            onTogglePin={savedViews.togglePin}
            onSave={(name) => savedViews.saveView(name, filters)}
          />

          <FilterBar
            search={filters.search}
            onSearchChange={(v) => setFilters((f) => ({ ...f, search: v }))}
            chips={chips}
            onClearAll={() => setFilters(DEFAULT_FILTERS)}
            viewMode="table"
            viewModes={["table"]}
            onExport={() =>
              window.open(
                "/api/inventory/grn/history/?format=csv",
                "_blank",
                "noopener,noreferrer",
              )
            }
          />

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
            <FilterRail>
              <FilterGroup
                label="Source"
                value={filters.source}
                onChange={(id) =>
                  setFilters((f) => ({ ...f, source: id as SourceFilter }))
                }
                options={[
                  { id: "ALL", label: "All", count: allRows.length },
                  {
                    id: "ROLL",
                    label: "🌀 Roll",
                    count: (allRows as GrnHistoryRow[]).filter(
                      (r) => r.source_type === "ROLL",
                    ).length,
                  },
                  {
                    id: "BULK",
                    label: "🧪 Bulk",
                    count: (allRows as GrnHistoryRow[]).filter(
                      (r) => r.source_type === "BULK",
                    ).length,
                  },
                  {
                    id: "PACKAGING",
                    label: "📦 Packaging",
                    count: (allRows as GrnHistoryRow[]).filter(
                      (r) => r.source_type === "PACKAGING",
                    ).length,
                  },
                  {
                    id: "TRADING",
                    label: "🛒 Trading",
                    count: (allRows as GrnHistoryRow[]).filter(
                      (r) => r.source_type === "TRADING",
                    ).length,
                  },
                ]}
              />

              <FilterGroup
                label="Time window"
                value={filters.window}
                onChange={(id) =>
                  setFilters((f) => ({ ...f, window: id as WindowFilter }))
                }
                columns={2}
                options={[
                  { id: "TODAY", label: "Today" },
                  { id: "7D", label: "7 days" },
                  { id: "30D", label: "30 days" },
                  { id: "FY", label: "This FY" },
                  { id: "ALL", label: "All time" },
                ]}
              />

              <FilterGroup
                label="Plant"
                value={filters.plant}
                onChange={(id) => setFilters((f) => ({ ...f, plant: id }))}
                options={plantOptions.map((p) => ({
                  id: p.id,
                  label: p.label,
                }))}
              />

              <div>
                <div className="mb-1.5 text-[10px] font-black uppercase tracking-wider text-content-3">
                  Vendor
                </div>
                <select
                  value={filters.vendor}
                  onChange={(e) =>
                    setFilters((f) => ({ ...f, vendor: e.target.value }))
                  }
                  className="w-full rounded-lg border border-line bg-surface-1 px-2.5 py-1.5 text-xs font-mono"
                >
                  {vendorOptions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="rounded-xl border border-order-border bg-order-bg p-3">
                <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-order-fg">
                  <ShieldCheck className="h-3 w-3" /> Correction policy
                </div>
                <p className="mt-1 text-[10px] leading-snug text-order-fg">
                  Original GRN stays locked. Corrections post an audited entry
                  with before / after / delta and reason. Year-closed GRNs are
                  read-only; corrections must be posted only in an open
                  financial year.
                </p>
              </div>
            </FilterRail>

            <main>
              <WorkspaceSection
                title="GRN history"
                eyebrow={`${sorted.length} rows · ${filters.window === "30D" ? "last 30 days" : filters.window === "ALL" ? "all time" : filters.window}`}
                tone="blue"
                icon={<PackageOpen className="h-4 w-4" />}
                actions={
                  <button
                    onClick={() =>
                      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
                    }
                    className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-2 py-1 text-[10px] font-bold text-content-2 hover:bg-line"
                  >
                    Date {sortDir === "asc" ? "▲" : "▼"}
                  </button>
                }
              >
                {grnQuery.isLoading ? (
                  <div className="p-6 text-sm text-content-3">Loading…</div>
                ) : sorted.length === 0 ? (
                  <div className="p-10 text-center">
                    <PackageOpen className="mx-auto h-8 w-8 text-content-4" />
                    <div className="mt-2 text-sm font-semibold text-content-2">
                      No GRNs match these filters
                    </div>
                    <div className="mt-1 text-xs text-content-3">
                      Try broadening the time window or clearing filters.
                    </div>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-xs">
                      <thead className="bg-surface-2 border-b border-line text-content-3">
                        <tr>
                          <th className="px-3 py-2 text-left font-bold uppercase tracking-wider">
                            Date
                          </th>
                          <th className="px-3 py-2 text-left font-bold uppercase tracking-wider">
                            Source
                          </th>
                          <th className="px-3 py-2 text-left font-bold uppercase tracking-wider">
                            Material / Ref
                          </th>
                          <th className="px-3 py-2 text-left font-bold uppercase tracking-wider">
                            Vendor
                          </th>
                          <th className="px-3 py-2 text-left font-bold uppercase tracking-wider">
                            Plant · Location
                          </th>
                          <th className="px-3 py-2 text-right font-bold uppercase tracking-wider">
                            Qty
                          </th>
                          <th className="px-3 py-2 text-right font-bold uppercase tracking-wider">
                            Action
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {sorted.slice(0, pageSize).map((row) => {
                          const yc = isYearClosed(row);
                          return (
                            <tr
                              key={`${row.source_type}-${row.source_id}`}
                              className="hover:bg-surface-2"
                            >
                              <td className="px-3 py-2 whitespace-nowrap font-mono text-[10px] text-content-3">
                                {fmtDate(row.created_at)}
                              </td>
                              <td className="px-3 py-2">
                                <span
                                  className={cn(
                                    "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase ring-1",
                                    SOURCE_TONE[row.source_type] || "",
                                  )}
                                >
                                  {SOURCE_ICON[row.source_type]}{" "}
                                  {row.source_type}
                                </span>
                              </td>
                              <td className="px-3 py-2">
                                <div className="font-bold text-content-1">
                                  {row.label_id ||
                                    row.material_name ||
                                    row.material_code ||
                                    "—"}
                                </div>
                                <div className="text-[10px] text-content-3 truncate max-w-[260px]">
                                  {row.reference || row.batch_no || "—"}
                                </div>
                                {row.has_correction ? (
                                  <div className="mt-1 inline-flex items-center gap-1 rounded-md bg-success-bg px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-success-fg ring-1 ring-success-border">
                                    <ShieldCheck className="h-3 w-3" />
                                    corrected effective
                                  </div>
                                ) : null}
                                {row.manual_po_ref ? (
                                  <div className="mt-1 inline-flex items-center gap-1 rounded-md bg-warning-bg px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-warning-fg ring-1 ring-warning-border">
                                    Manual-PO · {row.manual_po_ref}
                                  </div>
                                ) : null}
                              </td>
                              <td className="px-3 py-2 text-[11px] text-content-2">
                                {row.vendor_name || row.vendor_code || "—"}
                              </td>
                              <td className="px-3 py-2 text-[11px]">
                                <div className="font-bold text-content-2">
                                  {row.plant_name || "—"}
                                </div>
                                <div className="font-mono text-[10px] text-content-3">
                                  {row.location_name || "—"}
                                </div>
                              </td>
                              <td className="px-3 py-2 text-right">
                                <div className="font-mono font-bold text-content-1">
                                  {fmtQty(Number(row.quantity), row.uom)}
                                </div>
                                {row.has_correction &&
                                row.original_quantity !== undefined ? (
                                  <div className="font-mono text-[10px] text-content-4 line-through">
                                    {fmtQty(
                                      Number(row.original_quantity),
                                      row.uom,
                                    )}
                                  </div>
                                ) : null}
                              </td>
                              <td className="px-3 py-2 text-right">
                                {yc ? (
                                  <span className="inline-flex items-center gap-1 rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] font-bold text-content-3 ring-1 ring-line">
                                    <Lock className="h-3 w-3" /> Year-closed
                                  </span>
                                ) : row.source_type === "TRADING" ? (
                                  <span className="inline-flex items-center gap-1 rounded-md bg-warning-bg px-1.5 py-0.5 text-[10px] font-bold text-warning-fg ring-1 ring-warning-border">
                                    <ShieldCheck className="h-3 w-3" /> Direct
                                    receipt
                                  </span>
                                ) : (
                                  <button
                                    onClick={() => setSelected(row)}
                                    className="inline-flex items-center gap-1 rounded-md bg-order-bg px-2 py-0.5 text-[10px] font-bold text-order-fg ring-1 ring-order-border hover:bg-order-bg"
                                  >
                                    <Edit3 className="h-3 w-3" /> Correct
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <div className="flex items-center justify-between border-t border-line bg-surface-2 px-5 py-2 text-[11px]">
                      <span className="text-content-3">
                        Showing {Math.min(sorted.length, pageSize)} of{" "}
                        {sorted.length}
                      </span>
                      <select
                        value={pageSize}
                        onChange={(e) => setPageSize(Number(e.target.value))}
                        className="rounded-md border border-line bg-surface-1 px-2 py-0.5 font-mono text-[11px]"
                      >
                        {[25, 50, 100, 250, 500].map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </WorkspaceSection>
            </main>
          </div>
        </>
      )}

      {grnQuery.isError && (
        <div className="rounded-2xl border border-danger-border bg-danger-bg p-4 text-sm text-danger-fg">
          <div className="font-bold">Couldn&apos;t load GRN history.</div>
          <div className="mt-1 text-xs">
            {describeApiError(grnQuery.error, "Check backend and retry.")}
          </div>
        </div>
      )}

      {selected && (
        <CorrectionDrawer
          row={selected}
          onClose={() => setSelected(null)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ["grn-history"] });
            setSelected(null);
          }}
        />
      )}
    </div>
  );
}

// ─── Correction drawer ────────────────────────────────────────────

function CorrectionDrawer({
  row,
  onClose,
  onSaved,
}: {
  row: GrnHistoryRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const [quantity, setQuantity] = React.useState("");
  const [avgCost, setAvgCost] = React.useState("");
  const [reference, setReference] = React.useState("");
  const [labelId, setLabelId] = React.useState("");
  const [batchNo, setBatchNo] = React.useState("");
  const [widthMm, setWidthMm] = React.useState("");
  const [thicknessMicron, setThicknessMicron] = React.useState("");
  const [lengthM, setLengthM] = React.useState("");
  const [stockForm, setStockForm] = React.useState(row.stock_form || "");
  const [locationId, setLocationId] = React.useState(row.location || "");
  const [plantId, setPlantId] = React.useState(row.plant || "");
  const [reasonCode, setReasonCode] = React.useState("OTHER");
  const [reason, setReason] = React.useState("");
  const effectiveLineValue =
    Number(row.quantity || 0) * Number(row.avg_cost || 0);

  const plantsQuery = useQuery({
    queryKey: ["grn-correction-plants"],
    queryFn: () => factoryService.getPlants(),
    staleTime: 300_000,
  });
  const locationsQuery = useQuery({
    queryKey: ["grn-correction-locations"],
    queryFn: () => factoryService.getLocations(),
    staleTime: 300_000,
  });
  const reasonCodesQuery = useQuery({
    queryKey: ["grn-correction-reason-codes"],
    queryFn: () => inventoryService.getGrnCorrectionReasonCodes(),
    staleTime: 300_000,
  });
  const reasonCodes = reasonCodesQuery.data?.length
    ? reasonCodesQuery.data
    : [
        { code: "QTY_MISMATCH", label: "Quantity mismatch" },
        { code: "RATE_MISMATCH", label: "Rate mismatch" },
        { code: "ROLL_IDENTITY", label: "Roll identity/spec correction" },
        { code: "OTHER", label: "Other approved correction" },
      ];

  const mutation = useMutation({
    mutationFn: () => {
      const payload: GrnCorrectionPayload = {
        reason,
        reason_code: reasonCode,
        quantity: quantity.trim() ? Number(quantity) : undefined,
        avg_cost: avgCost.trim() ? Number(avgCost) : undefined,
        reference: reference.trim() || undefined,
        location:
          row.source_type !== "TRADING" &&
          locationId &&
          locationId !== row.location
            ? locationId
            : undefined,
        plant:
          row.source_type === "TRADING" && plantId && plantId !== row.plant
            ? plantId
            : undefined,
        label_id: labelId.trim() || undefined,
        batch_no: batchNo.trim() || undefined,
        width_mm: widthMm.trim() ? Number(widthMm) : undefined,
        thickness_micron: thicknessMicron.trim()
          ? Number(thicknessMicron)
          : undefined,
        length_m: lengthM.trim() ? Number(lengthM) : undefined,
        stock_form: stockForm.trim() || undefined,
      };
      return inventoryService.correctGrnHistoryRow(
        row.source_type,
        row.source_id,
        payload,
      );
    },
    onSuccess: () => {
      toast.success("GRN correction posted with audit trail.");
      queryClient.invalidateQueries({ queryKey: ["stock-lifecycle"] });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      onSaved();
    },
    onError: (err: any) => {
      toast.error(
        err?.response?.data?.error ||
          err?.response?.data?.detail ||
          err?.message ||
          "Correction failed",
      );
    },
  });

  return (
    <div className="fixed inset-0 z-40 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-surface-3/40" />
      <div
        className="relative z-50 h-full w-full max-w-lg overflow-y-auto border-l border-line bg-surface-1 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 border-b border-line bg-gradient-to-r from-order-bg via-white to-white px-5 py-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.22em] text-order-fg">
                Correct GRN row
              </div>
              <div className="font-display text-base font-bold text-content-1">
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase ring-1 align-middle mr-2",
                    SOURCE_TONE[row.source_type],
                  )}
                >
                  {SOURCE_ICON[row.source_type]} {row.source_type}
                </span>
                {row.label_id || row.material_name || row.material_code}
              </div>
              <div className="text-[11px] text-content-3 mt-0.5">
                {fmtDate(row.created_at)} · {row.vendor_name || "—"}
              </div>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-1 hover:bg-surface-2"
            >
              <X className="h-4 w-4 text-content-3" />
            </button>
          </div>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div className="rounded-xl border border-warning-border bg-warning-bg px-3 py-2.5 text-[11px] font-medium text-warning-fg flex items-start gap-2">
            <AlertTriangle className="h-3.5 w-3.5 flex-none mt-0.5" />
            <span>
              The original GRN remains locked. This action posts a correction
              entry capturing before, after, delta, user, and reason.
            </span>
          </div>

          {row.has_correction ? (
            <div className="rounded-xl border border-success-border bg-success-bg px-3 py-2 text-[11px] font-medium text-success-fg">
              This row already has an audit correction. Values below are the
              latest effective corrected values; original values stay locked in
              the audit trail.
            </div>
          ) : null}

          <div className="grid grid-cols-3 gap-2 text-[11px] rounded-xl bg-surface-2 p-3 ring-1 ring-line">
            <div>
              <div className="text-[9px] font-black uppercase text-content-3">
                Effective qty
              </div>
              <div className="font-mono font-bold text-content-1 mt-0.5">
                {fmtQty(Number(row.quantity), row.uom)}
              </div>
              {row.has_correction && row.original_quantity !== undefined ? (
                <div className="mt-0.5 font-mono text-[10px] text-content-4 line-through">
                  {fmtQty(Number(row.original_quantity), row.uom)}
                </div>
              ) : null}
            </div>
            <div>
              <div className="text-[9px] font-black uppercase text-content-3">
                Effective unit rate
              </div>
              <div className="font-mono font-bold text-content-1 mt-0.5">
                {row.avg_cost ? row.avg_cost.toFixed(2) : "—"}
              </div>
              {row.has_correction && row.original_avg_cost !== undefined ? (
                <div className="mt-0.5 font-mono text-[10px] text-content-4 line-through">
                  {Number(row.original_avg_cost).toFixed(2)}
                </div>
              ) : null}
            </div>
            <div>
              <div className="text-[9px] font-black uppercase text-content-3">
                Line value
              </div>
              <div className="font-mono font-bold text-content-1 mt-0.5">
                {fmtMoney(effectiveLineValue)}
              </div>
              <div className="mt-0.5 truncate font-mono text-[10px] text-content-3">
                {row.reference || row.batch_no || "—"}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-[10px] font-bold uppercase tracking-wider text-content-3">
                Corrected quantity
              </Label>
              <Input
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder={String(row.quantity || 0)}
                type="number"
                step="0.001"
                className="mt-1 h-9 text-sm"
              />
            </div>
            <div>
              <Label className="text-[10px] font-bold uppercase tracking-wider text-content-3">
                Corrected unit rate
              </Label>
              <Input
                value={avgCost}
                onChange={(e) => setAvgCost(e.target.value)}
                placeholder={String(row.avg_cost || 0)}
                type="number"
                step="0.01"
                disabled={row.source_type === "ROLL"}
                className="mt-1 h-9 text-sm"
              />
              <div className="mt-1 text-[10px] font-medium text-content-3">
                Per {row.uom || "unit"} rate, not total invoice value.
              </div>
            </div>
            <div className="col-span-2">
              <Label className="text-[10px] font-bold uppercase tracking-wider text-content-3">
                Reference
              </Label>
              <Input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder={row.reference || "Reference"}
                className="mt-1 h-9 text-sm"
              />
            </div>
            {row.source_type === "TRADING" ? (
              <div className="col-span-2">
                <Label className="text-[10px] font-bold uppercase tracking-wider text-content-3">
                  Corrected plant
                </Label>
                <select
                  value={plantId}
                  onChange={(e) => setPlantId(e.target.value)}
                  className="mt-1 h-9 w-full rounded-md border border-line bg-surface-1 px-3 text-sm"
                >
                  <option value="">Keep current plant</option>
                  {(plantsQuery.data || []).map((plant) => (
                    <option key={plant.id} value={plant.id}>
                      {plant.code} · {plant.name}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="col-span-2">
                <Label className="text-[10px] font-bold uppercase tracking-wider text-content-3">
                  Corrected location
                </Label>
                <select
                  value={locationId}
                  onChange={(e) => setLocationId(e.target.value)}
                  className="mt-1 h-9 w-full rounded-md border border-line bg-surface-1 px-3 text-sm"
                >
                  <option value="">Keep current location</option>
                  {(locationsQuery.data || [])
                    .filter((location) => location.is_active !== false)
                    .map((location) => (
                      <option key={location.id} value={location.id}>
                        {location.plant_name || location.plant} ·{" "}
                        {location.code} · {location.name}
                      </option>
                    ))}
                </select>
                <div className="mt-1 text-[10px] font-medium text-content-3">
                  Changing location posts an audited stock transfer; it does not
                  rewrite the original GRN.
                </div>
              </div>
            )}
            {row.source_type === "ROLL" && (
              <>
                <div>
                  <Label className="text-[10px] font-bold uppercase tracking-wider text-content-3">
                    Label ID
                  </Label>
                  <Input
                    value={labelId}
                    onChange={(e) => setLabelId(e.target.value)}
                    placeholder={row.label_id || "Label"}
                    className="mt-1 h-9 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-[10px] font-bold uppercase tracking-wider text-content-3">
                    Batch No
                  </Label>
                  <Input
                    value={batchNo}
                    onChange={(e) => setBatchNo(e.target.value)}
                    placeholder={row.batch_no || "Batch"}
                    className="mt-1 h-9 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-[10px] font-bold uppercase tracking-wider text-content-3">
                    Width mm
                  </Label>
                  <Input
                    value={widthMm}
                    onChange={(e) => setWidthMm(e.target.value)}
                    placeholder={String(row.width_mm || "")}
                    type="number"
                    step="0.01"
                    className="mt-1 h-9 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-[10px] font-bold uppercase tracking-wider text-content-3">
                    Micron
                  </Label>
                  <Input
                    value={thicknessMicron}
                    onChange={(e) => setThicknessMicron(e.target.value)}
                    placeholder={String(row.thickness_micron || "")}
                    type="number"
                    step="0.01"
                    className="mt-1 h-9 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-[10px] font-bold uppercase tracking-wider text-content-3">
                    Length m
                  </Label>
                  <Input
                    value={lengthM}
                    onChange={(e) => setLengthM(e.target.value)}
                    placeholder="Length"
                    type="number"
                    step="0.01"
                    className="mt-1 h-9 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-[10px] font-bold uppercase tracking-wider text-content-3">
                    Roll form
                  </Label>
                  <select
                    value={stockForm}
                    onChange={(e) => setStockForm(e.target.value)}
                    className="mt-1 h-9 w-full rounded-md border border-line bg-surface-1 px-3 text-sm"
                  >
                    <option value="">Keep current</option>
                    <option value="OPEN_WEB">Open web / sheet</option>
                    <option value="LAYFLAT_TUBE">Lay-flat tube</option>
                    <option value="FOLDED_WEB">Folded web</option>
                  </select>
                </div>
              </>
            )}
          </div>
          <div>
            <Label className="text-[10px] font-bold uppercase tracking-wider text-content-3">
              Reason code · required
            </Label>
            <select
              value={reasonCode}
              onChange={(e) => setReasonCode(e.target.value)}
              className="mt-1 h-9 w-full rounded-md border border-line bg-surface-1 px-3 text-sm"
            >
              {reasonCodes.map((code) => (
                <option key={code.code} value={code.code}>
                  {code.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label className="text-[10px] font-bold uppercase tracking-wider text-content-3">
              Reason · required
            </Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Explain why this inward correction is needed."
              className="mt-1 text-sm"
              rows={3}
            />
            {!reason.trim() ? (
              <div className="mt-1 flex items-center gap-1 text-[11px] font-semibold text-warning-fg">
                <AlertTriangle className="h-3.5 w-3.5" />
                Reason is required before this correction can post.
              </div>
            ) : null}
          </div>
          <div className="flex justify-end gap-2 pt-2 border-t border-line">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={!reason.trim() || !reasonCode || mutation.isPending}
              onClick={() => mutation.mutate()}
              className="bg-order-fg hover:bg-order-fg"
            >
              <CheckCircle2 className="mr-2 h-4 w-4" />
              {mutation.isPending ? "Posting…" : "Post correction"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

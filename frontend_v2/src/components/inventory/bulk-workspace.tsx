"use client";

/**
 * V3.6 Bulk Workspace
 *
 * Full bulk inventory workspace for granules, chemicals, adhesives, solvents,
 * inks held in bulk form. Filter by material family, granule, location, plant,
 * status, expiry. Charts: stock by material donut, plant split bar, reorder
 * coverage matrix. Saved views, table/grid views, detail drawer with
 * reservations.
 */

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  BarChart3,
  Boxes,
  Eye,
  Factory,
  FlaskConical,
  Layers,
  MapPin,
  Plus,
  X,
} from "lucide-react";

import { GradientHero } from "@/components/erp/gradient-hero";
import { cn } from "@/lib/utils";
import { describeApiError } from "@/lib/api";
import { inventoryService } from "@/services/inventory";
import {
  FilterBar,
  FilterGroup,
  FilterRail,
  KpiTileV36,
  MultiSelectPills,
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

type ViewMode = "table" | "grid";

interface BulkFilterState {
  search: string;
  plant: string;
  location: string;
  materialFamilies: string[];
  colors: string[];
  materialClass:
    | "ALL"
    | "GRANULE"
    | "CHEMICAL"
    | "ADHESIVE"
    | "SOLVENT"
    | "INK"
    | "OTHER";
  onlyReserved: boolean;
  onlyAddons: boolean;
}

const DEFAULT_FILTERS: BulkFilterState = {
  search: "",
  plant: "ALL",
  location: "ALL",
  materialFamilies: [],
  colors: [],
  materialClass: "ALL",
  onlyReserved: false,
  onlyAddons: false,
};

const DEFAULT_VIEWS: SavedView<BulkFilterState>[] = [
  {
    id: "all-bulk",
    name: "All bulk",
    icon: "🧪",
    pinned: true,
    state: DEFAULT_FILTERS,
  },
  {
    id: "reserved",
    name: "Has reservation",
    icon: "🔒",
    state: { ...DEFAULT_FILTERS, onlyReserved: true },
  },
];

function fmtNum(n: number, max = 0): string {
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: max,
  }).format(n);
}

function stockUom(row: any, fallback = "KG"): string {
  return String(
    row?.uom || row?.stock_uom || row?.base_uom || fallback,
  ).toUpperCase();
}

function qtyDecimalsForUom(uom: string): number {
  return uom === "KG" ? 3 : uom === "METER" ? 1 : 0;
}

function formatStockQty(qty: number, row: any, fallback = "KG"): string {
  const uom = stockUom(row, fallback);
  return `${fmtNum(qty, qtyDecimalsForUom(uom))} ${uom}`;
}

function displayPlant(row: any): string {
  return String(row?.plant_name || row?.plant_code || row?.plant_id || "Unassigned plant");
}

function displayLocation(row: any): string {
  return String(
    row?.location_code ||
      row?.location_name ||
      row?.location ||
      row?.location_id ||
      "Unassigned location",
  );
}

function rowQty(row: any): number {
  return Number(row?.qty_kg ?? row?.on_hand_qty ?? row?.qty ?? 0) || 0;
}

function formatQtyByUom(qty: number, uom: string): string {
  const normalized = String(uom || "KG").toUpperCase();
  return `${fmtNum(qty, qtyDecimalsForUom(normalized))} ${normalized}`;
}

function mixedTotals(
  rows: any[],
  valueOf: (row: any) => number = rowQty,
): Array<{ uom: string; value: number }> {
  const map = new Map<string, number>();
  for (const row of rows) {
    const uom = stockUom(row);
    map.set(uom, (map.get(uom) || 0) + valueOf(row));
  }
  const order = ["KG", "METER", "PCS"];
  return Array.from(map.entries())
    .filter(([, value]) => Math.abs(value) > 0.000001)
    .sort((a, b) => {
      const ai = order.indexOf(a[0]);
      const bi = order.indexOf(b[0]);
      if (ai !== -1 || bi !== -1)
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      return a[0].localeCompare(b[0]);
    })
    .map(([uom, value]) => ({ uom, value }));
}

function formatMixedTotals(
  rows: any[],
  valueOf: (row: any) => number = rowQty,
  fallback = "0",
): string {
  const totals = mixedTotals(rows, valueOf);
  if (!totals.length) return fallback;
  return totals.map(({ uom, value }) => formatQtyByUom(value, uom)).join(" + ");
}

// Addon detection must be explicit. Inks, adhesives and solvents are bulk
// inventory by default; they only get the ADDON badge when the add-on master
// marks them as purchased add-ons for GRN/consumption.
function isAddon(row: any): boolean {
  const category = String(
    row.material_category || row.category || row.material_class || "",
  ).toUpperCase();
  if (row.purchased_addon === true) return true;
  if (category === "ADDON" && row.addon_is_purchased === true) return true;
  if (
    category === "ADDON" &&
    row.is_addon === true &&
    row.addon_is_purchased === true
  )
    return true;
  return false;
}

function stockCode(row: any): string {
  return String(
    row?.granule_quality_code ||
      row?.granule_quality_code_code ||
      row?.granule_code ||
      row?.batch_no ||
      row?.lot_no ||
      row?.vendor_lot_ref ||
      "—",
  );
}

function colorLabel(row: any): string {
  const direct = String(
    row.color ||
      row.colour ||
      row.color_name ||
      row.colour_name ||
      row.ink_color ||
      row.shade ||
      row.shade_name ||
      row.color_code ||
      "",
  ).trim();
  if (direct) return direct.toUpperCase();
  const hay = String(
    `${row.material_code || ""} ${row.material_name || ""}`,
  ).toUpperCase();
  const known = [
    "BLACK",
    "WHITE",
    "RED",
    "BLUE",
    "GREEN",
    "YELLOW",
    "CYAN",
    "MAGENTA",
    "ORANGE",
    "VIOLET",
    "PURPLE",
    "GOLD",
    "SILVER",
  ];
  return known.find((name) => hay.includes(name)) || "";
}

function classifyMaterial(
  row: any,
): "GRANULE" | "CHEMICAL" | "ADHESIVE" | "SOLVENT" | "INK" | "OTHER" {
  const k = String(
    row.material_class ||
      row.category ||
      row.material_code ||
      row.material_name ||
      "",
  ).toUpperCase();
  if (/GRANULE|RESIN|PE|PET|HDPE|LDPE|PP|BOPP/i.test(k)) return "GRANULE";
  if (/INK|PIGMENT|COLOR/i.test(k)) return "INK";
  if (/ADHESIVE|GLUE/i.test(k)) return "ADHESIVE";
  if (/SOLVENT|THINNER/i.test(k)) return "SOLVENT";
  if (/CHEM|ACID|ALK/i.test(k)) return "CHEMICAL";
  return "OTHER";
}

export function BulkWorkspaceV36() {
  const [filters, setFilters] =
    React.useState<BulkFilterState>(DEFAULT_FILTERS);
  const [mode, setMode] = React.useState<"pulse" | "browse">("pulse");
  const [viewMode, setViewMode] = React.useState<ViewMode>("table");
  const [selected, setSelected] = React.useState<any | null>(null);
  const [pageSize, setPageSize] = React.useState(50);
  const savedViews = useSavedViews<BulkFilterState>("bulk", DEFAULT_VIEWS);

  const stockQuery = useQuery({
    queryKey: ["inventory-bulk"],
    queryFn: () => inventoryService.getInventorySnapshot(),
    staleTime: 30_000,
  });

  const allRows: any[] = React.useMemo(
    () => stockQuery.data?.bulk || [],
    [stockQuery.data],
  );

  const materialFamilies = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const r of allRows) {
      const k = String(r.material_code || r.material_name || "").trim();
      if (!k) continue;
      map.set(k, (map.get(k) || 0) + 1);
    }
    return Array.from(map.entries())
      .map(([id, count]) => ({ id, label: id, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 50);
  }, [allRows]);

  const colorOptions = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const r of allRows) {
      const k = colorLabel(r);
      if (!k) continue;
      map.set(k, (map.get(k) || 0) + 1);
    }
    return Array.from(map.entries())
      .map(([id, count]) => ({ id, label: id, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 40);
  }, [allRows]);

  const plantOptions = React.useMemo(() => {
    const map = new Map<string, string>();
    map.set("ALL", "All plants");
    for (const r of allRows) {
      const id = String(r.plant_id || r.plant || "");
      if (id) map.set(id, r.plant_name || id);
    }
    return Array.from(map.entries()).map(([id, label]) => ({ id, label }));
  }, [allRows]);

  const locationOptions = React.useMemo(() => {
    const map = new Map<string, { label: string; count: number }>();
    map.set("ALL", { label: "All locations", count: allRows.length });
    for (const r of allRows) {
      const id = String(r.location || r.location_id || r.location_code || "");
      if (!id) continue;
      const cur = map.get(id) || {
        label: r.location_code || r.location_name || id,
        count: 0,
      };
      map.set(id, { label: cur.label, count: cur.count + 1 });
    }
    return Array.from(map.entries()).map(([id, v]) => ({
      id,
      label: v.label,
      count: v.count,
    }));
  }, [allRows]);

  const filtered = React.useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    return allRows.filter((r: any) => {
      if (q) {
        const hay = [
          r.material_code,
          r.material_name,
          stockCode(r),
          r.location_code,
          r.location_name,
          r.vendor_name,
          r.grade,
        ].some((v) =>
          String(v || "")
            .toLowerCase()
            .includes(q),
        );
        if (!hay) return false;
      }
      if (
        filters.plant !== "ALL" &&
        String(r.plant_id || r.plant || "") !== filters.plant
      )
        return false;
      if (filters.location !== "ALL") {
        const loc = String(
          r.location || r.location_id || r.location_code || "",
        );
        if (loc !== filters.location) return false;
      }
      if (
        filters.materialFamilies.length > 0 &&
        !filters.materialFamilies.includes(
          String(r.material_code || r.material_name || ""),
        )
      )
        return false;
      if (filters.colors.length > 0 && !filters.colors.includes(colorLabel(r)))
        return false;
      if (
        filters.materialClass !== "ALL" &&
        classifyMaterial(r) !== filters.materialClass
      )
        return false;
      if (filters.onlyReserved && Number(r.reserved_qty || 0) <= 0)
        return false;
      if (filters.onlyAddons && !isAddon(r)) return false;
      return true;
    });
  }, [allRows, filters]);

  const kpi = React.useMemo(() => {
    const totalQty = filtered.reduce((s: number, r: any) => s + rowQty(r), 0);
    const reservedQty = filtered.reduce(
      (s: number, r: any) => s + Number(r.reserved_qty || 0),
      0,
    );
    const addons = filtered.filter((r: any) => isAddon(r)).length;
    const granules = filtered.filter(
      (r: any) => classifyMaterial(r) === "GRANULE",
    ).length;
    const totalDisplay = formatMixedTotals(filtered);
    const reservedDisplay = formatMixedTotals(
      filtered,
      (r) => Number(r.reserved_qty || 0),
      "0",
    );
    const availableDisplay = formatMixedTotals(
      filtered,
      (r) => Math.max(0, rowQty(r) - Number(r.reserved_qty || 0)),
      "0",
    );
    return {
      totalLots: filtered.length,
      totalQty,
      reservedQty,
      availableQty: totalQty - reservedQty,
      totalDisplay,
      reservedDisplay,
      availableDisplay,
      addons,
      granules,
    };
  }, [filtered]);

  // Material breakdown for donut
  const materialBreakdown = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const r of filtered) {
      const cls = classifyMaterial(r);
      const key = `${cls} · ${stockUom(r)}`;
      map.set(key, (map.get(key) || 0) + rowQty(r));
    }
    const total = Array.from(map.values()).reduce((s, v) => s + v, 0) || 1;
    const COLORS: Record<string, string> = {
      GRANULE: "#3b82f6",
      INK: "#a855f7",
      ADHESIVE: "#f59e0b",
      SOLVENT: "#06b6d4",
      CHEMICAL: "#ec4899",
      OTHER: "#94a3b8",
    };
    return Array.from(map.entries()).map(([k, v]) => ({
      key: k,
      kg: v,
      pct: (v / total) * 100,
      color: COLORS[k.split(" · ", 1)[0]] || "#94a3b8",
    }));
  }, [filtered]);

  // Plant split for bar
  const plantSplit = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const r of filtered) {
      const k = `${displayPlant(r)} · ${stockUom(r)}`;
      map.set(k, (map.get(k) || 0) + rowQty(r));
    }
    const total = Array.from(map.values()).reduce((s, v) => s + v, 0) || 1;
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([k, v]) => ({ name: k, kg: v, pct: (v / total) * 100 }));
  }, [filtered]);

  const chips = React.useMemo(() => {
    const list: { key: string; label: string; onClear: () => void }[] = [];
    if (filters.search)
      list.push({
        key: "search",
        label: `"${filters.search}"`,
        onClear: () => setFilters((f) => ({ ...f, search: "" })),
      });
    if (filters.plant !== "ALL")
      list.push({
        key: "plant",
        label: `Plant`,
        onClear: () => setFilters((f) => ({ ...f, plant: "ALL" })),
      });
    if (filters.location !== "ALL")
      list.push({
        key: "loc",
        label: `Location`,
        onClear: () => setFilters((f) => ({ ...f, location: "ALL" })),
      });
    if (filters.materialFamilies.length)
      list.push({
        key: "mf",
        label: `Codes · ${filters.materialFamilies.length}`,
        onClear: () => setFilters((f) => ({ ...f, materialFamilies: [] })),
      });
    if (filters.colors.length)
      list.push({
        key: "colors",
        label: `Colors · ${filters.colors.length}`,
        onClear: () => setFilters((f) => ({ ...f, colors: [] })),
      });
    if (filters.materialClass !== "ALL")
      list.push({
        key: "cls",
        label: `Class · ${filters.materialClass}`,
        onClear: () => setFilters((f) => ({ ...f, materialClass: "ALL" })),
      });
    if (filters.onlyReserved)
      list.push({
        key: "rsv",
        label: "Reserved only",
        onClear: () => setFilters((f) => ({ ...f, onlyReserved: false })),
      });
    if (filters.onlyAddons)
      list.push({
        key: "ado",
        label: "Purchased add-ons",
        onClear: () => setFilters((f) => ({ ...f, onlyAddons: false })),
      });
    return list;
  }, [filters]);

  // Pulse-mode breakdowns (unconditional — must run before early return)
  const pulseMaterialBreakdown = materialBreakdown.map((m: any) => ({
    label: m.key,
    value: m.kg,
    color: m.color,
  }));
  const pulsePlantBreakdown = plantSplit.map((p: any) => ({
    label: p.name,
    value: p.kg,
  }));
  const pulseLocationBreakdown = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const r of filtered as any[]) {
      const k = displayLocation(r);
      const key = `${k} · ${stockUom(r)}`;
      map.set(key, (map.get(key) || 0) + rowQty(r));
    }
    return Array.from(map.entries())
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
  }, [filtered]);
  const pulseAgeing = React.useMemo(() => {
    let fresh = 0,
      aged = 0,
      old = 0;
    for (const r of filtered as any[]) {
      const d = Number(r.age_days || 0);
      if (d <= 30) fresh += 1;
      else if (d <= 90) aged += 1;
      else old += 1;
    }
    return { fresh, aged, old };
  }, [filtered]);

  // Matrix: material class × plant, split by the material stock UOM.
  const pulseMatrix = React.useMemo(() => {
    const cellMap: Record<string, Record<string, number>> = {};
    const rowSet = new Set<string>();
    const colSet = new Set<string>();
    for (const r of filtered as any[]) {
      const cls = classifyMaterial(r);
      const rowKey = `${cls} · ${stockUom(r)}`;
      const plant = displayPlant(r);
      rowSet.add(rowKey);
      colSet.add(plant);
      cellMap[rowKey] = cellMap[rowKey] || {};
      cellMap[rowKey][plant] = (cellMap[rowKey][plant] || 0) + rowQty(r);
    }
    return {
      title: "Material class × plant",
      subtitle: "Concentration heatmap",
      rowLabel: "class",
      colLabel: "plant",
      rows: Array.from(rowSet).sort(),
      cols: Array.from(colSet).sort(),
      cells: cellMap,
      unit: "",
    };
  }, [filtered]);

  // Top materials list (with addon flag in sub)
  const pulseTopList = React.useMemo(() => {
    const map = new Map<
      string,
      { qty: number; addon: boolean; cls: string; uom: string }
    >();
    for (const r of filtered as any[]) {
      const k = String(r.material_code || r.material_name || "—");
      const uom = stockUom(r);
      const key = `${k}__${uom}`;
      const cur = map.get(key) || {
        qty: 0,
        addon: false,
        cls: classifyMaterial(r),
        uom,
      };
      cur.qty += rowQty(r);
      cur.addon = cur.addon || isAddon(r);
      map.set(key, cur);
    }
    const rows = Array.from(map.entries())
      .sort((a, b) => b[1].qty - a[1].qty)
      .slice(0, 8)
      .map(([label, v]) => ({
        label: label.split("__")[0],
        sub: `${v.cls}${v.addon ? " · addon" : ""}`,
        value: formatQtyByUom(v.qty, v.uom),
        tone: v.addon ? ("warn" as const) : ("default" as const),
      }));
    return {
      title: "Top materials by stock",
      subtitle: "Split by inventory UOM",
      rows,
    };
  }, [filtered]);

  if (stockQuery.isError) {
    return (
      <div className="rounded-2xl border border-danger-border bg-danger-bg p-5 text-sm text-danger-fg">
        <div className="font-bold">Could not load bulk inventory.</div>
        <div className="mt-1 text-xs">
          {describeApiError(stockQuery.error, "Check backend and retry.")}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-12">
      <ClassTabBar tabs={INVENTORY_CLASS_TABS} activeId="bulk" />
      <GradientHero
        eyebrow="Inventory · V3.6 · bulk"
        title="Bulk &amp; chemicals"
        subtitle="Granules, inks, adhesives, solvents, chemicals — all stock rows filterable by material code, plant, location, and class."
        palette="emerald"
        chips={[
          {
            icon: <FlaskConical className="h-3.5 w-3.5" />,
            label: "Rows",
            value: `${kpi.totalLots}`,
            tone: "ok",
          },
          {
            icon: <Layers className="h-3.5 w-3.5" />,
            label: "Stock",
            value: kpi.totalDisplay,
            tone: "violet",
          },
          {
            icon: <Boxes className="h-3.5 w-3.5" />,
            label: "Add-ons",
            value: `${kpi.addons}`,
            tone: "warn",
          },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Link
              href="/inventory/grn"
              className="inline-flex items-center gap-1.5 rounded-xl bg-surface-1 px-4 py-1.5 text-xs font-bold text-success-fg shadow-md hover:bg-success-bg"
            >
              <Plus className="h-3.5 w-3.5" /> Receive bulk
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
            ? "Pulse · KPIs and breakdowns"
            : "Browse · full table / grid"}
        </span>
      </div>

      {mode === "pulse" && (
        <PulseViewV36
          kpis={[
            {
              label: "Stock rows",
              value: fmtNum(kpi.totalLots),
              sub: "current rows",
              icon: <FlaskConical className="h-3.5 w-3.5" />,
            },
            {
              label: "On hand",
              value: kpi.totalDisplay,
              sub: `${kpi.reservedDisplay} reserved`,
              icon: <Layers className="h-3.5 w-3.5" />,
              tone: "good",
            },
            {
              label: "Available",
              value: kpi.availableDisplay,
              sub: "free to issue",
              icon: <Layers className="h-3.5 w-3.5" />,
              tone: "good",
            },
            {
              label: "Granules",
              value: fmtNum(kpi.granules),
              sub: "resin code rows",
              icon: <FlaskConical className="h-3.5 w-3.5" />,
            },
            {
              label: "Purchased add-ons",
              value: fmtNum(kpi.addons),
              sub: "meter / pcs capable",
              icon: <Boxes className="h-3.5 w-3.5" />,
            },
            {
              label: "Reserved",
              value: kpi.reservedDisplay,
              sub: "sales holds",
              icon: <Layers className="h-3.5 w-3.5" />,
              tone: kpi.reservedQty > 0 ? "warn" : "default",
            },
          ]}
          statRow={[
            {
              label: "Material classes",
              value: fmtNum(pulseMaterialBreakdown.length),
              sub: "distinct types",
            },
            {
              label: "Plants",
              value: fmtNum(pulsePlantBreakdown.length),
              sub: "with stock",
            },
            {
              label: "Locations",
              value: fmtNum(pulseLocationBreakdown.length),
              sub: "warehouses",
            },
            {
              label: "Stock UOMs",
              value: fmtNum(mixedTotals(filtered).length),
              sub: "units represented",
            },
            {
              label: "Reserved %",
              value:
                kpi.totalQty > 0
                  ? `${Math.round((kpi.reservedQty / kpi.totalQty) * 100)}%`
                  : "0%",
              sub: "same-UOM estimate",
              tone: kpi.reservedQty > 0 ? "warn" : "default",
            },
            {
              label: "Add-ons",
              value: fmtNum(kpi.addons),
              sub: "purchased add-on rows",
              tone: "good",
            },
          ]}
          primaryBreakdown={{
            title: "Material class · stock UOM",
            entries: pulseMaterialBreakdown,
            unit: "",
          }}
          secondaryBreakdown={{
            title: "Plant allocation · stock UOM",
            entries: pulsePlantBreakdown,
            unit: "",
          }}
          ageing={pulseAgeing}
          locationBreakdown={pulseLocationBreakdown}
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
            viewMode={viewMode}
            onViewModeChange={(v) => setViewMode(v as ViewMode)}
            viewModes={["table", "grid"]}
            onExport={() =>
              window.open(
                inventoryService.getInventoryExportUrl("bulk"),
                "_blank",
                "noopener,noreferrer",
              )
            }
          />

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
            <FilterRail>
              {materialFamilies.length > 0 && (
                <MultiSelectPills
                  label="Material code / family"
                  options={materialFamilies}
                  selected={filters.materialFamilies}
                  onChange={(v) =>
                    setFilters((f) => ({ ...f, materialFamilies: v }))
                  }
                />
              )}

              {colorOptions.length > 0 && (
                <MultiSelectPills
                  label="Ink / color shade"
                  options={colorOptions}
                  selected={filters.colors}
                  onChange={(v) => setFilters((f) => ({ ...f, colors: v }))}
                />
              )}

              <FilterGroup
                label="Material class"
                value={filters.materialClass}
                onChange={(id) =>
                  setFilters((f) => ({ ...f, materialClass: id as any }))
                }
                options={[
                  { id: "ALL", label: "All" },
                  {
                    id: "GRANULE",
                    label: "Granules / resin",
                    count: allRows.filter(
                      (r) => classifyMaterial(r) === "GRANULE",
                    ).length,
                  },
                  {
                    id: "INK",
                    label: "Inks / pigment",
                    count: allRows.filter((r) => classifyMaterial(r) === "INK")
                      .length,
                  },
                  {
                    id: "ADHESIVE",
                    label: "Adhesives",
                    count: allRows.filter(
                      (r) => classifyMaterial(r) === "ADHESIVE",
                    ).length,
                  },
                  {
                    id: "SOLVENT",
                    label: "Solvents",
                    count: allRows.filter(
                      (r) => classifyMaterial(r) === "SOLVENT",
                    ).length,
                  },
                  {
                    id: "CHEMICAL",
                    label: "Chemicals",
                    count: allRows.filter(
                      (r) => classifyMaterial(r) === "CHEMICAL",
                    ).length,
                  },
                  {
                    id: "OTHER",
                    label: "Other",
                    count: allRows.filter(
                      (r) => classifyMaterial(r) === "OTHER",
                    ).length,
                  },
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
                  Location
                </div>
                <select
                  value={filters.location}
                  onChange={(e) =>
                    setFilters((f) => ({ ...f, location: e.target.value }))
                  }
                  className="w-full rounded-lg border border-line bg-surface-1 px-2.5 py-1.5 text-xs font-mono"
                >
                  {locationOptions.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.label}
                      {typeof l.count === "number" ? ` · ${l.count}` : ""}
                    </option>
                  ))}
                </select>
              </div>

              <label className="flex items-center gap-2 rounded-lg bg-order-bg px-2.5 py-1.5 ring-1 ring-order-border text-[11px] font-bold text-order-fg cursor-pointer">
                <input
                  type="checkbox"
                  checked={filters.onlyReserved}
                  onChange={(e) =>
                    setFilters((f) => ({
                      ...f,
                      onlyReserved: e.target.checked,
                    }))
                  }
                  className="accent-order-fg"
                />
                Show only reserved rows
              </label>
              <label className="flex items-center gap-2 rounded-lg bg-order-bg px-2.5 py-1.5 ring-1 ring-order-border text-[11px] font-bold text-order-fg cursor-pointer">
                <input
                  type="checkbox"
                  checked={filters.onlyAddons}
                  onChange={(e) =>
                    setFilters((f) => ({ ...f, onlyAddons: e.target.checked }))
                  }
                  className="accent-order-fg"
                />
                Purchased add-ons only
              </label>
              <div className="rounded-xl border border-success-border bg-success-bg p-3">
                <div className="text-[10px] font-black uppercase tracking-wider text-success-fg">
                  Addon badge rule
                </div>
                <p className="mt-1 text-[10px] leading-snug text-success-fg">
                  Only purchased add-ons from the Add-on Master get the{" "}
                  <span className="rounded-sm bg-order-bg px-1 py-0.5 font-mono font-black text-order-fg ring-1 ring-order-border">
                    ADDON
                  </span>{" "}
                  badge. Regular inks, adhesives and solvents remain normal bulk
                  stock.
                </p>
              </div>
            </FilterRail>

            <main>
              {viewMode === "table" ? (
                <BulkTable
                  rows={filtered.slice(0, pageSize)}
                  total={filtered.length}
                  pageSize={pageSize}
                  onPageSize={setPageSize}
                  loading={stockQuery.isLoading}
                  onSelect={setSelected}
                />
              ) : (
                <BulkGrid
                  rows={filtered.slice(0, pageSize)}
                  total={filtered.length}
                  pageSize={pageSize}
                  onPageSize={setPageSize}
                  loading={stockQuery.isLoading}
                  onSelect={setSelected}
                />
              )}
            </main>
          </div>
        </>
      )}

      {selected && (
        <BulkDrawer row={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

function DonutChart({
  data,
}: {
  data: Array<{ key: string; pct: number; color: string; kg: number }>;
}) {
  const r = 36;
  const c = 2 * Math.PI * r;
  let acc = 0;
  const total = data.reduce((s, d) => s + d.pct, 0) || 1;
  return (
    <svg width="110" height="110" viewBox="0 0 110 110">
      <circle
        cx="55"
        cy="55"
        r={r}
        fill="none"
        stroke="#f1f5f9"
        strokeWidth="16"
      />
      {data.map((d, i) => {
        const len = (d.pct / total) * c;
        const off = -acc;
        acc += len;
        return (
          <circle
            key={i}
            cx="55"
            cy="55"
            r={r}
            fill="none"
            stroke={d.color}
            strokeWidth="16"
            strokeDasharray={`${len} ${c - len}`}
            strokeDashoffset={off}
            transform="rotate(-90 55 55)"
          />
        );
      })}
      <text
        x="55"
        y="51"
        textAnchor="middle"
        className="fill-content-1"
        style={{ fontSize: 16, fontWeight: 800 }}
      >
        {data
          .reduce((s, d) => s + d.kg, 0)
          .toLocaleString(undefined, { maximumFractionDigits: 0 })}
      </text>
      <text
        x="55"
        y="64"
        textAnchor="middle"
        className="fill-content-3"
        style={{ fontSize: 9, fontWeight: 700, letterSpacing: 1.2 }}
      >
        TOTAL
      </text>
    </svg>
  );
}

function BulkTable({
  rows,
  total,
  pageSize,
  onPageSize,
  loading,
  onSelect,
}: {
  rows: any[];
  total: number;
  pageSize: number;
  onPageSize: (n: number) => void;
  loading: boolean;
  onSelect: (r: any) => void;
}) {
  if (loading) return <Skel />;
  if (rows.length === 0) return <Empty />;
  return (
    <WorkspaceSection
      title="Bulk stock rows"
      eyebrow={`${rows.length} of ${total} shown`}
      tone="emerald"
      icon={<Boxes className="h-4 w-4" />}
    >
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead className="bg-surface-2 border-b border-line text-content-3">
            <tr>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wider">
                Material
              </th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wider">
                Class
              </th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wider">
                Plant · Location
              </th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wider">
                Code
              </th>
              <th className="px-3 py-2 text-right font-bold uppercase tracking-wider">
                On hand
              </th>
              <th className="px-3 py-2 text-right font-bold uppercase tracking-wider">
                Reserved
              </th>
              <th className="px-3 py-2 text-right font-bold uppercase tracking-wider">
                Available
              </th>
              <th className="px-3 py-2 text-right font-bold uppercase tracking-wider">
                Action
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r: any, i: number) => {
              const onhand = rowQty(r);
              const reserved = Number(r.reserved_qty || 0);
              const available = Math.max(0, onhand - reserved);
              const cls = classifyMaterial(r);
              const addon = isAddon(r);
              return (
                <tr
                  key={r.id || i}
                  onClick={() => onSelect(r)}
                  className="hover:bg-success-bg cursor-pointer"
                >
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono font-bold text-content-1">
                        {r.material_code || r.code || "—"}
                      </span>
                      {addon && (
                        <span className="rounded-sm bg-order-bg px-1 py-0.5 text-[9px] font-black text-order-fg ring-1 ring-order-border">
                          ADDON
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-content-3 truncate max-w-[200px]">
                      {r.material_name || ""}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] font-bold text-content-2 ring-1 ring-line">
                      {cls}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-[11px]">
                    <div className="font-bold text-content-2">
                      {displayPlant(r)}
                    </div>
                    <div className="font-mono text-[10px] text-content-3">
                      {displayLocation(r)}
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] font-black text-content-2">
                    {stockCode(r)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-bold text-content-1">
                    {formatStockQty(onhand, r)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-bold text-order-fg">
                    {formatStockQty(reserved, r)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-bold text-success-fg">
                    {formatStockQty(available, r)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect(r);
                      }}
                      className="inline-flex items-center gap-0.5 rounded-md bg-success-bg px-1.5 py-0.5 text-[10px] font-bold text-success-fg ring-1 ring-success-border hover:bg-success-bg"
                    >
                      <Eye className="h-3 w-3" /> View
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between border-t border-line bg-surface-2 px-5 py-2 text-[11px]">
        <span className="text-content-3">
          Showing {rows.length} of {total}
        </span>
        <select
          value={pageSize}
          onChange={(e) => onPageSize(Number(e.target.value))}
          className="rounded-md border border-line bg-surface-1 px-2 py-0.5 font-mono text-[11px]"
        >
          {[25, 50, 100, 250, 500].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
    </WorkspaceSection>
  );
}

function BulkGrid({
  rows,
  total,
  pageSize,
  onPageSize,
  loading,
  onSelect,
}: {
  rows: any[];
  total: number;
  pageSize: number;
  onPageSize: (n: number) => void;
  loading: boolean;
  onSelect: (r: any) => void;
}) {
  if (loading) return <Skel />;
  if (rows.length === 0) return <Empty />;
  return (
    <WorkspaceSection
      title="Bulk cards"
      eyebrow={`${rows.length} of ${total}`}
      tone="emerald"
      icon={<Boxes className="h-4 w-4" />}
    >
      <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((r: any) => {
          const onhand = rowQty(r);
          const reserved = Number(r.reserved_qty || 0);
          const addon = isAddon(r);
          return (
            <button
              key={r.id}
              onClick={() => onSelect(r)}
              className="text-left rounded-2xl border border-line bg-surface-1 p-3 shadow-sm hover:shadow-md hover:border-success-border"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1">
                    <span className="font-mono text-xs font-bold text-success-fg truncate">
                      {r.material_code || "—"}
                    </span>
                    {addon && (
                      <span className="rounded-sm bg-order-bg px-1 py-0.5 text-[8px] font-black text-order-fg ring-1 ring-order-border">
                        ADDON
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-content-3 truncate">
                    {r.material_name || ""}
                  </div>
                </div>
                <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[9px] font-bold uppercase text-content-2 ring-1 ring-line">
                  {stockCode(r)}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-1.5 rounded-lg bg-surface-2 p-2 text-center">
                <div>
                  <div className="text-[8px] font-black uppercase text-content-3">
                    On hand
                  </div>
                  <div className="font-mono text-sm font-bold text-content-1">
                    {formatStockQty(onhand, r)}
                  </div>
                </div>
                <div>
                  <div className="text-[8px] font-black uppercase text-content-3">
                    Reserved
                  </div>
                  <div className="font-mono text-sm font-bold text-order-fg">
                    {formatStockQty(reserved, r)}
                  </div>
                </div>
                <div>
                  <div className="text-[8px] font-black uppercase text-content-3">
                    Free
                  </div>
                  <div className="font-mono text-sm font-bold text-success-fg">
                    {formatStockQty(Math.max(0, onhand - reserved), r)}
                  </div>
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between text-[10px]">
                <span className="font-mono text-content-3">
                  <MapPin className="inline-block h-3 w-3 mr-0.5 -mt-0.5" />
                  {displayLocation(r)}
                </span>
                <span className="font-mono text-content-3">
                  {displayPlant(r)}
                </span>
              </div>
            </button>
          );
        })}
      </div>
      <div className="flex items-center justify-between border-t border-line bg-surface-2 px-5 py-2 text-[11px]">
        <span className="text-content-3">
          Showing {rows.length} of {total}
        </span>
        <select
          value={pageSize}
          onChange={(e) => onPageSize(Number(e.target.value))}
          className="rounded-md border border-line bg-surface-1 px-2 py-0.5 font-mono text-[11px]"
        >
          {[24, 48, 96, 200].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
    </WorkspaceSection>
  );
}

function BulkDrawer({ row, onClose }: { row: any; onClose: () => void }) {
  const onhand = rowQty(row);
  const reserved = Number(row.reserved_qty || 0);
  const available = Math.max(0, onhand - reserved);
  const cls = classifyMaterial(row);
  const rsvQuery = useQuery({
    queryKey: ["inv-reservations-bulk", row.id],
    queryFn: () =>
      inventoryService.getInventoryReservations({
        ref_id: row.id,
        ref_type: "BULK",
      }),
    enabled: Boolean(row.id),
    staleTime: 30_000,
  });
  return (
    <div className="fixed inset-0 z-40 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-surface-3/40" />
      <div
        className="relative z-50 h-full w-full max-w-md overflow-y-auto border-l border-line bg-surface-1 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 border-b border-line bg-gradient-to-r from-success-bg via-white to-white px-5 py-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[10px] font-black uppercase tracking-[0.22em] text-success-fg">
                Bulk stock row
              </div>
              <div className="font-mono font-display text-lg font-bold text-content-1 truncate">
                {row.material_code || "—"}
              </div>
              <div className="text-[11px] text-content-3 truncate">
                {row.material_name || ""}
              </div>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-1 hover:bg-surface-2"
            >
              <X className="h-4 w-4 text-content-3" />
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="rounded-md bg-surface-2 px-2 py-0.5 text-[10px] font-bold text-content-2 ring-1 ring-line">
              {cls}
            </span>
            <span className="rounded-md bg-success-bg px-2 py-0.5 text-[10px] font-bold uppercase text-success-fg ring-1 ring-success-border">
              {stockUom(row)}
            </span>
          </div>
        </div>
        <div className="px-5 py-4 space-y-4">
          <div className="grid grid-cols-3 gap-2 text-[11px]">
            <Stat label="On hand" value={formatStockQty(onhand, row)} />
            <Stat
              label="Reserved"
              value={formatStockQty(reserved, row)}
              tone="violet"
            />
            <Stat
              label="Available"
              value={formatStockQty(available, row)}
              tone="emerald"
            />
          </div>
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-content-3 mb-2">
              Code details
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <Field label="Code" value={stockCode(row)} />
              <Field label="Grade" value={row.grade || "—"} />
              <Field label="Vendor" value={row.vendor_name || "—"} />
              <Field label="UOM" value={stockUom(row)} />
              <Field
                label="Plant"
                value={displayPlant(row)}
                icon={<Factory className="h-3 w-3 text-success-fg" />}
              />
              <Field
                label="Location"
                value={displayLocation(row)}
                icon={<MapPin className="h-3 w-3 text-success-fg" />}
              />
              <Field label="Expiry" value={row.expiry_date || "—"} />
              <Field
                label="Age"
                value={row.age_days ? `${Math.floor(row.age_days)} d` : "—"}
              />
            </div>
          </div>
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-order-fg mb-2">
              Sales reservations
            </div>
            {rsvQuery.isLoading && (
              <div className="text-xs text-content-4 italic">Loading…</div>
            )}
            {!rsvQuery.isLoading && (rsvQuery.data || []).length === 0 && (
              <div className="text-xs text-content-4 italic">
                No active reservations.
              </div>
            )}
            {(rsvQuery.data || []).map((r: any, i: number) => (
              <div
                key={i}
                className="rounded-xl border border-order-border bg-order-bg px-3 py-2 mb-1.5"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[11px] font-bold text-order-fg">
                    {r.so_no || r.so_id || "—"}
                  </span>
                  <span className="font-mono text-[11px] font-bold text-content-2">
                    {formatStockQty(Number(r.qty || 0), row)}
                  </span>
                </div>
                <div className="text-[10px] text-content-3 mt-0.5">
                  {r.customer_name || ""} · promise {r.promise_date || "—"}
                </div>
              </div>
            ))}
          </div>
          <div className="pt-2 border-t border-line">
            <Link
              href={`/inventory/stock-lifecycle?tab=snapshots&material=${row.material || row.id || ""}`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-success-fg px-3 py-1.5 text-[11px] font-bold text-white hover:bg-success-fg"
            >
              Stock card <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "slate",
}: {
  label: string;
  value: string;
  tone?: "slate" | "violet" | "emerald";
}) {
  const TONE = {
    slate: "bg-surface-2 text-content-1 ring-line",
    violet: "bg-order-bg text-order-fg ring-order-border",
    emerald: "bg-success-bg text-success-fg ring-success-border",
  }[tone];
  return (
    <div className={cn("rounded-lg px-2.5 py-1.5 ring-1", TONE)}>
      <div className="text-[9px] font-black uppercase tracking-wider opacity-70">
        {label}
      </div>
      <div className="mt-0.5 font-display text-sm font-bold">{value}</div>
    </div>
  );
}

function Field({
  label,
  value,
  icon,
}: {
  label: string;
  value: any;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg bg-surface-2 px-2.5 py-1.5 ring-1 ring-line">
      <div className="text-[9px] font-black uppercase tracking-wider text-content-3">
        {label}
      </div>
      <div className="mt-0.5 flex items-center gap-1 text-xs font-bold text-content-2 truncate">
        {icon}
        {value || "—"}
      </div>
    </div>
  );
}

function Skel() {
  return (
    <div className="rounded-2xl border border-line bg-surface-1 p-5 shadow-sm">
      <div className="h-4 w-40 animate-pulse rounded bg-line" />
      <div className="mt-3 h-32 animate-pulse rounded-xl bg-surface-2" />
    </div>
  );
}

function Empty() {
  return (
    <div className="rounded-2xl border-2 border-dashed border-line bg-surface-1 p-10 text-center">
      <Boxes className="mx-auto h-8 w-8 text-content-4" />
      <div className="mt-2 text-sm font-semibold text-content-2">
        No bulk stock rows match these filters
      </div>
      <div className="mt-1 text-xs text-content-3">
        Adjust filters or clear search to see more.
      </div>
    </div>
  );
}

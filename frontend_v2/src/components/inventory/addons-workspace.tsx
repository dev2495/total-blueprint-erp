"use client";

/**
 * V3.6 Add-ons Workspace
 *
 * Inks, adhesives, solvents, miscellaneous chemicals — items that ride along
 * with rolls but live in bulk lots. Pulls bulk snapshot and filters down to
 * non-granule classes. Color swatch view + table.
 */

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Beaker,
  Droplets,
  Eye,
  Factory,
  MapPin,
  Palette,
  Plus,
  Sparkles,
  X,
} from "lucide-react";

import { GradientHero } from "@/components/erp/gradient-hero";
import { cn } from "@/lib/utils";
import { describeApiError } from "@/lib/api";
import { colorHexFromName } from "@/lib/color-utils";
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
type Family = "ALL" | "INK" | "ADHESIVE" | "SOLVENT" | "CHEMICAL" | "OTHER";

interface AddonsFilterState {
  search: string;
  plant: string;
  location: string;
  family: Family;
  materials: string[];
  healthBucket: "ALL" | "HEALTHY" | "LOW" | "CRITICAL";
}

const DEFAULT_FILTERS: AddonsFilterState = {
  search: "",
  plant: "ALL",
  location: "ALL",
  family: "ALL",
  materials: [],
  healthBucket: "ALL",
};

const DEFAULT_VIEWS: SavedView<AddonsFilterState>[] = [
  {
    id: "all-addons",
    name: "All add-ons",
    icon: "🎨",
    pinned: true,
    state: DEFAULT_FILTERS,
  },
  {
    id: "inks",
    name: "Inks",
    icon: "🖌️",
    state: { ...DEFAULT_FILTERS, family: "INK" },
  },
  {
    id: "adhesives",
    name: "Adhesives",
    icon: "🧪",
    state: { ...DEFAULT_FILTERS, family: "ADHESIVE" },
  },
  {
    id: "solvents",
    name: "Solvents",
    icon: "💧",
    state: { ...DEFAULT_FILTERS, family: "SOLVENT" },
  },
  {
    id: "low-stock",
    name: "Low stock",
    icon: "⚠️",
    state: { ...DEFAULT_FILTERS, healthBucket: "LOW" },
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
  return Number(row?.qty ?? row?.qty_kg ?? row?.on_hand_qty ?? 0);
}

function formatQtyByUom(qty: number, uom: string): string {
  const normalized = String(uom || "").toUpperCase();
  return `${fmtNum(qty, qtyDecimalsForUom(normalized))} ${normalized}`.trim();
}

function mixedTotals(
  rows: any[],
  valueOf: (row: any) => number = rowQty,
): { uom: string; qty: number }[] {
  const map = new Map<string, number>();
  for (const row of rows) {
    const uom = stockUom(row, "UNIT");
    map.set(uom, (map.get(uom) || 0) + valueOf(row));
  }
  return Array.from(map.entries())
    .map(([uom, qty]) => ({ uom, qty }))
    .filter((entry) => Math.abs(entry.qty) > 0.000001)
    .sort((a, b) => b.qty - a.qty);
}

function formatMixedTotals(
  rows: any[],
  valueOf?: (row: any) => number,
  fallback = "0",
): string {
  const totals = mixedTotals(rows, valueOf);
  if (totals.length === 0) return fallback;
  if (totals.length <= 2)
    return totals
      .map((entry) => formatQtyByUom(entry.qty, entry.uom))
      .join(" + ");
  const [first, second] = totals;
  return `${formatQtyByUom(first.qty, first.uom)} + ${formatQtyByUom(second.qty, second.uom)} + ${totals.length - 2} UOMs`;
}

function detectFamily(row: any): Exclude<Family, "ALL"> {
  const k = String(
    row.material_class ||
      row.category ||
      row.material_code ||
      row.material_name ||
      "",
  ).toUpperCase();
  if (/INK|PIGMENT|COLOR/.test(k)) return "INK";
  if (/ADHESIVE|GLUE/.test(k)) return "ADHESIVE";
  if (/SOLVENT|THINNER/.test(k)) return "SOLVENT";
  if (/CHEM|ACID|ALK/.test(k)) return "CHEMICAL";
  if (/GRANULE|RESIN|PE\b|PET\b|HDPE|LDPE|PP\b|BOPP/.test(k)) return "OTHER";
  return "OTHER";
}

function healthOf(row: any): {
  score: number;
  bucket: "HEALTHY" | "LOW" | "CRITICAL";
} {
  const onhand = rowQty(row);
  const reorder = Number(row.reorder_point || 50);
  const score =
    onhand > reorder * 2
      ? 100
      : Math.max(
          0,
          Math.min(100, Math.round((onhand / Math.max(reorder, 1)) * 50)),
        );
  const bucket = score >= 60 ? "HEALTHY" : score >= 30 ? "LOW" : "CRITICAL";
  return { score, bucket };
}

const FAMILY_ICON: Record<string, string> = {
  INK: "🖌️",
  ADHESIVE: "🧪",
  SOLVENT: "💧",
  CHEMICAL: "⚗️",
  OTHER: "🧴",
};

export function AddonsWorkspaceV36() {
  const [filters, setFilters] =
    React.useState<AddonsFilterState>(DEFAULT_FILTERS);
  const [mode, setMode] = React.useState<"pulse" | "browse">("pulse");
  const [viewMode, setViewMode] = React.useState<ViewMode>("grid");
  const [selected, setSelected] = React.useState<any | null>(null);
  const [pageSize, setPageSize] = React.useState(48);
  const savedViews = useSavedViews<AddonsFilterState>("addons", DEFAULT_VIEWS);

  const stockQuery = useQuery({
    queryKey: ["inventory-addons"],
    queryFn: () => inventoryService.getInventorySnapshot(),
    staleTime: 30_000,
  });

  const allRows: any[] = React.useMemo(() => {
    const bulk = stockQuery.data?.bulk || [];
    // Show only non-granule items (inks, adhesives, solvents, chemicals)
    return bulk.filter((r) => {
      const f = detectFamily(r);
      return (
        f !== "OTHER" || /INK|ADH|SOL|CHEM/.test(String(r.material_code || ""))
      );
    });
  }, [stockQuery.data]);

  const materialOptions = React.useMemo(() => {
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
          r.lot_no,
          r.location_code,
          r.location_name,
          r.vendor_name,
          r.color_name,
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
      if (filters.family !== "ALL" && detectFamily(r) !== filters.family)
        return false;
      if (
        filters.materials.length > 0 &&
        !filters.materials.includes(
          String(r.material_code || r.material_name || ""),
        )
      )
        return false;
      if (
        filters.healthBucket !== "ALL" &&
        healthOf(r).bucket !== filters.healthBucket
      )
        return false;
      return true;
    });
  }, [allRows, filters]);

  const kpi = React.useMemo(() => {
    const totalQty = filtered.reduce((s: number, r: any) => s + rowQty(r), 0);
    const reservedKg = filtered.reduce(
      (s: number, r: any) => s + Number(r.reserved_qty || 0),
      0,
    );
    const totalDisplay = formatMixedTotals(filtered, rowQty);
    const reservedDisplay = formatMixedTotals(filtered, (r) =>
      Number(r.reserved_qty || 0),
    );
    const inks = filtered.filter((r) => detectFamily(r) === "INK").length;
    const adhesives = filtered.filter(
      (r) => detectFamily(r) === "ADHESIVE",
    ).length;
    const solvents = filtered.filter(
      (r) => detectFamily(r) === "SOLVENT",
    ).length;
    const critical = filtered.filter(
      (r: any) => healthOf(r).bucket === "CRITICAL",
    ).length;
    return {
      items: filtered.length,
      totalQty,
      reservedKg,
      totalDisplay,
      reservedDisplay,
      inks,
      adhesives,
      solvents,
      critical,
    };
  }, [filtered]);

  const chips = React.useMemo(() => {
    const list: { key: string; label: string; onClear: () => void }[] = [];
    if (filters.search)
      list.push({
        key: "s",
        label: `"${filters.search}"`,
        onClear: () => setFilters((f) => ({ ...f, search: "" })),
      });
    if (filters.family !== "ALL")
      list.push({
        key: "fam",
        label: `Family · ${filters.family}`,
        onClear: () => setFilters((f) => ({ ...f, family: "ALL" })),
      });
    if (filters.plant !== "ALL")
      list.push({
        key: "p",
        label: `Plant`,
        onClear: () => setFilters((f) => ({ ...f, plant: "ALL" })),
      });
    if (filters.location !== "ALL")
      list.push({
        key: "l",
        label: `Location`,
        onClear: () => setFilters((f) => ({ ...f, location: "ALL" })),
      });
    if (filters.materials.length)
      list.push({
        key: "m",
        label: `Materials · ${filters.materials.length}`,
        onClear: () => setFilters((f) => ({ ...f, materials: [] })),
      });
    if (filters.healthBucket !== "ALL")
      list.push({
        key: "h",
        label: `Health · ${filters.healthBucket}`,
        onClear: () => setFilters((f) => ({ ...f, healthBucket: "ALL" })),
      });
    return list;
  }, [filters]);

  // Pulse breakdowns (must be unconditional — called before early return)
  const pulseFamilyBreakdown = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const r of filtered as any[]) {
      const k = `${detectFamily(r)} · ${stockUom(r, "UNIT")}`;
      map.set(k, (map.get(k) || 0) + rowQty(r));
    }
    return Array.from(map.entries())
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
  }, [filtered]);
  const pulseMaterialBreakdown = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const r of filtered as any[]) {
      const k = `${String(r.material_code || r.material_name || "—")} · ${stockUom(r, "UNIT")}`;
      map.set(k, (map.get(k) || 0) + rowQty(r));
    }
    return Array.from(map.entries())
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
  }, [filtered]);
  const pulseLocationBreakdown = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const r of filtered as any[]) {
      const k = `${displayLocation(r)} · ${stockUom(r, "UNIT")}`;
      map.set(k, (map.get(k) || 0) + rowQty(r));
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

  // Matrix: family × plant
  const pulseMatrix = React.useMemo(() => {
    const cellMap: Record<string, Record<string, number>> = {};
    const rowSet = new Set<string>();
    const colSet = new Set<string>();
    for (const r of filtered as any[]) {
      const fam = `${detectFamily(r)} · ${stockUom(r, "UNIT")}`;
      const plant = displayPlant(r);
      rowSet.add(fam);
      colSet.add(plant);
      cellMap[fam] = cellMap[fam] || {};
      cellMap[fam][plant] = (cellMap[fam][plant] || 0) + rowQty(r);
    }
    return {
      title: "Family × plant",
      subtitle: "Where each addon family lives by stock UOM",
      rowLabel: "family",
      colLabel: "plant",
      rows: Array.from(rowSet).sort(),
      cols: Array.from(colSet).sort(),
      cells: cellMap,
      unit: "",
    };
  }, [filtered]);

  const pulseTopList = React.useMemo(() => {
    const rows = pulseMaterialBreakdown.slice(0, 8).map((m) => ({
      label: m.label,
      sub: "addon stock",
      value: formatQtyByUom(m.value, m.label.split(" · ").pop() || ""),
    }));
    return {
      title: "Top materials by stock",
      subtitle: "Most-stocked add-ons by their own UOM",
      rows,
    };
  }, [pulseMaterialBreakdown]);

  if (stockQuery.isError) {
    return (
      <div className="rounded-2xl border border-danger-border bg-danger-bg p-5 text-sm text-danger-fg">
        <div className="font-bold">Could not load add-ons.</div>
        <div className="mt-1 text-xs">
          {describeApiError(stockQuery.error, "Check backend.")}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-12">
      <ClassTabBar tabs={INVENTORY_CLASS_TABS} activeId="addons" />
      <GradientHero
        eyebrow="Inventory · add-ons"
        title="Inks · adhesives · solvents"
        subtitle="Process consumables that ride along with rolls — colour-coded for inks, lot-tracked for adhesives, expiry-aware for solvents."
        palette="violet"
        chips={[
          {
            icon: <Palette className="h-3.5 w-3.5" />,
            label: "Items",
            value: `${kpi.items}`,
            tone: "ok",
          },
          {
            icon: <Droplets className="h-3.5 w-3.5" />,
            label: "Stock",
            value: kpi.totalDisplay,
            tone: "violet",
          },
          {
            icon: <AlertTriangle className="h-3.5 w-3.5" />,
            label: "Critical",
            value: `${kpi.critical}`,
            tone: "warn",
          },
        ]}
        actions={
          <div className="flex items-center gap-2">
            <Link
              href="/inventory/grn"
              className="inline-flex items-center gap-1.5 rounded-xl bg-surface-1 px-4 py-1.5 text-xs font-bold text-order-fg shadow-md hover:bg-order-bg"
            >
              <Plus className="h-3.5 w-3.5" /> Receive add-ons
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
            ? "Pulse · family + colour mix"
            : "Browse · cards / table"}
        </span>
      </div>

      {mode === "pulse" && (
        <PulseViewV36
          kpis={[
            {
              label: "Items",
              value: fmtNum(kpi.items),
              sub: "add-on lots",
              icon: <Palette className="h-3.5 w-3.5" />,
            },
            {
              label: "Total stock",
              value: kpi.totalDisplay,
              sub: `${kpi.reservedDisplay} reserved`,
              tone: "good",
            },
            {
              label: "Inks",
              value: fmtNum(kpi.inks),
              sub: "colour pigments",
              icon: <Palette className="h-3.5 w-3.5" />,
            },
            {
              label: "Adhesives",
              value: fmtNum(kpi.adhesives),
              sub: "bonding agents",
              icon: <Beaker className="h-3.5 w-3.5" />,
            },
            {
              label: "Solvents",
              value: fmtNum(kpi.solvents),
              sub: "thinners",
              icon: <Droplets className="h-3.5 w-3.5" />,
            },
            {
              label: "Critical",
              value: fmtNum(kpi.critical),
              sub: "below reorder",
              icon: <AlertTriangle className="h-3.5 w-3.5" />,
              tone: kpi.critical > 0 ? "bad" : "default",
            },
          ]}
          statRow={[
            {
              label: "Families",
              value: fmtNum(pulseFamilyBreakdown.length),
              sub: "ink/adh/solv/chem",
            },
            {
              label: "Materials",
              value: fmtNum(pulseMaterialBreakdown.length),
              sub: "distinct codes",
            },
            {
              label: "Locations",
              value: fmtNum(pulseLocationBreakdown.length),
              sub: "warehouses",
            },
            {
              label: "Stock UOMs",
              value: fmtNum(mixedTotals(filtered).length),
              sub: "active units",
            },
            {
              label: "Reserved",
              value: kpi.reservedDisplay,
              sub: "same-UOM total",
              tone: kpi.reservedKg > 0 ? "warn" : "default",
            },
            {
              label: "Healthy",
              value:
                kpi.items > 0
                  ? `${Math.round(((kpi.items - kpi.critical) / kpi.items) * 100)}%`
                  : "100%",
              sub: "of items",
              tone: "good",
            },
          ]}
          primaryBreakdown={{
            title: "By family · stock UOM",
            entries: pulseFamilyBreakdown,
            unit: "",
          }}
          secondaryBreakdown={{
            title: "Top materials",
            entries: pulseMaterialBreakdown.slice(0, 10),
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
                inventoryService.getInventoryExportUrl("addons"),
                "_blank",
                "noopener,noreferrer",
              )
            }
          />

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
            <FilterRail>
              <FilterGroup
                label="Family"
                value={filters.family}
                onChange={(id) =>
                  setFilters((f) => ({ ...f, family: id as Family }))
                }
                options={[
                  { id: "ALL", label: "All" },
                  {
                    id: "INK",
                    label: "Inks 🖌️",
                    count: allRows.filter((r) => detectFamily(r) === "INK")
                      .length,
                  },
                  {
                    id: "ADHESIVE",
                    label: "Adhesives 🧪",
                    count: allRows.filter((r) => detectFamily(r) === "ADHESIVE")
                      .length,
                  },
                  {
                    id: "SOLVENT",
                    label: "Solvents 💧",
                    count: allRows.filter((r) => detectFamily(r) === "SOLVENT")
                      .length,
                  },
                  {
                    id: "CHEMICAL",
                    label: "Chemicals ⚗️",
                    count: allRows.filter((r) => detectFamily(r) === "CHEMICAL")
                      .length,
                  },
                  {
                    id: "OTHER",
                    label: "Other",
                    count: allRows.filter((r) => detectFamily(r) === "OTHER")
                      .length,
                  },
                ]}
              />
              <FilterGroup
                label="Health"
                value={filters.healthBucket}
                onChange={(id) =>
                  setFilters((f) => ({ ...f, healthBucket: id as any }))
                }
                options={[
                  { id: "ALL", label: "All" },
                  { id: "HEALTHY", label: "Healthy ✅" },
                  { id: "LOW", label: "Low ⚠️" },
                  { id: "CRITICAL", label: "Critical 🔥" },
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
              {materialOptions.length > 0 && (
                <MultiSelectPills
                  label="Material code"
                  options={materialOptions}
                  selected={filters.materials}
                  onChange={(v) => setFilters((f) => ({ ...f, materials: v }))}
                />
              )}
            </FilterRail>

            <main>
              {viewMode === "table" ? (
                <AddonsTable
                  rows={filtered.slice(0, pageSize)}
                  total={filtered.length}
                  pageSize={pageSize}
                  onPageSize={setPageSize}
                  loading={stockQuery.isLoading}
                  onSelect={setSelected}
                />
              ) : (
                <AddonsGrid
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
        <AddonDrawer row={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

function AddonsTable({
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
      title="Add-on items"
      eyebrow={`${rows.length} of ${total}`}
      tone="violet"
      icon={<Beaker className="h-4 w-4" />}
    >
      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead className="bg-surface-2 border-b border-line text-content-3">
            <tr>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wider">
                Item
              </th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wider">
                Family
              </th>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wider">
                Plant · Loc
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
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wider">
                Health
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
              const f = detectFamily(r);
              const h = healthOf(r);
              const isInk = f === "INK";
              const swatch = isInk
                ? colorHexFromName(
                    String(
                      r.color_name || r.material_name || r.material_code || "",
                    ),
                  )
                : null;
              return (
                <tr
                  key={r.id || i}
                  onClick={() => onSelect(r)}
                  className="hover:bg-order-bg cursor-pointer"
                >
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      {swatch && (
                        <span
                          className="h-4 w-4 rounded-sm ring-1 ring-line-strong"
                          style={{ backgroundColor: swatch }}
                        />
                      )}
                      <div>
                        <div className="font-mono font-bold text-content-1">
                          {r.material_code || "—"}
                        </div>
                        <div className="text-[10px] text-content-3 truncate max-w-[200px]">
                          {r.material_name || ""}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <span className="rounded-md bg-order-bg px-1.5 py-0.5 text-[10px] font-bold text-order-fg ring-1 ring-order-border">
                      {FAMILY_ICON[f]} {f}
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
                  <td className="px-3 py-2 text-right font-mono font-bold text-content-1">
                    {formatStockQty(onhand, r)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-bold text-order-fg">
                    {formatStockQty(reserved, r)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-bold text-success-fg">
                    {formatStockQty(available, r)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-14 rounded-full bg-line overflow-hidden">
                        <div
                          className={cn(
                            "h-full",
                            h.bucket === "HEALTHY"
                              ? "bg-success-fg"
                              : h.bucket === "LOW"
                                ? "bg-warning-fg"
                                : "bg-danger-solid",
                          )}
                          style={{ width: `${h.score}%` }}
                        />
                      </div>
                      <span
                        className={cn(
                          "rounded-md px-1.5 py-0.5 text-[10px] font-bold",
                          h.bucket === "HEALTHY"
                            ? "bg-success-bg text-success-fg"
                            : h.bucket === "LOW"
                              ? "bg-warning-bg text-warning-fg"
                              : "bg-danger-bg text-danger-fg",
                        )}
                      >
                        {h.score}%
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect(r);
                      }}
                      className="inline-flex items-center gap-0.5 rounded-md bg-order-bg px-1.5 py-0.5 text-[10px] font-bold text-order-fg ring-1 ring-order-border hover:bg-order-bg"
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
          {[25, 50, 100, 250].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
    </WorkspaceSection>
  );
}

function AddonsGrid({
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
      title="Add-on cards"
      eyebrow={`${rows.length} of ${total}`}
      tone="violet"
      icon={<Palette className="h-4 w-4" />}
    >
      <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {rows.map((r: any) => {
          const onhand = rowQty(r);
          const reserved = Number(r.reserved_qty || 0);
          const f = detectFamily(r);
          const h = healthOf(r);
          const isInk = f === "INK";
          const swatch = isInk
            ? colorHexFromName(
                String(
                  r.color_name || r.material_name || r.material_code || "",
                ),
              )
            : null;
          return (
            <button
              key={r.id}
              onClick={() => onSelect(r)}
              className="text-left rounded-2xl border border-line bg-surface-1 p-3 shadow-sm hover:shadow-lg hover:border-order-border"
            >
              <div className="flex items-start justify-between gap-2">
                {swatch ? (
                  <span
                    className="h-9 w-9 rounded-xl ring-2 ring-surface-1 shadow-md"
                    style={{ backgroundColor: swatch }}
                  />
                ) : (
                  <span className="text-2xl">{FAMILY_ICON[f]}</span>
                )}
                <span
                  className={cn(
                    "rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase",
                    h.bucket === "HEALTHY"
                      ? "bg-success-bg text-success-fg"
                      : h.bucket === "LOW"
                        ? "bg-warning-bg text-warning-fg"
                        : "bg-danger-bg text-danger-fg",
                  )}
                >
                  {h.bucket}
                </span>
              </div>
              <div className="mt-2 font-mono text-xs font-bold text-content-1 truncate">
                {r.material_code || "—"}
              </div>
              <div className="text-[10px] text-content-3 truncate">
                {r.material_name || ""}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1.5 rounded-lg bg-surface-2 p-2 text-center">
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
                    Free
                  </div>
                  <div className="font-mono text-sm font-bold text-success-fg">
                    {formatStockQty(Math.max(0, onhand - reserved), r)}
                  </div>
                </div>
              </div>
              <div className="mt-2 text-[10px] text-content-3">
                <MapPin className="inline-block h-3 w-3 mr-0.5 -mt-0.5" />
                {displayLocation(r)}
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

function AddonDrawer({ row, onClose }: { row: any; onClose: () => void }) {
  const onhand = rowQty(row);
  const reserved = Number(row.reserved_qty || 0);
  const available = Math.max(0, onhand - reserved);
  const f = detectFamily(row);
  const isInk = f === "INK";
  const swatch = isInk
    ? colorHexFromName(
        String(row.color_name || row.material_name || row.material_code || ""),
      )
    : null;
  const rsvQuery = useQuery({
    queryKey: ["inv-reservations-addon", row.id],
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
        <div className="sticky top-0 z-10 border-b border-line bg-gradient-to-r from-order-bg via-white to-white px-5 py-4">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-3 min-w-0">
              {swatch ? (
                <span
                  className="h-10 w-10 flex-none rounded-xl ring-2 ring-surface-1 shadow-md"
                  style={{ backgroundColor: swatch }}
                />
              ) : (
                <span className="text-3xl">{FAMILY_ICON[f]}</span>
              )}
              <div className="min-w-0">
                <div className="text-[10px] font-black uppercase tracking-[0.22em] text-order-fg">
                  {FAMILY_ICON[f]} {f}
                </div>
                <div className="font-mono font-display text-lg font-bold text-content-1 truncate">
                  {row.material_code || "—"}
                </div>
                <div className="text-[11px] text-content-3 truncate">
                  {row.material_name || ""}
                </div>
              </div>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-1 hover:bg-surface-2"
            >
              <X className="h-4 w-4 text-content-3" />
            </button>
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-[11px]">
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
        </div>
        <div className="px-5 py-4 space-y-4">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-content-3 mb-2">
              Lot details
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <Field label="Lot #" value={row.lot_no || "—"} />
              <Field label="Vendor" value={row.vendor_name || "—"} />
              <Field
                label="Plant"
                value={displayPlant(row)}
                icon={<Factory className="h-3 w-3 text-order-fg" />}
              />
              <Field
                label="Location"
                value={displayLocation(row)}
                icon={<MapPin className="h-3 w-3 text-order-fg" />}
              />
              <Field label="Color" value={row.color_name || "—"} />
              <Field label="Expiry" value={row.expiry_date || "—"} />
            </div>
          </div>
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-order-fg mb-2">
              Allocations
            </div>
            {rsvQuery.isLoading && (
              <div className="text-xs text-content-4 italic">Loading…</div>
            )}
            {!rsvQuery.isLoading && (rsvQuery.data || []).length === 0 && (
              <div className="text-xs text-content-4 italic">
                No active allocations.
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
                  {r.customer_name || ""} · {r.promise_date || "—"}
                </div>
              </div>
            ))}
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
      <Sparkles className="mx-auto h-8 w-8 text-content-4" />
      <div className="mt-2 text-sm font-semibold text-content-2">
        No add-ons match these filters
      </div>
      <div className="mt-1 text-xs text-content-3">
        Adjust filters or clear search.
      </div>
    </div>
  );
}

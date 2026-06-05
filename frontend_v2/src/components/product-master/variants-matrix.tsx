"use client";

/**
 * V3.7 Variants matrix — mockup-aligned pivot matrix with sticky live BOM rail.
 *
 * Layout (matrix mode):
 * ┌─ Toolbar (Matrix · Cards · Table · Compare(N)) · X×Y picker · Search · Columns · Export
 * ├─ Saved view chips (All · saved filters · + Save current)
 * ├─ Active filter pills row
 * ├──── grid ──────────────────────────────────────────────────────
 * │ matrix card (size × thickness, click cell = select, ring = selected) │ live BOM rail
 * │ density legend, per-thickness totals, compare bar │ (sticky, runs previewBom)
 *
 * Card / Table modes drop the rail and full-width the list. The drawer overlay
 * is removed — the live rail replaces it on the right side.
 *
 * No new service methods. Uses `productMasterService.previewBom` only.
 */

import * as React from "react";
import {
  Boxes,
  ChevronDown,
  Columns3,
  Download,
  LayoutGrid,
  Rows3,
  Search,
  Star,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import {
  productMasterService,
  type VariantAxisDef,
  type ProductVariant,
  type PreviewBomResult,
  type ProductMaster,
} from "@/services/product-master";
import { LiveBomRail } from "@/components/erp/live-bom-rail";

type ViewMode = "matrix" | "cards" | "table";
type SavedView = { id: string; label: string; filters: AxisFilter[] };
type AxisFilter = { axis: string; values: string[] };

export interface VariantsMatrixV37Props {
  productMasterId: string;
  rows: ProductVariant[];
  axes: VariantAxisDef[];
  /** Optional renderer for the cards mode — preserves the existing card UI when provided. */
  renderCards?: () => React.ReactNode;
  /** Optional master flags so the live rail can show resolved-on-order placeholders. */
  master?: ProductMaster;
  /** Template route steps to render at top of the rail */
  routeSteps?: Array<{
    index: number;
    name: string;
    process_code?: string;
    transition?: string;
    has_artwork?: boolean;
  }>;
  templateName?: string;
}

function axisValueOf(row: ProductVariant, axis: string): string {
  const v = row?.axis_values?.[axis];
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "object") {
    const candidate =
      (v as any).code || (v as any).value || (v as any).label || "";
    return candidate ? String(candidate) : JSON.stringify(v);
  }
  return String(v);
}

function uniqueAxisValues(rows: ProductVariant[], axis: string): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    const v = axisValueOf(r, axis);
    if (v) set.add(v);
  }
  return Array.from(set).sort((a, b) => {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    return a.localeCompare(b);
  });
}

function fmtAxisLabel(a: VariantAxisDef): string {
  return a.label || String(a.axis);
}

function unitWeightOf(row: ProductVariant): number | null {
  const g = row?.geometry_snapshot || {};
  if (typeof g.unit_weight_g === "number") return g.unit_weight_g;
  // Fallback rough estimate. Prefer the same consumed-web basis used by the
  // backend when the variant snapshot carries child-web metadata.
  const web = Number(
    g.consumption_web_width_mm ||
      g.film_area_width_mm ||
      g.child_target_width_mm ||
      g.target_child_width_mm ||
      0,
  );
  const pitch = Number(g.consumption_pitch_mm || 0);
  const w = Number(g.width_mm);
  const h = Number(g.height_mm);
  const t = Number(g.thickness_um);
  if (!Number.isFinite(t) || t <= 0) return null;
  if (Number.isFinite(web) && web > 0 && Number.isFinite(pitch) && pitch > 0)
    return Math.max(0.5, (web * pitch * t * 0.92) / 1e6);
  if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
  const fallbackWeb = Number.isFinite(web) && web > 0 ? web : w * 2;
  const fallbackPitch = Number.isFinite(pitch) && pitch > 0 ? pitch : h;
  return Math.max(0.5, (fallbackWeb * fallbackPitch * t * 0.92) / 1e6);
}

export function VariantsMatrixV37({
  productMasterId,
  rows,
  axes,
  renderCards,
  master,
  routeSteps,
  templateName,
}: VariantsMatrixV37Props) {
  const [mode, setMode] = React.useState<ViewMode>("matrix");
  const [search, setSearch] = React.useState("");
  const [filters, setFilters] = React.useState<AxisFilter[]>([]);
  const [savedViews, setSavedViews] = React.useState<SavedView[]>([]);
  const [activeView, setActiveView] = React.useState<string>("all");
  const [selected, setSelected] = React.useState<ProductVariant | null>(null);
  const [compareIds, setCompareIds] = React.useState<string[]>([]);

  // Load saved views from localStorage (UI-only feature, not server-backed)
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(`pm-views:${productMasterId}`);
      if (raw) setSavedViews(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, [productMasterId]);
  const persistViews = React.useCallback(
    (next: SavedView[]) => {
      setSavedViews(next);
      try {
        localStorage.setItem(
          `pm-views:${productMasterId}`,
          JSON.stringify(next),
        );
      } catch {
        /* ignore */
      }
    },
    [productMasterId],
  );

  // Rank axes by their number of distinct values — most-distinct first makes the
  // matrix actually pivot something meaningful (a single-value axis is useless on Y/X).
  const usableAxes = React.useMemo(() => {
    const scored = axes.map((a) => ({
      a,
      count: uniqueAxisValues(rows, String(a.axis)).length,
    }));
    return scored
      .filter((s) => s.count > 0)
      .sort((p, q) => q.count - p.count)
      .map((s) => s.a);
  }, [axes, rows]);
  const [xAxis, setXAxis] = React.useState<string>(() =>
    String(usableAxes[0]?.axis || ""),
  );
  const [yAxis, setYAxis] = React.useState<string>(() =>
    String(usableAxes[1]?.axis || usableAxes[0]?.axis || ""),
  );

  React.useEffect(() => {
    if (!usableAxes.length) return;
    const list = usableAxes.map((a) => String(a.axis));
    if (!list.includes(xAxis)) setXAxis(list[0]);
    if (!list.includes(yAxis)) {
      // Prefer an axis different from xAxis when possible.
      const alt =
        list.find((k) => k !== (list.includes(xAxis) ? xAxis : list[0])) ||
        list[0];
      setYAxis(alt);
    }
  }, [usableAxes, xAxis, yAxis]);

  // Filter rows by search + active axis filters
  const filteredRows = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (q) {
        const hay = [
          r.code,
          ...Object.values(r.axis_values || {}).map((v) =>
            typeof v === "object"
              ? (v as any).code || (v as any).value
              : String(v),
          ),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      for (const f of filters) {
        if (!f.values.length) continue;
        const v = axisValueOf(r, f.axis);
        if (!f.values.includes(v)) return false;
      }
      return true;
    });
  }, [rows, search, filters]);

  function toggleCompare(row: ProductVariant) {
    setCompareIds((prev) => {
      if (prev.includes(row.id)) return prev.filter((x) => x !== row.id);
      if (prev.length >= 2) return [prev[1], row.id];
      return [...prev, row.id];
    });
  }

  function saveCurrentView() {
    const label = window.prompt("Name this view (e.g. FOOD-A grade, With POD)");
    if (!label) return;
    const id = `view-${Date.now()}`;
    persistViews([...savedViews, { id, label, filters }]);
    setActiveView(id);
  }

  function applyView(viewId: string) {
    setActiveView(viewId);
    if (viewId === "all") setFilters([]);
    else {
      const v = savedViews.find((x) => x.id === viewId);
      if (v) setFilters(v.filters);
    }
  }

  function removeFilter(axis: string) {
    setFilters((prev) => prev.filter((f) => f.axis !== axis));
    setActiveView("all");
  }

  function exportCsv() {
    const cols = [
      "code",
      ...axes.map((a) => String(a.axis)),
      "unit_weight_g",
      "active",
    ];
    const lines = [cols.join(",")];
    for (const r of filteredRows) {
      lines.push(
        [
          r.code,
          ...axes.map((a) => axisValueOf(r, String(a.axis))),
          String(unitWeightOf(r) ?? ""),
          r.active ? "1" : "0",
        ].join(","),
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `variants-${productMasterId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-3">
      {/* ─── Toolbar ─── */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface-1 p-3 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <ModeToggle
            mode={mode}
            setMode={setMode}
            compareCount={compareIds.length}
          />
          {mode === "matrix" && usableAxes.length >= 1 ? (
            <div className="flex items-center gap-2 text-[11px] font-bold text-content-3">
              <span>X</span>
              <select
                value={xAxis}
                onChange={(e) => {
                  const next = e.target.value;
                  if (next === yAxis) setYAxis(xAxis); // swap to avoid same-axis dead state
                  setXAxis(next);
                }}
                className="h-8 rounded-lg border border-line bg-surface-1 px-2 text-[11px] font-bold text-content-1"
              >
                {usableAxes.map((a) => (
                  <option key={String(a.axis)} value={String(a.axis)}>
                    {fmtAxisLabel(a)} (
                    {uniqueAxisValues(rows, String(a.axis)).length})
                  </option>
                ))}
              </select>
              <span>×</span>
              <span>Y</span>
              <select
                value={yAxis}
                onChange={(e) => {
                  const next = e.target.value;
                  if (next === xAxis) setXAxis(yAxis);
                  setYAxis(next);
                }}
                className="h-8 rounded-lg border border-line bg-surface-1 px-2 text-[11px] font-bold text-content-1"
              >
                {usableAxes.map((a) => (
                  <option key={String(a.axis)} value={String(a.axis)}>
                    {fmtAxisLabel(a)} (
                    {uniqueAxisValues(rows, String(a.axis)).length})
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-content-4" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="search variant code · axis · customer"
              className="h-8 w-[260px] rounded-lg pl-7 text-[11px]"
            />
          </div>
          <button className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface-1 px-2.5 text-[11px] font-bold text-content-3 hover:bg-surface-2">
            <Columns3 className="h-3.5 w-3.5" /> Columns
          </button>
          <button
            onClick={exportCsv}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-surface-1 px-2.5 text-[11px] font-bold text-content-3 hover:bg-surface-2"
          >
            <Download className="h-3.5 w-3.5" /> Export
          </button>
        </div>
      </div>

      {/* ─── Saved views + filters row ─── */}
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="text-[10px] font-black uppercase tracking-[0.22em] text-content-3">
          Views
        </span>
        <button
          onClick={() => applyView("all")}
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-bold ring-1",
            activeView === "all"
              ? "bg-surface-3 text-white ring-line-strong"
              : "bg-surface-1 text-content-2 ring-line hover:bg-surface-2",
          )}
        >
          <Star className="h-3 w-3" /> All
        </button>
        {savedViews.map((v) => (
          <button
            key={v.id}
            onClick={() => applyView(v.id)}
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-bold ring-1",
              activeView === v.id
                ? "bg-order-fg text-white ring-order-border"
                : "bg-surface-1 text-content-2 ring-line hover:bg-surface-2",
            )}
          >
            {v.label}
          </button>
        ))}
        <button
          onClick={saveCurrentView}
          disabled={!filters.length}
          className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-bold text-success-fg ring-1 ring-success-border bg-success-bg hover:bg-success-bg disabled:opacity-50"
        >
          + Save current
        </button>
        {filters.length ? (
          <>
            <span className="ml-3 text-[10px] font-black uppercase tracking-[0.22em] text-content-3">
              Filters
            </span>
            {filters.map((f) => (
              <button
                key={f.axis}
                onClick={() => removeFilter(f.axis)}
                className="inline-flex items-center gap-1 rounded-full bg-order-bg px-2.5 py-1 font-bold text-order-fg ring-1 ring-order-border hover:bg-order-bg"
                title="Remove filter"
              >
                {f.axis} · {f.values.join(",")}{" "}
                <span className="opacity-60">×</span>
              </button>
            ))}
          </>
        ) : null}
      </div>

      {/* ─── Main area ─── */}
      {filteredRows.length === 0 ? (
        <EmptyState />
      ) : mode === "matrix" ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-3">
            {filteredRows.length === 1 ? (
              <div className="rounded-2xl border border-warning-border bg-warning-bg px-4 py-2.5 text-[11px] text-warning-fg">
                Only 1 variant matches — the pivot will look flat. Add more
                variants across axes (or clear filters/search) to see the matrix
                come alive.
              </div>
            ) : null}
            <PivotMatrix
              rows={filteredRows}
              xAxis={xAxis}
              yAxis={yAxis}
              axes={axes}
              selectedId={selected?.id}
              compareIds={compareIds}
              onPick={setSelected}
              onToggleCompare={toggleCompare}
            />
            {compareIds.length ? (
              <CompareBar
                ids={compareIds}
                rows={rows}
                onClear={() => setCompareIds([])}
              />
            ) : null}
          </div>
          <div>
            <VariantLiveRail
              productMasterId={productMasterId}
              variant={selected}
              axes={axes}
              master={master}
              routeSteps={routeSteps}
              templateName={templateName}
            />
          </div>
        </div>
      ) : mode === "cards" ? (
        renderCards ? (
          <>{renderCards()}</>
        ) : (
          <FallbackCards rows={filteredRows} axes={axes} onPick={setSelected} />
        )
      ) : (
        <TableView rows={filteredRows} axes={axes} onPick={setSelected} />
      )}
    </div>
  );
}

// ─── Mode toggle ────────────────────────────────────────────────────

function ModeToggle({
  mode,
  setMode,
  compareCount,
}: {
  mode: ViewMode;
  setMode: (m: ViewMode) => void;
  compareCount: number;
}) {
  return (
    <div className="inline-flex rounded-xl bg-surface-2 p-0.5 shadow-inner">
      {(
        [
          {
            key: "matrix",
            label: "Matrix",
            icon: <LayoutGrid className="h-3.5 w-3.5" />,
          },
          {
            key: "cards",
            label: "Cards",
            icon: <Boxes className="h-3.5 w-3.5" />,
          },
          {
            key: "table",
            label: "Table",
            icon: <Rows3 className="h-3.5 w-3.5" />,
          },
        ] as { key: ViewMode; label: string; icon: React.ReactNode }[]
      ).map((b) => (
        <button
          key={b.key}
          onClick={() => setMode(b.key)}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[11px] font-bold",
            mode === b.key
              ? "bg-surface-1 text-content-1 ring-1 ring-line shadow-sm"
              : "text-content-3 hover:text-content-1",
          )}
        >
          {b.icon} {b.label}
        </button>
      ))}
      {compareCount > 0 ? (
        <span className="ml-1 inline-flex h-8 items-center gap-1 rounded-lg bg-success-bg px-2.5 text-[11px] font-bold text-success-fg ring-1 ring-success-border">
          Compare ({compareCount})
        </span>
      ) : null}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-line bg-surface-2 p-10 text-center">
      <div className="mt-3 text-sm font-semibold text-content-2">
        No variants match
      </div>
      <div className="mt-1 text-xs text-content-3">
        Create a variant or clear filters to see existing rows.
      </div>
    </div>
  );
}

// ─── Pivot matrix ─────────────────────────────────────────────────

function PivotMatrix({
  rows,
  xAxis,
  yAxis,
  axes,
  selectedId,
  compareIds,
  onPick,
  onToggleCompare,
}: {
  rows: ProductVariant[];
  xAxis: string;
  yAxis: string;
  axes: VariantAxisDef[];
  selectedId?: string;
  compareIds: string[];
  onPick: (r: ProductVariant) => void;
  onToggleCompare: (r: ProductVariant) => void;
}) {
  const xs = uniqueAxisValues(rows, xAxis);
  const ys = uniqueAxisValues(rows, yAxis);
  const isSameAxis = xAxis === yAxis;

  const cellMap = React.useMemo(() => {
    const m = new Map<string, ProductVariant[]>();
    for (const r of rows) {
      const x = axisValueOf(r, xAxis) || "—";
      const y = axisValueOf(r, yAxis) || "—";
      const key = `${x}::${y}`;
      const arr = m.get(key) || [];
      arr.push(r);
      m.set(key, arr);
    }
    return m;
  }, [rows, xAxis, yAxis]);

  const weights = React.useMemo(
    () => rows.map(unitWeightOf).filter((x): x is number => x != null),
    [rows],
  );
  const minW = weights.length ? Math.min(...weights) : 0;
  const maxW = weights.length ? Math.max(...weights) : 0;
  const avgUnit = (weight: number | null) =>
    weight != null ? `${weight.toFixed(0)} g` : "—";

  if (!xs.length || !ys.length || isSameAxis) {
    return (
      <div className="rounded-2xl border border-warning-border bg-warning-bg p-6 text-center text-xs text-warning-fg">
        {isSameAxis
          ? "Pick two different axes for the X and Y to render a pivot."
          : "Not enough axis values yet to render a pivot. Try Cards or Table view."}
      </div>
    );
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-surface-1 shadow-sm">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-order-bg text-order-fg">
            <LayoutGrid className="h-3.5 w-3.5" />
          </span>
          <div>
            <h3 className="font-display text-sm font-bold text-content-1">
              {labelOf(axes, yAxis)} × {labelOf(axes, xAxis)} pivot ·{" "}
              {rows.length} variants
            </h3>
            <div className="text-[10px] text-content-3">
              Each cell = one variant · color = total unit weight · click for
              full BOM
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] font-bold text-content-3">
          <span>density</span>
          <span className="rounded bg-order-bg px-1.5 py-0.5 text-order-fg">
            light
          </span>
          <span className="rounded bg-order-fg px-1.5 py-0.5 text-white">
            ▮
          </span>
          <span className="rounded bg-order-fg px-1.5 py-0.5 text-white">
            heavy
          </span>
        </div>
      </header>
      <div className="overflow-x-auto p-3">
        <table className="min-w-full text-[12px] border-separate border-spacing-y-0">
          <thead>
            <tr className="text-content-3">
              <th className="sticky left-0 bg-surface-1 text-left px-2 py-1 font-bold uppercase tracking-wider text-[9px]">
                {labelOf(axes, yAxis)} \\ {labelOf(axes, xAxis)}
              </th>
              {xs.map((x) => (
                <th
                  key={x}
                  className="text-center px-2 py-1 font-mono font-bold"
                >
                  {x}
                </th>
              ))}
              <th className="text-center px-2 py-1 font-bold uppercase tracking-wider text-[9px]">
                total
              </th>
              <th className="text-center px-2 py-1 font-bold uppercase tracking-wider text-[9px]">
                avg unit
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {ys.map((y) => {
              const rowVariants = rows.filter(
                (r) => axisValueOf(r, yAxis) === y,
              );
              const yTotal = rowVariants.length;
              const yWeights = rowVariants
                .map(unitWeightOf)
                .filter((x): x is number => x != null);
              const yAvg = yWeights.length
                ? yWeights.reduce((a, b) => a + b, 0) / yWeights.length
                : null;
              return (
                <tr key={y} className="">
                  <td className="sticky left-0 bg-surface-1 px-2 py-2 font-mono font-bold text-content-1">
                    {y}
                  </td>
                  {xs.map((x) => {
                    const list = cellMap.get(`${x}::${y}`) || [];
                    const count = list.length;
                    if (!count)
                      return (
                        <td key={x} className="px-1 py-1 text-center">
                          <span className="inline-flex h-12 w-16 items-center justify-center rounded-lg bg-surface-2 text-[10px] text-content-4">
                            —
                          </span>
                        </td>
                      );
                    const v0 = list[0];
                    const w = unitWeightOf(v0);
                    const intensity =
                      w != null && maxW > minW
                        ? (w - minW) / (maxW - minW)
                        : 0.4;
                    const isSelected = selectedId === v0.id;
                    const isCompared = compareIds.includes(v0.id);
                    return (
                      <td key={x} className="px-1 py-1 text-center">
                        <button
                          onClick={(e) => {
                            if (e.shiftKey) onToggleCompare(v0);
                            else onPick(v0);
                          }}
                          className={cn(
                            "inline-flex h-12 w-16 flex-col items-center justify-center rounded-lg font-mono ring-1",
                            cellTone(intensity, isSelected, isCompared),
                          )}
                          title={`${v0.code} · ${y} × ${x}${count > 1 ? ` (+${count - 1} more)` : ""} · shift-click to compare`}
                        >
                          <span className="text-[10px] font-bold leading-none">
                            {v0.code}
                          </span>
                          {w != null ? (
                            <span className="mt-0.5 text-[9px] opacity-80">
                              {w.toFixed(0)} g
                            </span>
                          ) : null}
                          {count > 1 ? (
                            <span className="text-[8px] opacity-70">
                              +{count - 1}
                            </span>
                          ) : null}
                        </button>
                      </td>
                    );
                  })}
                  <td className="px-2 py-2 text-center font-bold text-content-2">
                    {yTotal}
                  </td>
                  <td className="px-2 py-2 text-center text-[11px] text-content-3 font-mono">
                    {avgUnit(yAvg)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="bg-surface-2">
            <tr>
              <td className="sticky left-0 bg-surface-2 px-2 py-2 text-right text-[9px] font-black uppercase tracking-wider text-content-3">
                per-thickness count
              </td>
              {xs.map((x) => {
                const total = rows.filter(
                  (r) => axisValueOf(r, xAxis) === x,
                ).length;
                return (
                  <td
                    key={x}
                    className="px-2 py-2 text-center font-mono font-bold text-content-2"
                  >
                    {total}
                  </td>
                );
              })}
              <td className="px-2 py-2 text-center text-success-fg font-bold">
                {rows.length}
              </td>
              <td className="px-2 py-2 text-center text-[11px] text-content-3 font-mono">
                {(() => {
                  const allW = rows
                    .map(unitWeightOf)
                    .filter((x): x is number => x != null);
                  if (!allW.length) return "—";
                  return `${(allW.reduce((a, b) => a + b, 0) / allW.length).toFixed(0)} g`;
                })()}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

function cellTone(
  intensity: number,
  selected: boolean,
  compared: boolean,
): string {
  let base: string;
  if (intensity >= 0.66) base = "bg-order-fg text-white ring-order-border";
  else if (intensity >= 0.33) base = "bg-order-fg text-white ring-order-border";
  else base = "bg-order-bg text-order-fg ring-order-border";
  if (selected) return cn(base, "ring-2 ring-offset-2 ring-order-border");
  if (compared) return cn(base, "ring-2 ring-success-border");
  return base;
}

function labelOf(axes: VariantAxisDef[], axisKey: string): string {
  const found = axes.find((a) => String(a.axis) === axisKey);
  return found?.label || axisKey;
}

// ─── Compare bar ──────────────────────────────────────────────────

function CompareBar({
  ids,
  rows,
  onClear,
}: {
  ids: string[];
  rows: ProductVariant[];
  onClear: () => void;
}) {
  const picked = ids
    .map((id) => rows.find((r) => r.id === id))
    .filter(Boolean) as ProductVariant[];
  if (!picked.length) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-success-border bg-success-bg px-4 py-2.5">
      <div className="text-[11px] text-content-2">
        <span className="font-black uppercase tracking-[0.18em] text-success-fg">
          Selected{" "}
        </span>
        <span className="font-mono font-bold">
          {picked.map((p) => p.code).join(" · ")}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button
          disabled={picked.length < 2}
          className="inline-flex items-center gap-1 rounded-lg bg-success-fg px-3 py-1.5 text-[11px] font-bold text-white disabled:opacity-50 hover:bg-success-fg"
        >
          Compare {picked.length} → side-by-side
        </button>
        <button
          onClick={onClear}
          className="rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-success-fg hover:bg-success-bg"
        >
          Clear
        </button>
      </div>
    </div>
  );
}

// ─── Variant live BOM rail ────────────────────────────────────────

export function VariantLiveRail({
  productMasterId,
  variant,
  axes,
  customerId,
  master,
  scope = "variant",
  routeSteps,
  templateName,
}: {
  productMasterId: string;
  variant: ProductVariant | null;
  axes: VariantAxisDef[];
  customerId?: string;
  master?: ProductMaster;
  /** "variant" (default) — render variant-scope rail with resolved-on-order placeholders.
   * "order" — render full live BOM (used by customer-overlay tab + sales create). */
  scope?: "variant" | "order";
  /** Optional template route steps to render as a top ribbon */
  routeSteps?: Array<{
    index: number;
    name: string;
    process_code?: string;
    transition?: string;
    has_artwork?: boolean;
  }>;
  templateName?: string;
}) {
  const previewQuery = useQuery({
    queryKey: [
      "variant-preview-bom",
      productMasterId,
      variant?.id || "_none_",
      customerId || "_no_cust_",
    ],
    queryFn: async () => {
      if (!variant) return null;
      return productMasterService.previewBom({
        product_master: productMasterId,
        customer_id: customerId,
        axis_values: variant.axis_values || {},
      });
    },
    enabled: !!variant,
    staleTime: 30_000,
  });

  const masterFlags = master ? deriveMasterFlags(master) : undefined;

  if (!variant) {
    return (
      <LiveBomRail
        title={
          scope === "variant"
            ? "Engineering BOM · variant scope"
            : "Live BOM preview"
        }
        subtitle="Pick a cell to render geometry, layers, materials and BOM."
        preview={null}
        loading={false}
        sticky
        scope={scope}
        masterFlags={masterFlags}
        routeSteps={routeSteps}
        routeTemplateName={templateName}
      />
    );
  }

  return (
    <LiveBomRail
      title={shortVariantTitle(variant)}
      subtitle={variantSubtitle(variant)}
      preview={
        (previewQuery.data ||
          synthesizePreviewFromVariant(variant, axes)) as PreviewBomResult
      }
      loading={previewQuery.isLoading}
      sticky
      scope={scope}
      masterFlags={masterFlags}
      routeSteps={routeSteps}
      routeTemplateName={templateName}
    />
  );
}

function shortVariantTitle(variant: ProductVariant): string {
  const g: any = variant.geometry_snapshot || {};
  const parts: string[] = [];
  if (g.size_code) parts.push(String(g.size_code));
  else if (g.width_mm && g.height_mm)
    parts.push(`${g.width_mm}×${g.height_mm}`);
  else if (g.width_mm) parts.push(`${g.width_mm} mm`);
  if (g.thickness_um) parts.push(`${g.thickness_um}μ`);
  if (parts.length) return `Variant · ${parts.join(" · ")}`;
  // Fallback: take the last short segment of the variant code
  const segs = String(variant.code || "").split("-");
  const tail = segs.length > 3 ? segs.slice(-2).join("-") : variant.code;
  return `Variant · ${tail || variant.code}`;
}

function variantSubtitle(variant: ProductVariant): string {
  const parts: string[] = [];
  const shortId = String(variant.id || "").slice(0, 8);
  if (shortId) parts.push(`id ${shortId}`);
  const axisCount = Object.keys(variant.axis_values || {}).length;
  if (axisCount)
    parts.push(`${axisCount} ${axisCount === 1 ? "axis" : "axes"}`);
  return parts.join(" · ");
}

function deriveMasterFlags(master: ProductMaster) {
  const fa: any = master.fixed_attributes || {};
  const addonsAxisDef = (master.variant_axes || []).find(
    (a) => String(a.axis) === "addon" || String(a.axis) === "addons",
  );
  const addonsAxis: "off" | "optional" | "required" = !addonsAxisDef
    ? "off"
    : addonsAxisDef.required
      ? "required"
      : "optional";
  return {
    print_capable: !!fa.print_capable,
    pod_locked: !!(fa.pod_enabled && (fa.pod_variant_code || fa.pod_variant)),
    addons_axis: addonsAxis,
  };
}

function synthesizePreviewFromVariant(
  v: ProductVariant,
  _axes: VariantAxisDef[],
): PreviewBomResult {
  const unitW = unitWeightOf(v) ?? 0;
  const layerRows = (v.layer_snapshot || []).filter(
    (row: any) =>
      row?.film_variant_code || row?.material_code || row?.thickness_micron,
  );
  const fallbackPlanningLines = layerRows.map((row: any, index: number) => ({
    category: "FILM",
    category_code: "FILM",
    material_code:
      row.film_variant_code || row.material_code || `L${index + 1}`,
    material_name: row.name || row.material_name || row.grade || "",
    qty: Number(row.weight_kg || row.qty || 0),
    planned_issue_qty: Number(row.weight_kg || row.qty || 0),
    uom: "KG",
  }));
  const geometry = v.geometry_snapshot || {};
  return {
    variant_status: "EXISTS",
    variant_id: v.id,
    variant_code: v.code,
    invariant_signature: v.invariant_signature || "INV-?",
    geometry_snapshot: geometry,
    layer_snapshot: v.layer_snapshot || [],
    unit_weight_g: unitW,
    bom: {
      planning_lines: fallbackPlanningLines,
      is_complete: fallbackPlanningLines.length > 0,
      errors: [],
    },
    bom_by_step: fallbackPlanningLines.length
      ? [
          {
            index: 1,
            step_label: "Variant material snapshot",
            step_kind: "MATERIAL",
            description:
              "Fallback from saved variant layers while live BOM reloads",
            materials: fallbackPlanningLines,
          },
        ]
      : [],
    checks: [
      { label: "Variant exists in master", ok: true, tone: "ok" },
      { label: "Geometry snapshot captured", ok: !!geometry, tone: "warn" },
      {
        label: "Layer snapshot captured",
        ok: Array.isArray(v.layer_snapshot) && v.layer_snapshot.length > 0,
        tone: "warn",
      },
    ],
  };
}

// ─── Fallback cards (when renderCards not provided) ───────────────

function FallbackCards({
  rows,
  axes,
  onPick,
}: {
  rows: ProductVariant[];
  axes: VariantAxisDef[];
  onPick: (r: ProductVariant) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((r, idx) => (
        <button
          key={r.id || idx}
          onClick={() => onPick(r)}
          className="text-left rounded-2xl border border-line bg-surface-1 p-3 shadow-sm hover:border-order-border"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[11px] font-bold text-order-fg">
              {r.code || `V${idx + 1}`}
            </span>
            <span
              className={cn(
                "rounded-full px-1.5 py-0.5 text-[9px] font-bold ring-1",
                r.active
                  ? "bg-success-bg text-success-fg ring-success-border"
                  : "bg-danger-bg text-danger-fg ring-danger-border",
              )}
            >
              {r.active ? "Active" : "Inactive"}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {axes.slice(0, 4).map((a) => {
              const v = axisValueOf(r, String(a.axis));
              if (!v) return null;
              return (
                <span
                  key={String(a.axis)}
                  className="rounded bg-info-bg px-1.5 py-0.5 text-[10px] font-mono font-bold text-primary ring-1 ring-info-border"
                >
                  {fmtAxisLabel(a)}: {v}
                </span>
              );
            })}
          </div>
        </button>
      ))}
    </div>
  );
}

// ─── Table view ───────────────────────────────────────────────────

function TableView({
  rows,
  axes,
  onPick,
}: {
  rows: ProductVariant[];
  axes: VariantAxisDef[];
  onPick: (r: ProductVariant) => void;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-surface-1 shadow-sm">
      <div className="overflow-x-auto">
        <table className="min-w-full text-[12px]">
          <thead className="bg-surface-2 border-b border-line text-content-3">
            <tr>
              <th className="px-3 py-2 text-left font-bold uppercase tracking-wider text-[9px]">
                Code
              </th>
              {axes.slice(0, 6).map((a) => (
                <th
                  key={String(a.axis)}
                  className="px-3 py-2 text-left font-bold uppercase tracking-wider text-[9px]"
                >
                  {fmtAxisLabel(a)}
                </th>
              ))}
              <th className="px-3 py-2 text-right font-bold uppercase tracking-wider text-[9px]">
                Unit g
              </th>
              <th className="px-3 py-2 text-right font-bold uppercase tracking-wider text-[9px]">
                Status
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r, idx) => (
              <tr
                key={r.id || idx}
                onClick={() => onPick(r)}
                className="cursor-pointer hover:bg-order-bg"
              >
                <td className="px-3 py-2 font-mono font-bold text-order-fg">
                  {r.code || `V${idx + 1}`}
                </td>
                {axes.slice(0, 6).map((a) => (
                  <td
                    key={String(a.axis)}
                    className="px-3 py-2 font-mono text-[11px] text-content-2"
                  >
                    {axisValueOf(r, String(a.axis)) || "—"}
                  </td>
                ))}
                <td className="px-3 py-2 text-right font-mono text-[11px] text-content-2">
                  {unitWeightOf(r)?.toFixed(1) ?? "—"}
                </td>
                <td className="px-3 py-2 text-right">
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-[9px] font-bold ring-1",
                      r.active
                        ? "bg-success-bg text-success-fg ring-success-border"
                        : "bg-danger-bg text-danger-fg ring-danger-border",
                    )}
                  >
                    {r.active ? "Active" : "Inactive"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

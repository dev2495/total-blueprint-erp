"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Chip, ChipGroup, type ChipKind } from "./chip";
import type { ProductMaster, ProductVariant, ProductMasterAxis } from "@/services/product-masters";

export interface VariantMatrixProps {
  master: ProductMaster;
  variants: ProductVariant[];
  onCreateMissing?: (axisValues: Record<string, any>) => Promise<ProductVariant | void> | void;
  onCellClick?: (variant: ProductVariant | null, axisValues: Record<string, any>) => void;
  initialRowAxis?: string;
  initialColAxis?: string;
  variantUsage?: Record<string, number>;
  className?: string;
}

type Axis = ProductMasterAxis & { axis: string };

const isVariantInUse = (variant: ProductVariant, usage?: Record<string, number>): boolean => {
  if (!usage) return false;
  const count = usage[variant.id] ?? usage[variant.code] ?? 0;
  return count > 0;
};

function uniqueAxisValues(axis: Axis, variants: ProductVariant[]): string[] {
  const set = new Map<string, string>();
  if (Array.isArray(axis.options)) {
    for (const opt of axis.options) {
      const v =
        typeof opt === "string" || typeof opt === "number"
          ? String(opt)
          : (opt as any).value ?? (opt as any).code ?? (opt as any).id ?? "";
      if (v !== "") set.set(String(v), String(v));
    }
  }
  for (const v of variants) {
    const val = v.axis_values?.[axis.axis];
    if (val !== undefined && val !== null) set.set(String(val), String(val));
  }
  return Array.from(set.values());
}

function variantMatchesAxisValue(
  variant: ProductVariant,
  axisCode: string,
  value: string,
): boolean {
  const v = variant.axis_values?.[axisCode];
  return v !== undefined && v !== null && String(v) === value;
}

function variantMatchesFilters(
  variant: ProductVariant,
  filters: Record<string, string>,
): boolean {
  return Object.entries(filters).every(([k, v]) => {
    if (!v) return true;
    return variantMatchesAxisValue(variant, k, v);
  });
}

export function VariantMatrix({
  master,
  variants,
  onCreateMissing,
  onCellClick,
  initialRowAxis,
  initialColAxis,
  variantUsage,
  className,
}: VariantMatrixProps) {
  const axes: Axis[] = React.useMemo(
    () => (master.variant_axes ?? []).map((a) => ({ ...a })) as Axis[],
    [master],
  );

  const [rowAxis, setRowAxis] = React.useState<string | undefined>(
    () => initialRowAxis ?? axes[0]?.axis,
  );
  const [colAxis, setColAxis] = React.useState<string | undefined>(
    () => initialColAxis ?? axes[1]?.axis,
  );
  const [filters, setFilters] = React.useState<Record<string, string>>({});
  const [busyCell, setBusyCell] = React.useState<string | null>(null);
  const [drawerCell, setDrawerCell] = React.useState<{
    variant: ProductVariant | null;
    axisValues: Record<string, any>;
  } | null>(null);

  React.useEffect(() => {
    if (!rowAxis && axes[0]) setRowAxis(axes[0].axis);
    if (!colAxis && axes[1]) setColAxis(axes[1].axis);
  }, [axes, rowAxis, colAxis]);

  const otherAxes = axes.filter((a) => a.axis !== rowAxis && a.axis !== colAxis);

  const filteredVariants = React.useMemo(
    () => variants.filter((v) => variantMatchesFilters(v, filters)),
    [variants, filters],
  );

  const rowValues = rowAxis
    ? uniqueAxisValues(axes.find((a) => a.axis === rowAxis)!, filteredVariants)
    : [];
  const colValues = colAxis
    ? uniqueAxisValues(axes.find((a) => a.axis === colAxis)!, filteredVariants)
    : [];

  if (axes.length === 0) {
    const v = variants[0] ?? null;
    return (
      <div className={cn("rounded-xl border border-slate-200 bg-white p-4", className)}>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Single variant
        </div>
        <div className="font-mono-token text-sm text-slate-900">{v?.code ?? "(no variant)"}</div>
      </div>
    );
  }

  // 1-axis: render a strip
  if (axes.length === 1 || !colAxis) {
    const axis = axes.find((a) => a.axis === rowAxis) ?? axes[0];
    const values = uniqueAxisValues(axis, filteredVariants);
    return (
      <div className={cn("flex flex-col gap-3", className)}>
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {axis.axis}
        </div>
        <div className="flex flex-wrap gap-2">
          {values.map((v) => {
            const variant = filteredVariants.find((x) =>
              variantMatchesAxisValue(x, axis.axis, v),
            );
            return (
              <CellButton
                key={v}
                axisLabel={v}
                variant={variant ?? null}
                inUse={variant ? isVariantInUse(variant, variantUsage) : false}
                busy={busyCell === v}
                onClick={() => {
                  const axisValues = { [axis.axis]: v };
                  setDrawerCell({ variant: variant ?? null, axisValues });
                  onCellClick?.(variant ?? null, axisValues);
                }}
              />
            );
          })}
        </div>
        {drawerCell && (
          <Drawer
            cell={drawerCell}
            onClose={() => setDrawerCell(null)}
            onCreate={async () => {
              if (!onCreateMissing) return;
              setBusyCell(String(drawerCell.axisValues[axis.axis] ?? ""));
              try {
                await onCreateMissing(drawerCell.axisValues);
              } finally {
                setBusyCell(null);
                setDrawerCell(null);
              }
            }}
          />
        )}
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {/* Axis pickers */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white/70 p-2 backdrop-blur-sm">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Rows
        </span>
        <ChipGroup spacing="tight">
          {axes.map((a) => (
            <Chip
              key={a.axis}
              kind={a.axis === rowAxis ? "process" : "neutral"}
              asButton
              onClick={() => setRowAxis(a.axis)}
              className={a.axis === colAxis ? "opacity-40" : ""}
              aria-pressed={a.axis === rowAxis}
            >
              {a.axis}
            </Chip>
          ))}
        </ChipGroup>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Cols
        </span>
        <ChipGroup spacing="tight">
          {axes.map((a) => (
            <Chip
              key={a.axis}
              kind={a.axis === colAxis ? "process" : "neutral"}
              asButton
              onClick={() => setColAxis(a.axis)}
              className={a.axis === rowAxis ? "opacity-40" : ""}
              aria-pressed={a.axis === colAxis}
            >
              {a.axis}
            </Chip>
          ))}
        </ChipGroup>
      </div>

      {/* Filter row for non-axis dims */}
      {otherAxes.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-100 bg-slate-50/50 p-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Filter
          </span>
          {otherAxes.map((a) => {
            const opts = uniqueAxisValues(a, variants);
            return (
              <span key={a.axis} className="inline-flex items-center gap-1">
                <span className="text-[11px] text-slate-500">{a.axis}</span>
                <select
                  value={filters[a.axis] ?? ""}
                  onChange={(e) =>
                    setFilters((f) => ({ ...f, [a.axis]: e.target.value }))
                  }
                  className="h-7 rounded-md border border-slate-200 bg-white px-1.5 text-[12px]"
                >
                  <option value="">all</option>
                  {opts.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </span>
            );
          })}
        </div>
      )}

      {/* Grid */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <div
          className="grid"
          style={{
            gridTemplateColumns: `120px repeat(${colValues.length || 1}, minmax(110px, 1fr))`,
          }}
          role="grid"
          aria-label={`${master.code} variant matrix`}
        >
          <div
            role="columnheader"
            className="sticky left-0 top-0 z-10 border-b border-r border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500"
          >
            {rowAxis} ↓ / {colAxis} →
          </div>
          {colValues.map((c) => (
            <div
              key={c}
              role="columnheader"
              className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50 px-2 py-1 text-center text-[11px] font-semibold text-slate-700"
            >
              {c}
            </div>
          ))}

          {rowValues.map((r) => (
            <React.Fragment key={r}>
              <div
                role="rowheader"
                className="sticky left-0 z-[1] border-r border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-700"
              >
                {r}
              </div>
              {colValues.map((c) => {
                const axisValues = {
                  ...filters,
                  [rowAxis!]: r,
                  [colAxis!]: c,
                };
                const variant = filteredVariants.find(
                  (v) =>
                    variantMatchesAxisValue(v, rowAxis!, r) &&
                    variantMatchesAxisValue(v, colAxis!, c) &&
                    variantMatchesFilters(v, filters),
                );
                const cellKey = `${r}::${c}`;
                return (
                  <CellButton
                    key={cellKey}
                    axisLabel={variant?.code ?? "+"}
                    variant={variant ?? null}
                    inUse={variant ? isVariantInUse(variant, variantUsage) : false}
                    busy={busyCell === cellKey}
                    onClick={() => {
                      setDrawerCell({ variant: variant ?? null, axisValues });
                      onCellClick?.(variant ?? null, axisValues);
                    }}
                  />
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>

      {drawerCell && (
        <Drawer
          cell={drawerCell}
          onClose={() => setDrawerCell(null)}
          onCreate={async () => {
            if (!onCreateMissing) return;
            const key = `${drawerCell.axisValues[rowAxis!] ?? ""}::${drawerCell.axisValues[colAxis!] ?? ""}`;
            setBusyCell(key);
            try {
              await onCreateMissing(drawerCell.axisValues);
            } finally {
              setBusyCell(null);
              setDrawerCell(null);
            }
          }}
        />
      )}
    </div>
  );
}

function CellButton({
  axisLabel,
  variant,
  inUse,
  busy,
  onClick,
}: {
  axisLabel: string;
  variant: ProductVariant | null;
  inUse: boolean;
  busy: boolean;
  onClick: () => void;
}) {
  const tone: ChipKind = !variant ? "neutral" : inUse ? "process" : "neutral";
  const empty = !variant;
  return (
    <button
      type="button"
      onClick={onClick}
      role="gridcell"
      aria-busy={busy || undefined}
      className={cn(
        "group relative flex min-h-[40px] items-center justify-center border-b border-r border-slate-100 px-2 py-1 text-[12px] font-mono-token transition-colors",
        empty
          ? "border-dashed text-slate-400 hover:bg-blue-50/40 hover:text-blue-600"
          : inUse
            ? "bg-blue-50/60 text-blue-700 hover:bg-blue-100/60"
            : "bg-white text-slate-700 hover:bg-slate-50",
        busy && "animate-pulse",
      )}
    >
      <span className="truncate">{axisLabel}</span>
      {variant && inUse && (
        <span
          className="ml-1 hidden rounded-full bg-blue-600 px-1 text-[9px] font-bold text-white sm:inline"
          aria-hidden
        >
          •
        </span>
      )}
    </button>
  );
}

function Drawer({
  cell,
  onClose,
  onCreate,
}: {
  cell: { variant: ProductVariant | null; axisValues: Record<string, any> };
  onClose: () => void;
  onCreate: () => Promise<void> | void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/30 backdrop-blur-sm"
      onClick={onClose}
    >
      <aside
        className="flex h-full w-[480px] flex-col gap-3 overflow-y-auto bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-2">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              {cell.variant ? "Variant" : "Create variant"}
            </div>
            <div className="font-display text-xl text-slate-900">
              {cell.variant?.code ?? "—"}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            ×
          </button>
        </header>

        <ChipGroup>
          {Object.entries(cell.axisValues).map(([k, v]) => (
            <Chip key={k} kind="neutral" size="sm">
              <span className="text-slate-500">{k}:</span>
              <span className="ml-1 font-mono-token">{String(v ?? "—")}</span>
            </Chip>
          ))}
        </ChipGroup>

        {!cell.variant && (
          <div className="rounded-lg border border-dashed border-blue-300 bg-blue-50/50 p-3 text-xs text-blue-700">
            This combination has no variant yet. Create it to use in orders or planner stock.
          </div>
        )}

        {cell.variant?.geometry_snapshot && (
          <section className="rounded-lg border border-slate-200 bg-white p-3">
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Geometry
            </h3>
            <pre className="overflow-x-auto whitespace-pre-wrap font-mono-token text-[11px] text-slate-700">
              {JSON.stringify(cell.variant.geometry_snapshot, null, 2)}
            </pre>
          </section>
        )}

        <footer className="mt-auto flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            Close
          </button>
          {!cell.variant && (
            <button
              type="button"
              onClick={onCreate}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
            >
              Create variant
            </button>
          )}
        </footer>
      </aside>
    </div>
  );
}

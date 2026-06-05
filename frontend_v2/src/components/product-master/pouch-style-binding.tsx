"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Sparkles, Lock, ExternalLink } from "lucide-react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  pouchStyleService,
  computeChildTargetWidthMm,
  type PouchStyle,
} from "@/services/pouch-style";
import type { ProductMasterSize } from "@/services/product-master";

interface PouchStyleBindingProps {
  row: ProductMasterSize;
  onPatch: (patch: Partial<ProductMasterSize>) => void;
  className?: string;
  fallbackTargetWidthMm?: number | null;
}

/**
 * Renders a Pouch-Style binding card at the top of the size editor.
 * - Dropdown of all PouchStyleMaster rows
 * - Lists style's `allowed_fields` so operator knows what to fill below
 * - Shows live-computed child_target_width_mm from the formula
 * - Override toggle that lets operator type the target manually
 */
export function PouchStyleBinding({
  row,
  onPatch,
  className,
  fallbackTargetWidthMm = null,
}: PouchStyleBindingProps) {
  const { data: activeStyles = [], isLoading } = useQuery({
    queryKey: ["pouch-styles", "for-size", "approved"],
    queryFn: () =>
      pouchStyleService.list({
        page_size: 200,
        deprecated: false,
        locked: true,
      }),
    staleTime: 60_000,
  });

  const selectedId = String(row.pouch_style_master || "");
  const activeSelected: PouchStyle | undefined = activeStyles.find(
    (s) => s.id === selectedId,
  );
  const { data: savedSelected } = useQuery({
    queryKey: ["pouch-style", selectedId],
    queryFn: () => pouchStyleService.get(selectedId),
    enabled: !!selectedId && !activeSelected,
    staleTime: 60_000,
  });
  const styles = React.useMemo(() => {
    if (!savedSelected || activeStyles.some((s) => s.id === savedSelected.id))
      return activeStyles;
    return [savedSelected, ...activeStyles];
  }, [activeStyles, savedSelected]);
  const selected: PouchStyle | undefined = activeSelected || savedSelected;
  const geometryConfig =
    row.geometry_config && typeof row.geometry_config === "object"
      ? row.geometry_config
      : {};
  const customFormulaInputs =
    geometryConfig.pouch_formula_inputs &&
    typeof geometryConfig.pouch_formula_inputs === "object"
      ? (geometryConfig.pouch_formula_inputs as Record<string, any>)
      : {};

  // Build the input dict from the row (W, H, gusset, flap, …)
  const previewInputs = React.useMemo(() => {
    const out: Record<string, number> = {};
    if (row.width_mm != null) out.W = Number(row.width_mm);
    if (row.height_mm != null) out.H = Number(row.height_mm);
    if (row.gusset_mm != null) {
      out.gusset = Number(row.gusset_mm);
      out.G = Number(row.gusset_mm);
    }
    if (row.flap_tape_mm != null) {
      out.flap = Number(row.flap_tape_mm);
      out.flap_mm = Number(row.flap_tape_mm);
    }
    if (row.child_target_width_mm != null)
      out.override_width = Number(row.child_target_width_mm);
    for (const [key, value] of Object.entries(customFormulaInputs)) {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) out[key] = numeric;
    }
    for (const [key, def] of Object.entries(selected?.allowed_fields || {})) {
      if (out[key] != null) continue;
      if (def && def.default != null && def.default !== "") {
        const numeric = Number(def.default);
        if (Number.isFinite(numeric)) out[key] = numeric;
      }
    }
    return out;
  }, [
    row.width_mm,
    row.height_mm,
    row.gusset_mm,
    row.flap_tape_mm,
    row.child_target_width_mm,
    customFormulaInputs,
    selected,
  ]);

  const patchFormulaInput = (key: string, value: string) => {
    const nextInputs = { ...customFormulaInputs };
    if (value === "") delete nextInputs[key];
    else nextInputs[key] = Number(value);
    onPatch({
      geometry_config: {
        ...geometryConfig,
        pouch_formula_inputs: nextInputs,
      },
    });
  };

  const liveTarget = React.useMemo(() => {
    if (!selected) return null;
    try {
      return computeChildTargetWidthMm(
        {
          formula_kind: selected.formula_kind,
          formula_params: selected.formula_params || {},
          formula_ast: selected.formula_ast as any,
          field_adjustments: selected.field_adjustments || {},
        },
        previewInputs,
      );
    } catch {
      return null;
    }
  }, [selected, previewInputs]);

  const fallbackTarget =
    !selected &&
    fallbackTargetWidthMm != null &&
    Number.isFinite(Number(fallbackTargetWidthMm))
      ? Number(fallbackTargetWidthMm)
      : null;
  const displayedAutoTarget = liveTarget ?? fallbackTarget;
  const finalTarget = row.child_target_override
    ? Number(row.child_target_width_mm || 0)
    : displayedAutoTarget;
  const stockForm = String(
    row.stock_form || selected?.default_stock_form || "OPEN_WEB",
  ).toUpperCase();
  const widthBasis = String(
    row.width_basis ||
      selected?.default_width_basis ||
      widthBasisForStockForm(stockForm),
  ).toUpperCase();
  const slitPolicy = String(
    row.slit_policy ||
      selected?.default_slit_policy ||
      (stockForm === "OPEN_WEB" ? "SLIT_ALLOWED" : "EXACT_ONLY"),
  ).toUpperCase();
  const filmAreaWidth =
    Number(row.film_area_width_mm || 0) > 0
      ? Number(row.film_area_width_mm || 0)
      : Number(finalTarget || 0) * areaFactorForStockForm(stockForm);

  // Auto-compute and persist target when not in override mode and any input changes.
  React.useEffect(() => {
    if (!selected) return;
    if (row.child_target_override) return;
    if (liveTarget == null) return;
    const patch: Partial<ProductMasterSize> = {
      child_target_width_mm: liveTarget,
    };
    const nextStockForm = String(
      row.stock_form || selected.default_stock_form || "OPEN_WEB",
    ).toUpperCase();
    patch.stock_form = nextStockForm;
    patch.width_basis = String(
      row.width_basis ||
        selected.default_width_basis ||
        widthBasisForStockForm(nextStockForm),
    );
    patch.slit_policy = String(
      row.slit_policy ||
        selected.default_slit_policy ||
        (nextStockForm === "OPEN_WEB" ? "SLIT_ALLOWED" : "EXACT_ONLY"),
    );
    patch.film_area_width_mm =
      liveTarget * areaFactorForStockForm(nextStockForm);
    if (
      Number(row.child_target_width_mm || 0) === liveTarget &&
      String(row.stock_form || "") === patch.stock_form &&
      String(row.width_basis || "") === patch.width_basis &&
      String(row.slit_policy || "") === patch.slit_policy &&
      Number(row.film_area_width_mm || 0) === patch.film_area_width_mm
    )
      return;
    onPatch(patch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selected?.id,
    liveTarget,
    row.child_target_override,
    row.width_mm,
    row.height_mm,
    row.gusset_mm,
    row.flap_tape_mm,
  ]);

  return (
    <section
      className={cn(
        "rounded-2xl border border-order-border bg-gradient-to-br from-order-bg via-white to-order-bg p-4",
        className,
      )}
    >
      <header className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-order-fg text-white">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          <div>
            <h3 className="font-display text-sm font-bold text-content-1">
              Pouch style
            </h3>
            <p className="text-[10px] text-content-3">
              Pick a style master · formula auto-computes the target child web
              width.
            </p>
          </div>
        </div>
        <Link
          href="/master/pouch-styles"
          className="inline-flex items-center gap-1 text-[10px] font-bold text-order-fg hover:underline"
        >
          Manage styles <ExternalLink className="h-3 w-3" />
        </Link>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <div className="text-[10px] font-black uppercase tracking-widest text-content-3">
            Pouch style master
          </div>
          <Select
            value={selectedId || "__none__"}
            onValueChange={(v) => {
              if (v === "__none__") {
                onPatch({ pouch_style_master: null, pouch_style_version: 0 });
                return;
              }
              const next = activeStyles.find((s) => s.id === v);
              if (!next) return;
              const fieldAdjustments =
                next?.field_adjustments &&
                typeof next.field_adjustments === "object"
                  ? next.field_adjustments
                  : {};
              const nextInputs = { ...customFormulaInputs };
              if (
                next?.allowed_fields &&
                typeof next.allowed_fields === "object"
              ) {
                for (const key of Object.keys(nextInputs)) {
                  if (!(key in next.allowed_fields)) delete nextInputs[key];
                }
              }
              const trimDefault = Number(fieldAdjustments.trim_default_mm ?? 0);
              const trimAxis = String(
                fieldAdjustments.trim_axis ||
                  next?.default_roll_axis ||
                  "WIDTH",
              ).toUpperCase();
              const legacyStyle = legacyPouchStyleFor(next);
              onPatch({
                pouch_style_master: v,
                pouch_style_version: next?.version || 1,
                pouch_style: legacyStyle,
                roll_form: "",
                stock_form: next?.default_stock_form || "OPEN_WEB",
                width_basis:
                  next?.default_width_basis ||
                  widthBasisForStockForm(next?.default_stock_form),
                slit_policy:
                  next?.default_slit_policy ||
                  (next?.default_stock_form === "LAYFLAT_TUBE"
                    ? "EXACT_ONLY"
                    : "SLIT_ALLOWED"),
                film_area_width_mm:
                  liveTarget != null
                    ? liveTarget *
                      areaFactorForStockForm(next?.default_stock_form)
                    : row.film_area_width_mm,
                gusset_mm: hasAllowedField(next, GUSSET_KEYS)
                  ? row.gusset_mm
                  : 0,
                flap_tape_mm: hasAllowedField(next, FLAP_KEYS)
                  ? row.flap_tape_mm
                  : 0,
                trim_loss_mm: Number.isFinite(trimDefault)
                  ? trimDefault
                  : row.trim_loss_mm,
                trim_apply_to: ["WIDTH", "HEIGHT", "BOTH", "NONE"].includes(
                  trimAxis,
                )
                  ? (trimAxis as any)
                  : "WIDTH",
                geometry_config: {
                  ...geometryConfig,
                  pouch_style: legacyStyle,
                  roll_form: "",
                  trim_loss_mm: Number.isFinite(trimDefault)
                    ? trimDefault
                    : row.trim_loss_mm,
                  trim_apply_to: ["WIDTH", "HEIGHT", "BOTH", "NONE"].includes(
                    trimAxis,
                  )
                    ? trimAxis
                    : "WIDTH",
                  flap_tape_mm: hasAllowedField(next, FLAP_KEYS)
                    ? row.flap_tape_mm || 0
                    : 0,
                  gusset_apply_to:
                    fieldAdjustments.gusset_axis ||
                    row.gusset_apply_to ||
                    "NONE",
                  gusset_factor: row.gusset_factor ?? 1,
                  pouch_formula_inputs: nextInputs,
                },
              });
            }}
          >
            <SelectTrigger className="mt-1 h-9">
              <SelectValue
                placeholder={isLoading ? "Loading…" : "Pick a pouch style"}
              />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">— None (manual entry) —</SelectItem>
              {styles.map((s) => (
                <SelectItem
                  key={s.id}
                  value={s.id}
                  disabled={!s.locked || s.deprecated}
                >
                  <span className="mr-1">{s.visual_emoji}</span> {s.code} ·{" "}
                  {s.name}
                  {s.deprecated
                    ? " · disabled"
                    : !s.locked
                      ? " · draft (approve first)"
                      : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selected ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px]">
              <Badge
                variant="outline"
                className="border-order-border bg-order-bg text-order-fg"
              >
                v{selected.version}
              </Badge>
              <span className="font-mono text-[10px] text-content-2">
                {selected.formula_kind}
              </span>
              {selected.locked ? (
                <Badge
                  variant="outline"
                  className="border-success-border bg-success-bg text-[9px] text-success-fg"
                >
                  <Lock className="mr-0.5 h-2.5 w-2.5" /> locked
                </Badge>
              ) : null}
              {selected.deprecated ? (
                <Badge
                  variant="outline"
                  className="border-warning-border bg-warning-bg text-[9px] text-warning-fg"
                >
                  disabled style
                </Badge>
              ) : null}
              {!selected.locked ? (
                <Badge
                  variant="outline"
                  className="border-warning-border bg-warning-bg text-[9px] text-warning-fg"
                >
                  draft · approve first
                </Badge>
              ) : null}
              <Badge
                variant="outline"
                className="border-info-border bg-info-bg text-[9px] text-primary"
              >
                {stockFormLabel(selected.default_stock_form)} stock
              </Badge>
            </div>
          ) : null}
          {selected ? (
            <div className="mt-2 rounded-lg bg-surface-1 p-2 ring-1 ring-order-border text-[11px]">
              <div className="text-[10px] font-black uppercase tracking-widest text-order-fg">
                Allowed inputs
              </div>
              <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
                {Object.entries(selected.allowed_fields || {}).map(
                  ([k, def]) => (
                    <span
                      key={k}
                      className={cn(
                        "rounded px-1.5 py-0.5 font-mono ring-1",
                        def.required
                          ? "bg-success-bg text-success-fg ring-success-border"
                          : "bg-surface-2 text-content-2 ring-line",
                      )}
                    >
                      {k}
                      {def.required ? " *" : ""}
                    </span>
                  ),
                )}
              </div>
              <div className="mt-1 font-mono text-[10px] text-content-3">
                {selected.formula_expression || ""}
              </div>
              <FormulaInputGrid
                style={selected}
                values={previewInputs}
                row={row}
                onPatchRow={onPatch}
                onPatch={patchFormulaInput}
              />
            </div>
          ) : (
            <div className="mt-2 rounded-lg border border-dashed border-warning-border bg-warning-bg p-2 text-[11px] text-warning-fg">
              Pick a pouch style master to show only the exact allowed size
              inputs and auto child-width formula. Manual fallback keeps only
              W/H.
              <ManualFallbackInputs row={row} onPatchRow={onPatch} />
            </div>
          )}
          {selected && (!selected.locked || selected.deprecated) ? (
            <div className="mt-2 rounded-lg border border-warning-border bg-warning-bg px-2 py-1.5 text-[10.5px] font-medium text-warning-fg">
              This saved size references a historical or draft style version.
              Existing math is preserved; new bindings must use an approved
              locked style.
            </div>
          ) : null}
        </div>

        <div className="space-y-2">
          {/* AUTO computed (always shown) */}
          <div>
            <div className="text-[10px] font-black uppercase tracking-widest text-content-3">
              {selected
                ? "Auto child width (from formula)"
                : "Current child width (legacy/manual)"}
            </div>
            <div
              className={cn(
                "mt-1 rounded-xl p-3 text-white",
                row.child_target_override ? "bg-line" : "bg-success-fg",
              )}
            >
              <div className="font-display text-3xl font-extrabold">
                {displayedAutoTarget != null
                  ? displayedAutoTarget.toFixed(2)
                  : "—"}
                <span className="ml-1 text-base font-bold">mm</span>
              </div>
              <div className="text-[10px] text-white/90">
                {selected
                  ? row.child_target_override
                    ? "auto value · NOT used (override active)"
                    : "auto value · this is what will be used"
                  : fallbackTarget != null
                    ? "saved legacy/manual geometry · pick a style to switch to formula"
                    : "no style picked — pick one above"}
              </div>
            </div>
          </div>

          {/* OVERRIDE input (always visible) */}
          <div>
            <div className="flex items-center justify-between">
              <div className="text-[10px] font-black uppercase tracking-widest text-content-3">
                Override (optional)
              </div>
              {row.child_target_override ? (
                <button
                  type="button"
                  onClick={() =>
                    onPatch({
                      child_target_override: false,
                      child_target_width_mm: liveTarget,
                    })
                  }
                  className="text-[10px] font-bold text-danger-fg underline hover:text-danger-fg"
                >
                  Clear override
                </button>
              ) : null}
            </div>
            <Input
              type="number"
              min={0}
              step="any"
              value={
                row.child_target_override
                  ? Number(row.child_target_width_mm || 0)
                  : ""
              }
              placeholder="leave blank to use auto"
              onChange={(e) => {
                const v = e.target.value;
                if (v === "") {
                  onPatch({
                    child_target_override: false,
                    child_target_width_mm: liveTarget,
                  });
                } else {
                  onPatch({
                    child_target_override: true,
                    child_target_width_mm: Number(v),
                  });
                }
              }}
              className={cn(
                "mt-1 h-9 font-mono",
                row.child_target_override
                  ? "border-warning-border ring-1 ring-warning-border"
                  : "",
              )}
            />
            <div className="mt-1 text-[10px] text-content-3">
              {row.child_target_override
                ? "Override active. Lane/slit logic uses this value, not the auto."
                : "Blank = use auto value above. Type a number to override per-size."}
            </div>
          </div>

          {/* Final value used downstream */}
          <div className="rounded-xl border-2 border-order-border bg-order-bg p-2.5">
            <div className="text-[10px] font-black uppercase tracking-widest text-order-fg">
              Final width used downstream
            </div>
            <div className="mt-1 font-mono text-lg font-extrabold text-order-fg">
              {(finalTarget ?? 0).toFixed(2)} mm
            </div>
            <div className="mt-0.5 text-[10px] text-order-fg">
              Drives lane-up math, planned parent width, allocator tiers, slit
              confirm.
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <StockMetric label="Stock form" value={stockFormLabel(stockForm)} />
            <StockMetric
              label="Width basis"
              value={widthBasisLabel(widthBasis)}
            />
            <StockMetric
              label="Film area width"
              value={`${Number(filmAreaWidth || 0).toFixed(2)} mm`}
            />
            <StockMetric
              label="Allocator"
              value={
                slitPolicy === "EXACT_ONLY" ? "Exact only" : "Slit allowed"
              }
            />
          </div>
        </div>
      </div>
    </section>
  );
}

function StockMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface-1 px-2.5 py-2">
      <div className="text-[9px] font-black uppercase tracking-wider text-content-3">
        {label}
      </div>
      <div className="mt-0.5 font-mono text-[11px] font-black text-content-1">
        {value}
      </div>
    </div>
  );
}

function areaFactorForStockForm(stockForm?: string) {
  return String(stockForm || "OPEN_WEB").toUpperCase() === "LAYFLAT_TUBE"
    ? 2
    : 1;
}

function widthBasisForStockForm(stockForm?: string) {
  return String(stockForm || "OPEN_WEB").toUpperCase() === "LAYFLAT_TUBE"
    ? "LAYFLAT_WIDTH"
    : String(stockForm || "").toUpperCase() === "FOLDED_WEB"
      ? "FOLDED_WIDTH"
      : "OPEN_WEB_WIDTH";
}

function stockFormLabel(value?: string) {
  const v = String(value || "OPEN_WEB").toUpperCase();
  if (v === "LAYFLAT_TUBE") return "Lay-flat tube";
  if (v === "FOLDED_WEB") return "Folded web";
  return "Open web";
}

function widthBasisLabel(value?: string) {
  const v = String(value || "OPEN_WEB_WIDTH").toUpperCase();
  if (v === "LAYFLAT_WIDTH") return "Lay-flat width";
  if (v === "FOLDED_WIDTH") return "Folded width";
  return "Open-web width";
}

const WIDTH_KEYS = new Set(["W", "width", "width_mm"]);
const HEIGHT_KEYS = new Set(["H", "height", "height_mm"]);
const GUSSET_KEYS = new Set(["G", "gusset", "gusset_mm"]);
const FLAP_KEYS = new Set(["flap", "flap_mm"]);
const OVERRIDE_KEYS = new Set([
  "override_width",
  "target_child_width_mm",
  "child_target_width_mm",
]);

function numericInputValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "";
  const next = Number(value);
  return Number.isFinite(next) ? String(next) : "";
}

function fieldIsRequired(def: any) {
  return Boolean(def && typeof def === "object" && def.required);
}

function hasAllowedField(style: PouchStyle | undefined, keys: Set<string>) {
  if (
    !style ||
    !style.allowed_fields ||
    typeof style.allowed_fields !== "object"
  )
    return false;
  return Object.keys(style.allowed_fields).some((key) => keys.has(key));
}

function styleRequiresGusset(style: PouchStyle | undefined) {
  if (
    !style ||
    !style.allowed_fields ||
    typeof style.allowed_fields !== "object"
  )
    return false;
  return Object.entries(style.allowed_fields).some(
    ([key, def]) => GUSSET_KEYS.has(key) && fieldIsRequired(def),
  );
}

function legacyPouchStyleFor(style: PouchStyle | undefined) {
  if (!style) return "PILLOW";
  const code = String(style.code || "").toUpperCase();
  const kind = String(style.formula_kind || "").toUpperCase();
  if (code.includes("CENTER") || kind === "CENTER_SEAL_H") return "CENTER_SEAL";
  if (code.includes("STICK") || kind === "STICK_PACK") return "STICK_PACK";
  if (code.includes("SACHET") || kind === "SACHET") return "SACHET";
  if (code.includes("SPOUT") || kind === "SPOUT") return "SPOUT";
  if (code.includes("QUAD") || kind === "QUAD_SEAL") return "QUAD_SEAL";
  if (code.includes("FLAT_BOTTOM") || kind === "FLAT_BOTTOM")
    return "FLAT_BOTTOM";
  if (code.includes("SIDE") || kind === "GUSSETED_SIDE") return "SIDE_GUSSET";
  if (
    (code.includes("STAND") || kind === "GUSSETED_BOTTOM") &&
    styleRequiresGusset(style)
  )
    return "STAND_UP";
  if (code.includes("THREE") || kind === "THREE_SIDE_SEAL")
    return "THREE_SIDE_SEAL";
  if (kind === "SHAPED_OVERRIDE" || code.includes("SHAPED")) return "SHAPED";
  return "PILLOW";
}

function FormulaInputGrid({
  style,
  values,
  row,
  onPatchRow,
  onPatch,
}: {
  style: PouchStyle;
  values: Record<string, number>;
  row: ProductMasterSize;
  onPatchRow: (patch: Partial<ProductMasterSize>) => void;
  onPatch: (key: string, value: string) => void;
}) {
  const fields = Object.entries(style.allowed_fields || {});
  if (fields.length === 0) return null;

  const patchAllowedField = (key: string, value: string) => {
    const numberValue = value === "" ? null : Number(value);
    if (WIDTH_KEYS.has(key)) {
      onPatchRow({ width_mm: numberValue as any });
      return;
    }
    if (HEIGHT_KEYS.has(key)) {
      onPatchRow({ height_mm: numberValue as any });
      return;
    }
    if (GUSSET_KEYS.has(key)) {
      onPatchRow({ gusset_mm: numberValue as any });
      return;
    }
    if (FLAP_KEYS.has(key)) {
      onPatchRow({ flap_tape_mm: numberValue as any });
      return;
    }
    if (OVERRIDE_KEYS.has(key)) {
      onPatchRow({
        child_target_override: value !== "",
        child_target_width_mm: numberValue as any,
      });
      return;
    }
    onPatch(key, value);
  };

  const valueForField = (key: string) => {
    if (WIDTH_KEYS.has(key)) return numericInputValue(row.width_mm);
    if (HEIGHT_KEYS.has(key)) return numericInputValue(row.height_mm);
    if (GUSSET_KEYS.has(key)) return numericInputValue(row.gusset_mm);
    if (FLAP_KEYS.has(key)) return numericInputValue(row.flap_tape_mm);
    if (OVERRIDE_KEYS.has(key))
      return row.child_target_override
        ? numericInputValue(row.child_target_width_mm)
        : "";
    return numericInputValue(values[key]);
  };

  return (
    <div className="mt-2 rounded-lg border border-dashed border-order-border bg-order-bg p-2">
      <div className="text-[10px] font-black uppercase tracking-widest text-order-fg">
        Allowed size inputs
      </div>
      <div className="mt-1 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map(([key, def]) => {
          const required = fieldIsRequired(def);
          const value = valueForField(key);
          const missing = required && Number(value || 0) <= 0;
          return (
            <label key={key} className="block">
              <div className="mb-0.5 flex items-center justify-between gap-2">
                <span className="text-[9px] font-bold uppercase tracking-wider text-content-3">
                  {def.label || key}
                  {required ? " *" : ""}
                </span>
                <span className="font-mono text-[9px] text-content-4">
                  {key}
                </span>
              </div>
              <Input
                type="number"
                step="any"
                value={value}
                onChange={(event) => patchAllowedField(key, event.target.value)}
                placeholder={def.default != null ? String(def.default) : "0"}
                className={cn(
                  "h-8 bg-surface-1 font-mono text-xs",
                  missing && "border-warning-border bg-warning-bg",
                )}
              />
            </label>
          );
        })}
      </div>
      <div className="mt-1 text-[10px] text-order-fg">
        Only fields allowed by this pouch style are shown. These values feed the
        formula and are saved on this size.
      </div>
    </div>
  );
}

function ManualFallbackInputs({
  row,
  onPatchRow,
}: {
  row: ProductMasterSize;
  onPatchRow: (patch: Partial<ProductMasterSize>) => void;
}) {
  return (
    <div className="mt-2 grid gap-2 sm:grid-cols-2">
      <label className="block">
        <span className="text-[9px] font-bold uppercase tracking-wider text-content-3">
          Final width *
        </span>
        <Input
          type="number"
          step="any"
          value={numericInputValue(row.width_mm)}
          onChange={(event) =>
            onPatchRow({
              width_mm:
                event.target.value === ""
                  ? (null as any)
                  : Number(event.target.value),
            })
          }
          className="mt-0.5 h-8 bg-surface-1 font-mono text-xs"
        />
      </label>
      <label className="block">
        <span className="text-[9px] font-bold uppercase tracking-wider text-content-3">
          Final height *
        </span>
        <Input
          type="number"
          step="any"
          value={numericInputValue(row.height_mm)}
          onChange={(event) =>
            onPatchRow({
              height_mm:
                event.target.value === ""
                  ? (null as any)
                  : Number(event.target.value),
            })
          }
          className="mt-0.5 h-8 bg-surface-1 font-mono text-xs"
        />
      </label>
    </div>
  );
}

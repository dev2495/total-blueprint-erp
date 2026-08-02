import { Layers3, Ruler, ScrollText, Shapes, Sparkles, Waves } from "lucide-react";

import { normalizeProductSpec, type ProductSpec } from "@/lib/product-spec";
import { cn } from "@/lib/utils";

type SpecTone = "amber" | "emerald" | "blue" | "cyan" | "violet" | "rose";

type SpecMetric = {
  key: string;
  label: string;
  value: string;
  note: string;
  details?: string[];
  tone: SpecTone;
  icon: typeof Layers3;
};

export type ProductionOrderSpecRailProps = {
  source: unknown;
  context?: unknown;
  className?: string;
  dark?: boolean;
};

const metricTone: Record<SpecTone, string> = {
  amber: "border-warning-border bg-warning-bg text-warning-fg",
  emerald: "border-success-border bg-success-bg text-success-fg",
  blue: "border-info-border bg-info-bg text-info-fg",
  cyan: "border-info-border bg-info-bg text-primary",
  violet: "border-order-border bg-order-bg text-order-fg",
  rose: "border-order-border bg-order-bg text-order-fg",
};

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function text(...values: unknown[]): string {
  for (const value of values) {
    const clean = String(value ?? "").trim();
    if (
      clean &&
      clean !== "-" &&
      clean !== "—" &&
      !["null", "undefined", "nan"].includes(clean.toLowerCase())
    ) {
      return clean;
    }
  }
  return "";
}

function numberFrom(sources: unknown[], keys: string[]): number | null {
  for (const sourceValue of sources) {
    const source = record(sourceValue);
    for (const key of keys) {
      const parsed = Number(source[key]);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
  }
  return null;
}

function compactNumber(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function humanizeCode(value: string): string {
  const clean = value.trim();
  if (!clean) return "";
  if (!/[\s_-]/.test(clean)) return clean;
  return clean
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function stockFormLabel(value: unknown): string {
  const normalized = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if (["TUBE", "LAYFLAT", "LAY_FLAT", "LAYFLAT_TUBE", "LAY_FLAT_TUBE"].includes(normalized)) {
    return "Lay-flat tube";
  }
  if (["FOLDED", "FOLDED_SHEET", "FOLDED_WEB"].includes(normalized)) {
    return "Folded web";
  }
  if (["OPEN_WEB", "OPENWEB", "FLAT", "SHEET"].includes(normalized)) {
    return "Open web";
  }
  return humanizeCode(String(value || ""));
}

function widthBasisLabel(value: unknown, stockForm: string): string {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  if (normalized === "LAYFLAT_WIDTH") return "lay-flat width";
  if (normalized === "FOLDED_WIDTH") return "folded width";
  if (normalized === "OPEN_WEB_WIDTH") return "open-web width";
  if (stockForm === "Lay-flat tube") return "lay-flat width";
  if (stockForm === "Folded web") return "folded width";
  return stockForm ? "open-web width" : "stock form target";
}

function layerThicknessExpression(spec: ProductSpec, source: Record<string, any>): string {
  const fromLayers = spec.layers
    .map((layer) => layer.thicknessMicron)
    .filter((value): value is number => value != null && value > 0)
    .map(compactNumber)
    .join(" + ");
  if (fromLayers) return `${fromLayers} µ`;

  const productSpec = record(source.product_spec);
  const summary = record(source.item_summary);
  const summaryFacets = record(summary.spec_facets);
  const layerStack = record(productSpec.layer_stack);
  const summaryLayerStack = record(summaryFacets.layer_stack);
  const fallback = text(
    layerStack.thickness_label,
    layerStack.thickness_expression,
    productSpec.thickness_expression,
    summaryLayerStack.thickness_label,
    summaryLayerStack.thickness_expression,
    summaryFacets.thickness_expression,
    source.thickness_micron,
  );
  if (!fallback) return "Not captured";
  return `${fallback.replace(/\s*(?:µ|μ|um|u)\b/gi, "").replace(/\s*\+\s*/g, " + ")} µ`;
}

function orderTarget(sourceValue: unknown, contextValue: unknown) {
  const source = record(sourceValue);
  const context = record(contextValue);
  const sourceGeometry = record(source.geometry || source.geometry_snapshot);
  const contextGeometry = record(record(context.job).geometry);
  const sourceBase = record(sourceGeometry.base);
  const contextBase = record(contextGeometry.base);
  const invariantList = Array.isArray(context.target_roll_invariant_list)
    ? context.target_roll_invariant_list
    : [];
  const directContract = record(context.target_stock_contract);
  const directInvariant = record(context.target_roll_invariants);
  const firstInvariant =
    invariantList.find((row: any) =>
      Boolean(row?.stock_form || row?.width_basis || row?.output_width_mm || row?.target_width_mm || row?.min_width_mm),
    ) || {};

  const stockFormRaw = text(
    firstInvariant.stock_form,
    directContract.stock_form,
    directInvariant.stock_form,
    contextGeometry.stock_form,
    contextGeometry.roll_form,
    sourceGeometry.stock_form,
    sourceGeometry.roll_form,
  );
  const stockForm = stockFormLabel(stockFormRaw);
  const widthBasis = text(
    firstInvariant.width_basis,
    directContract.width_basis,
    directInvariant.width_basis,
    contextGeometry.width_basis,
    sourceGeometry.width_basis,
  );
  const widthMm = numberFrom(
    [
      firstInvariant,
      ...invariantList,
      directContract,
      directInvariant,
      contextGeometry,
      sourceGeometry,
      contextBase,
      sourceBase,
    ],
    [
      "output_width_mm",
      "target_width_mm",
      "finished_width_mm",
      "planned_parent_width_mm",
      "child_target_width_mm",
      "film_area_width_mm",
      "final_web_width_mm",
      "roll_width_mm",
      "min_width_mm",
      "fixed_width_mm",
      "width_mm",
      "width",
    ],
  );
  return { stockForm, widthBasis, widthMm };
}

function finishedSizeLabel(spec: ProductSpec, source: Record<string, any>): string {
  const label = String(spec.size?.label || "Not captured")
    .replace(/\s+x\s+/gi, " × ")
    .split(" · ")[0];
  const missingSecondAxis = /\s×\s*(?:—|-)(?:\s*mm)?$/i.test(label);
  const rollOutput =
    String(spec.size?.finishedGoodType || "").toUpperCase() === "ROLL" ||
    String(source.output_form || source.final_output_form || "").toUpperCase() ===
      "ROLL";
  if (missingSecondAxis && rollOutput && spec.size.widthMm != null) {
    return `${compactNumber(spec.size.widthMm)} mm roll`;
  }
  return label;
}

function gradeSummary(spec: ProductSpec): string {
  const grades = Array.from(
    new Set(spec.layers.map((layer) => layer.grade).filter(Boolean)),
  );
  return grades.join(" / ") || "Not captured";
}

function layerVariantLabel(layer: ProductSpec["layers"][number]): string {
  return text(layer.variantCode, layer.variantName, `Layer ${layer.index}`);
}

export function ProductionOrderSpecRail({
  source: sourceValue,
  context: contextValue,
  className,
  dark = false,
}: ProductionOrderSpecRailProps) {
  const source = record(sourceValue);
  const spec = normalizeProductSpec(sourceValue, contextValue);
  const target = orderTarget(sourceValue, contextValue);
  const pouchStyle = humanizeCode(spec.pouchStyle);
  const layerCount = spec.layers.length;

  const metrics: SpecMetric[] = [
    {
      key: "thickness",
      label: layerCount > 1 ? "Layer thickness" : "Thickness",
      value: layerThicknessExpression(spec, source),
      note: layerCount > 1 ? "per-layer gauge" : "film gauge",
      tone: "amber",
      icon: Layers3,
    },
    {
      key: "width",
      label: "Required web",
      value: target.widthMm ? `${compactNumber(target.widthMm)} mm` : "Not captured",
      note: "production roll width",
      tone: "emerald",
      icon: Ruler,
    },
    {
      key: "form",
      label: "Stock form",
      value: target.stockForm || spec.size.formLabel || "Not captured",
      note: target.widthMm
        ? `roll width · ${widthBasisLabel(target.widthBasis, target.stockForm)}`
        : widthBasisLabel(target.widthBasis, target.stockForm),
      details: [
        target.widthMm
          ? `${compactNumber(target.widthMm)} mm`
          : "",
        pouchStyle ? `Pouch · ${pouchStyle}` : "",
      ].filter(Boolean),
      tone: "cyan",
      icon: Waves,
    },
    {
      key: "size",
      label: "Finished size",
      value: finishedSizeLabel(spec, source),
      note: "order dimensions",
      tone: "blue",
      icon: Shapes,
    },
    {
      key: "grade",
      label: "Grade",
      value: gradeSummary(spec),
      note: layerCount > 1 ? "across film layers" : "film grade",
      tone: "violet",
      icon: ScrollText,
    },
  ];

  if (pouchStyle) {
    metrics.push({
      key: "pouch",
      label: "Pouch style",
      value: pouchStyle,
      note: "finished construction",
      tone: "rose",
      icon: Sparkles,
    });
  }

  return (
    <section
      className={cn(
        "rounded-2xl border p-3",
        dark
          ? "border-white/15 bg-[#0e2e58]/55"
          : "border-line bg-surface-2",
        className,
      )}
      data-testid="production-order-spec-rail"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          className={cn(
            "text-[11px] font-black uppercase tracking-[0.2em]",
            dark ? "text-info-border" : "text-content-3",
          )}
        >
          Production spec
        </div>
        <span
          className={cn(
            "rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wider",
            dark
              ? "border-white/20 bg-white/10 text-white"
              : "border-line bg-surface-1 text-content-2",
          )}
        >
          {layerCount > 0
            ? `${layerCount} film layer${layerCount === 1 ? "" : "s"}`
            : "Layer stack not captured"}
        </span>
      </div>

      <div className="mt-2.5 grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(138px,1fr))]">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <div
              key={metric.key}
              className={cn(
                "min-w-0 rounded-xl border px-3 py-2.5 shadow-sm",
                metricTone[metric.tone],
              )}
              data-spec-field={metric.key}
            >
              <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.15em] opacity-75">
                <Icon className="h-3.5 w-3.5 shrink-0" />
                <span>{metric.label}</span>
              </div>
              <div className="mt-1 break-words font-mono text-lg font-black leading-tight md:text-xl">
                {metric.value}
              </div>
              {metric.details?.length ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {metric.details.map((detail) => (
                    <span
                      key={detail}
                      className="rounded-md border border-current/20 bg-white/65 px-2 py-1 text-xs font-black leading-none"
                    >
                      {detail}
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="mt-1 text-[10px] font-bold leading-tight opacity-70">
                {metric.note}
              </div>
            </div>
          );
        })}
      </div>

      {spec.layers.length ? (
        <div className="mt-2.5 grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]">
          {spec.layers.map((layer) => (
            <div
              key={`${layer.index}-${layerVariantLabel(layer)}`}
              className={cn(
                "flex min-w-0 items-center gap-2 rounded-xl border px-3 py-2",
                dark
                  ? "border-white/20 bg-white/10 text-white"
                  : "border-order-border bg-order-bg text-order-fg",
              )}
              data-spec-layer={layer.index}
            >
              <span
                className={cn(
                  "grid h-8 w-8 shrink-0 place-items-center rounded-lg font-mono text-xs font-black",
                  dark ? "bg-white text-[#153f73]" : "bg-surface-1 text-order-fg",
                )}
              >
                L{layer.index}
              </span>
              <div className="min-w-0 flex-1">
                <div className="break-words font-mono text-base font-black leading-tight md:text-lg">
                  {layerVariantLabel(layer)}
                </div>
                <div
                  className={cn(
                    "mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] font-black",
                    dark ? "text-info-border" : "text-order-fg/80",
                  )}
                >
                  {layer.thicknessMicron != null ? (
                    <span>{compactNumber(layer.thicknessMicron)} µ</span>
                  ) : null}
                  {layer.grade ? <span>Grade {layer.grade}</span> : null}
                  {layer.widthMm != null ? (
                    <span>{compactNumber(layer.widthMm)} mm web</span>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

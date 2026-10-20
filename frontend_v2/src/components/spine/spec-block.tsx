"use client";

/**
 * The product spec in large, readable type: size first, then every layer with its
 * thickness and grade. One component for orders, the composer, the planner, the WC
 * terminal, the machine screen and the yard, so a size or a micron reads the same
 * everywhere. Presentational only.
 */
import { normalizeProductSpec, type ProductSpec } from "@/lib/product-spec";
import { cn } from "@/lib/utils";
import type { SpineMade } from "@/services/spine";

export interface SpecBlockLayer {
  index: number;
  name: string;
  micron: number | null;
  grade?: string;
  source?: string;
  /** Short extra word under the layer name (e.g. "fixed", "40–60 allowed"). */
  note?: string;
}

export interface SpecBlockData {
  sizeLabel: string;
  widthMm?: number | null;
  heightMm?: number | null;
  gussetMm?: number | null;
  style?: string;
  layers: SpecBlockLayer[];
}

const fmt = (value: number | null | undefined, digits = 1) =>
  value === null || value === undefined || !Number.isFinite(value) ? "" : value.toLocaleString("en-IN", { maximumFractionDigits: digits });

function sizeText(data: SpecBlockData) {
  if (data.widthMm && data.heightMm) return `${fmt(data.widthMm)} × ${fmt(data.heightMm)} mm`;
  if (data.widthMm) return `${fmt(data.widthMm)} mm`;
  return data.sizeLabel && data.sizeLabel !== "Size not captured" ? data.sizeLabel : "";
}

function sourceWord(source?: string) {
  const s = String(source || "").toUpperCase();
  if (s.includes("EXTRU")) return "made here";
  if (s.includes("PURCH")) return "bought";
  return "";
}

/** From the order spine payload (backend-resolved names, grades and sources). */
export function specFromMade(made: SpineMade | null | undefined): SpecBlockData | null {
  if (!made) return null;
  const first = made.lines?.[0];
  return {
    sizeLabel: made.size || first?.size || "",
    widthMm: first?.width_mm ?? null,
    heightMm: first?.height_mm ?? null,
    gussetMm: first?.gusset_mm ?? null,
    style: made.pouch_style || first?.pouch_style || "",
    layers: (made.layers || first?.layers || []).map((layer) => ({
      index: layer.index,
      name: layer.name,
      micron: layer.micron,
      grade: layer.grade,
      source: layer.source,
    })),
  };
}

/** From any order line / job / stock order the existing normaliser understands. */
export function specFromSource(source: unknown, context?: unknown): SpecBlockData {
  const spec: ProductSpec = normalizeProductSpec(source, context);
  return {
    sizeLabel: spec.size.label,
    widthMm: spec.size.widthMm,
    heightMm: spec.size.heightMm,
    gussetMm: spec.size.gussetMm,
    style: spec.pouchStyle,
    layers: spec.layers.map((layer) => ({
      index: layer.index,
      name: layer.variantName || layer.variantCode || layer.label || `Layer ${layer.index}`,
      micron: layer.thicknessMicron,
      grade: layer.grade,
    })),
  };
}

export function SpecBlock({
  data,
  size = "lg",
  dark = false,
  stack = false,
  className,
  testId = "spec-block",
}: {
  data: SpecBlockData | null | undefined;
  size?: "lg" | "md";
  dark?: boolean;
  /** One layer per row, for narrow rails. */
  stack?: boolean;
  className?: string;
  testId?: string;
}) {
  if (!data) return null;
  const sizeValue = sizeText(data);
  const layers = data.layers.filter((layer) => layer.name || layer.micron);
  if (!sizeValue && !layers.length) return null;
  const total = layers.reduce((sum, layer) => sum + (layer.micron || 0), 0);
  const lg = size === "lg";
  const muted = dark ? "text-white/65" : "text-content-3";
  const strong = dark ? "text-white" : "text-content-1";
  const tile = dark ? "bg-white/10 ring-1 ring-white/15" : "bg-surface-1 ring-1 ring-line";

  return (
    <div className={cn("grid min-w-0 gap-2", className)} data-testid={testId}>
      {sizeValue ? (
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <span className={cn("text-[12px] font-medium", muted)}>Size</span>
          <span className={cn("font-semibold tabular-nums tracking-tight", strong, lg ? "text-2xl" : "text-lg")} data-testid={`${testId}-size`}>
            {sizeValue}
          </span>
          {data.gussetMm ? (
            <span className={cn("font-semibold tabular-nums", strong, lg ? "text-lg" : "text-base")}>gusset {fmt(data.gussetMm)}</span>
          ) : null}
          {data.style ? <span className={cn("text-[13px] font-medium", muted)}>{data.style.replace(/_/g, " ").toLowerCase()}</span> : null}
        </div>
      ) : null}
      {layers.length ? (
        <div
          className={cn(
            "grid gap-1.5",
            // Tiles fill the space they are given, so a narrow card shows one layer per row
            // instead of breaking material names mid-word.
            stack ? "" : lg ? "grid-cols-[repeat(auto-fill,minmax(min(100%,240px),1fr))]" : "grid-cols-[repeat(auto-fill,minmax(min(100%,220px),1fr))]",
          )}
          data-testid={`${testId}-layers`}
        >
          {layers.map((layer) =>
            stack ? (
              // Narrow rails: layer number and micron on top, the full material name underneath.
              <div key={`${layer.index}-${layer.name}`} className={cn("min-w-0 rounded-xl px-2.5 py-1.5", tile)}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className={cn("font-mono text-[12px] font-semibold", muted)}>L{layer.index}</span>
                  {layer.micron ? (
                    <span className={cn("text-[15px] font-semibold tabular-nums", strong)}>
                      {fmt(layer.micron)}
                      <span className={cn("ml-0.5 text-[12px] font-medium", muted)}>µ</span>
                    </span>
                  ) : null}
                </div>
                <div className={cn("break-words text-[13.5px] font-semibold leading-snug", strong)} title={layer.name}>
                  {layer.name}
                </div>
                {layer.grade || sourceWord(layer.source) ? (
                  <div className={cn("text-[12px] leading-snug", muted)}>
                    {[layer.grade ? `Grade ${layer.grade}` : "", sourceWord(layer.source)].filter(Boolean).join(" · ")}
                  </div>
                ) : null}
              </div>
            ) : (
            <div key={`${layer.index}-${layer.name}`} className={cn("flex min-w-0 items-center gap-3 rounded-xl px-3", lg ? "py-2" : "py-1.5", tile)}>
              <span className={cn("flex-none font-mono text-[12px] font-semibold", muted)}>L{layer.index}</span>
              <div className="min-w-0 flex-1">
                <div className={cn("line-clamp-2 break-words font-semibold leading-snug", strong, lg ? "text-[15px]" : "text-[14px]")} title={layer.name}>
                  {layer.name}
                </div>
                {layer.grade || sourceWord(layer.source) ? (
                  <div className={cn("text-[12.5px] leading-snug", muted)}>
                    {[layer.grade ? `Grade ${layer.grade}` : "", sourceWord(layer.source)].filter(Boolean).join(" · ")}
                  </div>
                ) : null}
              </div>
              {layer.micron ? (
                <span className={cn("flex-none font-semibold tabular-nums", strong, lg ? "text-xl" : "text-lg")}>
                  {fmt(layer.micron)}
                  <span className={cn("ml-0.5 text-[13px] font-medium", muted)}>µ</span>
                </span>
              ) : null}
            </div>
            ),
          )}
          {layers.length > 1 && total > 0 ? (
            <div className={cn("flex items-center justify-between gap-3 rounded-xl px-3", lg ? "py-2" : "py-1.5", dark ? "bg-white/5" : "bg-surface-2")}>
              <span className={cn("text-[13px] font-medium", muted)}>Total</span>
              <span className={cn("font-semibold tabular-nums", strong, lg ? "text-xl" : "text-lg")}>
                {fmt(total)}
                <span className={cn("ml-0.5 text-[13px] font-medium", muted)}>µ</span>
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

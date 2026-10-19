"use client";

/**
 * The spec plate: one dark surface that says what is being made — size in large numerals,
 * every layer with its micron and grade, the total gauge and a cross-section drawn to scale.
 * The order composer, the product master, the stock launcher and every "what is to be made"
 * card use it, so a size or a micron reads the same on every screen. Presentational only.
 */
import * as React from "react";

import { cn } from "@/lib/utils";
import type { SpecBlockData, SpecBlockLayer } from "@/components/spine/spec-block";

export type FilmFamily = "pet" | "met" | "pe" | "pp" | "ny" | "al" | "paper" | "other";

/** Film family from a layer name or code, for the cross-section colour only. */
export function filmFamily(name: string | null | undefined): FilmFamily {
  const s = String(name || "").toUpperCase();
  if (/MET|VMPET|VM-PET|METAL/.test(s)) return "met";
  if (/\bAL\b|ALU|FOIL/.test(s)) return "al";
  if (/PET|POLYESTER|BOPET/.test(s)) return "pet";
  if (/NY|NYLON|BOPA|\bPA\b/.test(s)) return "ny";
  if (/BOPP|CPP|\bPP\b|POLYPROP/.test(s)) return "pp";
  if (/PAPER|KRAFT/.test(s)) return "paper";
  if (/LD|LLD|HD|PE|MW|METALLOCENE|POLYETH|POLY|INNER|MILKY|NATURAL/.test(s)) return "pe";
  return "other";
}

const FILM_FILL: Record<FilmFamily, string> = {
  pet: "var(--film-pet)",
  met: "var(--film-met)",
  pe: "var(--film-pe)",
  pp: "var(--film-pp)",
  ny: "var(--film-ny)",
  al: "var(--film-al)",
  paper: "var(--film-paper)",
  other: "var(--film-other)",
};

const SHORT: Record<FilmFamily, string> = {
  pet: "PET",
  met: "MET",
  pe: "PE",
  pp: "PP",
  ny: "NY",
  al: "AL",
  paper: "PAPER",
  other: "",
};

const fmt = (value: number | null | undefined, digits = 1) =>
  value === null || value === undefined || !Number.isFinite(value)
    ? ""
    : value.toLocaleString("en-IN", { maximumFractionDigits: digits });

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

/** Cross-section of the laminate, drawn to scale (outer layer on top), with the adhesive line between layers. */
export function CrossSection({
  layers,
  width = 120,
  height = 96,
  className,
  testId,
}: {
  layers: Array<Pick<SpecBlockLayer, "name" | "micron" | "grade">>;
  width?: number;
  height?: number;
  className?: string;
  testId?: string;
}) {
  const rows = layers.filter((layer) => (layer.micron || 0) > 0);
  if (!rows.length) return null;
  const adhesive = rows.length > 1 ? 3 : 0;
  const top = 6;
  const usable = height - top * 2 - adhesive * (rows.length - 1);
  const total = rows.reduce((sum, layer) => sum + (layer.micron || 0), 0);
  const left = 4;
  const barWidth = width - 26;
  let y = top;
  const parts: React.ReactNode[] = [];
  rows.forEach((layer, index) => {
    const h = Math.max(5, ((layer.micron || 0) / total) * usable);
    const family = filmFamily(layer.name);
    const grade = String(layer.grade || "");
    const label = [SHORT[family], grade.length <= 6 ? grade : ""].filter(Boolean).join(" · ");
    parts.push(
      <g key={`l-${index}`}>
        <rect x={left} y={y} width={barWidth} height={h} rx={index === 0 ? 2 : 0} fill={FILM_FILL[family]} />
        {h >= 11 && label ? (
          <text
            x={left + 5}
            y={y + h / 2 + 3}
            fontSize="8.5"
            fontWeight={600}
            fill={family === "pet" || family === "met" || family === "al" ? "var(--film-ink-pet)" : "var(--film-ink-pe)"}
          >
            {label}
          </text>
        ) : null}
        <text x={left + barWidth + 4} y={y + h / 2 + 3} fontSize="9" fill="var(--plate-fg-2)">
          {fmt(layer.micron)}
        </text>
      </g>,
    );
    y += h;
    if (index < rows.length - 1 && adhesive) {
      parts.push(<rect key={`a-${index}`} x={left} y={y} width={barWidth} height={adhesive} fill="var(--film-adh)" />);
      y += adhesive;
    }
  });
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Cross-section: ${rows.map((layer) => `${layer.name} ${fmt(layer.micron)} micron`).join(", ")}`}
      className={cn("block max-w-full", className)}
      data-testid={testId}
    >
      {parts}
    </svg>
  );
}

export interface PlateFact {
  label: string;
  value: React.ReactNode;
}

export function SpecPlate({
  data,
  caption,
  captionRight,
  title,
  facts,
  size = "lg",
  className,
  testId = "spec-plate",
  children,
  emptyText = "Pick a product and size to see what will be made.",
  hideCrossSection = false,
  narrow = false,
}: {
  data: SpecBlockData | null | undefined;
  caption?: React.ReactNode;
  captionRight?: React.ReactNode;
  /** Optional headline under the caption, e.g. the product or line name. */
  title?: React.ReactNode;
  facts?: PlateFact[];
  size?: "lg" | "md";
  className?: string;
  testId?: string;
  children?: React.ReactNode;
  emptyText?: string;
  hideCrossSection?: boolean;
  /** Side columns: stack the cross-section under the layers and use a smaller size line. */
  narrow?: boolean;
}) {
  const sizeValue = data ? sizeText(data) : "";
  const layers = (data?.layers || []).filter((layer) => layer.name || layer.micron);
  const total = layers.reduce((sum, layer) => sum + (layer.micron || 0), 0);
  const lg = size === "lg" && !narrow;
  const empty = !sizeValue && !layers.length;
  const visibleFacts = (facts || []).filter((fact) => fact.value !== null && fact.value !== undefined && fact.value !== "");

  return (
    <section
      className={cn(
        "relative isolate min-w-0 overflow-hidden rounded-[18px] bg-plate text-plate-fg shadow-[var(--shadow-md)] ring-1 ring-inset ring-plate-line",
        lg ? "p-5" : "p-4",
        className,
      )}
      data-testid={testId}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute -bottom-20 -right-16 -z-10 h-56 w-56 rounded-full"
        style={{ background: "radial-gradient(closest-side, var(--plate-glow), transparent)" }}
      />
      {caption || captionRight ? (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.09em] text-plate-fg-3">
          {caption ? <span className="min-w-0">{caption}</span> : null}
          {captionRight ? <span className="ml-auto flex items-center gap-2 normal-case tracking-normal">{captionRight}</span> : null}
        </div>
      ) : null}

      {title ? (
        <h2 className={cn("mb-3 break-words font-semibold leading-snug tracking-[-0.015em]", lg ? "text-[19px]" : "text-[16px]")} data-testid={`${testId}-headline`}>
          {title}
        </h2>
      ) : null}

      {empty ? (
        <div className="py-3 text-sm text-plate-fg-2">{emptyText}</div>
      ) : (
        <div className={cn("grid items-center gap-x-6 gap-y-4", !hideCrossSection && total > 0 && !narrow ? "sm:grid-cols-[minmax(0,1fr)_auto]" : "")}>
          <div className="min-w-0">
            {sizeValue ? (
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-plate-fg-3">Size</span>
                <span
                  className={cn("font-semibold tabular-nums tracking-[-0.03em]", lg ? "text-[30px] leading-none sm:text-[34px]" : narrow ? "text-[24px] leading-none" : "text-[26px] leading-none")}
                  data-testid={`${testId}-size`}
                >
                  {sizeValue}
                </span>
                {data?.gussetMm ? (
                  <span className={cn("font-semibold tabular-nums tracking-[-0.02em] text-plate-fg-2", lg ? "text-xl" : "text-lg")}>
                    gusset {fmt(data.gussetMm)}
                  </span>
                ) : null}
                {data?.style ? (
                  <span className="text-[13px] text-plate-fg-2">{data.style.replace(/_/g, " ").toLowerCase()}</span>
                ) : null}
              </div>
            ) : null}

            {layers.length ? (
              <div className={cn("grid gap-1", sizeValue ? "mt-3" : "")} data-testid={`${testId}-layers`}>
                {layers.map((layer) => {
                  const sub = [layer.grade ? `Grade ${layer.grade}` : "", sourceWord(layer.source), layer.note]
                    .filter(Boolean)
                    .join(" · ");
                  return (
                    <div
                      key={`${layer.index}-${layer.name}`}
                      className="grid min-w-0 grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 rounded-[10px] bg-plate-2 px-3 py-2"
                    >
                      <span className="font-mono text-[11px] font-semibold text-plate-fg-3">L{layer.index}</span>
                      <div className="min-w-0">
                        <div className="break-words text-[14px] font-semibold leading-snug" title={layer.name}>
                          {layer.name}
                        </div>
                        {sub ? <div className="text-[12px] leading-snug text-plate-fg-2">{sub}</div> : null}
                      </div>
                      {layer.micron ? (
                        <span className={cn("font-semibold tabular-nums tracking-[-0.02em]", lg ? "text-[22px]" : "text-[19px]")}>
                          {fmt(layer.micron)}
                          <span className="ml-0.5 text-[12px] font-medium text-plate-fg-2">µ</span>
                        </span>
                      ) : (
                        <span className="text-[12px] text-plate-fg-3">—</span>
                      )}
                    </div>
                  );
                })}
                {layers.length > 1 && total > 0 ? (
                  <div className="flex items-baseline justify-between px-3 pt-1 text-[12.5px] text-plate-fg-2" data-testid={`${testId}-total`}>
                    <span>Total gauge</span>
                    <span className="text-[22px] font-semibold tabular-nums tracking-[-0.02em] text-plate-fg">
                      {fmt(total)}
                      <span className="ml-0.5 text-[12px] font-medium text-plate-fg-2">µ</span>
                    </span>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          {!hideCrossSection && total > 0 ? (
            <div className={cn("grid justify-items-start gap-2", narrow ? "grid-cols-[auto_minmax(0,1fr)] items-center" : "sm:justify-items-center")}>
              <span className={cn("text-[10.5px] font-semibold uppercase tracking-[0.09em] text-plate-fg-3", narrow && "col-span-2")}>Cross-section</span>
              <CrossSection layers={layers} width={narrow ? 150 : lg ? 128 : 112} height={narrow ? 72 : lg ? 104 : 88} testId={`${testId}-cross-section`} />
              {narrow ? <span className="text-[12px] leading-snug text-plate-fg-3">Outer layer on top, drawn to scale. The amber line is adhesive.</span> : null}
            </div>
          ) : null}
        </div>
      )}

      {visibleFacts.length ? (
        <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(140px,1fr))] gap-x-5 gap-y-2 border-t border-plate-line pt-3">
          {visibleFacts.map((fact) => (
            <div key={fact.label} className="min-w-0">
              <div className="text-[11px] font-medium text-plate-fg-3">{fact.label}</div>
              <div className="break-words text-[13.5px] font-semibold leading-snug text-plate-fg">{fact.value}</div>
            </div>
          ))}
        </div>
      ) : null}

      {children ? <div className="mt-4 border-t border-plate-line pt-3">{children}</div> : null}
    </section>
  );
}

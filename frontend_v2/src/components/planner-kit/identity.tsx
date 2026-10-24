"use client";

import * as React from "react";

import { coerceColorHex } from "@/lib/color-utils";
import { cleanJobName } from "@/lib/job-name";
import { normalizeProductSpec } from "@/lib/product-spec";
import { JobNameTag } from "@/components/spine/job-name-tag";
import { inchesText } from "@/lib/size-naming";
import { cn } from "@/lib/utils";

/**
 * Product identity: the same block in every planner row. Glyph · size hero ·
 * type tag · name · layer stack (to scale, coloured by film family) · ink chip ·
 * order / line / customer. Built from whatever line, job or stock order the
 * product-spec normaliser understands, so no screen formats a product its own way.
 */

export type ProductForm = "sup" | "3ss" | "zip" | "cs" | "roll" | "bag";

const FORM_LABEL: Record<ProductForm, string> = {
  sup: "stand-up pouch",
  "3ss": "3 side seal pouch",
  zip: "zipper pouch",
  cs: "centre seal roll",
  roll: "roll",
  bag: "courier bag",
};

export interface IdentityLayer {
  name: string;
  micron: number | null;
  grade?: string;
}

export interface IdentityInk {
  name: string;
  hex?: string | null;
}

export interface ProductIdentityData {
  form: ProductForm;
  typeLabel: string;
  sizeHero: string;
  sizeUnit: string;
  /** The same size in inches, worked out from mm ("5.5 × 12 in"). */
  sizeInches?: string;
  gusset?: string;
  name: string;
  layers: IdentityLayer[];
  printType: "" | "ROTO" | "FLEXO" | string;
  inks: IdentityInk[];
  orderNumber?: string;
  jobName?: string;
  lineLabel?: string;
  customer?: string;
}

const fmt = (value: number | null | undefined) =>
  value === null || value === undefined || !Number.isFinite(value)
    ? ""
    : value.toLocaleString("en-IN", { maximumFractionDigits: 1 });

function formFrom(raw: Record<string, any>, style: string, fgType: string): ProductForm {
  const s = `${style} ${raw.pouch_style || ""} ${raw.template_name || ""} ${raw.product_master_name || ""}`.toUpperCase();
  if (fgType === "ROLL") return /CENTRE|CENTER|CS\b/.test(s) ? "cs" : "roll";
  if (/COURIER|BAG\b|BAGS/.test(s)) return "bag";
  if (/ZIP/.test(s)) return "zip";
  if (/STAND|SUP\b|DOYPACK/.test(s)) return "sup";
  if (/CENTRE|CENTER/.test(s)) return "cs";
  return "3ss";
}

function inksFrom(printing: Record<string, any>): IdentityInk[] {
  const lists = [printing.front_colors, printing.colors, printing.front, printing.ink_colors].filter(Array.isArray);
  const names: IdentityInk[] = [];
  for (const list of lists) {
    for (const item of list as any[]) {
      const name = typeof item === "string" ? item : String(item?.name || item?.color_name || item?.code || "");
      if (name) names.push({ name, hex: typeof item === "object" ? item?.hex || item?.color_hex : null });
    }
    if (names.length) break;
  }
  if (!names.length) {
    const count = Number(printing.front_colors_count || printing.color_count || 0);
    for (let i = 0; i < Math.min(count, 10); i += 1) names.push({ name: `Colour ${i + 1}` });
  }
  return names;
}

/** Identity for any planner order line, job or stock order payload. */
export function identityFrom(source: Record<string, any> | null | undefined): ProductIdentityData {
  const raw = source || {};
  const spec = normalizeProductSpec(raw);
  const fgType = String(raw.fg_type || spec.size.finishedGoodType || raw.geometry_snapshot?.finished_good_type || "POUCH").toUpperCase();
  const form = formFrom(raw, spec.pouchStyle || spec.size.formLabel || "", fgType);
  const printing = {
    front_colors_count: raw.front_colors_count,
    ...((raw.printing_snapshot || raw.printing || {}) as Record<string, any>),
  } as Record<string, any>;
  // Compact planner rows carry the spec as effective_dims + spec_summary instead of snapshots.
  const summary = (raw.spec_summary || {}) as Record<string, any>;
  const dims = (raw.effective_dims || {}) as Record<string, any>;
  const printEnabled = Boolean(raw.printing_enabled ?? printing.enabled ?? (printing.print_type && printing.print_type !== "NONE"));
  const printType = printEnabled ? String(raw.print_type || printing.print_type || printing.method || "").toUpperCase() : "";
  const width = spec.size.widthMm ?? (Number(summary.width_mm || dims.width_mm) || null);
  const height = spec.size.heightMm ?? (Number(summary.height_mm || dims.height_mm) || null);
  const capturedLabel = spec.size.label && !/not captured/i.test(spec.size.label) ? spec.size.label : "";
  let sizeHero = width || height ? "" : capturedLabel || raw.display_geometry_label || "";
  let sizeUnit = "";
  if (width && height && fgType !== "ROLL") {
    sizeHero = `${fmt(width)} × ${fmt(height)}`;
    sizeUnit = "mm";
  } else if (width) {
    sizeHero = fmt(width);
    sizeUnit = fgType === "ROLL" ? "mm web" : "mm";
  }
  const lineIndex = raw.sales_order_line_index ?? raw.line_index;
  return {
    form,
    typeLabel: spec.size.formLabel || spec.pouchStyle || FORM_LABEL[form],
    sizeHero: sizeHero || "Size pending",
    sizeUnit,
    sizeInches: width ? inchesText(width, fgType === "ROLL" ? null : height) : undefined,
    gusset: spec.size.gussetMm ? `+ ${fmt(spec.size.gussetMm)} G` : undefined,
    name: raw.product_master_name || raw.template_name || spec.templateName || spec.productName || raw.line_label || "Product",
    layers: spec.layers.length
      ? spec.layers.map((layer) => ({
          name: layer.variantName || layer.variantCode || layer.label || `Layer ${layer.index}`,
          micron: layer.thicknessMicron,
          grade: layer.grade,
        }))
      : (Array.isArray(summary.layer_recipe) ? summary.layer_recipe : []).map((layer: any, index: number) => ({
          name: String(layer?.variant_name || layer?.label || layer?.variant_code || `Layer ${index + 1}`),
          micron: Number(layer?.thickness_micron) || null,
          grade: String(layer?.grade || "") || undefined,
        })),
    printType: printType === "NONE" ? "" : printType,
    inks: printType ? inksFrom(printing) : [],
    orderNumber: raw.order_number || spec.orderNumber || undefined,
    jobName: cleanJobName(raw.job_name ?? raw.order_name ?? raw.order_fact_sheet?.order_name) || undefined,
    lineLabel: lineIndex !== undefined && lineIndex !== null ? `L${Number(lineIndex) + (Number(lineIndex) === 0 ? 1 : 0)}` : undefined,
    customer: raw.customer_name || spec.customerName || undefined,
  };
}

/** Film family → film token (PET, MET, PE/LD, PP/BOPP/CPP, nylon, foil, paper). */
export function filmTone(name: string): string {
  const s = String(name || "").toUpperCase();
  if (/MET|VMPET|METAL/.test(s)) return "bg-film-met";
  if (/\bAL\b|ALU|FOIL/.test(s)) return "bg-film-al";
  if (/PET|POLYESTER|POLYISTER/.test(s)) return "bg-film-pet";
  if (/NY|NYLON|PA\b/.test(s)) return "bg-film-ny";
  if (/BOPP|CPP|\bPP\b/.test(s)) return "bg-film-pp";
  if (/LD|LLD|PE\b|LDPE|HDPE|POLY/.test(s)) return "bg-film-pe";
  if (/PAPER/.test(s)) return "bg-film-paper";
  return "bg-film-other";
}

export function LayerStack({ layers, className }: { layers: IdentityLayer[]; className?: string }) {
  if (!layers.length) {
    return <span className={cn("text-caption italic text-content-4", className)}>layers tbc</span>;
  }
  const total = layers.reduce((sum, layer) => sum + (layer.micron || 0), 0);
  const label = layers
    .map((layer) => `${layer.name}${layer.grade ? ` ${layer.grade}` : ""}${layer.micron ? ` ${fmt(layer.micron)}µ` : ""}`)
    .join(" + ");
  // Each layer reads as text (film swatch · name · grade · micron); the total gauge closes the row.
  return (
    <span className={cn("inline-flex min-w-0 flex-wrap items-center gap-1", className)} title={`${label}${total ? ` = ${fmt(total)}µ` : ""}`}>
      {layers.map((layer, index) => (
        <React.Fragment key={index}>
          {index ? <span className="text-[11px] font-semibold text-content-4" aria-hidden>+</span> : null}
          <span className="inline-flex h-5 max-w-[168px] items-center gap-1 rounded-[5px] bg-surface-1 pl-1 pr-1.5 text-caption ring-1 ring-line-strong" aria-hidden>
            <i className={cn("block h-3 w-1.5 shrink-0 rounded-[2px] ring-1 ring-line-strong", filmTone(layer.name))} />
            <span className="truncate font-semibold text-content-1">{layer.name}</span>
            {layer.grade ? <span className="shrink-0 font-medium text-content-3">{layer.grade}</span> : null}
            {layer.micron ? (
              <span className="shrink-0 font-mono font-semibold tabular-nums text-content-1">
                {fmt(layer.micron)}<span className="font-sans text-[10px] font-medium text-content-3">µ</span>
              </span>
            ) : null}
          </span>
        </React.Fragment>
      ))}
      {total && layers.length > 1 ? (
        <span className="whitespace-nowrap font-mono text-caption font-semibold tabular-nums text-content-2" aria-hidden>
          = {fmt(total)}µ
        </span>
      ) : null}
      <span className="sr-only">Layers: {label}{total ? `, ${fmt(total)} micron total` : ""}</span>
    </span>
  );
}

export function InkChip({ printType, inks }: { printType: string; inks: IdentityInk[] }) {
  if (!printType) {
    return <span className="rounded-[5px] px-1.5 py-px text-caption font-medium text-content-3 ring-1 ring-line">No print</span>;
  }
  const names = inks.map((ink) => ink.name).join(", ");
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-[5px] px-1.5 py-px font-mono text-caption font-semibold ring-1",
        printType === "FLEXO" ? "text-info-fg ring-info-border" : "text-order-fg ring-order-border",
      )}
      title={`${printType} · ${inks.length} colour${inks.length === 1 ? "" : "s"}${names ? `: ${names}` : ""}`}
    >
      {printType}
      <span className="flex items-center gap-[2px]" aria-hidden>
        {inks.slice(0, 8).map((ink, index) => (
          <i
            key={index}
            className="block h-2 w-2 rounded-full ring-1 ring-line"
            style={{ background: coerceColorHex(ink.hex, ink.name) }}
          />
        ))}
      </span>
      <span className="sr-only">{inks.length} colours{names ? `: ${names}` : ""}</span>
    </span>
  );
}

/** Silhouette of the finished good, tinted by print process. */
export function ProductGlyph({ form, printType, size = 40 }: { form: ProductForm; printType?: string; size?: number }) {
  const tone = !printType ? "text-content-4" : printType === "FLEXO" ? "text-info-fg" : "text-order-fg";
  const paths: Record<ProductForm, React.ReactNode> = {
    sup: <path d="M11 6h18v4l3 22a3 3 0 0 1-3 3H11a3 3 0 0 1-3-3l3-22z M11 10h18 M12 30c3-3 13-3 16 0" />,
    "3ss": <path d="M10 5h20v30H10z M10 9h20 M13 5v30 M27 5v30" />,
    zip: <path d="M10 6h20v29H10z M10 11h20 M10 13h20" />,
    cs: <path d="M8 12a4 4 0 0 1 4-4h16a4 4 0 0 1 4 4v16a4 4 0 0 1-4 4H12a4 4 0 0 1-4-4z M20 8v24 M14 14h4 M22 26h4" />,
    roll: <path d="M10 10a10 10 0 1 0 20 0 10 10 0 1 0-20 0z M17 10a3 3 0 1 0 6 0 3 3 0 1 0-6 0z M30 10v18H18" />,
    bag: <path d="M8 9h24v26H8z M8 9l4-4h16l4 4 M14 15h12 M14 19h8" />,
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      className={cn("shrink-0", tone)}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden
    >
      {paths[form]}
    </svg>
  );
}

export function ProductIdentity({
  data,
  meta,
  big,
  className,
}: {
  data: ProductIdentityData;
  /** Extra meta items after order · line · customer (age, due, …). */
  meta?: React.ReactNode[];
  big?: boolean;
  className?: string;
}) {
  const metaItems: React.ReactNode[] = [];
  if (data.orderNumber) metaItems.push(<b key="o" className="font-mono font-semibold text-content-2">{data.orderNumber}</b>);
  if (data.jobName) metaItems.push(<JobNameTag key="j" name={data.jobName} />);
  if (data.lineLabel) metaItems.push(<span key="l" className="rounded-[4px] px-1 font-mono ring-1 ring-line">{data.lineLabel}</span>);
  if (data.customer) metaItems.push(<span key="c" className="max-w-[180px] truncate text-content-3">{data.customer}</span>);
  for (const item of meta || []) if (item) metaItems.push(item);
  return (
    <div className={cn("grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5", className)}>
      <div className="row-span-4 pt-0.5">
        <ProductGlyph form={data.form} printType={data.printType} size={big ? 48 : 40} />
      </div>
      <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
        <span className={cn("font-semibold tabular-nums tracking-tight text-content-1", big ? "text-lg" : "text-base")}>
          {data.sizeHero}
        </span>
        {data.sizeUnit ? <span className="text-caption text-content-3">{data.sizeUnit}</span> : null}
        {data.sizeInches ? (
          <span className={cn("font-semibold tabular-nums tracking-tight text-content-3", big ? "text-lg" : "text-base")}>· {data.sizeInches}</span>
        ) : null}
        {data.gusset ? <span className="text-caption text-content-3">{data.gusset}</span> : null}
        <span className="rounded-[5px] bg-warning-bg px-1.5 text-caption font-medium text-warning-fg ring-1 ring-warning-border">
          {data.typeLabel}
        </span>
      </div>
      <div className="line-clamp-2 text-sm text-content-1">{data.name}</div>
      <div className="flex flex-wrap items-center gap-2">
        <LayerStack layers={data.layers} />
        <InkChip printType={data.printType} inks={data.inks} />
      </div>
      {metaItems.length ? (
        <div className="flex min-w-0 flex-wrap items-center overflow-hidden text-caption text-content-3">
          {metaItems.map((item, index) => (
            <span key={index} className="relative -ml-[14px] inline-flex items-center pl-[14px] pr-[14px] before:absolute before:left-0 before:w-[14px] before:text-center before:text-content-4 before:content-['·']">
              {item}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

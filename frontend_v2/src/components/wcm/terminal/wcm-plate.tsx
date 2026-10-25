"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { inchesText } from "@/lib/size-naming";
import type { SpineMade, SpineMadeLine } from "@/services/spine";

const clean = (value: unknown) => String(value ?? "").trim();
const trim1 = (value: number) => String(Math.round(value * 10) / 10);
/** "STAND_UP" → "Stand up"; labels that are already words stay as they are. */
const human = (value: unknown) => {
  const text = clean(value);
  if (!/^[A-Z0-9_\- ]+$/.test(text) || !/[A-Z]/.test(text)) return text;
  const words = text.replace(/[_-]+/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};
/** "PET 12 micron" → "PET": the micron is printed beside the layer. */
const layerName = (value: unknown) => clean(value).replace(/\s*\d+(?:\.\d+)?\s*(?:micron|mic|µm?|u)\b\.?/i, "").trim();

/** The line of the order this job makes (falls back to the order's own headline). */
export function madeLineFor(made: SpineMade | null | undefined, itemId?: string | null): SpineMadeLine | null {
  if (!made) return null;
  const lines = Array.isArray(made.lines) ? made.lines : [];
  return lines.find((line) => clean(line.item_id) === clean(itemId)) || (lines.length === 1 ? lines[0] : null);
}

/** "230 × 120" and "9.1 × 4.7 in" from a made line or the order. */
function sizeOf(line: SpineMadeLine | null, made: SpineMade | null | undefined) {
  const width = Number(line?.width_mm || 0);
  const height = Number(line?.height_mm || 0);
  const gusset = Number(line?.gusset_mm || 0);
  if (width && height) {
    return { metric: `${trim1(width)} × ${trim1(height)}${gusset ? ` + ${trim1(gusset)} G` : ""}`, unit: "mm", imperial: inchesText(width, height) };
  }
  if (width) return { metric: trim1(width), unit: "mm web", imperial: inchesText(width) };
  const label = clean(line?.size || made?.size);
  const pair = label.match(/(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)/);
  if (pair) return { metric: `${trim1(Number(pair[1]))} × ${trim1(Number(pair[2]))}`, unit: "mm", imperial: inchesText(pair[1], pair[2]) };
  return { metric: label, unit: "", imperial: "" };
}

/**
 * "What is to be made" — the job's product on a dark plate, as on the approved WC terminal sample:
 * headline, size in mm and inches, form and lanes, every layer with its micron, print, and the
 * facts the floor checks (stock web, print, weight, lanes, route with this step marked, due).
 */
export function WcmJobPlate({
  made,
  line,
  code,
  stepName,
  testId = "wcm-job-plate",
}: {
  made: SpineMade | null | undefined;
  line: SpineMadeLine | null;
  code?: string;
  stepName?: string;
  testId?: string;
}) {
  if (!made && !line) return null;
  const size = sizeOf(line, made);
  const layers = (line?.layers?.length ? line.layers : made?.layers) || [];
  const gauge = Number(line?.gauge_micron ?? made?.gauge_micron ?? 0) || layers.reduce((sum, layer) => sum + Number(layer.micron || 0), 0);
  const print = clean(line?.print || made?.print);
  const colours = Number(line?.colours ?? made?.colours ?? 0);
  const route = clean(line?.route || made?.route);
  const steps = route ? route.split(/\s*(?:→|->|›)\s*/).filter(Boolean) : [];
  const unitWeight = Number(line?.unit_weight_g ?? made?.unit_weight_g ?? 0);
  const totalKg = Number(line?.total_kg ?? made?.total_kg ?? 0);
  const form = [human(line?.pouch_style || made?.pouch_style), clean(line?.lanes || made?.lanes)].filter(Boolean).join(" · ");
  const facts: Array<[string, React.ReactNode]> = [
    ["Stock web", clean(line?.stock_web || made?.stock_web) || "—"],
    ["Print", print || (colours ? `${colours} colours` : "No print")],
    [
      "Weight",
      [totalKg ? `${totalKg.toLocaleString("en-IN", { maximumFractionDigits: 1 })} kg` : "", unitWeight ? `${unitWeight.toLocaleString("en-IN", { maximumFractionDigits: 2 })} g/pc` : ""]
        .filter(Boolean)
        .join(" · ") || "—",
    ],
    ["Lanes", clean(line?.lanes || made?.lanes) || "1-up"],
    [
      "Route",
      steps.length ? (
        <span>
          {steps.map((step, index) => (
            <React.Fragment key={`${step}-${index}`}>
              {index ? <span className="text-plate-fg-3"> → </span> : null}
              <span className={cn(stepName && step.toLowerCase().includes(stepName.toLowerCase().split(" ")[0]) && "underline underline-offset-2")}>
                {step}
              </span>
            </React.Fragment>
          ))}
        </span>
      ) : (
        "—"
      ),
    ],
    ["Due", made?.due ? new Date(made.due).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—"],
  ];
  return (
    <section className="rounded-2xl bg-plate p-4 text-plate-fg shadow-[var(--shadow-sm)]" data-testid={testId}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-plate-fg-3">
        <span>What is to be made</span>
        {code ? <span className="font-mono normal-case tracking-normal">{code}</span> : null}
      </div>
      <div className="mt-1 text-[15px] font-semibold leading-snug text-plate-fg">{clean(line?.headline || made?.headline)}</div>
      {size.metric ? (
        <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
          <span className="font-mono text-[20px] font-bold leading-tight">{size.metric}</span>
          {size.unit ? <span className="text-[12px] text-plate-fg-3">{size.unit}</span> : null}
          {size.imperial ? <span className="text-[17px] font-semibold text-plate-fg-2">{size.imperial}</span> : null}
          {form ? <span className="text-[12.5px] text-plate-fg-2">{form}</span> : null}
        </div>
      ) : null}
      {layers.length ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {layers.map((layer, index) => (
            <React.Fragment key={`${layer.name}-${index}`}>
              {index ? <span className="text-plate-fg-3">+</span> : null}
              <span className="inline-flex items-center gap-2 rounded-lg border border-plate-line bg-plate-2 px-2.5 py-1.5">
                <span className="text-[11px] text-plate-fg-3">L{index + 1}</span>
                <span className="min-w-0">
                  <span className="block text-[12.5px] font-semibold leading-tight">{layerName(layer.name) || clean(layer.name) || "Layer"}</span>
                  {clean(layer.grade) ? <span className="block text-[10.5px] leading-tight text-plate-fg-3">{clean(layer.grade)}</span> : null}
                </span>
                {layer.micron ? (
                  <span className="font-mono text-[15px] font-bold">
                    {trim1(Number(layer.micron))}
                    <span className="text-[10px] text-plate-fg-3">µ</span>
                  </span>
                ) : null}
              </span>
            </React.Fragment>
          ))}
          {gauge ? (
            <>
              <span className="text-plate-fg-3">=</span>
              <b className="font-mono text-[15px]">{trim1(gauge)}µ</b>
            </>
          ) : null}
          {colours ? (
            <span className="ml-auto rounded-md border border-plate-line px-2 py-0.5 font-mono text-[11px] text-plate-fg-2">
              {clean(line?.print_method) || "PRINT"} {colours}c
            </span>
          ) : null}
        </div>
      ) : null}
      <dl className="mt-3 grid gap-x-4 gap-y-2.5 border-t border-plate-line pt-3 sm:grid-cols-3 2xl:grid-cols-6">
        {facts.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-plate-fg-3">{label}</dt>
            <dd className="mt-0.5 text-[12.5px] font-semibold leading-snug text-plate-fg">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

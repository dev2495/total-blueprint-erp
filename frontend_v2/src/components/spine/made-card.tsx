"use client";

/**
 * "What is to be made": the one description of an order that the order page, the planner,
 * the WC terminal, the machine screen and the packing yard all show. Figures come from the
 * spine endpoint, so every screen agrees. Commercial details (bill-to, PO, terms) are
 * deliberately NOT here; they live only on the sales order page.
 */
import { CalendarDays, Layers, Printer, Route, Ruler, Scale, SplitSquareHorizontal } from "lucide-react";

import { formatDisplayDate } from "@/lib/date-format";
import { cn } from "@/lib/utils";
import type { SpineMade, SpineMadeLayer } from "@/services/spine";

function Fact({ icon, children, dark, strong }: { icon?: React.ReactNode; children: React.ReactNode; dark?: boolean; strong?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex min-h-6 max-w-full items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-semibold",
        dark ? "bg-white/10 text-white ring-1 ring-white/15" : strong ? "bg-surface-1 text-content-1 ring-1 ring-info-border" : "bg-surface-2 text-content-2 ring-1 ring-line",
      )}
    >
      {icon ? <span className={cn("flex-none [&>svg]:h-3.5 [&>svg]:w-3.5", dark ? "text-white/80" : "text-primary")}>{icon}</span> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}

function sourceWord(source: string) {
  const s = String(source || "").toUpperCase();
  if (s.includes("EXTRU")) return "made here";
  if (s.includes("PURCH")) return "bought";
  return "";
}

export function layerLabel(layer: SpineMadeLayer) {
  return [layer.name, layer.micron ? `${layer.micron.toLocaleString("en-IN", { maximumFractionDigits: 1 })} µ` : "", layer.grade].filter(Boolean).join(" · ");
}

/** One-line spec for queue cards and headers: size · layers · gauge · print. */
export function madeSpecLine(made: SpineMade | null | undefined) {
  if (!made) return "";
  const layers = (made.layers || []).map(layerLabel).join(" / ");
  return [made.size, layers, made.gauge_micron && (made.layers || []).length > 1 ? `${made.gauge_micron.toLocaleString("en-IN", { maximumFractionDigits: 1 })} µ` : "", made.print].filter(Boolean).join(" · ");
}

export function MadeCard({
  made,
  dark = false,
  dense = false,
  eyebrow = "What is to be made",
  className,
  testId = "made-card",
}: {
  made: SpineMade | null | undefined;
  dark?: boolean;
  dense?: boolean;
  eyebrow?: string;
  className?: string;
  testId?: string;
}) {
  if (!made) return null;
  const extraLines = Math.max(0, made.line_count - 1);
  const layers = made.layers || [];
  const first = made.lines[0];
  const sizeText = first?.width_mm && first?.height_mm
    ? `${first.width_mm.toLocaleString("en-IN", { maximumFractionDigits: 1 })} × ${first.height_mm.toLocaleString("en-IN", { maximumFractionDigits: 1 })} mm${first.gusset_mm ? ` · gusset ${first.gusset_mm.toLocaleString("en-IN", { maximumFractionDigits: 1 })}` : ""}`
    : made.size || "";
  const printText = first?.print_method
    ? [first.print_method, made.colours ? `${made.colours} colour${made.colours === 1 ? "" : "s"}` : "", made.artwork].filter(Boolean).join(" · ")
    : made.print && made.print !== "plain" ? made.print : "plain";
  return (
    <section
      data-testid={testId}
      className={cn(
        "min-w-0 rounded-2xl p-4",
        dark ? "bg-white/10 text-white ring-1 ring-white/15" : "border border-info-border bg-info-bg text-content-1 shadow-sm",
        className,
      )}
    >
      <div className={cn("text-caption font-semibold uppercase tracking-[0.12em]", dark ? "text-white/70" : "text-primary")}>{eyebrow}</div>
      <h2
        className={cn("mt-1 break-words font-semibold tracking-tight", dense ? "text-lg leading-snug" : "text-xl leading-snug sm:text-2xl")}
        data-testid={`${testId}-headline`}
      >
        {made.headline}
        {extraLines ? (
          <span className={cn("ml-2 align-middle text-sm font-semibold", dark ? "text-white/70" : "text-content-3")}>
            +{extraLines} more line{extraLines === 1 ? "" : "s"}
          </span>
        ) : null}
      </h2>

      {/* Spec: size, every layer with material · micron · grade · source, gauge, print. */}
      <div className="mt-2.5 flex flex-wrap gap-1.5" data-testid={`${testId}-spec`}>
        {sizeText ? (
          <Fact icon={<Ruler />} dark={dark} strong>
            {sizeText}
          </Fact>
        ) : null}
        {made.pouch_style ? (
          <Fact icon={<Layers />} dark={dark}>
            {made.pouch_style.replace(/_/g, " ")}
          </Fact>
        ) : null}
        {layers.map((layer) => (
          <Fact key={layer.index} dark={dark} strong>
            <span className={cn("mr-1 font-mono text-[11px]", dark ? "text-white/70" : "text-content-3")}>L{layer.index}</span>
            {layerLabel(layer)}
            {sourceWord(layer.source) ? <span className={cn("ml-1", dark ? "text-white/70" : "text-content-3")}>· {sourceWord(layer.source)}</span> : null}
          </Fact>
        ))}
        {layers.length > 1 && made.gauge_micron ? (
          <Fact dark={dark}>{made.gauge_micron.toLocaleString("en-IN", { maximumFractionDigits: 1 })} µ laminate</Fact>
        ) : null}
        <Fact icon={<Printer />} dark={dark}>
          {printText}
        </Fact>
      </div>

      {/* Quantities and plan. */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {made.unit_weight_g ? (
          <Fact icon={<Scale />} dark={dark}>
            {made.unit_weight_g.toLocaleString("en-IN", { maximumFractionDigits: 3 })} g each
            {made.total_kg ? ` · ${made.total_kg.toLocaleString("en-IN", { maximumFractionDigits: 1 })} kg` : ""}
          </Fact>
        ) : made.total_kg ? (
          <Fact icon={<Scale />} dark={dark}>
            {made.total_kg.toLocaleString("en-IN", { maximumFractionDigits: 1 })} kg
          </Fact>
        ) : null}
        {made.lanes ? (
          <Fact icon={<SplitSquareHorizontal />} dark={dark}>
            {made.lanes}
          </Fact>
        ) : null}
        {made.route ? (
          <Fact icon={<Route />} dark={dark}>
            {made.route}
          </Fact>
        ) : null}
        {made.due ? (
          <Fact icon={<CalendarDays />} dark={dark}>
            Due {formatDisplayDate(made.due)}
          </Fact>
        ) : null}
      </div>
    </section>
  );
}

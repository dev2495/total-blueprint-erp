"use client";

/**
 * "What is to be made": the one description of an order that the order page, the planner,
 * the WC terminal, the machine screen and the packing yard all show. Figures come from the
 * spine endpoint, so every screen agrees. Commercial details (bill-to, PO, terms) are
 * deliberately NOT here; they live only on the sales order page.
 */
import { formatDisplayDate } from "@/lib/date-format";
import type { SpineMade, SpineMadeLayer } from "@/services/spine";
import { SpecPlate } from "@/components/plate/spec-plate";
import { specFromMade } from "./spec-block";

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
  dark: _dark = false,
  dense = false,
  eyebrow = "What is to be made",
  className,
  testId = "made-card",
}: {
  made: SpineMade | null | undefined;
  /** Kept for callers; the plate is dark on every screen. */
  dark?: boolean;
  dense?: boolean;
  eyebrow?: string;
  className?: string;
  testId?: string;
}) {
  if (!made) return null;
  const extraLines = Math.max(0, made.line_count - 1);
  const first = made.lines[0];
  const printText = first?.print_method
    ? [first.print_method, made.colours ? `${made.colours} colour${made.colours === 1 ? "" : "s"}` : "", made.artwork].filter(Boolean).join(" · ")
    : made.print && made.print !== "plain" ? made.print : "plain";
  const weight = made.unit_weight_g
    ? `${made.unit_weight_g.toLocaleString("en-IN", { maximumFractionDigits: 3 })} g each${made.total_kg ? ` · ${made.total_kg.toLocaleString("en-IN", { maximumFractionDigits: 1 })} kg` : ""}`
    : made.total_kg
      ? `${made.total_kg.toLocaleString("en-IN", { maximumFractionDigits: 1 })} kg`
      : "";
  return (
    <SpecPlate
      data={specFromMade(made)}
      size={dense ? "md" : "lg"}
      caption={eyebrow}
      captionRight={
        extraLines ? (
          <span className="text-plate-fg-2">
            +{extraLines} more line{extraLines === 1 ? "" : "s"}
          </span>
        ) : null
      }
      title={made.headline}
      facts={[
        { label: "Print", value: printText },
        { label: "Weight", value: weight },
        { label: "Lanes", value: made.lanes || "" },
        { label: "Route", value: made.route || "" },
        { label: "Due", value: made.due ? formatDisplayDate(made.due) : "" },
      ]}
      className={className}
      testId={testId}
    />
  );
}

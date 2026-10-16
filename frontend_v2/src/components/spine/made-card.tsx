"use client";

/**
 * "What is to be made": the one description of an order that the order page, the WC
 * terminal and the machine screen all show. Figures come from the spine endpoint, so every
 * screen agrees. Commercial details (bill-to, PO, terms) are deliberately NOT here; they
 * live only on the sales order page.
 */
import { CalendarDays, Layers, Printer, Route, Scale, SplitSquareHorizontal } from "lucide-react";

import { formatDisplayDate } from "@/lib/date-format";
import { cn } from "@/lib/utils";
import type { SpineMade } from "@/services/spine";

function Fact({ icon, children, dark }: { icon: React.ReactNode; children: React.ReactNode; dark?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex min-h-6 max-w-full items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-semibold",
        dark ? "bg-white/10 text-white ring-1 ring-white/15" : "bg-surface-2 text-content-2 ring-1 ring-line",
      )}
    >
      <span className={cn("flex-none [&>svg]:h-3.5 [&>svg]:w-3.5", dark ? "text-white/80" : "text-primary")}>{icon}</span>
      <span className="truncate">{children}</span>
    </span>
  );
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
        className={cn(
          "mt-1 break-words font-semibold tracking-tight",
          dense ? "text-lg leading-snug" : "text-xl leading-snug sm:text-2xl",
        )}
        data-testid={`${testId}-headline`}
      >
        {made.headline}
        {extraLines ? (
          <span className={cn("ml-2 align-middle text-sm font-semibold", dark ? "text-white/70" : "text-content-3")}>
            +{extraLines} more line{extraLines === 1 ? "" : "s"}
          </span>
        ) : null}
      </h2>
      {made.structure || made.print ? (
        <p className={cn("mt-1 text-sm font-medium", dark ? "text-white/85" : "text-content-2")}>
          {[made.structure, made.print].filter(Boolean).join(" · ")}
          {made.unit_weight_g ? ` · ${made.unit_weight_g.toLocaleString("en-IN", { maximumFractionDigits: 3 })} g each` : ""}
        </p>
      ) : null}
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {made.route ? (
          <Fact icon={<Route />} dark={dark}>
            {made.route}
          </Fact>
        ) : null}
        {made.lanes ? (
          <Fact icon={<SplitSquareHorizontal />} dark={dark}>
            {made.lanes}
          </Fact>
        ) : null}
        {made.total_kg ? (
          <Fact icon={<Scale />} dark={dark}>
            {made.total_kg.toLocaleString("en-IN", { maximumFractionDigits: 1 })} kg
          </Fact>
        ) : null}
        {made.lines[0]?.pouch_style ? (
          <Fact icon={<Layers />} dark={dark}>
            {made.lines[0].pouch_style.replace(/_/g, " ")}
          </Fact>
        ) : null}
        {made.print && made.print !== "plain" && made.lines[0]?.print ? (
          <Fact icon={<Printer />} dark={dark}>
            {made.lines[0].print}
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

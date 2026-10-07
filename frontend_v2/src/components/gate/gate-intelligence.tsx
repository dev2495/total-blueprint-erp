"use client";

import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, DoorOpen } from "lucide-react";
import { Panel } from "@/components/premium";
import type { GateSummary } from "@/services/gate";
import { gateQty } from "./gate-format";

const linkClass = "text-[12.5px] font-medium text-primary hover:underline";

/**
 * Owner intelligence card fed by control-tower `gate` (present only for an
 * actual owner). Period movements and *current* visitor state are kept
 * visually separate, as the backend contract requires.
 */
export function GateIntelligencePanel({ gate, periodLabel }: { gate: GateSummary & { quantity_by_uom?: Record<string, string | null>; stale_pending_visitors?: number }; periodLabel: string }) {
  const exceptions = [
    { label: "Awaiting ERP match", value: Number(gate.unmatched || 0), href: "/gate/history" },
    { label: "ERP mismatches", value: Number(gate.discrepancies || 0), href: "/gate/history" },
    { label: "Legacy pending (>12h)", value: Number(gate.stale_pending_visitors || 0), href: "/gate/visitors" },
  ];
  const qty = Object.entries(gate.quantity_by_uom || {}).filter(([, v]) => v !== null && Number(v) > 0);
  const openExceptions = exceptions.reduce((sum, e) => sum + e.value, 0);

  return (
    <Panel
      icon={<DoorOpen />}
      title="Gate register"
      description={`Vehicles and visitors · ${periodLabel}`}
      actions={
        <span className="flex gap-3">
          <Link href="/gate/history" className={linkClass}>
            History
          </Link>
          <Link href="/analytics/reports/gate" className={linkClass}>
            Report
          </Link>
        </span>
      }
    >
      <div className="grid gap-4 md:grid-cols-[1.1fr_1fr_1fr]">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-content-4">Movements this period</div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-line bg-surface-2/60 px-3 py-2.5">
              <div className="flex items-center gap-1 text-[11.5px] text-content-3">
                <ArrowDownLeft className="h-3.5 w-3.5 text-[var(--gate-in,currentColor)]" /> Inward
              </div>
              <div className="text-[22px] font-semibold tabular-nums text-content-1">{gateQty(gate.inward ?? 0)}</div>
            </div>
            <div className="rounded-xl border border-line bg-surface-2/60 px-3 py-2.5">
              <div className="flex items-center gap-1 text-[11.5px] text-content-3">
                <ArrowUpRight className="h-3.5 w-3.5 text-[var(--gate-out,currentColor)]" /> Outward
              </div>
              <div className="text-[22px] font-semibold tabular-nums text-content-1">{gateQty(gate.outward ?? 0)}</div>
            </div>
          </div>
          {qty.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5 text-[12px] text-content-3">
              {qty.map(([uom, value]) => (
                <span key={uom} className="rounded-full border border-line px-2 py-0.5 tabular-nums">
                  {gateQty(value)} {uom}
                </span>
              ))}
            </div>
          ) : null}
          <div className="mt-2 text-[12px] text-content-3">
            {gateQty(gate.visitor_entries ?? 0)} visitor entries · {gateQty(gate.visitor_exits ?? 0)} exits
          </div>
        </div>

        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-content-4">At the gate now</div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-line bg-surface-2/60 px-3 py-2.5">
              <div className="text-[11.5px] text-content-3">Inside</div>
              <div className="text-[22px] font-semibold tabular-nums text-success-fg">{gateQty(gate.inside_visitors ?? 0)}</div>
            </div>
            <div className="rounded-xl border border-line bg-surface-2/60 px-3 py-2.5">
              <div className="text-[11.5px] text-content-3">Overdue &gt;12h</div>
              <div className={`text-[22px] font-semibold tabular-nums ${Number(gate.overdue_visitors || 0) ? "text-danger-fg" : "text-content-1"}`}>{gateQty(gate.overdue_visitors ?? 0)}</div>
            </div>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.1em] text-content-4">
            Exceptions
            <span className={openExceptions ? "text-danger-fg" : "text-success-fg"}>{openExceptions ? `${openExceptions} open` : "clear"}</span>
          </div>
          <ul className="mt-2 divide-y divide-line rounded-xl border border-line">
            {exceptions.map((e) => (
              <li key={e.label}>
                <Link href={e.href} className="flex items-center justify-between px-3 py-2 text-[13px] hover:bg-surface-2">
                  <span className="text-content-2">{e.label}</span>
                  <span className={`tabular-nums font-semibold ${e.value ? "text-danger-fg" : "text-content-4"}`}>{e.value}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Panel>
  );
}

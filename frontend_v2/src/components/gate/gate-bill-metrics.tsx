"use client";

import Link from "next/link";
import { ArrowUpRight, Inbox } from "lucide-react";
import { useAuth } from "@/components/auth-provider";
import type { GateSummary } from "@/services/gate";
import { canReviewGateBills } from "./gate-access";
import { gateQty } from "./gate-format";

const arrivalDate = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
});

/** Captured paperwork and stock receipts have separate lifecycles and counts. */
export function GateBillMetrics({ summary, periodLabel }: { summary: GateSummary; periodLabel: string }) {
  const { user, effectiveRole } = useAuth();
  const canReview = canReviewGateBills(user, effectiveRole);
  const oldest = summary.bill_pending_oldest_arrival_at ? new Date(summary.bill_pending_oldest_arrival_at) : null;
  const metrics = [
    { key: "bill_arrivals", label: "Bills captured" },
    { key: "bill_received", label: "Fully received" },
    { key: "bill_voided", label: "Resolved without GRN" },
  ] as const;

  return (
    <div className="grid gap-4 md:grid-cols-[1.5fr_1fr]" data-testid="gate-bill-metrics">
      <div className="min-w-0">
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-content-4">Bill activity · {periodLabel}</div>
        <dl className="mt-2 grid grid-cols-3 gap-2">
          {metrics.map(({ key, label }) => (
            <div key={key} className="min-w-0 rounded-xl border border-line bg-surface-2/60 px-3 py-3">
              <dt className="text-[11.5px] leading-snug text-content-3">{label}</dt>
              <dd className="mt-1 text-[22px] font-semibold tabular-nums text-content-1">{gateQty(summary[key])}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-[12px] leading-relaxed text-content-3">Capture records arrival. Inventory confirms receipts after checking every bill line.</p>
      </div>
      <div className="rounded-xl border border-line bg-surface-2/60 px-4 py-3">
        <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-content-4"><Inbox className="h-4 w-4" /> Awaiting inventory now</div>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-[28px] font-semibold tabular-nums text-content-1">{gateQty(summary.bill_pending_grn)}</span>
          <span className="text-[12px] text-content-3">{gateQty(summary.bill_partial_grn)} partly received</span>
        </div>
        <p className="text-[11.5px] leading-relaxed text-content-3">Includes pending and partial bills from all arrival dates in the selected plants.</p>
        {oldest && !Number.isNaN(oldest.getTime()) ? <p className="mt-1 text-[11.5px] text-content-3">Oldest arrival: {arrivalDate.format(oldest)} IST</p> : null}
        {canReview ? (
          <Link href="/inventory/gate-bills" className="mt-2 inline-flex min-h-11 items-center gap-1 text-[12.5px] font-semibold text-primary hover:underline">Review gate bills <ArrowUpRight className="h-4 w-4" /></Link>
        ) : null}
      </div>
    </div>
  );
}

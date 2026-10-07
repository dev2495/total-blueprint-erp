"use client";

import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { GateGoodsMovement } from "@/services/gate";
import { DIRECTION_META, gateAmount, gateDay, gateQty, gateTime, reconMeta } from "./gate-format";
import { DirectionGlyph, PlateChip, TonePill } from "./gate-ui";

/**
 * The paper register, kept: Date/Time · Invoice no/date · Party · Vehicle ·
 * Product · Qty · Unit · Amount. Phones get one ruled line per movement;
 * desktop gets the real columns.
 */
export function RegisterLedger({
  rows,
  onOpen,
  showPlant,
}: {
  rows: GateGoodsMovement[];
  onOpen?: (row: GateGoodsMovement) => void;
  showPlant?: boolean;
}) {
  return (
    <>
      <ul className="gate-ledger overflow-hidden lg:hidden">
        {rows.map((row) => (
          <li key={row.id} className="gate-ledger-row">
            <LedgerCard row={row} onOpen={onOpen} showPlant={showPlant} />
          </li>
        ))}
      </ul>
      <div className="gate-ledger hidden overflow-x-auto lg:block">
        <table className="w-full min-w-[1040px] border-collapse text-[13px]">
          <thead>
            <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-content-4">
              <th className="px-3 py-3">Date · time</th>
              <th className="px-3 py-3">Invoice no · date</th>
              <th className="px-3 py-3">Party</th>
              <th className="px-3 py-3">Vehicle</th>
              <th className="px-3 py-3">Product</th>
              <th className="px-3 py-3 text-right">Qty</th>
              <th className="px-3 py-3">Unit</th>
              <th className="px-3 py-3 text-right">Amount</th>
              <th className="px-3 py-3">ERP</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const lines = row.lines?.length ? row.lines : [null];
              const recon = reconMeta(row.reconciliation_status);
              return lines.map((line, i) => (
                <tr
                  key={`${row.id}-${i}`}
                  onClick={onOpen ? () => onOpen(row) : undefined}
                  className={cn(
                    "align-top",
                    i === 0 ? "border-t border-[var(--gate-rule-strong)]" : "",
                    onOpen ? "cursor-pointer hover:bg-[var(--gate-rule)]" : "",
                  )}
                >
                  {i === 0 ? (
                    <>
                      <td className="px-3 py-2.5" rowSpan={lines.length}>
                        <div className="flex items-center gap-1.5">
                          <DirectionGlyph direction={row.direction} className="h-4 w-4 shrink-0" />
                          <span className="gate-num font-medium text-content-1">{gateDay(row.logged_at)}</span>
                        </div>
                        <div className="gate-num pl-[22px] text-content-3">{gateTime(row.logged_at)}</div>
                        {showPlant && row.plant_name ? <div className="pl-[22px] text-[12px] text-content-4">{row.plant_name}</div> : null}
                      </td>
                      <td className="px-3 py-2.5" rowSpan={lines.length}>
                        <div className="font-mono font-semibold text-content-1">{row.invoice_number}</div>
                        <div className="gate-num text-content-3">{row.invoice_date ? gateDay(row.invoice_date, true) : "—"}</div>
                      </td>
                      <td className="max-w-[200px] px-3 py-2.5" rowSpan={lines.length}>
                        <div className="truncate font-medium text-content-1">{row.party_name}</div>
                        <div className="text-[12px] text-content-4">{DIRECTION_META[row.direction]?.party}</div>
                      </td>
                      <td className="px-3 py-2.5" rowSpan={lines.length}>
                        <PlateChip value={row.vehicle_number} />
                      </td>
                    </>
                  ) : null}
                  <td className="max-w-[220px] truncate px-3 py-2.5 text-content-1">{line?.product_name ?? "From ERP document"}</td>
                  <td className="gate-num px-3 py-2.5 text-right font-mono text-content-1">{line ? gateQty(line.quantity) : "—"}</td>
                  <td className="px-3 py-2.5 font-mono text-content-3">{line?.uom ?? "—"}</td>
                  <td className="gate-num px-3 py-2.5 text-right font-mono text-content-2">{line ? gateAmount(line.amount) : "—"}</td>
                  {i === 0 ? (
                    <td className="px-3 py-2.5" rowSpan={lines.length}>
                      <TonePill label={recon.label} tone={recon.tone} soft={recon.soft} edge={recon.edge} dot />
                    </td>
                  ) : null}
                </tr>
              ));
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function LedgerCard({ row, onOpen, showPlant }: { row: GateGoodsMovement; onOpen?: (row: GateGoodsMovement) => void; showPlant?: boolean }) {
  const recon = reconMeta(row.reconciliation_status);
  const meta = DIRECTION_META[row.direction] ?? DIRECTION_META.INWARD;
  const Body = (
    <div className="flex gap-3 px-4 py-3.5">
      <div className="w-[54px] shrink-0">
        <div className="gate-num text-[15px] font-semibold leading-tight text-content-1">{gateTime(row.logged_at).replace(/\s(AM|PM)$/, "")}</div>
        <div className="text-[11px] font-semibold text-content-4">{gateTime(row.logged_at).slice(-2)}</div>
        <div className="mt-1 text-[11px] text-content-4">{gateDay(row.logged_at)}</div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.06em]" style={{ color: meta.tone }}>
            <DirectionGlyph direction={row.direction} className="h-3.5 w-3.5" />
            {meta.label}
          </span>
          <PlateChip value={row.vehicle_number} />
        </div>
        <div className="mt-1 truncate text-[15px] font-semibold text-content-1">{row.party_name}</div>
        <div className="truncate font-mono text-[13px] text-content-3">
          {row.invoice_number}
          {row.invoice_date ? ` · ${gateDay(row.invoice_date)}` : ""}
          {showPlant && row.plant_name ? ` · ${row.plant_name}` : ""}
        </div>
        {row.lines?.length ? (
          <div className="mt-1.5 space-y-0.5 text-[13px]">
            {row.lines.slice(0, 3).map((line, i) => (
              <div key={line.id ?? i} className="flex justify-between gap-3">
                <span className="truncate text-content-2">{line.product_name}</span>
                <span className="gate-num shrink-0 font-mono text-content-1">
                  {gateQty(line.quantity)} <span className="text-content-4">{line.uom}</span>
                </span>
              </div>
            ))}
            {row.lines.length > 3 ? <div className="text-[12px] text-content-4">+{row.lines.length - 3} more</div> : null}
          </div>
        ) : null}
        <div className="mt-2">
          <TonePill label={recon.label} tone={recon.tone} soft={recon.soft} edge={recon.edge} dot />
        </div>
      </div>
      {onOpen ? <ChevronRight className="mt-1 h-5 w-5 shrink-0 self-center text-content-4" /> : null}
    </div>
  );
  return onOpen ? (
    <button type="button" className="block w-full text-left hover:bg-[var(--gate-rule)]" onClick={() => onOpen(row)}>
      {Body}
    </button>
  ) : (
    Body
  );
}

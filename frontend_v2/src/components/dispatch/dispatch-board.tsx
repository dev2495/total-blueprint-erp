"use client";

import * as React from "react";
import Link from "next/link";
import { Building2, ChevronDown, Clock, ExternalLink, FileText, MapPin, Package, Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { sizeParts } from "@/components/packing/pack-lines-dialog";
import { Pill, clean, kgText as kg, micronText, num as n, parseLayers, titleCase } from "@/components/logistics/yard-ui";
import type { DispatchBoardSnapshot, DispatchLineBalance, SODispatchSummary } from "@/services/logistics";

type BoardRow = DispatchBoardSnapshot["orders"][number];

/** A released unit as the board and tray see it. */
export type BayUnit = {
  id: string;
  kind: "ROLL" | "CTN";
  label: string;
  dispatchNo: string;
  orderId: string;
  lineId: string;
  plantName: string;
  location: string;
  gross: number;
  net: number;
  tare: number;
  pcs: number;
  packs: number | null;
  mode: string;
  row: any;
};

export const gonniesText = (count: number) => `${n(count, 0)} ${count === 1 ? "gonny" : "gonnies"}`;
export const rollsText = (count: number) => `${n(count, 0)} ${count === 1 ? "roll" : "rolls"}`;
export const unitsText = (count: number) => `${n(count, 0)} ${count === 1 ? "unit" : "units"}`;
export const qtyText = (value: number, uom: string) =>
  String(uom).toUpperCase() === "PCS" ? `${n(value, 0)} pcs` : `${n(value, 2)} kg`;

/** Every released unit of an order, from its dispatch summary. */
export function unitsOfSummary(summary?: SODispatchSummary): BayUnit[] {
  if (!summary) return [];
  const orderId = String(summary.sales_order.id);
  return [
    ...(summary.gonnies || []).map((gonny) => {
      const net = Number(gonny.net_product_weight_kg || 0);
      const gross = Number(gonny.gross_weight_kg || gonny.weight_kg || 0);
      const tare =
        Number(gonny.inner_pack_tare_kg || 0) + Number(gonny.secondary_pack_tare_kg || 0) + Number(gonny.extras_tare_kg || 0);
      return {
        id: gonny.id,
        kind: "CTN" as const,
        label: clean(gonny.label_id),
        dispatchNo: clean(gonny.dispatch_unit_no || gonny.label_id),
        orderId,
        lineId: clean(gonny.sales_order_item_id),
        plantName: clean(gonny.location?.plant_name),
        location: clean(gonny.location?.name),
        gross,
        net,
        tare: tare || Math.max(0, gross - net),
        pcs: Number(gonny.qty_pcs || 0),
        packs: gonny.primary_pack_count ?? null,
        mode: gonny.content_mode === "PRIMARY_PACKS" ? "Inner packs" : "Loose",
        row: gonny,
      };
    }),
    ...(summary.rolls || []).map((roll) => {
      const net = Number(roll.net_weight_kg || roll.weight_kg || 0);
      const tare = Number(roll.tare_weight_kg || 0);
      return {
        id: roll.id,
        kind: "ROLL" as const,
        label: clean(roll.label_id),
        dispatchNo: clean(roll.dispatch_unit_no || roll.label_id),
        orderId,
        lineId: clean(roll.sales_order_item_id),
        plantName: clean(roll.location?.plant_name),
        location: clean(roll.location?.name),
        gross: Number(roll.gross_weight_kg || roll.weight_kg || net + tare),
        net,
        tare,
        pcs: 0,
        packs: null,
        mode: roll.release_mode === "UNPACKED" ? "Unpacked" : "Packed",
        row: roll,
      };
    }),
  ];
}

function LineSpec({ line, isRoll }: { line: DispatchLineBalance; isRoll: boolean }) {
  const { metric, imperial, unit } = sizeParts(line, isRoll);
  const layers = parseLayers(line.layers_label);
  const thickness = micronText(line.thickness_label);
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      {metric ? (
        <span className="inline-flex items-baseline gap-1 font-mono text-[12.5px] font-semibold text-content-1">
          {metric}
          {unit ? <span className="font-sans text-[10.5px] font-normal text-content-3">{unit}</span> : null}
          {imperial ? <span className="font-sans text-[11.5px] font-semibold text-content-3">{imperial}</span> : null}
        </span>
      ) : null}
      {layers.slice(0, 4).map((layer, index) => (
        <span key={`${layer.material}-${index}`} className="rounded-md border border-line bg-surface-2 px-1.5 py-px font-mono text-[10.5px] text-content-2">
          {layer.material}
          {layer.micron ? ` ${layer.micron}` : ""}
        </span>
      ))}
      {thickness && layers.length > 1 ? (
        <span className="rounded-md bg-content-1 px-1.5 py-px font-mono text-[10.5px] font-semibold text-surface-1">= {thickness}</span>
      ) : null}
      {line.grade_label && line.grade_label !== "-" ? (
        <span className="rounded-md border border-warning-border bg-warning-bg px-1.5 py-px text-[10.5px] text-warning-fg">{line.grade_label}</span>
      ) : null}
      {line.product_code ? <span className="font-mono text-[10.5px] text-content-3">{line.product_code}</span> : null}
    </div>
  );
}

function UnitsTable({
  units,
  tray,
  disabled,
  onToggle,
  onToggleMany,
  onPackingSlip,
  onPackingPdf,
}: {
  units: BayUnit[];
  tray: Set<string>;
  disabled: boolean;
  onToggle: (unit: BayUnit) => void;
  onToggleMany: (units: BayUnit[], on: boolean) => void;
  onPackingSlip: (units: BayUnit[]) => void;
  onPackingPdf: (units: BayUnit[]) => void;
}) {
  const PAGE = 10;
  const [page, setPage] = React.useState(1);
  const pageCount = Math.max(1, Math.ceil(units.length / PAGE));
  const visible = units.slice((page - 1) * PAGE, page * PAGE);
  const allVisible = visible.length > 0 && visible.every((unit) => tray.has(unit.id));
  const picked = units.filter((unit) => tray.has(unit.id));
  const slipScope = picked.length ? picked : visible;
  return (
    <div className="mt-2 rounded-xl border border-line bg-surface-2/40 p-2.5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-content-3">
        <span>Tick the units going out · every row shows the full unit so loaders can match labels</span>
        <span className="flex flex-wrap gap-1.5">
          <Button type="button" size="sm" variant="outline" className="h-8" disabled={disabled} onClick={() => onToggleMany(visible, !allVisible)}>
            {allVisible ? "Clear visible" : "Select visible"}
          </Button>
          <Button type="button" size="sm" variant="outline" className="h-8" data-testid="dispatch-material-ready-slip" onClick={() => onPackingSlip(slipScope)}>
            <Printer className="mr-1 h-3.5 w-3.5" aria-hidden /> Packing slip · {picked.length ? "selected" : "visible"}
          </Button>
          <Button type="button" size="sm" variant="outline" className="h-8" data-testid="dispatch-material-ready-slip-pdf" onClick={() => onPackingPdf(slipScope)}>
            <FileText className="mr-1 h-3.5 w-3.5" aria-hidden /> A4 PDF
          </Button>
        </span>
      </div>
      <div className="overflow-x-auto rounded-lg border border-line bg-surface-1">
        <table className="w-full min-w-[640px] text-[12px]">
          <thead className="bg-surface-2 text-[11px] text-content-3">
            <tr>
              <th className="w-9 px-2 py-1.5" />
              <th className="px-2 py-1.5 text-left font-medium">Unit</th>
              <th className="px-2 py-1.5 text-left font-medium">Contents</th>
              <th className="px-2 py-1.5 text-right font-medium">Net</th>
              <th className="px-2 py-1.5 text-right font-medium">Tare</th>
              <th className="px-2 py-1.5 text-right font-medium">Gross</th>
              <th className="px-2 py-1.5 text-left font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((unit) => {
              const on = tray.has(unit.id);
              return (
                <tr key={unit.id} className={cn("border-t border-line", on && "bg-info-bg")}>
                  <td className="px-2 py-1.5">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={on}
                      disabled={disabled}
                      onChange={() => onToggle(unit)}
                      aria-label={`Select ${unit.kind === "ROLL" ? "roll" : "gonny"} ${unit.label}`}
                      data-testid={unit.kind === "ROLL" ? `dispatch-roll-checkbox-${unit.id}` : `dispatch-gonny-checkbox-${unit.id}`}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className={cn("rounded px-1 text-[10px] font-bold uppercase", unit.kind === "ROLL" ? "bg-info-bg text-info-fg" : "bg-warning-bg text-warning-fg")}>
                        {unit.kind === "ROLL" ? "Roll" : "Gonny"}
                      </span>
                      <span className="break-all font-mono font-semibold text-content-1">{unit.label}</span>
                    </div>
                    <div className="flex items-center gap-1 text-[11px] text-content-3">
                      <MapPin className="h-3 w-3" aria-hidden />
                      {unit.plantName} · {unit.location}
                    </div>
                  </td>
                  <td className="px-2 py-1.5">
                    {unit.kind === "CTN" ? (
                      <>
                        <b className="tabular-nums text-content-1">{n(unit.pcs, 0)} pcs</b>
                        <div className="text-[11px] text-content-3">{unit.packs ? `${n(unit.packs, 0)} inner packs` : unit.mode}</div>
                      </>
                    ) : (
                      <>
                        <b className="text-content-1">1 roll</b>
                        <div className="text-[11px] text-content-3">{unit.mode}</div>
                      </>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{n(unit.net, 2)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{n(unit.tare, 2)}</td>
                  <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{n(unit.gross, 2)}</td>
                  <td className="px-2 py-1.5">
                    <Pill tone={on ? "info" : "good"} dot>
                      {on ? "On the tray" : "Ready to ship"}
                    </Pill>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {pageCount > 1 ? (
        <div className="mt-1.5 flex items-center justify-between text-[11.5px] text-content-3">
          <span>
            Showing {(page - 1) * PAGE + 1}–{(page - 1) * PAGE + visible.length} of {units.length} units
          </span>
          <span className="flex gap-1">
            <Button type="button" size="sm" variant="ghost" className="h-7" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Previous
            </Button>
            <Button type="button" size="sm" variant="ghost" className="h-7" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>
              Next
            </Button>
          </span>
        </div>
      ) : null}
    </div>
  );
}

function LineBlock({
  order,
  line,
  units,
  tray,
  disabled,
  onToggleMany,
  onToggle,
  onPackingSlip,
  onPackingPdf,
}: {
  order: SODispatchSummary;
  line: DispatchLineBalance;
  units: BayUnit[];
  tray: Set<string>;
  disabled: boolean;
  onToggleMany: (units: BayUnit[], on: boolean) => void;
  onToggle: (unit: BayUnit) => void;
  onPackingSlip: (units: BayUnit[]) => void;
  onPackingPdf: (units: BayUnit[]) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const isRoll = units.some((unit) => unit.kind === "ROLL") || (!units.length && line.qty_uom === "KG" && Boolean(line.pending.unreleased_rolls));
  const onTray = units.filter((unit) => tray.has(unit.id));
  const all = units.length > 0 && onTray.length === units.length;
  const part = onTray.length > 0 && !all;
  const ordered = Math.max(0, Number(line.ordered_qty || 0) - Number(line.closed_qty || 0));
  const uom = line.qty_uom;
  const qtyOf = (list: BayUnit[]) =>
    uom === "PCS" ? list.reduce((sum, unit) => sum + unit.pcs, 0) : list.reduce((sum, unit) => sum + unit.net, 0);
  const trayQty = qtyOf(onTray);
  const prev = Number(line.dispatched_qty || 0);
  const draft = Number(line.on_draft_qty || 0);
  const remaining = Math.max(0, ordered - prev - draft - trayQty);
  const pct = (value: number) => `${ordered ? Math.max(0, Math.min(100, (value / ordered) * 100)) : 0}%`;
  const pending = [
    line.pending.open_gonnies ? `${gonniesText(line.pending.open_gonnies)} open` : "",
    line.pending.unpacked_batches ? `${line.pending.unpacked_batches} unpacked batch${line.pending.unpacked_batches === 1 ? "" : "es"} · ${n(line.pending.unpacked_pcs, 0)} pcs` : "",
    line.pending.unreleased_rolls ? `${rollsText(line.pending.unreleased_rolls)} not released` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const plants = Array.from(new Set(units.map((unit) => unit.plantName).filter(Boolean)));
  const gross = units.reduce((sum, unit) => sum + unit.gross, 0);
  const net = units.reduce((sum, unit) => sum + unit.net, 0);
  const pcs = units.reduce((sum, unit) => sum + unit.pcs, 0);
  if (!units.length) {
    return (
      <div className="rounded-xl border border-dashed border-line bg-surface-2/40 px-3 py-2.5" data-testid={`dispatch-line-${order.sales_order.id}-${line.line_no}`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 items-start gap-2.5">
            <input type="checkbox" className="mt-1 h-5 w-5" disabled aria-label="Nothing released on this line yet" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="rounded-md border border-line-strong bg-surface-1 px-1.5 font-mono text-[11px] font-bold text-content-1">L{line.line_no}</span>
                <span className="text-[13px] font-semibold text-content-2">{clean(line.product_name)}</span>
              </div>
              <LineSpec line={line} isRoll={uom === "KG" && !line.pending.unpacked_batches && !line.pending.open_gonnies} />
            </div>
          </div>
          <div className="text-right text-[11.5px]">
            <div className="text-[13px] font-semibold text-warning-fg">{line.line_status === "CLOSED" ? "Closed" : "Waiting"}</div>
            <div className="text-content-3">{pending || "nothing released yet"}</div>
            <div className="text-content-3">
              remaining {qtyText(Math.max(0, ordered - prev - draft), uom)} of {qtyText(ordered, uom)}
            </div>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div
      className={cn(
        "rounded-xl border px-3 py-2.5 transition-colors",
        all ? "border-primary/50 bg-info-bg" : part ? "border-primary/30 bg-info-bg" : "border-line bg-surface-1",
      )}
      data-testid={`dispatch-line-${order.sales_order.id}-${line.line_no}`}
    >
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div className="flex min-w-0 items-start gap-2.5">
          <input
            type="checkbox"
            className="mt-1 h-5 w-5"
            checked={all}
            ref={(element) => {
              if (element) element.indeterminate = part;
            }}
            disabled={disabled}
            onChange={() => onToggleMany(units, !all)}
            aria-label={`Load every ready unit of line ${line.line_no}`}
            data-testid={`dispatch-line-check-${order.sales_order.id}-${line.line_no}`}
          />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded-md border border-line-strong bg-surface-1 px-1.5 font-mono text-[11px] font-bold text-content-1">L{line.line_no}</span>
              <span className="text-[13.5px] font-semibold text-content-1">{clean(line.product_name)}</span>
              <Pill tone={isRoll ? "info" : "warn"}>{isRoll ? "Roll" : "Pouch"}</Pill>
              {plants.length > 1 ? (
                <Pill tone="warn" title="Units at two plants are split into separate slips">
                  {plants.join(" & ")}
                </Pill>
              ) : null}
            </div>
            <LineSpec line={line} isRoll={isRoll} />
          </div>
        </div>
        <div className="text-left sm:text-right">
          <div className="text-[15px] font-bold text-content-1">{isRoll ? rollsText(units.length) : gonniesText(units.length)}</div>
          <div className="text-[11.5px] tabular-nums text-content-3">
            {isRoll ? `${kg(net)} net · ${kg(gross)} gross` : `${n(pcs, 0)} pcs · ${kg(gross)} gross`}
          </div>
          {onTray.length ? (
            <div className="text-[11.5px] font-semibold text-primary">
              {all ? "All" : `${onTray.length} of ${units.length}`} on the tray · {qtyText(trayQty, uom)}
            </div>
          ) : null}
          {line.on_draft_units ? (
            <div className="text-[11.5px] text-warning-fg">{unitsText(line.on_draft_units)} on a draft slip</div>
          ) : null}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <div className="min-w-[220px] flex-1">
          <div className="flex h-1.5 overflow-hidden rounded-full bg-surface-2" title={`Ordered ${qtyText(ordered, uom)}`}>
            <span className="h-full bg-success-fg" style={{ width: pct(prev) }} />
            <span className="h-full bg-primary" style={{ width: pct(trayQty + draft) }} />
          </div>
          <div className="mt-1 text-[11.5px] text-content-3">
            Ordered <b className="text-content-2">{qtyText(ordered, uom)}</b> · dispatched {qtyText(prev, uom)}
            {trayQty || draft ? ` · this ${qtyText(trayQty + draft, uom)}` : ""} · <b className="text-content-2">remaining {qtyText(remaining, uom)}</b>
            {pending ? <span className="text-warning-fg"> · {pending}</span> : null}
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-8"
          aria-expanded={open}
          data-testid={`dispatch-units-toggle-${order.sales_order.id}-${line.line_no}`}
          onClick={() => setOpen((value) => !value)}
        >
          <ChevronDown className={cn("mr-1 h-3.5 w-3.5 transition-transform", open && "rotate-180")} aria-hidden />
          Units <span className="ml-1 font-mono text-[10.5px]">{units.length}</span>
        </Button>
      </div>
      {open ? (
        <UnitsTable
          units={units}
          tray={tray}
          disabled={disabled}
          onToggle={onToggle}
          onToggleMany={onToggleMany}
          onPackingSlip={onPackingSlip}
          onPackingPdf={onPackingPdf}
        />
      ) : null}
    </div>
  );
}

function OrderBlock({
  row,
  summary,
  tray,
  disabled,
  onToggleMany,
  onToggle,
  onPackingSlip,
  onPackingPdf,
}: {
  row: BoardRow;
  summary?: SODispatchSummary;
  tray: Set<string>;
  disabled: boolean;
  onToggleMany: (units: BayUnit[], on: boolean) => void;
  onToggle: (unit: BayUnit) => void;
  onPackingSlip: (orderId: string, units: BayUnit[], pdf?: boolean) => void;
  onPackingPdf?: never;
}) {
  const order = row.sales_order as BoardRow["sales_order"] & { job_name?: string };
  const units = unitsOfSummary(summary);
  const ready = Number(row.available_for_dispatch?.gonnies_count || 0) + Number(row.available_for_dispatch?.rolls_count || 0);
  const pending =
    Number(row.packing_pending?.open_gonnies_count || 0) +
    Number(row.packing_pending?.unpacked_batch_count || 0) +
    Number(row.packing_pending?.unreleased_rolls_count || 0) +
    Number(row.packing_pending?.unreleased_sealed_gonnies_count || 0);
  const delivery = summary?.sales_order.delivery;
  const lines = summary?.lines || [];
  const dispatchedLines = lines.filter((line) => Number(line.dispatched_qty || 0) > 0);
  const readyNet = units.reduce((sum, unit) => sum + unit.net, 0);
  const readyGross = units.reduce((sum, unit) => sum + unit.gross, 0);
  const readyPcs = units.reduce((sum, unit) => sum + unit.pcs, 0);
  const orderedText = lines.map((line) => qtyText(Math.max(0, line.ordered_qty - line.closed_qty), line.qty_uom)).join(" + ") || n(summary?.ordered_qty || 0);
  return (
    <article
      className="rounded-2xl border border-line bg-surface-1 p-3"
      data-testid="dispatch-order-card"
      data-order-id={order.id}
      data-unit-roll={Number(row.available_for_dispatch?.rolls_count || 0) > 0 ? "true" : "false"}
      data-unit-ctn={Number(row.available_for_dispatch?.gonnies_count || 0) > 0 ? "true" : "false"}
      data-status={ready ? "READY" : "WAITING"}
      data-customer={order.customer_name}
    >
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-mono text-[13px] font-semibold text-content-1">{order.order_number}</span>
        {order.job_name ? (
          <span className="inline-flex min-w-0 items-center gap-1">
            <span className="rounded bg-order-bg px-1 py-px text-[9.5px] font-bold uppercase tracking-[0.08em] text-order-fg ring-1 ring-order-border">Job</span>
            <span className="truncate text-[15px] font-bold text-content-1">{order.job_name}</span>
          </span>
        ) : null}
        <Pill tone={ready ? "good" : "warn"} dot>
          {ready ? `${unitsText(ready)} ready` : "Waiting on packing"}
        </Pill>
        <Pill tone="neutral">{titleCase(order.status)}</Pill>
        <span className="ml-auto flex gap-1">
          <Button asChild size="sm" variant="ghost" className="h-8">
            <Link href={`/sales/orders/${order.id}`}>
              <ExternalLink className="mr-1 h-3.5 w-3.5" aria-hidden /> Order
            </Link>
          </Button>
          <Button asChild size="sm" variant="ghost" className="h-8">
            <Link href="/logistics/packing">
              <Package className="mr-1 h-3.5 w-3.5" aria-hidden /> Packing Yard
            </Link>
          </Button>
        </span>
      </header>
      <div className="mt-1 flex items-start gap-1 text-[12px] text-content-3">
        <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
        <span>
          <b className="text-content-2">{clean(delivery?.delivery_to) || order.customer_name}</b>
          {clean(delivery?.address) ? (
            ` · ${delivery?.address}`
          ) : clean(delivery?.location) ? (
            ` · ${delivery?.location}`
          ) : (
            <span className="text-warning-fg"> · No delivery address on the order; enter a dispatch-only location in the tray</span>
          )}
        </span>
      </div>
      <div className="mt-0.5 flex flex-wrap gap-x-4 text-[12px] text-content-3">
        <span>
          Ordered <b className="text-content-2">{orderedText}</b>
        </span>
        <span>
          Dispatched so far{" "}
          <b className="text-content-2">
            {dispatchedLines.length ? dispatchedLines.map((line) => `L${line.line_no} ${qtyText(line.dispatched_qty, line.qty_uom)}`).join(" · ") : "nothing yet"}
          </b>
        </span>
        {pending ? (
          <span className="inline-flex items-center gap-1 text-warning-fg">
            <Clock className="h-3.5 w-3.5" aria-hidden /> {n(pending, 0)} still in packing
          </span>
        ) : null}
      </div>
      <details className="group mt-1">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[12px] font-semibold text-content-3 hover:text-content-1">
          <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" aria-hidden /> Order metrics
        </summary>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
          {[
            ["Ready units", n(units.length, 0), `${rollsText(units.filter((u) => u.kind === "ROLL").length)} · ${gonniesText(units.filter((u) => u.kind === "CTN").length)}`],
            ["Ready net", kg(readyNet), readyPcs ? `${n(readyPcs, 0)} pcs` : "product weight"],
            ["Ready gross", kg(readyGross), "truck weight"],
            ["Ordered", lines.length > 1 ? `${lines.length} lines` : orderedText, lines.length > 1 ? orderedText : "sales quantity"],
            [
              "Produced",
              summary?.produced_qty.rolls_kg ? kg(summary.produced_qty.rolls_kg) : `${n(summary?.produced_qty.batches_pcs || 0, 0)} pcs`,
              "to date",
            ],
            ["Still in packing", n(pending, 0), "not yet released"],
          ].map(([label, value, sub]) => (
            <div key={label} className="rounded-xl border border-line bg-surface-2/50 px-3 py-2">
              <div className="text-[11px] text-content-3">{label}</div>
              <div className="truncate text-[15px] font-semibold tabular-nums text-content-1">{value}</div>
              <div className="truncate text-[11px] text-content-3">{sub}</div>
            </div>
          ))}
        </div>
      </details>
      <div className="mt-2 space-y-2">
        {!summary ? (
          <div className="erp-skeleton h-[72px] rounded-xl" />
        ) : (
          lines
            .filter((line) => line.line_status !== "CLOSED" || units.some((unit) => unit.lineId === line.id))
            .map((line) => (
              <LineBlock
                key={line.id}
                order={summary}
                line={line}
                units={units.filter((unit) => unit.lineId === line.id)}
                tray={tray}
                disabled={disabled}
                onToggleMany={onToggleMany}
                onToggle={onToggle}
                onPackingSlip={(list) => onPackingSlip(order.id, list)}
                onPackingPdf={(list) => onPackingSlip(order.id, list, true)}
              />
            ))
        )}
      </div>
    </article>
  );
}

/** Ready to dispatch, grouped customer → order → line. */
export function DispatchBoard({
  rows,
  summaries,
  tray,
  disabled,
  onToggleMany,
  onToggle,
  onPackingSlip,
}: {
  rows: BoardRow[];
  summaries: Map<string, SODispatchSummary>;
  tray: Set<string>;
  disabled: boolean;
  onToggleMany: (units: BayUnit[], on: boolean) => void;
  onToggle: (unit: BayUnit) => void;
  onPackingSlip: (orderId: string, units: BayUnit[], pdf?: boolean) => void;
}) {
  const groups: Array<{ customer: string; rows: BoardRow[] }> = [];
  rows.forEach((row) => {
    let group = groups.find((item) => item.customer === row.sales_order.customer_name);
    if (!group) {
      group = { customer: row.sales_order.customer_name, rows: [] };
      groups.push(group);
    }
    group.rows.push(row);
  });
  return (
    <div className="space-y-4">
      {groups.map((group) => {
        const units = group.rows.flatMap((row) => unitsOfSummary(summaries.get(String(row.sales_order.id))));
        const gonnies = units.filter((unit) => unit.kind === "CTN").length;
        const rolls = units.length - gonnies;
        const allIn = units.length > 0 && units.every((unit) => tray.has(unit.id));
        return (
          <section key={group.customer} className="space-y-2" data-testid="dispatch-customer-group">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1">
              <span className="inline-flex items-center gap-1.5 text-[13.5px] font-bold text-content-1">
                <Building2 className="h-4 w-4 text-content-3" aria-hidden /> {group.customer}
              </span>
              <span className="text-[12px] text-content-3">
                {group.rows.length} order{group.rows.length === 1 ? "" : "s"}
                {gonnies ? ` · ${gonniesText(gonnies)}` : ""}
                {rolls ? ` · ${rollsText(rolls)}` : ""} · <b className="text-content-2">{kg(units.reduce((sum, unit) => sum + unit.gross, 0))}</b> gross
              </span>
              {units.length ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="ml-auto h-8"
                  disabled={disabled}
                  onClick={() => onToggleMany(units, !allIn)}
                >
                  {allIn ? "Unload all" : "Load all ready"}
                </Button>
              ) : null}
            </div>
            {group.rows.map((row) => (
              <OrderBlock
                key={row.sales_order.id}
                row={row}
                summary={summaries.get(String(row.sales_order.id))}
                tray={tray}
                disabled={disabled}
                onToggleMany={onToggleMany}
                onToggle={onToggle}
                onPackingSlip={onPackingSlip}
              />
            ))}
          </section>
        );
      })}
    </div>
  );
}

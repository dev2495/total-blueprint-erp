"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  ClipboardList,
  Clock,
  Cylinder,
  Factory,
  Lock,
  FileText,
  History,
  Layers,
  Package,
  PackageCheck,
  Scale,
  Send,
  ShieldAlert,
  Truck,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { PackingCheckPanel } from "@/components/packing/packing-check-panel";
import { MadeCard } from "@/components/spine/made-card";
import { OrderSpine, useOrderSpine } from "@/components/spine/order-spine";
import { cn } from "@/lib/utils";
import {
  OrderMetric,
  Pill,
  clean,
  kgText as kg,
  micronText,
  num as n,
  parseLayers,
  titleCase,
} from "@/components/logistics/yard-ui";
import type { PackingBoardSnapshot, PackingCheckSummary, SOPackingSummary } from "@/services/logistics";
import {
  getGonnyExpected,
  gonnyStage,
  packLineState,
  packLinesOf,
  batchNetKg,
  packingPlanOf,
  sizeParts,
  type PackLine,
} from "./pack-lines-dialog";

type BoardRow = PackingBoardSnapshot["orders"][number];
export type YardMode = "queue" | "progress";

const sinceText = (iso?: string | null) => {
  if (!iso) return "";
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (!Number.isFinite(minutes)) return "";
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h`;
  return `${Math.round(minutes / 1440)} d`;
};

/** A line can be packed now: it has a batch with pouches, or a roll not yet released. */
export const lineHasWork = (line: PackLine) =>
  line.batches.some((batch) => Number(batch.qty_pcs || 0) > 0) || line.rolls.some((roll) => !roll.released_to_dispatch);

/** Product identity of a line, as on the sample: size first (mm and inches), name, layers, plan. */
function LineIdentity({ line }: { line: PackLine }) {
  const row = line.sample;
  const isRoll = line.rolls.length > 0 && !line.batches.length && !line.gonnies.length;
  const { metric, imperial, unit } = sizeParts(row, isRoll);
  const thickness = micronText(row?.thickness_label);
  // "12 + 12 + 50" against three layers: each layer chip carries its own micron, the total follows.
  const microns = String(row?.thickness_label ?? "")
    .replace(/\s*microns?$/i, "")
    .replace(/µ$/, "")
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  const layers = parseLayers(row?.layers_label).map((layer, index) => ({
    ...layer,
    micron: layer.micron || (microns.length === parseLayers(row?.layers_label).length && microns[index] ? `${microns[index]}µ` : ""),
  }));
  const totalMicron = microns.length && microns.every((part) => Number.isFinite(Number(part))) ? microns.reduce((sum, part) => sum + Number(part), 0) : null;
  const batch = line.batches[0];
  const plan = batch ? packingPlanOf(batch) : undefined;
  const Glyph = isRoll ? Cylinder : Package;
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-info-border bg-info-bg text-primary" aria-hidden>
        <Glyph className="h-[18px] w-[18px]" />
      </span>
      <div className="min-w-0">
        {metric ? (
          <div className="flex flex-wrap items-baseline gap-x-1.5 leading-tight">
            <span className="font-mono text-[15px] font-bold text-content-1">{metric}</span>
            {unit ? <span className="text-[11px] text-content-3">{unit}</span> : null}
            {imperial ? <span className="text-[12px] font-semibold text-content-3">· {imperial}</span> : null}
          </div>
        ) : null}
        <div className="truncate text-[12.5px] font-semibold uppercase tracking-[0.01em] text-content-2">{line.name}</div>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {layers.slice(0, 4).map((layer, index) => (
            <React.Fragment key={`${layer.material}-${index}`}>
              {index ? <span className="text-[10px] text-content-4">+</span> : null}
              <span className="inline-flex items-center gap-1 rounded-md border border-line bg-surface-2 px-1.5 py-px font-mono text-[10.5px] text-content-2">
                <span className="h-1.5 w-1.5 rounded-sm bg-primary/70" aria-hidden />
                {layer.material}
                {layer.micron ? <b className="font-semibold text-content-1">{layer.micron}</b> : null}
              </span>
            </React.Fragment>
          ))}
          {layers.length && totalMicron != null && layers.every((layer) => layer.micron) ? (
            layers.length > 1 ? <b className="font-mono text-[11px] text-content-1">= {Math.round(totalMicron * 10) / 10}µ</b> : null
          ) : thickness ? (
            <span className="inline-flex items-center rounded-md border border-line bg-surface-1 px-1.5 py-px font-mono text-[10.5px] font-semibold text-content-1">
              = {thickness}
            </span>
          ) : null}
          {isRoll ? (
            <span className="inline-flex items-center rounded-md border border-line bg-surface-1 px-1.5 py-px text-[10.5px] text-content-3">
              {line.rolls[0]?.roll_pack_enabled ? "packed roll · sheet / wrap" : "roll"}
            </span>
          ) : plan?.content_mode === "PRIMARY_PACKS" ? (
            <span className="inline-flex items-center gap-1 rounded-md border border-order-border bg-order-bg px-1.5 py-px text-[10.5px] text-order-fg">
              <Package className="h-3 w-3" aria-hidden />
              {plan.inner_pouch?.code || "inner pouch"}
              {plan.pcs_per_pack ? ` · ${plan.pcs_per_pack}/pack` : ""}
              {plan.inner_pouch?.weight_kg ? ` · ${n(plan.inner_pouch.weight_kg * 1000, 2)} g` : ""}
            </span>
          ) : line.batches.length ? (
            <span className="inline-flex items-center rounded-md border border-line bg-surface-1 px-1.5 py-px text-[10.5px] text-content-3">
              loose from machine
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** One ready line in the queue, as the sample's line row. */
function LineRow({
  line,
  picked,
  onTogglePick,
  onPack,
  onShowProgress,
  onMoveToStock,
}: {
  line: PackLine;
  picked: boolean;
  onTogglePick: () => void;
  onPack: () => void;
  onShowProgress: () => void;
  onMoveToStock?: () => void;
}) {
  const state = packLineState(line);
  const isRoll = state.kind === "ROLL";
  const pcs = state.pendingPcs;
  const batchKg = line.batches.reduce((sum, batch) => sum + batchNetKg(batch), 0);
  const rollNet = state.openRolls.reduce((sum, roll) => sum + Number(roll.net_weight_kg || roll.weight_kg || 0), 0);
  const rollGross = state.openRolls.reduce((sum, roll) => sum + Number(roll.gross_weight_kg || roll.weight_kg || 0), 0);
  const batch = line.batches[0];
  const plan = batch ? packingPlanOf(batch) : undefined;
  const packsLeft = line.batches.reduce((sum, row) => sum + Number(packingPlanOf(row).packs_left || 0), 0);
  const inProgress = state.open.length + state.sealed.length;
  const machine = clean((batch as any)?.machine_name) || clean((line.rolls[0] as any)?.job_no) || "Machine output";
  const location = clean(batch?.location?.name || line.rolls[0]?.location?.name);
  const since = sinceText((batch as any)?.ready_at);
  return (
    <div
      data-testid={`packing-line-row-${line.index}`}
      data-line-key={line.key}
      className={cn(
        "grid items-center gap-x-3 gap-y-2 border-t border-line px-3.5 py-2.5 transition-colors sm:px-4",
        "grid-cols-[24px_34px_minmax(0,1fr)] lg:grid-cols-[24px_34px_minmax(0,1fr)_150px_150px_128px_auto]",
        picked ? "bg-info-bg" : "hover:bg-surface-2/50",
      )}
    >
      <input
        type="checkbox"
        className="h-5 w-5 accent-[hsl(var(--primary))]"
        checked={picked}
        onChange={onTogglePick}
        aria-label={`Select line ${line.index} ${line.name} of ${line.orderNumber}`}
        data-testid={`packing-line-select-${line.index}`}
      />
      <span className="grid h-7 place-items-center rounded-md border border-line-strong bg-surface-1 font-mono text-[11.5px] font-bold text-content-1">
        L{line.index}
      </span>
      <div className="min-w-0">
        <LineIdentity line={line} />
        {line.closed ? (
          <div
            className="mt-1.5 flex flex-wrap items-center gap-1.5 rounded-lg border border-warning-border bg-warning-bg px-2 py-1 text-[11.5px] text-content-2"
            data-testid={`packing-line-closed-${line.index}`}
          >
            <Lock className="h-3 w-3 text-warning-fg" aria-hidden />
            <b className="text-warning-fg">{line.closed}</b>
            <span>· pack and release to send it, or move it to free stock</span>
            {onMoveToStock ? (
              <button
                type="button"
                className="font-semibold text-primary underline-offset-2 hover:underline"
                onClick={onMoveToStock}
                data-testid={`packing-line-move-stock-${line.index}`}
              >
                Move to stock
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="col-span-3 grid justify-items-start gap-px text-left lg:col-span-1 lg:justify-items-end lg:text-right">
        {isRoll ? (
          <>
            <span className="whitespace-nowrap font-mono text-[15px] font-semibold text-content-1">{kg(rollNet)}</span>
            <span className="text-[11.5px] text-content-3">
              {state.openRolls.length} roll{state.openRolls.length === 1 ? "" : "s"} · {kg(rollGross)} gross
            </span>
            <span className="text-[11.5px] text-content-4">no packing weight</span>
          </>
        ) : (
          <>
            <span className="whitespace-nowrap font-mono text-[15px] font-semibold text-content-1">
              {n(pcs, 0)}
              <span className="ml-0.5 text-[11px] font-normal text-content-3">pcs</span>
            </span>
            <span className="text-[11.5px] text-content-3">
              {kg(batchKg)} net{plan?.net_kg_per_pcs ? ` · ${n(plan.net_kg_per_pcs * 1000, 2)} g/pc` : ""}
            </span>
            {plan?.content_mode === "PRIMARY_PACKS" ? (
              <span className="text-[11.5px] text-order-fg">
                {plan.pcs_per_pack ? `${n(packsLeft, 0)} inner packs × ${plan.pcs_per_pack}` : "inner packs · count at packing"}
              </span>
            ) : (
              <span className="text-[11.5px] text-content-4">loose pouches</span>
            )}
          </>
        )}
      </div>
      <div className="col-span-3 grid gap-px lg:col-span-1">
        <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-content-1">
          <Factory className="h-3.5 w-3.5 text-content-3" aria-hidden />
          <span className="truncate">{machine}</span>
        </span>
        <span className="flex items-center gap-1 truncate text-[11.5px] text-content-3">
          <Clock className="h-3 w-3 shrink-0" aria-hidden />
          <span className="truncate">
            {since ? `ready ${since}` : "in the yard"}
            {location ? ` · ${location}` : ""}
          </span>
        </span>
      </div>
      <div className="col-span-2 grid justify-items-start gap-0.5 lg:col-span-1">
        <Pill tone="warn" dot>
          {isRoll ? "To release" : "To pack"}
        </Pill>
        <span className="text-[11.5px] text-content-3">
          {isRoll
            ? line.rolls[0]?.roll_pack_enabled
              ? "sheet / wrap"
              : "roll ships as it is"
            : `${line.batches.length} batch${line.batches.length === 1 ? "" : "es"}`}
          {inProgress ? (
            <>
              {" · "}
              <button type="button" className="font-medium text-primary underline-offset-2 hover:underline" onClick={onShowProgress}>
                {inProgress} gonn{inProgress === 1 ? "y" : "ies"} in progress
              </button>
            </>
          ) : null}
        </span>
      </div>
      <div className="flex justify-end">
        <Button type="button" size="sm" data-testid={`packing-line-pack-${line.index}`} onClick={onPack}>
          {isRoll ? <PackageCheck className="mr-1.5 h-4 w-4" aria-hidden /> : <Package className="mr-1.5 h-4 w-4" aria-hidden />}
          {isRoll ? (line.rolls[0]?.roll_pack_enabled ? "Pack & release" : "Release") : "Pack"}
        </Button>
      </div>
    </div>
  );
}

/** In progress: the line's open and sealed gonnies, with their weights and what is next. */
function ProgressLine({ line, onOpen }: { line: PackLine; onOpen: () => void }) {
  const state = packLineState(line);
  const units = line.gonnies.filter((gonny) => gonnyStage(gonny) !== "RELEASED");
  if (!units.length) return null;
  return (
    <div className="border-t border-line px-3.5 py-3 sm:px-4" data-testid={`packing-progress-line-${line.index}`}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="grid h-6 place-items-center rounded-md border border-line-strong bg-surface-1 px-1.5 font-mono text-[11px] font-bold text-content-1">
          L{line.index}
        </span>
        <span className="text-[13px] font-semibold text-content-1">{line.name}</span>
        <span className="text-[11.5px] text-content-3">{line.spec}</span>
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          <Pill tone="info">{state.open.length} open</Pill>
          <Pill tone="accent">{state.sealed.length} sealed</Pill>
          <Pill tone="good">{state.releasedGonnies.length} released</Pill>
          {state.pendingPcs ? (
            <Button type="button" size="sm" variant="outline" className="h-8" onClick={onOpen}>
              <Package className="mr-1 h-3.5 w-3.5" aria-hidden /> Pack {n(state.pendingPcs, 0)} pcs left
            </Button>
          ) : null}
        </span>
      </div>
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[720px] text-[12px]">
          <thead className="bg-surface-2 text-[11px] text-content-3">
            <tr>
              <th className="px-3 py-1.5 text-left font-medium">Unit</th>
              <th className="px-3 py-1.5 text-left font-medium">Contents</th>
              <th className="px-3 py-1.5 text-right font-medium">Product net</th>
              <th className="px-3 py-1.5 text-right font-medium">Expected</th>
              <th className="px-3 py-1.5 text-right font-medium">Weighed gross</th>
              <th className="px-3 py-1.5 text-right font-medium">vs expected</th>
              <th className="px-3 py-1.5 text-right font-medium" />
            </tr>
          </thead>
          <tbody>
            {units.map((gonny) => {
              const stage = gonnyStage(gonny);
              const variance = Number(gonny.gross_variance_pct || 0);
              return (
                <tr key={gonny.id} className="border-t border-line">
                  <td className="px-3 py-1.5">
                    <div className="font-mono font-semibold text-content-1">{clean(gonny.dispatch_unit_no || gonny.label_id)}</div>
                    <div className="text-[11px] text-content-3">from {gonny.batch_no || "batch"}</div>
                  </td>
                  <td className="px-3 py-1.5 tabular-nums">
                    {n(gonny.qty_pcs, 0)} pcs
                    <div className="text-[11px] text-content-3">
                      {gonny.primary_pack_count ? `${n(gonny.primary_pack_count, 0)} inner packs` : "loose"}
                    </div>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{kg(gonny.net_product_weight_kg)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{kg(getGonnyExpected(gonny))}</td>
                  <td className="px-3 py-1.5 text-right font-semibold tabular-nums">
                    {stage === "OPEN" ? <span className="font-normal text-content-4">—</span> : kg(gonny.gross_weight_kg)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {stage === "OPEN" ? (
                      <span className="text-content-4">not weighed</span>
                    ) : (
                      <span className={Math.abs(variance) > 2 ? "font-semibold text-warning-fg" : "text-success-fg"}>
                        {variance > 0 ? "+" : ""}
                        {n(variance, 1)}%
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <Button
                      type="button"
                      size="sm"
                      variant={stage === "OPEN" ? "outline" : "default"}
                      className="h-8"
                      data-testid={`packing-progress-${stage === "OPEN" ? "weigh" : "release"}-${gonny.id}`}
                      onClick={onOpen}
                    >
                      {stage === "OPEN" ? (
                        <>
                          <Scale className="mr-1 h-3.5 w-3.5" aria-hidden /> Weigh
                        </>
                      ) : (
                        <>
                          <Send className="mr-1 h-3.5 w-3.5" aria-hidden /> Release
                        </>
                      )}
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OrderDetails({ summary, lines }: { summary: SOPackingSummary; lines: PackLine[] }) {
  const [tab, setTab] = React.useState<"units" | "check" | "order">("units");
  const spine = useOrderSpine({ orderId: String(summary.sales_order.id) });
  const pending =
    Number(summary.packing_pending.batches_count || 0) +
    Number(summary.packing_pending.rolls_count || 0) +
    Number(summary.packing_pending.open_gonnies_count || 0) +
    Number(summary.packing_pending.sealed_gonnies_count || 0);
  const released = Number(summary.ready_for_dispatch.gonnies_count || 0) + Number(summary.ready_for_dispatch.rolls_count || 0);
  const releasedNet =
    Number(summary.ready_for_dispatch.gonnies_net_kg || 0) +
    Number(summary.ready_for_dispatch.rolls_net_kg || summary.ready_for_dispatch.rolls_kg || 0);
  const releasedGross =
    Number(summary.ready_for_dispatch.gonnies_gross_kg || 0) +
    Number(summary.ready_for_dispatch.rolls_gross_kg || summary.ready_for_dispatch.rolls_kg || 0);
  const orderId = String(summary.sales_order.id);
  return (
    <div className="border-t border-line bg-surface-2/40" data-testid="packing-order-details">
      <div className="flex gap-1 px-3.5 pt-2.5 sm:px-4" role="tablist">
        {(
          [
            ["units", "Units & batches"],
            ["check", "Packing check"],
            ["order", "Order & links"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={cn(
              "min-h-[36px] rounded-t-lg border border-b-0 px-3 text-[12.5px] font-semibold transition-colors",
              tab === value ? "border-line bg-surface-1 text-content-1" : "border-transparent text-content-3 hover:text-content-1",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="border-t border-line bg-surface-1 p-3.5 sm:p-4">
        {tab === "units" ? (
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full min-w-[760px] text-[12px]">
              <thead className="bg-surface-2 text-[11px] text-content-3">
                <tr>
                  <th className="px-3 py-1.5 text-left font-medium">Line</th>
                  <th className="px-3 py-1.5 text-left font-medium">Unit / batch</th>
                  <th className="px-3 py-1.5 text-right font-medium">Contents</th>
                  <th className="px-3 py-1.5 text-right font-medium">Net</th>
                  <th className="px-3 py-1.5 text-right font-medium">Gross</th>
                  <th className="px-3 py-1.5 text-left font-medium">Stage</th>
                </tr>
              </thead>
              <tbody>
                {lines.flatMap((line) => [
                  ...line.batches.map((batch) => (
                    <tr key={`b-${batch.id}`} className="border-t border-line">
                      <td className="px-3 py-1.5 font-mono font-semibold">L{line.index}</td>
                      <td className="px-3 py-1.5">
                        <span className="font-mono">{batch.batch_number}</span>
                        <span className="ml-1 text-[11px] text-content-3">batch · {batch.location?.name || ""}</span>
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{n(batch.qty_pcs, 0)} pcs</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{kg(batchNetKg(batch))}</td>
                      <td className="px-3 py-1.5 text-right text-content-4">—</td>
                      <td className="px-3 py-1.5">
                        <Pill tone="warn">To pack</Pill>
                      </td>
                    </tr>
                  )),
                  ...line.gonnies.map((gonny) => {
                    const stage = gonnyStage(gonny);
                    return (
                      <tr key={`g-${gonny.id}`} className="border-t border-line">
                        <td className="px-3 py-1.5 font-mono font-semibold">L{line.index}</td>
                        <td className="px-3 py-1.5 font-mono">{clean(gonny.dispatch_unit_no || gonny.label_id)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{n(gonny.qty_pcs, 0)} pcs</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{kg(gonny.net_product_weight_kg)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{stage === "OPEN" ? "—" : kg(gonny.gross_weight_kg)}</td>
                        <td className="px-3 py-1.5">
                          <Pill tone={stage === "OPEN" ? "info" : stage === "SEALED" ? "accent" : "good"}>
                            {stage === "OPEN" ? "Open · weigh" : stage === "SEALED" ? "Sealed" : "In Dispatch Bay"}
                          </Pill>
                        </td>
                      </tr>
                    );
                  }),
                  ...line.rolls.map((roll) => (
                    <tr key={`r-${roll.id}`} className="border-t border-line">
                      <td className="px-3 py-1.5 font-mono font-semibold">L{line.index}</td>
                      <td className="px-3 py-1.5 font-mono">{roll.label_id}</td>
                      <td className="px-3 py-1.5 text-right">1 roll</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{kg(roll.net_weight_kg || roll.weight_kg)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{kg(roll.gross_weight_kg || roll.weight_kg)}</td>
                      <td className="px-3 py-1.5">
                        <Pill tone={roll.released_to_dispatch ? "good" : "warn"}>
                          {roll.released_to_dispatch ? "In Dispatch Bay" : "To pack"}
                        </Pill>
                      </td>
                    </tr>
                  )),
                ])}
              </tbody>
            </table>
          </div>
        ) : tab === "check" ? (
          <PackingCheckPanel salesOrderId={orderId} />
        ) : (
          <div className="space-y-3">
            <OrderSpine orderId={orderId} current="yard" testId="packing-order-spine" />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
              <OrderMetric label="Ordered" value={n(summary.ordered_qty)} sub="sales quantity" />
              <OrderMetric label="Still to pack" value={n(pending, 0)} sub="batches, open & sealed units" tone={pending ? "warn" : undefined} />
              <OrderMetric label="Released" value={n(released, 0)} sub="units in Dispatch Bay" tone={released ? "good" : undefined} />
              <OrderMetric label="Released net" value={kg(releasedNet)} sub="billable product" />
              <OrderMetric label="Released gross" value={kg(releasedGross)} sub="with packing tare" />
              <OrderMetric label="Status" value={titleCase(summary.sales_order.status)} />
            </div>
            {spine.data?.made ? <MadeCard made={spine.data.made} dense testId="packing-made-card" /> : null}
            <div className="grid gap-2 md:grid-cols-3">
              {[
                {
                  href: `/logistics/packing/audit?sales_order_id=${orderId}`,
                  icon: <History className="h-4 w-4" />,
                  title: "Packing material audit",
                  copy: "Gonnies, inner pouches and extras used on this order",
                },
                {
                  href: `/dashboard/planner/control-tower/completed-trace?search=${encodeURIComponent(summary.sales_order.order_number)}`,
                  icon: <ClipboardList className="h-4 w-4" />,
                  title: "Completed production trace",
                  copy: "Jobs, rolls and batches produced for this order",
                },
                {
                  href: `/dashboard/planner/control-tower/plan-queue?search=${encodeURIComponent(summary.sales_order.order_number)}`,
                  icon: <Layers className="h-4 w-4" />,
                  title: "Upstream plan queue",
                  copy: "Anything still planned or running for this order",
                },
              ].map((item) => (
                <Link
                  key={item.title}
                  href={item.href}
                  className="group flex items-start gap-3 rounded-xl border border-line bg-surface-1 p-3 transition hover:border-line-strong"
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-content-2">{item.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2 text-[13px] font-semibold text-content-1">
                      {item.title}
                      <ArrowUpRight className="h-3.5 w-3.5 text-content-4 group-hover:text-content-1" />
                    </span>
                    <span className="mt-0.5 block text-[12px] text-content-3">{item.copy}</span>
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** One order in the yard: header, its lines (queue) or its units (in progress), details and links. */
export function YardOrderCard({
  row,
  summary,
  mode,
  picked,
  heldBatches,
  expanded,
  onToggleExpand,
  onTogglePick,
  onToggleAll,
  onPack,
  onReadySlip,
  onShowProgress,
  onMoveToStock,
  route,
  status,
}: {
  route: string;
  status: string;
  row: BoardRow;
  summary?: SOPackingSummary;
  mode: YardMode;
  picked: Set<string>;
  heldBatches: PackingCheckSummary[];
  expanded: boolean;
  onToggleExpand: () => void;
  onTogglePick: (uid: string) => void;
  onToggleAll: (uids: string[], on: boolean) => void;
  onPack: (uids: string[]) => void;
  onReadySlip: () => void;
  onShowProgress: () => void;
  onMoveToStock?: (line: PackLine) => void;
}) {
  const order = row.sales_order;
  const lines = React.useMemo(() => packLinesOf(summary), [summary]);
  const readyLines = lines.filter(lineHasWork);
  const readyUids = readyLines.map((line) => line.uid);
  const allPicked = readyUids.length > 0 && readyUids.every((uid) => picked.has(uid));
  const anyPicked = readyUids.some((uid) => picked.has(uid));
  const released = Number(row.ready_for_dispatch?.gonnies_count || 0) + Number(row.ready_for_dispatch?.rolls_count || 0);
  const pending =
    Number(row.pending?.batches_count || 0) +
    Number(row.pending?.open_gonnies_count || 0) +
    Number(row.pending?.sealed_gonnies_count || 0) +
    Number(row.pending?.rolls_count || 0);
  const total = released + pending;
  const pct = total ? Math.round((released / total) * 100) : 0;
  const isPouch =
    Number(row.pending?.batches_count || 0) +
      Number(row.pending?.open_gonnies_count || 0) +
      Number(row.pending?.sealed_gonnies_count || 0) +
      Number(row.ready_for_dispatch?.gonnies_count || 0) >
    0;
  const held = heldBatches.filter((check) => check.sales_order_id === order.id);
  return (
    <article
      data-testid="packing-order-card"
      data-order-id={order.id}
      data-route={route}
      data-status={status}
      data-customer={order.customer_name}
      className={cn(
        "overflow-hidden rounded-[16px] border bg-surface-1 shadow-[var(--shadow-sm)]",
        anyPicked ? "border-primary/50" : held.length ? "border-warning-border" : "border-line",
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3.5 py-2.5 sm:px-4">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {order.job_name ? (
            <span className="inline-flex min-w-0 items-center gap-1.5" title={`Job name: ${order.job_name}`}>
              <span className="rounded bg-order-bg px-1 py-px text-[9.5px] font-bold uppercase tracking-[0.08em] text-order-fg ring-1 ring-order-border">
                Job
              </span>
              <span className="truncate text-[16px] font-bold tracking-[-0.01em] text-content-1" data-testid="packing-order-job">
                {order.job_name}
              </span>
            </span>
          ) : null}
          <Link href={`/sales/orders/${order.id}`} className="font-mono text-[12.5px] font-semibold text-content-2 hover:underline">
            {order.order_number}
          </Link>
          <span className="text-content-4">·</span>
          <span className="truncate text-[12.5px] font-medium text-content-2">{order.customer_name}</span>
          <Pill tone={isPouch ? "warn" : "info"}>{isPouch ? "Pouch → gonny" : "Roll · pack / release"}</Pill>
          <Pill tone="neutral">{titleCase(order.status)}</Pill>
          {held.length ? (
            <Pill tone="warn">
              <ShieldAlert className="mr-1 inline h-3 w-3" aria-hidden />
              Held at check
            </Pill>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 text-[12px] text-content-3" title={`${released} of ${total} yard units released`}>
            <span className="h-1.5 w-[72px] overflow-hidden rounded-full bg-surface-2">
              <span className={cn("block h-full rounded-full", pct >= 100 ? "bg-success-fg" : "bg-primary")} style={{ width: `${pct}%` }} />
            </span>
            <b className="tabular-nums text-content-1">
              {released}/{total}
            </b>
            released
          </span>
          {mode === "queue" && readyUids.length > 1 ? (
            <label className="flex min-h-[32px] cursor-pointer items-center gap-1.5 rounded-lg border border-line px-2 text-[12px] font-medium text-content-2">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[hsl(var(--primary))]"
                checked={allPicked}
                onChange={() => onToggleAll(readyUids, !allPicked)}
                data-testid="packing-order-select-all"
              />
              All {readyUids.length} ready lines
            </label>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8"
            data-testid="packing-ready-slip"
            disabled={!released}
            title={released ? "Print the material ready slip" : "No released units yet"}
            onClick={onReadySlip}
          >
            <FileText className="mr-1 h-3.5 w-3.5" aria-hidden /> Ready slip
          </Button>
          <button
            type="button"
            aria-expanded={expanded}
            data-testid="packing-order-details-toggle"
            onClick={onToggleExpand}
            className="flex min-h-[32px] items-center gap-1 rounded-lg px-2 text-[12px] font-semibold text-content-2 hover:bg-surface-2"
          >
            Details <ChevronDown className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} aria-hidden />
          </button>
        </div>
      </header>

      {!summary ? (
        <div className="border-t border-line px-4 py-3">
          <div className="erp-skeleton h-[64px] rounded-xl" />
        </div>
      ) : mode === "queue" ? (
        readyLines.length ? (
          readyLines.map((line) => (
            <LineRow
              key={line.uid}
              line={line}
              picked={picked.has(line.uid)}
              onTogglePick={() => onTogglePick(line.uid)}
              onPack={() => onPack(picked.has(line.uid) && picked.size > 1 ? Array.from(picked) : [line.uid])}
              onShowProgress={onShowProgress}
              onMoveToStock={line.closed && onMoveToStock ? () => onMoveToStock(line) : undefined}
            />
          ))
        ) : (
          <div className="flex items-center gap-2 border-t border-line px-4 py-3 text-[12.5px] text-content-3">
            <Check className="h-4 w-4 text-success-fg" aria-hidden /> Nothing new to pack. Open and sealed gonnies are under In progress.
          </div>
        )
      ) : (
        lines.map((line) => <ProgressLine key={line.uid} line={line} onOpen={() => onPack([line.uid])} />)
      )}

      {expanded && summary ? <OrderDetails summary={summary} lines={lines} /> : null}

      <footer className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line bg-surface-2/50 px-3.5 py-2 text-[11.5px] text-content-3 sm:px-4">
        <Truck className="h-3.5 w-3.5" aria-hidden />
        <span>
          Each line releases as its own dispatch unit(s) and gets <b className="text-content-2">its own dispatch slip</b> in Dispatch Bay.
        </span>
        <span className="ml-auto flex flex-wrap gap-3">
          <Link href={`/logistics/packing/audit?sales_order_id=${order.id}`} data-testid="packing-audit-this-order" className="hover:text-content-1 hover:underline">
            Audit this order
          </Link>
          <Link href={`/dashboard/planner/control-tower/completed-trace?search=${encodeURIComponent(order.order_number)}`} className="hover:text-content-1 hover:underline">
            Completed trace
          </Link>
          <Link href={`/dashboard/planner/control-tower/plan-queue?search=${encodeURIComponent(order.order_number)}`} className="hover:text-content-1 hover:underline">
            Plan queue
          </Link>
          <Link href="/logistics/dispatch" className="hover:text-content-1 hover:underline">
            Dispatch Bay
          </Link>
        </span>
      </footer>
    </article>
  );
}

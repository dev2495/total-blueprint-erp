"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CircleCheck, Copy, FileText, Info, Lock, MapPin, Phone, Plus, Printer, Truck, User, X } from "lucide-react";

import { PrintGateQrLabelButton } from "@/components/gate/print-qr-label-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { JobNameTag } from "@/components/spine/job-name-tag";
import { cn } from "@/lib/utils";
import { Pill, clean, kgText as kg, num as n } from "@/components/logistics/yard-ui";
import { logisticsService } from "@/services/logistics";
import { gonniesText, rollsText, unitsText, type BayUnit } from "./dispatch-board";

export type TrayOrder = {
  id: string;
  orderNumber: string;
  jobName: string;
  customer: string;
  deliveryTo: string;
  address: string;
  location: string;
};

export type TrayLine = { lineNo: number; name: string; size: string };

export type CreatedSlip = {
  id: string;
  dc_no: string;
  status: string;
  sales_order_id: string;
  so_number: string;
  sales_order_item_id: string;
  items_count: number;
  vehicle_no: string;
};

export type Transport = {
  transporter: string;
  vehicle: string;
  driver: string;
  phone: string;
  lr: string;
  eway: string;
  note: string;
};

export const EMPTY_TRANSPORT: Transport = { transporter: "", vehicle: "", driver: "", phone: "", lr: "", eway: "", note: "" };
const QUICK_TRANSPORT = ["Own vehicle", "Customer pickup", "Courier"];

/** One slip per order line (and per plant when a line sits at two plants). */
export function traySlips(units: BayUnit[]) {
  const slips = new Map<string, { key: string; orderId: string; lineId: string; plantName: string; units: BayUnit[] }>();
  units.forEach((unit) => {
    const key = `${unit.orderId}|${unit.lineId}|${unit.plantName}`;
    const slip = slips.get(key) || { key, orderId: unit.orderId, lineId: unit.lineId, plantName: unit.plantName, units: [] };
    slip.units.push(unit);
    slips.set(key, slip);
  });
  return Array.from(slips.values());
}

type Stage = "pick" | "created" | "closed";

function Steps({ stage, printed }: { stage: Stage; printed: boolean }) {
  const items: Array<[string, boolean, boolean]> = [
    ["Load", stage === "pick", stage !== "pick"],
    ["Slips", stage === "created", stage !== "pick"],
    ["Print", stage === "created" && !printed, printed || stage === "closed"],
    ["Close", false, stage === "closed"],
  ];
  return (
    <ol className="flex items-center gap-1.5 text-[11.5px]" aria-label="Load progress">
      {items.map(([label, on, done], index) => (
        <li key={label} className="flex items-center gap-1.5">
          <span
            className={cn(
              "inline-flex items-center gap-1 font-semibold",
              done ? "text-success-fg" : on ? "text-primary" : "text-content-4",
            )}
          >
            <span className={cn("h-1.5 w-1.5 rounded-full", done ? "bg-success-fg" : on ? "bg-primary" : "bg-content-4")} aria-hidden />
            {label}
          </span>
          {index < items.length - 1 ? <span className="h-px w-4 bg-line" aria-hidden /> : null}
        </li>
      ))}
    </ol>
  );
}

/** The loading tray: transport (vehicle optional), what is loaded line by line, then create, print and close. */
export function DispatchTray({
  units,
  orders,
  lines,
  stage,
  transport,
  setTransport,
  locations,
  setLocation,
  recentTransporters,
  created,
  printed,
  dispatched,
  creating,
  dispatching,
  printingAll,
  onCreate,
  onClearTray,
  onPrintAll,
  onDispatchAll,
  onNextLoad,
  onRemoveUnits,
  onShowHistory,
  shipClosed,
  setShipClosed,
}: {
  units: BayUnit[];
  orders: Record<string, TrayOrder>;
  lines: Record<string, TrayLine>;
  stage: Stage;
  transport: Transport;
  setTransport: (patch: Partial<Transport>) => void;
  locations: Record<string, string>;
  setLocation: (orderId: string, value: string) => void;
  recentTransporters: string[];
  created: CreatedSlip[];
  printed: Record<string, number>;
  dispatched: Record<string, boolean>;
  creating: boolean;
  dispatching: boolean;
  printingAll: boolean;
  onCreate: () => void;
  onClearTray: () => void;
  onPrintAll: () => void;
  onDispatchAll: () => void;
  onNextLoad: () => void;
  onRemoveUnits: (units: BayUnit[]) => void;
  onShowHistory?: () => void;
  /** Goods of closed lines/orders are on the tray and the dispatcher confirmed sending them. */
  shipClosed: boolean;
  setShipClosed: (value: boolean) => void;
}) {
  const slips = traySlips(units);
  const orderIds = Array.from(new Set(units.map((unit) => unit.orderId)));
  const lineCount = new Set(slips.map((slip) => `${slip.orderId}|${slip.lineId}`)).size;
  const splitByPlant = slips.length - lineCount;
  const gross = units.reduce((sum, unit) => sum + unit.gross, 0);
  const net = units.reduce((sum, unit) => sum + unit.net, 0);
  const pcs = units.reduce((sum, unit) => sum + unit.pcs, 0);
  const missingLocation = orderIds.filter((id) => !clean(locations[id]));
  const closedLines = Array.from(
    new Set(
      units
        .filter((unit) => unit.closed)
        .map((unit) => `${orders[unit.orderId]?.orderNumber || "Order"}${lines[unit.lineId] ? ` L${lines[unit.lineId].lineNo}` : ""}`),
    ),
  );
  const errors = [
    !units.length ? "Load at least one line." : "",
    units.length && !clean(transport.transporter) ? "Transporter name is required (printed as TRANSPORT NAME)." : "",
    ...missingLocation.map((id) => `Delivery location missing for ${orders[id]?.orderNumber || "an order"}: enter where it goes.`),
    closedLines.length && !shipClosed ? "Confirm sending the goods of the closed lines (box above), or take them off the tray." : "",
  ].filter(Boolean);
  const disabledFields = stage !== "pick";
  const allPrinted = created.length > 0 && created.every((slip) => printed[slip.id]);
  const allDispatched = created.length > 0 && created.every((slip) => dispatched[slip.id]);
  const printedCount = created.filter((slip) => printed[slip.id]).length;
  const moreFilled = Boolean(transport.lr || transport.eway || transport.note);

  return (
    <section
      className="flex flex-col overflow-hidden rounded-[16px] border border-line bg-surface-1 shadow-[var(--shadow-sm)] xl:sticky xl:top-[88px] xl:max-h-[calc(100dvh-104px)]"
      data-testid="dispatch-tray"
    >
      <header className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <Truck className="h-4 w-4 text-primary" aria-hidden />
        <h2 className="text-[15px] font-semibold text-content-1">Loading tray</h2>
        <span className="text-[12px] text-content-3">
          {stage === "pick" ? "Loading" : stage === "created" ? "Slips created · print & close" : "Closed"}
        </span>
        {transport.vehicle ? (
          <span className="ml-auto rounded-full border border-info-border bg-info-bg px-2 py-0.5 font-mono text-[11.5px] font-semibold text-info-fg">
            {transport.vehicle}
          </span>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3.5">
        {stage !== "closed" ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[12px] font-semibold text-content-2">
              <span className="inline-flex items-center gap-1.5">
                <Truck className="h-3.5 w-3.5" aria-hidden /> Transport
              </span>
              <span className="font-normal text-content-3">prints on every slip</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="dispatch-vehicle" className="text-[11.5px]">
                  Vehicle no. <span className="font-normal text-content-4">optional</span>
                </Label>
                <Input
                  id="dispatch-vehicle"
                  data-testid="dispatch-vehicle"
                  value={transport.vehicle}
                  disabled={disabledFields}
                  onChange={(event) => setTransport({ vehicle: event.target.value.toUpperCase() })}
                  placeholder="MH-XX-AB-XXXX"
                  maxLength={50}
                  className="h-9 font-mono"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="dispatch-transporter" className="text-[11.5px]">
                  Transporter <span className="text-danger-fg">*</span>
                </Label>
                <Input
                  id="dispatch-transporter"
                  data-testid="dispatch-transporter"
                  value={transport.transporter}
                  disabled={disabledFields}
                  onChange={(event) => setTransport({ transporter: event.target.value })}
                  placeholder="Transporter or company vehicle"
                  maxLength={160}
                  autoComplete="organization"
                  className={cn("h-9", units.length && !clean(transport.transporter) && "border-danger-border")}
                />
              </div>
            </div>
            {stage === "pick" ? (
              <div className="-mx-0.5 flex gap-1 overflow-x-auto px-0.5 pb-0.5 [scrollbar-width:thin]" aria-label="Quick transporter">
                {Array.from(new Set([...QUICK_TRANSPORT, ...recentTransporters])).slice(0, 6).map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => setTransport({ transporter: name })}
                    className={cn(
                      "min-h-[28px] shrink-0 whitespace-nowrap rounded-full border px-2.5 text-[11.5px] font-medium transition-colors",
                      clean(transport.transporter) === name
                        ? "border-primary bg-info-bg text-content-1"
                        : "border-line bg-surface-2 text-content-2 hover:border-line-strong",
                    )}
                  >
                    {name}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="dispatch-driver" className="text-[11.5px]">
                  Driver
                </Label>
                <div className="relative">
                  <User className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-content-4" aria-hidden />
                  <Input
                    id="dispatch-driver"
                    value={transport.driver}
                    disabled={disabledFields}
                    onChange={(event) => setTransport({ driver: event.target.value })}
                    placeholder="Driver name"
                    maxLength={100}
                    className="h-9 pl-8"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="dispatch-phone" className="text-[11.5px]">
                  Driver phone
                </Label>
                <div className="relative">
                  <Phone className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-content-4" aria-hidden />
                  <Input
                    id="dispatch-phone"
                    value={transport.phone}
                    inputMode="tel"
                    disabled={disabledFields}
                    onChange={(event) => setTransport({ phone: event.target.value })}
                    placeholder="98xxx xxxxx"
                    maxLength={20}
                    className="h-9 pl-8 font-mono"
                  />
                </div>
              </div>
            </div>
            <details className="group" open={moreFilled || undefined}>
              <summary className="inline-flex cursor-pointer list-none items-center gap-1 text-[12px] font-semibold text-content-3 hover:text-content-1">
                <Plus className="h-3.5 w-3.5 transition-transform group-open:rotate-45" aria-hidden /> LR no., e-way bill, internal note
              </summary>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="dispatch-lr" className="text-[11.5px]">
                    LR no.
                  </Label>
                  <Input id="dispatch-lr" value={transport.lr} disabled={disabledFields} onChange={(event) => setTransport({ lr: event.target.value })} maxLength={80} className="h-9 font-mono" placeholder="Optional" />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="dispatch-eway" className="text-[11.5px]">
                    E-way bill
                  </Label>
                  <Input id="dispatch-eway" value={transport.eway} disabled={disabledFields} onChange={(event) => setTransport({ eway: event.target.value })} maxLength={80} className="h-9 font-mono" placeholder="Optional" />
                </div>
                <div className="col-span-2 space-y-1">
                  <Label htmlFor="dispatch-notes" className="text-[11.5px]">
                    Internal note <span className="font-normal text-content-4">not printed on the slip</span>
                  </Label>
                  <Textarea
                    id="dispatch-notes"
                    value={transport.note}
                    disabled={disabledFields}
                    onChange={(event) => setTransport({ note: event.target.value })}
                    placeholder="Loading instruction or receiver context"
                    className="min-h-[56px]"
                  />
                </div>
              </div>
            </details>
          </div>
        ) : null}

        {stage !== "closed" ? (
          !slips.length ? (
            <div className="rounded-xl border border-dashed border-line bg-surface-2/40 px-3 py-4 text-center text-[12.5px] text-content-3">
              <b className="block text-content-2">Nothing loaded yet</b>
              Tick a line on the left to load every ready unit, or open <em>Units</em> for a part load. Lines from several orders can go
              together: each line still gets its own slip.
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[12px] font-semibold text-content-2">
                <span>Loading</span>
                <span className="font-normal text-content-3">
                  {lineCount} line{lineCount === 1 ? "" : "s"} · {orderIds.length} order{orderIds.length === 1 ? "" : "s"}
                </span>
              </div>
              {orderIds.map((orderId) => {
                const order = orders[orderId];
                const orderSlips = slips.filter((slip) => slip.orderId === orderId);
                const location = locations[orderId] || "";
                const overridden = clean(location) && clean(location).toLowerCase() !== clean(order?.location).toLowerCase();
                return (
                  <div key={orderId} className="rounded-xl border border-line bg-surface-2/40 p-2.5" data-testid="dispatch-tray-order">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-[12px] font-semibold text-content-1">{order?.orderNumber}</span>
                      <JobNameTag name={order?.jobName} />
                      <span className="ml-auto truncate text-[11px] text-content-3">{order?.customer}</span>
                    </div>
                    <ul className="mt-1.5 space-y-1.5">
                      {orderSlips.map((slip) => {
                        const line = lines[slip.lineId];
                        const kind = slip.units[0]?.kind === "ROLL" ? rollsText(slip.units.length) : gonniesText(slip.units.length);
                        const slipIndex = slips.indexOf(slip) + 1;
                        return (
                          <li key={slip.key} className="flex items-start gap-2 rounded-lg bg-surface-1 px-2 py-1.5">
                            <span className="mt-0.5 grid h-5 min-w-5 place-items-center rounded bg-content-1 px-1 font-mono text-[10.5px] font-bold text-surface-1" title={`Slip ${slipIndex}`}>
                              {slipIndex}
                            </span>
                            <div className="min-w-0 flex-1 text-[12px]">
                              <div className="truncate font-semibold text-content-1">
                                {line ? `L${line.lineNo} · ${line.name}` : "Order line"}{" "}
                                <span className="font-normal text-content-3">{line?.size}</span>
                              </div>
                              <div className="text-[11.5px] tabular-nums text-content-3">
                                <b className="text-content-2">{kind}</b>
                                {slip.units.some((unit) => unit.pcs) ? ` · ${n(slip.units.reduce((s, u) => s + u.pcs, 0), 0)} pcs` : ""} ·{" "}
                                {kg(slip.units.reduce((s, u) => s + u.net, 0))} net · <b className="text-content-2">{kg(slip.units.reduce((s, u) => s + u.gross, 0))}</b> gross
                                {orderSlips.filter((other) => other.lineId === slip.lineId).length > 1 ? ` · ${slip.plantName}` : ""}
                              </div>
                            </div>
                            {stage === "pick" ? (
                              <button
                                type="button"
                                aria-label="Take this line off the tray"
                                onClick={() => onRemoveUnits(slip.units)}
                                className="grid h-7 w-7 place-items-center rounded-md text-content-4 hover:bg-surface-2 hover:text-content-1"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                    <div className="mt-2 space-y-1">
                      <div className="flex items-center gap-1 text-[11.5px] text-content-3">
                        <MapPin className="h-3 w-3" aria-hidden />
                        <span className="truncate">
                          {order?.deliveryTo || order?.customer}
                          {order?.address ? ` · ${order.address}` : ""}
                        </span>
                      </div>
                      <Label htmlFor={`dispatch-location-${orderId}`} className="flex items-center gap-1.5 text-[11.5px]">
                        Delivery location <span className="text-danger-fg">*</span>
                        <Pill tone={overridden ? "warn" : "info"}>{overridden ? "Override for these slips" : order?.address ? "From address" : "Dispatch-only"}</Pill>
                      </Label>
                      <Input
                        id={`dispatch-location-${orderId}`}
                        data-testid={`dispatch-location-${orderId}`}
                        value={location}
                        disabled={disabledFields}
                        onChange={(event) => setLocation(orderId, event.target.value)}
                        placeholder="City, destination or delivery address"
                        maxLength={240}
                        className={cn("h-9", !clean(location) && "border-danger-border")}
                      />
                    </div>
                  </div>
                );
              })}
              <div className="rounded-xl bg-content-1 px-3.5 py-3 text-surface-1">
                <div className="flex items-baseline gap-2 text-[18px] font-bold">
                  <span>
                    {lineCount} line{lineCount === 1 ? "" : "s"}
                  </span>
                  <span className="text-[14px] opacity-70">→</span>
                  <span>
                    {slips.length} slip{slips.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 text-[12px] tabular-nums opacity-85">
                  <span>{unitsText(units.length)}</span>
                  <span>{kg(gross)} gross</span>
                  <span>{kg(net)} net</span>
                  {pcs ? <span>{n(pcs, 0)} pcs</span> : null}
                  {splitByPlant ? <span>{splitByPlant} line split by plant</span> : null}
                </div>
                <div className="mt-1.5 flex items-start gap-1.5 text-[11.5px] opacity-80">
                  <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
                  One slip per order line, never mixed. Several lines and orders can go together; vehicle no. is optional.
                </div>
              </div>
            </div>
          )
        ) : null}
      </div>

      <footer className="space-y-2 border-t border-line bg-surface-1 p-3.5">
        {closedLines.length && stage !== "closed" ? (
          <label
            className={cn(
              "flex cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 text-[12.5px]",
              shipClosed ? "border-success-border bg-success-bg" : "border-warning-border bg-warning-bg",
            )}
            data-testid="dispatch-closed-lines-box"
          >
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4"
              checked={shipClosed}
              disabled={stage !== "pick"}
              onChange={(event) => setShipClosed(event.target.checked)}
              data-testid="dispatch-ship-closed-ack"
            />
            <span className="min-w-0">
              <b className="inline-flex items-center gap-1 text-content-1">
                <Lock className="h-3.5 w-3.5" aria-hidden /> Send goods of closed lines
              </b>
              <span className="block text-content-2">
                {closedLines.join(", ")} {closedLines.length === 1 ? "is" : "are"} closed. These goods were already made; tick to
                send them to the customer. The order stays as it is.
              </span>
            </span>
          </label>
        ) : null}
        {stage !== "closed" && (slips.length || created.length) ? <Steps stage={stage} printed={allPrinted} /> : null}
        {stage === "pick" ? (
          <>
            {errors.length && units.length ? (
              <p className="flex items-start gap-1.5 text-[12px] font-medium text-danger-fg">
                <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden /> {errors[0]}
              </p>
            ) : slips.length ? (
              <p className="flex items-start gap-1.5 text-[12px] font-medium text-success-fg">
                <CircleCheck className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden /> Ready to create {slips.length} slip
                {slips.length === 1 ? "" : "s"}
                {!clean(transport.vehicle) ? " · no vehicle no. (optional)" : ""}
              </p>
            ) : null}
            <div className="flex gap-2">
              <Button
                type="button"
                className="h-11 flex-1"
                data-testid="dispatch-create-submit"
                disabled={Boolean(errors.length) || creating}
                onClick={onCreate}
              >
                <FileText className="mr-1.5 h-4 w-4" aria-hidden />
                {creating ? "Creating…" : `Create ${slips.length ? `${slips.length} slip${slips.length === 1 ? "" : "s"}` : "slips"}`}
              </Button>
              {units.length ? (
                <Button type="button" variant="outline" className="h-11" aria-label="Unload everything" data-testid="dispatch-tray-clear" onClick={onClearTray}>
                  <X className="h-4 w-4" />
                </Button>
              ) : null}
            </div>
          </>
        ) : stage === "created" ? (
          <>
            <p className={cn("flex items-start gap-1.5 text-[12px] font-medium", allPrinted ? "text-success-fg" : "text-warning-fg")}>
              <Printer className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
              {allPrinted
                ? `All ${created.length} slips printed. Mark them dispatched when the load leaves the gate.`
                : `${printedCount} of ${created.length} printed. Print before the load leaves.`}
            </p>
            <div className="flex gap-2">
              {!allPrinted ? (
                <Button type="button" className="h-11 flex-1" data-testid="dispatch-slips-print-all" disabled={printingAll} onClick={onPrintAll}>
                  <Printer className="mr-1.5 h-4 w-4" aria-hidden />
                  {printingAll ? "Sending to Epson…" : `Print ${created.length - printedCount} slip${created.length - printedCount === 1 ? "" : "s"}`}
                </Button>
              ) : null}
              <Button
                type="button"
                variant={allPrinted ? "default" : "outline"}
                className="h-11 flex-1"
                data-testid="dispatch-mark-dispatched"
                disabled={dispatching || allDispatched}
                onClick={onDispatchAll}
              >
                <Truck className="mr-1.5 h-4 w-4" aria-hidden />
                {dispatching ? "Marking…" : allPrinted ? "Mark dispatched · close" : "Mark dispatched anyway"}
              </Button>
            </div>
          </>
        ) : (
          <div className="space-y-2">
            <p className="flex items-start gap-1.5 text-[13px] font-semibold text-success-fg">
              <CircleCheck className="mt-px h-4 w-4 shrink-0" aria-hidden />
              {transport.vehicle || "Load"} dispatched · {created.length} slip{created.length === 1 ? "" : "s"}
            </p>
            <p className="text-[12px] text-content-3">Reprint, proof of delivery and every older slip are in History.</p>
            <div className="flex gap-2">
              <Button type="button" className="h-10 flex-1" data-testid="dispatch-next-load" onClick={onNextLoad}>
                <Plus className="mr-1.5 h-4 w-4" aria-hidden /> Next load
              </Button>
              {onShowHistory ? (
                <Button type="button" variant="outline" className="h-10" onClick={onShowHistory} data-testid="dispatch-open-history">
                  History
                </Button>
              ) : null}
            </div>
          </div>
        )}
      </footer>
    </section>
  );
}

/** The slips of this load: one tab each, the exact text the Epson prints, and its actions. */
export function SlipsSection({
  created,
  orders,
  lines,
  printed,
  dispatched,
  onPrint,
  transport,
}: {
  created: CreatedSlip[];
  orders: Record<string, TrayOrder>;
  lines: Record<string, TrayLine>;
  printed: Record<string, number>;
  dispatched: Record<string, boolean>;
  onPrint: (slip: CreatedSlip) => void;
  transport: Transport;
}) {
  const [active, setActive] = React.useState(0);
  const slip = created[Math.min(active, created.length - 1)];
  const text = useQuery({
    queryKey: ["dispatch-slip-text", slip?.id, dispatched[slip?.id || ""] ? "d" : "o"],
    queryFn: async () => {
      const response = await fetch(logisticsService.getChallanPrintUrl(slip!.id, "txt"), { credentials: "include" });
      if (!response.ok) throw new Error(`Slip text could not be loaded (${response.status}).`);
      return response.text();
    },
    enabled: Boolean(slip),
    staleTime: 60_000,
  });
  if (!slip) return null;
  const order = orders[slip.sales_order_id];
  const line = lines[slip.sales_order_item_id];
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text.data || "");
    } catch {
      /* clipboard refused; the text stays selectable on screen */
    }
  };
  return (
    <section className="overflow-hidden rounded-[16px] border border-line bg-surface-1 shadow-[var(--shadow-sm)]" data-testid="dispatch-slips">
      <header className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        <Printer className="h-4 w-4 text-content-3" aria-hidden />
        <h2 className="text-[15px] font-semibold text-content-1">Slips of this load</h2>
        <span className="text-[12px] text-content-3">
          {created.length} slip{created.length === 1 ? "" : "s"} · one per order line · exactly what the Epson prints
        </span>
      </header>
      <div className="flex gap-1 overflow-x-auto border-b border-line px-3 pt-2" role="tablist">
        {created.map((item, index) => {
          const itemLine = lines[item.sales_order_item_id];
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={index === active}
              onClick={() => setActive(index)}
              className={cn(
                "flex min-h-[40px] shrink-0 items-center gap-2 rounded-t-lg border border-b-0 px-3 text-left text-[12px]",
                index === active ? "border-line bg-surface-2 text-content-1" : "border-transparent text-content-3 hover:bg-surface-2/60",
              )}
            >
              <span
                className={cn("h-2 w-2 rounded-full", dispatched[item.id] ? "bg-info-fg" : printed[item.id] ? "bg-success-fg" : "bg-warning-fg")}
                aria-hidden
              />
              <span className="font-mono font-semibold">{item.dc_no.replace(/^DC-/, "")}</span>
              <span>
                L{itemLine?.lineNo ?? "?"} · {orders[item.sales_order_id]?.customer.split(" ").slice(0, 2).join(" ")}
              </span>
            </button>
          );
        })}
      </div>
      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">
          <div className="overflow-x-auto rounded-xl border border-line bg-surface-2 p-3">
            <pre
              className="mx-auto w-max min-w-full whitespace-pre font-mono text-[10.5px] leading-[1.35] text-content-1"
              aria-label={`Slip ${slip.dc_no} as printed`}
              data-testid="dispatch-slip-text"
            >
              {text.isLoading ? "Loading the slip…" : text.isError ? String((text.error as Error)?.message || "Slip text unavailable") : text.data}
            </pre>
          </div>
          <p className="mt-1.5 text-[11.5px] text-content-3">10 × 6 in form, 96 columns, printed in NLQ on the Epson FX-2175II.</p>
        </div>
        <div className="space-y-3 text-[12.5px]">
          <div className="rounded-xl border border-line p-3">
            <div className="text-[11px] text-content-3">Slip</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
              <span className="font-mono font-semibold text-content-1">{slip.dc_no}</span>
              <Pill tone={dispatched[slip.id] ? "info" : "warn"} dot>
                {dispatched[slip.id] ? "Dispatched" : "Draft"}
              </Pill>
              {printed[slip.id] ? <Pill tone="good">Printed{printed[slip.id] > 1 ? ` ${printed[slip.id]}×` : ""}</Pill> : <Pill tone="neutral">Not printed yet</Pill>}
            </div>
          </div>
          <div className="rounded-xl border border-line p-3">
            <div className="text-[11px] text-content-3">Contents</div>
            <dl className="mt-1 grid grid-cols-[88px_minmax(0,1fr)] gap-x-2 gap-y-1">
              <dt className="text-content-3">Order</dt>
              <dd className="flex flex-wrap items-center gap-1">
                <span className="font-mono font-semibold">{slip.so_number}</span>
                <JobNameTag name={order?.jobName} />
              </dd>
              <dt className="text-content-3">Line</dt>
              <dd>{line ? `L${line.lineNo} · ${line.name}` : "—"}</dd>
              <dt className="text-content-3">Units</dt>
              <dd>{unitsText(slip.items_count)}</dd>
              <dt className="text-content-3">Deliver to</dt>
              <dd>{order?.deliveryTo || order?.customer}</dd>
              <dt className="text-content-3">Transporter</dt>
              <dd>{transport.transporter || "—"}</dd>
              <dt className="text-content-3">Vehicle</dt>
              <dd className="font-mono">{slip.vehicle_no || "—"}</dd>
            </dl>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button type="button" size="sm" data-testid={`dispatch-slip-print-${slip.id}`} onClick={() => onPrint(slip)}>
              <Printer className="mr-1 h-3.5 w-3.5" aria-hidden /> {printed[slip.id] ? "Reprint" : "Print this slip"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-testid={`dispatch-slip-pdf-${slip.id}`}
              onClick={() => window.open(logisticsService.getChallanPrintUrl(slip.id, "pdf"), "_blank", "noopener,noreferrer")}
            >
              <FileText className="mr-1 h-3.5 w-3.5" aria-hidden /> A4 PDF
            </Button>
            <PrintGateQrLabelButton kind="SALES_DC" id={slip.id} reference={slip.dc_no} showHint={false} />
            <Button type="button" size="sm" variant="outline" disabled={!text.data} onClick={() => void copy()}>
              <Copy className="mr-1 h-3.5 w-3.5" aria-hidden /> Copy text
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

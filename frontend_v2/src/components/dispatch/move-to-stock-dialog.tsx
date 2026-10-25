"use client";

import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { Archive, Check, Package, Warehouse } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { apiError as err, kgText as kg, num as n } from "@/components/logistics/yard-ui";
import { logisticsService } from "@/services/logistics";

/** A made unit of a closed line that can leave the order for free stock. */
export type StockMoveUnit = {
  id: string;
  kind: "ROLL" | "CTN" | "BATCH";
  label: string;
  /** Net kg (rolls, gonnies) or kg of the batch remainder. */
  kg: number;
  pcs?: number;
  note?: string;
};

const REASONS = ["Customer short-closed the order", "Order cancelled", "Excess over the order", "Customer will not take it"];

/**
 * Moves goods of a closed line to free stock. They leave the order (and Dispatch Bay) and the
 * planner can claim them for any order with the same specification.
 */
export function MoveToStockDialog({
  open,
  onOpenChange,
  orderNumber,
  lineNo,
  lineName,
  closedLabel,
  units,
  onMoved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderNumber: string;
  lineNo?: number | null;
  lineName?: string;
  /** e.g. "Short-closed" or "Order completed". */
  closedLabel: string;
  units: StockMoveUnit[];
  onMoved?: () => void;
}) {
  const { toast } = useToast();
  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const [reason, setReason] = React.useState("");
  React.useEffect(() => {
    if (open) {
      setPicked(new Set(units.map((unit) => unit.id)));
      setReason("");
    }
  }, [open, units]);
  const chosen = units.filter((unit) => picked.has(unit.id));
  const totalKg = chosen.reduce((sum, unit) => sum + unit.kg, 0);
  const totalPcs = chosen.reduce((sum, unit) => sum + Number(unit.pcs || 0), 0);
  const mutation = useMutation({
    mutationFn: () =>
      logisticsService.moveToStock({
        roll_ids: chosen.filter((unit) => unit.kind === "ROLL").map((unit) => unit.id),
        gonny_ids: chosen.filter((unit) => unit.kind === "CTN").map((unit) => unit.id),
        batch_ids: chosen.filter((unit) => unit.kind === "BATCH").map((unit) => unit.id),
        reason: reason.trim(),
      }),
    onSuccess: (data) => {
      toast({ title: "Moved to stock", description: data.message });
      onOpenChange(false);
      onMoved?.();
    },
    onError: (error) => toast({ title: "Not moved", description: err(error), variant: "destructive" }),
  });
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const kindLabel = (kind: StockMoveUnit["kind"]) => (kind === "ROLL" ? "Roll" : kind === "CTN" ? "Gonny" : "Unpacked batch");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl" data-testid="move-to-stock-dialog">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Warehouse className="h-5 w-5 text-primary" aria-hidden /> Move to free stock
          </DialogTitle>
          <DialogDescription>
            {orderNumber}
            {lineNo ? ` · L${lineNo}` : ""}
            {lineName ? ` · ${lineName}` : ""} · <b className="text-warning-fg">{closedLabel}</b>
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <p className="rounded-xl border border-info-border bg-info-bg px-3 py-2 text-[12.5px] text-content-2">
            These goods leave <b>{orderNumber}</b> and Dispatch Bay. The planner can then give them to any order with the
            same specification (Planner → use finished stock). To send them to this customer instead, close this and load
            the line on the tray.
          </p>

          <div className="max-h-[38vh] overflow-y-auto rounded-xl border border-line">
            <div className="flex items-center justify-between border-b border-line bg-surface-2 px-3 py-1.5 text-[11.5px] text-content-3">
              <label className="inline-flex items-center gap-2 font-semibold text-content-2">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={units.length > 0 && chosen.length === units.length}
                  onChange={() => setPicked(chosen.length === units.length ? new Set() : new Set(units.map((unit) => unit.id)))}
                  aria-label="Pick every unit"
                />
                {chosen.length} of {units.length} picked
              </label>
              <span className="tabular-nums">
                {kg(totalKg)}
                {totalPcs ? ` · ${n(totalPcs, 0)} pcs` : ""}
              </span>
            </div>
            <ul className="divide-y divide-line">
              {units.map((unit) => (
                <li key={unit.id}>
                  <label
                    className={cn(
                      "flex cursor-pointer items-center gap-3 px-3 py-2 text-[12.5px]",
                      picked.has(unit.id) ? "bg-surface-1" : "bg-surface-2 text-content-3",
                    )}
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={picked.has(unit.id)}
                      onChange={() => toggle(unit.id)}
                      data-testid={`move-to-stock-unit-${unit.id}`}
                    />
                    {unit.kind === "BATCH" ? <Package className="h-4 w-4 text-content-3" aria-hidden /> : <Archive className="h-4 w-4 text-content-3" aria-hidden />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono font-semibold text-content-1">{unit.label}</span>
                      <span className="block text-[11px] text-content-3">
                        {kindLabel(unit.kind)}
                        {unit.note ? ` · ${unit.note}` : ""}
                      </span>
                    </span>
                    <span className="text-right tabular-nums text-content-2">
                      {kg(unit.kg)}
                      {unit.pcs ? <span className="block text-[11px] text-content-3">{n(unit.pcs, 0)} pcs</span> : null}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="move-to-stock-reason">Why do they go to stock?</Label>
            <div className="flex flex-wrap gap-1">
              {REASONS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setReason(preset)}
                  className={cn(
                    "min-h-[28px] rounded-full border px-2.5 text-[11.5px] font-medium transition-colors",
                    reason === preset ? "border-primary bg-info-bg text-content-1" : "border-line bg-surface-2 text-content-2 hover:border-line-strong",
                  )}
                >
                  {reason === preset ? <Check className="mr-1 inline h-3 w-3" aria-hidden /> : null}
                  {preset}
                </button>
              ))}
            </div>
            <Textarea
              id="move-to-stock-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Reason, kept with every unit"
              className="min-h-[60px]"
              data-testid="move-to-stock-reason"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Keep on the order
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!chosen.length || reason.trim().length < 3 || mutation.isPending}
            data-testid="move-to-stock-submit"
          >
            <Warehouse className="mr-1.5 h-4 w-4" aria-hidden />
            {mutation.isPending ? "Moving…" : `Move ${chosen.length} to stock`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

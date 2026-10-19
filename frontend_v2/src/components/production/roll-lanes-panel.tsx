"use client";

/**
 * Roll lanes: what is loaded on each unwinder of a roll-fed step.
 *
 * A plain roll step has one lane; lamination has one lane per layer. Each lane shows how
 * many kilos its loaded rolls still hold against what the step still needs, and the rolls
 * in the order they will run (running roll first). Part-used rolls keep their label and
 * leave the job only through "Return balance" (back to stock) or "Roll finished".
 */
import { useMemo, useState } from "react";
import { ArrowDownToLine, CheckCircle2, CircleDot, Layers, Trash2, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type RollLaneRoll = {
  id: string;
  reservation_id?: string;
  label_id: string;
  material_name?: string | null;
  width_mm?: number | null;
  thickness_micron?: number | null;
  weight_kg: number;
  original_weight_kg?: number | null;
  status?: string;
  started?: boolean;
  running?: boolean;
  location_name?: string | null;
};

export type RollLane = {
  lane_key: string;
  label: string;
  share: number;
  need_kg: number;
  target_kg?: number;
  loaded_kg: number;
  short_kg: number;
  covered: boolean;
  material_name?: string;
  rolls: RollLaneRoll[];
};

export type ReturnRollPayload = {
  rollId: string;
  mode: "RETURN" | "FINISHED";
  weightKg?: number;
  note?: string;
};

const kg = (value: number | null | undefined) =>
  `${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 1, minimumFractionDigits: 1 })} kg`;

export function RollLanesPanel({
  lanes,
  mode,
  allowRemove = false,
  allowReturn = true,
  busy = false,
  onRemove,
  onReturn,
  testIdPrefix = "roll-lanes",
}: {
  lanes: RollLane[];
  mode?: string | null;
  allowRemove?: boolean;
  allowReturn?: boolean;
  busy?: boolean;
  onRemove?: (roll: RollLaneRoll) => void;
  onReturn?: (payload: ReturnRollPayload) => Promise<unknown> | void;
  testIdPrefix?: string;
}) {
  const [returning, setReturning] = useState<RollLaneRoll | null>(null);
  const isLanes = String(mode || "").toUpperCase() === "LANES";

  if (!lanes.length) return null;

  return (
    <section
      className="rounded-xl border border-line bg-surface-1 p-3"
      aria-label={isLanes ? "Rolls by lane" : "Rolls loaded"}
      data-testid={testIdPrefix}
    >
      <div className="mb-2 flex items-center gap-2">
        <Layers className="h-4 w-4 text-content-3" aria-hidden />
        <h3 className="text-[12px] font-semibold text-content-3">
          {isLanes ? "Rolls by lane" : "Rolls loaded"}
        </h3>
      </div>
      <div className={cn("grid gap-3", lanes.length > 1 ? "lg:grid-cols-2" : "")}>
        {lanes.map((lane) => (
          <LaneCard
            key={lane.lane_key}
            lane={lane}
            showShare={isLanes}
            allowRemove={allowRemove}
            allowReturn={allowReturn}
            busy={busy}
            onRemove={onRemove}
            onReturnClick={setReturning}
            testId={`${testIdPrefix}-${lane.lane_key}`}
          />
        ))}
      </div>
      <ReturnRollDialog
        roll={returning}
        busy={busy}
        onClose={() => setReturning(null)}
        onConfirm={async (payload) => {
          await onReturn?.(payload);
          setReturning(null);
        }}
      />
    </section>
  );
}

function LaneCard({
  lane,
  showShare,
  allowRemove,
  allowReturn,
  busy,
  onRemove,
  onReturnClick,
  testId,
}: {
  lane: RollLane;
  showShare: boolean;
  allowRemove: boolean;
  allowReturn: boolean;
  busy: boolean;
  onRemove?: (roll: RollLaneRoll) => void;
  onReturnClick: (roll: RollLaneRoll) => void;
  testId: string;
}) {
  const pct = useMemo(() => {
    if (!lane.need_kg || lane.need_kg <= 0) return lane.loaded_kg > 0 ? 100 : 0;
    return Math.min(100, Math.round((lane.loaded_kg / lane.need_kg) * 100));
  }, [lane.loaded_kg, lane.need_kg]);
  const empty = !lane.rolls.length || lane.loaded_kg <= 0.0005;

  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        empty ? "border-warning-border bg-warning-bg/40" : "border-line bg-surface-2",
      )}
      data-testid={testId}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-content-1">{lane.label}</div>
          {lane.material_name ? (
            <div className="truncate text-caption text-content-3">{lane.material_name}</div>
          ) : null}
        </div>
        {showShare ? (
          <span className="rounded-full bg-surface-1 px-2 py-0.5 text-caption font-semibold text-content-2">
            {Math.round(lane.share * 100)}% of output
          </span>
        ) : null}
      </div>

      <div className="mt-2">
        <div
          className="h-2 overflow-hidden rounded-full bg-surface-1"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={pct}
          aria-label={`${lane.label}: ${kg(lane.loaded_kg)} loaded against ${kg(lane.need_kg)} still needed`}
        >
          <div
            className={cn("h-full rounded-full", lane.covered ? "bg-success" : "bg-warning-fg")}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-caption tabular-nums text-content-3">
          <span>
            Loaded <b className="text-content-1">{kg(lane.loaded_kg)}</b>
          </span>
          <span>
            Still needed <b className="text-content-1">{kg(lane.need_kg)}</b>
          </span>
          {lane.covered ? (
            <span className="inline-flex items-center gap-1 font-semibold text-success-fg">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> covered
            </span>
          ) : (
            <span className="font-semibold text-warning-fg">short {kg(lane.short_kg)}</span>
          )}
        </div>
      </div>

      {empty ? (
        <p className="mt-2 text-xs font-semibold text-warning-fg">
          No roll with weight left in this lane. Add the next roll before the next output entry.
        </p>
      ) : null}

      <ol className="mt-2 space-y-1.5">
        {lane.rolls.map((roll, index) => {
          const used =
            roll.original_weight_kg && roll.original_weight_kg > 0
              ? Math.max(0, Math.min(100, Math.round((1 - roll.weight_kg / roll.original_weight_kg) * 100)))
              : 0;
          return (
            <li
              key={roll.id}
              className="flex items-center gap-2 rounded-md border border-line bg-surface-1 px-2.5 py-1.5"
              data-testid={`${testId}-roll-${roll.label_id}`}
            >
              {index === 0 ? (
                <CircleDot className="h-3.5 w-3.5 shrink-0 text-success-fg" aria-label="Running" />
              ) : (
                <span className="w-3.5 shrink-0 text-center text-caption font-semibold text-content-4">{index + 1}</span>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2">
                  <span className="font-mono text-xs font-semibold text-content-1">{roll.label_id}</span>
                  {index === 0 ? (
                    <span className="text-caption font-semibold text-success-fg">running</span>
                  ) : (
                    <span className="text-caption text-content-4">queued</span>
                  )}
                  {roll.started && index !== 0 ? (
                    <span className="text-caption text-content-3">part-used</span>
                  ) : null}
                </div>
                <div className="truncate text-caption tabular-nums text-content-3">
                  {kg(roll.weight_kg)} left
                  {roll.original_weight_kg ? ` of ${kg(roll.original_weight_kg)}` : ""}
                  {roll.width_mm ? ` · ${roll.width_mm} mm` : ""}
                  {roll.thickness_micron ? ` · ${roll.thickness_micron} µ` : ""}
                  {used > 0 ? ` · ${used}% used` : ""}
                </div>
              </div>
              {roll.started && allowReturn ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 shrink-0 px-2 text-xs"
                  disabled={busy}
                  onClick={() => onReturnClick(roll)}
                  data-testid={`${testId}-return-${roll.label_id}`}
                >
                  <Undo2 className="mr-1 h-3.5 w-3.5" aria-hidden /> Return balance
                </Button>
              ) : null}
              {!roll.started && allowRemove ? (
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 shrink-0 text-content-4 hover:text-danger-fg"
                  disabled={busy}
                  aria-label={`Take ${roll.label_id} off this job`}
                  onClick={() => onRemove?.(roll)}
                  data-testid={`${testId}-remove-${roll.label_id}`}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function ReturnRollDialog({
  roll,
  busy,
  onClose,
  onConfirm,
}: {
  roll: RollLaneRoll | null;
  busy: boolean;
  onClose: () => void;
  onConfirm: (payload: ReturnRollPayload) => Promise<void>;
}) {
  const [mode, setMode] = useState<"RETURN" | "FINISHED">("RETURN");
  const [weight, setWeight] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setMode("RETURN");
    setWeight("");
    setNote("");
    setError(null);
  };

  const submit = async () => {
    if (!roll) return;
    setError(null);
    const measured = weight.trim() === "" ? undefined : Number(weight);
    if (measured !== undefined && (!Number.isFinite(measured) || measured < 0)) {
      setError("Enter the weighed balance in kg, or leave it empty to use the system balance.");
      return;
    }
    if (measured !== undefined && measured > roll.weight_kg + 0.001) {
      setError(`The system shows ${kg(roll.weight_kg)} left. Check the scale.`);
      return;
    }
    try {
      await onConfirm({ rollId: roll.id, mode, weightKg: mode === "RETURN" ? measured : undefined, note: note.trim() || undefined });
      reset();
    } catch (err: any) {
      setError(err?.response?.data?.error || err?.message || "Could not return the roll.");
    }
  };

  return (
    <Dialog
      open={Boolean(roll)}
      onOpenChange={(open) => {
        if (!open) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Take {roll?.label_id} off this job</DialogTitle>
          <DialogDescription>
            The roll keeps its label. System balance: <b>{kg(roll?.weight_kg)}</b>.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="What happens to the roll">
            <button
              type="button"
              role="radio"
              aria-checked={mode === "RETURN"}
              onClick={() => setMode("RETURN")}
              className={cn(
                "rounded-lg border p-3 text-left text-sm",
                mode === "RETURN" ? "border-primary bg-primary/5 font-semibold" : "border-line",
              )}
              data-testid="return-roll-mode-return"
            >
              <ArrowDownToLine className="mb-1 h-4 w-4" aria-hidden />
              Return to stock
              <span className="block text-caption font-normal text-content-3">What is left goes back with the same label.</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={mode === "FINISHED"}
              onClick={() => setMode("FINISHED")}
              className={cn(
                "rounded-lg border p-3 text-left text-sm",
                mode === "FINISHED" ? "border-primary bg-primary/5 font-semibold" : "border-line",
              )}
              data-testid="return-roll-mode-finished"
            >
              <CheckCircle2 className="mb-1 h-4 w-4" aria-hidden />
              Roll finished
              <span className="block text-caption font-normal text-content-3">Core end is booked as scrap.</span>
            </button>
          </div>
          {mode === "RETURN" ? (
            <label className="block text-sm">
              <span className="mb-1 block text-caption font-semibold text-content-2">Weighed balance (kg), optional</span>
              <Input
                inputMode="decimal"
                value={weight}
                onChange={(event) => setWeight(event.target.value)}
                placeholder={String(roll?.weight_kg ?? "")}
                data-testid="return-roll-weight"
              />
              <span className="mt-1 block text-caption text-content-3">If it weighs less than the system balance, the difference is booked as scrap.</span>
            </label>
          ) : null}
          <label className="block text-sm">
            <span className="mb-1 block text-caption font-semibold text-content-2">Note, optional</span>
            <Input value={note} onChange={(event) => setNote(event.target.value)} data-testid="return-roll-note" />
          </label>
          {error ? (
            <p className="rounded-md border border-danger-border bg-danger-bg px-3 py-2 text-xs font-semibold text-danger-fg" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={busy} data-testid="return-roll-confirm">
            {mode === "RETURN" ? "Return balance" : "Mark finished"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Chip, ChipGroup } from "@/components/ds/chip";
import { StepStrip } from "@/components/ds/step-strip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { usePlannerControlHub } from "@/hooks/use-planner";
import {
  plannerService,
  type PlannerInventoryOption,
} from "@/services/planner";

import { DemandLineList, FieldRow, SummaryStat, WizardShell } from "./shared";

export interface DirectFgWizardProps {
  seedOrderKey?: string | null;
  onClose: () => void;
}

type Picked = { option: PlannerInventoryOption; qty: number };

function isExactFgOption(option: PlannerInventoryOption) {
  const bucket = String(option.source_bucket || "").toUpperCase();
  const mode = String(option.signature_match_mode || "").toUpperCase();
  return bucket === "FINISHED_STOCK" && mode === "FINAL_SPEC";
}

export function DirectFgWizard({ seedOrderKey, onClose }: DirectFgWizardProps) {
  const qc = useQueryClient();
  const [step, setStep] = useState<"pick-line" | "pick-stock" | "confirm">(
    "pick-line",
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(
    seedOrderKey ?? null,
  );
  const [picks, setPicks] = useState<Record<string, Picked>>({});
  const [error, setError] = useState<string | null>(null);

  const controlHub = usePlannerControlHub({
    planning_limit: 60,
    active_limit: 12,
    history_limit: 0,
  });
  const orders = controlHub.data?.orders ?? [];
  const selected = useMemo(
    () =>
      orders.find((o) => `${o.order_kind}:${o.order_id}` === selectedKey) ??
      null,
    [orders, selectedKey],
  );

  useEffect(() => {
    if (
      seedOrderKey &&
      orders.find((o) => `${o.order_kind}:${o.order_id}` === seedOrderKey)
    ) {
      setSelectedKey(seedOrderKey);
      setStep("pick-stock");
    }
  }, [seedOrderKey, orders]);

  const finishedOptions = useMemo<PlannerInventoryOption[]>(() => {
    const opts = selected?.inventory_options ?? [];
    return opts.filter(isExactFgOption);
  }, [selected]);

  const required = Number(selected?.required_qty_kg || 0);
  const allocatedTotal = Object.values(picks).reduce(
    (sum, p) => sum + (Number(p.qty) || 0),
    0,
  );
  const remaining = Math.max(0, required - allocatedTotal);

  const claimMut = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("No demand line selected");
      const soItemId = selected.sales_order_item_id;
      if (!soItemId) throw new Error("Sales order item missing");
      for (const pick of Object.values(picks)) {
        await plannerService.claimStockToSales(soItemId, {
          inventory_type: pick.option.inventory_type,
          inventory_id: pick.option.inventory_id,
          claim_qty_kg: Number(pick.qty),
        });
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["planner"] });
      onClose();
    },
    onError: (e: any) =>
      setError(e?.response?.data?.detail || e?.message || "Failed to claim"),
  });

  const togglePick = (option: PlannerInventoryOption) => {
    setPicks((prev) => {
      const id = option.inventory_id;
      const next = { ...prev };
      if (next[id]) {
        delete next[id];
      } else {
        const cap = Number(
          option.allocatable_qty_kg || option.quantity_kg || 0,
        );
        next[id] = { option, qty: Math.min(cap, remaining || cap) };
      }
      return next;
    });
  };

  const updateQty = (id: string, value: number) => {
    setPicks((prev) => {
      if (!prev[id]) return prev;
      const cap = Number(
        prev[id].option.allocatable_qty_kg || prev[id].option.quantity_kg || 0,
      );
      return {
        ...prev,
        [id]: { ...prev[id], qty: Math.max(0, Math.min(cap, value)) },
      };
    });
  };

  const stepDefs = [
    { id: "pick-line", label: "Pick demand", hint: "Sales line" },
    { id: "pick-stock", label: "Pick FG", hint: "Finished pool" },
    { id: "confirm", label: "Confirm", hint: "Claim stock" },
  ];

  return (
    <WizardShell
      title="Direct FG · assign existing finished stock"
      onBack={onClose}
      footer={
        <>
          {step !== "pick-line" ? (
            <Button
              variant="ghost"
              onClick={() =>
                setStep(step === "confirm" ? "pick-stock" : "pick-line")
              }
            >
              Previous
            </Button>
          ) : null}
          {step === "pick-line" ? (
            <Button
              disabled={!selected || !selected.sales_order_item_id}
              onClick={() => setStep("pick-stock")}
            >
              Next · pick FG
            </Button>
          ) : step === "pick-stock" ? (
            <Button
              disabled={Object.keys(picks).length === 0}
              onClick={() => setStep("confirm")}
            >
              Next · review
            </Button>
          ) : (
            <Button
              disabled={claimMut.isPending}
              onClick={() => claimMut.mutate()}
            >
              {claimMut.isPending ? "Claiming…" : "Confirm claim"}
            </Button>
          )}
        </>
      }
    >
      <StepStrip steps={stepDefs} currentId={step} compact />

      {error ? (
        <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-xs text-danger-fg">
          {error}
        </div>
      ) : null}

      {step === "pick-line" ? (
        <section className="space-y-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-content-3">
            Sales lines awaiting plan
          </h3>
          <DemandLineList
            orders={orders}
            selectedKey={selectedKey}
            onSelect={setSelectedKey}
            isLoading={controlHub.isLoading}
            filter={(o) =>
              Boolean(o.sales_order_item_id) &&
              Boolean(o.source_availability?.has_fg)
            }
            emptyText="No sales lines have FG matches available."
          />
        </section>
      ) : null}

      {step === "pick-stock" && selected ? (
        <section className="space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <SummaryStat
              label="Required"
              value={`${required.toFixed(1)} kg`}
              tone="info"
            />
            <SummaryStat
              label="Allocated"
              value={`${allocatedTotal.toFixed(1)} kg`}
              tone={allocatedTotal >= required ? "success" : "warn"}
            />
            <SummaryStat
              label="Remaining"
              value={`${remaining.toFixed(1)} kg`}
              tone={remaining > 0 ? "warn" : "success"}
            />
          </div>
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-content-3">
            Finished pool matches
          </h3>
          {finishedOptions.length === 0 ? (
            <div className="rounded-lg border border-dashed border-line bg-surface-1 p-4 text-center text-sm text-content-3">
              No FG matches found for this line.
            </div>
          ) : (
            <div className="grid max-h-[320px] gap-2 overflow-y-auto pr-1">
              {finishedOptions.map((opt) => {
                const id = opt.inventory_id;
                const pick = picks[id];
                const cap = Number(
                  opt.allocatable_qty_kg || opt.quantity_kg || 0,
                );
                return (
                  <div
                    key={id}
                    className={cn(
                      "flex flex-col gap-2 rounded-lg border bg-surface-1 p-3 transition-colors",
                      pick ? "border-info-border bg-info-bg" : "border-line",
                    )}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <div>
                        <div className="font-mono-token text-[13px] font-semibold text-content-1">
                          {opt.label || opt.display_name || "—"}
                        </div>
                        <div className="text-[11px] text-content-3">
                          {opt.family_display_name ||
                            opt.process_state_label ||
                            ""}
                        </div>
                      </div>
                      <ChipGroup spacing="tight">
                        <Chip kind="info" size="sm" mono>
                          {cap.toFixed(1)} kg
                        </Chip>
                        {opt.size_line ? (
                          <Chip kind="neutral" size="sm">
                            {opt.size_line}
                          </Chip>
                        ) : null}
                      </ChipGroup>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant={pick ? "default" : "outline"}
                        onClick={() => togglePick(opt)}
                      >
                        {pick ? "Selected" : "Select"}
                      </Button>
                      {pick ? (
                        <FieldRow label="Claim qty (kg)">
                          <Input
                            type="number"
                            step="0.1"
                            max={cap}
                            min={0}
                            value={pick.qty}
                            onChange={(e) =>
                              updateQty(id, Number(e.target.value))
                            }
                            className="h-9 max-w-[140px]"
                          />
                        </FieldRow>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      ) : null}

      {step === "confirm" && selected ? (
        <section className="space-y-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-content-3">
            Review
          </h3>
          <div className="rounded-lg border border-line bg-surface-1 p-3 text-[12px]">
            <div className="font-semibold">
              {selected.order_number} · {selected.customer_name || "—"}
            </div>
            <div className="text-content-3">{selected.template_name}</div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <SummaryStat
              label="Required"
              value={`${required.toFixed(1)} kg`}
              tone="info"
            />
            <SummaryStat
              label="Allocated"
              value={`${allocatedTotal.toFixed(1)} kg`}
              tone={allocatedTotal >= required ? "success" : "warn"}
            />
            <SummaryStat
              label="Picks"
              value={String(Object.keys(picks).length)}
            />
          </div>
          <div className="space-y-1">
            {Object.values(picks).map((p) => (
              <div
                key={p.option.inventory_id}
                className="flex items-center justify-between rounded-lg border border-line bg-surface-1 px-3 py-1.5 text-[12px]"
              >
                <span className="font-mono-token">{p.option.label}</span>
                <span className="font-mono-token">{p.qty.toFixed(1)} kg</span>
              </div>
            ))}
          </div>
          {allocatedTotal < required ? (
            <div className="rounded-lg border border-warning-border bg-warning-bg px-3 py-2 text-xs text-warning-fg">
              Allocation is short by {(required - allocatedTotal).toFixed(1)} kg
              — partial release will be created.
            </div>
          ) : null}
        </section>
      ) : null}
    </WizardShell>
  );
}

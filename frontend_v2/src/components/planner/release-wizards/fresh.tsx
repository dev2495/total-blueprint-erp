"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Chip, ChipGroup } from "@/components/ds/chip";
import { StepStrip } from "@/components/ds/step-strip";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { usePlannerControlHub } from "@/hooks/use-planner";
import { plannerService } from "@/services/planner";

import { DemandLineList, SummaryStat, WizardShell } from "./shared";

export interface FreshWizardProps {
  seedOrderKey?: string | null;
  onClose: () => void;
}

type StockStrategy = "FINAL_STOCK" | "INTERMEDIATE_POOL";

export function FreshWizard({ seedOrderKey, onClose }: FreshWizardProps) {
  const qc = useQueryClient();
  const [step, setStep] = useState<"pick-line" | "configure" | "confirm">(
    "pick-line",
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(
    seedOrderKey ?? null,
  );
  const [strategy, setStrategy] = useState<StockStrategy>("FINAL_STOCK");
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
      setStep("configure");
    }
  }, [seedOrderKey, orders]);

  useEffect(() => {
    if (selected?.stock_strategy === "INTERMEDIATE_POOL")
      setStrategy("INTERMEDIATE_POOL");
    else if (selected?.stock_strategy === "FINAL_STOCK")
      setStrategy("FINAL_STOCK");
  }, [selected]);

  const planMut = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("No demand line selected");
      return plannerService.planOrder(
        selected.order_kind,
        String(selected.order_id),
        {
          option: "FRESH",
          start_step_index: Number(selected.required_start_step ?? 0),
          stop_step_index: Number(selected.route_last_step_index ?? 0),
        },
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["planner"] });
      onClose();
    },
    onError: (e: any) =>
      setError(
        e?.response?.data?.detail || e?.message || "Failed to create fresh PSO",
      ),
  });

  const stepDefs = [
    { id: "pick-line", label: "Pick demand", hint: "Sales / stock line" },
    { id: "configure", label: "Configure", hint: "Strategy + route" },
    { id: "confirm", label: "Confirm", hint: "Create PSO" },
  ];

  return (
    <WizardShell
      title="Fresh · create new PlannedStockOrder"
      onBack={onClose}
      footer={
        <>
          {step !== "pick-line" ? (
            <Button
              variant="ghost"
              onClick={() =>
                setStep(step === "confirm" ? "configure" : "pick-line")
              }
            >
              Previous
            </Button>
          ) : null}
          {step === "pick-line" ? (
            <Button disabled={!selected} onClick={() => setStep("configure")}>
              Next · configure
            </Button>
          ) : step === "configure" ? (
            <Button onClick={() => setStep("confirm")}>Next · review</Button>
          ) : (
            <Button
              disabled={planMut.isPending}
              onClick={() => planMut.mutate()}
            >
              {planMut.isPending ? "Creating…" : "Confirm · create PSO"}
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
            emptyText="No demand lines available."
          />
        </section>
      ) : null}

      {step === "configure" && selected ? (
        <section className="space-y-3">
          <div className="rounded-lg border border-line bg-surface-1 p-3 text-[12px]">
            <div className="font-semibold">
              {selected.order_number} · {selected.customer_name || "—"}
            </div>
            <div className="text-content-3">{selected.template_name}</div>
            <ChipGroup className="mt-2" spacing="tight">
              {selected.fg_type ? (
                <Chip
                  kind={
                    String(selected.fg_type).toUpperCase().includes("ROLL")
                      ? "fg-roll"
                      : "fg-pouch"
                  }
                  size="sm"
                >
                  {selected.fg_type}
                </Chip>
              ) : null}
              {selected.effective_dims?.width_mm ? (
                <Chip kind="info" size="sm" mono>
                  {Math.round(selected.effective_dims.width_mm)}
                  {selected.effective_dims.height_mm
                    ? `×${Math.round(selected.effective_dims.height_mm)}mm`
                    : "mm"}
                </Chip>
              ) : null}
              {selected.roll_invariants?.thickness_micron ? (
                <Chip kind="thick" size="sm" mono>
                  {Math.round(
                    Number(selected.roll_invariants.thickness_micron),
                  )}
                  μ
                </Chip>
              ) : null}
            </ChipGroup>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <SummaryStat
              label="Target qty"
              value={`${Number(selected.required_qty_kg || 0).toFixed(1)} kg`}
              tone="info"
            />
            <SummaryStat
              label="Route span"
              value={`step ${selected.required_start_step ?? 0} → ${selected.route_last_step_index ?? 0}`}
            />
          </div>
          <div className="space-y-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-content-3">
              Stock strategy
            </span>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setStrategy("FINAL_STOCK")}
                className={cn(
                  "flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors",
                  strategy === "FINAL_STOCK"
                    ? "border-info-border bg-info-bg"
                    : "border-line bg-surface-1 hover:bg-surface-2",
                )}
              >
                <span className="font-display text-sm font-semibold">
                  Final stock
                </span>
                <span className="text-[11px] text-content-3">
                  Run the full route to FG.
                </span>
              </button>
              <button
                type="button"
                onClick={() => setStrategy("INTERMEDIATE_POOL")}
                className={cn(
                  "flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors",
                  strategy === "INTERMEDIATE_POOL"
                    ? "border-info-border bg-info-bg"
                    : "border-line bg-surface-1 hover:bg-surface-2",
                )}
              >
                <span className="font-display text-sm font-semibold">
                  Intermediate pool
                </span>
                <span className="text-[11px] text-content-3">
                  Stop at WIP for shared use.
                </span>
              </button>
            </div>
          </div>
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
          <div className="grid grid-cols-2 gap-2">
            <SummaryStat
              label="Target qty"
              value={`${Number(selected.required_qty_kg || 0).toFixed(1)} kg`}
              tone="info"
            />
            <SummaryStat
              label="Strategy"
              value={
                strategy === "FINAL_STOCK" ? "Final stock" : "Intermediate pool"
              }
            />
          </div>
          {selected.release_checklist?.blocked_count ? (
            <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-xs text-danger-fg">
              {selected.release_checklist.blocked_count} blocker(s) — release
              will be queued behind these.
            </div>
          ) : null}
          <div className="rounded-lg border border-line bg-surface-2 p-3 text-[11px] text-content-3">
            Confirms a Fresh release on the control-hub planner. Server
            validates the stop-step before persisting.
          </div>
        </section>
      ) : null}
    </WizardShell>
  );
}

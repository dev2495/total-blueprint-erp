"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Chip, ChipGroup } from "@/components/ds/chip";
import { StepStrip } from "@/components/ds/step-strip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import {
  plannerService,
  type PlannerSkuVariantPreset,
} from "@/services/planner";

import { FieldRow, SummaryStat, WizardShell } from "./shared";

type LaunchKind = "PACKAGING_STOCK" | "POD_STOCK";

export interface InHouseWizardProps {
  kind: LaunchKind;
  onClose: () => void;
}

const META: Record<
  LaunchKind,
  { title: string; subtitle: string; tone: string }
> = {
  PACKAGING_STOCK: {
    title: "Packaging stock · launch in-house",
    subtitle: "Create a PSO for an internal packaging material run.",
    tone: "amber",
  },
  POD_STOCK: {
    title: "POD stock · launch in-house",
    subtitle: "Create a PSO for printed-on-demand stock.",
    tone: "violet",
  },
};

export function InHouseWizard({ kind, onClose }: InHouseWizardProps) {
  const qc = useQueryClient();
  const meta = META[kind];
  const [step, setStep] = useState<"pick-variant" | "configure" | "confirm">(
    "pick-variant",
  );
  const [selectedVariantId, setSelectedVariantId] = useState<string | null>(
    null,
  );
  const [qty, setQty] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const variantsQuery = useQuery({
    queryKey: ["planner", "sku-variants", kind],
    queryFn: () =>
      plannerService.getPlannerSkuVariants({ launch_kind: kind, active: true }),
  });

  const variants = variantsQuery.data ?? [];
  const selected = useMemo(
    () => variants.find((v) => v.id === selectedVariantId) ?? null,
    [variants, selectedVariantId],
  );

  const targetQty =
    Number(qty) || (selected ? Number(selected.default_qty || 0) : 0);

  const planMut = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Pick a variant first");
      return plannerService.createStockOrder({
        template_id: selected.template ?? undefined,
        product_master: selected.product_master ?? null,
        planner_sku_variant_id: selected.id,
        launcher_mode: kind,
        quantity: targetQty,
        quantity_uom: selected.quantity_uom,
        stock_purpose: selected.stock_purpose,
        stock_strategy: selected.stock_strategy as any,
        packaging_material_id: selected.packaging_material ?? undefined,
        pod_sku_variant_id: selected.pod_sku_variant ?? undefined,
        roll_form: undefined,
        geometry: selected.geometry_snapshot,
        film_layers: selected.layer_snapshot,
        printing: selected.printing_snapshot,
        addons: selected.addons_snapshot,
        packaging_snapshot: selected.packaging_snapshot,
        start_step_index: Number(selected.start_step_index ?? 0),
        stop_step_index: selected.stop_step_index ?? undefined,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["planner"] });
      onClose();
    },
    onError: (e: any) =>
      setError(e?.response?.data?.detail || e?.message || "Failed to launch"),
  });

  const stepDefs = [
    {
      id: "pick-variant",
      label: "Pick preset",
      hint: "Internal Product Master preset",
    },
    { id: "configure", label: "Set qty", hint: "Override default" },
    { id: "confirm", label: "Confirm", hint: "Launch PSO" },
  ];

  return (
    <WizardShell
      title={meta.title}
      onBack={onClose}
      footer={
        <>
          {step !== "pick-variant" ? (
            <Button
              variant="ghost"
              onClick={() =>
                setStep(step === "confirm" ? "configure" : "pick-variant")
              }
            >
              Previous
            </Button>
          ) : null}
          {step === "pick-variant" ? (
            <Button disabled={!selected} onClick={() => setStep("configure")}>
              Next · set qty
            </Button>
          ) : step === "configure" ? (
            <Button
              disabled={targetQty <= 0}
              onClick={() => setStep("confirm")}
            >
              Next · review
            </Button>
          ) : (
            <Button
              disabled={planMut.isPending}
              onClick={() => planMut.mutate()}
            >
              {planMut.isPending ? "Launching…" : "Confirm · launch PSO"}
            </Button>
          )}
        </>
      }
    >
      <StepStrip steps={stepDefs} currentId={step} compact />
      <p className="text-[11px] text-content-3">{meta.subtitle}</p>

      {error ? (
        <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-xs text-danger-fg">
          {error}
        </div>
      ) : null}

      {step === "pick-variant" ? (
        <section className="space-y-2">
          {variantsQuery.isLoading ? (
            <div className="rounded-lg border border-dashed border-line bg-surface-1 p-4 text-center text-sm text-content-3">
              Loading presets…
            </div>
          ) : variants.length === 0 ? (
            <div className="rounded-lg border border-dashed border-line bg-surface-1 p-4 text-center text-sm text-content-3">
              No active {kind === "PACKAGING_STOCK" ? "packaging" : "POD"}{" "}
              presets configured.
            </div>
          ) : (
            <div className="grid max-h-[320px] gap-2 overflow-y-auto pr-1">
              {variants.map((v) => {
                const isSelected = v.id === selectedVariantId;
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setSelectedVariantId(v.id)}
                    className={cn(
                      "flex flex-col gap-1 rounded-lg border bg-surface-1 px-3 py-2 text-left transition-colors",
                      isSelected
                        ? "border-info-border bg-info-bg"
                        : "border-line hover:bg-surface-2",
                    )}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-mono-token text-[13px] font-semibold text-content-1">
                        {v.code}
                      </span>
                      <span className="font-mono-token text-[11px] text-content-3">
                        {Number(v.default_qty || 0).toFixed(0)} {v.quantity_uom}
                      </span>
                    </div>
                    <div className="truncate text-[12px] text-content-2">
                      {v.name}
                    </div>
                    <ChipGroup spacing="tight">
                      {v.template_name ? (
                        <Chip kind="neutral" size="sm">
                          {v.template_name}
                        </Chip>
                      ) : null}
                      {v.committed_customer_name ? (
                        <Chip kind="info" size="sm">
                          {v.committed_customer_name}
                        </Chip>
                      ) : null}
                      {v.committed_artwork_design_code ? (
                        <Chip kind="accent" size="sm">
                          {v.committed_artwork_design_code}
                        </Chip>
                      ) : null}
                    </ChipGroup>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      ) : null}

      {step === "configure" && selected ? (
        <section className="space-y-3">
          <div className="rounded-lg border border-line bg-surface-1 p-3 text-[12px]">
            <div className="font-semibold">
              {selected.code} · {selected.name}
            </div>
            <div className="text-content-3">{selected.template_name}</div>
          </div>
          <FieldRow label={`Target qty (${selected.quantity_uom})`}>
            <Input
              type="number"
              step="0.1"
              min={0}
              value={qty}
              placeholder={String(selected.default_qty)}
              onChange={(e) => setQty(e.target.value)}
              className="h-10 max-w-[200px]"
            />
          </FieldRow>
          <SummaryStat
            label="Default"
            value={`${Number(selected.default_qty || 0).toFixed(1)} ${selected.quantity_uom}`}
          />
        </section>
      ) : null}

      {step === "confirm" && selected ? (
        <section className="space-y-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-content-3">
            Review
          </h3>
          <div className="rounded-lg border border-line bg-surface-1 p-3 text-[12px]">
            <div className="font-semibold">
              {selected.code} · {selected.name}
            </div>
            <div className="text-content-3">{selected.template_name}</div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <SummaryStat
              label="Target qty"
              value={`${targetQty.toFixed(1)} ${selected.quantity_uom}`}
              tone="info"
            />
            <SummaryStat label="Launch kind" value={kind} />
          </div>
        </section>
      ) : null}
    </WizardShell>
  );
}

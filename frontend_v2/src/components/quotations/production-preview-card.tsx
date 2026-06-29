"use client";

import { useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  CheckCircle2,
  Factory,
  Loader2,
  ShieldAlert,
  Timer,
  Layers,
} from "lucide-react";
import {
  quotationService,
  type ProductionPreviewResult,
  type QuoteLineSpec,
} from "@/services/quotation";

interface ProductionPreviewCardProps {
  spec: QuoteLineSpec;
  plantId?: string;
  qty: number;
  qtyUom: "KG" | "PCS";
}

function inr(v: number | undefined | null): string {
  if (v === undefined || v === null || !Number.isFinite(v)) return "—";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(v);
}

export default function ProductionPreviewCard({
  spec,
  plantId,
  qty,
  qtyUom,
}: ProductionPreviewCardProps) {
  const previewMut = useMutation<ProductionPreviewResult>({
    mutationFn: () =>
      quotationService.productionPreview({
        spec,
        plant_id: plantId,
        qty,
        qty_uom: qtyUom,
      }),
  });

  // Re-fire on key changes (spec/qty)
  const key = JSON.stringify({
    w: spec.width_mm,
    h: spec.height_mm,
    g: spec.gusset_mm,
    f: spec.flap_mm,
    style: spec.pouch_style_id || spec.pouch_style_code,
    child: spec.child_web_width_mm || spec.child_target_width_mm,
    filmArea: spec.film_area_width_mm,
    stockForm: spec.stock_form,
    ink: spec.ink_gsm,
    adhesive: spec.adhesive_gsm,
    artwork: spec.artwork_id,
    layers: (spec.layers || []).map((l) => ({
      material_id: l.material_id,
      micron: l.micron,
      gsm: l.gsm,
      density_gcm3: l.density_gcm3,
      rate_per_kg: l.rate_per_kg,
    })),
    qty,
    qtyUom,
    plant: plantId,
  });
  useEffect(() => {
    if (!spec.width_mm || !spec.height_mm) return;
    const t = setTimeout(() => previewMut.mutate(), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const data = previewMut.data;

  if (!data && !previewMut.isPending) {
    return (
      <div className="rounded-xl border border-dashed border-line-strong p-4 bg-surface-2">
        <div className="flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-widest text-content-3">
          <Factory className="h-3.5 w-3.5" />
          Production preview
        </div>
        <p className="mt-2 text-[11px] font-bold text-content-4">
          Add geometry + at least one layer to estimate yields.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-line bg-gradient-to-br from-white to-info-bg p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Factory className="h-3.5 w-3.5 text-info-fg" />
        <span className="text-[10px] font-extrabold uppercase tracking-widest text-content-3">
          Production preview
        </span>
        {previewMut.isPending ? (
          <Loader2 className="h-3 w-3 ml-auto animate-spin text-info-fg" />
        ) : null}
      </div>
      {data ? (
        <>
          <div className="grid grid-cols-2 gap-2 text-[11px] font-bold text-content-3">
            <Cell
              icon={<Layers className="h-3 w-3" />}
              label="Pouches/parent roll"
              value={inr(data.pouches_per_parent_roll)}
            />
            <Cell
              icon={<Layers className="h-3 w-3" />}
              label="Parent rolls"
              value={inr(data.parent_rolls_needed)}
            />
            <Cell
              icon={<Timer className="h-3 w-3" />}
              label="Run estimate"
              value={`${inr(data.machine_time_hrs)} h`}
            />
            <Cell
              icon={<Layers className="h-3 w-3" />}
              label="Lanes"
              value={String(data.lanes_per_parent)}
            />
            <Cell
              icon={<Layers className="h-3 w-3" />}
              label="Total kg"
              value={`${inr(data.total_kg)} kg`}
            />
            <Cell
              icon={<Layers className="h-3 w-3" />}
              label="Wt / pouch"
              value={`${inr(data.weight_per_pouch_g)} g`}
            />
          </div>
          {data.material_availability.length > 0 ? (
            <div className="border-t border-line pt-3 space-y-1">
              <div className="text-[10px] font-extrabold uppercase tracking-widest text-content-3">
                Material availability
              </div>
              {data.material_availability.map((row) => (
                <div
                  key={row.material_id}
                  className="flex items-center justify-between gap-2 text-[11px] font-semibold"
                >
                  <span className="truncate min-w-0 flex items-center gap-1.5">
                    {row.ok ? (
                      <CheckCircle2 className="h-3 w-3 text-success-fg shrink-0" />
                    ) : (
                      <ShieldAlert className="h-3 w-3 text-danger-fg shrink-0" />
                    )}
                    <span className="font-mono text-[10px] text-content-3">
                      {row.material_code}
                    </span>
                    <span className="truncate text-content-2">
                      {row.material_name}
                    </span>
                  </span>
                  <span className="font-mono text-content-2 shrink-0">
                    {inr(row.needed_kg)} / {inr(row.available_kg)} kg
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          {data.note ? (
            <div className="text-[10px] font-bold italic text-content-4 border-t border-line pt-2">
              {data.note}
            </div>
          ) : null}
        </>
      ) : (
        <div className="text-[11px] font-bold text-content-4">Estimating…</div>
      )}
    </div>
  );
}

function Cell({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg bg-surface-1 ring-1 ring-line px-2 py-1.5">
      <div className="flex items-center gap-1 text-[9px] font-extrabold uppercase tracking-widest text-content-3">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 font-mono text-sm font-extrabold text-content-1">
        {value}
      </div>
    </div>
  );
}

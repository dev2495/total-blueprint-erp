"use client";

import { Loader2, RefreshCw, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  asNumber,
  type OrderItemDraft,
} from "@/components/sales/shared/order-draft";
import { type PreviewResult } from "@/services/sales";

function formatNumber(value: number, digits = 2) {
  return value.toLocaleString("en-IN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function PreviewMetric({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div className="rounded-[1.4rem] border border-line bg-surface-1/92 px-4 py-4 shadow-[0_14px_40px_-38px_rgba(15,23,42,0.4)]">
      <div className="text-[10px] font-black uppercase tracking-[0.22em] text-content-4">
        {label}
      </div>
      <div className="mt-2 text-[1.45rem] font-black tracking-tight text-content-1">
        {value}
      </div>
      {hint ? (
        <div className="mt-1 text-xs leading-5 text-content-3">{hint}</div>
      ) : null}
    </div>
  );
}

export function SkuVariantStudioRail({
  item,
  preview,
  previewLoading,
  previewError,
  previewQuantity,
  previewQuantityUom,
  onPreviewQuantityChange,
  onPreviewQuantityUomChange,
  onRefreshPreview,
}: {
  item: OrderItemDraft;
  preview?: PreviewResult | null;
  previewLoading: boolean;
  previewError: string;
  previewQuantity: string;
  previewQuantityUom: "PCS" | "KG";
  onPreviewQuantityChange: (value: string) => void;
  onPreviewQuantityUomChange: (value: "PCS" | "KG") => void;
  onRefreshPreview: () => void;
}) {
  const isRoll = item.finished_good_type === "ROLL";
  const resolvedPreviewUom = isRoll ? "KG" : previewQuantityUom;
  const previewContext = `${formatNumber(asNumber(previewQuantity, item.qty_value), resolvedPreviewUom === "KG" ? 3 : 0)} ${resolvedPreviewUom}`;
  const previewGeometry =
    preview?.physics?.geometry_snapshot || preview?.geometry_snapshot || {};
  const addOnKg = (preview?.bom?.addons || []).reduce(
    (sum, row) => sum + asNumber(row?.weight_kg, 0),
    0,
  );
  const podKg = (preview?.bom?.pod || []).reduce(
    (sum, row) => sum + asNumber(row?.weight_kg, 0),
    0,
  );
  const bomRows = preview?.bom_preview?.components || [];

  return (
    <aside className="space-y-4 xl:sticky xl:top-6">
      <section className="overflow-hidden rounded-[1.9rem] border border-line bg-[linear-gradient(180deg,rgba(15,23,42,0.97),rgba(30,41,59,0.96))] text-white shadow-[0_32px_90px_-48px_rgba(15,23,42,0.6)]">
        <div className="border-b border-surface-1/10 px-5 py-5">
          <div className="inline-flex items-center gap-2 rounded-full border border-surface-1/15 bg-surface-1/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.24em] text-info-border">
            <Sparkles className="h-3.5 w-3.5" />
            Preview Studio
          </div>
          <div className="mt-3 space-y-2">
            <h3 className="text-xl font-black tracking-tight text-white">
              Preview quantity and snapshot
            </h3>
            <p className="max-w-md text-sm leading-6 text-content-4">
              The preview stays tied to the current draft, so BOM, weight, and
              geometry always reflect the quantity you are validating.
            </p>
          </div>
        </div>

        <div className="space-y-4 px-5 py-5">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1.3fr)_110px]">
            <div className="space-y-2">
              <Label className="text-[11px] font-black uppercase tracking-[0.22em] text-content-4">
                Preview quantity
              </Label>
              <Input
                value={previewQuantity}
                onChange={(event) =>
                  onPreviewQuantityChange(event.target.value)
                }
                inputMode="decimal"
                className="h-12 rounded-2xl border-surface-1/10 bg-surface-1/10 text-white placeholder:text-content-4"
                placeholder={previewContext}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-[11px] font-black uppercase tracking-[0.22em] text-content-4">
                UOM
              </Label>
              {isRoll ? (
                <div className="flex h-12 items-center rounded-2xl border border-surface-1/10 bg-surface-1/10 px-4 text-sm font-semibold text-white">
                  KG
                </div>
              ) : (
                <Select
                  value={resolvedPreviewUom}
                  onValueChange={(value) =>
                    onPreviewQuantityUomChange(value as "PCS" | "KG")
                  }
                >
                  <SelectTrigger className="h-12 rounded-2xl border-surface-1/10 bg-surface-1/10 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PCS">PCS</SelectItem>
                    <SelectItem value="KG">KG</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          <div className="rounded-[1.5rem] border border-surface-1/10 bg-surface-1/10 px-4 py-4">
            <div className="text-[10px] font-black uppercase tracking-[0.24em] text-info-border">
              Previewing for
            </div>
            <div className="mt-2 text-lg font-black text-white">
              {previewContext}
            </div>
            <p className="mt-1 text-sm leading-6 text-content-4">
              This is the exact snapshot the builder will calculate against
              before you save the variant.
            </p>
          </div>

          <Button
            type="button"
            onClick={onRefreshPreview}
            className="h-12 w-full rounded-2xl border border-surface-1/15 bg-surface-1/95 text-content-1 hover:bg-surface-1"
          >
            {previewLoading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Refresh preview
          </Button>
        </div>
      </section>

      {previewError ? (
        <div className="rounded-[1.6rem] border border-danger-border bg-danger-bg px-4 py-4 text-sm font-semibold text-danger-fg shadow-[0_14px_40px_-38px_rgba(190,24,93,0.35)]">
          {previewError}
        </div>
      ) : null}

      <section className="space-y-3 rounded-[1.8rem] border border-line bg-surface-1/92 p-4 shadow-[0_24px_55px_-46px_rgba(15,23,42,0.45)]">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-black uppercase tracking-[0.22em] text-content-2">
              Preview result
            </div>
            <div className="mt-1 text-sm text-content-3">
              Weights, geometry, and BOM stay visible in one place.
            </div>
          </div>
          <Badge
            variant="outline"
            className="border-line bg-surface-2 text-content-3"
          >
            {item.finished_good_type}
          </Badge>
        </div>

        {previewLoading ? (
          <div className="flex items-center gap-2 rounded-[1.4rem] border border-line bg-surface-2 px-4 py-4 text-sm text-content-3">
            <Loader2 className="h-4 w-4 animate-spin" />
            Calculating preview...
          </div>
        ) : preview ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
              <PreviewMetric
                label="Unit weight"
                value={
                  item.finished_good_type === "ROLL"
                    ? `${formatNumber(asNumber(preview.roll_preview?.weight_kg, preview.total_weight_kg), 2)} KG`
                    : `${formatNumber(asNumber(preview.unit_weight_g, 0), 3)} g`
                }
                hint="Direct output for the current variant snapshot"
              />
              <PreviewMetric
                label="Total weight"
                value={`${formatNumber(asNumber(preview.total_weight_kg, 0), 3)} KG`}
                hint="Calculated for the selected preview quantity"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <PreviewMetric
                label="Effective geometry"
                value={
                  <span className="text-[1.2rem]">
                    {formatNumber(
                      asNumber(previewGeometry?.effective_width_mm, 0),
                      1,
                    )}{" "}
                    W ×{" "}
                    {formatNumber(
                      asNumber(previewGeometry?.effective_height_mm, 0),
                      1,
                    )}{" "}
                    H
                  </span>
                }
                hint={
                  item.finished_good_type === "POUCH"
                    ? `Style ${String(item.geometry.pouch_style || "").replaceAll("_", " ") || "Template pending"} · Area ${formatNumber(asNumber(previewGeometry?.area_m2, 0), 4)} m²`
                    : "Roll geometry is resolved from the selected route snapshot"
                }
              />
              <PreviewMetric
                label="Add-on / POD mass"
                value={`${formatNumber(addOnKg, 4)} KG`}
                hint={`POD ${formatNumber(podKg, 4)} KG`}
              />
            </div>

            <div className="space-y-3">
              <div className="text-sm font-black uppercase tracking-[0.22em] text-content-2">
                BOM snapshot
              </div>
              <ScrollArea className="max-h-[18rem] pr-2">
                <div className="space-y-2">
                  {bomRows.length === 0 ? (
                    <div className="rounded-[1.35rem] border border-dashed border-line bg-surface-2 px-4 py-8 text-sm text-content-3">
                      No BOM components resolved yet.
                    </div>
                  ) : (
                    bomRows.map((component, index) => (
                      <div
                        key={`${component.material_name}-${index}`}
                        className="flex items-center justify-between rounded-[1.15rem] border border-line bg-surface-1 px-4 py-3 text-sm"
                      >
                        <span className="font-medium text-content-2">
                          {component.material_name}
                        </span>
                        <span className="font-black text-content-1">
                          {formatNumber(asNumber(component.qty, 0), 3)}{" "}
                          {component.uom}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </div>
          </>
        ) : (
          <div className="rounded-[1.4rem] border border-dashed border-line bg-surface-2 px-4 py-8 text-sm text-content-3">
            Preview will appear once the draft has a LIVE template, resolved
            layer stack, and valid geometry.
          </div>
        )}
      </section>
    </aside>
  );
}

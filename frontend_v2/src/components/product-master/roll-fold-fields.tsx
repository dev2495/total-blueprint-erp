"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { pouchStyleService, type PouchStyle } from "@/services/pouch-style";
import type { ProductMasterSize } from "@/services/product-master";

/** Older roll form picker values ↔ the roll's stock form. */
const ROLL_FORM_BY_STOCK_FORM: Record<string, string> = {
  OPEN_WEB: "FLAT",
  FOLDED_WEB: "FOLDED",
  LAYFLAT_TUBE: "TUBING",
};

const FOLD_FIELDS = [
  { key: "flap_mm", label: "Flap (mm)" },
  { key: "seal_mm", label: "Seal (mm)" },
  { key: "trim_mm", label: "Fold trim (mm)" },
] as const;

type Fold = { flap_mm: number; seal_mm: number; trim_mm: number };

function readFold(raw: unknown): Fold {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    flap_mm: Number(src.flap_mm || 0),
    seal_mm: Number(src.seal_mm || 0),
    trim_mm: Number(src.trim_mm || 0),
  };
}

function styleFold(style: PouchStyle): Fold {
  const form = String(style.default_stock_form || "OPEN_WEB").toUpperCase();
  return readFold((style.stock_form_options || {})[form]);
}

/**
 * Roll style + fold for a roll size. A roll style sets the form and fold in one pick; without a
 * style the Roll form picker decides and the fold is typed here. The folding step reads the fold:
 * it takes open rolls of 2W + flap + seal + trim and puts out the folded / tube roll of width W.
 */
export function RollFoldFields({
  row,
  rollForm,
  onPatch,
}: {
  row: ProductMasterSize;
  rollForm: string;
  onPatch: (patch: Partial<ProductMasterSize>) => void;
}) {
  const { data: rollStyles = [] } = useQuery({
    queryKey: ["pouch-styles", "roll-styles", "approved"],
    queryFn: () =>
      pouchStyleService.list({
        page_size: 200,
        deprecated: false,
        locked: true,
        style_for: "ROLL",
      }),
    staleTime: 60_000,
  });
  const geometry =
    row.geometry_config && typeof row.geometry_config === "object" ? row.geometry_config : {};
  const fold = readFold(geometry.fold);
  const folded = rollForm === "FOLDED" || rollForm === "TUBING";
  const selectedId = String(row.pouch_style_master || "");
  const width = Number(row.roll_width_mm || row.width_mm || 0);
  const openWidth = width > 0 ? 2 * width + fold.flap_mm + fold.seal_mm + fold.trim_mm : 0;

  const pickStyle = (id: string) => {
    if (id === "NONE") {
      onPatch({
        pouch_style_master: null,
        geometry_config: { ...geometry, fold_source: undefined },
      } as Partial<ProductMasterSize>);
      return;
    }
    const style = rollStyles.find((s) => s.id === id);
    if (!style) return;
    const form = String(style.default_stock_form || "OPEN_WEB").toUpperCase();
    const nextRollForm = ROLL_FORM_BY_STOCK_FORM[form] || "FLAT";
    onPatch({
      pouch_style_master: style.id,
      roll_form: nextRollForm,
      geometry_config: {
        ...geometry,
        roll_form: nextRollForm,
        fold: styleFold(style),
        fold_source: "style",
      },
    } as Partial<ProductMasterSize>);
  };

  const patchFold = (key: keyof Fold, value: number) => {
    onPatch({
      geometry_config: {
        ...geometry,
        fold: { ...fold, [key]: Math.max(0, value) },
        fold_source: "size",
      },
    });
  };

  return (
    <div className="col-span-2 space-y-2 lg:col-span-4" data-testid="roll-fold-fields">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <label className="space-y-1">
          <span className="text-[12px] font-semibold text-content-3">Roll style</span>
          <Select value={selectedId || "NONE"} onValueChange={pickStyle}>
            <SelectTrigger className="h-8 rounded-lg text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="NONE">None (use Roll form)</SelectItem>
              {rollStyles.map((style) => (
                <SelectItem key={style.id} value={style.id}>
                  {style.name} · {style.code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        {folded
          ? FOLD_FIELDS.map((field) => (
              <label key={field.key} className="space-y-1">
                <span className="text-[12px] font-semibold text-content-3">{field.label}</span>
                <Input
                  type="number"
                  min={0}
                  className="h-8 rounded-lg text-right text-xs"
                  value={fold[field.key]}
                  onChange={(event) => patchFold(field.key, Number(event.target.value || 0))}
                />
              </label>
            ))
          : null}
      </div>
      {folded && width > 0 ? (
        <div className="rounded-lg bg-surface-2 px-3 py-1.5 text-caption text-content-2 ring-1 ring-line">
          {rollForm === "TUBING" ? "Tube" : "Folded"} {width} mm
          {fold.flap_mm > 0 ? ` + ${fold.flap_mm} flap` : ""} is made from{" "}
          <b>{openWidth} mm</b> open web (2 × {width} + flap {fold.flap_mm} + seal{" "}
          {fold.seal_mm} + trim {fold.trim_mm}).
        </div>
      ) : null}
    </div>
  );
}

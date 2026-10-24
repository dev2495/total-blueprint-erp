"use client";

import { mmWithInches } from "@/lib/size-naming";
// Right rail for live geometry, material BOM, lane-up, and readiness evidence.

import * as React from "react";
import { PackageSearch } from "lucide-react";
import { cn } from "@/lib/utils";
import { CheckRow, StatTile } from "@/components/plate/steps";
import type { Addon } from "@/services/master-data";
import type {
  PreviewBomResult,
  ProductMasterSize,
} from "@/services/product-master";

export interface SalesPreviewRailProps {
  preview: PreviewBomResult | null;
  loading?: boolean;
  masterCode?: string;
  sizeCode?: string;
  qty: number;
  uom: string;
  lane: {
    childTargetMm: number;
    laneCount: number;
    plannedParentMm: number;
    trimMm: number;
    remainderMm?: number;
    remainderDisposition?: string;
  };
  readiness: Array<{ label: string; ok: boolean; hint?: string }>;
  printCapable?: boolean;
  artworkDeferred?: boolean;
  selectedAddons?: Addon[];
  selectedSize?: ProductMasterSize;
}

function fmtNum(n: number | string | null | undefined, max = 0): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: max }).format(
    v,
  );
}

function fmtWeightSmart(qty: number | null | undefined, uom?: string): string {
  const u = String(uom || "KG").toUpperCase();
  const n = Number(qty || 0);
  if (u !== "KG")
    return `${fmtNum(n, Math.abs(n) < 100 ? 1 : 0)} ${u.toLowerCase()}`;
  if (!Number.isFinite(n) || n === 0) return "0 kg";
  if (Math.abs(n) >= 1)
    return `${fmtNum(n, Math.abs(n) >= 1000 ? 3 : 4)} kg`;
  const g = n * 1000;
  if (Math.abs(g) >= 1) return `${g.toFixed(Math.abs(g) >= 100 ? 0 : 1)} g`;
  return `${(g * 1000).toFixed(0)} mg`;
}

type BomCategory =
  | "GRANULE"
  | "FILM"
  | "INK"
  | "CHEMICAL"
  | "ADDON"
  | "POD"
  | "INNER_POUCH"
  | "PACKAGING"
  | "OTHER";

type BomRow = {
  cat: BomCategory;
  code: string;
  name: string;
  qty: number;
  uom: string;
  source: string;
  step?: string;
  swatchHex?: string;
  basis?: string;
  note?: string;
  stockQty?: number;
  stockUom?: string;
  supplyMode?: string;
  producedByVariant?: boolean;
  stockConversionMissing?: boolean;
  theoreticalQty?: number;
  plannedIssueQty?: number;
  policySource?: string;
  policyMode?: string;
  placeholder?: boolean;
  /** Film made in the plant from granules: shown, never added to totals. */
  madeInHouse?: boolean;
};

const CATEGORY_ORDER: BomCategory[] = [
  "GRANULE",
  "FILM",
  "INK",
  "CHEMICAL",
  "ADDON",
  "POD",
  "INNER_POUCH",
  "PACKAGING",
  "OTHER",
];

const EXPLICIT_CATEGORY: Record<string, BomCategory> = {
  FILM: "FILM",
  FILM_VARIANT: "FILM",
  FILM_FAMILY: "FILM",
  GRANULE: "GRANULE",
  INK: "INK",
  ADHESIVE: "CHEMICAL",
  SOLVENT: "CHEMICAL",
  CHEMICAL: "CHEMICAL",
  ADH: "CHEMICAL",
  ADDON: "ADDON",
  POD: "POD",
  INNER_POUCH: "INNER_POUCH",
  PACKAGING: "PACKAGING",
};

function matchCategory(cat: string, code = "", name = ""): BomCategory {
  // A category the backend states wins over guessing from the code or name
  // (an "LDPE ... film" is film, not granules).
  const explicit = EXPLICIT_CATEGORY[String(cat || "").trim().toUpperCase()];
  if (explicit) return explicit;
  const hay = `${cat} ${code} ${name}`.toUpperCase();
  if (/^POD$|POD[_-]/.test(hay)) return "POD";
  if (/INK|PIGMENT|COLOR|COLOUR/.test(hay)) return "INK";
  if (/GRANULE|RESIN|MASTERBATCH|MB[_-]|LLDPE|LDPE|HDPE|POLYMER/.test(hay))
    return "GRANULE";
  if (/ADHESIVE|GLUE|SOLVENT|THINNER|CHEM/.test(hay)) return "CHEMICAL";
  if (/ADDON/.test(hay)) return "ADDON";
  if (/INNER[_-]?POUCH|PRIMARY\s+INNER|^IP[_-]/.test(hay)) return "INNER_POUCH";
  if (/GUNNY|GONNY|SHEET|CARTON|BOX|TAPE|LABEL|TAG|PACKAGING/.test(hay))
    return "PACKAGING";
  if (/FILM|PE\b|PET\b|PP\b|BOPP|MET|LAMINATE/.test(hay)) return "FILM";
  return "OTHER";
}

const CAT_CHIP: Record<BomCategory, string> = {
  GRANULE: "bg-success-bg text-success-fg ring-success-border",
  FILM: "bg-info-bg text-primary ring-info-border",
  INK: "bg-order-bg text-order-fg ring-order-border",
  CHEMICAL: "bg-info-bg text-info-fg ring-info-border",
  ADDON: "bg-danger-bg text-danger-fg ring-danger-border",
  POD: "bg-order-bg text-order-fg ring-order-border",
  INNER_POUCH: "bg-warning-bg text-warning-fg ring-warning-border",
  PACKAGING: "bg-success-bg text-success-fg ring-success-border",
  OTHER: "bg-surface-2 text-content-3 ring-line",
};
const CAT_LABEL: Record<BomCategory, string> = {
  GRANULE: "GRANULE",
  FILM: "FILM",
  INK: "INK",
  CHEMICAL: "ADH",
  ADDON: "ADDON",
  POD: "POD",
  INNER_POUCH: "PACK",
  PACKAGING: "PACK",
  OTHER: "OTHER",
};
const CAT_TITLE: Record<BomCategory, string> = {
  GRANULE: "Granules",
  FILM: "Film",
  INK: "Ink colors",
  CHEMICAL: "Adhesive / chemicals",
  ADDON: "Add-ons",
  POD: "POD",
  INNER_POUCH: "Inner pouch",
  PACKAGING: "Packing",
  OTHER: "Other",
};

function num(...vals: any[]): number {
  for (const v of vals) {
    const n = Number(v);
    if (Number.isFinite(n) && n !== 0) return n;
  }
  return 0;
}

function arr(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function pickText(...vals: unknown[]): string {
  for (const value of vals) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value))
      return String(value);
  }
  return "";
}

function rowCode(row: any): string {
  return pickText(
    row?.material_code,
    row?.code,
    row?.material_id,
    row?.id,
    "UNMAPPED",
  );
}

function rowName(row: any): string {
  return pickText(
    row?.material_name,
    row?.name,
    row?.description,
    rowCode(row),
    "Material",
  );
}

function rowQty(row: any): number {
  return num(
    row?.count_qty,
    row?.pack_count_pcs,
    row?.required_qty,
    row?.planned_issue_qty,
    row?.theoretical_qty,
    row?.qty,
    row?.quantity,
    row?.weight_kg,
  );
}

function rowUom(row: any): string {
  return pickText(
    row?.issue_uom,
    row?.uom,
    row?.unit,
    row?.quantity_uom,
    row?.addon_purchase_uom,
    row?.base_uom,
    "KG",
  ).toUpperCase();
}

function makeBomRow(
  row: any,
  source: string,
  category?: BomCategory,
  step?: string,
): BomRow {
  const code = rowCode(row);
  const name = rowName(row);
  const cat =
    category ||
    matchCategory(
      String(
        row?.category_code ||
          row?.category ||
          row?.material_category ||
          row?.type ||
          "",
      ),
      code,
      name,
    );
  const uom = rowUom(row);
  const weightKg = num(row?.weight_kg, row?.weight);
  const stockQty = num(row?.stock_qty, row?.stockQty, weightKg);
  const stockUom = pickText(
    row?.stock_uom,
    row?.stockUom,
    weightKg > 0 ? "KG" : "",
  );
  const pcsPerPack = num(row?.pcs_per_pack);
  const baseUom = pickText(row?.base_uom, row?.baseUom);
  const supplyMode = pickText(row?.supply_mode, row?.supplyMode);
  const producedByVariant = Boolean(
    row?.produced_by_product_variant_id || row?.production_template_id,
  );
  const stockConversionMissing = Boolean(row?.stock_conversion_missing);
  const packagingNoteParts: string[] = [];
  if (cat === "INNER_POUCH" || cat === "PACKAGING") {
    if (stockQty > 0 && stockUom && stockUom.toUpperCase() !== uom) {
      packagingNoteParts.push(`${fmtWeightSmart(stockQty, stockUom)} stock`);
    } else if (weightKg > 0 && uom !== "KG") {
      packagingNoteParts.push(`${fmtWeightSmart(weightKg, "KG")} stock`);
    }
    if (pcsPerPack > 0)
      packagingNoteParts.push(`${fmtNum(pcsPerPack, 0)} pcs/inner`);
    if (supplyMode)
      packagingNoteParts.push(
        supplyMode === "IN_HOUSE"
          ? producedByVariant
            ? "in-house linked"
            : "in-house link missing"
          : supplyMode.toLowerCase(),
      );
    if (row?.counted_in_stock_unit)
      packagingNoteParts.push("evening count");
    else if (
      stockConversionMissing ||
      (cat === "INNER_POUCH" && baseUom && baseUom.toUpperCase() !== "PCS" && stockQty <= 0)
    )
      packagingNoteParts.push(`${baseUom || "stock"} weight missing`);
  }
  return {
    cat,
    code,
    name,
    qty: rowQty(row),
    uom,
    source,
    step,
    basis: pickText(row?.consumption_basis, row?.basis, row?.formula_driver),
    note: packagingNoteParts.length
      ? packagingNoteParts.join(" · ")
      : undefined,
    stockQty: stockQty || undefined,
    stockUom: stockUom || undefined,
    supplyMode: supplyMode || undefined,
    producedByVariant,
    stockConversionMissing,
    theoreticalQty: num(row?.theoretical_qty),
    plannedIssueQty: num(row?.planned_issue_qty),
    policySource: pickText(row?.policy_source),
    policyMode: pickText(row?.effective_issue_policy_mode, row?.template_issue_policy_mode),
    madeInHouse:
      cat === "FILM" &&
      ["EXTRUDE", "IN_HOUSE", "MAKE"].includes(String(row?.source || row?.supply || "").toUpperCase()),
  };
}

function pushBomRow(rows: BomRow[], row: BomRow) {
  const identity = (candidate: BomRow) =>
    candidate.cat === "ADDON" ||
    candidate.cat === "INNER_POUCH" ||
    candidate.cat === "PACKAGING"
      ? `${candidate.cat}|${candidate.code}`
      : `${candidate.cat}|${candidate.code}|${candidate.uom}`;
  const key = identity(row);
  const existing = rows.find((candidate) => identity(candidate) === key);
  if (!existing) {
    rows.push(row);
    return;
  }
  if (existing.source === "plan" && row.source === "selected") {
    if (!existing.note && row.note) existing.note = row.note;
    return;
  }
  if ((existing.placeholder && !row.placeholder) || row.source === "selected") {
    Object.assign(existing, row);
    return;
  }
  if (!existing.qty && row.qty) existing.qty = row.qty;
}

function collectBomRows(
  preview: PreviewBomResult,
  {
    artworkDeferred,
    totalKg = 0,
    selectedAddons = [],
    selectedSize,
    qty = 0,
    uom = "KG",
    unitWeightG = 0,
  }: {
    artworkDeferred?: boolean;
    totalKg?: number;
    selectedAddons?: Addon[];
    selectedSize?: ProductMasterSize;
    qty?: number;
    uom?: string;
    unitWeightG?: number;
  } = {},
): BomRow[] {
  const rows: BomRow[] = [];
  const bom: any = preview.bom || {};
  const snapshot: any = (preview as any).bom_snapshot || {};
  const canonicalPlanLines = [
    ...arr(bom.planning_lines),
    ...arr(snapshot.planning_lines),
  ];

  for (const line of canonicalPlanLines)
    pushBomRow(rows, makeBomRow(line, "plan"));

  if (!canonicalPlanLines.length) {
    for (const step of arr((preview as any).bom_by_step)) {
      const stepName = pickText(step?.step_name, step?.name, step?.code);
      for (const line of [
        ...arr(step?.lines),
        ...arr(step?.materials),
        ...arr(step?.planning_lines),
      ]) {
        pushBomRow(rows, makeBomRow(line, "step", undefined, stepName));
      }
    }

    const buckets: Array<[string, BomCategory]> = [
      ["granules", "GRANULE"],
      ["films", "FILM"],
      ["inks", "INK"],
      ["chemicals", "CHEMICAL"],
      ["addons", "ADDON"],
      ["pod", "POD"],
      ["packaging", "PACKAGING"],
    ];
    for (const source of [bom, snapshot]) {
      for (const [key, category] of buckets) {
        for (const line of arr(source?.[key]))
          pushBomRow(rows, makeBomRow(line, key, category));
      }
    }
  }

  for (const line of arr((preview as any).addons_snapshot))
    pushBomRow(rows, makeBomRow(line, "add-on", "ADDON"));
  for (const addon of selectedAddons)
    pushBomRow(
      rows,
      selectedAddonBomRow(addon, selectedSize, qty, uom, unitWeightG),
    );
  for (const line of arr((preview as any).pod_lines))
    pushBomRow(rows, makeBomRow(line, "pod", "POD"));
  for (const line of arr((preview as any).packaging_lines)) {
    const category = String(line?.kind || line?.role || "")
      .toUpperCase()
      .includes("INNER")
      ? "INNER_POUCH"
      : matchCategory("PACKAGING", rowCode(line), rowName(line));
    pushBomRow(rows, makeBomRow(line, "packing", category));
  }

  const layers = arr(preview.layer_snapshot);
  const hasSubstrate = rows.some(
    (row) => row.cat === "GRANULE" || row.cat === "FILM",
  );
  if (!hasSubstrate && layers.length) {
    const totalThickness = layers.reduce(
      (sum, layer) => sum + num(layer?.thickness_micron, layer?.thickness),
      0,
    );
    for (const layer of layers) {
      const thickness = num(layer?.thickness_micron, layer?.thickness);
      const qty =
        totalKg > 0 && totalThickness > 0
          ? (totalKg * thickness) / totalThickness
          : 0;
      pushBomRow(rows, {
        cat: "FILM",
        code: pickText(
          layer?.material_code,
          layer?.film_variant_code,
          layer?.film_variant,
          `L${rows.length + 1}`,
        ),
        name: pickText(
          layer?.material_name,
          layer?.film_variant_name,
          layer?.film_variant,
          "Layer film",
        ),
        qty,
        uom: "KG",
        source: "layer",
        step: pickText(layer?.layer_code, layer?.layer),
        placeholder: qty <= 0,
      });
    }
  }

  const printing: any = (preview as any).printing_snapshot || {};
  const colors = arr(printing.color_names).length
    ? arr(printing.color_names)
    : [...arr(printing.front_colors), ...arr(printing.back_colors)];
  const hasInk = rows.some((row) => row.cat === "INK");
  if (!artworkDeferred && !hasInk && colors.length) {
    const qty = num(printing.ink_gsm_total, printing.ink_gsm);
    pushBomRow(rows, {
      cat: "INK",
      code: "INK-THEORY",
      name: "Theoretical printing ink",
      qty,
      uom: "GSM",
      source: "artwork gsm",
      placeholder: qty <= 0,
    });
  }

  return rows
    .filter((row) => !(artworkDeferred && row.cat === "INK"))
    .sort(
      (a, b) =>
        CATEGORY_ORDER.indexOf(a.cat) - CATEGORY_ORDER.indexOf(b.cat) ||
        a.code.localeCompare(b.code),
    );
}

function selectedAddonBomRow(
  addon: Addon,
  selectedSize: ProductMasterSize | undefined,
  qty: number,
  uom: string,
  unitWeightG: number,
): BomRow {
  const purchaseUom = String(
    addon.addon_purchase_uom || addon.base_uom || "PCS",
  ).toUpperCase();
  const pieces = orderedPieces(qty, uom, unitWeightG);
  const mode = String(addon.weight_mode || "").toUpperCase();
  const dimensionMm = Math.max(
    0,
    Number(selectedSize?.width_mm || selectedSize?.height_mm || 0),
  );
  let requiredQty = pieces;
  let note = "per pouch";

  if (mode === "PER_MM" && dimensionMm > 0) {
    requiredQty =
      purchaseUom === "METER"
        ? (dimensionMm * pieces) / 1000
        : (Number(addon.weight_value || 0) * dimensionMm * pieces) / 1000;
    note =
      purchaseUom === "METER"
        ? `${fmtNum(dimensionMm, 0)} mm run/pouch`
        : `${fmtNum(Number(addon.weight_value || 0), 3)} g/mm`;
  } else if (mode === "PER_PIECE") {
    requiredQty =
      purchaseUom === "KG"
        ? (Number(addon.weight_value || 0) * pieces) / 1000
        : pieces;
    note =
      purchaseUom === "KG"
        ? `${fmtNum(Number(addon.weight_value || 0), 3)} g/pouch`
        : "1 per pouch";
  } else if (mode === "FIXED") {
    requiredQty =
      purchaseUom === "KG" ? Number(addon.weight_value || 0) : pieces;
    note = "fixed/add-on rule";
  }

  return {
    cat: "ADDON",
    code: addon.code,
    name: addon.name || addon.code,
    qty: requiredQty,
    uom: purchaseUom,
    source: "selected",
    step: "Add-ons",
    basis: mode || "ADDON",
    note:
      purchaseUom === "PCS"
        ? `${fmtNum(pieces, 0)} pouch pcs; no weight required`
        : note,
    placeholder: requiredQty <= 0,
  };
}

function orderedPieces(qty: number, uom: string, unitWeightG: number) {
  const amount = Number(qty || 0);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (String(uom || "").toUpperCase() === "PCS") return amount;
  return unitWeightG > 0 ? (amount * 1000) / unitWeightG : 0;
}

function collectBomIssues(preview: PreviewBomResult): string[] {
  const bom: any = preview.bom || {};
  return [
    ...arr((preview as any).pre_submit_blockers),
    ...arr((preview as any).blockers),
    ...arr((preview as any).errors),
    ...arr(bom.errors),
    ...arr(bom.warnings),
  ]
    .map((issue) =>
      typeof issue === "string"
        ? issue
        : pickText(issue?.message, issue?.detail),
    )
    .filter(Boolean);
}

function collectStepGroups(rows: BomRow[]) {
  const groups: Array<{ step: string; rows: BomRow[] }> = [];
  for (const row of rows) {
    const step =
      row.step ||
      (row.cat === "INK"
        ? "Printing"
        : row.cat === "CHEMICAL"
          ? "Lamination"
          : row.cat === "INNER_POUCH" || row.cat === "PACKAGING"
            ? "Packing"
            : row.cat === "ADDON"
              ? "Add-ons"
              : row.cat === "POD"
                ? "POD"
                : "Material plan");
    let group = groups.find((item) => item.step === step);
    if (!group) {
      group = { step, rows: [] };
      groups.push(group);
    }
    group.rows.push(row);
  }
  return groups;
}

function displayTotalForGroup(rows: BomRow[]) {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (row.placeholder || row.madeInHouse || !Number.isFinite(row.qty)) continue;
    const uom = String(row.uom || "").toUpperCase();
    if (!uom || uom === "MAP") continue;
    totals.set(uom, (totals.get(uom) || 0) + row.qty);
  }
  return Array.from(totals.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([uom, qty]) => fmtWeightSmart(qty, uom))
    .join(" + ");
}

function BomLineRow({ row }: { row: BomRow }) {
  return (
    <div
      className={cn(
        "grid grid-cols-[1fr_auto] items-center gap-2 border-t border-line px-3 py-2 text-[12.5px] font-medium",
        row.madeInHouse && "opacity-70",
      )}
      title={row.madeInHouse ? "Made in the plant from the granules above; not added to the totals." : undefined}
    >
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          {row.swatchHex ? (
            <span
              className="h-3 w-3 shrink-0 rounded-full border border-line"
              style={{ background: row.swatchHex }}
            />
          ) : null}
          <span className="truncate font-mono text-content-1">{row.code}</span>
          <span
            className={cn(
              "shrink-0 rounded px-1.5 py-0.5 text-caption font-semibold ring-1",
              CAT_CHIP[row.cat],
            )}
          >
            {CAT_LABEL[row.cat]}
          </span>
        </div>
        <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-content-3">
          <span className="truncate">{row.name}</span>
          {row.basis ? (
            <span className="shrink-0 rounded bg-surface-2 px-1">
              {row.basis}
            </span>
          ) : null}
          {row.madeInHouse ? (
            <span className="shrink-0 rounded bg-surface-2 px-1 text-content-3">
              made here · not added
            </span>
          ) : null}
          {row.note ? (
            <span className="shrink-0 rounded bg-warning-bg px-1 text-warning-fg">
              {row.note}
            </span>
          ) : null}
          <span
            className={cn(
              "shrink-0 rounded px-1",
              row.placeholder
                ? "bg-warning-bg text-warning-fg"
                : "bg-info-bg text-primary",
            )}
          >
            {row.source}
          </span>
          {row.policySource ? (
            <span className="shrink-0 rounded bg-success-bg px-1 text-success-fg">
              {row.policySource.replace(/_/g, " ")}
            </span>
          ) : null}
        </div>
        {row.theoreticalQty || row.plannedIssueQty ? (
          <div className="mt-0.5 text-[11px] text-content-3">
            theory {fmtWeightSmart(row.theoreticalQty || 0, row.uom)} · issue{" "}
            {fmtWeightSmart(row.plannedIssueQty || row.qty, row.uom)}
            {row.policyMode ? ` · ${row.policyMode.replace(/_/g, " ")}` : ""}
          </div>
        ) : null}
      </div>
      <div className="text-right font-mono tabular-nums text-content-2">
        {row.placeholder ? "mapped" : fmtWeightSmart(row.qty, row.uom)}
      </div>
    </div>
  );
}

function rollTypeLabel(preview: PreviewBomResult): string {
  const g: any = preview.geometry_snapshot || {};
  const kind = String(
    (preview as any).finished_good_type ||
      (preview as any).fg_type ||
      (preview as any).product_kind ||
      g.finished_good_type ||
      g.fg_type ||
      g.product_kind ||
      g.kind ||
      "",
  ).toUpperCase();
  const raw = pickText(
    g.stock_form,
    g.width_basis,
    g.roll_type,
    g.roll_form,
    g.web_form,
    g.film_form,
    g.pouch_style_web_form,
    (preview as any).roll_type,
    (preview as any).roll_form,
  );
  if (raw) return normalizeRollType(raw);
  const style = String(
    g.pouch_style_master_code || g.pouch_style_master || g.pouch_style || "",
  ).toUpperCase();
  if (/TUBE|TUBING/.test(style)) return "Tube";
  if (/OPEN|WEB|SHEET|FLAT/.test(style)) return "Open web";
  if (kind === "ROLL") return "Roll";
  if (kind === "POUCH") {
    if (/CENTER|CENTRE|SEAL|TUB/.test(style)) return "Tube";
    return "Open web";
  }
  return "";
}

function normalizeRollType(value: string) {
  const raw = value.trim().replace(/[_-]+/g, " ");
  const upper = raw.toUpperCase();
  if (
    upper.includes("LAYFLAT") ||
    upper.includes("TUBE") ||
    upper.includes("TUBING")
  )
    return "Tube / layflat";
  if (upper.includes("FOLD")) return "Folded web";
  if (upper.includes("OPEN") && upper.includes("WEB")) return "Open web";
  if (upper === "OPEN") return "Open web";
  if (upper.includes("SHEET")) return "Sheet";
  if (upper.includes("WIDTH BASIS"))
    return raw.replace(/\b\w/g, (letter) => letter.toUpperCase());
  return raw.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function rollCalcAxisLabel(preview: PreviewBomResult) {
  const g: any = preview.geometry_snapshot || {};
  const axis = String(
    g.pouch_style_roll_axis || g.trim_apply_to || g.width_basis || "",
  ).toUpperCase();
  const pitchAxis = String(g.consumption_pitch_axis || "").toUpperCase();
  const pitchMm = Number(g.consumption_pitch_mm || 0);
  const webLabel =
    axis === "WIDTH"
      ? "width"
      : axis === "HEIGHT"
        ? "height"
        : axis.toLowerCase();
  const pitchLabel =
    pitchAxis === "WIDTH"
      ? "width"
      : pitchAxis === "HEIGHT"
        ? "height"
        : "cut";
  if ((axis === "WIDTH" || axis === "HEIGHT") && pitchMm > 0)
    return `Web from ${webLabel} · ${pitchLabel} pitch ${fmtNum(pitchMm, 2)} mm`;
  if (axis === "WIDTH") return "Web from width";
  if (axis === "HEIGHT") return "Web from height";
  if (axis === "BOTH") return "Width + height";
  if (axis === "OPEN_WEB_WIDTH") return "Open-web width";
  if (axis === "LAYFLAT_WIDTH") return "Layflat width";
  if (axis === "FOLDED_WIDTH") return "Folded width";
  return axis ? normalizeRollType(axis) : "Size formula";
}

function Visual({ preview }: { preview: PreviewBomResult }) {
  const gradientId = React.useId().replace(/:/g, "");
  const g: any = preview.geometry_snapshot || {};
  const kind = String(
    (preview as any).finished_good_type ||
      (preview as any).fg_type ||
      (preview as any).product_kind ||
      g.fg_type ||
      g.product_kind ||
      g.kind ||
      "POUCH",
  ).toUpperCase();
  const width = num(g.width_mm, g.final_width_mm, g.size_width_mm, g.width);
  const height = num(
    g.height_mm,
    g.final_height_mm,
    g.size_height_mm,
    g.height,
  );
  const rollWidth = num(g.roll_width_mm, g.roll_width);
  const styleCode = String(
    g.pouch_style_master_code || g.pouch_style_master || g.pouch_style || "",
  ).toUpperCase();
  const gussetMm = num(g.gusset_mm, g.bottom_gusset_mm);
  const isStandup = /STAND|ZIP|BOTTOM/.test(styleCode) || gussetMm > 0;
  return (
    <div className="grid place-items-center rounded-[12px] bg-surface-2 py-2">
      {kind === "ROLL" ? (
        <svg
          viewBox="0 0 140 110"
          width="120"
          height="94"
          className="max-w-full"
        >
          <ellipse
            cx="38"
            cy="55"
            rx="14"
            ry="44"
            fill="var(--film-pet)"
            stroke="var(--plate-fg-3)"
            strokeWidth="1.2"
          />
          <rect
            x="38"
            y="11"
            width="74"
            height="88"
            fill="var(--film-pet)"
            stroke="var(--plate-fg-3)"
            strokeWidth="1.2"
          />
          <ellipse
            cx="112"
            cy="55"
            rx="14"
            ry="44"
            fill="var(--film-met)"
            stroke="var(--plate-fg-3)"
            strokeWidth="1.2"
          />
          <ellipse
            cx="112"
            cy="55"
            rx="6"
            ry="18"
            fill="var(--surface-1)"
            stroke="var(--plate-fg-3)"
            strokeWidth="0.9"
            opacity="0.9"
          />
          {rollWidth > 0 ? (
            <text
              x="75"
              y="107"
              textAnchor="middle"
              fontSize="8"
              fill="var(--text-3)"
              fontWeight="700"
            >
              {rollWidth} mm
            </text>
          ) : null}
        </svg>
      ) : (
        <svg
          viewBox="0 0 180 190"
          width="132"
          height="140"
          className="max-w-full"
          role="img"
          aria-label="Pouch preview"
        >
          <defs>
            <linearGradient
              id={`spr-${gradientId}`}
              x1="0"
              x2="1"
              y1="0"
              y2="1"
            >
              <stop offset="0%" stopColor="var(--film-pet)" />
              <stop offset="55%" stopColor="var(--film-met)" />
              <stop offset="100%" stopColor="var(--film-pe)" />
            </linearGradient>
          </defs>
          <path
            d="M 46 18 L 134 18 L 143 28 L 143 165 L 37 165 L 37 28 Z"
            fill={`url(#spr-${gradientId})`}
            stroke="var(--plate-fg-3)"
            strokeWidth="1.4"
          />
          <rect
            x="42"
            y="24"
            width="96"
            height="8"
            rx="2"
            fill="var(--plate-fg-3)"
            opacity="0.28"
          />
          <rect
            x="43"
            y="145"
            width="94"
            height="11"
            rx="3"
            fill="var(--plate)"
            opacity={isStandup ? 0.26 : 0.12}
          />
          {isStandup ? (
            <path
              d="M 48 159 C 71 171 109 171 132 159"
              fill="none"
              stroke="var(--plate)"
              strokeWidth="1.3"
              opacity="0.5"
            />
          ) : null}
          {width > 0 ? (
            <text
              x="90"
              y="181"
              textAnchor="middle"
              fontSize="8"
              fill="var(--text-3)"
              fontWeight="700"
            >
              {width} mm
            </text>
          ) : null}
          {height > 0 ? (
            <text
              x="16"
              y="103"
              fontSize="8"
              fill="var(--text-3)"
              fontWeight="700"
              transform="rotate(-90 16 103)"
            >
              {height} mm
            </text>
          ) : null}
        </svg>
      )}
    </div>
  );
}

export function SalesPreviewRail({
  preview,
  loading,
  masterCode,
  sizeCode,
  qty,
  uom,
  lane,
  readiness,
  printCapable,
  artworkDeferred,
  selectedAddons = [],
  selectedSize,
}: SalesPreviewRailProps) {
  const card = "grid gap-3";
  const label = "text-[12px] font-semibold text-content-2";

  if (!preview) {
    return (
      <aside className="grid gap-4">
        <div className="grid min-h-[200px] place-items-center rounded-[14px] border border-dashed border-line-strong px-4 text-center">
          <div>
            <PackageSearch className="mx-auto h-7 w-7 text-content-4" aria-hidden />
            <div className="mt-2 text-[14px] font-semibold text-content-2">
              {loading ? "Working out the material plan…" : "Live preview"}
            </div>
            <p className="mx-auto mt-1 max-w-[240px] text-[12.5px] text-content-3">
              Weight per pouch, the material list and the lane plan appear here once the product and size are picked.
            </p>
          </div>
        </div>
        <ReadinessBlock readiness={readiness} label={label} />
      </aside>
    );
  }

  const g: any = preview.geometry_snapshot || {};
  const width = num(g.width_mm, g.final_width_mm, g.size_width_mm, g.width);
  const height = num(
    g.height_mm,
    g.final_height_mm,
    g.size_height_mm,
    g.height,
  );
  const totalUm = num(
    g.thickness_um,
    g.thickness_micron,
    (preview.layer_snapshot || []).reduce(
      (s: number, l: any) => s + (Number(l?.thickness_micron) || 0),
      0,
    ),
  );
  const childWeb = num(
    lane.childTargetMm,
    g.child_target_width_mm,
    g.target_child_width_mm,
    g.roll_width_mm,
  );
  const unitG = num(preview.unit_weight_g);
  const totalKg = num(preview.total_weight_kg);
  const pouches =
    String(uom || "").toUpperCase() === "PCS"
      ? Number(qty || 0)
      : unitG > 0 && totalKg > 0
        ? Math.round((totalKg * 1000) / unitG)
        : 0;
  const rollType = rollTypeLabel(preview);
  const calcAxis = rollCalcAxisLabel(preview);
  const masterSizeLabel = [masterCode, sizeCode].filter(Boolean).join(" · ");

  const rows = collectBomRows(preview, {
    artworkDeferred,
    totalKg,
    selectedAddons,
    selectedSize,
    qty,
    uom,
    unitWeightG: unitG,
  });
  const substrateSubtotal = rows
    .filter(
      (r) =>
        (r.cat === "GRANULE" || r.cat === "FILM") &&
        String(r.uom).toUpperCase() === "KG" &&
        !r.placeholder &&
        !r.madeInHouse,
    )
    .reduce((s, r) => s + (Number.isFinite(r.qty) ? r.qty : 0), 0);
  const lanePct =
    lane.plannedParentMm > 0
      ? Math.min(
          100,
          Math.round(
            ((childWeb * lane.laneCount) / lane.plannedParentMm) * 100,
          ),
        )
      : 100;
  const readinessOk = readiness.filter((item) => item.ok).length;
  const realRows = rows.filter((row) => !row.placeholder).length;
  const materialFamilies = new Set(rows.map((row) => row.cat)).size;
  const inkRows = rows.filter((row) => row.cat === "INK");
  const packRows = rows.filter(
    (row) => row.cat === "INNER_POUCH" || row.cat === "PACKAGING",
  );
  const packSummary = displayTotalForGroup(packRows);
  const firstPackNote = pickText(...packRows.map((row) => row.note));
  const bomIssues = collectBomIssues(preview);
  const stepGroups = collectStepGroups(rows);
  const groupedRows = CATEGORY_ORDER.map((category) => ({
    category,
    rows: rows.filter((row) => row.cat === category),
  })).filter((group) => group.rows.length);

  return (
    <aside className="grid gap-5">
      <ReadinessBlock readiness={readiness} label={label} />

      <div className={card}>
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className={label}>Live preview</div>
            {masterSizeLabel ? (
              <div className="truncate font-mono text-[11.5px] text-content-4">
                {masterSizeLabel}
              </div>
            ) : null}
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-success-bg px-2 py-0.5 text-[11.5px] font-medium text-success-fg">
            <span className="h-1.5 w-1.5 rounded-full bg-success-fg" /> live
          </span>
        </div>
        <div className="grid grid-cols-[112px_minmax(0,1fr)] items-center gap-3">
          <Visual preview={preview} />
          <dl className="grid gap-0 text-[12.5px]">
            {[
              ["W × H", width > 0 ? mmWithInches(width, height || null) : "—"],
              ["Thickness", totalUm > 0 ? `${totalUm} µ` : "—"],
              ["Child web", childWeb > 0 ? `${Math.round(childWeb)} mm` : "—"],
              ["Roll form", rollType || "—"],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2 border-b border-line py-1.5 last:border-b-0">
                <dt className="text-content-3">{k}</dt>
                <dd className="text-right font-medium tabular-nums text-content-1">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <StatTile
            label="Per pouch"
            value={unitG > 0 ? `${fmtNum(unitG, 4)} g` : "—"}
            sub="finished weight"
          />
          <StatTile
            label="Order total"
            value={
              totalKg > 0
                ? fmtWeightSmart(totalKg, "KG")
                : unitG > 0
                  ? "after qty"
                  : "needs unit wt"
            }
            sub={pouches ? `${fmtNum(pouches)} pcs` : "finished goods"}
          />
          <StatTile
            label="Film needed"
            value={substrateSubtotal > 0 ? fmtWeightSmart(substrateSubtotal, "KG") : "—"}
            sub="substrate subtotal"
          />
          <StatTile label="BOM geometry" value={calcAxis} sub={pouches ? `${fmtNum(pouches)} pcs basis` : undefined} />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <StatTile
            label="BOM rows"
            value={rows.length ? `${realRows}/${rows.length}` : "0"}
            sub={rows.length ? `${materialFamilies} families` : "no plan"}
            tone={rows.length && realRows === rows.length ? "plain" : rows.length ? "warn" : "bad"}
          />
          <StatTile
            label="Lane use"
            value={lanePct > 0 ? `${lanePct}%` : "—"}
            sub={lane.plannedParentMm > 0 ? `${lane.laneCount}-up · ${Math.round(lane.plannedParentMm)}` : "pick lane"}
          />
          <StatTile
            label={printCapable ? "Ink map" : "Packing"}
            value={printCapable ? (artworkDeferred ? "later" : `${inkRows.length}`) : packSummary || "—"}
            sub={
              printCapable
                ? inkRows.length
                  ? "colours mapped"
                  : "no ink rows"
                : firstPackNote || "overrides in"
            }
            tone={printCapable && !artworkDeferred && !inkRows.length ? "warn" : "plain"}
          />
        </div>
      </div>

      <div className={card}>
        <div className="flex items-center justify-between gap-2">
          <div className={label}>
            Materials for {fmtNum(qty)} {String(uom || "").toLowerCase()}
          </div>
          <span className="text-[11.5px] text-content-4">material-wise · no cost here</span>
        </div>
        {bomIssues.length ? (
          <div className="rounded-[10px] bg-warning-bg px-3 py-2 text-[12.5px] text-warning-fg">
            {bomIssues.slice(0, 2).join(" · ")}
          </div>
        ) : null}
        {rows.length === 0 ? (
          <div className="rounded-[10px] bg-surface-2 px-3 py-2 text-[12.5px] text-content-3">
            The material list appears once the size and choices are set.
          </div>
        ) : (
          <div className="grid gap-2">
            {stepGroups.length ? (
              <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-content-3">
                <span className="font-medium text-content-2">Issued at</span>
                {stepGroups.map((group) => (
                  <span
                    key={group.step}
                    className="rounded-full bg-surface-2 px-2 py-0.5 text-content-2"
                  >
                    {group.step} · {group.rows.length}
                  </span>
                ))}
              </div>
            ) : null}
            {groupedRows.map((group) => {
              const groupTotal = displayTotalForGroup(group.rows);
              return (
                <details
                  key={group.category}
                  className="group overflow-hidden rounded-[12px] border border-line"
                  open
                >
                  <summary className="grid cursor-pointer list-none grid-cols-[1fr_auto] gap-2 bg-surface-2 px-3 py-1.5 text-[12px] font-semibold text-content-2">
                    <div>{CAT_TITLE[group.category]}</div>
                    <div className="text-right font-medium tabular-nums text-content-3">
                      {groupTotal || `${group.rows.length} rows`}
                    </div>
                  </summary>
                  {group.rows.map((r, i) => (
                    <BomLineRow key={`${r.cat}-${r.code}-${i}`} row={r} />
                  ))}
                </details>
              );
            })}
            {substrateSubtotal > 0 ? (
              <div className="flex items-center justify-between rounded-[12px] bg-surface-2 px-3 py-2 text-[12.5px]">
                <span className="font-medium text-content-2">Substrate subtotal</span>
                <span className="font-semibold tabular-nums text-content-1">
                  {fmtWeightSmart(substrateSubtotal, "KG")}
                </span>
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div className={card}>
        <div className={label}>
          Lane plan · parent{" "}
          {lane.plannedParentMm > 0
            ? `${Math.round(lane.plannedParentMm)} mm`
            : "—"}
        </div>
        <div className="flex h-9 gap-0.5 overflow-hidden rounded-[10px] ring-1 ring-line">
          {Array.from({ length: Math.max(1, lane.laneCount) }).map((_, i) => (
            <div
              key={i}
              className="grid place-items-center bg-plate text-[11.5px] font-medium text-plate-fg"
              style={{ flex: childWeb > 0 ? childWeb : 1 }}
            >
              {lane.laneCount <= 3 ? `${Math.round(childWeb)} mm` : ""}
            </div>
          ))}
          {lane.plannedParentMm > childWeb * lane.laneCount + 1 ? (
            <div
              className="grid flex-1 place-items-center bg-surface-2 text-[11.5px] text-content-3"
              style={{
                flex: Math.max(
                  0.001,
                  lane.plannedParentMm - childWeb * lane.laneCount,
                ),
              }}
            >
              rem
            </div>
          ) : null}
        </div>
        <div className="text-[12px] text-content-3">
          {lane.laneCount}-up · child{" "}
          {childWeb > 0 ? `${Math.round(childWeb)} mm` : "—"} · trim{" "}
          {Math.round(lane.trimMm || 0)} mm
          {lane.remainderMm && lane.remainderMm > 0
            ? ` · rem ${Math.round(lane.remainderMm)} mm ${String(lane.remainderDisposition || "").toLowerCase()}`
            : ""}
        </div>
      </div>
    </aside>
  );
}

function ReadinessBlock({
  readiness,
  label,
}: {
  readiness: Array<{ label: string; ok: boolean; hint?: string }>;
  label: string;
}) {
  const okCount = readiness.filter((item) => item.ok).length;
  return (
    <div className="grid gap-2.5" data-testid="sales-line-readiness">
      <div className="flex items-center justify-between">
        <div className={label}>Line readiness</div>
        <span className={cn("text-[12px] font-medium tabular-nums", okCount === readiness.length ? "text-success-fg" : "text-warning-fg")}>
          {okCount}/{readiness.length}
        </span>
      </div>
      <div className="grid gap-1.5">
        {readiness.map((r, i) => (
          <CheckRow key={i} ok={r.ok} hint={r.hint}>
            {r.label}
          </CheckRow>
        ))}
      </div>
    </div>
  );
}

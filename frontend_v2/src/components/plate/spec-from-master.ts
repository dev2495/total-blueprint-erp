/**
 * Builds the spec plate data from a product master, one of its sizes and the per-layer
 * choices on an order line or stock order. Used where no backend preview exists yet
 * (collapsed order lines, the product master editor, the stock launcher).
 */
import type { LayerTemplateRow, ProductMasterSize } from "@/services/product-master";
import type { SpecBlockData } from "@/components/spine/spec-block";

export interface LayerChoice {
  film_variant_code?: string;
  thickness_micron?: number | null;
  grade?: string;
}

function positive(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function layerRange(row: LayerTemplateRow): string {
  const options = (row.thickness_options || []).map(Number).filter((n) => Number.isFinite(n) && n > 0);
  if (options.length > 1) return `${Math.min(...options)}–${Math.max(...options)} allowed`;
  return "";
}

export function specFromMasterLine({
  layers,
  size,
  choices,
  showRanges = false,
}: {
  layers: LayerTemplateRow[] | null | undefined;
  size?: Partial<ProductMasterSize> | null;
  choices?: Record<number, LayerChoice | undefined> | null;
  showRanges?: boolean;
}): SpecBlockData {
  const rows = (layers || []).map((row, i) => {
    const choice = choices?.[i + 1] || {};
    const code = choice.film_variant_code || row.film_variant_code || "";
    const purchased = !row.grade_options?.length && !row.default_grade;
    return {
      index: i + 1,
      name: code || row.role || `Layer ${i + 1}`,
      micron: positive(choice.thickness_micron ?? row.thickness_micron),
      grade: choice.grade || row.default_grade || "",
      source: purchased ? "PURCHASED" : "",
      note: showRanges ? layerRange(row) : "",
    };
  });
  const style = size?.pouch_style || size?.pouch_style_master_code || "";
  return {
    sizeLabel: size?.label || size?.code || "",
    widthMm: positive(size?.width_mm),
    heightMm: positive(size?.height_mm),
    gussetMm: positive(size?.gusset_mm),
    style: String(style || ""),
    layers: rows,
  };
}

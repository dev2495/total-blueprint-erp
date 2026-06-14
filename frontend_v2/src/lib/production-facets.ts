import { normalizeProductSpec, type ProductSpec } from "@/lib/product-spec";

export const ALL_PRODUCTION_FACET = "__ALL__";

export type ProductionFacetOption = {
  value: string;
  label: string;
  count: number;
};

export type ProductionFacetFilters = {
  material: string;
  grade: string;
  thickness: string;
  size: string;
  process: string;
};

export type ProductionFacetValues = {
  material: string[];
  grade: string[];
  thickness: string[];
  size: string[];
  process: string[];
};

function cleanFacet(value: unknown): string {
  const text = String(value ?? "").trim();
  if (
    !text ||
    text === "-" ||
    text === "—" ||
    ["null", "undefined", "nan"].includes(text.toLowerCase())
  ) {
    return "";
  }
  return text;
}

function numberLabel(value: unknown, suffix: string): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return "";
  const formatted = Number.isInteger(num)
    ? String(num)
    : num.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
  return `${formatted}${suffix}`;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map(cleanFacet).filter(Boolean)));
}

export function productionFacetValues(
  source: unknown,
  context?: unknown,
): ProductionFacetValues {
  const job = (source && typeof source === "object" ? source : {}) as Record<
    string,
    any
  >;
  const spec: ProductSpec = normalizeProductSpec(source, context);
  const layers = Array.isArray(spec.layers) ? spec.layers : [];
  const material = unique(
    layers.flatMap((layer) => [
      cleanFacet(layer.variantCode),
      cleanFacet(layer.variantName),
    ]),
  );
  const grade = unique(layers.map((layer) => cleanFacet(layer.grade)));
  const thickness = unique(
    layers.map((layer) => numberLabel(layer.thicknessMicron, "u")),
  );
  const size = unique([
    cleanFacet(spec.size?.label),
    numberLabel(spec.size?.widthMm, "mm"),
    ...layers.map((layer) => numberLabel(layer.widthMm, "mm")),
  ]);
  const process = unique([
    cleanFacet(job.process_code),
    cleanFacet(job.current_process),
    cleanFacet(job.current_process_name),
    cleanFacet(job.template_name),
  ]);

  return { material, grade, thickness, size, process };
}

export function matchesProductionFacets(
  source: unknown,
  filters: ProductionFacetFilters,
  context?: unknown,
): boolean {
  const values = productionFacetValues(source, context);
  return (Object.keys(filters) as Array<keyof ProductionFacetFilters>).every(
    (key) => {
      const selected = filters[key];
      if (!selected || selected === ALL_PRODUCTION_FACET) return true;
      return values[key].includes(selected);
    },
  );
}

export function buildProductionFacetOptions<T>(
  rows: T[],
  getValues: (row: T) => string[],
): ProductionFacetOption[] {
  const counts = new Map<string, number>();
  rows.forEach((row) => {
    unique(getValues(row)).forEach((value) => {
      counts.set(value, (counts.get(value) || 0) + 1);
    });
  });
  return Array.from(counts.entries())
    .map(([value, count]) => ({ value, label: value, count }))
    .sort((a, b) =>
      a.label.localeCompare(b.label, undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );
}

export function hasProductionFacetFilters(filters: ProductionFacetFilters) {
  return Object.values(filters).some(
    (value) => value && value !== ALL_PRODUCTION_FACET,
  );
}

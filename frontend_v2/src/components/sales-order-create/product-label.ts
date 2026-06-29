import type { CustomerProductOverlay, ProductMaster, ProductMasterSize } from "@/services/product-master";
import type { SalesOrderLine } from "./types";

function text(...values: unknown[]) {
  for (const value of values) {
    const next = String(value ?? "").trim();
    if (next && !["none", "null", "undefined", "nan", "-"].includes(next.toLowerCase())) {
      return next;
    }
  }
  return "";
}

function compactNumber(value: unknown) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return Number(number.toFixed(3)).toString();
}

function codeToken(value: unknown) {
  return text(value).toUpperCase().replace(/\s+/g, "").replace(/_/g, "-");
}

function stripThicknessSuffix(code: string, thickness: unknown) {
  const token = codeToken(code);
  const thick = compactNumber(thickness);
  if (token && thick && token.endsWith(thick) && token.length > thick.length) {
    return token.slice(0, -thick.length).replace(/-$/, "");
  }
  return token;
}

export function compactSizeLabel(size?: ProductMasterSize | null, line?: SalesOrderLine) {
  const width = compactNumber(size?.width_mm);
  const height = compactNumber(size?.height_mm);
  const gusset = compactNumber(size?.gusset_mm);
  if (width && height) return `${width}x${height}${gusset && Number(gusset) > 0 ? `+${gusset}G` : ""}`;
  if (width) return `${width}mm`;
  return codeToken(line?.size_code);
}

export function layerStackLabel(master?: ProductMaster | null, line?: SalesOrderLine) {
  const thicknesses: string[] = [];
  const materials: string[] = [];
  const layerTemplate = (master?.layer_template || []) as Array<Record<string, any>>;
  layerTemplate.forEach((row, index) => {
    const layerNo = index + 1;
    const state = (line?.layer_values?.[layerNo] || {}) as Record<string, any>;
    const thickness = state.thickness_micron ?? row.thickness_micron;
    const thicknessText = compactNumber(thickness);
    if (thicknessText) thicknesses.push(thicknessText);
    const material = stripThicknessSuffix(
      state.film_variant_code || row.film_variant_code || (row as any).material_code || row.role,
      thickness,
    );
    const grade = codeToken(state.grade || row.default_grade);
    if (material) materials.push(grade && !material.includes(grade) ? `${material} ${grade}` : material);
  });
  return {
    thickness: thicknesses.join("+"),
    material: materials.join("/"),
  };
}

function masterChemistryTotal(master?: ProductMaster | null) {
  const fixed = (master?.fixed_attributes || {}) as Record<string, any>;
  const adhesive = Number(
    fixed.adhesive_gsm ?? fixed.adhesive_gsm_total ?? 0,
  );
  const solvent = Number(fixed.solvent_gsm ?? fixed.solvent_gsm_total ?? 0);
  const total =
    (Number.isFinite(adhesive) && adhesive > 0 ? adhesive : 0) +
    (Number.isFinite(solvent) && solvent > 0 ? solvent : 0);
  return total > 0 ? total : 0;
}

function printChemistryLabel(line: SalesOrderLine, master?: ProductMaster | null) {
  const assignment = (line.artwork_assignment || {}) as any;
  const ink = compactNumber(assignment.ink_gsm_total || assignment.ink_gsm);
  const adhesive = compactNumber(masterChemistryTotal(master));
  const parts = [];
  if (ink && Number(ink) > 0) parts.push(`I${ink}`);
  if (adhesive && Number(adhesive) > 0) parts.push(`A&S${adhesive}`);
  return parts.join("/");
}

function printLabel(line: SalesOrderLine) {
  if (line.artwork_mode === "DEFER") return "";
  const assignment = line.artwork_assignment;
  const colors = Number(assignment?.color_count || 0);
  const type = codeToken(assignment?.print_type || line.print_type);
  if (type && colors > 0) return `${type}${colors}C`;
  return type;
}

function catalogLabel(line: SalesOrderLine) {
  const labels: string[] = [];
  if (line.addons?.length) labels.push(...line.addons.map(codeToken).filter(Boolean));
  if (line.axis_values?.pod_variant) labels.push(codeToken(line.axis_values.pod_variant));
  if (line.axis_values?.packaging_inner) labels.push(codeToken(line.axis_values.packaging_inner));
  if (line.inner_pouch_pcs_per_pack) labels.push(`IP${line.inner_pouch_pcs_per_pack}`);
  return Array.from(new Set(labels)).join("+");
}

export function buildSalesLineLabel({
  line,
  master,
  size,
  overlay,
}: {
  line: SalesOrderLine;
  master?: ProductMaster | null;
  size?: ProductMasterSize | null;
  overlay?: CustomerProductOverlay | null;
}) {
  const stack = layerStackLabel(master, line);
  const qty = line.qty_value > 0 ? `${compactNumber(line.qty_value)} ${line.qty_uom}` : "";
  const parts = [
    text(overlay?.customer_display_name, overlay?.customer_item_code, line.line_name, master?.name, "Sales product"),
    compactSizeLabel(size, line),
    stack.thickness,
    stack.material,
    printChemistryLabel(line, master),
    printLabel(line),
    catalogLabel(line),
    qty,
  ];
  return Array.from(new Set(parts.map((part) => String(part || "").trim()).filter(Boolean))).join(" - ");
}

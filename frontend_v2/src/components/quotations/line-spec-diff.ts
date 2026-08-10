// Diff helpers for catalog quote lines vs. their master_snapshot baseline.
//
// A catalog line's `spec_snapshot` mirrors the master's BOM at attach time.
// `master_snapshot` is the immutable reference. We compute a list of paths
// that differ so the UI can render an amber "MODIFIED" chip and let the
// operator can reset the field while preserving the quote-scoped override.

import type {
  QuoteLineSpec,
  BomLayer,
  BomAdhesive,
  BomInk,
  BomAddon,
} from "@/services/quotation";

export interface MasterSnapshot {
  product_master_id?: string;
  product_master_code?: string;
  product_master_name?: string;
  layers?: BomLayer[];
  adhesive?: BomAdhesive;
  ink?: BomInk;
  addons?: BomAddon[];
  width_mm?: number;
  height_mm?: number;
  gusset_mm?: number;
  flap_mm?: number;
  pouch_style_id?: string;
  pouch_style_code?: string;
  pouch_style_roll_axis?: string;
  stock_form?: string;
  width_basis?: string;
  film_area_width_mm?: number | null;
  print_capable?: boolean | null;
  artwork_required?: boolean | null;
  artwork_id?: string | null;
  artwork_code?: string | null;
  artwork_name?: string | null;
  artwork_print_type?: string | null;
  artwork_substrate_mode?: string | null;
  artwork_front_colors_count?: number | null;
  artwork_back_colors_count?: number | null;
  artwork_ink_gsm_total?: number | null;
  child_target_width_mm?: number | null;
  features?: Record<string, boolean>;
}

const numEq = (a: unknown, b: unknown, tol = 0.01): boolean => {
  const x = Number(a ?? 0);
  const y = Number(b ?? 0);
  if (!Number.isFinite(x) && !Number.isFinite(y)) return true;
  return Math.abs(x - y) < tol;
};

const idEq = (a: unknown, b: unknown): boolean => {
  return String(a ?? "") === String(b ?? "");
};

export interface ModifiedField {
  path: string;
  label: string;
  from: string;
  to: string;
}

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") return v.toFixed(2).replace(/\.00$/, "");
  return String(v);
}

export function diffSpecVsMaster(
  spec: QuoteLineSpec & { features?: Record<string, boolean> },
  master: MasterSnapshot | undefined,
): ModifiedField[] {
  if (!master) return [];
  const out: ModifiedField[] = [];

  // Geometry
  for (const [k, label] of [
    ["width_mm", "Width"],
    ["height_mm", "Height"],
    ["gusset_mm", "Gusset"],
    ["flap_mm", "Flap"],
  ] as const) {
    const a = (spec as Record<string, unknown>)[k];
    const b = (master as Record<string, unknown>)[k];
    if (!numEq(a, b)) {
      out.push({ path: k, label, from: fmt(b), to: fmt(a) });
    }
  }

  // Layers
  const specLayers = spec.layers || [];
  const masterLayers = master.layers || [];
  const maxL = Math.max(specLayers.length, masterLayers.length);
  for (let i = 0; i < maxL; i += 1) {
    const a = specLayers[i] || {};
    const b = masterLayers[i] || {};
    const pos =
      (b as BomLayer).position || (a as BomLayer).position || `L${i + 1}`;
    if (!idEq(a.material_id, b.material_id)) {
      out.push({
        path: `layers[${i}].material`,
        label: `${pos} material`,
        from: (b as BomLayer).material_code || "—",
        to: (a as BomLayer).material_code || "—",
      });
    }
    if (!numEq(a.micron, b.micron, 0.5)) {
      out.push({
        path: `layers[${i}].micron`,
        label: `${pos} µ`,
        from: fmt(b.micron),
        to: fmt(a.micron),
      });
    }
    if (!numEq(a.gsm, b.gsm, 0.2)) {
      out.push({
        path: `layers[${i}].gsm`,
        label: `${pos} GSM`,
        from: fmt(b.gsm),
        to: fmt(a.gsm),
      });
    }
  }

  // Adhesive
  if (master.adhesive) {
    if (!numEq(spec.adhesive_gsm, master.adhesive.gsm)) {
      out.push({
        path: "adhesive.gsm",
        label: "Adhesive GSM",
        from: fmt(master.adhesive.gsm),
        to: fmt(spec.adhesive_gsm),
      });
    }
    if (!numEq(spec.adhesive_rate_per_kg, master.adhesive.rate_per_kg)) {
      out.push({
        path: "adhesive.rate",
        label: "Adhesive ₹/kg",
        from: fmt(master.adhesive.rate_per_kg),
        to: fmt(spec.adhesive_rate_per_kg),
      });
    }
  }

  // Ink
  if (master.ink) {
    if (!numEq(spec.ink_gsm, master.ink.gsm)) {
      out.push({
        path: "ink.gsm",
        label: "Ink GSM",
        from: fmt(master.ink.gsm),
        to: fmt(spec.ink_gsm),
      });
    }
    if (!numEq(spec.ink_rate_per_kg, master.ink.rate_per_kg)) {
      out.push({
        path: "ink.rate",
        label: "Ink ₹/kg",
        from: fmt(master.ink.rate_per_kg),
        to: fmt(spec.ink_rate_per_kg),
      });
    }
  }

  // Addons (count + identity)
  const specAddons = spec.addons || [];
  const masterAddons = master.addons || [];
  if (specAddons.length !== masterAddons.length) {
    out.push({
      path: "addons",
      label: "Addons",
      from: `${masterAddons.length} item${masterAddons.length === 1 ? "" : "s"}`,
      to: `${specAddons.length} item${specAddons.length === 1 ? "" : "s"}`,
    });
  } else {
    for (let i = 0; i < specAddons.length; i += 1) {
      const a = specAddons[i];
      const b = masterAddons[i] || ({} as BomAddon);
      if (!idEq(a.material_id, b.material_id)) {
        out.push({
          path: `addons[${i}]`,
          label: `Addon ${i + 1}`,
          from: b.name || "—",
          to: a.name || "—",
        });
      }
    }
  }

  // Features
  const masterFeatures = master.features || {};
  const specFeatures =
    (spec as { features?: Record<string, boolean> }).features || {};
  const allKeys = new Set([
    ...Object.keys(masterFeatures),
    ...Object.keys(specFeatures),
  ]);
  for (const k of allKeys) {
    if (Boolean(masterFeatures[k]) !== Boolean(specFeatures[k])) {
      out.push({
        path: `features.${k}`,
        label: k.replace(/^has_/, "").replace(/_/g, " "),
        from: masterFeatures[k] ? "ON" : "OFF",
        to: specFeatures[k] ? "ON" : "OFF",
      });
    }
  }

  return out;
}

// Compact BOM strip rendered on collapsed catalog cards from the real selected stack.
export function bomStripText(
  spec: QuoteLineSpec & { features?: Record<string, boolean> },
): string {
  const parts: string[] = [];
  for (const l of spec.layers || []) {
    const code = l.material_code || l.name || "Layer";
    const micron = l.micron ? `${Number(l.micron).toFixed(0)}µ` : "";
    parts.push(`${code} ${micron}`.trim());
  }
  for (const addon of spec.addons || []) {
    if (addon.name) parts.push(`+ ${addon.name}`);
  }
  return parts.join(" · ");
}

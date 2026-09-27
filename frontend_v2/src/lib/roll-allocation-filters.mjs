// Client-side filtering mirrors explicit material identities; backend eligibility
// and allocation validation remain authoritative.
export function matchesRollMaterial(roll, spec) {
  const variant = String(spec?.variant_id || "");
  const family = String(spec?.family_id || "");
  if (!variant && !family) return true;
  if (variant) return String(roll?.material_id || roll?.variant_id || "") === variant;
  return String(roll?.family_id || "") === family;
}

export function distinctRollTargetSpecs(targetSpec, targetSpecs = []) {
  const specs = Array.isArray(targetSpecs) && targetSpecs.length ? targetSpecs : [targetSpec];
  const unique = new Map();
  for (const spec of specs.filter(Boolean)) {
    const key = JSON.stringify([
      spec.variant_id ?? "", spec.family_id ?? "", spec.grade_id ?? "",
      spec.thickness_micron ?? "", spec.min_width_mm ?? "", spec.max_auto_width_mm ?? "",
      spec.stock_form ?? "", spec.width_basis ?? "",
    ]);
    if (!unique.has(key)) unique.set(key, spec);
  }
  return [...unique.values()];
}

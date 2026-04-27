export function plannerContinuationTone(mode?: string | null) {
  const normalized = String(mode || "").toUpperCase()
  if (normalized === "EXACT_FG") return "border-emerald-200 bg-emerald-50 text-emerald-800"
  if (normalized === "EXACT_STOCK_ROUTE") return "border-blue-200 bg-blue-50 text-blue-800"
  if (normalized === "CARRY_FORWARD_WIP") return "border-sky-200 bg-sky-50 text-sky-800"
  if (normalized === "SHARED_INVARIANT_ROUTE") return "border-amber-200 bg-amber-50 text-amber-800"
  if (normalized === "UPSTREAM_ROUTE") return "border-teal-200 bg-teal-50 text-teal-800"
  if (normalized === "POD_BULK") return "border-blue-200 bg-blue-50 text-blue-800"
  if (normalized === "PACKAGING_STOCK") return "border-sky-200 bg-sky-50 text-sky-800"
  return "border-slate-200 bg-slate-50 text-slate-700"
}

export function plannerContinuationPrimaryLabel(mode?: string | null) {
  const normalized = String(mode || "").toUpperCase()
  if (normalized === "EXACT_FG") return "Use exact FG"
  if (normalized === "EXACT_STOCK_ROUTE") return "Continue stopped route"
  if (normalized === "CARRY_FORWARD_WIP") return "Continue WIP"
  if (normalized === "SHARED_INVARIANT_ROUTE") return "Use invariant route"
  if (normalized === "UPSTREAM_ROUTE") return "Use upstream roll"
  if (normalized === "POD_BULK") return "Create POD stock"
  if (normalized === "PACKAGING_STOCK") return "Create packaging stock"
  return "Make fresh"
}

export function plannerStockClassLabel(plannerStockClass?: string | null) {
  const normalized = String(plannerStockClass || "").toUpperCase()
  if (normalized === "FINAL_PRODUCT") return "Final pouch"
  if (normalized === "FINAL_PLAIN_ROLL") return "Final roll"
  if (normalized === "SHARED_INVARIANT_ROLL") return "Shared invariant roll"
  if (normalized === "EXTRUDED_BASE_ROLL") return "Upstream / base roll"
  if (normalized === "PACKAGING_STOCK") return "Packaging stock"
  return normalized ? normalized.replaceAll("_", " ").toLowerCase() : "Pending"
}

export function plannerReusePathLabel(plannerStockClass?: string | null, intent?: string | null) {
  const normalizedIntent = String(intent || "").toUpperCase()
  if (normalizedIntent === "POD_BULK") return "Dedicated POD replenishment"
  const normalized = String(plannerStockClass || "").toUpperCase()
  if (normalized === "FINAL_PRODUCT" || normalized === "FINAL_PLAIN_ROLL") return "Final stock"
  if (normalized === "SHARED_INVARIANT_ROLL") return "Reusable semi-finished roll"
  if (normalized === "EXTRUDED_BASE_ROLL") return "Upstream-compatible roll"
  if (normalized === "PACKAGING_STOCK") return "Packaging supply"
  return "Review route and reuse path"
}

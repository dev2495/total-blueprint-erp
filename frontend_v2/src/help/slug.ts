/** Stable slug for a route: "/sales/orders/create" → "sales-orders-create", "/" → "home". */
export function routeSlug(route: string): string {
  const clean = String(route || "/")
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .replace(/\[\.\.\.([^\]]+)\]/g, "$1")
    .replace(/\[([^\]]+)\]/g, "$1")
    .replace(/[^a-zA-Z0-9/_-]+/g, "-")
    .replace(/\//g, "-")
    .replace(/-+/g, "-")
    .toLowerCase();
  return clean || "home";
}

/** Slug for a module name: "Master Data" → "master-data". */
export function moduleSlug(module: string): string {
  return String(module || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "general";
}

export function screenshotKeyFor(route: string): string {
  return `${routeSlug(route)}-overview`;
}

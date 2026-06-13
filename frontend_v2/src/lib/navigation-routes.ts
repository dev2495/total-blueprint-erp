const PARENT_ROUTE_FALLBACKS: Record<string, string> = {
  "/production": "/dashboard/planner/control-tower/command",
  "/inventory": "/inventory",
  "/sales": "/sales/orders",
  "/engineering": "/engineering/artworks",
  "/system": "/system/users",
  "/dashboard": "/",
};

const EXACT_NAVIGABLE_ROUTES = new Set<string>([
  "/",
  "/analytics",
  "/analytics/capability-matrix",
  "/analytics/costing",
  "/analytics/inventory-health",
  "/analytics/kpis",
  "/analytics/mrp",
  "/analytics/reports/trading",
  "/dashboard/admin",
  "/dashboard/logistics",
  "/dashboard/owner",
  "/dashboard/planner",
  "/dashboard/planner/control-tower",
  "/dashboard/planner/control-tower/command",
  "/dashboard/planner/control-tower/plan-queue",
  "/dashboard/planner/control-tower/live-production",
  "/dashboard/planner/control-tower/completed-trace",
  "/dashboard/planner/control-tower/stock-intelligence",
  "/dashboard/planner/control-tower/gang-builder",
  "/dashboard/sales",
  "/dashboard/work-center",
  "/engineering/artworks",
  "/engineering/cylinders",
  "/engineering/tooling",
  "/engineering/routing",
  "/engineering/templates",
  "/factory/locations",
  "/factory/machines",
  "/factory/overview",
  "/factory/plants",
  "/factory/processes",
  "/factory/work-centers",
  "/help",
  "/inventory",
  "/inventory/adjustments",
  "/inventory/adjustments/new",
  "/inventory/addons",
  "/inventory/bulk",
  "/inventory/grn-history",
  "/inventory/grn",
  "/inventory/ink-floor",
  "/inventory/inter-plant",
  "/inventory/inter-plant",
  "/inventory/job-work",
  "/inventory/packaging",
  "/inventory/rolls",
  "/inventory/stock-conversions",
  "/inventory/stock-lifecycle",
  "/inventory/traceability",
  "/inventory/traceability",
  "/logistics",
  "/logistics/dispatch",
  "/logistics/packing",
  "/logistics/packing/audit",
  "/logistics/packing/consumption",
  "/master",
  "/master/add-ons",
  "/master/adhesives-solvents",
  "/master/film-families",
  "/master/film-variants",
  "/master/granules",
  "/master/inks",
  // Catalog pages — full lists of all packing + POD SKUs (purchased + in-house).
  // In-house production masters are created at /master/products?kind=PACKAGING|POD;
  // each variant is manually linked to one fixed catalog row here.
  "/master/packaging",
  "/master/pod",
  "/master/pouch-styles",
  "/master/pouch-styles/new",
  "/master/trading-goods",
  "/master/trading-goods/new",
  "/master/web-width-policies",
  "/master/web-width-policies/new",
  "/master/products",
  "/master/recipes",
  "/master/vendors",
  "/procurement/purchase-orders",
  "/procurement/purchase-orders/new",
  "/production/machine-selector",
  "/production/planner",
  "/production/planner/gang-builder",
  "/production/planner/heatmap",
  "/production/planner/stock-launcher",
  "/production/work-center",
  "/sales/customers",
  "/sales/orders",
  "/sales/orders/create",
  "/sales/quotations",
  "/sales/quotations/new",
  "/sales/quotations/[id]",
  "/sales/trade-orders",
  "/sales/trade-orders/new",
  "/system/audit",
  "/system/company-profile",
  "/system/governance",
  "/system/reason-codes",
  "/system/report-center",
  "/system/reorder-policy",
  "/system/role-matrix",
  "/system/users",
  "/system/users/new",
]);

const DYNAMIC_ROUTE_PATTERNS: RegExp[] = [
  /^\/analytics\/orders\/[^/]+\/costing$/,
  /^\/orders\/[^/]+$/,
  /^\/orders\/[^/]+\/tracking$/,
  /^\/sales\/orders\/[^/]+$/,
  /^\/sales\/orders\/[^/]+\/tracking$/,
  /^\/master\/products\/[^/]+$/,
  /^\/master\/products\/[^/]+\/edit$/,
  /^\/procurement\/purchase-orders\/[^/]+$/,
  /^\/procurement\/purchase-orders\/[^/]+\/receive$/,
  /^\/master\/pouch-styles\/[^/]+$/,
  /^\/master\/web-width-policies\/[^/]+$/,
  /^\/master\/trading-goods\/[^/]+$/,
  /^\/inventory\/adjustments\/[^/]+$/,
  /^\/sales\/trade-orders\/[^/]+$/,
  /^\/sales\/trade-orders\/[^/]+\/edit$/,
  /^\/system\/users\/[^/]+$/,
];

function normalizePath(path: string): string {
  const raw = String(path || "").trim();
  if (!raw) return "/";
  const [withoutQuery] = raw.split(/[?#]/, 1);
  const prefixed = withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
  if (prefixed === "/") return "/";
  return prefixed.replace(/\/+$/, "");
}

export function resolveNavigableRoute(path: string): string | null {
  const normalized = normalizePath(path);
  const fallback = PARENT_ROUTE_FALLBACKS[normalized];
  if (fallback) return fallback;
  if (EXACT_NAVIGABLE_ROUTES.has(normalized)) return normalized;
  if (DYNAMIC_ROUTE_PATTERNS.some((pattern) => pattern.test(normalized))) return normalized;
  return null;
}

export function isNavigableRoute(path: string): boolean {
  return resolveNavigableRoute(path) !== null;
}

export const NAV_PARENT_ROUTE_FALLBACKS = { ...PARENT_ROUTE_FALLBACKS };

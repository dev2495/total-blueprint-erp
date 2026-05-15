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
  "/inventory/addons-v36",
  "/inventory/bulk-v36",
  "/inventory/count",
  "/inventory/grn-history-v36",
  "/inventory/grn-v36",
  "/inventory/inter-plant",
  "/inventory/inter-plant-v36",
  "/inventory/job-work",
  "/inventory/packaging-v36",
  "/inventory/period",
  "/inventory/rolls-v36",
  "/inventory/traceability",
  "/inventory/traceability-v36",
  "/logistics",
  "/logistics/dispatch",
  "/logistics/packing",
  "/logistics/packing/consumption",
  "/master",
  "/master/add-ons",
  "/master/adhesives-solvents",
  "/master/film-families",
  "/master/film-variants",
  "/master/granules",
  "/master/inks",
  "/master/packaging",
  "/master/pod",
  "/master/products",
  "/master/recipes",
  "/master/vendors",
  "/production/machine-selector",
  "/production/planner",
  "/production/planner/heatmap",
  "/production/planner/stock-launcher",
  "/production/work-center",
  "/sales/customers",
  "/sales/orders",
  "/sales/orders/create",
  "/sales/quotations",
  "/system/audit",
  "/system/governance",
  "/system/report-center",
  "/system/role-matrix",
  "/system/users",
]);

const DYNAMIC_ROUTE_PATTERNS: RegExp[] = [
  /^\/analytics\/orders\/[^/]+\/costing$/,
  /^\/orders\/[^/]+$/,
  /^\/orders\/[^/]+\/tracking$/,
  /^\/sales\/orders\/[^/]+$/,
  /^\/sales\/orders\/[^/]+\/tracking$/,
  /^\/master\/products\/[^/]+$/,
  /^\/master\/products\/[^/]+\/edit$/,
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

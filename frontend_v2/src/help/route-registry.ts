import { PAGE_GUIDES } from "@/help/content/pages";

export const DASHBOARD_ROUTE_PATTERNS = PAGE_GUIDES.map((guide) => guide.routePattern);

export const MAIN_NAV_ROUTES = new Set<string>([
  "/production/planner",
  "/production/ink-control",
  "/factory/overview",
  "/dashboard/work-center",
  "/production/work-center",
  "/production/machine-selector",
  "/analytics/inventory-health",
  "/inventory",
  "/inventory/grn",
  "/inventory/grn-history",
  "/inventory/stock-lifecycle",
  "/inventory/rolls",
  "/inventory/bulk",
  "/inventory/packaging",
  "/inventory/addons",
  "/inventory/job-work",
  "/inventory/inter-plant",
  "/inventory/traceability",
  "/logistics/packing",
  "/logistics/packing/consumption",
  "/dashboard/logistics",
  "/dashboard/sales",
  "/sales/orders",
  "/sales/customers",
  "/sales/quotations",
  "/analytics",
  "/analytics/kpis",
  "/analytics/costing",
  "/analytics/mrp",
  "/engineering/artworks",
  "/engineering/cylinders",
  "/engineering/routing",
  "/engineering/route-dispatch",
  "/factory/processes",
  "/engineering/templates",
  "/dashboard/owner",
  "/dashboard/admin",
  "/system/users",
  "/system/role-matrix",
  "/system/governance",
  "/system/shift-timing",
  "/factory/plants",
  "/factory/locations",
  "/factory/work-centers",
  "/factory/machines",
  "/master",
  "/master/products",
  "/profile",
]);

export function isMainNavRoute(route: string): boolean {
  return MAIN_NAV_ROUTES.has(route);
}

const INLINE_HELP_CRITICAL_PATTERNS = new Set<string>([
  "/sales/orders/create",
  "/orders/create",
  "/sales/orders/[id]/tracking",
  "/production/planner",
  "/production/planner/stock-launcher",
  "/production/work-center",
  "/production/machine-selector",
  "/system/users/[id]",
  "/system/role-matrix",
  "/system/governance",
  "/profile",
]);

const INLINE_HELP_SUPPRESSED_PATTERNS = new Set<string>([
  "/production/planner",
])

function normalizePath(pathname: string): string {
  if (!pathname) return "/";
  const trimmed = pathname.trim();
  if (!trimmed.startsWith("/")) return `/${trimmed}`;
  return trimmed.length > 1 ? trimmed.replace(/\/+$/, "") : trimmed;
}

function patternToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\\\[\.\.\.[^\]]+\\\]/g, ".+")
    .replace(/\\\[[^\]]+\\\]/g, "[^/]+");
  return new RegExp(`^${escaped}$`);
}

export function shouldShowInlineHelp(pathname: string): boolean {
  const normalized = normalizePath(pathname);

  if (INLINE_HELP_SUPPRESSED_PATTERNS.has(normalized)) {
    return false;
  }

  if (MAIN_NAV_ROUTES.has(normalized)) {
    return true;
  }

  for (const pattern of INLINE_HELP_CRITICAL_PATTERNS) {
    if (!pattern.includes("[")) {
      if (pattern === normalized) return true;
      continue;
    }
    if (patternToRegex(pattern).test(normalized)) {
      return true;
    }
  }

  return false;
}

const LEGACY_ROUTE_REDIRECTS: Readonly<Record<string, string>> = Object.freeze({
  "/inventory/addons-v36": "/inventory/addons",
  "/inventory/bulk-v36": "/inventory/bulk",
  "/inventory/grn-history-v36": "/inventory/grn-history",
  "/inventory/grn-v36": "/inventory/grn",
  "/inventory/inter-plant-v36": "/inventory/inter-plant",
  "/inventory/packaging-v36": "/inventory/packaging",
  "/inventory/rolls-v36": "/inventory/rolls",
  "/inventory/traceability-v36": "/inventory/traceability",
});

export function canonicalHelpRoute(route: string): string {
  return LEGACY_ROUTE_REDIRECTS[route] || route;
}

export function isLegacyRedirectRoute(route: string): boolean {
  return Object.prototype.hasOwnProperty.call(LEGACY_ROUTE_REDIRECTS, route);
}

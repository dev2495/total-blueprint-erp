/**
 * Seven workspaces, one per station of the order spine. Every existing screen keeps its URL
 * and lives as a tab inside exactly one workspace, so nothing is lost; the sidebar shows the
 * seven workspaces first and the workspace bar shows the tabs of the one you are in.
 *
 *   Products → Orders → Plan → Floor → Stock → Yard & Dispatch → Reports & admin
 */
import type { ElementType } from "react";

import { NAV_ITEMS, canAccessNavTarget, type NavItem, type SidebarAccessContext } from "./sidebar-nav";
import { canOpenPath } from "./page-access";
import {
  BarChart3,
  Boxes,
  ClipboardList,
  Factory,
  Layers,
  ShoppingCart,
  Truck,
} from "lucide-react";

export interface WorkspaceTab {
  label: string;
  href: string;
  /** Extra path prefixes that count as this tab (detail pages, legacy routes). */
  match?: string[];
  /** Group label shown as a small divider before this tab. */
  group?: string;
}

export interface Workspace {
  key: "products" | "orders" | "plan" | "floor" | "stock" | "dispatch" | "insight";
  label: string;
  /** The spine station this workspace is home to. */
  station: string;
  icon: ElementType;
  home: string;
  blurb: string;
  tabs: WorkspaceTab[];
}

export const WORKSPACES: Workspace[] = [
  {
    key: "products",
    label: "Products",
    station: "Master",
    icon: Layers,
    home: "/master/products",
    blurb: "What we can make: masters, styles, routes, artwork and tooling.",
    tabs: [
      { label: "Product masters", href: "/master/products" },
      { label: "Pouch styles", href: "/master/pouch-styles" },
      { label: "Web-width policies", href: "/master/web-width-policies" },
      { label: "Templates", href: "/engineering/templates", group: "Routes", match: ["/engineering", "/dashboard/engineering"] },
      { label: "Routing studio", href: "/engineering/routing" },
      { label: "Route dispatch", href: "/engineering/route-dispatch" },
      { label: "Processes", href: "/factory/processes" },
      { label: "Artworks", href: "/engineering/artworks", group: "Print" },
      { label: "Cylinders", href: "/engineering/cylinders" },
      { label: "Tool room", href: "/engineering/tooling" },
      { label: "Films", href: "/master/film-variants", group: "Materials", match: ["/master/film-families"] },
      { label: "Granules", href: "/master/granules" },
      { label: "Recipes", href: "/master/recipes" },
      { label: "Inks", href: "/master/inks" },
      { label: "Adhesives", href: "/master/adhesives-solvents" },
      { label: "Packaging", href: "/master/packaging" },
      { label: "POD", href: "/master/pod" },
      { label: "Add-ons", href: "/master/add-ons" },
      { label: "Trading goods", href: "/master/trading-goods" },
      { label: "Families", href: "/master/commercial-families" },
      { label: "All masters", href: "/master" },
    ],
  },
  {
    key: "orders",
    label: "Orders",
    station: "Quote · Order",
    icon: ShoppingCart,
    home: "/sales/orders",
    blurb: "One composer for quotation, order and stock order; one tracker per order.",
    tabs: [
      { label: "Orders", href: "/sales/orders", match: ["/orders"] },
      { label: "New order", href: "/sales/orders/create", match: ["/sales/orders/new"] },
      { label: "Job names", href: "/sales/job-names" },
      { label: "Quotations", href: "/sales/quotations" },
      { label: "Customers", href: "/sales/customers" },
      { label: "Trade orders", href: "/sales/trade-orders" },
      { label: "Sales dashboard", href: "/dashboard/sales", match: ["/sales"] },
    ],
  },
  {
    key: "plan",
    label: "Plan",
    station: "Plan",
    icon: ClipboardList,
    home: "/dashboard/planner/control-tower/command",
    blurb: "Release, combine, launch stock and watch the route.",
    tabs: [
      { label: "Command", href: "/dashboard/planner/control-tower/command" },
      { label: "Plan queue", href: "/dashboard/planner/control-tower/plan-queue" },
      { label: "Live production", href: "/dashboard/planner/control-tower/live-production" },
      { label: "Completed trace", href: "/dashboard/planner/control-tower/completed-trace" },
      { label: "Material readiness", href: "/dashboard/planner/control-tower/stock-intelligence" },
      { label: "Combine orders", href: "/dashboard/planner/control-tower/gang-builder", match: ["/production/planner/gang-builder"] },
      { label: "Launch stock", href: "/dashboard/planner/control-tower/stock-launcher", match: ["/production/planner/stock-launcher"] },
      { label: "MRP", href: "/analytics/mrp", group: "More" },
      { label: "Ink control", href: "/production/ink-control" },
      { label: "Planner dashboard", href: "/dashboard/planner", match: ["/production/planner", "/production/planning"] },
    ],
  },
  {
    key: "floor",
    label: "Floor",
    station: "Floor",
    icon: Factory,
    home: "/production/work-center",
    blurb: "Work-centre terminal, machine terminal, ink floor and maintenance.",
    tabs: [
      { label: "WC terminal", href: "/production/work-center" },
      { label: "Machine terminal", href: "/production/machine-selector", match: ["/production/machine"] },
      { label: "Command deck", href: "/dashboard/work-center", match: ["/dashboard/operator"] },
      { label: "Visual factory", href: "/factory/overview" },
      { label: "Ink floor", href: "/inventory/ink-floor" },
      { label: "Job work", href: "/inventory/job-work" },
      { label: "Jobs", href: "/production", match: ["/production/jobs"] },
      { label: "Maintenance", href: "/maintenance/jobs", group: "Machines", match: ["/maintenance"] },
      { label: "Faults", href: "/maintenance/faults" },
      { label: "Schedules", href: "/maintenance/schedules" },
      { label: "Machine QR", href: "/maintenance/qr" },
      { label: "Maintenance reports", href: "/maintenance/reports" },
    ],
  },
  {
    key: "stock",
    label: "Stock",
    station: "Stock",
    icon: Boxes,
    home: "/inventory/rolls",
    blurb: "Rolls, bulk, packaging and inks: receive, move, convert, count, report.",
    tabs: [
      { label: "Rolls", href: "/inventory/rolls" },
      { label: "Bulk", href: "/inventory/bulk" },
      { label: "Packaging", href: "/inventory/packaging" },
      { label: "Inks · adhesives", href: "/inventory/addons" },
      { label: "Smart GRN", href: "/inventory/grn", group: "Receive", match: ["/inventory/grn-history"] },
      { label: "Bills & documents", href: "/inventory/gate-bills" },
      { label: "General receipts", href: "/inventory/general-receipts" },
      { label: "Purchase orders", href: "/procurement/purchase-orders", match: ["/procurement"] },
      { label: "Vendors", href: "/inventory/vendors", match: ["/master/vendors"] },
      { label: "Stock conversion", href: "/inventory/stock-conversions", group: "Move & convert" },
      { label: "Roll movements", href: "/inventory/movements" },
      { label: "Goods in & out", href: "/inventory/goods-movements" },
      { label: "Inter-plant", href: "/inventory/inter-plant" },
      { label: "Adjustments", href: "/inventory/adjustments" },
      { label: "Count at rack", href: "/inventory/count" },
      { label: "Ledger", href: "/inventory/ledger", group: "Trace & report" },
      { label: "Bulk transactions", href: "/inventory/bulk-transactions" },
      { label: "Roll genealogy", href: "/inventory/traceability" },
      { label: "Stock lifecycle", href: "/inventory/stock-lifecycle" },
      { label: "Alerts", href: "/inventory/alerts" },
      { label: "Period", href: "/inventory/period" },
      { label: "Stock history", href: "/analytics/inventory-history" },
      { label: "Inventory health", href: "/analytics/inventory-health" },
      { label: "Inventory report", href: "/analytics/reports/inventory" },
      { label: "Inventory dashboard", href: "/dashboard/inventory", match: ["/inventory"] },
    ],
  },
  {
    key: "dispatch",
    label: "Yard & Dispatch",
    station: "Yard · Dispatch",
    icon: Truck,
    home: "/logistics/packing",
    blurb: "Pack, check, load, dispatch — and the gate.",
    tabs: [
      { label: "Packing yard", href: "/logistics/packing" },
      { label: "Evening count", href: "/logistics/packing/consumption" },
      { label: "Packing audit", href: "/logistics/packing/audit" },
      { label: "Dispatch bay", href: "/logistics/dispatch", match: ["/logistics", "/dashboard/logistics"] },
      { label: "In transit", href: "/logistics/transit" },
      { label: "Goods in & out", href: "/inventory/goods-movements" },
      { label: "Outward documents", href: "/inventory/outward-documents" },
      { label: "Gate passes", href: "/inventory/gate-passes" },
      { label: "Gate terminal", href: "/gate", group: "Gate", match: ["/gate/goods", "/gate/outward", "/gate/inward-bills", "/gate/arrivals"] },
      { label: "Gate register", href: "/gate/register" },
      { label: "Visitors", href: "/gate/visitors" },
      { label: "Gate history", href: "/gate/history" },
      { label: "Visitor QR", href: "/gate/qr" },
      { label: "Gate setup", href: "/gate/setup" },
      { label: "Gate report", href: "/analytics/reports/gate" },
    ],
  },
  {
    key: "insight",
    label: "Reports & admin",
    station: "Owner",
    icon: BarChart3,
    home: "/dashboard/owner",
    blurb: "Numbers, reports, people and settings.",
    tabs: [
      { label: "Owner dashboard", href: "/dashboard/owner", match: ["/dashboard"] },
      { label: "KPIs", href: "/analytics/kpis", match: ["/analytics/kpi"] },
      { label: "Costing", href: "/analytics/costing", match: ["/analytics/orders"] },
      { label: "Reports hub", href: "/analytics", match: ["/analytics/reports", "/analytics/scrap", "/analytics/process-rates"] },
      { label: "Capability matrix", href: "/analytics/capability-matrix" },
      { label: "Trading report", href: "/analytics/reports/trading" },
      { label: "Report center", href: "/system/report-center", group: "Admin" },
      { label: "Audit", href: "/system/audit" },
      { label: "System health", href: "/dashboard/admin" },
      { label: "Users", href: "/system/users" },
      { label: "Role matrix", href: "/system/role-matrix" },
      { label: "Governance", href: "/system/governance" },
      { label: "Company profile", href: "/system/company-profile" },
      { label: "Reorder policy", href: "/system/reorder-policy" },
      { label: "Reason codes", href: "/system/reason-codes" },
      { label: "Settings", href: "/system/settings", match: ["/system"] },
      { label: "Plants", href: "/factory/plants", group: "Factory" },
      { label: "Locations", href: "/factory/locations" },
      { label: "Work centres", href: "/factory/work-centers" },
      { label: "Machines", href: "/factory/machines" },
      { label: "Shift timing", href: "/system/shift-timing" },
      { label: "Help", href: "/help" },
    ],
  },
];

function normalize(path: string) {
  return (String(path || "").split("?")[0].replace(/\/+$/g, "") || "/").toLowerCase();
}

function matches(prefix: string, path: string) {
  const p = normalize(prefix);
  return path === p || path.startsWith(`${p}/`);
}

/** The workspace and tab for a pathname, chosen by the longest matching prefix. */
export function resolveWorkspace(pathname: string): { workspace: Workspace; tab: WorkspaceTab | null } | null {
  const path = normalize(pathname);
  let best: { workspace: Workspace; tab: WorkspaceTab | null; length: number } | null = null;
  for (const workspace of WORKSPACES) {
    for (const tab of workspace.tabs) {
      for (const candidate of [tab.href, ...(tab.match || [])]) {
        if (matches(candidate, path)) {
          const length = normalize(candidate).length;
          if (!best || length > best.length) best = { workspace, tab, length };
        }
      }
    }
  }
  if (!best) return null;
  return { workspace: best.workspace, tab: best.tab };
}

type NavTarget = NavItem | NonNullable<NavItem["children"]>[number];

let navIndexCache: Map<string, NavTarget> | null = null;

/** Sidebar entries by route, so a workspace tab inherits the exact role + permission rule of today's sidebar. */
export function navTargetFor(href: string): NavTarget | undefined {
  if (!navIndexCache) {
    navIndexCache = new Map();
    for (const item of NAV_ITEMS) {
      navIndexCache.set(normalize(item.href), item);
      for (const child of item.children || []) navIndexCache.set(normalize(child.href), child);
    }
  }
  return navIndexCache.get(normalize(href));
}

/** A tab is open to a user when its sidebar entry is, and the page guard lets them in (master,
 * engineering, factory and system pages; a machine operator's own screens). */
export function canOpenTab(tab: WorkspaceTab, context: SidebarAccessContext): boolean {
  if (!canOpenPath(tab.href, context)) return false;
  const target = navTargetFor(tab.href);
  return target ? canAccessNavTarget(target, context) : true;
}

export interface AccessibleWorkspace {
  workspace: Workspace;
  tabs: WorkspaceTab[];
  /** Where the sidebar link goes: the workspace home when allowed, else the first allowed tab. */
  href: string;
}

/**
 * Workspaces a user can see. A workspace shows when at least one of its screens is in the
 * user's sidebar today, so role defaults and per-user permission overrides carry over
 * exactly; there is no second role mapping to drift out of sync.
 */
export function accessibleWorkspaces(context: SidebarAccessContext): AccessibleWorkspace[] {
  const out: AccessibleWorkspace[] = [];
  for (const workspace of WORKSPACES) {
    const allowedGoverned = workspace.tabs.filter((tab) => navTargetFor(tab.href) && canOpenTab(tab, context));
    if (!allowedGoverned.length) continue;
    const tabs = workspace.tabs.filter((tab) => canOpenTab(tab, context));
    const home = tabs.some((tab) => normalize(tab.href) === normalize(workspace.home)) && navTargetFor(workspace.home) && canOpenTab({ label: "", href: workspace.home }, context)
      ? workspace.home
      : allowedGoverned[0].href;
    out.push({ workspace, tabs, href: home });
  }
  return out;
}

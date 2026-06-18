import type { ElementType } from "react"
import {
  LayoutDashboard,
  AlertTriangle,
  BarChart3,
  BookOpen,
  Database,
  Factory,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Truck,
  Plane,
  Microscope,
  FileText,
  Zap,
  Users,
  MapPin,
  Cpu,
  Activity,
  Workflow,
  Package,
  ClipboardList,
  Layers,
  MoveRight,
  BadgePercent,
  Palette,
  Disc,
  CalendarRange,
  Combine,
  Repeat,
  SlidersHorizontal,
  Building2,
  History,
  ListChecks,
  ScrollText,
} from "lucide-react"

import { resolveNavigableRoute } from "./navigation-routes"
import { getCanonicalRoleCode } from "./roles"

const PAGE_PERMISSION_BY_ROUTE: Record<string, string> = {
  "/analytics": "page.analytics.home.view",
  "/analytics/kpis": "page.analytics.kpis.view",
  "/analytics/kpi": "page.analytics.kpi.view",
  "/analytics/costing": "page.analytics.costing.view",
  "/analytics/mrp": "page.analytics.mrp.view",
  "/analytics/inventory-history": "page.analytics.inventory_history.view",
  "/analytics/inventory-health": "page.analytics.inventory_health.view",
  "/analytics/process-rates": "page.analytics.process_rates.view",
  "/analytics/scrap": "page.analytics.scrap.view",
  "/analytics/reports": "page.analytics.reports.view",
  "/analytics/reports/sales": "page.analytics.reports_sales.view",
  "/analytics/reports/production": "page.analytics.reports_production.view",
  "/analytics/reports/inventory": "page.analytics.reports_inventory.view",
  "/analytics/reports/dispatch": "page.analytics.reports_dispatch.view",
  "/analytics/reports/mrp": "page.analytics.reports_mrp.view",
  "/analytics/reports/costing": "page.analytics.reports_costing.view",
  "/analytics/reports/oee": "page.analytics.reports_oee.view",
  "/analytics/reports/downtime": "page.analytics.reports_downtime.view",
  "/analytics/reports/operator": "page.analytics.reports_operator.view",
  "/analytics/reports/interplant": "page.analytics.reports_interplant.view",
  "/analytics/reports/scrap": "page.analytics.reports_scrap.view",
  "/dashboard/owner": "page.dashboard.owner.view",
  "/dashboard/admin": "page.dashboard.admin.view",
  "/dashboard/planner": "page.dashboard.planner.view",
  "/dashboard/work-center": "page.dashboard.work_center.view",
  "/dashboard/sales": "page.dashboard.sales.view",
  "/dashboard/inventory": "page.dashboard.inventory.view",
  "/dashboard/logistics": "page.dashboard.logistics.view",
  "/dashboard/engineering": "page.dashboard.engineering.view",
  "/dashboard/operator": "page.dashboard.operator.view",
  "/production/planner": "page.production.planner.view",
  "/dashboard/planner/control-tower/command": "page.production.control_tower.view",
  "/dashboard/planner/control-tower/plan-queue": "page.production.plan_queue.view",
  "/dashboard/planner/control-tower/live-production": "page.production.live_production.view",
  "/dashboard/planner/control-tower/completed-trace": "page.production.completed_trace.view",
  "/dashboard/planner/control-tower/stock-intelligence": "page.production.stock_intelligence.view",
  "/dashboard/planner/control-tower/gang-builder": "page.production.gang_builder.view",
  "/production/planner/stock-launcher": "page.production.stock_launcher.view",
  "/production/planner/heatmap": "page.production.heatmap.view",
  "/production/ink-control": "page.production.ink_control.view",
  "/production/machine-selector": "page.production.machine_selector.view",
  "/production/work-center": "page.production.work_center.view",
  "/inventory": "page.inventory.home.view",
  "/inventory/rolls": "page.inventory.rolls.view",
  "/inventory/bulk": "page.inventory.bulk.view",
  "/inventory/packaging": "page.inventory.packaging.view",
  "/inventory/addons": "page.inventory.addons.view",
  "/inventory/grn": "page.inventory.grn.view",
  "/inventory/grn-history": "page.inventory.grn_history.view",
  "/inventory/stock-lifecycle": "page.inventory.stock_lifecycle.view",
  "/inventory/count": "page.inventory.count.view",
  "/inventory/period": "page.inventory.period.view",
  "/inventory/ledger": "page.inventory.ledger.view",
  "/inventory/movements": "page.inventory.movements.view",
  "/inventory/bulk-transactions": "page.inventory.bulk_transactions.view",
  "/inventory/alerts": "page.inventory.alerts.view",
  "/inventory/adjustments": "page.inventory.adjustments.view",
  "/inventory/traceability": "page.inventory.traceability.view",
  "/inventory/inter-plant": "page.inventory.inter_plant.view",
  "/inventory/job-work": "page.inventory.job_work.view",
  "/inventory/vendors": "page.inventory.vendors.view",
  "/logistics/packing": "page.logistics.packing.view",
  "/logistics/packing/consumption": "page.logistics.packing_consumption.view",
  "/logistics/packing/audit": "page.logistics.packing_audit.view",
  "/logistics/dispatch": "page.logistics.dispatch.view",
  "/logistics/transit": "page.logistics.transit.view",
  "/sales/orders": "page.sales.orders.view",
  "/sales/orders/create": "page.sales.order_create.view",
  "/sales/customers": "page.sales.customers.view",
  "/sales/quotations": "page.sales.quotations.view",
  "/sales/trade-orders": "page.sales.trade_orders.view",
  "/engineering/artworks": "page.engineering.artworks.view",
  "/engineering/approvals": "page.engineering.approvals.view",
  "/engineering/cylinders": "page.engineering.cylinders.view",
  "/engineering/routing": "page.engineering.routing.view",
  "/engineering/route-dispatch": "page.engineering.route_dispatch.view",
  "/engineering/templates": "page.engineering.templates.view",
  "/engineering/tooling": "page.engineering.tooling.view",
  "/factory/overview": "page.factory.overview.view",
  "/factory/plants": "page.factory.plants.view",
  "/factory/locations": "page.factory.locations.view",
  "/factory/work-centers": "page.factory.work_centers.view",
  "/factory/machines": "page.factory.machines.view",
  "/factory/processes": "page.factory.processes.view",
  "/master/products": "page.master.products.view",
  "/master/commercial-families": "page.master.commercial_families.view",
  "/master/film-families": "page.master.film_families.view",
  "/master/film-variants": "page.master.film_variants.view",
  "/master/inks": "page.master.inks.view",
  "/master/granules": "page.master.granules.view",
  "/master/adhesives-solvents": "page.master.adhesives_solvents.view",
  "/master/packaging": "page.master.packaging.view",
  "/master/pod": "page.master.pod.view",
  "/master/recipes": "page.master.recipes.view",
  "/master/vendors": "page.master.vendors.view",
  "/procurement/purchase-orders": "page.procurement.purchase_orders.view",
  "/system/users": "page.system.users.view",
  "/system/role-matrix": "page.system.role_matrix.view",
  "/system/governance": "page.system.governance.view",
  "/system/audit": "page.system.audit.view",
  "/system/reason-codes": "page.system.reason_codes.view",
  "/system/reorder-policy": "page.system.reorder_policy.view",
  "/system/report-center": "page.system.report_center.view",
  "/system/settings": "page.system.settings.view",
  "/system/company-profile": "page.system.company_profile.view",
  "/profile": "page.profile.view",
}

export interface NavAccessDescriptor {
  roles?: string[]
  permissions?: string[]
  permissionModules?: string[]
}

export interface NavChildItem extends NavAccessDescriptor {
  title: string
  href: string
  icon: ElementType
  badge?: string
}

export interface NavItem extends NavAccessDescriptor {
  title: string
  href: string
  icon: ElementType
  roles: string[]
  badge?: string
  children?: NavChildItem[]
}

export interface SidebarAccessContext {
  currentRoleCode: string
  baseRoleCode?: string
  isOwner?: boolean
  grantedPermissions?: Iterable<string>
  grantedPermissionMap?: Record<string, string[]>
}

export const NAV_ITEMS: NavItem[] = [
  {
    title: "Operations",
    href: "/production",
    icon: Factory,
    roles: ["ADMIN", "OWNER", "PLANNER", "WORK_CENTER_MANAGER", "OPERATOR", "PLANT_MANAGER"],
    permissionModules: ["production"],
    children: [
      {
        title: "Planner Dashboard",
        href: "/dashboard/planner",
        icon: LayoutDashboard,
        roles: ["ADMIN", "OWNER", "SUPER_ADMIN", "PLANNER", "PLANT_MANAGER"],
        permissions: ["production.view", "production.manage"],
      },
      {
        title: "Planner Control Tower",
        href: "/dashboard/planner/control-tower/command",
        icon: Layers,
        roles: ["ADMIN", "OWNER", "SUPER_ADMIN", "PLANNER", "PLANT_MANAGER"],
        permissions: ["production.view", "production.manage"],
      },
      {
        title: "Stock Launcher",
        href: "/production/planner/stock-launcher",
        icon: Package,
        roles: ["ADMIN", "OWNER", "SUPER_ADMIN", "PLANNER", "PLANT_MANAGER"],
        permissions: ["production.view", "production.manage"],
      },
      {
        title: "Combine Orders",
        href: "/production/planner/gang-builder",
        icon: Combine,
        roles: ["ADMIN", "OWNER", "SUPER_ADMIN", "PLANNER", "PLANT_MANAGER"],
        permissions: ["production.view", "production.manage"],
      },
      {
        title: "Ink Control",
        href: "/production/ink-control",
        icon: Palette,
        roles: ["ADMIN", "OWNER", "SUPER_ADMIN", "PLANNER", "WORK_CENTER_MANAGER", "PLANT_MANAGER"],
        permissions: ["production.view", "production.manage"],
      },
      {
        title: "Visual Factory",
        href: "/factory/overview",
        icon: Factory,
        roles: ["ADMIN", "OWNER", "SUPER_ADMIN", "PLANNER", "WORK_CENTER_MANAGER", "PLANT_MANAGER"],
        permissions: ["factory.view", "factory.manage", "production.view", "production.manage"],
      },
      {
        title: "WCM Command Deck",
        href: "/dashboard/work-center",
        icon: LayoutDashboard,
        roles: ["ADMIN", "OWNER", "SUPER_ADMIN", "WORK_CENTER_MANAGER", "OPERATOR"],
        permissions: ["production.view", "production.manage"],
      },
      {
        title: "WCM Terminal",
        href: "/production/work-center",
        icon: Cpu,
        roles: ["ADMIN", "OWNER", "SUPER_ADMIN", "WORK_CENTER_MANAGER"],
        permissions: ["production.view", "production.manage"],
      },
      {
        title: "Machine Terminal",
        href: "/production/machine-selector",
        icon: Zap,
        roles: ["ADMIN", "OWNER", "SUPER_ADMIN", "WORK_CENTER_MANAGER"],
        permissions: ["production.view", "production.manage"],
      },
    ],
  },
  {
    title: "Procurement",
    href: "/procurement/purchase-orders",
    icon: ShoppingCart,
    roles: ["ADMIN", "OWNER", "STORE", "PLANT_MANAGER"],
    permissions: ["procurement.view", "procurement.manage"],
    children: [
      {
        title: "Purchase Orders",
        href: "/procurement/purchase-orders",
        icon: FileText,
        roles: ["ADMIN", "OWNER", "STORE", "PLANT_MANAGER"],
        permissions: ["procurement.view", "procurement.manage"],
      },
      {
        title: "New PO",
        href: "/procurement/purchase-orders/new",
        icon: FileText,
        roles: ["ADMIN", "OWNER", "STORE"],
        permissions: ["procurement.manage"],
      },
    ],
  },
  {
    title: "Inventory Workspace",
    href: "/inventory",
    icon: Database,
    roles: ["ADMIN", "OWNER", "STORE", "PLANNER", "WORK_CENTER_MANAGER", "PLANT_MANAGER"],
    permissionModules: ["inventory"],
    children: [
      {
        title: "Rolls Workspace",
        href: "/inventory/rolls",
        icon: Layers,
        roles: ["ADMIN", "OWNER", "STORE", "PLANNER", "WORK_CENTER_MANAGER"],
        permissions: ["inventory.view", "inventory.manage"],
      },
      {
        title: "Inventory Dashboard",
        href: "/dashboard/inventory",
        icon: LayoutDashboard,
        roles: ["ADMIN", "OWNER", "STORE", "PLANNER", "PLANT_MANAGER"],
        permissions: ["inventory.view"],
      },
      {
        title: "Stock Conversion",
        href: "/inventory/stock-conversions",
        icon: Repeat,
        roles: ["ADMIN", "OWNER", "STORE", "PLANNER", "WORK_CENTER_MANAGER"],
        permissions: ["inventory.view", "inventory.manage"],
      },
      {
        title: "Bulk Workspace",
        href: "/inventory/bulk",
        icon: Database,
        roles: ["ADMIN", "OWNER", "STORE", "PLANNER", "WORK_CENTER_MANAGER"],
        permissions: ["inventory.view", "inventory.manage"],
      },
      {
        title: "Packaging Workspace",
        href: "/inventory/packaging",
        icon: Package,
        roles: ["ADMIN", "OWNER", "STORE", "PLANNER", "WORK_CENTER_MANAGER"],
        permissions: ["inventory.view", "inventory.manage"],
      },
      {
        title: "Inks · Adhesives",
        href: "/inventory/addons",
        icon: Palette,
        roles: ["ADMIN", "OWNER", "STORE", "PLANNER", "WORK_CENTER_MANAGER"],
        permissions: ["inventory.view", "inventory.manage"],
      },
      {
        title: "Smart GRN",
        href: "/inventory/grn",
        icon: ClipboardList,
        roles: ["ADMIN", "OWNER", "STORE"],
        permissions: ["inventory.view", "inventory.manage"],
      },
      {
        title: "GRN History",
        href: "/inventory/grn-history",
        icon: ClipboardList,
        roles: ["ADMIN", "OWNER", "STORE", "PLANNER"],
        permissions: ["inventory.view", "inventory.manage"],
      },
      {
        title: "Stock Lifecycle",
        href: "/inventory/stock-lifecycle",
        icon: CalendarRange,
        roles: ["ADMIN", "OWNER", "STORE", "PLANNER", "PLANT_MANAGER"],
        permissions: ["inventory.audit.view", "inventory.manage"],
      },
      {
        title: "Inventory Alerts",
        href: "/inventory/alerts",
        icon: AlertTriangle,
        roles: ["ADMIN", "OWNER", "STORE", "PLANNER", "PLANT_MANAGER"],
        permissions: ["inventory.view", "inventory.manage"],
      },
      {
        title: "Stock Adjustments",
        href: "/inventory/adjustments",
        icon: SlidersHorizontal,
        roles: ["ADMIN", "OWNER", "STORE", "PLANT_MANAGER"],
        permissions: ["inventory.adjust"],
      },
      {
        title: "Stock Ledger",
        href: "/inventory/ledger",
        icon: ScrollText,
        roles: ["ADMIN", "OWNER", "STORE", "PLANNER", "PLANT_MANAGER"],
        permissions: ["inventory.view", "inventory.manage"],
      },
      {
        title: "Roll Movements",
        href: "/inventory/movements",
        icon: History,
        roles: ["ADMIN", "OWNER", "STORE", "PLANNER", "WORK_CENTER_MANAGER", "PLANT_MANAGER"],
        permissions: ["inventory.view", "inventory.manage"],
      },
      {
        title: "Bulk Transactions",
        href: "/inventory/bulk-transactions",
        icon: ListChecks,
        roles: ["ADMIN", "OWNER", "STORE", "PLANNER", "PLANT_MANAGER"],
        permissions: ["inventory.view", "inventory.manage"],
      },
      {
        title: "Inter-Plant",
        href: "/inventory/inter-plant",
        icon: Plane,
        roles: ["ADMIN", "OWNER", "STORE", "PLANNER", "WORK_CENTER_MANAGER"],
        permissions: ["inventory.view", "inventory.manage"],
      },
      {
        title: "Roll Genealogy",
        href: "/inventory/traceability",
        icon: Workflow,
        roles: ["ADMIN", "OWNER", "STORE", "PLANNER", "WORK_CENTER_MANAGER"],
        permissions: ["inventory.view", "inventory.manage"],
      },
      {
        title: "Job Work",
        href: "/inventory/job-work",
        icon: Layers,
        roles: ["ADMIN", "OWNER", "STORE", "PLANNER"],
        permissions: ["inventory.view", "inventory.manage"],
      },
      {
        title: "Inventory Vendors",
        href: "/inventory/vendors",
        icon: Building2,
        roles: ["ADMIN", "OWNER", "STORE", "PLANT_MANAGER"],
        permissions: ["inventory.view", "inventory.manage", "procurement.view", "procurement.manage"],
      },
      {
        title: "Stock History",
        href: "/analytics/inventory-history",
        icon: BookOpen,
        roles: ["ADMIN", "OWNER", "STORE", "PLANNER", "PLANT_MANAGER"],
        permissions: ["inventory.view", "analytics.view"],
      },
      {
        title: "Inventory Health",
        href: "/analytics/inventory-health",
        icon: Activity,
        roles: ["ADMIN", "OWNER", "STORE", "PLANNER", "WORK_CENTER_MANAGER"],
        permissions: ["inventory.view", "inventory.manage"],
      },
      {
        title: "Inventory Report",
        href: "/analytics/reports/inventory",
        icon: BarChart3,
        roles: ["ADMIN", "OWNER", "STORE", "PLANNER", "PLANT_MANAGER"],
        permissions: ["inventory.view", "analytics.view"],
      },
    ],
  },
  {
    title: "Logistics",
    href: "/logistics",
    icon: Truck,
    roles: ["ADMIN", "OWNER", "DISPATCH"],
    permissions: ["inventory.view", "inventory.manage", "production.view", "production.manage"],
    children: [
      { title: "Packing Yard", href: "/logistics/packing", icon: Package, roles: ["ADMIN", "OWNER", "DISPATCH"], permissions: ["inventory.view", "inventory.manage", "production.view", "production.manage"] },
      { title: "Packing audit trail", href: "/logistics/packing/audit", icon: ShieldCheck, roles: ["ADMIN", "OWNER", "DISPATCH"], permissions: ["inventory.view", "inventory.manage", "production.view", "production.manage"] },
      { title: "Packing EOD Count", href: "/logistics/packing/consumption", icon: ClipboardList, roles: ["ADMIN", "OWNER", "DISPATCH"], permissions: ["inventory.view", "inventory.manage", "production.view", "production.manage"] },
      {
        title: "Dispatch Bay",
        href: "/logistics/dispatch",
        icon: MoveRight,
        roles: ["ADMIN", "OWNER", "DISPATCH"],
        permissions: ["inventory.view", "inventory.manage"],
      },
    ],
  },
  {
    title: "Sales",
    href: "/sales",
    icon: ShoppingCart,
    roles: ["ADMIN", "OWNER", "SALES"],
    permissionModules: ["sales"],
    children: [
      {
        title: "Sales Dashboard",
        href: "/dashboard/sales",
        icon: LayoutDashboard,
        roles: ["ADMIN", "OWNER", "SUPER_ADMIN", "SALES"],
        permissions: ["sales.view", "sales.manage"],
      },
      { title: "Sales Orders", href: "/sales/orders", icon: ClipboardList, roles: ["ADMIN", "OWNER", "SALES"], permissions: ["sales.view", "sales.manage"] },
      { title: "Trade Orders", href: "/sales/trade-orders", icon: Repeat, roles: ["ADMIN", "OWNER", "SALES"], permissions: ["sales.view", "sales.manage"] },
      { title: "Product Master", href: "/master/products", icon: Package, roles: ["ADMIN", "OWNER", "SALES"], permissions: ["sales.manage"] },
      { title: "Pouch Styles", href: "/master/pouch-styles", icon: Palette, roles: ["ADMIN", "OWNER", "SALES"], permissions: ["sales.manage"] },
      { title: "Web-Width Policies", href: "/master/web-width-policies", icon: MoveRight, roles: ["ADMIN", "OWNER", "PLANNER"], permissions: ["sales.manage", "production.manage"] },
      { title: "Customers", href: "/sales/customers", icon: Users, roles: ["ADMIN", "OWNER", "SALES"], permissions: ["sales.manage"] },
      { title: "Quotations", href: "/sales/quotations", icon: FileText, roles: ["ADMIN", "OWNER", "SALES"], permissions: ["sales.manage"] },
    ],
  },
  {
    title: "Analytics",
    href: "/analytics",
    icon: BarChart3,
    roles: ["ADMIN", "OWNER", "PLANNER", "PLANT_MANAGER", "SALES"],
    permissionModules: ["analytics"],
    children: [
      { title: "Reports Hub", href: "/analytics", icon: Activity, roles: ["ADMIN", "OWNER", "PLANT_MANAGER"], permissions: ["analytics.view", "analytics.manage"] },
      { title: "Capability Matrix", href: "/analytics/capability-matrix", icon: Layers, roles: ["ADMIN", "OWNER", "PLANNER", "PLANT_MANAGER", "ENGINEERING"], permissions: ["analytics.view", "analytics.manage"] },
      {
        title: "KPI Dashboard",
        href: "/analytics/kpis",
        icon: BarChart3,
        roles: ["ADMIN", "OWNER", "PLANT_MANAGER"],
        permissions: ["analytics.view", "analytics.manage"],
      },
      {
        title: "Costing Center",
        href: "/analytics/costing",
        icon: BadgePercent,
        roles: ["ADMIN", "OWNER", "PLANNER", "PLANT_MANAGER"],
        permissions: ["analytics.view", "analytics.manage", "costing.view", "costing.manage"],
      },
      { title: "MRP Center", href: "/analytics/mrp", icon: ClipboardList, roles: ["ADMIN", "OWNER", "PLANNER"], permissions: ["mrp.view", "mrp.manage"] },
      { title: "Trading Report", href: "/analytics/reports/trading", icon: Repeat, roles: ["ADMIN", "OWNER", "SALES", "PLANT_MANAGER"], permissions: ["analytics.view", "analytics.manage"] },
    ],
  },
  {
    title: "Engineering",
    href: "/engineering",
    icon: Microscope,
    roles: ["ADMIN", "OWNER", "ENGINEERING"],
    permissionModules: ["engineering", "routing", "templates", "tooling"],
    children: [
      { title: "Artwork Master", href: "/engineering/artworks", icon: Palette, roles: ["ADMIN", "OWNER", "ENGINEERING"], permissions: ["engineering.view", "engineering.manage"] },
      { title: "Cylinder Catalog", href: "/engineering/cylinders", icon: Disc, roles: ["ADMIN", "OWNER", "ENGINEERING"], permissions: ["engineering.view", "engineering.manage"] },
      { title: "Tool Room", href: "/engineering/tooling", icon: Settings, roles: ["ADMIN", "OWNER", "ENGINEERING"], permissions: ["tooling.view", "tooling.manage"] },
      { title: "Routing Studio", href: "/engineering/routing", icon: Workflow, roles: ["ADMIN", "OWNER", "ENGINEERING"], permissions: ["routing.view", "routing.manage"] },
      { title: "Route Dispatch", href: "/engineering/route-dispatch", icon: Factory, roles: ["ADMIN", "OWNER", "ENGINEERING", "PLANNER"], permissions: ["templates.view", "templates.manage", "factory.view"] },
      { title: "Helper Processes", href: "/factory/processes", icon: Layers, roles: ["ADMIN", "OWNER", "ENGINEERING"], permissions: ["factory.view", "factory.manage"] },
      { title: "Template Studio", href: "/engineering/templates", icon: FileText, roles: ["ADMIN", "OWNER", "ENGINEERING"], permissions: ["templates.view", "templates.manage"] },
    ],
  },
  {
    title: "Administration",
    href: "/dashboard/admin",
    icon: ShieldCheck,
    roles: ["ADMIN", "OWNER", "SUPER_ADMIN"],
    permissionModules: ["users", "rbac", "notifications"],
    children: [
      { title: "Owner Dashboard", href: "/dashboard/owner", icon: LayoutDashboard, roles: ["OWNER", "SUPER_ADMIN"] },
      { title: "System Health", href: "/dashboard/admin", icon: Activity, roles: ["ADMIN", "SUPER_ADMIN"], permissions: ["dashboard.view"] },
      { title: "User Management", href: "/system/users", icon: Users, roles: ["ADMIN", "OWNER", "SUPER_ADMIN"], permissions: ["users.view", "users.manage"] },
      {
        title: "Company Profile",
        href: "/system/company-profile",
        icon: Building2,
        roles: ["ADMIN", "OWNER", "SUPER_ADMIN"],
        permissions: ["system.manage", "system.view"],
      },
      {
        title: "Role Matrix",
        href: "/system/role-matrix",
        icon: ShieldCheck,
        roles: ["ADMIN", "OWNER", "SUPER_ADMIN"],
        permissions: ["rbac.view", "rbac.manage"],
      },
      {
        title: "Governance Console",
        href: "/system/governance",
        icon: ShieldCheck,
        roles: ["ADMIN", "OWNER", "SUPER_ADMIN"],
        permissions: ["rbac.view", "rbac.manage"],
      },
      {
        title: "Report Center",
        href: "/system/report-center",
        icon: FileText,
        roles: ["ADMIN", "OWNER", "SUPER_ADMIN"],
        permissions: ["analytics.view", "analytics.manage"],
      },
      {
        title: "Audit Center",
        href: "/system/audit",
        icon: ShieldCheck,
        roles: ["ADMIN", "OWNER", "SUPER_ADMIN"],
        permissions: ["rbac.view", "rbac.manage"],
        badge: "Audit",
      },
      {
        title: "Reorder Policy",
        href: "/system/reorder-policy",
        icon: ShieldCheck,
        roles: ["ADMIN", "OWNER", "SUPER_ADMIN"],
        permissions: ["materials.view", "materials.manage", "inventory.manage"],
      },
      {
        title: "Reason Codes",
        href: "/system/reason-codes",
        icon: ClipboardList,
        roles: ["ADMIN", "OWNER", "SUPER_ADMIN"],
        permissions: ["production.manage"],
      },
    ],
  },
  {
    title: "System",
    href: "/system",
    icon: Settings,
    roles: ["ADMIN", "OWNER"],
    permissionModules: ["master", "factory"],
    children: [
      { title: "Plants", href: "/factory/plants", icon: Factory, roles: ["ADMIN", "OWNER"], permissions: ["factory.view", "factory.manage"] },
      { title: "Locations", href: "/factory/locations", icon: MapPin, roles: ["ADMIN", "OWNER"], permissions: ["factory.view", "factory.manage"] },
      { title: "Work Centers", href: "/factory/work-centers", icon: Cpu, roles: ["ADMIN", "OWNER"], permissions: ["factory.view", "factory.manage"] },
      { title: "Machines", href: "/factory/machines", icon: Settings, roles: ["ADMIN", "OWNER"], permissions: ["factory.view", "factory.manage"] },
      { title: "Shift Timing", href: "/system/shift-timing", icon: CalendarRange, roles: ["ADMIN", "OWNER"], permissions: ["factory.view", "factory.manage"] },
      { title: "Master Data", href: "/master", icon: Database, roles: ["ADMIN", "OWNER"], permissions: ["master.view", "master.manage"] },
    ],
  },
]

function normalizeRole(value: string | undefined) {
  return getCanonicalRoleCode(value) || String(value || "").toUpperCase()
}

function toPermissionSet(grantedPermissions?: Iterable<string>) {
  return new Set(Array.from(grantedPermissions || []).map((permission) => String(permission || "").trim()).filter(Boolean))
}

export function hasGrantedPermission(
  permission: string,
  grantedPermissions?: Iterable<string>,
  grantedPermissionMap?: Record<string, string[]>,
) {
  const normalized = String(permission || "").trim()
  if (!normalized) return false

  const permissionSet = toPermissionSet(grantedPermissions)
  if (permissionSet.has("*")) return true
  if (permissionSet.has(normalized)) return true

  const [moduleKey, actionKey] = normalized.split(".", 2)
  if (!moduleKey) return false

  const actions = grantedPermissionMap?.[moduleKey] || []
  if (actions.includes("*")) return true
  return actionKey ? actions.includes(actionKey) : actions.length > 0
}

export function hasGrantedModule(
  moduleName: string,
  grantedPermissions?: Iterable<string>,
  grantedPermissionMap?: Record<string, string[]>,
) {
  const normalized = String(moduleName || "").trim()
  if (!normalized) return false

  const permissionSet = toPermissionSet(grantedPermissions)
  if (permissionSet.has("*")) return true
  if ((grantedPermissionMap?.[normalized] || []).length > 0) return true

  for (const permission of permissionSet) {
    if (permission.startsWith(`${normalized}.`)) return true
  }
  return false
}

function hasGrantedPageOverride(
  target: NavAccessDescriptor,
  context: SidebarAccessContext,
) {
  const href = String((target as { href?: string }).href || "").trim()
  if (!href) return false
  const resolved = resolveNavigableRoute(href) || href
  const permission = PAGE_PERMISSION_BY_ROUTE[resolved]
  if (!permission) return false
  return hasGrantedPermission(permission, context.grantedPermissions, context.grantedPermissionMap)
}

export function canAccessNavTarget(
  target: NavAccessDescriptor,
  context: SidebarAccessContext,
) {
  const currentRole = normalizeRole(context.currentRoleCode)
  const baseRoleCode = normalizeRole(context.baseRoleCode || context.currentRoleCode)
  const masterRoles = ["ADMIN", "OWNER", "SUPER_ADMIN"]
  const isEmulating = currentRole !== baseRoleCode
  const isMaster = Boolean(context.isOwner) || masterRoles.includes(baseRoleCode)

  const roles = target.roles || []
  const permissions = target.permissions || []
  const permissionModules = target.permissionModules || []

  const hasNoRestrictions = roles.length === 0 && permissions.length === 0 && permissionModules.length === 0
  if (hasNoRestrictions) return true

  let roleAllowed = false
  if (roles.length > 0) {
    if (isEmulating) {
      roleAllowed = roles.some((role) => normalizeRole(role) === currentRole)
    } else if (roles.some((role) => normalizeRole(role) === currentRole)) {
      roleAllowed = true
    } else if (currentRole !== "ADMIN" && isMaster) {
      roleAllowed = roles.some((role) => masterRoles.includes(normalizeRole(role)))
    }
  }

  if (roleAllowed) return true

  if (hasGrantedPageOverride(target, context)) return true

  if (permissions.some((permission) => hasGrantedPermission(permission, context.grantedPermissions, context.grantedPermissionMap))) {
    return true
  }

  return permissionModules.some((moduleName) => hasGrantedModule(moduleName, context.grantedPermissions, context.grantedPermissionMap))
}

export function isNavItemAuthorized(roles: string[] | undefined, roleCode: string) {
  if (!roles || roles.length === 0) return true
  const normalizedRole = String(roleCode || "").toUpperCase()
  return roles.some((role) => String(role || "").toUpperCase() === normalizedRole)
}

export function getSidebarRoutesForRole(
  roleCode: string,
  options?: {
    baseRoleCode?: string
    isOwner?: boolean
    grantedPermissions?: Iterable<string>
    grantedPermissionMap?: Record<string, string[]>
  },
) {
  const context: SidebarAccessContext = {
    currentRoleCode: roleCode,
    baseRoleCode: options?.baseRoleCode,
    isOwner: options?.isOwner,
    grantedPermissions: options?.grantedPermissions,
    grantedPermissionMap: options?.grantedPermissionMap,
  }

  const routes: string[] = []
  for (const item of NAV_ITEMS) {
    const hasParentAccess = canAccessNavTarget(item, context)
    const authorizedChildren = (item.children || []).filter((child) => {
      if (child.href === "/dashboard/sales" && normalizeRole(roleCode) === "SALES") return false
      return canAccessNavTarget(child, context)
    })
    if (!hasParentAccess && authorizedChildren.length === 0) continue

    if (hasParentAccess) {
      routes.push(item.href)
    }

    for (const child of authorizedChildren) {
      const resolved = resolveNavigableRoute(child.href)
      if (resolved) routes.push(resolved)
    }
  }
  return Array.from(new Set(routes))
}

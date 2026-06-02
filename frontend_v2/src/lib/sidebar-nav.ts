import type { ElementType } from "react"
import {
  LayoutDashboard,
  BarChart3,
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
} from "lucide-react"

import { resolveNavigableRoute } from "./navigation-routes"
import { getCanonicalRoleCode } from "./roles"

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
        title: "Stock Adjustments",
        href: "/inventory/adjustments",
        icon: SlidersHorizontal,
        roles: ["ADMIN", "OWNER"],
        permissions: ["inventory.manage"],
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
        title: "Inventory Health",
        href: "/analytics/inventory-health",
        icon: Activity,
        roles: ["ADMIN", "OWNER", "STORE", "PLANNER", "WORK_CENTER_MANAGER"],
        permissions: ["inventory.view", "inventory.manage"],
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

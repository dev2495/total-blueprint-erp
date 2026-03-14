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
  Archive,
  Layers,
  MoveRight,
  BadgePercent,
  Palette,
  Disc,
} from "lucide-react"

import { resolveNavigableRoute } from "./navigation-routes"

export interface NavChildItem {
  title: string
  href: string
  icon: ElementType
  roles?: string[]
  badge?: string
}

export interface NavItem {
  title: string
  href: string
  icon: ElementType
  roles: string[]
  children?: NavChildItem[]
}

export const NAV_ITEMS: NavItem[] = [
  {
    title: "Operations",
    href: "/production",
    icon: Factory,
    roles: ["ADMIN", "OWNER", "PLANNER", "WORK_CENTER_MANAGER", "OPERATOR", "PLANT_MANAGER"],
    children: [
      {
        title: "Planner Dashboard",
        href: "/dashboard/planner",
        icon: LayoutDashboard,
        roles: ["ADMIN", "OWNER", "SUPER_ADMIN", "PLANNER", "PLANT_MANAGER"],
      },
      {
        title: "Planner Control Tower",
        href: "/production/planner",
        icon: Layers,
        roles: ["ADMIN", "OWNER", "SUPER_ADMIN", "PLANNER", "PLANT_MANAGER"],
      },
      {
        title: "Visual Factory",
        href: "/factory/overview",
        icon: Factory,
        roles: ["ADMIN", "OWNER", "SUPER_ADMIN", "PLANNER", "WORK_CENTER_MANAGER", "PLANT_MANAGER"],
      },
      {
        title: "WCM Dashboard",
        href: "/dashboard/work-center",
        icon: LayoutDashboard,
        roles: ["ADMIN", "OWNER", "SUPER_ADMIN", "WORK_CENTER_MANAGER"],
      },
      {
        title: "WCM Terminal",
        href: "/production/work-center",
        icon: Cpu,
        roles: ["ADMIN", "OWNER", "SUPER_ADMIN", "WORK_CENTER_MANAGER"],
      },
      {
        title: "Machine Terminal",
        href: "/production/machine-selector",
        icon: Zap,
        roles: ["ADMIN", "OWNER", "SUPER_ADMIN", "OPERATOR"],
      },
    ],
  },
  {
    title: "Inventory",
    href: "/inventory",
    icon: Database,
    roles: ["ADMIN", "OWNER", "STORE", "PLANNER", "WORK_CENTER_MANAGER"],
    children: [
      {
        title: "Inventory Health",
        href: "/analytics/inventory-health",
        icon: Activity,
        roles: ["ADMIN", "OWNER", "STORE", "PLANNER", "WORK_CENTER_MANAGER"],
      },
      { title: "Roll Explorer", href: "/inventory/roll-explorer", icon: Archive },
      { title: "Bulk Inventory", href: "/inventory/bulk", icon: Package, roles: ["ADMIN", "OWNER", "STORE"] },
      {
        title: "Packaging Stock",
        href: "/inventory/packaging",
        icon: Package,
        roles: ["ADMIN", "OWNER", "STORE", "PLANNER", "DISPATCH"],
      },
      { title: "GRN Desk", href: "/inventory/grn", icon: ClipboardList, roles: ["ADMIN", "OWNER", "STORE"] },
      { title: "Job Work", href: "/inventory/job-work", icon: Layers, roles: ["ADMIN", "OWNER", "STORE", "PLANNER"] },
      { title: "Inter-Plant", href: "/inventory/inter-plant", icon: Plane },
      { title: "Traceability", href: "/inventory/traceability", icon: Workflow },
    ],
  },
  {
    title: "Logistics",
    href: "/logistics",
    icon: Truck,
    roles: ["ADMIN", "OWNER", "DISPATCH"],
    children: [
      { title: "Packing Yard", href: "/logistics/packing", icon: Package },
      {
        title: "Dispatch Bay",
        href: "/dashboard/logistics",
        icon: MoveRight,
        roles: ["ADMIN", "OWNER", "DISPATCH"],
      },
    ],
  },
  {
    title: "Sales",
    href: "/sales",
    icon: ShoppingCart,
    roles: ["ADMIN", "OWNER", "SALES"],
    children: [
      {
        title: "Sales Dashboard",
        href: "/dashboard/sales",
        icon: LayoutDashboard,
        roles: ["ADMIN", "OWNER", "SUPER_ADMIN", "SALES"],
      },
      { title: "Sales Orders", href: "/sales/orders", icon: ClipboardList },
      { title: "Customers", href: "/sales/customers", icon: Users },
      { title: "Quotations", href: "/sales/quotations", icon: FileText },
    ],
  },
  {
    title: "Analytics",
    href: "/analytics",
    icon: BarChart3,
    roles: ["ADMIN", "OWNER", "PLANNER", "PLANT_MANAGER", "SALES"],
    children: [
      { title: "Reports Hub", href: "/analytics", icon: Activity, roles: ["ADMIN", "OWNER", "PLANT_MANAGER"] },
      { title: "Capability Matrix", href: "/analytics/capability-matrix", icon: Layers, roles: ["ADMIN", "OWNER", "PLANNER", "PLANT_MANAGER", "ENGINEERING"] },
      {
        title: "KPI Dashboard",
        href: "/analytics/kpis",
        icon: BarChart3,
        roles: ["ADMIN", "OWNER", "PLANT_MANAGER"],
      },
      {
        title: "Costing Center",
        href: "/analytics/costing",
        icon: BadgePercent,
        roles: ["ADMIN", "OWNER", "PLANNER", "PLANT_MANAGER"],
      },
      { title: "MRP Center", href: "/analytics/mrp", icon: ClipboardList, roles: ["ADMIN", "OWNER", "PLANNER"] },
    ],
  },
  {
    title: "Engineering",
    href: "/engineering",
    icon: Microscope,
    roles: ["ADMIN", "OWNER", "ENGINEERING"],
    children: [
      { title: "Artwork Master", href: "/engineering/artworks", icon: Palette, roles: ["ADMIN", "OWNER", "ENGINEERING"] },
      { title: "Cylinder Catalog", href: "/engineering/cylinders", icon: Disc, roles: ["ADMIN", "OWNER", "ENGINEERING"] },
      { title: "Routing Studio", href: "/engineering/routing", icon: Workflow, roles: ["ADMIN", "OWNER", "ENGINEERING"] },
      { title: "Helper Processes", href: "/factory/processes", icon: Layers, roles: ["ADMIN", "OWNER", "ENGINEERING"] },
      { title: "Template Studio", href: "/engineering/templates", icon: FileText, roles: ["ADMIN", "OWNER", "ENGINEERING"] },
    ],
  },
  {
    title: "Administration",
    href: "/dashboard/admin",
    icon: ShieldCheck,
    roles: ["ADMIN", "OWNER", "SUPER_ADMIN"],
    children: [
      { title: "Owner Dashboard", href: "/dashboard/owner", icon: LayoutDashboard, roles: ["OWNER", "SUPER_ADMIN"] },
      { title: "System Health", href: "/dashboard/admin", icon: Activity, roles: ["ADMIN", "SUPER_ADMIN"] },
      { title: "User Management", href: "/system/users", icon: Users },
      {
        title: "Role Matrix",
        href: "/system/role-matrix",
        icon: ShieldCheck,
        roles: ["ADMIN", "OWNER", "SUPER_ADMIN"],
      },
      {
        title: "Governance Console",
        href: "/system/governance",
        icon: ShieldCheck,
        roles: ["ADMIN", "OWNER", "SUPER_ADMIN"],
      },
    ],
  },
  {
    title: "System",
    href: "/system",
    icon: Settings,
    roles: ["ADMIN", "OWNER"],
    children: [
      { title: "Plants", href: "/factory/plants", icon: Factory },
      { title: "Locations", href: "/factory/locations", icon: MapPin },
      { title: "Work Centers", href: "/factory/work-centers", icon: Cpu },
      { title: "Machines", href: "/factory/machines", icon: Settings },
      { title: "Master Data", href: "/master", icon: Database },
    ],
  },
]

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
  },
) {
  const currentRole = String(roleCode || "").toUpperCase()
  const baseRoleCode = String(options?.baseRoleCode || roleCode || "").toUpperCase()
  const masterRoles = ["ADMIN", "OWNER", "SUPER_ADMIN"]
  const isEmulating = currentRole !== baseRoleCode
  const isMaster = Boolean(options?.isOwner) || masterRoles.includes(baseRoleCode)

  const canAccess = (roles: string[] | undefined) => {
    if (!roles || roles.length === 0) return true
    if (isEmulating) return roles.some((role) => String(role || "").toUpperCase() === currentRole)
    if (roles.some((role) => String(role || "").toUpperCase() === currentRole)) return true
    if (isMaster && roles.some((role) => masterRoles.includes(String(role || "").toUpperCase()))) return true
    return false
  }

  const routes: string[] = []
  for (const item of NAV_ITEMS) {
    if (!canAccess(item.roles)) continue
    for (const child of item.children || []) {
      if (!canAccess(child.roles || item.roles)) continue
      const resolved = resolveNavigableRoute(child.href)
      if (resolved) routes.push(resolved)
    }
  }
  return Array.from(new Set(routes))
}

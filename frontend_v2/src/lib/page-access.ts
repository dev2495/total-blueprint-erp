/**
 * Who may open which page, from the same rules as the sidebar.
 *
 * Master data, routes, templates, artwork, factory set-up and system pages open only for the roles
 * (or personal grants) their sidebar entry lists, even when someone types the address or follows
 * a link. A machine operator stays on the machine terminal, maintenance and their own account.
 * Every other page keeps its own checks; the API refuses whatever a role may not read or change.
 */
import { NAV_ITEMS, canAccessNavTarget, type NavAccessDescriptor, type SidebarAccessContext } from "@/lib/sidebar-nav"

const GUARDED_AREAS = ["/master", "/engineering", "/factory", "/system"]

// "/m" is the machine QR scan route; it opens the machine terminal.
const OPERATOR_PAGES = ["/production/machine-selector", "/production/machine", "/m", "/maintenance", "/profile", "/help"]

function normalize(path: string) {
  const clean = String(path || "").split(/[?#]/)[0].replace(/\/+$/g, "")
  return clean || "/"
}

function under(path: string, prefix: string) {
  return path === prefix || path.startsWith(`${prefix}/`)
}

function roleOf(context: SidebarAccessContext) {
  return String(context.currentRoleCode || "").toUpperCase()
}

/** The sidebar entries that own this address: those with the longest matching href (one route
 * can sit in two sections, e.g. a screen listed under Operations and under Inventory). */
export function navTargetsForPath(pathname: string): NavAccessDescriptor[] {
  const path = normalize(pathname)
  let bestLength = 0
  let best: NavAccessDescriptor[] = []
  for (const item of NAV_ITEMS) {
    for (const entry of [item, ...(item.children || [])]) {
      const href = normalize(entry.href)
      if (href === "/" || !under(path, href)) continue
      if (href.length > bestLength) {
        bestLength = href.length
        best = [entry]
      } else if (href.length === bestLength) {
        best.push(entry)
      }
    }
  }
  return best
}

function navAllows(path: string, context: SidebarAccessContext): boolean | null {
  const targets = navTargetsForPath(path)
  if (!targets.length) return null
  return targets.some((target) => canAccessNavTarget(target, context))
}

export function canOpenPath(pathname: string, context: SidebarAccessContext): boolean {
  const path = normalize(pathname)
  if (!path.startsWith("/")) return true
  if (roleOf(context) === "OPERATOR") {
    return path === "/" || OPERATOR_PAGES.some((prefix) => under(path, prefix))
  }
  if (!GUARDED_AREAS.some((prefix) => under(path, prefix))) return true
  return navAllows(path, context) ?? true
}

// Planner and plant manager may look at the floor screens without them being in their sidebar.
const FLOOR_VIEWERS = new Set(["ADMIN", "OWNER", "SUPER_ADMIN", "PLANNER", "PLANT_MANAGER", "WORK_CENTER_MANAGER"])

/**
 * Whether a cross-link (order spine station, "open master"...) should be a link for this account:
 * the page must open for them and belong to their part of the system, so Sales, Store or Dispatch
 * never land on a floor screen their role cannot load.
 */
export function canFollowLink(href: string, context: SidebarAccessContext): boolean {
  if (!canOpenPath(href, context)) return false
  const path = normalize(href)
  if (navAllows(path, context) ?? true) return true
  return under(path, "/production") && FLOOR_VIEWERS.has(roleOf(context))
}

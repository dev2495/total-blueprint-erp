import type { RoleMatrix } from "@/services/rbac";
import type { PermissionCatalogEntry } from "@/services/system-users";
import { MODULE_ORDER } from "@/components/system-users/role-colors";

/** Roles that hold full access; their column is locked until unlocked on purpose. */
export const SYSTEM_ROLES = new Set(["OWNER", "ADMIN", "SUPER_ADMIN"]);

/** Preset: the everyday floor rights (same bundle as before the redesign). */
export const FLOOR_OPS_BUNDLE = [
  "users.self_manage",
  "dashboard.view",
  "notifications.view",
  "factory.view",
  "production.view",
  "inventory.view",
  "mrp.view",
] as const;

export type PermissionRow = {
  permission: string;
  moduleKey: string;
  actionKey: string;
  title: string;
  route?: string;
  assignable: boolean;
};

export type ModuleGroup = { key: string; label: string; hint?: string; rows: PermissionRow[] };

const MODULE_HINTS: Record<string, string> = {
  bills_documents:
    "Store holds these by default; Owner and Admin always have them. Give them to another role to upload, classify or file bills, record general receipts, manage gate passes or match outward photos. Watchman never receives office rights. Receiving stock against a bill also needs Inventory or Procurement manage.",
  page:
    "Page rights only show a screen in the menu. The data on that screen still needs the module's own right (for example Engineering · View for the Artwork page).",
};

export function normalizePermissionList(values: string[] | undefined | null): string[] {
  return Array.from(new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))).sort();
}

/** What each role holds now: its defaults and saved additions, less what an admin removed. */
export function draftFromMatrix(matrix?: RoleMatrix): Record<string, string[]> {
  const draft: Record<string, string[]> = {};
  Object.entries(matrix || {}).forEach(([roleCode, row]) => {
    const revoked = new Set(normalizePermissionList(row?.revoked_permissions));
    draft[roleCode] = normalizePermissionList([
      ...(row?.default_permissions || []),
      ...(row?.database_permissions || []),
    ]).filter((permission) => !revoked.has(permission));
  });
  return draft;
}

export function sameList(left: string[] | undefined, right: string[] | undefined): boolean {
  const a = normalizePermissionList(left);
  const b = normalizePermissionList(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function humanize(value: string): string {
  return String(value || "")
    .replace(/[_\-.]+/g, " ")
    .trim()
    .replace(/\w\S*/g, (part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase());
}

export function moduleLabel(moduleKey: string): string {
  const key = String(moduleKey || "").toLowerCase();
  return MODULE_ORDER.find((entry) => entry.key === key)?.label || humanize(key || "misc");
}

export function permissionTitle(permission: string, entry?: PermissionCatalogEntry): string {
  if (permission === "*") return "Full system access";
  if (entry?.label) return entry.label;
  const moduleName = humanize(entry?.module || permission.split(".")[0] || "");
  const actionName = humanize(entry?.action || permission.split(".").slice(1).join(" ") || "");
  return moduleName && actionName ? `${moduleName} · ${actionName}` : humanize(permission);
}

export function buildPermissionRows(
  catalog: PermissionCatalogEntry[],
  extraPermissions: Iterable<string> = [],
): PermissionRow[] {
  const byPermission = new Map<string, PermissionCatalogEntry>();
  catalog.forEach((entry) => {
    const permission = String(entry.permission || "").trim();
    if (permission) byPermission.set(permission, entry);
  });
  const all = new Set<string>(byPermission.keys());
  for (const permission of extraPermissions) if (permission) all.add(permission);
  return Array.from(all)
    .sort()
    .map((permission) => {
      const entry = byPermission.get(permission);
      return {
        permission,
        moduleKey: String(entry?.module || permission.split(".")[0] || "misc").toLowerCase(),
        actionKey: String(entry?.action || permission.split(".")[1] || "").toLowerCase(),
        title: permissionTitle(permission, entry),
        route: entry?.route,
        assignable: Boolean(entry?.assignable ?? permission !== "*"),
      };
    });
}

/** Rows grouped by module, in the product's module order, titles sorted inside each module. */
export function groupByModule(rows: PermissionRow[]): ModuleGroup[] {
  const groups = new Map<string, PermissionRow[]>();
  rows.forEach((row) => {
    const list = groups.get(row.moduleKey) || [];
    list.push(row);
    groups.set(row.moduleKey, list);
  });
  const order = new Map(MODULE_ORDER.map((entry, index) => [entry.key, index]));
  return Array.from(groups.entries())
    .sort(([left], [right]) => (order.get(left) ?? 999) - (order.get(right) ?? 999) || left.localeCompare(right))
    .map(([key, list]) => ({
      key,
      label: moduleLabel(key),
      hint: MODULE_HINTS[key],
      rows: [...list].sort((a, b) => a.title.localeCompare(b.title)),
    }));
}

export function matchesSearch(row: PermissionRow, query: string): boolean {
  if (!query) return true;
  return `${row.title} ${row.permission} ${row.moduleKey} ${row.route || ""}`.toLowerCase().includes(query);
}

/**
 * A page right (page.<module>.<screen>.view) shows the screen but not its data. Returns the module's view
 * right the screen reads with, when the catalogue has one, so the UI can say what is still missing.
 */
export function dataRightForPage(permission: string, known: Set<string>): string | null {
  if (!permission.startsWith("page.")) return null;
  const moduleKey = permission.split(".")[1];
  const candidate = moduleKey ? `${moduleKey}.view` : "";
  return candidate && known.has(candidate) ? candidate : null;
}

export function errorDetail(error: unknown): string {
  const typed = error as { message?: string; response?: { data?: unknown } };
  const data = typed?.response?.data as { detail?: unknown; error?: unknown } | undefined;
  const detail = data?.detail ?? data?.error;
  if (typeof detail === "string") return detail;
  if (detail) return JSON.stringify(detail);
  if (data && typeof data === "object") return JSON.stringify(data);
  return typed?.message || "Request failed";
}

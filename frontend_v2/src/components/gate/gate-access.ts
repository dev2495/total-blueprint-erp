import { getCanonicalRoleCode } from "@/lib/roles";

type GateUserLike = {
  is_owner?: boolean;
  is_superuser?: boolean;
  role_info?: { code?: string } | null;
  entitlements?: {
    role?: string;
    permissions?: string[];
    permission_map?: Record<string, string[]>;
    context?: { gate_plants?: string[] } & Record<string, unknown>;
  } | null;
} | null | undefined;

export const GATE_PERMISSIONS = {
  log: "gate.log",
  view: "gate.view",
  reconcile: "gate.reconcile",
  audit: "gate.audit",
  private: "gate.private",
  reports: "gate.reports",
} as const;

export function isWatchmanUser(user: GateUserLike, effectiveRole?: string | null): boolean {
  const codes = [user?.role_info?.code, user?.entitlements?.role, effectiveRole].map((code) => getCanonicalRoleCode(code));
  return codes.includes("WATCHMAN");
}

/**
 * Literal grant only: a "*" wildcard (ADMIN) never implies gate capabilities.
 * See docs/gate-rbac-frontend-contract.md.
 */
function hasLiteralGrant(user: GateUserLike, permission: string): boolean {
  const permissions = user?.entitlements?.permissions || [];
  if (permissions.includes(permission)) return true;
  const [moduleKey, action] = permission.split(".", 2);
  return Boolean(action && (user?.entitlements?.permission_map?.[moduleKey] || []).includes(action));
}

/** Actual owner: is_owner flag or the canonical OWNER role — never a role preview or ADMIN. */
export function isGateOwner(user: GateUserLike, effectiveRole?: string | null): boolean {
  if (!user || isWatchmanUser(user, effectiveRole)) return false;
  return Boolean(user.is_owner) || getCanonicalRoleCode(user.role_info?.code) === "OWNER";
}

export function canLogAtGate(user: GateUserLike, effectiveRole?: string | null): boolean {
  if (!user) return false;
  if (isWatchmanUser(user, effectiveRole)) return true;
  return isGateOwner(user, effectiveRole) || hasLiteralGrant(user, GATE_PERMISSIONS.log);
}

/** Report tab: owner, or an explicit gate.reports grant (not analytics.view, not "*"). */
export function canViewGateReports(user: GateUserLike, effectiveRole?: string | null): boolean {
  if (!user || isWatchmanUser(user, effectiveRole)) return false;
  return isGateOwner(user, effectiveRole) || hasLiteralGrant(user, GATE_PERMISSIONS.reports);
}

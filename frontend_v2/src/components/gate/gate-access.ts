import { getCanonicalRoleCode } from "@/lib/roles";

type GateUserLike = {
  is_owner?: boolean;
  is_superuser?: boolean;
  role_info?: { code?: string } | null;
  entitlements?: {
    role?: string;
    /** Backend PermissionService.is_gate_master (watchman ceiling already applied). */
    gate_master?: boolean;
    /** Backend PermissionService.has_inventory_bill_review (explicit; wildcards never imply it). */
    inventory_bill_review?: boolean;
    inventory_bill_scope?: "ALL_PLANTS" | "NONE" | string;
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

/** Actual roles that receive the full Gate pack by default. */
export const GATE_MASTER_ROLES = ["ADMIN", "SUPER_ADMIN", "OWNER"] as const;

/**
 * Literal grant only: a "*" wildcard never implies a delegated gate capability.
 * Masters get full access through `isGateMaster`, not through "*".
 */
function hasLiteralGrant(user: GateUserLike, permission: string): boolean {
  const permissions = user?.entitlements?.permissions || [];
  if (permissions.includes(permission)) return true;
  const [moduleKey, action] = permission.split(".", 2);
  return Boolean(action && (user?.entitlements?.permission_map?.[moduleKey] || []).includes(action));
}

/**
 * Full Gate access (setup, terminal, history, corrections, audit, QR, report
 * and daily pack). Mirrors backend `PermissionService.is_gate_master`:
 * 1. WATCHMAN ceiling first — actual or effective (preview) watchman never qualifies.
 * 2. Otherwise the ACTUAL role ADMIN / SUPER_ADMIN / OWNER, or is_owner, or
 *    is_superuser. A non-watchman role preview (e.g. Admin previewing Owner,
 *    Sales, …) does not remove it. When the backend sends `gate_master`, it wins.
 */
export function isGateMaster(user: GateUserLike, effectiveRole?: string | null): boolean {
  if (!user || isWatchmanUser(user, effectiveRole)) return false;
  const flag = user.entitlements?.gate_master;
  if (typeof flag === "boolean") return flag;
  const actual = getCanonicalRoleCode(user.role_info?.code);
  return (GATE_MASTER_ROLES as readonly string[]).includes(actual) || Boolean(user.is_owner) || Boolean(user.is_superuser);
}

/** Kept for existing call sites: "owner" surfaces are master surfaces. */
export const isGateOwner = isGateMaster;

export function canLogAtGate(user: GateUserLike, effectiveRole?: string | null): boolean {
  if (!user) return false;
  if (isWatchmanUser(user, effectiveRole)) return true;
  return isGateMaster(user, effectiveRole) || hasLiteralGrant(user, GATE_PERMISSIONS.log);
}

/** Report tab: masters, or an explicit gate.reports grant (sanitized delegate). */
export function canViewGateReports(user: GateUserLike, effectiveRole?: string | null): boolean {
  if (!user || isWatchmanUser(user, effectiveRole)) return false;
  return isGateMaster(user, effectiveRole) || hasLiteralGrant(user, GATE_PERMISSIONS.reports);
}

/**
 * Inventory gate-bill queue / private bill images / receiving actions.
 * Mirrors backend `has_inventory_bill_review`: WATCHMAN (actual or previewed)
 * never qualifies; then the explicit `entitlements.inventory_bill_review`
 * flag decides (masters, default STORE, or literal gate.bill.review + receipt
 * authority). A "*" wildcard, gate.reports or a role preview never grants it.
 */
export function canReviewGateBills(user: GateUserLike, effectiveRole?: string | null): boolean {
  if (!user || isWatchmanUser(user, effectiveRole)) return false;
  const flag = user.entitlements?.inventory_bill_review;
  if (typeof flag === "boolean") return flag;
  // Older payloads without the flag: masters only (never infer from "*").
  return isGateMaster(user, effectiveRole);
}

/** Recording a bill arrival at the gate: the watchman, or a master account. */
export function canSubmitGateBills(user: GateUserLike, effectiveRole?: string | null): boolean {
  if (!user) return false;
  return isWatchmanUser(user, effectiveRole) || isGateMaster(user, effectiveRole);
}

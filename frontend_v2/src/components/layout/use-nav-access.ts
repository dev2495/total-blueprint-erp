"use client";

import { useCallback, useMemo } from "react";

import { useAuth } from "@/components/auth-provider";
import { canFollowLink } from "@/lib/page-access";
import type { SidebarAccessContext } from "@/lib/sidebar-nav";

/** The signed-in account's access context, built the same way the sidebar builds it. */
export function useNavAccessContext(): SidebarAccessContext {
  const { user, effectiveRole } = useAuth();
  const currentRoleCode = effectiveRole || user?.entitlements?.role || user?.role_info?.code || "GUEST";
  const baseRoleCode = user?.role_info?.code || "GUEST";
  const grantedPermissions = user?.extra_permissions || user?.entitlements?.extra_overrides || [];
  return useMemo(
    () => ({
      currentRoleCode,
      baseRoleCode,
      isOwner: user?.is_owner,
      isSuperuser: user?.is_superuser,
      gateMaster: user?.entitlements?.gate_master,
      inventoryBillReview: user?.entitlements?.inventory_bill_review,
      documentEntitlements: user?.entitlements?.documents,
      grantedPermissions,
    }),
    [
      currentRoleCode,
      baseRoleCode,
      grantedPermissions,
      user?.is_owner,
      user?.is_superuser,
      user?.entitlements?.gate_master,
      user?.entitlements?.inventory_bill_review,
      user?.entitlements?.documents,
    ],
  );
}

/** `canFollow(href)`: false for a page this account should not be sent to, so the link can be hidden. */
export function useCanFollowLink() {
  const context = useNavAccessContext();
  return useCallback((href?: string | null) => (href ? canFollowLink(href, context) : false), [context]);
}

/** `can(code)`: whether the account's effective permissions (role, grants, revocations) include a code. */
export function useHasPermission() {
  const { user } = useAuth();
  const permissions: string[] = user?.entitlements?.permissions || [];
  return useCallback((code: string) => permissions.includes("*") || permissions.includes(code), [permissions]);
}

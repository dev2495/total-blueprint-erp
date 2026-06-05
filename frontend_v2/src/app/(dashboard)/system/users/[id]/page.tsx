"use client";

import { useParams } from "next/navigation";
import { UserEditor } from "@/components/system-users/user-editor";
import { useAuth } from "@/components/auth-provider";

function userCanManageRbac(user: any): boolean {
  if (!user) return false;
  if (user.is_superuser || user.is_owner) return true;
  const perms: string[] = user.entitlements?.permissions || [];
  if (perms.includes("*")) return true;
  return perms.includes("rbac.manage");
}

export default function UserEditPage() {
  const params = useParams<{ id: string }>();
  const { user: me } = useAuth();
  const id = params?.id || "";
  const canManage = userCanManageRbac(me);
  // Only an existing OWNER may flip the owner flag.
  const canEditOwnerToggle = !!me?.is_owner || !!me?.is_superuser;

  return (
    <UserEditor
      mode="edit"
      userId={id}
      canManage={canManage}
      canEditOwnerToggle={canEditOwnerToggle}
    />
  );
}

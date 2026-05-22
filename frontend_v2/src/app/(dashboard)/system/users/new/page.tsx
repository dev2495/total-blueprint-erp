"use client"

import { UserEditor } from "@/components/system-users/user-editor"
import { useAuth } from "@/components/auth-provider"

function userCanManageRbac(user: any): boolean {
    if (!user) return false
    if (user.is_superuser || user.is_owner) return true
    const perms: string[] = user.entitlements?.permissions || []
    if (perms.includes("*")) return true
    return perms.includes("rbac.manage")
}

export default function NewUserPage() {
    const { user: me } = useAuth()
    const canManage = userCanManageRbac(me)
    const canEditOwnerToggle = !!me?.is_owner || !!me?.is_superuser

    return (
        <UserEditor
            mode="new"
            canManage={canManage}
            canEditOwnerToggle={canEditOwnerToggle}
        />
    )
}

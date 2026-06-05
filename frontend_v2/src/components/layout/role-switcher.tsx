"use client"

import { useState, useEffect } from "react"
import Cookies from "js-cookie"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { useAuth } from "@/components/auth-provider"
import { ShieldCheck } from "lucide-react"
import { ROLES, getLandingPage } from "@/lib/roles"
import { cn } from "@/lib/utils"

export function RoleSwitcher({ compact = false, triggerTestId = "role-switcher-trigger" }: { compact?: boolean; triggerTestId?: string }) {
    const { user, effectiveRole } = useAuth()
    const [currentRole, setCurrentRole] = useState<string>("")
    const baseRoleCode = String(user?.role_info?.code || user?.entitlements?.role || "").toUpperCase()
    const canSwitchRoles = Boolean(
        user?.is_owner ||
        user?.is_superuser ||
        ["ADMIN", "OWNER", "SUPER_ADMIN"].includes(baseRoleCode),
    )

    useEffect(() => {
        if (effectiveRole) {
            setCurrentRole(effectiveRole)
        } else if (user?.role_info?.code) {
            setCurrentRole(user.role_info.code)
        }
    }, [effectiveRole, user])

    if (!canSwitchRoles) {
        return null
    }

    const handleRoleChange = (role: string) => {
        if (role === "RESET") {
            Cookies.remove("x_role_override")
            const primaryRole = user?.role_info?.code || "ADMIN"
            window.location.href = getLandingPage(primaryRole) || "/"
        } else {
            Cookies.set("x_role_override", role)
            window.location.href = getLandingPage(role) || "/"
        }
    }

    return (
        <div className={cn("flex items-center gap-2", compact && "min-w-0") }>
            {!compact ? (
                <div className="flex items-center gap-1.5 rounded-lg border border-amber-100 bg-warning-bg px-2 py-1">
                    <ShieldCheck className="h-3.5 w-3.5 text-amber-600" />
                    <span className="text-[10px] font-bold uppercase tracking-tight text-warning-fg">Master View</span>
                </div>
            ) : null}
            <Select value={currentRole} onValueChange={handleRoleChange}>
                <SelectTrigger
                    className={cn(
                        "border-slate-200 bg-surface-1 text-slate-700 transition-colors hover:bg-slate-50",
                        compact
                            ? "h-10 w-[132px] rounded-2xl px-3 text-[11px] font-black uppercase tracking-[0.14em]"
                            : "h-8 w-[160px] text-xs font-bold",
                    )}
                    data-testid={triggerTestId}
                >
                    {compact ? <ShieldCheck className="mr-1.5 h-3.5 w-3.5 text-amber-600" /> : null}
                    <SelectValue placeholder="Switch Role" />
                </SelectTrigger>
                <SelectContent>
                    {ROLES.map((r) => (
                        <SelectItem key={r.code} value={r.code} className="text-xs">
                            {r.name}
                        </SelectItem>
                    ))}
                    <div className="my-1 border-t" />
                    <SelectItem value="RESET" className="text-xs font-bold text-red-600 focus:bg-red-50 focus:text-red-700">
                        Reset to Primary
                    </SelectItem>
                </SelectContent>
            </Select>
        </div>
    )
}

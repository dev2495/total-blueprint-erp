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

export function RoleSwitcher() {
    const { user, effectiveRole } = useAuth()
    const [currentRole, setCurrentRole] = useState<string>("")

    useEffect(() => {
        // Use effectiveRole from auth context (considers role override)
        if (effectiveRole) {
            setCurrentRole(effectiveRole)
        } else if (user?.role_info?.code) {
            setCurrentRole(user.role_info.code)
        }
    }, [effectiveRole, user])

    if (!user?.is_owner && user?.role_info?.code !== "ADMIN") {
        return null
    }

    const handleRoleChange = (role: string) => {
        if (role === "RESET") {
            Cookies.remove("x_role_override");
            // Go to primary role landing page
            const primaryRole = user?.role_info?.code || "ADMIN";
            window.location.href = getLandingPage(primaryRole) || "/";
        } else {
            Cookies.set("x_role_override", role);
            // Go to the selected role's landing page
            window.location.href = getLandingPage(role) || "/";
        }
    }

    return (
        <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 px-2 py-1 bg-amber-50 rounded-lg border border-amber-100">
                <ShieldCheck className="h-3.5 w-3.5 text-amber-600" />
                <span className="text-[10px] font-bold text-amber-700 uppercase tracking-tight">Master View</span>
            </div>
            <Select value={currentRole} onValueChange={handleRoleChange}>
                <SelectTrigger className="w-[160px] h-8 text-xs font-bold bg-white border-slate-200 text-slate-700 hover:bg-slate-50 transition-colors" data-testid="role-switcher-trigger">
                    <SelectValue placeholder="Switch Role" />
                </SelectTrigger>
                <SelectContent>
                    {ROLES.map((r) => (
                        <SelectItem key={r.code} value={r.code} className="text-xs">
                            {r.name}
                        </SelectItem>
                    ))}
                    <div className="border-t my-1" />
                    <SelectItem value="RESET" className="text-xs text-red-600 font-bold focus:bg-red-50 focus:text-red-700">
                        Reset to Primary
                    </SelectItem>
                </SelectContent>
            </Select>
        </div>
    )
}

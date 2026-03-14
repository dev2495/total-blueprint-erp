"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useAuth } from "@/components/auth-provider"
import { Button } from "@/components/ui/button"
import { AlertTriangle } from "lucide-react"
import { CommandPalette } from "@/components/layout/command-palette"
import { LocationCapsule } from "@/components/layout/location-capsule"
import { RoleSwitcher } from "@/components/layout/role-switcher"
import { NotificationBell } from "@/components/layout/notification-bell"
import { UserProfileMenu } from "@/components/layout/user-profile-menu"
import { ContextHelpSheet } from "@/components/help/context-help-sheet"
import { getCanonicalRoleLabel } from "@/lib/roles"

export function Header() {
    const { user, effectiveRole } = useAuth()
    const pathname = usePathname()

    // Get role display name
    const getRoleDisplayName = () => {
        return getCanonicalRoleLabel(effectiveRole || user?.role_info?.code, user?.role_info?.name)
    };

    return (
        <header className="sticky top-4 z-30 mx-4 lg:mx-8 flex h-16 items-center gap-4 rounded-2xl bg-white/70 backdrop-blur-xl border border-white px-6 shadow-premium transition-all duration-300 hover:shadow-premium-hover">
            <div className="flex w-full items-center gap-4 md:ml-auto md:gap-4 lg:gap-6">
                <div className="flex-1 max-w-4xl flex items-center gap-3">
                    <CommandPalette />
                    <LocationCapsule />
                </div>
                <div className="flex items-center gap-4">
                    <RoleSwitcher />
                    <div className="hidden sm:flex items-center gap-2 px-4 py-1.5 rounded-xl bg-white shadow-sm border border-slate-100/80">
                        <div className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)] animate-pulse" />
                        <span className="text-[11px] font-black uppercase tracking-widest text-slate-600">
                            {getRoleDisplayName()}
                        </span>
                    </div>

                    <div className="flex items-center border-l border-slate-100 ml-2 pl-4 gap-2">
                        <ContextHelpSheet />
                        <NotificationBell />
                        {Boolean(user?.email_missing) && pathname !== "/profile" ? (
                            <Button asChild variant="outline" className="h-10 rounded-xl border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100">
                                <Link href="/profile">
                                    <AlertTriangle className="h-4 w-4 mr-1.5" />
                                    Update email
                                </Link>
                            </Button>
                        ) : null}
                        <UserProfileMenu />
                    </div>
                </div>
            </div>
        </header>
    )
}

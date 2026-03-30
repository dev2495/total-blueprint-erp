"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState } from "react"
import { useAuth } from "@/components/auth-provider"
import { Button } from "@/components/ui/button"
import { AlertTriangle, Menu } from "lucide-react"
import { CommandPalette } from "@/components/layout/command-palette"
import { LocationCapsule } from "@/components/layout/location-capsule"
import { RoleSwitcher } from "@/components/layout/role-switcher"
import { NotificationBell } from "@/components/layout/notification-bell"
import { UserProfileMenu } from "@/components/layout/user-profile-menu"
import { ContextHelpSheet } from "@/components/help/context-help-sheet"
import { getCanonicalRoleLabel } from "@/lib/roles"
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetClose,
    SheetTitle,
    SheetTrigger,
} from "@/components/ui/sheet"
import { SidebarBrand, SidebarFooterProfile, SidebarNavContent } from "@/components/layout/sidebar-content"

export function Header() {
    const { user, effectiveRole } = useAuth()
    const pathname = usePathname()
    const [mobileNavOpen, setMobileNavOpen] = useState(false)

    // Get role display name
    const getRoleDisplayName = () => {
        return getCanonicalRoleLabel(effectiveRole || user?.role_info?.code, user?.role_info?.name)
    };

    return (
        <header className="sticky top-2 z-50 mx-3 flex min-h-[72px] items-center gap-3 rounded-[1.75rem] border border-white/80 bg-white/80 px-3 py-3 shadow-premium backdrop-blur-xl transition-all duration-300 hover:shadow-premium-hover md:top-3 md:mx-4 md:px-4 lg:top-4 lg:mx-8 lg:px-6">
            <div className="flex w-full items-center gap-3 md:gap-4 lg:gap-6">
                <div className="flex items-center gap-2 lg:hidden">
                    <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
                        <SheetTrigger asChild>
                            <Button
                                variant="outline"
                                size="icon"
                                className="h-11 w-11 rounded-2xl border-slate-200 bg-white/95 shadow-sm"
                                data-testid="mobile-nav-trigger"
                            >
                                <Menu className="h-5 w-5" />
                            </Button>
                        </SheetTrigger>
                        <SheetContent
                            side="left"
                            className="w-[min(92vw,24rem)] border-r border-slate-200 bg-[#f8fbff]/95 p-0 backdrop-blur-2xl"
                        >
                            <div className="flex h-full flex-col">
                                <SheetHeader className="border-b border-slate-200/60 px-5 py-5 text-left">
                                    <SheetTitle className="sr-only">Navigation</SheetTitle>
                                    <SheetDescription className="sr-only">
                                        Open navigation menu for ERP modules.
                                    </SheetDescription>
                                    <SheetClose asChild>
                                        <div>
                                            <SidebarBrand compact />
                                        </div>
                                    </SheetClose>
                                </SheetHeader>
                                <div className="flex-1 overflow-y-auto px-3 py-4 scrollbar-elegant">
                                    <SidebarNavContent mobile onNavigate={() => setMobileNavOpen(false)} />
                                </div>
                                <div className="border-t border-slate-200/60 p-3">
                                    <SidebarFooterProfile compact />
                                </div>
                            </div>
                        </SheetContent>
                    </Sheet>
                </div>

                <div className="flex min-w-0 flex-1 items-center gap-3">
                    <div className="hidden min-w-0 flex-1 items-center gap-3 sm:flex lg:max-w-[18rem] xl:max-w-[24rem]">
                        <CommandPalette />
                    </div>
                    <div className="hidden shrink-0 lg:flex">
                        <LocationCapsule />
                    </div>
                </div>

                <div className="flex shrink-0 items-center gap-2 sm:gap-3 lg:gap-4">
                    <div className="relative z-10 hidden md:block">
                        <RoleSwitcher />
                    </div>
                    <div className="hidden md:flex items-center gap-2 rounded-2xl border border-slate-100/80 bg-white px-3 py-2 shadow-sm">
                        <div className="w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)] animate-pulse" />
                        <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-600 lg:text-[11px]">
                            {getRoleDisplayName()}
                        </span>
                    </div>

                    <div className="flex items-center gap-1 border-l border-slate-100 pl-2 sm:gap-2 sm:pl-3 lg:ml-1 lg:pl-4">
                        <ContextHelpSheet />
                        <NotificationBell />
                        {Boolean(user?.email_missing) && pathname !== "/profile" ? (
                            <Button asChild variant="outline" className="hidden h-10 rounded-xl border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 lg:inline-flex">
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

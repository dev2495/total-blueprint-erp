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

    const getRoleDisplayName = () => {
        return getCanonicalRoleLabel(effectiveRole || user?.role_info?.code, user?.role_info?.name)
    }

    return (
        <header className="fixed left-0 right-0 top-0 z-50 border-b border-white/80 bg-white/95 px-3 py-2 shadow-premium backdrop-blur-xl transition-all duration-300 md:left-4 md:right-4 md:top-3 md:rounded-[1.75rem] md:border md:px-4 md:py-3 md:hover:shadow-premium-hover lg:sticky lg:left-auto lg:right-auto lg:top-4 lg:mx-8 lg:px-6">
            <div className="flex w-full flex-col gap-2.5 lg:hidden">
                <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
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
                                className="w-[min(82vw,19.5rem)] border-r border-slate-200 bg-white p-0 shadow-[24px_0_80px_-56px_rgba(15,23,42,0.65)] backdrop-blur-2xl"
                            >
                                <div className="flex h-full flex-col">
                                    <SheetHeader className="border-b border-slate-100 px-4 py-4 text-left">
                                        <SheetTitle className="sr-only">Navigation</SheetTitle>
                                        <SheetDescription className="sr-only">
                                            Open navigation menu for ERP modules.
                                        </SheetDescription>
                                        <SheetClose asChild>
                                            <div>
                                                <SidebarBrand />
                                            </div>
                                        </SheetClose>
                                    </SheetHeader>
                                    <div className="scrollbar-elegant flex-1 overflow-y-auto px-2.5 py-3">
                                        <SidebarNavContent mobile onNavigate={() => setMobileNavOpen(false)} />
                                    </div>
                                    <div className="border-t border-slate-100 p-2.5">
                                        <SidebarFooterProfile />
                                    </div>
                                </div>
                            </SheetContent>
                        </Sheet>
                        <div className="min-w-0 rounded-2xl border border-slate-100/80 bg-white px-3 py-2 shadow-sm">
                            <div className="truncate text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">Current role</div>
                            <div className="truncate text-[11px] font-bold text-slate-800">{getRoleDisplayName()}</div>
                        </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                        <ContextHelpSheet />
                        <NotificationBell />
                        <UserProfileMenu />
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                        <CommandPalette compact />
                    </div>
                    <div className="shrink-0">
                        <RoleSwitcher compact />
                    </div>
                </div>

                <div className="flex min-w-0 items-center gap-2">
                    <div className="min-w-0 flex-1">
                        <LocationCapsule compact />
                    </div>
                    {Boolean(user?.email_missing) && pathname !== "/profile" ? (
                        <Button asChild variant="outline" className="h-10 shrink-0 rounded-2xl border-amber-300 bg-amber-50 px-3 text-xs font-semibold text-amber-700 hover:bg-amber-100">
                            <Link href="/profile">
                                <AlertTriangle className="mr-1.5 h-4 w-4" />
                                Email
                            </Link>
                        </Button>
                    ) : null}
                </div>
            </div>

            <div className="hidden w-full items-center gap-3 md:gap-4 lg:flex lg:gap-6">
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
                    <div className="hidden items-center gap-2 rounded-2xl border border-slate-100/80 bg-white px-3 py-2 shadow-sm md:flex">
                        <div className="h-2 w-2 animate-pulse rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
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
                                    <AlertTriangle className="mr-1.5 h-4 w-4" />
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

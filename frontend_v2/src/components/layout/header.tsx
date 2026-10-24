"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Menu } from "lucide-react";
import { CommandPalette } from "@/components/layout/command-palette";
import { LocationCapsule } from "@/components/layout/location-capsule";
import { RoleSwitcher } from "@/components/layout/role-switcher";
import { FinancialYearPicker } from "@/components/layout/financial-year-picker";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { NotificationBell } from "@/components/layout/notification-bell";
import { ScanButton } from "@/components/scan/scan-button";
import { UserProfileMenu } from "@/components/layout/user-profile-menu";
import { ContextHelpSheet } from "@/components/help/context-help-sheet";
import { getCanonicalRoleLabel } from "@/lib/roles";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetClose,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  SidebarBrand,
  SidebarFooterProfile,
  SidebarNavContent,
} from "@/components/layout/sidebar-content";

export function Header() {
  const { user, effectiveRole } = useAuth();
  const pathname = usePathname();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // The missing-email reminder shows once per browser session, not on every page.
  const [emailReminderDismissed, setEmailReminderDismissed] = useState(false);
  useEffect(() => {
    try {
      if (window.sessionStorage.getItem("erp.emailReminderDismissed") === "1") setEmailReminderDismissed(true);
    } catch {}
  }, []);

  const getRoleDisplayName = () => {
    return getCanonicalRoleLabel(
      effectiveRole || user?.role_info?.code,
      user?.role_info?.name,
    );
  };

  return (
    <header className="erp-glass-chrome fixed left-0 right-0 top-0 z-50 border-b border-line bg-surface-1/90 px-3 py-2 backdrop-blur-md transition-[background-color,border-color,box-shadow] duration-150 md:left-4 md:right-4 md:top-3 md:rounded-[14px] md:border md:px-4 md:py-2.5 md:shadow-[var(--shadow-sm)] lg:sticky lg:left-auto lg:right-auto lg:top-3 lg:mx-6 lg:px-4 xl:mx-8">
      <div className="flex w-full flex-col gap-2.5 lg:hidden">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-11 w-11 rounded-[10px] border-line bg-surface-1 shadow-none"
                  data-testid="mobile-nav-trigger"
                  aria-label="Open navigation"
                >
                  <Menu className="h-5 w-5" />
                </Button>
              </SheetTrigger>
              <SheetContent
                side="left"
                className="w-[min(82vw,19.5rem)] border-r border-line bg-surface-1 p-0"
              >
                <div className="flex h-full flex-col">
                  <SheetHeader className="border-b border-line px-4 py-4 text-left">
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
                    <SidebarNavContent
                      mobile
                      onNavigate={() => setMobileNavOpen(false)}
                    />
                  </div>
                  <div className="border-t border-line p-2.5">
                    <SidebarFooterProfile />
                  </div>
                </div>
              </SheetContent>
            </Sheet>
            <div className="min-w-0 rounded-[10px] border border-line bg-surface-2 px-3 py-2">
              <div className="truncate text-caption font-medium text-content-3">
                Role
              </div>
              <div className="truncate text-caption font-semibold text-content-1">
                {getRoleDisplayName()}
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <ThemeToggle compact />
            <ContextHelpSheet />
            <ScanButton compact testId="scan-trigger-mobile" />
            <NotificationBell triggerTestId="notification-bell-trigger-mobile" />
            <UserProfileMenu triggerTestId="profile-menu-trigger-mobile" />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <CommandPalette
              compact
              triggerTestId="command-palette-trigger-mobile"
            />
          </div>
          <div className="shrink-0">
            <RoleSwitcher
              compact
              triggerTestId="role-switcher-trigger-mobile"
            />
          </div>
        </div>

        <div className="flex min-w-0 items-center gap-2">
          <div className="min-w-0 flex-1">
            <LocationCapsule compact />
          </div>
          {Boolean(user?.email_missing) && pathname !== "/profile" ? (
            <Button
              asChild
              variant="outline"
              className="h-10 shrink-0 rounded-[10px] border-warning-border bg-warning-bg px-3 text-xs font-medium text-warning-fg hover:bg-warning-bg"
            >
              <Link href="/profile">
                <AlertTriangle className="mr-1.5 h-4 w-4" />
                Email
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      <div className="hidden w-full items-center gap-3 md:gap-4 lg:flex lg:gap-6">
        {/* Clipped (not overlapped) when the right-hand controls need the room; the padding keeps focus rings visible. */}
        <div className="-my-1 -ml-1 flex min-w-0 flex-1 items-center gap-3 overflow-hidden py-1 pl-1">
          <div className="hidden min-w-[9rem] max-w-[12rem] flex-1 items-center gap-3 sm:flex lg:flex lg:max-w-[12rem] xl:w-48 xl:min-w-[12rem] xl:max-w-[12rem] xl:flex-none">
            <CommandPalette />
          </div>
          <div className="scrollbar-elegant hidden min-w-[7rem] max-w-[12rem] flex-[1_1_9rem] overflow-x-auto lg:flex xl:min-w-[9rem] xl:max-w-[18rem]">
            <LocationCapsule />
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3 lg:gap-4">
          <FinancialYearPicker className="hidden xl:flex" />
          <div className="relative z-10 hidden md:block">
            <RoleSwitcher />
          </div>
          <div className="hidden items-center gap-2 rounded-[10px] border border-line bg-surface-2 px-3 py-2 2xl:flex">
            <div aria-hidden="true" className="h-2 w-2 rounded-full bg-success-fg" />
            <span className="text-caption font-medium text-content-2 lg:text-caption">
              {getRoleDisplayName()}
            </span>
          </div>

          <div className="flex items-center gap-1 border-l border-line pl-2 sm:gap-2 sm:pl-3 lg:ml-1 lg:pl-4">
            <ThemeToggle />
            <ContextHelpSheet />
            <ScanButton compact testId="scan-trigger" />
            <NotificationBell />
            {Boolean(user?.email_missing) && pathname !== "/profile" && !emailReminderDismissed ? (
              <div className="hidden items-center gap-1 lg:flex">
                <Button
                  asChild
                  variant="outline"
                  className="h-10 rounded-[10px] border-warning-border bg-warning-bg font-medium text-warning-fg hover:bg-warning-bg"
                >
                  <Link href="/profile">
                    <AlertTriangle className="mr-1.5 h-4 w-4" />
                    Add your email
                  </Link>
                </Button>
                <button
                  type="button"
                  aria-label="Hide the email reminder for this session"
                  className="h-8 w-8 rounded-[8px] text-content-3 transition-colors duration-150 hover:bg-surface-2 hover:text-content-1"
                  onClick={() => {
                    setEmailReminderDismissed(true);
                    try {
                      window.sessionStorage.setItem("erp.emailReminderDismissed", "1");
                    } catch {}
                  }}
                >
                  ×
                </button>
              </div>
            ) : null}
            <UserProfileMenu />
          </div>
        </div>
      </div>
    </header>
  );
}

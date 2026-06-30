"use client";

import {
  SidebarBrand,
  SidebarFooterProfile,
  SidebarNavContent,
} from "@/components/layout/sidebar-content";
import { useAuth } from "@/components/auth-provider";
import { useDashboardChrome } from "@/components/layout/dashboard-chrome";
import { cn } from "@/lib/utils";
import { ChevronsLeft, Pin } from "lucide-react";

export function Sidebar() {
  const { user } = useAuth();
  const { isPinned, isExpanded, togglePinned } = useDashboardChrome();

  if (!user) return null;

  return (
    <div className="pointer-events-none fixed inset-y-0 left-0 z-40 hidden lg:block">
      <aside
        style={{ transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)" }}
        className={cn(
          "pointer-events-auto group/sidebar my-3 ml-3 flex h-[calc(100vh-1.5rem)] flex-col rounded-3xl border border-surface-1 bg-surface-1/92 shadow-[0_26px_80px_-48px_rgba(15,23,42,0.6)] ring-1 ring-line-strong/[0.04] backdrop-blur-2xl transition-[width,box-shadow,transform] duration-500",
          isExpanded
            ? "w-[284px] overflow-hidden shadow-[0_34px_96px_-54px_rgba(15,23,42,0.46)]"
            : "w-[64px] overflow-visible shadow-[0_22px_64px_-46px_rgba(15,23,42,0.52)]",
        )}
      >
        <div
          className={cn(
            "relative flex h-[78px] shrink-0 items-center border-b border-line bg-surface-1/70 transition-all duration-300",
            isExpanded ? "justify-between px-5" : "justify-center px-2",
          )}
        >
          <div
            className={cn(
              "min-w-0 transition-opacity duration-200",
              isExpanded ? "opacity-100" : "opacity-100",
            )}
          >
            <SidebarBrand compact={!isExpanded} />
          </div>
          {isExpanded ? (
            <button
              type="button"
              onClick={togglePinned}
              aria-label={isPinned ? "Close navigation" : "Open navigation"}
              className={cn(
                "ml-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border text-content-3 transition-all duration-200 hover:-translate-y-0.5 hover:text-content-1",
                isPinned
                  ? "border-primary bg-primary text-white hover:text-white"
                  : "border-line bg-surface-1 shadow-sm",
              )}
            >
              {isPinned ? (
                <ChevronsLeft className="h-4 w-4" />
              ) : (
                <Pin className="h-4 w-4" />
              )}
            </button>
          ) : (
            <button
              type="button"
              onClick={togglePinned}
              aria-label="Open navigation"
              className="absolute -right-3 top-5 flex h-8 w-8 items-center justify-center rounded-full border border-line bg-surface-1 text-content-2 shadow-lg ring-1 ring-line-strong/[0.04] transition-all duration-200 hover:-translate-y-0.5 hover:border-primary hover:bg-primary hover:text-white"
            >
              <Pin className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="relative min-h-0 flex-1">
          <div
            className={cn(
              "scrollbar-elegant absolute inset-0 px-2 py-3 transition-[opacity,transform,filter] duration-300 ease-out",
              isExpanded ? "overflow-hidden" : "overflow-visible",
              isExpanded
                ? "pointer-events-none -translate-x-2 opacity-0 blur-[1px]"
                : "translate-x-0 opacity-100 blur-0 delay-100",
            )}
            aria-hidden={isExpanded}
          >
            <SidebarNavContent compact />
          </div>

          <div
            className={cn(
              "scrollbar-elegant absolute inset-0 overflow-y-auto px-3 py-4 transition-[opacity,transform,filter] duration-300 ease-out",
              isExpanded
                ? "translate-x-0 opacity-100 blur-0 delay-150"
                : "pointer-events-none -translate-x-3 opacity-0 blur-[1px]",
            )}
            aria-hidden={!isExpanded}
          >
            <SidebarNavContent />
          </div>
        </div>

        <div className="relative h-[61px] shrink-0 border-t border-line bg-surface-1/75 p-2">
          <div
            className={cn(
              "absolute inset-2 transition-[opacity,transform,filter] duration-300 ease-out",
              isExpanded
                ? "translate-x-0 opacity-100 blur-0 delay-150"
                : "pointer-events-none -translate-x-3 opacity-0 blur-[1px]",
            )}
          >
            <SidebarFooterProfile />
          </div>
          <div
            className={cn(
              "absolute inset-2 transition-[opacity,transform,filter] duration-300 ease-out",
              isExpanded
                ? "pointer-events-none -translate-x-2 opacity-0 blur-[1px]"
                : "translate-x-0 opacity-100 blur-0 delay-100",
            )}
          >
            <SidebarFooterProfile compact />
          </div>
        </div>
      </aside>
    </div>
  );
}

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
  const { isPinned, isExpanded, setHovering, togglePinned } =
    useDashboardChrome();

  if (!user) return null;

  return (
    <div className="pointer-events-none fixed inset-y-0 left-0 z-40 hidden lg:block">
      <aside
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        className={cn(
          "erp-glass-chrome pointer-events-auto group/sidebar my-3 ml-3 flex h-[calc(100vh-1.5rem)] flex-col rounded-[20px] border border-line bg-surface-1/90 backdrop-blur-2xl backdrop-saturate-150 transition-[width,box-shadow] duration-200 ease-out",
          isExpanded
            ? "w-[284px] overflow-hidden shadow-[var(--shadow-lg)]"
            : "w-[64px] overflow-visible shadow-[var(--shadow-sm)]",
        )}
      >
        <div
          className={cn(
            "flex h-[78px] shrink-0 items-center border-b border-line bg-surface-1/70 transition-[padding,background-color,border-color] duration-150",
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
              aria-label={isPinned ? "Unpin navigation" : "Pin navigation"}
              className={cn(
                "ml-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border text-content-3 transition-[color,background-color,border-color,box-shadow,transform] duration-150 hover:-translate-y-0.5 hover:text-content-1",
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
          ) : null}
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
      <div
        onMouseEnter={() => setHovering(true)}
        className={cn(
          "pointer-events-auto absolute inset-y-0 left-[70px] w-5",
          isExpanded ? "hidden" : "block",
        )}
        aria-hidden
      />
    </div>
  );
}

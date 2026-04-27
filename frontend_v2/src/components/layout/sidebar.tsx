"use client";

import { SidebarBrand, SidebarFooterProfile, SidebarNavContent } from "@/components/layout/sidebar-content";
import { useAuth } from "@/components/auth-provider";
import { useDashboardChrome } from "@/components/layout/dashboard-chrome";
import { cn } from "@/lib/utils";
import { ChevronsLeft, Pin } from "lucide-react";

export function Sidebar() {
  const { user } = useAuth();
  const { isPinned, isExpanded, setHovering, togglePinned } = useDashboardChrome();

  if (!user) return null;

  return (
    <div className="pointer-events-none fixed inset-y-0 left-0 z-40 hidden lg:block">
      <aside
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
          style={{ transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)" }}
        className={cn(
          "pointer-events-auto group/sidebar my-3 ml-3 flex h-[calc(100vh-1.5rem)] flex-col overflow-hidden rounded-3xl border border-white bg-white/92 shadow-[0_26px_80px_-48px_rgba(15,23,42,0.6)] ring-1 ring-slate-950/[0.04] backdrop-blur-2xl transition-[width,box-shadow,transform] duration-300",
          isExpanded
            ? "w-[284px] shadow-[0_34px_96px_-54px_rgba(15,23,42,0.46)]"
            : "w-[64px] shadow-[0_22px_64px_-46px_rgba(15,23,42,0.52)]",
        )}
      >
        <div
          className={cn(
            "flex h-[78px] shrink-0 items-center border-b border-slate-100/90 bg-white/70 transition-all duration-300",
            isExpanded ? "justify-between px-5" : "justify-center px-2",
          )}
        >
          <div className={cn("min-w-0 transition-opacity duration-200", isExpanded ? "opacity-100" : "opacity-100")}>
            <SidebarBrand compact={!isExpanded} />
          </div>
          {isExpanded ? (
            <button
              type="button"
              onClick={togglePinned}
              aria-label={isPinned ? "Unpin navigation" : "Pin navigation"}
              className={cn(
                "ml-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border text-slate-600 transition-all duration-200 hover:-translate-y-0.5 hover:text-slate-950",
                isPinned ? "border-blue-700 bg-blue-700 text-white hover:text-white" : "border-slate-200 bg-white shadow-sm",
              )}
            >
              {isPinned ? <ChevronsLeft className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
            </button>
          ) : null}
        </div>

        <div className="relative min-h-0 flex-1">
          <div
            className={cn(
              "scrollbar-elegant absolute inset-0 overflow-y-auto px-2 py-3 transition-opacity duration-150",
              isExpanded ? "pointer-events-none opacity-0" : "opacity-100",
            )}
            aria-hidden={isExpanded}
          >
            <SidebarNavContent compact />
          </div>

          <div
            className={cn(
              "scrollbar-elegant absolute inset-0 overflow-y-auto px-3 py-4 transition-opacity duration-200",
              isExpanded ? "opacity-100 delay-75" : "pointer-events-none opacity-0",
            )}
            aria-hidden={!isExpanded}
          >
            <SidebarNavContent />
          </div>
        </div>

        <div className="shrink-0 border-t border-slate-100/90 bg-white/75 p-2">
          {isExpanded ? <SidebarFooterProfile /> : <SidebarFooterProfile compact />}
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

"use client";

import { SidebarBrand, SidebarFooterProfile, SidebarNavContent } from "@/components/layout/sidebar-content";
import { useAuth } from "@/components/auth-provider";
import { useDashboardChrome } from "@/components/layout/dashboard-chrome";
import { cn } from "@/lib/utils";
import { ChevronsLeft, ChevronsRight } from "lucide-react";

export function Sidebar() {
  const { user } = useAuth();
  const { isPinned, isExpanded, setHovering, togglePinned } = useDashboardChrome();

  if (!user) return null;

  return (
    <div className="pointer-events-none fixed inset-y-0 left-0 z-40 hidden lg:block">
      <div
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        className="absolute inset-y-4 left-4 flex items-stretch gap-3"
      >
        <aside className="pointer-events-auto flex w-[68px] flex-col items-center rounded-[2rem] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(245,247,255,0.98)_0%,rgba(255,255,255,0.97)_34%,rgba(248,250,252,0.98)_100%)] px-2 py-3 shadow-[0_18px_44px_-32px_rgba(15,23,42,0.24)] backdrop-blur-2xl">
          <button
            type="button"
            onClick={togglePinned}
            aria-label={isPinned ? "Collapse navigation" : "Pin navigation"}
            title={isPinned ? "Collapse navigation" : "Pin navigation"}
            className="mb-3 flex h-11 w-11 items-center justify-center rounded-[1rem] border border-slate-200 bg-white/96 text-slate-600 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:text-slate-950"
          >
            {isPinned ? <ChevronsLeft className="h-4 w-4" /> : <ChevronsRight className="h-4 w-4" />}
          </button>

          <div className="flex flex-1 flex-col items-center">
            <div className="mb-4">
              <SidebarBrand compact />
            </div>
            <div className="scrollbar-elegant flex-1 overflow-y-auto py-1">
              <SidebarNavContent compact />
            </div>
          </div>
          <div
            className={cn(
              "mt-3 transition-opacity duration-200",
              isExpanded ? "opacity-100" : "opacity-90",
            )}
          >
            <SidebarFooterProfile compact />
          </div>
        </aside>

        <aside
          style={{ transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)" }}
          className={cn(
            "pointer-events-auto flex w-[276px] flex-col overflow-hidden rounded-[2rem] border border-slate-200/85 bg-[linear-gradient(180deg,rgba(246,248,255,0.98)_0%,rgba(255,255,255,0.98)_38%,rgba(248,250,252,0.98)_100%)] shadow-[0_28px_80px_-56px_rgba(15,23,42,0.38)] backdrop-blur-2xl transition-all duration-300",
            isExpanded ? "translate-x-0 opacity-100" : "-translate-x-6 opacity-0 pointer-events-none",
          )}
        >
          <div className="flex h-[78px] shrink-0 items-center border-b border-slate-100/90 px-5">
            <SidebarBrand />
          </div>

          <div className="scrollbar-elegant flex-1 overflow-y-auto px-3 py-4">
            <SidebarNavContent />
          </div>

          <div className="shrink-0 border-t border-slate-100/90 bg-white/78 p-3">
            <SidebarFooterProfile />
          </div>
        </aside>
      </div>
    </div>
  );
}

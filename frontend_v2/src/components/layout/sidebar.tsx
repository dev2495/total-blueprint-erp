"use client";

import { SidebarBrand, SidebarFooterProfile, SidebarNavContent } from "@/components/layout/sidebar-content";
import { useAuth } from "@/components/auth-provider";
import { useDashboardChrome } from "@/components/layout/dashboard-chrome";
import { cn } from "@/lib/utils";
import { ChevronsLeft, ChevronsRight, Zap } from "lucide-react";

export function Sidebar() {
  const { user } = useAuth();
  const { isPinned, isExpanded, setHovering, togglePinned } = useDashboardChrome();

  if (!user) return null;

  return (
    <div className="pointer-events-none fixed inset-y-0 left-0 z-40 hidden lg:block">
      <div
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        className="absolute inset-y-0 left-0 flex items-stretch"
      >
        <div className="pointer-events-auto relative w-5">
          <button
            type="button"
            onClick={togglePinned}
            aria-label={isPinned ? "Collapse navigation" : "Open navigation"}
            title={isPinned ? "Collapse navigation" : "Open navigation"}
            className={cn(
              "absolute left-3 top-6 flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white/95 text-slate-700 shadow-[0_16px_36px_-22px_rgba(15,23,42,0.6)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-0.5 hover:border-slate-300 hover:bg-slate-950 hover:text-white",
              isExpanded ? "translate-x-[286px]" : "translate-x-0",
            )}
          >
            {isPinned ? <ChevronsLeft className="h-4 w-4" /> : <ChevronsRight className="h-4 w-4" />}
          </button>
          <div className="absolute left-0 top-0 h-full w-1.5 bg-gradient-to-b from-indigo-400/0 via-indigo-500/40 to-emerald-400/0 opacity-70" />
        </div>

        <aside
          style={{ transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)" }}
          className={cn(
            "pointer-events-auto ml-4 my-4 flex w-[292px] flex-col overflow-hidden rounded-[1.75rem] border border-slate-200/85 bg-[linear-gradient(180deg,rgba(250,252,255,0.98)_0%,rgba(255,255,255,0.98)_42%,rgba(247,250,252,0.98)_100%)] shadow-[0_30px_86px_-52px_rgba(15,23,42,0.42)] backdrop-blur-2xl transition-all duration-300",
            isExpanded ? "translate-x-0 opacity-100" : "-translate-x-[324px] opacity-0 pointer-events-none",
          )}
        >
          <div className="flex h-[78px] shrink-0 items-center justify-between border-b border-slate-100/90 px-5">
            <SidebarBrand />
            <button
              type="button"
              onClick={togglePinned}
              aria-label={isPinned ? "Unpin navigation" : "Pin navigation"}
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-xl border text-slate-600 transition-all duration-200 hover:-translate-y-0.5 hover:text-slate-950",
                isPinned ? "border-slate-300 bg-slate-950 text-white hover:text-white" : "border-slate-200 bg-white",
              )}
            >
              {isPinned ? <ChevronsLeft className="h-4 w-4" /> : <Zap className="h-4 w-4" />}
            </button>
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

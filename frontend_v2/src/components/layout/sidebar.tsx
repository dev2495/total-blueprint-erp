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
      <aside
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        style={{ transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)" }}
        className={cn(
          "pointer-events-auto absolute inset-y-3 left-0 flex w-[296px] flex-col overflow-hidden rounded-r-[30px] border border-slate-200/70 bg-white/88 backdrop-blur-2xl transition-[transform,box-shadow] duration-300",
          isExpanded
            ? "translate-x-0 shadow-[0_26px_90px_-54px_rgba(15,23,42,0.45)]"
            : "translate-x-[calc(-100%+3.75rem)] shadow-[0_18px_60px_-44px_rgba(15,23,42,0.3)]",
        )}
      >
        <div className="pointer-events-none absolute inset-y-0 right-0 w-[4.25rem] bg-[linear-gradient(180deg,rgba(238,242,255,0.95)_0%,rgba(255,255,255,0.88)_46%,rgba(248,250,252,0.92)_100%)]" />
        <button
          type="button"
          onClick={togglePinned}
          aria-label={isPinned ? "Collapse navigation" : "Pin navigation"}
          title={isPinned ? "Collapse navigation" : "Pin navigation"}
          className="absolute right-3 top-5 z-20 flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-200/80 bg-white/95 text-slate-600 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:text-slate-950"
        >
          {isPinned ? <ChevronsLeft className="h-4 w-4" /> : <ChevronsRight className="h-4 w-4" />}
        </button>

        <div className="flex h-[76px] shrink-0 items-center border-b border-slate-100/90 px-5 pr-16">
          <SidebarBrand />
        </div>

        <div className="scrollbar-elegant flex-1 overflow-y-auto px-3 py-4">
          <SidebarNavContent />
        </div>

        <div className="shrink-0 border-t border-slate-100/90 bg-white/90 p-3 pr-16">
          <SidebarFooterProfile />
        </div>
      </aside>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";

import { SidebarBrand, SidebarFooterProfile, SidebarNavContent } from "@/components/layout/sidebar-content";
import { useAuth } from "@/components/auth-provider";
import { useDashboardChrome } from "@/components/layout/dashboard-chrome";
import { cn } from "@/lib/utils";
import { ChevronsLeft, ChevronsRight } from "lucide-react";

export function Sidebar() {
  const { user } = useAuth();
  const { isPinned, isExpanded, setHovering, togglePinned } = useDashboardChrome();
  const [showExpandedContent, setShowExpandedContent] = useState(isExpanded);

  useEffect(() => {
    if (isExpanded) {
      const timer = window.setTimeout(() => setShowExpandedContent(true), 150);
      return () => window.clearTimeout(timer);
    }
    setShowExpandedContent(false);
  }, [isExpanded]);

  if (!user) return null;

  return (
    <div className="pointer-events-none fixed inset-y-0 left-0 z-40 hidden lg:block">
      <aside
        onMouseEnter={() => setHovering(true)}
        onMouseLeave={() => setHovering(false)}
        style={{ transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)" }}
        className={cn(
          "pointer-events-auto absolute inset-y-4 left-4 flex overflow-hidden rounded-[2rem] border border-slate-200/80 bg-[linear-gradient(180deg,rgba(244,247,255,0.98)_0%,rgba(255,255,255,0.97)_36%,rgba(248,250,252,0.98)_100%)] backdrop-blur-2xl transition-[width,box-shadow] duration-300",
          isExpanded
            ? "w-[282px] shadow-[0_28px_80px_-56px_rgba(15,23,42,0.38)]"
            : "w-[74px] shadow-[0_18px_44px_-32px_rgba(15,23,42,0.24)]",
        )}
      >
        <button
          type="button"
          onClick={togglePinned}
          aria-label={isPinned ? "Collapse navigation" : "Pin navigation"}
          title={isPinned ? "Collapse navigation" : "Pin navigation"}
          className={cn(
            "absolute top-4 z-20 flex h-10 w-10 items-center justify-center rounded-[1rem] border border-slate-200 bg-white/95 text-slate-600 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:text-slate-950",
            isExpanded ? "right-4" : "left-1/2 -translate-x-1/2",
          )}
        >
          {isPinned ? <ChevronsLeft className="h-4 w-4" /> : <ChevronsRight className="h-4 w-4" />}
        </button>

        <div className={cn("flex h-[78px] shrink-0 items-center border-b border-slate-100/90", showExpandedContent ? "px-5 pr-16" : "justify-center px-3")}>
          <SidebarBrand compact={!showExpandedContent} />
        </div>

        <div className={cn("scrollbar-elegant flex-1 overflow-y-auto py-4", showExpandedContent ? "px-3" : "px-2")}>
          <SidebarNavContent compact={!showExpandedContent} />
        </div>

        <div className={cn("shrink-0 border-t border-slate-100/90 bg-white/80", showExpandedContent ? "p-3" : "px-2 py-3")}>
          <SidebarFooterProfile compact={!showExpandedContent} />
        </div>
      </aside>
    </div>
  );
}

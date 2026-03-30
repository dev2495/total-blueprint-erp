"use client";

import { SidebarBrand, SidebarFooterProfile, SidebarNavContent } from "@/components/layout/sidebar-content";
import { useAuth } from "@/components/auth-provider";

export function Sidebar() {
  const { user } = useAuth();

  if (!user) return null;

  return (
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-[270px] flex-col border-r border-slate-200/60 bg-white/80 backdrop-blur-2xl lg:flex">
      {/* Brand header - fixed at top */}
      <div className="flex h-[68px] shrink-0 items-center border-b border-slate-100 px-5">
        <SidebarBrand />
      </div>

      {/* Scrollable nav area */}
      <div className="flex-1 overflow-y-auto px-3 py-4 scrollbar-elegant">
        <SidebarNavContent />
      </div>

      {/* Footer profile - fixed at bottom */}
      <div className="shrink-0 border-t border-slate-100 bg-white/90 p-3">
        <SidebarFooterProfile />
      </div>
    </aside>
  );
}

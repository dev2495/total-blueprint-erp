"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { cn } from "@/lib/utils";
import { getLandingPage } from "@/lib/roles";
import { Zap } from "lucide-react";
import { NAV_ITEMS } from "@/lib/sidebar-nav";

function navTestId(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function Sidebar() {
  const pathname = usePathname() || "/";
  const { user } = useAuth();

  if (!user) return null;

  const userRoleCode =
    user.entitlements?.role || user.role_info?.code || "GUEST";
  const baseRoleCode = user.role_info?.code || "GUEST";
  const isEmulating = userRoleCode !== baseRoleCode;

  const isAuthorized = (roles: string[] | undefined) => {
    if (!roles || roles.length === 0) return true;

    // Normalize role codes to uppercase for comparison
    const currentRole = userRoleCode.toUpperCase();
    const masterRoles = ["ADMIN", "OWNER", "SUPER_ADMIN"];
    const isMaster =
      masterRoles.includes(baseRoleCode.toUpperCase()) || user.is_owner;

    if (isEmulating) return roles.includes(currentRole);
    if (roles.includes(currentRole)) return true;
    if (
      isMaster &&
      (roles.includes("ADMIN") ||
        roles.includes("OWNER") ||
        roles.includes("SUPER_ADMIN"))
    )
      return true;

    return false;
  };

  const authorizedItems = NAV_ITEMS.filter((item) => isAuthorized(item.roles));

  return (
    <div className="flex h-screen w-64 flex-col bg-[#fbfcfd] border-r border-slate-200/50 z-20 relative">
      {/* Header */}
      <div className="flex h-20 items-center px-6 border-b border-slate-200/40">
        <Link
          href={getLandingPage(userRoleCode)}
          className="flex items-center gap-3 group"
        >
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white shadow-sm group-hover:bg-slate-800 transition-colors">
            <Zap className="h-4 w-4 fill-white" strokeWidth={1.5} />
          </div>
          <div className="flex flex-col leading-none">
            <span className="text-[15px] font-bold tracking-tight text-slate-900 group-hover:text-slate-700 transition-colors">
              TOTAL POLY
            </span>
            <span className="text-[9px] font-semibold tracking-[0.15em] text-slate-500 uppercase mt-1">
              ERP System
            </span>
          </div>
        </Link>
      </div>

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto px-4 py-6 scrollbar-elegant">
        <nav className="space-y-6" data-testid="sidebar-nav">
          {authorizedItems.map((item, index) => {
            const authorizedChildren = item.children?.filter((child) => {
              const isAuth = isAuthorized(child.roles);
              // Hide Sales Dashboard from sidebar for SALES role specifically
              if (
                child.href === "/dashboard/sales" &&
                userRoleCode === "SALES"
              ) {
                return false;
              }
              return isAuth;
            });

            // If no children but has children array, skip (unless it's a direct link like Control Tower)
            if (item.children && authorizedChildren?.length === 0 && !item.href)
              return null;

            const isDirectLink = !item.children;
            const isActive = isDirectLink
              ? pathname === item.href
              : pathname.startsWith(item.href);

            return (
              <div key={index} className="space-y-1">
                {isDirectLink ? (
                  <Link
                    href={item.href}
                    data-testid={`sidebar-link-${navTestId(item.href || item.title)}`}
                    data-route={item.href}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-all duration-200 group",
                      isActive
                        ? "bg-white text-slate-900 shadow-sm border border-slate-200/60 font-semibold"
                        : "text-slate-500 hover:bg-slate-100/50 hover:text-slate-900",
                    )}
                  >
                    <item.icon
                      className={cn(
                        "h-4 w-4 transition-colors",
                        isActive
                          ? "text-slate-700"
                          : "text-slate-400 group-hover:text-slate-600",
                      )}
                      strokeWidth={isActive ? 2 : 1.5}
                    />
                    <span className={cn(isActive ? "tracking-tight" : "")}>
                      {item.title}
                    </span>
                  </Link>
                ) : (
                  <>
                    <div
                      className="flex items-center gap-2 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400 mt-4 mb-2"
                      data-testid={`sidebar-section-${navTestId(item.title)}`}
                    >
                      {item.title}
                    </div>
                    {authorizedChildren?.map((child) => {
                      const isChildActive =
                        pathname === child.href ||
                        pathname.startsWith(child.href + "/");
                      return (
                        <Link
                          key={child.href}
                          href={child.href}
                          data-testid={`sidebar-link-${navTestId(child.href || child.title)}`}
                          data-route={child.href}
                          className={cn(
                            "flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition-all duration-200 group",
                            isChildActive
                              ? "bg-white text-slate-900 shadow-[0_1px_3px_0_rgba(0,0,0,0.02)] border border-slate-200/40 font-semibold"
                              : "text-slate-500 hover:bg-slate-100/50 hover:text-slate-900",
                          )}
                        >
                          <div
                            className={cn(
                              "flex items-center justify-center p-1.5 rounded-md transition-all duration-200",
                              isChildActive
                                ? "bg-slate-50 text-slate-700"
                                : "text-slate-400 group-hover:text-slate-600",
                            )}
                          >
                            <child.icon
                              className="h-4 w-4"
                              strokeWidth={isChildActive ? 2 : 1.5}
                            />
                          </div>
                          <span
                            className={cn(
                              "flex-1",
                              isChildActive ? "tracking-tight" : "",
                            )}
                          >
                            {child.title}
                          </span>
                          {child.badge && (
                            <span className="px-1.5 py-0.5 rounded-sm bg-slate-100 border border-slate-200 text-[9px] font-bold text-slate-600 uppercase">
                              {child.badge}
                            </span>
                          )}
                        </Link>
                      );
                    })}
                  </>
                )}
              </div>
            );
          })}
        </nav>
      </div>

      {/* Footer / User Profile */}
      <div className="p-4 border-t border-slate-200/40 bg-[#fbfcfd]">
        <div className="flex items-center gap-3 p-2 rounded-lg bg-transparent hover:bg-slate-100/80 cursor-pointer transition-all group">
          <div className="h-8 w-8 rounded-md bg-white border border-slate-200 flex items-center justify-center text-xs font-bold text-slate-700 shadow-sm group-hover:border-slate-300 transition-colors">
            {user.username.substring(0, 2).toUpperCase()}
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-[13px] font-semibold text-slate-900 truncate">
              {user.full_name || user.username}
            </span>
            <div className="flex items-center gap-1.5">
              <div className="h-1.5 w-1.5 rounded-full bg-slate-400" />
              <span className="text-[10px] font-medium text-slate-500 truncate">
                {user.role_info?.name || "System User"}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

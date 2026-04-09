"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef } from "react";
import { Zap } from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { cn } from "@/lib/utils";
import { getLandingPage } from "@/lib/roles";
import { NAV_ITEMS, canAccessNavTarget } from "@/lib/sidebar-nav";

function navTestId(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function useSidebarAuth() {
  const { user, effectiveRole } = useAuth();
  const pathname = usePathname() || "/";

  const userRoleCode = effectiveRole || user?.entitlements?.role || user?.role_info?.code || "GUEST";
  const baseRoleCode = user?.role_info?.code || "GUEST";
  const accessContext = useMemo(
    () => ({
      currentRoleCode: userRoleCode,
      baseRoleCode,
      isOwner: user?.is_owner,
      grantedPermissions: user?.entitlements?.permissions || [],
      grantedPermissionMap: user?.entitlements?.permission_map || {},
    }),
    [baseRoleCode, user?.entitlements?.permission_map, user?.entitlements?.permissions, user?.is_owner, userRoleCode],
  );

  const authorizedItems = useMemo(
    () =>
      NAV_ITEMS.filter((item) => {
        if (canAccessNavTarget(item, accessContext)) return true;
        return item.children?.some((child) => canAccessNavTarget(child, accessContext)) ?? false;
      }),
    [accessContext],
  );

  const isAuthorized = (
    item: Parameters<typeof canAccessNavTarget>[0],
  ) => canAccessNavTarget(item, accessContext);

  return {
    user,
    pathname,
    userRoleCode,
    authorizedItems,
    isAuthorized,
  };
}

export function SidebarBrand({ compact = false }: { compact?: boolean }) {
  const { userRoleCode } = useSidebarAuth();

  return (
    <Link
      href={getLandingPage(userRoleCode)}
      className={cn("flex items-center gap-3 group", compact ? "px-1" : "")}
    >
      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-sm transition-colors group-hover:bg-slate-800">
        <Zap className="h-4 w-4 fill-white" strokeWidth={1.5} />
      </div>
      <div className="flex flex-col leading-none">
        <span className="text-[15px] font-bold tracking-tight text-slate-900 transition-colors group-hover:text-slate-700">
          TOTAL POLY
        </span>
        <span className="mt-1 text-[9px] font-semibold uppercase tracking-[0.15em] text-slate-500">
          ERP System
        </span>
      </div>
    </Link>
  );
}

export function SidebarNavContent({
  mobile = false,
  onNavigate,
}: {
  mobile?: boolean;
  onNavigate?: () => void;
}) {
  const { user, pathname, userRoleCode, authorizedItems, isAuthorized } = useSidebarAuth();
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (mobile || !user) return;
    const timer = setTimeout(() => {
      const active = navRef.current?.querySelector('[data-active="true"]') as HTMLElement | null;
      if (active) {
        active.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [pathname, mobile, user]);

  if (!user) return null;

  return (
    <nav
      ref={navRef}
      className={cn("space-y-1", mobile ? "pb-6" : "")}
      data-testid={mobile ? "mobile-sidebar-nav" : "sidebar-nav"}
    >
      {authorizedItems.map((item, index) => {
        const authorizedChildren = item.children?.filter((child) => {
          const isAuth = isAuthorized(child);
          if (child.href === "/dashboard/sales" && userRoleCode === "SALES") {
            return false;
          }
          return isAuth;
        });

        if (item.children && authorizedChildren?.length === 0 && !isAuthorized(item)) return null;

        const isDirectLink = !item.children;
        const isActive = isDirectLink ? pathname === item.href : pathname.startsWith(item.href);

        return (
          <div key={index}>
            {isDirectLink ? (
              <Link
                href={item.href}
                onClick={onNavigate}
                data-testid={`sidebar-link-${navTestId(item.href || item.title)}`}
                data-route={item.href}
                data-active={isActive ? "true" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-medium transition-all duration-150 group",
                  isActive
                    ? "bg-slate-900 text-white shadow-md font-semibold"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                  mobile ? "px-4 py-3 text-[14px]" : ""
                )}
              >
                <item.icon
                  className={cn(
                    "h-4 w-4 shrink-0 transition-colors",
                    isActive ? "text-white" : "text-slate-400 group-hover:text-slate-600"
                  )}
                  strokeWidth={isActive ? 2 : 1.5}
                />
                <span className="truncate">{item.title}</span>
              </Link>
            ) : (
              <>
                <div
                  className={cn(
                    "flex items-center gap-2 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-400 mt-5 mb-1",
                    mobile ? "mt-6 px-4 text-[11px]" : ""
                  )}
                  data-testid={`sidebar-section-${navTestId(item.title)}`}
                >
                  {item.title}
                </div>
                <div className="space-y-0.5">
                  {authorizedChildren?.map((child) => {
                    const childHref = String(child.href || "");
                    const isPlannerRoot = childHref === "/production/planner";
                    const isChildActive = isPlannerRoot
                      ? pathname === childHref
                      : pathname === childHref || pathname.startsWith(childHref + "/");
                    return (
                      <Link
                        key={child.href}
                        href={child.href}
                        onClick={onNavigate}
                        data-testid={`sidebar-link-${navTestId(child.href || child.title)}`}
                        data-route={child.href}
                        data-active={isChildActive ? "true" : undefined}
                        className={cn(
                          "flex items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-medium transition-all duration-150 group",
                          isChildActive
                            ? "bg-slate-900 text-white shadow-md font-semibold"
                            : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                          mobile ? "px-4 py-3 text-[14px]" : ""
                        )}
                      >
                        <div
                          className={cn(
                            "flex shrink-0 items-center justify-center rounded-lg p-1 transition-all duration-150",
                            isChildActive
                              ? "text-white"
                              : "text-slate-400 group-hover:text-slate-600"
                          )}
                        >
                          <child.icon className="h-4 w-4" strokeWidth={isChildActive ? 2 : 1.5} />
                        </div>
                        <span className={cn("flex-1 truncate")}>{child.title}</span>
                        {child.badge && (
                          <span className={cn(
                            "px-1.5 py-0.5 rounded text-[9px] font-bold uppercase",
                            isChildActive
                              ? "bg-white/20 text-white"
                              : "bg-slate-100 border border-slate-200 text-slate-500"
                          )}>
                            {child.badge}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        );
      })}
    </nav>
  );
}

export function SidebarFooterProfile({ compact = false }: { compact?: boolean }) {
  const { user } = useSidebarAuth();

  if (!user) return null;

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-2xl bg-transparent p-2 transition-all group hover:bg-slate-100/80",
        compact ? "p-3" : ""
      )}
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 shadow-sm transition-colors group-hover:border-slate-300">
        {user.username.substring(0, 2).toUpperCase()}
      </div>
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-[13px] font-semibold text-slate-900">
          {user.full_name || user.username}
        </span>
        <div className="flex items-center gap-1.5">
          <div className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          <span className="truncate text-[10px] font-medium text-slate-500">
            {user.role_info?.name || "System User"}
          </span>
        </div>
      </div>
    </div>
  );
}

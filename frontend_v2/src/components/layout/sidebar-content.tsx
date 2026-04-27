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
  const extraPermissions = user?.extra_permissions || user?.entitlements?.extra_overrides || [];
  const accessContext = useMemo(
    () => ({
      currentRoleCode: userRoleCode,
      baseRoleCode,
      isOwner: user?.is_owner,
      grantedPermissions: extraPermissions,
    }),
    [baseRoleCode, extraPermissions, user?.is_owner, userRoleCode],
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
      className={cn("group flex items-center gap-3", compact ? "justify-center" : "")}
    >
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-700 text-white shadow-[0_12px_30px_-18px_rgba(37,99,235,0.9)] transition-transform duration-200 group-hover:-translate-y-px">
        <Zap className="h-4 w-4 fill-white" strokeWidth={1.5} />
      </div>
      {!compact ? (
        <div className="flex flex-col leading-none">
          <span className="text-[13px] font-extrabold tracking-[0.08em] text-slate-950 transition-colors group-hover:text-blue-800">
            TOTAL POLY PRINT
          </span>
          <span className="mt-1 text-[9px] font-semibold uppercase tracking-[0.15em] text-slate-500">
            ERP System
          </span>
        </div>
      ) : null}
    </Link>
  );
}

export function SidebarNavContent({
  mobile = false,
  compact = false,
  onNavigate,
}: {
  mobile?: boolean;
  compact?: boolean;
  onNavigate?: () => void;
}) {
  const { user, pathname, userRoleCode, authorizedItems, isAuthorized } = useSidebarAuth();
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (mobile || !user) return;
    const timer = setTimeout(() => {
      const active = navRef.current?.querySelector('[data-active="true"]') as HTMLElement | null;
      if (active) {
        active.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [pathname, mobile, user]);

  if (!user) return null;

  return (
    <nav
      ref={navRef}
      className={cn("space-y-1", mobile ? "pb-6" : "", compact ? "space-y-2" : "")}
      data-testid={mobile ? "mobile-sidebar-nav" : compact ? "compact-sidebar-nav" : "sidebar-nav"}
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

        if (compact && !mobile) {
            const compactLinks: Array<{
              href: string;
              title: string;
              icon: React.ElementType;
              active: boolean;
              badge?: string;
            }> = isDirectLink
              ? [{
                  href: item.href,
                  title: item.title,
                  icon: item.icon,
                  active: isActive,
                }]
              : (authorizedChildren || []).map((child) => {
                  const childHref = String(child.href || "");
                  const isPlannerRoot = childHref === "/production/planner";
                  const active = isPlannerRoot
                    ? pathname === childHref
                    : pathname === childHref || pathname.startsWith(childHref + "/");
                  return {
                    href: child.href,
                    title: child.title,
                    icon: child.icon,
                    active,
                    badge: child.badge,
                  };
                });

            return (
              <div key={index} className="space-y-2">
                {compactLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={onNavigate}
                    title={link.title}
                    aria-label={link.title}
                    data-testid={`sidebar-link-${navTestId(link.href || link.title)}`}
                    data-route={link.href}
                    data-active={link.active ? "true" : undefined}
                    className={cn(
                      "relative mx-auto flex h-11 w-11 items-center justify-center rounded-xl border transition-all duration-150",
                      link.active
                        ? "border-blue-500 bg-blue-700 text-white shadow-[0_16px_28px_-18px_rgba(37,99,235,0.9)]"
                        : "border-transparent bg-transparent text-slate-500 hover:border-slate-200 hover:bg-white hover:text-slate-950",
                    )}
                  >
                    <link.icon className="h-4 w-4" strokeWidth={link.active ? 2.1 : 1.8} />
                    {link.badge ? (
                      <span className="absolute -right-1 -top-1 rounded-full bg-slate-950 px-1.5 py-0.5 text-[8px] font-bold text-white">
                        {link.badge}
                      </span>
                    ) : null}
                  </Link>
                ))}
              </div>
            );
          }

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
                    "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-semibold transition-all duration-150",
                    isActive
                      ? "bg-blue-700 text-white shadow-[0_16px_28px_-20px_rgba(37,99,235,0.8)]"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-950",
                    mobile ? "px-3 py-2.5 text-[13px]" : "",
                  )}
                >
                  <item.icon
                    className={cn(
                      "h-4 w-4 shrink-0 transition-colors",
                      isActive ? "text-white" : "text-slate-400 group-hover:text-slate-700",
                    )}
                    strokeWidth={isActive ? 2 : 1.7}
                  />
                  <span className="truncate">{item.title}</span>
                </Link>
              ) : (
                <>
                  <div
                    className={cn(
                      "mb-1 mt-5 flex items-center gap-2 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400",
                      mobile ? "mt-4 px-3 text-[10px]" : "",
                    )}
                    data-testid={`sidebar-section-${navTestId(item.title)}`}
                  >
                    {item.title}
                  </div>
                  <div className="space-y-1">
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
                            "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-semibold transition-all duration-150",
                            isChildActive
                              ? "bg-blue-700 text-white shadow-[0_16px_28px_-20px_rgba(37,99,235,0.8)]"
                              : "text-slate-600 hover:bg-slate-100 hover:text-slate-950",
                            mobile ? "px-3 py-2.5 text-[13px]" : "",
                          )}
                        >
                          <div
                            className={cn(
                              "flex shrink-0 items-center justify-center rounded-lg p-1 transition-all duration-150",
                              isChildActive
                                ? "text-white"
                                : "text-slate-400 group-hover:text-slate-700",
                            )}
                          >
                            <child.icon className="h-4 w-4" strokeWidth={isChildActive ? 2 : 1.7} />
                          </div>
                          <span className="flex-1 truncate">{child.title}</span>
                          {child.badge ? (
                            <span
                              className={cn(
                                "rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase",
                                isChildActive
                                  ? "bg-white/15 text-white"
                                  : "border border-slate-200 bg-slate-50 text-slate-500",
                              )}
                            >
                              {child.badge}
                            </span>
                          ) : null}
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

  if (compact) {
    return (
      <div
        className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-xs font-bold text-slate-700 shadow-sm"
        title={`${user.full_name || user.username} - ${user.role_info?.name || "System User"}`}
        aria-label={`${user.full_name || user.username} - ${user.role_info?.name || "System User"}`}
      >
        {user.username.substring(0, 2).toUpperCase()}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group flex items-center gap-3 rounded-xl bg-transparent p-2 transition-all hover:bg-slate-100",
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

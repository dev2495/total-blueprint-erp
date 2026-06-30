"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

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

function normalizeSidebarRoute(value: string) {
  return String(value || "")
    .split("?")[0]
    .replace(/\/+$/g, "") || "/";
}

const SIDEBAR_SECTION_ORDER = [
  "Sales",
  "Operations",
  "Inventory Workspace",
  "Logistics",
  "Procurement",
  "Analytics",
  "Engineering",
  "Administration",
  "System",
];

function useSidebarAuth() {
  const { user, effectiveRole } = useAuth();
  const pathname = usePathname() || "/";

  const userRoleCode =
    effectiveRole ||
    user?.entitlements?.role ||
    user?.role_info?.code ||
    "GUEST";
  const baseRoleCode = user?.role_info?.code || "GUEST";
  const extraPermissions =
    user?.extra_permissions || user?.entitlements?.extra_overrides || [];
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
        return (
          item.children?.some((child) =>
            canAccessNavTarget(child, accessContext),
          ) ?? false
        );
      }).sort((left, right) => {
        const leftIndex = SIDEBAR_SECTION_ORDER.indexOf(left.title);
        const rightIndex = SIDEBAR_SECTION_ORDER.indexOf(right.title);
        const leftRank = leftIndex === -1 ? 999 : leftIndex;
        const rightRank = rightIndex === -1 ? 999 : rightIndex;
        return leftRank - rightRank;
      }),
    [accessContext],
  );

  const isAuthorized = (item: Parameters<typeof canAccessNavTarget>[0]) =>
    canAccessNavTarget(item, accessContext);

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

  if (compact) {
    return (
      <Link
        href={getLandingPage(userRoleCode)}
        className="group flex h-12 w-12 items-center justify-center"
        aria-label="Total Poly Print ERP"
      >
        <Image
          src="/brand/tpp-logo-mark.svg"
          alt="Total Poly Print"
          width={46}
          height={40}
          priority
          className="h-10 w-11 object-contain object-center transition-transform duration-200 group-hover:-translate-y-px"
        />
      </Link>
    );
  }

  return (
    <Link
      href={getLandingPage(userRoleCode)}
      className="group flex min-w-0 items-center gap-3"
      aria-label="Total Poly Print ERP"
    >
      <div className="flex min-w-0 flex-1 items-center transition-transform duration-200 group-hover:-translate-y-px">
        <Image
          src="/brand/tpp-logo-full.svg"
          alt="Total Poly Print"
          width={190}
          height={55}
          priority
          className="h-[42px] w-auto max-w-[190px] object-contain object-left"
        />
      </div>
      <div className="flex min-w-0 flex-col overflow-hidden leading-none transition-[opacity,transform] duration-300 ease-out">
        <span className="text-[9px] font-semibold uppercase tracking-[0.15em] text-content-3">
          ERP System
        </span>
      </div>
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
  const { user, pathname, userRoleCode, authorizedItems, isAuthorized } =
    useSidebarAuth();
  const navRef = useRef<HTMLElement>(null);
  const [openSections, setOpenSections] = useState<Set<string>>(() => new Set());
  const [compactOpenSection, setCompactOpenSection] = useState<string | null>(
    null,
  );
  const [closedSections, setClosedSections] = useState<Set<string>>(
    () => new Set(),
  );

  useEffect(() => {
    setClosedSections(new Set());
    setCompactOpenSection(null);
  }, [pathname]);

  useEffect(() => {
    if (mobile || !user) return;
    const timer = setTimeout(() => {
      const active =
        (navRef.current?.querySelector(
          '[data-active-current="true"]',
        ) as HTMLElement | null) ||
        (navRef.current?.querySelector(
          '[data-active="true"]',
        ) as HTMLElement | null);
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
      className={cn(
        "space-y-1",
        mobile ? "pb-6" : "",
        compact ? "space-y-2" : "",
      )}
      data-testid={
        mobile
          ? "mobile-sidebar-nav"
          : compact
            ? "compact-sidebar-nav"
            : "sidebar-nav"
      }
    >
      {authorizedItems.map((item, index) => {
        const authorizedChildren = item.children?.filter((child) => {
          const isAuth = isAuthorized(child);
          if (child.href === "/dashboard/sales" && userRoleCode === "SALES") {
            return false;
          }
          return isAuth;
        });

        if (
          item.children &&
          authorizedChildren?.length === 0 &&
          !isAuthorized(item)
        )
          return null;

        const parentAuthorized = isAuthorized(item);
        const parentHref = parentAuthorized
          ? item.href
          : authorizedChildren?.[0]?.href || item.href;
        const isDirectLink = !item.children;
        const currentPath = normalizeSidebarRoute(pathname);
        const routeIsActive = (href: string) => {
          const normalizedHref = normalizeSidebarRoute(href);
          return (
            currentPath === normalizedHref ||
            (normalizedHref !== "/" &&
              currentPath.startsWith(normalizedHref + "/"))
          );
        };
        const activeChildHref = (authorizedChildren || [])
          .filter((child) => routeIsActive(child.href))
          .sort(
            (left, right) =>
              normalizeSidebarRoute(right.href).length -
              normalizeSidebarRoute(left.href).length,
          )[0]?.href;
        const isActive = isDirectLink
          ? routeIsActive(parentHref)
          : currentPath === normalizeSidebarRoute(parentHref) ||
            Boolean(activeChildHref);
        const childCount = authorizedChildren?.length || 0;
        const sectionKey = parentHref || item.title;
        const childrenOpen =
          openSections.has(sectionKey) ||
          (isActive && !closedSections.has(sectionKey));
        const compactChildrenOpen = compactOpenSection === sectionKey;
        const toggleSection = () => {
          setOpenSections((current) => {
            const next = new Set(current);
            if (childrenOpen) {
              next.delete(sectionKey);
            } else {
              next.add(sectionKey);
            }
            return next;
          });
          setClosedSections((current) => {
            const next = new Set(current);
            if (childrenOpen) {
              next.add(sectionKey);
            } else {
              next.delete(sectionKey);
            }
            return next;
          });
        };
        const toggleCompactSection = () => {
          setCompactOpenSection((current) =>
            current === sectionKey ? null : sectionKey,
          );
        };

        if (compact && !mobile) {
          const childLinks = (authorizedChildren || []).map((child) => {
            const active =
              normalizeSidebarRoute(child.href) ===
              normalizeSidebarRoute(activeChildHref || "");
            return {
              href: child.href,
              title: child.title,
              icon: child.icon,
              active,
              badge: child.badge,
            };
          });
          const linkActive = isDirectLink
            ? isActive
            : childLinks.some((link) => link.active) || isActive;
          const ParentIcon = item.icon;
          const flyoutPlacement =
            index >= authorizedItems.length - 3 ? "bottom-0" : "top-0";
          const compactIconContent = (
            <>
              <ParentIcon
                className="h-4 w-4"
                strokeWidth={linkActive ? 2.1 : 1.8}
              />
              {childLinks.some((link) => link.badge) ? (
                <span className="absolute -right-1 -top-1 rounded-full bg-surface-3 px-1 py-0.5 text-[8px] font-bold text-white">
                  {childLinks.find((link) => link.badge)?.badge}
                </span>
              ) : null}
            </>
          );

          return (
            <div
              key={index}
              className="group/compact relative mx-auto flex h-11 w-11 items-center justify-center"
            >
              {!isDirectLink && childLinks.length > 0 ? (
                <button
                  type="button"
                  onClick={toggleCompactSection}
                  title={item.title}
                  aria-label={item.title}
                  aria-expanded={compactChildrenOpen}
                  data-testid={`sidebar-link-${navTestId(parentHref || item.title)}`}
                  data-route={parentHref}
                  data-active={linkActive ? "true" : undefined}
                  data-active-current={
                    linkActive && !activeChildHref ? "true" : undefined
                  }
                  className={cn(
                    "relative flex h-11 w-11 items-center justify-center rounded-xl border transition-all duration-300 ease-out",
                    linkActive
                      ? "border-primary bg-primary text-white shadow-[0_16px_28px_-18px_rgba(37,99,235,0.9)]"
                      : "border-transparent bg-transparent text-content-3 hover:border-line hover:bg-surface-1 hover:text-content-1",
                  )}
                >
                  {compactIconContent}
                </button>
              ) : (
                <Link
                  href={parentHref}
                  onClick={onNavigate}
                  title={item.title}
                  aria-label={item.title}
                  data-testid={`sidebar-link-${navTestId(parentHref || item.title)}`}
                  data-route={parentHref}
                  data-active={linkActive ? "true" : undefined}
                  data-active-current={
                    linkActive && !activeChildHref ? "true" : undefined
                  }
                  className={cn(
                    "relative flex h-11 w-11 items-center justify-center rounded-xl border transition-all duration-300 ease-out",
                    linkActive
                      ? "border-primary bg-primary text-white shadow-[0_16px_28px_-18px_rgba(37,99,235,0.9)]"
                      : "border-transparent bg-transparent text-content-3 hover:border-line hover:bg-surface-1 hover:text-content-1",
                  )}
                >
                  {compactIconContent}
                </Link>
              )}
              {!isDirectLink && childLinks.length > 0 ? (
                <div
                  className={cn(
                    "absolute left-[52px] z-50 max-h-[min(70vh,560px)] w-64 overflow-y-auto rounded-2xl border border-line bg-surface-1 p-2 shadow-2xl ring-1 ring-line-strong/[0.04] transition-all duration-300 ease-out",
                    compactChildrenOpen
                      ? "visible translate-x-1 opacity-100"
                      : "invisible -translate-x-2 opacity-0",
                    flyoutPlacement,
                  )}
                >
                  <div className="px-2 pb-2 pt-1 text-[10px] font-black uppercase tracking-[0.22em] text-content-4">
                    {item.title}
                  </div>
                  <div className="space-y-1">
                    {childLinks.map((link) => (
                      <Link
                        key={link.href}
                        href={link.href}
                        onClick={() => {
                          setCompactOpenSection(null);
                          onNavigate?.();
                        }}
                        data-testid={`sidebar-link-${navTestId(link.href || link.title)}`}
                        data-route={link.href}
                        data-active={link.active ? "true" : undefined}
                        data-active-current={link.active ? "true" : undefined}
                        className={cn(
                          "group/item flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-semibold transition-all duration-150",
                          link.active
                            ? "bg-primary text-white shadow-[0_16px_28px_-20px_rgba(37,99,235,0.8)]"
                            : "text-content-3 hover:bg-surface-2 hover:text-content-1",
                        )}
                      >
                        <link.icon
                          className={cn(
                            "h-4 w-4 shrink-0",
                            link.active
                              ? "text-white"
                              : "text-content-4 group-hover/item:text-content-2",
                          )}
                          strokeWidth={link.active ? 2 : 1.7}
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {link.title}
                        </span>
                        {link.badge ? (
                          <span
                            className={cn(
                              "rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase",
                              link.active
                                ? "bg-surface-1/15 text-white"
                                : "border border-line bg-surface-2 text-content-3",
                            )}
                          >
                            {link.badge}
                          </span>
                        ) : null}
                      </Link>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          );
        }

        const sectionTitle = item.title.replace(/\s+Workspace$/i, "");

        return (
          <div key={index} className="group/sidebar-section">
            {isDirectLink ? (
              <Link
                href={item.href}
                onClick={onNavigate}
                data-testid={`sidebar-link-${navTestId(item.href || item.title)}`}
                data-route={item.href}
                data-active={isActive ? "true" : undefined}
                data-active-current={isActive ? "true" : undefined}
                className={cn(
                  "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-semibold transition-all duration-150",
                  isActive
                    ? "bg-primary text-white shadow-[0_16px_28px_-20px_rgba(37,99,235,0.8)]"
                    : "text-content-3 hover:bg-surface-2 hover:text-content-1",
                  mobile ? "px-3 py-2.5 text-[13px]" : "",
                )}
              >
                <item.icon
                  className={cn(
                    "h-4 w-4 shrink-0 transition-colors",
                    isActive
                      ? "text-white"
                      : "text-content-4 group-hover:text-content-2",
                  )}
                  strokeWidth={isActive ? 2 : 1.7}
                />
                <span className="truncate">{item.title}</span>
              </Link>
            ) : (
              <>
                <div
                  className={cn(
                    "mb-1 mt-5 flex items-center gap-2 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.22em] text-content-4",
                    isActive ? "text-primary" : "",
                    mobile ? "mt-4 px-3 text-[10px]" : "",
                  )}
                  data-testid={`sidebar-section-${navTestId(sectionTitle)}`}
                >
                  {sectionTitle}
                </div>
                <button
                  type="button"
                  onClick={toggleSection}
                  data-testid={`sidebar-workspace-${navTestId(item.href || item.title)}`}
                  data-route={parentHref}
                  data-active={isActive ? "true" : undefined}
                  data-active-current={
                    isActive && !activeChildHref ? "true" : undefined
                  }
                  aria-expanded={childrenOpen}
                  className={cn(
                    "group flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-[13px] font-bold transition-all duration-150",
                    isActive
                      ? "border-info-border bg-info-bg text-content-1 shadow-sm"
                      : "border-transparent text-content-2 hover:border-line hover:bg-surface-1 hover:text-content-1",
                    mobile ? "px-3 py-2.5 text-[13px]" : "",
                  )}
                >
                  <div
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-all duration-150",
                      isActive
                        ? "bg-primary text-white shadow-[0_10px_20px_-14px_rgba(37,99,235,0.9)]"
                        : "bg-surface-2 text-content-3 group-hover:bg-line group-hover:text-content-2",
                    )}
                  >
                    <item.icon
                      className="h-4 w-4"
                      strokeWidth={isActive ? 2 : 1.7}
                    />
                  </div>
                  <span className="flex-1 truncate">{item.title}</span>
                  {childCount > 0 ? (
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-0.5 text-[9px] font-black",
                        isActive
                          ? "bg-primary/10 text-primary"
                          : "bg-surface-2 text-content-4",
                      )}
                    >
                      {childCount}
                    </span>
                  ) : null}
                  <ChevronDown
                    className={cn(
                      "h-3.5 w-3.5 shrink-0 text-content-4 transition-transform duration-200",
                      childrenOpen
                        ? "rotate-180 text-primary"
                        : "",
                    )}
                    strokeWidth={2}
                  />
                </button>
                <div
                  className={cn(
                    "ml-[22px] mt-1 grid overflow-hidden border-l border-line pl-3 transition-all duration-300 ease-out",
                    childrenOpen
                      ? "visible grid-rows-[1fr] opacity-100"
                      : "invisible pointer-events-none grid-rows-[0fr] opacity-0",
                  )}
                >
                  <div className="min-h-0 space-y-1">
                    {authorizedChildren?.map((child) => {
                      const isChildActive =
                        normalizeSidebarRoute(child.href) ===
                        normalizeSidebarRoute(activeChildHref || "");
                      return (
                        <Link
                          key={child.href}
                          href={child.href}
                          onClick={onNavigate}
                          data-testid={`sidebar-link-${navTestId(child.href || child.title)}`}
                          data-route={child.href}
                          data-active={isChildActive ? "true" : undefined}
                          data-active-current={
                            isChildActive ? "true" : undefined
                          }
                          className={cn(
                            "group flex items-center gap-3 rounded-xl px-3 py-2 text-[12px] font-semibold transition-all duration-150",
                            isChildActive
                              ? "bg-primary text-white shadow-[0_16px_28px_-20px_rgba(37,99,235,0.8)]"
                              : "text-content-3 hover:bg-surface-2 hover:text-content-1",
                            mobile ? "px-3 py-2 text-[12px]" : "",
                          )}
                        >
                          <div
                            className={cn(
                              "flex shrink-0 items-center justify-center rounded-lg p-0.5 transition-all duration-150",
                              isChildActive
                                ? "text-white"
                                : "text-content-4 group-hover:text-content-2",
                            )}
                          >
                            <child.icon
                              className="h-4 w-4"
                              strokeWidth={isChildActive ? 2 : 1.7}
                            />
                          </div>
                          <span className="flex-1 truncate">{child.title}</span>
                          {child.badge ? (
                            <span
                              className={cn(
                                "rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase",
                                isChildActive
                                  ? "bg-surface-1/15 text-white"
                                  : "border border-line bg-surface-2 text-content-3",
                              )}
                            >
                              {child.badge}
                            </span>
                          ) : null}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        );
      })}
    </nav>
  );
}

export function SidebarFooterProfile({
  compact = false,
}: {
  compact?: boolean;
}) {
  const { user } = useSidebarAuth();

  if (!user) return null;

  if (compact) {
    return (
      <div
        className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-surface-1 text-xs font-bold text-content-2 shadow-sm"
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
        "group flex items-center gap-3 rounded-xl bg-transparent p-2 transition-all hover:bg-surface-2",
        compact ? "p-3" : "",
      )}
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-surface-1 text-xs font-bold text-content-2 shadow-sm transition-colors group-hover:border-line-strong">
        {user.username.substring(0, 2).toUpperCase()}
      </div>
      <div className="flex min-w-0 flex-col">
        <span className="truncate text-[13px] font-semibold text-content-1">
          {user.full_name || user.username}
        </span>
        <div className="flex items-center gap-1.5">
          <div className="h-1.5 w-1.5 rounded-full bg-success-fg" />
          <span className="truncate text-[10px] font-medium text-content-3">
            {user.role_info?.name || "System User"}
          </span>
        </div>
      </div>
    </div>
  );
}

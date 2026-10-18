"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, LayoutGrid } from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { cn } from "@/lib/utils";
import { getLandingPage } from "@/lib/roles";
import { NAV_ITEMS, SIDEBAR_SECTION_ORDER, canAccessNavTarget } from "@/lib/sidebar-nav";
import { accessibleWorkspaces, resolveWorkspace } from "@/lib/workspaces";

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
      isSuperuser: user?.is_superuser,
      gateMaster: user?.entitlements?.gate_master,
      inventoryBillReview: user?.entitlements?.inventory_bill_review,
      documentEntitlements: user?.entitlements?.documents,
      grantedPermissions: extraPermissions,
    }),
    [baseRoleCode, extraPermissions, user?.is_owner, user?.is_superuser, user?.entitlements?.gate_master, user?.entitlements?.inventory_bill_review, user?.entitlements?.documents, userRoleCode],
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
    accessContext,
  };
}

const ALL_SCREENS_KEY = "erp.sidebar.allScreensOpen";

function readAllScreensOpen(): boolean {
  try {
    return window.localStorage.getItem(ALL_SCREENS_KEY) === "1";
  } catch {
    return false;
  }
}

/** The seven workspaces of the order spine: the first thing in the sidebar for every role. */
function WorkspaceLinks({
  compact,
  pathname,
  accessContext,
  onNavigate,
}: {
  compact: boolean;
  pathname: string;
  accessContext: Parameters<typeof accessibleWorkspaces>[0];
  onNavigate?: () => void;
}) {
  const items = useMemo(() => accessibleWorkspaces(accessContext), [accessContext]);
  const current = resolveWorkspace(pathname)?.workspace.key;
  if (!items.length) return null;
  return (
    <div className={cn(compact ? "space-y-2" : "space-y-0.5")} data-testid="sidebar-workspaces">
      {!compact ? (
        <div className="px-3 pb-1 pt-1 text-[11px] font-semibold text-content-4">Workspaces</div>
      ) : null}
      {items.map(({ workspace, href, tabs }, index) => {
        const active = current === workspace.key;
        const Icon = workspace.icon;
        if (compact) {
          return (
            <div key={workspace.key} className="mx-auto flex h-11 w-11 items-center justify-center">
              <Link
                href={href}
                onClick={onNavigate}
                title={`${workspace.label} · ${tabs.length} screens`}
                aria-label={workspace.label}
                aria-current={active ? "page" : undefined}
                data-testid={`sidebar-workspace-${workspace.key}`}
                data-active={active ? "true" : undefined}
                className={cn(
                  "relative flex h-11 w-11 items-center justify-center rounded-xl transition-colors duration-150",
                  active ? "bg-primary text-white" : "text-content-3 hover:bg-surface-2 hover:text-content-1",
                )}
              >
                <Icon className="h-[18px] w-[18px]" strokeWidth={active ? 2.1 : 1.8} />
              </Link>
            </div>
          );
        }
        return (
          <Link
            key={workspace.key}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            data-testid={`sidebar-workspace-${workspace.key}`}
            data-active={active ? "true" : undefined}
            data-active-current={active ? "true" : undefined}
            className={cn(
              "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] font-medium transition-colors duration-150",
              active ? "bg-primary text-white" : "text-content-2 hover:bg-surface-2 hover:text-content-1",
            )}
          >
            <Icon className={cn("h-[18px] w-[18px] flex-none", active ? "text-white" : "text-content-3 group-hover:text-content-1")} strokeWidth={active ? 2 : 1.8} />
            <span className="min-w-0 flex-1 truncate">{workspace.label}</span>
            <span className={cn("font-mono text-[11px]", active ? "text-white/75" : "text-content-4")}>{index + 1}</span>
          </Link>
        );
      })}
    </div>
  );
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
        <span className="text-caption font-semibold uppercase tracking-[0.1em] text-content-3">
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
  const { user, pathname, userRoleCode, authorizedItems, isAuthorized, accessContext } =
    useSidebarAuth();
  // Every screen of the old sidebar stays reachable under "All screens", folded by default
  // (opened automatically on a page that belongs to no workspace).
  const [allScreensOpen, setAllScreensOpen] = useState(false);
  useEffect(() => {
    setAllScreensOpen(readAllScreensOpen());
  }, []);
  const outsideWorkspaces = !resolveWorkspace(pathname);
  const showAllScreens = allScreensOpen || outsideWorkspaces;
  const toggleAllScreens = () => {
    setAllScreensOpen((open) => {
      const next = !open;
      try {
        window.localStorage.setItem(ALL_SCREENS_KEY, next ? "1" : "0");
      } catch {
        /* per-viewer convenience only */
      }
      return next;
    });
  };
  const navRef = useRef<HTMLElement>(null);
  // Explicit open/closed state of child groups ("section|group"); unset = open when it holds the current page.
  const [groupState, setGroupState] = useState<Record<string, boolean>>({});
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
      <WorkspaceLinks compact={compact && !mobile} pathname={pathname} accessContext={accessContext} onNavigate={onNavigate} />
      <div className={cn(compact && !mobile ? "mx-auto flex h-11 w-11 items-center justify-center" : "pt-2")}>
        <button
          type="button"
          onClick={toggleAllScreens}
          aria-expanded={showAllScreens}
          title="All screens"
          data-testid="sidebar-all-screens-toggle"
          className={cn(
            compact && !mobile
              ? "flex h-11 w-11 items-center justify-center rounded-xl text-content-4 transition-colors hover:bg-surface-2 hover:text-content-1"
              : "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-medium text-content-3 transition-colors hover:bg-surface-2 hover:text-content-1",
          )}
        >
          <LayoutGrid className="h-4 w-4 flex-none" strokeWidth={1.8} />
          {compact && !mobile ? null : (
            <>
              <span className="min-w-0 flex-1 text-left">All screens</span>
              <ChevronDown className={cn("h-4 w-4 transition-transform duration-150", showAllScreens ? "rotate-180" : "")} />
            </>
          )}
        </button>
      </div>
      {showAllScreens ? authorizedItems.map((item, index) => {
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
                <span className="absolute -right-1 -top-1 rounded-full bg-surface-3 px-1 py-0.5 text-caption font-bold text-white">
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
                    "relative flex h-11 w-11 items-center justify-center rounded-xl border transition-[color,background-color,border-color,box-shadow] duration-150 ease-out",
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
                    "relative flex h-11 w-11 items-center justify-center rounded-xl border transition-[color,background-color,border-color,box-shadow] duration-150 ease-out",
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
                    "absolute left-[52px] z-50 max-h-[min(70vh,560px)] w-64 overflow-y-auto rounded-2xl border border-line bg-surface-1 p-2 shadow-2xl ring-1 ring-line-strong/[0.04] transition-[opacity,transform,visibility] duration-150 ease-out",
                    compactChildrenOpen
                      ? "visible translate-x-1 opacity-100"
                      : "invisible -translate-x-2 opacity-0",
                    flyoutPlacement,
                  )}
                >
                  <div className="px-2 pb-2 pt-1 text-caption font-semibold uppercase tracking-[0.12em] text-content-4">
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
                          "group/item flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-semibold transition-[color,background-color,box-shadow] duration-150",
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
                              "rounded-full px-1.5 py-0.5 text-caption font-bold uppercase",
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
                  "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13px] font-semibold transition-[color,background-color,box-shadow] duration-150",
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
                    "mb-1 mt-5 flex items-center gap-2 px-3 py-1.5 text-caption font-bold uppercase tracking-[0.12em] text-content-4",
                    isActive ? "text-primary" : "",
                    mobile ? "mt-4 px-3 text-caption" : "",
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
                    "group flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-[13px] font-bold transition-[color,background-color,border-color,box-shadow] duration-150",
                    isActive
                      ? "border-info-border bg-info-bg text-content-1 shadow-sm"
                      : "border-transparent text-content-2 hover:border-line hover:bg-surface-1 hover:text-content-1",
                    mobile ? "px-3 py-2.5 text-[13px]" : "",
                  )}
                >
                  <div
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-[color,background-color,box-shadow] duration-150",
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
                        "rounded-full px-1.5 py-0.5 text-caption font-semibold",
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
                    "ml-[22px] mt-1 grid overflow-hidden border-l border-line pl-3 transition-[grid-template-rows,opacity,visibility] duration-200 ease-out",
                    childrenOpen
                      ? "visible grid-rows-[1fr] opacity-100"
                      : "invisible pointer-events-none grid-rows-[0fr] opacity-0",
                  )}
                >
                  <div className="min-h-0 space-y-1">
                    {(() => {
                      const renderChild = (child: NonNullable<typeof authorizedChildren>[number]) => {
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
                            "group flex items-center gap-3 rounded-xl px-3 py-2 text-[12px] font-semibold transition-[color,background-color,box-shadow] duration-150",
                            isChildActive
                              ? "bg-primary text-white shadow-[0_16px_28px_-20px_rgba(37,99,235,0.8)]"
                              : "text-content-3 hover:bg-surface-2 hover:text-content-1",
                            mobile ? "px-3 py-2 text-[12px]" : "",
                          )}
                        >
                          <div
                            className={cn(
                              "flex shrink-0 items-center justify-center rounded-lg p-0.5 transition-[color,background-color] duration-150",
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
                                "rounded-full px-1.5 py-0.5 text-caption font-bold uppercase",
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
                    };
                      const grouped: Array<{ name: string; items: NonNullable<typeof authorizedChildren> }> = [];
                      (authorizedChildren || []).forEach((child) => {
                        const name = child.group || "";
                        const last = grouped[grouped.length - 1];
                        if (last && last.name === name) last.items.push(child);
                        else grouped.push({ name, items: [child] });
                      });
                      const hasGroups = grouped.some((group) => group.name);
                      if (!hasGroups) return (authorizedChildren || []).map(renderChild);
                      return grouped.map((group) => {
                        if (!group.name) return group.items.map(renderChild);
                        const groupKey = `${sectionKey}|${group.name}`;
                        const holdsCurrent = group.items.some((child) => normalizeSidebarRoute(child.href) === normalizeSidebarRoute(activeChildHref || ""));
                        const open = groupState[groupKey] ?? holdsCurrent;
                        return (
                          <div key={groupKey} className="pt-1">
                            <button
                              type="button"
                              onClick={() => setGroupState((current) => ({ ...current, [groupKey]: !open }))}
                              aria-expanded={open}
                              data-testid={`sidebar-group-${navTestId(group.name)}`}
                              className={cn(
                                "group/g flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-caption font-bold uppercase tracking-[0.08em] transition-colors",
                                holdsCurrent ? "text-primary" : "text-content-4 hover:text-content-2",
                              )}
                            >
                              <span className="flex-1 truncate">{group.name}</span>
                              <span className="rounded-full bg-surface-2 px-1.5 text-caption font-semibold normal-case tracking-normal text-content-4">{group.items.length}</span>
                              <ChevronDown className={cn("h-3 w-3 shrink-0 transition-transform duration-200", open ? "rotate-180" : "")} strokeWidth={2} />
                            </button>
                            <div
                              className={cn(
                                "grid transition-[grid-template-rows,opacity,visibility] duration-200 ease-out",
                                open ? "visible grid-rows-[1fr] opacity-100" : "invisible pointer-events-none grid-rows-[0fr] opacity-0",
                              )}
                            >
                              <div className="min-h-0 space-y-1 overflow-hidden pb-1">{group.items.map(renderChild)}</div>
                            </div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>
              </>
            )}
          </div>
        );
      }) : null}
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
        "group flex items-center gap-3 rounded-xl bg-transparent p-2 transition-colors duration-150 hover:bg-surface-2",
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
          <span className="truncate text-caption font-medium text-content-3">
            {user.role_info?.name || "System User"}
          </span>
        </div>
      </div>
    </div>
  );
}

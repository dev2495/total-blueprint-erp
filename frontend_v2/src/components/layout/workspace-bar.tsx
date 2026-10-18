"use client";

/**
 * Workspace bar: shows which of the seven workspaces this screen belongs to and its tabs,
 * so every existing page is reachable as a tab instead of a sidebar hunt. Tabs the user's
 * role cannot open are hidden using the same rules as the sidebar.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef } from "react";

import { useAuth } from "@/components/auth-provider";
import { cn } from "@/lib/utils";
import { NAV_ITEMS, canAccessNavTarget, type NavItem } from "@/lib/sidebar-nav";
import { WORKSPACES, resolveWorkspace } from "@/lib/workspaces";

type NavTarget = NavItem | NonNullable<NavItem["children"]>[number];

function normalize(path: string) {
  return (String(path || "").split("?")[0].replace(/\/+$/g, "") || "/").toLowerCase();
}

/** Sidebar entries by href, so a workspace tab inherits the sidebar's role/permission rule. */
function buildNavIndex() {
  const index = new Map<string, NavTarget>();
  for (const item of NAV_ITEMS) {
    index.set(normalize(item.href), item);
    for (const child of item.children || []) index.set(normalize(child.href), child);
  }
  return index;
}

export function WorkspaceBar() {
  const pathname = usePathname() || "/";
  const { user, effectiveRole } = useAuth();
  const scroller = useRef<HTMLElement>(null);

  const roleCode = effectiveRole || user?.entitlements?.role || user?.role_info?.code || "GUEST";
  const baseRoleCode = user?.role_info?.code || "GUEST";
  const extraPermissions = user?.extra_permissions || user?.entitlements?.extra_overrides || [];
  const accessContext = useMemo(
    () => ({
      currentRoleCode: roleCode,
      baseRoleCode,
      isOwner: user?.is_owner,
      isSuperuser: user?.is_superuser,
      gateMaster: user?.entitlements?.gate_master,
      inventoryBillReview: user?.entitlements?.inventory_bill_review,
      documentEntitlements: user?.entitlements?.documents,
      grantedPermissions: extraPermissions,
    }),
    [baseRoleCode, extraPermissions, roleCode, user?.entitlements?.documents, user?.entitlements?.gate_master, user?.entitlements?.inventory_bill_review, user?.is_owner, user?.is_superuser],
  );
  const navIndex = useMemo(buildNavIndex, []);

  const resolved = useMemo(() => resolveWorkspace(pathname), [pathname]);

  const tabs = useMemo(() => {
    if (!resolved) return [];
    return resolved.workspace.tabs.filter((tab) => {
      const target = navIndex.get(normalize(tab.href));
      // A screen not listed in the sidebar is open to whoever can reach its page.
      return target ? canAccessNavTarget(target, accessContext) : true;
    });
  }, [accessContext, navIndex, resolved]);

  useEffect(() => {
    scroller.current?.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [pathname]);

  if (!resolved || tabs.length < 2) return null;
  const { workspace, tab: activeTab } = resolved;
  const Icon = workspace.icon;
  const index = WORKSPACES.findIndex((w) => w.key === workspace.key) + 1;

  return (
    <nav
      ref={scroller}
      aria-label={`${workspace.label} workspace`}
      data-testid="workspace-bar"
      className="mb-3 flex w-full min-w-0 items-center gap-2 overflow-x-auto rounded-2xl border border-line bg-surface-1/95 px-2 py-1.5 shadow-sm backdrop-blur"
    >
      <Link
        href={workspace.home}
        className="flex flex-none items-center gap-2 rounded-xl bg-primary px-3 py-1.5 text-[12.5px] font-semibold text-white"
        title={workspace.blurb}
        data-testid="workspace-bar-home"
      >
        <span className="font-mono text-[11px] opacity-80">{index}</span>
        <Icon className="h-3.5 w-3.5" aria-hidden />
        {workspace.label}
      </Link>
      <span className="hidden flex-none text-[11px] font-semibold uppercase tracking-[0.1em] text-content-4 sm:inline">{workspace.station}</span>
      <div className="flex min-w-0 items-center gap-1">
        {tabs.map((tab) => {
          const active = activeTab?.href === tab.href;
          return (
            <span key={tab.href} className="flex flex-none items-center">
              {tab.group ? (
                <span className="mx-1 hidden text-[10px] font-bold uppercase tracking-[0.12em] text-content-4 lg:inline">{tab.group}</span>
              ) : null}
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "whitespace-nowrap rounded-lg px-2.5 py-1 text-[12.5px] font-semibold transition-colors",
                  active ? "bg-info-bg text-primary ring-1 ring-info-border" : "text-content-2 hover:bg-surface-2 hover:text-content-1",
                )}
              >
                {tab.label}
              </Link>
            </span>
          );
        })}
      </div>
    </nav>
  );
}

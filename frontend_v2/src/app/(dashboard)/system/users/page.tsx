"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Crown,
  Plus,
  Search,
  Shield,
  ShieldCheck,
  Sparkles,
  UserCog,
} from "lucide-react";

import { GradientHero } from "@/components/erp/gradient-hero";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  systemUserService,
  type User,
  type Role,
} from "@/services/system-users";
import { useAuth } from "@/components/auth-provider";
import { cn } from "@/lib/utils";
import { getCanonicalRoleLabel } from "@/lib/roles";
import { paletteFor } from "@/components/system-users/role-colors";

function userCanManageRbac(user: any): boolean {
  if (!user) return false;
  if (user.is_superuser || user.is_owner) return true;
  const perms: string[] = user.entitlements?.permissions || [];
  if (perms.includes("*")) return true;
  return perms.includes("rbac.manage");
}

function userCanViewRbac(user: any): boolean {
  if (!user) return false;
  if (userCanManageRbac(user)) return true;
  const perms: string[] = user.entitlements?.permissions || [];
  return perms.includes("rbac.view");
}

function initials(u: User) {
  const f = (u.first_name || "").trim().charAt(0).toUpperCase();
  const l = (u.last_name || "").trim().charAt(0).toUpperCase();
  if (f || l) return `${f}${l}`;
  return (u.username || "?").slice(0, 2).toUpperCase();
}

export default function UsersPage() {
  const { user: me } = useAuth();
  const canManage = userCanManageRbac(me);
  const canView = userCanViewRbac(me);

  const usersQuery = useQuery({
    queryKey: ["users"],
    queryFn: systemUserService.getUsers,
  });
  const rolesQuery = useQuery({
    queryKey: ["roles"],
    queryFn: systemUserService.getRoles,
  });

  const [search, setSearch] = React.useState("");
  const [roleFilter, setRoleFilter] = React.useState<string>("ALL");

  const users = usersQuery.data || [];
  const roles = rolesQuery.data || [];

  const filtered = React.useMemo(() => {
    const needle = search.trim().toLowerCase();
    return users.filter((u) => {
      if (roleFilter !== "ALL") {
        const code = u.role_info?.code || "";
        if (code !== roleFilter) return false;
      }
      if (!needle) return true;
      const hay = [
        u.username,
        u.email,
        u.first_name,
        u.last_name,
        u.role_info?.code,
        u.role_info?.name,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    });
  }, [users, roleFilter, search]);

  const stats = React.useMemo(() => {
    const total = users.length;
    const active = users.filter((u) => u.is_active).length;
    const owners = users.filter((u) => u.is_owner).length;
    const overrides = users.filter(
      (u) => (u.extra_permissions || []).length > 0,
    ).length;
    return { total, active, owners, overrides };
  }, [users]);

  if (!canView) {
    return (
      <div className="grid min-h-screen place-items-center bg-surface-2 p-8 text-center">
        <div className="max-w-md rounded-3xl bg-surface-1 p-8 shadow-[0_20px_60px_-30px_rgba(15,23,42,0.25)] ring-1 ring-line">
          <ShieldCheck className="mx-auto h-10 w-10 text-content-4" />
          <h2 className="mt-3 font-display text-lg font-bold text-content-1">
            Access denied
          </h2>
          <p className="mt-1 text-sm text-content-3">
            You need{" "}
            <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[11px]">
              rbac.view
            </code>{" "}
            to see the user registry.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-order-bg via-white to-order-bg px-4 py-4 sm:px-6">
      <GradientHero
        palette="indigo"
        eyebrow="SYSTEM · GOVERNANCE"
        title="User Management"
        subtitle="Roles, access, and overrides — one workspace."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/system/role-matrix">
              <Button
                variant="secondary"
                className="bg-surface-1/95 text-order-fg hover:bg-surface-1"
              >
                <Shield className="mr-1.5 h-4 w-4" /> Role matrix
              </Button>
            </Link>
            {canManage ? (
              <Link href="/system/users/new">
                <Button className="bg-surface-1 text-order-fg hover:bg-order-bg">
                  <Plus className="mr-1.5 h-4 w-4" /> Add user
                </Button>
              </Link>
            ) : null}
          </div>
        }
      />

      {/* KPIs */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile
          icon={UserCog}
          label="Total users"
          value={stats.total}
          palette="indigo"
        />
        <KpiTile
          icon={Activity}
          label="Active"
          value={stats.active}
          palette="emerald"
        />
        <KpiTile
          icon={Crown}
          label="Owners"
          value={stats.owners}
          palette="rose"
        />
        <KpiTile
          icon={Sparkles}
          label="With overrides"
          value={stats.overrides}
          palette="amber"
        />
      </div>

      {/* Filter bar */}
      <section className="mt-6 rounded-3xl bg-surface-1 p-5 shadow-[0_20px_60px_-30px_rgba(15,23,42,0.25)] ring-1 ring-line">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-content-4" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email or role…"
              className="pl-9"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <RolePill
              label="All"
              code="ALL"
              active={roleFilter === "ALL"}
              onClick={() => setRoleFilter("ALL")}
            />
            {roles.map((r: Role) => (
              <RolePill
                key={r.id}
                label={getCanonicalRoleLabel(r.code, r.name)}
                code={r.code}
                active={roleFilter === r.code}
                onClick={() => setRoleFilter(r.code)}
              />
            ))}
          </div>
        </div>
      </section>

      {/* Cards */}
      {usersQuery.isLoading ? (
        <div className="mt-6 grid place-items-center p-16 text-sm text-content-3">
          Loading users…
        </div>
      ) : filtered.length === 0 ? (
        <div className="mt-6 rounded-3xl border border-dashed border-line-strong bg-surface-1/60 p-12 text-center">
          <UserCog className="mx-auto h-8 w-8 text-content-4" />
          <div className="mt-2 font-display text-sm font-bold text-content-2">
            No users match
          </div>
          <p className="mt-1 text-xs text-content-3">Try clearing filters.</p>
        </div>
      ) : (
        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((u) => (
            <UserCard key={u.id} user={u} canManage={canManage} />
          ))}
        </div>
      )}
    </div>
  );
}

function KpiTile({
  icon: Icon,
  label,
  value,
  palette,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  palette: "indigo" | "emerald" | "rose" | "amber";
}) {
  const BG: Record<string, string> = {
    indigo: "from-order-fg to-order-bg",
    emerald: "from-success-fg to-success-bg",
    rose: "from-danger-solid to-danger-bg",
    amber: "from-warning-fg to-warning-bg",
  };
  const TEXT: Record<string, string> = {
    indigo: "text-order-fg",
    emerald: "text-success-fg",
    rose: "text-danger-fg",
    amber: "text-warning-fg",
  };
  return (
    <div
      className={cn(
        "rounded-3xl bg-gradient-to-br p-5 shadow-[0_20px_60px_-30px_rgba(15,23,42,0.25)] ring-1 ring-line",
        BG[palette],
      )}
    >
      <div className="flex items-center justify-between">
        <div
          className={cn(
            "grid h-9 w-9 place-items-center rounded-2xl bg-surface-1",
            TEXT[palette],
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
        <span className="text-[10px] font-bold uppercase tracking-widest text-content-3">
          {label}
        </span>
      </div>
      <div className="mt-3 font-display text-3xl font-bold tabular-nums text-content-1">
        {value}
      </div>
    </div>
  );
}

function RolePill({
  label,
  code,
  active,
  onClick,
}: {
  label: string;
  code: string;
  active: boolean;
  onClick: () => void;
}) {
  const palette = paletteFor(code === "ALL" ? "DEFAULT" : code);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full px-3 py-1 text-[11px] font-bold ring-1 transition",
        active
          ? cn(palette.bg, palette.text, palette.ring)
          : "bg-surface-1 text-content-3 ring-line hover:bg-surface-2",
      )}
    >
      {label}
    </button>
  );
}

function UserCard({ user, canManage }: { user: User; canManage: boolean }) {
  const palette = paletteFor(user.role_info?.code);
  const overrides = (user.extra_permissions || []).length;

  return (
    <Link
      href={`/system/users/${user.id}`}
      className="group relative overflow-hidden rounded-3xl bg-surface-1 p-5 shadow-[0_20px_60px_-30px_rgba(15,23,42,0.25)] ring-1 ring-line transition hover:-translate-y-0.5 hover:shadow-[0_30px_80px_-30px_rgba(15,23,42,0.3)]"
    >
      <div
        className={cn(
          "absolute inset-x-0 top-0 h-1 bg-gradient-to-r",
          palette.stripe,
        )}
      />
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "grid h-12 w-12 shrink-0 place-items-center rounded-2xl ring-2 font-display text-base font-bold",
            palette.bg,
            palette.text,
            palette.ring,
          )}
        >
          {initials(user)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-display text-base font-bold text-content-1">
              {user.full_name || user.username}
            </h3>
            {user.is_owner ? (
              <span title="Owner" className="text-danger-fg">
                <Crown className="h-3.5 w-3.5" />
              </span>
            ) : null}
          </div>
          <div className="truncate font-mono text-[11px] text-content-3">
            {user.email || "no email"}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Badge className={cn(palette.bg, palette.text, "ring-1", palette.ring)}>
          {user.role_info?.code
            ? getCanonicalRoleLabel(user.role_info.code, user.role_info.name)
            : "No role"}
        </Badge>
        <Badge
          className={cn(
            "ring-1",
            user.is_active
              ? "bg-success-bg text-success-fg ring-success-border"
              : "bg-surface-2 text-content-3 ring-line",
          )}
        >
          {user.is_active ? "Active" : "Inactive"}
        </Badge>
        {overrides > 0 ? (
          <Badge className="bg-warning-bg text-warning-fg ring-1 ring-warning-border">
            +{overrides} override{overrides === 1 ? "" : "s"}
          </Badge>
        ) : null}
      </div>

      <div className="mt-4 flex items-center justify-end text-[11px] font-bold text-order-fg">
        {canManage ? "Edit →" : "View →"}
      </div>
    </Link>
  );
}

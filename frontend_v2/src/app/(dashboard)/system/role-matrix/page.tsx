"use client";

import * as React from "react";
import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Grid3X3, RefreshCw, ShieldAlert, Users } from "lucide-react";

import { GradientHero } from "@/components/erp/gradient-hero";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/components/auth-provider";
import { getCanonicalRoleLabel } from "@/lib/roles";
import { RbacService } from "@/services/rbac";
import { systemUserService, type Role } from "@/services/system-users";
import {
  FLOOR_OPS_BUNDLE,
  SYSTEM_ROLES,
  buildPermissionRows,
  draftFromMatrix,
  errorDetail,
  normalizePermissionList,
  sameList,
} from "@/components/access/access-model";
import { RoleMatrixGrid, type RolePreset } from "@/components/access/role-matrix-grid";
import { PeopleOverrides } from "@/components/access/people-overrides";

function userCanManageRbac(user: any): boolean {
  if (!user) return false;
  if (user.is_superuser || user.is_owner) return true;
  const perms: string[] = user.entitlements?.permissions || [];
  return perms.includes("*") || perms.includes("rbac.manage");
}

type PendingConfirm = { roleCode: string; preset: "reset" | "clear-added"; permissions: string[] } | null;

function RolesAndAccess() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user: me } = useAuth();
  const canManage = userCanManageRbac(me);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = searchParams?.get("tab") === "people" ? "people" : "roles";

  const matrixQuery = useQuery({ queryKey: ["role-matrix"], queryFn: RbacService.exportRoleMatrix });
  const catalogQuery = useQuery({ queryKey: ["role-permission-catalog"], queryFn: systemUserService.getPermissionCatalog });
  const rolesQuery = useQuery({ queryKey: ["roles"], queryFn: systemUserService.getRoles });

  const saved = React.useMemo(() => draftFromMatrix(matrixQuery.data), [matrixQuery.data]);
  const [draft, setDraft] = React.useState<Record<string, string[]>>({});
  const [unlockSystemRoles, setUnlockSystemRoles] = React.useState(false);
  const [confirm, setConfirm] = React.useState<PendingConfirm>(null);

  React.useEffect(() => {
    setDraft(saved);
  }, [saved]);

  const baseline = React.useMemo(
    () =>
      Object.fromEntries(
        Object.entries(matrixQuery.data || {}).map(([code, row]) => [code, normalizePermissionList(row?.default_permissions)]),
      ),
    [matrixQuery.data],
  );

  const roleMeta = React.useMemo(() => {
    const map = new Map<string, Role>();
    (rolesQuery.data || []).forEach((role) => map.set(role.code, role));
    return map;
  }, [rolesQuery.data]);

  const columns = React.useMemo(
    () =>
      Object.keys(draft)
        .map((code) => ({ code, label: getCanonicalRoleLabel(code, roleMeta.get(code)?.name) }))
        .sort((a, b) => Number(SYSTEM_ROLES.has(a.code)) - Number(SYSTEM_ROLES.has(b.code)) || a.label.localeCompare(b.label)),
    [draft, roleMeta],
  );

  const rows = React.useMemo(
    () => buildPermissionRows(catalogQuery.data || [], Object.values(draft).flat()),
    [catalogQuery.data, draft],
  );
  const assignable = React.useMemo(() => new Set(rows.filter((row) => row.assignable).map((row) => row.permission)), [rows]);

  const changedRoles = React.useMemo(
    () => columns.filter((column) => !sameList(draft[column.code], saved[column.code])),
    [columns, draft, saved],
  );
  const changeCount = React.useMemo(
    () =>
      changedRoles.reduce((sum, column) => {
        const before = new Set(saved[column.code] || []);
        const after = new Set(draft[column.code] || []);
        let count = 0;
        after.forEach((permission) => !before.has(permission) && count++);
        before.forEach((permission) => !after.has(permission) && count++);
        return sum + count;
      }, 0),
    [changedRoles, draft, saved],
  );
  const dirty = changedRoles.length > 0;

  React.useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const locked = (roleCode: string) => SYSTEM_ROLES.has(roleCode) && !unlockSystemRoles;

  const setRole = (roleCode: string, permissions: string[]) => {
    if (!roleCode || locked(roleCode)) return;
    setDraft((previous) => ({ ...previous, [roleCode]: normalizePermissionList(permissions) }));
  };

  const toggle = (roleCode: string, permissions: string[], on: boolean) => {
    if (locked(roleCode)) return;
    const allowed = permissions.filter((permission) => assignable.has(permission));
    if (!allowed.length) return;
    const current = new Set(draft[roleCode] || []);
    allowed.forEach((permission) => (on ? current.add(permission) : current.delete(permission)));
    setRole(roleCode, Array.from(current));
  };

  const addPermissions = (roleCode: string, permissions: string[], name: string) => {
    const current = new Set(draft[roleCode] || []);
    const additions = permissions.filter((permission) => assignable.has(permission) && !current.has(permission));
    if (!additions.length) {
      toast({ title: "No change", description: `${name} adds nothing new to this role.` });
      return;
    }
    setRole(roleCode, [...Array.from(current), ...additions]);
    toast({ title: `${name} added`, description: `${additions.length} right${additions.length === 1 ? "" : "s"} added. Save to apply.` });
  };

  const preset = (roleCode: string, kind: RolePreset, visible: string[]) => {
    if (locked(roleCode)) return;
    if (kind === "read-only") {
      addPermissions(
        roleCode,
        rows.filter((row) => row.assignable && (row.actionKey === "view" || row.permission === "users.self_manage")).map((row) => row.permission),
        "Every view right",
      );
    } else if (kind === "floor-ops") {
      addPermissions(roleCode, FLOOR_OPS_BUNDLE.filter((permission) => assignable.has(permission)), "Floor set");
    } else if (kind === "reset") {
      setConfirm({ roleCode, preset: "reset", permissions: baseline[roleCode] || [] });
    } else {
      const base = new Set(baseline[roleCode] || []);
      const extras = visible.filter((permission) => (draft[roleCode] || []).includes(permission) && !base.has(permission));
      if (!extras.length) {
        toast({ title: "No change", description: "No added rights are shown for this role." });
        return;
      }
      setConfirm({ roleCode, preset: "clear-added", permissions: extras });
    }
  };

  const applyConfirm = () => {
    if (!confirm) return;
    if (confirm.preset === "reset") {
      setRole(confirm.roleCode, confirm.permissions);
    } else {
      const remove = new Set(confirm.permissions);
      setRole(confirm.roleCode, (draft[confirm.roleCode] || []).filter((permission) => !remove.has(permission)));
    }
    setConfirm(null);
  };

  const saveMutation = useMutation({
    mutationFn: async () => RbacService.importRoleMatrix(draft),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["role-matrix"] });
      toast({
        title: "Roles saved",
        description: `Updated: ${(result.updated_roles || []).map((code) => getCanonicalRoleLabel(code)).join(", ") || "none"}`,
      });
    },
    onError: (error: unknown) => toast({ title: "Save failed", description: errorDetail(error), variant: "destructive" }),
  });

  const syncMutation = useMutation({
    mutationFn: RbacService.syncRoleMatrixDefaults,
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["role-matrix"] });
      toast({ title: "Standard sets synced", description: `Synced: ${(result.updated_roles || []).join(", ") || "none"}` });
    },
    onError: (error: unknown) => toast({ title: "Sync failed", description: errorDetail(error), variant: "destructive" }),
  });

  const setTab = (next: string) => {
    const params = new URLSearchParams(searchParams?.toString() || "");
    if (next === "people") params.set("tab", "people");
    else params.delete("tab");
    router.replace(`${pathname}${params.toString() ? `?${params}` : ""}`, { scroll: false });
  };

  const loading = matrixQuery.isLoading || catalogQuery.isLoading || rolesQuery.isLoading;

  return (
    <div className="min-h-screen bg-surface-2 px-4 pb-6 pt-4 sm:px-6">
      <GradientHero
        tone="subtle"
        eyebrow="SYSTEM · ACCESS"
        title="Roles & access"
        subtitle="What each role can do, and what one person gets on top of their role."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" asChild>
              <Link href="/system/users">All users</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/system/governance">Governance</Link>
            </Button>
            {canManage ? (
              <Button variant="outline" onClick={() => syncMutation.mutate()} disabled={syncMutation.isPending}>
                <RefreshCw className="mr-2 h-4 w-4" />
                {syncMutation.isPending ? "Syncing…" : "Sync standard sets"}
              </Button>
            ) : null}
          </div>
        }
      />

      <Tabs value={tab} onValueChange={setTab} className="mt-4">
        <div className="flex flex-wrap items-center gap-3">
          <TabsList className="h-10">
            <TabsTrigger value="roles" className="gap-1.5 px-4">
              <Grid3X3 className="h-4 w-4" /> Roles
              {dirty ? <span className="ml-1 h-2 w-2 rounded-full bg-warning-fg" aria-label="Unsaved changes" /> : null}
            </TabsTrigger>
            <TabsTrigger value="people" className="gap-1.5 px-4">
              <Users className="h-4 w-4" /> People
            </TabsTrigger>
          </TabsList>
          {tab === "roles" ? (
            <label className="ml-auto flex h-9 items-center gap-2 rounded-lg border border-warning-border bg-warning-bg px-3 text-xs font-semibold text-warning-fg">
              <ShieldAlert className="h-4 w-4" />
              Unlock Owner / Admin columns
              <Switch checked={unlockSystemRoles} onCheckedChange={setUnlockSystemRoles} aria-label="Unlock system roles" />
            </label>
          ) : null}
        </div>

        <TabsContent value="roles" className="mt-3">
          {loading ? (
            <div className="grid place-items-center rounded-2xl border border-line bg-surface-1 p-16 text-sm text-content-3">Loading roles…</div>
          ) : (
            <RoleMatrixGrid
              rows={rows}
              columns={columns}
              draft={draft}
              saved={saved}
              baseline={baseline}
              unlockSystemRoles={unlockSystemRoles && canManage}
              onToggle={(roleCode, permissions, on) => canManage && toggle(roleCode, permissions, on)}
              onPreset={(roleCode, kind, visible) => canManage && preset(roleCode, kind, visible)}
            />
          )}
        </TabsContent>

        <TabsContent value="people" className="mt-3">
          {loading ? (
            <div className="grid place-items-center rounded-2xl border border-line bg-surface-1 p-16 text-sm text-content-3">Loading…</div>
          ) : (
            <PeopleOverrides rows={rows} roleRights={saved} canManage={canManage} />
          )}
        </TabsContent>
      </Tabs>

      {tab === "roles" && dirty ? (
        <div className="sticky bottom-3 z-40 mt-3 rounded-2xl border border-warning-border bg-surface-1/95 px-4 py-3 shadow-[0_12px_40px_-16px_rgba(15,23,42,0.45)] backdrop-blur">
          <div className="flex flex-wrap items-center gap-3">
            <span className="h-2.5 w-2.5 rounded-full bg-warning-fg" />
            <div className="mr-auto text-sm">
              <span className="font-bold text-content-1">
                {changeCount} change{changeCount === 1 ? "" : "s"}
              </span>{" "}
              <span className="text-content-3">in {changedRoles.map((column) => column.label).join(", ")}</span>
            </div>
            <Button variant="outline" onClick={() => setDraft(saved)} disabled={saveMutation.isPending}>
              Discard
            </Button>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending || !canManage}>
              {saveMutation.isPending ? "Saving…" : "Save roles"}
            </Button>
          </div>
        </div>
      ) : null}

      <AlertDialog open={Boolean(confirm)} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.preset === "reset" ? "Reset to the standard set?" : "Remove the added rights shown?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.preset === "reset"
                ? `${getCanonicalRoleLabel(confirm?.roleCode)} goes back to its standard rights; every addition and removal is undone.`
                : `${confirm?.permissions.length || 0} added right${confirm?.permissions.length === 1 ? "" : "s"} come off ${getCanonicalRoleLabel(confirm?.roleCode)}. Standard rights stay.`}{" "}
              Nothing is saved until you press Save roles.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={applyConfirm}>{confirm?.preset === "reset" ? "Reset" : "Remove"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function RoleMatrixPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-content-3">Loading…</div>}>
      <RolesAndAccess />
    </Suspense>
  );
}

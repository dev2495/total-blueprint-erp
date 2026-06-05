"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Wand2,
} from "lucide-react";

import { RbacService, type RoleMatrix } from "@/services/rbac";
import {
  systemUserService,
  type PermissionCatalogEntry,
  type Role,
} from "@/services/system-users";
import { PageHeader } from "@/components/ui-custom/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
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
import { getCanonicalRoleLabel } from "@/lib/roles";

const SYSTEM_ROLES = new Set(["OWNER", "ADMIN", "SUPER_ADMIN"]);
const FLOOR_OPS_BUNDLE = [
  "users.self_manage",
  "dashboard.view",
  "notifications.view",
  "factory.view",
  "production.view",
  "inventory.view",
  "mrp.view",
] as const;

type PermissionViewRow = {
  permission: string;
  moduleKey: string;
  actionKey: string;
  title: string;
  assignable: boolean;
};

function normalizePermission(permission: string): string {
  return String(permission || "").trim();
}

function normalizePermissionList(values: string[]): string[] {
  return Array.from(
    new Set(
      (values || []).map((value) => normalizePermission(value)).filter(Boolean),
    ),
  ).sort();
}

function buildDraftFromMatrix(matrix?: RoleMatrix): Record<string, string[]> {
  const draft: Record<string, string[]> = {};
  Object.entries(matrix || {}).forEach(([roleCode, row]) => {
    draft[roleCode] = normalizePermissionList([
      ...(row?.default_permissions || []),
      ...(row?.database_permissions || []),
    ]);
  });
  return draft;
}

function humanize(value: string): string {
  return String(value || "")
    .replace(/[_\-]+/g, " ")
    .replace(/\./g, " ")
    .trim()
    .replace(
      /\w\S*/g,
      (part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase(),
    );
}

function roleLabel(roleCode: string, roleMeta?: Role): string {
  return getCanonicalRoleLabel(roleCode, roleMeta?.name);
}

function permissionTitle(
  permission: string,
  entry?: PermissionCatalogEntry,
): string {
  if (permission === "*") return "Full System Access";
  const moduleName = humanize(entry?.module || permission.split(".")[0] || "");
  const actionName = humanize(entry?.action || permission.split(".")[1] || "");
  if (moduleName && actionName) return `${moduleName} · ${actionName}`;
  return humanize(permission);
}

function errorDetail(error: unknown): string {
  const typedError = error as {
    message?: string;
    response?: { data?: { detail?: unknown } };
  };
  const detail = typedError?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  if (detail) return JSON.stringify(detail);
  return typedError?.message || "Request failed";
}

export default function RoleMatrixPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [selectedRole, setSelectedRole] = useState<string>("");
  const [draftMatrix, setDraftMatrix] = useState<Record<string, string[]>>({});
  const [unlockSystemRoles, setUnlockSystemRoles] = useState(false);
  const [easyMode, setEasyMode] = useState(true);
  const [permissionSearch, setPermissionSearch] = useState("");
  const [moduleFilter, setModuleFilter] = useState("ALL");
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const [confirmRemoveVisibleOpen, setConfirmRemoveVisibleOpen] =
    useState(false);

  const matrixQuery = useQuery({
    queryKey: ["role-matrix"],
    queryFn: RbacService.exportRoleMatrix,
  });

  const catalogQuery = useQuery({
    queryKey: ["role-permission-catalog"],
    queryFn: systemUserService.getPermissionCatalog,
  });

  const rolesQuery = useQuery({
    queryKey: ["roles"],
    queryFn: systemUserService.getRoles,
  });

  useEffect(() => {
    if (!matrixQuery.data) return;
    const nextDraft = buildDraftFromMatrix(matrixQuery.data);
    setDraftMatrix(nextDraft);
    setSelectedRole((previousRole) => {
      if (previousRole && nextDraft[previousRole]) return previousRole;
      return Object.keys(nextDraft).sort()[0] || "";
    });
  }, [matrixQuery.data]);

  const roles = useMemo(() => rolesQuery.data ?? [], [rolesQuery.data]);
  const roleMetaByCode = useMemo(() => {
    const map = new Map<string, Role>();
    roles.forEach((role) => map.set(role.code, role));
    return map;
  }, [roles]);

  const roleCodes = useMemo(
    () => Object.keys(draftMatrix).sort(),
    [draftMatrix],
  );
  const selectedRow = selectedRole
    ? matrixQuery.data?.[selectedRole]
    : undefined;
  const baselinePermissions = useMemo(
    () => normalizePermissionList(selectedRow?.default_permissions || []),
    [selectedRow],
  );
  const baselineSet = useMemo(
    () => new Set(baselinePermissions),
    [baselinePermissions],
  );

  const selectedPermissions = useMemo(
    () => new Set(draftMatrix[selectedRole] || []),
    [draftMatrix, selectedRole],
  );

  const catalogRows = useMemo(
    () => catalogQuery.data ?? [],
    [catalogQuery.data],
  );
  const catalogByPermission = useMemo(() => {
    const map = new Map<string, PermissionCatalogEntry>();
    catalogRows.forEach((entry) => {
      const permission = normalizePermission(entry.permission);
      if (permission) map.set(permission, entry);
    });
    return map;
  }, [catalogRows]);

  const catalogPermissionSet = useMemo(() => {
    const set = new Set<string>();
    catalogRows.forEach((entry) => {
      const permission = normalizePermission(entry.permission);
      if (permission) set.add(permission);
    });
    return set;
  }, [catalogRows]);

  const allPermissions = useMemo(() => {
    const set = new Set<string>();
    catalogRows.forEach((entry) => {
      const permission = normalizePermission(entry.permission);
      if (permission) set.add(permission);
    });
    Object.values(draftMatrix).forEach((values) =>
      values.forEach((permission) => set.add(normalizePermission(permission))),
    );
    return Array.from(set).filter(Boolean).sort();
  }, [catalogRows, draftMatrix]);

  const permissionRows = useMemo(() => {
    return allPermissions.map((permission): PermissionViewRow => {
      const entry = catalogByPermission.get(permission);
      const moduleKey = String(
        entry?.module || permission.split(".")[0] || "misc",
      ).toUpperCase();
      const actionKey = String(
        entry?.action || permission.split(".")[1] || "",
      ).toLowerCase();
      return {
        permission,
        moduleKey,
        actionKey,
        title: permissionTitle(permission, entry),
        assignable: Boolean(entry?.assignable ?? permission !== "*"),
      };
    });
  }, [allPermissions, catalogByPermission]);

  const moduleOptions = useMemo(() => {
    const values = Array.from(
      new Set(permissionRows.map((row) => row.moduleKey)),
    ).sort();
    return ["ALL", ...values];
  }, [permissionRows]);

  useEffect(() => {
    if (!moduleOptions.includes(moduleFilter)) setModuleFilter("ALL");
  }, [moduleFilter, moduleOptions]);

  const filteredPermissionRows = useMemo(() => {
    const query = permissionSearch.trim().toLowerCase();
    return permissionRows.filter((row) => {
      if (easyMode && row.permission === "*") return false;
      if (moduleFilter !== "ALL" && row.moduleKey !== moduleFilter)
        return false;
      if (showSelectedOnly && !selectedPermissions.has(row.permission))
        return false;
      if (!query) return true;
      return `${row.title} ${row.permission} ${row.moduleKey} ${row.actionKey}`
        .toLowerCase()
        .includes(query);
    });
  }, [
    easyMode,
    moduleFilter,
    permissionSearch,
    permissionRows,
    selectedPermissions,
    showSelectedOnly,
  ]);

  const groupedPermissionRows = useMemo(() => {
    const groups: Record<string, PermissionViewRow[]> = {};
    filteredPermissionRows.forEach((row) => {
      if (!groups[row.moduleKey]) groups[row.moduleKey] = [];
      groups[row.moduleKey].push(row);
    });
    Object.values(groups).forEach((rows) =>
      rows.sort((left, right) => left.title.localeCompare(right.title)),
    );
    return groups;
  }, [filteredPermissionRows]);

  const visiblePermissions = useMemo(
    () =>
      filteredPermissionRows
        .filter((row) => row.assignable)
        .map((row) => row.permission),
    [filteredPermissionRows],
  );

  const visibleNotSelected = useMemo(
    () =>
      visiblePermissions.filter(
        (permission) => !selectedPermissions.has(permission),
      ),
    [visiblePermissions, selectedPermissions],
  );

  const visibleExtraSelected = useMemo(
    () =>
      visiblePermissions.filter(
        (permission) =>
          selectedPermissions.has(permission) && !baselineSet.has(permission),
      ),
    [visiblePermissions, selectedPermissions, baselineSet],
  );

  const readOnlyPresetPermissions = useMemo(
    () =>
      permissionRows
        .filter(
          (row) =>
            row.assignable &&
            (row.actionKey === "view" ||
              row.permission === "users.self_manage"),
        )
        .map((row) => row.permission),
    [permissionRows],
  );

  const floorOpsPresetPermissions = useMemo(
    () =>
      FLOOR_OPS_BUNDLE.filter((permission) =>
        catalogPermissionSet.has(permission),
      ),
    [catalogPermissionSet],
  );

  const baselineCount = baselinePermissions.length;
  const selectedCount = selectedPermissions.size;
  const extraCount = Array.from(selectedPermissions).filter(
    (permission) => !baselineSet.has(permission),
  ).length;
  const isSystemRole = SYSTEM_ROLES.has(selectedRole);
  const editingLocked = isSystemRole && !unlockSystemRoles;
  const canEdit = Boolean(selectedRole) && !editingLocked;

  const hasUnsavedChanges = useMemo(() => {
    const source = buildDraftFromMatrix(matrixQuery.data);
    const allRoles = new Set([
      ...Object.keys(source),
      ...Object.keys(draftMatrix),
    ]);
    for (const roleCode of allRoles) {
      const original = source[roleCode] || [];
      const current = normalizePermissionList(draftMatrix[roleCode] || []);
      if (original.length !== current.length) return true;
      for (let index = 0; index < original.length; index += 1) {
        if (original[index] !== current[index]) return true;
      }
    }
    return false;
  }, [matrixQuery.data, draftMatrix]);

  const setRolePermissions = (permissions: string[]) => {
    if (!selectedRole || editingLocked) return;
    const normalized = normalizePermissionList(permissions);
    setDraftMatrix((previous) => ({
      ...previous,
      [selectedRole]: normalized,
    }));
  };

  const togglePermission = (permission: string, checked: boolean) => {
    if (!selectedRole || editingLocked) return;
    const row = permissionRows.find((item) => item.permission === permission);
    if (!row?.assignable) return;
    setDraftMatrix((previous) => {
      const current = new Set(previous[selectedRole] || []);
      if (checked) current.add(permission);
      else current.delete(permission);
      return {
        ...previous,
        [selectedRole]: normalizePermissionList(Array.from(current)),
      };
    });
  };

  const applyAdditivePreset = (permissions: string[], name: string) => {
    if (!canEdit) return;
    const current = new Set(draftMatrix[selectedRole] || []);
    const validPermissions = permissions.filter((permission) =>
      permissionRows.some(
        (row) => row.permission === permission && row.assignable,
      ),
    );
    const additions = validPermissions.filter(
      (permission) => !current.has(permission),
    );
    if (!additions.length) {
      toast({
        title: "No change",
        description: `${name} did not add new permissions.`,
      });
      return;
    }
    setRolePermissions([...Array.from(current), ...additions]);
    toast({
      title: `${name} applied`,
      description: `Added ${additions.length} permission${additions.length > 1 ? "s" : ""}.`,
    });
  };

  const addVisiblePermissions = () => {
    if (!canEdit) return;
    if (!visibleNotSelected.length) {
      toast({
        title: "No change",
        description: "All visible permissions are already selected.",
      });
      return;
    }
    setRolePermissions([
      ...(draftMatrix[selectedRole] || []),
      ...visibleNotSelected,
    ]);
    toast({
      title: "Added visible permissions",
      description: `Added ${visibleNotSelected.length} permission${visibleNotSelected.length > 1 ? "s" : ""}.`,
    });
  };

  const removeVisibleExtras = () => {
    if (!canEdit) return;
    if (!visibleExtraSelected.length) {
      toast({
        title: "No change",
        description: "No visible extra permissions to remove.",
      });
      return;
    }
    const current = new Set(draftMatrix[selectedRole] || []);
    visibleExtraSelected.forEach((permission) => current.delete(permission));
    setRolePermissions(Array.from(current));
    toast({
      title: "Visible extras removed",
      description: `Removed ${visibleExtraSelected.length} permission${visibleExtraSelected.length > 1 ? "s" : ""}.`,
    });
  };

  const resetRoleToBaseline = () => {
    if (!canEdit) return;
    setRolePermissions(baselinePermissions);
    toast({
      title: "Role reset to baseline",
      description: `Restored ${selectedRole} to baseline defaults.`,
    });
  };

  const saveMutation = useMutation({
    mutationFn: async () => RbacService.importRoleMatrix(draftMatrix),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["role-matrix"] });
      toast({
        title: "Role matrix updated",
        description: `Updated roles: ${(result.updated_roles || []).join(", ") || "none"}`,
      });
    },
    onError: (error: unknown) => {
      toast({
        title: "Save failed",
        description: errorDetail(error),
        variant: "destructive",
      });
    },
  });

  const syncDefaultsMutation = useMutation({
    mutationFn: RbacService.syncRoleMatrixDefaults,
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["role-matrix"] });
      toast({
        title: "Synced role defaults",
        description: `Synced roles: ${(result.updated_roles || []).join(", ") || "none"}`,
      });
    },
    onError: (error: unknown) => {
      toast({
        title: "Sync failed",
        description: errorDetail(error),
        variant: "destructive",
      });
    },
  });

  const loading =
    matrixQuery.isLoading || catalogQuery.isLoading || rolesQuery.isLoading;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Role Matrix"
        description="Easy mode for role access setup: choose role, apply preset, review, and save."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" asChild>
              <Link href="/system/governance">Governance Console</Link>
            </Button>
            <Button
              variant="outline"
              onClick={() => syncDefaultsMutation.mutate()}
              disabled={syncDefaultsMutation.isPending}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              {syncDefaultsMutation.isPending ? "Syncing..." : "Sync Defaults"}
            </Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={
                saveMutation.isPending || !selectedRole || !hasUnsavedChanges
              }
            >
              <Save className="mr-2 h-4 w-4" />
              {saveMutation.isPending ? "Saving..." : "Save Matrix"}
            </Button>
          </div>
        }
      />

      {loading ? (
        <Card>
          <CardContent className="py-10 text-center text-content-3">
            Loading role matrix...
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Role Setup</CardTitle>
              <CardDescription>
                Pick a role, apply safe presets, and fine-tune access.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Select value={selectedRole} onValueChange={setSelectedRole}>
                <SelectTrigger>
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  {roleCodes.map((roleCode) => (
                    <SelectItem key={roleCode} value={roleCode}>
                      {roleLabel(roleCode, roleMetaByCode.get(roleCode))}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="flex items-center justify-between rounded-md border bg-surface-2 px-3 py-2">
                <div className="text-xs font-medium text-content-3">
                  Easy Mode
                </div>
                <Switch checked={easyMode} onCheckedChange={setEasyMode} />
              </div>

              <div className="grid grid-cols-3 gap-2 text-xs">
                <Card className="border-line">
                  <CardContent className="py-3">
                    <div className="text-content-3">Base</div>
                    <div className="text-xl font-black">{baselineCount}</div>
                  </CardContent>
                </Card>
                <Card className="border-line">
                  <CardContent className="py-3">
                    <div className="text-content-3">Selected</div>
                    <div className="text-xl font-black">{selectedCount}</div>
                  </CardContent>
                </Card>
                <Card className="border-line">
                  <CardContent className="py-3">
                    <div className="text-content-3">Extra</div>
                    <div className="text-xl font-black">{extraCount}</div>
                  </CardContent>
                </Card>
              </div>

              {hasUnsavedChanges ? (
                <Badge
                  variant="outline"
                  className="w-fit border-warning-border bg-warning-bg text-warning-fg"
                >
                  Unsaved changes
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="w-fit border-success-border bg-success-bg text-success-fg"
                >
                  All changes saved
                </Badge>
              )}

              {isSystemRole ? (
                <div className="rounded-md border border-warning-border bg-warning-bg px-3 py-2 text-xs text-warning-fg">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 font-semibold">
                      <ShieldAlert className="h-3.5 w-3.5" />
                      System role lock
                    </div>
                    <Switch
                      checked={unlockSystemRoles}
                      onCheckedChange={setUnlockSystemRoles}
                    />
                  </div>
                  <p className="mt-2">
                    OWNER/ADMIN/SUPER_ADMIN require explicit unlock before any
                    edit.
                  </p>
                </div>
              ) : null}

              <div className="space-y-2 rounded-md border bg-surface-2 p-3">
                <div className="text-xs font-semibold text-content-2">
                  Quick Presets
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-start"
                  disabled={!canEdit}
                  onClick={() =>
                    applyAdditivePreset(
                      readOnlyPresetPermissions,
                      "Read-only preset",
                    )
                  }
                >
                  <Sparkles className="mr-2 h-4 w-4" />
                  Read-only preset
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-start"
                  disabled={!canEdit}
                  onClick={() =>
                    applyAdditivePreset(
                      floorOpsPresetPermissions,
                      "Floor ops preset",
                    )
                  }
                >
                  <Wand2 className="mr-2 h-4 w-4" />
                  Floor ops preset
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-start text-warning-fg"
                  disabled={!canEdit}
                  onClick={() => setConfirmResetOpen(true)}
                >
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Reset to baseline
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" /> Permission Setup
              </CardTitle>
              <CardDescription>
                {easyMode
                  ? "Use filters and friendly labels to quickly assign the right access."
                  : "Advanced mode shows raw permission codes for technical review."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!selectedRole ? (
                <div className="rounded-md border border-dashed p-8 text-center text-sm text-content-3">
                  Select a role to begin editing.
                </div>
              ) : (
                <>
                  <div className="grid gap-2 md:grid-cols-[1fr_180px_auto]">
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-content-4" />
                      <Input
                        value={permissionSearch}
                        onChange={(event) =>
                          setPermissionSearch(event.target.value)
                        }
                        placeholder="Search permission..."
                        className="pl-9"
                      />
                    </div>
                    <Select
                      value={moduleFilter}
                      onValueChange={setModuleFilter}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Module" />
                      </SelectTrigger>
                      <SelectContent>
                        {moduleOptions.map((moduleKey) => (
                          <SelectItem key={moduleKey} value={moduleKey}>
                            {moduleKey === "ALL"
                              ? "All modules"
                              : humanize(moduleKey)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant={showSelectedOnly ? "default" : "outline"}
                      onClick={() => setShowSelectedOnly((value) => !value)}
                    >
                      Selected only
                    </Button>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge variant="outline">
                      Visible: {filteredPermissionRows.length}
                    </Badge>
                    <Badge variant="outline">
                      Can add: {visibleNotSelected.length}
                    </Badge>
                    <Badge variant="outline">
                      Visible extras: {visibleExtraSelected.length}
                    </Badge>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!canEdit || !visibleNotSelected.length}
                      onClick={addVisiblePermissions}
                    >
                      Add visible
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!canEdit || !visibleExtraSelected.length}
                      onClick={() => setConfirmRemoveVisibleOpen(true)}
                    >
                      Remove visible extras
                    </Button>
                  </div>

                  <ScrollArea className="h-[560px] rounded-md border p-4">
                    {Object.entries(groupedPermissionRows).map(
                      ([moduleKey, rows]) => (
                        <div key={moduleKey} className="mb-6 last:mb-0">
                          <div className="mb-2 flex items-center gap-2 border-b pb-2">
                            <span className="h-2 w-2 rounded-full bg-primary" />
                            <h4 className="text-sm font-bold uppercase tracking-wide text-content-2">
                              {humanize(moduleKey)}
                            </h4>
                          </div>
                          <div className="grid gap-2 md:grid-cols-2">
                            {rows.map((row) => {
                              const checked = selectedPermissions.has(
                                row.permission,
                              );
                              const locked = editingLocked || !row.assignable;
                              return (
                                <label
                                  key={row.permission}
                                  className={`flex items-start justify-between rounded-md border px-3 py-2 ${
                                    checked
                                      ? "bg-info-bg border-info-border"
                                      : "bg-surface-1"
                                  }`}
                                >
                                  <div className="flex items-start gap-3">
                                    <Checkbox
                                      checked={checked}
                                      disabled={locked}
                                      onCheckedChange={(value) =>
                                        togglePermission(
                                          row.permission,
                                          Boolean(value),
                                        )
                                      }
                                    />
                                    <div>
                                      <div className="text-xs font-medium text-content-2">
                                        {easyMode ? row.title : row.permission}
                                      </div>
                                      <div className="text-[11px] text-content-3">
                                        {easyMode ? row.permission : row.title}
                                      </div>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1">
                                    {!row.assignable ? (
                                      <Badge
                                        variant="outline"
                                        className="text-[10px]"
                                      >
                                        Locked
                                      </Badge>
                                    ) : null}
                                  </div>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      ),
                    )}
                    {!filteredPermissionRows.length ? (
                      <div className="rounded-md border border-dashed p-8 text-center text-sm text-content-3">
                        No permissions match current filters.
                      </div>
                    ) : null}
                  </ScrollArea>
                </>
              )}

              {editingLocked ? (
                <div className="mt-1 flex items-center gap-2 rounded-md border border-warning-border bg-warning-bg p-3 text-xs text-warning-fg">
                  <AlertTriangle className="h-4 w-4" />
                  System role editing is locked. Enable unlock to modify this
                  role.
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      )}

      <AlertDialog open={confirmResetOpen} onOpenChange={setConfirmResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset role to baseline?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove all custom additions for{" "}
              <strong>{selectedRole}</strong> and restore default baseline
              permissions.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                resetRoleToBaseline();
                setConfirmResetOpen(false);
              }}
            >
              Reset
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={confirmRemoveVisibleOpen}
        onOpenChange={setConfirmRemoveVisibleOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove visible extras?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes {visibleExtraSelected.length} visible extra
              permission
              {visibleExtraSelected.length === 1 ? "" : "s"} while keeping
              baseline intact.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                removeVisibleExtras();
                setConfirmRemoveVisibleOpen(false);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

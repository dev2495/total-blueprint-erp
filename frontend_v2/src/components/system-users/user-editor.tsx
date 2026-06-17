"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  Crown,
  Info,
  Key,
  Loader2,
  Save,
  Shield,
  ShieldCheck,
  Sparkles,
  UserCog,
} from "lucide-react";

import { GradientHero } from "@/components/erp/gradient-hero";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PasswordInput } from "@/components/ui/password-input";
import { useToast } from "@/hooks/use-toast";
import {
  systemUserService,
  type User,
  type Role,
  type PermissionCatalogEntry,
} from "@/services/system-users";
import { cn } from "@/lib/utils";
import { getCanonicalRoleLabel } from "@/lib/roles";
import { MODULE_ORDER, paletteFor } from "./role-colors";

type Mode = "new" | "edit";

interface Props {
  mode: Mode;
  userId?: string;
  canManage: boolean;
  canEditOwnerToggle: boolean;
}

interface FormState {
  username: string;
  first_name: string;
  last_name: string;
  email: string;
  phone_number: string;
  is_active: boolean;
  is_owner: boolean;
  role_id: string;
  extra_permissions: string[];
  password: string;
}

const DEFAULT_FORM: FormState = {
  username: "",
  first_name: "",
  last_name: "",
  email: "",
  phone_number: "",
  is_active: true,
  is_owner: false,
  role_id: "",
  extra_permissions: [],
  password: "",
};

export function UserEditor({
  mode,
  userId,
  canManage,
  canEditOwnerToggle,
}: Props) {
  const router = useRouter();
  const qc = useQueryClient();
  const { toast } = useToast();

  const userQuery = useQuery({
    queryKey: ["user", userId],
    queryFn: () => systemUserService.getUser(userId!),
    enabled: mode === "edit" && !!userId,
  });

  const rolesQuery = useQuery({
    queryKey: ["roles"],
    queryFn: systemUserService.getRoles,
    staleTime: 60_000,
  });

  const catalogQuery = useQuery({
    queryKey: ["permission-catalog"],
    queryFn: systemUserService.getPermissionCatalog,
    staleTime: 5 * 60_000,
  });

  const [form, setForm] = React.useState<FormState>(DEFAULT_FORM);
  const [pendingDirty, setPendingDirty] = React.useState(0);
  const [pwDialogOpen, setPwDialogOpen] = React.useState(false);

  // hydrate
  React.useEffect(() => {
    if (mode === "edit" && userQuery.data) {
      const u = userQuery.data;
      setForm({
        username: u.username || "",
        first_name: u.first_name || "",
        last_name: u.last_name || "",
        email: u.email || "",
        phone_number: u.phone_number || "",
        is_active: !!u.is_active,
        is_owner: !!u.is_owner,
        role_id: u.role_info?.id || u.role_id || "",
        extra_permissions: Array.isArray(u.extra_permissions)
          ? [...u.extra_permissions]
          : [],
        password: "",
      });
      setPendingDirty(0);
    }
  }, [mode, userQuery.data]);

  const update = (patch: Partial<FormState>) => {
    setForm((prev) => ({ ...prev, ...patch }));
    setPendingDirty((n) => n + 1);
  };

  const roles = rolesQuery.data || [];
  const catalog = catalogQuery.data || [];
  const selectedRole = roles.find((r) => r.id === form.role_id) || null;

  // permissions granted by the picked role (base)
  const basePermissions = React.useMemo(() => {
    if (!selectedRole) return new Set<string>();
    return new Set<string>(selectedRole.default_permissions || []);
  }, [selectedRole]);

  const hasWildcard = basePermissions.has("*");

  const overrideSet = React.useMemo(
    () => new Set(form.extra_permissions),
    [form.extra_permissions],
  );

  const togglePermission = (permission: string) => {
    const isOn = overrideSet.has(permission);
    const next = isOn
      ? form.extra_permissions.filter((p) => p !== permission)
      : [...form.extra_permissions, permission];
    update({ extra_permissions: next });
  };

  const effectivePermissions = React.useMemo(() => {
    if (hasWildcard) return new Set<string>(["*"]);
    const out = new Set<string>(basePermissions);
    for (const p of form.extra_permissions) out.add(p);
    return out;
  }, [basePermissions, form.extra_permissions, hasWildcard]);

  const grouped = React.useMemo(() => {
    const byModule = new Map<string, PermissionCatalogEntry[]>();
    for (const entry of catalog) {
      if (!entry.assignable) continue;
      const mod = entry.module || "misc";
      const arr = byModule.get(mod) || [];
      arr.push(entry);
      byModule.set(mod, arr);
    }
    for (const arr of byModule.values()) {
      arr.sort((a, b) => a.permission.localeCompare(b.permission));
    }
    return byModule;
  }, [catalog]);

  // ── mutations
  const createMut = useMutation({
    mutationFn: () =>
      systemUserService.createUser({
        username: form.username,
        first_name: form.first_name,
        last_name: form.last_name,
        email: form.email,
        phone_number: form.phone_number,
        is_active: form.is_active,
        is_owner: canEditOwnerToggle ? form.is_owner : undefined,
        // backend accepts role_id (write-only)
        ...(form.role_id ? { role_id: form.role_id } : {}),
        extra_permissions: form.extra_permissions,
        ...(form.password ? { password: form.password } : {}),
      } as any),
    onSuccess: (saved) => {
      toast({ title: "User created", description: saved.username });
      qc.invalidateQueries({ queryKey: ["users"] });
      router.push(`/system/users/${saved.id}`);
    },
    onError: (err: any) => {
      const msg =
        err?.response?.data?.detail ||
        JSON.stringify(err?.response?.data || err?.message || "Create failed");
      toast({
        title: "Create failed",
        description: msg,
        variant: "destructive",
      });
    },
  });

  const updateMut = useMutation({
    mutationFn: () => {
      const payload: any = {
        username: form.username,
        first_name: form.first_name,
        last_name: form.last_name,
        email: form.email,
        phone_number: form.phone_number,
        is_active: form.is_active,
        extra_permissions: form.extra_permissions,
      };
      if (canEditOwnerToggle) payload.is_owner = form.is_owner;
      if (form.role_id) payload.role_id = form.role_id;
      return systemUserService.updateUser(userId!, payload);
    },
    onSuccess: (saved) => {
      toast({ title: "User saved", description: saved.username });
      qc.invalidateQueries({ queryKey: ["users"] });
      qc.invalidateQueries({ queryKey: ["user", userId] });
      setPendingDirty(0);
    },
    onError: (err: any) => {
      const msg =
        err?.response?.data?.detail ||
        JSON.stringify(err?.response?.data || err?.message || "Save failed");
      toast({ title: "Save failed", description: msg, variant: "destructive" });
    },
  });

  const passwordMut = useMutation({
    mutationFn: (newPassword: string) =>
      systemUserService.updateUser(userId!, { password: newPassword } as any),
    onSuccess: () => {
      toast({
        title: "Password reset",
        description: "User will need to re-login.",
      });
      setPwDialogOpen(false);
    },
    onError: (err: any) => {
      const msg =
        err?.response?.data?.detail ||
        JSON.stringify(
          err?.response?.data || err?.message || "Password reset failed",
        );
      toast({
        title: "Reset failed",
        description: msg,
        variant: "destructive",
      });
    },
  });

  const onSubmit = () => {
    if (mode === "new") createMut.mutate();
    else updateMut.mutate();
  };

  const isPending = createMut.isPending || updateMut.isPending;
  const palette = paletteFor(selectedRole?.code);

  return (
    <div className="min-h-screen bg-gradient-to-b from-order-bg via-white to-order-bg px-4 py-4 sm:px-6">
      <GradientHero
        palette="indigo"
        eyebrow={
          mode === "new" ? "SYSTEM · USERS · NEW" : "SYSTEM · USERS · EDIT"
        }
        title={
          mode === "new"
            ? "Add a user"
            : userQuery.data?.full_name ||
              userQuery.data?.username ||
              "Edit user"
        }
        subtitle="Roles set the baseline. Overrides grant one-off access. Effective view shows what they can actually do."
        actions={
          <Link href="/system/users">
            <Button
              variant="secondary"
              className="bg-surface-1/95 text-order-fg hover:bg-surface-1"
            >
              <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to users
            </Button>
          </Link>
        }
      />

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {/* LEFT COLUMN */}
        <div className="space-y-6 lg:col-span-2">
          {/* Identity */}
          <section className="rounded-3xl bg-surface-1 p-6 shadow-[0_20px_60px_-30px_rgba(15,23,42,0.25)] ring-1 ring-line">
            <header className="mb-4 flex items-center gap-2">
              <div className="grid h-9 w-9 place-items-center rounded-2xl bg-order-bg text-order-fg">
                <UserCog className="h-4 w-4" />
              </div>
              <div>
                <h3 className="font-display text-sm font-bold text-content-1">
                  Identity
                </h3>
                <p className="text-[11px] text-content-3">
                  Login credentials & contact
                </p>
              </div>
            </header>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Username *">
                <Input
                  value={form.username}
                  onChange={(e) => update({ username: e.target.value })}
                  placeholder="e.g. priya.s"
                  disabled={!canManage}
                />
              </Field>
              <Field label="Email *">
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => update({ email: e.target.value })}
                  placeholder="user@company.com"
                  disabled={!canManage}
                />
              </Field>
              <Field label="First name">
                <Input
                  value={form.first_name}
                  onChange={(e) => update({ first_name: e.target.value })}
                  disabled={!canManage}
                />
              </Field>
              <Field label="Last name">
                <Input
                  value={form.last_name}
                  onChange={(e) => update({ last_name: e.target.value })}
                  disabled={!canManage}
                />
              </Field>
              <Field label="Phone">
                <Input
                  value={form.phone_number}
                  onChange={(e) => update({ phone_number: e.target.value })}
                  disabled={!canManage}
                />
              </Field>
              {mode === "new" ? (
                <Field label="Initial password">
                  <PasswordInput
                    value={form.password}
                    onChange={(e) => update({ password: e.target.value })}
                    placeholder="At least 8 characters"
                    disabled={!canManage}
                  />
                </Field>
              ) : (
                <div className="flex flex-col justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setPwDialogOpen(true)}
                    disabled={!canManage}
                    className="border-order-border text-order-fg hover:bg-order-bg"
                  >
                    <Key className="mr-1.5 h-4 w-4" /> Reset password
                  </Button>
                </div>
              )}
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <label className="flex items-center justify-between rounded-2xl border border-line px-4 py-3">
                <div>
                  <div className="text-sm font-bold text-content-2">Active</div>
                  <div className="text-[11px] text-content-3">
                    Disabling blocks all sign-ins
                  </div>
                </div>
                <Switch
                  checked={form.is_active}
                  onCheckedChange={(v) => update({ is_active: v })}
                  disabled={!canManage}
                />
              </label>
              <label
                className={cn(
                  "flex items-center justify-between rounded-2xl border px-4 py-3",
                  canEditOwnerToggle
                    ? "border-danger-border bg-danger-bg"
                    : "border-line opacity-60",
                )}
              >
                <div>
                  <div className="flex items-center gap-1.5 text-sm font-bold text-content-2">
                    <Crown className="h-3.5 w-3.5 text-danger-fg" /> Owner flag
                  </div>
                  <div className="text-[11px] text-content-3">
                    {canEditOwnerToggle
                      ? "Bypasses all permission checks"
                      : "Only an existing OWNER may change this"}
                  </div>
                </div>
                <Switch
                  checked={form.is_owner}
                  onCheckedChange={(v) => update({ is_owner: v })}
                  disabled={!canEditOwnerToggle}
                />
              </label>
            </div>
          </section>

          {/* Role */}
          <section
            className={cn(
              "rounded-3xl bg-surface-1 p-6 shadow-[0_20px_60px_-30px_rgba(15,23,42,0.25)] ring-1 ring-line overflow-hidden",
            )}
          >
            <div
              className={cn("-m-6 mb-4 h-1.5 bg-gradient-to-r", palette.stripe)}
            />
            <header className="mb-4 mt-2 flex items-center gap-2">
              <div
                className={cn(
                  "grid h-9 w-9 place-items-center rounded-2xl",
                  palette.bg,
                  palette.text,
                )}
              >
                <Shield className="h-4 w-4" />
              </div>
              <div>
                <h3 className="font-display text-sm font-bold text-content-1">
                  Base role
                </h3>
                <p className="text-[11px] text-content-3">
                  Sets the baseline permission tier. Pick one card.
                </p>
              </div>
            </header>

            {rolesQuery.isLoading ? (
              <div className="flex items-center justify-center p-8 text-xs text-content-3">
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Loading
                roles…
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {roles.map((r) => (
                  <RoleCard
                    key={r.id}
                    role={r}
                    selected={form.role_id === r.id}
                    onSelect={() => update({ role_id: r.id })}
                    disabled={!canManage}
                  />
                ))}
              </div>
            )}

            {selectedRole ? (
              <details className="mt-4 rounded-2xl border border-line bg-surface-2 p-4">
                <summary className="cursor-pointer text-xs font-bold text-content-2">
                  Base permissions inherited from{" "}
                  {getCanonicalRoleLabel(selectedRole.code, selectedRole.name)}{" "}
                  <span className="font-mono text-content-3">
                    (
                    {hasWildcard
                      ? "ALL (*)"
                      : `${selectedRole.default_permissions?.length || 0}`}
                    )
                  </span>
                </summary>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {hasWildcard ? (
                    <Badge className="bg-danger-bg text-danger-fg ring-1 ring-danger-border">
                      Full access (*)
                    </Badge>
                  ) : (
                    (selectedRole.default_permissions || []).map((p) => (
                      <code
                        key={p}
                        className="rounded-md bg-surface-1 px-1.5 py-0.5 font-mono text-[10px] text-content-2 ring-1 ring-line"
                      >
                        {p}
                      </code>
                    ))
                  )}
                </div>
              </details>
            ) : null}
          </section>

          {/* Overrides */}
          <section className="rounded-3xl bg-surface-1 p-6 shadow-[0_20px_60px_-30px_rgba(15,23,42,0.25)] ring-1 ring-line">
            <div className="-m-6 mb-4 h-1.5 bg-gradient-to-r from-warning-fg to-warning-fg" />
            <header className="mb-4 mt-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="grid h-9 w-9 place-items-center rounded-2xl bg-warning-bg text-warning-fg">
                  <Sparkles className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="font-display text-sm font-bold text-content-1">
                    Permission overrides
                  </h3>
                  <p className="text-[11px] text-content-3">
                    Add one-off access only. Inherited role permissions are
                    locked and labeled below.
                  </p>
                </div>
              </div>
              <Badge className="bg-warning-bg text-warning-fg ring-1 ring-warning-border">
                {form.extra_permissions.length} override
                {form.extra_permissions.length === 1 ? "" : "s"} added
              </Badge>
            </header>

            {hasWildcard ? (
              <div className="rounded-2xl border border-dashed border-danger-border bg-danger-bg p-4 text-xs text-danger-fg">
                <Info className="mr-1.5 inline h-3.5 w-3.5" />
                This role already grants <b>full access (*)</b>. Overrides are
                unnecessary.
              </div>
            ) : (
              <div className="space-y-3">
                {MODULE_ORDER.filter((m) => grouped.has(m.key)).map((mod) => {
                  const entries = grouped.get(mod.key) || [];
                  return (
                    <div
                      key={mod.key}
                      className="rounded-2xl border border-line bg-surface-2 p-4"
                    >
                      <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-content-2">
                        {mod.label}
                      </div>
                      <p className="mb-3 text-[10px] font-medium text-content-3">
                        Green chips are active overrides. Muted chips already
                        come from the selected role.
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {entries.map((e) => {
                          const fromRole = basePermissions.has(e.permission);
                          const isOverride = overrideSet.has(e.permission);
                          if (fromRole) {
                            return (
                              <span
                                key={e.permission}
                                title={`Granted by ${selectedRole?.code || "role"}`}
                                className="cursor-default rounded-md bg-surface-2 px-2 py-1 font-mono text-[10px] text-content-3 ring-1 ring-line"
                              >
                                {e.permission} · role baseline
                              </span>
                            );
                          }
                          return (
                            <button
                              key={e.permission}
                              type="button"
                              onClick={() =>
                                canManage && togglePermission(e.permission)
                              }
                              disabled={!canManage}
                              className={cn(
                                "rounded-md px-2 py-1 font-mono text-[10px] ring-1 transition",
                                isOverride
                                  ? "bg-success-bg text-success-fg ring-success-border hover:bg-success-bg"
                                  : "bg-surface-1 text-content-2 ring-line hover:bg-surface-2",
                                !canManage && "cursor-not-allowed opacity-60",
                              )}
                            >
                              {isOverride ? (
                                <Check className="-ml-0.5 mr-1 inline h-3 w-3" />
                              ) : null}
                              {e.permission}
                              <span className="ml-1 opacity-70">
                                {isOverride ? "· override" : "· add"}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        {/* RIGHT COLUMN (sticky) */}
        <div className="space-y-6">
          <div className="lg:sticky lg:top-4 space-y-6">
            {/* Effective permissions */}
            <section className="rounded-3xl bg-gradient-to-br from-surface-2 to-order-bg p-6 shadow-[0_20px_60px_-30px_rgba(15,23,42,0.25)] ring-1 ring-line">
              <header className="mb-3 flex items-center gap-2">
                <div className="grid h-9 w-9 place-items-center rounded-2xl bg-order-bg text-order-fg">
                  <ShieldCheck className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="font-display text-sm font-bold text-content-1">
                    Effective permissions
                  </h3>
                  <p className="text-[11px] text-content-3">
                    What the user can actually do after role baseline and
                    overrides are combined.
                  </p>
                </div>
              </header>
              <div className="mb-3 flex items-center justify-between">
                <Badge className="bg-order-bg text-order-fg ring-1 ring-order-border">
                  {hasWildcard ? "ALL" : effectivePermissions.size} permission
                  {effectivePermissions.size === 1 ? "" : "s"}
                </Badge>
                <span className="font-mono text-[10px] text-content-3">
                  {hasWildcard ? "wildcard" : "computed"}
                </span>
              </div>

              {hasWildcard ? (
                <p className="text-xs text-content-2">
                  This user holds <b>full access (*)</b> through their role.
                </p>
              ) : (
                <Tabs defaultValue={MODULE_ORDER[0].key}>
                  <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 bg-transparent p-0">
                    {MODULE_ORDER.filter((m) =>
                      Array.from(effectivePermissions).some((p) =>
                        p.startsWith(`${m.key}.`),
                      ),
                    ).map((m) => (
                      <TabsTrigger
                        key={m.key}
                        value={m.key}
                        className="rounded-full bg-surface-1 px-3 py-1 text-[10px] font-bold ring-1 ring-line data-[state=active]:bg-order-fg data-[state=active]:text-white"
                      >
                        {m.label}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  {MODULE_ORDER.map((m) => {
                    const inMod = Array.from(effectivePermissions).filter((p) =>
                      p.startsWith(`${m.key}.`),
                    );
                    if (inMod.length === 0) return null;
                    return (
                      <TabsContent
                        key={m.key}
                        value={m.key}
                        className="mt-3 space-y-1.5"
                      >
                        {inMod.sort().map((p) => {
                          const fromRole = basePermissions.has(p);
                          return (
                            <div
                              key={p}
                              className="flex items-center justify-between rounded-md bg-surface-1 px-2 py-1 ring-1 ring-line"
                            >
                              <code className="font-mono text-[10px] text-content-2">
                                {p}
                              </code>
                              <span
                                className={cn(
                                  "rounded px-1.5 py-0.5 text-[9px] font-bold",
                                  fromRole
                                    ? "bg-surface-2 text-content-3"
                                    : "bg-success-bg text-success-fg",
                                )}
                              >
                                {fromRole ? "ROLE BASELINE" : "OVERRIDE"}
                              </span>
                            </div>
                          );
                        })}
                      </TabsContent>
                    );
                  })}
                </Tabs>
              )}
            </section>

            {/* Save bar */}
            <section className="rounded-3xl bg-surface-1 p-5 shadow-[0_20px_60px_-30px_rgba(15,23,42,0.25)] ring-1 ring-line">
              <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-wider text-content-3">
                <span>
                  {pendingDirty > 0
                    ? `${pendingDirty} pending changes`
                    : "All changes saved"}
                </span>
                {pendingDirty > 0 ? (
                  <span className="font-bold text-warning-fg">●</span>
                ) : (
                  <span className="font-bold text-success-fg">●</span>
                )}
              </div>
              <Button
                onClick={onSubmit}
                disabled={!canManage || isPending}
                className="w-full bg-order-fg text-white hover:bg-order-fg"
              >
                {isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                {mode === "new" ? "Create user" : "Save changes"}
              </Button>
              <Link href="/system/users" className="mt-2 block">
                <Button variant="ghost" className="w-full text-content-3">
                  Cancel
                </Button>
              </Link>
              <div className="mt-3 text-[10px] text-content-4">
                <Link
                  href="/help?topic=roles"
                  className="font-bold text-order-fg hover:underline"
                >
                  Role reference →
                </Link>
              </div>
            </section>
          </div>
        </div>
      </div>

      {/* Password dialog */}
      <Dialog open={pwDialogOpen} onOpenChange={setPwDialogOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Reset password</DialogTitle>
            <DialogDescription>
              User will need to log in again with the new password.
            </DialogDescription>
          </DialogHeader>
          <PasswordResetBody
            loading={passwordMut.isPending}
            onSubmit={(pw) => passwordMut.mutate(pw)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Sub-components

function RoleCard({
  role,
  selected,
  onSelect,
  disabled,
}: {
  role: Role;
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
}) {
  const palette = paletteFor(role.code);
  const count = role.default_permissions?.length || 0;
  const wildcard = role.default_permissions?.includes("*");
  const label = getCanonicalRoleLabel(role.code, role.name);

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={cn(
        "group relative overflow-hidden rounded-2xl border bg-surface-1 p-4 text-left transition",
        selected
          ? cn(
              "border-transparent ring-2",
              palette.ring,
              "shadow-[0_10px_30px_-15px_rgba(15,23,42,0.25)]",
            )
          : "border-line hover:border-line-strong",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <div
        className={cn(
          "absolute inset-x-0 top-0 h-1 bg-gradient-to-r",
          palette.stripe,
        )}
      />
      <div className="flex items-start justify-between">
        <div>
          <div className="font-display text-sm font-bold text-content-1">
            {label}
          </div>
          <div className="font-mono text-[10px] text-content-3">
            {role.code}
          </div>
        </div>
        {selected ? (
          <div
            className={cn(
              "grid h-6 w-6 place-items-center rounded-full ring-2",
              palette.ring,
              palette.bg,
              palette.text,
            )}
          >
            <Check className="h-3 w-3" />
          </div>
        ) : (
          <div className="h-6 w-6 rounded-full border-2 border-line" />
        )}
      </div>
      <p className="mt-2 line-clamp-2 text-[11px] text-content-3">
        {role.description || "—"}
      </p>
      <div className="mt-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider">
        <Badge className={cn(palette.bg, palette.text, "ring-1", palette.ring)}>
          {wildcard ? "Full access" : `${count} perms`}
        </Badge>
      </div>
    </button>
  );
}

function PasswordResetBody({
  onSubmit,
  loading,
}: {
  onSubmit: (pw: string) => void;
  loading: boolean;
}) {
  const [pw, setPw] = React.useState("");
  return (
    <>
      <div className="mt-2">
        <Label className="text-[11px] font-bold uppercase tracking-wider text-content-3">
          New password
        </Label>
        <PasswordInput
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="At least 8 characters"
          className="mt-1.5"
        />
      </div>
      <DialogFooter>
        <Button
          type="button"
          onClick={() => pw.length >= 8 && onSubmit(pw)}
          disabled={loading || pw.length < 8}
          className="bg-order-fg text-white hover:bg-order-fg"
        >
          {loading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Key className="mr-2 h-4 w-4" />
          )}
          Reset password
        </Button>
      </DialogFooter>
    </>
  );
}

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label className="text-[11px] font-bold uppercase tracking-wider text-content-3">
        {label}
      </Label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

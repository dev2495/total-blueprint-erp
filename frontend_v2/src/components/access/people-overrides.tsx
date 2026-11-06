"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  Cog,
  ExternalLink,
  Factory,
  Lock,
  Plus,
  Search,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { getCanonicalRoleCode, getCanonicalRoleLabel } from "@/lib/roles";
import { factoryService, type Machine, type WorkCenter } from "@/services/factory";
import { systemUserService, type User } from "@/services/system-users";
import { paletteFor } from "@/components/system-users/role-colors";
import {
  dataRightForPage,
  errorDetail,
  groupByModule,
  matchesSearch,
  normalizePermissionList,
  permissionTitle,
  sameList,
  type PermissionRow,
} from "./access-model";

const WCM_ROLE_CODE = "WORK_CENTER_MANAGER";
const OPERATOR_ROLE_CODE = "OPERATOR";
const WATCHMAN_ROLE_CODE = "WATCHMAN";

type Props = {
  rows: PermissionRow[];
  /** What each role holds now (saved role matrix), keyed by canonical role code. */
  roleRights: Record<string, string[]>;
  canManage: boolean;
};

function initials(user: User) {
  const first = (user.first_name || "").trim().charAt(0);
  const last = (user.last_name || "").trim().charAt(0);
  return (first || last ? `${first}${last}` : (user.username || "?").slice(0, 2)).toUpperCase();
}

/** People list + one person's added rights and floor scope; saves through the same user APIs as the user editor. */
export function PeopleOverrides({ rows, roleRights, canManage }: Props) {
  const usersQuery = useQuery({ queryKey: ["users"], queryFn: systemUserService.getUsers });
  const [search, setSearch] = React.useState("");
  const [roleFilter, setRoleFilter] = React.useState("ALL");
  const [showInactive, setShowInactive] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState<string>("");

  const users = React.useMemo(() => usersQuery.data || [], [usersQuery.data]);
  const roleOptions = React.useMemo(() => {
    const codes = new Set(users.map((user) => getCanonicalRoleCode(user.role_info?.code)).filter(Boolean));
    return Array.from(codes).sort((a, b) => getCanonicalRoleLabel(a).localeCompare(getCanonicalRoleLabel(b)));
  }, [users]);

  const visibleUsers = React.useMemo(() => {
    const needle = search.trim().toLowerCase();
    return users
      .filter((user) => showInactive || user.is_active)
      .filter((user) => roleFilter === "ALL" || getCanonicalRoleCode(user.role_info?.code) === roleFilter)
      .filter((user) =>
        !needle ||
        [user.username, user.full_name, user.email, user.role_info?.name, user.role_info?.code]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(needle),
      )
      .sort((a, b) => (a.full_name || a.username).localeCompare(b.full_name || b.username));
  }, [roleFilter, search, showInactive, users]);

  return (
    <div className="grid min-h-[560px] gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="flex max-h-[calc(100dvh-260px)] min-h-[420px] flex-col overflow-hidden rounded-2xl border border-line bg-surface-1">
        <div className="space-y-2 border-b border-line p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-content-4" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Find a person"
              className="h-9 pl-9"
              aria-label="Search people"
            />
          </div>
          <div className="flex items-center gap-2">
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger className="h-9 flex-1 text-xs" aria-label="Filter by role">
                <SelectValue placeholder="All roles" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All roles</SelectItem>
                {roleOptions.map((code) => (
                  <SelectItem key={code} value={code}>
                    {getCanonicalRoleLabel(code)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <label className="flex h-9 items-center gap-1.5 rounded-lg border border-line px-2 text-caption font-semibold text-content-3">
              <Switch checked={showInactive} onCheckedChange={setShowInactive} aria-label="Show inactive people" />
              Inactive
            </label>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {usersQuery.isLoading ? (
            <div className="p-6 text-center text-sm text-content-3">Loading people…</div>
          ) : visibleUsers.length === 0 ? (
            <div className="p-6 text-center text-sm text-content-3">No one matches.</div>
          ) : (
            visibleUsers.map((user) => {
              const palette = paletteFor(getCanonicalRoleCode(user.role_info?.code));
              const added = (user.extra_permissions || []).length;
              const active = user.id === selectedId;
              return (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => setSelectedId(user.id)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition",
                    active ? "bg-info-bg ring-1 ring-info-border" : "hover:bg-surface-2",
                    !user.is_active && "opacity-60",
                  )}
                  aria-current={active}
                >
                  <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl text-xs font-bold ring-1", palette.bg, palette.text, palette.ring)}>
                    {initials(user)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-content-1">{user.full_name || user.username}</span>
                    <span className="block truncate text-caption text-content-3">
                      {getCanonicalRoleLabel(user.role_info?.code, user.role_info?.name) || "No role"}
                    </span>
                  </span>
                  {added > 0 ? (
                    <span className="shrink-0 rounded-full bg-info-bg px-2 py-0.5 font-mono text-caption font-bold text-primary ring-1 ring-info-border">
                      +{added}
                    </span>
                  ) : null}
                </button>
              );
            })
          )}
        </div>
        <div className="border-t border-line px-3 py-2 text-caption text-content-3">
          {visibleUsers.length} of {users.length} people
        </div>
      </aside>

      {selectedId ? (
        <PersonAccess key={selectedId} userId={selectedId} rows={rows} roleRights={roleRights} canManage={canManage} />
      ) : (
        <div className="grid place-items-center rounded-2xl border border-dashed border-line-strong bg-surface-1 p-10 text-center">
          <div>
            <UserRound className="mx-auto h-9 w-9 text-content-4" />
            <div className="mt-2 text-sm font-semibold text-content-1">Pick a person</div>
            <p className="mt-1 max-w-sm text-xs text-content-3">
              See what their role gives them, add rights for just this person, and set the work centres or machines
              they run.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function PersonAccess({ userId, rows, roleRights, canManage }: { userId: string } & Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const userQuery = useQuery({ queryKey: ["user", userId], queryFn: () => systemUserService.getUser(userId) });
  const workCentersQuery = useQuery({
    queryKey: ["factory-work-centers", "user-editor"],
    queryFn: factoryService.getWorkCenters,
    staleTime: 5 * 60_000,
  });
  const machinesQuery = useQuery({
    queryKey: ["factory-machines", "user-editor"],
    queryFn: factoryService.getMachines,
    staleTime: 5 * 60_000,
  });

  const user = userQuery.data;
  const roleCode = getCanonicalRoleCode(user?.role_info?.code);
  const isOperator = roleCode === OPERATOR_ROLE_CODE;
  const isWcm = roleCode === WCM_ROLE_CODE;
  const isWatchman = roleCode === WATCHMAN_ROLE_CODE;

  const savedExtras = React.useMemo(() => normalizePermissionList(user?.extra_permissions), [user]);
  // Same reading as the user editor: an operator's scope is machines, everyone else's is work centres.
  const savedScope = React.useMemo(() => {
    const context = user?.entitlements?.context;
    return normalizePermissionList(isOperator ? context?.machines?.map(String) : context?.work_centers?.map(String));
  }, [isOperator, user]);

  const [extras, setExtras] = React.useState<string[]>([]);
  const [scope, setScope] = React.useState<string[]>([]);
  React.useEffect(() => {
    setExtras(savedExtras);
    setScope(savedScope);
  }, [savedExtras, savedScope]);

  const roleSet = React.useMemo(() => new Set(roleRights[roleCode] || []), [roleCode, roleRights]);
  const fullAccess = roleSet.has("*") || Boolean(user?.is_owner);
  const extraSet = React.useMemo(() => new Set(extras), [extras]);
  const known = React.useMemo(() => new Set(rows.map((row) => row.permission)), [rows]);

  const extrasDirty = !sameList(extras, savedExtras);
  const scopeDirty = !sameList(scope, savedScope);
  const dirty = extrasDirty || scopeDirty;

  const [search, setSearch] = React.useState("");
  const [addedOnly, setAddedOnly] = React.useState(false);
  const groups = React.useMemo(() => {
    const query = search.trim().toLowerCase();
    return groupByModule(
      rows.filter(
        (row) =>
          row.permission !== "*" &&
          row.assignable &&
          matchesSearch(row, query) &&
          (!addedOnly || extraSet.has(row.permission)),
      ),
    );
  }, [addedOnly, extraSet, rows, search]);

  const missingDataRights = React.useMemo(
    () =>
      extras
        .map((permission) => ({ permission, data: dataRightForPage(permission, known) }))
        .filter((item): item is { permission: string; data: string } =>
          Boolean(item.data) && !roleSet.has(item.data as string) && !extraSet.has(item.data as string),
        ),
    [extraSet, extras, known, roleSet],
  );

  const toggleExtra = (permission: string) =>
    setExtras((previous) =>
      normalizePermissionList(previous.includes(permission) ? previous.filter((value) => value !== permission) : [...previous, permission]),
    );

  const save = useMutation({
    mutationFn: async () => {
      if (isOperator && scope.length === 0) throw new Error("A Machine Operator must be given at least one machine to run.");
      if (isWcm && scope.length === 0) throw new Error("Work Center Manager users must be assigned to at least one work center.");
      if (extrasDirty) {
        await systemUserService.updateUser(userId, { extra_permissions: isWatchman ? [] : extras });
      }
      if (scopeDirty) {
        if (isOperator) await systemUserService.assignMachines(userId, scope);
        else await systemUserService.assignWorkCenters(userId, scope);
      }
    },
    onSuccess: async () => {
      toast({ title: "Access saved", description: `${user?.full_name || user?.username} is updated.` });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["users"] }),
        qc.invalidateQueries({ queryKey: ["user", userId] }),
      ]);
    },
    onError: (error) => toast({ title: "Not saved", description: errorDetail(error), variant: "destructive" }),
  });

  if (userQuery.isLoading || !user) {
    return <div className="grid place-items-center rounded-2xl border border-line bg-surface-1 p-10 text-sm text-content-3">Loading…</div>;
  }

  const palette = paletteFor(roleCode);
  const fromRoleCount = rows.filter((row) => row.assignable && roleSet.has(row.permission)).length;
  const editable = canManage && !isWatchman && !fullAccess;

  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-surface-1">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <span className={cn("grid h-11 w-11 place-items-center rounded-2xl text-sm font-bold ring-1", palette.bg, palette.text, palette.ring)}>
          {initials(user)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-base font-bold text-content-1">{user.full_name || user.username}</h2>
            <span className={cn("rounded-full px-2 py-0.5 text-caption font-bold ring-1", palette.bg, palette.text, palette.ring)}>
              {getCanonicalRoleLabel(user.role_info?.code, user.role_info?.name) || "No role"}
            </span>
            {!user.is_active ? <span className="rounded-full bg-surface-2 px-2 py-0.5 text-caption font-bold text-content-3 ring-1 ring-line">Inactive</span> : null}
          </div>
          <div className="truncate font-mono text-caption text-content-3">@{user.username}</div>
        </div>
        <div className="flex items-center gap-3 text-xs text-content-3">
          <Stat label="From role" value={fullAccess ? "All" : fromRoleCount} />
          <Stat label="Added" value={extras.length} accent />
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href={`/system/users/${user.id}`}>
            Full profile <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
          </Link>
        </Button>
      </header>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4" style={{ maxHeight: "calc(100dvh - 330px)" }}>
        {isWatchman ? (
          <Notice icon={Lock}>
            Watchman access is fixed to the gate terminal and cannot take added rights. Gates are set on the full profile.
          </Notice>
        ) : null}
        {fullAccess && !isWatchman ? (
          <Notice icon={ShieldCheck}>This person already has full access through their role or owner flag.</Notice>
        ) : null}
        {!isWatchman ? (
          <FloorScope
            isOperator={isOperator}
            required={isOperator || isWcm}
            value={scope}
            onChange={setScope}
            disabled={!canManage}
            workCenters={workCentersQuery.data || []}
            machines={machinesQuery.data || []}
          />
        ) : null}

        {!isWatchman && !fullAccess ? (
          <div className="rounded-2xl border border-line">
            <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <div className="mr-auto">
                <div className="text-sm font-bold text-content-1">Rights</div>
                <div className="text-caption text-content-3">Ticked by the role, or added just for this person.</div>
              </div>
              <div className="relative w-full sm:w-56">
                <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-content-4" />
                <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a right" className="h-8 pl-8 text-xs" aria-label="Search rights" />
              </div>
              <label className="flex h-8 items-center gap-1.5 rounded-lg border border-line px-2 text-caption font-semibold text-content-3">
                <Switch checked={addedOnly} onCheckedChange={setAddedOnly} aria-label="Show added rights only" />
                Added only
              </label>
            </div>

            {missingDataRights.length ? (
              <div className="space-y-1.5 border-b border-line bg-warning-bg px-3 py-2.5">
                {missingDataRights.map((item) => (
                  <div key={item.permission} className="flex flex-wrap items-center gap-2 text-xs text-warning-fg">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                    <span className="min-w-0 flex-1">
                      <b>{rows.find((row) => row.permission === item.permission)?.title || permissionTitle(item.permission)}</b> shows the screen, but its data needs{" "}
                      <b>{rows.find((row) => row.permission === item.data)?.title || item.data}</b>.
                    </span>
                    {editable ? (
                      <Button size="sm" variant="outline" className="h-7 border-warning-border bg-surface-1 text-xs" onClick={() => toggleExtra(item.data)}>
                        <Plus className="mr-1 h-3.5 w-3.5" /> Add it
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}

            <div className="divide-y divide-line">
              {groups.map((group) => {
                const added = group.rows.filter((row) => extraSet.has(row.permission)).length;
                return (
                  <details key={group.key} open={Boolean(search) || addedOnly || added > 0} className="group">
                    <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 hover:bg-surface-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-content-2">{group.label}</span>
                      <span className="font-mono text-caption text-content-4">
                        {group.rows.filter((row) => roleSet.has(row.permission) || extraSet.has(row.permission)).length}/{group.rows.length}
                      </span>
                      {added ? <span className="rounded-full bg-info-bg px-1.5 font-mono text-caption font-bold text-primary">+{added}</span> : null}
                    </summary>
                    <div className="grid gap-1.5 px-3 pb-3 sm:grid-cols-2">
                      {group.rows.map((row) => {
                        const fromRole = roleSet.has(row.permission);
                        const isAdded = extraSet.has(row.permission);
                        return (
                          <button
                            key={row.permission}
                            type="button"
                            disabled={!editable || (fromRole && !isAdded)}
                            onClick={() => toggleExtra(row.permission)}
                            className={cn(
                              "flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-left ring-1 transition disabled:cursor-default",
                              isAdded
                                ? "bg-info-bg ring-info-border"
                                : fromRole
                                  ? "bg-surface-2 ring-line"
                                  : "bg-surface-1 ring-line hover:ring-line-strong",
                            )}
                            aria-pressed={isAdded}
                          >
                            <span
                              className={cn(
                                "grid h-6 w-6 shrink-0 place-items-center rounded-md ring-1",
                                isAdded
                                  ? "bg-primary text-surface-1 ring-primary"
                                  : fromRole
                                    ? "bg-success-bg text-success-fg ring-success-border"
                                    : "bg-surface-1 text-content-4 ring-line",
                              )}
                            >
                              {isAdded ? <Plus className="h-3.5 w-3.5" strokeWidth={2.5} /> : fromRole ? <Check className="h-3.5 w-3.5" /> : null}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-xs font-semibold text-content-1">{row.title}</span>
                              <span className="block truncate text-caption text-content-3">
                                {isAdded && fromRole ? "Added, and the role gives it too" : fromRole ? "From the role" : isAdded ? "Added for this person" : row.route || row.permission}
                              </span>
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </details>
                );
              })}
              {!groups.length ? <div className="px-3 py-8 text-center text-sm text-content-3">No rights match.</div> : null}
            </div>
          </div>
        ) : null}
      </div>

      {canManage && !isWatchman ? (
        <footer
          className={cn(
            "flex flex-wrap items-center gap-2 border-t border-line px-4 py-3 transition",
            dirty ? "bg-warning-bg" : "bg-surface-2",
          )}
        >
          <span className={cn("mr-auto text-xs font-semibold", dirty ? "text-warning-fg" : "text-content-3")}>
            {dirty
              ? [extrasDirty ? "rights changed" : "", scopeDirty ? (isOperator ? "machines changed" : "work centres changed") : ""].filter(Boolean).join(" · ")
              : "All saved"}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={!dirty || save.isPending}
            onClick={() => {
              setExtras(savedExtras);
              setScope(savedScope);
            }}
          >
            Discard
          </Button>
          <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : "Save access"}
          </Button>
        </footer>
      ) : null}
    </section>
  );
}

function FloorScope({
  isOperator,
  required,
  value,
  onChange,
  disabled,
  workCenters,
  machines,
}: {
  isOperator: boolean;
  required: boolean;
  value: string[];
  onChange: (next: string[]) => void;
  disabled: boolean;
  workCenters: WorkCenter[];
  machines: Machine[];
}) {
  const [search, setSearch] = React.useState("");
  const selected = new Set(value);
  const groups = React.useMemo(() => {
    const needle = search.trim().toLowerCase();
    const map = new Map<string, Array<{ id: string; name: string; code: string }>>();
    if (isOperator) {
      machines.forEach((machine) => {
        if (needle && ![machine.name, machine.code, machine.work_center_name].join(" ").toLowerCase().includes(needle)) return;
        const key = machine.work_center_name || "Other";
        map.set(key, [...(map.get(key) || []), { id: String(machine.id), name: machine.name, code: machine.code }]);
      });
    } else {
      workCenters.forEach((wc) => {
        if (needle && ![wc.name, wc.code, wc.plant_name, ...(wc.process_codes || [])].join(" ").toLowerCase().includes(needle)) return;
        const key = wc.plant_name || "Other";
        map.set(key, [...(map.get(key) || []), { id: String(wc.id), name: wc.name, code: wc.code }]);
      });
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, items]) => ({ label, items: items.sort((a, b) => a.name.localeCompare(b.name)) }));
  }, [isOperator, machines, search, workCenters]);

  const toggle = (id: string) =>
    onChange(normalizePermissionList(selected.has(id) ? value.filter((item) => item !== id) : [...value, id]));
  const Icon = isOperator ? Cog : Factory;
  const missing = required && value.length === 0;

  return (
    <div className={cn("rounded-2xl border", missing ? "border-danger-border" : "border-line")}>
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2.5">
        <Icon className="h-4 w-4 text-order-fg" />
        <div className="mr-auto">
          <div className="text-sm font-bold text-content-1">
            {isOperator ? "Machines they run" : "Work centres they run"}
            {required ? <span className="ml-1 text-danger-fg">*</span> : null}
          </div>
          <div className="text-caption text-content-3">
            {isOperator
              ? "An operator sees and logs only these machines; their work centres follow."
              : required
                ? "A work center manager acts only on these work centres."
                : "Optional: limits which floor screens they act on."}
          </div>
        </div>
        <span className="rounded-full bg-surface-2 px-2 py-0.5 font-mono text-caption font-bold text-content-2 ring-1 ring-line">
          {value.length} selected
        </span>
        {value.length && !disabled ? (
          <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => onChange([])}>
            <X className="mr-1 h-3.5 w-3.5" /> Clear
          </Button>
        ) : null}
      </div>
      <div className="space-y-3 p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-content-4" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={isOperator ? "Find a machine or work centre" : "Find a work centre, plant or process"}
            className="h-8 pl-8 text-xs"
            aria-label={isOperator ? "Search machines" : "Search work centres"}
          />
        </div>
        {missing ? <div className="text-xs font-semibold text-danger-fg">Pick at least one before saving.</div> : null}
        <div className="max-h-56 space-y-2.5 overflow-y-auto pr-1">
          {groups.map((group) => (
            <div key={group.label}>
              <div className="mb-1 text-caption font-semibold uppercase tracking-wider text-content-4">{group.label}</div>
              <div className="flex flex-wrap gap-1.5">
                {group.items.map((item) => {
                  const on = selected.has(item.id);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      disabled={disabled}
                      onClick={() => toggle(item.id)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 transition disabled:cursor-default",
                        on ? "bg-order-bg text-order-fg ring-order-border" : "bg-surface-1 text-content-2 ring-line hover:ring-line-strong",
                      )}
                      aria-pressed={on}
                      title={item.code}
                    >
                      {on ? <Check className="h-3.5 w-3.5" /> : null}
                      {item.name}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          {!groups.length ? <div className="py-4 text-center text-xs text-content-3">Nothing matches.</div> : null}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: number | string; accent?: boolean }) {
  return (
    <div className="text-right">
      <div className={cn("font-mono text-lg font-bold tabular-nums leading-none", accent ? "text-primary" : "text-content-1")}>{value}</div>
      <div className="text-caption">{label}</div>
    </div>
  );
}

function Notice({ icon: Icon, children }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-info-border bg-info-bg px-3 py-2.5 text-xs text-primary">
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div>{children}</div>
    </div>
  );
}

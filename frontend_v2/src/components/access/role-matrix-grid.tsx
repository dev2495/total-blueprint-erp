"use client";

import * as React from "react";
import { Check, ChevronDown, ChevronRight, Lock, Minus, MoreHorizontal, Plus, Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { paletteFor } from "@/components/system-users/role-colors";
import {
  SYSTEM_ROLES,
  dataRightForPage,
  groupByModule,
  matchesSearch,
  type PermissionRow,
} from "./access-model";

export type CellState = "base" | "added" | "removed" | "off";

export type RoleColumn = { code: string; label: string };

export type RolePreset = "read-only" | "floor-ops" | "reset" | "clear-added";

type Props = {
  rows: PermissionRow[];
  columns: RoleColumn[];
  draft: Record<string, string[]>;
  saved: Record<string, string[]>;
  baseline: Record<string, string[]>;
  unlockSystemRoles: boolean;
  onToggle: (roleCode: string, permissions: string[], on: boolean) => void;
  onPreset: (roleCode: string, preset: RolePreset, visible: string[]) => void;
};

const CELL_TEXT: Record<CellState, string> = {
  base: "Given by the role's standard set",
  added: "Added for this role",
  removed: "Standard right, removed for this role",
  off: "Not given",
};

export function cellState(on: boolean, baseline: boolean): CellState {
  if (on) return baseline ? "base" : "added";
  return baseline ? "removed" : "off";
}

/** Roles × rights grid: each cell is one click; module rows switch a whole module for a role. */
export function RoleMatrixGrid({ rows, columns, draft, saved, baseline, unlockSystemRoles, onToggle, onPreset }: Props) {
  const [search, setSearch] = React.useState("");
  const [moduleFilter, setModuleFilter] = React.useState<string>("ALL");
  const [changedOnly, setChangedOnly] = React.useState(false);
  const [showCodes, setShowCodes] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set());

  const sets = React.useMemo(() => {
    const toSet = (source: Record<string, string[]>) =>
      Object.fromEntries(columns.map((column) => [column.code, new Set(source[column.code] || [])]));
    return { draft: toSet(draft), saved: toSet(saved), baseline: toSet(baseline) };
  }, [baseline, columns, draft, saved]);

  const known = React.useMemo(() => new Set(rows.map((row) => row.permission)), [rows]);
  const allGroups = React.useMemo(() => groupByModule(rows.filter((row) => row.permission !== "*" || showCodes)), [rows, showCodes]);

  const groups = React.useMemo(() => {
    const query = search.trim().toLowerCase();
    return allGroups
      .filter((group) => moduleFilter === "ALL" || group.key === moduleFilter)
      .map((group) => ({
        ...group,
        rows: group.rows.filter((row) => {
          if (!matchesSearch(row, query)) return false;
          if (!changedOnly) return true;
          return columns.some((column) => sets.draft[column.code]?.has(row.permission) !== sets.saved[column.code]?.has(row.permission));
        }),
      }))
      .filter((group) => group.rows.length > 0);
  }, [allGroups, changedOnly, columns, moduleFilter, search, sets]);

  const visiblePermissions = React.useMemo(
    () => groups.flatMap((group) => group.rows.filter((row) => row.assignable).map((row) => row.permission)),
    [groups],
  );

  const locked = (roleCode: string) => SYSTEM_ROLES.has(roleCode) && !unlockSystemRoles;

  const toggleCollapsed = (key: string) =>
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <TooltipProvider delayDuration={250}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-content-4" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Find a right: artwork, packing, bills…"
              className="h-9 pl-9"
              aria-label="Search rights"
            />
          </div>
          <label className="flex h-9 items-center gap-2 rounded-lg border border-line bg-surface-1 px-3 text-xs font-semibold text-content-2">
            <Switch checked={changedOnly} onCheckedChange={setChangedOnly} aria-label="Show unsaved changes only" />
            Unsaved changes only
          </label>
          <label className="flex h-9 items-center gap-2 rounded-lg border border-line bg-surface-1 px-3 text-xs font-semibold text-content-2">
            <Switch checked={showCodes} onCheckedChange={setShowCodes} aria-label="Show permission codes" />
            Codes
          </label>
        </div>

        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Modules">
          {[{ key: "ALL", label: "All modules" }, ...allGroups.map((group) => ({ key: group.key, label: group.label }))].map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={moduleFilter === item.key}
              onClick={() => setModuleFilter(item.key)}
              className={cn(
                "shrink-0 rounded-full px-3 py-1 text-xs font-semibold ring-1 transition",
                moduleFilter === item.key
                  ? "bg-content-1 text-surface-1 ring-content-1"
                  : "bg-surface-1 text-content-3 ring-line hover:bg-surface-2 hover:text-content-1",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        <Legend />

        <div className="max-h-[calc(100dvh-330px)] min-h-[360px] overflow-auto rounded-2xl border border-line bg-surface-1">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-30 min-w-[260px] border-b border-r border-line bg-surface-2 px-4 py-2 text-left text-caption font-semibold uppercase tracking-wider text-content-3">
                  Right
                </th>
                {columns.map((column) => {
                  const palette = paletteFor(column.code);
                  const count = sets.draft[column.code]?.size || 0;
                  const dirty = !sameSet(sets.draft[column.code], sets.saved[column.code]);
                  const isLocked = locked(column.code);
                  return (
                    <th
                      key={column.code}
                      className="sticky top-0 z-20 min-w-[104px] border-b border-line bg-surface-2 px-1.5 py-2 align-bottom"
                    >
                      <div className="flex flex-col items-center gap-1">
                        <span className={cn("h-1 w-8 rounded-full", palette.stripe)} aria-hidden />
                        <span className="line-clamp-2 text-center text-xs font-bold leading-tight text-content-1">{column.label}</span>
                        <div className="flex items-center gap-1">
                          <span className="rounded-md bg-surface-1 px-1.5 py-0.5 font-mono text-caption font-semibold tabular-nums text-content-3 ring-1 ring-line">
                            {sets.draft[column.code]?.has("*") ? "All" : count}
                          </span>
                          {dirty ? <span className="h-2 w-2 rounded-full bg-warning-fg" title="Unsaved changes" /> : null}
                          {isLocked ? (
                            <Lock className="h-3.5 w-3.5 text-content-4" aria-label="Locked system role" />
                          ) : (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button
                                  type="button"
                                  className="grid h-6 w-6 place-items-center rounded-md text-content-3 hover:bg-surface-1 hover:text-content-1"
                                  aria-label={`Quick actions for ${column.label}`}
                                >
                                  <MoreHorizontal className="h-4 w-4" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="center" className="w-60">
                                <DropdownMenuLabel>{column.label}</DropdownMenuLabel>
                                <DropdownMenuItem onSelect={() => onPreset(column.code, "read-only", visiblePermissions)}>
                                  Add every view right
                                </DropdownMenuItem>
                                <DropdownMenuItem onSelect={() => onPreset(column.code, "floor-ops", visiblePermissions)}>
                                  Add the floor set
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onSelect={() => onPreset(column.code, "clear-added", visiblePermissions)}>
                                  Remove added rights shown
                                </DropdownMenuItem>
                                <DropdownMenuItem className="text-warning-fg" onSelect={() => onPreset(column.code, "reset", visiblePermissions)}>
                                  Reset to the standard set
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </div>
                      </div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => {
                const isCollapsed = collapsed.has(group.key) && !search;
                const assignable = group.rows.filter((row) => row.assignable).map((row) => row.permission);
                return (
                  <React.Fragment key={group.key}>
                    <tr>
                      <th
                        scope="rowgroup"
                        className="sticky left-0 z-10 border-b border-r border-line bg-surface-2 px-2 py-1.5 text-left"
                      >
                        <button
                          type="button"
                          onClick={() => toggleCollapsed(group.key)}
                          className="flex w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-xs font-bold uppercase tracking-wider text-content-2 hover:text-content-1"
                          aria-expanded={!isCollapsed}
                        >
                          {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                          {group.label}
                          <span className="font-mono text-caption font-semibold normal-case text-content-4">{group.rows.length}</span>
                        </button>
                      </th>
                      {columns.map((column) => {
                        const wildcard = Boolean(sets.draft[column.code]?.has("*"));
                        const held = wildcard ? assignable.length : assignable.filter((permission) => sets.draft[column.code]?.has(permission)).length;
                        const all = assignable.length > 0 && held === assignable.length;
                        const isLocked = locked(column.code) || assignable.length === 0;
                        return (
                          <td key={column.code} className="border-b border-line bg-surface-2 px-1.5 py-1 text-center">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  disabled={isLocked}
                                  onClick={() => onToggle(column.code, assignable, !all)}
                                  className={cn(
                                    "mx-auto flex h-6 w-16 items-center gap-1 rounded-full px-1 ring-1 transition disabled:cursor-not-allowed disabled:opacity-60",
                                    all ? "bg-info-bg ring-info-border" : "bg-surface-1 ring-line hover:ring-line-strong",
                                  )}
                                  aria-label={`${all ? "Remove" : "Give"} all ${group.label} rights for ${column.label}`}
                                >
                                  <span className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
                                    <span
                                      className="absolute inset-y-0 left-0 rounded-full bg-primary"
                                      style={{ width: `${assignable.length ? (held / assignable.length) * 100 : 0}%` }}
                                    />
                                  </span>
                                  <span className="font-mono text-[10px] font-semibold tabular-nums text-content-3">
                                    {held}/{assignable.length}
                                  </span>
                                </button>
                              </TooltipTrigger>
                              <TooltipContent>{isLocked ? "Locked" : all ? `Remove all ${group.label} rights` : `Give all ${group.label} rights`}</TooltipContent>
                            </Tooltip>
                          </td>
                        );
                      })}
                    </tr>
                    {group.hint && !isCollapsed ? (
                      <tr>
                        <td colSpan={columns.length + 1} className="border-b border-line bg-surface-2 px-4 py-2 text-xs text-content-3">
                          {group.hint}
                        </td>
                      </tr>
                    ) : null}
                    {!isCollapsed
                      ? group.rows.map((row) => (
                          <tr key={row.permission} className="group/row">
                            <th
                              scope="row"
                              className="sticky left-0 z-10 border-b border-r border-line bg-surface-1 px-4 py-1.5 text-left font-normal group-hover/row:bg-surface-2"
                            >
                              <div className="text-xs font-semibold text-content-1">{showCodes ? row.permission : row.title}</div>
                              <div className="truncate text-caption text-content-3">
                                {showCodes ? row.title : row.route || row.permission}
                              </div>
                            </th>
                            {columns.map((column) => {
                              const on = Boolean(sets.draft[column.code]?.has(row.permission));
                              const state = cellState(on, Boolean(sets.baseline[column.code]?.has(row.permission)));
                              const changed = on !== Boolean(sets.saved[column.code]?.has(row.permission));
                              const wildcard = Boolean(sets.draft[column.code]?.has("*")) && row.permission !== "*";
                              const isLocked = locked(column.code) || !row.assignable;
                              const dataRight = dataRightForPage(row.permission, known);
                              const missingData = on && dataRight && !sets.draft[column.code]?.has(dataRight);
                              return (
                                <td key={column.code} className="border-b border-line px-1.5 py-1 text-center group-hover/row:bg-surface-2">
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <button
                                        type="button"
                                        disabled={isLocked}
                                        onClick={() => onToggle(column.code, [row.permission], !on)}
                                        className={cellClass(wildcard ? "base" : state, changed)}
                                        aria-pressed={on}
                                        aria-label={`${row.title} for ${column.label}: ${wildcard ? "full access" : CELL_TEXT[state]}`}
                                      >
                                        {wildcard ? <Check className="h-3.5 w-3.5 opacity-60" /> : <CellIcon state={state} locked={isLocked && !on} />}
                                        {missingData ? <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-warning-fg" /> : null}
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent className="max-w-[260px]">
                                      <div className="font-semibold">{row.title}</div>
                                      <div>{wildcard ? "Full access role" : CELL_TEXT[state]}{changed ? " · not saved yet" : ""}</div>
                                      {missingData ? <div className="mt-1 text-warning-fg">Shows the page only; its data needs {dataRight}.</div> : null}
                                      {!row.assignable ? <div className="mt-1">Fixed right, cannot be assigned.</div> : null}
                                    </TooltipContent>
                                  </Tooltip>
                                </td>
                              );
                            })}
                          </tr>
                        ))
                      : null}
                  </React.Fragment>
                );
              })}
              {!groups.length ? (
                <tr>
                  <td colSpan={columns.length + 1} className="px-4 py-12 text-center text-sm text-content-3">
                    No rights match these filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </TooltipProvider>
  );
}

function sameSet(left?: Set<string>, right?: Set<string>): boolean {
  if (!left || !right) return left === right;
  if (left.size !== right.size) return false;
  for (const value of left) if (!right.has(value)) return false;
  return true;
}

export function cellClass(state: CellState, changed: boolean): string {
  return cn(
    "relative mx-auto grid h-7 w-7 place-items-center rounded-lg ring-1 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed",
    state === "base" && "bg-success-bg text-success-fg ring-success-border hover:ring-success-fg",
    state === "added" && "bg-info-bg text-primary ring-info-border hover:ring-primary",
    state === "removed" && "bg-danger-bg text-danger-fg ring-danger-border hover:ring-danger-fg",
    state === "off" && "bg-surface-1 text-content-4 ring-line hover:bg-surface-2 hover:text-content-2",
    changed && "ring-2 ring-warning-fg",
  );
}

export function CellIcon({ state, locked }: { state: CellState; locked?: boolean }) {
  if (state === "base") return <Check className="h-4 w-4" />;
  if (state === "added") return <Plus className="h-4 w-4" strokeWidth={2.5} />;
  if (state === "removed") return <Minus className="h-4 w-4" strokeWidth={2.5} />;
  return locked ? <Lock className="h-3 w-3" /> : <span className="h-1.5 w-1.5 rounded-full bg-current opacity-40" />;
}

function Legend() {
  const items: Array<{ state: CellState; label: string }> = [
    { state: "base", label: "Standard for the role" },
    { state: "added", label: "Added" },
    { state: "removed", label: "Standard, removed" },
    { state: "off", label: "Not given" },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-content-3">
      {items.map((item) => (
        <span key={item.state} className="inline-flex items-center gap-1.5">
          <span className={cn(cellClass(item.state, false), "pointer-events-none mx-0 h-5 w-5 rounded-md")}>
            <CellIcon state={item.state} />
          </span>
          {item.label}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <span className="h-5 w-5 rounded-md ring-2 ring-warning-fg" /> Not saved yet
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-warning-fg" /> Page without its data right
      </span>
    </div>
  );
}


"use client";

/**
 * V3.6 Inventory Workspace Shell
 *
 * Reusable layout/filter primitives shared by Rolls, Bulk, Packaging, Addons
 * workspaces. Beautiful sticky filter rail + saved views (localStorage),
 * column-config + density + export hooks. Each workspace plugs in its own
 * filter values and content via props.
 */

import * as React from "react";
import {
  BookmarkPlus,
  ChevronDown,
  Columns3,
  Download,
  Eye,
  Filter,
  LayoutGrid,
  Rows3,
  Search,
  Sparkles,
  Star,
  Table2,
  X,
  Disc3,
} from "lucide-react";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────

export type WorkspaceViewMode = "table" | "grid" | "matrix" | "films";

export interface SavedView<T> {
  id: string;
  name: string;
  icon?: string;
  pinned?: boolean;
  state: T;
}

export interface FilterChip {
  key: string;
  label: string;
  onClear: () => void;
}

// ─── Saved Views hook (localStorage backed) ─────────────────────────

export function useSavedViews<T>(
  workspaceKey: string,
  defaults: SavedView<T>[] = [],
) {
  const storageKey = `inv-v36-views::${workspaceKey}`;
  const [views, setViews] = React.useState<SavedView<T>[]>(defaults);
  const [activeId, setActiveId] = React.useState<string | null>(null);

  React.useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as SavedView<T>[];
        if (Array.isArray(parsed))
          setViews([
            ...defaults,
            ...parsed.filter((v) => !defaults.some((d) => d.id === v.id)),
          ]);
      }
    } catch {
      /* ignore */
    }
  }, [storageKey]);

  const persist = React.useCallback(
    (next: SavedView<T>[]) => {
      const userOnly = next.filter((v) => !defaults.some((d) => d.id === v.id));
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(userOnly));
      } catch {
        /* ignore */
      }
    },
    [storageKey, defaults],
  );

  const saveView = React.useCallback(
    (name: string, state: T) => {
      const id = `user-${Date.now()}`;
      const v: SavedView<T> = { id, name, state };
      setViews((prev) => {
        const next = [...prev, v];
        persist(next);
        return next;
      });
      setActiveId(id);
    },
    [persist],
  );

  const deleteView = React.useCallback(
    (id: string) => {
      setViews((prev) => {
        const next = prev.filter((v) => v.id !== id);
        persist(next);
        return next;
      });
      if (activeId === id) setActiveId(null);
    },
    [activeId, persist],
  );

  const togglePin = React.useCallback(
    (id: string) => {
      setViews((prev) => {
        const next = prev.map((v) =>
          v.id === id ? { ...v, pinned: !v.pinned } : v,
        );
        persist(next);
        return next;
      });
    },
    [persist],
  );

  return { views, activeId, setActiveId, saveView, deleteView, togglePin };
}

// ─── Saved Views Bar ─────────────────────────────────────────────────

export interface SavedViewsBarProps<T> {
  views: SavedView<T>[];
  activeId: string | null;
  onSelect: (view: SavedView<T>) => void;
  onDelete?: (id: string) => void;
  onTogglePin?: (id: string) => void;
  onSave: (name: string) => void;
}

export function SavedViewsBar<T>({
  views,
  activeId,
  onSelect,
  onDelete,
  onTogglePin,
  onSave,
}: SavedViewsBarProps<T>) {
  const [showNew, setShowNew] = React.useState(false);
  const [newName, setNewName] = React.useState("");

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-[12px] border border-line bg-surface-1 px-3 py-2 shadow-[var(--shadow-sm)]">
      <span className="text-[12px] font-semibold text-content-3 mr-1">
        Views
      </span>
      {views.map((v) => (
        <div key={v.id} className="group relative">
          <button
            onClick={() => onSelect(v)}
            aria-pressed={activeId === v.id}
            className={cn(
              "inline-flex min-h-7 items-center gap-1 rounded-[7px] px-2.5 py-1 text-[12.5px] font-medium transition",
              activeId === v.id
                ? "bg-content-1 text-surface-1 font-semibold"
                : "bg-surface-1 text-content-2 ring-1 ring-line hover:bg-surface-2 hover:text-content-1",
            )}
          >
            {v.pinned && <Star className="h-3 w-3 fill-current" aria-hidden />}
            {v.name}
          </button>
          {(onDelete || onTogglePin) && v.id.startsWith("user-") && (
            <div className="absolute right-0 top-full z-10 hidden flex-col gap-0.5 rounded-md bg-surface-1 p-1 shadow-lg ring-1 ring-line group-hover:flex">
              {onTogglePin && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onTogglePin(v.id);
                  }}
                  className="text-caption text-content-2 hover:bg-surface-2 px-2 py-0.5 rounded text-left whitespace-nowrap"
                >
                  {v.pinned ? "Unpin" : "Pin"}
                </button>
              )}
              {onDelete && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(v.id);
                  }}
                  className="text-caption text-danger-fg hover:bg-danger-bg px-2 py-0.5 rounded text-left whitespace-nowrap"
                >
                  Delete
                </button>
              )}
            </div>
          )}
        </div>
      ))}
      <div className="ml-1 h-4 w-px bg-line" />
      {showNew ? (
        <div className="flex items-center gap-1">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="View name"
            className="h-7 w-[140px] rounded-md text-caption"
            onKeyDown={(e) => {
              if (e.key === "Enter" && newName.trim()) {
                onSave(newName.trim());
                setNewName("");
                setShowNew(false);
              } else if (e.key === "Escape") {
                setShowNew(false);
                setNewName("");
              }
            }}
            autoFocus
          />
          <button
            onClick={() => {
              if (newName.trim()) {
                onSave(newName.trim());
                setNewName("");
                setShowNew(false);
              }
            }}
            className="rounded-md bg-primary px-2 py-1 text-caption font-bold text-white hover:bg-primary"
          >
            Save
          </button>
          <button
            onClick={() => {
              setShowNew(false);
              setNewName("");
            }}
            className="rounded-md bg-surface-2 px-2 py-1 text-caption font-bold text-content-3 hover:bg-line"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowNew(true)}
          className="inline-flex min-h-7 items-center gap-1 rounded-[7px] px-2.5 py-1 text-[12.5px] font-medium text-order-fg ring-1 ring-order-border hover:bg-order-bg"
        >
          <BookmarkPlus className="h-3 w-3" /> Save current
        </button>
      )}
    </div>
  );
}

// ─── Filter Bar (chips + search + view-mode + columns) ──────────────

export interface FilterBarProps {
  search: string;
  onSearchChange: (v: string) => void;
  chips?: FilterChip[];
  onClearAll?: () => void;
  viewMode?: WorkspaceViewMode;
  onViewModeChange?: (v: WorkspaceViewMode) => void;
  viewModes?: WorkspaceViewMode[];
  onExport?: () => void;
  onConfigureColumns?: () => void;
  rightExtras?: React.ReactNode;
}

export function FilterBar({
  search,
  onSearchChange,
  chips = [],
  onClearAll,
  viewMode,
  onViewModeChange,
  viewModes = ["table", "grid", "matrix"],
  onExport,
  onConfigureColumns,
  rightExtras,
}: FilterBarProps) {
  return (
    <div className="rounded-2xl border border-line bg-surface-1 p-3 shadow-sm space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[260px]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-4" />
          <Input
            data-testid="inventory-workspace-search"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search material · roll # · lot · vendor · location…"
            className="h-10 rounded-xl bg-surface-2 pl-10 pr-9 text-sm shadow-inner focus:bg-surface-1"
          />
          {search && (
            <button
              onClick={() => onSearchChange("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-content-4 hover:text-content-2"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {viewModes && viewModes.length > 1 && viewMode && onViewModeChange && (
          <div className="inline-flex rounded-xl bg-surface-2 p-0.5 shadow-inner">
            {viewModes.map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={viewMode === m}
                onClick={() => onViewModeChange(m)}
                className={cn(
                  "inline-flex h-9 items-center gap-1 rounded-lg px-2.5 text-caption font-bold capitalize transition",
                  viewMode === m
                    ? "bg-surface-1 text-content-1 shadow-sm ring-1 ring-line"
                    : "text-content-3 hover:text-content-1",
                )}
              >
                {m === "table" && <Rows3 className="h-3.5 w-3.5" />}
                {m === "grid" && <LayoutGrid className="h-3.5 w-3.5" />}
                {m === "matrix" && <Columns3 className="h-3.5 w-3.5" />}
                {m === "films" && <Disc3 className="h-3.5 w-3.5" />}
                {m}
              </button>
            ))}
          </div>
        )}
        {onConfigureColumns && (
          <button
            onClick={onConfigureColumns}
            className="inline-flex h-9 items-center gap-1 rounded-xl bg-surface-2 px-3 text-caption font-bold text-content-2 ring-1 ring-line hover:bg-surface-2"
          >
            <Columns3 className="h-3.5 w-3.5" /> Columns
          </button>
        )}
        {onExport && (
          <button
            onClick={onExport}
            className="inline-flex h-9 items-center gap-1 rounded-xl bg-surface-2 px-3 text-caption font-bold text-content-2 ring-1 ring-line hover:bg-surface-2"
          >
            <Download className="h-3.5 w-3.5" /> Export
          </button>
        )}
        {rightExtras}
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[12px] font-semibold text-content-3 mr-1">
            <Filter className="inline-block h-3 w-3 mr-1 -mt-0.5" />
            Active
          </span>
          {chips.map((c) => (
            <button
              key={c.key}
              onClick={c.onClear}
              className="inline-flex items-center gap-1 rounded-full bg-info-bg px-2.5 py-0.5 text-caption font-bold text-primary ring-1 ring-info-border hover:bg-danger-bg hover:text-danger-fg hover:ring-danger-border transition"
            >
              {c.label} <X className="h-3 w-3" />
            </button>
          ))}
          {chips.length > 0 && onClearAll && (
            <button
              onClick={onClearAll}
              className="text-caption font-bold text-content-3 hover:text-danger-fg ml-1"
            >
              Clear all
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Filter Group (label + chips of values) ────────────────────────

export interface FilterGroupProps {
  label: string;
  options: Array<{
    id: string;
    label: React.ReactNode;
    count?: number;
    tone?: string;
  }>;
  value: string;
  onChange: (id: string) => void;
  columns?: number;
}

export function FilterGroup({
  label,
  options,
  value,
  onChange,
  columns = 1,
}: FilterGroupProps) {
  return (
    <div>
      <div className="mb-1.5 text-[12px] font-semibold text-content-3">
        {label}
      </div>
      <div
        className={cn(
          "grid gap-1",
          columns === 2 ? "grid-cols-2" : "grid-cols-1",
        )}
      >
        {options.map((opt) => (
          <button
            key={opt.id}
            onClick={() => onChange(opt.id)}
            className={cn(
              "flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs font-bold transition",
              value === opt.id
                ? "bg-primary text-white shadow-sm"
                : "bg-surface-1 text-content-2 ring-1 ring-line hover:bg-surface-2",
              opt.tone || "",
            )}
          >
            <span className="truncate">{opt.label}</span>
            {typeof opt.count === "number" && (
              <span
                className={cn(
                  "ml-2 rounded px-1.5 py-0.5 text-caption font-semibold",
                  value === opt.id ? "bg-surface-1/20" : "bg-surface-2",
                )}
              >
                {opt.count}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Multi-select pill list ────────────────────────────────────────

export interface MultiSelectProps {
  label: string;
  options: Array<{ id: string; label: string; count?: number }>;
  selected: string[];
  onChange: (ids: string[]) => void;
}

export function MultiSelectPills({
  label,
  options,
  selected,
  onChange,
}: MultiSelectProps) {
  const [query, setQuery] = React.useState("");
  const toggle = (id: string) => {
    if (selected.includes(id)) onChange(selected.filter((s) => s !== id));
    else onChange([...selected, id]);
  };
  const selectedSet = React.useMemo(() => new Set(selected), [selected]);
  const visibleOptions = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return options
      .filter((o) => !q || `${o.label} ${o.id}`.toLowerCase().includes(q))
      .sort((a, b) => {
        const aSel = selectedSet.has(a.id) ? 1 : 0;
        const bSel = selectedSet.has(b.id) ? 1 : 0;
        if (aSel !== bSel) return bSel - aSel;
        return (b.count || 0) - (a.count || 0);
      });
  }, [options, query, selectedSet]);
  return (
    <div className="rounded-xl border border-line bg-surface-2 p-2.5">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[12px] font-semibold text-content-3">
          {label}
        </span>
        {selected.length > 0 && (
          <button
            onClick={() => onChange([])}
            className="text-caption font-bold text-primary hover:underline"
          >
            Clear ({selected.length})
          </button>
        )}
      </div>
      {selected.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1">
          {selected.slice(0, 8).map((id) => {
            const option = options.find((o) => o.id === id);
            return (
              <button
                key={id}
                onClick={() => toggle(id)}
                className="inline-flex max-w-full items-center gap-1 rounded-full bg-surface-3 px-2 py-0.5 text-caption font-bold text-white shadow-sm"
              >
                <span className="truncate">{option?.label || id}</span>
                <X className="h-3 w-3" />
              </button>
            );
          })}
          {selected.length > 8 && (
            <span className="rounded-full bg-line px-2 py-0.5 text-caption font-bold text-content-2">
              +{selected.length - 8}
            </span>
          )}
        </div>
      )}
      {options.length > 8 && (
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-content-4" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${label.toLowerCase()}`}
            className="h-8 rounded-lg border-line bg-surface-1 pl-8 pr-7 text-xs"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-content-4 hover:text-content-2"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}
      <div className="flex max-h-44 flex-wrap gap-1 overflow-y-auto pr-1">
        {visibleOptions.map((o) => {
          const active = selected.includes(o.id);
          return (
            <button
              key={o.id}
              onClick={() => toggle(o.id)}
              className={cn(
                "inline-flex min-h-7 max-w-full items-center gap-1 rounded-full px-2.5 py-0.5 text-caption font-bold transition",
                active
                  ? "bg-order-fg text-white shadow-sm"
                  : "bg-surface-1 text-order-fg ring-1 ring-order-border hover:bg-order-bg",
              )}
            >
              <span className="truncate">{o.label}</span>
              {typeof o.count === "number" && (
                <span
                  className={cn(
                    "rounded px-1 text-caption font-semibold",
                    active ? "bg-surface-1/20" : "bg-order-bg",
                  )}
                >
                  {o.count}
                </span>
              )}
            </button>
          );
        })}
        {visibleOptions.length === 0 && (
          <div className="rounded-lg border border-dashed border-line bg-surface-1 px-2.5 py-2 text-caption font-semibold text-content-3">
            No matching filter options.
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Range slider (min/max) ────────────────────────────────────────

export function RangeFilter({
  label,
  min,
  max,
  value,
  onChange,
  suffix = "",
  step = 1,
}: {
  label: string;
  min: number;
  max: number;
  value: [number, number];
  onChange: (v: [number, number]) => void;
  suffix?: string;
  step?: number;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[12px] font-semibold text-content-3">
          {label}
        </span>
        <span className="font-mono text-caption text-content-2">
          {value[0]}–{value[1]}
          {suffix}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value[0]}
          onChange={(e) => onChange([Number(e.target.value), value[1]])}
          className="h-8 text-xs"
        />
        <Input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value[1]}
          onChange={(e) => onChange([value[0], Number(e.target.value)])}
          className="h-8 text-xs"
        />
      </div>
    </div>
  );
}

// ─── Rail wrapper ──────────────────────────────────────────────────

export function FilterRail({
  children,
  footer,
}: {
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <aside className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto rounded-2xl border border-line bg-surface-1 p-4 shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-semibold text-content-3">
          <Sparkles className="inline-block h-3 w-3 mr-1 -mt-0.5" />
          Smart filters
        </span>
      </div>
      {children}
      {footer}
    </aside>
  );
}

// ─── Section shell (consistent across workspaces) ─────────────────

export function WorkspaceSection({
  title,
  eyebrow,
  subtitle,
  tone = "blue",
  icon,
  actions,
  children,
}: {
  title: string;
  eyebrow?: string;
  subtitle?: string;
  tone?: "blue" | "violet" | "amber" | "emerald" | "rose";
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const ICON_TONE: Record<string, string> = {
    blue: "border-info-border bg-info-bg text-info-fg",
    violet: "border-order-border bg-order-bg text-order-fg",
    amber: "border-warning-border bg-warning-bg text-warning-fg",
    emerald: "border-success-border bg-success-bg text-success-fg",
    rose: "border-danger-border bg-danger-bg text-danger-fg",
  };
  return (
    <section className="overflow-hidden rounded-[14px] border border-line bg-surface-1 shadow-[var(--shadow-sm)]">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex min-w-0 items-start gap-3">
          {icon && (
            <span className={cn("flex h-8 w-8 flex-none items-center justify-center rounded-[9px] border", ICON_TONE[tone])}>
              {icon}
            </span>
          )}
          <div className="min-w-0">
            {eyebrow && <div className="text-[12px] font-medium text-content-3">{eyebrow}</div>}
            <h2 className="text-[15px] font-semibold text-content-1">{title}</h2>
            {subtitle && <p className="mt-0.5 max-w-[80ch] text-[12.5px] text-content-3">{subtitle}</p>}
          </div>
        </div>
        {actions}
      </header>
      <div>{children}</div>
    </section>
  );
}

// ─── KPI tile ──────────────────────────────────────────────────────

/** Stock workspace KPI tile, drawn like the planner kit's KpiTile. `icon` (legacy emoji) is ignored. */
export function KpiTileV36({
  tone,
  label,
  value,
  unit,
  sub,
  delta,
}: {
  tone: "blue" | "violet" | "amber" | "emerald" | "rose";
  icon?: string;
  label: string;
  value: string;
  unit?: string;
  sub?: string;
  delta?: { v: string; positive: boolean };
}) {
  const border = { blue: "border-line", violet: "border-line", amber: "border-warning-border", emerald: "border-success-border", rose: "border-danger-border" }[tone];
  const valueTone = { blue: "text-content-1", violet: "text-content-1", amber: "text-warning-fg", emerald: "text-success-fg", rose: "text-danger-fg" }[tone];
  return (
    <div className={cn("flex min-h-[104px] min-w-0 flex-col gap-1 rounded-[14px] border bg-surface-1 px-3.5 pb-2.5 pt-3 shadow-[var(--shadow-sm)]", border)}>
      <div className="text-caption font-medium leading-tight text-content-3">{label}</div>
      <div className={cn("flex flex-wrap items-baseline gap-x-1.5 text-xl font-semibold leading-tight tracking-tight tabular-nums", valueTone)}>
        {value}
        {unit && <span className="text-caption font-medium text-content-3">{unit}</span>}
        {delta && (
          <span className={cn("rounded-[4px] px-1 font-mono text-[11px] font-semibold", delta.positive ? "bg-success-bg text-success-fg" : "bg-danger-bg text-danger-fg")}>
            {delta.positive ? "▲" : "▼"} {delta.v}
          </span>
        )}
      </div>
      {sub && <div className="mt-auto text-[11.5px] leading-snug text-content-4">{sub}</div>}
    </div>
  );
}

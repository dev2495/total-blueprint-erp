"use client";

import * as React from "react";
import { Check, Edit3, Plus, RefreshCw, Star, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SavedView {
  id: string;
  name: string;
  query: string;
}

export interface SavedViewBarProps
  extends React.HTMLAttributes<HTMLDivElement> {
  pageId: string;
  currentQuery: string;
  onApply: (query: string) => void;
  defaultQuery?: string;
}

const KEY = (pageId: string) => `tpp:saved-views:${pageId}`;

function loadViews(pageId: string): SavedView[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY(pageId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedView[];
    return Array.isArray(parsed)
      ? parsed.filter((v) => v && v.id && v.name)
      : [];
  } catch {
    return [];
  }
}

function persistViews(pageId: string, views: SavedView[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY(pageId), JSON.stringify(views));
  } catch {
    // storage full or denied — silent
  }
}

export const SavedViewBar = React.forwardRef<HTMLDivElement, SavedViewBarProps>(
  (
    { className, pageId, currentQuery, onApply, defaultQuery = "", ...props },
    ref,
  ) => {
    const [views, setViews] = React.useState<SavedView[]>([]);
    const [activeId, setActiveId] = React.useState<string | null>(null);
    const [naming, setNaming] = React.useState(false);
    const [draftName, setDraftName] = React.useState("");
    const [editingId, setEditingId] = React.useState<string | null>(null);
    const [editName, setEditName] = React.useState("");

    React.useEffect(() => {
      setViews(loadViews(pageId));
    }, [pageId]);

    const matchingActive = React.useMemo(() => {
      const v = views.find((view) => view.query === currentQuery);
      return v?.id ?? null;
    }, [views, currentQuery]);

    React.useEffect(() => {
      setActiveId(matchingActive);
    }, [matchingActive]);

    const save = () => {
      const name = draftName.trim();
      if (!name) return;
      const view: SavedView = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name,
        query: currentQuery,
      };
      const next = [...views, view];
      setViews(next);
      persistViews(pageId, next);
      setActiveId(view.id);
      setNaming(false);
      setDraftName("");
    };

    const remove = (id: string) => {
      const next = views.filter((v) => v.id !== id);
      setViews(next);
      persistViews(pageId, next);
      if (activeId === id) setActiveId(null);
    };

    const update = (id: string) => {
      const next = views.map((view) =>
        view.id === id ? { ...view, query: currentQuery } : view,
      );
      setViews(next);
      persistViews(pageId, next);
      setActiveId(id);
    };

    const rename = () => {
      const name = editName.trim();
      if (!editingId || !name) return;
      const next = views.map((view) =>
        view.id === editingId ? { ...view, name } : view,
      );
      setViews(next);
      persistViews(pageId, next);
      setEditingId(null);
      setEditName("");
    };

    return (
      <div
        ref={ref}
        className={cn(
          "flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface-1/85 px-3 py-2 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-surface-1/75 dark:bg-surface-2/90 dark:shadow-black/20",
          className,
        )}
        title="Saved on this device"
        {...props}
      >
        <span className="inline-flex items-center gap-1 text-[11px] font-black uppercase tracking-wide text-content-3">
          <Star className="h-3 w-3 text-primary" />
          Views
        </span>
        <button
          type="button"
          onClick={() => onApply(defaultQuery)}
          data-active={
            (!activeId && currentQuery === defaultQuery) || undefined
          }
          className="rounded-full border border-line bg-surface-1 px-3 py-1 text-[12px] font-bold text-content-3 transition hover:bg-surface-2 data-[active]:border-info-border data-[active]:bg-info-bg data-[active]:text-primary"
        >
          Default
        </button>
        {views.map((v) => (
          <span key={v.id} className="inline-flex items-center rounded-full shadow-[0_1px_0_rgba(255,255,255,.72)]">
            {editingId === v.id ? (
              <input
                autoFocus
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") rename();
                  if (e.key === "Escape") {
                    setEditingId(null);
                    setEditName("");
                  }
                }}
                className="h-7 w-32 rounded-l-full border border-r-0 border-line bg-surface-1 px-3 text-[12px] font-bold text-content-2 outline-none focus:border-primary"
              />
            ) : (
              <button
                type="button"
                onClick={() => onApply(v.query)}
                data-active={activeId === v.id || undefined}
                className="rounded-l-full border border-r-0 border-line bg-surface-1 px-3 py-1 text-[12px] font-bold text-content-3 transition hover:bg-surface-2 data-[active]:border-info-border data-[active]:bg-info-bg data-[active]:text-primary"
              >
                {v.name}
              </button>
            )}
            {editingId === v.id ? (
              <button
                type="button"
                aria-label={`Save saved view name ${v.name}`}
                onClick={rename}
                className="inline-flex h-7 items-center border border-l-0 border-line bg-surface-1 px-2 text-[11px] font-bold text-primary transition hover:bg-info-bg"
              >
                <Check className="h-3 w-3" />
              </button>
            ) : (
              <button
                type="button"
                aria-label={`Rename saved view ${v.name}`}
                onClick={() => {
                  setEditingId(v.id);
                  setEditName(v.name);
                }}
                className="inline-flex h-7 items-center border border-l-0 border-line bg-surface-1 px-2 text-[11px] font-bold text-content-4 transition hover:bg-surface-2 hover:text-primary"
              >
                <Edit3 className="h-3 w-3" />
              </button>
            )}
            <button
              type="button"
              aria-label={`Update saved view ${v.name} to current filters`}
              onClick={() => update(v.id)}
              className="inline-flex h-7 items-center border border-l-0 border-line bg-surface-1 px-2 text-[11px] font-bold text-content-4 transition hover:bg-info-bg hover:text-primary"
            >
              <RefreshCw className="h-3 w-3" />
            </button>
            <button
              type="button"
              aria-label={`Delete saved view ${v.name}`}
              onClick={() => remove(v.id)}
              className="inline-flex h-7 items-center rounded-r-full border border-l-0 border-line bg-surface-1 px-2 text-[11px] text-content-4 transition hover:bg-danger-bg hover:text-danger-fg"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </span>
        ))}
        {naming ? (
          <span className="inline-flex items-center gap-1">
            <input
              autoFocus
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") save();
                if (e.key === "Escape") {
                  setNaming(false);
                  setDraftName("");
                }
              }}
              placeholder="View name"
              className="h-7 rounded-full border border-line bg-surface-1 px-3 text-[12px] font-semibold outline-none focus:border-primary"
            />
            <button
              type="button"
              onClick={save}
              className="inline-flex h-7 items-center gap-1 rounded-full bg-primary px-3 text-[11px] font-bold text-white hover:bg-primary"
            >
              <Check className="h-3 w-3" />
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setNaming(false);
                setDraftName("");
              }}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-line bg-surface-1 text-content-4 hover:bg-surface-2"
              aria-label="Cancel saved view name"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setNaming(true)}
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-line-strong bg-transparent px-3 py-1 text-[12px] font-bold text-content-3 transition hover:border-info-border hover:text-primary"
          >
            <Plus className="h-3 w-3" />
            Save current
          </button>
        )}
      </div>
    );
  },
);
SavedViewBar.displayName = "SavedViewBar";

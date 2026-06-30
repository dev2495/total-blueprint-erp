"use client";

import * as React from "react";
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
          "flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface-1/70 px-3 py-2",
          className,
        )}
        title="Saved on this device"
        {...props}
      >
        <span className="text-[11px] font-semibold uppercase tracking-wide text-content-3">
          Saved
        </span>
        <button
          type="button"
          onClick={() => onApply(defaultQuery)}
          data-active={
            (!activeId && currentQuery === defaultQuery) || undefined
          }
          className="rounded-full border border-line bg-surface-1 px-3 py-0.5 text-[12px] font-semibold text-content-3 hover:bg-surface-2 data-[active]:border-info-border data-[active]:bg-info-bg data-[active]:text-primary"
        >
          Default
        </button>
        {views.map((v) => (
          <span key={v.id} className="inline-flex items-center">
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
                className="h-6 w-28 rounded-l-full border border-r-0 border-line bg-surface-1 px-3 text-[12px] font-semibold text-content-2 outline-none focus:border-primary"
              />
            ) : (
              <button
                type="button"
                onClick={() => onApply(v.query)}
                data-active={activeId === v.id || undefined}
                className="rounded-l-full border border-r-0 border-line bg-surface-1 px-3 py-0.5 text-[12px] font-semibold text-content-3 hover:bg-surface-2 data-[active]:border-info-border data-[active]:bg-info-bg data-[active]:text-primary"
              >
                {v.name}
              </button>
            )}
            {editingId === v.id ? (
              <button
                type="button"
                aria-label={`Save saved view name ${v.name}`}
                onClick={rename}
                className="border border-l-0 border-line bg-surface-1 px-2 py-0.5 text-[11px] font-semibold text-primary hover:bg-info-bg"
              >
                Save
              </button>
            ) : (
              <button
                type="button"
                aria-label={`Rename saved view ${v.name}`}
                onClick={() => {
                  setEditingId(v.id);
                  setEditName(v.name);
                }}
                className="border border-l-0 border-line bg-surface-1 px-2 py-0.5 text-[11px] font-semibold text-content-4 hover:bg-surface-2 hover:text-primary"
              >
                Edit
              </button>
            )}
            <button
              type="button"
              aria-label={`Update saved view ${v.name} to current filters`}
              onClick={() => update(v.id)}
              className="border border-l-0 border-line bg-surface-1 px-2 py-0.5 text-[11px] font-semibold text-content-4 hover:bg-info-bg hover:text-primary"
            >
              Update
            </button>
            <button
              type="button"
              aria-label={`Delete saved view ${v.name}`}
              onClick={() => remove(v.id)}
              className="rounded-r-full border border-l-0 border-line bg-surface-1 px-2 py-0.5 text-[11px] text-content-4 hover:bg-danger-bg hover:text-danger-fg"
            >
              ×
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
              className="h-6 rounded-md border border-line bg-surface-1 px-2 text-[12px] outline-none focus:border-primary"
            />
            <button
              type="button"
              onClick={save}
              className="rounded-md bg-primary px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-primary"
            >
              Save
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setNaming(true)}
            className="rounded-full border border-dashed border-line-strong bg-transparent px-3 py-0.5 text-[12px] font-semibold text-content-3 hover:border-info-border hover:text-primary"
          >
            + Save current
          </button>
        )}
      </div>
    );
  },
);
SavedViewBar.displayName = "SavedViewBar";

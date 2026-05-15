"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface SavedView {
  id: string;
  name: string;
  query: string;
}

export interface SavedViewBarProps extends React.HTMLAttributes<HTMLDivElement> {
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
    return Array.isArray(parsed) ? parsed.filter((v) => v && v.id && v.name) : [];
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
  ({ className, pageId, currentQuery, onApply, defaultQuery = "", ...props }, ref) => {
    const [views, setViews] = React.useState<SavedView[]>([]);
    const [activeId, setActiveId] = React.useState<string | null>(null);
    const [naming, setNaming] = React.useState(false);
    const [draftName, setDraftName] = React.useState("");

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

    return (
      <div
        ref={ref}
        className={cn(
          "flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white/70 px-3 py-2",
          className,
        )}
        title="Saved on this device"
        {...props}
      >
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Saved
        </span>
        <button
          type="button"
          onClick={() => onApply(defaultQuery)}
          data-active={!activeId && currentQuery === defaultQuery || undefined}
          className="rounded-full border border-slate-200 bg-white px-3 py-0.5 text-[12px] font-semibold text-slate-600 hover:bg-slate-50 data-[active]:border-blue-300 data-[active]:bg-blue-50 data-[active]:text-blue-700"
        >
          Default
        </button>
        {views.map((v) => (
          <span key={v.id} className="inline-flex items-center">
            <button
              type="button"
              onClick={() => onApply(v.query)}
              data-active={activeId === v.id || undefined}
              className="rounded-l-full border border-r-0 border-slate-200 bg-white px-3 py-0.5 text-[12px] font-semibold text-slate-600 hover:bg-slate-50 data-[active]:border-blue-300 data-[active]:bg-blue-50 data-[active]:text-blue-700"
            >
              {v.name}
            </button>
            <button
              type="button"
              aria-label={`Delete saved view ${v.name}`}
              onClick={() => remove(v.id)}
              className="rounded-r-full border border-l-0 border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-400 hover:bg-rose-50 hover:text-rose-600"
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
              className="h-6 rounded-md border border-slate-200 bg-white px-2 text-[12px] outline-none focus:border-blue-400"
            />
            <button
              type="button"
              onClick={save}
              className="rounded-md bg-blue-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-blue-700"
            >
              Save
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setNaming(true)}
            className="rounded-full border border-dashed border-slate-300 bg-transparent px-3 py-0.5 text-[12px] font-semibold text-slate-500 hover:border-blue-300 hover:text-blue-700"
          >
            + Save current
          </button>
        )}
      </div>
    );
  },
);
SavedViewBar.displayName = "SavedViewBar";

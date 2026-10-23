"use client";

import * as React from "react";
import { Search, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { TONE_FILL, type Tone } from "./signals";

/**
 * One toolbar for every planner list: state lenses with counts, search (⌘K / Ctrl K
 * focuses it), then the screen's own filter, view and sort controls, then the
 * active filters as removable tokens.
 */

export interface Lens {
  key: string;
  label: string;
  count?: number | null;
  tone?: Tone;
}

export function LensChips({
  lenses,
  value,
  onChange,
  label = "Filter by state",
}: {
  lenses: Lens[];
  value: string;
  onChange: (key: string) => void;
  label?: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-0.5 rounded-[12px] border border-line bg-surface-1 p-[3px] shadow-[var(--shadow-sm)]">
      {lenses.map((lens) => {
        const active = lens.key === value;
        return (
          <button
            key={lens.key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(lens.key)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-[9px] px-2.5 text-[13px] font-medium transition-colors",
              active ? "bg-content-1 text-surface-1" : "text-content-2 hover:bg-surface-2",
            )}
          >
            {lens.tone ? <i className={cn("h-1.5 w-1.5 rounded-full", TONE_FILL[lens.tone])} aria-hidden /> : null}
            {lens.label}
            {lens.count !== undefined && lens.count !== null ? (
              <span className={cn("rounded-[6px] px-1.5 font-mono text-[11px] tabular-nums", active ? "bg-surface-1/20" : "bg-surface-2 text-content-3")}>
                {lens.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function SearchField({
  value,
  onChange,
  placeholder,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  id: string;
}) {
  const ref = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k" && ref.current && document.activeElement !== ref.current) {
        // Only claim ⌘K when the page has this search box visible.
        if (ref.current.offsetParent === null) return;
        event.preventDefault();
        ref.current.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="relative min-w-0 flex-[1_1_240px]">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-4" aria-hidden />
      <label htmlFor={id} className="sr-only">
        {placeholder}
      </label>
      <input
        ref={ref}
        id={id}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-[38px] w-full rounded-[10px] border border-line bg-surface-1 pl-9 pr-14 text-[13px] text-content-1 shadow-[var(--shadow-sm)] outline-none placeholder:text-content-4 focus:border-order focus:ring-2 focus:ring-order-border"
      />
      <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded-[5px] border border-line bg-surface-2 px-1.5 font-mono text-[10.5px] text-content-4">⌘K</kbd>
    </div>
  );
}

export function Toolbar({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("flex flex-wrap items-center gap-2", className)}>{children}</div>;
}

export function ActiveTokens({
  tokens,
  onRemove,
  onClear,
}: {
  tokens: Array<{ key: string; label: string; value: string }>;
  onRemove: (key: string) => void;
  onClear: () => void;
}) {
  if (!tokens.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Active filters">
      {tokens.map((token) => (
        <span key={token.key} className="inline-flex items-center gap-1 rounded-[8px] border border-order-border bg-order-bg px-2 py-0.5 text-caption text-order-fg">
          {token.label}: <b>{token.value}</b>
          <button type="button" onClick={() => onRemove(token.key)} aria-label={`Remove filter ${token.label} ${token.value}`} className="grid h-5 w-5 place-items-center rounded hover:bg-surface-1">
            <X className="h-3 w-3" aria-hidden />
          </button>
        </span>
      ))}
      <button type="button" onClick={onClear} className="text-caption font-medium text-order-fg underline-offset-2 hover:underline">
        Clear all
      </button>
    </div>
  );
}

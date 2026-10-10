"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Loader2, Search, X } from "lucide-react";

import { getApiErrorStatus } from "@/lib/api";
import { cn } from "@/lib/utils";
import { gateErrorMessage } from "@/components/gate/use-gate-operation";
import { gateBillsApi, type FormVendor } from "@/services/gate-bills";

export const fieldClass =
  "h-11 w-full rounded-xl border border-line bg-surface-2 px-3 text-[14px] text-content-1 outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-info-border disabled:opacity-60 aria-[invalid=true]:border-danger-border";
export const labelClass = "block text-[12px] font-semibold text-content-3";

export function useDebounced<T>(value: T, delay = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), delay);
    return () => window.clearTimeout(t);
  }, [value, delay]);
  return v;
}

/** Plants, document types and categories (plus a vendor search) from the documents API. */
export function useFormOptions(enabled = true) {
  return useQuery({
    queryKey: ["documents", "form-options"],
    queryFn: () => gateBillsApi.formOptions(),
    enabled,
    staleTime: 5 * 60_000,
    meta: { suppressGlobalError: true },
  });
}

export function FieldError({ id, message }: { id?: string; message?: string | null }) {
  if (!message) return null;
  return (
    <span id={id} role="alert" className="mt-1 block text-[12px] font-medium text-danger-fg">
      {message}
    </span>
  );
}

export function ErrorBanner({ error, onRetry, title }: { error: unknown; onRetry?: () => void; title?: string }) {
  const status = getApiErrorStatus(error);
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger-border bg-danger-bg px-4 py-3 text-[13px] text-danger-fg">
      <span className="inline-flex min-w-0 items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>
          {title ?? (status === 403 ? "You do not have access to this." : "Could not load.")} {gateErrorMessage(error, "Check the connection and retry.")}
        </span>
      </span>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="min-h-[40px] rounded-lg bg-surface-1 px-3 font-semibold text-content-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border">
          Retry
        </button>
      ) : null}
    </div>
  );
}

export function Pager({ page, pages, count, noun, onPage }: { page: number; pages: number; count: number; noun: string; onPage: (page: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[13px] text-content-3">
      <span className="tabular-nums">
        {count.toLocaleString("en-IN")} {noun}
        {count === 1 ? "" : "s"}
      </span>
      <div className="flex items-center gap-2">
        <button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)} className="flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-surface-1 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <span className="min-w-[64px] text-center tabular-nums" aria-live="polite">
          {page} / {pages}
        </span>
        <button type="button" aria-label="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)} className="flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-surface-1 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border">
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}

export function ListSkeleton({ rows = 4, height = 84 }: { rows?: number; height?: number }) {
  return (
    <div className="space-y-2" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="animate-pulse rounded-2xl bg-surface-2" style={{ height }} />
      ))}
    </div>
  );
}

export function PlantSelect({ value, onChange, label = "Factory", allLabel = "All factories", disabled, id, required }: { value: string; onChange: (value: string) => void; label?: string; allLabel?: string | null; disabled?: boolean; id?: string; required?: boolean }) {
  const options = useFormOptions();
  const plants = options.data?.plants ?? [];
  return (
    <label className={labelClass}>
      <span className={allLabel ? "sr-only" : undefined}>{label}</span>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled || options.isLoading} required={required} className={cn(fieldClass, allLabel ? "" : "mt-1")}>
        {allLabel !== null ? <option value="">{options.isLoading ? "Loading factories…" : allLabel}</option> : <option value="">{options.isLoading ? "Loading factories…" : "Choose factory"}</option>}
        {plants.map((plant) => (
          <option key={plant.id} value={plant.id}>
            {plant.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export type PartyValue = { vendorId: string | null; vendorName: string; partyName: string };

/**
 * Vendor master search with a "Party not in master" escape hatch.
 * Keyboard: ↑/↓ to move, Enter to choose, Esc to close.
 */
export function VendorPicker({
  value,
  onChange,
  disabled,
  label = "Vendor / party",
  error,
  allowParty = true,
}: {
  value: PartyValue;
  onChange: (value: PartyValue) => void;
  disabled?: boolean;
  label?: string;
  error?: string | null;
  allowParty?: boolean;
}) {
  const id = useId();
  const listId = `${id}-list`;
  const errorId = `${id}-error`;
  const [freeText, setFreeText] = useState(!value.vendorId && Boolean(value.partyName));
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const q = useDebounced(query.trim(), 250);
  const search = useQuery({
    queryKey: ["documents", "vendor-search", q],
    queryFn: () => gateBillsApi.formOptions({ q }),
    enabled: open && !freeText,
    staleTime: 60_000,
    meta: { suppressGlobalError: true },
  });
  const vendors: FormVendor[] = useMemo(() => search.data?.vendors ?? [], [search.data]);
  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    if (!value.vendorId && value.partyName) setFreeText(true);
  }, [value.vendorId, value.partyName]);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const choose = (vendor: FormVendor) => {
    onChange({ vendorId: vendor.id, vendorName: vendor.name, partyName: "" });
    setQuery("");
    setOpen(false);
  };

  return (
    <div ref={boxRef} className="relative">
      <div className="flex items-center justify-between gap-2">
        <span className={labelClass} id={`${id}-label`}>
          {label}
        </span>
        {allowParty ? (
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              const next = !freeText;
              setFreeText(next);
              onChange(next ? { vendorId: null, vendorName: "", partyName: value.partyName || "" } : { vendorId: null, vendorName: "", partyName: "" });
            }}
            className="min-h-[32px] rounded-lg px-2 text-[12px] font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border disabled:opacity-50"
          >
            {freeText ? "Choose from vendor master" : "Party not in master"}
          </button>
        ) : null}
      </div>
      {freeText ? (
        <input
          value={value.partyName}
          onChange={(e) => onChange({ vendorId: null, vendorName: "", partyName: e.target.value })}
          maxLength={255}
          disabled={disabled}
          placeholder="Type the party name as printed"
          aria-labelledby={`${id}-label`}
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error ? errorId : undefined}
          className={cn(fieldClass, "mt-1")}
        />
      ) : value.vendorId ? (
        <div className="mt-1 flex min-h-[44px] items-center justify-between gap-2 rounded-xl border border-line bg-surface-2 px-3">
          <span className="min-w-0 truncate text-[14px] font-medium text-content-1">{value.vendorName || "Selected vendor"}</span>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange({ vendorId: null, vendorName: "", partyName: "" })}
            aria-label={`Clear vendor ${value.vendorName}`}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-content-3 hover:bg-surface-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="relative mt-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-4" aria-hidden />
          <input
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-labelledby={`${id}-label`}
            aria-activedescendant={open && vendors[active] ? `${listId}-${active}` : undefined}
            aria-invalid={Boolean(error) || undefined}
            aria-describedby={error ? errorId : undefined}
            value={query}
            disabled={disabled}
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setOpen(true);
                setActive((i) => Math.min(i + 1, Math.max(vendors.length - 1, 0)));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              } else if (event.key === "Enter" && open && vendors[active]) {
                event.preventDefault();
                choose(vendors[active]);
              } else if (event.key === "Escape") {
                setOpen(false);
              }
            }}
            placeholder="Search vendor name or code"
            className={cn(fieldClass, "pl-9")}
          />
          {open ? (
            <ul id={listId} role="listbox" className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-line bg-surface-1 py-1 shadow-lg">
              {search.isLoading ? (
                <li className="flex items-center gap-2 px-3 py-2 text-[13px] text-content-3">
                  <Loader2 className="h-4 w-4 animate-spin" /> Searching vendors…
                </li>
              ) : search.isError ? (
                <li className="px-3 py-2 text-[13px] text-danger-fg">Could not search vendors. {gateErrorMessage(search.error)}</li>
              ) : vendors.length ? (
                vendors.map((vendor, index) => (
                  <li
                    key={vendor.id}
                    id={`${listId}-${index}`}
                    role="option"
                    aria-selected={index === active}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(vendor)}
                    onMouseEnter={() => setActive(index)}
                    className={cn("flex min-h-[40px] cursor-pointer items-center justify-between gap-2 px-3 text-[13px]", index === active ? "bg-info-bg text-content-1" : "text-content-2")}
                  >
                    <span className="min-w-0 truncate">{vendor.name}</span>
                    <span className="shrink-0 font-mono text-[11px] text-content-4">{vendor.code}</span>
                  </li>
                ))
              ) : (
                <li className="px-3 py-2 text-[13px] text-content-3">
                  No active vendor matches.{allowParty ? " Use “Party not in master” for a one-off party." : ""}
                </li>
              )}
            </ul>
          ) : null}
        </div>
      )}
      <FieldError id={errorId} message={error} />
    </div>
  );
}

export function SelectedCheck({ on }: { on: boolean }) {
  return on ? <Check className="h-4 w-4 text-success-fg" aria-hidden /> : null;
}

export function permissionStatus(error: unknown) {
  return getApiErrorStatus(error);
}

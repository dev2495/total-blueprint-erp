"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Loader2, PackageSearch } from "lucide-react";

import {
  quotationService,
  type InventoryMaterialOption,
} from "@/services/quotation";
import { cn } from "@/lib/utils";

interface MaterialPickerProps {
  categories: string[]; // e.g. ["FILM_FAMILY", "FILM_VARIANT"]
  value?: { id?: string; code?: string; name?: string } | null;
  placeholder?: string;
  onSelect: (mat: InventoryMaterialOption) => void;
  compact?: boolean;
}

function inr(n: number | undefined | null): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n);
}

export default function MaterialPicker({
  categories,
  value,
  placeholder = "Pick material",
  onSelect,
  compact = false,
}: MaterialPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);

  const categoryParam = useMemo(() => categories.join(","), [categories]);
  const updateMenuPosition = useCallback(() => {
    const button = buttonRef.current;
    if (!button || typeof window === "undefined") return;
    const rect = button.getBoundingClientRect();
    const desiredWidth = Math.max(360, rect.width);
    const width = Math.min(desiredWidth, window.innerWidth - 24);
    const left = Math.min(
      Math.max(12, rect.left),
      Math.max(12, window.innerWidth - width - 12),
    );
    const spaceBelow = window.innerHeight - rect.bottom - 12;
    const spaceAbove = rect.top - 12;
    const openBelow = spaceBelow >= 260 || spaceBelow >= spaceAbove;
    const maxHeight = Math.max(
      220,
      Math.min(360, openBelow ? spaceBelow : spaceAbove),
    );
    const top = openBelow
      ? Math.min(rect.bottom + 6, window.innerHeight - maxHeight - 12)
      : Math.max(12, rect.top - maxHeight - 6);
    setMenuStyle({
      position: "fixed",
      top,
      left,
      width,
      maxHeight,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    updateMenuPosition();
    const onMove = () => updateMenuPosition();
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open, updateMenuPosition]);

  const matQuery = useQuery({
    queryKey: ["material-picker", categoryParam, search],
    queryFn: () =>
      quotationService.lookupMaterials({
        category: categoryParam,
        search: search || undefined,
        page_size: 30,
      }),
    enabled: open,
    staleTime: 15_000,
  });

  const label =
    value?.code && value?.name
      ? `${value.code} · ${value.name}`
      : value?.name || placeholder;

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "w-full inline-flex items-center justify-between gap-2 rounded-lg border border-line px-2 text-left text-sm font-bold text-content-1 hover:bg-surface-2 hover:border-order-border",
          compact ? "h-9 text-[12px]" : "h-10",
        )}
      >
        <span className="inline-flex items-center gap-2 truncate">
          <PackageSearch
            className="h-3.5 w-3.5 text-order-fg shrink-0"
            strokeWidth={2.5}
          />
          <span className="truncate">{label}</span>
        </span>
        <ChevronsUpDown className="h-3.5 w-3.5 text-content-4" />
      </button>
      {open && typeof document !== "undefined" ? createPortal(
        <>
          <div
            className="fixed inset-0 z-[80]"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            style={menuStyle || undefined}
            className="z-[90] overflow-hidden rounded-xl border border-line bg-surface-1 shadow-2xl"
          >
            <div className="border-b border-line px-3 py-2">
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by code or name…"
                className="h-8 w-full rounded-md bg-surface-1 px-2 text-sm font-semibold text-content-1 placeholder:text-content-4 outline-none focus:bg-surface-2"
              />
            </div>
            <div className="max-h-72 overflow-y-auto">
              {matQuery.isLoading ? (
                <div className="px-3 py-6 text-center text-[11px] font-extrabold uppercase tracking-widest text-content-4">
                  <Loader2 className="h-4 w-4 mx-auto animate-spin" />
                </div>
              ) : (matQuery.data || []).length === 0 ? (
                <div className="px-3 py-4 text-[11px] font-bold text-content-4">
                  No materials match.
                </div>
              ) : (
                (matQuery.data || []).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => {
                      onSelect(m);
                      setOpen(false);
                      setSearch("");
                    }}
                    className={cn(
                      "w-full px-3 py-2 text-left hover:bg-order-bg flex items-start gap-2",
                      value?.id === m.id ? "bg-order-bg" : "",
                    )}
                  >
                    <Check
                      className={cn(
                        "h-3.5 w-3.5 mt-1",
                        value?.id === m.id
                          ? "text-order-fg"
                          : "text-transparent",
                      )}
                      strokeWidth={3}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[11px] font-extrabold text-content-3">
                          {m.code}
                        </span>
                        <span className="text-[9px] font-extrabold uppercase tracking-widest text-order-fg bg-order-bg px-1.5 rounded">
                          {m.category_display || m.category}
                        </span>
                        {m.substitutes_count && m.substitutes_count > 0 ? (
                          <span className="text-[9px] font-extrabold uppercase tracking-widest text-warning-fg bg-warning-bg px-1.5 rounded">
                            {m.substitutes_count} subs
                          </span>
                        ) : null}
                      </div>
                      <div className="text-sm font-bold text-content-1 truncate">
                        {m.name}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[10px] font-bold text-content-3 font-mono">
                        <span>
                          ₹ {inr(m.avg_cost)}/{m.base_uom}
                        </span>
                        {m.density_gcm3 ? (
                          <span>· ρ {m.density_gcm3}</span>
                        ) : null}
                        {m.stock_qty !== undefined ? (
                          <span className="ml-auto">
                            stock {inr(m.stock_qty)}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </>
      , document.body) : null}
    </div>
  );
}

"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Loader2, PackageSearch } from "lucide-react";

import {
  quotationService,
  type ProductMasterSize,
  type ProductMasterSummary,
  type ProductVariantSummary,
} from "@/services/quotation";
import { cn } from "@/lib/utils";

export interface CatalogPickerSelection {
  product_master_id: string;
  product_master_code: string;
  product_master_name: string;
  size_id?: string | null;
  size_code?: string | null;
  size_label?: string | null;
  pouch_style_id?: string | null;
  pouch_style_code?: string | null;
  pouch_style_roll_axis?: string | null;
  stock_form?: string | null;
  width_basis?: string | null;
  film_area_width_mm?: number | null;
  child_target_width_mm?: number | null;
  width_mm?: number | null;
  height_mm?: number | null;
  gusset_mm?: number | null;
  flap_mm?: number | null;
  qty_uom?: string | null;
  product_variant_id?: string | null;
  product_variant_code?: string | null;
  variant_geometry?: Record<string, unknown> | null;
  variant_layers?: ProductVariantSummary["layer_snapshot"];
  variant_spec?: ProductVariantSummary["spec_snapshot"] | null;
}

interface CatalogLinePickerProps {
  valuePmId?: string | null;
  valuePmCode?: string | null;
  valuePmName?: string | null;
  valueSizeId?: string | null;
  valueVariantId?: string | null;
  showReadyVariants?: boolean;
  title?: string;
  helper?: string;
  sizeTitle?: string;
  sizeHelper?: string;
  currentOnly?: boolean;
  onChange: (selection: CatalogPickerSelection | null) => void;
}

export default function CatalogLinePicker({
  valuePmId,
  valuePmCode,
  valuePmName,
  valueSizeId,
  valueVariantId,
  showReadyVariants = false,
  title = "Product Master",
  helper,
  sizeTitle = "Size",
  sizeHelper,
  currentOnly = true,
  onChange,
}: CatalogLinePickerProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [readySearch, setReadySearch] = useState("");
  const deferredReadySearch = useDeferredValue(readySearch);
  const [pmOpen, setPmOpen] = useState(false);
  const pmButtonRef = useRef<HTMLButtonElement | null>(null);
  const [pmMenuStyle, setPmMenuStyle] = useState<CSSProperties | null>(null);
  const updatePmMenuPosition = useCallback(() => {
    const button = pmButtonRef.current;
    if (!button || typeof window === "undefined") return;
    const rect = button.getBoundingClientRect();
    const desiredWidth = Math.max(520, rect.width);
    const width = Math.min(desiredWidth, window.innerWidth - 24);
    const left = Math.min(
      Math.max(12, rect.left),
      Math.max(12, window.innerWidth - width - 12),
    );
    const spaceBelow = window.innerHeight - rect.bottom - 12;
    const spaceAbove = rect.top - 12;
    const openBelow = spaceBelow >= 300 || spaceBelow >= spaceAbove;
    const maxHeight = Math.max(
      260,
      Math.min(420, openBelow ? spaceBelow : spaceAbove),
    );
    const top = openBelow
      ? Math.min(rect.bottom + 8, window.innerHeight - maxHeight - 12)
      : Math.max(12, rect.top - maxHeight - 8);
    setPmMenuStyle({
      position: "fixed",
      top,
      left,
      width,
      maxHeight,
    });
  }, []);

  useEffect(() => {
    if (!pmOpen) return;
    updatePmMenuPosition();
    const onMove = () => updatePmMenuPosition();
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [pmOpen, updatePmMenuPosition]);

  const pmQuery = useQuery({
    queryKey: ["product-masters", searchTerm, currentOnly],
    queryFn: () =>
      quotationService.listProductMasters({
        q: searchTerm || undefined,
        current_only: currentOnly,
      }),
    staleTime: 30_000,
  });

  const sizeQuery = useQuery({
    queryKey: ["product-master-sizes", valuePmId, deferredReadySearch],
    queryFn: () =>
      valuePmId
        ? quotationService.listProductMasterSizes(valuePmId, deferredReadySearch)
        : Promise.resolve<ProductMasterSize[]>([]),
    enabled: Boolean(valuePmId),
  });

  const variantQuery = useQuery({
    queryKey: ["product-master-variants", valuePmId, deferredReadySearch],
    queryFn: () =>
      valuePmId
        ? quotationService.listProductMasterVariants(valuePmId, deferredReadySearch)
        : Promise.resolve<ProductVariantSummary[]>([]),
    enabled: Boolean(valuePmId && showReadyVariants),
  });

  const sizes = useMemo(() => sizeQuery.data || [], [sizeQuery.data]);

  const handleSelectPm = (pm: ProductMasterSummary) => {
    onChange({
      product_master_id: pm.id,
      product_master_code: pm.code,
      product_master_name: pm.name,
      size_id: null,
      size_code: null,
      size_label: null,
      width_mm: null,
      height_mm: null,
      gusset_mm: null,
      flap_mm: null,
      qty_uom: null,
      product_variant_id: null,
      product_variant_code: null,
      variant_geometry: null,
      variant_layers: [],
      variant_spec: null,
      pouch_style_id: null,
      pouch_style_code: null,
      pouch_style_roll_axis: null,
      stock_form: null,
      width_basis: null,
      film_area_width_mm: null,
      child_target_width_mm: null,
    });
    setPmOpen(false);
    setSearchTerm("");
  };

  const handleSelectSize = (size: ProductMasterSize) => {
    if (!valuePmId || !valuePmCode || !valuePmName) return;
    onChange({
      product_master_id: valuePmId,
      product_master_code: valuePmCode,
      product_master_name: valuePmName,
      size_id: size.id,
      size_code: size.code,
      size_label: size.label,
      pouch_style_id: size.pouch_style_master || size.pouch_style_id || null,
      pouch_style_code:
        size.pouch_style_master_code || size.pouch_style || null,
      pouch_style_roll_axis: size.pouch_style_roll_axis || null,
      stock_form: size.stock_form || null,
      width_basis: size.width_basis || null,
      film_area_width_mm: size.film_area_width_mm ?? null,
      child_target_width_mm: size.child_target_width_mm ?? null,
      width_mm: size.width_mm ?? null,
      height_mm: size.height_mm ?? null,
      gusset_mm: size.gusset_mm ?? null,
      flap_mm: size.flap_mm ?? null,
      qty_uom: size.qty_uom || null,
      product_variant_id: null,
      product_variant_code: null,
      variant_geometry: null,
      variant_layers: [],
      variant_spec: null,
    });
  };

  const handleSelectVariant = (variant: ProductVariantSummary) => {
    if (!valuePmId || !valuePmCode || !valuePmName) return;
    const geometry = variant.geometry_snapshot || {};
    onChange({
      product_master_id: valuePmId,
      product_master_code: valuePmCode,
      product_master_name: valuePmName,
      product_variant_id: variant.id,
      product_variant_code: variant.code,
      variant_geometry: geometry,
      variant_layers: variant.layer_snapshot || [],
      variant_spec: variant.spec_snapshot || null,
      size_id: null,
      size_code: null,
      size_label: null,
      width_mm: Number(geometry.width_mm || 0) || null,
      height_mm: Number(geometry.height_mm || 0) || null,
      gusset_mm: Number(geometry.gusset_mm || 0) || null,
      flap_mm: Number(geometry.flap_mm || 0) || null,
      pouch_style_id: String(geometry.pouch_style_id || "") || null,
      pouch_style_code: String(geometry.pouch_style_code || "") || null,
      pouch_style_roll_axis: String(geometry.pouch_style_roll_axis || "") || null,
      stock_form: String(geometry.stock_form || "") || null,
      width_basis: String(geometry.width_basis || "") || null,
      film_area_width_mm: Number(geometry.film_area_width_mm || 0) || null,
      child_target_width_mm: Number(geometry.child_web_width_mm || geometry.child_target_width_mm || 0) || null,
      qty_uom: String((variant.axis_values || {}).qty_uom || "") || null,
    });
  };

  const pmLabel =
    valuePmCode && valuePmName
      ? `${valuePmCode} · ${valuePmName}`
      : "Pick product master";
  const productMasters = pmQuery.data || [];

  const fmtStyle = (value?: string | null) =>
    String(value || "")
      .replace(/_/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toUpperCase();

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-line p-3">
        <div className="text-[10px] font-extrabold uppercase tracking-widest text-content-3 mb-2">
          {title}
        </div>
        {helper ? (
          <div className="mb-2 text-[11px] font-semibold text-content-3">
            {helper}
          </div>
        ) : null}
        <button
          ref={pmButtonRef}
          type="button"
          onClick={() => setPmOpen((v) => !v)}
          className="h-10 w-full inline-flex items-center justify-between gap-2 rounded-lg border border-line px-3 text-sm font-bold text-content-1 hover:bg-surface-2"
        >
          <span className="inline-flex items-center gap-2 truncate">
            <PackageSearch className="h-4 w-4 text-order-fg" />
            <span className="truncate">{pmLabel}</span>
          </span>
          <ChevronsUpDown className="h-4 w-4 text-content-4" />
        </button>
        {pmOpen && typeof document !== "undefined" ? createPortal(
          <>
          <div
            className="fixed inset-0 z-[80]"
            onClick={() => setPmOpen(false)}
            aria-hidden="true"
          />
          <div
            style={pmMenuStyle || undefined}
            className="z-[90] overflow-hidden rounded-xl border border-line bg-surface-1 shadow-2xl"
          >
            <div className="border-b border-line px-3 py-2">
              <input
                autoFocus
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setPmOpen(false);
                    return;
                  }
                  if (event.key === "Enter") {
                    const firstCurrent = productMasters.find(
                      (pm) => pm.is_current_version !== false && !pm.superseded_by,
                    );
                    if (firstCurrent) {
                      event.preventDefault();
                      handleSelectPm(firstCurrent);
                    }
                  }
                }}
                aria-label="Search Product Master"
                placeholder="Search by code or name…"
                className="h-8 w-full rounded-md bg-surface-1 px-2 text-sm font-semibold text-content-1 placeholder:text-content-4 outline-none focus:bg-surface-2"
              />
            </div>
            <div className="max-h-64 overflow-y-auto">
              {pmQuery.isLoading ? (
                <div className="px-3 py-4 text-center text-[11px] font-extrabold uppercase tracking-widest text-content-4">
                  <Loader2 className="h-4 w-4 mx-auto animate-spin" />
                </div>
              ) : productMasters.length === 0 ? (
                <div className="px-3 py-3 text-[11px] font-bold text-content-4">
                  No product masters match.
                </div>
              ) : (
                productMasters.map((pm) => {
                  const isCurrent = pm.is_current_version !== false && !pm.superseded_by;
                  return (
                    <button
                      key={pm.id}
                      type="button"
                      disabled={!isCurrent}
                      onClick={() => {
                        if (isCurrent) handleSelectPm(pm);
                      }}
                      title={
                        isCurrent
                          ? "Select current Product Master"
                          : "This Product Master is no longer active for new quotes."
                      }
                      className={cn(
                        "w-full px-3 py-2 text-left text-sm font-semibold flex items-center gap-2",
                        isCurrent
                          ? "hover:bg-order-bg"
                          : "opacity-55 cursor-not-allowed bg-surface-2",
                        valuePmId === pm.id ? "bg-order-bg" : "",
                      )}
                    >
                      <Check
                        className={cn(
                          "h-3.5 w-3.5",
                          valuePmId === pm.id
                            ? "text-order-fg"
                            : "text-transparent",
                        )}
                        strokeWidth={3}
                      />
                      <span className="font-mono text-[11px] font-extrabold text-content-3 mr-2">
                        {pm.code}
                      </span>
                      <span className="truncate">{pm.name}</span>
                      {!isCurrent ? (
                        <span className="ml-auto shrink-0 rounded-full bg-danger-bg px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-widest text-danger-fg ring-1 ring-danger-border">
                          inactive
                        </span>
                      ) : null}
                    </button>
                  );
                })
              )}
            </div>
          </div>
          </>,
          document.body,
        ) : null}
      </div>

      {valuePmId ? (
        <div className="rounded-xl border border-line p-3">
          <div className="text-[10px] font-extrabold uppercase tracking-widest text-content-3 mb-2">
            {sizeTitle}
          </div>
          {sizeHelper ? (
            <div className="mb-2 text-[11px] font-semibold text-content-3">
              {sizeHelper}
            </div>
          ) : null}
          <input
            value={readySearch}
            onChange={(event) => setReadySearch(event.target.value)}
            placeholder={showReadyVariants ? "Search ready variant or saved size…" : "Search saved size…"}
            aria-label="Search ready product configuration"
            className="mb-3 h-9 w-full rounded-lg border border-line bg-surface-1 px-3 text-xs font-semibold outline-none focus:border-order-border focus:ring-2 focus:ring-order-border"
          />
          {showReadyVariants && (variantQuery.data || []).length > 0 ? (
            <div className="mb-3">
              <div className="mb-2 text-[9px] font-extrabold uppercase tracking-widest text-success-fg">Fast queue · ready variants</div>
              <div className="grid max-h-48 grid-cols-1 gap-2 overflow-y-auto pr-1 md:grid-cols-2">
                {(variantQuery.data || []).map((variant) => (
                  <button
                    key={variant.id}
                    type="button"
                    onClick={() => handleSelectVariant(variant)}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-left transition-colors",
                      valueVariantId === variant.id
                        ? "border-success-border bg-success-bg"
                        : "border-line hover:border-success-border hover:bg-success-bg",
                    )}
                  >
                    <div className="font-mono text-[11px] font-extrabold text-content-1">{variant.code}</div>
                    <div className="mt-1 text-[10px] font-semibold text-content-3">
                      {Number(variant.geometry_snapshot?.width_mm || 0) > 0
                        ? `${Number(variant.geometry_snapshot?.width_mm).toFixed(0)}×${Number(variant.geometry_snapshot?.height_mm || 0).toFixed(0)} mm`
                        : `${(variant.layer_snapshot || []).length} BOM layers`}
                    </div>
                  </button>
                ))}
              </div>
              <div className="my-3 border-t border-line" />
              <div className="mb-2 text-[9px] font-extrabold uppercase tracking-widest text-content-4">Saved sizes</div>
            </div>
          ) : null}
          {sizeQuery.isLoading ? (
            <div className="text-[11px] font-bold text-content-4">
              Loading sizes…
            </div>
          ) : sizes.length === 0 ? (
            <div className="text-[11px] font-bold text-content-4">
              No sizes configured for this product yet.
            </div>
          ) : (
            <div className="max-h-72 overflow-y-auto pr-1">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {sizes.map((size) => {
                  const selected = valueSizeId === size.id;
                  const style =
                    fmtStyle(size.pouch_style_master_code) ||
                    fmtStyle(size.pouch_style) ||
                    "POUCH STYLE";
                  const childWeb = Number(size.child_target_width_mm || 0);
                  const filmArea = Number(size.film_area_width_mm || 0);
                  return (
                    <button
                      key={size.id}
                      type="button"
                      onClick={() => handleSelectSize(size)}
                      className={cn(
                        "h-auto px-3 py-2 rounded-lg border text-left text-xs font-bold transition-colors",
                        selected
                          ? "border-order-border bg-order-bg text-order-fg"
                          : "border-line hover:border-order-border hover:bg-order-bg",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[11px] text-content-3 truncate">
                          {size.code}
                        </span>
                        <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-widest text-content-3 ring-1 ring-line">
                          {style}
                        </span>
                      </div>
                      <div className="mt-1 truncate text-content-1">
                        {size.label}
                      </div>
                      {size.width_mm && size.height_mm ? (
                        <div className="mt-1 font-mono text-[10px] text-content-3">
                          {Number(size.width_mm).toFixed(0)}×
                          {Number(size.height_mm).toFixed(0)}
                          {size.gusset_mm
                            ? ` · g${Number(size.gusset_mm).toFixed(0)}`
                            : ""}
                          {size.flap_mm
                            ? ` · f${Number(size.flap_mm).toFixed(0)}`
                            : ""}
                        </div>
                      ) : null}
                      <div className="mt-1 flex flex-wrap gap-1 text-[9px] font-extrabold uppercase tracking-wider text-content-3">
                        {childWeb > 0 ? (
                          <span className="rounded bg-info-bg px-1.5 py-0.5 text-info-fg ring-1 ring-info-border">
                            child {childWeb.toFixed(0)} mm
                          </span>
                        ) : null}
                        {filmArea > 0 && Math.abs(filmArea - childWeb) > 0.5 ? (
                          <span className="rounded bg-order-bg px-1.5 py-0.5 text-order-fg ring-1 ring-order-border">
                            film {filmArea.toFixed(0)} mm
                          </span>
                        ) : null}
                        {size.stock_form ? (
                          <span className="rounded bg-success-bg px-1.5 py-0.5 text-success-fg ring-1 ring-success-border">
                            {fmtStyle(size.stock_form)}
                          </span>
                        ) : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

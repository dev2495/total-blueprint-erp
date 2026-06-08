"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Loader2, PackageSearch } from "lucide-react";

import {
  quotationService,
  type ProductMasterSize,
  type ProductMasterSummary,
} from "@/services/quotation";
import { cn } from "@/lib/utils";

export interface CatalogPickerSelection {
  product_master_id: string;
  product_master_code: string;
  product_master_name: string;
  size_id?: string | null;
  size_code?: string | null;
  size_label?: string | null;
  width_mm?: number | null;
  height_mm?: number | null;
  gusset_mm?: number | null;
  qty_uom?: string | null;
}

interface CatalogLinePickerProps {
  valuePmId?: string | null;
  valuePmCode?: string | null;
  valuePmName?: string | null;
  valueSizeId?: string | null;
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
  title = "Product Master",
  helper,
  sizeTitle = "Size",
  sizeHelper,
  currentOnly = true,
  onChange,
}: CatalogLinePickerProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [pmOpen, setPmOpen] = useState(false);

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
    queryKey: ["product-master-sizes", valuePmId],
    queryFn: () =>
      valuePmId
        ? quotationService.listProductMasterSizes(valuePmId)
        : Promise.resolve<ProductMasterSize[]>([]),
    enabled: Boolean(valuePmId),
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
      qty_uom: null,
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
      width_mm: size.width_mm ?? null,
      height_mm: size.height_mm ?? null,
      gusset_mm: size.gusset_mm ?? null,
      qty_uom: size.qty_uom || null,
    });
  };

  const pmLabel =
    valuePmCode && valuePmName
      ? `${valuePmCode} · ${valuePmName}`
      : "Pick product master";
  const productMasters = pmQuery.data || [];

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
        {pmOpen ? (
          <div className="mt-2 rounded-lg border border-line bg-surface-1 shadow-sm">
            <div className="border-b border-line px-3 py-2">
              <input
                autoFocus
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search by code or name…"
                className="h-8 w-full text-sm font-semibold outline-none"
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
                          : "Old Product Master version. Create quotes only from the current version."
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
                          old version
                        </span>
                      ) : pm.version && pm.version > 1 ? (
                        <span className="ml-auto shrink-0 rounded-full bg-success-bg px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-widest text-success-fg ring-1 ring-success-border">
                          v{pm.version}
                        </span>
                      ) : null}
                    </button>
                  );
                })
              )}
            </div>
          </div>
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
          {sizeQuery.isLoading ? (
            <div className="text-[11px] font-bold text-content-4">
              Loading sizes…
            </div>
          ) : sizes.length === 0 ? (
            <div className="text-[11px] font-bold text-content-4">
              No sizes configured for this product yet.
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {sizes.map((size) => {
                const selected = valueSizeId === size.id;
                return (
                  <button
                    key={size.id}
                    type="button"
                    onClick={() => handleSelectSize(size)}
                    className={cn(
                      "h-auto px-3 py-2 rounded-lg border text-left text-xs font-bold",
                      selected
                        ? "border-order-border bg-order-bg text-order-fg"
                        : "border-line hover:border-order-border hover:bg-order-bg",
                    )}
                  >
                    <div className="font-mono text-[11px] text-content-3">
                      {size.code}
                    </div>
                    <div className="truncate">{size.label}</div>
                    {size.width_mm && size.height_mm ? (
                      <div className="mt-1 font-mono text-[10px] text-content-3">
                        {Number(size.width_mm).toFixed(0)}×
                        {Number(size.height_mm).toFixed(0)}
                        {size.gusset_mm
                          ? ` ·g${Number(size.gusset_mm).toFixed(0)}`
                          : ""}
                      </div>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

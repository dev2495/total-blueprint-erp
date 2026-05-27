"use client"

import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Check, ChevronsUpDown, Loader2, PackageSearch } from "lucide-react"

import {
    quotationService,
    type ProductMasterSize,
    type ProductMasterSummary,
} from "@/services/quotation"
import { cn } from "@/lib/utils"

export interface CatalogPickerSelection {
    product_master_id: string
    product_master_code: string
    product_master_name: string
    size_id?: string | null
    size_code?: string | null
    size_label?: string | null
    width_mm?: number | null
    height_mm?: number | null
    gusset_mm?: number | null
    qty_uom?: string | null
}

interface CatalogLinePickerProps {
    valuePmId?: string | null
    valuePmCode?: string | null
    valuePmName?: string | null
    valueSizeId?: string | null
    onChange: (selection: CatalogPickerSelection | null) => void
}

export default function CatalogLinePicker({
    valuePmId,
    valuePmCode,
    valuePmName,
    valueSizeId,
    onChange,
}: CatalogLinePickerProps) {
    const [searchTerm, setSearchTerm] = useState("")
    const [pmOpen, setPmOpen] = useState(false)

    const pmQuery = useQuery({
        queryKey: ["product-masters", searchTerm],
        queryFn: () => quotationService.listProductMasters({ q: searchTerm || undefined }),
        staleTime: 30_000,
    })

    const sizeQuery = useQuery({
        queryKey: ["product-master-sizes", valuePmId],
        queryFn: () =>
            valuePmId
                ? quotationService.listProductMasterSizes(valuePmId)
                : Promise.resolve<ProductMasterSize[]>([]),
        enabled: Boolean(valuePmId),
    })

    const sizes = useMemo(() => sizeQuery.data || [], [sizeQuery.data])

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
        })
        setPmOpen(false)
        setSearchTerm("")
    }

    const handleSelectSize = (size: ProductMasterSize) => {
        if (!valuePmId || !valuePmCode || !valuePmName) return
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
        })
    }

    const pmLabel = valuePmCode && valuePmName ? `${valuePmCode} · ${valuePmName}` : "Pick product master"

    return (
        <div className="space-y-3">
            <div className="rounded-xl border border-slate-200 p-3">
                <div className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500 mb-2">
                    Product Master
                </div>
                <button
                    type="button"
                    onClick={() => setPmOpen((v) => !v)}
                    className="h-10 w-full inline-flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 text-sm font-bold text-slate-900 hover:bg-slate-50"
                >
                    <span className="inline-flex items-center gap-2 truncate">
                        <PackageSearch className="h-4 w-4 text-indigo-500" />
                        <span className="truncate">{pmLabel}</span>
                    </span>
                    <ChevronsUpDown className="h-4 w-4 text-slate-400" />
                </button>
                {pmOpen ? (
                    <div className="mt-2 rounded-lg border border-slate-200 bg-white shadow-sm">
                        <div className="border-b border-slate-100 px-3 py-2">
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
                                <div className="px-3 py-4 text-center text-[11px] font-extrabold uppercase tracking-widest text-slate-400">
                                    <Loader2 className="h-4 w-4 mx-auto animate-spin" />
                                </div>
                            ) : (pmQuery.data || []).length === 0 ? (
                                <div className="px-3 py-3 text-[11px] font-bold text-slate-400">
                                    No product masters match.
                                </div>
                            ) : (
                                (pmQuery.data || []).map((pm) => (
                                    <button
                                        key={pm.id}
                                        type="button"
                                        onClick={() => handleSelectPm(pm)}
                                        className={cn(
                                            "w-full px-3 py-2 text-left text-sm font-semibold hover:bg-indigo-50/60 flex items-center gap-2",
                                            valuePmId === pm.id ? "bg-indigo-50" : "",
                                        )}
                                    >
                                        <Check
                                            className={cn(
                                                "h-3.5 w-3.5",
                                                valuePmId === pm.id ? "text-indigo-600" : "text-transparent",
                                            )}
                                            strokeWidth={3}
                                        />
                                        <span className="font-mono text-[11px] font-extrabold text-slate-500 mr-2">
                                            {pm.code}
                                        </span>
                                        <span className="truncate">{pm.name}</span>
                                    </button>
                                ))
                            )}
                        </div>
                    </div>
                ) : null}
            </div>

            {valuePmId ? (
                <div className="rounded-xl border border-slate-200 p-3">
                    <div className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500 mb-2">
                        Size
                    </div>
                    {sizeQuery.isLoading ? (
                        <div className="text-[11px] font-bold text-slate-400">Loading sizes…</div>
                    ) : sizes.length === 0 ? (
                        <div className="text-[11px] font-bold text-slate-400">
                            No sizes configured for this product yet.
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                            {sizes.map((size) => {
                                const selected = valueSizeId === size.id
                                return (
                                    <button
                                        key={size.id}
                                        type="button"
                                        onClick={() => handleSelectSize(size)}
                                        className={cn(
                                            "h-auto px-3 py-2 rounded-lg border text-left text-xs font-bold",
                                            selected
                                                ? "border-indigo-400 bg-indigo-50 text-indigo-800"
                                                : "border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/40",
                                        )}
                                    >
                                        <div className="font-mono text-[11px] text-slate-500">{size.code}</div>
                                        <div className="truncate">{size.label}</div>
                                        {size.width_mm && size.height_mm ? (
                                            <div className="mt-1 font-mono text-[10px] text-slate-500">
                                                {Number(size.width_mm).toFixed(0)}×{Number(size.height_mm).toFixed(0)}
                                                {size.gusset_mm ? ` ·g${Number(size.gusset_mm).toFixed(0)}` : ""}
                                            </div>
                                        ) : null}
                                    </button>
                                )
                            })}
                        </div>
                    )}
                </div>
            ) : null}
        </div>
    )
}

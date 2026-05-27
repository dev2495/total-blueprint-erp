"use client"

import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Check, ChevronsUpDown, Loader2, PackageSearch } from "lucide-react"

import { quotationService, type InventoryMaterialOption } from "@/services/quotation"
import { cn } from "@/lib/utils"

interface MaterialPickerProps {
    categories: string[] // e.g. ["FILM_FAMILY", "FILM_VARIANT"]
    value?: { id?: string; code?: string; name?: string } | null
    placeholder?: string
    onSelect: (mat: InventoryMaterialOption) => void
    compact?: boolean
}

function inr(n: number | undefined | null): string {
    if (n === undefined || n === null || !Number.isFinite(n)) return "—"
    return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(n)
}

export default function MaterialPicker({
    categories,
    value,
    placeholder = "Pick material",
    onSelect,
    compact = false,
}: MaterialPickerProps) {
    const [open, setOpen] = useState(false)
    const [search, setSearch] = useState("")

    const categoryParam = useMemo(() => categories.join(","), [categories])

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
    })

    const label = value?.code && value?.name ? `${value.code} · ${value.name}` : value?.name || placeholder

    return (
        <div className="relative">
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className={cn(
                    "w-full inline-flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-2 text-left text-sm font-bold text-slate-900 hover:bg-slate-50 hover:border-indigo-300",
                    compact ? "h-9 text-[12px]" : "h-10",
                )}
            >
                <span className="inline-flex items-center gap-2 truncate">
                    <PackageSearch className="h-3.5 w-3.5 text-indigo-500 shrink-0" strokeWidth={2.5} />
                    <span className="truncate">{label}</span>
                </span>
                <ChevronsUpDown className="h-3.5 w-3.5 text-slate-400" />
            </button>
            {open ? (
                <>
                    <div
                        className="fixed inset-0 z-10"
                        onClick={() => setOpen(false)}
                        aria-hidden="true"
                    />
                    <div className="absolute z-20 mt-1 w-[360px] max-w-[96vw] rounded-xl border border-slate-200 bg-white shadow-xl">
                        <div className="border-b border-slate-100 px-3 py-2">
                            <input
                                autoFocus
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                placeholder="Search by code or name…"
                                className="h-8 w-full text-sm font-semibold outline-none"
                            />
                        </div>
                        <div className="max-h-72 overflow-y-auto">
                            {matQuery.isLoading ? (
                                <div className="px-3 py-6 text-center text-[11px] font-extrabold uppercase tracking-widest text-slate-400">
                                    <Loader2 className="h-4 w-4 mx-auto animate-spin" />
                                </div>
                            ) : (matQuery.data || []).length === 0 ? (
                                <div className="px-3 py-4 text-[11px] font-bold text-slate-400">
                                    No materials match.
                                </div>
                            ) : (
                                (matQuery.data || []).map((m) => (
                                    <button
                                        key={m.id}
                                        type="button"
                                        onClick={() => {
                                            onSelect(m)
                                            setOpen(false)
                                            setSearch("")
                                        }}
                                        className={cn(
                                            "w-full px-3 py-2 text-left hover:bg-indigo-50/60 flex items-start gap-2",
                                            value?.id === m.id ? "bg-indigo-50" : "",
                                        )}
                                    >
                                        <Check
                                            className={cn(
                                                "h-3.5 w-3.5 mt-1",
                                                value?.id === m.id ? "text-indigo-600" : "text-transparent",
                                            )}
                                            strokeWidth={3}
                                        />
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center gap-2">
                                                <span className="font-mono text-[11px] font-extrabold text-slate-500">
                                                    {m.code}
                                                </span>
                                                <span className="text-[9px] font-extrabold uppercase tracking-widest text-violet-600 bg-violet-50 px-1.5 rounded">
                                                    {m.category_display || m.category}
                                                </span>
                                                {m.substitutes_count && m.substitutes_count > 0 ? (
                                                    <span className="text-[9px] font-extrabold uppercase tracking-widest text-amber-600 bg-amber-50 px-1.5 rounded">
                                                        {m.substitutes_count} subs
                                                    </span>
                                                ) : null}
                                            </div>
                                            <div className="text-sm font-bold text-slate-900 truncate">
                                                {m.name}
                                            </div>
                                            <div className="mt-0.5 flex items-center gap-2 text-[10px] font-bold text-slate-500 font-mono">
                                                <span>₹ {inr(m.avg_cost)}/{m.base_uom}</span>
                                                {m.density_gcm3 ? <span>· ρ {m.density_gcm3}</span> : null}
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
            ) : null}
        </div>
    )
}

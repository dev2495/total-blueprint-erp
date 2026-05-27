"use client"

import { useEffect } from "react"
import { useMutation } from "@tanstack/react-query"
import { CheckCircle2, Factory, Loader2, ShieldAlert, Timer, Layers } from "lucide-react"
import {
    quotationService,
    type ProductionPreviewResult,
    type QuoteLineSpec,
} from "@/services/quotation"

interface ProductionPreviewCardProps {
    spec: QuoteLineSpec
    plantId?: string
    qty: number
    qtyUom: "KG" | "PCS"
}

function inr(v: number | undefined | null): string {
    if (v === undefined || v === null || !Number.isFinite(v)) return "—"
    return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(v)
}

export default function ProductionPreviewCard({
    spec,
    plantId,
    qty,
    qtyUom,
}: ProductionPreviewCardProps) {
    const previewMut = useMutation<ProductionPreviewResult>({
        mutationFn: () =>
            quotationService.productionPreview({
                spec,
                plant_id: plantId,
                qty,
                qty_uom: qtyUom,
            }),
    })

    // Re-fire on key changes (spec/qty)
    const key = JSON.stringify({
        w: spec.width_mm,
        h: spec.height_mm,
        g: spec.gusset_mm,
        layers: (spec.layers || []).map((l) => `${l.material_id}:${l.gsm}`).join(","),
        qty,
        qtyUom,
        plant: plantId,
    })
    useEffect(() => {
        if (!spec.width_mm || !spec.height_mm) return
        const t = setTimeout(() => previewMut.mutate(), 350)
        return () => clearTimeout(t)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key])

    const data = previewMut.data

    if (!data && !previewMut.isPending) {
        return (
            <div className="rounded-xl border border-dashed border-slate-300 p-4 bg-slate-50/40">
                <div className="flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-widest text-slate-500">
                    <Factory className="h-3.5 w-3.5" />
                    Production preview
                </div>
                <p className="mt-2 text-[11px] font-bold text-slate-400">
                    Add geometry + at least one layer to estimate yields.
                </p>
            </div>
        )
    }

    return (
        <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-white to-sky-50/40 p-4 space-y-3">
            <div className="flex items-center gap-2">
                <Factory className="h-3.5 w-3.5 text-sky-600" />
                <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-600">
                    Production preview
                </span>
                {previewMut.isPending ? (
                    <Loader2 className="h-3 w-3 ml-auto animate-spin text-sky-500" />
                ) : null}
            </div>
            {data ? (
                <>
                    <div className="grid grid-cols-2 gap-2 text-[11px] font-bold text-slate-600">
                        <Cell icon={<Layers className="h-3 w-3" />} label="Pouches/parent roll" value={inr(data.pouches_per_parent_roll)} />
                        <Cell icon={<Layers className="h-3 w-3" />} label="Parent rolls" value={inr(data.parent_rolls_needed)} />
                        <Cell icon={<Timer className="h-3 w-3" />} label="Machine hrs" value={`${inr(data.machine_time_hrs)} h`} />
                        <Cell icon={<Layers className="h-3 w-3" />} label="Lanes" value={String(data.lanes_per_parent)} />
                        <Cell icon={<Layers className="h-3 w-3" />} label="Total kg" value={`${inr(data.total_kg)} kg`} />
                        <Cell icon={<Layers className="h-3 w-3" />} label="Wt / pouch" value={`${inr(data.weight_per_pouch_g)} g`} />
                    </div>
                    {data.material_availability.length > 0 ? (
                        <div className="border-t border-slate-100 pt-3 space-y-1">
                            <div className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500">
                                Material availability
                            </div>
                            {data.material_availability.map((row) => (
                                <div
                                    key={row.material_id}
                                    className="flex items-center justify-between gap-2 text-[11px] font-semibold"
                                >
                                    <span className="truncate min-w-0 flex items-center gap-1.5">
                                        {row.ok ? (
                                            <CheckCircle2 className="h-3 w-3 text-emerald-600 shrink-0" />
                                        ) : (
                                            <ShieldAlert className="h-3 w-3 text-rose-600 shrink-0" />
                                        )}
                                        <span className="font-mono text-[10px] text-slate-500">
                                            {row.material_code}
                                        </span>
                                        <span className="truncate text-slate-800">{row.material_name}</span>
                                    </span>
                                    <span className="font-mono text-slate-700 shrink-0">
                                        {inr(row.needed_kg)} / {inr(row.available_kg)} kg
                                    </span>
                                </div>
                            ))}
                        </div>
                    ) : null}
                    {data.note ? (
                        <div className="text-[10px] font-bold italic text-slate-400 border-t border-slate-100 pt-2">
                            {data.note}
                        </div>
                    ) : null}
                </>
            ) : (
                <div className="text-[11px] font-bold text-slate-400">Estimating…</div>
            )}
        </div>
    )
}

function Cell({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
    return (
        <div className="rounded-lg bg-white ring-1 ring-slate-200 px-2 py-1.5">
            <div className="flex items-center gap-1 text-[9px] font-extrabold uppercase tracking-widest text-slate-500">
                {icon}
                {label}
            </div>
            <div className="mt-0.5 font-mono text-sm font-extrabold text-slate-900">{value}</div>
        </div>
    )
}

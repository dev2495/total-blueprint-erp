"use client"

import * as React from "react"
import { Lock, Pencil } from "lucide-react"
import type { LayerTemplateRow } from "@/services/product-master"
import { cn } from "@/lib/utils"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"

export interface LayerRowState {
    role: string
    film_variant_code: string
    thickness_micron: number
    grade?: string
    width_mm?: number
}

interface AxisLayerMatrixProps {
    layers: LayerTemplateRow[]
    values: Record<number, LayerRowState>
    fallbackWidthMm?: number
    allowWidthOverride?: boolean
    showWidthColumn?: boolean
    onChange: (layerIndex: number, patch: Partial<LayerRowState>) => void
    className?: string
}

export function AxisLayerMatrix({
    layers,
    values,
    fallbackWidthMm,
    allowWidthOverride = false,
    showWidthColumn = true,
    onChange,
    className,
}: AxisLayerMatrixProps) {
    return (
        <div className={cn("overflow-hidden rounded-xl border border-slate-200", className)}>
            <table className="w-full text-sm">
                <thead className="bg-slate-50/80 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">
                    <tr>
                        <th className="px-4 py-3 text-left">Layer</th>
                        <th className="px-4 py-3 text-left">Film / material</th>
                        <th className="px-4 py-3 text-left">Thickness (micron)</th>
                        <th className="px-4 py-3 text-left">Grade</th>
                        {showWidthColumn ? <th className="px-4 py-3 text-left">Roll width</th> : null}
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                    {layers.map((row, idx) => {
                        const i = idx + 1
                        const state = values[i] || ({} as LayerRowState)
                        const lockedThickness = row.thickness_apportion === "fixed_um"
                        const thicknessOptions = Array.from(
                            new Set([...(row.thickness_options || []), row.thickness_micron].map(Number).filter((n) => Number.isFinite(n) && n > 0))
                        ).sort((a, b) => a - b)
                        const gradeOptions = (row.grade_options || []).length
                            ? row.grade_options || []
                            : row.default_grade
                              ? [row.default_grade]
                              : []
                        const widthFallback =
                            state.width_mm ?? row.default_input_roll_width_mm ?? fallbackWidthMm ?? 0
                        return (
                            <tr key={`${row.role}-${i}`} className="bg-white">
                                <td className="px-4 py-3 font-semibold text-slate-700">L{i}</td>
                                <td className="px-4 py-3">
                                    <div className="flex items-center gap-2">
                                        <span className="rounded-md bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700 ring-1 ring-blue-100">
                                            {row.film_variant_code}
                                        </span>
                                    </div>
                                </td>
                                <td className="px-4 py-3">
                                    {lockedThickness ? (
                                        <span className="inline-flex h-9 min-w-32 items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 font-mono text-sm font-semibold text-slate-700 ring-1 ring-slate-200">
                                            {row.thickness_micron} μ <Lock className="h-3 w-3 text-slate-400" />
                                        </span>
                                    ) : (
                                        <div className="space-y-1">
                                            <input
                                                type="number"
                                                min={0.1}
                                                step={0.1}
                                                value={state.thickness_micron ?? row.thickness_micron ?? ""}
                                                onChange={(e) => onChange(i, { thickness_micron: Number(e.target.value) })}
                                                className="h-9 w-36 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 focus:border-blue-400 focus:outline-none"
                                                list={`layer-${i}-thickness-options`}
                                            />
                                            {thicknessOptions.length ? (
                                                <datalist id={`layer-${i}-thickness-options`}>
                                                    {thicknessOptions.map((option) => (
                                                        <option key={option} value={option} />
                                                    ))}
                                                </datalist>
                                            ) : null}
                                            <div className="text-[10px] font-semibold text-slate-400">type micron</div>
                                        </div>
                                    )}
                                </td>
                                <td className="px-4 py-3">
                                    {gradeOptions.length > 0 ? (
                                        <Select
                                            value={state.grade ?? row.default_grade ?? ""}
                                            onValueChange={(value) => onChange(i, { grade: value })}
                                        >
                                            <SelectTrigger className="h-9 w-36 rounded-lg border-slate-200 bg-white text-sm">
                                                <SelectValue placeholder="Pick" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {gradeOptions.map((g) => (
                                                    <SelectItem key={g} value={g}>
                                                        {g}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    ) : (
                                        <span className="inline-flex items-center gap-1 rounded-md bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-500 ring-1 ring-slate-200">
                                            Not required
                                        </span>
                                    )}
                                </td>
                                {showWidthColumn ? (
                                    <td className="px-4 py-3">
                                        {allowWidthOverride ? (
                                            <div className="relative inline-flex h-9 w-32 items-center rounded-lg border border-slate-200 bg-white pr-2 transition hover:border-slate-300 focus-within:border-blue-400">
                                                <input
                                                    type="number"
                                                    min={0}
                                                    value={widthFallback}
                                                    onChange={(e) => onChange(i, { width_mm: Number(e.target.value) })}
                                                    className="h-full w-full rounded-l-lg bg-transparent px-3 text-sm text-slate-800 focus:outline-none"
                                                />
                                                {state.width_mm == null ? (
                                                    <span className="absolute right-2 text-slate-300" title="From geometry">
                                                        <Pencil className="h-3 w-3" />
                                                    </span>
                                                ) : null}
                                            </div>
                                        ) : (
                                            <span className="inline-flex h-9 min-w-32 items-center justify-end rounded-lg bg-slate-50 px-3 font-mono text-sm font-semibold text-slate-700 ring-1 ring-slate-200">
                                                {widthFallback || "-"} mm
                                            </span>
                                        )}
                                    </td>
                                ) : null}
                            </tr>
                        )
                    })}
                </tbody>
            </table>
        </div>
    )
}

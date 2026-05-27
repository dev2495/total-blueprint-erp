"use client"

import { Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"
import type { FeatureOption } from "@/services/quotation"

interface FeatureTogglesProps {
    options: FeatureOption[]
    value: Record<string, boolean>
    masterDefaults?: Record<string, boolean>
    onChange: (next: Record<string, boolean>) => void
}

const FALLBACK_OPTIONS: FeatureOption[] = [
    { key: "has_zipper", label: "Zipper" },
    { key: "has_valve", label: "One-way valve" },
    { key: "has_window", label: "Window patch" },
    { key: "has_tear_notch", label: "Tear notch" },
    { key: "has_hang_hole", label: "Hang hole" },
    { key: "finish_matte", label: "Matte finish" },
    { key: "has_white_ink_layer", label: "White ink underlay" },
    { key: "has_metallised_layer", label: "Metallised layer" },
]

export default function FeatureToggles({
    options,
    value,
    masterDefaults,
    onChange,
}: FeatureTogglesProps) {
    const resolved = options.length > 0 ? options : FALLBACK_OPTIONS

    return (
        <div className="rounded-xl border border-slate-200 p-4 bg-gradient-to-br from-white to-amber-50/40">
            <div className="flex items-center gap-2 mb-3">
                <Sparkles className="h-4 w-4 text-amber-600" />
                <span className="text-[10px] font-extrabold uppercase tracking-widest text-slate-600">
                    Feature options
                </span>
                <span className="text-[10px] font-bold text-slate-400">
                    · Toggle per quote line
                </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
                {resolved.map((opt) => {
                    const on = Boolean(value[opt.key])
                    const masterOn = Boolean(masterDefaults?.[opt.key])
                    const differs = masterDefaults !== undefined && on !== masterOn
                    return (
                        <button
                            key={opt.key}
                            type="button"
                            onClick={() => onChange({ ...value, [opt.key]: !on })}
                            className={cn(
                                "relative inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[11px] font-extrabold uppercase tracking-wider ring-1 transition",
                                on
                                    ? "bg-amber-500 text-white ring-amber-500 shadow-sm hover:bg-amber-600"
                                    : "bg-white text-slate-600 ring-slate-200 hover:bg-amber-50 hover:ring-amber-200",
                            )}
                        >
                            <span
                                className={cn(
                                    "h-1.5 w-1.5 rounded-full",
                                    on ? "bg-white" : "bg-slate-300",
                                )}
                            />
                            {opt.label}
                            {differs ? (
                                <span className="absolute -top-1 -right-1 inline-flex h-3 w-3 items-center justify-center rounded-full bg-rose-500 text-[8px] font-extrabold text-white shadow">
                                    !
                                </span>
                            ) : null}
                        </button>
                    )
                })}
            </div>
        </div>
    )
}

"use client"

import * as React from "react"
import { Check } from "lucide-react"
import { cn } from "@/lib/utils"

export interface StepDef {
    id: string
    label: string
    description?: string
}

interface StepStripProps {
    steps: StepDef[]
    currentId: string
    completedIds?: string[]
    onStepClick?: (id: string) => void
    className?: string
}

export function StepStrip({ steps, currentId, completedIds = [], onStepClick, className }: StepStripProps) {
    const completed = new Set(completedIds)
    return (
        <div
            className={cn(
                "rounded-2xl border border-slate-200/80 bg-white/90 px-5 py-4 shadow-sm",
                className
            )}
        >
            <ol className="flex flex-wrap items-center gap-x-2 gap-y-3">
                {steps.map((s, i) => {
                    const isCurrent = s.id === currentId
                    const isDone = completed.has(s.id)
                    const last = i === steps.length - 1
                    return (
                        <li key={s.id} className="flex items-center">
                            <button
                                type="button"
                                onClick={() => onStepClick?.(s.id)}
                                className="group flex items-center gap-3 rounded-xl px-2 py-1 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
                            >
                                <span
                                    className={cn(
                                        "flex h-8 w-8 flex-none items-center justify-center rounded-full text-xs font-bold transition",
                                        isCurrent
                                            ? "bg-blue-600 text-white shadow ring-4 ring-blue-100"
                                            : isDone
                                            ? "bg-emerald-500 text-white shadow"
                                            : "bg-slate-100 text-slate-500"
                                    )}
                                >
                                    {isDone ? <Check className="h-4 w-4" /> : i + 1}
                                </span>
                                <span className="leading-tight">
                                    <span
                                        className={cn(
                                            "block text-sm font-semibold",
                                            isCurrent ? "text-slate-900" : "text-slate-700 group-hover:text-slate-900"
                                        )}
                                    >
                                        {s.label}
                                    </span>
                                    {s.description ? (
                                        <span className="block text-[11px] font-medium uppercase tracking-wider text-slate-400">
                                            {s.description}
                                        </span>
                                    ) : null}
                                </span>
                            </button>
                            {!last ? (
                                <span
                                    aria-hidden
                                    className={cn(
                                        "mx-3 hidden h-px w-8 sm:block",
                                        isDone ? "bg-emerald-300" : "bg-slate-200"
                                    )}
                                />
                            ) : null}
                        </li>
                    )
                })}
            </ol>
        </div>
    )
}

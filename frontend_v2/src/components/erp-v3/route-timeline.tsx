"use client"

import * as React from "react"
import { ArrowRight, Flag, MapPin, Palette } from "lucide-react"
import { cn } from "@/lib/utils"

export interface RouteTimelineStep {
    index: number
    label: string
    transition?: string
    /** Whether this step is the first artwork-bearing step. */
    artwork_step?: boolean
    /** Render a small process tag below the label. */
    tag?: string
}

interface RouteTimelineProps {
    steps: RouteTimelineStep[]
    startIndex?: number
    stopIndex?: number
    onSelectStop?: (index: number) => void
    onSelectStart?: (index: number) => void
    showStartEnd?: boolean
    helperText?: string
    className?: string
}

export function RouteTimeline({
    steps,
    startIndex,
    stopIndex,
    onSelectStop,
    onSelectStart,
    showStartEnd = true,
    helperText,
    className,
}: RouteTimelineProps) {
    return (
        <div className={cn("rounded-xl border border-slate-200 bg-white p-5", className)}>
            <div className="flex flex-wrap items-stretch gap-2">
                {showStartEnd ? (
                    <RouteEndCap label="Start" icon={<Flag className="h-3.5 w-3.5" />} />
                ) : null}
                {steps.map((s, i) => {
                    const isStart = startIndex === s.index
                    const isStop = stopIndex === s.index
                    const isInside =
                        startIndex != null && stopIndex != null && s.index > startIndex && s.index < stopIndex
                    return (
                        <React.Fragment key={`${s.index}-${s.label}`}>
                            <button
                                type="button"
                                onClick={() => onSelectStop?.(s.index)}
                                onDoubleClick={() => onSelectStart?.(s.index)}
                                className={cn(
                                    "group flex min-w-[140px] flex-1 flex-col items-center rounded-xl border px-3 py-2 text-center transition",
                                    isStop
                                        ? "border-blue-500 bg-blue-50 text-blue-700 ring-2 ring-blue-200"
                                        : isStart
                                        ? "border-emerald-400 bg-emerald-50 text-emerald-700"
                                        : isInside
                                        ? "border-blue-100 bg-blue-50/40 text-slate-700"
                                        : "border-slate-200 bg-white text-slate-700 hover:border-blue-200 hover:bg-blue-50/40"
                                )}
                            >
                                <span className="flex items-center gap-1.5 text-xs font-bold">
                                    <span
                                        className={cn(
                                            "flex h-5 w-5 items-center justify-center rounded-full text-[10px]",
                                            isStop
                                                ? "bg-blue-600 text-white"
                                                : isStart
                                                ? "bg-emerald-600 text-white"
                                                : "bg-slate-100 text-slate-500"
                                        )}
                                    >
                                        {s.index}
                                    </span>
                                    {s.label}
                                    {s.artwork_step ? (
                                        <Palette className="h-3 w-3 text-fuchsia-500" />
                                    ) : null}
                                </span>
                                {s.transition || s.tag ? (
                                    <span className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                                        {s.transition || s.tag}
                                    </span>
                                ) : null}
                                {isStop ? (
                                    <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700">
                                        <MapPin className="h-3 w-3" /> Stop
                                    </span>
                                ) : null}
                            </button>
                            {i < steps.length - 1 ? (
                                <ArrowRight className="my-auto hidden h-4 w-4 flex-none text-slate-300 sm:block" />
                            ) : null}
                        </React.Fragment>
                    )
                })}
                {showStartEnd ? <RouteEndCap label="End" /> : null}
            </div>
            {helperText ? (
                <p className="mt-3 text-[11px] font-medium text-slate-500">{helperText}</p>
            ) : null}
        </div>
    )
}

function RouteEndCap({ label, icon }: { label: string; icon?: React.ReactNode }) {
    return (
        <div className="flex w-16 flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            {icon}
            {label}
        </div>
    )
}

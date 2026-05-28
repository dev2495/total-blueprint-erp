"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

interface SectionCardV3Props {
    index?: number
    eyebrow?: string
    title: string
    description?: string
    actions?: React.ReactNode
    children: React.ReactNode
    className?: string
    bodyClassName?: string
    accent?: "blue" | "emerald" | "amber" | "violet" | "slate"
    sticky?: boolean
}

const ACCENT_BORDER: Record<NonNullable<SectionCardV3Props["accent"]>, string> = {
    blue: "border-l-blue-500",
    emerald: "border-l-emerald-500",
    amber: "border-l-amber-500",
    violet: "border-l-violet-500",
    slate: "border-l-slate-400",
}

const ACCENT_INDEX: Record<NonNullable<SectionCardV3Props["accent"]>, string> = {
    blue: "bg-blue-50 text-blue-700 ring-blue-200",
    emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    amber: "bg-amber-50 text-amber-700 ring-amber-200",
    violet: "bg-violet-50 text-violet-700 ring-violet-200",
    slate: "bg-slate-50 text-slate-700 ring-slate-200",
}

const ACCENT_EYEBROW: Record<NonNullable<SectionCardV3Props["accent"]>, string> = {
    blue: "text-blue-700",
    emerald: "text-emerald-700",
    amber: "text-amber-700",
    violet: "text-violet-700",
    slate: "text-slate-500",
}

/**
 * V3.7 SectionCardV3 — calmer mockup-aligned section shell used by PM Edit,
 * Stock Launcher, Sales Workspace.
 *
 *  - thin 3 px coloured stripe on the left
 *  - flat-white header (no gradient wash) with a single bottom border
 *  - small tonal-tinted numbered badge (no heavy solid colour)
 *  - shadow-sm + no extra ring, so stacked cards don't visually shout
 *  - coloured eyebrow line replaces the muted grey one
 */
export function SectionCardV3({
    index,
    eyebrow,
    title,
    description,
    actions,
    children,
    className,
    bodyClassName,
    accent = "blue",
    sticky,
}: SectionCardV3Props) {
    return (
        <section
            className={cn(
                "overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm border-l-[3px]",
                ACCENT_BORDER[accent],
                className,
            )}
        >
            <header
                className={cn(
                    "flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 bg-white px-5 py-3 sm:px-6",
                    sticky && "sticky top-0 z-10 backdrop-blur",
                )}
            >
                <div className="flex min-w-0 items-center gap-3">
                    {typeof index === "number" ? (
                        <span
                            className={cn(
                                "flex h-7 w-7 flex-none items-center justify-center rounded-lg ring-1 text-xs font-black",
                                ACCENT_INDEX[accent],
                            )}
                        >
                            {index}
                        </span>
                    ) : null}
                    <div className="min-w-0">
                        {eyebrow ? (
                            <div className={cn("text-[10px] font-black uppercase tracking-[0.22em]", ACCENT_EYEBROW[accent])}>
                                {eyebrow}
                            </div>
                        ) : null}
                        <h2 className="text-[14px] font-bold leading-tight text-slate-900">{title}</h2>
                        {description ? (
                            <p className="mt-0.5 text-[11px] leading-5 text-slate-500">{description}</p>
                        ) : null}
                    </div>
                </div>
                {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
            </header>
            <div
                className={cn("px-5 py-5 sm:px-6", bodyClassName)}
                style={{ contentVisibility: "auto", containIntrinsicSize: "1px 600px" } as React.CSSProperties}
            >
                {children}
            </div>
        </section>
    )
}

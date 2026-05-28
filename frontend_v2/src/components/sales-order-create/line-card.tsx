"use client"

/**
 * V3.4 Sales Order — collapsed line card.
 *
 * Shown when the line is NOT expanded. Compact summary + actions (expand,
 * duplicate, remove). Click anywhere on the body to expand.
 */

import * as React from "react"
import { ChevronDown, Copy, Pencil, Trash2, Sparkles, AlertCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import type { SalesOrderLine } from "./types"

export interface LineCardProps {
    index: number
    line: SalesOrderLine
    masterCode?: string
    masterName?: string
    onExpand: () => void
    onDuplicate: () => void
    onRemove: () => void
    issues?: string[]
}

export function LineCard({ index, line, masterCode, masterName, onExpand, onDuplicate, onRemove, issues = [] }: LineCardProps) {
    const hasIssue = issues.length > 0
    const lineTotal = line.qty_value * (parseFloat(line.unit_price || "0") || 0)

    const summaryChips: Array<{ label: string; tone: ChipTone }> = []
    if (line.size_code) summaryChips.push({ label: line.size_code, tone: "emerald" })
    if (line.customer_product_overlay) summaryChips.push({ label: "Customer default", tone: "blue" })
    if (line.addons.length) summaryChips.push({ label: line.addons.join("·"), tone: "amber" })
    if (line.axis_values.pod_variant) summaryChips.push({ label: `POD ${shortCode(line.axis_values.pod_variant)}`, tone: "violet" })
    if (line.axis_values.packaging_inner) summaryChips.push({ label: shortCode(line.axis_values.packaging_inner), tone: "sky" })
    if (line.axis_values.packaging_outer) summaryChips.push({ label: shortCode(line.axis_values.packaging_outer), tone: "orange" })
    if (line.artwork_mode === "DEFER") summaryChips.push({ label: "Artwork: defer", tone: "slate" })
    else if (line.artwork_assignment?.colorway_name) summaryChips.push({ label: line.artwork_assignment.colorway_name, tone: "fuchsia" })

    return (
        <div
            className={cn(
                "group relative overflow-hidden rounded-2xl border bg-white shadow-sm ring-1 ring-slate-100/50 transition-all hover:shadow-md hover:ring-blue-100",
                hasIssue ? "border-rose-200 ring-rose-100" : "border-slate-200"
            )}
        >
            {/* Top row: index badge + master + actions */}
            <button
                type="button"
                onClick={onExpand}
                className="flex w-full items-start gap-3 px-4 py-3.5 text-left"
                aria-label={`Expand line ${index + 1}`}
            >
                <span className={cn(
                    "flex h-8 w-8 flex-none items-center justify-center rounded-xl text-xs font-black shadow-sm ring-1",
                    hasIssue ? "bg-rose-600 text-white ring-rose-700" : "bg-gradient-to-br from-blue-600 to-indigo-600 text-white ring-blue-700",
                )}>
                    {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-2">
                        <span className="font-mono text-xs font-bold text-blue-700">
                            {masterCode || "—"}
                        </span>
                        {masterName && (
                            <span className="truncate text-[11px] text-slate-500">{masterName}</span>
                        )}
                    </div>
                    {summaryChips.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            {summaryChips.map((c, i) => (
                                <Chip key={i} tone={c.tone}>{c.label}</Chip>
                            ))}
                        </div>
                    )}
                    {hasIssue && (
                        <div className="mt-1.5 flex items-center gap-1 text-[11px] font-bold text-rose-700">
                            <AlertCircle className="h-3 w-3" />
                            {issues[0]}
                        </div>
                    )}
                </div>
                {/* qty + price */}
                <div className="flex flex-none flex-col items-end gap-0.5 text-right">
                    <div className="font-display text-base font-bold text-slate-900">
                        {formatNumber(line.qty_value)}
                        <span className="ml-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">{line.qty_uom}</span>
                    </div>
                    {lineTotal > 0 && (
                        <div className="text-[11px] font-semibold text-slate-600">₹{formatNumber(lineTotal, 0)}</div>
                    )}
                </div>
                <ChevronDown className="mt-1 h-4 w-4 flex-none text-slate-400 transition group-hover:text-blue-600" />
            </button>
            {/* Action row */}
            <div className="flex items-center justify-between border-t border-slate-100 bg-slate-50/40 px-3 py-1.5">
                <div className="flex items-center gap-1">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => { e.stopPropagation(); onExpand() }}
                        className="h-7 gap-1 rounded-lg text-[11px] font-bold text-blue-700 hover:bg-blue-50"
                    >
                        <Pencil className="h-3 w-3" /> Edit
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => { e.stopPropagation(); onDuplicate() }}
                        className="h-7 gap-1 rounded-lg text-[11px] font-bold text-slate-700 hover:bg-slate-100"
                    >
                        <Copy className="h-3 w-3" /> Duplicate
                    </Button>
                </div>
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => { e.stopPropagation(); onRemove() }}
                    className="h-7 gap-1 rounded-lg text-[11px] font-bold text-rose-600 hover:bg-rose-50"
                >
                    <Trash2 className="h-3 w-3" /> Remove
                </Button>
            </div>
        </div>
    )
}

type ChipTone = "blue" | "emerald" | "violet" | "amber" | "sky" | "orange" | "fuchsia" | "slate"

function Chip({ tone, children }: { tone: ChipTone; children: React.ReactNode }) {
    const map: Record<ChipTone, string> = {
        blue: "bg-blue-50 text-blue-700 ring-blue-200",
        emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200",
        violet: "bg-violet-50 text-violet-700 ring-violet-200",
        amber: "bg-amber-50 text-amber-700 ring-amber-200",
        sky: "bg-sky-50 text-sky-700 ring-sky-200",
        orange: "bg-orange-50 text-orange-700 ring-orange-200",
        fuchsia: "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200",
        slate: "bg-slate-50 text-slate-600 ring-slate-200",
    }
    return (
        <span className={cn(
            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ring-inset shadow-sm",
            map[tone]
        )}>
            {children}
        </span>
    )
}

function shortCode(s: string): string {
    if (s.length <= 16) return s
    return s.slice(0, 14) + "…"
}

function formatNumber(n: number, max: number = 2): string {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: max }).format(n)
}

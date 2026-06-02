"use client"

/**
 * Sales Order Create — line-tab workbench.
 *
 * The cart is no longer a stacked card list. It behaves like the mockup:
 * one active line tab drives the full editor + live BOM workspace below it.
 */

import * as React from "react"
import { AlertCircle, CheckCircle2, Plus, ShoppingBag } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import { LineEditor } from "./line-editor"
import type { SalesOrderLine, SalesOrderDraft } from "./types"
import type { ProductMaster } from "@/services/product-master"

export interface CartProps {
    draft: SalesOrderDraft
    masters: ProductMaster[]
    onAddLine: () => void
    onRemoveLine: (id: string) => void
    onDuplicateLine: (id: string) => void
    onUpdateLine: (id: string, patch: Partial<SalesOrderLine>) => void
    onExpandLine: (id: string | null) => void
    perLineIssues: Record<string, string[]>
}

export function Cart({
    draft,
    masters,
    onAddLine,
    onRemoveLine,
    onDuplicateLine,
    onUpdateLine,
    onExpandLine,
    perLineIssues,
}: CartProps) {
    const customerId = draft.customer || undefined
    if (draft.lines.length === 0) {
        return (
            <div className="rounded-[18px] border border-dashed border-indigo-200 bg-white p-10 text-center shadow-sm">
                <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-indigo-50 ring-1 ring-indigo-200">
                    <ShoppingBag className="h-7 w-7 text-indigo-600" />
                </div>
                <div className="mt-4 text-base font-black text-slate-900">Start the first production line</div>
                <p className="mt-1 text-sm text-slate-500">
                    Use a customer overlay, repeat order shortcut, or build manually from product master axes.
                </p>
                <Button
                    onClick={onAddLine}
                    className="mt-5 gap-1.5 rounded-xl bg-slate-950 text-white shadow-lg shadow-slate-900/20 hover:bg-slate-800"
                    disabled={!draft.customer}
                >
                    <Plus className="h-4 w-4" />
                    {draft.customer ? "Add line" : "Pick customer first"}
                </Button>
            </div>
        )
    }

    const activeLineId = draft.expanded_line_id || draft.lines[0]?.id
    const activeLine = draft.lines.find((line) => line.id === activeLineId) || draft.lines[0]
    const activeIndex = draft.lines.findIndex((line) => line.id === activeLine?.id)
    const activeMaster = masters.find((master) => master.id === activeLine?.product_master)

    return (
        <div className="overflow-hidden rounded-[20px] border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 bg-slate-950 px-4 py-3 text-white">
                <div className="flex flex-wrap items-center gap-2">
                    <div className="mr-1 flex items-center gap-2">
                        <ShoppingBag className="h-4 w-4 text-indigo-200" />
                        <span className="text-[10px] font-black uppercase tracking-[0.22em] text-indigo-100">Line workspace</span>
                    </div>
                    {draft.lines.map((line, idx) => {
                        const master = masters.find((item) => item.id === line.product_master)
                        const issues = perLineIssues[line.id] || []
                        const isActive = line.id === activeLine?.id
                        return (
                            <button
                                key={line.id}
                                type="button"
                                onClick={() => onExpandLine(line.id)}
                                className={cn(
                                    "inline-flex h-9 max-w-[240px] items-center gap-2 rounded-full px-3 text-xs font-black ring-1 transition",
                                    isActive
                                        ? "bg-white text-slate-950 ring-white"
                                        : issues.length
                                            ? "bg-rose-500/15 text-rose-100 ring-rose-300/30 hover:bg-rose-500/25"
                                            : "bg-white/8 text-slate-200 ring-white/10 hover:bg-white/14",
                                )}
                            >
                                <span className={cn(
                                    "grid h-5 w-5 place-items-center rounded-full text-[10px]",
                                    isActive ? "bg-slate-950 text-white" : issues.length ? "bg-rose-500 text-white" : "bg-white/15 text-white",
                                )}>
                                    {idx + 1}
                                </span>
                                <span className="truncate">
                                    {master?.code || "Pick product"}
                                    {line.size_code ? ` · ${line.size_code}` : ""}
                                </span>
                                {issues.length ? <AlertCircle className="h-3.5 w-3.5 flex-none" /> : <CheckCircle2 className="h-3.5 w-3.5 flex-none opacity-70" />}
                            </button>
                        )
                    })}
                    <Button
                        onClick={onAddLine}
                        size="sm"
                        variant="secondary"
                        className="h-9 rounded-full bg-indigo-100 px-3 text-xs font-black text-indigo-800 hover:bg-indigo-50"
                    >
                        <Plus className="h-3.5 w-3.5" /> Add line
                    </Button>
                    <span className="ml-auto text-[11px] font-bold text-slate-400">
                        {draft.lines.length} line{draft.lines.length === 1 ? "" : "s"} · active line {activeIndex + 1}
                    </span>
                </div>
            </div>

            {activeLine ? (
                <div className="space-y-3 bg-slate-50/70 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3">
                        <div className="min-w-0">
                            <div className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-700">
                                Line {activeIndex + 1} · build
                            </div>
                            <div className="truncate font-display text-base font-black text-slate-950">
                                {activeMaster ? activeMaster.name : "Pick a product master, axes, artwork, packing and quantity"}
                            </div>
                        </div>
                        <div className="flex items-center gap-1">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => onDuplicateLine(activeLine.id)}
                                className="h-8 rounded-lg border-slate-200 text-[11px] font-bold"
                            >
                                Duplicate
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => onRemoveLine(activeLine.id)}
                                className="h-8 rounded-lg border-rose-200 text-[11px] font-bold text-rose-700 hover:bg-rose-50"
                            >
                                Remove
                            </Button>
                        </div>
                    </div>
                    <LineEditor
                        line={activeLine}
                        masters={masters}
                        customerId={customerId}
                        lineIndex={activeIndex}
                        onPatch={(patch) => onUpdateLine(activeLine.id, patch)}
                        onCollapse={() => onExpandLine(activeLine.id)}
                        onAdd={onAddLine}
                    />
                </div>
            ) : null}
        </div>
    )
}

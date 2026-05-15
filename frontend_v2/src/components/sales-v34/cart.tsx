"use client"

/**
 * V3.4 Sales Order — Cart container.
 *
 * Renders the list of LineCards (collapsed) with the LineEditor inline-expanded
 * for the currently expanded line. Includes the "+ Add another line" affordance
 * and the cart-empty state.
 */

import * as React from "react"
import { Plus, ShoppingBag } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import { LineCard } from "./line-card"
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
            <div className="rounded-2xl border border-dashed border-blue-200 bg-gradient-to-br from-blue-50/50 to-white p-12 text-center shadow-sm">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-100 to-indigo-100 ring-1 ring-blue-200">
                    <ShoppingBag className="h-8 w-8 text-blue-600" />
                </div>
                <div className="mt-4 text-base font-bold text-slate-900">Cart is empty</div>
                <p className="mt-1 text-sm text-slate-500">
                    Pick from the Quick Start cards above, or add a line manually.
                </p>
                <Button
                    onClick={onAddLine}
                    className="mt-5 gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 shadow-lg shadow-blue-600/25 hover:shadow-xl hover:shadow-blue-600/30"
                    disabled={!draft.customer}
                >
                    <Plus className="h-4 w-4" />
                    {draft.customer ? "Add line" : "Pick customer first"}
                </Button>
            </div>
        )
    }

    return (
        <div className="space-y-3">
            {/* Cart total strip */}
            <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-gradient-to-r from-slate-50/80 to-white px-4 py-2.5 shadow-sm">
                <div className="flex items-center gap-2">
                    <ShoppingBag className="h-4 w-4 text-slate-500" />
                    <span className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">Cart</span>
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700 ring-1 ring-blue-200">
                        {draft.lines.length} {draft.lines.length === 1 ? "line" : "lines"}
                    </span>
                </div>
                <Button
                    onClick={onAddLine}
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1.5 rounded-lg border-blue-200 bg-blue-50 text-xs font-bold text-blue-700 shadow-sm hover:bg-blue-100"
                >
                    <Plus className="h-3 w-3" /> Add line
                </Button>
            </div>

            {draft.lines.map((line, idx) => {
                const isExpanded = draft.expanded_line_id === line.id
                const m = masters.find((x) => x.id === line.product_master)
                if (isExpanded) {
                    return (
                        <div key={line.id} className="space-y-2">
                            <LineCard
                                index={idx}
                                line={line}
                                masterCode={m?.code}
                                masterName={m?.name}
                                onExpand={() => onExpandLine(null)}
                                onDuplicate={() => onDuplicateLine(line.id)}
                                onRemove={() => onRemoveLine(line.id)}
                                issues={perLineIssues[line.id]}
                            />
                            <LineEditor
                                line={line}
                                masters={masters}
                                customerId={customerId}
                                lineIndex={idx}
                                onPatch={(patch) => onUpdateLine(line.id, patch)}
                                onCollapse={() => onExpandLine(null)}
                                onAdd={() => onExpandLine(null)}
                            />
                        </div>
                    )
                }
                return (
                    <LineCard
                        key={line.id}
                        index={idx}
                        line={line}
                        masterCode={m?.code}
                        masterName={m?.name}
                        onExpand={() => onExpandLine(line.id)}
                        onDuplicate={() => onDuplicateLine(line.id)}
                        onRemove={() => onRemoveLine(line.id)}
                        issues={perLineIssues[line.id]}
                    />
                )
            })}
        </div>
    )
}

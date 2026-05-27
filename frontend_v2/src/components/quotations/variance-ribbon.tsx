"use client"

import { useState } from "react"
import { AlertCircle, BadgeCheck, RotateCcw, Send, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ModifiedField } from "./line-spec-diff"

interface VarianceRibbonProps {
    modifiedFields: ModifiedField[]
    masterCode?: string
    onReset: () => void
    onPromote?: () => void
    canPromote?: boolean
}

export default function VarianceRibbon({
    modifiedFields,
    masterCode,
    onReset,
    onPromote,
    canPromote = false,
}: VarianceRibbonProps) {
    const [showDetails, setShowDetails] = useState(false)
    const hasMods = modifiedFields.length > 0

    return (
        <div
            className={cn(
                "rounded-xl ring-1 px-3 py-2.5 flex flex-wrap items-center gap-3",
                hasMods
                    ? "bg-amber-50 ring-amber-200"
                    : "bg-emerald-50 ring-emerald-200",
            )}
        >
            {hasMods ? (
                <>
                    <div className="flex items-center gap-2 min-w-0">
                        <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" strokeWidth={2.5} />
                        <div className="min-w-0">
                            <div className="text-[11px] font-extrabold uppercase tracking-widest text-amber-900">
                                Modified · {modifiedFields.length} field{modifiedFields.length === 1 ? "" : "s"} changed
                            </div>
                            {masterCode ? (
                                <div className="text-[10px] font-bold text-amber-700 font-mono truncate">
                                    vs master {masterCode}
                                </div>
                            ) : null}
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => setShowDetails((v) => !v)}
                        className="ml-auto inline-flex items-center gap-1 h-7 px-2 rounded-md text-[10px] font-extrabold uppercase tracking-widest text-amber-800 hover:bg-amber-100"
                    >
                        Details
                        <ChevronDown
                            className={cn(
                                "h-3 w-3 transition-transform",
                                showDetails ? "rotate-180" : "rotate-0",
                            )}
                            strokeWidth={2.5}
                        />
                    </button>
                    <button
                        type="button"
                        onClick={onReset}
                        className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[10px] font-extrabold uppercase tracking-widest bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
                        title="Reset all fields to master"
                    >
                        <RotateCcw className="h-3 w-3" strokeWidth={2.5} />
                        Reset
                    </button>
                    {canPromote && onPromote ? (
                        <button
                            type="button"
                            onClick={onPromote}
                            className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[10px] font-extrabold uppercase tracking-widest bg-indigo-600 text-white hover:bg-indigo-700"
                            title="Save these changes back to the master (affects future orders)"
                        >
                            <Send className="h-3 w-3" strokeWidth={2.5} />
                            Save to master
                        </button>
                    ) : null}
                    {showDetails ? (
                        <div className="w-full rounded-lg bg-white ring-1 ring-amber-200 mt-2 overflow-hidden">
                            <table className="w-full text-[11px]">
                                <thead className="bg-amber-100/60">
                                    <tr>
                                        <th className="text-left px-2 py-1 font-extrabold text-amber-900 uppercase tracking-wider">
                                            Field
                                        </th>
                                        <th className="text-left px-2 py-1 font-extrabold text-amber-900 uppercase tracking-wider">
                                            Master
                                        </th>
                                        <th className="text-left px-2 py-1 font-extrabold text-amber-900 uppercase tracking-wider">
                                            This line
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {modifiedFields.map((mf) => (
                                        <tr key={mf.path} className="border-t border-amber-100">
                                            <td className="px-2 py-1 font-bold text-slate-700 capitalize">
                                                {mf.label}
                                            </td>
                                            <td className="px-2 py-1 font-mono text-slate-500">
                                                {mf.from}
                                            </td>
                                            <td className="px-2 py-1 font-mono font-extrabold text-amber-800">
                                                {mf.to}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : null}
                </>
            ) : (
                <>
                    <BadgeCheck className="h-4 w-4 text-emerald-600 shrink-0" strokeWidth={2.5} />
                    <div className="text-[11px] font-extrabold uppercase tracking-widest text-emerald-900">
                        Matches master
                    </div>
                    {masterCode ? (
                        <div className="text-[10px] font-bold text-emerald-700 font-mono">
                            {masterCode}
                        </div>
                    ) : null}
                </>
            )}
        </div>
    )
}

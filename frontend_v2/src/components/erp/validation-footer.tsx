"use client"

import * as React from "react"
import { CheckCircle2, AlertTriangle, XCircle, FileEdit } from "lucide-react"
import { cn } from "@/lib/utils"

export interface CheckLine {
    label: string
    ok: boolean
    tone?: "ok" | "warn" | "error"
}

interface ValidationFooterProps {
    checks?: CheckLine[]
    autosaveLabel?: string
    primaryActions?: React.ReactNode
    secondaryActions?: React.ReactNode
    className?: string
}

export function ValidationFooter({
    checks = [],
    autosaveLabel,
    primaryActions,
    secondaryActions,
    className,
}: ValidationFooterProps) {
    const errorCount = checks.filter((c) => !c.ok && c.tone !== "warn").length
    const warnCount = checks.filter((c) => !c.ok && c.tone === "warn").length

    return (
        <div
            className={cn(
                "sticky bottom-0 z-20 mt-6 rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 shadow-[0_-12px_30px_-22px_rgba(15,23,42,0.5)] backdrop-blur",
                className
            )}
        >
            <div className="flex flex-wrap items-center gap-3">
                <div className="flex flex-wrap items-center gap-2">
                    {errorCount > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-danger-bg px-2.5 py-1 text-[11px] font-bold text-danger-fg ring-1 ring-rose-200">
                            <XCircle className="h-3.5 w-3.5" />
                            {errorCount} blocker{errorCount === 1 ? "" : "s"}
                        </span>
                    ) : null}
                    {warnCount > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-warning-bg px-2.5 py-1 text-[11px] font-bold text-warning-fg ring-1 ring-amber-200">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            {warnCount} warning{warnCount === 1 ? "" : "s"}
                        </span>
                    ) : null}
                    {errorCount === 0 && warnCount === 0 && checks.length > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-success-bg px-2.5 py-1 text-[11px] font-bold text-success-fg ring-1 ring-emerald-200">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            All validations passed
                        </span>
                    ) : null}
                    {autosaveLabel ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-content-3 ring-1 ring-slate-200">
                            <FileEdit className="h-3.5 w-3.5" />
                            {autosaveLabel}
                        </span>
                    ) : null}
                </div>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                    {secondaryActions}
                    {primaryActions}
                </div>
            </div>
        </div>
    )
}

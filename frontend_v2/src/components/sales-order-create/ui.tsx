"use client"

// Shared visual primitives for the compact sales-order create surface.

import * as React from "react"
import { cn } from "@/lib/utils"

export const INP =
    "h-[38px] w-full rounded-[11px] border border-slate-200 bg-white px-[11px] text-[13px] font-bold text-slate-900 outline-none transition placeholder:font-semibold placeholder:text-slate-400 focus:border-indigo-400 focus:ring-[3px] focus:ring-indigo-400/15 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"

export const LABEL = "text-[9.5px] font-extrabold uppercase tracking-[0.13em] text-slate-500"

export const MONO = "font-mono tabular-nums"

export function SoField({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
    return (
        <div className={className}>
            <div className={cn(LABEL, "mb-1")}>
                {label}
                {hint ? <span className="ml-1 font-bold normal-case tracking-normal text-slate-400">· {hint}</span> : null}
            </div>
            {children}
        </div>
    )
}

export function SoSelect({
    value,
    onChange,
    children,
    className,
    disabled,
    "aria-label": ariaLabel,
}: {
    value: string
    onChange: (value: string) => void
    children: React.ReactNode
    className?: string
    disabled?: boolean
    "aria-label"?: string
}) {
    return (
        <div className="relative">
            <select
                aria-label={ariaLabel}
                value={value}
                disabled={disabled}
                onChange={(e) => onChange(e.target.value)}
                className={cn(INP, "cursor-pointer appearance-none pr-8", className)}
            >
                {children}
            </select>
            <svg className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M6 8l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
        </div>
    )
}

export function SoReadout({ children, className }: { children: React.ReactNode; className?: string }) {
    return <div className={cn(INP, "flex items-center bg-slate-50 text-slate-700", className)}>{children}</div>
}

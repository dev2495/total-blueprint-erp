"use client"

import * as React from "react"
import { Chip, ChipGroup } from "@/components/ds/chip"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { PlannerControlOrder } from "@/services/planner"

export function WizardShell({
    title,
    onBack,
    children,
    footer,
}: {
    title: React.ReactNode
    onBack: () => void
    children: React.ReactNode
    footer?: React.ReactNode
}) {
    return (
        <div className="flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
                <div className="flex items-center gap-3">
                    <Button size="sm" variant="ghost" onClick={onBack}>← Back</Button>
                    <h2 className="font-display text-base font-semibold text-slate-900">{title}</h2>
                </div>
            </div>
            <div className="flex flex-col gap-4 px-5 py-4">{children}</div>
            {footer ? (
                <div className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-slate-100 bg-white/95 px-5 py-3 backdrop-blur">
                    {footer}
                </div>
            ) : null}
        </div>
    )
}

export function DemandLineList({
    orders,
    selectedKey,
    onSelect,
    isLoading,
    emptyText = "No demand lines available.",
    filter,
}: {
    orders: PlannerControlOrder[]
    selectedKey: string | null
    onSelect: (key: string) => void
    isLoading?: boolean
    emptyText?: string
    filter?: (order: PlannerControlOrder) => boolean
}) {
    const list = React.useMemo(() => {
        const base = orders.filter((o) => String(o.order_kind || "").toLowerCase() === "sales")
        return filter ? base.filter(filter) : base
    }, [orders, filter])

    if (isLoading) {
        return <div className="rounded-lg border border-dashed border-slate-200 bg-white p-4 text-center text-sm text-slate-500">Loading demand…</div>
    }
    if (list.length === 0) {
        return <div className="rounded-lg border border-dashed border-slate-200 bg-white p-4 text-center text-sm text-slate-500">{emptyText}</div>
    }
    return (
        <div className="grid max-h-[280px] gap-2 overflow-y-auto pr-1">
            {list.map((order) => {
                const key = `${order.order_kind}:${order.order_id}`
                const selected = key === selectedKey
                return (
                    <button
                        key={key}
                        type="button"
                        onClick={() => onSelect(key)}
                        className={cn(
                            "flex flex-col gap-1 rounded-lg border bg-white px-3 py-2 text-left transition-colors hover:border-blue-200 hover:bg-blue-50/30",
                            selected ? "border-blue-300 bg-blue-50/40" : "border-slate-200",
                        )}
                    >
                        <div className="flex items-baseline justify-between gap-2">
                            <span className="font-mono-token text-[12px] font-semibold text-slate-900">{order.order_number}</span>
                            <span className="font-mono-token text-[11px] text-slate-600">
                                {Math.round(Number(order.required_qty_kg || 0))} kg
                            </span>
                        </div>
                        <div className="truncate text-[12px] text-slate-700">{order.customer_name || "—"}</div>
                        <ChipGroup spacing="tight">
                            {order.fg_type ? (
                                <Chip kind={String(order.fg_type).toUpperCase().includes("ROLL") ? "fg-roll" : "fg-pouch"} size="sm">
                                    {order.fg_type}
                                </Chip>
                            ) : null}
                            {order.effective_dims?.width_mm ? (
                                <Chip kind="info" size="sm" mono>
                                    {Math.round(order.effective_dims.width_mm)}
                                    {order.effective_dims.height_mm ? `×${Math.round(order.effective_dims.height_mm)}` : "mm"}
                                </Chip>
                            ) : null}
                            {order.roll_invariants?.thickness_micron ? (
                                <Chip kind="thick" size="sm" mono>
                                    {Math.round(Number(order.roll_invariants.thickness_micron))}μ
                                </Chip>
                            ) : null}
                        </ChipGroup>
                    </button>
                )
            })}
        </div>
    )
}

export function FieldRow({
    label,
    children,
    hint,
}: {
    label: string
    children: React.ReactNode
    hint?: React.ReactNode
}) {
    return (
        <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
            {children}
            {hint ? <span className="text-[11px] text-slate-500">{hint}</span> : null}
        </label>
    )
}

export function SummaryStat({
    label,
    value,
    tone = "neutral",
}: {
    label: string
    value: React.ReactNode
    tone?: "info" | "success" | "warn" | "danger" | "neutral"
}) {
    const toneCls: Record<string, string> = {
        info: "border-sky-200 bg-sky-50",
        success: "border-emerald-200 bg-emerald-50",
        warn: "border-amber-200 bg-amber-50",
        danger: "border-rose-200 bg-rose-50",
        neutral: "border-slate-200 bg-slate-50/60",
    }
    return (
        <div className={cn("rounded-lg border px-3 py-2", toneCls[tone])}>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
            <div className="mt-0.5 font-mono-token text-[13px] text-slate-900">{value}</div>
        </div>
    )
}

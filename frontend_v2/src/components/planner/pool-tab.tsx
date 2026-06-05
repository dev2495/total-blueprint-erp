"use client"

import { useMemo, useState } from "react"

import { Chip, ChipGroup } from "@/components/ds/chip"
import { FilterChip } from "@/components/ds/filter-chip"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

import { usePoolRolls } from "@/hooks/use-planner"
import type { RollExplorerRow } from "@/services/rolls"
import type { TowerTabContext } from "./types"

type PoolKind = "finished" | "wip" | "bulk"

type AgeBucket = "all" | "fresh" | "month" | "old"

const KIND_TABS: Array<{ id: PoolKind; label: string; hint: string }> = [
    { id: "finished", label: "Finished", hint: "Sellable FG" },
    { id: "wip", label: "WIP", hint: "Mid-route rolls" },
    { id: "bulk", label: "Bulk", hint: "Pellets / liquids" },
]

const AGE_OPTIONS: Array<{ value: AgeBucket; label: string }> = [
    { value: "all", label: "Any age" },
    { value: "fresh", label: "≤ 7d" },
    { value: "month", label: "≤ 30d" },
    { value: "old", label: "> 30d" },
]

function classifyRow(row: RollExplorerRow): PoolKind {
    const form = String(row.form_label || "").toUpperCase()
    if (form === "BULK") return "bulk"
    const finished = row.stock_strategy === "FINAL_STOCK" || (row as any).is_fg === true
    if (finished) return "finished"
    return "wip"
}

function ageDays(row: RollExplorerRow): number {
    const created = (row as any).created_at || (row as any).created_on || (row as any).timestamp
    if (!created) return 0
    const ms = Date.now() - new Date(created).getTime()
    if (Number.isNaN(ms)) return 0
    return Math.max(0, Math.round(ms / 86_400_000))
}

function ageBucketOf(days: number): AgeBucket {
    if (days <= 7) return "fresh"
    if (days <= 30) return "month"
    return "old"
}

function ageMatches(filter: AgeBucket, row: RollExplorerRow): boolean {
    if (filter === "all") return true
    return ageBucketOf(ageDays(row)) === filter
}

function statusKind(status: string | undefined): "info" | "success" | "warn" | "danger" | "neutral" {
    const upper = String(status || "").toUpperCase()
    if (upper === "AVAILABLE") return "success"
    if (upper === "RESERVED") return "info"
    if (upper === "IN_PROCESS") return "warn"
    if (upper === "QUARANTINED" || upper === "SCRAPPED") return "danger"
    return "neutral"
}

function formatKg(value: number | null | undefined) {
    if (value == null || Number.isNaN(value)) return "—"
    return `${Number(value).toFixed(1)} kg`
}

export function PoolTab({ context }: { context: TowerTabContext }) {
    const [activeKind, setActiveKind] = useState<PoolKind>("finished")
    const [ageFilter, setAgeFilter] = useState<AgeBucket>("all")
    const [locationFilter, setLocationFilter] = useState<string>("all")
    const [selectedRow, setSelectedRow] = useState<RollExplorerRow | null>(null)

    const { data, isLoading } = usePoolRolls()
    const allRows = data?.rows ?? []

    const locations = useMemo(() => {
        const set = new Set<string>()
        for (const row of allRows) {
            const loc = (row as any).location_name || (row as any).location
            if (loc) set.add(String(loc))
        }
        return Array.from(set).sort()
    }, [allRows])

    const filtered = useMemo(() => {
        const search = context.search.toLowerCase()
        return allRows.filter((row) => {
            if (classifyRow(row) !== activeKind) return false
            if (!ageMatches(ageFilter, row)) return false
            if (locationFilter !== "all") {
                const loc = (row as any).location_name || (row as any).location || ""
                if (String(loc) !== locationFilter) return false
            }
            if (search) {
                const haystack = [
                    row.label_id,
                    row.display_name,
                    row.family_display_name,
                    row.size_line,
                    (row as any).location_name,
                ]
                    .filter(Boolean)
                    .join(" ")
                    .toLowerCase()
                if (!haystack.includes(search)) return false
            }
            return true
        })
    }, [allRows, activeKind, ageFilter, locationFilter, context.search])

    const counts = useMemo(() => {
        const c: Record<PoolKind, number> = { finished: 0, wip: 0, bulk: 0 }
        for (const row of allRows) c[classifyRow(row)] += 1
        return c
    }, [allRows])

    return (
        <div className="flex flex-col">
            <div className="flex flex-wrap gap-2 border-b border-slate-100 px-5 py-3">
                {KIND_TABS.map((tab) => (
                    <button
                        key={tab.id}
                        type="button"
                        onClick={() => setActiveKind(tab.id)}
                        data-active={activeKind === tab.id || undefined}
                        className={cn(
                            "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[12px] font-semibold transition-colors",
                            "border-slate-200 bg-surface-1 text-slate-700 hover:bg-slate-50",
                            "data-[active]:border-blue-300 data-[active]:bg-blue-50 data-[active]:text-blue-700",
                        )}
                    >
                        <span>{tab.label}</span>
                        <span className="font-mono-token text-[10px] text-slate-500">{counts[tab.id]}</span>
                    </button>
                ))}
                <div className="ml-2 flex flex-wrap gap-2">
                    <FilterChip
                        label="Age"
                        value={ageFilter !== "all" ? AGE_OPTIONS.find((o) => o.value === ageFilter)?.label : undefined}
                        onClick={() => {
                            const order = AGE_OPTIONS.map((o) => o.value)
                            const idx = order.indexOf(ageFilter)
                            setAgeFilter(order[(idx + 1) % order.length])
                        }}
                        onClear={ageFilter !== "all" ? () => setAgeFilter("all") : undefined}
                        active={ageFilter !== "all"}
                    />
                    <FilterChip
                        label="Location"
                        value={locationFilter !== "all" ? locationFilter : undefined}
                        onClick={() => {
                            const order = ["all", ...locations]
                            const idx = order.indexOf(locationFilter)
                            setLocationFilter(order[(idx + 1) % order.length])
                        }}
                        onClear={locationFilter !== "all" ? () => setLocationFilter("all") : undefined}
                        active={locationFilter !== "all"}
                    />
                </div>
                <span className="ml-auto text-[11px] text-slate-500">
                    {filtered.length} rolls · {data?.totals?.weight_kg ? formatKg(data.totals.weight_kg) : "—"} total
                </span>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full min-w-[960px] border-collapse text-sm">
                    <thead>
                        <tr className="border-b border-slate-200 bg-slate-50/60 text-[11px] uppercase tracking-wide text-slate-500">
                            <th className="px-5 py-2 text-left font-semibold">Label</th>
                            <th className="px-3 py-2 text-left font-semibold">Variant</th>
                            <th className="px-3 py-2 text-right font-semibold">Weight</th>
                            <th className="px-3 py-2 text-left font-semibold">Location</th>
                            <th className="px-3 py-2 text-left font-semibold">Stage</th>
                            <th className="px-3 py-2 text-left font-semibold">Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {isLoading ? (
                            <tr>
                                <td colSpan={6} className="px-5 py-10 text-center text-sm text-slate-500">
                                    Loading pool stock…
                                </td>
                            </tr>
                        ) : filtered.length === 0 ? (
                            <tr>
                                <td colSpan={6} className="px-5 py-10 text-center text-sm text-slate-500">
                                    No rolls match the current filters.
                                </td>
                            </tr>
                        ) : (
                            filtered.map((row) => {
                                const id = row.id || (row as any).label_id
                                const isSelected = selectedRow?.id === row.id
                                const days = ageDays(row)
                                return (
                                    <tr
                                        key={id}
                                        onClick={() => setSelectedRow(row)}
                                        className={cn(
                                            "cursor-pointer border-b border-slate-100 transition-colors hover:bg-blue-50/30",
                                            isSelected && "bg-blue-50/60",
                                        )}
                                    >
                                        <td className="px-5 py-2.5 align-top">
                                            <div className="font-mono-token text-[13px] font-semibold text-slate-900">
                                                {row.label_id || "—"}
                                            </div>
                                            <div className="text-[10px] text-slate-500">{days}d old</div>
                                        </td>
                                        <td className="px-3 py-2.5 align-top">
                                            <div className="text-content-2">{row.display_name || row.variant_display_name || "—"}</div>
                                            <ChipGroup className="mt-1" spacing="tight">
                                                {row.size_line && (
                                                    <Chip kind="info" size="sm" mono>
                                                        {row.size_line}
                                                    </Chip>
                                                )}
                                                {row.form_label && (
                                                    <Chip kind="neutral" size="sm">
                                                        {row.form_label}
                                                    </Chip>
                                                )}
                                                {row.stock_strategy_label && (
                                                    <Chip kind="accent" size="sm">
                                                        {row.stock_strategy_label}
                                                    </Chip>
                                                )}
                                            </ChipGroup>
                                        </td>
                                        <td className="px-3 py-2.5 align-top text-right font-mono-token tabular-nums text-slate-900">
                                            {formatKg((row as any).weight_kg)}
                                        </td>
                                        <td className="px-3 py-2.5 align-top text-slate-700">
                                            {(row as any).location_name || (row as any).location || "—"}
                                        </td>
                                        <td className="px-3 py-2.5 align-top text-slate-700">
                                            {row.stage_name || "—"}
                                        </td>
                                        <td className="px-3 py-2.5 align-top">
                                            <Chip kind={statusKind(row.status)} size="sm">
                                                {row.status || "—"}
                                            </Chip>
                                        </td>
                                    </tr>
                                )
                            })
                        )}
                    </tbody>
                </table>
            </div>

            <Sheet open={!!selectedRow} onOpenChange={(open) => { if (!open) setSelectedRow(null) }}>
                <SheetContent className="w-[min(30rem,calc(100vw-1rem))] sm:max-w-none overflow-y-auto">
                    {selectedRow && (
                        <div className="flex flex-col gap-4">
                            <SheetHeader className="space-y-1 pb-2 text-left">
                                <SheetTitle className="font-display text-lg">{selectedRow.label_id}</SheetTitle>
                                <SheetDescription className="text-xs text-content-3">
                                    {selectedRow.display_name || selectedRow.variant_display_name || "—"}
                                </SheetDescription>
                                <ChipGroup className="pt-1" spacing="tight">
                                    <Chip kind={statusKind(selectedRow.status)}>{selectedRow.status || "—"}</Chip>
                                    <Chip kind="neutral">{selectedRow.stage_name || "—"}</Chip>
                                    {selectedRow.stock_strategy_label && (
                                        <Chip kind="accent">{selectedRow.stock_strategy_label}</Chip>
                                    )}
                                </ChipGroup>
                            </SheetHeader>

                            <section className="grid grid-cols-2 gap-2 text-[12px]">
                                <PoolMeta label="Weight" value={formatKg((selectedRow as any).weight_kg)} />
                                <PoolMeta label="Width" value={(selectedRow as any).width_mm ? `${Math.round((selectedRow as any).width_mm)} mm` : "—"} />
                                <PoolMeta label="Thickness" value={(selectedRow as any).thickness_micron ? `${Math.round((selectedRow as any).thickness_micron)} μ` : "—"} />
                                <PoolMeta label="Length" value={(selectedRow as any).length_m ? `${Math.round((selectedRow as any).length_m)} m` : "—"} />
                                <PoolMeta label="Location" value={(selectedRow as any).location_name || (selectedRow as any).location || "—"} />
                                <PoolMeta label="Plant" value={(selectedRow as any).plant_name || "—"} />
                                <PoolMeta label="Origin" value={selectedRow.origin_label || selectedRow.origin_type || "—"} />
                                <PoolMeta label="Age" value={`${ageDays(selectedRow)} days`} />
                            </section>

                            {selectedRow.availability_label ? (
                                <section className="rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2 text-[11px] text-slate-700">
                                    <div className="font-semibold">Availability</div>
                                    <div className="mt-1">{selectedRow.availability_label}</div>
                                </section>
                            ) : null}

                            {selectedRow.is_quarantined ? (
                                <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-xs text-danger-fg">
                                    Quarantined — cannot be claimed.
                                </div>
                            ) : null}
                        </div>
                    )}
                </SheetContent>
            </Sheet>
        </div>
    )
}

function PoolMeta({ label, value }: { label: string; value: React.ReactNode }) {
    return (
        <div className="rounded-lg border border-slate-200 bg-surface-1 px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
            <div className="mt-0.5 font-mono-token text-[13px] text-slate-900">{value}</div>
        </div>
    )
}

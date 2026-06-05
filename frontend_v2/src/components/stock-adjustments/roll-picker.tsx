"use client"

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { Check, ChevronsUpDown, Loader2, Layers } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command"
import { listRolls, type Roll } from "@/services/rolls"

export interface RollPickerValue {
    id: string
    label_id: string
    weight_kg: number
    width_mm: number
    thickness_micron: number
    status: string
}

interface Props {
    materialId: string | null
    plantId?: string
    value: string | null
    onSelect: (roll: RollPickerValue | null) => void
    disabled?: boolean
}

const EXCLUDED_STATUSES = new Set(["CONSUMED", "SCRAPPED"])

export function RollPicker({ materialId, plantId, value, onSelect, disabled }: Props) {
    const [open, setOpen] = React.useState(false)
    const [query, setQuery] = React.useState("")

    const enabled = !!materialId
    const rolls = useQuery<Roll[]>({
        queryKey: ["rolls", "for-adjustment", materialId, plantId],
        queryFn: () => listRolls({ material: materialId || undefined }),
        enabled,
        staleTime: 30_000,
    })

    const items = React.useMemo<RollPickerValue[]>(() => {
        const list = (rolls.data as Roll[] | undefined) || []
        return list
            .filter((r) => !EXCLUDED_STATUSES.has(r.status))
            .filter((r) => (plantId ? r.plant === plantId || !r.plant : true))
            .map((r) => ({
                id: r.id,
                label_id: r.label_id,
                weight_kg: Number(r.weight_kg || 0),
                width_mm: Number(r.width_mm || 0),
                thickness_micron: Number(r.thickness_micron || 0),
                status: r.status,
            }))
    }, [rolls.data, plantId])

    const filtered = React.useMemo(() => {
        const needle = query.trim().toLowerCase()
        if (!needle) return items
        return items.filter((r) => r.label_id.toLowerCase().includes(needle))
    }, [items, query])

    const selected = items.find((i) => i.id === value) || null

    const triggerLabel = !enabled
        ? "Pick a material first"
        : selected
          ? `${selected.label_id} · ${selected.weight_kg.toFixed(2)} kg`
          : "Pick a roll…"

    return (
        <Popover open={open && enabled} onOpenChange={(v) => enabled && setOpen(v)}>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    disabled={disabled || !enabled}
                    className={cn(
                        "w-full justify-between font-mono text-xs",
                        !selected && "text-slate-500",
                    )}
                >
                    <span className="flex items-center gap-2 truncate">
                        <Layers className="h-3.5 w-3.5 shrink-0 opacity-60" />
                        <span className="truncate">{triggerLabel}</span>
                    </span>
                    <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[480px] p-0" align="start">
                <Command shouldFilter={false}>
                    <CommandInput
                        value={query}
                        onValueChange={setQuery}
                        placeholder="Search by roll label…"
                    />
                    <CommandList>
                        {rolls.isLoading ? (
                            <div className="flex items-center justify-center gap-2 p-6 text-xs text-slate-500">
                                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
                            </div>
                        ) : (
                            <>
                                <CommandEmpty>No rolls match.</CommandEmpty>
                                <CommandGroup>
                                    {filtered.slice(0, 60).map((r) => (
                                        <CommandItem
                                            key={r.id}
                                            value={r.label_id}
                                            onSelect={() => {
                                                onSelect(r)
                                                setOpen(false)
                                                setQuery("")
                                            }}
                                            className="flex items-center justify-between gap-2"
                                        >
                                            <div className="flex min-w-0 flex-col">
                                                <span className="font-mono text-[11px] font-bold text-slate-900">
                                                    {r.label_id}
                                                </span>
                                                <span className="truncate text-[10px] text-content-3">
                                                    {r.width_mm} mm × {r.thickness_micron} µ ·{" "}
                                                    <b>{r.weight_kg.toFixed(3)}</b> kg · {r.status}
                                                </span>
                                            </div>
                                            <Check
                                                className={cn(
                                                    "h-3.5 w-3.5",
                                                    selected?.id === r.id ? "opacity-100" : "opacity-0",
                                                )}
                                            />
                                        </CommandItem>
                                    ))}
                                </CommandGroup>
                                {filtered.length > 60 ? (
                                    <div className="px-2 py-1 text-[10px] text-content-4">
                                        Showing 60 of {filtered.length}.
                                    </div>
                                ) : null}
                            </>
                        )}
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    )
}

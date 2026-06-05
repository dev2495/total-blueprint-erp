"use client"

import * as React from "react"
import { useQuery } from "@tanstack/react-query"
import { Check, ChevronsUpDown, Loader2, Package } from "lucide-react"

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
import { masterDataService } from "@/services/master-data"
import { tradingGoodService, type TradingGood } from "@/services/trading-goods"

export type StockClass = "BULK" | "ROLL" | "PACKAGING" | "TRADING_GOOD"

export interface StockItemPickerValue {
    id: string
    code: string
    name: string
    uom?: string
    kind: StockClass
}

interface Props {
    stockClass: StockClass
    value: string | null
    onSelect: (item: StockItemPickerValue | null) => void
    plantId?: string
    placeholder?: string
    disabled?: boolean
}

const CATEGORY_FILTERS: Record<StockClass, (m: any) => boolean> = {
    BULK: (m) =>
        ["GRANULE", "INK", "ADHESIVE", "SOLVENT", "ADDON", "FILM_FAMILY"].includes(
            String(m?.category || "").toUpperCase(),
        ),
    PACKAGING: (m) =>
        ["PACKAGING", "POD"].includes(String(m?.category || "").toUpperCase()),
    ROLL: (m) => String(m?.category || "").toUpperCase() === "FILM_VARIANT",
    TRADING_GOOD: () => true,
}

export function StockItemPicker({
    stockClass,
    value,
    onSelect,
    placeholder,
    disabled,
}: Props) {
    const [open, setOpen] = React.useState(false)
    const [query, setQuery] = React.useState("")

    const isTradingGood = stockClass === "TRADING_GOOD"

    const library = useQuery({
        queryKey: ["material-library", "picker"],
        queryFn: () => masterDataService.getLibrary(),
        enabled: !isTradingGood,
        staleTime: 60_000,
    })

    const tradingGoods = useQuery({
        queryKey: ["trading-goods", "active"],
        queryFn: () => tradingGoodService.list({ is_active: true }),
        enabled: isTradingGood,
        staleTime: 60_000,
    })

    const items = React.useMemo<StockItemPickerValue[]>(() => {
        if (isTradingGood) {
            const list = (tradingGoods.data as TradingGood[] | undefined) || []
            return list.map((g) => ({
                id: g.id,
                code: g.code,
                name: g.name,
                uom: g.base_uom,
                kind: "TRADING_GOOD" as const,
            }))
        }
        const list = ((library.data as any[]) || []).filter(CATEGORY_FILTERS[stockClass])
        return list.map((m) => ({
            id: String(m.id),
            code: String(m.code || ""),
            name: String(m.name || ""),
            uom: m.base_uom || m.uom,
            kind: stockClass,
        }))
    }, [isTradingGood, tradingGoods.data, library.data, stockClass])

    const loading = isTradingGood ? tradingGoods.isLoading : library.isLoading

    const selected = items.find((i) => i.id === value) || null

    const filtered = React.useMemo(() => {
        const needle = query.trim().toLowerCase()
        if (!needle) return items
        return items.filter(
            (i) =>
                i.code.toLowerCase().includes(needle) ||
                i.name.toLowerCase().includes(needle),
        )
    }, [items, query])

    const labelText = selected
        ? `${selected.code} · ${selected.name}`
        : placeholder ||
          (isTradingGood ? "Pick a trading good…" : "Pick a material…")

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    disabled={disabled}
                    className={cn(
                        "w-full justify-between font-mono text-xs",
                        !selected && "text-slate-500",
                    )}
                >
                    <span className="flex items-center gap-2 truncate">
                        <Package className="h-3.5 w-3.5 shrink-0 opacity-60" />
                        <span className="truncate">{labelText}</span>
                    </span>
                    <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[420px] p-0" align="start">
                <Command shouldFilter={false}>
                    <CommandInput
                        value={query}
                        onValueChange={setQuery}
                        placeholder="Search by code or name…"
                    />
                    <CommandList>
                        {loading ? (
                            <div className="flex items-center justify-center gap-2 p-6 text-xs text-slate-500">
                                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
                            </div>
                        ) : (
                            <>
                                <CommandEmpty>No items found.</CommandEmpty>
                                <CommandGroup>
                                    {filtered.slice(0, 80).map((item) => (
                                        <CommandItem
                                            key={item.id}
                                            value={`${item.code} ${item.name}`}
                                            onSelect={() => {
                                                onSelect(item)
                                                setOpen(false)
                                                setQuery("")
                                            }}
                                            className="flex items-center justify-between gap-2"
                                        >
                                            <div className="flex min-w-0 flex-col">
                                                <span className="font-mono text-[11px] font-bold text-slate-900">
                                                    {item.code}
                                                </span>
                                                <span className="truncate text-[11px] text-content-3">
                                                    {item.name}
                                                </span>
                                            </div>
                                            <Check
                                                className={cn(
                                                    "h-3.5 w-3.5",
                                                    selected?.id === item.id
                                                        ? "opacity-100"
                                                        : "opacity-0",
                                                )}
                                            />
                                        </CommandItem>
                                    ))}
                                </CommandGroup>
                                {filtered.length > 80 ? (
                                    <div className="px-2 py-1 text-[10px] text-content-4">
                                        Showing 80 of {filtered.length} — refine search to narrow.
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

"use client"

import * as React from "react"
import { Check, ChevronsUpDown, Search } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"

interface MaterialItem {
    id: string
    code: string
    name: string
    category?: string
    type?: string
}

interface MaterialPickerProps {
    items: MaterialItem[]
    value?: string
    onValueChange: (value: string) => void
    placeholder?: string
    disabled?: boolean
    className?: string
    testId?: string
}

export function MaterialPicker({
    items = [],
    value,
    onValueChange,
    placeholder = "Select Material...",
    disabled = false,
    className,
    testId,
}: MaterialPickerProps) {
    const [open, setOpen] = React.useState(false)

    const selectedItem = items.find((item) => String(item.id) === String(value))

    // Group items by category
    const groupedItems = React.useMemo(() => {
        const groups: Record<string, MaterialItem[]> = {}
        items.forEach((item) => {
            const groupName = (item.category || item.type || "Other").toUpperCase()
            if (!groups[groupName]) {
                groups[groupName] = []
            }
            groups[groupName].push(item)
        })
        return groups
    }, [items])

    const handleSelect = React.useCallback((itemId: string) => {
        onValueChange(itemId)
        setOpen(false)
    }, [onValueChange])

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    disabled={disabled}
                    data-testid={testId}
                    className={cn(
                        "w-full justify-between h-11 border border-slate-300 bg-white rounded-lg font-semibold px-3 hover:bg-slate-50 transition-colors text-left",
                        className
                    )}
                >
                    <div className="flex items-center gap-2 truncate pr-2">
                        {selectedItem ? (
                            <>
                                <span className="bg-indigo-600 text-white text-[10px] px-1.5 py-0.5 rounded font-bold shrink-0">
                                    {selectedItem.code}
                                </span>
                                <span className="truncate text-slate-900 font-semibold text-sm">
                                    {selectedItem.name}
                                </span>
                            </>
                        ) : (
                            <span className="text-slate-500">{placeholder}</span>
                        )}
                    </div>
                    <ChevronsUpDown className="h-4 w-4 shrink-0 text-slate-600" />
                </Button>
            </PopoverTrigger>
            <PopoverContent
                className="w-[var(--radix-popover-trigger-width)] p-0 rounded-xl border border-slate-200 shadow-xl overflow-hidden bg-white"
                align="start"
                sideOffset={4}
            >
                <Command className="border-none" filter={(value, search) => {
                    if (value.toLowerCase().includes(search.toLowerCase())) return 1
                    return 0
                }}>
                    <div className="flex items-center px-3 border-b border-slate-200 bg-white">
                        <Search className="h-4 w-4 text-slate-500 mr-2" />
                        <CommandInput
                            placeholder="Search by code or name.."
                            className="h-10 border-none ring-0 focus:ring-0 bg-transparent text-slate-900 text-sm"
                        />
                    </div>
                    <CommandList className="max-h-[280px] overflow-y-auto">
                        <CommandEmpty className="py-6 text-center text-sm text-slate-500">
                            No materials found.
                        </CommandEmpty>
                        {Object.entries(groupedItems).map(([group, groupItems]) => (
                            <CommandGroup
                                key={group}
                                heading={
                                    <span className="text-[10px] font-bold uppercase tracking-widest text-indigo-600 px-1">
                                        — {group}
                                    </span>
                                }
                            >
                                {groupItems.map((item) => (
                                    <CommandItem
                                        key={item.id}
                                        value={`${item.id} ${item.code} ${item.name} ${item.category || ""}`}
                                        onSelect={() => handleSelect(item.id)}
                                        onMouseDown={(e) => {
                                            e.preventDefault()
                                            e.stopPropagation()
                                            handleSelect(item.id)
                                        }}
                                        className={cn(
                                            "flex items-center gap-2 px-3 py-2 cursor-pointer rounded-md mx-1 mb-0.5",
                                            "hover:bg-indigo-50 aria-selected:bg-indigo-600 aria-selected:text-white",
                                            "transition-colors group"
                                        )}
                                    >
                                        {/* Code badge */}
                                        <span className="text-[10px] font-bold bg-slate-100 text-slate-800 px-1.5 py-0.5 rounded shrink-0 group-aria-selected:bg-white/20 group-aria-selected:text-white">
                                            {item.code}
                                        </span>
                                        {/* Name */}
                                        <span className="font-semibold text-slate-900 text-sm truncate flex-1 group-aria-selected:text-white">
                                            {item.name}
                                        </span>
                                        {/* Category/Family badge (shown inline) */}
                                        {(item.category || item.type) && (
                                            <span className="text-[9px] font-bold uppercase text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded shrink-0 group-aria-selected:bg-white/20 group-aria-selected:text-white">
                                                {item.category || item.type}
                                            </span>
                                        )}
                                        {/* Check */}
                                        {String(value) === String(item.id) && (
                                            <Check className="h-4 w-4 text-indigo-600 group-aria-selected:text-white shrink-0" />
                                        )}
                                    </CommandItem>
                                ))}
                            </CommandGroup>
                        ))}
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    )
}

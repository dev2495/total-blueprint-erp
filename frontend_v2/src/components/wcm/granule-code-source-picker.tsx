"use client";

import * as React from "react";
import { Check, ChevronsUpDown, MapPin, Search, Warehouse } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type GranuleCodeSourceOption = {
  granule_code_id: string;
  code: string;
  available_qty_kg: number;
  location_id: string | null;
  location_name: string;
  plant_id: string | null;
  plant_name: string;
  allocation_scope?: string;
  eligibility_status?: string;
  status_reason?: string;
  can_allocate?: boolean;
  transfer_required?: boolean;
};

type Props = {
  options: GranuleCodeSourceOption[];
  value: string;
  onValueChange: (value: string) => void;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  ariaLabel: string;
};

function optionValue(option: GranuleCodeSourceOption) {
  return `${option.granule_code_id}::${option.location_id || ""}`;
}

export function GranuleCodeSourcePicker({
  options,
  value,
  onValueChange,
  onOpenChange,
  disabled,
  ariaLabel,
}: Props) {
  const [open, setOpen] = React.useState(false);
  const selected = options.find((option) => optionValue(option) === value);

  const setOpenState = React.useCallback(
    (next: boolean) => {
      setOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );

  return (
    <Popover open={open} onOpenChange={setOpenState}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open}
          disabled={disabled}
          className="h-10 w-full justify-between rounded-lg border-line bg-surface-1 px-3 text-left text-xs font-semibold hover:bg-surface-2"
        >
          {selected ? (
            <span className="flex min-w-0 items-center gap-2">
              <span className="shrink-0 font-black text-content-1">{selected.code}</span>
              <span className="truncate text-content-3">
                {selected.plant_name} / {selected.location_name}
              </span>
              <span className="ml-auto shrink-0 font-mono tabular-nums text-success-fg">
                {Number(selected.available_qty_kg || 0).toFixed(3)} kg
              </span>
            </span>
          ) : (
            <span className="text-content-3">Search grade/code or source store</span>
          )}
          <ChevronsUpDown className="ml-2 size-4 shrink-0 text-content-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={5}
        className="w-[var(--radix-popover-trigger-width)] min-w-[360px] overflow-hidden rounded-xl border-line bg-surface-1 p-0 shadow-xl"
      >
        <Command
          filter={(candidate, search) =>
            candidate.toLowerCase().includes(search.toLowerCase()) ? 1 : 0
          }
        >
          <div className="flex items-center border-b border-line px-3">
            <Search className="mr-2 size-4 text-content-3" />
            <CommandInput
              placeholder="Search code, plant or store"
              className="h-11 border-0 bg-transparent px-0 text-sm focus:ring-0"
            />
          </div>
          <CommandList className="max-h-[320px]">
            <CommandEmpty className="px-4 py-8 text-center text-sm text-content-3">
              No allocatable code or source matches this search.
            </CommandEmpty>
            <CommandGroup heading="Ready in this plant">
              {options.map((option) => {
                const candidate = optionValue(option);
                const exactStore = option.allocation_scope === "ISSUE_LOCATION";
                return (
                  <CommandItem
                    key={candidate}
                    value={`${candidate} ${option.code} ${option.plant_name} ${option.location_name}`}
                    onSelect={() => {
                      onValueChange(candidate);
                      setOpenState(false);
                    }}
                    className="mx-1 mb-1 grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-lg px-3 py-2.5 aria-selected:bg-success-bg"
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className="font-black text-content-1">{option.code}</span>
                        <span
                          className={cn(
                            "rounded-full px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider",
                            exactStore
                              ? "bg-success-bg text-success-fg"
                              : "bg-info-bg text-primary",
                          )}
                        >
                          {exactStore ? "Issue store" : "Same plant"}
                        </span>
                      </span>
                      <span className="mt-1 flex items-center gap-1 truncate text-[11px] font-medium text-content-3">
                        {exactStore ? <MapPin className="size-3" /> : <Warehouse className="size-3" />}
                        {option.plant_name} / {option.location_name}
                      </span>
                    </span>
                    <span className="flex items-center gap-2 self-center">
                      <span className="font-mono text-xs font-black tabular-nums text-content-1">
                        {Number(option.available_qty_kg || 0).toFixed(3)} kg
                      </span>
                      <Check
                        className={cn(
                          "size-4 text-success-fg",
                          value === candidate ? "opacity-100" : "opacity-0",
                        )}
                      />
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

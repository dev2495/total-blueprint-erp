"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { GranuleCodeSourcePicker, type GranuleCodeSourceOption } from "./granule-code-source-picker";

export type GranuleAllocation = {
  granule_code_id: string;
  source_location_id: string;
  qty_kg: string;
};

const kg = (value: number) =>
  value.toLocaleString("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

/**
 * Grade-code split for one granule family. Fastest path: tap a code card to take the balance from
 * it (capped at its free stock). For a part amount, pick the code and store, type kg, Add. Added
 * codes show as a short list; the pickers stay until every issued kilogram has a code (machine
 * release waits for that), so the section never grows one form per code.
 */
export function GranuleAllocationBox({
  materialName,
  issuedKg,
  allocations,
  options,
  disabled,
  onChange,
  onPickerOpenChange,
}: {
  materialName: string;
  issuedKg: number;
  allocations: GranuleAllocation[];
  options: GranuleCodeSourceOption[];
  disabled?: boolean;
  onChange: (allocations: GranuleAllocation[]) => void;
  onPickerOpenChange?: (open: boolean) => void;
}) {
  const [pick, setPick] = React.useState("");
  const [qty, setQty] = React.useState("");
  const complete = allocations.filter(
    (row) => row.granule_code_id && row.source_location_id && Number(row.qty_kg || 0) > 0,
  );
  const unfinished = allocations.length - complete.length;
  const allocatedKg = complete.reduce((sum, row) => sum + Number(row.qty_kg || 0), 0);
  const remaining = Math.max(0, Math.round((issuedKg - allocatedKg) * 1000) / 1000);
  const optionFor = (row: GranuleAllocation) =>
    options.find(
      (option) =>
        option.granule_code_id === row.granule_code_id &&
        String(option.location_id || "") === String(row.source_location_id || ""),
    );
  const picked = options.find(
    (option) => `${option.granule_code_id}::${option.location_id || ""}` === pick,
  );
  const amount = Number(qty || remaining);

  const allocatedFrom = (option: GranuleCodeSourceOption) =>
    complete
      .filter(
        (row) =>
          row.granule_code_id === option.granule_code_id &&
          String(row.source_location_id || "") === String(option.location_id || ""),
      )
      .reduce((sum, row) => sum + Number(row.qty_kg || 0), 0);
  const quickOptions = [...options]
    .map((option) => ({ option, left: Math.max(0, Number(option.available_qty_kg || 0) - allocatedFrom(option)) }))
    .sort((a, b) => b.left - a.left);

  const add = (override?: { key: string; kg: number }) => {
    const key = override?.key ?? pick;
    const take = override?.kg ?? amount;
    if (!key || !(take > 0)) return;
    const [granuleCodeId, sourceLocationId] = key.split("::");
    const existing = complete.findIndex(
      (row) => row.granule_code_id === granuleCodeId && row.source_location_id === sourceLocationId,
    );
    const next =
      existing >= 0
        ? complete.map((row, index) =>
            index === existing ? { ...row, qty_kg: (Number(row.qty_kg || 0) + take).toFixed(3) } : row,
          )
        : [...complete, { granule_code_id: granuleCodeId, source_location_id: sourceLocationId, qty_kg: take.toFixed(3) }];
    onChange(next);
    setPick("");
    setQty("");
  };

  return (
    <div className="space-y-2" data-testid="granule-allocation-box">
      {complete.length ? (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface-1" aria-label={`Grade codes for ${materialName}`}>
          {complete.map((row) => {
            const option = optionFor(row);
            return (
              <li key={`${row.granule_code_id}::${row.source_location_id}`} className="flex items-center gap-3 px-3 py-1.5 text-xs">
                <span className="font-mono font-bold text-content-1">{option?.code || "Grade code"}</span>
                <span className="min-w-0 flex-1 truncate text-content-3">
                  {option ? `${option.plant_name} · ${option.location_name}` : "Store"}
                </span>
                <span className="font-mono font-bold tabular-nums text-content-1">{kg(Number(row.qty_kg || 0))} kg</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={disabled}
                  aria-label={`Remove ${option?.code || "grade code"} from ${materialName}`}
                  className="h-8 w-8 rounded-lg text-content-4 hover:text-danger-fg"
                  onClick={() => onChange(complete.filter((item) => item !== row))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}

      {unfinished > 0 ? (
        <p className="text-caption font-semibold text-warning-fg">
          {unfinished} unfinished row{unfinished === 1 ? "" : "s"} without a code will be dropped when you add a code.
        </p>
      ) : null}

      {remaining > 0 && quickOptions.some((row) => row.left > 0) ? (
        <div className="space-y-1.5" data-testid="granule-quick-pick">
          <div className="text-caption font-semibold text-content-3">
            Tap a code to take the balance from it ({kg(remaining)} kg left)
          </div>
          <div className="grid max-h-[208px] gap-1.5 overflow-y-auto pr-0.5 sm:grid-cols-2">
            {quickOptions.map(({ option, left }) => {
              const take = Math.min(remaining, left);
              return (
                <button
                  key={`${option.granule_code_id}::${option.location_id || ""}`}
                  type="button"
                  disabled={disabled || !(take > 0)}
                  aria-label={`Take ${kg(take)} kg of ${materialName} from ${option.code} in ${option.location_name}`}
                  data-testid={`granule-quick-${option.code}`}
                  onClick={() => add({ key: `${option.granule_code_id}::${option.location_id || ""}`, kg: Math.round(take * 1000) / 1000 })}
                  className="flex min-h-[48px] items-center justify-between gap-2 rounded-xl border border-line bg-surface-1 px-3 py-1.5 text-left transition-colors hover:border-success-border hover:bg-success-bg disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-mono text-[13px] font-bold text-content-1">{option.code}</span>
                    <span className="block truncate text-caption text-content-3">
                      {option.plant_name} · {option.location_name} · {kg(left)} kg free
                    </span>
                  </span>
                  <span className="shrink-0 rounded-lg bg-success-bg px-2 py-1 font-mono text-caption font-bold tabular-nums text-success-fg">
                    +{kg(take)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {remaining > 0 && options.length ? (
        <div className="grid gap-2 rounded-xl border border-dashed border-success-border bg-success-bg p-2 md:grid-cols-[minmax(0,1fr)_120px_auto] md:items-center">
          <GranuleCodeSourcePicker
            ariaLabel={`Grade code and source for ${materialName}`}
            options={options}
            value={pick}
            disabled={disabled}
            onOpenChange={onPickerOpenChange}
            onValueChange={setPick}
          />
          <Input
            value={qty}
            inputMode="decimal"
            placeholder={kg(remaining)}
            aria-label={`Kilograms of ${materialName} from this code (blank = balance ${kg(remaining)} kg)`}
            className="h-10 rounded-lg border-line bg-surface-1 text-right text-xs font-bold tabular-nums"
            disabled={disabled}
            onChange={(event) => setQty(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                add();
              }
            }}
          />
          <Button
            type="button"
            size="sm"
            className="h-10 rounded-lg px-3 text-xs font-bold"
            disabled={disabled || !pick || !(amount > 0)}
            onClick={() => add()}
          >
            <Plus className="mr-1 h-4 w-4" aria-hidden />
            Add code
          </Button>
          <div className={cn("text-caption font-semibold md:col-span-3", picked && amount > Number(picked.available_qty_kg || 0) ? "text-warning-fg" : "text-content-3")}>
            {kg(remaining)} kg still needs a grade code
            {picked ? ` · ${picked.code} has ${kg(Number(picked.available_qty_kg || 0))} kg in ${picked.location_name}` : ""}
          </div>
        </div>
      ) : null}
    </div>
  );
}

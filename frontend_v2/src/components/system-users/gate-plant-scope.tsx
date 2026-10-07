"use client";

import { Check, DoorOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Plant } from "@/services/factory";

/**
 * Gate assignment for a WATCHMAN (GateAssignment rows). An empty assignment
 * is allowed to save but locks the gate terminal with an explanatory page.
 */
export function GatePlantScopeSection({
  canManage,
  loading,
  isWatchman,
  plants,
  selectedIds,
  onToggle,
}: {
  canManage: boolean;
  loading: boolean;
  isWatchman: boolean;
  plants: Plant[];
  selectedIds: Set<string>;
  onToggle: (plantId: string) => void;
}) {
  const count = plants.filter((p) => selectedIds.has(String(p.id))).length;
  return (
    <section className="rounded-3xl bg-surface-1 p-6 shadow-[0_20px_60px_-30px_rgba(15,23,42,0.25)] ring-1 ring-line" data-testid="gate-plant-scope">
      <div className="-m-6 mb-4 h-1.5 bg-gradient-to-r from-info-fg to-warm" />
      <header className="mb-4 mt-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-2xl bg-info-bg text-info-fg">
            <DoorOpen className="h-4 w-4" />
          </div>
          <div>
            <h3 className="font-display text-sm font-bold text-content-1">Gate assignment</h3>
            <p className="text-[11px] text-content-3">
              Plants whose gate this watchman can log. Watchman access is limited to the gate terminal.
            </p>
          </div>
        </div>
        <Badge
          className={cn(
            "ring-1",
            isWatchman && count === 0
              ? "bg-warning-bg text-warning-fg ring-warning-border"
              : count > 0
                ? "bg-success-bg text-success-fg ring-success-border"
                : "bg-surface-2 text-content-2 ring-line",
          )}
        >
          {count} gate{count === 1 ? "" : "s"}
        </Badge>
      </header>

      {isWatchman && count === 0 ? (
        <div className="mb-4 rounded-2xl bg-warning-bg px-4 py-3 text-xs font-medium text-warning-fg ring-1 ring-warning-border">
          No gate assigned — this watchman will see a &ldquo;Gate not assigned&rdquo; screen and cannot log anything.
        </div>
      ) : null}

      {loading ? (
        <p className="text-sm text-content-3">Loading plants…</p>
      ) : plants.length === 0 ? (
        <p className="text-sm text-content-3">No plants found.</p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {plants.map((plant) => {
            const selected = selectedIds.has(String(plant.id));
            return (
              <button
                key={plant.id}
                type="button"
                role="checkbox"
                aria-checked={selected}
                disabled={!canManage}
                onClick={() => onToggle(String(plant.id))}
                className={cn(
                  "flex min-h-[52px] items-center gap-3 rounded-2xl px-4 py-2 text-left ring-1 transition-colors disabled:opacity-60",
                  selected ? "bg-info-bg ring-info-border" : "bg-surface-2 ring-line hover:bg-surface-1",
                )}
              >
                <span
                  className={cn(
                    "grid h-5 w-5 shrink-0 place-items-center rounded-md ring-1",
                    selected ? "bg-info-fg text-white ring-info-fg" : "bg-surface-1 ring-line",
                  )}
                >
                  {selected ? <Check className="h-3.5 w-3.5" /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-content-1">{plant.name}</span>
                  <span className="block font-mono text-[11px] text-content-4">{plant.code}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

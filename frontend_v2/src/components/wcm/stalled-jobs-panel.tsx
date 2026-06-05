"use client";

import * as React from "react";
import { AlarmClockOff, RefreshCw, TriangleAlert } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import type { StalledJob } from "@/services/wcm";

function formatIdle(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

export interface StalledJobsPanelProps {
  jobs: StalledJob[];
  isLoading?: boolean;
  isFetching?: boolean;
  onRefresh?: () => void;
  className?: string;
}

/**
 * Read-only amber panel surfacing EXECUTING jobs that have gone idle
 * (no execution/scrap/downtime/quality log in the stall window).
 * This is the agreed replacement for auto-pause: visibility, not action.
 */
export function StalledJobsPanel({
  jobs,
  isLoading,
  isFetching,
  onRefresh,
  className,
}: StalledJobsPanelProps) {
  const rows = Array.isArray(jobs) ? jobs : [];

  return (
    <section
      data-testid="wcm-stalled-panel"
      className={cn(
        "overflow-hidden rounded-3xl bg-gradient-to-br from-warning-bg to-warm p-5 shadow-sm ring-1 ring-warning-border",
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="grid size-10 place-items-center rounded-2xl bg-warning-fg text-white shadow-sm">
            <TriangleAlert className="size-5" />
          </div>
          <div>
            <h2 className="font-display text-lg font-bold tracking-tight text-warning-fg">
              Stalled jobs
            </h2>
            <p className="text-xs font-medium text-warning-fg">
              EXECUTING with no log activity in the last 60 minutes. Read-only —
              follow up on the floor.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-warning-fg px-2.5 py-1 font-mono text-xs font-bold tabular-nums text-warning-fg ring-1 ring-warning-border">
            {rows.length}
          </span>
          {onRefresh ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRefresh}
              disabled={Boolean(isFetching)}
              className="h-9 gap-1.5 rounded-xl border-warning-border bg-surface-1/70 text-xs font-bold text-warning-fg hover:bg-surface-1"
            >
              <RefreshCw
                className={cn("size-3.5", isFetching && "animate-spin")}
              />
              Refresh
            </Button>
          ) : null}
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-16 animate-pulse rounded-2xl bg-surface-1/60 ring-1 ring-warning-border"
              />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex items-center gap-2 rounded-2xl bg-surface-1/70 px-4 py-6 text-sm font-semibold text-warning-fg ring-1 ring-warning-border">
            <AlarmClockOff className="size-4" />
            No stalled jobs. Every running job has logged activity recently.
          </div>
        ) : (
          rows.map((job) => (
            <div
              key={job.job_id}
              data-testid={`wcm-stalled-row-${job.job_id}`}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-surface-1/80 px-4 py-3 shadow-sm ring-1 ring-warning-border"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-bold text-content-1">
                    {job.job_number}
                  </span>
                  <span className="text-sm font-semibold text-content-3">
                    {job.customer_name || "Customer"}
                  </span>
                </div>
                <div className="mt-0.5 truncate text-xs text-content-3">
                  {job.product_name || "Product"} ·{" "}
                  {job.machine_name || "Machine"}
                  {job.work_center_name ? ` · ${job.work_center_name}` : ""}
                </div>
              </div>
              <div className="text-right">
                <div className="font-mono text-xl font-bold tabular-nums text-warning-fg">
                  {formatIdle(job.idle_minutes)}
                </div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-warning-fg">
                  Idle
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

export default StalledJobsPanel;

"use client"

import * as React from "react"
import { AlarmClockOff, RefreshCw, TriangleAlert } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import type { StalledJob } from "@/services/wcm"

function formatIdle(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const rem = m % 60
  return rem ? `${h}h ${rem}m` : `${h}h`
}

export interface StalledJobsPanelProps {
  jobs: StalledJob[]
  isLoading?: boolean
  isFetching?: boolean
  onRefresh?: () => void
  className?: string
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
  const rows = Array.isArray(jobs) ? jobs : []

  return (
    <section
      data-testid="wcm-stalled-panel"
      className={cn(
        "overflow-hidden rounded-3xl bg-gradient-to-br from-amber-50 to-orange-50 p-5 shadow-sm ring-1 ring-amber-200",
        className
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="grid size-10 place-items-center rounded-2xl bg-amber-500 text-white shadow-sm">
            <TriangleAlert className="size-5" />
          </div>
          <div>
            <h2 className="font-display text-lg font-bold tracking-tight text-amber-900">Stalled jobs</h2>
            <p className="text-xs font-medium text-warning-fg">
              EXECUTING with no log activity in the last 60 minutes. Read-only — follow up on the floor.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-amber-500/15 px-2.5 py-1 font-mono text-xs font-bold tabular-nums text-amber-800 ring-1 ring-amber-300">
            {rows.length}
          </span>
          {onRefresh ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onRefresh}
              disabled={Boolean(isFetching)}
              className="h-9 gap-1.5 rounded-xl border-amber-300 bg-white/70 text-xs font-bold text-amber-800 hover:bg-surface-1"
            >
              <RefreshCw className={cn("size-3.5", isFetching && "animate-spin")} />
              Refresh
            </Button>
          ) : null}
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-2xl bg-white/60 ring-1 ring-amber-100" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex items-center gap-2 rounded-2xl bg-white/70 px-4 py-6 text-sm font-semibold text-amber-800 ring-1 ring-amber-100">
            <AlarmClockOff className="size-4" />
            No stalled jobs. Every running job has logged activity recently.
          </div>
        ) : (
          rows.map((job) => (
            <div
              key={job.job_id}
              data-testid={`wcm-stalled-row-${job.job_id}`}
              className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white/80 px-4 py-3 shadow-sm ring-1 ring-amber-100"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm font-bold text-slate-900">{job.job_number}</span>
                  <span className="text-sm font-semibold text-content-3">{job.customer_name || "Customer"}</span>
                </div>
                <div className="mt-0.5 truncate text-xs text-slate-500">
                  {job.product_name || "Product"} · {job.machine_name || "Machine"}
                  {job.work_center_name ? ` · ${job.work_center_name}` : ""}
                </div>
              </div>
              <div className="text-right">
                <div className="font-mono text-xl font-bold tabular-nums text-warning-fg">{formatIdle(job.idle_minutes)}</div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-amber-600">Idle</div>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  )
}

export default StalledJobsPanel

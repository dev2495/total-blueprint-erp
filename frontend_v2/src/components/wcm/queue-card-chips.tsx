"use client"

import * as React from "react"
import { CircleCheck, CircleSlash, Clock3, PackageX, TriangleAlert } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Map common print ink-color names to a representative hex swatch.
 * Falls back to a neutral slate for unknown / custom colors so the dot
 * still renders (no hidden swatches).
 */
const INK_COLOR_HEX: Record<string, string> = {
  black: "#0f172a",
  k: "#0f172a",
  white: "#f8fafc",
  cyan: "#06b6d4",
  c: "#06b6d4",
  magenta: "#db2777",
  m: "#db2777",
  yellow: "#facc15",
  y: "#facc15",
  red: "#ef4444",
  green: "#22c55e",
  blue: "#2563eb",
  navy: "#1e3a8a",
  orange: "#f97316",
  violet: "#7c3aed",
  purple: "#7c3aed",
  pink: "#ec4899",
  brown: "#92400e",
  gold: "#d4af37",
  silver: "#cbd5e1",
  grey: "#94a3b8",
  gray: "#94a3b8",
  transparent: "#e2e8f0",
  clear: "#e2e8f0",
}

function inkHex(name: string): string {
  const key = String(name || "").trim().toLowerCase()
  if (!key) return "#94a3b8"
  if (INK_COLOR_HEX[key]) return INK_COLOR_HEX[key]
  // Try a leading token, e.g. "Process Cyan" -> "cyan", "Pantone 485 Red" -> "red".
  for (const token of key.split(/[^a-z]+/).reverse()) {
    if (token && INK_COLOR_HEX[token]) return INK_COLOR_HEX[token]
  }
  return "#94a3b8"
}

export interface InkColorSwatchesProps {
  colors?: string[] | null
  /** Maximum dots to render before collapsing into a "+N" pill. */
  max?: number
  className?: string
}

/**
 * Small colored dots for the job's committed-artwork ink colors.
 * Renders nothing when there are no colors (e.g. unprinted steps).
 */
export function InkColorSwatches({ colors, max = 6, className }: InkColorSwatchesProps) {
  const list = Array.isArray(colors) ? colors.filter((c) => String(c || "").trim()) : []
  if (!list.length) return null
  const shown = list.slice(0, max)
  const overflow = list.length - shown.length

  return (
    <div className={cn("flex items-center gap-1.5", className)} aria-label={`Ink colors: ${list.join(", ")}`}>
      <span className="text-[10px] font-bold uppercase tracking-wider text-content-4">Ink</span>
      <div className="flex items-center -space-x-0.5">
        {shown.map((color, idx) => (
          <span
            key={`${color}-${idx}`}
            title={color}
            className="size-3.5 rounded-full ring-2 ring-white shadow-sm"
            style={{ backgroundColor: inkHex(color) }}
          />
        ))}
      </div>
      {overflow > 0 ? (
        <span className="font-mono text-[10px] font-bold text-slate-500">+{overflow}</span>
      ) : null}
    </div>
  )
}

export interface CylinderReadyChipProps {
  status?: "READY" | "MISSING" | "NA" | null
  ready?: boolean | null
  className?: string
}

/**
 * Cylinder readiness pill. Emerald when ready, rose when a required
 * cylinder is missing, hidden when the step is not print-capable (NA).
 */
export function CylinderReadyChip({ status, ready, className }: CylinderReadyChipProps) {
  const resolved = status ?? (ready === true ? "READY" : ready === false ? "MISSING" : "NA")
  if (resolved === "NA") return null
  const isReady = resolved === "READY"
  return (
    <span
      data-testid="wcm-cylinder-chip"
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ring-1",
        isReady
          ? "bg-success-bg text-success-fg ring-emerald-200"
          : "bg-danger-bg text-danger-fg ring-rose-200",
        className
      )}
    >
      {isReady ? <CircleCheck className="size-3.5" /> : <CircleSlash className="size-3.5" />}
      {isReady ? "Cylinder ready" : "Cylinder missing"}
    </span>
  )
}

export interface MaterialBlockChipProps {
  blocked?: boolean | null
  reason?: string | null
  className?: string
}

/**
 * Inline "Material short" chip for blocked queue cards so the lead sees it
 * without opening the job. Renders nothing when not blocked.
 */
export function MaterialBlockChip({ blocked, reason, className }: MaterialBlockChipProps) {
  if (!blocked) return null
  const text = String(reason || "").trim()
  return (
    <span
      data-testid="wcm-material-block-chip"
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-danger-bg px-2.5 py-1 text-xs font-bold text-danger-fg ring-1 ring-rose-200",
        className
      )}
      title={text || "Material short"}
    >
      <PackageX className="size-3.5 shrink-0" />
      {text ? `Material short — ${text}` : "Material short"}
    </span>
  )
}

export interface ElapsedStalledBadgeProps {
  /** Minutes since the job was assigned/started. */
  elapsedMinutes?: number | null
  /** True when EXECUTING but no logs in the stall window. */
  isStalled?: boolean | null
  className?: string
}

function formatElapsed(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const rem = m % 60
  return rem ? `${h}h ${rem}m` : `${h}h`
}

/**
 * Elapsed-time pill for running cards, plus a prominent rose "Stalled" badge
 * when the job is EXECUTING with no recent log activity.
 */
export function ElapsedStalledBadge({ elapsedMinutes, isStalled, className }: ElapsedStalledBadgeProps) {
  const hasElapsed = typeof elapsedMinutes === "number" && Number.isFinite(elapsedMinutes)
  if (!hasElapsed && !isStalled) return null
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {hasElapsed ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-content-3 ring-1 ring-slate-200">
          <Clock3 className="size-3.5" />
          <span className="font-mono tabular-nums">{formatElapsed(elapsedMinutes as number)}</span>
          <span className="font-medium text-content-4">elapsed</span>
        </span>
      ) : null}
      {isStalled ? (
        <span
          data-testid="wcm-stalled-badge"
          className="inline-flex items-center gap-1 rounded-full bg-danger-bg px-2.5 py-1 text-xs font-bold text-danger-fg ring-1 ring-rose-300 animate-pulse"
        >
          <TriangleAlert className="size-3.5" />
          {hasElapsed ? `Stalled — no log ${formatElapsed(elapsedMinutes as number)}` : "Stalled — no log"}
        </span>
      ) : null}
    </div>
  )
}

export type MachineLiveState = "IDLE" | "RUNNING" | "DOWN"

export interface MachineStateBadgeProps {
  state?: MachineLiveState | null
  currentJobNumber?: string | null
  className?: string
}

/**
 * Right-aligned state badge for the assign-machine <Select> options.
 * Idle = emerald, Running = sky (with job number), Down = rose.
 */
export function MachineStateBadge({ state, currentJobNumber, className }: MachineStateBadgeProps) {
  const resolved: MachineLiveState = state ?? "IDLE"
  if (resolved === "RUNNING") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full bg-info-bg px-2 py-0.5 text-[11px] font-bold text-info-fg ring-1 ring-sky-200",
          className
        )}
      >
        <span className="size-1.5 rounded-full bg-sky-500" />
        Running{currentJobNumber ? ` ${currentJobNumber}` : ""}
      </span>
    )
  }
  if (resolved === "DOWN") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full bg-danger-bg px-2 py-0.5 text-[11px] font-bold text-danger-fg ring-1 ring-rose-200",
          className
        )}
      >
        <span className="size-1.5 rounded-full bg-rose-500" />
        Down
      </span>
    )
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-success-bg px-2 py-0.5 text-[11px] font-bold text-success-fg ring-1 ring-emerald-200",
        className
      )}
    >
      <span className="size-1.5 rounded-full bg-emerald-500" />
      Idle
    </span>
  )
}

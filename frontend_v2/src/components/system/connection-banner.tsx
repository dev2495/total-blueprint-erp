"use client"

import * as React from "react"
import { CloudOff, RefreshCw, WifiOff } from "lucide-react"

import { cn } from "@/lib/utils"

export interface ConnectionLostBannerProps {
  /** Browser/network connectivity (navigator.onLine + reachability). */
  online: boolean
  /** True when the last successful sync is older than the stale threshold. */
  stale: boolean
  /** Seconds since the last successful sync, used in the stale copy. */
  secondsSinceSync?: number
  /** Optional manual retry handler (e.g. queryClient.refetchQueries). */
  onRetry?: () => void
  className?: string
}

/**
 * Sticky top banner for factory tablets.
 * - Offline -> red "Connection lost — changes may not save".
 * - Online but stale -> amber "Reconnecting… last synced Ns ago".
 * - Healthy -> renders nothing.
 *
 * Rendered above page content; uses `sticky top-0 z-50` so it stays pinned
 * while the operator scrolls a long queue.
 */
export function ConnectionLostBanner({
  online,
  stale,
  secondsSinceSync,
  onRetry,
  className,
}: ConnectionLostBannerProps) {
  // Healthy: nothing to show.
  if (online && !stale) return null

  const isOffline = !online

  return (
    <div
      role="status"
      aria-live="assertive"
      className={cn(
        "sticky top-0 z-50 flex items-center justify-center gap-2.5 px-4 py-2 text-sm font-bold tracking-tight shadow-sm ring-1",
        isOffline
          ? "bg-gradient-to-r from-rose-600 to-red-600 text-white ring-rose-700/40"
          : "bg-gradient-to-r from-amber-400 to-amber-500 text-amber-950 ring-amber-600/30",
        className
      )}
      data-testid="connection-lost-banner"
      data-state={isOffline ? "offline" : "stale"}
    >
      {isOffline ? (
        <>
          <WifiOff className="size-4 shrink-0" />
          <span>Connection lost — changes may not save</span>
        </>
      ) : (
        <>
          <CloudOff className="size-4 shrink-0 animate-pulse" />
          <span>
            Reconnecting… last synced{" "}
            <span className="font-mono tabular-nums">{Math.max(0, secondsSinceSync ?? 0)}s</span> ago
          </span>
        </>
      )}

      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className={cn(
            "ml-1 inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide transition-colors",
            isOffline
              ? "bg-white/15 text-white hover:bg-white/25"
              : "bg-amber-950/10 text-amber-950 hover:bg-amber-950/20"
          )}
        >
          <RefreshCw className="size-3" /> Retry
        </button>
      ) : null}
    </div>
  )
}

export default ConnectionLostBanner

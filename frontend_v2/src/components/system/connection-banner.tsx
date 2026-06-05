"use client";

import * as React from "react";
import { CloudOff, RefreshCw, WifiOff } from "lucide-react";

import { cn } from "@/lib/utils";

export interface ConnectionLostBannerProps {
  /** Browser/network connectivity (navigator.onLine + reachability). */
  online: boolean;
  /** True when the last successful sync is older than the stale threshold. */
  stale: boolean;
  /** Seconds since the last successful sync, used in the stale copy. */
  secondsSinceSync?: number;
  /** Optional manual retry handler (e.g. queryClient.refetchQueries). */
  onRetry?: () => void;
  className?: string;
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
  if (online && !stale) return null;

  const isOffline = !online;

  return (
    <div
      role="status"
      aria-live="assertive"
      className={cn(
        "sticky top-0 z-50 flex items-center justify-center gap-2.5 px-4 py-2 text-sm font-bold tracking-tight shadow-sm ring-1",
        isOffline
          ? "bg-gradient-to-r from-danger-solid to-danger-solid text-white ring-danger-border"
          : "bg-gradient-to-r from-warning-fg to-warning-fg text-warning-fg ring-warning-border",
        className,
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
            <span className="font-mono tabular-nums">
              {Math.max(0, secondsSinceSync ?? 0)}s
            </span>{" "}
            ago
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
              ? "bg-surface-1/15 text-white hover:bg-surface-1/25"
              : "bg-warning-fg text-warning-fg hover:bg-warning-fg",
          )}
        >
          <RefreshCw className="size-3" /> Retry
        </button>
      ) : null}
    </div>
  );
}

export default ConnectionLostBanner;

"use client"

import * as React from "react"

export interface OnlineStatus {
  /** navigator.onLine, kept live via online/offline events. */
  online: boolean
  /** Timestamp of the last successful query (set via markSynced). */
  lastSyncAt: Date | null
  /** Call from React Query onSuccess to record a healthy refetch. */
  markSynced: () => void
  /** Whole seconds since the last successful sync. 0 when never synced. */
  secondsSinceSync: number
}

/** A sync older than this is considered stale (matches ConnectionLostBanner). */
export const STALE_THRESHOLD_SECONDS = 30

function readNavigatorOnline(): boolean {
  if (typeof navigator === "undefined") return true
  // Some environments leave onLine undefined; treat as online.
  return navigator.onLine !== false
}

/**
 * Tracks browser connectivity for factory tablets.
 *
 * Combines `navigator.onLine` (online/offline events) with an
 * application-level "last successful sync" clock. Pages call `markSynced()`
 * inside their React Query `onSuccess`/`meta` handlers; if more than
 * STALE_THRESHOLD_SECONDS elapse without a successful refetch the connection
 * is treated as stale even when the browser still reports online (e.g. the API
 * is unreachable but Wi‑Fi is up).
 */
export function useOnlineStatus(): OnlineStatus {
  const [online, setOnline] = React.useState<boolean>(() => readNavigatorOnline())
  const [lastSyncAt, setLastSyncAt] = React.useState<Date | null>(null)
  const [now, setNow] = React.useState<number>(() => Date.now())

  React.useEffect(() => {
    if (typeof window === "undefined") return

    const handleOnline = () => setOnline(true)
    const handleOffline = () => setOnline(false)

    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)

    // Resync state on mount in case events fired before listeners attached.
    setOnline(readNavigatorOnline())

    return () => {
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
    }
  }, [])

  // Tick once per second so `secondsSinceSync` stays current without callers
  // needing their own interval. Cheap: a single state update per second.
  React.useEffect(() => {
    if (typeof window === "undefined") return
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const markSynced = React.useCallback(() => {
    const stamp = new Date()
    setLastSyncAt(stamp)
    setNow(stamp.getTime())
    // A successful sync implies connectivity; reflect it immediately.
    setOnline(readNavigatorOnline())
  }, [])

  const secondsSinceSync = React.useMemo(() => {
    if (!lastSyncAt) return 0
    const delta = Math.floor((now - lastSyncAt.getTime()) / 1000)
    return delta > 0 ? delta : 0
  }, [lastSyncAt, now])

  return { online, lastSyncAt, markSynced, secondsSinceSync }
}

export default useOnlineStatus

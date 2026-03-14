"use client"

import { useEffect } from "react"

const RECOVERY_FLAG = "__tbp_chunk_recovery_once__"

function shouldRecoverChunkFailure(message: string): boolean {
    const text = String(message || "").toLowerCase()
    return text.includes("loading chunk") || text.includes("chunkloaderror")
}

function recoverOnce() {
    try {
        if (typeof window === "undefined") return
        if ((window as any)[RECOVERY_FLAG]) return
        ;(window as any)[RECOVERY_FLAG] = true
        window.location.reload()
    } catch {
        // Keep runtime safe even if reload is blocked.
    }
}

export function ChunkLoadRecovery() {
    useEffect(() => {
        const onWindowError = (event: ErrorEvent) => {
            const message = String(event?.message || event?.error?.message || "")
            if (shouldRecoverChunkFailure(message)) {
                recoverOnce()
            }
        }

        const onUnhandledRejection = (event: PromiseRejectionEvent) => {
            const reason = event?.reason
            const message =
                typeof reason === "string"
                    ? reason
                    : String(reason?.message || reason || "")
            if (shouldRecoverChunkFailure(message)) {
                recoverOnce()
            }
        }

        window.addEventListener("error", onWindowError)
        window.addEventListener("unhandledrejection", onUnhandledRejection)
        return () => {
            window.removeEventListener("error", onWindowError)
            window.removeEventListener("unhandledrejection", onUnhandledRejection)
        }
    }, [])

    return null
}


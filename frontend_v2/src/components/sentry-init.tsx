"use client"

import { useEffect } from "react"
import * as Sentry from "@sentry/browser"

let sentryInitialized = false

export function SentryInit() {
    useEffect(() => {
        const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN
        if (!dsn || sentryInitialized) {
            return
        }

        Sentry.init({
            dsn,
            environment: process.env.NEXT_PUBLIC_APP_ENV || "unknown",
            tracesSampleRate: 0.1,
        })
        sentryInitialized = true

        const onError = (event: ErrorEvent) => {
            if (event.error) {
                Sentry.captureException(event.error)
            }
        }
        const onUnhandledRejection = (event: PromiseRejectionEvent) => {
            Sentry.captureException(event.reason)
        }

        window.addEventListener("error", onError)
        window.addEventListener("unhandledrejection", onUnhandledRejection)
        return () => {
            window.removeEventListener("error", onError)
            window.removeEventListener("unhandledrejection", onUnhandledRejection)
        }
    }, [])

    return null
}

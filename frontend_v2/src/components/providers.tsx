"use client"

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ReactQueryDevtools } from "@tanstack/react-query-devtools"
import { useEffect, useState } from "react"
import { AuthProvider } from "@/components/auth-provider"
import { SentryInit } from "@/components/sentry-init"
import { describeApiError, getApiErrorStatus } from "@/lib/api"
import { toast, Toaster } from "sonner"

const ERROR_DEDUPE_MS = 8000
const recentErrors = new Map<string, number>()

function routeLabel() {
    if (typeof window === "undefined") return "server"
    return `${window.location.pathname}${window.location.search || ""}`
}

function stableOperationKey(key: unknown) {
    if (Array.isArray(key)) return key.map((part) => String(part)).join(" / ")
    if (key === null || key === undefined || key === "") return "unknown operation"
    return String(key)
}

function shouldSkipGlobalError(meta: unknown) {
    const flags = (meta || {}) as Record<string, unknown>
    return flags.silentError === true || flags.suppressGlobalError === true || flags.disableGlobalErrorToast === true
}

function reportClientDataError({
    title,
    error,
    operation,
    retry,
}: {
    title: string
    error: unknown
    operation: string
    retry?: () => void
}) {
    const status = getApiErrorStatus(error)
    const message = describeApiError(error, "Request failed.")
    const route = routeLabel()
    const dedupeKey = [title, status || "client", message, operation, route].join("|")
    const now = Date.now()
    const last = recentErrors.get(dedupeKey) || 0
    if (now - last < ERROR_DEDUPE_MS) return
    recentErrors.set(dedupeKey, now)

    const description = [
        message,
        status ? `Status ${status}` : null,
        operation ? `Operation: ${operation}` : null,
        `Route: ${route}`,
    ].filter(Boolean).join(" • ")

    toast.error(title, {
        description,
        duration: 9000,
        action: retry ? { label: "Retry", onClick: retry } : undefined,
    })

    if (typeof console !== "undefined") {
        console.warn("[client-data-error]", { title, status, message, operation, route, error })
    }
}

function isBrowserResourceFailure(event: ErrorEvent) {
    if (event.error) return false
    const message = String(event.message || "").trim()
    const filename = String(event.filename || "")
    const currentRoute = typeof window !== "undefined" ? window.location.href : ""
    const looksLikeBareNetworkFailure = /^(request failed\.?|failed to fetch\.?|load failed\.?)$/i.test(message)
    const pointsAtCurrentPage = !filename || filename === currentRoute || filename === routeLabel()
    return looksLikeBareNetworkFailure && pointsAtCurrentPage
}

function GlobalClientErrorListeners() {
    useEffect(() => {
        const onUnhandledRejection = (event: PromiseRejectionEvent) => {
            reportClientDataError({
                title: "Unhandled app error",
                error: event.reason,
                operation: "unhandled promise",
            })
        }
        const onWindowError = (event: ErrorEvent) => {
            if (isBrowserResourceFailure(event)) {
                if (typeof console !== "undefined") {
                    console.warn("[client-resource-error]", {
                        message: event.message,
                        operation: event.filename || routeLabel(),
                        route: routeLabel(),
                    })
                }
                return
            }
            reportClientDataError({
                title: "Client runtime error",
                error: event.error || event.message,
                operation: event.filename || "window error",
            })
        }

        window.addEventListener("unhandledrejection", onUnhandledRejection)
        window.addEventListener("error", onWindowError)
        return () => {
            window.removeEventListener("unhandledrejection", onUnhandledRejection)
            window.removeEventListener("error", onWindowError)
        }
    }, [])

    return null
}

export default function Providers({ children }: { children: React.ReactNode }) {
    const showReactQueryDevtools =
        process.env.NODE_ENV === "development" &&
        process.env.NEXT_PUBLIC_ENABLE_REACT_QUERY_DEVTOOLS === "1"
    const [queryClient] = useState(
        () =>
            new QueryClient({
                queryCache: new QueryCache({
                    onError: (error, query) => {
                        if (shouldSkipGlobalError(query.meta)) return
                        reportClientDataError({
                            title: "Data load failed",
                            error,
                            operation: stableOperationKey(query.queryKey),
                            retry: () => {
                                void query.fetch()
                            },
                        })
                    },
                }),
                mutationCache: new MutationCache({
                    onError: (error, _variables, _context, mutation) => {
                        if (shouldSkipGlobalError(mutation.meta)) return
                        reportClientDataError({
                            title: "Action failed",
                            error,
                            operation: stableOperationKey(mutation.options.mutationKey || mutation.meta?.operation || "mutation"),
                        })
                    },
                }),
                defaultOptions: {
                    queries: {
                        staleTime: 60 * 1000, // 1 minute
                        retry: (failureCount, error) => {
                            const status = getApiErrorStatus(error)
                            if (status && status < 500) return false
                            return failureCount < 2
                        },
                        throwOnError: false,
                    },
                    mutations: {
                        retry: false,
                    },
                },
            })
    )

    return (
        <QueryClientProvider client={queryClient}>
            <AuthProvider>
                <SentryInit />
                <GlobalClientErrorListeners />
                {children}
                <Toaster />
            </AuthProvider>
            {showReactQueryDevtools ? <ReactQueryDevtools initialIsOpen={false} /> : null}
        </QueryClientProvider>
    )
}

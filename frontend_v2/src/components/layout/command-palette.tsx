"use client"

import * as React from "react"
import {
    CommandDialog,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command"
import { useRouter } from "next/navigation"
import { api } from "@/lib/api"
import {
    Search,
    Loader2,
    Package,
    Factory,
    Users,
    AlertCircle,
    Clock,
    Compass,
    Building2,
    Cpu,
    Layers,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { useAuth } from "@/components/auth-provider"
import { resolveNavigableRoute } from "@/lib/navigation-routes"
import { NAV_ITEMS, canAccessNavTarget } from "@/lib/sidebar-nav"
import { cn } from "@/lib/utils"

type SearchResultType = "route" | "order" | "job" | "customer" | "machine" | "work_center"

interface SearchV2Item {
    id: string
    type: SearchResultType
    group?: string
    label: string
    subtitle?: string
    href: string
    status?: string
    score?: number
}

interface SearchV2Response {
    query: string
    took_ms: number
    counts_by_type: Record<string, number>
    results: SearchV2Item[]
}

interface RouteIndexItem {
    id: string
    type: "route"
    group: "Navigate"
    label: string
    subtitle: string
    href: string
    status: string
    score: number
}

function toStableTestSlug(value: string) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
}

function TypeIcon({ type }: { type: string }) {
    switch (type) {
        case "order":
            return <Package className="mr-2 h-4 w-4 text-blue-500" />
        case "job":
            return <Factory className="mr-2 h-4 w-4 text-emerald-500" />
        case "customer":
            return <Users className="mr-2 h-4 w-4 text-amber-500" />
        case "machine":
            return <Cpu className="mr-2 h-4 w-4 text-violet-500" />
        case "work_center":
            return <Building2 className="mr-2 h-4 w-4 text-indigo-500" />
        case "route":
            return <Compass className="mr-2 h-4 w-4 text-slate-500" />
        default:
            return <Layers className="mr-2 h-4 w-4 text-slate-400" />
    }
}

function StatusBadge({ status }: { status?: string }) {
    const value = String(status || "").trim()
    if (!value) return null

    let variant: "outline" | "default" | "secondary" | "destructive" = "outline"
    if (value === "COMPLETED" || value === "DELIVERED") variant = "default"
    if (value === "RUNNING" || value === "IN_PRODUCTION" || value === "EXECUTING") variant = "secondary"

    return (
        <Badge variant={variant} className="ml-auto h-4 px-1 text-[10px] font-bold uppercase tracking-wider">
            {value}
        </Badge>
    )
}

export function CommandPalette({ compact = false }: { compact?: boolean }) {
    const [open, setOpen] = React.useState(false)
    const [query, setQuery] = React.useState("")
    const [loading, setLoading] = React.useState(false)
    const [apiResults, setApiResults] = React.useState<SearchV2Item[]>([])
    const [meta, setMeta] = React.useState<SearchV2Response | null>(null)
    const router = useRouter()
    const { user, effectiveRole } = useAuth()

    const roleCode = String(effectiveRole || user?.entitlements?.role || user?.role_info?.code || "GUEST").toUpperCase()
    const baseRoleCode = String(user?.role_info?.code || "GUEST").toUpperCase()
    const extraPermissions = user?.extra_permissions || user?.entitlements?.extra_overrides || []
    const accessContext = React.useMemo(
        () => ({
            currentRoleCode: roleCode,
            baseRoleCode,
            isOwner: user?.is_owner,
            grantedPermissions: extraPermissions,
        }),
        [baseRoleCode, extraPermissions, roleCode, user?.is_owner],
    )

    const routeIndex = React.useMemo<RouteIndexItem[]>(() => {
        const entries = new Map<string, RouteIndexItem>()
        NAV_ITEMS.forEach((item) => {
            const parentTarget = resolveNavigableRoute(item.href)
            if (canAccessNavTarget(item, accessContext) && parentTarget) {
                entries.set(parentTarget, {
                    id: `route:${parentTarget}`,
                    type: "route",
                    group: "Navigate",
                    label: item.title,
                    subtitle: parentTarget === item.href ? item.href : `${item.href} -> ${parentTarget}`,
                    href: parentTarget,
                    status: "",
                    score: 0,
                })
            }
            ;(item.children || []).forEach((child) => {
                if (!canAccessNavTarget(child, accessContext)) return
                const childTarget = resolveNavigableRoute(child.href)
                if (!childTarget) return
                entries.set(childTarget, {
                    id: `route:${childTarget}`,
                    type: "route",
                    group: "Navigate",
                    label: child.title,
                    subtitle: childTarget === child.href ? child.href : `${child.href} -> ${childTarget}`,
                    href: childTarget,
                    status: "",
                    score: 0,
                })
            })
        })
        return Array.from(entries.values())
    }, [accessContext])

    const localRouteMatches = React.useMemo<RouteIndexItem[]>(() => {
        const q = query.trim().toLowerCase()
        if (!q) return []
        return routeIndex
            .map((item) => {
                const labelMatch = item.label.toLowerCase().includes(q)
                const hrefMatch = item.href.toLowerCase().includes(q)
                if (!labelMatch && !hrefMatch) return null
                const score = item.label.toLowerCase().startsWith(q) ? 130 : labelMatch ? 100 : 80
                return { ...item, score }
            })
            .filter((item): item is RouteIndexItem => Boolean(item))
            .sort((a, b) => b.score - a.score)
            .slice(0, 8)
    }, [query, routeIndex])

    React.useEffect(() => {
        const down = (e: KeyboardEvent) => {
            if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                setOpen((current) => !current)
            }
            if (e.key === "Escape" && open) {
                setOpen(false)
            }
        }

        document.addEventListener("keydown", down)
        return () => document.removeEventListener("keydown", down)
    }, [open])

    React.useEffect(() => {
        const q = query.trim()
        if (q.length < 2) {
            setApiResults([])
            setMeta(null)
            return
        }

        const timer = setTimeout(async () => {
            setLoading(true)
            try {
                const { data } = await api.get<SearchV2Response>("/api/dashboard/search-v2", {
                    params: { q, limit: 30 },
                })
                setApiResults(Array.isArray(data?.results) ? data.results : [])
                setMeta(data)
            } catch {
                setApiResults([])
                setMeta(null)
            } finally {
                setLoading(false)
            }
        }, 240)

        return () => clearTimeout(timer)
    }, [query])

    const mergedResults = React.useMemo(() => {
        const map = new Map<string, SearchV2Item>()
        ;[...localRouteMatches, ...apiResults].forEach((item) => {
            const key = `${item.type}:${item.id || item.href}`
            const existing = map.get(key)
            if (!existing || Number(item.score || 0) > Number(existing.score || 0)) {
                map.set(key, item)
            }
        })
        return Array.from(map.values()).sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    }, [localRouteMatches, apiResults])

    const grouped = React.useMemo(() => {
        const groups: Record<string, SearchV2Item[]> = {}
        mergedResults.forEach((item) => {
            const key = item.group || (item.type === "route" ? "Navigate" : "Results")
            if (!groups[key]) groups[key] = []
            groups[key].push(item)
        })
        return groups
    }, [mergedResults])

    const runCommand = React.useCallback(
        (href: string) => {
            setOpen(false)
            setQuery("")
            router.push(href)
        },
        [router],
    )

    const hasResults = mergedResults.length > 0

    return (
        <>
            <button
                onClick={() => setOpen(true)}
                data-testid="command-palette-trigger"
                className={cn(
                    "relative inline-flex min-w-0 max-w-full items-center justify-start border border-slate-200 bg-slate-50/60 font-medium text-slate-600 shadow-sm transition-all hover:border-slate-300 hover:bg-slate-50",
                    compact
                        ? "h-11 w-full rounded-2xl px-3 py-2 text-[13px]"
                        : "h-10 w-full rounded-xl px-4 py-2 text-sm sm:pr-12",
                )}
            >
                <Search className="mr-2 h-4 w-4 opacity-60" />
                <span className="truncate">
                    {compact ? "Search routes, orders, jobs..." : (<><span className="hidden lg:inline-flex">Search commands, routes, records...</span><span className="inline-flex lg:hidden text-xs">Search...</span></>)}
                </span>
                {!compact ? (
                    <kbd className="pointer-events-none absolute right-[0.3rem] top-[0.4rem] hidden h-5 select-none items-center gap-1 rounded border bg-white px-1.5 font-mono text-[10px] font-medium sm:flex">
                        <span className="text-xs">⌘</span>K
                    </kbd>
                ) : null}
            </button>

            <CommandDialog open={open} onOpenChange={setOpen}>
                <div className="border-b px-3 pb-2">
                    <CommandInput
                        placeholder="Jump to route, order, job, customer, machine..."
                        value={query}
                        onValueChange={setQuery}
                        data-testid="command-palette-input"
                        className="h-12 border-none ring-0 focus:ring-0"
                    />
                    {meta ? (
                        <div className="flex flex-wrap items-center gap-2 px-2 pt-1 text-[10px] text-slate-500">
                            <Badge variant="outline">{mergedResults.length} results</Badge>
                            <Badge variant="outline">{meta.took_ms} ms</Badge>
                            {Object.entries(meta.counts_by_type || {}).map(([type, count]) => (
                                <Badge key={type} variant="outline" className="uppercase">
                                    {type}: {count}
                                </Badge>
                            ))}
                        </div>
                    ) : null}
                </div>

                <CommandList className="max-h-[380px]">
                    {loading ? (
                        <div className="flex items-center justify-center py-10">
                            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                        </div>
                    ) : null}

                    {!loading && query.trim().length < 2 ? (
                        <div className="py-10 text-center text-slate-400">
                            <Clock className="mx-auto mb-2 h-8 w-8 opacity-20" />
                            <p className="text-xs font-semibold uppercase tracking-widest">Quick Launch</p>
                            <p className="mt-1 text-[10px]">Type at least 2 characters for full scoped search</p>
                        </div>
                    ) : null}

                    {!loading && query.trim().length >= 2 && !hasResults ? (
                        <CommandEmpty className="py-10 text-center">
                            <AlertCircle className="mx-auto mb-2 h-8 w-8 text-slate-300" />
                            <p className="text-slate-500">No results found for &quot;{query}&quot;</p>
                        </CommandEmpty>
                    ) : null}

                    {!loading && hasResults
                        ? Object.entries(grouped).map(([groupName, items]) => (
                              <CommandGroup key={groupName} heading={groupName}>
                                  {items.map((item) => (
                                      <CommandItem
                                          key={`${item.type}:${item.id || item.href}`}
                                          value={`${item.label} ${item.subtitle || ""}`}
                                          data-testid={`command-item-${toStableTestSlug(item.href || item.id || item.label)}`}
                                          onSelect={() => runCommand(item.href)}
                                          className="flex cursor-pointer items-center px-4 py-3 hover:bg-slate-50"
                                      >
                                          <TypeIcon type={item.type} />
                                          <div className="flex min-w-0 flex-col">
                                              <span className="truncate font-medium text-slate-700">{item.label}</span>
                                              <span className="truncate text-[10px] tracking-tight text-slate-400">{item.subtitle || item.type}</span>
                                          </div>
                                          <StatusBadge status={item.status} />
                                      </CommandItem>
                                  ))}
                              </CommandGroup>
                          ))
                        : null}
                </CommandList>
            </CommandDialog>
        </>
    )
}

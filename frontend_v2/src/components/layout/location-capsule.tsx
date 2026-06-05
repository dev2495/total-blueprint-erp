"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ChevronRight } from "lucide-react"
import { resolveNavigableRoute } from "@/lib/navigation-routes"
import { cn } from "@/lib/utils"

const LABELS: Record<string, string> = {
    dashboard: "Dashboard",
    system: "System",
    governance: "Governance",
    users: "Users",
    role: "Role",
    matrix: "Matrix",
    production: "Production",
    machine: "Machine",
    selector: "Selector",
    work: "Work",
    center: "Center",
    analytics: "Analytics",
    inventory: "Inventory",
    sales: "Sales",
    factory: "Factory",
    engineering: "Engineering",
    profile: "Profile",
    logistics: "Logistics",
}

function toLabel(segment: string): string {
    const key = String(segment || "").toLowerCase()
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)) {
        return "Terminal"
    }
    if (LABELS[key]) return LABELS[key]
    return key
        .split("-")
        .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
        .join(" ")
}

export function LocationCapsule({ compact = false }: { compact?: boolean }) {
    const pathname = usePathname()
    const normalizedPathname = String(pathname || "").replace(/\/+$/, "") || "/"
    const segments = String(pathname || "")
        .split("/")
        .filter(Boolean)

    const wrapperClass = cn(
        "relative z-10 items-center border border-slate-200 bg-slate-50 font-semibold text-content-3",
        compact
            ? "flex w-full overflow-x-auto rounded-2xl px-3 py-2 text-[11px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            : "hidden rounded-xl px-2 py-1 text-[11px] lg:flex",
    )

    if (!segments.length) {
        return (
            <div className={wrapperClass} data-testid={compact ? "location-capsule-compact" : "location-capsule"}>
                <span className="whitespace-nowrap">Home</span>
            </div>
        )
    }

    let cumulative = ""
    const crumbs = segments.map((segment) => {
        cumulative += `/${segment}`
        return {
            segment,
            href: cumulative,
            target: resolveNavigableRoute(cumulative),
            label: toLabel(segment),
        }
    })

    return (
        <div className={wrapperClass} data-testid={compact ? "location-capsule-compact" : "location-capsule"}>
            <div className="flex min-w-max items-center">
                {crumbs.map((crumb, index) => {
                    const isLast = index === crumbs.length - 1
                    const breadcrumbHref =
                        crumb.target && crumb.target === normalizedPathname && crumb.href !== normalizedPathname
                            ? crumb.href
                            : crumb.target
                    return (
                        <div key={crumb.href} className="flex items-center whitespace-nowrap">
                            {!isLast && breadcrumbHref ? (
                                <Link
                                    href={breadcrumbHref}
                                    data-testid={`${compact ? "breadcrumb-link-compact" : "breadcrumb-link"}-${crumb.segment.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase()}`}
                                    data-route={crumb.target}
                                    className="text-slate-500 hover:text-slate-700"
                                >
                                    {crumb.label}
                                </Link>
                            ) : (
                                <span className={isLast ? "font-bold text-content-2" : "text-slate-500"}>{crumb.label}</span>
                            )}
                            {!isLast ? <ChevronRight className="mx-1 h-3 w-3 text-content-4" /> : null}
                        </div>
                    )
                })}
            </div>
        </div>
    )
}

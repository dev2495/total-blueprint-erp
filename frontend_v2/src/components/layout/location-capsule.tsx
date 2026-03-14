"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { ChevronRight } from "lucide-react"
import { resolveNavigableRoute } from "@/lib/navigation-routes"

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
    if (LABELS[key]) return LABELS[key]
    return key
        .split("-")
        .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
        .join(" ")
}

export function LocationCapsule() {
    const pathname = usePathname()
    const segments = String(pathname || "")
        .split("/")
        .filter(Boolean)

    if (!segments.length) {
        return (
            <div className="hidden lg:flex items-center rounded-xl border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold text-slate-500" data-testid="location-capsule">
                Home
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
        <div className="hidden lg:flex items-center rounded-xl border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-600" data-testid="location-capsule">
            {crumbs.map((crumb, index) => {
                const isLast = index === crumbs.length - 1
                return (
                    <div key={crumb.href} className="flex items-center">
                        {!isLast && crumb.target ? (
                            <Link
                                href={crumb.target}
                                data-testid={`breadcrumb-link-${crumb.segment.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase()}`}
                                data-route={crumb.target}
                                className="text-slate-500 hover:text-slate-700"
                            >
                                {crumb.label}
                            </Link>
                        ) : (
                            <span className={isLast ? "font-bold text-slate-800" : "text-slate-500"}>
                                {crumb.label}
                            </span>
                        )}
                        {!isLast ? <ChevronRight className="mx-1 h-3 w-3 text-slate-400" /> : null}
                    </div>
                )
            })}
        </div>
    )
}

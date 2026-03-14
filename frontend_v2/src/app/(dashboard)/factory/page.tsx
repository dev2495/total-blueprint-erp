"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Factory, Cpu, MapPin, Settings, Boxes, LayoutDashboard } from "lucide-react"
import { PageHeader } from "@/components/ui-custom/page-header"

export default function FactoryAdminPage() {
    const { data: summary, isLoading } = useQuery({
        queryKey: ["factory-summary"],
        queryFn: async () => {
            const res = await api.get("/api/analytics/factory-summary")
            return res.data
        }
    })

    const sections = [
        { title: "Visual Overview", href: "/factory/overview", icon: LayoutDashboard, description: "Real-time hierarchy tree", color: "bg-blue-50 text-blue-600" },
        { title: "Plants", href: "/factory/plants", icon: Factory, description: "Manage factory locations", color: "bg-indigo-50 text-indigo-600" },
        { title: "Work Centers", href: "/factory/work-centers", icon: Boxes, description: "Production work centers", color: "bg-emerald-50 text-emerald-600" },
        { title: "Machines", href: "/factory/machines", icon: Cpu, description: "Machine master data", color: "bg-amber-50 text-amber-600" },
        { title: "Locations", href: "/factory/locations", icon: MapPin, description: "Inventory locations", color: "bg-purple-50 text-purple-600" },
        { title: "Processes", href: "/factory/processes", icon: Settings, description: "Manufacturing processes", color: "bg-rose-50 text-rose-600" },
    ]

    const stats = [
        { label: "Plants", value: summary?.plants ?? 0, icon: Factory, unit: "Locations" },
        { label: "Work Centers", value: summary?.work_centers ?? 0, icon: Boxes, unit: "Areas" },
        { label: "Machines", value: summary?.machines ?? 0, icon: Cpu, unit: "Equipment" },
        { label: "Locations", value: summary?.locations ?? 0, icon: MapPin, unit: "Bins" },
    ]

    return (
        <div className="space-y-6">
            <PageHeader
                title="Factory Administration"
                description="Manage your physical manufacturing infrastructure, equipment, and hierarchical relationships."
            />

            {/* KPI Cards */}
            <div className="grid gap-4 md:grid-cols-4">
                {stats.map((stat, i) => (
                    <Card key={i} className="premium-card">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-semibold tracking-tight text-slate-500 uppercase">{stat.label}</CardTitle>
                            <stat.icon className="h-4 w-4 text-slate-400" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-3xl font-bold text-slate-900">
                                {isLoading ? "..." : stat.value}
                            </div>
                            <p className="text-xs font-medium text-slate-400 mt-1">{stat.unit}</p>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Section Links */}
            <div className="grid gap-6 md:grid-cols-3">
                {sections.map((section, index) => (
                    <Link key={index} href={section.href}>
                        <Card className="cursor-pointer hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1 premium-card group h-full">
                            <CardHeader className="flex flex-row items-center gap-4">
                                <div className={`p-3 rounded-2xl transition-colors duration-300 ${section.color}`}>
                                    <section.icon className="h-6 w-6" />
                                </div>
                                <div>
                                    <CardTitle className="text-lg group-hover:text-indigo-600 transition-colors uppercase tracking-tight">{section.title}</CardTitle>
                                    <p className="text-sm text-slate-400 font-medium">{section.description}</p>
                                </div>
                            </CardHeader>
                        </Card>
                    </Link>
                ))}
            </div>
        </div>
    )
}

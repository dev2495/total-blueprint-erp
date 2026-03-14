"use client"

import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { MasterRegistryShell } from "@/components/master/master-registry-shell"
import {
    Package, Users, Palette, FlaskConical,
    Layers, Filter, Droplets, Plus, ShieldCheck,
    Search, ArrowRight, LayoutGrid, Tag
} from "lucide-react"
import { useState } from "react"
import { SemanticBadge } from "@/components/ui-custom/semantic-badge"

export default function MasterDataPage() {
    const [searchQuery, setSearchQuery] = useState("")

    const masters = [
        {
            title: "Commercial Families",
            href: "/master/commercial-families",
            icon: Tag,
            count: 0,
            description: "Business-friendly naming groups used across stock explorer, planner, and reports",
            color: "text-violet-600",
            bg: "bg-violet-50"
        },
        {
            title: "Film Families",
            href: "/master/film-families",
            icon: Layers,
            count: 12,
            description: "Base film structures and material compositions",
            color: "text-blue-600",
            bg: "bg-blue-50"
        },
        {
            title: "Film Variants",
            href: "/master/film-variants",
            icon: Filter,
            count: 48,
            description: "Specific variants with thickness and treatments",
            color: "text-indigo-600",
            bg: "bg-indigo-50"
        },
        {
            title: "Inks",
            href: "/master/inks",
            icon: Droplets,
            count: 24,
            description: "Printing inks, solvents, and color components",
            color: "text-cyan-600",
            bg: "bg-cyan-50"
        },
        {
            title: "Adhesives",
            href: "/master/adhesives-solvents",
            icon: FlaskConical,
            count: 16,
            description: "Lamination adhesives and chemical hardeners",
            color: "text-amber-600",
            bg: "bg-amber-50"
        },
        {
            title: "Recipes",
            href: "/master/recipes",
            icon: Palette,
            count: 28,
            description: "Extrusion and mixing formulations",
            color: "text-purple-600",
            bg: "bg-purple-50"
        },
        {
            title: "Granules",
            href: "/master/granules",
            icon: Package,
            count: 32,
            description: "Raw plastic granules and additives",
            color: "text-emerald-600",
            bg: "bg-emerald-50"
        },
        {
            title: "Customers",
            href: "/sales/customers",
            icon: Users,
            count: 156,
            description: "Client database and billing details",
            color: "text-pink-600",
            bg: "bg-pink-50"
        },
        {
            title: "Vendors",
            href: "/master/vendors",
            icon: Users,
            count: 45,
            description: "Supplier network and raw material sources",
            color: "text-slate-600",
            bg: "bg-slate-50"
        },
        {
            title: "Add-ons",
            href: "/master/add-ons",
            icon: Plus,
            count: 8,
            description: "Zippers, spouts, and other attachments",
            color: "text-rose-600",
            bg: "bg-rose-50"
        },
        {
            title: "Packaging",
            href: "/master/packaging",
            icon: Package,
            count: 0,
            description: "Inner packs, gonnies, sheets, tape and dispatch consumables",
            color: "text-indigo-600",
            bg: "bg-indigo-50"
        },
        {
            title: "POD Materials",
            href: "/master/pod",
            icon: ShieldCheck,
            count: 0,
            description: "Proof of delivery and logistical assets",
            color: "text-orange-600",
            bg: "bg-orange-50"
        },
    ]

    const filteredMasters = masters.filter(m =>
        m.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.description.toLowerCase().includes(searchQuery.toLowerCase())
    )

    return (
        <MasterRegistryShell
            title="Master Data"
            description="Centralized registry for all material, formulation, and commercial data entities."
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder="Search master data registries..."
            stats={[
                { label: "Total masters", value: "12", subLabel: "Active registries", icon: LayoutGrid, toneClassName: "bg-indigo-50 text-indigo-700" },
                { label: "Materials", value: "128", subLabel: "Film, ink, adhesive, granule", icon: Layers, toneClassName: "bg-blue-50 text-blue-700" },
                { label: "Partners", value: "201", subLabel: "Customers and vendors", icon: Users, toneClassName: "bg-emerald-50 text-emerald-700" },
                { label: "Recipes", value: "28", subLabel: "Formulation masters", icon: Palette, toneClassName: "bg-violet-50 text-violet-700" },
            ]}
            chips={[
                { kind: "materialCategory", value: "FILM" },
                { kind: "materialCategory", value: "INK" },
                { kind: "materialCategory", value: "GRANULE" },
                { kind: "approval", value: "APPROVED", label: "Controlled master base" },
            ]}
        >
            {/* Master Cards Grid */}
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {filteredMasters.map((master, index) => (
                    <Link key={index} href={master.href}>
                        <Card className="cursor-pointer border-none shadow-premium hover:shadow-premium-hover hover:-translate-y-1 transition-all duration-300 h-full rounded-[1.5rem] group relative overflow-hidden bg-white">
                            <div className={`absolute top-0 left-0 w-1 h-full ${master.bg.replace('bg-', 'bg-gradient-to-b from-')} to-white/0 opacity-0 group-hover:opacity-100 transition-opacity`} />

                            <CardContent className="p-6 flex flex-col h-full">
                                <div className="flex items-start justify-between mb-6">
                                    <div className={`p-4 rounded-2xl ${master.bg} ${master.color} transition-colors duration-300`}>
                                        <master.icon className="h-6 w-6" />
                                    </div>
                                    <div className="h-8 w-8 rounded-full bg-slate-50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 -mr-2 -mt-2">
                                        <ArrowRight className="h-4 w-4 text-slate-400" />
                                    </div>
                                </div>

                                <div className="mt-auto">
                                    <h3 className="font-bold text-lg text-slate-900 mb-2 group-hover:text-indigo-600 transition-colors">
                                        {master.title}
                                    </h3>
                                    <p className="text-sm text-slate-500 font-medium leading-relaxed mb-4">
                                        {master.description}
                                    </p>
                                    <div className="flex items-center justify-between gap-2 text-xs font-bold text-slate-400 uppercase tracking-wider">
                                        <span className="bg-slate-100 px-2 py-1 rounded-md text-slate-500">
                                            {master.count} Records
                                        </span>
                                        <SemanticBadge kind="approval" value="APPROVED" label="Live" className="text-[9px]" />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </Link>
                ))}
            </div>
        </MasterRegistryShell>
    )
}

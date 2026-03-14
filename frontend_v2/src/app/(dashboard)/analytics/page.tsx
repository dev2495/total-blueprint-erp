"use client"

import { PageHeader } from "@/components/ui-custom/page-header"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { BarChart3, TrendingUp, PieChart, ClipboardList, Truck, DollarSign, ArrowRight, Settings, Users, Activity } from "lucide-react"
import Link from "next/link"

const REPORT_TILES = [
    {
        category: "Production",
        description: "Output, efficiency, and shop floor performance.",
        icon: Activity,
        color: "text-emerald-600",
        bg: "bg-emerald-50",
        items: [
            { label: "Production Performance", href: "/analytics/reports/production", desc: "Output trends, machine yield, process distribution, target tracking." },
            { label: "OEE Deep Dive", href: "/analytics/reports/oee", desc: "A × P × Q breakdown with 85% world-class benchmark." },
            { label: "Downtime Analysis", href: "/analytics/reports/downtime", desc: "Pareto chart, cumulative %, MTTR, and daily trends." },
        ]
    },
    {
        category: "Quality & Scrap",
        description: "Waste reduction, yield metrics, and cost of quality.",
        icon: ClipboardList,
        color: "text-rose-600",
        bg: "bg-rose-50",
        items: [
            { label: "Scrap & Yield", href: "/analytics/reports/scrap", desc: "Cost of scrap, process yield, reason analysis, operator breakdown." },
        ]
    },
    {
        category: "Inventory & MRP",
        description: "Stock valuation, aging, and consumption variance.",
        icon: PieChart,
        color: "text-amber-600",
        bg: "bg-amber-50",
        items: [
            { label: "Inventory Health", href: "/analytics/reports/inventory", desc: "Real-cost valuation, aging analysis, stage & location distribution." },
            { label: "MRP & Consumption", href: "/analytics/reports/mrp", desc: "Theory vs Actual vs Issue vs Plan variance with waterfall analysis." },
        ]
    },
    {
        category: "Sales & Logistics",
        description: "Order fulfillment and dispatch tracking.",
        icon: Truck,
        color: "text-blue-600",
        bg: "bg-blue-50",
        items: [
            { label: "Sales Fulfillment", href: "/analytics/reports/sales", desc: "OTIF rate, pipeline, top customers, overdue orders." },
            { label: "Dispatch & Logistics", href: "/analytics/reports/dispatch", desc: "Challan tracking, dispatch volume, customer-wise delivery." },
        ]
    },
    {
        category: "Workforce",
        description: "Operator efficiency and shift logs.",
        icon: Users,
        color: "text-indigo-600",
        bg: "bg-indigo-50",
        items: [
            { label: "Operator Performance", href: "/analytics/reports/operator", desc: "Leaderboard, efficiency ratings, scrap rate, target achievement." },
        ]
    },
    {
        category: "Costing & Finance",
        description: "Cost analysis, margins, and P&L analytics.",
        icon: DollarSign,
        color: "text-violet-600",
        bg: "bg-violet-50",
        items: [
            { label: "Costing & Profitability", href: "/analytics/reports/costing", desc: "Material vs conversion cost, margins by customer, overhead trends." },
        ]
    }
]

export default function AnalyticsPage() {
    return (
        <div className="space-y-8 animate-in fade-in duration-500">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 bg-white/60 backdrop-blur-xl p-6 rounded-3xl border border-white shadow-premium relative overflow-hidden mb-8">
                <div className="absolute -right-20 -top-20 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
                <div className="relative z-10">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-50 border border-indigo-100 mb-3">
                        <Activity className="w-3.5 h-3.5 text-indigo-600" />
                        <span className="text-[10px] uppercase tracking-widest font-bold text-indigo-600">Analytics Center</span>
                    </div>
                    <h1 className="text-3xl font-black tracking-tight text-slate-900 mb-1">
                        Reports Hub
                    </h1>
                    <p className="text-slate-500 font-medium">Enterprise-grade operational intelligence and decision support.</p>
                </div>
            </div>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {REPORT_TILES.map((tile, i) => (
                    <Card key={i} className="group hover:shadow-premium-hover transition-all duration-300 overflow-hidden bg-white/70 backdrop-blur-md border border-white shadow-premium">
                        <CardHeader className="border-b border-slate-100 bg-white/50 pb-4 relative overflow-hidden">
                            <div className={`absolute top-0 right-0 w-32 h-32 ${tile.bg} rounded-bl-full opacity-50 pointer-events-none transition-transform group-hover:scale-110`} />
                            <div className="flex items-center gap-3 relative z-10">
                                <div className={`p-2.5 rounded-xl ${tile.bg} group-hover:scale-110 transition-transform shadow-sm border border-white`}>
                                    <tile.icon className={`h-5 w-5 ${tile.color}`} />
                                </div>
                                <div>
                                    <CardTitle className="text-lg font-black tracking-tight text-slate-800">{tile.category}</CardTitle>
                                    <CardDescription className="text-xs font-medium text-slate-500 mt-0.5 tracking-wide">{tile.description}</CardDescription>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="pt-2 p-0 relative z-10 bg-white/30">
                            <div className="divide-y divide-slate-100/50">
                                {tile.items.map((item, j) => (
                                    <Link key={j} href={item.href} className="block hover:bg-white/80 transition-colors">
                                        <div className="px-6 py-4 flex items-center justify-between group/item">
                                            <div>
                                                <div className="text-sm font-bold text-slate-700 group-hover/item:text-indigo-700 transition-colors">
                                                    {item.label}
                                                </div>
                                                <div className="text-xs text-slate-500 mt-1 font-medium">
                                                    {item.desc}
                                                </div>
                                            </div>
                                            <div className="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center opacity-0 group-hover/item:opacity-100 transition-all transform translate-x-4 group-hover/item:-translate-x-0 border border-slate-100 shadow-sm">
                                                <ArrowRight className="h-4 w-4 text-indigo-500" />
                                            </div>
                                        </div>
                                    </Link>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>
        </div>
    )
}

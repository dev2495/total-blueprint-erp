"use client"

import { useQuery } from "@tanstack/react-query"
import { useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Truck, Package, MoveRight, Receipt, Activity } from "lucide-react"
import Link from "next/link"
import { logisticsService } from "@/services/logistics"
import {
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip as RechartsTooltip,
    ResponsiveContainer,
    Cell
} from "recharts"

export default function LogisticsDashboard() {
    const { data: challans = [], isLoading: loadingChallans } = useQuery({
        queryKey: ["logistics-challans-all"],
        queryFn: async () => await logisticsService.getChallans()
    })

    const { data: salesOrders = [], isLoading: loadingSO } = useQuery({
        queryKey: ["logistics-sales-orders"],
        queryFn: async () => await logisticsService.getSalesOrdersWithFG()
    })

    const summary = useMemo(() => {
        const draftChallans = challans.filter(c => c.status === "DRAFT").length
        const dispatchedChallans = challans.filter(c => c.status === "DISPATCHED").length
        const inTransit = challans.filter(c => c.status === "IN_TRANSIT").length
        const received = challans.filter(c => c.status === "RECEIVED").length

        const today = new Date().toDateString()
        const shippedToday = challans.filter(c =>
            (c.status === "DISPATCHED" || c.status === "IN_TRANSIT" || c.status === "RECEIVED") &&
            c.dispatch_date && new Date(c.dispatch_date).toDateString() === today
        ).length

        const statusCounts = {
            DRAFT: draftChallans,
            DISPATCHED: dispatchedChallans,
            IN_TRANSIT: inTransit,
            RECEIVED: received
        }

        const chartData = [
            { name: "Drafts", count: draftChallans },
            { name: "Dispatched", count: dispatchedChallans },
            { name: "In Transit", count: inTransit },
            { name: "Received", count: received }
        ]

        return {
            draftChallans,
            shippedToday,
            inTransit,
            readyOrders: salesOrders.length,
            chartData,
            recentChallans: challans.slice(0, 5)
        }
    }, [challans, salesOrders])

    const metrics = [
        {
            id: "drafts",
            label: "Pending Challans",
            value: String(summary.draftChallans),
            unit: "Drafts",
            icon: Receipt,
            color: "text-amber-600",
            bg: "bg-warning-bg",
            ring: "ring-amber-200"
        },
        {
            id: "ready",
            label: "Dispatch Ready",
            value: String(summary.readyOrders),
            unit: "Orders w/ FG",
            icon: Package,
            color: "text-emerald-600",
            bg: "bg-success-bg",
            ring: "ring-emerald-200"
        },
        {
            id: "transit",
            label: "Vehicles Loading/Transit",
            value: String(summary.inTransit),
            unit: "Active",
            icon: Truck,
            color: "text-blue-600",
            bg: "bg-blue-50",
            ring: "ring-blue-200"
        },
        {
            id: "shipped",
            label: "Shipped Today",
            value: String(summary.shippedToday),
            unit: "Trucks",
            icon: MoveRight,
            color: "text-blue-600",
            bg: "bg-blue-50",
            ring: "ring-blue-200"
        }
    ]

    return (
        <div className="space-y-8 pb-10 max-w-7xl mx-auto block xl:px-4">
            {/* Header / Hero Section */}
            <div className="relative overflow-hidden rounded-3xl bg-surface-1 border border-slate-200 p-8 shadow-sm">
                <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-blue-500/5 blur-3xl pointer-events-none" />
                <div className="absolute -bottom-20 -left-20 h-64 w-64 rounded-full bg-amber-500/5 blur-3xl pointer-events-none" />

                <div className="relative flex flex-col md:flex-row items-center justify-between gap-6">
                    <div>
                        <div className="flex items-center gap-2 mb-2">
                            <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                            <span className="text-xs font-bold uppercase tracking-widest text-content-4">Logistics Network</span>
                        </div>
                        <h1 className="text-4xl font-black tracking-tight mb-2 text-slate-900">Total Logistics Hub</h1>
                        <p className="text-slate-500 max-w-md font-medium">Govern all outbound delivery flows, print challans, and track active transport.</p>
                    </div>
                    <Link href="/logistics/dispatch">
                        <Button size="lg" className="bg-blue-600 text-white hover:bg-blue-700 font-bold px-8 rounded-xl shadow-md transition-all">
                            <Truck className="mr-2 h-5 w-5" /> Open Dispatch Bay
                        </Button>
                    </Link>
                </div>
            </div>

            {/* KPI Cards */}
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
                {metrics.map(metric => (
                    <Card key={metric.id} className={`group relative overflow-hidden border-none shadow-sm ring-1 bg-surface-1 transition-all duration-300 ${metric.ring}`}>
                        <div className={`absolute top-0 right-0 p-4 opacity-10 ${metric.color}`}>
                            <metric.icon className="h-24 w-24" />
                        </div>
                        <CardHeader className="pb-2">
                            <CardDescription className={`font-bold uppercase tracking-wider text-xs ${metric.color}`}>
                                {metric.label}
                            </CardDescription>
                            <CardTitle className="text-3xl font-black text-slate-900">
                                {metric.value}
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="flex items-center gap-2 text-sm mt-1">
                                <Badge variant="outline" className={`${metric.bg} ${metric.color} border-transparent`}>
                                    {metric.unit}
                                </Badge>
                            </div>
                        </CardContent>
                        <div className={`h-1 w-full absolute bottom-0 ${metric.bg.replace("50", "400")}`}></div>
                    </Card>
                ))}
            </div>

            <div className="grid gap-8 lg:grid-cols-3">
                {/* Protocol Metrics Bar Chart */}
                <Card className="lg:col-span-2 border border-slate-200 shadow-sm bg-surface-1 rounded-2xl overflow-hidden">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-xl font-black text-slate-900">Challan Flow Distribution</CardTitle>
                        <CardDescription className="font-medium text-slate-500">Live active tracking metrics for all generated DCs.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="h-[250px] w-full mt-4">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={summary.chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "#64748B", fontWeight: 600 }} />
                                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: "#64748B" }} />
                                    <RechartsTooltip cursor={{ fill: "#F1F5F9" }} contentStyle={{ borderRadius: "8px", border: "none", boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)" }} />
                                    <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} barSize={40}>
                                        {summary.chartData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={
                                                entry.name === "Drafts" ? "#f59e0b" :
                                                    entry.name === "Dispatched" ? "#3b82f6" :
                                                        entry.name === "In Transit" ? "#60a5fa" : "#10b981"
                                            } />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </CardContent>
                </Card>

                {/* Recent Challans List */}
                <Card className="border border-slate-200 shadow-sm bg-surface-1 rounded-2xl overflow-hidden">
                    <CardHeader className="pb-2 border-b border-slate-50">
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle className="text-lg font-black text-slate-900">Execution Ledger</CardTitle>
                                <CardDescription className="text-xs font-bold text-content-4 uppercase tracking-wider">Latest Validated DCs</CardDescription>
                            </div>
                            <Activity className="h-5 w-5 text-blue-400 animate-pulse" />
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-0 p-0">
                        {summary.recentChallans.map((challan: any) => (
                            <div key={challan.id} className="flex flex-col p-4 border-b border-slate-50 hover:bg-slate-50/50 transition-colors group">
                                <div className="flex justify-between items-start mb-1">
                                    <span className="text-sm font-black text-slate-900 font-mono group-hover:text-blue-600 transition-colors">{challan.dc_no}</span>
                                    <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-md ${challan.status === "DRAFT" ? "bg-warning-bg text-amber-600" :
                                            challan.status === "DISPATCHED" ? "bg-blue-50 text-blue-600" :
                                                challan.status === "IN_TRANSIT" ? "bg-blue-50 text-blue-600" :
                                                    "bg-success-bg text-emerald-600"
                                        }`}>
                                        {challan.status}
                                    </span>
                                </div>
                                <div className="flex justify-between items-center">
                                    <span className="text-xs font-bold text-slate-500 capitalize truncate max-w-[150px]">{challan.customer_name}</span>
                                    {challan.vehicle_no && (
                                        <span className="text-[10px] font-black uppercase text-content-4 flex items-center gap-1">
                                            <Truck className="w-3 h-3" /> {challan.vehicle_no}
                                        </span>
                                    )}
                                </div>
                            </div>
                        ))}
                        {summary.recentChallans.length === 0 && (
                            <p className="text-sm font-medium text-content-4 text-center py-6 italic">No recent challans found.</p>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}

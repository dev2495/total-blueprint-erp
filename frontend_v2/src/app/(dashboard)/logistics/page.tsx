"use client"

import { useQuery } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { logisticsService } from "@/services/logistics"
import Link from "next/link"
import {
    Truck, Package, MapPin, Search, ArrowRight, TrendingUp,
    Box, Activity, FileText, CheckCircle2, Factory, Navigation
} from "lucide-react"
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    BarChart, Bar, Cell
} from "recharts"
import { Skeleton } from "@/components/ui/skeleton"

export default function LogisticsHubPage() {
    // We can fetch high level stats from logisticsService if they exist.
    // Assuming getChallans is available to generate some metrics
    const { data: challans, isLoading } = useQuery({
        queryKey: ["all-challans"],
        queryFn: () => logisticsService.getChallans()
    })

    // Compute mock metrics from challans
    const metrics = {
        totalDispatched: challans?.filter(c => c.status === 'DISPATCHED' || c.status === 'RECEIVED').length || 0,
        inTransit: challans?.filter(c => c.status === 'IN_TRANSIT').length || 0,
        pendingDrafts: challans?.filter(c => c.status === 'DRAFT').length || 0,
    }

    // Static dummy chart data for wow factor
    const transitData = [
        { name: 'Mon', vol: 4000 },
        { name: 'Tue', vol: 3000 },
        { name: 'Wed', vol: 2000 },
        { name: 'Thu', vol: 2780 },
        { name: 'Fri', vol: 1890 },
        { name: 'Sat', vol: 2390 },
        { name: 'Sun', vol: 3490 },
    ];

    const distributionData = [
        { name: 'North Region', value: 40 },
        { name: 'South Region', value: 30 },
        { name: 'West Region', value: 20 },
        { name: 'East Region', value: 10 },
    ];
    const COLORS = ['#6366f1', '#3b82f6', '#10b981', '#f59e0b'];

    return (
        <div className="p-6 lg:p-10 space-y-8 bg-slate-50/30 min-h-screen font-sans">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 relative z-10">
                <div className="space-y-2">
                    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-50 border border-blue-100 text-blue-600 text-[11px] font-black uppercase tracking-widest shadow-sm">
                        <Navigation className="h-3.5 w-3.5" strokeWidth={2.5} /> Global Logistics Command
                    </div>
                    <h1 className="text-4xl font-black tracking-tighter text-slate-900 flex items-center gap-3">
                        Terminal Overview
                    </h1>
                    <p className="text-slate-500 font-medium text-[15px] max-w-xl leading-relaxed">
                        Real-time tracking of outbound freight, packing operations, and fleet transit. Select a module to begin operations.
                    </p>
                </div>
                <div className="flex gap-3">
                    <Link href="/logistics/dispatch">
                        <Button className="h-12 px-6 rounded-2xl bg-indigo-600 hover:bg-indigo-700 shadow-lg hover:shadow-indigo-500/25 transition-all font-bold text-[13px] tracking-wide">
                            Enter Dispatch Bay <ArrowRight className="h-4 w-4 ml-2" />
                        </Button>
                    </Link>
                </div>
            </div>

            {/* Top KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 lg:gap-6 relative z-10">
                <Card className="border-0 shadow-sm ring-1 ring-slate-100 bg-white rounded-[1.5rem] p-1 group hover:shadow-md hover:ring-indigo-100 transition-all">
                    <CardContent className="p-6">
                        <div className="flex justify-between items-start mb-6">
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-orange-50 border border-orange-100 group-hover:bg-orange-100 transition-colors">
                                <Box className="h-5 w-5 text-orange-600" strokeWidth={2} />
                            </div>
                            <span className="text-[11px] font-bold text-orange-600 bg-orange-50 px-2.5 py-1 rounded-full uppercase tracking-widest">Active</span>
                        </div>
                        <h3 className="text-slate-500 font-bold uppercase tracking-widest text-[11px] mb-1">Open Drafts</h3>
                        <div className="text-4xl font-black text-slate-900 tracking-tighter">
                            {isLoading ? <Skeleton className="h-10 w-16" /> : metrics.pendingDrafts}
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-0 shadow-sm ring-1 ring-slate-100 bg-white rounded-[1.5rem] p-1 group hover:shadow-md hover:ring-indigo-100 transition-all">
                    <CardContent className="p-6">
                        <div className="flex justify-between items-start mb-6">
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-50 border border-indigo-100 group-hover:bg-indigo-100 transition-colors">
                                <Truck className="h-5 w-5 text-indigo-600" strokeWidth={2} />
                            </div>
                            <span className="text-[11px] font-bold text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-full uppercase tracking-widest">Transit</span>
                        </div>
                        <h3 className="text-slate-500 font-bold uppercase tracking-widest text-[11px] mb-1">Fleet In Motion</h3>
                        <div className="text-4xl font-black text-slate-900 tracking-tighter">
                            {isLoading ? <Skeleton className="h-10 w-16" /> : metrics.inTransit}
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-0 shadow-sm ring-1 ring-slate-100 bg-white rounded-[1.5rem] p-1 group hover:shadow-md hover:ring-emerald-100 transition-all">
                    <CardContent className="p-6">
                        <div className="flex justify-between items-start mb-6">
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50 border border-emerald-100 group-hover:bg-emerald-100 transition-colors">
                                <CheckCircle2 className="h-5 w-5 text-emerald-600" strokeWidth={2} />
                            </div>
                            <span className="text-[11px] font-bold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full uppercase tracking-widest">Global</span>
                        </div>
                        <h3 className="text-slate-500 font-bold uppercase tracking-widest text-[11px] mb-1">Total Deliveries</h3>
                        <div className="text-4xl font-black text-slate-900 tracking-tighter">
                            {isLoading ? <Skeleton className="h-10 w-16" /> : metrics.totalDispatched}
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-0 shadow-sm ring-1 ring-slate-100 bg-slate-900 rounded-[1.5rem] p-1 text-white relative overflow-hidden group">
                    <div className="absolute top-0 right-0 p-4 opacity-10 transform translate-x-4 -translate-y-4 group-hover:scale-110 transition-transform">
                        <Activity className="h-32 w-32" />
                    </div>
                    <CardContent className="p-6 relative z-10">
                        <div className="flex justify-between items-start mb-6">
                            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/10 border border-white/20 backdrop-blur-md">
                                <TrendingUp className="h-5 w-5 text-indigo-300" strokeWidth={2} />
                            </div>
                            <span className="text-[11px] font-bold text-indigo-300 bg-indigo-500/20 px-2.5 py-1 rounded-full uppercase tracking-widest border border-indigo-500/30">Live</span>
                        </div>
                        <h3 className="text-slate-400 font-bold uppercase tracking-widest text-[11px] mb-1">Network Efficiency</h3>
                        <div className="text-4xl font-black text-white tracking-tighter flex items-baseline gap-1">
                            98.2<span className="text-lg font-bold text-indigo-400">%</span>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 lg:gap-6">
                {/* Main Graph */}
                <Card className="border-0 shadow-sm ring-1 ring-slate-100 bg-white rounded-[1.5rem] xl:col-span-2 overflow-hidden flex flex-col">
                    <CardHeader className="p-6 pb-2 border-b border-slate-50">
                        <CardTitle className="text-[14px] font-bold uppercase tracking-widest text-slate-500 flex items-center gap-2">
                            <Activity className="h-4 w-4 text-indigo-500" /> Freight Outbound Volume (Last 7 Days)
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="flex-1 p-6 min-h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={transitData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="colorVol" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#94a3b8', fontWeight: 600 }} dy={10} />
                                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#94a3b8', fontWeight: 600 }} tickFormatter={(val) => `${(val / 1000).toFixed(0)}k`} />
                                <Tooltip
                                    contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)', fontWeight: 'bold' }}
                                />
                                <Area type="monotone" dataKey="vol" stroke="#6366f1" strokeWidth={4} fillOpacity={1} fill="url(#colorVol)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>

                {/* Sub Graph / Distribution */}
                <Card className="border-0 shadow-sm ring-1 ring-slate-100 bg-white rounded-[1.5rem] overflow-hidden flex flex-col">
                    <CardHeader className="p-6 pb-2 border-b border-slate-50">
                        <CardTitle className="text-[14px] font-bold uppercase tracking-widest text-slate-500 flex items-center gap-2">
                            <MapPin className="h-4 w-4 text-emerald-500" /> Regional Distribution
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="flex-1 p-6 min-h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={distributionData} layout="vertical" margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f1f5f9" />
                                <XAxis type="number" hide />
                                <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b', fontWeight: 600 }} width={90} />
                                <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                                <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={24}>
                                    {distributionData.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>
            </div>

            {/* Quick Links / Modules Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 lg:gap-6 mt-4">
                <Link href="/logistics/dispatch" className="group block focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded-[1.5rem]">
                    <Card className="h-full border-0 shadow-sm ring-1 ring-slate-100 bg-white rounded-[1.5rem] p-2 hover:shadow-lg hover:ring-indigo-200 transition-all cursor-pointer">
                        <CardContent className="p-6">
                            <div className="h-14 w-14 rounded-2xl bg-indigo-50 flex items-center justify-center mb-6 group-hover:scale-110 group-hover:bg-indigo-600 transition-all duration-300">
                                <Truck className="h-6 w-6 text-indigo-600 group-hover:text-white transition-colors" strokeWidth={2} />
                            </div>
                            <h3 className="text-xl font-black text-slate-900 tracking-tight mb-2">Dispatch Bay</h3>
                            <p className="text-sm font-medium text-slate-500 leading-relaxed">Initate challans, allocate transport vehicles, and move packed goods to the dock.</p>
                        </CardContent>
                    </Card>
                </Link>

                <Link href="/logistics/packing" className="group block focus:outline-none focus:ring-2 focus:ring-emerald-500 rounded-[1.5rem]">
                    <Card className="h-full border-0 shadow-sm ring-1 ring-slate-100 bg-white rounded-[1.5rem] p-2 hover:shadow-lg hover:ring-emerald-200 transition-all cursor-pointer">
                        <CardContent className="p-6">
                            <div className="h-14 w-14 rounded-2xl bg-emerald-50 flex items-center justify-center mb-6 group-hover:scale-110 group-hover:bg-emerald-600 transition-all duration-300">
                                <Package className="h-6 w-6 text-emerald-600 group-hover:text-white transition-colors" strokeWidth={2} />
                            </div>
                            <h3 className="text-xl font-black text-slate-900 tracking-tight mb-2">Packing Station</h3>
                            <p className="text-sm font-medium text-slate-500 leading-relaxed">Manage roll sealing, attach cores/plugs, and finalize goods into shipping units.</p>
                        </CardContent>
                    </Card>
                </Link>

                <Link href="/logistics/transit" className="group block focus:outline-none focus:ring-2 focus:ring-orange-500 rounded-[1.5rem]">
                    <Card className="h-full border-0 shadow-sm ring-1 ring-slate-100 bg-white rounded-[1.5rem] p-2 hover:shadow-lg hover:ring-orange-200 transition-all cursor-pointer">
                        <CardContent className="p-6">
                            <div className="h-14 w-14 rounded-2xl bg-orange-50 flex items-center justify-center mb-6 group-hover:scale-110 group-hover:bg-orange-500 transition-all duration-300">
                                <Factory className="h-6 w-6 text-orange-600 group-hover:text-white transition-colors" strokeWidth={2} />
                            </div>
                            <h3 className="text-xl font-black text-slate-900 tracking-tight mb-2">Inter-Plant Transit</h3>
                            <p className="text-sm font-medium text-slate-500 leading-relaxed">Direct WIP transfers and raw material logistics between organizational facilities.</p>
                        </CardContent>
                    </Card>
                </Link>
            </div>
        </div>
    )
}

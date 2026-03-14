"use client"

import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ShoppingCart, CheckCircle2, Clock, TrendingUp, Package, AlertTriangle, ArrowRight, Layers, Target } from "lucide-react"
import Link from "next/link"
import { StatsGrid } from "@/components/dashboard/stats-grid"
import { cn } from "@/lib/utils"

import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell, Legend
} from 'recharts'

export default function SalesDashboard() {
    const { data: stats, isLoading } = useQuery({
        queryKey: ["sales-dashboard-stats"],
        queryFn: async () => {
            const response = await api.get("/api/analytics/sales-dashboard/")
            return response.data
        }
    })

    const CHART_COLORS = ['#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f59e0b']

    return (
        <div className="space-y-8 animate-in fade-in duration-700 pb-12">
            {/* Hero Section */}
            <div className="relative overflow-hidden rounded-[2.5rem] bg-indigo-600 p-10 text-white shadow-2xl transition-all hover:shadow-indigo-500/20">
                {/* Background Decoration */}
                <div className="absolute -right-20 -top-20 h-80 w-80 rounded-full bg-white/10 blur-3xl animate-pulse" />
                <div className="absolute -bottom-20 -left-20 h-80 w-80 rounded-full bg-indigo-400/20 blur-3xl transition-transform hover:scale-110" />

                <div className="relative flex flex-col lg:flex-row lg:items-center justify-between gap-8">
                    <div className="space-y-3">
                        <div className="flex items-center gap-2 text-indigo-100/80">
                            <Target className="h-5 w-5" />
                            <span className="text-sm font-black tracking-[0.2em] uppercase">Commercial Command</span>
                        </div>
                        <h1 className="text-5xl md:text-6xl font-black tracking-tighter leading-none">Command Center</h1>
                        <p className="max-w-2xl text-xl text-indigo-100/90 font-medium leading-relaxed">
                            A live diagnostic of your sales pipeline, velocity trends, and customer distribution.
                        </p>
                    </div>

                    <div className="flex flex-wrap gap-4">
                        <Link href="/sales/orders/create">
                            <Button className="bg-white text-indigo-600 hover:bg-indigo-50 shadow-2xl border-0 h-14 px-8 rounded-2xl font-black text-lg transition-all hover:scale-105 active:scale-95">
                                <ShoppingCart className="mr-2 h-6 w-6" /> Create Order
                            </Button>
                        </Link>
                        <Link href="/sales/orders">
                            <Button variant="outline" className="bg-indigo-500/20 border-indigo-400/30 text-white hover:bg-indigo-500/40 backdrop-blur-xl h-14 px-8 rounded-2xl font-black text-lg transition-all hover:scale-105 active:scale-95">
                                <Layers className="mr-2 h-6 w-6" /> View All
                            </Button>
                        </Link>
                    </div>
                </div>
            </div>

            {/* Metrics Grid */}
            <div className="grid gap-6">
                <StatsGrid metrics={stats?.metrics || []} />
            </div>

            {/* Main Analytics Section */}
            <div className="grid gap-8 lg:grid-cols-12">
                {/* Velocity Chart */}
                <Card className="lg:col-span-8 rounded-[2rem] border-0 shadow-2xl shadow-slate-200/50 bg-white/80 backdrop-blur-md overflow-hidden">
                    <CardHeader className="p-8 border-b border-slate-50">
                        <div className="flex items-center justify-between">
                            <div>
                                <CardTitle className="text-2xl font-black text-slate-900">Sales Velocity</CardTitle>
                                <CardDescription className="text-slate-500 font-bold uppercase tracking-widest text-[10px] mt-1">30-Day performance trend (Weight in KG)</CardDescription>
                            </div>
                            <div className="flex items-center gap-2 px-4 py-2 bg-indigo-50 rounded-xl">
                                <TrendingUp className="h-4 w-4 text-indigo-600" />
                                <span className="text-sm font-black text-indigo-600 tracking-tight">Auto-Refreshing</span>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="p-6 pt-10">
                        <div className="h-[350px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={stats?.trend_data || []}>
                                    <defs>
                                        <linearGradient id="colorWeight" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                                            <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                    <XAxis
                                        dataKey="date"
                                        axisLine={false}
                                        tickLine={false}
                                        tick={{ fill: '#94a3b8', fontSize: 12, fontWeight: 700 }}
                                        dy={10}
                                    />
                                    <YAxis
                                        axisLine={false}
                                        tickLine={false}
                                        tick={{ fill: '#94a3b8', fontSize: 12, fontWeight: 700 }}
                                        dx={-10}
                                    />
                                    <Tooltip
                                        contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)', fontWeight: 800 }}
                                    />
                                    <Area
                                        type="monotone"
                                        dataKey="weight"
                                        stroke="#6366f1"
                                        strokeWidth={4}
                                        fillOpacity={1}
                                        fill="url(#colorWeight)"
                                    />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </CardContent>
                </Card>

                {/* Customer Distribution */}
                <Card className="lg:col-span-4 rounded-[2rem] border-0 shadow-2xl shadow-slate-200/50 bg-white/80 backdrop-blur-md overflow-hidden">
                    <CardHeader className="p-8 border-b border-slate-50">
                        <CardTitle className="text-2xl font-black text-slate-900 leading-tight">Customer Mix</CardTitle>
                        <CardDescription className="text-slate-500 font-bold uppercase tracking-widest text-[10px] mt-1">Volume by top accounts (KG)</CardDescription>
                    </CardHeader>
                    <CardContent className="p-6 flex flex-col items-center justify-center min-h-[400px]">
                        {stats?.customer_distribution?.length > 0 ? (
                            <>
                                <div className="h-[280px] w-full">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <PieChart>
                                            <Pie
                                                data={stats.customer_distribution}
                                                cx="50%"
                                                cy="50%"
                                                innerRadius={70}
                                                outerRadius={100}
                                                paddingAngle={8}
                                                dataKey="value"
                                            >
                                                {stats.customer_distribution.map((entry: any, index: number) => (
                                                    <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} stroke="none" />
                                                ))}
                                            </Pie>
                                            <Tooltip />
                                        </PieChart>
                                    </ResponsiveContainer>
                                </div>
                                <div className="mt-8 w-full space-y-3 px-4">
                                    {stats.customer_distribution.map((item: any, i: number) => (
                                        <div key={i} className="flex items-center justify-between group">
                                            <div className="flex items-center gap-3">
                                                <div className="h-3 w-3 rounded-full" style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }} />
                                                <span className="text-sm font-black text-slate-700 truncate max-w-[120px]">{item.name}</span>
                                            </div>
                                            <span className="text-sm font-black text-slate-400 group-hover:text-indigo-600 transition-colors">
                                                {(item.value ?? 0).toLocaleString()} KG
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </>
                        ) : (
                            <div className="text-center space-y-3">
                                <div className="mx-auto h-20 w-20 rounded-full bg-slate-50 flex items-center justify-center">
                                    <Package className="h-10 w-10 text-slate-200" />
                                </div>
                                <p className="text-sm font-black text-slate-400 uppercase tracking-widest">Awaiting Volumetric Data</p>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Bottom Row - Alerts & Recent Orders */}
                <div className="lg:col-span-12 grid gap-8 lg:grid-cols-2">
                    {/* Activity Feed */}
                    <Card className="rounded-[2rem] border-0 shadow-2xl shadow-slate-200/50 bg-white overflow-hidden">
                        <CardHeader className="p-8 border-b border-slate-50 flex flex-row items-center justify-between">
                            <div>
                                <CardTitle className="text-2xl font-black text-slate-900">Recent Movements</CardTitle>
                                <CardDescription className="text-slate-500 font-bold uppercase tracking-widest text-[10px] mt-1">Last 10 commercial orders</CardDescription>
                            </div>
                            <Button variant="ghost" className="font-black text-indigo-600 hover:bg-indigo-50 rounded-xl" asChild>
                                <Link href="/sales/orders">Full Register <ArrowRight className="ml-2 h-4 w-4" /></Link>
                            </Button>
                        </CardHeader>
                        <CardContent className="p-0">
                            <div className="divide-y divide-slate-50">
                                {stats?.recent_orders?.length > 0 ? (
                                    stats.recent_orders.map((order: any, i: number) => (
                                        <div key={i} className="group flex items-center justify-between p-8 transition-all hover:bg-slate-50/50">
                                            <div className="flex items-center gap-5">
                                                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-50 text-slate-400 group-hover:bg-indigo-600 group-hover:text-white transition-all shadow-sm group-hover:shadow-indigo-500/30">
                                                    <ShoppingCart className="h-7 w-7" />
                                                </div>
                                                <div>
                                                    <p className="text-lg font-black text-slate-900 tracking-tight">{order.order_number || order.id}</p>
                                                    <p className="text-xs font-bold text-slate-400 uppercase tracking-[0.1em]">{order.customer}</p>
                                                </div>
                                            </div>
                                            <div className="text-right flex items-center gap-10">
                                                <div className="hidden sm:block">
                                                    <p className="text-lg font-black text-slate-900">{order.weight || '0 KG'}</p>
                                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Volume</p>
                                                </div>
                                                <div className={cn(
                                                    "px-4 py-2 rounded-xl font-black text-[10px] uppercase tracking-wider shadow-sm",
                                                    order.status === 'CONFIRMED' ? "bg-emerald-50 text-emerald-600" : "bg-indigo-50 text-indigo-600"
                                                )}>
                                                    {order.status}
                                                </div>
                                                <Button size="icon" variant="ghost" className="h-12 w-12 rounded-xl text-slate-300 hover:text-indigo-600 hover:bg-indigo-50" asChild>
                                                    <Link href={`/sales/orders/${order.id}`}><ArrowRight className="h-6 w-6" /></Link>
                                                </Button>
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    <div className="p-20 text-center">
                                        <p className="text-sm font-black text-slate-300 uppercase tracking-[0.2em]">Silence in the pipeline</p>
                                    </div>
                                )}
                            </div>
                        </CardContent>
                    </Card>

                    {/* Alerts & Critical Paths */}
                    <div className="space-y-8">
                        <Card className="rounded-[2rem] border-0 shadow-2xl shadow-slate-200/50 bg-slate-900 text-white overflow-hidden p-8">
                            <div className="space-y-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <h3 className="text-2xl font-black">Critical Alerts</h3>
                                        <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mt-1">Operational Friction Points</p>
                                    </div>
                                    <div className="h-12 w-12 rounded-2xl bg-emerald-500/10 flex items-center justify-center">
                                        <AlertTriangle className="h-6 w-6 text-emerald-500" />
                                    </div>
                                </div>
                                <div className="space-y-4">
                                    {stats?.alerts?.length > 0 ? (
                                        stats.alerts.map((alert: any, i: number) => (
                                            <div key={i} className="flex items-center gap-5 p-5 bg-white/5 border border-white/10 rounded-2xl transition-all hover:bg-white/10">
                                                <div className={cn(
                                                    "h-12 w-12 rounded-xl flex items-center justify-center",
                                                    alert.type === 'overdue' ? "bg-rose-500/20 text-rose-500" : "bg-indigo-500/20 text-indigo-400"
                                                )}>
                                                    {alert.type === 'overdue' ? <Clock className="h-6 w-6" /> : <Package className="h-6 w-6" />}
                                                </div>
                                                <div className="flex-1">
                                                    <p className="text-sm font-black uppercase tracking-tight">{alert.title}</p>
                                                    <p className="text-xs font-bold text-slate-400">{alert.description}</p>
                                                </div>
                                                <Button size="sm" variant="outline" className="border-white/20 text-white hover:bg-white hover:text-slate-900 rounded-xl font-black" asChild>
                                                    <Link href={alert.href}>Resolve</Link>
                                                </Button>
                                            </div>
                                        ))
                                    ) : (
                                        <div className="flex flex-col items-center py-6 text-center space-y-4">
                                            <div className="h-16 w-16 rounded-full bg-emerald-500/20 flex items-center justify-center">
                                                <CheckCircle2 className="h-8 w-8 text-emerald-500" />
                                            </div>
                                            <p className="text-sm font-black text-slate-400 uppercase tracking-widest">All systems operational</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </Card>

                        {/* Forecast / Progress */}
                        {stats?.forecast && (
                            <Card className="rounded-[2.5rem] bg-gradient-to-br from-indigo-600 to-indigo-800 p-10 text-white shadow-2xl overflow-hidden relative">
                                <div className="absolute right-0 top-0 h-40 w-40 bg-white/5 rotate-45 transform translate-x-10 -translate-y-10 rounded-3xl" />
                                <div className="relative space-y-6">
                                    <div className="flex items-center gap-3">
                                        <TrendingUp className="h-6 w-6 text-indigo-200" />
                                        <h4 className="text-2xl font-black italic tracking-tight">Sales Forecast</h4>
                                    </div>
                                    <p className="text-lg text-indigo-50 font-medium leading-snug">{stats.forecast.status_text}</p>
                                    <div className="space-y-3">
                                        <div className="flex justify-between items-end">
                                            <span className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-200">Current Progress</span>
                                            <span className="text-4xl font-black">{stats.forecast.percentage}%</span>
                                        </div>
                                        <div className="h-5 w-full rounded-full bg-white/10 p-1 backdrop-blur-md">
                                            <div
                                                className="h-full bg-white rounded-full transition-all duration-1000 ease-out shadow-[0_0_20px_rgba(255,255,255,0.6)]"
                                                style={{ width: `${stats.forecast.percentage}%` }}
                                            />
                                        </div>
                                    </div>
                                </div>
                            </Card>
                        )}
                    </div>
                </div>
            </div>
        </div>
    )
}

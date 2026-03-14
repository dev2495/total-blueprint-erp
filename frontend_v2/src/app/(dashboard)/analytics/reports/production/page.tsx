"use client"

import { useEffect, useState, useCallback } from "react"
import { ReportLayout } from "@/components/analytics/report-layout"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { useToast } from "@/hooks/use-toast"
import { api } from "@/lib/api"
import {
    AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip,
    ResponsiveContainer, CartesianGrid, Legend, PieChart, Pie, Cell, ReferenceLine
} from 'recharts'
import { Factory, TrendingUp, TrendingDown, CheckCircle, Gauge, Layers, Target, ArrowUpRight, ArrowDownRight, RefreshCw } from "lucide-react"

const COLORS = ['#6366f1', '#8b5cf6', '#a78bfa', '#c4b5fd', '#e879f9', '#f472b6', '#fb923c', '#34d399'];

function AnimatedKPI({ label, value, unit, trend, icon: Icon, color = "indigo" }: any) {
    const isPositive = trend > 0;
    const TrendIcon = isPositive ? ArrowUpRight : ArrowDownRight;
    const trendColor = isPositive ? "text-emerald-500" : "text-rose-500";
    return (
        <Card className="relative overflow-hidden group hover:shadow-lg transition-all duration-300 hover:-translate-y-0.5">
            <div className={`absolute inset-0 bg-gradient-to-br from-${color}-500/5 to-transparent`} />
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-slate-600">{label}</CardTitle>
                <div className={`p-2 rounded-lg bg-${color}-50`}>
                    <Icon className={`h-4 w-4 text-${color}-600`} />
                </div>
            </CardHeader>
            <CardContent>
                <div className="text-2xl font-bold tracking-tight">
                    {typeof value === 'number' ? value.toLocaleString() : value}
                    {unit && <span className="text-sm font-normal text-slate-400 ml-1">{unit}</span>}
                </div>
                {trend !== undefined && trend !== 0 && (
                    <div className={`flex items-center gap-1 mt-1 text-xs ${trendColor}`}>
                        <TrendIcon className="h-3 w-3" />
                        <span>{Math.abs(trend)}% vs prev period</span>
                    </div>
                )}
            </CardContent>
        </Card>
    )
}

export default function ProductionReportPage() {
    const { toast } = useToast()
    const [loading, setLoading] = useState(true)
    const [data, setData] = useState<any>(null)

    const fetchData = useCallback(async () => {
        setLoading(true)
        try {
            const { data: jsonData } = await api.get(`/api/analytics/reports/production`)
            setData(jsonData)
        } catch (error) {
            console.error(error)
            toast({ title: "Error", description: "Could not fetch production data.", variant: "destructive" })
        } finally {
            setLoading(false)
        }
    }, [toast])

    useEffect(() => { fetchData() }, [fetchData])

    // Auto-refresh
    useEffect(() => {
        const interval = setInterval(fetchData, 30000)
        return () => clearInterval(interval)
    }, [fetchData])

    if (loading && !data) {
        return (
            <ReportLayout title="Production Performance" description="Comprehensive production analytics with industry benchmarks." isLoading={true}>
                <div className="grid grid-cols-1 gap-6">
                    {[...Array(4)].map((_, i) => <div key={i} className="h-32 bg-gradient-to-r from-slate-100 to-slate-50 animate-pulse rounded-xl" />)}
                    <div className="h-96 bg-gradient-to-r from-slate-100 to-slate-50 animate-pulse rounded-xl" />
                </div>
            </ReportLayout>
        )
    }

    const s = data?.summary || {}
    const trendData = Array.isArray(data?.trend) ? data.trend : (Array.isArray(data?.series) ? data.series : [])
    const processData = Array.isArray(data?.by_process)
        ? data.by_process
        : (Array.isArray(data?.breakdowns?.by_process) ? data.breakdowns.by_process : [])
    const machineBreakdown = Array.isArray(data?.breakdown) ? data.breakdown : (Array.isArray(data?.rows) ? data.rows : [])

    return (
        <ReportLayout title="Production Performance" description="Comprehensive production analytics with industry benchmarks." onRefresh={fetchData}>
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
                {/* KPI Row */}
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
                    <AnimatedKPI label="Total Output" value={s.total_output_kg} unit="kg" trend={s.output_trend_pct} icon={Factory} color="indigo" />
                    <AnimatedKPI label="Yield Rate" value={`${s.yield_pct}%`} icon={Target} color="emerald" />
                    <AnimatedKPI label="Scrap Rate" value={`${s.scrap_rate}%`} icon={TrendingDown} color="rose" />
                    <AnimatedKPI label="Active Machines" value={s.active_machines} icon={Gauge} color="violet" />
                    <AnimatedKPI label="Job Completion" value={`${s.completion_rate}%`} icon={CheckCircle} color="blue" />
                </div>

                {/* Charts Row */}
                <div className="grid gap-6 md:grid-cols-3">
                    {/* Daily Output Trend */}
                    <Card className="md:col-span-2 hover:shadow-lg transition-shadow duration-300">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <TrendingUp className="h-5 w-5 text-indigo-500" />
                                Daily Output Trend
                            </CardTitle>
                            <CardDescription>Production output with target line overlay</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="h-[350px] w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={trendData} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                                        <defs>
                                            <linearGradient id="colorOutput" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                                                <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                        <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => v?.slice(5)} />
                                        <YAxis tick={{ fontSize: 11 }} />
                                        <RTooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }} />
                                        <Area type="monotone" dataKey="value" stroke="#6366f1" fill="url(#colorOutput)" strokeWidth={2} name="Output (kg)" />
                                        {s.target_daily_output && (
                                            <ReferenceLine y={s.target_daily_output} stroke="#10b981" strokeDasharray="5 5" label={{ value: "Target", fill: "#10b981", fontSize: 11 }} />
                                        )}
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Process Distribution */}
                    <Card className="hover:shadow-lg transition-shadow duration-300">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Layers className="h-5 w-5 text-violet-500" />
                                By Process
                            </CardTitle>
                            <CardDescription>Output distribution by process</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="h-[350px] w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie data={processData} cx="50%" cy="50%" innerRadius={60} outerRadius={110} paddingAngle={2} dataKey="value" nameKey="name">
                                            {processData.map((_: any, idx: number) => (
                                                <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                                            ))}
                                        </Pie>
                                        <RTooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }} />
                                        <Legend wrapperStyle={{ fontSize: 11 }} />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Machine Efficiency Table */}
                <Card className="hover:shadow-lg transition-shadow duration-300">
                    <CardHeader>
                        <CardTitle>Machine Performance Breakdown</CardTitle>
                        <CardDescription>Output, scrap, and yield per machine</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-slate-200">
                                        <th className="text-left py-3 px-4 font-semibold text-slate-600">Machine</th>
                                        <th className="text-right py-3 px-4 font-semibold text-slate-600">Output (kg)</th>
                                        <th className="text-right py-3 px-4 font-semibold text-slate-600">Scrap (kg)</th>
                                        <th className="text-right py-3 px-4 font-semibold text-slate-600">Yield %</th>
                                        <th className="text-right py-3 px-4 font-semibold text-slate-600">Std Rate</th>
                                        <th className="text-right py-3 px-4 font-semibold text-slate-600">Earned Hrs</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {machineBreakdown.map((m: any, i: number) => (
                                        <tr key={i} className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors">
                                            <td className="py-3 px-4 font-medium">{m.machine}</td>
                                            <td className="py-3 px-4 text-right">{m.actual_output?.toLocaleString()}</td>
                                            <td className="py-3 px-4 text-right text-rose-600">{m.scrap_kg?.toLocaleString()}</td>
                                            <td className="py-3 px-4 text-right">
                                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${m.yield_pct >= 95 ? 'bg-emerald-50 text-emerald-700' :
                                                        m.yield_pct >= 90 ? 'bg-amber-50 text-amber-700' :
                                                            'bg-rose-50 text-rose-700'
                                                    }`}>
                                                    {m.yield_pct}%
                                                </span>
                                            </td>
                                            <td className="py-3 px-4 text-right text-slate-500">{m.standard_rate} kg/hr</td>
                                            <td className="py-3 px-4 text-right">{m.earned_hours}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {(machineBreakdown.length === 0) && (
                                <div className="text-center py-12 text-slate-400">No machine data available for this period</div>
                            )}
                        </div>
                    </CardContent>
                </Card>
            </div>
        </ReportLayout>
    )
}

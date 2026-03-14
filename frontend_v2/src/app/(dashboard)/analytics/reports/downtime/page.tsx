"use client"

import { useEffect, useState, useCallback } from "react"
import { ReportLayout } from "@/components/analytics/report-layout"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { useToast } from "@/hooks/use-toast"
import { api } from "@/lib/api"
import {
    BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip,
    ResponsiveContainer, CartesianGrid, Legend, AreaChart, Area,
    ComposedChart, Line
} from 'recharts'
import { Clock, AlertTriangle, Activity, Wrench } from "lucide-react"

export default function DowntimeReportPage() {
    const { toast } = useToast()
    const [loading, setLoading] = useState(true)
    const [data, setData] = useState<any>(null)

    const fetchData = useCallback(async () => {
        setLoading(true)
        try {
            const { data: jsonData } = await api.get(`/api/analytics/reports/downtime`)
            setData(jsonData)
        } catch (error) {
            console.error(error)
            toast({ title: "Error", description: "Could not fetch downtime data.", variant: "destructive" })
        } finally {
            setLoading(false)
        }
    }, [toast])

    useEffect(() => { fetchData() }, [fetchData])
    useEffect(() => { const i = setInterval(fetchData, 30000); return () => clearInterval(i) }, [fetchData])

    if (loading && !data) {
        return (
            <ReportLayout title="Downtime Analysis" description="Machine downtime tracking and root cause analysis." isLoading={true}>
                <div className="grid grid-cols-1 gap-6">
                    {[...Array(3)].map((_, i) => <div key={i} className="h-40 bg-gradient-to-r from-slate-100 to-slate-50 animate-pulse rounded-xl" />)}
                </div>
            </ReportLayout>
        )
    }

    const s = data?.summary || {}
    const paretoData = Array.isArray(data?.pareto)
        ? data.pareto
        : (Array.isArray(data?.breakdowns?.pareto) ? data.breakdowns.pareto : [])
    const dailyTrend = Array.isArray(data?.daily_trend)
        ? data.daily_trend
        : (Array.isArray(data?.series) ? data.series : [])
    const topMachines = Array.isArray(data?.top_machines)
        ? data.top_machines
        : (Array.isArray(data?.rows) ? data.rows : [])

    return (
        <ReportLayout title="Downtime Analysis" description="Machine downtime tracking, Pareto analysis, and MTTR metrics." onRefresh={fetchData}>
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
                {/* KPIs */}
                <div className="grid gap-4 md:grid-cols-4">
                    <Card className="hover:shadow-lg transition-all">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium text-slate-600">Total Downtime</CardTitle>
                            <Clock className="h-4 w-4 text-rose-500" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{s.total_downtime_hours} <span className="text-sm text-slate-400">hours</span></div>
                            <p className="text-xs text-slate-500">{s.total_downtime_minutes?.toLocaleString()} minutes total</p>
                        </CardContent>
                    </Card>
                    <Card className="hover:shadow-lg transition-all">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium text-slate-600">Total Events</CardTitle>
                            <AlertTriangle className="h-4 w-4 text-amber-500" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{s.total_events}</div>
                            <p className="text-xs text-slate-500">{s.avg_events_per_day} avg/day</p>
                        </CardContent>
                    </Card>
                    <Card className="hover:shadow-lg transition-all">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium text-slate-600">MTTR</CardTitle>
                            <Wrench className="h-4 w-4 text-blue-500" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{s.mttr_minutes} <span className="text-sm text-slate-400">min</span></div>
                            <p className="text-xs text-slate-500">Mean Time To Repair</p>
                        </CardContent>
                    </Card>
                    <Card className="hover:shadow-lg transition-all">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium text-slate-600">Avg Per Day</CardTitle>
                            <Activity className="h-4 w-4 text-violet-500" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{s.avg_events_per_day}</div>
                            <p className="text-xs text-slate-500">events per day</p>
                        </CardContent>
                    </Card>
                </div>

                {/* Charts */}
                <div className="grid gap-6 md:grid-cols-2">
                    {/* Pareto */}
                    <Card className="hover:shadow-lg transition-shadow">
                        <CardHeader>
                            <CardTitle>Downtime Pareto (by Reason)</CardTitle>
                            <CardDescription>Top causes with cumulative % line</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="h-[400px] w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <ComposedChart data={paretoData} margin={{ top: 10, right: 30, bottom: 20, left: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                        <XAxis dataKey="reason" tick={{ fontSize: 10 }} angle={-20} textAnchor="end" />
                                        <YAxis yAxisId="left" tick={{ fontSize: 11 }} label={{ value: 'Hours', angle: -90, position: 'insideLeft' }} />
                                        <YAxis yAxisId="right" orientation="right" domain={[0, 100]} tick={{ fontSize: 11 }} label={{ value: 'Cumulative %', angle: 90, position: 'insideRight' }} />
                                        <RTooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }} />
                                        <Legend />
                                        <Bar yAxisId="left" dataKey="hours" name="Hours" fill="#6366f1" radius={[4, 4, 0, 0]} />
                                        <Line yAxisId="right" type="monotone" dataKey="cumulative_pct" name="Cumulative %" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} />
                                    </ComposedChart>
                                </ResponsiveContainer>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Daily Trend */}
                    <Card className="hover:shadow-lg transition-shadow">
                        <CardHeader>
                            <CardTitle>Daily Downtime Trend</CardTitle>
                            <CardDescription>Minutes of downtime per day</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="h-[400px] w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={dailyTrend} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                                        <defs>
                                            <linearGradient id="colorDT" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                                                <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                        <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => v?.slice(5)} />
                                        <YAxis tick={{ fontSize: 11 }} />
                                        <RTooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }} />
                                        <Area type="monotone" dataKey="minutes" name="Downtime (min)" stroke="#ef4444" fill="url(#colorDT)" strokeWidth={2} />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Top Offender Machines */}
                <Card>
                    <CardHeader>
                        <CardTitle>Top Downtime Machines</CardTitle>
                        <CardDescription>Machines with most downtime minutes</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-slate-200">
                                        <th className="text-left py-3 px-4 font-semibold text-slate-600">Machine</th>
                                        <th className="text-right py-3 px-4 font-semibold text-slate-600">Total Minutes</th>
                                        <th className="text-right py-3 px-4 font-semibold text-slate-600">Events</th>
                                        <th className="text-right py-3 px-4 font-semibold text-slate-600">Avg per Event</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {topMachines.map((m: any, i: number) => (
                                        <tr key={i} className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors">
                                            <td className="py-3 px-4 font-medium">{m.machine}</td>
                                            <td className="py-3 px-4 text-right text-rose-600 font-semibold">{m.minutes?.toLocaleString()}</td>
                                            <td className="py-3 px-4 text-right">{m.count}</td>
                                            <td className="py-3 px-4 text-right">{m.count ? Math.round(m.minutes / m.count) : 0}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {(topMachines.length === 0) && <div className="text-center py-12 text-slate-400">No downtime data</div>}
                        </div>
                    </CardContent>
                </Card>
            </div>
        </ReportLayout>
    )
}

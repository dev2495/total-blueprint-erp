"use client"

import { useEffect, useState, useCallback } from "react"
import { ReportLayout } from "@/components/analytics/report-layout"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { useToast } from "@/hooks/use-toast"
import { api } from "@/lib/api"
import {
    BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip,
    ResponsiveContainer, CartesianGrid, Legend, PieChart, Pie, Cell,
    AreaChart, Area
} from 'recharts'
import { Trash2, TrendingDown, IndianRupee, Target, Users } from "lucide-react"

const PIE_COLORS = ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#06b6d4', '#6366f1', '#a855f7'];

export default function ScrapReportPage() {
    const { toast } = useToast()
    const [loading, setLoading] = useState(true)
    const [data, setData] = useState<any>(null)

    const fetchData = useCallback(async () => {
        setLoading(true)
        try {
            const { data: jsonData } = await api.get(`/api/analytics/reports/scrap`)
            setData(jsonData)
        } catch (error) {
            console.error(error)
            toast({ title: "Error", description: "Could not fetch scrap data.", variant: "destructive" })
        } finally {
            setLoading(false)
        }
    }, [toast])

    useEffect(() => { fetchData() }, [fetchData])
    useEffect(() => { const i = setInterval(fetchData, 30000); return () => clearInterval(i) }, [fetchData])

    if (loading && !data) {
        return (
            <ReportLayout title="Scrap & Yield" description="Waste analysis and quality metrics." isLoading={true}>
                <div className="grid grid-cols-1 gap-6">
                    {[...Array(3)].map((_, i) => <div key={i} className="h-40 bg-gradient-to-r from-slate-100 to-slate-50 animate-pulse rounded-xl" />)}
                </div>
            </ReportLayout>
        )
    }

    const s = data?.summary || {}
    const bm = data?.benchmarks || {}
    const byReason = Array.isArray(data?.by_reason)
        ? data.by_reason
        : (Array.isArray(data?.breakdowns?.by_reason) ? data.breakdowns.by_reason : [])
    const dailyTrend = Array.isArray(data?.daily_trend)
        ? data.daily_trend
        : (Array.isArray(data?.series) ? data.series : [])
    const byProcess = Array.isArray(data?.by_process)
        ? data.by_process
        : (Array.isArray(data?.breakdowns?.by_process) ? data.breakdowns.by_process : [])
    const byOperator = Array.isArray(data?.by_operator)
        ? data.by_operator
        : (Array.isArray(data?.breakdowns?.by_operator) ? data.breakdowns.by_operator : [])

    return (
        <ReportLayout title="Scrap & Yield Analysis" description="Comprehensive waste tracking, yield metrics, and cost of quality." onRefresh={fetchData}>
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
                {/* KPIs */}
                <div className="grid gap-4 md:grid-cols-5">
                    <Card className="hover:shadow-lg transition-all relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-20 h-20 bg-emerald-500/5 rounded-full -translate-y-4 translate-x-4" />
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium text-slate-600">Yield Rate</CardTitle>
                            <Target className="h-4 w-4 text-emerald-500" />
                        </CardHeader>
                        <CardContent>
                            <div className={`text-2xl font-bold ${s.yield_pct >= bm.target_yield ? 'text-emerald-600' : 'text-amber-600'}`}>{s.yield_pct}%</div>
                            <p className="text-xs text-slate-500">Target: {bm.target_yield}%</p>
                        </CardContent>
                    </Card>
                    <Card className="hover:shadow-lg transition-all">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium text-slate-600">Scrap Rate</CardTitle>
                            <TrendingDown className="h-4 w-4 text-rose-500" />
                        </CardHeader>
                        <CardContent>
                            <div className={`text-2xl font-bold ${s.scrap_rate <= bm.target_scrap_rate ? 'text-emerald-600' : 'text-rose-600'}`}>{s.scrap_rate}%</div>
                            <p className="text-xs text-slate-500">Industry avg: 3-5%</p>
                        </CardContent>
                    </Card>
                    <Card className="hover:shadow-lg transition-all">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium text-slate-600">Total Scrap</CardTitle>
                            <Trash2 className="h-4 w-4 text-rose-500" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{s.total_scrap_kg?.toLocaleString()} <span className="text-sm text-slate-400">kg</span></div>
                            <p className="text-xs text-slate-500">{s.total_events} events</p>
                        </CardContent>
                    </Card>
                    <Card className="hover:shadow-lg transition-all">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium text-slate-600">Good Output</CardTitle>
                            <Target className="h-4 w-4 text-indigo-500" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{s.total_good_kg?.toLocaleString()} <span className="text-sm text-slate-400">kg</span></div>
                        </CardContent>
                    </Card>
                    <Card className="hover:shadow-lg transition-all border-rose-100 bg-gradient-to-br from-rose-50/30 to-white">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium text-rose-600">Cost of Scrap</CardTitle>
                            <IndianRupee className="h-4 w-4 text-rose-500" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-rose-700">₹{s.cost_of_scrap?.toLocaleString()}</div>
                            <p className="text-xs text-slate-500">@ ₹{s.avg_cost_per_kg}/kg avg</p>
                        </CardContent>
                    </Card>
                </div>

                {/* Charts */}
                <div className="grid gap-6 md:grid-cols-2">
                    {/* By Reason Donut */}
                    <Card className="hover:shadow-lg transition-shadow">
                        <CardHeader>
                            <CardTitle>Scrap by Reason</CardTitle>
                            <CardDescription>Distribution of waste causes</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="h-[350px] w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie data={byReason} cx="50%" cy="50%" innerRadius={70} outerRadius={120} paddingAngle={2} dataKey="value" nameKey="name">
                                            {byReason.map((_: any, idx: number) => (
                                                <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                                            ))}
                                        </Pie>
                                        <RTooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }} />
                                        <Legend wrapperStyle={{ fontSize: 11 }} />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Daily Trend */}
                    <Card className="hover:shadow-lg transition-shadow">
                        <CardHeader>
                            <CardTitle>Daily Scrap Trend</CardTitle>
                            <CardDescription>Scrap weight with cost overlay</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="h-[350px] w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={dailyTrend}>
                                        <defs>
                                            <linearGradient id="scrapFill" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                                                <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                        <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => v?.slice(5)} />
                                        <YAxis tick={{ fontSize: 11 }} />
                                        <RTooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }} />
                                        <Area type="monotone" dataKey="scrap_kg" name="Scrap (kg)" stroke="#ef4444" fill="url(#scrapFill)" strokeWidth={2} />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Process Yield + Machine Scrap */}
                <div className="grid gap-6 md:grid-cols-2">
                    <Card className="hover:shadow-lg transition-shadow">
                        <CardHeader>
                            <CardTitle>Process-wise Yield</CardTitle>
                            <CardDescription>Good output vs scrap by process</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="h-[350px] w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={byProcess} layout="vertical" margin={{ left: 80 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                        <XAxis type="number" tick={{ fontSize: 11 }} />
                                        <YAxis dataKey="process" type="category" tick={{ fontSize: 11 }} width={80} />
                                        <RTooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }} />
                                        <Legend />
                                        <Bar dataKey="good_kg" name="Good (kg)" fill="#10b981" stackId="a" radius={[0, 0, 0, 0]} />
                                        <Bar dataKey="scrap_kg" name="Scrap (kg)" fill="#ef4444" stackId="a" radius={[0, 4, 4, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Operator Scrap */}
                    <Card className="hover:shadow-lg transition-shadow">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Users className="h-5 w-5 text-violet-500" />
                                Scrap by Operator
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-slate-200">
                                            <th className="text-left py-3 px-4 font-semibold text-slate-600">Operator</th>
                                            <th className="text-right py-3 px-4 font-semibold text-slate-600">Scrap (kg)</th>
                                            <th className="text-right py-3 px-4 font-semibold text-slate-600">Events</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {byOperator.map((o: any, i: number) => (
                                            <tr key={i} className="border-b border-slate-100 hover:bg-slate-50/50">
                                                <td className="py-3 px-4 font-medium">{o.operator}</td>
                                                <td className="py-3 px-4 text-right text-rose-600">{o.scrap_kg?.toLocaleString()}</td>
                                                <td className="py-3 px-4 text-right">{o.events}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                {(byOperator.length === 0) && <div className="text-center py-8 text-slate-400">No operator data</div>}
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </ReportLayout>
    )
}

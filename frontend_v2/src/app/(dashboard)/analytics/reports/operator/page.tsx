"use client"

import { useEffect, useState, useCallback } from "react"
import { ReportLayout } from "@/components/analytics/report-layout"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { useToast } from "@/hooks/use-toast"
import { api } from "@/lib/api"
import {
    BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip,
    ResponsiveContainer, CartesianGrid, Legend
} from 'recharts'
import { Users, Trophy, AlertTriangle, TrendingUp, Gauge } from "lucide-react"

export default function OperatorReportPage() {
    const { toast } = useToast()
    const [loading, setLoading] = useState(true)
    const [data, setData] = useState<any>(null)

    const fetchData = useCallback(async () => {
        setLoading(true)
        try {
            const { data: jsonData } = await api.get(`/api/analytics/reports/operator`)
            setData(jsonData)
        } catch (error) {
            console.error(error)
            toast({ title: "Error", description: "Could not fetch operator data.", variant: "destructive" })
        } finally {
            setLoading(false)
        }
    }, [toast])

    useEffect(() => { fetchData() }, [fetchData])
    useEffect(() => { const i = setInterval(fetchData, 30000); return () => clearInterval(i) }, [fetchData])

    if (loading && !data) {
        return (
            <ReportLayout title="Operator Performance" description="Workforce productivity and efficiency metrics." isLoading={true}>
                <div className="grid grid-cols-1 gap-6">
                    {[...Array(3)].map((_, i) => <div key={i} className="h-40 bg-gradient-to-r from-slate-100 to-slate-50 animate-pulse rounded-xl" />)}
                </div>
            </ReportLayout>
        )
    }

    const s = data?.summary || {}
    const best = data?.best || {}
    const worst = data?.worst || {}

    return (
        <ReportLayout title="Operator Performance" description="Workforce efficiency, leaderboard, and productivity metrics." onRefresh={fetchData}>
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
                {/* KPIs */}
                <div className="grid gap-4 md:grid-cols-4">
                    <Card className="hover:shadow-lg transition-all">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium text-slate-600">Active Operators</CardTitle>
                            <Users className="h-4 w-4 text-indigo-500" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{s.active_operators}</div>
                        </CardContent>
                    </Card>
                    <Card className="hover:shadow-lg transition-all">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium text-slate-600">Total Output</CardTitle>
                            <TrendingUp className="h-4 w-4 text-emerald-500" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{s.total_output_kg?.toLocaleString()} <span className="text-sm text-slate-400">kg</span></div>
                        </CardContent>
                    </Card>
                    <Card className="hover:shadow-lg transition-all">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium text-slate-600">Avg Efficiency</CardTitle>
                            <Gauge className="h-4 w-4 text-violet-500" />
                        </CardHeader>
                        <CardContent>
                            <div className={`text-2xl font-bold ${s.avg_efficiency >= 90 ? 'text-emerald-600' : 'text-amber-600'}`}>{s.avg_efficiency}%</div>
                        </CardContent>
                    </Card>
                    <div className="grid gap-2">
                        <Card className="border-emerald-200 bg-gradient-to-br from-emerald-50/50 to-white">
                            <CardContent className="flex items-center gap-3 pt-4 pb-3">
                                <Trophy className="h-5 w-5 text-emerald-500 flex-shrink-0" />
                                <div>
                                    <p className="text-xs text-emerald-600">Best: {best?.full_name || best?.name}</p>
                                    <p className="text-sm font-bold">{best?.efficiency}% efficiency</p>
                                </div>
                            </CardContent>
                        </Card>
                        <Card className="border-rose-200 bg-gradient-to-br from-rose-50/50 to-white">
                            <CardContent className="flex items-center gap-3 pt-4 pb-3">
                                <AlertTriangle className="h-5 w-5 text-rose-500 flex-shrink-0" />
                                <div>
                                    <p className="text-xs text-rose-600">Needs coaching: {worst?.full_name || worst?.name}</p>
                                    <p className="text-sm font-bold">{worst?.efficiency}% efficiency</p>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </div>

                {/* Efficiency Chart */}
                <Card className="hover:shadow-lg transition-shadow">
                    <CardHeader>
                        <CardTitle>Operator Efficiency Comparison</CardTitle>
                        <CardDescription>Production output and scrap by operator</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="h-[400px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={data?.leaderboard || []} layout="vertical" margin={{ left: 100 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                    <XAxis type="number" tick={{ fontSize: 11 }} />
                                    <YAxis dataKey="full_name" type="category" tick={{ fontSize: 11 }} width={100} />
                                    <RTooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }} />
                                    <Legend />
                                    <Bar dataKey="produced_kg" name="Good Output (kg)" fill="#10b981" stackId="a" radius={[0, 0, 0, 0]} />
                                    <Bar dataKey="scrap_kg" name="Scrap (kg)" fill="#ef4444" stackId="a" radius={[0, 4, 4, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </CardContent>
                </Card>

                {/* Leaderboard Table */}
                <Card>
                    <CardHeader>
                        <CardTitle>Operator Leaderboard</CardTitle>
                        <CardDescription>Ranked by efficiency — includes completion rate and target achievement</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-slate-200">
                                        <th className="text-center py-3 px-2 font-semibold text-slate-600 w-10">#</th>
                                        <th className="text-left py-3 px-4 font-semibold text-slate-600">Operator</th>
                                        <th className="text-right py-3 px-4 font-semibold text-slate-600">Jobs</th>
                                        <th className="text-right py-3 px-4 font-semibold text-slate-600">Produced (kg)</th>
                                        <th className="text-right py-3 px-4 font-semibold text-slate-600">Scrap (kg)</th>
                                        <th className="text-right py-3 px-4 font-semibold text-slate-600">Efficiency</th>
                                        <th className="text-right py-3 px-4 font-semibold text-slate-600">Completion</th>
                                        <th className="text-right py-3 px-4 font-semibold text-slate-600">Target %</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(data?.leaderboard || []).sort((a: any, b: any) => b.efficiency - a.efficiency).map((op: any, i: number) => (
                                        <tr key={i} className={`border-b border-slate-100 hover:bg-slate-50/50 transition-colors ${i === 0 ? 'bg-emerald-50/30' : ''}`}>
                                            <td className="py-3 px-2 text-center">
                                                {i === 0 ? <Trophy className="w-4 h-4 text-yellow-500 mx-auto" /> : <span className="text-slate-400">{i + 1}</span>}
                                            </td>
                                            <td className="py-3 px-4 font-medium">{op.full_name || op.name}</td>
                                            <td className="py-3 px-4 text-right">{op.jobs}</td>
                                            <td className="py-3 px-4 text-right">{op.produced_kg?.toLocaleString()}</td>
                                            <td className="py-3 px-4 text-right text-rose-600">{op.scrap_kg?.toLocaleString()}</td>
                                            <td className="py-3 px-4 text-right">
                                                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${op.efficiency >= 95 ? 'bg-emerald-50 text-emerald-700' :
                                                        op.efficiency >= 85 ? 'bg-amber-50 text-amber-700' :
                                                            'bg-rose-50 text-rose-700'
                                                    }`}>{op.efficiency}%</span>
                                            </td>
                                            <td className="py-3 px-4 text-right">{op.completion_rate}%</td>
                                            <td className="py-3 px-4 text-right">{op.target_achievement}%</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {(!data?.leaderboard?.length) && <div className="text-center py-12 text-slate-400">No operator data</div>}
                        </div>
                    </CardContent>
                </Card>
            </div>
        </ReportLayout>
    )
}

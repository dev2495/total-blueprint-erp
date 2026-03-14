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
import { Truck, Package, Clock, CheckCircle, Users } from "lucide-react"

const STATUS_COLORS: Record<string, string> = {
    'DRAFT': '#94a3b8', 'DISPATCHED': '#3b82f6', 'IN_TRANSIT': '#f59e0b',
    'DELIVERED': '#10b981', 'CANCELLED': '#ef4444',
};

export default function DispatchReportPage() {
    const { toast } = useToast()
    const [loading, setLoading] = useState(true)
    const [data, setData] = useState<any>(null)

    const fetchData = useCallback(async () => {
        setLoading(true)
        try {
            const { data: jsonData } = await api.get(`/api/analytics/reports/dispatch`)
            setData(jsonData)
        } catch (error) {
            console.error(error)
            toast({ title: "Error", description: "Could not fetch dispatch data.", variant: "destructive" })
        } finally {
            setLoading(false)
        }
    }, [toast])

    useEffect(() => { fetchData() }, [fetchData])
    useEffect(() => { const i = setInterval(fetchData, 30000); return () => clearInterval(i) }, [fetchData])

    if (loading && !data) {
        return (
            <ReportLayout title="Dispatch & Logistics" description="Delivery challan tracking and logistics analytics." isLoading={true}>
                <div className="grid grid-cols-1 gap-6">
                    {[...Array(3)].map((_, i) => <div key={i} className="h-40 bg-gradient-to-r from-slate-100 to-slate-50 animate-pulse rounded-xl" />)}
                </div>
            </ReportLayout>
        )
    }

    const s = data?.summary || {}
    const pipelineData = Array.isArray(data?.pipeline)
        ? data.pipeline
        : (Array.isArray(data?.breakdowns?.pipeline) ? data.breakdowns.pipeline : [])
    const dailyTrend = Array.isArray(data?.daily_trend)
        ? data.daily_trend
        : (Array.isArray(data?.series) ? data.series : [])
    const byCustomer = Array.isArray(data?.by_customer)
        ? data.by_customer
        : (Array.isArray(data?.breakdowns?.by_customer) ? data.breakdowns.by_customer : [])
    const recentChallans = Array.isArray(data?.recent_challans)
        ? data.recent_challans
        : (Array.isArray(data?.rows) ? data.rows : [])

    return (
        <ReportLayout title="Dispatch & Logistics" description="Delivery challan tracking, customer dispatch volume, and logistics pipeline." onRefresh={fetchData}>
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
                {/* KPIs */}
                <div className="grid gap-4 md:grid-cols-4">
                    <Card className="hover:shadow-lg transition-all">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium text-slate-600">Total Challans</CardTitle>
                            <Truck className="h-4 w-4 text-indigo-500" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{s.total_challans}</div>
                            <p className="text-xs text-slate-500">{s.dispatched} dispatched</p>
                        </CardContent>
                    </Card>
                    <Card className="hover:shadow-lg transition-all">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium text-slate-600">Pending</CardTitle>
                            <Clock className="h-4 w-4 text-amber-500" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-amber-600">{s.pending}</div>
                            <p className="text-xs text-slate-500">awaiting dispatch</p>
                        </CardContent>
                    </Card>
                    <Card className="hover:shadow-lg transition-all">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium text-slate-600">Total Weight</CardTitle>
                            <Package className="h-4 w-4 text-blue-500" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{s.total_weight_kg?.toLocaleString()} <span className="text-sm text-slate-400">kg</span></div>
                            <p className="text-xs text-slate-500">{s.total_pcs?.toLocaleString()} pieces</p>
                        </CardContent>
                    </Card>
                    <Card className="hover:shadow-lg transition-all border-emerald-100 bg-gradient-to-br from-emerald-50/30 to-white">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium text-emerald-600">Dispatched</CardTitle>
                            <CheckCircle className="h-4 w-4 text-emerald-500" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-emerald-700">{s.dispatched}</div>
                        </CardContent>
                    </Card>
                </div>

                {/* Charts */}
                <div className="grid gap-6 md:grid-cols-2">
                    {/* Pipeline Donut */}
                    <Card className="hover:shadow-lg transition-shadow">
                        <CardHeader>
                            <CardTitle>Dispatch Pipeline</CardTitle>
                            <CardDescription>Challans by status</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="h-[350px] w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie data={pipelineData} cx="50%" cy="50%" innerRadius={60} outerRadius={110} paddingAngle={2} dataKey="count" nameKey="status">
                                            {pipelineData.map((entry: any, idx: number) => (
                                                <Cell key={idx} fill={STATUS_COLORS[entry.status] || '#6366f1'} />
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
                            <CardTitle>Daily Dispatch Volume</CardTitle>
                            <CardDescription>Weight dispatched per day</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="h-[350px] w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={dailyTrend}>
                                        <defs>
                                            <linearGradient id="dispFill" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                                                <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                        <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => v?.slice(5)} />
                                        <YAxis tick={{ fontSize: 11 }} />
                                        <RTooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }} />
                                        <Area type="monotone" dataKey="weight_kg" name="Weight (kg)" stroke="#6366f1" fill="url(#dispFill)" strokeWidth={2} />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Customer + Recent Challans */}
                <div className="grid gap-6 md:grid-cols-2">
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Users className="h-5 w-5 text-indigo-500" />
                                Top Customers by Dispatch
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="h-[350px] w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={byCustomer} layout="vertical" margin={{ left: 80 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                        <XAxis type="number" tick={{ fontSize: 11 }} />
                                        <YAxis dataKey="customer" type="category" tick={{ fontSize: 11 }} width={80} />
                                        <RTooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }} />
                                        <Bar dataKey="weight_kg" name="Weight (kg)" fill="#6366f1" radius={[0, 6, 6, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>Recent Challans</CardTitle>
                            <CardDescription>Latest delivery challans</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="overflow-x-auto max-h-[350px] overflow-y-auto">
                                <table className="w-full text-sm">
                                    <thead className="sticky top-0 bg-white">
                                        <tr className="border-b border-slate-200">
                                            <th className="text-left py-3 px-3 font-semibold text-slate-600">DC No</th>
                                            <th className="text-left py-3 px-3 font-semibold text-slate-600">Customer</th>
                                            <th className="text-left py-3 px-3 font-semibold text-slate-600">Status</th>
                                            <th className="text-left py-3 px-3 font-semibold text-slate-600">Date</th>
                                            <th className="text-left py-3 px-3 font-semibold text-slate-600">Vehicle</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {recentChallans.map((c: any, i: number) => (
                                            <tr key={i} className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors">
                                                <td className="py-3 px-3 font-mono font-medium text-xs">{c.dc_no}</td>
                                                <td className="py-3 px-3 text-sm">{c.customer}</td>
                                                <td className="py-3 px-3">
                                                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${c.status === 'DELIVERED' ? 'bg-emerald-100 text-emerald-700' :
                                                            c.status === 'DISPATCHED' ? 'bg-blue-100 text-blue-700' :
                                                                c.status === 'IN_TRANSIT' ? 'bg-amber-100 text-amber-700' :
                                                                    'bg-slate-100 text-slate-600'
                                                        }`}>{c.status}</span>
                                                </td>
                                                <td className="py-3 px-3 text-xs text-slate-500">{c.date}</td>
                                                <td className="py-3 px-3 text-xs text-slate-500">{c.vehicle}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                {(recentChallans.length === 0) && <div className="text-center py-12 text-slate-400">No dispatch data</div>}
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </ReportLayout>
    )
}

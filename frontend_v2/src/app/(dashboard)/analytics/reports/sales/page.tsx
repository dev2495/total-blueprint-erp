"use client"

import { useEffect, useState, useCallback } from "react"
import { ReportLayout } from "@/components/analytics/report-layout"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { useToast } from "@/hooks/use-toast"
import { api } from "@/lib/api"
import {
    BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip,
    ResponsiveContainer, CartesianGrid, Legend, PieChart, Pie, Cell
} from 'recharts'
import { ShoppingCart, Clock, CheckCircle, AlertTriangle, TrendingUp, Users } from "lucide-react"

const STATUS_COLORS: Record<string, string> = {
    'DRAFT': '#94a3b8', 'PENDING': '#f59e0b', 'CONFIRMED': '#3b82f6', 'PLANNING': '#8b5cf6',
    'IN_PROGRESS': '#6366f1', 'COMPLETED': '#10b981', 'DELIVERED': '#059669', 'CANCELLED': '#ef4444'
};

export default function SalesReportPage() {
    const { toast } = useToast()
    const [loading, setLoading] = useState(true)
    const [data, setData] = useState<any>(null)

    const fetchData = useCallback(async () => {
        setLoading(true)
        try {
            const { data: jsonData } = await api.get(`/api/analytics/reports/sales`)
            setData(jsonData)
        } catch (error) {
            console.error(error)
            toast({ title: "Error", description: "Could not fetch sales data.", variant: "destructive" })
        } finally {
            setLoading(false)
        }
    }, [toast])

    useEffect(() => { fetchData() }, [fetchData])
    useEffect(() => { const i = setInterval(fetchData, 30000); return () => clearInterval(i) }, [fetchData])

    if (loading && !data) {
        return (
            <ReportLayout title="Sales Fulfillment" description="Order performance and delivery analytics." isLoading={true}>
                <div className="grid grid-cols-1 gap-6">
                    {[...Array(3)].map((_, i) => <div key={i} className="h-40 bg-gradient-to-r from-slate-100 to-slate-50 animate-pulse rounded-xl" />)}
                </div>
            </ReportLayout>
        )
    }

    const s = data?.summary || {}
    const bm = data?.benchmarks || {}
    const pipelineData = Array.isArray(data?.pipeline)
        ? data.pipeline
        : (Array.isArray(data?.breakdowns?.pipeline) ? data.breakdowns.pipeline : [])
    const trendData = Array.isArray(data?.trend) ? data.trend : (Array.isArray(data?.series) ? data.series : [])
    const topCustomers = Array.isArray(data?.top_customers)
        ? data.top_customers
        : (Array.isArray(data?.breakdowns?.top_customers) ? data.breakdowns.top_customers : [])

    return (
        <ReportLayout title="Sales Fulfillment" description="On-Time-In-Full delivery, order pipeline, and customer analytics." onRefresh={fetchData}>
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
                {/* KPIs */}
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
                    <Card className="hover:shadow-lg transition-all border-emerald-100 bg-gradient-to-br from-emerald-50/30 to-white">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium text-emerald-600">OTIF Rate</CardTitle>
                            <CheckCircle className="h-4 w-4 text-emerald-500" />
                        </CardHeader>
                        <CardContent>
                            <div className={`text-2xl font-bold ${s.otif_rate >= bm.target_otif ? 'text-emerald-600' : 'text-amber-600'}`}>{s.otif_rate}%</div>
                            <p className="text-xs text-slate-500">Target: {bm.target_otif}%</p>
                        </CardContent>
                    </Card>
                    <Card className="hover:shadow-lg transition-all">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium text-slate-600">Completed</CardTitle>
                            <ShoppingCart className="h-4 w-4 text-indigo-500" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{s.completed_count}</div>
                            <p className="text-xs text-slate-500">orders fulfilled</p>
                        </CardContent>
                    </Card>
                    <Card className="hover:shadow-lg transition-all">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium text-slate-600">Backlog</CardTitle>
                            <Clock className="h-4 w-4 text-amber-500" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{s.backlog_count}</div>
                            <p className="text-xs text-slate-500">active orders</p>
                        </CardContent>
                    </Card>
                    <Card className="hover:shadow-lg transition-all border-rose-100 bg-gradient-to-br from-rose-50/30 to-white">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium text-rose-600">Overdue</CardTitle>
                            <AlertTriangle className="h-4 w-4 text-rose-500" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-rose-700">{s.overdue_count}</div>
                            <p className="text-xs text-slate-500">past delivery date</p>
                        </CardContent>
                    </Card>
                    <Card className="hover:shadow-lg transition-all">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium text-slate-600">Weight Ordered</CardTitle>
                            <TrendingUp className="h-4 w-4 text-blue-500" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{s.total_weight_ordered_kg?.toLocaleString()} <span className="text-sm text-slate-400">kg</span></div>
                        </CardContent>
                    </Card>
                </div>

                {/* Charts */}
                <div className="grid gap-6 md:grid-cols-2">
                    {/* Pipeline */}
                    <Card className="hover:shadow-lg transition-shadow">
                        <CardHeader>
                            <CardTitle>Order Pipeline</CardTitle>
                            <CardDescription>Orders by status</CardDescription>
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

                    {/* Monthly Trend */}
                    <Card className="hover:shadow-lg transition-shadow">
                        <CardHeader>
                            <CardTitle>Monthly Order Trend</CardTitle>
                            <CardDescription>Created vs Completed orders</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="h-[350px] w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={trendData}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                                        <YAxis tick={{ fontSize: 11 }} />
                                        <RTooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }} />
                                        <Legend />
                                        <Bar dataKey="created" name="Created" fill="#6366f1" radius={[4, 4, 0, 0]} />
                                        <Bar dataKey="completed" name="Completed" fill="#10b981" radius={[4, 4, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Top Customers + Overdue */}
                <div className="grid gap-6 md:grid-cols-2">
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Users className="h-5 w-5 text-indigo-500" />
                                Top Customers
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-slate-200">
                                            <th className="text-left py-3 px-4 font-semibold text-slate-600">Customer</th>
                                            <th className="text-right py-3 px-4 font-semibold text-slate-600">Weight (kg)</th>
                                            <th className="text-right py-3 px-4 font-semibold text-slate-600">Orders</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {topCustomers.map((c: any, i: number) => (
                                            <tr key={i} className="border-b border-slate-100 hover:bg-slate-50/50">
                                                <td className="py-3 px-4 font-medium">{c.name}</td>
                                                <td className="py-3 px-4 text-right">{c.weight_kg?.toLocaleString()}</td>
                                                <td className="py-3 px-4 text-right">{c.orders}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="border-rose-100">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2 text-rose-700">
                                <AlertTriangle className="h-5 w-5 text-rose-500" />
                                Overdue Orders
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-slate-200">
                                            <th className="text-left py-3 px-4 font-semibold text-slate-600">Order</th>
                                            <th className="text-left py-3 px-4 font-semibold text-slate-600">Customer</th>
                                            <th className="text-right py-3 px-4 font-semibold text-slate-600">Days Late</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {(data?.overdue_orders || []).map((o: any, i: number) => (
                                            <tr key={i} className="border-b border-slate-100 hover:bg-rose-50/50">
                                                <td className="py-3 px-4 font-medium">{o.order_number}</td>
                                                <td className="py-3 px-4">{o.customer_name}</td>
                                                <td className="py-3 px-4 text-right">
                                                    <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 text-xs font-semibold">{o.days_overdue}d</span>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                {(!data?.overdue_orders?.length) && <div className="text-center py-8 text-slate-400">No overdue orders</div>}
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </ReportLayout>
    )
}

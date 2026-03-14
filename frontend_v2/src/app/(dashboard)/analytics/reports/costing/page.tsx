"use client"

import { useEffect, useState, useCallback } from "react"
import { ReportLayout } from "@/components/analytics/report-layout"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { useToast } from "@/hooks/use-toast"
import { api } from "@/lib/api"
import {
    BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip,
    ResponsiveContainer, CartesianGrid, Legend, LineChart, Line,
    PieChart, Pie, Cell, AreaChart, Area
} from 'recharts'
import { IndianRupee, TrendingUp, Factory, PieChartIcon, Layers, Zap } from "lucide-react"

const DONUT_COLORS = ['#6366f1', '#f97316'];

export default function CostingReportPage() {
    const { toast } = useToast()
    const [loading, setLoading] = useState(true)
    const [data, setData] = useState<any>(null)

    const fetchData = useCallback(async () => {
        setLoading(true)
        try {
            const { data: jsonData } = await api.get(`/api/analytics/reports/costing`)
            setData(jsonData)
        } catch (error) {
            console.error(error)
            toast({ title: "Error", description: "Could not fetch costing data.", variant: "destructive" })
        } finally {
            setLoading(false)
        }
    }, [toast])

    useEffect(() => { fetchData() }, [fetchData])
    useEffect(() => { const i = setInterval(fetchData, 30000); return () => clearInterval(i) }, [fetchData])

    if (loading && !data) {
        return (
            <ReportLayout title="Costing & Profitability" description="Cost analysis and margin tracking." isLoading={true}>
                <div className="grid grid-cols-1 gap-6">
                    {[...Array(3)].map((_, i) => <div key={i} className="h-40 bg-gradient-to-r from-slate-100 to-slate-50 animate-pulse rounded-xl" />)}
                </div>
            </ReportLayout>
        )
    }

    const s = data?.summary || {}
    const bm = data?.benchmarks || {}
    const costSplit = Array.isArray(data?.cost_split)
        ? data.cost_split
        : (Array.isArray(data?.breakdowns?.cost_split) ? data.breakdowns.cost_split : [])
    const customerMargin = Array.isArray(data?.customer_margin)
        ? data.customer_margin
        : (Array.isArray(data?.breakdowns?.customer_margin) ? data.breakdowns.customer_margin : [])

    return (
        <ReportLayout title="Costing & Profitability" description="Material cost, conversion cost, margin analysis, and overhead tracking." onRefresh={fetchData}>
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
                {/* KPIs */}
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                    <Card className="hover:shadow-lg transition-all">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium text-slate-600">Total Revenue</CardTitle>
                            <IndianRupee className="h-4 w-4 text-emerald-500" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">₹{s.total_revenue?.toLocaleString()}</div>
                            <p className="text-xs text-slate-500">{s.total_jobs_costed} jobs costed</p>
                        </CardContent>
                    </Card>
                    <Card className="hover:shadow-lg transition-all">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium text-slate-600">Production Cost</CardTitle>
                            <Factory className="h-4 w-4 text-rose-500" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">₹{s.total_production_cost?.toLocaleString()}</div>
                            <p className="text-xs text-slate-500">₹{s.avg_cost_per_kg}/kg avg</p>
                        </CardContent>
                    </Card>
                    <Card className="hover:shadow-lg transition-all border-emerald-100 bg-gradient-to-br from-emerald-50/30 to-white">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium text-emerald-600">Gross Margin</CardTitle>
                            <TrendingUp className="h-4 w-4 text-emerald-500" />
                        </CardHeader>
                        <CardContent>
                            <div className={`text-2xl font-bold ${s.avg_margin_pct >= bm.target_gross_margin ? 'text-emerald-600' : 'text-amber-600'}`}>{s.avg_margin_pct}%</div>
                            <p className="text-xs text-slate-500">₹{s.total_margin?.toLocaleString()} total margin</p>
                            <p className="text-xs text-slate-400">Target: {bm.target_gross_margin}%</p>
                        </CardContent>
                    </Card>
                    <Card className="hover:shadow-lg transition-all">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium text-slate-600">Cost Breakdown</CardTitle>
                            <Layers className="h-4 w-4 text-violet-500" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-lg font-semibold">Material: ₹{s.total_material_cost?.toLocaleString()}</div>
                            <div className="text-lg font-semibold">Conversion: ₹{s.total_process_cost?.toLocaleString()}</div>
                        </CardContent>
                    </Card>
                </div>

                {/* Charts Row */}
                <div className="grid gap-6 md:grid-cols-3">
                    {/* Cost Split Donut */}
                    <Card className="hover:shadow-lg transition-shadow">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <PieChartIcon className="h-5 w-5 text-indigo-500" />
                                Material vs Conversion
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="h-[300px] w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie data={costSplit} cx="50%" cy="50%" innerRadius={70} outerRadius={110} paddingAngle={3} dataKey="value" nameKey="name">
                                            {costSplit.map((_: any, idx: number) => (
                                                <Cell key={idx} fill={DONUT_COLORS[idx % DONUT_COLORS.length]} />
                                            ))}
                                        </Pie>
                                        <RTooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }} formatter={(val: any) => `₹${val?.toLocaleString()}`} />
                                        <Legend />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Monthly P&L */}
                    <Card className="md:col-span-2 hover:shadow-lg transition-shadow">
                        <CardHeader>
                            <CardTitle>Monthly P&L Trend</CardTitle>
                            <CardDescription>Revenue, cost, and margin over time</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="h-[300px] w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={data?.monthly_trend || []}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                                        <YAxis tick={{ fontSize: 11 }} />
                                        <RTooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }} formatter={(val: any) => `₹${val?.toLocaleString()}`} />
                                        <Legend />
                                        <Bar dataKey="revenue" name="Revenue" fill="#10b981" radius={[4, 4, 0, 0]} />
                                        <Bar dataKey="cost" name="Cost" fill="#ef4444" radius={[4, 4, 0, 0]} />
                                        <Bar dataKey="margin" name="Margin" fill="#6366f1" radius={[4, 4, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Cost per KG trend + Overheads */}
                <div className="grid gap-6 md:grid-cols-2">
                    <Card className="hover:shadow-lg transition-shadow">
                        <CardHeader>
                            <CardTitle>Cost per KG Trend</CardTitle>
                            <CardDescription>Monthly average cost per kilogram</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="h-[300px] w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={data?.cost_per_kg_trend || []}>
                                        <defs>
                                            <linearGradient id="cpkFill" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                                                <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                                        <YAxis tick={{ fontSize: 11 }} />
                                        <RTooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }} formatter={(val: any) => `₹${val}`} />
                                        <Area type="monotone" dataKey="cost_per_kg" name="Cost/kg" stroke="#6366f1" fill="url(#cpkFill)" strokeWidth={2} />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="hover:shadow-lg transition-shadow">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Zap className="h-5 w-5 text-amber-500" />
                                Monthly Overheads
                            </CardTitle>
                            <CardDescription>Electricity, labor, and other overheads</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="h-[300px] w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={data?.overhead_trend || []}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                        <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                                        <YAxis tick={{ fontSize: 11 }} />
                                        <RTooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }} formatter={(val: any) => `₹${val?.toLocaleString()}`} />
                                        <Legend />
                                        <Bar dataKey="electricity" name="Electricity" fill="#f59e0b" stackId="a" />
                                        <Bar dataKey="labor" name="Labor" fill="#3b82f6" stackId="a" />
                                        <Bar dataKey="other" name="Other" fill="#94a3b8" stackId="a" />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Customer Margin Table */}
                <Card>
                    <CardHeader>
                        <CardTitle>Customer-wise Profitability</CardTitle>
                        <CardDescription>Revenue, cost, and margin breakdown by customer</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-slate-200">
                                        <th className="text-left py-3 px-4 font-semibold text-slate-600">Customer</th>
                                        <th className="text-right py-3 px-4 font-semibold text-slate-600">Revenue</th>
                                        <th className="text-right py-3 px-4 font-semibold text-slate-600">Cost</th>
                                        <th className="text-right py-3 px-4 font-semibold text-slate-600">Margin</th>
                                        <th className="text-right py-3 px-4 font-semibold text-slate-600">Margin %</th>
                                        <th className="text-right py-3 px-4 font-semibold text-slate-600">Orders</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {customerMargin.map((c: any, i: number) => (
                                        <tr key={i} className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors">
                                            <td className="py-3 px-4 font-medium">{c.customer}</td>
                                            <td className="py-3 px-4 text-right">₹{c.revenue?.toLocaleString()}</td>
                                            <td className="py-3 px-4 text-right text-rose-600">₹{c.cost?.toLocaleString()}</td>
                                            <td className="py-3 px-4 text-right text-emerald-600">₹{c.margin?.toLocaleString()}</td>
                                            <td className="py-3 px-4 text-right">
                                                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${c.margin_pct >= 25 ? 'bg-emerald-50 text-emerald-700' :
                                                        c.margin_pct >= 15 ? 'bg-amber-50 text-amber-700' :
                                                            'bg-rose-50 text-rose-700'
                                                    }`}>{c.margin_pct}%</span>
                                            </td>
                                            <td className="py-3 px-4 text-right">{c.orders}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {(customerMargin.length === 0) && <div className="text-center py-12 text-slate-400">No costing data available</div>}
                        </div>
                    </CardContent>
                </Card>
            </div>
        </ReportLayout>
    )
}

"use client"

import { useEffect, useState, useCallback } from "react"
import { ReportLayout } from "@/components/analytics/report-layout"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { useToast } from "@/hooks/use-toast"
import { api } from "@/lib/api"
import {
    BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip,
    ResponsiveContainer, CartesianGrid, Legend, Cell
} from 'recharts'
import { Scale, TrendingUp, AlertTriangle, CheckCircle, ArrowUpRight, ArrowDownRight, FlaskConical, Layers } from "lucide-react"

const VARIANCE_COLORS = {
    theoretical: '#3b82f6',
    required: '#8b5cf6',
    planned_issue: '#f59e0b',
    actual_issued: '#f97316',
    consumed: '#ef4444',
};

export default function MrpReportPage() {
    const { toast } = useToast()
    const [loading, setLoading] = useState(true)
    const [data, setData] = useState<any>(null)

    const fetchData = useCallback(async () => {
        setLoading(true)
        try {
            const { data: jsonData } = await api.get(`/api/analytics/reports/mrp`)
            setData(jsonData)
        } catch (error) {
            console.error(error)
            toast({ title: "Error", description: "Could not fetch MRP data.", variant: "destructive" })
        } finally {
            setLoading(false)
        }
    }, [toast])

    useEffect(() => { fetchData() }, [fetchData])
    useEffect(() => { const i = setInterval(fetchData, 30000); return () => clearInterval(i) }, [fetchData])

    if (loading && !data) {
        return (
            <ReportLayout title="MRP & Consumption Variance" description="Theory vs Actual vs Issue vs Plan analysis." isLoading={true}>
                <div className="grid grid-cols-1 gap-6">
                    {[...Array(4)].map((_, i) => <div key={i} className="h-32 bg-gradient-to-r from-slate-100 to-slate-50 animate-pulse rounded-xl" />)}
                </div>
            </ReportLayout>
        )
    }

    const s = data?.summary || {}
    const variance = s.variance_kg || 0
    const isOverConsumption = variance > 0
    const comparisonChart = Array.isArray(data?.comparison_chart)
        ? data.comparison_chart
        : (Array.isArray(data?.series) ? data.series : [])
    const waterfallChart = Array.isArray(data?.waterfall)
        ? data.waterfall
        : (Array.isArray(data?.breakdowns?.waterfall) ? data.breakdowns.waterfall : [])
    const byMaterial = Array.isArray(data?.by_material) ? data.by_material : (Array.isArray(data?.rows) ? data.rows : [])
    const jobVariance = Array.isArray(data?.job_variance)
        ? data.job_variance
        : (Array.isArray(data?.breakdowns?.job_variance) ? data.breakdowns.job_variance : [])

    return (
        <ReportLayout title="MRP & Consumption Variance" description="Theory vs Actual vs Issue vs Plan — Deep Material Variance Analysis" onRefresh={fetchData}>
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">

                {/* KPI Cards */}
                <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
                    <Card className="hover:shadow-lg transition-all">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium text-slate-600">Theoretical Need</CardTitle>
                            <FlaskConical className="h-4 w-4 text-blue-500" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-xl font-bold">{s.theoretical_kg?.toLocaleString()} <span className="text-xs text-slate-400">kg</span></div>
                            <p className="text-xs text-slate-500">Ideal no-loss requirement</p>
                        </CardContent>
                    </Card>
                    <Card className="hover:shadow-lg transition-all">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium text-slate-600">BOM Required</CardTitle>
                            <Layers className="h-4 w-4 text-violet-500" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-xl font-bold">{s.required_kg?.toLocaleString()} <span className="text-xs text-slate-400">kg</span></div>
                            <p className="text-xs text-slate-500">+{s.waste_factor_pct}% waste factor</p>
                        </CardContent>
                    </Card>
                    <Card className="hover:shadow-lg transition-all">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium text-slate-600">Planned Issue</CardTitle>
                            <Scale className="h-4 w-4 text-amber-500" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-xl font-bold">{s.planned_issue_kg?.toLocaleString()} <span className="text-xs text-slate-400">kg</span></div>
                        </CardContent>
                    </Card>
                    <Card className="hover:shadow-lg transition-all">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium text-slate-600">Actual Issued</CardTitle>
                            <TrendingUp className="h-4 w-4 text-orange-500" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-xl font-bold">{s.actual_issued_kg?.toLocaleString()} <span className="text-xs text-slate-400">kg</span></div>
                            <p className="text-xs text-slate-500">Issue accuracy: {s.issue_accuracy_pct}%</p>
                        </CardContent>
                    </Card>
                    <Card className="hover:shadow-lg transition-all">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium text-slate-600">Consumed</CardTitle>
                            <CheckCircle className="h-4 w-4 text-emerald-500" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-xl font-bold">{s.consumed_kg?.toLocaleString()} <span className="text-xs text-slate-400">kg</span></div>
                            <p className="text-xs text-slate-500">Planning accuracy: {s.planning_accuracy_pct}%</p>
                        </CardContent>
                    </Card>
                    <Card className={`hover:shadow-lg transition-all ${isOverConsumption ? 'border-rose-200 bg-gradient-to-br from-rose-50/50 to-white' : 'border-emerald-200 bg-gradient-to-br from-emerald-50/50 to-white'}`}>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className={`text-sm font-medium ${isOverConsumption ? 'text-rose-600' : 'text-emerald-600'}`}>Net Variance</CardTitle>
                            <AlertTriangle className={`h-4 w-4 ${isOverConsumption ? 'text-rose-500' : 'text-emerald-500'}`} />
                        </CardHeader>
                        <CardContent>
                            <div className={`text-xl font-bold flex items-center gap-1 ${isOverConsumption ? 'text-rose-700' : 'text-emerald-700'}`}>
                                {isOverConsumption ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownRight className="h-4 w-4" />}
                                {isOverConsumption ? '+' : ''}{variance?.toLocaleString()} <span className="text-xs font-normal">kg</span>
                            </div>
                            <p className="text-xs text-slate-500">{isOverConsumption ? 'Over-consumption' : 'Under-consumption'}</p>
                        </CardContent>
                    </Card>
                </div>

                {/* Comparison Chart: Theory vs Actual vs Issue vs Plan */}
                <Card className="hover:shadow-lg transition-shadow">
                    <CardHeader>
                        <CardTitle className="text-lg">Theory vs Required vs Planned vs Issued vs Consumed</CardTitle>
                        <CardDescription>Side-by-side comparison of all material stages</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="h-[300px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={comparisonChart} margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                    <XAxis dataKey="category" tick={{ fontSize: 12 }} />
                                    <YAxis tick={{ fontSize: 11 }} />
                                    <RTooltip
                                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}
                                        formatter={(val: any) => `${val?.toLocaleString()} kg`}
                                    />
                                    <Bar dataKey="value" name="Quantity (kg)" radius={[6, 6, 0, 0]}>
                                        {comparisonChart.map((_: any, idx: number) => {
                                            const colors = ['#3b82f6', '#8b5cf6', '#f59e0b', '#f97316', '#ef4444'];
                                            return <Cell key={idx} fill={colors[idx % colors.length]} />;
                                        })}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </CardContent>
                </Card>

                {/* Waterfall Chart */}
                <Card className="hover:shadow-lg transition-shadow">
                    <CardHeader>
                        <CardTitle>Variance Waterfall</CardTitle>
                        <CardDescription>How theoretical need transforms into net variance through each stage</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="h-[350px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={waterfallChart} margin={{ top: 20, right: 20, bottom: 40, left: 20 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                    <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-15} textAnchor="end" />
                                    <YAxis tick={{ fontSize: 11 }} />
                                    <RTooltip
                                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}
                                        formatter={(val: any) => `${val?.toLocaleString()} kg`}
                                    />
                                    <Bar dataKey="value" name="Quantity (kg)" radius={[4, 4, 0, 0]}>
                                        {waterfallChart.map((entry: any, idx: number) => {
                                            let color = '#6366f1';
                                            if (entry.type === 'add') color = '#f97316';
                                            if (entry.type === 'subtract') color = '#10b981';
                                            if (entry.type === 'total') color = entry.value > 0 ? '#ef4444' : '#10b981';
                                            if (entry.type === 'subtotal') color = '#8b5cf6';
                                            return <Cell key={idx} fill={color} />;
                                        })}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </CardContent>
                </Card>

                {/* Material-wise Variance Table */}
                <Card className="hover:shadow-lg transition-shadow">
                    <CardHeader>
                        <CardTitle>Material-wise Variance Analysis</CardTitle>
                        <CardDescription>Detailed theory vs actual for each material — sorted by consumption</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-slate-200 bg-slate-50/50">
                                        <th className="text-left py-3 px-3 font-semibold text-slate-600">Material</th>
                                        <th className="text-right py-3 px-3 font-semibold text-blue-600">Theoretical</th>
                                        <th className="text-right py-3 px-3 font-semibold text-violet-600">Required</th>
                                        <th className="text-right py-3 px-3 font-semibold text-amber-600">Planned Issue</th>
                                        <th className="text-right py-3 px-3 font-semibold text-orange-600">Actual Issued</th>
                                        <th className="text-right py-3 px-3 font-semibold text-emerald-600">Consumed</th>
                                        <th className="text-right py-3 px-3 font-semibold text-slate-600">Variance</th>
                                        <th className="text-right py-3 px-3 font-semibold text-slate-600">Var %</th>
                                        <th className="text-center py-3 px-3 font-semibold text-slate-600">Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {byMaterial.map((m: any, i: number) => (
                                        <tr key={i} className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors">
                                            <td className="py-3 px-3">
                                                <div className="font-medium">{m.name}</div>
                                                {m.code && <div className="text-xs text-slate-400">{m.code}</div>}
                                            </td>
                                            <td className="py-3 px-3 text-right text-blue-600">{m.theoretical?.toLocaleString()}</td>
                                            <td className="py-3 px-3 text-right text-violet-600">{m.required?.toLocaleString()}</td>
                                            <td className="py-3 px-3 text-right text-amber-600">{m.planned_issue?.toLocaleString()}</td>
                                            <td className="py-3 px-3 text-right text-orange-600">{m.actual_issued?.toLocaleString()}</td>
                                            <td className="py-3 px-3 text-right font-medium">{m.consumed?.toLocaleString()}</td>
                                            <td className={`py-3 px-3 text-right font-semibold ${m.variance > 0 ? 'text-rose-600' : m.variance < 0 ? 'text-emerald-600' : ''}`}>
                                                {m.variance > 0 ? '+' : ''}{m.variance?.toLocaleString()}
                                            </td>
                                            <td className="py-3 px-3 text-right text-slate-500">{m.variance_pct}%</td>
                                            <td className="py-3 px-3 text-center">
                                                <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${m.status === 'OVER' ? 'bg-rose-100 text-rose-700' :
                                                        m.status === 'UNDER' ? 'bg-emerald-100 text-emerald-700' :
                                                            'bg-slate-100 text-slate-600'
                                                    }`}>{m.status}</span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {(byMaterial.length === 0) && <div className="text-center py-12 text-slate-400">No material requirement data available for this period</div>}
                        </div>
                    </CardContent>
                </Card>

                {/* Job-wise Variance */}
                <Card className="hover:shadow-lg transition-shadow">
                    <CardHeader>
                        <CardTitle>Top Job Variances</CardTitle>
                        <CardDescription>Jobs with highest material consumption deviation</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-slate-200">
                                        <th className="text-left py-3 px-4 font-semibold text-slate-600">Job #</th>
                                        <th className="text-left py-3 px-4 font-semibold text-slate-600">Product</th>
                                        <th className="text-right py-3 px-4 font-semibold text-slate-600">Theoretical (kg)</th>
                                        <th className="text-right py-3 px-4 font-semibold text-slate-600">Consumed (kg)</th>
                                        <th className="text-right py-3 px-4 font-semibold text-slate-600">Variance (kg)</th>
                                        <th className="text-right py-3 px-4 font-semibold text-slate-600">Materials</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {jobVariance.map((j: any, i: number) => (
                                        <tr key={i} className="border-b border-slate-100 hover:bg-slate-50/50">
                                            <td className="py-3 px-4 font-mono font-medium">{j.job_number}</td>
                                            <td className="py-3 px-4">{j.product}</td>
                                            <td className="py-3 px-4 text-right">{j.theoretical?.toLocaleString()}</td>
                                            <td className="py-3 px-4 text-right">{j.consumed?.toLocaleString()}</td>
                                            <td className={`py-3 px-4 text-right font-semibold ${j.variance > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                                                {j.variance > 0 ? '+' : ''}{j.variance?.toLocaleString()}
                                            </td>
                                            <td className="py-3 px-4 text-right">{j.materials}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {(jobVariance.length === 0) && <div className="text-center py-12 text-slate-400">No job variance data</div>}
                        </div>
                    </CardContent>
                </Card>
            </div>
        </ReportLayout>
    )
}

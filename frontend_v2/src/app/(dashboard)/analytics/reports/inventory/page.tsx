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
import { Package, IndianRupee, AlertTriangle, MapPin, Clock } from "lucide-react"

export default function InventoryReportPage() {
    const { toast } = useToast()
    const [loading, setLoading] = useState(true)
    const [data, setData] = useState<any>(null)

    const fetchData = useCallback(async () => {
        setLoading(true)
        try {
            const { data: jsonData } = await api.get(`/api/analytics/reports/inventory`)
            setData(jsonData)
        } catch (error) {
            console.error(error)
            toast({ title: "Error", description: "Could not fetch inventory data.", variant: "destructive" })
        } finally {
            setLoading(false)
        }
    }, [toast])

    useEffect(() => { fetchData() }, [fetchData])
    useEffect(() => { const i = setInterval(fetchData, 30000); return () => clearInterval(i) }, [fetchData])

    if (loading && !data) {
        return (
            <ReportLayout title="Inventory Health" description="Stock levels and aging analysis." isLoading={true}>
                <div className="grid grid-cols-1 gap-6">
                    {[...Array(3)].map((_, i) => <div key={i} className="h-40 bg-gradient-to-r from-slate-100 to-slate-50 animate-pulse rounded-xl" />)}
                </div>
            </ReportLayout>
        )
    }

    const s = data?.summary || {}
    const agingData = Array.isArray(data?.aging)
        ? data.aging
        : (Array.isArray(data?.breakdowns?.aging) ? data.breakdowns.aging : [])
    const stageData = Array.isArray(data?.by_stage)
        ? data.by_stage
        : (Array.isArray(data?.breakdowns?.by_stage) ? data.breakdowns.by_stage : [])
    const locationData = Array.isArray(data?.by_location)
        ? data.by_location
        : (Array.isArray(data?.breakdowns?.by_location) ? data.breakdowns.by_location : [])
    const materialRows = Array.isArray(data?.by_material)
        ? data.by_material
        : (Array.isArray(data?.rows) ? data.rows : [])

    return (
        <ReportLayout title="Inventory Health" description="Stock valuation, aging analysis, and inventory distribution." onRefresh={fetchData}>
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
                {/* KPIs */}
                <div className="grid gap-4 md:grid-cols-4">
                    <Card className="hover:shadow-lg transition-all">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium text-slate-600">Total Roll Stock</CardTitle>
                            <Package className="h-4 w-4 text-indigo-500" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{s.total_weight_kg?.toLocaleString()} <span className="text-sm text-slate-400">kg</span></div>
                            <p className="text-xs text-slate-500">{s.total_items?.toLocaleString()} items</p>
                        </CardContent>
                    </Card>
                    <Card className="hover:shadow-lg transition-all">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium text-slate-600">Bulk Materials</CardTitle>
                            <Package className="h-4 w-4 text-violet-500" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{s.bulk_stock_kg?.toLocaleString()} <span className="text-sm text-slate-400">kg</span></div>
                            <p className="text-xs text-slate-500">{s.bulk_items} materials</p>
                        </CardContent>
                    </Card>
                    <Card className="hover:shadow-lg transition-all border-indigo-100 bg-gradient-to-br from-indigo-50/30 to-white">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium text-indigo-600">Estimated Value</CardTitle>
                            <IndianRupee className="h-4 w-4 text-indigo-500" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-indigo-700">₹{s.estimated_value?.toLocaleString()}</div>
                            <p className="text-xs text-slate-500">Based on cost snapshots</p>
                        </CardContent>
                    </Card>
                    <Card className="hover:shadow-lg transition-all border-amber-100 bg-gradient-to-br from-amber-50/30 to-white">
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <CardTitle className="text-sm font-medium text-amber-600">Aged Stock (90+d)</CardTitle>
                            <AlertTriangle className="h-4 w-4 text-amber-500" />
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-amber-700">{s.aged_stock_weight_kg?.toLocaleString()} <span className="text-sm text-amber-400">kg</span></div>
                            <p className="text-xs text-slate-500">{s.aged_stock_items} items</p>
                        </CardContent>
                    </Card>
                </div>

                {/* Charts Row */}
                <div className="grid gap-6 md:grid-cols-2">
                    {/* Aging Donut */}
                    <Card className="hover:shadow-lg transition-shadow">
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Clock className="h-5 w-5 text-amber-500" />
                                Stock Aging Distribution
                            </CardTitle>
                            <CardDescription>Weight by age bucket</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="h-[350px] w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie data={agingData} cx="50%" cy="50%" innerRadius={70} outerRadius={120} paddingAngle={2} dataKey="weight_kg" nameKey="range">
                                            {agingData.map((entry: any, idx: number) => (
                                                <Cell key={idx} fill={entry.fill || '#6366f1'} />
                                            ))}
                                        </Pie>
                                        <RTooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }} formatter={(val: any) => `${val?.toLocaleString()} kg`} />
                                        <Legend wrapperStyle={{ fontSize: 11 }} />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                        </CardContent>
                    </Card>

                    {/* By Stage */}
                    <Card className="hover:shadow-lg transition-shadow">
                        <CardHeader>
                            <CardTitle>Stock by Stage</CardTitle>
                            <CardDescription>RM / WIP / FG distribution</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="h-[350px] w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={stageData}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                        <XAxis dataKey="stage" tick={{ fontSize: 11 }} />
                                        <YAxis tick={{ fontSize: 11 }} />
                                        <RTooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }} />
                                        <Bar dataKey="weight_kg" name="Weight (kg)" fill="#6366f1" radius={[6, 6, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Location + Material Tables */}
                <div className="grid gap-6 md:grid-cols-2">
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <MapPin className="h-5 w-5 text-blue-500" />
                                Stock by Location
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-slate-200">
                                            <th className="text-left py-3 px-4 font-semibold text-slate-600">Location</th>
                                            <th className="text-right py-3 px-4 font-semibold text-slate-600">Weight (kg)</th>
                                            <th className="text-right py-3 px-4 font-semibold text-slate-600">Items</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {locationData.map((l: any, i: number) => (
                                            <tr key={i} className="border-b border-slate-100 hover:bg-slate-50/50">
                                                <td className="py-3 px-4 font-medium">{l.location}</td>
                                                <td className="py-3 px-4 text-right">{l.weight_kg?.toLocaleString()}</td>
                                                <td className="py-3 px-4 text-right">{l.count}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                {(locationData.length === 0) && <div className="text-center py-8 text-slate-400">No location data</div>}
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle>Top Materials by Weight</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b border-slate-200">
                                            <th className="text-left py-3 px-4 font-semibold text-slate-600">Material</th>
                                            <th className="text-right py-3 px-4 font-semibold text-slate-600">Weight (kg)</th>
                                            <th className="text-right py-3 px-4 font-semibold text-slate-600">Count</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {materialRows.map((m: any, i: number) => (
                                            <tr key={i} className="border-b border-slate-100 hover:bg-slate-50/50">
                                                <td className="py-3 px-4 font-medium">{m.name}</td>
                                                <td className="py-3 px-4 text-right">{m.weight?.toLocaleString()}</td>
                                                <td className="py-3 px-4 text-right">{m.count}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                                {(materialRows.length === 0) && <div className="text-center py-8 text-slate-400">No material data</div>}
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </ReportLayout>
    )
}

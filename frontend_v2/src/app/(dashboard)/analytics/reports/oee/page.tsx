"use client"

import { useEffect, useState, useCallback } from "react"
import { ReportLayout } from "@/components/analytics/report-layout"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { useToast } from "@/hooks/use-toast"
import { api } from "@/lib/api"
import {
    BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip,
    ResponsiveContainer, CartesianGrid, Legend, LineChart, Line,
    RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
    ReferenceLine
} from 'recharts'
import { Gauge, Zap, ArrowUpRight, ArrowDownRight, Trophy, AlertTriangle } from "lucide-react"

const COLORS = { availability: '#3b82f6', performance: '#8b5cf6', quality: '#10b981', oee: '#f59e0b' };

function OEEGauge({ label, value, target, color }: { label: string; value: number; target: number; color: string }) {
    const pct = Math.min(value, 100);
    const isGood = value >= target;
    return (
        <div className="flex flex-col items-center p-4 rounded-xl bg-white border border-slate-200 hover:shadow-md transition-all">
            <div className="relative w-24 h-24 mb-3">
                <svg className="w-24 h-24 -rotate-90" viewBox="0 0 36 36">
                    <path d="M18 2.0845a15.9155 15.9155 0 0 1 0 31.831a15.9155 15.9155 0 0 1 0-31.831" fill="none" stroke="#f1f5f9" strokeWidth="3" />
                    <path d="M18 2.0845a15.9155 15.9155 0 0 1 0 31.831a15.9155 15.9155 0 0 1 0-31.831" fill="none" stroke={color} strokeWidth="3"
                        strokeDasharray={`${pct}, 100`} strokeLinecap="round" className="transition-all duration-1000" />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-lg font-bold">{value}%</span>
                </div>
            </div>
            <span className="text-sm font-medium text-slate-600">{label}</span>
            <span className={`text-xs mt-1 ${isGood ? 'text-emerald-500' : 'text-amber-500'}`}>
                Target: {target}%
            </span>
        </div>
    );
}

export default function OEEReportPage() {
    const { toast } = useToast()
    const [loading, setLoading] = useState(true)
    const [data, setData] = useState<any>(null)

    const fetchData = useCallback(async () => {
        setLoading(true)
        try {
            const { data: jsonData } = await api.get(`/api/analytics/reports/oee`)
            setData(jsonData)
        } catch (error) {
            console.error(error)
            toast({ title: "Error", description: "Could not fetch OEE data.", variant: "destructive" })
        } finally {
            setLoading(false)
        }
    }, [toast])

    useEffect(() => { fetchData() }, [fetchData])
    useEffect(() => { const i = setInterval(fetchData, 30000); return () => clearInterval(i) }, [fetchData])

    if (loading && !data) {
        return (
            <ReportLayout title="OEE Deep Dive" description="Overall Equipment Effectiveness analysis." isLoading={true}>
                <div className="grid grid-cols-1 gap-6">
                    {[...Array(4)].map((_, i) => <div key={i} className="h-32 bg-gradient-to-r from-slate-100 to-slate-50 animate-pulse rounded-xl" />)}
                </div>
            </ReportLayout>
        )
    }

    const g = data?.global || data?.summary || {};
    const bm = data?.benchmarks || {};
    const best = data?.best_machine || {};
    const worst = data?.worst_machine || {};
    const machineBreakdown = Array.isArray(data?.breakdown) ? data.breakdown : (Array.isArray(data?.rows) ? data.rows : []);
    const trendData = Array.isArray(data?.trend) ? data.trend : (Array.isArray(data?.series) ? data.series : []);

    const radarData = machineBreakdown.map((m: any) => ({
        machine: m.machine?.length > 12 ? m.machine.slice(0, 12) + '…' : m.machine,
        OEE: m.oee, Availability: m.availability, Performance: m.performance, Quality: m.quality,
    }));

    return (
        <ReportLayout title="OEE Deep Dive" description="Overall Equipment Effectiveness — Availability × Performance × Quality" onRefresh={fetchData}>
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
                {/* Global OEE Gauges */}
                <div className="grid gap-4 md:grid-cols-4">
                    <OEEGauge label="OEE" value={g.oee} target={bm.world_class_oee || 85} color={COLORS.oee} />
                    <OEEGauge label="Availability" value={g.availability} target={bm.target_availability || 90} color={COLORS.availability} />
                    <OEEGauge label="Performance" value={g.performance} target={bm.target_performance || 95} color={COLORS.performance} />
                    <OEEGauge label="Quality" value={g.quality} target={bm.target_quality || 99} color={COLORS.quality} />
                </div>

                {/* Best/Worst highlight */}
                <div className="grid gap-4 md:grid-cols-2">
                    <Card className="border-emerald-200 bg-gradient-to-br from-emerald-50/50 to-white">
                        <CardContent className="flex items-center gap-4 pt-6">
                            <Trophy className="h-8 w-8 text-emerald-500" />
                            <div>
                                <p className="text-sm text-emerald-600 font-medium">Best Machine</p>
                                <p className="text-xl font-bold">{best.name || '-'} — {best.oee}% OEE</p>
                            </div>
                        </CardContent>
                    </Card>
                    <Card className="border-rose-200 bg-gradient-to-br from-rose-50/50 to-white">
                        <CardContent className="flex items-center gap-4 pt-6">
                            <AlertTriangle className="h-8 w-8 text-rose-500" />
                            <div>
                                <p className="text-sm text-rose-600 font-medium">Needs Attention</p>
                                <p className="text-xl font-bold">{worst.name || '-'} — {worst.oee}% OEE</p>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Charts Row */}
                <div className="grid gap-6 md:grid-cols-2">
                    {/* Machine OEE Bars */}
                    <Card className="hover:shadow-lg transition-shadow">
                        <CardHeader>
                            <CardTitle>Machine OEE Breakdown</CardTitle>
                            <CardDescription>A × P × Q per machine</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="h-[400px] w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={machineBreakdown} layout="vertical" margin={{ left: 80 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                        <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} />
                                        <YAxis dataKey="machine" type="category" tick={{ fontSize: 11 }} width={80} />
                                        <RTooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }} />
                                        <Legend />
                                        <Bar dataKey="availability" name="Availability" fill={COLORS.availability} stackId="a" />
                                        <Bar dataKey="performance" name="Performance" fill={COLORS.performance} stackId="b" />
                                        <Bar dataKey="quality" name="Quality" fill={COLORS.quality} stackId="c" />
                                        <ReferenceLine x={85} stroke="#f59e0b" strokeDasharray="5 5" label={{ value: "World Class", position: "top", fill: "#f59e0b", fontSize: 10 }} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Quality Trend */}
                    <Card className="hover:shadow-lg transition-shadow">
                        <CardHeader>
                            <CardTitle>Daily Quality Trend</CardTitle>
                            <CardDescription>Output vs scrap with quality %</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="h-[400px] w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={trendData} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                        <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => v?.slice(5)} />
                                        <YAxis tick={{ fontSize: 11 }} />
                                        <RTooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }} />
                                        <Legend />
                                        <Line type="monotone" dataKey="quality_pct" name="Quality %" stroke={COLORS.quality} strokeWidth={2} dot={false} />
                                        <ReferenceLine y={99} stroke="#ef4444" strokeDasharray="5 5" />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Full table */}
                <Card>
                    <CardHeader>
                        <CardTitle>Detailed Machine Performance</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b border-slate-200">
                                        <th className="text-left py-3 px-4 font-semibold text-slate-600">Machine</th>
                                        <th className="text-right py-3 px-4 font-semibold text-slate-600">OEE %</th>
                                        <th className="text-right py-3 px-4 font-semibold text-slate-600">Avail %</th>
                                        <th className="text-right py-3 px-4 font-semibold text-slate-600">Perf %</th>
                                        <th className="text-right py-3 px-4 font-semibold text-slate-600">Quality %</th>
                                        <th className="text-right py-3 px-4 font-semibold text-slate-600">Output (kg)</th>
                                        <th className="text-right py-3 px-4 font-semibold text-slate-600">Downtime (hrs)</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {machineBreakdown.map((m: any, i: number) => (
                                        <tr key={i} className="border-b border-slate-100 hover:bg-slate-50/50 transition-colors">
                                            <td className="py-3 px-4 font-medium">{m.machine}</td>
                                            <td className="py-3 px-4 text-right">
                                                <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${m.oee >= 85 ? 'bg-emerald-50 text-emerald-700' :
                                                        m.oee >= 65 ? 'bg-amber-50 text-amber-700' :
                                                            'bg-rose-50 text-rose-700'
                                                    }`}>{m.oee}%</span>
                                            </td>
                                            <td className="py-3 px-4 text-right">{m.availability}%</td>
                                            <td className="py-3 px-4 text-right">{m.performance}%</td>
                                            <td className="py-3 px-4 text-right">{m.quality}%</td>
                                            <td className="py-3 px-4 text-right">{m.output_kg?.toLocaleString()}</td>
                                            <td className="py-3 px-4 text-right text-rose-600">{m.downtime_hours}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {(machineBreakdown.length === 0) && <div className="text-center py-12 text-slate-400">No machines found</div>}
                        </div>
                    </CardContent>
                </Card>
            </div>
        </ReportLayout>
    )
}

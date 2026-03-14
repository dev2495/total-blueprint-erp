
import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, Cell, PieChart, Pie } from 'recharts';
import { AlertCircle, CheckCircle2, Factory, Timer, Zap, Trash2 } from 'lucide-react';

interface MachineData {
    machine: {
        id: string;
        name: string;
        code: string;
        status: string;
        operator: string;
    };
    kpis: {
        oee: number;
        availability: number;
        performance: number;
        quality: number;
        total_output_kg: number;
        total_scrap_kg: number;
        downtime_minutes: number;
    };
    charts: {
        trend: { date: string; output: number; scrap: number }[];
        downtime_pareto: { name: string; value: number }[];
    };
}

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8'];

import { analyticsApi } from '@/services/analytics';

// ... other imports ...

export function MachinePerformanceReport({ machineId }: { machineId: string }) {
    const [data, setData] = useState<MachineData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!machineId) return;
        const fetchData = async () => {
            setLoading(true);
            setError(null);
            try {
                const json = await analyticsApi.getMachineReport(machineId);
                if (json.error) {
                    setError(json.error);
                } else {
                    setData(json);
                }
            } catch (err) {
                console.error("Failed to load machine report", err);
                setError("Failed to load machine data.");
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, [machineId]);

    if (loading) return <div className="p-8 text-center animate-pulse text-muted-foreground">Loading Machine Analytics...</div>;
    if (error) return <div className="p-8 text-center text-red-500">{error}</div>;
    if (!data) return null;

    const { machine, kpis, charts } = data;

    // OEE Gauge Data
    const oeeData = [
        { name: 'OEE', value: kpis.oee },
        { name: 'Loss', value: 100 - kpis.oee },
    ];

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            {/* Header */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                <div>
                    <div className="flex items-center gap-3">
                        <Factory className="h-8 w-8 text-blue-600" />
                        <div>
                            <h2 className="text-2xl font-bold text-slate-900">{machine.name}</h2>
                            <p className="text-slate-500 font-medium">{machine.code} • Operator: {machine.operator}</p>
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <Badge variant={machine.status === 'ACTIVE' ? 'default' : 'destructive'} className="text-sm px-3 py-1">
                        {machine.status}
                    </Badge>
                    <div className="text-right">
                        <p className="text-xs text-slate-400 uppercase font-bold tracking-wider">OEE Score</p>
                        <p className={`text-3xl font-black ${kpis.oee >= 85 ? 'text-green-600' : kpis.oee >= 60 ? 'text-yellow-600' : 'text-red-600'}`}>
                            {kpis.oee}%
                        </p>
                    </div>
                </div>
            </div>

            {/* KPI Grid */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card className="border-slate-200 shadow-sm">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-slate-500 flex items-center gap-2">
                            <Timer className="h-4 w-4" /> Availability
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{kpis.availability}%</div>
                        <p className="text-xs text-slate-400 mt-1">Downtime: {kpis.downtime_minutes} min</p>
                    </CardContent>
                </Card>
                <Card className="border-slate-200 shadow-sm">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-slate-500 flex items-center gap-2">
                            <Zap className="h-4 w-4" /> Performance
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{kpis.performance}%</div>
                        <p className="text-xs text-slate-400 mt-1">Output: {kpis.total_output_kg} kg</p>
                    </CardContent>
                </Card>
                <Card className="border-slate-200 shadow-sm">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-slate-500 flex items-center gap-2">
                            <CheckCircle2 className="h-4 w-4" /> Quality
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{kpis.quality}%</div>
                        <p className="text-xs text-slate-400 mt-1">Scrap: {kpis.total_scrap_kg} kg</p>
                    </CardContent>
                </Card>
                <Card className="border-slate-200 shadow-sm bg-slate-50">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-slate-500">Utilization</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="h-[60px] w-full mt-[-10px]">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={oeeData}
                                        cx="50%"
                                        cy="100%"
                                        startAngle={180}
                                        endAngle={0}
                                        innerRadius={30}
                                        outerRadius={50}
                                        paddingAngle={0}
                                        dataKey="value"
                                    >
                                        <Cell fill={kpis.oee >= 85 ? '#22c55e' : '#eab308'} />
                                        <Cell fill="#e2e8f0" />
                                    </Pie>
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Charts Row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Production Trend */}
                <Card className="border-slate-200 shadow-sm">
                    <CardHeader>
                        <CardTitle>Production Trend</CardTitle>
                    </CardHeader>
                    <CardContent className="h-[300px]">
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={charts.trend} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="colorOutput" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8} />
                                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                <XAxis dataKey="date" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                                <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `${value}kg`} />
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                    itemStyle={{ color: '#1e293b' }}
                                />
                                <Area type="monotone" dataKey="output" stroke="#3b82f6" fillOpacity={1} fill="url(#colorOutput)" strokeWidth={2} name="Output (kg)" />
                                <Area type="monotone" dataKey="scrap" stroke="#ef4444" fill="none" strokeWidth={2} name="Scrap (kg)" />
                            </AreaChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>

                {/* Downtime Analysis */}
                <Card className="border-slate-200 shadow-sm">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <AlertCircle className="h-5 w-5 text-red-500" /> Downtime Analysis
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="h-[300px]">
                        {charts.downtime_pareto.length > 0 ? (
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart layout="vertical" data={charts.downtime_pareto} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#e2e8f0" />
                                    <XAxis type="number" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                                    <YAxis dataKey="name" type="category" width={100} stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                                    <Tooltip cursor={{ fill: '#f1f5f9' }} contentStyle={{ borderRadius: '8px' }} />
                                    <Bar dataKey="value" fill="#ef4444" radius={[0, 4, 4, 0]} barSize={20} name="Minutes" />
                                </BarChart>
                            </ResponsiveContainer>
                        ) : (
                            <div className="h-full flex items-center justify-center text-slate-400">
                                No downtime recorded in this period.
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}

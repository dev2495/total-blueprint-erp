"use client"

import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { inventoryService } from "@/services/inventory"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Package, Search, MapPin, Layers, Coins, PieChart as PieChartIcon, BarChart3, Database, ListFilter } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend, BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts"

export default function BulkInventoryPage() {
    const [searchTerm, setSearchTerm] = useState("")

    const { data: bulkStock, isLoading } = useQuery({
        queryKey: ["bulk-stock"],
        queryFn: () => inventoryService.getBulkStock()
    })

    const filteredStock = useMemo(() => {
        if (!bulkStock) return [];
        const q = searchTerm.toLowerCase();
        return bulkStock.filter(item =>
            item.material_name.toLowerCase().includes(q) ||
            item.material_code.toLowerCase().includes(q) ||
            item.location_name.toLowerCase().includes(q)
        )
    }, [bulkStock, searchTerm]);

    const totals = useMemo(() => {
        if (!bulkStock) return { weight: 0, value: 0, items: 0 };
        return bulkStock.reduce((acc, item) => ({
            weight: acc.weight + item.qty_kg,
            value: acc.value + (item.qty_kg * item.avg_cost),
            items: acc.items + 1
        }), { weight: 0, value: 0, items: 0 });
    }, [bulkStock]);

    const locationData = useMemo(() => {
        if (!bulkStock) return [];
        const locMap: Record<string, number> = {};
        bulkStock.forEach(item => {
            locMap[item.location_name] = (locMap[item.location_name] || 0) + item.qty_kg;
        });
        return Object.entries(locMap)
            .map(([name, value]) => ({ name, value }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 5); // top 5 locations
    }, [bulkStock]);

    const COLORS = ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#3b82f6'];

    return (
        <div className="p-6 space-y-6 bg-slate-50/50 min-h-screen">
            <div className="flex flex-col md:flex-row justify-between md:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-black tracking-tight text-slate-900 flex items-center gap-2">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 border border-indigo-100 shadow-sm">
                            <Database className="h-5 w-5 text-indigo-600" strokeWidth={2.5} />
                        </div>
                        Bulk Inventory
                    </h1>
                    <p className="text-slate-500 mt-1.5 font-medium tracking-tight">Unified view of pooled materials across all plants and locations.</p>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="border-0 shadow-[0_1px_6px_rgba(0,0,0,0.02)] bg-white rounded-2xl overflow-hidden group hover:shadow-md transition-shadow">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-[11px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2 group-hover:text-indigo-500 transition-colors">
                            <Package className="w-4 h-4" /> Material Nodes
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-4xl font-black tracking-tighter text-slate-900">{totals.items}</div>
                    </CardContent>
                </Card>
                <Card className="border-0 shadow-[0_1px_6px_rgba(0,0,0,0.02)] bg-white rounded-2xl overflow-hidden group hover:shadow-md transition-shadow">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-[11px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-2 group-hover:text-amber-500 transition-colors">
                            <Layers className="w-4 h-4" /> Global Mass Matrix
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-4xl font-black tracking-tighter text-slate-900 flex items-baseline gap-1.5">
                            {totals.weight.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            <span className="text-sm font-semibold tracking-wide text-slate-400">kg</span>
                        </div>
                    </CardContent>
                </Card>
                <Card className="border-0 shadow-[0_1px_6px_rgba(0,0,0,0.02)] bg-white rounded-2xl overflow-hidden group hover:shadow-md transition-shadow border-b-4 border-b-emerald-400">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-[11px] font-bold uppercase tracking-widest text-emerald-600 flex items-center gap-2">
                            <Coins className="w-4 h-4" /> Capital Valuation
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-4xl font-black tracking-tighter text-slate-900 flex items-baseline gap-1.5">
                            <span className="text-2xl text-slate-400">₹</span>
                            {totals.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                    </CardContent>
                </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <Card className="border-0 shadow-[0_1px_6px_rgba(0,0,0,0.02)] bg-white rounded-2xl lg:col-span-2">
                    <CardHeader className="border-b border-slate-50 pb-4">
                        <CardTitle className="text-[13px] font-bold uppercase tracking-widest text-slate-500 flex items-center gap-2">
                            <BarChart3 className="w-4 h-4 text-indigo-500" strokeWidth={2.5} /> Stock Volume By Location
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="h-[280px] p-6">
                        {isLoading ? (
                            <div className="h-full w-full flex items-center justify-center text-slate-400 font-medium animate-pulse">Computing distribution...</div>
                        ) : locationData.length === 0 ? (
                            <div className="h-full w-full flex items-center justify-center text-slate-400 font-medium">No distinct locations tracked</div>
                        ) : (
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={locationData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} dy={10} />
                                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} tickFormatter={(val) => `${(val / 1000).toFixed(1)}k`} />
                                    <Tooltip
                                        cursor={{ fill: '#f8fafc' }}
                                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', fontWeight: 'bold' }}
                                        formatter={(value: number | string | undefined) => [`${Number(value || 0).toLocaleString()} kg`, 'Mass']}
                                    />
                                    <Bar dataKey="value" fill="#6366f1" radius={[4, 4, 0, 0]} maxBarSize={50}>
                                        {locationData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        )}
                    </CardContent>
                </Card>
                <Card className="border-0 shadow-[0_1px_6px_rgba(0,0,0,0.02)] bg-white rounded-2xl">
                    <CardHeader className="border-b border-slate-50 pb-4">
                        <CardTitle className="text-[13px] font-bold uppercase tracking-widest text-slate-500 flex items-center gap-2">
                            <PieChartIcon className="w-4 h-4 text-emerald-500" strokeWidth={2.5} /> Mass Allocation
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="h-[280px] p-4">
                        {isLoading ? (
                            <div className="h-full w-full flex items-center justify-center text-slate-400 font-medium animate-pulse">Aggregating...</div>
                        ) : locationData.length === 0 ? (
                            <div className="h-full w-full flex items-center justify-center text-slate-400 font-medium">No data</div>
                        ) : (
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={locationData}
                                        cx="50%"
                                        cy="45%"
                                        innerRadius={60}
                                        outerRadius={80}
                                        paddingAngle={5}
                                        dataKey="value"
                                        stroke="none"
                                    >
                                        {locationData.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                        ))}
                                    </Pie>
                                    <Tooltip
                                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', fontWeight: 'bold' }}
                                        formatter={(value: number | string | undefined) => [`${Number(value || 0).toLocaleString()} kg`, 'Mass']}
                                    />
                                    <Legend iconType="circle" wrapperStyle={{ fontSize: '11px', fontWeight: 'bold', color: '#64748b' }} />
                                </PieChart>
                            </ResponsiveContainer>
                        )}
                    </CardContent>
                </Card>
            </div>

            <Card className="border-0 shadow-sm bg-white rounded-2xl overflow-hidden ring-1 ring-slate-100">
                <CardHeader className="bg-slate-50/80 border-b border-slate-100 flex flex-col sm:flex-row items-start sm:items-center justify-between space-y-4 sm:space-y-0 pb-4">
                    <CardTitle className="text-[13px] font-bold uppercase tracking-widest text-slate-500 flex items-center gap-2"><ListFilter className="w-4 h-4 text-indigo-500" strokeWidth={2.5} /> Stock Ledger</CardTitle>
                    <div className="relative w-full sm:w-72">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                        <Input
                            placeholder="Locate material or location..."
                            className="pl-9 bg-white border-slate-200 shadow-sm font-medium focus-visible:ring-indigo-500"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                </CardHeader>
                <CardContent className="p-0 overflow-auto">
                    <table className="w-full text-sm min-w-[900px]">
                        <thead className="bg-slate-50/40 border-b border-slate-100">
                            <tr className="text-left text-[11px] font-bold uppercase tracking-widest text-slate-500">
                                <th className="px-5 py-3">Material Identity</th>
                                <th className="px-5 py-3">Vector / Location</th>
                                <th className="px-5 py-3 text-right">Net Quantity</th>
                                <th className="px-5 py-3 text-right">Moving Avg Cost</th>
                                <th className="px-5 py-3 text-right">Last Polled</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 bg-white">
                            {isLoading ? (
                                Array.from({ length: 5 }).map((_, i) => (
                                    <tr key={i}>
                                        <td className="px-5 py-4"><Skeleton className="h-4 w-40" /></td>
                                        <td className="px-5 py-4"><Skeleton className="h-4 w-24" /></td>
                                        <td className="px-5 py-4"><Skeleton className="h-4 w-16 ml-auto" /></td>
                                        <td className="px-5 py-4"><Skeleton className="h-4 w-16 ml-auto" /></td>
                                        <td className="px-5 py-4"><Skeleton className="h-4 w-24 ml-auto" /></td>
                                    </tr>
                                ))
                            ) : filteredStock?.length === 0 ? (
                                <tr>
                                    <td colSpan={5} className="px-5 py-10 text-center text-slate-500 font-medium">
                                        No materials align with the target query vector.
                                    </td>
                                </tr>
                            ) : (
                                filteredStock?.map((item) => (
                                    <tr key={item.id} className="hover:bg-slate-50/60 transition-colors">
                                        <td className="px-5 py-3">
                                            <div className="flex flex-col">
                                                <span className="font-bold text-[14px] text-slate-900 tracking-tight">{item.material_name}</span>
                                                <span className="text-[11px] font-mono tracking-widest font-bold text-slate-400 mt-0.5">{item.material_code}</span>
                                            </div>
                                        </td>
                                        <td className="px-5 py-3">
                                            <div className="flex items-center gap-1.5 text-slate-700 font-medium">
                                                <MapPin className="w-3.5 h-3.5 text-slate-400" />
                                                <span>{item.location_name}</span>
                                                <Badge variant="outline" className="ml-1.5 text-[10px] py-0 h-4 bg-slate-50 border-slate-200">
                                                    {item.plant_name}
                                                </Badge>
                                            </div>
                                        </td>
                                        <td className="px-5 py-3 text-right font-mono tracking-tighter text-[15px] font-black text-slate-900">
                                            {item.qty_kg.toLocaleString(undefined, { minimumFractionDigits: 2 })} <span className="text-[10px] text-slate-400 font-sans tracking-widest uppercase">kg</span>
                                        </td>
                                        <td className="px-5 py-3 text-right font-mono font-bold text-emerald-600">
                                            <span className="text-emerald-400 mr-1 text-[11px]">₹</span>{item.avg_cost.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                                        </td>
                                        <td className="px-5 py-3 text-right text-[11px] tracking-wide font-medium text-slate-400">
                                            {new Date(item.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </CardContent>
            </Card>
        </div>
    )
}

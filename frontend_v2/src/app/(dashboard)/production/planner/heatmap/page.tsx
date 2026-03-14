"use client"

import { useQuery } from "@tanstack/react-query"
import { plannerService } from "@/services/planner"
import {
    Card, CardHeader, CardTitle, CardContent, CardDescription
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
    Loader2, ArrowLeft, Activity, Zap, Info, Thermometer,
    Wind, Droplets, HardDrive, Cpu, AlertTriangle, ExternalLink
} from "lucide-react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import {
    Tooltip, TooltipContent, TooltipProvider, TooltipTrigger
} from "@/components/ui/tooltip"

export default function FactoryHeatmap() {
    const { data: capacity, isLoading } = useQuery({
        queryKey: ["planner-capacity"],
        queryFn: plannerService.getCapacity
    })

    if (isLoading) {
        return (
            <div className="flex h-[80vh] items-center justify-center bg-[#f8fafc]">
                <div className="text-center space-y-4">
                    <Loader2 className="h-12 w-12 animate-spin text-indigo-600 mx-auto" />
                    <p className="text-sm font-black uppercase tracking-[0.2em] text-slate-400">Loading Plant Floor Matrix...</p>
                </div>
            </div>
        )
    }

    return (
        <div className="p-6 lg:p-10 space-y-10 bg-[#f8fafc] min-h-screen font-sans selection:bg-indigo-100 selection:text-indigo-900">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="space-y-1">
                    <Link href="/production/planner" className="inline-flex items-center gap-2 text-indigo-600 font-bold text-xs uppercase tracking-widest hover:gap-3 transition-all">
                        <ArrowLeft className="h-4 w-4" /> Back to Control Tower
                    </Link>
                    <h1 className="text-4xl font-black tracking-tight text-slate-900 flex items-center gap-3 mt-2">
                        Factory Heatmap
                        <span className="text-slate-300 font-light">/</span>
                        <span className="text-indigo-600 font-black">Matrix-01</span>
                    </h1>
                    <p className="text-slate-500 font-medium text-sm flex items-center gap-2 uppercase tracking-wide">
                        <Activity className="h-3.5 w-3.5 text-indigo-500 animate-pulse" /> Real-time spatial telemetry synchronized
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <Button variant="outline" className="h-12 px-6 rounded-xl border-2 font-black text-xs uppercase tracking-widest border-slate-200 hover:bg-white active:scale-95 transition-all">
                        Plant Config
                    </Button>
                    <Button className="h-12 px-8 rounded-xl bg-slate-900 hover:bg-indigo-600 text-white font-black uppercase text-xs tracking-widest shadow-xl transition-all active:scale-95">
                        Export Telemetry
                    </Button>
                </div>
            </div>

            {/* Environmental Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                {[
                    { label: "Ambient Temp", value: "24.5°C", icon: Thermometer, color: "text-amber-500", trend: "+0.2°" },
                    { label: "Humidity", value: "48%", icon: Droplets, color: "text-blue-500", trend: "Stable" },
                    { label: "Air Flow", value: "12 m/s", icon: Wind, color: "text-indigo-500", trend: "High Efficiency" },
                    { label: "Vibration Index", value: "0.04g", icon: Activity, color: "text-emerald-500", trend: "Nominal" }
                ].map((stat, i) => (
                    <div key={i} className="bg-white/80 backdrop-blur-sm border border-slate-200 rounded-3xl p-6 flex items-center justify-between group hover:border-indigo-200 transition-all cursor-default">
                        <div className="space-y-1">
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">{stat.label}</p>
                            <h3 className="text-2xl font-black text-slate-900">{stat.value}</h3>
                            <p className="text-[10px] font-bold text-slate-400 italic">{stat.trend}</p>
                        </div>
                        <div className={cn("p-3 rounded-2xl bg-slate-50 group-hover:bg-white group-hover:shadow-lg transition-all", stat.color)}>
                            <stat.icon className="h-6 w-6" />
                        </div>
                    </div>
                ))}
            </div>

            {/* Heatmap Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
                {/* Main Visualizer */}
                <div className="lg:col-span-8 space-y-8">
                    <Card className="border-none shadow-premium rounded-[2.5rem] overflow-hidden bg-white ring-1 ring-slate-100">
                        <CardHeader className="p-8 border-b border-slate-50">
                            <div className="flex items-center justify-between">
                                <div className="space-y-1">
                                    <div className="inline-flex items-center gap-2 px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-600 text-[9px] font-black uppercase tracking-widest">Floor Alpha-04</div>
                                    <CardTitle className="text-2xl font-black text-slate-900 italic">Work Center Matrix</CardTitle>
                                    <CardDescription className="text-xs font-bold uppercase tracking-tight text-slate-400">Spatial distribution of machine load and health</CardDescription>
                                </div>
                                <div className="flex items-center gap-4 text-[9px] font-black uppercase tracking-widest text-slate-400">
                                    <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-slate-100" /> IDLE</div>
                                    <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-indigo-500" /> ACTIVE</div>
                                    <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse" /> CRITICAL</div>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent className="p-10">
                            <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6">
                                {capacity?.map((wc) => (
                                    <TooltipProvider key={wc.wc_id}>
                                        <Tooltip delayDuration={0}>
                                            <TooltipTrigger className="w-full">
                                                <div className={cn(
                                                    "aspect-square rounded-[2rem] p-6 flex flex-col justify-between transition-all duration-500 group relative border-4",
                                                    wc.utilization > 85 ? "bg-rose-500 border-rose-200 shadow-[0_20px_40px_-10px_rgba(244,63,94,0.3)]" :
                                                        wc.utilization > 60 ? "bg-indigo-600 border-indigo-200 shadow-[0_20px_40px_-10px_rgba(79,70,229,0.3)]" :
                                                            "bg-white border-slate-50 shadow-sm ring-1 ring-slate-100"
                                                )}>
                                                    <div className="flex items-start justify-between">
                                                        <div className={cn(
                                                            "w-10 h-10 rounded-2xl flex items-center justify-center",
                                                            wc.utilization > 60 ? "bg-white/20 text-white" : "bg-indigo-50 text-indigo-600"
                                                        )}>
                                                            <Cpu className="h-5 w-5" />
                                                        </div>
                                                        <div className={cn(
                                                            "text-[10px] font-black italic",
                                                            wc.utilization > 60 ? "text-white/80" : "text-slate-400"
                                                        )}>
                                                            WC-{wc.wc_id}
                                                        </div>
                                                    </div>
                                                    <div className="space-y-1 text-left">
                                                        <div className={cn(
                                                            "text-xs font-black uppercase tracking-tighter truncate leading-tight",
                                                            wc.utilization > 60 ? "text-white" : "text-slate-900"
                                                        )}>
                                                            {wc.wc_name}
                                                        </div>
                                                        <div className={cn(
                                                            "text-2xl font-black tracking-tighter",
                                                            wc.utilization > 60 ? "text-white" : "text-indigo-600"
                                                        )}>
                                                            {wc.utilization}%
                                                        </div>
                                                    </div>

                                                    {/* Pulse Overlay */}
                                                    {wc.utilization > 85 && (
                                                        <div className="absolute inset-0 rounded-[2rem] bg-rose-500 animate-ping opacity-20 pointer-events-none" />
                                                    )}
                                                </div>
                                            </TooltipTrigger>
                                            <TooltipContent className="bg-slate-900 text-white border-white/10 p-4 rounded-2xl shadow-2xl backdrop-blur-xl">
                                                <div className="space-y-2">
                                                    <p className="text-[10px] font-black uppercase tracking-widest text-indigo-400 border-b border-white/10 pb-1.5">{wc.wc_name}</p>
                                                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] font-bold uppercase tracking-tight">
                                                        <span className="text-slate-400">Role:</span> <span className="text-right">Extrusion Zone</span>
                                                        <span className="text-slate-400">Total Units:</span> <span className="text-right">{wc.machine_count} Nodes</span>
                                                        <span className="text-slate-400">Active Load:</span> <span className="text-right">{wc.running_jobs} Jobs</span>
                                                    </div>
                                                </div>
                                            </TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>
                                ))}

                                {/* Placeholder Grids for "Plant" Look */}
                                {Array.from({ length: 4 }).map((_, i) => (
                                    <div key={`p-${i}`} className="aspect-square rounded-[2rem] border-2 border-dashed border-slate-100 flex items-center justify-center p-6 grayscale opacity-30">
                                        <div className="text-center space-y-2">
                                            <HardDrive className="h-6 w-6 text-slate-300 mx-auto" strokeWidth={1} />
                                            <p className="text-[8px] font-black uppercase tracking-[0.2em] text-slate-400">Aux Zone {i + 1}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                </div>

                {/* Secondary Info Panel */}
                <div className="lg:col-span-4 space-y-8">
                    {/* Bottle Neck Alert */}
                    <Card className="border-none shadow-premium bg-slate-900 text-white rounded-[2.5rem] overflow-hidden p-8">
                        <div className="space-y-6">
                            <div className="flex items-center gap-3">
                                <div className="p-2.5 rounded-xl bg-indigo-500 text-white">
                                    <Zap className="h-5 w-5" />
                                </div>
                                <div>
                                    <h3 className="text-lg font-black italic uppercase italic tracking-tight">System Alerts</h3>
                                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Active Orchestration Intel</p>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div className="bg-white/5 rounded-2xl p-5 border border-white/5 hover:bg-white/10 transition-colors">
                                    <div className="flex items-center gap-3 mb-2 text-rose-500">
                                        <AlertTriangle className="h-4 w-4" />
                                        <span className="text-[11px] font-black uppercase tracking-widest italic leading-none">Critical Contention</span>
                                    </div>
                                    <p className="text-xs text-slate-300 font-medium leading-relaxed">
                                        <strong>Extrusion Dept</strong> is over-subscribed (92% load). Delaying new releases until <span className="text-indigo-400">Shift Change 02</span> is recommended.
                                    </p>
                                </div>

                                <div className="bg-white/5 rounded-2xl p-5 border border-white/5 hover:bg-white/10 transition-colors">
                                    <div className="flex items-center gap-3 mb-2 text-indigo-400">
                                        <Info className="h-4 w-4" />
                                        <span className="text-[11px] font-black uppercase tracking-widest italic leading-none">Optimal Slot</span>
                                    </div>
                                    <p className="text-xs text-slate-300 font-medium leading-relaxed">
                                        <strong>Printing Station 1</strong> has immediate availability (45% load). Fast-track release of stock orders to balance line load.
                                    </p>
                                </div>
                            </div>

                            <Button className="w-full h-14 rounded-[1.25rem] bg-indigo-600 hover:bg-indigo-500 text-white font-black uppercase text-xs tracking-[0.15em] transition-all shadow-xl shadow-indigo-950/50 active:scale-95">
                                Recalibrate Production Flow
                            </Button>
                        </div>
                    </Card>

                    {/* Quick Stats */}
                    <Card className="border-none shadow-premium rounded-[2.5rem] bg-white p-8">
                        <h4 className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-6">Plant Health Matrix</h4>
                        <div className="space-y-8">
                            {[
                                { label: "Average OEE", value: "88%", progress: 88, color: "bg-emerald-500" },
                                { label: "Material Throughput", value: "125t/hr", progress: 65, color: "bg-indigo-500" },
                                { label: "Quality Conformity", value: "99.8%", progress: 99, color: "bg-blue-500" }
                            ].map((s, i) => (
                                <div key={i} className="space-y-3">
                                    <div className="flex justify-between items-end">
                                        <span className="text-xs font-black text-slate-800 uppercase italic underline decoration-slate-100 underline-offset-4">{s.label}</span>
                                        <span className="text-lg font-black text-slate-900 tracking-tighter">{s.value}</span>
                                    </div>
                                    <div className="h-2 w-full bg-slate-50 rounded-full overflow-hidden shadow-inner">
                                        <div className={cn("h-full rounded-full transition-all duration-1000", s.color)} style={{ width: `${s.progress}%` }} />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </Card>
                </div>
            </div>

            <style jsx global>{`
                .shadow-premium {
                    shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.02), 0 4px 6px -2px rgba(0, 0, 0, 0.01);
                    transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                }
                .shadow-premium:hover {
                    shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.05), 0 10px 10px -5px rgba(0, 0, 0, 0.02);
                }
            `}</style>
        </div>
    )
}

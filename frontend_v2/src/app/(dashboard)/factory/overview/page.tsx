"use client"

import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { PageHeader } from "@/components/ui-custom/page-header"
import {
    Factory,
    Cpu,
    Activity,
    Box,
    CheckCircle2,
    AlertTriangle,
    RefreshCw,
    Circle
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"

// --- Visual Components ---

function VisualTreeNode({ node }: { node: any }) {
    const getStatusStyle = (status: string) => {
        switch (status) {
            case "ACTIVE":
            case "RUNNING": return { dot: "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]", border: "border-emerald-200 hover:border-emerald-400", bg: "bg-emerald-50/50", text: "text-emerald-900" }
            case "DOWN": return { dot: "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.5)]", border: "border-rose-200 hover:border-rose-400", bg: "bg-rose-50/50", text: "text-rose-900" }
            case "MAINTENANCE": return { dot: "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]", border: "border-amber-200 hover:border-amber-400", bg: "bg-amber-50/50", text: "text-amber-900" }
            default: return { dot: "bg-slate-300", border: "border-slate-200 hover:border-slate-300", bg: "bg-white", text: "text-slate-700" }
        }
    }
    const style = getStatusStyle(node.status);

    return (
        <div className={cn("relative p-4 rounded-xl border flex flex-col justify-between shadow-sm min-h-[90px] transition-all", style.bg, style.border)}>
            <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-center gap-2.5 min-w-0 pr-8">
                    <div className={cn("h-2.5 w-2.5 rounded-full shrink-0", style.dot)}></div>
                    <span className={cn("font-black text-[13px] leading-tight line-clamp-2", style.text)} title={node.label}>{node.label}</span>
                </div>
            </div>
            <div>
                {node.active_job ? (
                    <div className="flex items-center justify-between border-t border-black/5 pt-2 mt-1">
                        <span className="text-[9px] font-black uppercase tracking-widest opacity-50">Active Job</span>
                        <span className="text-[10px] font-black text-blue-600 truncate max-w-[120px]">{node.active_job}</span>
                    </div>
                ) : (
                    <div className="flex items-center justify-between border-t border-black/5 pt-2 mt-1 opacity-50">
                        <span className="text-[9px] font-black uppercase tracking-widest">Status</span>
                        <span className="text-[10px] font-black uppercase tracking-widest">{node.status || "IDLE"}</span>
                    </div>
                )}
                {node.type && (
                    <div className="absolute top-3 right-3">
                        <Badge variant="outline" className="bg-white/60 border-black/10 text-[8px] px-1.5 py-0 uppercase font-black tracking-widest border-none text-slate-500">
                            {node.type}
                        </Badge>
                    </div>
                )}
            </div>
        </div>
    )
}

function PlantTreeView({ node }: { node: any }) {
    const workCenters = node.children?.filter((c: any) => c.type === 'WC' || c.type === 'DEPT') || []
    const locations = node.children?.filter((c: any) => c.type === 'LOCATION') || []

    return (
        <div className="bg-white rounded-[2rem] border-0 ring-1 ring-slate-100 shadow-[0_8px_30px_rgb(0,0,0,0.04)] p-8 overflow-x-auto mb-10">
            <div className="min-w-[900px] flex items-stretch gap-12">

                {/* 1. PLANT ROOT */}
                <div className="w-56 shrink-0 flex flex-col justify-center relative z-10">
                    <div className="bg-slate-900 text-white p-6 rounded-2xl shadow-xl border border-slate-700">
                        <div className="p-3 bg-blue-500/20 rounded-xl w-fit mb-4">
                            <Factory className="h-6 w-6 text-blue-400" />
                        </div>
                        <h2 className="text-3xl font-black tracking-tighter mb-1 leading-none break-words">{node.label}</h2>
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Plant Facility</span>
                    </div>
                </div>

                {/* 2. WORK CENTERS & LOCATIONS */}
                <div className="flex-1 flex flex-col gap-6 py-4 relative">
                    {/* Vertical Spine connecting Plant to WC's */}
                    <div className="absolute left-[-3rem] top-12 bottom-12 w-[3px] bg-slate-200 rounded-full"></div>
                    {/* Connector from Plant to Spine */}
                    <div className="absolute left-[-4.5rem] top-1/2 w-[1.5rem] h-[3px] bg-slate-200"></div>

                    {workCenters.map((wc: any) => {
                        const machines = wc.children?.filter((c: any) => c.type === 'MACHINE' || c.type === 'LOCATION' || c.type === 'PROCESS') || []
                        return (
                            <div key={wc.id} className="relative flex items-stretch gap-6">
                                {/* Connector from spine to WC */}
                                <div className="absolute left-[-3rem] top-12 w-[3rem] h-[3px] bg-slate-200"></div>

                                {/* Work Center Node */}
                                <div className="w-64 shrink-0 bg-white border-2 border-slate-100 rounded-2xl p-5 z-10 shadow-sm relative hover:border-blue-300 transition-colors">
                                    <div className="flex items-center justify-between mb-4">
                                        <div className="p-2 bg-blue-50 text-blue-600 rounded-lg w-fit">
                                            <Box className="h-4 w-4" strokeWidth={2.5} />
                                        </div>
                                        <Badge variant="secondary" className="bg-slate-100 text-[9px] uppercase tracking-widest text-slate-500 font-black">{machines.length} Nodes</Badge>
                                    </div>
                                    <h3 className="text-base font-black text-slate-900 leading-tight mb-1">{wc.label}</h3>

                                    {/* Connector to grid */}
                                    <div className="hidden xl:block absolute right-[-1.5rem] top-12 w-[1.5rem] h-[3px] bg-slate-100"></div>
                                </div>

                                {/* Machines Grid */}
                                <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3 w-full content-start bg-slate-50 border border-slate-100 p-4 rounded-2xl relative">
                                    {machines.map((m: any) => (
                                        <VisualTreeNode key={m.id} node={m} />
                                    ))}
                                    {machines.length === 0 && (
                                        <div className="col-span-full flex items-center justify-center p-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest border border-dashed border-slate-200 rounded-xl">
                                            No Nodes Assigned
                                        </div>
                                    )}
                                </div>
                            </div>
                        )
                    })}

                    {/* Locations Section (If any) */}
                    {locations.length > 0 && (
                        <div className="relative flex items-stretch gap-6 mt-4">
                            <div className="absolute left-[-3rem] top-12 w-[3rem] h-[3px] bg-slate-200"></div>

                            <div className="w-64 shrink-0 bg-amber-50 border-2 border-amber-200 rounded-2xl p-5 z-10 shadow-sm relative hover:border-amber-300 transition-colors">
                                <div className="flex items-center justify-between mb-4">
                                    <div className="p-2 bg-amber-100 text-amber-600 rounded-lg w-fit">
                                        <Box className="h-4 w-4" strokeWidth={2.5} />
                                    </div>
                                    <Badge className="bg-amber-200/50 hover:bg-amber-200/50 text-[9px] uppercase tracking-widest text-amber-700 font-black">{locations.length} Nodes</Badge>
                                </div>
                                <h3 className="text-base font-black text-amber-900 leading-tight mb-1">General Storage</h3>
                                <div className="hidden xl:block absolute right-[-1.5rem] top-12 w-[1.5rem] h-[3px] bg-amber-100"></div>
                            </div>

                            <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3 w-full content-start bg-amber-50/30 border border-amber-100 p-4 rounded-2xl relative">
                                {locations.map((loc: any) => (
                                    <VisualTreeNode key={loc.id} node={loc} />
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

export default function FactoryOverviewPage() {
    const { data: tree, isLoading } = useQuery({
        queryKey: ["factory-tree"],
        queryFn: async () => {
            const res = await api.get("/api/analytics/factory-tree")
            return res.data
        }
    })

    return (
        <div className="space-y-8 pb-12">
            <PageHeader
                title="Visual Factory"
                description="Live hierarchical architecture of entire localized grid operations."
                actions={
                    <div className="flex items-center gap-4 bg-white px-5 py-2.5 rounded-full border-0 ring-1 ring-slate-100 shadow-[0_2px_10px_rgba(0,0,0,0.02)] backdrop-blur-md">
                        <div className="flex items-center gap-1.5 px-1 py-0.5 rounded-md hover:bg-emerald-50 transition-colors">
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" strokeWidth={3} />
                            <span className="text-[10px] font-black tracking-widest uppercase text-emerald-700">Active</span>
                        </div>
                        <div className="w-px h-3 bg-slate-200" />
                        <div className="flex items-center gap-1.5 px-1 py-0.5 rounded-md hover:bg-slate-50 transition-colors">
                            <Circle className="h-3.5 w-3.5 text-slate-300" strokeWidth={3} />
                            <span className="text-[10px] font-black tracking-widest uppercase text-slate-500">Idle</span>
                        </div>
                        <div className="w-px h-3 bg-slate-200" />
                        <div className="flex items-center gap-1.5 px-1 py-0.5 rounded-md hover:bg-rose-50 transition-colors">
                            <AlertTriangle className="h-3.5 w-3.5 text-rose-500" strokeWidth={3} />
                            <span className="text-[10px] font-black tracking-widest uppercase text-rose-700">Down</span>
                        </div>
                    </div>
                }
            />

            {isLoading ? (
                <div className="flex flex-col items-center justify-center h-[50vh] text-slate-400 space-y-6">
                    <div className="relative">
                        <div className="absolute inset-0 bg-blue-500/20 blur-xl rounded-full animate-pulse" />
                        <div className="h-16 w-16 bg-white rounded-2xl ring-1 ring-slate-100 shadow-[0_8px_30px_rgb(0,0,0,0.04)] flex items-center justify-center relative z-10">
                            <RefreshCw className="h-6 w-6 animate-spin text-blue-500" strokeWidth={2.5} />
                        </div>
                    </div>
                    <div className="space-y-1 text-center">
                        <p className="text-sm font-black text-slate-900 tracking-tight">Constructing Digital Twin...</p>
                        <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Compiling factory telemetry data</p>
                    </div>
                </div>
            ) : (
                <div className="space-y-16 mt-8">
                    {tree?.map((plant: any) => (
                        <PlantTreeView key={plant.id} node={plant} />
                    ))}
                    {!tree || tree.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-32 text-slate-400">
                            <div className="h-20 w-20 bg-slate-50/50 rounded-full flex items-center justify-center border border-slate-100 shadow-sm mb-4">
                                <AlertTriangle className="h-8 w-8 text-slate-300" strokeWidth={2} />
                            </div>
                            <span className="text-[12px] font-bold uppercase tracking-widest">No topological data found</span>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

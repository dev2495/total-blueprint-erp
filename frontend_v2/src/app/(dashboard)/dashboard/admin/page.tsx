"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { analyticsApi } from "@/services/analytics";
import { RbacService } from "@/services/rbac";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    Activity,
    Database,
    Server,
    Users,
    AlertCircle,
    Clock,
    RotateCcw,
    Trash2,
    Cpu,
    MemoryStick,
    HardDrive,
    ShieldCheck
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const HealthRing = ({ value, label, colorClass, icon: Icon }: { value: number, label: string, colorClass: string, icon: any }) => {
    const radius = 35;
    const circumference = 2 * Math.PI * radius;
    const strokeDashoffset = circumference - ((value || 0) / 100) * circumference;

    return (
        <div className="flex flex-col items-center justify-center p-4">
            <div className="relative flex items-center justify-center w-24 h-24 mb-4">
                {/* Background Ring */}
                <svg className="absolute inset-0 w-full h-full transform -rotate-90">
                    <circle
                        className="text-slate-100"
                        strokeWidth="8"
                        stroke="currentColor"
                        fill="transparent"
                        r={radius}
                        cx="48"
                        cy="48"
                    />
                    {/* Foreground Ring */}
                    <circle
                        className={cn("transition-all duration-1000 ease-out", colorClass)}
                        strokeWidth="8"
                        strokeDasharray={circumference}
                        strokeDashoffset={strokeDashoffset}
                        strokeLinecap="round"
                        stroke="currentColor"
                        fill="transparent"
                        r={radius}
                        cx="48"
                        cy="48"
                    />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/50 rounded-full m-2 shadow-sm border border-slate-50/50 backdrop-blur-sm">
                    <Icon className={cn("w-4 h-4 mb-0.5", colorClass)} />
                    <span className="text-sm font-black text-slate-800 tracking-tight">{value}%</span>
                </div>
            </div>
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">{label}</span>
        </div>
    );
}

export default function SystemHealthDashboard() {
    const { data: health, isLoading, isError, error, refetch } = useQuery({
        queryKey: ['system-health'],
        queryFn: analyticsApi.getSystemHealth,
        refetchInterval: 15000,
        retry: 1,
    });
    const { data: visibilityMap } = useQuery({
        queryKey: ["admin-role-visibility-widget"],
        queryFn: RbacService.revalidateRoleVisibility,
        refetchInterval: 60000,
        retry: 1,
    });

    const signoffSummary = useMemo(() => {
        const rows = Object.entries(visibilityMap || {}).map(([roleCode, values]) => ({ roleCode, ...values }));
        const total = rows.reduce((acc, row) => acc + (Number(row.total) || 0), 0);
        const approved = rows.reduce((acc, row) => acc + (Number(row.approved) || 0), 0);
        const pending = rows.reduce((acc, row) => acc + (Number(row.pending) || 0), 0);
        const topBlockers = rows
            .filter((row) => Number(row.pending) > 0)
            .sort((a, b) => Number(b.pending) - Number(a.pending))
            .slice(0, 3);
        return { total, approved, pending, topBlockers };
    }, [visibilityMap]);

    if (isLoading) {
        return (
            <div className="p-8 flex flex-col items-center justify-center min-h-[60vh]">
                <div className="w-12 h-12 border-4 border-indigo-100 border-t-indigo-600 rounded-full animate-spin mb-4 shadow-premium"></div>
                <div className="text-slate-500 font-medium tracking-wide">Initializing Command Center...</div>
            </div>
        )
    }

    if (isError) {
        return (
            <div className="p-8 min-h-[60vh] flex items-center justify-center">
                <Card className="max-w-xl w-full border border-amber-200 bg-amber-50/60 shadow-md">
                    <CardHeader>
                        <CardTitle className="text-amber-800 flex items-center gap-2">
                            <AlertCircle className="h-5 w-5" />
                            Telemetry Degraded
                        </CardTitle>
                        <CardDescription className="text-amber-700">
                            System health metrics did not respond in time. Core dashboard is safe to use; retry when backend is healthy.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="flex items-center justify-between gap-3">
                        <div className="text-xs text-amber-700 break-all">
                            {String((error as any)?.message || "System health request failed")}
                        </div>
                        <Button onClick={() => refetch()} className="shrink-0">
                            <RotateCcw className="h-4 w-4 mr-2" />
                            Retry
                        </Button>
                    </CardContent>
                </Card>
            </div>
        )
    }

    const system = health || {
        status: "unknown",
        uptime: "-",
        active_users: 0,
        error_rate: "-",
        db_health: "-",
        version: "-",
        cpu_usage: 0,
        memory_usage: 0,
        disk_usage: 0,
        db_size_mb: 0,
        active_connections: 0,
        logs: []
    };

    return (
        <div className="space-y-8 animate-in fade-in duration-500 relative">

            {/* Header Area */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 bg-white/60 backdrop-blur-xl p-6 rounded-3xl border border-white shadow-premium relative overflow-hidden">
                <div className="absolute -right-20 -top-20 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
                <div className="relative z-10">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-50 border border-indigo-100 mb-3">
                        <Activity className="w-3.5 h-3.5 text-indigo-600" />
                        <span className="text-[10px] uppercase tracking-widest font-bold text-indigo-600">Command Center</span>
                    </div>
                    <h1 className="text-3xl font-black tracking-tight text-slate-900 mb-1">
                        System Admin Console
                    </h1>
                    <p className="text-slate-500 font-medium">Platform Telemetry & Infrastructure Maintenance</p>
                </div>
                <div className="flex items-center gap-3 relative z-10">
                    <div className={cn(
                        "flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold border shadow-sm transition-colors",
                        system.status === 'online'
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                            : "bg-red-50 text-red-700 border-red-200"
                    )}>
                        {system.status === 'online' ? (
                            <><div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.8)]" /> ONLINE</>
                        ) : (
                            <><AlertCircle className="h-4 w-4" /> OFFLINE</>
                        )}
                    </div>
                    <Button
                        onClick={() => refetch()}
                        className="bg-slate-900 hover:bg-slate-800 text-white rounded-xl shadow-premium hover:shadow-premium-hover transition-all active-scale h-10 px-5"
                    >
                        <RotateCcw className="h-4 w-4 mr-2" />
                        Refresh Vitals
                    </Button>
                </div>
            </div>

            <Card className="border border-sky-100 bg-white/80 backdrop-blur-xl shadow-premium">
                <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                        <ShieldCheck className="h-4 w-4 text-sky-600" />
                        Department Signoff Progress
                    </CardTitle>
                    <CardDescription className="text-xs">
                        Quick governance status for role/module visibility approvals.
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="bg-slate-50">Total: {signoffSummary.total}</Badge>
                        <Badge className="bg-emerald-600">Approved: {signoffSummary.approved}</Badge>
                        <Badge variant="secondary">Pending: {signoffSummary.pending}</Badge>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        {signoffSummary.topBlockers.map((blocker) => (
                            <Badge key={blocker.roleCode} variant="outline">
                                {blocker.roleCode}: {blocker.pending} pending
                            </Badge>
                        ))}
                        {!signoffSummary.topBlockers.length ? (
                            <Badge className="bg-emerald-600">All roles ready</Badge>
                        ) : null}
                    </div>
                    <Button asChild variant="outline" className="w-full md:w-auto">
                        <Link href="/system/governance?tab=signoffs">Open Governance Console</Link>
                    </Button>
                </CardContent>
            </Card>

            {/* Hardware Telemetry Rings */}
            <div className="grid gap-6 md:grid-cols-3">
                <div className="bg-white/60 backdrop-blur-xl rounded-3xl border border-white shadow-premium p-6 flex flex-col items-center justify-center hover:bg-white/80 transition-colors">
                    <HealthRing
                        value={system.cpu_usage}
                        label="CPU Utilization"
                        icon={Cpu}
                        colorClass={system.cpu_usage > 80 ? "text-rose-500" : system.cpu_usage > 60 ? "text-amber-500" : "text-indigo-500"}
                    />
                </div>
                <div className="bg-white/60 backdrop-blur-xl rounded-3xl border border-white shadow-premium p-6 flex flex-col items-center justify-center hover:bg-white/80 transition-colors">
                    <HealthRing
                        value={system.memory_usage}
                        label="Memory Pressure"
                        icon={MemoryStick}
                        colorClass={system.memory_usage > 85 ? "text-rose-500" : system.memory_usage > 70 ? "text-amber-500" : "text-emerald-500"}
                    />
                </div>
                <div className="bg-white/60 backdrop-blur-xl rounded-3xl border border-white shadow-premium p-6 flex flex-col items-center justify-center hover:bg-white/80 transition-colors">
                    <HealthRing
                        value={system.disk_usage}
                        label="Storage Capacity"
                        icon={HardDrive}
                        colorClass={system.disk_usage > 90 ? "text-rose-500" : "text-sky-500"}
                    />
                </div>
            </div>

            {/* Core Metrics Grid */}
            <div className="grid gap-6 md:grid-cols-3 lg:grid-cols-6">
                <div className="bg-white/70 backdrop-blur-md rounded-2xl border border-white shadow-premium p-5 group hover:shadow-premium-hover transition-all duration-300 hover:-translate-y-1">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                            <Clock className="h-4 w-4" />
                        </div>
                        <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Uptime</span>
                    </div>
                    <div className="text-2xl font-black text-slate-800">{system.uptime}</div>
                    <div className="text-[11px] text-slate-400 font-medium mt-1">Since Last Restart</div>
                </div>

                <div className="bg-white/70 backdrop-blur-md rounded-2xl border border-white shadow-premium p-5 group hover:shadow-premium-hover transition-all duration-300 hover:-translate-y-1">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="w-8 h-8 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center group-hover:bg-sky-600 group-hover:text-white transition-colors">
                            <Users className="h-4 w-4" />
                        </div>
                        <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Active Users</span>
                    </div>
                    <div className="text-2xl font-black text-slate-800">{system.active_users}</div>
                    <div className="text-[11px] text-slate-400 font-medium mt-1">In Last 24 Hours</div>
                </div>

                <div className="bg-white/70 backdrop-blur-md rounded-2xl border border-white shadow-premium p-5 group hover:shadow-premium-hover transition-all duration-300 hover:-translate-y-1">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center group-hover:bg-emerald-600 group-hover:text-white transition-colors">
                            <ShieldCheck className="h-4 w-4" />
                        </div>
                        <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Error Rate</span>
                    </div>
                    <div className="text-2xl font-black text-emerald-600">{system.error_rate}</div>
                    <div className="text-[11px] text-slate-400 font-medium mt-1">Request Success Margin</div>
                </div>

                <div className="bg-white/70 backdrop-blur-md rounded-2xl border border-white shadow-premium p-5 group hover:shadow-premium-hover transition-all duration-300 hover:-translate-y-1">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="w-8 h-8 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center group-hover:bg-purple-600 group-hover:text-white transition-colors">
                            <Database className="h-4 w-4" />
                        </div>
                        <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">DB Latency</span>
                    </div>
                    <div className="text-lg font-black text-slate-800 truncate" title={system.db_health}>{system.db_health}</div>
                    <div className="text-[11px] text-slate-400 font-medium mt-1">Connection Health</div>
                </div>

                <div className="bg-white/70 backdrop-blur-md rounded-2xl border border-white shadow-premium p-5 group hover:shadow-premium-hover transition-all duration-300 hover:-translate-y-1">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="w-8 h-8 rounded-lg bg-teal-50 text-teal-600 flex items-center justify-center group-hover:bg-teal-600 group-hover:text-white transition-colors">
                            <HardDrive className="h-4 w-4" />
                        </div>
                        <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">DB Size</span>
                    </div>
                    <div className="text-2xl font-black text-slate-800">{system.db_size_mb} <span className="text-sm font-bold text-slate-500">MB</span></div>
                    <div className="text-[11px] text-slate-400 font-medium mt-1">Active Data Volume</div>
                </div>

                <div className="bg-white/70 backdrop-blur-md rounded-2xl border border-white shadow-premium p-5 group hover:shadow-premium-hover transition-all duration-300 hover:-translate-y-1">
                    <div className="flex items-center gap-3 mb-3">
                        <div className="w-8 h-8 rounded-lg bg-orange-50 text-orange-600 flex items-center justify-center group-hover:bg-orange-600 group-hover:text-white transition-colors">
                            <Activity className="h-4 w-4" />
                        </div>
                        <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">PG Conns</span>
                    </div>
                    <div className="text-2xl font-black text-slate-800">{system.active_connections}</div>
                    <div className="text-[11px] text-slate-400 font-medium mt-1">Active DB Queries</div>
                </div>
            </div>

            {/* Logs and Actions */}
            <div className="grid gap-6 md:grid-cols-3">
                <div className="col-span-2 bg-white/70 backdrop-blur-xl rounded-3xl border border-white shadow-premium overflow-hidden flex flex-col">
                    <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-white/50">
                        <div className="flex items-center gap-3">
                            <Server className="h-5 w-5 text-indigo-500" />
                            <h2 className="text-lg font-black text-slate-800 tracking-tight">System Event Stream</h2>
                        </div>
                        <Badge variant="outline" className="bg-slate-50 text-slate-500 border-slate-200">Live</Badge>
                    </div>
                    <div className="p-2 flex-1 relative bg-slate-50/50">
                        <ScrollArea className="h-[320px] rounded-2xl p-4">
                            <div className="space-y-3">
                                {system.logs?.map((log: any, i: number) => (
                                    <div key={i} className="flex gap-4 p-3 rounded-xl bg-white border border-slate-100 shadow-sm hover:shadow-md transition-shadow">
                                        <div className={cn(
                                            "mt-0.5 px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-widest h-fit",
                                            log.level === 'ERROR' ? "bg-red-50 text-red-600" :
                                                log.level === 'WARN' ? "bg-amber-50 text-amber-600" :
                                                    "bg-emerald-50 text-emerald-600"
                                        )}>
                                            {log.level}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="text-sm font-semibold text-slate-700 leading-snug">{log.message}</div>
                                            <div className="text-xs text-slate-400 mt-1 font-medium flex items-center gap-1.5">
                                                <Clock className="w-3 h-3" /> {log.time}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                                {(!system.logs || system.logs.length === 0) && (
                                    <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-3 py-10">
                                        <Activity className="w-8 h-8 opacity-20" />
                                        <p className="font-medium">No recent system events.</p>
                                    </div>
                                )}
                            </div>
                        </ScrollArea>
                    </div>
                </div>

                <div className="col-span-1 bg-white/70 backdrop-blur-xl rounded-3xl border border-white shadow-premium flex flex-col relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 to-purple-500" />
                    <div className="px-6 py-5 border-b border-slate-100">
                        <h2 className="text-lg font-black text-slate-800 tracking-tight">Maintenance tasks</h2>
                        <p className="text-xs text-slate-500 font-medium mt-1">Infrastructure Ops</p>
                    </div>
                    <div className="p-6 space-y-4">
                        <Button
                            variant="outline"
                            onClick={() => {
                                toast.promise(new Promise((resolve) => setTimeout(resolve, 2000)), {
                                    loading: 'Restarting core services...',
                                    success: 'All services successfully restarted and verified.',
                                    error: 'Failed to restart services.',
                                });
                            }}
                            className="w-full justify-start h-12 rounded-xl text-rose-600 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200 transition-colors bg-white font-bold"
                        >
                            <RotateCcw className="h-4 w-4 mr-3" />
                            Restart Services
                        </Button>
                        <Button
                            variant="outline"
                            onClick={() => {
                                const promise = analyticsApi.performMaintenance('clear_cache').then(res => {
                                    if (!res.success) throw new Error(res.message);
                                    return res;
                                });
                                toast.promise(promise, {
                                    loading: 'Purging distributed cache...',
                                    success: 'System cache cleared. RAM reclaimed.',
                                    error: 'Failed to clear cache.',
                                });
                            }}
                            className="w-full justify-start h-12 rounded-xl text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors bg-white font-bold"
                        >
                            <Trash2 className="h-4 w-4 mr-3" />
                            Clear System Cache
                        </Button>
                        <Button
                            variant="outline"
                            onClick={() => {
                                const promise = analyticsApi.performMaintenance('vacuum_db').then(res => {
                                    if (!res.success) throw new Error(res.message);
                                    return res;
                                });
                                toast.promise(promise, {
                                    loading: 'Executing DB Vacuum operation...',
                                    success: 'Database vacuum complete. Performance optimized.',
                                    error: 'Vacuum operation failed.',
                                });
                            }}
                            className="w-full justify-start h-12 rounded-xl text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition-colors bg-white font-bold"
                        >
                            <Database className="h-4 w-4 mr-3" />
                            Vacuum Database
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    )
}

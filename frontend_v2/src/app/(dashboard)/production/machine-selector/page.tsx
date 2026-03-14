'use client';

/**
 * Machine Selector Page
 * 
 * Shown when operator has multiple assigned machines.
 * Each card shows: machine name, status, current job, queue count.
 * Click navigates to /production/machine/[machine_id]
 */
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Server, Play, Pause, AlertCircle, ChevronRight, Package, Layers, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { machineService } from '@/services/machine';

export default function MachineSelectorPage() {
    const router = useRouter();
    const [query, setQuery] = useState('');
    const [lastMachineId, setLastMachineId] = useState('');
    const storageKey = 'tbp:last_machine_terminal';

    const { data: machinesData = [], isLoading, error } = useQuery({
        queryKey: ['operator-machines'],
        queryFn: machineService.getOperatorMachines,
        refetchInterval: 10000,
    });
    const machines = Array.isArray(machinesData) ? machinesData : [];
    const filteredMachines = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return machines;
        return machines.filter((machine) => {
            return (
                String(machine.name || '').toLowerCase().includes(q) ||
                String(machine.code || '').toLowerCase().includes(q) ||
                String(machine.work_center_name || '').toLowerCase().includes(q) ||
                String(machine.plant_name || '').toLowerCase().includes(q)
            );
        });
    }, [machines, query]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const remembered = window.localStorage.getItem(storageKey) || '';
        setLastMachineId(remembered);
    }, []);

    useEffect(() => {
        if (machines.length === 1) {
            const target = String(machines[0].id);
            if (typeof window !== 'undefined') window.localStorage.setItem(storageKey, target);
            router.replace(`/production/machine/${target}`);
        }
    }, [machines, router]);

    if (isLoading) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
                <div className="text-lg text-slate-500">Loading machines...</div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
                <div className="text-center">
                    <AlertCircle className="w-16 h-16 mx-auto mb-4 text-red-400" />
                    <h2 className="text-xl font-semibold text-slate-700 mb-2">Failed to load machines</h2>
                    <p className="text-slate-500">Please try again or contact support</p>
                    <Button className="mt-4" onClick={() => window.location.reload()}>
                        Retry
                    </Button>
                </div>
            </div>
        );
    }

    if (machines.length === 0) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center">
                <div className="text-center">
                    <Server className="w-16 h-16 mx-auto mb-4 text-slate-300" />
                    <h2 className="text-xl font-semibold text-slate-700 mb-2">No Machines Assigned</h2>
                    <p className="text-slate-500">Contact your supervisor to be assigned to a machine</p>
                </div>
            </div>
        );
    }

    // If only one machine, auto-redirect handled in effect.
    if (machines.length === 1) return null;

    return (
        <div className="min-h-screen bg-[#f8fafc] overflow-hidden relative" data-testid="machine-selector-page">
            {/* Rich Background Elements */}
            <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
                <div className="absolute -top-[10%] -left-[10%] w-[40%] h-[40%] rounded-full bg-blue-100/50 blur-[120px]" />
                <div className="absolute top-[20%] -right-[5%] w-[35%] h-[35%] rounded-full bg-indigo-100/40 blur-[100px]" />
                <div className="absolute -bottom-[10%] left-[20%] w-[30%] h-[30%] rounded-full bg-slate-200/50 blur-[110px]" />
            </div>

            <div className="max-w-7xl mx-auto px-6 py-12 relative z-10">
                {/* Header Section */}
                <div className="flex flex-col items-center text-center mb-16">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 border border-blue-100 text-blue-600 text-[10px] font-bold uppercase tracking-widest mb-4 animate-in fade-in slide-in-from-bottom-2 duration-700">
                        Production Floor Terminal
                    </div>
                    <h1 className="text-4xl md:text-5xl font-black text-slate-900 tracking-tight mb-4 animate-in fade-in slide-in-from-bottom-3 duration-700 delay-100">
                        Select Your <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600">Machine</span>
                    </h1>
                    <p className="text-slate-500 text-lg max-w-2xl font-medium animate-in fade-in slide-in-from-bottom-4 duration-700 delay-200">
                        You are currently assigned to {machines.length} active machines. Select a terminal below to begin monitoring and execution.
                    </p>
                    <div className="mt-6 w-full max-w-xl rounded-2xl border border-slate-200 bg-white/80 p-3 shadow-sm">
                        <div className="relative">
                            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <Input
                                value={query}
                                onChange={(event) => setQuery(event.target.value)}
                                className="h-10 border-slate-200 pl-9"
                                placeholder="Search machine, code, work center, or plant..."
                                data-testid="machine-selector-search"
                            />
                        </div>
                        <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                            <span>{filteredMachines.length} visible</span>
                            {lastMachineId ? <span>Last used terminal highlighted</span> : null}
                        </div>
                    </div>
                </div>

                {/* Machine Cards Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                    {filteredMachines.map((machine, idx) => {
                        const isActive = machine.status === 'ACTIVE';
                        const isExecuting = Boolean(machine.current_job);
                        const isLastUsed = String(machine.id) === String(lastMachineId);

                        return (
                            <div
                                key={machine.id}
                                className="group relative animate-in fade-in zoom-in-95 duration-500"
                                style={{ animationDelay: `${idx * 100}ms` }}
                            >
                                {/* Card Glow Effect */}
                                <div className={cn(
                                    'absolute -inset-0.5 rounded-3xl blur transition duration-500',
                                    isLastUsed
                                        ? 'bg-gradient-to-r from-emerald-500 to-indigo-500 opacity-25'
                                        : 'bg-gradient-to-r from-blue-500 to-indigo-500 opacity-0 group-hover:opacity-20',
                                )}></div>

                                <Card
                                    className={cn(
                                        'relative h-full bg-white/80 backdrop-blur-md border border-slate-200/60 rounded-3xl overflow-hidden cursor-pointer hover:border-blue-400/50 transition-all duration-300 shadow-sm hover:shadow-2xl hover:-translate-y-2 flex flex-col',
                                        isLastUsed ? 'border-emerald-300/70 ring-1 ring-emerald-200' : '',
                                    )}
                                    data-testid={`machine-card-${machine.id}`}
                                    onClick={() => {
                                        if (typeof window !== 'undefined') {
                                            window.localStorage.setItem(storageKey, String(machine.id));
                                        }
                                        router.push(`/production/machine/${machine.id}`);
                                    }}
                                >
                                    {/* Visual Accent */}
                                    <div className={cn(
                                        "h-1.5 w-full",
                                        isLastUsed
                                            ? 'bg-gradient-to-r from-emerald-500 to-indigo-500'
                                            : isActive
                                                ? "bg-gradient-to-r from-blue-500 to-indigo-500"
                                                : "bg-slate-300"
                                    )} />

                                    <CardHeader className="pb-4 pt-6">
                                        <div className="flex items-start justify-between">
                                            <div className="flex items-center gap-4">
                                                <div className={cn(
                                                    "w-14 h-14 rounded-2xl flex items-center justify-center transition-transform duration-500 group-hover:scale-110 group-hover:rotate-3 shadow-inner",
                                                    isActive ? "bg-blue-50 text-blue-600" : "bg-slate-50 text-slate-400"
                                                )}>
                                                    <Server className="w-7 h-7" />
                                                </div>
                                                <div>
                                                    <h3 className="text-xl font-black text-slate-900 group-hover:text-blue-600 transition-colors uppercase tracking-tight">
                                                        {machine.name}
                                                    </h3>
                                                    <p className="text-xs font-bold text-slate-400 tracking-wider">
                                                        UID: {machine.code}
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="flex flex-col items-end gap-1.5">
                                                {isLastUsed ? (
                                                    <Badge className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-600">
                                                        Last Used
                                                    </Badge>
                                                ) : null}
                                                <Badge
                                                    variant={isActive ? 'default' : 'secondary'}
                                                    className={cn(
                                                        "px-2.5 py-0.5 rounded-full text-[10px] font-bold border shadow-sm",
                                                        isActive ? "bg-emerald-50 text-emerald-600 border-emerald-200" : "bg-slate-100 text-slate-500 border-slate-200"
                                                    )}
                                                >
                                                    {isActive && <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1.5 animate-pulse" />}
                                                    {machine.status}
                                                </Badge>
                                            </div>
                                        </div>
                                    </CardHeader>

                                    <CardContent className="flex-1 px-6 pb-6 space-y-5">
                                        {/* Meta Info */}
                                        <div className="flex items-center gap-2 text-[11px] font-bold text-slate-500 uppercase tracking-wide">
                                            <Package className="w-3.5 h-3.5 text-slate-400" />
                                            <span>{machine.work_center_name}</span>
                                            <span className="text-slate-200 mx-0.5">|</span>
                                            <span>{machine.plant_name}</span>
                                        </div>

                                        {/* Status Area */}
                                        <div className="relative min-h-[90px]">
                                            {isExecuting ? (
                                                <div className="p-4 bg-gradient-to-br from-blue-50/50 to-indigo-50/50 rounded-2xl border border-blue-100/50 shadow-inner group-hover:shadow-md transition-shadow">
                                                    <div className="flex items-center gap-2 mb-2">
                                                        <div className="relative">
                                                            <div className="absolute inset-0 bg-blue-400 rounded-full animate-ping opacity-20"></div>
                                                            <Play className="w-3.5 h-3.5 text-blue-600 relative" />
                                                        </div>
                                                        <span className="text-[10px] font-black text-blue-700 uppercase tracking-widest">Active Execution</span>
                                                    </div>
                                                    <p className="text-sm font-black text-slate-800 line-clamp-1 mb-1">
                                                        {machine.current_job?.job_number}
                                                    </p>
                                                    <p className="text-[11px] font-medium text-slate-500 line-clamp-1">
                                                        {machine.current_job?.product_name}
                                                    </p>
                                                </div>
                                            ) : (
                                                <div className="p-4 bg-slate-50/50 rounded-2xl border border-slate-100 border-dashed flex flex-col items-center justify-center text-center">
                                                    <Pause className="w-5 h-5 text-slate-300 mb-2" />
                                                    <p className="text-[11px] font-bold text-slate-400 uppercase tracking-widest leading-none">Idle Terminal</p>
                                                </div>
                                            )}
                                        </div>

                                        {/* Queue Stat */}
                                        <div className="flex items-center justify-between px-1">
                                            <div className="flex items-center gap-2">
                                                <div className="w-8 h-8 rounded-lg bg-slate-50 flex items-center justify-center">
                                                    <Layers className="w-4 h-4 text-slate-400" />
                                                </div>
                                                <span className="text-xs font-bold text-slate-600 uppercase tracking-tight">Pending Jobs</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span className="text-lg font-black text-slate-900 leading-none">
                                                    {machine.queue_count}
                                                </span>
                                                <div className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 text-[10px] font-black uppercase">
                                                    Queue
                                                </div>
                                            </div>
                                        </div>

                                        {/* Action Button Overlay Style */}
                                        <Button
                                            className="w-full h-11 bg-slate-900 hover:bg-blue-600 text-white border-none rounded-xl font-bold text-xs uppercase tracking-widest transition-all duration-300 shadow-lg shadow-slate-200 hover:shadow-blue-200"
                                        >
                                            Enter Terminal
                                            <ChevronRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
                                        </Button>
                                    </CardContent>
                                </Card>
                            </div>
                        );
                    })}
                </div>

                {!filteredMachines.length ? (
                    <div className="mt-10 rounded-2xl border border-dashed border-slate-300 bg-white/70 p-8 text-center text-sm text-slate-500">
                        No machine matched the current search query.
                    </div>
                ) : null}

                {/* Footer Meta */}
                <div className="mt-20 text-center text-slate-400 text-[10px] font-bold uppercase tracking-[0.2em] opacity-60">
                    Proprietary Production Intelligence System • v2.4.0
                </div>
            </div>
        </div>
    );
}

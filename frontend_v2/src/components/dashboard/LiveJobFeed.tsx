"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Play, Pause, CheckCircle2 } from "lucide-react";

interface JobItem {
    id: string;
    job_number: string;
    product: string;
    progress: number;
    status: 'RUNNING' | 'PAUSED' | 'COMPLETED';
    operator?: string;
}

export function LiveJobFeed({ jobs = [] }: { jobs: JobItem[] }) {
    return (
        <Card className="border shadow-sm h-full">
            <CardHeader className="pb-3 border-b bg-slate-50/50">
                <CardTitle className="text-sm font-bold uppercase tracking-wide text-slate-500 flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                    Live Floor Activity
                </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
                <ScrollArea className="h-[300px]">
                    <div className="divide-y divide-slate-100">
                        {jobs.map((job) => (
                            <div key={job.id} className="p-4 hover:bg-slate-50 transition-colors flex items-center justify-between group">
                                <div>
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="font-mono font-bold text-slate-700">{job.job_number}</span>
                                        {job.status === 'RUNNING' && <Badge variant="outline" className="text-[10px] border-emerald-200 text-emerald-700 bg-emerald-50 px-1 py-0 h-5">RUNNING</Badge>}
                                        {job.status === 'PAUSED' && <Badge variant="outline" className="text-[10px] border-amber-200 text-amber-700 bg-amber-50 px-1 py-0 h-5">PAUSED</Badge>}
                                    </div>
                                    <p className="text-xs font-medium text-slate-600 truncate max-w-[180px]">{job.product}</p>
                                    <div className="mt-2 text-[10px] text-slate-400 font-mono">
                                        OP: {job.operator || "Unassigned"}
                                    </div>
                                </div>
                                <div className="flex flex-col items-end gap-1">
                                    <span className="text-sm font-bold text-slate-900">{job.progress}%</span>
                                    <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-blue-500 rounded-full transition-all duration-1000"
                                            style={{ width: `${job.progress}%` }}
                                        />
                                    </div>
                                </div>
                            </div>
                        ))}
                        {jobs.length === 0 && (
                            <div className="p-8 text-center text-slate-400 text-sm italic">
                                No active jobs on the floor.
                            </div>
                        )}
                    </div>
                </ScrollArea>
            </CardContent>
        </Card>
    );
}

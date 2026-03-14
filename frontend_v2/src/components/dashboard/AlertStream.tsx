"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, AlertTriangle, CheckCircle2, Factory } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";

interface AlertItem {
    id: string;
    type: string; // INVENTORY, PRODUCTION, SALES
    severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    message: string;
    timestamp: string;
}

export function AlertStream({ alerts = [] }: { alerts: AlertItem[] }) {
    const getIcon = (type: string, severity: string) => {
        if (severity === 'CRITICAL') return <AlertTriangle className="h-5 w-5 text-rose-500" />;
        if (type === 'INVENTORY') return <AlertCircle className="h-5 w-5 text-amber-500" />;
        return <CheckCircle2 className="h-5 w-5 text-slate-400" />;
    };

    return (
        <Card className="border shadow-sm h-full">
            <CardHeader className="pb-3 border-b bg-slate-50/50">
                <CardTitle className="text-sm font-bold uppercase tracking-wide text-slate-500 flex items-center gap-2">
                    <Factory className="h-4 w-4 text-slate-400" />
                    Executive Feed
                </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
                <ScrollArea className="h-[300px]">
                    <div className="divide-y divide-slate-100">
                        {alerts.map((alert) => (
                            <div key={alert.id} className="p-4 hover:bg-slate-50 transition-colors flex gap-3 group">
                                <div className="mt-1 flex-shrink-0">
                                    {getIcon(alert.type, alert.severity)}
                                </div>
                                <div className="flex-1">
                                    <div className="flex justify-between items-start">
                                        <p className="text-sm font-medium text-slate-800">{alert.message}</p>
                                        <span className="text-[10px] text-slate-400 font-mono flex-shrink-0 ml-2">
                                            {new Date(alert.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                    </div>
                                    <div className="mt-1 flex items-center gap-2">
                                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wide 
                                            ${alert.severity === 'CRITICAL' ? 'bg-rose-100 text-rose-700' :
                                                alert.severity === 'HIGH' ? 'bg-orange-100 text-orange-700' :
                                                    'bg-slate-100 text-slate-600'}`}>
                                            {alert.severity}
                                        </span>
                                        <span className="text-[10px] text-slate-400 uppercase tracking-wide">{alert.type}</span>
                                    </div>
                                </div>
                            </div>
                        ))}
                        {alerts.length === 0 && (
                            <div className="p-8 text-center text-slate-400 text-sm italic">
                                No critical alerts. System nominal.
                            </div>
                        )}
                    </div>
                </ScrollArea>
            </CardContent>
        </Card>
    );
}

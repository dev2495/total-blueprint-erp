"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQuery } from "@tanstack/react-query";
import { analyticsApi, type ControlTowerStats } from "@/services/analytics";
import { BarChart3, TrendingUp, Activity, AlertTriangle } from "lucide-react";

export function KPIStatsGrid() {
    const { data: stats, isLoading } = useQuery<ControlTowerStats>({
        queryKey: ['control-tower-stats'],
        queryFn: () => analyticsApi.getControlTowerStats("month"),
    });

    if (isLoading) return <div className="p-8 text-center text-slate-400">Loading KPI Data...</div>;

    // Helper to find metric by ID or Label
    const getMetric = (label: string) =>
        stats?.metrics?.find((m) => String(m.label || "").includes(label)) || { value: 0, unit: '' };

    return (
        <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Production</CardTitle>
                        <Activity className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{getMetric('Production').value}</div>
                        <p className="text-xs text-muted-foreground">{getMetric('Production').unit}</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">OEE Score</CardTitle>
                        <BarChart3 className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{getMetric('OEE').value}</div>
                        <p className="text-xs text-muted-foreground">{getMetric('OEE').unit}</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Active Alerts</CardTitle>
                        <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{getMetric('Alerts').value}</div>
                        <p className="text-xs text-muted-foreground">{getMetric('Alerts').unit}</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Revenue (Est)</CardTitle>
                        <TrendingUp className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{getMetric('Revenue').value?.toLocaleString()}</div>
                        <p className="text-xs text-muted-foreground">{getMetric('Revenue').unit}</p>
                    </CardContent>
                </Card>
            </div>

            <Card className="col-span-4">
                <CardHeader>
                    <CardTitle>Performance Trends</CardTitle>
                </CardHeader>
                <CardContent className="pl-2">
                    <div className="h-[200px] flex items-center justify-center text-slate-400 text-sm italic">
                        Chart visualization requires specific data structure.
                        (Using placeholder until full charting library integration)
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}

"use client"

import { useQuery } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Cpu, Activity, AlertTriangle, Layers } from "lucide-react"
import Link from "next/link"
import { StatsGrid } from "@/components/dashboard/stats-grid"

export default function WorkCenterDashboard() {
    const { data: stats } = useQuery({
        queryKey: ["wcm-dashboard-stats"],
        queryFn: async () => {
            return {
                metrics: [
                    { label: "Jobs Today", value: "8", unit: "Scheduled", trend: 0 },
                    { label: "Machine Load", value: "92%", unit: "Utilization", trend: 5 },
                    { label: "Scrap Rate", value: "3.2%", unit: "Last 24h", trend: -1 },
                    { label: "Downtime", value: "45m", unit: "Total", trend: 0 },
                ]
            }
        }
    })

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-black text-slate-900 tracking-tight">Work Center Terminal</h1>
                    <p className="text-slate-500 font-medium">Shop Floor Execution</p>
                </div>
                <Link href="/production/work-center">
                    <Button className="bg-indigo-600 hover:bg-indigo-700">
                        <Cpu className="mr-2 h-4 w-4" /> Manage Machines
                    </Button>
                </Link>
            </div>

            <StatsGrid metrics={stats?.metrics || []} />

            <div className="grid gap-6 md:grid-cols-2">
                <Card className="border-0 shadow-sm border-l-4 border-l-emerald-500">
                    <CardHeader>
                        <CardTitle>Active Machines</CardTitle>
                        <CardDescription>Real-time machine status</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <div className="flex items-center justify-between p-3 bg-emerald-50 rounded-lg">
                            <div className="flex items-center gap-3">
                                <Activity className="h-5 w-5 text-emerald-600 animate-pulse" />
                                <div>
                                    <p className="text-sm font-bold text-slate-900">Printing Line 01</p>
                                    <p className="text-xs text-emerald-700 font-medium">Running - Job #1022</p>
                                </div>
                            </div>
                            <span className="text-xs font-bold text-slate-500">350 m/min</span>
                        </div>
                        <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                            <div className="flex items-center gap-3">
                                <Layers className="h-5 w-5 text-slate-400" />
                                <div>
                                    <p className="text-sm font-bold text-slate-900">Lamination 02</p>
                                    <p className="text-xs text-slate-500 font-medium">Idle - Setup for Job #1024</p>
                                </div>
                            </div>
                            <span className="text-xs font-bold text-slate-500">0 m/min</span>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}

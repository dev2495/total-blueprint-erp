"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { TrendingUp, Target, Gauge, Activity } from "lucide-react"

export default function KPIPage() {
    return (
        <div className="p-6 space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold">KPI Center</h1>
            </div>

            {/* KPI Cards */}
            <div className="grid gap-4 md:grid-cols-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">OEE</CardTitle>
                        <Gauge className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">78%</div>
                        <p className="text-xs text-muted-foreground">Overall Equipment Effectiveness</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">On-Time Delivery</CardTitle>
                        <Target className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">92%</div>
                        <p className="text-xs text-muted-foreground">Target: 95%</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Scrap Rate</CardTitle>
                        <TrendingUp className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">2.3%</div>
                        <p className="text-xs text-muted-foreground">Below target 3%</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Utilization</CardTitle>
                        <Activity className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">85%</div>
                        <p className="text-xs text-muted-foreground">Machine utilization</p>
                    </CardContent>
                </Card>
            </div>

            {/* Chart Placeholder */}
            <Card>
                <CardHeader>
                    <CardTitle>KPI Trends</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="h-64 flex items-center justify-center bg-muted/20 rounded-lg">
                        <p className="text-muted-foreground">Chart placeholder - KPI trend visualization</p>
                    </div>
                </CardContent>
            </Card>

            {/* Table */}
            <Card>
                <CardHeader>
                    <CardTitle>KPI Summary</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="rounded-md border">
                        <table className="w-full text-sm">
                            <thead className="bg-muted/50">
                                <tr>
                                    <th className="p-3 text-left">KPI</th>
                                    <th className="p-3 text-left">Current</th>
                                    <th className="p-3 text-left">Target</th>
                                    <th className="p-3 text-left">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr className="border-t">
                                    <td className="p-3">OEE</td>
                                    <td className="p-3">78%</td>
                                    <td className="p-3">80%</td>
                                    <td className="p-3"><span className="px-2 py-1 bg-yellow-100 text-yellow-800 rounded text-xs">Near Target</span></td>
                                </tr>
                                <tr className="border-t">
                                    <td className="p-3">On-Time Delivery</td>
                                    <td className="p-3">92%</td>
                                    <td className="p-3">95%</td>
                                    <td className="p-3"><span className="px-2 py-1 bg-yellow-100 text-yellow-800 rounded text-xs">Near Target</span></td>
                                </tr>
                                <tr className="border-t">
                                    <td className="p-3">Scrap Rate</td>
                                    <td className="p-3">2.3%</td>
                                    <td className="p-3">3%</td>
                                    <td className="p-3"><span className="px-2 py-1 bg-green-100 text-green-800 rounded text-xs">On Target</span></td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}

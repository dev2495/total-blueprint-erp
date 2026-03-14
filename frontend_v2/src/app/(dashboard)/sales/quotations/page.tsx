"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { FileText, Clock, DollarSign, CheckCircle } from "lucide-react"

export default function QuotationsPage() {
    return (
        <div className="p-6 space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold">Quotations</h1>
            </div>

            {/* KPI Cards */}
            <div className="grid gap-4 md:grid-cols-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Open Quotations</CardTitle>
                        <FileText className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">12</div>
                        <p className="text-xs text-muted-foreground">Pending response</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">This Month</CardTitle>
                        <Clock className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">28</div>
                        <p className="text-xs text-muted-foreground">Quotations sent</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Value</CardTitle>
                        <DollarSign className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">₹24.5L</div>
                        <p className="text-xs text-muted-foreground">Open quotations</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Converted</CardTitle>
                        <CheckCircle className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">68%</div>
                        <p className="text-xs text-muted-foreground">Conversion rate</p>
                    </CardContent>
                </Card>
            </div>

            {/* Chart Placeholder */}
            <Card>
                <CardHeader>
                    <CardTitle>Quotation Pipeline</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="h-64 flex items-center justify-center bg-muted/20 rounded-lg">
                        <p className="text-muted-foreground">Chart placeholder - Quotation funnel visualization</p>
                    </div>
                </CardContent>
            </Card>

            {/* Table */}
            <Card>
                <CardHeader>
                    <CardTitle>Recent Quotations</CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="rounded-md border">
                        <table className="w-full text-sm">
                            <thead className="bg-muted/50">
                                <tr>
                                    <th className="p-3 text-left">Quote #</th>
                                    <th className="p-3 text-left">Customer</th>
                                    <th className="p-3 text-left">Value</th>
                                    <th className="p-3 text-left">Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr className="border-t">
                                    <td className="p-3 font-mono">QT00045</td>
                                    <td className="p-3">Acme Corp</td>
                                    <td className="p-3">₹4,50,000</td>
                                    <td className="p-3"><span className="px-2 py-1 bg-yellow-100 text-yellow-800 rounded text-xs">Pending</span></td>
                                </tr>
                                <tr className="border-t">
                                    <td className="p-3 font-mono">QT00044</td>
                                    <td className="p-3">Beta Industries</td>
                                    <td className="p-3">₹2,80,000</td>
                                    <td className="p-3"><span className="px-2 py-1 bg-green-100 text-green-800 rounded text-xs">Accepted</span></td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}

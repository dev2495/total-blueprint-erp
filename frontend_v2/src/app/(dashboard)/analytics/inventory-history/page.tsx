"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
    TrendingUp,
    Camera,
    RefreshCw,
    Package,
    CircleDot
} from "lucide-react";
import { observabilityApi, type InventorySnapshot } from "@/services/observability";

export default function InventoryHistoryPage() {
    const [snapshots, setSnapshots] = useState<InventorySnapshot[]>([]);
    const [loading, setLoading] = useState(true);

    const loadSnapshots = async () => {
        try {
            const data = await observabilityApi.getSnapshots();
            setSnapshots(data);
        } catch (error) {
            console.error("Failed to load snapshots:", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadSnapshots();
    }, []);

    const formatDate = (date: string) => {
        return new Date(date).toLocaleDateString("en-US", {
            weekday: "short",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit"
        });
    };

    const calculateChange = (current: number, previous: number) => {
        if (previous === 0) return 0;
        return ((current - previous) / previous) * 100;
    };

    if (loading) {
        return (
            <div className="p-6 space-y-4">
                <Skeleton className="h-10 w-64" />
                <Skeleton className="h-96" />
            </div>
        );
    }

    return (
        <div className="p-6 space-y-6 bg-gray-50 min-h-screen">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Inventory History</h1>
                    <p className="text-gray-500">Daily snapshots and stock trends</p>
                </div>
                <Button onClick={loadSnapshots} variant="outline">
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Refresh
                </Button>
            </div>

            {/* Summary Cards */}
            {snapshots.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <Card className="border-0 shadow-sm">
                        <CardContent className="pt-6">
                            <div className="flex items-center gap-4">
                                <div className="p-3 bg-blue-100 rounded-lg">
                                    <TrendingUp className="h-6 w-6 text-blue-600" />
                                </div>
                                <div>
                                    <p className="text-sm text-gray-500">Total Snapshots</p>
                                    <p className="text-2xl font-bold">{snapshots.length}</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="border-0 shadow-sm">
                        <CardContent className="pt-6">
                            <div className="flex items-center gap-4">
                                <div className="p-3 bg-green-100 rounded-lg">
                                    <Package className="h-6 w-6 text-green-600" />
                                </div>
                                <div>
                                    <p className="text-sm text-gray-500">Latest Bulk Stock</p>
                                    <p className="text-2xl font-bold">
                                        {snapshots[0]?.total_bulk_kg.toLocaleString()} kg
                                    </p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="border-0 shadow-sm">
                        <CardContent className="pt-6">
                            <div className="flex items-center gap-4">
                                <div className="p-3 bg-purple-100 rounded-lg">
                                    <CircleDot className="h-6 w-6 text-purple-600" />
                                </div>
                                <div>
                                    <p className="text-sm text-gray-500">Latest Roll Stock</p>
                                    <p className="text-2xl font-bold">
                                        {snapshots[0]?.total_roll_kg.toLocaleString()} kg
                                    </p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            )}

            {/* Snapshots Table */}
            <Card className="border-0 shadow-sm">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Camera className="h-5 w-5" />
                        Snapshot History
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {snapshots.length === 0 ? (
                        <div className="text-center py-12 text-gray-500">
                            <Camera className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                            <p className="font-medium">No snapshots yet</p>
                            <p className="text-sm">Run the nightly job or create one manually</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="border-b">
                                        <th className="text-left py-3 px-4 font-medium text-gray-600">Date</th>
                                        <th className="text-left py-3 px-4 font-medium text-gray-600">Plant</th>
                                        <th className="text-right py-3 px-4 font-medium text-gray-600">Bulk (kg)</th>
                                        <th className="text-right py-3 px-4 font-medium text-gray-600">Rolls (kg)</th>
                                        <th className="text-right py-3 px-4 font-medium text-gray-600">FG (kg)</th>
                                        <th className="text-right py-3 px-4 font-medium text-gray-600">WIP (kg)</th>
                                        <th className="text-right py-3 px-4 font-medium text-gray-600">Reserved (kg)</th>
                                        <th className="text-right py-3 px-4 font-medium text-gray-600">Scrap (kg)</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {snapshots.map((snapshot, idx) => {
                                        const prev = idx < snapshots.length - 1 ? snapshots[idx + 1] : null;
                                        const bulkChange = prev ? calculateChange(snapshot.total_bulk_kg, prev.total_bulk_kg) : 0;

                                        return (
                                            <tr key={snapshot.id} className="border-b hover:bg-gray-50">
                                                <td className="py-3 px-4">{formatDate(snapshot.created_at)}</td>
                                                <td className="py-3 px-4">
                                                    <span className="font-medium">{snapshot.plant_code}</span>
                                                    <span className="text-gray-400 ml-2">{snapshot.plant_name}</span>
                                                </td>
                                                <td className="py-3 px-4 text-right font-mono">
                                                    {snapshot.total_bulk_kg.toLocaleString()}
                                                    {bulkChange !== 0 && (
                                                        <span className={`ml-2 text-xs ${bulkChange > 0 ? "text-green-600" : "text-red-600"}`}>
                                                            {bulkChange > 0 ? "+" : ""}{bulkChange.toFixed(1)}%
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="py-3 px-4 text-right font-mono">{snapshot.total_roll_kg.toLocaleString()}</td>
                                                <td className="py-3 px-4 text-right font-mono text-green-600">{snapshot.total_fg_kg.toLocaleString()}</td>
                                                <td className="py-3 px-4 text-right font-mono text-amber-600">{snapshot.total_wip_kg.toLocaleString()}</td>
                                                <td className="py-3 px-4 text-right font-mono">{snapshot.reserved_roll_kg.toLocaleString()}</td>
                                                <td className="py-3 px-4 text-right font-mono text-red-600">{snapshot.scrap_kg.toLocaleString()}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
    AlertTriangle,
    CheckCircle2,
    Filter,
    Search,
    RefreshCw
} from "lucide-react";
import { observabilityApi, type InventoryAlert } from "@/services/observability";

export default function AlertsCenterPage() {
    const [alerts, setAlerts] = useState<InventoryAlert[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState("");
    const [filterResolved, setFilterResolved] = useState<boolean | undefined>(false);
    const [resolveDialogOpen, setResolveDialogOpen] = useState(false);
    const [selectedAlert, setSelectedAlert] = useState<InventoryAlert | null>(null);
    const [resolutionNote, setResolutionNote] = useState("");

    const loadAlerts = async () => {
        try {
            const data = await observabilityApi.getAlerts({ resolved: filterResolved });
            setAlerts(data);
        } catch (error) {
            console.error("Failed to load alerts:", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadAlerts();
    }, [filterResolved]);

    const handleResolve = async () => {
        if (!selectedAlert) return;
        try {
            await observabilityApi.resolveAlert(selectedAlert.id, resolutionNote);
            setResolveDialogOpen(false);
            setResolutionNote("");
            loadAlerts();
        } catch (error) {
            console.error("Failed to resolve alert:", error);
        }
    };

    const getSeverityColor = (severity: string) => {
        switch (severity) {
            case "CRITICAL": return "bg-red-500";
            case "HIGH": return "bg-orange-500";
            case "MEDIUM": return "bg-yellow-500";
            default: return "bg-blue-500";
        }
    };

    const filteredAlerts = alerts.filter(alert =>
        alert.message.toLowerCase().includes(searchTerm.toLowerCase()) ||
        alert.type_display.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (alert.material_code?.toLowerCase() || "").includes(searchTerm.toLowerCase()) ||
        (alert.roll_label?.toLowerCase() || "").includes(searchTerm.toLowerCase())
    );

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
                    <h1 className="text-2xl font-bold text-gray-900">Alerts Center</h1>
                    <p className="text-gray-500">Inventory anomalies and actions</p>
                </div>
                <Button onClick={loadAlerts} variant="outline">
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Refresh
                </Button>
            </div>

            {/* Filters */}
            <div className="flex items-center gap-4">
                <div className="relative flex-1 max-w-sm">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                    <Input
                        placeholder="Search alerts..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-10"
                    />
                </div>
                <div className="flex items-center gap-2">
                    <Filter className="h-4 w-4 text-gray-400" />
                    <Button
                        variant={filterResolved === false ? "default" : "outline"}
                        size="sm"
                        onClick={() => setFilterResolved(false)}
                    >
                        Open
                    </Button>
                    <Button
                        variant={filterResolved === true ? "default" : "outline"}
                        size="sm"
                        onClick={() => setFilterResolved(true)}
                    >
                        Resolved
                    </Button>
                    <Button
                        variant={filterResolved === undefined ? "default" : "outline"}
                        size="sm"
                        onClick={() => setFilterResolved(undefined)}
                    >
                        All
                    </Button>
                </div>
            </div>

            {/* Alerts List */}
            <Card className="border-0 shadow-sm">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <AlertTriangle className="h-5 w-5" />
                        {filteredAlerts.length} Alerts
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {filteredAlerts.length === 0 ? (
                        <div className="text-center py-12 text-gray-500">
                            <CheckCircle2 className="h-12 w-12 mx-auto mb-3 text-green-500" />
                            <p className="font-medium">No alerts found</p>
                            <p className="text-sm">All systems operating normally</p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {filteredAlerts.map((alert) => (
                                <div
                                    key={alert.id}
                                    className={`flex items-start justify-between p-4 rounded-lg border transition-colors ${alert.resolved ? "bg-gray-50 opacity-60" : "bg-white hover:bg-gray-50"
                                        }`}
                                >
                                    <div className="flex items-start gap-4">
                                        <Badge className={`${getSeverityColor(alert.severity)} text-white mt-1`}>
                                            {alert.severity}
                                        </Badge>
                                        <div>
                                            <p className="font-medium">{alert.type_display}</p>
                                            <p className="text-sm text-gray-600 mt-1">{alert.message}</p>
                                            <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                                                {alert.material_code && (
                                                    <span>Material: <strong>{alert.material_code}</strong></span>
                                                )}
                                                {alert.roll_label && (
                                                    <span>Roll: <strong>{alert.roll_label}</strong></span>
                                                )}
                                                {alert.plant_name && (
                                                    <span>Plant: {alert.plant_name}</span>
                                                )}
                                                <span>{new Date(alert.created_at).toLocaleString()}</span>
                                            </div>
                                            {alert.resolved && (
                                                <p className="text-xs text-green-600 mt-2">
                                                    ✓ Resolved by {alert.resolved_by_name} on {new Date(alert.resolved_at!).toLocaleDateString()}
                                                    {alert.resolution_note && ` — "${alert.resolution_note}"`}
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                    {!alert.resolved && (
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => {
                                                setSelectedAlert(alert);
                                                setResolveDialogOpen(true);
                                            }}
                                        >
                                            <CheckCircle2 className="h-4 w-4 mr-1" />
                                            Resolve
                                        </Button>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Resolve Dialog */}
            <Dialog open={resolveDialogOpen} onOpenChange={setResolveDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Resolve Alert</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div>
                            <Label>Alert Type</Label>
                            <p className="text-sm text-gray-600">{selectedAlert?.type_display}</p>
                        </div>
                        <div>
                            <Label htmlFor="note">Resolution Note (optional)</Label>
                            <Textarea
                                id="note"
                                value={resolutionNote}
                                onChange={(e) => setResolutionNote(e.target.value)}
                                placeholder="Document how this was resolved..."
                                rows={3}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setResolveDialogOpen(false)}>Cancel</Button>
                        <Button onClick={handleResolve}>Mark Resolved</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

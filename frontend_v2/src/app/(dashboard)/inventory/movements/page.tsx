"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { History, Search, ArrowRight, MapPin, Package, Calendar, User } from "lucide-react";
import { listRollMovements, type RollMovement } from "@/services/rolls";

export default function RollMovementsPage() {
    const [movements, setMovements] = useState<RollMovement[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");

    useEffect(() => {
        fetchMovements();
    }, []);

    const fetchMovements = async () => {
        try {
            setLoading(true);
            const data = await listRollMovements();
            setMovements(data);
        } catch (error) {
            console.error("Failed to fetch movements:", error);
        } finally {
            setLoading(false);
        }
    };

    const getReasonColor = (reason: string) => {
        switch (reason) {
            case 'GRN': return 'bg-emerald-100 text-emerald-700';
            case 'PRODUCTION': return 'bg-blue-100 text-blue-700';
            case 'WIP_TRANSFER': return 'bg-indigo-100 text-indigo-700';
            case 'FG_TRANSFER': return 'bg-purple-100 text-purple-700';
            case 'DISPATCH': return 'bg-amber-100 text-amber-700';
            case 'SCRAP': return 'bg-red-100 text-red-700';
            case 'JOBWORK_OUT':
            case 'JOBWORK_IN': return 'bg-orange-100 text-orange-700';
            default: return 'bg-gray-100 text-gray-600';
        }
    };

    const formatDate = (timestamp: string) => {
        return new Date(timestamp).toLocaleString('en-IN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const filteredMovements = movements.filter(m =>
        m.roll_label.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.to_location_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (m.from_location_name?.toLowerCase() || '').includes(searchQuery.toLowerCase())
    );

    return (
        <div className="p-6 space-y-6 bg-gray-50/50 min-h-screen">
            {/* Header */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                        <History className="w-6 h-6 text-indigo-600" />
                        Roll Movements
                    </h1>
                    <p className="text-gray-500 mt-1">Track physical location changes of all rolls</p>
                </div>
                <div className="flex items-center gap-3">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                        <Input
                            placeholder="Search movements..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-9 w-64"
                        />
                    </div>
                    <Button variant="outline" onClick={fetchMovements}>
                        Refresh
                    </Button>
                </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card>
                    <CardContent className="p-4">
                        <div className="text-2xl font-bold text-gray-900">{movements.length}</div>
                        <div className="text-sm text-gray-500">Total Movements</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="text-2xl font-bold text-emerald-600">{movements.filter(m => m.reason === 'GRN').length}</div>
                        <div className="text-sm text-gray-500">GRN Receipts</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="text-2xl font-bold text-blue-600">{movements.filter(m => m.reason === 'PRODUCTION').length}</div>
                        <div className="text-sm text-gray-500">Production Moves</div>
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-4">
                        <div className="text-2xl font-bold text-amber-600">{movements.filter(m => m.reason === 'DISPATCH').length}</div>
                        <div className="text-sm text-gray-500">Dispatches</div>
                    </CardContent>
                </Card>
            </div>

            {/* Movements List */}
            {loading ? (
                <Card>
                    <CardContent className="p-12 text-center text-gray-500">
                        Loading movements...
                    </CardContent>
                </Card>
            ) : (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-lg">Movement Log</CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                        <div className="divide-y divide-gray-100">
                            {filteredMovements.length === 0 ? (
                                <div className="p-8 text-center text-gray-500">
                                    No movements found
                                </div>
                            ) : (
                                filteredMovements.map((movement) => (
                                    <div key={movement.id} className="flex items-center gap-4 p-4 hover:bg-gray-50 transition-colors">
                                        <div className="flex-shrink-0">
                                            <Package className="w-8 h-8 text-indigo-600 p-1.5 bg-indigo-50 rounded-lg" />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="font-medium text-gray-900">{movement.roll_label}</div>
                                            <div className="flex items-center gap-2 text-sm text-gray-500 mt-1">
                                                <MapPin className="w-3 h-3" />
                                                <span>{movement.from_location_name || 'NEW'}</span>
                                                <ArrowRight className="w-3 h-3" />
                                                <span className="font-medium text-gray-700">{movement.to_location_name}</span>
                                            </div>
                                        </div>
                                        <div className="flex flex-col items-end gap-1">
                                            <Badge className={getReasonColor(movement.reason)}>{movement.reason.replace('_', ' ')}</Badge>
                                            <div className="flex items-center gap-1 text-xs text-gray-400">
                                                <Calendar className="w-3 h-3" />
                                                {formatDate(movement.timestamp)}
                                            </div>
                                            {movement.moved_by_name && (
                                                <div className="flex items-center gap-1 text-xs text-gray-400">
                                                    <User className="w-3 h-3" />
                                                    {movement.moved_by_name}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}

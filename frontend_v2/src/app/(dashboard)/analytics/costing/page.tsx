"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { costingService, MonthlyOverhead } from "@/services/costing";
import { PageHeader } from "@/components/ui-custom/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Loader2, Zap, Users, Calculator, Plus, Save } from "lucide-react";

export default function CostingCenterPage() {
    const queryClient = useQueryClient();
    const [isAdding, setIsAdding] = useState(false);

    // Form State
    const [selectedYear, setSelectedYear] = useState<string>(new Date().getFullYear().toString());
    const [selectedMonth, setSelectedMonth] = useState<string>((new Date().getMonth() + 1).toString());
    const [electricity, setElectricity] = useState<string>("");
    const [labor, setLabor] = useState<string>("");
    const [other, setOther] = useState<string>("");

    const { data: overheads = [], isLoading } = useQuery({
        queryKey: ['monthly-overheads'],
        queryFn: costingService.getMonthlyOverheads
    });

    const createMutation = useMutation({
        mutationFn: costingService.createMonthlyOverhead,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['monthly-overheads'] });
            setIsAdding(false);
            setElectricity("");
            setLabor("");
            setOther("");
        }
    });

    const handleSave = () => {
        createMutation.mutate({
            year: parseInt(selectedYear),
            month: parseInt(selectedMonth),
            electricity_cost: electricity || "0",
            labor_cost: labor || "0",
            other_overheads: other || "0"
        });
    };

    const getMonthName = (monthNum: number) => {
        const date = new Date(2000, monthNum - 1, 1);
        return format(date, 'MMMM');
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <PageHeader
                    title="Costing Center"
                    description="Manage actual monthly fixed overheads for precise profit margins."
                />
                <Button onClick={() => setIsAdding(!isAdding)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Record New Month
                </Button>
            </div>

            {isAdding && (
                <Card className="border-indigo-100 shadow-sm bg-indigo-50/10">
                    <CardHeader>
                        <CardTitle className="text-lg">Record Monthly Overheads</CardTitle>
                        <CardDescription>Values entered here will instantly affect KPI calculations for this specific month.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                            <div className="space-y-2">
                                <Label>Year</Label>
                                <Select value={selectedYear} onValueChange={setSelectedYear}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Year" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="2025">2025</SelectItem>
                                        <SelectItem value="2026">2026</SelectItem>
                                        <SelectItem value="2027">2027</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Month</Label>
                                <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Month" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                                            <SelectItem key={m} value={m.toString()}>{getMonthName(m)}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-2">
                                <Label>Electricity Bill (₹)</Label>
                                <div className="relative">
                                    <Zap className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                                    <Input
                                        type="number"
                                        className="pl-9"
                                        placeholder="0.00"
                                        value={electricity}
                                        onChange={(e) => setElectricity(e.target.value)}
                                    />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label>Total Labor (₹)</Label>
                                <div className="relative">
                                    <Users className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                                    <Input
                                        type="number"
                                        className="pl-9"
                                        placeholder="0.00"
                                        value={labor}
                                        onChange={(e) => setLabor(e.target.value)}
                                    />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label>Other Overheads (₹)</Label>
                                <div className="relative">
                                    <Calculator className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                                    <Input
                                        type="number"
                                        className="pl-9"
                                        placeholder="0.00"
                                        value={other}
                                        onChange={(e) => setOther(e.target.value)}
                                    />
                                </div>
                            </div>
                        </div>
                        <div className="flex justify-end gap-2 pt-2">
                            <Button variant="ghost" onClick={() => setIsAdding(false)}>Cancel</Button>
                            <Button onClick={handleSave} disabled={createMutation.isPending}>
                                {createMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                                Save Ledger
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}

            <Card>
                <CardHeader>
                    <CardTitle>Historical P&L Overheads</CardTitle>
                    <CardDescription>A ledger of all recorded fixed costs affecting net margins.</CardDescription>
                </CardHeader>
                <CardContent>
                    {isLoading ? (
                        <div className="py-8 flex justify-center"><Loader2 className="h-8 w-8 animate-spin text-slate-300" /></div>
                    ) : (
                        <Table>
                            <TableHeader className="bg-slate-50">
                                <TableRow>
                                    <TableHead>Period</TableHead>
                                    <TableHead className="text-right">Electricity</TableHead>
                                    <TableHead className="text-right">Labor</TableHead>
                                    <TableHead className="text-right">Other Overheads</TableHead>
                                    <TableHead className="text-right text-indigo-600 font-semibold">Total Monthly Fixed</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {overheads.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={5} className="text-center py-8 text-slate-500">
                                            No monthly overheads recorded yet.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    overheads.map((oh) => {
                                        const e = parseFloat(oh.electricity_cost);
                                        const l = parseFloat(oh.labor_cost);
                                        const o = parseFloat(oh.other_overheads);
                                        const total = e + l + o;

                                        return (
                                            <TableRow key={oh.id}>
                                                <TableCell className="font-medium">
                                                    {getMonthName(oh.month)} {oh.year}
                                                </TableCell>
                                                <TableCell className="text-right text-orange-600">₹ {e.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                                <TableCell className="text-right text-emerald-600">₹ {l.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                                <TableCell className="text-right text-slate-600">₹ {o.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                                <TableCell className="text-right font-bold text-indigo-600">
                                                    ₹ {total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })
                                )}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

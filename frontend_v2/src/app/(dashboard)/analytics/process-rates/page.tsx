"use client"

import { useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { costingService, ProcessCostRate } from "@/services/costing"
import { factoryService, Process, Machine } from "@/services/factory"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
    Table, TableHeader, TableRow, TableHead, TableBody, TableCell
} from "@/components/ui/table"
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter
} from "@/components/ui/dialog"
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select"
import {
    Loader2, Zap, Users, Building, Plus, Save, Trash2,
    AlertCircle, CheckCircle2, RefreshCw, ChevronRight, Info, Activity
} from "lucide-react"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"

export default function ProcessRatesPage() {
    const { toast } = useToast()
    const queryClient = useQueryClient()
    const [isCreateOpen, setIsCreateOpen] = useState(false)
    const [newRate, setNewRate] = useState<Partial<ProcessCostRate>>({
        power_cost_per_hour: "0",
        labor_cost_per_hour: "0",
        overhead_cost_per_hour: "0"
    })

    // Data Fetching
    const { data: rates, isLoading: isRatesLoading } = useQuery({
        queryKey: ["process-rates"],
        queryFn: costingService.getProcessRates
    })

    const { data: processes } = useQuery({
        queryKey: ["processes"],
        queryFn: factoryService.getProcesses
    })

    const { data: machines } = useQuery({
        queryKey: ["machines"],
        queryFn: factoryService.getMachines
    })

    // Mutations
    const updateMutation = useMutation({
        mutationFn: ({ id, data }: { id: string, data: Partial<ProcessCostRate> }) =>
            costingService.updateProcessRate(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["process-rates"] })
            toast({ title: "Rate Updated", description: "The cost rate override has been saved." })
        },
        onError: () => {
            toast({ variant: "destructive", title: "Update Failed", description: "Could not save the new rate." })
        }
    })

    const createMutation = useMutation({
        mutationFn: (data: Partial<ProcessCostRate>) => costingService.createProcessRate(data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["process-rates"] })
            setIsCreateOpen(false)
            setNewRate({ power_cost_per_hour: "0", labor_cost_per_hour: "0", overhead_cost_per_hour: "0" })
            toast({ title: "Override Created", description: "New operational rate has been added to the engine." })
        },
        onError: (err: any) => {
            toast({
                variant: "destructive",
                title: "Creation Failed",
                description: err.response?.data?.error || "Error creating rate override."
            })
        }
    })

    const handleSave = (rate: ProcessCostRate) => {
        updateMutation.mutate({
            id: rate.id,
            data: {
                power_cost_per_hour: rate.power_cost_per_hour,
                labor_cost_per_hour: rate.labor_cost_per_hour,
                overhead_cost_per_hour: rate.overhead_cost_per_hour
            }
        })
    }

    if (isRatesLoading) {
        return (
            <div className="flex h-[80vh] items-center justify-center bg-[#f8fafc]">
                <div className="text-center space-y-4">
                    <Loader2 className="h-12 w-12 animate-spin text-blue-600 mx-auto" />
                    <p className="text-sm font-black uppercase tracking-[0.2em] text-slate-400 italic">Syncing Process Economics...</p>
                </div>
            </div>
        )
    }

    return (
        <div className="p-6 lg:p-10 space-y-10 bg-[#f8fafc] min-h-screen">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                <div className="space-y-1">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 border border-blue-100 text-blue-600 text-[10px] font-black uppercase tracking-widest shadow-sm">
                        <Activity className="h-3 w-3 fill-blue-600" /> Operational Finance
                    </div>
                    <h1 className="text-4xl font-black tracking-tight text-slate-900 flex items-center gap-3 italic">
                        Process <span className="text-blue-600">Rates</span>
                    </h1>
                    <p className="text-slate-500 font-medium text-sm flex items-center gap-2">
                        Configure baseline hourly costs for each factory stage <ChevronRight className="h-3 w-3" /> Machine & Process Level
                    </p>
                </div>

                <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                    <DialogTrigger asChild>
                        <Button className="h-12 px-8 rounded-xl bg-slate-900 hover:bg-blue-600 text-white font-black uppercase text-xs tracking-[0.2em] shadow-xl shadow-slate-200 active:scale-95 transition-all group">
                            <Plus className="h-4 w-4 mr-2" /> New Override
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-md bg-white rounded-[2rem] border-none shadow-2xl p-0 overflow-hidden">
                        <DialogHeader className="bg-slate-900 p-8 text-white">
                            <DialogTitle className="text-sm font-black uppercase tracking-[0.2em] italic">Add Operational Override</DialogTitle>
                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">Define hourly spending for process/machine</p>
                        </DialogHeader>
                        <div className="p-8 space-y-6">
                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Target Process</Label>
                                    <Select onValueChange={(val) => setNewRate({ ...newRate, process: val })}>
                                        <SelectTrigger className="h-11 rounded-xl border-slate-100 bg-slate-50 font-bold">
                                            <SelectValue placeholder="Select Process" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {processes?.map((p) => (
                                                <SelectItem key={p.id} value={p.id}>{p.name} ({p.code})</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Specific Machine (Optional)</Label>
                                    <Select onValueChange={(val) => setNewRate({ ...newRate, machine: val })}>
                                        <SelectTrigger className="h-11 rounded-xl border-slate-100 bg-slate-50 font-bold">
                                            <SelectValue placeholder="All Machines" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="null">General Process Rate</SelectItem>
                                            {machines?.map((m) => (
                                                <SelectItem key={m.id} value={m.id}>{m.name} ({m.code})</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="grid grid-cols-3 gap-4">
                                    <div className="space-y-2">
                                        <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Power/hr</Label>
                                        <Input
                                            type="number"
                                            value={newRate.power_cost_per_hour}
                                            onChange={(e) => setNewRate({ ...newRate, power_cost_per_hour: e.target.value })}
                                            className="h-11 rounded-xl border-slate-100 bg-slate-50 font-black tabular-nums"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Labor/hr</Label>
                                        <Input
                                            type="number"
                                            value={newRate.labor_cost_per_hour}
                                            onChange={(e) => setNewRate({ ...newRate, labor_cost_per_hour: e.target.value })}
                                            className="h-11 rounded-xl border-slate-100 bg-slate-50 font-black tabular-nums"
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Overhead/hr</Label>
                                        <Input
                                            type="number"
                                            value={newRate.overhead_cost_per_hour}
                                            onChange={(e) => setNewRate({ ...newRate, overhead_cost_per_hour: e.target.value })}
                                            className="h-11 rounded-xl border-slate-100 bg-slate-50 font-black tabular-nums"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                        <DialogFooter className="bg-slate-50 p-6">
                            <Button
                                onClick={() => {
                                    const payload = { ...newRate };
                                    if (payload.machine === "null") payload.machine = null as any;
                                    createMutation.mutate(payload);
                                }}
                                disabled={createMutation.isPending || !newRate.process}
                                className="w-full h-12 rounded-xl bg-slate-900 hover:bg-blue-600 text-white font-black uppercase text-[11px] tracking-[0.2em] shadow-lg"
                            >
                                {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Registry Override"}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>

            {/* Matrix Card */}
            <Card className="border-none shadow-xl rounded-[2.5rem] overflow-hidden bg-white">
                <CardHeader className="bg-slate-900 text-white p-8 flex flex-row items-center justify-between">
                    <div className="space-y-1">
                        <CardTitle className="text-sm font-black uppercase tracking-[0.2em] flex items-center gap-3">
                            <Building className="h-4 w-4 text-blue-400" />
                            Master Process Rate Matrix
                        </CardTitle>
                        <p className="text-[10px] font-bold text-slate-500 uppercase italic tracking-widest">These rates drive the deterministic costing engine</p>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader className="bg-slate-50">
                            <TableRow className="border-none hover:bg-transparent">
                                <TableHead className="text-[10px] font-black uppercase text-slate-400 py-6 px-8 italic">Process / Machine</TableHead>
                                <TableHead className="text-[10px] font-black uppercase text-slate-400 py-6 italic text-center"><Zap className="h-3 w-3 inline mr-1" /> Power /hr</TableHead>
                                <TableHead className="text-[10px] font-black uppercase text-slate-400 py-6 italic text-center"><Users className="h-3 w-3 inline mr-1" /> Labor /hr</TableHead>
                                <TableHead className="text-[10px] font-black uppercase text-slate-400 py-6 italic text-center"><Building className="h-3 w-3 inline mr-1" /> Overhead /hr</TableHead>
                                <TableHead className="text-[10px] font-black uppercase text-slate-400 py-6 italic text-right">Total ₹/HR</TableHead>
                                <TableHead className="text-right px-8"></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {rates?.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={6} className="h-60 text-center">
                                        <div className="flex flex-col items-center justify-center space-y-3 opacity-30 select-none">
                                            <Info className="h-12 w-12 text-slate-400" />
                                            <p className="font-black uppercase tracking-[0.2em] text-xs">No process rates configured. The engine will use system defaults.</p>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            )}
                            {rates?.map((rate) => (
                                <TableRow key={rate.id} className="hover:bg-slate-50/50 transition-colors border-b border-slate-50 last:border-none group">
                                    <TableCell className="py-8 px-8">
                                        <div className="flex flex-col">
                                            <span className="font-black text-slate-900 uppercase tracking-tight text-sm italic">{rate.process_name}</span>
                                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mt-1">
                                                {rate.machine_name ? `Machine: ${rate.machine_name} ` : "Generic Process Override"}
                                            </span>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex justify-center">
                                            <Input
                                                type="number"
                                                value={rate.power_cost_per_hour}
                                                className="w-20 h-9 rounded-lg border-slate-100 bg-white font-black text-center text-xs tabular-nums"
                                                onChange={(e) => {
                                                    const updatedRates = queryClient.getQueryData<ProcessCostRate[]>(["process-rates"]) || []
                                                    queryClient.setQueryData(["process-rates"], updatedRates.map(r => r.id === rate.id ? { ...r, power_cost_per_hour: e.target.value } : r))
                                                }}
                                            />
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex justify-center">
                                            <Input
                                                type="number"
                                                value={rate.labor_cost_per_hour}
                                                className="w-20 h-9 rounded-lg border-slate-100 bg-white font-black text-center text-xs tabular-nums"
                                                onChange={(e) => {
                                                    const updatedRates = queryClient.getQueryData<ProcessCostRate[]>(["process-rates"]) || []
                                                    queryClient.setQueryData(["process-rates"], updatedRates.map(r => r.id === rate.id ? { ...r, labor_cost_per_hour: e.target.value } : r))
                                                }}
                                            />
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex justify-center">
                                            <Input
                                                type="number"
                                                value={rate.overhead_cost_per_hour}
                                                className="w-20 h-9 rounded-lg border-slate-100 bg-white font-black text-center text-xs tabular-nums"
                                                onChange={(e) => {
                                                    const updatedRates = queryClient.getQueryData<ProcessCostRate[]>(["process-rates"]) || []
                                                    queryClient.setQueryData(["process-rates"], updatedRates.map(r => r.id === rate.id ? { ...r, overhead_cost_per_hour: e.target.value } : r))
                                                }}
                                            />
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-right font-black text-slate-900 tabular-nums italic">
                                        ₹{Math.round(Number(rate.cost_per_hour)).toLocaleString()}
                                    </TableCell>
                                    <TableCell className="text-right px-8">
                                        <Button
                                            size="sm"
                                            variant="ghost"
                                            onClick={() => handleSave(rate)}
                                            className="h-9 w-9 p-0 rounded-xl hover:bg-emerald-50 hover:text-emerald-600 border border-transparent hover:border-emerald-100"
                                        >
                                            <Save className="h-4 w-4" />
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            {/* Explainer / Logic Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                {[
                    { title: "Power Consumption", icon: Zap, color: "text-amber-500", bg: "bg-amber-50/30", border: "border-amber-100", desc: "Electricity rates for machinery (₹/hr). Typically drives 30-50% of conversion costs." },
                    { title: "Labor Allocation", icon: Users, color: "text-blue-500", bg: "bg-blue-50/30", border: "border-blue-100", desc: "Weighted average salary per operator divided by shift hours. Includes benefits & ESIC." },
                    { title: "Fixed Overheads", icon: Building, color: "text-slate-400", bg: "bg-slate-50/50", border: "border-slate-100", desc: "Amortized plant rent, maintenance, and administrative allocation. Updated quarterly." }
                ].map((item, i) => (
                    <Card key={i} className={cn("border-none shadow-md rounded-[2.5rem] p-8", item.bg, "border", item.border)}>
                        <item.icon className={cn("h-6 w-6 mb-4", item.color)} />
                        <h4 className="font-black text-slate-900 text-xs uppercase tracking-widest mb-2">{item.title}</h4>
                        <p className="text-[10px] font-medium text-slate-500 leading-relaxed italic opacity-80">{item.desc}</p>
                    </Card>
                ))}
            </div>
        </div>
    )
}

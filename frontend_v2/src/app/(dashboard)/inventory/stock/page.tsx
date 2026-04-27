"use client"

import { useState, useEffect } from "react"
import { useQuery } from "@tanstack/react-query"
import { Loader2, Search, Filter, History, Box, Activity, Zap, ShieldCheck, Globe, Database } from "lucide-react"
import { cn } from "@/lib/utils"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table"
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { StatusBadge } from "@/components/ui-custom/status-badge"

import { inventoryService } from "@/services/inventory"
import { factoryService, Plant } from "@/services/factory"

export default function StockPage() {
    const [selectedPlant, setSelectedPlant] = useState<string>("")
    const [searchTerm, setSearchTerm] = useState("")

    const { data: plants } = useQuery<Plant[]>({
        queryKey: ['plants'],
        queryFn: factoryService.getPlants,
    })

    useEffect(() => {
        if (plants && plants.length > 0 && !selectedPlant) {
            setSelectedPlant(plants[0].id)
        }
    }, [plants, selectedPlant])

    const { data: bulkStock, isLoading: loadingBulk } = useQuery({
        queryKey: ['stock', 'bulk', selectedPlant],
        queryFn: () => inventoryService.getBulkStock(selectedPlant),
        enabled: !!selectedPlant
    })

    const { data: rollStock, isLoading: loadingRolls } = useQuery({
        queryKey: ['stock', 'rolls', selectedPlant],
        queryFn: () => inventoryService.getRollStock(selectedPlant),
        enabled: !!selectedPlant
    })

    const filteredBulk = (bulkStock || []).filter(item =>
        item.material_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.material_code.toLowerCase().includes(searchTerm.toLowerCase())
    )

    const filteredRolls = (rollStock || []).filter(roll =>
        roll.label_id.toLowerCase().includes(searchTerm.toLowerCase()) ||
        roll.material_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        roll.batch_no.toLowerCase().includes(searchTerm.toLowerCase())
    )

    return (
        <div className="p-8 lg:p-12 space-y-10 bg-[#f8fafc] min-h-screen">
            {/* Header Section */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                <div className="space-y-1">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 border border-blue-100 text-blue-600 text-[10px] font-black uppercase tracking-widest shadow-sm translate-y-[-4px]">
                        <Database className="h-3 w-3" /> Asset Repository
                    </div>
                    <h1 className="text-4xl font-black tracking-tight text-slate-900 flex items-center gap-3">
                        Inventory
                        <span className="text-slate-300 font-light translate-y-[2px]">/</span>
                        <span className="text-blue-600 italic">Stock</span>
                    </h1>
                    <p className="text-slate-500 font-medium text-sm flex items-center gap-2">
                        Real-time audit of global enterprise physical holdings <Activity className="h-3.5 w-3.5 text-blue-400" />
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <Select value={selectedPlant} onValueChange={setSelectedPlant}>
                        <SelectTrigger className="h-12 w-[240px] rounded-xl border-slate-200 bg-white font-black uppercase text-[10px] tracking-widest text-slate-600 shadow-sm transition-all focus:ring-2 focus:ring-blue-100">
                            <SelectValue placeholder="SELECT JURISDICTION" />
                        </SelectTrigger>
                        <SelectContent className="rounded-xl border-slate-100 shadow-2xl">
                            {(plants || []).map((p: any) => (
                                <SelectItem key={p.id} value={p.id} className="text-[10px] font-black uppercase tracking-widest">{p.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>

            {/* Filtering Controls */}
            <div className="flex flex-col md:flex-row items-center gap-4 bg-white/50 backdrop-blur-md p-4 rounded-[2rem] border border-white shadow-sm">
                <div className="relative flex-1 group">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 group-focus-within:text-blue-500 transition-colors" />
                    <Input
                        placeholder="SEARCH PROTOCOL, BATCH, OR MATERIAL IDENTITY..."
                        className="h-12 pl-12 pr-4 rounded-2xl border-none bg-slate-100/50 hover:bg-slate-100 focus:bg-white transition-all font-black text-[10px] tracking-widest placeholder:text-slate-400 placeholder:italic"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                <Button variant="outline" className="h-12 px-6 rounded-2xl bg-white border-slate-200 font-black uppercase text-[10px] tracking-widest text-slate-600 hover:bg-slate-50 active-scale">
                    <Filter className="h-4 w-4 mr-2 text-blue-500" /> Advanced Filter
                </Button>
            </div>

            <Tabs defaultValue="rolls" className="w-full space-y-8">
                <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                    <TabsList className="bg-slate-100/50 p-1 rounded-2xl border border-slate-200/50">
                        <TabsTrigger value="rolls" className="rounded-xl px-8 py-2.5 text-[10px] font-black uppercase tracking-widest data-[state=active]:bg-white data-[state=active]:text-blue-600 data-[state=active]:shadow-premium transition-all">
                            Kinetic Rolls ({filteredRolls.length})
                        </TabsTrigger>
                        <TabsTrigger value="bulk" className="rounded-xl px-8 py-2.5 text-[10px] font-black uppercase tracking-widest data-[state=active]:bg-white data-[state=active]:text-blue-600 data-[state=active]:shadow-premium transition-all">
                            Bulk Reserves ({filteredBulk.length})
                        </TabsTrigger>
                    </TabsList>
                </div>

                <TabsContent value="rolls" className="outline-none">
                    <Card className="border-none shadow-premium rounded-[2.5rem] overflow-hidden bg-white/70 backdrop-blur-md">
                        <CardHeader className="p-8 pb-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 italic">Physical Assets</h3>
                                    <CardTitle className="text-2xl font-black tracking-tight text-slate-900 mt-1">Roll Inventory Ledger</CardTitle>
                                </div>
                                <Zap className="h-8 w-8 text-blue-500/20" />
                            </div>
                        </CardHeader>
                        <CardContent className="p-0">
                            {loadingRolls ? (
                                <div className="py-20 flex flex-col items-center justify-center space-y-4">
                                    <Loader2 className="h-10 w-10 animate-spin text-blue-600" />
                                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Syncing Assets...</p>
                                </div>
                            ) : (
                                <div className="overflow-x-auto scrollbar-hide px-4 pb-8">
                                    <Table>
                                        <TableHeader>
                                            <TableRow className="hover:bg-transparent border-slate-50">
                                                <TableHead className="text-[10px] font-black uppercase tracking-widest text-slate-400 italic px-6">Label Authority</TableHead>
                                                <TableHead className="text-[10px] font-black uppercase tracking-widest text-slate-400 italic">Material Topology</TableHead>
                                                <TableHead className="text-[10px] font-black uppercase tracking-widest text-slate-400 italic">Thickness</TableHead>
                                                <TableHead className="text-[10px] font-black uppercase tracking-widest text-slate-400 italic">Width</TableHead>
                                                <TableHead className="text-[10px] font-black uppercase tracking-widest text-slate-400 italic">Net Weight</TableHead>
                                                <TableHead className="text-[10px] font-black uppercase tracking-widest text-slate-400 italic">Stage</TableHead>
                                                <TableHead className="text-[10px] font-black uppercase tracking-widest text-slate-400 italic">Position</TableHead>
                                                <TableHead className="text-[10px] font-black uppercase tracking-widest text-slate-400 italic text-right px-6">State</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {filteredRolls.map((roll) => (
                                                <TableRow key={roll.id} className="group border-slate-50/50 hover:bg-slate-50/50 transition-colors">
                                                    <TableCell className="px-6 py-4">
                                                        <span className="font-black text-slate-900 text-sm tracking-tight font-mono group-hover:text-blue-600 transition-colors">{roll.label_id}</span>
                                                    </TableCell>
                                                    <TableCell className="py-4">
                                                        <div className="flex flex-col">
                                                            <span className="text-sm font-black text-slate-700 uppercase tracking-tight">{roll.material_name}</span>
                                                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter italic">{roll.material_code}</span>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="py-4">
                                                        <span className="text-xs font-black text-slate-900">{roll.thickness_micron}<span className="text-[9px] text-slate-400 ml-1">µm</span></span>
                                                    </TableCell>
                                                    <TableCell className="py-4"><span className="text-xs font-black text-slate-900">{roll.width_mm}<span className="text-[9px] text-slate-400 ml-1">MM</span></span></TableCell>
                                                    <TableCell className="py-4"><span className="text-sm font-black text-blue-600 italic">{roll.weight_kg?.toFixed(2)}<span className="text-[10px] ml-1">KG</span></span></TableCell>
                                                    <TableCell className="py-4">
                                                        <Badge variant="outline" className="text-[9px] font-black uppercase tracking-widest border-slate-200">
                                                            {roll.stage_name || `Stage ${roll.stage_index}`}
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell className="py-4">
                                                        <div className="flex items-center gap-2">
                                                            <Globe className="h-3 w-3 text-slate-300" />
                                                            <span className="text-[10px] font-black uppercase text-slate-500">{roll.location_name}</span>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="px-6 py-4 text-right">
                                                        <div className={cn(
                                                            "inline-flex items-center rounded-xl px-3 py-1 text-[9px] font-black uppercase tracking-widest border transition-all",
                                                            roll.status === 'AVAILABLE' ? "bg-emerald-50 text-emerald-600 border-emerald-100" : "bg-amber-50 text-amber-600 border-amber-100"
                                                        )}>
                                                            {roll.status}
                                                        </div>
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                            {filteredRolls.length === 0 && (
                                                <TableRow><TableCell colSpan={7} className="text-center py-20 bg-slate-50/30 rounded-[2rem] border-2 border-dashed border-slate-200">
                                                    <Box className="h-10 w-10 text-slate-200 mx-auto mb-3" />
                                                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-300 italic">No Kinetic Assets Detected</p>
                                                </TableCell></TableRow>
                                            )}
                                        </TableBody>
                                    </Table>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="bulk" className="outline-none">
                    <Card className="border-none shadow-premium rounded-[2.5rem] overflow-hidden bg-white/70 backdrop-blur-md">
                        <CardHeader className="p-8 pb-4">
                            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 italic">Raw Reserves</h3>
                            <CardTitle className="text-2xl font-black tracking-tight text-slate-900 mt-1">Bulk Material Matrix</CardTitle>
                        </CardHeader>
                        <CardContent className="p-0">
                            {loadingBulk ? (
                                <div className="py-20 flex flex-col items-center justify-center space-y-4">
                                    <Loader2 className="h-10 w-10 animate-spin text-blue-600" />
                                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Syncing Reserves...</p>
                                </div>
                            ) : (
                                <div className="overflow-x-auto scrollbar-hide px-4 pb-8">
                                    <Table>
                                        <TableHeader>
                                            <TableRow className="hover:bg-transparent border-slate-50">
                                                <TableHead className="text-[10px] font-black uppercase tracking-widest text-slate-400 italic px-6">Material Resonance</TableHead>
                                                <TableHead className="text-[10px] font-black uppercase tracking-widest text-slate-400 italic">Hold Area</TableHead>
                                                <TableHead className="text-[10px] font-black uppercase tracking-widest text-slate-400 italic text-right">Available Quantum</TableHead>
                                                <TableHead className="text-[10px] font-black uppercase tracking-widest text-slate-400 italic">Unit</TableHead>
                                                <TableHead className="text-[10px] font-black uppercase tracking-widest text-slate-400 italic text-right px-6">Lineage</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {filteredBulk.map((item, idx) => (
                                                <TableRow key={idx} className="group border-slate-50/50 hover:bg-slate-50/50 transition-colors">
                                                    <TableCell className="px-6 py-4">
                                                        <div className="flex flex-col">
                                                            <span className="text-sm font-black text-slate-700 uppercase tracking-tight group-hover:text-blue-600 transition-colors">{item.material_name}</span>
                                                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter italic">{item.material_code}</span>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="py-4">
                                                        <div className="flex items-center gap-2">
                                                            <Globe className="h-3 w-3 text-slate-300" />
                                                            <span className="text-[10px] font-black uppercase text-slate-500">{item.location_name}</span>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="py-4 text-right">
                                                        <span className="text-sm font-black text-blue-600 italic tracking-tighter">{Number(item.quantity ?? item.qty_kg ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                                    </TableCell>
                                                    <TableCell className="py-4">
                                                        <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest">{item.uom || "KG"}</span>
                                                    </TableCell>
                                                    <TableCell className="px-6 py-4 text-right">
                                                        <Button variant="ghost" size="sm" className="h-8 w-8 rounded-xl hover:bg-slate-900 hover:text-white transition-all active-scale">
                                                            <History className="h-3.5 w-3.5" />
                                                        </Button>
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                            {filteredBulk.length === 0 && (
                                                <TableRow><TableCell colSpan={5} className="text-center py-20 bg-slate-50/30 rounded-[2rem] border-2 border-dashed border-slate-200">
                                                    <Box className="h-10 w-10 text-slate-200 mx-auto mb-3" />
                                                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-300 italic">No Bulk Reserves Detected</p>
                                                </TableCell></TableRow>
                                            )}
                                        </TableBody>
                                    </Table>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    )
}

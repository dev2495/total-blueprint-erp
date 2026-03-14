"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { logisticsService, SODispatchSummary, DeliveryChallan } from "@/services/logistics"
import { salesService, SalesOrder } from "@/services/sales"
import { useToast } from "@/hooks/use-toast"
import { Truck, Plus, Send, FileText, Search, Package, CheckCircle2, AlertCircle, Activity, ArrowRight, ShieldCheck, MapPin, Printer } from "lucide-react"
import { cn } from "@/lib/utils"

export default function DispatchPage() {
    const { toast } = useToast()
    const [salesOrders, setSalesOrders] = useState<SalesOrder[]>([])
    const [selectedSOId, setSelectedSOId] = useState<string | null>(null)
    const [summary, setSummary] = useState<SODispatchSummary | null>(null)
    const [challans, setChallans] = useState<DeliveryChallan[]>([])
    const [loading, setLoading] = useState(true)
    const [loadingSummary, setLoadingSummary] = useState(false)

    // Selection State
    const [selectedRolls, setSelectedRolls] = useState<Set<string>>(new Set())
    const [selectedGonnies, setSelectedGonnies] = useState<Set<string>>(new Set())
    const [packDialogOpen, setPackDialogOpen] = useState(false)
    const [packTargetRoll, setPackTargetRoll] = useState<any | null>(null)
    const [packLines, setPackLines] = useState<Array<{ material_id: string; qty: number; uom?: string; basis?: string }>>([])

    // Create Challan Dialog
    const [createDialogOpen, setCreateDialogOpen] = useState(false)
    const [vehicleNo, setVehicleNo] = useState("")
    const [driverName, setDriverName] = useState("")
    const [driverPhone, setDriverPhone] = useState("")

    const fetchData = async () => {
        try {
            setLoading(true)
            const [soData, challanData] = await Promise.all([
                logisticsService.getSalesOrdersWithFG(),
                logisticsService.getChallans()
            ])
            setSalesOrders(soData as any)
            setChallans(challanData)
        } catch (error) {
            toast({ title: "Error", description: "Failed to load SO data", variant: "destructive" })
        } finally {
            setLoading(false)
        }
    }

    const fetchSOSummary = async (soId: string) => {
        try {
            setLoadingSummary(true)
            const data = await logisticsService.getSODispatchableItems(soId)
            setSummary(data)
            setSelectedRolls(new Set())
            setSelectedGonnies(new Set())
        } catch (error) {
            toast({ title: "Error", description: "Failed to load SO summary", variant: "destructive" })
        } finally {
            setLoadingSummary(false)
        }
    }

    useEffect(() => {
        fetchData()
    }, [])

    useEffect(() => {
        if (selectedSOId) {
            fetchSOSummary(selectedSOId)
        } else {
            setSummary(null)
        }
    }, [selectedSOId])

    const toggleRoll = (roll: any) => {
        if (!roll?.packed_for_dispatch) {
            toast({ title: "Roll not packed", description: `Pack roll ${roll?.label_id || ""} before dispatch selection.`, variant: "destructive" })
            return
        }
        const newSet = new Set(selectedRolls)
        if (newSet.has(roll.id)) {
            newSet.delete(roll.id)
        } else {
            newSet.add(roll.id)
        }
        setSelectedRolls(newSet)
    }

    const toggleGonny = (id: string) => {
        const newSet = new Set(selectedGonnies)
        if (newSet.has(id)) {
            newSet.delete(id)
        } else {
            newSet.add(id)
        }
        setSelectedGonnies(newSet)
    }

    const handleCreateChallan = async () => {
        if (!summary) return

        if (selectedRolls.size === 0 && selectedGonnies.size === 0) {
            toast({ title: "Error", description: "Select at least one item to dispatch", variant: "destructive" })
            return
        }

        const unpackedSelected = summary.rolls.filter((r) => selectedRolls.has(r.id) && !r.packed_for_dispatch)
        if (unpackedSelected.length > 0) {
            toast({
                title: "Roll packing required",
                description: `Pack ${unpackedSelected[0].label_id} before creating challan.`,
                variant: "destructive",
            })
            return
        }

        let plantId = ""
        if (selectedRolls.size > 0) {
            const firstRollId = Array.from(selectedRolls)[0]
            plantId = summary.rolls.find(r => r.id === firstRollId)?.location.plant_id || ""
        } else if (selectedGonnies.size > 0) {
            const firstGonnyId = Array.from(selectedGonnies)[0]
            plantId = summary.gonnies.find(g => g.id === firstGonnyId)?.location.plant_id || ""
        }

        try {
            const result = await logisticsService.createChallan({
                customer_name: summary.sales_order.customer_name,
                plant_id: plantId,
                sales_order_id: summary.sales_order.id,
                vehicle_no: vehicleNo,
                driver_name: driverName,
                driver_phone: driverPhone,
                roll_ids: Array.from(selectedRolls),
                gonny_ids: Array.from(selectedGonnies)
            })
            toast({ title: "Challan Created", description: result.message })
            setCreateDialogOpen(false)
            setVehicleNo("")
            setDriverName("")
            setDriverPhone("")
            setSelectedRolls(new Set())
            setSelectedGonnies(new Set())
            fetchData()
            if (selectedSOId) fetchSOSummary(selectedSOId)
        } catch (error: any) {
            toast({ title: "Error", description: error.response?.data?.error || "Failed to create challan", variant: "destructive" })
        }
    }

    const handleDispatch = async (challanId: string) => {
        try {
            const result = await logisticsService.dispatchChallan(challanId)
            toast({ title: "Dispatched", description: result.message })
            fetchData()
            if (selectedSOId) fetchSOSummary(selectedSOId)
        } catch (error: any) {
            toast({ title: "Error", description: error.response?.data?.error || "Failed to dispatch", variant: "destructive" })
        }
    }

    const handlePrintList = (challanId: string) => {
        if (typeof window === "undefined") return
        window.open(logisticsService.getChallanPrintUrl(challanId), "_blank", "noopener,noreferrer")
    }

    const openPackDialog = (roll: any) => {
        setPackTargetRoll(roll)
        setPackLines((roll.default_pack_lines || []).map((line: any) => ({
            material_id: String(line.material_id || ""),
            qty: Number(line.qty || 0),
            uom: String(line.uom || "PCS").toUpperCase(),
            basis: String(line.basis || "PER_ROLL").toUpperCase(),
        })))
        setPackDialogOpen(true)
    }

    const handlePackRoll = async () => {
        if (!packTargetRoll) return
        try {
            const lines = (packLines || []).filter((line) => line.material_id && Number(line.qty) > 0)
            if (!lines.length) {
                toast({
                    title: "Pack lines required",
                    description: "Add at least one packaging line with material and qty > 0.",
                    variant: "destructive",
                })
                return
            }
            await logisticsService.packRoll(packTargetRoll.id, lines)
            toast({ title: "Roll packed", description: `${packTargetRoll.label_id} is packed for dispatch.` })
            setPackDialogOpen(false)
            setPackTargetRoll(null)
            if (selectedSOId) fetchSOSummary(selectedSOId)
        } catch (error: any) {
            toast({ title: "Pack failed", description: error.response?.data?.error || "Could not pack roll", variant: "destructive" })
        }
    }

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'DRAFT': return <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">Draft</Badge>
            case 'DISPATCHED': return <Badge className="bg-indigo-50 text-indigo-700 border-indigo-200 drop-shadow-sm transition-all hover:bg-indigo-100">Dispatched</Badge>
            case 'IN_TRANSIT': return <Badge className="bg-purple-50 text-purple-700 border-purple-200 drop-shadow-sm transition-all hover:bg-purple-100">In Transit</Badge>
            case 'RECEIVED': return <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 drop-shadow-sm">Received</Badge>
            default: return <Badge variant="secondary">{status}</Badge>
        }
    }

    if (loading) {
        return (
            <div className="flex h-[calc(100vh-4rem)] items-center justify-center bg-slate-50/50">
                <div className="text-center space-y-4">
                    <Activity className="h-8 w-8 animate-pulse text-indigo-500 mx-auto" strokeWidth={1.5} />
                    <p className="text-sm font-medium text-slate-400">Loading Dispatch Protocols...</p>
                </div>
            </div>
        )
    }

    const selectedCount = selectedRolls.size + selectedGonnies.size

    return (
        <div className="p-6 lg:p-8 space-y-8 min-h-screen" data-testid="dispatch-page">
            {/* Header Section */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                <div className="space-y-1">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-50 border border-indigo-100 text-indigo-600 text-[10px] font-bold uppercase tracking-widest shadow-sm translate-y-[-4px]">
                        <Truck className="h-4 w-4" strokeWidth={1.5} /> Active Terminal
                    </div>
                    <h1 className="text-3xl font-black tracking-tight text-slate-900 flex items-center gap-2">
                        Dispatch Bay
                    </h1>
                    <p className="text-slate-500 text-sm">
                        Select an open sales order to initialize the shipping and challan creation workflow.
                    </p>
                </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 lg:gap-8">
                {/* Protocol Selection Column */}
                <div className="xl:col-span-4 space-y-6">
                    <Card className="border-0 shadow-sm ring-1 ring-slate-100 rounded-[1.5rem] bg-white overflow-visible relative">
                        <CardHeader className="p-6 pb-4 border-b border-slate-50">
                            <h3 className="text-[10px] font-bold uppercase tracking-widest text-indigo-400 mb-1">Step 1</h3>
                            <CardTitle className="text-lg font-black text-slate-900 flex items-center gap-2">
                                <Search className="h-4 w-4 text-indigo-500" strokeWidth={2.5} />
                                Target Sales Order
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-6 pt-5">
                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <Label className="text-xs font-semibold text-slate-600">Fulfillment Target</Label>
                                    <Select onValueChange={setSelectedSOId} value={selectedSOId || ""}>
                                        <SelectTrigger data-testid="dispatch-sales-order-select" className="h-11 font-medium bg-slate-50 border border-slate-200 rounded-xl px-4 focus:ring-1 focus:ring-indigo-500 transition-all text-sm">
                                            <SelectValue placeholder={salesOrders.length === 0 ? "No FG in Inventory" : "Select an order..."} />
                                        </SelectTrigger>
                                        <SelectContent className="rounded-xl border border-slate-200 shadow-xl">
                                            {salesOrders.length === 0 ? (
                                                <div className="p-4 text-xs font-medium text-slate-400 text-center">Nothing pending dispatch</div>
                                            ) : (
                                                salesOrders.map(so => (
                                                    <SelectItem key={so.id} value={so.id} className="font-medium text-sm py-3">
                                                        <span className="font-bold">{so.order_number}</span> — {so.customer_name}
                                                    </SelectItem>
                                                ))
                                            )}
                                        </SelectContent>
                                    </Select>
                                </div>

                                {!selectedSOId && (
                                    <div className="flex flex-col items-center justify-center py-8 text-slate-400 border border-dashed border-slate-200 rounded-xl bg-slate-50/50">
                                        <Package className="w-8 h-8 mb-2 opacity-50" strokeWidth={1.5} />
                                        <p className="text-xs font-medium">Waiting for target selection.</p>
                                    </div>
                                )}
                            </div>
                        </CardContent>
                    </Card>

                    {summary && (
                        <Card className="border-0 shadow-sm ring-1 ring-slate-100 rounded-[1.5rem] bg-white overflow-hidden relative">
                            <CardHeader className="p-6 pb-4 border-b border-slate-50">
                                <CardTitle className="text-[13px] font-bold uppercase tracking-widest flex items-center gap-2 text-slate-500">
                                    <Activity className="h-4 w-4 text-indigo-500" strokeWidth={2.5} />
                                    Order Fulfillment Metrics
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="p-6">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="flex flex-col">
                                        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Ordered Demand</span>
                                        <span className="text-2xl font-black text-slate-900 mt-1">{summary.ordered_qty.toLocaleString()} <span className="text-xs font-medium text-slate-500">PCS</span></span>
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="text-xs font-semibold text-emerald-600 uppercase tracking-wider">Ready (Sealed)</span>
                                        <span className="text-2xl font-black text-emerald-700 mt-1">{summary.available_for_dispatch.gonnies_pcs.toLocaleString()} <span className="text-xs font-medium text-emerald-600/70">PCS</span></span>
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="text-xs font-semibold text-indigo-600 uppercase tracking-wider">Already in Transit</span>
                                        <span className="text-2xl font-black text-indigo-700 mt-1">{summary.dispatched_qty.gonnies_pcs.toLocaleString()} <span className="text-xs font-medium text-indigo-600/70">PCS</span></span>
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="text-xs font-semibold text-amber-600 uppercase tracking-wider">Pending Packing</span>
                                        <span className="text-2xl font-black text-amber-700 mt-1">{Number(summary.packing_pending?.unpacked_batch_pcs || 0).toLocaleString()} <span className="text-xs font-medium text-amber-600/70">PCS</span></span>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    )}
                </div>

                {/* Live Inventory List */}
                <div className="xl:col-span-8 space-y-6">
                    {summary ? (
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            {/* Available Rolls Grid Component */}
                            <Card className="border-0 shadow-sm ring-1 ring-slate-100 rounded-[1.5rem] bg-white overflow-hidden flex flex-col h-[500px]">
                                <CardHeader className="p-5 pb-4 flex flex-row items-center justify-between border-b border-slate-50 bg-slate-50/30">
                                    <div>
                                        <CardTitle className="text-[14px] font-bold uppercase tracking-widest text-slate-600 flex items-center gap-2">
                                            <CheckCircle2 className="h-4 w-4 text-emerald-500" strokeWidth={2.5} />
                                            Active Finished Rolls
                                        </CardTitle>
                                    </div>
                                    <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 border-none font-bold text-[11px] uppercase tracking-wide px-2 h-6 flex items-center">
                                        {(summary.available_for_dispatch.rolls_kg || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })} KG
                                    </Badge>
                                </CardHeader>
                                <CardContent className="p-0 flex-grow h-full relative overflow-auto">
                                    {((summary.packing_pending?.open_gonnies_count || 0) > 0 || (summary.packing_pending?.unpacked_batch_pcs || 0) > 0) && (
                                        <div className="mx-4 mt-3 mb-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700 flex items-start gap-2">
                                            <AlertCircle className="h-4 w-4 mt-0.5" strokeWidth={2} />
                                            <span>
                                                {(summary.packing_pending?.open_gonnies_count || 0) > 0
                                                    ? `${summary.packing_pending?.open_gonnies_count} gonnies are currently open and must be sealed before dispatch. `
                                                    : ""}
                                                {(summary.packing_pending?.unpacked_batch_pcs || 0) > 0
                                                    ? `${Number(summary.packing_pending?.unpacked_batch_pcs || 0).toLocaleString()} unpacked batch pcs must be sealed into gonnies.`
                                                    : ""}
                                            </span>
                                        </div>
                                    )}
                                    <Table>
                                        <TableHeader className="bg-slate-50/50 sticky top-0 z-10 backdrop-blur-md">
                                            <TableRow className="border-b border-slate-100">
                                                <TableHead className="w-10 px-4"></TableHead>
                                                <TableHead className="text-[10px] uppercase tracking-widest font-bold text-slate-500">Label / Trace</TableHead>
                                                <TableHead className="text-[10px] uppercase tracking-widest font-bold text-slate-500">Status</TableHead>
                                                <TableHead className="text-right px-4 text-[10px] uppercase tracking-widest font-bold text-slate-500">Weight</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {summary.rolls.length === 0 ? (
                                                <TableRow>
                                                    <TableCell colSpan={4} className="text-center py-20 text-sm font-medium text-slate-400">
                                                        {Number(summary.packing_pending?.unpacked_batch_pcs || 0) > 0 ? "Pending packing operations." : "Zero roll stock."}
                                                    </TableCell>
                                                </TableRow>
                                            ) : (
                                                summary.rolls.map((roll) => (
                                                    <TableRow key={roll.id} className="hover:bg-slate-50/80 transition-colors border-b border-slate-100 cursor-pointer group" onClick={() => toggleRoll(roll)}>
                                                        <TableCell className="px-4" onClick={(e) => e.stopPropagation()}>
                                                            <Checkbox
                                                                data-testid={`dispatch-roll-checkbox-${roll.id}`}
                                                                checked={selectedRolls.has(roll.id)}
                                                                onCheckedChange={() => toggleRoll(roll)}
                                                                disabled={!roll.packed_for_dispatch}
                                                                className="rounded-[4px] border-slate-300 shadow-none data-[state=checked]:bg-indigo-600 data-[state=checked]:border-indigo-600"
                                                            />
                                                        </TableCell>
                                                        <TableCell className="font-mono text-xs font-bold text-slate-800">
                                                            <div className="space-y-1">
                                                                <span className="group-hover:text-indigo-600 transition-colors">{roll.label_id}</span>
                                                                <div className="flex flex-wrap items-center gap-1.5 font-sans">
                                                                    <Badge variant="secondary" className="px-1.5 py-0 text-[9px] h-4">
                                                                        {roll.width_mm}mm
                                                                    </Badge>
                                                                    <Badge variant="outline" className={`px-1.5 py-0 text-[9px] h-4 ${roll.dispatch_lineage === "STOCK_CLAIM" ? "border-indigo-200 text-indigo-700 bg-indigo-50" : ""}`}>
                                                                        {roll.dispatch_lineage || "MTO"}
                                                                    </Badge>
                                                                    {roll.source_stock_order_no && (
                                                                        <span className="text-[10px] text-slate-500 font-medium">from {roll.source_stock_order_no}</span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </TableCell>
                                                        <TableCell>
                                                            <div className="flex flex-col gap-1 items-start">
                                                                {roll.packed_for_dispatch ? (
                                                                    <Badge className="bg-emerald-50 text-emerald-700 border-none shadow-none font-medium">Packed</Badge>
                                                                ) : (
                                                                    <Badge variant="outline" className="border-amber-200 text-amber-700 bg-amber-50 shadow-none font-medium">Pending Pack</Badge>
                                                                )}
                                                                <Button size="sm" variant="ghost" data-testid={`dispatch-pack-trigger-${roll.id}`} className="h-6 w-full text-[10px] text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 px-2" onClick={(e) => { e.stopPropagation(); openPackDialog(roll); }}>
                                                                    {roll.packed_for_dispatch ? "View Pack" : "Pack"}
                                                                </Button>
                                                            </div>
                                                        </TableCell>
                                                        <TableCell className="text-right px-4">
                                                            <span className="font-bold text-slate-800">{roll.weight_kg}</span>
                                                            <span className="text-[10px] text-slate-500 font-medium ml-1">KG</span>
                                                        </TableCell>
                                                    </TableRow>
                                                ))
                                            )}
                                        </TableBody>
                                    </Table>
                                </CardContent>
                            </Card>

                            {/* Available Gonnies Component */}
                            <Card className="border-0 shadow-sm ring-1 ring-slate-100 rounded-[1.5rem] bg-white overflow-hidden flex flex-col h-[500px]">
                                <CardHeader className="p-5 pb-4 flex flex-row items-center justify-between border-b border-slate-50 bg-slate-50/30">
                                    <div>
                                        <CardTitle className="text-[14px] font-bold uppercase tracking-widest text-slate-600 flex items-center gap-2">
                                            <Package className="h-4 w-4 text-indigo-500" strokeWidth={2.5} />
                                            Packed Sealed Units
                                        </CardTitle>
                                    </div>
                                    <Badge variant="secondary" className="bg-indigo-50 text-indigo-700 border-none font-bold text-[11px] uppercase tracking-wide px-2 h-6 flex items-center">
                                        {summary.available_for_dispatch.gonnies_count} Units
                                    </Badge>
                                </CardHeader>
                                <CardContent className="p-0 flex-grow h-full relative overflow-auto">
                                    <Table>
                                        <TableHeader className="bg-slate-50/50 sticky top-0 z-10 backdrop-blur-md">
                                                <TableRow className="border-b border-slate-100">
                                                    <TableHead className="w-10 px-4"></TableHead>
                                                    <TableHead className="text-[10px] uppercase tracking-widest font-bold text-slate-500">Label ID</TableHead>
                                                    <TableHead className="text-[10px] uppercase tracking-widest font-bold text-slate-500">Content</TableHead>
                                                    <TableHead className="text-[10px] uppercase tracking-widest font-bold text-slate-500">PCS Count</TableHead>
                                                    <TableHead className="text-right px-4 text-[10px] uppercase tracking-widest font-bold text-slate-500">Weight</TableHead>
                                                </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {summary.gonnies.length === 0 ? (
                                                <TableRow>
                                                    <TableCell colSpan={5} className="text-center py-20 text-sm font-medium text-slate-400">
                                                        No sealed units waiting.
                                                    </TableCell>
                                                </TableRow>
                                            ) : (
                                                summary.gonnies.map((gonny) => (
                                                    <TableRow key={gonny.id} className="hover:bg-slate-50/80 transition-colors border-b border-slate-100 cursor-pointer group" onClick={() => toggleGonny(gonny.id)}>
                                                        <TableCell className="px-4" onClick={(e) => e.stopPropagation()}>
                                                            <Checkbox
                                                                checked={selectedGonnies.has(gonny.id)}
                                                                onCheckedChange={() => toggleGonny(gonny.id)}
                                                                className="rounded-[4px] border-slate-300 shadow-none data-[state=checked]:bg-indigo-600 data-[state=checked]:border-indigo-600"
                                                            />
                                                        </TableCell>
                                                        <TableCell className="font-mono text-xs font-bold text-slate-800 group-hover:text-indigo-600 transition-colors">{gonny.label_id}</TableCell>
                                                        <TableCell className="text-xs text-slate-600">
                                                            <div className="flex flex-col gap-1">
                                                                <Badge variant="outline" className={cn(
                                                                    "w-fit border-none shadow-none",
                                                                    gonny.content_mode === "PRIMARY_PACKS"
                                                                        ? "bg-indigo-50 text-indigo-700"
                                                                        : "bg-slate-100 text-slate-600"
                                                                )}>
                                                                    {gonny.content_mode === "PRIMARY_PACKS" ? "Primary Packs" : "Loose Pouches"}
                                                                </Badge>
                                                                {gonny.content_mode === "PRIMARY_PACKS" && Number(gonny.primary_pack_count || 0) > 0 && (
                                                                    <span className="text-[10px] font-semibold text-slate-500">{gonny.primary_pack_count} packs</span>
                                                                )}
                                                            </div>
                                                        </TableCell>
                                                        <TableCell className="text-xs font-medium text-slate-600">{gonny.qty_pcs} pcs</TableCell>
                                                        <TableCell className="text-right px-4">
                                                            <span className="font-bold text-slate-800">{gonny.weight_kg}</span>
                                                            <span className="text-[10px] text-slate-500 font-medium ml-1">KG</span>
                                                        </TableCell>
                                                    </TableRow>
                                                ))
                                            )}
                                        </TableBody>
                                    </Table>
                                </CardContent>
                            </Card>
                        </div>
                    ) : (
                        <Card className="border-0 shadow-sm ring-1 ring-slate-100 rounded-[1.5rem] bg-white overflow-hidden h-[500px] flex items-center justify-center">
                            <div className="flex flex-col items-center justify-center p-8 text-center space-y-4 max-w-sm">
                                <div className="h-20 w-20 bg-slate-50/50 rounded-full flex items-center justify-center border border-slate-100 shadow-sm">
                                    <MapPin className="h-8 w-8 text-slate-300" strokeWidth={2} />
                                </div>
                                <div className="space-y-1">
                                    <h3 className="text-lg font-bold text-slate-800 tracking-tight">Awaiting Search Protocol</h3>
                                    <p className="text-sm font-medium text-slate-500 leading-relaxed">Select a valid Sales Order from the dropdown array pane to view physical inventory ready to ship.</p>
                                </div>
                            </div>
                        </Card>
                    )}
                </div>
            </div>

            <Dialog open={packDialogOpen} onOpenChange={setPackDialogOpen}>
                <DialogContent className="max-w-2xl bg-white rounded-2xl shadow-xl border-slate-200">
                    <DialogHeader>
                        <DialogTitle>Pack Roll {packTargetRoll?.label_id || ""}</DialogTitle>
                        <DialogDescription>Attach packing materials required to properly seal this unit.</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3 max-h-[360px] overflow-auto py-2">
                        {packLines.length === 0 && (
                            <p className="text-sm text-slate-500 italic p-4 text-center border border-dashed rounded-xl">No packing lines configured. Add below.</p>
                        )}
                        {packLines.map((line, idx) => (
                            <div key={`${line.material_id}-${idx}`} className="grid grid-cols-4 gap-3 items-center">
                                <Input data-testid={idx === 0 ? "dispatch-pack-material-0" : undefined} value={line.material_id} onChange={(e) => { const next = [...packLines]; next[idx] = { ...next[idx], material_id: e.target.value }; setPackLines(next); }} placeholder="material_id" className="h-10 text-sm focus-visible:ring-indigo-500" />
                                <Input data-testid={idx === 0 ? "dispatch-pack-qty-0" : undefined} type="number" step="0.001" value={line.qty} onChange={(e) => { const next = [...packLines]; next[idx] = { ...next[idx], qty: Number(e.target.value || 0) }; setPackLines(next); }} placeholder="Qty" className="h-10 text-sm focus-visible:ring-indigo-500" />
                                <Input value={line.uom || ""} onChange={(e) => { const next = [...packLines]; next[idx] = { ...next[idx], uom: e.target.value.toUpperCase() }; setPackLines(next); }} placeholder="UOM" className="h-10 text-sm focus-visible:ring-indigo-500" />
                                <Input value={line.basis || ""} onChange={(e) => { const next = [...packLines]; next[idx] = { ...next[idx], basis: e.target.value.toUpperCase() }; setPackLines(next); }} placeholder="Basis" className="h-10 text-sm focus-visible:ring-indigo-500" />
                            </div>
                        ))}
                    </div>
                    <DialogFooter className="pt-4 border-t border-slate-100">
                        <Button variant="outline" className="shadow-none border-slate-200" onClick={() => setPackLines((prev) => [...prev, { material_id: "", qty: 0, uom: "PCS", basis: "PER_ROLL" }])}>Add Row</Button>
                        <Button data-testid="dispatch-pack-save" onClick={handlePackRoll} className="bg-indigo-600 hover:bg-indigo-700">Save Packing Data</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Sticky Interaction Bar */}
            {summary && (
                <div className="sticky bottom-6 z-40 max-w-5xl mx-auto w-full group animate-in slide-in-from-bottom-5 duration-500 px-4">
                    <div className="absolute inset-0 bg-slate-100 rounded-[2rem] blur-xl opacity-50 transition-opacity" />
                    <div className="relative bg-white/90 backdrop-blur-2xl border border-slate-200/50 p-4 pl-8 rounded-[2rem] shadow-[0_8px_30px_rgb(0,0,0,0.06)] flex items-center justify-between">
                        <div className="flex items-center gap-6">
                            <div className="flex flex-col">
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Selected Inventory</span>
                                <span className="text-xl font-black text-slate-900 leading-none mt-1">{selectedCount} <span className="text-xs font-bold text-slate-400 uppercase tracking-widest ml-0.5">Units</span></span>
                            </div>
                            <div className="h-8 w-px bg-slate-200" />
                            <div className="flex items-center gap-2 max-w-[150px] sm:max-w-none">
                                <Truck className="h-4 w-4 text-indigo-500 shrink-0" strokeWidth={2} />
                                <span className="text-sm font-semibold text-slate-700 truncate">{summary.sales_order.customer_name}</span>
                            </div>
                        </div>

                        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
                            <DialogTrigger asChild>
                                <Button size="lg" data-testid="dispatch-create-trigger" disabled={selectedCount === 0} className="h-12 px-8 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold shadow-md hover:shadow-lg transition-all ring-offset-2 focus-visible:ring-2 focus-visible:ring-indigo-600 disabled:bg-slate-100 disabled:text-slate-400">
                                    Create Dispatch <ArrowRight className="h-4 w-4 ml-2" />
                                </Button>
                            </DialogTrigger>
                            <DialogContent className="max-w-md bg-white border border-slate-200 rounded-3xl shadow-xl overflow-hidden p-0">
                                <div className="p-8">
                                    <DialogHeader className="mb-6">
                                        <DialogTitle className="text-2xl font-black text-slate-900 mb-1">Finalize Protocol</DialogTitle>
                                        <p className="text-sm font-medium text-slate-500">Creating Delivery Challan for {selectedCount} items.</p>
                                    </DialogHeader>
                                    <div className="grid gap-5 py-2">
                                        <div className="space-y-1.5">
                                            <Label className="text-xs font-semibold text-slate-600">Vehicle No.</Label>
                                            <Input value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} placeholder="MH-XX-AB-XXXX" className="h-12 font-medium bg-slate-50/50 border-slate-200 focus-visible:ring-indigo-500 rounded-xl" autoFocus />
                                        </div>
                                        <div className="grid gap-4 grid-cols-2">
                                            <div className="space-y-1.5">
                                                <Label className="text-xs font-semibold text-slate-600">Driver Name</Label>
                                                <Input value={driverName} onChange={(e) => setDriverName(e.target.value)} placeholder="John Doe" className="h-12 font-medium bg-slate-50/50 border-slate-200 focus-visible:ring-indigo-500 rounded-xl" />
                                            </div>
                                            <div className="space-y-1.5">
                                                <Label className="text-xs font-semibold text-slate-600">Contact</Label>
                                                <Input value={driverPhone} onChange={(e) => setDriverPhone(e.target.value)} placeholder="+91..." className="h-12 font-medium bg-slate-50/50 border-slate-200 focus-visible:ring-indigo-500 rounded-xl" />
                                            </div>
                                        </div>
                                    </div>
                                    <DialogFooter className="mt-8 flex gap-3">
                                        <Button variant="ghost" onClick={() => setCreateDialogOpen(false)} className="h-12 flex-1 rounded-xl">Cancel</Button>
                                        <Button data-testid="dispatch-create-submit" onClick={handleCreateChallan} className="h-12 flex-[2] rounded-xl bg-slate-900 hover:bg-slate-800 shadow-md">
                                            Confirm Payload
                                        </Button>
                                    </DialogFooter>
                                </div>
                            </DialogContent>
                        </Dialog>
                    </div>
                </div>
            )}

            {/* Execution History Table */}
            <Card className="border-0 shadow-sm ring-1 ring-slate-100 rounded-[1.5rem] bg-white overflow-hidden mt-8">
                <CardHeader className="p-6 border-b border-slate-50 bg-slate-50/40 flex flex-row items-center justify-between">
                    <div>
                        <CardTitle className="text-[14px] font-bold uppercase tracking-widest text-slate-600 flex items-center gap-2">
                            <FileText className="h-4 w-4 text-indigo-500" strokeWidth={2.5} />
                            Dispatch Ledger
                        </CardTitle>
                    </div>
                    <Badge variant="secondary" className="bg-slate-100 text-slate-600 border-none font-bold text-[11px] uppercase tracking-wide">
                        {challans.length} RECORDS
                    </Badge>
                </CardHeader>
                <CardContent className="p-0 overflow-auto">
                    <Table>
                        <TableHeader className="bg-white border-b border-slate-100">
                            <TableRow className="border-none hover:bg-transparent">
                                <TableHead className="px-6 text-[10px] uppercase tracking-widest font-bold text-slate-400 py-4">DC Ref</TableHead>
                                <TableHead className="text-[10px] uppercase tracking-widest font-bold text-slate-400">Recipient</TableHead>
                                <TableHead className="text-[10px] uppercase tracking-widest font-bold text-slate-400">Transport</TableHead>
                                <TableHead className="text-[10px] uppercase tracking-widest font-bold text-slate-400">Ship Status</TableHead>
                                <TableHead className="text-[10px] uppercase tracking-widest font-bold text-slate-400">Date Log</TableHead>
                                <TableHead className="text-right px-6 text-[10px] uppercase tracking-widest font-bold text-slate-400">Admin</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {challans.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={6} className="text-center py-16 text-sm font-medium text-slate-400">
                                        Ledger is currently empty.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                challans.map((challan) => (
                                    <TableRow key={challan.id} data-testid={`dispatch-challan-row-${challan.id}`} className="hover:bg-slate-50/50 transition-colors border-b border-slate-100 group">
                                        <TableCell className="px-6 font-mono text-sm font-bold text-slate-800">{challan.dc_no}</TableCell>
                                        <TableCell className="text-sm font-bold text-slate-600">{challan.customer_name}</TableCell>
                                        <TableCell>
                                            <span className="text-xs font-semibold text-slate-500 flex items-center gap-1.5">
                                                <Truck className="h-3.5 w-3.5 opacity-70" /> {challan.vehicle_no || 'TBD'}
                                            </span>
                                        </TableCell>
                                        <TableCell>{getStatusBadge(challan.status)}</TableCell>
                                        <TableCell className="text-xs font-medium text-slate-500">
                                            {challan.dispatch_date
                                                ? new Date(challan.dispatch_date).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
                                                : '-'}
                                        </TableCell>
                                        <TableCell className="text-right px-6">
                                            <div className="inline-flex items-center gap-1">
                                                <Button size="sm" variant="ghost" data-testid={`dispatch-print-${challan.id}`} onClick={() => handlePrintList(challan.id)} className="text-slate-500 hover:text-indigo-600 hover:bg-slate-100 h-8 px-2.5">
                                                    <Printer className="mr-1.5 h-3.5 w-3.5" /> Print
                                                </Button>
                                                {challan.status === 'DRAFT' && (
                                                    <Button size="sm" variant="secondary" data-testid={`dispatch-send-${challan.id}`} onClick={() => handleDispatch(challan.id)} className="h-8 px-3 ml-1 bg-indigo-50 text-indigo-700 hover:bg-indigo-600 hover:text-white transition-colors">
                                                        <Send className="mr-1.5 h-3.5 w-3.5" /> Release
                                                    </Button>
                                                )}
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    )
}

"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Loader2, Search, ArrowUpRight, ArrowDownLeft, CalendarClock, History, Database, ArrowRightLeft, ArrowRight } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table"
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

import { inventoryService } from "@/services/inventory"
import { cn } from "@/lib/utils"

export default function LedgerPage() {
    const [searchTerm, setSearchTerm] = useState("")
    const [typeFilter, setTypeFilter] = useState("ALL")

    const { data: ledger, isLoading } = useQuery({
        queryKey: ['ledger', typeFilter],
        queryFn: () => inventoryService.getLedger(typeFilter === 'ALL' ? {} : { tx_type: typeFilter })
    })

    const filteredLedger = (ledger || []).filter((entry: any) =>
        entry.material_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        entry.reference?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        entry.item_label_id?.toLowerCase().includes(searchTerm.toLowerCase())
    )

    const getTypeColor = (type: string) => {
        const base = "font-black uppercase tracking-widest text-[9px] border px-2 py-0.5 rounded-md flex items-center gap-1 w-fit"
        switch (type) {
            case 'GRN': return cn(base, "text-emerald-600 bg-success-bg border-emerald-100")
            case 'DISPATCH': return cn(base, "text-amber-600 bg-warning-bg border-amber-100")
            case 'CONSUMPTION': return cn(base, "text-rose-600 bg-danger-bg border-rose-100")
            case 'RECEIVE': return cn(base, "text-emerald-600 bg-success-bg border-emerald-100")
            case 'TRANSFER': return cn(base, "text-blue-600 bg-blue-50 border-blue-100")
            default: return cn(base, "text-content-3 bg-slate-50 border-slate-200")
        }
    }

    const formatQuantity = (entry: any) => {
        const isPositive = entry.tx_type === 'GRN' || entry.tx_type === 'RECEIVE'
        const qty = typeof entry.quantity === 'number' ? entry.quantity.toFixed(3) : '0.000'
        return {
            text: `${isPositive ? '+' : '-'} ${qty}`,
            color: isPositive ? 'text-emerald-600' : 'text-amber-600'
        }
    }

    return (
        <div className="p-6 lg:p-8 space-y-8 bg-[#f8fafc] min-h-screen">
            {/* Header Section */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                <div className="space-y-1">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-100 border border-slate-200 text-content-3 text-[10px] font-black uppercase tracking-widest shadow-sm translate-y-[-4px]">
                        <History className="h-3 w-3" /> Audit Trail
                    </div>
                    <h1 className="text-3xl font-black tracking-tight text-slate-900 flex items-center gap-3">
                        Inventory
                        <span className="text-slate-300 font-light translate-y-[2px]">/</span>
                        <span className="text-blue-600 italic">Ledger</span>
                    </h1>
                    <p className="text-slate-500 font-medium text-xs flex items-center gap-2 italic">
                        Immutable record of all stock movements across the network
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <Button variant="outline" className="h-11 rounded-xl border-slate-200 text-slate-500 font-bold text-xs uppercase tracking-wide hover:bg-surface-1 hover:text-blue-600 shadow-sm active-scale">
                        <CalendarClock className="h-4 w-4 mr-2" /> 30-Day History
                    </Button>
                </div>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {[
                    { label: "Total Transactions", value: ledger?.length || 0, icon: Database, color: "text-content-3", bg: "bg-slate-50" },
                    { label: "Inward Flow", value: (ledger || []).filter((e: any) => e.tx_type === 'GRN' || e.tx_type === 'RECEIVE').length, icon: ArrowDownLeft, color: "text-emerald-600", bg: "bg-success-bg" },
                    { label: "Outward Flow", value: (ledger || []).filter((e: any) => e.tx_type === 'DISPATCH' || e.tx_type === 'CONSUMPTION').length, icon: ArrowUpRight, color: "text-amber-600", bg: "bg-warning-bg" }
                ].map((stat, i) => (
                    <Card key={i} className="border-none shadow-premium rounded-2xl bg-white/70 backdrop-blur-md hover:-translate-y-1 transition-all duration-300">
                        <CardHeader className="p-5 pb-2 flex flex-row items-center justify-between">
                            <div className={cn("p-2 rounded-xl transition-colors", stat.bg, stat.color)}>
                                <stat.icon className="h-4 w-4" />
                            </div>
                            <span className="text-[9px] font-black uppercase text-content-4 tracking-widest italic">{stat.label}</span>
                        </CardHeader>
                        <CardContent className="p-5 pt-1">
                            <div className="text-2xl font-black text-slate-900 tracking-tighter">{stat.value}</div>
                        </CardContent>
                    </Card>
                ))}
            </div>

            <Card className="border-none shadow-premium rounded-[2rem] bg-surface-1 overflow-hidden min-h-[500px]">
                <CardHeader className="p-6 pb-2 border-b border-slate-50 bg-slate-50/30">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div className="flex items-center gap-2 flex-1">
                            <CardTitle className="text-lg font-black tracking-tight text-slate-900 uppercase italic">Transaction Log</CardTitle>
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-content-4" />
                                <Input
                                    placeholder="Search ledger..."
                                    className="pl-10 h-10 w-[250px] rounded-xl border-slate-200 bg-surface-1 font-bold text-xs shadow-sm focus:border-blue-600 transition-all"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                            </div>
                            <Select value={typeFilter} onValueChange={setTypeFilter}>
                                <SelectTrigger className="w-[180px] h-10 rounded-xl border-slate-200 bg-surface-1 font-bold text-xs uppercase tracking-wide shadow-sm">
                                    <SelectValue placeholder="All Operations" />
                                </SelectTrigger>
                                <SelectContent className="rounded-xl border-none shadow-xl">
                                    <SelectItem value="ALL" className="font-bold text-xs">All Operations</SelectItem>
                                    <SelectItem value="GRN" className="font-bold text-xs text-emerald-600">Inward (GRN)</SelectItem>
                                    <SelectItem value="DISPATCH" className="font-bold text-xs text-amber-600">Outward (Dispatch)</SelectItem>
                                    <SelectItem value="RECEIVE" className="font-bold text-xs text-blue-600">Receive</SelectItem>
                                    <SelectItem value="CONSUMPTION" className="font-bold text-xs text-rose-600">Consumption</SelectItem>
                                    <SelectItem value="TRANSFER" className="font-bold text-xs text-blue-600">Transfer</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    {isLoading ? (
                        <div className="flex flex-col items-center justify-center py-20 space-y-4">
                            <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                            <p className="text-[10px] font-black uppercase tracking-widest text-content-4 italic">Syncing Ledger...</p>
                        </div>
                    ) : (
                        <Table>
                            <TableHeader className="bg-slate-50/50">
                                <TableRow className="border-none hover:bg-transparent">
                                    <TableHead className="px-6 text-[9px] font-black uppercase text-content-4 italic tracking-widest">Timestamp</TableHead>
                                    <TableHead className="text-[9px] font-black uppercase text-content-4 italic tracking-widest">Operation</TableHead>
                                    <TableHead className="text-[9px] font-black uppercase text-content-4 italic tracking-widest">Item / Batch</TableHead>
                                    <TableHead className="text-[9px] font-black uppercase text-content-4 italic tracking-widest">Location</TableHead>
                                    <TableHead className="text-right px-6 text-[9px] font-black uppercase text-content-4 italic tracking-widest">Quantity</TableHead>
                                    <TableHead className="text-right px-6 text-[9px] font-black uppercase text-content-4 italic tracking-widest">Reference</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredLedger.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={6} className="text-center py-24 text-[11px] font-black uppercase text-slate-300 italic tracking-[0.2em]">
                                            No matching records
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    filteredLedger.map((entry: any) => {
                                        const qty = formatQuantity(entry)
                                        return (
                                            <TableRow key={entry.id} className="hover:bg-slate-50/50 transition-colors border-b border-slate-50/50 group">
                                                <TableCell className="px-6 py-4">
                                                    <div className="font-mono text-[10px] font-black text-slate-500">
                                                        {new Date(entry.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                                                    </div>
                                                    <div className="text-[9px] font-bold text-slate-300 uppercase">
                                                        {new Date(entry.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <div className={getTypeColor(entry.tx_type)}>
                                                        {entry.tx_type === 'GRN' || entry.tx_type === 'RECEIVE' ? (
                                                            <ArrowDownLeft className="h-3 w-3" />
                                                        ) : entry.tx_type === 'TRANSFER' ? (
                                                            <ArrowRightLeft className="h-3 w-3" />
                                                        ) : (
                                                            <ArrowUpRight className="h-3 w-3" />
                                                        )}
                                                        {entry.tx_type}
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    {entry.item_label_id ? (
                                                        <div className="font-mono font-black text-[11px] text-slate-900 group-hover:text-blue-600 transition-colors">{entry.item_label_id}</div>
                                                    ) : (
                                                        <div className="text-[11px] font-black text-slate-700 uppercase">{entry.material_name}</div>
                                                    )}
                                                    {entry.material_name && entry.item_label_id && (
                                                        <div className="text-[9px] font-bold text-content-4 uppercase italic mt-0.5 max-w-[180px] truncate">{entry.material_name}</div>
                                                    )}
                                                </TableCell>
                                                <TableCell>
                                                    <div className="text-[10px] font-black uppercase text-content-3">{entry.to_location_name || entry.from_location_name}</div>
                                                    <div className="text-[9px] font-bold text-content-4 uppercase italic flex items-center gap-1">
                                                        {entry.plant_name}
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-right px-6">
                                                    <div className={cn("font-black text-xs tracking-tight", qty.color)}>
                                                        {qty.text} <span className="text-[9px] text-content-4 font-bold ml-0.5 uppercase">{entry.uom || 'UNITS'}</span>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-right px-6">
                                                    <span className="font-mono text-[10px] font-bold text-content-4 group-hover:text-content-3 transition-colors uppercase">
                                                        {entry.reference || '---'}
                                                    </span>
                                                </TableCell>
                                            </TableRow>
                                        )
                                    })
                                )}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}

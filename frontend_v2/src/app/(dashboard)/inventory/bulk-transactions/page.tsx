"use client"

import { useQuery } from "@tanstack/react-query"
import { inventoryService } from "@/services/inventory"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { History, ArrowDownLeft, ArrowUpRight, Repeat, Settings2, ExternalLink } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"

export default function BulkTransactionsPage() {
    const { data: transactions, isLoading } = useQuery({
        queryKey: ["bulk-transactions"],
        queryFn: () => inventoryService.getBulkTransactions()
    })

    const getTransactionIcon = (type: string) => {
        switch (type) {
            case 'INWARD': return <ArrowDownLeft className="w-4 h-4 text-emerald-500" />
            case 'CONSUME': return <ArrowUpRight className="w-4 h-4 text-rose-500" />
            case 'TRANSFER': return <Repeat className="w-4 h-4 text-blue-500" />
            case 'ADJUST': return <Settings2 className="w-4 h-4 text-slate-500" />
            default: return null
        }
    }

    const getTransactionLabel = (type: string) => {
        switch (type) {
            case 'INWARD': return <Badge className="bg-emerald-50 text-emerald-700 border-emerald-100 hover:bg-emerald-50">Inward</Badge>
            case 'CONSUME': return <Badge className="bg-rose-50 text-rose-700 border-rose-100 hover:bg-rose-50">Consumption</Badge>
            case 'TRANSFER': return <Badge className="bg-blue-50 text-blue-700 border-blue-100 hover:bg-blue-50">Transfer</Badge>
            case 'ADJUST': return <Badge className="bg-slate-50 text-slate-700 border-slate-100 hover:bg-slate-50">Adjustment</Badge>
            default: return <Badge variant="outline">{type}</Badge>
        }
    }

    const formatQty = (tx: any) => {
        const uom = String(tx.stock_uom || tx.base_uom || "KG").toUpperCase()
        const decimals = uom === "KG" ? 2 : uom === "METER" ? 1 : 0
        return `${tx.qty_kg > 0 ? "+" : ""}${Number(tx.qty_kg || 0).toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })} ${uom}`
    }

    return (
        <div className="p-6 space-y-6 bg-slate-50/50 min-h-screen">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-slate-900">Bulk Transactions</h1>
                    <p className="text-slate-500 mt-1">Detailed audit log of all pooled material movements.</p>
                </div>
            </div>

            <Card className="border-none shadow-sm overflow-hidden">
                <CardHeader className="bg-white border-b border-slate-100">
                    <CardTitle className="text-lg font-semibold flex items-center gap-2">
                        <History className="w-5 h-5 text-slate-400" /> Recent Activity
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader className="bg-slate-50/50">
                            <TableRow className="hover:bg-transparent border-slate-100">
                                <TableHead className="w-[180px]">Date & Time</TableHead>
                                <TableHead>Type</TableHead>
                                <TableHead>Material</TableHead>
                                <TableHead>Location</TableHead>
	                                <TableHead className="text-right">Quantity</TableHead>
                                <TableHead>Reference</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading ? (
                                Array.from({ length: 8 }).map((_, i) => (
                                    <TableRow key={i}>
                                        <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                                        <TableCell><Skeleton className="h-6 w-20" /></TableCell>
                                        <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                                        <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                                        <TableCell className="text-right"><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                                        <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                                    </TableRow>
                                ))
                            ) : transactions?.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={6} className="h-32 text-center text-slate-500">
                                        No transactions recorded yet.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                transactions?.map((tx) => (
                                    <TableRow key={tx.id} className="hover:bg-slate-50/50 transition-colors">
                                        <TableCell className="text-slate-500 text-sm">
                                            {new Date(tx.created_at).toLocaleString('en-IN', {
                                                day: 'numeric',
                                                month: 'short',
                                                year: 'numeric',
                                                hour: '2-digit',
                                                minute: '2-digit'
                                            })}
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-2">
                                                {getTransactionIcon(tx.type)}
                                                {getTransactionLabel(tx.type)}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex flex-col">
                                                <span className="font-medium text-slate-900">{tx.material_name}</span>
                                                <span className="text-xs text-slate-500">{tx.material_code}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-slate-600">
                                            {tx.location_name}
                                        </TableCell>
                                        <TableCell className={`text-right font-mono font-semibold ${tx.qty_kg > 0 ? "text-emerald-600" : "text-rose-600"}`}>
	                                            {formatQty(tx)}
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-1.5 text-slate-500 text-sm max-w-[200px] truncate">
                                                {tx.job_no ? (
                                                    <div className="flex items-center gap-1 text-blue-600 font-medium">
                                                        <span className="hover:underline cursor-pointer">Job: {tx.job_no}</span>
                                                        <ExternalLink className="w-3 h-3" />
                                                    </div>
                                                ) : (
                                                    <span className="italic uppercase text-slate-400 text-xs">{tx.reference || "System Auto"}</span>
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

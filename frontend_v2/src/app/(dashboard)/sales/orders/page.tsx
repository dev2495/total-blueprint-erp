"use client"

import { useQuery } from "@tanstack/react-query"
import { salesService } from "@/services/sales"
import { DataTable } from "@/components/ui/data-table"
import { ColumnDef } from "@tanstack/react-table"
import { Button } from "@/components/ui/button"
import { Plus, Activity, Clock, Zap, Loader2, Package, MapPin, Hash } from "lucide-react"
import Link from "next/link"
import { StatusBadge } from "@/components/ui-custom/status-badge"
import { Card } from "@/components/ui/card"

interface SalesOrder {
    id: string
    order_number: string
    customer_name: string
    status: string
    total_weight_kg?: number
    created_at: string
    items?: any[]
}

function formatDate(dateStr: string) {
    const date = new Date(dateStr)
    return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function SalesOrdersPage() {
    const { data: orders, isLoading } = useQuery({
        queryKey: ["sales-orders"],
        queryFn: () => salesService.getOrders()
    })

    const columns: ColumnDef<SalesOrder>[] = [
        {
            accessorKey: "order_number",
            header: () => <span className="text-[11px] font-semibold text-slate-500 pl-2">PROTOCOL ID</span>,
            cell: ({ row }) => (
                <div className="pl-2 flex items-center gap-2">
                    <div className="h-8 w-8 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600">
                        <Hash className="h-3.5 w-3.5" />
                    </div>
                    <div>
                        <span className="font-bold text-slate-900 text-sm">{row.getValue("order_number")}</span>
                        <div className="text-[10px] text-slate-400 font-medium">{row.original?.id?.slice(0, 8)}...</div>
                    </div>
                </div>
            )
        },
        {
            accessorKey: "customer_name",
            header: () => <span className="text-[11px] font-semibold text-slate-500">CLIENT IDENTITY</span>,
            cell: ({ row }) => (
                <div className="flex flex-col">
                    <span className="text-sm font-semibold text-slate-700">{row.getValue("customer_name")}</span>
                    <div className="flex items-center gap-1 text-[10px] text-slate-400 font-medium mt-0.5">
                        <MapPin className="h-3 w-3" />
                        Global Account
                    </div>
                </div>
            )
        },
        {
            accessorKey: "status",
            header: () => <span className="text-[11px] font-semibold text-slate-500">PHASE STATUS</span>,
            cell: ({ row }) => <StatusBadge status={row.getValue("status")} />
        },
        {
            id: "product",
            header: () => <span className="text-[11px] font-semibold text-slate-500">PRODUCT / TEMPLATE</span>,
            cell: ({ row }) => {
                const items = row.original.items || []
                const firstItem = items[0]
                const otherCount = items.length - 1
                const totalWeight = row.original.total_weight_kg || 0
                const printing = firstItem?.printing_snapshot || {}
                const printingEnabled = Boolean(printing?.enabled)
                const printType = String(printing?.type || printing?.method || "").toUpperCase()
                const substrate = String(printing?.substrate_mode || "").toUpperCase()
                const frontCount = Number(printing?.front_colors_count || 0)
                const backCount = Number(printing?.back_colors_count || 0)
                const geometry = firstItem?.geometry_snapshot || {}
                const fgType = String(geometry?.finished_good_type || "POUCH").toUpperCase()
                const rollForm = fgType === "ROLL" ? String(geometry?.roll_form || "FLAT").toUpperCase() : ""
                const claimedStockNos = Array.from(
                    new Set(
                        items.flatMap((item: any) =>
                            Array.isArray(item?.claimed_stock_order_nos) ? item.claimed_stock_order_nos : []
                        )
                    )
                )

                return (
                    <div className="flex items-center gap-3">
                        {/* <div className="h-8 w-8 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
                            <Package className="h-4 w-4" />
                        </div> */}
                        <div className="flex flex-col">
                            {firstItem ? (
                                <div className="flex items-center gap-2">
                                    <span className="text-sm font-medium text-slate-900 truncate max-w-[200px]" title={firstItem.template_name}>
                                        {firstItem.template_name}
                                    </span>
                                    {otherCount > 0 && (
                                        <span className="px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[9px] font-bold border border-slate-200">
                                            +{otherCount}
                                        </span>
                                    )}
                                </div>
                            ) : (
                                <span className="text-sm font-medium text-slate-400 italic">No Items</span>
                            )}
                            <span className="text-[10px] text-slate-500 font-medium mt-0.5">
                                {totalWeight > 0 ? `${Math.round(totalWeight).toLocaleString()} KG Net Weight` : "Weight Pending"}
                            </span>
                            <span className="text-[10px] text-slate-500 font-semibold mt-0.5">
                                {fgType}{rollForm ? ` • ${rollForm}` : ""}
                            </span>
                            {claimedStockNos.length > 0 && (
                                <span className="text-[10px] text-indigo-700 font-semibold mt-0.5">
                                    STOCK_CLAIM • {claimedStockNos.join(", ")}
                                </span>
                            )}
                            {printingEnabled && (
                                <span className="text-[10px] text-indigo-600 font-semibold mt-0.5">
                                    {printType || "PRINT"} • {substrate || "NA"} • F{frontCount}/B{backCount}
                                </span>
                            )}
                        </div>
                    </div>
                )
            }
        },
        {
            accessorKey: "created_at",
            header: () => <span className="text-[11px] font-semibold text-slate-500">TIMESTAMP</span>,
            cell: ({ row }) => (
                <div className="flex items-center gap-1.5 text-slate-500 font-medium text-xs">
                    {formatDate(row.getValue("created_at"))}
                </div>
            )
        },
        {
            id: "actions",
            cell: ({ row }) => (
                <div className="flex items-center justify-end gap-3 px-4">
                    <Link href={`/sales/orders/${row.original.id}/tracking`} className="active-scale transition-opacity hover:opacity-90">
                        <div className="h-9 px-4 rounded-lg bg-white border border-slate-200 text-slate-600 hover:text-indigo-600 hover:border-indigo-100 hover:bg-indigo-50 flex items-center gap-2 transition-all shadow-sm">
                            <Activity className="h-3.5 w-3.5" />
                            <span className="text-[11px] font-bold uppercase tracking-wide">Track</span>
                        </div>
                    </Link>
                </div>
            )
        }
    ]

    return (
        <div className="p-8 lg:p-12 space-y-8 bg-[#F8F9FC] min-h-screen">
            {/* Header Section */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                <div className="space-y-2">
                    <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md bg-indigo-50 border border-indigo-100/50 text-indigo-600 text-[10px] font-bold uppercase tracking-wider">
                        <Zap className="h-3 w-3 fill-indigo-600" /> Commercial Hub
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight text-slate-900">
                            Sales Orders
                        </h1>
                        <p className="text-slate-500 font-medium text-sm mt-1">
                            Managing <span className="text-slate-900 font-bold">{orders?.length || 0}</span> active commercial pipelines
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-3">
                    <Link href="/sales/orders/create" className="active-scale">
                        <Button className="h-11 px-6 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs tracking-wide shadow-lg shadow-indigo-100 transition-all">
                            <Plus className="h-4 w-4 mr-2" /> New Order
                        </Button>
                    </Link>
                </div>
            </div>

            {/* Content Section */}
            <div className="relative">
                {isLoading ? (
                    <div className="flex h-[400px] items-center justify-center bg-white/50 backdrop-blur-sm rounded-[24px] border border-dashed border-slate-200">
                        <div className="text-center space-y-3">
                            <Loader2 className="h-8 w-8 animate-spin text-indigo-600 mx-auto" />
                            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Synchronizing...</p>
                        </div>
                    </div>
                ) : (
                    <Card className="border border-slate-100 shadow-xl shadow-slate-200/40 rounded-[24px] overflow-hidden bg-white/80 backdrop-blur-xl">
                        <div className="overflow-x-auto">
                            <DataTable
                                columns={columns}
                                data={orders || []}
                                filterColumn="order_number"
                                filterPlaceholder="Find protocol ID..."
                            />
                        </div>
                    </Card>
                )}
            </div>
        </div>
    )
}

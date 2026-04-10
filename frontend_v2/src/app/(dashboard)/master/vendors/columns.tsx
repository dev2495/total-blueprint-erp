"use client"

import { ColumnDef } from "@tanstack/react-table"
import { Vendor } from "@/services/inventory"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { MoreHorizontal, Edit, Trash2 } from "lucide-react"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

const TYPE_MAP: Record<string, { label: string, variant: "default" | "secondary" | "outline" }> = {
    'RM': { label: 'Raw Material Supplier', variant: 'default' },
    'JOBWORK': { label: 'Job Worker', variant: 'secondary' },
    'SERVICE': { label: 'Service Provider', variant: 'outline' },
    'BOTH': { label: 'Both (Supplier & JW)', variant: 'default' },
}

const STATUS_MAP: Record<string, string> = {
    'ACTIVE': 'text-green-600 bg-green-50 border-green-200',
    'INACTIVE': 'text-amber-600 bg-amber-50 border-amber-200',
    'BLACKLISTED': 'text-red-700 bg-red-50 border-red-200'
}

interface ActionProps {
    onEdit: (vendor: Vendor) => void
    onDelete: (vendor: Vendor) => void
}

export const getColumns = ({ onEdit, onDelete }: ActionProps): ColumnDef<Vendor>[] => [
    {
        accessorKey: "code",
        header: "Code",
        cell: ({ row }) => <div className="font-mono text-xs font-semibold uppercase">{row.original.code}</div>,
    },
    {
        accessorKey: "name",
        header: "Vendor Name",
        cell: ({ row }) => <div className="font-bold text-slate-800">{row.original.name}</div>,
    },
    {
        accessorKey: "type",
        header: "Type",
        cell: ({ row }) => {
            const t = TYPE_MAP[row.original.type] || { label: row.original.type, variant: 'outline' }
            return <Badge variant={t.variant as any} className="text-[10px] uppercase font-bold tracking-tighter shadow-sm">{t.label}</Badge>
        },
    },
    {
        accessorKey: "gst_no",
        header: "GST No",
        cell: ({ row }) => <div className="text-xs text-slate-500 font-mono">{row.original.gst_no || "-"}</div>,
    },
    {
        accessorKey: "phone_number",
        header: "Phone",
        cell: ({ row }) => <div className="text-xs text-slate-500 font-mono">{row.original.phone_number || "-"}</div>,
    },
    {
        accessorKey: "lead_time_days",
        header: "Lead Time",
        cell: ({ row }) => <div className="text-xs text-slate-500">{row.original.lead_time_days} Days</div>,
    },
    {
        accessorKey: "turnaround_hours",
        header: "JW TAT",
        cell: ({ row }) => {
            const isJobwork = row.original.type === "JOBWORK" || row.original.type === "BOTH"
            return <div className="text-xs text-slate-500">{isJobwork ? `${row.original.turnaround_hours ?? 0}h` : "-"}</div>
        },
    },
    {
        id: "jobwork_caps",
        header: "Jobwork Capabilities",
        cell: ({ row }) => {
            const isJobwork = row.original.type === "JOBWORK" || row.original.type === "BOTH"
            if (!isJobwork) return <div className="text-xs text-slate-400">Not jobwork</div>
            const caps = row.original.jobwork_capabilities || []
            if (!caps.length) return <div className="text-xs text-slate-400">All Processes</div>
            return (
                <div className="flex flex-wrap gap-1 max-w-[220px]">
                    {caps.slice(0, 3).map((cap) => (
                        <Badge key={cap} variant="outline" className="text-[10px] font-bold">{cap}</Badge>
                    ))}
                    {caps.length > 3 ? <Badge variant="outline" className="text-[10px]">+{caps.length - 3}</Badge> : null}
                </div>
            )
        },
    },
    {
        id: "qc_required",
        header: "QC",
        cell: ({ row }) => {
            const isJobwork = row.original.type === "JOBWORK" || row.original.type === "BOTH"
            if (!isJobwork) return <div className="text-xs text-slate-400">-</div>
            return (
                <Badge variant="outline" className={`text-[10px] font-bold ${row.original.qc_required ? "text-indigo-700 bg-indigo-50 border-indigo-200" : "text-slate-500 bg-slate-50 border-slate-200"}`}>
                    {row.original.qc_required ? "REQUIRED" : "OPTIONAL"}
                </Badge>
            )
        },
    },
    {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => {
            const classes = STATUS_MAP[row.original.status] || 'text-slate-600 bg-slate-50'
            return <Badge variant="outline" className={`text-[10px] font-bold ${classes} uppercase tracking-tighter`}>{row.original.status}</Badge>
        },
    },
    {
        id: "actions",
        cell: ({ row }) => {
            const vendor = row.original

            return (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" className="h-8 w-8 p-0">
                            <span className="sr-only">Open menu</span>
                            <MoreHorizontal className="h-4 w-4" />
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuLabel>Actions</DropdownMenuLabel>
                        <DropdownMenuItem onClick={() => navigator.clipboard.writeText(vendor.code)}>
                            Copy Code
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => onEdit(vendor)}>
                            <Edit className="mr-2 h-4 w-4" /> Edit Vendor
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => onDelete(vendor)} className="text-red-600">
                            <Trash2 className="mr-2 h-4 w-4" /> Delete
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            )
        },
    },
]

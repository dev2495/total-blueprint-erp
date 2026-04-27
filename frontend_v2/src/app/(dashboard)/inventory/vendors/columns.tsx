"use client"

import { ColumnDef } from "@tanstack/react-table"
import { Vendor } from "@/services/master-data"
import { ActionMenu } from "@/components/ui-custom/action-menu"
import { Pencil, Trash2, Building2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

interface ColumnsProps {
    onEdit: (item: Vendor) => void
    onDelete: (item: Vendor) => void
}

export const getColumns = ({ onEdit, onDelete }: ColumnsProps): ColumnDef<Vendor>[] => [
    {
        accessorKey: "code",
        header: () => <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 italic">Vendor ID</div>,
        cell: ({ row }) => <div className="font-mono text-[10px] font-black text-slate-400">{row.getValue("code")}</div>,
    },
    {
        accessorKey: "name",
        header: () => <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 italic">Entity Name</div>,
        cell: ({ row }) => (
            <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-lg bg-blue-50 flex items-center justify-center border border-blue-100">
                    <Building2 className="h-4 w-4 text-blue-500" />
                </div>
                <div className="font-bold text-slate-900 uppercase text-[11px] tracking-tight">{row.getValue("name")}</div>
            </div>
        )
    },
    {
        accessorKey: "type",
        header: () => <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 italic">Sector</div>,
        cell: ({ row }) => (
            <Badge variant="outline" className="text-[9px] font-black uppercase tracking-widest bg-slate-50 text-slate-500 border-slate-200 rounded-md px-2 py-0.5">
                {row.getValue("type")}
            </Badge>
        )
    },
    {
        accessorKey: "lead_time_days",
        header: () => <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 italic">Lead Time</div>,
        cell: ({ row }) => <div className="font-bold text-slate-600 text-xs">{row.getValue("lead_time_days")} <span className="text-[9px] text-slate-400 font-normal ml-0.5">DAYS</span></div>,
    },
    {
        accessorKey: "status",
        header: () => <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 italic">Status</div>,
        cell: ({ row }) => {
            const status = row.getValue("status") as string
            const isActive = status === 'ACTIVE'
            return (
                <div className="flex items-center gap-2">
                    <div className={cn("h-1.5 w-1.5 rounded-full", isActive ? "bg-emerald-500 animate-pulse" : "bg-slate-300")} />
                    <span className={cn("text-[9px] font-black uppercase tracking-widest", isActive ? "text-emerald-600" : "text-slate-400")}>{status}</span>
                </div>
            )
        }
    },
    {
        id: "actions",
        cell: ({ row }) => (
            <div className="flex justify-end pr-4">
                <ActionMenu
                    actions={[
                        {
                            label: "Modify Profile",
                            icon: Pencil,
                            onClick: () => onEdit(row.original),
                        },
                        {
                            label: "Delete Entity",
                            icon: Trash2,
                            onClick: () => onDelete(row.original),
                            variant: "destructive",
                        },
                    ]}
                />
            </div>
        ),
    },
]

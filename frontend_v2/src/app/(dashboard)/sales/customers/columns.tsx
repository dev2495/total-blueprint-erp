"use client"

import { ColumnDef } from "@tanstack/react-table"
import { Customer } from "@/services/master-data"
import { Pencil, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { StatusBadge } from "@/components/ui-custom/status-badge"

export const getColumns = ({ onEdit, onDelete }: {
    onEdit: (customer: Customer) => void,
    onDelete: (customer: Customer) => void
}): ColumnDef<Customer>[] => [
        {
            accessorKey: "code",
            header: () => <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 px-2 italic">Client Code</span>,
            cell: ({ row }) => (
                <div className="px-2">
                    <span className="font-black text-slate-900 text-sm tracking-tight">{row.getValue("code")}</span>
                </div>
            )
        },
        {
            accessorKey: "name",
            header: () => <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 italic">Corporate Entity</span>,
            cell: ({ row }) => (
                <div className="flex flex-col">
                    <span className="text-sm font-black text-slate-700 uppercase tracking-tight">{row.getValue("name")}</span>
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-tighter italic">
                        {row.original.contact_person || row.original.under_group || "PRIMARY CONTACT PENDING"}
                    </span>
                </div>
            )
        },
        {
            id: "tax_identity",
            header: () => <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 italic">Tax Identity</span>,
            cell: ({ row }) => (
                <div className="flex flex-col">
                    <span className="font-mono text-[11px] font-bold text-slate-500">{row.original.gst_no || "NON-GST"}</span>
                    <span className="text-[9px] font-bold text-slate-400 uppercase">{row.original.pan_no || "PAN pending"}</span>
                </div>
            )
        },
        {
            accessorKey: "status",
            header: () => <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 italic">Account Status</span>,
            cell: ({ row }) => <StatusBadge status={row.getValue("status")} />
        },
        {
            id: "credit",
            header: () => <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 italic">Credit Exposure</span>,
            cell: ({ row }) => (
                <div className="flex flex-col">
                    <span className="text-[11px] font-black text-indigo-600">LIMIT: ₹{Number(row.original.credit_limit || 0).toLocaleString()}</span>
                    <span className="text-[9px] font-bold text-slate-400 uppercase">{row.original.credit_days || 0} DAYS TERM · {row.original.interest_calculation || "NO INTEREST RULE"}</span>
                </div>
            )
        },
        {
            id: "address_book",
            header: () => <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 italic">Address Book</span>,
            cell: ({ row }) => (
                <div className="flex flex-col">
                    <span className="text-[11px] font-black text-slate-700">{row.original.mailing_state || row.original.mailing_country || "Primary address only"}</span>
                    <span className="text-[9px] font-bold text-slate-400 uppercase">
                        {(row.original.additional_addresses?.length || 0) > 0 ? `${row.original.additional_addresses?.length || 0} extra addresses` : "No extra addresses"}
                    </span>
                </div>
            )
        },
        {
            id: "actions",
            cell: ({ row }) => (
                <div className="flex items-center justify-end gap-2 px-4">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 rounded-xl hover:bg-indigo-50 hover:text-indigo-600 transition-all active-scale"
                        onClick={() => onEdit(row.original)}
                    >
                        <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 rounded-xl hover:bg-rose-50 hover:text-rose-600 transition-all active-scale"
                        onClick={() => onDelete(row.original)}
                    >
                        <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                </div>
            )
        }
    ]

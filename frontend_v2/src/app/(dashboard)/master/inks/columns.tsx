"use client"

import { ColumnDef } from "@tanstack/react-table"
import { Material } from "@/services/master-data"
import { ActionMenu } from "@/components/ui-custom/action-menu"
import { Pencil, Trash2 } from "lucide-react"

interface ColumnsProps {
    onEdit: (item: Material) => void
    onDelete: (item: Material) => void
}

export const getColumns = ({ onEdit, onDelete }: ColumnsProps): ColumnDef<Material>[] => [
    {
        accessorKey: "code",
        header: "Code",
        cell: ({ row }) => <div className="font-mono text-xs">{row.getValue("code")}</div>,
    },
    {
        accessorKey: "base_type",
        header: "Base",
        cell: ({ row }) => <div className="font-black text-xs px-2 py-0.5 bg-slate-100 rounded-full inline-block">{row.getValue("base_type")}</div>,
    },
    {
        accessorKey: "color_name",
        header: "Color Name",
        cell: ({ row }) => <div className="font-bold uppercase tracking-tighter">{row.getValue("color_name")}</div>,
    },
    {
        accessorKey: "swatch_hex",
        header: "Swatch",
        cell: ({ row }) => {
            const hex = String(row.original.swatch_hex || "")
            const valid = /^#[0-9A-F]{6}$/i.test(hex)
            return (
                <div className="flex items-center gap-2 text-xs">
                    <span
                        className="h-5 w-5 rounded-md border border-slate-200"
                        style={valid ? { backgroundColor: hex } : { background: "repeating-linear-gradient(45deg,#fee2e2 0,#fee2e2 4px,#fff 4px,#fff 8px)" }}
                    />
                    <span className={valid ? "font-mono text-slate-700" : "text-rose-600"}>{valid ? hex.toUpperCase() : "missing"}</span>
                </div>
            )
        },
    },
    {
        accessorKey: "name",
        header: "Description",
        cell: ({ row }) => <div className="text-slate-500 text-xs">{row.getValue("name")}</div>,
    },
    {
        id: "actions",
        cell: ({ row }) => (
            <ActionMenu
                actions={[
                    {
                        label: "Edit",
                        icon: Pencil,
                        onClick: () => onEdit(row.original),
                    },
                    {
                        label: "Delete",
                        icon: Trash2,
                        onClick: () => onDelete(row.original),
                        variant: "destructive",
                    },
                ]}
            />
        ),
    },
]

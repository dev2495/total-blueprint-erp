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

"use client"

import { ColumnDef } from "@tanstack/react-table"
import { Material } from "@/services/master-data"
import { ActionMenu } from "@/components/ui-custom/action-menu"
import { StatusBadge } from "@/components/ui-custom/status-badge"
import { Pencil, Trash2 } from "lucide-react"

interface ColumnsProps {
    onEdit: (item: Material) => void
    onDelete: (item: Material) => void
}

export const getColumns = ({ onEdit, onDelete }: ColumnsProps): ColumnDef<Material>[] => [
    {
        accessorKey: "category",
        header: "Type",
        cell: ({ row }) => {
            const category = row.getValue("category") as string
            return (
                <StatusBadge
                    status={category}
                />
            )
        },
    },
    {
        accessorKey: "code",
        header: "Code",
        cell: ({ row }) => <div className="font-mono text-xs">{row.getValue("code")}</div>,
    },
    {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => <div className="font-medium">{row.getValue("name")}</div>,
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

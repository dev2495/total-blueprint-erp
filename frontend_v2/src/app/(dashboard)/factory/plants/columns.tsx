"use client"

import { ColumnDef } from "@tanstack/react-table"
import { Plant } from "@/services/factory"
import { ActionMenu } from "@/components/ui-custom/action-menu"
import { Pencil, Trash2 } from "lucide-react"

interface ColumnsProps {
    onEdit: (item: Plant) => void
    onDelete: (item: Plant) => void
}

export const getColumns = ({ onEdit, onDelete }: ColumnsProps): ColumnDef<Plant>[] => [
    {
        accessorKey: "code",
        header: "Code",
        cell: ({ row }) => <div className="font-mono text-xs">{row.getValue("code")}</div>,
    },
    {
        accessorKey: "name",
        header: "Plant Name",
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

"use client"

import { ColumnDef } from "@tanstack/react-table"
import { Location } from "@/services/factory"
import { ActionMenu } from "@/components/ui-custom/action-menu"
import { StatusBadge } from "@/components/ui-custom/status-badge"
import { Pencil, Trash2 } from "lucide-react"

interface ColumnsProps {
    onEdit: (item: Location) => void
    onDelete: (item: Location) => void
}

export const getColumns = ({ onEdit, onDelete }: ColumnsProps): ColumnDef<Location>[] => [
    {
        accessorKey: "code",
        header: "Code",
        cell: ({ row }) => <div className="font-mono text-xs">{row.getValue("code")}</div>,
    },
    {
        accessorKey: "name",
        header: "Location Name",
        cell: ({ row }) => <div className="font-medium">{row.getValue("name")}</div>,
    },
    {
        accessorKey: "plant_name",
        header: "Plant",
        cell: ({ row }) => row.getValue("plant_name") || "N/A",
    },
    {
        accessorKey: "is_system",
        header: "Type",
        cell: ({ row }) => (
            <StatusBadge
                status={row.getValue("is_system") ? "System" : "User"}
            />
        ),
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
                        disabled: row.original.is_system,
                    },
                    {
                        label: "Delete",
                        icon: Trash2,
                        onClick: () => onDelete(row.original),
                        variant: "destructive",
                        disabled: row.original.is_system,
                    },
                ]}
            />
        ),
    },
]

"use client"

import { ColumnDef } from "@tanstack/react-table"
import { Process } from "@/services/factory"
import { ActionMenu } from "@/components/ui-custom/action-menu"
import { Pencil, Trash2 } from "lucide-react"
import { StatusBadge } from "@/components/ui-custom/status-badge"

interface ColumnsProps {
    onEdit: (item: Process) => void
    onDelete: (item: Process) => void
}

export const getColumns = ({ onEdit, onDelete }: ColumnsProps): ColumnDef<Process>[] => [
    {
        accessorKey: "code",
        header: "Code",
        cell: ({ row }) => <div className="font-mono text-xs">{row.getValue("code")}</div>,
    },
    {
        accessorKey: "name",
        header: "Process Name",
        cell: ({ row }) => <div className="font-medium">{row.getValue("name")}</div>,
    },
    {
        accessorKey: "category",
        header: "Category",
        cell: ({ row }) => (
            <StatusBadge status={row.getValue("category")} variant="outline" />
        ),
    },
    {
        header: "Flow Modes",
        cell: ({ row }) => (
            <div className="flex gap-2">
                <StatusBadge status={`In: ${row.original.input_mode}`} />
                <StatusBadge status={`Out: ${row.original.output_mode}`} />
            </div>
        ),
    },
    {
        accessorKey: "is_terminal",
        header: "Terminal?",
        cell: ({ row }) => (
            <StatusBadge status={row.getValue("is_terminal")} />
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

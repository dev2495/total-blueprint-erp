"use client"

import { ColumnDef } from "@tanstack/react-table"
import { Pencil, Trash2 } from "lucide-react"

import { ActionMenu } from "@/components/ui-custom/action-menu"
import { CommercialFamily } from "@/services/commercial-families"

interface ColumnsProps {
    onEdit: (family: CommercialFamily) => void
    onDelete: (family: CommercialFamily) => void
}

export const getColumns = ({ onEdit, onDelete }: ColumnsProps): ColumnDef<CommercialFamily>[] => [
    {
        accessorKey: "code",
        header: "Code",
        cell: ({ row }) => <div className="font-mono text-xs font-semibold">{row.getValue("code")}</div>,
    },
    {
        accessorKey: "name",
        header: "Business Family",
        cell: ({ row }) => <div className="font-medium">{row.getValue("name")}</div>,
    },
    {
        accessorKey: "default_form",
        header: "Form",
    },
    {
        accessorKey: "default_reporting_group",
        header: "Reporting Group",
    },
    {
        accessorKey: "active",
        header: "Active",
        cell: ({ row }) => <div>{row.getValue("active") ? "Yes" : "No"}</div>,
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


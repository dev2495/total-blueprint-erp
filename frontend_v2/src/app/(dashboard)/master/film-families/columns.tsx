"use client"

import { ColumnDef } from "@tanstack/react-table"
import { FilmFamily } from "@/services/film-families"
import { ActionMenu } from "@/components/ui-custom/action-menu"
import { Pencil, Trash2 } from "lucide-react"

interface ColumnsProps {
    onEdit: (family: FilmFamily) => void
    onDelete: (family: FilmFamily) => void
}

export const getColumns = ({ onEdit, onDelete }: ColumnsProps): ColumnDef<FilmFamily>[] => [
    {
        accessorKey: "name",
        header: "Name",
        cell: ({ row }) => <div className="font-medium">{row.getValue("name")}</div>,
    },
    {
        accessorKey: "density_gcm3",
        header: "Density (g/cm³)",
        cell: ({ row }) => <div>{row.getValue("density_gcm3")}</div>,
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

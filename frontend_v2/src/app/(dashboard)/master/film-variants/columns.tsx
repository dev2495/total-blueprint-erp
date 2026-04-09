"use client"

import { ColumnDef } from "@tanstack/react-table"
import { FilmVariant } from "@/services/film-variants"
import { ActionMenu } from "@/components/ui-custom/action-menu"
import { StatusBadge } from "@/components/ui-custom/status-badge"
import { Pencil, Trash2 } from "lucide-react"

interface ColumnsProps {
    onEdit: (variant: FilmVariant) => void
    onDelete: (variant: FilmVariant) => void
}

export const getColumns = ({ onEdit, onDelete }: ColumnsProps): ColumnDef<FilmVariant>[] => [
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
        accessorKey: "parent_family_name",
        header: "Family",
        cell: ({ row }) => <div>{row.getValue("parent_family_name")}</div>,
    },
    {
        accessorKey: "commercial_family_name",
        header: "Business Family",
        cell: ({ row }) => <div>{(row.getValue("commercial_family_name") as string) || "—"}</div>,
    },
    {
        accessorKey: "is_extrudable",
        header: "Extrudable",
        cell: ({ row }) => (
            <StatusBadge status={row.getValue("is_extrudable")} />
        ),
    },
    {
        accessorKey: "is_purchasable",
        header: "Purchasable",
        cell: ({ row }) => (
            <StatusBadge status={row.getValue("is_purchasable") || false} />
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

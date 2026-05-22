"use client"

import { ColumnDef } from "@tanstack/react-table"
import { FilmVariant } from "@/services/film-variants"
import { ActionMenu } from "@/components/ui-custom/action-menu"
import { StatusBadge } from "@/components/ui-custom/status-badge"
import { Pencil, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"

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
        id: "trade",
        header: "Trade sale",
        cell: ({ row }) => {
            const sellable = Boolean(row.original.is_sellable)
            return sellable ? (
                <div className="space-y-1">
                    <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-[10px] font-bold text-emerald-700">
                        Sellable
                    </Badge>
                    <div className="font-mono text-[10px] text-slate-500">GST {row.original.default_gst_pct ?? 0}%</div>
                </div>
            ) : (
                <span className="text-xs font-semibold text-slate-400">Production only</span>
            )
        },
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

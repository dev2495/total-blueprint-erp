"use client"

import { ColumnDef } from "@tanstack/react-table"
import { Cylinder } from "@/services/engineering"
import { ActionMenu } from "@/components/ui-custom/action-menu"
import { Pencil, Trash2 } from "lucide-react"

interface ColumnsProps {
    onEdit: (item: Cylinder) => void
    onDelete: (item: Cylinder) => void
}

export const getColumns = ({ onEdit, onDelete }: ColumnsProps): ColumnDef<Cylinder>[] => [
    {
        accessorKey: "code",
        header: "Cylinder Code",
        cell: ({ row }) => <div className="font-mono text-xs">{row.getValue("code")}</div>,
    },
    {
        accessorKey: "artwork_name",
        header: "Artwork",
    },
    {
        accessorKey: "color_name",
        header: "Color",
    },
    {
        accessorKey: "dimensions",
        header: "Dimensions (mm)",
        cell: ({ row }) => (
            <div className="text-xs">
                W: {row.original.width_mm} | D: {row.original.diameter_mm}
            </div>
        )
    },
    {
        accessorKey: "location_name",
        header: "Location",
        cell: ({ row }) => <div className="text-xs text-muted-foreground">{row.getValue("location_name") || "-"}</div>
    },
    {
        accessorKey: "engraving_vendor_name",
        header: "Vendor",
    },
    {
        accessorKey: "status",
        header: "Status",
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

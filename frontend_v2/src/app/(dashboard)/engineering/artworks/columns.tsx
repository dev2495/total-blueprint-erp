"use client";

import { ColumnDef } from "@tanstack/react-table";
import { Artwork } from "@/services/engineering";
import { ActionMenu } from "@/components/ui-custom/action-menu";
import { Pencil, Trash2, Eye } from "lucide-react";

interface ColumnsProps {
  onEdit: (item: Artwork) => void;
  onDelete: (item: Artwork) => void;
}

export const getColumns = ({
  onEdit,
  onDelete,
}: ColumnsProps): ColumnDef<Artwork>[] => [
  {
    accessorKey: "design_code",
    header: "Design Code",
    cell: ({ row }) => (
      <div className="font-mono text-xs">{row.getValue("design_code")}</div>
    ),
  },
  {
    accessorKey: "name",
    header: "Artwork Name",
    cell: ({ row }) => (
      <div className="font-medium">{row.getValue("name")}</div>
    ),
  },
  {
    accessorKey: "customer_name",
    header: "Customer",
  },
  {
    accessorKey: "colors_count",
    header: "Colors",
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
];

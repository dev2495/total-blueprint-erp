"use client";

import { ColumnDef } from "@tanstack/react-table";
import { Addon } from "@/services/master-data";
import { ActionMenu } from "@/components/ui-custom/action-menu";
import { StatusBadge } from "@/components/ui-custom/status-badge";
import { Pencil, Trash2 } from "lucide-react";

interface ColumnsProps {
  onEdit: (item: Addon) => void;
  onDelete: (item: Addon) => void;
}

export const getColumns = ({
  onEdit,
  onDelete,
}: ColumnsProps): ColumnDef<Addon>[] => [
  {
    accessorKey: "code",
    header: "Code",
    cell: ({ row }) => (
      <div className="font-mono text-xs">{row.getValue("code")}</div>
    ),
  },
  {
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => (
      <div className="font-medium">{row.getValue("name")}</div>
    ),
  },
  {
    accessorKey: "weight_mode",
    header: "Mode",
    cell: ({ row }) => {
      const mode = row.getValue("weight_mode") as string;
      return <StatusBadge status={mode} />;
    },
  },
  {
    accessorKey: "weight_value",
    header: "Weight (g)",
    cell: ({ row }) => <div>{row.getValue("weight_value")}</div>,
  },
  {
    accessorKey: "is_purchasable",
    header: "Purchasable",
    cell: ({ row }) => (
      <StatusBadge
        status={
          (row.original.is_purchasable ?? row.original.addon_is_purchased)
            ? "YES"
            : "NO"
        }
      />
    ),
  },
  {
    accessorKey: "addon_purchase_uom",
    header: "Stock UOM",
    cell: ({ row }) => (
      <div className="font-mono text-xs">
        {(row.original.is_purchasable ?? row.original.addon_is_purchased)
          ? row.original.addon_purchase_uom || "KG"
          : "-"}
      </div>
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
];

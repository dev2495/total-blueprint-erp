"use client";

import { ColumnDef } from "@tanstack/react-table";
import { RoutingRule } from "@/services/routing";
import { ActionMenu } from "@/components/ui-custom/action-menu";
import { Pencil, Trash2 } from "lucide-react";
import { StatusBadge } from "@/components/ui-custom/status-badge";

interface ColumnsProps {
  onEdit: (item: RoutingRule) => void;
  onDelete: (item: RoutingRule) => void;
}

export const getColumns = ({
  onEdit,
  onDelete,
}: ColumnsProps): ColumnDef<RoutingRule>[] => [
  {
    accessorKey: "name",
    header: "Rule Name",
    cell: ({ row }) => (
      <div className="font-medium">{row.getValue("name")}</div>
    ),
  },
  {
    accessorKey: "ordered_processes",
    header: "Steps",
    cell: ({ row }) => (
      <div className="flex flex-wrap gap-1 max-w-[300px]">
        {(row.getValue("ordered_processes") as string[])?.map((code, index) => (
          <div key={index} className="flex items-center gap-1">
            <StatusBadge
              status={code}
              variant="outline"
              className="text-[10px] px-1"
            />
            {index <
              (row.getValue("ordered_processes") as string[]).length - 1 && (
              <span className="text-muted-foreground">→</span>
            )}
          </div>
        ))}
      </div>
    ),
  },
  {
    accessorKey: "interplant_required",
    header: "Interplant",
    cell: ({ row }) => (
      <StatusBadge status={row.getValue("interplant_required")} />
    ),
  },
  {
    accessorKey: "is_active",
    header: "Status",
    cell: ({ row }) => (
      <StatusBadge status={row.getValue("is_active") ? "Active" : "Inactive"} />
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

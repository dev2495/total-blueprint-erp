"use client";

import { ColumnDef } from "@tanstack/react-table";
import { WorkCenter } from "@/services/factory";
import { ActionMenu } from "@/components/ui-custom/action-menu";
import { Pencil, Trash2 } from "lucide-react";
import { StatusBadge } from "@/components/ui-custom/status-badge";

interface ColumnsProps {
  onEdit: (item: WorkCenter) => void;
  onDelete: (item: WorkCenter) => void;
}

export const getColumns = ({
  onEdit,
  onDelete,
}: ColumnsProps): ColumnDef<WorkCenter>[] => [
  {
    accessorKey: "code",
    header: "Code",
    cell: ({ row }) => (
      <div className="font-mono text-xs">{row.getValue("code")}</div>
    ),
  },
  {
    accessorKey: "name",
    header: "Work Center Name",
    cell: ({ row }) => (
      <div className="font-medium">{row.getValue("name")}</div>
    ),
  },
  {
    accessorKey: "plant_name",
    header: "Plant",
    cell: ({ row }) => row.getValue("plant_name") || "N/A",
  },
  {
    accessorKey: "process_codes",
    header: "Capabilities",
    cell: ({ row }) => (
      <div className="flex flex-wrap gap-1 max-w-[200px]">
        {(row.getValue("process_codes") as string[])?.map((code) => (
          <StatusBadge
            key={code}
            status={code}
            variant="outline"
            className="text-[10px] px-1"
          />
        ))}
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

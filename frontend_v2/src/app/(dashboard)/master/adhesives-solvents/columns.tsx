"use client";

import { ColumnDef } from "@tanstack/react-table";
import { Material } from "@/services/master-data";
import { StatusBadge } from "@/components/ui-custom/status-badge";

export const getColumns = (): ColumnDef<Material>[] => [
  {
    accessorKey: "category",
    header: "Type",
    cell: ({ row }) => (
      <StatusBadge status={String(row.getValue("category") || "")} />
    ),
  },
  {
    accessorKey: "code",
    header: "Code",
    cell: ({ row }) => (
      <div className="font-mono text-xs font-bold">{row.getValue("code")}</div>
    ),
  },
  {
    accessorKey: "name",
    header: "System Master",
    cell: ({ row }) => (
      <div className="font-medium text-content-2">{row.getValue("name")}</div>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <StatusBadge status={String(row.getValue("status") || "")} />
    ),
  },
];

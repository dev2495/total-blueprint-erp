"use client";

import { ColumnDef } from "@tanstack/react-table";
import { Vendor } from "@/services/master-data";
import { ActionMenu } from "@/components/ui-custom/action-menu";
import { Pencil, Trash2, Building2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface ColumnsProps {
  onEdit: (item: Vendor) => void;
  onDelete: (item: Vendor) => void;
}

export const getColumns = ({
  onEdit,
  onDelete,
}: ColumnsProps): ColumnDef<Vendor>[] => [
  {
    accessorKey: "code",
    header: () => (
      <div className="text-[10px] font-black uppercase tracking-widest text-content-4 italic">
        Vendor ID
      </div>
    ),
    cell: ({ row }) => (
      <div className="font-mono text-[10px] font-black text-content-4">
        {row.getValue("code")}
      </div>
    ),
  },
  {
    accessorKey: "name",
    header: () => (
      <div className="text-[10px] font-black uppercase tracking-widest text-content-4 italic">
        Entity Name
      </div>
    ),
    cell: ({ row }) => (
      <div className="flex items-center gap-3">
        <div className="h-8 w-8 rounded-lg bg-info-bg flex items-center justify-center border border-info-border">
          <Building2 className="h-4 w-4 text-primary" />
        </div>
        <div className="font-bold text-content-1 uppercase text-[11px] tracking-tight">
          {row.getValue("name")}
        </div>
      </div>
    ),
  },
  {
    accessorKey: "type",
    header: () => (
      <div className="text-[10px] font-black uppercase tracking-widest text-content-4 italic">
        Sector
      </div>
    ),
    cell: ({ row }) => (
      <Badge
        variant="outline"
        className="text-[9px] font-black uppercase tracking-widest bg-surface-2 text-content-3 border-line rounded-md px-2 py-0.5"
      >
        {row.getValue("type")}
      </Badge>
    ),
  },
  {
    accessorKey: "lead_time_days",
    header: () => (
      <div className="text-[10px] font-black uppercase tracking-widest text-content-4 italic">
        Lead Time
      </div>
    ),
    cell: ({ row }) => (
      <div className="font-bold text-content-3 text-xs">
        {row.getValue("lead_time_days")}{" "}
        <span className="text-[9px] text-content-4 font-normal ml-0.5">
          DAYS
        </span>
      </div>
    ),
  },
  {
    accessorKey: "status",
    header: () => (
      <div className="text-[10px] font-black uppercase tracking-widest text-content-4 italic">
        Status
      </div>
    ),
    cell: ({ row }) => {
      const status = row.getValue("status") as string;
      const isActive = status === "ACTIVE";
      return (
        <div className="flex items-center gap-2">
          <div
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              isActive ? "bg-success-fg animate-pulse" : "bg-line",
            )}
          />
          <span
            className={cn(
              "text-[9px] font-black uppercase tracking-widest",
              isActive ? "text-success-fg" : "text-content-4",
            )}
          >
            {status}
          </span>
        </div>
      );
    },
  },
  {
    id: "actions",
    cell: ({ row }) => (
      <div className="flex justify-end pr-4">
        <ActionMenu
          actions={[
            {
              label: "Modify Profile",
              icon: Pencil,
              onClick: () => onEdit(row.original),
            },
            {
              label: "Delete Entity",
              icon: Trash2,
              onClick: () => onDelete(row.original),
              variant: "destructive",
            },
          ]}
        />
      </div>
    ),
  },
];

"use client";

import { ColumnDef } from "@tanstack/react-table";
import { Material } from "@/services/master-data";
import { ActionMenu } from "@/components/ui-custom/action-menu";
import { Pencil, Tags, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface ColumnsProps {
  onEdit: (item: Material) => void;
  onDelete: (item: Material) => void;
  onManageCodes: (item: Material) => void;
}

export const getColumns = ({
  onEdit,
  onDelete,
  onManageCodes,
}: ColumnsProps): ColumnDef<Material>[] => [
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
    id: "quality_codes",
    header: "Internal grades/codes",
    cell: ({ row }) => {
      const codes = row.original.quality_codes || [];
      if (!codes.length)
        return (
          <div className="text-xs font-semibold text-content-4">
            No internal grade codes yet
          </div>
        );
      return (
        <div className="flex max-w-[360px] flex-wrap gap-1.5">
          {codes.slice(0, 4).map((code) => (
            <Badge
              key={code.id}
              variant="outline"
              className="bg-success-bg text-[10px] font-black text-success-fg"
            >
              {code.code}
            </Badge>
          ))}
          {codes.length > 4 ? (
            <Badge variant="outline" className="text-[10px] font-black">
              +{codes.length - 4}
            </Badge>
          ) : null}
        </div>
      );
    },
  },
  {
    id: "trade_sale",
    header: "Trade sale",
    cell: ({ row }) =>
      row.original.is_sellable ? (
        <div className="space-y-1">
          <Badge
            variant="outline"
            className="border-success-border bg-success-bg text-[10px] font-black text-success-fg"
          >
            Sellable
          </Badge>
          <div className="font-mono text-[10px] text-content-3">
            GST {row.original.default_gst_pct ?? 0}%
          </div>
        </div>
      ) : (
        <span className="text-xs font-semibold text-content-4">
          Stock use only
        </span>
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
            label: "Manage internal grade codes",
            icon: Tags,
            onClick: () => onManageCodes(row.original),
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

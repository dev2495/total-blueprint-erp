"use client";

import { ColumnDef } from "@tanstack/react-table";
import { TemplateBlueprint } from "@/services/templates";
import { ActionMenu } from "@/components/ui-custom/action-menu";
import { Pencil, Trash2, CheckCircle, Play } from "lucide-react";

import { StatusBadge } from "@/components/ui-custom/status-badge";

interface ColumnsProps {
  onEdit: (item: TemplateBlueprint) => void;
  onDelete: (item: TemplateBlueprint) => void;
  onApprove: (item: TemplateBlueprint) => void;
  onMakeLive: (item: TemplateBlueprint) => void;
}

export const getColumns = ({
  onEdit,
  onDelete,
  onApprove,
  onMakeLive,
}: ColumnsProps): ColumnDef<TemplateBlueprint>[] => [
  {
    accessorKey: "name",
    header: "Template Name",
    cell: ({ row }) => (
      <div className="font-medium">{row.getValue("name")}</div>
    ),
  },
  {
    accessorKey: "fg_type",
    header: "Type",
    cell: ({ row }) => (
      <StatusBadge status={row.getValue("fg_type")} variant="outline" />
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <StatusBadge status={row.getValue("status")} />,
  },
  {
    accessorKey: "routing_rule_name",
    header: "Routing Rule",
    cell: ({ row }) => (
      <div className="flex items-center gap-2">
        {row.original.routing_rule_name ? (
          <StatusBadge
            status={row.original.routing_rule_name}
            variant="outline"
          />
        ) : (
          <span className="text-xs text-muted-foreground italic">
            No routing
          </span>
        )}
      </div>
    ),
  },
  {
    accessorKey: "version",
    header: "v",
    cell: ({ row }) => row.getValue("version"),
  },
  {
    id: "actions",
    cell: ({ row }) => {
      const status = row.original.status;

      const actions = [
        {
          label: "Edit",
          icon: Pencil,
          onClick: () => onEdit(row.original),
          disabled: status === "LIVE",
        },
        {
          label: "Approve",
          icon: CheckCircle,
          onClick: () => onApprove(row.original),
          show: status === "DRAFT" || status === "ENGINEERING",
        },
        {
          label: "Make LIVE",
          icon: Play,
          onClick: () => onMakeLive(row.original),
          show: status === "APPROVED",
        },
        {
          label: "Delete",
          icon: Trash2,
          onClick: () => onDelete(row.original),
          variant: "destructive" as const,
          disabled: status === "LIVE",
        },
      ].filter((a) => a.show !== false);

      return <ActionMenu actions={actions} />;
    },
  },
];

"use client";

import { ColumnDef } from "@tanstack/react-table";
import { TemplateBlueprint } from "@/services/templates";
import { StatusBadge } from "@/components/ui-custom/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowRight, Clock } from "lucide-react";
import Link from "next/link";

export const columns: ColumnDef<TemplateBlueprint>[] = [
  {
    accessorKey: "name",
    header: "Template / Custom Order",
    cell: ({ row }) => (
      <div className="flex flex-col">
        <span className="font-bold text-content-1">{row.getValue("name")}</span>
        <div className="flex items-center gap-1.5 mt-1">
          {row.original.created_from === "CUSTOM_ORDER" ? (
            <Badge
              variant="destructive"
              className="text-[10px] py-0 h-4 px-1.5 uppercase font-black tracking-tighter"
            >
              Custom Order
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="text-[10px] py-0 h-4 px-1.5 uppercase font-bold"
            >
              Standard
            </Badge>
          )}
          <span className="text-[10px] text-muted-foreground font-mono">
            {row.original.id.slice(0, 8)}
          </span>
        </div>
      </div>
    ),
  },
  {
    accessorKey: "fg_type",
    header: "Format",
    cell: ({ row }) => (
      <StatusBadge status={row.getValue("fg_type")} variant="outline" />
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <div className="flex flex-col gap-1">
        <StatusBadge status={row.getValue("status")} />
        {row.original.status === "DRAFT" && (
          <div className="flex items-center gap-1 text-[10px] text-warning-fg font-medium">
            <Clock className="h-3 w-3" /> PENDING REVIEW
          </div>
        )}
      </div>
    ),
  },
  {
    accessorKey: "created_at",
    header: "Submitted",
    cell: ({ row }) => (
      <div className="text-xs text-muted-foreground">
        {new Intl.DateTimeFormat("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
          hour: "numeric",
          minute: "numeric",
        }).format(new Date(row.getValue("created_at")))}
      </div>
    ),
  },
  {
    id: "actions",
    header: () => <div className="text-right">Action</div>,
    cell: ({ row }) => (
      <div className="text-right">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="group h-8 hover:bg-primary/10 hover:text-primary"
        >
          <Link
            href={`/engineering/approvals/${row.original.id}`}
            className="flex items-center"
          >
            Review Engineering
            <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-1" />
          </Link>
        </Button>
      </div>
    ),
  },
];

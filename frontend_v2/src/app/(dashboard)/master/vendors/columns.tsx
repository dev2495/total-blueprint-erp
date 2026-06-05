"use client";

import { ColumnDef } from "@tanstack/react-table";
import { Vendor } from "@/services/inventory";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MoreHorizontal, Edit, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const TYPE_MAP: Record<
  string,
  { label: string; variant: "default" | "secondary" | "outline" }
> = {
  RM: { label: "Raw Material Supplier", variant: "default" },
  JOBWORK: { label: "Job Worker", variant: "secondary" },
  SERVICE: { label: "Service Provider", variant: "outline" },
  BOTH: { label: "Both (Supplier & JW)", variant: "default" },
};

const STATUS_MAP: Record<string, string> = {
  ACTIVE: "text-success-fg bg-success-bg border-success-border",
  INACTIVE: "text-warning-fg bg-warning-bg border-warning-border",
  BLACKLISTED: "text-danger-fg bg-danger-bg border-danger-border",
};

interface ActionProps {
  onEdit: (vendor: Vendor) => void;
  onDelete: (vendor: Vendor) => void;
}

export const getColumns = ({
  onEdit,
  onDelete,
}: ActionProps): ColumnDef<Vendor>[] => [
  {
    accessorKey: "code",
    header: "Code",
    cell: ({ row }) => (
      <div className="font-mono text-xs font-semibold uppercase">
        {row.original.code}
      </div>
    ),
  },
  {
    accessorKey: "name",
    header: "Vendor Name",
    cell: ({ row }) => (
      <div className="flex flex-col">
        <div className="font-bold text-content-2">{row.original.name}</div>
        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-content-4">
          {row.original.contact_person ||
            row.original.under_group ||
            "Primary contact pending"}
        </div>
      </div>
    ),
  },
  {
    accessorKey: "type",
    header: "Type",
    cell: ({ row }) => {
      const t = TYPE_MAP[row.original.type] || {
        label: row.original.type,
        variant: "outline",
      };
      return (
        <Badge
          variant={t.variant as any}
          className="text-[10px] uppercase font-bold tracking-tighter shadow-sm"
        >
          {t.label}
        </Badge>
      );
    },
  },
  {
    id: "tax",
    header: "Tax",
    cell: ({ row }) => (
      <div className="flex flex-col">
        <div className="text-xs text-content-3 font-mono">
          {row.original.gst_no || "-"}
        </div>
        <div className="text-[10px] text-content-4 font-mono">
          {row.original.pan_no || "PAN pending"}
        </div>
      </div>
    ),
  },
  {
    accessorKey: "phone_number",
    header: "Phone",
    cell: ({ row }) => (
      <div className="text-xs text-content-3 font-mono">
        {row.original.phone_number || "-"}
      </div>
    ),
  },
  {
    accessorKey: "lead_time_days",
    header: "Lead Time",
    cell: ({ row }) => (
      <div className="flex flex-col">
        <div className="text-xs text-content-3">
          {row.original.lead_time_days} Days
        </div>
        <div className="text-[10px] text-content-4">
          {row.original.credit_days || 0} credit days
        </div>
      </div>
    ),
  },
  {
    accessorKey: "turnaround_hours",
    header: "JW TAT",
    cell: ({ row }) => {
      const isJobwork =
        row.original.type === "JOBWORK" || row.original.type === "BOTH";
      return (
        <div className="text-xs text-content-3">
          {isJobwork ? `${row.original.turnaround_hours ?? 0}h` : "-"}
        </div>
      );
    },
  },
  {
    id: "jobwork_caps",
    header: "Jobwork Capabilities",
    cell: ({ row }) => {
      const isJobwork =
        row.original.type === "JOBWORK" || row.original.type === "BOTH";
      if (!isJobwork)
        return <div className="text-xs text-content-4">Not jobwork</div>;
      const caps = row.original.jobwork_capabilities || [];
      if (!caps.length)
        return <div className="text-xs text-content-4">All Processes</div>;
      return (
        <div className="flex flex-wrap gap-1 max-w-[220px]">
          {caps.slice(0, 3).map((cap) => (
            <Badge
              key={cap}
              variant="outline"
              className="text-[10px] font-bold"
            >
              {cap}
            </Badge>
          ))}
          {caps.length > 3 ? (
            <Badge variant="outline" className="text-[10px]">
              +{caps.length - 3}
            </Badge>
          ) : null}
        </div>
      );
    },
  },
  {
    id: "qc_required",
    header: "QC",
    cell: ({ row }) => {
      const isJobwork =
        row.original.type === "JOBWORK" || row.original.type === "BOTH";
      if (!isJobwork) return <div className="text-xs text-content-4">-</div>;
      return (
        <Badge
          variant="outline"
          className={`text-[10px] font-bold ${row.original.qc_required ? "text-primary bg-info-bg border-info-border" : "text-content-3 bg-surface-2 border-line"}`}
        >
          {row.original.qc_required ? "REQUIRED" : "OPTIONAL"}
        </Badge>
      );
    },
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => {
      const classes =
        STATUS_MAP[row.original.status] || "text-content-3 bg-surface-2";
      return (
        <Badge
          variant="outline"
          className={`text-[10px] font-bold ${classes} uppercase tracking-tighter`}
        >
          {row.original.status}
        </Badge>
      );
    },
  },
  {
    id: "actions",
    cell: ({ row }) => {
      const vendor = row.original;

      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-8 w-8 p-0">
              <span className="sr-only">Open menu</span>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Actions</DropdownMenuLabel>
            <DropdownMenuItem
              onClick={() => navigator.clipboard.writeText(vendor.code)}
            >
              Copy Code
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onEdit(vendor)}>
              <Edit className="mr-2 h-4 w-4" /> Edit Vendor
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onDelete(vendor)}
              className="text-danger-fg"
            >
              <Trash2 className="mr-2 h-4 w-4" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      );
    },
  },
];

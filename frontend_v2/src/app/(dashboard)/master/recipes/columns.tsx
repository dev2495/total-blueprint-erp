"use client";

import { ColumnDef } from "@tanstack/react-table";
import { ExtrusionRecipe } from "@/services/recipes";
import { ActionMenu } from "@/components/ui-custom/action-menu";
import { History, Pencil, ShieldOff } from "lucide-react";

interface ColumnsProps {
  onEdit: (recipe: ExtrusionRecipe) => void;
  onDisable: (recipe: ExtrusionRecipe) => void;
}

export const getColumns = ({
  onEdit,
  onDisable,
}: ColumnsProps): ColumnDef<ExtrusionRecipe>[] => [
  {
    accessorKey: "film_variant_name",
    header: "Exact recipe contract",
    cell: ({ row }) => {
      const recipe = row.original;
      return (
        <div className="min-w-[220px]">
          <div className="font-black text-content-1">{recipe.film_variant_name}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs font-semibold text-content-3">
            <span className="rounded-md bg-info-bg px-1.5 py-0.5 text-primary">{recipe.grade_name}</span>
            <span>{recipe.thickness_min_micron}–{recipe.thickness_max_micron} μ</span>
          </div>
        </div>
      );
    },
  },
  {
    id: "components",
    header: "Family formulation",
    cell: ({ row }) => {
      const recipe = row.original;
      return (
        <div className="flex max-w-[580px] flex-wrap gap-1.5">
          {recipe.components.map((c) => (
            <span key={c.id} className="rounded-lg border border-line bg-surface-2 px-2 py-1 text-[11px] font-bold text-content-2">
              {c.granule_name} <span className="font-mono tabular-nums text-content-1">{Number(c.percentage).toFixed(2)}%</span>
            </span>
          ))}
        </div>
      );
    },
  },
  {
    id: "revision",
    header: "Lifecycle",
    cell: ({ row }) => {
      const recipe = row.original;
      return (
        <div className="min-w-[130px]">
          <div className="flex items-center gap-1.5 text-sm font-black text-content-1"><History className="h-3.5 w-3.5 text-primary" />v{recipe.revision_no || 1}</div>
          <div className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ${recipe.is_active ? "bg-success-bg text-success-fg" : "bg-surface-3 text-content-3"}`}>
            {recipe.is_active ? "Active" : "Disabled"}
          </div>
          <div className="mt-1 text-[10px] font-semibold text-content-4">
            {recipe.updated_at ? new Date(recipe.updated_at).toLocaleDateString("en-IN") : "Legacy recipe"}
          </div>
        </div>
      );
    },
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
          ...(row.original.is_active ? [{
            label: "Disable",
            icon: ShieldOff,
            onClick: () => onDisable(row.original),
            variant: "destructive" as const,
          }] : []),
        ]}
      />
    ),
  },
];

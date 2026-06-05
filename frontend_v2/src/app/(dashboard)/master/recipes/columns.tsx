"use client";

import { ColumnDef } from "@tanstack/react-table";
import { ExtrusionRecipe } from "@/services/recipes";
import { ActionMenu } from "@/components/ui-custom/action-menu";
import { Pencil, Trash2 } from "lucide-react";

interface ColumnsProps {
  onEdit: (recipe: ExtrusionRecipe) => void;
  onDelete: (recipe: ExtrusionRecipe) => void;
}

export const getColumns = ({
  onEdit,
  onDelete,
}: ColumnsProps): ColumnDef<ExtrusionRecipe>[] => [
  {
    accessorKey: "film_variant_name",
    header: "Variant",
    cell: ({ row }) => (
      <div className="font-medium">{row.getValue("film_variant_name")}</div>
    ),
  },
  {
    accessorKey: "grade_name",
    header: "Grade",
    cell: ({ row }) => <div>{row.getValue("grade_name")}</div>,
  },
  {
    id: "thickness",
    header: "Thickness",
    cell: ({ row }) => {
      const recipe = row.original;
      return (
        <div>
          {recipe.thickness_min_micron} - {recipe.thickness_max_micron} μ
        </div>
      );
    },
  },
  {
    id: "components",
    header: "Components",
    cell: ({ row }) => {
      const recipe = row.original;
      return (
        <ul className="text-xs list-disc pl-4 text-muted-foreground">
          {recipe.components.map((c) => (
            <li key={c.id}>
              {c.granule_name}: {c.percentage}%
            </li>
          ))}
        </ul>
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

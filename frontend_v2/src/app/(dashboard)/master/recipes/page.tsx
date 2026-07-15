"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { recipeService, ExtrusionRecipe } from "@/services/recipes";
import { MasterRegistryShell } from "@/components/master/master-registry-shell";
import { DataTable } from "@/components/ui/data-table";
import { getColumns } from "./columns";
import { Button } from "@/components/ui/button";
import { Factory, Layers, Palette, Plus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useState } from "react";
import { RecipeForm } from "./recipe-form";
import { GradeMasterDialog } from "./grade-master-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { describeApiError } from "@/lib/api";

const recipeSavedMessage = (recipe: ExtrusionRecipe, verb: "created" | "updated") => {
  const stats = recipe.bom_refresh;
  if (!stats?.matched_items) return `Recipe ${verb} successfully.`;
  if (stats.failed || stats.still_blocked) {
    return `Recipe ${verb}. ${stats.refreshed} of ${stats.matched_items} matching open BOMs refreshed; ${stats.failed + stats.still_blocked} still require review.`;
  }
  return `Recipe ${verb}. ${stats.refreshed} matching open BOM${stats.refreshed === 1 ? "" : "s"} and ${stats.queues_rebuilt} planning queue${stats.queues_rebuilt === 1 ? "" : "s"} refreshed automatically.`;
};

export default function RecipesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingRecipe, setEditingRecipe] = useState<ExtrusionRecipe | null>(
    null,
  );
  const [recipeToDelete, setRecipeToDelete] = useState<ExtrusionRecipe | null>(
    null,
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [createSubmitError, setCreateSubmitError] = useState<string | null>(
    null,
  );
  const [updateSubmitError, setUpdateSubmitError] = useState<string | null>(
    null,
  );

  const { data: recipes } = useQuery({
    queryKey: ["recipes"],
    queryFn: recipeService.getAll,
  });

  const createMutation = useMutation({
    mutationFn: recipeService.create,
    onSuccess: (recipe) => {
      queryClient.invalidateQueries({ queryKey: ["recipes"] });
      queryClient.invalidateQueries({ queryKey: ["sales-orders"] });
      queryClient.invalidateQueries({ queryKey: ["planner-control-tower"] });
      toast({ title: "Recipe live", description: recipeSavedMessage(recipe, "created") });
      setCreateSubmitError(null);
      setIsCreateOpen(false);
    },
    onError: (error: unknown) => {
      const description = describeApiError(error, "Failed to create recipe.");
      setCreateSubmitError(description);
      toast({ title: "Error", description, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mutationFn: ({ id, data }: { id: string; data: unknown }) =>
      recipeService.update(id, data as any),
    onSuccess: (recipe) => {
      queryClient.invalidateQueries({ queryKey: ["recipes"] });
      queryClient.invalidateQueries({ queryKey: ["sales-orders"] });
      queryClient.invalidateQueries({ queryKey: ["planner-control-tower"] });
      toast({ title: "Recipe live", description: recipeSavedMessage(recipe, "updated") });
      setUpdateSubmitError(null);
      setEditingRecipe(null);
    },
    onError: (error: unknown) => {
      const description = describeApiError(error, "Failed to update recipe.");
      setUpdateSubmitError(description);
      toast({ title: "Error", description, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: recipeService.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["recipes"] });
      toast({ title: "Success", description: "Recipe deleted successfully." });
    },
    onError: (error: unknown) => {
      toast({
        title: "Error",
        description: describeApiError(error, "Failed to delete recipe."),
        variant: "destructive",
      });
    },
  });

  const filteredRecipes = (recipes || []).filter((recipe) => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return true;
    return (
      recipe.film_variant_name.toLowerCase().includes(query) ||
      recipe.grade_name.toLowerCase().includes(query)
    );
  });

  return (
    <MasterRegistryShell
      title="Extrusion Recipes"
      description="Manage formulations and granule blends used for extrusion output across film variants and grades."
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      searchPlaceholder="Search by variant or grade..."
      stats={[
        {
          label: "Recipes",
          value: (recipes || []).length,
          subLabel: "Configured formulations",
          icon: Palette,
          toneClassName: "bg-info-bg text-primary",
        },
        {
          label: "Active",
          value: (recipes || []).filter((recipe) => recipe.is_active).length,
          subLabel: "Ready for production planning",
          icon: Factory,
          toneClassName: "bg-success-bg text-success-fg",
        },
        {
          label: "Variants covered",
          value: new Set(
            (recipes || []).map((recipe) => recipe.film_variant_name),
          ).size,
          subLabel: "Film variants with a recipe",
          icon: Layers,
          toneClassName: "bg-info-bg text-primary",
        },
        {
          label: "Visible",
          value: filteredRecipes.length,
          subLabel: "Matching current search",
          icon: Layers,
          toneClassName: "bg-surface-2 text-content-2",
        },
      ]}
      chips={[
        { kind: "materialCategory", value: "GRANULE" },
        { kind: "processState", value: "EXTRUDED", label: "Extrusion base" },
        { kind: "origin", value: "IN_HOUSE", label: "Made in-house" },
      ]}
      actions={
        <div className="flex gap-2">
          <GradeMasterDialog />
          <Dialog
            open={isCreateOpen}
            onOpenChange={(open) => {
              setIsCreateOpen(open);
              if (open) {
                setCreateSubmitError(null);
              }
            }}
          >
            <DialogTrigger asChild>
              <Button className="rounded-xl shadow-md hover:shadow-lg transition-all">
                <Plus className="mr-2 h-4 w-4" /> Add Recipe
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl">
              <DialogHeader>
                <DialogTitle>Create Extrusion Recipe</DialogTitle>
              </DialogHeader>
              <RecipeForm
                onSubmit={(data) => {
                  setCreateSubmitError(null);
                  createMutation.mutate(data);
                }}
                isLoading={createMutation.isPending}
                submitError={createSubmitError}
              />
            </DialogContent>
          </Dialog>
        </div>
      }
    >
      <DataTable
        columns={getColumns({
          onEdit: (recipe) => {
            setUpdateSubmitError(null);
            setEditingRecipe(recipe);
          },
          onDelete: (recipe) => setRecipeToDelete(recipe),
        })}
        data={filteredRecipes}
        filterColumn="film_variant_name"
        filterPlaceholder="Filter by variant..."
      />

      <Dialog
        open={!!editingRecipe}
        onOpenChange={(open) => {
          if (!open) {
            setEditingRecipe(null);
          } else {
            setUpdateSubmitError(null);
          }
        }}
      >
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Edit Recipe</DialogTitle>
          </DialogHeader>
          {editingRecipe && (
            <RecipeForm
              initialData={editingRecipe}
              onSubmit={(data) => {
                setUpdateSubmitError(null);
                updateMutation.mutate({ id: editingRecipe.id, data });
              }}
              isLoading={updateMutation.isPending}
              submitError={updateSubmitError}
            />
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!recipeToDelete}
        onOpenChange={(open) => !open && setRecipeToDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete the
              recipe.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (recipeToDelete) {
                  deleteMutation.mutate(recipeToDelete.id);
                  setRecipeToDelete(null);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MasterRegistryShell>
  );
}

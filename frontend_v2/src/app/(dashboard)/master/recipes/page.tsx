"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { recipeService, ExtrusionRecipe } from "@/services/recipes";
import { MasterRegistryShell } from "@/components/master/master-registry-shell";
import { DataTable } from "@/components/ui/data-table";
import { getColumns } from "./columns";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Factory, Layers, Palette, Plus, RefreshCw, ShieldCheck, Snowflake } from "lucide-react";
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
  if (!stats) return `Recipe ${verb} successfully.`;
  if (stats.failed || stats.still_blocked) {
    return `Recipe ${verb}. ${stats.refreshed} of ${stats.matched_items} matching open BOMs refreshed; ${stats.failed + stats.still_blocked} still require review.`;
  }
  return `Recipe ${verb}. ${stats.refreshed} open BOM${stats.refreshed === 1 ? "" : "s"} refreshed, ${stats.queues_rebuilt} untouched queue${stats.queues_rebuilt === 1 ? "" : "s"} rebuilt, and ${stats.historical_frozen || 0} historical line${stats.historical_frozen === 1 ? "" : "s"} stayed frozen.`;
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
  const [lastSave, setLastSave] = useState<ExtrusionRecipe | null>(null);
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
      setLastSave(recipe);
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
      setLastSave(recipe);
      setUpdateSubmitError(null);
      setEditingRecipe(null);
    },
    onError: (error: unknown) => {
      const description = describeApiError(error, "Failed to update recipe.");
      setUpdateSubmitError(description);
      toast({ title: "Error", description, variant: "destructive" });
    },
  });

  const disableMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => recipeService.disable(id, reason),
    onSuccess: (recipe) => {
      queryClient.invalidateQueries({ queryKey: ["recipes"] });
      queryClient.invalidateQueries({ queryKey: ["sales-orders"] });
      queryClient.invalidateQueries({ queryKey: ["planner-control-tower"] });
      setLastSave(recipe);
      toast({ title: "Recipe disabled", description: "The recipe remains in revision history and cannot resolve for new orders." });
    },
    onError: (error: unknown) => {
      toast({
        title: "Error",
        description: describeApiError(error, "Failed to disable recipe."),
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
            <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
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
      {lastSave ? (
        <div className="mb-5 overflow-hidden rounded-2xl border border-success-border bg-success-bg/40">
          <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
            <div className="flex items-start gap-3">
              <div className="rounded-xl bg-success-bg p-2 text-success-fg"><CheckCircle2 className="h-5 w-5" /></div>
              <div>
                <div className="text-sm font-black text-content-1">Revision v{lastSave.revision_no || 1} is live</div>
                <div className="mt-0.5 text-xs font-semibold text-content-3">
                  {lastSave.film_variant_name} · {lastSave.grade_name} · {lastSave.thickness_min_micron}–{lastSave.thickness_max_micron} μ
                </div>
              </div>
            </div>
            <button type="button" className="text-xs font-bold text-content-3 underline-offset-4 hover:underline" onClick={() => setLastSave(null)}>Dismiss</button>
          </div>
          <div className="grid grid-cols-2 gap-px border-t border-success-border bg-success-border sm:grid-cols-4">
            {[
              { label: "Open BOMs refreshed", value: lastSave.bom_refresh?.refreshed || 0, icon: RefreshCw },
              { label: "Queues rebuilt", value: lastSave.bom_refresh?.queues_rebuilt || 0, icon: Factory },
              { label: "Frozen history", value: lastSave.bom_refresh?.historical_frozen || 0, icon: Snowflake },
              { label: "Needs review", value: (lastSave.bom_refresh?.failed || 0) + (lastSave.bom_refresh?.still_blocked || 0), icon: ShieldCheck },
            ].map((metric) => (
              <div key={metric.label} className="bg-surface-1 px-4 py-3">
                <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-content-4"><metric.icon className="h-3.5 w-3.5" />{metric.label}</div>
                <div className="mt-1 font-mono text-xl font-black tabular-nums text-content-1">{metric.value}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <DataTable
        columns={getColumns({
          onEdit: (recipe) => {
            setUpdateSubmitError(null);
            setEditingRecipe(recipe);
          },
          onDisable: (recipe) => setRecipeToDelete(recipe),
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
        <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
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
            <AlertDialogTitle>Disable this recipe?</AlertDialogTitle>
            <AlertDialogDescription>
              New orders will stop resolving this exact variant, grade and thickness contract. Existing released jobs remain frozen and the complete revision history is preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (recipeToDelete) {
                  disableMutation.mutate({ id: recipeToDelete.id, reason: "Disabled from recipe registry" });
                  setRecipeToDelete(null);
                }
              }}
              className="bg-warning-bg text-warning-fg hover:bg-warning-bg/80"
            >
              Disable recipe
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MasterRegistryShell>
  );
}

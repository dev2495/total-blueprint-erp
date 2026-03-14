"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { recipeService, ExtrusionRecipe } from "@/services/recipes"
import { PageHeader } from "@/components/ui-custom/page-header"
import { DataTable } from "@/components/ui/data-table"
import { getColumns } from "./columns"
import { Button } from "@/components/ui/button"
import { Plus } from "lucide-react"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { useState } from "react"
import { RecipeForm } from "./recipe-form"
import { GradeMasterDialog } from "./grade-master-dialog"
import { useToast } from "@/hooks/use-toast"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog"

export default function RecipesPage() {
    const { toast } = useToast()
    const queryClient = useQueryClient()
    const [isCreateOpen, setIsCreateOpen] = useState(false)
    const [editingRecipe, setEditingRecipe] = useState<ExtrusionRecipe | null>(null)
    const [recipeToDelete, setRecipeToDelete] = useState<ExtrusionRecipe | null>(null)

    const { data: recipes } = useQuery({
        queryKey: ["recipes"],
        queryFn: recipeService.getAll,
    })

    const createMutation = useMutation({
        mutationFn: recipeService.create,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["recipes"] })
            toast({ title: "Success", description: "Recipe created successfully." })
            setIsCreateOpen(false)
        },
        onError: (error: unknown) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const err = error as any
            const msg = err.response?.data?.non_field_errors?.[0] || err.message || "Failed to create"
            toast({ title: "Error", description: msg, variant: "destructive" })
        }
    })

    const updateMutation = useMutation({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mutationFn: ({ id, data }: { id: string, data: unknown }) => recipeService.update(id, data as any),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["recipes"] })
            toast({ title: "Success", description: "Recipe updated successfully." })
            setEditingRecipe(null)
        },
        onError: (error: unknown) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const err = error as any
            const msg = err.response?.data?.non_field_errors?.[0] || err.message || "Failed to update"
            toast({ title: "Error", description: msg, variant: "destructive" })
        }
    })

    const deleteMutation = useMutation({
        mutationFn: recipeService.delete,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["recipes"] })
            toast({ title: "Success", description: "Recipe deleted successfully." })
        },
        onError: (error: unknown) => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const err = error as any
            toast({ title: "Error", description: err.message || "Failed to delete", variant: "destructive" })
        }
    })

    return (
        <div className="space-y-6">
            <PageHeader
                title="Extrusion Recipes"
                description="Manage formulations and material blends for film extrusion."
                actions={
                    <div className="flex gap-2">
                        <GradeMasterDialog />
                        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                            <DialogTrigger asChild>
                                <Button>
                                    <Plus className="mr-2 h-4 w-4" /> Add Recipe
                                </Button>
                            </DialogTrigger>
                            <DialogContent className="max-w-2xl">
                                <DialogHeader>
                                    <DialogTitle>Create Extrusion Recipe</DialogTitle>
                                </DialogHeader>
                                <RecipeForm
                                    onSubmit={(data) => createMutation.mutate(data)}
                                    isLoading={createMutation.isPending}
                                />
                            </DialogContent>
                        </Dialog>
                    </div>
                }
            />

            <DataTable
                columns={getColumns({
                    onEdit: setEditingRecipe,
                    onDelete: (recipe) => setRecipeToDelete(recipe)
                })}
                data={recipes || []}
                filterColumn="film_variant_name"
                filterPlaceholder="Filter by variant..."
            />

            <Dialog open={!!editingRecipe} onOpenChange={(open) => !open && setEditingRecipe(null)}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>Edit Recipe</DialogTitle>
                    </DialogHeader>
                    {editingRecipe && (
                        <RecipeForm
                            initialData={editingRecipe}
                            onSubmit={(data) => updateMutation.mutate({ id: editingRecipe.id, data })}
                            isLoading={updateMutation.isPending}
                        />
                    )}
                </DialogContent>
            </Dialog>

            <AlertDialog open={!!recipeToDelete} onOpenChange={(open) => !open && setRecipeToDelete(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This action cannot be undone. This will permanently delete the recipe.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => {
                                if (recipeToDelete) {
                                    deleteMutation.mutate(recipeToDelete.id)
                                    setRecipeToDelete(null)
                                }
                            }}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}

"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { filmVariantService, FilmVariant } from "@/services/film-variants"
import { Button } from "@/components/ui/button"
import { Plus } from "lucide-react"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogTrigger,
} from "@/components/ui/dialog"
import { useState } from "react"
import { FilmVariantForm } from "./film-variant-form"
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

import { DataTable } from "@/components/ui/data-table"
import { getColumns } from "./columns"
import { FactoryPageLayout } from "@/components/factory/FactoryPageLayout"
import { Card, CardContent } from "@/components/ui/card"

export default function FilmVariantsPage() {
    const { toast } = useToast()
    const queryClient = useQueryClient()
    const [isCreateOpen, setIsCreateOpen] = useState(false)
    const [editingVariant, setEditingVariant] = useState<FilmVariant | null>(null)
    const [variantToDelete, setVariantToDelete] = useState<FilmVariant | null>(null)
    const [searchQuery, setSearchQuery] = useState("")

    const { data: variants } = useQuery({
        queryKey: ["film-variants"],
        queryFn: filmVariantService.getAll,
    })

    const createMutation = useMutation({
        mutationFn: filmVariantService.create,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["film-variants"] })
            toast({ title: "Success", description: "Film Variant created successfully." })
            setIsCreateOpen(false)
        },
        onError: (error: Error) => {
            toast({ title: "Error", description: error.message || "Failed to create", variant: "destructive" })
        }
    })

    const updateMutation = useMutation({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mutationFn: ({ id, data }: { id: string, data: any }) => filmVariantService.update(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["film-variants"] })
            toast({ title: "Success", description: "Film Variant updated successfully." })
            setEditingVariant(null)
        },
        onError: (error: Error) => {
            toast({ title: "Error", description: error.message || "Failed to update", variant: "destructive" })
        }
    })

    const deleteMutation = useMutation({
        mutationFn: filmVariantService.delete,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["film-variants"] })
            toast({ title: "Success", description: "Film Variant deleted successfully." })
        },
        onError: (error: Error) => {
            toast({ title: "Error", description: error.message || "Failed to delete", variant: "destructive" })
        }
    })

    const filteredVariants = variants?.filter(v =>
        v.name.toLowerCase().includes(searchQuery.toLowerCase())
    ) || []

    return (
        <FactoryPageLayout
            title="Film Variants"
            description="Define specific variants of film families with unique properties."
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder="Search variants..."
            actions={
                <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                    <DialogTrigger asChild>
                        <Button className="rounded-xl shadow-md hover:shadow-lg transition-all">
                            <Plus className="mr-2 h-4 w-4" /> Add Variant
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Create Film Variant</DialogTitle>
                            <DialogDescription>
                                Define a new variant with specific grade and properties.
                            </DialogDescription>
                        </DialogHeader>
                        <FilmVariantForm
                            onSubmit={(data) => createMutation.mutate(data)}
                            isLoading={createMutation.isPending}
                        />
                    </DialogContent>
                </Dialog>
            }
        >
            <Card className="border-none shadow-premium rounded-[1.5rem] overflow-hidden bg-white">
                <CardContent className="p-0">
                    <DataTable
                        columns={getColumns({
                            onEdit: setEditingVariant,
                            onDelete: (variant) => setVariantToDelete(variant)
                        })}
                        data={filteredVariants}
                        filterColumn="name"
                        filterPlaceholder="Filter variants..."
                    />
                </CardContent>
            </Card>

            <Dialog open={!!editingVariant} onOpenChange={(open) => !open && setEditingVariant(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Edit Film Variant</DialogTitle>
                        <DialogDescription>
                            Update the properties and grade of the selected variant.
                        </DialogDescription>
                    </DialogHeader>
                    {editingVariant && (
                        <FilmVariantForm
                            initialData={editingVariant}
                            onSubmit={(data) => updateMutation.mutate({ id: editingVariant.id, data })}
                            isLoading={updateMutation.isPending}
                        />
                    )}
                </DialogContent>
            </Dialog>

            <AlertDialog open={!!variantToDelete} onOpenChange={(open) => !open && setVariantToDelete(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => {
                                if (variantToDelete) {
                                    deleteMutation.mutate(variantToDelete.id)
                                    setVariantToDelete(null)
                                }
                            }}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </FactoryPageLayout>
    )
}

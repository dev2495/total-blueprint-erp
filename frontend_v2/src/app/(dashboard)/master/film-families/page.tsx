"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { filmFamilyService, FilmFamily } from "@/services/film-families"

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
import { FilmFamilyForm } from "./film-family-form"
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

import { PageHeader } from "@/components/ui-custom/page-header"
import { DataTable } from "@/components/ui/data-table"
import { getColumns } from "./columns"

export default function FilmFamiliesPage() {
    const { toast } = useToast()
    const queryClient = useQueryClient()
    const [isCreateOpen, setIsCreateOpen] = useState(false)
    const [editingFamily, setEditingFamily] = useState<FilmFamily | null>(null)
    const [familyToDelete, setFamilyToDelete] = useState<FilmFamily | null>(null)

    const { data: families } = useQuery({
        queryKey: ["film-families"],
        queryFn: filmFamilyService.getAll,
    })

    const createMutation = useMutation({
        mutationFn: filmFamilyService.create,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["film-families"] })
            toast({ title: "Success", description: "Film Family created successfully." })
            setIsCreateOpen(false)
        },
        onError: (error: Error) => {
            toast({ title: "Error", description: error.message || "Failed to create", variant: "destructive" })
        }
    })

    const updateMutation = useMutation({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mutationFn: ({ id, data }: { id: string, data: any }) => filmFamilyService.update(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["film-families"] })
            toast({ title: "Success", description: "Film Family updated successfully." })
            setEditingFamily(null)
        },
        onError: (error: Error) => {
            toast({ title: "Error", description: error.message || "Failed to update", variant: "destructive" })
        }
    })

    const deleteMutation = useMutation({
        mutationFn: filmFamilyService.delete,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["film-families"] })
            toast({ title: "Success", description: "Film Family deleted successfully." })
        },
        onError: (error: Error) => {
            toast({ title: "Error", description: error.message || "Failed to delete", variant: "destructive" })
        }
    })

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <PageHeader
                    title="Film Families"
                    description="Manage foundational material families and their theoretical densities."
                    actions={
                        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                            <DialogTrigger asChild>
                                <Button>
                                    <Plus className="mr-2 h-4 w-4" /> Add Family
                                </Button>
                            </DialogTrigger>
                            <DialogContent>
                                <DialogHeader>
                                    <DialogTitle>Create Film Family</DialogTitle>
                                    <DialogDescription>
                                        Add a new foundational film family with its base density.
                                    </DialogDescription>
                                </DialogHeader>
                                <FilmFamilyForm
                                    onSubmit={(data) => createMutation.mutate({
                                        name: data.name,
                                        density_gcm3: data.density_gcm3
                                    })}
                                    isLoading={createMutation.isPending}
                                />
                            </DialogContent>
                        </Dialog>
                    }
                />
            </div>

            <DataTable
                columns={getColumns({
                    onEdit: setEditingFamily,
                    onDelete: (family) => setFamilyToDelete(family)
                })}
                data={families || []}
                filterColumn="name"
                filterPlaceholder="Filter families..."
            />

            <Dialog open={!!editingFamily} onOpenChange={(open) => !open && setEditingFamily(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Edit Film Family</DialogTitle>
                        <DialogDescription>
                            Update the properties of the selected film family.
                        </DialogDescription>
                    </DialogHeader>
                    {editingFamily && (
                        <FilmFamilyForm
                            initialData={editingFamily}
                            onSubmit={(data) => updateMutation.mutate({
                                id: editingFamily.id,
                                data: {
                                    name: data.name,
                                    density_gcm3: data.density_gcm3
                                }
                            })}
                            isLoading={updateMutation.isPending}
                        />
                    )}
                </DialogContent>
            </Dialog>

            <AlertDialog open={!!familyToDelete} onOpenChange={(open) => !open && setFamilyToDelete(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This action cannot be undone. This will permanently delete the film family
                            and may affect related variants.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => {
                                if (familyToDelete) {
                                    deleteMutation.mutate(familyToDelete.id)
                                    setFamilyToDelete(null)
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

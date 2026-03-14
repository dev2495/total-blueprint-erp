"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { filmFamilyService, FilmFamily } from "@/services/film-families"

import { Button } from "@/components/ui/button"
import { FlaskConical, Layers, Plus, Tag } from "lucide-react"
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

import { MasterRegistryShell } from "@/components/master/master-registry-shell"
import { DataTable } from "@/components/ui/data-table"
import { getColumns } from "./columns"

export default function FilmFamiliesPage() {
    const { toast } = useToast()
    const queryClient = useQueryClient()
    const [isCreateOpen, setIsCreateOpen] = useState(false)
    const [editingFamily, setEditingFamily] = useState<FilmFamily | null>(null)
    const [familyToDelete, setFamilyToDelete] = useState<FilmFamily | null>(null)
    const [searchQuery, setSearchQuery] = useState("")

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

    const filteredFamilies = (families || []).filter((family) => {
        const query = searchQuery.trim().toLowerCase()
        if (!query) return true
        return (
            family.name.toLowerCase().includes(query) ||
            String(family.commercial_family_name || "").toLowerCase().includes(query)
        )
    })

    const avgDensity = (families || []).length
        ? (
            (families || []).reduce((sum, family) => sum + Number(family.density_gcm3 || 0), 0) /
            Math.max((families || []).length, 1)
        ).toFixed(3)
        : "0.000"

    return (
        <MasterRegistryShell
            title="Film Families"
            description="Manage foundational film structures and the base densities that drive weight and yield calculations."
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder="Search film families..."
            stats={[
                { label: "Film families", value: (families || []).length, subLabel: "Base material structures", icon: Layers, toneClassName: "bg-indigo-50 text-indigo-700" },
                { label: "Visible", value: filteredFamilies.length, subLabel: "Matching current search", icon: Tag, toneClassName: "bg-slate-50 text-slate-700" },
                { label: "Linked aliases", value: (families || []).filter((family) => Boolean((family as any).commercial_family || (family as any).commercial_family_name)).length, subLabel: "Business family naming attached", icon: Tag, toneClassName: "bg-violet-50 text-violet-700" },
                { label: "Avg density", value: `${avgDensity} g/cc`, subLabel: "Used by the physics layer", icon: FlaskConical, toneClassName: "bg-cyan-50 text-cyan-700" },
            ]}
            chips={[
                { kind: "materialCategory", value: "FILM" },
                { kind: "processState", value: "PLAIN", label: "Extrusion base" },
                { kind: "processState", value: "LAMINATED", label: "Conversion ready" },
            ]}
            actions={
                <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                    <DialogTrigger asChild>
                        <Button className="rounded-xl shadow-md hover:shadow-lg transition-all">
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
                                density_gcm3: data.density_gcm3,
                                commercial_family: !data.commercial_family || data.commercial_family === "__NONE__" ? null : data.commercial_family,
                            })}
                            isLoading={createMutation.isPending}
                        />
                    </DialogContent>
                </Dialog>
            }
        >

            <DataTable
                columns={getColumns({
                    onEdit: setEditingFamily,
                    onDelete: (family) => setFamilyToDelete(family)
                })}
                data={filteredFamilies}
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
                                    density_gcm3: data.density_gcm3,
                                    commercial_family: !data.commercial_family || data.commercial_family === "__NONE__" ? null : data.commercial_family,
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
        </MasterRegistryShell>
    )
}

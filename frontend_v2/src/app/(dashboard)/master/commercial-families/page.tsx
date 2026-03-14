"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus } from "lucide-react"

import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/ui/data-table"
import { PageHeader } from "@/components/ui-custom/page-header"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
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

import { CommercialFamilyForm } from "./commercial-family-form"
import { getColumns } from "./columns"
import { commercialFamilyService, CommercialFamily } from "@/services/commercial-families"

export default function CommercialFamiliesPage() {
    const { toast } = useToast()
    const queryClient = useQueryClient()
    const [isCreateOpen, setIsCreateOpen] = useState(false)
    const [editingFamily, setEditingFamily] = useState<CommercialFamily | null>(null)
    const [familyToDelete, setFamilyToDelete] = useState<CommercialFamily | null>(null)

    const { data: families = [] } = useQuery({
        queryKey: ["commercial-families"],
        queryFn: commercialFamilyService.getAll,
    })

    const createMutation = useMutation({
        mutationFn: commercialFamilyService.create,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["commercial-families"] })
            toast({ title: "Business family created", description: "Commercial family saved successfully." })
            setIsCreateOpen(false)
        },
        onError: (error: Error) => {
            toast({ title: "Create failed", description: error.message || "Could not create commercial family.", variant: "destructive" })
        },
    })

    const updateMutation = useMutation({
        mutationFn: ({ id, data }: { id: string; data: Parameters<typeof commercialFamilyService.update>[1] }) => commercialFamilyService.update(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["commercial-families"] })
            toast({ title: "Business family updated", description: "Commercial family updated successfully." })
            setEditingFamily(null)
        },
        onError: (error: Error) => {
            toast({ title: "Update failed", description: error.message || "Could not update commercial family.", variant: "destructive" })
        },
    })

    const deleteMutation = useMutation({
        mutationFn: commercialFamilyService.delete,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["commercial-families"] })
            toast({ title: "Business family deleted", description: "Commercial family deleted successfully." })
        },
        onError: (error: Error) => {
            toast({ title: "Delete failed", description: error.message || "Could not delete commercial family.", variant: "destructive" })
        },
    })

    return (
        <div className="space-y-6">
            <PageHeader
                title="Commercial Families"
                description="Controlled business-facing family names used for stock naming, grouping, reporting, and planner readability."
                actions={
                    <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                        <DialogTrigger asChild>
                            <Button>
                                <Plus className="mr-2 h-4 w-4" /> Add Business Family
                            </Button>
                        </DialogTrigger>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>Create Commercial Family</DialogTitle>
                                <DialogDescription>
                                    Create the human-friendly stock family that explorer, planner, and reports will use.
                                </DialogDescription>
                            </DialogHeader>
                            <CommercialFamilyForm onSubmit={(data) => createMutation.mutate(data)} isLoading={createMutation.isPending} />
                        </DialogContent>
                    </Dialog>
                }
            />

            <DataTable
                columns={getColumns({
                    onEdit: setEditingFamily,
                    onDelete: (family) => setFamilyToDelete(family),
                })}
                data={families}
                filterColumn="name"
                filterPlaceholder="Filter business families..."
            />

            <Dialog open={!!editingFamily} onOpenChange={(open) => !open && setEditingFamily(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Edit Commercial Family</DialogTitle>
                        <DialogDescription>Update the business naming defaults used across stock intelligence.</DialogDescription>
                    </DialogHeader>
                    {editingFamily ? (
                        <CommercialFamilyForm
                            initialData={editingFamily}
                            onSubmit={(data) => updateMutation.mutate({ id: editingFamily.id, data })}
                            isLoading={updateMutation.isPending}
                        />
                    ) : null}
                </DialogContent>
            </Dialog>

            <AlertDialog open={!!familyToDelete} onOpenChange={(open) => !open && setFamilyToDelete(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete business family?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This removes the controlled alias used by templates, materials, reports, and planner labels. Only delete it if nothing active depends on it.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={() => {
                                if (familyToDelete) {
                                    deleteMutation.mutate(familyToDelete.id)
                                    setFamilyToDelete(null)
                                }
                            }}
                        >
                            Delete
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}


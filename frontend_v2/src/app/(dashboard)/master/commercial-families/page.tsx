"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Layers, Package, Plus, Tag } from "lucide-react"

import { useToast } from "@/hooks/use-toast"
import { Button } from "@/components/ui/button"
import { DataTable } from "@/components/ui/data-table"
import { MasterRegistryShell } from "@/components/master/master-registry-shell"
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
    const [searchQuery, setSearchQuery] = useState("")

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

    const filteredFamilies = families.filter((family) => {
        const query = searchQuery.trim().toLowerCase()
        if (!query) return true
        return (
            family.name.toLowerCase().includes(query) ||
            family.code.toLowerCase().includes(query) ||
            String(family.default_reporting_group || "").toLowerCase().includes(query)
        )
    })

    return (
        <MasterRegistryShell
            title="Commercial Families"
            description="Controlled business-facing family names used for stock naming, grouping, reports, and planner readability."
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder="Search business families..."
            stats={[
                { label: "Total families", value: families.length, subLabel: "Controlled business aliases", icon: Tag, toneClassName: "bg-violet-50 text-violet-700" },
                { label: "Active", value: families.filter((family) => family.active).length, subLabel: "Visible across planner and reports", icon: Layers, toneClassName: "bg-emerald-50 text-emerald-700" },
                { label: "Roll defaults", value: families.filter((family) => String(family.default_form || "").toUpperCase() === "ROLL").length, subLabel: "Family defaults for roll stock", icon: Package, toneClassName: "bg-indigo-50 text-indigo-700" },
                { label: "Pouch defaults", value: families.filter((family) => String(family.default_form || "").toUpperCase() === "POUCH").length, subLabel: "Family defaults for pouch stock", icon: Package, toneClassName: "bg-cyan-50 text-cyan-700" },
            ]}
            chips={[
                { kind: "processState", value: "PRINTED", label: "Readable stock names" },
                { kind: "stockStrategy", value: "FINAL_STOCK", label: "Planner aligned" },
                { kind: "origin", value: "IN_HOUSE", label: "Report friendly" },
            ]}
            actions={
                <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                    <DialogTrigger asChild>
                        <Button className="rounded-xl shadow-md hover:shadow-lg transition-all">
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
        >

            <DataTable
                columns={getColumns({
                    onEdit: setEditingFamily,
                    onDelete: (family) => setFamilyToDelete(family),
                })}
                data={filteredFamilies}
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
        </MasterRegistryShell>
    )
}

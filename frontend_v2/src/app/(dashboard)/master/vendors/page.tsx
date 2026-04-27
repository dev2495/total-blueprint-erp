"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { inventoryService, Vendor } from "@/services/inventory"
import { Button } from "@/components/ui/button"
import { Factory, Plus, ShieldCheck, Truck } from "lucide-react"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogTrigger,
} from "@/components/ui/dialog"
import { useState } from "react"
import { VendorForm } from "./vendor-form"
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
import { Card, CardContent } from "@/components/ui/card"
import { MasterRegistryShell } from "@/components/master/master-registry-shell"

export default function VendorsPage() {
    const { toast } = useToast()
    const queryClient = useQueryClient()
    const [isCreateOpen, setIsCreateOpen] = useState(false)
    const [editingVendor, setEditingVendor] = useState<Vendor | null>(null)
    const [vendorToDelete, setVendorToDelete] = useState<Vendor | null>(null)
    const [searchQuery, setSearchQuery] = useState("")

    const { data: vendors } = useQuery({
        queryKey: ["vendors"],
        queryFn: inventoryService.getVendors,
    })

    const createMutation = useMutation({
        mutationFn: inventoryService.createVendor,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["vendors"] })
            toast({ title: "Success", description: "Vendor created successfully." })
            setIsCreateOpen(false)
        },
        onError: (error: Error) => {
            toast({ title: "Error", description: error.message || "Failed to create", variant: "destructive" })
        }
    })

    const updateMutation = useMutation({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        mutationFn: ({ id, data }: { id: string, data: any }) => inventoryService.updateVendor(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["vendors"] })
            toast({ title: "Success", description: "Vendor updated successfully." })
            setEditingVendor(null)
        },
        onError: (error: Error) => {
            toast({ title: "Error", description: error.message || "Failed to update", variant: "destructive" })
        }
    })

    const deleteMutation = useMutation({
        mutationFn: inventoryService.deleteVendor,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["vendors"] })
            toast({ title: "Success", description: "Vendor deleted successfully." })
        },
        onError: (error: Error) => {
            toast({ title: "Error", description: error.message || "Failed to delete", variant: "destructive" })
        }
    })

    const filteredVendors = vendors?.filter(v =>
        v.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        v.code.toLowerCase().includes(searchQuery.toLowerCase())
    ) || []

    return (
        <MasterRegistryShell
            title="Vendors"
            description="Manage suppliers, job workers, and service providers used across GRN and Job Work loops."
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder="Search by name or code..."
            stats={[
                { label: "Partners", value: (vendors || []).length, subLabel: "Suppliers and job workers", icon: Truck, toneClassName: "bg-blue-50 text-blue-700" },
                { label: "Active", value: (vendors || []).filter((vendor) => vendor.status === "ACTIVE").length, subLabel: "Ready for purchase or jobwork", icon: ShieldCheck, toneClassName: "bg-emerald-50 text-emerald-700" },
                { label: "Jobwork ready", value: (vendors || []).filter((vendor) => ["JOBWORK", "BOTH"].includes(vendor.type)).length, subLabel: "Can receive outsourced work", icon: Factory, toneClassName: "bg-cyan-50 text-cyan-700" },
                { label: "QC required", value: (vendors || []).filter((vendor) => Boolean(vendor.qc_required)).length, subLabel: "Extra incoming quality checks", icon: ShieldCheck, toneClassName: "bg-amber-50 text-amber-700" },
            ]}
            chips={[
                { kind: "origin", value: "PURCHASED", label: "Raw-material suppliers" },
                { kind: "origin", value: "JOBWORK_RETURN", label: "Jobwork loop" },
                { kind: "approval", value: "APPROVED", label: "Approved source base" },
            ]}
            actions={
                <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                    <DialogTrigger asChild>
                        <Button className="rounded-xl shadow-md hover:shadow-lg transition-all font-bold">
                            <Plus className="mr-2 h-4 w-4" /> Add Vendor
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto">
                        <DialogHeader>
                            <DialogTitle>Create Vendor</DialogTitle>
                            <DialogDescription>
                                Register a new raw material supplier or job worker.
                            </DialogDescription>
                        </DialogHeader>
                        <VendorForm
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
                            onEdit: setEditingVendor,
                            onDelete: (vendor) => setVendorToDelete(vendor)
                        })}
                        data={filteredVendors}
                        filterColumn="name"
                        filterPlaceholder="Filter globally..."
                    />
                </CardContent>
            </Card>

            <Dialog open={!!editingVendor} onOpenChange={(open) => !open && setEditingVendor(null)}>
                <DialogContent className="max-w-5xl max-h-[92vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Edit Vendor</DialogTitle>
                        <DialogDescription>
                            Update the supplier or job worker&apos;s details.
                        </DialogDescription>
                    </DialogHeader>
                    {editingVendor && (
                        <VendorForm
                            initialData={editingVendor}
                            onSubmit={(data) => updateMutation.mutate({ id: editingVendor.id, data })}
                            isLoading={updateMutation.isPending}
                        />
                    )}
                </DialogContent>
            </Dialog>

            <AlertDialog open={!!vendorToDelete} onOpenChange={(open) => !open && setVendorToDelete(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This action cannot be undone. This will permanently remove the vendor record.
                            Ensure no active stock blocks are linked to this vendor.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => {
                                if (vendorToDelete) {
                                    deleteMutation.mutate(vendorToDelete.id)
                                    setVendorToDelete(null)
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

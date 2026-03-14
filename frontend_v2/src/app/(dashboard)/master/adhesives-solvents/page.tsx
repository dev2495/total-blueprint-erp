"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { masterDataService, Material } from "@/services/master-data"
import { PageHeader } from "@/components/ui-custom/page-header"
import { DataTable } from "@/components/ui/data-table"
import { getColumns } from "./columns"
import { Button } from "@/components/ui/button"
import { Plus, Loader2 } from "lucide-react"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useState } from "react"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

const formSchema = z.object({
    code: z.string().min(1, "Code is required"),
    name: z.string().min(1, "Name is required"),
    category: z.enum(["ADHESIVE", "SOLVENT"]),
})

function AdhesiveSolventForm({ initialData, onSubmit, isLoading }: { initialData?: Material, onSubmit: (data: z.infer<typeof formSchema>) => void, isLoading: boolean }) {
    const form = useForm({
        resolver: zodResolver(formSchema),
        defaultValues: {
            code: initialData?.code || "",
            name: initialData?.name || "",
            category: (initialData?.category as "ADHESIVE" | "SOLVENT") || "ADHESIVE",
        },
    })

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                    control={form.control}
                    name="category"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Type</FormLabel>
                            <Select onValueChange={field.onChange} defaultValue={field.value} value={field.value}>
                                <FormControl>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select type" />
                                    </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                    <SelectItem value="ADHESIVE">Adhesive</SelectItem>
                                    <SelectItem value="SOLVENT">Solvent</SelectItem>
                                </SelectContent>
                            </Select>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <FormField
                    control={form.control}
                    name="code"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Code</FormLabel>
                            <FormControl>
                                <Input placeholder="e.g. AD-01" {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Name</FormLabel>
                            <FormControl>
                                <Input placeholder="e.g. PU Adhesive" {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <div className="flex justify-end gap-2 pt-2">
                    <Button type="submit" disabled={isLoading}>
                        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Save
                    </Button>
                </div>
            </form>
        </Form>
    )
}

export default function AdhesivesSolventsPage() {
    const { toast } = useToast()
    const queryClient = useQueryClient()
    const [isCreateOpen, setIsCreateOpen] = useState(false)
    const [editingItem, setEditingItem] = useState<Material | null>(null)
    const [itemToDelete, setItemToDelete] = useState<Material | null>(null)

    const { data: items } = useQuery({
        queryKey: ["adhesives-solvents"],
        queryFn: () => masterDataService.getAdhesivesSolvents(),
    })

    const createMutation = useMutation({
        mutationFn: masterDataService.createAdhesiveSolvent,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["adhesives-solvents"] })
            toast({ title: "Success", description: "Item created." })
            setIsCreateOpen(false)
        },
        onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" })
    })

    const updateMutation = useMutation({
        mutationFn: ({ id, data }: { id: string, data: z.infer<typeof formSchema> }) => masterDataService.updateAdhesiveSolvent(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["adhesives-solvents"] })
            toast({ title: "Success", description: "Item updated." })
            setEditingItem(null)
        },
        onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" })
    })

    const deleteMutation = useMutation({
        mutationFn: masterDataService.deleteAdhesiveSolvent,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["adhesives-solvents"] })
            toast({ title: "Success", description: "Item deleted." })
        },
        onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" })
    })

    return (
        <div className="space-y-6">
            <PageHeader
                title="Adhesives & Solvents"
                description="Manage lamination adhesives and solvents used in the conversion process."
                actions={
                    <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                        <DialogTrigger asChild>
                            <Button>
                                <Plus className="mr-2 h-4 w-4" /> Add Item
                            </Button>
                        </DialogTrigger>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>Create Adhesive / Solvent</DialogTitle>
                            </DialogHeader>
                            <AdhesiveSolventForm
                                onSubmit={(data) => createMutation.mutate(data)}
                                isLoading={createMutation.isPending}
                            />
                        </DialogContent>
                    </Dialog>
                }
            />

            <DataTable
                columns={getColumns({
                    onEdit: setEditingItem,
                    onDelete: (item) => setItemToDelete(item)
                })}
                data={items || []}
                filterColumn="name"
                filterPlaceholder="Filter items..."
            />

            <Dialog open={!!editingItem} onOpenChange={(open) => !open && setEditingItem(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Edit Item</DialogTitle>
                    </DialogHeader>
                    {editingItem && (
                        <AdhesiveSolventForm
                            initialData={editingItem}
                            onSubmit={(data) => updateMutation.mutate({ id: editingItem.id, data })}
                            isLoading={updateMutation.isPending}
                        />
                    )}
                </DialogContent>
            </Dialog>

            <AlertDialog open={!!itemToDelete} onOpenChange={(open) => !open && setItemToDelete(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will permanently delete <strong>{itemToDelete?.code}</strong>.
                            This action cannot be undone.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => {
                                if (itemToDelete) {
                                    deleteMutation.mutate(itemToDelete.id)
                                    setItemToDelete(null)
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

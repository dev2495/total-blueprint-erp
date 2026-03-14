"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { masterDataService, Material } from "@/services/master-data"
import { MasterRegistryShell } from "@/components/master/master-registry-shell"
import { DataTable } from "@/components/ui/data-table"
import { getColumns } from "./columns"
import { Button } from "@/components/ui/button"
import { Loader2, Package, Plus, Tag } from "lucide-react"
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

// --- Form Component ---
const formSchema = z.object({
    code: z.string().min(1, "Code is required"),
    name: z.string().min(1, "Name is required"),
})

function GranuleForm({ initialData, onSubmit, isLoading }: { initialData?: Material, onSubmit: (data: z.infer<typeof formSchema>) => void, isLoading: boolean }) {
    const form = useForm({
        resolver: zodResolver(formSchema),
        defaultValues: {
            code: initialData?.code || "",
            name: initialData?.name || "",
        },
    })

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                    control={form.control}
                    name="code"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Granule Code</FormLabel>
                            <FormControl>
                                <Input placeholder="e.g. G-1001" {...field} />
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
                            <FormLabel>Granule Name</FormLabel>
                            <FormControl>
                                <Input placeholder="e.g. LDPE High Slip" {...field} />
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

// --- Main Page ---
export default function GranulesPage() {
    const { toast } = useToast()
    const queryClient = useQueryClient()
    const [isCreateOpen, setIsCreateOpen] = useState(false)
    const [editingItem, setEditingItem] = useState<Material | null>(null)
    const [itemToDelete, setItemToDelete] = useState<Material | null>(null)
    const [searchQuery, setSearchQuery] = useState("")

    const { data: granules } = useQuery({
        queryKey: ["granules"],
        queryFn: masterDataService.getGranules,
    })

    const createMutation = useMutation({
        mutationFn: masterDataService.createGranule,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["granules"] })
            toast({ title: "Success", description: "Granule created." })
            setIsCreateOpen(false)
        },
        onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" })
    })

    const updateMutation = useMutation({
        mutationFn: ({ id, data }: { id: string, data: z.infer<typeof formSchema> }) => masterDataService.updateGranule(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["granules"] })
            toast({ title: "Success", description: "Granule updated." })
            setEditingItem(null)
        },
        onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" })
    })

    const deleteMutation = useMutation({
        mutationFn: masterDataService.deleteGranule,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["granules"] })
            toast({ title: "Success", description: "Granule deleted." })
        },
        onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" })
    })

    const filteredGranules = (granules || []).filter((item) => {
        const query = searchQuery.trim().toLowerCase()
        if (!query) return true
        return item.name.toLowerCase().includes(query) || item.code.toLowerCase().includes(query)
    })

    return (
        <MasterRegistryShell
            title="Granules"
            description="Manage raw material granules used in extrusion recipes and bulk stock."
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder="Search granules..."
            stats={[
                { label: "Granules", value: (granules || []).length, subLabel: "Raw material masters", icon: Package, toneClassName: "bg-emerald-50 text-emerald-700" },
                { label: "Visible", value: filteredGranules.length, subLabel: "Matching current search", icon: Tag, toneClassName: "bg-slate-50 text-slate-700" },
                { label: "Unique codes", value: new Set((granules || []).map((item) => item.code)).size, subLabel: "Master identifiers", icon: Tag, toneClassName: "bg-indigo-50 text-indigo-700" },
                { label: "Recipe ready", value: (granules || []).length, subLabel: "Available for extrusion formulas", icon: Package, toneClassName: "bg-cyan-50 text-cyan-700" },
            ]}
            chips={[
                { kind: "materialCategory", value: "GRANULE" },
                { kind: "processState", value: "EXTRUDED", label: "Extrusion feed" },
                { kind: "approval", value: "APPROVED", label: "Recipe compatible" },
            ]}
            actions={
                <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                    <DialogTrigger asChild>
                        <Button className="rounded-xl shadow-md hover:shadow-lg transition-all">
                            <Plus className="mr-2 h-4 w-4" /> Add Granule
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Create Granule</DialogTitle>
                        </DialogHeader>
                        <GranuleForm
                            onSubmit={(data) => createMutation.mutate(data)}
                            isLoading={createMutation.isPending}
                        />
                    </DialogContent>
                </Dialog>
            }
        >

            <DataTable
                columns={getColumns({
                    onEdit: setEditingItem,
                    onDelete: (item) => setItemToDelete(item)
                })}
                data={filteredGranules}
                filterColumn="name"
                filterPlaceholder="Filter granules..."
            />

            <Dialog open={!!editingItem} onOpenChange={(open) => !open && setEditingItem(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Edit Granule</DialogTitle>
                    </DialogHeader>
                    {editingItem && (
                        <GranuleForm
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
        </MasterRegistryShell>
    )
}

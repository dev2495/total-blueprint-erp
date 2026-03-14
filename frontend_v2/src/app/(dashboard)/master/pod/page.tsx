"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import * as z from "zod"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { Plus, Loader2 } from "lucide-react"

import { masterDataService, Material } from "@/services/master-data"
import { PageHeader } from "@/components/ui-custom/page-header"
import { DataTable } from "@/components/ui/data-table"
import { getColumns } from "./columns"
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
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
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/hooks/use-toast"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

const podFormSchema = z.object({
    code: z.string().min(1, "Code is required"),
    name: z.string().min(1, "Name is required"),
    pod_type: z.enum(["SINGLE", "DOUBLE"]),
    pod_fixed_height_mm: z.coerce.number().positive("Height must be > 0"),
    pod_thickness_micron: z.coerce.number().positive("Thickness must be > 0"),
    pod_panel_count: z.coerce.number().int().positive("Panel count must be > 0"),
    density_gcm3: z.coerce.number().positive("Density must be > 0"),
    pod_is_inhouse_produced: z.boolean(),
    status: z.enum(["ACTIVE", "INACTIVE"]),
})

type PodFormInput = z.input<typeof podFormSchema>
type PodFormOutput = z.output<typeof podFormSchema>

function PODForm({
    initialData,
    isLoading,
    onSubmit,
}: {
    initialData?: Material
    isLoading: boolean
    onSubmit: (data: PodFormOutput) => void
}) {
    const isCore = Boolean(initialData?.code?.startsWith("POD-"))
    const form = useForm<PodFormInput, any, PodFormOutput>({
        resolver: zodResolver(podFormSchema),
        defaultValues: {
            code: initialData?.code || "",
            name: initialData?.name || "",
            pod_type: (initialData?.pod_type as "SINGLE" | "DOUBLE") || "SINGLE",
            pod_fixed_height_mm: Number(initialData?.pod_fixed_height_mm ?? 200),
            pod_thickness_micron: Number(initialData?.pod_thickness_micron ?? 30),
            pod_panel_count: Number(initialData?.pod_panel_count ?? 1),
            density_gcm3: Number(initialData?.density_gcm3 ?? 0.92),
            pod_is_inhouse_produced: Boolean(initialData?.pod_is_inhouse_produced ?? true),
            status: (initialData?.status as "ACTIVE" | "INACTIVE") || "ACTIVE",
        },
    })

    return (
        <Form {...form}>
            <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <FormField
                        control={form.control}
                        name="code"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Code</FormLabel>
                                <FormControl>
                                    <Input {...field} disabled={isCore || isLoading} />
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
                                    <Input {...field} disabled={isLoading} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <FormField
                        control={form.control}
                        name="pod_type"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>POD Type</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value} disabled={isLoading}>
                                    <FormControl>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Select type" />
                                        </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                        <SelectItem value="SINGLE">Single</SelectItem>
                                        <SelectItem value="DOUBLE">Double</SelectItem>
                                    </SelectContent>
                                </Select>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="status"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Status</FormLabel>
                                <Select onValueChange={field.onChange} value={field.value} disabled={isLoading}>
                                    <FormControl>
                                        <SelectTrigger>
                                            <SelectValue />
                                        </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                        <SelectItem value="ACTIVE">Active</SelectItem>
                                        <SelectItem value="INACTIVE">Inactive</SelectItem>
                                    </SelectContent>
                                </Select>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <FormField
                        control={form.control}
                        name="pod_fixed_height_mm"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Fixed Height (mm)</FormLabel>
                                <FormControl>
                                    <Input
                                        type="number"
                                        step="0.01"
                                        value={typeof field.value === "number" ? field.value : ""}
                                        onChange={(e) => field.onChange(e.target.value)}
                                        onBlur={field.onBlur}
                                        name={field.name}
                                        disabled={isLoading}
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="pod_thickness_micron"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Thickness (micron)</FormLabel>
                                <FormControl>
                                    <Input
                                        type="number"
                                        step="0.001"
                                        value={typeof field.value === "number" ? field.value : ""}
                                        onChange={(e) => field.onChange(e.target.value)}
                                        onBlur={field.onBlur}
                                        name={field.name}
                                        disabled={isLoading}
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <FormField
                        control={form.control}
                        name="pod_panel_count"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Panel Count</FormLabel>
                                <FormControl>
                                    <Input
                                        type="number"
                                        step="1"
                                        value={typeof field.value === "number" ? field.value : ""}
                                        onChange={(e) => field.onChange(e.target.value)}
                                        onBlur={field.onBlur}
                                        name={field.name}
                                        disabled={isLoading}
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="density_gcm3"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Density (g/cm3)</FormLabel>
                                <FormControl>
                                    <Input
                                        type="number"
                                        step="0.0001"
                                        value={typeof field.value === "number" ? field.value : ""}
                                        onChange={(e) => field.onChange(e.target.value)}
                                        onBlur={field.onBlur}
                                        name={field.name}
                                        disabled={isLoading}
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </div>

                <FormField
                    control={form.control}
                    name="pod_is_inhouse_produced"
                    render={({ field }) => (
                        <FormItem className="flex items-center justify-between rounded-lg border px-3 py-2">
                            <FormLabel>In-house Produced</FormLabel>
                            <FormControl>
                                <Switch checked={field.value} onCheckedChange={field.onChange} disabled={isLoading} />
                            </FormControl>
                        </FormItem>
                    )}
                />

                <div className="flex justify-end">
                    <Button type="submit" disabled={isLoading}>
                        {isLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                        Save
                    </Button>
                </div>
            </form>
        </Form>
    )
}

// --- Main Page ---
export default function PODPage() {
    const queryClient = useQueryClient()
    const { toast } = useToast()
    const [isCreateOpen, setIsCreateOpen] = useState(false)
    const [editingItem, setEditingItem] = useState<Material | null>(null)
    const [itemToDelete, setItemToDelete] = useState<Material | null>(null)

    const { data: podMaterials } = useQuery({
        queryKey: ["pod-materials"],
        queryFn: masterDataService.getPODMaterials,
    })

    const createMutation = useMutation({
        mutationFn: masterDataService.createPODMaterial,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["pod-materials"] })
            toast({ title: "POD profile created." })
            setIsCreateOpen(false)
        },
        onError: (err: any) => {
            toast({
                variant: "destructive",
                title: "Create failed",
                description: err?.response?.data?.detail || err?.message || "Could not create POD profile.",
            })
        },
    })

    const updateMutation = useMutation({
        mutationFn: ({ id, data }: { id: string; data: z.infer<typeof podFormSchema> }) => masterDataService.updatePODMaterial(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["pod-materials"] })
            toast({ title: "POD profile updated." })
            setEditingItem(null)
        },
        onError: (err: any) => {
            toast({
                variant: "destructive",
                title: "Update failed",
                description: err?.response?.data?.detail || err?.message || "Could not update POD profile.",
            })
        },
    })

    const deleteMutation = useMutation({
        mutationFn: masterDataService.deletePODMaterial,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["pod-materials"] })
            toast({ title: "POD profile deleted." })
            setItemToDelete(null)
        },
        onError: (err: any) => {
            toast({
                variant: "destructive",
                title: "Delete failed",
                description: err?.response?.data?.detail || err?.message || "Could not delete POD profile.",
            })
        },
    })

    return (
        <div className="space-y-6 px-6 pb-20">
            <PageHeader
                title="POD Materials"
                description="Master POD profiles drive pouch POD film consumption by formula."
                actions={
                    <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                        <DialogTrigger asChild>
                            <Button>
                                <Plus className="h-4 w-4 mr-2" />
                                Add POD Profile
                            </Button>
                        </DialogTrigger>
                        <DialogContent>
                            <DialogHeader>
                                <DialogTitle>Create POD Profile</DialogTitle>
                            </DialogHeader>
                            <PODForm onSubmit={(data) => createMutation.mutate(data)} isLoading={createMutation.isPending} />
                        </DialogContent>
                    </Dialog>
                }
            />

            <DataTable
                columns={getColumns({
                    onEdit: setEditingItem,
                    onDelete: (row) => setItemToDelete(row),
                })}
                data={podMaterials || []}
                filterColumn="name"
                filterPlaceholder="Filter materials..."
            />

            <Dialog open={!!editingItem} onOpenChange={(open) => !open && setEditingItem(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Edit POD Profile</DialogTitle>
                    </DialogHeader>
                    {editingItem ? (
                        <PODForm
                            initialData={editingItem}
                            isLoading={updateMutation.isPending}
                            onSubmit={(data) => updateMutation.mutate({ id: editingItem.id, data })}
                        />
                    ) : null}
                </DialogContent>
            </Dialog>

            <AlertDialog open={!!itemToDelete} onOpenChange={(open) => !open && setItemToDelete(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete POD Profile?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will permanently delete <strong>{itemToDelete?.code}</strong>.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={() => {
                                if (itemToDelete) deleteMutation.mutate(itemToDelete.id)
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

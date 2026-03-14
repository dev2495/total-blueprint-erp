"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { masterDataService, Material } from "@/services/master-data"
import { MasterRegistryShell } from "@/components/master/master-registry-shell"
import { DataTable } from "@/components/ui/data-table"
import { getColumns } from "./columns"
import { Button } from "@/components/ui/button"
import { Droplets, Loader2, Palette, Plus, ShieldCheck } from "lucide-react"
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
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
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
import { Card, CardContent } from "@/components/ui/card"

// --- Form Reuse for Inks ---
const formSchema = z.object({
    base_type: z.enum(["POLY", "PET"]),
    color_name: z.string().min(1, "Color name is required"),
    name: z.string().optional(),
})

function InkForm({ initialData, onSubmit, isLoading }: { initialData?: Material, onSubmit: (data: z.infer<typeof formSchema>) => void, isLoading: boolean }) {
    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            base_type: initialData?.base_type || "POLY",
            color_name: initialData?.color_name || "",
            name: initialData?.name || "",
        },
    })

    const handleSubmit = (values: z.infer<typeof formSchema>) => {
        // Explicit log for debugging
        console.log("Submitting Ink Form", values)
        onSubmit(values)
    }

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSubmit, (errors) => console.error(errors))} className="space-y-4">
                <FormField
                    control={form.control}
                    name="base_type"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel className="text-xs font-bold uppercase text-slate-500">Base Substrate</FormLabel>
                            <Select onValueChange={field.onChange} value={field.value}>
                                <FormControl>
                                    <SelectTrigger className="font-bold">
                                        <SelectValue placeholder="Select base type" />
                                    </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                    <SelectItem value="POLY" className="font-medium">POLY (Polyethylene Base)</SelectItem>
                                    <SelectItem value="PET" className="font-medium">PET (Polyester Base)</SelectItem>
                                </SelectContent>
                            </Select>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <FormField
                    control={form.control}
                    name="color_name"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel className="text-xs font-bold uppercase text-slate-500">Color Name</FormLabel>
                            <FormControl>
                                <Input placeholder="e.g. SPECIAL RED" {...field} className="uppercase font-bold" />
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
                            <FormLabel className="text-xs font-bold uppercase text-slate-500">Internal Description (Optional)</FormLabel>
                            <FormControl>
                                <Input placeholder="e.g. High Opacity White Solvent Base" {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <div className="flex justify-end gap-2 pt-4">
                    <Button type="submit" disabled={isLoading} className="font-bold">
                        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Save Ink
                    </Button>
                </div>
            </form>
        </Form>
    )
}

export default function InksPage() {
    const { toast } = useToast()
    const queryClient = useQueryClient()
    const [isCreateOpen, setIsCreateOpen] = useState(false)
    const [editingItem, setEditingItem] = useState<Material | null>(null)
    const [itemToDelete, setItemToDelete] = useState<Material | null>(null)
    const [searchQuery, setSearchQuery] = useState("")

    const { data: inks } = useQuery({
        queryKey: ["inks"],
        queryFn: masterDataService.getInks,
    })

    const createMutation = useMutation({
        mutationFn: masterDataService.createInk,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["inks"] })
            toast({ title: "Success", description: "Ink created." })
            setIsCreateOpen(false)
        },
        onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" })
    })

    const updateMutation = useMutation({
        mutationFn: ({ id, data }: { id: string, data: z.infer<typeof formSchema> }) => masterDataService.updateInk(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["inks"] })
            toast({ title: "Success", description: "Ink updated." })
            setEditingItem(null)
        },
        onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" })
    })

    const deleteMutation = useMutation({
        mutationFn: masterDataService.deleteInk,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["inks"] })
            toast({ title: "Success", description: "Ink deleted." })
        },
        onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" })
    })

    const filteredInks = inks?.filter(ink =>
        ink.color_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        ink.code.toLowerCase().includes(searchQuery.toLowerCase())
    ) || []

    const totalInks = inks || []
    const polyBaseCount = totalInks.filter((ink) => ink.base_type === "POLY").length
    const petBaseCount = totalInks.filter((ink) => ink.base_type === "PET").length

    return (
        <MasterRegistryShell
            title="Printing Inks"
            description="Manage inks used in the printing process, organized by color and base."
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder="Search inks..."
            stats={[
                { label: "Ink masters", value: totalInks.length, subLabel: "Registered colors and bases", icon: Droplets, toneClassName: "bg-cyan-50 text-cyan-700" },
                { label: "POLY base", value: polyBaseCount, subLabel: "Polyethylene print base", icon: Palette, toneClassName: "bg-indigo-50 text-indigo-700" },
                { label: "PET base", value: petBaseCount, subLabel: "Polyester print base", icon: Palette, toneClassName: "bg-violet-50 text-violet-700" },
                { label: "Visible", value: filteredInks.length, subLabel: "Matching current search", icon: ShieldCheck, toneClassName: "bg-slate-50 text-slate-700" },
            ]}
            chips={[
                { kind: "materialCategory", value: "INK" },
                { kind: "processState", value: "PRINTED", label: "Print process" },
                { kind: "approval", value: "APPROVED", label: "Press-ready master" },
            ]}
            actions={
                <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                    <DialogTrigger asChild>
                        <Button className="rounded-xl shadow-md hover:shadow-lg transition-all">
                            <Plus className="mr-2 h-4 w-4" /> Add Ink
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Create Ink</DialogTitle>
                        </DialogHeader>
                        <InkForm
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
                            onEdit: setEditingItem,
                            onDelete: (item) => setItemToDelete(item)
                        })}
                        data={filteredInks}
                        filterColumn="color_name"
                        filterPlaceholder="Filter inks..."
                    />
                </CardContent>
            </Card>

            <Dialog open={!!editingItem} onOpenChange={(open) => !open && setEditingItem(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Edit Ink</DialogTitle>
                    </DialogHeader>
                    {editingItem && (
                        <InkForm
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

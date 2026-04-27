"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { masterDataService, Vendor } from "@/services/master-data"
import { DataTable } from "@/components/ui/data-table"
import { getColumns } from "./columns"
import { Button } from "@/components/ui/button"
import { Plus, Loader2, Container, Factory, Truck, Briefcase } from "lucide-react"
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
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

// --- Form Component ---
const formSchema = z.object({
    code: z.string().min(1, "Code is required"),
    name: z.string().min(1, "Name is required"),
    type: z.string().default('RM'),
    gst_no: z.string().optional(),
    address: z.string().optional(),
    payment_terms: z.string().optional(),
    lead_time_days: z.coerce.number().min(0).optional(),
    status: z.string().default('ACTIVE'),
})

function VendorForm({ initialData, onSubmit, isLoading }: { initialData?: Vendor, onSubmit: (data: z.infer<typeof formSchema>) => void, isLoading: boolean }) {
    const form = useForm<z.infer<typeof formSchema>>({
        resolver: zodResolver(formSchema) as any,
        defaultValues: {
            code: initialData?.code || "",
            name: initialData?.name || "",
            type: initialData?.type || "RM",
            gst_no: initialData?.gst_no || "",
            address: initialData?.address || "",
            payment_terms: initialData?.payment_terms || "",
            lead_time_days: initialData?.lead_time_days || 0,
            status: initialData?.status || 'ACTIVE',
        },
    })

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                    <FormField
                        control={form.control}
                        name="code"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Code</FormLabel>
                                <FormControl>
                                    <Input placeholder="VEND-001" {...field} className="h-10 font-bold" />
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
                                <FormLabel className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Name</FormLabel>
                                <FormControl>
                                    <Input placeholder="Supplier Inc." {...field} className="h-10 font-bold" />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <FormField
                        control={form.control}
                        name="type"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Type</FormLabel>
                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                    <FormControl>
                                        <SelectTrigger className="h-10 font-bold">
                                            <SelectValue placeholder="Select type" />
                                        </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                        <SelectItem value="RM">Raw Material</SelectItem>
                                        <SelectItem value="JOBWORK">Job Worker</SelectItem>
                                        <SelectItem value="SERVICE">Service Provider</SelectItem>
                                        <SelectItem value="BOTH">Hybrid</SelectItem>
                                    </SelectContent>
                                </Select>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="gst_no"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel className="text-[10px] font-black uppercase text-slate-500 tracking-widest">GST No</FormLabel>
                                <FormControl>
                                    <Input {...field} className="h-10 font-bold" />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <FormField
                        control={form.control}
                        name="payment_terms"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Payment Terms</FormLabel>
                                <FormControl>
                                    <Input placeholder="Net 30" {...field} className="h-10 font-bold" />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="lead_time_days"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Lead Time (Days)</FormLabel>
                                <FormControl>
                                    <Input type="number" {...field} value={field.value ?? ""} className="h-10 font-bold" />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </div>

                <FormField
                    control={form.control}
                    name="address"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Address</FormLabel>
                            <FormControl>
                                <Textarea className="h-20 font-medium" {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <div className="flex justify-end gap-2 pt-4">
                    <Button type="submit" disabled={isLoading} className="bg-blue-600 hover:bg-slate-900 text-white font-black uppercase text-[10px] tracking-widest h-10 px-6 rounded-lg shadow-lg active-scale">
                        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Save Entity
                    </Button>
                </div>
            </form>
        </Form>
    )
}

// --- Main Page ---
export default function VendorsPage() {
    const { toast } = useToast()
    const queryClient = useQueryClient()
    const [isCreateOpen, setIsCreateOpen] = useState(false)
    const [editingItem, setEditingItem] = useState<Vendor | null>(null)
    const [itemToDelete, setItemToDelete] = useState<Vendor | null>(null)

    const { data: vendors, isLoading } = useQuery({
        queryKey: ["vendors"],
        queryFn: masterDataService.getVendors,
    })

    const createMutation = useMutation({
        mutationFn: masterDataService.createVendor,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["vendors"] })
            toast({ title: "Success", description: "Vendor created." })
            setIsCreateOpen(false)
        },
        onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" })
    })

    const updateMutation = useMutation({
        mutationFn: ({ id, data }: { id: string, data: any }) => masterDataService.updateVendor(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["vendors"] })
            toast({ title: "Success", description: "Vendor updated." })
            setEditingItem(null)
        },
        onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" })
    })

    const deleteMutation = useMutation({
        mutationFn: masterDataService.deleteVendor,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["vendors"] })
            toast({ title: "Success", description: "Vendor deleted." })
        },
        onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" })
    })

    const stats = {
        total: vendors?.length || 0,
        rm: vendors?.filter(v => v.type === 'RM').length || 0,
        jobwork: vendors?.filter(v => v.type === 'JOBWORK').length || 0,
        service: vendors?.filter(v => v.type === 'SERVICE').length || 0
    }

    return (
        <div className="p-6 lg:p-8 space-y-8 bg-[#f8fafc] min-h-screen">
            {/* Header Section */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                <div className="space-y-1">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-100 border border-slate-200 text-slate-600 text-[10px] font-black uppercase tracking-widest shadow-sm translate-y-[-4px]">
                        <Factory className="h-3 w-3" /> Supply Chain
                    </div>
                    <h1 className="text-3xl font-black tracking-tight text-slate-900 flex items-center gap-3">
                        Vendor
                        <span className="text-slate-300 font-light translate-y-[2px]">/</span>
                        <span className="text-blue-600 italic">Master</span>
                    </h1>
                    <p className="text-slate-500 font-medium text-xs flex items-center gap-2 italic">
                        Managing {stats.total} suppliers and external partners
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                        <DialogTrigger asChild>
                            <Button className="h-11 px-8 rounded-xl bg-slate-900 hover:bg-blue-600 text-white font-black uppercase text-[10px] tracking-widest shadow-xl shadow-slate-200 transition-all active-scale">
                                <Plus className="h-4 w-4 mr-2" /> Onboard Entity
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-2xl rounded-[2rem] border-none shadow-2xl p-8 bg-white/95 backdrop-blur-md">
                            <DialogHeader>
                                <DialogTitle className="text-xl font-black uppercase tracking-tight text-slate-900">New Supply Partner</DialogTitle>
                            </DialogHeader>
                            <VendorForm
                                onSubmit={(data) => createMutation.mutate(data)}
                                isLoading={createMutation.isPending}
                            />
                        </DialogContent>
                    </Dialog>
                </div>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                    { label: "Total Partners", value: stats.total, icon: Container, color: "text-blue-600", bg: "bg-blue-50" },
                    { label: "Material Suppliers", value: stats.rm, icon: Truck, color: "text-emerald-600", bg: "bg-emerald-50" },
                    { label: "Job Workers", value: stats.jobwork, icon: Factory, color: "text-amber-600", bg: "bg-amber-50" },
                    { label: "Service Providers", value: stats.service, icon: Briefcase, color: "text-rose-600", bg: "bg-rose-50" },
                ].map((stat, i) => (
                    <Card key={i} className="border-none shadow-premium rounded-2xl bg-white/70 backdrop-blur-md hover:-translate-y-1 transition-all duration-300">
                        <CardHeader className="p-5 pb-2 flex flex-row items-center justify-between">
                            <div className={cn("p-2 rounded-xl", stat.bg, stat.color)}>
                                <stat.icon className="h-4 w-4" />
                            </div>
                        </CardHeader>
                        <CardContent className="p-5 pt-1">
                            <div className="text-2xl font-black text-slate-900 tracking-tighter">{stat.value}</div>
                            <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase italic tracking-widest">{stat.label}</p>
                        </CardContent>
                    </Card>
                ))}
            </div>

            <Card className="border-none shadow-premium rounded-[2rem] bg-white overflow-hidden">
                <CardHeader className="p-6 pb-2 border-b border-slate-50 bg-slate-50/30">
                    <CardTitle className="text-lg font-black tracking-tight text-slate-900 uppercase italic">Registered Entities</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    <DataTable
                        columns={getColumns({
                            onEdit: setEditingItem,
                            onDelete: (item) => setItemToDelete(item)
                        })}
                        data={vendors || []}
                        filterColumn="name"
                        filterPlaceholder="Search partners..."
                    />
                </CardContent>
            </Card>

            {/* Edit Dialog */}
            <Dialog open={!!editingItem} onOpenChange={(open) => !open && setEditingItem(null)}>
                <DialogContent className="max-w-2xl rounded-[2rem] border-none shadow-2xl p-8 bg-white/95 backdrop-blur-md">
                    <DialogHeader>
                        <DialogTitle className="text-xl font-black uppercase tracking-tight text-slate-900">Edit Vendor Profile</DialogTitle>
                    </DialogHeader>
                    {editingItem && (
                        <VendorForm
                            initialData={editingItem}
                            onSubmit={(data) => updateMutation.mutate({ id: editingItem.id, data })}
                            isLoading={updateMutation.isPending}
                        />
                    )}
                </DialogContent>
            </Dialog>

            <AlertDialog open={!!itemToDelete} onOpenChange={(open) => !open && setItemToDelete(null)}>
                <AlertDialogContent className="rounded-[2rem] border-none shadow-2xl">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="font-black uppercase tracking-tight">Revoke Partnership?</AlertDialogTitle>
                        <AlertDialogDescription>
                            This will permanently remove <strong>{itemToDelete?.name}</strong> from the master registry.
                            <br />Validation checks will fail for any existing orders linked to this entity.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel className="rounded-xl font-bold uppercase text-xs tracking-wider">Cancel</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => {
                                if (itemToDelete) {
                                    deleteMutation.mutate(itemToDelete.id)
                                    setItemToDelete(null)
                                }
                            }}
                            className="rounded-xl bg-rose-600 hover:bg-rose-700 font-bold uppercase text-xs tracking-wider"
                        >
                            Delete Entity
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}

"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { masterDataService, Customer } from "@/services/master-data"
import { DataTable } from "@/components/ui/data-table"
import { getColumns } from "./columns"
import { Button } from "@/components/ui/button"
import { Plus, Loader2, Zap, Activity, Filter, Search, Globe, ShieldCheck } from "lucide-react"
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
import { Card } from "@/components/ui/card"

// --- Form Component ---
const formSchema = z.object({
    code: z.string().min(1, "Code is required"),
    name: z.string().min(1, "Name is required"),
    gst_no: z.string().optional(),
    contact_person: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().email().optional().or(z.literal("")),
    billing_address: z.string().optional(),
    shipping_address: z.string().optional(),
    credit_days: z.coerce.number().min(0).optional(),
    credit_limit: z.coerce.number().min(0).optional(),
    status: z.string().default('ACTIVE'),
})

function CustomerForm({ initialData, onSubmit, isLoading }: { initialData?: Customer, onSubmit: (data: z.infer<typeof formSchema>) => void, isLoading: boolean }) {
    const form = useForm({
        resolver: zodResolver(formSchema),
        defaultValues: {
            code: initialData?.code || "",
            name: initialData?.name || "",
            gst_no: initialData?.gst_no || "",
            contact_person: initialData?.contact_person || "",
            phone: initialData?.phone || "",
            email: initialData?.email || "",
            billing_address: initialData?.billing_address || "",
            shipping_address: initialData?.shipping_address || "",
            credit_days: initialData?.credit_days || 0,
            credit_limit: initialData?.credit_limit || 0,
            status: initialData?.status || 'ACTIVE',
        },
    })

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 py-4">
                <div className="grid grid-cols-2 gap-6">
                    <FormField
                        control={form.control}
                        name="code"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel className="text-[10px] font-black uppercase tracking-widest text-slate-500 italic">Identity Code</FormLabel>
                                <FormControl>
                                    <Input placeholder="CUST-001" className="h-12 rounded-xl border-slate-200 bg-slate-50/50 focus:bg-white transition-all font-bold" {...field} />
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
                                <FormLabel className="text-[10px] font-black uppercase tracking-widest text-slate-500 italic">Legal Entity Name</FormLabel>
                                <FormControl>
                                    <Input placeholder="Acme Corp" className="h-12 rounded-xl border-slate-200 bg-slate-50/50 focus:bg-white transition-all font-bold" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </div>

                <div className="grid grid-cols-2 gap-6">
                    <FormField
                        control={form.control}
                        name="contact_person"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel className="text-[10px] font-black uppercase tracking-widest text-slate-500 italic">Principal Liaison</FormLabel>
                                <FormControl>
                                    <Input className="h-12 rounded-xl border-slate-200 bg-slate-50/50 focus:bg-white transition-all font-bold" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="phone"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel className="text-[10px] font-black uppercase tracking-widest text-slate-500 italic">Communication Line</FormLabel>
                                <FormControl>
                                    <Input className="h-12 rounded-xl border-slate-200 bg-slate-50/50 focus:bg-white transition-all font-bold" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </div>

                <div className="grid grid-cols-2 gap-6">
                    <FormField
                        control={form.control}
                        name="email"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel className="text-[10px] font-black uppercase tracking-widest text-slate-500 italic">Digital Correspondence</FormLabel>
                                <FormControl>
                                    <Input type="email" className="h-12 rounded-xl border-slate-200 bg-slate-50/50 focus:bg-white transition-all font-bold" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="gst_no"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel className="text-[10px] font-black uppercase tracking-widest text-slate-500 italic">Tax Protocol ID (GST)</FormLabel>
                                <FormControl>
                                    <Input className="h-12 rounded-xl border-slate-200 bg-slate-50/50 focus:bg-white transition-all font-black uppercase italic" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </div>

                <FormField
                    control={form.control}
                    name="billing_address"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel className="text-[10px] font-black uppercase tracking-widest text-slate-500 italic">Registered Headquarters</FormLabel>
                            <FormControl>
                                <Textarea className="h-24 rounded-xl border-slate-200 bg-slate-50/50 focus:bg-white transition-all font-medium pt-3" {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <div className="flex justify-end gap-3 pt-4">
                    <Button type="button" variant="ghost" onClick={() => form.reset()} className="rounded-xl px-6 font-bold uppercase text-[10px] tracking-widest">Reset</Button>
                    <Button type="submit" disabled={isLoading} className="rounded-xl px-8 bg-slate-900 hover:bg-slate-800 text-white font-black uppercase text-[10px] tracking-widest shadow-lg active-scale">
                        {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="mr-2 h-4 w-4" />}
                        Commit Master Data
                    </Button>
                </div>
            </form>
        </Form>
    )
}

// --- Main Page ---
export default function CustomersPage() {
    const { toast } = useToast()
    const queryClient = useQueryClient()
    const [isCreateOpen, setIsCreateOpen] = useState(false)
    const [editingItem, setEditingItem] = useState<Customer | null>(null)
    const [itemToDelete, setItemToDelete] = useState<Customer | null>(null)

    const { data: customers, isLoading } = useQuery({
        queryKey: ["customers"],
        queryFn: masterDataService.getCustomers,
    })

    const createMutation = useMutation({
        mutationFn: masterDataService.createCustomer,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["customers"] })
            toast({ title: "Success", description: "Protocol entry created." })
            setIsCreateOpen(false)
        },
        onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" })
    })

    const updateMutation = useMutation({
        mutationFn: ({ id, data }: { id: string, data: any }) => masterDataService.updateCustomer(id, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["customers"] })
            toast({ title: "Success", description: "Protocol metadata updated." })
            setEditingItem(null)
        },
        onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" })
    })

    const deleteMutation = useMutation({
        mutationFn: masterDataService.deleteCustomer,
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["customers"] })
            toast({ title: "Success", description: "Protocol entry purged." })
        },
        onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" })
    })

    return (
        <div className="p-8 lg:p-12 space-y-10 bg-[#f8fafc] min-h-screen">
            {/* Header Section */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                <div className="space-y-1">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-50 border border-indigo-100 text-indigo-600 text-[10px] font-black uppercase tracking-widest shadow-sm translate-y-[-4px]">
                        <Globe className="h-3 w-3" /> Global Directory
                    </div>
                    <h1 className="text-4xl font-black tracking-tight text-slate-900 flex items-center gap-3">
                        Commercial
                        <span className="text-slate-300 font-light translate-y-[2px]">/</span>
                        <span className="text-indigo-600 italic">Customers</span>
                    </h1>
                    <p className="text-slate-500 font-medium text-sm flex items-center gap-2">
                        Tracking {customers?.length || 0} authenticated corporate entities <Activity className="h-3.5 w-3.5 text-indigo-400" />
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                        <DialogTrigger asChild>
                            <Button className="h-12 px-8 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-black uppercase text-xs tracking-wider shadow-xl shadow-slate-200 transition-all active-scale">
                                <Plus className="h-4 w-4 mr-2" /> Register New Account
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-2xl rounded-[2rem] border-none shadow-2xl p-8 bg-white">
                            <DialogHeader>
                                <DialogTitle className="text-2xl font-black tracking-tight italic uppercase">Account Registration</DialogTitle>
                            </DialogHeader>
                            <CustomerForm
                                onSubmit={(data) => createMutation.mutate(data)}
                                isLoading={createMutation.isPending}
                            />
                        </DialogContent>
                    </Dialog>
                </div>
            </div>

            {/* Content Section */}
            <div className="relative">
                {isLoading ? (
                    <div className="flex h-[400px] items-center justify-center bg-white/50 backdrop-blur-sm rounded-[2rem] border-2 border-dashed border-slate-200">
                        <div className="text-center space-y-4">
                            <Loader2 className="h-10 w-10 animate-spin text-indigo-600 mx-auto" />
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Synchronizing Master Data...</p>
                        </div>
                    </div>
                ) : (
                    <Card className="border-none shadow-premium rounded-[2rem] overflow-hidden bg-white/70 backdrop-blur-md">
                        <div className="overflow-x-auto scrollbar-hide">
                            <DataTable
                                columns={getColumns({
                                    onEdit: setEditingItem,
                                    onDelete: (item) => setItemToDelete(item)
                                })}
                                data={customers || []}
                                filterColumn="name"
                                filterPlaceholder="SEARCH ENTITTY LEDGER..."
                            />
                        </div>
                    </Card>
                )}

                {/* Decorative Elements */}
                <div className="absolute -top-10 -right-10 w-64 h-64 bg-indigo-500/5 rounded-full blur-3xl -z-10" />
                <div className="absolute -bottom-10 -left-10 w-64 h-64 bg-blue-500/5 rounded-full blur-3xl -z-10" />
            </div>

            {/* Edit Dialog */}
            <Dialog open={!!editingItem} onOpenChange={(open) => !open && setEditingItem(null)}>
                <DialogContent className="max-w-2xl rounded-[2rem] border-none shadow-2xl p-8 bg-white">
                    <DialogHeader>
                        <DialogTitle className="text-2xl font-black tracking-tight italic uppercase">Modify Account Topology</DialogTitle>
                    </DialogHeader>
                    {editingItem && (
                        <CustomerForm
                            initialData={editingItem}
                            onSubmit={(data) => updateMutation.mutate({ id: editingItem.id, data })}
                            isLoading={updateMutation.isPending}
                        />
                    )}
                </DialogContent>
            </Dialog>

            {/* Delete Confirmation */}
            <AlertDialog open={!!itemToDelete} onOpenChange={(open) => !open && setItemToDelete(null)}>
                <AlertDialogContent className="rounded-[2rem] border-none shadow-2xl p-8">
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-2xl font-black tracking-tight uppercase italic text-rose-600">Protocol Purge Warning</AlertDialogTitle>
                        <AlertDialogDescription className="text-slate-500 font-medium py-2">
                            You are about to permanently decommission the account metadata for <strong>{itemToDelete?.name}</strong>. This operation is irreversible within the current ledger cycle.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="pt-4">
                        <AlertDialogCancel className="rounded-xl border-slate-100 bg-slate-50 font-bold uppercase text-[10px]">Abort Operation</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={() => {
                                if (itemToDelete) {
                                    deleteMutation.mutate(itemToDelete.id)
                                    setItemToDelete(null)
                                }
                            }}
                            className="rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-black uppercase text-[10px] shadow-lg shadow-rose-200"
                        >
                            Execute Purge
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}

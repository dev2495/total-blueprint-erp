"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { masterDataService, Customer } from "@/services/master-data"
import { DataTable } from "@/components/ui/data-table"
import { getColumns } from "./columns"
import { Button } from "@/components/ui/button"
import { Plus, Loader2, Activity, Globe, ShieldCheck, MapPin, Trash2 } from "lucide-react"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useState } from "react"
import { useFieldArray, useForm } from "react-hook-form"
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"

// --- Form Component ---
const addressSchema = z.object({
    label: z.string().optional(),
    name: z.string().optional(),
    address: z.string().optional(),
    state: z.string().optional(),
    country: z.string().optional(),
    pincode: z.string().optional(),
    contact_person: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().email().optional().or(z.literal("")),
})

const formSchema = z.object({
    code: z.string().min(1, "Code is required"),
    name: z.string().min(1, "Name is required"),
    under_group: z.string().optional(),
    gst_no: z.string().optional(),
    pan_no: z.string().optional(),
    contact_person: z.string().optional(),
    phone: z.string().optional(),
    email: z.string().email().optional().or(z.literal("")),
    contact_details: z.string().optional(),
    billing_address: z.string().optional(),
    shipping_address: z.string().optional(),
    mailing_name: z.string().optional(),
    mailing_state: z.string().optional(),
    mailing_country: z.string().optional(),
    mailing_pincode: z.string().optional(),
    additional_addresses: z.array(addressSchema).default([]),
    credit_days: z.coerce.number().min(0).optional(),
    credit_limit: z.coerce.number().min(0).optional(),
    interest_calculation: z.string().optional(),
    bank_details: z.string().optional(),
    tds_deductable: z.boolean().default(false),
    tcs_deductable: z.boolean().default(false),
    status: z.string().default('ACTIVE'),
})

type CustomerFormInput = z.input<typeof formSchema>
type CustomerFormValues = z.output<typeof formSchema>

function CustomerForm({ initialData, onSubmit, isLoading }: { initialData?: Customer, onSubmit: (data: CustomerFormValues) => void, isLoading: boolean }) {
    const blankAddress = () => ({
        label: "",
        name: "",
        address: "",
        state: "",
        country: "",
        pincode: "",
        contact_person: "",
        phone: "",
        email: "",
    })
    const normalizeAddresses = (entries: z.infer<typeof addressSchema>[]) =>
        entries.filter((entry) => Object.values(entry).some((value) => String(value || "").trim()))

    const form = useForm<CustomerFormInput, any, CustomerFormValues>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            code: initialData?.code || "",
            name: initialData?.name || "",
            under_group: initialData?.under_group || "",
            gst_no: initialData?.gst_no || "",
            pan_no: initialData?.pan_no || "",
            contact_person: initialData?.contact_person || "",
            phone: initialData?.phone || "",
            email: initialData?.email || "",
            contact_details: initialData?.contact_details || "",
            billing_address: initialData?.billing_address || "",
            shipping_address: initialData?.shipping_address || "",
            mailing_name: initialData?.mailing_name || "",
            mailing_state: initialData?.mailing_state || "",
            mailing_country: initialData?.mailing_country || "",
            mailing_pincode: initialData?.mailing_pincode || "",
            additional_addresses: initialData?.additional_addresses?.length ? initialData.additional_addresses : [],
            credit_days: initialData?.credit_days || 0,
            credit_limit: initialData?.credit_limit || 0,
            interest_calculation: initialData?.interest_calculation || "",
            bank_details: initialData?.bank_details || "",
            tds_deductable: Boolean(initialData?.tds_deductable),
            tcs_deductable: Boolean(initialData?.tcs_deductable),
            status: initialData?.status || 'ACTIVE',
        },
    })
    const { fields, append, remove } = useFieldArray({
        control: form.control,
        name: "additional_addresses",
    })

    return (
        <Form {...form}>
            <form
                onSubmit={form.handleSubmit((values) => onSubmit({
                    ...values,
                    additional_addresses: normalizeAddresses(values.additional_addresses || []),
                }))}
                className="space-y-6 py-4"
            >
                <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
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
                    <FormField
                        control={form.control}
                        name="under_group"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel className="text-[10px] font-black uppercase tracking-widest text-slate-500 italic">Under Group</FormLabel>
                                <FormControl>
                                    <Input placeholder="Sundry Debtors" className="h-12 rounded-xl border-slate-200 bg-slate-50/50 focus:bg-white transition-all font-semibold" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </div>

                <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
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

                <FormField
                    control={form.control}
                    name="contact_details"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel className="text-[10px] font-black uppercase tracking-widest text-slate-500 italic">Contact Details</FormLabel>
                            <FormControl>
                                <Textarea placeholder="Department, alternate numbers, escalation notes..." className="min-h-[88px] rounded-xl border-slate-200 bg-slate-50/50 pt-3 font-medium" {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
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
                    <FormField
                        control={form.control}
                        name="pan_no"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel className="text-[10px] font-black uppercase tracking-widest text-slate-500 italic">PAN No.</FormLabel>
                                <FormControl>
                                    <Input className="h-12 rounded-xl border-slate-200 bg-slate-50/50 focus:bg-white transition-all font-black uppercase italic" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </div>

                <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/70 p-5 space-y-5">
                    <div className="flex items-center gap-2">
                        <MapPin className="h-4 w-4 text-indigo-600" />
                        <div>
                            <div className="text-sm font-black text-slate-900">Primary Mailing Address</div>
                            <div className="text-xs font-medium text-slate-500">Default legal and communication address for this customer.</div>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                        <FormField
                            control={form.control}
                            name="mailing_name"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-[10px] font-black uppercase tracking-widest text-slate-500 italic">Mailing Name</FormLabel>
                                    <FormControl>
                                        <Input placeholder="Accounts / Dispatch / HO" className="h-12 rounded-xl border-slate-200 bg-white font-semibold" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="mailing_pincode"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-[10px] font-black uppercase tracking-widest text-slate-500 italic">Pincode</FormLabel>
                                    <FormControl>
                                        <Input placeholder="400001" className="h-12 rounded-xl border-slate-200 bg-white font-semibold" {...field} />
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
                                <FormLabel className="text-[10px] font-black uppercase tracking-widest text-slate-500 italic">Primary Address</FormLabel>
                                <FormControl>
                                    <Textarea className="h-24 rounded-xl border-slate-200 bg-white pt-3 font-medium" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                        <FormField
                            control={form.control}
                            name="mailing_state"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-[10px] font-black uppercase tracking-widest text-slate-500 italic">State</FormLabel>
                                    <FormControl>
                                        <Input className="h-12 rounded-xl border-slate-200 bg-white font-semibold" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="mailing_country"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-[10px] font-black uppercase tracking-widest text-slate-500 italic">Country</FormLabel>
                                    <FormControl>
                                        <Input className="h-12 rounded-xl border-slate-200 bg-white font-semibold" {...field} />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    </div>
                </div>

                <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 space-y-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                            <div className="text-sm font-black text-slate-900">Additional Addresses</div>
                            <div className="text-xs font-medium text-slate-500">Store extra delivery or branch addresses against the same customer ledger.</div>
                        </div>
                        <Button type="button" variant="outline" className="rounded-xl" onClick={() => append(blankAddress())}>
                            <Plus className="mr-2 h-4 w-4" /> Add Address
                        </Button>
                    </div>
                    {fields.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-400">
                            No additional addresses yet.
                        </div>
                    ) : fields.map((field, index) => (
                        <div key={field.id} className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 space-y-4">
                            <div className="flex items-center justify-between">
                                <div className="text-xs font-black uppercase tracking-[0.2em] text-slate-500">Address {index + 1}</div>
                                <Button type="button" variant="ghost" size="icon" onClick={() => remove(index)}>
                                    <Trash2 className="h-4 w-4 text-rose-500" />
                                </Button>
                            </div>
                            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                                <Input placeholder="Label (e.g. Surat DC)" {...form.register(`additional_addresses.${index}.label`)} />
                                <Input placeholder="Mailing name" {...form.register(`additional_addresses.${index}.name`)} />
                                <Textarea placeholder="Address" className="min-h-[88px] md:col-span-2" {...form.register(`additional_addresses.${index}.address`)} />
                                <Input placeholder="State" {...form.register(`additional_addresses.${index}.state`)} />
                                <Input placeholder="Country" {...form.register(`additional_addresses.${index}.country`)} />
                                <Input placeholder="Pincode" {...form.register(`additional_addresses.${index}.pincode`)} />
                                <Input placeholder="Contact person" {...form.register(`additional_addresses.${index}.contact_person`)} />
                                <Input placeholder="Phone" {...form.register(`additional_addresses.${index}.phone`)} />
                                <Input placeholder="Email" className="md:col-span-2" {...form.register(`additional_addresses.${index}.email`)} />
                            </div>
                        </div>
                    ))}
                </div>

                <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
                    <FormField
                        control={form.control}
                        name="credit_days"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel className="text-[10px] font-black uppercase tracking-widest text-slate-500 italic">Credit Period (Days)</FormLabel>
                                <FormControl>
                                    <Input type="number" min={0} className="h-12 rounded-xl border-slate-200 bg-slate-50/50 font-semibold" value={Number(field.value ?? 0)} onChange={(event) => field.onChange(Number(event.target.value || 0))} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="credit_limit"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel className="text-[10px] font-black uppercase tracking-widest text-slate-500 italic">Credit Limit</FormLabel>
                                <FormControl>
                                    <Input type="number" min={0} className="h-12 rounded-xl border-slate-200 bg-slate-50/50 font-semibold" value={Number(field.value ?? 0)} onChange={(event) => field.onChange(Number(event.target.value || 0))} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <FormField
                        control={form.control}
                        name="interest_calculation"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel className="text-[10px] font-black uppercase tracking-widest text-slate-500 italic">Interest Calculation</FormLabel>
                                <FormControl>
                                    <Input placeholder="Monthly / Simple / None" className="h-12 rounded-xl border-slate-200 bg-slate-50/50 font-semibold" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </div>

                <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                    <FormField
                        control={form.control}
                        name="bank_details"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel className="text-[10px] font-black uppercase tracking-widest text-slate-500 italic">Bank Details</FormLabel>
                                <FormControl>
                                    <Textarea placeholder="Bank name, branch, account, IFSC..." className="min-h-[88px] rounded-xl border-slate-200 bg-slate-50/50 pt-3 font-medium" {...field} />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                    <div className="grid gap-4">
                        <FormField
                            control={form.control}
                            name="tds_deductable"
                            render={({ field }) => (
                                <FormItem className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                                    <div>
                                        <FormLabel className="text-[10px] font-black uppercase tracking-widest text-slate-500 italic">TDS Deductable</FormLabel>
                                        <div className="text-xs text-slate-500">Enable if tax should be deducted for this customer ledger.</div>
                                    </div>
                                    <FormControl>
                                        <Switch checked={!!field.value} onCheckedChange={field.onChange} />
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="tcs_deductable"
                            render={({ field }) => (
                                <FormItem className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                                    <div>
                                        <FormLabel className="text-[10px] font-black uppercase tracking-widest text-slate-500 italic">TCS Deductable</FormLabel>
                                        <div className="text-xs text-slate-500">Enable if tax should be collected for this customer ledger.</div>
                                    </div>
                                    <FormControl>
                                        <Switch checked={!!field.value} onCheckedChange={field.onChange} />
                                    </FormControl>
                                </FormItem>
                            )}
                        />
                        <FormField
                            control={form.control}
                            name="status"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-[10px] font-black uppercase tracking-widest text-slate-500 italic">Status</FormLabel>
                                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                                        <FormControl>
                                            <SelectTrigger className="h-12 rounded-xl border-slate-200 bg-slate-50/50 font-semibold">
                                                <SelectValue placeholder="Select status" />
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
                </div>

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
                        <DialogContent className="max-w-5xl rounded-[2rem] border-none shadow-2xl p-8 bg-white max-h-[92vh] overflow-y-auto">
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
                <DialogContent className="max-w-5xl rounded-[2rem] border-none shadow-2xl p-8 bg-white max-h-[92vh] overflow-y-auto">
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

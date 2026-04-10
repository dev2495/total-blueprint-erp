"use client"

import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { Vendor } from "@/services/inventory"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormMessage,
} from "@/components/ui/form"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"

const vendorSchema = z.object({
    name: z.string().min(1, "Name is required"),
    code: z.string().min(1, "Code is required"),
    type: z.enum(['RM', 'JOBWORK', 'SERVICE', 'BOTH']),
    status: z.enum(['ACTIVE', 'INACTIVE', 'BLACKLISTED']),
    gst_no: z.string().optional(),
    phone_number: z.string().optional(),
    payment_terms: z.string().optional(),
    address: z.string().optional(),
    lead_time_days: z.number().min(0, "Lead time must be positive").default(0),
    turnaround_hours: z.number().min(0, "Turnaround must be zero or positive").default(0),
    qc_required: z.boolean().default(false),
    jobwork_capabilities_text: z.string().optional(),
    jobwork_plants_text: z.string().optional(),
})

type VendorFormInput = z.input<typeof vendorSchema>
type VendorFormValues = z.output<typeof vendorSchema>

interface Props {
    initialData?: Vendor
    onSubmit: (data: VendorFormValues) => void
    isLoading?: boolean
}

export function VendorForm({ initialData, onSubmit, isLoading }: Props) {
    const parseCsv = (value?: string) =>
        String(value || "")
            .split(",")
            .map((token) => token.trim())
            .filter(Boolean)

    const form = useForm<VendorFormInput, any, VendorFormValues>({
        resolver: zodResolver(vendorSchema),
        defaultValues: {
            name: initialData?.name || "",
            code: initialData?.code || "",
            type: (initialData?.type as any) || "RM",
            status: (initialData?.status as any) || "ACTIVE",
            gst_no: initialData?.gst_no || "",
            phone_number: initialData?.phone_number || "",
            payment_terms: initialData?.payment_terms || "",
            address: initialData?.address || "",
            lead_time_days: Number(initialData?.lead_time_days || 0),
            turnaround_hours: Number(initialData?.turnaround_hours || 0),
            qc_required: initialData?.qc_required ?? false,
            jobwork_capabilities_text: (initialData?.jobwork_capabilities || []).join(", "),
            jobwork_plants_text: (initialData?.jobwork_plants || []).join(", "),
        }
    })
    const vendorType = form.watch("type")
    const isJobworkVendor = vendorType === "JOBWORK" || vendorType === "BOTH"

    return (
        <Form {...form}>
            <form
                onSubmit={form.handleSubmit((values) =>
                    onSubmit({
                        ...values,
                        turnaround_hours: isJobworkVendor ? Number(values.turnaround_hours || 0) : 0,
                        qc_required: isJobworkVendor ? Boolean(values.qc_required) : false,
                        jobwork_capabilities: isJobworkVendor ? parseCsv(values.jobwork_capabilities_text) : [],
                        jobwork_plants: isJobworkVendor ? parseCsv(values.jobwork_plants_text) : [],
                    } as any)
                )}
                className="space-y-4"
            >
                <div className="grid grid-cols-2 gap-4">
                    <FormField
                        control={form.control}
                        name="code"
                        render={({ field }) => (
                            <FormItem>
                                <Label className="text-xs font-bold text-slate-500 uppercase">Vendor Code</Label>
                                <FormControl>
                                    <Input placeholder="V-001" className="font-mono text-sm" {...field} />
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
                                <Label className="text-xs font-bold text-slate-500 uppercase">Vendor Name</Label>
                                <FormControl>
                                    <Input placeholder="Acme Corp" className="text-sm font-semibold" {...field} />
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
                                <Label className="text-xs font-bold text-slate-500 uppercase">Type</Label>
                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                    <FormControl>
                                        <SelectTrigger className="text-sm">
                                            <SelectValue placeholder="Select type" />
                                        </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                        <SelectItem value="RM">Raw Material Supplier</SelectItem>
                                        <SelectItem value="JOBWORK">Job Worker</SelectItem>
                                        <SelectItem value="SERVICE">Service Provider</SelectItem>
                                        <SelectItem value="BOTH">Both (Supplier & JW)</SelectItem>
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
                                <Label className="text-xs font-bold text-slate-500 uppercase">Status</Label>
                                <Select onValueChange={field.onChange} defaultValue={field.value}>
                                    <FormControl>
                                        <SelectTrigger className="text-sm">
                                            <SelectValue placeholder="Select status" />
                                        </SelectTrigger>
                                    </FormControl>
                                    <SelectContent>
                                        <SelectItem value="ACTIVE">Active</SelectItem>
                                        <SelectItem value="INACTIVE">Inactive</SelectItem>
                                        <SelectItem value="BLACKLISTED">Blacklisted</SelectItem>
                                    </SelectContent>
                                </Select>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <FormField
                        control={form.control}
                        name="gst_no"
                        render={({ field }) => (
                            <FormItem>
                                <Label className="text-xs font-bold text-slate-500 uppercase">GST No (Optional)</Label>
                                <FormControl>
                                    <Input placeholder="27XXXX" className="text-sm font-mono" {...field} />
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
                                <Label className="text-xs font-bold text-slate-500 uppercase">Lead Time (Days)</Label>
                                <FormControl>
                                    <Input
                                        type="number"
                                        min={0}
                                        className="text-sm"
                                        value={field.value ?? 0}
                                        onChange={(e) => field.onChange(Number(e.target.value || 0))}
                                    />
                                </FormControl>
                                <FormMessage />
                            </FormItem>
                        )}
                    />
                </div>

                <FormField
                    control={form.control}
                    name="phone_number"
                    render={({ field }) => (
                        <FormItem>
                            <Label className="text-xs font-bold text-slate-500 uppercase">Phone Number (Optional)</Label>
                            <FormControl>
                                <Input placeholder="+91..." className="text-sm font-mono" {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                {isJobworkVendor && (
                    <div className="rounded-2xl border border-indigo-100 bg-indigo-50/40 p-4 space-y-4">
                        <div>
                            <p className="text-xs font-black uppercase tracking-[0.18em] text-indigo-700">Jobwork controls</p>
                            <p className="text-xs font-semibold text-slate-500">Optional routing and QC details for jobwork vendors only.</p>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <FormField
                                control={form.control}
                                name="turnaround_hours"
                                render={({ field }) => (
                                    <FormItem>
                                        <Label className="text-xs font-bold text-slate-500 uppercase">Jobwork Turnaround (Hours)</Label>
                                        <FormControl>
                                            <Input
                                                type="number"
                                                min={0}
                                                className="text-sm"
                                                value={field.value ?? 0}
                                                onChange={(e) => field.onChange(Number(e.target.value || 0))}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="qc_required"
                                render={({ field }) => (
                                    <FormItem className="flex items-center justify-between rounded-xl border border-indigo-100 bg-white px-3 py-2.5 mt-6">
                                        <div>
                                            <Label className="text-xs font-bold text-slate-500 uppercase">QC Required on Return</Label>
                                            <p className="text-xs text-slate-400 mt-1">Optional. Enable only if returns must stay blocked for QC.</p>
                                        </div>
                                        <FormControl>
                                            <Switch checked={!!field.value} onCheckedChange={field.onChange} />
                                        </FormControl>
                                    </FormItem>
                                )}
                            />
                        </div>

                        <FormField
                            control={form.control}
                            name="jobwork_capabilities_text"
                            render={({ field }) => (
                                <FormItem>
                                    <Label className="text-xs font-bold text-slate-500 uppercase">Jobwork Process Capabilities</Label>
                                    <FormControl>
                                        <Input placeholder="PRINTING, LAMINATION, SLITTING" className="text-sm font-mono bg-white" {...field} />
                                    </FormControl>
                                    <p className="text-xs text-slate-400">Optional comma-separated process codes. Keep empty for generic compatibility.</p>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <FormField
                            control={form.control}
                            name="jobwork_plants_text"
                            render={({ field }) => (
                                <FormItem>
                                    <Label className="text-xs font-bold text-slate-500 uppercase">Jobwork Plant Coverage</Label>
                                    <FormControl>
                                        <Input placeholder="PLANT_A, PLANT_B" className="text-sm font-mono bg-white" {...field} />
                                    </FormControl>
                                    <p className="text-xs text-slate-400">Optional comma-separated plant IDs/codes. Keep empty for all plants.</p>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                    </div>
                )}

                <FormField
                    control={form.control}
                    name="payment_terms"
                    render={({ field }) => (
                        <FormItem>
                            <Label className="text-xs font-bold text-slate-500 uppercase">Payment Terms (Optional)</Label>
                            <FormControl>
                                <Input placeholder="Net 30, Advance 50%" className="text-sm" {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <FormField
                    control={form.control}
                    name="address"
                    render={({ field }) => (
                        <FormItem>
                            <Label className="text-xs font-bold text-slate-500 uppercase">Address (Optional)</Label>
                            <FormControl>
                                <Textarea placeholder="Full address" className="text-sm resize-none" {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />

                <div className="flex justify-end pt-4">
                    <Button type="submit" disabled={isLoading} className="font-bold shadow-md">
                        {isLoading ? "Saving..." : initialData ? "Update Vendor" : "Create Vendor"}
                    </Button>
                </div>
            </form>
        </Form>
    )
}

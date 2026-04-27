"use client"

import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import { Plus, CheckCircle } from "lucide-react"
import { useEffect } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
    Form, FormControl, FormField, FormItem, FormLabel, FormMessage
} from "@/components/ui/form"
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select"

const formSchema = z.object({
    product_name: z.string().min(1, "Product Name is required"),
    order_qty: z.coerce.number().min(1, "Quantity is required"),
    uom: z.enum(["KG", "PCS"]),
    fg_type: z.enum(["POUCH", "ROLL"]),

    // Geometry
    geometry: z.object({
        width_mm: z.coerce.number().min(1),
        height_mm: z.coerce.number().min(1),
        gusset_mm: z.coerce.number().optional()
    }),

    // Stack Short-hand
    film_layers: z.string().min(1, "Material structure is required (e.g. 12PET/12METPET/100PE)"),

    // Printing
    printing: z.object({
        type: z.enum(["NONE", "FLEXO", "ROTO", "DIGITAL"]),
        colors_count: z.coerce.number().min(0)
    }),

    notes: z.string().optional(),
})

export type RequestFormValues = z.infer<typeof formSchema>

interface BlueprintRequestFormProps {
    onSubmit: (data: RequestFormValues) => void;
    isLoading: boolean;
}

export function BlueprintRequestForm({ onSubmit, isLoading, initialValues }: BlueprintRequestFormProps & { initialValues?: Partial<RequestFormValues> }) {
    const defaultValues: RequestFormValues = {
        product_name: "",
        order_qty: 500,
        uom: "KG",
        fg_type: "POUCH",
        geometry: { width_mm: 0, height_mm: 0 },
        film_layers: "",
        printing: { type: "ROTO", colors_count: 0 },
        notes: ""
    }

    const form = useForm<RequestFormValues>({
        resolver: zodResolver(formSchema) as any,
        defaultValues: initialValues || defaultValues,
    })

    // Reset form when initialValues change (for edit mode)
    const { reset } = form
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const startValues = JSON.stringify(initialValues)
    if (initialValues && form.formState.isSubmitSuccessful) {
        // optional: reset only on success if needed, but for "Edit" opening, usually we reset immediately 
        // Actually, let's use useEffect to avoid loop
    }

    // Using a key on the parent or useEffect is better, but here we use useEffect
    useEffect(() => {
        if (initialValues) {
            reset(initialValues)
        }
    }, [startValues, reset])

    return (
        <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">

                <div className="grid grid-cols-6 gap-4">
                    <FormField control={form.control} name="product_name" render={({ field }) => (
                        <FormItem className="col-span-4">
                            <FormLabel className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Product Name</FormLabel>
                            <FormControl><Input placeholder="e.g. 1kg Basmati Rice Pouch" {...field} className="h-10 font-bold" /></FormControl>
                            <FormMessage />
                        </FormItem>
                    )} />
                    <FormField control={form.control} name="order_qty" render={({ field }) => (
                        <FormItem className="col-span-2">
                            <FormLabel className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Est. Qty</FormLabel>
                            <FormControl><Input type="number" {...field} className="h-10 font-bold" /></FormControl>
                        </FormItem>
                    )} />
                </div>

                <div className="grid grid-cols-3 gap-4 p-4 bg-slate-50 rounded-xl border border-slate-100 relative">
                    <span className="absolute -top-2 left-3 bg-white px-2 text-[9px] font-black uppercase text-blue-500 tracking-widest border border-blue-100 rounded-md">Geometry</span>
                    <FormField control={form.control} name="geometry.width_mm" render={({ field }) => (
                        <FormItem>
                            <FormLabel className="text-[10px] uppercase text-slate-400 font-bold">Width (mm)</FormLabel>
                            <FormControl><Input type="number" {...field} className="h-9 bg-white" placeholder="W" /></FormControl>
                        </FormItem>
                    )} />
                    <FormField control={form.control} name="geometry.height_mm" render={({ field }) => (
                        <FormItem>
                            <FormLabel className="text-[10px] uppercase text-slate-400 font-bold">Height (mm)</FormLabel>
                            <FormControl><Input type="number" {...field} className="h-9 bg-white" placeholder="H" /></FormControl>
                        </FormItem>
                    )} />
                    <FormField control={form.control} name="geometry.gusset_mm" render={({ field }) => (
                        <FormItem>
                            <FormLabel className="text-[10px] uppercase text-slate-400 font-bold">Gusset (mm)</FormLabel>
                            <FormControl><Input type="number" {...field} className="h-9 bg-white" placeholder="G" /></FormControl>
                        </FormItem>
                    )} />
                </div>

                <FormField control={form.control} name="film_layers" render={({ field }) => (
                    <FormItem>
                        <FormLabel className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Material Structure (Short-hand)</FormLabel>
                        <FormControl>
                            <Input placeholder="e.g. 12PET / 12METPET / 100PE" {...field} className="h-10 font-mono text-xs" />
                        </FormControl>
                        <FormMessage />
                    </FormItem>
                )} />

                <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="printing.type" render={({ field }) => (
                        <FormItem>
                            <FormLabel className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Print Tech</FormLabel>
                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                                <FormControl><SelectTrigger className="h-10 font-bold"><SelectValue /></SelectTrigger></FormControl>
                                <SelectContent>
                                    <SelectItem value="ROTO">Rotogravure</SelectItem>
                                    <SelectItem value="FLEXO">Flexography</SelectItem>
                                    <SelectItem value="DIGITAL">Digital</SelectItem>
                                    <SelectItem value="NONE">Plain / Unprinted</SelectItem>
                                </SelectContent>
                            </Select>
                        </FormItem>
                    )} />

                    <FormField control={form.control} name="printing.colors_count" render={({ field }) => (
                        <FormItem>
                            <FormLabel className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Colors</FormLabel>
                            <FormControl><Input type="number" {...field} className="h-10 font-bold" /></FormControl>
                        </FormItem>
                    )} />
                </div>

                <div className="flex justify-end gap-2 pt-4 border-t border-slate-100">
                    <Button type="submit" disabled={isLoading} className="bg-blue-600 hover:bg-slate-900 text-white font-black uppercase text-[10px] tracking-widest h-10 px-6 rounded-lg shadow-lg active-scale">
                        {initialValues ? 'SAVE CHANGES' : <><Plus className="h-4 w-4 mr-2" /> CREATE DRAFT</>}
                    </Button>
                </div>
            </form>
        </Form>
    )
}

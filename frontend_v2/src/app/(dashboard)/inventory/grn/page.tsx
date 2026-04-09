"use client"

import { useEffect, useMemo, useState } from "react"
import { useForm, useFieldArray } from "react-hook-form"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { Loader2, Plus, Trash2, Package, Layers, Activity, ClipboardCheck, Warehouse, ArrowRight, Dna } from "lucide-react"
import { AxiosError } from "axios"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
    Form,
    FormControl,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

import { inventoryService } from "@/services/inventory"
import { factoryService } from "@/services/factory"
import { masterDataService } from "@/services/master-data"
import { recipeService } from "@/services/recipes" // Phase 56: Grade dropdown
import { MaterialPicker } from "@/components/inventory/material-picker"
import { cn } from "@/lib/utils"

// --- Schemas ---

const bulkSchema = z.object({
    plant_id: z.string().min(1, "Plant Required"),
    location_id: z.string().min(1, "Location Required"),
    vendor_id: z.string().min(1, "Vendor Required"),
    material_id: z.string().min(1, "Material Required"),
    quantity: z.coerce.number().min(0.001, "Quantity must be > 0"),
    cost: z.coerce.number().min(0).optional(), // Phase 56: Cost for avg calculation
    reference: z.string().optional(),
})

const rollItemSchema = z.object({
    label_id: z.string().optional(),
    thickness_micron: z.coerce.number().min(0.1, "Thickness Required"),
    width_mm: z.coerce.number().min(1, "Width Required"),
    weight_kg: z.coerce.number().min(0.001, "Weight Required"),
    grade_id: z.string().optional(),
})

const rollGrnSchema = z.object({
    plant_id: z.string().min(1, "Plant Required"),
    location_id: z.string().min(1, "Location Required"),
    vendor_id: z.string().min(1, "Vendor Required"),
    material_id: z.string().min(1, "Material Required"),
    reference: z.string().optional(),
    rolls: z.array(rollItemSchema).min(1, "Add at least one roll"),
})

const packagingSchema = z.object({
    plant_id: z.string().min(1, "Plant Required"),
    location_id: z.string().min(1, "Location Required"),
    vendor_id: z.string().min(1, "Vendor Required"),
    material_id: z.string().min(1, "Material Required"),
    quantity: z.coerce.number().min(0.001, "Quantity must be > 0"),
    cost: z.coerce.number().min(0).optional(),
    reference: z.string().optional(),
})

// --- Components ---

export default function GRNPage() {
    const [activeTab, setActiveTab] = useState("bulk")

    return (
        <div className="p-6 lg:p-8 space-y-8 bg-[#f8fafc] min-h-screen" data-testid="grn-page">
            {/* Header Section */}
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
                <div className="space-y-1">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-100 text-emerald-600 text-[10px] font-black uppercase tracking-widest shadow-sm translate-y-[-4px]">
                        <Warehouse className="h-3 w-3" /> Material Inwarding
                    </div>
                    <h1 className="text-3xl font-black tracking-tight text-slate-900 flex items-center gap-3">
                        GRN
                        <span className="text-slate-300 font-light translate-y-[2px]">/</span>
                        <span className="text-indigo-600 italic">Dock</span>
                    </h1>
                    <p className="text-slate-500 font-medium text-xs flex items-center gap-2 italic">
                        Processing incoming material streams <Activity className="h-3.5 w-3.5 text-indigo-400" />
                    </p>
                </div>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full space-y-8">
                <div className="flex justify-center">
                    <TabsList className="bg-white/50 backdrop-blur-md p-1 rounded-2xl border border-slate-200 shadow-sm h-14">
                        <TabsTrigger value="bulk" data-testid="grn-tab-bulk" className="rounded-xl px-8 h-12 data-[state=active]:bg-indigo-600 data-[state=active]:text-white data-[state=active]:shadow-xl transition-all text-[10px] font-black uppercase tracking-widest flex items-center gap-2">
                            <Package className="h-4 w-4" /> Bulk Material
                        </TabsTrigger>
                        <TabsTrigger value="roll" data-testid="grn-tab-roll" className="rounded-xl px-8 h-12 data-[state=active]:bg-indigo-600 data-[state=active]:text-white data-[state=active]:shadow-xl transition-all text-[10px] font-black uppercase tracking-widest flex items-center gap-2">
                            <Layers className="h-4 w-4" /> Roll Stock
                        </TabsTrigger>
                        <TabsTrigger value="packaging" data-testid="grn-tab-packaging" className="rounded-xl px-8 h-12 data-[state=active]:bg-indigo-600 data-[state=active]:text-white data-[state=active]:shadow-xl transition-all text-[10px] font-black uppercase tracking-widest flex items-center gap-2">
                            <Package className="h-4 w-4" /> Packaging
                        </TabsTrigger>
                    </TabsList>
                </div>

                <TabsContent value="bulk" className="animate-in slide-in-from-bottom-5 duration-500">
                    <BulkGRNForm />
                </TabsContent>
                <TabsContent value="roll" className="animate-in slide-in-from-bottom-5 duration-500">
                    <RollGRNForm />
                </TabsContent>
                <TabsContent value="packaging" className="animate-in slide-in-from-bottom-5 duration-500">
                    <PackagingGRNForm />
                </TabsContent>
            </Tabs>
        </div>
    )
}

function BulkGRNForm() {
    const queryClient = useQueryClient()
    const [materialLane, setMaterialLane] = useState<"GRANULE" | "INK" | "ADHESIVE" | "SOLVENT" | "POD">("GRANULE")

    const { data: plants } = useQuery({ queryKey: ['plants'], queryFn: factoryService.getPlants })
    const { data: vendors = [] } = useQuery({ queryKey: ['vendors'], queryFn: inventoryService.getVendors })
    const { data: granules } = useQuery({ queryKey: ['materials', 'granules'], queryFn: () => masterDataService.getGranules() })
    const { data: inks } = useQuery({ queryKey: ['materials', 'inks'], queryFn: () => masterDataService.getInks() })
    const { data: adhesivesSolvents } = useQuery({ queryKey: ['materials', 'adhesives-solvents'], queryFn: () => masterDataService.getAdhesivesSolvents() })
    const { data: podMaterials } = useQuery({ queryKey: ['materials', 'pod'], queryFn: () => masterDataService.getPODMaterials() })

    const form = useForm<z.infer<typeof bulkSchema>>({
        resolver: zodResolver(bulkSchema) as any,
        defaultValues: {
            plant_id: "",
            location_id: "",
            vendor_id: "",
            material_id: "",
            quantity: 0,
            cost: 0,
            reference: "",
        }
    })

    const selectedPlantId = form.watch('plant_id')
    const selectedMaterialId = form.watch('material_id')

    const adhesiveMaster = useMemo(() => {
        const rows = Array.isArray(adhesivesSolvents) ? adhesivesSolvents : []
        return rows.find((item: any) => item.code === 'AD-ADHESIVE') || rows.find((item: any) => item.category === 'ADHESIVE') || null
    }, [adhesivesSolvents])

    const solventMaster = useMemo(() => {
        const rows = Array.isArray(adhesivesSolvents) ? adhesivesSolvents : []
        return rows.find((item: any) => item.code === 'AD-SOLVENT') || rows.find((item: any) => item.category === 'SOLVENT') || null
    }, [adhesivesSolvents])

    const materialPools = useMemo(() => ({
        GRANULE: Array.isArray(granules) ? granules.map((item: any) => ({ ...item, category: 'GRANULE' })) : [],
        INK: Array.isArray(inks) ? inks.map((item: any) => ({ ...item, category: 'INK' })) : [],
        ADHESIVE: adhesiveMaster ? [{ ...adhesiveMaster, category: 'ADHESIVE' }] : [],
        SOLVENT: solventMaster ? [{ ...solventMaster, category: 'SOLVENT' }] : [],
        POD: Array.isArray(podMaterials) ? podMaterials.map((item: any) => ({ ...item, category: 'POD' })) : [],
    }), [adhesiveMaster, granules, inks, podMaterials, solventMaster])

    const selectedMaterials = materialPools[materialLane] || []
    const lockedMaterial = materialLane === 'ADHESIVE' ? adhesiveMaster : materialLane === 'SOLVENT' ? solventMaster : null

    useEffect(() => {
        if (lockedMaterial) {
            if (selectedMaterialId !== lockedMaterial.id) {
                form.setValue('material_id', lockedMaterial.id, { shouldDirty: true, shouldValidate: true })
            }
            return
        }
        if (selectedMaterialId && !selectedMaterials.some((item: any) => item.id === selectedMaterialId)) {
            form.setValue('material_id', '', { shouldDirty: true, shouldValidate: true })
        }
    }, [form, lockedMaterial, selectedMaterialId, selectedMaterials])

    const { data: locations } = useQuery({
        queryKey: ['locations', 'all'],
        queryFn: factoryService.getLocations
    })

    const filteredLocations = (locations || []).filter((l: any) =>
        l.is_active
        && ['WAREHOUSE', 'QC', 'RM', 'WIP'].includes(l.type)
        && (!selectedPlantId || String(l.plant) === String(selectedPlantId))
    )

    const mutation = useMutation({
        mutationFn: inventoryService.createBulkGRN,
        onSuccess: () => {
            toast.success("Bulk GRN Created")
            setMaterialLane('GRANULE')
            form.reset({
                plant_id: '',
                location_id: '',
                vendor_id: '',
                material_id: '',
                quantity: 0,
                cost: 0,
                reference: '',
            })
            queryClient.invalidateQueries({ queryKey: ['stock'] })
        },
        onError: (error: AxiosError<{ detail: string }>) => {
            toast.error("Failed to create GRN", {
                description: error.response?.data?.detail || error.message
            })
        }
    })

    function onSubmit(data: z.infer<typeof bulkSchema>) {
        mutation.mutate(data)
    }

    const laneLabel = {
        GRANULE: 'Granule',
        INK: 'Ink',
        ADHESIVE: 'Adhesive',
        SOLVENT: 'Solvent',
        POD: 'POD',
    }[materialLane]

    return (
        <Card className="border-none shadow-premium rounded-[2.5rem] bg-white/70 backdrop-blur-md overflow-hidden max-w-4xl mx-auto">
            <CardHeader className="p-8 pb-2 border-b border-slate-50 bg-slate-50/30">
                <CardTitle className="text-xl font-black tracking-tight text-slate-900 flex items-center gap-3">
                    <Dna className="h-6 w-6 text-indigo-500" />
                    Inward Bulk Material
                </CardTitle>
                <CardDescription className="text-[10px] font-bold uppercase text-slate-400 tracking-widest pl-9">
                    Granules, inks, fixed adhesive / solvent masters, and POD
                </CardDescription>
            </CardHeader>
            <CardContent className="p-8">
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6" data-testid="bulk-grn-form">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <FormField
                                control={form.control}
                                name="plant_id"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Plant</FormLabel>
                                        <Select onValueChange={field.onChange} value={field.value}>
                                            <FormControl>
                                                <SelectTrigger className="h-12 border-2 border-slate-100 bg-white rounded-xl focus:border-indigo-600 font-bold" data-testid="bulk-grn-plant">
                                                    <SelectValue placeholder="Select Plant" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent className="rounded-xl border-none shadow-2xl">
                                                {(plants || []).map((p: any) => (
                                                    <SelectItem key={p.id} value={p.id} className="font-bold text-xs uppercase tracking-wide">{p.name}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="location_id"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Storage Location</FormLabel>
                                        <Select
                                            onValueChange={(val) => {
                                                field.onChange(val)
                                                const loc = filteredLocations.find((l: any) => l.id === val)
                                                if (loc) form.setValue('plant_id', loc.plant)
                                            }}
                                            value={field.value}
                                        >
                                            <FormControl>
                                                <SelectTrigger className="h-12 border-2 border-slate-100 bg-white rounded-xl focus:border-indigo-600 font-bold" data-testid="bulk-grn-location">
                                                    <SelectValue placeholder="Select Location" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent className="rounded-xl border-none shadow-2xl">
                                                {filteredLocations.map((l: any) => (
                                                    <SelectItem key={l.id} value={l.id} className="font-bold text-xs uppercase tracking-wide">
                                                        {l.name} <span className="text-slate-400 text-[10px] ml-1">({l.type})</span>
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="vendor_id"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Vendor</FormLabel>
                                        <Select onValueChange={field.onChange} value={field.value}>
                                            <FormControl>
                                                <SelectTrigger className="h-12 border-2 border-slate-100 bg-white rounded-xl focus:border-indigo-600 font-bold" data-testid="bulk-grn-vendor">
                                                    <SelectValue placeholder="Select Vendor" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent className="rounded-xl border-none shadow-2xl">
                                                {vendors
                                                    .filter((v: any) => ["RM", "BOTH"].includes(String(v?.type || "").toUpperCase()) && String(v?.status || "").toUpperCase() === "ACTIVE")
                                                    .map((v: any) => (
                                                        <SelectItem key={v.id} value={v.id} className="font-bold text-xs uppercase tracking-wide">
                                                            {v.name}
                                                        </SelectItem>
                                                    ))}
                                            </SelectContent>
                                        </Select>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50/50 p-4">
                            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Material lane</div>
                            <div className="flex flex-wrap gap-2">
                                {[
                                    { value: 'GRANULE', label: 'Granule' },
                                    { value: 'INK', label: 'Ink' },
                                    { value: 'ADHESIVE', label: 'Adhesive' },
                                    { value: 'SOLVENT', label: 'Solvent' },
                                    { value: 'POD', label: 'POD' },
                                ].map((lane) => (
                                    <button
                                        key={lane.value}
                                        type="button"
                                        onClick={() => setMaterialLane(lane.value as any)}
                                        className={cn(
                                            'rounded-full border px-3 py-2 text-[11px] font-black uppercase tracking-[0.18em] transition-colors',
                                            materialLane === lane.value
                                                ? 'border-indigo-600 bg-indigo-600 text-white shadow-lg shadow-indigo-100'
                                                : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-200 hover:text-indigo-600'
                                        )}
                                    >
                                        {lane.label}
                                    </button>
                                ))}
                            </div>
                            <div className="text-xs text-slate-500">
                                Adhesive and solvent inward are locked to the system chemistry masters, so only vendor, location, quantity, cost, and reference stay operator-editable.
                            </div>
                        </div>

                        <FormField
                            control={form.control}
                            name="material_id"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-[10px] font-black uppercase text-slate-500 tracking-widest">
                                        {lockedMaterial ? 'Locked Material' : `${laneLabel} Material`}
                                    </FormLabel>
                                    <FormControl>
                                        {lockedMaterial ? (
                                            <div className="rounded-2xl border border-indigo-100 bg-indigo-50/50 p-4" data-testid="bulk-grn-locked-material">
                                                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-indigo-500">{lockedMaterial.category}</div>
                                                <div className="mt-2 text-lg font-black tracking-tight text-slate-900">{lockedMaterial.name}</div>
                                                <div className="mt-1 font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">{lockedMaterial.code}</div>
                                                <div className="mt-3 text-xs text-slate-500">System-managed chemistry master. No alternate adhesive or solvent can be picked here.</div>
                                            </div>
                                        ) : (
                                            <MaterialPicker
                                                items={selectedMaterials}
                                                value={field.value}
                                                onValueChange={field.onChange}
                                                placeholder={`Search ${laneLabel} material...`}
                                                testId="bulk-grn-material"
                                            />
                                        )}
                                    </FormControl>
                                    {!lockedMaterial && !selectedMaterials.length ? (
                                        <div className="text-xs text-amber-600">No {laneLabel.toLowerCase()} masters are available yet.</div>
                                    ) : null}
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <FormField
                                control={form.control}
                                name="quantity"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Quantity (KG)</FormLabel>
                                        <FormControl>
                                            <Input data-testid="bulk-grn-quantity" type="number" step="0.001" {...field} className="h-12 border-2 border-slate-100 bg-white rounded-xl focus:border-indigo-600 font-bold text-lg" />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="cost"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Cost per KG (₹)</FormLabel>
                                        <FormControl>
                                            <Input type="number" step="0.01" {...field} className="h-12 border-2 border-slate-100 bg-white rounded-xl focus:border-indigo-600 font-bold text-lg" />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="reference"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Reference (Invoice/Challan)</FormLabel>
                                        <FormControl>
                                            <Input {...field} className="h-12 border-2 border-slate-100 bg-white rounded-xl focus:border-indigo-600 font-bold" />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <Button type="submit" data-testid="bulk-grn-submit" disabled={mutation.isPending} className="w-full h-14 bg-indigo-600 hover:bg-slate-900 text-white rounded-2xl shadow-xl shadow-indigo-200 hover:shadow-2xl transition-all active-scale font-black uppercase tracking-[0.2em] mt-4">
                            {mutation.isPending && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
                            Execute Inward
                        </Button>
                    </form>
                </Form>
            </CardContent>
        </Card>
    )
}

function RollGRNForm() {
    const queryClient = useQueryClient()
    const { data: plants } = useQuery({ queryKey: ['plants'], queryFn: factoryService.getPlants })
    const { data: vendors = [] } = useQuery({ queryKey: ['vendors'], queryFn: inventoryService.getVendors })
    const { data: filmFamilies } = useQuery({ queryKey: ['materials', 'film-families'], queryFn: masterDataService.getFilmFamilies })
    const { data: filmVariants } = useQuery({ queryKey: ['materials', 'film-variants'], queryFn: masterDataService.getFilmVariants })
    // Phase 56: Fetch grades for extrusion tracking
    const { data: grades } = useQuery({ queryKey: ['recipe-grades'], queryFn: () => recipeService.getGrades() })

    const filmMaterials = [
        ...(Array.isArray(filmFamilies) ? filmFamilies.map(f => ({ ...f, type: 'FAMILY' })) : []),
        ...(Array.isArray(filmVariants) ? filmVariants.map(v => ({ ...v, type: 'VARIANT' })) : [])
    ]

    const form = useForm<z.infer<typeof rollGrnSchema>>({
        resolver: zodResolver(rollGrnSchema) as any,
        defaultValues: {
            plant_id: "",
            location_id: "",
            vendor_id: "",
            material_id: "",
            reference: "",
            rolls: [{ label_id: "", thickness_micron: 0, width_mm: 0, weight_kg: 0, grade_id: "" }]
        }
    })

    const { fields, append, remove } = useFieldArray({
        control: form.control,
        name: "rolls"
    })

    const selectedPlantId = form.watch('plant_id')
    const selectedMaterialId = form.watch('material_id')
    const selectedVariant = (filmVariants || []).find((v: any) => String(v.id) === String(selectedMaterialId || ""))
    const gradeRequired = !!selectedVariant?.is_extrudable

    const { data: locations } = useQuery({
        queryKey: ['locations', 'all'],
        queryFn: factoryService.getLocations
    })

    const filteredLocations = (locations || []).filter((l: any) =>
        l.is_active
        && ['WAREHOUSE', 'QC', 'RM', 'WIP'].includes(l.type)
        && (!selectedPlantId || String(l.plant) === String(selectedPlantId))
    )

    const mutation = useMutation({
        mutationFn: inventoryService.createRollGRN,
        onSuccess: () => {
            toast.success("Roll GRN Created")
            form.reset({
                rolls: [{ label_id: "", thickness_micron: 0, width_mm: 0, weight_kg: 0, grade_id: "" }]
            })
            queryClient.invalidateQueries({ queryKey: ['stock'] })
            queryClient.invalidateQueries({ queryKey: ['rolls'] })
        },
        onError: (error: AxiosError<{ detail: string }>) => {
            toast.error("Failed", { description: error.response?.data?.detail || error.message })
        }
    })

    function onSubmit(data: z.infer<typeof rollGrnSchema>) {
        if (gradeRequired) {
            const missingGradeIndex = (data.rolls || []).findIndex((r: any) => !String(r?.grade_id || "").trim())
            if (missingGradeIndex >= 0) {
                toast.error("Grade required", { description: `Roll ${missingGradeIndex + 1}: grade is mandatory for extrudable variant inward.` })
                return
            }
        }
        mutation.mutate(data)
    }

    useEffect(() => {
        if (gradeRequired) return
        const rows = form.getValues("rolls") || []
        rows.forEach((_, idx) => form.setValue(`rolls.${idx}.grade_id`, ""))
    }, [gradeRequired, form, fields.length])


    return (
        <Card className="border-none shadow-premium rounded-[2.5rem] bg-white/70 backdrop-blur-md overflow-hidden max-w-5xl mx-auto">
            <CardHeader className="p-8 pb-2 border-b border-slate-50 bg-slate-50/30">
                <CardTitle className="text-xl font-black tracking-tight text-slate-900 flex items-center gap-3">
                    <ClipboardCheck className="h-6 w-6 text-emerald-500" />
                    Inward Roll Stock
                </CardTitle>
                <CardDescription className="text-[10px] font-bold uppercase text-slate-400 tracking-widest pl-9">
                    Films, Substrates & Laminates
                </CardDescription>
            </CardHeader>
            <CardContent className="p-8">
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6" data-testid="roll-grn-form">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <FormField
                                control={form.control}
                                name="plant_id"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Plant</FormLabel>
                                        <Select onValueChange={field.onChange} value={field.value}>
                                            <FormControl>
                                                <SelectTrigger className="h-12 border-2 border-slate-100 bg-white rounded-xl focus:border-indigo-600 font-bold" data-testid="roll-grn-plant">
                                                    <SelectValue placeholder="Select Plant" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent className="rounded-xl border-none shadow-2xl">
                                                {(plants || []).map((p: any) => <SelectItem key={p.id} value={p.id} className="font-bold text-xs uppercase tracking-wide">{p.name}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="location_id"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Location</FormLabel>
                                        <Select
                                            onValueChange={(val) => {
                                                field.onChange(val)
                                                const loc = filteredLocations.find(l => l.id === val)
                                                if (loc) form.setValue('plant_id', loc.plant)
                                            }}
                                            value={field.value}
                                        >
                                            <FormControl>
                                                <SelectTrigger className="h-12 border-2 border-slate-100 bg-white rounded-xl focus:border-indigo-600 font-bold" data-testid="roll-grn-location">
                                                    <SelectValue placeholder="Select Location" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent className="rounded-xl border-none shadow-2xl">
                                                {filteredLocations.map((l: any) => (
                                                    <SelectItem key={l.id} value={l.id} className="font-bold text-xs uppercase tracking-wide">
                                                        {l.name} <span className="text-slate-400 text-[10px] ml-1">({l.type})</span>
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="vendor_id"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Vendor</FormLabel>
                                        <Select onValueChange={field.onChange} value={field.value}>
                                            <FormControl>
                                                <SelectTrigger className="h-12 border-2 border-slate-100 bg-white rounded-xl focus:border-indigo-600 font-bold" data-testid="roll-grn-vendor">
                                                    <SelectValue placeholder="Select Vendor" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent className="rounded-xl border-none shadow-2xl">
                                                {vendors
                                                    .filter((v: any) => ["RM", "BOTH"].includes(String(v?.type || "").toUpperCase()) && String(v?.status || "").toUpperCase() === "ACTIVE")
                                                    .map((v: any) => (
                                                        <SelectItem key={v.id} value={v.id} className="font-bold text-xs uppercase tracking-wide">
                                                            {v.name}
                                                        </SelectItem>
                                                    ))}
                                            </SelectContent>
                                        </Select>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <FormField
                                control={form.control}
                                name="material_id"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Film Variant</FormLabel>
                                        <FormControl>
                                            <MaterialPicker
                                                items={(filmVariants || []).filter((v: any) => v.is_purchasable).map((v: any) => {
                                                    const familyName = v.parent_family_name || v.family_name || v.family?.name
                                                    return {
                                                        ...v,
                                                        name: familyName ? `${familyName} - ${v.name}` : v.name,
                                                        type: 'VARIANT',
                                                        category: familyName // Use family name as category for sub-grouping
                                                    }
                                                })}
                                                value={field.value}
                                                onValueChange={field.onChange}
                                                placeholder="Search Film Variant..."
                                                testId="roll-grn-material"
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="reference"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Reference</FormLabel>
                                        <FormControl>
                                            <Input {...field} className="h-12 border-2 border-slate-100 bg-white rounded-xl focus:border-indigo-600 font-bold" />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        {/* Rolls Grid */}
                        <div className="border border-slate-200 rounded-3xl p-6 bg-slate-50/50">
                            <div className="flex justify-between items-center mb-6">
                                <h3 className="text-sm font-black uppercase tracking-widest flex items-center gap-2">
                                    <Layers className="h-4 w-4 text-emerald-500" />
                                    Roll Manifold
                                </h3>
                                <Button type="button" size="sm" onClick={() => append({ label_id: "", thickness_micron: 0, width_mm: 0, weight_kg: 0, grade_id: "" })} className="rounded-xl bg-white text-indigo-600 border border-indigo-100 shadow-sm hover:shadow-md hover:bg-indigo-50 font-black uppercase text-[10px] tracking-widest h-9">
                                    <Plus className="h-3.5 w-3.5 mr-1" /> Add Entry
                                </Button>
                            </div>
                            <div className="text-[10px] font-semibold text-slate-500 mb-3">
                                Batch numbers are auto-generated on inward. Grade is mandatory only for extrudable variants. Label ID is optional.
                            </div>

                            <div className="space-y-3">
                                {fields.map((field, index) => (
                                    <div key={field.id} className="flex flex-col md:flex-row gap-3 items-end p-3 bg-white rounded-2xl border border-slate-100 shadow-sm group hover:border-indigo-200 transition-colors">
                                        <div className="bg-slate-100 text-slate-400 font-black text-[10px] h-6 w-6 rounded-full flex items-center justify-center shrink-0 mb-3 md:mb-0">
                                            {index + 1}
                                        </div>
                                        <FormField
                                            control={form.control}
                                            name={`rolls.${index}.label_id`}
                                            render={({ field }) => (
                                                <FormItem className="flex-1 w-full">
                                                    <FormControl><Input data-testid={index === 0 ? "roll-grn-label-0" : undefined} placeholder="Label ID (optional)" {...field} className="h-10 rounded-lg border-slate-100 font-bold font-mono text-xs" /></FormControl>
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control}
                                            name={`rolls.${index}.thickness_micron`}
                                            render={({ field }) => (
                                                <FormItem className="w-full md:w-24">
                                                    <FormControl><Input data-testid={index === 0 ? "roll-grn-thickness-0" : undefined} type="number" step="0.1" placeholder="µm" {...field} className="h-10 rounded-lg border-slate-100 font-bold text-xs" /></FormControl>
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control}
                                            name={`rolls.${index}.width_mm`}
                                            render={({ field }) => (
                                                <FormItem className="w-full md:w-24">
                                                    <FormControl><Input data-testid={index === 0 ? "roll-grn-width-0" : undefined} type="number" placeholder="Width" {...field} className="h-10 rounded-lg border-slate-100 font-bold text-xs" /></FormControl>
                                                </FormItem>
                                            )}
                                        />
                                        <FormField
                                            control={form.control}
                                            name={`rolls.${index}.weight_kg`}
                                            render={({ field }) => (
                                                <FormItem className="w-full md:w-24">
                                                    <FormControl><Input data-testid={index === 0 ? "roll-grn-weight-0" : undefined} type="number" step="0.001" placeholder="Weight" {...field} className="h-10 rounded-lg border-slate-100 font-bold text-xs" /></FormControl>
                                                </FormItem>
                                            )}
                                        />
                                        {gradeRequired ? (
                                            <FormField
                                                control={form.control}
                                                name={`rolls.${index}.grade_id`}
                                                render={({ field }) => (
                                                    <FormItem className="w-full md:w-28">
                                                        <Select onValueChange={field.onChange} value={field.value || ""}>
                                                            <FormControl>
                                                                <SelectTrigger className="h-10 rounded-lg border-slate-100 font-bold text-xs">
                                                                    <SelectValue placeholder="Grade" />
                                                                </SelectTrigger>
                                                            </FormControl>
                                                            <SelectContent className="rounded-xl border-none shadow-2xl max-h-[200px]">
                                                                {(grades || []).map((g: any) => (
                                                                    <SelectItem key={g.id} value={g.id} className="font-bold text-xs">
                                                                        {g.name}
                                                                    </SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                        <FormMessage />
                                                    </FormItem>
                                                )}
                                            />
                                        ) : (
                                            <div className="w-full md:w-32 h-10 flex items-center justify-center rounded-lg border border-dashed border-slate-200 text-[10px] font-bold text-slate-400">
                                                No Grade
                                            </div>
                                        )}
                                        <Button type="button" variant="ghost" size="icon" onClick={() => remove(index)} className="h-10 w-10 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors">
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                ))}
                            </div>
                            <p className="text-[0.8rem] font-medium text-rose-500 mt-2 text-center">{form.formState.errors.rolls?.root?.message}</p>
                        </div>

                        <Button type="submit" data-testid="roll-grn-submit" disabled={mutation.isPending} className="w-full h-14 bg-emerald-600 hover:bg-slate-900 text-white rounded-2xl shadow-xl shadow-emerald-200 hover:shadow-2xl transition-all active-scale font-black uppercase tracking-[0.2em]">
                            {mutation.isPending && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
                            Submit Roll Inward <ArrowRight className="h-4 w-4 ml-2" />
                        </Button>
                    </form>
                </Form>
            </CardContent>
        </Card>
    )
}

function PackagingGRNForm() {
    const queryClient = useQueryClient()
    const { data: plants } = useQuery({ queryKey: ['plants'], queryFn: factoryService.getPlants })
    const { data: vendors = [] } = useQuery({ queryKey: ['vendors'], queryFn: inventoryService.getVendors })
    const { data: packaging = [] } = useQuery({ queryKey: ['materials', 'packaging'], queryFn: masterDataService.getPackaging })

    const form = useForm<z.infer<typeof packagingSchema>>({
        resolver: zodResolver(packagingSchema) as any,
        defaultValues: {
            plant_id: "",
            location_id: "",
            vendor_id: "",
            material_id: "",
            quantity: 0,
            cost: 0,
            reference: "",
        },
    })

    const selectedPlantId = form.watch("plant_id")
    const selectedMaterialId = form.watch("material_id")
    const selectedMaterial = (packaging || []).find((m: any) => String(m.id) === String(selectedMaterialId || ""))
    const qtyUom = String(selectedMaterial?.base_uom || "PCS").toUpperCase()

    const { data: locations } = useQuery({
        queryKey: ['locations', 'all'],
        queryFn: factoryService.getLocations
    })
    const filteredLocations = (locations || []).filter((l: any) =>
        l.is_active
        && ['WAREHOUSE', 'QC', 'RM', 'WIP', 'FG'].includes(l.type)
        && (!selectedPlantId || String(l.plant) === String(selectedPlantId))
    )

    const mutation = useMutation({
        mutationFn: inventoryService.createPackagingGRN,
        onSuccess: () => {
            toast.success("Packaging GRN Created")
            form.reset()
            queryClient.invalidateQueries({ queryKey: ['packaging-stock'] })
            queryClient.invalidateQueries({ queryKey: ['packaging-transactions'] })
        },
        onError: (error: AxiosError<{ detail: string }>) => {
            toast.error("Failed to create GRN", {
                description: error.response?.data?.detail || error.message
            })
        }
    })

    function onSubmit(data: z.infer<typeof packagingSchema>) {
        mutation.mutate(data)
    }

    return (
        <Card className="border-none shadow-premium rounded-[2.5rem] bg-white/70 backdrop-blur-md overflow-hidden max-w-4xl mx-auto">
            <CardHeader className="p-8 pb-2 border-b border-slate-50 bg-slate-50/30">
                <CardTitle className="text-xl font-black tracking-tight text-slate-900 flex items-center gap-3">
                    <Package className="h-6 w-6 text-indigo-500" />
                    Inward Packaging Material
                </CardTitle>
                <CardDescription className="text-[10px] font-bold uppercase text-slate-400 tracking-widest pl-9">
                    Pouches, gonnies, sheets, tape, film and labels
                </CardDescription>
            </CardHeader>
            <CardContent className="p-8">
                <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <FormField
                                control={form.control}
                                name="plant_id"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Plant</FormLabel>
                                        <Select onValueChange={field.onChange} value={field.value}>
                                            <FormControl>
                                                <SelectTrigger className="h-12 border-2 border-slate-100 bg-white rounded-xl focus:border-indigo-600 font-bold">
                                                    <SelectValue placeholder="Select Plant" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent className="rounded-xl border-none shadow-2xl">
                                                {(plants || []).map((p: any) => (
                                                    <SelectItem key={p.id} value={p.id} className="font-bold text-xs uppercase tracking-wide">{p.name}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="location_id"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Location</FormLabel>
                                        <Select
                                            onValueChange={(val) => {
                                                field.onChange(val)
                                                const loc = filteredLocations.find(l => l.id === val)
                                                if (loc) form.setValue('plant_id', loc.plant)
                                            }}
                                            value={field.value}
                                        >
                                            <FormControl>
                                                <SelectTrigger className="h-12 border-2 border-slate-100 bg-white rounded-xl focus:border-indigo-600 font-bold">
                                                    <SelectValue placeholder="Select Location" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent className="rounded-xl border-none shadow-2xl">
                                                {filteredLocations.map((l: any) => (
                                                    <SelectItem key={l.id} value={l.id} className="font-bold text-xs uppercase tracking-wide">
                                                        {l.name} <span className="text-slate-400 text-[10px] ml-1">({l.type})</span>
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="vendor_id"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Vendor</FormLabel>
                                        <Select onValueChange={field.onChange} value={field.value}>
                                            <FormControl>
                                                <SelectTrigger className="h-12 border-2 border-slate-100 bg-white rounded-xl focus:border-indigo-600 font-bold">
                                                    <SelectValue placeholder="Select Vendor" />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent className="rounded-xl border-none shadow-2xl">
                                                {vendors
                                                    .filter((v: any) => ["RM", "BOTH"].includes(String(v?.type || "").toUpperCase()) && String(v?.status || "").toUpperCase() === "ACTIVE")
                                                    .map((v: any) => (
                                                        <SelectItem key={v.id} value={v.id} className="font-bold text-xs uppercase tracking-wide">
                                                            {v.name}
                                                        </SelectItem>
                                                    ))}
                                            </SelectContent>
                                        </Select>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <FormField
                            control={form.control}
                            name="material_id"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Packaging Material</FormLabel>
                                    <FormControl>
                                        <MaterialPicker
                                            items={packaging || []}
                                            value={field.value}
                                            onValueChange={field.onChange}
                                            placeholder="Search Packaging SKU..."
                                        />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <FormField
                                control={form.control}
                                name="quantity"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Quantity ({qtyUom})</FormLabel>
                                        <FormControl>
                                            <Input type="number" step="0.001" {...field} className="h-12 border-2 border-slate-100 bg-white rounded-xl focus:border-indigo-600 font-bold text-lg" />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="cost"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Cost per {qtyUom} (₹)</FormLabel>
                                        <FormControl>
                                            <Input type="number" step="0.01" {...field} className="h-12 border-2 border-slate-100 bg-white rounded-xl focus:border-indigo-600 font-bold text-lg" />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                            <FormField
                                control={form.control}
                                name="reference"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel className="text-[10px] font-black uppercase text-slate-500 tracking-widest">Reference</FormLabel>
                                        <FormControl>
                                            <Input {...field} className="h-12 border-2 border-slate-100 bg-white rounded-xl focus:border-indigo-600 font-bold" />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        </div>

                        <Button type="submit" disabled={mutation.isPending} className="w-full h-14 bg-indigo-600 hover:bg-slate-900 text-white rounded-2xl shadow-xl shadow-indigo-200 hover:shadow-2xl transition-all active-scale font-black uppercase tracking-[0.2em] mt-4">
                            {mutation.isPending && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
                            Execute Packaging Inward
                        </Button>
                    </form>
                </Form>
            </CardContent>
        </Card>
    )
}

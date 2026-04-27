"use client"

import Link from "next/link"
import { useState, useEffect, useMemo, useRef } from "react"
import { useRouter } from "next/navigation"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm, useFieldArray, UseFormReturn } from "react-hook-form"
import * as z from "zod"
import { useQuery, useMutation } from "@tanstack/react-query"
import {
    Plus,
    Trash2,
    GripVertical,
    AlertCircle,
    CheckCircle2,
    Loader2,
    ArrowRight,
    TrendingUp,
    Package,
    Upload,
    Search,
    Settings
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
    Form,
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card"
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Label } from "@/components/ui/label"

// Schema Definitions
const adjustmentSchema = z.object({
    name: z.string().min(1, "Name required"),
    value: z.number().min(0),
    impact: z.enum(["WIDTH", "HEIGHT", "BOTH"])
})

const layerSchema = z.object({
    family_id: z.string().min(1, "Family required"),
    variant_id: z.any().optional(),
    thickness_micron: z.number().min(1, "Thickness required"),
    grade_id: z.any().optional(),
    roll_width_mm: z.number().optional()
})

const salesOrderSchema = z.object({
    mode: z.enum(["TEMPLATE", "REPEAT"]),
    order_name: z.string().optional(),
    line_name: z.string().optional(),
    customer_id: z.string().min(1, "Customer required"),
    customer_name: z.string().optional(), // Auto-filled from master
    template_id: z.string().optional(),
    delivery_date: z.string().min(1, "Delivery date required"),
    qty_value: z.number().min(1, "Quantity required"),
    qty_uom: z.enum(["PCS", "KG"]),
    price_basis: z.enum(["KG", "PCS"]),
    unit_price: z.number().min(0.01, "Unit price must be greater than 0"),

    fg_type: z.enum(["POUCH", "ROLL"]),
    roll_form: z.enum(["FLAT", "FOLDED", "TUBING"]).optional(),
    geometry: z.object({
        base: z.object({
            width_mm: z.number().min(0),
            height_mm: z.number().nullable().optional()
        }),
        adjustments: z.array(adjustmentSchema),
        multipliers: z.object({
            faces: z.number().min(1).default(1),
        })
    }),

    film_layers: z.array(layerSchema).min(1, "At least one layer required"),

    printing: z.object({
        enabled: z.boolean(),
        type: z.enum(["FLEXO", "ROTO", "DIGITAL"]).optional(),
        substrate_mode: z.enum(["SHEET", "TUBING"]).optional(),
        front_colors_count: z.number().min(0).optional(),
        back_colors_count: z.number().min(0).optional(),
        ink_gsm_total: z.number().optional(),
        artwork_id: z.string().optional(),
        defer_artwork_to_planner: z.boolean().optional(),
    }),

    chemicals: z.object({
        adhesive_gsm: z.number().optional(),
        solvent_gsm: z.number().optional()
    }).optional(),

    addons: z.array(z.object({
        addon_id: z.string(),
        // Master-driven addon modes:
        // - PER_MM -> WIDTH/HEIGHT selector
        // - PER_PIECE/FIXED -> locked behavior
        applies_to: z.enum(["WIDTH", "HEIGHT", "NONE", "PER_PIECE", "FIXED"]).optional(),
        qty: z.number().optional()
    }))
})

type SalesOrderFormValues = z.infer<typeof salesOrderSchema>
type PackagingLine = {
    material_id: string
    qty: number
    uom: "PCS" | "KG" | "METER"
    basis: "PER_GONNY" | "PER_ROLL"
}

/**
 * GradeSelector Component
 * Fetches grades dynamically for a selected variant.
 */
import { recipeService } from "@/services/recipes"
import { salesService } from "@/services/sales"
import { filmVariantService } from "@/services/film-variants"
import { masterDataService } from "@/services/master-data"
import { templateService } from "@/services/templates"
import { engineeringService } from "@/services/engineering"

import { filmFamilyService } from "@/services/film-families"

function GradeSelector({ variantId, value, onChange, disabled }: { variantId: string, value?: string, onChange: (val: string) => void, disabled?: boolean }) {
    const { data: grades, isLoading } = useQuery({
        queryKey: ["variant-grades", variantId],
        queryFn: () => recipeService.getGrades(variantId),
        enabled: !!variantId
    })

    if (!variantId) return <div className="text-[10px] text-muted-foreground italic">Select Material First</div>

    if (isLoading) return <Loader2 className="h-4 w-4 animate-spin" />

    return (
        <Select onValueChange={onChange} value={value} disabled={disabled}>
            <SelectTrigger className="h-8 text-[10px] bg-white"><SelectValue placeholder="Grade" /></SelectTrigger>
            <SelectContent>
                {grades?.map((g: any) => (
                    <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>
                ))}
            </SelectContent>
        </Select>
    )
}

function TemplateSelectionDialog({ onSelect, templates, currentId }: { onSelect: (id: string) => void, templates: any[], currentId?: string }) {
    const [open, setOpen] = useState(false)
    const [search, setSearch] = useState("")

    const filtered = templates?.filter(t =>
        t.name.toLowerCase().includes(search.toLowerCase()) ||
        t.fg_type.toLowerCase().includes(search.toLowerCase())
    ) || []

    const selectedTemplate = templates?.find(t => t.id === currentId)

    return (
        <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
                <Button variant="outline" className="w-full h-12 flex flex-col items-start gap-0.5 justify-center border-dashed border-2 hover:border-primary hover:bg-primary/5 transition-all">
                    {selectedTemplate ? (
                        <>
                            <span className="text-[10px] font-black uppercase text-primary">Selected Template</span>
                            <span className="text-sm font-bold truncate max-w-full">{selectedTemplate.name}</span>
                        </>
                    ) : (
                        <>
                            <span className="text-[10px] font-black uppercase text-slate-400">Step 1 — Choose Product</span>
                            <span className="text-sm font-bold text-slate-600">Select Template...</span>
                        </>
                    )}
                </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col p-0 overflow-hidden">
                <DialogHeader className="p-6 border-b">
                    <DialogTitle className="text-lg font-black uppercase">Search LIVE Route Templates</DialogTitle>
                    <div className="relative mt-4">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                        <Input
                            placeholder="Type to search templates..."
                            className="pl-10 h-10"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            autoFocus
                        />
                    </div>
                </DialogHeader>
                <ScrollArea className="flex-1 p-6">
                    <div className="grid grid-cols-1 gap-3">
                        {filtered.map((t: any) => (
                            <button
                                key={t.id}
                                type="button"
                                onClick={() => {
                                    onSelect(t.id)
                                    setOpen(false)
                                }}
                                className={`flex items-center justify-between p-4 rounded-xl border-2 text-left transition-all ${currentId === t.id
                                    ? "border-primary bg-primary/5 shadow-sm"
                                    : "border-slate-100 hover:border-slate-300 hover:bg-slate-50"
                                    }`}
                            >
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-bold text-slate-900">{t.name}</span>
                                        <Badge variant="secondary" className="text-[9px] h-4 uppercase">{t.fg_type}</Badge>
                                    </div>
                                    <div className="flex gap-3 text-[10px] text-slate-500 font-medium">
                                        <span>ID: {t.id.slice(0, 8)}</span>
                                    </div>
                                </div>
                                <ArrowRight className={`h-4 w-4 ${currentId === t.id ? 'text-primary' : 'text-slate-300'}`} />
                            </button>
                        ))}
                        {filtered.length === 0 && (
                            <div className="py-12 text-center">
                                <Package className="h-10 w-10 text-slate-200 mx-auto mb-3" />
                                <p className="text-sm font-medium text-slate-400 italic">No live templates found matching &quot;{search}&quot;</p>
                            </div>
                        )}
                    </div>
                </ScrollArea>
                <div className="p-4 border-t bg-slate-50 flex justify-between items-center">
                    <p className="text-[10px] text-slate-500 italic">Template only provides route + step consumption categories in V2.</p>
                    <Button variant="ghost" size="sm" onClick={() => setOpen(false)} className="text-[10px] font-bold uppercase">Cancel</Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}

export default function SalesOrderForm() {
    const router = useRouter()
    const [activePreview, setActivePreview] = useState<any>(null)
    const [selectedRepeatOrderId, setSelectedRepeatOrderId] = useState<string>("")
    const [primaryPackEnabled, setPrimaryPackEnabled] = useState(false)
    const [primaryPackMaterialId, setPrimaryPackMaterialId] = useState("")
    const [primaryPcsPerPack, setPrimaryPcsPerPack] = useState(100)
    const [podEnabled, setPodEnabled] = useState(false)
    const [podProfileId, setPodProfileId] = useState("")
    const [rollDispatchPackEnabled, setRollDispatchPackEnabled] = useState(false)
    const [rollDispatchLines, setRollDispatchLines] = useState<PackagingLine[]>([])
    const previewRequestSeq = useRef(0)

    const form = useForm<SalesOrderFormValues>({
        resolver: zodResolver(salesOrderSchema) as any,
        defaultValues: {
            mode: "TEMPLATE",
            order_name: "",
            line_name: "",
            customer_id: "",
            customer_name: "",
            delivery_date: new Date().toISOString().split('T')[0],
            qty_uom: "PCS",
            qty_value: 1000,
            price_basis: "PCS",
            unit_price: 0,
            fg_type: "POUCH",
            roll_form: "FLAT",
            geometry: {
                base: { width_mm: 0, height_mm: 0 },
                adjustments: [],
                multipliers: { faces: 1 }
            },
            film_layers: [
                { family_id: "", variant_id: "", thickness_micron: 0, roll_width_mm: 0 }
            ],
            printing: {
                enabled: false,
                type: "FLEXO",
                substrate_mode: "SHEET",
                front_colors_count: 0,
                back_colors_count: 0,
                ink_gsm_total: 0,
                artwork_id: "",
                defer_artwork_to_planner: false,
            },
            chemicals: {
                adhesive_gsm: 0,
                solvent_gsm: 0
            },
            addons: []
        }
    })

    const { fields: layerFields, append: appendLayer, remove: removeLayer } = useFieldArray({
        control: form.control,
        name: "film_layers"
    })

    const { fields: adjFields, append: appendAdj, remove: removeAdj } = useFieldArray({
        control: form.control,
        name: "geometry.adjustments"
    })
    const { append: appendAddon, remove: removeAddon } = useFieldArray({
        control: form.control,
        name: "addons"
    })

    const mode = form.watch("mode")
    const selectedTemplateId = form.watch("template_id")
    const fgType = form.watch("fg_type")
    const addonsWatched = form.watch("addons") || []
    const printingEnabled = !!form.watch("printing.enabled")
    const printingType = String(form.watch("printing.type") || "FLEXO").toUpperCase()
    const frontCount = Number(form.watch("printing.front_colors_count") || 0)
    const backCount = Number(form.watch("printing.back_colors_count") || 0)
    const deferArtworkToPlanner = !!form.watch("printing.defer_artwork_to_planner")
    const adhesiveGsm = Number(form.watch("chemicals.adhesive_gsm") || 0)
    const layerCount = (form.watch("film_layers") || []).length

    useEffect(() => {
        if (fgType === "ROLL") {
            if (form.getValues("qty_uom") !== "KG") {
                form.setValue("qty_uom", "KG")
            }
            if (form.getValues("price_basis") !== "KG") {
                form.setValue("price_basis", "KG")
            }
            if (Number(form.getValues("geometry.base.height_mm") || 0) !== 0) {
                form.setValue("geometry.base.height_mm", 0)
            }
        }
    }, [fgType, form])

    // Queries
    const { data: templates } = useQuery({
        queryKey: ["templates", "live-only"],
        queryFn: () => templateService.getTemplates({ status: "LIVE" })
    })
    const selectedTemplate = (templates || []).find((t: any) => String(t.id) === String(selectedTemplateId || "")) || null

    const { data: families } = useQuery({
        queryKey: ["film-families"],
        queryFn: () => filmFamilyService.getAll()
    })

    const { data: variants } = useQuery({
        queryKey: ["film-variants"],
        queryFn: () => filmVariantService.getAll()
    })

    const { data: addonsMaster } = useQuery({
        queryKey: ["addons"],
        queryFn: () => masterDataService.getAddons()
    })
    const { data: packagingMaterials } = useQuery({
        queryKey: ["packaging-materials"],
        queryFn: () => masterDataService.getPackaging()
    })
    const { data: podProfiles } = useQuery({
        queryKey: ["pod-profiles"],
        queryFn: () => masterDataService.getPODMaterials()
    })
    const { data: artworks } = useQuery({
        queryKey: ["engineering-artworks", printingType, frontCount, backCount, printingEnabled, deferArtworkToPlanner],
        queryFn: () => engineeringService.getArtworks({
            status: "APPROVED",
            print_type: printingType,
            front_colors_count: frontCount,
            back_colors_count: backCount,
            cylinder_ready: printingType === "ROTO" ? "true" : undefined,
            exclude_cylinder_artwork: printingType === "FLEXO" ? "true" : undefined,
        }),
        enabled: printingEnabled && !deferArtworkToPlanner,
    })

    useEffect(() => {
        if (mode !== "TEMPLATE") return
        const templateFgType = String(selectedTemplate?.fg_type || "").toUpperCase()
        if (!["POUCH", "ROLL"].includes(templateFgType)) return
        if (templateFgType !== String(form.getValues("fg_type") || "").toUpperCase()) {
            form.setValue("fg_type", templateFgType as "POUCH" | "ROLL", { shouldDirty: true })
        }
    }, [mode, selectedTemplateId, selectedTemplate, form])

    const { data: recentOrders } = useQuery({
        queryKey: ["recent-orders"],
        queryFn: () => salesService.getRecentOrders(),
        enabled: mode === "REPEAT"
    })
    const selectedRepeatOrder = recentOrders?.find((order: any) => order.id === selectedRepeatOrderId)
    const repeatReview = useMemo(() => {
        if (mode !== "REPEAT" || !selectedRepeatOrder?.items?.length) return null
        const item = selectedRepeatOrder.items[0] || {}
        const geometry = item.geometry_snapshot || {}
        const printing = item.printing_snapshot || {}
        const packaging = item.packaging_snapshot || {}
        const inherited = [
            selectedRepeatOrder.customer_name ? `Customer: ${selectedRepeatOrder.customer_name}` : null,
            item.template_name || item.template ? `Template: ${item.template_name || item.template}` : null,
            geometry?.finished_good_type ? `Finished good: ${String(geometry.finished_good_type).toUpperCase() === "ROLL" ? "ROLL" : "POUCH"}` : null,
            Array.isArray(item.layer_snapshot) && item.layer_snapshot.length ? `Film stack: ${item.layer_snapshot.length} layer(s)` : null,
            printing?.enabled ? `Printing: ${String(printing.type || "Enabled").toUpperCase()}` : "Printing: not enabled",
            packaging?.primary_inner_pack?.enabled || packaging?.roll_dispatch_pack?.enabled ? "Packaging profile copied from previous order" : null,
        ].filter(Boolean) as string[]

        const reviewFlags: string[] = []
        if (printing?.enabled && !String(printing?.artwork_id || "").trim()) {
            reviewFlags.push("Previous order did not carry linked artwork. Planner gating will be required again before release.")
        }
        if (String(printing?.type || "").toUpperCase() === "ROTO") {
            reviewFlags.push("ROTO repeats still require approved artwork and finalized cylinders at release time.")
        }
        if (!item.template) {
            reviewFlags.push("Template link is missing on the source order. Review route and product details before placing.")
        }
        if (!Array.isArray(item.layer_snapshot) || item.layer_snapshot.length === 0) {
            reviewFlags.push("Film stack is incomplete on the source order. Rebuild the product structure before placing.")
        }
        return { inherited, reviewFlags }
    }, [mode, selectedRepeatOrder])

    const { data: customers } = useQuery({
        queryKey: ["customers"],
        queryFn: () => masterDataService.getCustomers()
    })

    // ---------------------------------------------------------------------------
    // 🔒 CANONICAL PAYLOAD BUILDER (Mandatory for Physics Correctness)
    // ---------------------------------------------------------------------------
    const buildCanonicalPayload = (formValues: SalesOrderFormValues) => {
        const normalizedAdjustments = formValues.geometry.adjustments?.map(a => ({
            ...a,
            value: parseFloat(a.value.toString())
        })) || []
        const pouchHeightMm = parseFloat((formValues.geometry.base.height_mm ?? 0)?.toString() || "0")
        const primaryRollWidthMm = parseFloat((formValues.film_layers?.[0]?.roll_width_mm ?? 0)?.toString() || "0")
        const canonicalQtyUom = formValues.fg_type === "ROLL" ? "KG" : formValues.qty_uom
        const canonicalPriceBasis = formValues.fg_type === "ROLL" ? "KG" : formValues.price_basis

        const geometryOverride = {
            width_mm: formValues.fg_type === "POUCH" ? parseFloat(formValues.geometry.base.width_mm?.toString() || "0") : 0,
            height_mm: formValues.fg_type === "POUCH" ? pouchHeightMm : 0,
            adjustments: normalizedAdjustments
        }
        const packagingSnapshot = {
            primary_inner_pack: {
                enabled: formValues.fg_type === "POUCH" ? Boolean(primaryPackEnabled) : false,
                material_id: formValues.fg_type === "POUCH" && primaryPackEnabled ? (primaryPackMaterialId || null) : null,
                pcs_per_pack: formValues.fg_type === "POUCH" ? Number(primaryPcsPerPack || 0) : 0,
            },
            pod: {
                enabled: formValues.fg_type === "POUCH" ? Boolean(podEnabled) : false,
                pod_profile_id: formValues.fg_type === "POUCH" && podEnabled ? (podProfileId || null) : null,
            },
            roll_dispatch_pack: {
                enabled: formValues.fg_type === "ROLL" ? Boolean(rollDispatchPackEnabled) : false,
                lines: formValues.fg_type === "ROLL"
                    ? (rollDispatchLines || [])
                        .filter((line) => line.material_id)
                        .map((line) => ({
                            material_id: line.material_id,
                            qty: Number(line.qty || 0),
                            uom: line.uom || "PCS",
                            basis: "PER_ROLL",
                        }))
                    : [],
            },
        }

        return {
            ...formValues,
            order_name: formValues.order_name || "",
            line_name: formValues.line_name || "",
            customer: formValues.customer_id, // Map ID to payload field expected by backend
            order_qty: parseFloat(formValues.qty_value?.toString() || "0"),
            uom: canonicalQtyUom,
            price_basis: canonicalPriceBasis,
            unit_price: parseFloat(formValues.unit_price?.toString() || "0"),
            roll_form: formValues.fg_type === "ROLL" ? (formValues.roll_form || "FLAT") : null,
            finished_good_type: formValues.fg_type,

            // LAYER RESOLUTION ENGINE
            film_layers: formValues.film_layers.map((l) => {
                // Density is always resolved from selected master data (variant/family).
                const family = families?.find((f: any) => String(f.id) === String(l.family_id))
                const variant = variants?.find((v: any) => v.id === l.variant_id)
                const density = variant?.density_gcm3 ?? family?.density_gcm3 ?? 0
                const gradeId = variant?.is_extrudable ? (l.grade_id ? String(l.grade_id) : null) : null

                return {
                    family_id: l.family_id,
                    variant_id: l.variant_id || null,
                    thickness_micron: parseFloat(l.thickness_micron?.toString() || "0"),
                    density_g_cm3: parseFloat(density.toString()),
                    roll_width_mm: parseFloat((l as any).roll_width_mm?.toString() || "0"),
                    grade_id: gradeId
                }
            }),

            // PRINTING ENGINE
            printing: formValues.printing?.enabled ? {
                enabled: true,
                type: formValues.printing.type,
                substrate_mode: formValues.printing.substrate_mode,
                front_colors_count: parseInt(formValues.printing.front_colors_count?.toString() || "0"),
                back_colors_count: parseInt(formValues.printing.back_colors_count?.toString() || "0"),
                ink_gsm_total: parseFloat(formValues.printing.ink_gsm_total?.toString() || "0"),
                artwork_id: formValues.printing.defer_artwork_to_planner ? null : (formValues.printing.artwork_id || null),
                chemicals: (formValues.film_layers.length > 1 && formValues.chemicals) ? {
                    adhesive_gsm: parseFloat(formValues.chemicals.adhesive_gsm?.toString() || "0"),
                    solvent_gsm: parseFloat(formValues.chemicals.solvent_gsm?.toString() || "0")
                } : undefined,
            } : { enabled: false },

            // CHEMISTRY ENGINE
            // Constraint: Chemicals forbidden for single-layer structures (Mono-layer)
            chemicals: (formValues.film_layers.length > 1 && formValues.chemicals) ? {
                adhesive_gsm: parseFloat(formValues.chemicals.adhesive_gsm?.toString() || "0"),
                solvent_gsm: parseFloat(formValues.chemicals.solvent_gsm?.toString() || "0")
            } : undefined,

            // GEOMETRY ENGINE
            geometry: {
                ...formValues.geometry,
                finished_good_type: formValues.fg_type,
                roll_form: formValues.fg_type === "ROLL" ? (formValues.roll_form || "FLAT") : undefined,
                base: {
                    ...(formValues.geometry.base || {}),
                    width_mm: formValues.fg_type === "ROLL"
                        ? primaryRollWidthMm
                        : parseFloat(formValues.geometry.base.width_mm?.toString() || "0"),
                    height_mm: formValues.fg_type === "POUCH" ? pouchHeightMm : 0,
                },
                adjustments: normalizedAdjustments
            },
            geometry_override: geometryOverride,

            // ADDONS ENGINE
            addons: formValues.addons?.filter(a => a.addon_id && a.addon_id.length > 0).map(a => {
                const master = addonsMaster?.find((m: any) => String(m.id) === String(a.addon_id))
                const masterMode = String(master?.weight_mode || "PER_PIECE").toUpperCase()
                const userChoice = String(a.applies_to || "").toUpperCase()

                let finalWeightMode = "PER_PIECE"
                if (masterMode === "PER_MM") finalWeightMode = "PER_MM"
                else if (masterMode === "FIXED") finalWeightMode = "FIXED"

                const finalAppliesTo =
                    finalWeightMode === "PER_MM"
                        ? (["WIDTH", "HEIGHT"].includes(userChoice) ? userChoice : "WIDTH")
                        : "NONE"

                return {
                    addon_id: a.addon_id,
                    applies_to: finalAppliesTo,
                    qty: Number(a.qty || 0),
                    weight_mode: finalWeightMode,
                    weight_value: Number(master?.weight_value || 0)
                }
            }) || [],
            packaging_snapshot: packagingSnapshot,
        }
    }

    // 🔒 STRICT VALIDATION GUARD
    const validatePayloadIntegrity = (payload: any): string | null => {
        if (payload.fg_type === "ROLL" && !payload.roll_form) {
            return "Roll form is required for ROLL model."
        }
        if (payload.fg_type === "POUCH" && Number(payload?.geometry?.base?.width_mm || 0) <= 0) {
            return "Width (mm) must be greater than 0."
        }
        if (payload.fg_type === "POUCH" && Number(payload?.geometry?.base?.height_mm || 0) <= 0) {
            return "Height (mm) is required for pouch products."
        }
        // 1. Film Layer Integrity
        for (const [i, layer] of payload.film_layers.entries()) {
            if (!layer.family_id) return `Layer ${i + 1}: Film Family is required.`
            if (layer.thickness_micron <= 0) return `Layer ${i + 1}: Thickness must be greater than 0.`
            if (layer.density_g_cm3 <= 0) return `Layer ${i + 1}: Invalid Density. Check Material Master.`
            if (payload.fg_type === "ROLL" && Number(layer.roll_width_mm || 0) <= 0) {
                return `Layer ${i + 1}: Roll width (mm) is required for roll compatibility.`
            }

            // Grade Check
            const variant = variants?.find((v: any) => v.id === layer.variant_id)
            if (variant?.is_extrudable && !layer.grade_id) {
                return `Layer ${i + 1}: Grade selection is mandatory for ${variant.name}.`
            }
        }
        if (payload.printing?.enabled) {
            if (!payload.printing?.type) return "Printing type is required."
            if (!payload.printing?.substrate_mode) return "Select SHEET or TUBING for printing."
            const frontCount = Number(payload.printing?.front_colors_count || 0)
            const backCount = Number(payload.printing?.back_colors_count || 0)
            if ((frontCount + backCount) <= 0) return "Printing needs at least one side color."
            if (Number(payload.printing?.ink_gsm_total || 0) <= 0) return "Total ink GSM is required when printing is enabled."
            if (!payload.printing?.artwork_id && !form.getValues("printing.defer_artwork_to_planner")) {
                return "Select approved artwork or enable 'Defer Artwork To Planner'."
            }
        }
        if (payload.fg_type === "POUCH") {
            if (payload.packaging_snapshot?.primary_inner_pack?.enabled) {
                if (!payload.packaging_snapshot?.primary_inner_pack?.material_id) {
                    return "Primary inner pack material is required."
                }
                if (Number(payload.packaging_snapshot?.primary_inner_pack?.pcs_per_pack || 0) <= 0) {
                    return "PCS per pack must be greater than 0."
                }
            }
            if (payload.packaging_snapshot?.pod?.enabled && !payload.packaging_snapshot?.pod?.pod_profile_id) {
                return "POD profile is required when POD is enabled."
            }
        }
        if (payload.fg_type === "ROLL" && payload.packaging_snapshot?.roll_dispatch_pack?.enabled) {
            const lines = payload.packaging_snapshot?.roll_dispatch_pack?.lines || []
            if (!lines.length) return "Add at least one roll dispatch packaging line."
            for (const [idx, line] of lines.entries()) {
                if (!line.material_id) {
                    return `Roll packaging line ${idx + 1} is incomplete.`
                }
            }
        }
        for (const [idx, addon] of (payload.addons || []).entries()) {
            if (!addon?.addon_id) continue
            const mode = String(addon.weight_mode || "FIXED").toUpperCase()
            if (mode === "PER_MM" && !["WIDTH", "HEIGHT"].includes(String(addon.applies_to || "").toUpperCase())) {
                return `Addon ${idx + 1}: choose WIDTH or HEIGHT for PER_MM rule.`
            }
        }
        return null // Valid
    }

    // Repeat mode sync
    useEffect(() => {
        if (mode === "REPEAT" && selectedRepeatOrderId && recentOrders) {
            const order = recentOrders.find((o: any) => o.id === selectedRepeatOrderId)
            if (order && order.items?.length > 0) {
                const item = order.items[0]
                const itemGeometry = item.geometry_snapshot || {}
                const repeatedFgType = String(itemGeometry?.finished_good_type || "POUCH").toUpperCase() === "ROLL" ? "ROLL" : "POUCH"
                const repeatedFaces = Math.max(
                    1,
                    Number(itemGeometry?.multipliers?.faces || itemGeometry?.faces || 1)
                )
                form.setValue("customer_name", order.customer_name)
                form.setValue("template_id", item.template)
                form.setValue("fg_type", repeatedFgType)
                form.setValue("roll_form", item.geometry_snapshot?.roll_form || "FLAT")
                form.setValue("geometry", {
                    base: {
                        width_mm: Number(itemGeometry?.base?.width_mm || itemGeometry?.width_mm || 0),
                        height_mm: repeatedFgType === "ROLL"
                            ? 0
                            : Number(itemGeometry?.base?.height_mm || itemGeometry?.height_mm || 0),
                    },
                    adjustments: Array.isArray(itemGeometry?.adjustments) ? itemGeometry.adjustments : [],
                    multipliers: { faces: repeatedFaces },
                } as any)
                form.setValue("film_layers", item.layer_snapshot || [])
                const repeatPrinting = item.printing_snapshot || { enabled: false }
                form.setValue("printing", {
                    ...repeatPrinting,
                    defer_artwork_to_planner: Boolean(repeatPrinting?.enabled && !String(repeatPrinting?.artwork_id || "").trim()),
                })
                form.setValue("chemicals", item.chemicals_snapshot || { adhesive_gsm: 0, solvent_gsm: 0 })
                const packagingSnapshot = item.packaging_snapshot || {}
                const primary = packagingSnapshot?.primary_inner_pack || {}
                const rollPack = packagingSnapshot?.roll_dispatch_pack || {}
                const pod = packagingSnapshot?.pod || {}

                setPrimaryPackEnabled(Boolean(primary?.enabled))
                setPrimaryPackMaterialId(String(primary?.material_id || ""))
                setPrimaryPcsPerPack(Number(primary?.pcs_per_pack || 100))
                setPodEnabled(Boolean(pod?.enabled))
                setPodProfileId(String(pod?.pod_profile_id || ""))
                setRollDispatchPackEnabled(Boolean(rollPack?.enabled))
                setRollDispatchLines(
                    Array.isArray(rollPack?.lines)
                        ? rollPack.lines
                            .filter((line: any) => line?.material_id)
                            .map((line: any) => ({
                                material_id: String(line.material_id),
                                qty: Number(line.qty || 0),
                                uom: (String(line.uom || "PCS").toUpperCase() as "PCS" | "KG" | "METER"),
                                basis: "PER_ROLL" as const,
                            }))
                        : []
                )

                // Map addons snapshot applies_to into the single dropdown state representation
                form.setValue("addons", (item.addons_snapshot || []).map((a: any) => ({
                    ...a,
                    applies_to: ["WIDTH", "HEIGHT"].includes(String(a.applies_to || "").toUpperCase())
                        ? String(a.applies_to).toUpperCase()
                        : (String(a.weight_mode || "PER_PIECE").toUpperCase() === "FIXED"
                            ? "FIXED"
                            : "PER_PIECE")
                })))
            }
        }
    }, [selectedRepeatOrderId, mode, recentOrders, form])

    // Preview Logic
    const previewMutation = useMutation({
        mutationFn: async (values: SalesOrderFormValues) => {
            const requestId = ++previewRequestSeq.current
            // 1. Build Canonical Payload
            const payload = buildCanonicalPayload(values)

            // 2. We no longer strictly reject preview requests on incomplete stack data.
            // The backend Physics Engine will compute Geometry Snapshot successfully 
            // and return 0 for weight if the stack is incomplete.
            try {
                const data = await salesService.previewItem(payload as any)
                return { data, requestId }
            } catch (error: any) {
                throw { cause: error, requestId }
            }
        },
        onSuccess: (result: any) => {
            if (result?.requestId !== previewRequestSeq.current) return
            setActivePreview(result?.data || null)
        },
        onError: (err: any) => {
            if (err?.requestId && err.requestId !== previewRequestSeq.current) return
            const source = err?.cause || err
            setActivePreview(null)
            console.error("Preview Failed:", source)
            if (source?.response?.data?.detail) {
                console.warn("Backend Validation Error:", source.response.data.detail)
            }
        }
    })

    const watchedValues = form.watch()
    useEffect(() => {
        const timeout = setTimeout(() => {
            if (mode === "TEMPLATE" || (mode === "REPEAT" && selectedRepeatOrderId)) {
                // Live BOM preview needs variant/family masters to resolve densities and grade rules.
                // Without these, the strict validator will reject and preview will appear "blank".
                if (!variants || !families) return
                const previewableLayers = (watchedValues?.film_layers || []).filter((layer: any) => {
                    const hasFamily = Boolean(String(layer?.family_id || "").trim())
                    const hasThickness = Number(layer?.thickness_micron || 0) > 0
                    if (!hasFamily || !hasThickness) return false
                    if (String(watchedValues?.fg_type || "POUCH").toUpperCase() === "ROLL") {
                        return Number(layer?.roll_width_mm || 0) > 0
                    }
                    return Number(watchedValues?.geometry?.base?.width_mm || 0) > 0 && Number(watchedValues?.geometry?.base?.height_mm || 0) > 0
                })
                if (!previewableLayers.length) {
                    setActivePreview(null)
                    return
                }
                // Pass raw values; mutation will build canonical payload
                previewMutation.mutate(watchedValues)
            }
        }, 800)
        return () => clearTimeout(timeout)
    }, [JSON.stringify(watchedValues), mode, selectedTemplateId, selectedRepeatOrderId, variants?.length, families?.length])

    const onSubmit = async (values: SalesOrderFormValues) => {
        console.log("Submitting Sales Order...", values);
        try {
            if (mode === "TEMPLATE" && !values.template_id) {
                alert("Template is mandatory. Please select a route template before placing the order.")
                return
            }
            if (mode === "REPEAT" && !selectedRepeatOrderId) {
                alert("Please select a repeat order first.")
                return
            }

            const payload = buildCanonicalPayload(values)
            const validationError = validatePayloadIntegrity(payload)

            if (validationError) {
                alert(validationError)
                return
            }

            const finalPayload = { ...payload, preview_snapshot: activePreview }
            const order = await salesService.createOrder(finalPayload)
            // Auto-confirm to move to PLANNING_REQUIRED so it appears on planner board
            try {
                await salesService.confirmOrder(order.id)
            } catch (confirmErr: any) {
                console.warn("Auto-confirm failed (order still created as DRAFT):", confirmErr?.response?.data?.detail || confirmErr.message)
            }
            router.push("/sales/orders")
        } catch (error: any) {
            console.error(error)
            alert("Failed to place order: " + (error.response?.data?.detail || error.message))
        }
    }

    const onInvalid = (errors: any) => {
        console.error("Form Validation Failed:", errors);
        const flattenErrors = (obj: any, prefix = ""): string[] => {
            if (!obj || typeof obj !== "object") return []
            const lines: string[] = []
            for (const [key, value] of Object.entries(obj)) {
                const path = prefix ? `${prefix}.${key}` : key
                if (value && typeof value === "object" && "message" in (value as any)) {
                    lines.push(`${path}: ${String((value as any).message)}`)
                } else if (value && typeof value === "object") {
                    lines.push(...flattenErrors(value, path))
                }
            }
            return lines
        }
        const details = flattenErrors(errors)
        alert(`Please fix form errors:\n${details.slice(0, 6).join("\n") || "Check all tabs for invalid fields."}`)
    }

    // Debug: watch errors
    useEffect(() => {
        if (Object.keys(form.formState.errors).length > 0) {
            console.warn("Current Form Errors:", form.formState.errors);
        }
    }, [form.formState.errors]);

    const previewUnitWeight = Number(activePreview?.unit_weight_g || 0)
    const previewTotalWeightKg = Number(activePreview?.total_weight_kg || 0)
    const previewRoll = activePreview?.roll_preview || activePreview?.physics?.roll_preview || null
    const previewEquivalentPcs = previewUnitWeight > 0
        ? Math.round((previewTotalWeightKg * 1000) / previewUnitWeight)
        : null
    const previewMathError = fgType === "ROLL" && activePreview && !previewRoll?.derived_area_m2
        ? "Roll math incomplete: width, thickness, or density is missing."
        : null

    return (
        <div className="flex flex-col gap-6 p-6 max-w-[1700px] mx-auto min-h-screen bg-slate-50/30">
            <div className="flex items-center justify-between border-b pb-4">
                <div>
                    <h1 className="text-2xl font-black tracking-tight text-slate-900 uppercase">Sales Order Terminal</h1>
                    <div className="flex items-center gap-2 mt-1">
                        <Badge variant="outline" className="bg-white text-[10px] font-bold">MODE: {mode}</Badge>
                        <p className="text-xs text-muted-foreground italic">Sales snapshots are authoritative for V2 execution.</p>
                    </div>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" size="sm" type="button" onClick={() => router.push("/sales/orders")}>Exit</Button>
                    <Button
                        size="sm"
                        type="button"
                        onClick={form.handleSubmit(onSubmit, onInvalid)}
                        disabled={previewMutation.isPending}
                    >
                        Place Sales Order
                    </Button>
                </div>
            </div>

            <Form {...form}>
                <form className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">

                    {/* BLOCK A: ORDER INTENT (Top/Left) */}
                    <div className="lg:col-span-3 space-y-6">
                        <Card className="shadow-sm border-slate-200">
                            <CardHeader className="pb-3">
                                <CardTitle className="text-xs font-black uppercase text-slate-500 tracking-wider">Block A — Order Intent</CardTitle>
                                <CardDescription className="text-[11px]">Always editable commercial basis.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                <FormField
                                    control={form.control}
                                    name="customer_id"
                                    render={({ field }) => (
                                        <FormItem>
                                            <Label className="text-[11px] font-bold">Customer</Label>
                                            <Select onValueChange={(val) => {
                                                field.onChange(val)
                                                // Auto-populate name for legacy compatibility
                                                const c = customers?.find((x: any) => x.id === val)
                                                if (c) form.setValue("customer_name", c.name)
                                            }} value={field.value}>
                                                <FormControl>
                                                    <SelectTrigger className="h-9 text-sm">
                                                        <SelectValue placeholder="Select Client" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    {customers?.map((c: any) => (
                                                        <SelectItem key={c.id} value={c.id}>
                                                            <div className="flex flex-col text-left">
                                                                <span className="font-bold">{c.name}</span>
                                                                <span className="text-[10px] text-muted-foreground">{c.code}</span>
                                                            </div>
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
                                    name="mode"
                                    render={({ field }) => (
                                        <FormItem>
                                            <Label className="text-[11px] font-bold">Order Type</Label>
                                            <Select onValueChange={field.onChange} value={field.value}>
                                                <FormControl>
                                                    <SelectTrigger className="h-9 text-sm" data-testid="sales-order-mode"><SelectValue /></SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    <SelectItem value="TEMPLATE">Standard (Route Template)</SelectItem>
                                                    <SelectItem value="REPEAT">Repeat (Previous Job)</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="order_name"
                                    render={({ field }) => (
                                        <FormItem>
                                            <Label className="text-[11px] font-bold">Order Name (optional)</Label>
                                            <FormControl>
                                                <Input
                                                    className="h-9 text-sm"
                                                    placeholder="e.g. Mango Pouch Repeat"
                                                    {...field}
                                                />
                                            </FormControl>
                                        </FormItem>
                                    )}
                                />
                                <FormField
                                    control={form.control}
                                    name="line_name"
                                    render={({ field }) => (
                                        <FormItem>
                                            <Label className="text-[11px] font-bold">Line Item Name (optional)</Label>
                                            <FormControl>
                                                <Input
                                                    className="h-9 text-sm"
                                                    placeholder="e.g. 70um Trident Pouch"
                                                    {...field}
                                                />
                                            </FormControl>
                                        </FormItem>
                                    )}
                                />
                                <div className="grid grid-cols-2 gap-3">
                                    <FormField
                                        control={form.control}
                                        name="qty_value"
                                        render={({ field }) => (
                                            <FormItem>
                                                <Label className="text-[11px] font-bold">Target Qty</Label>
                                                <FormControl><Input type="number" className="h-9 text-sm" {...field} onChange={e => field.onChange(parseFloat(e.target.value))} /></FormControl>
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={form.control}
                                                name="qty_uom"
                                                render={({ field }) => (
                                                    <FormItem>
                                                        <Label className="text-[11px] font-bold">UOM</Label>
                                                        <Select onValueChange={(val) => {
                                                    if (fgType === "ROLL") {
                                                        field.onChange("KG")
                                                        return
                                                    }
                                                    const prev = field.value
                                                    const currentQty = form.getValues("qty_value")
                                                    const weightG = activePreview?.unit_weight_g || 0

                                                    if (val !== prev && weightG > 0 && currentQty > 0) {
                                                        if (val === "KG" && prev === "PCS") {
                                                            // PCS to KG: (qty * weight_g) / 1000
                                                            const kg = (currentQty * weightG) / 1000
                                                            form.setValue("qty_value", parseFloat(kg.toFixed(3)))
                                                        } else if (val === "PCS" && prev === "KG") {
                                                            // KG to PCS: (qty * 1000) / weight_g
                                                            const pcs = (currentQty * 1000) / weightG
                                                            form.setValue("qty_value", Math.round(pcs))
                                                        }
                                                    }
                                                    field.onChange(val)
                                                }} value={field.value}>
                                                    <FormControl><SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger></FormControl>
                                                    <SelectContent>
                                                        <SelectItem value="KG">KG</SelectItem>
                                                        {fgType !== "ROLL" && <SelectItem value="PCS">PCS</SelectItem>}
                                                    </SelectContent>
                                                </Select>
                                            </FormItem>
                                        )}
                                    />
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                    <FormField
                                        control={form.control}
                                        name="price_basis"
                                        render={({ field }) => (
                                            <FormItem>
                                                <Label className="text-[11px] font-bold">Price Basis</Label>
                                                <Select onValueChange={field.onChange} value={field.value}>
                                                    <FormControl>
                                                        <SelectTrigger className="h-9 text-sm">
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                    </FormControl>
                                                    <SelectContent>
                                                        <SelectItem value="KG">Per KG</SelectItem>
                                                        {fgType !== "ROLL" && <SelectItem value="PCS">Per PCS</SelectItem>}
                                                    </SelectContent>
                                                </Select>
                                            </FormItem>
                                        )}
                                    />
                                    <FormField
                                        control={form.control}
                                        name="unit_price"
                                        render={({ field }) => (
                                            <FormItem>
                                                <Label className="text-[11px] font-bold">Unit Price</Label>
                                                <FormControl>
                                                    <Input
                                                        type="number"
                                                        min={0}
                                                        step="0.01"
                                                        className="h-9 text-sm"
                                                        {...field}
                                                        onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)}
                                                    />
                                                </FormControl>
                                            </FormItem>
                                        )}
                                    />
                                </div>
                                <FormField
                                    control={form.control}
                                    name="delivery_date"
                                    render={({ field }) => (
                                        <FormItem>
                                            <Label className="text-[11px] font-bold">Delivery Deadline</Label>
                                            <FormControl><Input type="date" className="h-9 text-sm" {...field} /></FormControl>
                                        </FormItem>
                                    )}
                                />
                            </CardContent>
                        </Card>

                        {mode === "TEMPLATE" && (
                            <Card className="shadow-sm border-primary/20 bg-primary/5">
                                <CardHeader className="pb-3">
                                    <CardTitle className="text-xs font-black uppercase text-primary tracking-wider">Template Selection</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <FormField
                                        control={form.control}
                                        name="template_id"
                                        render={({ field }) => (
                                            <FormItem>
                                                <FormControl>
                                                    <TemplateSelectionDialog
                                                        templates={templates || []}
                                                        onSelect={field.onChange}
                                                        currentId={field.value}
                                                    />
                                                </FormControl>
                                                <FormDescription className="text-[10px] italic">Template defines final product type and route. Sales snapshots remain authoritative.</FormDescription>
                                            </FormItem>
                                        )}
                                    />
                                </CardContent>
                            </Card>
                        )}

                        {mode === "REPEAT" && (
                            <div className="space-y-4 p-4 bg-slate-50 rounded-lg border border-slate-200">
                                <h4 className="text-[10px] font-black uppercase text-slate-400">Clone Previous Job</h4>
                                <Select onValueChange={setSelectedRepeatOrderId} value={selectedRepeatOrderId}>
                                    <SelectTrigger className="h-9 text-sm bg-white" data-testid="sales-order-repeat-source"><SelectValue placeholder="Search Jobs..." /></SelectTrigger>
                                    <SelectContent>
                                        {recentOrders?.filter((o: any) => !form.watch("customer_name") || o.customer_name === form.watch("customer_name")).map((o: any) => (
                                            <SelectItem key={o.id} value={o.id}>{o.order_number} ({new Date(o.created_at).toLocaleDateString()})</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                {repeatReview && (
                                    <div className="rounded-xl border border-blue-200 bg-white p-4 space-y-3" data-testid="sales-order-repeat-review">
                                        <div>
                                            <div className="text-[10px] font-black uppercase tracking-widest text-blue-700">Repeat review</div>
                                            <div className="text-xs text-slate-500 mt-1">
                                                Previous order details are copied into this draft, but risky dependencies are still flagged for review.
                                            </div>
                                        </div>
                                        <div className="space-y-2">
                                            <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Inherited into this draft</div>
                                            <div className="flex flex-wrap gap-2">
                                                {repeatReview.inherited.map((entry) => (
                                                    <Badge key={entry} variant="outline" className="bg-slate-50 text-slate-700 border-slate-200">
                                                        {entry}
                                                    </Badge>
                                                ))}
                                            </div>
                                        </div>
                                        <div className="space-y-2">
                                            <div className="text-[10px] font-black uppercase tracking-widest text-amber-700">Review before placing</div>
                                            {repeatReview.reviewFlags.length ? (
                                                <div className="space-y-2">
                                                    {repeatReview.reviewFlags.map((flag) => (
                                                        <div key={flag} className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                                                            <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                                                            <span>{flag}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <div className="flex items-start gap-2 text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                                                    <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                                                    <span>No repeat-specific blockers detected. You can still edit the cloned values before placing the order.</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* BLOCK B: CONFIGURATION (Middle) */}
                    <div className="lg:col-span-6 space-y-6">
                        <div className="space-y-6">
                            <div className="flex items-center justify-between">
                                <h2 className="text-sm font-black uppercase text-slate-500 tracking-wider">Block B — Technical Configuration</h2>
                                <Badge variant="secondary" className="bg-emerald-100 text-emerald-700 text-[10px] uppercase">Sales Snapshot Mode</Badge>
                            </div>

                            <Tabs defaultValue="geometry" className="w-full">
                                <TabsList className="grid w-full grid-cols-6 h-9">
                                    <TabsTrigger value="geometry" className="text-[10px] font-bold uppercase">Geometry</TabsTrigger>
                                    <TabsTrigger value="stack" className="text-[10px] font-bold uppercase">Stack</TabsTrigger>
                                    <TabsTrigger value="printing" className="text-[10px] font-bold uppercase">Print</TabsTrigger>
                                    <TabsTrigger value="chemicals" className="text-[10px] font-bold uppercase">Chems</TabsTrigger>
                                    <TabsTrigger value="packaging" className="text-[10px] font-bold uppercase">Packaging</TabsTrigger>
                                    <TabsTrigger value="addons" className="text-[10px] font-bold uppercase">Addons</TabsTrigger>
                                </TabsList>

                                <TabsContent value="geometry" className="pt-4 animate-in fade-in duration-300">
                                    <Card className="border-slate-200 shadow-none">
                                        <CardContent className="pt-6 space-y-6">
                                            <div className="grid grid-cols-2 gap-4">
                                                <div className="space-y-2">
                                                    <Label className="text-[10px] font-bold">Final Product Type</Label>
                                                    <div className="h-9 rounded-md border border-slate-200 bg-slate-50 px-3 flex items-center text-xs font-bold text-slate-700">
                                                        {selectedTemplate ? String(selectedTemplate.fg_type || "POUCH").toUpperCase() : String(fgType || "POUCH").toUpperCase()}
                                                    </div>
                                                </div>
                                                <div className="grid grid-cols-2 gap-2">
                                                    {fgType === "ROLL" ? (
                                                        <FormField
                                                            control={form.control}
                                                            name="roll_form"
                                                            render={({ field }) => (
                                                                <FormItem className="col-span-2">
                                                                    <Label className="text-[10px] font-bold">Roll Form</Label>
                                                                    <Select value={field.value || "FLAT"} onValueChange={field.onChange}>
                                                                        <FormControl>
                                                                            <SelectTrigger className="h-9 text-xs bg-white">
                                                                                <SelectValue placeholder="Select roll form" />
                                                                            </SelectTrigger>
                                                                        </FormControl>
                                                                        <SelectContent>
                                                                            <SelectItem value="FLAT">FLAT</SelectItem>
                                                                            <SelectItem value="FOLDED">FOLDED</SelectItem>
                                                                            <SelectItem value="TUBING">TUBING</SelectItem>
                                                                        </SelectContent>
                                                                    </Select>
                                                                </FormItem>
                                                            )}
                                                        />
                                                    ) : null}
                                                    {fgType === "POUCH" ? (
                                                        <FormField
                                                            control={form.control}
                                                            name="geometry.base.width_mm"
                                                            render={({ field }) => (
                                                                <FormItem>
                                                                    <Label className="text-[10px] font-bold">Width (mm) <span className="text-blue-500">✎</span></Label>
                                                                    <FormControl><Input type="number" className="h-9 text-xs border-blue-200 focus:border-blue-400" {...field} onChange={e => field.onChange(parseFloat(e.target.value) || 0)} /></FormControl>
                                                                </FormItem>
                                                            )}
                                                        />
                                                    ) : (
                                                        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-[10px] font-bold text-slate-500">
                                                            Roll width is taken from Layer 1 in the Stack tab.
                                                        </div>
                                                    )}
                                                    {fgType === "POUCH" && (
                                                        <FormField
                                                            control={form.control}
                                                            name="geometry.base.height_mm"
                                                            render={({ field }) => (
                                                                <FormItem>
                                                                    <Label className="text-[10px] font-bold">Height (mm) <span className="text-blue-500">✎</span></Label>
                                                                    <FormControl><Input type="number" className="h-9 text-xs border-blue-200 focus:border-blue-400" {...field} value={field.value ?? ""} onChange={e => field.onChange(parseFloat(e.target.value) || 0)} /></FormControl>
                                                                </FormItem>
                                                            )}
                                                        />
                                                    )}
                                                    {fgType === "ROLL" && (
                                                        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-[10px] font-bold text-slate-500">
                                                            Roll length is derived from KG, width, thickness, and density.
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Inch Converter Row */}
                                            <div className="grid grid-cols-2 gap-4 border-t border-slate-100 pt-3 mt-1">
                                                {fgType === "POUCH" ? (
                                                    <div className="space-y-1">
                                                        <Label className="text-[9px] font-bold text-slate-400">Quick Converter (W in Inches)</Label>
                                                        <Input
                                                            type="number"
                                                            placeholder="Width (in)"
                                                            className="h-8 text-[11px] bg-slate-50 border-slate-200"
                                                            onChange={(e) => {
                                                                const val = parseFloat(e.target.value);
                                                                if (!isNaN(val)) {
                                                                    form.setValue("geometry.base.width_mm", Math.round(val * 25.4 * 10) / 10);
                                                                }
                                                            }}
                                                        />
                                                    </div>
                                                ) : (
                                                    <div className="space-y-1">
                                                        <Label className="text-[9px] font-bold text-slate-400">Roll Width Source</Label>
                                                        <Input
                                                            disabled
                                                            value="Use Layer 1 roll width in Stack"
                                                            className="h-8 text-[11px] bg-slate-50 border-slate-200 text-slate-400"
                                                        />
                                                    </div>
                                                )}
                                                {fgType === "POUCH" && (
                                                    <div className="space-y-1">
                                                        <Label className="text-[9px] font-bold text-slate-400">Quick Converter (H in Inches)</Label>
                                                        <Input
                                                            type="number"
                                                            placeholder="Height (in)"
                                                            className="h-8 text-[11px] bg-slate-50 border-slate-200"
                                                            onChange={(e) => {
                                                                const val = parseFloat(e.target.value);
                                                                if (!isNaN(val)) {
                                                                    form.setValue("geometry.base.height_mm", Math.round(val * 25.4 * 10) / 10);
                                                                }
                                                            }}
                                                        />
                                                    </div>
                                                )}
                                                {fgType === "ROLL" && (
                                                    <div className="space-y-1">
                                                        <Label className="text-[9px] font-bold text-slate-400">Roll Preview</Label>
                                                        <Input
                                                            disabled
                                                            value="Length derives automatically"
                                                            className="h-8 text-[11px] bg-slate-50 border-slate-200 text-slate-400"
                                                        />
                                                    </div>
                                                )}
                                            </div>

                                            <div className="grid grid-cols-1 gap-4 border-t pt-4">
                                                <FormField
                                                    control={form.control}
                                                    name="geometry.multipliers.faces"
                                                    render={({ field }) => (
                                                        <FormItem>
                                                            <Label className="text-[10px] font-bold">Multi-up (Faces)</Label>
                                                            <FormControl>
                                                                <Input
                                                                    type="number"
                                                                    min={1}
                                                                    className="h-9 text-xs"
                                                                    {...field}
                                                                    onChange={e => field.onChange(Math.max(1, parseInt(e.target.value || "1", 10) || 1))}
                                                                />
                                                            </FormControl>
                                                        </FormItem>
                                                    )}
                                                />
                                            </div>

                                            <div className="space-y-4 border-t pt-4">
                                                <div className="flex items-center justify-between">
                                                    <h4 className="text-[11px] font-bold uppercase text-slate-400">Physical Adjustments <span className="text-blue-500">✎</span></h4>
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-[10px] text-slate-400">Effective:</span>
                                                        <Badge variant="secondary" className="bg-blue-50 text-blue-600 text-[10px] font-bold border-none">
                                                            {activePreview?.physics?.geometry_snapshot?.effective_width_mm || 0}W × {fgType === "ROLL"
                                                                ? `${previewRoll?.derived_length_m || 0}M`
                                                                : `${activePreview?.physics?.geometry_snapshot?.effective_height_mm || 0}H`}
                                                        </Badge>
                                                    </div>
                                                </div>
                                                {adjFields.map((field, index) => (
                                                    <div key={field.id} className="flex gap-2 items-center bg-slate-50/50 p-2 rounded border border-slate-100">
                                                        <Input {...form.register(`geometry.adjustments.${index}.name`)} placeholder="Name" className="h-8 text-xs bg-white w-full border-blue-200" />
                                                        <Input {...form.register(`geometry.adjustments.${index}.value`, { valueAsNumber: true })} type="number" placeholder="mm" className="h-8 text-xs bg-white w-20 border-blue-200" />
                                                        <Select
                                                            value={form.watch(`geometry.adjustments.${index}.impact`) || "WIDTH"}
                                                            onValueChange={(val) => form.setValue(`geometry.adjustments.${index}.impact`, val as "WIDTH" | "HEIGHT" | "BOTH")}
                                                        >
                                                            <SelectTrigger className="h-8 text-[10px] bg-white w-24 border-slate-200"><SelectValue /></SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="WIDTH">WIDTH</SelectItem>
                                                                <SelectItem value="HEIGHT">HEIGHT</SelectItem>
                                                                <SelectItem value="BOTH">BOTH</SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                        <Button type="button" variant="ghost" size="sm" className="h-8 w-8 text-red-400 hover:text-red-600 hover:bg-red-50 shrink-0" onClick={() => removeAdj(index)}>✕</Button>
                                                    </div>
                                                ))}
                                                <div className="flex items-center gap-3">
                                                    {adjFields.length === 0 && <p className="text-[10px] text-slate-400 italic">No custom geometry adjustments.</p>}
                                                    <Button type="button" variant="outline" size="sm" className="h-7 text-[10px] font-bold border-blue-200 text-blue-600 hover:bg-blue-50" onClick={() => appendAdj({ name: "", value: 0, impact: "WIDTH" })}>
                                                        + Add Adjustment
                                                    </Button>
                                                </div>

                                                {activePreview?.physics?.breakdown?.pod && (
                                                    <div className="mt-2 p-3 bg-amber-50/50 border border-amber-100 rounded-lg flex items-center justify-between">
                                                        <div className="flex items-center gap-2">
                                                            <div className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
                                                            <span className="text-[10px] font-black uppercase text-amber-700">POD Reinforcement Active</span>
                                                        </div>
                                                        <span className="text-[10px] font-bold text-amber-600">Calculated from Effective W</span>
                                                    </div>
                                                )}
                                            </div>
                                        </CardContent>
                                    </Card>
                                </TabsContent>

                                <TabsContent value="stack" className="pt-4">
                                    <Card className="border-slate-200">
                                        <CardHeader className="flex flex-row items-center justify-between pb-2 border-b">
                                            <CardTitle className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Lamination Stack</CardTitle>
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                className="h-7 text-[10px] font-bold border-blue-200 text-blue-600 hover:bg-blue-50"
                                                onClick={() => appendLayer({ family_id: "", variant_id: "", thickness_micron: 0, roll_width_mm: 0, grade_id: null })}
                                            >
                                                + Add Layer
                                            </Button>
                                        </CardHeader>
                                        <CardContent className="space-y-4 pt-4">
                                            {layerFields.map((field, index) => {
                                                const familyId = form.watch(`film_layers.${index}.family_id`)
                                                const variantId = form.watch(`film_layers.${index}.variant_id`)
                                                const selectedVariant = variants?.find((v: any) => String(v.id) === String(variantId))
                                                const familyVariants = (variants || []).filter((v: any) => {
                                                    const parentId = String(v?.parent_family?.id || v?.parent_family || "")
                                                    return parentId === String(familyId || "")
                                                })

                                                return (
                                                    <div key={field.id} className="flex gap-3 items-start p-3 border rounded-lg bg-white shadow-sm">
                                                        <div className="flex flex-col gap-1 items-center shrink-0">
                                                            <Badge variant="outline" className="h-5 w-5 rounded-full p-0 flex items-center justify-center bg-slate-100 text-[10px] font-bold">L{index + 1}</Badge>
                                                            <GripVertical className="h-3 w-3 text-slate-300" />
                                                        </div>
                                                        <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-2">
                                                            <FormField
                                                                control={form.control}
                                                                name={`film_layers.${index}.family_id`}
                                                                render={({ field }) => (
                                                                    <FormItem>
                                                                        <Label className="text-[9px] font-bold text-slate-400 uppercase">Family</Label>
                                                                        <Select
                                                                            value={field.value || ""}
                                                                            onValueChange={(val) => {
                                                                                field.onChange(val)
                                                                                const currentVariantId = form.getValues(`film_layers.${index}.variant_id`)
                                                                                const variantStillValid = (variants || []).some((v: any) => {
                                                                                    const parentId = String(v?.parent_family?.id || v?.parent_family || "")
                                                                                    return String(v.id) === String(currentVariantId) && parentId === String(val)
                                                                                })
                                                                                if (!variantStillValid) {
                                                                                    form.setValue(`film_layers.${index}.variant_id`, "")
                                                                                    form.setValue(`film_layers.${index}.grade_id`, null as any)
                                                                                }
                                                                            }}
                                                                        >
                                                                            <FormControl>
                                                                                <SelectTrigger className="h-8 text-xs bg-white">
                                                                                    <SelectValue placeholder="Select family" />
                                                                                </SelectTrigger>
                                                                            </FormControl>
                                                                            <SelectContent>
                                                                                {(families || []).map((f: any) => (
                                                                                    <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>
                                                                                ))}
                                                                            </SelectContent>
                                                                        </Select>
                                                                    </FormItem>
                                                                )}
                                                            />
                                                            <FormField
                                                                control={form.control}
                                                                name={`film_layers.${index}.variant_id`}
                                                                render={({ field }) => (
                                                                    <FormItem>
                                                                        <Label className="text-[9px] font-bold text-slate-400 uppercase">Variant</Label>
                                                                        <Select
                                                                            value={field.value || ""}
                                                                            onValueChange={(val) => {
                                                                                field.onChange(val)
                                                                                const picked = (variants || []).find((v: any) => String(v.id) === String(val))
                                                                                if (!picked?.is_extrudable) {
                                                                                    form.setValue(`film_layers.${index}.grade_id`, null as any)
                                                                                }
                                                                            }}
                                                                        >
                                                                            <FormControl>
                                                                                <SelectTrigger className="h-8 text-xs bg-white">
                                                                                    <SelectValue placeholder="Select variant" />
                                                                                </SelectTrigger>
                                                                            </FormControl>
                                                                            <SelectContent>
                                                                                {familyVariants.map((v: any) => (
                                                                                    <SelectItem key={v.id} value={String(v.id)}>{v.name}</SelectItem>
                                                                                ))}
                                                                            </SelectContent>
                                                                        </Select>
                                                                    </FormItem>
                                                                )}
                                                            />
                                                            <FormField
                                                                control={form.control}
                                                                name={`film_layers.${index}.thickness_micron`}
                                                                render={({ field }) => (
                                                                    <FormItem>
                                                                        <Label className="text-[9px] font-bold text-slate-400 uppercase">Thickness (µ)</Label>
                                                                        <FormControl>
                                                                            <Input
                                                                                type="number"
                                                                                className="h-8 text-xs bg-white"
                                                                                {...field}
                                                                                onChange={e => field.onChange(parseFloat(e.target.value) || 0)}
                                                                            />
                                                                        </FormControl>
                                                                    </FormItem>
                                                                )}
                                                            />
                                                            <FormField
                                                                control={form.control}
                                                                name={`film_layers.${index}.roll_width_mm`}
                                                                render={({ field }) => (
                                                                    <FormItem>
                                                                        <Label className="text-[9px] font-bold text-slate-400 uppercase">Roll Width (mm)</Label>
                                                                        <FormControl>
                                                                            <Input
                                                                                type="number"
                                                                                className="h-8 text-xs bg-white"
                                                                                {...field}
                                                                                onChange={e => field.onChange(parseFloat(e.target.value) || 0)}
                                                                            />
                                                                        </FormControl>
                                                                        <p className="text-[9px] text-slate-400">Used for roll allocation compatibility window.</p>
                                                                    </FormItem>
                                                                )}
                                                            />
                                                        </div>
                                                        <div className="w-[170px] space-y-2">
                                                            <p className="text-[9px] font-bold text-slate-400 uppercase">Grade</p>
                                                            {selectedVariant?.is_extrudable ? (
                                                                <GradeSelector
                                                                    variantId={String(variantId || "")}
                                                                    value={String(form.watch(`film_layers.${index}.grade_id`) || "")}
                                                                    onChange={(val) => form.setValue(`film_layers.${index}.grade_id`, val)}
                                                                />
                                                            ) : (
                                                                <div className="text-[10px] text-slate-400 italic">Not required for purchasable variant</div>
                                                            )}
                                                        </div>
                                                        {layerFields.length > 1 && (
                                                            <Button
                                                                type="button"
                                                                variant="ghost"
                                                                size="sm"
                                                                className="h-8 w-8 text-red-400 hover:text-red-600 hover:bg-red-50 shrink-0 mt-6"
                                                                onClick={() => removeLayer(index)}
                                                            >
                                                                <Trash2 className="h-4 w-4" />
                                                            </Button>
                                                        )}
                                                    </div>
                                                )
                                            })}
                                        </CardContent>
                                    </Card>
                                </TabsContent>

                                <TabsContent value="printing" className="pt-4">
                                    <Card>
                                        <CardContent className="pt-6">
                                            <div className="space-y-4">
                                                <FormField
                                                    control={form.control}
                                                    name="printing.enabled"
                                                    render={({ field }) => (
                                                        <FormItem className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
                                                            <div>
                                                                <Label className="text-xs font-bold">Printing Enabled</Label>
                                                                <p className="text-[10px] text-slate-500">Sales-confirmed print config drives BOM inks.</p>
                                                            </div>
                                                            <FormControl>
                                                                <Switch checked={!!field.value} onCheckedChange={field.onChange} />
                                                            </FormControl>
                                                        </FormItem>
                                                    )}
                                                />
                                                {form.watch("printing.enabled") ? (
                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                        <FormField
                                                            control={form.control}
                                                            name="printing.type"
                                                            render={({ field }) => (
                                                                <FormItem>
                                                                    <Label className="text-[10px] font-bold uppercase">Method</Label>
                                                                    <Select value={field.value || "FLEXO"} onValueChange={field.onChange}>
                                                                        <FormControl>
                                                                            <SelectTrigger className="h-9 text-xs bg-white"><SelectValue /></SelectTrigger>
                                                                        </FormControl>
                                                                        <SelectContent>
                                                                            <SelectItem value="FLEXO">FLEXO</SelectItem>
                                                                            <SelectItem value="ROTO">ROTO</SelectItem>
                                                                            <SelectItem value="DIGITAL">DIGITAL</SelectItem>
                                                                        </SelectContent>
                                                                    </Select>
                                                                </FormItem>
                                                            )}
                                                        />
                                                        {form.watch("printing.type") ? (
                                                            <FormField
                                                                control={form.control}
                                                                name="printing.substrate_mode"
                                                                render={({ field }) => (
                                                                    <FormItem className="md:col-span-2">
                                                                        <Label className="text-[10px] font-bold uppercase">Substrate Mode</Label>
                                                                        <div className="grid grid-cols-2 gap-3">
                                                                            <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 cursor-pointer">
                                                                                <Checkbox
                                                                                    checked={(field.value || "SHEET") === "SHEET"}
                                                                                    onCheckedChange={(checked) => {
                                                                                        if (checked) field.onChange("SHEET")
                                                                                    }}
                                                                                />
                                                                                <span className="text-xs font-semibold uppercase">Sheet</span>
                                                                            </label>
                                                                            <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 cursor-pointer">
                                                                                <Checkbox
                                                                                    checked={field.value === "TUBING"}
                                                                                    onCheckedChange={(checked) => {
                                                                                        if (checked) field.onChange("TUBING")
                                                                                    }}
                                                                                />
                                                                                <span className="text-xs font-semibold uppercase">Tubing</span>
                                                                            </label>
                                                                        </div>
                                                                    </FormItem>
                                                                )}
                                                            />
                                                        ) : null}
                                                        <FormField
                                                            control={form.control}
                                                            name="printing.front_colors_count"
                                                            render={({ field }) => (
                                                                <FormItem>
                                                                    <Label className="text-[10px] font-bold uppercase">Front Colors</Label>
                                                                    <FormControl>
                                                                        <Input type="number" className="h-9 text-xs bg-white" {...field} onChange={e => field.onChange(parseFloat(e.target.value) || 0)} />
                                                                    </FormControl>
                                                                </FormItem>
                                                            )}
                                                        />
                                                        <FormField
                                                            control={form.control}
                                                            name="printing.back_colors_count"
                                                            render={({ field }) => (
                                                                <FormItem>
                                                                    <Label className="text-[10px] font-bold uppercase">Back Colors</Label>
                                                                    <FormControl>
                                                                        <Input type="number" className="h-9 text-xs bg-white" {...field} onChange={e => field.onChange(parseFloat(e.target.value) || 0)} />
                                                                    </FormControl>
                                                                </FormItem>
                                                            )}
                                                        />
                                                        <FormField
                                                            control={form.control}
                                                            name="printing.ink_gsm_total"
                                                            render={({ field }) => (
                                                                <FormItem>
                                                                    <Label className="text-[10px] font-bold uppercase">Total Ink GSM</Label>
                                                                    <FormControl>
                                                                        <Input type="number" step="0.01" className="h-9 text-xs bg-white" {...field} onChange={e => field.onChange(parseFloat(e.target.value) || 0)} />
                                                                    </FormControl>
                                                                </FormItem>
                                                            )}
                                                        />
                                                        <FormField
                                                            control={form.control}
                                                            name="printing.artwork_id"
                                                            render={({ field }) => (
                                                                <FormItem>
                                                                    <Label className="text-[10px] font-bold uppercase">Approved Artwork</Label>
                                                                    <Select
                                                                        value={field.value || ""}
                                                                        onValueChange={(value) => {
                                                                            field.onChange(value)
                                                                            form.setValue("printing.defer_artwork_to_planner", false)
                                                                        }}
                                                                        disabled={deferArtworkToPlanner}
                                                                    >
                                                                        <FormControl>
                                                                            <SelectTrigger className="h-9 text-xs bg-white">
                                                                                <SelectValue placeholder={printingType === "ROTO" ? "Select cylinder-ready artwork" : "Select artwork"} />
                                                                            </SelectTrigger>
                                                                        </FormControl>
                                                                        <SelectContent>
                                                                            {(artworks || [])
                                                                                .map((a: any) => (
                                                                                    <SelectItem key={a.id} value={a.id}>{a.design_code} - {a.name}</SelectItem>
                                                                                ))}
                                                                        </SelectContent>
                                                                    </Select>
                                                                </FormItem>
                                                            )}
                                                        />
                                                        <FormField
                                                            control={form.control}
                                                            name="printing.defer_artwork_to_planner"
                                                            render={({ field }) => (
                                                                <FormItem className="md:col-span-2">
                                                                    <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white p-3">
                                                                        <div>
                                                                            <Label className="text-xs font-bold">Defer Artwork To Planner</Label>
                                                                            <p className="text-[10px] text-slate-500">
                                                                                Use this when sales confirms printing before artwork finalization.
                                                                            </p>
                                                                        </div>
                                                                        <FormControl>
                                                                            <Switch
                                                                                checked={!!field.value}
                                                                                onCheckedChange={(checked) => {
                                                                                    field.onChange(checked)
                                                                                    if (checked) {
                                                                                        form.setValue("printing.artwork_id", "")
                                                                                    }
                                                                                }}
                                                                            />
                                                                        </FormControl>
                                                                    </div>
                                                                </FormItem>
                                                            )}
                                                        />
                                                        {deferArtworkToPlanner ? (
                                                            <div className="md:col-span-2 rounded-md border border-amber-300 bg-amber-50 p-3">
                                                                <p className="text-[10px] font-bold uppercase text-amber-700">Planner Gate Active</p>
                                                                <p className="mt-1 text-[10px] text-amber-800">
                                                                    This order can confirm, but planner release is blocked until approved artwork is assigned in Planner Control Tower.
                                                                </p>
                                                            </div>
                                                        ) : null}
                                                        <div className="md:col-span-2 rounded-md border bg-slate-50 p-3">
                                                            <p className="text-[10px] font-bold uppercase text-slate-600">Artwork-driven resolution</p>
                                                            <p className="mt-1 text-[10px] text-slate-500">
                                                                Ink colors and cylinders are auto-resolved from approved artwork.
                                                                {printingType === "ROTO"
                                                                    ? " ROTO requires full cylinder coverage in artwork."
                                                                    : " FLEXO/DIGITAL do not require cylinder mapping at sales stage."}
                                                            </p>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="text-xs text-slate-400 italic text-center">Unprinted Job</div>
                                                )}
                                            </div>
                                        </CardContent>
                                    </Card>
                                </TabsContent>

                                <TabsContent value="chemicals" className="pt-4">
                                    <Card>
                                        <CardContent className="pt-6">
                                            {(form.watch("film_layers")?.length || 0) > 1 ? (
                                                <div className="grid grid-cols-2 gap-4">
                                                    <FormField
                                                        control={form.control}
                                                        name="chemicals.adhesive_gsm"
                                                        render={({ field }) => (
                                                            <FormItem>
                                                                <Label className="text-[10px] uppercase font-bold text-slate-400">Adhesive GSM</Label>
                                                                <FormControl>
                                                                    <Input type="number" step="0.01" className="h-9 text-xs bg-white" {...field} onChange={e => field.onChange(parseFloat(e.target.value) || 0)} />
                                                                </FormControl>
                                                            </FormItem>
                                                        )}
                                                    />
                                                    <FormField
                                                        control={form.control}
                                                        name="chemicals.solvent_gsm"
                                                        render={({ field }) => (
                                                            <FormItem>
                                                                <Label className="text-[10px] uppercase font-bold text-slate-400">Solvent GSM</Label>
                                                                <FormControl>
                                                                    <Input
                                                                        type="number"
                                                                        step="0.01"
                                                                        className="h-9 text-xs bg-white"
                                                                        {...field}
                                                                        onChange={e => field.onChange(parseFloat(e.target.value) || 0)}
                                                                    />
                                                                </FormControl>
                                                                <p className="text-[9px] text-slate-400">
                                                                    Enter explicit solvent GSM. No heuristic default is applied.
                                                                </p>
                                                            </FormItem>
                                                        )}
                                                    />
                                                </div>
                                            ) : <div className="text-xs text-slate-400 italic text-center">N/A for Single Layer</div>}
                                        </CardContent>
                                    </Card>
                                </TabsContent>

                                <TabsContent value="packaging" className="pt-4">
                                    <Card>
                                        <CardHeader className="pb-3 flex flex-row items-start justify-between gap-3">
                                            <div>
                                                <CardTitle className="text-[10px] font-black uppercase text-slate-500 tracking-wider">Packaging Snapshot</CardTitle>
                                                <CardDescription className="text-[10px]">This config is carried to production, packing yard, and dispatch gates.</CardDescription>
                                            </div>
                                            <Button type="button" variant="outline" size="sm" asChild>
                                                <Link href="/master/packaging">Manage Packaging SKUs</Link>
                                            </Button>
                                        </CardHeader>
                                        <CardContent className="space-y-4">
                                            {fgType === "POUCH" ? (
                                                <div className="space-y-3">
                                                    <div className="rounded-lg border border-slate-200 p-3 space-y-3">
                                                        <div className="flex items-center justify-between">
                                                            <div>
                                                                <p className="text-xs font-bold">Primary Inner Pack</p>
                                                                <p className="text-[10px] text-slate-500">Auto-consumed at final pouch FG completion.</p>
                                                            </div>
                                                            <Switch checked={primaryPackEnabled} onCheckedChange={setPrimaryPackEnabled} />
                                                        </div>
                                                        {primaryPackEnabled && (
                                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                                                <Select value={primaryPackMaterialId} onValueChange={setPrimaryPackMaterialId}>
                                                                    <SelectTrigger className="h-9 text-xs bg-white">
                                                                        <SelectValue placeholder="Select INNER_POUCH material" />
                                                                    </SelectTrigger>
                                                                    <SelectContent>
                                                                        {(packagingMaterials || [])
                                                                            .filter((m: any) => String(m.packaging_kind || "").toUpperCase() === "INNER_POUCH")
                                                                            .map((m: any) => (
                                                                                <SelectItem key={m.id} value={String(m.id)}>
                                                                                    {m.code} - {m.name}
                                                                                </SelectItem>
                                                                            ))}
                                                                    </SelectContent>
                                                                </Select>
                                                                <Input
                                                                    type="number"
                                                                    className="h-9 text-xs bg-white"
                                                                    value={String(primaryPcsPerPack)}
                                                                    onChange={(e) => setPrimaryPcsPerPack(Number(e.target.value || 0))}
                                                                    placeholder="PCS per pack"
                                                                />
                                                            </div>
                                                        )}
                                                    </div>

                                                    <div className="rounded-lg border border-slate-200 p-3 space-y-3">
                                                        <div className="flex items-center justify-between">
                                                            <div>
                                                                <p className="text-xs font-bold">POD Reinforcement</p>
                                                                <p className="text-[10px] text-slate-500">
                                                                    Master-formula POD film. Height, thickness, density and panel rules come from selected POD profile.
                                                                </p>
                                                            </div>
                                                            <Switch checked={podEnabled} onCheckedChange={setPodEnabled} />
                                                        </div>
                                                        {podEnabled && (
                                                            <Select value={podProfileId} onValueChange={setPodProfileId}>
                                                                <SelectTrigger className="h-9 text-xs bg-white">
                                                                    <SelectValue placeholder="Select POD profile" />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    {(podProfiles || []).map((pod: any) => (
                                                                        <SelectItem key={pod.id} value={String(pod.id)}>
                                                                            {pod.code} - {pod.name}
                                                                        </SelectItem>
                                                                    ))}
                                                                </SelectContent>
                                                            </Select>
                                                        )}
                                                    </div>
                                                </div>
                                            ) : (
                                                    <div className="rounded-lg border border-slate-200 p-3 space-y-3">
                                                        <div className="flex items-center justify-between">
                                                            <div>
                                                                <p className="text-xs font-bold">Roll Dispatch Packaging</p>
                                                                <p className="text-[10px] text-slate-500">Select allowed materials here. Actual quantities are captured later in Packing Yard and dispatch.</p>
                                                            </div>
                                                            <Switch checked={rollDispatchPackEnabled} onCheckedChange={setRollDispatchPackEnabled} />
                                                        </div>
                                                        {rollDispatchPackEnabled && (
                                                            <div className="space-y-2">
                                                                {(rollDispatchLines || []).map((line, idx) => (
                                                                <div key={`roll-line-${idx}`} className="grid grid-cols-1 md:grid-cols-[1.6fr_0.9fr_auto] gap-2">
                                                                    <Select
                                                                        value={line.material_id}
                                                                        onValueChange={(val) => setRollDispatchLines((prev) => prev.map((it, i) => {
                                                                            if (i !== idx) return it
                                                                            const selected = (packagingMaterials || []).find((m: any) => String(m.id) === String(val))
                                                                            const baseUom = String(selected?.base_uom || it.uom || "PCS").toUpperCase()
                                                                            const normalizedUom = ["PCS", "KG", "METER"].includes(baseUom)
                                                                                ? (baseUom as "PCS" | "KG" | "METER")
                                                                                : "PCS"
                                                                            return {
                                                                                ...it,
                                                                                material_id: val,
                                                                                qty: 0,
                                                                                uom: normalizedUom,
                                                                            }
                                                                        }))}
                                                                    >
                                                                        <SelectTrigger className="h-8 text-xs bg-white md:col-span-2">
                                                                            <SelectValue placeholder="Packaging material" />
                                                                        </SelectTrigger>
                                                                        <SelectContent>
                                                                            {(packagingMaterials || []).map((m: any) => (
                                                                                <SelectItem key={m.id} value={String(m.id)}>
                                                                                    {m.code} - {m.name}
                                                                                </SelectItem>
                                                                            ))}
                                                                        </SelectContent>
                                                                    </Select>
                                                                    <div className="flex h-8 items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-[11px] font-semibold text-slate-600">
                                                                        {line.material_id ? `${line.uom} actual at packing` : "Select material first"}
                                                                    </div>
                                                                    <Button type="button" variant="ghost" size="sm" className="h-8 text-red-500" onClick={() => setRollDispatchLines((prev) => prev.filter((_, i) => i !== idx))}>
                                                                        Remove
                                                                    </Button>
                                                                </div>
                                                            ))}
                                                            <Button type="button" variant="outline" size="sm" onClick={() => setRollDispatchLines((prev) => [...prev, { material_id: "", qty: 0, uom: "PCS", basis: "PER_ROLL" }])}>
                                                                + Add Allowed Material
                                                            </Button>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </CardContent>
                                    </Card>
                                </TabsContent>

                                <TabsContent value="addons" className="pt-4">
                                    <Card>
                                        <CardContent className="pt-6 space-y-2">
                                            <div className="flex items-center justify-between">
                                                <p className="text-[10px] uppercase font-bold text-slate-400">Add-on Mapping</p>
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    size="sm"
                                                    className="h-7 text-[10px] font-bold border-blue-200 text-blue-600 hover:bg-blue-50"
                                                    onClick={() => appendAddon({ addon_id: "", qty: 1, applies_to: "NONE" } as any)}
                                                >
                                                    + Add Add-on
                                                </Button>
                                            </div>
                                            {addonsWatched.length > 0 ? addonsWatched.map((a: any, i: number) => {
                                                const selectedAddonId = String(form.watch(`addons.${i}.addon_id`) || "")
                                                const addonMeta = (addonsMaster || []).find((m: any) => String(m.id) === selectedAddonId)
                                                const selectedMode = String(addonMeta?.weight_mode || "").toUpperCase()
                                                return (
                                                    <div key={`${i}-${a?.addon_id || 'addon'}`} className="grid grid-cols-[1fr_110px_120px_40px] gap-2 p-2 bg-slate-50 rounded">
                                                        <Select
                                                            value={selectedAddonId}
                                                            onValueChange={(val) => {
                                                                form.setValue(`addons.${i}.addon_id`, val)
                                                                const nextAddon = (addonsMaster || []).find((m: any) => String(m.id) === String(val))
                                                                const mode = String(nextAddon?.weight_mode || "").toUpperCase()
                                                                if (mode === "PER_MM") {
                                                                    form.setValue(`addons.${i}.applies_to`, "WIDTH" as any)
                                                                } else if (mode === "FIXED") {
                                                                    form.setValue(`addons.${i}.applies_to`, "FIXED" as any)
                                                                } else {
                                                                    form.setValue(`addons.${i}.applies_to`, "PER_PIECE" as any)
                                                                }
                                                            }}
                                                        >
                                                            <SelectTrigger className="h-8 text-xs bg-white">
                                                                <SelectValue placeholder="Select add-on" />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                {(addonsMaster || []).map((m: any) => (
                                                                    <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                        <Input
                                                            type="number"
                                                            className="h-8 text-xs bg-white"
                                                            value={String(form.watch(`addons.${i}.qty`) || 0)}
                                                            onChange={(e) => form.setValue(`addons.${i}.qty`, parseFloat(e.target.value) || 0)}
                                                        />
                                                        {selectedMode === "PER_MM" ? (
                                                            <Select
                                                                value={String(form.watch(`addons.${i}.applies_to`) || "WIDTH")}
                                                                onValueChange={(val) => form.setValue(`addons.${i}.applies_to`, val as any)}
                                                            >
                                                                <SelectTrigger className="h-8 text-[10px] bg-white w-full max-w-[130px]">
                                                                    <SelectValue />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    <SelectItem value="WIDTH">Per MM - Width</SelectItem>
                                                                    <SelectItem value="HEIGHT">Per MM - Height</SelectItem>
                                                                </SelectContent>
                                                            </Select>
                                                        ) : (
                                                            <Input
                                                                readOnly
                                                                className="h-8 text-[10px] bg-slate-100"
                                                                value={selectedMode === "FIXED" ? "Fixed Weight" : "Per Piece"}
                                                            />
                                                        )}
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="sm"
                                                            className="h-8 w-8 text-red-400 hover:text-red-600 hover:bg-red-50"
                                                            onClick={() => removeAddon(i)}
                                                        >
                                                            <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                    </div>
                                                )
                                            }) : <div className="text-xs text-slate-400 italic text-center">No add-ons</div>}
                                        </CardContent>
                                    </Card>
                                </TabsContent>
                            </Tabs>
                        </div>
                    </div>

                    {/* BLOCK C: INDUSTRIAL PREVIEW (Right) */}
                    <div className="lg:col-span-3 space-y-6">
                        <Card className="sticky top-6 shadow-lg border-primary/20 bg-white overflow-hidden">
                            <div className="bg-primary/5 px-4 py-3 border-b border-primary/10">
                                <h3 className="text-xs font-black uppercase text-primary tracking-widest flex items-center gap-2">
                                    <TrendingUp className="h-3 w-3" />
                                    Reactive Quality Preview
                                </h3>
                            </div>
                            <CardContent className="p-4 space-y-6">
                                {activePreview ? (
                                    <div className="space-y-6 animate-in slide-in-from-right-4 duration-500">

                                        {/* Geometry Snapshot */}
                                        <div className="grid grid-cols-3 gap-2 pb-4 border-b border-dashed border-slate-100">
                                            <div className="space-y-0.5">
                                                <p className="text-[9px] font-bold text-slate-400 uppercase">{fgType === "ROLL" ? "Width" : "Effective W"}</p>
                                                <div className="text-sm font-mono font-bold text-slate-700">
                                                    {fgType === "ROLL"
                                                        ? (previewRoll?.width_mm ?? "—")
                                                        : (activePreview.physics?.geometry_snapshot?.effective_width_mm || 0)} mm
                                                </div>
                                            </div>
                                            <div className="space-y-0.5">
                                                <p className="text-[9px] font-bold text-slate-400 uppercase">{fgType === "ROLL" ? "Thickness" : "Effective H"}</p>
                                                <div className="text-sm font-mono font-bold text-slate-700">
                                                    {fgType === "ROLL"
                                                        ? (previewRoll?.thickness_micron ?? "—")
                                                        : (activePreview.physics?.geometry_snapshot?.effective_height_mm || 0)} mm
                                                </div>
                                            </div>
                                            <div className="space-y-0.5">
                                                <p className="text-[9px] font-bold text-slate-400 uppercase">{fgType === "ROLL" ? "Area (Derived)" : "Area"}</p>
                                                <div className="text-sm font-mono font-bold text-slate-700">
                                                    {fgType === "ROLL"
                                                        ? (previewRoll?.derived_area_m2 != null ? Number(previewRoll.derived_area_m2).toFixed(4) : "—")
                                                        : (activePreview.physics?.geometry_snapshot?.area_m2?.toFixed(4) || 0)} m²
                                                </div>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-4">
                                            <div className="space-y-1">
                                                <p className="text-[9px] font-bold text-slate-400 uppercase">{fgType === "ROLL" ? "Weight" : "Physics Weight"}</p>
                                                {fgType === "ROLL" ? (
                                                    <p className="text-xl font-black text-slate-800">{previewRoll?.weight_kg ?? activePreview.total_weight_kg}<span className="text-[10px] ml-1">KG</span></p>
                                                ) : (
                                                    <p className="text-xl font-black text-slate-800">{activePreview.unit_weight_g}<span className="text-[10px] ml-1">g/unit</span></p>
                                                )}
                                            </div>
                                            <div className="space-y-1">
                                                    <p className="text-[9px] font-bold text-slate-400 uppercase">{fgType === "ROLL" ? "Derived Length" : "Job Requirement"}</p>
                                                    <div className="flex flex-col">
                                                        {fgType === "ROLL" ? (
                                                            <p className="text-xl font-black text-slate-800">
                                                                {previewRoll?.derived_length_m ?? "—"}
                                                                <span className="text-[10px] ml-1">M</span>
                                                            </p>
                                                        ) : (
                                                            <>
                                                                <p className="text-xl font-black text-slate-800">
                                                                    {form.getValues("qty_uom") === "KG"
                                                                        ? `${activePreview.total_weight_kg}`
                                                                        : (previewEquivalentPcs !== null ? `${previewEquivalentPcs}` : "—")
                                                                }
                                                                <span className="text-[10px] ml-1">{form.getValues("qty_uom")}</span>
                                                            </p>
                                                            <p className="text-[10px] text-muted-foreground font-bold">
                                                                ≈ {form.getValues("qty_uom") === "KG"
                                                                    ? (previewEquivalentPcs !== null ? `${previewEquivalentPcs.toLocaleString()} PCS` : "—")
                                                                    : `${activePreview.total_weight_kg} KG`
                                                                }
                                                            </p>
                                                        </>
                                                        )}
                                                    {previewMathError && (
                                                        <p className="text-[10px] font-bold text-amber-600">{previewMathError}</p>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="space-y-3">
                                            <div className="flex items-center justify-between">
                                                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter">BOM Snapshot (Theoretical)</p>
                                                {activePreview.bom_preview?.components?.length > 0 && (
                                                    <Badge variant="outline" className="text-[9px] h-4 border-green-200 text-green-700 bg-green-50">
                                                        <CheckCircle2 className="w-3 h-3 mr-1" /> Recipe Valid
                                                    </Badge>
                                                )}
                                            </div>
                                            <div className="space-y-1.5 max-h-40 overflow-y-auto">
                                                {activePreview.bom?.films?.length > 0 ? (
                                                    activePreview.bom.films.map((f: any, i: number) => {
                                                        const layerGranules = (activePreview.bom?.granules || []).filter((g: any) =>
                                                            g.layer_index === i + 1 || (g.layer_index === undefined && activePreview.bom.films.length === 1)
                                                        )
                                                        const isRollPreview = String((form.getValues() as any).fg_type || "POUCH").toUpperCase() === "ROLL"
                                                        const simQty = isRollPreview
                                                            ? 1
                                                            : (form.getValues() as any).qty_uom === "KG"
                                                            ? (previewUnitWeight > 0
                                                                ? (Number((form.getValues() as any).qty_value || 0) * 1000) / previewUnitWeight
                                                                : 0)
                                                            : Number((form.getValues() as any).qty_value || 0)

                                                        const renderWeight = (w: number) => (w * simQty).toFixed(4)

                                                        return (
                                                            <div key={i} className="flex flex-col space-y-1 bg-slate-50 p-2 rounded border border-slate-100">
                                                                <div className="flex items-center justify-between text-[11px]">
                                                                    <span className="text-slate-600 font-bold truncate w-32">
                                                                        {f.name || f.code || `Layer ${i + 1}`}
                                                                    </span>
                                                                    <span className="font-bold text-slate-800">
                                                                        {renderWeight(f.weight_kg)} <span className="opacity-50 uppercase text-[9px]">KG</span>
                                                                    </span>
                                                                </div>
                                                                {layerGranules.length > 0 && (
                                                                    <div className="pl-4 space-y-1 mt-1 border-l-2 border-slate-200">
                                                                        {layerGranules.map((g: any, gi: number) => (
                                                                            <div key={gi} className="flex items-center justify-between text-[10px]">
                                                                                <div className="flex items-center gap-1.5 text-slate-500 w-32">
                                                                                    <div className="w-1 h-1 rounded-full bg-slate-300"></div>
                                                                                    <span className="truncate">{g.name || g.code}</span>
                                                                                </div>
                                                                                <span className="font-semibold text-slate-600">
                                                                                    {renderWeight(g.weight_kg)} <span className="opacity-40 uppercase text-[8px]">KG</span>
                                                                                </span>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )
                                                    })
                                                ) : (
                                                    <div className="p-4 text-center border border-dashed rounded bg-slate-50 text-slate-400 text-[10px] italic">
                                                        No BOM resolved. Check recipe selection.
                                                    </div>
                                                )}

                                                {/* Render Inks, Chems, Addons below the layers */}
                                                {['inks', 'chemicals', 'addons', 'pod'].flatMap(k => activePreview.bom?.[k] || []).length > 0 && (
                                                    <div className="mt-4 pt-3 border-t border-slate-200 border-dashed space-y-1">
                                                        {['inks', 'chemicals', 'addons', 'pod'].flatMap(category =>
                                                            (activePreview.bom?.[category] || []).map((c: any, ci: number) => {
                                                                const isRollPreview = String((form.getValues() as any).fg_type || "POUCH").toUpperCase() === "ROLL"
                                                                const simQty = isRollPreview
                                                                    ? 1
                                                                    : (form.getValues() as any).qty_uom === "KG"
                                                                    ? (previewUnitWeight > 0
                                                                        ? (Number((form.getValues() as any).qty_value || 0) * 1000) / previewUnitWeight
                                                                        : 0)
                                                                    : Number((form.getValues() as any).qty_value || 0)

                                                                const isArtworkSelected = !!form.watch("printing.artwork_id")
                                                                const displayLabel = (category === "inks" && isArtworkSelected && c.color)
                                                                    ? c.color
                                                                    : (c.name || c.code)

                                                                return (
                                                                    <div key={`${category}-${ci}`} className="flex items-center justify-between text-[11px] px-2 py-1">
                                                                        <span className="text-slate-500 font-medium truncate w-32">{displayLabel}</span>
                                                                        <span className="font-semibold text-slate-700">
                                                                            {(c.weight_kg * simQty).toFixed(4)} <span className="opacity-50 uppercase text-[9px]">KG</span>
                                                                        </span>
                                                                    </div>
                                                                )
                                                            })
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        <div className="space-y-3">
                                            <div className="flex items-center justify-between">
                                                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter">Planned Issue</p>
                                                {activePreview.bom_preview?.planning_summary && (
                                                    <Badge variant="outline" className="text-[9px] h-4 border-blue-200 text-blue-700 bg-blue-50">
                                                        {Number(activePreview.bom_preview.planning_summary.planned_issue_total_qty || 0).toFixed(3)} KG planned
                                                    </Badge>
                                                )}
                                            </div>
                                            <div className="space-y-1.5 max-h-40 overflow-y-auto">
                                                {activePreview.bom_preview?.planned_issue_lines?.length > 0 ? (
                                                    activePreview.bom_preview.planned_issue_lines.map((line: any, i: number) => (
                                                        <div key={`planned-${i}`} className="rounded border border-slate-100 bg-slate-50 p-2 space-y-1">
                                                            <div className="flex items-center justify-between text-[11px]">
                                                                <span className="text-slate-700 font-bold truncate w-32">{line.material_name}</span>
                                                                <span className="font-bold text-slate-800">
                                                                    {Number(line.planned_issue_qty || 0).toFixed(4)} <span className="opacity-50 uppercase text-[9px]">KG</span>
                                                                </span>
                                                            </div>
                                                            <div className="text-[9px] text-slate-500">
                                                                Default {line.template_issue_policy_mode}
                                                                {line.override_issue_policy_mode ? ` • Override ${line.override_issue_policy_mode}` : ""}
                                                                {line.policy_source ? ` • ${line.policy_source}` : ""}
                                                            </div>
                                                        </div>
                                                    ))
                                                ) : (
                                                    <div className="p-4 text-center border border-dashed rounded bg-slate-50 text-slate-400 text-[10px] italic">
                                                        Planned issue will appear once theory resolves.
                                                    </div>
                                                )}
                                            </div>
                                            <p className="text-[9px] text-slate-400 italic">Actual usage is captured during execution.</p>
                                        </div>

                                        <div className="pt-4 border-t space-y-3">
                                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">Governance Engine</p>
                                            {mode === "TEMPLATE" && (
                                                <div className="flex items-center gap-2 text-green-600 bg-green-50 p-2 rounded border border-green-100">
                                                    <CheckCircle2 className="h-3 w-3 shrink-0" />
                                                    <span className="text-[10px] font-bold leading-tight uppercase">Inherited from LIVE Master</span>
                                                </div>
                                            )}
                                            {mode === "REPEAT" && (
                                                <div className="flex items-center gap-2 text-blue-600 bg-blue-50 p-2 rounded border border-blue-100">
                                                    <Settings className="h-3 w-3 shrink-0" />
                                                    <span className="text-[10px] font-bold leading-tight uppercase">Cloned from Previous Job</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="py-20 flex flex-col items-center justify-center text-slate-200 gap-4">
                                        <Loader2 className="h-8 w-8 animate-spin opacity-40 text-primary/20" />
                                        <p className="text-[10px] font-bold uppercase tracking-widest text-center text-slate-400">Awaiting Valid Input<br />for Cloud Physics sync...</p>
                                    </div>
                                )}
                            </CardContent>
                            <CardFooter className="bg-slate-50/50 p-3 border-t">
                                <div className="w-full space-y-1">
                                    <div className="flex justify-between items-center text-[10px]">
                                        <span className="text-slate-400 font-bold uppercase tracking-wider">Sync Integrity</span>
                                        <Badge className={`text-[9px] px-1 h-4 uppercase font-black ${activePreview ? 'bg-green-500 text-white' : 'bg-slate-200 text-slate-400'}`}>
                                            {activePreview ? 'ACTIVE' : 'OFFLINE'}
                                        </Badge>
                                    </div>
                                    <p className="text-[9px] text-muted-foreground leading-tight italic opacity-70">
                                        Hard validation enforced. Calculation fails on invalid geometry.
                                    </p>
                                </div>
                            </CardFooter>
                        </Card>
                    </div>

                </form>
            </Form>
        </div>
    )
}

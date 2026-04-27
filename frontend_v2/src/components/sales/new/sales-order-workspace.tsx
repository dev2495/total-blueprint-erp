"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
    Copy,
    Loader2,
    Package,
    Plus,
    Repeat2,
    Save,
    Search,
    ShoppingCart,
    Sparkles,
    Trash2,
    Wand2,
} from "lucide-react"
import { useRouter } from "next/navigation"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useToast } from "@/hooks/use-toast"
import { filmFamilyService } from "@/services/film-families"
import { filmVariantService } from "@/services/film-variants"
import { engineeringService } from "@/services/engineering"
import { masterDataService } from "@/services/master-data"
import { recipeService } from "@/services/recipes"
import {
    type PreviewResult,
    type RepeatLineCandidate,
    type SalesSku,
    type SalesSkuVariant,
    salesService,
} from "@/services/sales"
import { templateService } from "@/services/templates"

type LineSource = "SKU" | "REPEAT" | "ADVANCED"

type AdjustmentDraft = {
    localId: string
    name: string
    value: number
    impact: "WIDTH" | "HEIGHT" | "BOTH"
}

type LayerDraft = {
    localId: string
    family_id: string
    variant_id: string
    grade_id?: string | null
    thickness_micron: number
    roll_width_mm: number
}

type AddonDraft = {
    localId: string
    addon_id: string
    qty: number
    applies_to: "WIDTH" | "HEIGHT" | "NONE" | "PER_PIECE" | "FIXED"
}

type PackagingLine = {
    material_id: string
    qty: number
    uom: "PCS" | "KG" | "METER"
    basis: "PER_ROLL"
}

type OrderLineDraft = {
    localId: string
    sourceType: LineSource
    advancedUnlocked: boolean
    skuVariantId: string
    repeatSourceItemId: string
    template_id: string
    line_name: string
    finished_good_type: "POUCH" | "ROLL"
    roll_form: "FLAT" | "FOLDED" | "TUBING" | ""
    qty_value: number
    qty_uom: "PCS" | "KG"
    price_basis: "PCS" | "KG"
    unit_price: number
    geometry: {
        base: {
            width_mm: number
            height_mm: number
        }
        adjustments: AdjustmentDraft[]
        multipliers: {
            faces: number
        }
    }
    film_layers: LayerDraft[]
    printing: {
        enabled: boolean
        type: "FLEXO" | "ROTO" | "DIGITAL"
        substrate_mode: "SHEET" | "TUBING"
        front_colors_count: number
        back_colors_count: number
        ink_gsm_total: number
        artwork_id: string
        defer_artwork_to_planner: boolean
    }
    chemicals: {
        adhesive_gsm: number
        solvent_gsm: number
    }
    addons: AddonDraft[]
    packaging_snapshot: {
        primary_inner_pack: {
            enabled: boolean
            material_id: string
            pcs_per_pack: number
        }
        pod: {
            enabled: boolean
            pod_profile_id: string
        }
        roll_dispatch_pack: {
            enabled: boolean
            lines: PackagingLine[]
        }
    }
    savedPreview?: PreviewResult | null
}

type SaveSkuForm = {
    skuId: string
    newSkuCode: string
    newSkuName: string
    variantCode: string
    variantName: string
}

function makeId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID()
    return `tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function asNumber(value: unknown, fallback = 0) {
    const num = Number(value)
    return Number.isFinite(num) ? num : fallback
}

function formatMoney(value: number | undefined) {
    return `₹${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function makeAdjustment(): AdjustmentDraft {
    return { localId: makeId(), name: "", value: 0, impact: "WIDTH" }
}

function makeLayer(): LayerDraft {
    return { localId: makeId(), family_id: "", variant_id: "", grade_id: null, thickness_micron: 0, roll_width_mm: 0 }
}

function makeAddon(): AddonDraft {
    return { localId: makeId(), addon_id: "", qty: 1, applies_to: "PER_PIECE" }
}

function emptyAdvancedLine(): OrderLineDraft {
    return {
        localId: makeId(),
        sourceType: "ADVANCED",
        advancedUnlocked: true,
        skuVariantId: "",
        repeatSourceItemId: "",
        template_id: "",
        line_name: "New order line",
        finished_good_type: "POUCH",
        roll_form: "",
        qty_value: 1000,
        qty_uom: "PCS",
        price_basis: "PCS",
        unit_price: 0,
        geometry: {
            base: { width_mm: 120, height_mm: 180 },
            adjustments: [],
            multipliers: { faces: 1 },
        },
        film_layers: [makeLayer()],
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
        chemicals: { adhesive_gsm: 0, solvent_gsm: 0 },
        addons: [],
        packaging_snapshot: {
            primary_inner_pack: { enabled: false, material_id: "", pcs_per_pack: 100 },
            pod: { enabled: false, pod_profile_id: "" },
            roll_dispatch_pack: { enabled: false, lines: [] },
        },
        savedPreview: null,
    }
}

function lineFromVariant(sku: SalesSku, variant: SalesSkuVariant): OrderLineDraft {
    const geometry = variant.geometry_snapshot || {}
    const base = geometry?.base || {}
    const printing = variant.printing_snapshot || {}
    const chemicals = variant.chemicals_snapshot || printing?.chemicals || {}
    return {
        localId: makeId(),
        sourceType: "SKU",
        advancedUnlocked: false,
        skuVariantId: variant.id,
        repeatSourceItemId: "",
        template_id: variant.template || sku.template,
        line_name: variant.name || sku.default_line_name || sku.name,
        finished_good_type: (variant.finished_good_type || "POUCH") as "POUCH" | "ROLL",
        roll_form: (variant.roll_form || "") as OrderLineDraft["roll_form"],
        qty_value: 1000,
        qty_uom: variant.finished_good_type === "ROLL" ? "KG" : "PCS",
        price_basis: variant.finished_good_type === "ROLL" ? "KG" : "PCS",
        unit_price: 0,
        geometry: {
            base: {
                width_mm: asNumber(base?.width_mm || geometry?.width_mm, 0),
                height_mm: asNumber(base?.height_mm || geometry?.height_mm, 0),
            },
            adjustments: Array.isArray(geometry?.adjustments)
                ? geometry.adjustments.map((row: any) => ({
                    localId: makeId(),
                    name: String(row?.name || ""),
                    value: asNumber(row?.value, 0),
                    impact: (String(row?.impact || "WIDTH").toUpperCase() as AdjustmentDraft["impact"]),
                }))
                : [],
            multipliers: { faces: asNumber(geometry?.multipliers?.faces, 1) },
        },
        film_layers: Array.isArray(variant.layer_snapshot) && variant.layer_snapshot.length
            ? variant.layer_snapshot.map((row: any) => ({
                localId: makeId(),
                family_id: String(row?.family_id || ""),
                variant_id: String(row?.variant_id || ""),
                grade_id: row?.grade_id ? String(row.grade_id) : null,
                thickness_micron: asNumber(row?.thickness_micron, 0),
                roll_width_mm: asNumber(row?.roll_width_mm || row?.width_mm, 0),
            }))
            : [makeLayer()],
        printing: {
            enabled: Boolean(printing?.enabled),
            type: (String(printing?.type || "FLEXO").toUpperCase() as OrderLineDraft["printing"]["type"]),
            substrate_mode: (String(printing?.substrate_mode || "SHEET").toUpperCase() as OrderLineDraft["printing"]["substrate_mode"]),
            front_colors_count: asNumber(printing?.front_colors_count, 0),
            back_colors_count: asNumber(printing?.back_colors_count, 0),
            ink_gsm_total: asNumber(printing?.ink_gsm_total, 0),
            artwork_id: String(printing?.artwork_id || ""),
            defer_artwork_to_planner: Boolean(printing?.defer_artwork_to_planner),
        },
        chemicals: {
            adhesive_gsm: asNumber(chemicals?.adhesive_gsm, 0),
            solvent_gsm: asNumber(chemicals?.solvent_gsm, 0),
        },
        addons: Array.isArray(variant.addons_snapshot)
            ? variant.addons_snapshot.map((row: any) => ({
                localId: makeId(),
                addon_id: String(row?.addon_id || ""),
                qty: asNumber(row?.qty, 1),
                applies_to: (String(row?.applies_to || row?.weight_mode || "PER_PIECE").toUpperCase() as AddonDraft["applies_to"]),
            }))
            : [],
        packaging_snapshot: normalizePackagingSnapshot(variant.packaging_snapshot),
        savedPreview: null,
    }
}

function lineFromRepeat(candidate: RepeatLineCandidate): OrderLineDraft {
    const geometry = candidate.geometry_snapshot || {}
    const base = geometry?.base || {}
    const printing = candidate.printing_snapshot || {}
    return {
        localId: makeId(),
        sourceType: "REPEAT",
        advancedUnlocked: false,
        skuVariantId: candidate.sku_variant_id || "",
        repeatSourceItemId: candidate.id,
        template_id: candidate.template_id,
        line_name: candidate.line_name || candidate.template_name,
        finished_good_type: (candidate.summary?.finished_good_type || "POUCH") as "POUCH" | "ROLL",
        roll_form: (candidate.summary?.roll_form || "") as OrderLineDraft["roll_form"],
        qty_value: asNumber(candidate.qty_value, 0),
        qty_uom: candidate.qty_uom,
        price_basis: candidate.price_basis,
        unit_price: asNumber(candidate.unit_price, 0),
        geometry: {
            base: {
                width_mm: asNumber(base?.width_mm || geometry?.width_mm, 0),
                height_mm: asNumber(base?.height_mm || geometry?.height_mm, 0),
            },
            adjustments: Array.isArray(geometry?.adjustments)
                ? geometry.adjustments.map((row: any) => ({
                    localId: makeId(),
                    name: String(row?.name || ""),
                    value: asNumber(row?.value, 0),
                    impact: (String(row?.impact || "WIDTH").toUpperCase() as AdjustmentDraft["impact"]),
                }))
                : [],
            multipliers: { faces: asNumber(geometry?.multipliers?.faces, 1) },
        },
        film_layers: Array.isArray(candidate.layer_snapshot) && candidate.layer_snapshot.length
            ? candidate.layer_snapshot.map((row: any) => ({
                localId: makeId(),
                family_id: String(row?.family_id || ""),
                variant_id: String(row?.variant_id || ""),
                grade_id: row?.grade_id ? String(row.grade_id) : null,
                thickness_micron: asNumber(row?.thickness_micron, 0),
                roll_width_mm: asNumber(row?.roll_width_mm || row?.width_mm, 0),
            }))
            : [makeLayer()],
        printing: {
            enabled: Boolean(printing?.enabled),
            type: (String(printing?.type || "FLEXO").toUpperCase() as OrderLineDraft["printing"]["type"]),
            substrate_mode: (String(printing?.substrate_mode || "SHEET").toUpperCase() as OrderLineDraft["printing"]["substrate_mode"]),
            front_colors_count: asNumber(printing?.front_colors_count, 0),
            back_colors_count: asNumber(printing?.back_colors_count, 0),
            ink_gsm_total: asNumber(printing?.ink_gsm_total, 0),
            artwork_id: String(printing?.artwork_id || ""),
            defer_artwork_to_planner: Boolean(printing?.defer_artwork_to_planner),
        },
        chemicals: {
            adhesive_gsm: asNumber(candidate.chemicals_snapshot?.adhesive_gsm, 0),
            solvent_gsm: asNumber(candidate.chemicals_snapshot?.solvent_gsm, 0),
        },
        addons: Array.isArray(candidate.addons_snapshot)
            ? candidate.addons_snapshot.map((row: any) => ({
                localId: makeId(),
                addon_id: String(row?.addon_id || ""),
                qty: asNumber(row?.qty, 1),
                applies_to: (String(row?.applies_to || row?.weight_mode || "PER_PIECE").toUpperCase() as AddonDraft["applies_to"]),
            }))
            : [],
        packaging_snapshot: normalizePackagingSnapshot(candidate.packaging_snapshot),
        savedPreview: null,
    }
}

function normalizePackagingSnapshot(snapshot: any): OrderLineDraft["packaging_snapshot"] {
    const source = snapshot || {}
    const primary = source?.primary_inner_pack || {}
    const pod = source?.pod || {}
    const rollDispatch = source?.roll_dispatch_pack || {}
    return {
        primary_inner_pack: {
            enabled: Boolean(primary?.enabled),
            material_id: String(primary?.material_id || ""),
            pcs_per_pack: asNumber(primary?.pcs_per_pack, 100),
        },
        pod: {
            enabled: Boolean(pod?.enabled),
            pod_profile_id: String(pod?.pod_profile_id || ""),
        },
        roll_dispatch_pack: {
            enabled: Boolean(rollDispatch?.enabled),
            lines: Array.isArray(rollDispatch?.lines)
                ? rollDispatch.lines.map((row: any) => ({
                    material_id: String(row?.material_id || ""),
                    qty: asNumber(row?.qty, 0),
                    uom: (String(row?.uom || "PCS").toUpperCase() as PackagingLine["uom"]),
                    basis: "PER_ROLL",
                }))
                : [],
        },
    }
}

function GradeSelector({
    variantId,
    value,
    onChange,
}: {
    variantId: string
    value?: string | null
    onChange: (val: string) => void
}) {
    const { data: grades = [], isLoading } = useQuery({
        queryKey: ["variant-grades", variantId],
        queryFn: () => recipeService.getGrades(variantId),
        enabled: Boolean(variantId),
    })

    if (!variantId) {
        return <div className="text-[10px] text-slate-400 italic">Select variant first</div>
    }
    if (isLoading) {
        return <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
    }
    return (
        <Select value={value || ""} onValueChange={onChange}>
            <SelectTrigger className="h-8 text-xs bg-white">
                <SelectValue placeholder="Select grade" />
            </SelectTrigger>
            <SelectContent>
                {grades.map((grade: any) => (
                    <SelectItem key={grade.id} value={String(grade.id)}>
                        {grade.name}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    )
}

function lineSourceTone(sourceType: LineSource) {
    if (sourceType === "SKU") return "bg-emerald-50 text-emerald-700 border-emerald-200"
    if (sourceType === "REPEAT") return "bg-blue-50 text-blue-700 border-blue-200"
    return "bg-amber-50 text-amber-700 border-amber-200"
}

export default function SalesOrderWorkspace() {
    const router = useRouter()
    const queryClient = useQueryClient()
    const { toast } = useToast()
    const [customerId, setCustomerId] = useState("")
    const [customerName, setCustomerName] = useState("")
    const [orderName, setOrderName] = useState("")
    const [deliveryDate, setDeliveryDate] = useState(new Date().toISOString().slice(0, 10))
    const [lines, setLines] = useState<OrderLineDraft[]>([])
    const [activeLineId, setActiveLineId] = useState("")
    const [previewError, setPreviewError] = useState("")
    const [previewLoading, setPreviewLoading] = useState(false)
    const [addSkuOpen, setAddSkuOpen] = useState(false)
    const [addRepeatOpen, setAddRepeatOpen] = useState(false)
    const [saveSkuOpen, setSaveSkuOpen] = useState(false)
    const [selectedSkuId, setSelectedSkuId] = useState("")
    const [selectedVariantId, setSelectedVariantId] = useState("")
    const [repeatSearch, setRepeatSearch] = useState("")
    const [saveSkuForm, setSaveSkuForm] = useState<SaveSkuForm>({
        skuId: "__NEW__",
        newSkuCode: "",
        newSkuName: "",
        variantCode: "",
        variantName: "",
    })

    const activeLine = lines.find((line) => line.localId === activeLineId) || null
    const activeTemplate = activeLine?.template_id || ""
    const activeFgType = activeLine?.finished_good_type || "POUCH"
    const activePrinting = activeLine?.printing || {
        enabled: false,
        type: "FLEXO",
        substrate_mode: "SHEET",
        front_colors_count: 0,
        back_colors_count: 0,
        ink_gsm_total: 0,
        artwork_id: "",
        defer_artwork_to_planner: false,
    }

    const { data: customers = [] } = useQuery({ queryKey: ["customers"], queryFn: masterDataService.getCustomers })
    const { data: templates = [] } = useQuery({ queryKey: ["templates", "live-only"], queryFn: () => templateService.getTemplates({ status: "LIVE" }) })
    const { data: families = [] } = useQuery({ queryKey: ["film-families"], queryFn: filmFamilyService.getAll })
    const { data: variants = [] } = useQuery({ queryKey: ["film-variants"], queryFn: filmVariantService.getAll })
    const { data: addonsMaster = [] } = useQuery({ queryKey: ["addons"], queryFn: masterDataService.getAddons })
    const { data: packagingMaterials = [] } = useQuery({ queryKey: ["packaging-materials"], queryFn: masterDataService.getPackaging })
    const { data: podProfiles = [] } = useQuery({ queryKey: ["pod-profiles"], queryFn: masterDataService.getPODMaterials })
    const { data: salesSkus = [] } = useQuery({
        queryKey: ["sales-skus", customerId],
        queryFn: () => salesService.getSalesSkus({ customer_id: customerId || undefined, active: true }),
    })
    const { data: skuVariants = [] } = useQuery({
        queryKey: ["sales-sku-variants", selectedSkuId, customerId],
        queryFn: () => salesService.getSalesSkuVariants({ sku_id: selectedSkuId || undefined, customer_id: customerId || undefined, active: true }),
        enabled: Boolean(selectedSkuId),
    })
    const { data: repeatLines = [] } = useQuery({
        queryKey: ["sales-repeat-lines", customerId, repeatSearch],
        queryFn: () => salesService.getRepeatLines({ customer_id: customerId || undefined, q: repeatSearch || undefined }),
        enabled: Boolean(customerId),
    })
    const { data: artworks = [] } = useQuery({
        queryKey: [
            "engineering-artworks",
            activePrinting.type,
            activePrinting.front_colors_count,
            activePrinting.back_colors_count,
            activePrinting.enabled,
            activePrinting.defer_artwork_to_planner,
        ],
        queryFn: () => engineeringService.getArtworks({
            status: "APPROVED",
            print_type: activePrinting.type,
            front_colors_count: activePrinting.front_colors_count,
            back_colors_count: activePrinting.back_colors_count,
            cylinder_ready: activePrinting.type === "ROTO" ? "true" : undefined,
            exclude_cylinder_artwork: activePrinting.type === "FLEXO" ? "true" : undefined,
        }),
        enabled: Boolean(activePrinting.enabled && !activePrinting.defer_artwork_to_planner),
    })

    useEffect(() => {
        if (!activeLineId && lines.length) {
            setActiveLineId(lines[0].localId)
        }
    }, [activeLineId, lines])

    useEffect(() => {
        if (!activeLine || !activeLine.template_id) {
            setPreviewError("")
            return
        }
        const handle = window.setTimeout(async () => {
            try {
                setPreviewLoading(true)
                setPreviewError("")
                const preview = await salesService.previewItem(buildPreviewPayload(activeLine, families, variants, addonsMaster))
                setLines((current) => current.map((line) => line.localId === activeLine.localId ? { ...line, savedPreview: preview } : line))
            } catch (error: any) {
                setPreviewError(error?.response?.data?.detail || error?.message || "Unable to calculate preview.")
            } finally {
                setPreviewLoading(false)
            }
        }, 450)
        return () => window.clearTimeout(handle)
    }, [activeLine, families, variants, addonsMaster])

    const saveOrderMutation = useMutation({
        mutationFn: async () => {
            if (!customerId) throw new Error("Customer is required.")
            if (!lines.length) throw new Error("Add at least one line.")
            const layerErrors = lines.flatMap((line) => validateLayerStack(line, variants))
            if (layerErrors.length) throw new Error(layerErrors.slice(0, 3).join(" "))
            const payload = {
                customer: customerId,
                customer_name: customerName,
                order_name: orderName,
                order_type: "MTO",
                delivery_date: deliveryDate || null,
                items: lines.map((line) => buildOrderItemPayload(line, families, variants, addonsMaster)),
            }
            const order = await salesService.createOrder(payload)
            await salesService.confirmOrder(order.id)
            return order
        },
        onSuccess: (order) => {
            queryClient.invalidateQueries({ queryKey: ["sales-orders"] })
            toast({ title: "Sales order created", description: `${order.order_number} is now ready for planner intake.` })
            router.push("/sales/orders")
        },
        onError: (error: any) => {
            toast({
                title: "Save failed",
                description: error?.response?.data?.detail || error?.message || "Could not create the sales order.",
                variant: "destructive",
            })
        },
    })

    const saveSkuMutation = useMutation({
        mutationFn: async () => {
            if (!activeLine || !activeLine.template_id) throw new Error("Select a line with a LIVE template first.")
            const layerErrors = validateLayerStack(activeLine, variants)
            if (layerErrors.length) throw new Error(layerErrors.slice(0, 3).join(" "))
            let skuId = saveSkuForm.skuId
            if (!skuId || skuId === "__NEW__") {
                if (!saveSkuForm.newSkuCode.trim() || !saveSkuForm.newSkuName.trim()) {
                    throw new Error("New SKU code and name are required.")
                }
                const sku = await salesService.createSalesSku({
                    code: saveSkuForm.newSkuCode.trim().toUpperCase(),
                    name: saveSkuForm.newSkuName.trim(),
                    template: activeLine.template_id,
                    default_line_name: activeLine.line_name,
                    active: true,
                })
                skuId = sku.id
            }
            if (!saveSkuForm.variantCode.trim() || !saveSkuForm.variantName.trim()) {
                throw new Error("Variant code and variant name are required.")
            }
            return salesService.createSalesSkuVariant({
                sku: skuId,
                code: saveSkuForm.variantCode.trim().toUpperCase(),
                name: saveSkuForm.variantName.trim(),
                active: true,
                finished_good_type: activeLine.finished_good_type,
                roll_form: activeLine.roll_form,
                geometry_snapshot: activeLine.geometry,
                layer_snapshot: activeLine.film_layers,
                printing_snapshot: {
                    ...activeLine.printing,
                    chemicals: activeLine.chemicals,
                },
                chemicals_snapshot: activeLine.chemicals,
                addons_snapshot: activeLine.addons,
                packaging_snapshot: activeLine.packaging_snapshot,
            })
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["sales-skus"] })
            queryClient.invalidateQueries({ queryKey: ["sales-sku-variants"] })
            toast({ title: "SKU variant saved", description: "This line is now available in the fast-entry catalog." })
            setSaveSkuOpen(false)
        },
        onError: (error: any) => {
            toast({
                title: "SKU save failed",
                description: error?.response?.data?.detail || error?.message || "Could not save the SKU variant.",
                variant: "destructive",
            })
        },
    })

    const totalEstimatedWeightKg = lines.reduce((sum, line) => sum + asNumber(line.savedPreview?.total_weight_kg, 0), 0)
    const totalEstimatedValue = lines.reduce((sum, line) => {
        const qtyBasis = line.price_basis === "KG"
            ? asNumber(line.savedPreview?.total_weight_kg, 0)
            : asNumber(line.qty_value, 0)
        return sum + (qtyBasis * asNumber(line.unit_price, 0))
    }, 0)

    const handleCustomerChange = (value: string) => {
        setCustomerId(value)
        const customer = customers.find((row) => row.id === value)
        setCustomerName(customer?.name || "")
    }

    const updateLine = (lineId: string, updater: (line: OrderLineDraft) => OrderLineDraft) => {
        setLines((current) => current.map((line) => line.localId === lineId ? updater(line) : line))
    }

    const addLine = (line: OrderLineDraft) => {
        setLines((current) => [...current, line])
        setActiveLineId(line.localId)
    }

    const duplicateLine = (lineId: string) => {
        const source = lines.find((line) => line.localId === lineId)
        if (!source) return
        const clone: OrderLineDraft = {
            ...source,
            localId: makeId(),
            line_name: `${source.line_name} Copy`,
            savedPreview: null,
            geometry: {
                ...source.geometry,
                adjustments: source.geometry.adjustments.map((row) => ({ ...row, localId: makeId() })),
            },
            film_layers: source.film_layers.map((row) => ({ ...row, localId: makeId() })),
            addons: source.addons.map((row) => ({ ...row, localId: makeId() })),
            packaging_snapshot: {
                ...source.packaging_snapshot,
                roll_dispatch_pack: {
                    ...source.packaging_snapshot.roll_dispatch_pack,
                    lines: source.packaging_snapshot.roll_dispatch_pack.lines.map((row) => ({ ...row })),
                },
            },
        }
        addLine(clone)
    }

    const removeLine = (lineId: string) => {
        const remaining = lines.filter((line) => line.localId !== lineId)
        setLines(remaining)
        if (activeLineId === lineId) {
            setActiveLineId(remaining[0]?.localId || "")
        }
    }

    const selectedSku = salesSkus.find((row) => row.id === selectedSkuId) || null
    const selectedVariant = skuVariants.find((row) => row.id === selectedVariantId) || selectedSku?.variants?.find((row) => row.id === selectedVariantId) || null

    return (
        <div className="min-h-screen bg-slate-50/50 p-4 md:p-6">
            <div className="mx-auto max-w-[1700px] space-y-6">
                <Card className="border-slate-200 shadow-sm">
                    <CardHeader className="border-b border-slate-100">
                        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                            <div>
                                <CardTitle className="text-2xl font-black tracking-tight text-slate-900">Sales Order Fast Entry</CardTitle>
                                <CardDescription>
                                    Customer-first order cart with shared SKU variants, line-level repeat reuse, and advanced edit only when needed.
                                </CardDescription>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <Button variant="outline" asChild>
                                    <Link href="/sales/orders">Back to Orders</Link>
                                </Button>
                                <Button onClick={() => saveOrderMutation.mutate()} disabled={saveOrderMutation.isPending}>
                                    {saveOrderMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                                    Save Sales Order
                                </Button>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent className="grid gap-4 pt-6 md:grid-cols-2 xl:grid-cols-5">
                        <div className="space-y-2">
                            <Label>Customer</Label>
                            <Select value={customerId} onValueChange={handleCustomerChange}>
                                <SelectTrigger className="bg-white">
                                    <SelectValue placeholder="Select customer" />
                                </SelectTrigger>
                                <SelectContent>
                                    {customers.map((customer) => (
                                        <SelectItem key={customer.id} value={customer.id}>
                                            {customer.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Order Name</Label>
                            <Input value={orderName} onChange={(event) => setOrderName(event.target.value)} placeholder="Optional commercial label" />
                        </div>
                        <div className="space-y-2">
                            <Label>Delivery Date</Label>
                            <Input type="date" value={deliveryDate} onChange={(event) => setDeliveryDate(event.target.value)} />
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                            <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Lines</div>
                            <div className="mt-1 text-2xl font-black text-slate-900">{lines.length}</div>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                            <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Estimated Weight</div>
                            <div className="mt-1 text-2xl font-black text-slate-900">{totalEstimatedWeightKg.toFixed(2)} KG</div>
                        </div>
                    </CardContent>
                </Card>

                <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)_360px]">
                    <Card className="border-slate-200 shadow-sm">
                        <CardHeader className="border-b border-slate-100">
                            <div className="flex items-center justify-between">
                                <div>
                                    <CardTitle className="text-base font-black">Order Cart</CardTitle>
                                    <CardDescription>Add lines from shared SKU, repeat lines, or advanced entry.</CardDescription>
                                </div>
                                <ShoppingCart className="h-5 w-5 text-slate-400" />
                            </div>
                            <div className="grid gap-2">
                                <Button variant="outline" onClick={() => setAddSkuOpen(true)} disabled={!customerId}>
                                    <Sparkles className="mr-2 h-4 w-4" /> Add Shared SKU
                                </Button>
                                <Button variant="outline" onClick={() => setAddRepeatOpen(true)} disabled={!customerId}>
                                    <Repeat2 className="mr-2 h-4 w-4" /> Add Repeat Line
                                </Button>
                                <Button variant="outline" onClick={() => addLine(emptyAdvancedLine())}>
                                    <Plus className="mr-2 h-4 w-4" /> Add Advanced Line
                                </Button>
                            </div>
                        </CardHeader>
                        <CardContent className="p-3">
                            <ScrollArea className="h-[720px] pr-2">
                                <div className="space-y-3">
                                    {lines.length === 0 ? (
                                        <div className="rounded-xl border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-500">
                                            Choose a customer, then start with a shared SKU, repeat line, or advanced line.
                                        </div>
                                    ) : null}
                                    {lines.map((line) => (
                                        <button
                                            key={line.localId}
                                            type="button"
                                            onClick={() => setActiveLineId(line.localId)}
                                            className={`w-full rounded-2xl border p-4 text-left transition ${activeLineId === line.localId ? "border-slate-900 bg-slate-900 text-white shadow-lg" : "border-slate-200 bg-white hover:border-slate-300"}`}
                                        >
                                            <div className="flex items-start justify-between gap-2">
                                                <div>
                                                    <div className="text-sm font-black">{line.line_name || "Untitled line"}</div>
                                                    <div className={`mt-2 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${activeLineId === line.localId ? "border-white/30 bg-white/10 text-white" : lineSourceTone(line.sourceType)}`}>
                                                        {line.sourceType}
                                                    </div>
                                                </div>
                                                <div className="text-right text-xs font-semibold">
                                                    <div>{line.qty_value} {line.qty_uom}</div>
                                                    <div>{formatMoney(line.unit_price)} / {line.price_basis}</div>
                                                </div>
                                            </div>
                                            <div className={`mt-3 text-xs ${activeLineId === line.localId ? "text-white/80" : "text-slate-500"}`}>
                                                {line.finished_good_type}
                                                {line.finished_good_type === "POUCH"
                                                    ? ` • ${line.geometry.base.width_mm}W x ${line.geometry.base.height_mm}H`
                                                    : ` • ${line.roll_form || "FLAT"}`}
                                                {line.packaging_snapshot.pod.enabled ? " • POD" : ""}
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </ScrollArea>
                        </CardContent>
                    </Card>

                    <div className="space-y-6">
                        {activeLine ? (
                            <>
                                <Card className="border-slate-200 shadow-sm">
                                    <CardHeader className="border-b border-slate-100">
                                        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                            <div>
                                                <CardTitle className="text-xl font-black">{activeLine.line_name || "Order Line"}</CardTitle>
                                                <CardDescription>
                                                    {activeLine.sourceType === "SKU" ? "Shared SKU fast-entry line" : activeLine.sourceType === "REPEAT" ? "Repeat-sourced line" : "Advanced template-driven line"}
                                                </CardDescription>
                                            </div>
                                            <div className="flex flex-wrap gap-2">
                                                <Button variant="outline" onClick={() => duplicateLine(activeLine.localId)}>
                                                    <Copy className="mr-2 h-4 w-4" /> Duplicate
                                                </Button>
                                                <Button variant="outline" onClick={() => setSaveSkuOpen(true)} disabled={!activeLine.template_id}>
                                                    <Save className="mr-2 h-4 w-4" /> Save as SKU Variant
                                                </Button>
                                                <Button variant="outline" className="text-rose-600" onClick={() => removeLine(activeLine.localId)}>
                                                    <Trash2 className="mr-2 h-4 w-4" /> Remove
                                                </Button>
                                            </div>
                                        </div>
                                    </CardHeader>
                                    <CardContent className="grid gap-4 pt-6 md:grid-cols-2 xl:grid-cols-5">
                                        <div className="space-y-2 xl:col-span-2">
                                            <Label>Line Name</Label>
                                            <Input value={activeLine.line_name} onChange={(event) => updateLine(activeLine.localId, (line) => ({ ...line, line_name: event.target.value, savedPreview: null }))} />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Template</Label>
                                            <Select
                                                value={activeLine.template_id || "__NONE__"}
                                                onValueChange={(value) => {
                                                    const selected = templates.find((template: any) => String(template.id) === value)
                                                    updateLine(activeLine.localId, (line) => ({
                                                        ...line,
                                                        template_id: value === "__NONE__" ? "" : value,
                                                        finished_good_type: String(selected?.fg_type || line.finished_good_type).toUpperCase() as "POUCH" | "ROLL",
                                                        qty_uom: String(selected?.fg_type || line.finished_good_type).toUpperCase() === "ROLL" ? "KG" : line.qty_uom,
                                                        price_basis: String(selected?.fg_type || line.finished_good_type).toUpperCase() === "ROLL" ? "KG" : line.price_basis,
                                                        roll_form: String(selected?.fg_type || line.finished_good_type).toUpperCase() === "ROLL" ? (line.roll_form || "FLAT") : "",
                                                        savedPreview: null,
                                                    }))
                                                }}
                                            >
                                                <SelectTrigger className="bg-white">
                                                    <SelectValue placeholder="Select LIVE template" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="__NONE__">Select template</SelectItem>
                                                    {templates.map((template: any) => (
                                                        <SelectItem key={template.id} value={String(template.id)}>
                                                            {template.name}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Target Qty</Label>
                                            <Input type="number" value={String(activeLine.qty_value)} onChange={(event) => updateLine(activeLine.localId, (line) => ({ ...line, qty_value: asNumber(event.target.value, 0), savedPreview: null }))} />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Qty UOM</Label>
                                            <Select
                                                value={activeLine.qty_uom}
                                                onValueChange={(value) => updateLine(activeLine.localId, (line) => ({
                                                    ...line,
                                                    qty_uom: line.finished_good_type === "ROLL" ? "KG" : (value as "PCS" | "KG"),
                                                    savedPreview: null,
                                                }))}
                                            >
                                                <SelectTrigger className="bg-white">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="KG">KG</SelectItem>
                                                    {activeLine.finished_good_type !== "ROLL" ? <SelectItem value="PCS">PCS</SelectItem> : null}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Price Basis</Label>
                                            <Select
                                                value={activeLine.price_basis}
                                                onValueChange={(value) => updateLine(activeLine.localId, (line) => ({
                                                    ...line,
                                                    price_basis: line.finished_good_type === "ROLL" ? "KG" : (value as "PCS" | "KG"),
                                                }))}
                                            >
                                                <SelectTrigger className="bg-white">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="KG">Per KG</SelectItem>
                                                    {activeLine.finished_good_type !== "ROLL" ? <SelectItem value="PCS">Per PCS</SelectItem> : null}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Unit Price</Label>
                                            <Input type="number" step="0.01" value={String(activeLine.unit_price)} onChange={(event) => updateLine(activeLine.localId, (line) => ({ ...line, unit_price: asNumber(event.target.value, 0) }))} />
                                        </div>
                                    </CardContent>
                                </Card>

                                {!activeLine.advancedUnlocked ? (
                                    <Card className="border-slate-200 shadow-sm">
                                        <CardHeader>
                                            <CardTitle className="text-base font-black">Fast Line Summary</CardTitle>
                                            <CardDescription>
                                                Technical structure is locked for speed. Convert to advanced only if sales must change product physics.
                                            </CardDescription>
                                        </CardHeader>
                                        <CardContent className="space-y-4">
                                            <div className="flex flex-wrap gap-2">
                                                <Badge variant="outline">{activeLine.finished_good_type}</Badge>
                                                {activeLine.finished_good_type === "POUCH" ? (
                                                    <Badge variant="outline">{activeLine.geometry.base.width_mm}W x {activeLine.geometry.base.height_mm}H</Badge>
                                                ) : (
                                                    <Badge variant="outline">{activeLine.roll_form || "FLAT"}</Badge>
                                                )}
                                                <Badge variant="outline">{activeLine.film_layers.length} layer(s)</Badge>
                                                {activeLine.printing.enabled ? <Badge variant="outline">{activeLine.printing.type} print</Badge> : <Badge variant="outline">No print</Badge>}
                                                {activeLine.packaging_snapshot.pod.enabled ? <Badge variant="outline">POD enabled</Badge> : null}
                                            </div>
                                            <Button
                                                variant="outline"
                                                onClick={() => updateLine(activeLine.localId, (line) => ({
                                                    ...line,
                                                    sourceType: "ADVANCED",
                                                    advancedUnlocked: true,
                                                    skuVariantId: "",
                                                    savedPreview: null,
                                                }))}
                                            >
                                                <Wand2 className="mr-2 h-4 w-4" /> Convert to Advanced Line
                                            </Button>
                                        </CardContent>
                                    </Card>
                                ) : (
                                    <Card className="border-slate-200 shadow-sm">
                                        <CardHeader className="border-b border-slate-100">
                                            <CardTitle className="text-base font-black">Advanced Line Editor</CardTitle>
                                            <CardDescription>Full technical control for exceptional lines only.</CardDescription>
                                        </CardHeader>
                                        <CardContent className="pt-6">
                                            <Tabs defaultValue="geometry">
                                                <TabsList className="grid h-auto w-full grid-cols-6">
                                                    <TabsTrigger value="geometry">Geometry</TabsTrigger>
                                                    <TabsTrigger value="stack">Stack</TabsTrigger>
                                                    <TabsTrigger value="printing">Print</TabsTrigger>
                                                    <TabsTrigger value="chemicals">Chems</TabsTrigger>
                                                    <TabsTrigger value="packaging">Packaging</TabsTrigger>
                                                    <TabsTrigger value="addons">Add-ons & POD</TabsTrigger>
                                                </TabsList>

                                                <TabsContent value="geometry" className="pt-4">
                                                    <div className="grid gap-4 md:grid-cols-2">
                                                        <div className="space-y-2">
                                                            <Label>Final Product Type</Label>
                                                            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold">
                                                                {activeLine.finished_good_type}
                                                            </div>
                                                        </div>
                                                        {activeLine.finished_good_type === "ROLL" ? (
                                                            <div className="space-y-2">
                                                                <Label>Roll Form</Label>
                                                                <Select value={activeLine.roll_form || "FLAT"} onValueChange={(value) => updateLine(activeLine.localId, (line) => ({ ...line, roll_form: value as OrderLineDraft["roll_form"], savedPreview: null }))}>
                                                                    <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                                                                    <SelectContent>
                                                                        <SelectItem value="FLAT">FLAT</SelectItem>
                                                                        <SelectItem value="FOLDED">FOLDED</SelectItem>
                                                                        <SelectItem value="TUBING">TUBING</SelectItem>
                                                                    </SelectContent>
                                                                </Select>
                                                            </div>
                                                        ) : (
                                                            <>
                                                                <div className="space-y-2">
                                                                    <Label>Width (mm)</Label>
                                                                    <Input type="number" value={String(activeLine.geometry.base.width_mm)} onChange={(event) => updateLine(activeLine.localId, (line) => ({ ...line, geometry: { ...line.geometry, base: { ...line.geometry.base, width_mm: asNumber(event.target.value, 0) } }, savedPreview: null }))} />
                                                                </div>
                                                                <div className="space-y-2">
                                                                    <Label>Height (mm)</Label>
                                                                    <Input type="number" value={String(activeLine.geometry.base.height_mm)} onChange={(event) => updateLine(activeLine.localId, (line) => ({ ...line, geometry: { ...line.geometry, base: { ...line.geometry.base, height_mm: asNumber(event.target.value, 0) } }, savedPreview: null }))} />
                                                                </div>
                                                            </>
                                                        )}
                                                        <div className="space-y-2">
                                                            <Label>Multi-up (Faces)</Label>
                                                            <Input type="number" min={1} value={String(activeLine.geometry.multipliers.faces)} onChange={(event) => updateLine(activeLine.localId, (line) => ({ ...line, geometry: { ...line.geometry, multipliers: { faces: Math.max(1, asNumber(event.target.value, 1)) } }, savedPreview: null }))} />
                                                        </div>
                                                    </div>
                                                    <div className="mt-4 space-y-3">
                                                        <div className="flex items-center justify-between">
                                                            <Label>Physical Adjustments</Label>
                                                            <Button variant="outline" size="sm" onClick={() => updateLine(activeLine.localId, (line) => ({ ...line, geometry: { ...line.geometry, adjustments: [...line.geometry.adjustments, makeAdjustment()] }, savedPreview: null }))}>
                                                                <Plus className="mr-2 h-4 w-4" /> Add Adjustment
                                                            </Button>
                                                        </div>
                                                        {activeLine.geometry.adjustments.map((adjustment, index) => (
                                                            <div key={adjustment.localId} className="grid gap-2 md:grid-cols-[1fr_120px_160px_40px]">
                                                                <Input value={adjustment.name} onChange={(event) => updateLine(activeLine.localId, (line) => ({ ...line, geometry: { ...line.geometry, adjustments: line.geometry.adjustments.map((row, rowIndex) => rowIndex === index ? { ...row, name: event.target.value } : row) }, savedPreview: null }))} placeholder="Adjustment name" />
                                                                <Input type="number" value={String(adjustment.value)} onChange={(event) => updateLine(activeLine.localId, (line) => ({ ...line, geometry: { ...line.geometry, adjustments: line.geometry.adjustments.map((row, rowIndex) => rowIndex === index ? { ...row, value: asNumber(event.target.value, 0) } : row) }, savedPreview: null }))} />
                                                                <Select value={adjustment.impact} onValueChange={(value) => updateLine(activeLine.localId, (line) => ({ ...line, geometry: { ...line.geometry, adjustments: line.geometry.adjustments.map((row, rowIndex) => rowIndex === index ? { ...row, impact: value as AdjustmentDraft["impact"] } : row) }, savedPreview: null }))}>
                                                                    <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                                                                    <SelectContent>
                                                                        <SelectItem value="WIDTH">WIDTH</SelectItem>
                                                                        <SelectItem value="HEIGHT">HEIGHT</SelectItem>
                                                                        <SelectItem value="BOTH">BOTH</SelectItem>
                                                                    </SelectContent>
                                                                </Select>
                                                                <Button variant="ghost" size="icon" className="text-rose-600" onClick={() => updateLine(activeLine.localId, (line) => ({ ...line, geometry: { ...line.geometry, adjustments: line.geometry.adjustments.filter((_, rowIndex) => rowIndex !== index) }, savedPreview: null }))}>
                                                                    <Trash2 className="h-4 w-4" />
                                                                </Button>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </TabsContent>

                                                <TabsContent value="stack" className="pt-4">
                                                    <div className="space-y-3">
                                                        <div className="flex items-center justify-between">
                                                            <Label>Lamination Stack</Label>
                                                            <Button variant="outline" size="sm" onClick={() => updateLine(activeLine.localId, (line) => ({ ...line, film_layers: [...line.film_layers, makeLayer()], savedPreview: null }))}>
                                                                <Plus className="mr-2 h-4 w-4" /> Add Layer
                                                            </Button>
                                                        </div>
                                                        {activeLine.film_layers.map((layer, index) => {
                                                            const familyVariants = variants.filter((variant: any) => String(variant?.parent_family?.id || variant?.parent_family || "") === String(layer.family_id))
                                                            const selectedVariant = variants.find((variant: any) => String(variant.id) === String(layer.variant_id))
                                                            const selectedFamily = families.find((family: any) => String(family.id) === String(layer.family_id))
                                                            return (
                                                                <div key={layer.localId} className="grid gap-3 rounded-2xl border border-blue-100 bg-blue-50/40 p-4 shadow-sm md:grid-cols-2 xl:grid-cols-6">
                                                                    <div className="md:col-span-2 xl:col-span-6">
                                                                        <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-white/80 bg-white/80 px-4 py-3">
                                                                            <div>
                                                                                <div className="text-[10px] font-black uppercase tracking-[0.22em] text-blue-500">Layer {index + 1}</div>
                                                                                <div className="mt-1 text-base font-black text-slate-950">
                                                                                    {selectedVariant?.name || selectedFamily?.name || "Select film variant"}
                                                                                </div>
                                                                                <div className="mt-1 text-xs font-semibold text-slate-500">
                                                                                    {selectedFamily?.name || "Family pending"} • {selectedVariant?.is_extrudable ? "grade required" : "grade optional"}
                                                                                </div>
                                                                            </div>
                                                                            <div className="flex flex-wrap gap-2">
                                                                                <Badge variant="outline" className="bg-white text-[10px]">Grade {layer.grade_id ? "set" : "pending"}</Badge>
                                                                                <Badge variant="outline" className="bg-white text-[10px]">{Number(layer.thickness_micron || 0)} μ</Badge>
                                                                                <Badge variant="outline" className="bg-white text-[10px]">{Number(layer.roll_width_mm || 0)} mm</Badge>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                    <div className="space-y-2">
                                                                        <Label>Family</Label>
                                                                        <Select value={layer.family_id || "__NONE__"} onValueChange={(value) => updateLine(activeLine.localId, (line) => ({ ...line, film_layers: line.film_layers.map((row, rowIndex) => rowIndex === index ? { ...row, family_id: value === "__NONE__" ? "" : value, variant_id: "", grade_id: null } : row), savedPreview: null }))}>
                                                                            <SelectTrigger className="bg-white"><SelectValue placeholder="Select family" /></SelectTrigger>
                                                                            <SelectContent>
                                                                                <SelectItem value="__NONE__">Select family</SelectItem>
                                                                                {families.map((family: any) => (
                                                                                    <SelectItem key={family.id} value={String(family.id)}>{family.name}</SelectItem>
                                                                                ))}
                                                                            </SelectContent>
                                                                        </Select>
                                                                    </div>
                                                                    <div className="space-y-2">
                                                                        <Label>Variant</Label>
                                                                        <Select value={layer.variant_id || "__NONE__"} onValueChange={(value) => updateLine(activeLine.localId, (line) => ({ ...line, film_layers: line.film_layers.map((row, rowIndex) => rowIndex === index ? { ...row, variant_id: value === "__NONE__" ? "" : value, grade_id: null } : row), savedPreview: null }))}>
                                                                            <SelectTrigger className="bg-white"><SelectValue placeholder="Select variant" /></SelectTrigger>
                                                                            <SelectContent>
                                                                                <SelectItem value="__NONE__">Select variant</SelectItem>
                                                                                {familyVariants.map((variant: any) => (
                                                                                    <SelectItem key={variant.id} value={String(variant.id)}>{variant.name}</SelectItem>
                                                                                ))}
                                                                            </SelectContent>
                                                                        </Select>
                                                                    </div>
                                                                    <div className="space-y-2">
                                                                        <Label>Thickness (micron)</Label>
                                                                        <Input type="number" value={String(layer.thickness_micron)} onChange={(event) => updateLine(activeLine.localId, (line) => ({ ...line, film_layers: line.film_layers.map((row, rowIndex) => rowIndex === index ? { ...row, thickness_micron: asNumber(event.target.value, 0) } : row), savedPreview: null }))} />
                                                                    </div>
                                                                    <div className="space-y-2">
                                                                        <Label>Roll Width (mm)</Label>
                                                                        <Input type="number" value={String(layer.roll_width_mm)} onChange={(event) => updateLine(activeLine.localId, (line) => ({ ...line, film_layers: line.film_layers.map((row, rowIndex) => rowIndex === index ? { ...row, roll_width_mm: asNumber(event.target.value, 0) } : row), savedPreview: null }))} />
                                                                    </div>
                                                                    <div className="space-y-2">
                                                                        <Label>Grade</Label>
                                                                        {selectedVariant?.is_extrudable ? (
                                                                            <GradeSelector
                                                                                variantId={String(layer.variant_id || "")}
                                                                                value={layer.grade_id}
                                                                                onChange={(value) => updateLine(activeLine.localId, (line) => ({ ...line, film_layers: line.film_layers.map((row, rowIndex) => rowIndex === index ? { ...row, grade_id: value } : row), savedPreview: null }))}
                                                                            />
                                                                        ) : (
                                                                            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-400">Not required</div>
                                                                        )}
                                                                    </div>
                                                                    <div className="flex items-end">
                                                                        <Button variant="outline" className="w-full text-rose-600" onClick={() => updateLine(activeLine.localId, (line) => ({ ...line, film_layers: line.film_layers.filter((_, rowIndex) => rowIndex !== index), savedPreview: null }))} disabled={activeLine.film_layers.length === 1}>
                                                                            Remove
                                                                        </Button>
                                                                    </div>
                                                                </div>
                                                            )
                                                        })}
                                                    </div>
                                                </TabsContent>

                                                <TabsContent value="printing" className="pt-4">
                                                    <div className="space-y-4">
                                                        <div className="flex items-center justify-between rounded-xl border border-slate-200 p-4">
                                                            <div>
                                                                <Label>Printing Enabled</Label>
                                                                <p className="text-xs text-slate-500">Sales-confirmed print config drives BOM inks.</p>
                                                            </div>
                                                            <Switch checked={activeLine.printing.enabled} onCheckedChange={(checked) => updateLine(activeLine.localId, (line) => ({ ...line, printing: { ...line.printing, enabled: checked }, savedPreview: null }))} />
                                                        </div>
                                                        {activeLine.printing.enabled ? (
                                                            <div className="grid gap-4 md:grid-cols-2">
                                                                <div className="space-y-2">
                                                                    <Label>Method</Label>
                                                                    <Select value={activeLine.printing.type} onValueChange={(value) => updateLine(activeLine.localId, (line) => ({ ...line, printing: { ...line.printing, type: value as OrderLineDraft["printing"]["type"] }, savedPreview: null }))}>
                                                                        <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                                                                        <SelectContent>
                                                                            <SelectItem value="FLEXO">FLEXO</SelectItem>
                                                                            <SelectItem value="ROTO">ROTO</SelectItem>
                                                                            <SelectItem value="DIGITAL">DIGITAL</SelectItem>
                                                                        </SelectContent>
                                                                    </Select>
                                                                </div>
                                                                <div className="space-y-2">
                                                                    <Label>Substrate Mode</Label>
                                                                    <Select value={activeLine.printing.substrate_mode} onValueChange={(value) => updateLine(activeLine.localId, (line) => ({ ...line, printing: { ...line.printing, substrate_mode: value as OrderLineDraft["printing"]["substrate_mode"] }, savedPreview: null }))}>
                                                                        <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                                                                        <SelectContent>
                                                                            <SelectItem value="SHEET">SHEET</SelectItem>
                                                                            <SelectItem value="TUBING">TUBING</SelectItem>
                                                                        </SelectContent>
                                                                    </Select>
                                                                </div>
                                                                <div className="space-y-2">
                                                                    <Label>Front Colors</Label>
                                                                    <Input type="number" value={String(activeLine.printing.front_colors_count)} onChange={(event) => updateLine(activeLine.localId, (line) => ({ ...line, printing: { ...line.printing, front_colors_count: asNumber(event.target.value, 0) }, savedPreview: null }))} />
                                                                </div>
                                                                <div className="space-y-2">
                                                                    <Label>Back Colors</Label>
                                                                    <Input type="number" value={String(activeLine.printing.back_colors_count)} onChange={(event) => updateLine(activeLine.localId, (line) => ({ ...line, printing: { ...line.printing, back_colors_count: asNumber(event.target.value, 0) }, savedPreview: null }))} />
                                                                </div>
                                                                <div className="space-y-2">
                                                                    <Label>Total Ink GSM</Label>
                                                                    <Input type="number" step="0.01" value={String(activeLine.printing.ink_gsm_total)} onChange={(event) => updateLine(activeLine.localId, (line) => ({ ...line, printing: { ...line.printing, ink_gsm_total: asNumber(event.target.value, 0) }, savedPreview: null }))} />
                                                                </div>
                                                                <div className="space-y-2">
                                                                    <Label>Approved Artwork</Label>
                                                                    <Select
                                                                        value={activeLine.printing.artwork_id || "__NONE__"}
                                                                        onValueChange={(value) => updateLine(activeLine.localId, (line) => ({ ...line, printing: { ...line.printing, artwork_id: value === "__NONE__" ? "" : value, defer_artwork_to_planner: false }, savedPreview: null }))}
                                                                        disabled={activeLine.printing.defer_artwork_to_planner}
                                                                    >
                                                                        <SelectTrigger className="bg-white"><SelectValue placeholder="Select artwork" /></SelectTrigger>
                                                                        <SelectContent>
                                                                            <SelectItem value="__NONE__">Select artwork</SelectItem>
                                                                            {artworks.map((artwork: any) => (
                                                                                <SelectItem key={artwork.id} value={String(artwork.id)}>
                                                                                    {artwork.design_code} - {artwork.name}
                                                                                </SelectItem>
                                                                            ))}
                                                                        </SelectContent>
                                                                    </Select>
                                                                </div>
                                                                <div className="flex items-center justify-between rounded-xl border border-slate-200 p-4 md:col-span-2">
                                                                    <div>
                                                                        <Label>Defer Artwork To Planner</Label>
                                                                        <p className="text-xs text-slate-500">Allow commercial confirmation before final artwork assignment.</p>
                                                                    </div>
                                                                    <Switch
                                                                        checked={activeLine.printing.defer_artwork_to_planner}
                                                                        onCheckedChange={(checked) => updateLine(activeLine.localId, (line) => ({ ...line, printing: { ...line.printing, defer_artwork_to_planner: checked, artwork_id: checked ? "" : line.printing.artwork_id }, savedPreview: null }))}
                                                                    />
                                                                </div>
                                                            </div>
                                                        ) : (
                                                            <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">Printing is not enabled for this line.</div>
                                                        )}
                                                    </div>
                                                </TabsContent>

                                                <TabsContent value="chemicals" className="pt-4">
                                                    {activeLine.film_layers.length > 1 ? (
                                                        <div className="grid gap-4 md:grid-cols-2">
                                                            <div className="space-y-2">
                                                                <Label>Adhesive GSM</Label>
                                                                <Input type="number" step="0.01" value={String(activeLine.chemicals.adhesive_gsm)} onChange={(event) => updateLine(activeLine.localId, (line) => ({ ...line, chemicals: { ...line.chemicals, adhesive_gsm: asNumber(event.target.value, 0) }, savedPreview: null }))} />
                                                            </div>
                                                            <div className="space-y-2">
                                                                <Label>Solvent GSM</Label>
                                                                <Input type="number" step="0.01" value={String(activeLine.chemicals.solvent_gsm)} onChange={(event) => updateLine(activeLine.localId, (line) => ({ ...line, chemicals: { ...line.chemicals, solvent_gsm: asNumber(event.target.value, 0) }, savedPreview: null }))} />
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">Chemicals apply only to multi-layer structures.</div>
                                                    )}
                                                </TabsContent>

                                                <TabsContent value="packaging" className="pt-4">
                                                    {activeLine.finished_good_type === "POUCH" ? (
                                                        <div className="space-y-4">
                                                            <div className="rounded-xl border border-slate-200 p-4">
                                                                <div className="flex items-center justify-between">
                                                                    <div>
                                                                        <Label>Primary Inner Pack</Label>
                                                                        <p className="text-xs text-slate-500">This is carried to packing and dispatch.</p>
                                                                    </div>
                                                                    <Switch checked={activeLine.packaging_snapshot.primary_inner_pack.enabled} onCheckedChange={(checked) => updateLine(activeLine.localId, (line) => ({ ...line, packaging_snapshot: { ...line.packaging_snapshot, primary_inner_pack: { ...line.packaging_snapshot.primary_inner_pack, enabled: checked } }, savedPreview: null }))} />
                                                                </div>
                                                                {activeLine.packaging_snapshot.primary_inner_pack.enabled ? (
                                                                    <div className="mt-4 grid gap-4 md:grid-cols-2">
                                                                        <div className="space-y-2">
                                                                            <Label>Packaging Material</Label>
                                                                            <Select value={activeLine.packaging_snapshot.primary_inner_pack.material_id || "__NONE__"} onValueChange={(value) => updateLine(activeLine.localId, (line) => ({ ...line, packaging_snapshot: { ...line.packaging_snapshot, primary_inner_pack: { ...line.packaging_snapshot.primary_inner_pack, material_id: value === "__NONE__" ? "" : value } }, savedPreview: null }))}>
                                                                                <SelectTrigger className="bg-white"><SelectValue placeholder="Select packaging material" /></SelectTrigger>
                                                                                <SelectContent>
                                                                                    <SelectItem value="__NONE__">Select packaging material</SelectItem>
                                                                                    {packagingMaterials.filter((row) => String(row.packaging_kind || "").toUpperCase() === "INNER_POUCH").map((row) => (
                                                                                        <SelectItem key={row.id} value={String(row.id)}>
                                                                                            {row.code} - {row.name}
                                                                                        </SelectItem>
                                                                                    ))}
                                                                                </SelectContent>
                                                                            </Select>
                                                                        </div>
                                                                        <div className="space-y-2">
                                                                            <Label>PCS per Pack</Label>
                                                                            <Input type="number" value={String(activeLine.packaging_snapshot.primary_inner_pack.pcs_per_pack)} onChange={(event) => updateLine(activeLine.localId, (line) => ({ ...line, packaging_snapshot: { ...line.packaging_snapshot, primary_inner_pack: { ...line.packaging_snapshot.primary_inner_pack, pcs_per_pack: asNumber(event.target.value, 0) } }, savedPreview: null }))} />
                                                                        </div>
                                                                    </div>
                                                                ) : null}
                                                            </div>
                                                            <div className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-sm text-slate-500">
                                                                POD has moved to the <span className="font-bold">Add-ons & POD</span> tab because it behaves like formula-driven reinforcement, not dispatch packaging.
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <div className="space-y-4">
                                                            <div className="rounded-xl border border-slate-200 p-4">
                                                                <div className="flex items-center justify-between">
                                                                    <div>
                                                                        <Label>Roll Dispatch Packaging</Label>
                                                                        <p className="text-xs text-slate-500">Select allowed materials here. Actual quantities are captured later in Packing Yard and dispatch.</p>
                                                                    </div>
                                                                    <Switch checked={activeLine.packaging_snapshot.roll_dispatch_pack.enabled} onCheckedChange={(checked) => updateLine(activeLine.localId, (line) => ({ ...line, packaging_snapshot: { ...line.packaging_snapshot, roll_dispatch_pack: { ...line.packaging_snapshot.roll_dispatch_pack, enabled: checked } }, savedPreview: null }))} />
                                                                </div>
                                                                {activeLine.packaging_snapshot.roll_dispatch_pack.enabled ? (
                                                                    <div className="mt-4 space-y-3">
                                                                        {activeLine.packaging_snapshot.roll_dispatch_pack.lines.map((packLine, index) => (
                                                                            <div key={`${activeLine.localId}-pack-${index}`} className="grid gap-2 md:grid-cols-[1.6fr_0.9fr_100px]">
                                                                                <Select value={packLine.material_id || "__NONE__"} onValueChange={(value) => updateLine(activeLine.localId, (line) => ({
                                                                                    ...line,
                                                                                    packaging_snapshot: {
                                                                                        ...line.packaging_snapshot,
                                                                                        roll_dispatch_pack: {
                                                                                            ...line.packaging_snapshot.roll_dispatch_pack,
                                                                                            lines: line.packaging_snapshot.roll_dispatch_pack.lines.map((row, rowIndex) => {
                                                                                                if (rowIndex !== index) return row
                                                                                                const selected = packagingMaterials.find((material: any) => String(material.id) === String(value))
                                                                                                const baseUom = String(selected?.base_uom || row.uom || "PCS").toUpperCase()
                                                                                                const normalizedUom = ["PCS", "KG", "METER"].includes(baseUom)
                                                                                                    ? (baseUom as PackagingLine["uom"])
                                                                                                    : "PCS"
                                                                                                return {
                                                                                                    ...row,
                                                                                                    material_id: value === "__NONE__" ? "" : value,
                                                                                                    qty: 0,
                                                                                                    uom: normalizedUom,
                                                                                                }
                                                                                            })
                                                                                        }
                                                                                    },
                                                                                    savedPreview: null,
                                                                                }))}>
                                                                                    <SelectTrigger className="bg-white"><SelectValue placeholder="Packaging material" /></SelectTrigger>
                                                                                    <SelectContent>
                                                                                        <SelectItem value="__NONE__">Select packaging material</SelectItem>
                                                                                        {packagingMaterials.map((row) => (
                                                                                            <SelectItem key={row.id} value={String(row.id)}>
                                                                                                {row.code} - {row.name}
                                                                                            </SelectItem>
                                                                                        ))}
                                                                                    </SelectContent>
                                                                                </Select>
                                                                                <div className="flex items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-[11px] font-semibold text-slate-600">
                                                                                    {packLine.material_id ? `${packLine.uom} actual at packing` : "Select material first"}
                                                                                </div>
                                                                                <Button variant="outline" className="text-rose-600" onClick={() => updateLine(activeLine.localId, (line) => ({ ...line, packaging_snapshot: { ...line.packaging_snapshot, roll_dispatch_pack: { ...line.packaging_snapshot.roll_dispatch_pack, lines: line.packaging_snapshot.roll_dispatch_pack.lines.filter((_, rowIndex) => rowIndex !== index) } }, savedPreview: null }))}>
                                                                                    Remove
                                                                                </Button>
                                                                            </div>
                                                                        ))}
                                                                        <Button variant="outline" onClick={() => updateLine(activeLine.localId, (line) => ({ ...line, packaging_snapshot: { ...line.packaging_snapshot, roll_dispatch_pack: { ...line.packaging_snapshot.roll_dispatch_pack, lines: [...line.packaging_snapshot.roll_dispatch_pack.lines, { material_id: "", qty: 0, uom: "PCS", basis: "PER_ROLL" }] } }, savedPreview: null }))}>
                                                                            <Plus className="mr-2 h-4 w-4" /> Add Allowed Material
                                                                        </Button>
                                                                    </div>
                                                                ) : null}
                                                            </div>
                                                        </div>
                                                    )}
                                                </TabsContent>

                                                <TabsContent value="addons" className="pt-4">
                                                    <div className="space-y-4">
                                                        <div className="rounded-xl border border-slate-200 p-4">
                                                            <div className="flex items-center justify-between">
                                                                <div>
                                                                    <Label>Add-on Mapping</Label>
                                                                    <p className="text-xs text-slate-500">Non-packaging reinforcements and extras.</p>
                                                                </div>
                                                                <Button variant="outline" size="sm" onClick={() => updateLine(activeLine.localId, (line) => ({ ...line, addons: [...line.addons, makeAddon()], savedPreview: null }))}>
                                                                    <Plus className="mr-2 h-4 w-4" /> Add Add-on
                                                                </Button>
                                                            </div>
                                                            <div className="mt-4 space-y-3">
                                                                {activeLine.addons.length === 0 ? <div className="text-sm text-slate-500">No add-ons linked to this line yet.</div> : null}
                                                                {activeLine.addons.map((addon, index) => {
                                                                    const addonMeta = addonsMaster.find((row: any) => String(row.id) === String(addon.addon_id))
                                                                    const mode = String(addonMeta?.weight_mode || "").toUpperCase()
                                                                    return (
                                                                        <div key={addon.localId} className="grid gap-2 md:grid-cols-[1.5fr_100px_150px_100px]">
                                                                            <Select value={addon.addon_id || "__NONE__"} onValueChange={(value) => updateLine(activeLine.localId, (line) => ({ ...line, addons: line.addons.map((row, rowIndex) => rowIndex === index ? { ...row, addon_id: value === "__NONE__" ? "" : value, applies_to: mode === "PER_MM" ? "WIDTH" : mode === "FIXED" ? "FIXED" : "PER_PIECE" } : row), savedPreview: null }))}>
                                                                                <SelectTrigger className="bg-white"><SelectValue placeholder="Select add-on" /></SelectTrigger>
                                                                                <SelectContent>
                                                                                    <SelectItem value="__NONE__">Select add-on</SelectItem>
                                                                                    {addonsMaster.map((row: any) => (
                                                                                        <SelectItem key={row.id} value={String(row.id)}>
                                                                                            {row.name}
                                                                                        </SelectItem>
                                                                                    ))}
                                                                                </SelectContent>
                                                                            </Select>
                                                                            <Input type="number" value={String(addon.qty)} onChange={(event) => updateLine(activeLine.localId, (line) => ({ ...line, addons: line.addons.map((row, rowIndex) => rowIndex === index ? { ...row, qty: asNumber(event.target.value, 0) } : row), savedPreview: null }))} />
                                                                            {mode === "PER_MM" ? (
                                                                                <Select value={addon.applies_to || "WIDTH"} onValueChange={(value) => updateLine(activeLine.localId, (line) => ({ ...line, addons: line.addons.map((row, rowIndex) => rowIndex === index ? { ...row, applies_to: value as AddonDraft["applies_to"] } : row), savedPreview: null }))}>
                                                                                    <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                                                                                    <SelectContent>
                                                                                        <SelectItem value="WIDTH">Per MM - Width</SelectItem>
                                                                                        <SelectItem value="HEIGHT">Per MM - Height</SelectItem>
                                                                                    </SelectContent>
                                                                                </Select>
                                                                            ) : (
                                                                                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
                                                                                    {mode === "FIXED" ? "Fixed Weight" : "Per Piece"}
                                                                                </div>
                                                                            )}
                                                                            <Button variant="outline" className="text-rose-600" onClick={() => updateLine(activeLine.localId, (line) => ({ ...line, addons: line.addons.filter((_, rowIndex) => rowIndex !== index), savedPreview: null }))}>
                                                                                Remove
                                                                            </Button>
                                                                        </div>
                                                                    )
                                                                })}
                                                            </div>
                                                        </div>

                                                        <div className="rounded-xl border border-slate-200 p-4">
                                                            <div className="flex items-center justify-between">
                                                                <div>
                                                                    <Label>POD Reinforcement</Label>
                                                                    <p className="text-xs text-slate-500">Formula-driven reinforcement lives here now, but still saves into the existing POD packaging snapshot.</p>
                                                                </div>
                                                                <Switch checked={activeLine.packaging_snapshot.pod.enabled} onCheckedChange={(checked) => updateLine(activeLine.localId, (line) => ({ ...line, packaging_snapshot: { ...line.packaging_snapshot, pod: { ...line.packaging_snapshot.pod, enabled: checked } }, savedPreview: null }))} />
                                                            </div>
                                                            {activeLine.packaging_snapshot.pod.enabled ? (
                                                                <div className="mt-4 space-y-2">
                                                                    <Label>POD Profile</Label>
                                                                    <Select value={activeLine.packaging_snapshot.pod.pod_profile_id || "__NONE__"} onValueChange={(value) => updateLine(activeLine.localId, (line) => ({ ...line, packaging_snapshot: { ...line.packaging_snapshot, pod: { ...line.packaging_snapshot.pod, pod_profile_id: value === "__NONE__" ? "" : value } }, savedPreview: null }))}>
                                                                        <SelectTrigger className="bg-white"><SelectValue placeholder="Select POD profile" /></SelectTrigger>
                                                                        <SelectContent>
                                                                            <SelectItem value="__NONE__">Select POD profile</SelectItem>
                                                                            {podProfiles.map((pod: any) => (
                                                                                <SelectItem key={pod.id} value={String(pod.id)}>
                                                                                    {pod.code} - {pod.name}
                                                                                </SelectItem>
                                                                            ))}
                                                                        </SelectContent>
                                                                    </Select>
                                                                </div>
                                                            ) : null}
                                                        </div>
                                                    </div>
                                                </TabsContent>
                                            </Tabs>
                                        </CardContent>
                                    </Card>
                                )}
                            </>
                        ) : (
                            <Card className="border-slate-200 shadow-sm">
                                <CardContent className="flex h-[720px] items-center justify-center text-center text-slate-500">
                                    Select or add a line to start editing.
                                </CardContent>
                            </Card>
                        )}
                    </div>

                    <div className="space-y-6">
                        <Card className="border-slate-200 shadow-sm">
                            <CardHeader className="border-b border-slate-100">
                                <CardTitle className="text-base font-black">Order Summary</CardTitle>
                                <CardDescription>Commercial total is based on current line price inputs and previewed quantities.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4 pt-6">
                                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Estimated Weight</div>
                                    <div className="mt-1 text-2xl font-black text-slate-900">{totalEstimatedWeightKg.toFixed(2)} KG</div>
                                </div>
                                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Estimated Value</div>
                                    <div className="mt-1 text-2xl font-black text-slate-900">{formatMoney(totalEstimatedValue)}</div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="border-slate-200 shadow-sm">
                            <CardHeader className="border-b border-slate-100">
                                <CardTitle className="text-base font-black">Selected Line Preview</CardTitle>
                                <CardDescription>Uses the existing preview engine and BOM contract.</CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-4 pt-6">
                                {!activeLine ? (
                                    <div className="text-sm text-slate-500">Select a line to view its preview.</div>
                                ) : previewLoading ? (
                                    <div className="flex items-center gap-2 text-sm text-slate-500">
                                        <Loader2 className="h-4 w-4 animate-spin" /> Calculating preview...
                                    </div>
                                ) : previewError ? (
                                    <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{previewError}</div>
                                ) : activeLine.savedPreview ? (
                                    <>
                                        <div className="grid gap-3 md:grid-cols-2">
                                            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                                                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Unit Weight</div>
                                                <div className="mt-1 text-xl font-black text-slate-900">
                                                    {activeLine.finished_good_type === "ROLL"
                                                        ? `${asNumber(activeLine.savedPreview.roll_preview?.weight_kg, activeLine.savedPreview.total_weight_kg).toFixed(2)} KG`
                                                        : `${asNumber(activeLine.savedPreview.unit_weight_g, 0).toFixed(3)} g`}
                                                </div>
                                            </div>
                                            <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                                                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Total Weight</div>
                                                <div className="mt-1 text-xl font-black text-slate-900">{asNumber(activeLine.savedPreview.total_weight_kg, 0).toFixed(3)} KG</div>
                                            </div>
                                        </div>
                                        <div className="space-y-2">
                                            <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">BOM Snapshot</div>
                                            <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
                                                {(activeLine.savedPreview.bom_preview?.components || []).length === 0 ? (
                                                    <div className="text-sm text-slate-500">No BOM components resolved yet.</div>
                                                ) : (
                                                    activeLine.savedPreview.bom_preview.components.map((component, index) => (
                                                        <div key={`${component.material_name}-${index}`} className="flex items-center justify-between text-sm">
                                                            <span className="font-medium text-slate-700">{component.material_name}</span>
                                                            <span className="font-bold text-slate-900">{component.qty} {component.uom}</span>
                                                        </div>
                                                    ))
                                                )}
                                            </div>
                                        </div>
                                    </>
                                ) : (
                                    <div className="text-sm text-slate-500">Preview will appear once this line has enough data.</div>
                                )}
                            </CardContent>
                        </Card>
                    </div>
                </div>
            </div>

            <Dialog open={addSkuOpen} onOpenChange={setAddSkuOpen}>
                <DialogContent className="max-w-xl">
                    <DialogHeader>
                        <DialogTitle>Add Shared SKU Line</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label>Shared SKU</Label>
                            <Select value={selectedSkuId || "__NONE__"} onValueChange={(value) => {
                                setSelectedSkuId(value === "__NONE__" ? "" : value)
                                setSelectedVariantId("")
                            }}>
                                <SelectTrigger className="bg-white">
                                    <SelectValue placeholder="Select SKU" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="__NONE__">Select SKU</SelectItem>
                                    {salesSkus.map((sku) => (
                                        <SelectItem key={sku.id} value={sku.id}>
                                            {sku.code} - {sku.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label>Variant</Label>
                            <Select value={selectedVariantId || "__NONE__"} onValueChange={(value) => setSelectedVariantId(value === "__NONE__" ? "" : value)} disabled={!selectedSkuId}>
                                <SelectTrigger className="bg-white">
                                    <SelectValue placeholder="Select variant" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="__NONE__">Select variant</SelectItem>
                                    {skuVariants.map((variant) => (
                                        <SelectItem key={variant.id} value={variant.id}>
                                            {variant.code} - {variant.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="flex justify-end gap-2">
                            <Button variant="outline" onClick={() => setAddSkuOpen(false)}>Cancel</Button>
                            <Button
                                onClick={() => {
                                    if (!selectedSku || !selectedVariant) return
                                    addLine(lineFromVariant(selectedSku, selectedVariant))
                                    setAddSkuOpen(false)
                                }}
                                disabled={!selectedSku || !selectedVariant}
                            >
                                Add Line
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog open={addRepeatOpen} onOpenChange={setAddRepeatOpen}>
                <DialogContent className="max-w-3xl">
                    <DialogHeader>
                        <DialogTitle>Add Repeat Line</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <Input className="pl-10" value={repeatSearch} onChange={(event) => setRepeatSearch(event.target.value)} placeholder="Search order no, line name, template, or SKU variant" />
                        </div>
                        <ScrollArea className="h-[420px] pr-3">
                            <div className="space-y-3">
                                {repeatLines.length === 0 ? (
                                    <div className="rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                                        No repeat candidates found for this customer.
                                    </div>
                                ) : (
                                    repeatLines.map((candidate) => (
                                        <button
                                            key={candidate.id}
                                            type="button"
                                            className="w-full rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-slate-300"
                                            onClick={() => {
                                                addLine(lineFromRepeat(candidate))
                                                setAddRepeatOpen(false)
                                            }}
                                        >
                                            <div className="flex items-center justify-between gap-4">
                                                <div>
                                                    <div className="text-sm font-black text-slate-900">{candidate.line_name || candidate.template_name}</div>
                                                    <div className="mt-1 text-xs text-slate-500">{candidate.order_number} • {candidate.template_name}</div>
                                                </div>
                                                <div className="text-right text-xs font-semibold text-slate-600">
                                                    <div>{candidate.qty_value} {candidate.qty_uom}</div>
                                                    <div>{formatMoney(asNumber(candidate.unit_price, 0))} / {candidate.price_basis}</div>
                                                </div>
                                            </div>
                                            <div className="mt-3 flex flex-wrap gap-2 text-[10px] font-bold uppercase">
                                                <Badge variant="outline">{candidate.summary.finished_good_type}</Badge>
                                                {candidate.summary.pod_enabled ? <Badge variant="outline">POD</Badge> : null}
                                                <Badge variant="outline">{candidate.summary.layer_count || 0} layer(s)</Badge>
                                                {candidate.summary.printing_enabled ? <Badge variant="outline">{candidate.summary.printing_type || "PRINT"}</Badge> : null}
                                            </div>
                                        </button>
                                    ))
                                )}
                            </div>
                        </ScrollArea>
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog open={saveSkuOpen} onOpenChange={setSaveSkuOpen}>
                <DialogContent className="max-w-xl">
                    <DialogHeader>
                        <DialogTitle>Save Selected Line as SKU Variant</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label>Use Existing SKU</Label>
                            <Select value={saveSkuForm.skuId} onValueChange={(value) => setSaveSkuForm((current) => ({ ...current, skuId: value }))}>
                                <SelectTrigger className="bg-white">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="__NEW__">Create new SKU</SelectItem>
                                    {salesSkus.map((sku) => (
                                        <SelectItem key={sku.id} value={sku.id}>
                                            {sku.code} - {sku.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        {saveSkuForm.skuId === "__NEW__" ? (
                            <div className="grid gap-4 md:grid-cols-2">
                                <div className="space-y-2">
                                    <Label>New SKU Code</Label>
                                    <Input value={saveSkuForm.newSkuCode} onChange={(event) => setSaveSkuForm((current) => ({ ...current, newSkuCode: event.target.value }))} />
                                </div>
                                <div className="space-y-2">
                                    <Label>New SKU Name</Label>
                                    <Input value={saveSkuForm.newSkuName} onChange={(event) => setSaveSkuForm((current) => ({ ...current, newSkuName: event.target.value }))} />
                                </div>
                            </div>
                        ) : null}
                        <div className="grid gap-4 md:grid-cols-2">
                            <div className="space-y-2">
                                <Label>Variant Code</Label>
                                <Input value={saveSkuForm.variantCode} onChange={(event) => setSaveSkuForm((current) => ({ ...current, variantCode: event.target.value }))} />
                            </div>
                            <div className="space-y-2">
                                <Label>Variant Name</Label>
                                <Input value={saveSkuForm.variantName} onChange={(event) => setSaveSkuForm((current) => ({ ...current, variantName: event.target.value }))} />
                            </div>
                        </div>
                        <div className="flex justify-end gap-2">
                            <Button variant="outline" onClick={() => setSaveSkuOpen(false)}>Cancel</Button>
                            <Button onClick={() => saveSkuMutation.mutate()} disabled={saveSkuMutation.isPending}>
                                {saveSkuMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                                Save Variant
                            </Button>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    )
}

function buildPreviewPayload(line: OrderLineDraft, families: any[], variants: any[], addonsMaster: any[]) {
    const payload = buildOrderItemPayload(line, families, variants, addonsMaster)
    return {
        template_id: payload.template_id,
        finished_good_type: payload.fg_type,
        geometry: payload.geometry,
        film_layers: payload.film_layers,
        printing: payload.printing,
        chemicals: payload.chemicals,
        addons: payload.addons,
        packaging_snapshot: payload.packaging_snapshot,
        roll_form: payload.roll_form,
        order_qty: payload.qty_value,
        uom: payload.qty_uom,
    }
}

function validateLayerStack(line: OrderLineDraft, variants: any[]) {
    const errors: string[] = []
    line.film_layers.forEach((layer, index) => {
        const label = `Line ${line.line_name || line.localId} layer ${index + 1}:`
        const variant = variants.find((row: any) => String(row.id) === String(layer.variant_id))
        if (!layer.family_id) errors.push(`${label} film family is required.`)
        if (!layer.variant_id) errors.push(`${label} film variant is required.`)
        if (asNumber(layer.thickness_micron, 0) <= 0) errors.push(`${label} thickness is required.`)
        if (asNumber(layer.roll_width_mm, 0) <= 0) errors.push(`${label} roll width is required.`)
        if (variant?.is_extrudable && !layer.grade_id) errors.push(`${label} grade is required for extrudable film.`)
    })
    return errors
}

function buildOrderItemPayload(line: OrderLineDraft, families: any[], variants: any[], addonsMaster: any[]) {
    const normalizedAdjustments = line.geometry.adjustments.map((adjustment) => ({
        name: adjustment.name,
        value: asNumber(adjustment.value, 0),
        impact: adjustment.impact,
    }))
    const fgType = String(line.finished_good_type || "POUCH").toUpperCase() as "POUCH" | "ROLL"
    const qtyUom = fgType === "ROLL" ? "KG" : line.qty_uom
    const priceBasis = fgType === "ROLL" ? "KG" : line.price_basis
    const pouchHeight = asNumber(line.geometry.base.height_mm, 0)
    const primaryRollWidth = asNumber(line.film_layers[0]?.roll_width_mm, 0)

    const filmLayers = line.film_layers.map((layer) => {
        const family = families.find((row: any) => String(row.id) === String(layer.family_id))
        const variant = variants.find((row: any) => String(row.id) === String(layer.variant_id))
        const density = asNumber(variant?.density_gcm3 ?? family?.density_gcm3, 0)
        return {
            family_id: layer.family_id || null,
            variant_id: layer.variant_id || null,
            grade_id: layer.grade_id || null,
            thickness_micron: asNumber(layer.thickness_micron, 0),
            density_g_cm3: density,
            roll_width_mm: asNumber(layer.roll_width_mm, 0),
        }
    })

    const chemicals = line.film_layers.length > 1 ? {
        adhesive_gsm: asNumber(line.chemicals.adhesive_gsm, 0),
        solvent_gsm: asNumber(line.chemicals.solvent_gsm, 0),
    } : {}

    const printing = line.printing.enabled ? {
        enabled: true,
        type: line.printing.type,
        substrate_mode: line.printing.substrate_mode,
        front_colors_count: asNumber(line.printing.front_colors_count, 0),
        back_colors_count: asNumber(line.printing.back_colors_count, 0),
        ink_gsm_total: asNumber(line.printing.ink_gsm_total, 0),
        artwork_id: line.printing.defer_artwork_to_planner ? null : (line.printing.artwork_id || null),
        defer_artwork_to_planner: Boolean(line.printing.defer_artwork_to_planner),
        chemicals,
    } : { enabled: false }

    const addons = line.addons
        .filter((addon) => Boolean(addon.addon_id))
        .map((addon) => {
            const master = addonsMaster.find((row: any) => String(row.id) === String(addon.addon_id))
            const masterMode = String(master?.weight_mode || "PER_PIECE").toUpperCase()
            const finalWeightMode = masterMode === "PER_MM" ? "PER_MM" : masterMode === "FIXED" ? "FIXED" : "PER_PIECE"
            const finalAppliesTo = finalWeightMode === "PER_MM"
                ? (addon.applies_to === "HEIGHT" ? "HEIGHT" : "WIDTH")
                : "NONE"
            return {
                addon_id: addon.addon_id,
                applies_to: finalAppliesTo,
                qty: asNumber(addon.qty, 0),
                weight_mode: finalWeightMode,
                weight_value: asNumber(master?.weight_value, 0),
            }
        })

    return {
        template_id: line.template_id,
        sku_variant_id: line.skuVariantId || undefined,
        repeat_source_item_id: line.repeatSourceItemId || undefined,
        mode: line.repeatSourceItemId ? "REPEAT" : "TEMPLATE",
        line_name: line.line_name,
        qty_value: asNumber(line.qty_value, 0),
        qty_uom: qtyUom,
        price_basis: priceBasis,
        unit_price: asNumber(line.unit_price, 0),
        fg_type: fgType,
        roll_form: fgType === "ROLL" ? (line.roll_form || "FLAT") : null,
        geometry: {
            base: {
                width_mm: fgType === "ROLL" ? primaryRollWidth : asNumber(line.geometry.base.width_mm, 0),
                height_mm: fgType === "POUCH" ? pouchHeight : 0,
            },
            adjustments: normalizedAdjustments,
            multipliers: {
                faces: Math.max(1, asNumber(line.geometry.multipliers.faces, 1)),
            },
            finished_good_type: fgType,
            roll_form: fgType === "ROLL" ? (line.roll_form || "FLAT") : undefined,
        },
        film_layers: filmLayers,
        printing,
        chemicals,
        addons,
        packaging_snapshot: {
            primary_inner_pack: {
                enabled: fgType === "POUCH" ? Boolean(line.packaging_snapshot.primary_inner_pack.enabled) : false,
                material_id: fgType === "POUCH" && line.packaging_snapshot.primary_inner_pack.enabled ? (line.packaging_snapshot.primary_inner_pack.material_id || null) : null,
                pcs_per_pack: fgType === "POUCH" ? asNumber(line.packaging_snapshot.primary_inner_pack.pcs_per_pack, 0) : 0,
            },
            pod: {
                enabled: fgType === "POUCH" ? Boolean(line.packaging_snapshot.pod.enabled) : false,
                pod_profile_id: fgType === "POUCH" && line.packaging_snapshot.pod.enabled ? (line.packaging_snapshot.pod.pod_profile_id || null) : null,
            },
            roll_dispatch_pack: {
                enabled: fgType === "ROLL" ? Boolean(line.packaging_snapshot.roll_dispatch_pack.enabled) : false,
                lines: fgType === "ROLL"
                    ? line.packaging_snapshot.roll_dispatch_pack.lines
                        .filter((row) => row.material_id)
                        .map((row) => ({
                            material_id: row.material_id,
                            qty: asNumber(row.qty, 0),
                            uom: row.uom || "PCS",
                            basis: "PER_ROLL",
                        }))
                    : [],
            },
        },
    }
}

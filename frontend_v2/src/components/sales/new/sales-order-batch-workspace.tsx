"use client"

import Link from "next/link"
import { type Dispatch, type ReactNode, type SetStateAction, useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
    ArrowUpRight,
    Copy,
    Layers3,
    Loader2,
    Plus,
    Repeat2,
    Save,
    Search,
    ShoppingCart,
    Sparkles,
    Wand2,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
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
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import OrderItemTechnicalEditor from "@/components/sales/shared/order-item-technical-editor"
import {
    asNumber,
    buildOrderItemPayload,
    buildPreviewPayload,
    cloneOrderItemDraft,
    createEmptyOrderItemDraft,
    formatMoney,
    getOrderItemContractIssues,
    makeId,
    orderItemFromRepeat,
    orderItemFromVariant,
    type OrderDraftSource,
    type OrderItemDraft,
} from "@/components/sales/shared/order-draft"
import { engineeringService } from "@/services/engineering"
import { filmFamilyService } from "@/services/film-families"
import { filmVariantService } from "@/services/film-variants"
import { masterDataService } from "@/services/master-data"
import {
    type BatchCreateOrderResult,
    type RepeatLineCandidate,
    type SalesSku,
    type SalesSkuVariant,
    salesService,
} from "@/services/sales"
import { templateService } from "@/services/templates"
import styles from "./sales-order-batch.module.css"

type QueueStatus = "draft" | "submitting" | "created" | "failed"

type BatchQueuedOrder = {
    localId: string
    orderName: string
    deliveryDate: string
    sourceType: OrderDraftSource
    sourceMeta: string
    item: OrderItemDraft
    submitStatus: QueueStatus
    submitError: string
    createdOrderId: string
    createdOrderNumber: string
}

type SaveSkuForm = {
    skuId: string
    newSkuCode: string
    newSkuName: string
    variantCode: string
    variantName: string
}

type ChipTone =
    | "neutral"
    | "sku"
    | "variant"
    | "template"
    | "type"
    | "geometry"
    | "layer"
    | "printing"
    | "packaging"
    | "pod"
    | "qty"
    | "value"
    | "status"

function chipToneClass(tone: ChipTone) {
    switch (tone) {
        case "sku":
            return styles.chipSku
        case "variant":
            return styles.chipVariant
        case "template":
            return styles.chipTemplate
        case "type":
            return styles.chipType
        case "geometry":
            return styles.chipGeometry
        case "layer":
            return styles.chipLayer
        case "printing":
            return styles.chipPrinting
        case "packaging":
            return styles.chipPackaging
        case "pod":
            return styles.chipPod
        case "qty":
            return styles.chipQty
        case "value":
            return styles.chipValue
        case "status":
            return styles.chipStatus
        default:
            return styles.chipNeutral
    }
}

function InfoChip({
    children,
    tone = "neutral",
    title,
}: {
    children: ReactNode
    tone?: ChipTone
    title?: string
}) {
    return (
        <span title={title} className={cn(styles.previewChip, chipToneClass(tone))}>
            {children}
        </span>
    )
}

function formatDateLabel(value: string) {
    if (!value) return "No date"
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) return value
    return parsed.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })
}

function estimateOrderValue(order: BatchQueuedOrder) {
    const qtyBasis = order.item.price_basis === "KG"
        ? orderEstimatedKg(order.item)
        : (orderEstimatedPcs(order.item) ?? 0)
    return qtyBasis * asNumber(order.item.unit_price, 0)
}

function previewUnitWeightG(item: OrderItemDraft) {
    return asNumber(item.savedPreview?.unit_weight_g, 0)
}

function orderEstimatedKg(item: OrderItemDraft) {
    if (item.savedPreview) return asNumber(item.savedPreview.total_weight_kg, 0)
    if (item.finished_good_type === "ROLL" && item.qty_uom === "KG") return asNumber(item.qty_value, 0)
    if (item.finished_good_type !== "ROLL" && item.qty_uom === "PCS" && previewUnitWeightG(item) > 0) {
        return (asNumber(item.qty_value, 0) * previewUnitWeightG(item)) / 1000
    }
    return 0
}

function orderEstimatedPcs(item: OrderItemDraft) {
    if (item.finished_good_type === "ROLL") return null
    if (item.qty_uom === "PCS") return asNumber(item.qty_value, 0)
    if (item.qty_uom === "KG" && previewUnitWeightG(item) > 0) {
        return Math.round((asNumber(item.qty_value, 0) * 1000) / previewUnitWeightG(item))
    }
    return null
}

function convertQtyValueForUom(item: OrderItemDraft, nextUom: "PCS" | "KG") {
    if (item.finished_good_type === "ROLL") {
        return { qty_uom: "KG" as const, qty_value: asNumber(item.qty_value, 0) }
    }
    if (item.qty_uom === nextUom) {
        return { qty_uom: nextUom, qty_value: asNumber(item.qty_value, 0) }
    }
    const unitWeightG = previewUnitWeightG(item)
    if (unitWeightG <= 0) {
        return { qty_uom: nextUom, qty_value: asNumber(item.qty_value, 0) }
    }
    if (nextUom === "KG") {
        return {
            qty_uom: "KG" as const,
            qty_value: Number(((asNumber(item.qty_value, 0) * unitWeightG) / 1000).toFixed(3)),
        }
    }
    return {
        qty_uom: "PCS" as const,
        qty_value: Math.round((asNumber(item.qty_value, 0) * 1000) / unitWeightG),
    }
}

function itemTemplateName(item: OrderItemDraft, templates: any[]) {
    return templates.find((template: any) => String(template.id) === String(item.template_id || ""))?.name || "No template"
}

function itemTemplateTag(item: OrderItemDraft, templates: any[]) {
    const templateName = itemTemplateName(item, templates)
    return templateName === "No template" ? "TPL pending" : `TPL ${templateName}`
}

function itemSpecLabel(item: OrderItemDraft) {
    if (item.finished_good_type === "ROLL") return item.roll_form || "FLAT"
    return `${item.geometry.base.width_mm} x ${item.geometry.base.height_mm}`
}

function itemPrintingLabel(item: OrderItemDraft) {
    if (!item.printing.enabled) return "No print"
    return `${item.printing.type} F${item.printing.front_colors_count}/B${item.printing.back_colors_count}`
}

function resolveMaterialMeta(id: string, families: any[], variants: any[], packagingMaterials: any[]) {
    return variants.find((row) => String(row.id) === String(id))
        || families.find((row) => String(row.id) === String(id))
        || packagingMaterials.find((row) => String(row.id) === String(id))
        || null
}

function itemLayerLabels(item: OrderItemDraft, families: any[], variants: any[]) {
    return (item.film_layers || []).map((layer, index) => {
        const material = resolveMaterialMeta(layer.variant_id || layer.family_id, families, variants, [])
        const code = String(material?.code || "").trim()
        const name = String(material?.name || "").trim()
        if (code && name && code.toUpperCase() !== name.toUpperCase()) return `${code} · ${name}`
        return code || name || `Layer ${index + 1}`
    })
}

function itemPackagingLabels(item: OrderItemDraft, packagingMaterials: any[]) {
    const labels: string[] = []
    const primary = item.packaging_snapshot.primary_inner_pack
    if (primary.enabled) {
        const material = resolveMaterialMeta(primary.material_id, [], [], packagingMaterials)
        const materialLabel = String(material?.code || material?.name || "Pack").trim()
        labels.push(materialLabel && materialLabel !== "Pack"
            ? `${materialLabel} ${asNumber(primary.pcs_per_pack, 0)} pcs/pack`
            : `${asNumber(primary.pcs_per_pack, 0)} pcs/pack`)
    }
    if (item.packaging_snapshot.pod.enabled) {
        const podLabel = String(item.packaging_snapshot.pod.pod_sku_code || item.packaging_snapshot.pod.pod_sku_name || "POD").trim()
        labels.push(podLabel && podLabel.toUpperCase() !== "POD" ? `POD ${podLabel}` : "POD enabled")
    }
    if (item.packaging_snapshot.roll_dispatch_pack.enabled) {
        for (const line of item.packaging_snapshot.roll_dispatch_pack.lines.slice(0, 3)) {
            const material = resolveMaterialMeta(line.material_id, [], [], packagingMaterials)
            const materialLabel = String(material?.code || material?.name || "Sheet").trim()
            if (asNumber(line.qty, 0) > 0) {
                labels.push(`${materialLabel} ${asNumber(line.qty, 0)} ${line.uom}/roll`)
            } else {
                labels.push(`${materialLabel} actual at packing`)
            }
        }
    }
    return labels.length ? labels : ["Standard pack"]
}

function itemPackagingWeightLabel(item: OrderItemDraft) {
    const bom = item.savedPreview?.bom
    const podRows = Array.isArray(bom?.pod) ? bom.pod : []
    const podWeightKg = podRows.reduce((sum: number, row: any) => sum + asNumber(row?.weight_kg, 0), 0)
    if (podWeightKg > 0) return `POD weight ${podWeightKg.toFixed(3)} kg`
    if (item.packaging_snapshot.primary_inner_pack.enabled || item.packaging_snapshot.roll_dispatch_pack.enabled) {
        return "Pack config captured"
    }
    return "No extra pack weight modelled"
}

function pricingBasisSummary(item: OrderItemDraft) {
    if (item.price_basis === "PCS") {
        const estimatedPcs = orderEstimatedPcs(item)
        return estimatedPcs !== null ? `${estimatedPcs} pcs priced` : "PCS price pending preview"
    }
    return `${orderEstimatedKg(item).toFixed(3)} kg priced`
}

function createQueuedOrder(params: {
    sourceType: OrderDraftSource
    deliveryDate: string
    orderName: string
    sourceMeta: string
    item: OrderItemDraft
}): BatchQueuedOrder {
    return {
        localId: makeId(),
        orderName: params.orderName,
        deliveryDate: params.deliveryDate,
        sourceType: params.sourceType,
        sourceMeta: params.sourceMeta,
        item: { ...params.item, sourceType: params.sourceType },
        submitStatus: "draft",
        submitError: "",
        createdOrderId: "",
        createdOrderNumber: "",
    }
}

function resetResultState(order: BatchQueuedOrder): BatchQueuedOrder {
    return {
        ...order,
        submitStatus: "draft",
        submitError: "",
        createdOrderId: "",
        createdOrderNumber: "",
    }
}

function SaveSkuVariantDialog({
    open,
    onOpenChange,
    salesSkus,
    form,
    setForm,
    isSaving,
    onSave,
}: {
    open: boolean
    onOpenChange: (open: boolean) => void
    salesSkus: SalesSku[]
    form: SaveSkuForm
    setForm: Dispatch<SetStateAction<SaveSkuForm>>
    isSaving: boolean
    onSave: () => void
}) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent data-testid="sales-save-sku-variant-dialog" className="h-[100dvh] max-h-[100dvh] w-screen max-w-none overflow-y-auto rounded-none p-0 sm:h-auto sm:max-h-[94vh] sm:w-[calc(100vw-1rem)] sm:max-w-[min(40rem,calc(100vw-1rem))] sm:rounded-[2rem]">
                <DialogHeader>
                    <DialogTitle className="px-6 pt-6">Save as SKU Variant</DialogTitle>
                    <DialogDescription>
                        Promote this detailed or repeat configuration into the fast-entry shared SKU catalog.
                    </DialogDescription>
                </DialogHeader>
                <div className="space-y-4 px-6 py-2">
                    <div className="space-y-2">
                        <Label>Use Existing SKU</Label>
                        <Select value={form.skuId} onValueChange={(value) => setForm((current) => ({ ...current, skuId: value }))}>
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
                    {form.skuId === "__NEW__" ? (
                        <div className="grid gap-4 md:grid-cols-2">
                            <div className="space-y-2">
                                <Label>New SKU Code</Label>
                                <Input
                                    value={form.newSkuCode}
                                    onChange={(event) => setForm((current) => ({ ...current, newSkuCode: event.target.value }))}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>New SKU Name</Label>
                                <Input
                                    value={form.newSkuName}
                                    onChange={(event) => setForm((current) => ({ ...current, newSkuName: event.target.value }))}
                                />
                            </div>
                        </div>
                    ) : null}
                    <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                            <Label>Variant Code</Label>
                            <Input
                                value={form.variantCode}
                                onChange={(event) => setForm((current) => ({ ...current, variantCode: event.target.value }))}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label>Variant Name</Label>
                            <Input
                                value={form.variantName}
                                onChange={(event) => setForm((current) => ({ ...current, variantName: event.target.value }))}
                            />
                        </div>
                    </div>
                </div>
                <DialogFooter className="mobile-safe-bottom px-6 pb-6">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={onSave} disabled={isSaving}>
                        {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                        Save Variant
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

export default function SalesOrderBatchWorkspace() {
    const queryClient = useQueryClient()
    const { toast } = useToast()

    const [customerId, setCustomerId] = useState("")
    const [customerName, setCustomerName] = useState("")
    const [queue, setQueue] = useState<BatchQueuedOrder[]>([])
    const [activeOrderId, setActiveOrderId] = useState("")
    const [previewLoading, setPreviewLoading] = useState(false)
    const [previewError, setPreviewError] = useState("")
    const [repeatDialogOpen, setRepeatDialogOpen] = useState(false)
    const [selectedSkuId, setSelectedSkuId] = useState("")
    const [selectedSharedVariantId, setSelectedSharedVariantId] = useState("")
    const [skuSearch, setSkuSearch] = useState("")
    const [variantSearch, setVariantSearch] = useState("")
    const [repeatSearch, setRepeatSearch] = useState("")
    const [saveSkuOpen, setSaveSkuOpen] = useState(false)
    const [saveSkuTarget, setSaveSkuTarget] = useState<OrderItemDraft | null>(null)
    const [previewNonce, setPreviewNonce] = useState(0)
    const [technicalEditorOpen, setTechnicalEditorOpen] = useState(false)
    const [saveSkuForm, setSaveSkuForm] = useState<SaveSkuForm>({
        skuId: "__NEW__",
        newSkuCode: "",
        newSkuName: "",
        variantCode: "",
        variantName: "",
    })

    const activeOrder = queue.find((order) => order.localId === activeOrderId) || null
    const activeItem = activeOrder?.item || null
    const activePrinting = activeItem?.printing || {
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
    const { data: templates = [] } = useQuery({
        queryKey: ["templates", "live-only"],
        queryFn: () => templateService.getTemplates({ status: "LIVE" }),
    })
    const { data: families = [] } = useQuery({ queryKey: ["film-families"], queryFn: filmFamilyService.getAll })
    const { data: variants = [] } = useQuery({ queryKey: ["film-variants"], queryFn: filmVariantService.getAll })
    const { data: addonsMaster = [] } = useQuery({ queryKey: ["addons"], queryFn: masterDataService.getAddons })
    const { data: packagingMaterials = [] } = useQuery({
        queryKey: ["packaging-materials"],
        queryFn: masterDataService.getPackaging,
    })
    const { data: podProfiles = [] } = useQuery({ queryKey: ["pod-sku-variants", "sales-batch"], queryFn: () => masterDataService.getPodSkuVariants({ active: true }) })
    const { data: salesSkus = [] } = useQuery({
        queryKey: ["sales-skus", customerId],
        queryFn: () => salesService.getSalesSkus({ customer_id: customerId || undefined, active: true }),
        enabled: Boolean(customerId),
    })
    const { data: repeatLines = [], isFetching: repeatLinesFetching } = useQuery({
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
        queryFn: () =>
            engineeringService.getArtworks({
                status: "APPROVED",
                print_type: activePrinting.type,
                front_colors_count: activePrinting.front_colors_count,
                back_colors_count: activePrinting.back_colors_count,
                cylinder_ready: activePrinting.type === "ROTO" ? "true" : undefined,
                exclude_cylinder_artwork: activePrinting.type === "FLEXO" ? "true" : undefined,
            }),
        enabled: Boolean(activePrinting.enabled && !activePrinting.defer_artwork_to_planner),
    })
    const { data: selectedSkuVariants = [] } = useQuery({
        queryKey: ["sales-sku-variants", selectedSkuId, customerId],
        queryFn: () =>
            salesService.getSalesSkuVariants({
                sku_id: selectedSkuId || undefined,
                customer_id: customerId || undefined,
                active: true,
            }),
        enabled: Boolean(selectedSkuId && customerId),
    })

    useEffect(() => {
        if (!queue.length) {
            setActiveOrderId("")
            return
        }
        if (!activeOrderId || !queue.some((order) => order.localId === activeOrderId)) {
            setActiveOrderId(queue[0].localId)
        }
    }, [activeOrderId, queue])

    useEffect(() => {
        setTechnicalEditorOpen(Boolean(activeOrder?.item.advancedUnlocked))
    }, [activeOrder?.localId, activeOrder?.item.advancedUnlocked])

    const activePreviewSignature = useMemo(() => {
        if (!activeItem) return ""
        return JSON.stringify({
            ...activeItem,
            savedPreview: null,
        })
    }, [activeItem])

    useEffect(() => {
        if (!activeOrder || !activeItem?.template_id) {
            setPreviewError("")
            return
        }
        const handle = window.setTimeout(async () => {
            try {
                setPreviewLoading(true)
                setPreviewError("")
                const template = templates.find((row: any) => String(row.id) === String(activeItem.template_id))
                const draftIssues = getOrderItemContractIssues(activeItem, addonsMaster, template?.pouch_style || "")
                if (draftIssues.length) {
                    setQueue((current) =>
                        current.map((order) =>
                            order.localId === activeOrder.localId
                                ? { ...order, item: { ...order.item, savedPreview: null } }
                                : order
                        )
                    )
                    throw new Error(draftIssues[0])
                }
                const preview = await salesService.previewItem(buildPreviewPayload(activeItem, families, variants, addonsMaster))
                setQueue((current) =>
                    current.map((order) =>
                        order.localId === activeOrder.localId
                            ? {
                                ...order,
                                item: { ...order.item, savedPreview: preview },
                            }
                            : order
                    )
                )
            } catch (error: any) {
                setPreviewError(error?.response?.data?.detail || error?.message || "Unable to calculate preview.")
            } finally {
                setPreviewLoading(false)
            }
        }, 350)
        return () => window.clearTimeout(handle)
    }, [activeOrder?.localId, activeItem?.template_id, activePreviewSignature, families, variants, addonsMaster, previewNonce])

    const filteredSkus = useMemo(() => {
        const query = skuSearch.trim().toLowerCase()
        if (!query) return salesSkus
        return salesSkus.filter((sku) =>
            [sku.code, sku.name, sku.default_line_name, sku.template_name, sku.commercial_family_name]
                .filter(Boolean)
                .some((value) => String(value).toLowerCase().includes(query))
        )
    }, [salesSkus, skuSearch])

    const selectedSku = useMemo(
        () => filteredSkus.find((sku) => sku.id === selectedSkuId) || salesSkus.find((sku) => sku.id === selectedSkuId) || null,
        [filteredSkus, salesSkus, selectedSkuId]
    )

    const filteredSelectedVariants = useMemo(() => {
        const source = selectedSkuVariants.length ? selectedSkuVariants : selectedSku?.variants || []
        const query = variantSearch.trim().toLowerCase()
        if (!query) return source
        return source.filter((variant) =>
            [variant.code, variant.name, variant.template_name].some((value) =>
                String(value || "").toLowerCase().includes(query)
            )
        )
    }, [selectedSku, selectedSkuVariants, variantSearch])

    const selectedSharedVariant = useMemo(
        () => filteredSelectedVariants.find((variant) => variant.id === selectedSharedVariantId) || filteredSelectedVariants[0] || null,
        [filteredSelectedVariants, selectedSharedVariantId]
    )

    useEffect(() => {
        if (!filteredSelectedVariants.length) {
            setSelectedSharedVariantId("")
            return
        }
        if (!selectedSharedVariantId || !filteredSelectedVariants.some((variant) => variant.id === selectedSharedVariantId)) {
            setSelectedSharedVariantId(filteredSelectedVariants[0].id)
        }
    }, [filteredSelectedVariants, selectedSharedVariantId])

    const totalEstimatedWeightKg = queue.reduce((sum, order) => sum + orderEstimatedKg(order.item), 0)
    const totalEstimatedValue = queue.reduce((sum, order) => sum + estimateOrderValue(order), 0)
    const queueDraftCount = queue.filter((order) => order.submitStatus === "draft").length
    const queueCreatedCount = queue.filter((order) => order.submitStatus === "created").length
    const queueFailedCount = queue.filter((order) => order.submitStatus === "failed").length

    const saveSkuMutation = useMutation({
        mutationFn: async () => {
            if (!saveSkuTarget || !saveSkuTarget.template_id) {
                throw new Error("A LIVE template is required before saving a SKU variant.")
            }
            let skuId = saveSkuForm.skuId
            if (!skuId || skuId === "__NEW__") {
                if (!saveSkuForm.newSkuCode.trim() || !saveSkuForm.newSkuName.trim()) {
                    throw new Error("New SKU code and name are required.")
                }
                const createdSku = await salesService.createSalesSku({
                    code: saveSkuForm.newSkuCode.trim().toUpperCase(),
                    name: saveSkuForm.newSkuName.trim(),
                    template: saveSkuTarget.template_id,
                    default_line_name: saveSkuTarget.line_name,
                    active: true,
                })
                skuId = createdSku.id
            }
            if (!saveSkuForm.variantCode.trim() || !saveSkuForm.variantName.trim()) {
                throw new Error("Variant code and name are required.")
            }
            const targetTemplate = templates.find((row: any) => String(row.id) === String(saveSkuTarget.template_id))
            const draftIssues = getOrderItemContractIssues(saveSkuTarget, addonsMaster, targetTemplate?.pouch_style || "")
            if (draftIssues.length) {
                throw new Error(draftIssues[0])
            }
            const normalizedItemPayload = buildOrderItemPayload(saveSkuTarget, families, variants, addonsMaster)
            return salesService.createSalesSkuVariant({
                sku: skuId,
                code: saveSkuForm.variantCode.trim().toUpperCase(),
                name: saveSkuForm.variantName.trim(),
                active: true,
                finished_good_type: normalizedItemPayload.fg_type,
                roll_form: normalizedItemPayload.roll_form,
                geometry_snapshot: normalizedItemPayload.geometry,
                layer_snapshot: normalizedItemPayload.film_layers,
                printing_snapshot: {
                    ...normalizedItemPayload.printing,
                    chemicals: normalizedItemPayload.chemicals,
                },
                chemicals_snapshot: normalizedItemPayload.chemicals,
                addons_snapshot: normalizedItemPayload.addons,
                packaging_snapshot: normalizedItemPayload.packaging_snapshot,
            })
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["sales-skus"] })
            queryClient.invalidateQueries({ queryKey: ["sales-sku-variants"] })
            toast({
                title: "SKU variant saved",
                description: "The fast-entry catalog now includes this configuration.",
            })
            setSaveSkuOpen(false)
            setSaveSkuTarget(null)
        },
        onError: (error: any) => {
            toast({
                title: "Could not save SKU variant",
                description: error?.response?.data?.detail || error?.message || "Please review the SKU fields and try again.",
                variant: "destructive",
            })
        },
    })

    const batchCreateMutation = useMutation({
        mutationFn: async (targetIds?: string[]) => {
            if (!customerId) throw new Error("Select a customer first.")
            const ordersToSend = queue.filter((order) => {
                if (targetIds?.length) return targetIds.includes(order.localId)
                return order.submitStatus !== "created"
            })
            if (!ordersToSend.length) throw new Error("No draft or failed orders are waiting to be submitted.")
            for (const order of ordersToSend) {
                const template = templates.find((row: any) => String(row.id) === String(order.item.template_id))
                const draftIssues = getOrderItemContractIssues(order.item, addonsMaster, template?.pouch_style || "")
                if (draftIssues.length) {
                    throw new Error(`${order.orderName}: ${draftIssues[0]}`)
                }
            }
            const payload = {
                customer: customerId,
                customer_name: customerName,
                orders: ordersToSend.map((order) => ({
                    client_reference: order.localId,
                    source_type: order.sourceType,
                    order_name: order.orderName,
                    delivery_date: order.deliveryDate,
                    order_type: "MTO",
                    items: [buildOrderItemPayload(order.item, families, variants, addonsMaster)],
                })),
            }
            return salesService.batchCreateOrders(payload)
        },
        onMutate: (targetIds) => {
            setQueue((current) =>
                current.map((order) =>
                    (!targetIds?.length || targetIds.includes(order.localId)) && order.submitStatus !== "created"
                        ? { ...order, submitStatus: "submitting", submitError: "" }
                        : order
                )
            )
        },
        onSuccess: (response) => {
            const resultMap = new Map<string, BatchCreateOrderResult>()
            for (const result of response.results) {
                if (result.client_reference) resultMap.set(result.client_reference, result)
            }
            setQueue((current) =>
                current.map((order) => {
                    const result = resultMap.get(order.localId)
                    if (!result) return order
                    return {
                        ...order,
                        submitStatus: result.status === "created" ? "created" : "failed",
                        submitError: result.error || "",
                        createdOrderId: result.sales_order_id || "",
                        createdOrderNumber: result.sales_order_number || "",
                    }
                })
            )
            queryClient.invalidateQueries({ queryKey: ["sales-orders"] })
            toast({
                title: "Batch processed",
                description: `${response.created_count} orders created, ${response.failed_count} failed.`,
            })
        },
        onError: (error: any) => {
            setQueue((current) =>
                current.map((order) =>
                    order.submitStatus === "submitting"
                        ? { ...order, submitStatus: "failed", submitError: error?.response?.data?.detail || error?.message || "Batch submission failed." }
                        : order
                )
            )
            toast({
                title: "Batch submit failed",
                description: error?.response?.data?.detail || error?.message || "Please review the queued orders and retry.",
                variant: "destructive",
            })
        },
    })

    const openSaveSkuDialog = (target: OrderItemDraft) => {
        setSaveSkuTarget(target)
        setSaveSkuForm({
            skuId: "__NEW__",
            newSkuCode: "",
            newSkuName: "",
            variantCode: "",
            variantName: target.line_name,
        })
        setSaveSkuOpen(true)
    }

    const handleCustomerChange = (value: string) => {
        const customer = customers.find((row) => row.id === value)
        if (customerId && customerId !== value && queue.length) {
            toast({
                title: "Batch cleared",
                description: "Each batch is single-customer only, so the queued orders were reset.",
            })
            setQueue([])
            setActiveOrderId("")
        }
        setCustomerId(value)
        setCustomerName(customer?.name || "")
        setSelectedSkuId("")
        setSelectedSharedVariantId("")
        setSkuSearch("")
        setVariantSearch("")
        setRepeatSearch("")
    }

    const updateQueuedOrder = (orderId: string, updater: (order: BatchQueuedOrder) => BatchQueuedOrder) => {
        setQueue((current) =>
            current.map((order) => {
                if (order.localId !== orderId) return order
                return resetResultState(updater(order))
            })
        )
    }

    const addQueuedOrder = (queuedOrder: BatchQueuedOrder) => {
        setQueue((current) => [queuedOrder, ...current])
        setActiveOrderId(queuedOrder.localId)
    }

    const duplicateQueuedOrder = (orderId: string) => {
        const source = queue.find((order) => order.localId === orderId)
        if (!source) return
        addQueuedOrder(
            createQueuedOrder({
                sourceType: source.sourceType,
                deliveryDate: source.deliveryDate,
                orderName: `${source.orderName || source.item.line_name} Copy`,
                sourceMeta: source.sourceMeta,
                item: cloneOrderItemDraft(source.item),
            })
        )
    }

    const removeQueuedOrder = (orderId: string) => {
        setQueue((current) => {
            const remaining = current.filter((order) => order.localId !== orderId)
            if (activeOrderId === orderId) {
                setActiveOrderId(remaining[0]?.localId || "")
            }
            return remaining
        })
    }

    const addSharedSkuToBatch = (sku: SalesSku, variant: SalesSkuVariant) => {
        addQueuedOrder(
            createQueuedOrder({
                sourceType: "SKU",
                deliveryDate: new Date().toISOString().slice(0, 10),
                orderName: variant.name || sku.name,
                sourceMeta: `${sku.code} / ${variant.code}`,
                item: orderItemFromVariant(sku, variant),
            })
        )
    }

    const addRepeatToBatch = (candidate: RepeatLineCandidate, asCustom = false) => {
        const item = orderItemFromRepeat(candidate)
        if (asCustom) {
            item.sourceType = "CUSTOM"
            item.advancedUnlocked = true
        }
        addQueuedOrder(
            createQueuedOrder({
                sourceType: asCustom ? "CUSTOM" : "REPEAT",
                deliveryDate: new Date().toISOString().slice(0, 10),
                orderName: candidate.order_name || candidate.line_name || candidate.template_name,
                sourceMeta: candidate.order_number,
                item,
            })
        )
        setRepeatDialogOpen(false)
    }

    const addCustomDetailedOrder = () => {
        const item = createEmptyOrderItemDraft("CUSTOM")
        addQueuedOrder(
            createQueuedOrder({
                sourceType: "CUSTOM",
                deliveryDate: new Date().toISOString().slice(0, 10),
                orderName: "Custom detailed order",
                sourceMeta: "Template-attached",
                item,
            })
        )
    }

    const retrySpecificOrder = (orderId: string) => {
        batchCreateMutation.mutate([orderId])
    }

    const activeEstimatedValue = activeOrder ? estimateOrderValue(activeOrder) : 0
    const activeTemplate = templates.find((template: any) => String(template.id) === String(activeItem?.template_id || ""))
    const activeLayerLabels = activeItem ? itemLayerLabels(activeItem, families, variants) : []
    const activePackagingLabels = activeItem ? itemPackagingLabels(activeItem, packagingMaterials) : []
    const activeEstimatedKg = activeItem ? orderEstimatedKg(activeItem) : 0
    const activeEstimatedPcs = activeItem ? orderEstimatedPcs(activeItem) : null
    const activeUnitWeightG = activeItem ? previewUnitWeightG(activeItem) : 0

    return (
        <div className={styles.shell} data-testid="sales-order-batch-workspace-page">
            <div data-testid="sales-order-batch-workspace" className={styles.shellFrame}>
                <header className={styles.headerBar}>
                    <div className={styles.headerTitleWrap}>
                        <div className={styles.headerEyebrow}>
                            <Sparkles className="h-3.5 w-3.5" />
                            Sales Fast Entry
                        </div>
                        <h1 className={styles.headerTitle}>Create Sales Orders</h1>
                    </div>

                    <div className={styles.customerInline}>
                        <Label className={styles.inlineLabel}>Customer</Label>
                        <Select value={customerId} onValueChange={handleCustomerChange}>
                            <SelectTrigger data-testid="sales-batch-customer" className={styles.inlineSelect}>
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

                    <div className={styles.headerStats}>
                        <span className={styles.headerStatChip}><span data-testid="sales-batch-queue-count">{queue.length}</span> in queue</span>
                        <span className={styles.headerStatChip}>{queueCreatedCount} ok</span>
                        <span className={styles.headerStatChip}>{queueFailedCount} err</span>
                    </div>

                    <div className={styles.headerActions}>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            data-testid="sales-batch-lane-repeat"
                            onClick={() => setRepeatDialogOpen(true)}
                            disabled={!customerId}
                        >
                            <Repeat2 className="mr-2 h-4 w-4" />
                            Repeat
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            data-testid="sales-batch-lane-custom"
                            onClick={addCustomDetailedOrder}
                            disabled={!customerId}
                        >
                            <Layers3 className="mr-2 h-4 w-4" />
                            Custom
                        </Button>
                        <Button variant="outline" size="sm" asChild>
                            <Link href="/sales/sku-catalog">
                                SKU Catalog
                            </Link>
                        </Button>
                        <Button
                            data-testid="sales-batch-submit"
                            onClick={() => batchCreateMutation.mutate(undefined)}
                            disabled={!customerId || !queue.length || batchCreateMutation.isPending}
                            className={styles.submitBtn}
                        >
                            {batchCreateMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                            Submit queued orders
                        </Button>
                    </div>
                </header>

                <div className={styles.mainLayout}>
                    <div className={styles.workColumn}>
                        <section className={styles.panel}>
                            <div className={styles.panelTopline}>
                                <div>
                                    <div className={styles.panelLabel}>Shared SKU Source</div>
                                    <div className={styles.panelHint}>Shared SKU is the primary lane. Repeat and custom hydrate the same queue/composer model.</div>
                                </div>
                                <Badge variant="outline" className={styles.modeBadge}>SKU-first</Badge>
                            </div>

                            <div className={styles.sourceRow}>
                                <div className={styles.fieldBlock}>
                                    <Label className={styles.compactLabel}>Sales SKU</Label>
                                    <Select
                                        value={selectedSkuId}
                                        onValueChange={(value) => {
                                            setSelectedSkuId(value)
                                            setSelectedSharedVariantId("")
                                        }}
                                        disabled={!customerId}
                                    >
                                        <SelectTrigger data-testid="sales-batch-shared-sku" className={styles.compactSelect}>
                                            <SelectValue placeholder={customerId ? "Select SKU" : "Select customer first"} />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {filteredSkus.map((sku) => (
                                                <SelectItem key={sku.id} value={sku.id}>
                                                    {sku.code} · {sku.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                <div className={styles.fieldBlock}>
                                    <Label className={styles.compactLabel}>Variant</Label>
                                    <Select
                                        value={selectedSharedVariantId}
                                        onValueChange={setSelectedSharedVariantId}
                                        disabled={!customerId || !selectedSku}
                                    >
                                        <SelectTrigger data-testid="sales-batch-shared-variant" className={styles.compactSelect}>
                                            <SelectValue placeholder="Select variant" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {filteredSelectedVariants.map((variant) => (
                                                <SelectItem key={variant.id} value={variant.id}>
                                                    {variant.code} · {variant.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                <div className={styles.searchBlock}>
                                    <Label className={styles.compactLabel}>Quick search</Label>
                                    <div className={styles.searchInputWrap}>
                                        <Search className={styles.searchIcon} />
                                        <Input
                                            value={variantSearch}
                                            onChange={(event) => setVariantSearch(event.target.value)}
                                            placeholder="Filter variants"
                                            className={styles.searchInput}
                                        />
                                    </div>
                                </div>

                                <Button
                                    data-testid="sales-batch-shared-add"
                                    className={styles.addSharedBtn}
                                    onClick={() => {
                                        if (!selectedSku || !selectedSharedVariant) return
                                        addSharedSkuToBatch(selectedSku, selectedSharedVariant)
                                    }}
                                    disabled={!customerId || !selectedSku || !selectedSharedVariant}
                                >
                                    <Plus className="mr-2 h-4 w-4" />
                                    Add to queue
                                </Button>
                            </div>

                            <div className={styles.sourceMeta}>
                                <InfoChip tone="sku">{selectedSku?.code || "No SKU"}</InfoChip>
                                <InfoChip tone="variant">{selectedSharedVariant?.code || "No variant"}</InfoChip>
                                {selectedSharedVariant ? (
                                    <>
                                        <InfoChip tone="type">{selectedSharedVariant.finished_good_type}</InfoChip>
                                        <InfoChip tone="geometry">
                                            {selectedSharedVariant.finished_good_type === "ROLL"
                                                ? selectedSharedVariant.roll_form || "FLAT"
                                                : `${selectedSharedVariant.geometry_snapshot?.base?.width_mm || selectedSharedVariant.geometry_snapshot?.width_mm || 0} x ${selectedSharedVariant.geometry_snapshot?.base?.height_mm || selectedSharedVariant.geometry_snapshot?.height_mm || 0}`}
                                        </InfoChip>
                                        {itemLayerLabels(orderItemFromVariant(selectedSku!, selectedSharedVariant), families, variants).map((label) => (
                                            <InfoChip key={`selected-layer-${label}`} tone="layer">{label}</InfoChip>
                                        ))}
                                        {selectedSharedVariant.printing_snapshot?.enabled ? (
                                            <InfoChip tone="printing">{selectedSharedVariant.printing_snapshot?.type || "PRINT"}</InfoChip>
                                        ) : null}
                                        {itemPackagingLabels(orderItemFromVariant(selectedSku!, selectedSharedVariant), packagingMaterials).map((label) => (
                                            <InfoChip key={`selected-pack-${label}`} tone={label.startsWith("POD ") ? "pod" : "packaging"}>{label}</InfoChip>
                                        ))}
                                        {selectedSharedVariant.packaging_snapshot?.pod?.enabled ? <InfoChip tone="pod">POD</InfoChip> : null}
                                    </>
                                ) : null}
                                <InfoChip tone="template">{selectedSharedVariant?.template_name || selectedSku?.template_name || "TPL pending"}</InfoChip>
                            </div>
                        </section>

                        {activeOrder ? (
                            <>
                                <section className={styles.panel} data-testid="sales-batch-selected-order">
                                    <div className={styles.panelTopline}>
                                        <div>
                                            <div className={styles.panelLabel}>Line Composer</div>
                                            <div className={styles.panelHint}>
                                                {activeOrder.sourceType === "SKU"
                                                    ? "Variant provides technical truth. Edit the commercial inputs here."
                                                    : activeOrder.sourceType === "REPEAT"
                                                        ? "Repeat hydrates the same draft. Keep it fast unless you need to unlock physics."
                                                        : "Custom starts in the same draft model with the technical editor ready."}
                                            </div>
                                        </div>
                                        <div className={styles.inlineBadgeRow}>
                                            <span className={cn(styles.stateBadge, styles.sourceBadge)}>{activeOrder.sourceType}</span>
                                            <span className={cn(styles.stateBadge, activeOrder.submitStatus === "failed" ? styles.errorBadge : activeOrder.submitStatus === "created" ? styles.successBadge : styles.neutralBadge)}>
                                                {activeOrder.submitStatus}
                                            </span>
                                        </div>
                                    </div>

                                    <div className={styles.composerGrid}>
                                        <div className={styles.fieldBlock}>
                                            <Label className={styles.compactLabel}>Order name</Label>
                                            <Input
                                                data-testid="sales-batch-order-name"
                                                className={styles.compactInput}
                                                value={activeOrder.orderName}
                                                onChange={(event) =>
                                                    updateQueuedOrder(activeOrder.localId, (order) => ({
                                                        ...order,
                                                        orderName: event.target.value,
                                                    }))
                                                }
                                            />
                                        </div>

                                        <div className={styles.fieldBlock}>
                                            <Label className={styles.compactLabel}>Line label</Label>
                                            <Input
                                                data-testid="sales-batch-line-name"
                                                className={styles.compactInput}
                                                value={activeOrder.item.line_name}
                                                onChange={(event) =>
                                                    updateQueuedOrder(activeOrder.localId, (order) => ({
                                                        ...order,
                                                        item: { ...order.item, line_name: event.target.value, savedPreview: null },
                                                    }))
                                                }
                                            />
                                        </div>

                                        <div className={styles.fieldBlock}>
                                            <Label className={styles.compactLabel}>Delivery</Label>
                                            <Input
                                                data-testid="sales-batch-delivery-date"
                                                className={styles.compactInput}
                                                type="date"
                                                value={activeOrder.deliveryDate}
                                                onChange={(event) =>
                                                    updateQueuedOrder(activeOrder.localId, (order) => ({
                                                        ...order,
                                                        deliveryDate: event.target.value,
                                                    }))
                                                }
                                            />
                                        </div>

                                        <div className={styles.fieldBlock}>
                                            <Label className={styles.compactLabel}>Qty</Label>
                                            <Input
                                                data-testid="sales-batch-qty"
                                                className={styles.compactInput}
                                                type="number"
                                                value={String(activeOrder.item.qty_value)}
                                                onChange={(event) =>
                                                    updateQueuedOrder(activeOrder.localId, (order) => ({
                                                        ...order,
                                                        item: { ...order.item, qty_value: asNumber(event.target.value, 0), savedPreview: null },
                                                    }))
                                                }
                                            />
                                        </div>

                                        <div className={styles.fieldBlock}>
                                            <Label className={styles.compactLabel}>UOM</Label>
                                            <Select
                                                value={activeOrder.item.qty_uom}
                                                onValueChange={(value) =>
                                                    updateQueuedOrder(activeOrder.localId, (order) => {
                                                        const converted = convertQtyValueForUom(order.item, value as "PCS" | "KG")
                                                        return {
                                                            ...order,
                                                            item: {
                                                                ...order.item,
                                                                qty_uom: converted.qty_uom,
                                                                qty_value: converted.qty_value,
                                                                savedPreview: null,
                                                            },
                                                        }
                                                    })
                                                }
                                            >
                                                <SelectTrigger className={styles.compactSelect}><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="KG">KG</SelectItem>
                                                    {activeOrder.item.finished_good_type !== "ROLL" ? <SelectItem value="PCS">PCS</SelectItem> : null}
                                                </SelectContent>
                                            </Select>
                                        </div>

                                        <div className={styles.fieldBlock}>
                                            <Label className={styles.compactLabel}>Price basis</Label>
                                            <Select
                                                value={activeOrder.item.price_basis}
                                                onValueChange={(value) =>
                                                    updateQueuedOrder(activeOrder.localId, (order) => ({
                                                        ...order,
                                                        item: {
                                                            ...order.item,
                                                            price_basis: order.item.finished_good_type === "ROLL" ? "KG" : (value as "PCS" | "KG"),
                                                        },
                                                    }))
                                                }
                                            >
                                                <SelectTrigger className={styles.compactSelect}><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="KG">Per KG</SelectItem>
                                                    {activeOrder.item.finished_good_type !== "ROLL" ? <SelectItem value="PCS">Per PCS</SelectItem> : null}
                                                </SelectContent>
                                            </Select>
                                        </div>

                                        <div className={styles.fieldBlock}>
                                            <Label className={styles.compactLabel}>Unit price</Label>
                                            <Input
                                                data-testid="sales-batch-unit-price"
                                                className={styles.compactInput}
                                                type="number"
                                                step="0.01"
                                                value={String(activeOrder.item.unit_price)}
                                                onChange={(event) =>
                                                    updateQueuedOrder(activeOrder.localId, (order) => ({
                                                        ...order,
                                                        item: { ...order.item, unit_price: asNumber(event.target.value, 0) },
                                                    }))
                                                }
                                            />
                                        </div>

                                        <div className={styles.fieldBlock}>
                                            <Label className={styles.compactLabel}>LIVE template</Label>
                                            <Select
                                                value={activeOrder.item.template_id || "__NONE__"}
                                                onValueChange={(value) => {
                                                    const selected = templates.find((template: any) => String(template.id) === value)
                                                    updateQueuedOrder(activeOrder.localId, (order) => ({
                                                        ...order,
                                                        item: {
                                                            ...order.item,
                                                            template_id: value === "__NONE__" ? "" : value,
                                                            finished_good_type: String(selected?.fg_type || order.item.finished_good_type).toUpperCase() as OrderItemDraft["finished_good_type"],
                                                            qty_uom: String(selected?.fg_type || order.item.finished_good_type).toUpperCase() === "ROLL" ? "KG" : order.item.qty_uom,
                                                            price_basis: String(selected?.fg_type || order.item.finished_good_type).toUpperCase() === "ROLL" ? "KG" : order.item.price_basis,
                                                            roll_form: String(selected?.fg_type || order.item.finished_good_type).toUpperCase() === "ROLL" ? (order.item.roll_form || "FLAT") : "",
                                                            savedPreview: null,
                                                        },
                                                    }))
                                                }}
                                            >
                                                <SelectTrigger data-testid="sales-batch-template" className={styles.compactSelect}>
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
                                    </div>

                                    <div className={styles.previewStrip}>
                                        <InfoChip tone="qty">{activeEstimatedKg.toFixed(2)} kg</InfoChip>
                                        <InfoChip tone="qty">{activeEstimatedPcs !== null ? `${activeEstimatedPcs} pcs` : "— pcs"}</InfoChip>
                                        <InfoChip tone="type">{activeOrder.item.finished_good_type}</InfoChip>
                                        <InfoChip tone="geometry">{itemSpecLabel(activeOrder.item)}</InfoChip>
                                        {activeLayerLabels.map((label) => (
                                            <InfoChip key={`active-layer-${label}`} tone="layer">{label}</InfoChip>
                                        ))}
                                        <InfoChip tone="printing">{itemPrintingLabel(activeOrder.item)}</InfoChip>
                                        {activePackagingLabels.map((label) => (
                                            <InfoChip key={`active-pack-${label}`} tone={label.startsWith("POD ") ? "pod" : "packaging"}>{label}</InfoChip>
                                        ))}
                                        <InfoChip tone="template">{itemTemplateTag(activeOrder.item, templates)}</InfoChip>
                                        <InfoChip tone="status">{pricingBasisSummary(activeOrder.item)}</InfoChip>
                                        <InfoChip tone="value">{formatMoney(activeEstimatedValue)}</InfoChip>
                                    </div>

                                    {previewError ? (
                                        <div className={styles.inlineAlert}>{previewError}</div>
                                    ) : null}

                                    <div className={styles.actionRow}>
                                        <div className={styles.actionGroup}>
                                            <Button variant="outline" size="sm" onClick={() => duplicateQueuedOrder(activeOrder.localId)}>
                                                <Copy className="mr-2 h-4 w-4" />
                                                Duplicate
                                            </Button>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => openSaveSkuDialog(activeOrder.item)}
                                                disabled={!activeOrder.item.template_id}
                                            >
                                                <Save className="mr-2 h-4 w-4" />
                                                Save as SKU
                                            </Button>
                                            {activeOrder.createdOrderId ? (
                                                <Button variant="outline" size="sm" asChild>
                                                    <Link href={`/sales/orders/${activeOrder.createdOrderId}`}>
                                                        Open order <ArrowUpRight className="ml-2 h-4 w-4" />
                                                    </Link>
                                                </Button>
                                            ) : null}
                                            {activeOrder.submitStatus === "failed" ? (
                                                <Button variant="outline" size="sm" onClick={() => retrySpecificOrder(activeOrder.localId)} disabled={batchCreateMutation.isPending}>
                                                    Retry
                                                </Button>
                                            ) : null}
                                        </div>

                                        <Button variant="outline" size="sm" className={styles.removeBtn} onClick={() => removeQueuedOrder(activeOrder.localId)}>
                                            Remove
                                        </Button>
                                    </div>
                                </section>

                                <section className={styles.panel}>
                                    <div className={styles.panelTopline}>
                                        <div>
                                            <div className={styles.panelLabel}>Technical Truth</div>
                                            <div className={styles.panelHint}>
                                                {activeOrder.item.advancedUnlocked
                                                    ? "This line is in detailed mode. Geometry, layers, printing, add-ons, packaging, and POD are editable."
                                                    : "Shared SKU and repeat keep product physics locked by default for speed."}
                                            </div>
                                        </div>
                                        <div className={styles.actionGroup}>
                                            {!activeOrder.item.advancedUnlocked ? (
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    onClick={() =>
                                                        updateQueuedOrder(activeOrder.localId, (order) => ({
                                                            ...order,
                                                            sourceType: "CUSTOM",
                                                            item: {
                                                                ...order.item,
                                                                sourceType: "CUSTOM",
                                                                advancedUnlocked: true,
                                                                savedPreview: null,
                                                            },
                                                        }))
                                                    }
                                                >
                                                    <Wand2 className="mr-2 h-4 w-4" />
                                                    Convert to custom
                                                </Button>
                                            ) : null}
                                            {activeOrder.item.advancedUnlocked ? (
                                                <Button variant="outline" size="sm" onClick={() => setTechnicalEditorOpen((open) => !open)}>
                                                    {technicalEditorOpen ? "Hide spec editor" : "Open spec editor"}
                                                </Button>
                                            ) : null}
                                        </div>
                                    </div>

                                    <div className={styles.previewStrip}>
                                        <InfoChip tone="sku">{activeOrder.sourceMeta}</InfoChip>
                                        <InfoChip tone="type">{activeOrder.item.finished_good_type}</InfoChip>
                                        <InfoChip tone="geometry">{itemSpecLabel(activeOrder.item)}</InfoChip>
                                        {activeLayerLabels.map((label) => (
                                            <InfoChip key={`truth-layer-${label}`} tone="layer">{label}</InfoChip>
                                        ))}
                                        <InfoChip tone="printing">{itemPrintingLabel(activeOrder.item)}</InfoChip>
                                        {activePackagingLabels.map((label) => (
                                            <InfoChip key={`truth-pack-${label}`} tone={label.startsWith("POD ") ? "pod" : "packaging"}>{label}</InfoChip>
                                        ))}
                                        <InfoChip tone="template">{itemTemplateTag(activeOrder.item, templates)}</InfoChip>
                                    </div>

                                    <div className={styles.lockedSummary}>
                                        <div className={styles.lockedCard}>
                                            <div className={styles.lockedLabel}>Live Weight</div>
                                            <div className={styles.lockedValue}>
                                                {activeEstimatedKg.toFixed(3)} kg
                                            </div>
                                            <div className={styles.lockedSubvalue}>
                                                {activeEstimatedPcs !== null ? `${activeEstimatedPcs} pcs` : "— pcs"}
                                            </div>
                                        </div>
                                        <div className={styles.lockedCard}>
                                            <div className={styles.lockedLabel}>Unit Weight</div>
                                            <div className={styles.lockedValue}>
                                                {activeOrder.item.finished_good_type === "ROLL"
                                                    ? `${activeEstimatedKg.toFixed(3)} kg/roll`
                                                    : `${activeUnitWeightG.toFixed(3)} g/pc`}
                                            </div>
                                            <div className={styles.lockedSubvalue}>
                                                Qty {activeOrder.item.qty_value} {activeOrder.item.qty_uom} · {pricingBasisSummary(activeOrder.item)}
                                            </div>
                                        </div>
                                        <div className={styles.lockedCard}>
                                            <div className={styles.lockedLabel}>Geometry</div>
                                            <div className={styles.lockedValue}>{itemSpecLabel(activeOrder.item)}</div>
                                            <div className={styles.lockedSubvalue}>{activeOrder.item.finished_good_type}</div>
                                        </div>
                                        <div className={styles.lockedCard}>
                                            <div className={styles.lockedLabel}>Layers</div>
                                            <div className={styles.lockedValue}>{activeLayerLabels.length} layer(s)</div>
                                            <div className={styles.lockedSubvalue}>{activeLayerLabels.join(" · ") || "No layers"}</div>
                                        </div>
                                        <div className={styles.lockedCard}>
                                            <div className={styles.lockedLabel}>Printing</div>
                                            <div className={styles.lockedValue}>{itemPrintingLabel(activeOrder.item)}</div>
                                            <div className={styles.lockedSubvalue}>
                                                {activeOrder.item.printing.enabled
                                                    ? `${activeOrder.item.printing.front_colors_count + activeOrder.item.printing.back_colors_count} colors`
                                                    : "No artwork dependency"}
                                            </div>
                                        </div>
                                        <div className={styles.lockedCard}>
                                            <div className={styles.lockedLabel}>Packaging</div>
                                            <div className={styles.lockedValue}>{activePackagingLabels[0] || "Standard pack"}</div>
                                            <div className={styles.lockedSubvalue}>
                                                {activePackagingLabels.slice(1).join(" · ") || itemPackagingWeightLabel(activeOrder.item)}
                                            </div>
                                        </div>
                                    </div>

                                    {activeOrder.item.advancedUnlocked && technicalEditorOpen ? (
                                        <OrderItemTechnicalEditor
                                            item={activeOrder.item}
                                            templates={templates}
                                            families={families}
                                            variants={variants}
                                            addonsMaster={addonsMaster}
                                            packagingMaterials={packagingMaterials}
                                            podProfiles={podProfiles}
                                            artworks={artworks}
                                            previewLoading={previewLoading}
                                            previewError={previewError}
                                            onPreviewRetry={() => {
                                                if (!activeOrder.item.template_id) return
                                                setPreviewError("")
                                                setPreviewNonce((current) => current + 1)
                                            }}
                                            updateItem={(updater) =>
                                                updateQueuedOrder(activeOrder.localId, (order) => {
                                                    const nextItem = updater(order.item)
                                                    return {
                                                        ...order,
                                                        item: nextItem,
                                                        sourceType: nextItem.sourceType,
                                                    }
                                                })
                                            }
                                        />
                                    ) : null}
                                </section>
                            </>
                        ) : (
                            <section className={cn(styles.panel, styles.emptyStatePanel)} data-testid="sales-batch-empty-state">
                                <div className={styles.emptyStateCopy}>
                                    <ShoppingCart className="h-6 w-6" />
                                    <div>
                                        <div className={styles.emptyStateTitle}>Queue the first line</div>
                                        <div className={styles.emptyStateText}>
                                            Select a customer, stage a shared SKU, or start from repeat/custom. Each queued card still becomes one separate sales order.
                                        </div>
                                    </div>
                                </div>
                            </section>
                        )}
                    </div>

                    <aside className={styles.cartRail}>
                        <div className={styles.cartHeader}>
                            <div>
                                <div className={styles.panelLabel}>Release Cart</div>
                                <div className={styles.panelHint}>{queueDraftCount} draft · {queueCreatedCount} ok · {queueFailedCount} err</div>
                            </div>
                            <div className={styles.cartHeaderMetrics}>
                                <span>{totalEstimatedWeightKg.toFixed(2)} kg</span>
                                <span>{formatMoney(totalEstimatedValue)}</span>
                            </div>
                        </div>

                        <div className={styles.cartBody}>
                            {!queue.length ? (
                                <div className={styles.emptyCart}>
                                    Select SKU, set quantity, and queue lines here.
                                </div>
                            ) : (
                                queue.map((order) => {
                                    const isActive = order.localId === activeOrderId
                                    return (
                                        <button
                                            key={order.localId}
                                            type="button"
                                            data-testid="sales-batch-queue-card"
                                            className={cn(styles.cartItem, isActive && styles.cartItemActive)}
                                            onClick={() => setActiveOrderId(order.localId)}
                                        >
                                            <div className={styles.cartItemTop}>
                                                <div className={styles.cartItemName}>{order.orderName || order.item.line_name || "Queued order"}</div>
                                                <span className={cn(styles.cartStatusDot, order.submitStatus === "created" ? styles.dotSuccess : order.submitStatus === "failed" ? styles.dotError : order.submitStatus === "submitting" ? styles.dotBusy : styles.dotDraft)} />
                                            </div>
                                            <div className={styles.cartItemMeta}>
                                                {order.item.qty_value} {order.item.qty_uom} · {orderEstimatedKg(order.item).toFixed(2)} kg · {orderEstimatedPcs(order.item) !== null ? `${orderEstimatedPcs(order.item)} pcs` : "— pcs"}
                                            </div>
                                            <div className={styles.cartItemMeta}>
                                                {itemSpecLabel(order.item)} · {itemTemplateTag(order.item, templates)}
                                            </div>
                                            <div className={styles.cartItemMeta}>
                                                {itemLayerLabels(order.item, families, variants).join(" · ") || "No layers"} · {formatMoney(estimateOrderValue(order))}
                                            </div>
                                            <div className={styles.cartItemMeta}>
                                                {itemPackagingLabels(order.item, packagingMaterials).join(" · ")} · {formatDateLabel(order.deliveryDate)}
                                            </div>
                                            {order.createdOrderNumber ? <div className={styles.cartMessage}>Created {order.createdOrderNumber}</div> : null}
                                            {order.submitError ? <div className={cn(styles.cartMessage, styles.cartError)}>{order.submitError}</div> : null}
                                        </button>
                                    )
                                })
                            )}
                        </div>

                        <div className={styles.cartFooter}>
                            <Button variant="outline" size="sm" onClick={() => setQueue((current) => current.filter((order) => order.submitStatus === "created"))} disabled={!queueDraftCount && !queueFailedCount}>
                                Clear drafts
                            </Button>
                            <Button
                                size="sm"
                                data-testid="sales-batch-submit-mobile"
                                onClick={() => batchCreateMutation.mutate(undefined)}
                                disabled={!customerId || !queue.length || batchCreateMutation.isPending}
                                className={styles.submitBtn}
                            >
                                {batchCreateMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                                Submit all
                            </Button>
                        </div>
                    </aside>
                </div>
            </div>

            <Dialog open={repeatDialogOpen} onOpenChange={setRepeatDialogOpen}>
                <DialogContent data-testid="sales-repeat-dialog" className="h-[100dvh] max-h-[100dvh] w-screen max-w-none overflow-y-auto rounded-none p-0 sm:h-auto sm:max-h-[94vh] sm:w-[calc(100vw-1rem)] sm:max-w-[min(78rem,calc(100vw-1rem))] sm:rounded-[2rem]">
                    <DialogHeader>
                        <DialogTitle className="px-6 pt-6">Repeat Customer Order</DialogTitle>
                        <DialogDescription>
                            Search this customer’s prior lines, then repeat exactly, edit commercial fields, convert to detailed, or promote to SKU.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 px-6 pb-6">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                            <Input
                                className="pl-10"
                                value={repeatSearch}
                                onChange={(event) => setRepeatSearch(event.target.value)}
                                placeholder="Search order no, line name, template, or SKU variant"
                            />
                        </div>
                        <ScrollArea className="pr-3">
                            <div className="space-y-3">
                                {repeatLinesFetching && !repeatLines.length ? (
                                    <div
                                        data-testid="sales-repeat-loading"
                                        className="rounded-2xl border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-500"
                                    >
                                        Searching repeat candidates...
                                    </div>
                                ) : null}
                                {!repeatLinesFetching && !repeatLines.length ? (
                                    <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-500">
                                        No repeat candidates found for this customer.
                                    </div>
                                ) : repeatLines.map((candidate) => (
                                    <div key={candidate.id} className="rounded-3xl border border-slate-200 bg-white p-4">
                                        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                                            <div className="space-y-3">
                                                <div>
                                                    <div className="text-sm font-black text-slate-900">{candidate.line_name || candidate.template_name}</div>
                                                    <div className="mt-1 text-xs text-slate-500">
                                                        {candidate.order_number} • {formatDateLabel(candidate.order_created_at)} • {candidate.template_name}
                                                    </div>
                                                </div>
                                                <div className="flex flex-wrap gap-2">
                                                    <Badge variant="outline">{candidate.summary.finished_good_type}</Badge>
                                                    <Badge variant="outline">
                                                        {candidate.summary.finished_good_type === "ROLL"
                                                            ? candidate.summary.roll_form || "FLAT"
                                                            : `${candidate.summary.width_mm || 0}W x ${candidate.summary.height_mm || 0}H`}
                                                    </Badge>
                                                    <Badge variant="outline">{candidate.summary.layer_count || 0} layer(s)</Badge>
                                                    {candidate.summary.printing_enabled ? <Badge variant="outline">{candidate.summary.printing_type || "PRINT"}</Badge> : null}
                                                    {candidate.summary.pod_enabled ? <Badge variant="outline">POD</Badge> : null}
                                                    <Badge variant="outline">{formatMoney(asNumber(candidate.unit_price, 0))} / {candidate.price_basis}</Badge>
                                                </div>
                                            </div>
                                            <div className="flex flex-wrap gap-2">
                                                <Button data-testid="sales-repeat-exact" variant="outline" onClick={() => addRepeatToBatch(candidate, false)}>
                                                    Repeat Exact
                                                </Button>
                                                <Button data-testid="sales-repeat-edit-commercial" onClick={() => addRepeatToBatch(candidate, false)}>
                                                    Repeat & Edit Commercial
                                                </Button>
                                                <Button data-testid="sales-repeat-convert-custom" variant="outline" onClick={() => addRepeatToBatch(candidate, true)}>
                                                    Convert to Custom Detailed
                                                </Button>
                                                <Button
                                                    variant="outline"
                                                    onClick={() => {
                                                        setRepeatDialogOpen(false)
                                                        openSaveSkuDialog(orderItemFromRepeat(candidate))
                                                    }}
                                                >
                                                    Save as SKU Variant
                                                </Button>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </ScrollArea>
                    </div>
                </DialogContent>
            </Dialog>

            <SaveSkuVariantDialog
                open={saveSkuOpen}
                onOpenChange={setSaveSkuOpen}
                salesSkus={salesSkus}
                form={saveSkuForm}
                setForm={setSaveSkuForm}
                isSaving={saveSkuMutation.isPending}
                onSave={() => saveSkuMutation.mutate()}
            />
        </div>
    )
}

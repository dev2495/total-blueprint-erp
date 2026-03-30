"use client"

import Link from "next/link"
import { type Dispatch, type ReactNode, type SetStateAction, useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
    ArrowUpRight,
    Copy,
    Layers3,
    Loader2,
    Package2,
    Plus,
    Repeat2,
    Save,
    Search,
    ShoppingCart,
    Sparkles,
    Wand2,
} from "lucide-react"

import {
    PremiumHero,
    PremiumMetricCard,
    PremiumMetricStrip,
    PremiumPageShell,
    PremiumSection,
} from "@/components/ui-custom/premium-page-shell"
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
import { Separator } from "@/components/ui/separator"
import { useToast } from "@/hooks/use-toast"
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

function sourceTone(sourceType: OrderDraftSource) {
    if (sourceType === "SKU") return "border-emerald-200 bg-emerald-50 text-emerald-700"
    if (sourceType === "REPEAT") return "border-indigo-200 bg-indigo-50 text-indigo-700"
    return "border-amber-200 bg-amber-50 text-amber-700"
}

function statusTone(status: QueueStatus) {
    if (status === "created") return "border-emerald-200 bg-emerald-50 text-emerald-700"
    if (status === "failed") return "border-rose-200 bg-rose-50 text-rose-700"
    if (status === "submitting") return "border-sky-200 bg-sky-50 text-sky-700"
    return "border-slate-200 bg-slate-100 text-slate-600"
}

function formatDateLabel(value: string) {
    if (!value) return "No date"
    const parsed = new Date(value)
    if (Number.isNaN(parsed.getTime())) return value
    return parsed.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })
}

function summarizeItem(item: OrderItemDraft) {
    if (item.finished_good_type === "ROLL") {
        return item.roll_form || "FLAT"
    }
    return `${item.geometry.base.width_mm}W x ${item.geometry.base.height_mm}H`
}

function estimateOrderValue(order: BatchQueuedOrder) {
    const qtyBasis = order.item.price_basis === "KG"
        ? asNumber(order.item.savedPreview?.total_weight_kg, 0)
        : asNumber(order.item.qty_value, 0)
    return qtyBasis * asNumber(order.item.unit_price, 0)
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

function QueueLane({
    title,
    description,
    icon,
    disabled,
    dataTestId,
    onClick,
}: {
    title: string
    description: string
    icon: ReactNode
    disabled?: boolean
    dataTestId?: string
    onClick: () => void
}) {
    return (
        <button
            type="button"
            data-testid={dataTestId}
            onClick={onClick}
            disabled={disabled}
            className="group rounded-[1.6rem] border border-slate-200/80 bg-white/92 p-4 text-left shadow-[0_18px_38px_-34px_rgba(15,23,42,0.4)] transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_22px_48px_-32px_rgba(15,23,42,0.32)] disabled:cursor-not-allowed disabled:opacity-50"
        >
            <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                    <div className="text-sm font-black tracking-tight text-slate-900">{title}</div>
                    <div className="text-xs leading-5 text-slate-500 sm:text-[13px]">{description}</div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-2.5 text-slate-600 shadow-sm">
                    {icon}
                </div>
            </div>
        </button>
    )
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
    const [sharedSkuOpen, setSharedSkuOpen] = useState(false)
    const [repeatDialogOpen, setRepeatDialogOpen] = useState(false)
    const [selectedSkuId, setSelectedSkuId] = useState("")
    const [skuSearch, setSkuSearch] = useState("")
    const [variantSearch, setVariantSearch] = useState("")
    const [repeatSearch, setRepeatSearch] = useState("")
    const [saveSkuOpen, setSaveSkuOpen] = useState(false)
    const [saveSkuTarget, setSaveSkuTarget] = useState<OrderItemDraft | null>(null)
    const [previewNonce, setPreviewNonce] = useState(0)
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

    const totalEstimatedWeightKg = queue.reduce((sum, order) => sum + asNumber(order.item.savedPreview?.total_weight_kg, 0), 0)
    const totalEstimatedValue = queue.reduce((sum, order) => sum + estimateOrderValue(order), 0)

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
        setSharedSkuOpen(false)
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
    const activeEstimatedWeight = asNumber(activeOrder?.item.savedPreview?.total_weight_kg, 0)
    const activeTemplate = templates.find((template: any) => String(template.id) === String(activeItem?.template_id || ""))

    return (
        <PremiumPageShell className="min-w-0" dataTestId="sales-order-batch-workspace-page">
            <PremiumHero
                dataTestId="sales-batch-hero"
                eyebrow="Sales Order Studio"
                title="Batch single orders for one customer"
                description="Queue repeat, shared-SKU, and custom detailed orders with clean commercial editing. Every card still submits as its own sales order."
                actions={(
                    <>
                        <Button variant="outline" asChild className="border-white/20 bg-white/10 text-white hover:bg-white/15 hover:text-white">
                            <Link href="/sales/sku-catalog">Open SKU Catalog</Link>
                        </Button>
                        <Button variant="outline" asChild className="border-white/20 bg-white/10 text-white hover:bg-white/15 hover:text-white">
                            <Link href="/sales/orders">Back to Orders</Link>
                        </Button>
                        <Button
                            data-testid="sales-batch-submit"
                            onClick={() => batchCreateMutation.mutate(undefined)}
                            disabled={!customerId || !queue.length || batchCreateMutation.isPending}
                            className="bg-white text-slate-950 hover:bg-slate-100"
                        >
                            {batchCreateMutation.isPending ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                                <Save className="mr-2 h-4 w-4" />
                            )}
                            Submit Batch Singles
                        </Button>
                    </>
                )}
                metrics={(
                    <PremiumMetricStrip>
                        <PremiumMetricCard label="Customer" value={customerName || "Choose customer"} hint="Single-customer queue" tone="dark" valueClassName="text-lg sm:text-xl xl:text-[1.35rem]" />
                        <PremiumMetricCard label="Queued Orders" value={<span data-testid="sales-batch-queue-count">{queue.length}</span>} tone="dark" />
                        <PremiumMetricCard label="Estimated Weight" value={`${totalEstimatedWeightKg.toFixed(2)} KG`} tone="dark" />
                        <PremiumMetricCard label="Estimated Value" value={formatMoney(totalEstimatedValue)} tone="dark" />
                    </PremiumMetricStrip>
                )}
            />

            <PremiumSection
                dataTestId="sales-batch-header"
                title="Customer Batch Header"
                description="Choose the customer once, then stage multiple single-order cards with isolated submit results."
            >
                <div className="grid gap-4 lg:grid-cols-[minmax(280px,1.3fr)_repeat(3,minmax(0,1fr))]">
                    <div className="space-y-2">
                        <Label>Customer</Label>
                        <Select value={customerId} onValueChange={handleCustomerChange}>
                            <SelectTrigger data-testid="sales-batch-customer" className="h-12 rounded-2xl bg-white">
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
                    <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/90 px-4 py-4">
                        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Queue Health</div>
                        <div className="mt-2 text-lg font-black text-slate-900">
                            {queue.filter((order) => order.submitStatus === "created").length} created / {queue.filter((order) => order.submitStatus === "failed").length} failed
                        </div>
                    </div>
                    <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/90 px-4 py-4">
                        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Fast-entry lanes</div>
                        <div className="mt-2 text-lg font-black text-slate-900">Shared SKU + Repeat</div>
                    </div>
                    <div className="rounded-[1.5rem] border border-slate-200 bg-slate-50/90 px-4 py-4">
                        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Detailed lane</div>
                        <div className="mt-2 text-lg font-black text-slate-900">Template-attached</div>
                    </div>
                </div>
            </PremiumSection>

            <div data-testid="sales-order-batch-workspace" className="grid min-w-0 gap-6 xl:grid-cols-[340px_minmax(0,1fr)] 2xl:grid-cols-[360px_minmax(0,1fr)]">
                    <div className="space-y-6">
                        <PremiumSection
                            dataTestId="sales-batch-lanes"
                            title="Add Order Lanes"
                            description="Choose the fastest lane for this customer. Shared SKU and repeat keep product physics locked until you explicitly unlock them."
                            actions={<ShoppingCart className="h-5 w-5 text-slate-400" />}
                            contentClassName="space-y-3"
                        >
                                <QueueLane
                                    title="Shared SKU"
                                    description="Pick a customer-ranked SKU variant and only edit commercial fields."
                                    icon={<Sparkles className="h-4 w-4" />}
                                    dataTestId="sales-batch-lane-shared"
                                    disabled={!customerId}
                                    onClick={() => setSharedSkuOpen(true)}
                                />
                                <QueueLane
                                    title="Repeat Order"
                                    description="Reuse a historical customer line, then keep or adjust the commercial inputs."
                                    icon={<Repeat2 className="h-4 w-4" />}
                                    dataTestId="sales-batch-lane-repeat"
                                    disabled={!customerId}
                                    onClick={() => setRepeatDialogOpen(true)}
                                />
                                <QueueLane
                                    title="Custom Detailed Order"
                                    description="Use the collapsible detailed editor for template-attached exceptional orders."
                                    icon={<Layers3 className="h-4 w-4" />}
                                    dataTestId="sales-batch-lane-custom"
                                    disabled={!customerId}
                                    onClick={addCustomDetailedOrder}
                                />
                        </PremiumSection>

                        <PremiumSection
                            dataTestId="sales-batch-queue-section"
                            title="Queued Single Orders"
                            description="Each card becomes one sales order and one sales order item."
                            contentClassName="p-3"
                        >
                                <ScrollArea className="pr-2">
                                    <div className="space-y-3">
                                        {!queue.length ? (
                                            <div className="rounded-3xl border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-500">
                                                Select a customer, then add shared-SKU, repeat, or custom detailed orders to the batch queue.
                                            </div>
                                        ) : null}
                                        {queue.map((order) => {
                                            const isActive = order.localId === activeOrderId
                                            return (
                                                <button
                                                    key={order.localId}
                                                    type="button"
                                                    data-testid="sales-batch-queue-card"
                                                    onClick={() => setActiveOrderId(order.localId)}
                                                    className={`w-full rounded-[1.6rem] border p-4 text-left transition ${isActive ? "border-slate-900 bg-slate-900 text-white shadow-xl" : "border-slate-200 bg-white/96 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_18px_45px_-36px_rgba(15,23,42,0.28)]"}`}
                                                >
                                                    <div className="flex items-start justify-between gap-3">
                                                        <div className="space-y-2">
                                                            <div className="text-sm font-black">{order.orderName || order.item.line_name || "Untitled queued order"}</div>
                                                            <div className="flex flex-wrap gap-2">
                                                                <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.18em] ${isActive ? "border-white/20 bg-white/10 text-white" : sourceTone(order.sourceType)}`}>
                                                                    {order.sourceType}
                                                                </span>
                                                                <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.18em] ${isActive ? "border-white/20 bg-white/10 text-white" : statusTone(order.submitStatus)}`}>
                                                                    {order.submitStatus}
                                                                </span>
                                                            </div>
                                                        </div>
                                                        <div className={`text-right text-xs ${isActive ? "text-white/80" : "text-slate-500"}`}>
                                                            <div>{order.item.qty_value} {order.item.qty_uom}</div>
                                                            <div>{formatMoney(order.item.unit_price)} / {order.item.price_basis}</div>
                                                        </div>
                                                    </div>
                                                    <div className={`mt-3 space-y-1 text-xs ${isActive ? "text-white/75" : "text-slate-500"}`}>
                                                        <div>{summarizeItem(order.item)} • {order.sourceMeta}</div>
                                                        <div>{formatDateLabel(order.deliveryDate)}</div>
                                                        {order.createdOrderNumber ? <div className="font-semibold">Created: {order.createdOrderNumber}</div> : null}
                                                        {order.submitError ? <div className="font-semibold text-rose-300">{order.submitError}</div> : null}
                                                    </div>
                                                </button>
                                            )
                                        })}
                                    </div>
                                </ScrollArea>
                        </PremiumSection>
                    </div>

                    <div className="min-w-0 space-y-6">
                        {activeOrder ? (
                            <>
                                <PremiumSection
                                    dataTestId="sales-batch-selected-order"
                                    title="Selected Order"
                                    description="Commercial summary, status, and quick actions for the active queued order."
                                    className="xl:sticky xl:top-4 xl:z-10"
                                >
                                    <div className="flex flex-col gap-5">
                                        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                                            <div className="space-y-3">
                                                <div className="flex flex-wrap gap-2">
                                                    <span className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] ${sourceTone(activeOrder.sourceType)}`}>
                                                        {activeOrder.sourceType}
                                                    </span>
                                                    <span className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] ${statusTone(activeOrder.submitStatus)}`}>
                                                        {activeOrder.submitStatus}
                                                    </span>
                                                </div>
                                                <div>
                                                    <h2 className="text-2xl font-black tracking-tight text-slate-900">
                                                        {activeOrder.orderName || activeOrder.item.line_name || "Queued order"}
                                                    </h2>
                                                    <p className="mt-1 text-sm text-slate-500">
                                                        {activeTemplate?.name || "Choose a LIVE template"} • {summarizeItem(activeOrder.item)} • {activeOrder.sourceMeta}
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="flex flex-wrap gap-2">
                                                {activeOrder.submitStatus === "failed" ? (
                                                    <Button variant="outline" onClick={() => retrySpecificOrder(activeOrder.localId)} disabled={batchCreateMutation.isPending}>
                                                        Retry This Order
                                                    </Button>
                                                ) : null}
                                                {activeOrder.createdOrderId ? (
                                                    <Button variant="outline" asChild>
                                                        <Link href={`/sales/orders/${activeOrder.createdOrderId}`}>
                                                            Open Order <ArrowUpRight className="ml-2 h-4 w-4" />
                                                        </Link>
                                                    </Button>
                                                ) : null}
                                                <Button variant="outline" onClick={() => duplicateQueuedOrder(activeOrder.localId)}>
                                                    <Copy className="mr-2 h-4 w-4" /> Duplicate
                                                </Button>
                                                <Button
                                                    variant="outline"
                                                    onClick={() => openSaveSkuDialog(activeOrder.item)}
                                                    disabled={!activeOrder.item.template_id}
                                                >
                                                    <Save className="mr-2 h-4 w-4" /> Save as SKU Variant
                                                </Button>
                                                <Button variant="outline" className="text-rose-600" onClick={() => removeQueuedOrder(activeOrder.localId)}>
                                                    Remove
                                                </Button>
                                            </div>
                                        </div>
                                        <PremiumMetricStrip className="md:grid-cols-2 xl:grid-cols-[minmax(0,1.55fr)_repeat(3,minmax(0,0.82fr))]">
                                            <PremiumMetricCard label="Template" value={activeTemplate?.name || "Missing"} valueClassName="text-base sm:text-lg xl:text-xl" />
                                            <PremiumMetricCard label="Delivery" value={formatDateLabel(activeOrder.deliveryDate)} valueClassName="text-base sm:text-lg xl:text-xl" />
                                            <PremiumMetricCard label="Estimated Weight" value={`${activeEstimatedWeight.toFixed(2)} KG`} />
                                            <PremiumMetricCard label="Estimated Value" value={formatMoney(activeEstimatedValue)} />
                                        </PremiumMetricStrip>
                                    </div>
                                </PremiumSection>

                                <PremiumSection
                                    dataTestId="sales-batch-basics"
                                    title="Basics"
                                    description="Commercial controls stay light for every lane. Technical sections open only for custom detailed orders."
                                >
                                    <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
                                        <div className="space-y-2 2xl:col-span-2">
                                            <Label>Order Name</Label>
                                            <Input
                                                data-testid="sales-batch-order-name"
                                                value={activeOrder.orderName}
                                                onChange={(event) =>
                                                    updateQueuedOrder(activeOrder.localId, (order) => ({
                                                        ...order,
                                                        orderName: event.target.value,
                                                    }))
                                                }
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Delivery Date</Label>
                                            <Input
                                                data-testid="sales-batch-delivery-date"
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
                                        <div className="space-y-2">
                                            <Label>Line Item Name</Label>
                                            <Input
                                                data-testid="sales-batch-line-name"
                                                value={activeOrder.item.line_name}
                                                onChange={(event) =>
                                                    updateQueuedOrder(activeOrder.localId, (order) => ({
                                                        ...order,
                                                        item: { ...order.item, line_name: event.target.value, savedPreview: null },
                                                    }))
                                                }
                                            />
                                        </div>
                                        <div className="space-y-2 md:col-span-2 2xl:col-span-2">
                                            <Label>Template</Label>
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
                                                            roll_form: String(selected?.fg_type || order.item.finished_good_type).toUpperCase() === "ROLL"
                                                                ? (order.item.roll_form || "FLAT")
                                                                : "",
                                                            savedPreview: null,
                                                        },
                                                    }))
                                                }}
                                            >
                                                <SelectTrigger data-testid="sales-batch-template" className="bg-white">
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
                                            <Input
                                                data-testid="sales-batch-qty"
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
                                        <div className="space-y-2">
                                            <Label>Qty UOM</Label>
                                            <Select
                                                value={activeOrder.item.qty_uom}
                                                onValueChange={(value) =>
                                                    updateQueuedOrder(activeOrder.localId, (order) => ({
                                                        ...order,
                                                        item: {
                                                            ...order.item,
                                                            qty_uom: order.item.finished_good_type === "ROLL" ? "KG" : (value as "PCS" | "KG"),
                                                            savedPreview: null,
                                                        },
                                                    }))
                                                }
                                            >
                                                <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="KG">KG</SelectItem>
                                                    {activeOrder.item.finished_good_type !== "ROLL" ? <SelectItem value="PCS">PCS</SelectItem> : null}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Price Basis</Label>
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
                                                <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="KG">Per KG</SelectItem>
                                                    {activeOrder.item.finished_good_type !== "ROLL" ? <SelectItem value="PCS">Per PCS</SelectItem> : null}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="space-y-2">
                                            <Label>Unit Price</Label>
                                            <Input
                                                data-testid="sales-batch-unit-price"
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
                                    </div>
                                </PremiumSection>

                                {activeOrder.item.advancedUnlocked ? (
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
                                ) : (
                                    <PremiumSection
                                        dataTestId="sales-batch-fast-entry-lock"
                                        title="Fast Entry Lock"
                                        description="This order keeps the technical structure locked for speed. Convert only if sales must change the product physics."
                                    >
                                        <div className="space-y-6">
                                            <div className="flex flex-wrap gap-2">
                                                <Badge variant="outline">{activeOrder.item.finished_good_type}</Badge>
                                                <Badge variant="outline">{summarizeItem(activeOrder.item)}</Badge>
                                                <Badge variant="outline">{activeOrder.item.film_layers.length} layer(s)</Badge>
                                                {activeOrder.item.printing.enabled ? <Badge variant="outline">{activeOrder.item.printing.type} print</Badge> : <Badge variant="outline">No print</Badge>}
                                                {activeOrder.item.packaging_snapshot.pod.enabled ? <Badge variant="outline">POD</Badge> : null}
                                            </div>
                                            <div className="grid gap-4 2xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
                                                <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
                                                    <div className="flex items-start justify-between gap-3">
                                                        <div>
                                                            <div className="text-sm font-black text-slate-900">Commercial-first configuration</div>
                                                            <p className="mt-1 text-sm leading-6 text-slate-500">
                                                                Technical data came from {activeOrder.sourceType === "SKU" ? "the shared SKU variant" : "the repeat-order snapshot"}.
                                                                Width, stack, print, add-ons, packaging, and POD are preserved until you explicitly unlock them.
                                                            </p>
                                                        </div>
                                                        <Package2 className="mt-1 h-5 w-5 text-slate-400" />
                                                    </div>
                                                    <Separator className="my-4" />
                                                    <div className="grid gap-3 md:grid-cols-2">
                                                        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                                                            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Template</div>
                                                            <div className="mt-2 text-sm font-black text-slate-900">{activeTemplate?.name || "Missing"}</div>
                                                        </div>
                                                        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                                                            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Source</div>
                                                            <div className="mt-2 text-sm font-black text-slate-900">{activeOrder.sourceMeta}</div>
                                                        </div>
                                                    </div>
                                                    <div className="mt-4">
                                                        <Button
                                                            variant="outline"
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
                                                            <Wand2 className="mr-2 h-4 w-4" /> Convert to Custom Detailed Order
                                                        </Button>
                                                    </div>
                                                </div>

                                                <div className="rounded-3xl border border-slate-200 bg-white p-5">
                                                    <div className="flex items-center justify-between gap-2">
                                                        <div>
                                                            <div className="text-sm font-black text-slate-900">Preview & BOM</div>
                                                            <p className="mt-1 text-sm text-slate-500">Still powered by the existing preview contract.</p>
                                                        </div>
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            onClick={() => {
                                                                if (!activeOrder.item.template_id) return
                                                                setPreviewError("")
                                                                setPreviewNonce((current) => current + 1)
                                                            }}
                                                        >
                                                            Refresh Preview
                                                        </Button>
                                                    </div>
                                                    <div className="mt-4 space-y-3">
                                                        {previewLoading ? (
                                                            <div className="flex items-center gap-2 text-sm text-slate-500">
                                                                <Loader2 className="h-4 w-4 animate-spin" /> Calculating preview...
                                                            </div>
                                                        ) : previewError ? (
                                                            <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-4 text-sm text-rose-700">
                                                                {previewError}
                                                            </div>
                                                        ) : activeOrder.item.savedPreview ? (
                                                            <>
                                                                <div className="grid gap-3 md:grid-cols-2">
                                                                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                                                                        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Unit Weight</div>
                                                                        <div className="mt-2 text-xl font-black text-slate-900">
                                                                            {activeOrder.item.finished_good_type === "ROLL"
                                                                                ? `${asNumber(activeOrder.item.savedPreview.roll_preview?.weight_kg, activeOrder.item.savedPreview.total_weight_kg).toFixed(2)} KG`
                                                                                : `${asNumber(activeOrder.item.savedPreview.unit_weight_g, 0).toFixed(3)} g`}
                                                                        </div>
                                                                    </div>
                                                                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                                                                        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Total Weight</div>
                                                                        <div className="mt-2 text-xl font-black text-slate-900">
                                                                            {asNumber(activeOrder.item.savedPreview.total_weight_kg, 0).toFixed(3)} KG
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                                <div className="space-y-2">
                                                                    {(activeOrder.item.savedPreview.bom_preview?.components || []).length === 0 ? (
                                                                        <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-6 text-sm text-slate-500">
                                                                            No BOM components resolved yet.
                                                                        </div>
                                                                    ) : (
                                                                        activeOrder.item.savedPreview.bom_preview.components.map((component, index) => (
                                                                            <div
                                                                                key={`${component.material_name}-${index}`}
                                                                                className="flex items-center justify-between rounded-2xl border border-slate-100 px-4 py-3 text-sm"
                                                                            >
                                                                                <span className="font-medium text-slate-700">{component.material_name}</span>
                                                                                <span className="font-black text-slate-900">{component.qty} {component.uom}</span>
                                                                            </div>
                                                                        ))
                                                                    )}
                                                                </div>
                                                            </>
                                                        ) : (
                                                            <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-sm text-slate-500">
                                                                Preview appears automatically once the order has enough valid data.
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </PremiumSection>
                                )}
                            </>
                        ) : (
                            <PremiumSection
                                dataTestId="sales-batch-empty-state"
                                title="Selected Order"
                                description="Pick a queued order to work on its commercial or detailed configuration."
                            >
                                <div className="flex min-h-[420px] items-center justify-center p-2 text-center sm:min-h-[540px]">
                                    <div className="space-y-3">
                                        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500">
                                            <ShoppingCart className="h-6 w-6" />
                                        </div>
                                        <div className="text-lg font-black text-slate-900">Select a queued order</div>
                                        <p className="max-w-md text-sm leading-6 text-slate-500">
                                            Add an order from Shared SKU, Repeat Order, or Custom Detailed Order and then edit its single-order details here.
                                        </p>
                                    </div>
                                </div>
                            </PremiumSection>
                        )}
                    </div>
                </div>

            <div className="mobile-safe-bottom sticky bottom-3 z-20 lg:hidden">
                <div className="rounded-[1.6rem] border border-slate-200/80 bg-white/92 p-3 shadow-[0_22px_48px_-32px_rgba(15,23,42,0.32)] backdrop-blur">
                    <Button
                        className="h-11 w-full rounded-2xl"
                        data-testid="sales-batch-submit-mobile"
                        onClick={() => batchCreateMutation.mutate(undefined)}
                        disabled={!customerId || !queue.length || batchCreateMutation.isPending}
                    >
                        {batchCreateMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                        Submit {queue.length || 0} queued order{queue.length === 1 ? "" : "s"}
                    </Button>
                </div>
            </div>

            <Dialog open={sharedSkuOpen} onOpenChange={setSharedSkuOpen}>
                <DialogContent data-testid="sales-shared-sku-dialog" className="h-[100dvh] max-h-[100dvh] w-screen max-w-none overflow-y-auto rounded-none p-0 sm:h-auto sm:max-h-[94vh] sm:w-[calc(100vw-1rem)] sm:max-w-[min(78rem,calc(100vw-1rem))] sm:rounded-[2rem]">
                    <DialogHeader>
                        <DialogTitle className="px-6 pt-6">Add Shared SKU Order</DialogTitle>
                        <DialogDescription>
                            Choose the shared SKU first, then the orderable variant for this customer.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-6 px-6 pb-6 lg:grid-cols-[280px_minmax(0,1fr)]">
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <Label>Search SKU</Label>
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                                    <Input
                                        className="pl-10"
                                        value={skuSearch}
                                        onChange={(event) => setSkuSearch(event.target.value)}
                                        placeholder="Code, name, template..."
                                    />
                                </div>
                            </div>
                            <ScrollArea className="pr-3">
                                <div className="space-y-2">
                                    {filteredSkus.map((sku) => (
                                        <button
                                            key={sku.id}
                                            type="button"
                                            onClick={() => setSelectedSkuId(sku.id)}
                                            className={`w-full rounded-2xl border p-3 text-left transition ${selectedSkuId === sku.id ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white hover:border-slate-300"}`}
                                        >
                                            <div className="text-sm font-black">{sku.code}</div>
                                            <div className={`mt-1 text-xs ${selectedSkuId === sku.id ? "text-white/75" : "text-slate-500"}`}>{sku.name}</div>
                                            <div className={`mt-2 text-[11px] font-semibold ${selectedSkuId === sku.id ? "text-white/75" : "text-slate-400"}`}>
                                                {sku.template_name || "No template"} • {sku.variants.length} variants
                                            </div>
                                        </button>
                                    ))}
                                    {!filteredSkus.length ? (
                                        <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                                            No shared SKUs matched this search.
                                        </div>
                                    ) : null}
                                </div>
                            </ScrollArea>
                        </div>

                        <div className="space-y-4">
                            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                                <div>
                                    <div className="text-sm font-black text-slate-900">
                                        {selectedSku ? `${selectedSku.code} variants` : "Select a SKU"}
                                    </div>
                                    <div className="mt-1 text-sm text-slate-500">
                                        Customer-ranked variants appear here for fast staging.
                                    </div>
                                </div>
                                <div className="w-full md:w-72">
                                    <Label className="mb-2 block">Search Variant</Label>
                                    <Input
                                        value={variantSearch}
                                        onChange={(event) => setVariantSearch(event.target.value)}
                                        placeholder="Code or variant name"
                                    />
                                </div>
                            </div>
                            <ScrollArea className="pr-3">
                                <div className="space-y-3">
                                    {selectedSku ? filteredSelectedVariants.map((variant) => (
                                        <div key={variant.id} className="rounded-3xl border border-slate-200 bg-white p-4">
                                            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                                <div className="space-y-2">
                                                    <div className="text-sm font-black text-slate-900">{variant.code} • {variant.name}</div>
                                                    <div className="flex flex-wrap gap-2">
                                                        <Badge variant="outline">{variant.finished_good_type}</Badge>
                                                        <Badge variant="outline">
                                                            {variant.finished_good_type === "ROLL"
                                                                ? variant.roll_form || "FLAT"
                                                                : `${variant.geometry_snapshot?.base?.width_mm || variant.geometry_snapshot?.width_mm || 0}W x ${variant.geometry_snapshot?.base?.height_mm || variant.geometry_snapshot?.height_mm || 0}H`}
                                                        </Badge>
                                                        <Badge variant="outline">{(variant.layer_snapshot || []).length} layer(s)</Badge>
                                                        {variant.printing_snapshot?.enabled ? <Badge variant="outline">{variant.printing_snapshot?.type || "PRINT"}</Badge> : null}
                                                    </div>
                                                    <div className="text-xs text-slate-500">{variant.template_name || selectedSku.template_name}</div>
                                                </div>
                                                <Button data-testid="sales-shared-sku-add" onClick={() => addSharedSkuToBatch(selectedSku, variant)}>
                                                    <Plus className="mr-2 h-4 w-4" /> Add to Batch
                                                </Button>
                                            </div>
                                        </div>
                                    )) : (
                                        <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                                            Choose a shared SKU to see its variants.
                                        </div>
                                    )}
                                    {selectedSku && !filteredSelectedVariants.length ? (
                                        <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">
                                            No variants matched this search.
                                        </div>
                                    ) : null}
                                </div>
                            </ScrollArea>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

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
        </PremiumPageShell>
    )
}

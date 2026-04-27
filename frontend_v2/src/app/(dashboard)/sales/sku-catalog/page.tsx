"use client"

import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useDeferredValue, useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
    ArrowUpRight,
    Clock3,
    Copy,
    Loader2,
    Plus,
    Save,
    Search,
    ShieldCheck,
    Sparkles,
    Zap,
} from "lucide-react"

import styles from "./sku-catalog.module.css"
import { cn } from "@/lib/utils"
import { normalizeProductSpec } from "@/lib/product-spec"
import OrderItemTechnicalEditor from "@/components/sales/shared/order-item-technical-editor"
import {
    SalesLayerTable,
    SalesOverflowChipGroup,
    SalesSavedViewsBar,
    SalesSmartRangeFilter,
    SalesSpecChips,
    SALES_GRADE_PRIORITY,
    SALES_MATERIAL_PRIORITY,
    SALES_SUPPORTED_FG_TYPES,
    salesMaterialFilterLabel,
    salesSortChipOptions,
    salesUniqueText,
    salesVariantSpecSource,
    specMatchesFilters,
    type SalesOverflowChipOption,
    type SalesSavedViewFilters,
} from "@/components/sales/sales-flow-ui"
import {
    asNumber,
    buildPreviewPayload,
    createEmptyOrderItemDraft,
    formatMoney,
    orderItemFromVariant,
    type OrderItemDraft,
} from "@/components/sales/shared/order-draft"
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
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/hooks/use-toast"
import { commercialFamilyService } from "@/services/commercial-families"
import { engineeringService } from "@/services/engineering"
import { filmFamilyService } from "@/services/film-families"
import { filmVariantService } from "@/services/film-variants"
import { masterDataService } from "@/services/master-data"
import { recipeService } from "@/services/recipes"
import {
    type RepeatLineCandidate,
    type SalesSku,
    type SalesSkuVariant,
    salesService,
} from "@/services/sales"
import { templateService } from "@/services/templates"

type SkuFormState = {
    code: string
    name: string
    template: string
    commercial_family: string
    default_line_name: string
    active: boolean
}

type VariantEditorState = {
    mode: "create" | "edit" | "clone"
    open: boolean
    skuId: string
    variantId: string
    code: string
    name: string
    active: boolean
    item: OrderItemDraft
}

function emptySkuForm(): SkuFormState {
    return {
        code: "",
        name: "",
        template: "",
        commercial_family: "",
        default_line_name: "",
        active: true,
    }
}

function skuStatusTone(active: boolean) {
    return active ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-100 text-slate-500"
}

function prepareDraftForSku(sku: SalesSku, templates: any[]) {
    const item = createEmptyOrderItemDraft("CUSTOM")
    item.template_id = sku.template
    item.line_name = sku.default_line_name || sku.name
    const template = templates.find((row: any) => String(row.id) === String(sku.template))
    const templateFgType = String(template?.fg_type || item.finished_good_type).toUpperCase()
    const fgType = (templateFgType === "ROLL" ? "ROLL" : "POUCH") as OrderItemDraft["finished_good_type"]
    item.finished_good_type = fgType
    item.qty_uom = fgType === "ROLL" ? "KG" : item.qty_uom
    item.price_basis = fgType === "ROLL" ? "KG" : item.price_basis
    item.roll_form = fgType === "ROLL" ? "FLAT" : ""
    return item
}

function uniqueText(values: Array<string | null | undefined>) {
    return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)))
}

function makeSkuRangePresets(values: Array<number | null | undefined>, suffix: string) {
    const counts = new Map<number, number>()
    values.forEach((value) => {
        const num = Number(value)
        if (!Number.isFinite(num) || num <= 0) return
        const rounded = Math.round(num)
        counts.set(rounded, (counts.get(rounded) || 0) + 1)
    })
    return Array.from(counts.entries())
        .sort((left, right) => right[1] - left[1] || left[0] - right[0])
        .slice(0, 10)
        .map(([value, count]) => ({ value: String(value), label: `${value} ${suffix}`, count }))
}

export default function SalesSkuCatalogPage() {
    const searchParams = useSearchParams()
    const queryClient = useQueryClient()
    const { toast } = useToast()

    const [search, setSearch] = useState("")
    const [activeFilter, setActiveFilter] = useState("active")
    const [fgTypeFilter, setFgTypeFilter] = useState("all")
    const [templateFilter, setTemplateFilter] = useState("all")
    const [usageCustomerId, setUsageCustomerId] = useState("all")
    const [usageOnly, setUsageOnly] = useState(false)
    const [sizeFilter, setSizeFilter] = useState("")
    const [heightFilter, setHeightFilter] = useState("")
    const [variantFilter, setVariantFilter] = useState("")
    const [gradeFilter, setGradeFilter] = useState("")
    const [thicknessFilter, setThicknessFilter] = useState("")
    const [selectedSkuId, setSelectedSkuId] = useState("")
    const [selectedVariantId, setSelectedVariantId] = useState("")
    const [skuDialogOpen, setSkuDialogOpen] = useState(false)
    const [skuDialogMode, setSkuDialogMode] = useState<"create" | "edit">("create")
    const [skuForm, setSkuForm] = useState<SkuFormState>(emptySkuForm())
    const [variantDialog, setVariantDialog] = useState<VariantEditorState>({
        mode: "create",
        open: false,
        skuId: "",
        variantId: "",
        code: "",
        name: "",
        active: true,
        item: createEmptyOrderItemDraft("CUSTOM"),
    })
    const [variantPreviewError, setVariantPreviewError] = useState("")
    const [variantPreviewLoading, setVariantPreviewLoading] = useState(false)
    const [variantPreviewNonce, setVariantPreviewNonce] = useState(0)
    const [usageDialogOpen, setUsageDialogOpen] = useState(false)
    const [queryVariantDialogOpened, setQueryVariantDialogOpened] = useState(false)
    const deferredSearch = useDeferredValue(search)

    const { data: customers = [] } = useQuery({ queryKey: ["customers"], queryFn: masterDataService.getCustomers })
    const { data: templates = [] } = useQuery({
        queryKey: ["templates", "live-only"],
        queryFn: () => templateService.getTemplates({ status: "LIVE" }),
    })
    const { data: commercialFamilies = [] } = useQuery({
        queryKey: ["commercial-families"],
        queryFn: commercialFamilyService.getAll,
    })
    const { data: families = [] } = useQuery({ queryKey: ["film-families"], queryFn: filmFamilyService.getAll })
    const { data: variants = [] } = useQuery({ queryKey: ["film-variants"], queryFn: filmVariantService.getAll })
    const { data: addonsMaster = [] } = useQuery({ queryKey: ["addons"], queryFn: masterDataService.getAddons })
    const { data: packagingMaterials = [] } = useQuery({
        queryKey: ["packaging-materials"],
        queryFn: masterDataService.getPackaging,
    })
    const { data: masterGrades = [] } = useQuery({ queryKey: ["recipe-grades"], queryFn: () => recipeService.getGrades() })
    const { data: podProfiles = [] } = useQuery({ queryKey: ["pod-sku-variants", "sku-catalog"], queryFn: () => masterDataService.getPodSkuVariants({ active: true }) })
    const { data: salesSkus = [] } = useQuery({
        queryKey: ["sales-skus", usageCustomerId, activeFilter],
        queryFn: () =>
            salesService.getSalesSkus({
                customer_id: usageCustomerId !== "all" ? usageCustomerId : undefined,
                active: activeFilter === "active" ? true : activeFilter === "inactive" ? false : undefined,
            }),
    })
    const { data: artworks = [] } = useQuery({
        queryKey: [
            "engineering-artworks",
            variantDialog.item.printing.type,
            variantDialog.item.printing.front_colors_count,
            variantDialog.item.printing.back_colors_count,
            variantDialog.item.printing.enabled,
            variantDialog.item.printing.defer_artwork_to_planner,
        ],
        queryFn: () =>
            engineeringService.getArtworks({
                status: "APPROVED",
                print_type: variantDialog.item.printing.type,
                front_colors_count: variantDialog.item.printing.front_colors_count,
                back_colors_count: variantDialog.item.printing.back_colors_count,
                cylinder_ready: variantDialog.item.printing.type === "ROTO" ? "true" : undefined,
                exclude_cylinder_artwork: variantDialog.item.printing.type === "FLEXO" ? "true" : undefined,
            }),
        enabled: Boolean(variantDialog.item.printing.enabled && !variantDialog.item.printing.defer_artwork_to_planner && variantDialog.open),
    })

    const currentSavedViewFilters: SalesSavedViewFilters = {
        search,
        activeFilter,
        fgTypeFilter,
        templateFilter,
        usageCustomerId,
        usageOnly,
        sizeFilter,
        heightFilter,
        variantFilter,
        gradeFilter,
        thicknessFilter,
    }

    const applySavedViewFilters = (filters: SalesSavedViewFilters) => {
        if (typeof filters.search === "string") setSearch(filters.search)
        if (typeof filters.activeFilter === "string") setActiveFilter(filters.activeFilter)
        if (typeof filters.fgTypeFilter === "string") setFgTypeFilter(filters.fgTypeFilter)
        if (typeof filters.templateFilter === "string") setTemplateFilter(filters.templateFilter)
        if (typeof filters.usageCustomerId === "string") setUsageCustomerId(filters.usageCustomerId)
        if (typeof filters.usageOnly === "boolean") setUsageOnly(filters.usageOnly)
        if (typeof filters.sizeFilter === "string") setSizeFilter(filters.sizeFilter)
        if (typeof filters.heightFilter === "string") setHeightFilter(filters.heightFilter)
        if (typeof filters.variantFilter === "string") setVariantFilter(filters.variantFilter)
        if (typeof filters.gradeFilter === "string") setGradeFilter(filters.gradeFilter)
        if (typeof filters.thicknessFilter === "string") setThicknessFilter(filters.thicknessFilter)
    }

    const skuVariantSpecs = useMemo(
        () =>
            salesSkus.flatMap((sku) =>
                (sku.variants || []).map((variant) => ({
                    sku,
                    variant,
                    spec: normalizeProductSpec(salesVariantSpecSource(sku, variant)),
                }))
            ),
        [salesSkus]
    )
    const materialOptions = useMemo<SalesOverflowChipOption[]>(() => {
        const labels = salesUniqueText([
            ...SALES_MATERIAL_PRIORITY,
            ...families.flatMap((family: any) => [family?.code, family?.name]),
            ...variants.flatMap((variant: any) => [variant?.code, variant?.name, variant?.parent_family_name]),
            ...skuVariantSpecs.flatMap(({ spec }) => spec.layers.flatMap((layer) => [salesMaterialFilterLabel(layer.variantName), salesMaterialFilterLabel(layer.variantCode)])),
        ]).map(salesMaterialFilterLabel).filter(Boolean)
        return salesSortChipOptions(
            salesUniqueText(labels).map((material) => ({
                value: material,
                label: material,
                count: skuVariantSpecs.filter(({ spec }) => spec.searchText.toLowerCase().includes(material.toLowerCase())).length,
                tone: "material" as const,
            })),
            SALES_MATERIAL_PRIORITY
        )
    }, [families, skuVariantSpecs, variants])
    const gradeOptions = useMemo<SalesOverflowChipOption[]>(() => (
        salesSortChipOptions(
            uniqueText([
                ...SALES_GRADE_PRIORITY,
                ...masterGrades.map((grade: any) => grade?.name || grade?.code),
                ...skuVariantSpecs.flatMap(({ spec }) => spec.layers.map((layer) => layer.grade)),
            ])
                .map((grade) => ({
                value: grade,
                label: grade,
                count: skuVariantSpecs.filter(({ spec }) => spec.layers.some((layer) => String(layer.grade || "").toLowerCase().includes(grade.toLowerCase()))).length,
                tone: "grade" as const,
            })),
            SALES_GRADE_PRIORITY
        )
    ), [masterGrades, skuVariantSpecs])
    const widthPresets = useMemo(() => makeSkuRangePresets(skuVariantSpecs.flatMap(({ spec }) => [spec.size.widthMm, ...spec.layers.map((layer) => layer.widthMm)]), "mm"), [skuVariantSpecs])
    const heightPresets = useMemo(() => makeSkuRangePresets(skuVariantSpecs.map(({ spec }) => spec.size.heightMm), "mm"), [skuVariantSpecs])
    const thicknessPresets = useMemo(() => makeSkuRangePresets(skuVariantSpecs.flatMap(({ spec }) => spec.layers.map((layer) => layer.thicknessMicron)), "μ"), [skuVariantSpecs])

    const filteredSkus = useMemo(() => {
        const query = deferredSearch.trim().toLowerCase()
        return salesSkus.filter((sku) => {
            if (usageOnly && usageCustomerId !== "all" && !asNumber(sku.customer_usage_count, 0)) return false
            if (templateFilter !== "all" && String(sku.template) !== templateFilter) return false
            const matchingVariants = (sku.variants || []).filter((variant) => {
                const spec = normalizeProductSpec(salesVariantSpecSource(sku, variant))
                return specMatchesFilters(spec, { fgTypeFilter, sizeFilter, heightFilter, variantFilter, gradeFilter, thicknessFilter })
            })
            if (!matchingVariants.length && (sku.variants || []).length) return false
            if (!query) return true
            return [
                sku.code,
                sku.name,
                sku.default_line_name,
                sku.template_name,
                sku.commercial_family_name,
                ...(sku.variants || []).flatMap((variant) => {
                    const spec = normalizeProductSpec(salesVariantSpecSource(sku, variant))
                    return [variant.code, variant.name, spec.searchText]
                }),
            ]
                .filter(Boolean)
                .some((value) => String(value).toLowerCase().includes(query))
        })
    }, [deferredSearch, fgTypeFilter, gradeFilter, heightFilter, salesSkus, sizeFilter, templateFilter, thicknessFilter, usageCustomerId, usageOnly, variantFilter])

    const selectedSku = useMemo(
        () => filteredSkus.find((sku) => sku.id === selectedSkuId) || salesSkus.find((sku) => sku.id === selectedSkuId) || null,
        [filteredSkus, salesSkus, selectedSkuId]
    )

    const selectedSkuVariants = useMemo(() => {
        const source = selectedSku?.variants || []
        return source.filter((variant) => {
            const spec = normalizeProductSpec(salesVariantSpecSource(selectedSku, variant))
            return specMatchesFilters(spec, { fgTypeFilter, sizeFilter, heightFilter, variantFilter, gradeFilter, thicknessFilter })
        })
    }, [fgTypeFilter, gradeFilter, heightFilter, selectedSku, sizeFilter, thicknessFilter, variantFilter])

    const selectedVariant = useMemo(
        () => selectedSkuVariants.find((variant) => variant.id === selectedVariantId) || null,
        [selectedSkuVariants, selectedVariantId]
    )
    const dialogPlannerMatch = useMemo(() => {
        if (!variantDialog.variantId) return null
        return selectedSku?.variants?.find((variant) => variant.id === variantDialog.variantId) || null
    }, [selectedSku, variantDialog.variantId])

    const selectedVariantSpec = useMemo(
        () => selectedVariant ? normalizeProductSpec(salesVariantSpecSource(selectedSku, selectedVariant)) : null,
        [selectedSku, selectedVariant]
    )

    useEffect(() => {
        if (!filteredSkus.length) {
            setSelectedSkuId("")
            return
        }
        if (!selectedSkuId || !filteredSkus.some((sku) => sku.id === selectedSkuId)) {
            setSelectedSkuId(filteredSkus[0].id)
        }
    }, [filteredSkus, selectedSkuId])

    useEffect(() => {
        if (!selectedSkuVariants.length) {
            setSelectedVariantId("")
            return
        }
        if (!selectedVariantId || !selectedSkuVariants.some((variant) => variant.id === selectedVariantId)) {
            setSelectedVariantId(selectedSkuVariants[0].id)
        }
    }, [selectedSkuVariants, selectedVariantId])

    const usageHistoryQuery = useQuery({
        queryKey: ["sales-repeat-lines", "variant-usage", usageCustomerId, selectedVariant?.id],
        queryFn: async () => {
            const result = await salesService.getRepeatLines({
                customer_id: usageCustomerId !== "all" ? usageCustomerId : undefined,
                q: selectedVariant?.code || selectedVariant?.name || undefined,
            })
            return result.filter((row) => String(row.sku_variant_id || "") === String(selectedVariant?.id || ""))
        },
        enabled: Boolean(selectedVariant && usageDialogOpen),
    })

    const variantPreviewSignature = useMemo(() => {
        if (!variantDialog.open) return ""
        return JSON.stringify({
            ...variantDialog.item,
            savedPreview: null,
        })
    }, [variantDialog])

    useEffect(() => {
        if (!variantDialog.open || !variantDialog.item.template_id) {
            setVariantPreviewError("")
            return
        }
        const handle = window.setTimeout(async () => {
            try {
                setVariantPreviewLoading(true)
                setVariantPreviewError("")
                const preview = await salesService.previewItem(buildPreviewPayload(variantDialog.item, families, variants, addonsMaster))
                setVariantDialog((current) => ({
                    ...current,
                    item: { ...current.item, savedPreview: preview },
                }))
            } catch (error: any) {
                setVariantPreviewError(error?.response?.data?.detail || error?.message || "Unable to calculate variant preview.")
            } finally {
                setVariantPreviewLoading(false)
            }
        }, 350)
        return () => window.clearTimeout(handle)
    }, [addonsMaster, families, variantDialog.item.template_id, variantDialog.open, variantPreviewNonce, variantPreviewSignature, variants])

    const skuMutation = useMutation({
        mutationFn: async () => {
            const payload = {
                code: skuForm.code.trim().toUpperCase(),
                name: skuForm.name.trim(),
                template: skuForm.template,
                commercial_family: skuForm.commercial_family || null,
                default_line_name: skuForm.default_line_name.trim(),
                active: skuForm.active,
            }
            if (!payload.code || !payload.name || !payload.template) {
                throw new Error("SKU code, name, and LIVE template are required.")
            }
            if (skuDialogMode === "create") return salesService.createSalesSku(payload)
            if (!selectedSku) throw new Error("Select an SKU to edit.")
            return salesService.updateSalesSku(selectedSku.id, payload)
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["sales-skus"] })
            toast({
                title: skuDialogMode === "create" ? "SKU created" : "SKU updated",
                description: "The catalog header information is saved.",
            })
            setSkuDialogOpen(false)
        },
        onError: (error: any) => {
            toast({
                title: "Could not save SKU",
                description: error?.response?.data?.detail || error?.message || "Please review the SKU fields and try again.",
                variant: "destructive",
            })
        },
    })

    const variantMutation = useMutation({
        mutationFn: async () => {
            if (!variantDialog.skuId) throw new Error("Choose an SKU before saving a variant.")
            if (!variantDialog.code.trim() || !variantDialog.name.trim()) {
                throw new Error("Variant code and name are required.")
            }
            if (!variantDialog.item.template_id) {
                throw new Error("A LIVE template is required before saving the variant.")
            }
            const incompleteLayerIndex = variantDialog.item.film_layers.findIndex(
                (layer) => !layer.family_id || !layer.variant_id
            )
            if (incompleteLayerIndex >= 0) {
                throw new Error(`Layer ${incompleteLayerIndex + 1} must include both film family and film variant so density can resolve from master data.`)
            }
            const payload = {
                sku: variantDialog.skuId,
                code: variantDialog.code.trim().toUpperCase(),
                name: variantDialog.name.trim(),
                active: variantDialog.active,
                finished_good_type: variantDialog.item.finished_good_type,
                roll_form: variantDialog.item.roll_form,
                geometry_snapshot: variantDialog.item.geometry,
                layer_snapshot: variantDialog.item.film_layers,
                printing_snapshot: {
                    ...variantDialog.item.printing,
                    chemicals: variantDialog.item.chemicals,
                },
                chemicals_snapshot: variantDialog.item.chemicals,
                addons_snapshot: variantDialog.item.addons,
                packaging_snapshot: variantDialog.item.packaging_snapshot,
            }
            if (variantDialog.mode === "edit" && variantDialog.variantId) {
                return salesService.updateSalesSkuVariant(variantDialog.variantId, payload)
            }
            return salesService.createSalesSkuVariant(payload)
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["sales-skus"] })
            queryClient.invalidateQueries({ queryKey: ["sales-sku-variants"] })
            toast({
                title: variantDialog.mode === "edit" ? "Variant updated" : "Variant saved",
                description: "The fast-entry orderable option is ready for sales use.",
            })
            setVariantDialog((current) => ({ ...current, open: false }))
        },
        onError: (error: any) => {
            toast({
                title: "Could not save variant",
                description: error?.response?.data?.detail || error?.message || "Please review the variant details and try again.",
                variant: "destructive",
            })
        },
    })

    const toggleSkuMutation = useMutation({
        mutationFn: async () => {
            if (!selectedSku) throw new Error("Select an SKU first.")
            return salesService.updateSalesSku(selectedSku.id, { active: !selectedSku.active })
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["sales-skus"] })
        },
    })

    const toggleVariantMutation = useMutation({
        mutationFn: async () => {
            if (!selectedVariant) throw new Error("Select a variant first.")
            return salesService.updateSalesSkuVariant(selectedVariant.id, { active: !selectedVariant.active })
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["sales-skus"] })
            queryClient.invalidateQueries({ queryKey: ["sales-sku-variants"] })
        },
    })

    const openCreateSkuDialog = () => {
        setSkuDialogMode("create")
        setSkuForm(emptySkuForm())
        setSkuDialogOpen(true)
    }

    const openEditSkuDialog = () => {
        if (!selectedSku) return
        setSkuDialogMode("edit")
        setSkuForm({
            code: selectedSku.code,
            name: selectedSku.name,
            template: selectedSku.template,
            commercial_family: selectedSku.commercial_family || "",
            default_line_name: selectedSku.default_line_name || "",
            active: selectedSku.active,
        })
        setSkuDialogOpen(true)
    }

    const openCreateVariantDialog = () => {
        if (!selectedSku) return
        setVariantPreviewError("")
        setVariantPreviewNonce(0)
        setVariantDialog({
            mode: "create",
            open: true,
            skuId: selectedSku.id,
            variantId: "",
            code: "",
            name: "",
            active: true,
            item: prepareDraftForSku(selectedSku, templates),
        })
    }

    useEffect(() => {
        if (queryVariantDialogOpened) return
        if (searchParams?.get("create_variant") !== "1") return
        if (!selectedSku) return
        setQueryVariantDialogOpened(true)
        openCreateVariantDialog()
    }, [queryVariantDialogOpened, searchParams, selectedSku])

    const openVariantEditor = (mode: "edit" | "clone", variant: SalesSkuVariant) => {
        if (!selectedSku) return
        const draft = orderItemFromVariant(selectedSku, variant)
        draft.sourceType = "CUSTOM"
        draft.advancedUnlocked = true
        setVariantPreviewError("")
        setVariantPreviewNonce(0)
        setVariantDialog({
            mode,
            open: true,
            skuId: selectedSku.id,
            variantId: mode === "edit" ? variant.id : "",
            code: mode === "clone" ? `${variant.code}-COPY` : variant.code,
            name: mode === "clone" ? `${variant.name} Copy` : variant.name,
            active: variant.active,
            item: draft,
        })
    }

    return (
        <div className={styles.catalogShell} data-testid="sales-sku-catalog-page">
            <section className={styles.pageHeader} data-testid="sales-sku-catalog-hero">
                <div className={styles.pageHeaderCopy}>
                    <div className={styles.pageEyebrow}><Zap className="h-3 w-3" /> Sales Catalog</div>
                    <h1 className={styles.pageTitle}>Sales SKU Studio</h1>
                    <p className={styles.pageDescription}>
                        Build shared sales SKUs quickly, then author orderable variants with geometry, layers, printing, packaging, and POD truth in one place.
                    </p>
                </div>
                <div className={styles.pageActions}>
                    <Link href="/sales/orders/create" className={cn(styles.pageBtn, styles.pageBtnOutline)}>Launch Orders</Link>
                    <button type="button" className={cn(styles.pageBtn, styles.pageBtnOutline)} onClick={() => setUsageDialogOpen(true)} disabled={!selectedVariant}>
                        <Clock3 className="h-4 w-4" /> Usage History
                    </button>
                    <button type="button" data-testid="sales-sku-create" onClick={openCreateSkuDialog} className={cn(styles.pageBtn, styles.pageBtnPrimary)}>
                        <Plus className="h-4 w-4" /> New SKU
                    </button>
                </div>
            </section>

            <section className={styles.kpiStrip}>
                <div className={styles.kpiChip}>
                    <div className={styles.kpiLabel}>Total SKUs</div>
                    <div className={styles.kpiValue}>{filteredSkus.length}</div>
                </div>
                <div className={styles.kpiChip}>
                    <div className={styles.kpiLabel}>Total Variants</div>
                    <div className={styles.kpiValue}>
                        {filteredSkus.reduce((sum, sku) => sum + sku.variants.length, 0)}
                    </div>
                </div>
                <div className={styles.kpiChip}>
                    <div className={styles.kpiLabel}>Active Count</div>
                    <div className={styles.kpiValue}>
                        {filteredSkus.filter((sku) => sku.active).length}
                    </div>
                </div>
                <div className={styles.kpiChip}>
                    <div className={styles.kpiLabel}>Customer Lens</div>
                    <div className={styles.kpiValueSm}>{usageCustomerId === "all" ? "All customers" : customers.find((c) => c.id === usageCustomerId)?.name || "Customer"}</div>
                </div>
            </section>

            <SalesSavedViewsBar
                scope="sku_catalog"
                currentFilters={currentSavedViewFilters}
                onApply={applySavedViewFilters}
            />

            <section className={styles.filterBar} data-testid="sales-sku-catalog-filters">
                <div className={styles.filterRow}>
                    <div className={styles.searchCell}>
                        <Label className={styles.filterLabel}>Search the catalog</Label>
                        <Search className="absolute left-5 top-[2.35rem] h-4 w-4 text-slate-400" />
                        <Input
                            data-testid="sales-sku-search"
                            className="mt-2 h-11 rounded-2xl border-slate-200 bg-slate-50 pl-10"
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder="SKU, variant, template, customer context..."
                        />
                    </div>
                    <div className={cn(styles.filterCell, "space-y-2")}>
                        <Label className={styles.filterLabel}>Status</Label>
                        <Select value={activeFilter} onValueChange={setActiveFilter}>
                            <SelectTrigger className="h-10 rounded-2xl bg-slate-50"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="active">Active</SelectItem>
                                <SelectItem value="inactive">Inactive</SelectItem>
                                <SelectItem value="all">All</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className={cn(styles.filterCell, "space-y-2")}>
                        <SalesOverflowChipGroup
                            label="Finished good"
                            value={fgTypeFilter}
                            onChange={setFgTypeFilter}
                            allValue="all"
                            options={SALES_SUPPORTED_FG_TYPES.map((type) => ({
                                value: type,
                                label: type === "ROLL" ? "Roll" : "Pouch",
                                count: skuVariantSpecs.filter(({ variant }) => String(variant.finished_good_type || "").toUpperCase() === type).length,
                                tone: type === "ROLL" ? "fgRoll" : "fgPouch",
                            }))}
                            maxInline={3}
                        />
                    </div>
                    <div className={cn(styles.filterCell, "space-y-2")}>
                        <Label className={styles.filterLabel}>Template</Label>
                        <Select value={templateFilter} onValueChange={setTemplateFilter}>
                            <SelectTrigger className="h-10 rounded-2xl bg-slate-50"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All templates</SelectItem>
                                {templates.map((template: any) => (
                                    <SelectItem key={template.id} value={String(template.id)}>
                                        {template.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className={cn(styles.filterCell, "space-y-2")}>
                        <Label className={styles.filterLabel}>Usage Customer</Label>
                        <Select value={usageCustomerId} onValueChange={setUsageCustomerId}>
                            <SelectTrigger className="h-10 rounded-2xl bg-slate-50"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All customers</SelectItem>
                                {customers.map((customer) => (
                                    <SelectItem key={customer.id} value={customer.id}>
                                        {customer.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className={cn(styles.filterCell, styles.toggleCell)}>
                        <div>
                            <div className={styles.filterLabel}>Usage only</div>
                            <div className="mt-1 text-xs text-slate-500">Only customer-proven SKUs</div>
                        </div>
                        <Switch checked={usageOnly} onCheckedChange={setUsageOnly} />
                    </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                    <SalesSmartRangeFilter label="Width" value={sizeFilter} onChange={setSizeFilter} placeholder="420 / 1070" suffix="mm" presets={widthPresets} />
                    <SalesSmartRangeFilter label="Height" value={heightFilter} onChange={setHeightFilter} placeholder="200-320" suffix="mm" presets={heightPresets} />
                    <SalesSmartRangeFilter label="Thickness" value={thicknessFilter} onChange={setThicknessFilter} placeholder="12 / 47 / 50" suffix="μ" presets={thicknessPresets} />
                    <SalesOverflowChipGroup label="Material" value={variantFilter} onChange={setVariantFilter} options={materialOptions} maxInline={4} allValue="" />
                    <SalesOverflowChipGroup label="Grade" value={gradeFilter} onChange={setGradeFilter} options={gradeOptions} maxInline={4} allValue="" />
                    <Button
                        type="button"
                        variant="outline"
                        className="h-10 rounded-full bg-white px-5 text-xs font-black uppercase tracking-[0.12em]"
                        onClick={() => {
                            setSearch("")
                            setActiveFilter("active")
                            setFgTypeFilter("all")
                            setTemplateFilter("all")
                            setUsageCustomerId("all")
                            setUsageOnly(false)
                            setSizeFilter("")
                            setHeightFilter("")
                            setVariantFilter("")
                            setGradeFilter("")
                            setThicknessFilter("")
                        }}
                    >
                        Reset
                    </Button>
                </div>
            </section>
            <div className={styles.mainGrid}>
                    <div className={cn(styles.sectionCard, styles.stickyTop)} data-testid="sales-sku-list-section">
                        <div className={styles.sectionHeader}>
                            <div className={styles.sectionTitle}><Sparkles className="h-4 w-4 text-slate-400" /> SKU Rail</div>
                            <div className={styles.sectionSubtitle}>Shortlist shared SKU headers and move into the selected workplane fast.</div>
                        </div>
                        <div className={styles.sectionContent}>
                            <ScrollArea className="h-[calc(100vh-20rem)] min-h-[470px] pr-2">
                                <div className="space-y-3">
                                    {!filteredSkus.length ? (
                                        <div className="rounded-3xl border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-500">
                                            No SKUs matched the current filters.
                                        </div>
                                    ) : null}
                                    {filteredSkus.map((sku) => {
                                        const isActive = sku.id === selectedSkuId
                                        return (
                                            <button
                                                key={sku.id}
                                                type="button"
                                                data-testid="sales-sku-list-item"
                                                onClick={() => setSelectedSkuId(sku.id)}
                                                className={`w-full rounded-[1.6rem] border p-4 text-left transition ${isActive ? "border-sky-200 bg-sky-50 text-slate-950 shadow-[0_18px_45px_-34px_rgba(59,130,246,0.24)]" : "border-slate-200 bg-white/96 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_18px_45px_-36px_rgba(15,23,42,0.28)]"}`}
                                            >
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="space-y-2">
                                                        <div className="break-words text-sm font-black leading-5">{sku.code}</div>
                                                        <div className="break-words text-sm leading-5 text-slate-700">{sku.name}</div>
                                                        <div className="flex flex-wrap gap-2">
                                                            <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.18em] ${isActive ? "border-sky-200 bg-white text-sky-700" : skuStatusTone(sku.active)}`}>
                                                                {sku.active ? "ACTIVE" : "INACTIVE"}
                                                            </span>
                                                            {usageCustomerId !== "all" && asNumber(sku.customer_usage_count, 0) > 0 ? (
                                                                <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.18em] ${isActive ? "border-sky-200 bg-white text-sky-700" : "border-sky-200 bg-sky-50 text-sky-700"}`}>
                                                                    {sku.customer_usage_count} use(s)
                                                                </span>
                                                            ) : null}
                                                        </div>
                                                    </div>
                                                    <div className={styles.itemMeta}>
                                                        <div>{sku.variants.length} variants</div>
                                                        <div>{sku.template_name || "No template"}</div>
                                                    </div>
                                                </div>
                                            </button>
                                        )
                                    })}
                                </div>
                            </ScrollArea>
                    </div>
                    </div>

                    <div className="min-w-0 space-y-6">
                        {selectedSku ? (
                            <>
                                <div className={styles.sectionCard} data-testid="sales-sku-summary">
                                    <div className={styles.sectionHeader}>
                                        <div className={styles.sectionTitle}>Selected SKU Workspace</div>
                                        <div className={styles.sectionSubtitle}>Header truth first: commercial identity, LIVE template, default line, and customer usage. Then move into variants.</div>
                                    </div>
                                    <div className={styles.sectionContent}>
                                    <div className="space-y-5">
                                        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                                            <div className="space-y-3">
                                                <div className="flex flex-wrap gap-2">
                                                    <span className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] ${skuStatusTone(selectedSku.active)}`}>
                                                        {selectedSku.active ? "ACTIVE" : "INACTIVE"}
                                                    </span>
                                                    {selectedSku.commercial_family_name ? <Badge variant="outline">{selectedSku.commercial_family_name}</Badge> : null}
                                                </div>
                                                <div>
                                                    <h2 className="break-words text-2xl font-black leading-tight tracking-tight text-slate-900 sm:text-[2rem]">
                                                        {selectedSku.code} • {selectedSku.name}
                                                    </h2>
                                                    <p className="mt-1 text-sm text-slate-500">
                                                        {selectedSku.template_name || "No template"} • Default line: {selectedSku.default_line_name || "Not set"}
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="flex flex-wrap gap-2">
                                                <Button variant="outline" className="rounded-full" onClick={openEditSkuDialog}>
                                                    Edit SKU
                                                </Button>
                                                <Button variant="outline" className="rounded-full" onClick={() => toggleSkuMutation.mutate()} disabled={toggleSkuMutation.isPending}>
                                                    {selectedSku.active ? "Deactivate" : "Reactivate"}
                                                </Button>
                                                <Button data-testid="sales-sku-add-variant" className="rounded-full" onClick={openCreateVariantDialog}>
                                                    <Plus className="mr-2 h-4 w-4" /> Add Variant
                                                </Button>
                                            </div>
                                        </div>
                                        <div className={styles.metricStrip}>
                                            <div className={styles.metricCard}>
                                                <div className={styles.metricLabel}>Template</div>
                                                <div className={styles.metricValueSm}>{selectedSku.template_name || "Missing"}</div>
                                            </div>
                                            <div className={styles.metricCard}>
                                                <div className={styles.metricLabel}>Variants</div>
                                                <div className={styles.metricValue}>{selectedSku.variants.length}</div>
                                            </div>
                                            <div className={styles.metricCard}>
                                                <div className={styles.metricLabel}>Customer Usage</div>
                                                <div className={styles.metricValue}>{asNumber(selectedSku.customer_usage_count, 0)}</div>
                                            </div>
                                            <div className={styles.metricCard}>
                                                <div className={styles.metricLabel}>Last Used</div>
                                                <div className={styles.metricValueSm}>{selectedSku.customer_last_used_at ? new Date(selectedSku.customer_last_used_at).toLocaleDateString() : "No usage"}</div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                </div>

                                <div className={styles.sectionCard} data-testid="sales-sku-variants-section">
                                    <div className={styles.sectionHeader}>
                                        <div className={styles.sectionTitle}>Orderable Variant Lane</div>
                                        <div className={styles.sectionSubtitle}>Variants are the real sales product contract: geometry, lamination stack, printing, add-ons, packaging, and POD.</div>
                                    </div>
                                    <div className={styles.sectionContent}>
                                        <div className="grid gap-4 2xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                                            <ScrollArea className="h-[calc(100vh-28rem)] min-h-[400px] pr-3">
                                                <div className="space-y-3">
                                                    {!selectedSkuVariants.length ? (
                                                        <div className="rounded-3xl border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-500">
                                                            This SKU has no variants yet.
                                                        </div>
                                                    ) : null}
                                                    {selectedSkuVariants.map((variant) => {
                                                        const isSelected = variant.id === selectedVariantId
                                                        const spec = normalizeProductSpec(salesVariantSpecSource(selectedSku, variant))
                                                        return (
                                                            <button
                                                                key={variant.id}
                                                                type="button"
                                                                data-testid="sales-sku-variant-item"
                                                                onClick={() => setSelectedVariantId(variant.id)}
                                                                className={`w-full rounded-[1.6rem] border p-4 text-left transition ${isSelected ? "border-blue-200 bg-blue-50 text-slate-950 shadow-[0_18px_45px_-34px_rgba(79,70,229,0.22)]" : "border-slate-200 bg-white/96 hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-[0_18px_45px_-36px_rgba(15,23,42,0.28)]"}`}
                                                            >
                                                                <div className="flex items-start justify-between gap-3">
                                                                    <div className="space-y-2">
                                                                        <div className="break-words text-sm font-black leading-5">{variant.code}</div>
                                                                        <div className="break-words text-sm leading-5 text-slate-700">{variant.name}</div>
                                                                        <div className="flex flex-wrap gap-2">
                                                                            <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.18em] ${isSelected ? "border-blue-200 bg-white text-blue-700" : skuStatusTone(variant.active)}`}>
                                                                                {variant.active ? "ACTIVE" : "INACTIVE"}
                                                                            </span>
                                                                            <span className="inline-flex rounded-full border border-sky-200 bg-white px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.14em] text-sky-700">
                                                                                {spec.size.label}
                                                                            </span>
                                                                        </div>
                                                                    </div>
                                                                    <div className={styles.itemMeta}>
                                                                        <div className="font-semibold">{(variant.layer_snapshot || []).length} layer(s)</div>
                                                                        <div className="mt-1 break-words">{variant.finished_good_type === "ROLL"
                                                                            ? variant.roll_form || "FLAT"
                                                                            : `${variant.geometry_snapshot?.base?.width_mm || variant.geometry_snapshot?.width_mm || 0}W x ${variant.geometry_snapshot?.base?.height_mm || variant.geometry_snapshot?.height_mm || 0}H`}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                                <div className="mt-3">
                                                                    <SalesSpecChips
                                                                        spec={spec}
                                                                        fgType={variant.finished_good_type}
                                                                        printingLabel={variant.printing_snapshot?.enabled ? `${variant.printing_snapshot?.type || "PRINT"} F${variant.printing_snapshot?.front_colors_count || 0}/B${variant.printing_snapshot?.back_colors_count || 0}` : "No print"}
                                                                        compact
                                                                        maxAddonLabels={1}
                                                                    />
                                                                </div>
                                                            </button>
                                                        )
                                                    })}
                                                </div>
                                            </ScrollArea>

                                            {selectedVariant ? (
                                                <div className="rounded-[1.75rem] border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fbff_100%)] p-5 shadow-[0_24px_54px_-44px_rgba(15,23,42,0.32)]">
                                                    <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                                                        <div className="space-y-3">
                                                            <div className="flex flex-wrap gap-2">
                                                                <span className={`inline-flex rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] ${skuStatusTone(selectedVariant.active)}`}>
                                                                    {selectedVariant.active ? "ACTIVE" : "INACTIVE"}
                                                                </span>
                                                                <Badge variant="outline">{selectedVariant.finished_good_type}</Badge>
                                                                {selectedVariant.printing_snapshot?.enabled ? <Badge variant="outline">{selectedVariant.printing_snapshot?.type || "PRINT"}</Badge> : null}
                                                                {selectedVariant.packaging_snapshot?.pod?.enabled ? <Badge variant="outline">POD</Badge> : null}
                                                            </div>
                                                            <div>
                                                                <div className="break-words text-xl font-black leading-tight text-slate-900">{selectedVariant.code} • {selectedVariant.name}</div>
                                                                <div className="mt-1 text-sm text-slate-500">
                                                                    {selectedVariant.finished_good_type === "ROLL"
                                                                        ? selectedVariant.roll_form || "FLAT"
                                                                        : `${selectedVariant.geometry_snapshot?.base?.width_mm || selectedVariant.geometry_snapshot?.width_mm || 0}W x ${selectedVariant.geometry_snapshot?.base?.height_mm || selectedVariant.geometry_snapshot?.height_mm || 0}H`}
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <div className="flex flex-wrap gap-2">
                                                            <Button variant="outline" className="rounded-full" onClick={() => openVariantEditor("edit", selectedVariant)}>
                                                                Edit Variant
                                                            </Button>
                                                            <Button variant="outline" className="rounded-full" onClick={() => openVariantEditor("clone", selectedVariant)}>
                                                                <Copy className="mr-2 h-4 w-4" /> Clone Variant
                                                            </Button>
                                                            <Button variant="outline" className="rounded-full" onClick={() => toggleVariantMutation.mutate()} disabled={toggleVariantMutation.isPending}>
                                                                {selectedVariant.active ? "Deactivate" : "Reactivate"}
                                                            </Button>
                                                            <Button data-testid="sales-sku-usage-history" variant="outline" className="rounded-full" onClick={() => setUsageDialogOpen(true)}>
                                                                <Clock3 className="mr-2 h-4 w-4" /> Usage History
                                                            </Button>
                                                        </div>
                                                    </div>
                                                    <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                                                        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                                                            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Form</div>
                                                            <div className="mt-2 text-sm font-black text-slate-900">{selectedVariant.finished_good_type}</div>
                                                        </div>
                                                        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                                                            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Layers</div>
                                                            <div className="mt-2 text-sm font-black text-slate-900">{(selectedVariant.layer_snapshot || []).length}</div>
                                                        </div>
                                                        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                                                            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">POD</div>
                                                            <div className="mt-2 text-sm font-black text-slate-900">{selectedVariant.packaging_snapshot?.pod?.enabled ? "Enabled" : "Off"}</div>
                                                        </div>
                                                        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                                                            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Template</div>
                                                            <div className="mt-2 text-sm font-black text-slate-900">{selectedVariant.template_name || selectedSku.template_name}</div>
                                                        </div>
                                                    </div>
                                                    {selectedVariantSpec ? (
                                                        <div className="mt-5 space-y-4">
                                                            <SalesSpecChips
                                                                spec={selectedVariantSpec}
                                                                fgType={selectedVariant.finished_good_type}
                                                                printingLabel={selectedVariant.printing_snapshot?.enabled ? `${selectedVariant.printing_snapshot?.type || "PRINT"} F${selectedVariant.printing_snapshot?.front_colors_count || 0}/B${selectedVariant.printing_snapshot?.back_colors_count || 0}` : "No print"}
                                                            />
                                                            <SalesLayerTable spec={selectedVariantSpec} />
                                                        </div>
                                                    ) : null}
                                                </div>
                                            ) : (
                                                <div className="rounded-3xl border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-500">
                                                    Select a variant to inspect or edit it.
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </>
                        ) : (
                            <div className={styles.sectionCard}>
                                <div className={styles.sectionHeader}>
                                    <div className={styles.sectionTitle}>Selected SKU</div>
                                    <div className={styles.sectionSubtitle}>Choose a shared SKU from the left rail or create one to begin building fast-entry variants.</div>
                                </div>
                                <div className={styles.sectionContent}>
                                    <div className="flex min-h-[420px] items-center justify-center p-2 text-center sm:min-h-[540px]">
                                        <div className="space-y-3">
                                            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500">
                                                <ShieldCheck className="h-6 w-6" />
                                            </div>
                                            <div className="text-lg font-black text-slate-900">Select a shared SKU</div>
                                            <p className="max-w-md text-sm leading-6 text-slate-500">
                                                Choose a shared SKU from the left rail or create a new one to start building sales-owned fast-entry variants.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            <Dialog open={skuDialogOpen} onOpenChange={setSkuDialogOpen}>
                <DialogContent data-testid="sales-sku-dialog" className="h-[100dvh] max-h-[100dvh] w-screen max-w-none overflow-y-auto rounded-none p-0 sm:h-auto sm:max-h-[94vh] sm:w-[calc(100vw-1rem)] sm:max-w-[min(42rem,calc(100vw-1rem))] sm:rounded-[2rem]">
                    <DialogHeader>
                        <DialogTitle className="px-6 pt-6">{skuDialogMode === "create" ? "Create Shared SKU" : "Edit Shared SKU"}</DialogTitle>
                        <DialogDescription>
                            SKU headers define the commercial master. Variants under the SKU hold the actual technical order truth.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 px-6 py-2 md:grid-cols-2">
                        <div className="space-y-2">
                            <Label>SKU Code</Label>
                            <Input data-testid="sales-sku-dialog-code" value={skuForm.code} onChange={(event) => setSkuForm((current) => ({ ...current, code: event.target.value }))} />
                        </div>
                        <div className="space-y-2">
                            <Label>SKU Name</Label>
                            <Input data-testid="sales-sku-dialog-name" value={skuForm.name} onChange={(event) => setSkuForm((current) => ({ ...current, name: event.target.value }))} />
                        </div>
                        <div className="space-y-2">
                            <Label>LIVE Template</Label>
                            <Select value={skuForm.template || "__NONE__"} onValueChange={(value) => setSkuForm((current) => ({ ...current, template: value === "__NONE__" ? "" : value }))}>
                                <SelectTrigger data-testid="sales-sku-dialog-template" className="bg-white"><SelectValue placeholder="Select LIVE template" /></SelectTrigger>
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
                            <Label>Commercial Family</Label>
                            <Select value={skuForm.commercial_family || "__NONE__"} onValueChange={(value) => setSkuForm((current) => ({ ...current, commercial_family: value === "__NONE__" ? "" : value }))}>
                                <SelectTrigger className="bg-white"><SelectValue placeholder="Select family" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="__NONE__">No family</SelectItem>
                                    {commercialFamilies.map((family) => (
                                        <SelectItem key={family.id} value={family.id}>
                                            {family.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2 md:col-span-2">
                            <Label>Default Line Name</Label>
                            <Input data-testid="sales-sku-dialog-default-line" value={skuForm.default_line_name} onChange={(event) => setSkuForm((current) => ({ ...current, default_line_name: event.target.value }))} />
                        </div>
                        <div className="flex items-center justify-between rounded-2xl border border-slate-200 px-4 py-3 md:col-span-2">
                            <div>
                                <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Active</div>
                                <div className="mt-1 text-xs text-slate-400">Inactive SKUs stay in history but drop out of fast-order entry.</div>
                            </div>
                            <Switch checked={skuForm.active} onCheckedChange={(checked) => setSkuForm((current) => ({ ...current, active: checked }))} />
                        </div>
                    </div>
                    <DialogFooter className="mobile-safe-bottom sticky bottom-0 border-t border-slate-100 bg-white/95 px-6 py-4 backdrop-blur">
                        <Button variant="outline" onClick={() => setSkuDialogOpen(false)}>Cancel</Button>
                        <Button data-testid="sales-sku-dialog-save" onClick={() => skuMutation.mutate()} disabled={skuMutation.isPending}>
                            {skuMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                            Save SKU
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={variantDialog.open} onOpenChange={(open) => setVariantDialog((current) => ({ ...current, open }))}>
                <DialogContent data-testid="sku-variant-builder" className="h-[100dvh] max-h-[100dvh] w-screen max-w-none overflow-y-auto rounded-none p-0 sm:h-auto sm:max-h-[96vh] sm:w-[calc(100vw-1rem)] sm:max-w-[min(90rem,calc(100vw-1rem))] sm:rounded-[2rem]">
                    <DialogHeader>
                        <DialogTitle className="px-6 pt-6">
                            {variantDialog.mode === "create" ? "Create Variant" : variantDialog.mode === "clone" ? "Clone Variant" : "Edit Variant"}
                        </DialogTitle>
                        <DialogDescription>
                            Sales variants store the exact technical snapshot used by fast-entry orders. Route logic stays on the template; sales variants own product truth only.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-5 px-4 pb-4 sm:px-6 sm:pb-6">
                        <div className="rounded-[1.75rem] border border-slate-200/80 bg-white/92 p-4 shadow-[0_20px_50px_-44px_rgba(15,23,42,0.42)] sm:p-5">
                            <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                                <div className="space-y-2">
                                    <div className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">
                                        {variantDialog.mode === "create" ? "New variant" : variantDialog.mode === "clone" ? "Clone variant" : "Edit variant"}
                                    </div>
                                    <div>
                                        <div className="text-2xl font-black tracking-tight text-slate-900">
                                            {variantDialog.code || "Variant code"} • {variantDialog.name || "Variant name"}
                                        </div>
                                        <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
                                            Build a clean sales preset. Flow is geometry, film layers, optional printing, independent lamination chemistry, add-ons, then packaging and POD.
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 xl:min-w-[18rem]">
                                    <div>
                                        <div className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Active</div>
                                        <div className="mt-1 text-xs text-slate-400">Inactive variants stay in history only.</div>
                                    </div>
                                    <Switch checked={variantDialog.active} onCheckedChange={(checked) => setVariantDialog((current) => ({ ...current, active: checked }))} />
                                </div>
                            </div>
                            <div className="mt-5">
                                <div className={styles.metricStrip}>
                                    <div className={styles.metricCard}>
                                        <div className={styles.metricLabel}>Shared SKU</div>
                                        <div className={styles.metricValueSm}>{salesSkus.find((sku) => sku.id === variantDialog.skuId)?.code || "No SKU"}</div>
                                    </div>
                                    <div className={styles.metricCard}>
                                        <div className={styles.metricLabel}>Template</div>
                                        <div className={styles.metricValueSm}>{templates.find((template: any) => String(template.id) === String(variantDialog.item.template_id))?.name || "Choose template"}</div>
                                    </div>
                                    <div className={styles.metricCard}>
                                        <div className={styles.metricLabel}>Finished good</div>
                                        <div className={styles.metricValue}>{variantDialog.item.finished_good_type === "ROLL" ? "ROLL" : variantDialog.item.finished_good_type ? "POUCH" : "Pending"}</div>
                                    </div>
                                    <div className={styles.metricCard}>
                                        <div className={styles.metricLabel}>Layers</div>
                                        <div className={styles.metricValue}>{variantDialog.item.film_layers.length}</div>
                                    </div>
                                </div>
                            </div>
                            <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                                <div className="space-y-2">
                                    <Label>Variant Code</Label>
                                    <Input value={variantDialog.code} onChange={(event) => setVariantDialog((current) => ({ ...current, code: event.target.value }))} />
                                </div>
                                <div className="space-y-2 xl:col-span-2">
                                    <Label>Variant Name</Label>
                                    <Input value={variantDialog.name} onChange={(event) => setVariantDialog((current) => ({ ...current, name: event.target.value }))} />
                                </div>
                            </div>
                            <div className="mt-4 flex flex-wrap gap-2">
                                <Badge variant="outline">{variantDialog.item.finished_good_type || "FG pending"}</Badge>
                                <Badge variant="outline">
                                    {variantDialog.item.finished_good_type === "ROLL"
                                        ? variantDialog.item.roll_form || "FLAT"
                                        : `${variantDialog.item.geometry.base.width_mm} x ${variantDialog.item.geometry.base.height_mm}`}
                                </Badge>
                                <Badge variant="outline">{variantDialog.item.film_layers.length} layer(s)</Badge>
                                <Badge variant="outline">
                                    {variantDialog.item.printing.enabled
                                        ? `${variantDialog.item.printing.type} F${variantDialog.item.printing.front_colors_count}/B${variantDialog.item.printing.back_colors_count}`
                                        : "No print"}
                                </Badge>
                                <Badge variant="outline">{variantDialog.item.addons.length} add-on(s)</Badge>
                                {variantDialog.item.packaging_snapshot.primary_inner_pack.enabled ? <Badge variant="outline">Primary pack</Badge> : null}
                                {variantDialog.item.packaging_snapshot.pod.enabled ? <Badge variant="outline">POD enabled</Badge> : null}
                            </div>
                        </div>

                        <div className={cn(
                            "rounded-[1.35rem] border p-4",
                            dialogPlannerMatch?.derived_from_planner_variant
                                ? "border-emerald-200 bg-emerald-50/90"
                                : "border-amber-200 bg-amber-50/90"
                        )}>
                            <div className={cn(
                                "text-[10px] font-black uppercase tracking-[0.22em]",
                                dialogPlannerMatch?.derived_from_planner_variant ? "text-emerald-700" : "text-amber-800"
                            )}>
                                Derived from planner variant
                            </div>
                            {dialogPlannerMatch?.derived_from_planner_variant ? (
                                <>
                                    <div className="mt-1 text-sm font-bold text-emerald-950">
                                        Matches PlannerSkuVariant {dialogPlannerMatch.derived_from_planner_variant_code || dialogPlannerMatch.derived_from_planner_variant}
                                    </div>
                                    <div className="mt-1 text-xs text-emerald-800/80">
                                        Production knows the recipe. Match is stored on the sales variant.
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div className="mt-1 text-sm font-bold text-amber-950">No planner recipe linked yet.</div>
                                    <div className="mt-1 text-xs text-amber-900/80">
                                        Save the variant, then match by invariant signature before production relies on it.
                                    </div>
                                </>
                            )}
                        </div>

                        <OrderItemTechnicalEditor
                            item={variantDialog.item}
                            templates={templates}
                            families={families}
                            variants={variants}
                            addonsMaster={addonsMaster}
                            packagingMaterials={packagingMaterials}
                            podProfiles={podProfiles}
                            artworks={artworks}
                            previewLoading={variantPreviewLoading}
                            previewError={variantPreviewError}
                            onPreviewRetry={() => {
                                if (!variantDialog.item.template_id) return
                                setVariantPreviewError("")
                                setVariantPreviewNonce((current) => current + 1)
                            }}
                            updateItem={(updater) =>
                                setVariantDialog((current) => ({
                                    ...current,
                                    item: updater(current.item),
                                }))
                            }
                        />
                    </div>
                    <DialogFooter className="mobile-safe-bottom sticky bottom-0 border-t border-slate-100 bg-white/95 px-6 py-4 backdrop-blur">
                        <Button variant="outline" onClick={() => setVariantDialog((current) => ({ ...current, open: false }))}>
                            Cancel
                        </Button>
                        <Button data-testid="sku-variant-save" onClick={() => variantMutation.mutate()} disabled={variantMutation.isPending}>
                            {variantMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                            Save Variant
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={usageDialogOpen} onOpenChange={setUsageDialogOpen}>
                <DialogContent className="h-[100dvh] max-h-[100dvh] w-screen max-w-none overflow-y-auto rounded-none p-0 sm:h-auto sm:max-h-[94vh] sm:w-[calc(100vw-1rem)] sm:max-w-[min(64rem,calc(100vw-1rem))] sm:rounded-[2rem]">
                    <DialogHeader>
                        <DialogTitle className="px-6 pt-6">Variant Usage History</DialogTitle>
                        <DialogDescription>
                            Historical sales-order lines that were booked using this SKU variant.
                        </DialogDescription>
                    </DialogHeader>
                    <ScrollArea className="px-6 pb-6 pr-3">
                        <div className="space-y-3">
                            {usageHistoryQuery.isLoading ? (
                                <div className="flex items-center gap-2 text-sm text-slate-500">
                                    <Loader2 className="h-4 w-4 animate-spin" /> Loading usage history...
                                </div>
                            ) : !(usageHistoryQuery.data || []).length ? (
                                <div className="rounded-2xl border border-dashed border-slate-200 px-4 py-10 text-center text-sm text-slate-500">
                                    No historical usage matched this variant.
                                </div>
                            ) : (
                                (usageHistoryQuery.data || []).map((row: RepeatLineCandidate) => (
                                    <div key={row.id} className="rounded-3xl border border-slate-200 bg-white p-4">
                                        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                                            <div className="space-y-2">
                                                <div className="text-sm font-black text-slate-900">{row.line_name || row.template_name}</div>
                                                <div className="text-xs text-slate-500">
                                                    {row.order_number} • {new Date(row.order_created_at).toLocaleDateString()} • {row.customer_name}
                                                </div>
                                                <div className="flex flex-wrap gap-2">
                                                    <Badge variant="outline">{row.summary.finished_good_type}</Badge>
                                                    <Badge variant="outline">{formatMoney(asNumber(row.unit_price, 0))} / {row.price_basis}</Badge>
                                                    {row.summary.printing_enabled ? <Badge variant="outline">{row.summary.printing_type || "PRINT"}</Badge> : null}
                                                    {row.summary.pod_enabled ? <Badge variant="outline">POD</Badge> : null}
                                                </div>
                                            </div>
                                            <Button variant="outline" asChild>
                                                <Link href={`/sales/orders/${row.order_id}`}>
                                                    Open Order <ArrowUpRight className="ml-2 h-4 w-4" />
                                                </Link>
                                            </Button>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </ScrollArea>
                </DialogContent>
            </Dialog>
        </div>
    )
}

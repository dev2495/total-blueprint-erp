"use client"

import * as React from "react"
import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
    AlertTriangle,
    ArrowLeft,
    ArrowRight,
    Boxes,
    CheckCircle2,
    Database,
    Disc,
    Edit3,
    Layers,
    Loader2,
    Package,
    Palette,
    Plus,
    Route,
    Save,
    Search,
    Sparkles,
    Trash2,
    Users,
    Workflow,
    X,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"
import { GradientHero } from "@/components/erp-v3/gradient-hero"
import { SectionCardV3 } from "@/components/erp-v3/section-card-v3"
import { RouteTimeline } from "@/components/erp-v3/route-timeline"
import { LiveBomRail } from "@/components/erp-v3/live-bom-rail"
import {
    productMasterService,
    hasCatalogBackedAxis,
    type AxisCatalogSource,
    type LayerTemplateRow,
    type ProductKind,
    type ProductMaster,
    type ProductMasterSize,
    type ReportingGroup,
    type VariantAxisDef,
} from "@/services/product-master"
import { templateService } from "@/services/templates"
import { masterDataService, type Addon, type Customer, type Material, type PackagingMaterial, type PodSkuVariant } from "@/services/master-data"
import { recipeService } from "@/services/recipes"
import { engineeringService, type Artwork } from "@/services/engineering"
import { cn } from "@/lib/utils"
import { autoRollWidthMm } from "@/lib/product-geometry"
import { SizeGeometryEditor } from "@/components/product-master/size-geometry-editor"
import { VariantsMatrixV37 } from "@/components/product-master/variants-matrix-v37"
import {
    gradeOptionsForLayer,
    isPurchasedOnlyFilm,
    LayerAllowedGradePicker,
    LayerDefaultGradeSelect,
    LayerThicknessSelect,
    sanitizeLayerForFilm,
    filmForLayer,
    thicknessOptionsForLayer,
} from "@/components/product-master/layer-master-controls"

interface ProductMasterDetailWorkspaceProps {
    productId: string
}

const REPORTING_GROUPS: ReportingGroup[] = ["FILM", "PRINTED", "LAMINATED", "SEMI_FG", "FG", "PACKAGING", "POD", "OTHER"]
const PRINT_TYPES = ["FLEXO", "ROTO"] as const
const FILM_TYPES = ["SHEET", "TUBING"] as const
const POUCH_STYLES = ["STAND_UP", "THREE_SIDE_SEAL", "PILLOW", "SIDE_GUSSET", "QUAD_SEAL", "FLAT_BOTTOM", "SPOUT", "SHAPED", "SACHET", "STICK_PACK"] as const
const EMPTY_PRODUCT_SIZES: ProductMasterSize[] = []
const ROLL_FORMS = ["FLAT", "FOLDED", "TUBING"] as const
const PACKAGING_ROLES = ["PRIMARY_INNER", "FINAL_GUNNY", "ROLL_DISPATCH", "EXTRA"] as const
const LEGACY_PACKAGING_ROLE_ALIASES: Record<string, typeof PACKAGING_ROLES[number]> = {
    FINAL_CARTON: "EXTRA",
    FINAL_OUTER: "EXTRA",
    TAPE: "EXTRA",
}
const PACKAGING_ROLE_RULES: Record<string, { label: string; menuLabel: string; hint: string; basis: string; qtySource: string }> = {
    PRIMARY_INNER: {
        label: "Auto by packed pcs",
        menuLabel: "Inner pouch (pouch only)",
        hint: "Consumes ceil(total finished pcs / pcs per inner).",
        basis: "PCS_PER_PACK",
        qtySource: "AUTO_TOTAL_PCS",
    },
    FINAL_GUNNY: {
        label: "Packing Yard seal count",
        menuLabel: "Outer · gunny / sheet (pouch)",
        hint: "Gunny is counted by Packing Yard; pouch sheet/wrap is posted by EOD count.",
        basis: "COUNTED_AT_PACKING",
        qtySource: "PACKING_YARD_SEAL_COUNT",
    },
    ROLL_DISPATCH: {
        label: "Evening open-close",
        menuLabel: "Outer · sheet (roll)",
        hint: "Roll dispatch accepts sheet/wrap SKUs only; stock issue is posted by EOD packing count.",
        basis: "PACKING_EOD_COUNT",
        qtySource: "EOD_OPEN_CLOSE",
    },
    EXTRA: {
        label: "Evening open-close",
        menuLabel: "Other EOD packing",
        hint: "Allowed labels/tags/sheets; stock issue is posted by EOD packing count.",
        basis: "PACKING_EOD_COUNT",
        qtySource: "EOD_OPEN_CLOSE",
    },
}

const AXIS_DEFS: VariantAxisDef[] = [
    { axis: "size", type: "geometry", required: true, label: "Size / geometry" },
    { axis: "layer_thicknesses", type: "per_layer_number", label: "Per-layer thickness" },
    { axis: "layer_grades", type: "per_layer_enum", label: "Per-layer grade" },
    { axis: "layer_widths", type: "per_layer_number", label: "Roll width override" },
    { axis: "addons", type: "multi_enum", label: "Add-ons" },
    { axis: "packaging", type: "packaging_ref", label: "Packaging recipe" },
    { axis: "pod", type: "pod_ref", label: "POD" },
    { axis: "artwork_mode", type: "enum", label: "Artwork mode" },
]

function axisMode(axis: VariantAxisDef | undefined): "off" | "optional" | "required" {
    if (!axis) return "off"
    return axis.required ? "required" : "optional"
}

function isUiRequiredAxis(axis: VariantAxisDef) {
    return !!axis.required && String(axis.axis) !== "layer_widths"
}

function axisModeCopy(mode: "off" | "optional" | "required") {
    if (mode === "required") return "Required in sales/planner before submit."
    if (mode === "optional") return "Can be skipped; if entered it affects matching and BOM."
    return "Not part of this master’s final product tuple."
}

function packagingRuleForRole(role?: string) {
    return PACKAGING_ROLE_RULES[canonicalPackagingRole(role)] || PACKAGING_ROLE_RULES.EXTRA
}

function canonicalPackagingRole(role?: string): typeof PACKAGING_ROLES[number] {
    const raw = String(role || "PRIMARY_INNER").toUpperCase()
    return LEGACY_PACKAGING_ROLE_ALIASES[raw] || (PACKAGING_ROLES.includes(raw as any) ? raw as typeof PACKAGING_ROLES[number] : "EXTRA")
}

function packagingKind(material?: PackagingMaterial | null) {
    const raw = String(material?.packaging_kind || "").toUpperCase()
    if (raw === "GUNNY") return "GONNY"
    if (raw === "CARTON") return "BOX"
    return raw
}

function packagingRolesForProduct(productKind?: ProductKind | string) {
    const kind = String(productKind || "POUCH").toUpperCase()
    if (kind === "ROLL" || kind === "POD") return PACKAGING_ROLES.filter((role) => role === "ROLL_DISPATCH" || role === "EXTRA")
    if (kind === "POUCH") return [...PACKAGING_ROLES]
    return PACKAGING_ROLES.filter((role) => role === "ROLL_DISPATCH" || role === "EXTRA")
}

function packagingMaterialAllowed(material: PackagingMaterial, role?: string, productKind?: ProductKind | string) {
    const canonical = canonicalPackagingRole(role)
    const kind = packagingKind(material)
    const product = String(productKind || "POUCH").toUpperCase()
    if (canonical === "PRIMARY_INNER") return product === "POUCH" && kind === "INNER_POUCH"
    if (canonical === "FINAL_GUNNY") return product === "POUCH" && ["GONNY", "SHEET"].includes(kind)
    if (canonical === "ROLL_DISPATCH") return kind === "SHEET"
    return ["TAPE", "LABEL", "TAG", "OTHER", "BOX", "OUTER_BAG"].includes(kind)
}

function defaultPcsPerPack(material?: PackagingMaterial | null, line?: Record<string, any>) {
    const defaults = (material?.packaging_defaults_json || {}) as Record<string, any>
    const raw = defaults.pcs_per_pack ?? defaults.pcs_per_inner ?? line?.pcs_per_pack ?? line?.qty
    const value = Number(raw || 0)
    return Number.isFinite(value) && value > 0 ? value : undefined
}

function normalizePackagingLine(line: Record<string, any>, role?: string, material?: PackagingMaterial | null) {
    const nextRole = canonicalPackagingRole(role || line.role)
    const rule = packagingRuleForRole(nextRole)
    const normalized: Record<string, any> = {
        ...line,
        role: nextRole,
        material: material ? material.id || null : line.material,
        material_code: material ? (material.code || "").toUpperCase() : line.material_code,
        uom: material?.base_uom || line.uom || "PCS",
        supply_mode: material?.packaging_supply_mode ?? line.supply_mode,
        kind: material?.packaging_kind ?? line.kind,
        qty: 0,
        basis: rule.basis,
        qty_source: rule.qtySource,
    }
    if (nextRole === "PRIMARY_INNER") {
        normalized.pcs_per_pack = defaultPcsPerPack(material, line)
    } else {
        normalized.pcs_per_pack = undefined
    }
    return normalized
}

function artworkColorCode(artwork: Artwork) {
    const front = Number(artwork.front_colors_count ?? artwork.colors_count ?? 0)
    const back = Number(artwork.back_colors_count ?? 0)
    return back > 0 ? `${front}F${back}B` : `${front}F`
}

function isAxisValueEmpty(value: any) {
    if (value == null || value === "") return true
    if (Array.isArray(value)) return value.length === 0
    if (typeof value === "object") return Object.values(value).every((item) => item == null || item === "")
    return false
}

function normalizedOptionCode(value: unknown) {
    if (typeof value === "string" || typeof value === "number") return String(value).trim().toUpperCase()
    if (!value || typeof value !== "object") return ""
    const row = value as Record<string, unknown>
    return String(row.code || row.material_code || row.pod_sku_code || row.addon_code || row.id || "").trim().toUpperCase()
}

function axisOptionCodes(axis?: VariantAxisDef) {
    const options = (axis as any)?.options
    if (!Array.isArray(options) || options.length === 0) return null
    const codes = new Set(options.map(normalizedOptionCode).filter(Boolean))
    return codes.size ? codes : null
}

export function ProductMasterDetailWorkspace({ productId }: ProductMasterDetailWorkspaceProps) {
    const queryClient = useQueryClient()
    const { toast } = useToast()

    const { data: master, isLoading } = useQuery({
        queryKey: ["product-master", productId],
        queryFn: () => productMasterService.get(productId),
    })
    const { data: sizesData } = useQuery({
        queryKey: ["product-master-sizes", productId],
        queryFn: () => productMasterService.listSizes(productId),
        enabled: !!productId,
    })
    const sizes = sizesData ?? EMPTY_PRODUCT_SIZES
    const { data: overlays = [] } = useQuery({
        queryKey: ["product-master-overlays", productId],
        queryFn: () => productMasterService.listOverlays(productId),
        enabled: !!productId,
    })
    const { data: variants = [] } = useQuery({
        queryKey: ["product-master-variants", productId],
        queryFn: () => productMasterService.listVariants(productId),
        enabled: !!productId,
    })
    const { data: templates = [] } = useQuery({
        queryKey: ["templates", "live"],
        queryFn: () => templateService.getTemplates({ status: "LIVE" }),
        staleTime: 60_000,
    })
    const effectiveTemplateId = master?.template || master?.default_template || null
    const { data: routeInfo } = useQuery({
        queryKey: ["product-master-template", productId, effectiveTemplateId],
        queryFn: () => productMasterService.getTemplate(productId),
        enabled: !!productId && !!effectiveTemplateId,
        staleTime: 60_000,
    })
    const { data: filmVariants = [] } = useQuery({
        queryKey: ["master-film-variants"],
        queryFn: masterDataService.getFilmVariants,
        staleTime: 60_000,
    })
    const { data: grades = [] } = useQuery({
        queryKey: ["recipe-grades"],
        queryFn: () => recipeService.getGrades(),
        staleTime: 60_000,
    })
    const { data: recipes = [] } = useQuery({
        queryKey: ["extrusion-recipes", "active"],
        queryFn: () => recipeService.getAll({ is_active: true }),
        staleTime: 60_000,
    })
    const { data: customers = [] } = useQuery({
        queryKey: ["sales-customers"],
        queryFn: masterDataService.getCustomers,
        staleTime: 60_000,
    })
    const { data: packagingMaterials = [] } = useQuery({
        queryKey: ["master-packaging-materials"],
        queryFn: masterDataService.getPackaging,
        staleTime: 60_000,
    })
    const { data: addons = [] } = useQuery({
        queryKey: ["master-addons"],
        queryFn: masterDataService.getAddons,
        staleTime: 60_000,
    })
    const { data: podVariants = [] } = useQuery({
        queryKey: ["master-pod-sku-variants", "active"],
        queryFn: () => masterDataService.getPodSkuVariants({ active: true }),
        staleTime: 60_000,
    })
    const { data: consumers = [] } = useQuery({
        queryKey: ["product-master-consumers", productId],
        queryFn: () => productMasterService.listConsumers(productId),
        enabled: !!productId,
        staleTime: 60_000,
    })
    const { data: artworks = [] } = useQuery({
        queryKey: ["product-master-artworks", productId, "approved-any-method"],
        queryFn: () =>
            engineeringService.getArtworks({
                status: "APPROVED",
            }),
        enabled: !!productId && !!master?.fixed_attributes?.print_capable,
        staleTime: 60_000,
    })

    const [tab, setTab] = React.useState("spec")
    const [editing, setEditing] = React.useState<string | null>(null)
    const [draft, setDraft] = React.useState<ProductMaster | null>(null)
    const [draftSizes, setDraftSizes] = React.useState<ProductMasterSize[]>([])
    const [overlayOpen, setOverlayOpen] = React.useState(false)
    const [variantOpen, setVariantOpen] = React.useState(false)
    const [overlayDraft, setOverlayDraft] = React.useState({
        customer: "",
        customer_item_code: "",
        customer_display_name: "",
        default_price_basis: "KG" as "KG" | "PCS",
        moq_kg: "",
        default_artwork: "",
        default_pod: "",
        default_packaging_inner: "",
        default_packaging_outer: "",
        default_packaging_other: "",
        axis_size: "",
        axis_layer_grades: {} as Record<string, string>,
        pcs_per_inner: "",
        gunny_capacity_kg: "",
        default_packing_note: "",
        notes: "",
        active: true,
    })
    const [variantDraft, setVariantDraft] = React.useState<Record<string, any>>({})

    React.useEffect(() => {
        if (master && !editing) setDraft(master)
    }, [editing, master])
    React.useEffect(() => {
        if (!editing) setDraftSizes(sizes)
    }, [editing, sizes])

    const updateMutation = useMutation({
        mutationFn: async () => {
            if (!draft) return
            const savedMaster = await productMasterService.update(productId, {
                code: draft.code,
                name: draft.name,
                product_kind: draft.product_kind,
                template: draft.template,
                default_template: draft.template || draft.default_template || null,
                default_reporting_group: draft.default_reporting_group,
                reusable_policy: draft.reusable_policy,
                layer_template: draft.layer_template,
                variant_axes: draft.variant_axes,
                fixed_attributes: draft.fixed_attributes,
                description: draft.description,
                active: draft.active,
            })
            const draftIds = new Set(draftSizes.map((s) => s.id).filter(Boolean))
            for (const existing of sizes) {
                if (existing.id && !draftIds.has(existing.id)) await productMasterService.deleteSize(existing.id)
            }
            const savedSizes = []
            for (const s of draftSizes) {
                savedSizes.push(await productMasterService.saveSize(productId, s))
            }
            return { master: savedMaster, sizes: savedSizes }
        },
        onSuccess: (saved) => {
            if (saved?.master) setDraft(saved.master)
            if (saved?.sizes) setDraftSizes(saved.sizes)
            queryClient.invalidateQueries({ queryKey: ["product-master", productId] })
            queryClient.invalidateQueries({ queryKey: ["product-master-sizes", productId] })
            queryClient.invalidateQueries({ queryKey: ["product-master-template", productId] })
            queryClient.invalidateQueries({ queryKey: ["product-masters"] })
            toast({ title: "Master saved", description: "All sections updated." })
            setEditing(null)
        },
        onError: (err: any) => {
            toast({ title: "Save failed", description: err?.message || "Try again", variant: "destructive" })
        },
    })

    const catalogAxes = (master?.variant_axes || []).filter((a) => a.master_data_source)
    const hasCatalogAxes = catalogAxes.length > 0
    const genericPackAxis = catalogAxes.find((axis) => String(axis.axis) === "packaging")
    const innerPackAxis = catalogAxes.find((axis) => String(axis.axis) === "packaging_inner")
    const outerPackAxis = catalogAxes.find((axis) => String(axis.axis) === "packaging_outer")
    const otherPackAxis = catalogAxes.find((axis) => ["packaging_other", "packaging_extra"].includes(String(axis.axis)))
    const podAxis = catalogAxes.find((axis) => String(axis.axis) === "pod_variant" || String(axis.axis) === "pod")
    const overlayPodOptions = React.useMemo(() => {
        const allowed = axisOptionCodes(podAxis)
        return podVariants.filter((pod) => !allowed || allowed.has(String(pod.code || "").trim().toUpperCase()))
    }, [podAxis, podVariants])
    const packagingLines = React.useMemo(
        () => (Array.isArray(draft?.fixed_attributes?.packaging_lines) ? draft?.fixed_attributes?.packaging_lines : []),
        [draft?.fixed_attributes]
    )
    const draftProductKind = draft?.product_kind
    const packagingLinesForOverlay = React.useCallback(
        (...roles: string[]) => {
            const roleSet = new Set(roles.map((role) => canonicalPackagingRole(role)))
            return packagingLines.filter((line: any) => roleSet.has(canonicalPackagingRole(line.role)))
        },
        [packagingLines]
    )
    const packagingOptionsForOverlay = React.useCallback(
        (roles: string[], axes: Array<VariantAxisDef | undefined>) => {
            const roleSet = new Set(roles.map((role) => canonicalPackagingRole(role)))
            const axisList = axes.filter(Boolean) as VariantAxisDef[]
            const options: Array<{ value: string; label: string; role: string; line?: Record<string, any>; material?: PackagingMaterial }> = []
            const pushOption = (option: { value: string; label: string; role: string; line?: Record<string, any>; material?: PackagingMaterial }) => {
                if (!option.value) return
                if (options.some((existing) => existing.value === option.value)) return
                options.push(option)
            }

            packagingLines
                .filter((line: any) => roleSet.has(canonicalPackagingRole(line.role)))
                .forEach((line: any, index) => {
                    const value = String(line.material_code || line.code || line.material || line.material_id || "")
                    const role = canonicalPackagingRole(line.role)
                    pushOption({
                        value,
                        role,
                        line,
                        label: role === "EXTRA" ? (line.material_code || value) : `${PACKAGING_ROLE_RULES[role].menuLabel} · ${line.material_code || value}`,
                    })
                })

            if (!axisList.length) return options

            const axisAllows = (axis: VariantAxisDef, material: PackagingMaterial) => {
                const allowed = axisOptionCodes(axis)
                if (!allowed) return true
                return allowed.has(String(material.code || "").trim().toUpperCase())
            }

            packagingMaterials
                .filter((material: PackagingMaterial) => material.status !== "INACTIVE")
                .forEach((material: PackagingMaterial) => {
                    if (!axisList.some((axis) => axisAllows(axis, material))) return
                    const role = Array.from(roleSet).find((candidate) => packagingMaterialAllowed(material, candidate, draftProductKind))
                    if (!role) return
                    pushOption({
                        value: material.code,
                        role,
                        material,
                        label: role === "EXTRA" ? `${material.code} · ${material.name || material.packaging_kind}` : `${PACKAGING_ROLE_RULES[role].menuLabel} · ${material.code}`,
                    })
                })

            return options
        },
        [draftProductKind, packagingLines, packagingMaterials]
    )
    const innerPackagingOverlayOptions = React.useMemo(
        () => packagingOptionsForOverlay(["PRIMARY_INNER"], [innerPackAxis, genericPackAxis]),
        [genericPackAxis, innerPackAxis, packagingOptionsForOverlay]
    )
    const outerPackagingOverlayOptions = React.useMemo(
        () => packagingOptionsForOverlay(["FINAL_GUNNY", "ROLL_DISPATCH"], [outerPackAxis]),
        [outerPackAxis, packagingOptionsForOverlay]
    )
    const otherPackagingOverlayOptions = React.useMemo(
        () => packagingOptionsForOverlay(["EXTRA"], [otherPackAxis]),
        [otherPackAxis, packagingOptionsForOverlay]
    )
    const selectedPackagingLineForOverlay = React.useCallback(
        (code: string, options: Array<{ value: string; role: string; line?: Record<string, any>; material?: PackagingMaterial }>) => {
            const existing = packagingLines.find((line: any) => [line.material_code, line.code, line.material, line.material_id].filter(Boolean).map(String).includes(code))
            if (existing) return existing
            const selected = options.find((option) => option.value === code)
            if (selected?.line) return selected.line
            if (selected?.material) return normalizePackagingLine({ role: selected.role, material_code: selected.material.code }, selected.role, selected.material)
            return null
        },
        [packagingLines]
    )


    const overlayMutation = useMutation({
        mutationFn: () =>
            productMasterService.createOverlay(productId, {
                customer: overlayDraft.customer,
                customer_item_code: overlayDraft.customer_item_code,
                customer_display_name: overlayDraft.customer_display_name,
                default_price_basis: overlayDraft.default_price_basis,
                moq_kg: overlayDraft.moq_kg ? Number(overlayDraft.moq_kg) : null,
                default_artwork: overlayDraft.default_artwork || null,
                default_packing_note: overlayDraft.default_packing_note,
                notes: overlayDraft.notes,
                active: overlayDraft.active,
                axis_values: {
                    ...(overlayDraft.axis_size ? { size: overlayDraft.axis_size } : {}),
                    ...(overlayDraft.default_pod ? { pod_variant: overlayDraft.default_pod, pod: overlayDraft.default_pod } : {}),
                    ...(overlayDraft.default_packaging_inner ? { packaging_inner: overlayDraft.default_packaging_inner } : {}),
                    ...(overlayDraft.default_packaging_outer ? { packaging_outer: overlayDraft.default_packaging_outer } : {}),
                    ...(overlayDraft.default_packaging_other ? { packaging_other: overlayDraft.default_packaging_other } : {}),
                    ...(Object.values(overlayDraft.axis_layer_grades).some(Boolean)
                        ? {
                              layer_grades: Object.fromEntries(
                                  Object.entries(overlayDraft.axis_layer_grades).filter(([, grade]) => Boolean(grade))
                              ),
                          }
                        : {}),
                },
                default_packing_recipe: {
                    packaging_lines: [
                        selectedPackagingLineForOverlay(overlayDraft.default_packaging_inner, innerPackagingOverlayOptions),
                        selectedPackagingLineForOverlay(overlayDraft.default_packaging_outer, outerPackagingOverlayOptions),
                        selectedPackagingLineForOverlay(overlayDraft.default_packaging_other, otherPackagingOverlayOptions),
                    ].filter(Boolean),
                    pod_variant: overlayDraft.default_pod || draft?.fixed_attributes?.pod_variant || null,
                    pod_variant_code: overlayDraft.default_pod || draft?.fixed_attributes?.pod_variant_code || "",
                    pcs_per_inner: overlayDraft.pcs_per_inner ? Number(overlayDraft.pcs_per_inner) : null,
                    gunny_capacity_kg: overlayDraft.gunny_capacity_kg ? Number(overlayDraft.gunny_capacity_kg) : null,
                },
            }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["product-master-overlays", productId] })
            queryClient.invalidateQueries({ queryKey: ["product-master", productId] })
            queryClient.invalidateQueries({ queryKey: ["product-masters"] })
            setOverlayOpen(false)
            setOverlayDraft({
                customer: "",
                customer_item_code: "",
                customer_display_name: "",
                default_price_basis: "KG",
                moq_kg: "",
                default_artwork: "",
                default_pod: "",
                default_packaging_inner: "",
                default_packaging_outer: "",
                default_packaging_other: "",
                axis_size: "",
                axis_layer_grades: {},
                pcs_per_inner: "",
                gunny_capacity_kg: "",
                default_packing_note: "",
                notes: "",
                active: true,
            })
            toast({ title: "Overlay saved", description: "Customer defaults are ready for sales order entry." })
        },
        onError: (err: any) => {
            toast({ title: "Overlay save failed", description: err?.message || "Try again", variant: "destructive" })
        },
    })

    const variantMutation = useMutation({
        mutationFn: () => productMasterService.findOrCreateVariant(productId, { axis_values: variantDraft }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["product-master-variants", productId] })
            queryClient.invalidateQueries({ queryKey: ["product-master", productId] })
            setVariantOpen(false)
            setVariantDraft({})
            toast({ title: "Variant tuple ready", description: "Sales and planner will reuse this exact axis combination." })
        },
        onError: (err: any) => {
            toast({ title: "Variant tuple failed", description: err?.message || "Check required axes and layer values.", variant: "destructive" })
        },
    })

    if (isLoading || !master || !draft) {
        return (
            <div className="space-y-3">
                <div className="h-32 animate-pulse rounded-3xl bg-slate-100" />
                <div className="h-64 animate-pulse rounded-2xl bg-slate-100" />
            </div>
        )
    }

    function patchDraft(patch: Partial<ProductMaster>) {
        setDraft((d) => (d ? { ...d, ...patch } : d))
    }
    function patchFixed(patch: Record<string, any>) {
        setDraft((d) => (d ? { ...d, fixed_attributes: { ...(d.fixed_attributes || {}), ...patch } } : d))
    }
    function patchLayer(idx: number, patch: Partial<LayerTemplateRow>) {
        setDraft((d) => {
            if (!d) return d
            const next = [...d.layer_template]
            next[idx] = { ...next[idx], ...patch }
            return { ...d, layer_template: next }
        })
    }
    function addLayer() {
        setDraft((d) => {
            if (!d) return d
            return { ...d, layer_template: [...d.layer_template, { role: `layer-${d.layer_template.length + 1}`, film_variant_code: "", thickness_micron: 0, thickness_apportion: "per_layer" as const }] }
        })
    }
    function removeLayer(idx: number) {
        setDraft((d) => (d ? { ...d, layer_template: d.layer_template.filter((_, i) => i !== idx) } : d))
    }
    function patchAxis(axis: VariantAxisDef["axis"], required: boolean, included: boolean) {
        setDraft((d) => {
            if (!d) return d
            if (!included) return { ...d, variant_axes: d.variant_axes.filter((a) => a.axis !== axis) }
            const def = AXIS_DEFS.find((a) => a.axis === axis)
            if (!def) return d
            const has = d.variant_axes.some((a) => a.axis === axis)
            const next = has
                ? d.variant_axes.map((a) => (a.axis === axis ? { ...a, required } : a))
                : [...d.variant_axes, { ...def, required }]
            return { ...d, variant_axes: next }
        })
    }
    function patchSize(idx: number, patch: Partial<ProductMasterSize>) {
        setDraftSizes((arr) => { const next = [...arr]; next[idx] = { ...next[idx], ...patch }; return next })
    }
    function addSize() {
        const isRoll = String(draft?.product_kind || "").toUpperCase() === "ROLL" || String(draft?.product_kind || "").toUpperCase() === "POD"
        setDraftSizes((arr) => [...arr, {
            id: `tmp-${Math.random().toString(36).slice(2, 8)}`,
            product_master: productId,
            code: `SZ-${arr.length + 1}`,
            label: `Size ${arr.length + 1}`,
            width_mm: 0, height_mm: 0, gusset_mm: 0, roll_width_mm: null,
            thickness_micron: null,
            standard_qty: null,
            faces: isRoll ? 1 : 2,
            trim_loss_mm: 10,
            trim_apply_to: "WIDTH",
            flap_tape_mm: 0,
            gusset_apply_to: "HEIGHT",
            gusset_factor: 1,
            adjustments: [],
            pouch_style: isRoll ? "" : "STAND_UP",
            roll_form: isRoll ? "FLAT" : "",
            geometry_config: isRoll
                ? { roll_form: "FLAT", trim_loss_mm: 10, trim_apply_to: "WIDTH", adjustments: [], multipliers: { faces: 1 } }
                : { pouch_style: "STAND_UP", trim_loss_mm: 10, trim_apply_to: "WIDTH", flap_tape_mm: 0, gusset_apply_to: "HEIGHT", gusset_factor: 1, adjustments: [], multipliers: { faces: 2 } },
            qty_uom: "KG" as const,
            notes: "",
            active: true,
            sort_order: arr.length + 1,
        }])
    }
    function removeSize(idx: number) {
        setDraftSizes((arr) => arr.filter((_, i) => i !== idx))
    }

    const totalThickness = draft.layer_template.reduce((s, l) => s + l.thickness_micron, 0)
    const hasLayerThicknessAxis = draft.variant_axes.some((axis) =>
        ["layer_thicknesses", "layer_thickness", "thickness_by_layer", "per_layer_thickness"].includes(String(axis.axis || ""))
    )
    const thicknessSummary = hasLayerThicknessAxis ? "Variable thickness" : `Total ${totalThickness}μ`
    const routeSteps = (routeInfo?.route_steps || []).map((step) => ({
        index: step.index,
        label: step.name || step.process_code || `Step ${step.index}`,
        transition: step.transition,
        tag: step.roll_behavior,
        artwork_step: !!step.has_artwork,
    }))
    const isEditing = (section: string) => editing === section
    const startEdit = (section: string) => setEditing(section)
    const cancelEdit = () => { setEditing(null); setDraft(master); setDraftSizes(sizes) }
    const saveEdit = () => updateMutation.mutate()
    function patchVariantAxis(axis: string, value: any) {
        setVariantDraft((current) => ({ ...current, [axis]: value }))
    }
    function patchVariantLayerAxis(axis: string, index: number, value: any) {
        setVariantDraft((current) => ({
            ...current,
            [axis]: {
                ...((current[axis] && typeof current[axis] === "object") ? current[axis] : {}),
                [String(index + 1)]: value,
            },
        }))
    }
    function patchVariantRollWidth(value: any) {
        setVariantDraft((current) => {
            if (value === "" || value == null) {
                const { layer_widths, ...rest } = current
                return rest
            }
            const width = Number(value)
            return {
                ...current,
                layer_widths: Object.fromEntries((draft?.layer_template || []).map((_, index) => [String(index + 1), width])),
            }
        })
    }
    const selectedVariantSize = draftSizes.find((size) => size.code === variantDraft.size)
    const variantRollWidthValue = (() => {
        const widths = variantDraft.layer_widths
        if (!widths || typeof widths !== "object") return ""
        const values = Object.values(widths).filter((value) => value !== "" && value != null)
        if (!values.length) return ""
        const first = String(values[0])
        return values.every((value) => String(value) === first) ? first : ""
    })()
    const variantAutoRollWidth = selectedVariantSize ? autoRollWidthMm(selectedVariantSize, draft.product_kind) : null
    const variantRequiredMissing = draft.variant_axes.some((axis) => {
        const key = String(axis.axis)
        if (!axis.required) return false
        if (key === "layer_widths") {
            return !selectedVariantSize && isAxisValueEmpty(variantDraft.layer_widths)
        }
        return isAxisValueEmpty(variantDraft[key])
    })

    const setupCards = [
        {
            label: "Live route", value: draft.template_name || "Pick template",
            ready: !!draft.template, icon: <Route className="h-4 w-4" />,
            tone: draft.template ? ("emerald" as const) : ("amber" as const),
            note: draft.template ? "Template bound" : "No route — sales/planner blocked",
        },
        {
            label: "Size geometry", value: `${draftSizes.length} ${draftSizes.length === 1 ? "size" : "sizes"}`,
            ready: draftSizes.length > 0, icon: <Layers className="h-4 w-4" />,
            tone: draftSizes.length > 0 ? ("emerald" as const) : ("amber" as const),
            note: draftSizes.length > 0 ? "Sizes ready" : "Add at least one size",
        },
        {
            label: "Layer recipe", value: `${draft.layer_template.length} layers`,
            ready: draft.layer_template.length > 0, icon: <Boxes className="h-4 w-4" />,
            tone: draft.layer_template.length > 0 ? ("emerald" as const) : ("amber" as const),
            note: draft.layer_template.length > 0 ? thicknessSummary : "Add at least one layer",
        },
        {
            label: "Variant axes", value: `${draft.variant_axes.length} axes`,
            ready: draft.variant_axes.length > 0, icon: <Workflow className="h-4 w-4" />,
            tone: "emerald" as const,
            note: draft.variant_axes.find((a) => a.required) ? "Required axes set" : "Optional only",
        },
        {
            label: "Packaging + POD", value: draft.fixed_attributes?.packaging_lines?.length ? `${draft.fixed_attributes.packaging_lines.length} lines` : "Optional",
            ready: true, icon: <Package className="h-4 w-4" />,
            tone: draft.fixed_attributes?.packaging_lines?.length ? ("emerald" as const) : ("slate" as const),
            note: draft.fixed_attributes?.packaging_lines?.length ? "Recipes configured" : "Add packing recipe",
        },
        {
            label: "Customer overlays", value: `${overlays.length}`,
            ready: overlays.length > 0, icon: <Users className="h-4 w-4" />,
            tone: overlays.length > 0 ? ("emerald" as const) : ("slate" as const),
            note: overlays.length > 0 ? "Item codes mapped" : "No overlays yet",
        },
    ]

    function EditActions({ section }: { section: string }) {
        if (isEditing(section)) {
            return (
                <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" className="h-7 gap-1 rounded-full text-xs" onClick={cancelEdit}>
                        <X className="h-3 w-3" /> Cancel
                    </Button>
                    <Button size="sm" className="h-7 gap-1 rounded-full bg-blue-600 text-xs hover:bg-blue-700" onClick={saveEdit} disabled={updateMutation.isPending}>
                        {updateMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Save
                    </Button>
                </div>
            )
        }
        return (
            <Button size="sm" variant="outline" className="h-7 gap-1.5 rounded-full border-blue-200 bg-blue-50 text-xs font-semibold text-blue-700 shadow-sm hover:bg-blue-100 hover:shadow" onClick={() => startEdit(section)}>
                <Edit3 className="h-3 w-3" /> Edit
            </Button>
        )
    }

    return (
        <div className="space-y-6 pb-8">
            {/* ─── Hero ─── */}
            <GradientHero
                eyebrow={`Master · Product Master · ${draft.code}`}
                title={draft.name}
                subtitle={draft.description}
                palette="indigo"
                tone="subtle"
                chips={(() => {
                    const baseKind = { label: "Kind", value: draft.product_kind, icon: <Package className="h-3.5 w-3.5" /> }
                    return [
                        baseKind,
                        { label: "Axes", value: String(draft.variant_axes.length), icon: <Workflow className="h-3.5 w-3.5" /> },
                        { label: "Variants", value: String(master.variants_count ?? variants.length), icon: <Database className="h-3.5 w-3.5" /> },
                        { label: "Overlays", value: String(master.overlays_count ?? overlays.length), icon: <Users className="h-3.5 w-3.5" /> },
                        { label: "Artworks", value: String(master.artworks_count ?? 0), icon: <Palette className="h-3.5 w-3.5" /> },
                        { label: "Sizes", value: String(draftSizes.length), icon: <Layers className="h-3.5 w-3.5" /> },
                        { label: "Stock pools", value: String(master.planner_pools_count ?? 0), icon: <Boxes className="h-3.5 w-3.5" /> },
                    ]
                })()}
                actions={
                    <div className="flex items-center gap-2">
                        <Link href="/master/products" className="inline-flex items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">
                            <ArrowLeft className="h-3.5 w-3.5" /> Back to list
                        </Link>
                    </div>
                }
            >
                <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] font-bold">
                    <span className="rounded-md bg-slate-100 px-2 py-0.5 text-slate-700 ring-1 ring-slate-200">{draft.product_kind}</span>
                    {draft.template_name && <span className="rounded-md bg-slate-100 px-2 py-0.5 text-slate-700 ring-1 ring-slate-200"><Route className="mr-1 inline h-3 w-3" />{draft.template_name}</span>}
                    {draft.fixed_attributes?.print_capable && (
                        <span className="rounded-md bg-fuchsia-50 px-2 py-0.5 text-fuchsia-700 ring-1 ring-fuchsia-200">
                            <Palette className="mr-1 inline h-3 w-3" /> Print capable
                        </span>
                    )}
                    <span className={cn("rounded-md px-2 py-0.5 ring-1", draft.active ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-rose-50 text-rose-700 ring-rose-200")}>
                        {draft.active ? "Active" : "Inactive"}
                    </span>
                    <span className="rounded-md bg-slate-100 px-2 py-0.5 text-slate-700 ring-1 ring-slate-200">{draft.default_reporting_group}</span>
                </div>
            </GradientHero>

            {/* ─── Product Spec Card (V3.6 — what is this?) ─── */}
            <ProductSpecCard
                code={draft.code}
                name={draft.name}
                kind={draft.product_kind}
                style={draft.fixed_attributes?.default_pouch_style || draft.fixed_attributes?.roll_form || "—"}
                printType={draft.fixed_attributes?.print_capable ? "Artwork-driven" : undefined}
                printCapable={Boolean(draft.fixed_attributes?.print_capable)}
                layers={draft.layer_template}
                sizes={draftSizes}
                axes={draft.variant_axes}
                variantsCount={master.variants_count ?? variants.length}
                overlaysCount={master.overlays_count ?? overlays.length}
                description={draft.description}
                invariant={draft.invariant_signature}
                active={draft.active}
            />

            {/* ─── Setup Workbench ─── */}
            <SectionCardV3 eyebrow="Setup workbench" title="Configuration health" description="Each card is a stable input contract for sales and planner." accent="blue">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {setupCards.map((c) => (
                        <div key={c.label} className={cn("rounded-xl border bg-gradient-to-br px-4 py-3.5 shadow-sm transition-all hover:shadow-md",
                            c.tone === "emerald" && "border-emerald-200/80 from-emerald-50 to-white ring-1 ring-emerald-100/50",
                            c.tone === "amber" && "border-amber-200/80 from-amber-50 to-white ring-1 ring-amber-100/50",
                            c.tone === "slate" && "border-slate-200/80 from-slate-50 to-white ring-1 ring-slate-100/50"
                        )}>
                            <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2.5 text-slate-700">
                                    <span className={cn("flex h-8 w-8 items-center justify-center rounded-lg shadow-sm ring-1 ring-inset",
                                        c.tone === "emerald" && "bg-emerald-600 text-white ring-emerald-700",
                                        c.tone === "amber" && "bg-amber-500 text-white ring-amber-600",
                                        c.tone === "slate" && "bg-slate-500 text-white ring-slate-600"
                                    )}>{c.icon}</span>
                                    <div>
                                        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{c.label}</div>
                                        <div className="text-sm font-black text-slate-900">{c.value}</div>
                                    </div>
                                </div>
                                <span className={cn("rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider shadow-sm ring-1 ring-inset",
                                    c.tone === "emerald" && "bg-emerald-600 text-white ring-emerald-700",
                                    c.tone === "amber" && "bg-amber-500 text-white ring-amber-600",
                                    c.tone === "slate" && "bg-slate-100 text-slate-600 ring-slate-200"
                                )}>{c.ready ? "Ready" : "Needed"}</span>
                            </div>
                            <div className="mt-2 text-[11px] text-slate-600">{c.note}</div>
                        </div>
                    ))}
                </div>
            </SectionCardV3>

            {/* ─── Main content + right rail ─── */}
            <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
                <div className="space-y-6">
                    <Tabs value={tab} onValueChange={setTab} className="space-y-5">
                        <TabsList className="flex w-full flex-wrap rounded-2xl bg-gradient-to-r from-slate-100 via-slate-50 to-slate-100 p-1.5 shadow-sm ring-1 ring-slate-200/50">
                            <TabsTrigger value="spec" className="flex-1 rounded-xl text-xs font-semibold data-[state=active]:bg-white data-[state=active]:shadow-md data-[state=active]:ring-1 data-[state=active]:ring-slate-200/60">Spec & recipe</TabsTrigger>
                            <TabsTrigger value="variants" className="flex-1 rounded-xl text-xs font-semibold data-[state=active]:bg-white data-[state=active]:shadow-md data-[state=active]:ring-1 data-[state=active]:ring-slate-200/60">Variant matrix</TabsTrigger>
                            <TabsTrigger value="overlays" className="flex-1 rounded-xl text-xs font-semibold data-[state=active]:bg-white data-[state=active]:shadow-md data-[state=active]:ring-1 data-[state=active]:ring-slate-200/60">Customer overlays</TabsTrigger>
                            <TabsTrigger value="artworks" className="flex-1 rounded-xl text-xs font-semibold data-[state=active]:bg-white data-[state=active]:shadow-md data-[state=active]:ring-1 data-[state=active]:ring-slate-200/60">Artworks</TabsTrigger>
                            <TabsTrigger value="planner" className="flex-1 rounded-xl text-xs font-semibold data-[state=active]:bg-white data-[state=active]:shadow-md data-[state=active]:ring-1 data-[state=active]:ring-slate-200/60">Planner stock</TabsTrigger>
                        </TabsList>

                        {/* ─────── SPEC & RECIPE TAB ─────── */}
                        <TabsContent value="spec" className="space-y-5">
                            {/* Section 1: Header + live route */}
                            <SectionCardV3 index={1} title="Header & live route" description="The stable identity read by sales & planner." accent="blue" actions={<EditActions section="header" />}>
                                {isEditing("header") ? (
                                    <div className="space-y-4">
                                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                            <EditField label="Master code">
                                                <Input value={draft.code} onChange={(e) => patchDraft({ code: e.target.value.toUpperCase() })} className="h-9 rounded-xl" />
                                            </EditField>
                                            <EditField label="Reporting group">
                                                <Select value={draft.default_reporting_group} onValueChange={(v) => patchDraft({ default_reporting_group: v as ReportingGroup })}>
                                                    <SelectTrigger className="h-9 rounded-xl"><SelectValue /></SelectTrigger>
                                                    <SelectContent>{REPORTING_GROUPS.map((g) => <SelectItem key={g} value={g}>{g}</SelectItem>)}</SelectContent>
                                                </Select>
                                            </EditField>
                                            <EditField label="Master name" span={2}>
                                                <Input value={draft.name} onChange={(e) => patchDraft({ name: e.target.value })} className="h-9 rounded-xl" />
                                            </EditField>
                                            <EditField label="Product kind">
                                                <Select value={draft.product_kind} onValueChange={(v) => patchDraft({ product_kind: v as ProductKind })}>
                                                    <SelectTrigger className="h-9 rounded-xl"><SelectValue /></SelectTrigger>
                                                    <SelectContent>{(["POUCH", "ROLL", "PACKAGING", "POD", "OTHER"] as ProductKind[]).map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}</SelectContent>
                                                </Select>
                                            </EditField>
                                            <EditField label="Live route / template">
                                                <Select value={draft.template || ""} onValueChange={(v) => patchDraft({ template: v, template_name: templates.find((t: any) => t.id === v)?.name })}>
                                                    <SelectTrigger className="h-9 rounded-xl"><SelectValue placeholder="Pick a live template" /></SelectTrigger>
                                                    <SelectContent>{templates.map((t: any) => <SelectItem key={t.id} value={t.id}>{t.name || t.code}</SelectItem>)}</SelectContent>
                                                </Select>
                                            </EditField>
                                            <EditField label="FG type">
                                                <Input value={draft.fixed_attributes?.fg_type || ""} onChange={(e) => patchFixed({ fg_type: e.target.value.toUpperCase() })} className="h-9 rounded-xl" placeholder="POUCH, ROLL..." />
                                            </EditField>
                                            <EditField label={draft.product_kind === "POUCH" ? "Default pouch style" : "Default roll form"}>
                                                <Select
                                                    value={draft.product_kind === "POUCH" ? (draft.fixed_attributes?.default_pouch_style || "STAND_UP") : (draft.fixed_attributes?.roll_form || "FLAT")}
                                                    onValueChange={(v) => draft.product_kind === "POUCH" ? patchFixed({ default_pouch_style: v, roll_form: "" }) : patchFixed({ roll_form: v, default_pouch_style: "" })}
                                                >
                                                    <SelectTrigger className="h-9 rounded-xl"><SelectValue /></SelectTrigger>
                                                    <SelectContent>
                                                        {(draft.product_kind === "POUCH" ? POUCH_STYLES : ROLL_FORMS).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                                                    </SelectContent>
                                                </Select>
                                            </EditField>
                                            <EditField label="Description" span={2}>
                                                <Textarea value={draft.description || ""} onChange={(e) => patchDraft({ description: e.target.value })} className="min-h-[56px] rounded-xl" />
                                            </EditField>
                                            <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2 sm:col-span-2">
                                                <div>
                                                    <div className="text-sm font-bold text-slate-900">Active</div>
                                                    <div className="text-[11px] text-slate-500">Sales and planner can pick this master right after save.</div>
                                                </div>
                                                <Switch checked={draft.active} onCheckedChange={(v) => patchDraft({ active: v })} />
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="space-y-3">
                                        <div className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
                                            <ReadField label="Master code" value={draft.code} mono />
                                            <ReadField label="Product kind" value={draft.product_kind} />
                                            <ReadField label="Reporting group" value={draft.default_reporting_group} />
                                            <ReadField label="FG type" value={draft.fixed_attributes?.fg_type || "—"} />
                                            <ReadField label="Template" value={draft.template_name || "Not bound"} tone={draft.template ? "ok" : "warn"} />
                                            <ReadField label="Style" value={draft.fixed_attributes?.default_pouch_style || draft.fixed_attributes?.roll_form || "—"} />
                                            <ReadField label="Reusable policy" value={draft.reusable_policy} />
                                            <ReadField label="Active" value={draft.active ? "Yes" : "No"} tone={draft.active ? "ok" : "warn"} />
                                        </div>
                                        {draft.description && <p className="text-xs text-slate-500">{draft.description}</p>}
                                    </div>
                                )}
                            </SectionCardV3>

                            {/* Section 2: Live route preview */}
                            <SectionCardV3 index={2} title="Live route preview" description="Process names from the live template. Route drives WCM, planner steps, and BOM." accent="emerald">
                                {draft.template && routeSteps.length ? (
                                    <RouteTimeline
                                        steps={routeSteps}
                                        helperText="Artwork-bearing step highlighted. Stop-step controls planner stock commitment scope."
                                    />
                                ) : (
                                    <div className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                                        <AlertTriangle className="h-4 w-4 flex-none" />
                                        {draft.template ? "Template is bound but has no route steps yet." : "No live route selected. Sales and planner flows require a bound template."}
                                    </div>
                                )}
                            </SectionCardV3>

                            {/* Section 3: Size / geometry axis */}
                            <SectionCardV3 index={3} title="Size / geometry axis" description="Final W/H/Gusset is product identity. Thickness comes from layer rows; roll width comes from override or the custom geometry rule." accent="emerald"
                                actions={isEditing("sizes") ? (
                                    <div className="flex items-center gap-2">
                                        <Button size="sm" variant="outline" className="h-7 gap-1 rounded-full text-xs" onClick={addSize}><Plus className="h-3 w-3" /> Add</Button>
                                        <Button size="sm" variant="outline" className="h-7 gap-1 rounded-full text-xs" onClick={cancelEdit}><X className="h-3 w-3" /> Cancel</Button>
                                        <Button size="sm" className="h-7 gap-1 rounded-full bg-blue-600 text-xs hover:bg-blue-700" onClick={saveEdit} disabled={updateMutation.isPending}>
                                            {updateMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Save
                                        </Button>
                                    </div>
                                ) : <EditActions section="sizes" />}
                            >
                                {isEditing("sizes") ? (
                                    <div className="space-y-3">
                                        {draftSizes.length === 0 ? (
                                            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/40 p-6 text-center text-sm text-slate-500">
                                                No sizes yet. Click &quot;Add&quot; to create a size option.
                                            </div>
                                        ) : (
                                            <div className="space-y-3">
                                                {draftSizes.map((row, i) => (
                                                    <div key={row.id || i} className="rounded-xl border border-slate-200 bg-white p-4">
                                                        <div className="mb-3 flex items-center justify-between">
                                                            <span className="text-sm font-bold text-slate-900">{row.code || `Size ${i + 1}`}</span>
                                                            <button type="button" onClick={() => removeSize(i)} className="rounded-md p-1 text-rose-600 hover:bg-rose-50">
                                                                <Trash2 className="h-3.5 w-3.5" />
                                                            </button>
                                                        </div>
                                                        <SizeGeometryEditor row={row} kind={draft.product_kind} onPatch={(patch) => patchSize(i, patch)} />
                                                        <div className="mt-2 flex items-center gap-3">
                                                            <Switch checked={row.active} onCheckedChange={(v) => patchSize(i, { active: v })} />
                                                            <span className="text-[11px] text-slate-500">{row.active ? "Active — sales can pick" : "Inactive"}</span>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <SizeTable rows={draftSizes} kind={draft.product_kind} />
                                )}
                            </SectionCardV3>

                            {/* Section 4: Layer template */}
                            <SectionCardV3 index={4} title="Layer template" description="Per-layer thickness, grade and width. Total thickness is derived from the sum." accent="blue"
                                actions={isEditing("layers") ? (
                                    <div className="flex items-center gap-2">
                                        <Button size="sm" variant="outline" className="h-7 gap-1 rounded-full text-xs" onClick={addLayer}><Plus className="h-3 w-3" /> Add layer</Button>
                                        <Button size="sm" variant="outline" className="h-7 gap-1 rounded-full text-xs" onClick={cancelEdit}><X className="h-3 w-3" /> Cancel</Button>
                                        <Button size="sm" className="h-7 gap-1 rounded-full bg-blue-600 text-xs hover:bg-blue-700" onClick={saveEdit} disabled={updateMutation.isPending}>
                                            {updateMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />} Save
                                        </Button>
                                    </div>
                                ) : <EditActions section="layers" />}
                            >
                                {isEditing("layers") ? (
                                    <div className="space-y-3">
                                        {draft.layer_template.length === 0 ? (
                                            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/40 p-6 text-center text-sm text-slate-500">
                                                No layers yet. Click &quot;Add layer&quot; to define the layer stack.
                                            </div>
                                        ) : (
                                            draft.layer_template.map((row, i) => (
                                                <div key={i} className="rounded-xl border border-slate-200 bg-white p-4">
                                                    <div className="mb-3 flex items-center justify-between">
                                                        <div className="flex items-center gap-2">
                                                            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-100 text-[10px] font-black text-blue-700">L{i + 1}</span>
                                                            <span className="text-sm font-bold text-slate-900">Layer {i + 1}</span>
                                                        </div>
                                                        <button type="button" onClick={() => removeLayer(i)} className="rounded-md p-1 text-rose-600 hover:bg-rose-50">
                                                            <Trash2 className="h-3.5 w-3.5" />
                                                        </button>
                                                    </div>
                                                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                                                        <EditField label="Film / material">
                                                            {filmVariants.length ? (
                                                                <Select
                                                                    value={row.film_variant_id || row.film_variant_code || ""}
                                                                    onValueChange={(v) => {
                                                                        const picked = filmVariants.find((m: Material) => m.id === v || m.code === v)
                                                                        patchLayer(i, sanitizeLayerForFilm(row, picked, grades, recipes))
                                                                    }}
                                                                >
                                                                    <SelectTrigger className="h-8 rounded-lg text-xs"><SelectValue placeholder="Select film variant" /></SelectTrigger>
                                                                    <SelectContent>
                                                                        {filmVariants.map((m: Material) => (
                                                                            <SelectItem key={m.id || m.code} value={m.id || m.code}>
                                                                                {m.code} · {m.name}
                                                                            </SelectItem>
                                                                        ))}
                                                                    </SelectContent>
                                                                </Select>
                                                            ) : (
                                                                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                                                                    Add film variants first
                                                                </div>
                                                            )}
                                                        </EditField>
                                                        <EditField label="Thickness (μ)">
                                                            <LayerThicknessSelect
                                                                layer={row}
                                                                films={filmVariants}
                                                                recipes={recipes}
                                                                onChange={(patch) => patchLayer(i, patch)}
                                                            />
                                                        </EditField>
                                                        <EditField label="Default grade">
                                                            <LayerDefaultGradeSelect
                                                                layer={row}
                                                                films={filmVariants}
                                                                grades={grades}
                                                                recipes={recipes}
                                                                onChange={(patch) => patchLayer(i, patch)}
                                                            />
                                                        </EditField>
                                                        <EditField label="Allowed grades">
                                                            <LayerAllowedGradePicker
                                                                layer={row}
                                                                films={filmVariants}
                                                                grades={grades}
                                                                recipes={recipes}
                                                                onChange={(patch) => patchLayer(i, patch)}
                                                            />
                                                        </EditField>
                                                        <EditField label="Layer roll W override">
                                                            <Input type="number" className="h-8 rounded-lg text-right text-xs" placeholder="Optional" value={row.default_input_roll_width_mm || ""}
                                                                onChange={(e) => patchLayer(i, { default_input_roll_width_mm: e.target.value ? Number(e.target.value) : null })} />
                                                        </EditField>
                                                        <EditField label="Notes">
                                                            <Input className="h-8 rounded-lg text-xs" value={row.notes || ""} onChange={(e) => patchLayer(i, { notes: e.target.value })} />
                                                        </EditField>
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                        <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
                                            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                                            {hasLayerThicknessAxis ? (
                                                <>Thickness is a required per-layer order axis. No fixed default thickness is stored on create.</>
                                            ) : (
                                                <>Total default thickness <strong className="ml-1 text-slate-700">{totalThickness} μ</strong>. No global thickness or grade — per-layer only.</>
                                            )}
                                        </p>
                                    </div>
                                ) : (
                                    <LayerTemplateTable rows={draft.layer_template} />
                                )}
                            </SectionCardV3>

                            {/* Section 5: Variant axes */}
                            <SectionCardV3 index={5} title="Variant axes" description="Off = never asked. Optional = can be skipped; if used it affects matching/BOM. Required = sales/planner must enter it." accent="violet" actions={<EditActions section="axes" />}>
                                {isEditing("axes") ? (
                                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                        {AXIS_DEFS.map((def) => {
                                            const found = draft.variant_axes.find((a) => a.axis === def.axis)
                                            const mode = axisMode(found)
                                            return (
                                                <div key={def.axis} className={cn("rounded-xl border bg-white px-3 py-2.5",
                                                    mode === "required" && "border-blue-300 ring-1 ring-blue-100",
                                                    mode === "optional" && "border-violet-200 ring-1 ring-violet-50",
                                                    mode === "off" && "border-slate-200"
                                                )}>
                                                    <div className="flex items-start justify-between gap-3">
                                                        <div>
                                                            <div className="text-sm font-bold text-slate-900">{def.label || def.axis}</div>
                                                            <div className="text-[11px] text-slate-500">{def.type.replaceAll("_", " ")}</div>
                                                        </div>
                                                        <span className={cn(
                                                            "rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ring-1 ring-inset",
                                                            mode === "required" && "bg-blue-600 text-white ring-blue-700",
                                                            mode === "optional" && "bg-violet-50 text-violet-700 ring-violet-200",
                                                            mode === "off" && "bg-slate-50 text-slate-500 ring-slate-200"
                                                        )}>{mode}</span>
                                                    </div>
                                                    <div className="mt-2 grid grid-cols-3 gap-1 rounded-full bg-slate-100 p-1">
                                                        <button type="button" onClick={() => patchAxis(def.axis, false, false)}
                                                            className={cn("rounded-full px-2 py-1 text-[10px] font-bold uppercase", mode === "off" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500")}>Off</button>
                                                        <button type="button" onClick={() => patchAxis(def.axis, false, true)}
                                                            className={cn("rounded-full px-2 py-1 text-[10px] font-bold uppercase", mode === "optional" ? "bg-white text-violet-700 shadow-sm" : "text-slate-500")}>Optional</button>
                                                        <button type="button" onClick={() => patchAxis(def.axis, true, true)}
                                                            className={cn("rounded-full px-2 py-1 text-[10px] font-bold uppercase", mode === "required" ? "bg-blue-600 text-white shadow-sm" : "text-slate-500")}>Required</button>
                                                    </div>
                                                    <div className="mt-2 text-[11px] text-slate-500">{axisModeCopy(mode)}</div>
                                                </div>
                                            )
                                        })}
                                    </div>
                                ) : (
                                    <VariantAxisChips axes={draft.variant_axes} />
                                )}
                            </SectionCardV3>

                            {/* Section 6: Printing contract */}
                            <SectionCardV3 index={6} title="Printing contract" description="Only controls whether printing is possible and whether approved artwork is mandatory." accent="violet" actions={<EditActions section="print" />}>
                                {isEditing("print") ? (
                                    <div className="space-y-3">
                                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                            <ToggleRow label="Print capable" description="Sales can attach artwork/colorway or warning-print instructions." checked={!!draft.fixed_attributes?.print_capable} onChange={(v) => patchFixed({ print_capable: v })} />
                                            <ToggleRow label="Artwork required" description="Block production release until an approved artwork/colorway is selected." checked={!!draft.fixed_attributes?.artwork_required} onChange={(v) => patchFixed({ artwork_required: v })} />
                                        </div>
                                        <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-xs font-medium text-violet-800">
                                            Print method, sheet/tubing form, colors, ink mapping, and cylinder gate come from the selected approved artwork/colorway. If printing is capable but artwork is not required, the order can use a warning-print instruction and planner can assign artwork later.
                                        </div>
                                    </div>
                                ) : (
                                    <PrintContractView attrs={draft.fixed_attributes} />
                                )}
                            </SectionCardV3>

                            {/* Section 7: Packaging + POD contract */}
                            <SectionCardV3 index={7} title="Packaging + POD contract" description="Allowed catalog SKUs and automatic consumption rules; no manual per-order packing qty here." accent="emerald" actions={<EditActions section="packaging" />}>
                                {isEditing("packaging") ? (
                                    <PackagingEditor attrs={draft.fixed_attributes || {}} productKind={draft.product_kind} onPatch={patchFixed} />
                                ) : (
                                    <PackagingView attrs={draft.fixed_attributes} catalogAxes={catalogAxes} />
                                )}
                            </SectionCardV3>

                            {/* Section 8: Catalog-backed axes — POD / inner-pack / outer-pack picked from master-data */}
                            {hasCatalogAxes && (
                            <SectionCardV3
                                index={8}
                                    title="Catalog-backed packing/POD axes"
                                    description="These axes are not free text. Sales picks exact POD, inner-pack, outer-pack, or add-on codes from master data; the BOM consumes that exact inventory material and can auto-demand in-house stock when allowed."
                                    accent="violet"
                                    actions={
                                        <span className="rounded-full bg-violet-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-violet-700 ring-1 ring-inset ring-violet-200">
                                            {catalogAxes.length} {catalogAxes.length === 1 ? "axis" : "axes"}
                                        </span>
                                    }
                                >
                                    <CatalogAxesView axes={catalogAxes} />
                                </SectionCardV3>
                            )}
                        </TabsContent>

                        {/* ─────── VARIANT MATRIX TAB ─────── */}
                        <TabsContent value="variants" className="space-y-4">
                            {/* Summary strip */}
                            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                                <div className="rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 to-white px-4 py-3 ring-1 ring-blue-50">
                                    <div className="text-[10px] font-bold uppercase tracking-wider text-blue-500">Variants</div>
                                    <div className="mt-0.5 text-lg font-black text-blue-900">{variants.length}</div>
                                </div>
                                <div className="rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 to-white px-4 py-3 ring-1 ring-violet-50">
                                    <div className="text-[10px] font-bold uppercase tracking-wider text-violet-500">Active axes</div>
                                    <div className="mt-0.5 text-lg font-black text-violet-900">{draft.variant_axes.length}</div>
                                </div>
                                <div className="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white px-4 py-3 ring-1 ring-emerald-50">
                                    <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-500">Required</div>
                                    <div className="mt-0.5 text-lg font-black text-emerald-900">{draft.variant_axes.filter(isUiRequiredAxis).length}</div>
                                </div>
                                <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white px-4 py-3 ring-1 ring-slate-50">
                                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Sizes</div>
                                    <div className="mt-0.5 text-lg font-black text-slate-900">{draftSizes.filter((s) => s.active).length}</div>
                                </div>
                            </div>

                            {/* Active axes overview */}
                            <SectionCardV3 title="Active axis dimensions" description="These axes define what makes each variant unique. Required axes must be set on every order." accent="violet">
                                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                    {draft.variant_axes.map((a) => {
                                        const axisKey = String(a.axis)
                                        const isRollWidthAxis = axisKey === "layer_widths"
                                        const requiredForUi = a.required && !isRollWidthAxis
                                        const palette = requiredForUi
                                            ? { border: "border-blue-200", bg: "bg-gradient-to-br from-blue-50/80 to-white", ring: "ring-blue-100", icon: "bg-blue-100 text-blue-700 ring-blue-200", badge: "bg-blue-600 text-white ring-blue-700" }
                                            : { border: "border-violet-200", bg: "bg-gradient-to-br from-violet-50/60 to-white", ring: "ring-violet-50", icon: "bg-violet-100 text-violet-700 ring-violet-200", badge: "bg-violet-100 text-violet-700 ring-violet-200" }
                                        const displayLabel = isRollWidthAxis ? "Roll width override" : a.label || axisKey
                                        const displayType = isRollWidthAxis ? "variant number, auto from size" : String(a.type || "").replaceAll("_", " ")
                                        return (
                                            <div key={a.axis} className={cn("rounded-xl border px-4 py-3", palette.border, palette.bg, "ring-1", palette.ring)}>
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-2.5">
                                                        <span className={cn("flex h-8 w-8 items-center justify-center rounded-lg text-xs font-black ring-1", palette.icon)}>
                                                            {a.axis === "size" ? <Layers className="h-3.5 w-3.5" /> :
                                                             a.axis === "addons" ? <Sparkles className="h-3.5 w-3.5" /> :
                                                             a.axis === "packaging" ? <Package className="h-3.5 w-3.5" /> :
                                                             a.axis === "artwork_mode" ? <Palette className="h-3.5 w-3.5" /> :
                                                             <Workflow className="h-3.5 w-3.5" />}
                                                        </span>
                                                        <div>
                                                            <div className="text-sm font-bold text-slate-900">{displayLabel}</div>
                                                            <div className="text-[10px] text-slate-500">{displayType}</div>
                                                        </div>
                                                    </div>
                                                    <span className={cn("rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ring-1 ring-inset", palette.badge)}>
                                                        {isRollWidthAxis ? "Auto fallback" : a.required ? "Required" : "Optional"}
                                                    </span>
                                                </div>
                                                {a.axis === "size" && draftSizes.length > 0 && (
                                                    <div className="mt-2.5 flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
                                                        {draftSizes.filter((s) => s.active).map((s) => (
                                                            <span key={s.id} className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200">
                                                                {s.code} · {s.width_mm}×{s.height_mm}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                                {a.axis === "layer_thicknesses" && draft.layer_template.length > 0 && (
                                                    <div className="mt-2.5 flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
                                                        {draft.layer_template.map((l, li) => (
                                                            <span key={li} className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200">
                                                                L{li + 1}: {Number(l.thickness_micron || 0) > 0 ? `${l.thickness_micron}μ` : "variable"} {l.film_variant_code}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                                {a.axis === "layer_grades" && draft.layer_template.length > 0 && (
                                                    <div className="mt-2.5 flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
                                                        {draft.layer_template.filter((l) => l.grade_options?.length).map((l, li) => (
                                                            <span key={li} className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-700 shadow-sm ring-1 ring-slate-200">
                                                                L{li + 1}: {(l.grade_options || []).join(", ")}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                                {a.axis === "addons" && (
                                                    <div className="mt-2.5 flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
                                                        {["ZIPPER", "VALVE", "SPOUT", "HANG_HOLE", "TEAR_NOTCH"].map((addon) => (
                                                            <span key={addon} className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-600 shadow-sm ring-1 ring-slate-200">{addon}</span>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        )
                                    })}
                                </div>
                            </SectionCardV3>

                            {/* Variant rows · V3.7 pivot matrix + cards + table */}
                            <SectionCardV3 title="Variant matrix" description="Auto-deduped axis tuples. Each variant represents a unique combination used on orders. Pivot any 2 axes; click a cell to drill in." accent="blue"
                                actions={<Button size="sm" variant="outline" className="rounded-full" onClick={() => setVariantOpen(true)}><Plus className="mr-1 h-3.5 w-3.5" />Create tuple</Button>}>
                                <VariantsMatrixV37 productMasterId={draft.id} rows={variants} axes={draft.variant_axes} renderCards={() => <VariantTable rows={variants} axes={draft.variant_axes} />} />
                            </SectionCardV3>
                        </TabsContent>

                        {/* ─────── CUSTOMER OVERLAYS TAB ─────── */}
                        <TabsContent value="overlays" className="space-y-4">
                            {overlays.length > 0 && (
                                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                                    <div className="rounded-xl border border-blue-200 bg-gradient-to-br from-blue-50 to-white px-4 py-3 ring-1 ring-blue-50">
                                        <div className="text-[10px] font-bold uppercase tracking-wider text-blue-500">Customers</div>
                                        <div className="mt-0.5 text-lg font-black text-blue-900">{overlays.length}</div>
                                    </div>
                                    <div className="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white px-4 py-3 ring-1 ring-emerald-50">
                                        <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-500">With item codes</div>
                                        <div className="mt-0.5 text-lg font-black text-emerald-900">{overlays.filter((o: any) => o.customer_item_code).length}</div>
                                    </div>
                                    <div className="rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 to-white px-4 py-3 ring-1 ring-violet-50">
                                        <div className="text-[10px] font-bold uppercase tracking-wider text-violet-500">With MOQ</div>
                                        <div className="mt-0.5 text-lg font-black text-violet-900">{overlays.filter((o: any) => o.moq_kg).length}</div>
                                    </div>
                                </div>
                            )}
                            <SectionCardV3 title="Customer overlays" description="Customer-facing defaults and exceptions. Product Master axes still own engineering, stock matching, and BOM material selection." accent="blue"
                                actions={
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        className="rounded-full"
                                        onClick={() => setOverlayOpen(true)}
                                    >
                                        <Plus className="mr-1 h-3.5 w-3.5" />Add overlay
                                    </Button>
                                }>
                                <OverlayTable rows={overlays} />
                            </SectionCardV3>
                        </TabsContent>

                        {/* ─────── ARTWORKS TAB ─────── */}
                        <TabsContent value="artworks" className="space-y-4">
                            <SectionCardV3 title="Artwork contract" description="Print can be a warning-only order, or it can require a selected artwork. Artwork may be global or customer overlay default." accent="violet">
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                                    <ReadField label="Print capable" value={draft.fixed_attributes?.print_capable ? "Yes" : "No"} tone={draft.fixed_attributes?.print_capable ? "ok" : "warn"} />
                                    <ReadField label="Artwork required" value={draft.fixed_attributes?.artwork_required ? "Yes" : "No"} tone={draft.fixed_attributes?.artwork_required ? "ok" : "warn"} />
                                    <ReadField label="Artwork rules" value="Method, form, colors from artwork" />
                                </div>
                                {!draft.fixed_attributes?.artwork_required && draft.fixed_attributes?.print_capable && (
                                    <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-800">
                                        Printing is enabled without mandatory artwork. Sales can place a warning-only print commitment; production release still needs artwork/cylinder readiness where the route requires it.
                                    </div>
                                )}
                            </SectionCardV3>

                            <SectionCardV3 title="Approved artworks" description="Live artwork records matching this master’s print type and film form. No demo colorways are shown here." accent="blue">
                                {!draft.fixed_attributes?.print_capable ? (
                                    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/40 p-6 text-center text-sm text-slate-500">
                                        Print is not enabled for this master.
                                    </div>
                                ) : artworks.length === 0 ? (
                                    <div className="rounded-xl border border-dashed border-amber-200 bg-amber-50/50 p-6 text-center text-sm text-amber-800">
                                        No approved artwork found for this print contract yet. Add artwork in Engineering, then assign it globally or via customer overlay.
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                        {artworks.map((artwork: Artwork) => (
                                            <div key={artwork.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="min-w-0">
                                                        <div className="truncate text-sm font-black text-slate-900">{artwork.name}</div>
                                                        <div className="mt-0.5 font-mono text-xs font-bold text-blue-700">{artwork.design_code}</div>
                                                    </div>
                                                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-black uppercase text-emerald-700 ring-1 ring-emerald-200">
                                                        {artwork.status}
                                                    </span>
                                                </div>
                                                <div className="mt-3 flex flex-wrap gap-1.5">
                                                    <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-bold text-violet-700 ring-1 ring-violet-200">{artworkColorCode(artwork)}</span>
                                                    <span className="rounded-full bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-700 ring-1 ring-slate-200">{artwork.print_type || "PRINT"}</span>
                                                    <span className="rounded-full bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-700 ring-1 ring-slate-200">{artwork.substrate_mode || "FORM"}</span>
                                                    {artwork.print_type === "ROTO" && (
                                                        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold ring-1", artwork.cylinder_ready ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-amber-50 text-amber-700 ring-amber-200")}>
                                                            {artwork.cylinder_ready ? "Cylinder ready" : "Cylinder pending"}
                                                        </span>
                                                    )}
                                                </div>
                                                {(artwork.front_colors?.length || artwork.back_colors?.length) ? (
                                                    <div className="mt-3 text-[11px] text-slate-500">
                                                        {[...(artwork.front_colors || []), ...(artwork.back_colors || [])].join(", ")}
                                                    </div>
                                                ) : null}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </SectionCardV3>
                        </TabsContent>

                        {/* ─────── PLANNER STOCK TAB ─────── */}
                        <TabsContent value="planner" className="space-y-4">
                            <SectionCardV3 title="Planner stock launch point" description="This is not a stock-order form. It shows whether this master can launch reusable WIP; Stock Launcher creates the actual pool after quantity, stop step, and customer/artwork locks are validated." accent="blue">
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                                    <ReadField label="Reusable pools" value={String(master.planner_pools_count ?? 0)} />
                                    <ReadField label="Tuple variants" value={String(master.variants_count ?? variants.length)} />
                                    <ReadField label="Generic match key" value={master.invariant_signature || "—"} mono />
                                </div>
                                <div className="mt-4 grid gap-2 sm:grid-cols-3">
                                    <div className="rounded-xl border border-blue-100 bg-blue-50/70 px-3 py-2.5 text-xs text-blue-900">
                                        <div className="font-black">Generic WIP</div>
                                        <div className="mt-1 text-blue-800">Reusable until a compatible sales line pulls the same invariant tuple.</div>
                                    </div>
                                    <div className="rounded-xl border border-violet-100 bg-violet-50/70 px-3 py-2.5 text-xs text-violet-900">
                                        <div className="font-black">Customer/artwork WIP</div>
                                        <div className="mt-1 text-violet-800">Locks customer and/or artwork before release when reuse is no longer safe.</div>
                                    </div>
                                    <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 px-3 py-2.5 text-xs text-emerald-900">
                                        <div className="font-black">Packaging/POD stock</div>
                                        <div className="mt-1 text-emerald-800">Uses catalog-backed masters and auto-demand rules instead of manual BOM entry.</div>
                                    </div>
                                </div>
                            </SectionCardV3>
                            <div className="flex justify-center">
                                <Link href={`/production/planner/stock-launcher?master=${master.id}`}
                                    className="inline-flex items-center gap-2 rounded-full bg-violet-600 px-6 py-2.5 text-sm font-bold text-white shadow-md hover:bg-violet-700 hover:shadow-lg">
                                    Create WIP / stock in launcher <ArrowRight className="h-4 w-4" />
                                </Link>
                            </div>
                        </TabsContent>

                    </Tabs>
                </div>

                {/* ─── Right rail ─── */}
                <aside className="space-y-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pb-4">
                    <SectionCardV3 title="Use this master" description="Quick actions for sales & planner." accent="emerald">
                        <div className="flex flex-col gap-2.5">
                            <Link href={`/sales/orders/create?master=${master.id}`}
                                className="flex items-center justify-between rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-3.5 text-sm font-bold text-white shadow-lg shadow-blue-600/25 ring-1 ring-blue-500/50 transition-all hover:shadow-xl hover:shadow-blue-600/30">
                                Create sales order <ArrowRight className="h-4 w-4" />
                            </Link>
                            <Link href={`/production/planner/stock-launcher?master=${master.id}`}
                                className="flex items-center justify-between rounded-xl bg-gradient-to-r from-violet-600 to-fuchsia-600 px-4 py-3.5 text-sm font-bold text-white shadow-lg shadow-violet-600/25 ring-1 ring-violet-500/50 transition-all hover:shadow-xl hover:shadow-violet-600/30">
                                Launch WIP / stock <ArrowRight className="h-4 w-4" />
                            </Link>
                        </div>
                    </SectionCardV3>

                    {consumers.length > 0 && (
                        <SectionCardV3 title="Used by" description={`${consumers.length} downstream master${consumers.length === 1 ? "" : "s"}`} accent="amber">
                            {consumers.length === 0 ? (
                                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/40 p-4 text-center">
                                    <div className="text-xs font-semibold text-slate-600">No consumers yet</div>
                                    <div className="mt-1 text-[11px] text-slate-500">When another master adds this as a BOM input, it appears here.</div>
                                </div>
                            ) : (
                                <ul className="space-y-1.5">
                                    {consumers.map((c) => (
                                        <li key={c.id}>
                                            <Link href={`/master/products/${c.id}`}
                                                className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 shadow-sm transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700">
                                                <span className="min-w-0 truncate">
                                                    <span className="font-mono">{c.code}</span>
                                                    <span className="ml-2 font-normal text-slate-500">{c.name}</span>
                                                </span>
                                                <ArrowRight className="h-3 w-3 flex-none" />
                                            </Link>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </SectionCardV3>
                    )}


                    {draft.fixed_attributes?.print_capable && (
                        <SectionCardV3 title="Artwork readiness" description="Live approved artwork pool." accent="violet">
                            <div className="space-y-3">
                                <div className="grid grid-cols-2 gap-2 text-[11px]">
                                    <div className="rounded-lg bg-slate-50 px-2 py-1.5">
                                        <div className="text-slate-500">Source</div>
                                        <div className="font-bold text-slate-800">Approved artwork</div>
                                    </div>
                                    <div className="rounded-lg bg-slate-50 px-2 py-1.5">
                                        <div className="text-slate-500">Approved</div>
                                        <div className="font-bold text-slate-800">{artworks.length}</div>
                                    </div>
                                    <div className="rounded-lg bg-slate-50 px-2 py-1.5">
                                        <div className="text-slate-500">Method/form</div>
                                        <div className="font-bold text-slate-800">From artwork</div>
                                    </div>
                                    <div className="rounded-lg bg-slate-50 px-2 py-1.5">
                                        <div className="text-slate-500">Gate</div>
                                        <div className="font-bold text-slate-800">{draft.fixed_attributes?.artwork_required ? "Artwork required" : "Warning allowed"}</div>
                                    </div>
                                </div>
                                {artworks.slice(0, 3).map((artwork) => (
                                    <div key={artwork.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
                                        <div className="font-bold text-slate-900">{artwork.design_code}</div>
                                        <div className="mt-0.5 text-[11px] text-slate-500">{artworkColorCode(artwork)} · {artwork.name}</div>
                                    </div>
                                ))}
                            </div>
                        </SectionCardV3>
                    )}

                    <LiveBomRail
                        title="Live preview"
                        subtitle="Canonical axis tuple snapshot"
                        preview={
                            draftSizes.length && draft.layer_template.length
                                ? {
                                      variant_status: "NEW" as const,
                                      invariant_signature: draft.invariant_signature || "INV-DRAFT",
                                      geometry_snapshot: {
                                          finished_good_type: draft.product_kind,
                                          size_code: draftSizes[0].code,
                                          size_label: draftSizes[0].label,
                                          width_mm: draftSizes[0].width_mm,
                                          height_mm: draftSizes[0].height_mm,
                                          gusset_mm: draftSizes[0].gusset_mm,
                                          roll_width_mm: draftSizes[0].roll_width_mm || autoRollWidthMm(draftSizes[0], draft.product_kind),
                                          thickness_um: totalThickness,
                                          faces: draftSizes[0].faces,
                                      },
                                      layer_snapshot: draft.layer_template.map((l) => ({
                                          role: l.role,
                                          film_variant_code: l.film_variant_code,
                                          thickness_micron: l.thickness_micron,
                                          grade: l.default_grade,
                                          roll_width_mm: l.default_input_roll_width_mm || draftSizes[0].roll_width_mm || autoRollWidthMm(draftSizes[0], draft.product_kind),
                                      })),
                                      bom_by_step: [],
                                      blockers: [],
                                      warnings: [],
                                      checks: [],
                                  }
                                : null
                        }
                    />

                    <SectionCardV3 title="Model explainer" description="How V3 daily flow works." accent="slate">
                        <ul className="space-y-2 text-xs text-slate-600">
                            <li className="flex items-start gap-2">
                                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-none text-emerald-600" />
                                Sales picks this master + axes — no SKU prework.
                            </li>
                            <li className="flex items-start gap-2">
                                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-none text-emerald-600" />
                                ProductVariant is auto-created/reused on submit.
                            </li>
                            <li className="flex items-start gap-2">
                                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-none text-emerald-600" />
                                Customer overlays apply item code, price basis and packing recipe.
                            </li>
                            <li className="flex items-start gap-2">
                                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-none text-emerald-600" />
                                Planner can build generic, customer-locked or artwork-locked stock.
                            </li>
                            <li className="flex items-start gap-2">
                                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-none text-emerald-600" />
                                Packaging and POD are first-class BOM lines, not just notes.
                            </li>
                        </ul>
                    </SectionCardV3>
                </aside>
            </div>

            <Dialog open={variantOpen} onOpenChange={setVariantOpen}>
                <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-3xl overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Create variant tuple</DialogTitle>
                        <DialogDescription>
                            This creates or reuses the exact ProductVariant used by sales/planner. Required axes must be filled; optional axes may stay blank.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                        {draft.variant_axes.length === 0 ? (
                            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-6 text-center text-sm text-slate-500">
                                No axes configured. Add variant axes in Spec & recipe first.
                            </div>
                        ) : (
                            draft.variant_axes.map((axis) => {
                                const key = String(axis.axis)
                                const label = key === "layer_widths" ? "Roll width override" : axis.label || key.replace(/_/g, " ")
                                if (key === "size") {
                                    return (
                                        <EditField key={key} label={`${label}${axis.required ? " *" : ""}`}>
                                            <Select value={variantDraft.size || ""} onValueChange={(v) => patchVariantAxis("size", v)}>
                                                <SelectTrigger className="h-10 rounded-xl"><SelectValue placeholder="Select final size" /></SelectTrigger>
                                                <SelectContent>
                                                    {draftSizes.filter((s) => s.active).map((s) => (
                                                        <SelectItem key={s.id || s.code} value={s.code}>
                                                            {s.code} · {s.width_mm}×{s.height_mm} mm · roll {s.roll_width_mm || autoRollWidthMm(s, draft.product_kind)} mm
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </EditField>
                                    )
                                }
                                if (key === "layer_widths") {
                                    return (
                                        <div key={key} className="rounded-xl border border-sky-200 bg-sky-50/40 p-3">
                                            <div className="mb-2 flex items-center justify-between">
                                                <div>
                                                    <div className="text-sm font-bold text-slate-900">Roll width override</div>
                                                    <div className="text-[11px] text-slate-500">
                                                        Optional. Blank uses the selected size override or the size geometry rule.
                                                    </div>
                                                </div>
                                            </div>
                                            <EditField label="Variant roll width (mm)">
                                                <Input
                                                    type="number"
                                                    className="h-9 rounded-xl text-xs"
                                                    placeholder={variantAutoRollWidth ? `auto ${variantAutoRollWidth} mm` : "auto from size"}
                                                    value={variantRollWidthValue}
                                                    onChange={(e) => patchVariantRollWidth(e.target.value ? Number(e.target.value) : "")}
                                                />
                                            </EditField>
                                            <div className="mt-2 rounded-lg bg-white px-3 py-2 text-[11px] text-slate-500 ring-1 ring-slate-200">
                                                Applied to every layer for consumption width. Layer material identity stays fixed by the Product Master.
                                            </div>
                                        </div>
                                    )
                                }
                                if (key === "layer_thicknesses" || key === "layer_grades") {
                                    return (
                                        <div key={key} className="rounded-xl border border-slate-200 bg-white p-3">
                                            <div className="mb-2 flex items-center justify-between">
                                                <div>
                                                    <div className="text-sm font-bold text-slate-900">{label}{axis.required ? " *" : ""}</div>
                                                    <div className="text-[11px] text-slate-500">{axisModeCopy(axis.required ? "required" : "optional")}</div>
                                                </div>
                                            </div>
                                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                                {draft.layer_template.map((layer, index) => {
                                                    const layerKey = String(index + 1)
                                                    if (key === "layer_thicknesses") {
                                                        const options = thicknessOptionsForLayer(layer, filmVariants, recipes)
                                                        return (
                                                            <EditField key={layerKey} label={`L${index + 1}`}>
                                                                {options.length ? (
                                                                    <Select
                                                                        value={variantDraft[key]?.[layerKey] ? String(variantDraft[key]?.[layerKey]) : undefined}
                                                                        onValueChange={(v) => patchVariantLayerAxis(key, index, Number(v))}
                                                                    >
                                                                        <SelectTrigger className="h-9 rounded-xl text-xs">
                                                                            <SelectValue placeholder={`${layer.thickness_micron || ""} micron`} />
                                                                        </SelectTrigger>
                                                                        <SelectContent>
                                                                            {options.map((option) => (
                                                                                <SelectItem key={option} value={String(option)}>
                                                                                    {option} micron
                                                                                </SelectItem>
                                                                            ))}
                                                                        </SelectContent>
                                                                    </Select>
                                                                ) : (
                                                                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                                                                        No thickness choices
                                                                    </div>
                                                                )}
                                                            </EditField>
                                                        )
                                                    }
                                                    if (key === "layer_grades") {
                                                        const gradeOptions = gradeOptionsForLayer(layer, filmVariants, grades, recipes)
                                                        const film = filmForLayer(layer, filmVariants)
                                                        if (!gradeOptions.length || isPurchasedOnlyFilm(film)) {
                                                            return (
                                                                <EditField key={layerKey} label={`L${index + 1}`}>
                                                                    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
                                                                        Grade not required
                                                                    </div>
                                                                </EditField>
                                                            )
                                                        }
                                                        return (
                                                            <EditField key={layerKey} label={`L${index + 1}`}>
                                                                <Select
                                                                    value={variantDraft[key]?.[layerKey] || ""}
                                                                    onValueChange={(v) => patchVariantLayerAxis(key, index, v)}
                                                                >
                                                                    <SelectTrigger className="h-9 rounded-xl text-xs"><SelectValue placeholder={layer.default_grade || "Pick grade"} /></SelectTrigger>
                                                                    <SelectContent>
                                                                        {gradeOptions.map((grade) => (
                                                                            <SelectItem key={grade} value={grade}>{grade}</SelectItem>
                                                                        ))}
                                                                    </SelectContent>
                                                                </Select>
                                                            </EditField>
                                                        )
                                                    }
                                                    return null
                                                })}
                                            </div>
                                        </div>
                                    )
                                }
                                if (key === "addons") {
                                    return (
                                        <EditField key={key} label={`${label}${axis.required ? " *" : ""}`}>
                                            <div className="flex min-h-10 flex-wrap gap-1.5 rounded-xl border border-slate-200 bg-white px-2 py-2">
                                                {addons.map((addon: Material) => {
                                                    const selected = Array.isArray(variantDraft.addons) && variantDraft.addons.includes(addon.code)
                                                    return (
                                                        <button
                                                            key={addon.id || addon.code}
                                                            type="button"
                                                            onClick={() => {
                                                                const next = new Set(Array.isArray(variantDraft.addons) ? variantDraft.addons : [])
                                                                if (selected) next.delete(addon.code)
                                                                else next.add(addon.code)
                                                                patchVariantAxis("addons", Array.from(next))
                                                            }}
                                                            className={cn(
                                                                "rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ring-1 ring-inset transition",
                                                                selected ? "bg-violet-600 text-white ring-violet-700" : "bg-slate-50 text-slate-600 ring-slate-200 hover:ring-violet-200"
                                                            )}
                                                        >
                                                            {addon.code}
                                                        </button>
                                                    )
                                                })}
                                                {!addons.length ? (
                                                    <span className="px-2 py-1 text-xs font-semibold text-amber-700">No active add-ons in master data.</span>
                                                ) : null}
                                            </div>
                                        </EditField>
                                    )
                                }
                                if (key === "pod" || key === "pod_variant") {
                                    return (
                                        <EditField key={key} label={`${label}${axis.required ? " *" : ""}`}>
                                            <Select value={variantDraft[key] || ""} onValueChange={(v) => patchVariantAxis(key, v)}>
                                                <SelectTrigger className="h-10 rounded-xl"><SelectValue placeholder="Select POD" /></SelectTrigger>
                                                <SelectContent>
                                                    {podVariants.map((pod: PodSkuVariant) => (
                                                        <SelectItem key={pod.id || pod.code} value={pod.code}>
                                                            {pod.code} · {pod.name}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </EditField>
                                    )
                                }
                                if (key === "packaging" || key === "packaging_inner" || key === "packaging_outer") {
                                    return (
                                        <EditField key={key} label={`${label}${axis.required ? " *" : ""}`}>
                                            <Select value={variantDraft[key] || ""} onValueChange={(v) => patchVariantAxis(key, v)}>
                                                <SelectTrigger className="h-10 rounded-xl"><SelectValue placeholder="Select packaging SKU" /></SelectTrigger>
                                                <SelectContent>
                                                    {packagingMaterials.map((pack: PackagingMaterial) => (
                                                        <SelectItem key={pack.id || pack.code} value={pack.code}>
                                                            {pack.code} · {pack.name}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </EditField>
                                    )
                                }
                                if (key === "artwork_mode") {
                                    return (
                                        <EditField key={key} label={`${label}${axis.required ? " *" : ""}`}>
                                            <Select value={variantDraft.artwork_mode || ""} onValueChange={(v) => patchVariantAxis("artwork_mode", v)}>
                                                <SelectTrigger className="h-10 rounded-xl"><SelectValue placeholder="Select print commitment" /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="NO_ARTWORK_PRINT_WARNING">Print warning only</SelectItem>
                                                    <SelectItem value="GLOBAL_ARTWORK">Global artwork</SelectItem>
                                                    <SelectItem value="CUSTOMER_ARTWORK">Customer artwork</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </EditField>
                                    )
                                }
                                return (
                                    <EditField key={key} label={`${label}${axis.required ? " *" : ""}`}>
                                        <Input className="h-10 rounded-xl" value={variantDraft[key] || ""} onChange={(e) => patchVariantAxis(key, e.target.value)} />
                                    </EditField>
                                )
                            })
                        )}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setVariantOpen(false)} className="rounded-xl">Cancel</Button>
                        <Button onClick={() => variantMutation.mutate()} disabled={variantMutation.isPending || variantRequiredMissing || draft.variant_axes.length === 0} className="gap-1.5 rounded-xl">
                            {variantMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                            Create/reuse tuple
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={overlayOpen} onOpenChange={setOverlayOpen}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>Add customer sales overlay</DialogTitle>
                        <DialogDescription>
                            Customer-specific item code, price basis, defaults, and exceptions. Packing SKUs still come from Product Master catalog axes unless this customer needs an override.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <EditField label="Customer">
                            <CustomerOverlayPicker
                                customers={customers}
                                value={overlayDraft.customer}
                                onChange={(v) => setOverlayDraft((d) => ({ ...d, customer: v }))}
                            />
                        </EditField>
                        <EditField label="Price basis">
                            <Select
                                value={overlayDraft.default_price_basis}
                                onValueChange={(v) => setOverlayDraft((d) => ({ ...d, default_price_basis: v as "KG" | "PCS" }))}
                            >
                                <SelectTrigger className="h-10 rounded-xl">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="KG">Per kg</SelectItem>
                                    <SelectItem value="PCS">Per pcs</SelectItem>
                                </SelectContent>
                            </Select>
                        </EditField>
                        <EditField label="Customer item code">
                            <Input
                                className="h-10 rounded-xl"
                                value={overlayDraft.customer_item_code}
                                onChange={(e) => setOverlayDraft((d) => ({ ...d, customer_item_code: e.target.value.toUpperCase() }))}
                                placeholder="e.g. ACME-SNK-250"
                            />
                        </EditField>
                        <EditField label="Display name">
                            <Input
                                className="h-10 rounded-xl"
                                value={overlayDraft.customer_display_name}
                                onChange={(e) => setOverlayDraft((d) => ({ ...d, customer_display_name: e.target.value }))}
                                placeholder="Customer-facing product name"
                            />
                        </EditField>
                        <EditField label="Minimum order kg (MOQ)" hint="Commercial minimum for this customer/product. It does not change the engineering BOM.">
                            <Input
                                type="number"
                                className="h-10 rounded-xl"
                                value={overlayDraft.moq_kg}
                                onChange={(e) => setOverlayDraft((d) => ({ ...d, moq_kg: e.target.value }))}
                                placeholder="Optional"
                            />
                        </EditField>
                        <EditField label="Default size lock" hint="Optional. Use only when this customer normally orders one size from the master.">
                            <Select
                                value={overlayDraft.axis_size}
                                onValueChange={(v) => setOverlayDraft((d) => ({ ...d, axis_size: v }))}
                            >
                                <SelectTrigger className="h-10 rounded-xl">
                                    <SelectValue placeholder="Optional" />
                                </SelectTrigger>
                                <SelectContent>
                                    {draftSizes.filter((s) => s.active).map((s) => (
                                        <SelectItem key={s.id || s.code} value={s.code}>
                                            {s.code} · {s.width_mm}×{s.height_mm}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </EditField>
                        <EditField label="Default artwork" hint="Optional customer default. Sales can still pick another approved artwork when allowed.">
                            <Select
                                value={overlayDraft.default_artwork}
                                onValueChange={(v) => setOverlayDraft((d) => ({ ...d, default_artwork: v }))}
                            >
                                <SelectTrigger className="h-10 rounded-xl">
                                    <SelectValue placeholder="Optional" />
                                </SelectTrigger>
                                <SelectContent>
                                    {artworks.map((artwork: Artwork) => (
                                        <SelectItem key={artwork.id} value={artwork.id}>
                                            {artwork.design_code} · {artwork.name} · {artworkColorCode(artwork)}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </EditField>
                        {(podAxis || draft.fixed_attributes?.pod_enabled) ? (
                            <EditField label="Default POD" hint="Optional. Must be one of the POD catalog values allowed on this Product Master.">
                                <Select
                                    value={overlayDraft.default_pod}
                                    onValueChange={(v) => setOverlayDraft((d) => ({ ...d, default_pod: v }))}
                                >
                                    <SelectTrigger className="h-10 rounded-xl">
                                        <SelectValue placeholder="No customer default" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {overlayPodOptions.map((pod: PodSkuVariant) => (
                                            <SelectItem key={pod.id || pod.code} value={pod.code}>
                                                {pod.code} · {pod.name || pod.pod_sku_name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </EditField>
                        ) : null}
                        {innerPackagingOverlayOptions.length ? (
                            <EditField label="Default inner pouch" hint="Optional. Must be one of the inner SKUs allowed on this Product Master.">
                                <Select
                                    value={overlayDraft.default_packaging_inner}
                                    onValueChange={(v) => setOverlayDraft((d) => ({ ...d, default_packaging_inner: v }))}
                                >
                                    <SelectTrigger className="h-10 rounded-xl"><SelectValue placeholder="No customer default" /></SelectTrigger>
                                    <SelectContent>
                                        {innerPackagingOverlayOptions.map((option, index) => (
                                            <SelectItem key={`${option.value}-${index}`} value={option.value}>{option.label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </EditField>
                        ) : null}
                        {outerPackagingOverlayOptions.length ? (
                            <EditField label="Default outer / sheet" hint="Optional. Gunny is counted in Packing Yard; sheet/wrap is EOD open-close.">
                                <Select
                                    value={overlayDraft.default_packaging_outer}
                                    onValueChange={(v) => setOverlayDraft((d) => ({ ...d, default_packaging_outer: v }))}
                                >
                                    <SelectTrigger className="h-10 rounded-xl"><SelectValue placeholder="No customer default" /></SelectTrigger>
                                    <SelectContent>
                                        {outerPackagingOverlayOptions.map((option, index) => (
                                            <SelectItem key={`${option.value}-${index}`} value={option.value}>{option.label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </EditField>
                        ) : null}
                        {otherPackagingOverlayOptions.length ? (
                            <EditField label="Default other EOD item" hint="Optional. Used as the customer’s default allowed item; final issue still posts from EOD count.">
                                <Select
                                    value={overlayDraft.default_packaging_other}
                                    onValueChange={(v) => setOverlayDraft((d) => ({ ...d, default_packaging_other: v }))}
                                >
                                    <SelectTrigger className="h-10 rounded-xl"><SelectValue placeholder="No customer default" /></SelectTrigger>
                                    <SelectContent>
                                        {otherPackagingOverlayOptions.map((option, index) => (
                                            <SelectItem key={`${option.value}-${index}`} value={option.value}>{option.label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </EditField>
                        ) : null}
                        <EditField label="Layer grade preset" span={2} hint="Only extruded layers show grade choices from recipe/grade masters. Purchased films do not need grade input.">
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                {draft.layer_template.map((layer, index) => {
                                    const layerKey = String(index + 1)
                                    const film = filmForLayer(layer, filmVariants)
                                    const options = gradeOptionsForLayer(layer, filmVariants, grades, recipes)
                                    if (isPurchasedOnlyFilm(film) || !options.length) {
                                        return (
                                            <div key={layerKey} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                                                <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">L{layerKey}</div>
                                                <div className="mt-1 text-xs font-semibold text-slate-600">No grade override needed</div>
                                            </div>
                                        )
                                    }
                                    return (
                                        <div key={layerKey} className="space-y-1">
                                            <Label className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">
                                                L{layerKey}
                                            </Label>
                                            <Select
                                                value={overlayDraft.axis_layer_grades[layerKey] || undefined}
                                                onValueChange={(value) =>
                                                    setOverlayDraft((d) => ({
                                                        ...d,
                                                        axis_layer_grades: { ...d.axis_layer_grades, [layerKey]: value },
                                                    }))
                                                }
                                            >
                                                <SelectTrigger className="h-10 rounded-xl">
                                                    <SelectValue placeholder={layer.default_grade || "Optional"} />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {options.map((grade) => (
                                                        <SelectItem key={grade} value={grade}>
                                                            {grade}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    )
                                })}
                            </div>
                        </EditField>
                        <div className="sm:col-span-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-900">
                            <div className="font-black uppercase tracking-[0.16em] text-emerald-700">Packing source</div>
                            <div className="mt-1 leading-relaxed">
                                Inner pouch, outer/gonny, POD, and add-on choices are selected through catalog-backed Product Master axes.
                                {innerPackAxis?.default_value ? ` Default inner: ${innerPackAxis.default_value}.` : " Inner pack is selected from the packaging_inner axis when configured."}
                                {outerPackAxis?.default_value ? ` Default outer: ${outerPackAxis.default_value}.` : " Gonny/outer handling is counted in Packing Yard."}
                                {podAxis?.default_value ? ` Default POD: ${podAxis.default_value}.` : ""}
                                If an inner pouch is printed or in-house, its own Packaging Product Master/template/artwork controls that production.
                            </div>
                        </div>
                        <EditField label="Override pcs per inner pack" hint="Leave empty to use the selected inner-pouch master/default. Enter only customer-specific packing exceptions.">
                            <Input
                                type="number"
                                className="h-10 rounded-xl"
                                value={overlayDraft.pcs_per_inner}
                                onChange={(e) => setOverlayDraft((d) => ({ ...d, pcs_per_inner: e.target.value }))}
                                placeholder="Optional"
                            />
                        </EditField>
                        <EditField label="Override gunny capacity kg" hint="Leave empty for Packing Yard counted gonnies. Use only for a customer-specific capacity rule.">
                            <Input
                                type="number"
                                className="h-10 rounded-xl"
                                value={overlayDraft.gunny_capacity_kg}
                                onChange={(e) => setOverlayDraft((d) => ({ ...d, gunny_capacity_kg: e.target.value }))}
                                placeholder="Optional"
                            />
                        </EditField>
                        <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2">
                            <div>
                                <div className="text-sm font-bold text-slate-900">Active overlay</div>
                                <div className="text-[11px] text-slate-500">Sales can auto-apply these defaults.</div>
                            </div>
                            <Switch
                                checked={overlayDraft.active}
                                onCheckedChange={(v) => setOverlayDraft((d) => ({ ...d, active: v }))}
                            />
                        </div>
                        <EditField label="Notes" span={2}>
                            <Textarea
                                className="min-h-[72px] rounded-xl"
                                value={overlayDraft.notes}
                                onChange={(e) => setOverlayDraft((d) => ({ ...d, notes: e.target.value }))}
                                placeholder="Optional sales/planner note."
                            />
                        </EditField>
                        <EditField label="Customer packing note" span={2} hint="Optional instruction for packers; not used as the BOM source of truth.">
                            <Textarea
                                className="min-h-[64px] rounded-xl"
                                value={overlayDraft.default_packing_note}
                                onChange={(e) => setOverlayDraft((d) => ({ ...d, default_packing_note: e.target.value }))}
                                placeholder="Optional customer-specific packing instruction."
                            />
                        </EditField>
                    </div>

                    <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-xs text-blue-800">
                        Save this only for customer-specific defaults. Sales and planner still resolve the final BOM from the selected size/layer/artwork/catalog tuple.
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setOverlayOpen(false)} className="rounded-xl">
                            Cancel
                        </Button>
                        <Button
                            onClick={() => overlayMutation.mutate()}
                            disabled={!overlayDraft.customer || !overlayDraft.customer_item_code || overlayMutation.isPending}
                            className="gap-1.5 rounded-xl"
                        >
                            {overlayMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                            Save overlay
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

        </div>
    )
}

// ─── Sub-components ────────────────────────────────────────────

function EditField({ label, children, span, hint }: { label: string; children: React.ReactNode; span?: number; hint?: string }) {
    return (
        <div className={span === 2 ? "sm:col-span-2" : ""}>
            <Label className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">{label}</Label>
            <div className="mt-1">{children}</div>
            {hint ? <div className="mt-1 text-[11px] leading-snug text-slate-500">{hint}</div> : null}
        </div>
    )
}

function CustomerOverlayPicker({
    customers,
    value,
    onChange,
}: {
    customers: Customer[]
    value: string
    onChange: (value: string) => void
}) {
    const [query, setQuery] = React.useState("")
    const selected = customers.find((customer) => customer.id === value)
    const filtered = React.useMemo(() => {
        const q = query.trim().toLowerCase()
        const rows = q
            ? customers.filter((customer) =>
                  [customer.name, customer.code, customer.phone, customer.email]
                      .filter(Boolean)
                      .join(" ")
                      .toLowerCase()
                      .includes(q)
              )
            : customers
        return rows.slice(0, 8)
    }, [customers, query])

    return (
        <div className="rounded-xl border border-slate-200 bg-white p-2 shadow-sm">
            {selected ? (
                <div className="mb-2 flex items-center justify-between rounded-lg bg-blue-50 px-2.5 py-2 ring-1 ring-blue-100">
                    <div className="min-w-0">
                        <div className="truncate text-xs font-bold text-blue-900">{selected.name}</div>
                        <div className="font-mono text-[10px] font-semibold text-blue-600">{selected.code}</div>
                    </div>
                    <Button type="button" variant="ghost" size="sm" className="h-7 rounded-lg px-2 text-[11px]" onClick={() => onChange("")}>
                        Change
                    </Button>
                </div>
            ) : null}
            <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <Input
                    className="h-9 rounded-lg border-slate-200 pl-8 text-xs"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search customer name or code"
                />
            </div>
            <div className="mt-2 max-h-44 space-y-1 overflow-y-auto pr-1">
                {filtered.map((customer) => {
                    const active = customer.id === value
                    return (
                        <button
                            key={customer.id}
                            type="button"
                            onClick={() => onChange(customer.id)}
                            className={cn(
                                "flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs transition",
                                active ? "bg-blue-600 text-white" : "bg-slate-50 text-slate-700 hover:bg-blue-50 hover:text-blue-800"
                            )}
                        >
                            <span className="min-w-0">
                                <span className="block truncate font-bold">{customer.name}</span>
                                <span className={cn("block font-mono text-[10px]", active ? "text-blue-100" : "text-slate-400")}>{customer.code}</span>
                            </span>
                            {active ? <CheckCircle2 className="h-3.5 w-3.5 flex-none" /> : null}
                        </button>
                    )
                })}
                {filtered.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-center text-xs text-slate-500">
                        No customers match this search.
                    </div>
                ) : null}
            </div>
        </div>
    )
}

function ReadField({ label, value, mono, tone }: { label: string; value: string; mono?: boolean; tone?: "ok" | "warn" }) {
    return (
        <div className="rounded-lg bg-slate-50/60 px-2.5 py-1.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</div>
            <div className={cn("mt-0.5 text-sm font-bold text-slate-800", mono && "font-mono",
                tone === "ok" && "text-emerald-700", tone === "warn" && "text-amber-700"
            )}>{value}</div>
        </div>
    )
}

function ToggleRow({ label, description, checked, onChange }: { label: string; description?: string; checked: boolean; onChange: (v: boolean) => void }) {
    return (
        <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2.5">
            <div>
                <div className="text-sm font-bold text-slate-900">{label}</div>
                {description && <div className="text-[11px] text-slate-500">{description}</div>}
            </div>
            <Switch checked={checked} onCheckedChange={onChange} />
        </div>
    )
}

function SizeTable({ rows, kind }: { rows: any[]; kind: string }) {
    if (!rows.length) {
        return (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/40 p-8 text-center">
                <Layers className="mx-auto h-8 w-8 text-slate-300" />
                <div className="mt-3 text-sm font-semibold text-slate-700">No sizes yet</div>
                <div className="mt-1 text-xs text-slate-500">Click Edit to add geometry options (width, height, gusset, roll width).</div>
            </div>
        )
    }
    return (
        <div className="max-h-[32rem] space-y-2 overflow-y-auto">
            {rows.map((r, i) => (
                <div key={r.id} className={cn("rounded-xl border bg-white transition-all hover:shadow-sm",
                    r.active ? "border-slate-200" : "border-rose-200 bg-rose-50/20"
                )}>
                    <div className="flex items-center justify-between px-4 py-3">
                        <div className="flex items-center gap-3">
                            <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg text-xs font-black ring-1",
                                r.active ? "bg-emerald-50 text-emerald-700 ring-emerald-100" : "bg-rose-50 text-rose-700 ring-rose-100"
                            )}>S{i + 1}</div>
                            <div>
                                <div className="flex items-center gap-2">
                                    <span className="text-sm font-bold text-slate-900">{r.code}</span>
                                    <span className="text-xs text-slate-500">{r.label}</span>
                                    <span className={cn("rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ring-1 ring-inset",
                                        r.active ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-rose-50 text-rose-700 ring-rose-200"
                                    )}>{r.active ? "Active" : "Inactive"}</span>
                                </div>
                                <div className="mt-0.5 text-[11px] text-slate-500">
                                    {r.pouch_style || r.roll_form || kind}
                                    {r.standard_qty ? ` · Std qty: ${r.standard_qty} ${r.qty_uom}` : ""}
                                </div>
                            </div>
                        </div>
                    </div>
                    <div className="border-t border-slate-100 px-4 py-2.5">
                        <div className="flex flex-wrap gap-2">
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold text-emerald-800 ring-1 ring-emerald-200">
                                W×H: {r.width_mm}×{r.height_mm} mm
                            </span>
                            {r.gusset_mm > 0 && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-semibold text-blue-800 ring-1 ring-blue-200">
                                    Gusset: {r.gusset_mm} mm
                                </span>
                            )}
                            <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2.5 py-1 text-[10px] font-semibold text-violet-800 ring-1 ring-violet-200">
                                Roll W: {r.roll_width_mm ? `${r.roll_width_mm} mm` : `auto ${autoRollWidthMm(r, kind) || "—"} mm`}
                            </span>
                            {r.faces && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2.5 py-1 text-[10px] font-semibold text-sky-800 ring-1 ring-sky-200">
                                    {r.faces} faces
                                </span>
                            )}
                            {r.trim_loss_mm > 0 && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-semibold text-amber-800 ring-1 ring-amber-200">
                                    Trim: {r.trim_loss_mm} mm
                                </span>
                            )}
                            {r.flap_tape_mm > 0 && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-semibold text-amber-800 ring-1 ring-amber-200">
                                    Flap: {r.flap_tape_mm} mm
                                </span>
                            )}
                            {Array.isArray(r.adjustments) && r.adjustments.length > 0 && (
                                <span className="inline-flex items-center gap-1 rounded-full bg-cyan-50 px-2.5 py-1 text-[10px] font-semibold text-cyan-800 ring-1 ring-cyan-200">
                                    Adjustments: {r.adjustments.length}
                                </span>
                            )}
                        </div>
                    </div>
                </div>
            ))}
        </div>
    )
}

function LayerTemplateTable({ rows }: { rows: any[] }) {
    if (!rows.length) return <p className="text-sm text-slate-500">No layers yet — click Edit to define the layer stack.</p>
    const total = rows.reduce((s, r) => s + (r.thickness_micron || 0), 0)
    return (
        <div className="space-y-2">
            {rows.map((row, i) => (
                <div key={i} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
                    <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-blue-50 text-[10px] font-black text-blue-700 ring-1 ring-blue-100">L{i + 1}</span>
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                            <span className="rounded bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700 ring-1 ring-blue-100">{row.film_variant_code}</span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
                            <span className="font-semibold text-slate-700">{row.thickness_micron} μ</span>
                            {row.default_grade && <span>Grade: {row.default_grade}</span>}
                            {(row.grade_options || []).length > 0 && (
                                <span className="flex items-center gap-1">
                                    Options: {row.grade_options.map((g: string) => (
                                        <span key={g} className={cn("rounded px-1 py-0.5 text-[9px] font-semibold ring-1",
                                            g === row.default_grade ? "bg-emerald-50 text-emerald-700 ring-emerald-100" : "bg-slate-50 text-slate-600 ring-slate-200"
                                        )}>{g}</span>
                                    ))}
                                </span>
                            )}
                            {row.default_input_roll_width_mm && <span>Roll W: {row.default_input_roll_width_mm} mm</span>}
                        </div>
                    </div>
                </div>
            ))}
            <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-4 py-2">
                <Layers className="h-4 w-4 text-slate-400" />
                <span className="text-xs font-bold text-slate-600">Total default thickness:</span>
                <span className="text-sm font-black text-slate-900">{total} μ</span>
            </div>
        </div>
    )
}

function VariantAxisChips({ axes }: { axes: any[] }) {
    if (!axes.length) return <p className="text-sm text-slate-500">No axes defined. Click Edit to configure variant dimensions.</p>
    return (
        <div className="space-y-3">
            <div className="flex items-center gap-3 text-xs text-slate-500">
                <span className="font-semibold text-slate-700">{axes.length} axes configured</span>
                <span>·</span>
                <span>{axes.filter(isUiRequiredAxis).length} required</span>
                <span>·</span>
                <span>{axes.filter((a) => !isUiRequiredAxis(a)).length} optional/auto</span>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {axes.map((a) => {
                    const isRollWidthAxis = String(a.axis) === "layer_widths"
                    const requiredForUi = isUiRequiredAxis(a)
                    const pal = requiredForUi
                        ? { border: "border-blue-200", bg: "bg-gradient-to-br from-blue-50/80 to-white", ring: "ring-blue-100", icon: "bg-blue-100 text-blue-700 ring-blue-200" }
                        : { border: "border-violet-100", bg: "bg-gradient-to-br from-violet-50/50 to-white", ring: "ring-violet-50", icon: "bg-violet-50 text-violet-600 ring-violet-200" }
                    const label = isRollWidthAxis ? "Roll width override" : a.label || a.axis
                    const type = isRollWidthAxis ? "variant number, auto from size" : String(a.type || "").replaceAll("_", " ")
                    return (
                        <div key={a.axis} className={cn("rounded-xl border px-4 py-3", pal.border, pal.bg, "ring-1", pal.ring)}>
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2.5">
                                    <span className={cn("flex h-7 w-7 items-center justify-center rounded-lg text-xs ring-1", pal.icon)}>
                                        {a.axis === "size" ? <Layers className="h-3 w-3" /> :
                                         a.axis === "addons" ? <Sparkles className="h-3 w-3" /> :
                                         a.axis === "packaging" ? <Package className="h-3 w-3" /> :
                                         a.axis === "artwork_mode" ? <Palette className="h-3 w-3" /> :
                                         <Workflow className="h-3 w-3" />}
                                    </span>
                                    <div>
                                        <div className="text-sm font-bold text-slate-900">{label}</div>
                                        <div className="text-[10px] text-slate-500">{type}</div>
                                    </div>
                                </div>
                                <span className={cn("rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ring-1 ring-inset",
                                    requiredForUi ? "bg-blue-600 text-white ring-blue-700" : "bg-violet-100 text-violet-700 ring-violet-200"
                                )}>{isRollWidthAxis ? "Auto fallback" : requiredForUi ? "Required" : "Optional"}</span>
                            </div>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}

function PrintContractView({ attrs }: { attrs: Record<string, any> }) {
    if (!attrs?.print_capable) {
        return (
            <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/40 px-4 py-3 text-sm text-slate-500">
                <Palette className="h-4 w-4" /> Print not enabled for this master.
            </div>
        )
    }
    return (
        <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <ReadField label="Print capable" value="Yes" tone="ok" />
                <ReadField label="Artwork required" value={attrs.artwork_required ? "Yes" : "No"} tone={attrs.artwork_required ? "ok" : "warn"} />
                <ReadField label="Artwork source" value="Approved artwork pool" />
            </div>
            <CylinderRuleCard />
        </div>
    )
}

function CylinderRuleCard() {
    return (
        <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">
            <Disc className="mt-0.5 h-4 w-4 flex-none" />
            <span><strong>Artwork-driven:</strong> actual artwork/colorway carries method, sheet/tubing form, colors, ink mapping, and cylinder gate. Product Master only decides if printing is allowed and whether artwork is mandatory.</span>
        </div>
    )
}

function PackagingView({ attrs, catalogAxes = [] }: { attrs: Record<string, any>; catalogAxes?: VariantAxisDef[] }) {
    const lines = attrs?.packaging_lines || []
    const podEnabled = !!attrs?.pod_enabled
    const packagingCatalogAxes = catalogAxes.filter((axis) =>
        ["pod_variant", "packaging_inner", "packaging_outer"].includes(String(axis.axis))
    )
    return (
        <div className="space-y-3">
            {packagingCatalogAxes.length > 0 && (
                <div className="grid gap-2 sm:grid-cols-3">
                    {packagingCatalogAxes.map((axis) => (
                        <div key={String(axis.axis)} className="rounded-xl border border-emerald-200 bg-emerald-50/60 px-3 py-2.5 ring-1 ring-emerald-100">
                            <div className="text-[9px] font-black uppercase tracking-[0.18em] text-emerald-700">
                                {axis.master_data_source === "pod_sku_variant" ? "POD catalog" : "Packaging catalog"}
                            </div>
                            <div className="mt-1 text-sm font-bold text-slate-900">{axis.label || String(axis.axis).replace(/_/g, " ")}</div>
                            <div className="mt-1 text-[11px] text-slate-600">
                                {axis.qty_formula || (axis.qty_per_pcs === 0 ? "Counted at packing yard" : `${axis.qty_per_pcs ?? 1} x pouch qty`)}
                            </div>
                            {axis.auto_demand_in_house && (
                                <span className="mt-2 inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-800 ring-1 ring-emerald-200">
                                    auto-demand
                                </span>
                            )}
                        </div>
                    ))}
                </div>
            )}
            {lines.length === 0 && !podEnabled && packagingCatalogAxes.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/40 p-6 text-center text-sm text-slate-500">
                    <Package className="mx-auto h-5 w-5 text-slate-400" />
                    <div className="mt-2">No packaging or POD axes configured yet. Add catalog-backed axes for inner pack, outer pack, or POD.</div>
                </div>
            ) : (
                <>
                    {lines.map((line: any, i: number) => (
                        <div key={i} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3">
                            <div className="flex items-center gap-3">
                                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-200">{line.role}</span>
                                <span className="text-sm font-semibold text-slate-800">{line.material_code}</span>
                            </div>
                            <div className="text-xs text-slate-500">
                                {line.role === "PRIMARY_INNER"
                                    ? `${line.pcs_per_pack || "set"} pcs / inner`
                                    : packagingRuleForRole(line.role).label}
                            </div>
                        </div>
                    ))}
                    {podEnabled && (
                        <div className="flex items-center gap-3 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3">
                            <Disc className="h-4 w-4 text-violet-600" />
                            <span className="text-sm font-semibold text-violet-800">POD enabled</span>
                            <span className="text-xs text-violet-600">{attrs.pod_variant_code || attrs.pod_profile || "Select POD variant"}</span>
                        </div>
                    )}
                </>
            )}
        </div>
    )
}

function PackagingEditor({ attrs, productKind, onPatch }: { attrs: Record<string, any>; productKind?: ProductKind | string; onPatch: (patch: Record<string, any>) => void }) {
    const lines: any[] = attrs.packaging_lines || []
    const { data: packagingMaterials = [] } = useQuery({
        queryKey: ["master-packaging-materials"],
        queryFn: masterDataService.getPackaging,
        staleTime: 60_000,
    })
    const { data: podVariants = [] } = useQuery({
        queryKey: ["master-pod-sku-variants", "active"],
        queryFn: () => masterDataService.getPodSkuVariants({ active: true }),
        staleTime: 60_000,
    })

    function addLine() {
        const role = packagingRolesForProduct(productKind)[0]
        const material = packagingMaterials.find((m: PackagingMaterial) => packagingMaterialAllowed(m, role, productKind)) || null
        onPatch({
            packaging_lines: [
                ...lines,
                normalizePackagingLine({
                    role,
                    material: material?.id || null,
                    material_code: material?.code || "",
                    uom: material?.base_uom || "PCS",
                }, role, material),
            ],
        })
    }
    function removeLine(i: number) {
        onPatch({ packaging_lines: lines.filter((_, idx) => idx !== i) })
    }
    function patchLine(i: number, patch: Record<string, any>) {
        const next = [...lines]
        next[i] = { ...next[i], ...patch }
        onPatch({ packaging_lines: next })
    }

    return (
        <div className="space-y-3">
            {lines.map((line, i) => (
                <div key={i} className="rounded-xl border border-slate-200 bg-white p-3">
                    <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-700">Line {i + 1}</span>
                        <button type="button" onClick={() => removeLine(i)} className="rounded-md p-1 text-rose-600 hover:bg-rose-50">
                            <Trash2 className="h-3.5 w-3.5" />
                        </button>
                    </div>
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                        <EditField label="Role">
                            <Select value={canonicalPackagingRole(line.role)} onValueChange={(v) => patchLine(i, normalizePackagingLine(line, v))}>
                                <SelectTrigger className="h-8 rounded-lg text-xs"><SelectValue /></SelectTrigger>
                                <SelectContent>{packagingRolesForProduct(productKind).map((r) => <SelectItem key={r} value={r}>{PACKAGING_ROLE_RULES[r].menuLabel}</SelectItem>)}</SelectContent>
                            </Select>
                        </EditField>
                        <EditField label="Allowed SKU">
                            {packagingMaterials.length ? (
                                <Select
                                    value={line.material || line.material_code || ""}
                                    onValueChange={(v) => {
                                        const picked = packagingMaterials.find((m: PackagingMaterial) => m.id === v || m.code === v)
                                        patchLine(i, normalizePackagingLine({
                                            ...line,
                                            material: picked?.id || null,
                                            material_code: (picked?.code || v).toUpperCase(),
                                            uom: picked?.base_uom || line.uom || "PCS",
                                            supply_mode: picked?.packaging_supply_mode,
                                            kind: picked?.packaging_kind,
                                        }, line.role, picked))
                                    }}
                                >
                                    <SelectTrigger className="h-8 rounded-lg text-xs"><SelectValue placeholder="Select packaging SKU" /></SelectTrigger>
                                    <SelectContent>
                                        {packagingMaterials
                                            .filter((m: PackagingMaterial) => packagingMaterialAllowed(m, line.role, productKind))
                                            .map((m: PackagingMaterial) => (
                                            <SelectItem key={m.id || m.code} value={m.id || m.code}>
                                                {m.code} · {m.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            ) : (
                                <Input className="h-8 rounded-lg text-xs" value={line.material_code} onChange={(e) => patchLine(i, { material_code: e.target.value.toUpperCase() })} />
                            )}
                        </EditField>
                        <EditField label={canonicalPackagingRole(line.role) === "PRIMARY_INNER" ? "Pcs per inner" : "Consumption"}>
                            {canonicalPackagingRole(line.role) === "PRIMARY_INNER" ? (
                                <Input
                                    type="number"
                                    min="1"
                                    className="h-8 rounded-lg text-xs"
                                    value={line.pcs_per_pack || ""}
                                    placeholder="e.g. 100"
                                    onChange={(e) => patchLine(i, normalizePackagingLine({ ...line, pcs_per_pack: Number(e.target.value) }, "PRIMARY_INNER"))}
                                />
                            ) : (
                                <div className="flex h-8 items-center rounded-lg border border-slate-200 bg-slate-50 px-2 text-[11px] font-bold text-slate-600">
                                    {packagingRuleForRole(line.role).label}
                                </div>
                            )}
                        </EditField>
                        <EditField label="Rule">
                            <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-2 py-1.5 text-[11px] font-semibold leading-4 text-emerald-800">
                                {packagingRuleForRole(line.role).hint}
                            </div>
                        </EditField>
                    </div>
                </div>
            ))}
            <Button size="sm" variant="outline" className="gap-1 rounded-full text-xs" onClick={addLine}>
                <Plus className="h-3 w-3" /> Add packaging line
            </Button>

            <div className="mt-3 space-y-3 rounded-xl border border-violet-200 bg-violet-50/50 p-3">
                <ToggleRow label="POD enabled" description="POD roll/material linked to this master." checked={!!attrs.pod_enabled} onChange={(v) => onPatch({ pod_enabled: v })} />
                {attrs.pod_enabled && (
                    <EditField label="POD variant">
                        {podVariants.length ? (
                            <Select
                                value={attrs.pod_variant || attrs.pod_variant_code || ""}
                                onValueChange={(v) => {
                                    const picked = podVariants.find((p: PodSkuVariant) => p.id === v || p.code === v)
                                    onPatch({
                                        pod_variant: picked?.id || null,
                                        pod_variant_code: picked?.code || v,
                                        pod_material: picked?.material || null,
                                        pod_material_code: picked?.material_code,
                                        pod_profile: picked?.name || picked?.code || v,
                                    })
                                }}
                            >
                                <SelectTrigger className="h-8 rounded-lg text-xs"><SelectValue placeholder="Select POD SKU variant" /></SelectTrigger>
                                <SelectContent>
                                    {podVariants.map((p: PodSkuVariant) => (
                                        <SelectItem key={p.id || p.code} value={p.id || p.code}>
                                            {p.code} · {p.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        ) : (
                            <Input className="h-8 rounded-lg text-xs" placeholder="POD profile or variant" value={attrs.pod_profile || ""} onChange={(e) => onPatch({ pod_profile: e.target.value })} />
                        )}
                    </EditField>
                )}
            </div>
        </div>
    )
}

const AXIS_PALETTE: Record<string, { bg: string; text: string; ring: string }> = {
    size: { bg: "bg-emerald-50", text: "text-emerald-800", ring: "ring-emerald-200" },
    layer_thicknesses: { bg: "bg-blue-50", text: "text-blue-800", ring: "ring-blue-200" },
    layer_grades: { bg: "bg-violet-50", text: "text-violet-800", ring: "ring-violet-200" },
    layer_widths: { bg: "bg-sky-50", text: "text-sky-800", ring: "ring-sky-200" },
    addons: { bg: "bg-amber-50", text: "text-amber-800", ring: "ring-amber-200" },
    packaging: { bg: "bg-teal-50", text: "text-teal-800", ring: "ring-teal-200" },
    pod: { bg: "bg-fuchsia-50", text: "text-fuchsia-800", ring: "ring-fuchsia-200" },
    artwork_mode: { bg: "bg-rose-50", text: "text-rose-800", ring: "ring-rose-200" },
}

function VariantTable({ rows, axes }: { rows: any[]; axes: VariantAxisDef[] }) {
    if (!rows.length) {
        return (
            <div className="space-y-4">
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/40 p-8 text-center">
                    <Database className="mx-auto h-8 w-8 text-slate-300" />
                    <div className="mt-3 text-sm font-semibold text-slate-700">No variants yet</div>
                    <div className="mt-1 text-xs text-slate-500">Variants are auto-created when sales or planner uses this master with a unique axis combination.</div>
                </div>
                {axes.length > 0 && (
                    <div className="rounded-xl border border-blue-100 bg-blue-50/40 px-4 py-3">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-blue-500">Active axes that will drive variant creation</div>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                            {axes.map((a) => {
                                const p = AXIS_PALETTE[a.axis] || AXIS_PALETTE.size
                                return (
                                    <span key={a.axis} className={cn("rounded-full px-2.5 py-1 text-[10px] font-bold ring-1 ring-inset", p.bg, p.text, p.ring)}>
                                        {a.label || a.axis} {a.required ? "★" : ""}
                                    </span>
                                )
                            })}
                        </div>
                    </div>
                )}
            </div>
        )
    }
    return (
        <div className="max-h-[36rem] space-y-2 overflow-y-auto">
            {rows.map((v, vi) => {
                const axisEntries = Object.entries(v.axis_values || {}).filter(([, vv]) => !isAxisValueEmpty(vv))
                return (
                    <div key={v.id} className={cn("rounded-xl border bg-white transition-all hover:shadow-sm",
                        v.active ? "border-slate-200" : "border-rose-200 bg-rose-50/20"
                    )}>
                        <div className="flex items-center justify-between px-4 py-3">
                            <div className="flex items-center gap-3">
                                <div className={cn("flex h-9 w-9 flex-none items-center justify-center rounded-lg text-xs font-black ring-1",
                                    v.active ? "bg-blue-50 text-blue-700 ring-blue-100" : "bg-rose-50 text-rose-700 ring-rose-100"
                                )}>V{vi + 1}</div>
                                <div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm font-bold text-slate-900">{v.code}</span>
                                        <span className={cn("rounded-full px-2 py-0.5 text-[9px] font-bold uppercase ring-1 ring-inset",
                                            v.active ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-rose-50 text-rose-700 ring-rose-200"
                                        )}>{v.active ? "Active" : "Inactive"}</span>
                                    </div>
                                    {v.invariant_signature && (
                                        <div className="mt-0.5 font-mono text-[10px] text-slate-400">{v.invariant_signature}</div>
                                    )}
                                </div>
                            </div>
                            <div className="text-right text-[10px] text-slate-400">
                                {v.used_count ? `${v.used_count} orders` : "Unused"}
                            </div>
                        </div>
                        {axisEntries.length > 0 && (
                            <div className="border-t border-slate-100 px-4 py-2.5">
                                <div className="flex flex-wrap gap-1.5">
                                    {axisEntries.map(([k, vv]) => {
                                        const p = AXIS_PALETTE[k] || { bg: "bg-slate-50", text: "text-slate-700", ring: "ring-slate-200" }
                                        const display = formatAxisValue(k, vv)
                                        return (
                                            <span key={k} className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold ring-1 ring-inset", p.bg, p.text, p.ring)}>
                                                <span className="font-bold opacity-60">{formatAxisLabel(k)}:</span>
                                                {display}
                                            </span>
                                        )
                                    })}
                                </div>
                            </div>
                        )}
                        <VariantLayerMicroBar layers={v.layer_snapshot} />
                        <VariantStatsRow variant={v} />
                    </div>
                )
            })}
        </div>
    )
}

function VariantLayerMicroBar({ layers }: { layers?: any[] }) {
    if (!Array.isArray(layers) || layers.length === 0) return null
    const total = layers.reduce((s, l) => s + Math.max(Number(l?.thickness_micron || 0), 0), 0)
    if (total <= 0) return null
    const FILM_COLOR: Record<string, string> = {
        PET: "bg-blue-500", BOPP: "bg-blue-400", BOPA: "bg-violet-500", BOPE: "bg-indigo-500",
        LD: "bg-emerald-500", LDPE: "bg-emerald-500", HDPE: "bg-teal-500", PE: "bg-emerald-400",
        PP: "bg-cyan-500", MET: "bg-slate-500", NYL: "bg-violet-500", NYLON: "bg-violet-500",
        ALU: "bg-slate-400", PAPER: "bg-amber-400",
    }
    const colorOf = (code: string): string => {
        const upper = String(code || "").toUpperCase()
        const found = Object.keys(FILM_COLOR).find((k) => upper.startsWith(k))
        return found ? FILM_COLOR[found] : "bg-slate-300"
    }
    return (
        <div className="border-t border-slate-100 px-4 py-2">
            <div className="flex items-center justify-between text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                <span>Layer stack</span>
                <span className="font-mono">{total} μ total</span>
            </div>
            <div className="flex h-2 w-full overflow-hidden rounded-full ring-1 ring-slate-200">
                {layers.map((l: any, i: number) => {
                    const t = Math.max(Number(l?.thickness_micron || 0), 0)
                    if (t <= 0) return null
                    const pct = (t / total) * 100
                    return <div key={i} className={cn("h-full", colorOf(l.film_variant_code))} style={{ width: `${pct}%` }} title={`${l.film_variant_code || "—"} · ${t}μ${l.grade ? ` · ${l.grade}` : ""}`} />
                })}
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
                {layers.map((l: any, i: number) => (
                    <span key={i} className="inline-flex items-center gap-1 rounded bg-slate-50 px-1.5 py-0.5 text-[9px] font-mono font-bold text-slate-700 ring-1 ring-slate-200">
                        <span className={cn("inline-block h-1.5 w-1.5 rounded-sm", colorOf(l.film_variant_code))} />
                        {l.film_variant_code || "—"} · {Number(l?.thickness_micron || 0)}μ
                    </span>
                ))}
            </div>
        </div>
    )
}

function VariantStatsRow({ variant }: { variant: any }) {
    const g = variant?.geometry_snapshot || {}
    const stats: Array<{ k: string; v: string }> = []
    if (g.width_mm || g.height_mm) stats.push({ k: "Size", v: `${g.width_mm || "—"}×${g.height_mm || "—"} mm` })
    if (g.roll_width_mm) stats.push({ k: "Roll W", v: `${g.roll_width_mm} mm` })
    if (g.thickness_um) stats.push({ k: "Thickness", v: `${g.thickness_um} μ` })
    if (g.unit_weight_g != null || variant.unit_weight_g != null) stats.push({ k: "Unit wt", v: `${g.unit_weight_g ?? variant.unit_weight_g} g` })
    if (g.faces) stats.push({ k: "Faces", v: `${g.faces}` })
    if (stats.length === 0) return null
    return (
        <div className="border-t border-slate-100 px-4 py-2 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
            {stats.map((s) => (
                <div key={s.k} className="rounded-md bg-slate-50 px-2 py-1 ring-1 ring-slate-100">
                    <div className="text-[9px] font-black uppercase tracking-wider text-slate-500">{s.k}</div>
                    <div className="font-mono text-[11px] font-bold text-slate-800 tabular-nums">{s.v}</div>
                </div>
            ))}
        </div>
    )
}

function formatAxisLabel(key: string) {
    const map: Record<string, string> = {
        size: "final size",
        layer_thicknesses: "thickness",
        layer_grades: "grade",
        layer_widths: "roll width",
        packaging_inner: "inner pack",
        packaging_outer: "outer pack",
        pod_variant: "POD",
        artwork_mode: "artwork",
    }
    return map[key] || key.replace(/_/g, " ")
}

function formatAxisValue(key: string, value: any) {
    if (Array.isArray(value)) return value.join(" · ") || "—"
    if (value && typeof value === "object") {
        const entries = Object.entries(value).filter(([, v]) => !isAxisValueEmpty(v))
        if (key === "layer_thicknesses") return entries.map(([k, v]) => `L${k} ${v}μ`).join(" · ")
        if (key === "layer_widths") return entries.map(([k, v]) => `L${k} ${v} mm`).join(" · ")
        if (key === "layer_grades") return entries.map(([k, v]) => `L${k} ${String(v)}`).join(" · ")
        return entries.map(([k, v]) => `${k.replace(/_/g, " ")} ${String(v)}`).join(" · ")
    }
    return String(value || "—")
}

function OverlayTable({ rows }: { rows: any[] }) {
    if (!rows.length) {
        return (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/40 p-6 text-center text-sm text-slate-500">
                No overlays yet. Add a customer overlay to surface item code, packing and price basis.
            </div>
        )
    }
    return (
        <div className="space-y-2">
            {rows.map((o) => (
                <div key={o.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-[10px] font-black text-blue-700">
                                {(o.customer_name || "C")[0]}
                            </div>
                            <div>
                                <div className="text-sm font-bold text-slate-800">{o.customer_name || o.customer}</div>
                                <div className="text-[11px] text-blue-700">{o.customer_item_code}</div>
                            </div>
                        </div>
                        <div className="text-right text-[11px] text-slate-500">
                            <div>{o.default_price_basis || "—"} pricing</div>
                            {o.moq_kg ? <div>MOQ: {o.moq_kg} kg</div> : null}
                        </div>
                    </div>
                    {o.customer_display_name && <div className="mt-1 text-xs text-slate-600">{o.customer_display_name}</div>}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-slate-50 px-2 py-0.5 text-[10px] text-slate-600 ring-1 ring-slate-200">
                            {o.axis_values && Object.keys(o.axis_values).length
                                ? Object.entries(o.axis_values)
                                      .filter(([, v]) => !isAxisValueEmpty(v))
                                      .map(([k, v]) => `${formatAxisLabel(k)}: ${formatAxisValue(k, v)}`)
                                      .join(" · ")
                                : "Generic"}
                        </span>
                        {o.default_packing_recipe?.packaging_lines?.length ? (
                            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-100">
                                {o.default_packing_recipe.packaging_lines.length} BOM packing line(s)
                            </span>
                        ) : null}
                    </div>
                </div>
            ))}
        </div>
    )
}

/**
 * V3.6 Product Spec Card — prominent visual + spec table answering "what is this product?"
 * Sits at the top of the detail page, above Setup Workbench. Read-only.
 */
function ProductSpecCard(props: {
    code: string
    name: string
    kind: string
    style: string
    printType?: string
    printCapable: boolean
    layers: any[]
    sizes: any[]
    axes: any[]
    variantsCount: number
    overlaysCount: number
    description?: string
    invariant?: string
    active: boolean
}) {
    const { code, name, kind, style, printType, printCapable, layers, sizes, axes, variantsCount, overlaysCount, description, invariant, active } = props
    const totalThickness = layers.reduce((s: number, l: any) => s + (Number(l.thickness_micron) || 0), 0)
    const hasLayerThicknessAxis = axes.some((axis: any) =>
        ["layer_thicknesses", "layer_thickness", "thickness_by_layer", "per_layer_thickness"].includes(String(axis.axis || ""))
    )
    const thicknessLabel = hasLayerThicknessAxis ? "Variable" : `${totalThickness} μ`
    const catalogAxes = axes.filter((a: any) => a.master_data_source).length
    const sellableSizes = sizes.filter((s: any) => s.active).length
    const firstSize = sizes.find((s: any) => s.active) || sizes[0]
    const rollWidth = firstSize?.roll_width_mm || layers[0]?.default_input_roll_width_mm || (firstSize ? autoRollWidthMm(firstSize, kind) : 0)
    const accent = kind === "POUCH" ? "violet" : kind === "ROLL" ? "emerald" : kind === "POD" ? "fuchsia" : "blue"
    const ACCENT: Record<string, { ring: string; iconBg: string; gradient: string; bar: string }> = {
        violet:  { ring: "ring-violet-100",  iconBg: "bg-violet-100 text-violet-700",   gradient: "from-blue-50/60 via-white to-violet-50/40",  bar: "border-l-violet-500" },
        emerald: { ring: "ring-emerald-100", iconBg: "bg-emerald-100 text-emerald-700", gradient: "from-emerald-50/60 via-white to-blue-50/40", bar: "border-l-emerald-500" },
        fuchsia: { ring: "ring-fuchsia-100", iconBg: "bg-fuchsia-100 text-fuchsia-700", gradient: "from-fuchsia-50/60 via-white to-violet-50/40", bar: "border-l-fuchsia-500" },
        blue:    { ring: "ring-blue-100",    iconBg: "bg-blue-100 text-blue-700",       gradient: "from-blue-50/60 via-white to-emerald-50/40", bar: "border-l-blue-500" },
    }
    const a = ACCENT[accent]
    return (
        <section className={cn("overflow-hidden rounded-3xl border bg-gradient-to-br shadow-md ring-1 border-slate-200/60 border-l-[3px]", a.gradient, a.ring, a.bar)}>
            <div className="grid grid-cols-1 gap-0 lg:grid-cols-[260px_minmax(0,1fr)]">
                {/* LEFT: visual silhouette */}
                <div className="border-b border-slate-200/60 bg-white/60 p-5 flex flex-col items-center justify-center lg:border-b-0 lg:border-r">
                    <ProductSilhouette kind={kind} firstSize={firstSize} layers={layers} active={active} />
                    {sizes.length > 0 && (
                        <div className="mt-3 flex flex-wrap justify-center gap-1">
                            {sizes.slice(0, 4).map((s: any, i: number) => (
                                <span key={s.id || i} className={cn(
                                    "rounded-md px-2 py-0.5 text-[10px] font-bold ring-1",
                                    s.active ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-slate-100 text-slate-500 ring-slate-200"
                                )}>{s.code}</span>
                            ))}
                            {sizes.length > 4 && (
                                <span className="text-[10px] text-slate-400 self-center">+{sizes.length - 4}</span>
                            )}
                        </div>
                    )}
                </div>

                {/* RIGHT: spec table */}
                <div className="p-5">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div>
                            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Product spec · what is this?</div>
                            <div className="font-display mt-1 text-2xl font-bold text-slate-900">{name}</div>
                            <div className="mt-0.5 mono text-xs font-bold text-blue-700">{code}</div>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                            {active ? (
                                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-emerald-800 ring-1 ring-emerald-200">● Active</span>
                            ) : (
                                <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-rose-800 ring-1 ring-rose-200">● Inactive</span>
                            )}
                            {invariant && <span className="text-[10px] mono text-slate-400">{invariant}</span>}
                        </div>
                    </div>

                    {/* Spec grid */}
                    <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                        <SpecCell label="Kind" value={kind} />
                        <SpecCell label="Style" value={style || "—"} />
                        <SpecCell label="Print" value={printCapable ? `${printType || "Artwork-driven"}` : "—"} tone="fuchsia" />
                        <SpecCell label="Total layers" value={String(layers.length)} />
                        <SpecCell label="Total thickness" value={thicknessLabel} />
                        <SpecCell label="Active sizes" value={`${sellableSizes} / ${sizes.length || 0}`} tone="emerald" />
                        <SpecCell label="Roll fallback" value={rollWidth ? `${rollWidth} mm` : "—"} />
                        <SpecCell label="Variant axes" value={`${axes.length}${catalogAxes ? ` (${catalogAxes} catalog)` : ""}`} tone="violet" />
                        <SpecCell label="Variants used" value={`${variantsCount}`} tone="blue" />
                        <SpecCell label="Customer overlays" value={`${overlaysCount}`} tone="amber" />
                    </div>

                    {/* Layer summary chips */}
                    {layers.length > 0 && (
                        <div className="mt-4">
                            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Layer stack (top → bottom)</div>
                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                {layers.map((l: any, i: number) => {
                                    const tone = i === 0 ? "sky" : i === layers.length - 1 ? "emerald" : "slate"
                                    const TONE_CLS: Record<string, string> = {
                                        sky: "bg-sky-50 text-sky-800 ring-sky-200",
                                        emerald: "bg-emerald-50 text-emerald-800 ring-emerald-200",
                                        slate: "bg-slate-50 text-slate-800 ring-slate-200",
                                    }
                                    return (
                                        <React.Fragment key={i}>
                                            <span className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-bold ring-1 ring-inset", TONE_CLS[tone])}>
                                                <span className="mono">L{i + 1}</span> {l.film_variant_code} · {Number(l.thickness_micron || 0) > 0 ? `${l.thickness_micron}μ` : "variable"}
                                            </span>
                                            {i < layers.length - 1 && <span className="text-slate-300">+</span>}
                                        </React.Fragment>
                                    )
                                })}
                            </div>
                        </div>
                    )}

                    {/* Description */}
                    {description && (
                        <p className="mt-4 rounded-xl bg-white/80 px-3 py-2 text-xs leading-relaxed text-slate-700 ring-1 ring-slate-200">
                            {description}
                        </p>
                    )}
                </div>
            </div>
        </section>
    )
}

function SpecCell({ label, value, tone }: { label: string; value: string; tone?: "emerald" | "violet" | "amber" | "fuchsia" | "blue" }) {
    const TONE: Record<string, string> = {
        emerald: "border-emerald-200 bg-emerald-50/40",
        violet: "border-violet-200 bg-violet-50/40",
        amber: "border-amber-200 bg-amber-50/40",
        fuchsia: "border-fuchsia-200 bg-fuchsia-50/40",
        blue: "border-blue-200 bg-blue-50/40",
    }
    return (
        <div className={cn("rounded-xl border bg-white px-3 py-2", tone ? TONE[tone] : "border-slate-200")}>
            <div className="text-[9px] font-black uppercase tracking-wider text-slate-500">{label}</div>
            <div className="mt-0.5 text-sm font-bold text-slate-900">{value}</div>
        </div>
    )
}

/**
 * Tiny pouch / roll silhouette for the Spec Card. Pure SVG, no external deps.
 */
function ProductSilhouette({ kind, firstSize, layers, active }: { kind: string; firstSize: any; layers: any[]; active: boolean }) {
    const accent = kind === "POUCH" ? "#a78bfa" : kind === "ROLL" ? "#34d399" : kind === "POD" ? "#e879f9" : "#60a5fa"
    const totalLayerThickness = layers.reduce((s, l) => s + (Number(l.thickness_micron) || 0), 0)
    const layerThicknessLabel = totalLayerThickness > 0 ? `${totalLayerThickness}μ` : "variable"
    if (kind === "ROLL") {
        return (
            <svg width="160" height="180" viewBox="0 0 200 220">
                <defs>
                    <linearGradient id="rollg" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#dbeafe"/>
                        <stop offset="50%" stopColor="#e0e7ff"/>
                        <stop offset="100%" stopColor="#ede9fe"/>
                    </linearGradient>
                </defs>
                <ellipse cx="100" cy="50" rx="70" ry="20" fill="#cbd5e1" opacity="0.5"/>
                <rect x="30" y="50" width="140" height="120" fill="url(#rollg)" stroke={accent} strokeOpacity="0.5" strokeWidth="1.5"/>
                <ellipse cx="100" cy="170" rx="70" ry="20" fill="url(#rollg)" stroke={accent} strokeOpacity="0.5" strokeWidth="1.5"/>
                <ellipse cx="100" cy="50" rx="70" ry="20" fill="white" opacity="0.95" stroke={accent} strokeOpacity="0.5" strokeWidth="1.5"/>
                <text x="100" y="55" textAnchor="middle" fontFamily="Inter" fontSize="10" fill="#6366f1" fontWeight="700">{firstSize?.roll_width_mm || layers[0]?.default_input_roll_width_mm || (firstSize ? autoRollWidthMm(firstSize, kind) : 1050)} mm</text>
                <text x="100" y="200" textAnchor="middle" fontFamily="JetBrains Mono" fontSize="9" fill="#475569" fontWeight="700">{layers.length}-layer · {layerThicknessLabel}</text>
            </svg>
        )
    }
    if (kind === "POD") {
        return (
            <svg width="160" height="180" viewBox="0 0 200 220">
                <defs>
                    <linearGradient id="podg" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#fae8ff"/>
                        <stop offset="100%" stopColor="#ede9fe"/>
                    </linearGradient>
                </defs>
                <rect x="40" y="30" width="120" height="160" rx="6" fill="url(#podg)" stroke={accent} strokeOpacity="0.5" strokeWidth="1.5"/>
                <text x="100" y="105" textAnchor="middle" fontFamily="Plus Jakarta Sans" fontSize="14" fill="#a21caf" fontWeight="800">POD</text>
                <text x="100" y="125" textAnchor="middle" fontFamily="Inter" fontSize="9" fill="#7c3aed" fontWeight="600">sleeve · {Number(layers[0]?.thickness_micron || 0) > 0 ? `${layers[0].thickness_micron}μ` : "variable"}</text>
                <text x="100" y="205" textAnchor="middle" fontFamily="JetBrains Mono" fontSize="9" fill="#475569" fontWeight="700">recipe-driven</text>
            </svg>
        )
    }
    // Default: pouch silhouette
    return (
        <svg width="160" height="200" viewBox="0 0 180 220">
            <defs>
                <linearGradient id={`pouchg-${kind}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#dbeafe"/>
                    <stop offset="50%" stopColor="#e0e7ff"/>
                    <stop offset="100%" stopColor="#ede9fe"/>
                </linearGradient>
            </defs>
            <rect x="20" y="10" width="140" height="14" rx="3" fill="#94a3b8" opacity="0.4"/>
            <path d="M 24 24 L 24 195 Q 24 210 36 210 L 144 210 Q 156 210 156 195 L 156 24 Z" fill={`url(#pouchg-${kind})`} stroke={accent} strokeWidth="1.5" strokeOpacity="0.5"/>
            <line x1="36" y1="24" x2="36" y2="210" stroke="#94a3b8" strokeWidth="0.5" strokeDasharray="2 3" opacity="0.5"/>
            <line x1="144" y1="24" x2="144" y2="210" stroke="#94a3b8" strokeWidth="0.5" strokeDasharray="2 3" opacity="0.5"/>
            <rect x="50" y="60" width="80" height="100" rx="4" fill="white" opacity="0.7" stroke={accent} strokeWidth="0.5"/>
            <text x="90" y="100" textAnchor="middle" fontFamily="Plus Jakarta Sans" fontSize="13" fill="#7c3aed" fontWeight="800">{kind}</text>
            <text x="90" y="118" textAnchor="middle" fontFamily="Inter" fontSize="9" fill="#6366f1" fontWeight="600">{layers.length}-layer · {layerThicknessLabel}</text>
            <text x="90" y="135" textAnchor="middle" fontFamily="Inter" fontSize="8" fill="#64748b">{firstSize?.code || ""}</text>
            {firstSize && (
                <text x="90" y="225" textAnchor="middle" fontFamily="JetBrains Mono" fontSize="9" fill="#475569" fontWeight="700">{firstSize.width_mm} × {firstSize.height_mm} mm</text>
            )}
            {!active && (
                <text x="90" y="165" textAnchor="middle" fontFamily="Inter" fontSize="9" fill="#dc2626" fontWeight="700">INACTIVE</text>
            )}
        </svg>
    )
}

/**
 * V3.3 catalog-backed axes view.
 * Each axis surfaces its master-data source, qty formula, and a live preview of catalog options
 * so the user understands what sales will actually pick from at order time.
 */
function CatalogAxesView({ axes }: { axes: VariantAxisDef[] }) {
    return (
        <div className="space-y-3">
            {axes.map((def) => (
                <CatalogAxisCard key={String(def.axis)} def={def} />
            ))}
        </div>
    )
}

function CatalogAxisCard({ def }: { def: VariantAxisDef }) {
    const source = def.master_data_source as AxisCatalogSource
    const filter = def.master_data_filter || {}
    const allowedCodes = axisOptionCodes(def)
    const allowedKey = allowedCodes ? Array.from(allowedCodes).sort().join("|") : "all"
    const queryKey = ["catalog-axis-options", source, filter, allowedKey]
    const { data: options = [], isLoading } = useQuery({
        queryKey,
        queryFn: async () => {
            if (source === "pod_sku_variant") {
                const list = await masterDataService.getPodSkuVariants({ active: true })
                return list
                    .filter((p) => !allowedCodes || allowedCodes.has(String(p.code || "").trim().toUpperCase()))
                    .map((p) => ({ id: p.id, code: p.code, name: p.name, sub: [p.pod_thickness_micron ? `${p.pod_thickness_micron}μ` : null, p.pod_fixed_height_mm ? `${p.pod_fixed_height_mm}mm` : null].filter(Boolean).join(" · ") }))
            }
            if (source === "packaging_material") {
                const list = await masterDataService.getPackaging()
                let rows = list.filter((p) => p.status === "ACTIVE")
                if (filter.packaging_kind) {
                    const kinds = Array.isArray(filter.packaging_kind)
                        ? filter.packaging_kind.map((kind: unknown) => String(kind || "").toUpperCase()).filter(Boolean)
                        : [String(filter.packaging_kind || "").toUpperCase()]
                    rows = rows.filter((p: PackagingMaterial) => kinds.includes(String(p.packaging_kind || "").toUpperCase()))
                }
                if (allowedCodes) rows = rows.filter((p: PackagingMaterial) => allowedCodes.has(String(p.code || "").trim().toUpperCase()))
                return rows.map((p) => ({ id: p.id, code: p.code, name: p.name, sub: [p.packaging_kind, p.base_uom].filter(Boolean).join(" · ") }))
            }
            if (source === "addon") {
                const list = await masterDataService.getAddons()
                return list
                    .filter((addon: Addon) => addon.status !== "INACTIVE")
                    .filter((addon: Addon) => !allowedCodes || allowedCodes.has(String(addon.code || "").trim().toUpperCase()))
                    .map((addon: Addon) => ({
                        id: addon.id,
                        code: addon.code,
                        name: addon.name,
                        sub: [addon.weight_mode, addon.addon_is_purchased ? `Purchased ${addon.addon_purchase_uom || addon.base_uom || ""}` : "process add-on"].filter(Boolean).join(" · "),
                    }))
            }
            return []
        },
        staleTime: 60_000,
    })

    const sourceMeta: Record<string, { label: string; color: string; ring: string; bg: string }> = {
        pod_sku_variant: { label: "POD catalog", color: "text-violet-800", ring: "ring-violet-200", bg: "bg-violet-50" },
        packaging_material: { label: "Packaging catalog", color: "text-amber-800", ring: "ring-amber-200", bg: "bg-amber-50" },
        addon: { label: "Add-on catalog", color: "text-fuchsia-800", ring: "ring-fuchsia-200", bg: "bg-fuchsia-50" },
    }
    const meta = sourceMeta[source] || sourceMeta.pod_sku_variant

    return (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm transition hover:shadow-md">
            <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-bold text-slate-900">{String(def.axis)}</span>
                        {def.label && <span className="text-[11px] text-slate-500">{def.label}</span>}
                        <span className={cn("rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ring-1 ring-inset", meta.bg, meta.color, meta.ring)}>
                            {meta.label}
                        </span>
                        {def.required && <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[9px] font-bold uppercase text-rose-700 ring-1 ring-rose-200">Required</span>}
                        {def.auto_demand_in_house && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-bold uppercase text-emerald-700 ring-1 ring-emerald-200">Auto-demand</span>}
                    </div>
                    {Object.keys(filter).length > 0 && (
                        <div className="mt-1 text-[10px] text-slate-500">
                            Filter: {Object.entries(filter).map(([k, v]) => `${k}=${v}`).join(" · ")}
                        </div>
                    )}
                </div>
                <div className="flex flex-col items-end gap-1 text-right">
                    <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Qty per order</span>
                    <span className="rounded-lg bg-slate-900/95 px-2 py-1 font-mono text-[11px] text-emerald-300 ring-1 ring-slate-700">
                        {def.qty_formula ? def.qty_formula : def.qty_per_pcs != null ? `${def.qty_per_pcs} × pcs` : "—"}
                    </span>
                </div>
            </div>
            <div className="mt-3">
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
                    {isLoading ? "Loading catalog options…" : `Available catalog options${options.length ? ` (${options.length})` : ""}`}
                </div>
                <div className="mt-1 flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
                    {options.length === 0 && !isLoading && (
                        <span className="text-[10px] italic text-slate-400">
                            No catalog rows match this filter. Add some in master-data.
                        </span>
                    )}
                    {options.slice(0, 30).map((o) => (
                        <span
                            key={o.id}
                            className={cn(
                                "inline-flex items-center gap-1 rounded-full bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-700 ring-1 ring-slate-200",
                                def.default_value === o.code && "bg-emerald-50 text-emerald-800 ring-emerald-200"
                            )}
                            title={o.sub}
                        >
                            <span className="font-mono">{o.code}</span>
                            {def.default_value === o.code && <CheckCircle2 className="h-2.5 w-2.5" />}
                        </span>
                    ))}
                    {options.length > 30 && (
                        <span className="text-[10px] text-slate-400">+ {options.length - 30} more</span>
                    )}
                </div>
            </div>
        </div>
    )
}

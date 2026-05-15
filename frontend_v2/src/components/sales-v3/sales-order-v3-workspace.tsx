"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useMutation, useQuery } from "@tanstack/react-query"
import {
    AlertTriangle,
    ArrowRight,
    BadgeIndianRupee,
    Boxes,
    CheckCircle2,
    ClipboardCheck,
    Layers,
    Loader2,
    Package,
    Palette,
    Save,
    Settings2,
    Sparkles,
    UserSquare,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"

import { GradientHero } from "@/components/erp-v3/gradient-hero"
import { StepStrip } from "@/components/erp-v3/step-strip"
import { SectionCardV3 } from "@/components/erp-v3/section-card-v3"
import { LiveBomRail } from "@/components/erp-v3/live-bom-rail"
import { AxisLayerMatrix, type LayerRowState } from "@/components/erp-v3/axis-layer-matrix"
import { ProductVisual } from "@/components/erp-v3/product-visual"
import { ValidationFooter } from "@/components/erp-v3/validation-footer"
import {
    ArtworkSection,
    type ArtworkAssignment,
    type ArtworkAssignmentMode,
    type ArtworkColorway,
} from "@/components/erp-v3/artwork-section"

import {
    masterDataService,
    type Addon,
    type PackagingMaterial,
    type PodSkuVariant,
} from "@/services/master-data"
import { templateService } from "@/services/templates"
import {
    productMasterService,
    type ProductMaster,
    type PreviewBomResult,
} from "@/services/product-master"
import { salesService } from "@/services/sales"
import { artworkImageUrls, engineeringService, type Artwork } from "@/services/engineering"
import { coerceColorHex } from "@/lib/color-utils"

const STEPS = [
    { id: "customer", label: "Customer", description: "Who & where" },
    { id: "master", label: "Product Master", description: "Route & template" },
    { id: "axes", label: "Pick axes", description: "Size, layers, add-ons" },
    { id: "qty", label: "Quantity + packing", description: "How much & how" },
    { id: "artwork", label: "Artwork / print", description: "Print method & files" },
    { id: "review", label: "Review", description: "" },
]

function artworkAccent(artwork: Artwork) {
    const color = String((artwork.front_colors || artwork.color_list || [])[0] || "").trim()
    return coerceColorHex("", color || artwork.design_code || artwork.name)
}

function colorSlots(colors: string[] = []) {
    return colors.map((color, index) => {
        const name = String(color || "").trim().toUpperCase()
        return {
            index: index + 1,
            name,
            hex: coerceColorHex("", name),
        }
    })
}

function colorwayFromArtwork(artwork: Artwork): ArtworkColorway {
    const images = artworkImageUrls(artwork)
    return {
        id: artwork.id,
        name: artwork.colorway_name || artwork.name || artwork.design_code,
        family: artwork.design_family_code || artwork.design_code,
        thumbnail_url: images[0],
        accent_hex: artworkAccent(artwork),
        is_approved: artwork.status === "APPROVED",
        color_count: Number(artwork.total_side_colors || artwork.colors_count || (artwork.color_list || []).length || 0),
        source_artwork: artwork,
    }
}

function assignmentFromArtwork(artwork: Artwork): ArtworkAssignment {
    const images = artworkImageUrls(artwork)
    const artworkForm = (artwork as any).substrate_mode || (artwork as any).film_type
    return {
        artwork_id: artwork.id,
        design_family_code: artwork.design_family_code || artwork.design_code,
        design_family_name: artwork.name,
        colorway_id: artwork.id,
        colorway_name: artwork.colorway_name || artwork.name,
        accent_hex: artworkAccent(artwork),
        color_count: Number(artwork.total_side_colors || artwork.colors_count || (artwork.color_list || []).length || 0),
        cover_url: images[0],
        front_colors: colorSlots(artwork.front_colors || artwork.color_list || []),
        back_colors: colorSlots(artwork.back_colors || []),
        cylinder_required: artwork.print_type === "ROTO",
        cylinder_ready: Boolean(artwork.cylinder_ready),
        artwork_approved: artwork.status === "APPROVED",
        print_type: artwork.print_type,
        film_type: artworkForm,
        substrate_mode: artworkForm,
        color_mapping: artwork.color_mapping || {},
    }
}

const LEGACY_PACKING_ROLE_ALIASES: Record<string, string> = {
    FINAL_CARTON: "EXTRA",
    FINAL_OUTER: "EXTRA",
    TAPE: "EXTRA",
}

function canonicalPackingRole(role?: string) {
    const raw = String(role || "").toUpperCase()
    return LEGACY_PACKING_ROLE_ALIASES[raw] || raw
}

function materialKind(material?: PackagingMaterial | null) {
    const raw = String(material?.packaging_kind || "").toUpperCase()
    if (raw === "GUNNY") return "GONNY"
    if (raw === "CARTON") return "BOX"
    return raw
}

function packingLineRoleForMaterial(material: PackagingMaterial, productKind?: string) {
    const kind = materialKind(material)
    const product = String(productKind || "POUCH").toUpperCase()
    if (kind === "INNER_POUCH") return "PRIMARY_INNER"
    if (kind === "GONNY" || kind === "OUTER_BAG") return "FINAL_GUNNY"
    if (kind === "SHEET" || /ROLL|SHEET|WRAP/i.test(`${material.code || ""} ${material.name || ""}`)) return "ROLL_DISPATCH"
    return "EXTRA"
}

function packingLineForSelection(material: PackagingMaterial, productKind?: string) {
    const role = packingLineRoleForMaterial(material, productKind)
    return {
        role,
        material_id: material.id,
        material_code: material.code,
        material_name: material.name,
        basis: role === "PRIMARY_INNER" ? "PCS_PER_PACK" : role === "FINAL_GUNNY" ? "COUNTED_AT_PACKING" : "PACKING_EOD_COUNT",
        qty_source: role === "PRIMARY_INNER" ? "AUTO_TOTAL_PCS" : role === "FINAL_GUNNY" ? "PACKING_YARD_SEAL_COUNT" : "EOD_OPEN_CLOSE",
        uom: material.base_uom || "PCS",
        supply_mode: material.packaging_supply_mode,
        packaging_kind: material.packaging_kind,
    }
}

export function SalesOrderV3Workspace() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const { toast } = useToast()

    const initialMaster = searchParams?.get("product_master") || searchParams?.get("master") || ""

    const [stepId, setStepId] = React.useState("customer")
    const [customerId, setCustomerId] = React.useState("")
    const [shipToId, setShipToId] = React.useState("")
    const [productMasterId, setProductMasterId] = React.useState(initialMaster)
    const [templateId, setTemplateId] = React.useState<string>("")
    const [sizeCode, setSizeCode] = React.useState<string>("")
    const [layerValues, setLayerValues] = React.useState<Record<number, LayerRowState>>({})
    const [addons, setAddons] = React.useState<string[]>([])
    const [packagingRecipe, setPackagingRecipe] = React.useState<string>("")
    const [outerPackagingRecipe, setOuterPackagingRecipe] = React.useState<string>("")
    const [otherPackagingRecipes, setOtherPackagingRecipes] = React.useState<string[]>([])
    const [podVariant, setPodVariant] = React.useState<string>("")
    const [quantity, setQuantity] = React.useState(1000)
    const [qtyUom, setQtyUom] = React.useState<"KG" | "PCS">("KG")
    const [unitPrice, setUnitPrice] = React.useState("312.00")
    const [priceBasis, setPriceBasis] = React.useState<"KG" | "PCS">("KG")
    const [deliveryDate, setDeliveryDate] = React.useState("2026-05-10")
    const [orderName, setOrderName] = React.useState("")
    const [remarks, setRemarks] = React.useState("")
    const [artworkMode, setArtworkMode] = React.useState<ArtworkAssignmentMode>("DEFER")
    const [artworkAssignment, setArtworkAssignment] = React.useState<ArtworkAssignment | undefined>()
    const [printType, setPrintType] = React.useState<"FLEXO" | "ROTO">("ROTO")
    const [filmType, setFilmType] = React.useState<"SHEET" | "TUBING">("SHEET")

    const { data: customers = [] } = useQuery({
        queryKey: ["customers"],
        queryFn: masterDataService.getCustomers,
        staleTime: 60_000,
    })
    const { data: masters = [] } = useQuery({
        queryKey: ["product-masters", "v3", "for-sales"],
        // Sales picker hides BULK kind (internal WIP only).
        queryFn: () => productMasterService.list({ for_sales: true }),
        staleTime: 30_000,
    })
    const { data: templates = [] } = useQuery({
        queryKey: ["templates", "live"],
        queryFn: () => templateService.getTemplates({ status: "LIVE" }),
        staleTime: 60_000,
    })
    const { data: addonMasters = [] } = useQuery({
        queryKey: ["master-addons", "active"],
        queryFn: masterDataService.getAddons,
        staleTime: 60_000,
    })
    const { data: packagingMaterials = [] } = useQuery({
        queryKey: ["master-packaging"],
        queryFn: masterDataService.getPackaging,
        staleTime: 60_000,
    })
    const { data: podVariants = [] } = useQuery({
        queryKey: ["master-pod-sku-variants", "active"],
        queryFn: () => masterDataService.getPodSkuVariants({ active: true }),
        staleTime: 60_000,
    })

    const master: ProductMaster | undefined = masters.find((m) => m.id === productMasterId)
    const { data: sizes = [] } = useQuery({
        queryKey: ["product-master-sizes", productMasterId],
        queryFn: () => productMasterService.listSizes(productMasterId),
        enabled: !!productMasterId,
    })
    const { data: overlays = [] } = useQuery({
        queryKey: ["product-master-overlays", productMasterId],
        queryFn: () => productMasterService.listOverlays(productMasterId),
        enabled: !!productMasterId,
    })
    const { data: approvedArtworks = [] } = useQuery({
        queryKey: ["approved-artworks", productMasterId, "approved-any-method"],
        queryFn: () =>
            engineeringService.getArtworks({
                status: "APPROVED",
            }),
        enabled: !!productMasterId && Boolean(master?.fixed_attributes?.print_capable),
        staleTime: 30_000,
    })
    const artworkColorways = React.useMemo(
        () => approvedArtworks.map(colorwayFromArtwork),
        [approvedArtworks]
    )

    React.useEffect(() => {
        // Initialise layer values from master defaults whenever master changes
        if (master) {
            const next: Record<number, LayerRowState> = {}
            master.layer_template.forEach((row, i) => {
                next[i + 1] = {
                    role: row.role,
                    film_variant_code: row.film_variant_code,
                    thickness_micron: row.thickness_micron,
                    grade: row.default_grade,
                }
            })
            setLayerValues(next)
            setTemplateId(master.template || "")
            setPrintType((master.fixed_attributes?.print_type as any) || "FLEXO")
            setFilmType((master.fixed_attributes?.film_type as any) || "SHEET")
            setAddons([])
            setPackagingRecipe("")
            setOuterPackagingRecipe("")
            setOtherPackagingRecipes([])
            setPodVariant("")
            setArtworkAssignment(undefined)
            setArtworkMode(master.fixed_attributes?.artwork_required ? "APPROVED" : "DEFER")
        }
    }, [master?.id])

    React.useEffect(() => {
        if (!sizeCode && sizes.length) setSizeCode(sizes[0].code)
    }, [sizes, sizeCode])

    const customerOverlays = React.useMemo(
        () => overlays.filter((o) => o.customer === customerId && o.active !== false),
        [overlays, customerId]
    )

    const overlay = React.useMemo(() => {
        if (!customerId || !customerOverlays.length) return undefined
        const exact = customerOverlays.find((o) => {
            const overlaySize = o.axis_values?.size
            return !overlaySize || !sizeCode || overlaySize === sizeCode
        })
        return exact || customerOverlays[0]
    }, [customerId, customerOverlays, sizeCode])

    const appliedOverlayRef = React.useRef<string | null>(null)
    React.useEffect(() => {
        // Apply customer defaults once. If the overlay carries an axis tuple,
        // it becomes the fast repeat-order starting point instead of only text.
        if (!overlay || appliedOverlayRef.current === overlay.id) return
        appliedOverlayRef.current = overlay.id
        if (overlay.default_price_basis) setPriceBasis(overlay.default_price_basis)
        const axes = overlay.axis_values || {}
        if (typeof axes.size === "string" && axes.size) setSizeCode(axes.size)
        if (Array.isArray(axes.addons)) setAddons(axes.addons.map(String).filter(Boolean))
        const innerPack = axes.packaging_inner || axes.packaging
        const outerPack = axes.packaging_outer
        const otherPack = axes.packaging_other
        const podAxis = axes.pod_variant || axes.pod
        if (typeof innerPack === "string" && innerPack) setPackagingRecipe(innerPack)
        if (typeof outerPack === "string" && outerPack) setOuterPackagingRecipe(outerPack)
        if (typeof otherPack === "string" && otherPack) setOtherPackagingRecipes([otherPack])
        if (Array.isArray(otherPack)) setOtherPackagingRecipes(otherPack.map(String).filter(Boolean))
        if (typeof podAxis === "string" && podAxis) setPodVariant(podAxis)
        if (overlay.default_artwork) setArtworkMode("OVERLAY_DEFAULT")
    }, [overlay?.id])

    const axisDef = React.useCallback(
        (...names: string[]) => (master?.variant_axes || []).find((axis: any) => names.includes(String(axis.axis))),
        [master?.variant_axes]
    )
    const optionCodes = React.useCallback((axis: any) => {
        const out = new Set<string>()
        const add = (value: any) => {
            if (value == null || value === "") return
            if (typeof value === "object") {
                add(value.code || value.material_code || value.pod_sku_code || value.value || value.id)
                return
            }
            out.add(String(value))
        }
        ;(axis?.options || []).forEach(add)
        add(axis?.default_value)
        return out
    }, [])
    const packagingLines = React.useMemo(
        () => (Array.isArray(master?.fixed_attributes?.packaging_lines) ? master?.fixed_attributes?.packaging_lines : []),
        [master?.fixed_attributes]
    )
    const productKind = String(master?.product_kind || master?.fixed_attributes?.fg_type || "").toUpperCase()
    const fixedPackagingCodesFor = React.useCallback(
        (...roles: string[]) => {
            const roleSet = new Set(roles.map((r) => canonicalPackingRole(r)))
            return new Set(
                packagingLines
                    .filter((line: any) => roleSet.has(canonicalPackingRole(line.role)))
                    .flatMap((line: any) => [line.material_code, line.code, line.material_id, line.material])
                    .filter(Boolean)
                    .map(String)
            )
        },
        [packagingLines]
    )
    const addonsAxis = axisDef("addons", "addon")
    const innerAxis = axisDef("packaging_inner", "packaging")
    const outerAxis = axisDef("packaging_outer")
    const podAxisDef = axisDef("pod_variant", "pod")
    const addonAllowedCodes = optionCodes(addonsAxis)
    const showAddons = Boolean(addonsAxis && addonAllowedCodes.size)
    const showInnerPackaging = productKind !== "ROLL" && Boolean(innerAxis || fixedPackagingCodesFor("PRIMARY_INNER").size)
    const showOuterPackaging = Boolean(outerAxis || fixedPackagingCodesFor(productKind === "ROLL" ? "ROLL_DISPATCH" : "FINAL_GUNNY", "ROLL_DISPATCH").size)
    const showOtherPackaging = Boolean(fixedPackagingCodesFor("EXTRA", "FINAL_CARTON", "FINAL_OUTER", "TAPE").size)
    const showPod = Boolean(podAxisDef)

    const innerPackagingOptions = React.useMemo(
        () => {
            const allowed = optionCodes(innerAxis)
            const fixed = fixedPackagingCodesFor("PRIMARY_INNER")
            const scoped = new Set([...allowed, ...fixed])
            return packagingMaterials.filter((m: PackagingMaterial) => {
                if (String(m.packaging_kind || "").toUpperCase() !== "INNER_POUCH") return false
                return !scoped.size || scoped.has(m.code) || scoped.has(m.id)
            })
        },
        [packagingMaterials, optionCodes, innerAxis, fixedPackagingCodesFor]
    )
    const outerPackagingOptions = React.useMemo(
        () => {
            const allowed = optionCodes(outerAxis)
            const fixed = fixedPackagingCodesFor(productKind === "ROLL" ? "ROLL_DISPATCH" : "FINAL_GUNNY", "ROLL_DISPATCH")
            const scoped = new Set([...allowed, ...fixed])
            return packagingMaterials.filter((m: PackagingMaterial) => {
                const kind = materialKind(m)
                if (productKind === "ROLL") {
                    if (kind !== "SHEET" && !/ROLL|SHEET|WRAP/i.test(`${m.code || ""} ${m.name || ""}`)) return false
                } else if (!["GONNY", "OUTER_BAG", "SHEET"].includes(kind)) return false
                return !scoped.size || scoped.has(m.code) || scoped.has(m.id)
            })
        },
        [packagingMaterials, optionCodes, outerAxis, fixedPackagingCodesFor, productKind]
    )
    const otherPackagingOptions = React.useMemo(
        () => {
            const fixed = fixedPackagingCodesFor("EXTRA", "FINAL_CARTON", "FINAL_OUTER", "TAPE")
            return packagingMaterials.filter((m: PackagingMaterial) => {
                const kind = materialKind(m)
                if (!["TAPE", "LABEL", "TAG", "OTHER", "BOX"].includes(kind) && !(productKind === "POUCH" && kind === "SHEET")) return false
                return fixed.size > 0 && (fixed.has(m.code) || fixed.has(m.id))
            })
        },
        [packagingMaterials, fixedPackagingCodesFor, productKind]
    )
    const addonOptions = React.useMemo(() => {
        return addonMasters.filter((addon: Addon) => addonAllowedCodes.has(addon.code) || addonAllowedCodes.has(addon.id))
    }, [addonMasters, addonAllowedCodes])
    const podOptions = React.useMemo(() => {
        const allowed = optionCodes(podAxisDef)
        return podVariants.filter((pod: PodSkuVariant) => !allowed.size || allowed.has(pod.code) || allowed.has(pod.id))
    }, [podVariants, podAxisDef, optionCodes])
    const selectedPackaging = packagingMaterials.find(
        (m: PackagingMaterial) => m.id === packagingRecipe || m.code === packagingRecipe
    )
    const selectedOuterPackaging = packagingMaterials.find(
        (m: PackagingMaterial) => m.id === outerPackagingRecipe || m.code === outerPackagingRecipe
    )
    const selectedOtherPackaging = packagingMaterials.filter((m: PackagingMaterial) => otherPackagingRecipes.includes(m.id) || otherPackagingRecipes.includes(m.code))
    const selectedPod = podVariants.find((p: PodSkuVariant) => p.id === podVariant || p.code === podVariant)
    const printDefaults = React.useMemo(() => {
        const attrs = master?.fixed_attributes || {}
        const front = Number(attrs.default_front_colors ?? attrs.front_colors_count ?? attrs.default_color_count ?? 1)
        const back = Number(attrs.default_back_colors ?? attrs.back_colors_count ?? 0)
        const ink = Number(attrs.default_ink_gsm_total ?? attrs.ink_gsm_total ?? attrs.ink_gsm ?? 1.2)
        return {
            frontColors: Number.isFinite(front) && front > 0 ? front : 1,
            backColors: filmType === "TUBING" && Number.isFinite(back) && back > 0 ? back : 0,
            inkGsmTotal: Number.isFinite(ink) && ink > 0 ? ink : 1.2,
        }
    }, [master?.fixed_attributes, filmType])
    const resolvedPrintType = String(artworkAssignment?.print_type || printType || "FLEXO").toUpperCase() as "FLEXO" | "ROTO"
    const resolvedFilmType = String(artworkAssignment?.substrate_mode || artworkAssignment?.film_type || filmType || "SHEET").toUpperCase() as "SHEET" | "TUBING"

    const packagingSnapshot = React.useMemo(() => {
        const overlayRecipe = overlay?.default_packing_recipe
        const overlayHasBomLines =
            Boolean(overlayRecipe?.pod?.enabled || overlayRecipe?.pod_variant || overlayRecipe?.pod_variant_code) ||
            (Array.isArray(overlayRecipe?.packaging_lines) && overlayRecipe.packaging_lines.length > 0)

        // Total finished pieces — used to derive inner-pack consumption
        const totalPcs = (() => {
            if (qtyUom === "PCS") return Math.max(0, Math.round(quantity))
            // For KG, prefer overlay unit weight if present, else 0 (back-end will refine)
            const unitWeightG = Number(overlayRecipe?.unit_weight_g || 0)
            if (qtyUom === "KG" && unitWeightG > 0) {
                return Math.max(0, Math.round((quantity * 1000) / unitWeightG))
            }
            return 0
        })()

        if (overlayHasBomLines && !selectedPackaging && !selectedOuterPackaging && !selectedPod && selectedOtherPackaging.length === 0) {
            // Re-project overlay packaging lines: only PRIMARY_INNER consumes by total_pcs ÷ pcs_per_pack.
            // Outer (gunny / carton) is COUNTED on the packing floor — never pre-calculated here.
            const lines = (overlayRecipe.packaging_lines || []).map((row: any) => {
                const role = String(row.role || "").toUpperCase()
                if (role === "PRIMARY_INNER" && row.pcs_per_pack && totalPcs > 0) {
                    const innerCount = Math.ceil(totalPcs / Number(row.pcs_per_pack))
                    return { ...row, qty: innerCount, basis: "PCS_PER_PACK" }
                }
                return row
            })
            return { ...overlayRecipe, packaging_lines: lines }
        }

        const innerDefaults = (selectedPackaging?.packaging_defaults_json || {}) as Record<string, any>
        const outerDefaults = (selectedOuterPackaging?.packaging_defaults_json || {}) as Record<string, any>
        const pcsPerPack = Number(innerDefaults.pcs_per_pack || 0)
        const innersPerOuter = Number(outerDefaults.inners_per_outer || outerDefaults.inners_per_gunny || 0)
        const innerCount = selectedPackaging && pcsPerPack > 0 && totalPcs > 0
            ? Math.ceil(totalPcs / pcsPerPack)
            : 0

        const packagingLines = [
            ...(selectedPackaging
                ? [
                      {
                          ...packingLineForSelection(selectedPackaging, productKind),
                          qty: innerCount || undefined,
                          pcs_per_pack: pcsPerPack || undefined,
                      },
                  ]
                : []),
            ...(selectedOuterPackaging ? [packingLineForSelection(selectedOuterPackaging, productKind)] : []),
            ...selectedOtherPackaging.map((material) => packingLineForSelection(material, productKind)),
        ]

        return {
            packaging_lines: packagingLines,
            primary_inner_pack: selectedPackaging
                ? {
                      enabled: true,
                      material_id: selectedPackaging.id,
                      material_code: selectedPackaging.code,
                      material_name: selectedPackaging.name,
                      supply_mode: selectedPackaging.packaging_supply_mode,
                      pcs_per_pack: pcsPerPack || undefined,
                      derived_inner_count: innerCount || undefined,
                      total_pcs: totalPcs || undefined,
                  }
                : { enabled: false },
            final_outer_pack: selectedOuterPackaging
                ? {
                      enabled: true,
                      material_id: selectedOuterPackaging.id,
                      material_code: selectedOuterPackaging.code,
                      material_name: selectedOuterPackaging.name,
                      supply_mode: selectedOuterPackaging.packaging_supply_mode,
                      packaging_kind: selectedOuterPackaging.packaging_kind,
                      counted_at_packing: true,
                      basis: "COUNTED_AT_PACKING",
                      inners_per_outer: innersPerOuter || undefined,
                  }
                : { enabled: false, counted_at_packing: true },
            pod: selectedPod
                ? {
                      enabled: true,
                      pod_sku_variant_id: selectedPod.id,
                      pod_sku_code: selectedPod.code || selectedPod.pod_sku_code,
                      pod_sku_name: selectedPod.name || selectedPod.pod_sku_name,
                      pod_profile_id: selectedPod.material,
                      material_code: selectedPod.material_code,
                  }
                : { enabled: false },
        }
    }, [overlay?.default_packing_recipe, selectedPackaging, selectedOuterPackaging, selectedOtherPackaging, selectedPod, quantity, qtyUom, productKind])

    const axisValues = React.useMemo(() => {
        const layer_thicknesses: Record<string, number> = {}
        const layer_grades: Record<string, string> = {}
        const layer_widths: Record<string, number> = {}
        Object.entries(layerValues).forEach(([k, v]) => {
            const thickness = Number(v.thickness_micron)
            const width = Number(v.width_mm)
            const grade = typeof v.grade === "string" ? v.grade.trim() : v.grade
            if (Number.isFinite(thickness) && thickness > 0) layer_thicknesses[k] = thickness
            if (grade) layer_grades[k] = String(grade)
            if (Number.isFinite(width) && width > 0) layer_widths[k] = width
        })
        const axis: Record<string, any> = {
            size: sizeCode,
            layer_thicknesses,
            layer_grades,
            layer_widths,
        }
        if (showAddons && addons.length) axis.addons = addons
        const innerPack = selectedPackaging?.code || packagingRecipe
        const outerPack = selectedOuterPackaging?.code || outerPackagingRecipe
        const podValue = selectedPod?.code || podVariant
        if (showInnerPackaging && innerPack) {
            axis.packaging_inner = innerPack
            axis.packaging = innerPack
        }
        if (showOuterPackaging && outerPack) axis.packaging_outer = outerPack
        if (showOtherPackaging && selectedOtherPackaging.length) axis.packaging_other = selectedOtherPackaging.map((material) => material.code)
        if (showPod && podValue) {
            axis.pod_variant = podValue
            axis.pod = podValue
        }
        return axis
    }, [
        layerValues,
        sizeCode,
        addons,
        packagingRecipe,
        outerPackagingRecipe,
        podVariant,
        selectedPackaging?.code,
        selectedOuterPackaging?.code,
        selectedOtherPackaging,
        selectedPod?.code,
        showAddons,
        showInnerPackaging,
        showOuterPackaging,
        showOtherPackaging,
        showPod,
    ])

    const requiredAxisNames = React.useMemo(
        () => new Set((master?.variant_axes || []).filter((axis) => axis.required).map((axis) => axis.axis)),
        [master?.variant_axes]
    )
    const overlayAxisValues = overlay?.axis_values || {}
    const overlayNeedsApplying =
        Boolean(overlay && Object.keys(overlayAxisValues).length) && appliedOverlayRef.current !== overlay?.id

    const innerPackagingReady =
        (!requiredAxisNames.has("packaging") && !requiredAxisNames.has("packaging_inner")) ||
        Boolean(axisValues.packaging_inner || axisValues.packaging) ||
        (Array.isArray(packagingSnapshot?.packaging_lines) && packagingSnapshot.packaging_lines.length > 0)
    const outerPackagingReady =
        !requiredAxisNames.has("packaging_outer") || Boolean(axisValues.packaging_outer)
    const packagingReady = innerPackagingReady && outerPackagingReady
    const podReady =
        (!requiredAxisNames.has("pod") && !requiredAxisNames.has("pod_variant")) ||
        Boolean(axisValues.pod_variant || axisValues.pod) ||
        Boolean(packagingSnapshot?.pod?.enabled || packagingSnapshot?.pod_variant || packagingSnapshot?.pod_variant_code)
    const axesReady = Boolean(sizeCode) && packagingReady && podReady

    const previewQuery = useQuery({
        queryKey: [
            "sales-preview",
            productMasterId,
            customerId,
            axisValues,
            packagingSnapshot,
            quantity,
            artworkMode,
            resolvedPrintType,
            resolvedFilmType,
            printDefaults,
        ],
        enabled: !!productMasterId && !!customerId && axesReady && !overlayNeedsApplying,
        queryFn: () =>
            productMasterService.previewBom({
                customer_id: customerId,
                product_master: productMasterId,
                template_id: templateId || null,
                axis_values: axisValues,
                quantity,
                quantity_uom: qtyUom,
                price_basis: priceBasis,
                printing: master?.fixed_attributes?.print_capable
                      ? {
                            enabled: true,
                            print_type: resolvedPrintType,
                            type: resolvedPrintType,
                            method: resolvedPrintType,
                            film_type: resolvedFilmType,
                            substrate_mode: resolvedFilmType,
                            front_colors_count: artworkAssignment?.front_colors?.length || printDefaults.frontColors,
                            back_colors_count: resolvedFilmType === "TUBING" ? (artworkAssignment?.back_colors?.length || printDefaults.backColors) : 0,
                            ink_gsm_total: printDefaults.inkGsmTotal,
                            ink_gsm: printDefaults.inkGsmTotal,
                            defer_artwork_to_planner: artworkMode === "DEFER",
                            artwork_id: artworkAssignment?.artwork_id || (artworkMode === "OVERLAY_DEFAULT" ? overlay?.default_artwork : undefined),
                            colorway_id: artworkAssignment?.colorway_id,
                            color_mapping: artworkAssignment?.color_mapping || {},
                          cylinder_required: artworkAssignment?.cylinder_required ?? resolvedPrintType === "ROTO",
                      }
                    : { enabled: false },
                packaging: packagingSnapshot,
                packaging_snapshot: packagingSnapshot,
            }),
        staleTime: 0,
    })

    const preview: PreviewBomResult | undefined = previewQuery.data
    const estimatedTotalPouches = React.useMemo(() => {
        if (qtyUom === "PCS") return Math.max(0, Math.round(quantity))
        const unitWeightG = Number(preview?.unit_weight_g || 0)
        if (qtyUom === "KG" && unitWeightG > 0) {
            return Math.max(1, Math.ceil((quantity * 1000) / unitWeightG))
        }
        return Math.max(1, Math.floor(quantity / 0.02))
    }, [preview?.unit_weight_g, quantity, qtyUom])

    const checks = preview?.checks || []
    const blockers = preview?.blockers || []
    const createBlocked =
        !customerId ||
        !productMasterId ||
        !axesReady ||
        overlayNeedsApplying ||
        blockers.length > 0

    const customer = customers.find((c) => c.id === customerId)
    const customerName = overlay?.customer_display_name || customer?.name || "—"

    const createMutation = useMutation({
        mutationFn: () =>
            salesService.createOrder({
                customer: customerId,
                ship_to_customer: shipToId || customerId,
                order_name: orderName || `Order ${new Date().toISOString().slice(0, 10)}`,
                delivery_date: deliveryDate,
                items: [
                    {
                        product_master: productMasterId,
                        template_id: templateId,
                        axis_values: axisValues,
                        qty_value: quantity,
                        qty_uom: qtyUom,
                        price_basis: priceBasis,
                        unit_price: unitPrice,
                        packaging_snapshot: packagingSnapshot,
                        printing: master?.fixed_attributes?.print_capable
                            ? {
                                  enabled: true,
                                  print_type: resolvedPrintType,
                                  type: resolvedPrintType,
                                  method: resolvedPrintType,
                                  film_type: resolvedFilmType,
                                  substrate_mode: resolvedFilmType,
                                  front_colors_count: artworkAssignment?.front_colors?.length || printDefaults.frontColors,
                                  back_colors_count: resolvedFilmType === "TUBING" ? (artworkAssignment?.back_colors?.length || printDefaults.backColors) : 0,
                                  ink_gsm_total: printDefaults.inkGsmTotal,
                                  ink_gsm: printDefaults.inkGsmTotal,
                                  defer_artwork_to_planner: artworkMode === "DEFER",
                                  artwork_id: artworkAssignment?.artwork_id || (artworkMode === "OVERLAY_DEFAULT" ? overlay?.default_artwork : undefined),
                                  color_mapping: artworkAssignment?.color_mapping || {},
                                  cylinder_required: artworkAssignment?.cylinder_required ?? resolvedPrintType === "ROTO",
                              }
                            : { enabled: false },
                        remarks,
                    },
                ],
            }),
        onSuccess: (data: any) => {
            toast({ title: "Sales order created", description: `Order ${data?.order_number || data?.id || ""}` })
            router.push("/sales/orders")
        },
        onError: (err: any) =>
            toast({ title: "Could not create order", description: err?.message || "Try again", variant: "destructive" }),
    })

    const completedSteps = computeCompletedSteps({
        customerId,
        productMasterId,
        sizeCode,
        layerValues,
        quantity,
        deliveryDate,
        artworkMode,
    })

    return (
        <div className="space-y-6">
            <GradientHero
                eyebrow="Sales · Create"
                title="Create sales order"
                subtitle="Customer + Product Master + axis choices. Variants are auto-deduped only when this combination is used."
                palette="blue"
                chips={[
                    {
                        label: "Customer",
                        value: customer?.name || "Pick customer",
                        tone: customerId ? "ok" : "warn",
                        icon: <UserSquare className="h-3.5 w-3.5" />,
                    },
                    {
                        label: "Product",
                        value: master?.code || "Pick master",
                        tone: master ? "ok" : "warn",
                        icon: <Package className="h-3.5 w-3.5" />,
                    },
                    {
                        label: "Preview",
                        value: blockers.length ? `${blockers.length} blocker${blockers.length > 1 ? "s" : ""}` : "Valid",
                        tone: blockers.length ? "error" : "ok",
                        icon: <CheckCircle2 className="h-3.5 w-3.5" />,
                    },
                    {
                        label: "Variant",
                        value: preview?.variant_status === "EXISTS" ? "Reuse existing" : "New on submit",
                        tone: "violet",
                        icon: <Sparkles className="h-3.5 w-3.5" />,
                    },
                    {
                        label: "Artwork",
                        value:
                            artworkMode === "DEFER"
                                ? "Deferred"
                                : artworkAssignment
                                ? artworkAssignment.colorway_name || "Selected"
                                : "Pending",
                        tone: artworkMode === "DEFER" ? "warn" : artworkAssignment ? "ok" : "warn",
                        icon: <Palette className="h-3.5 w-3.5" />,
                    },
                ]}
            />

            <StepStrip
                steps={STEPS}
                currentId={stepId}
                completedIds={completedSteps}
                onStepClick={setStepId}
            />

            <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
                <div className="space-y-5">
                    <SectionCardV3 index={1} eyebrow="Customer" title="Who & where" accent="blue">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <Field label="Customer">
                                <Select value={customerId} onValueChange={setCustomerId}>
                                    <SelectTrigger className="h-10 rounded-xl border-slate-200 shadow-sm">
                                        <SelectValue placeholder="Pick customer" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {customers.map((c) => (
                                            <SelectItem key={c.id} value={c.id}>
                                                {c.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </Field>
                            <Field label="Ship to">
                                <Select value={shipToId} onValueChange={setShipToId}>
                                    <SelectTrigger className="h-10 rounded-xl border-slate-200 shadow-sm">
                                        <SelectValue placeholder="Same as customer" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {customers.map((c) => (
                                            <SelectItem key={c.id} value={c.id}>
                                                {c.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </Field>
                            <Field label="Customer item code">
                                <Input
                                    value={overlay?.customer_item_code || ""}
                                    readOnly
                                    placeholder={customerId && !overlay ? "No overlay match" : "Will populate from overlay"}
                                    className="h-10 rounded-xl bg-slate-50"
                                />
                            </Field>
                            <Field label="Tax / price basis">
                                <Select value={priceBasis} onValueChange={(v) => setPriceBasis(v as any)}>
                                    <SelectTrigger className="h-10 rounded-xl border-slate-200 shadow-sm">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="KG">per KG</SelectItem>
                                        <SelectItem value="PCS">per PCS</SelectItem>
                                    </SelectContent>
                                </Select>
                            </Field>
                        </div>
                        {overlay ? (
                            <div className="mt-3 flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-emerald-800 ring-1 ring-emerald-100">
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                <span className="text-xs font-bold">
                                    Overlay matched: {overlay.customer_item_code}
                                </span>
                                <span className="text-xs text-emerald-700">
                                    Customer defaults applied for item code, price basis, artwork, and BOM packaging when configured.
                                </span>
                            </div>
                        ) : customerId ? (
                            <div className="mt-3 flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-amber-800 ring-1 ring-amber-100">
                                <AlertTriangle className="h-3.5 w-3.5" />
                                <span className="text-xs font-bold">No customer overlay matched.</span>
                                <span className="text-xs">Generic master defaults will apply.</span>
                            </div>
                        ) : null}
                    </SectionCardV3>

                    <SectionCardV3 index={2} eyebrow="Product Master" title="Route & template" accent="violet">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <Field label="Product master">
                                <Select value={productMasterId} onValueChange={setProductMasterId}>
                                    <SelectTrigger className="h-10 rounded-xl border-slate-200 shadow-sm">
                                        <SelectValue placeholder="Pick product master" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {masters.map((m) => (
                                            <SelectItem key={m.id} value={m.id}>
                                                {m.code} — {m.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </Field>
                            <Field label="Template">
                                <Select value={templateId} onValueChange={setTemplateId}>
                                    <SelectTrigger className="h-10 rounded-xl border-slate-200 shadow-sm">
                                        <SelectValue placeholder={master?.template_name || "Pick template"} />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {templates.map((t: any) => (
                                            <SelectItem key={t.id} value={t.id}>
                                                {t.name || t.code}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </Field>
                        </div>
                        {master ? (
                            <div className="mt-3 flex flex-wrap gap-2">
                                <Pill tone="blue">{master.product_kind}</Pill>
                                <Pill tone="violet">{master.variant_axes.length} axes</Pill>
                                {master.fixed_attributes?.print_capable ? <Pill tone="fuchsia">Print capable</Pill> : null}
                                {master.fixed_attributes?.artwork_required ? (
                                    <Pill tone="amber">Artwork required</Pill>
                                ) : null}
                                <Pill tone="emerald">Packaging BOM ready</Pill>
                            </div>
                        ) : null}
                    </SectionCardV3>

                    {master ? (
                        <>
                            <SectionCardV3 index={3} eyebrow="Axis builder" title="Per-layer choices, not global" accent="blue">
                                <div className="space-y-4">
                                    <div>
                                        <Label className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">
                                            Size (choose one)
                                        </Label>
                                        <div className="mt-2 grid max-h-60 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
                                            {sizes.map((s) => {
                                                const active = s.code === sizeCode
                                                return (
                                                    <button
                                                        key={s.id}
                                                        type="button"
                                                        onClick={() => setSizeCode(s.code)}
                                                        className={cn(
                                                            "rounded-2xl border px-3 py-3 text-left shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300",
                                                            active
                                                                ? "border-blue-400 bg-gradient-to-br from-blue-50 to-white ring-2 ring-blue-200 shadow-blue-100"
                                                                : "border-slate-200 bg-white hover:border-blue-200 hover:shadow-md"
                                                        )}
                                                    >
                                                        <div className="flex items-center justify-between">
                                                            <div className="flex items-center gap-2">
                                                                <span className={cn("flex h-7 w-7 items-center justify-center rounded-lg text-[10px] font-black ring-1",
                                                                    active ? "bg-blue-600 text-white ring-blue-700" : "bg-slate-100 text-slate-500 ring-slate-200"
                                                                )}>
                                                                    <Layers className="h-3 w-3" />
                                                                </span>
                                                                <div className="text-sm font-bold text-slate-900">{s.code}</div>
                                                            </div>
                                                            <span
                                                                className={cn(
                                                                    "h-4 w-4 rounded-full border-2 transition",
                                                                    active ? "border-blue-600 bg-blue-600 shadow-sm shadow-blue-200" : "border-slate-300 bg-white"
                                                                )}
                                                            />
                                                        </div>
                                                        <div className="mt-1 text-[11px] font-medium text-slate-500">{s.label}</div>
                                                        <div className="mt-0.5 text-[10px] text-slate-400">{s.width_mm}×{s.height_mm} mm</div>
                                                    </button>
                                                )
                                            })}
                                        </div>
                                    </div>

                                    <div>
                                        <Label className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">
                                            Per-layer axes
                                        </Label>
                                        <div className="mt-2">
                                            <AxisLayerMatrix
                                                layers={master.layer_template}
                                                values={layerValues}
                                                fallbackWidthMm={(sizes.find((s) => s.code === sizeCode)?.roll_width_mm ?? sizes[0]?.roll_width_mm) ?? undefined}
                                                onChange={(idx, patch) =>
                                                    setLayerValues((prev) => ({
                                                        ...prev,
                                                        [idx]: { ...(prev[idx] || ({} as LayerRowState)), ...patch },
                                                    }))
                                                }
                                            />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                        {showAddons ? (
                                            <div>
                                                <Label className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">
                                                    Add-ons allowed by this master
                                                </Label>
                                                <div className="mt-2 flex flex-wrap gap-2">
                                                    {addonOptions.length ? addonOptions.map((addon: Addon) => {
                                                        const id = addon.code
                                                        const active = addons.includes(id)
                                                        return (
                                                            <button
                                                                key={id}
                                                                type="button"
                                                                onClick={() =>
                                                                    setAddons((arr) =>
                                                                        active ? arr.filter((x) => x !== id) : [...arr, id]
                                                                    )
                                                                }
                                                                className={cn(
                                                                    "rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider shadow-sm ring-1 ring-inset transition-all",
                                                                    active
                                                                        ? "bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-blue-200 ring-blue-700"
                                                                        : "bg-white text-slate-700 ring-slate-200 hover:bg-blue-50 hover:text-blue-700 hover:ring-blue-200"
                                                                )}
                                                            >
                                                                {addon.name || id.replace("_", " ")}
                                                            </button>
                                                        )
                                                    }) : (
                                                        <div className="rounded-xl border border-dashed border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-500">
                                                            No add-ons are allowed by this Product Master axis.
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        ) : null}
                                        {showInnerPackaging ? (
                                            <div>
                                            <Label className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">
                                                Inner pouch (choose one)
                                            </Label>
                                            <Select
                                                value={packagingRecipe || "__none"}
                                                onValueChange={(value) => setPackagingRecipe(value === "__none" ? "" : value)}
                                            >
                                                <SelectTrigger className="mt-2 h-10 rounded-xl">
                                                    <SelectValue placeholder="Select inner pouch" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="__none">Set per order / overlay</SelectItem>
                                                    {innerPackagingOptions.map((material: PackagingMaterial) => (
                                                        <SelectItem key={material.id} value={material.id}>
                                                            {material.code} — {material.name}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        ) : null}
                                        {showOuterPackaging ? (
                                            <div>
                                            <Label className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">
                                                {productKind === "ROLL" ? "Roll sheet / wrap" : "Gunny or sheet (choose one)"}
                                            </Label>
                                            <Select
                                                value={outerPackagingRecipe || "__none"}
                                                onValueChange={(value) => setOuterPackagingRecipe(value === "__none" ? "" : value)}
                                            >
                                                <SelectTrigger className="mt-2 h-10 rounded-xl">
                                                    <SelectValue placeholder="Counted in packing yard" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="__none">{productKind === "ROLL" ? "Set from EOD count" : "Count at packing yard / EOD"}</SelectItem>
                                                    {outerPackagingOptions.map((material: PackagingMaterial) => (
                                                        <SelectItem key={material.id} value={material.id}>
                                                            {material.code} — {material.name}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            <div className="mt-1 text-[10px] font-semibold text-slate-500">
                                                {productKind === "ROLL" ? "Roll sheets/wrap are issued from evening open-close packing count." : "Gunny is counted in packing yard; sheets are consumed by EOD open-close stock count."}
                                            </div>
                                        </div>
                                        ) : null}
                                        {showOtherPackaging ? (
                                            <div>
                                                <Label className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">
                                                    Other EOD packing allowed
                                                </Label>
                                                <div className="mt-2 flex flex-wrap gap-2">
                                                    {otherPackagingOptions.length ? otherPackagingOptions.map((material: PackagingMaterial) => {
                                                        const id = material.code
                                                        const active = otherPackagingRecipes.includes(material.id) || otherPackagingRecipes.includes(material.code)
                                                        return (
                                                            <button
                                                                key={material.id || material.code}
                                                                type="button"
                                                                onClick={() =>
                                                                    setOtherPackagingRecipes((arr) =>
                                                                        active ? arr.filter((value) => value !== material.id && value !== material.code) : [...arr, id]
                                                                    )
                                                                }
                                                                className={cn(
                                                                    "rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider shadow-sm ring-1 ring-inset transition-all",
                                                                    active
                                                                        ? "bg-emerald-600 text-white shadow-emerald-200 ring-emerald-700"
                                                                        : "bg-white text-slate-700 ring-slate-200 hover:bg-emerald-50 hover:text-emerald-700 hover:ring-emerald-200"
                                                                )}
                                                            >
                                                                {material.code}
                                                            </button>
                                                        )
                                                    }) : (
                                                        <div className="rounded-xl border border-dashed border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-500">
                                                            No EOD packing materials are allowed by this Product Master.
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="mt-1 text-[10px] font-semibold text-slate-500">
                                                    Tape, labels, tags, and extra sheets are not manually consumed per order; Packing Yard posts them from evening open-close stock.
                                                </div>
                                            </div>
                                        ) : null}
                                        {showPod ? (
                                            <div>
                                            <Label className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">
                                                POD (choose one)
                                            </Label>
                                            <Select
                                                value={podVariant || "__none"}
                                                onValueChange={(value) => setPodVariant(value === "__none" ? "" : value)}
                                            >
                                                <SelectTrigger className="mt-2 h-10 rounded-xl">
                                                    <SelectValue placeholder="No POD" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="__none">No POD</SelectItem>
                                                    {podOptions.map((pod: PodSkuVariant) => (
                                                        <SelectItem key={pod.id} value={pod.id}>
                                                            {pod.code} — {pod.name || pod.pod_sku_name}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        ) : null}
                                    </div>

                                    <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-3 text-xs text-violet-800 ring-1 ring-violet-100">
                                        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-violet-700">
                                            Variant status
                                        </div>
                                        <div className="mt-1 flex flex-wrap items-center gap-2 font-bold text-violet-900">
                                            <Sparkles className="h-3.5 w-3.5" />
                                            {preview?.variant_status === "EXISTS"
                                                ? "Existing variant will be reused"
                                                : "New variant will be created on submit"}
                                        </div>
                                        <div className="mt-1 text-[11px] text-violet-700">
                                            Axis tuple: <span className="font-mono">{summariseAxis(axisValues)}</span>
                                        </div>
                                    </div>

                                    {/* V3.3: live BOM-resolution preview from catalog-backed axes */}
                                    <CatalogBomPreview
                                        master={master}
	                                        axisValues={{
	                                            pod_variant: selectedPod?.code,
	                                            packaging_inner: selectedPackaging?.code,
	                                            packaging_outer: selectedOuterPackaging?.code,
	                                        }}
	                                        totalPouches={estimatedTotalPouches}
	                                        overlay={overlay}
	                                    />
                                </div>
                            </SectionCardV3>

                            <SectionCardV3 index={4} eyebrow="Quantity + packing" title="How much & how" accent="emerald">
                                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                                    <Field label="Quantity">
                                        <Input
                                            type="number"
                                            value={quantity}
                                            onChange={(e) => setQuantity(Number(e.target.value))}
                                            className="h-10 rounded-xl border-slate-200 shadow-sm"
                                        />
                                    </Field>
                                    <Field label="UOM">
                                        <Select value={qtyUom} onValueChange={(v) => setQtyUom(v as any)}>
                                            <SelectTrigger className="h-10 rounded-xl border-slate-200 shadow-sm">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="KG">KG</SelectItem>
                                                <SelectItem value="PCS">PCS</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </Field>
                                    <Field label="Promised dispatch">
                                        <Input
                                            type="date"
                                            value={deliveryDate}
                                            onChange={(e) => setDeliveryDate(e.target.value)}
                                            className="h-10 rounded-xl border-slate-200 shadow-sm"
                                        />
                                    </Field>
                                    <Field label="Unit price">
                                        <Input
                                            value={unitPrice}
                                            onChange={(e) => setUnitPrice(e.target.value)}
                                            className="h-10 rounded-xl border-slate-200 shadow-sm"
                                        />
                                    </Field>
                                    <Field label="Order name (optional)">
                                        <Input
                                            value={orderName}
                                            onChange={(e) => setOrderName(e.target.value)}
                                            placeholder="e.g. Acme dry fruit May order"
                                            className="h-10 rounded-xl border-slate-200 shadow-sm"
                                        />
                                    </Field>
                                    <Field label="Remarks" className="sm:col-span-2 lg:col-span-3">
                                        <Textarea
                                            value={remarks}
                                            onChange={(e) => setRemarks(e.target.value)}
                                            className="min-h-[40px] rounded-xl"
                                        />
                                    </Field>
                                </div>
                            </SectionCardV3>

                            <SectionCardV3 index={5} eyebrow="Artwork / print" title="Artwork mode, color replace, cylinder gate" accent="violet">
                                <ArtworkSection
                                    mode={artworkMode}
                                    onModeChange={setArtworkMode}
                                    printType={printType}
                                    onPrintTypeChange={setPrintType}
                                    filmType={filmType}
                                    onFilmTypeChange={setFilmType}
                                    options={artworkColorways}
                                    assignment={artworkAssignment}
                                    onSelectColorway={(cw) => {
                                        const source = cw.source_artwork as Artwork | undefined
                                        if (source) {
                                            const next = assignmentFromArtwork(source)
                                            setArtworkAssignment(next)
                                            if (next.print_type) setPrintType(String(next.print_type).toUpperCase() as "FLEXO" | "ROTO")
                                            if (next.substrate_mode || next.film_type) setFilmType(String(next.substrate_mode || next.film_type).toUpperCase() as "SHEET" | "TUBING")
                                        }
                                    }}
                                    onReplaceColor={(slot) => {
                                        setArtworkMode("REPLACE")
                                        toast({
                                            title: "Pick another approved colorway",
                                            description: `${slot.name} should be changed by selecting another artwork/colorway so ink BOM stays traceable.`,
                                        })
                                    }}
                                    onPickArtwork={() => router.push(productMasterId ? `/engineering/artworks?product_master=${productMasterId}` : "/engineering/artworks")}
                                    overlayDefault={
                                        overlay?.default_artwork
                                            ? {
                                                  id: overlay.default_artwork as string,
                                                  label: `${overlay.customer_display_name} default`,
                                                  accent_hex: "#1d4ed8",
                                              }
                                            : undefined
                                    }
                                    disabled={!master.fixed_attributes?.print_capable}
                                />
                            </SectionCardV3>
                        </>
                    ) : (
                        <div className="rounded-2xl border border-dashed border-blue-200 bg-gradient-to-br from-blue-50/60 to-white p-12 text-center shadow-sm">
                            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-100 ring-1 ring-blue-200">
                                <Package className="h-7 w-7 text-blue-600" />
                            </div>
                            <div className="mt-4 text-sm font-bold text-slate-800">Pick a Product Master to start</div>
                            <p className="mt-1 text-xs text-slate-500">
                                Choose a master and the axis builder, packaging and artwork sections become live.
                            </p>
                        </div>
                    )}
                </div>

                <aside className="space-y-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pb-4">
                    <SectionCardV3 title="Order anatomy" description="Live structural preview" accent="emerald">
                        <ProductVisual
                            kind={master?.product_kind || "POUCH"}
                            layers={Object.values(layerValues).map((v) => ({
                                role: v.role,
                                film_variant_code: v.film_variant_code,
                                thickness_micron: v.thickness_micron,
                                grade: v.grade,
                            }))}
                            width_mm={sizes.find((s) => s.code === sizeCode)?.width_mm}
                            height_mm={sizes.find((s) => s.code === sizeCode)?.height_mm}
                            gusset_mm={sizes.find((s) => s.code === sizeCode)?.gusset_mm}
                            roll_width_mm={sizes.find((s) => s.code === sizeCode)?.roll_width_mm ?? undefined}
                            addons={addons}
                            title="Order anatomy"
                            subtitle={sizeCode}
                        />
                    </SectionCardV3>
                    <LiveBomRail preview={preview} loading={previewQuery.isLoading} />
                </aside>
            </div>

            <ValidationFooter
                checks={checks}
                autosaveLabel="Draft saved 4 min ago"
                primaryActions={
                    <>
                        <Button
                            onClick={() => createMutation.mutate()}
                            disabled={createBlocked || createMutation.isPending}
                            className="gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 shadow-lg shadow-blue-600/25 hover:shadow-xl hover:shadow-blue-600/30"
                        >
                            {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />}
                            Create + send to planner
                            <ArrowRight className="h-4 w-4" />
                        </Button>
                    </>
                }
                secondaryActions={
                    <Button variant="ghost" className="rounded-xl text-slate-600">
                        <Save className="mr-1.5 h-4 w-4" /> Save as preset
                    </Button>
                }
            />
        </div>
    )
}

function Field({
    label,
    children,
    className,
}: {
    label: string
    children: React.ReactNode
    className?: string
}) {
    return (
        <div className={className}>
            <Label className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">{label}</Label>
            <div className="mt-1">{children}</div>
        </div>
    )
}

function Pill({ tone, children }: { tone: "blue" | "violet" | "fuchsia" | "amber" | "emerald"; children: React.ReactNode }) {
    const map: Record<string, string> = {
        blue: "bg-blue-50 text-blue-700 ring-blue-200 shadow-sm",
        violet: "bg-violet-50 text-violet-700 ring-violet-200 shadow-sm",
        fuchsia: "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200 shadow-sm",
        amber: "bg-amber-50 text-amber-700 ring-amber-200 shadow-sm",
        emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200 shadow-sm",
    }
    return (
        <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold ring-1 ring-inset", map[tone])}>
            {children}
        </span>
    )
}

function summariseAxis(axis: Record<string, any>): string {
    const parts: string[] = []
    if (axis.size) parts.push(axis.size)
    Object.entries(axis.layer_thicknesses || {}).forEach(([k, v]) => parts.push(`L${k}=${v}μ`))
    Object.entries(axis.layer_grades || {}).forEach(([k, v]) => v && parts.push(`L${k}/${v}`))
    if (axis.addons?.length) parts.push(`+${axis.addons.join("+")}`)
    if (axis.packaging) parts.push(axis.packaging)
    if (axis.pod) parts.push(`POD ${axis.pod}`)
    return parts.join(" / ") || "—"
}

function computeCompletedSteps({
    customerId,
    productMasterId,
    sizeCode,
    layerValues,
    quantity,
    deliveryDate,
    artworkMode,
}: any): string[] {
    const out: string[] = []
    if (customerId) out.push("customer")
    if (productMasterId) out.push("master")
    if (sizeCode && Object.keys(layerValues).length) out.push("axes")
    if (quantity > 0 && deliveryDate) out.push("qty")
    if (artworkMode) out.push("artwork")
    return out
}

/**
 * V3.3: render the BOM lines that catalog-backed axes (pod_variant, packaging_inner, …)
 * will produce on submit. Calls productMasterService.resolveCatalogBom and shows each line.
 */
function CatalogBomPreview({
    master,
    axisValues,
    totalPouches,
    overlay,
}: {
    master: ProductMaster
    axisValues: Record<string, any>
    totalPouches: number
    overlay?: any
}) {
    const catalogAxes = (master.variant_axes || []).filter((a: any) => a.master_data_source)
    const { data: lines = [] } = useQuery({
        queryKey: ["catalog-bom", master.id, axisValues, totalPouches, overlay?.id],
        queryFn: () =>
            productMasterService.resolveCatalogBom({
                master,
                axis_values: axisValues,
                total_pouches: totalPouches,
                overlay,
            }),
        enabled: catalogAxes.length > 0,
        staleTime: 0,
    })

    if (catalogAxes.length === 0) return null

    return (
        <div className="rounded-xl border border-emerald-200 bg-gradient-to-br from-emerald-50/60 to-white p-3 ring-1 ring-emerald-100">
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.22em] text-emerald-700">
                <Boxes className="h-3.5 w-3.5" /> Catalog BOM preview
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800">
                    {lines.length} {lines.length === 1 ? "line" : "lines"}
                </span>
            </div>
            <div className="mt-2 space-y-1.5">
                {lines.length === 0 && (
                    <div className="text-[11px] italic text-slate-500">
                        Pick a POD / inner-pack catalog value above to populate the BOM preview.
                    </div>
                )}
                {lines.map((line: any) => (
                    <div key={line.axis} className="flex flex-wrap items-center gap-2 rounded-lg bg-white px-2.5 py-1.5 shadow-sm ring-1 ring-slate-200">
                        <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-violet-700 ring-1 ring-violet-200">
                            {line.axis.replace(/_/g, " ")}
                        </span>
                        <span className="font-mono text-[11px] font-bold text-slate-900">{line.catalog_code}</span>
                        <span className="text-[10px] text-slate-500">
                            from {line.catalog_source.replace(/_/g, " ")}
                        </span>
                        <span className="ml-auto rounded-md bg-slate-900 px-2 py-0.5 font-mono text-[10px] text-emerald-300">
                            {line.required_qty} pcs
                        </span>
                        {line.auto_demand_in_house && line.required_qty > 0 && (
                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-800 ring-1 ring-emerald-200">
                                auto-demand
                            </span>
                        )}
                    </div>
                ))}
            </div>
            <div className="mt-2 flex items-start gap-1.5 text-[10px] text-slate-500">
                <CheckCircle2 className="mt-0.5 h-3 w-3 flex-none text-emerald-600" />
                <span>If stock is short for any line marked <span className="font-semibold text-slate-700">auto-demand</span>, an in-house stock launcher will fire automatically on submit.</span>
            </div>
        </div>
    )
}

"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
    AlertTriangle,
    ArrowLeft,
    Boxes,
    CheckCircle2,
    Disc,
    Loader2,
    Package,
    Palette,
    Plus,
    Save,
    Trash2,
    Workflow,
    X,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { GradientHero } from "@/components/erp-v3/gradient-hero"
import { SectionCardV3 } from "@/components/erp-v3/section-card-v3"
import { ValidationFooter, type CheckLine } from "@/components/erp-v3/validation-footer"
import { LiveBomRail } from "@/components/erp-v3/live-bom-rail"
import { ProductVisual } from "@/components/erp-v3/product-visual"
import { RouteTimeline } from "@/components/erp-v3/route-timeline"
import { templateService } from "@/services/templates"
import { masterDataService, type Material, type PackagingMaterial, type PodSkuVariant, type Addon } from "@/services/master-data"
import { recipeService } from "@/services/recipes"
import { autoRollWidthMm } from "@/lib/product-geometry"
import { SizeGeometryEditor } from "@/components/product-master/size-geometry-editor"
import {
    productMasterService,
    type LayerTemplateRow,
    type PreviewBomRequest,
    type ProductKind,
    type ProductMaster,
    type ProductMasterSize,
    type ReportingGroup,
    type VariantAxisDef,
} from "@/services/product-master"
import {
    LayerAllowedGradePicker,
    LayerDefaultGradeSelect,
    LayerThicknessSelect,
    sanitizeLayerForFilm,
} from "@/components/product-master/layer-master-controls"

interface ProductMasterEditWorkspaceProps {
    productId: string
}

const REPORTING_GROUPS: ReportingGroup[] = [
    "FILM",
    "PRINTED",
    "LAMINATED",
    "SEMI_FG",
    "FG",
    "PACKAGING",
    "POD",
    "OTHER",
]

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
    { axis: "packaging_inner", type: "catalog_ref", label: "Inner packaging", master_data_source: "packaging_material", master_data_filter: { packaging_kind: "INNER_POUCH" } },
    { axis: "packaging_outer", type: "catalog_ref", label: "Outer packaging", master_data_source: "packaging_material", master_data_filter: { packaging_kind: ["GONNY", "SHEET"] } },
    { axis: "pod_variant", type: "catalog_ref", label: "POD variant", master_data_source: "pod_sku_variant" },
    { axis: "artwork_mode", type: "enum", label: "Artwork mode" },
]

/**
 * Legacy axes that still live in some older masters / older seed data:
 *   - `pod`          → canonical `pod_variant`
 *   - `packaging`    → canonical `packaging_inner`
 * Map any axis the master stored under a legacy key to its canonical equivalent
 * so the edit tri-state shows the right state (and patches the right row).
 */
const AXIS_ALIAS: Record<string, string> = {
    pod: "pod_variant",
    pod_ref: "pod_variant",
    packaging: "packaging_inner",
    packaging_ref: "packaging_inner",
}

function canonicalAxisKey(axisKey: string): string {
    return AXIS_ALIAS[axisKey] || axisKey
}

function findAxisOnDraft(axes: VariantAxisDef[] | undefined, canonical: string): VariantAxisDef | undefined {
    if (!axes) return undefined
    return axes.find((a) => canonicalAxisKey(String(a.axis)) === canonical)
}

function axisMode(axis: VariantAxisDef | undefined) {
    if (!axis) return "off"
    return axis.required ? "required" : "optional"
}

function axisModeCopy(mode: "off" | "optional" | "required") {
    if (mode === "required") return "Required in sales/planner before submit."
    if (mode === "optional") return "Can be skipped; if entered it becomes part of matching and BOM."
    return "Not part of this master’s final product tuple."
}

function packagingRuleForRole(role?: string) {
    const canonical = canonicalPackagingRole(role)
    return PACKAGING_ROLE_RULES[canonical] || PACKAGING_ROLE_RULES.EXTRA
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

function firstAxisOption(axis?: VariantAxisDef): string {
    const options = (axis as any)?.options
    if (!Array.isArray(options)) return ""
    for (const option of options) {
        if (typeof option === "string" || typeof option === "number") {
            const value = String(option || "").trim()
            if (value) return value
            continue
        }
        if (option && typeof option === "object") {
            const row = option as Record<string, unknown>
            const value = String(row.code || row.material_code || row.pod_sku_code || row.addon_code || row.id || "").trim()
            if (value) return value
        }
    }
    return ""
}

function axisValuePresent(value: any): boolean {
    if (Array.isArray(value)) return value.length > 0
    if (value && typeof value === "object") return Object.values(value).some((nested) => nested !== "" && nested !== null && nested !== undefined)
    return value !== "" && value !== null && value !== undefined
}

function previewAxisValuesForDraft(master: ProductMaster | null, sizes: ProductMasterSize[]): Record<string, any> {
    if (!master) return {}
    const size = sizes.find((row) => row.active !== false) || sizes[0]
    const values: Record<string, any> = {}
    if (size?.code) values.size = size.code
    for (const axis of master.variant_axes || []) {
        const key = String(axis.axis || "")
        const canonical = canonicalAxisKey(key)
        if (!key || canonical === "size") continue
        if (canonical === "layer_thicknesses") {
            values[key] = Object.fromEntries(master.layer_template.map((row, idx) => [String(idx + 1), row.thickness_micron]))
            continue
        }
        if (canonical === "layer_grades") {
            const allowed = new Set((Array.isArray((axis as any).options) ? (axis as any).options : []).map((option: unknown) => String(option || "").trim()).filter(Boolean))
            const gradeEntries = master.layer_template
                .map((row, idx) => [String(idx + 1), String(row.default_grade || "").trim()] as const)
                .filter(([, grade]) => grade && (!allowed.size || allowed.has(grade)))
            if (gradeEntries.length) values[key] = Object.fromEntries(gradeEntries)
            continue
        }
        if (canonical === "layer_widths") {
            values[key] = Object.fromEntries(
                master.layer_template.map((row, idx) => [String(idx + 1), row.default_input_roll_width_mm || size?.roll_width_mm || size?.width_mm || 0])
            )
            continue
        }
        if (canonical === "addons") {
            values[key] = []
            continue
        }
        const suggested = String((axis as any).default_value || firstAxisOption(axis) || "")
        if (suggested) values[key] = suggested
    }
    return values
}

function previewPackagingSnapshotFromFixed(fixed: Record<string, any>) {
    const podVariant = fixed?.pod_variant || fixed?.pod_variant_id || fixed?.pod_variant_code || ""
    return {
        packaging_lines: Array.isArray(fixed?.packaging_lines) ? fixed.packaging_lines : [],
        pod: fixed?.pod_enabled
            ? {
                  enabled: true,
                  pod_sku_variant_id: podVariant,
                  pod_variant: podVariant,
                  pod_sku_code: fixed?.pod_variant_code || "",
              }
            : { enabled: false },
    }
}

export function ProductMasterEditWorkspace({ productId }: ProductMasterEditWorkspaceProps) {
    const router = useRouter()
    const queryClient = useQueryClient()
    const { toast } = useToast()

    const { data: master, isLoading } = useQuery({
        queryKey: ["product-master", productId],
        queryFn: () => productMasterService.get(productId),
    })
    const { data: sizes } = useQuery({
        queryKey: ["product-master-sizes", productId],
        queryFn: () => productMasterService.listSizes(productId),
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
    const { data: addonCatalog = [] } = useQuery({
        queryKey: ["master-addons"],
        queryFn: masterDataService.getAddons,
        staleTime: 60_000,
    })
    const { data: adhesiveSolvents = [] } = useQuery({
        queryKey: ["master-adhesives-solvents"],
        queryFn: () => masterDataService.getAdhesivesSolvents(),
        staleTime: 60_000,
    })

    const [draft, setDraft] = React.useState<ProductMaster | null>(null)
    const [draftSizes, setDraftSizes] = React.useState<ProductMasterSize[]>([])

    React.useEffect(() => {
        if (master) setDraft(master)
    }, [master])
    React.useEffect(() => {
        if (sizes) setDraftSizes(sizes)
    }, [sizes])

    const previewAxisValues = React.useMemo(() => previewAxisValuesForDraft(draft, draftSizes), [draft, draftSizes])
    const livePreviewPayload = React.useMemo<PreviewBomRequest | null>(() => {
        if (!draft || !draftSizes.length || !draft.template) return null
        return {
            product_master: draft.id,
            template_id: draft.template,
            axis_values: previewAxisValues,
            quantity: String(draft.product_kind || "").toUpperCase() === "ROLL" ? 1000 : 1000,
            quantity_uom: String(draft.product_kind || "").toUpperCase() === "ROLL" ? "KG" : "PCS",
            printing: { enabled: false },
            packaging_snapshot: previewPackagingSnapshotFromFixed(draft.fixed_attributes || {}),
        }
    }, [draft, draftSizes.length, previewAxisValues])
    const livePreviewAxesReady = React.useMemo(() => {
        if (!draft) return false
        return (draft.variant_axes || []).every((axis) => !axis.required || axisValuePresent(previewAxisValues[String(axis.axis || "")]))
    }, [draft, previewAxisValues])
    const { data: livePreview, isFetching: livePreviewLoading, error: livePreviewError } = useQuery({
        queryKey: ["product-master-edit-live-preview", productId, livePreviewPayload],
        queryFn: () => productMasterService.previewBom(livePreviewPayload!),
        enabled: !!livePreviewPayload && !!previewAxisValues.size && !!draft?.layer_template?.length && livePreviewAxesReady,
        retry: false,
        staleTime: 15_000,
    })

    const updateMutation = useMutation({
        mutationFn: () =>
            productMasterService.update(productId, {
                code: draft?.code,
                name: draft?.name,
                product_kind: draft?.product_kind,
                template: draft?.template,
                default_template: draft?.template || draft?.default_template || null,
                default_reporting_group: draft?.default_reporting_group,
                reusable_policy: draft?.reusable_policy,
                layer_template: draft?.layer_template,
                variant_axes: draft?.variant_axes,
                fixed_attributes: draft?.fixed_attributes,
                description: draft?.description,
                active: draft?.active,
            }),
        onSuccess: async () => {
            const draftIds = new Set(draftSizes.map((s) => s.id).filter(Boolean))
            for (const existing of sizes || []) {
                if (existing.id && !draftIds.has(existing.id)) await productMasterService.deleteSize(existing.id)
            }
            for (const s of draftSizes) {
                await productMasterService.saveSize(productId, s)
            }
            queryClient.invalidateQueries({ queryKey: ["product-master", productId] })
            queryClient.invalidateQueries({ queryKey: ["product-master-sizes", productId] })
            queryClient.invalidateQueries({ queryKey: ["product-master-template", productId] })
            queryClient.invalidateQueries({ queryKey: ["product-masters"] })
            toast({ title: "Master saved", description: "Sales & planner can pick it up immediately." })
            router.push(`/master/products/${productId}`)
        },
        onError: (err: any) => {
            toast({ title: "Save failed", description: err?.message || "Try again", variant: "destructive" })
        },
    })

    if (isLoading || !draft) {
        return (
            <div className="space-y-3">
                <div className="h-32 animate-pulse rounded-3xl bg-slate-100" />
                <div className="h-72 animate-pulse rounded-2xl bg-slate-100" />
            </div>
        )
    }

    const checks: CheckLine[] = computeChecks(draft, draftSizes, filmVariants)
    const totalThickness = draft.layer_template.reduce((s, l) => s + l.thickness_micron, 0)
    const errorCount = checks.filter((c) => !c.ok && c.tone !== "warn").length
    const routeSteps = (routeInfo?.route_steps || []).map((step) => ({
        index: step.index,
        label: step.name || step.process_code || `Step ${step.index}`,
        transition: step.transition,
        tag: step.roll_behavior,
        artwork_step: !!step.has_artwork,
    }))
    const isMultiLayer = draft.layer_template.length > 1
    const adhesiveOptions = adhesiveSolvents.filter((m: Material) => String(m.category || "").toUpperCase() === "ADHESIVE")
    const solventOptions = adhesiveSolvents.filter((m: Material) => String(m.category || "").toUpperCase() === "SOLVENT")
    const addonsAxisMode = axisMode(findAxisOnDraft(draft.variant_axes, "addons")) as "off" | "optional" | "required"

    function patchDraft(patch: Partial<ProductMaster>) {
        setDraft((d) => (d ? { ...d, ...patch } : d))
    }
    function patchFixed(patch: Record<string, any>) {
        setDraft((d) => {
            if (!d) return d
            const nextFixed = { ...(d.fixed_attributes || {}), ...patch }
            let nextAxes = d.variant_axes
            // Keep the artwork_mode axis in sync with the Printing contract toggles
            // so section 4's grid and section 5's switches never disagree:
            //   print_capable=false               → artwork_mode OFF (removed)
            //   print_capable=true, art_req=false → artwork_mode OPTIONAL
            //   print_capable=true, art_req=true  → artwork_mode REQUIRED
            if ("print_capable" in patch || "artwork_required" in patch) {
                const printOn = !!nextFixed.print_capable
                const artReq = !!nextFixed.artwork_required
                const without = nextAxes.filter((a) => canonicalAxisKey(String(a.axis)) !== "artwork_mode")
                if (!printOn) {
                    nextAxes = without
                } else {
                    const def = AXIS_DEFS.find((a) => String(a.axis) === "artwork_mode")!
                    nextAxes = [...without, { ...def, required: artReq }]
                }
            }
            return { ...d, fixed_attributes: nextFixed, variant_axes: nextAxes }
        })
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
            return {
                ...d,
                layer_template: [
                    ...d.layer_template,
                    {
                        role: `layer-${d.layer_template.length + 1}`,
                        film_variant_code: "",
                        thickness_micron: 0,
                        thickness_apportion: "per_layer",
                    },
                ],
            }
        })
    }
    function removeLayer(idx: number) {
        setDraft((d) => {
            if (!d) return d
            return { ...d, layer_template: d.layer_template.filter((_, i) => i !== idx) }
        })
    }
    function patchAxis(axis: VariantAxisDef["axis"], required: boolean, included: boolean) {
        setDraft((d) => {
            if (!d) return d
            const canonical = canonicalAxisKey(String(axis))
            // Match by canonical key so a master that stored the legacy `pod` /
            // `packaging` axis name is updated in-place instead of duplicated.
            const has = d.variant_axes.some((a) => canonicalAxisKey(String(a.axis)) === canonical)
            if (!included) {
                return { ...d, variant_axes: d.variant_axes.filter((a) => canonicalAxisKey(String(a.axis)) !== canonical) }
            }
            const def = AXIS_DEFS.find((a) => String(a.axis) === canonical)!
            const next = has
                ? d.variant_axes.map((a) => (canonicalAxisKey(String(a.axis)) === canonical ? { ...a, required } : a))
                : [...d.variant_axes, { ...def, required }]
            return { ...d, variant_axes: next }
        })
    }
    /**
     * Patch the `options` (allowed catalog codes) array on a catalog-backed axis.
     * Ensures the axis row exists in variant_axes (cloned from AXIS_DEFS) before
     * applying the new options array. Matches by canonical key so legacy
     * `pod`/`packaging` axes are also updated in place.
     */
    function patchAxisOptions(axis: VariantAxisDef["axis"], options: string[]) {
        setDraft((d) => {
            if (!d) return d
            const canonical = canonicalAxisKey(String(axis))
            const has = d.variant_axes.some((a) => canonicalAxisKey(String(a.axis)) === canonical)
            const def = AXIS_DEFS.find((a) => String(a.axis) === canonical)
            if (has) {
                return {
                    ...d,
                    variant_axes: d.variant_axes.map((a) =>
                        canonicalAxisKey(String(a.axis)) === canonical
                            ? ({ ...a, options } as VariantAxisDef)
                            : a,
                    ),
                }
            }
            if (!def) return d
            return { ...d, variant_axes: [...d.variant_axes, { ...def, options } as VariantAxisDef] }
        })
    }
    function toggleAxisOptionCode(axis: VariantAxisDef["axis"], code: string) {
        const canonical = canonicalAxisKey(String(axis))
        const found = draft ? findAxisOnDraft(draft.variant_axes, canonical) : undefined
        const current: string[] = Array.isArray((found as any)?.options) ? ((found as any).options as any[]).map(String) : []
        const next = current.includes(code) ? current.filter((c) => c !== code) : [...current, code]
        patchAxisOptions(axis, next)
    }
    function setAxisFlags(axis: VariantAxisDef["axis"], patch: { required?: boolean; auto_demand_in_house?: boolean }) {
        setDraft((d) => {
            if (!d) return d
            const canonical = canonicalAxisKey(String(axis))
            const has = d.variant_axes.some((a) => canonicalAxisKey(String(a.axis)) === canonical)
            if (!has) {
                const def = AXIS_DEFS.find((a) => String(a.axis) === canonical)
                if (!def) return d
                return { ...d, variant_axes: [...d.variant_axes, { ...def, ...patch } as VariantAxisDef] }
            }
            return {
                ...d,
                variant_axes: d.variant_axes.map((a) =>
                    canonicalAxisKey(String(a.axis)) === canonical ? ({ ...a, ...patch } as VariantAxisDef) : a,
                ),
            }
        })
    }
    function patchSize(idx: number, patch: Partial<ProductMasterSize>) {
        setDraftSizes((arr) => {
            const next = [...arr]
            next[idx] = { ...next[idx], ...patch }
            return next
        })
    }
    function addSize() {
        const isRoll = String(draft?.product_kind || "").toUpperCase() === "ROLL" || String(draft?.product_kind || "").toUpperCase() === "POD"
        setDraftSizes((arr) => [
            ...arr,
            {
                id: `tmp-${Math.random().toString(36).slice(2, 8)}`,
                product_master: productId,
                code: `SZ-${arr.length + 1}`,
                label: `Size ${arr.length + 1}`,
                width_mm: 0,
                height_mm: isRoll ? 0 : 0,
                gusset_mm: 0,
                roll_width_mm: null,
                thickness_micron: null,
                standard_qty: null,
                pouch_style: isRoll ? "" : "STAND_UP",
                roll_form: isRoll ? "FLAT" : "",
                faces: isRoll ? 1 : 2,
                trim_loss_mm: 10,
                trim_apply_to: "WIDTH",
                flap_tape_mm: 0,
                gusset_apply_to: "HEIGHT",
                gusset_factor: 1,
                adjustments: [],
                geometry_config: isRoll
                    ? { roll_form: "FLAT", trim_loss_mm: 10, trim_apply_to: "WIDTH", adjustments: [], multipliers: { faces: 1 } }
                    : { pouch_style: "STAND_UP", trim_loss_mm: 10, trim_apply_to: "WIDTH", flap_tape_mm: 0, gusset_apply_to: "HEIGHT", gusset_factor: 1, adjustments: [], multipliers: { faces: 2 } },
                qty_uom: "KG",
                notes: "",
                active: true,
                sort_order: arr.length + 1,
            },
        ])
    }
    function removeSize(idx: number) {
        setDraftSizes((arr) => arr.filter((_, i) => i !== idx))
    }
    function patchPackagingLine(idx: number, patch: Record<string, any>) {
        const lines = [...((draft?.fixed_attributes?.packaging_lines || []) as any[])]
        lines[idx] = { ...lines[idx], ...patch }
        patchFixed({ packaging_lines: lines })
    }
    function addPackagingLine() {
        const role = packagingRolesForProduct(draft?.product_kind)[0]
        const material = packagingMaterials.find((m: PackagingMaterial) => packagingMaterialAllowed(m, role, draft?.product_kind)) || null
        patchFixed({
            packaging_lines: [
                ...((draft?.fixed_attributes?.packaging_lines || []) as any[]),
                normalizePackagingLine({
                    role,
                    material: material?.id || null,
                    material_code: material?.code || "",
                    uom: material?.base_uom || "PCS",
                }, role, material),
            ],
        })
    }
    function removePackagingLine(idx: number) {
        patchFixed({
            packaging_lines: ((draft?.fixed_attributes?.packaging_lines || []) as any[]).filter((_, i) => i !== idx),
        })
    }
    function patchChemistryMaterial(kind: "adhesive" | "solvent", value: string) {
        const options = kind === "adhesive" ? adhesiveOptions : solventOptions
        const picked = options.find((m: Material) => m.id === value || m.code === value)
        const prefix = kind
        if (!picked) {
            patchFixed({
                [`${prefix}_material_id`]: null,
                [`${prefix}_material_code`]: "",
                [`${prefix}_material_name`]: "",
                [`${prefix}_gsm`]: "",
            })
            return
        }
        patchFixed({
            [`${prefix}_material_id`]: picked.id,
            [`${prefix}_material_code`]: picked.code,
            [`${prefix}_material_name`]: picked.name,
        })
    }

    return (
        <div className="space-y-6">
            <GradientHero
                eyebrow={`Master · Edit · ${draft.code}`}
                title={draft.name || "Untitled product master"}
                subtitle="The full engineering contract — route, sizes, layers, axes, printing, packaging. Sales & planner read every change immediately."
                palette="violet"
                tone="subtle"
                chips={[
                    { label: "Layers", value: `${draft.layer_template.length}`, icon: <Boxes className="h-3.5 w-3.5" /> },
                    { label: "Sizes", value: `${draftSizes.length}` },
                    { label: "Axes", value: `${draft.variant_axes.length}`, icon: <Workflow className="h-3.5 w-3.5" /> },
                    { label: "Total thickness", value: `${totalThickness} μ` },
                    {
                        label: "Active",
                        value: draft.active ? "Yes" : "No",
                        tone: draft.active ? "ok" : "warn",
                    },
                ]}
                actions={
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => router.push(`/master/products/${productId}`)}
                        className="gap-1 rounded-full border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                    >
                        <ArrowLeft className="h-3.5 w-3.5" /> Back
                    </Button>
                }
            />

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_400px]">
                <div className="space-y-6">
                    <SectionCardV3 index={1} title="Header & live route" description="The stable identity that sales & planner read." accent="blue">
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <div>
                                <Label className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">
                                    Master code
                                </Label>
                                <Input
                                    value={draft.code}
                                    onChange={(e) => patchDraft({ code: e.target.value.toUpperCase() })}
                                    className="mt-1 h-10 rounded-xl"
                                />
                            </div>
                            <div>
                                <Label className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">
                                    Reporting group
                                </Label>
                                <Select
                                    value={draft.default_reporting_group}
                                    onValueChange={(v) => patchDraft({ default_reporting_group: v as ReportingGroup })}
                                >
                                    <SelectTrigger className="mt-1 h-10 rounded-xl">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {REPORTING_GROUPS.map((g) => (
                                            <SelectItem key={g} value={g}>
                                                {g}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="sm:col-span-2">
                                <Label className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">
                                    Master name
                                </Label>
                                <Input
                                    value={draft.name}
                                    onChange={(e) => patchDraft({ name: e.target.value })}
                                    className="mt-1 h-10 rounded-xl"
                                />
                            </div>
                            <div>
                                <Label className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">
                                    Product kind
                                </Label>
                                <Select
                                    value={draft.product_kind}
                                    onValueChange={(v) => patchDraft({ product_kind: v as ProductKind })}
                                >
                                    <SelectTrigger className="mt-1 h-10 rounded-xl">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {(["POUCH", "ROLL", "PACKAGING", "POD", "OTHER"] as ProductKind[]).map((k) => (
                                            <SelectItem key={k} value={k}>
                                                {k}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div>
                                <Label className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">
                                    Live route / template
                                </Label>
                                <Select
                                    value={draft.template || ""}
                                    onValueChange={(v) =>
                                        patchDraft({
                                            template: v,
                                            template_name: templates.find((t: any) => t.id === v)?.name,
                                        })
                                    }
                                >
                                    <SelectTrigger className="mt-1 h-10 rounded-xl">
                                        <SelectValue placeholder="Pick a live template" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {templates.map((t: any) => (
                                            <SelectItem key={t.id} value={t.id}>
                                                {t.name || t.code}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="sm:col-span-2">
                                <Label className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">
                                    Description
                                </Label>
                                <Textarea
                                    value={draft.description || ""}
                                    onChange={(e) => patchDraft({ description: e.target.value })}
                                    className="mt-1 min-h-[64px] rounded-xl"
                                />
                            </div>
                            <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2 sm:col-span-2">
                                <div>
                                    <div className="text-sm font-bold text-slate-900">Active</div>
                                    <div className="text-[11px] text-slate-500">
                                        Sales and planner can pick this master right after save.
                                    </div>
                                </div>
                                <Switch checked={draft.active} onCheckedChange={(v) => patchDraft({ active: v })} />
                            </div>
                        </div>

                        <div className="mt-5">
                            <div className="mb-2 flex items-center justify-between">
                                <Label className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">
                                    Live route preview
                                </Label>
                                <span className="text-[11px] text-slate-500">
                                    Process names come from the live template.
                                </span>
                            </div>
                            {routeSteps.length ? (
                                <RouteTimeline
                                    steps={routeSteps}
                                    helperText="Highlight the artwork-bearing step. Stop step controls planner stock commitment."
                                />
                            ) : (
                                <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                                    <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
                                    <span>
                                        {draft.template
                                            ? "Template is bound, but it has no route steps published yet. Publish/sync route steps on the template before using this master for production."
                                            : "Pick a live route template so sales, planner, WCM, and BOM can resolve the same process path."}
                                    </span>
                                </div>
                            )}
                        </div>
                    </SectionCardV3>

                    {isMultiLayer ? (
                        <SectionCardV3
                            index={2}
                            title="Adhesive & solvent defaults"
                            description="One adhesive and one solvent per master. GSM is fixed here and flows into live BOM, sales orders, WIP, and dispatch consumption."
                            accent="emerald"
                        >
                            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                                <div className="rounded-xl border border-slate-200 bg-white p-3">
                                    <div className="mb-3 flex items-start gap-2">
                                        <Package className="mt-0.5 h-4 w-4 text-emerald-600" />
                                        <div>
                                            <div className="text-sm font-black text-slate-900">Adhesive</div>
                                            <div className="text-[11px] text-slate-500">Consumed from selected adhesive master by GSM × area.</div>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-3">
                                        <div>
                                            <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Material</Label>
                                            <Select
                                                value={draft.fixed_attributes?.adhesive_material_id || "__none__"}
                                                onValueChange={(v) => patchChemistryMaterial("adhesive", v === "__none__" ? "" : v)}
                                            >
                                                <SelectTrigger className="mt-1 h-9 rounded-xl text-xs">
                                                    <SelectValue placeholder="Select adhesive" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="__none__">No adhesive</SelectItem>
                                                    {adhesiveOptions.map((m: Material) => (
                                                        <SelectItem key={m.id || m.code} value={m.id || m.code}>
                                                            {m.code} · {m.name}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div>
                                            <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">GSM</Label>
                                            <Input
                                                type="number"
                                                min="0"
                                                step="0.01"
                                                className="mt-1 h-9 rounded-xl text-right text-xs"
                                                value={draft.fixed_attributes?.adhesive_gsm ?? ""}
                                                onChange={(e) => patchFixed({ adhesive_gsm: e.target.value === "" ? "" : Number(e.target.value) })}
                                            />
                                        </div>
                                    </div>
                                    {draft.fixed_attributes?.adhesive_material_code ? (
                                        <div className="mt-2 rounded-lg bg-emerald-50 px-2 py-1.5 text-[11px] font-semibold text-emerald-800">
                                            {draft.fixed_attributes.adhesive_material_code} · {draft.fixed_attributes.adhesive_gsm || 0} GSM
                                        </div>
                                    ) : null}
                                </div>

                                <div className="rounded-xl border border-slate-200 bg-white p-3">
                                    <div className="mb-3 flex items-start gap-2">
                                        <Disc className="mt-0.5 h-4 w-4 text-cyan-600" />
                                        <div>
                                            <div className="text-sm font-black text-slate-900">Solvent</div>
                                            <div className="text-[11px] text-slate-500">Consumed from selected solvent master by GSM × area.</div>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-3">
                                        <div>
                                            <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Material</Label>
                                            <Select
                                                value={draft.fixed_attributes?.solvent_material_id || "__none__"}
                                                onValueChange={(v) => patchChemistryMaterial("solvent", v === "__none__" ? "" : v)}
                                            >
                                                <SelectTrigger className="mt-1 h-9 rounded-xl text-xs">
                                                    <SelectValue placeholder="Select solvent" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="__none__">No solvent</SelectItem>
                                                    {solventOptions.map((m: Material) => (
                                                        <SelectItem key={m.id || m.code} value={m.id || m.code}>
                                                            {m.code} · {m.name}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div>
                                            <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">GSM</Label>
                                            <Input
                                                type="number"
                                                min="0"
                                                step="0.01"
                                                className="mt-1 h-9 rounded-xl text-right text-xs"
                                                value={draft.fixed_attributes?.solvent_gsm ?? ""}
                                                onChange={(e) => patchFixed({ solvent_gsm: e.target.value === "" ? "" : Number(e.target.value) })}
                                            />
                                        </div>
                                    </div>
                                    {draft.fixed_attributes?.solvent_material_code ? (
                                        <div className="mt-2 rounded-lg bg-cyan-50 px-2 py-1.5 text-[11px] font-semibold text-cyan-800">
                                            {draft.fixed_attributes.solvent_material_code} · {draft.fixed_attributes.solvent_gsm || 0} GSM
                                        </div>
                                    ) : null}
                                </div>
                            </div>
                        </SectionCardV3>
                    ) : null}

                    <SectionCardV3
                        index={3}
                        title="Size / geometry axis"
                        description="Final product W/H/Gusset only. Total thickness comes from layers; roll width comes from override or the custom geometry rule."
                        accent="emerald"
                        actions={
                            <Button size="sm" variant="outline" className="rounded-full" onClick={addSize}>
                                <Plus className="mr-1 h-3.5 w-3.5" /> Add size
                            </Button>
                        }
                    >
                        {draftSizes.length === 0 ? (
                            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/40 p-6 text-center text-sm text-slate-500">
                                No sizes yet. Add at least one for sales/planner to use this master.
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {draftSizes.map((row, i) => (
                                    <div key={row.id || i} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                                        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                                            <div>
                                                <div className="text-sm font-black text-slate-900">{row.code || `Size ${i + 1}`}</div>
                                                <div className="text-xs text-slate-500">Final size plus exact geometry math for BOM, roll width, and stock matching.</div>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <div className="flex items-center gap-2 rounded-full bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
                                                    <Switch checked={row.active} onCheckedChange={(v) => patchSize(i, { active: v })} />
                                                    {row.active ? "Active" : "Inactive"}
                                                </div>
                                                <button type="button" onClick={() => removeSize(i)} className="rounded-lg p-2 text-rose-600 hover:bg-rose-50">
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </button>
                                            </div>
                                        </div>
                                        <SizeGeometryEditor row={row} kind={draft.product_kind} onPatch={(patch) => patchSize(i, patch)} />
                                    </div>
                                ))}
                            </div>
                        )}
                    </SectionCardV3>

                    <SectionCardV3
                        index={4}
                        title="Layer template (per layer, not global)"
                        description="Fixed layer structure for this master. Thickness and allowed grades are per layer; no global thickness or grade."
                        accent="blue"
                        actions={
                            <Button size="sm" variant="outline" className="rounded-full" onClick={addLayer}>
                                <Plus className="mr-1 h-3.5 w-3.5" /> Add layer
                            </Button>
                        }
                    >
                        <div className="overflow-hidden rounded-xl border border-slate-200">
                            <table className="w-full text-sm">
                                <thead className="bg-slate-50/80 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                                    <tr>
                                        <th className="px-3 py-2 text-left">Layer</th>
                                        <th className="px-3 py-2 text-left">Film variant</th>
                                        <th className="px-3 py-2 text-left">Thickness (μ)</th>
                                        <th className="px-3 py-2 text-left">Default grade</th>
                                        <th className="px-3 py-2 text-left">Allowed grades</th>
                                        <th className="px-3 py-2 text-right">Layer roll W override</th>
                                        <th className="px-3 py-2" />
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {draft.layer_template.map((row, i) => (
                                        <tr key={i} className="bg-white">
                                            <td className="px-3 py-2 font-bold text-slate-800">L{i + 1}</td>
                                            <td className="px-2 py-1">
                                                {filmVariants.length ? (
                                                    <Select
                                                        value={row.film_variant_id || row.film_variant_code || ""}
                                                        onValueChange={(v) => {
                                                            const picked = filmVariants.find((m: Material) => m.id === v || m.code === v)
                                                            patchLayer(i, sanitizeLayerForFilm(row, picked, grades, recipes))
                                                        }}
                                                    >
                                                        <SelectTrigger className="h-8 rounded-md text-xs">
                                                            <SelectValue placeholder="Select film" />
                                                        </SelectTrigger>
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
                                            </td>
                                            <td className="px-2 py-1">
                                                <LayerThicknessSelect
                                                    layer={row}
                                                    films={filmVariants}
                                                    recipes={recipes}
                                                    onChange={(patch) => patchLayer(i, patch)}
                                                />
                                            </td>
                                            <td className="px-2 py-1">
                                                <LayerDefaultGradeSelect
                                                    layer={row}
                                                    films={filmVariants}
                                                    grades={grades}
                                                    recipes={recipes}
                                                    onChange={(patch) => patchLayer(i, patch)}
                                                />
                                            </td>
                                            <td className="px-2 py-1">
                                                <LayerAllowedGradePicker
                                                    layer={row}
                                                    films={filmVariants}
                                                    grades={grades}
                                                    recipes={recipes}
                                                    onChange={(patch) => patchLayer(i, patch)}
                                                />
                                            </td>
                                            <td className="px-2 py-1">
                                                <Input
                                                    type="number"
                                                    className="h-8 rounded-md text-right text-xs"
                                                    placeholder="fallback"
                                                    value={row.default_input_roll_width_mm || ""}
                                                    onChange={(e) => patchLayer(i, { default_input_roll_width_mm: e.target.value ? Number(e.target.value) : null })}
                                                />
                                            </td>
                                            <td className="px-2 py-1 text-right">
                                                <button
                                                    type="button"
                                                    onClick={() => removeLayer(i)}
                                                    className="rounded-md p-1.5 text-rose-600 hover:bg-rose-50"
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-500">
                            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                            Total default thickness <strong className="ml-1 text-slate-700">{totalThickness} μ</strong>. No global thickness or grade — per-layer only.
                        </p>
                    </SectionCardV3>

                    <SectionCardV3
                        index={5}
                        title="Variant axes"
                        description="Off = never asked. Optional = can be skipped; if used it affects matching/BOM. Required = sales/planner must enter it."
                        accent="violet"
                    >
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            {AXIS_DEFS.filter((d) => d.axis !== "artwork_mode").map((def) => {
                                // Alias-aware: a master storing the legacy `pod` / `packaging`
                                // axis name still resolves to the canonical `pod_variant` /
                                // `packaging_inner` card so the tri-state reflects reality.
                                // artwork_mode is hidden here because it's a derived axis —
                                // its required/optional/off state always mirrors the Printing
                                // contract toggles in section 5. We keep them in sync in patchFixed.
                                const found = findAxisOnDraft(draft.variant_axes, String(def.axis))
                                const mode = axisMode(found)
                                return (
                                    <div
                                        key={def.axis}
                                        className={cn(
                                            "rounded-xl border bg-white px-3 py-2.5",
                                            mode === "required" && "border-blue-300 ring-1 ring-blue-100",
                                            mode === "optional" && "border-violet-200 ring-1 ring-violet-50",
                                            mode === "off" && "border-slate-200"
                                        )}
                                    >
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
                                            <button
                                                type="button"
                                                onClick={() => patchAxis(def.axis, false, false)}
                                                className={cn("rounded-full px-2 py-1 text-[10px] font-bold uppercase", mode === "off" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500")}
                                            >
                                                Off
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => patchAxis(def.axis, false, true)}
                                                className={cn("rounded-full px-2 py-1 text-[10px] font-bold uppercase", mode === "optional" ? "bg-white text-violet-700 shadow-sm" : "text-slate-500")}
                                            >
                                                Optional
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => patchAxis(def.axis, true, true)}
                                                className={cn("rounded-full px-2 py-1 text-[10px] font-bold uppercase", mode === "required" ? "bg-blue-600 text-white shadow-sm" : "text-slate-500")}
                                            >
                                                Required
                                            </button>
                                        </div>
                                        <div className="mt-2 text-[11px] text-slate-500">{axisModeCopy(mode as "off" | "optional" | "required")}</div>
                                    </div>
                                )
                            })}
                        </div>
                    </SectionCardV3>

                    <SectionCardV3 index={6} title="Printing contract" description="Only controls whether printing is possible and whether approved artwork is mandatory." accent="violet">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <ToggleRow
                                label="Print capable"
                                description="Sales can attach artwork/colorway or warning-print instructions."
                                checked={!!draft.fixed_attributes?.print_capable}
                                onChange={(v) => patchFixed({ print_capable: v })}
                            />
                            <ToggleRow
                                label="Artwork required"
                                description="Block production release until an approved artwork/colorway is selected."
                                checked={!!draft.fixed_attributes?.artwork_required}
                                onChange={(v) => patchFixed({ artwork_required: v })}
                            />
                        </div>
                        <div className="mt-4 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs text-emerald-800">
                            <Disc className="mt-0.5 h-4 w-4 flex-none" />
                            <span>
                                <strong>Artwork-driven:</strong> method, sheet/tubing form, colors, ink mapping, and cylinder gate come from the approved artwork/colorway selected on the order or before planner release.
                            </span>
                        </div>
                    </SectionCardV3>

                    <SectionCardV3
                        index={7}
                        title="Always-consumed packaging & POD"
                        description="Locked at master — consumed on every order automatically, no sales decision. Use this for packaging that never varies by customer or order."
                        accent="emerald"
                        actions={
                            <Button size="sm" variant="outline" className="rounded-full" onClick={addPackagingLine}>
                                <Plus className="mr-1 h-3.5 w-3.5" /> Add packaging
                            </Button>
                        }
                    >
                        <div className="space-y-3">
                            {((draft.fixed_attributes?.packaging_lines || []) as any[]).length ? (
                                ((draft.fixed_attributes?.packaging_lines || []) as any[]).map((line, i) => (
                                    <div key={i} className="rounded-xl border border-slate-200 bg-white p-3">
                                        <div className="mb-2 flex items-center justify-between">
                                            <span className="text-xs font-bold text-slate-700">Packaging line {i + 1}</span>
                                            <button type="button" onClick={() => removePackagingLine(i)} className="rounded-md p-1 text-rose-600 hover:bg-rose-50">
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </button>
                                        </div>
                                        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                                            <div>
                                                <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Role</Label>
                                                <Select value={canonicalPackagingRole(line.role)} onValueChange={(v) => patchPackagingLine(i, normalizePackagingLine(line, v))}>
                                                    <SelectTrigger className="mt-1 h-8 rounded-lg text-xs"><SelectValue /></SelectTrigger>
                                                    <SelectContent>
                                                        {packagingRolesForProduct(draft.product_kind).map((r) => (
                                                            <SelectItem key={r} value={r}>{PACKAGING_ROLE_RULES[r].menuLabel}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <div className="lg:col-span-2">
                                                <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Packaging SKU</Label>
                                                {packagingMaterials.length ? (
                                                    <Select
                                                        value={line.material || line.material_code || ""}
                                                        onValueChange={(v) => {
                                                            const picked = packagingMaterials.find((m: PackagingMaterial) => m.id === v || m.code === v)
                                                            patchPackagingLine(i, normalizePackagingLine({
                                                                ...line,
                                                                material: picked?.id || null,
                                                                material_code: (picked?.code || v).toUpperCase(),
                                                                uom: picked?.base_uom || line.uom || "PCS",
                                                                supply_mode: picked?.packaging_supply_mode,
                                                                kind: picked?.packaging_kind,
                                                            }, line.role, picked))
                                                        }}
                                                    >
                                                        <SelectTrigger className="mt-1 h-8 rounded-lg text-xs"><SelectValue placeholder="Select packaging SKU" /></SelectTrigger>
                                                        <SelectContent>
                                                            {packagingMaterials
                                                                .filter((m: PackagingMaterial) => packagingMaterialAllowed(m, line.role, draft.product_kind))
                                                                .map((m: PackagingMaterial) => (
                                                                <SelectItem key={m.id || m.code} value={m.id || m.code}>{m.code} · {m.name}</SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                ) : (
                                                    <Input className="mt-1 h-8 rounded-lg text-xs" value={line.material_code || ""} onChange={(e) => patchPackagingLine(i, { material_code: e.target.value.toUpperCase() })} />
                                                )}
                                            </div>
                                            <div>
                                                <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">
                                                    {canonicalPackagingRole(line.role) === "PRIMARY_INNER" ? "Pcs per inner" : "Consumption"}
                                                </Label>
                                                {canonicalPackagingRole(line.role) === "PRIMARY_INNER" ? (
                                                    <Input
                                                        type="number"
                                                        min="1"
                                                        className="mt-1 h-8 rounded-lg text-xs"
                                                        value={line.pcs_per_pack || ""}
                                                        placeholder="e.g. 100"
                                                        onChange={(e) => patchPackagingLine(i, normalizePackagingLine({ ...line, pcs_per_pack: Number(e.target.value) }, "PRIMARY_INNER"))}
                                                    />
                                                ) : (
                                                    <div className="mt-1 flex h-8 items-center rounded-lg border border-slate-200 bg-slate-50 px-2 text-[11px] font-bold text-slate-600">
                                                        {packagingRuleForRole(line.role).label}
                                                    </div>
                                                )}
                                            </div>
                                            <div>
                                                <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Rule</Label>
                                                <div className="mt-1 rounded-lg border border-emerald-100 bg-emerald-50 px-2 py-1.5 text-[11px] font-semibold leading-4 text-emerald-800">
                                                    {packagingRuleForRole(line.role).hint}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))
                            ) : (
                                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-5 text-sm text-slate-500">
                                    No allowed packing SKUs yet. Add inner-pouch options, gonny options, or tape/sheet/tag SKUs here only as allowed materials; consumption is automatic from packing flow or evening open-close.
                                </div>
                            )}

                            <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-3">
                                <ToggleRow
                                    label="POD required"
                                    description="Links a POD SKU variant as a BOM item; POD stock can be produced in-house from its own Product Master."
                                    checked={!!draft.fixed_attributes?.pod_enabled}
                                    onChange={(v) => patchFixed({ pod_enabled: v })}
                                />
                                {draft.fixed_attributes?.pod_enabled ? (
                                    <div className="mt-3">
                                        <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">POD SKU variant</Label>
                                        {podVariants.length ? (
                                            <Select
                                                value={draft.fixed_attributes?.pod_variant || draft.fixed_attributes?.pod_variant_code || ""}
                                                onValueChange={(v) => {
                                                    const picked = podVariants.find((p: PodSkuVariant) => p.id === v || p.code === v)
                                                    patchFixed({
                                                        pod_variant: picked?.id || null,
                                                        pod_variant_code: picked?.code || v,
                                                        pod_material: picked?.material || null,
                                                        pod_material_code: picked?.material_code,
                                                        pod_profile: picked?.name || picked?.code || v,
                                                    })
                                                }}
                                            >
                                                <SelectTrigger className="mt-1 h-9 rounded-xl text-xs"><SelectValue placeholder="Select POD SKU variant" /></SelectTrigger>
                                                <SelectContent>
                                                    {podVariants.map((p: PodSkuVariant) => (
                                                        <SelectItem key={p.id || p.code} value={p.id || p.code}>{p.code} · {p.name}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        ) : (
                                            <Input className="mt-1 h-9 rounded-xl text-xs" value={draft.fixed_attributes?.pod_profile || ""} onChange={(e) => patchFixed({ pod_profile: e.target.value })} />
                                        )}
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    </SectionCardV3>

                    <SectionCardV3
                        index={8}
                        title="Sales-pickable menu (customer/order choice)"
                        description="Catalog SKUs sales is allowed to pick from when building an order. Pick-1 axes (inner, gunny, POD) — sales must choose one. Pick-many axes (sheets/EOD extras, add-ons) — sales may pick zero or more."
                        accent="violet"
                    >
                        <AxisAllowedRegistry
                            draft={draft}
                            packagingMaterials={packagingMaterials}
                            podVariants={podVariants}
                            addonCatalog={addonCatalog}
                            onToggleCode={toggleAxisOptionCode}
                            onSetAxisFlags={setAxisFlags}
                            onPatchOptions={patchAxisOptions}
                        />
                    </SectionCardV3>
                </div>

                <aside className="space-y-4">
                    <SectionCardV3 title="Live anatomy" description="Visualises your draft in real time." accent="emerald">
                        <ProductVisual
                            kind={draft.product_kind}
                            layers={draft.layer_template}
                            width_mm={draftSizes[0]?.width_mm}
                            height_mm={draftSizes[0]?.height_mm}
                            gusset_mm={draftSizes[0]?.gusset_mm}
                            roll_width_mm={draftSizes[0]?.roll_width_mm || autoRollWidthMm(draftSizes[0] || {}, draft.product_kind)}
                            addons={draft.fixed_attributes?.print_capable ? ["PRINT"] : []}
                            title="Draft"
                            subtitle={`${draft.layer_template.length} layers · ${totalThickness}μ`}
                        />
                    </SectionCardV3>

                    <LiveBomRail
                        title="Live preview"
                        subtitle="Backend preview from saved master + first active size"
                        preview={livePreview || null}
                        loading={livePreviewLoading}
                        scope="variant"
                        masterFlags={{
                            print_capable: !!draft.fixed_attributes?.print_capable,
                            pod_locked: !!(draft.fixed_attributes?.pod_enabled && (draft.fixed_attributes?.pod_variant || draft.fixed_attributes?.pod_variant_code)),
                            addons_axis: addonsAxisMode,
                        }}
                        badge={livePreviewError ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 ring-1 ring-amber-200">
                                <AlertTriangle className="h-3 w-3" /> preview needs save/axes
                            </span>
                        ) : undefined}
                    />
                </aside>
            </div>

            <ValidationFooter
                checks={checks}
                autosaveLabel="Draft synced"
                primaryActions={
                    <Button onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending || errorCount > 0} className="gap-1.5 rounded-xl">
                        {updateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        Save master
                    </Button>
                }
                secondaryActions={
                    <Button
                        variant="outline"
                        onClick={() => router.push(`/master/products/${productId}`)}
                        className="rounded-xl"
                    >
                        Cancel
                    </Button>
                }
            />
        </div>
    )
}

function computeChecks(draft: ProductMaster, sizes: ProductMasterSize[], films: Material[]): CheckLine[] {
    const out: CheckLine[] = [
        { label: "Master code & name", ok: !!draft.code && !!draft.name, tone: "error" },
        { label: "Live route/template selected", ok: !!draft.template, tone: "error" },
        { label: "At least one size", ok: sizes.length > 0, tone: "error" },
        { label: "At least one layer", ok: draft.layer_template.length > 0, tone: "error" },
    ]
    const layersValid = draft.layer_template.every((layer) => {
        return Boolean(layer.film_variant_code)
    })
    out.push({ label: "Each layer has a fixed film/material", ok: layersValid, tone: "error" })
    if (draft.fixed_attributes?.print_capable) {
        out.push({
            label: "Printing contract has artwork gate",
            ok: !!draft.fixed_attributes?.artwork_required,
            tone: "warn",
        })
    }
    return out
}

function ToggleRow({
    label,
    description,
    checked,
    onChange,
}: {
    label: string
    description?: string
    checked: boolean
    onChange: (v: boolean) => void
}) {
    return (
        <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-3 py-2.5">
            <div>
                <div className="text-sm font-bold text-slate-900">{label}</div>
                {description ? <div className="text-[11px] text-slate-500">{description}</div> : null}
            </div>
            <Switch checked={checked} onCheckedChange={onChange} />
        </div>
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// AxisAllowedRegistry — section 7 of the edit workspace.
//
// For each catalog-backed axis (packaging_inner, packaging_outer, pod_variant,
// addons), shows the multiple allowed catalog codes the master accepts, with
// chip-style add/remove. Sales picks from this registry at order time — the
// multiplicity rule below is informational (admin still controls it via the
// existing variant_axes.required toggle in section 4).
// ─────────────────────────────────────────────────────────────────────────────

type RegistryEntry = {
    axis: VariantAxisDef["axis"]
    label: string
    productKinds?: string[] // when set, only render for these product kinds
    source: "packaging_material" | "pod_sku_variant" | "addon"
    packagingKind?: "INNER_POUCH" | "GONNY" | "SHEET" | "BOX" | "TAPE" | "LABEL" | "TAG"
    multiplicity: "one" | "many"
    multiplicityCopy: string
    tone: { bg: string; ring: string; text: string }
    consumption: string
}

const AXIS_REGISTRY: RegistryEntry[] = [
    {
        axis: "packaging_inner",
        label: "Inner pouch",
        productKinds: ["POUCH"],
        source: "packaging_material",
        packagingKind: "INNER_POUCH",
        multiplicity: "one",
        multiplicityCopy: "Sales picks 1 per order",
        tone: { bg: "bg-amber-50/60", ring: "ring-amber-200", text: "text-amber-900" },
        consumption: "auto · ceil(total_pouches / pcs_per_inner)",
    },
    {
        axis: "packaging_outer",
        label: "Gunny / outer (pouch only)",
        productKinds: ["POUCH"],
        source: "packaging_material",
        packagingKind: "GONNY",
        multiplicity: "one",
        multiplicityCopy: "Sales picks 1 per order",
        tone: { bg: "bg-violet-50/60", ring: "ring-violet-200", text: "text-violet-900" },
        consumption: "Packing Yard seal count · no math",
    },
    {
        axis: "packaging_outer",
        label: "Sheet wrap (roll / POD)",
        productKinds: ["ROLL", "POD"],
        source: "packaging_material",
        packagingKind: "SHEET",
        multiplicity: "many",
        multiplicityCopy: "Sales picks one or more per order",
        tone: { bg: "bg-blue-50/60", ring: "ring-blue-200", text: "text-blue-900" },
        consumption: "EOD packing count · no math",
    },
    {
        axis: "pod_variant",
        label: "POD variant",
        source: "pod_sku_variant",
        multiplicity: "one",
        multiplicityCopy: "Sales picks 1 per order",
        tone: { bg: "bg-fuchsia-50/60", ring: "ring-fuchsia-200", text: "text-fuchsia-900" },
        consumption: "1 per pouch · auto-demand on shortage",
    },
    {
        axis: "addons",
        label: "Add-ons (zipper, valve, spout, etc.)",
        source: "addon",
        multiplicity: "many",
        multiplicityCopy: "Sales picks any number per order",
        tone: { bg: "bg-rose-50/60", ring: "ring-rose-200", text: "text-rose-900" },
        consumption: "Per-piece · multiplied by order qty",
    },
]

function AxisAllowedRegistry({
    draft,
    packagingMaterials,
    podVariants,
    addonCatalog,
    onToggleCode,
    onSetAxisFlags,
    onPatchOptions,
}: {
    draft: ProductMaster
    packagingMaterials: PackagingMaterial[]
    podVariants: PodSkuVariant[]
    addonCatalog: Addon[]
    onToggleCode: (axis: VariantAxisDef["axis"], code: string) => void
    onSetAxisFlags: (axis: VariantAxisDef["axis"], patch: { required?: boolean; auto_demand_in_house?: boolean }) => void
    onPatchOptions: (axis: VariantAxisDef["axis"], options: string[]) => void
}) {
    const kind = String(draft.product_kind || "").toUpperCase()
    const visible = AXIS_REGISTRY.filter((r) => !r.productKinds || r.productKinds.includes(kind))
    return (
        <div className="space-y-3">
            {visible.map((entry, i) => (
                <AxisAllowedCard
                    key={`${entry.axis}-${entry.packagingKind || "any"}-${i}`}
                    entry={entry}
                    draft={draft}
                    packagingMaterials={packagingMaterials}
                    podVariants={podVariants}
                    addonCatalog={addonCatalog}
                    onToggleCode={onToggleCode}
                    onSetAxisFlags={onSetAxisFlags}
                    onPatchOptions={onPatchOptions}
                />
            ))}
        </div>
    )
}

function AxisAllowedCard({
    entry,
    draft,
    packagingMaterials,
    podVariants,
    addonCatalog,
    onToggleCode,
    onSetAxisFlags,
}: {
    entry: RegistryEntry
    draft: ProductMaster
    packagingMaterials: PackagingMaterial[]
    podVariants: PodSkuVariant[]
    addonCatalog: Addon[]
    onToggleCode: (axis: VariantAxisDef["axis"], code: string) => void
    onSetAxisFlags: (axis: VariantAxisDef["axis"], patch: { required?: boolean; auto_demand_in_house?: boolean }) => void
    onPatchOptions: (axis: VariantAxisDef["axis"], options: string[]) => void
}) {
    const axisRow = findAxisOnDraft(draft.variant_axes, String(entry.axis))
    const allowedCodes: string[] = Array.isArray((axisRow as any)?.options)
        ? ((axisRow as any).options as any[]).map((o) =>
              typeof o === "string" || typeof o === "number" ? String(o) : String(o?.code || o?.value || o?.id || ""),
          ).filter(Boolean)
        : []

    // Build the picker's catalog list — filtered by source & packaging_kind.
    const allCatalogRows: Array<{ code: string; name: string }> = (() => {
        if (entry.source === "packaging_material") {
            const filtered = entry.packagingKind
                ? packagingMaterials.filter((m) => {
                      const k = String((m as any).packaging_kind || "").toUpperCase()
                      const want: string[] = entry.packagingKind === "GONNY" ? ["GONNY", "GUNNY"] : [String(entry.packagingKind)]
                      return want.includes(k)
                  })
                : packagingMaterials
            return filtered.map((m) => ({ code: m.code, name: m.name || m.code }))
        }
        if (entry.source === "pod_sku_variant") {
            return podVariants.map((p) => ({ code: p.code, name: p.name || p.pod_sku_name || p.code }))
        }
        return addonCatalog.map((a) => ({ code: a.code, name: a.name || a.code }))
    })()

    // Rows that are NOT yet allowed — show them in the "add" picker.
    const pickable = allCatalogRows.filter((r) => !allowedCodes.includes(r.code))

    const required = Boolean(axisRow?.required)
    const autoDemand = Boolean((axisRow as any)?.auto_demand_in_house)

    return (
        <div className={cn("rounded-2xl ring-1 px-4 py-3", entry.tone.bg, entry.tone.ring)}>
            <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                    <div className={cn("text-[10px] font-black uppercase tracking-[0.18em]", entry.tone.text)}>
                        {entry.label}
                    </div>
                    <div className="mt-0.5 text-[11px] font-bold text-slate-700">
                        {entry.multiplicityCopy}
                        <span className="ml-1 text-slate-500 font-medium">· {entry.consumption}</span>
                    </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                    <span className={cn(
                        "inline-flex items-center rounded-full px-2 py-0.5 font-bold ring-1",
                        entry.multiplicity === "one" ? "bg-white text-slate-700 ring-slate-200" : "bg-white text-slate-700 ring-slate-200",
                    )}>
                        {entry.multiplicity === "one" ? "pick 1" : "pick many"}
                    </span>
                    <button
                        type="button"
                        onClick={() => onSetAxisFlags(entry.axis, { required: !required })}
                        className={cn(
                            "inline-flex items-center rounded-full px-2 py-0.5 font-bold ring-1",
                            required ? "bg-blue-600 text-white ring-blue-700" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50",
                        )}
                        title="Toggle required/optional"
                    >
                        {required ? "required" : "optional"}
                    </button>
                    {entry.source !== "addon" ? (
                        <button
                            type="button"
                            onClick={() => onSetAxisFlags(entry.axis, { auto_demand_in_house: !autoDemand })}
                            className={cn(
                                "inline-flex items-center rounded-full px-2 py-0.5 font-bold ring-1",
                                autoDemand ? "bg-emerald-600 text-white ring-emerald-700" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50",
                            )}
                            title="Auto-fire in-house stock launcher on shortage"
                        >
                            auto-demand {autoDemand ? "on" : "off"}
                        </button>
                    ) : null}
                </div>
            </div>

            {/* Allowed code chips */}
            <div className="mt-3">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                    Allowed codes · {allowedCodes.length}
                </div>
                {allowedCodes.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-slate-300 bg-white/40 px-3 py-2 text-[11px] italic text-slate-500">
                        No allowed codes yet — add at least one so sales can pick this {entry.label.toLowerCase()} on an order.
                    </div>
                ) : (
                    <div className="flex flex-wrap gap-1.5">
                        {allowedCodes.map((code) => {
                            const meta = allCatalogRows.find((r) => r.code === code)
                            return (
                                <span key={code} className="inline-flex items-center gap-1 rounded-md bg-white px-2 py-0.5 text-[11px] font-mono font-bold text-slate-800 ring-1 ring-slate-200">
                                    {code}
                                    {meta?.name && meta.name !== code ? <span className="text-[10px] font-medium text-slate-500"> · {meta.name}</span> : null}
                                    <button
                                        type="button"
                                        onClick={() => onToggleCode(entry.axis, code)}
                                        className="ml-0.5 rounded-full p-0.5 text-rose-600 hover:bg-rose-50"
                                        title="Remove from allowed list"
                                    >
                                        <X className="h-3 w-3" />
                                    </button>
                                </span>
                            )
                        })}
                    </div>
                )}
            </div>

            {/* Add picker */}
            <div className="mt-3">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                    Add from catalog · {pickable.length} available
                </div>
                {pickable.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-slate-200 bg-white/40 px-3 py-2 text-[11px] italic text-slate-500">
                        All matching catalog rows are already allowed.
                    </div>
                ) : (
                    <Select value="" onValueChange={(v) => { if (v) onToggleCode(entry.axis, v) }}>
                        <SelectTrigger className="h-9 rounded-lg bg-white text-xs">
                            <SelectValue placeholder="Pick a catalog row to allow…" />
                        </SelectTrigger>
                        <SelectContent>
                            {pickable.map((r) => (
                                <SelectItem key={r.code} value={r.code}>
                                    <span className="font-mono font-bold">{r.code}</span>
                                    {r.name && r.name !== r.code ? <span className="ml-2 text-slate-500 text-xs">{r.name}</span> : null}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                )}
            </div>
        </div>
    )
}

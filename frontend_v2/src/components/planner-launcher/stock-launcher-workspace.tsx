"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useMutation, useQuery } from "@tanstack/react-query"
import {
    AlertTriangle,
    CheckCircle2,
    ClipboardCheck,
    Database,
    Eye,
    Layers,
    Loader2,
    Package,
    Save,
    Sparkles,
    UserSquare,
    Workflow,
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
import { useToast } from "@/hooks/use-toast"
import { describeApiError } from "@/lib/api"
import { cn } from "@/lib/utils"

import { GradientHero } from "@/components/erp/gradient-hero"
import { StepStrip } from "@/components/erp/step-strip"
import { SectionCardV3 } from "@/components/erp/section-card"
import { RouteTimeline } from "@/components/erp/route-timeline"
import { ValidationFooter, type CheckLine } from "@/components/erp/validation-footer"
import { LaunchModeGrid, CommitmentScopeSelector } from "@/components/erp/launch-mode-grid"
import { AxisLayerMatrix, type LayerRowState } from "@/components/erp/axis-layer-matrix"
import { LiveBomRail } from "@/components/erp/live-bom-rail"

import {
    masterDataService,
    type PackagingMaterial,
    type PodSkuVariant,
} from "@/services/master-data"
import { templateService } from "@/services/templates"
import { engineeringService } from "@/services/engineering"
import {
    productMasterService,
    stockLauncherService,
    type CommitmentScope,
    type LaunchMode,
    type PreviewBomResult,
    type ProductMaster,
} from "@/services/product-master"

const STEPS = [
    { id: "mode", label: "Launch mode", description: "Choose what to build" },
    { id: "master", label: "Product Master", description: "Select axes + template" },
    { id: "commitment", label: "Commitment", description: "Lock scope" },
    { id: "stop", label: "Route stop", description: "Pick build stop" },
    { id: "axes", label: "Axes builder", description: "Size, thickness, grade" },
    { id: "preview", label: "Preview + create", description: "Validate & launch" },
]

export function StockLauncherV3Workspace() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const { toast } = useToast()
    const initialMaster = searchParams?.get("product_master") || searchParams?.get("master") || ""

    const [stepId, setStepId] = React.useState("mode")
    const [mode, setMode] = React.useState<LaunchMode>("GENERIC")
    const [scope, setScope] = React.useState<CommitmentScope>("GENERIC")
    const [productMasterId, setProductMasterId] = React.useState(initialMaster)
    const [templateId, setTemplateId] = React.useState<string>("")
    const [committedCustomer, setCommittedCustomer] = React.useState<string>("")
    const [committedArtwork, setCommittedArtwork] = React.useState<string>("")
    const [startStep, setStartStep] = React.useState(1)
    const [stopStep, setStopStep] = React.useState(2)
    const [sizeCode, setSizeCode] = React.useState<string>("")
    const [layerValues, setLayerValues] = React.useState<Record<number, LayerRowState>>({})
    const [quantity, setQuantity] = React.useState(500)
    const [qtyUom, setQtyUom] = React.useState<"KG" | "PCS" | "METER">("KG")
    const [stockClass, setStockClass] = React.useState("GENERIC_ROLL")
    const [stockStrategy, setStockStrategy] = React.useState("WIP_CONTINUE")
    const [outputType, setOutputType] = React.useState("ROLL")
    const [stockOwner, setStockOwner] = React.useState("Internal")
    const [packagingMaterialId, setPackagingMaterialId] = React.useState("")
    const [podVariantId, setPodVariantId] = React.useState("")

    const { data: customers = [] } = useQuery({
        queryKey: ["customers"],
        queryFn: masterDataService.getCustomers,
        staleTime: 60_000,
    })
    const { data: masters = [] } = useQuery({
        queryKey: ["product-masters", "v3", "active"],
        queryFn: () => productMasterService.list({ active: true, for_planner: true }),
        staleTime: 30_000,
    })
    const { data: templates = [] } = useQuery({
        queryKey: ["templates", "live"],
        queryFn: () => templateService.getLiveTemplateOptions(),
        staleTime: 5 * 60_000,
        retry: 2,
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 5000),
        meta: { suppressGlobalError: true },
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
    const { data: artworks = [] } = useQuery({
        queryKey: ["planner-artworks", "approved"],
        queryFn: () => engineeringService.getArtworks({ status: "APPROVED" }),
        staleTime: 60_000,
    })

    const master: ProductMaster | undefined = masters.find((m) => m.id === productMasterId)
    const { data: sizes = [] } = useQuery({
        queryKey: ["product-master-sizes", productMasterId],
        queryFn: () => productMasterService.listSizes(productMasterId),
        enabled: !!productMasterId,
    })
    const { data: routeInfo } = useQuery({
        queryKey: ["product-master-template", productMasterId],
        queryFn: () => productMasterService.getTemplate(productMasterId),
        enabled: !!productMasterId,
    })

    React.useEffect(() => {
        if (master) {
            const next: Record<number, LayerRowState> = {}
            master.layer_template.forEach((row, i) => {
                next[i + 1] = {
                    role: row.role,
                    film_variant_code: row.film_variant_code || (row as any).material_code || (row as any).code,
                    thickness_micron: row.thickness_micron,
                    grade: row.default_grade,
                }
            })
            setLayerValues(next)
            setTemplateId(master.template || "")
            setSizeCode("")
        }
    }, [master?.id])

    React.useEffect(() => {
        if (!sizeCode && sizes.length) setSizeCode(sizes[0].code)
    }, [sizes, sizeCode])

    React.useEffect(() => {
        // Sync mode → scope
        if (mode === "GENERIC" || mode === "PACKAGING" || mode === "POD") setScope("GENERIC")
        else if (mode === "CUSTOMER") setScope("CUSTOMER")
        else if (mode === "ARTWORK") setScope("ARTWORK")
        else if (mode === "CUSTOMER_ARTWORK") setScope("CUSTOMER_ARTWORK")
        if (mode === "PACKAGING") {
            setStockClass("PACKAGING")
            setStockStrategy("PACKAGING_STOCK")
            setOutputType("PACKAGING")
            setQtyUom("PCS")
        } else if (mode === "POD") {
            setStockClass("POD")
            setStockStrategy("POD_BULK")
            setOutputType("POD")
            setQtyUom("KG")
        } else if (mode === "GENERIC") {
            setStockClass("GENERIC_ROLL")
            setStockStrategy("WIP_CONTINUE")
            setOutputType(master?.product_kind === "POUCH" ? "ROLL" : master?.product_kind || "ROLL")
            setQtyUom("KG")
        }
    }, [mode, master?.product_kind])

    const selectedPackaging = packagingMaterials.find(
        (m: PackagingMaterial) => m.id === packagingMaterialId || m.code === packagingMaterialId
    )
    const selectedPod = podVariants.find((p: PodSkuVariant) => p.id === podVariantId || p.code === podVariantId)

    const axisValues = React.useMemo(() => {
        const layer_thicknesses: Record<string, number> = {}
        const layer_grades: Record<string, string> = {}
        const layer_widths: Record<string, number> = {}
        Object.entries(layerValues).forEach(([k, v]) => {
            if (v.thickness_micron != null) layer_thicknesses[k] = v.thickness_micron
            if (v.grade != null) layer_grades[k] = v.grade
            if (v.width_mm != null) layer_widths[k] = v.width_mm
        })
        const axis: Record<string, any> = {
            size: sizeCode,
            layer_thicknesses,
            layer_grades,
            layer_widths,
        }
        if (selectedPackaging?.code || packagingMaterialId) axis.packaging = selectedPackaging?.code || packagingMaterialId
        if (selectedPod?.code || podVariantId) axis.pod = selectedPod?.code || podVariantId
        return axis
    }, [layerValues, sizeCode, packagingMaterialId, podVariantId, selectedPackaging?.code, selectedPod?.code])

    const routeSteps = (routeInfo?.route_steps || []).map((step) => ({
        index: step.index,
        label: step.name || step.process_code || `Step ${step.index}`,
        transition: step.transition || "—",
        artwork_step: Boolean(step.has_artwork),
    }))
    const steps = routeSteps
    const firstArtworkStep = steps.find((step) => step.artwork_step)?.index
    const routeIsOneBased = steps.length > 0 && Math.min(...steps.map((s) => s.index)) === 1
    const toBackendStep = React.useCallback(
        (value: number) => Math.max(0, routeIsOneBased ? value - 1 : value),
        [routeIsOneBased]
    )

    React.useEffect(() => {
        if (!steps.length) return
        const first = steps[0]?.index ?? 0
        const last = steps[steps.length - 1]?.index ?? first
        if (!steps.some((s) => s.index === startStep)) setStartStep(first)
        if (!steps.some((s) => s.index === stopStep)) setStopStep(last)
    }, [routeInfo?.route_steps, startStep, stopStep, steps])

    React.useEffect(() => {
        if (!steps.length || firstArtworkStep == null) return
        const ordered = steps.map((s) => s.index).sort((a, b) => a - b)
        const first = ordered[0] ?? 0
        const previous = [...ordered].reverse().find((idx) => idx < firstArtworkStep)
        if ((scope === "GENERIC" || scope === "CUSTOMER") && previous != null && stopStep >= firstArtworkStep) {
            setStopStep(previous)
            if (startStep > previous) setStartStep(first)
        }
        if ((scope === "ARTWORK" || scope === "CUSTOMER_ARTWORK") && stopStep < firstArtworkStep) {
            setStopStep(firstArtworkStep)
        }
    }, [scope, firstArtworkStep, startStep, stopStep, steps])

    const validate = useQuery({
        queryKey: ["stock-pool-validate", productMasterId, templateId, axisValues, scope, committedCustomer, committedArtwork, startStep, stopStep, mode, packagingMaterialId, podVariantId, quantity, qtyUom],
        enabled: !!productMasterId && !!templateId,
        queryFn: () =>
            stockLauncherService.validate({
                product_master: productMasterId,
                template_id: templateId,
                axis_values: axisValues,
                quantity,
                quantity_uom: qtyUom,
                commitment_scope: scope,
                committed_customer: committedCustomer || undefined,
                committed_artwork: committedArtwork || undefined,
                start_step_index: toBackendStep(startStep),
                stop_step_index: toBackendStep(stopStep),
                launcher_mode: mode === "POD" ? "POD_STOCK" : mode,
                stock_purpose: mode === "PACKAGING" ? "PACKAGING" : "PRODUCT",
                packaging_material: packagingMaterialId || undefined,
                pod_sku_variant: podVariantId || undefined,
                printing: master?.fixed_attributes?.print_capable ? { enabled: false, defer_artwork_to_planner: true } : { enabled: false },
                addons: [],
            }),
    })

    const createMutation = useMutation({
        mutationFn: () =>
            stockLauncherService.create({
                product_master: productMasterId,
                template_id: templateId,
                axis_values: axisValues,
                quantity,
                quantity_uom: qtyUom,
                commitment_scope: scope,
                committed_customer: committedCustomer || undefined,
                committed_artwork: committedArtwork || undefined,
                start_step_index: toBackendStep(startStep),
                stop_step_index: toBackendStep(stopStep),
                stock_strategy: stockStrategy,
                planner_stock_class: stockClass,
                output_type: outputType,
                stock_owner: stockOwner,
                launcher_mode: mode === "POD" ? "POD_STOCK" : mode,
                stock_purpose: mode === "PACKAGING" ? "PACKAGING" : "PRODUCT",
                packaging_material: packagingMaterialId || undefined,
                pod_sku_variant: podVariantId || undefined,
                printing: master?.fixed_attributes?.print_capable ? { enabled: false, defer_artwork_to_planner: true } : { enabled: false },
                addons: [],
            }),
        onSuccess: (data: any) => {
            toast({ title: "Stock order created", description: data?.stock_order_number || "" })
            router.push("/dashboard/planner/control-tower/stock-intelligence")
        },
        onError: (err: any) =>
            toast({ title: "Could not create", description: err?.message || "Try again", variant: "destructive" }),
    })

    const validation = validate.data

    // Map the planner's validation response into the shared PreviewBomResult shape
    // so the LiveBomRail can render geometry + layers + materials + step ribbon
    // + checks consistently with Sales Create. Keeps the planner-specific intel
    // (eligible_demand, commitment_safety, required_material) on dedicated cards
    // below.
    const railPreview: PreviewBomResult | null = React.useMemo(() => {
        if (!validation) return null
        return {
            variant_status: "EXISTS",
            invariant_signature: validation.invariant_signature || master?.invariant_signature || "INV-?",
            geometry_snapshot: validation.geometry_snapshot || {
                width_mm: sizes.find((s) => s.code === sizeCode)?.width_mm,
                height_mm: sizes.find((s) => s.code === sizeCode)?.height_mm,
                gusset_mm: sizes.find((s) => s.code === sizeCode)?.gusset_mm,
                roll_width_mm: sizes.find((s) => s.code === sizeCode)?.roll_width_mm,
                size_code: sizeCode,
            },
            layer_snapshot: Array.isArray(validation.layer_snapshot) && validation.layer_snapshot.length
                ? validation.layer_snapshot
                : Object.entries(layerValues).map(([k, v]) => ({
                    role: v.role,
                    film_variant_code: v.film_variant_code,
                    thickness_micron: v.thickness_micron,
                    grade: v.grade,
                    roll_width_mm: v.width_mm,
                    layer_index: Number(k),
                })),
            bom_by_step: validation.bom_by_step || [],
            blockers: Array.isArray(validation.blockers) ? validation.blockers : [],
            warnings: [],
            unit_weight_g: undefined,
            total_weight_kg: qtyUom === "KG" ? quantity : undefined,
            checks: [
                { label: "Invariant signature resolved", ok: !!validation.invariant_signature, tone: "error" },
                { label: "Geometry snapshot captured", ok: !!validation.geometry_snapshot, tone: "warn" },
                { label: "Layer snapshot captured", ok: Array.isArray(validation.layer_snapshot) && validation.layer_snapshot.length > 0, tone: "warn" },
                { label: "Stop rule valid for scope", ok: !!validation.valid, tone: "error" },
            ],
        }
    }, [validation, master, sizes, sizeCode, layerValues, qtyUom, quantity])

    const masterFlagsForRail = master ? {
        print_capable: !!master.fixed_attributes?.print_capable,
        pod_locked: !!(master.fixed_attributes?.pod_enabled && (master.fixed_attributes?.pod_variant_code || master.fixed_attributes?.pod_variant)),
        addons_axis: ((master.variant_axes || []).find((a) => String(a.axis) === "addons" || String(a.axis) === "addon")?.required ? "required" : (master.variant_axes || []).some((a) => String(a.axis) === "addons" || String(a.axis) === "addon") ? "optional" : "off") as "off" | "optional" | "required",
    } : undefined
    const validationIssues = React.useMemo(() => {
        const issues = [
            ...(Array.isArray(validation?.reasons) ? validation.reasons : []),
            ...(Array.isArray(validation?.blockers) ? validation.blockers : []),
        ].map((value) => String(value || "").trim()).filter(Boolean)
        if (validate.isError) issues.push(describeApiError(validate.error, "Validation failed."))
        return Array.from(new Set(issues))
    }, [validate.error, validate.isError, validation?.blockers, validation?.reasons])
    const masterLaunchIssues = React.useMemo(() => {
        if (!master) return []
        const issues: string[] = []
        const productMode = mode !== "PACKAGING" && mode !== "POD"
        if (!templateId) issues.push("No live template is bound.")
        if (productMode && !master.layer_template.length) issues.push("No film layer template is defined.")
        if (productMode && sizes.length === 0) issues.push("No active size/roll-width row is defined.")
        if (productMode && Object.keys(layerValues).length < master.layer_template.length) issues.push("Not all layer axes are filled.")
        return issues
    }, [layerValues, master, mode, sizes.length, templateId])
    const totalThickness = (validation?.layer_snapshot || []).reduce((sum: number, layer: any) => sum + Number(layer.thickness_micron || layer.thickness_um || 0), 0)
    const rollWidth = Number((validation?.geometry_snapshot || {}).roll_width_mm || (validation?.geometry_snapshot || {}).effective_width_mm || (validation?.layer_snapshot || [])[0]?.roll_width_mm || 0)
    const bomMaterialCount = (validation?.bom_by_step || []).reduce((sum: number, step: any) => sum + ((step.materials || []).filter((mat: any) => mat.material_code && Number(mat.qty || 0) > 0).length), 0)
    const stockMathReady = !masterLaunchIssues.length && totalThickness > 0 && rollWidth > 0 && bomMaterialCount > 0
    const checks: CheckLine[] = [
        { label: "Product master", ok: !!productMasterId && !masterLaunchIssues.length, tone: "error" },
        { label: "Template & route stop", ok: !!templateId && stopStep >= startStep, tone: "error" },
        { label: "Commitment safety", ok: !!validation?.valid && !validationIssues.length, tone: "error" },
        { label: "Axes complete", ok: !!sizeCode && !masterLaunchIssues.length, tone: "error" },
        { label: "Stock math + BOM", ok: stockMathReady, tone: "error" },
    ]
    const completed = computeCompleted({ mode, productMasterId, scope, stopStep, sizeCode, quantity })
    const requiredMaterial = validation?.required_material
    const createDisabled = !validation?.valid || !stockMathReady || !productMasterId || createMutation.isPending

    const masterSelectIssues = React.useCallback(
        (candidate: ProductMaster) => {
            const issues: string[] = []
            const productLike = candidate.product_kind === "POUCH" || candidate.product_kind === "ROLL"
            if (!candidate.template && !candidate.default_template) issues.push("no template")
            if (productLike && !candidate.layer_template.length) issues.push("no layers")
            if (productLike && candidate.sizes_count === 0) issues.push("no sizes")
            return issues
        },
        []
    )

    return (
        <div className="space-y-6">
            <GradientHero
                eyebrow="PLANNER · STOCK LAUNCHER"
                title="Launch stock from any Product Master"
                subtitle="Choose a mode → pick a master → set axes → preview math → launch. Generic mode tags rolls for any matching order; Customer/Artwork modes pre-commit; Packaging/POD build in-house bridge stock."
                palette="indigo"
                chips={[
                    { label: "Master", value: master?.code || "None", icon: <Package className="h-3.5 w-3.5" />, tone: master ? "info" : undefined },
                    { label: "Layers", value: String(master?.layer_template.length || 0), icon: <Layers className="h-3.5 w-3.5" />, tone: "violet" },
                    { label: "Sizes", value: String(sizes.length || 0), icon: <Database className="h-3.5 w-3.5" />, tone: "info" },
                    { label: "Route steps", value: String(steps.length || 0), icon: <Workflow className="h-3.5 w-3.5" />, tone: "info" },
                    { label: "Scope", value: scope, icon: <UserSquare className="h-3.5 w-3.5" />, tone: scope === "GENERIC" ? "violet" : "ok" },
                    {
                        label: "Validation",
                        value: validation?.valid ? "Ready" : validate.isError ? "Blocked" : "Pending",
                        tone: validation?.valid ? "ok" : validate.isError ? "error" : "warn",
                        icon: validation?.valid ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />,
                    },
                ]}
            >
                <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <div className="rounded-xl bg-white/10 px-3 py-2 backdrop-blur ring-1 ring-white/20">
                        <div className="text-[10px] font-black uppercase tracking-wider text-white/80">Step 1 · Mode</div>
                        <div className="mt-0.5 text-sm font-semibold text-white">{mode === "GENERIC" ? "Generic / Jumbo" : mode === "POD" ? "POD stock" : mode === "PACKAGING" ? "Packaging stock" : mode === "CUSTOMER" ? "Customer-committed" : mode === "ARTWORK" ? "Artwork-committed" : "Customer + Artwork"}</div>
                    </div>
                    <div className="rounded-xl bg-white/10 px-3 py-2 backdrop-blur ring-1 ring-white/20">
                        <div className="text-[10px] font-black uppercase tracking-wider text-white/80">Step 4 · Stop</div>
                        <div className="mt-0.5 text-sm font-semibold text-white">{startStep > 0 && stopStep > 0 ? `Step ${startStep} → ${stopStep}` : "Pick build stop"}</div>
                    </div>
                    <div className="rounded-xl bg-white/10 px-3 py-2 backdrop-blur ring-1 ring-white/20">
                        <div className="text-[10px] font-black uppercase tracking-wider text-white/80">Step 6 · Quantity</div>
                        <div className="mt-0.5 text-sm font-semibold text-white">{quantity > 0 ? `${quantity.toLocaleString()} ${qtyUom}` : "Set quantity"}</div>
                    </div>
                </div>
            </GradientHero>

            <StepStrip steps={STEPS} currentId={stepId} completedIds={completed} onStepClick={setStepId} />

            <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
                <div className="space-y-5">
                    <SectionCardV3 index={1} title="Launch mode" description="What kind of stock to build." accent="blue">
                        <LaunchModeGrid value={mode} onChange={setMode} />
                        <ModeFlowCallout mode={mode} layerCount={master?.layer_template?.length || 0} />
                    </SectionCardV3>

                    <SectionCardV3 index={2} title="Product Master" description="Master & template" accent="violet">
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <Field label="Product master">
                                <Select value={productMasterId} onValueChange={setProductMasterId}>
                                    <SelectTrigger className="h-10 rounded-xl border-slate-200 shadow-sm">
                                        <SelectValue placeholder="Pick master" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {masters.map((m) => {
                                            const issues = masterSelectIssues(m)
                                            return (
                                            <SelectItem key={m.id} value={m.id} disabled={issues.length > 0}>
                                                {m.code} — {m.name}{issues.length ? ` · incomplete (${issues.join(", ")})` : ""}
                                            </SelectItem>
                                            )
                                        })}
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
                            <div className="mt-3 space-y-3">
                                <div className="flex flex-wrap gap-2">
                                    <Pill tone="blue">{master.product_kind}</Pill>
                                    <Pill tone={master.layer_template.length ? "emerald" : "amber"}>{master.layer_template.length} layers</Pill>
                                    <Pill tone={master.variant_axes.length ? "violet" : "amber"}>{master.variant_axes.length} axes</Pill>
                                    <Pill tone={templateId ? "slate" : "amber"}>{templateId ? "Template bound" : "Template missing"}</Pill>
                                    {master.fixed_attributes?.print_capable ? (
                                        <Pill tone="fuchsia">Print capable</Pill>
                                    ) : (
                                        <Pill tone="emerald">Print not required</Pill>
                                    )}
                                    <Pill tone="emerald">Stock reusable</Pill>
                                </div>
                                {masterLaunchIssues.length ? (
                                    <IssueList
                                        title="This Product Master is incomplete for stock launch"
                                        issues={masterLaunchIssues}
                                    />
                                ) : null}
                            </div>
                        ) : null}
                    </SectionCardV3>

                    <SectionCardV3 index={3} title="Commitment" description="Lock scope so stock pool reuse stays safe." accent="violet">
                        <div className="space-y-4">
                            <CommitmentScopeSelector value={scope} onChange={setScope} />
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <Field label="Customer">
                                    <Select
                                        value={committedCustomer}
                                        onValueChange={setCommittedCustomer}
                                        disabled={scope === "GENERIC" || scope === "ARTWORK"}
                                    >
                                        <SelectTrigger className="h-10 rounded-xl border-slate-200 shadow-sm">
                                            <SelectValue placeholder={scope === "GENERIC" || scope === "ARTWORK" ? "Disabled for this scope" : "Pick customer"} />
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
                                <Field label="Artwork">
                                    <Select
                                        value={committedArtwork || "__none"}
                                        onValueChange={(v) => setCommittedArtwork(v === "__none" ? "" : v)}
                                        disabled={scope === "GENERIC" || scope === "CUSTOMER"}
                                    >
                                        <SelectTrigger className="h-10 rounded-xl border-slate-200 shadow-sm">
                                            <SelectValue placeholder={scope === "GENERIC" || scope === "CUSTOMER" ? "Disabled for this scope" : "Pick artwork"} />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="__none">— None —</SelectItem>
                                            {artworks.map((a: any) => (
                                                <SelectItem key={a.id} value={a.id}>
                                                    {a.design_code || a.id}{a.name ? ` · ${a.name}` : ""}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    {artworks.length === 0 ? (
                                        <div className="mt-1 text-[10px] text-amber-700">No approved artworks yet. Approve one in Engineering first.</div>
                                    ) : null}
                                </Field>
                            </div>
                            <div
                                className={cn(
                                    "flex items-start gap-2 rounded-xl border px-3 py-2 text-xs",
                                    scope === "GENERIC"
                                        ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                                        : scope.includes("ARTWORK")
                                        ? "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-800"
                                        : "border-amber-200 bg-amber-50 text-amber-800"
                                )}
                            >
                                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-none" />
                                {scope === "GENERIC"
                                    ? "Generic stock can match any sales line with the same invariant signature before artwork."
                                    : scope === "CUSTOMER"
                                    ? "Customer-locked stock matches only the chosen customer; must stop before artwork step."
                                    : scope === "ARTWORK"
                                    ? "Artwork-locked stock must stop at or after the first artwork-bearing step."
                                    : "Customer + artwork locked stock requires both selections and stops at/after artwork."}
                            </div>
                        </div>
                    </SectionCardV3>

                    <SectionCardV3 index={4} title="Route stop" description="Click a route step to set the stop. Double-click to set route start." accent="emerald" actions={
                        <span
                            className={cn(
                                "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ring-inset",
                                validation?.valid
                                    ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                                    : "bg-amber-50 text-amber-700 ring-amber-200"
                            )}
                        >
                            {validation?.valid ? "Stop rule valid" : "Stop rule check needed"}
                        </span>
                    }>
                        <RouteTimeline
                            steps={steps}
                            startIndex={startStep}
                            stopIndex={stopStep}
                            onSelectStop={setStopStep}
                            onSelectStart={setStartStep}
                            helperText={
                                scope === "GENERIC"
                                    ? "Generic and customer scopes must stop before the first artwork step."
                                    : scope.includes("ARTWORK")
                                    ? "Artwork scopes must stop at or after the first artwork step."
                                    : "Customer scope must stop before the artwork step."
                            }
                        />
                    </SectionCardV3>

                    {master ? (
                        <SectionCardV3 index={5} title="Axes builder" description="Size, per-layer thickness, grade, width" accent="blue">
                            <div className="space-y-4">
                                <div>
                                    <Label className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">
                                        Size (width)
                                    </Label>
                                    <div className="mt-2 grid max-h-60 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-4">
                                        {sizes.map((s) => {
                                            const active = s.code === sizeCode
                                            return (
                                                <button
                                                    key={s.id}
                                                    type="button"
                                                    onClick={() => setSizeCode(s.code)}
                                                    className={cn(
                                                        "rounded-2xl border px-3 py-2.5 text-left shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300",
                                                        active
                                                            ? "border-blue-400 bg-gradient-to-br from-blue-50 to-white ring-2 ring-blue-200 shadow-blue-100"
                                                            : "border-slate-200 bg-white hover:border-blue-200 hover:shadow-md"
                                                    )}
                                                >
                                                    <div className="flex items-center justify-between">
                                                        <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">{s.code}</div>
                                                        <span className={cn("h-3.5 w-3.5 rounded-full border-2 transition",
                                                            active ? "border-blue-600 bg-blue-600 shadow-sm shadow-blue-200" : "border-slate-300 bg-white"
                                                        )} />
                                                    </div>
                                                    <div className="text-sm font-bold text-slate-900">{s.width_mm} mm</div>
                                                    <div className="text-[10px] text-slate-400">{s.label}</div>
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
                                            fallbackWidthMm={sizes.find((s) => s.code === sizeCode)?.roll_width_mm ?? undefined}
                                            onChange={(idx, patch) =>
                                                setLayerValues((prev) => ({
                                                    ...prev,
                                                    [idx]: { ...(prev[idx] || ({} as LayerRowState)), ...patch },
                                                }))
                                            }
                                        />
                                    </div>
                                </div>

                                <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 ring-1 ring-emerald-100">
                                    <div className="text-[10px] font-black uppercase tracking-[0.22em] text-emerald-700">
                                        Variant status
                                    </div>
                                    <div className="mt-1 flex items-center gap-2 font-bold">
                                        <Sparkles className="h-3.5 w-3.5" /> Existing variant reusable
                                    </div>
                                    <p className="mt-1 text-[11px]">
                                        This axis combination matches an active variant in the catalog. Reusable for new
                                        stock without creating a new variant.
                                    </p>
                                </div>
                            </div>
                        </SectionCardV3>
                    ) : null}

                    <SectionCardV3 index={6} title="Quantity & stock options" accent="violet">
                        <p className="mb-3 text-xs font-semibold text-slate-500">
                            UOM supports KG, PCS, and METER depending on the selected product master output.
                        </p>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            <Field label="Target quantity">
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
                                        <SelectItem value="METER">METER</SelectItem>
                                    </SelectContent>
                                </Select>
                            </Field>
                            <Field label="Planner stock class">
                                <Select value={stockClass} onValueChange={setStockClass}>
                                    <SelectTrigger className="h-10 rounded-xl border-slate-200 shadow-sm">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="GENERIC_ROLL">GENERIC_ROLL</SelectItem>
                                        <SelectItem value="CUSTOMER_ROLL">CUSTOMER_ROLL</SelectItem>
                                        <SelectItem value="ARTWORK_PRINTED">ARTWORK_PRINTED</SelectItem>
                                        <SelectItem value="PACKAGING">PACKAGING</SelectItem>
                                        <SelectItem value="POD">POD</SelectItem>
                                    </SelectContent>
                                </Select>
                            </Field>
                            <Field label="Stock strategy">
                                <Select value={stockStrategy} onValueChange={setStockStrategy}>
                                    <SelectTrigger className="h-10 rounded-xl border-slate-200 shadow-sm">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="WIP_CONTINUE">WIP_CONTINUE</SelectItem>
                                        <SelectItem value="FINAL_STOCK">FINAL_STOCK</SelectItem>
                                        <SelectItem value="INTERMEDIATE_POOL">INTERMEDIATE_POOL</SelectItem>
                                        <SelectItem value="PACKAGING_STOCK">PACKAGING_STOCK</SelectItem>
                                    </SelectContent>
                                </Select>
                            </Field>
                            <Field label="Output type">
                                <Select value={outputType} onValueChange={setOutputType}>
                                    <SelectTrigger className="h-10 rounded-xl border-slate-200 shadow-sm">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="ROLL">ROLL</SelectItem>
                                        <SelectItem value="POUCH">POUCH</SelectItem>
                                        <SelectItem value="PACKAGING">PACKAGING</SelectItem>
                                        <SelectItem value="POD">POD</SelectItem>
                                    </SelectContent>
                                </Select>
                            </Field>
                            <Field label="Stock owner">
                                <Select value={stockOwner} onValueChange={setStockOwner}>
                                    <SelectTrigger className="h-10 rounded-xl border-slate-200 shadow-sm">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="Internal">Internal</SelectItem>
                                        <SelectItem value="Jobwork">Jobwork partner</SelectItem>
                                        <SelectItem value="Customer">Customer-owned</SelectItem>
                                    </SelectContent>
                                </Select>
                            </Field>
                            {mode === "PACKAGING" ? (
                                <Field label="Packaging output SKU">
                                    <Select
                                        value={packagingMaterialId || "__none"}
                                        onValueChange={(value) => {
                                            const next = value === "__none" ? "" : value
                                            setPackagingMaterialId(next)
                                            const material = packagingMaterials.find((m: PackagingMaterial) => m.id === next || m.code === next)
                                            if (material?.base_uom) setQtyUom(material.base_uom === "PCS" ? "PCS" : "KG")
                                        }}
                                    >
                                        <SelectTrigger className="h-10 rounded-xl border-slate-200 shadow-sm">
                                            <SelectValue placeholder="Pick packaging SKU" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="__none">Select packaging SKU</SelectItem>
                                            {packagingMaterials.map((material: PackagingMaterial) => (
                                                <SelectItem key={material.id} value={material.id}>
                                                    {material.code} — {material.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </Field>
                            ) : null}
                            {mode === "POD" ? (
                                <Field label="POD output SKU">
                                    <Select
                                        value={podVariantId || "__none"}
                                        onValueChange={(value) => setPodVariantId(value === "__none" ? "" : value)}
                                    >
                                        <SelectTrigger className="h-10 rounded-xl border-slate-200 shadow-sm">
                                            <SelectValue placeholder="Pick POD SKU" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="__none">Select POD SKU</SelectItem>
                                            {podVariants.map((pod: PodSkuVariant) => (
                                                <SelectItem key={pod.id} value={pod.id}>
                                                    {pod.code} — {pod.name || pod.pod_sku_name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </Field>
                            ) : null}
                        </div>
                    </SectionCardV3>
                </div>

                <aside className="space-y-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pb-4">
                    {/* Live BOM rail — same shell as Sales Create, mapped from planner validation */}
                    <LiveBomRail
                        title={`Stock pool · ${master?.code || "pick a master"}`}
                        subtitle={validation?.invariant_signature ? `inv ${String(validation.invariant_signature).slice(0, 16)}` : "Invariant pending"}
                        preview={railPreview}
                        loading={validate.isFetching}
                        scope="order"
                        masterFlags={masterFlagsForRail}
                        routeSteps={steps.map((s) => ({ index: s.index, name: s.label, transition: s.transition, has_artwork: s.artwork_step }))}
                        routeTemplateName={master?.template_name || undefined}
                    />

                    {validationIssues.length ? (
                        <SectionCardV3 title="Launch blockers" description="Fix these before creating stock." accent="amber">
                            <IssueList title="Backend validation" issues={validationIssues} />
                        </SectionCardV3>
                    ) : null}

                    {/* Required material — keep as compact card, planner-specific */}
                    {requiredMaterial ? (
                        <SectionCardV3 title="Primary required material" description="To launch this stock pool" accent="emerald">
                            <div className="rounded-xl bg-emerald-50/40 ring-1 ring-emerald-200 px-3 py-2.5">
                                <div className="flex items-center gap-2">
                                    <span className="rounded-md bg-white px-2 py-0.5 text-xs font-mono font-bold text-emerald-800 ring-1 ring-emerald-200">{requiredMaterial.code}</span>
                                    <span className="text-sm font-bold text-slate-800 truncate">{requiredMaterial.name}</span>
                                </div>
                                <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                                    <Mini label="Grade" value={requiredMaterial.grade || "GP"} />
                                    <Mini label="Thickness" value={`${requiredMaterial.thickness_micron ?? 0} μ`} />
                                    <Mini label="Width" value={`${requiredMaterial.width_mm ?? 0} mm`} />
                                </div>
                                <div className="mt-2 flex items-center justify-between text-[11px]">
                                    <span className="font-bold uppercase tracking-wider text-emerald-700/80">Target qty</span>
                                    <span className="font-mono font-black text-emerald-900">{requiredMaterial.target_qty} {requiredMaterial.uom}</span>
                                </div>
                            </div>
                        </SectionCardV3>
                    ) : null}

                    {/* Matching demand — planner-only signal */}
                    <SectionCardV3 title="Matching demand" description="Open sales lines that can pull from this pool" accent="emerald">
                        <div className="grid grid-cols-2 gap-2">
                            <Mini label="Eligible orders" value={`${validation?.eligible_demand?.eligible_orders ?? 0}`} subtle="Can match (no lock)" />
                            <Mini label="Exact width" value={`${validation?.eligible_demand?.exact_match ?? 0}`} subtle="same roll width" />
                            <Mini label="10% wider" value={`${validation?.eligible_demand?.widening_allowed ?? 0}`} subtle="fallback only" />
                            <Mini label="Wrong art/cust" value={`${validation?.eligible_demand?.wrong_artwork ?? 0}`} subtle="Blocked by lock" />
                        </div>
                    </SectionCardV3>

                    {/* Commitment safety — planner-only signal */}
                    <SectionCardV3 title="Commitment safety" description="What this pool will and won't match" accent="amber">
                        <SafetyRow label="Customer lock" value={validation?.commitment_safety?.customer_lock || (committedCustomer ? "Pending" : "None")} note={committedCustomer ? "Locked to picked customer." : "Generic stock has no customer lock."} />
                        <SafetyRow label="Artwork lock" value={validation?.commitment_safety?.artwork_lock || (committedArtwork ? "Pending" : "None")} note={committedArtwork ? "Locked to picked artwork." : "No artwork commitment applied."} />
                        <SafetyRow label="Match window" value={validation?.commitment_safety?.match_window || "Before print only"} note={scope.includes("ARTWORK") ? "After artwork step — must match same artwork." : "Can match any demand before the artwork step."} />
                    </SectionCardV3>
                </aside>
            </div>

            <ValidationFooter
                checks={checks}
                autosaveLabel="Planner draft saved"
                primaryActions={
                    <>
                        <Button variant="outline" className="rounded-xl border-indigo-200 bg-indigo-50 text-indigo-700 shadow-sm hover:bg-indigo-100">
                            <Eye className="mr-1.5 h-4 w-4" /> Preview
                        </Button>
                        <Button
                            variant="outline"
                            onClick={() => validate.refetch()}
                            className="rounded-xl border-emerald-200 bg-emerald-50 text-emerald-700 shadow-sm hover:bg-emerald-100"
                        >
                            <CheckCircle2 className="mr-1.5 h-4 w-4" />
                            Validate pool
                        </Button>
                        <Button
                            disabled={createDisabled}
                            onClick={() => createMutation.mutate()}
                            className="gap-1.5 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 shadow-lg shadow-indigo-600/25 hover:shadow-xl hover:shadow-indigo-600/30"
                        >
                            {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />}
                            Create stock order
                        </Button>
                    </>
                }
                secondaryActions={
                    <Button variant="ghost" className="rounded-xl text-slate-600">
                        <Save className="mr-1.5 h-4 w-4" /> Save planner preset
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

function Pill({ tone, children }: { tone: "blue" | "violet" | "fuchsia" | "amber" | "emerald" | "slate"; children: React.ReactNode }) {
    const map: Record<string, string> = {
        blue: "bg-blue-50 text-blue-700 ring-blue-200 shadow-sm",
        violet: "bg-violet-50 text-violet-700 ring-violet-200 shadow-sm",
        fuchsia: "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200 shadow-sm",
        amber: "bg-amber-50 text-amber-700 ring-amber-200 shadow-sm",
        emerald: "bg-emerald-50 text-emerald-700 ring-emerald-200 shadow-sm",
        slate: "bg-slate-50 text-slate-700 ring-slate-200 shadow-sm",
    }
    return (
        <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold ring-1 ring-inset", map[tone])}>
            {children}
        </span>
    )
}

function IssueList({ title, issues }: { title: string; issues: string[] }) {
    if (!issues.length) return null
    return (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 ring-1 ring-amber-100">
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-amber-700">
                <AlertTriangle className="h-3.5 w-3.5" />
                {title}
            </div>
            <ul className="mt-1.5 space-y-1">
                {issues.map((issue) => (
                    <li key={issue} className="leading-5">
                        {issue}
                    </li>
                ))}
            </ul>
        </div>
    )
}

function Mini({ label, value, subtle }: { label: string; value: string; subtle?: string }) {
    return (
        <div className="rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50/60 to-white px-3 py-2 shadow-sm">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</div>
            <div className="text-sm font-bold text-slate-800">{value}</div>
            {subtle ? <div className="text-[10px] text-slate-500">{subtle}</div> : null}
        </div>
    )
}

function PoolRow({ label, value, subtle }: { label: string; value: string; subtle?: string }) {
    return (
        <div className="flex items-start justify-between rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50/60 to-white px-3 py-2.5 shadow-sm">
            <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</div>
                <div className="text-sm font-bold text-slate-800">{value}</div>
            </div>
            {subtle ? <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 ring-1 ring-slate-200">{subtle}</span> : null}
        </div>
    )
}

function SafetyRow({ label, value, note }: { label: string; value: string; note?: string }) {
    return (
        <div className="mb-2 flex items-start justify-between rounded-xl border border-slate-200 bg-gradient-to-br from-amber-50/30 to-white px-3 py-2.5 shadow-sm last:mb-0">
            <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</div>
                <div className="text-sm font-bold text-slate-800">{value}</div>
            </div>
            <span className="ml-2 max-w-[120px] text-right text-[10px] font-medium text-slate-500">{note}</span>
        </div>
    )
}

function computeCompleted({
    mode,
    productMasterId,
    scope,
    stopStep,
    sizeCode,
    quantity,
}: any): string[] {
    const out: string[] = []
    if (mode) out.push("mode")
    if (productMasterId) out.push("master")
    if (scope) out.push("commitment")
    if (stopStep > 0) out.push("stop")
    if (sizeCode) out.push("axes")
    if (quantity > 0) out.push("preview")
    return out
}

interface ModeFlowCalloutProps {
    mode: LaunchMode
    layerCount: number
}

function ModeFlowCallout({ mode, layerCount }: ModeFlowCalloutProps) {
    const cfg: Record<LaunchMode, {
        tone: string
        title: string
        whatHappens: string
        whereUsed: string
        rollTag: string
    }> = {
        GENERIC: {
            tone: "bg-blue-50/80 ring-blue-200 text-blue-900",
            title: "Generic / Jumbo stock",
            whatHappens: `Output rolls tagged GENERIC_JUMBO with a layer signature${layerCount ? ` over ${layerCount} layer${layerCount > 1 ? "s" : ""}` : ""}. No customer or artwork commitment. Stop mid-route (e.g. after lamination) so an order can resume the rest of the steps.`,
            whereUsed: "Any matching sales order can claim these rolls via WCM Roll Picker · tier 3 (wider, will slit) or tier 4 (remainder pool).",
            rollTag: "roll_role = GENERIC_JUMBO · meta_json.layer_signature_hash set",
        },
        CUSTOMER: {
            tone: "bg-amber-50/80 ring-amber-200 text-amber-900",
            title: "Customer-committed stock",
            whatHappens: "Output rolls tagged with the customer. Allocator will prefer these for that customer's orders. Stop before artwork step if artwork unknown.",
            whereUsed: "Pulled automatically when the chosen customer places an order matching this master.",
            rollTag: "committed_customer set · layer_signature_hash set",
        },
        ARTWORK: {
            tone: "bg-fuchsia-50/80 ring-fuchsia-200 text-fuchsia-900",
            title: "Artwork-committed stock",
            whatHappens: "Output rolls already printed with the chosen artwork. Skip to post-print steps for any order that matches the artwork.",
            whereUsed: "Pulled by orders whose artwork id matches the committed artwork.",
            rollTag: "committed_artwork set · layer_signature_hash set",
        },
        CUSTOMER_ARTWORK: {
            tone: "bg-rose-50/80 ring-rose-200 text-rose-900",
            title: "Customer + artwork stock",
            whatHappens: "Most-locked stock kind. Both customer and artwork are pinned at launch.",
            whereUsed: "Reserved exclusively for that customer + artwork combination.",
            rollTag: "committed_customer + committed_artwork both set",
        },
        PACKAGING: {
            tone: "bg-emerald-50/80 ring-emerald-200 text-emerald-900",
            title: "Packaging stock",
            whatHappens: "Build in-house packaging products (inner pouch or sheet). Variant links manually to a fixed catalog SKU at /master/packaging.",
            whereUsed: "Drawn at the packing yard when an order's BOM lists this packaging item.",
            rollTag: "produced_by_product_variant linkage on InventoryMaterial",
        },
        POD: {
            tone: "bg-violet-50/80 ring-violet-200 text-violet-900",
            title: "POD stock",
            whatHappens: "Pre-positioned POD inventory pinned to defined POD SKU variants. Same manual-link model as Packaging.",
            whereUsed: "Drawn for pre-bound POD orders during fulfilment.",
            rollTag: "produced_by_product_variant linkage on InventoryMaterial",
        },
    }
    const c = cfg[mode] || cfg.GENERIC
    return (
        <div className={cn("mt-4 rounded-2xl px-4 py-3 ring-1", c.tone)}>
            <div className="flex items-center gap-2 text-[12px] font-black uppercase tracking-wider">
                <Sparkles className="h-3.5 w-3.5" />
                {c.title} · what happens next
            </div>
            <div className="mt-2 grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-3">
                <div className="rounded-lg bg-white/60 p-2 ring-1 ring-white/40">
                    <div className="text-[10px] font-black uppercase tracking-wider opacity-70">What happens</div>
                    <p className="mt-1 leading-4">{c.whatHappens}</p>
                </div>
                <div className="rounded-lg bg-white/60 p-2 ring-1 ring-white/40">
                    <div className="text-[10px] font-black uppercase tracking-wider opacity-70">Where used</div>
                    <p className="mt-1 leading-4">{c.whereUsed}</p>
                </div>
                <div className="rounded-lg bg-white/60 p-2 ring-1 ring-white/40">
                    <div className="text-[10px] font-black uppercase tracking-wider opacity-70">Roll metadata</div>
                    <p className="mt-1 font-mono text-[10px] leading-4">{c.rollTag}</p>
                </div>
            </div>
        </div>
    )
}

"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, Boxes, Layers, Loader2, Package, Palette, PackageCheck } from "lucide-react"

import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
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
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { RouteTimeline } from "@/components/erp/route-timeline"
import { templateService } from "@/services/templates"
import { masterDataService, type Material } from "@/services/master-data"
import {
    productMasterService,
    type LayerTemplateRow,
    type ProductKind,
    type ProductMaster,
    type ReportingGroup,
    type VariantAxisDef,
} from "@/services/product-master"
interface ProductMasterCreateModalProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    onCreated?: (master: ProductMaster) => void
}

const KIND_CARDS: Array<{
    id: ProductKind
    label: string
    icon: React.ReactNode
    summary: string
    accent: string
}> = [
    {
        id: "POUCH",
        label: "Finished pouch",
        icon: <Package className="h-4 w-4" />,
        summary: "Standup, pillow, or shaped pouches with multi-layer film.",
        accent: "border-blue-300 bg-blue-50 text-blue-700",
    },
    {
        id: "ROLL",
        label: "Roll / film",
        icon: <Layers className="h-4 w-4" />,
        summary: "Sellable or intermediate film roll. Width / thickness vary.",
        accent: "border-emerald-300 bg-emerald-50 text-emerald-700",
    },
    {
        id: "PACKAGING",
        label: "Packaging",
        icon: <Boxes className="h-4 w-4" />,
        summary: "Bags, gunny, sleeves consumed in BOM, in-house or purchased.",
        accent: "border-amber-300 bg-amber-50 text-amber-700",
    },
    {
        id: "POD",
        label: "POD",
        icon: <PackageCheck className="h-4 w-4" />,
        summary: "Print-on-demand inventory referenced from sales BOM.",
        accent: "border-violet-300 bg-violet-50 text-violet-700",
    },
    {
        id: "OTHER",
        label: "Other",
        icon: <Palette className="h-4 w-4" />,
        summary: "Specialty / one-off categories.",
        accent: "border-fuchsia-300 bg-fuchsia-50 text-fuchsia-700",
    },
]

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

const DEFAULT_VARIANT_AXES: VariantAxisDef[] = [
    { axis: "size", type: "geometry", required: true, label: "Size / geometry" },
    { axis: "layer_thicknesses", type: "per_layer_number", required: true, label: "Thickness per layer" },
    { axis: "layer_grades", type: "per_layer_enum", required: false, label: "Grade per layer" },
    { axis: "layer_widths", type: "per_layer_number", required: false, label: "Layer roll width override" },
]

function blankLayer(index: number): LayerTemplateRow {
    return {
        role: `layer-${index + 1}`,
        film_variant_code: "",
        thickness_micron: 0,
        default_grade: "",
        grade_options: [],
        thickness_apportion: "per_layer",
        default_input_roll_width_mm: null,
    }
}

export function ProductMasterCreateModal({ open, onOpenChange, onCreated }: ProductMasterCreateModalProps) {
    const router = useRouter()
    const queryClient = useQueryClient()
    const { toast } = useToast()

    const [code, setCode] = React.useState("")
    const [name, setName] = React.useState("")
    const [kind, setKind] = React.useState<ProductKind>("POUCH")
    const [reportingGroup, setReportingGroup] = React.useState<ReportingGroup>("FG")
    const [templateId, setTemplateId] = React.useState<string>("")
    const [active, setActive] = React.useState(true)
    const [description, setDescription] = React.useState("")
    const [layers, setLayers] = React.useState<LayerTemplateRow[]>(() => [blankLayer(0)])

    React.useEffect(() => {
        if (!open) return
        setCode("")
        setName("")
        setKind("POUCH")
        setReportingGroup("FG")
        setTemplateId("")
        setActive(true)
        setDescription("")
        setLayers([blankLayer(0)])
    }, [open])

    // Auto-suggest reporting group based on kind.
    React.useEffect(() => {
        if (kind === "POD") setReportingGroup("POD")
        else if (kind === "PACKAGING") setReportingGroup("PACKAGING")
        else if (kind === "ROLL") setReportingGroup("FILM")
        else if (kind === "POUCH") setReportingGroup("FG")
    }, [kind])

    const templateKind = kind === "POUCH" || kind === "ROLL" ? kind : undefined
    const { data: templates = [] } = useQuery({
        queryKey: ["product-master-create-templates", "live", templateKind || "any"],
        queryFn: () => templateService.getLiveTemplateOptions(templateKind ? { fg_type: templateKind } : undefined),
        enabled: open,
        staleTime: 5 * 60_000,
        refetchOnMount: "always",
        retry: 2,
        retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 5000),
        meta: { suppressGlobalError: true },
    })
    const { data: filmVariants = [] } = useQuery({
        queryKey: ["master-film-variants"],
        queryFn: masterDataService.getFilmVariants,
        enabled: open,
        staleTime: 60_000,
    })
    const { data: routeSteps = [], isFetching: routePreviewLoading } = useQuery({
        queryKey: ["product-master-create-route-steps", templateId],
        queryFn: () => templateService.getRouteSteps(templateId),
        enabled: open && !!templateId,
        staleTime: 60_000,
    })

    const normalizedLayers = React.useMemo(
        () =>
            layers.map((layer, index) => ({
                ...layer,
                role: `layer-${index + 1}`,
                thickness_micron: Number(layer.thickness_micron || 0),
                default_grade: layer.default_grade || "",
                grade_options: Array.isArray(layer.grade_options) ? layer.grade_options : [],
                thickness_apportion: layer.thickness_apportion || "per_layer",
                default_input_roll_width_mm: layer.default_input_roll_width_mm ?? null,
            })),
        [layers]
    )

    const createMutation = useMutation({
        mutationFn: () =>
            productMasterService.create({
                code,
                name,
                product_kind: kind,
                default_reporting_group: reportingGroup,
                template: templateId,
                default_template: templateId,
                template_name: templates.find((t: any) => t.id === templateId)?.name ?? null,
                layer_template: normalizedLayers,
                canonical_layer_stack: normalizedLayers,
                variant_axes: DEFAULT_VARIANT_AXES,
                fixed_attributes: {
                    fg_type: kind === "ROLL" ? "ROLL" : kind === "POUCH" ? "POUCH" : kind,
                    trim_loss_mm: 10,
                    trim_apply_to: "WIDTH",
                    gusset_apply_to: "HEIGHT",
                    gusset_factor: 1,
                    default_pouch_style: "STAND_UP",
                    print_capable: false,
                    artwork_required: false,
                },
                active,
                description,
            }),
        onSuccess: async (master) => {
            queryClient.setQueryData(["product-master", master.id], master)
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ["product-masters"] }),
                queryClient.invalidateQueries({ queryKey: ["product-master", master.id] }),
            ])
            toast({ title: "Product master created", description: `${master.code} ready to configure.` })
            onCreated?.(master)
            onOpenChange(false)
            router.push(`/master/products/${master.id}/edit`)
            router.refresh()
        },
        onError: (err: any) => {
            toast({ title: "Could not create", description: err?.message || "Try again", variant: "destructive" })
        },
    })

    const layersValid = layers.length > 0 && layers.every((layer) => Boolean(layer.film_variant_code))
    const valid = code.trim().length > 0 && name.trim().length > 0 && !!templateId && layersValid
    const routeTimelineSteps = React.useMemo(
        () =>
            routeSteps.map((step) => ({
                index: step.index || (step as any).sequence_number || 1,
                label: step.name || step.label || step.process_code || `Step ${step.index || 1}`,
                transition: (step as any).transition || `${step.input_form || ""}${step.input_form || step.output_form ? " → " : ""}${step.output_form || ""}`,
                tag: step.roll_behavior || (step as any).process_roll_behavior,
                artwork_step: Boolean((step as any).has_artwork || (step as any).artwork_step),
            })),
        [routeSteps]
    )

    const handleSubmit = () => {
        if (!valid) return
        createMutation.mutate()
    }

    function patchLayer(index: number, patch: Partial<LayerTemplateRow>) {
        setLayers((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
    }

    function addLayer() {
        setLayers((rows) => [...rows, blankLayer(rows.length)])
    }

    function removeLayer(index: number) {
        setLayers((rows) => rows.filter((_, i) => i !== index))
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex max-h-[calc(100dvh-1rem)] max-w-3xl flex-col gap-0 overflow-hidden rounded-3xl border-none p-0 shadow-2xl sm:max-h-[calc(100dvh-2rem)]">
                <div className="shrink-0 bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-600 px-6 py-5 text-white">
                    <DialogHeader className="space-y-1 border-none pb-0">
                        <div className="text-[10px] font-black uppercase tracking-[0.28em] text-white/70">
                            Master · Product
                        </div>
                        <DialogTitle className="font-display text-2xl font-bold leading-tight text-white">
                            New Product Master
                        </DialogTitle>
                        <DialogDescription className="text-white/80">
                            Capture the stable engineering contract first: live route/template and fixed layer recipe. Sizes,
                            axes, packaging, artwork, and overlays continue in the workspace.
                        </DialogDescription>
                    </DialogHeader>
                </div>
                <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-6">
                    <div className="space-y-2">
                        <Label className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">
                            Product kind
                        </Label>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                            {KIND_CARDS.map((k) => {
                                const isActive = k.id === kind
                                return (
                                    <button
                                        key={k.id}
                                        type="button"
                                        onClick={() => setKind(k.id)}
                                        className={cn(
                                            "flex items-start gap-2 rounded-xl border px-3 py-2.5 text-left shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300",
                                            isActive
                                                ? "border-blue-400 bg-gradient-to-br from-blue-50 to-white ring-2 ring-blue-200 shadow-blue-100"
                                                : "border-slate-200 bg-white hover:border-blue-200 hover:shadow-md"
                                        )}
                                    >
                                        <span
                                            className={cn(
                                                "mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-md ring-1 ring-inset",
                                                isActive ? "bg-blue-600 text-white ring-blue-700 shadow-sm shadow-blue-200" : k.accent
                                            )}
                                        >
                                            {k.icon}
                                        </span>
                                        <div>
                                            <div className="text-sm font-bold text-slate-900">{k.label}</div>
                                            <div className="text-[11px] leading-4 text-slate-500">{k.summary}</div>
                                        </div>
                                    </button>
                                )
                            })}
                        </div>

                        {/* Per-kind info banner — sets correct expectations after kind selection */}
                        {kind === "POD" && (
                            <div className="mt-3 flex items-start gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2.5 text-xs text-violet-800 ring-1 ring-violet-100">
                                <PackageCheck className="mt-0.5 h-3.5 w-3.5 flex-none text-violet-600" />
                                <div>
                                    <div className="font-bold text-violet-900">POD recipe — manual fixed-SKU link</div>
                                    <div className="text-violet-700">Define axes (width, thickness, grade) once. Create the POD variant here, then manually link it to an existing fixed POD roll SKU in <span className="font-mono font-bold">/master/pod</span>.</div>
                                </div>
                            </div>
                        )}
                        {kind === "PACKAGING" && (
                            <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800 ring-1 ring-amber-100">
                                <Boxes className="mt-0.5 h-3.5 w-3.5 flex-none text-amber-600" />
                                <div>
                                    <div className="font-bold text-amber-900">Packaging recipe — manual fixed-SKU link</div>
                                    <div className="text-amber-700">Define axes (capacity, thickness, grade). Create the packaging variant here, then manually link it to an existing fixed packaging SKU in <span className="font-mono font-bold">/master/packaging</span>.</div>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div>
                            <Label className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">
                                Master code
                            </Label>
                            <Input
                                placeholder="e.g. PM-DRY-PET-LD"
                                value={code}
                                onChange={(e) => setCode(e.target.value.toUpperCase())}
                                className="mt-1 h-10 rounded-xl"
                            />
                        </div>
                        <div>
                            <Label className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">
                                Reporting group
                            </Label>
                            <Select value={reportingGroup} onValueChange={(v) => setReportingGroup(v as ReportingGroup)}>
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
                                placeholder="e.g. Dry Fruit Standup Pouch — PET/LD food-grade"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                className="mt-1 h-10 rounded-xl"
                            />
                        </div>
                        <div className="sm:col-span-2">
                            <Label className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">
                                Live route / template
                            </Label>
                            <Select value={templateId} onValueChange={(v) => setTemplateId(v)}>
                                <SelectTrigger className="mt-1 h-10 rounded-xl">
                                    <SelectValue placeholder="Required: pick the route template this master will use" />
                                </SelectTrigger>
                                <SelectContent>
                                    {templates.map((t: any) => (
                                        <SelectItem key={t.id} value={t.id}>
                                            {t.name || t.code}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {!templateId && (
                                <div className="mt-1 text-[11px] font-semibold text-amber-700">
                                    Required. Sales/planner BOM and WCM steps come from this template.
                                </div>
                            )}
                            <div className="mt-3">
                                {templateId && routePreviewLoading ? (
                                    <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-600">
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        Loading route preview...
                                    </div>
                                ) : templateId && routeTimelineSteps.length ? (
                                    <RouteTimeline
                                        steps={routeTimelineSteps}
                                        helperText="This is the live route that sales, planner, WCM, and BOM preview will use after create."
                                    />
                                ) : templateId ? (
                                    <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-800">
                                        <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
                                        Template is selected but has no route steps yet. You can still create the master, but planner/WCM will need the template route fixed before go-live use.
                                    </div>
                                ) : null}
                            </div>
                        </div>
                        <div className="space-y-3 rounded-2xl border border-blue-100 bg-blue-50/40 p-3 sm:col-span-2">
                            <div className="flex items-center justify-between gap-3">
                                <div>
                                    <Label className="text-[10px] font-black uppercase tracking-[0.22em] text-blue-700">
                                        Fixed layer recipe
                                    </Label>
                                    <div className="mt-0.5 text-[11px] text-blue-700">
                                        Layer identity is fixed for this Product Master. Thickness/grade can later be optional or required variant axes.
                                    </div>
                                </div>
                                <Button type="button" size="sm" variant="outline" className="h-8 rounded-full bg-white text-xs" onClick={addLayer}>
                                    + Add layer
                                </Button>
                            </div>
                            <div className="space-y-2">
                                {layers.map((layer, index) => (
                                    <div key={index} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                                        <div className="mb-2 flex items-center justify-between">
                                            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-black text-blue-700 ring-1 ring-blue-200">
                                                L{index + 1}
                                            </span>
                                            {layers.length > 1 && (
                                                <button type="button" onClick={() => removeLayer(index)} className="rounded-md px-2 py-1 text-xs font-bold text-rose-600 hover:bg-rose-50">
                                                    Remove
                                                </button>
                                            )}
                                        </div>
                                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
                                            <div>
                                                <Label className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">Layer material</Label>
                                                {filmVariants.length ? (
                                                    <Select
                                                        value={layer.film_variant_id || layer.film_variant_code || ""}
                                                        onValueChange={(v) => {
                                                            const picked = filmVariants.find((m: Material) => m.id === v || m.code === v)
                                                            patchLayer(index, {
                                                                role: `layer-${index + 1}`,
                                                                film_variant_id: picked?.id || null,
                                                                film_variant_code: picked?.code || "",
                                                            })
                                                        }}
                                                    >
                                                        <SelectTrigger className="mt-1 h-9 rounded-xl text-xs">
                                                            <SelectValue placeholder="Required: select film" />
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
                                                    <div className="mt-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                                                        Add film variants first
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex items-end pb-1 text-right text-[11px] font-semibold text-slate-500">
                                                L{index + 1} fixed
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            {!layersValid && (
                                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-800">
                                    Required before create: choose the route template and one material for every layer. Thickness, grades, widths, sizes, packaging, POD, and artwork are configured in the workspace.
                                </div>
                            )}
                        </div>
                        <div className="sm:col-span-2">
                            <Label className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">
                                Description (optional)
                            </Label>
                            <Textarea
                                placeholder="What this master covers, special constraints, notes for sales/planner."
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                className="mt-1 min-h-[64px] rounded-xl"
                            />
                        </div>
                        <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2 sm:col-span-2">
                            <div>
                                <div className="text-sm font-bold text-slate-900">Active immediately</div>
                                <div className="text-[11px] text-slate-500">
                                    Sales and planner can pick this master right after create.
                                </div>
                            </div>
                            <Switch checked={active} onCheckedChange={setActive} />
                        </div>
                    </div>
                </div>
                <DialogFooter className="shrink-0 border-t border-slate-100 bg-slate-50/60 px-6 py-4">
                    <Button variant="outline" onClick={() => onOpenChange(false)} className="rounded-xl">
                        Cancel
                    </Button>
                    <Button
                        onClick={handleSubmit}
                        disabled={!valid || createMutation.isPending}
                        className="gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 shadow-lg shadow-blue-600/25 hover:shadow-xl hover:shadow-blue-600/30"
                    >
                        {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        Create & open workspace
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

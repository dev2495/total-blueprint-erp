"use client"

import { useEffect, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckCircle, ChevronDown, ChevronUp, GitBranch, Info, Loader2, Package, RefreshCw, ShieldAlert, Zap } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { templateService, TemplateBlueprint, TemplateMaterial, TemplateProcessStep, TemplateProcessStepRollHandlingRule } from "@/services/templates"

interface TemplateBomEditorProps {
    template: TemplateBlueprint
}

const SUPPORTED_BULK_CATEGORIES = ["GRANULE", "INK", "ADHESIVE", "SOLVENT", "ADDON", "POD"] as const
const MULTI_STEP_CATEGORIES = new Set(["ADHESIVE", "SOLVENT"])

function shortRule(value?: string) {
    return String(value || "default").replaceAll("_", " ").toLowerCase()
}

function basisLabel(value?: string) {
    const normalized = String(value || "").toUpperCase()
    if (normalized === "SNAPSHOT_GSM") return "Snapshot GSM"
    if (normalized === "CATEGORY_FORMULA") return "Master formula"
    if (normalized === "FIXED_PCS") return "Fixed pcs"
    if (normalized === "FIXED_KG") return "Fixed kg"
    return "Choose basis"
}

function issueLabel(mode?: string, value?: number) {
    const normalized = String(mode || "NONE").toUpperCase()
    const amount = Number(value || 0)
    if (normalized === "PERCENT_OVER_THEORY") return `${amount}% over`
    if (normalized === "FIXED_EXTRA_KG") return `+${amount} kg`
    if (normalized === "MINIMUM_ISSUE_KG") return `Min ${amount} kg`
    return "No uplift"
}

function captureLabel(value?: string) {
    const normalized = String(value || "AUTO_FROM_OUTPUT").toUpperCase()
    if (normalized === "AUTO_ESTIMATED_CONFIRM") return "Estimate + confirm"
    if (normalized === "OPERATOR_REQUIRED") return "Operator required"
    return "Auto from output"
}

function defaultSpecForStep(step: TemplateProcessStep): Partial<TemplateProcessStepRollHandlingRule> {
    const behavior = String(step.process_roll_behavior || "NONE").toUpperCase()
    const inputForm = String(step.process_input_form || "BULK").toUpperCase()
    const outputForm = String(step.process_output_form || "ROLL").toUpperCase()

    if (behavior === "CREATE_NEW") {
        return { input_roll_count: inputForm === "ROLL" ? 1 : 0, thickness_rule: "FIXED", width_rule: "OPERATOR", operator_entry_mode: "ROLL_MULTI" }
    }
    if (behavior === "MODIFY_EXISTING") {
        return { input_roll_count: 1, thickness_rule: "INHERIT_INPUT", width_rule: "LOCK_INPUT", operator_entry_mode: "PROCESS_DEFAULT" }
    }
    if (behavior === "MULTI_INPUT_COMBINE") {
        return {
            input_roll_count: 2,
            combine_mode: "LANE_GROUPS",
            input_lane_count: 2,
            lamination_pass_index: 1,
            active_min_layer_count: 2,
            adhesive_split_pct: 50,
            solvent_split_pct: 50,
            thickness_rule: "SUM_INPUTS",
            width_rule: "MIN_INPUT",
            operator_entry_mode: "PROCESS_DEFAULT",
        }
    }
    if (behavior === "SPLIT") {
        return { input_roll_count: 1, thickness_rule: "INHERIT_INPUT", width_rule: "OPERATOR_GRID", operator_entry_mode: "GRID_SPLIT" }
    }
    if (behavior === "NONE" && inputForm === "ROLL" && outputForm === "BULK") {
        return { input_roll_count: 1, thickness_rule: "TEMPLATE_DEFAULT", width_rule: "TEMPLATE_DEFAULT", operator_entry_mode: "KG_AND_PCS" }
    }
    return { input_roll_count: 0, thickness_rule: "TEMPLATE_DEFAULT", width_rule: "TEMPLATE_DEFAULT", operator_entry_mode: "PROCESS_DEFAULT" }
}

export function TemplateBomEditor({ template }: TemplateBomEditorProps) {
    const { toast } = useToast()
    const queryClient = useQueryClient()
    const [isSyncing, setIsSyncing] = useState(false)
    const [rollSpecDrafts, setRollSpecDrafts] = useState<Record<string, Partial<TemplateProcessStepRollHandlingRule>>>({})
    const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set())
    const [categoryRowErrors, setCategoryRowErrors] = useState<Record<string, string>>({})
    const [categoryRowPending, setCategoryRowPending] = useState<Record<string, boolean>>({})

    const { data: steps, isLoading: stepsLoading, isError: stepsError, error: stepsErrorDetail } = useQuery({
        queryKey: ["template-steps", template.id],
        queryFn: () => templateService.getProcessSteps(template.id),
        enabled: Boolean(template.id),
    })
    const { data: syncPreview } = useQuery({
        queryKey: ["template-sync-preview", template.id, steps?.length],
        queryFn: () => templateService.previewWorkflowSync(template.id),
        enabled: Boolean(template.id && template.routing_rule),
        retry: false,
    })

    const invalidate = () => {
        queryClient.invalidateQueries({ queryKey: ["template-steps", template.id] })
        queryClient.invalidateQueries({ queryKey: ["template-sync-preview", template.id] })
        queryClient.invalidateQueries({ queryKey: ["template-readiness", template.id] })
    }

    const syncMutation = useMutation({
        mutationFn: () => templateService.applyWorkflowSync(template.id),
        onSuccess: (res: any) => {
            invalidate()
            const count = Number(res?.steps_created || 0)
            toast({
                title: "Workflow synced",
                description: count > 0
                    ? `${count} route steps added. ${Number(res?.steps_preserved || 0)} preserved.`
                    : "Route sync completed.",
            })
        },
        onError: (err: any) => {
            toast({
                title: "Sync failed",
                description: err?.response?.data?.detail || err?.message || "Could not sync route steps.",
                variant: "destructive",
            })
        },
    })
    const rebuildMutation = useMutation({
        mutationFn: () => templateService.rebuildWorkflowFromRoute(template.id),
        onSuccess: () => {
            invalidate()
            toast({ title: "Workflow rebuilt", description: "Template steps were rebuilt from the routing rule." })
        },
        onError: (err: any) => {
            toast({
                title: "Rebuild failed",
                description: err?.response?.data?.detail || err?.message || "Could not rebuild route steps.",
                variant: "destructive",
            })
        },
    })
    const addMaterialMutation = useMutation({
        mutationFn: ({ stepId, data }: { stepId: string; data: any }) => templateService.addStepMaterial(template.id, stepId, data),
        onSuccess: () => {
            invalidate()
            toast({ title: "Category mapped" })
        },
        onError: (err: any) => {
            toast({
                title: "Category mapping failed",
                description: err?.response?.data?.detail || err?.response?.data?.category_code?.[0] || err?.message || "Could not map category to step.",
                variant: "destructive",
            })
        },
    })
    const removeMaterialMutation = useMutation({
        mutationFn: ({ stepId, materialId }: { stepId: string; materialId: string }) => templateService.removeStepMaterial(template.id, stepId, materialId),
        onSuccess: invalidate,
        onError: (err: any) => {
            toast({
                title: "Category unassign failed",
                description: err?.response?.data?.detail || err?.message || "Could not remove category mapping.",
                variant: "destructive",
            })
        },
    })
    const updateMaterialMutation = useMutation({
        mutationFn: ({ stepId, materialId, data }: { stepId: string; materialId: string; data: any }) => templateService.updateStepMaterial(template.id, stepId, materialId, data),
        onSuccess: invalidate,
        onError: (err: any) => {
            toast({
                title: "Material update failed",
                description: err?.response?.data?.detail || err?.message || "Could not update the step material rule.",
                variant: "destructive",
            })
        },
    })
    const updateRollSpecMutation = useMutation({
        mutationFn: ({ stepId, payload }: { stepId: string; payload: Partial<TemplateProcessStepRollHandlingRule> }) =>
            templateService.updateStepRollHandling(template.id, stepId, payload),
        onSuccess: () => {
            invalidate()
            toast({ title: "Step policy saved" })
        },
        onError: (err: any) => {
            toast({ title: "Save failed", description: err?.response?.data?.detail || err?.message, variant: "destructive" })
        },
    })

    const stepsList = steps || []
    const hasRoute = Boolean(template.routing_rule)
    const hasSteps = stepsList.length > 0
    const canAssignConsumptionStep = hasRoute && hasSteps
    const templateStatus = String(template.status || "").toUpperCase()
    const isReadOnly = templateStatus === "LIVE" || templateStatus === "OBSOLETE"

    useEffect(() => {
        const nextDrafts: Record<string, Partial<TemplateProcessStepRollHandlingRule>> = {}
        for (const step of steps || []) {
            const defaults = defaultSpecForStep(step)
            const saved = step.roll_handling || {}
            const merged = { ...defaults, ...saved }
            if (String(step.process_roll_behavior || "").toUpperCase() === "MULTI_INPUT_COMBINE") {
                merged.input_roll_count = 2
                merged.combine_mode = "LANE_GROUPS"
                merged.input_lane_count = Number(merged.input_lane_count || 2)
            }
            nextDrafts[step.id] = merged
        }
        setRollSpecDrafts(nextDrafts)
    }, [steps, template.id])

    useEffect(() => {
        if (!stepsList.length) return
        setExpandedSteps((prev) => {
            if (prev.size > 0) return prev
            return new Set([stepsList[0].id])
        })
    }, [stepsList])

    const setDraft = (stepId: string, patch: Partial<TemplateProcessStepRollHandlingRule>) => {
        setRollSpecDrafts((prev) => ({ ...prev, [stepId]: { ...(prev[stepId] || {}), ...patch } }))
    }

    const toggleStep = (stepId: string) => {
        setExpandedSteps((prev) => {
            const next = new Set(prev)
            if (next.has(stepId)) next.delete(stepId)
            else next.add(stepId)
            return next
        })
    }

    const theoreticalRequirements = (template.theoretical_requirements || [])
        .filter(Boolean)
        .filter((req) => req.category !== "FILM" && req.category !== "FILM_FAMILY" && req.category !== "FILM_VARIANT")

    const mappedByCategory = new Map<string, { stepId: string; stepName: string; matId: string }>()
    const mappedByCategoryList = new Map<string, Array<{ stepId: string; stepName: string; matId: string }>>()
    for (const step of stepsList) {
        for (const material of step.materials || []) {
            const sourceKind = String((material as any).source_kind || ((material as any).material ? "MATERIAL" : "CATEGORY")).toUpperCase()
            if (sourceKind !== "CATEGORY") continue
            const code = String((material as any).category_code || "").trim().toUpperCase()
            if (!code) continue
            const entry = { stepId: step.id, stepName: `${step.sequence_number}: ${step.process_name}`, matId: material.id }
            if (!mappedByCategory.has(code)) mappedByCategory.set(code, entry)
            mappedByCategoryList.set(code, [...(mappedByCategoryList.get(code) || []), entry])
        }
    }

    const getMappedMaterial = (categoryCode: string, stepId?: string) => {
        const normalized = String(categoryCode || "").toUpperCase()
        const mapping = stepId
            ? (mappedByCategoryList.get(normalized) || []).find((entry) => entry.stepId === stepId)
            : mappedByCategory.get(normalized)
        if (!mapping) return null
        const step = stepsList.find((candidate) => candidate.id === mapping.stepId)
        if (!step) return null
        const material = (step.materials || []).find((candidate) => candidate.id === mapping.matId)
        if (!material) return null
        return { mapping, step, material }
    }

    const groupedRequirementLookup = new Map<string, { count: number; totalWeightKg: number }>()
    for (const req of theoreticalRequirements) {
        const category = String((req as any).category || "").trim().toUpperCase()
        if (!category) continue
        const weightKg = Number((req as any).weight_kg ?? 0) || ((Number((req as any).weight_g ?? 0) || 0) / 1000)
        const existing = groupedRequirementLookup.get(category) || { count: 0, totalWeightKg: 0 }
        groupedRequirementLookup.set(category, { count: existing.count + 1, totalWeightKg: existing.totalWeightKg + weightKg })
    }

    const categoryOptions = Array.from(new Set([
        ...SUPPORTED_BULK_CATEGORIES,
        ...theoreticalRequirements.map((req) => String((req as any).category || "").trim().toUpperCase()).filter(Boolean),
        ...mappedByCategory.keys(),
    ]))
        .filter((code) => SUPPORTED_BULK_CATEGORIES.includes(code as any) || (code === "CHEMICAL" && mappedByCategory.has("CHEMICAL")))
        .sort()

    const handleSync = async () => {
        setIsSyncing(true)
        try {
            await syncMutation.mutateAsync()
        } finally {
            setIsSyncing(false)
        }
    }

    const handleAssignCategory = async (categoryCode: string, nextStepId: string | null, options?: { replaceExisting?: boolean }) => {
        const normalized = String(categoryCode || "").trim().toUpperCase()
        if (!normalized) return
        const legacyExisting = normalized === "CHEMICAL" && mappedByCategory.has("CHEMICAL")
        if (!SUPPORTED_BULK_CATEGORIES.includes(normalized as any) && !legacyExisting) {
            setCategoryRowErrors((prev) => ({ ...prev, [normalized]: "Unsupported category. Use GRANULE, INK, ADHESIVE, SOLVENT, ADDON, or POD." }))
            return
        }
        const existing = mappedByCategory.get(normalized)
        const existingForStep = nextStepId ? (mappedByCategoryList.get(normalized) || []).find((row) => row.stepId === nextStepId) : null
        setCategoryRowErrors((prev) => ({ ...prev, [normalized]: "" }))
        setCategoryRowPending((prev) => ({ ...prev, [normalized]: true }))
        try {
            if (!nextStepId) {
                const mappings = mappedByCategoryList.get(normalized) || []
                for (const mapping of mappings) {
                    await removeMaterialMutation.mutateAsync({ stepId: mapping.stepId, materialId: mapping.matId })
                }
                return
            }
            if (existingForStep) return
            if ((options?.replaceExisting ?? true) && existing) {
                await removeMaterialMutation.mutateAsync({ stepId: existing.stepId, materialId: existing.matId })
            }
            await addMaterialMutation.mutateAsync({
                stepId: nextStepId,
                data: { source_kind: "CATEGORY", category_code: normalized },
            })
        } catch (err: any) {
            const fieldErrors = err?.response?.data?.field_errors || {}
            const fieldMessage = fieldErrors?.category_code?.[0] || fieldErrors?.source_kind?.[0] || fieldErrors?.non_field_errors?.[0]
            const message = fieldMessage || err?.response?.data?.message || err?.response?.data?.detail || err?.message || "Category mapping failed."
            setCategoryRowErrors((prev) => ({ ...prev, [normalized]: String(message) }))
        } finally {
            setCategoryRowPending((prev) => ({ ...prev, [normalized]: false }))
        }
    }

    const saveStepPolicy = (stepId: string, draft: Partial<TemplateProcessStepRollHandlingRule>) => {
        updateRollSpecMutation.mutate({
            stepId,
            payload: {
                input_roll_count: Number(draft.input_roll_count || 0),
                combine_mode: (draft.combine_mode || "STRICT_ROLL_COUNT") as any,
                input_lane_count: Number(draft.input_lane_count || 0),
                lamination_pass_index: Number(draft.lamination_pass_index || 0),
                active_min_layer_count: Number(draft.active_min_layer_count || 0),
                adhesive_split_pct: Number(draft.adhesive_split_pct || 0),
                solvent_split_pct: Number(draft.solvent_split_pct || 0),
                thickness_rule: (draft.thickness_rule || "TEMPLATE_DEFAULT") as any,
                width_rule: (draft.width_rule || "TEMPLATE_DEFAULT") as any,
                operator_entry_mode: (draft.operator_entry_mode || "PROCESS_DEFAULT") as any,
                notes: draft.notes || "",
            },
        })
    }

    if (stepsLoading) return <div className="p-4 text-sm text-slate-400">Loading flow...</div>

    return (
        <Card className="overflow-hidden rounded-[2rem] border-slate-200 bg-white shadow-sm">
            <CardHeader className="border-b border-slate-100 bg-slate-50/60 p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex items-center gap-3">
                        <div className="grid h-10 w-10 place-items-center rounded-2xl bg-slate-950 text-white">
                            <Zap className="h-4 w-4" />
                        </div>
                        <div>
                            <CardTitle className="text-base font-black text-slate-950">Step material rules</CardTitle>
                            <p className="mt-1 text-xs font-semibold text-slate-500">Map categories to route stages, then keep issue and capture policy simple.</p>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        {!template.routing_rule ? (
                            <Badge variant="outline" className="border-rose-200 bg-rose-50 text-xs font-bold text-rose-600">No route selected</Badge>
                        ) : (
                            <Button
                                size="sm"
                                className="h-9 rounded-xl bg-slate-950 px-4 text-[11px] font-black text-white hover:bg-blue-600"
                                onClick={handleSync}
                                disabled={isReadOnly || isSyncing || !hasRoute}
                            >
                                <RefreshCw className="mr-2 h-3.5 w-3.5" />
                                {isSyncing ? "Syncing..." : "Sync stages"}
                            </Button>
                        )}
                        {hasRoute ? (
                            <Button
                                variant="outline"
                                size="sm"
                                className="h-9 rounded-xl text-[11px] font-bold"
                                onClick={() => rebuildMutation.mutate()}
                                disabled={isReadOnly || rebuildMutation.isPending || !hasRoute}
                            >
                                <ShieldAlert className="mr-2 h-3.5 w-3.5" />
                                {rebuildMutation.isPending ? "Rebuilding..." : "Rebuild"}
                            </Button>
                        ) : null}
                    </div>
                </div>
                {hasRoute && syncPreview ? (
                    <div className="mt-4 grid gap-2 md:grid-cols-3">
                        <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600">Keep / reorder <span className="font-black text-slate-950">{syncPreview.steps_to_keep?.length || 0}</span></div>
                        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">Create <span className="font-black">{syncPreview.steps_to_create?.length || 0}</span></div>
                        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">Remove from route <span className="font-black">{syncPreview.steps_to_mark_removed?.length || 0}</span></div>
                    </div>
                ) : null}
                {!template.routing_rule ? (
                    <p className="mt-4 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs font-semibold text-amber-800">
                        Save a routing rule first, then sync stages to unlock material mapping.
                    </p>
                ) : null}
            </CardHeader>
            <CardContent className="space-y-6 p-5">
                {stepsError ? (
                    <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                        <div className="font-bold">Step contracts could not load.</div>
                        <div className="mt-1 text-xs">{(stepsErrorDetail as any)?.response?.data?.detail || (stepsErrorDetail as Error)?.message || "Template steps are unavailable right now."}</div>
                    </div>
                ) : null}

                {!hasSteps ? (
                    <div className="rounded-3xl border-2 border-dashed border-slate-200 bg-slate-50 p-8 text-center">
                        <Package className="mx-auto mb-3 h-8 w-8 text-slate-300" />
                        <p className="text-sm font-medium text-slate-500">No production stages</p>
                        <p className="mt-1 text-xs text-slate-400">{hasRoute ? "Sync stages to generate the route map." : "Assign a routing rule first."}</p>
                    </div>
                ) : (
                    <div className="space-y-6">
                        <section>
                            <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                                <div>
                                    <div className="flex items-center gap-2 text-sm font-black text-slate-950">
                                        <GitBranch className="h-4 w-4 text-blue-600" />
                                        Stage controls
                                    </div>
                                    <p className="mt-1 text-xs font-semibold text-slate-500">Open only the step you need. Output rules affect the machine capture screen.</p>
                                </div>
                                <Badge variant="outline" className="rounded-full border-slate-200 bg-white text-[10px] font-black uppercase tracking-[0.16em] text-slate-600">
                                    {stepsList.length} stages · {mappedByCategoryList.size} categories mapped
                                </Badge>
                            </div>

                            <div className="space-y-3">
                                {stepsList.map((step) => {
                                    const draft = rollSpecDrafts[step.id] || { ...defaultSpecForStep(step), ...(step.roll_handling || {}) }
                                    const isExpanded = expandedSteps.has(step.id)
                                    const isSaving = updateRollSpecMutation.isPending
                                    const stepMaterials = step.materials || []
                                    const behavior = String(step.process_roll_behavior || "NONE").toUpperCase()
                                    const isLamination = behavior === "MULTI_INPUT_COMBINE"

                                    return (
                                        <Collapsible key={step.id} open={isExpanded} onOpenChange={() => toggleStep(step.id)}>
                                            <div className={cn(
                                                "overflow-hidden rounded-3xl border bg-white transition-all duration-200",
                                                isExpanded ? "border-blue-200 shadow-lg shadow-blue-500/10" : "border-slate-200 hover:border-slate-300"
                                            )}>
                                                <CollapsibleTrigger asChild>
                                                    <button type="button" className="flex w-full items-center gap-4 p-4 text-left">
                                                        <div className={cn(
                                                            "grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-sm font-black",
                                                            isExpanded ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500"
                                                        )}>
                                                            {step.sequence_number}
                                                        </div>
                                                        <div className="min-w-0 flex-1">
                                                            <div className="flex flex-wrap items-center gap-2">
                                                                <p className="truncate text-sm font-black text-slate-950">{step.process_name}</p>
                                                                <Badge variant="outline" className="border-slate-200 text-[9px]">{step.process_input_form} to {step.process_output_form}</Badge>
                                                                {behavior !== "NONE" ? (
                                                                    <Badge variant="outline" className="border-blue-100 text-[9px] text-blue-600">{behavior.replaceAll("_", " ")}</Badge>
                                                                ) : null}
                                                            </div>
                                                            <div className="mt-1 flex flex-wrap gap-2 text-[11px] font-semibold text-slate-500">
                                                                <span>{shortRule(draft.width_rule)} width</span>
                                                                <span>·</span>
                                                                <span>{shortRule(draft.thickness_rule)} thickness</span>
                                                                <span>·</span>
                                                                <span>{stepMaterials.length ? `${stepMaterials.length} material rule${stepMaterials.length === 1 ? "" : "s"}` : "No materials mapped"}</span>
                                                            </div>
                                                        </div>
                                                        <div className="flex shrink-0 items-center gap-2">
                                                            {stepMaterials.length > 0 ? <Badge className="bg-emerald-50 text-[9px] text-emerald-600">mapped</Badge> : null}
                                                            {isExpanded ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
                                                        </div>
                                                    </button>
                                                </CollapsibleTrigger>
                                                <CollapsibleContent>
                                                    <div className="space-y-4 border-t border-slate-100 bg-slate-50/60 px-4 pb-4 pt-4">
                                                        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
                                                            <div className="rounded-2xl border border-blue-100 bg-white p-4">
                                                                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                                                                    <div>
                                                                        <Label className="text-[10px] font-black uppercase tracking-[0.18em] text-blue-700">Output handling</Label>
                                                                        <p className="mt-1 text-[11px] font-semibold text-slate-500">
                                                                            {step.is_removed_from_route ? "This stage is marked removed from the active route." : "Only tune input count, size rules, and machine entry shape here."}
                                                                        </p>
                                                                    </div>
                                                                    <Button
                                                                        size="sm"
                                                                        className="h-8 rounded-xl bg-blue-600 px-4 text-[11px] font-black hover:bg-slate-950"
                                                                        disabled={isReadOnly || isSaving}
                                                                        onClick={() => saveStepPolicy(step.id, draft)}
                                                                    >
                                                                        {isSaving ? "Saving..." : "Save policy"}
                                                                    </Button>
                                                                </div>
                                                                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                                                                    <div>
                                                                        <Label className="text-[10px] text-slate-500">Input rolls</Label>
                                                                        <Input
                                                                            type="number"
                                                                            min={0}
                                                                            value={String(draft.input_roll_count ?? 0)}
                                                                            onChange={(event) => setDraft(step.id, { input_roll_count: Number(event.target.value || 0) })}
                                                                            className="mt-1 h-8 text-xs"
                                                                        />
                                                                    </div>
                                                                    <div>
                                                                        <Label className="text-[10px] text-slate-500">Thickness</Label>
                                                                        <Select value={String(draft.thickness_rule || "TEMPLATE_DEFAULT")} onValueChange={(value) => setDraft(step.id, { thickness_rule: value as any })}>
                                                                            <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                                                                            <SelectContent>
                                                                                <SelectItem value="INHERIT_INPUT">Inherit input</SelectItem>
                                                                                <SelectItem value="SUM_INPUTS">Sum inputs</SelectItem>
                                                                                <SelectItem value="FIXED">Fixed</SelectItem>
                                                                                <SelectItem value="TEMPLATE_DEFAULT">Template default</SelectItem>
                                                                            </SelectContent>
                                                                        </Select>
                                                                    </div>
                                                                    <div>
                                                                        <Label className="text-[10px] text-slate-500">Width</Label>
                                                                        <Select value={String(draft.width_rule || "TEMPLATE_DEFAULT")} onValueChange={(value) => setDraft(step.id, { width_rule: value as any })}>
                                                                            <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                                                                            <SelectContent>
                                                                                <SelectItem value="LOCK_INPUT">Lock input</SelectItem>
                                                                                <SelectItem value="MIN_INPUT">Smallest input</SelectItem>
                                                                                <SelectItem value="FIXED">Fixed</SelectItem>
                                                                                <SelectItem value="OPERATOR">Operator</SelectItem>
                                                                                <SelectItem value="OPERATOR_GRID">Operator grid</SelectItem>
                                                                                <SelectItem value="TEMPLATE_DEFAULT">Template default</SelectItem>
                                                                            </SelectContent>
                                                                        </Select>
                                                                    </div>
                                                                    <div>
                                                                        <Label className="text-[10px] text-slate-500">Machine entry</Label>
                                                                        <Select value={String(draft.operator_entry_mode || "PROCESS_DEFAULT")} onValueChange={(value) => setDraft(step.id, { operator_entry_mode: value as any })}>
                                                                            <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue /></SelectTrigger>
                                                                            <SelectContent>
                                                                                <SelectItem value="PROCESS_DEFAULT">Process default</SelectItem>
                                                                                <SelectItem value="ROLL_SINGLE">Single roll</SelectItem>
                                                                                <SelectItem value="ROLL_MULTI">Multi roll</SelectItem>
                                                                                <SelectItem value="GRID_SPLIT">Split grid</SelectItem>
                                                                                <SelectItem value="DISCRETE_ONLY">Discrete only</SelectItem>
                                                                                <SelectItem value="KG_AND_PCS">Bulk KG + PCS</SelectItem>
                                                                                <SelectItem value="KG_ONLY">Bulk KG only</SelectItem>
                                                                            </SelectContent>
                                                                        </Select>
                                                                    </div>
                                                                </div>
                                                                <div className="mt-3">
                                                                    <Label className="text-[10px] text-slate-500">Notes</Label>
                                                                    <Input
                                                                        type="text"
                                                                        value={String(draft.notes || "")}
                                                                        onChange={(event) => setDraft(step.id, { notes: event.target.value })}
                                                                        className="mt-1 h-8 text-xs"
                                                                        placeholder="Optional floor note"
                                                                    />
                                                                </div>
                                                                {isLamination ? (
                                                                    <div className="mt-3 rounded-2xl border border-blue-100 bg-blue-50/70 p-3">
                                                                        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                                                                            <Label className="text-[10px] font-black uppercase tracking-[0.18em] text-blue-700">Lamination lanes</Label>
                                                                            <Badge className="border border-blue-100 bg-white text-[10px] text-blue-700">Lane A + Lane B</Badge>
                                                                        </div>
                                                                        <div className="grid grid-cols-2 gap-2 lg:grid-cols-5">
                                                                            <div>
                                                                                <Label className="text-[10px] text-slate-500">Pass</Label>
                                                                                <Input type="number" min={1} value={String(draft.lamination_pass_index || 1)} onChange={(event) => setDraft(step.id, { lamination_pass_index: Number(event.target.value || 1) })} className="mt-1 h-8 text-xs" />
                                                                            </div>
                                                                            <div>
                                                                                <Label className="text-[10px] text-slate-500">Active from</Label>
                                                                                <Input type="number" min={2} value={String(draft.active_min_layer_count || 2)} onChange={(event) => setDraft(step.id, { active_min_layer_count: Number(event.target.value || 2) })} className="mt-1 h-8 text-xs" />
                                                                            </div>
                                                                            <div>
                                                                                <Label className="text-[10px] text-slate-500">Input lanes</Label>
                                                                                <Input type="number" min={2} max={2} value={String(draft.input_lane_count || 2)} onChange={(event) => setDraft(step.id, { input_lane_count: Number(event.target.value || 2), input_roll_count: 2 })} className="mt-1 h-8 text-xs" />
                                                                            </div>
                                                                            <div>
                                                                                <Label className="text-[10px] text-slate-500">Adhesive %</Label>
                                                                                <Input type="number" min={0} max={100} step="0.01" value={String(draft.adhesive_split_pct ?? 50)} onChange={(event) => setDraft(step.id, { adhesive_split_pct: Number(event.target.value || 0) })} className="mt-1 h-8 text-xs" />
                                                                            </div>
                                                                            <div>
                                                                                <Label className="text-[10px] text-slate-500">Solvent %</Label>
                                                                                <Input type="number" min={0} max={100} step="0.01" value={String(draft.solvent_split_pct ?? 50)} onChange={(event) => setDraft(step.id, { solvent_split_pct: Number(event.target.value || 0) })} className="mt-1 h-8 text-xs" />
                                                                            </div>
                                                                        </div>
                                                                        <div className="mt-2 grid gap-2 md:grid-cols-2">
                                                                            <div className="rounded-xl border border-blue-100 bg-white px-3 py-2">
                                                                                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Lane A</div>
                                                                                <div className="mt-1 text-xs font-bold text-slate-700">{Number(draft.lamination_pass_index || 1) <= 1 ? "Layer 1 rolls" : "Previous laminate WIP"}</div>
                                                                            </div>
                                                                            <div className="rounded-xl border border-blue-100 bg-white px-3 py-2">
                                                                                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Lane B</div>
                                                                                <div className="mt-1 text-xs font-bold text-slate-700">Layer {Math.max(2, Number(draft.lamination_pass_index || 1) + 1)} rolls</div>
                                                                            </div>
                                                                        </div>
                                                                    </div>
                                                                ) : null}
                                                            </div>

                                                            <div className="rounded-2xl border border-slate-200 bg-white p-4">
                                                                <Label className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Mapped inputs</Label>
                                                                {stepMaterials.length === 0 ? (
                                                                    <div className="mt-3 flex items-center gap-2 rounded-2xl bg-slate-50 p-3">
                                                                        <Info className="h-3.5 w-3.5 text-slate-400" />
                                                                        <span className="text-xs font-semibold text-slate-500">No categories mapped here.</span>
                                                                    </div>
                                                                ) : (
                                                                    <div className="mt-3 space-y-2">
                                                                        {stepMaterials.map((material: TemplateMaterial) => (
                                                                            <div key={material.id} className="rounded-2xl border border-slate-100 bg-slate-50 px-3 py-2">
                                                                                <div className="text-sm font-black text-slate-900">{String((material as any).category_code || "").toUpperCase() || "CATEGORY"}</div>
                                                                                <div className="mt-1 text-[11px] font-semibold text-slate-500">{basisLabel(material.consumption_basis)} · {issueLabel(material.issue_policy_mode, material.issue_policy_value)} · {captureLabel(material.capture_mode)}</div>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                )}
                                                                <p className="mt-3 text-[11px] font-semibold text-slate-500">Use Material mapping below to change stage assignment, issue uplift, and capture mode.</p>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </CollapsibleContent>
                                            </div>
                                        </Collapsible>
                                    )
                                })}
                            </div>
                        </section>

                        <section className="rounded-3xl border border-slate-200 bg-slate-50/70 p-4">
                            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                                <div>
                                    <Label className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Material mapping</Label>
                                    <p className="mt-1 text-xs font-semibold text-slate-500">For granules, ink, adhesive, solvent, POD, and add-ons, pick where issue happens and how the machine closes it.</p>
                                </div>
                                <Badge variant="outline" className="rounded-full border-slate-200 bg-white text-[10px] font-black uppercase tracking-[0.16em] text-slate-600">{categoryOptions.length} categories</Badge>
                            </div>
                            <div className="space-y-3">
                                {categoryOptions.map((categoryCode) => {
                                    const mapped = mappedByCategory.get(categoryCode)
                                    const mappedList = mappedByCategoryList.get(categoryCode) || []
                                    const reqMeta = groupedRequirementLookup.get(categoryCode)
                                    const mappedEntry = getMappedMaterial(categoryCode)
                                    const mappedMat = mappedEntry?.material
                                    const isRowPending = Boolean(categoryRowPending[categoryCode])
                                    const rowError = String(categoryRowErrors[categoryCode] || "").trim()
                                    const normalizedCategory = String(categoryCode || "").toUpperCase()
                                    const isMultiStep = MULTI_STEP_CATEGORIES.has(normalizedCategory)
                                    const isAddon = normalizedCategory === "ADDON"
                                    const isPod = normalizedCategory === "POD"
                                    const isChemLike = ["INK", "INKS", "CHEMICAL", "ADHESIVE", "SOLVENT"].includes(normalizedCategory)
                                    const selectedBasis = String(mappedMat?.consumption_basis || ((isAddon || isPod) ? "CATEGORY_FORMULA" : isChemLike ? "SNAPSHOT_GSM" : "FIXED_KG"))
                                    const showFormulaDriver = Boolean(mappedMat) && selectedBasis === "CATEGORY_FORMULA" && (isAddon || isPod)

                                    return (
                                        <div key={categoryCode} className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                                            <div className="grid gap-3 xl:grid-cols-[240px_minmax(280px,1fr)_minmax(360px,1.35fr)] xl:items-start">
                                                <div className="flex items-center gap-3">
                                                    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-50 text-slate-400">
                                                        <Package className="h-4 w-4" />
                                                    </div>
                                                    <div className="min-w-0">
                                                        <p className="truncate text-sm font-bold text-slate-800">{categoryCode}</p>
                                                        <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-tight text-slate-400">
                                                            {reqMeta ? `${reqMeta.count} rows · ${reqMeta.totalWeightKg.toFixed(3)} kg theory` : "Sales BOM category"}
                                                        </p>
                                                        {mappedEntry ? <p className="mt-1 text-[10px] font-bold text-emerald-700">Step {mappedEntry.step.sequence_number}: {mappedEntry.step.process_name}</p> : null}
                                                    </div>
                                                </div>

                                                <div>
                                                    {!hasSteps ? (
                                                        <Badge variant="outline" className="border-slate-200 text-[9px]">Sync route first</Badge>
                                                    ) : isMultiStep ? (
                                                        <div className="flex flex-wrap gap-2">
                                                            {stepsList.map((step) => {
                                                                const existingForStep = mappedList.find((entry) => entry.stepId === step.id)
                                                                const isMappedHere = Boolean(existingForStep)
                                                                return (
                                                                    <Button
                                                                        key={`${categoryCode}:${step.id}`}
                                                                        type="button"
                                                                        variant="outline"
                                                                        size="sm"
                                                                        className={cn(
                                                                            "h-8 rounded-xl px-3 text-[11px] font-bold",
                                                                            isMappedHere ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-500"
                                                                        )}
                                                                        disabled={isReadOnly || isRowPending}
                                                                        onClick={() => {
                                                                            if (existingForStep) {
                                                                                void removeMaterialMutation.mutateAsync({ stepId: existingForStep.stepId, materialId: existingForStep.matId })
                                                                            } else {
                                                                                void handleAssignCategory(categoryCode, step.id, { replaceExisting: false })
                                                                            }
                                                                        }}
                                                                    >
                                                                        Step {step.sequence_number}
                                                                    </Button>
                                                                )
                                                            })}
                                                        </div>
                                                    ) : (
                                                        <Select
                                                            value={mapped?.stepId || "__UNASSIGNED__"}
                                                            onValueChange={(value) => {
                                                                void handleAssignCategory(categoryCode, value === "__UNASSIGNED__" ? null : value)
                                                            }}
                                                            disabled={isReadOnly || !canAssignConsumptionStep || isRowPending}
                                                        >
                                                            <SelectTrigger className={cn("h-9 w-full rounded-xl border-slate-200 text-xs focus:ring-0", mapped ? "border-emerald-100 bg-emerald-50/50" : "bg-white")}>
                                                                <SelectValue placeholder="Assign stage" />
                                                            </SelectTrigger>
                                                            <SelectContent className="rounded-xl border-slate-100">
                                                                <SelectItem value="__UNASSIGNED__" className="text-xs text-slate-400">Unassigned</SelectItem>
                                                                {stepsList.map((step) => (
                                                                    <SelectItem key={step.id} value={step.id} className="text-xs">{step.sequence_number}: {step.process_name}</SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                    )}
                                                    <div className="mt-2 flex items-center gap-2">
                                                        {isRowPending ? (
                                                            <div className="grid h-7 w-7 place-items-center rounded-full bg-blue-50">
                                                                <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                                                            </div>
                                                        ) : null}
                                                        {mapped ? (
                                                            <div className="grid h-7 w-7 place-items-center rounded-full bg-emerald-50">
                                                                <CheckCircle className="h-4 w-4 text-emerald-500" />
                                                            </div>
                                                        ) : null}
                                                        {isMultiStep ? <span className="text-[10px] font-bold text-slate-500">{mappedList.length} mapped pass{mappedList.length === 1 ? "" : "es"}</span> : null}
                                                    </div>
                                                </div>

                                                <div className={cn("grid gap-2 md:grid-cols-2", showFormulaDriver ? "xl:grid-cols-5" : "xl:grid-cols-4")}>
                                                    <div className="space-y-1">
                                                        <Label className="text-[10px] text-slate-500">Basis</Label>
                                                        {mappedMat ? (
                                                            <Select
                                                                value={selectedBasis}
                                                                onValueChange={(value) => !isReadOnly && updateMaterialMutation.mutate({ stepId: mappedEntry!.step.id, materialId: mappedMat.id, data: { consumption_basis: value } })}
                                                                disabled={isReadOnly || isRowPending}
                                                            >
                                                                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                                                                <SelectContent>
                                                                    {isChemLike ? <SelectItem value="SNAPSHOT_GSM">Snapshot GSM</SelectItem> : null}
                                                                    {(isAddon || isPod) ? <SelectItem value="CATEGORY_FORMULA">Master formula</SelectItem> : null}
                                                                    {(!isChemLike && !isAddon && !isPod) ? <SelectItem value="FIXED_KG">Fixed KG</SelectItem> : null}
                                                                    {(!isChemLike && !isAddon && !isPod) ? <SelectItem value="FIXED_PCS">Fixed PCS</SelectItem> : null}
                                                                </SelectContent>
                                                            </Select>
                                                        ) : (
                                                            <div className="flex h-9 items-center rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 text-[11px] text-slate-400">Assign first</div>
                                                        )}
                                                    </div>
                                                    {showFormulaDriver ? (
                                                        <div className="space-y-1">
                                                            <Label className="text-[10px] text-slate-500">Formula</Label>
                                                            <Select
                                                                value={String(mappedMat?.formula_driver || (isAddon ? "ADDON_MASTER_WEIGHT_MODE" : isPod ? "POD_MASTER_PROFILE" : "NONE"))}
                                                                onValueChange={(value) => !isReadOnly && updateMaterialMutation.mutate({ stepId: mappedEntry!.step.id, materialId: mappedMat!.id, data: { formula_driver: value } })}
                                                                disabled={isReadOnly || isRowPending || (!isAddon && !isPod)}
                                                            >
                                                                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                                                                <SelectContent>
                                                                    {isAddon ? <SelectItem value="ADDON_MASTER_WEIGHT_MODE">Addon master</SelectItem> : null}
                                                                    {isPod ? <SelectItem value="POD_MASTER_PROFILE">POD profile</SelectItem> : null}
                                                                </SelectContent>
                                                            </Select>
                                                        </div>
                                                    ) : null}
                                                    <div className="space-y-1">
                                                        <Label className="text-[10px] text-slate-500">Issue</Label>
                                                        {mappedMat ? (
                                                            <Select
                                                                value={String(mappedMat.issue_policy_mode || "NONE")}
                                                                onValueChange={(value) => !isReadOnly && updateMaterialMutation.mutate({ stepId: mappedEntry!.step.id, materialId: mappedMat.id, data: { issue_policy_mode: value } })}
                                                                disabled={isReadOnly || isRowPending}
                                                            >
                                                                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                                                                <SelectContent>
                                                                    <SelectItem value="NONE">No uplift</SelectItem>
                                                                    <SelectItem value="PERCENT_OVER_THEORY">% over theory</SelectItem>
                                                                    <SelectItem value="FIXED_EXTRA_KG">Fixed extra kg</SelectItem>
                                                                    <SelectItem value="MINIMUM_ISSUE_KG">Minimum issue kg</SelectItem>
                                                                </SelectContent>
                                                            </Select>
                                                        ) : (
                                                            <div className="flex h-9 items-center rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 text-[11px] text-slate-400">Not mapped</div>
                                                        )}
                                                    </div>
                                                    <div className="space-y-1">
                                                        <Label className="text-[10px] text-slate-500">Value</Label>
                                                        {mappedMat ? (
                                                            <Input
                                                                key={`${mappedMat.id}:${mappedMat.issue_policy_value ?? 0}`}
                                                                type="number"
                                                                className="h-9 text-xs"
                                                                defaultValue={String(mappedMat.issue_policy_value ?? 0)}
                                                                disabled={isReadOnly || isRowPending}
                                                                onBlur={(event) => !isReadOnly && updateMaterialMutation.mutate({ stepId: mappedEntry!.step.id, materialId: mappedMat.id, data: { issue_policy_value: Number(event.target.value || 0) } })}
                                                            />
                                                        ) : (
                                                            <div className="flex h-9 items-center rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 text-[11px] text-slate-400">Not mapped</div>
                                                        )}
                                                    </div>
                                                    <div className="space-y-1">
                                                        <Label className="text-[10px] text-slate-500">Close</Label>
                                                        {mappedMat ? (
                                                            <Select
                                                                value={String(mappedMat.capture_mode || "AUTO_FROM_OUTPUT")}
                                                                onValueChange={(value) => !isReadOnly && updateMaterialMutation.mutate({ stepId: mappedEntry!.step.id, materialId: mappedMat.id, data: { capture_mode: value } })}
                                                                disabled={isReadOnly || isRowPending}
                                                            >
                                                                <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                                                                <SelectContent>
                                                                    <SelectItem value="AUTO_FROM_OUTPUT">Auto from output</SelectItem>
                                                                    <SelectItem value="AUTO_ESTIMATED_CONFIRM">Estimate + confirm</SelectItem>
                                                                    <SelectItem value="OPERATOR_REQUIRED">Operator required</SelectItem>
                                                                </SelectContent>
                                                            </Select>
                                                        ) : (
                                                            <div className="flex h-9 items-center rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 text-[11px] text-slate-400">Not mapped</div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                            {rowError ? (
                                                <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-semibold text-rose-700">{rowError}</div>
                                            ) : null}
                                        </div>
                                    )
                                })}
                            </div>
                        </section>
                    </div>
                )}
            </CardContent>
        </Card>
    )
}

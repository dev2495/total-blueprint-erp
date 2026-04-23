"use client"

import { useEffect, useMemo, useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { Zap, Package, Info, CheckCircle, ChevronDown, ChevronUp, GitBranch, ShieldAlert, RefreshCw, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { templateService, TemplateBlueprint, TemplateProcessStep, TemplateProcessStepRollHandlingRule } from "@/services/templates"
import { useToast } from "@/hooks/use-toast"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"

interface TemplateBomEditorProps {
    template: TemplateBlueprint
}

const SUPPORTED_BULK_CATEGORIES = ["GRANULE", "INK", "ADHESIVE", "SOLVENT", "ADDON", "POD"] as const
const MULTI_STEP_CATEGORIES = new Set(["ADHESIVE", "SOLVENT"])

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
        enabled: !!template.id
    })
    const { data: routeSteps = [] } = useQuery({
        queryKey: ["template-route-steps", template.id],
        queryFn: () => templateService.getRouteSteps(template.id),
        enabled: !!template.id && !!template.routing_rule,
    })
    const { data: syncPreview } = useQuery({
        queryKey: ["template-sync-preview", template.id, steps?.length],
        queryFn: () => templateService.previewWorkflowSync(template.id),
        enabled: !!template.id && !!template.routing_rule,
        retry: false,
    })

    // Mutations
    const syncMutation = useMutation({
        mutationFn: () => templateService.applyWorkflowSync(template.id),
        onSuccess: (res: any) => {
            queryClient.invalidateQueries({ queryKey: ["template-steps", template.id] })
            queryClient.invalidateQueries({ queryKey: ["template-sync-preview", template.id] })
            const count = Number(res?.steps_created || 0)
            toast({
                title: "Workflow Synced",
                description: count > 0
                    ? `${count} route steps added. ${Number(res?.steps_preserved || 0)} preserved, ${Number(res?.steps_marked_removed || 0)} marked removed.`
                    : "Route sync completed.",
            })
        },
        onError: (err: any) => {
            toast({
                title: "Sync failed",
                description: err?.response?.data?.detail || err?.message || "Could not sync route steps.",
                variant: "destructive",
            })
        }
    })
    const rebuildMutation = useMutation({
        mutationFn: () => templateService.rebuildWorkflowFromRoute(template.id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["template-steps", template.id] })
            queryClient.invalidateQueries({ queryKey: ["template-sync-preview", template.id] })
            toast({
                title: "Workflow rebuilt",
                description: "Template steps were rebuilt from the routing rule.",
            })
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
        mutationFn: ({ stepId, data }: { stepId: string, data: any }) =>
            templateService.addStepMaterial(template.id, stepId, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["template-steps", template.id] })
            toast({ title: "Added" })
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
        mutationFn: ({ stepId, materialId }: { stepId: string, materialId: string }) =>
            templateService.removeStepMaterial(template.id, stepId, materialId),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["template-steps", template.id] })
        },
        onError: (err: any) => {
            toast({
                title: "Category unassign failed",
                description: err?.response?.data?.detail || err?.message || "Could not remove category mapping.",
                variant: "destructive",
            })
        },
    })
    const updateMaterialMutation = useMutation({
        mutationFn: ({ stepId, materialId, data }: { stepId: string; materialId: string; data: any }) =>
            templateService.updateStepMaterial(template.id, stepId, materialId, data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["template-steps", template.id] })
        },
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
            queryClient.invalidateQueries({ queryKey: ["template-steps", template.id] })
            toast({ title: "Saved" })
        },
        onError: (err: any) => {
            toast({ title: "Error", description: err?.response?.data?.detail || err?.message, variant: "destructive" })
        }
    })

    const handleSync = async () => {
        setIsSyncing(true)
        try {
            await syncMutation.mutateAsync()
        } finally {
            setIsSyncing(false)
        }
    }

    const defaultSpecForStep = (step: TemplateProcessStep): Partial<TemplateProcessStepRollHandlingRule> => {
        const behavior = String(step.process_roll_behavior || "NONE").toUpperCase()
        const inputForm = String(step.process_input_form || "BULK").toUpperCase()
        const outputForm = String(step.process_output_form || "ROLL").toUpperCase()
        const filmLayerCount = 0

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
            return { input_roll_count: 1, thickness_rule: "TEMPLATE_DEFAULT", width_rule: "TEMPLATE_DEFAULT", operator_entry_mode: "DISCRETE_ONLY" }
        }
        return { input_roll_count: 0, thickness_rule: "TEMPLATE_DEFAULT", width_rule: "TEMPLATE_DEFAULT", operator_entry_mode: "PROCESS_DEFAULT" }
    }

    useEffect(() => {
        const filmLayerCount = 0

        const nextDrafts: Record<string, Partial<TemplateProcessStepRollHandlingRule>> = {}
        for (const step of (steps || [])) {
            const defaults = defaultSpecForStep(step)
            const saved = step.roll_handling || {}
            const merged = { ...defaults, ...saved }

            const behavior = String(step.process_roll_behavior || "NONE").toUpperCase()
            if (behavior === "MULTI_INPUT_COMBINE") {
                merged.input_roll_count = 2
                merged.combine_mode = "LANE_GROUPS"
                merged.input_lane_count = Number(merged.input_lane_count || 2)
            }

            nextDrafts[step.id] = merged
        }
        setRollSpecDrafts(nextDrafts)
    }, [steps?.length, template.id])

    const setDraft = (stepId: string, patch: Partial<TemplateProcessStepRollHandlingRule>) => {
        setRollSpecDrafts((prev) => ({ ...prev, [stepId]: { ...(prev[stepId] || {}), ...patch } }))
    }

    const toggleStep = (stepId: string) => {
        setExpandedSteps(prev => {
            const next = new Set(prev)
            if (next.has(stepId)) next.delete(stepId)
            else next.add(stepId)
            return next
        })
    }

    const theoreticalRequirements = (template.theoretical_requirements || [])
        .filter((req) => !!req)
        .filter((req) => req.category !== "FILM" && req.category !== "FILM_FAMILY" && req.category !== "FILM_VARIANT")

    const stepsList = steps || []
    const hasRoute = !!template.routing_rule
    const hasSteps = stepsList.length > 0
    const canAssignConsumptionStep = hasRoute && hasSteps
    const templateStatus = String(template.status || "").toUpperCase()
    const isReadOnly = templateStatus === "LIVE" || templateStatus === "OBSOLETE"

    const canSyncRouteSteps = hasRoute

    useEffect(() => {
        if (!stepsList.length) return
        setExpandedSteps((prev) => {
            if (prev.size > 0) return prev
            return new Set(stepsList.map((step) => step.id))
        })
    }, [stepsList])

    // Category mapping lookup (V2 primary)
    const mappedByCategory = new Map<string, { stepId: string; stepName: string; matId: string }>()
    const mappedByCategoryList = new Map<string, Array<{ stepId: string; stepName: string; matId: string }>>()
    for (const s of stepsList) {
        for (const m of (s.materials || [])) {
            const sourceKind = String((m as any).source_kind || ((m as any).material ? "MATERIAL" : "CATEGORY")).toUpperCase()
            if (sourceKind !== "CATEGORY") continue
            const code = String((m as any).category_code || "").trim().toUpperCase()
            if (!code) continue
            const entry = { stepId: s.id, stepName: `${s.sequence_number}: ${s.process_name}`, matId: m.id }
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
        const step = stepsList.find((s) => s.id === mapping.stepId)
        if (!step) return null
        const material = (step.materials || []).find((m) => m.id === mapping.matId)
        if (!material) return null
        return { mapping, step, material }
    }

    const groupedRequirements = useMemo(() => {
        const grouped = new Map<string, { category: string; count: number; totalWeightKg: number; names: string[] }>()
        for (const req of theoreticalRequirements) {
            const category = String((req as any).category || "").trim().toUpperCase()
            if (!category) continue
            const weightKg = Number((req as any).weight_kg ?? 0) || ((Number((req as any).weight_g ?? 0) || 0) / 1000)
            const row = grouped.get(category) || { category, count: 0, totalWeightKg: 0, names: [] }
            row.count += 1
            row.totalWeightKg += weightKg
            if ((req as any).name) row.names.push(String((req as any).name))
            grouped.set(category, row)
        }
        return Array.from(grouped.values())
    }, [theoreticalRequirements])

    const groupedRequirementLookup = useMemo(() => {
        const lookup = new Map<string, { count: number; totalWeightKg: number }>()
        for (const row of groupedRequirements) {
            lookup.set(String(row.category || "").toUpperCase(), {
                count: Number(row.count || 0),
                totalWeightKg: Number(row.totalWeightKg || 0),
            })
        }
        return lookup
    }, [groupedRequirements])

    const categoryOptions = useMemo(() => {
        const defaults = [...SUPPORTED_BULK_CATEGORIES]
        const all = new Set<string>(defaults)
        for (const req of theoreticalRequirements) {
            const code = String((req as any).category || "").trim().toUpperCase()
            if (code && !code.startsWith("FILM")) all.add(code)
        }
        for (const key of mappedByCategory.keys()) all.add(String(key || "").toUpperCase())
        return Array.from(all)
            .filter((code) => SUPPORTED_BULK_CATEGORIES.includes(code as any) || code === "CHEMICAL")
            .sort()
    }, [theoreticalRequirements, mappedByCategory])

    const handleAssignCategory = async (categoryCode: string, nextStepId: string | null, options?: { replaceExisting?: boolean }) => {
        const normalized = String(categoryCode || "").trim().toUpperCase()
        if (!normalized) return
        if (!SUPPORTED_BULK_CATEGORIES.includes(normalized as any) && normalized !== "CHEMICAL") {
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
                data: { source_kind: "CATEGORY", category_code: normalized }
            })
        } catch (err: any) {
            const fieldErrors = err?.response?.data?.field_errors || {}
            const fieldMessage =
                fieldErrors?.category_code?.[0]
                || fieldErrors?.source_kind?.[0]
                || fieldErrors?.non_field_errors?.[0]
            const message =
                fieldMessage
                || err?.response?.data?.message
                || err?.response?.data?.detail
                || err?.message
                || "Category mapping failed."
            setCategoryRowErrors((prev) => ({ ...prev, [normalized]: String(message) }))
        } finally {
            setCategoryRowPending((prev) => ({ ...prev, [normalized]: false }))
        }
    }

    if (stepsLoading) return <div className="p-4 text-sm text-slate-400">Loading flow...</div>

    return (
        <Card className="border-slate-100 shadow-sm">
            <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-indigo-50 rounded-xl">
                            <Zap className="h-4 w-4 text-indigo-500" />
                        </div>
                        <CardTitle className="text-sm font-bold text-slate-800">Production Flow & BOM</CardTitle>
                    </div>
                    {!template.routing_rule ? (
                        <Badge variant="outline" className="text-xs border-red-200 text-red-500">No Route</Badge>
                    ) : (
                        <Button
                            variant="default"
                            size="sm"
                            className="bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-bold rounded-xl h-9 px-4 shadow-lg shadow-indigo-500/10"
                            onClick={handleSync}
                            disabled={isReadOnly || isSyncing || !canSyncRouteSteps}
                        >
                            <RefreshCw className="h-3 w-3 mr-2" />
                            {isSyncing ? "Syncing..." : "Sync Workflow"}
                        </Button>
                    )}
                </div>
                {hasRoute && syncPreview && (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
                        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold text-slate-600">
                            Preserve / Reorder: <span className="font-black text-slate-900">{syncPreview.steps_to_keep?.length || 0}</span>
                        </div>
                        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-semibold text-emerald-700">
                            Create: <span className="font-black">{syncPreview.steps_to_create?.length || 0}</span>
                        </div>
                        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-700">
                            Mark Removed: <span className="font-black">{syncPreview.steps_to_mark_removed?.length || 0}</span>
                        </div>
                    </div>
                )}
                {hasRoute && (
                    <div className="flex flex-wrap items-center gap-3 mt-4">
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-9 text-[11px] font-bold"
                            onClick={() => rebuildMutation.mutate()}
                            disabled={isReadOnly || rebuildMutation.isPending || !canSyncRouteSteps}
                        >
                            <ShieldAlert className="h-3.5 w-3.5 mr-2" />
                            {rebuildMutation.isPending ? "Rebuilding..." : "Hard Rebuild"}
                        </Button>
                        <span className="text-[11px] text-slate-500">
                            Safe sync preserves existing step contracts. Hard rebuild is destructive and recreates the route map.
                        </span>
                    </div>
                )}
                {!template.routing_rule && (
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-md px-3 py-2">
                        Assign and save a routing rule first, then use Sync Workflow to generate step map.
                    </p>
                )}
            </CardHeader>
            <CardContent className="space-y-6">
                {stepsError ? (
                    <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                        <div className="font-bold">Step contracts could not load.</div>
                        <div className="text-xs mt-1">{(stepsErrorDetail as any)?.response?.data?.detail || (stepsErrorDetail as Error)?.message || "Template steps are unavailable right now."}</div>
                    </div>
                ) : null}
                {hasRoute && (
                    <div className="rounded-3xl border border-slate-100 bg-slate-50/70 p-5">
                        <div className="flex items-center gap-2 mb-4">
                            <GitBranch className="h-4 w-4 text-slate-500" />
                            <Label className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.2em]">Route Contract</Label>
                        </div>
                        <div className="grid gap-3">
                            {routeSteps.map((step: any) => (
                                <div
                                    key={`${step.index}:${step.process_code || step.name}`}
                                    className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-white px-4 py-3"
                                >
                                    <div className="min-w-0">
                                        <div className="text-sm font-bold text-slate-900">{step.label || `Step ${step.index} - ${step.name}`}</div>
                                        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                            {step.input_form || "BULK"} → {step.output_form || "ROLL"} • {String(step.roll_behavior || "NONE").replaceAll("_", " ")}
                                        </div>
                                    </div>
                                    <Badge variant="outline" className="text-[9px] border-slate-200">
                                        {step.process_code || "PROCESS"}
                                    </Badge>
                                </div>
                            ))}
                            {routeSteps.length === 0 && (
                                <div className="text-xs text-slate-400">No route steps are currently available for this routing rule.</div>
                            )}
                        </div>
                    </div>
                )}
                {/* No Steps State */}
                {!hasSteps ? (
                    <div className="p-8 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200 text-center">
                        <Package className="h-8 w-8 text-slate-300 mx-auto mb-3" />
                        <p className="text-sm font-medium text-slate-500">No Production Steps</p>
                        <p className="text-xs text-slate-400 mt-1">
                            {hasRoute ? "Click 'Sync Workflow' to generate and align the route step map." : "Assign a routing rule first."}
                        </p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {/* Step Cards */}
                        {stepsList.map((step: TemplateProcessStep) => {
                            const draft = rollSpecDrafts[step.id] || { ...defaultSpecForStep(step), ...(step.roll_handling || {}) }
                            const isExpanded = expandedSteps.has(step.id)
                            const isSaving = updateRollSpecMutation.isPending
                            const stepMaterials = step.materials || []

                            return (
                                <Collapsible key={step.id} open={isExpanded} onOpenChange={() => toggleStep(step.id)}>
                                    <div className={`backdrop-blur-xl transition-all duration-300 rounded-[2rem] overflow-hidden ${isExpanded ? 'bg-white/80 border-indigo-200 shadow-2xl shadow-indigo-500/10 ring-1 ring-indigo-50' : 'bg-white/40 border-slate-100 hover:bg-white/60'}`}>
                                        <CollapsibleTrigger asChild>
                                            <div className="flex items-center gap-5 p-5 cursor-pointer">
                                                <div className={`h-12 w-12 rounded-2xl flex items-center justify-center text-sm font-black transition-colors ${isExpanded ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30' : 'bg-white border border-slate-100 text-slate-400'}`}>
                                                    {step.sequence_number}
                                                </div>
                                                <div className="flex-1">
                                                    <p className="text-sm font-medium text-slate-800">{step.process_name}</p>
                                                    <div className="flex items-center gap-2 mt-1">
                                                        <Badge variant="outline" className="text-[9px] border-slate-200">
                                                            {step.process_input_form} → {step.process_output_form}
                                                        </Badge>
                                                        {step.process_roll_behavior && step.process_roll_behavior !== "NONE" && (
                                                            <Badge variant="outline" className="text-[9px] border-blue-100 text-blue-600">
                                                                {step.process_roll_behavior.replace("_", " ")}
                                                            </Badge>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    {stepMaterials.length > 0 && (
                                                        <Badge className="bg-emerald-50 text-emerald-600 text-[9px]">
                                                            {stepMaterials.length} items
                                                        </Badge>
                                                    )}
                                                    {isExpanded ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
                                                </div>
                                            </div>
                                        </CollapsibleTrigger>
                                        <CollapsibleContent>
                                            <div className="px-4 pb-4 space-y-4 border-t border-slate-50 pt-4">
                                                {/* Roll Handling Rules Editor */}
                                                <div className="p-4 bg-blue-50/50 rounded-xl border border-blue-100 space-y-4">
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-2">
                                                        <Label className="text-xs font-medium text-blue-700">Roll Handling Rules</Label>
                                                        {step.is_removed_from_route ? (
                                                            <Badge variant="outline" className="text-[9px] border-amber-200 text-amber-700 bg-amber-50">
                                                                Removed From Route
                                                            </Badge>
                                                        ) : null}
                                                    </div>
                                                    <Button
                                                        size="sm"
                                                        className="h-7 text-xs bg-blue-500 hover:bg-blue-600"
                                                        disabled={isReadOnly || isSaving}
                                                        onClick={() => updateRollSpecMutation.mutate({
                                                                stepId: step.id,
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
                                                                }
                                                            })}
                                                        >
                                                            {isSaving ? "Saving..." : "Save"}
                                                        </Button>
                                                    </div>
                                                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                                        <div>
                                                            <Label className="text-[10px] text-slate-500">Input Rolls</Label>
                                                            <Input
                                                                type="number"
                                                                min={0}
                                                                value={String(draft.input_roll_count ?? 0)}
                                                                onChange={(e) => setDraft(step.id, { input_roll_count: Number(e.target.value || 0) })}
                                                                className="h-8 text-xs mt-1"
                                                            />
                                                        </div>
                                                        <div>
                                                            <Label className="text-[10px] text-slate-500">Thickness</Label>
                                                            <Select
                                                                value={String(draft.thickness_rule || "TEMPLATE_DEFAULT")}
                                                                onValueChange={(v) => setDraft(step.id, { thickness_rule: v as any })}
                                                            >
                                                                <SelectTrigger className="h-8 text-xs mt-1">
                                                                    <SelectValue />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    <SelectItem value="INHERIT_INPUT">Inherit</SelectItem>
                                                                    <SelectItem value="SUM_INPUTS">Sum</SelectItem>
                                                                    <SelectItem value="TEMPLATE_DEFAULT">Default</SelectItem>
                                                                </SelectContent>
                                                            </Select>
                                                        </div>
                                                        <div>
                                                            <Label className="text-[10px] text-slate-500">Width</Label>
                                                            <Select
                                                                value={String(draft.width_rule || "TEMPLATE_DEFAULT")}
                                                                onValueChange={(v) => setDraft(step.id, { width_rule: v as any })}
                                                            >
                                                                <SelectTrigger className="h-8 text-xs mt-1">
                                                                    <SelectValue />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    <SelectItem value="LOCK_INPUT">Lock</SelectItem>
                                                                    <SelectItem value="MIN_INPUT">Min</SelectItem>
                                                                    <SelectItem value="OPERATOR">Operator</SelectItem>
                                                                    <SelectItem value="OPERATOR_GRID">Grid</SelectItem>
                                                                    <SelectItem value="TEMPLATE_DEFAULT">Default</SelectItem>
                                                                </SelectContent>
                                                            </Select>
                                                        </div>
                                                        <div>
                                                            <Label className="text-[10px] text-slate-500">Operator Entry</Label>
                                                            <Select
                                                                value={String(draft.operator_entry_mode || "PROCESS_DEFAULT")}
                                                                onValueChange={(v) => setDraft(step.id, { operator_entry_mode: v as any })}
                                                            >
                                                                <SelectTrigger className="h-8 text-xs mt-1">
                                                                    <SelectValue />
                                                                </SelectTrigger>
                                                                <SelectContent>
                                                                    <SelectItem value="PROCESS_DEFAULT">Process Default</SelectItem>
                                                                    <SelectItem value="ROLL_SINGLE">Single Roll</SelectItem>
                                                                    <SelectItem value="ROLL_MULTI">Multi Roll</SelectItem>
                                                                    <SelectItem value="GRID_SPLIT">Grid Split</SelectItem>
                                                                    <SelectItem value="DISCRETE_ONLY">Discrete Only</SelectItem>
                                                                </SelectContent>
                                                            </Select>
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <Label className="text-[10px] text-slate-500">Policy Notes</Label>
                                                        <Input
                                                            type="text"
                                                            value={String(draft.notes || "")}
                                                            onChange={(e) => setDraft(step.id, { notes: e.target.value })}
                                                            className="h-8 text-xs mt-1"
                                                            placeholder="Optional operator policy notes"
                                                        />
                                                    </div>
                                                    <p className="text-[10px] text-slate-500">
                                                        Refinement only: Process defines the physical behavior. Roll handling only tunes input count, width/thickness policy, and operator entry shape.
                                                    </p>
                                                    {String(step.process_roll_behavior || "").toUpperCase() === "MULTI_INPUT_COMBINE" ? (
                                                        <div className="rounded-2xl border border-indigo-100 bg-white/80 p-4">
                                                            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                                                                <div>
                                                                    <Label className="text-[10px] font-bold uppercase tracking-[0.22em] text-indigo-500">Lamination Pass Builder</Label>
                                                                    <p className="mt-1 text-[11px] font-semibold text-slate-500">
                                                                        Two lanes per pass. Pass 1 combines Layer 1 + Layer 2. Pass 2 combines prior laminate + Layer 3.
                                                                    </p>
                                                                </div>
                                                                <Badge className="bg-indigo-50 text-indigo-700 border border-indigo-100 text-[10px]">
                                                                    Lane based
                                                                </Badge>
                                                            </div>
                                                            <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
                                                                <div>
                                                                    <Label className="text-[10px] text-slate-500">Pass No.</Label>
                                                                    <Input
                                                                        type="number"
                                                                        min={1}
                                                                        value={String(draft.lamination_pass_index || 1)}
                                                                        onChange={(e) => setDraft(step.id, { lamination_pass_index: Number(e.target.value || 1) })}
                                                                        className="mt-1 h-8 text-xs"
                                                                    />
                                                                </div>
                                                                <div>
                                                                    <Label className="text-[10px] text-slate-500">Active From Layers</Label>
                                                                    <Input
                                                                        type="number"
                                                                        min={2}
                                                                        value={String(draft.active_min_layer_count || 2)}
                                                                        onChange={(e) => setDraft(step.id, { active_min_layer_count: Number(e.target.value || 2) })}
                                                                        className="mt-1 h-8 text-xs"
                                                                    />
                                                                </div>
                                                                <div>
                                                                    <Label className="text-[10px] text-slate-500">Input Lanes</Label>
                                                                    <Input
                                                                        type="number"
                                                                        min={2}
                                                                        max={2}
                                                                        value={String(draft.input_lane_count || 2)}
                                                                        onChange={(e) => setDraft(step.id, { input_lane_count: Number(e.target.value || 2), input_roll_count: 2 })}
                                                                        className="mt-1 h-8 text-xs"
                                                                    />
                                                                </div>
                                                                <div>
                                                                    <Label className="text-[10px] text-slate-500">Adhesive Split %</Label>
                                                                    <Input
                                                                        type="number"
                                                                        min={0}
                                                                        max={100}
                                                                        step="0.01"
                                                                        value={String(draft.adhesive_split_pct ?? 50)}
                                                                        onChange={(e) => setDraft(step.id, { adhesive_split_pct: Number(e.target.value || 0) })}
                                                                        className="mt-1 h-8 text-xs"
                                                                    />
                                                                </div>
                                                                <div>
                                                                    <Label className="text-[10px] text-slate-500">Solvent Split %</Label>
                                                                    <Input
                                                                        type="number"
                                                                        min={0}
                                                                        max={100}
                                                                        step="0.01"
                                                                        value={String(draft.solvent_split_pct ?? 50)}
                                                                        onChange={(e) => setDraft(step.id, { solvent_split_pct: Number(e.target.value || 0) })}
                                                                        className="mt-1 h-8 text-xs"
                                                                    />
                                                                </div>
                                                            </div>
                                                            <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
                                                                <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                                                                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Lane A</div>
                                                                    <div className="mt-1 text-xs font-bold text-slate-700">
                                                                        {Number(draft.lamination_pass_index || 1) <= 1 ? "Layer 1 rolls" : "Previous laminate WIP"}
                                                                    </div>
                                                                </div>
                                                                <div className="rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                                                                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">Lane B</div>
                                                                    <div className="mt-1 text-xs font-bold text-slate-700">
                                                                        Layer {Math.max(2, Number(draft.lamination_pass_index || 1) + 1)} rolls
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ) : null}
                                                </div>

                                                <div className="space-y-2">
                                                    <Label className="text-xs text-slate-500">Step Mapping Summary</Label>
                                                    {stepMaterials.length === 0 ? (
                                                        <div className="p-3 bg-slate-50 rounded-xl flex items-center gap-2">
                                                            <Info className="h-3.5 w-3.5 text-slate-400" />
                                                            <span className="text-xs text-slate-400">No categories mapped to this step yet. Use Category Mapping below.</span>
                                                        </div>
                                                    ) : (
                                                        <div className="rounded-xl border border-slate-200 bg-white p-3">
                                                            <div className="flex flex-wrap gap-2">
                                                                {stepMaterials.map((mat) => (
                                                                    <Badge key={mat.id} variant="outline" className="text-[10px] border-slate-200">
                                                                        {String((mat as any).category_code || "").toUpperCase() || "CATEGORY"}
                                                                    </Badge>
                                                                ))}
                                                            </div>
                                                            <p className="mt-2 text-[11px] text-slate-500">
                                                                Edit consumption basis, issue policy, capture mode, and optionality in the Category Mapping table.
                                                            </p>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </CollapsibleContent>
                                    </div>
                                </Collapsible>
                            )
                        })}

                        {/* Bulk Category Mapping */}
                        <div className="bg-slate-50/50 rounded-3xl p-6 border border-slate-100/60">
                            <div className="flex items-center justify-between mb-4">
                                <Label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Bulk Category Mapping + Policy + Capture</Label>
                                <Badge variant="outline" className="text-[9px] font-bold border-slate-200">{categoryOptions.length} Categories</Badge>
                            </div>
                            <div className="mb-4 rounded-2xl border border-slate-100 bg-white px-4 py-3 text-[11px] font-semibold text-slate-500">
                                Supported issue categories are fixed: GRANULE, INK, ADHESIVE, SOLVENT, ADDON, and POD. Legacy CHEMICAL rows stay visible only for old templates.
                            </div>
                            <div className="space-y-2.5">
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
                                        <div key={categoryCode} className="rounded-2xl border border-slate-100/60 bg-white p-4 shadow-sm hover:border-slate-200 transition-all">
                                            <div className="flex items-center gap-4 group">
                                                <div className="h-10 w-10 rounded-xl bg-slate-50 flex items-center justify-center text-slate-400 group-hover:bg-slate-100 transition-colors">
                                                    <Package className="h-4 w-4" />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-sm font-bold text-slate-800 truncate">{categoryCode}</p>
                                                    <p className="text-[10px] font-medium text-slate-400 uppercase tracking-tight">
                                                        {reqMeta
                                                            ? `${reqMeta.count} template rows • ${reqMeta.totalWeightKg.toFixed(3)} KG theoretical`
                                                            : "Sales BOM category mapping"}
                                                    </p>
                                                </div>
                                                <div className="flex items-center gap-3">
                                                    {!hasSteps ? (
                                                        <Badge variant="outline" className="text-[9px] border-slate-200">Sync first</Badge>
                                                    ) : isMultiStep ? (
                                                        <Badge variant="outline" className="text-[9px] border-indigo-200 bg-indigo-50 text-indigo-700">
                                                            {mappedList.length} pass step{mappedList.length === 1 ? "" : "s"} mapped
                                                        </Badge>
                                                    ) : (
                                                        <Select
                                                            value={mapped?.stepId || "__UNASSIGNED__"}
                                                            onValueChange={(v) => {
                                                                void handleAssignCategory(categoryCode, v === "__UNASSIGNED__" ? null : v)
                                                            }}
                                                            disabled={isReadOnly || !canAssignConsumptionStep || isRowPending}
                                                        >
                                                            <SelectTrigger className={`h-9 w-[220px] text-xs rounded-xl border-slate-100 focus:ring-0 ${mapped ? 'bg-emerald-50/30 border-emerald-100' : 'bg-slate-50'}`}>
                                                                <SelectValue placeholder="Assign Step..." />
                                                            </SelectTrigger>
                                                            <SelectContent className="rounded-xl border-slate-100">
                                                                <SelectItem value="__UNASSIGNED__" className="text-xs text-slate-400">Unassigned</SelectItem>
                                                                {stepsList.map((s) => (
                                                                    <SelectItem key={s.id} value={s.id} className="text-xs">
                                                                        {s.sequence_number}: {s.process_name}
                                                                    </SelectItem>
                                                                ))}
                                                            </SelectContent>
                                                        </Select>
                                                    )}
                                                    {isRowPending ? (
                                                        <div className="h-8 w-8 rounded-full bg-indigo-50 flex items-center justify-center">
                                                            <Loader2 className="h-4 w-4 text-indigo-500 animate-spin" />
                                                        </div>
                                                    ) : null}
                                                    {mapped && (
                                                        <div className="h-8 w-8 rounded-full bg-emerald-50 flex items-center justify-center">
                                                            <CheckCircle className="h-4 w-4 text-emerald-500" />
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                            {isMultiStep && hasSteps ? (
                                                <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                                                    {stepsList.map((s) => {
                                                        const existingForStep = mappedList.find((entry) => entry.stepId === s.id)
                                                        const isMappedHere = Boolean(existingForStep)
                                                        return (
                                                            <Button
                                                                key={`${categoryCode}:${s.id}`}
                                                                type="button"
                                                                variant="outline"
                                                                size="sm"
                                                                className={cn(
                                                                    "h-auto justify-start rounded-xl px-3 py-2 text-left text-[11px]",
                                                                    isMappedHere
                                                                        ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                                                                        : "border-slate-100 bg-slate-50 text-slate-500"
                                                                )}
                                                                disabled={isReadOnly || isRowPending}
                                                                onClick={() => {
                                                                    if (existingForStep) {
                                                                        void removeMaterialMutation.mutateAsync({ stepId: existingForStep.stepId, materialId: existingForStep.matId })
                                                                    } else {
                                                                        void handleAssignCategory(categoryCode, s.id, { replaceExisting: false })
                                                                    }
                                                                }}
                                                            >
                                                                <span className="font-black">Step {s.sequence_number}</span>
                                                                <span className="ml-2 truncate">{s.process_name}</span>
                                                            </Button>
                                                        )
                                                    })}
                                                </div>
                                            ) : null}
                                            {rowError ? (
                                                <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] font-semibold text-rose-700">
                                                    {rowError}
                                                </div>
                                            ) : null}
                                            <div className={cn("mt-4 grid grid-cols-1 md:grid-cols-2 gap-3", showFormulaDriver ? "xl:grid-cols-5" : "xl:grid-cols-4")}>
                                                <div className="space-y-1">
                                                    <Label className="text-[10px] text-slate-500">Consumption Basis</Label>
                                                    {mappedMat ? (
                                                        <Select
                                                            value={selectedBasis}
                                                            onValueChange={(value) =>
                                                                !isReadOnly && updateMaterialMutation.mutate({
                                                                    stepId: mappedEntry!.step.id,
                                                                    materialId: mappedMat.id,
                                                                    data: { consumption_basis: value },
                                                                })
                                                            }
                                                            disabled={isReadOnly || isRowPending}
                                                        >
                                                            <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                                                            <SelectContent>
                                                                {isChemLike ? (
                                                                    <SelectItem value="SNAPSHOT_GSM">Snapshot GSM</SelectItem>
                                                                ) : null}
                                                                {(isAddon || isPod) ? (
                                                                    <SelectItem value="CATEGORY_FORMULA">Category Formula</SelectItem>
                                                                ) : null}
                                                                {(!isChemLike && !isAddon && !isPod) ? <SelectItem value="FIXED_KG">Fixed KG</SelectItem> : null}
                                                                {(!isChemLike && !isAddon && !isPod) ? <SelectItem value="FIXED_PCS">Fixed PCS</SelectItem> : null}
                                                            </SelectContent>
                                                        </Select>
                                                    ) : (
                                                        <div className="h-9 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 text-[11px] text-slate-400 flex items-center">
                                                            Assign category to a step first
                                                        </div>
                                                    )}
                                                </div>
                                                {showFormulaDriver ? (
                                                    <div className="space-y-1">
                                                        <Label className="text-[10px] text-slate-500">Formula Driver</Label>
                                                        <Select
                                                            value={String(mappedMat?.formula_driver || (isAddon ? "ADDON_MASTER_WEIGHT_MODE" : isPod ? "POD_MASTER_PROFILE" : "NONE"))}
                                                            onValueChange={(value) =>
                                                                !isReadOnly && updateMaterialMutation.mutate({
                                                                    stepId: mappedEntry!.step.id,
                                                                    materialId: mappedMat!.id,
                                                                    data: { formula_driver: value },
                                                                })
                                                            }
                                                            disabled={isReadOnly || isRowPending || (!isAddon && !isPod)}
                                                        >
                                                            <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                                                            <SelectContent>
                                                                {isAddon ? (
                                                                    <SelectItem value="ADDON_MASTER_WEIGHT_MODE">Addon Master Weight Mode</SelectItem>
                                                                ) : null}
                                                                {isPod ? (
                                                                    <SelectItem value="POD_MASTER_PROFILE">POD Master Profile</SelectItem>
                                                                ) : null}
                                                            </SelectContent>
                                                        </Select>
                                                    </div>
                                                ) : null}
                                                <div className="space-y-1">
                                                    <Label className="text-[10px] text-slate-500">Issue Policy</Label>
                                                    {mappedMat ? (
                                                        <Select
                                                            value={String(mappedMat.issue_policy_mode || "NONE")}
                                                            onValueChange={(value) =>
                                                                !isReadOnly && updateMaterialMutation.mutate({
                                                                    stepId: mappedEntry!.step.id,
                                                                    materialId: mappedMat.id,
                                                                    data: { issue_policy_mode: value },
                                                                })
                                                            }
                                                            disabled={isReadOnly || isRowPending}
                                                        >
                                                            <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="NONE">No Uplift</SelectItem>
                                                                <SelectItem value="PERCENT_OVER_THEORY">% Over Theory</SelectItem>
                                                                <SelectItem value="FIXED_EXTRA_KG">Fixed Extra KG</SelectItem>
                                                                <SelectItem value="MINIMUM_ISSUE_KG">Minimum Issue KG</SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                    ) : (
                                                        <div className="h-9 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 text-[11px] text-slate-400 flex items-center">
                                                            Not mapped
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="space-y-1">
                                                    <Label className="text-[10px] text-slate-500">Issue Value</Label>
                                                    {mappedMat ? (
                                                        <Input
                                                            key={`${mappedMat.id}:${mappedMat.issue_policy_value ?? 0}`}
                                                            type="number"
                                                            className="h-9 text-xs"
                                                            defaultValue={String(mappedMat.issue_policy_value ?? 0)}
                                                            disabled={isReadOnly || isRowPending}
                                                            onBlur={(e) =>
                                                                !isReadOnly && updateMaterialMutation.mutate({
                                                                    stepId: mappedEntry!.step.id,
                                                                    materialId: mappedMat.id,
                                                                    data: { issue_policy_value: Number(e.target.value || 0) },
                                                                })
                                                            }
                                                        />
                                                    ) : (
                                                        <div className="h-9 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 text-[11px] text-slate-400 flex items-center">
                                                            Not mapped
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="space-y-1">
                                                    <Label className="text-[10px] text-slate-500">Capture Mode</Label>
                                                    {mappedMat ? (
                                                        <Select
                                                            value={String(mappedMat.capture_mode || "AUTO_FROM_OUTPUT")}
                                                            onValueChange={(value) =>
                                                                !isReadOnly && updateMaterialMutation.mutate({
                                                                    stepId: mappedEntry!.step.id,
                                                                    materialId: mappedMat.id,
                                                                    data: { capture_mode: value },
                                                                })
                                                            }
                                                            disabled={isReadOnly || isRowPending}
                                                        >
                                                            <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="AUTO_FROM_OUTPUT">Auto From Output</SelectItem>
                                                                <SelectItem value="AUTO_ESTIMATED_CONFIRM">Estimate + Confirm</SelectItem>
                                                                <SelectItem value="OPERATOR_REQUIRED">Operator Required</SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                    ) : (
                                                        <div className="h-9 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 text-[11px] text-slate-400 flex items-center">
                                                            Not mapped
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                            {mappedEntry ? (
                                                <div className="mt-3 text-[10px] font-bold text-slate-500">
                                                    Mapped Step: <span className="text-slate-900">{mappedEntry.step.sequence_number}: {mappedEntry.step.process_name}</span>
                                                </div>
                                            ) : null}
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    )
}

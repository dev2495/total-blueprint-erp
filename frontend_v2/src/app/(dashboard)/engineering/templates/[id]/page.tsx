"use client"

import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeft, CheckCircle2, Copy, GitBranch, Layers3, ShieldCheck, Workflow, XCircle } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { templateService, type TemplateProcessStep } from "@/services/templates"
import { routingService } from "@/services/routing"
import { TemplateBomEditor } from "@/components/engineering/template-bom-editor"
import { commercialFamilyService } from "@/services/commercial-families"

const err = (error: any) => error?.response?.data?.detail || error?.response?.data?.message || error?.message || "Request failed."

function StatusPill({ label, active }: { label: string; active: boolean }) {
    return <span className={`rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] ${active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{label}</span>
}

function plainBehaviour(value?: string) {
    const normalized = String(value || "").toUpperCase()
    if (normalized === "CREATE_NEW") return "Makes a new roll"
    if (normalized === "MODIFY_EXISTING") return "Works on an existing roll"
    if (normalized === "MULTI_INPUT_COMBINE") return "Combines lane rolls"
    if (normalized === "SPLIT") return "Splits one roll into many"
    return "Finishing or count-only step"
}

function StudioStepper({ template, steps, readiness }: { template: any; steps: TemplateProcessStep[]; readiness: any }) {
    const items = [
        ["Basics & family", Boolean(template.name && template.fg_type && template.default_stock_strategy)],
        ["Production route & stage rules", Boolean(template.routing_rule && steps.length)],
        ["Materials per stage", Boolean(steps.length && steps.some((step) => step.materials?.length))],
        ["Review & make live", Boolean(readiness?.ready)],
    ]
    return (
        <div className="grid gap-3 md:grid-cols-4">
            {items.map(([label, done], index) => (
                <div key={String(label)} className={`flex items-center gap-3 rounded-2xl border px-4 py-3 shadow-sm ${done ? "border-emerald-200 bg-emerald-50/80 text-emerald-950" : index === 1 ? "border-blue-200 bg-white text-blue-950 shadow-blue-500/10" : "border-slate-200 bg-white text-slate-700"}`}>
                    <div className={`grid h-8 w-8 place-items-center rounded-xl text-xs font-black ${done ? "bg-emerald-600 text-white" : index === 1 ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500"}`}>{done ? "✓" : index + 1}</div>
                    <div>
                        <div className={`text-[10px] font-black uppercase tracking-[0.14em] ${done ? "text-emerald-700" : index === 1 ? "text-blue-700" : "text-slate-400"}`}>{done ? `Step ${index + 1} · Complete` : index === 1 ? "You are here" : "Pending"}</div>
                        <div className="mt-0.5 text-sm font-semibold">{String(label)}</div>
                    </div>
                </div>
            ))}
        </div>
    )
}

function readinessPercent(template: any, steps: TemplateProcessStep[], readiness: any) {
    if (readiness?.ready) return 100
    const checks = [
        Boolean(template.name && template.fg_type && template.default_stock_strategy),
        Boolean(template.routing_rule && steps.length),
        Boolean(steps.length && steps.some((step) => step.materials?.length)),
        Boolean((readiness?.blockers || []).length === 0),
    ]
    return Math.round((checks.filter(Boolean).length / checks.length) * 100)
}

function ReadinessDashboard({ template, steps, readiness }: { template: any; steps: TemplateProcessStep[]; readiness: any }) {
    const pct = readinessPercent(template, steps, readiness)
    const blockers = readiness?.blockers || []
    const warnings = readiness?.warnings || []
    const materializedSteps = steps.filter((step) => step.materials?.length).length
    return (
        <section className="rounded-[20px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-5 xl:flex-row xl:items-start">
                <div className="min-w-[260px] flex-1">
                    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Template readiness</div>
                    <div className="mt-2 flex items-baseline gap-3">
                        <div className="text-3xl font-extrabold tracking-tight">{pct}<span className="text-xl text-slate-400">%</span></div>
                        <div className="text-sm font-medium text-slate-500">{materializedSteps} of {steps.length || 0} stages have material policy</div>
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-blue-50">
                        <span className="block h-full rounded-full bg-gradient-to-r from-blue-600 to-cyan-400" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                        <StatusPill label="Basics saved" active={Boolean(template.name)} />
                        <StatusPill label={template.routing_rule_name || "Route pending"} active={Boolean(template.routing_rule)} />
                        <StatusPill label={`${steps.length || 0} stages`} active={Boolean(steps.length)} />
                        <StatusPill label={readiness?.ready ? "Ready for live" : "Review needed"} active={Boolean(readiness?.ready)} />
                    </div>
                </div>
                <div className="hidden w-px self-stretch bg-slate-100 xl:block" />
                <div className="min-w-[320px] flex-1">
                    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Blocking checks</div>
                    <div className="mt-3 space-y-2 text-sm">
                        {blockers.slice(0, 3).map((item: string) => <div key={item} className="rounded-2xl border border-rose-100 bg-rose-50 px-3 py-2 font-semibold text-rose-800">Fix: {item}</div>)}
                        {!blockers.length && <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-3 py-2 font-semibold text-emerald-800">No blocking readiness issues.</div>}
                        {warnings.slice(0, 2).map((item: string) => <div key={item} className="rounded-2xl border border-amber-100 bg-amber-50 px-3 py-2 font-semibold text-amber-800">Advisory: {item}</div>)}
                    </div>
                </div>
                <div className="hidden w-px self-stretch bg-slate-100 xl:block" />
                <div className="min-w-[230px]">
                    <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">What is next</div>
                    <p className="mt-2 text-sm font-medium text-slate-500">{readiness?.ready ? "Publish or clone a new version when route policy is approved." : "Fix blockers, sync route stages, then move through engineering review."}</p>
                    <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs font-semibold text-slate-600">Layer thickness, grade, width, and actual order specs stay on SKU/order snapshots; this template owns route, lanes, and material policy.</div>
                </div>
            </div>
        </section>
    )
}

function LifecycleRail({ status }: { status: string }) {
    const stages = ["DRAFT", "ENGINEERING", "APPROVED", "LIVE", "OBSOLETE"]
    const activeIndex = Math.max(0, stages.indexOf(String(status || "DRAFT")))
    const descriptions = ["Editable", "Peer checks rules", "Locked for publish", "Used by planner", "Retired"]
    return (
        <section className="rounded-[20px] border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
                <div className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">Lifecycle</div>
                <span className="rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-blue-700">Currently: {String(status || "Draft").replace("_", " ")}</span>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-5">
                {stages.map((stage, index) => (
                    <div key={stage} className="text-center">
                        <div className={`mx-auto grid h-9 w-9 place-items-center rounded-full text-sm font-black ${index <= activeIndex ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-500"}`}>{index + 1}</div>
                        <div className="mt-2 text-sm font-black text-slate-900">{stage.replace("_", " ")}</div>
                        <div className="text-[11px] font-medium text-slate-500">{descriptions[index]}</div>
                    </div>
                ))}
            </div>
        </section>
    )
}

function ReadinessPanel({ readiness }: { readiness: any }) {
    const ready = Boolean(readiness?.ready)
    return (
        <Card className={`rounded-[2rem] border ${ready ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
            <CardContent className="p-5">
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-500">Review gate</div>
                        <div className={`mt-1 text-xl font-black ${ready ? "text-emerald-950" : "text-amber-950"}`}>{ready ? "Ready for LIVE publish" : "Needs attention before LIVE"}</div>
                    </div>
                    {ready ? <CheckCircle2 className="h-8 w-8 text-emerald-600" /> : <XCircle className="h-8 w-8 text-amber-600" />}
                </div>
                <div className="mt-4 space-y-2 text-sm">
                    {(readiness?.blockers || []).map((item: string) => <div key={item} className="rounded-2xl bg-white/70 px-3 py-2 font-semibold text-amber-900">{item}</div>)}
                    {(readiness?.warnings || []).map((item: string) => <div key={item} className="rounded-2xl bg-white/70 px-3 py-2 font-semibold text-slate-700">{item}</div>)}
                    {ready && !(readiness?.warnings || []).length && <div className="rounded-2xl bg-white/70 px-3 py-2 font-semibold text-emerald-800">Route, lifecycle, lane, and material checks passed.</div>}
                </div>
            </CardContent>
        </Card>
    )
}

function StepCard({ step }: { step: TemplateProcessStep }) {
    const spec = step.roll_handling
    const isLamination = String(step.process_roll_behavior || "").toUpperCase() === "MULTI_INPUT_COMBINE"
    return (
        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.24em] text-blue-600">Step {step.sequence_number}</div>
                        <h3 className="mt-1 text-lg font-black text-slate-950">{step.process_name}</h3>
                    <p className="mt-1 text-xs font-semibold text-slate-500">{plainBehaviour(step.process_roll_behavior)} • {step.process_input_form} to {step.process_output_form}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <StatusPill label={step.is_removed_from_route ? "removed" : "active"} active={!step.is_removed_from_route} />
                    {isLamination && <StatusPill label={`Pass ${spec?.lamination_pass_index || 1}`} active />}
                </div>
            </div>
            {isLamination ? (
                <div className="mt-4 rounded-3xl border border-blue-100 bg-blue-50 p-4">
                    <div className="flex items-center gap-2 text-sm font-black text-blue-950"><Layers3 className="h-4 w-4" /> Lamination pass builder</div>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <div className="rounded-2xl bg-white p-3 text-sm">
                            <b>Lane A</b>
                            <div className="mt-1 text-xs text-slate-500">{Number(spec?.lamination_pass_index || 1) <= 1 ? "Layer 1 roll group" : "Previous laminate WIP group"}</div>
                        </div>
                        <div className="rounded-2xl bg-white p-3 text-sm">
                            <b>Lane B</b>
                            <div className="mt-1 text-xs text-slate-500">Layer {Math.max(2, Number(spec?.lamination_pass_index || 1) + 1)} roll group</div>
                        </div>
                    </div>
                    <div className="mt-3 grid gap-3 text-xs md:grid-cols-4">
                        <div className="rounded-2xl bg-white p-3"><b>{spec?.input_lane_count || 2}</b><br />input lanes</div>
                        <div className="rounded-2xl bg-white p-3"><b>{spec?.adhesive_split_pct || 0}%</b><br />adhesive split</div>
                        <div className="rounded-2xl bg-white p-3"><b>{spec?.solvent_split_pct || 0}%</b><br />solvent split</div>
                        <div className="rounded-2xl bg-white p-3"><b>{spec?.width_rule === "MIN_INPUT" ? "Smallest input" : spec?.width_rule || "Smallest input"}</b><br />width rule</div>
                    </div>
                </div>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2">
                {(step.materials || []).map((material) => (
                    <span key={material.id} className="rounded-full bg-slate-100 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-slate-600">{material.category_code}</span>
                ))}
                {!step.materials?.length && <span className="text-xs font-semibold text-slate-400">No material categories mapped yet.</span>}
            </div>
        </div>
    )
}

export default function TemplateStudioPage() {
    const params = useParams()
    const id = params?.id as string
    const router = useRouter()
    const { toast } = useToast()
    const queryClient = useQueryClient()
    const [routingRuleId, setRoutingRuleId] = useState("")
    const [commercialFamilyId, setCommercialFamilyId] = useState("")

    const templateQuery = useQuery({ queryKey: ["template", id], queryFn: () => templateService.getTemplate(id) })
    const stepsQuery = useQuery({ queryKey: ["template-steps", id], queryFn: () => templateService.getProcessSteps(id), enabled: Boolean(id) })
    const readinessQuery = useQuery({ queryKey: ["template-readiness", id], queryFn: () => templateService.getReadiness(id), enabled: Boolean(id) })
    const routingRulesQuery = useQuery({ queryKey: ["routing-rules"], queryFn: () => routingService.getRules() })
    const commercialFamiliesQuery = useQuery({ queryKey: ["commercial-families"], queryFn: commercialFamilyService.getAll })

    const invalidate = () => {
        queryClient.invalidateQueries({ queryKey: ["template", id] })
        queryClient.invalidateQueries({ queryKey: ["template-steps", id] })
        queryClient.invalidateQueries({ queryKey: ["template-readiness", id] })
        queryClient.invalidateQueries({ queryKey: ["template-sync-preview", id] })
    }

    const updateMutation = useMutation({
        mutationFn: (data: any) => templateService.updateTemplate(id, data),
        onSuccess: () => {
            invalidate()
            toast({ title: "Template saved", description: "Basics and route binding updated." })
        },
        onError: (error) => toast({ title: "Save failed", description: err(error), variant: "destructive" }),
    })
    const syncMutation = useMutation({
        mutationFn: () => templateService.applyWorkflowSync(id),
        onSuccess: () => {
            invalidate()
            toast({ title: "Workflow synced", description: "Route stages are now aligned with the selected rule." })
        },
        onError: (error) => toast({ title: "Sync failed", description: err(error), variant: "destructive" }),
    })
    const approveMutation = useMutation({
        mutationFn: () => templateService.approveTemplate(id),
        onSuccess: () => {
            invalidate()
            toast({ title: "Template approved", description: "It remains editable until published LIVE." })
        },
        onError: (error) => toast({ title: "Approval failed", description: err(error), variant: "destructive" }),
    })
    const requestReviewMutation = useMutation({
        mutationFn: () => templateService.requestReview(id),
        onSuccess: () => {
            invalidate()
            toast({ title: "Sent for review", description: "Engineering review gate is now active." })
        },
        onError: (error) => toast({ title: "Review request failed", description: err(error), variant: "destructive" }),
    })
    const publishMutation = useMutation({
        mutationFn: () => templateService.makeLive(id),
        onSuccess: () => {
            invalidate()
            toast({ title: "Template is LIVE", description: "New planner releases can use this route contract." })
        },
        onError: (error) => toast({ title: "Publish failed", description: err(error), variant: "destructive" }),
    })
    const cloneMutation = useMutation({
        mutationFn: () => templateService.cloneTemplate(id),
        onSuccess: (template: any) => {
            toast({ title: "New version created", description: "Opening the cloned template now." })
            router.push(`/engineering/templates/${template.id}`)
        },
        onError: (error) => toast({ title: "Clone failed", description: err(error), variant: "destructive" }),
    })

    const template = templateQuery.data
    const steps = stepsQuery.data || template?.process_steps || []
    const readiness = readinessQuery.data || template?.readiness
    const laminationSteps = useMemo(() => steps.filter((step) => String(step.process_roll_behavior || "").toUpperCase() === "MULTI_INPUT_COMBINE"), [steps])

    if (templateQuery.isLoading) return <div className="p-8 text-sm text-slate-500">Loading template studio...</div>
    if (templateQuery.isError || !template) return <div className="p-8 text-sm text-rose-600">{err(templateQuery.error) || "Template not found."}</div>

    const isReadOnly = template.status === "LIVE" || template.status === "OBSOLETE"
    const nextLabel = template.status === "DRAFT" ? "Send for review" : template.status === "ENGINEERING" ? "Approve" : template.status === "APPROVED" ? "Publish LIVE" : template.status === "LIVE" ? "LIVE" : "Clone new version"

    return (
        <div className="space-y-6 p-4 lg:p-6">
            <section className="sticky top-2 z-20 rounded-[20px] border border-slate-200 bg-white/85 p-3 shadow-sm backdrop-blur">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                        <Button variant="outline" size="sm" onClick={() => router.back()} className="h-9 rounded-xl bg-white shadow-sm"><ArrowLeft className="mr-2 h-4 w-4" /> Back</Button>
                        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-950 text-sm font-black text-white">T</div>
                        <div className="min-w-0">
                            <div className="text-[11px] font-black uppercase tracking-[0.16em] text-slate-500">Template Studio · PRE-LIVE EDITOR</div>
                            <div className="truncate text-[15px] font-semibold text-slate-950">{template.name} · v{template.version || 1} {String(template.status || "draft").toLowerCase()}</div>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-bold text-slate-600">{template.fg_type || "Template"}</span>
                        <span className="rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-[11px] font-bold text-blue-700">{template.commercial_family_name || "Family unlinked"}</span>
                        <span className={`rounded-full border px-3 py-1 text-[11px] font-bold ${isReadOnly ? "border-emerald-100 bg-emerald-50 text-emerald-700" : "border-amber-100 bg-amber-50 text-amber-700"}`}>{isReadOnly ? "Live / locked" : "Editable"}</span>
                        <Button variant="outline" size="sm" onClick={() => cloneMutation.mutate()} disabled={cloneMutation.isPending} className="h-9 rounded-xl bg-white"><Copy className="mr-2 h-4 w-4" /> Duplicate</Button>
                    </div>
                </div>
                <div className="mt-3">
                    <StudioStepper template={template} steps={steps} readiness={readiness} />
                </div>
            </section>

            <ReadinessDashboard template={template} steps={steps} readiness={readiness} />
            <LifecycleRail status={template.status} />

            <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
                <main className="space-y-5">
                    <Card className="rounded-[2rem]">
                        <CardContent className="space-y-4 p-5">
                            <div className="flex items-center gap-2 text-sm font-black"><ShieldCheck className="h-4 w-4 text-blue-600" /> 1. Basics and route binding</div>
                            <div className="grid gap-4 md:grid-cols-2">
                                <div>
                                    <Label>Routing rule</Label>
                                    <Select value={routingRuleId || template.routing_rule || ""} onValueChange={setRoutingRuleId} disabled={isReadOnly}>
                                        <SelectTrigger><SelectValue placeholder="Select route rule" /></SelectTrigger>
                                        <SelectContent>{(routingRulesQuery.data || []).map((rule: any) => <SelectItem key={rule.id} value={rule.id}>{rule.name}</SelectItem>)}</SelectContent>
                                    </Select>
                                </div>
                                <div>
                                    <Label>Business family</Label>
                                    <Select value={commercialFamilyId || template.commercial_family || "__NONE__"} onValueChange={setCommercialFamilyId} disabled={isReadOnly}>
                                        <SelectTrigger><SelectValue placeholder="Select family" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="__NONE__">No linked business family</SelectItem>
                                            {(commercialFamiliesQuery.data || []).map((family: any) => <SelectItem key={family.id} value={family.id}>{family.name}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <div className="flex flex-wrap gap-2">
                                <Button disabled={isReadOnly || updateMutation.isPending} onClick={() => updateMutation.mutate({
                                    routing_rule: routingRuleId || template.routing_rule,
                                    commercial_family: (commercialFamilyId || template.commercial_family || "__NONE__") === "__NONE__" ? null : (commercialFamilyId || template.commercial_family),
                                })}>Save basics</Button>
                                <Button variant="outline" disabled={!template.routing_rule || syncMutation.isPending || isReadOnly} onClick={() => syncMutation.mutate()}><Workflow className="mr-2 h-4 w-4" /> Sync route stages</Button>
                                <Button variant="outline" onClick={() => cloneMutation.mutate()} disabled={cloneMutation.isPending}><Copy className="mr-2 h-4 w-4" /> Clone new version</Button>
                            </div>
                        </CardContent>
                    </Card>

                    <Card className="rounded-[2rem]">
                        <CardContent className="p-5">
                            <div className="mb-4 flex items-center gap-2 text-sm font-black"><GitBranch className="h-4 w-4 text-blue-600" /> 2. Route stages and lamination lanes</div>
                            <div className="mb-5 overflow-x-auto rounded-3xl border border-slate-100 bg-slate-50 p-4">
                                <div className="flex min-w-max items-center gap-3">
                                    {steps.map((step, index) => (
                                        <div key={step.id} className="flex items-center gap-3">
                                            <div className={`rounded-2xl border px-4 py-3 ${String(step.process_roll_behavior || "").toUpperCase() === "MULTI_INPUT_COMBINE" ? "border-amber-200 bg-amber-50" : "border-blue-100 bg-white"}`}>
                                                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Stage {step.sequence_number}</div>
                                                <div className="mt-1 text-sm font-black text-slate-950">{step.process_name}</div>
                                                <div className="mt-1 text-[10px] font-semibold text-slate-500">{plainBehaviour(step.process_roll_behavior)}</div>
                                            </div>
                                            {index < steps.length - 1 && <ArrowLeft className="h-4 w-4 rotate-180 text-slate-300" />}
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div className="space-y-3">
                                {steps.map((step) => <StepCard key={step.id} step={step} />)}
                                {!steps.length && <div className="rounded-3xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">No route stages yet. Select a routing rule and sync route stages.</div>}
                            </div>
                        </CardContent>
                    </Card>

                    <div>
                        <div className="mb-3 text-sm font-black">3. Material policy and capture rules</div>
                        <TemplateBomEditor template={template as any} />
                    </div>
                    <details className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
                        <summary className="cursor-pointer text-sm font-black">Template Studio glossary</summary>
                        <div className="mt-4 grid gap-3 text-xs md:grid-cols-3">
                            {[
                                ["Route stage", "One production process pulled from the routing rule."],
                                ["Lane", "A lamination input side; each lane may contain one or many physical rolls."],
                                ["Pass 1", "Combines layer 1 plus layer 2."],
                                ["Pass 2", "Combines pass-1 output plus layer 3 for 3-layer products."],
                                ["Issue policy", "How much material WCM asks the store/floor to issue."],
                                ["Capture mode", "How actual consumption is captured at machine close."],
                            ].map(([term, copy]) => <div key={term} className="rounded-2xl bg-slate-50 p-3"><b>{term}</b><br />{copy}</div>)}
                        </div>
                    </details>
                </main>

                <aside className="sticky top-4 h-fit space-y-5">
                    <ReadinessPanel readiness={readiness} />
                    <Card className="rounded-[2rem]">
                        <CardContent className="space-y-4 p-5">
                            <div className="text-sm font-black">4. Review and make live</div>
                            <div className="space-y-2 text-xs font-semibold text-slate-600">
                                <div>Route: {template.routing_rule_name || "Not selected"}</div>
                                <div>Family: {template.commercial_family_name || "Unlinked"}</div>
                                <div>Supported material categories: GRANULE, INK, ADHESIVE, SOLVENT, ADDON, POD</div>
                                <div>Layer truth remains in SKU/order snapshot; this template controls route and material policy.</div>
                            </div>
                            <Button className="w-full" disabled={isReadOnly || requestReviewMutation.isPending || approveMutation.isPending || publishMutation.isPending} onClick={() => {
                                if (template.status === "DRAFT") requestReviewMutation.mutate()
                                else if (template.status === "APPROVED") publishMutation.mutate()
                                else if (template.status === "ENGINEERING") approveMutation.mutate()
                                else if (template.status === "LIVE") cloneMutation.mutate()
                            }}>
                                <CheckCircle2 className="mr-2 h-4 w-4" /> {nextLabel}
                            </Button>
                        </CardContent>
                    </Card>
                </aside>
            </div>
        </div>
    )
}

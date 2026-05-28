"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeft, Save, Trash2, Scissors, Plus, X } from "lucide-react"

import { GradientHero } from "@/components/erp/gradient-hero"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { computeWebWidthPlan, webWidthPolicyService, type WebWidthPolicy } from "@/services/web-width-policy"
import { productMasterService, type ProductMaster } from "@/services/product-masters"
import { pouchStyleService, type PouchStyle } from "@/services/pouch-style"
import { factoryService, type Machine as FactoryMachine, type Process as FactoryProcess } from "@/services/factory"

interface Props {
    id?: string
    initialMode?: "new" | "edit"
}

export function PolicyEditor({ id, initialMode }: Props) {
    const router = useRouter()
    const qc = useQueryClient()
    const { toast } = useToast()
    const isNew = initialMode === "new" || !id

    const { data: existing } = useQuery({
        queryKey: ["web-width-policy", id],
        queryFn: () => webWidthPolicyService.get(id!),
        enabled: !isNew && !!id,
    })

    const [draft, setDraft] = React.useState<Partial<WebWidthPolicy>>(() => ({
        code: "",
        name: "",
        description: "",
        is_default: false,
        scope_type: "GLOBAL",
        scope_ref: "",
        allowed_lanes: [1, 2, 3],
        allowed_parent_widths: [],
        parent_width_strategy: "CALCULATED",
        min_parent_width_mm: "",
        max_parent_width_mm: "",
        slitting_waste_rule: { inter_cut_mm: 5, edge_trim_mm: 2, formula: "PER_CUT" },
        min_remainder_mm: 50,
        prefer_remainder_first: true,
        deprecated: false,
        notes: "",
    }))

    React.useEffect(() => {
        if (existing) setDraft(existing)
    }, [existing])

    const set = <K extends keyof WebWidthPolicy>(k: K, v: WebWidthPolicy[K]) => setDraft((d) => ({ ...d, [k]: v }))
    const effectiveScopeType = draft.scope_type || "GLOBAL"

    const { data: productMasters = [], isLoading: productMastersLoading } = useQuery({
        queryKey: ["web-width-policy-scope-product-masters"],
        queryFn: () => productMasterService.getProducts({ active: true, page_size: 500 } as any),
        enabled: effectiveScopeType === "PRODUCT_MASTER",
        staleTime: 60_000,
    })

    const { data: pouchStyles = [], isLoading: pouchStylesLoading } = useQuery({
        queryKey: ["web-width-policy-scope-pouch-styles"],
        queryFn: () => pouchStyleService.list({ deprecated: false, page_size: 500 }),
        enabled: effectiveScopeType === "POUCH_STYLE",
        staleTime: 60_000,
    })

    const { data: processes = [], isLoading: processesLoading } = useQuery({
        queryKey: ["web-width-policy-scope-processes"],
        queryFn: () => factoryService.getProcesses(),
        enabled: effectiveScopeType === "PROCESS",
        staleTime: 60_000,
    })

    const { data: machines = [], isLoading: machinesLoading } = useQuery({
        queryKey: ["web-width-policy-scope-machines"],
        queryFn: () => factoryService.getMachines(),
        enabled: effectiveScopeType === "MACHINE",
        staleTime: 60_000,
    })

    const saveMutation = useMutation({
        mutationFn: async () => {
            const body = {
                code: draft.code || "",
                name: draft.name || "",
                description: draft.description || "",
                is_default: !!draft.is_default,
                scope_type: draft.scope_type || "GLOBAL",
                scope_ref: draft.scope_type === "GLOBAL" ? "" : draft.scope_ref || "",
                allowed_lanes: (draft.allowed_lanes as any) || [],
                allowed_parent_widths: (draft.allowed_parent_widths as any) || [],
                parent_width_strategy: draft.parent_width_strategy || "CALCULATED",
                min_parent_width_mm: draft.min_parent_width_mm || null,
                max_parent_width_mm: draft.max_parent_width_mm || null,
                slitting_waste_rule: draft.slitting_waste_rule || {},
                min_remainder_mm: Number(draft.min_remainder_mm || 50),
                prefer_remainder_first: !!draft.prefer_remainder_first,
                deprecated: !!draft.deprecated,
                notes: draft.notes || "",
            }
            if (isNew) return webWidthPolicyService.create(body as any)
            return webWidthPolicyService.update(id!, body as any)
        },
        onSuccess: (saved) => {
            toast({ title: isNew ? "Policy created" : "Saved", description: saved.code })
            qc.invalidateQueries({ queryKey: ["web-width-policies"] })
            if (isNew) router.push(`/master/web-width-policies/${saved.id}`)
        },
        onError: (e: any) => toast({ title: "Failed", description: String(e?.response?.data?.detail || e?.message || e), variant: "destructive" }),
    })

    const removeMutation = useMutation({
        mutationFn: async () => webWidthPolicyService.remove(id!),
        onSuccess: () => { toast({ title: "Deleted" }); router.push("/master/web-width-policies") },
        onError: (e: any) => toast({ title: "Delete failed", description: String(e?.message || e), variant: "destructive" }),
    })

    const allowedLanes = (draft.allowed_lanes as number[]) || []
    const allowedParents = (draft.allowed_parent_widths as number[]) || []
    const rule = (draft.slitting_waste_rule as any) || {}
    const setRule = (k: string, v: any) => set("slitting_waste_rule", { ...rule, [k]: v } as any)
    const [previewChild, setPreviewChild] = React.useState(440)
    const [previewLane, setPreviewLane] = React.useState(2)
    const previewPlan = computeWebWidthPlan(previewChild, previewLane, draft as WebWidthPolicy)
    const scopeNeedsRef = effectiveScopeType !== "GLOBAL"
    const scopeOptions = React.useMemo(
        () => buildScopeRefOptions(effectiveScopeType, { productMasters, pouchStyles, processes, machines }),
        [effectiveScopeType, productMasters, pouchStyles, processes, machines],
    )
    const visibleScopeOptions = React.useMemo(() => {
        if (!draft.scope_ref || scopeOptions.some((o) => o.value === draft.scope_ref)) return scopeOptions
        return [
            {
                value: draft.scope_ref,
                label: `${draft.scope_ref} · saved ref not found`,
                detail: "This saved ref is not in the current active master list. Pick a listed master before changing this policy.",
            },
            ...scopeOptions,
        ]
    }, [draft.scope_ref, scopeOptions])
    const scopeLoading = (
        (effectiveScopeType === "PRODUCT_MASTER" && productMastersLoading) ||
        (effectiveScopeType === "POUCH_STYLE" && pouchStylesLoading) ||
        (effectiveScopeType === "PROCESS" && processesLoading) ||
        (effectiveScopeType === "MACHINE" && machinesLoading)
    )
    const selectedScopeOption = visibleScopeOptions.find((o) => o.value === draft.scope_ref)
    const scopeRefMissing = scopeNeedsRef && !draft.scope_ref

    const exampleParent = React.useMemo(() => {
        return computeWebWidthPlan(440, 3, draft as WebWidthPolicy).planned_parent_width_mm
    }, [draft])

    return (
        <div className="min-h-screen bg-gradient-to-b from-slate-50/80 via-white to-slate-50/40 px-4 py-4 sm:px-6">
            <GradientHero
                palette="violet"
                eyebrow={isNew ? "NEW WEB-WIDTH POLICY" : "WEB-WIDTH POLICY"}
                title={draft.name || (isNew ? "Build a new policy" : "Policy")}
                subtitle="Sets lane-up choices, parent-web calculation, standard parent-width behavior, and WCM remainder rules."
            >
                <div className="mt-3">
                    <Link href="/master/web-width-policies" className="inline-flex items-center gap-1 rounded-full bg-white/15 px-3 py-1 text-[11px] font-bold text-white backdrop-blur ring-1 ring-white/20 hover:bg-white/25">
                        <ArrowLeft className="h-3 w-3" /> back to list
                    </Link>
                </div>
            </GradientHero>

            <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
                <div className="space-y-5">
                    {/* Identity */}
                    <Card title="Identity">
                        <div className="grid gap-3 sm:grid-cols-2">
                            <Field label="Code (unique)">
                                <Input value={draft.code || ""} onChange={(e) => set("code", e.target.value.toUpperCase() as any)} className="font-mono" placeholder="STANDARD" />
                            </Field>
                            <Field label="Name">
                                <Input value={draft.name || ""} onChange={(e) => set("name", e.target.value as any)} placeholder="Standard slit · 1-up to 3-up" />
                            </Field>
                            <Field label="Description" className="sm:col-span-2">
                                <Textarea rows={2} value={draft.description || ""} onChange={(e) => set("description", e.target.value as any)} />
                            </Field>
                            <label className="flex items-center gap-2 text-[12px]">
                                <input type="checkbox" checked={!!draft.is_default} onChange={(e) => set("is_default", e.target.checked as any)} />
                                <span className="font-bold">Default policy</span>
                                <span className="text-[10px] text-slate-500">(fallback when no scoped policy matches)</span>
                            </label>
                            <Field label="Scope">
                                <select
                                    value={effectiveScopeType}
                                    onChange={(e) => setDraft((d) => ({
                                        ...d,
                                        scope_type: e.target.value as WebWidthPolicy["scope_type"],
                                        scope_ref: "",
                                    }))}
                                    className="h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-[12px]"
                                >
                                    <option value="GLOBAL">Global fallback</option>
                                    <option value="PRODUCT_KIND">Product kind</option>
                                    <option value="PRODUCT_MASTER">Product master</option>
                                    <option value="POUCH_STYLE">Pouch style</option>
                                    <option value="PROCESS">Process</option>
                                    <option value="MACHINE">Machine</option>
                                </select>
                            </Field>
                            {scopeNeedsRef ? (
                                <Field label="Scope ref">
                                    <select
                                        value={draft.scope_ref || ""}
                                        onChange={(e) => set("scope_ref", e.target.value as any)}
                                        disabled={scopeLoading || visibleScopeOptions.length === 0}
                                        className="h-9 w-full rounded-xl border border-slate-200 bg-white px-3 font-mono text-[12px] disabled:bg-slate-50 disabled:text-slate-400"
                                    >
                                        <option value="">
                                            {scopeLoading
                                                ? "Loading options..."
                                                : visibleScopeOptions.length
                                                    ? `Pick ${scopeLabel(effectiveScopeType).toLowerCase()}`
                                                    : `No ${scopeLabel(effectiveScopeType).toLowerCase()} options found`}
                                        </option>
                                        {visibleScopeOptions.map((option) => (
                                            <option key={option.value} value={option.value}>
                                                {option.label}
                                            </option>
                                        ))}
                                    </select>
                                    <div className="mt-1 min-h-4 text-[10px] text-slate-500">
                                        {selectedScopeOption?.detail || "Only listed master records can be selected for this scope."}
                                    </div>
                                </Field>
                            ) : null}
                        </div>
                    </Card>

                    {/* Allowed lanes */}
                    <Card title="Allowed lane counts">
                        <p className="-mt-1 mb-3 text-[11px] text-slate-500">Which N-up runs production can do for this policy scope. Sales-order lane picker shows only these.</p>
                        <div className="flex flex-wrap gap-2">
                            {[1, 2, 3, 4, 5, 6].map((n) => {
                                const on = allowedLanes.includes(n)
                                return (
                                    <button
                                        key={n}
                                        type="button"
                                        onClick={() => {
                                            const next = on ? allowedLanes.filter((v) => v !== n) : [...allowedLanes, n].sort((a, b) => a - b)
                                            set("allowed_lanes", next as any)
                                        }}
                                        className={cn(
                                            "rounded-xl px-4 py-2 font-mono text-[12px] font-bold ring-1",
                                            on ? "bg-violet-600 text-white ring-violet-700" : "bg-white text-slate-600 ring-slate-200 hover:bg-slate-50",
                                        )}
                                    >
                                        {n}-up
                                    </button>
                                )
                            })}
                        </div>
                    </Card>

                    {/* Parent widths */}
                    <Card title="Parent web strategy">
                        <div className="grid gap-3 sm:grid-cols-3">
                            <Field label="Strategy">
                                <select
                                    value={draft.parent_width_strategy || "CALCULATED"}
                                    onChange={(e) => set("parent_width_strategy", e.target.value as any)}
                                    className="h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-[12px]"
                                >
                                    <option value="CALCULATED">Calculated width</option>
                                    <option value="NEAREST_STANDARD">Nearest standard parent</option>
                                    <option value="STRICT_STANDARD">Require standard parent</option>
                                </select>
                            </Field>
                            <Field label="Min parent width (mm)">
                                <Input type="number" value={String(draft.min_parent_width_mm ?? "")} onChange={(e) => set("min_parent_width_mm", e.target.value as any)} placeholder="optional" />
                            </Field>
                            <Field label="Max parent width (mm)">
                                <Input type="number" value={String(draft.max_parent_width_mm ?? "")} onChange={(e) => set("max_parent_width_mm", e.target.value as any)} placeholder="optional" />
                            </Field>
                        </div>
                        <p className="mt-3 text-[11px] text-slate-500">
                            Calculated mode keeps exact math. Nearest standard snaps to the next configured parent width. Strict standard blocks the order if no configured width fits.
                        </p>
                    </Card>

                    <Card title="Standard parent widths">
                        <p className="-mt-1 mb-3 text-[11px] text-slate-500">Use for standard jumbo/slit widths such as 880, 1320, 1500. Leave empty if this policy should only use calculated widths.</p>
                        <div className="flex flex-wrap items-center gap-2">
                            {allowedParents.map((w, i) => (
                                <span key={i} className="flex items-center gap-1 rounded-full bg-violet-100 px-2 py-1 font-mono text-[11px] font-bold text-violet-900">
                                    {w} mm
                                    <button onClick={() => set("allowed_parent_widths", allowedParents.filter((_, j) => j !== i) as any)} className="opacity-50 hover:opacity-100"><X className="h-3 w-3" /></button>
                                </span>
                            ))}
                            <ParentWidthAdder onAdd={(w) => set("allowed_parent_widths", [...allowedParents, w].sort((a, b) => a - b) as any)} />
                        </div>
                    </Card>

                    {/* Slit trim */}
                    <Card title="Slitting trim rule">
                        <div className="grid gap-3 sm:grid-cols-3">
                            <Field label="Inter-cut trim (mm)">
                                <Input type="number" value={Number(rule.inter_cut_mm ?? 5)} onChange={(e) => setRule("inter_cut_mm", Number(e.target.value || 0))} />
                            </Field>
                            <Field label="Edge trim (mm)">
                                <Input type="number" value={Number(rule.edge_trim_mm ?? 2)} onChange={(e) => setRule("edge_trim_mm", Number(e.target.value || 0))} />
                            </Field>
                            <Field label="Formula">
                                <select
                                    value={String(rule.formula || "PER_CUT")}
                                    onChange={(e) => setRule("formula", e.target.value)}
                                    className="h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-[12px]"
                                >
                                    <option value="PER_CUT">PER_CUT (trim each cut)</option>
                                    <option value="PER_LANE">PER_LANE (trim per lane)</option>
                                    <option value="FIXED">FIXED (constant)</option>
                                </select>
                            </Field>
                        </div>
                        <div className="mt-3 rounded-xl bg-slate-900 px-3 py-2 font-mono text-[12px] text-emerald-300">
                            For 440 mm child × 3 lanes: parent = <b className="text-white">{exampleParent} mm</b> using this policy.
                        </div>
                    </Card>

                    {/* Remainder */}
                    <Card title="Remainder handling">
                        <div className="grid gap-3 sm:grid-cols-2">
                            <Field label="Min remainder to keep (mm)">
                                <Input type="number" value={Number(draft.min_remainder_mm || 50)} onChange={(e) => set("min_remainder_mm", Number(e.target.value || 0) as any)} />
                                <div className="mt-1 text-[10px] text-slate-500">Remainders narrower than this go to scrap.</div>
                            </Field>
                            <label className="flex flex-col gap-1 self-end">
                                <div className="text-[10px] font-black uppercase tracking-widest text-slate-500">Allocation preference</div>
                                <label className="mt-1 flex items-center gap-2 text-[12px]">
                                    <input type="checkbox" checked={!!draft.prefer_remainder_first} onChange={(e) => set("prefer_remainder_first", e.target.checked as any)} />
                                    <span><b>Prefer remainders first</b> when allocating</span>
                                </label>
                            </label>
                        </div>
                    </Card>
                </div>

                <div className="space-y-5">
                    <Card title="Save">
                        <div className="flex flex-col gap-2">
                            <Button
                                onClick={() => saveMutation.mutate()}
                                disabled={saveMutation.isPending || !draft.code || !draft.name || scopeRefMissing}
                                className="bg-violet-600 text-white hover:bg-violet-700"
                            >
                                <Save className="mr-1.5 h-4 w-4" />
                                {saveMutation.isPending ? "Saving…" : isNew ? "Create policy" : "Save changes"}
                            </Button>
                            {!isNew ? (
                                <Button
                                    variant="outline"
                                    onClick={() => { if (confirm("Delete this policy?")) removeMutation.mutate() }}
                                    className="border-rose-300 text-rose-700 hover:bg-rose-50"
                                >
                                    <Trash2 className="mr-1.5 h-4 w-4" /> Delete
                                </Button>
                            ) : null}
                        </div>
                    </Card>
                    <Card title="Live preview">
                        <div className="grid gap-2">
                            <div className="grid grid-cols-2 gap-2">
                                <Field label="Child width">
                                    <Input type="number" value={previewChild} onChange={(e) => setPreviewChild(Number(e.target.value || 0))} />
                                </Field>
                                <Field label="Lane">
                                    <Input type="number" value={previewLane} onChange={(e) => setPreviewLane(Number(e.target.value || 1))} />
                                </Field>
                            </div>
                            <div className="rounded-xl bg-violet-600 p-3 text-white">
                                <div className="text-[10px] font-black uppercase tracking-widest text-violet-100">planned parent</div>
                                <div className="mt-1 font-display text-2xl font-extrabold">
                                    {Math.round(previewPlan.planned_parent_width_mm)} mm
                                </div>
                                <div className="mt-1 text-[10px] text-violet-100">
                                    run {Math.round(previewPlan.computed_run_width_mm)} · trim {Math.round(previewPlan.trim_mm)} · rem {Math.round(previewPlan.remainder_mm)} {previewPlan.remainder_disposition.toLowerCase()}
                                </div>
                            </div>
                            {previewPlan.warnings.length ? <div className="rounded-lg bg-amber-50 px-2 py-1 text-[11px] font-bold text-amber-900">{previewPlan.warnings.join(" ")}</div> : null}
                        </div>
                    </Card>
                </div>
            </div>
        </div>
    )
}

type ScopeRefOption = {
    value: string
    label: string
    detail?: string
}

const PRODUCT_KIND_SCOPE_OPTIONS: ScopeRefOption[] = [
    { value: "POUCH", label: "POUCH · finished pouch products", detail: "Applies to all pouch product masters unless a more specific policy exists." },
    { value: "ROLL", label: "ROLL · film roll products", detail: "Applies to roll-form product masters unless a more specific policy exists." },
    { value: "PACKAGING", label: "PACKAGING · in-house packing products", detail: "Applies to packaging product masters and packing stock launchers." },
    { value: "POD", label: "POD · POD roll products", detail: "Applies to POD product masters and POD stock launchers." },
    { value: "OTHER", label: "OTHER · fallback product kind", detail: "Use only when a master is intentionally classified as OTHER." },
]

function scopeLabel(scopeType: string) {
    const labels: Record<string, string> = {
        PRODUCT_KIND: "Product kind",
        PRODUCT_MASTER: "Product master",
        POUCH_STYLE: "Pouch style",
        PROCESS: "Process",
        MACHINE: "Machine",
    }
    return labels[scopeType] || "Scope"
}

function buildScopeRefOptions(
    scopeType: string,
    data: {
        productMasters: ProductMaster[]
        pouchStyles: PouchStyle[]
        processes: FactoryProcess[]
        machines: FactoryMachine[]
    },
): ScopeRefOption[] {
    if (scopeType === "PRODUCT_KIND") return PRODUCT_KIND_SCOPE_OPTIONS
    if (scopeType === "PRODUCT_MASTER") {
        return [...data.productMasters]
            .filter((row) => row.active !== false)
            .sort((a, b) => String(a.code).localeCompare(String(b.code)))
            .map((row) => ({
                value: row.code,
                label: `${row.code} · ${row.name}`,
                detail: `${row.product_kind} product master · stored as ${row.code}`,
            }))
    }
    if (scopeType === "POUCH_STYLE") {
        return [...data.pouchStyles]
            .filter((row) => !row.deprecated)
            .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || String(a.code).localeCompare(String(b.code)))
            .map((row) => ({
                value: row.code,
                label: `${row.code} · ${row.name}`,
                detail: `Pouch style v${row.version || 1} · stored as ${row.code}`,
            }))
    }
    if (scopeType === "PROCESS") {
        return [...data.processes]
            .filter((row) => row.is_active !== false && row.status !== "INACTIVE")
            .sort((a, b) => String(a.code).localeCompare(String(b.code)))
            .map((row) => ({
                value: row.code,
                label: `${row.code} · ${row.name}`,
                detail: `${row.input_form || row.input_mode || "?"} to ${row.output_form || row.output_mode || "?"} · ${row.roll_behavior || "standard"}`,
            }))
    }
    if (scopeType === "MACHINE") {
        return [...data.machines]
            .sort((a, b) => String(a.code).localeCompare(String(b.code)))
            .map((row) => ({
                value: row.code,
                label: `${row.code} · ${row.name}`,
                detail: `${row.work_center_name || "No work center"} · ${row.status || "status unknown"}`,
            }))
    }
    return []
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="mb-3 font-display text-sm font-bold text-slate-900">{title}</h2>
            {children}
        </section>
    )
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
    return (
        <label className={cn("block", className)}>
            <div className="mb-1 text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</div>
            {children}
        </label>
    )
}

function ParentWidthAdder({ onAdd }: { onAdd: (n: number) => void }) {
    const [v, setV] = React.useState("")
    return (
        <div className="flex items-center gap-1">
            <Input type="number" value={v} onChange={(e) => setV(e.target.value)} placeholder="add width" className="h-8 w-24 text-[12px]" />
            <Button
                size="sm"
                variant="outline"
                onClick={() => {
                    const n = Number(v)
                    if (n > 0) { onAdd(n); setV("") }
                }}
            >
                <Plus className="h-3 w-3" />
            </Button>
        </div>
    )
}

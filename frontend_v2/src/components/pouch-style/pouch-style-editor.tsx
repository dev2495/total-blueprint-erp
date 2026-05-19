"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
    ArrowLeft,
    Save,
    Plus,
    X,
    Lock,
    Eraser,
    EyeOff,
    Eye,
    History,
} from "lucide-react"

import { GradientHero } from "@/components/erp-v3/gradient-hero"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import {
    pouchStyleService,
    computeChildTargetWidthMm,
    defaultLinearTermsForFields,
    makeFieldTerm,
    termToString,
    type PouchStyle,
    type PouchFormulaKind,
    type PouchFormulaTerm,
    type PouchFormulaFactor,
    type PouchAstNode,
    type PouchFieldDef,
} from "@/services/pouch-style"

const AXIS_OPTS: Array<{ value: "WIDTH" | "HEIGHT" | "BOTH" | "NONE"; label: string }> = [
    { value: "WIDTH", label: "Width axis" },
    { value: "HEIGHT", label: "Height axis" },
    { value: "BOTH", label: "Both axes" },
    { value: "NONE", label: "None (informational)" },
]

const FIELD_PRESETS = [
    { key: "gusset", label: "Gusset", suggested_axis: "WIDTH", suggested_coeff: 2 },
    { key: "flap", label: "Flap reach", suggested_axis: "WIDTH", suggested_coeff: 1 },
    { key: "overlap", label: "Seal overlap", suggested_axis: "HEIGHT", suggested_coeff: 1 },
    { key: "bottom_factor", label: "Bottom factor", suggested_axis: "WIDTH", suggested_coeff: 0 },
    { key: "stick_factor", label: "Stick factor", suggested_axis: "WIDTH", suggested_coeff: 0 },
    { key: "override_width", label: "Direct roll width", suggested_axis: "NONE", suggested_coeff: 0 },
] as const

const FIELD_TONE: Record<string, string> = {
    W: "bg-sky-100 text-sky-900 ring-sky-300",
    H: "bg-amber-100 text-amber-900 ring-amber-300",
    gusset: "bg-emerald-100 text-emerald-900 ring-emerald-300",
    flap: "bg-violet-100 text-violet-900 ring-violet-300",
    overlap: "bg-fuchsia-100 text-fuchsia-900 ring-fuchsia-300",
    bottom_factor: "bg-rose-100 text-rose-900 ring-rose-300",
    stick_factor: "bg-indigo-100 text-indigo-900 ring-indigo-300",
    override_width: "bg-slate-200 text-slate-900 ring-slate-400",
}
const DEFAULT_TONE = "bg-teal-100 text-teal-900 ring-teal-300"
function toneFor(field: string) {
    return FIELD_TONE[field] || DEFAULT_TONE
}

interface PouchStyleEditorProps {
    id?: string
    initialMode?: "new" | "edit"
}

export function PouchStyleEditor({ id, initialMode }: PouchStyleEditorProps) {
    const router = useRouter()
    const qc = useQueryClient()
    const { toast } = useToast()
    const isNew = initialMode === "new" || !id

    const { data: existing, isLoading } = useQuery({
        queryKey: ["pouch-style", id],
        queryFn: () => pouchStyleService.get(id!),
        enabled: !isNew && !!id,
    })

    const { data: versions = [] } = useQuery({
        queryKey: ["pouch-style-versions", existing?.code],
        queryFn: () => pouchStyleService.versions(existing!.code),
        enabled: !!existing?.code,
    })

    const [draft, setDraft] = React.useState<Partial<PouchStyle>>(() => emptyDraft())
    const [previewInputs, setPreviewInputs] = React.useState<Record<string, number>>({ W: 127, H: 203 })
    const [showAdvanced, setShowAdvanced] = React.useState(false)

    React.useEffect(() => {
        if (existing) {
            setDraft(existing)
            const next: Record<string, number> = { W: 127, H: 203 }
            for (const [k, def] of Object.entries(existing.allowed_fields || {})) {
                if (def && typeof def.default === "number") next[k] = def.default
            }
            setPreviewInputs((prev) => ({ ...next, ...prev }))
        }
    }, [existing])

    const allowedFields: Record<string, PouchFieldDef> = (draft.allowed_fields as any) || {}
    const formulaParams = (draft.formula_params as Record<string, any>) || {}
    const terms: PouchFormulaTerm[] = Array.isArray(formulaParams.terms) ? formulaParams.terms : []
    const trim = Number(formulaParams.trim_mm ?? 0)
    const isLocked = !!draft.locked

    const set = <K extends keyof PouchStyle>(key: K, v: PouchStyle[K] | undefined) =>
        setDraft((d) => ({ ...d, [key]: v as any }))

    const setParams = (next: Record<string, any>) => set("formula_params", next as any)
    const setTerms = (next: PouchFormulaTerm[]) => setParams({ ...formulaParams, terms: next })
    const setTrim = (v: number) => setParams({ ...formulaParams, trim_mm: v })

    const liveTarget = React.useMemo(() => {
        try {
            return computeChildTargetWidthMm(
                {
                    formula_kind: (draft.formula_kind || "LINEAR") as PouchFormulaKind,
                    formula_params: formulaParams,
                    formula_ast: (draft.formula_ast || {}) as PouchAstNode,
                    field_adjustments: (draft.field_adjustments || {}) as any,
                },
                previewInputs,
            )
        } catch {
            return 0
        }
    }, [draft.formula_kind, formulaParams, draft.formula_ast, draft.field_adjustments, previewInputs])

    const saveMutation = useMutation({
        mutationFn: async () => {
            const body = {
                code: draft.code || "",
                name: draft.name || "",
                description: draft.description || "",
                visual_emoji: draft.visual_emoji || "🛍️",
                visual_svg: draft.visual_svg || "",
                faces: Number(draft.faces || 2),
                default_roll_axis: (draft.default_roll_axis || "WIDTH") as any,
                allowed_fields: allowedFields,
                field_adjustments: draft.field_adjustments || {},
                formula_kind: (draft.formula_kind || "LINEAR") as PouchFormulaKind,
                formula_params: formulaParams,
                formula_ast: (draft.formula_ast as any) || {},
                formula_expression: prettyExpression(draft.formula_kind as PouchFormulaKind, terms, trim),
                deprecated: !!draft.deprecated,
                sort_order: Number(draft.sort_order || 100),
                notes: draft.notes || "",
            }
            if (isNew) return pouchStyleService.create(body)
            return pouchStyleService.update(id!, body)
        },
        onSuccess: (saved) => {
            const versionMsg = saved.version && existing && existing.version && saved.version > existing.version
                ? ` · new v${saved.version} created (v${existing.version} preserved)`
                : ` · v${saved.version}`
            toast({ title: isNew ? "Pouch style created" : "Saved", description: `${saved.code}${versionMsg}` })
            qc.invalidateQueries({ queryKey: ["pouch-styles"] })
            qc.invalidateQueries({ queryKey: ["pouch-style-versions", saved.code] })
            if (isNew || (existing && saved.id !== existing.id)) router.push(`/master/pouch-styles/${saved.id}`)
        },
        onError: (e: any) =>
            toast({
                title: "Save failed",
                description: String(e?.response?.data?.detail || e?.response?.data?.code || e?.message || e),
                variant: "destructive",
            }),
    })

    const disableMutation = useMutation({
        mutationFn: async () => pouchStyleService.disable(id!),
        onSuccess: (saved) => {
            toast({ title: "Disabled", description: `${saved.code} hidden from pickers. Historical FKs preserved.` })
            qc.invalidateQueries({ queryKey: ["pouch-styles"] })
            qc.invalidateQueries({ queryKey: ["pouch-style", id] })
        },
        onError: (e: any) => toast({ title: "Disable failed", description: String(e?.message || e), variant: "destructive" }),
    })

    const reactivateMutation = useMutation({
        mutationFn: async () => pouchStyleService.reactivate(id!),
        onSuccess: (saved) => {
            toast({ title: "Reactivated", description: `${saved.code} is visible again.` })
            qc.invalidateQueries({ queryKey: ["pouch-styles"] })
            qc.invalidateQueries({ queryKey: ["pouch-style", id] })
        },
        onError: (e: any) => toast({ title: "Reactivate failed", description: String(e?.message || e), variant: "destructive" }),
    })

    // — Field actions —
    function addField(key: string, def: PouchFieldDef, alsoAddTerm = true) {
        const next = { ...allowedFields, [key]: def }
        set("allowed_fields", next as any)
        if (alsoAddTerm && !terms.find((t) => t.field === key)) {
            const coeff = typeof def.default_coefficient === "number" ? def.default_coefficient : 1
            setTerms([...terms, { field: key, coefficient: coeff }])
        }
    }
    function removeField(key: string) {
        const next = { ...allowedFields }
        delete next[key]
        set("allowed_fields", next as any)
        setTerms(terms.filter((t) => t.field !== key))
    }
    function patchField(key: string, patch: Partial<PouchFieldDef>) {
        const next = { ...allowedFields, [key]: { ...(allowedFields[key] || {}), ...patch } }
        set("allowed_fields", next as any)
    }

    // — Term actions (product-chain model) —
    function setTerm(idx: number, next: PouchFormulaTerm) {
        setTerms(terms.map((t, i) => (i === idx ? next : t)))
    }
    function removeTerm(idx: number) {
        setTerms(terms.filter((_, i) => i !== idx))
    }
    function addTerm(field: string) {
        const def = allowedFields[field]
        const coeff = (def && typeof def.default_coefficient === "number") ? def.default_coefficient : 1
        // Default = {coeff} × field — e.g. 2 × W
        const t: PouchFormulaTerm = {
            factors: [
                { kind: "NUMBER", value: coeff || 1 },
                { kind: "FIELD", field },
            ],
        }
        setTerms([...terms, t])
    }
    function addEmptyTerm() {
        setTerms([...terms, { factors: [{ kind: "NUMBER", value: 1 }] }])
    }

    if (!isNew && isLoading) {
        return <div className="p-10 text-center text-sm text-slate-500">Loading pouch style…</div>
    }

    const hasW = !!allowedFields.W
    const hasH = !!allowedFields.H
    const extraFieldsAvailable = FIELD_PRESETS.filter((p) => !allowedFields[p.key])

    return (
        <div className="min-h-screen bg-gradient-to-b from-slate-50/80 via-white to-slate-50/40 px-4 py-4 sm:px-6">
            <GradientHero
                palette="indigo"
                eyebrow={isNew ? "MASTER · POUCH STYLE · NEW" : "MASTER · POUCH STYLE"}
                title={
                    isNew
                        ? "Build a pouch shape"
                        : `${draft.visual_emoji || "🛍️"}  ${draft.name || draft.code || "Pouch style"}`
                }
                subtitle="Pick the input fields the pouch needs, set how each one affects the roll width, then save. Width or height can both drive the roll axis."
                chips={[
                    !isNew && isLocked ? { icon: <Lock className="h-4 w-4" />, label: "Locked", value: "v" + (draft.version || 1), tone: "info" } : null,
                    !isNew ? { label: "Version", value: `v${draft.version || 1}`, tone: "violet" } : null,
                    !isNew ? { label: "Used by sizes", value: String(draft.sizes_count || 0), tone: "ok" } : null,
                    !isNew && draft.deprecated ? { label: "Status", value: "Disabled", tone: "error" } : null,
                ].filter(Boolean) as any}
            >
                <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                        type="button"
                        onClick={() => router.push("/master/pouch-styles")}
                        className="inline-flex items-center gap-1 rounded-full bg-white/15 px-3 py-1 text-[11px] font-bold text-white backdrop-blur ring-1 ring-white/20 hover:bg-white/25"
                    >
                        <ArrowLeft className="h-3 w-3" /> back to pouch styles
                    </button>
                    {versions.length > 1 ? (
                        <div className="inline-flex items-center gap-1 rounded-full bg-white/15 px-3 py-1 text-[11px] font-bold text-white backdrop-blur ring-1 ring-white/20">
                            <History className="h-3 w-3" />
                            <select
                                className="bg-transparent text-white outline-none"
                                value={String(id || "")}
                                onChange={(e) => router.push(`/master/pouch-styles/${e.target.value}`)}
                            >
                                {versions.map((v) => (
                                    <option key={v.id} value={v.id} className="text-slate-900">v{v.version} · {v.locked ? "locked" : "draft"}{v.deprecated ? " · disabled" : ""}</option>
                                ))}
                            </select>
                        </div>
                    ) : null}
                </div>
            </GradientHero>

            {isLocked && !isNew ? (
                <div className="mt-4 rounded-2xl border-2 border-amber-300 bg-amber-50 px-4 py-3 text-[12px] text-amber-900">
                    <div className="flex items-center gap-2 font-bold">
                        <Lock className="h-3.5 w-3.5" /> This version is locked because product sizes are using it.
                    </div>
                    <p className="mt-1 text-[11px]">
                        Editing and saving will create a <b>new version v{(draft.version || 1) + 1}</b> · old sizes keep their snapshot of v{draft.version || 1}.
                    </p>
                </div>
            ) : null}
            {draft.deprecated && !isNew ? (
                <div className="mt-4 rounded-2xl border-2 border-rose-300 bg-rose-50 px-4 py-3 text-[12px] text-rose-900">
                    <div className="flex items-center gap-2 font-bold">
                        <EyeOff className="h-3.5 w-3.5" /> This style is disabled.
                    </div>
                    <p className="mt-1 text-[11px]">
                        Hidden from pickers, historical references preserved. Click Reactivate to bring it back.
                    </p>
                </div>
            ) : null}

            <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
                {/* LEFT */}
                <div className="space-y-5">
                    {/* Identity */}
                    <Card index={1} title="Identity" tone="indigo">
                        <div className="grid gap-3 sm:grid-cols-2">
                            <Field label="Code (unique per code)">
                                <Input value={draft.code || ""} onChange={(e) => set("code", e.target.value.toUpperCase() as any)} placeholder="ACME_STAND_UP" className="font-mono" disabled={!isNew && isLocked} />
                                {!isNew && isLocked ? <div className="mt-1 text-[10px] text-amber-700">Code is fixed across versions.</div> : null}
                            </Field>
                            <Field label="Name">
                                <Input value={draft.name || ""} onChange={(e) => set("name", e.target.value as any)} placeholder="Stand-up pouch · Acme line" />
                            </Field>
                            <Field label="Emoji">
                                <Input value={draft.visual_emoji || ""} onChange={(e) => set("visual_emoji", e.target.value as any)} placeholder="🛍️" className="text-center" />
                            </Field>
                            <Field label="Faces (1 single layer · 2 laminated front+back)">
                                <Input type="number" min={1} max={2} value={Number(draft.faces || 2)} onChange={(e) => set("faces", Number(e.target.value || 2) as any)} />
                            </Field>
                            <Field label="Default roll axis">
                                <Select value={String(draft.default_roll_axis || "WIDTH")} onValueChange={(v) => set("default_roll_axis", v as any)}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {AXIS_OPTS.map((o) => (<SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>))}
                                    </SelectContent>
                                </Select>
                            </Field>
                            <Field label="Sort order">
                                <Input type="number" value={Number(draft.sort_order || 100)} onChange={(e) => set("sort_order", Number(e.target.value || 100) as any)} />
                            </Field>
                        </div>
                        <Field label="Description (optional)" className="mt-3">
                            <Textarea rows={2} value={draft.description || ""} onChange={(e) => set("description", e.target.value as any)} placeholder="Short note about when to use this pouch." />
                        </Field>
                    </Card>

                    {/* Allowed fields */}
                    <Card index={2} title="Allowed input fields" tone="violet">
                        <p className="-mt-1 mb-3 text-[11px] text-slate-500">
                            Choose which fields this pouch needs. W and H are the dimensions the operator types on the size editor; gusset / flap / etc. are extras that further shape the roll width.
                        </p>

                        <div className="mb-3 grid gap-2 sm:grid-cols-2">
                            <FieldChip label="Width (W)" present={hasW} onAdd={() => addField("W", { required: true, label: "Width", applies_to: "WIDTH", default_coefficient: 2 })} onRemove={() => removeField("W")} pinned />
                            <FieldChip label="Height (H)" present={hasH} onAdd={() => addField("H", { required: true, label: "Height", applies_to: "HEIGHT", default_coefficient: 0 })} onRemove={() => removeField("H")} pinned />
                        </div>

                        {Object.keys(allowedFields).filter((k) => k !== "W" && k !== "H").length > 0 ? (
                            <div className="space-y-2">
                                {Object.entries(allowedFields)
                                    .filter(([k]) => k !== "W" && k !== "H")
                                    .map(([key, def]) => (
                                        <ExtraFieldRow
                                            key={key}
                                            fieldKey={key}
                                            def={def}
                                            onPatch={(p) => patchField(key, p)}
                                            onRemove={() => removeField(key)}
                                        />
                                    ))}
                            </div>
                        ) : (
                            <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-3 text-[11px] text-slate-500">
                                No extras yet. Add gusset / flap / overlap / etc. from below if your pouch needs them.
                            </div>
                        )}

                        {extraFieldsAvailable.length > 0 ? (
                            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-indigo-300 bg-indigo-50/40 p-3">
                                <span className="text-[10px] font-black uppercase tracking-widest text-indigo-700">Add a field</span>
                                {extraFieldsAvailable.map((p) => (
                                    <button
                                        key={p.key}
                                        type="button"
                                        onClick={() =>
                                            addField(p.key, {
                                                required: false,
                                                label: p.label,
                                                applies_to: p.suggested_axis as any,
                                                default_coefficient: p.suggested_coeff,
                                            })
                                        }
                                        className="rounded-md bg-white px-2 py-1 text-[11px] font-bold text-indigo-700 ring-1 ring-indigo-200 hover:bg-indigo-50"
                                    >
                                        <Plus className="mr-0.5 inline h-3 w-3" />
                                        {p.label}
                                    </button>
                                ))}
                                <CustomFieldAdder onAdd={(k) => addField(k, { required: false, label: k, applies_to: "WIDTH", default_coefficient: 1 })} />
                            </div>
                        ) : null}
                    </Card>

                    {/* Formula builder — VISUAL */}
                    <Card index={3} title="Formula builder" tone="emerald">
                        <p className="-mt-1 mb-2 text-[11px] text-slate-600">
                            <b>Roll width = sum of (coefficient × field) + trim.</b> Click <b>+ Add</b> to drop in a field. Set its coefficient — that&apos;s how many times it multiplies into the roll width.
                        </p>
                        <p className="mb-3 text-[10.5px] text-slate-500">
                            For a height-axis pouch (e.g. center seal), simply add <code className="font-mono">H × 1</code> as the main term. For a 2W width pouch add <code className="font-mono">W × 2</code>. Mix and match freely.
                        </p>

                        <VisualLinearBuilder
                            allowedFields={allowedFields}
                            terms={terms}
                            trim={trim}
                            onSetTerm={setTerm}
                            onRemoveTerm={removeTerm}
                            onAddTerm={addTerm}
                            onAddEmptyTerm={addEmptyTerm}
                            onSetTrim={setTrim}
                            onResetTerms={() => setTerms(defaultLinearTermsForFields(allowedFields))}
                            onApplyPreset={(preset) => {
                                // Ensure preset's required fields are allowed
                                const nextFields = { ...allowedFields }
                                for (const f of preset.fields) {
                                    if (!nextFields[f]) {
                                        const guess = FIELD_PRESETS.find((p) => p.key === f)
                                        nextFields[f] = {
                                            required: false,
                                            label: guess?.label || f,
                                            applies_to: (guess?.suggested_axis as any) || "WIDTH",
                                            default_coefficient: guess?.suggested_coeff ?? 1,
                                        }
                                    }
                                }
                                set("allowed_fields", nextFields as any)
                                setParams({ ...formulaParams, terms: preset.terms, trim_mm: preset.trim })
                            }}
                        />

                        <div className="mt-4 rounded-xl bg-slate-900 px-3 py-2 font-mono text-[13px] leading-6 text-emerald-300">
                            roll width  =  {prettyExpression("LINEAR", terms, trim) || "(empty — add a term above)"}
                        </div>

                        {/* Advanced toggle — keeps CUSTOM_AST + SHAPED_OVERRIDE for power users */}
                        <button
                            type="button"
                            onClick={() => setShowAdvanced((s) => !s)}
                            className="mt-4 text-[11px] font-bold text-emerald-700 hover:underline"
                        >
                            {showAdvanced ? "Hide advanced options ▴" : "Show advanced options ▾"}
                        </button>
                        {showAdvanced ? (
                            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-[11px] text-amber-900">
                                <div className="font-bold">Switch formula kind (most pouches don&apos;t need this)</div>
                                <div className="mt-2 flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        onClick={() => set("formula_kind", "LINEAR")}
                                        className={cn(
                                            "rounded-md px-2 py-1 text-[11px] font-bold ring-1",
                                            (draft.formula_kind || "LINEAR") === "LINEAR" ? "bg-emerald-600 text-white ring-emerald-700" : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50",
                                        )}
                                    >LINEAR (default)</button>
                                    <button
                                        type="button"
                                        onClick={() => set("formula_kind", "SHAPED_OVERRIDE")}
                                        className={cn(
                                            "rounded-md px-2 py-1 text-[11px] font-bold ring-1",
                                            draft.formula_kind === "SHAPED_OVERRIDE" ? "bg-amber-600 text-white ring-amber-700" : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50",
                                        )}
                                    >Shaped (operator types width)</button>
                                </div>
                                {draft.formula_kind === "SHAPED_OVERRIDE" ? (
                                    <div className="mt-2 text-[10.5px]">
                                        Make sure the field <code className="font-mono">override_width</code> is in your allowed inputs. Operator types it directly on each size.
                                    </div>
                                ) : null}
                            </div>
                        ) : null}
                    </Card>
                </div>

                {/* RIGHT */}
                <div className="space-y-5">
                    <Card index={4} title="Live preview" tone="amber">
                        <p className="-mt-1 mb-3 text-[11px] text-slate-500">
                            Plug values for the allowed fields and the formula computes target child width in real time.
                        </p>
                        <div className="grid grid-cols-2 gap-2">
                            {Object.keys(allowedFields).map((k) => (
                                <Field key={k} label={allowedFields[k].label || k}>
                                    <Input type="number" step="any" value={Number(previewInputs[k] ?? "")} onChange={(e) => setPreviewInputs((p) => ({ ...p, [k]: Number(e.target.value || 0) }))} />
                                </Field>
                            ))}
                        </div>

                        <div className="mt-3 rounded-2xl border-2 border-emerald-300 bg-emerald-600 p-4 text-white">
                            <div className="text-[10px] font-black uppercase tracking-widest text-emerald-100">Target child width (live)</div>
                            <div className="mt-1 font-display text-4xl font-extrabold">
                                {Number.isFinite(liveTarget) ? `${liveTarget.toFixed(2)}` : "—"}<span className="ml-1 text-base">mm</span>
                            </div>
                            <div className="mt-1 text-[10px] text-emerald-100">computed by your formula</div>
                        </div>
                    </Card>

                    <Card index={5} title="Actions" tone="slate">
                        <div className="flex flex-col gap-2">
                            <Button
                                onClick={() => saveMutation.mutate()}
                                disabled={saveMutation.isPending || !draft.code || !draft.name}
                                className="bg-indigo-600 text-white hover:bg-indigo-700"
                            >
                                <Save className="mr-1.5 h-4 w-4" />
                                {saveMutation.isPending
                                    ? "Saving…"
                                    : isNew
                                        ? "Create pouch style"
                                        : isLocked
                                            ? `Save as v${(draft.version || 1) + 1}`
                                            : "Save changes"}
                            </Button>
                            {!isNew && !draft.deprecated ? (
                                <Button
                                    variant="outline"
                                    onClick={() => {
                                        if (confirm("Disable this pouch style? It will be hidden from pickers but historical references preserved.")) disableMutation.mutate()
                                    }}
                                    className="border-rose-300 text-rose-700 hover:bg-rose-50"
                                >
                                    <EyeOff className="mr-1.5 h-4 w-4" /> Disable
                                </Button>
                            ) : !isNew && draft.deprecated ? (
                                <Button
                                    variant="outline"
                                    onClick={() => reactivateMutation.mutate()}
                                    className="border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                                >
                                    <Eye className="mr-1.5 h-4 w-4" /> Reactivate
                                </Button>
                            ) : null}
                        </div>
                    </Card>
                </div>
            </div>
        </div>
    )
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function emptyDraft(): Partial<PouchStyle> {
    return {
        code: "",
        name: "",
        description: "",
        version: 1,
        locked: false,
        visual_emoji: "🛍️",
        faces: 2,
        default_roll_axis: "WIDTH",
        allowed_fields: {
            W: { required: true, label: "Width", applies_to: "WIDTH", default_coefficient: 2 },
            H: { required: true, label: "Height", applies_to: "HEIGHT", default_coefficient: 1 },
        } as any,
        field_adjustments: { trim_default_mm: 5, default_lane_count: 1 } as any,
        formula_kind: "LINEAR",
        formula_params: {
            terms: [
                {
                    factors: [
                        { kind: "NUMBER", value: 2 },
                        { kind: "FIELD", field: "W" },
                    ],
                },
            ],
            trim_mm: 5,
        } as any,
        formula_ast: {},
        formula_expression: "(empty — add a term)",
        sort_order: 100,
        deprecated: false,
        notes: "",
    }
}

function prettyExpression(
    kind: PouchFormulaKind,
    terms: PouchFormulaTerm[],
    trim: number,
    ast?: PouchAstNode,
): string {
    if (kind === "SHAPED_OVERRIDE") return "override_width (operator-typed)"
    if (kind === "CUSTOM_AST") return ast && (ast as any).op ? "custom AST" : ""
    const pieces = (terms || [])
        .map((t) => termToString(t))
        .filter((s) => !!s)
    const joined = pieces.join("  +  ")
    const trimPart = Number(trim || 0) !== 0 ? `${pieces.length ? "  +  " : ""}${trim}` : ""
    if (!joined && !trimPart) return ""
    return joined + trimPart
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
    return (
        <label className={cn("block", className)}>
            <div className="mb-1 text-[10px] font-black uppercase tracking-widest text-slate-500">{label}</div>
            {children}
        </label>
    )
}

const TONE: Record<string, string> = {
    indigo: "border-indigo-200 bg-indigo-50/30 text-indigo-700",
    violet: "border-violet-200 bg-violet-50/30 text-violet-700",
    emerald: "border-emerald-200 bg-emerald-50/30 text-emerald-700",
    rose: "border-rose-200 bg-rose-50/30 text-rose-700",
    amber: "border-amber-200 bg-amber-50/30 text-amber-700",
    slate: "border-slate-200 bg-slate-50/40 text-slate-700",
}

function Card({ index, title, tone, children }: { index: number; title: string; tone: keyof typeof TONE; children: React.ReactNode }) {
    return (
        <section className={cn("rounded-2xl border bg-white p-4 shadow-sm", TONE[tone].split(" ")[0])}>
            <header className="mb-3 flex items-center gap-2">
                <span className={cn("grid h-5 w-5 place-items-center rounded text-[10px] font-black", TONE[tone])}>
                    {index}
                </span>
                <h2 className="font-display text-sm font-bold text-slate-900">{title}</h2>
            </header>
            {children}
        </section>
    )
}

function FieldChip({
    label, present, onAdd, onRemove, pinned,
}: { label: string; present: boolean; onAdd: () => void; onRemove: () => void; pinned?: boolean }) {
    return (
        <div className={cn("flex items-center justify-between rounded-xl px-3 py-2 ring-1", present ? "bg-emerald-50 ring-emerald-200" : "bg-slate-50 ring-slate-200")}>
            <span className={cn("text-[12px] font-bold", present ? "text-emerald-900" : "text-slate-600")}>{label}</span>
            <div className="flex items-center gap-2">
                {pinned ? <Badge variant="outline" className="border-slate-300 text-[9px]">always shown</Badge> : null}
                {present ? (
                    <button
                        type="button"
                        onClick={() => { if (pinned && !confirm(`Remove ${label}? Most pouches need it.`)) return; onRemove() }}
                        className="rounded-md p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-700"
                    ><X className="h-4 w-4" /></button>
                ) : (
                    <button
                        type="button"
                        onClick={onAdd}
                        className="rounded-md bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white hover:bg-emerald-700"
                    >+ Add</button>
                )}
            </div>
        </div>
    )
}

function ExtraFieldRow({
    fieldKey, def, onPatch, onRemove,
}: { fieldKey: string; def: PouchFieldDef; onPatch: (p: Partial<PouchFieldDef>) => void; onRemove: () => void }) {
    return (
        <div className="grid items-center gap-2 rounded-xl border border-slate-200 bg-white p-2.5 sm:grid-cols-[120px_minmax(0,1fr)_120px_140px_100px_auto]">
            <span className={cn("rounded-md px-2 py-0.5 text-center font-mono text-[11px] font-bold ring-1", toneFor(fieldKey))}>{fieldKey}</span>
            <Input value={def.label || ""} onChange={(e) => onPatch({ label: e.target.value })} className="h-8 text-[12px]" placeholder="Field label" />
            <label className="flex items-center gap-1 text-[11px] font-bold">
                <input type="checkbox" checked={!!def.required} onChange={(e) => onPatch({ required: e.target.checked })} />
                required
            </label>
            <Select value={String(def.applies_to || "WIDTH")} onValueChange={(v) => onPatch({ applies_to: v as any })}>
                <SelectTrigger className="h-8 text-[11px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                    {AXIS_OPTS.map((o) => (<SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>))}
                </SelectContent>
            </Select>
            <Input type="number" step="any" value={def.default == null ? "" : String(def.default)} onChange={(e) => onPatch({ default: e.target.value === "" ? undefined : Number(e.target.value) })} className="h-8 text-[11px]" placeholder="default" />
            <button type="button" onClick={onRemove} className="rounded-md p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-700">
                <X className="h-4 w-4" />
            </button>
        </div>
    )
}

interface FormulaPreset {
    code: string
    emoji: string
    label: string
    formula: string
    fields: string[]   // fields to ensure present
    terms: PouchFormulaTerm[]
    trim: number
}

const FORMULA_PRESETS: FormulaPreset[] = [
    {
        code: "PILLOW", emoji: "📦", label: "Pillow / 3-side", formula: "2W + trim", fields: ["W"],
        terms: [{ factors: [{ kind: "NUMBER", value: 2 }, { kind: "FIELD", field: "W" }] }],
        trim: 5,
    },
    {
        code: "STAND_UP_K", emoji: "🛍", label: "Stand-up · K-bottom", formula: "2W + G + trim", fields: ["W", "gusset"],
        terms: [
            { factors: [{ kind: "NUMBER", value: 2 }, { kind: "FIELD", field: "W" }] },
            { factors: [{ kind: "NUMBER", value: 1 }, { kind: "FIELD", field: "gusset" }] },
        ],
        trim: 5,
    },
    {
        code: "SIDE_GUSSET", emoji: "📁", label: "Side gusset", formula: "2W + 2G + trim", fields: ["W", "gusset"],
        terms: [
            { factors: [{ kind: "NUMBER", value: 2 }, { kind: "FIELD", field: "W" }] },
            { factors: [{ kind: "NUMBER", value: 2 }, { kind: "FIELD", field: "gusset" }] },
        ],
        trim: 5,
    },
    {
        code: "QUAD_SEAL", emoji: "🟦", label: "Quad seal", formula: "2W + 2G + trim", fields: ["W", "gusset"],
        terms: [
            { factors: [{ kind: "NUMBER", value: 2 }, { kind: "FIELD", field: "W" }] },
            { factors: [{ kind: "NUMBER", value: 2 }, { kind: "FIELD", field: "gusset" }] },
        ],
        trim: 5,
    },
    {
        code: "CENTER_SEAL", emoji: "↕️", label: "Center seal · H-axis", formula: "H + overlap + trim", fields: ["H", "overlap"],
        terms: [
            { factors: [{ kind: "NUMBER", value: 1 }, { kind: "FIELD", field: "H" }] },
            { factors: [{ kind: "NUMBER", value: 1 }, { kind: "FIELD", field: "overlap" }] },
        ],
        trim: 5,
    },
    {
        code: "STICK_PACK", emoji: "📏", label: "Stick pack", formula: "W × stick_factor + trim", fields: ["W", "stick_factor"],
        terms: [
            { factors: [{ kind: "FIELD", field: "W" }, { kind: "FIELD", field: "stick_factor" }] },
        ],
        trim: 3,
    },
    {
        code: "K_WITH_FACTOR", emoji: "🏷", label: "K-bottom × factor", formula: "2W + G × bottom_factor + trim", fields: ["W", "gusset", "bottom_factor"],
        terms: [
            { factors: [{ kind: "NUMBER", value: 2 }, { kind: "FIELD", field: "W" }] },
            { factors: [{ kind: "FIELD", field: "gusset" }, { kind: "FIELD", field: "bottom_factor" }] },
        ],
        trim: 5,
    },
]

function VisualLinearBuilder({
    allowedFields, terms, trim, onSetTerm, onRemoveTerm, onAddTerm, onAddEmptyTerm, onSetTrim, onResetTerms,
    onApplyPreset,
}: {
    allowedFields: Record<string, PouchFieldDef>
    terms: PouchFormulaTerm[]
    trim: number
    onSetTerm: (idx: number, next: PouchFormulaTerm) => void
    onRemoveTerm: (idx: number) => void
    onAddTerm: (field: string) => void
    onAddEmptyTerm: () => void
    onSetTrim: (v: number) => void
    onResetTerms: () => void
    onApplyPreset: (preset: FormulaPreset) => void
}) {
    const allFieldKeys = Object.keys(allowedFields).filter((k) => k !== "override_width")

    return (
        <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50/30 via-white to-teal-50/30 p-3">
            {/* Preset bar */}
            <div className="mb-3 rounded-xl border border-emerald-200 bg-white px-3 py-2">
                <div className="mb-1.5 flex items-center justify-between">
                    <div className="text-[10px] font-black uppercase tracking-widest text-emerald-700">
                        Quick presets
                    </div>
                    <div className="text-[10px] text-slate-500">click to fill the formula in one go</div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                    {FORMULA_PRESETS.map((p) => (
                        <button
                            key={p.code}
                            type="button"
                            onClick={() => onApplyPreset(p)}
                            className="group flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50/40 px-2 py-1 text-[11px] font-bold text-emerald-900 hover:bg-emerald-100"
                            title={p.formula}
                        >
                            <span>{p.emoji}</span>
                            <span>{p.label}</span>
                            <span className="hidden font-mono text-[9px] text-emerald-700 opacity-70 group-hover:inline">{p.formula}</span>
                        </button>
                    ))}
                </div>
            </div>

            <div className="mb-3 text-[10px] font-black uppercase tracking-widest text-emerald-700">
                Roll width  =
            </div>

            {/* Term list, stacked vertically each as a product chain */}
            <div className="space-y-2">
                {terms.length === 0 ? (
                    <div className="rounded-xl border-2 border-dashed border-emerald-300 bg-white px-3 py-4 text-center text-[11px] text-emerald-700">
                        No terms yet — pick a field below to start the formula.
                    </div>
                ) : (
                    terms.map((t, idx) => (
                        <React.Fragment key={idx}>
                            <TermRow
                                term={normalizeTerm(t)}
                                allowedFields={allowedFields}
                                onChange={(next) => onSetTerm(idx, next)}
                                onRemove={() => onRemoveTerm(idx)}
                                onAddTerm={(field) => {
                                    if (field === "__NUMBER__") {
                                        onAddEmptyTerm()
                                    } else {
                                        onAddTerm(field)
                                    }
                                }}
                            />
                            <div className="pl-3 text-base font-bold text-emerald-700">+</div>
                        </React.Fragment>
                    ))
                )}

                {/* Trim row */}
                <div className="flex items-center gap-2 rounded-2xl bg-slate-100 px-3 py-2 ring-1 ring-slate-300">
                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-600">trim constant</span>
                    <input
                        type="number"
                        step="any"
                        value={Number(trim || 0)}
                        onChange={(e) => onSetTrim(Number(e.target.value || 0))}
                        className="h-8 w-20 rounded-md border border-white bg-white px-1.5 text-center font-mono text-sm font-bold"
                    />
                    <span className="text-[10px] font-bold text-slate-500">mm</span>
                </div>
            </div>

            {/* Add-term tray */}
            {allFieldKeys.length > 0 ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-emerald-300 bg-white px-3 py-2">
                    <span className="text-[10px] font-black uppercase tracking-widest text-emerald-700">+ Add term</span>
                    {allFieldKeys.map((k) => (
                        <button
                            key={k}
                            type="button"
                            onClick={() => onAddTerm(k)}
                            className={cn(
                                "rounded-lg px-2.5 py-1 text-[11px] font-bold ring-1 hover:opacity-90",
                                toneFor(k),
                            )}
                        >
                            <Plus className="mr-0.5 inline h-3 w-3" /> {k}
                        </button>
                    ))}
                    <button
                        type="button"
                        onClick={onAddEmptyTerm}
                        className="rounded-lg bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-700 ring-1 ring-slate-300 hover:bg-slate-200"
                    >
                        <Plus className="mr-0.5 inline h-3 w-3" /> blank
                    </button>
                </div>
            ) : null}

            {/* Help + reset */}
            <div className="mt-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-[10px] text-slate-500">
                    Each term is a <b>product chain</b> · 2 × W, W × bottom_factor, gusset × 2, etc. Click the <b>×</b> between chips to add another factor.
                </span>
                <Button variant="outline" size="sm" onClick={onResetTerms}>
                    <Eraser className="mr-1 h-3 w-3" /> Reset to defaults
                </Button>
            </div>
        </div>
    )
}

function normalizeTerm(t: PouchFormulaTerm): PouchFormulaTerm {
    // Migrate legacy { field, coefficient } to factors[] on the fly.
    if (Array.isArray(t.factors) && t.factors.length > 0) return t
    if (t.field) {
        return {
            factors: [
                { kind: "NUMBER", value: typeof t.coefficient === "number" ? t.coefficient : 1 },
                { kind: "FIELD", field: t.field },
            ],
        }
    }
    return { factors: [{ kind: "NUMBER", value: 1 }] }
}

function TermRow({
    term, allowedFields, onChange, onRemove, onAddTerm,
}: {
    term: PouchFormulaTerm
    allowedFields: Record<string, PouchFieldDef>
    onChange: (next: PouchFormulaTerm) => void
    onRemove: () => void
    onAddTerm: (field: string) => void
}) {
    const factors = term.factors || []
    const allFieldKeys = Object.keys(allowedFields).filter((k) => k !== "override_width")

    const setFactor = (idx: number, next: PouchFormulaFactor) => {
        const out = factors.map((f, i) => (i === idx ? next : f))
        onChange({ factors: out })
    }
    const removeFactor = (idx: number) => {
        const out = factors.filter((_, i) => i !== idx)
        onChange({ factors: out.length ? out : [{ kind: "NUMBER", value: 1 }] })
    }
    const addFactor = (next: PouchFormulaFactor) => {
        onChange({ factors: [...factors, next] })
    }

    return (
        <div className="relative rounded-2xl border border-emerald-200 bg-white p-2.5 shadow-sm">
            <button
                type="button"
                onClick={onRemove}
                className="absolute -top-2 -right-2 grid h-5 w-5 place-items-center rounded-full bg-rose-500 text-white shadow hover:bg-rose-600"
                title="Remove this term"
            >
                <X className="h-3 w-3" />
            </button>
            <div className="flex flex-wrap items-center gap-1.5">
                {factors.length === 0 ? (
                    <span className="text-[11px] text-slate-400">empty term</span>
                ) : null}
                {factors.map((f, idx) => (
                    <React.Fragment key={idx}>
                        <FactorChip
                            factor={f}
                            allowedFields={allowedFields}
                            onChange={(next) => setFactor(idx, next)}
                            onRemove={() => removeFactor(idx)}
                        />
                        {idx < factors.length - 1 ? <span className="text-[14px] font-bold text-emerald-700">×</span> : null}
                    </React.Fragment>
                ))}
                {/* + extend formula */}
                <FactorAdder
                    allFieldKeys={allFieldKeys}
                    onAddNumber={() => addFactor({ kind: "NUMBER", value: 1 })}
                    onAddField={(k) => addFactor({ kind: "FIELD", field: k })}
                    onAddTermNumber={() => onAddTerm("__NUMBER__")}
                    onAddTermField={(k) => onAddTerm(k)}
                />
            </div>
        </div>
    )
}

function FactorChip({
    factor, allowedFields, onChange, onRemove,
}: {
    factor: PouchFormulaFactor
    allowedFields: Record<string, PouchFieldDef>
    onChange: (next: PouchFormulaFactor) => void
    onRemove: () => void
}) {
    if (factor.kind === "NUMBER") {
        return (
            <span className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2 py-1 ring-1 ring-slate-700">
                <input
                    type="number"
                    step="any"
                    value={Number(factor.value ?? 0)}
                    onChange={(e) => onChange({ kind: "NUMBER", value: Number(e.target.value || 0) })}
                    className="h-6 w-14 rounded-md border border-slate-700 bg-slate-800 px-1.5 text-center font-mono text-sm font-bold text-emerald-200"
                />
                <button
                    type="button"
                    onClick={onRemove}
                    className="grid h-4 w-4 place-items-center rounded-full bg-rose-500 text-white hover:bg-rose-600"
                    title="Remove factor"
                ><X className="h-2.5 w-2.5" /></button>
            </span>
        )
    }
    // FIELD
    const fieldKey = String(factor.field || "")
    const tone = toneFor(fieldKey)
    const def = allowedFields[fieldKey] || {}
    return (
        <span className={cn("inline-flex items-center gap-1 rounded-lg px-2 py-1 font-mono text-sm font-extrabold ring-1", tone)}>
            <span>{fieldKey || "?"}</span>
            {def.applies_to ? (
                <span className="rounded-full bg-white/70 px-1 py-0.5 text-[8px] font-bold uppercase tracking-widest opacity-80">{def.applies_to}</span>
            ) : null}
            <button
                type="button"
                onClick={onRemove}
                className="grid h-4 w-4 place-items-center rounded-full bg-rose-500 text-white hover:bg-rose-600"
                title="Remove factor"
            ><X className="h-2.5 w-2.5" /></button>
        </span>
    )
}

function FactorAdder({
    allFieldKeys, onAddNumber, onAddField, onAddTermNumber, onAddTermField,
}: {
    allFieldKeys: string[]
    onAddNumber: () => void
    onAddField: (k: string) => void
    onAddTermNumber: () => void
    onAddTermField: (k: string) => void
}) {
    const [open, setOpen] = React.useState(false)
    const wrapperRef = React.useRef<HTMLSpanElement | null>(null)
    React.useEffect(() => {
        const onClick = (e: MouseEvent) => {
            if (!open) return
            if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false)
        }
        document.addEventListener("mousedown", onClick)
        return () => document.removeEventListener("mousedown", onClick)
    }, [open])
    return (
        <span ref={wrapperRef} className="relative inline-flex">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className={cn(
                    "inline-flex items-center gap-1 rounded-lg border-2 border-dashed px-2.5 py-1.5 text-[11px] font-bold transition",
                    open
                        ? "border-emerald-500 bg-emerald-100 text-emerald-900"
                        : "border-emerald-400 bg-white text-emerald-800 hover:bg-emerald-50",
                )}
                title="Multiply by another factor OR add a new term"
            >
                <Plus className="h-3 w-3" />
                <span>extend formula…</span>
            </button>
            {open ? (
                <div className="absolute left-0 top-full z-20 mt-1 min-w-[320px] rounded-xl border border-emerald-200 bg-white p-3 shadow-xl">
                    {/* MULTIPLY (in this term) */}
                    <div className="rounded-lg border-2 border-emerald-200 bg-emerald-50/40 p-2">
                        <div className="mb-1 flex items-center justify-between">
                            <span className="text-[10px] font-black uppercase tracking-widest text-emerald-700">
                                × multiply this term by…
                            </span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                            <button
                                type="button"
                                onClick={() => { onAddNumber(); setOpen(false) }}
                                className="rounded-md bg-slate-900 px-2 py-1 text-[11px] font-bold text-emerald-200 hover:bg-slate-800"
                                title="Multiply by a constant number"
                            >
                                a number
                            </button>
                            {allFieldKeys.map((k) => (
                                <button
                                    key={k}
                                    type="button"
                                    onClick={() => { onAddField(k); setOpen(false) }}
                                    className={cn("rounded-md px-2 py-1 text-[11px] font-bold ring-1", toneFor(k))}
                                    title={`Multiply this term by ${k}`}
                                >
                                    {k}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* ADD (new term) */}
                    <div className="mt-2 rounded-lg border-2 border-amber-200 bg-amber-50/40 p-2">
                        <div className="mb-1 flex items-center justify-between">
                            <span className="text-[10px] font-black uppercase tracking-widest text-amber-700">
                                + add a NEW term with…
                            </span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                            <button
                                type="button"
                                onClick={() => { onAddTermNumber(); setOpen(false) }}
                                className="rounded-md bg-slate-900 px-2 py-1 text-[11px] font-bold text-amber-200 hover:bg-slate-800"
                                title="Add a new constant term"
                            >
                                a number
                            </button>
                            {allFieldKeys.map((k) => (
                                <button
                                    key={k}
                                    type="button"
                                    onClick={() => { onAddTermField(k); setOpen(false) }}
                                    className={cn("rounded-md px-2 py-1 text-[11px] font-bold ring-1", toneFor(k))}
                                    title={`Add ${k} as a new term`}
                                >
                                    {k}
                                </button>
                            ))}
                        </div>
                        <div className="mt-1 text-[10px] text-amber-900/70">
                            Use this when you want <b>W + H</b>, <b>2W + flap</b>, etc. — separate term that adds to the formula.
                        </div>
                    </div>
                </div>
            ) : null}
        </span>
    )
}

function CustomFieldAdder({ onAdd }: { onAdd: (k: string) => void }) {
    const [v, setV] = React.useState("")
    return (
        <div className="flex items-center gap-1">
            <Input value={v} onChange={(e) => setV(e.target.value)} placeholder="custom_key" className="h-8 w-32 text-[12px]" />
            <Button size="sm" variant="outline" onClick={() => { if (v.trim()) { onAdd(v.trim()); setV("") } }}>
                <Plus className="h-3 w-3" />
            </Button>
        </div>
    )
}

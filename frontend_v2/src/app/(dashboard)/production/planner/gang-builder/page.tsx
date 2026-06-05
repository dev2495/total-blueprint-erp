"use client"

import * as React from "react"
import Link from "next/link"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import {
    Combine,
    Scissors,
    AlertTriangle,
    Loader2,
    Sparkles,
    Boxes,
    CheckCircle2,
    ChevronRight,
    Layers,
} from "lucide-react"

import { GradientHero } from "@/components/erp/gradient-hero"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"
import { plannerService, type GangCandidateGroup, type GangCandidateJob } from "@/services/planner"

const PROCESS_LABEL: Record<string, string> = {
    EXTR: "Extrusion",
    EXTRU: "Extrusion",
    EXTRUSION: "Extrusion",
    LAM: "Lamination",
    LAMI: "Lamination",
    LAMIN: "Lamination",
    LAMINATION: "Lamination",
    PRINT: "Printing",
    PRINTING: "Printing",
    SLIT: "Slitting",
    SLIT_REWIND: "Slitting",
    POUCH: "Pouching",
    POUCHING: "Pouching",
    BAG: "Bag making",
    BAGMAKING: "Bag making",
}

function processLabel(code: string): string {
    const up = String(code || "").toUpperCase()
    return PROCESS_LABEL[up] || (up ? up.charAt(0) + up.slice(1).toLowerCase() : "Unknown step")
}

export default function GangBuilderPage() {
    const qc = useQueryClient()
    const { data, isLoading, refetch } = useQuery({
        queryKey: ["gang-candidates"],
        queryFn: plannerService.getGangCandidates,
        refetchInterval: 12_000,
    })

    const groups = data?.groups || []
    const totalGroups = data?.total_groups || 0
    const eligibleGroups = groups.filter((g) => g.eligible_for_ganging)
    const totalJobsAcrossEligible = eligibleGroups.reduce((s, g) => s + g.job_count, 0)
    const potentialKg = eligibleGroups.reduce((s, g) => s + g.total_qty_kg, 0)

    const [activeGroupKey, setActiveGroupKey] = React.useState<string>("")
    const activeGroup =
        groups.find((g) => (g.group_key || g.layer_signature_hash) === activeGroupKey) ||
        eligibleGroups[0] ||
        null
    React.useEffect(() => {
        if (!activeGroupKey && eligibleGroups[0])
            setActiveGroupKey(eligibleGroups[0].group_key || eligibleGroups[0].layer_signature_hash)
    }, [eligibleGroups.length, activeGroupKey])

    return (
        <div className="min-h-screen bg-gradient-to-b from-slate-50/80 via-white to-slate-50/40 px-4 py-4 sm:px-6">
            <GradientHero
                palette="indigo"
                eyebrow="PLANNER · COMBINE ORDERS"
                title="Combine multiple orders onto one jumbo roll"
                subtitle="When several orders need the same film recipe at the same step, run them together on one wider jumbo. The slitter cuts it into one piece per order — fewer setups, less startup waste."
                chips={[
                    { icon: <Combine className="h-4 w-4" />, label: "Recipe groups", value: String(totalGroups), tone: "violet" },
                    { icon: <Layers className="h-4 w-4" />, label: "Combinable orders", value: String(totalJobsAcrossEligible), tone: "info" },
                    { icon: <Boxes className="h-4 w-4" />, label: "Film needed", value: `${potentialKg.toFixed(0)} kg`, tone: "ok" },
                ]}
            />

            <FlowSteps />

            <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
                <GroupListCard
                    groups={groups}
                    isLoading={isLoading}
                    activeGroupKey={(activeGroup?.group_key || activeGroup?.layer_signature_hash) || ""}
                    onSelect={(key) => setActiveGroupKey(key)}
                />
                <GangWorkspaceCard
                    group={activeGroup}
                    onCommitted={() => {
                        refetch()
                        qc.invalidateQueries({ queryKey: ["gang-candidates"] })
                    }}
                />
            </div>
        </div>
    )
}

function FlowSteps() {
    const steps = [
        { n: 1, label: "Pick a recipe group", sub: "Left side · same film + same step" },
        { n: 2, label: "Tick 2 or more orders", sub: "Right side · check the rows" },
        { n: 3, label: "Press Combine orders", sub: "They share one jumbo at the machine" },
    ]
    return (
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {steps.map((s, i) => (
                <div
                    key={s.n}
                    className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-surface-1 px-3 py-2.5 shadow-sm"
                >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-100 text-[11px] font-black text-violet-700">
                        {s.n}
                    </span>
                    <div className="min-w-0 flex-1">
                        <div className="text-[12px] font-bold text-slate-900">{s.label}</div>
                        <div className="truncate text-[10px] text-slate-500">{s.sub}</div>
                    </div>
                    {i < steps.length - 1 ? (
                        <ChevronRight className="hidden h-4 w-4 shrink-0 text-slate-300 sm:block" />
                    ) : null}
                </div>
            ))}
        </div>
    )
}

function GroupSummary({ group }: { group: GangCandidateGroup }) {
    const widths = group.jobs
        .map((j) => Math.round(j.target_width_mm || 0))
        .filter((w) => w > 0)
    const uniqueWidths = Array.from(new Set(widths))
    const stepName = processLabel(group.process_code)
    return (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px] text-content-3">
            <span className="font-semibold text-slate-700">{stepName}</span>
            <span>·</span>
            <span>Step {group.step_index + 1}</span>
            {uniqueWidths.length > 0 ? (
                <>
                    <span>·</span>
                    <span className="font-mono">
                        {uniqueWidths.length <= 4
                            ? uniqueWidths.map((w) => `${w}mm`).join(" + ")
                            : `${uniqueWidths.length} different widths`}
                    </span>
                </>
            ) : null}
        </div>
    )
}

function GroupListCard({
    groups,
    isLoading,
    activeGroupKey,
    onSelect,
}: {
    groups: GangCandidateGroup[]
    isLoading: boolean
    activeGroupKey: string
    onSelect: (key: string) => void
}) {
    return (
        <aside className="rounded-2xl border border-slate-200 bg-surface-1 shadow-sm">
            <header className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-50 text-violet-600">
                    <Layers className="h-4 w-4" />
                </span>
                <div>
                    <h2 className="font-display text-sm font-bold text-slate-900">Recipe groups</h2>
                    <p className="text-[10px] text-slate-500">Orders that share the same film recipe at the same step.</p>
                </div>
            </header>
            {isLoading ? (
                <div className="flex items-center justify-center p-10 text-slate-500">
                    <Loader2 className="h-5 w-5 animate-spin" />
                </div>
            ) : groups.length === 0 ? (
                <div className="flex flex-col items-center gap-2 p-10 text-center text-slate-500">
                    <AlertTriangle className="h-6 w-6 text-amber-500" />
                    <div className="text-sm font-semibold text-slate-700">No active recipes yet</div>
                    <p className="max-w-[260px] text-[11px] leading-relaxed">
                        As sales orders confirm or stock-launcher runs start, their film recipes show up here automatically.
                    </p>
                </div>
            ) : (
                <div className="max-h-[70vh] overflow-y-auto p-3">
                    {groups.map((g) => {
                        const key = g.group_key || g.layer_signature_hash
                        const active = key === activeGroupKey
                        const eligible = g.eligible_for_ganging
                        return (
                            <button
                                key={key}
                                type="button"
                                onClick={() => onSelect(key)}
                                className={cn(
                                    "mb-2 block w-full rounded-2xl border p-3 text-left transition",
                                    active
                                        ? "border-violet-300 bg-violet-50/60 ring-2 ring-violet-200"
                                        : "border-slate-200 bg-surface-1 hover:bg-slate-50",
                                )}
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                        {eligible ? (
                                            <Badge className="bg-emerald-100 text-[9px] text-emerald-800 hover:bg-emerald-100">
                                                <CheckCircle2 className="mr-0.5 h-2.5 w-2.5" />
                                                {g.job_count} orders · combinable
                                            </Badge>
                                        ) : (
                                            <Badge variant="outline" className="border-slate-200 text-[9px] text-slate-500">
                                                {g.job_count} order{g.job_count === 1 ? "" : "s"} · single
                                            </Badge>
                                        )}
                                    </div>
                                    <span className="font-mono text-[9px] text-content-4" title="Recipe fingerprint (internal)">
                                        #{g.layer_signature_hash.slice(0, 6)}
                                    </span>
                                </div>
                                <GroupSummary group={g} />
                                <div className="mt-1.5 flex items-center gap-2 text-[10.5px] text-content-3">
                                    <span><b className="text-content-2">{g.total_qty_kg.toFixed(0)} kg</b> film needed</span>
                                </div>
                            </button>
                        )
                    })}
                </div>
            )}
        </aside>
    )
}

function GangWorkspaceCard({
    group,
    onCommitted,
}: {
    group: GangCandidateGroup | null
    onCommitted: () => void
}) {
    const { toast } = useToast()
    const [selected, setSelected] = React.useState<Record<string, boolean>>({})

    React.useEffect(() => {
        setSelected({})
    }, [group?.group_key, group?.layer_signature_hash])

    const selectedIds = Object.keys(selected).filter((k) => selected[k])
    const selectedJobs = (group?.jobs || []).filter((j) => selected[j.job_id])
    const selectedSumKg = selectedJobs.reduce((s, j) => s + (j.quantity || 0), 0)
    const selectedWidths = selectedJobs
        .map((j) => Math.round(j.target_width_mm || 0))
        .filter((w) => w > 0)
    const SLITTER_TRIM_PER_CUT = 5
    const jumboWidthEstimate =
        selectedWidths.reduce((s, w) => s + w, 0) +
        Math.max(0, selectedWidths.length - 1) * SLITTER_TRIM_PER_CUT
    const noWidthsYet = selectedJobs.some((j) => !j.target_width_mm)

    const commit = useMutation({
        mutationFn: async () => {
            if (!group) throw new Error("Pick a recipe group first")
            if (selectedIds.length < 2) throw new Error("Pick 2 or more orders to combine")
            return plannerService.commitGang(group.layer_signature_hash, selectedIds)
        },
        onSuccess: (res) => {
            toast({
                title: `${res.affected_jobs} orders combined`,
                description: `Batch ${res.gang_group_id} · they'll slit together at the machine`,
            })
            setSelected({})
            onCommitted()
        },
        onError: (err: any) => {
            toast({
                title: "Could not combine",
                description: String(err?.message || err),
                variant: "destructive",
            })
        },
    })

    if (!group) {
        return (
            <section className="rounded-2xl border border-dashed border-line-strong bg-surface-1 p-10 text-center">
                <Combine className="mx-auto h-10 w-10 text-slate-300" />
                <p className="mt-3 text-sm font-semibold text-slate-700">Pick a recipe group on the left</p>
                <p className="mt-1 text-xs text-slate-500">
                    Groups with 2 or more orders can be combined onto one jumbo.
                </p>
            </section>
        )
    }

    const stepName = processLabel(group.process_code)

    return (
        <section className="space-y-3">
            <SlitLayoutPreview group={group} selectedJobs={selectedJobs} jumboWidthEstimate={jumboWidthEstimate} />

            {/* Orders picker */}
            <div className="rounded-2xl border border-slate-200 bg-surface-1 shadow-sm">
                <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-3">
                    <div className="flex items-center gap-2">
                        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                            <CheckCircle2 className="h-4 w-4" />
                        </span>
                        <div>
                            <h2 className="font-display text-sm font-bold text-slate-900">
                                Pick orders to combine
                            </h2>
                            <p className="text-[10px] text-slate-500">
                                All these orders share the same film recipe at <b>{stepName}</b> (step {group.step_index + 1}).
                                Tick 2 or more to combine them on one jumbo.
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-content-3">
                        <span>
                            <b className="text-content-2">{selectedIds.length}</b>/{group.job_count} ticked
                        </span>
                        {selectedSumKg > 0 ? (
                            <>
                                <span>·</span>
                                <span>
                                    <b className="text-content-2">{selectedSumKg.toFixed(0)} kg</b> film
                                </span>
                            </>
                        ) : null}
                    </div>
                </header>
                <div className="divide-y divide-slate-100">
                    {group.jobs.map((j) => {
                        const checked = !!selected[j.job_id]
                        return (
                            <label
                                key={j.job_id}
                                className={cn(
                                    "flex cursor-pointer items-center justify-between gap-3 px-5 py-3 transition",
                                    checked ? "bg-indigo-50/40" : "hover:bg-slate-50/60",
                                )}
                            >
                                <div className="flex items-center gap-3">
                                    <Checkbox
                                        checked={checked}
                                        onCheckedChange={(v) =>
                                            setSelected((s) => ({ ...s, [j.job_id]: Boolean(v) }))
                                        }
                                    />
                                    <div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            {j.sales_order_number ? (
                                                <span className="font-mono text-sm font-bold text-slate-900">
                                                    {j.sales_order_number}
                                                </span>
                                            ) : (
                                                <span className="font-mono text-sm font-bold text-slate-900">
                                                    {j.job_number}
                                                </span>
                                            )}
                                            {j.customer_name ? (
                                                <span className="text-[11px] font-semibold text-slate-700">
                                                    · {j.customer_name}
                                                </span>
                                            ) : null}
                                            {j.is_generic_stock ? (
                                                <Badge className="bg-violet-100 text-[10px] text-violet-700 hover:bg-violet-100">
                                                    <Sparkles className="mr-0.5 h-2.5 w-2.5" /> generic stock
                                                </Badge>
                                            ) : null}
                                        </div>
                                        <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-slate-500">
                                            {j.target_width_mm ? (
                                                <span className="font-mono font-semibold text-slate-700">
                                                    {Math.round(j.target_width_mm)} mm wide
                                                </span>
                                            ) : (
                                                <span className="font-mono text-warning-fg">no roll width set</span>
                                            )}
                                            <span>·</span>
                                            <span className="font-mono text-slate-700">
                                                {(j.quantity || 0).toFixed(0)} {j.uom}
                                            </span>
                                            <span>·</span>
                                            <span>Job {j.job_number.slice(-8)}</span>
                                        </div>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <Badge variant="outline" className="border-slate-200 text-[10px] text-content-3">
                                        {j.job_state}
                                    </Badge>
                                </div>
                            </label>
                        )
                    })}
                </div>
                <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 bg-slate-50/60 px-5 py-3">
                    <div className="text-[11.5px] text-slate-700">
                        {selectedIds.length < 2 ? (
                            <span className="text-slate-500">Pick at least 2 orders to combine.</span>
                        ) : noWidthsYet ? (
                            <span className="text-warning-fg">
                                One or more orders has no roll width set — combining is not safe.
                            </span>
                        ) : (
                            <span>
                                Combine <b>{selectedIds.length}</b> orders →
                                jumbo needs ≥ <b>{jumboWidthEstimate} mm</b> wide ·
                                ~<b>{selectedSumKg.toFixed(0)} kg</b> film
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setSelected({})}
                            disabled={selectedIds.length === 0}
                        >
                            Clear ticks
                        </Button>
                        <Button
                            size="sm"
                            onClick={() => commit.mutate()}
                            disabled={selectedIds.length < 2 || commit.isPending || noWidthsYet}
                            className="bg-violet-600 text-white hover:bg-violet-700"
                        >
                            {commit.isPending ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                                <Combine className="mr-2 h-4 w-4" />
                            )}
                            Combine {selectedIds.length || ""} orders
                        </Button>
                    </div>
                </footer>
            </div>

            {/* Help footer */}
            <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 px-4 py-3 text-[11.5px] text-indigo-900">
                <div className="font-bold text-indigo-700">What happens after you press Combine</div>
                <ol className="mt-1 list-decimal space-y-0.5 pl-5 leading-5">
                    <li>The chosen orders are tagged with a shared <b>batch number</b>.</li>
                    <li>
                        At the machine (work-centre), when the operator starts any one of these orders, the roll-picker shows a wider jumbo and slits it into <b>one piece per order</b>.
                    </li>
                    <li>
                        Slitter trim of <b>5 mm per cut</b> is taken from the jumbo. Anything left over (≥ 200 mm) goes back to the remainder pool for future use.
                    </li>
                </ol>
                <div className="mt-2">
                    Slits happen at the <Link className="font-bold text-indigo-700 underline" href="/production/work-center">work-centre terminal</Link> — this page only plans them.
                </div>
            </div>
        </section>
    )
}

function SlitLayoutPreview({
    group,
    selectedJobs,
    jumboWidthEstimate,
}: {
    group: GangCandidateGroup
    selectedJobs: GangCandidateJob[]
    jumboWidthEstimate: number
}) {
    const jobsToRender = selectedJobs.length > 0 ? selectedJobs : group.jobs.slice(0, 4)
    const stepName = processLabel(group.process_code)
    return (
        <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-white via-slate-50/40 to-violet-50/30 p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-fuchsia-50 text-fuchsia-600">
                        <Scissors className="h-4 w-4" />
                    </span>
                    <div>
                        <h2 className="font-display text-sm font-bold text-slate-900">Slit layout preview</h2>
                        <p className="text-[10px] text-slate-500">
                            {selectedJobs.length > 0
                                ? `Showing ${selectedJobs.length} ticked order${selectedJobs.length === 1 ? "" : "s"}.`
                                : "Showing first 4 orders in this recipe group (tick orders below to lock the layout)."}
                            {" "}One block = one slit.
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Badge variant="outline" className="border-violet-200 bg-violet-50 text-[10px] text-violet-700">
                        {stepName} · step {group.step_index + 1}
                    </Badge>
                    {selectedJobs.length >= 2 && jumboWidthEstimate > 0 ? (
                        <Badge className="bg-emerald-100 text-[10px] text-emerald-800 hover:bg-emerald-100">
                            jumbo ≥ {jumboWidthEstimate} mm
                        </Badge>
                    ) : null}
                </div>
            </div>

            <div className="mt-4 flex h-32 items-stretch gap-1 overflow-x-auto rounded-xl bg-slate-100/50 p-2 ring-1 ring-slate-200/60">
                {jobsToRender.length === 0 ? (
                    <div className="flex w-full items-center justify-center text-xs text-content-4">
                        No orders to preview yet.
                    </div>
                ) : (
                    jobsToRender.map((j, idx) => {
                        const colorTones = [
                            "from-indigo-100 to-indigo-200 text-indigo-900",
                            "from-fuchsia-100 to-fuchsia-200 text-fuchsia-900",
                            "from-emerald-100 to-emerald-200 text-emerald-900",
                            "from-amber-100 to-amber-200 text-amber-900",
                            "from-sky-100 to-sky-200 text-sky-900",
                            "from-rose-100 to-rose-200 text-rose-900",
                        ]
                        const tone = colorTones[idx % colorTones.length]
                        const widthMm = j.target_width_mm || 0
                        const flexBasis = Math.max(80, Math.min(280, widthMm > 0 ? widthMm / 2 + 40 : (j.quantity || 100) / 2 + 80))
                        return (
                            <div
                                key={j.job_id}
                                style={{ flexBasis }}
                                className={cn(
                                    "flex min-w-[80px] flex-col items-center justify-center rounded-md bg-gradient-to-b p-2 ring-1 ring-white",
                                    tone,
                                )}
                            >
                                <div className="font-mono text-[10px] font-bold">
                                    {j.sales_order_number ? j.sales_order_number.slice(-8) : j.job_number.slice(-8)}
                                </div>
                                {widthMm > 0 ? (
                                    <div className="mt-1 font-mono text-[10.5px] font-bold opacity-90">
                                        {Math.round(widthMm)} mm
                                    </div>
                                ) : (
                                    <div className="mt-1 text-[10px] text-warning-fg">no width</div>
                                )}
                                <div className="mt-1 text-[10px] opacity-80">
                                    {(j.quantity || 0).toFixed(0)} {j.uom}
                                </div>
                                {j.customer_name ? (
                                    <div className="mt-0.5 truncate text-[9px] opacity-70">
                                        {j.customer_name.slice(0, 14)}
                                    </div>
                                ) : null}
                            </div>
                        )
                    })
                )}
            </div>
            <div className="mt-2 flex items-center justify-between text-[10px] text-slate-500">
                <span>← one slit per order →</span>
                <span className="font-mono">5 mm trimmed at each cut</span>
            </div>
        </div>
    )
}

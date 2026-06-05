"use client"

import { useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { Chip, ChipGroup } from "@/components/ds/chip"
import { StepStrip } from "@/components/ds/step-strip"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

import { usePlannerControlHub } from "@/hooks/use-planner"
import { plannerService, type ClaimCandidate } from "@/services/planner"

import { DemandLineList, FieldRow, SummaryStat, WizardShell } from "./shared"

export interface MatchWipWizardProps {
    seedOrderKey?: string | null
    seedSoItemId?: string | null
    onClose: () => void
}

type Picked = { candidate: ClaimCandidate; qty: number }

export function MatchWipWizard({ seedOrderKey, seedSoItemId, onClose }: MatchWipWizardProps) {
    const qc = useQueryClient()
    const [step, setStep] = useState<"pick-line" | "load" | "pick-rolls" | "confirm">("pick-line")
    const [selectedKey, setSelectedKey] = useState<string | null>(seedOrderKey ?? null)
    const [picks, setPicks] = useState<Record<string, Picked>>({})
    const [error, setError] = useState<string | null>(null)

    const controlHub = usePlannerControlHub({ planning_limit: 60, active_limit: 12, history_limit: 0 })
    const orders = controlHub.data?.orders ?? []
    const selected = useMemo(
        () => orders.find((o) => `${o.order_kind}:${o.order_id}` === selectedKey) ?? null,
        [orders, selectedKey],
    )
    const soItemId = selected?.sales_order_item_id || seedSoItemId || null

    useEffect(() => {
        if (seedOrderKey && orders.find((o) => `${o.order_kind}:${o.order_id}` === seedOrderKey)) {
            setSelectedKey(seedOrderKey)
            setStep("load")
        }
    }, [seedOrderKey, orders])

    const candidatesQuery = useQuery({
        queryKey: ["planner", "match-wip-candidates", soItemId],
        queryFn: () => plannerService.getClaimCandidates(String(soItemId)),
        enabled: !!soItemId && (step === "load" || step === "pick-rolls" || step === "confirm"),
    })

    useEffect(() => {
        if (step === "load" && candidatesQuery.isSuccess) {
            setStep("pick-rolls")
        }
    }, [step, candidatesQuery.isSuccess])

    const candidates = candidatesQuery.data?.candidates ?? []
    const required = Number(candidatesQuery.data?.remaining_qty_kg ?? selected?.required_qty_kg ?? 0)
    const allocatedTotal = Object.values(picks).reduce((sum, p) => sum + (Number(p.qty) || 0), 0)
    const remaining = Math.max(0, required - allocatedTotal)

    const claimMut = useMutation({
        mutationFn: async () => {
            if (!soItemId) throw new Error("Sales order item missing")
            for (const pick of Object.values(picks)) {
                await plannerService.claimStockToSales(soItemId, {
                    inventory_type: pick.candidate.inventory_type,
                    inventory_id: pick.candidate.inventory_id,
                    claim_qty_kg: Number(pick.qty),
                })
            }
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ["planner"] })
            onClose()
        },
        onError: (e: any) => setError(e?.response?.data?.detail || e?.message || "Failed to claim WIP"),
    })

    const togglePick = (cand: ClaimCandidate) => {
        setPicks((prev) => {
            const id = cand.inventory_id
            const next = { ...prev }
            if (next[id]) {
                delete next[id]
            } else {
                const cap = Number(cand.claimable_qty_kg || 0)
                next[id] = { candidate: cand, qty: Math.min(cap, remaining || cap) }
            }
            return next
        })
    }

    const updateQty = (id: string, value: number) => {
        setPicks((prev) => {
            if (!prev[id]) return prev
            const cap = Number(prev[id].candidate.claimable_qty_kg || 0)
            return { ...prev, [id]: { ...prev[id], qty: Math.max(0, Math.min(cap, value)) } }
        })
    }

    const stepDefs = [
        { id: "pick-line", label: "Pick demand", hint: "Sales line" },
        { id: "load", label: "Find matches", hint: "claim_candidates" },
        { id: "pick-rolls", label: "Pick WIP", hint: "Choose rolls" },
        { id: "confirm", label: "Confirm", hint: "Claim WIP" },
    ]

    return (
        <WizardShell
            title="Match WIP · claim a WIP roll"
            onBack={onClose}
            footer={
                <>
                    {step !== "pick-line" ? (
                        <Button variant="ghost" onClick={() => setStep(step === "confirm" ? "pick-rolls" : "pick-line")}>
                            Previous
                        </Button>
                    ) : null}
                    {step === "pick-line" ? (
                        <Button disabled={!soItemId} onClick={() => setStep("load")}>
                            Find WIP matches
                        </Button>
                    ) : step === "load" ? (
                        <Button disabled>Loading…</Button>
                    ) : step === "pick-rolls" ? (
                        <Button disabled={Object.keys(picks).length === 0} onClick={() => setStep("confirm")}>
                            Next · review
                        </Button>
                    ) : (
                        <Button disabled={claimMut.isPending} onClick={() => claimMut.mutate()}>
                            {claimMut.isPending ? "Claiming…" : "Confirm claim"}
                        </Button>
                    )}
                </>
            }
        >
            <StepStrip steps={stepDefs} currentId={step} compact />

            {error ? (
                <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-xs text-danger-fg">{error}</div>
            ) : null}

            {step === "pick-line" ? (
                <section className="space-y-2">
                    <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Sales lines awaiting plan</h3>
                    <DemandLineList
                        orders={orders}
                        selectedKey={selectedKey}
                        onSelect={setSelectedKey}
                        isLoading={controlHub.isLoading}
                        filter={(o) => Boolean(o.sales_order_item_id) && Boolean(o.source_availability?.has_wip)}
                        emptyText="No sales lines have WIP matches available."
                    />
                </section>
            ) : null}

            {step === "load" ? (
                <section className="rounded-lg border border-slate-200 bg-slate-50/60 p-4 text-center text-sm text-content-3">
                    Searching for WIP roll matches…
                </section>
            ) : null}

            {step === "pick-rolls" ? (
                <section className="space-y-2">
                    <div className="grid grid-cols-3 gap-2">
                        <SummaryStat label="Required" value={`${required.toFixed(1)} kg`} tone="info" />
                        <SummaryStat label="Allocated" value={`${allocatedTotal.toFixed(1)} kg`} tone={allocatedTotal >= required ? "success" : "warn"} />
                        <SummaryStat label="Remaining" value={`${remaining.toFixed(1)} kg`} tone={remaining > 0 ? "warn" : "success"} />
                    </div>
                    {candidatesQuery.isLoading ? (
                        <div className="rounded-lg border border-dashed border-slate-200 bg-surface-1 p-4 text-center text-sm text-slate-500">Loading candidates…</div>
                    ) : candidates.length === 0 ? (
                        <div className="rounded-lg border border-dashed border-slate-200 bg-surface-1 p-4 text-center text-sm text-slate-500">
                            No WIP candidates returned for this line.
                        </div>
                    ) : (
                        <div className="grid max-h-[320px] gap-2 overflow-y-auto pr-1">
                            {candidates.map((cand) => {
                                const id = cand.inventory_id
                                const pick = picks[id]
                                const cap = Number(cand.claimable_qty_kg || 0)
                                return (
                                    <div
                                        key={id}
                                        className={cn(
                                            "flex flex-col gap-2 rounded-lg border bg-surface-1 p-3 transition-colors",
                                            pick ? "border-blue-300 bg-blue-50/40" : "border-slate-200",
                                        )}
                                    >
                                        <div className="flex items-baseline justify-between gap-2">
                                            <div>
                                                <div className="font-mono-token text-[13px] font-semibold text-slate-900">{cand.label}</div>
                                                <div className="text-[11px] text-slate-500">
                                                    {cand.source_stock_order_no ? `From PSO ${cand.source_stock_order_no}` : "Free WIP"}
                                                </div>
                                            </div>
                                            <ChipGroup spacing="tight">
                                                <Chip kind="info" size="sm" mono>{cap.toFixed(1)} kg</Chip>
                                                {cand.requires_split_for_partial ? (
                                                    <Chip kind="warn" size="sm">Split needed</Chip>
                                                ) : null}
                                            </ChipGroup>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Button
                                                size="sm"
                                                variant={pick ? "default" : "outline"}
                                                onClick={() => togglePick(cand)}
                                            >
                                                {pick ? "Selected" : "Select"}
                                            </Button>
                                            {pick ? (
                                                <FieldRow label="Claim qty (kg)">
                                                    <Input
                                                        type="number"
                                                        step="0.1"
                                                        max={cap}
                                                        min={0}
                                                        value={pick.qty}
                                                        onChange={(e) => updateQty(id, Number(e.target.value))}
                                                        className="h-9 max-w-[140px]"
                                                    />
                                                </FieldRow>
                                            ) : null}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </section>
            ) : null}

            {step === "confirm" && selected ? (
                <section className="space-y-3">
                    <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Review</h3>
                    <div className="rounded-lg border border-slate-200 bg-surface-1 p-3 text-[12px]">
                        <div className="font-semibold">{selected.order_number} · {selected.customer_name || "—"}</div>
                        <div className="text-content-3">{selected.template_name}</div>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                        <SummaryStat label="Required" value={`${required.toFixed(1)} kg`} tone="info" />
                        <SummaryStat label="Allocated" value={`${allocatedTotal.toFixed(1)} kg`} tone={allocatedTotal >= required ? "success" : "warn"} />
                        <SummaryStat label="Rolls" value={String(Object.keys(picks).length)} />
                    </div>
                    <div className="space-y-1">
                        {Object.values(picks).map((p) => (
                            <div key={p.candidate.inventory_id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-surface-1 px-3 py-1.5 text-[12px]">
                                <span className="font-mono-token">{p.candidate.label}</span>
                                <span className="font-mono-token">{p.qty.toFixed(1)} kg</span>
                            </div>
                        ))}
                    </div>
                </section>
            ) : null}
        </WizardShell>
    )
}

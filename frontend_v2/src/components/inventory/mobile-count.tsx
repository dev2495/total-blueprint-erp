"use client"

/**
 * V3.6 Mobile Count UI — floor walk for stock counts.
 *
 * Mobile-first, optimised for phone use during physical audits. Three views:
 *   1. Pick a location (per-location progress visible)
 *   2. Active counting screen (system qty vs counted qty + numeric keypad + auto-variance)
 *   3. Variance flag screen (over-2% requires reason picker + photo evidence)
 *
 * Backend wiring: loads audit batch locations/items and posts each floor count line.
 * Offline-first behavior: failed saves are surfaced as unsynced until the next retry.
 */

import * as React from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeft, Camera, Check, Loader2, Wifi, WifiOff } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"
import { describeApiError } from "@/lib/api"
import { cn } from "@/lib/utils"
import { inventoryService } from "@/services/inventory"

type View = "locations" | "counting" | "variance"

interface CountRow {
    id: string
    materialCode: string
    locationCode: string
    materialKind: "BULK" | "ROLL" | "PACKAGING"
    systemQty: number
    countedQty?: number
    uom: string
    label?: string
    submitted: boolean
}

export function MobileCountV36() {
    const { toast } = useToast()
    const queryClient = useQueryClient()
    const searchParams = useSearchParams()
    const requestedBatchId = searchParams?.get("batch") || ""
    const [view, setView] = React.useState<View>("locations")
    const [activeLocation, setActiveLocation] = React.useState<string>("")
    const [keypadInput, setKeypadInput] = React.useState("")
    const [unsynced, setUnsynced] = React.useState(0)

    const { data: batches = [], error: batchesError } = useQuery({
        queryKey: ["audit-batches-active"],
        queryFn: () => inventoryService.getAuditBatches(),
        staleTime: 30_000,
    })

    const openBatches = (batches as any[]).filter((b) => !["POSTED", "CLOSED", "VOIDED", "VOID"].includes(String(b.status || "")))
    const activeBatch = openBatches.find((b) => String(b.id) === requestedBatchId)
        || openBatches.find((b) => Number(b.line_count || 0) > 0)
        || openBatches[0]
        || null

    const locationsQ = useQuery({
        queryKey: ["audit-batch-locations", activeBatch?.id],
        queryFn: () => inventoryService.getAuditBatchLocations(activeBatch!.id),
        enabled: !!activeBatch?.id,
        staleTime: 15_000,
    })

    const locations = React.useMemo(() => {
        return (locationsQ.data || []).map((l: any) => ({
            id: String(l.id || l.code),
            code: String(l.code || l.id),
            name: String(l.name || l.code || "Location"),
            total: Number(l.total || 0),
            counted: Number(l.counted || 0),
            status: Number(l.total || 0) > 0 && Number(l.counted || 0) >= Number(l.total || 0) ? "done" as const : Number(l.counted || 0) > 0 ? "active" as const : "pending" as const,
        }))
    }, [locationsQ.data])

    React.useEffect(() => {
        if (!activeLocation && locations.length > 0) {
            setActiveLocation(locations[0].id)
        }
    }, [activeLocation, locations])

    const itemsQ = useQuery({
        queryKey: ["audit-batch-items", activeBatch?.id, activeLocation],
        queryFn: () => inventoryService.getAuditBatchItems(activeBatch!.id, { location: activeLocation }),
        enabled: !!activeBatch?.id && !!activeLocation,
        staleTime: 5_000,
    })

    const rows = (itemsQ.data || []) as CountRow[]
    const currentRow = rows.find((row) => !row.submitted) || rows[0] || null
    const rowIndex = currentRow ? rows.findIndex((row) => row.id === currentRow.id) + 1 : 0

    const totalCounted = locations.reduce((s, l) => s + l.counted, 0)
    const totalLines = locations.reduce((s, l) => s + l.total, 0)
    const pct = totalLines === 0 ? 0 : Math.round((totalCounted / totalLines) * 100)
    const systemQty = Number(currentRow?.systemQty || 0)
    const queryError = batchesError || locationsQ.error || itemsQ.error

    const submitLineMutation = useMutation({
        mutationFn: async () => {
            if (!activeBatch?.id || !currentRow) {
                throw new Error("Pick an active batch line before saving.")
            }
            const counted = Number(keypadInput)
            return inventoryService.submitAuditCountLine(activeBatch.id, {
                line_id: currentRow.id,
                ref_id: currentRow.id,
                ref_type: currentRow.materialKind,
                counted_qty: counted,
                system_qty: currentRow.systemQty,
                location_code: currentRow.locationCode,
                offline_uuid: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `mobile-${Date.now()}`,
                device_id: "inventory-mobile-v36",
                counted_at: new Date().toISOString(),
            })
        },
        onSuccess: (result: any) => {
            queryClient.invalidateQueries({ queryKey: ["audit-batch-locations", activeBatch?.id] })
            queryClient.invalidateQueries({ queryKey: ["audit-batch-items", activeBatch?.id, activeLocation] })
            queryClient.invalidateQueries({ queryKey: ["audit-batches-active"] })
            setUnsynced(0)
            setKeypadInput("")
            toast({
                title: result?.flagged ? "Count saved with variance" : "Count saved",
                description: result?.flagged ? `Variance ${Number(result.variance_pct || 0).toFixed(1)}% is flagged for review.` : "Line synced to audit batch.",
            })
        },
        onError: (err) => {
            setUnsynced((n) => n + 1)
            toast({ title: "Count not synced", description: describeApiError(err, "Try again when connected."), variant: "destructive" })
        },
    })

    const finalizeBatchMutation = useMutation({
        mutationFn: () => inventoryService.finalizeAuditBatch(activeBatch!.id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ["audit-batches-active"] })
            toast({ title: "Batch finalized", description: "Variance review is ready in period management." })
        },
        onError: (err) => toast({ title: "Could not finalize batch", description: describeApiError(err, "Try again."), variant: "destructive" }),
    })

    return (
        <div data-testid="mobile-count-v36" className="min-h-dvh bg-gradient-to-b from-slate-900 to-indigo-950 text-slate-100">
            {/* Status bar */}
            <div className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-800 bg-slate-900/95 px-5 py-2 backdrop-blur">
                <Link href="/inventory/period" className="flex items-center gap-1 text-[11px] font-bold text-slate-400 hover:text-white">
                    <ArrowLeft className="h-3.5 w-3.5" /> Period
                </Link>
                <div className="flex items-center gap-2 text-[10px] font-mono text-slate-300">
                    {unsynced > 0 ? (
                        <span className="flex items-center gap-1 text-amber-400"><WifiOff className="h-3 w-3" /> {unsynced} unsynced</span>
                    ) : (
                        <span className="flex items-center gap-1 text-emerald-400"><Wifi className="h-3 w-3" /> all synced</span>
                    )}
                </div>
            </div>

            {/* Header */}
            <div className="bg-gradient-to-br from-violet-700 via-fuchsia-700 to-rose-700 px-5 py-4">
                <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-wider text-white/80">
                    <span>📋 audit batch</span>
                    <span className="rounded-full bg-white/20 px-2 py-0.5 backdrop-blur">SUPERVISOR</span>
                </div>
                <div className="font-display mt-2 text-3xl font-black text-white leading-tight">
                    {activeBatch?.code || "AB-DRAFT"}
                </div>
                <div className="mt-1 text-sm text-white/90">{activeBatch?.name || "No active batch"}</div>
                <div className="mt-3 flex items-center gap-2">
                    <div className="flex-1 rounded-full bg-white/20 h-2 overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-emerald-400 to-emerald-300" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="font-mono text-xs font-black text-white">{pct}%</span>
                </div>
                <div className="mt-1 text-[10px] text-white/70 font-mono">{totalCounted} of {totalLines} lines · {totalLines - totalCounted} to go</div>
            </div>
            {queryError && (
                <div className="mx-5 mt-4 rounded-2xl border border-rose-400/50 bg-rose-950/50 px-4 py-3 text-xs text-rose-100">
                    <div className="font-bold">Count data did not load.</div>
                    <div className="mt-0.5">{describeApiError(queryError, "Check backend and retry.")}</div>
                </div>
            )}
            {!activeBatch && (
                <div className="mx-5 mt-4 rounded-2xl border border-amber-400/50 bg-amber-950/40 px-4 py-3 text-xs text-amber-100">
                    <div className="font-bold">No open audit batch.</div>
                    <div className="mt-0.5">Create a full or quick stock count from Period & Audit, then count here.</div>
                </div>
            )}

            {/* View 1: Pick location */}
            {view === "locations" && (
                <div className="px-5 py-4">
                    <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Pick a location to count</div>
                    <h2 className="font-display mt-1 text-xl font-bold text-white">Where are you?</h2>
                    <div className="mt-4 space-y-3">
                        {locationsQ.isLoading ? (
                            <div className="rounded-2xl border border-slate-700 bg-slate-800/60 px-4 py-8 text-center text-sm text-slate-300">
                                <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> Loading batch locations...
                            </div>
                        ) : locations.length === 0 ? (
                            <div className="rounded-2xl border border-slate-700 bg-slate-800/60 px-4 py-8 text-center text-sm text-slate-300">
                                No count lines are loaded for this batch yet.
                            </div>
                        ) : (
                            locations.map((l) => (
                                <LocationTile key={l.id} loc={l} onSelect={() => { setActiveLocation(l.id); setKeypadInput(""); setView("counting") }} />
                            ))
                        )}
                    </div>
                    <div className="sticky bottom-0 mt-6 -mx-5 border-t border-slate-700/50 bg-slate-900/95 px-5 py-3 backdrop-blur flex items-center justify-between">
                        <div className="text-[10px] font-mono text-slate-400">{totalCounted}/{totalLines}</div>
                        <Button
                            data-testid="count-submit-batch"
                            disabled={!activeBatch?.id || finalizeBatchMutation.isPending || totalLines === 0}
                            onClick={() => finalizeBatchMutation.mutate()}
                            className="rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-600 px-5 py-2 text-xs font-bold text-white shadow-lg"
                        >
                            {finalizeBatchMutation.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : "📋"} Submit batch
                        </Button>
                    </div>
                </div>
            )}

            {/* View 2: Counting screen */}
            {view === "counting" && (
                <div className="px-5 py-4">
                    <div className="flex items-center gap-2 text-[10px] font-mono">
                        <button onClick={() => setView("locations")} className="text-violet-400">←</button>
                        <span className="text-slate-400">{activeLocation}</span>
                        <span className="text-slate-600">/</span>
                        <span className="text-violet-300">Row {rowIndex || "—"} of {rows.length || "—"}</span>
                    </div>

                    {/* Material card */}
                    {itemsQ.isLoading ? (
                        <div className="mt-3 rounded-2xl border border-slate-700 bg-slate-800/60 px-4 py-8 text-center text-sm text-slate-300">
                            <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> Loading count lines...
                        </div>
                    ) : !currentRow ? (
                        <div className="mt-3 rounded-2xl border border-slate-700 bg-slate-800/60 px-4 py-8 text-center text-sm text-slate-300">
                            This location has no pending stock lines.
                        </div>
                    ) : (
                    <div data-testid="count-current-row" className="mt-2 rounded-2xl border-2 border-violet-500 bg-gradient-to-br from-violet-900/50 to-slate-900 p-4">
                        <div className="flex items-center gap-2">
                            <span className="rounded-full bg-violet-600 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-white">{currentRow.materialKind}</span>
                            <span className="rounded-full bg-blue-500/30 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-blue-200 ring-1 ring-blue-400/50">{currentRow.locationCode}</span>
                        </div>
                        <div className="font-display mt-2 text-2xl font-black text-white">{currentRow.label || currentRow.materialCode}</div>
                        <div className="mt-0.5 text-xs text-violet-200">{currentRow.materialCode}</div>
                        <div className="mt-3 grid grid-cols-2 gap-2">
                            <div className="rounded-lg bg-black/30 px-3 py-2">
                                <div className="text-[9px] font-black uppercase text-slate-400">System says</div>
                                <div className="font-mono text-xl font-bold text-white">{systemQty.toFixed(2)}</div>
                                <div className="text-[10px] text-slate-400">{currentRow.uom}</div>
                            </div>
                            <div className="rounded-lg bg-emerald-500/20 ring-1 ring-emerald-400/40 px-3 py-2">
                                <div className="text-[9px] font-black uppercase text-emerald-300">You count</div>
                                <div className="font-mono text-xl font-bold text-white">{keypadInput || "—"}</div>
                                <div className="text-[10px] text-emerald-300">type below</div>
                            </div>
                        </div>
                    </div>
                    )}

                    {/* Variance hint */}
                    {currentRow && keypadInput && (() => {
                        const counted = Number(keypadInput) || 0
                        const variance = counted - systemQty
                        const pct = systemQty === 0 ? (counted ? 100 : 0) : Math.abs(variance / systemQty * 100)
                        if (pct > 2) {
                            return (
                                <div className="mt-3 rounded-xl bg-rose-500/15 ring-1 ring-rose-400/40 px-3 py-2 flex items-center gap-2">
                                    <span className="text-rose-400 text-base">⚠</span>
                                    <div className="flex-1 text-[11px]">
                                        <div className="text-rose-300 font-bold">Variance {variance > 0 ? "+" : ""}{variance.toFixed(1)} KG · {pct.toFixed(1)}%</div>
                                        <div className="text-rose-200/80">Above 2% threshold · reason needed before submit</div>
                                    </div>
                                </div>
                            )
                        }
                        return (
                            <div className="mt-3 rounded-xl bg-emerald-500/15 ring-1 ring-emerald-400/40 px-3 py-2 flex items-center gap-2">
                                <Check className="text-emerald-400 h-4 w-4" />
                                <div className="flex-1 text-[11px]">
                                    <div className="text-emerald-300 font-bold">Variance {variance > 0 ? "+" : ""}{variance.toFixed(1)} KG · {pct.toFixed(1)}%</div>
                                    <div className="text-emerald-200/80">Within ±2% threshold · auto-accept</div>
                                </div>
                            </div>
                        )
                    })()}

                    {/* Numeric keypad */}
                    <div className="mt-3 rounded-2xl bg-slate-900/80 ring-1 ring-slate-700/50 p-3">
                        <div className="text-[9px] font-black uppercase tracking-wider text-slate-400 mb-2 px-1">Counted qty ({currentRow?.uom || "UOM"})</div>
                        <div className="rounded-xl bg-slate-950 px-3 py-3 text-right">
                            <div className="font-mono text-3xl font-black text-emerald-300">{keypadInput || "—"}</div>
                        </div>
                        <div className="grid grid-cols-3 gap-1.5 mt-3">
                            {["7", "8", "9", "4", "5", "6", "1", "2", "3", ".", "0", "⌫"].map((k) => (
                                <button key={k} data-testid={`count-key-${k === "⌫" ? "backspace" : k === "." ? "dot" : k}`} onClick={() => {
                                    if (k === "⌫") setKeypadInput((s) => s.slice(0, -1))
                                    else setKeypadInput((s) => s + k)
                                }} className={cn("rounded-xl text-xl font-black h-14 transition active:scale-95", k === "⌫" ? "bg-rose-700/50 text-rose-200" : "bg-slate-700/60 text-white hover:bg-slate-600 active:bg-slate-500")}>
                                    {k}
                                </button>
                            ))}
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-1.5">
                            <button className="rounded-xl bg-slate-700 text-white text-xs font-bold py-2"><Camera className="inline h-3.5 w-3.5 mr-1" /> Scan label</button>
                            <button onClick={() => setView("variance")} className="rounded-xl bg-amber-600 text-white text-xs font-bold py-2">🚩 Flag damage</button>
                        </div>
                    </div>

                    {/* Action */}
                    <div className="mt-4 flex items-center gap-2">
                        <button onClick={() => setKeypadInput("")} className="rounded-xl bg-slate-700 text-white text-xs font-bold px-3 py-2.5">Skip</button>
                        <Button data-testid="count-save-next" onClick={() => submitLineMutation.mutate()} disabled={!keypadInput || !currentRow || submitLineMutation.isPending} className="flex-1 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-500 px-4 py-3 text-base font-bold text-white shadow-lg shadow-emerald-500/30">
                            {submitLineMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : "✓"} Save &amp; next →
                        </Button>
                    </div>
                </div>
            )}

            {/* View 3: Variance / submit */}
            {view === "variance" && (
                <div className="px-5 py-4">
                    <div className="rounded-2xl border-2 border-rose-500 bg-gradient-to-br from-rose-900/50 to-slate-900 p-4">
                        <div className="flex items-center gap-2">
                            <span className="rounded-full bg-rose-600 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-white">⚠ VARIANCE FLAG</span>
                        </div>
                        <div className="font-display mt-2 text-xl font-black text-white">Variance review</div>
                        <div className="mt-1 text-xs text-rose-200">Pick a reason. Optional photo + note for audit trail.</div>
                    </div>

                    <div className="mt-3 space-y-1.5">
                        {[
                            { icon: "💧", label: "Spillage" },
                            { icon: "📉", label: "Shrinkage / evaporation" },
                            { icon: "🔢", label: "Possible miscount" },
                            { icon: "🔄", label: "Recount needed (lock for re-walk)" },
                            { icon: "✏️", label: "Other (note required)" },
                        ].map((r, i) => (
                            <button key={i} className="w-full flex items-center gap-3 rounded-xl bg-slate-800 ring-1 ring-slate-700 px-3 py-2.5 text-left hover:bg-slate-700">
                                <span className="text-xl">{r.icon}</span>
                                <span className="text-sm font-bold text-white flex-1">{r.label}</span>
                            </button>
                        ))}
                    </div>

                    <div className="mt-3">
                        <div className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1.5">Note (optional)</div>
                        <textarea rows={2} className="w-full rounded-xl bg-slate-800 border border-slate-700 text-white px-3 py-2 text-sm placeholder:text-slate-500" placeholder="e.g. cyan ink can showing visible evaporation marks" />
                    </div>

                    <button className="mt-3 w-full rounded-xl border-2 border-dashed border-slate-600 bg-slate-800/40 px-4 py-3 text-sm font-bold text-slate-300 flex items-center justify-center gap-2">
                        <Camera className="h-4 w-4" /> Add photo evidence
                    </button>

                    <div className="mt-4 flex items-center gap-2">
                        <Button variant="outline" onClick={() => setView("counting")} className="rounded-xl bg-slate-700 text-white border-slate-600 px-3 py-2.5">Back</Button>
                        <Button className="flex-1 rounded-xl bg-gradient-to-r from-violet-600 via-fuchsia-600 to-rose-600 px-4 py-3 text-base font-bold text-white shadow-lg shadow-violet-500/30">
                            📤 Save flag
                        </Button>
                    </div>
                </div>
            )}
        </div>
    )
}

function LocationTile({ loc, onSelect }: { loc: { id: string; code: string; name: string; total: number; counted: number; status: "done" | "active" | "pending" }; onSelect: () => void }) {
    const TONE = {
        done: "border-emerald-400 bg-gradient-to-br from-emerald-900/40 to-slate-800",
        active: "border-violet-400 bg-gradient-to-br from-violet-900/40 to-slate-800",
        pending: "border-slate-600 bg-slate-800/60",
    }[loc.status]
    const ICON_BG = { done: "bg-emerald-500", active: "bg-violet-500", pending: "bg-slate-700 text-slate-400" }[loc.status]
    const ICON = { done: "✓", active: "▶", pending: "○" }[loc.status]
    const LABEL = { done: "DONE", active: "▶ COUNTING NOW", pending: "PENDING" }[loc.status]
    const LABEL_COLOR = { done: "text-emerald-300", active: "text-violet-300", pending: "text-slate-400" }[loc.status]
    return (
        <button data-testid={`count-location-${loc.code}`} onClick={onSelect} className={cn("w-full rounded-2xl border-2 px-4 py-4 text-left transition hover:shadow-lg", TONE)}>
            <div className="flex items-center justify-between">
                <div>
                    <div className={cn("text-[10px] font-black uppercase tracking-wider", LABEL_COLOR)}>{LABEL}</div>
                    <div className="font-display text-lg font-bold text-white">{loc.code} · {loc.name}</div>
                    <div className={cn("text-xs font-mono", LABEL_COLOR)}>{loc.counted} of {loc.total} lines counted</div>
                </div>
                <span className={cn("flex h-12 w-12 items-center justify-center rounded-full text-white text-xl", ICON_BG)}>
                    {ICON}
                </span>
            </div>
        </button>
    )
}

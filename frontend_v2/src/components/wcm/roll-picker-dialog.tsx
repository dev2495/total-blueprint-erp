"use client"

import * as React from "react"
import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
    CheckCircle2,
    Scissors,
    Loader2,
    AlertTriangle,
    Sparkles,
    Boxes,
    Barcode,
    Filter,
    Info,
    PackagePlus,
    Search,
} from "lucide-react"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useToast } from "@/hooks/use-toast"
import { wcmService } from "@/services/wcm"
import { cn } from "@/lib/utils"

type Tier = "ORDER_BOUND" | "EXACT" | "WIDER_OK_WITH_SLIT" | "REMAINDER_POOL"
type SlitMode = "ONE" | "MAX" | "GANG"

interface RollPickerProps {
    jobId: string
    open: boolean
    onOpenChange: (open: boolean) => void
    onAssigned?: () => void
}

const TIER_PRESENTATION: Record<Tier, { label: string; subtitle: string; tone: string; icon: React.ElementType }> = {
    ORDER_BOUND: {
        label: "Reserved",
        subtitle: "Already committed to this order",
        tone: "bg-indigo-50 text-indigo-800 border-indigo-200",
        icon: CheckCircle2,
    },
    EXACT: {
        label: "Exact",
        subtitle: "Width fits within +10% auto window",
        tone: "bg-emerald-50 text-emerald-800 border-emerald-200",
        icon: Sparkles,
    },
    WIDER_OK_WITH_SLIT: {
        label: "Wider · will slit",
        subtitle: "Confirm slit children + remainder",
        tone: "bg-amber-50 text-amber-800 border-amber-200",
        icon: Scissors,
    },
    REMAINDER_POOL: {
        label: "Remainder",
        subtitle: "Recycled child from past slit",
        tone: "bg-slate-50 text-slate-800 border-slate-200",
        icon: Boxes,
    },
}

function ageLabel(createdAt: string | null | undefined) {
    if (!createdAt) return { text: "?", tone: "bg-slate-100 text-slate-600" }
    const ts = new Date(createdAt).getTime()
    if (Number.isNaN(ts)) return { text: "?", tone: "bg-slate-100 text-slate-600" }
    const days = Math.floor((Date.now() - ts) / (24 * 60 * 60 * 1000))
    if (days <= 0) return { text: "today", tone: "bg-emerald-50 text-emerald-700 border border-emerald-200" }
    if (days < 7) return { text: `${days}d`, tone: "bg-emerald-50 text-emerald-700 border border-emerald-200" }
    if (days < 30) return { text: `${days}d`, tone: "bg-amber-50 text-amber-800 border border-amber-200" }
    return { text: `${days}d`, tone: "bg-rose-50 text-rose-800 border border-rose-200" }
}

const STOCK_FORM_LABELS: Record<string, string> = {
    OPEN_WEB: "Open web",
    LAYFLAT_TUBE: "Lay-flat tube",
    FOLDED_WEB: "Folded web",
}

const WIDTH_BASIS_LABELS: Record<string, string> = {
    OPEN_WEB_WIDTH: "open width",
    LAYFLAT_WIDTH: "lay-flat width",
    FOLDED_WIDTH: "folded width",
}

const SLIT_POLICY_LABELS: Record<string, string> = {
    SLIT_ALLOWED: "slittable",
    EXACT_ONLY: "exact width only",
}

function stockFormLabel(value: any) {
    const key = String(value || "OPEN_WEB").toUpperCase()
    return STOCK_FORM_LABELS[key] || key.replace(/_/g, " ").toLowerCase()
}

function widthBasisLabel(value: any) {
    const key = String(value || "").toUpperCase()
    return WIDTH_BASIS_LABELS[key] || (key ? key.replace(/_/g, " ").toLowerCase() : "stock width")
}

function slitPolicyLabel(value: any) {
    const key = String(value || "").toUpperCase()
    return SLIT_POLICY_LABELS[key] || (key ? key.replace(/_/g, " ").toLowerCase() : "policy default")
}

function tierTooltip(c: any, target_width_mm: number): string {
    const tier = c?.tier as Tier
    if (tier === "EXACT") {
        return `Width ${Math.round(c.width_mm)} mm matches target ${Math.round(target_width_mm)} mm (within 10% auto-band).`
    }
    if (tier === "WIDER_OK_WITH_SLIT") {
        const sp = c.slit_preview || {}
        const childWidths = (sp.child_widths_mm || []).map((w: number) => Math.round(w)).join(" + ")
        const rem = Math.round(sp.remainder_mm || 0)
        const disp = sp.remainder_disposition || ""
        const remText = disp === "KEEP" ? "kept" : disp === "SCRAP" ? "scrapped" : "as-is"
        return `Will slit child${childWidths ? ` at ${childWidths} mm` : ""}; ${rem} mm remainder will be ${remText}.`
    }
    if (tier === "REMAINDER_POOL") {
        return "Reusing leftover from a previous slit (remainder pool)."
    }
    return "Reserved roll — already committed to this order."
}

function generateIdemKey(): string {
    // crypto.randomUUID is available in modern browsers and Node 19+; fall back
    // to a timestamp + Math.random concat so the build never breaks in older
    // runtimes.
    try {
        if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
            return crypto.randomUUID()
        }
    } catch { /* ignore */ }
    return `alloc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

export function WcmRollPickerDialog({ jobId, open, onOpenChange, onAssigned }: RollPickerProps) {
    const { toast } = useToast()
    const qc = useQueryClient()
    const [picks, setPicks] = React.useState<Record<string, boolean>>({})
    const [reason, setReason] = React.useState("")
    const [slitMode, setSlitMode] = React.useState<SlitMode>("ONE")
    const [scanInput, setScanInput] = React.useState("")
    const [showAged30, setShowAged30] = React.useState(false)
    const [hideRemainders, setHideRemainders] = React.useState(false)
    const [thisPlantOnly, setThisPlantOnly] = React.useState(false)
    const [staleFlash, setStaleFlash] = React.useState<number | null>(null)
    const lastCandidateCountRef = React.useRef<number>(0)
    const barcodeRef = React.useRef<HTMLInputElement | null>(null)
    const idemKeyRef = React.useRef<string>("")

    const tieredQuery = useQuery({
        queryKey: ["wcm-tiered-rolls", jobId],
        queryFn: () => wcmService.getTieredRolls(jobId),
        enabled: open && !!jobId,
        refetchInterval: open ? 5000 : false,
    })

    const candidates = tieredQuery.data?.candidates || []
    const targetWidth = tieredQuery.data?.planned_parent_width_mm || tieredQuery.data?.target_width_mm || 0
    const childTargetWidth = tieredQuery.data?.child_target_width_mm || targetWidth || 0
    const preferredLaneCount = tieredQuery.data?.preferred_lane_count || 1
    const policy = tieredQuery.data?.web_width_policy
    const targetContract = tieredQuery.data?.target_stock_contract || {}
    const minRemainder = policy?.min_remainder_mm ?? 50
    const remainingQtyKg = tieredQuery.data?.remaining_qty_kg ?? null
    const jobPlantId = String(tieredQuery.data?.job_plant_id || "")
    const jobPlantCode = String(tieredQuery.data?.job_plant_code || "")

    // Flash a stale-changed pill when count changes.
    React.useEffect(() => {
        if (!open) return
        const count = candidates.length
        if (lastCandidateCountRef.current && count !== lastCandidateCountRef.current) {
            setStaleFlash(count)
            const timer = setTimeout(() => setStaleFlash(null), 4000)
            return () => clearTimeout(timer)
        }
        lastCandidateCountRef.current = count
    }, [candidates.length, open])

    // Reset & autofocus scanner.
    React.useEffect(() => {
        if (!open) {
            setPicks({})
            setReason("")
            setSlitMode("ONE")
            setScanInput("")
            setShowAged30(false)
            setHideRemainders(false)
            setThisPlantOnly(false)
            lastCandidateCountRef.current = 0
            setStaleFlash(null)
            idemKeyRef.current = ""
            return
        }
        // Fresh idempotency key per dialog open. If the operator hits Confirm
        // twice (network retry / double-click) we send the same key so the
        // backend dedupes.
        idemKeyRef.current = generateIdemKey()
        // Defer to next tick so the dialog has mounted.
        const t = setTimeout(() => barcodeRef.current?.focus(), 80)
        return () => clearTimeout(t)
    }, [open])

    // Client-side filter set (chips).
    const filteredCandidates = React.useMemo(() => {
        const now = Date.now()
        return candidates.filter((c: any) => {
            if (hideRemainders && c.tier === "REMAINDER_POOL") return false
            if (showAged30) {
                const ts = c.created_at ? new Date(c.created_at).getTime() : 0
                const days = ts > 0 ? Math.floor((now - ts) / (24 * 60 * 60 * 1000)) : 0
                if (days < 30) return false
            }
            if (thisPlantOnly) {
                const candidatePlantId = String(c.plant_id || "")
                const candidatePlantCode = String(c.plant_code || "")
                if (jobPlantId) return candidatePlantId === jobPlantId
                if (jobPlantCode) return candidatePlantCode === jobPlantCode
                return false
            }
            return true
        })
    }, [candidates, showAged30, hideRemainders, thisPlantOnly, jobPlantId, jobPlantCode])

    const selectedIds = Object.keys(picks).filter((id) => picks[id])
    const selectedCandidates = filteredCandidates.filter((c: any) => picks[c.roll_id])
    const primarySelected = selectedCandidates[0] || null
    const isWiderOk = primarySelected?.tier === "WIDER_OK_WITH_SLIT"

    const totalSelectedWeight = selectedCandidates.reduce((sum: number, c: any) => sum + Number(c.weight_kg || 0), 0)

    /**
     * Effective picked weight = what will actually be committed to this job.
     *  - Full-roll (EXACT/ORDER_BOUND/REMAINDER_POOL): the whole roll weight
     *  - WIDER_OK_WITH_SLIT with mode=ONE: just the child weight (1 child)
     *  - WIDER_OK_WITH_SLIT with mode=MAX: sum of all children weights
     *  - WIDER_OK_WITH_SLIT in a committed gang: parent weight pro-rata of
     *    this job's child (best-effort estimate; backend authoritative).
     */
    const pickedWeightKg = React.useMemo(() => {
        if (!selectedCandidates.length) return 0
        return selectedCandidates.reduce((sum: number, c: any) => {
            const parentW = Number(c.width_mm) || 0
            const parentKg = Number(c.weight_kg) || 0
            const sp = c.slit_preview || null
            if (c.tier !== "WIDER_OK_WITH_SLIT" || !sp || !parentW) {
                return sum + parentKg
            }
            const widths: number[] = (sp.child_widths_mm || []).map((w: number) => Number(w))
            if (!widths.length) return sum + parentKg
            // For a committed gang each child goes to a different job, so only
            // the first child contributes to this job's coverage.
            if (sp.gang_group_id) {
                const w = Number(widths[0] || 0)
                return sum + (parentKg * w) / parentW
            }
            const used =
                slitMode === "MAX"
                    ? widths.reduce((s, w) => s + Number(w), 0)
                    : Number(widths[0] || 0)
            return sum + (parentKg * used) / parentW
        }, 0)
    }, [selectedCandidates, slitMode])

    const needed = remainingQtyKg ?? null
    const coverageRatio = needed && needed > 0 ? pickedWeightKg / needed : null
    const stillNeed = needed != null ? Math.max(0, needed - pickedWeightKg) : null
    const overBy = needed != null ? Math.max(0, pickedWeightKg - needed) : null

    const togglePick = (rollId: string) => {
        setPicks((prev) => {
            const next = { ...prev }
            if (next[rollId]) delete next[rollId]
            else next[rollId] = true
            return next
        })
    }

    // Barcode wedge: on Enter, try to match a candidate by label_id and select it.
    const handleScanKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key !== "Enter") return
        e.preventDefault()
        const value = scanInput.trim()
        if (!value) return
        const match = filteredCandidates.find((c: any) =>
            String(c.label_id || "").toLowerCase() === value.toLowerCase()
            || String(c.label_id || "").toLowerCase().endsWith(value.toLowerCase()),
        )
        if (match) {
            togglePick(match.roll_id)
            toast({ title: "Roll scanned", description: `${match.label_id} added to selection.` })
        } else {
            toast({ title: "No match", description: `No candidate with label "${value}".`, variant: "destructive" })
        }
        setScanInput("")
    }

    /**
     * Atomic batch mutation. Every selected candidate is shipped in one
     * request; the backend wraps validation + mutation under a single
     * transaction so a single failure rolls back the entire batch.
     *
     * Each pick chooses its own mode:
     *  - committed-gang slits → "GANG" (server resolves widths)
     *  - WIDER_OK_WITH_SLIT with the operator's current slitMode → "MAX" / "ONE"
     *  - everything else (full-roll EXACT / ORDER_BOUND / REMAINDER_POOL) → "ONE"
     */
    const slitMutation = useMutation({
        mutationFn: async () => {
            if (selectedCandidates.length === 0) throw new Error("Pick a roll first")
            const reasonText = (reason || "tiered allocate").trim() || "tiered allocate"
            const picksPayload = selectedCandidates.map((c: any) => {
                let mode: SlitMode = "ONE"
                if (c.tier === "WIDER_OK_WITH_SLIT") {
                    if (c.slit_preview?.gang_group_id) mode = "GANG"
                    else mode = slitMode === "MAX" ? "MAX" : slitMode === "GANG" ? "GANG" : "ONE"
                }
                return { roll_id: c.roll_id, mode, reason: reasonText }
            })
            return wcmService.allocateWithSlitBatch(jobId, picksPayload, idemKeyRef.current)
        },
        onSuccess: (result) => {
            const children = result.child_rolls?.length ?? 0
            const remainders = result.remainder_rolls?.length ?? 0
            const qty = Number(result.total_qty_allocated_kg || 0)
            const description = [
                `${result.picks_count} pick${result.picks_count === 1 ? "" : "s"} (${qty.toFixed(2)} kg)`,
                children ? `${children} child${children === 1 ? "" : "ren"} created` : null,
                remainders ? `${remainders} remainder${remainders === 1 ? "" : "s"} kept` : null,
                result.gang_group_id ? `gang ${result.gang_group_id}` : null,
            ].filter(Boolean).join(" · ")
            toast({
                title: result.picks_count > 1 ? `Allocated ${result.picks_count} rolls` : "Roll assigned",
                description,
            })
            qc.invalidateQueries({ queryKey: ["wcm-tiered-rolls", jobId] })
            qc.invalidateQueries({ queryKey: ["wcm"] })
            onAssigned?.()
            onOpenChange(false)
        },
        onError: (err: any) => {
            const detail = err?.response?.data?.details
            let detailText = ""
            if (detail) {
                if (Array.isArray(detail)) detailText = detail.join("; ")
                else if (detail.picks) detailText = (detail.picks as string[]).join("; ")
                else detailText = JSON.stringify(detail)
            }
            const baseMsg = err?.response?.data?.error || err?.message || String(err)
            toast({
                title: "Allocation failed — nothing committed",
                description: detailText ? `${baseMsg} · ${detailText}` : baseMsg,
                variant: "destructive",
            })
        },
    })

    const pickedKgLabel = pickedWeightKg > 0 ? ` (${pickedWeightKg.toFixed(1)} kg)` : ""
    const confirmLabel = selectedIds.length > 1
        ? `Allocate ${selectedIds.length} rolls${pickedKgLabel}`
        : isWiderOk
            ? `Confirm slit + assign${pickedKgLabel}`
            : `Assign to job${pickedKgLabel}`

    const confirmDisabledReason: string | null = (() => {
        if (selectedCandidates.length === 0) return "Select at least one roll to allocate."
        if (slitMutation.isPending) return "Allocation in flight — please wait…"
        // WIDER_OK_WITH_SLIT requires a chosen mode (which we set on selection,
        // but guard against an empty state if the operator clears it).
        const widerWithoutMode = selectedCandidates.some(
            (c: any) => c.tier === "WIDER_OK_WITH_SLIT" && !slitMode,
        )
        if (widerWithoutMode) return "Pick a slit mode for the wider roll."
        return null
    })()

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-3xl">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-base">
                        <Scissors className="h-4 w-4 text-indigo-600" />
                        Pick a roll
                        {staleFlash !== null ? (
                            <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                                <Sparkles className="h-3 w-3" /> Stock updated · {staleFlash} candidates now
                            </span>
                        ) : null}
                    </DialogTitle>
                    <DialogDescription>
                        Planned parent <b>{targetWidth ? `${targetWidth.toFixed(0)} mm` : "—"}</b> · {policy?.code || "default"} policy · remainders &lt; {minRemainder.toFixed(0)} mm go to scrap.
                    </DialogDescription>
                </DialogHeader>

                {/* Scanner + filter chips */}
                <div className="-mt-1 mb-2 flex flex-wrap items-center gap-2">
                    <div className="relative flex-1 min-w-[200px]">
                        <Barcode className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                        <Input
                            ref={barcodeRef}
                            value={scanInput}
                            onChange={(e) => setScanInput(e.target.value)}
                            onKeyDown={handleScanKey}
                            placeholder="Scan or type label ID + Enter…"
                            className="h-8 rounded-lg pl-8 text-xs"
                            data-testid="roll-picker-scan-input"
                        />
                    </div>
                    <FilterChip
                        active={showAged30}
                        onClick={() => setShowAged30((v) => !v)}
                        label="Aged 30d+"
                    />
                    <FilterChip
                        active={thisPlantOnly}
                        onClick={() => setThisPlantOnly((v) => !v)}
                        label="This plant only"
                    />
                    <FilterChip
                        active={hideRemainders}
                        onClick={() => setHideRemainders((v) => !v)}
                        label="Hide remainders"
                    />
                </div>

                <div className="-mt-1 mb-2 grid grid-cols-2 gap-1.5 text-[10px] sm:grid-cols-5">
                    <div className="rounded-lg bg-emerald-50 px-2 py-1 ring-1 ring-emerald-200">
                        <div className="font-black uppercase tracking-widest text-emerald-700">child target</div>
                        <div className="font-mono font-bold text-emerald-900">{childTargetWidth ? `${childTargetWidth.toFixed(0)} mm` : "—"}</div>
                    </div>
                    <div className="rounded-lg bg-indigo-50 px-2 py-1 ring-1 ring-indigo-200">
                        <div className="font-black uppercase tracking-widest text-indigo-700">lane (job)</div>
                        <div className="font-mono font-bold text-indigo-900">{preferredLaneCount}-up</div>
                    </div>
                    <div className="rounded-lg bg-violet-50 px-2 py-1 ring-1 ring-violet-200">
                        <div className="font-black uppercase tracking-widest text-violet-700">planned parent</div>
                        <div className="font-mono font-bold text-violet-900">{targetWidth ? `${targetWidth.toFixed(0)} mm` : "—"}</div>
                    </div>
                    <div className="rounded-lg bg-amber-50 px-2 py-1 ring-1 ring-amber-200">
                        <div className="font-black uppercase tracking-widest text-amber-700">policy</div>
                        <div className="font-mono font-bold text-amber-900">{policy?.code || "default"}</div>
                    </div>
                    <div className="rounded-lg bg-sky-50 px-2 py-1 ring-1 ring-sky-200">
                        <div className="font-black uppercase tracking-widest text-sky-700">stock form</div>
                        <div className="truncate font-mono font-bold text-sky-900">
                            {stockFormLabel(targetContract.stock_form)}
                        </div>
                        <div className="truncate text-[9px] font-bold text-sky-700">
                            {slitPolicyLabel(targetContract.slit_policy)}
                        </div>
                    </div>
                </div>

                {needed != null && needed > 0 ? (
                    <CoverageCard
                        neededKg={needed}
                        pickedKg={pickedWeightKg}
                        coverageRatio={coverageRatio ?? 0}
                        stillNeedKg={stillNeed ?? 0}
                        overByKg={overBy ?? 0}
                    />
                ) : null}

                {tieredQuery.isLoading ? (
                    <div className="flex items-center justify-center p-10 text-slate-500">
                        <Loader2 className="h-5 w-5 animate-spin" /> Loading candidates…
                    </div>
                ) : filteredCandidates.length === 0 ? (
                    <ZeroCandidatesState totalRaw={candidates.length} />
                ) : (
                    <TooltipProvider>
                        <div className="grid gap-2 max-h-[55vh] overflow-y-auto pr-2">
                            {filteredCandidates.map((c: any) => {
                                const pres = TIER_PRESENTATION[c.tier as Tier]
                                const Icon = pres?.icon || CheckCircle2
                                const widths = c.slit_preview?.child_widths_mm || []
                                const sameWidth = widths.length > 0 && widths.every((w: number) => Math.round(w) === Math.round(widths[0] || 0))
                                const childWidthLabel = sameWidth
                                    ? `${widths.length}× ${Math.round(widths[0] || 0)} mm`
                                    : widths.map((w: number) => `${Math.round(w)} mm`).join(" + ")
                                const age = ageLabel(c.created_at)
                                const selected = Boolean(picks[c.roll_id])
                                const tip = tierTooltip(c, Number(targetWidth) || 0)
                                return (
                                    <button
                                        key={c.roll_id}
                                        type="button"
                                        disabled={slitMutation.isPending}
                                        onClick={() => {
                                            togglePick(c.roll_id)
                                            if (c.slit_preview?.gang_group_id) setSlitMode("GANG")
                                            else setSlitMode("ONE")
                                        }}
                                        className={cn(
                                            "rounded-2xl border p-3 text-left transition",
                                            selected
                                                ? "ring-2 ring-indigo-400 border-indigo-300 bg-white shadow-sm"
                                                : "border-slate-200 bg-white hover:bg-slate-50",
                                        )}
                                    >
                                        <div className="flex flex-wrap items-center gap-2">
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <Badge variant="outline" className={cn("cursor-help text-[10px] font-semibold border", pres?.tone)}>
                                                        <Icon className="mr-1 h-3 w-3" /> {pres?.label}
                                                    </Badge>
                                                </TooltipTrigger>
                                                <TooltipContent className="max-w-xs text-xs">{tip}</TooltipContent>
                                            </Tooltip>
                                            <span className="font-mono text-sm font-semibold text-slate-900">{c.label_id}</span>
                                            <span className="text-xs text-slate-500">{c.material_name || c.material_code}</span>
                                            <span className={cn("rounded-md px-1.5 py-0.5 text-[10px] font-bold", age.tone)}>{age.text}</span>
                                            {c.location_code ? (
                                                <span className="rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">
                                                    {c.plant_code ? `${c.plant_code} · ` : ""}{c.location_code}
                                                </span>
                                            ) : null}
                                            {c.parent_roll?.label_id ? (
                                                <span className="rounded-md border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[10px] text-violet-700">
                                                    ← jumbo {c.parent_roll.label_id}
                                                </span>
                                            ) : null}
                                            <span className={cn(
                                                "rounded-md border px-1.5 py-0.5 text-[10px] font-black uppercase tracking-[0.12em]",
                                                String(c.stock_form || "OPEN_WEB").toUpperCase() === "OPEN_WEB"
                                                    ? "border-sky-200 bg-sky-50 text-sky-700"
                                                    : "border-amber-200 bg-amber-50 text-amber-800"
                                            )}>
                                                {stockFormLabel(c.stock_form)}
                                            </span>
                                            {selected ? (
                                                <CheckCircle2 className="ml-auto h-4 w-4 text-indigo-600" />
                                            ) : null}
                                        </div>
                                        <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-600 sm:grid-cols-4">
                                            <div><span className="text-slate-400">Width</span><br /><b>{c.width_mm.toFixed(0)} mm</b><div className="text-[10px] text-slate-400">{widthBasisLabel(c.width_basis)}</div></div>
                                            <div><span className="text-slate-400">Thickness</span><br /><b>{c.thickness_micron.toFixed(0)} µ</b></div>
                                            <div><span className="text-slate-400">Weight</span><br /><b>{c.weight_kg.toFixed(2)} kg</b></div>
                                            <div><span className="text-slate-400">Form</span><br /><b>{stockFormLabel(c.stock_form)}</b></div>
                                        </div>
                                        {c.tier === "WIDER_OK_WITH_SLIT" && c.slit_preview && (
                                            <>
                                                <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-900">
                                                    <Scissors className="mr-1 inline h-3 w-3" />
                                                    Will slit → {childWidthLabel || "child rolls"},
                                                    remainder <b>{Math.round(c.slit_preview.remainder_mm)} mm</b> ·
                                                    trim <b>{c.slit_preview.trim_mm} mm</b>
                                                    {c.slit_preview.remainder_disposition ? (
                                                        <span> · <b>{c.slit_preview.remainder_disposition === "KEEP" ? "keep remainder" : c.slit_preview.remainder_disposition === "SCRAP" ? "scrap remainder" : "no remainder"}</b></span>
                                                    ) : null}
                                                    {c.slit_preview.gang_job_count ? (
                                                        <span> · gang <b>{c.slit_preview.gang_job_count}</b> jobs</span>
                                                    ) : null}
                                                </div>
                                                <SlitLayoutMini
                                                    parentWidthMm={Number(c.width_mm) || 0}
                                                    childWidthsMm={(c.slit_preview.child_widths_mm || []).map((w: number) => Number(w))}
                                                    remainderMm={Number(c.slit_preview.remainder_mm || 0)}
                                                    trimMm={Number(c.slit_preview.trim_mm || 0)}
                                                />
                                            </>
                                        )}
                                        <div className="mt-1 text-[10px] text-slate-400">{pres?.subtitle}</div>
                                    </button>
                                )
                            })}
                        </div>
                    </TooltipProvider>
                )}

                {primarySelected && (
                    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
                        {/* Reservations preview */}
                        <ReservationsPreview
                            selected={selectedCandidates}
                            slitMode={slitMode}
                            targetWidth={Number(targetWidth) || 0}
                            primary={primarySelected}
                        />
                        {primarySelected.tier === "WIDER_OK_WITH_SLIT" ? (
                            <div>
                                <Label className="text-xs">Slit mode</Label>
                                <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-3">
                                    <SlitModeButton
                                        active={slitMode === "ONE"}
                                        disabled={Boolean(primarySelected.slit_preview?.gang_group_id)}
                                        label="Slit one child"
                                        detail={`${Math.round(Number(targetWidth) || primarySelected.slit_preview?.child_widths_mm?.[0] || 0)} mm to this job`}
                                        onClick={() => setSlitMode("ONE")}
                                    />
                                    <SlitModeButton
                                        active={slitMode === "MAX"}
                                        disabled={Boolean(primarySelected.slit_preview?.gang_group_id)}
                                        label="Slit max children"
                                        detail={`${primarySelected.slit_preview?.child_widths_mm?.length || 0} children from this roll`}
                                        onClick={() => setSlitMode("MAX")}
                                    />
                                    <SlitModeButton
                                        active={slitMode === "GANG" || Boolean(primarySelected.slit_preview?.gang_group_id)}
                                        disabled={!primarySelected.slit_preview?.gang_group_id}
                                        label="Slit for gang"
                                        detail={primarySelected.slit_preview?.gang_group_id ? `${primarySelected.slit_preview.gang_job_count || 0} committed jobs` : "Commit gang first"}
                                        onClick={() => setSlitMode("GANG")}
                                    />
                                </div>
                            </div>
                        ) : null}
                        <div className="space-y-2">
                            <Label className="text-xs">Override / slit reason (optional)</Label>
                            <Textarea
                                rows={2}
                                placeholder="e.g. order priority bump, wider stock will slit"
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                            />
                        </div>
                        {selectedIds.length > 1 ? (
                            <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-[11px] text-indigo-900">
                                <Info className="mr-1 inline h-3 w-3" />
                                Multi-select active · {selectedIds.length} rolls totaling <b>{totalSelectedWeight.toFixed(2)} kg</b>.
                            </div>
                        ) : null}
                    </div>
                )}

                <DialogFooter>
                    <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={slitMutation.isPending}>
                        Cancel
                    </Button>
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                {/* span wrapper so disabled buttons still surface the tooltip */}
                                <span>
                                    <Button
                                        onClick={() => slitMutation.mutate()}
                                        disabled={Boolean(confirmDisabledReason)}
                                        className="bg-indigo-600 text-white hover:bg-indigo-700"
                                        data-testid="roll-picker-confirm"
                                    >
                                        {slitMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                        {confirmLabel}
                                    </Button>
                                </span>
                            </TooltipTrigger>
                            {confirmDisabledReason ? (
                                <TooltipContent className="max-w-xs text-xs">{confirmDisabledReason}</TooltipContent>
                            ) : null}
                        </Tooltip>
                    </TooltipProvider>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

function FilterChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[10px] font-semibold transition",
                active
                    ? "border-indigo-300 bg-indigo-50 text-indigo-900"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
            )}
        >
            <Filter className="h-3 w-3" />
            {label}
        </button>
    )
}

function SlitModeButton({ active, disabled, label, detail, onClick }: { active: boolean; disabled?: boolean; label: string; detail: string; onClick: () => void }) {
    return (
        <button
            type="button"
            disabled={disabled}
            onClick={onClick}
            className={cn(
                "rounded-lg border px-2.5 py-2 text-left transition",
                active ? "border-indigo-300 bg-indigo-50 text-indigo-900 ring-1 ring-indigo-200" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300",
                disabled && "cursor-not-allowed opacity-50 hover:border-slate-200",
            )}
        >
            <div className="text-[11px] font-black">{label}</div>
            <div className="mt-0.5 text-[10px] text-slate-500">{detail}</div>
        </button>
    )
}

function SlitLayoutMini({
    parentWidthMm,
    childWidthsMm,
    remainderMm,
    trimMm,
}: {
    parentWidthMm: number
    childWidthsMm: number[]
    remainderMm: number
    trimMm: number
}) {
    if (!parentWidthMm || childWidthsMm.length === 0) return null
    const totalChildren = childWidthsMm.reduce((s, w) => s + w, 0)
    return (
        <div className="mt-2">
            <div className="mb-1 flex items-center justify-between text-[10px] text-slate-500">
                <span>Parent {Math.round(parentWidthMm)} mm</span>
                <span>· children {Math.round(totalChildren)} mm · remainder {Math.round(remainderMm)} mm · trim {Math.round(trimMm)} mm</span>
            </div>
            <div className="flex h-6 w-full overflow-hidden rounded-md ring-1 ring-slate-200">
                {childWidthsMm.map((w, idx) => {
                    const tones = [
                        "bg-indigo-200 text-indigo-900",
                        "bg-fuchsia-200 text-fuchsia-900",
                        "bg-emerald-200 text-emerald-900",
                        "bg-sky-200 text-sky-900",
                        "bg-rose-200 text-rose-900",
                        "bg-amber-200 text-amber-900",
                    ]
                    return (
                        <div
                            key={idx}
                            style={{ flexBasis: `${(w / parentWidthMm) * 100}%` }}
                            className={cn("flex items-center justify-center text-[9px] font-bold", tones[idx % tones.length])}
                            title={`Child ${idx + 1} · ${Math.round(w)} mm`}
                        >
                            {Math.round(w)}
                        </div>
                    )
                })}
                {remainderMm > 0 ? (
                    <div
                        style={{ flexBasis: `${(remainderMm / parentWidthMm) * 100}%` }}
                        className="flex items-center justify-center bg-amber-100 text-[9px] font-bold text-amber-800"
                        title={`Remainder · ${Math.round(remainderMm)} mm`}
                    >
                        rem
                    </div>
                ) : null}
                {trimMm > 0 ? (
                    <div
                        style={{ flexBasis: `${(trimMm / parentWidthMm) * 100}%` }}
                        className="flex items-center justify-center bg-slate-200 text-[9px] font-bold text-slate-700"
                        title={`Trim · ${Math.round(trimMm)} mm`}
                    >
                        trim
                    </div>
                ) : null}
            </div>
        </div>
    )
}

function ReservationsPreview({
    selected,
    slitMode,
    targetWidth,
    primary,
}: {
    selected: any[]
    slitMode: SlitMode
    targetWidth: number
    primary: any
}) {
    const count = selected.length
    const totalKg = selected.reduce((sum, c) => sum + Number(c.weight_kg || 0), 0)
    const isSlit = primary.tier === "WIDER_OK_WITH_SLIT"
    const sp = primary.slit_preview || {}
    const childTargetWidth = isSlit
        ? slitMode === "MAX"
            ? `${(sp.child_widths_mm || []).length}× ${Math.round(sp.child_widths_mm?.[0] || 0)} mm`
            : `${Math.round(targetWidth || sp.child_widths_mm?.[0] || 0)} mm`
        : null
    return (
        <div className="rounded-lg border border-indigo-200 bg-white p-2.5 text-[11px]">
            <div className="font-bold text-indigo-900">Reservation preview</div>
            <ul className="mt-1 list-disc pl-5 text-slate-700">
                <li>
                    Will lock: <b>{count} roll{count === 1 ? "" : "s"}</b> ({primary.label_id}
                    {count > 1 ? ` + ${count - 1}` : ""}, {totalKg.toFixed(2)} kg) for this job.
                </li>
                {isSlit ? (
                    <>
                        <li>Will spawn: child roll <b>{childTargetWidth}</b> from parent {Math.round(primary.width_mm)} mm.</li>
                        <li>Will scrap: {Math.round(sp.trim_mm || 0)} mm trim {sp.remainder_disposition === "SCRAP" ? `+ ${Math.round(sp.remainder_mm || 0)} mm remainder` : ""}.</li>
                    </>
                ) : null}
            </ul>
        </div>
    )
}

/**
 * Coverage card. Shows what the operator still needs to allocate vs what is
 * currently picked. Bar tone shifts emerald (>=100%), amber (50-99%), slate
 * (<50%) so a glance tells the story.
 */
function CoverageCard({
    neededKg,
    pickedKg,
    coverageRatio,
    stillNeedKg,
    overByKg,
}: {
    neededKg: number
    pickedKg: number
    coverageRatio: number
    stillNeedKg: number
    overByKg: number
}) {
    const pct = Math.max(0, Math.min(coverageRatio, 1)) * 100
    const isMet = coverageRatio >= 1
    const isHalf = coverageRatio >= 0.5
    const barTone = isMet
        ? "bg-emerald-500"
        : isHalf
            ? "bg-amber-500"
            : "bg-slate-400"
    const ringTone = isMet
        ? "ring-emerald-200 bg-emerald-50"
        : isHalf
            ? "ring-amber-200 bg-amber-50"
            : "ring-slate-200 bg-slate-50"
    const pctLabel = `${Math.round(coverageRatio * 100)}%`
    return (
        <div className={cn("mb-2 rounded-xl px-3 py-2 ring-1", ringTone)}>
            <div className="flex items-center justify-between text-[11px] font-black uppercase tracking-widest text-slate-700">
                <span>Coverage</span>
                <span className="font-mono">{pctLabel}</span>
            </div>
            <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-white ring-1 ring-slate-200">
                <div
                    className={cn("h-full transition-all", barTone)}
                    style={{ width: `${pct}%` }}
                />
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                <div>
                    <div className="text-slate-500">Needed</div>
                    <div className="font-mono font-bold text-slate-900">{neededKg.toFixed(1)} kg</div>
                </div>
                <div>
                    <div className="text-slate-500">Picked</div>
                    <div className="font-mono font-bold text-slate-900">{pickedKg.toFixed(1)} kg</div>
                </div>
                <div>
                    {isMet ? (
                        <>
                            <div className="text-emerald-700">Covered</div>
                            <div className="font-mono font-bold text-emerald-800">
                                {overByKg > 0 ? `+ ${overByKg.toFixed(1)} kg over` : "exact"}
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="text-slate-500">Still need</div>
                            <div className="font-mono font-bold text-amber-800">{stillNeedKg.toFixed(1)} kg</div>
                        </>
                    )}
                </div>
            </div>
            {overByKg > 0 && isMet ? (
                <div className="mt-1.5 inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-900">
                    + {overByKg.toFixed(1)} kg over
                </div>
            ) : null}
        </div>
    )
}

function ZeroCandidatesState({ totalRaw }: { totalRaw: number }) {
    return (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-amber-200 bg-amber-50/60 p-8 text-center">
            <AlertTriangle className="h-7 w-7 text-amber-600" />
            <div>
                <div className="text-sm font-bold text-amber-900">No eligible rolls</div>
                <p className="mt-1 max-w-md text-[11px] text-amber-800">
                    {totalRaw > 0
                        ? "All current stock filtered out by the active filters. Loosen filters or check substitutes."
                        : "All current stock filtered out by material / width / QC criteria. Check substitutes or request procurement."}
                </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
                <Link
                    href="/procurement/purchase-orders/new"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-indigo-700"
                >
                    <PackagePlus className="h-3.5 w-3.5" />
                    Request fresh jumbo
                </Link>
                <Link
                    href="/inventory/rolls?status=QUARANTINED"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-[11px] font-bold text-amber-800 hover:bg-amber-100"
                >
                    <Search className="h-3.5 w-3.5" />
                    View quarantined rolls
                </Link>
            </div>
        </div>
    )
}

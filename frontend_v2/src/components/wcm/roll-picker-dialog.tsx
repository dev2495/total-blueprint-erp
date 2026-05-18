"use client"

import * as React from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, Scissors, Loader2, AlertTriangle, Sparkles, Boxes } from "lucide-react"
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
import { useToast } from "@/hooks/use-toast"
import { wcmService } from "@/services/wcm"
import { cn } from "@/lib/utils"

type Tier = "ORDER_BOUND" | "EXACT" | "WIDER_OK_WITH_SLIT" | "REMAINDER_POOL"

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

export function WcmRollPickerDialog({ jobId, open, onOpenChange, onAssigned }: RollPickerProps) {
    const { toast } = useToast()
    const qc = useQueryClient()
    const [selectedRollId, setSelectedRollId] = React.useState<string>("")
    const [reason, setReason] = React.useState("")
    const [editedChildWidth, setEditedChildWidth] = React.useState<number | null>(null)

    const tieredQuery = useQuery({
        queryKey: ["wcm-tiered-rolls", jobId],
        queryFn: () => wcmService.getTieredRolls(jobId),
        enabled: open && !!jobId,
    })

    const candidates = tieredQuery.data?.candidates || []
    const targetWidth = tieredQuery.data?.target_width_mm || 0
    const selected = candidates.find((c) => c.roll_id === selectedRollId)

    const slitMutation = useMutation({
        mutationFn: async () => {
            if (!selected) throw new Error("Pick a roll first")
            const widths =
                selected.tier === "WIDER_OK_WITH_SLIT"
                    ? (selected.slit_preview?.child_widths_mm || [])
                    : [Number(selected.width_mm)]
            return wcmService.allocateWithSlit(jobId, selected.roll_id, widths, reason || "tiered allocate")
        },
        onSuccess: (res) => {
            toast({
                title: "Roll assigned",
                description:
                    res.gang_group_id
                        ? `Gang ${res.gang_group_id} · ${res.assigned_jobs?.length || res.child_ids.length} child rolls assigned`
                        : res.remainder_id
                        ? `Slit assigned · remainder ${res.remainder_id.slice(0, 8)} back to pool`
                        : res.waste_mm > 0
                            ? `Assigned · ${res.waste_mm.toFixed(0)} mm logged as edge waste`
                            : "Roll assigned to job",
            })
            qc.invalidateQueries({ queryKey: ["wcm-tiered-rolls", jobId] })
            qc.invalidateQueries({ queryKey: ["wcm"] })
            onAssigned?.()
            onOpenChange(false)
        },
        onError: (err: any) => {
            toast({ title: "Allocation failed", description: String(err?.response?.data?.error || err?.message || err), variant: "destructive" })
        },
    })

    const isWiderOk = selected?.tier === "WIDER_OK_WITH_SLIT"

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-3xl">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2 text-base">
                        <Scissors className="h-4 w-4 text-indigo-600" />
                        Pick a roll
                    </DialogTitle>
                    <DialogDescription>
                        Target width <b>{targetWidth ? `${targetWidth.toFixed(0)} mm` : "—"}</b> · ranked by tier.
                    </DialogDescription>
                </DialogHeader>

                {tieredQuery.isLoading ? (
                    <div className="flex items-center justify-center p-10 text-slate-500">
                        <Loader2 className="h-5 w-5 animate-spin" /> Loading candidates…
                    </div>
                ) : candidates.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 p-10 text-center text-slate-500">
                        <AlertTriangle className="h-6 w-6 text-amber-500" />
                        <div className="text-sm">No eligible rolls for this job at the current step.</div>
                    </div>
                ) : (
                    <div className="grid gap-2 max-h-[55vh] overflow-y-auto pr-2">
                        {candidates.map((c) => {
                            const pres = TIER_PRESENTATION[c.tier as Tier]
                            const Icon = pres?.icon || CheckCircle2
                            const widths = c.slit_preview?.child_widths_mm || []
                            const sameWidth = widths.length > 0 && widths.every((w) => Math.round(w) === Math.round(widths[0] || 0))
                            const childWidthLabel = sameWidth
                                ? `${widths.length}× ${Math.round(widths[0] || 0)} mm`
                                : widths.map((w) => `${Math.round(w)} mm`).join(" + ")
                            return (
                                <button
                                    key={c.roll_id}
                                    type="button"
                                    onClick={() => setSelectedRollId(c.roll_id)}
                                    className={cn(
                                        "rounded-2xl border p-3 text-left transition",
                                        selectedRollId === c.roll_id
                                            ? "ring-2 ring-indigo-400 border-indigo-300 bg-white shadow-sm"
                                            : "border-slate-200 bg-white hover:bg-slate-50",
                                    )}
                                >
                                    <div className="flex flex-wrap items-center gap-2">
                                        <Badge variant="outline" className={cn("text-[10px] font-semibold border", pres?.tone)}>
                                            <Icon className="mr-1 h-3 w-3" /> {pres?.label}
                                        </Badge>
                                        <span className="font-mono text-sm font-semibold text-slate-900">{c.label_id}</span>
                                        <span className="text-xs text-slate-500">{c.material_name || c.material_code}</span>
                                    </div>
                                    <div className="mt-2 grid grid-cols-3 gap-2 text-xs text-slate-600">
                                        <div><span className="text-slate-400">Width</span><br /><b>{c.width_mm.toFixed(0)} mm</b></div>
                                        <div><span className="text-slate-400">Thickness</span><br /><b>{c.thickness_micron.toFixed(0)} µ</b></div>
                                        <div><span className="text-slate-400">Weight</span><br /><b>{c.weight_kg.toFixed(2)} kg</b></div>
                                    </div>
                                    {c.tier === "WIDER_OK_WITH_SLIT" && c.slit_preview && (
                                        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-[11px] text-amber-900">
                                            <Scissors className="mr-1 inline h-3 w-3" />
                                            Will slit → {childWidthLabel || "child rolls"},
                                            remainder <b>{Math.round(c.slit_preview.remainder_mm)} mm</b> ·
                                            trim <b>{c.slit_preview.trim_mm} mm</b>
                                            {c.slit_preview.gang_job_count ? (
                                                <span> · gang <b>{c.slit_preview.gang_job_count}</b> jobs</span>
                                            ) : null}
                                        </div>
                                    )}
                                    <div className="mt-1 text-[10px] text-slate-400">{pres?.subtitle}</div>
                                </button>
                            )
                        })}
                    </div>
                )}

                {selected && (
                    <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <Label className="text-xs">Override / slit reason (optional)</Label>
                        <Textarea
                            rows={2}
                            placeholder="e.g. order priority bump, wider stock will slit"
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                        />
                    </div>
                )}

                <DialogFooter>
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button
                        onClick={() => slitMutation.mutate()}
                        disabled={!selected || slitMutation.isPending}
                        className="bg-indigo-600 text-white hover:bg-indigo-700"
                    >
                        {slitMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        {isWiderOk ? "Confirm slit + assign" : "Assign to job"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

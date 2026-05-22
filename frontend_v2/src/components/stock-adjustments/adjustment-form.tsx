"use client"

import * as React from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, Save, Trash2, Loader2, ArrowLeft, SlidersHorizontal } from "lucide-react"
import Link from "next/link"

import { GradientHero } from "@/components/erp-v3/gradient-hero"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/hooks/use-toast"
import {
    stockAdjustmentService,
    STOCK_ADJUSTMENT_REASONS,
    STOCK_CLASS_OPTIONS,
    type StockClass,
    type StockAdjustmentReason,
    type StockAdjustmentLine,
} from "@/services/stock-adjustment"
import { factoryService, type Plant, type Location } from "@/services/factory"
import { masterDataService } from "@/services/master-data"
import { StockItemPicker } from "./stock-item-picker"
import { RollPicker } from "./roll-picker"

type DraftLine = {
    key: string
    stock_class: StockClass
    inventory_material: string | ""
    trading_good: string | ""
    location: string | ""
    inventory_roll: string | ""
    delta_qty: string
    uom: string
    notes: string
    before_qty: number | null
}

function newDraftLine(partial?: Partial<DraftLine>): DraftLine {
    return {
        key: crypto.randomUUID(),
        stock_class: "BULK",
        inventory_material: "",
        trading_good: "",
        location: "",
        inventory_roll: "",
        delta_qty: "",
        uom: "KG",
        notes: "",
        before_qty: null,
        ...partial,
    }
}

export function StockAdjustmentForm() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const { toast } = useToast()
    const qc = useQueryClient()

    const presetTradingGood = searchParams?.get("trading_good") || ""

    const [plantId, setPlantId] = React.useState<string>("")
    const [reason, setReason] = React.useState<StockAdjustmentReason>("COUNT_CORRECTION")
    const [notes, setNotes] = React.useState<string>("")
    const [lines, setLines] = React.useState<DraftLine[]>(() => [
        presetTradingGood
            ? newDraftLine({
                  stock_class: "TRADING_GOOD",
                  trading_good: presetTradingGood,
                  uom: "PCS",
              })
            : newDraftLine(),
    ])

    const { data: plants = [] } = useQuery({
        queryKey: ["factory-plants"],
        queryFn: () => factoryService.getPlants(),
        staleTime: 60_000,
    })

    const { data: locations = [] } = useQuery({
        queryKey: ["inventory-locations"],
        queryFn: () => masterDataService.getLocations(),
        staleTime: 60_000,
    })

    const updateLine = (key: string, patch: Partial<DraftLine>) => {
        setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)))
    }
    const removeLine = (key: string) =>
        setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.key !== key) : prev))
    const addLine = () => setLines((prev) => [...prev, newDraftLine()])

    const buildPayload = () => ({
        plant: plantId,
        reason,
        notes,
        lines: lines
            .filter((l) => l.delta_qty !== "")
            .map((l, idx) => ({
                line_no: idx + 1,
                stock_class: l.stock_class,
                inventory_material:
                    l.stock_class === "BULK" || l.stock_class === "PACKAGING" || l.stock_class === "ROLL"
                        ? l.inventory_material || null
                        : null,
                trading_good: l.stock_class === "TRADING_GOOD" ? l.trading_good || null : null,
                location:
                    l.stock_class === "BULK" || l.stock_class === "PACKAGING"
                        ? l.location || null
                        : null,
                inventory_roll: l.stock_class === "ROLL" ? l.inventory_roll || null : null,
                delta_qty: Number(l.delta_qty || 0),
                uom: l.uom || "KG",
                notes: l.notes || "",
            })) as Array<Omit<StockAdjustmentLine, "id" | "before_qty" | "after_qty" | "value_inr">>,
    })

    const saveDraft = useMutation({
        mutationFn: async () => stockAdjustmentService.create(buildPayload()),
        onSuccess: (saved) => {
            toast({ title: "Draft saved", description: saved.code })
            qc.invalidateQueries({ queryKey: ["stock-adjustments"] })
            router.push(`/inventory/adjustments/${saved.id}`)
        },
        onError: (err: any) => {
            const msg =
                err?.response?.data?.detail ||
                JSON.stringify(err?.response?.data || err?.message || "Save failed")
            toast({ title: "Save failed", description: msg, variant: "destructive" })
        },
    })

    const saveAndPost = useMutation({
        mutationFn: async () => {
            const created = await stockAdjustmentService.create(buildPayload())
            return stockAdjustmentService.post(created.id)
        },
        onSuccess: (saved) => {
            toast({ title: "Adjustment posted", description: saved.code })
            qc.invalidateQueries({ queryKey: ["stock-adjustments"] })
            router.push(`/inventory/adjustments/${saved.id}`)
        },
        onError: (err: any) => {
            const msg =
                err?.response?.data?.detail ||
                JSON.stringify(err?.response?.data || err?.message || "Post failed")
            toast({ title: "Post failed", description: msg, variant: "destructive" })
        },
    })

    const plantLocations = React.useMemo(
        () => (locations as Location[]).filter((l) => l.plant === plantId),
        [locations, plantId],
    )

    const canSave = !!plantId && lines.some((l) => l.delta_qty !== "")

    return (
        <div className="min-h-screen bg-gradient-to-b from-violet-50/40 via-white to-slate-50/40 px-4 py-4 sm:px-6">
            <GradientHero
                palette="violet"
                eyebrow="INVENTORY · STOCK ADJUSTMENTS · NEW"
                title="New stock adjustment"
                subtitle="Add lines for the stock pools you want to adjust. Save as draft to review, or post immediately for a one-shot correction."
                actions={
                    <Link href="/inventory/adjustments">
                        <Button variant="secondary" className="bg-white/95 text-violet-700 hover:bg-white">
                            <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to list
                        </Button>
                    </Link>
                }
            />

            <div className="mt-6 grid gap-6 lg:grid-cols-3">
                <section className="rounded-3xl bg-white p-6 shadow-[0_20px_60px_-30px_rgba(15,23,42,0.25)] ring-1 ring-slate-200/60 lg:col-span-3">
                    <header className="mb-4">
                        <h3 className="font-display text-base font-bold text-slate-900">Header</h3>
                        <p className="text-[11px] text-slate-500">Plant, reason, and notes apply to all lines.</p>
                    </header>
                    <div className="grid gap-4 md:grid-cols-3">
                        <div>
                            <Label className="text-[11px] font-bold uppercase tracking-wider text-slate-600">Plant</Label>
                            <Select value={plantId} onValueChange={setPlantId}>
                                <SelectTrigger className="mt-1.5"><SelectValue placeholder="Pick a plant" /></SelectTrigger>
                                <SelectContent>
                                    {(plants as Plant[]).map((p) => (
                                        <SelectItem key={p.id} value={p.id}>{p.name} ({p.code})</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div>
                            <Label className="text-[11px] font-bold uppercase tracking-wider text-slate-600">Reason</Label>
                            <Select value={reason} onValueChange={(v) => setReason(v as StockAdjustmentReason)}>
                                <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {STOCK_ADJUSTMENT_REASONS.map((r) => (
                                        <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="md:col-span-1">
                            <Label className="text-[11px] font-bold uppercase tracking-wider text-slate-600">Notes</Label>
                            <Textarea
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                rows={2}
                                placeholder="Optional context for the audit log"
                                className="mt-1.5"
                            />
                        </div>
                    </div>
                </section>

                <section className="rounded-3xl bg-white p-6 shadow-[0_20px_60px_-30px_rgba(15,23,42,0.25)] ring-1 ring-slate-200/60 lg:col-span-3">
                    <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
                        <div>
                            <h3 className="font-display text-base font-bold text-slate-900">Lines</h3>
                            <p className="text-[11px] text-slate-500">Pick a stock class per line, choose the item and enter the delta.</p>
                        </div>
                        <Button type="button" variant="outline" onClick={addLine}>
                            <Plus className="mr-1.5 h-4 w-4" /> Add line
                        </Button>
                    </header>

                    <div className="space-y-3">
                        {lines.map((line, idx) => (
                            <LineRow
                                key={line.key}
                                idx={idx}
                                line={line}
                                onChange={(p) => updateLine(line.key, p)}
                                onRemove={() => removeLine(line.key)}
                                canRemove={lines.length > 1}
                                locations={plantLocations}
                                plantId={plantId}
                            />
                        ))}
                    </div>
                </section>

                <div className="flex items-center justify-end gap-3 lg:col-span-3">
                    <Link href="/inventory/adjustments">
                        <Button type="button" variant="outline">Cancel</Button>
                    </Link>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={!canSave || saveDraft.isPending || saveAndPost.isPending}
                        onClick={() => saveDraft.mutate()}
                    >
                        {saveDraft.isPending ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                            <Save className="mr-2 h-4 w-4" />
                        )}
                        Save Draft
                    </Button>
                    <Button
                        type="button"
                        disabled={!canSave || saveDraft.isPending || saveAndPost.isPending}
                        onClick={() => saveAndPost.mutate()}
                        className="bg-violet-600 text-white hover:bg-violet-700"
                    >
                        {saveAndPost.isPending ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                            <SlidersHorizontal className="mr-2 h-4 w-4" />
                        )}
                        Save & Post
                    </Button>
                </div>
            </div>
        </div>
    )
}

function LineRow({
    idx,
    line,
    onChange,
    onRemove,
    canRemove,
    locations,
    plantId,
}: {
    idx: number
    line: DraftLine
    onChange: (patch: Partial<DraftLine>) => void
    onRemove: () => void
    canRemove: boolean
    locations: Location[]
    plantId: string
}) {
    const needsLocation = line.stock_class === "BULK" || line.stock_class === "PACKAGING"
    const needsRoll = line.stock_class === "ROLL"

    const numericDelta = line.delta_qty === "" ? 0 : Number(line.delta_qty)
    const before = line.before_qty
    const after = before === null ? null : before + numericDelta
    const deltaColor = numericDelta > 0
        ? "text-emerald-700"
        : numericDelta < 0
            ? "text-red-600"
            : "text-slate-500"

    return (
        <div className="rounded-2xl border border-slate-200 bg-slate-50/40 p-4">
            <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] font-bold text-slate-500">Line #{idx + 1}</span>
                {canRemove ? (
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-red-600 hover:bg-red-50"
                        onClick={onRemove}
                    >
                        <Trash2 className="mr-1 h-3.5 w-3.5" /> Remove
                    </Button>
                ) : null}
            </div>
            <div className="mt-2 grid gap-3 md:grid-cols-4">
                <div>
                    <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Stock class</Label>
                    <Select
                        value={line.stock_class}
                        onValueChange={(v) =>
                            onChange({
                                stock_class: v as StockClass,
                                inventory_material: "",
                                trading_good: "",
                                location: "",
                                inventory_roll: "",
                                before_qty: null,
                                uom: v === "TRADING_GOOD" ? "PCS" : "KG",
                            })
                        }
                    >
                        <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            {STOCK_CLASS_OPTIONS.map((o) => (
                                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                <div className="md:col-span-3">
                    <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-600">
                        {line.stock_class === "TRADING_GOOD" ? "Trading good" : "Material"}
                    </Label>
                    <div className="mt-1">
                        <StockItemPicker
                            stockClass={line.stock_class}
                            value={
                                line.stock_class === "TRADING_GOOD"
                                    ? line.trading_good || null
                                    : line.inventory_material || null
                            }
                            onSelect={(item) => {
                                if (!item) return
                                if (line.stock_class === "TRADING_GOOD") {
                                    onChange({
                                        trading_good: item.id,
                                        uom: item.uom || "PCS",
                                        before_qty: null,
                                    })
                                } else {
                                    onChange({
                                        inventory_material: item.id,
                                        inventory_roll: "",
                                        uom: item.uom || "KG",
                                        before_qty: null,
                                    })
                                }
                            }}
                            plantId={plantId}
                        />
                    </div>
                </div>

                {needsRoll ? (
                    <div className="md:col-span-3 md:col-start-2">
                        <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Roll</Label>
                        <div className="mt-1">
                            <RollPicker
                                materialId={line.inventory_material || null}
                                plantId={plantId}
                                value={line.inventory_roll || null}
                                onSelect={(r) => {
                                    if (!r) return
                                    onChange({
                                        inventory_roll: r.id,
                                        before_qty: r.weight_kg,
                                        uom: "KG",
                                    })
                                }}
                            />
                        </div>
                    </div>
                ) : null}

                {needsLocation ? (
                    <div className="md:col-span-3 md:col-start-2">
                        <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Location</Label>
                        <Select value={line.location} onValueChange={(v) => onChange({ location: v })}>
                            <SelectTrigger className="mt-1"><SelectValue placeholder={plantId ? "Pick location" : "Pick a plant first"} /></SelectTrigger>
                            <SelectContent>
                                {locations.map((l) => (
                                    <SelectItem key={l.id} value={l.id}>{l.name} ({l.code})</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                ) : null}

                <div>
                    <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Delta qty</Label>
                    <Input
                        type="number"
                        step="0.001"
                        value={line.delta_qty}
                        onChange={(e) => onChange({ delta_qty: e.target.value })}
                        placeholder="+10 or -5"
                        className="mt-1 font-mono"
                    />
                </div>

                <div>
                    <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-600">UOM</Label>
                    <Input
                        value={line.uom}
                        onChange={(e) => onChange({ uom: e.target.value })}
                        className="mt-1 font-mono"
                    />
                </div>

                <div className="md:col-span-2">
                    <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Preview</Label>
                    <div className="mt-1 flex h-9 items-center rounded-md border border-slate-200 bg-white px-3 font-mono text-[11px] text-slate-700">
                        {before === null ? (
                            <span className="text-slate-400">Pick a roll or material to preview qty</span>
                        ) : (
                            <>
                                <span className="text-slate-500">Before</span>
                                <b className="mx-1">{before.toFixed(3)}</b>
                                <span className="mx-1">→</span>
                                <span className="text-slate-500">After</span>
                                <b className="mx-1">{(after ?? 0).toFixed(3)}</b>
                                <span className={`ml-2 font-bold ${deltaColor}`}>
                                    ({numericDelta > 0 ? "+" : ""}{numericDelta.toFixed(3)})
                                </span>
                            </>
                        )}
                    </div>
                </div>

                <div className="md:col-span-4">
                    <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-600">Line notes</Label>
                    <Input
                        value={line.notes}
                        onChange={(e) => onChange({ notes: e.target.value })}
                        placeholder="Optional"
                        className="mt-1"
                    />
                </div>
            </div>
        </div>
    )
}

"use client"

import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowRight, Boxes, CheckCircle2, ClipboardList, HelpCircle, PackageCheck, Scale, Search } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { logisticsService, type Gonny, type SOPackingSummary } from "@/services/logistics"
import { masterDataService, type PackagingMaterial } from "@/services/master-data"

const n = (value: unknown, digits = 1) => Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: digits })
const err = (error: any) => error?.response?.data?.error || error?.response?.data?.detail || error?.message || "Request failed."

function Stat({ label, value, hint, tone = "slate" }: { label: string; value: string; hint: string; tone?: "slate" | "emerald" | "amber" | "blue" }) {
    const tones = {
        slate: "border-slate-200 bg-white text-slate-950",
        emerald: "border-emerald-200 bg-emerald-50 text-emerald-950",
        amber: "border-amber-200 bg-amber-50 text-amber-950",
        blue: "border-blue-200 bg-blue-50 text-blue-950",
    }
    return (
        <div className={`rounded-3xl border p-4 shadow-sm ${tones[tone]}`}>
            <div className="text-[10px] font-black uppercase tracking-[0.28em] text-slate-500">{label}</div>
            <div className="mt-2 text-2xl font-black">{value}</div>
            <div className="mt-1 text-xs font-medium text-slate-500">{hint}</div>
        </div>
    )
}

function getGonnyExpected(gonny: Gonny) {
    return Number(gonny.expected_gross_weight_kg ?? gonny.tare_breakdown_json?.expected_gross_weight_kg ?? gonny.tare_breakdown_json?.gross_weight_kg ?? 0)
}

function railState(value: number) {
    return value > 0 ? "border-blue-300 bg-blue-50 text-blue-950" : "border-slate-200 bg-slate-50 text-slate-500"
}

export default function PackingYardPage() {
    const { toast } = useToast()
    const queryClient = useQueryClient()
    const [search, setSearch] = useState("")
    const [selectedOrderId, setSelectedOrderId] = useState<string>("")
    const [createBatchId, setCreateBatchId] = useState("")
    const [createQty, setCreateQty] = useState("")
    const [contentMode, setContentMode] = useState<"LOOSE_POUCHES" | "PRIMARY_PACKS">("LOOSE_POUCHES")
    const [primaryPackCount, setPrimaryPackCount] = useState("")
    const [gonnyMaterialId, setGonnyMaterialId] = useState("")
    const [sealGonny, setSealGonny] = useState<Gonny | null>(null)
    const [actualGross, setActualGross] = useState("")
    const [varianceReason, setVarianceReason] = useState("")

    const board = useQuery({ queryKey: ["packing-board"], queryFn: logisticsService.getPackingBoard, refetchInterval: 30000 })
    const summary = useQuery({
        queryKey: ["packing-summary", selectedOrderId],
        queryFn: () => logisticsService.getSOPackingSummary(selectedOrderId),
        enabled: Boolean(selectedOrderId),
    })
    const packaging = useQuery({ queryKey: ["packaging-materials"], queryFn: masterDataService.getPackaging })
    const gonnies = useMemo(() => (packaging.data || []).filter((p) => p.packaging_kind === "GONNY"), [packaging.data])

    const invalidate = () => {
        queryClient.invalidateQueries({ queryKey: ["packing-board"] })
        queryClient.invalidateQueries({ queryKey: ["packing-summary", selectedOrderId] })
    }

    const createMutation = useMutation({
        mutationFn: () => logisticsService.createGonny({
            fgBatchId: createBatchId,
            qtyPcs: Number(createQty),
            gonnyMaterialId,
            contentMode,
            primaryPackCount: primaryPackCount ? Number(primaryPackCount) : undefined,
        }),
        onSuccess: (data) => {
            toast({ title: "Gonny created", description: data.message })
            setCreateBatchId("")
            setCreateQty("")
            setPrimaryPackCount("")
            invalidate()
        },
        onError: (error) => toast({ title: "Create failed", description: err(error), variant: "destructive" }),
    })

    const sealMutation = useMutation({
        mutationFn: () => logisticsService.sealGonny(sealGonny!.id, Number(actualGross), [], varianceReason),
        onSuccess: (data) => {
            toast({ title: "Gonny sealed", description: data.message })
            setSealGonny(null)
            setActualGross("")
            setVarianceReason("")
            invalidate()
        },
        onError: (error) => toast({ title: "Seal failed", description: err(error), variant: "destructive" }),
    })

    const releaseGonnyMutation = useMutation({
        mutationFn: (gonnyId: string) => logisticsService.releaseGonny(gonnyId),
        onSuccess: (data) => {
            toast({ title: "Released to dispatch", description: data.message })
            invalidate()
        },
        onError: (error) => toast({ title: "Release failed", description: err(error), variant: "destructive" }),
    })

    const releaseRollMutation = useMutation({
        mutationFn: ({ rollId, mode }: { rollId: string; mode: "PACKED" | "UNPACKED" }) => logisticsService.releaseRoll(rollId, mode),
        onSuccess: (data) => {
            toast({ title: "Roll released", description: data.message })
            invalidate()
        },
        onError: (error) => toast({ title: "Roll release failed", description: err(error), variant: "destructive" }),
    })

    const cards = (board.data?.orders || []).filter((row) => {
        const term = search.trim().toLowerCase()
        if (!term) return true
        return `${row.sales_order.order_number} ${row.sales_order.customer_name}`.toLowerCase().includes(term)
    })
    const selected = summary.data as SOPackingSummary | undefined
    const selectedBatch = selected?.batches.find((batch) => batch.id === createBatchId)
    const expected = sealGonny ? getGonnyExpected(sealGonny) : 0
    const variance = actualGross ? Number(actualGross) - expected : 0
    const variancePct = expected > 0 ? (variance / expected) * 100 : 0

    return (
        <div className="space-y-6 p-4 lg:p-6">
            <section className="sticky top-2 z-20 rounded-[2rem] bg-gradient-to-br from-slate-950 via-blue-950 to-indigo-700 p-6 text-white shadow-xl">
                <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                        <div className="inline-flex rounded-full border border-white/20 px-3 py-1 text-[10px] font-black uppercase tracking-[0.28em] text-blue-100">Packing Yard</div>
                        <h1 className="mt-4 text-3xl font-black tracking-tight">Plan, seal, and release dispatch-ready units.</h1>
                        <p className="mt-2 max-w-2xl text-sm font-medium text-blue-100">Choose the sales order first, create gonnies from finished pouch batches, capture actual gonny gross weight, and release only sealed units to Dispatch Bay.</p>
                        <div className="mt-4 flex flex-wrap gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-blue-50">
                            <span className="rounded-full bg-white/10 px-3 py-1">Production</span>
                            <span className="rounded-full bg-white/10 px-3 py-1">Batches</span>
                            <span className="rounded-full bg-white/10 px-3 py-1">Gonnies</span>
                            <span className="rounded-full bg-white/10 px-3 py-1">Sealing</span>
                            <span className="rounded-full bg-white/10 px-3 py-1">Dispatch handoff</span>
                        </div>
                    </div>
                    <div className="relative w-full max-w-md">
                        <Search className="absolute left-4 top-3.5 h-4 w-4 text-slate-400" />
                        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search order or customer..." className="h-12 rounded-2xl border-white/20 bg-white/10 pl-10 text-white placeholder:text-blue-100" />
                    </div>
                </div>
            </section>

            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                <Stat label="Orders in yard" value={n(board.data?.totals.orders || 0, 0)} hint="Have packing work pending or ready" tone="blue" />
                <Stat label="Pending pouch batches" value={`${n(board.data?.totals.pending_pcs || 0, 0)} pcs`} hint={`${n(board.data?.totals.pending_batches || 0, 0)} batches waiting`} />
                <Stat label="Open / sealed gonnies" value={`${n(board.data?.totals.open_gonnies || 0, 0)} / ${n(board.data?.totals.sealed_waiting_release || 0, 0)}`} hint="Seal open, then release" tone="amber" />
                <Stat label="Ready for dispatch" value={`${n(board.data?.totals.ready_gonnies || 0, 0)} gonnies`} hint={`${n(board.data?.totals.ready_gonnies_gross_kg || 0)} kg gross + ${n(board.data?.totals.ready_rolls_kg || 0)} kg rolls`} tone="emerald" />
            </section>

            <section className="grid gap-5 xl:grid-cols-[360px_1fr]">
                <div className="rounded-[2rem] border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="mb-3 flex items-center gap-2 text-sm font-black"><ClipboardList className="h-4 w-4 text-blue-600" /> Sales orders</div>
                    <div className="max-h-[620px] space-y-3 overflow-y-auto pr-1">
                        {cards.map((row) => (
                            <button key={row.sales_order.id} onClick={() => setSelectedOrderId(row.sales_order.id)} className={`relative w-full overflow-hidden rounded-3xl border p-4 text-left transition ${selectedOrderId === row.sales_order.id ? "border-blue-400 bg-blue-50 shadow-md" : "border-slate-200 bg-white hover:border-blue-200"}`}>
                                <span className={`absolute inset-y-0 left-0 w-2 ${row.ready_for_dispatch.gonnies_count ? "bg-emerald-400" : row.pending.batches_pcs ? "bg-amber-400" : "bg-sky-400"}`} />
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <div className="text-sm font-black text-slate-950">{row.sales_order.order_number}</div>
                                        <div className="mt-1 text-xs font-semibold text-slate-500">{row.sales_order.customer_name}</div>
                                    </div>
                                    <ArrowRight className="h-4 w-4 text-slate-400" />
                                </div>
                                <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                                    <div className="rounded-2xl bg-slate-50 p-2"><b>{n(row.pending.batches_pcs || 0, 0)}</b><br />pcs pending</div>
                                    <div className="rounded-2xl bg-emerald-50 p-2"><b>{n(row.ready_for_dispatch.gonnies_count || 0, 0)}</b><br />ready gonnies</div>
                                </div>
                            </button>
                        ))}
                        {!cards.length && <div className="rounded-3xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">No packing orders match this search.</div>}
                    </div>
                </div>

                <div className="space-y-5">
                    {!selected ? (
                        <div className="rounded-[2rem] border border-dashed border-slate-300 bg-white p-12 text-center">
                            <Boxes className="mx-auto h-10 w-10 text-slate-300" />
                            <h2 className="mt-3 text-xl font-black">Select a sales order to start packing.</h2>
                            <p className="mt-2 text-sm text-slate-500">The yard board stays visible so operators can plan before picking batches or releasing units.</p>
                        </div>
                    ) : (
                        <>
                            <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
                                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                                    <div>
                                        <div className="text-[10px] font-black uppercase tracking-[0.28em] text-blue-600">Selected order</div>
                                        <h2 className="mt-1 text-2xl font-black text-slate-950">{selected.sales_order.order_number}</h2>
                                        <p className="text-sm font-semibold text-slate-500">{selected.sales_order.customer_name}</p>
                                    </div>
                                    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                                        <Stat label="Pending pcs" value={n(selected.packing_pending.batches_pcs, 0)} hint="pouch batches" />
                                        <Stat label="Open gonnies" value={n(selected.packing_pending.open_gonnies_count, 0)} hint="need actual weight" tone="amber" />
                                        <Stat label="Ready gonnies" value={n(selected.ready_for_dispatch.gonnies_count, 0)} hint={`${n(selected.ready_for_dispatch.gonnies_gross_kg)} kg gross`} tone="emerald" />
                                        <Stat label="Ready rolls" value={n(selected.ready_for_dispatch.rolls_kg)} hint="kg released" tone="blue" />
                                    </div>
                                </div>
                                <div className="mt-5 grid gap-3 md:grid-cols-5">
                                    {[
                                        ["Production", selected.packing_pending.batches_pcs + selected.ready_for_dispatch.rolls_kg],
                                        ["Batches in", selected.packing_pending.batches_count],
                                        ["Making gonnies", selected.packing_pending.open_gonnies_count],
                                        ["Sealing", selected.ready_for_dispatch.gonnies_count],
                                        ["Handed off", selected.ready_for_dispatch.gonnies_count + selected.ready_for_dispatch.rolls_kg],
                                    ].map(([label, value], index) => (
                                        <div key={label} className={`rounded-2xl border p-3 text-center text-xs font-black ${railState(Number(value || 0))}`}>
                                            <div className="mx-auto mb-2 flex h-7 w-7 items-center justify-center rounded-full bg-white shadow-sm">{index + 1}</div>
                                            {label}
                                            <div className="mt-1 text-[10px] font-semibold opacity-70">{n(value, 0)} active</div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div className="grid gap-5 2xl:grid-cols-[1fr_360px]">
                                <div className="space-y-5">
                                    <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
                                        <div className="mb-4 flex items-center gap-2 text-sm font-black"><PackageCheck className="h-4 w-4 text-emerald-600" /> Pouch batches waiting for gonnies</div>
                                        <div className="overflow-x-auto">
                                            <table className="w-full min-w-[760px] text-sm">
                                                <thead className="text-[10px] uppercase tracking-[0.22em] text-slate-400">
                                                    <tr><th className="py-3 text-left">Batch</th><th className="text-left">Product</th><th className="text-right">Available</th><th className="text-left">Default</th><th className="text-right">Action</th></tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-100">
                                                    {selected.batches.map((batch) => (
                                                        <tr key={batch.id}>
                                                            <td className="py-4 font-black">{batch.batch_number}</td>
                                                            <td>{batch.template_name || "Finished pouches"}</td>
                                                            <td className="text-right font-bold">{n(batch.qty_pcs, 0)} pcs</td>
                                                            <td className="text-xs text-slate-500">{batch.status}</td>
                                                            <td className="text-right"><Button size="sm" onClick={() => { setCreateBatchId(batch.id); setCreateQty(String(batch.qty_pcs || "")); }}>Pack to gonny</Button></td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                            {!selected.batches.length && <div className="rounded-3xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">No pouch batches are waiting for this order.</div>}
                                        </div>
                                    </div>

                                    <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
                                        <div className="mb-4 flex items-center gap-2 text-sm font-black"><Scale className="h-4 w-4 text-amber-600" /> Gonnies in yard</div>
                                        <div className="grid gap-3 xl:grid-cols-2">
                                            {selected.gonnies.map((gonny) => (
                                                <div key={gonny.id} className="rounded-3xl border border-slate-200 p-4">
                                                    <div className="flex items-start justify-between gap-3">
                                                        <div>
                                                            <div className="font-black">{gonny.label_id}</div>
                                                            <div className="mt-1 text-xs text-slate-500">{gonny.qty_pcs} pcs • {gonny.content_mode === "PRIMARY_PACKS" ? `${gonny.primary_pack_count || 0} inner packs` : "loose pouches"}</div>
                                                        </div>
                                                        <span className={`rounded-full px-3 py-1 text-[10px] font-black uppercase ${gonny.status === "SEALED" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{gonny.status}</span>
                                                    </div>
                                                    <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                                                        <div className="rounded-2xl bg-slate-50 p-2"><b>{n(gonny.net_product_weight_kg)}</b><br />net kg</div>
                                                        <div className="rounded-2xl bg-blue-50 p-2"><b>{n(getGonnyExpected(gonny))}</b><br />expected</div>
                                                        <div className="rounded-2xl bg-emerald-50 p-2"><b>{gonny.gross_weight_kg ? n(gonny.gross_weight_kg) : "-"}</b><br />actual</div>
                                                    </div>
                                                    <div className="mt-4 flex flex-wrap gap-2">
                                                        {gonny.status === "OPEN" && <Button size="sm" onClick={() => { setSealGonny(gonny); setActualGross(String(getGonnyExpected(gonny) || "")); }}>Seal gonny</Button>}
                                                        {gonny.status === "SEALED" && !gonny.released_to_dispatch && <Button size="sm" variant="outline" onClick={() => releaseGonnyMutation.mutate(gonny.id)}>Release to dispatch</Button>}
                                                        {gonny.released_to_dispatch && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700"><CheckCircle2 className="h-3 w-3" /> Ready in Dispatch Bay</span>}
                                                    </div>
                                                </div>
                                            ))}
                                            {!selected.gonnies.length && <div className="rounded-3xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">No gonnies created yet.</div>}
                                        </div>
                                    </div>
                                </div>

                                <aside className="sticky top-4 h-fit rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
                                    <div className="text-sm font-black">Create gonny</div>
                                    <div className="mt-4 space-y-3">
                                        <Label>Batch</Label>
                                        <Select value={createBatchId} onValueChange={setCreateBatchId}>
                                            <SelectTrigger><SelectValue placeholder="Select pouch batch" /></SelectTrigger>
                                            <SelectContent>{selected.batches.map((batch) => <SelectItem key={batch.id} value={batch.id}>{batch.batch_number} • {batch.qty_pcs} pcs</SelectItem>)}</SelectContent>
                                        </Select>
                                        <Label>Gonny material</Label>
                                        <Select value={gonnyMaterialId} onValueChange={setGonnyMaterialId}>
                                            <SelectTrigger><SelectValue placeholder="Select gonny stock" /></SelectTrigger>
                                            <SelectContent>{gonnies.map((item: PackagingMaterial) => <SelectItem key={item.id} value={item.id}>{item.code} • {item.name}</SelectItem>)}</SelectContent>
                                        </Select>
                                        <Label>Pouches to pack</Label>
                                        <Input type="number" min="1" value={createQty} onChange={(e) => setCreateQty(e.target.value)} placeholder={selectedBatch ? String(selectedBatch.qty_pcs) : "Qty pcs"} />
                                        <Label>Content mode</Label>
                                        <Select value={contentMode} onValueChange={(value) => setContentMode(value as any)}>
                                            <SelectTrigger><SelectValue /></SelectTrigger>
                                            <SelectContent><SelectItem value="LOOSE_POUCHES">Loose pouches</SelectItem><SelectItem value="PRIMARY_PACKS">Inner packs</SelectItem></SelectContent>
                                        </Select>
                                        {contentMode === "PRIMARY_PACKS" && (
                                            <>
                                                <Label>Inner pack count</Label>
                                                <Input type="number" min="1" value={primaryPackCount} onChange={(e) => setPrimaryPackCount(e.target.value)} placeholder="Auto if sales snapshot has pcs/pack" />
                                            </>
                                        )}
                                        <Button className="w-full" disabled={!createBatchId || !createQty || !gonnyMaterialId || createMutation.isPending} onClick={() => createMutation.mutate()}>
                                            {createMutation.isPending ? "Creating..." : "Create gonny"}
                                        </Button>
                                    </div>
                                </aside>
                            </div>

                            <details className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
                                <summary className="flex cursor-pointer items-center gap-2 text-sm font-black">
                                    <HelpCircle className="h-4 w-4 text-blue-600" /> Packing glossary for operators
                                </summary>
                                <div className="mt-4 grid gap-3 text-xs md:grid-cols-3">
                                    {[
                                        ["Batch", "Finished pouch output waiting to be packed."],
                                        ["Gonny", "One physical bag/carton made from loose pouches or inner packs."],
                                        ["Net", "Product weight only."],
                                        ["Tare", "Weight of gonny, inner pack, tape, or extras."],
                                        ["Expected gross", "System net plus known tare before sealing."],
                                        ["Actual gross", "Scale weight entered when sealing."],
                                    ].map(([term, copy]) => (
                                        <div key={term} className="rounded-2xl bg-slate-50 p-3"><b>{term}</b><br />{copy}</div>
                                    ))}
                                </div>
                            </details>

                            <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
                                <div className="mb-4 text-sm font-black">Finished rolls waiting for dispatch release</div>
                                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                                    {selected.rolls.map((roll) => (
                                        <div key={roll.id} className="rounded-3xl border border-slate-200 p-4">
                                            <div className="font-black">{roll.label_id}</div>
                                            <div className="mt-1 text-xs text-slate-500">{roll.batch_no || "No batch"} • {n(roll.weight_kg)} kg • {roll.location?.name}</div>
                                            <div className="mt-4 flex gap-2">
                                                {!roll.released_to_dispatch ? (
                                                    <>
                                                        <Button size="sm" onClick={() => releaseRollMutation.mutate({ rollId: roll.id, mode: "UNPACKED" })}>Release unpacked</Button>
                                                        {roll.roll_pack_enabled && <Button size="sm" variant="outline" onClick={() => releaseRollMutation.mutate({ rollId: roll.id, mode: "PACKED" })}>Pack & release</Button>}
                                                    </>
                                                ) : <span className="rounded-full bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700">Ready in Dispatch Bay</span>}
                                            </div>
                                        </div>
                                    ))}
                                    {!selected.rolls.length && <div className="rounded-3xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">No roll handoff waiting for this order.</div>}
                                </div>
                            </div>
                        </>
                    )}
                </div>
            </section>

            <Dialog open={Boolean(sealGonny)} onOpenChange={(open) => !open && setSealGonny(null)}>
                <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
                    <DialogHeader><DialogTitle>Seal gonny with actual gross weight</DialogTitle></DialogHeader>
                    {sealGonny && (
                        <div className="space-y-4">
                            <div className="rounded-3xl bg-slate-50 p-4">
                                <div className="font-black">{sealGonny.label_id}</div>
                                <div className="mt-2 grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
                                    <div><b>{n(sealGonny.net_product_weight_kg)}</b><br />product net</div>
                                    <div><b>{n(sealGonny.inner_pack_tare_kg)}</b><br />inner tare</div>
                                    <div><b>{n(sealGonny.secondary_pack_tare_kg)}</b><br />gonny tare</div>
                                    <div><b>{n(expected)}</b><br />expected gross</div>
                                </div>
                            </div>
                            <div>
                                <Label>Actual gonny gross weight (kg)</Label>
                                <Input type="number" step="0.001" value={actualGross} onChange={(e) => setActualGross(e.target.value)} />
                            </div>
                            <div className={`rounded-2xl p-3 text-sm font-bold ${Math.abs(variancePct) > 2 ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-800"}`}>
                                Variance: {n(variance, 3)} kg ({n(variancePct, 2)}%)
                            </div>
                            {Math.abs(variancePct) > 2 && (
                                <div>
                                    <Label>Variance reason</Label>
                                    <Textarea value={varianceReason} onChange={(e) => setVarianceReason(e.target.value)} placeholder="Explain why actual gonny weight differs from expected." />
                                </div>
                            )}
                        </div>
                    )}
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setSealGonny(null)}>Cancel</Button>
                        <Button disabled={!actualGross || (Math.abs(variancePct) > 2 && !varianceReason.trim()) || sealMutation.isPending} onClick={() => sealMutation.mutate()}>
                            {sealMutation.isPending ? "Sealing..." : "Seal gonny"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}

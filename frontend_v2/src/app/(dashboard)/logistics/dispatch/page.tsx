"use client"

import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowRight, FileText, HelpCircle, PackageCheck, Printer, Search, Send, Truck } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { logisticsService, type DeliveryChallan, type SODispatchSummary } from "@/services/logistics"

const n = (value: unknown, digits = 1) => Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: digits })
const err = (error: any) => error?.response?.data?.error || error?.response?.data?.detail || error?.message || "Request failed."

function Tile({ label, value, hint, tone = "blue" }: { label: string; value: string; hint: string; tone?: "blue" | "emerald" | "amber" | "slate" }) {
    const tones = {
        blue: "border-blue-100 bg-blue-50/80 text-blue-950",
        emerald: "border-emerald-100 bg-emerald-50/80 text-emerald-950",
        amber: "border-amber-100 bg-amber-50/80 text-amber-950",
        slate: "border-slate-200 bg-white text-slate-950",
    }
    return (
        <div className={`rounded-[14px] border p-3 shadow-sm ${tones[tone]}`}>
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">{label}</div>
            <div className="mt-1 text-2xl font-black tracking-tight">{value}</div>
            <div className="mt-1 text-xs font-semibold text-slate-500">{hint}</div>
        </div>
    )
}

function lifecycle(status: string) {
    const current = String(status || "DRAFT").toUpperCase()
    const stages = ["DRAFT", "DISPATCHED", "IN_TRANSIT", "DELIVERED"]
    const active = Math.max(0, stages.indexOf(current))
    return stages.map((stage, index) => (
        <div key={stage} className="flex min-w-[110px] flex-1 items-center">
            <div className={`flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-black ${index <= active ? "bg-emerald-500 text-white" : "bg-slate-200 text-slate-500"}`}>{index + 1}</div>
            <div className="ml-2 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">{stage.replace("_", " ")}</div>
            {index < stages.length - 1 && <div className={`mx-3 h-px flex-1 ${index < active ? "bg-emerald-400" : "bg-slate-200"}`} />}
        </div>
    ))
}

export default function DispatchBayPage() {
    const { toast } = useToast()
    const queryClient = useQueryClient()
    const [search, setSearch] = useState("")
    const [historySearch, setHistorySearch] = useState("")
    const [selectedOrderId, setSelectedOrderId] = useState("")
    const [selectedRolls, setSelectedRolls] = useState<string[]>([])
    const [selectedGonnies, setSelectedGonnies] = useState<string[]>([])
    const [finalizeOpen, setFinalizeOpen] = useState(false)
    const [vehicleNo, setVehicleNo] = useState("")
    const [driverName, setDriverName] = useState("")
    const [driverPhone, setDriverPhone] = useState("")
    const [transporterName, setTransporterName] = useState("")
    const [lrNumber, setLrNumber] = useState("")
    const [ewayBill, setEwayBill] = useState("")
    const [notes, setNotes] = useState("")

    const board = useQuery({ queryKey: ["dispatch-board"], queryFn: logisticsService.getDispatchBoard, refetchInterval: 30000 })
    const summary = useQuery({
        queryKey: ["dispatch-summary", selectedOrderId],
        queryFn: () => logisticsService.getSODispatchableItems(selectedOrderId),
        enabled: Boolean(selectedOrderId),
    })
    const challans = useQuery({ queryKey: ["challans"], queryFn: () => logisticsService.getChallans() })

    const invalidate = () => {
        queryClient.invalidateQueries({ queryKey: ["dispatch-board"] })
        queryClient.invalidateQueries({ queryKey: ["dispatch-summary", selectedOrderId] })
        queryClient.invalidateQueries({ queryKey: ["challans"] })
    }

    const createChallanMutation = useMutation({
        mutationFn: () => logisticsService.createChallan({
            customer_name: selected?.sales_order.customer_name || "",
            plant_id: selectedPlantId || "",
            sales_order_id: selectedOrderId,
            vehicle_no: vehicleNo,
            driver_name: driverName,
            driver_phone: driverPhone,
            transporter_name: transporterName,
            lr_number: lrNumber,
            e_way_bill_number: ewayBill,
            dispatch_notes: notes,
            ship_to_address_snapshot: {
                customer_name: selected?.sales_order.customer_name || "",
                sales_order_number: selected?.sales_order.order_number || "",
            },
            roll_ids: selectedRolls,
            gonny_ids: selectedGonnies,
        }),
        onSuccess: (data) => {
            toast({ title: "Challan created", description: data.message })
            setFinalizeOpen(false)
            setSelectedRolls([])
            setSelectedGonnies([])
            invalidate()
        },
        onError: (error) => toast({ title: "Challan failed", description: err(error), variant: "destructive" }),
    })

    const dispatchMutation = useMutation({
        mutationFn: (challanId: string) => logisticsService.dispatchChallan(challanId),
        onSuccess: (data) => {
            toast({ title: "Dispatched", description: data.message })
            invalidate()
        },
        onError: (error) => toast({ title: "Dispatch failed", description: err(error), variant: "destructive" }),
    })

    const cards = (board.data?.orders || []).filter((row) => {
        const term = search.trim().toLowerCase()
        if (!term) return true
        return `${row.sales_order.order_number} ${row.sales_order.customer_name}`.toLowerCase().includes(term)
    })
    const selected = summary.data as SODispatchSummary | undefined
    const selectedRollRows = selected?.rolls.filter((roll) => selectedRolls.includes(roll.id)) || []
    const selectedGonnyRows = selected?.gonnies.filter((gonny) => selectedGonnies.includes(gonny.id)) || []
    const selectedPlantId = selectedRollRows[0]?.location?.plant_id || selectedGonnyRows[0]?.location?.plant_id || selected?.rolls[0]?.location?.plant_id || selected?.gonnies[0]?.location?.plant_id || ""
    const selectedGross = selectedRollRows.reduce((sum, roll) => sum + Number(roll.weight_kg || 0), 0) + selectedGonnyRows.reduce((sum, gonny) => sum + Number(gonny.gross_weight_kg || gonny.weight_kg || 0), 0)
    const selectedPcs = selectedGonnyRows.reduce((sum, gonny) => sum + Number(gonny.qty_pcs || 0), 0)
    const history = (challans.data || []).filter((row) => {
        const term = historySearch.trim().toLowerCase()
        if (!term) return true
        return `${row.dc_no} ${row.customer_name} ${row.sales_order__order_number} ${row.vehicle_no}`.toLowerCase().includes(term)
    })
    const openChallans = history.filter((row) => String(row.status || "").toUpperCase() === "DRAFT").length
    const todayDispatches = history.filter((row) => row.dispatch_date && new Date(row.dispatch_date).toDateString() === new Date().toDateString()).length
    const readyGross = Number(board.data?.totals.ready_rolls_kg || 0) + Number(board.data?.totals.ready_gonnies_gross_kg || 0)

    const toggle = (id: string, list: string[], setter: (value: string[]) => void) => {
        setter(list.includes(id) ? list.filter((value) => value !== id) : [...list, id])
    }

    return (
        <div className="space-y-6 p-4 lg:p-6">
            <section className="overflow-hidden rounded-[20px] border border-slate-200 bg-[radial-gradient(1200px_500px_at_80%_-10%,rgba(230,235,255,0.98),transparent_60%),radial-gradient(900px_400px_at_10%_0%,rgba(236,254,255,0.95),transparent_60%),#ffffff] p-5 text-slate-950 shadow-sm">
                <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                    <div>
                        <div className="text-[11px] font-black uppercase tracking-[0.2em] text-blue-700">Dispatch board</div>
                        <h1 className="mt-1 max-w-3xl text-2xl font-black tracking-tight">What can go out today</h1>
                        <p className="mt-1 max-w-2xl text-sm font-medium leading-6 text-slate-600">Everything Packing Yard has explicitly handed over. Cards below show every sales order with released units, so dispatch can plan trucks before building a challan.</p>
                        <div className="mt-4 flex flex-wrap gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-slate-600">
                            <span className="rounded-full border border-slate-200 bg-white px-3 py-1 shadow-sm">Dispatch terminal</span>
                            <span className="rounded-full border border-slate-200 bg-white px-3 py-1 shadow-sm">Released units</span>
                            <span className="rounded-full border border-slate-200 bg-white px-3 py-1 shadow-sm">Selected tray</span>
                            <span className="rounded-full border border-slate-200 bg-white px-3 py-1 shadow-sm">Challan details</span>
                            <span className="rounded-full border border-slate-200 bg-white px-3 py-1 shadow-sm">History</span>
                        </div>
                    </div>
                    <div className="grid w-full gap-3 sm:grid-cols-2 xl:w-[900px] xl:grid-cols-3">
                        <Tile label="Rolls ready" value={n(board.data?.totals.ready_rolls || 0, 0)} hint={`${n(board.data?.totals.ready_rolls_kg || 0)} kg ready`} tone="blue" />
                        <Tile label="Gonnies ready" value={n(board.data?.totals.ready_gonnies || 0, 0)} hint={`${n(board.data?.totals.ready_gonnies_pcs || 0, 0)} pcs ready`} tone="emerald" />
                        <Tile label="Gross ready" value={`${n(readyGross)} kg`} hint={`${n(board.data?.totals.orders || 0, 0)} orders`} tone="slate" />
                        <Tile label="Still in packing" value={n(board.data?.totals.pending_in_packing || 0, 0)} hint="not yet released" tone="amber" />
                        <Tile label="Open challans" value={n(openChallans, 0)} hint="draft, not dispatched" tone="slate" />
                        <Tile label="Today dispatched" value={n(todayDispatches, 0)} hint="completed challans" tone="slate" />
                    </div>
                </div>
                <div className="mt-6 rounded-[20px] border border-white/70 bg-white/80 p-4 shadow-sm backdrop-blur">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                            <div className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">Priority release cards</div>
                            <div className="mt-1 text-sm font-black text-slate-900">Select a sales order to open the dispatch workspace.</div>
                        </div>
                        <div className="relative w-full md:max-w-sm">
                            <Search className="absolute left-4 top-3.5 h-4 w-4 text-slate-400" />
                            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search ready orders..." className="h-12 rounded-2xl border-slate-200 bg-white pl-10 shadow-sm" />
                        </div>
                    </div>
                    <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {cards.slice(0, 6).map((row) => {
                            const readyUnits = Number(row.available_for_dispatch.rolls_count || 0) + Number(row.available_for_dispatch.gonnies_count || 0)
                            const pendingUnits = Number(row.packing_pending?.open_gonnies_count || 0) + Number(row.packing_pending?.unpacked_batch_count || 0) + Number(row.packing_pending?.unreleased_rolls_count || 0)
                            const readyPct = readyUnits + pendingUnits > 0 ? Math.min(100, Math.round((readyUnits / (readyUnits + pendingUnits)) * 100)) : (readyUnits > 0 ? 100 : 0)
                            const grossKg = Number(row.available_for_dispatch.rolls_kg || 0) + Number(row.available_for_dispatch.gonnies_gross_kg || 0)
                            return (
                            <button key={row.sales_order.id} onClick={() => { setSelectedOrderId(row.sales_order.id); setSelectedRolls([]); setSelectedGonnies([]); }} className={`relative overflow-hidden rounded-[14px] border p-4 text-left shadow-sm transition ${selectedOrderId === row.sales_order.id ? "border-blue-400 bg-gradient-to-b from-blue-50 to-white" : "border-slate-200 bg-white hover:-translate-y-0.5 hover:border-blue-200"}`}>
                                <span className={`absolute inset-y-0 left-0 w-1 ${pendingUnits > readyUnits ? "bg-amber-400" : readyUnits ? "bg-emerald-400" : "bg-slate-200"}`} />
                                <div className="pl-1">
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <div className="text-xs font-mono font-bold text-blue-700">{row.sales_order.order_number}</div>
                                        <div className="mt-0.5 line-clamp-1 text-sm font-black text-slate-950">{row.sales_order.customer_name}</div>
                                    </div>
                                    <span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${readyUnits ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{readyUnits ? "Ready now" : "Waiting"}</span>
                                </div>
                                <div className="mt-4 grid grid-cols-3 gap-2 text-[11px]">
                                    <div><div className="font-semibold text-slate-400">Rolls</div><div className="font-black text-blue-700">{n(row.available_for_dispatch.rolls_count || 0, 0)}</div></div>
                                    <div><div className="font-semibold text-slate-400">Gonnies</div><div className="font-black text-emerald-700">{n(row.available_for_dispatch.gonnies_count || 0, 0)}</div></div>
                                    <div><div className="font-semibold text-slate-400">Gross</div><div className="font-black">{n(grossKg)} kg</div></div>
                                </div>
                                <div className="mt-3">
                                    <div className="mb-1 flex items-center justify-between text-[11px] font-semibold text-slate-500">
                                        <span>{readyPct}% ready</span>
                                        <span>{readyUnits} unit{readyUnits === 1 ? "" : "s"}</span>
                                    </div>
                                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full bg-gradient-to-r from-blue-500 to-blue-500" style={{ width: `${readyPct}%` }} /></div>
                                </div>
                                </div>
                            </button>
                        )})}
                        {!cards.length && <div className="rounded-3xl border border-dashed border-slate-200 bg-white p-8 text-center text-sm font-semibold text-slate-500 md:col-span-2 xl:col-span-3">No dispatch-ready orders found.</div>}
                    </div>
                </div>
            </section>

            <section className="space-y-5">
                <aside className="hidden">
                    <div className="mb-3 text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">Ready order rail</div>
                    <div className="relative">
                        <Search className="absolute left-4 top-3.5 h-4 w-4 text-slate-400" />
                        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search ready orders..." className="h-12 rounded-2xl pl-10" />
                    </div>
                    <div className="mt-4 max-h-[620px] space-y-3 overflow-y-auto pr-1">
                        {cards.map((row) => (
                            <button key={row.sales_order.id} onClick={() => { setSelectedOrderId(row.sales_order.id); setSelectedRolls([]); setSelectedGonnies([]); }} className={`relative w-full overflow-hidden rounded-3xl border p-4 text-left transition ${selectedOrderId === row.sales_order.id ? "border-blue-400 bg-blue-50 shadow-md" : "border-slate-200 hover:border-blue-200"}`}>
                                <span className={`absolute inset-y-0 left-0 w-2 ${row.available_for_dispatch.gonnies_count ? "bg-emerald-400" : row.available_for_dispatch.rolls_kg ? "bg-blue-400" : "bg-amber-400"}`} />
                                <div className="flex items-start justify-between">
                                    <div>
                                        <div className="text-sm font-black text-slate-950">{row.sales_order.order_number}</div>
                                        <div className="mt-1 line-clamp-1 text-xs font-semibold text-slate-500">{row.sales_order.customer_name}</div>
                                    </div>
                                    <ArrowRight className="h-4 w-4 text-slate-400" />
                                </div>
                                <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                                    <div className="rounded-2xl bg-slate-50 p-2"><b>{n(row.available_for_dispatch.rolls_kg || 0)}</b><br />roll kg</div>
                                    <div className="rounded-2xl bg-emerald-50 p-2"><b>{n(row.available_for_dispatch.gonnies_count || 0, 0)}</b><br />gonnies</div>
                                </div>
                            </button>
                        ))}
                        {!cards.length && <div className="rounded-3xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">No dispatch-ready orders found.</div>}
                    </div>
                </aside>

                <main className="space-y-5">
                    {!selected ? (
                        <div className="rounded-[2rem] border border-dashed border-slate-300 bg-white p-12 text-center">
                            <Truck className="mx-auto h-10 w-10 text-slate-300" />
                            <h2 className="mt-3 text-xl font-black">Select a ready order.</h2>
                            <p className="mt-2 text-sm text-slate-500">Dispatch Bay only shows units explicitly released from Packing Yard.</p>
                        </div>
                    ) : (
                        <>
                            <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
                                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                                    <div>
                                        <div className="text-[10px] font-black uppercase tracking-[0.28em] text-blue-600">Selected dispatch target</div>
                                        <h2 className="mt-1 text-2xl font-black">{selected.sales_order.order_number}</h2>
                                        <p className="text-sm font-semibold text-slate-500">{selected.sales_order.customer_name}</p>
                                    </div>
                                    <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-900">
                                        Selected: {selectedRolls.length} rolls, {selectedGonnies.length} gonnies • {n(selectedGross)} kg gross • {n(selectedPcs, 0)} pcs
                                    </div>
                                </div>
                                <div className="mt-5 grid gap-3 md:grid-cols-4">
                                    <div className="rounded-2xl border border-blue-200 bg-blue-50 p-3 text-center text-xs font-black text-blue-950">1<br /><span className="font-semibold">Released from packing</span></div>
                                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-center text-xs font-black text-emerald-950">2<br /><span className="font-semibold">{selectedRolls.length + selectedGonnies.length} selected</span></div>
                                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-center text-xs font-black text-slate-600">3<br /><span className="font-semibold">Vehicle + LR details</span></div>
                                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-center text-xs font-black text-slate-600">4<br /><span className="font-semibold">Print + dispatch</span></div>
                                </div>
                            </div>

                            <div className="grid gap-5 2xl:grid-cols-2">
                                <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
                                    <div className="mb-4 flex items-center gap-2 text-sm font-black"><PackageCheck className="h-4 w-4 text-blue-600" /> Released rolls</div>
                                    <div className="space-y-3">
                                        {selected.rolls.map((roll) => (
                                            <button key={roll.id} onClick={() => toggle(roll.id, selectedRolls, setSelectedRolls)} className={`w-full rounded-3xl border p-4 text-left ${selectedRolls.includes(roll.id) ? "border-blue-400 bg-blue-50 shadow-md" : "border-slate-200"}`}>
                                                <div className="flex justify-between gap-3">
                                                    <div><div className="font-black">{roll.label_id}</div><div className="text-xs text-slate-500">{roll.batch_no || "No batch"} • {roll.location?.name}</div></div>
                                                    <div className="text-right font-black">{n(roll.weight_kg)} kg</div>
                                                </div>
                                            </button>
                                        ))}
                                        {!selected.rolls.length && <div className="rounded-3xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">No released rolls for this order.</div>}
                                    </div>
                                </div>
                                <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
                                    <div className="mb-4 flex items-center gap-2 text-sm font-black"><PackageCheck className="h-4 w-4 text-emerald-600" /> Released gonnies</div>
                                    <div className="space-y-3">
                                        {selected.gonnies.map((gonny) => (
                                            <button key={gonny.id} onClick={() => toggle(gonny.id, selectedGonnies, setSelectedGonnies)} className={`w-full rounded-3xl border p-4 text-left ${selectedGonnies.includes(gonny.id) ? "border-emerald-400 bg-emerald-50 shadow-md" : "border-slate-200"}`}>
                                                <div className="flex justify-between gap-3">
                                                    <div>
                                                        <div className="font-black">{gonny.label_id}</div>
                                                        <div className="text-xs text-slate-500">{gonny.qty_pcs} pcs • expected {n(gonny.expected_gross_weight_kg)} kg • variance {n(gonny.gross_variance_kg, 3)} kg</div>
                                                    </div>
                                                    <div className="text-right font-black">{n(gonny.gross_weight_kg || gonny.weight_kg)} kg</div>
                                                </div>
                                            </button>
                                        ))}
                                        {!selected.gonnies.length && <div className="rounded-3xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">No released sealed gonnies for this order.</div>}
                                    </div>
                                </div>
                            </div>

                            <div className="sticky bottom-3 z-10 rounded-[2rem] border border-slate-200 bg-white/95 p-4 shadow-xl backdrop-blur">
                                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                    <div className="text-sm font-bold text-slate-600">Finalize challan for {selectedRolls.length + selectedGonnies.length} selected units.</div>
                                    <Button disabled={!selectedPlantId || selectedRolls.length + selectedGonnies.length === 0} onClick={() => setFinalizeOpen(true)}>
                                        <Send className="mr-2 h-4 w-4" /> Create challan
                                    </Button>
                                </div>
                            </div>
                        </>
                    )}

                    <details className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
                        <summary className="flex cursor-pointer items-center gap-2 text-sm font-black">
                            <HelpCircle className="h-4 w-4 text-blue-600" /> Dispatch glossary and shortcut terms
                        </summary>
                        <div className="mt-4 grid gap-3 text-xs md:grid-cols-3">
                            {[
                                ["Released", "Packing Yard has handed this unit to Dispatch Bay."],
                                ["Challan", "Document that records selected units, vehicle, transporter, and ship-to details."],
                                ["Gross", "Actual sealed shipment weight used for dispatch."],
                                ["LR number", "Transporter receipt number, optional until available."],
                                ["E-way bill", "Government movement reference when required."],
                                ["History", "All created/printed/dispatched challans searchable from this page."],
                            ].map(([term, copy]) => <div key={term} className="rounded-2xl bg-slate-50 p-3"><b>{term}</b><br />{copy}</div>)}
                        </div>
                    </details>

                    <div className="rounded-[2rem] border border-slate-200 bg-white p-5 shadow-sm">
                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                            <div className="flex items-center gap-2 text-sm font-black"><FileText className="h-4 w-4 text-slate-600" /> Dispatch history</div>
                            <Input value={historySearch} onChange={(e) => setHistorySearch(e.target.value)} placeholder="Search challan, vehicle, customer..." className="max-w-md rounded-2xl" />
                        </div>
                        <div className="mt-4 overflow-x-auto">
                            <table className="w-full min-w-[860px] text-sm">
                                <thead className="text-[10px] uppercase tracking-[0.22em] text-slate-400"><tr><th className="py-3 text-left">Challan</th><th className="text-left">Customer</th><th>Status</th><th>Vehicle</th><th>Transport</th><th>Dispatch date</th><th className="text-right">Actions</th></tr></thead>
                                <tbody className="divide-y divide-slate-100">
                                    {history.map((row: DeliveryChallan) => (
                                        <tr key={row.id} data-testid={`dispatch-challan-row-${row.id}`}>
                                            <td className="py-4 font-black">{row.dc_no}</td>
                                            <td>{row.customer_name}</td>
                                            <td>
                                                <div className="flex min-w-[360px] items-center">{lifecycle(row.status)}</div>
                                            </td>
                                            <td>{row.vehicle_no || "-"}</td>
                                            <td>{row.transporter_name || row.lr_number || "-"}</td>
                                            <td>{row.dispatch_date ? new Date(row.dispatch_date).toLocaleString() : "-"}</td>
                                            <td className="space-x-2 text-right">
                                                <Button size="sm" variant="outline" data-testid={`dispatch-print-${row.id}`} onClick={() => window.open(logisticsService.getChallanPrintUrl(row.id), "_blank")}><Printer className="mr-1 h-3 w-3" /> Print</Button>
                                                {row.status === "DRAFT" && <Button size="sm" onClick={() => dispatchMutation.mutate(row.id)}>Dispatch</Button>}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {!history.length && <div className="rounded-3xl border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500">No challans match this search.</div>}
                        </div>
                    </div>
                </main>
            </section>

            <Dialog open={finalizeOpen} onOpenChange={setFinalizeOpen}>
                <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
                    <DialogHeader><DialogTitle>Finalize dispatch challan</DialogTitle></DialogHeader>
                    <div className="rounded-3xl border border-blue-100 bg-blue-50 p-4 text-sm">
                        <div className="grid gap-3 md:grid-cols-4">
                            <div><b>{selected?.sales_order.order_number || "-"}</b><br />Sales order</div>
                            <div><b>{selected?.sales_order.customer_name || "-"}</b><br />Customer</div>
                            <div><b>{selectedRolls.length + selectedGonnies.length}</b><br />Units</div>
                            <div><b>{n(selectedGross)}</b><br />Gross kg</div>
                        </div>
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                        <div><Label>Vehicle number</Label><Input value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} placeholder="GJ..." /></div>
                        <div><Label>Transporter</Label><Input value={transporterName} onChange={(e) => setTransporterName(e.target.value)} placeholder="Transporter name" /></div>
                        <div><Label>Driver name</Label><Input value={driverName} onChange={(e) => setDriverName(e.target.value)} /></div>
                        <div><Label>Driver phone</Label><Input value={driverPhone} onChange={(e) => setDriverPhone(e.target.value)} /></div>
                        <div><Label>LR number</Label><Input value={lrNumber} onChange={(e) => setLrNumber(e.target.value)} /></div>
                        <div><Label>E-way bill</Label><Input value={ewayBill} onChange={(e) => setEwayBill(e.target.value)} /></div>
                        <div className="md:col-span-2"><Label>Dispatch notes</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
                    </div>
                    <div className="rounded-3xl bg-slate-50 p-4 text-sm">
                        <b>Selected units:</b> {selectedRolls.length} rolls, {selectedGonnies.length} gonnies • {n(selectedGross)} kg gross • {n(selectedPcs, 0)} pcs
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setFinalizeOpen(false)}>Cancel</Button>
                        <Button disabled={!selectedPlantId || createChallanMutation.isPending} onClick={() => createChallanMutation.mutate()}>
                            {createChallanMutation.isPending ? "Creating..." : "Create challan"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}

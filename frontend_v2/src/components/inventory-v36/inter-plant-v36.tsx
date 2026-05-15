"use client"

/**
 * V3.6 Inter-Plant Workspace
 *
 * Full-fledge transfer command center: gradient hero, KPI strip, plant-flow
 * map, lifecycle kanban, transfer detail drawer, and recent activity.
 * The transfer form remains a separate operational surface; receipts stay out
 * of Smart GRN so plant-to-plant stock does not look like vendor inward.
 */

import * as React from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import {
    ArrowRight,
    ArrowRightLeft,
    BarChart3,
    Clock,
    Factory,
    MapPin,
    PackageCheck,
    Plane,
    Plus,
    Printer,
    Search,
    Truck,
    X,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { GradientHero } from "@/components/erp-v3/gradient-hero"
import { cn } from "@/lib/utils"
import { inventoryService, type DeliveryChallan } from "@/services/inventory"
import { factoryService, type Plant } from "@/services/factory"
import { ClassTabBar, INVENTORY_CLASS_TABS } from "./pulse-view-v36"

function fmtDate(s?: string | null): string {
    if (!s) return "—"
    const d = new Date(s)
    if (Number.isNaN(d.getTime())) return "—"
    return d.toLocaleString()
}

function fmtKg(n: any, d = 2): string {
    const v = Number(n)
    return Number.isFinite(v) ? `${v.toFixed(d)} kg` : "—"
}

function statusBadge(s: string): string {
    if (s === "RECEIVED") return "bg-emerald-100 text-emerald-800 ring-emerald-200"
    if (s === "IN_TRANSIT") return "bg-blue-100 text-blue-800 ring-blue-200"
    if (s === "DRAFT") return "bg-amber-100 text-amber-800 ring-amber-200"
    return "bg-slate-100 text-slate-700 ring-slate-200"
}

export function InterPlantV36() {
    const [search, setSearch] = React.useState("")
    const [filterPlant, setFilterPlant] = React.useState("ALL")
    const [selected, setSelected] = React.useState<DeliveryChallan | null>(null)

    const challansQuery = useQuery({
        queryKey: ["inter-plant-challans-v36"],
        queryFn: () => inventoryService.getChallans(),
        staleTime: 30_000,
    })
    const plantsQuery = useQuery({
        queryKey: ["plants-v36"],
        queryFn: () => factoryService.getPlants(),
        staleTime: 60_000,
    })

    const challans = React.useMemo(() => Array.isArray(challansQuery.data) ? challansQuery.data : [], [challansQuery.data])
    const plants = React.useMemo(() => Array.isArray(plantsQuery.data) ? plantsQuery.data : [], [plantsQuery.data])

    const filtered = React.useMemo(() => {
        const q = search.trim().toLowerCase()
        return challans.filter((c) => {
            if (filterPlant !== "ALL") {
                if (c.from_plant !== filterPlant && c.to_plant !== filterPlant) return false
            }
            if (!q) return true
            return [c.dc_no, c.from_plant_name, c.to_plant_name, c.vehicle_no, c.transporter_name, c.lr_number, c.id]
                .some((v) => String(v || "").toLowerCase().includes(q))
        })
    }, [challans, search, filterPlant])

    const drafts = filtered.filter((c) => c.status === "DRAFT")
    const inTransit = filtered.filter((c) => c.status === "IN_TRANSIT")
    const received = filtered.filter((c) => c.status === "RECEIVED")
    const totalKgInTransit = inTransit.reduce((s, c) => s + Number(c.transfer_summary?.dispatched_total_kg || 0), 0)
    const totalReceivedKg = received.reduce((s, c) => s + Number(c.transfer_summary?.received_total_kg || 0), 0)

    // Plant→plant flow aggregate
    const plantFlows = React.useMemo(() => {
        const map = new Map<string, { from: string; fromName: string; to: string; toName: string; count: number; kg: number }>()
        for (const c of inTransit) {
            const key = `${c.from_plant}→${c.to_plant}`
            const e = map.get(key) || { from: c.from_plant, fromName: c.from_plant_name, to: c.to_plant, toName: c.to_plant_name, count: 0, kg: 0 }
            e.count += 1
            e.kg += Number(c.transfer_summary?.dispatched_total_kg || 0)
            map.set(key, e)
        }
        return Array.from(map.values()).sort((a, b) => b.kg - a.kg)
    }, [inTransit])

    return (
        <div className="space-y-4 pb-12">
            <ClassTabBar tabs={INVENTORY_CLASS_TABS} activeId="transfers" />
            <GradientHero
                eyebrow="Inventory · V3.6 · transfers"
                title="Inter-plant flows"
                subtitle="Move material between plants with full visibility — drafts, in-transit, and received in one workspace."
                palette="blue"
                chips={[
                    { icon: <Truck className="h-3.5 w-3.5" />, label: "In transit", value: `${inTransit.length}`, tone: "ok" },
                    { icon: <PackageCheck className="h-3.5 w-3.5" />, label: "Received", value: `${received.length}`, tone: "violet" },
                    { icon: <Plane className="h-3.5 w-3.5" />, label: "On the road", value: `${fmtKg(totalKgInTransit, 0)}`, tone: "ok" },
                ]}
                actions={
                    <Link href="/inventory/inter-plant" className="inline-flex items-center gap-1.5 rounded-xl bg-white px-4 py-1.5 text-xs font-bold text-blue-700 shadow-md hover:bg-blue-50">
                        <Plus className="h-3.5 w-3.5" /> New transfer
                    </Link>
                }
            />

            {/* KPI strip */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Kpi tone="amber" icon="📋" label="Drafts" value={`${drafts.length}`} sub="awaiting dispatch" />
                <Kpi tone="blue" icon="🚚" label="In transit" value={`${inTransit.length}`} sub={`${fmtKg(totalKgInTransit, 0)} on road`} />
                <Kpi tone="emerald" icon="✅" label="Received this fortnight" value={`${received.length}`} sub={`${fmtKg(totalReceivedKg, 0)} arrived`} />
                <Kpi tone="violet" icon="🏭" label="Plants in network" value={`${plants.length}`} sub="active" />
            </div>

            {/* Filters */}
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center gap-3">
                    <div className="relative flex-1 min-w-[260px]">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="DC# · vehicle · LR · plant…" className="h-11 rounded-xl pl-10 text-sm" />
                    </div>
                    <select value={filterPlant} onChange={(e) => setFilterPlant(e.target.value)} className="h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm font-mono">
                        <option value="ALL">All plants</option>
                        {plants.map((p: Plant) => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                    </select>
                </div>
            </section>

            {/* Plant flow map */}
            {plantFlows.length > 0 && (
                <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                    <div className="flex items-center justify-between mb-3">
                        <div>
                            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-blue-700">Live transfers · plant → plant</div>
                            <h3 className="font-display text-base font-bold text-slate-900">Network flow</h3>
                        </div>
                        <BarChart3 className="h-4 w-4 text-blue-500" />
                    </div>
                    <div className="space-y-2">
                        {plantFlows.slice(0, 8).map((f, i) => {
                            const widthPct = Math.max(12, Math.min(100, (f.kg / Math.max(plantFlows[0].kg, 1)) * 100))
                            return (
                                <div key={i} className="flex items-center gap-3 text-[12px]">
                                    <div className="w-32 truncate text-right font-bold text-slate-700">{f.fromName}</div>
                                    <div className="relative flex-1 h-7 rounded-md bg-slate-100 ring-1 ring-slate-200 overflow-hidden">
                                        <div className="absolute inset-y-0 left-0 bg-gradient-to-r from-blue-500 via-indigo-500 to-violet-500" style={{ width: `${widthPct}%` }} />
                                        <div className="absolute inset-0 flex items-center justify-between px-3 text-[10px] font-bold">
                                            <span className="text-white drop-shadow-sm">{f.count} DC · {fmtKg(f.kg, 0)}</span>
                                            <ArrowRight className="h-3 w-3 text-slate-400" />
                                        </div>
                                    </div>
                                    <div className="w-32 truncate font-bold text-slate-700">{f.toName}</div>
                                </div>
                            )
                        })}
                    </div>
                </section>
            )}

            {/* Lifecycle kanban */}
            {challansQuery.isLoading ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-12 text-center text-sm text-slate-500">Loading transfers…</div>
            ) : (
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                    <Lane title="Draft" subtitle="Created · awaiting dispatch" tone="amber" icon={<Plus className="h-4 w-4" />} list={drafts} onClick={(c) => setSelected(c)} />
                    <Lane title="In transit" subtitle="Dispatched · on the road" tone="blue" icon={<Truck className="h-4 w-4" />} list={inTransit} onClick={(c) => setSelected(c)} />
                    <Lane title="Received" subtitle="Arrived at destination" tone="emerald" icon={<PackageCheck className="h-4 w-4" />} list={received} onClick={(c) => setSelected(c)} />
                </div>
            )}

            {selected && <DetailDrawer challan={selected} onClose={() => setSelected(null)} />}
        </div>
    )
}

function Kpi({ tone, icon, label, value, sub }: { tone: "blue" | "violet" | "amber" | "emerald"; icon: string; label: string; value: string; sub: string }) {
    const TONE = {
        blue: "from-blue-600 via-indigo-600 to-violet-600",
        violet: "from-violet-600 via-fuchsia-600 to-pink-600",
        amber: "from-amber-500 via-orange-500 to-rose-500",
        emerald: "from-emerald-600 via-teal-600 to-cyan-600",
    }[tone]
    return (
        <div className={cn("overflow-hidden rounded-2xl bg-gradient-to-br p-4 text-white shadow-lg ring-1 ring-white/10 hover:shadow-2xl hover:-translate-y-0.5", TONE)}>
            <div className="flex items-start justify-between">
                <div className="text-[10px] font-black uppercase tracking-[0.22em] text-white/80">{label}</div>
                <span className="text-xl">{icon}</span>
            </div>
            <div className="mt-2 font-display text-3xl font-black">{value}</div>
            <div className="mt-1 text-xs text-white/80">{sub}</div>
        </div>
    )
}

function Lane({ title, subtitle, tone, icon, list, onClick }: { title: string; subtitle: string; tone: "blue" | "amber" | "emerald"; icon: React.ReactNode; list: DeliveryChallan[]; onClick: (c: DeliveryChallan) => void }) {
    const TONE = {
        amber: { bar: "border-l-amber-500", bg: "from-amber-50/80", num: "bg-amber-500 text-white" },
        blue: { bar: "border-l-blue-500", bg: "from-blue-50/80", num: "bg-blue-600 text-white" },
        emerald: { bar: "border-l-emerald-500", bg: "from-emerald-50/80", num: "bg-emerald-600 text-white" },
    }[tone]
    return (
        <section className={cn("overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-md border-l-[3px]", TONE.bar)}>
            <header className={cn("flex items-center justify-between border-b border-slate-100 bg-gradient-to-r via-white to-white px-4 py-3", TONE.bg)}>
                <div className="flex items-center gap-2">
                    <span className={cn("flex h-7 w-7 items-center justify-center rounded-lg shadow-sm", TONE.num)}>{icon}</span>
                    <div>
                        <div className="font-display text-base font-bold text-slate-900">{title}</div>
                        <div className="text-[10px] text-slate-500">{subtitle}</div>
                    </div>
                </div>
                <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-black", TONE.num)}>{list.length}</span>
            </header>
            <div className="max-h-[68vh] overflow-y-auto p-3 space-y-2.5">
                {list.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/40 p-4 text-center text-xs text-slate-500 italic">— empty</div>
                ) : (
                    list.map((c) => <Card key={c.id} c={c} onClick={() => onClick(c)} />)
                )}
            </div>
        </section>
    )
}

function Card({ c, onClick }: { c: DeliveryChallan; onClick: () => void }) {
    const summary = c.transfer_summary || {} as any
    const dispatchedKg = Number(summary.dispatched_total_kg || 0)
    const receivedKg = Number(summary.received_total_kg || 0)
    const lines = Number(summary.total_lines || (summary.roll_lines || 0) + (summary.bulk_lines || 0))
    return (
        <button onClick={onClick} className="w-full text-left rounded-xl border border-slate-200 bg-white p-3 shadow-sm hover:shadow-md hover:border-blue-300">
            <div className="flex items-start justify-between gap-2">
                <div className="font-mono text-xs font-bold text-slate-900">{c.dc_no || `${c.id.substring(0, 8)}…`}</div>
                <div className="flex items-center gap-1">
                    {c.is_system_generated && <span className="rounded-md bg-blue-50 px-1.5 py-0.5 text-[9px] font-bold text-blue-700 ring-1 ring-blue-200">AUTO</span>}
                    <span className={cn("rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase ring-1", statusBadge(c.status))}>{c.status}</span>
                </div>
            </div>
            <div className="mt-2 flex items-center gap-2 text-[11px] font-bold text-slate-700">
                <Factory className="h-3 w-3 text-slate-400" />
                <span className="truncate">{c.from_plant_name}</span>
                <ArrowRight className="h-3 w-3 text-blue-500" />
                <span className="truncate">{c.to_plant_name}</span>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-1.5 text-[10px]">
                <Pill tone="slate" label="Lines" value={`${lines}`} />
                <Pill tone="blue" label="Out" value={`${dispatchedKg.toFixed(1)}kg`} />
                <Pill tone="emerald" label="In" value={`${receivedKg.toFixed(1)}kg`} />
            </div>
            {(c.vehicle_no || c.transporter_name) && (
                <div className="mt-2 truncate text-[10px] text-slate-500"><Truck className="inline-block h-3 w-3 mr-1 -mt-0.5" />{c.vehicle_no || "—"} · {c.transporter_name || "—"}</div>
            )}
            <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400">
                <span>{fmtDate(c.created_at)}</span>
                <span className="inline-flex items-center gap-0.5 font-bold text-blue-600 hover:underline">Details <ArrowRight className="h-3 w-3" /></span>
            </div>
        </button>
    )
}

function Pill({ tone, label, value }: { tone: "slate" | "blue" | "emerald"; label: string; value: string }) {
    const TONE = {
        slate: "bg-slate-50 text-slate-700 ring-slate-200",
        blue: "bg-blue-50 text-blue-800 ring-blue-200",
        emerald: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    }[tone]
    return (
        <div className={cn("flex flex-col items-center rounded-md px-1.5 py-1 ring-1", TONE)}>
            <span className="text-[8px] font-black uppercase opacity-70">{label}</span>
            <span className="font-mono text-[10px] font-bold">{value}</span>
        </div>
    )
}

function DetailDrawer({ challan, onClose }: { challan: DeliveryChallan; onClose: () => void }) {
    const summary = challan.transfer_summary || ({} as any)
    return (
        <div className="fixed inset-0 z-40 flex justify-end" onClick={onClose}>
            <div className="absolute inset-0 bg-black/40" />
            <div className="relative z-50 h-full w-full max-w-lg overflow-y-auto border-l border-slate-200 bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="sticky top-0 z-10 border-b border-slate-100 bg-gradient-to-r from-blue-50 via-white to-white px-5 py-4">
                    <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-blue-700">Inter-plant DC</div>
                            <div className="font-display text-lg font-bold text-slate-900">{challan.dc_no || challan.id.substring(0, 8)}</div>
                            <div className="mt-1 flex items-center gap-2 text-xs font-bold text-slate-700">
                                <span>{challan.from_plant_name}</span>
                                <ArrowRight className="h-3 w-3 text-blue-500" />
                                <span>{challan.to_plant_name}</span>
                            </div>
                        </div>
                        <button onClick={onClose} className="rounded-lg p-1 hover:bg-slate-100"><X className="h-4 w-4 text-slate-500" /></button>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-1.5">
                        <span className={cn("rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ring-1", statusBadge(challan.status))}>{challan.status}</span>
                        {challan.is_system_generated && <span className="rounded-md bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700 ring-1 ring-blue-200">AUTO</span>}
                    </div>
                </div>

                <div className="px-5 py-4 space-y-4">
                    {/* Summary stats */}
                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                        <Stat label="Lines" value={`${summary.total_lines || 0}`} />
                        <Stat label="Roll lines" value={`${summary.roll_lines || 0}`} />
                        <Stat label="Bulk lines" value={`${summary.bulk_lines || 0}`} />
                        <Stat label="Dispatched" value={fmtKg(summary.dispatched_total_kg, 1)} tone="blue" />
                        <Stat label="Received" value={fmtKg(summary.received_total_kg, 1)} tone="emerald" />
                        <Stat label="Variance" value={fmtKg(Number(summary.dispatched_total_kg || 0) - Number(summary.received_total_kg || 0), 1)} tone="rose" />
                    </div>

                    {/* Logistics */}
                    <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500 mb-2">Logistics</div>
                        <div className="grid grid-cols-2 gap-2 text-[11px]">
                            <Field label="Vehicle" value={challan.vehicle_no || "—"} />
                            <Field label="Transporter" value={challan.transporter_name || "—"} />
                            <Field label="Driver" value={challan.driver_name || "—"} />
                            <Field label="LR #" value={challan.lr_number || "—"} />
                        </div>
                    </div>

                    {/* Timeline */}
                    <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500 mb-2">Lifecycle</div>
                        <ol className="relative ml-3 border-l-2 border-slate-200 space-y-3">
                            <Phase label="Created" date={challan.created_at} done />
                            <Phase label="Dispatched" date={challan.dispatched_at} done={Boolean(challan.dispatched_at)} />
                            <Phase label="Received" date={challan.received_at} done={Boolean(challan.received_at)} />
                        </ol>
                    </div>

                    {/* Items */}
                    {Array.isArray(challan.item_preview) && challan.item_preview.length > 0 && (
                        <div>
                            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-500 mb-2">Lines preview</div>
                            <div className="space-y-1.5">
                                {challan.item_preview.map((line: any, i: number) => (
                                    <div key={i} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-1.5 text-[11px]">
                                        <div className="min-w-0">
                                            <div className="font-mono font-bold text-slate-900 truncate">{line.line_type}{line.roll_role ? ` · ${line.roll_role}` : ""} · {line.roll_label || line.material_name || "—"}</div>
                                        </div>
                                        <div className="font-mono font-bold text-slate-700 flex-none">{Number(line.dispatched_qty_kg || 0).toFixed(2)} kg</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center gap-2">
                        <Link href={`/inter-plant/print/${challan.id}`} target="_blank" className="inline-flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-[11px] font-bold text-slate-700 hover:bg-slate-200">
                            <Printer className="h-3 w-3" /> Print DC
                        </Link>
                        <Link href="/inventory/inter-plant" className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-[11px] font-bold text-white hover:bg-blue-700">
                            Open transfer form <ArrowRight className="h-3 w-3" />
                        </Link>
                    </div>
                </div>
            </div>
        </div>
    )
}

function Field({ label, value }: { label: string; value: any }) {
    return (
        <div className="rounded-lg bg-slate-50/60 px-2.5 py-1.5 ring-1 ring-slate-100">
            <div className="text-[9px] font-black uppercase tracking-wider text-slate-500">{label}</div>
            <div className="mt-0.5 text-xs font-bold text-slate-800 truncate">{value || "—"}</div>
        </div>
    )
}

function Stat({ label, value, tone = "slate" }: { label: string; value: string; tone?: "slate" | "blue" | "emerald" | "rose" }) {
    const TONE = {
        slate: "bg-slate-50 text-slate-900 ring-slate-200",
        blue: "bg-blue-50 text-blue-900 ring-blue-200",
        emerald: "bg-emerald-50 text-emerald-900 ring-emerald-200",
        rose: "bg-rose-50 text-rose-900 ring-rose-200",
    }[tone]
    return (
        <div className={cn("rounded-lg px-2.5 py-1.5 ring-1", TONE)}>
            <div className="text-[9px] font-black uppercase tracking-wider opacity-70">{label}</div>
            <div className="mt-0.5 font-mono text-sm font-bold">{value}</div>
        </div>
    )
}

function Phase({ label, date, done }: { label: string; date?: string | null; done: boolean }) {
    return (
        <li className="ml-4">
            <span className={cn("absolute -left-[7px] mt-1 h-3 w-3 rounded-full ring-4 ring-white", done ? "bg-emerald-500" : "bg-slate-300")} />
            <div className="text-xs font-bold text-slate-800">{label}</div>
            <div className="text-[10px] text-slate-500">{fmtDate(date)}</div>
        </li>
    )
}

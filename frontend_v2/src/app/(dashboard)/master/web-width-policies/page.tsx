"use client"

import * as React from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { Plus, Scissors, Search, AlertTriangle, CheckCircle2 } from "lucide-react"

import { GradientHero } from "@/components/erp/gradient-hero"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { computeWebWidthPlan, webWidthPolicyService, type WebWidthPolicy } from "@/services/web-width-policy"

export default function WebWidthPolicyListPage() {
    const [q, setQ] = React.useState("")
    const { data: rows = [], isLoading } = useQuery({
        queryKey: ["web-width-policies"],
        queryFn: () => webWidthPolicyService.list(),
        staleTime: 30_000,
    })

    const filtered = React.useMemo(() => {
        const needle = q.trim().toLowerCase()
        if (!needle) return rows
        return rows.filter((r) =>
            [r.code, r.name, r.description].filter(Boolean).some((v) => String(v).toLowerCase().includes(needle)),
        )
    }, [rows, q])

    return (
        <div className="min-h-screen bg-gradient-to-b from-slate-50/80 via-white to-slate-50/40 px-4 py-4 sm:px-6">
            <GradientHero
                palette="violet"
                eyebrow="MASTER · WEB-WIDTH POLICIES"
                title="Lane-up and parent-web rules"
                subtitle="Controls which lane counts are allowed, how child pouch width becomes parent web width, and how WCM treats slit remainders. Scope policies globally or to product kind, product master, pouch style, process, or machine."
                chips={[
                    { icon: <Scissors className="h-4 w-4" />, label: "Policies", value: String(rows.length), tone: "violet" },
                    { icon: <CheckCircle2 className="h-4 w-4" />, label: "Default", value: rows.find((r) => r.is_default)?.code || "none", tone: "info" },
                ]}
                actions={
                    <Link href="/master/web-width-policies/new">
                        <Button className="bg-surface-1 text-violet-700 hover:bg-white/90">
                            <Plus className="mr-1.5 h-4 w-4" /> New policy
                        </Button>
                    </Link>
                }
            />

            <div className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50/40 px-4 py-3 text-[12px] text-indigo-900">
                <strong>Where this is used:</strong>{" "}
                Sales-order lines use the effective policy to validate lane-up and calculate planned parent width.
                WCM uses the same policy for remainder keep/scrap decisions and candidate previews.
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                <div className="relative w-72">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-4" />
                    <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="pl-9" />
                </div>
                <div className="text-[12px] text-slate-500">Showing <b>{filtered.length}</b> of {rows.length}</div>
            </div>

            <section className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-surface-1 shadow-sm">
                {isLoading ? (
                    <div className="p-10 text-center text-sm text-slate-500">Loading…</div>
                ) : filtered.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 p-10 text-center text-slate-500">
                        <AlertTriangle className="h-6 w-6 text-amber-500" />
                        <div className="text-sm">No policies match.</div>
                    </div>
                ) : (
                    <table className="w-full text-[12px]">
                        <thead className="bg-slate-50 text-left text-[10px] font-black uppercase tracking-wider text-content-3">
                            <tr>
                                <th className="px-4 py-2">Code</th>
                                <th className="px-4 py-2">Name</th>
                                <th className="px-4 py-2">Scope</th>
                                <th className="px-4 py-2">Lanes</th>
                                <th className="px-4 py-2">Parent strategy</th>
                                <th className="px-4 py-2">440 mm sample</th>
                                <th className="px-4 py-2">Remainder</th>
                                <th className="px-4 py-2">Status</th>
                                <th className="px-4 py-2"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {filtered.map((p) => (
                                <Row key={p.id} p={p} />
                            ))}
                        </tbody>
                    </table>
                )}
            </section>
        </div>
    )
}

function Row({ p }: { p: WebWidthPolicy }) {
    const trim = p.slitting_waste_rule || {}
    const lane = (p.allowed_lanes || [2]).includes(2) ? 2 : (p.allowed_lanes || [1])[0] || 1
    const plan = computeWebWidthPlan(440, lane, p)
    return (
        <tr className="hover:bg-violet-50/40">
            <td className="px-4 py-2 font-mono font-bold text-violet-700">{p.code}</td>
            <td className="px-4 py-2">{p.name}</td>
            <td className="px-4 py-2">
                <div className="font-mono text-[10px] font-bold text-slate-700">{p.scope_type || "GLOBAL"}</div>
                {p.scope_ref ? <div className="max-w-[130px] truncate font-mono text-[10px] text-content-4">{p.scope_ref}</div> : null}
            </td>
            <td className="px-4 py-2">
                <div className="flex flex-wrap gap-1">
                    {(p.allowed_lanes || []).map((l) => (
                        <span key={l} className="rounded-md bg-violet-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-violet-800">{l}-up</span>
                    ))}
                </div>
            </td>
            <td className="px-4 py-2">
                <div className="font-mono text-[10px] font-bold text-slate-700">{p.parent_width_strategy || "CALCULATED"}</div>
                <div className="font-mono text-[10px] text-slate-500">{trim.inter_cut_mm ?? 5} cut · {trim.edge_trim_mm ?? 2} edge</div>
            </td>
            <td className="px-4 py-2">
                <div className="font-mono text-[11px] font-bold text-slate-900">{lane}-up → {Math.round(plan.planned_parent_width_mm)} mm</div>
                {plan.selected_standard_parent_width_mm ? <div className="text-[10px] text-violet-600">std width selected</div> : <div className="text-[10px] text-content-4">calculated parent</div>}
            </td>
            <td className="px-4 py-2 font-mono text-[10px]">
                {p.min_remainder_mm} mm min · {p.prefer_remainder_first ? "prefer rem" : "fresh first"}
            </td>
            <td className="px-4 py-2">
                <div className="flex flex-wrap gap-1">
                {p.is_default ? (
                    <Badge className="bg-emerald-100 text-[10px] text-emerald-800 hover:bg-emerald-100">default</Badge>
                ) : (
                    null
                )}
                {p.deprecated ? <Badge className="bg-rose-100 text-[10px] text-rose-800 hover:bg-rose-100">disabled</Badge> : <Badge className="bg-slate-100 text-[10px] text-slate-700 hover:bg-slate-100">active</Badge>}
                </div>
            </td>
            <td className="px-4 py-2 text-right">
                <Link
                    href={`/master/web-width-policies/${p.id}`}
                    className={cn("inline-flex items-center rounded-lg px-2.5 py-1 text-[11px] font-bold", "bg-violet-600 text-white hover:bg-violet-700")}
                >
                    Open
                </Link>
            </td>
        </tr>
    )
}

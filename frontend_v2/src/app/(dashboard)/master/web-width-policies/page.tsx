"use client"

import * as React from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { Plus, Scissors, Search, AlertTriangle, CheckCircle2 } from "lucide-react"

import { GradientHero } from "@/components/erp-v3/gradient-hero"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { webWidthPolicyService, type WebWidthPolicy } from "@/services/web-width-policy"

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
                title="What production is allowed to do"
                subtitle="Declares the lane counts, slit trim rules, and remainder thresholds that govern how a sales order's lane choice becomes an actual jumbo on the floor. Attach a policy to a route; the WCM picker reads these rules at allocation time."
                chips={[
                    { icon: <Scissors className="h-4 w-4" />, label: "Policies", value: String(rows.length), tone: "violet" },
                    { icon: <CheckCircle2 className="h-4 w-4" />, label: "Default", value: rows.find((r) => r.is_default)?.code || "none", tone: "info" },
                ]}
                actions={
                    <Link href="/master/web-width-policies/new">
                        <Button className="bg-white text-violet-700 hover:bg-white/90">
                            <Plus className="mr-1.5 h-4 w-4" /> New policy
                        </Button>
                    </Link>
                }
            />

            <div className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50/40 px-4 py-3 text-[12px] text-indigo-900">
                <strong>Where this is used:</strong>{" "}
                Sales-order create page validates lane choice against the default policy. WCM Roll Picker uses these
                rules to compute slit-confirm previews + decide remainder vs scrap. To change the slitter trim, min
                remainder, or allowed lanes, edit the default policy below.
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                <div className="relative w-72">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="pl-9" />
                </div>
                <div className="text-[12px] text-slate-500">Showing <b>{filtered.length}</b> of {rows.length}</div>
            </div>

            <section className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                {isLoading ? (
                    <div className="p-10 text-center text-sm text-slate-500">Loading…</div>
                ) : filtered.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 p-10 text-center text-slate-500">
                        <AlertTriangle className="h-6 w-6 text-amber-500" />
                        <div className="text-sm">No policies match.</div>
                    </div>
                ) : (
                    <table className="w-full text-[12px]">
                        <thead className="bg-slate-50 text-left text-[10px] font-black uppercase tracking-wider text-slate-600">
                            <tr>
                                <th className="px-4 py-2">Code</th>
                                <th className="px-4 py-2">Name</th>
                                <th className="px-4 py-2">Lanes</th>
                                <th className="px-4 py-2">Trim</th>
                                <th className="px-4 py-2">Min remainder</th>
                                <th className="px-4 py-2">Default</th>
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
    return (
        <tr className="hover:bg-violet-50/40">
            <td className="px-4 py-2 font-mono font-bold text-violet-700">{p.code}</td>
            <td className="px-4 py-2">{p.name}</td>
            <td className="px-4 py-2">
                <div className="flex flex-wrap gap-1">
                    {(p.allowed_lanes || []).map((l) => (
                        <span key={l} className="rounded-md bg-violet-100 px-1.5 py-0.5 font-mono text-[10px] font-bold text-violet-800">{l}-up</span>
                    ))}
                </div>
            </td>
            <td className="px-4 py-2 font-mono text-[10px] text-slate-600">
                {trim.inter_cut_mm ?? 5} mm cut · {trim.edge_trim_mm ?? 2} mm edge
            </td>
            <td className="px-4 py-2 font-mono">{p.min_remainder_mm} mm</td>
            <td className="px-4 py-2">
                {p.is_default ? (
                    <Badge className="bg-emerald-100 text-[10px] text-emerald-800 hover:bg-emerald-100">default</Badge>
                ) : (
                    <span className="text-[10px] text-slate-400">—</span>
                )}
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

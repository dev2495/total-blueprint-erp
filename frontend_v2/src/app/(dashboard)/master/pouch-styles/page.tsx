"use client"

import * as React from "react"
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { Plus, Search, Lock, AlertTriangle, Sparkles } from "lucide-react"

import { GradientHero } from "@/components/erp/gradient-hero"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { pouchStyleService, FORMULA_KIND_LABELS, type PouchStyle } from "@/services/pouch-style"

export default function PouchStylesListPage() {
    const [q, setQ] = React.useState("")
    const [showDisabled, setShowDisabled] = React.useState(false)
    const { data: styles = [], isLoading } = useQuery({
        queryKey: ["pouch-styles"],
        queryFn: () => pouchStyleService.list({ page_size: 200 }),
        staleTime: 30_000,
    })

    const filtered = React.useMemo(() => {
        const needle = q.trim().toLowerCase()
        let rows = styles
        if (!showDisabled) rows = rows.filter((s) => !s.deprecated)
        if (!needle) return rows
        return rows.filter((s) =>
            [s.code, s.name, s.description, s.formula_kind]
                .filter(Boolean)
                .some((v) => String(v).toLowerCase().includes(needle)),
        )
    }, [styles, q, showDisabled])

    const lockedCount = styles.filter((s) => s.locked).length
    const disabledCount = styles.filter((s) => s.deprecated).length
    const usedSum = styles.reduce((sum, s) => sum + (s.sizes_count || 0), 0)

    return (
        <div className="min-h-screen bg-gradient-to-b from-slate-50/80 via-white to-slate-50/40 px-4 py-4 sm:px-6">
            <GradientHero
                palette="indigo"
                eyebrow="MASTER · POUCH STYLES"
                title="Pouch shapes + formulas"
                subtitle="Each style declares which input fields apply and how to compute the target child web width. Versioned — old products keep their snapshot formula."
                chips={[
                    { icon: <Sparkles className="h-4 w-4" />, label: "Styles", value: String(styles.length), tone: "violet" },
                    { icon: <Lock className="h-4 w-4" />, label: "Locked", value: String(lockedCount), tone: "info" },
                    { icon: <Sparkles className="h-4 w-4" />, label: "Used by sizes", value: String(usedSum), tone: "ok" },
                ]}
                actions={
                    <Link href="/master/pouch-styles/new">
                        <Button className="bg-white text-indigo-700 hover:bg-white/90">
                            <Plus className="mr-1.5 h-4 w-4" /> New pouch style
                        </Button>
                    </Link>
                }
            />

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                <div className="relative w-72">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <Input
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        placeholder="Search code, name or formula…"
                        className="pl-9"
                    />
                </div>
                <div className="flex items-center gap-3 text-[12px] text-slate-500">
                    <label className="flex items-center gap-1.5 text-[11px] font-bold">
                        <input type="checkbox" checked={showDisabled} onChange={(e) => setShowDisabled(e.target.checked)} />
                        Show disabled ({disabledCount})
                    </label>
                    <span>Showing <b className="text-slate-900">{filtered.length}</b> of {styles.length}</span>
                </div>
            </div>

            <section className="mt-3 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                {isLoading ? (
                    <div className="p-10 text-center text-sm text-slate-500">Loading pouch styles…</div>
                ) : filtered.length === 0 ? (
                    <div className="flex flex-col items-center gap-3 p-10 text-center">
                        <div className="text-3xl">🛍️</div>
                        <div>
                            <div className="text-sm font-bold text-slate-800">{styles.length === 0 ? "No pouch styles yet" : "No styles match your search"}</div>
                            <p className="mt-1 max-w-[420px] text-[11px] text-slate-500">
                                {styles.length === 0
                                    ? "Build your first pouch style from scratch — pick the fields you need (W, H, gusset, flap…), set how each affects the roll width, save."
                                    : "Try a different search term or clear the filter."}
                            </p>
                        </div>
                        {styles.length === 0 ? (
                            <Link href="/master/pouch-styles/new">
                                <Button className="bg-indigo-600 text-white hover:bg-indigo-700"><Plus className="mr-1.5 h-4 w-4" /> Build first pouch style</Button>
                            </Link>
                        ) : null}
                    </div>
                ) : (
                    <table className="w-full text-[12px]">
                        <thead className="bg-slate-50 text-left text-[10px] font-black uppercase tracking-wider text-slate-600">
                            <tr>
                                <th className="px-4 py-2">Code</th>
                                <th className="px-4 py-2">Name</th>
                                <th className="px-4 py-2">Formula</th>
                                <th className="px-4 py-2">Faces</th>
                                <th className="px-4 py-2">v</th>
                                <th className="px-4 py-2">Sizes</th>
                                <th className="px-4 py-2">Status</th>
                                <th className="px-4 py-2"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {filtered.map((s) => (
                                <PouchRow key={s.id} s={s} />
                            ))}
                        </tbody>
                    </table>
                )}
            </section>
        </div>
    )
}

function PouchRow({ s }: { s: PouchStyle }) {
    return (
        <tr className="hover:bg-indigo-50/40">
            <td className="px-4 py-2 font-mono font-bold text-indigo-700">
                <span className="mr-1.5">{s.visual_emoji}</span>
                {s.code}
            </td>
            <td className="px-4 py-2">{s.name}</td>
            <td className="px-4 py-2">
                <span className="font-mono text-[10px] text-slate-700">{s.formula_kind}</span>
                <div className="text-[10px] text-slate-400">{s.formula_expression || FORMULA_KIND_LABELS[s.formula_kind]}</div>
            </td>
            <td className="px-4 py-2">{s.faces}</td>
            <td className="px-4 py-2 font-bold">{s.version}</td>
            <td className="px-4 py-2">{s.sizes_count ?? 0}</td>
            <td className="px-4 py-2">
                <div className="flex flex-wrap gap-1">
                    {s.deprecated ? (
                        <Badge variant="outline" className="border-rose-200 bg-rose-50 text-[10px] text-rose-700">disabled</Badge>
                    ) : s.locked ? (
                        <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700">
                            <Lock className="mr-0.5 h-2.5 w-2.5" /> locked
                        </Badge>
                    ) : (
                        <Badge variant="outline" className="border-amber-200 bg-amber-50 text-[10px] text-amber-700">draft</Badge>
                    )}
                </div>
            </td>
            <td className="px-4 py-2 text-right">
                <Link
                    href={`/master/pouch-styles/${s.id}`}
                    className={cn(
                        "inline-flex items-center rounded-lg px-2.5 py-1 text-[11px] font-bold",
                        "bg-indigo-600 text-white hover:bg-indigo-700",
                    )}
                >
                    Open
                </Link>
            </td>
        </tr>
    )
}

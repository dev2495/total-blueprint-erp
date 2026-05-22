"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2, Save, ArrowLeft, ShoppingBag, Boxes, SlidersHorizontal } from "lucide-react"

import { GradientHero } from "@/components/erp-v3/gradient-hero"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { useToast } from "@/hooks/use-toast"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { tradingGoodService, type TradingGood, type TradingGoodPayload, type TradingGoodStockRow } from "@/services/trading-goods"
import Link from "next/link"

type Props = {
    mode: "new" | "edit"
    id?: string
}

const UOM_OPTIONS = [
    { value: "PCS", label: "Pieces" },
    { value: "KG", label: "Kilograms" },
    { value: "METER", label: "Meters" },
    { value: "ROLL", label: "Rolls" },
    { value: "BOX", label: "Boxes" },
]

const TRADE_TYPE_OPTIONS = [
    { value: "READY_POUCH", label: "Ready pouch" },
    { value: "READY_ROLL", label: "Ready roll" },
    { value: "PACKAGING", label: "Packing item" },
    { value: "RAW_MATERIAL", label: "Raw material" },
    { value: "OTHER", label: "Other" },
]

export function TradingGoodEditor({ mode, id }: Props) {
    const router = useRouter()
    const { toast } = useToast()
    const qc = useQueryClient()

    const { data: existing, isLoading: loadingExisting } = useQuery({
        queryKey: ["trading-good", id],
        queryFn: () => tradingGoodService.get(id!),
        enabled: mode === "edit" && !!id,
    })

    const [form, setForm] = React.useState<TradingGoodPayload>({
        code: "",
        name: "",
        trade_type: "READY_POUCH",
        description: "",
        base_uom: "PCS",
        hsn_code: "",
        default_gst_pct: 18,
        default_sale_rate: null,
        default_buy_rate: null,
        is_active: true,
        notes: "",
    })

    React.useEffect(() => {
        if (existing) {
            setForm({
                code: existing.code,
                name: existing.name,
                trade_type: existing.trade_type || "READY_POUCH",
                description: existing.description || "",
                base_uom: existing.base_uom,
                hsn_code: existing.hsn_code || "",
                default_gst_pct: existing.default_gst_pct,
                default_sale_rate: existing.default_sale_rate,
                default_buy_rate: existing.default_buy_rate,
                is_active: existing.is_active,
                notes: existing.notes || "",
            })
        }
    }, [existing])

    const mut = useMutation({
        mutationFn: async (payload: TradingGoodPayload) => {
            if (mode === "edit" && id) return tradingGoodService.update(id, payload)
            return tradingGoodService.create(payload)
        },
        onSuccess: (saved) => {
            toast({ title: "Trading good saved", description: `${saved.code} · ${saved.name}` })
            qc.invalidateQueries({ queryKey: ["trading-goods"] })
            qc.invalidateQueries({ queryKey: ["trading-good", saved.id] })
            router.push(`/master/trading-goods/${saved.id}`)
        },
        onError: (err: any) => {
            const msg = err?.response?.data?.detail ||
                JSON.stringify(err?.response?.data || err?.message || "Save failed")
            toast({ title: "Save failed", description: msg, variant: "destructive" })
        },
    })

    const onSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        const payload: TradingGoodPayload = {
            ...form,
            code: form.code?.trim() || "",
            name: form.name?.trim() || "",
            default_gst_pct: Number(form.default_gst_pct) || 0,
            default_sale_rate:
                form.default_sale_rate === null || form.default_sale_rate === undefined || form.default_sale_rate === ("" as any)
                    ? null
                    : Number(form.default_sale_rate),
            default_buy_rate:
                form.default_buy_rate === null || form.default_buy_rate === undefined || form.default_buy_rate === ("" as any)
                    ? null
                    : Number(form.default_buy_rate),
        }
        if (!payload.code || !payload.name) {
            toast({ title: "Missing fields", description: "Code and name are required", variant: "destructive" })
            return
        }
        mut.mutate(payload)
    }

    return (
        <div className="min-h-screen bg-gradient-to-b from-emerald-50/40 via-white to-slate-50/40 px-4 py-4 sm:px-6">
            <GradientHero
                palette="emerald"
                eyebrow={mode === "new" ? "MASTER · TRADING GOODS · NEW" : "MASTER · TRADING GOODS · EDIT"}
                title={mode === "new" ? "Add a trading good" : (existing?.name || "Edit trading good")}
                subtitle="Items you resell as-is. Default rate and GST flow into Trade Orders, but the operator can override per line."
                actions={
                    <Link href="/master/trading-goods">
                        <Button variant="secondary" className="bg-white/95 text-emerald-700 hover:bg-white">
                            <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to list
                        </Button>
                    </Link>
                }
            />

            {loadingExisting ? (
                <div className="mt-6 grid place-items-center p-16 text-sm text-slate-500">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
                </div>
            ) : (
                <form onSubmit={onSubmit} className="mt-6 grid gap-6 lg:grid-cols-3">
                    <section className="rounded-3xl bg-white p-6 shadow-[0_20px_60px_-30px_rgba(15,23,42,0.25)] ring-1 ring-slate-200/60 lg:col-span-2">
                        <header className="mb-4 flex items-center gap-2">
                            <div className="grid h-9 w-9 place-items-center rounded-2xl bg-emerald-100 text-emerald-700">
                                <ShoppingBag className="h-4 w-4" />
                            </div>
                            <div>
                                <h3 className="text-sm font-bold text-slate-900">Item identity</h3>
                                <p className="text-[11px] text-slate-500">Code, name and stocking unit</p>
                            </div>
                        </header>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <Field label="Code *">
                                <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="e.g. TG-RDY-PCH-100" />
                            </Field>
                            <Field label="Name *">
                                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ready-made pouch — 100g" />
                            </Field>
                            <Field label="Base UOM">
                                <Select value={form.base_uom} onValueChange={(v) => setForm({ ...form, base_uom: v })}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {UOM_OPTIONS.map((u) => (
                                            <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </Field>
                            <Field label="Trade form">
                                <Select value={(form as any).trade_type || "READY_POUCH"} onValueChange={(v) => setForm({ ...form, trade_type: v })}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {TRADE_TYPE_OPTIONS.map((option) => (
                                            <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </Field>
                            <Field label="HSN code">
                                <Input value={form.hsn_code || ""} onChange={(e) => setForm({ ...form, hsn_code: e.target.value })} placeholder="e.g. 3923" />
                            </Field>
                            <Field label="Description" className="sm:col-span-2">
                                <Textarea
                                    value={form.description || ""}
                                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                                    rows={2}
                                    placeholder="Short description (optional)"
                                />
                            </Field>
                        </div>
                    </section>

                    <section className="rounded-3xl bg-white p-6 shadow-[0_20px_60px_-30px_rgba(15,23,42,0.25)] ring-1 ring-slate-200/60">
                        <header className="mb-4">
                            <h3 className="text-sm font-bold text-slate-900">Pricing defaults</h3>
                            <p className="text-[11px] text-slate-500">Used to prefill Trade Order lines</p>
                        </header>
                        <div className="grid gap-4">
                            <Field label="Default GST %">
                                <Input
                                    type="number"
                                    step="0.01"
                                    value={form.default_gst_pct ?? 0}
                                    onChange={(e) => setForm({ ...form, default_gst_pct: Number(e.target.value) })}
                                />
                            </Field>
                            <Field label="Default sale rate (₹)">
                                <Input
                                    type="number"
                                    step="0.01"
                                    value={form.default_sale_rate ?? ""}
                                    onChange={(e) => setForm({ ...form, default_sale_rate: e.target.value === "" ? null : Number(e.target.value) })}
                                />
                            </Field>
                            <Field label="Default buy rate (₹)">
                                <Input
                                    type="number"
                                    step="0.01"
                                    value={form.default_buy_rate ?? ""}
                                    onChange={(e) => setForm({ ...form, default_buy_rate: e.target.value === "" ? null : Number(e.target.value) })}
                                />
                            </Field>
                        </div>
                    </section>

                    <section className="rounded-3xl bg-white p-6 shadow-[0_20px_60px_-30px_rgba(15,23,42,0.25)] ring-1 ring-slate-200/60 lg:col-span-2">
                        <header className="mb-4">
                            <h3 className="text-sm font-bold text-slate-900">Notes</h3>
                            <p className="text-[11px] text-slate-500">Internal notes — not visible to the customer</p>
                        </header>
                        <Textarea
                            value={form.notes || ""}
                            onChange={(e) => setForm({ ...form, notes: e.target.value })}
                            rows={3}
                            placeholder="Procurement source, vendor SKU, etc."
                        />
                    </section>

                    <section className="rounded-3xl bg-white p-6 shadow-[0_20px_60px_-30px_rgba(15,23,42,0.25)] ring-1 ring-slate-200/60">
                        <header className="mb-4">
                            <h3 className="text-sm font-bold text-slate-900">Status</h3>
                            <p className="text-[11px] text-slate-500">Inactive items are hidden from trade order pickers</p>
                        </header>
                        <label className="flex items-center justify-between rounded-2xl border border-slate-200 px-4 py-3">
                            <div>
                                <div className="text-sm font-bold text-slate-800">Active</div>
                                <div className="text-[11px] text-slate-500">Toggle off to retire</div>
                            </div>
                            <Switch
                                checked={!!form.is_active}
                                onCheckedChange={(v) => setForm({ ...form, is_active: v })}
                            />
                        </label>
                    </section>

                    <div className="flex items-center justify-end gap-3 lg:col-span-3">
                        <Link href="/master/trading-goods">
                            <Button type="button" variant="outline">Cancel</Button>
                        </Link>
                        <Button type="submit" disabled={mut.isPending} className="bg-emerald-600 text-white hover:bg-emerald-700">
                            {mut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                            {mode === "new" ? "Create trading good" : "Save changes"}
                        </Button>
                    </div>
                </form>
            )}

            {mode === "edit" && id && existing ? (
                <StockBreakdownCard
                    tradingGoodId={id}
                    baseUom={existing.base_uom || "PCS"}
                    stocks={existing.stocks || []}
                />
            ) : null}
        </div>
    )
}

// ── Read-only per-plant stock breakdown card ───────────────────────────────

function StockBreakdownCard({
    tradingGoodId,
    baseUom,
    stocks,
}: {
    tradingGoodId: string
    baseUom: string
    stocks: TradingGoodStockRow[]
}) {
    const total = stocks.reduce((s, r) => s + Number(r.qty || 0), 0)
    const adjustHref = `/inventory/adjustments/new?trading_good=${tradingGoodId}`

    return (
        <section className="mt-6 rounded-3xl bg-white p-6 shadow-[0_20px_60px_-30px_rgba(15,23,42,0.25)] ring-1 ring-slate-200/60">
            <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <div className="grid h-9 w-9 place-items-center rounded-2xl bg-violet-100 text-violet-700">
                        <Boxes className="h-4 w-4" />
                    </div>
                    <div>
                        <h3 className="font-display text-base font-bold text-slate-900">Stock by plant</h3>
                        <p className="text-[11px] text-slate-500">
                            Total <span className="font-mono font-bold text-slate-800">{total.toLocaleString()}</span> {baseUom}{" "}
                            across {stocks.length} plant{stocks.length === 1 ? "" : "s"}.{" "}
                            <span className="text-slate-400">Read-only — adjust via inventory workspace.</span>
                        </p>
                    </div>
                </div>
            </header>

            {stocks.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/50 p-8 text-center">
                    <Boxes className="mx-auto h-8 w-8 text-slate-400" />
                    <div className="mt-2 text-sm font-bold text-slate-700">No stock recorded yet</div>
                    <p className="mt-1 text-[11px] text-slate-500">
                        Seed opening stock via a Stock Adjustment in the inventory workspace.
                    </p>
                </div>
            ) : (
                <>
                    <div className="hidden overflow-hidden rounded-2xl border border-slate-200 sm:block">
                        <table className="w-full text-sm">
                            <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-600">
                                <tr>
                                    <th className="px-4 py-2 text-left font-bold">Plant</th>
                                    <th className="px-4 py-2 text-right font-bold">Qty</th>
                                    <th className="px-4 py-2 text-right font-bold">Avg cost</th>
                                    <th className="px-4 py-2 text-left font-bold">Updated</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {stocks.map((s) => {
                                    const qty = Number(s.qty || 0)
                                    const colorClass =
                                        qty > 0
                                            ? "text-emerald-700"
                                            : qty < 0
                                                ? "text-red-600"
                                                : "text-slate-500"
                                    return (
                                        <tr key={s.id}>
                                            <td className="px-4 py-3">
                                                <div className="text-sm font-bold text-slate-900">
                                                    {s.plant_name || "—"}
                                                </div>
                                                {s.plant_code ? (
                                                    <div className="font-mono text-[10px] text-slate-500">{s.plant_code}</div>
                                                ) : null}
                                            </td>
                                            <td className={`px-4 py-3 text-right font-mono font-bold ${colorClass}`}>
                                                {qty.toLocaleString()} <span className="text-[10px] text-slate-400">{baseUom}</span>
                                            </td>
                                            <td className="px-4 py-3 text-right font-mono text-slate-700">
                                                ₹ {Number(s.avg_cost || 0).toLocaleString()}
                                            </td>
                                            <td className="px-4 py-3 text-[11px] text-slate-500">
                                                {s.updated_at ? new Date(s.updated_at).toLocaleString() : "—"}
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>

                    {/* Mobile stacked cards */}
                    <div className="grid gap-2 sm:hidden">
                        {stocks.map((s) => {
                            const qty = Number(s.qty || 0)
                            const colorClass =
                                qty > 0 ? "text-emerald-700" : qty < 0 ? "text-red-600" : "text-slate-500"
                            return (
                                <article
                                    key={s.id}
                                    className="rounded-2xl border border-slate-200 bg-white p-4"
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <div>
                                            <div className="text-sm font-bold text-slate-900">{s.plant_name || "—"}</div>
                                            {s.plant_code ? (
                                                <div className="font-mono text-[10px] text-slate-500">{s.plant_code}</div>
                                            ) : null}
                                        </div>
                                        <div className={`font-mono text-base font-bold ${colorClass}`}>
                                            {qty.toLocaleString()} <span className="text-[10px] text-slate-400">{baseUom}</span>
                                        </div>
                                    </div>
                                    <div className="mt-2 text-[11px] text-slate-500">
                                        Avg ₹ {Number(s.avg_cost || 0).toLocaleString()}
                                    </div>
                                </article>
                            )
                        })}
                    </div>
                </>
            )}

            {/* CTA → inventory workspace */}
            <div className="mt-6 rounded-2xl border border-violet-200/70 bg-gradient-to-br from-violet-50 via-white to-indigo-50 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-violet-700">
                            <SlidersHorizontal className="h-3.5 w-3.5" /> Stock adjustments
                        </div>
                        <h4 className="mt-1 font-display text-sm font-bold text-slate-900">
                            Adjust stock from the inventory workspace
                        </h4>
                        <p className="mt-1 max-w-xl text-[11px] text-slate-600">
                            Stock changes here would skip the unified audit log. To correct quantities,
                            create a Stock Adjustment from the inventory team&apos;s workspace — same audit
                            trail as bulk, packaging and roll corrections.
                        </p>
                    </div>
                    <Link href={adjustHref}>
                        <Button className="bg-violet-600 text-white hover:bg-violet-700">
                            <SlidersHorizontal className="mr-1.5 h-4 w-4" /> Open Stock Adjustments →
                        </Button>
                    </Link>
                </div>
            </div>
        </section>
    )
}

function Field({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
    return (
        <div className={className}>
            <Label className="text-[11px] font-bold uppercase tracking-wider text-slate-600">{label}</Label>
            <div className="mt-1.5">{children}</div>
        </div>
    )
}

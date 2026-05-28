"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
    ArrowLeft,
    Loader2,
    Plus,
    Save,
    Trash2,
    Package,
    ShoppingBag,
    CheckCircle2,
    ChevronsUpDown,
    Check,
    Boxes,
    AlertCircle,
    MapPin,
} from "lucide-react"

import { GradientHero } from "@/components/erp/gradient-hero"
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { useToast } from "@/hooks/use-toast"

import { masterDataService } from "@/services/master-data"
import { factoryService } from "@/services/factory"
import {
    tradeOrderService,
    type TradeOrder,
    type TradeOrderItemOption,
    type TradeOrderPayload,
} from "@/services/trade-orders"

type Props = {
    mode: "new" | "edit"
    initialOrder?: TradeOrder
}

type LineDraft = {
    key: string
    line_no: number
    item_type: "INVENTORY_MATERIAL" | "TRADING_GOOD"
    pickerKey: string // composite "TG:<id>" or "IM:<id>"
    inventory_material_id: string | null
    trading_good_id: string | null
    description: string
    qty: number
    uom: string
    rate: number
    gst_pct: number
}

function makeKey() {
    return Math.random().toString(36).slice(2, 10)
}

function todayISO() {
    return new Date().toISOString().slice(0, 10)
}

export function TradeOrderForm({ mode, initialOrder }: Props) {
    const router = useRouter()
    const { toast } = useToast()
    const qc = useQueryClient()

    const { data: customers = [] } = useQuery({
        queryKey: ["customers-list"],
        queryFn: masterDataService.getCustomers,
        staleTime: 60_000,
    })
    const { data: plants = [] } = useQuery({
        queryKey: ["plants-list"],
        queryFn: factoryService.getPlants,
        staleTime: 60_000,
    })
    const [customerId, setCustomerId] = React.useState(initialOrder?.customer || "")
    const [plantId, setPlantId] = React.useState(initialOrder?.plant || "")
    const [orderDate, setOrderDate] = React.useState(initialOrder?.order_date || todayISO())
    const [notes, setNotes] = React.useState(initialOrder?.notes || "")
    const [lines, setLines] = React.useState<LineDraft[]>(() =>
        (initialOrder?.items || []).map((it, idx) => ({
            key: makeKey(),
            line_no: it.line_no || idx + 1,
            item_type: it.item_type,
            pickerKey:
                it.item_type === "TRADING_GOOD"
                    ? `TG:${it.trading_good || ""}`
                    : `IM:${it.inventory_material || ""}`,
            inventory_material_id: it.inventory_material || null,
            trading_good_id: it.trading_good || null,
            description: it.description || "",
            qty: Number(it.qty || 0),
            uom: it.uom || "PCS",
            rate: Number(it.rate || 0),
            gst_pct: Number(it.gst_pct || 0),
        })),
    )

    const { data: itemOptions = [], isFetching: loadingItemOptions } = useQuery({
        queryKey: ["trade-order-item-options", plantId],
        queryFn: () => tradeOrderService.itemOptions(plantId),
        enabled: !!plantId,
        staleTime: 30_000,
    })

    const itemOptionIndex = React.useMemo(() => {
        const m = new Map<string, TradeOrderItemOption>()
        itemOptions.forEach((option) => m.set(option.key, option))
        return m
    }, [itemOptions])

    const onPickItem = (lineKey: string, pickerKey: string) => {
        setLines((prev) =>
            prev.map((l) => {
                if (l.key !== lineKey) return l
                const option = itemOptionIndex.get(pickerKey)
                if (!option) return l
                if (option.item_type === "TRADING_GOOD") {
                    return {
                        ...l,
                        pickerKey,
                        item_type: "TRADING_GOOD",
                        trading_good_id: option.id,
                        inventory_material_id: null,
                        description: `${option.code} · ${option.name}`,
                        uom: option.base_uom || l.uom,
                        rate: option.default_sale_rate != null ? Number(option.default_sale_rate) : l.rate,
                        gst_pct: option.default_gst_pct != null ? Number(option.default_gst_pct) : l.gst_pct,
                    }
                }
                if (option.item_type === "INVENTORY_MATERIAL") {
                    return {
                        ...l,
                        pickerKey,
                        item_type: "INVENTORY_MATERIAL",
                        inventory_material_id: option.id,
                        trading_good_id: null,
                        description: `${option.code} · ${option.name}`,
                        uom: option.base_uom || l.uom,
                        gst_pct: option.default_gst_pct != null ? Number(option.default_gst_pct) : l.gst_pct,
                    }
                }
                return l
            }),
        )
    }

    const onPlantChange = (nextPlantId: string) => {
        setPlantId(nextPlantId)
        setLines((prev) =>
            prev.map((line) => ({
                ...line,
                pickerKey: "",
                inventory_material_id: null,
                trading_good_id: null,
                description: "",
                qty: 0,
                uom: "PCS",
            })),
        )
    }

    const addLine = () =>
        setLines((prev) => [
            ...prev,
            {
                key: makeKey(),
                line_no: prev.length + 1,
                item_type: "TRADING_GOOD",
                pickerKey: "",
                inventory_material_id: null,
                trading_good_id: null,
                description: "",
                qty: 0,
                uom: "PCS",
                rate: 0,
                gst_pct: 18,
            },
        ])

    const removeLine = (key: string) =>
        setLines((prev) => prev.filter((l) => l.key !== key).map((l, idx) => ({ ...l, line_no: idx + 1 })))

    const updateLine = (key: string, patch: Partial<LineDraft>) =>
        setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)))

    const totals = React.useMemo(() => {
        let sub = 0
        let gst = 0
        for (const l of lines) {
            const lineSub = (Number(l.qty) || 0) * (Number(l.rate) || 0)
            const lineGst = (lineSub * (Number(l.gst_pct) || 0)) / 100
            sub += lineSub
            gst += lineGst
        }
        return { subtotal: sub, gst_total: gst, grand: sub + gst }
    }, [lines])

    const selectedPlant = React.useMemo(
        () => plants.find((p: any) => String(p.id) === String(plantId)),
        [plants, plantId],
    )

    const lineIssues = React.useMemo(() => {
        const issues: string[] = []
        if (!plantId) issues.push("Pick a dispatch stock plant.")
        lines.forEach((line) => {
            const option = itemOptionIndex.get(line.pickerKey)
            if (!line.pickerKey) {
                issues.push(`Line #${line.line_no}: pick an item with available stock.`)
                return
            }
            if (!option) {
                issues.push(`Line #${line.line_no}: selected item is not available at this plant.`)
                return
            }
            const available = Number(option?.available_qty ?? Number.POSITIVE_INFINITY)
            if ((Number(line.qty) || 0) <= 0) issues.push(`Line #${line.line_no}: qty must be greater than zero.`)
            if (Number.isFinite(available) && Number(line.qty || 0) > available) {
                issues.push(`Line #${line.line_no}: qty is above available stock (${available} ${line.uom}).`)
            }
        })
        return issues
    }, [itemOptionIndex, lines, plantId])

    const buildPayload = (): TradeOrderPayload => ({
        customer: customerId,
        plant: plantId || null,
        order_date: orderDate,
        notes,
        items: lines.map((l) => ({
            line_no: l.line_no,
            item_type: l.item_type,
            inventory_material_id: l.item_type === "INVENTORY_MATERIAL" ? l.inventory_material_id : null,
            trading_good_id: l.item_type === "TRADING_GOOD" ? l.trading_good_id : null,
            description: l.description,
            qty: Number(l.qty) || 0,
            uom: l.uom,
            rate: Number(l.rate) || 0,
            gst_pct: Number(l.gst_pct) || 0,
        })) as any,
    })

    const saveMut = useMutation({
        mutationFn: async (opts: { confirm: boolean }) => {
            const payload = buildPayload()
            if (!payload.customer) throw new Error("Pick a customer")
            const order =
                mode === "edit" && initialOrder
                    ? await tradeOrderService.update(initialOrder.id, payload)
                    : await tradeOrderService.create(payload)
            if (opts.confirm) {
                return tradeOrderService.confirm(order.id)
            }
            return order
        },
        onSuccess: (order) => {
            qc.invalidateQueries({ queryKey: ["trade-orders"] })
            qc.invalidateQueries({ queryKey: ["trade-order", order.id] })
            toast({ title: "Trade order saved", description: `${order.code} · ${order.status}` })
            router.push(`/sales/trade-orders/${order.id}`)
        },
        onError: (err: any) => {
            const msg = err?.response?.data?.detail ||
                JSON.stringify(err?.response?.data || err?.message || "Save failed")
            toast({ title: "Save failed", description: msg, variant: "destructive" })
        },
    })

    return (
        <div className="min-h-screen bg-gradient-to-b from-rose-50/40 via-white to-slate-50/40 px-4 py-4 sm:px-6">
            <GradientHero
                palette="rose"
                eyebrow={mode === "new" ? "TRADE ORDERS · NEW" : `TRADE ORDERS · EDIT · ${initialOrder?.code || ""}`}
                title={mode === "new" ? "Create a trade order" : initialOrder?.code || "Edit trade order"}
                subtitle="Resell from stock — no production cycle. Lines can mix trading goods and sellable inventory materials."
                actions={
                    <Link href="/sales/trade-orders">
                        <Button variant="secondary" className="bg-white/95 text-rose-700 hover:bg-white">
                            <ArrowLeft className="mr-1.5 h-4 w-4" /> Back to orders
                        </Button>
                    </Link>
                }
            />

            <div className="mt-6 grid gap-6 lg:grid-cols-3">
                <section className="rounded-3xl bg-white p-6 shadow-[0_20px_60px_-30px_rgba(15,23,42,0.25)] ring-1 ring-slate-200/60 lg:col-span-2">
                    <header className="mb-4">
                        <h3 className="text-sm font-bold text-slate-900">Order header</h3>
                        <p className="text-[11px] text-slate-500">The dispatch stock plant controls item availability and where stock is consumed from.</p>
                    </header>
                    <div className="grid gap-4 sm:grid-cols-2">
                        <Field label="Customer *">
                            <Select value={customerId} onValueChange={setCustomerId}>
                                <SelectTrigger><SelectValue placeholder="Pick a customer" /></SelectTrigger>
                                <SelectContent>
                                    {customers.map((c) => (
                                        <SelectItem key={c.id} value={c.id}>
                                            {c.name} ({c.code})
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </Field>
                        <Field label="Dispatch stock plant *">
                            <Select value={plantId || ""} onValueChange={onPlantChange}>
                                <SelectTrigger><SelectValue placeholder="Pick stock plant" /></SelectTrigger>
                                <SelectContent>
                                    {plants.map((p: any) => (
                                        <SelectItem key={p.id} value={p.id}>
                                            {p.name} ({p.code})
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {selectedPlant ? (
                                <div className="mt-1 flex items-center gap-1.5 text-[10px] font-semibold text-emerald-700">
                                    <MapPin className="h-3 w-3" /> Picker will show only stock available at {selectedPlant.name}.
                                </div>
                            ) : null}
                        </Field>
                        <Field label="Order date">
                            <Input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
                        </Field>
                        <Field label="Notes" className="sm:col-span-2">
                            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Internal note (optional)" />
                        </Field>
                    </div>
                </section>

                <section className="rounded-3xl bg-gradient-to-br from-rose-500 via-orange-500 to-amber-500 p-6 text-white shadow-[0_20px_60px_-30px_rgba(244,63,94,0.45)]">
                    <header className="mb-4">
                        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-white/80">Totals</div>
                        <div className="text-sm font-bold">Live summary</div>
                    </header>
                    <dl className="space-y-3">
                        <Row label="Lines" value={String(lines.length)} />
                        <Row label="Subtotal" value={`₹ ${totals.subtotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} />
                        <Row label="GST" value={`₹ ${totals.gst_total.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} />
                        <div className="my-2 h-px bg-white/30" />
                        <Row label="Grand total" value={`₹ ${totals.grand.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} big />
                    </dl>
                </section>

                <section className="rounded-3xl bg-white p-6 shadow-[0_20px_60px_-30px_rgba(15,23,42,0.25)] ring-1 ring-slate-200/60 lg:col-span-3">
                    <header className="mb-4 flex items-center justify-between gap-2">
                        <div>
                            <h3 className="text-sm font-bold text-slate-900">Line items</h3>
                            <p className="text-[11px] text-slate-500">Add trading goods or sellable materials — qty × rate × GST</p>
                        </div>
                        <Button type="button" variant="outline" onClick={addLine} className="border-rose-300 text-rose-700 hover:bg-rose-50">
                            <Plus className="mr-1.5 h-4 w-4" /> Add line
                        </Button>
                    </header>
                    {!plantId ? (
                        <div className="mb-4 flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12px] text-amber-800">
                            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                            Pick a dispatch stock plant first. The item picker only shows goods that have stock available in that plant.
                        </div>
                    ) : lineIssues.length ? (
                        <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[12px] text-rose-700">
                            <div className="flex items-center gap-2 font-bold">
                                <AlertCircle className="h-4 w-4" /> Resolve before saving
                            </div>
                            <ul className="mt-1 list-disc space-y-0.5 pl-5">
                                {lineIssues.slice(0, 4).map((issue) => <li key={issue}>{issue}</li>)}
                            </ul>
                        </div>
                    ) : null}

                    {lines.length === 0 ? (
                        <button
                            type="button"
                            onClick={addLine}
                            className="grid w-full place-items-center gap-2 rounded-2xl border-2 border-dashed border-rose-200 bg-rose-50/30 p-8 text-center text-rose-600 hover:bg-rose-50/60"
                        >
                            <Plus className="h-5 w-5" />
                            <span className="text-sm font-bold">Add first line</span>
                        </button>
                    ) : (
                        <div className="space-y-3">
                            {lines.map((l) => {
                                const lineSub = (Number(l.qty) || 0) * (Number(l.rate) || 0)
                                const lineGst = (lineSub * (Number(l.gst_pct) || 0)) / 100
                                const lineTotal = lineSub + lineGst
                                const selectedOption = itemOptionIndex.get(l.pickerKey)
                                const availableQty = Number(selectedOption?.available_qty || 0)
                                const qtyTooHigh = !!selectedOption && Number(l.qty || 0) > availableQty
                                return (
                                    <article key={l.key} className="rounded-2xl border border-slate-200 bg-slate-50/40 p-4">
                                        <div className="grid gap-3 lg:grid-cols-12">
                                            <div className="lg:col-span-4">
                                                <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Line #{l.line_no} · Item</Label>
                                                <ItemPicker
                                                    value={l.pickerKey}
                                                    options={itemOptions}
                                                    disabled={!plantId || loadingItemOptions}
                                                    loading={loadingItemOptions}
                                                    onChange={(v) => onPickItem(l.key, v)}
                                                />
                                                <SelectedStockPanel option={selectedOption} fallbackDescription={l.description} />
                                                <Input
                                                    className="mt-2 bg-white text-[12px]"
                                                    placeholder="Description (optional override)"
                                                    value={l.description}
                                                    onChange={(e) => updateLine(l.key, { description: e.target.value })}
                                                />
                                            </div>

                                            <div className="lg:col-span-1">
                                                <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Qty</Label>
                                                <Input
                                                    type="number"
                                                    step="0.001"
                                                    min={0}
                                                    max={selectedOption ? availableQty : undefined}
                                                    value={l.qty}
                                                    onChange={(e) => updateLine(l.key, { qty: Number(e.target.value) })}
                                                    className={`mt-1 bg-white text-right font-mono ${qtyTooHigh ? "border-rose-300 text-rose-700" : ""}`}
                                                />
                                                {selectedOption ? (
                                                    <div className={`mt-1 text-[10px] font-semibold ${qtyTooHigh ? "text-rose-600" : "text-emerald-700"}`}>
                                                        Available {availableQty.toLocaleString()} {selectedOption.base_uom}
                                                    </div>
                                                ) : null}
                                            </div>
                                            <div className="lg:col-span-1">
                                                <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">UOM</Label>
                                                <Input
                                                    value={l.uom}
                                                    onChange={(e) => updateLine(l.key, { uom: e.target.value.toUpperCase() })}
                                                    className="mt-1 bg-white text-center font-mono uppercase"
                                                />
                                            </div>
                                            <div className="lg:col-span-2">
                                                <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Rate (₹)</Label>
                                                <Input
                                                    type="number"
                                                    step="0.01"
                                                    value={l.rate}
                                                    onChange={(e) => updateLine(l.key, { rate: Number(e.target.value) })}
                                                    className="mt-1 bg-white text-right font-mono"
                                                />
                                            </div>
                                            <div className="lg:col-span-1">
                                                <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">GST %</Label>
                                                <Input
                                                    type="number"
                                                    step="0.01"
                                                    value={l.gst_pct}
                                                    onChange={(e) => updateLine(l.key, { gst_pct: Number(e.target.value) })}
                                                    className="mt-1 bg-white text-right font-mono"
                                                />
                                            </div>
                                            <div className="lg:col-span-2 text-right">
                                                <Label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Line total</Label>
                                                <div className="mt-1 font-mono text-sm font-bold text-slate-900">
                                                    ₹ {lineTotal.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                                </div>
                                                <div className="text-[10px] text-slate-400">
                                                    sub ₹{lineSub.toFixed(2)} · gst ₹{lineGst.toFixed(2)}
                                                </div>
                                            </div>
                                            <div className="lg:col-span-1 flex items-end justify-end">
                                                <Button
                                                    type="button"
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => removeLine(l.key)}
                                                    className="text-rose-600 hover:bg-rose-50"
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </div>
                                    </article>
                                )
                            })}
                        </div>
                    )}
                </section>

                <div className="flex items-center justify-end gap-3 lg:col-span-3">
                    <Link href="/sales/trade-orders">
                        <Button type="button" variant="outline">Cancel</Button>
                    </Link>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={saveMut.isPending || !customerId || !plantId || lines.length === 0 || lineIssues.length > 0}
                        onClick={() => saveMut.mutate({ confirm: false })}
                    >
                        {saveMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                        Save draft
                    </Button>
                    <Button
                        type="button"
                        disabled={saveMut.isPending || lines.length === 0 || !customerId || !plantId || lineIssues.length > 0}
                        onClick={() => saveMut.mutate({ confirm: true })}
                        className="bg-rose-600 text-white hover:bg-rose-700"
                    >
                        {saveMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                        Save & confirm
                    </Button>
                </div>
            </div>
        </div>
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

function Row({ label, value, big }: { label: string; value: string; big?: boolean }) {
    return (
        <div className="flex items-baseline justify-between">
            <dt className="text-[11px] uppercase tracking-wider text-white/80">{label}</dt>
            <dd className={big ? "font-mono text-xl font-black" : "font-mono text-sm font-bold"}>{value}</dd>
        </div>
    )
}

function formatQty(value: number | string | null | undefined) {
    const n = Number(value || 0)
    return n.toLocaleString(undefined, { maximumFractionDigits: 3 })
}

function ItemPicker({
    value,
    options,
    disabled,
    loading,
    onChange,
}: {
    value: string
    options: TradeOrderItemOption[]
    disabled?: boolean
    loading?: boolean
    onChange: (value: string) => void
}) {
    const [open, setOpen] = React.useState(false)
    const selected = options.find((option) => option.key === value)
    const grouped = React.useMemo(() => {
        return options.reduce<Record<string, TradeOrderItemOption[]>>((acc, option) => {
            const key = option.category_label || option.category || "Other"
            acc[key] = acc[key] || []
            acc[key].push(option)
            return acc
        }, {})
    }, [options])

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    disabled={disabled}
                    className="mt-1 h-auto min-h-11 w-full justify-between bg-white px-3 py-2 text-left"
                >
                    {selected ? (
                        <span className="min-w-0">
                            <span className="block truncate text-[13px] font-bold text-slate-900">{selected.code} · {selected.name}</span>
                            <span className="block truncate text-[10px] font-semibold uppercase tracking-wider text-emerald-700">
                                {formatQty(selected.available_qty)} {selected.base_uom} available · {selected.category_label || selected.category}
                            </span>
                        </span>
                    ) : (
                        <span className="text-slate-500">{disabled ? "Pick stock plant first" : loading ? "Loading stock…" : "Search available stock item"}</span>
                    )}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 text-slate-400" />
                </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[min(760px,calc(100vw-2rem))] p-0">
                <Command>
                    <CommandInput placeholder="Search code, name, form, stock type…" />
                    <CommandList className="max-h-[420px]">
                        <CommandEmpty>No available stock item found for this plant.</CommandEmpty>
                        {Object.entries(grouped).map(([group, rows]) => (
                            <CommandGroup key={group} heading={group}>
                                {rows.map((option) => {
                                    const isTradingGood = option.item_type === "TRADING_GOOD"
                                    return (
                                        <CommandItem
                                            key={option.key}
                                            value={`${option.code} ${option.name} ${option.category_label || ""}`}
                                            onSelect={() => {
                                                onChange(option.key)
                                                setOpen(false)
                                            }}
                                            className="items-start gap-3 px-3 py-3"
                                        >
                                            <div className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl ${isTradingGood ? "bg-emerald-50 text-emerald-700" : "bg-violet-50 text-violet-700"}`}>
                                                {isTradingGood ? <ShoppingBag className="h-4 w-4" /> : <Package className="h-4 w-4" />}
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <span className="font-mono text-[12px] font-black text-slate-900">{option.code}</span>
                                                    <span className="text-[12px] font-bold text-slate-700">{option.name}</span>
                                                </div>
                                                <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] font-semibold text-slate-500">
                                                    <span>{option.item_type === "TRADING_GOOD" ? "Trading good" : "Sellable material"}</span>
                                                    <span>·</span>
                                                    <span>{option.plant_name || "Selected plant"}</span>
                                                    {option.parent_family_name ? <><span>·</span><span>{option.parent_family_name}</span></> : null}
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <div className="font-mono text-sm font-black text-emerald-700">
                                                    {formatQty(option.available_qty)}
                                                </div>
                                                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{option.base_uom}</div>
                                            </div>
                                            {value === option.key ? <Check className="mt-2 h-4 w-4 text-emerald-600" /> : null}
                                        </CommandItem>
                                    )
                                })}
                            </CommandGroup>
                        ))}
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    )
}

function SelectedStockPanel({
    option,
    fallbackDescription,
}: {
    option?: TradeOrderItemOption
    fallbackDescription?: string
}) {
    if (!option) {
        if (!fallbackDescription) return null
        return (
            <div className="mt-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-500">
                Saved item: {fallbackDescription}
            </div>
        )
    }
    const rows = option.stock_by_plant || []
    return (
        <div className="mt-2 rounded-xl border border-emerald-100 bg-emerald-50/50 px-3 py-2">
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-emerald-700">
                    <Boxes className="h-3.5 w-3.5" /> Stock truth
                </div>
                <div className="font-mono text-[11px] font-black text-emerald-800">
                    {formatQty(option.available_qty)} {option.base_uom} at {option.plant_code || "plant"}
                </div>
            </div>
            {rows.length ? (
                <div className="mt-2 grid gap-1.5">
                    {rows.slice(0, 3).map((row) => (
                        <div key={`${row.plant}-${row.stock_class}`} className="flex justify-between gap-3 rounded-lg bg-white/75 px-2 py-1 text-[10px]">
                            <span className="truncate font-semibold text-slate-600">
                                {row.plant_name || "Plant"} · {row.detail || row.stock_class || "stock"}
                            </span>
                            <span className="shrink-0 font-mono font-bold text-slate-900">
                                {formatQty(row.qty)} {row.uom || option.base_uom}
                            </span>
                        </div>
                    ))}
                </div>
            ) : null}
        </div>
    )
}

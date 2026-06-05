"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQuery } from "@tanstack/react-query"
import { toast } from "sonner"
import { Loader2, Plus, Save, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { procurementService, type POItem, type PurchaseOrder } from "@/services/procurement"
import { inventoryService } from "@/services/inventory"
import { factoryService } from "@/services/factory"
import { quotationService } from "@/services/quotation"

interface Props {
    mode: "create" | "edit"
    initial?: PurchaseOrder
}

const CATEGORY_OPTIONS = [
    { label: "Granule", value: "GRANULE" },
    { label: "Film Variant", value: "FILM_VARIANT" },
    { label: "Film Family", value: "FILM_FAMILY" },
    { label: "Ink", value: "INK" },
    { label: "Solvent", value: "SOLVENT" },
    { label: "Adhesive", value: "ADHESIVE" },
    { label: "Packaging", value: "PACKAGING" },
    { label: "Add-on", value: "ADDON" },
    { label: "POD", value: "POD" },
]

interface DraftItem {
    line_no: number
    material: string
    material_label: string
    description: string
    qty_ordered: string
    uom: string
    rate_per_uom: string
    gst_pct: string
    expected_delivery_date: string
}

export function PurchaseOrderForm({ mode, initial }: Props) {
    const router = useRouter()
    const [vendor, setVendor] = React.useState<string>(initial?.vendor ?? "")
    const [plant, setPlant] = React.useState<string>(initial?.plant ?? "")
    const [orderDate, setOrderDate] = React.useState(initial?.order_date ?? new Date().toISOString().slice(0, 10))
    const [expectedDate, setExpectedDate] = React.useState(initial?.expected_delivery_date ?? "")
    const [paymentTerms, setPaymentTerms] = React.useState(initial?.payment_terms ?? "Net 30")
    const [freightTerms, setFreightTerms] = React.useState(initial?.freight_terms ?? "")
    const [notes, setNotes] = React.useState(initial?.notes ?? "")
    const [items, setItems] = React.useState<DraftItem[]>(() => {
        if (initial?.items?.length) {
            return initial.items.map((it: POItem, idx: number) => ({
                line_no: it.line_no ?? idx + 1,
                material: it.material,
                material_label: `${it.material_code ?? ""} — ${it.material_name ?? ""}`,
                description: it.description ?? "",
                qty_ordered: String(it.qty_ordered ?? "0"),
                uom: it.uom ?? "KG",
                rate_per_uom: String(it.rate_per_uom ?? "0"),
                gst_pct: String(it.gst_pct ?? "18"),
                expected_delivery_date: it.expected_delivery_date ?? "",
            }))
        }
        return [emptyLine(1)]
    })
    const [pickerCategory, setPickerCategory] = React.useState("GRANULE")
    const [pickerSearch, setPickerSearch] = React.useState("")

    const { data: vendors } = useQuery({
        queryKey: ["vendors"],
        queryFn: () => inventoryService.getVendors(),
    })
    const { data: plants } = useQuery({
        queryKey: ["plants"],
        queryFn: () => factoryService.getPlants(),
    })
    const { data: materials } = useQuery({
        queryKey: ["procurement-bom-lookup", pickerCategory, pickerSearch],
        queryFn: () =>
            quotationService.lookupMaterials({
                category: pickerCategory,
                search: pickerSearch || undefined,
                page_size: 30,
            }),
    })

    const totals = React.useMemo(() => {
        let subtotal = 0
        let gst = 0
        items.forEach((it) => {
            const qty = parseFloat(it.qty_ordered) || 0
            const rate = parseFloat(it.rate_per_uom) || 0
            const gstPct = parseFloat(it.gst_pct) || 0
            const lineSub = qty * rate
            const lineGst = (lineSub * gstPct) / 100
            subtotal += lineSub
            gst += lineGst
        })
        return { subtotal, gst, grand: subtotal + gst }
    }, [items])

    const saveMutation = useMutation({
        mutationFn: async () => {
            const payload = {
                vendor,
                plant,
                order_date: orderDate,
                expected_delivery_date: expectedDate || null,
                payment_terms: paymentTerms,
                freight_terms: freightTerms,
                notes,
                items: items.map((it, idx) => ({
                    line_no: idx + 1,
                    material: it.material,
                    description: it.description,
                    qty_ordered: it.qty_ordered,
                    uom: it.uom,
                    rate_per_uom: it.rate_per_uom,
                    gst_pct: it.gst_pct,
                    expected_delivery_date: it.expected_delivery_date || null,
                })),
            }
            if (mode === "create") {
                return procurementService.create(payload as Partial<PurchaseOrder>)
            }
            return procurementService.update(initial!.id, payload as Partial<PurchaseOrder>)
        },
        onSuccess: (po) => {
            toast.success(`PO ${po.code} saved`)
            router.push(`/procurement/purchase-orders/${po.id}`)
        },
        onError: (err: { response?: { data?: { error?: string } } }) => {
            toast.error(err.response?.data?.error || "Failed to save PO")
        },
    })

    const canSave =
        !!vendor && !!plant && items.length > 0 && items.every((i) => i.material && parseFloat(i.qty_ordered) > 0)

    return (
        <div className="min-h-screen bg-gradient-to-b from-slate-50/80 via-white to-slate-50/40 px-4 py-4 sm:px-6">
            <div className="mx-auto max-w-6xl space-y-5">
                <div className="rounded-2xl border border-slate-200 bg-gradient-to-r from-brand-navy-500 to-brand-blue-500 p-5 text-white">
                    <h1 className="text-xl font-semibold">
                        {mode === "create" ? "New Purchase Order" : `Edit PO ${initial?.code ?? ""}`}
                    </h1>
                    <p className="mt-1 text-sm text-white/80">
                        Create a draft PO. Save first; then send to vendor from the PO detail page.
                    </p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Vendor">
                        <select
                            value={vendor}
                            onChange={(e) => setVendor(e.target.value)}
                            className="w-full rounded-md border border-line-strong bg-surface-1 px-3 py-2 text-sm"
                        >
                            <option value="">-- Select Vendor --</option>
                            {(vendors ?? []).map((v) => (
                                <option key={v.id} value={v.id}>
                                    {v.name} ({v.code})
                                </option>
                            ))}
                        </select>
                    </Field>
                    <Field label="Plant">
                        <select
                            value={plant}
                            onChange={(e) => setPlant(e.target.value)}
                            className="w-full rounded-md border border-line-strong bg-surface-1 px-3 py-2 text-sm"
                        >
                            <option value="">-- Select Plant --</option>
                            {(plants ?? []).map((p) => (
                                <option key={p.id} value={p.id}>
                                    {p.name}
                                </option>
                            ))}
                        </select>
                    </Field>
                    <Field label="Order Date">
                        <Input type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
                    </Field>
                    <Field label="Expected Delivery">
                        <Input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
                    </Field>
                    <Field label="Payment Terms">
                        <Input value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} />
                    </Field>
                    <Field label="Freight Terms">
                        <Input value={freightTerms} onChange={(e) => setFreightTerms(e.target.value)} />
                    </Field>
                </div>

                {/* Line items */}
                <div className="rounded-xl border border-slate-200 bg-surface-1 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-3">
                        <div className="text-sm font-semibold text-brand-navy-500">Line Items</div>
                        <div className="flex items-center gap-2">
                            <select
                                value={pickerCategory}
                                onChange={(e) => setPickerCategory(e.target.value)}
                                className="rounded-md border border-line-strong bg-surface-1 px-2 py-1 text-xs"
                            >
                                {CATEGORY_OPTIONS.map((c) => (
                                    <option key={c.value} value={c.value}>
                                        {c.label}
                                    </option>
                                ))}
                            </select>
                            <Input
                                placeholder="Search material…"
                                value={pickerSearch}
                                onChange={(e) => setPickerSearch(e.target.value)}
                                className="h-8 w-48"
                            />
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setItems((prev) => [...prev, emptyLine(prev.length + 1)])}
                            >
                                <Plus className="mr-1 h-3.5 w-3.5" /> Empty Row
                            </Button>
                        </div>
                    </div>
                    {(materials?.length ?? 0) > 0 && (pickerSearch.length > 0 || materials!.length <= 6) && (
                        <div className="border-b border-slate-100 bg-slate-50 p-2">
                            <div className="text-[10px] uppercase text-slate-500">Suggestions</div>
                            <div className="mt-1 flex flex-wrap gap-1">
                                {materials!.slice(0, 10).map((m) => (
                                    <button
                                        key={m.id}
                                        onClick={() => {
                                            setItems((prev) => [
                                                ...prev,
                                                {
                                                    line_no: prev.length + 1,
                                                    material: m.id,
                                                    material_label: `${m.code} — ${m.name}`,
                                                    description: "",
                                                    qty_ordered: "0",
                                                    uom: (m.base_uom as string) || "KG",
                                                    rate_per_uom: String((m as unknown as { last_purchase_rate?: number }).last_purchase_rate ?? "0"),
                                                    gst_pct: "18",
                                                    expected_delivery_date: "",
                                                },
                                            ])
                                            setPickerSearch("")
                                        }}
                                        className="rounded-full border border-slate-200 bg-surface-1 px-2 py-1 text-xs hover:border-brand-blue-500 hover:text-brand-blue-500"
                                    >
                                        {m.code} · {m.name}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                    <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                            <tr>
                                <th className="w-10 px-2 py-2 text-left">#</th>
                                <th className="px-2 py-2 text-left">Material</th>
                                <th className="w-24 px-2 py-2 text-right">Qty</th>
                                <th className="w-20 px-2 py-2 text-left">UOM</th>
                                <th className="w-28 px-2 py-2 text-right">Rate</th>
                                <th className="w-20 px-2 py-2 text-right">GST %</th>
                                <th className="w-32 px-2 py-2 text-right">Line Total</th>
                                <th className="w-10" />
                            </tr>
                        </thead>
                        <tbody>
                            {items.map((it, idx) => {
                                const qty = parseFloat(it.qty_ordered) || 0
                                const rate = parseFloat(it.rate_per_uom) || 0
                                const gst = parseFloat(it.gst_pct) || 0
                                const sub = qty * rate
                                const total = sub + (sub * gst) / 100
                                return (
                                    <tr key={idx} className="border-t border-slate-100 align-top">
                                        <td className="px-2 py-2 text-slate-500">{idx + 1}</td>
                                        <td className="px-2 py-2">
                                            <div className="text-xs text-slate-700">{it.material_label || "(pick a material)"}</div>
                                            <Input
                                                placeholder="Description"
                                                value={it.description}
                                                onChange={(e) => updateItem(setItems, idx, { description: e.target.value })}
                                                className="mt-1 h-7 text-xs"
                                            />
                                        </td>
                                        <td className="px-2 py-2">
                                            <Input
                                                type="number"
                                                step="0.001"
                                                value={it.qty_ordered}
                                                onChange={(e) => updateItem(setItems, idx, { qty_ordered: e.target.value })}
                                                className="h-8 text-right"
                                            />
                                        </td>
                                        <td className="px-2 py-2">
                                            <Input
                                                value={it.uom}
                                                onChange={(e) => updateItem(setItems, idx, { uom: e.target.value })}
                                                className="h-8"
                                            />
                                        </td>
                                        <td className="px-2 py-2">
                                            <Input
                                                type="number"
                                                step="0.01"
                                                value={it.rate_per_uom}
                                                onChange={(e) => updateItem(setItems, idx, { rate_per_uom: e.target.value })}
                                                className="h-8 text-right"
                                            />
                                        </td>
                                        <td className="px-2 py-2">
                                            <Input
                                                type="number"
                                                step="0.01"
                                                value={it.gst_pct}
                                                onChange={(e) => updateItem(setItems, idx, { gst_pct: e.target.value })}
                                                className="h-8 text-right"
                                            />
                                        </td>
                                        <td className="px-2 py-2 text-right font-medium tabular-nums">
                                            {total.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                                        </td>
                                        <td className="px-2 py-2 text-right">
                                            <button
                                                className="text-content-4 hover:text-rose-600"
                                                onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                                                aria-label="Remove line"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </button>
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>

                {/* Totals + Notes */}
                <div className="grid gap-4 sm:grid-cols-3">
                    <div className="sm:col-span-2">
                        <Label className="text-xs">Notes</Label>
                        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} />
                    </div>
                    <div className="rounded-xl border border-slate-200 bg-surface-1 p-3 shadow-sm">
                        <div className="flex justify-between text-sm">
                            <span className="text-slate-500">Subtotal</span>
                            <span className="tabular-nums">{formatINR(totals.subtotal)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="text-slate-500">GST</span>
                            <span className="tabular-nums">{formatINR(totals.gst)}</span>
                        </div>
                        <div className="mt-2 flex justify-between border-t border-slate-100 pt-2 text-base font-semibold text-brand-navy-500">
                            <span>Grand Total</span>
                            <span className="tabular-nums">INR {formatINR(totals.grand)}</span>
                        </div>
                    </div>
                </div>

                <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => router.back()}>
                        Cancel
                    </Button>
                    <Button
                        disabled={!canSave || saveMutation.isPending}
                        onClick={() => saveMutation.mutate()}
                        className="bg-brand-navy-500 hover:bg-brand-navy-600"
                    >
                        {saveMutation.isPending ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                            <Save className="mr-2 h-4 w-4" />
                        )}
                        Save PO
                    </Button>
                </div>
            </div>
        </div>
    )
}

function emptyLine(lineNo: number): DraftItem {
    return {
        line_no: lineNo,
        material: "",
        material_label: "",
        description: "",
        qty_ordered: "0",
        uom: "KG",
        rate_per_uom: "0",
        gst_pct: "18",
        expected_delivery_date: "",
    }
}

function updateItem(setter: React.Dispatch<React.SetStateAction<DraftItem[]>>, idx: number, patch: Partial<DraftItem>) {
    setter((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)))
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div>
            <Label className="text-xs">{label}</Label>
            {children}
        </div>
    )
}

function formatINR(value: number): string {
    if (!Number.isFinite(value)) return "0.00"
    return value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

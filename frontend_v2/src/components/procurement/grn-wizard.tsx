"use client"

import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { ArrowLeft, ArrowRight, CheckCircle2, Loader2, Truck } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { procurementService, type PurchaseOrder } from "@/services/procurement"

interface ReceiptLineDraft {
    po_item_id: string
    material_code: string
    material_name: string
    material_category: string
    open_qty: number
    qty_received: string
    rate: string
    width_mm: string
    thickness_micron: string
    notes: string
    rejection_reason: string
}

const STEPS: Array<{ key: "vehicle" | "lines" | "quality"; label: string }> = [
    { key: "vehicle", label: "Vehicle & Invoice" },
    { key: "lines", label: "Line Quantities" },
    { key: "quality", label: "Quality & Post" },
]

export function GrnWizard({ poId }: { poId: string }) {
    const router = useRouter()
    const qc = useQueryClient()
    const { data: po, isLoading } = useQuery<PurchaseOrder>({
        queryKey: ["procurement", "po", poId],
        queryFn: () => procurementService.get(poId),
    })

    const [stepIdx, setStepIdx] = React.useState(0)
    const step = STEPS[stepIdx].key

    const [invoiceNo, setInvoiceNo] = React.useState("")
    const [invoiceDate, setInvoiceDate] = React.useState("")
    const [vehicleNo, setVehicleNo] = React.useState("")
    const [driver, setDriver] = React.useState("")
    const [lrNo, setLrNo] = React.useState("")
    const [quality, setQuality] = React.useState<"PENDING" | "APPROVED" | "REJECTED">("PENDING")
    const [notes, setNotes] = React.useState("")
    const [lines, setLines] = React.useState<ReceiptLineDraft[]>([])

    React.useEffect(() => {
        if (!po) return
        const openLines = po.items
            .filter((it) => !it.is_closed)
            .map((it) => ({
                po_item_id: it.id ?? "",
                material_code: it.material_code ?? "",
                material_name: it.material_name ?? "",
                material_category: it.material_category ?? "",
                open_qty: Number(it.qty_open ?? 0),
                qty_received: String(it.qty_open ?? 0),
                rate: String(it.rate_per_uom ?? "0"),
                width_mm: it.expected_width_mm != null ? String(it.expected_width_mm) : "",
                thickness_micron:
                    it.expected_thickness_micron != null ? String(it.expected_thickness_micron) : "",
                notes: "",
                rejection_reason: "",
            }))
        setLines(openLines)
    }, [po])

    const submitMutation = useMutation({
        mutationFn: async () => {
            if (!po) throw new Error("PO not loaded")
            const payload = {
                purchase_order: po.id,
                vendor_invoice_no: invoiceNo,
                vendor_invoice_date: invoiceDate || null,
                vehicle_no: vehicleNo,
                driver_name: driver,
                lr_no: lrNo,
                notes,
                quality_status: quality,
                lines: lines
                    .filter((l) => parseFloat(l.qty_received) > 0)
                    .map((l) => ({
                        po_item_id: l.po_item_id,
                        qty_received: l.qty_received,
                        rate: l.rate,
                        notes: l.notes,
                        rejection_reason: l.rejection_reason,
                        ...(l.material_category === "FILM_VARIANT" || l.material_category === "POD"
                            ? {
                                  width_mm: l.width_mm || undefined,
                                  thickness_micron: l.thickness_micron || undefined,
                              }
                            : {}),
                    })),
            }
            return procurementService.createReceipt(payload)
        },
        onSuccess: (receipt) => {
            toast.success(`GRN ${receipt.code} posted`)
            qc.invalidateQueries({ queryKey: ["procurement"] })
            router.push(`/procurement/purchase-orders/${poId}`)
        },
        onError: (e: { response?: { data?: { error?: string } } }) => {
            toast.error(e.response?.data?.error || "Failed to post GRN")
        },
    })

    if (isLoading || !po) {
        return (
            <div className="flex h-[60vh] items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-content-4" />
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-gradient-to-b from-slate-50/80 via-white to-slate-50/40 px-4 py-4 sm:px-6">
            <div className="mx-auto max-w-5xl space-y-5">
                <Link
                    href={`/procurement/purchase-orders/${poId}`}
                    className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-brand-blue-500"
                >
                    <ArrowLeft className="h-3 w-3" /> Back to PO {po.code}
                </Link>

                <div className="rounded-2xl border border-slate-200 bg-gradient-to-r from-brand-navy-500 to-brand-blue-500 p-5 text-white">
                    <div className="flex items-center gap-3">
                        <Truck className="h-5 w-5" />
                        <div>
                            <h1 className="text-xl font-semibold">GRN against {po.code}</h1>
                            <p className="text-xs text-white/80">
                                Vendor {po.vendor_name} · Plant {po.plant_name}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Stepper */}
                <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-surface-1 px-4 py-3">
                    {STEPS.map((s, idx) => (
                        <div key={s.key} className="flex items-center gap-2">
                            <div
                                className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${
                                    idx <= stepIdx
                                        ? "bg-brand-blue-500 text-white"
                                        : "bg-slate-100 text-slate-500"
                                }`}
                            >
                                {idx + 1}
                            </div>
                            <div className={`text-xs ${idx === stepIdx ? "font-semibold text-brand-navy-500" : "text-slate-500"}`}>
                                {s.label}
                            </div>
                            {idx < STEPS.length - 1 && <div className="mx-2 h-px w-8 bg-slate-200" />}
                        </div>
                    ))}
                </div>

                {step === "vehicle" && (
                    <div className="grid gap-4 rounded-xl border border-slate-200 bg-surface-1 p-5 shadow-sm sm:grid-cols-2">
                        <Field label="Vendor Invoice No">
                            <Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} />
                        </Field>
                        <Field label="Invoice Date">
                            <Input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
                        </Field>
                        <Field label="Vehicle No">
                            <Input value={vehicleNo} onChange={(e) => setVehicleNo(e.target.value)} placeholder="e.g. GJ-15-AB-9999" />
                        </Field>
                        <Field label="Driver">
                            <Input value={driver} onChange={(e) => setDriver(e.target.value)} />
                        </Field>
                        <Field label="LR No">
                            <Input value={lrNo} onChange={(e) => setLrNo(e.target.value)} />
                        </Field>
                    </div>
                )}

                {step === "lines" && (
                    <div className="overflow-hidden rounded-xl border border-slate-200 bg-surface-1 shadow-sm">
                        <table className="w-full text-sm">
                            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                                <tr>
                                    <th className="px-3 py-2 text-left">Material</th>
                                    <th className="px-3 py-2 text-right">Open</th>
                                    <th className="px-3 py-2 text-right">Receiving</th>
                                    <th className="px-3 py-2 text-right">Rate</th>
                                    <th className="px-3 py-2 text-right">Width (mm)</th>
                                    <th className="px-3 py-2 text-right">Thk (µm)</th>
                                </tr>
                            </thead>
                            <tbody>
                                {lines.map((l, idx) => (
                                    <tr key={l.po_item_id} className="border-t border-slate-100">
                                        <td className="px-3 py-2">
                                            <div className="font-medium">{l.material_code}</div>
                                            <div className="text-xs text-slate-500">
                                                {l.material_name} · {l.material_category}
                                            </div>
                                        </td>
                                        <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                                            {l.open_qty.toFixed(3)}
                                        </td>
                                        <td className="px-3 py-2">
                                            <Input
                                                type="number"
                                                step="0.001"
                                                value={l.qty_received}
                                                onChange={(e) =>
                                                    setLines((prev) =>
                                                        prev.map((p, i) =>
                                                            i === idx ? { ...p, qty_received: e.target.value } : p,
                                                        ),
                                                    )
                                                }
                                                className="h-8 text-right"
                                            />
                                        </td>
                                        <td className="px-3 py-2">
                                            <Input
                                                type="number"
                                                step="0.01"
                                                value={l.rate}
                                                onChange={(e) =>
                                                    setLines((prev) =>
                                                        prev.map((p, i) => (i === idx ? { ...p, rate: e.target.value } : p)),
                                                    )
                                                }
                                                className="h-8 text-right"
                                            />
                                        </td>
                                        <td className="px-3 py-2">
                                            {l.material_category === "FILM_VARIANT" || l.material_category === "POD" ? (
                                                <Input
                                                    type="number"
                                                    step="0.01"
                                                    value={l.width_mm}
                                                    onChange={(e) =>
                                                        setLines((prev) =>
                                                            prev.map((p, i) =>
                                                                i === idx ? { ...p, width_mm: e.target.value } : p,
                                                            ),
                                                        )
                                                    }
                                                    className="h-8 text-right"
                                                />
                                            ) : (
                                                <span className="text-slate-300">—</span>
                                            )}
                                        </td>
                                        <td className="px-3 py-2">
                                            {l.material_category === "FILM_VARIANT" || l.material_category === "POD" ? (
                                                <Input
                                                    type="number"
                                                    step="0.01"
                                                    value={l.thickness_micron}
                                                    onChange={(e) =>
                                                        setLines((prev) =>
                                                            prev.map((p, i) =>
                                                                i === idx ? { ...p, thickness_micron: e.target.value } : p,
                                                            ),
                                                        )
                                                    }
                                                    className="h-8 text-right"
                                                />
                                            ) : (
                                                <span className="text-slate-300">—</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}

                {step === "quality" && (
                    <div className="rounded-xl border border-slate-200 bg-surface-1 p-5 shadow-sm">
                        <Field label="Quality Status">
                            <select
                                value={quality}
                                onChange={(e) => setQuality(e.target.value as "PENDING" | "APPROVED" | "REJECTED")}
                                className="w-full rounded-md border border-line-strong bg-surface-1 px-3 py-2 text-sm"
                            >
                                <option value="PENDING">Pending</option>
                                <option value="APPROVED">Approved</option>
                                <option value="REJECTED">Rejected</option>
                            </select>
                        </Field>
                        <div className="mt-3">
                            <Label className="text-xs">Notes</Label>
                            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
                        </div>
                    </div>
                )}

                {/* Footer nav */}
                <div className="flex items-center justify-between">
                    <Button
                        variant="outline"
                        disabled={stepIdx === 0}
                        onClick={() => setStepIdx((i) => Math.max(0, i - 1))}
                    >
                        <ArrowLeft className="mr-1 h-3.5 w-3.5" /> Back
                    </Button>
                    {stepIdx < STEPS.length - 1 ? (
                        <Button onClick={() => setStepIdx((i) => i + 1)} className="bg-brand-navy-500 hover:bg-brand-navy-600">
                            Next <ArrowRight className="ml-1 h-3.5 w-3.5" />
                        </Button>
                    ) : (
                        <Button
                            disabled={submitMutation.isPending}
                            onClick={() => submitMutation.mutate()}
                            className="bg-emerald-600 hover:bg-emerald-700"
                        >
                            {submitMutation.isPending ? (
                                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                            ) : (
                                <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
                            )}
                            Post GRN
                        </Button>
                    )}
                </div>
            </div>
        </div>
    )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div>
            <Label className="text-xs">{label}</Label>
            {children}
        </div>
    )
}

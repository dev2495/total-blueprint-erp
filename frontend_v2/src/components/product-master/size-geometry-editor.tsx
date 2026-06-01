"use client"

import * as React from "react"
import { Plus, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import type { DimensionImpact } from "@/lib/product-geometry"
import { computeProductGeometry, resolveProductOutputKind } from "@/lib/product-geometry"
import { PouchStyleBinding } from "@/components/product-master/pouch-style-binding"
import type { ProductKind, ProductMasterSize } from "@/services/product-master"
import { cn } from "@/lib/utils"

const ROLL_FORMS = ["FLAT", "FOLDED", "TUBING"] as const
const DIMENSIONS: Array<{ value: DimensionImpact; label: string }> = [
    { value: "WIDTH", label: "Width" },
    { value: "HEIGHT", label: "Height" },
    { value: "BOTH", label: "Both" },
    { value: "NONE", label: "None" },
]

interface SizeGeometryEditorProps {
    row: ProductMasterSize
    kind: ProductKind | string
    /** For PACKAGING masters this is the sub-type (INNER_POUCH | SHEET). */
    packagingKind?: string | null
    /** Backend-normalized physical output type. This wins over page/product kind. */
    fixedFgType?: string | null
    onPatch: (patch: Partial<ProductMasterSize>) => void
    className?: string
}

export function SizeGeometryEditor({ row, kind, packagingKind, fixedFgType, onPatch, className }: SizeGeometryEditorProps) {
    const outputKind = resolveProductOutputKind(kind, packagingKind, fixedFgType)
    const geometryKind = outputKind === "ROLL" || outputKind === "POUCH" ? outputKind : kind
    const geometry = computeProductGeometry(row, geometryKind)
    const adjustments = Array.isArray(row.adjustments) ? row.adjustments : []
    const productKind = String(kind || "").toUpperCase()
    const packKind = String(packagingKind || "").toUpperCase()
    const isPouchShaped = outputKind === "POUCH"
    const isRollOutput = outputKind === "ROLL"
    const outputMissing = productKind === "PACKAGING" && !packKind
    const geometryConfig = row.geometry_config && typeof row.geometry_config === "object" ? row.geometry_config : {}
    const currentMultipliers = geometryConfig.multipliers && typeof geometryConfig.multipliers === "object"
        ? (geometryConfig.multipliers as Record<string, unknown>)
        : {}
    const rawStyleValue = row.roll_form || String(geometryConfig.roll_form || "") || "FLAT"
    const normalizedStyleValue = String(rawStyleValue || "").toUpperCase()
    const styleValue = (ROLL_FORMS as readonly string[]).includes(normalizedStyleValue)
        ? normalizedStyleValue
        : "FLAT"

    const patchAdjustment = (index: number, patch: Record<string, unknown>) => {
        const next = adjustments.map((item, idx) => (idx === index ? { ...item, ...patch } : item))
        onPatch({ adjustments: next })
    }
    const addAdjustment = () => {
        onPatch({
            adjustments: [
                ...adjustments,
                { name: "Adjustment", value: 0, impact: "WIDTH" },
            ],
        })
    }
    const removeAdjustment = (index: number) => {
        onPatch({ adjustments: adjustments.filter((_, idx) => idx !== index) })
    }

    return (
        <div className={cn("space-y-4", className)} data-testid={`size-geometry-editor-${outputKind.toLowerCase()}`} data-output-kind={outputKind}>
            {isPouchShaped ? <PouchStyleBinding row={row} onPatch={onPatch} fallbackTargetWidthMm={geometry.fallbackRollWidthMm} /> : null}
            {outputMissing ? (
                <div className="rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 via-white to-orange-50/40 px-3 py-2 text-[11px] text-amber-900">
                    <span className="font-bold">Pick a packing output first.</span> Go to <em>Identity → Packing sub-type</em> in section 1 and choose <strong>Inner pouch</strong> or <strong>Sheet / Roll</strong>. Size fields are hidden until the physical output is known.
                </div>
            ) : null}
            {isPouchShaped ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm" data-testid="pouch-size-basics">
                    <div className="mb-2 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Size row basics</div>
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                        <EditField label="Code">
                            <Input className="h-8 rounded-lg text-xs" value={row.code} onChange={(e) => onPatch({ code: e.target.value.toUpperCase() })} />
                        </EditField>
                        <EditField label="Label">
                            <Input className="h-8 rounded-lg text-xs" value={row.label} onChange={(e) => onPatch({ label: e.target.value })} />
                        </EditField>
                        <EditField label="Std qty">
                            <Input type="number" className="h-8 rounded-lg text-right text-xs" value={row.standard_qty || ""} onChange={(e) => onPatch({ standard_qty: e.target.value ? Number(e.target.value) : null })} />
                        </EditField>
                        <EditField label="UOM">
                            <Select value={row.qty_uom || "KG"} onValueChange={(v) => onPatch({ qty_uom: v as "KG" | "PCS" | "METER" })}>
                                <SelectTrigger className="h-8 rounded-lg text-xs"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="KG">KG</SelectItem>
                                    <SelectItem value="PCS">PCS</SelectItem>
                                    <SelectItem value="METER">METER</SelectItem>
                                </SelectContent>
                            </Select>
                        </EditField>
                        <EditField label="Sort order">
                            <Input type="number" className="h-8 rounded-lg text-right text-xs" value={row.sort_order || 0} onChange={(e) => onPatch({ sort_order: Number(e.target.value) })} />
                        </EditField>
                        <EditField label="Notes" span={2}>
                            <Input className="h-8 rounded-lg text-xs" value={row.notes || ""} onChange={(e) => onPatch({ notes: e.target.value })} />
                        </EditField>
                    </div>
                </div>
            ) : null}
            {isRollOutput ? (
                <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="roll-size-fields">
                <EditField label="Code">
                    <Input className="h-8 rounded-lg text-xs" value={row.code} onChange={(e) => onPatch({ code: e.target.value.toUpperCase() })} />
                </EditField>
                <EditField label="Label">
                    <Input className="h-8 rounded-lg text-xs" value={row.label} onChange={(e) => onPatch({ label: e.target.value })} />
                </EditField>
                <EditField label={isRollOutput ? "Roll width (mm)" : "Final width (mm)"}>
                    <Input type="number" className="h-8 rounded-lg text-right text-xs" value={row.width_mm} onChange={(e) => onPatch({ width_mm: Number(e.target.value) })} />
                </EditField>
                <EditField label="Trim loss (mm)">
                    <Input type="number" className="h-8 rounded-lg text-right text-xs" value={row.trim_loss_mm ?? 10} onChange={(e) => onPatch({ trim_loss_mm: Number(e.target.value) })} />
                </EditField>
                <EditField label="Trim affects">
                    <Select value={(row.trim_apply_to || "WIDTH") as string} onValueChange={(v) => onPatch({ trim_apply_to: v as DimensionImpact })}>
                        <SelectTrigger className="h-8 rounded-lg text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            {DIMENSIONS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </EditField>
                <EditField label="Roll form">
                    <Select key={`${productKind}-${row.id || row.code}-${styleValue}`} value={styleValue as string}
                        onValueChange={(v) =>
                            onPatch({
                                roll_form: v,
                                pouch_style: "",
                                geometry_config: {
                                    ...geometryConfig,
                                    roll_form: v,
                                    pouch_style: "",
                                },
                            })
                        }>
                        <SelectTrigger className="h-8 rounded-lg text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>{ROLL_FORMS.map((s) => <SelectItem key={s} value={s}>{s.replaceAll("_", " ")}</SelectItem>)}</SelectContent>
                    </Select>
                </EditField>
                <EditField label="Auto roll width">
                    <Metric value={geometry.fallbackRollWidthMm} suffix="mm" tone="emerald" />
                </EditField>
                <EditField label={isRollOutput ? "Effective roll width" : "Effective W x H"} span={2}>
                    <div className={cn("grid gap-2", isRollOutput ? "grid-cols-1" : "grid-cols-2")}>
                        <Metric value={geometry.effectiveWidthMm} suffix="mm W" tone="blue" />
                        {!isRollOutput ? <Metric value={geometry.effectiveHeightMm} suffix="mm H" tone="blue" /> : null}
                    </div>
                </EditField>
                <EditField label="Std qty">
                    <Input type="number" className="h-8 rounded-lg text-right text-xs" value={row.standard_qty || ""} onChange={(e) => onPatch({ standard_qty: e.target.value ? Number(e.target.value) : null })} />
                </EditField>
                <EditField label="UOM">
                    <Select value={row.qty_uom || "KG"} onValueChange={(v) => onPatch({ qty_uom: v as "KG" | "PCS" | "METER" })}>
                        <SelectTrigger className="h-8 rounded-lg text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="KG">KG</SelectItem>
                            <SelectItem value="PCS">PCS</SelectItem>
                            <SelectItem value="METER">METER</SelectItem>
                        </SelectContent>
                    </Select>
                </EditField>
                <EditField label="Sort order">
                    <Input type="number" className="h-8 rounded-lg text-right text-xs" value={row.sort_order || 0} onChange={(e) => onPatch({ sort_order: Number(e.target.value) })} />
                </EditField>
                <EditField label="Notes">
                    <Input className="h-8 rounded-lg text-xs" value={row.notes || ""} onChange={(e) => onPatch({ notes: e.target.value })} />
                </EditField>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-3">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Custom geometry adjustments</div>
                        <p className="mt-0.5 text-xs text-slate-500">Add exact allowances to width, height, or both without changing the product code model.</p>
                    </div>
                    <Button type="button" size="sm" variant="outline" className="h-8 rounded-lg" onClick={addAdjustment}>
                        <Plus className="mr-1 h-3.5 w-3.5" />
                        Add adjustment
                    </Button>
                </div>
                {adjustments.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-500">
                        No extra W/H adjustments.
                    </div>
                ) : (
                    <div className="space-y-2">
                        {adjustments.map((adjustment, index) => (
                            <div key={index} className="grid grid-cols-[1fr_96px_140px_32px] gap-2">
                                <Input className="h-8 rounded-lg text-xs" value={String(adjustment.name || "")} onChange={(e) => patchAdjustment(index, { name: e.target.value })} />
                                <Input type="number" className="h-8 rounded-lg text-right text-xs" value={Number(adjustment.value || 0)} onChange={(e) => patchAdjustment(index, { value: Number(e.target.value) })} />
                                <Select value={String(adjustment.impact || "WIDTH")} onValueChange={(v) => patchAdjustment(index, { impact: v })}>
                                    <SelectTrigger className="h-8 rounded-lg text-xs"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {DIMENSIONS.filter((item) => item.value !== "NONE").map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                                <button type="button" onClick={() => removeAdjustment(index)} className="inline-flex h-8 items-center justify-center rounded-lg text-rose-600 hover:bg-rose-50">
                                    <Trash2 className="h-3.5 w-3.5" />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
                </>
            ) : null}
        </div>
    )
}

function EditField({ label, children, span = 1 }: { label: string; children: React.ReactNode; span?: 1 | 2 }) {
    return (
        <label className={cn("space-y-1", span === 2 && "col-span-2")}>
            <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">{label}</span>
            {children}
        </label>
    )
}

function Metric({ value, suffix, tone }: { value: number; suffix: string; tone: "emerald" | "blue" }) {
    const styles =
        tone === "emerald"
            ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
            : "bg-blue-50 text-blue-700 ring-blue-100"
    return (
        <div className={cn("flex h-8 items-center justify-end rounded-lg px-2 font-mono text-xs font-bold ring-1", styles)}>
            {Number.isFinite(value) && value > 0 ? `${Number(value.toFixed(2))} ${suffix}` : `- ${suffix}`}
        </div>
    )
}

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
import { computeProductGeometry, defaultGussetRule, pouchUsesHeightForRoll, pouchStyleFields } from "@/lib/product-geometry"
import { PouchStylePicker } from "@/components/product-master/pm-edit-shell"
import { PouchStyleBinding } from "@/components/product-master/pouch-style-binding"
import type { ProductKind, ProductMasterSize } from "@/services/product-master"
import { cn } from "@/lib/utils"

const POUCH_STYLES = [
    "STAND_UP",
    "THREE_SIDE_SEAL",
    "PILLOW",
    "CENTER_SEAL",
    "SIDE_GUSSET",
    "QUAD_SEAL",
    "FLAT_BOTTOM",
    "SPOUT",
    "SHAPED",
    "SACHET",
    "STICK_PACK",
] as const
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
    /**
     * For PACKAGING masters this is the sub-type (INNER_POUCH | SHEET). When
     * INNER_POUCH the master is pouch-shaped so the pouch-style picker shows;
     * when SHEET it's roll-form so the roll-form picker shows. Ignored for
     * POUCH / ROLL / POD masters — those drive form from `kind` alone.
     */
    packagingKind?: string | null
    onPatch: (patch: Partial<ProductMasterSize>) => void
    className?: string
}

export function SizeGeometryEditor({ row, kind, packagingKind, onPatch, className }: SizeGeometryEditorProps) {
    const geometry = computeProductGeometry(row, kind)
    const adjustments = Array.isArray(row.adjustments) ? row.adjustments : []
    const productKind = String(kind || "POUCH").toUpperCase()
    const packKind = String(packagingKind || "").toUpperCase()
    // "Pouch-shaped" → render pouch-style icon picker + gusset fields.
    // Includes:
    //   - proper POUCH masters
    //   - PACKAGING masters with sub-type INNER_POUCH
    //   - PACKAGING masters with sub-type UNSET — default to inner pouch so
    //     a newly-created PACKAGING master still gets the pouch geometry UI
    //     while the admin is filling in section 1 (we warn them below).
    const isPouchShaped =
        productKind === "POUCH"
        || (productKind === "PACKAGING" && packKind !== "SHEET")
    // "Roll output" → roll-form picker, no gusset, single face by default.
    // POD + ROLL masters, plus PACKAGING masters with SHEET sub-type
    // (sheet/roll-for-packing).
    const isRollOutput = productKind === "ROLL" || productKind === "POD" || (productKind === "PACKAGING" && packKind === "SHEET")
    // True when admin opened a PACKAGING master but hasn't yet chosen
    // INNER_POUCH vs SHEET — surface a soft warning above the geometry fields.
    const packagingSubtypeMissing = productKind === "PACKAGING" && !packKind
    const pouchStyle = (row.pouch_style || "STAND_UP").toUpperCase()
    const defaultGusset = defaultGussetRule(pouchStyle)
    const geometryConfig = row.geometry_config && typeof row.geometry_config === "object" ? row.geometry_config : {}
    const styleOptions = isPouchShaped ? POUCH_STYLES : ROLL_FORMS
    const rawStyleValue =
        isPouchShaped
            ? (row.pouch_style || String(geometryConfig.pouch_style || "") || "STAND_UP")
            : (row.roll_form || String(geometryConfig.roll_form || "") || "FLAT")
    const normalizedStyleValue = String(rawStyleValue || "").toUpperCase()
    const styleValue = (styleOptions as readonly string[]).includes(normalizedStyleValue)
        ? normalizedStyleValue
        : isPouchShaped ? "STAND_UP" : "FLAT"

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
        <div className={cn("space-y-4", className)}>
            <PouchStyleBinding row={row} onPatch={onPatch} />
            {packagingSubtypeMissing ? (
                <div className="rounded-xl border border-amber-200 bg-gradient-to-r from-amber-50 via-white to-orange-50/40 px-3 py-2 text-[11px] text-amber-900">
                    <span className="font-bold">Pick a packing sub-type first.</span> Go to <em>Identity → Packing sub-type</em> in section 1 and choose <strong>Inner pouch</strong> or <strong>Sheet</strong>. Geometry fields below default to inner-pouch shape until you pick.
                </div>
            ) : null}
            {isPouchShaped ? (
                <div className="rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50/40 via-white to-teal-50/30 p-3 shadow-sm">
                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-700 mb-2">
                        Pouch style · pick the form
                        {productKind === "PACKAGING" ? <span className="ml-1 text-[9px] font-medium text-emerald-700/70">(inner pouch master)</span> : null}
                    </div>
                    <PouchStylePicker
                        value={styleValue as string}
                        onChange={(v) => onPatch({ pouch_style: v, roll_form: "", geometry_config: { ...geometryConfig, pouch_style: v, roll_form: "" } })}
                        faces={Number(row.faces ?? 2)}
                    />
                </div>
            ) : null}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <EditField label="Code">
                    <Input className="h-8 rounded-lg text-xs" value={row.code} onChange={(e) => onPatch({ code: e.target.value.toUpperCase() })} />
                </EditField>
                <EditField label="Label">
                    <Input className="h-8 rounded-lg text-xs" value={row.label} onChange={(e) => onPatch({ label: e.target.value })} />
                </EditField>
                <EditField label={isRollOutput ? "Roll width (mm)" : "Final width (mm)"}>
                    <Input type="number" className="h-8 rounded-lg text-right text-xs" value={row.width_mm} onChange={(e) => onPatch({ width_mm: Number(e.target.value) })} />
                </EditField>
                {isPouchShaped ? (
                    <>
                        <EditField label="Final height (mm)">
                            <Input type="number" className="h-8 rounded-lg text-right text-xs" value={row.height_mm} onChange={(e) => onPatch({ height_mm: Number(e.target.value) })} />
                        </EditField>
                        {pouchStyleFields(pouchStyle).gusset ? (
                            <EditField label="Gusset (mm)">
                                <Input type="number" className="h-8 rounded-lg text-right text-xs" value={row.gusset_mm || 0} onChange={(e) => onPatch({ gusset_mm: Number(e.target.value) })} />
                            </EditField>
                        ) : null}
                        {pouchStyleFields(pouchStyle).gussetAffects ? (
                            <EditField label="Gusset affects">
                                <Select value={(row.gusset_apply_to || defaultGusset.applyTo) as string} onValueChange={(v) => onPatch({ gusset_apply_to: v as DimensionImpact })}>
                                    <SelectTrigger className="h-8 rounded-lg text-xs"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {DIMENSIONS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </EditField>
                        ) : null}
                        {pouchStyleFields(pouchStyle).gussetFactor ? (
                            <EditField label="Gusset factor">
                                <Input type="number" step="0.1" className="h-8 rounded-lg text-right text-xs" value={row.gusset_factor ?? defaultGusset.factor} onChange={(e) => onPatch({ gusset_factor: Number(e.target.value) })} />
                            </EditField>
                        ) : null}
                    </>
                ) : null}
                <EditField label="Faces">
                    <Input type="number" className="h-8 rounded-lg text-right text-xs" value={row.faces ?? (isRollOutput ? 1 : 2)} onChange={(e) => onPatch({ faces: Number(e.target.value) })} />
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
                {isPouchShaped && pouchStyleFields(pouchStyle).flapTape ? (
                    <EditField label="Flap/tape (mm)">
                        <Input type="number" className="h-8 rounded-lg text-right text-xs" value={row.flap_tape_mm || 0} onChange={(e) => onPatch({ flap_tape_mm: Number(e.target.value) })} />
                    </EditField>
                ) : null}
                {!isPouchShaped ? (
                    <EditField label="Roll form">
                        <Select key={`${productKind}-${row.id || row.code}-${styleValue}`} value={styleValue as string}
                            onValueChange={(v) =>
                                onPatch({ roll_form: v, pouch_style: "", geometry_config: { ...geometryConfig, roll_form: v, pouch_style: "" } })
                            }>
                            <SelectTrigger className="h-8 rounded-lg text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>{ROLL_FORMS.map((s) => <SelectItem key={s} value={s}>{s.replaceAll("_", " ")}</SelectItem>)}</SelectContent>
                        </Select>
                    </EditField>
                ) : null}
                {isPouchShaped ? (
                    <EditField label={(row.roll_width_mm || 0) > 0 ? "Roll width override · WINS" : "Roll width override"}>
                        <Input
                            type="number"
                            className={cn("h-8 rounded-lg text-right text-xs", (row.roll_width_mm || 0) > 0 && "border-rose-300 bg-rose-50 font-bold text-rose-900 ring-1 ring-rose-200")}
                            placeholder="auto"
                            value={row.roll_width_mm || ""}
                            onChange={(e) => onPatch({ roll_width_mm: e.target.value ? Number(e.target.value) : null })}
                        />
                    </EditField>
                ) : null}
                <EditField label="Auto roll width">
                    <Metric value={geometry.fallbackRollWidthMm} suffix={pouchUsesHeightForRoll(pouchStyle) ? "mm (H)" : "mm"} tone="emerald" />
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

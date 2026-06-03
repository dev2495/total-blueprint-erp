"use client"

// Right rail for live geometry, material BOM, lane-up, and readiness evidence.

import * as React from "react"
import { cn } from "@/lib/utils"
import type { Addon } from "@/services/master-data"
import type { PreviewBomResult, ProductMasterSize } from "@/services/product-master"

export interface SalesPreviewRailProps {
    preview: PreviewBomResult | null
    loading?: boolean
    masterCode?: string
    sizeCode?: string
    qty: number
    uom: string
    lane: {
        childTargetMm: number
        laneCount: number
        plannedParentMm: number
        trimMm: number
        remainderMm?: number
        remainderDisposition?: string
    }
    readiness: Array<{ label: string; ok: boolean; hint?: string }>
    printCapable?: boolean
    artworkDeferred?: boolean
    selectedAddons?: Addon[]
    selectedSize?: ProductMasterSize
}

function fmtNum(n: number | string | null | undefined, max = 0): string {
    const v = Number(n)
    if (!Number.isFinite(v)) return "—"
    return new Intl.NumberFormat("en-IN", { maximumFractionDigits: max }).format(v)
}

function fmtWeightSmart(qty: number | null | undefined, uom?: string): string {
    const u = String(uom || "KG").toUpperCase()
    const n = Number(qty || 0)
    if (u !== "KG") return `${fmtNum(n, Math.abs(n) < 100 ? 1 : 0)} ${u.toLowerCase()}`
    if (!Number.isFinite(n) || n === 0) return "0 kg"
    if (Math.abs(n) >= 1) return `${fmtNum(n, Math.abs(n) >= 100 ? 0 : 2)} kg`
    const g = n * 1000
    if (Math.abs(g) >= 1) return `${g.toFixed(Math.abs(g) >= 100 ? 0 : 1)} g`
    return `${(g * 1000).toFixed(0)} mg`
}

type BomCategory = "GRANULE" | "FILM" | "INK" | "CHEMICAL" | "ADDON" | "POD" | "INNER_POUCH" | "PACKAGING" | "OTHER"

type BomRow = {
    cat: BomCategory
    code: string
    name: string
    qty: number
    uom: string
    source: string
    step?: string
    swatchHex?: string
    basis?: string
    note?: string
    placeholder?: boolean
}

const CATEGORY_ORDER: BomCategory[] = ["GRANULE", "FILM", "INK", "CHEMICAL", "ADDON", "POD", "INNER_POUCH", "PACKAGING", "OTHER"]

function matchCategory(cat: string, code = "", name = ""): BomCategory {
    const hay = `${cat} ${code} ${name}`.toUpperCase()
    if (/^POD$|POD[_-]/.test(hay)) return "POD"
    if (/INK|PIGMENT|COLOR|COLOUR/.test(hay)) return "INK"
    if (/GRANULE|RESIN|MASTERBATCH|MB[_-]|LLDPE|LDPE|HDPE|POLYMER/.test(hay)) return "GRANULE"
    if (/ADHESIVE|GLUE|SOLVENT|THINNER|CHEM/.test(hay)) return "CHEMICAL"
    if (/ADDON/.test(hay)) return "ADDON"
    if (/INNER[_-]?POUCH|PRIMARY\s+INNER|^IP[_-]/.test(hay)) return "INNER_POUCH"
    if (/GUNNY|GONNY|SHEET|CARTON|BOX|TAPE|LABEL|TAG|PACKAGING/.test(hay)) return "PACKAGING"
    if (/FILM|PE\b|PET\b|PP\b|BOPP|MET|LAMINATE/.test(hay)) return "FILM"
    return "OTHER"
}

const CAT_CHIP: Record<BomCategory, string> = {
    GRANULE: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    FILM: "bg-blue-50 text-blue-700 ring-blue-200",
    INK: "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200",
    CHEMICAL: "bg-cyan-50 text-cyan-700 ring-cyan-200",
    ADDON: "bg-rose-50 text-rose-700 ring-rose-200",
    POD: "bg-violet-50 text-violet-700 ring-violet-200",
    INNER_POUCH: "bg-amber-50 text-amber-700 ring-amber-200",
    PACKAGING: "bg-teal-50 text-teal-700 ring-teal-200",
    OTHER: "bg-slate-100 text-slate-600 ring-slate-200",
}
const CAT_LABEL: Record<BomCategory, string> = {
    GRANULE: "GRANULE", FILM: "FILM", INK: "INK", CHEMICAL: "ADH", ADDON: "ADDON", POD: "POD", INNER_POUCH: "PACK", PACKAGING: "PACK", OTHER: "OTHER",
}
const CAT_TITLE: Record<BomCategory, string> = {
    GRANULE: "Granules", FILM: "Film", INK: "Ink colors", CHEMICAL: "Adhesive / chemicals", ADDON: "Add-ons", POD: "POD", INNER_POUCH: "Inner pouch", PACKAGING: "Packing", OTHER: "Other",
}

function num(...vals: any[]): number {
    for (const v of vals) {
        const n = Number(v)
        if (Number.isFinite(n) && n !== 0) return n
    }
    return 0
}

function arr(value: unknown): any[] {
    return Array.isArray(value) ? value : []
}

function pickText(...vals: unknown[]): string {
    for (const value of vals) {
        if (typeof value === "string" && value.trim()) return value.trim()
        if (typeof value === "number" && Number.isFinite(value)) return String(value)
    }
    return ""
}

function rowCode(row: any): string {
    return pickText(row?.material_code, row?.code, row?.material_id, row?.id, "UNMAPPED")
}

function rowName(row: any): string {
    return pickText(row?.material_name, row?.name, row?.description, rowCode(row), "Material")
}

function rowQty(row: any): number {
    return num(row?.planned_issue_qty, row?.required_qty, row?.theoretical_qty, row?.qty, row?.quantity, row?.weight_kg)
}

function rowUom(row: any): string {
    return pickText(row?.issue_uom, row?.uom, row?.unit, row?.quantity_uom, row?.addon_purchase_uom, row?.base_uom, "KG").toUpperCase()
}

function makeBomRow(row: any, source: string, category?: BomCategory, step?: string): BomRow {
    const code = rowCode(row)
    const name = rowName(row)
    const cat = category || matchCategory(String(row?.category_code || row?.category || row?.material_category || row?.type || ""), code, name)
    const uom = rowUom(row)
    const weightKg = num(row?.weight_kg, row?.weight)
    const pcsPerPack = num(row?.pcs_per_pack)
    return {
        cat,
        code,
        name,
        qty: rowQty(row),
        uom,
        source,
        step,
        basis: pickText(row?.consumption_basis, row?.basis, row?.formula_driver),
        note: (cat === "INNER_POUCH" || cat === "PACKAGING") && uom === "PCS"
            ? weightKg > 0
                ? `${fmtWeightSmart(weightKg, "KG")} weight`
                : pcsPerPack > 0
                    ? `${fmtNum(pcsPerPack, 0)} pcs/inner; weight n/a`
                    : "count; weight n/a"
            : undefined,
    }
}

function pushBomRow(rows: BomRow[], row: BomRow) {
    const identity = (candidate: BomRow) => candidate.cat === "ADDON" || candidate.cat === "INNER_POUCH" || candidate.cat === "PACKAGING"
        ? `${candidate.cat}|${candidate.code}`
        : `${candidate.cat}|${candidate.code}|${candidate.uom}`
    const key = identity(row)
    const existing = rows.find((candidate) => identity(candidate) === key)
    if (!existing) {
        rows.push(row)
        return
    }
    if ((existing.placeholder && !row.placeholder) || row.source === "selected") {
        Object.assign(existing, row)
        return
    }
    if (!existing.qty && row.qty) existing.qty = row.qty
}

function colorEntry(mapping: any, color: string): any {
    if (!mapping || typeof mapping !== "object") return null
    if (mapping[color]) return mapping[color]
    const wanted = color.trim().toLowerCase()
    const key = Object.keys(mapping).find((candidate) => candidate.trim().toLowerCase() === wanted)
    return key ? mapping[key] : null
}

function collectBomRows(
    preview: PreviewBomResult,
    {
        artworkDeferred,
        totalKg = 0,
        selectedAddons = [],
        selectedSize,
        qty = 0,
        uom = "KG",
        unitWeightG = 0,
    }: {
        artworkDeferred?: boolean
        totalKg?: number
        selectedAddons?: Addon[]
        selectedSize?: ProductMasterSize
        qty?: number
        uom?: string
        unitWeightG?: number
    } = {},
): BomRow[] {
    const rows: BomRow[] = []
    const bom: any = preview.bom || {}
    const snapshot: any = (preview as any).bom_snapshot || {}

    for (const line of [...arr(bom.planning_lines), ...arr(snapshot.planning_lines)]) pushBomRow(rows, makeBomRow(line, "plan"))

    for (const step of arr((preview as any).bom_by_step)) {
        const stepName = pickText(step?.step_name, step?.name, step?.code)
        for (const line of [...arr(step?.lines), ...arr(step?.materials), ...arr(step?.planning_lines)]) {
            pushBomRow(rows, makeBomRow(line, "step", undefined, stepName))
        }
    }

    const buckets: Array<[string, BomCategory]> = [
        ["granules", "GRANULE"],
        ["films", "FILM"],
        ["inks", "INK"],
        ["chemicals", "CHEMICAL"],
        ["addons", "ADDON"],
        ["pod", "POD"],
        ["packaging", "PACKAGING"],
    ]
    for (const source of [bom, snapshot]) {
        for (const [key, category] of buckets) {
            for (const line of arr(source?.[key])) pushBomRow(rows, makeBomRow(line, key, category))
        }
    }

    for (const line of arr((preview as any).addons_snapshot)) pushBomRow(rows, makeBomRow(line, "add-on", "ADDON"))
    for (const addon of selectedAddons) pushBomRow(rows, selectedAddonBomRow(addon, selectedSize, qty, uom, unitWeightG))
    for (const line of arr((preview as any).pod_lines)) pushBomRow(rows, makeBomRow(line, "pod", "POD"))
    for (const line of arr((preview as any).packaging_lines)) {
        const category = String(line?.kind || line?.role || "").toUpperCase().includes("INNER")
            ? "INNER_POUCH"
            : matchCategory("PACKAGING", rowCode(line), rowName(line))
        pushBomRow(rows, makeBomRow(line, "packing", category))
    }

    const layers = arr(preview.layer_snapshot)
    const hasSubstrate = rows.some((row) => row.cat === "GRANULE" || row.cat === "FILM")
    if (!hasSubstrate && layers.length) {
        const totalThickness = layers.reduce((sum, layer) => sum + num(layer?.thickness_micron, layer?.thickness), 0)
        for (const layer of layers) {
            const thickness = num(layer?.thickness_micron, layer?.thickness)
            const qty = totalKg > 0 && totalThickness > 0 ? (totalKg * thickness) / totalThickness : 0
            pushBomRow(rows, {
                cat: "FILM",
                code: pickText(layer?.material_code, layer?.film_variant_code, layer?.film_variant, `L${rows.length + 1}`),
                name: pickText(layer?.material_name, layer?.film_variant_name, layer?.film_variant, "Layer film"),
                qty,
                uom: "KG",
                source: "layer",
                step: pickText(layer?.layer_code, layer?.layer),
                placeholder: qty <= 0,
            })
        }
    }

    const printing: any = (preview as any).printing_snapshot || {}
    const colors = arr(printing.color_names).length ? arr(printing.color_names) : [...arr(printing.front_colors), ...arr(printing.back_colors)]
    const hasInk = rows.some((row) => row.cat === "INK")
    if (!artworkDeferred && !hasInk && colors.length) {
        for (const color of Array.from(new Set(colors.map((value) => String(value || "").trim()).filter(Boolean)))) {
            const mapped = colorEntry(printing.color_mapping, color)
            const qty = num(printing.ink_gsm_by_color?.[color], mapped?.planned_issue_qty, mapped?.required_qty, mapped?.qty)
            pushBomRow(rows, {
                cat: "INK",
                code: pickText(mapped?.material_code, mapped?.code, `INK-${color.toUpperCase().replace(/\s+/g, "-")}`),
                name: pickText(mapped?.material_name, mapped?.name, `${color} ${pickText(printing.ink_base_family, "ink")}`),
                qty,
                uom: qty > 0 ? rowUom(mapped || { uom: "KG" }) : "MAP",
                source: qty > 0 ? "ink plan" : "ink map",
                swatchHex: pickText(mapped?.hex, mapped?.swatch_hex, mapped?.color_hex),
                placeholder: qty <= 0,
            })
        }
    }

    return rows
        .filter((row) => !(artworkDeferred && row.cat === "INK"))
        .sort((a, b) => CATEGORY_ORDER.indexOf(a.cat) - CATEGORY_ORDER.indexOf(b.cat) || a.code.localeCompare(b.code))
}

function selectedAddonBomRow(addon: Addon, selectedSize: ProductMasterSize | undefined, qty: number, uom: string, unitWeightG: number): BomRow {
    const purchaseUom = String(addon.addon_purchase_uom || addon.base_uom || "PCS").toUpperCase()
    const pieces = orderedPieces(qty, uom, unitWeightG)
    const mode = String(addon.weight_mode || "").toUpperCase()
    const dimensionMm = Math.max(0, Number(selectedSize?.width_mm || selectedSize?.height_mm || 0))
    let requiredQty = pieces
    let note = "per pouch"

    if (mode === "PER_MM" && dimensionMm > 0) {
        requiredQty = purchaseUom === "METER" ? (dimensionMm * pieces) / 1000 : (Number(addon.weight_value || 0) * dimensionMm * pieces) / 1000
        note = purchaseUom === "METER" ? `${fmtNum(dimensionMm, 0)} mm run/pouch` : `${fmtNum(Number(addon.weight_value || 0), 3)} g/mm`
    } else if (mode === "PER_PIECE") {
        requiredQty = purchaseUom === "KG" ? (Number(addon.weight_value || 0) * pieces) / 1000 : pieces
        note = purchaseUom === "KG" ? `${fmtNum(Number(addon.weight_value || 0), 3)} g/pouch` : "1 per pouch"
    } else if (mode === "FIXED") {
        requiredQty = purchaseUom === "KG" ? Number(addon.weight_value || 0) : pieces
        note = "fixed/add-on rule"
    }

    return {
        cat: "ADDON",
        code: addon.code,
        name: addon.name || addon.code,
        qty: requiredQty,
        uom: purchaseUom,
        source: "selected",
        step: "Add-ons",
        basis: mode || "ADDON",
        note: purchaseUom === "PCS" ? `${fmtNum(pieces, 0)} pouch pcs; no weight required` : note,
        placeholder: requiredQty <= 0,
    }
}

function orderedPieces(qty: number, uom: string, unitWeightG: number) {
    const amount = Number(qty || 0)
    if (!Number.isFinite(amount) || amount <= 0) return 0
    if (String(uom || "").toUpperCase() === "PCS") return amount
    return unitWeightG > 0 ? (amount * 1000) / unitWeightG : 0
}

function collectBomIssues(preview: PreviewBomResult): string[] {
    const bom: any = preview.bom || {}
    return [...arr((preview as any).pre_submit_blockers), ...arr((preview as any).blockers), ...arr((preview as any).errors), ...arr(bom.errors), ...arr(bom.warnings)]
        .map((issue) => (typeof issue === "string" ? issue : pickText(issue?.message, issue?.detail)))
        .filter(Boolean)
}

function collectStepGroups(rows: BomRow[]) {
    const groups: Array<{ step: string; rows: BomRow[] }> = []
    for (const row of rows) {
        const step = row.step || (
            row.cat === "INK" ? "Printing" :
            row.cat === "CHEMICAL" ? "Lamination" :
            row.cat === "INNER_POUCH" || row.cat === "PACKAGING" ? "Packing" :
            row.cat === "ADDON" ? "Add-ons" :
            row.cat === "POD" ? "POD" :
            "Material plan"
        )
        let group = groups.find((item) => item.step === step)
        if (!group) {
            group = { step, rows: [] }
            groups.push(group)
        }
        group.rows.push(row)
    }
    return groups
}

function displayTotalForGroup(rows: BomRow[]) {
    const totals = new Map<string, number>()
    for (const row of rows) {
        if (row.placeholder || !Number.isFinite(row.qty)) continue
        const uom = String(row.uom || "").toUpperCase()
        if (!uom || uom === "MAP") continue
        totals.set(uom, (totals.get(uom) || 0) + row.qty)
    }
    return Array.from(totals.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([uom, qty]) => fmtWeightSmart(qty, uom))
        .join(" + ")
}

function BomLineRow({ row }: { row: BomRow }) {
    return (
        <div className="grid grid-cols-[1fr_auto] items-center gap-2 border-t border-slate-50 px-3 py-1.5 text-xs font-bold">
            <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-1.5">
                    {row.swatchHex ? <span className="h-3 w-3 shrink-0 rounded-full border border-slate-200" style={{ background: row.swatchHex }} /> : null}
                    <span className="truncate font-mono text-slate-900">{row.code}</span>
                    <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[9px] font-black ring-1", CAT_CHIP[row.cat])}>{CAT_LABEL[row.cat]}</span>
                </div>
                <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-wide text-slate-400">
                    <span className="truncate">{row.name}</span>
                    {row.basis ? <span className="shrink-0 rounded bg-slate-100 px-1">{row.basis}</span> : null}
                    {row.note ? <span className="shrink-0 rounded bg-amber-50 px-1 text-amber-700">{row.note}</span> : null}
                    <span className={cn("shrink-0 rounded px-1", row.placeholder ? "bg-amber-100 text-amber-700" : "bg-blue-50 text-blue-700")}>{row.source}</span>
                </div>
            </div>
            <div className="text-right font-mono tabular-nums text-slate-800">{row.placeholder ? "mapped" : fmtWeightSmart(row.qty, row.uom)}</div>
        </div>
    )
}

function KpiTile({ label, value, sub, tone = "slate" }: { label: string; value: string; sub: string; tone?: "slate" | "green" | "amber" | "red" }) {
    const cls = tone === "green"
        ? "border-emerald-100 bg-emerald-50 text-emerald-950"
        : tone === "amber"
            ? "border-amber-100 bg-amber-50 text-amber-950"
            : tone === "red"
                ? "border-rose-100 bg-rose-50 text-rose-950"
                : "border-slate-100 bg-slate-50 text-slate-950"
    return (
        <div className={cn("rounded-xl border p-2.5", cls)}>
            <div className="text-[9.5px] font-black uppercase tracking-[0.13em] opacity-65">{label}</div>
            <div className="mt-1 font-mono text-base font-black tracking-normal">{value}</div>
            <div className="mt-0.5 truncate text-[10.5px] font-bold opacity-70">{sub}</div>
        </div>
    )
}

function rollTypeLabel(preview: PreviewBomResult): string {
    const g: any = preview.geometry_snapshot || {}
    const kind = String((preview as any).finished_good_type || (preview as any).fg_type || (preview as any).product_kind || g.finished_good_type || g.fg_type || g.product_kind || g.kind || "").toUpperCase()
    const raw = pickText(
        g.stock_form,
        g.width_basis,
        g.roll_type,
        g.roll_form,
        g.web_form,
        g.film_form,
        g.pouch_style_web_form,
        (preview as any).roll_type,
        (preview as any).roll_form,
    )
    if (raw) return normalizeRollType(raw)
    const style = String(g.pouch_style_master_code || g.pouch_style_master || g.pouch_style || "").toUpperCase()
    if (/TUBE|TUBING/.test(style)) return "Tube"
    if (/OPEN|WEB|SHEET|FLAT/.test(style)) return "Open web"
    if (kind === "ROLL") return "Roll"
    if (kind === "POUCH") {
        if (/CENTER|CENTRE|SEAL|TUB/.test(style)) return "Tube"
        return "Open web"
    }
    return ""
}

function normalizeRollType(value: string) {
    const raw = value.trim().replace(/[_-]+/g, " ")
    const upper = raw.toUpperCase()
    if (upper.includes("LAYFLAT") || upper.includes("TUBE") || upper.includes("TUBING")) return "Tube / layflat"
    if (upper.includes("FOLD")) return "Folded web"
    if (upper.includes("OPEN") && upper.includes("WEB")) return "Open web"
    if (upper === "OPEN") return "Open web"
    if (upper.includes("SHEET")) return "Sheet"
    if (upper.includes("WIDTH BASIS")) return raw.replace(/\b\w/g, (letter) => letter.toUpperCase())
    return raw.replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function rollCalcAxisLabel(preview: PreviewBomResult) {
    const g: any = preview.geometry_snapshot || {}
    const axis = String(g.pouch_style_roll_axis || g.trim_apply_to || g.width_basis || "").toUpperCase()
    if (axis === "WIDTH") return "Width axis"
    if (axis === "HEIGHT") return "Height axis"
    if (axis === "BOTH") return "Width + height"
    if (axis === "OPEN_WEB_WIDTH") return "Open-web width"
    if (axis === "LAYFLAT_WIDTH") return "Layflat width"
    if (axis === "FOLDED_WIDTH") return "Folded width"
    return axis ? normalizeRollType(axis) : "Size formula"
}

function Visual({ preview }: { preview: PreviewBomResult }) {
    const gradientId = React.useId().replace(/:/g, "")
    const g: any = preview.geometry_snapshot || {}
    const kind = String((preview as any).finished_good_type || (preview as any).fg_type || (preview as any).product_kind || g.fg_type || g.product_kind || g.kind || "POUCH").toUpperCase()
    const width = num(g.width_mm, g.final_width_mm, g.size_width_mm, g.width)
    const height = num(g.height_mm, g.final_height_mm, g.size_height_mm, g.height)
    const rollWidth = num(g.roll_width_mm, g.roll_width)
    const styleCode = String(g.pouch_style_master_code || g.pouch_style_master || g.pouch_style || "").toUpperCase()
    const gussetMm = num(g.gusset_mm, g.bottom_gusset_mm)
    const isStandup = /STAND|ZIP|BOTTOM/.test(styleCode) || gussetMm > 0
    return (
        <div className="grid place-items-center rounded-xl bg-slate-50 py-3">
            {kind === "ROLL" ? (
                <svg viewBox="0 0 140 110" width="120" height="94" className="drop-shadow-md">
                    <ellipse cx="38" cy="55" rx="14" ry="44" fill="#bae6fd" stroke="#0284c7" strokeWidth="1.2" />
                    <rect x="38" y="11" width="74" height="88" fill="#7dd3fc" stroke="#0284c7" strokeWidth="1.2" />
                    <ellipse cx="112" cy="55" rx="14" ry="44" fill="#38bdf8" stroke="#0284c7" strokeWidth="1.2" />
                    <ellipse cx="112" cy="55" rx="6" ry="18" fill="#f8fafc" stroke="#0369a1" strokeWidth="0.9" opacity="0.9" />
                    {rollWidth > 0 ? <text x="75" y="107" textAnchor="middle" fontSize="8" fill="#475569" fontWeight="700">{rollWidth} mm</text> : null}
                </svg>
            ) : (
                <svg viewBox="0 0 180 190" width="132" height="140" className="drop-shadow-md" role="img" aria-label="Pouch preview">
                    <defs>
                        <linearGradient id={`spr-${gradientId}`} x1="0" x2="1" y1="0" y2="1">
                            <stop offset="0%" stopColor="#bbf7d0" />
                            <stop offset="55%" stopColor="#86efac" />
                            <stop offset="100%" stopColor="#5eead4" />
                        </linearGradient>
                    </defs>
                    <path d="M 46 18 L 134 18 L 143 28 L 143 165 L 37 165 L 37 28 Z" fill={`url(#spr-${gradientId})`} stroke="#047857" strokeWidth="1.4" />
                    <rect x="42" y="24" width="96" height="8" rx="2" fill="#047857" opacity="0.28" />
                    <rect x="43" y="145" width="94" height="11" rx="3" fill="#065f46" opacity={isStandup ? 0.26 : 0.12} />
                    {isStandup ? <path d="M 48 159 C 71 171 109 171 132 159" fill="none" stroke="#064e3b" strokeWidth="1.3" opacity="0.5" /> : null}
                    {width > 0 ? <text x="90" y="181" textAnchor="middle" fontSize="8" fill="#475569" fontWeight="700">{width} mm</text> : null}
                    {height > 0 ? <text x="16" y="103" fontSize="8" fill="#475569" fontWeight="700" transform="rotate(-90 16 103)">{height} mm</text> : null}
                </svg>
            )}
        </div>
    )
}

export function SalesPreviewRail({ preview, loading, masterCode, sizeCode, qty, uom, lane, readiness, printCapable, artworkDeferred, selectedAddons = [], selectedSize }: SalesPreviewRailProps) {
    const card = "rounded-[18px] border border-slate-200 bg-white p-4 shadow-sm"
    const label = "text-[9.5px] font-black uppercase tracking-[0.13em] text-slate-500"

    if (!preview) {
        return (
            <aside className="space-y-3 xl:sticky xl:top-4">
                <div className={cn(card, "grid min-h-[220px] place-items-center text-center")}>
                    <div>
                        <div className="text-2xl">📦</div>
                        <div className="mt-2 text-sm font-black text-slate-700">{loading ? "Computing live preview…" : "Pick a master, size & axes"}</div>
                        <p className="mx-auto mt-1 max-w-[220px] text-[11px] font-semibold text-slate-500">Geometry, weight, material-wise BOM and the lane-up plan compute here in real time.</p>
                    </div>
                </div>
            </aside>
        )
    }

    const g: any = preview.geometry_snapshot || {}
    const width = num(g.width_mm, g.final_width_mm, g.size_width_mm, g.width)
    const height = num(g.height_mm, g.final_height_mm, g.size_height_mm, g.height)
    const totalUm = num(
        g.thickness_um,
        g.thickness_micron,
        (preview.layer_snapshot || []).reduce((s: number, l: any) => s + (Number(l?.thickness_micron) || 0), 0),
    )
    const childWeb = num(lane.childTargetMm, g.child_target_width_mm, g.target_child_width_mm, g.roll_width_mm)
    const unitG = num(preview.unit_weight_g)
    const totalKg = num(preview.total_weight_kg)
    const pouches = String(uom || "").toUpperCase() === "PCS" ? Number(qty || 0) : unitG > 0 && totalKg > 0 ? Math.round((totalKg * 1000) / unitG) : 0
    const rollType = rollTypeLabel(preview)
    const calcAxis = rollCalcAxisLabel(preview)
    const masterSizeLabel = [masterCode, sizeCode].filter(Boolean).join(" · ")

    const rows = collectBomRows(preview, { artworkDeferred, totalKg, selectedAddons, selectedSize, qty, uom, unitWeightG: unitG })
    const substrateSubtotal = rows
        .filter((r) => (r.cat === "GRANULE" || r.cat === "FILM") && String(r.uom).toUpperCase() === "KG" && !r.placeholder)
        .reduce((s, r) => s + (Number.isFinite(r.qty) ? r.qty : 0), 0)
    const lanePct = lane.plannedParentMm > 0 ? Math.min(100, Math.round((childWeb * lane.laneCount / lane.plannedParentMm) * 100)) : 100
    const readinessOk = readiness.filter((item) => item.ok).length
    const realRows = rows.filter((row) => !row.placeholder).length
    const materialFamilies = new Set(rows.map((row) => row.cat)).size
    const inkRows = rows.filter((row) => row.cat === "INK")
    const bomIssues = collectBomIssues(preview)
    const stepGroups = collectStepGroups(rows)
    const groupedRows = CATEGORY_ORDER.map((category) => ({
        category,
        rows: rows.filter((row) => row.cat === category),
    })).filter((group) => group.rows.length)


    return (
        <aside className="space-y-3 xl:sticky xl:top-4">
            <div className={card}>
                <div className="mb-2 flex items-center justify-between">
                    <div className="min-w-0">
                        <div className={label}>Live preview</div>
                        {masterSizeLabel ? <div className="truncate font-mono text-[10px] font-bold text-slate-400">{masterSizeLabel}</div> : null}
                    </div>
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-200">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> live
                    </span>
                </div>
                <div className="flex gap-3">
                    <div className="w-28 shrink-0"><Visual preview={preview} /></div>
                    <div className="grid flex-1 grid-cols-2 gap-1.5 text-xs">
                        <div className="rounded-lg bg-slate-50 p-2 ring-1 ring-slate-100"><div className={label}>W x H</div><div className="font-mono font-black text-slate-900">{width > 0 ? `${width} x ${height || 0}` : "—"}</div></div>
                        <div className="rounded-lg bg-slate-50 p-2 ring-1 ring-slate-100"><div className={label}>Thickness</div><div className="font-mono font-black text-slate-900">{totalUm > 0 ? `${totalUm} micron` : "—"}</div></div>
                        <div className="rounded-lg bg-slate-50 p-2 ring-1 ring-slate-100"><div className={label}>Child web</div><div className="font-mono font-black text-slate-900">{childWeb > 0 ? `${Math.round(childWeb)} mm` : "—"}</div></div>
                        <div className="rounded-lg bg-blue-50 p-2 ring-1 ring-blue-100"><div className={cn(label, "text-blue-700")}>Total weight</div><div className="font-mono font-black text-blue-900">{totalKg > 0 ? fmtWeightSmart(totalKg, "KG") : unitG > 0 ? "calc after qty" : "Needs unit wt"}</div></div>
                        <div className="rounded-lg bg-emerald-50 p-2 ring-1 ring-emerald-100"><div className={cn(label, "text-emerald-700")}>Wt / pouch</div><div className="font-mono font-black text-emerald-800">{unitG > 0 ? `${fmtNum(unitG, 2)} g` : "—"}</div></div>
                        <div className="rounded-lg bg-indigo-50 p-2 ring-1 ring-indigo-100">
                            <div className={cn(label, "text-indigo-700")}>Roll form</div>
                            <div className="flex items-center justify-between gap-2">
                                <span className="font-mono font-black text-indigo-900">{rollType || "—"}</span>
                            </div>
                        </div>
                        <div className="col-span-2 rounded-lg bg-violet-50 p-2 ring-1 ring-violet-100">
                            <div className={cn(label, "text-violet-700")}>Calculation axis</div>
                            <div className="flex items-center justify-between gap-2">
                                <span className="font-mono font-black text-violet-900">{calcAxis}</span>
                                {pouches ? <span className="text-[10px] font-bold text-violet-500">{fmtNum(pouches)} pcs basis</span> : null}
                            </div>
                        </div>
                    </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                    <KpiTile
                        label="BOM rows"
                        value={rows.length ? `${realRows}/${rows.length}` : "0"}
                        sub={rows.length ? `${materialFamilies} families` : "No material plan"}
                        tone={rows.length && realRows === rows.length ? "green" : rows.length ? "amber" : "red"}
                    />
                    <KpiTile
                        label="Readiness"
                        value={`${readinessOk}/${readiness.length}`}
                        sub={readinessOk === readiness.length ? "Planner-ready" : "Needs action"}
                        tone={readinessOk === readiness.length ? "green" : "amber"}
                    />
                    <KpiTile
                        label="Lane use"
                        value={lanePct > 0 ? `${lanePct}%` : "—"}
                        sub={lane.plannedParentMm > 0 ? `${lane.laneCount}-up on ${Math.round(lane.plannedParentMm)}mm` : "Pick lane"}
                        tone={lanePct > 0 && lanePct <= 100 ? "green" : "slate"}
                    />
                    <KpiTile
                        label={printCapable ? "Ink map" : "Packing"}
                        value={printCapable ? (artworkDeferred ? "Deferred" : `${inkRows.length}`) : rows.some((row) => row.cat === "INNER_POUCH" || row.cat === "PACKAGING") ? "Ready" : "—"}
                        sub={printCapable ? (inkRows.length ? "Mapped colors visible" : "No ink rows yet") : "Overrides included"}
                        tone={printCapable ? (artworkDeferred ? "amber" : inkRows.length ? "green" : "red") : "slate"}
                    />
                </div>
            </div>

            <div className={card}>
                <div className="mb-2 flex items-center justify-between">
                    <div className={label}>BOM · material-wise · for {fmtNum(qty)} {uom}</div>
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 ring-1 ring-emerald-200">live</span>
                </div>
                {bomIssues.length ? (
                    <div className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-900 ring-1 ring-amber-200">
                        {bomIssues.slice(0, 2).join(" · ")}
                    </div>
                ) : null}
                {rows.length === 0 ? (
                    <div className="rounded-lg bg-slate-50 px-3 py-2 text-[11px] font-semibold text-slate-500 ring-1 ring-slate-100">BOM resolves once axes + size are set.</div>
                ) : (
                    <div className="space-y-2">
                        <div className="overflow-hidden rounded-xl ring-1 ring-indigo-200">
                            <div className="grid grid-cols-[1fr_auto] gap-2 bg-indigo-50 px-3 py-1.5 text-[9px] font-black uppercase tracking-wider text-indigo-700">
                                <div>Step-by-step issue plan</div>
                                <div className="text-right">{stepGroups.length} steps</div>
                            </div>
                            {stepGroups.map((group) => (
                                <div key={group.step} className="border-t border-indigo-50">
                                    <div className="grid grid-cols-[1fr_auto] gap-2 bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-slate-500">
                                        <div>{group.step}</div>
                                        <div>{group.rows.length} row{group.rows.length === 1 ? "" : "s"}</div>
                                    </div>
                                    {group.rows.map((r, i) => <BomLineRow key={`step-${group.step}-${r.cat}-${r.code}-${i}`} row={r} />)}
                                </div>
                            ))}
                        </div>
                        {groupedRows.map((group) => {
                            const groupTotal = displayTotalForGroup(group.rows)
                            return (
                                <div key={group.category} className="overflow-hidden rounded-xl ring-1 ring-slate-200">
                                    <div className="grid grid-cols-[1fr_auto] gap-2 bg-slate-50 px-3 py-1.5 text-[9px] font-black uppercase tracking-wider text-slate-500">
                                        <div>{CAT_TITLE[group.category]}</div>
                                        <div className="text-right">{groupTotal || `${group.rows.length} rows`}</div>
                                    </div>
                                    {group.rows.map((r, i) => <BomLineRow key={`${r.cat}-${r.code}-${i}`} row={r} />)}
                                </div>
                            )
                        })}
                        {substrateSubtotal > 0 ? (
                            <div className="grid grid-cols-[1fr_auto] items-center gap-2 rounded-xl bg-slate-50/60 px-3 py-1.5 text-xs font-black ring-1 ring-slate-200">
                                <div className="text-slate-900">Substrate subtotal</div>
                                <div className="text-right font-mono tabular-nums text-indigo-700">{fmtWeightSmart(substrateSubtotal, "KG")}</div>
                            </div>
                        ) : null}
                    </div>
                )}
                <div className="mt-1.5 text-[10px] font-semibold text-slate-400">Material-wise only — no cost / margin on this page.</div>
            </div>

            <div className={card}>
                <div className={cn(label, "mb-2")}>Lane-up plan · parent {lane.plannedParentMm > 0 ? `${Math.round(lane.plannedParentMm)} mm` : "—"}</div>
                <div className="flex h-9 gap-0.5 overflow-hidden rounded-lg ring-1 ring-slate-200">
                    {Array.from({ length: Math.max(1, lane.laneCount) }).map((_, i) => (
                        <div key={i} className="grid place-items-center bg-indigo-500 text-[10px] font-black text-white" style={{ flex: childWeb > 0 ? childWeb : 1 }}>
                            {lane.laneCount <= 3 ? `${Math.round(childWeb)}mm` : ""}
                        </div>
                    ))}
                    {lane.plannedParentMm > childWeb * lane.laneCount + 1 ? (
                        <div className="grid flex-1 place-items-center bg-slate-200 text-[9px] font-bold text-slate-500" style={{ flex: Math.max(0.001, lane.plannedParentMm - childWeb * lane.laneCount) }}>rem</div>
                    ) : null}
                </div>
                <div className="mt-1.5 text-[11px] font-bold text-slate-500">
                    {lane.laneCount}-up · child {childWeb > 0 ? `${Math.round(childWeb)} mm` : "—"} · trim {Math.round(lane.trimMm || 0)} mm
                    {lane.remainderMm && lane.remainderMm > 0 ? ` · rem ${Math.round(lane.remainderMm)} mm ${String(lane.remainderDisposition || "").toLowerCase()}` : ""}
                </div>
            </div>

            <div className={card}>
                <div className={cn(label, "mb-2")}>Line readiness</div>
                <div className="space-y-1 text-[12px] font-bold">
                    {readiness.map((r, i) => (
                        <div key={i} className="flex items-center gap-2">
                            <span className={r.ok ? "text-emerald-600" : "text-amber-500"}>{r.ok ? "✓" : "○"}</span>
                            <span className={r.ok ? "text-slate-700" : "text-slate-500"}>{r.label}</span>
                            {r.hint ? <span className="font-semibold text-slate-400">· {r.hint}</span> : null}
                        </div>
                    ))}
                </div>
            </div>
        </aside>
    )
}

"use client"

/**
 * V3.7 Live BOM Rail — fresh build matching the docs/mockups/sales-v37-create-bom.html rail.
 *
 * Stacked cards top → bottom:
 *   1. Header pill row (eyebrow + status badge)
 *   2. Identity card (selected tuple + EXISTS/NEW badge + customer overlay match)
 *   3. Visual pouch render (SVG silhouette by product_kind, with dim labels)
 *   4. Geometry mini-stat strip (W×H, thickness, roll width, unit g, total kg + pouches)
 *   5. Layer stack (horizontal coloured bars proportional to thickness, grade chip)
 *   6. Material breakdown grouped by Film / Ink / Add-ons / Catalog refs (qty + UOM)
 *   7. BOM by step ribbon (5 pills, coloured by step kind, with material count)
 *   8. Stock-source stacked bar (FG / WIP / Fresh) + 3 stat tiles + footnote
 *   9. Checks list (green ✓ / amber ⚠ / red ✕)
 *  10. Sticky emerald "Add line" footer with this line's KG + ₹ subtotal (optional)
 *
 * Wires only to `PreviewBomResult` fields the backend already returns + optional
 * line context props (qty, uom, unit_price) to render the sticky footer.
 *
 * No new service calls, no field shape changes.
 */

import * as React from "react"
import { CheckCircle2, AlertTriangle, Sparkles, ArrowRight } from "lucide-react"
import { cn } from "@/lib/utils"
import type { PreviewBomResult } from "@/services/product-master"

// ─── Props ───────────────────────────────────────────────────────

interface LiveBomRailProps {
    title?: string
    subtitle?: string
    preview?: PreviewBomResult | null
    loading?: boolean
    /** Optional badge slot above the title. */
    badge?: React.ReactNode
    className?: string
    /**
     * When true, the rail is `position: sticky` with its own internal scroll.
     * Default false — the rail flows inline so the page has a single scroll surface
     * (multiple scroll contexts feel buggy on long forms).
     */
    sticky?: boolean
    /**
     * "variant" — show the engineering invariant only and render dashed placeholders
     *   for artwork-driven ink, optional add-ons, and POD (unless locked at master).
     * "order" (default) — show full live BOM including ink + add-ons + POD as
     *   resolved by the order/overlay context.
     */
    scope?: "variant" | "order"
    /** Hints about what's locked at master (used when scope="variant" to gate placeholders) */
    masterFlags?: {
        print_capable?: boolean
        pod_locked?: boolean
        addons_axis?: "off" | "optional" | "required"
        artwork_deferred?: boolean
        artwork_attached?: boolean
    }
    /** Optional template route steps to render as a top route ribbon. */
    routeSteps?: Array<{ index: number; name: string; process_code?: string; transition?: string; has_artwork?: boolean }>
    routeTemplateName?: string
    /** Optional: order-line context to render the sticky add-line footer. */
    line?: {
        qty?: number
        uom?: string
        unitPrice?: number
        priceBasis?: "KG" | "PCS"
        onAdd?: () => void
        addLabel?: string
        addDisabled?: boolean
    }
}

// ─── Helpers ─────────────────────────────────────────────────────

function fmtNum(n: number | string | undefined | null, max = 0): string {
    const v = Number(n)
    if (!Number.isFinite(v)) return "—"
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: max }).format(v)
}

function fmtQty(v: number | undefined | null): string {
    const n = Number(v)
    if (!Number.isFinite(n)) return "—"
    if (Math.abs(n) >= 100) return n.toFixed(0)
    if (Math.abs(n) >= 1) return n.toFixed(2)
    return n.toFixed(3)
}

/**
 * fmtWeightSmart — display weight in the most readable unit.
 *
 * Used in BOM rail rows + totals where the underlying number is always kg
 * but very small layers (adhesive, ink, solvent) read as 0.000 KG and look
 * empty. We convert to g (or mg) on display only — the actual stored unit
 * stays KG.
 *
 * Returns the full label including unit (e.g. "500 g", "1.2 kg", "12 mg").
 */
function fmtWeightSmart(kg: number | undefined | null, baseUom?: string): string {
    const u = String(baseUom || "KG").toUpperCase()
    // Non-weight UOMs (PCS, METER) just pass through the existing qty formatter.
    if (u !== "KG") {
        const n = Number(kg || 0)
        return `${fmtQty(n)} ${u.toLowerCase()}`
    }
    const n = Number(kg || 0)
    if (!Number.isFinite(n) || n === 0) return "0 g"
    const abs = Math.abs(n)
    if (abs >= 1) return `${fmtQty(n)} kg`
    // < 1 kg → grams. Sub-gram → milligrams.
    const grams = n * 1000
    if (Math.abs(grams) >= 1) {
        // 1 g and above — show 1 decimal up to 10g, integer after.
        if (Math.abs(grams) >= 100) return `${grams.toFixed(0)} g`
        if (Math.abs(grams) >= 10) return `${grams.toFixed(1)} g`
        return `${grams.toFixed(2)} g`
    }
    const mg = grams * 1000
    return `${mg.toFixed(1)} mg`
}

function fmtCurrency(v: number | undefined | null): string {
    const n = Number(v)
    if (!Number.isFinite(n) || n <= 0) return "—"
    if (n >= 100000) return `₹${(n / 100000).toFixed(2)} L`
    return `₹${new Intl.NumberFormat("en-IN").format(Math.round(n))}`
}

// ─── Root ────────────────────────────────────────────────────────

export function LiveBomRail({ title, subtitle, preview, loading, badge, className, sticky, scope = "order", masterFlags, routeSteps, routeTemplateName, line }: LiveBomRailProps) {
    const empty = !preview
    const blockers = preview?.blockers?.length || 0
    const isVariantScope = scope === "variant"
    const effectiveTitle = title ?? (isVariantScope ? "Engineering BOM · variant scope" : "Live BOM preview")
    return (
        <aside
            className={cn(
                "flex flex-col rounded-2xl border border-violet-200 bg-gradient-to-b from-violet-50/30 via-white to-white shadow-md overflow-hidden",
                sticky ? "max-h-[calc(100vh-6rem)] lg:sticky lg:top-4" : "",
                className,
            )}
        >
            {/* ─── Header pill row ─── */}
            <header className="flex items-center justify-between gap-2 border-b border-violet-100 bg-gradient-to-r from-violet-50 via-white to-emerald-50/40 px-5 py-3">
                <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500 to-emerald-500 text-white shadow-sm">⚡</span>
                    <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-violet-700">{effectiveTitle}</div>
                        <div className="font-display text-sm font-bold text-slate-900 leading-tight">
                            {empty
                                ? loading ? "Computing preview…" : "Pick axes to preview"
                                : blockers > 0
                                    ? `${blockers} blocker${blockers === 1 ? "" : "s"} to resolve`
                                    : preview!.variant_status === "EXISTS"
                                        ? "All checks pass · variant exists"
                                        : "All checks pass · new variant on submit"}
                        </div>
                        {subtitle ? <div className="text-[10px] text-slate-500">{subtitle}</div> : null}
                    </div>
                </div>
                {badge ?? (preview ? (
                    blockers === 0 ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 ring-1 ring-emerald-300">
                            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" /> live
                        </span>
                    ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700 ring-1 ring-rose-200">
                            <AlertTriangle className="h-3 w-3" /> blocked
                        </span>
                    )
                ) : null)}
            </header>

            {/* ─── Scope chip row (only for variant scope, when preview exists) ─── */}
            {isVariantScope && !empty ? <ScopeChipRow masterFlags={masterFlags} /> : null}

            {/* ─── Body ─── */}
            <div className={cn("flex-1 px-5 py-3 space-y-3", sticky && "overflow-y-auto")}>
                {routeSteps && routeSteps.length > 0 ? <RouteRibbon steps={routeSteps} templateName={routeTemplateName} /> : null}
                {empty ? <EmptyState loading={loading} /> : <PreviewBody preview={preview!} scope={scope} masterFlags={masterFlags} />}
            </div>

            {/* ─── Sticky add-line footer ─── */}
            {line && !empty ? <LineFooter line={line} preview={preview!} /> : null}
        </aside>
    )
}

// ─── Scope chip row ──────────────────────────────────────────────

function RouteRibbon({ steps, templateName }: { steps: NonNullable<LiveBomRailProps["routeSteps"]>; templateName?: string }) {
    const TONE: Record<string, string> = {
        EXTRUSION: "bg-blue-100 text-blue-800 ring-blue-300",
        PRINTING: "bg-rose-100 text-rose-800 ring-rose-300",
        ROTO: "bg-rose-100 text-rose-800 ring-rose-300",
        FLEXO: "bg-rose-100 text-rose-800 ring-rose-300",
        LAMINATION: "bg-amber-100 text-amber-800 ring-amber-300",
        SLITTING: "bg-cyan-100 text-cyan-800 ring-cyan-300",
        POUCHING: "bg-emerald-100 text-emerald-800 ring-emerald-300",
        PACKING: "bg-violet-100 text-violet-800 ring-violet-300",
        DEFAULT: "bg-slate-100 text-slate-800 ring-slate-300",
    }
    const toneFor = (name?: string, code?: string) => {
        const key = (code || name || "").toUpperCase()
        return TONE[key] || Object.entries(TONE).find(([k]) => key.includes(k))?.[1] || TONE.DEFAULT
    }
    return (
        <section className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50/60 via-white to-fuchsia-50/40 p-3 shadow-sm">
            <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-700">Live route{templateName ? ` · ${templateName}` : ""}</div>
                <span className="text-[10px] font-bold text-slate-500">{steps.length} steps</span>
            </div>
            <div className="flex flex-wrap items-center gap-1">
                {steps.map((s, i) => {
                    const tone = toneFor(s.name, s.process_code)
                    const label = (s.name || s.process_code || `step ${i + 1}`).toLowerCase()
                    return (
                        <React.Fragment key={`r-${s.index ?? i}`}>
                            <span className={cn("inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-bold ring-1 capitalize", tone)}>
                                <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-white/80 text-[9px] font-black">{s.index ?? i + 1}</span>
                                {label}
                                {s.has_artwork ? <span className="inline-flex h-4 items-center rounded-full bg-fuchsia-600 px-1 text-[9px] font-black text-white">art</span> : null}
                            </span>
                            {i < steps.length - 1 ? <span className="text-slate-400 text-[12px] font-bold">›</span> : null}
                        </React.Fragment>
                    )
                })}
            </div>
        </section>
    )
}

function ScopeChipRow({ masterFlags }: { masterFlags?: LiveBomRailProps["masterFlags"] }) {
    const podLocked = !!masterFlags?.pod_locked
    const printCapable = !!masterFlags?.print_capable
    const addonsAxis = masterFlags?.addons_axis || "off"
    const deferred: string[] = []
    if (printCapable) deferred.push("artwork", "ink")
    if (addonsAxis !== "off") deferred.push("add-ons")
    if (!podLocked) deferred.push("POD")
    deferred.push("qty")
    return (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-violet-100 bg-violet-50/60 px-5 py-2 text-[10px]">
            <span className="font-black uppercase tracking-[0.18em] text-violet-700">Resolved on order</span>
            {deferred.map((d) => (
                <span key={d} className="inline-flex items-center rounded-full bg-white px-2 py-0.5 font-bold text-violet-700 ring-1 ring-violet-200">+ {d}</span>
            ))}
            {podLocked ? <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 font-bold text-emerald-800 ring-1 ring-emerald-300">POD locked at master</span> : null}
        </div>
    )
}

// ─── Empty / loading state ───────────────────────────────────────

function EmptyState({ loading }: { loading?: boolean }) {
    return (
        <div className="flex h-full min-h-[260px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white/70 p-6 text-center">
            <Sparkles className="h-6 w-6 text-slate-300" />
            <div className="mt-2 text-sm font-semibold text-slate-700">
                {loading ? "Computing live preview…" : "Pick axes to preview"}
            </div>
            <p className="mt-1 max-w-xs text-xs text-slate-500">
                Pick a customer, product master, size and per-layer axes to compute geometry,
                layers, packaging and BOM in real time.
            </p>
        </div>
    )
}

// ─── Preview body ────────────────────────────────────────────────

function PreviewBody({ preview, scope, masterFlags }: { preview: PreviewBomResult; scope: "variant" | "order"; masterFlags?: LiveBomRailProps["masterFlags"] }) {
    return (
        <>
            <IdentityCard preview={preview} />
            <PouchRender preview={preview} />
            <GeometryStrip preview={preview} />
            <QuantityConversion preview={preview} />
            <LayerStack preview={preview} />
            <MaterialBreakdown preview={preview} scope={scope} masterFlags={masterFlags} />
            <StockSourceBar preview={preview} />
            <ChecksList preview={preview} />
        </>
    )
}

function QuantityConversion({ preview }: { preview: PreviewBomResult }) {
    const g: any = preview.geometry_snapshot || {}
    const fgType = String(
        (preview as any).finished_good_type
        || (preview as any).fg_type
        || (preview as any).product_kind
        || g.finished_good_type
        || g.fg_type
        || "POUCH",
    ).toUpperCase()
    const previewPayload: any = (preview as any).preview_payload || {}
    const orderQty = Number(previewPayload.order_qty ?? previewPayload.quantity ?? 0)
    const orderUom = String(previewPayload.uom || previewPayload.quantity_uom || "").toUpperCase()
    const unitWeightG = Number(preview.unit_weight_g || 0)
    const totalKg = Number(preview.total_weight_kg || (fgType === "ROLL" ? orderQty : 0))
    if (fgType === "ROLL") {
        return (
            <section className="rounded-2xl border border-slate-200 bg-white p-3">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">Quantity conversion</div>
                <div className="rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-100">
                    <div className="text-[9px] font-black uppercase tracking-wider text-slate-500">Roll order</div>
                    <div className="font-mono text-sm font-black text-slate-900">{fmtQty(totalKg)} kg</div>
                    <div className="mt-1 text-[10px] font-semibold text-slate-500">Roll masters are planned and issued in KG only.</div>
                </div>
            </section>
        )
    }

    const pieces = orderUom === "PCS" && orderQty > 0
        ? orderQty
        : unitWeightG > 0 && totalKg > 0
            ? (totalKg * 1000) / unitWeightG
            : 0
    const primary = preview.packaging_snapshot?.primary_inner_pack || {}
    const pcsPerInner = Number(primary.pcs_per_pack || 0)
    const innerPacks = pieces > 0 && pcsPerInner > 0 ? Math.ceil(pieces / pcsPerInner) : 0
    const cells = [
        { label: "Order", value: orderQty > 0 ? `${fmtQty(orderQty)} ${orderUom || "KG"}` : "—" },
        { label: "Order kg", value: totalKg > 0 ? `${fmtQty(totalKg)} kg` : "—" },
        { label: "Pieces", value: pieces > 0 ? fmtNum(Math.round(pieces)) : "—" },
        { label: "Pcs / inner", value: pcsPerInner > 0 ? fmtNum(pcsPerInner) : "not set" },
        { label: "Inner pouches", value: innerPacks > 0 ? `${fmtNum(innerPacks)} pcs` : "—" },
    ]
    return (
        <section className="rounded-2xl border border-slate-200 bg-white p-3">
            <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Quantity conversion</div>
                {primary.material_code ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-amber-800 ring-1 ring-amber-100">{primary.material_code}</span> : null}
            </div>
            <div className="grid grid-cols-2 gap-2">
                {cells.map((cell) => (
                    <div key={cell.label} className="rounded-lg bg-slate-50 px-2.5 py-1.5 ring-1 ring-slate-100">
                        <div className="text-[9px] font-black uppercase tracking-wider text-slate-500">{cell.label}</div>
                        <div className="font-mono text-sm font-bold tabular-nums text-slate-900">{cell.value}</div>
                    </div>
                ))}
            </div>
            <div className="mt-2 text-[10px] font-semibold text-slate-500">
                Pouches use unit weight for KG ↔ pieces conversion. Inner-pouch demand is ceil(pieces / pcs per inner).
            </div>
        </section>
    )
}

// ─── 1 · Identity card ───────────────────────────────────────────

function IdentityCard({ preview }: { preview: PreviewBomResult }) {
    const tuple = summariseTuple(preview)
    return (
        <section className="rounded-2xl bg-gradient-to-br from-violet-100 via-violet-50 to-white ring-1 ring-violet-200 px-3 py-2.5 shadow-sm">
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-violet-700">Selected tuple</div>
            <div className="mt-1 font-mono text-[12px] font-bold leading-snug text-violet-900 break-words">
                {tuple}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
                <span className={cn(
                    "rounded px-1.5 py-0.5 font-bold ring-1",
                    preview.variant_status === "EXISTS"
                        ? "bg-emerald-100 text-emerald-800 ring-emerald-300"
                        : "bg-blue-100 text-blue-800 ring-blue-300",
                )}>
                    {preview.variant_status === "EXISTS" ? "EXISTS" : "NEW"}{preview.variant_code ? ` · ${preview.variant_code}` : ""}
                </span>
                {preview.overlay_match?.source && preview.overlay_match.source !== "NONE" ? (
                    <span className="rounded bg-fuchsia-100 px-1.5 py-0.5 font-bold text-fuchsia-800 ring-1 ring-fuchsia-300">
                        overlay · {preview.overlay_match.source.toLowerCase().replace("_", " ")}
                    </span>
                ) : null}
            </div>
        </section>
    )
}

function summariseTuple(preview: PreviewBomResult): string {
    const parts: string[] = []
    const g = preview.geometry_snapshot || {}
    if (g.size_code) parts.push(g.size_code)
    else if (g.width_mm) parts.push(`${g.width_mm}×${g.height_mm || 0}`)
    preview.layer_snapshot?.forEach((l: any) => {
        if (l.film_variant_code && l.thickness_micron != null)
            parts.push(`${l.film_variant_code} ${l.thickness_micron}μ`)
        if (l.grade) parts.push(l.grade)
    })
    return parts.length ? parts.join(" · ") : "—"
}

// ─── 2 · Visual pouch render ─────────────────────────────────────

function PouchRender({ preview }: { preview: PreviewBomResult }) {
    const gradientId = React.useId().replace(/:/g, "")
    const g = preview.geometry_snapshot || {}
    const kind = String(
        (preview as any).finished_good_type
        || (preview as any).fg_type
        || (preview as any).product_kind
        || g.finished_good_type
        || g.fg_type
        || g.product_kind
        || g.kind
        || "POUCH",
    ).toUpperCase()
    const width = Number(g.width_mm ?? g.final_width_mm ?? g.size_width_mm ?? g.width ?? g.effective_width_mm ?? 0)
    const height = Number(g.height_mm ?? g.final_height_mm ?? g.size_height_mm ?? g.height ?? g.effective_height_mm ?? 0)
    const rollWidth = Number(g.roll_width_mm ?? g.roll_width ?? 0)
    const styleCode = String(g.pouch_style_master_code || g.pouch_style_master || g.pouch_style || "").toUpperCase()
    const featureHaystack = `${styleCode} ${JSON.stringify(preview.addons_snapshot || [])} ${JSON.stringify(preview.bom?.planning_lines || preview.bom_snapshot?.planning_lines || [])}`.toUpperCase()
    const gussetMm = Number(g.gusset_mm || g.bottom_gusset_mm || 0)
    const flapMm = Number(g.flap_tape_mm || g.flap_mm || 0)
    const isCenterSeal = /CENTER|CENTRE/.test(styleCode)
    const isSideGusset = /SIDE[_\s-]?GUSSET/.test(styleCode) || gussetMm > 0
    const isStandup = /STAND|ZIP|BOTTOM/.test(styleCode) || gussetMm > 0
    const isSpout = /SPOUT/.test(styleCode) || /SPOUT/.test(featureHaystack)
    const hasDcut = /D[\s_-]?CUT|DIE[\s_-]?CUT|ROUND[\s_-]?CUT|HANDLE/.test(featureHaystack)
    const hasAirHole = /AIR[\s_-]?HOLE|VENT|PUNCH|HOLE/.test(featureHaystack)
    const hasTape = flapMm > 0 || /TAPE|ZIP|ZIPPER|SEALING/.test(featureHaystack)
    const featureTags = [
        styleCode ? styleCode.replace(/_/g, " ").toLowerCase() : "pouch",
        isSideGusset ? "side gusset" : null,
        isCenterSeal ? "center seal" : null,
        hasDcut ? "cut" : null,
        hasAirHole ? "air holes" : null,
        hasTape ? "tape/zip" : null,
        isSpout ? "spout" : null,
    ].filter(Boolean).slice(0, 4)
    return (
        <section className="rounded-2xl border border-slate-200 bg-white px-3 py-3">
            <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">
                <span>Visual</span>
                <span className="font-mono">{kind}</span>
            </div>
            <div className="flex items-center justify-center bg-slate-50 rounded-xl py-3">
                {kind === "POUCH" ? (
                    <svg viewBox="0 0 180 190" width="150" height="158" className="drop-shadow-md" role="img" aria-label="Pouch visual preview">
                        <defs>
                            <linearGradient id={`lbr-pouch-${gradientId}`} x1="0" x2="1" y1="0" y2="1">
                                <stop offset="0%" stopColor="#bbf7d0" />
                                <stop offset="55%" stopColor="#86efac" />
                                <stop offset="100%" stopColor="#5eead4" />
                            </linearGradient>
                        </defs>
                        <path d="M 46 18 L 134 18 L 143 28 L 143 165 L 37 165 L 37 28 Z" fill={`url(#lbr-pouch-${gradientId})`} stroke="#047857" strokeWidth="1.4" />
                        <rect x="42" y="24" width="96" height="8" rx="2" fill="#047857" opacity="0.28" />
                        <rect x="43" y="145" width="94" height="11" rx="3" fill="#065f46" opacity={isStandup ? 0.26 : 0.12} />
                        <path d="M 47 18 L 37 28 L 37 165" fill="none" stroke="#047857" strokeWidth="0.8" strokeDasharray="3 3" opacity="0.55" />
                        <path d="M 133 18 L 143 28 L 143 165" fill="none" stroke="#047857" strokeWidth="0.8" strokeDasharray="3 3" opacity="0.55" />
                        {isSideGusset ? (
                            <>
                                <path d="M 51 35 C 61 62 61 123 51 150" fill="none" stroke="#065f46" strokeWidth="1" opacity="0.45" />
                                <path d="M 129 35 C 119 62 119 123 129 150" fill="none" stroke="#065f46" strokeWidth="1" opacity="0.45" />
                            </>
                        ) : null}
                        {isCenterSeal ? <path d="M 90 34 L 90 152" stroke="#065f46" strokeWidth="1.1" strokeDasharray="5 4" opacity="0.42" /> : null}
                        {hasTape ? <path d="M 54 41 L 126 41" stroke="#064e3b" strokeWidth="3" strokeLinecap="round" opacity="0.35" /> : null}
                        {hasDcut ? <path d="M 72 37 C 75 52 105 52 108 37" fill="none" stroke="#064e3b" strokeWidth="2.2" strokeLinecap="round" opacity="0.7" /> : null}
                        {hasAirHole ? (
                            <>
                                <circle cx="64" cy="56" r="2.3" fill="#ecfeff" stroke="#0f766e" strokeWidth="0.8" />
                                <circle cx="116" cy="56" r="2.3" fill="#ecfeff" stroke="#0f766e" strokeWidth="0.8" />
                            </>
                        ) : null}
                        {isSpout ? (
                            <>
                                <path d="M 123 16 L 148 7 L 154 21 L 134 31 Z" fill="#99f6e4" stroke="#047857" strokeWidth="1" />
                                <rect x="145" y="7" width="14" height="14" rx="3" fill="#2dd4bf" stroke="#047857" strokeWidth="1" />
                            </>
                        ) : null}
                        {isStandup ? <path d="M 48 159 C 71 171 109 171 132 159" fill="none" stroke="#064e3b" strokeWidth="1.3" opacity="0.5" /> : null}
                        {width > 0 ? <text x="90" y="181" textAnchor="middle" fontSize="8" fill="#475569" fontWeight="700">{width} mm</text> : null}
                        {height > 0 ? <text x="16" y="103" fontSize="8" fill="#475569" fontWeight="700" transform="rotate(-90 16 103)">{height} mm</text> : null}
                    </svg>
                ) : kind === "ROLL" ? (
                    <svg viewBox="0 0 140 110" width="130" height="100" className="drop-shadow-md">
                        <ellipse cx="38" cy="55" rx="14" ry="44" fill="#bae6fd" stroke="#0284c7" strokeWidth="1.2" />
                        <rect x="38" y="11" width="74" height="88" fill="#7dd3fc" stroke="#0284c7" strokeWidth="1.2" />
                        <ellipse cx="112" cy="55" rx="14" ry="44" fill="#38bdf8" stroke="#0284c7" strokeWidth="1.2" />
                        <ellipse cx="112" cy="55" rx="6" ry="18" fill="#f8fafc" stroke="#0369a1" strokeWidth="0.9" opacity="0.9" />
                        {rollWidth > 0 ? <text x="75" y="107" textAnchor="middle" fontSize="8" fill="#475569" fontWeight="700">{rollWidth} mm roll W</text> : null}
                    </svg>
                ) : (
                    <svg viewBox="0 0 140 110" width="130" height="100" className="drop-shadow-md">
                        <rect x="20" y="20" width="100" height="70" fill="#fde68a" stroke="#b45309" strokeWidth="1.2" />
                        <line x1="20" y1="20" x2="120" y2="20" stroke="#b45309" strokeWidth="0.6" />
                        {width > 0 ? <text x="70" y="105" textAnchor="middle" fontSize="8" fill="#475569" fontWeight="700">{width} mm</text> : null}
                    </svg>
                )}
            </div>
            {featureTags.length ? (
                <div className="mt-2 flex flex-wrap justify-center gap-1">
                    {featureTags.map((tag) => (
                        <span key={String(tag)} className="rounded-full bg-emerald-50 px-2 py-0.5 text-[9px] font-black uppercase tracking-wider text-emerald-800 ring-1 ring-emerald-100">
                            {tag}
                        </span>
                    ))}
                </div>
            ) : null}
        </section>
    )
}

// ─── 3 · Geometry strip (mini stat tiles) ────────────────────────

function GeometryStrip({ preview }: { preview: PreviewBomResult }) {
    const g = preview.geometry_snapshot || {}
    const totalKg = Number(preview.total_weight_kg || 0)
    const unitG = Number(preview.unit_weight_g || 0)
    const totalPouches = unitG > 0 && totalKg > 0 ? Math.round((totalKg * 1000) / unitG) : 0
    // Backends inconsistently emit the dimension under different keys (width_mm,
    // final_width_mm, width, size_width_mm). Sniff them all so the strip never
    // shows "—" when the data actually exists.
    const widthMm = Number(g.width_mm ?? g.final_width_mm ?? g.size_width_mm ?? g.width ?? g.effective_width_mm ?? 0)
    const heightMm = Number(g.height_mm ?? g.final_height_mm ?? g.size_height_mm ?? g.height ?? g.effective_height_mm ?? 0)
    const thicknessUm = Number(g.thickness_um ?? g.thickness_micron ?? preview.layer_snapshot?.reduce((s: number, l: any) => s + (Number(l?.thickness_micron) || 0), 0) ?? 0)
    const rollWidthMm = Number(g.roll_width_mm ?? g.roll_width ?? 0)
    const webWidthMm = Number(g.consumption_web_width_mm ?? 0)
    const pitchMm = Number(g.consumption_pitch_mm ?? 0)
    const areaBasis = String(g.area_basis || "").toUpperCase()
    const cells: Array<{ label: string; value: string; tone?: "default" | "emerald" }> = [
        { label: "W × H", value: widthMm > 0 ? `${widthMm} × ${heightMm || 0} mm` : "—" },
        ...(webWidthMm > 0 && pitchMm > 0 ? [{ label: areaBasis === "LEGACY_WEB_BASIS" ? "Film basis (legacy)" : "Film basis", value: `${webWidthMm} × ${pitchMm} mm`, tone: "emerald" as const }] : []),
        { label: "Thickness", value: thicknessUm > 0 ? `${thicknessUm} μ` : "—" },
        { label: "Roll W", value: rollWidthMm > 0 ? `${rollWidthMm} mm` : "—" },
        { label: "Unit wt", value: unitG > 0 ? `${unitG} g` : "—", tone: unitG > 0 ? "emerald" : "default" },
        { label: "Order wt", value: totalKg > 0 ? `${fmtQty(totalKg)} kg` : "—", tone: totalKg > 0 ? "emerald" : "default" },
    ]
    if (totalPouches > 0) cells.push({ label: "Pouches", value: fmtNum(totalPouches), tone: "emerald" })
    return (
        <section className="rounded-2xl border border-slate-200 bg-white p-3">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">Geometry</div>
            <div className="grid grid-cols-2 gap-2">
                {cells.map((c) => (
                    <div key={c.label} className={cn(
                        "rounded-lg px-2.5 py-1.5 ring-1",
                        c.tone === "emerald" ? "bg-emerald-50 ring-emerald-100" : "bg-slate-50 ring-slate-100",
                    )}>
                        <div className="text-[9px] font-black uppercase tracking-wider text-slate-500">{c.label}</div>
                        <div className={cn("font-mono text-sm font-bold tabular-nums", c.tone === "emerald" ? "text-emerald-800" : "text-slate-900")}>{c.value}</div>
                    </div>
                ))}
            </div>
        </section>
    )
}

// ─── 4 · Layer stack ─────────────────────────────────────────────

function LayerStack({ preview }: { preview: PreviewBomResult }) {
    if (!preview.layer_snapshot?.length) return null
    const total = preview.layer_snapshot.reduce((s: number, l: any) => s + Math.max(Number(l?.thickness_micron || 0), 0), 0)
    // Bright, saturated gradient bars so each layer is visually distinct.
    // Ordered most-specific first so e.g. MET-PET hits MET (slate) not PET (blue).
    const FILM_COLOR_ORDER: Array<[string, string]> = [
        ["MET", "from-slate-500 to-slate-600"],
        ["METALLIZED", "from-slate-500 to-slate-600"],
        ["ALU", "from-slate-400 to-slate-500"],
        ["LDPE", "from-emerald-400 to-emerald-600"],
        ["LD-NAT", "from-emerald-400 to-emerald-600"],
        ["LD", "from-emerald-400 to-emerald-600"],
        ["HDPE", "from-teal-400 to-teal-600"],
        ["BOPP", "from-sky-400 to-sky-600"],
        ["BOPA", "from-violet-400 to-violet-600"],
        ["BOPE", "from-indigo-400 to-indigo-600"],
        ["PET", "from-blue-400 to-blue-600"],
        ["NYL", "from-violet-400 to-violet-600"],
        ["NYLON", "from-violet-400 to-violet-600"],
        ["PP", "from-cyan-400 to-cyan-600"],
        ["PE", "from-emerald-400 to-emerald-600"],
        ["PAPER", "from-amber-300 to-amber-500"],
    ]
    const colorOf = (code: string): string => {
        const upper = String(code || "").toUpperCase()
        const found = FILM_COLOR_ORDER.find(([k]) => upper.startsWith(k) || upper.includes(`-${k}-`) || upper.includes(`-${k}`))
        return found ? `bg-gradient-to-r ${found[1]}` : "bg-gradient-to-r from-slate-300 to-slate-400"
    }
    return (
        <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-2">
                <span>Layer stack</span>
                <span className="font-mono text-emerald-700 font-black">total {total} μ</span>
            </div>
            <div className="space-y-2 text-[11px]">
                {preview.layer_snapshot.map((l: any, i: number) => {
                    const t = Number(l?.thickness_micron || 0)
                    const pct = total > 0 ? (t / total) * 100 : 0
                    return (
                        <div key={i} className="flex items-center gap-2">
                            <span className="w-14 font-bold text-slate-600 text-[10px] uppercase tracking-wider truncate">{l.role || `L${i + 1}`}</span>
                            <div className="flex-1 h-6 rounded-md bg-slate-50 ring-1 ring-slate-200 overflow-hidden flex items-center">
                                <span className={cn("h-full shadow-inner", colorOf(l.film_variant_code))} style={{ width: `${Math.max(pct, 4)}%` }} />
                            </div>
                            <span className="w-32 font-mono text-slate-800 text-right text-[11px] tabular-nums">
                                <span className="font-bold">{l.film_variant_code || "—"}</span>
                                <span className="text-slate-500"> · </span>
                                <span className="font-bold">{t} μ</span>
                                {l.grade ? <span className="text-emerald-700 font-black"> {l.grade}</span> : null}
                            </span>
                        </div>
                    )
                })}
            </div>
        </section>
    )
}

// ─── 5 · Material breakdown (grouped) ────────────────────────────

function matchCategory(cat: string, code = "", name = ""): string {
    const hay = `${cat} ${code} ${name}`.toUpperCase()
    // POD first — it's the main customer-visible BOM item and must sit at top.
    if (/^POD$|POD[_-]/.test(hay)) return "POD"
    if (/INK|PIGMENT|COLOR/.test(hay)) return "INK"
    if (/ADHESIVE|GLUE|SOLVENT|THINNER|CHEM/.test(hay)) return "CHEMICAL"
    if (/ADDON/.test(hay)) return "ADDON"
    // Inner pouch deserves its own bucket — it's a sales-pickable axis at
    // master level and never affects per-pouch weight (it's the OUTER carrier
    // for the pouches). The remaining packing terms stay generic.
    if (/INNER[_-]?POUCH|INNER\s+POUCH|PRIMARY\s+INNER|^IP[_-]/.test(hay)) return "INNER_POUCH"
    if (/GUNNY|GONNY|SHEET|CARTON|BOX|TAPE|LABEL|TAG|PACKAGING/.test(hay)) return "PACKAGING"
    if (/FILM|RESIN|PE\b|PET\b|HDPE|LDPE|PP\b|BOPP|LAMINATE/.test(hay)) return "FILM"
    return "OTHER"
}

function MaterialBreakdown({ preview, scope, masterFlags }: { preview: PreviewBomResult; scope: "variant" | "order"; masterFlags?: LiveBomRailProps["masterFlags"] }) {
    const planningLines: any[] = (preview.bom?.planning_lines || preview.bom_snapshot?.planning_lines || []) as any[]
    const rows: Array<{ category: string; code: string; name: string; qty: number; uom: string; placeholder?: boolean }> = []
    const artworkDeferred = scope === "order" && !!masterFlags?.artwork_deferred
    planningLines.forEach((row) => {
        const category = String(row.category_code || row.category || "OTHER").toUpperCase()
        const code = String(row.material_code || row.code || "—")
        const name = String(row.material_name || row.name || "")
        if (artworkDeferred && matchCategory(category, code, name) === "INK") return
        rows.push({
            category,
            code,
            name,
            qty: Number(row.planned_issue_qty ?? row.theoretical_qty ?? row.qty ?? 0),
            uom: String(row.uom || "KG"),
        })
    })
    if (rows.length === 0) {
        (preview.addons_snapshot || []).forEach((r: any) => rows.push({
            category: "ADDON",
            code: String(r.material_code || r.addon_code || "—"),
            name: String(r.material_name || r.addon_name || ""),
            qty: Number(r.qty || r.weight_kg || 0),
            uom: String(r.uom || "KG"),
        }))
        ;(preview.packaging_lines || []).forEach((r: any) => rows.push({
            category: "PACKAGING",
            code: String(r.material_code || r.code || "—"),
            name: String(r.material_name || r.name || ""),
            qty: Number(r.qty || r.theoretical_qty || r.pcs_per_pack || 0),
            uom: String(r.uom || "PCS"),
        }))
        ;(preview.pod_lines || []).forEach((r: any) => rows.push({
            category: "POD",
            code: String(r.material_code || "—"),
            name: String(r.material_name || ""),
            qty: Number(r.qty || r.theoretical_qty || 0),
            uom: String(r.uom || "KG"),
        }))
    }

    // ─── Inject placeholder rows for "this could resolve later" categories.
    // Variant scope: show every master capability the user could opt into.
    // Order scope: show INK placeholder if print-capable but no artwork is
    //   attached yet (so planner sees "ink is pending an artwork", not "no
    //   ink at all"). This matches the warning-print model — printing route
    //   runs, but ink is zero in BOM until artwork lands.
    const hasCat = (cat: string) => rows.some((r) => r.category === cat || matchCategory(r.category, r.code, r.name) === cat)
    const printCapable = !!masterFlags?.print_capable
    if (scope === "variant") {
        const podLocked = !!masterFlags?.pod_locked
        const addonsAxis = masterFlags?.addons_axis || "off"
        if (printCapable && !hasCat("INK")) {
            rows.push({
                category: "INK",
                code: "INK-PENDING",
                // Explicit: no fake ink GSM until artwork is on the line.
                name: "ink + GSM come from approved artwork — no weight added until assigned",
                qty: 0,
                uom: "KG",
                placeholder: true,
            })
        }
        if (addonsAxis !== "off" && !hasCat("ADDON")) {
            rows.push({ category: "ADDON", code: "ADDONS", name: addonsAxis === "required" ? "required — picked on order" : "optional — picked on order", qty: 0, uom: "KG", placeholder: true })
        }
        if (!podLocked && !hasCat("POD")) {
            rows.push({ category: "POD", code: "POD-?", name: "POD variant picked on order line", qty: 0, uom: "KG", placeholder: true })
        }
    } else if (scope === "order" && printCapable && !artworkDeferred && !hasCat("INK")) {
        // Order-scope warning-print state: master is print-capable but the
        // line has no artwork attached yet, so the BOM resolver emitted zero
        // ink rows. Surface a clear placeholder so the planner sees "ink
        // pending" rather than silence.
        rows.push({
            category: "INK",
            code: "INK-PENDING",
            name: "warning-print run · no ink in BOM until an approved artwork is attached on this line",
            qty: 0,
            uom: "KG",
            placeholder: true,
        })
    }

    if (rows.length === 0) return null

    // BOM groups for the customer/planner BOM rail. PACKAGING (outer/gunny/sheet/
    // tape/label/tag) + the OTHER fallback bucket are intentionally NOT shown
    // here — they're EOD-tagged at packing yard release, not part of the
    // engineering BOM at order time. They live in /logistics/packing/audit.
    //   1. Film — the pouch substrate (weight)
    //   2. Ink — set by artwork (weight, gated)
    //   3. Adhesive / solvent (weight)
    //   4. Add-ons — per-piece extras (weight)
    //   5. POD — second-last, weight-neutral attached item
    //   6. Inner pouch — last, weight-neutral carrier
    const WEIGHT_NEUTRAL_KEYS = new Set(["POD", "INNER_POUCH"])
    const groups: Array<{ key: string; label: string; eyebrow: string; tile: string; chip: string; note?: string }> = [
        { key: "FILM",        label: "Film",                 eyebrow: "text-blue-700",    tile: "bg-blue-50/50",     chip: "bg-blue-50 text-blue-800 ring-blue-200" },
        { key: "INK",         label: "Ink",                  eyebrow: "text-violet-700",  tile: "bg-violet-50/40",   chip: "bg-violet-50 text-violet-800 ring-violet-200" },
        { key: "CHEMICAL",    label: "Adhesive / solvent",   eyebrow: "text-cyan-700",    tile: "bg-cyan-50/40",     chip: "bg-cyan-50 text-cyan-800 ring-cyan-200" },
        { key: "ADDON",       label: "Add-ons",              eyebrow: "text-rose-700",    tile: "bg-rose-50/40",     chip: "bg-rose-50 text-rose-800 ring-rose-200" },
        { key: "POD",         label: "POD",                  eyebrow: "text-fuchsia-700", tile: "bg-fuchsia-50/50",  chip: "bg-fuchsia-50 text-fuchsia-800 ring-fuchsia-200", note: "doesn't change per-pouch weight" },
        { key: "INNER_POUCH", label: "Inner pouch",          eyebrow: "text-amber-700",   tile: "bg-amber-50/50",    chip: "bg-amber-50 text-amber-800 ring-amber-200",       note: "carrier · doesn't change per-pouch weight" },
    ]
    const bucketed: Record<string, typeof rows> = {}
    for (const r of rows) {
        const k = matchCategory(r.category, r.code, r.name)
        bucketed[k] = bucketed[k] || []
        bucketed[k].push(r)
    }
    const totals: Record<string, { qty: number; uom: string }> = {}
    for (const [k, list] of Object.entries(bucketed)) {
        const qty = list.reduce((s, r) => s + (Number.isFinite(r.qty) ? r.qty : 0), 0)
        totals[k] = { qty, uom: list[0]?.uom || "KG" }
    }
    const populated = groups.filter((g) => (bucketed[g.key] || []).length > 0)
    return (
        <section className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
            <header className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Material breakdown</div>
                <span className="text-[10px] text-slate-400">{rows.length} line{rows.length === 1 ? "" : "s"}</span>
            </header>
            <div className="divide-y divide-slate-100">
                {populated.map((g) => {
                    const list = bucketed[g.key]
                    const total = totals[g.key]
                    const weightNeutral = WEIGHT_NEUTRAL_KEYS.has(g.key)
                    return (
                        <section key={g.key} className={cn("px-3 py-2", g.tile)}>
                            <div className="flex items-center justify-between text-[9px] font-black uppercase tracking-wider mb-1">
                                <span className={cn("flex items-center gap-1.5", g.eyebrow)}>
                                    {g.label} · {list.length} {list.length === 1 ? "line" : "lines"}
                                    {g.note ? <span className="rounded-full bg-white/70 px-1.5 py-0.5 text-[8px] font-bold normal-case tracking-normal opacity-80 ring-1 ring-white/40">{g.note}</span> : null}
                                </span>
                                {total ? (
                                    <span className={g.eyebrow}>
                                        {weightNeutral
                                            ? <>{list.length} pc{list.length === 1 ? "" : "s"}</>
                                            : <>Σ {fmtWeightSmart(total.qty, total.uom)}</>}
                                    </span>
                                ) : null}
                            </div>
                            <table className="w-full text-[11px]">
                                <tbody className="divide-y divide-slate-100/60">
                                    {list.slice(0, 8).map((r, i) => (
                                        <tr key={i} className={cn(r.placeholder && "opacity-70")}>
                                            <td className="py-1 pr-2 align-top">
                                                {r.placeholder ? (
                                                    <span className="inline-block rounded px-1.5 py-0.5 text-[10px] font-mono font-bold text-slate-500 bg-white/60" style={{ borderStyle: "dashed", borderWidth: 1, borderColor: "rgb(203 213 225)" }}>
                                                        {r.code}
                                                    </span>
                                                ) : (
                                                    <span className="font-mono text-[11px] font-bold text-slate-900">{r.code}</span>
                                                )}
                                                {r.name ? <div className={cn("mt-0.5 text-[10px] truncate max-w-[180px]", r.placeholder ? "text-slate-400 italic" : "text-slate-500")}>{r.name}</div> : null}
                                            </td>
                                            <td className={cn("py-1 text-right font-mono font-bold tabular-nums", r.placeholder ? "text-slate-400" : "text-slate-800")} colSpan={2}>
                                                {r.placeholder ? "—" : fmtWeightSmart(r.qty, r.uom)}
                                            </td>
                                        </tr>
                                    ))}
                                    {list.length > 8 ? (
                                        <tr><td colSpan={3} className="py-1 text-center text-[10px] text-slate-400">+ {list.length - 8} more in {g.label.toLowerCase()}</td></tr>
                                    ) : null}
                                </tbody>
                            </table>
                        </section>
                    )
                })}
            </div>
        </section>
    )
}

// ─── Stock source bar ────────────────────────────────────────────

function StockSourceBar({ preview }: { preview: PreviewBomResult }) {
    const ss = preview.stock_source_preview
    if (!ss) return null
    const fg = Number(ss.exact_fg || 0)
    const wip = Number(ss.shared_wip || 0)
    const fresh = Number(ss.fresh_route || 0)
    const total = fg + wip + fresh
    const pct = (v: number) => total > 0 ? (v / total) * 100 : 0
    const tiles = [
        { label: "FG ready", value: fg, pct: pct(fg), tile: "bg-emerald-50 text-emerald-900 ring-emerald-100", bar: "bg-emerald-500" },
        { label: "Shared WIP", value: wip, pct: pct(wip), tile: "bg-blue-50 text-blue-900 ring-blue-100", bar: "bg-blue-500" },
        { label: "Fresh route", value: fresh, pct: pct(fresh), tile: "bg-amber-50 text-amber-900 ring-amber-100", bar: "bg-amber-500" },
    ]
    return (
        <section className="rounded-2xl border border-slate-200 bg-white p-3">
            <div className="flex items-center justify-between mb-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Where will it ship from</div>
                <span className="text-[10px] text-slate-400">total {total > 0 ? total : "—"}</span>
            </div>
            <div className="flex h-2.5 w-full overflow-hidden rounded-full ring-1 ring-slate-200">
                {total > 0 ? tiles.map((t) => t.value > 0 ? (
                    <div key={t.label} className={t.bar} style={{ width: `${t.pct}%` }} title={`${t.label} ${t.value} · ${t.pct.toFixed(0)}%`} />
                ) : null) : null}
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 text-[10px]">
                {tiles.map((t) => (
                    <div key={t.label} className={cn("rounded-lg px-2 py-1.5 ring-1", t.tile)}>
                        <div className="text-[9px] font-black uppercase tracking-wider opacity-70">{t.label}</div>
                        <div className="font-mono text-sm font-bold tabular-nums">{t.value || 0}</div>
                        <div className="text-[9px] opacity-60 tabular-nums">{t.pct.toFixed(0)}%</div>
                    </div>
                ))}
            </div>
            <div className="mt-2 text-[10px] text-slate-500">FG ships first · WIP next · Fresh route only when no stock found.</div>
        </section>
    )
}

// ─── 8 · Checks list ─────────────────────────────────────────────

function ChecksList({ preview }: { preview: PreviewBomResult }) {
    const checks = preview.checks || []
    const warnings = preview.warnings || []
    const blockers = preview.blockers || []
    if (!checks.length && !warnings.length && !blockers.length) return null
    return (
        <section className="rounded-2xl border border-slate-200 bg-white p-3 space-y-1.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Checks</div>
            {checks.map((c, i) => (
                <div key={`c-${i}`} className="flex items-start gap-2 text-[11px]">
                    <span className={cn(
                        "mt-0.5 flex h-3.5 w-3.5 flex-none items-center justify-center rounded-full text-[8px] font-black",
                        c.ok ? "bg-emerald-100 text-emerald-700" : c.tone === "error" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700",
                    )}>{c.ok ? "✓" : "!"}</span>
                    <span className="text-slate-700">{c.label}</span>
                </div>
            ))}
            {warnings.map((w, i) => (
                <div key={`w-${i}`} className="flex items-start gap-2 text-[11px]">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none text-amber-600" />
                    <span className="text-amber-800">{w}</span>
                </div>
            ))}
            {blockers.map((b, i) => (
                <div key={`b-${i}`} className="flex items-start gap-2 text-[11px]">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none text-rose-600" />
                    <span className="text-rose-800 font-bold">{b}</span>
                </div>
            ))}
        </section>
    )
}

// ─── 9 · Sticky add-line footer ──────────────────────────────────

function LineFooter({ line, preview }: { line: NonNullable<LiveBomRailProps["line"]>; preview: PreviewBomResult }) {
    const qty = Number(line.qty || 0)
    const unitPrice = Number(line.unitPrice || 0)
    const subtotal = qty > 0 && unitPrice > 0 ? qty * unitPrice : 0
    const totalKg = Number(preview.total_weight_kg || 0)
    const unitG = Number(preview.unit_weight_g || 0)
    const pouches = unitG > 0 && totalKg > 0 ? Math.round((totalKg * 1000) / unitG) : 0
    return (
        <footer className="bg-emerald-600 px-5 py-3 text-white sticky bottom-0">
            <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                    <div className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-100">This line · ready to add</div>
                    <div className="font-display text-base font-black tabular-nums">
                        {qty > 0 ? `${fmtNum(qty)} ${line.uom || ""}` : "Set qty"}
                        {subtotal > 0 ? <span className="ml-2">· {fmtCurrency(subtotal)}</span> : null}
                    </div>
                    <div className="text-[10px] font-bold text-emerald-100">
                        {pouches > 0 ? `${fmtNum(pouches)} pouches · ${fmtQty(totalKg)} kg total` : "—"}
                    </div>
                </div>
                {line.onAdd ? (
                    <button
                        onClick={line.onAdd}
                        disabled={line.addDisabled}
                        className={cn(
                            "rounded-xl bg-white px-4 py-2 text-[12px] font-black text-emerald-700 hover:bg-emerald-50 inline-flex items-center gap-1",
                            line.addDisabled && "opacity-50 cursor-not-allowed",
                        )}
                    >
                        {line.addLabel || "+ Add line"} <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                ) : (
                    <span className="inline-flex items-center gap-1 rounded-xl bg-white/15 px-3 py-1.5 text-[11px] font-bold text-white ring-1 ring-white/30">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Saved on cart
                    </span>
                )}
            </div>
        </footer>
    )
}

"use client"

/**
 * V3.7 Sales Order — Line editor rebuilt to match docs/mockups/sales-v37-create-bom.html.
 *
 * Visual structure (single line build form, 2-column at xl):
 *   ┌─ header band (Line N · build · master.name · Collapse)
 *   ├─ overlay match strip (when an overlay exists for customer × master)
 *   ├─ 2-col grid:
 *   │     LEFT  → 1) product master picker
 *   │            2) variant axes grid (size · per-layer thickness · grade · catalog axes · addons)
 *   │            3) packaging axis selectors (PRIMARY_INNER / FINAL_GUNNY / ROLL_DISPATCH if master defines them)
 *   │            4) artwork (when print_capable)
 *   │            5) quantity / price
 *   │            6) actions footer
 *   │     RIGHT → sticky LiveBomRail (route ribbon + identity + visual + layer stack + materials + steps + checks + sticky add-line footer)
 *
 * Wires only to existing services / hooks. No new field, no schema change.
 */

import * as React from "react"
import { useRouter } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import {
    AlertTriangle,
    ChevronUp,
    Package,
    PackageCheck,
    Search,
    X,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { AxisLayerMatrix, type LayerRowState } from "@/components/erp-v3/axis-layer-matrix"
import { ArtworkSection, type ArtworkAssignment, type ArtworkColorway } from "@/components/erp-v3/artwork-section"
import { LiveBomRail } from "@/components/erp-v3/live-bom-rail"

import {
    productMasterService,
    type ProductMaster,
    type VariantAxisDef,
} from "@/services/product-master"
import {
    masterDataService,
    type Addon,
    type PackagingMaterial,
    type PodSkuVariant,
} from "@/services/master-data"
import { engineeringService, type Artwork } from "@/services/engineering"
import { computeWebWidthPlan, webWidthPolicyService } from "@/services/web-width-policy"

import type { SalesOrderLine } from "./types"
import { buildSalesAxisValues } from "./axis-values"

export interface LineEditorProps {
    line: SalesOrderLine
    masters: ProductMaster[]
    customerId?: string
    onPatch: (patch: Partial<SalesOrderLine>) => void
    onCollapse: () => void
    onAdd?: () => void
    lineIndex?: number
}

export function LineEditor({ line, masters, customerId, onPatch, onCollapse, onAdd, lineIndex }: LineEditorProps) {
    const router = useRouter()
    const master = masters.find((m) => m.id === line.product_master)
    const addonAxis = master ? findAxis(master, "addons") : undefined
    const addonAllowedCodes = React.useMemo(() => axisAllowedCodes(addonAxis), [addonAxis])

    // ─── Data loads ─────────────────────────────────────────────────
    const { data: sizes = [] } = useQuery({
        queryKey: ["product-master-sizes", line.product_master],
        queryFn: () => productMasterService.listSizes(line.product_master),
        enabled: !!line.product_master,
    })

    const { data: addonMasters = [] } = useQuery({
        queryKey: ["master-addons", "active"],
        queryFn: masterDataService.getAddons,
        staleTime: 60_000,
    })
    const allowedAddonMasters = React.useMemo(
        () => filterRowsByAxisCodes(addonMasters, addonAxis, (row: Addon) => row.code),
        [addonMasters, addonAxis]
    )
    // Approved artworks — start broad (status=APPROVED only) so the picker always
    // has options. The print_type/substrate filters are intentionally dropped here:
    // they over-filter when artworks haven't yet been categorised, leaving the
    // picker empty even though valid approved artworks exist. The user can refine
    // later from the master's Artworks tab if needed.
    const { data: artworks = [] } = useQuery({
        queryKey: ["sales-line-artworks", line.product_master, "approved"],
        queryFn: () =>
            engineeringService.getArtworks({
                status: "APPROVED",
            }),
        enabled: !!line.product_master && !!master?.fixed_attributes?.print_capable,
        staleTime: 60_000,
    })
    const { data: selectedOverlay } = useQuery({
        queryKey: ["sales-line-overlay", line.customer_product_overlay],
        queryFn: () => productMasterService.getCustomerOverlay(line.customer_product_overlay || ""),
        enabled: !!line.customer_product_overlay,
        staleTime: 60_000,
    })

    // Available overlays for this customer × master combo — surfaces a one-click apply.
    const { data: availableOverlays = [] } = useQuery({
        queryKey: ["sales-line-available-overlays", customerId, line.product_master],
        queryFn: () =>
            productMasterService.listCustomerOverlays({
                customer: customerId,
                product_master: line.product_master,
                active: true,
            }),
        enabled: !!customerId && !!line.product_master && !line.customer_product_overlay,
        staleTime: 30_000,
    })

    // Live route steps for the rail
    const { data: routeInfo } = useQuery({
        queryKey: ["product-master-template", line.product_master],
        queryFn: () => productMasterService.getTemplate(line.product_master),
        enabled: !!line.product_master,
        staleTime: 60_000,
    })
    const { data: webWidthPolicy } = useQuery({
        queryKey: ["web-width-policy", "default"],
        queryFn: webWidthPolicyService.getDefault,
        enabled: !!line.product_master,
        staleTime: 60_000,
    })

    const artworkOptions = React.useMemo(() => artworks.map(artworkToColorway), [artworks])
    const overlayDefault = selectedOverlay?.default_artwork
        ? {
              id: selectedOverlay.default_artwork,
              label: selectedOverlay.default_artwork_design_code || selectedOverlay.customer_display_name || selectedOverlay.customer_item_code || "Overlay artwork",
          }
        : undefined

    // ─── Effects: init defaults when master changes ────────────────
    React.useEffect(() => {
        if (!master) return
        if (Object.keys(line.layer_values).length > 0) return
        const next: Record<number, LayerRowState> = {}
        master.layer_template.forEach((row, i) => {
            next[i + 1] = {
                role: row.role,
                film_variant_code: row.film_variant_code,
                thickness_micron: row.thickness_micron,
                grade: row.default_grade,
            }
        })
        const patch: Partial<SalesOrderLine> = { layer_values: next }
        if (!line.template_id && master.template) patch.template_id = master.template
        if (!line.print_type && master.fixed_attributes?.print_type) patch.print_type = master.fixed_attributes.print_type
        if (!line.film_type && master.fixed_attributes?.film_type) patch.film_type = master.fixed_attributes.film_type
        onPatch(patch)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [master?.id])

    React.useEffect(() => {
        if (!line.size_code && sizes.length) onPatch({ size_code: sizes[0].code })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sizes.length, line.size_code])

    React.useEffect(() => {
        if (!master) return
        if (!addonAxis && line.addons.length) {
            onPatch({ addons: [] })
            return
        }
        if (addonAllowedCodes && line.addons.some((code) => !addonAllowedCodes.has(normalizeCode(code)))) {
            onPatch({ addons: line.addons.filter((code) => addonAllowedCodes.has(normalizeCode(code))) })
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [master?.id, addonAxis?.axis, line.addons.join("|")])

    // ─── Live BOM preview query (drives the right rail) ─────────────
    const selectedSize = sizes.find((s) => s.code === line.size_code) || sizes[0]
    const axisBuild = React.useMemo(
        () => buildSalesAxisValues(master, line, selectedSize),
        [master, line, selectedSize]
    )
    const axisValues = axisBuild.axisValues

    const { data: livePreview, isLoading: livePreviewLoading } = useQuery({
        queryKey: ["sales-v37-live-bom", master?.id, axisValues, line.qty_value, line.qty_uom, line.price_basis, line.print_type, line.film_type, customerId, line.customer_product_overlay],
        queryFn: async () => {
            try {
                return await productMasterService.previewBom({
                    product_master: master!.id,
                    customer_id: customerId,
                    template_id: line.template_id || master!.template || master!.default_template || null,
                    axis_values: axisValues,
                    quantity: line.qty_value,
                    quantity_uom: line.qty_uom,
                    price_basis: line.price_basis,
                    printing: master!.fixed_attributes?.print_capable
                        ? {
                              enabled: true,
                              print_type: line.print_type,
                              film_type: line.film_type,
                              artwork_id: line.artwork_assignment?.artwork_id,
                              defer_artwork_to_planner: line.artwork_mode === "DEFER",
                          }
                        : { enabled: false },
                })
            } catch (error) {
                if (axisBuild.previewBlocker) return axisBuild.previewBlocker
                throw error
            }
        },
        enabled: !!master?.id && !!selectedSize && !!axisValues.size,
        staleTime: 0,
        retry: false,
    })

    const masterFlags = master ? {
        print_capable: !!master.fixed_attributes?.print_capable,
        pod_locked: !!(master.fixed_attributes?.pod_enabled && (master.fixed_attributes?.pod_variant_code || master.fixed_attributes?.pod_variant)),
        addons_axis: addonAxis ? (addonAxis.required ? "required" as const : "optional" as const) : "off" as const,
        artwork_deferred: line.artwork_mode === "DEFER",
        artwork_attached: !!line.artwork_assignment?.artwork_id,
    } : undefined

    const subtotal = line.qty_value * (parseFloat(line.unit_price || "0") || 0)
    const addDisabled = !master || !line.size_code || line.qty_value <= 0 || axisBuild.missingRequired.length > 0

    // Augment the API preview with the user-picked size as a fallback for geometry
    // fields the backend doesn't always populate. Keeps the rail honest about
    // what the user just selected while the backend progressively resolves BOM.
    const augmentedPreview = React.useMemo(() => {
        if (!livePreview) return null
        const selected: any = selectedSize || {}
        const g: any = livePreview.geometry_snapshot || {}
        const merged = {
            ...g,
            width_mm: g.width_mm ?? selected.width_mm ?? null,
            height_mm: g.height_mm ?? selected.height_mm ?? null,
            gusset_mm: g.gusset_mm ?? selected.gusset_mm ?? null,
            size_code: g.size_code || selected.code || line.size_code || null,
            roll_width_mm: g.roll_width_mm ?? selected.roll_width_mm ?? null,
            child_target_width_mm: g.child_target_width_mm ?? g.target_child_width_mm ?? selected.child_target_width_mm ?? selected.roll_width_mm ?? null,
            target_child_width_mm: g.target_child_width_mm ?? g.child_target_width_mm ?? selected.child_target_width_mm ?? selected.roll_width_mm ?? null,
            pouch_style: g.pouch_style ?? selected.pouch_style ?? null,
            pouch_style_master: g.pouch_style_master ?? selected.pouch_style_master ?? null,
            pouch_style_master_code: g.pouch_style_master_code ?? selected.pouch_style_master_code ?? null,
            flap_tape_mm: g.flap_tape_mm ?? selected.flap_tape_mm ?? null,
            bottom_gusset_mm: g.bottom_gusset_mm ?? selected.bottom_gusset_mm ?? null,
            trim_loss_mm: g.trim_loss_mm ?? selected.trim_loss_mm ?? null,
        }
        return { ...livePreview, geometry_snapshot: merged }
    }, [livePreview, selectedSize, line.size_code])
    const allowedLaneCounts = React.useMemo(() => {
        const lanes = (webWidthPolicy?.allowed_lanes || []).map((v) => Number(v)).filter((v) => Number.isFinite(v) && v > 0)
        return lanes.length ? lanes : [1, 2, 3]
    }, [webWidthPolicy?.allowed_lanes])
    const childTargetWidthMm = Number(
        (augmentedPreview?.geometry_snapshot as any)?.child_target_width_mm ||
        (augmentedPreview?.geometry_snapshot as any)?.target_child_width_mm ||
        selectedSize?.child_target_width_mm ||
        (augmentedPreview?.geometry_snapshot as any)?.roll_width_mm ||
        selectedSize?.roll_width_mm ||
        0
    )
    const activeLaneCount = allowedLaneCounts.includes(Number(line.preferred_lane_count || 1))
        ? Number(line.preferred_lane_count || 1)
        : allowedLaneCounts[0] || 1
    const webWidthPlan = computeWebWidthPlan(childTargetWidthMm, activeLaneCount, webWidthPolicy)
    const plannedParentWidthMm = webWidthPlan.planned_parent_width_mm

    return (
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_440px]">
            {/* ───────────────── LEFT: line editor ───────────────── */}
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                {/* Editor header */}
                <header className="border-b border-slate-100 bg-gradient-to-r from-indigo-50/60 via-white to-white px-5 py-3 flex items-center justify-between">
                    <div className="min-w-0">
                        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-indigo-700">
                            Line {typeof lineIndex === "number" ? lineIndex + 1 : ""} · build
                        </div>
                        <h3 className="font-display text-base font-bold text-slate-900 truncate">
                            {master ? master.name : "Pick a product, pick axes, set qty"}
                        </h3>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="hidden sm:inline-flex text-[10px] text-slate-500">All changes recompute the BOM rail in &lt;200 ms</span>
                        <Button variant="ghost" size="sm" onClick={onCollapse} className="h-8 gap-1 rounded-lg text-xs font-bold text-slate-700 hover:bg-slate-100">
                            <ChevronUp className="h-3.5 w-3.5" /> Collapse
                        </Button>
                    </div>
                </header>

                {/* Overlay match strip (when customer has an overlay for this master) */}
                {selectedOverlay ? (
                    <div className="border-b border-emerald-100 bg-emerald-50/60 px-5 py-2 flex flex-wrap items-center gap-2 text-[11px]">
                        <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white">overlay applied</span>
                        <span className="font-mono font-bold text-emerald-800">{selectedOverlay.customer_item_code || selectedOverlay.customer_display_name || "—"}</span>
                        {selectedOverlay.default_price_basis ? <span className="rounded-full bg-white px-2 py-0.5 font-bold text-emerald-800 ring-1 ring-emerald-200">basis · {selectedOverlay.default_price_basis}</span> : null}
                        {selectedOverlay.size_variant_code ? <span className="rounded-full bg-white px-2 py-0.5 font-bold text-emerald-800 ring-1 ring-emerald-200">size · {selectedOverlay.size_variant_code}</span> : null}
                        {selectedOverlay.default_artwork_design_code ? <span className="rounded-full bg-white px-2 py-0.5 font-bold text-emerald-800 ring-1 ring-emerald-200">art · {selectedOverlay.default_artwork_design_code}</span> : null}
                        <button
                            onClick={() => onPatch({ customer_product_overlay: undefined })}
                            className="ml-auto rounded-md px-1.5 py-0.5 text-[10px] font-bold text-emerald-800 hover:bg-emerald-100"
                        >
                            Clear
                        </button>
                    </div>
                ) : availableOverlays.length > 0 ? (
                    <div className="border-b border-violet-100 bg-violet-50/60 px-5 py-2 flex flex-wrap items-center gap-2 text-[11px]">
                        <span className="rounded-full bg-violet-600 px-2 py-0.5 text-[10px] font-bold text-white">customer overlay available</span>
                        <span className="text-violet-800">{availableOverlays[0].customer_item_code || availableOverlays[0].customer_display_name || "Customer defaults"}</span>
                        <button
                            onClick={() => applyOverlay(availableOverlays[0], onPatch)}
                            className="ml-auto rounded-md bg-violet-600 px-2 py-1 text-[10px] font-bold text-white hover:bg-violet-700"
                        >
                            Apply overlay
                        </button>
                    </div>
                ) : null}

                {/* Body */}
                <div className="p-5 space-y-5">
                    {/* 1. Product master picker */}
                    <FieldGroup label="Product master" required>
                        <MasterPicker masters={masters} value={line.product_master} onChange={(id) => onPatch({
                            product_master: id,
                            size_code: "",
                            layer_values: {},
                            axis_values: {},
                            addons: [],
                            artwork_assignment: undefined,
                            customer_product_overlay: undefined,
                        })} />
                    </FieldGroup>

                    {master ? (
                        <>
                            {/* 2. Variant axes — clean mockup grid */}
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Variant axes <span className="text-rose-600">*</span></div>
                                    <span className="text-[10px] text-slate-500">{(master.variant_axes || []).length} axes · master defines</span>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    {/* Size */}
                                    {sizes.length > 0 ? (
                                        <SizeAxis sizes={sizes} value={line.size_code} onChange={(c) => onPatch({ size_code: c })} />
                                    ) : null}

                                    {/* Per-layer thickness as button group when layers share thickness, else AxisLayerMatrix */}
                                    {master.layer_template.length > 0 ? (
                                        <LayerThicknessGrouped
                                            master={master}
                                            line={line}
                                            onPatch={onPatch}
                                        />
                                    ) : null}

                                    {/* Per-layer grade pills */}
                                    {master.layer_template.length > 0 ? (
                                        <LayerGradePills master={master} line={line} onPatch={onPatch} />
                                    ) : null}

                                    {/* Catalog axes (POD / packaging_inner / packaging_outer) */}
                                    <CatalogAxesGrid master={master} line={line} onPatch={onPatch} />
                                </div>
                            </div>

                            {/* Addons */}
                            {addonAxis ? (
                                <FieldGroup label="Add-ons" hint={addonAxis.required ? "required" : "optional"}>
                                    <AddonPicker addons={allowedAddonMasters} selected={line.addons} onChange={(addons) => onPatch({ addons })} />
                                </FieldGroup>
                            ) : null}

                            <FieldGroup label="Production lane" hint="sets parent web for WCM allocation">
                                <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 px-3 py-3">
                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                        <div className="flex flex-wrap items-center gap-2">
                                            {allowedLaneCounts.map((lane) => (
                                                <Button
                                                    key={lane}
                                                    type="button"
                                                    size="sm"
                                                    variant={activeLaneCount === lane ? "default" : "outline"}
                                                    onClick={() => onPatch({ preferred_lane_count: lane, lane_count_source: "OPERATOR_CHOICE" })}
                                                    className={cn(
                                                        "h-8 rounded-lg px-3 text-xs font-black",
                                                        activeLaneCount === lane ? "bg-indigo-600 text-white hover:bg-indigo-700" : "border-indigo-200 bg-white text-indigo-700"
                                                    )}
                                                >
                                                    {lane}-up
                                                </Button>
                                            ))}
                                        </div>
                                        <div className="rounded-lg bg-white px-2.5 py-1.5 text-right ring-1 ring-indigo-100">
                                            <div className="text-[9px] font-black uppercase tracking-widest text-indigo-500">Policy</div>
                                            <div className="font-mono text-[11px] font-bold text-slate-900">{webWidthPolicy?.code || "default"}</div>
                                        </div>
                                    </div>
                                    <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] md:grid-cols-5">
                                        <div className="rounded-lg bg-white px-2 py-1.5 ring-1 ring-indigo-100">
                                            <div className="font-black uppercase tracking-widest text-indigo-500">Child target</div>
                                            <div className="font-mono font-bold text-slate-900">{childTargetWidthMm ? `${Math.round(childTargetWidthMm)} mm` : "—"}</div>
                                        </div>
                                        <div className="rounded-lg bg-white px-2 py-1.5 ring-1 ring-indigo-100">
                                            <div className="font-black uppercase tracking-widest text-indigo-500">Lane count</div>
                                            <div className="font-mono font-bold text-slate-900">{activeLaneCount}-up</div>
                                        </div>
                                        <div className="rounded-lg bg-white px-2 py-1.5 ring-1 ring-indigo-100">
                                            <div className="font-black uppercase tracking-widest text-indigo-500">Planned parent</div>
                                            <div className="font-mono font-bold text-slate-900">{plannedParentWidthMm ? `${Math.round(plannedParentWidthMm)} mm` : "—"}</div>
                                        </div>
                                        <div className="rounded-lg bg-white px-2 py-1.5 ring-1 ring-indigo-100">
                                            <div className="font-black uppercase tracking-widest text-indigo-500">Trim</div>
                                            <div className="font-mono font-bold text-slate-900">{webWidthPlan.trim_mm ? `${Math.round(webWidthPlan.trim_mm)} mm` : "0 mm"}</div>
                                        </div>
                                        <div className="rounded-lg bg-white px-2 py-1.5 ring-1 ring-indigo-100">
                                            <div className="font-black uppercase tracking-widest text-indigo-500">Std/rem</div>
                                            <div className="font-mono font-bold text-slate-900">
                                                {webWidthPlan.selected_standard_parent_width_mm ? `${Math.round(webWidthPlan.selected_standard_parent_width_mm)} mm` : webWidthPlan.remainder_mm ? `${Math.round(webWidthPlan.remainder_mm)} mm ${webWidthPlan.remainder_disposition.toLowerCase()}` : "calc"}
                                            </div>
                                        </div>
                                    </div>
                                    {webWidthPlan.warnings.length ? (
                                        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] font-semibold text-amber-900">
                                            {webWidthPlan.warnings.join(" ")}
                                        </div>
                                    ) : null}
                                </div>
                            </FieldGroup>

                            {/* Artwork + film type (print-capable masters only) */}
                            {master.fixed_attributes?.print_capable ? (
                                <FieldGroup label="Artwork & print" hint="cylinder + colorway">
                                    <ArtworkSection
                                        mode={line.artwork_mode}
                                        onModeChange={(m) => onPatch({ artwork_mode: m })}
                                        printType={line.print_type}
                                        onPrintTypeChange={(t) => onPatch({ print_type: t })}
                                        filmType={line.film_type}
                                        onFilmTypeChange={(t) => onPatch({ film_type: t })}
                                        options={artworkOptions}
                                        assignment={line.artwork_assignment}
                                        overlayDefault={overlayDefault}
                                        onSelectColorway={(cw) => {
                                            const artwork = artworks.find((item) => item.id === cw.id)
                                            if (artwork) onPatch({ artwork_assignment: artworkToAssignment(artwork) })
                                        }}
                                        onPickArtwork={() => {
                                            // Opens the master's Artworks tab in a new tab so the user can review the full
                                            // approved-artwork grid without losing the in-progress order draft.
                                            if (master?.id && typeof window !== "undefined") {
                                                window.open(`/master/products/${master.id}?tab=artworks`, "_blank", "noopener,noreferrer")
                                            } else if (master?.id) {
                                                router.push(`/master/products/${master.id}`)
                                            }
                                        }}
                                        onReplaceColor={(slot) => {
                                            if (!line.artwork_assignment) return
                                            const next: ArtworkAssignment = { ...line.artwork_assignment }
                                            next.front_colors = next.front_colors.map((c) =>
                                                c.index === slot.index ? { ...c, hex: nextHex(c.hex), overridden: true } : c
                                            )
                                            onPatch({ artwork_assignment: next })
                                        }}
                                        disabled={!master.fixed_attributes?.print_capable}
                                    />
                                </FieldGroup>
                            ) : null}

                            {/* Quantity & price */}
                            <FieldGroup label="Quantity & price">
                                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                                    <Field label="Qty">
                                        <Input type="number" value={line.qty_value || ""} onChange={(e) => onPatch({ qty_value: Number(e.target.value) })} className="h-10 rounded-xl border-slate-200 font-mono font-bold tabular-nums" />
                                    </Field>
                                    <Field label="UOM">
                                        <Select value={line.qty_uom} onValueChange={(v) => onPatch({ qty_uom: v as any })}>
                                            <SelectTrigger className="h-10 rounded-xl"><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="KG">KG</SelectItem>
                                                <SelectItem value="PCS">PCS</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </Field>
                                    <Field label={`Rate (per ${line.price_basis})`}>
                                        <Input value={line.unit_price} aria-label="Unit price" onChange={(e) => onPatch({ unit_price: e.target.value })} className="h-10 rounded-xl border-slate-200 font-mono font-bold tabular-nums" placeholder="₹" />
                                    </Field>
                                    <Field label="Subtotal">
                                        <Input value={subtotal > 0 ? `₹${Math.round(subtotal).toLocaleString("en-IN")}` : "—"} readOnly className="h-10 rounded-xl border-emerald-200 bg-emerald-50 font-mono font-bold text-emerald-800 tabular-nums" />
                                    </Field>
                                </div>
                            </FieldGroup>

                            {/* Optional packing note */}
                            <FieldGroup label="Packing note" hint="optional · printed on dispatch">
                                <Input
                                    value={line.remarks}
                                    onChange={(e) => onPatch({ remarks: e.target.value })}
                                    placeholder="e.g. 24 pouches per inner · 12 inners per gunny"
                                    className="h-10 rounded-xl border-slate-200"
                                />
                            </FieldGroup>

                            {/* Actions */}
                            <div className="pt-3 border-t border-slate-100 flex items-center justify-end gap-2">
                                <Button variant="outline" size="sm" onClick={onCollapse} className="rounded-lg gap-1 border-slate-200 text-[11px] font-bold">Cancel line</Button>
                                {onAdd ? (
                                    <Button
                                        size="sm"
                                        disabled={addDisabled}
                                        onClick={onAdd}
                                        className="rounded-lg gap-1 bg-emerald-600 text-[12px] font-bold text-white shadow-sm hover:bg-emerald-700"
                                    >
                                        + Add line to cart
                                    </Button>
                                ) : null}
                            </div>
                        </>
                    ) : null}
                </div>
            </div>

            {/* ───────────────── RIGHT: live BOM rail ───────────────── */}
            <div>
                <LiveBomRail
                    title="Live BOM preview"
                    subtitle={master ? `${master.code}${line.size_code ? ` · ${line.size_code}` : ""}` : "Pick a product master to begin"}
                    preview={augmentedPreview || livePreview || axisBuild.previewBlocker || null}
                    loading={livePreviewLoading}
                    sticky
                    scope="order"
                    masterFlags={masterFlags}
                    routeSteps={routeInfo?.route_steps || []}
                    routeTemplateName={master?.template_name || undefined}
                    line={{
                        qty: line.qty_value,
                        uom: line.qty_uom,
                        unitPrice: parseFloat(line.unit_price || "0") || 0,
                        priceBasis: line.price_basis,
                        onAdd: onAdd,
                        addLabel: "+ Add line to cart",
                        addDisabled,
                    }}
                />
            </div>
        </div>
    )
}

// ─── Field wrappers ─────────────────────────────────────────────

function FieldGroup({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
    return (
        <div>
            <div className="mb-2 flex items-center justify-between">
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                    {label}{required ? <span className="ml-1 text-rose-600">*</span> : null}
                </div>
                {hint ? <span className="text-[10px] text-slate-500">{hint}</span> : null}
            </div>
            {children}
        </div>
    )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div>
            <Label className="text-[10px] font-bold text-slate-600">{label}</Label>
            <div className="mt-1">{children}</div>
        </div>
    )
}

// ─── Master picker ─────────────────────────────────────────────

function MasterPicker({ masters, value, onChange }: { masters: ProductMaster[]; value: string; onChange: (id: string) => void }) {
    const [search, setSearch] = React.useState("")
    const filtered = React.useMemo(() => {
        const q = search.trim().toLowerCase()
        if (!q) return masters.slice(0, 6)
        return masters.filter((m) => m.code.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)).slice(0, 12)
    }, [masters, search])

    if (value) {
        const m = masters.find((x) => x.id === value)
        if (m) {
            const others = masters.filter((x) => x.id !== value).slice(0, 2)
            return (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <button type="button" className="rounded-xl border border-indigo-300 bg-indigo-50/60 ring-2 ring-indigo-200 p-3 text-left">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-indigo-600">selected</div>
                        <div className="font-display font-bold text-sm text-slate-900 mt-0.5 truncate">{m.name}</div>
                        <div className="font-mono text-[10px] text-slate-500 truncate">{m.code} · {m.layer_template.length} layers · {(m.variant_axes || []).length} axes</div>
                    </button>
                    {others.map((o) => (
                        <button key={o.id} type="button" onClick={() => onChange(o.id)} className="rounded-xl border border-slate-200 bg-white p-3 text-left hover:border-indigo-300 hover:bg-slate-50">
                            <div className="font-display font-bold text-sm text-slate-900 truncate">{o.name}</div>
                            <div className="font-mono text-[10px] text-slate-500 truncate">{o.code} · {o.layer_template.length} layers</div>
                        </button>
                    ))}
                    {others.length < 2 ? <div className="hidden sm:block" /> : null}
                    <button type="button" onClick={() => onChange("")} className="col-span-full mt-1 inline-flex items-center justify-center gap-1 rounded-md py-1 text-[10px] font-bold text-slate-500 hover:text-slate-900">
                        <X className="h-3 w-3" /> Change product master
                    </button>
                </div>
            )
        }
    }

    return (
        <div className="space-y-2">
            <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search product master code or name…"
                    className="h-10 rounded-xl border-slate-200 pl-9 shadow-sm"
                    autoFocus
                />
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {filtered.map((m) => (
                    <button
                        key={m.id}
                        type="button"
                        data-testid={`sales-master-option-${m.code}`}
                        onClick={() => onChange(m.id)}
                        className="rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm hover:border-indigo-300 hover:bg-slate-50"
                    >
                        <div className="flex items-center gap-2 mb-1">
                            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-slate-100 text-slate-600"><Package className="h-3.5 w-3.5" /></span>
                            <span className="font-mono text-[10px] font-bold text-blue-700 truncate">{m.code}</span>
                        </div>
                        <div className="font-display font-bold text-sm text-slate-900 truncate">{m.name}</div>
                        <div className="text-[10px] text-slate-500">{m.layer_template.length} layers · {(m.variant_axes || []).length} axes</div>
                    </button>
                ))}
                {filtered.length === 0 ? (
                    <div className="col-span-full rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-center text-xs text-slate-500">No masters match &ldquo;{search}&rdquo;.</div>
                ) : null}
            </div>
        </div>
    )
}

// ─── Size axis as a clean Select ──────────────────────────────────

function SizeAxis({ sizes, value, onChange }: { sizes: any[]; value: string; onChange: (code: string) => void }) {
    return (
        <div>
            <label className="text-[10px] font-bold text-slate-600">Size <span className="text-slate-400">geometry</span></label>
            <Select value={value} onValueChange={onChange}>
                <SelectTrigger className="mt-1 h-10 rounded-xl"><SelectValue placeholder="Pick a size" /></SelectTrigger>
                <SelectContent>
                    {sizes.map((s: any) => (
                        <SelectItem key={s.id || s.code} value={s.code}>{s.code} · {s.width_mm}×{s.height_mm || 0}</SelectItem>
                    ))}
                </SelectContent>
            </Select>
            <div className="text-[10px] text-slate-500 mt-1">+ {sizes.length - 1} sizes from master{sizes[0]?.gusset_mm ? ` · gusset ${sizes[0].gusset_mm} mm` : ""}</div>
        </div>
    )
}

// ─── Per-layer thickness as button group when uniform, else expand inline ──

function LayerThicknessGrouped({ master, line, onPatch }: { master: ProductMaster; line: SalesOrderLine; onPatch: (p: Partial<SalesOrderLine>) => void }) {
    const layers = master.layer_template
    // Discover the available "thickness options" from the layer template (per-layer)
    // For now: if all layers share a `grade_options` or we have variants list, surface those.
    // We don't know exact allowed values without master.variant_axes config — fall back to AxisLayerMatrix.
    return (
        <div className="md:col-span-2">
            <label className="text-[10px] font-bold text-slate-600">Per-layer axes <span className="text-slate-400">thickness · grade</span></label>
            <div className="mt-1">
                <AxisLayerMatrix
                    layers={layers}
                    values={line.layer_values}
                    showWidthColumn={false}
                    onChange={(idx, patch) => onPatch({ layer_values: { ...line.layer_values, [idx]: { ...(line.layer_values[idx] || ({} as LayerRowState)), ...patch } } })}
                />
            </div>
        </div>
    )
}

// ─── Per-layer grade pill row (compact summary when layers each have one grade) ──

function LayerGradePills({ master, line }: { master: ProductMaster; line: SalesOrderLine; onPatch: (p: Partial<SalesOrderLine>) => void }) {
    // Grade selection now happens inside AxisLayerMatrix per-layer; keep this as a
    // read-only summary chip row when layers have grade_options so the user sees what's locked.
    const layers = master.layer_template.filter((l) => Array.isArray(l.grade_options) && l.grade_options.length > 0)
    if (layers.length === 0) return null
    return (
        <div>
            <label className="text-[10px] font-bold text-slate-600">Grade <span className="text-slate-400">per-layer enum</span></label>
            <div className="mt-1 flex flex-wrap gap-1">
                {layers.map((l, i) => {
                    const idx = master.layer_template.indexOf(l) + 1
                    const picked = line.layer_values[idx]?.grade || l.default_grade
                    return (
                        <span key={i} className="rounded-full bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white shadow-sm">
                            L{idx} · {picked || "—"}
                        </span>
                    )
                })}
            </div>
        </div>
    )
}

// ─── Catalog axes (POD / inner / outer) ───────────────────────────

function CatalogAxesGrid({ master, line, onPatch }: { master: ProductMaster; line: SalesOrderLine; onPatch: (p: Partial<SalesOrderLine>) => void }) {
    const catalogAxes = (master.variant_axes || []).filter((a: VariantAxisDef) => axisCatalogSource(a) && String(a.axis) !== "addons")
    if (catalogAxes.length === 0) return null
    return (
        <>
            {catalogAxes.map((axis, i) => (
                <CatalogAxisField
                    key={`${String(axis.axis)}-${i}`}
                    master={master}
                    axis={axis}
                    value={String(axisScalarValue(line.axis_values[String(axis.axis)]) || axis.default_value || "")}
                    onChange={(v) => onPatch({ axis_values: patchAxisValue(line.axis_values, String(axis.axis), v) })}
                />
            ))}
        </>
    )
}

function CatalogAxisField({ master, axis, value, onChange }: { master: ProductMaster; axis: VariantAxisDef; value: string; onChange: (v: string) => void }) {
    const source = axisCatalogSource(axis)
    const filter = axis.master_data_filter || {}
    const allowedKey = axisAllowedCodes(axis) ? Array.from(axisAllowedCodes(axis) || []).sort().join("|") : "all"
    const { data: options = [], isLoading } = useQuery({
        queryKey: ["catalog-axis-options", master.id, axis.axis, source, filter, allowedKey],
        queryFn: async () => {
            if (source === "pod_sku_variant") {
                const list = await masterDataService.getPodSkuVariants({ active: true })
                return dedupeByCode(filterRowsByAxisCodes(list, axis, (p: PodSkuVariant) => p.code).map((p: PodSkuVariant) => ({
                    id: p.id,
                    code: p.code,
                    label: p.name || p.pod_sku_name || p.code,
                    sub: [p.pod_thickness_micron ? `${p.pod_thickness_micron}μ` : null, p.pod_fixed_height_mm ? `${p.pod_fixed_height_mm}mm` : null].filter(Boolean).join(" · "),
                })))
            }
            if (source === "packaging_material") {
                const list = await masterDataService.getPackaging()
                let rows = list.filter((p: PackagingMaterial) => p.status === "ACTIVE")
                rows = rows.filter((p: PackagingMaterial) => packagingMaterialAllowedForSales(p, axis, master))
                rows = filterRowsByAxisCodes(rows, axis, (p: PackagingMaterial) => p.code)
                return dedupeByCode(rows.map((p: PackagingMaterial) => ({
                    id: p.id,
                    code: p.code,
                    label: p.name,
                    sub: [p.packaging_kind, p.base_uom].filter(Boolean).join(" · "),
                })))
            }
            if (source === "addon") {
                const list = await masterDataService.getAddons()
                return dedupeByCode(filterRowsByAxisCodes(list, axis, (a: Addon) => a.code).map((a: Addon) => ({
                    id: a.id,
                    code: a.code,
                    label: a.name || a.code,
                    sub: "Add-on",
                })))
            }
            return []
        },
        staleTime: 60_000,
    })

    // Fallback: if the catalog returned nothing but the master DID list explicit
    // allowed codes on the axis, surface those raw codes so the dropdown is never
    // empty when the master clearly says "these are pickable".
    const allowedSet = axisAllowedCodes(axis)
    const effectiveOptions = React.useMemo(() => {
        if (options.length > 0) return options
        if (!allowedSet) return []
        return Array.from(allowedSet).sort().map((code) => ({
            id: code,
            code,
            label: code,
            sub: "from master · allowed list",
        }))
    }, [options, allowedSet])

    const isPod = source === "pod_sku_variant"
    const isPackaging = source === "packaging_material"

    return (
        <div>
            <label className="text-[10px] font-bold text-slate-600">
                {axis.label || String(axis.axis).replace(/_/g, " ")}
                <span className={cn("ml-1 text-[10px]", isPod ? "text-violet-600" : "text-amber-600")}>
                    {isPod ? "catalog · POD" : isPackaging ? "catalog · packaging" : "catalog ref"}
                </span>
            </label>
            <Select value={value || "__none"} onValueChange={(v) => onChange(v === "__none" ? "" : v)}>
                <SelectTrigger className="mt-1 h-10 rounded-xl">
                    <SelectValue placeholder={isLoading ? "Loading…" : "(none)"} />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="__none">— None —</SelectItem>
                    {effectiveOptions.map((o) => (
                        <SelectItem key={o.id} value={o.code}>
                            <span className="font-mono font-bold">{o.code}</span>
                            <span className="ml-2 text-slate-500 text-xs">{o.label}{o.sub ? ` · ${o.sub}` : ""}</span>
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            {axis.required ? <div className="mt-1 text-[10px] font-bold text-rose-600">required</div> : null}
            {axis.auto_demand_in_house ? <div className="mt-1 text-[10px] text-violet-700 font-bold flex items-center gap-1"><PackageCheck className="h-3 w-3" /> in-house produced · auto-demand if shortage</div> : null}
        </div>
    )
}

function AddonPicker({ addons, selected, onChange }: { addons: Addon[]; selected: string[]; onChange: (codes: string[]) => void }) {
    if (!addons.length) {
        return <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">No add-ons allowed on this Product Master.</div>
    }
    return (
        <div className="flex flex-wrap gap-1.5">
            {addons.map((a) => {
                const active = selected.includes(a.code)
                return (
                    <button
                        key={a.id}
                        type="button"
                        onClick={() => onChange(active ? selected.filter((x) => x !== a.code) : [...selected, a.code])}
                        className={cn(
                            "rounded-full px-3 py-1.5 text-[11px] font-bold ring-1 ring-inset",
                            active ? "bg-amber-500 text-white ring-amber-600 shadow-sm" : "bg-white text-slate-700 ring-slate-200 hover:bg-amber-50 hover:text-amber-800 hover:ring-amber-200",
                        )}
                    >
                        {a.name || a.code}
                    </button>
                )
            })}
        </div>
    )
}

// ─── Helpers ─────────────────────────────────────────────────────

function applyOverlay(overlay: any, onPatch: (p: Partial<SalesOrderLine>) => void) {
    const patch: Partial<SalesOrderLine> = { customer_product_overlay: overlay.id }
    if (overlay.default_price_basis) patch.price_basis = overlay.default_price_basis
    const cleanAxisValues = sanitizeAxisValues(overlay.axis_values)
    const overlaySize = String(cleanAxisValues.size || overlay.size_variant_code || "").trim()
    if (overlaySize) {
        patch.size_code = overlaySize
        cleanAxisValues.size = overlaySize
    }
    if (Object.keys(cleanAxisValues).length) patch.axis_values = cleanAxisValues
    onPatch(patch)
}

function findAxis(master: ProductMaster, ...names: string[]) {
    const wanted = new Set(names.map(normalizeCode))
    return (master.variant_axes || []).find((axis: VariantAxisDef) => wanted.has(normalizeCode(axis.axis)))
}

function normalizeCode(value: unknown) {
    return String(value || "").trim().toUpperCase()
}

function axisScalarValue(value: unknown): any {
    if (value === null || value === undefined) return undefined
    if (Array.isArray(value)) return value.map(axisScalarValue).filter((v) => v !== undefined && v !== "")
    if (typeof value === "object") {
        const row = value as Record<string, unknown>
        return axisScalarValue(row.code || row.value || row.id || row.material_code || row.pod_sku_code || row.addon_code || row.size_code)
    }
    return value
}

function sanitizeAxisValues(raw: unknown): Record<string, any> {
    const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, any> : {}
    const out: Record<string, any> = {}
    const structured = new Set(["layer_thicknesses", "layer_grades", "layer_material_overrides", "layer_materials"])
    Object.entries(src).forEach(([key, value]) => {
        if (structured.has(key) && value && typeof value === "object") {
            out[key] = value
            return
        }
        const scalar = axisScalarValue(value)
        if (scalar === undefined || scalar === "" || (Array.isArray(scalar) && scalar.length === 0)) return
        out[key] = scalar
    })
    return out
}

function patchAxisValue(values: Record<string, any>, key: string, value: string) {
    const next = sanitizeAxisValues(values)
    if (value) next[key] = value
    else delete next[key]
    return next
}

function axisCatalogSource(axis?: VariantAxisDef): "pod_sku_variant" | "packaging_material" | "addon" | "" {
    if (!axis) return ""
    if (axis.master_data_source) return axis.master_data_source as any
    const axisName = normalizeCode(axis.axis)
    const axisType = normalizeCode((axis as any).type)
    if (axisType === "PACKAGING_REF" || ["PACKAGING", "PACKAGING_REF", "PACKAGING_INNER", "PACKAGING_OUTER", "PACKAGING_OTHER", "PACKAGING_EXTRA"].includes(axisName)) {
        return "packaging_material"
    }
    if (axisType === "POD_REF" || ["POD", "POD_REF", "POD_VARIANT", "POD_SKU_VARIANT"].includes(axisName)) {
        return "pod_sku_variant"
    }
    return ""
}

function axisOptionCode(option: unknown) {
    if (typeof option === "string" || typeof option === "number") return normalizeCode(option)
    if (!option || typeof option !== "object") return ""
    const row = option as Record<string, unknown>
    return normalizeCode(row.code || row.material_code || row.pod_sku_code || row.addon_code || row.id)
}

function axisAllowedCodes(axis?: VariantAxisDef) {
    const options = (axis as any)?.options
    if (!Array.isArray(options) || options.length === 0) return null
    const codes = new Set(options.map(axisOptionCode).filter(Boolean))
    return codes.size ? codes : null
}

function filterRowsByAxisCodes<T>(rows: T[], axis: VariantAxisDef | undefined, codeOf: (row: T) => unknown) {
    const allowed = axisAllowedCodes(axis)
    if (!allowed) return rows
    return rows.filter((row) => allowed.has(normalizeCode(codeOf(row))))
}

function packagingKind(material?: PackagingMaterial | Record<string, any> | null) {
    const raw = normalizeCode((material as any)?.packaging_kind || (material as any)?.kind)
    if (raw === "GUNNY") return "GONNY"
    if (raw === "CARTON") return "BOX"
    return raw
}

function canonicalPackagingRole(role?: string) {
    const raw = normalizeCode(role || "PRIMARY_INNER")
    if (raw === "FINAL_CARTON" || raw === "FINAL_OUTER" || raw === "TAPE") return "EXTRA"
    if (raw === "PRIMARY_INNER" || raw === "FINAL_GUNNY" || raw === "ROLL_DISPATCH" || raw === "EXTRA") return raw
    return "EXTRA"
}

function packagingLineMatchesAxis(line: Record<string, any>, axis: VariantAxisDef, master: ProductMaster) {
    const role = canonicalPackagingRole(line.role)
    const kind = packagingKind(line)
    const product = normalizeCode(master.product_kind)
    const axisName = normalizeCode(axis.axis)
    const axisRole = packagingAxisRole(axis, master)
    if (axisRole === "inner" || axisName === "PACKAGING_INNER") {
        return product === "POUCH" && role === "PRIMARY_INNER" && kind === "INNER_POUCH"
    }
    if (axisRole === "outer" || axisName === "PACKAGING_OUTER") {
        if (product === "ROLL" || product === "POD") return role === "ROLL_DISPATCH" && kind === "SHEET"
        if (product === "POUCH") return role === "FINAL_GUNNY" && ["GONNY", "SHEET"].includes(kind)
    }
    if (axisRole === "other") return role === "EXTRA"
    return false
}

function packagingLineAllowedCodes(master: ProductMaster, axis: VariantAxisDef) {
    const lines = master.fixed_attributes?.packaging_lines
    if (!Array.isArray(lines)) return null
    const codes = new Set<string>()
    lines.forEach((line: Record<string, any>) => {
        if (!packagingLineMatchesAxis(line, axis, master)) return
        const code = normalizeCode(line.material_code || line.code || line.material)
        if (code) codes.add(code)
    })
    return codes.size ? codes : null
}

function packagingMaterialAllowedForSales(material: PackagingMaterial, axis: VariantAxisDef, master: ProductMaster) {
    const explicitAllowed = packagingLineAllowedCodes(master, axis)
    if (explicitAllowed) return explicitAllowed.has(normalizeCode(material.code))

    const product = normalizeCode(master.product_kind)
    const kind = packagingKind(material)
    const axisName = normalizeCode(axis.axis)
    const axisRole = packagingAxisRole(axis, master)
    if (axisRole === "inner" || axisName === "PACKAGING_INNER") {
        return product === "POUCH" && kind === "INNER_POUCH"
    }
    if (axisRole === "outer" || axisName === "PACKAGING_OUTER") {
        if (product === "ROLL" || product === "POD") return kind === "SHEET"
        if (product === "POUCH") return ["GONNY", "SHEET"].includes(kind)
    }
    if (axisRole === "other") return !["INNER_POUCH", "GONNY", "SHEET"].includes(kind)
    if (axisRole === "generic") {
        if (product === "ROLL" || product === "POD") return kind === "SHEET"
        if (product === "POUCH") return ["INNER_POUCH", "GONNY", "SHEET"].includes(kind)
    }

    const rawFilterKind = axis.master_data_filter?.packaging_kind
    const filterKinds = Array.isArray(rawFilterKind)
        ? rawFilterKind.map((value) => normalizeCode(value)).filter(Boolean)
        : [normalizeCode(rawFilterKind)].filter(Boolean)
    if (filterKinds.length) return filterKinds.map((value) => value === "GUNNY" ? "GONNY" : value).includes(kind)
    return true
}

function packagingAxisRole(axis: VariantAxisDef, master: ProductMaster): "inner" | "outer" | "other" | "generic" {
    const product = normalizeCode(master.product_kind)
    const axisName = normalizeCode(axis.axis)
    const label = normalizeCode(axis.label)
    const type = normalizeCode((axis as any).type)
    const combined = `${axisName} ${label} ${type}`
    if (combined.includes("INNER")) return "inner"
    if (combined.includes("OUTER") || combined.includes("GUNNY") || combined.includes("GONNY") || combined.includes("SHEET") || combined.includes("ROLL_DISPATCH")) return "outer"
    if (combined.includes("OTHER") || combined.includes("EXTRA") || combined.includes("EOD") || combined.includes("TAPE") || combined.includes("LABEL") || combined.includes("TAG")) return "other"
    if (axisName === "PACKAGING" && product === "POUCH") return "inner"
    return "generic"
}

function nextHex(hex: string): string {
    const palette = ["#0ea5e9", "#7c3aed", "#dc2626", "#16a34a", "#f59e0b", "#1d4ed8", "#ea580c"]
    const idx = palette.findIndex((c) => c.toLowerCase() === hex.toLowerCase())
    return palette[(idx + 1) % palette.length] || palette[0]
}

function artworkColorCode(artwork: Artwork) {
    const front = Number(artwork.front_colors_count ?? artwork.colors_count ?? 0)
    const back = Number(artwork.back_colors_count ?? 0)
    return back > 0 ? `${front}F${back}B` : `${front}F`
}

function artworkToColorway(artwork: Artwork): ArtworkColorway {
    return {
        id: artwork.id,
        name: `${artwork.design_code} · ${artwork.name}`,
        family: artworkColorCode(artwork),
        thumbnail_url: artwork.primary_image || artwork.image || undefined,
        accent_hex: "#6366f1",
        is_approved: artwork.status === "APPROVED",
        color_count: Number(artwork.colors_count || artwork.front_colors_count || 0),
    }
}

function artworkSlots(names: string[] | undefined, offset = 0) {
    const palette = ["#0ea5e9", "#7c3aed", "#dc2626", "#16a34a", "#f59e0b", "#1d4ed8", "#ea580c", "#0f172a"]
    return (names || []).map((name, index) => ({
        index: index + 1,
        name,
        hex: palette[(index + offset) % palette.length],
    }))
}

function artworkToAssignment(artwork: Artwork): ArtworkAssignment {
    const frontNames = artwork.front_colors?.length ? artwork.front_colors : artwork.color_list?.slice(0, artwork.front_colors_count || artwork.colors_count || 0)
    const backNames = artwork.back_colors || []
    return {
        artwork_id: artwork.id,
        design_family_code: artwork.design_code,
        design_family_name: artwork.name,
        colorway_id: artwork.id,
        colorway_name: artwork.name,
        accent_hex: "#6366f1",
        color_count: Number(artwork.colors_count || frontNames?.length || 0),
        cover_url: artwork.primary_image || artwork.image || undefined,
        front_colors: artworkSlots(frontNames),
        back_colors: artworkSlots(backNames, 4),
        cylinder_required: artwork.print_type === "ROTO",
        cylinder_ready: !!artwork.cylinder_ready,
        artwork_approved: artwork.status === "APPROVED",
    }
}

function dedupeByCode<T extends { code: string }>(rows: T[]): T[] {
    const seen = new Set<string>()
    const out: T[] = []
    for (const r of rows) {
        const key = String(r.code || "").trim()
        if (!key) continue
        if (seen.has(key)) continue
        seen.add(key)
        out.push(r)
    }
    return out
}

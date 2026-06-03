"use client"

// Sales order line editor: product master axes, artwork, packing, quantity, and live BOM evidence.

import * as React from "react"
import { useRouter } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import {
    AlertTriangle,
    Box,
    ChevronRight,
    Hash,
    Layers,
    Package,
    PackageCheck,
    Palette,
    Plus,
    Ruler,
    Search,
    Split,
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
import { AxisLayerMatrix, type LayerRowState } from "@/components/erp/axis-layer-matrix"
import { ArtworkSection, type ArtworkAssignment, type ArtworkColorway } from "@/components/erp/artwork-section"
import { SalesPreviewRail } from "./sales-preview-rail"

import {
    productMasterService,
    type ProductMaster,
    type ProductMasterSize,
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
import { INP, LABEL, MONO, SoField, SoSelect, SoReadout } from "./ui"

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
    const artworkQueryParams = React.useMemo(() => {
        if (!line.product_master) return null
        const params: Record<string, any> = {
            status: "APPROVED",
            product_master: line.product_master,
            print_type: line.print_type,
        }
        return params
    }, [line.product_master, line.print_type])

    // Approved artworks are strict: same product master + print method + sheet/tubing form.
    // If metadata is missing on the artwork master, the artwork should be fixed there
    // instead of letting sales attach an incompatible design.
    const { data: artworks = [] } = useQuery({
        queryKey: ["sales-line-artworks", artworkQueryParams],
        queryFn: () => engineeringService.getArtworks(artworkQueryParams || { status: "APPROVED" }),
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

    const overlayArtwork = selectedOverlay?.default_artwork
        ? artworks.find((artwork) => artwork.id === selectedOverlay.default_artwork)
        : undefined
    const overlayDefault = selectedOverlay?.default_artwork
        ? {
              id: selectedOverlay.default_artwork,
              label: selectedOverlay.default_artwork_design_code || selectedOverlay.customer_display_name || selectedOverlay.customer_item_code || "Overlay artwork",
              thumbnail_url: overlayArtwork?.primary_image || overlayArtwork?.image || undefined,
          }
        : undefined
    const selectedSize = sizes.find((s) => s.code === line.size_code) || sizes[0]
    const selectedAddonRows = React.useMemo(
        () => allowedAddonMasters.filter((addon) => line.addons.includes(addon.code)),
        [allowedAddonMasters, line.addons],
    )

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
        if (master.fixed_attributes?.print_type && ["FLEXO", "ROTO"].includes(String(master.fixed_attributes.print_type).toUpperCase())) {
            patch.print_type = String(master.fixed_attributes.print_type).toUpperCase() as "FLEXO" | "ROTO"
        }
        if (master.fixed_attributes?.film_type && ["SHEET", "TUBING"].includes(String(master.fixed_attributes.film_type).toUpperCase())) {
            patch.film_type = String(master.fixed_attributes.film_type).toUpperCase() as "SHEET" | "TUBING"
        }
        onPatch(patch)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [master?.id])

    React.useEffect(() => {
        if (!master?.fixed_attributes?.print_capable || line.artwork_assignment?.artwork_id) return
        const nextFilmType = filmTypeForSize(selectedSize, master)
        if (nextFilmType && nextFilmType !== line.film_type) onPatch({ film_type: nextFilmType })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [master?.id, selectedSize?.code, selectedSize?.stock_form, selectedSize?.roll_form, line.artwork_assignment?.artwork_id])

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
    const axisBuild = React.useMemo(
        () => buildSalesAxisValues(master, line, selectedSize),
        [master, line, selectedSize]
    )
    const axisValues = axisBuild.axisValues

    const { data: livePreview, isLoading: livePreviewLoading } = useQuery({
        queryKey: [
            "sales-live-bom",
            master?.id,
            axisValues,
            line.qty_value,
            line.qty_uom,
            line.price_basis,
            line.print_type,
            line.film_type,
            line.inner_pouch_pcs_per_pack,
            line.artwork_mode,
            line.artwork_assignment?.artwork_id,
            customerId,
            line.customer_product_overlay,
        ],
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
                    packaging_snapshot: buildLinePackagingSnapshot(line),
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
    const addDisabled = !master || !line.size_code || line.qty_value <= 0 || axisBuild.missingRequired.length > 0 || (line.pre_submit_blockers || []).length > 0

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
            pouch_style_roll_axis: g.pouch_style_roll_axis ?? selected.pouch_style_roll_axis ?? null,
            flap_tape_mm: g.flap_tape_mm ?? selected.flap_tape_mm ?? null,
            bottom_gusset_mm: g.bottom_gusset_mm ?? selected.bottom_gusset_mm ?? null,
            trim_loss_mm: g.trim_loss_mm ?? selected.trim_loss_mm ?? null,
            stock_form: g.stock_form ?? selected.stock_form ?? null,
            width_basis: g.width_basis ?? selected.width_basis ?? null,
            film_area_width_mm: g.film_area_width_mm ?? selected.film_area_width_mm ?? null,
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
    const baseWebWidthPlan = computeWebWidthPlan(childTargetWidthMm, activeLaneCount, webWidthPolicy)
    const trimOverride = String(line.lane_trim_mm_override || "").trim()
    const masterTrimMm = firstFiniteNumber(selectedSize?.trim_loss_mm, baseWebWidthPlan.trim_mm, 0)
    const laneTrimMm = trimOverride !== "" ? Math.max(0, Number(trimOverride) || 0) : masterTrimMm
    const webWidthPlan = applyLaneTrimOverride(baseWebWidthPlan, childTargetWidthMm, activeLaneCount, laneTrimMm)
    const plannedParentWidthMm = webWidthPlan.planned_parent_width_mm
    const activeInkFamily = resolveInkBaseFamilyFromPreview(augmentedPreview || livePreview)
    const innerPackFallback = effectiveInnerPackPcs(augmentedPreview || livePreview, master, selectedOverlay)
    const canUseInnerPacking = hasInnerPackingConfig(master, selectedOverlay)
    const previewForRail = augmentedPreview || livePreview || axisBuild.previewBlocker || null
    const materialEvidenceCount = previewMaterialEvidenceCount(previewForRail)
    const hasMaterialPlan = materialEvidenceCount > 0
    const hasBomIssues = previewHasBomIssues(previewForRail)
    const artworkOptions = React.useMemo(
        () => artworks.map((artwork) => artworkToColorway(artwork, activeInkFamily)),
        [artworks, activeInkFamily],
    )
    const artworkBlockers = React.useMemo(
        () => buildArtworkBlockers(line, master, artworks, activeInkFamily, selectedOverlay),
        [line.artwork_mode, line.artwork_assignment, master?.fixed_attributes?.artwork_required, artworks, activeInkFamily, selectedOverlay?.default_artwork],
    )
    const packingBlockers = React.useMemo(
        () => buildPackingBlockers(line, master, augmentedPreview || livePreview),
        [line.inner_pouch_pcs_per_pack, master?.id, augmentedPreview, livePreview],
    )
    const artworkReady = !master?.fixed_attributes?.print_capable || (
        line.artwork_mode === "DEFER"
            ? !master.fixed_attributes?.artwork_required
            : !!line.artwork_assignment?.artwork_id && artworkBlockers.length === 0
    )
    const packingReady = packingBlockers.length === 0
    const bomReady = !!previewForRail && hasMaterialPlan && !hasBomIssues && (line.pre_submit_blockers || []).length === 0
    React.useEffect(() => {
        const retained = (line.pre_submit_blockers || []).filter((issue) => !issue.startsWith("Artwork:") && !issue.startsWith("Packing:"))
        const next = [...retained, ...artworkBlockers, ...packingBlockers]
        if (!sameStringList(line.pre_submit_blockers || [], next)) onPatch({ pre_submit_blockers: next })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [artworkBlockers.join("|"), packingBlockers.join("|")])
    React.useEffect(() => {
        if (line.artwork_mode !== "OVERLAY_DEFAULT") return
        const artworkId = selectedOverlay?.default_artwork
        if (!artworkId) return
        const artwork = artworks.find((item) => item.id === artworkId)
        if (!artwork) return
        if (line.artwork_assignment?.artwork_id === artwork.id) return
        onPatch({ artwork_assignment: artworkToAssignment(artwork, activeInkFamily) })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [line.artwork_mode, selectedOverlay?.default_artwork, artworks.length, activeInkFamily])
    React.useEffect(() => {
        const artworkId = line.artwork_assignment?.artwork_id
        if (!artworkId) return
        const artwork = artworks.find((item) => item.id === artworkId)
        if (!artwork) return
        const next = artworkToAssignment(artwork, activeInkFamily)
        if (assignmentColorSignature(next) !== assignmentColorSignature(line.artwork_assignment)) {
            onPatch({ artwork_assignment: next })
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeInkFamily, artworks.length, line.artwork_assignment?.artwork_id])

    return (
        <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_440px]">
            {/* ───────────────── LEFT: section cards ───────────────── */}
            <div className="space-y-3">
                {/* Overlay match banner (when customer has an overlay for this master) */}
                {selectedOverlay ? (
                    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50/70 px-4 py-2.5 text-[11px] shadow-sm">
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
                    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-violet-200 bg-violet-50/70 px-4 py-2.5 text-[11px] shadow-sm">
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

                {/* 1. Product master */}
                <SectionCard
                    icon={<Package className="h-3.5 w-3.5" />}
                    tone="indigo"
                    title="Product master"
                    badge={master ? (
                        <span className="inline-flex h-6 items-center rounded-full bg-slate-100 px-2 font-mono text-[10px] font-bold text-slate-600">{master.code}</span>
                    ) : (
                        <span className="text-[10px] font-black uppercase tracking-wider text-rose-600">required</span>
                    )}
                >
                    <MasterPicker masters={masters} value={line.product_master} onChange={(id) => onPatch({
                        product_master: id,
                        size_code: "",
                        layer_values: {},
                        axis_values: {},
                        addons: [],
                        artwork_assignment: undefined,
                        customer_product_overlay: undefined,
                    })} />
                    {master ? (
                        <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] font-bold text-slate-500">
                            <span>{master.layer_template.length} layers · {(master.variant_axes || []).length} axes</span>
                            {master.template_name ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">route · {master.template_name}</span> : null}
                            {master.fixed_attributes?.print_capable ? <span className="rounded-full bg-fuchsia-50 px-2 py-0.5 text-fuchsia-700 ring-1 ring-fuchsia-200">print-capable</span> : null}
                        </div>
                    ) : null}
                </SectionCard>

                {master ? (
                    <>
                        {/* 2. Size axis */}
                        {sizes.length > 0 ? (
                            <SectionCard icon={<Ruler className="h-3.5 w-3.5" />} tone="violet" title="Size axis" hint="master-allowed sizes">
                                <SizeAxis sizes={sizes} value={line.size_code} onChange={(c) => onPatch({ size_code: c })} />
                                <div className="mt-2 rounded-xl bg-violet-50 px-3 py-2 text-[11px] font-semibold leading-5 text-violet-800 ring-1 ring-violet-200">
                                    The real axes are <b>Size</b>, the <b>per-layer</b> stack and <b>add-ons</b> — generated from the template&rsquo;s layer structure and constrained to the values this master allows. Roll / web width is derived from size × pouch-style, not picked here.
                                </div>
                            </SectionCard>
                        ) : null}

                        {/* 3. Per-layer axes */}
                        {master.layer_template.length > 0 ? (
                            <SectionCard icon={<Layers className="h-3.5 w-3.5" />} tone="emerald" title="Per-layer axes" hint={`${master.layer_template.length} layers · from template`}>
                                <div className="overflow-hidden rounded-xl ring-1 ring-slate-200">
                                    <div className={cn("grid grid-cols-[40px_1fr_104px_120px] gap-2 bg-slate-50 px-3 py-1.5", LABEL)}>
                                        <div>L</div><div>Film variant</div><div className="text-right">Thick µ</div><div>Grade</div>
                                    </div>
                                    {master.layer_template.map((row, i) => {
                                        const idx = i + 1
                                        const st = (line.layer_values[idx] || {}) as LayerRowState
                                        const grades = Array.isArray(row.grade_options) ? row.grade_options : []
                                        const toneBadge = i === 0 ? "bg-slate-900" : i === master.layer_template.length - 1 ? "bg-slate-700" : "bg-amber-600"
                                        return (
                                            <div key={i} className="grid grid-cols-[40px_1fr_104px_120px] items-center gap-2 border-t border-slate-50 px-3 py-1.5 text-xs font-bold">
                                                <span className={cn("inline-flex h-6 items-center justify-center rounded-full px-2 text-[10px] font-extrabold text-white", toneBadge)}>L{idx}</span>
                                                <span className="inline-flex w-fit items-center rounded-md bg-blue-50 px-2 py-1 font-mono text-[11px] font-bold text-blue-700 ring-1 ring-blue-100">{st.film_variant_code || row.film_variant_code || "—"}</span>
                                                <input
                                                    type="number"
                                                    aria-label={`Thickness L${idx}`}
                                                    value={st.thickness_micron ?? row.thickness_micron ?? ""}
                                                    onChange={(e) => onPatch({ layer_values: { ...line.layer_values, [idx]: { ...(line.layer_values[idx] || ({} as LayerRowState)), thickness_micron: Number(e.target.value) } } })}
                                                    className={cn(INP, MONO, "h-[32px] text-right")}
                                                />
                                                {grades.length > 0 ? (
                                                    <SoSelect aria-label={`Grade L${idx}`} value={st.grade || row.default_grade || ""} onChange={(v) => onPatch({ layer_values: { ...line.layer_values, [idx]: { ...(line.layer_values[idx] || ({} as LayerRowState)), grade: v } } })} className="h-[32px]">
                                                        {grades.map((gr) => <option key={gr} value={gr}>{gr}</option>)}
                                                    </SoSelect>
                                                ) : (
                                                    <span className="text-center text-[11px] font-bold text-slate-400">n/a</span>
                                                )}
                                            </div>
                                        )
                                    })}
                                </div>
                                <div className="mt-2 text-[11px] font-semibold leading-5 text-slate-500">Per-layer axes are <b>film-variant · thickness · grade</b> — grade only shows on extrudable layers, options exactly as the product master permits. Roll / web width is derived from size × pouch-style, not picked per layer.</div>
                            </SectionCard>
                        ) : null}

                        {/* 4. Production lane (lane-up) */}
                        <SectionCard
                            icon={<Split className="h-3.5 w-3.5" />}
                            tone="blue"
                            title="Production lane"
                            badge={<span className="inline-flex h-6 items-center rounded-full bg-slate-100 px-2 text-[10px] font-bold text-slate-600">policy {webWidthPolicy?.code || "default"}</span>}
                        >
                            <div className="flex gap-2">
                                {allowedLaneCounts.map((lane) => {
                                    const parent = computeWebWidthPlan(childTargetWidthMm, lane, webWidthPolicy).planned_parent_width_mm
                                    const on = activeLaneCount === lane
                                    return (
                                        <button
                                            key={lane}
                                            type="button"
                                            onClick={() => onPatch({ preferred_lane_count: lane, lane_count_source: "OPERATOR_CHOICE" })}
                                            className={cn(
                                                "flex-1 rounded-xl border p-2 text-center transition",
                                                on ? "border-indigo-500 bg-gradient-to-b from-indigo-50 to-white ring-[3px] ring-indigo-400/15" : "border-slate-200 bg-white hover:border-indigo-200",
                                            )}
                                        >
                                            <div className="text-sm font-extrabold text-slate-900">{lane}-up</div>
                                            <div className={cn("text-[10px]", MONO, on ? "text-indigo-600" : "text-slate-500")}>{parent ? `${Math.round(parent)} mm` : "—"}</div>
                                        </button>
                                    )
                                })}
                            </div>
                            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                                <SoField label="Child target"><SoReadout className={MONO}>{childTargetWidthMm ? `${Math.round(childTargetWidthMm)} mm` : "—"}</SoReadout></SoField>
                                <SoField label="Planned parent"><SoReadout className={MONO}>{plannedParentWidthMm ? `${Math.round(plannedParentWidthMm)} mm` : "—"}</SoReadout></SoField>
                                <SoField label="Trim" hint={trimOverride ? "override" : "master/policy"}>
                                    <input
                                        type="number"
                                        min={0}
                                        step={0.1}
                                        aria-label="Lane trim mm"
                                        value={line.lane_trim_mm_override ?? ""}
                                        onChange={(e) => onPatch({ lane_trim_mm_override: e.target.value })}
                                        placeholder={`${fmtCompact(masterTrimMm)} mm`}
                                        className={cn(INP, MONO)}
                                    />
                                </SoField>
                                <SoField label="Std / rem"><SoReadout className={cn(MONO, "text-[12px]")}>{webWidthPlan.selected_standard_parent_width_mm ? `${Math.round(webWidthPlan.selected_standard_parent_width_mm)} mm` : webWidthPlan.remainder_mm ? `${Math.round(webWidthPlan.remainder_mm)} ${webWidthPlan.remainder_disposition.toLowerCase()}` : "calc"}</SoReadout></SoField>
                            </div>
                            {webWidthPlan.warnings.length ? (
                                <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] font-semibold text-amber-900">
                                    {webWidthPlan.warnings.join(" ")}
                                </div>
                            ) : null}
                        </SectionCard>

                        {/* 5. Artwork & print (print-capable masters only) */}
                        {master.fixed_attributes?.print_capable ? (
                            <SectionCard icon={<Palette className="h-3.5 w-3.5" />} tone="fuchsia" title="Artwork & print" hint="optional · cylinder + colorway">
                                <ArtworkSection
                                    mode={line.artwork_mode}
                                    onModeChange={(m) => onPatch({ artwork_mode: m })}
                                    printType={line.print_type}
                                    onPrintTypeChange={(t) => onPatch({ print_type: t })}
                                    filmType={line.film_type}
                                    onFilmTypeChange={(t) => onPatch({ film_type: t })}
                                    inkBaseFamily={activeInkFamily}
                                    filterSummary={`Approved · ${line.print_type} · ${line.film_type}`}
                                    options={artworkOptions}
                                    assignment={line.artwork_assignment}
                                    overlayDefault={overlayDefault}
                                    onSelectColorway={(cw) => {
                                        const artwork = artworks.find((item) => item.id === cw.id)
                                        if (artwork) {
                                            onPatch({
                                                artwork_assignment: artworkToAssignment(artwork, activeInkFamily),
                                                print_type: (artwork.print_type === "FLEXO" ? "FLEXO" : "ROTO"),
                                                film_type: artworkFilmType(artwork),
                                            })
                                        }
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
                                    onReplaceColor={() => {
                                        if (typeof window !== "undefined") window.open("/master/inks", "_blank", "noopener,noreferrer")
                                    }}
                                    disabled={!master.fixed_attributes?.print_capable}
                                />
                            </SectionCard>
                        ) : null}

                        {/* 6. Add-ons */}
                        <SectionCard icon={<Plus className="h-3.5 w-3.5" />} tone="rose" title="Add-ons" hint={addonAxis ? (addonAxis.required ? "required" : "optional · usage preview live") : "master axis not declared"}>
                            {addonAxis ? (
                                <AddonPicker addons={allowedAddonMasters} selected={line.addons} selectedSize={selectedSize} orderQty={line.qty_value} orderUom={line.qty_uom} onChange={(addons) => onPatch({ addons })} />
                            ) : (
                                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs font-semibold text-slate-500">
                                    No add-ons are declared on this Product Master, so no add-on selector or BOM add-on row is shown.
                                </div>
                            )}
                        </SectionCard>

                        {/* 7. Packaging — inner-pouch selection + override + catalog (POD) + packing note */}
                        <SectionCard icon={<Box className="h-3.5 w-3.5" />} tone="teal" title="Packaging" hint="inner pouch · override · packing note">
                            <div className="space-y-3">
                                <div className="grid gap-3 sm:grid-cols-2">
                                    {hasInnerPackagingAxis(master) ? <InnerPouchSelect master={master} line={line} onPatch={onPatch} /> : null}
                                    <CatalogAxesGrid master={master} line={line} onPatch={onPatch} />
                                </div>
                                {isPouchOutput(master) && canUseInnerPacking ? (
                                    <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
                                        <SoField label="Pcs per inner pouch" hint="override">
                                            <input
                                                type="number"
                                                min={1}
                                                step={1}
                                                value={line.inner_pouch_pcs_per_pack || ""}
                                                onChange={(e) => onPatch({ inner_pouch_pcs_per_pack: e.target.value })}
                                                placeholder={innerPackFallback ? `${innerPackFallback}` : "e.g. 100"}
                                                className={cn(INP, MONO)}
                                            />
                                        </SoField>
                                        <div className="rounded-xl border border-amber-200 bg-amber-50/60 px-3 py-2 text-[11px] leading-5 text-amber-900">
                                            <span className="font-black uppercase tracking-wider text-amber-700">BOM rule</span>
                                            <div>
                                                Inner pack demand = ceil(total pouches / pcs per inner).{" "}
                                                {line.inner_pouch_pcs_per_pack
                                                    ? `Sales override: ${line.inner_pouch_pcs_per_pack} pcs / inner.`
                                                    : innerPackFallback
                                                      ? `Fallback in use: ${innerPackFallback} pcs / inner.`
                                                      : "Pick an inner pouch/default first, then override if needed."}
                                            </div>
                                        </div>
                                    </div>
                                ) : isPouchOutput(master) ? (
                                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-semibold text-slate-500">
                                        Inner pouch packing is not declared on this Product Master, so no inner-pouch axis or pcs/inner override is shown.
                                    </div>
                                ) : null}
                                <SoField label="Packing note" hint="optional · printed on dispatch">
                                    <input
                                        value={line.remarks}
                                        onChange={(e) => onPatch({ remarks: e.target.value })}
                                        placeholder="e.g. 24 pouches per inner · 12 inners per gunny"
                                        className={INP}
                                    />
                                </SoField>
                            </div>
                        </SectionCard>

                        {/* 8. Quantity & price (rate required by backend; margin lives in quotation) */}
                        <SectionCard icon={<Hash className="h-3.5 w-3.5" />} tone="slate" title="Quantity & price" hint="rate required to place · margin in quotation">
                            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                                <SoField label="Qty">
                                    <input type="number" aria-label="Quantity" value={line.qty_value || ""} onChange={(e) => onPatch({ qty_value: Number(e.target.value) })} className={cn(INP, MONO)} />
                                </SoField>
                                <SoField label="UOM">
                                    <SoSelect aria-label="UOM" value={line.qty_uom} onChange={(v) => onPatch({ qty_uom: v as any })}>
                                        <option value="KG">KG</option>
                                        <option value="PCS">PCS</option>
                                    </SoSelect>
                                </SoField>
                                <SoField label={`Rate (per ${line.price_basis})`}>
                                    <input value={line.unit_price} aria-label="Unit price" onChange={(e) => onPatch({ unit_price: e.target.value })} placeholder="₹" className={cn(INP, MONO)} />
                                </SoField>
                                <SoField label="Subtotal">
                                    <SoReadout className={cn(MONO, "border-emerald-200 bg-emerald-50 text-emerald-800")}>{subtotal > 0 ? `₹${Math.round(subtotal).toLocaleString("en-IN")}` : "—"}</SoReadout>
                                </SoField>
                            </div>
                        </SectionCard>

                        {/* Actions */}
                        <div className="flex items-center justify-end gap-2 pb-1">
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

            {/* ───────────────── RIGHT: live preview rail ───────────────── */}
            <SalesPreviewRail
                preview={previewForRail}
                loading={livePreviewLoading}
                masterCode={master?.code}
                sizeCode={line.size_code}
                qty={line.qty_value}
                uom={line.qty_uom}
                lane={{
                    childTargetMm: childTargetWidthMm,
                    laneCount: activeLaneCount,
                    plannedParentMm: plannedParentWidthMm,
                    trimMm: webWidthPlan.trim_mm,
                    remainderMm: webWidthPlan.remainder_mm,
                    remainderDisposition: webWidthPlan.remainder_disposition,
                }}
                readiness={[
                    { label: "Product + axes resolved", ok: !!master && axisBuild.missingRequired.length === 0 },
                    { label: "Size + geometry", ok: !!line.size_code },
                    { label: "Material plan", ok: hasMaterialPlan, hint: hasMaterialPlan ? `${materialEvidenceCount} sources` : "waiting for BOM" },
                    { label: "Artwork / ink map", ok: artworkReady, hint: master?.fixed_attributes?.print_capable ? (line.artwork_mode === "DEFER" ? "deferred" : activeInkFamily) : undefined },
                    { label: "Packing override", ok: packingReady, hint: isPouchOutput(master) ? (line.inner_pouch_pcs_per_pack ? `${line.inner_pouch_pcs_per_pack} pcs/inner` : innerPackFallback ? `${innerPackFallback} pcs default` : "catalog/default") : undefined },
                    { label: "BOM resolved", ok: bomReady, hint: hasBomIssues ? "resolver issue" : undefined },
                ]}
                printCapable={!!master?.fixed_attributes?.print_capable}
                artworkDeferred={line.artwork_mode === "DEFER"}
                selectedAddons={selectedAddonRows}
                selectedSize={selectedSize}
            />
        </div>
    )
}

// ─── Field wrappers ─────────────────────────────────────────────

function SectionCard({ icon, tone, title, hint, badge, children }: {
    icon: React.ReactNode
    tone: "indigo" | "violet" | "emerald" | "blue" | "fuchsia" | "rose" | "teal" | "slate" | "amber"
    title: string
    hint?: string
    badge?: React.ReactNode
    children: React.ReactNode
}) {
    const toneBg: Record<string, string> = {
        indigo: "bg-indigo-600", violet: "bg-violet-600", emerald: "bg-emerald-600", blue: "bg-blue-600",
        fuchsia: "bg-fuchsia-600", rose: "bg-rose-500", teal: "bg-teal-600", slate: "bg-slate-800", amber: "bg-amber-500",
    }
    return (
        <div className="rounded-[18px] border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2">
                <span className={cn("grid h-[30px] w-[30px] place-items-center rounded-[10px] text-white", toneBg[tone] || "bg-slate-700")}>{icon}</span>
                <span className="font-display text-sm font-black text-slate-900">{title}</span>
                {badge ? <span className="ml-auto">{badge}</span> : hint ? <span className="ml-auto text-[10px] font-bold text-slate-400">{hint}</span> : null}
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
            return (
                <div className="flex items-center gap-3 rounded-xl border border-indigo-200 bg-indigo-50/50 px-3.5 py-2.5">
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-indigo-600 ring-1 ring-indigo-200"><Package className="h-4 w-4" /></span>
                    <div className="min-w-0 flex-1">
                        <div className="truncate font-display text-sm font-black text-slate-900">{m.name}</div>
                        <div className="truncate font-mono text-[11px] font-bold text-slate-500">{m.code} · {m.layer_template.length} layers · {(m.variant_axes || []).length} axes</div>
                    </div>
                    <button type="button" onClick={() => onChange("")} className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-600 hover:border-indigo-300 hover:text-indigo-700">
                        <X className="h-3 w-3" /> Change
                    </button>
                </div>
            )
        }
    }

    return (
        <div className="space-y-2">
            <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search product master code or name…"
                    className={cn(INP, "pl-9")}
                    autoFocus
                />
            </div>
            <div className="overflow-hidden rounded-xl ring-1 ring-slate-200">
                <div className="flex items-center justify-between bg-slate-50 px-3 py-1.5">
                    <span className={LABEL}>Catalog masters</span>
                    <span className="text-[10px] font-bold text-slate-400">{filtered.length}{search ? " match" : " shown · type to search"}</span>
                </div>
                {filtered.map((m) => {
                    const kind = String(m.product_kind || "POUCH").toUpperCase()
                    return (
                        <button
                            key={m.id}
                            type="button"
                            data-testid={`sales-master-option-${m.code}`}
                            onClick={() => onChange(m.id)}
                            className="group flex w-full items-center gap-3 border-t border-slate-100 px-3 py-2.5 text-left transition hover:bg-indigo-50/50"
                        >
                            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-sm"><Package className="h-4 w-4" /></span>
                            <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-extrabold text-slate-900">{m.name}</span>
                                <span className="block truncate font-mono text-[10px] font-bold text-slate-500">{m.code}</span>
                            </span>
                            <span className="hidden shrink-0 items-center gap-1 sm:flex">
                                <span className="rounded-md bg-blue-50 px-1.5 py-0.5 text-[9px] font-extrabold text-blue-700 ring-1 ring-blue-100">{kind}</span>
                                <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-[9px] font-extrabold text-emerald-700 ring-1 ring-emerald-100">{m.layer_template.length}L</span>
                                <span className="rounded-md bg-violet-50 px-1.5 py-0.5 text-[9px] font-extrabold text-violet-700 ring-1 ring-violet-100">{(m.variant_axes || []).length} axes</span>
                            </span>
                            <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:text-indigo-500" />
                        </button>
                    )
                })}
                {filtered.length === 0 ? (
                    <div className="border-t border-slate-100 px-3 py-5 text-center text-xs font-semibold text-slate-500">No masters match &ldquo;{search}&rdquo;.</div>
                ) : null}
            </div>
        </div>
    )
}

// ─── Size axis as a clean Select ──────────────────────────────────

function SizeAxis({ sizes, value, onChange }: { sizes: any[]; value: string; onChange: (code: string) => void }) {
    return (
        <SoField label="Size" hint="geometry · from master sizes">
            <SoSelect aria-label="Size" value={value} onChange={onChange}>
                {!value ? <option value="">Pick a size</option> : null}
                {sizes.map((s: any) => (
                    <option key={s.id || s.code} value={s.code}>{s.code} · {s.width_mm}×{s.height_mm || 0}</option>
                ))}
            </SoSelect>
            <div className="mt-1 text-[10px] font-semibold text-slate-500">{sizes.length} size{sizes.length === 1 ? "" : "s"} from master{sizes[0]?.gusset_mm ? ` · gusset ${sizes[0].gusset_mm} mm` : ""}</div>
        </SoField>
    )
}

// ─── Catalog axes (POD / inner / outer) ───────────────────────────

function CatalogAxesGrid({ master, line, onPatch }: { master: ProductMaster; line: SalesOrderLine; onPatch: (p: Partial<SalesOrderLine>) => void }) {
    // Inner-pouch packaging axis is rendered by the dedicated InnerPouchSelect.
    const catalogAxes = (master.variant_axes || []).filter((a: VariantAxisDef) =>
        axisCatalogSource(a)
        && String(a.axis) !== "addons"
        && !(axisCatalogSource(a) === "packaging_material" && packagingAxisRole(a, master) === "inner")
    )
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

// Inner-pouch selection binds only to a Product Master-declared inner packaging axis.
function InnerPouchSelect({ master, line, onPatch }: { master: ProductMaster; line: SalesOrderLine; onPatch: (p: Partial<SalesOrderLine>) => void }) {
    const innerAxis = (master.variant_axes || []).find(
        (a: VariantAxisDef) => axisCatalogSource(a) === "packaging_material" && packagingAxisRole(a, master) === "inner",
    )
    const axisKey = innerAxis ? String(innerAxis.axis) : ""
    const { data: rows = [], isLoading } = useQuery({
        queryKey: ["sales-inner-pouch-options", master.id],
        queryFn: async () => {
            if (!innerAxis) return []
            const list = await masterDataService.getPackaging()
            return dedupeByCode(
                list.filter((p: PackagingMaterial) =>
                    String(p.status || "").toUpperCase() === "ACTIVE"
                    && packagingKind(p) === "INNER_POUCH"
                    && packagingMaterialAllowedForSales(p, innerAxis, master),
                ),
            )
        },
        enabled: !!innerAxis,
        staleTime: 60_000,
    })
    if (!innerAxis) return null
    const value = String(axisScalarValue(line.axis_values[axisKey]) || "")
    return (
        <SoField label="Inner pouch" hint="catalog · INNER_POUCH">
            <SoSelect
                aria-label="Inner pouch"
                value={value || "__none"}
                onChange={(v) => onPatch({ axis_values: patchAxisValue(line.axis_values, axisKey, v === "__none" ? "" : v) })}
            >
                <option value="__none">{isLoading ? "Loading…" : "— None (no inner carrier) —"}</option>
                {rows.map((p: PackagingMaterial) => (
                    <option key={p.id} value={p.code}>{p.code} · {p.name}</option>
                ))}
            </SoSelect>
            {innerAxis?.required ? <div className="mt-1 text-[10px] font-bold text-rose-600">required</div> : null}
        </SoField>
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
        <SoField label={String(axis.label || String(axis.axis).replace(/_/g, " "))} hint={isPod ? "catalog · POD" : isPackaging ? "catalog · packaging" : "catalog ref"}>
            <SoSelect aria-label={String(axis.label || axis.axis)} value={value || "__none"} onChange={(v) => onChange(v === "__none" ? "" : v)}>
                <option value="__none">{isLoading ? "Loading…" : "— None —"}</option>
                {effectiveOptions.map((o) => (
                    <option key={o.id} value={o.code}>{o.code} · {o.label}{o.sub ? ` · ${o.sub}` : ""}</option>
                ))}
            </SoSelect>
            {axis.required ? <div className="mt-1 text-[10px] font-bold text-rose-600">required</div> : null}
            {axis.auto_demand_in_house ? <div className="mt-1 flex items-center gap-1 text-[10px] font-bold text-violet-700"><PackageCheck className="h-3 w-3" /> in-house produced · auto-demand if shortage</div> : null}
        </SoField>
    )
}

function AddonPicker({
    addons,
    selected,
    selectedSize,
    orderQty,
    orderUom,
    onChange,
}: {
    addons: Addon[]
    selected: string[]
    selectedSize?: ProductMasterSize
    orderQty: number
    orderUom: string
    onChange: (codes: string[]) => void
}) {
    if (!addons.length) {
        return <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-3 text-center text-xs font-semibold text-slate-500">No add-ons configured for this product.</div>
    }
    const selectedRows = addons.filter((addon) => selected.includes(addon.code))
    return (
        <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
                {addons.map((a) => {
                    const active = selected.includes(a.code)
                    return (
                        <button
                            key={a.id}
                            type="button"
                            onClick={() => onChange(active ? selected.filter((x) => x !== a.code) : [...selected, a.code])}
                            className={cn(
                                "rounded-full px-3 py-1.5 text-left text-[11px] font-bold ring-1 ring-inset",
                                active ? "bg-amber-500 text-white ring-amber-600 shadow-sm" : "bg-white text-slate-700 ring-slate-200 hover:bg-amber-50 hover:text-amber-800 hover:ring-amber-200",
                            )}
                        >
                            <span>{a.name || a.code}</span>
                            <span className={cn("ml-1 font-mono text-[9px] uppercase", active ? "text-amber-50" : "text-slate-400")}>{addonUsageKind(a)}</span>
                        </button>
                    )
                })}
            </div>
            {selectedRows.length ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50/70 px-3 py-2">
                    <div className="text-[10px] font-black uppercase tracking-[0.18em] text-amber-700">Add-on usage preview</div>
                    <div className="mt-1 space-y-1">
                        {selectedRows.map((addon) => (
                            <div key={`addon-preview-${addon.id}`} className="text-[11px] font-semibold text-amber-900">
                                <span className="font-bold">{addon.name || addon.code}</span>
                                <span className="text-amber-700"> · {addonUsagePreview(addon, selectedSize, orderQty, orderUom)}</span>
                            </div>
                        ))}
                    </div>
                </div>
            ) : null}
        </div>
    )
}

function addonUsageKind(addon: Addon) {
    const mode = String(addon.weight_mode || "").toUpperCase()
    const uom = String(addon.addon_purchase_uom || addon.base_uom || "").toUpperCase()
    if (mode === "PER_MM") return uom === "METER" ? "run length" : "per mm"
    if (mode === "PER_PIECE") return "count/pouch"
    if (mode === "FIXED") return "multiplier"
    return "usage"
}

function firstFiniteNumber(...values: unknown[]) {
    for (const value of values) {
        const next = Number(value)
        if (Number.isFinite(next)) return next
    }
    return 0
}

function applyLaneTrimOverride(plan: ReturnType<typeof computeWebWidthPlan>, childTargetWidthMm: number, laneCount: number, trimMm: number) {
    const child = Number(childTargetWidthMm || 0)
    const lane = Math.max(1, Number(laneCount || 1))
    const trim = Math.max(0, Number(trimMm || 0))
    if (!child) return { ...plan, trim_mm: trim }
    const computed = Math.round((child * lane + trim) * 100) / 100
    const planned = plan.selected_standard_parent_width_mm && plan.selected_standard_parent_width_mm >= computed
        ? plan.selected_standard_parent_width_mm
        : computed
    const remainder = Math.max(0, Math.round((planned - computed) * 100) / 100)
    const remainderDisposition = remainder <= 0 ? "NONE" : remainder >= plan.min_remainder_mm ? "KEEP" : "SCRAP"
    return {
        ...plan,
        trim_mm: trim,
        computed_run_width_mm: computed,
        planned_parent_width_mm: planned,
        remainder_mm: remainder,
        remainder_disposition: remainderDisposition as "NONE" | "KEEP" | "SCRAP",
    }
}

function fmtCompact(value: unknown, digits = 1) {
    const next = Number(value)
    if (!Number.isFinite(next)) return "0"
    return next.toLocaleString("en-IN", { maximumFractionDigits: digits })
}

function addonUsagePreview(addon: Addon, selectedSize?: ProductMasterSize, orderQty = 0, orderUom = "PCS") {
    const mode = String(addon.weight_mode || "").toUpperCase()
    const uom = String(addon.addon_purchase_uom || addon.base_uom || "KG").toUpperCase()
    const qty = Math.max(0, Number(orderQty || 0))
    const qtyLabel = String(orderUom || "PCS").toUpperCase() === "PCS" ? "pouches" : `${String(orderUom || "units").toUpperCase()} entered`
    const weightValue = Math.max(0, Number(addon.weight_value || 0))
    const widthMm = Math.max(0, Number(selectedSize?.width_mm || 0))
    const heightMm = Math.max(0, Number(selectedSize?.height_mm || 0))
    const dimensionMm = widthMm || heightMm

    if (mode === "PER_MM" && dimensionMm > 0) {
        const meterQty = (dimensionMm * qty) / 1000
        const weightKg = (weightValue * dimensionMm * qty) / 1000
        const stockPart = uom === "METER" ? `${fmtAddonNumber(meterQty)} METER stock` : `${fmtAddonNumber(weightKg)} KG stock`
        return `1 run/pouch x ${fmtAddonNumber(dimensionMm)} mm x ${fmtAddonNumber(qty, 0)} ${qtyLabel} = ${stockPart}; weight math ${fmtAddonNumber(weightKg)} KG`
    }
    if (mode === "PER_MM") {
        return `Runs per pouch; stock uses selected size length once width/height is known. Weight value ${fmtAddonNumber(weightValue)} g/mm.`
    }
    if (mode === "PER_PIECE") {
        const pieces = qty
        const weightKg = (weightValue * qty) / 1000
        return `Count per pouch: 1 x ${fmtAddonNumber(qty, 0)} ${qtyLabel} = ${fmtAddonNumber(pieces, 0)} ${uom}; weight math ${fmtAddonNumber(weightKg)} KG`
    }
    return `Multiplier per pouch: 1 x ${fmtAddonNumber(qty, 0)} ${qtyLabel}; stock UOM ${uom}.`
}

function fmtAddonNumber(value: number, digits = 2) {
    if (!Number.isFinite(value)) return "0"
    return value.toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: digits,
    })
}

// ─── Helpers ─────────────────────────────────────────────────────

function applyOverlay(overlay: any, onPatch: (p: Partial<SalesOrderLine>) => void) {
    const patch: Partial<SalesOrderLine> = { customer_product_overlay: overlay.id }
    if (overlay.default_price_basis) patch.price_basis = overlay.default_price_basis
    if (overlay.default_artwork) patch.artwork_mode = "OVERLAY_DEFAULT"
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

function hasInnerPackagingAxis(master?: ProductMaster) {
    return !!master && (master.variant_axes || []).some(
        (axis: VariantAxisDef) => axisCatalogSource(axis) === "packaging_material" && packagingAxisRole(axis, master) === "inner",
    )
}

function hasInnerPackingConfig(master: ProductMaster | undefined, overlay: any) {
    if (!isPouchOutput(master)) return false
    if (hasInnerPackagingAxis(master)) return true
    if (effectiveInnerPackPcs(null, master, overlay) > 0) return true
    const lines = master?.fixed_attributes?.packaging_lines
    return Array.isArray(lines) && lines.some((item: any) => normalizeCode(item?.role) === "PRIMARY_INNER")
}

function artworkColorCode(artwork: Artwork) {
    const front = Number(artwork.front_colors_count ?? artwork.colors_count ?? 0)
    const back = Number(artwork.back_colors_count ?? 0)
    return back > 0 ? `${front}F${back}B` : `${front}F`
}

function artworkToColorway(artwork: Artwork, inkBaseFamily: "POLY" | "PET"): ArtworkColorway {
    const accent = firstArtworkSwatch(artwork, inkBaseFamily)
    return {
        id: artwork.id,
        name: `${artwork.design_code} · ${artwork.name}`,
        family: artworkColorCode(artwork),
        thumbnail_url: artwork.primary_image || artwork.image || undefined,
        accent_hex: accent || undefined,
        is_approved: artwork.status === "APPROVED",
        color_count: Number(artwork.colors_count || artwork.front_colors_count || 0),
    }
}

function artworkSlots(artwork: Artwork, names: string[] | undefined, inkBaseFamily: "POLY" | "PET") {
    return (names || []).map((name, index) => ({
        index: index + 1,
        name,
        ...inkSlotForColor(artwork, name, inkBaseFamily),
    }))
}

function artworkToAssignment(artwork: Artwork, inkBaseFamily: "POLY" | "PET"): ArtworkAssignment {
    const frontNames = artwork.front_colors?.length ? artwork.front_colors : artwork.color_list?.slice(0, artwork.front_colors_count || artwork.colors_count || 0)
    const backNames = artwork.back_colors || []
    const accent = firstArtworkSwatch(artwork, inkBaseFamily)
    return {
        artwork_id: artwork.id,
        design_family_code: artwork.design_code,
        design_family_name: artwork.name,
        colorway_id: artwork.id,
        colorway_name: artwork.name,
        accent_hex: accent || undefined,
        color_count: Number(artwork.colors_count || frontNames?.length || 0),
        cover_url: artwork.primary_image || artwork.image || undefined,
        front_colors: artworkSlots(artwork, frontNames, inkBaseFamily),
        back_colors: artworkSlots(artwork, backNames, inkBaseFamily),
        cylinder_required: artwork.print_type === "ROTO",
        cylinder_ready: !!artwork.cylinder_ready,
        artwork_approved: artwork.status === "APPROVED",
        print_type: artwork.print_type,
        film_type: artwork.substrate_mode,
        substrate_mode: artwork.substrate_mode,
        color_mapping: artwork.color_mapping,
    }
}

function artworkFilmType(artwork: Artwork): "SHEET" | "TUBING" {
    const form = normalizeCode(artwork.substrate_mode || "")
    return form === "TUBING" ? "TUBING" : "SHEET"
}

function filmTypeForSize(size: ProductMasterSize | undefined, master: ProductMaster): "SHEET" | "TUBING" | "" {
    const fixed = normalizeCode(master.fixed_attributes?.film_type)
    if (fixed === "SHEET" || fixed === "TUBING") return fixed as "SHEET" | "TUBING"
    const stock = normalizeCode(size?.stock_form || size?.roll_form || size?.width_basis)
    if (stock.includes("TUBE") || stock.includes("TUBING") || stock.includes("LAYFLAT")) return "TUBING"
    if (stock.includes("SHEET") || stock.includes("OPEN") || stock.includes("FOLDED")) return "SHEET"
    return ""
}

function resolveInkBaseFamilyFromPreview(preview: any): "POLY" | "PET" {
    const fromPrint = String(preview?.printing_snapshot?.ink_base_family || preview?.printing?.ink_base_family || "").toUpperCase()
    if (fromPrint === "PET") return "PET"
    if (fromPrint === "POLY") return "POLY"
    return resolveInkBaseFamilyFromLayers(preview?.layer_snapshot || preview?.film_layers || [])
}

function resolveInkBaseFamilyFromLayers(layers: any): "POLY" | "PET" {
    for (const layer of Array.isArray(layers) ? layers : []) {
        const density = Number(layer?.density_g_cm3 ?? layer?.density_gcm3 ?? 0)
        if (Number.isFinite(density) && density > 1.3) return "PET"
    }
    return "POLY"
}

function firstArtworkSwatch(artwork: Artwork, family: "POLY" | "PET") {
    const colors = [...(artwork.front_colors || []), ...(artwork.back_colors || []), ...(artwork.color_list || [])]
    for (const color of colors) {
        const slot = inkSlotForColor(artwork, color, family)
        if (slot.hex) return slot.hex
    }
    return ""
}

function inkSlotForColor(artwork: Artwork, color: string, family: "POLY" | "PET") {
    const mapping = findInkSwatchEntry(artwork, color, family)
    const swatch = validHex(mapping?.swatch_hex) ? String(mapping?.swatch_hex).toUpperCase() : ""
    return {
        hex: swatch,
        role: family,
        ink_base_family: family,
        ink_material_id: mapping?.id,
        swatch_source: swatch ? "INK_MASTER" : "MISSING",
    }
}

function findInkSwatchEntry(artwork: Artwork, color: string, family: "POLY" | "PET"): any {
    const rawMap = artwork.ink_swatch_mapping || {}
    const key = Object.keys(rawMap).find((entry) => normalizeCode(entry) === normalizeCode(color))
    const raw = key ? (rawMap as any)[key] : undefined
    if (!raw || typeof raw !== "object") return null
    if ("swatch_hex" in raw || "id" in raw) return raw
    return raw[family] || raw[family.toLowerCase()] || null
}

function validHex(value: unknown) {
    return /^#[0-9A-F]{6}$/i.test(String(value || "").trim())
}

function buildArtworkBlockers(line: SalesOrderLine, master: ProductMaster | undefined, artworks: Artwork[], inkBaseFamily: "POLY" | "PET", overlay?: any) {
    const blockers: string[] = []
    if (!master?.fixed_attributes?.print_capable) return blockers
    if (master.fixed_attributes?.artwork_required && line.artwork_mode === "DEFER") {
        blockers.push("Artwork: this Product Master requires approved artwork before submit.")
    }
    const assignmentId = line.artwork_assignment?.artwork_id || (line.artwork_mode === "OVERLAY_DEFAULT" ? overlay?.default_artwork : "")
    if (!assignmentId) {
        if (line.artwork_mode === "OVERLAY_DEFAULT") blockers.push("Artwork: selected customer overlay has no default artwork.")
        else if (line.artwork_mode !== "DEFER") blockers.push("Artwork: pick an approved artwork.")
        return blockers
    }
    const artwork = artworks.find((item) => item.id === assignmentId)
    if (!artwork) {
        blockers.push("Artwork: selected artwork does not match product, print method, or SHEET/TUBING form.")
        return blockers
    }
    const names = [...(artwork.front_colors || []), ...(artwork.back_colors || [])]
    if (!names.length && Array.isArray(artwork.color_list)) names.push(...artwork.color_list)
    const missing = names.filter((color) => !inkSlotForColor(artwork, color, inkBaseFamily).hex)
    if (missing.length) blockers.push(`Artwork: missing ${inkBaseFamily} ink master swatch for ${missing.join(", ")}.`)
    return blockers
}

function buildPackingBlockers(line: SalesOrderLine, master: ProductMaster | undefined, preview: any) {
    const blockers: string[] = []
    if (!isPouchOutput(master)) return blockers
    const override = Number(line.inner_pouch_pcs_per_pack || 0)
    if (line.inner_pouch_pcs_per_pack && (!Number.isFinite(override) || override <= 0)) {
        blockers.push("Packing: pcs per inner pouch must be greater than zero.")
        return blockers
    }
    if (override > 0) {
        const primary = preview?.packaging_snapshot?.primary_inner_pack || {}
        if (!primary?.material_id && !primary?.material_code) {
            blockers.push("Packing: pick an inner-pouch packaging axis or Product Master default before overriding pcs per inner.")
        }
    }
    return blockers
}

function sameStringList(a: string[], b: string[]) {
    if (a.length !== b.length) return false
    return a.every((value, index) => value === b[index])
}

function assignmentColorSignature(assignment?: ArtworkAssignment) {
    const slots = [...(assignment?.front_colors || []), ...(assignment?.back_colors || [])]
    return slots.map((slot) => `${slot.index}:${slot.name}:${slot.hex || ""}:${slot.role || ""}:${slot.swatch_source || ""}`).join("|")
}

function isPouchOutput(master?: ProductMaster) {
    if (!master) return false
    const fg = String(master.fixed_attributes?.fg_type || master.product_kind || "").toUpperCase()
    return fg === "POUCH"
}

function effectiveInnerPackPcs(preview: any, master: ProductMaster | undefined, overlay: any) {
    const previewPcs = Number(preview?.packaging_snapshot?.primary_inner_pack?.pcs_per_pack || 0)
    if (Number.isFinite(previewPcs) && previewPcs > 0) return previewPcs
    const overlayPcs = Number(overlay?.default_packing_recipe?.primary_inner_pack?.pcs_per_pack || overlay?.default_packing_recipe?.pcs_per_inner || 0)
    if (Number.isFinite(overlayPcs) && overlayPcs > 0) return overlayPcs
    const lines = master?.fixed_attributes?.packaging_lines
    if (Array.isArray(lines)) {
        const row = lines.find((item: any) => normalizeCode(item?.role) === "PRIMARY_INNER")
        const pcs = Number(row?.pcs_per_pack || 0)
        if (Number.isFinite(pcs) && pcs > 0) return pcs
    }
    return 0
}

function previewArray(value: unknown): any[] {
    return Array.isArray(value) ? value : []
}

function previewMaterialEvidenceCount(preview: any) {
    if (!preview) return 0
    const bom = preview.bom || {}
    const snapshot = preview.bom_snapshot || {}
    const groups = [
        previewArray(bom.planning_lines),
        previewArray(snapshot.planning_lines),
        previewArray(preview.bom_by_step).flatMap((step) => [
            ...previewArray(step?.lines),
            ...previewArray(step?.materials),
            ...previewArray(step?.planning_lines),
        ]),
        previewArray(bom.granules),
        previewArray(bom.films),
        previewArray(bom.inks),
        previewArray(bom.chemicals),
        previewArray(bom.addons),
        previewArray(bom.packaging),
        previewArray(bom.pod),
        previewArray(preview.layer_snapshot),
        previewArray(preview.addons_snapshot),
        previewArray(preview.packaging_lines),
        previewArray(preview.pod_lines),
    ]
    return groups.reduce((sum, group) => sum + group.length, 0)
}

function previewHasBomIssues(preview: any) {
    if (!preview) return false
    const bom = preview.bom || {}
    return [
        ...previewArray(preview.pre_submit_blockers),
        ...previewArray(preview.blockers),
        ...previewArray(preview.errors),
        ...previewArray(bom.errors),
    ].length > 0
}

function buildLinePackagingSnapshot(line: SalesOrderLine) {
    const pcsPerPack = Number(line.inner_pouch_pcs_per_pack || 0)
    if (!Number.isFinite(pcsPerPack) || pcsPerPack <= 0) return undefined
    return {
        primary_inner_pack: {
            enabled: true,
            pcs_per_pack: Math.floor(pcsPerPack),
            basis: "PCS_PER_PACK",
        },
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

"use client";

// Sales order line editor: product master axes, artwork, packing, quantity, and live BOM evidence.

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
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
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  AxisLayerMatrix,
  type LayerRowState,
} from "@/components/erp/axis-layer-matrix";
import {
  ArtworkSection,
  type ArtworkAssignment,
  type ArtworkColorway,
} from "@/components/erp/artwork-section";
import { SalesPreviewRail } from "./sales-preview-rail";

import {
  productMasterService,
  type ProductMaster,
  type ProductMasterSize,
  type VariantAxisDef,
} from "@/services/product-master";
import {
  masterDataService,
  type Addon,
  type PackagingMaterial,
  type PodSkuVariant,
} from "@/services/master-data";
import { engineeringService, type Artwork } from "@/services/engineering";
import {
  computeWebWidthPlan,
  webWidthPolicyService,
} from "@/services/web-width-policy";

import type { SalesOrderLine } from "./types";
import { buildPreviewBlocker, buildSalesAxisValues } from "./axis-values";
import { buildSalesLineLabel } from "./product-label";
import { INP, LABEL, MONO, SoField, SoSelect, SoReadout } from "./ui";

export interface LineEditorProps {
  line: SalesOrderLine;
  masters: ProductMaster[];
  customerId?: string;
  onPatch: (patch: Partial<SalesOrderLine>) => void;
  onCollapse: () => void;
  onAdd?: () => void;
  lineIndex?: number;
}

const PREVIEW_BLOCKER_PREFIX = "Live BOM preview: ";

export function LineEditor({
  line,
  masters,
  customerId,
  onPatch,
  onCollapse,
  onAdd,
  lineIndex,
}: LineEditorProps) {
  const router = useRouter();
  const master = masters.find((m) => m.id === line.product_master);
  const sizeAxis = master ? findAxis(master, "size", "geometry") : undefined;
  const sizeAxisAllowsAdHoc = axisAllowsAdHoc(sizeAxis);
  const addonAxis = master ? findAxis(master, "addons") : undefined;
  const addonAllowedCodes = React.useMemo(
    () => axisAllowedCodes(addonAxis),
    [addonAxis],
  );

  // ─── Data loads ─────────────────────────────────────────────────
  const { data: sizes = [] } = useQuery({
    queryKey: ["product-master-sizes", line.product_master],
    queryFn: () => productMasterService.listSizes(line.product_master),
    enabled: !!line.product_master,
  });

  const { data: addonMasters = [] } = useQuery({
    queryKey: ["master-addons", "active"],
    queryFn: masterDataService.getAddons,
    staleTime: 60_000,
  });
  const allowedAddonMasters = React.useMemo(
    () =>
      filterRowsByAxisCodes(addonMasters, addonAxis, (row: Addon) => row.code),
    [addonMasters, addonAxis],
  );
  const artworkQueryParams = React.useMemo(() => {
    if (!line.product_master) return null;
    const params: Record<string, any> = {
      status: "APPROVED",
      print_type: line.print_type,
      substrate_mode: line.film_type,
    };
    return params;
  }, [line.product_master, line.print_type, line.film_type]);

  // Approved artworks are intentionally not Product-Master locked. The master
  // declares print requirements/defaults; compatibility is print method +
  // SHEET/TUBING, with ink family checked below.
  const { data: strictArtworks = [] } = useQuery({
    queryKey: ["sales-line-artworks", artworkQueryParams],
    queryFn: () =>
      engineeringService.getArtworks(
        artworkQueryParams || { status: "APPROVED" },
      ),
    enabled: !!line.product_master && !!master?.fixed_attributes?.print_capable,
    staleTime: 60_000,
  });
  const artworks = React.useMemo(
    () => uniqueArtworks(strictArtworks),
    [strictArtworks],
  );
  const { data: selectedOverlay } = useQuery({
    queryKey: ["sales-line-overlay", line.customer_product_overlay],
    queryFn: () =>
      productMasterService.getCustomerOverlay(
        line.customer_product_overlay || "",
      ),
    enabled: !!line.customer_product_overlay,
    staleTime: 60_000,
  });

  // Available overlays for this customer × master combo — surfaces a one-click apply.
  const { data: availableOverlays = [] } = useQuery({
    queryKey: [
      "sales-line-available-overlays",
      customerId,
      line.product_master,
    ],
    queryFn: () =>
      productMasterService.listCustomerOverlays({
        customer: customerId,
        product_master: line.product_master,
        active: true,
      }),
    enabled:
      !!customerId && !!line.product_master && !line.customer_product_overlay,
    staleTime: 30_000,
  });

  // Live route steps for the rail
  const { data: routeInfo } = useQuery({
    queryKey: ["product-master-template", line.product_master],
    queryFn: () => productMasterService.getTemplate(line.product_master),
    enabled: !!line.product_master,
    staleTime: 60_000,
  });
  const { data: webWidthPolicy } = useQuery({
    queryKey: ["web-width-policy", "default"],
    queryFn: webWidthPolicyService.getDefault,
    enabled: !!line.product_master,
    staleTime: 60_000,
  });

  const overlayArtwork = selectedOverlay?.default_artwork
    ? artworks.find((artwork) => artwork.id === selectedOverlay.default_artwork)
    : undefined;
  const overlayDefault = selectedOverlay?.default_artwork
    ? {
        id: selectedOverlay.default_artwork,
        label:
          selectedOverlay.default_artwork_design_code ||
          selectedOverlay.customer_display_name ||
          selectedOverlay.customer_item_code ||
          "Overlay artwork",
        thumbnail_url:
          overlayArtwork?.primary_image || overlayArtwork?.image || undefined,
      }
    : undefined;
  const adHocSize = React.useMemo(() => adHocSizeFromLine(line), [line]);
  const selectedSize =
    sizes.find((s) => s.code === line.size_code) || adHocSize || sizes[0];
  const liveLineLabel = React.useMemo(
    () =>
      buildSalesLineLabel({
        line,
        master,
        size: selectedSize,
        overlay: selectedOverlay,
      }),
    [line, master, selectedSize, selectedOverlay],
  );
  const selectedAddonRows = React.useMemo(
    () =>
      allowedAddonMasters.filter((addon) => line.addons.includes(addon.code)),
    [allowedAddonMasters, line.addons],
  );
  const masterChemistry = React.useMemo(
    () => masterChemistrySummary(master),
    [master],
  );
  const layerMaterialAxisEnabled = React.useMemo(
    () => hasLayerMaterialAxis(master),
    [master],
  );
  const selectableLayerCount = React.useMemo(
    () =>
      (master?.layer_template || []).filter((row) =>
        layerAllowedFilmCodes(row).length > 1,
      ).length,
    [master],
  );

  // ─── Effects: init defaults when master changes ────────────────
  React.useEffect(() => {
    if (!master) return;
    if (Object.keys(line.layer_values).length > 0) return;
    const next: Record<number, LayerRowState> = {};
    master.layer_template.forEach((row, i) => {
      next[i + 1] = {
        role: row.role,
        film_variant_code: row.film_variant_code,
        thickness_micron: row.thickness_micron,
        grade: row.default_grade,
      };
    });
    const patch: Partial<SalesOrderLine> = { layer_values: next };
    if (!line.template_id && master.template)
      patch.template_id = master.template;
    if (
      master.fixed_attributes?.print_type &&
      ["FLEXO", "ROTO"].includes(
        String(master.fixed_attributes.print_type).toUpperCase(),
      )
    ) {
      patch.print_type = String(
        master.fixed_attributes.print_type,
      ).toUpperCase() as "FLEXO" | "ROTO";
    }
    if (
      master.fixed_attributes?.film_type &&
      ["SHEET", "TUBING"].includes(
        String(master.fixed_attributes.film_type).toUpperCase(),
      )
    ) {
      patch.film_type = String(
        master.fixed_attributes.film_type,
      ).toUpperCase() as "SHEET" | "TUBING";
    }
    onPatch(patch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [master?.id]);

  React.useEffect(() => {
    if (
      !master?.fixed_attributes?.print_capable ||
      line.artwork_assignment?.artwork_id
    )
      return;
    const nextFilmType = filmTypeForSize(selectedSize, master);
    if (nextFilmType && nextFilmType !== line.film_type)
      onPatch({ film_type: nextFilmType });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    master?.id,
    selectedSize?.code,
    selectedSize?.stock_form,
    selectedSize?.roll_form,
    line.artwork_assignment?.artwork_id,
  ]);

  React.useEffect(() => {
    if (!line.size_code && !adHocSize && sizes.length)
      onPatch({ size_code: sizes[0].code });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sizes.length, line.size_code, adHocSize?.code]);

  React.useEffect(() => {
    if (liveLineLabel && liveLineLabel !== line.line_label) {
      onPatch({ line_label: liveLineLabel });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveLineLabel, line.line_label]);

  React.useEffect(() => {
    if (!master) return;
    if (!addonAxis && line.addons.length) {
      onPatch({ addons: [] });
      return;
    }
    if (
      addonAllowedCodes &&
      line.addons.some((code) => !addonAllowedCodes.has(normalizeCode(code)))
    ) {
      onPatch({
        addons: line.addons.filter((code) =>
          addonAllowedCodes.has(normalizeCode(code)),
        ),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [master?.id, addonAxis?.axis, line.addons.join("|")]);

  // ─── Live BOM preview query (drives the right rail) ─────────────
  const axisBuild = React.useMemo(
    () => buildSalesAxisValues(master, line, selectedSize),
    [master, line, selectedSize],
  );
  const axisValues = axisBuild.axisValues;

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
      line.issue_policy_overrides,
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
          template_id:
            line.template_id ||
            master!.template ||
            master!.default_template ||
            null,
          axis_values: axisValues,
          quantity: line.qty_value,
          quantity_uom: line.qty_uom,
          price_basis: line.price_basis,
          packaging_snapshot: buildLinePackagingSnapshot(line),
          issue_policy_overrides: line.issue_policy_overrides || [],
                printing: master!.fixed_attributes?.print_capable
                  ? {
                      enabled: true,
                      print_type: line.print_type,
                      film_type: line.film_type,
                      chemicals: buildLineChemistrySnapshot(master),
                      artwork_id:
                        line.artwork_mode === "DEFER"
                          ? null
                    : line.artwork_assignment?.artwork_id,
                defer_artwork_to_planner: line.artwork_mode === "DEFER",
              }
            : { enabled: false },
        });
      } catch (error) {
        if (axisBuild.previewBlocker) return axisBuild.previewBlocker;
        return buildPreviewBlocker(
          master!,
          [previewErrorMessage(error)],
          selectedSize,
          line,
          "PREVIEW_API_ERROR",
        );
      }
    },
    enabled: !!master?.id && !!selectedSize && !!axisValues.size,
    staleTime: 0,
    retry: false,
  });

  const masterFlags = master
    ? {
        print_capable: !!master.fixed_attributes?.print_capable,
        pod_locked: !!(
          master.fixed_attributes?.pod_enabled &&
          (master.fixed_attributes?.pod_variant_code ||
            master.fixed_attributes?.pod_variant)
        ),
        addons_axis: addonAxis
          ? addonAxis.required
            ? ("required" as const)
            : ("optional" as const)
          : ("off" as const),
        artwork_deferred: line.artwork_mode === "DEFER",
        artwork_attached:
          line.artwork_mode !== "DEFER" &&
          !!line.artwork_assignment?.artwork_id,
      }
    : undefined;

  const subtotal = line.qty_value * (parseFloat(line.unit_price || "0") || 0);
  const baseAddDisabled =
    !master ||
    !line.size_code ||
    line.qty_value <= 0 ||
    axisBuild.missingRequired.length > 0 ||
    (line.pre_submit_blockers || []).length > 0;

  // Augment the API preview with the user-picked size as a fallback for geometry
  // fields the backend doesn't always populate. Keeps the rail honest about
  // what the user just selected while the backend progressively resolves BOM.
  const augmentedPreview = React.useMemo(() => {
    if (!livePreview) return null;
    const selected: any = selectedSize || {};
    const g: any = livePreview.geometry_snapshot || {};
    const merged = {
      ...g,
      width_mm: g.width_mm ?? selected.width_mm ?? null,
      height_mm: g.height_mm ?? selected.height_mm ?? null,
      gusset_mm: g.gusset_mm ?? selected.gusset_mm ?? null,
      size_code: g.size_code || selected.code || line.size_code || null,
      roll_width_mm: g.roll_width_mm ?? selected.roll_width_mm ?? null,
      child_target_width_mm:
        g.child_target_width_mm ??
        g.target_child_width_mm ??
        selected.child_target_width_mm ??
        selected.roll_width_mm ??
        null,
      target_child_width_mm:
        g.target_child_width_mm ??
        g.child_target_width_mm ??
        selected.child_target_width_mm ??
        selected.roll_width_mm ??
        null,
      pouch_style: g.pouch_style ?? selected.pouch_style ?? null,
      pouch_style_master:
        g.pouch_style_master ?? selected.pouch_style_master ?? null,
      pouch_style_master_code:
        g.pouch_style_master_code ?? selected.pouch_style_master_code ?? null,
      pouch_style_roll_axis:
        g.pouch_style_roll_axis ?? selected.pouch_style_roll_axis ?? null,
      flap_tape_mm: g.flap_tape_mm ?? selected.flap_tape_mm ?? null,
      bottom_gusset_mm: g.bottom_gusset_mm ?? selected.bottom_gusset_mm ?? null,
      trim_loss_mm: g.trim_loss_mm ?? selected.trim_loss_mm ?? null,
      stock_form: g.stock_form ?? selected.stock_form ?? null,
      width_basis: g.width_basis ?? selected.width_basis ?? null,
      film_area_width_mm:
        g.film_area_width_mm ?? selected.film_area_width_mm ?? null,
    };
    return { ...livePreview, geometry_snapshot: merged };
  }, [livePreview, selectedSize, line.size_code]);
  const allowedLaneCounts = React.useMemo(() => {
    const lanes = (webWidthPolicy?.allowed_lanes || [])
      .map((v) => Number(v))
      .filter((v) => Number.isFinite(v) && v > 0);
    return lanes.length ? lanes : [1, 2, 3];
  }, [webWidthPolicy?.allowed_lanes]);
  const childTargetWidthMm = Number(
    (augmentedPreview?.geometry_snapshot as any)?.child_target_width_mm ||
      (augmentedPreview?.geometry_snapshot as any)?.target_child_width_mm ||
      selectedSize?.child_target_width_mm ||
      (augmentedPreview?.geometry_snapshot as any)?.roll_width_mm ||
      selectedSize?.roll_width_mm ||
      0,
  );
  const activeLaneCount = allowedLaneCounts.includes(
    Number(line.preferred_lane_count || 1),
  )
    ? Number(line.preferred_lane_count || 1)
    : allowedLaneCounts[0] || 1;
  const baseWebWidthPlan = computeWebWidthPlan(
    childTargetWidthMm,
    activeLaneCount,
    webWidthPolicy,
  );
  const trimOverride = String(line.lane_trim_mm_override || "").trim();
  const masterTrimMm = firstFiniteNumber(
    selectedSize?.trim_loss_mm,
    baseWebWidthPlan.trim_mm,
    0,
  );
  const laneTrimMm =
    trimOverride !== "" ? Math.max(0, Number(trimOverride) || 0) : masterTrimMm;
  const webWidthPlan = applyLaneTrimOverride(
    baseWebWidthPlan,
    childTargetWidthMm,
    activeLaneCount,
    laneTrimMm,
  );
  const plannedParentWidthMm = webWidthPlan.planned_parent_width_mm;
  const activeInkFamily = resolveInkBaseFamilyFromPreview(
    augmentedPreview || livePreview,
  );
  const innerPackFallback = effectiveInnerPackPcs(
    augmentedPreview || livePreview,
    master,
    selectedOverlay,
  );
  const canUseInnerPacking = hasInnerPackingConfig(master, selectedOverlay);
  const previewForRail =
    augmentedPreview || livePreview || axisBuild.previewBlocker || null;
  const materialEvidenceCount = previewMaterialEvidenceCount(previewForRail);
  const hasMaterialPlan = materialEvidenceCount > 0;
  const hasBomIssues = previewHasBomIssues(previewForRail);
  const resolverBlocker = previewResolverBlocker(previewForRail);
  const addDisabled = baseAddDisabled || hasBomIssues;

  React.useEffect(() => {
    const existing = line.pre_submit_blockers || [];
    const kept = existing.filter(
      (issue) => !issue.startsWith(PREVIEW_BLOCKER_PREFIX),
    );
    const next = resolverBlocker
      ? [...kept, `${PREVIEW_BLOCKER_PREFIX}${resolverBlocker}`]
      : kept;
    if (!sameStringList(existing, next)) onPatch({ pre_submit_blockers: next });
  }, [line.pre_submit_blockers, onPatch, resolverBlocker]);
  const artworkOptions = React.useMemo(
    () =>
      artworks
        .filter((artwork) =>
          artworkSelectableForLine(
            artwork,
            master,
            line.print_type,
            line.film_type,
          ),
        )
        .map((artwork) => artworkToColorway(artwork, activeInkFamily)),
    [artworks, activeInkFamily, line.print_type, line.film_type],
  );
  const artworkBlockers = React.useMemo(
    () =>
      buildArtworkBlockers(
        line,
        master,
        artworks,
        selectedOverlay,
      ),
    [
      line.artwork_mode,
      line.artwork_assignment,
      line.print_type,
      line.film_type,
      master?.fixed_attributes?.artwork_required,
      artworks,
      selectedOverlay?.default_artwork,
    ],
  );
  const packingBlockers = React.useMemo(
    () => buildPackingBlockers(line, master, augmentedPreview || livePreview),
    [line.inner_pouch_pcs_per_pack, master?.id, augmentedPreview, livePreview],
  );
  const artworkReady =
    !master?.fixed_attributes?.print_capable ||
    (line.artwork_mode === "DEFER"
      ? true
      : !!line.artwork_assignment?.artwork_id && artworkBlockers.length === 0);
  const packingReady = packingBlockers.length === 0;
  const bomReady =
    !!previewForRail &&
    hasMaterialPlan &&
    !hasBomIssues &&
    (line.pre_submit_blockers || []).length === 0;
  React.useEffect(() => {
    const retained = (line.pre_submit_blockers || []).filter(
      (issue) => !issue.startsWith("Artwork:") && !issue.startsWith("Packing:"),
    );
    const next = [...retained, ...artworkBlockers, ...packingBlockers];
    if (!sameStringList(line.pre_submit_blockers || [], next))
      onPatch({ pre_submit_blockers: next });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artworkBlockers.join("|"), packingBlockers.join("|")]);
  React.useEffect(() => {
    if (line.artwork_mode !== "OVERLAY_DEFAULT") return;
    const artworkId = selectedOverlay?.default_artwork;
    if (!artworkId) return;
    const artwork = artworks.find((item) => item.id === artworkId);
    if (!artwork) return;
    if (line.artwork_assignment?.artwork_id === artwork.id) return;
    onPatch({
      artwork_assignment: artworkToAssignment(artwork, activeInkFamily),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    line.artwork_mode,
    selectedOverlay?.default_artwork,
    artworks.length,
    activeInkFamily,
  ]);
  React.useEffect(() => {
    const artworkId = line.artwork_assignment?.artwork_id;
    if (!artworkId) return;
    const artwork = artworks.find((item) => item.id === artworkId);
    if (!artwork) return;
    const next = artworkToAssignment(artwork, activeInkFamily);
    if (
      assignmentColorSignature(next) !==
      assignmentColorSignature(line.artwork_assignment)
    ) {
      onPatch({ artwork_assignment: next });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeInkFamily, artworks.length, line.artwork_assignment?.artwork_id]);

  return (
    <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_440px]">
      {/* ───────────────── LEFT: section cards ───────────────── */}
      <div className="space-y-3">
        <div className="rounded-[18px] border border-warning-border bg-gradient-to-r from-warning-bg via-surface-1 to-info-bg px-4 py-3 shadow-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-warning-fg text-sm font-black text-white">
              {(lineIndex ?? 0) + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-black uppercase text-warning-fg">
                Line label used across sales, planner, WCM, packing and dispatch
              </div>
              <div className="mt-0.5 truncate font-mono text-[12px] font-black text-content-1">
                {liveLineLabel || "Enter quantity, price and Product Master to build label"}
              </div>
            </div>
            {master ? (
              <span className="rounded-full bg-success-bg px-2.5 py-1 text-[10px] font-black text-success-fg ring-1 ring-success-border">
                order-ready master
              </span>
            ) : null}
          </div>
        </div>

        <SectionCard
          icon={<Hash className="h-3.5 w-3.5" />}
          tone="amber"
          title="1. Qty + price"
          hint="start here · rate required to place"
        >
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <SoField label="Qty">
              <input
                type="number"
                aria-label="Quantity"
                value={line.qty_value || ""}
                onChange={(e) => onPatch({ qty_value: Number(e.target.value) })}
                className={cn(INP, MONO)}
              />
            </SoField>
            <SoField label="UOM">
              <SoSelect
                aria-label="UOM"
                value={line.qty_uom}
                onChange={(v) => onPatch({ qty_uom: v as any })}
              >
                <option value="KG">KG</option>
                <option value="PCS">PCS</option>
              </SoSelect>
            </SoField>
            <SoField label={`Rate / ${line.price_basis}`}>
              <input
                value={line.unit_price}
                aria-label="Unit price"
                onChange={(e) => onPatch({ unit_price: e.target.value })}
                placeholder="₹"
                className={cn(INP, MONO)}
              />
            </SoField>
            <SoField label="Basis">
              <SoSelect
                aria-label="Price basis"
                value={line.price_basis}
                onChange={(v) => onPatch({ price_basis: v as any })}
              >
                <option value="KG">KG</option>
                <option value="PCS">PCS</option>
              </SoSelect>
            </SoField>
            <SoField label="Subtotal">
              <SoReadout
                className={cn(
                  MONO,
                  "border-success-border bg-success-bg text-success-fg",
                )}
              >
                {subtotal > 0
                  ? `₹${Math.round(subtotal).toLocaleString("en-IN")}`
                  : "—"}
              </SoReadout>
            </SoField>
          </div>
        </SectionCard>

        {/* Overlay match banner (when customer has an overlay for this master) */}
        {selectedOverlay ? (
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-success-border bg-success-bg px-4 py-2.5 text-[11px] shadow-sm">
            <span className="rounded-full bg-success-fg px-2 py-0.5 text-[10px] font-bold text-white">
              overlay applied
            </span>
            <span className="font-mono font-bold text-success-fg">
              {selectedOverlay.customer_item_code ||
                selectedOverlay.customer_display_name ||
                "—"}
            </span>
            {selectedOverlay.default_price_basis ? (
              <span className="rounded-full bg-surface-1 px-2 py-0.5 font-bold text-success-fg ring-1 ring-success-border">
                basis · {selectedOverlay.default_price_basis}
              </span>
            ) : null}
            {selectedOverlay.size_variant_code ? (
              <span className="rounded-full bg-surface-1 px-2 py-0.5 font-bold text-success-fg ring-1 ring-success-border">
                size · {selectedOverlay.size_variant_code}
              </span>
            ) : null}
            {selectedOverlay.default_artwork_design_code ? (
              <span className="rounded-full bg-surface-1 px-2 py-0.5 font-bold text-success-fg ring-1 ring-success-border">
                art · {selectedOverlay.default_artwork_design_code}
              </span>
            ) : null}
            <button
              onClick={() => onPatch({ customer_product_overlay: undefined })}
              className="ml-auto rounded-md px-1.5 py-0.5 text-[10px] font-bold text-success-fg hover:bg-success-bg"
            >
              Clear
            </button>
          </div>
        ) : availableOverlays.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-order-border bg-order-bg px-4 py-2.5 text-[11px] shadow-sm">
            <span className="rounded-full bg-order-fg px-2 py-0.5 text-[10px] font-bold text-white">
              customer overlay available
            </span>
            <span className="text-order-fg">
              {availableOverlays[0].customer_item_code ||
                availableOverlays[0].customer_display_name ||
                "Customer defaults"}
            </span>
            <button
              onClick={() => applyOverlay(availableOverlays[0], onPatch)}
              className="ml-auto rounded-md bg-order-fg px-2 py-1 text-[10px] font-bold text-white hover:bg-order-fg"
            >
              Apply overlay
            </button>
          </div>
        ) : null}

        {/* 2. Product master */}
        <SectionCard
          icon={<Package className="h-3.5 w-3.5" />}
          tone="indigo"
          title="2. Current Product Master"
          badge={
            master ? (
              <span className="inline-flex h-6 items-center rounded-full bg-surface-2 px-2 font-mono text-[10px] font-bold text-content-3">
                {master.code}
              </span>
            ) : (
              <span className="text-[10px] font-black uppercase tracking-wider text-danger-fg">
                required
              </span>
            )
          }
        >
          <MasterPicker
            masters={masters}
            value={line.product_master}
            onChange={(id) =>
              onPatch({
                product_master: id,
                size_code: "",
                layer_values: {},
                axis_values: {},
                addons: [],
                artwork_assignment: undefined,
                customer_product_overlay: undefined,
              })
            }
          />
          {master ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] font-bold text-content-3">
              <span>
                {master.layer_template.length} layers ·{" "}
                {(master.variant_axes || []).length} axes
              </span>
              {master.template_name ? (
                <span className="rounded-full bg-surface-2 px-2 py-0.5 text-content-3">
                  route · {master.template_name}
                </span>
              ) : null}
              {master.fixed_attributes?.print_capable ? (
                <span className="rounded-full bg-order-bg px-2 py-0.5 text-order-fg ring-1 ring-order-border">
                  print-capable
                </span>
              ) : null}
            </div>
          ) : null}
        </SectionCard>

        {master ? (
          <>
            {/* 3. Size axis */}
            {sizes.length > 0 || sizeAxis ? (
              <SectionCard
                icon={<Ruler className="h-3.5 w-3.5" />}
                tone="violet"
                title="Size axis"
                hint={
                  sizeAxisAllowsAdHoc
                    ? "master allowed · saved or new"
                    : "master-allowed sizes"
                }
              >
                <SizeAxis
                  sizes={sizes}
                  value={line.size_code}
                  line={line}
                  allowAdHoc={sizeAxisAllowsAdHoc}
                  onChange={(c) =>
                    onPatch({
                      size_code: c,
                      axis_values: clearAdHocSize(line.axis_values),
                    })
                  }
                  onPatch={onPatch}
                />
                <div className="mt-2 rounded-xl bg-order-bg px-3 py-2 text-[11px] font-semibold leading-5 text-order-fg ring-1 ring-order-border">
                  The real axes are <b>Size</b>, the <b>per-layer</b> stack and{" "}
                  <b>add-ons</b> — generated from the template&rsquo;s layer
                  structure and constrained to the values this master allows.
                  Roll / web width is derived from size × pouch-style, not
                  picked here.
                </div>
              </SectionCard>
            ) : null}

            {/* 4. Per-layer axes */}
            {master.layer_template.length > 0 ? (
              <SectionCard
                icon={<Layers className="h-3.5 w-3.5" />}
                tone="emerald"
                title="Per-layer axes"
                hint={
                  selectableLayerCount > 0
                    ? `${selectableLayerCount} layer dropdown${selectableLayerCount === 1 ? "" : "s"} · PM approved`
                    : layerMaterialAxisEnabled
                      ? "layer axis on · single film per layer"
                      : "locked by master"
                }
              >
                <div className="overflow-hidden rounded-xl ring-1 ring-line">
                  <div
                    className={cn(
                      "grid grid-cols-[40px_1fr_104px_120px] gap-2 bg-surface-2 px-3 py-1.5",
                      LABEL,
                    )}
                  >
                    <div>L</div>
                    <div>Film variant</div>
                    <div className="text-right">Thick µ</div>
                    <div>Grade</div>
                  </div>
                  {master.layer_template.map((row, i) => {
                    const idx = i + 1;
                    const st = (line.layer_values[idx] || {}) as LayerRowState;
                    const selectedFilmCode =
                      st.film_variant_code || row.film_variant_code || "";
                    const allowedFilms = layerAllowedFilmCodes(
                      row,
                      selectedFilmCode,
                    );
                    const canPickFilm = allowedFilms.length > 1;
                    const grades = Array.isArray(row.grade_options)
                      ? row.grade_options
                      : [];
                    const toneBadge =
                      i === 0
                        ? "bg-surface-3"
                        : i === master.layer_template.length - 1
                          ? "bg-line"
                          : "bg-warning-fg";
                    return (
                      <div
                        key={i}
                        className="grid grid-cols-[40px_1fr_104px_120px] items-center gap-2 border-t border-line px-3 py-1.5 text-xs font-bold"
                      >
                        <span
                          className={cn(
                            "inline-flex h-6 items-center justify-center rounded-full px-2 text-[10px] font-extrabold text-white",
                            toneBadge,
                          )}
                        >
                          L{idx}
                        </span>
                        {canPickFilm ? (
                          <SoSelect
                            aria-label={`Layer film L${idx}`}
                            value={selectedFilmCode}
                            onChange={(value) =>
                              onPatch({
                                layer_values: {
                                  ...line.layer_values,
                                  [idx]: {
                                    ...(line.layer_values[idx] ||
                                      ({} as LayerRowState)),
                                    role: row.role,
                                    film_variant_code: value,
                                    thickness_micron:
                                      st.thickness_micron ??
                                      row.thickness_micron,
                                    grade: st.grade || row.default_grade,
                                  },
                                },
                              })
                            }
                            className="h-[32px] rounded-lg font-mono text-[11px]"
                          >
                            {allowedFilms.map((code) => (
                              <option key={code} value={code}>
                                {code}
                              </option>
                            ))}
                          </SoSelect>
                        ) : (
                          <span className="inline-flex w-fit items-center rounded-md bg-info-bg px-2 py-1 font-mono text-[11px] font-bold text-primary ring-1 ring-info-border">
                            {selectedFilmCode || "—"}
                          </span>
                        )}
                        <input
                          type="number"
                          aria-label={`Thickness L${idx}`}
                          value={
                            st.thickness_micron ?? row.thickness_micron ?? ""
                          }
                          onChange={(e) =>
                            onPatch({
                              layer_values: {
                                ...line.layer_values,
                                [idx]: {
                                  ...(line.layer_values[idx] ||
                                    ({} as LayerRowState)),
                                  thickness_micron: Number(e.target.value),
                                },
                              },
                            })
                          }
                          className={cn(INP, MONO, "h-[32px] text-right")}
                        />
                        {grades.length > 0 ? (
                          <SoSelect
                            aria-label={`Grade L${idx}`}
                            value={st.grade || row.default_grade || ""}
                            onChange={(v) =>
                              onPatch({
                                layer_values: {
                                  ...line.layer_values,
                                  [idx]: {
                                    ...(line.layer_values[idx] ||
                                      ({} as LayerRowState)),
                                    grade: v,
                                  },
                                },
                              })
                            }
                            className="h-[32px]"
                          >
                            {grades.map((gr) => (
                              <option key={gr} value={gr}>
                                {gr}
                              </option>
                            ))}
                          </SoSelect>
                        ) : (
                          <span className="text-center text-[11px] font-bold text-content-4">
                            n/a
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="mt-2 text-[11px] font-semibold leading-5 text-content-3">
                  Per-layer axes are <b>film variant · thickness · grade</b>.
                  A film dropdown appears only when that layer has more than
                  one PM-approved film; grade options stay visible for
                  extrudable/recipe layers only. Roll / web width is derived
                  from size × pouch-style, not picked per layer.
                </div>
              </SectionCard>
            ) : null}

            {/* 5. Production lane (lane-up) */}
            <SectionCard
              icon={<Split className="h-3.5 w-3.5" />}
              tone="blue"
              title="Production lane"
              badge={
                <span className="inline-flex h-6 items-center rounded-full bg-surface-2 px-2 text-[10px] font-bold text-content-3">
                  policy {webWidthPolicy?.code || "default"}
                </span>
              }
            >
              <div className="flex gap-2">
                {allowedLaneCounts.map((lane) => {
                  const parent = computeWebWidthPlan(
                    childTargetWidthMm,
                    lane,
                    webWidthPolicy,
                  ).planned_parent_width_mm;
                  const on = activeLaneCount === lane;
                  return (
                    <button
                      key={lane}
                      type="button"
                      onClick={() =>
                        onPatch({
                          preferred_lane_count: lane,
                          lane_count_source: "OPERATOR_CHOICE",
                        })
                      }
                      className={cn(
                        "flex-1 rounded-xl border p-2 text-center transition",
                        on
                          ? "border-order-border bg-gradient-to-b from-order-bg to-white ring-[3px] ring-order-border"
                          : "border-line bg-surface-1 hover:border-order-border",
                      )}
                    >
                      <div className="text-sm font-extrabold text-content-1">
                        {lane}-up
                      </div>
                      <div
                        className={cn(
                          "text-[10px]",
                          MONO,
                          on ? "text-order-fg" : "text-content-3",
                        )}
                      >
                        {parent ? `${Math.round(parent)} mm` : "—"}
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <SoField label="Child target">
                  <SoReadout className={MONO}>
                    {childTargetWidthMm
                      ? `${Math.round(childTargetWidthMm)} mm`
                      : "—"}
                  </SoReadout>
                </SoField>
                <SoField label="Planned parent">
                  <SoReadout className={MONO}>
                    {plannedParentWidthMm
                      ? `${Math.round(plannedParentWidthMm)} mm`
                      : "—"}
                  </SoReadout>
                </SoField>
                <SoField
                  label="Trim"
                  hint={trimOverride ? "override" : "master/policy"}
                >
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    aria-label="Lane trim mm"
                    value={line.lane_trim_mm_override ?? ""}
                    onChange={(e) =>
                      onPatch({ lane_trim_mm_override: e.target.value })
                    }
                    placeholder={`${fmtCompact(masterTrimMm)} mm`}
                    className={cn(INP, MONO)}
                  />
                </SoField>
                <SoField label="Std / rem">
                  <SoReadout className={cn(MONO, "text-[12px]")}>
                    {webWidthPlan.selected_standard_parent_width_mm
                      ? `${Math.round(webWidthPlan.selected_standard_parent_width_mm)} mm`
                      : webWidthPlan.remainder_mm
                        ? `${Math.round(webWidthPlan.remainder_mm)} ${webWidthPlan.remainder_disposition.toLowerCase()}`
                        : "calc"}
                  </SoReadout>
                </SoField>
              </div>
              {webWidthPlan.warnings.length ? (
                <div className="mt-2 rounded-lg border border-warning-border bg-warning-bg px-2 py-1.5 text-[11px] font-semibold text-warning-fg">
                  {webWidthPlan.warnings.join(" ")}
                </div>
              ) : null}
            </SectionCard>

            {/* 6. Artwork & print (print-capable masters only) */}
            {master.fixed_attributes?.print_capable ? (
              <SectionCard
                icon={<Palette className="h-3.5 w-3.5" />}
                tone="fuchsia"
                title="Artwork & print"
                hint="optional · cylinder + colorway"
              >
                <ArtworkSection
                  mode={line.artwork_mode}
                  onModeChange={(m) =>
                    onPatch({
                      artwork_mode: m,
                      artwork_assignment:
                        m === "DEFER" ? undefined : line.artwork_assignment,
                    })
                  }
                  printType={line.print_type}
                  onPrintTypeChange={(t) => onPatch({ print_type: t })}
                  filmType={line.film_type}
                  onFilmTypeChange={(t) => onPatch({ film_type: t })}
                  inkBaseFamily={activeInkFamily}
                  filterSummary={`Approved · ${line.print_type} · ${line.film_type}`}
                  options={artworkOptions}
                  assignment={
                    line.artwork_mode === "DEFER"
                      ? undefined
                      : line.artwork_assignment
                  }
                  overlayDefault={overlayDefault}
                  onSelectColorway={(cw) => {
                    const artwork = artworks.find((item) => item.id === cw.id);
                    if (artwork) {
                      onPatch({
                        artwork_assignment: artworkToAssignment(
                          artwork,
                          activeInkFamily,
                        ),
                        print_type:
                          artwork.print_type === "FLEXO" ? "FLEXO" : "ROTO",
                        film_type: artworkFilmType(artwork),
                        artwork_mode: "APPROVED",
                      });
                    }
                  }}
                  onPickArtwork={() => {
                    // Opens the master's Artworks tab in a new tab so the user can review the full
                    // approved-artwork grid without losing the in-progress order draft.
                    if (master?.id && typeof window !== "undefined") {
                      window.open(
                        `/master/products/${master.id}?tab=artworks`,
                        "_blank",
                        "noopener,noreferrer",
                      );
                    } else if (master?.id) {
                      router.push(`/master/products/${master.id}`);
                    }
                  }}
                  onReplaceColor={() => {
                    if (typeof window !== "undefined")
                      window.open(
                        "/master/inks",
                        "_blank",
                        "noopener,noreferrer",
                      );
                  }}
                  disabled={!master.fixed_attributes?.print_capable}
                />
                <div className="mt-3 rounded-xl border border-info-border bg-info-bg px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className={LABEL}>PM chemistry · read only</div>
                      <div className="mt-1 text-[11px] font-semibold leading-5 text-primary">
                        Ink GSM comes from linked artwork. Adhesive + solvent
                        comes from the selected Product Master and is condensed
                        into the line label.
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {masterChemistry.parts.length ? (
                        masterChemistry.parts.map((part) => (
                          <span
                            key={part.label}
                            className="rounded-full bg-surface-1 px-2 py-1 font-mono text-[10px] font-black text-primary ring-1 ring-info-border"
                          >
                            {part.label}
                          </span>
                        ))
                      ) : (
                        <span className="rounded-full bg-surface-1 px-2 py-1 text-[10px] font-bold text-content-3 ring-1 ring-line">
                          no PM chemistry
                        </span>
                      )}
                      {masterChemistry.label ? (
                        <span className="rounded-full bg-primary px-2 py-1 font-mono text-[10px] font-black text-white">
                          {masterChemistry.label}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
              </SectionCard>
            ) : null}

            {/* 7. Add-ons */}
            <SectionCard
              icon={<Plus className="h-3.5 w-3.5" />}
              tone="rose"
              title="Add-ons"
              hint={
                addonAxis
                  ? addonAxis.required
                    ? "required"
                    : "optional · usage preview live"
                  : "master axis not declared"
              }
            >
              {addonAxis ? (
                <AddonPicker
                  addons={allowedAddonMasters}
                  selected={line.addons}
                  selectedSize={selectedSize}
                  orderQty={line.qty_value}
                  orderUom={line.qty_uom}
                  onChange={(addons) => onPatch({ addons })}
                />
              ) : (
                <div className="rounded-xl border border-line bg-surface-2 px-3 py-3 text-xs font-semibold text-content-3">
                  No add-ons are declared on this Product Master, so no add-on
                  selector or BOM add-on row is shown.
                </div>
              )}
            </SectionCard>

            {/* 8. Packaging — inner-pouch selection + override + catalog (POD) + packing note */}
            <SectionCard
              icon={<Box className="h-3.5 w-3.5" />}
              tone="teal"
              title="Packaging"
              hint="inner pouch · override · packing note"
            >
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  {hasInnerPackagingAxis(master) ? (
                    <InnerPouchSelect
                      master={master}
                      line={line}
                      onPatch={onPatch}
                    />
                  ) : null}
                  <CatalogAxesGrid
                    master={master}
                    line={line}
                    onPatch={onPatch}
                  />
                </div>
                {isPouchOutput(master) && canUseInnerPacking ? (
                  <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
                    <SoField label="Pcs per inner pouch" hint="override">
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={line.inner_pouch_pcs_per_pack || ""}
                        onChange={(e) =>
                          onPatch({ inner_pouch_pcs_per_pack: e.target.value })
                        }
                        placeholder={
                          innerPackFallback
                            ? `${innerPackFallback}`
                            : "e.g. 100"
                        }
                        className={cn(INP, MONO)}
                      />
                    </SoField>
                    <div className="rounded-xl border border-warning-border bg-warning-bg px-3 py-2 text-[11px] leading-5 text-warning-fg">
                      <span className="font-black uppercase tracking-wider text-warning-fg">
                        BOM rule
                      </span>
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
                  <div className="rounded-xl border border-line bg-surface-2 px-3 py-2 text-[11px] font-semibold text-content-3">
                    Inner pouch packing is not declared on this Product Master,
                    so no inner-pouch axis or pcs/inner override is shown.
                  </div>
                ) : null}
                <SoField
                  label="Packing note"
                  hint="optional · printed on dispatch"
                >
                  <input
                    value={line.remarks}
                    onChange={(e) => onPatch({ remarks: e.target.value })}
                    placeholder="e.g. 24 pouches per inner · 12 inners per gunny"
                    className={INP}
                  />
                </SoField>
              </div>
            </SectionCard>

            <IssuePolicyCard
              line={line}
              onPatch={onPatch}
              livePreview={livePreview}
            />

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 pb-1">
              <Button
                variant="outline"
                size="sm"
                onClick={onCollapse}
                className="rounded-lg gap-1 border-line text-[11px] font-bold"
              >
                Cancel line
              </Button>
              {onAdd ? (
                <Button
                  size="sm"
                  disabled={addDisabled}
                  onClick={onAdd}
                  className="rounded-lg gap-1 bg-success-fg text-[12px] font-bold text-white shadow-sm hover:bg-success-fg"
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
          {
            label: "Product + axes resolved",
            ok: !!master && axisBuild.missingRequired.length === 0,
          },
          { label: "Size + geometry", ok: !!line.size_code },
          {
            label: "Material plan",
            ok: hasMaterialPlan,
            hint: hasMaterialPlan
              ? `${materialEvidenceCount} sources`
              : "waiting for BOM",
          },
          {
            label: "Artwork / ink GSM",
            ok: artworkReady,
            hint: master?.fixed_attributes?.print_capable
              ? line.artwork_mode === "DEFER"
                ? "deferred"
                : activeInkFamily
              : undefined,
          },
          {
            label: "Packing override",
            ok: packingReady,
            hint: isPouchOutput(master)
              ? line.inner_pouch_pcs_per_pack
                ? `${line.inner_pouch_pcs_per_pack} pcs/inner`
                : innerPackFallback
                  ? `${innerPackFallback} pcs default`
                  : "catalog/default"
              : undefined,
          },
          {
            label: "BOM resolved",
            ok: bomReady,
            hint: hasBomIssues ? "resolver issue" : undefined,
          },
        ]}
        printCapable={!!master?.fixed_attributes?.print_capable}
        artworkDeferred={line.artwork_mode === "DEFER"}
        selectedAddons={selectedAddonRows}
        selectedSize={selectedSize}
      />
    </div>
  );
}

// ─── Field wrappers ─────────────────────────────────────────────

function SectionCard({
  icon,
  tone,
  title,
  hint,
  badge,
  children,
}: {
  icon: React.ReactNode;
  tone:
    | "indigo"
    | "violet"
    | "emerald"
    | "blue"
    | "fuchsia"
    | "rose"
    | "teal"
    | "slate"
    | "amber";
  title: string;
  hint?: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  const toneBg: Record<string, string> = {
    indigo: "bg-order-fg",
    violet: "bg-order-fg",
    emerald: "bg-success-fg",
    blue: "bg-primary",
    fuchsia: "bg-order-fg",
    rose: "bg-danger-solid",
    teal: "bg-success-fg",
    slate: "bg-line",
    amber: "bg-warning-fg",
  };
  return (
    <div className="rounded-[18px] border border-line bg-surface-1 p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <span
          className={cn(
            "grid h-[30px] w-[30px] place-items-center rounded-[10px] text-white",
            toneBg[tone] || "bg-line",
          )}
        >
          {icon}
        </span>
        <span className="font-display text-sm font-black text-content-1">
          {title}
        </span>
        {badge ? (
          <span className="ml-auto">{badge}</span>
        ) : hint ? (
          <span className="ml-auto text-[10px] font-bold text-content-4">
            {hint}
          </span>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label className="text-[10px] font-bold text-content-3">{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function IssuePolicyCard({
  line,
  onPatch,
  livePreview,
}: {
  line: SalesOrderLine;
  onPatch: (patch: Partial<SalesOrderLine>) => void;
  livePreview?: any;
}) {
  const policyRows = issuePolicyRowsFromPreview(livePreview);
  const overrides = line.issue_policy_overrides || [];
  const overridesByKey = new Map(
    overrides
      .filter((row) => row?.policy_key)
      .map((row) => [String(row.policy_key), row]),
  );
  const visibleRows = policyRows.length
    ? mergePolicyRowsWithOverrides(policyRows, overrides)
    : overrides.map(policyRowFromOverride);
  const upsertOverride = (policyKey: string, patch: Record<string, any>) => {
    if (!policyKey) return;
    if (patch.issue_policy_mode === "TEMPLATE_DEFAULT") {
      onPatch({
        issue_policy_overrides: overrides.filter(
          (item) => String(item.policy_key || "") !== policyKey,
        ),
      });
      return;
    }
    const existing = overridesByKey.get(policyKey) || {};
    const next = {
      policy_key: policyKey,
      issue_policy_mode:
        existing.issue_policy_mode || patch.issue_policy_mode || "PERCENT_OVER_THEORY",
      issue_policy_value:
        existing.issue_policy_value ?? patch.issue_policy_value ?? "",
      reason: existing.reason || "",
      ...patch,
    };
    const replaced = overrides.some(
      (item) => String(item.policy_key || "") === policyKey,
    );
    onPatch({
      issue_policy_overrides: replaced
        ? overrides.map((item) =>
            String(item.policy_key || "") === policyKey ? next : item,
          )
        : [...overrides, next],
    });
  };
  const resetOverride = (policyKey: string) => {
    onPatch({
      issue_policy_overrides: overrides.filter(
        (item) => String(item.policy_key || "") !== policyKey,
      ),
    });
  };
  return (
    <SectionCard
      icon={<AlertTriangle className="h-3.5 w-3.5" />}
      tone="amber"
      title="9. Wastage / issue policy"
      hint="material row override"
    >
      <div className="rounded-xl border border-warning-border bg-warning-bg px-3 py-2 text-[11px] font-semibold leading-5 text-warning-fg">
        Template rows set the normal over-issue. Override only the material row
        that needs extra issue for this order; planner/WCM will see theory,
        planned issue and override source.
      </div>
      {visibleRows.length ? (
        <div className="mt-3 space-y-2">
          {visibleRows.slice(0, 8).map((policyRow) => {
            const override = overridesByKey.get(policyRow.policyKey);
            const overrideActive = Boolean(override);
            const mode = overrideActive
              ? String(override?.issue_policy_mode || "PERCENT_OVER_THEORY")
              : "TEMPLATE_DEFAULT";
            return (
              <div
                key={policyRow.policyKey}
                className={cn(
                  "rounded-xl border bg-surface-1 p-3",
                  overrideActive
                    ? "border-warning-border ring-1 ring-warning-border"
                    : "border-line",
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="rounded-full bg-warning-bg px-2 py-0.5 text-[10px] font-black uppercase text-warning-fg ring-1 ring-warning-border">
                        {policyRow.category || "material"}
                      </span>
                      <span className="font-mono text-[11px] font-black text-content-1">
                        {policyRow.materialCode || policyRow.policyKey}
                      </span>
                      {policyRow.stepName ? (
                        <span className="text-[10px] font-bold text-content-3">
                          {policyRow.stepName}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 truncate text-xs font-semibold text-content-2">
                      {policyRow.materialName || policyRow.policyKey}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => resetOverride(policyRow.policyKey)}
                    disabled={!overrideActive}
                    className={cn(
                      "rounded-lg px-2 py-1 text-[10px] font-black uppercase ring-1",
                      overrideActive
                        ? "bg-surface-1 text-warning-fg ring-warning-border hover:bg-warning-bg"
                        : "cursor-not-allowed bg-surface-2 text-content-4 ring-line",
                    )}
                  >
                    template default
                  </button>
                </div>
                <div className="mt-3 grid gap-2 lg:grid-cols-[1fr_1fr_150px_110px]">
                  <PolicyReadout
                    label="Theory"
                    value={policyQtyLabel(policyRow.theoreticalQty, policyRow.uom)}
                  />
                  <PolicyReadout
                    label="Planned issue"
                    value={policyQtyLabel(policyRow.plannedIssueQty, policyRow.uom)}
                    tone={
                      policyRow.policySource === "order_override"
                        ? "warning"
                        : "default"
                    }
                  />
                  <SoField label="Mode">
                    <SoSelect
                      value={mode}
                      onChange={(value) =>
                        upsertOverride(policyRow.policyKey, {
                          issue_policy_mode: value,
                        })
                      }
                      className="h-9"
                    >
                      <option value="TEMPLATE_DEFAULT">
                        template default · {policyModeLabel(policyRow.templateMode)}
                      </option>
                      <option value="PERCENT_OVER_THEORY">% over theory</option>
                      <option value="FIXED_EXTRA_KG">fixed extra KG</option>
                      <option value="MINIMUM_ISSUE_KG">minimum issue KG</option>
                      <option value="NONE">no over-issue</option>
                    </SoSelect>
                  </SoField>
                  <SoField label="Value">
                    <input
                      value={override?.issue_policy_value ?? ""}
                      disabled={!overrideActive || mode === "NONE"}
                      onChange={(event) =>
                        upsertOverride(policyRow.policyKey, {
                          issue_policy_value: event.target.value,
                        })
                      }
                      placeholder={String(policyRow.templateValue || "")}
                      className={cn(
                        INP,
                        MONO,
                        "h-9",
                        (!overrideActive || mode === "NONE") &&
                          "bg-surface-2 text-content-4",
                      )}
                    />
                  </SoField>
                </div>
                {overrideActive ? (
                  <div className="mt-2">
                    <input
                      value={override?.reason || ""}
                      onChange={(event) =>
                        upsertOverride(policyRow.policyKey, {
                          reason: event.target.value,
                        })
                      }
                      placeholder="Reason for this order only"
                      className={cn(INP, "h-9 text-xs")}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mt-3 rounded-xl border border-line bg-surface-2 px-3 py-3 text-xs font-semibold text-content-3">
          Material plan will appear after Product Master, size, layer values and
          BOM preview are resolved. Wastage override stays hidden until there is
          a real material row to override.
        </div>
      )}
    </SectionCard>
  );
}

function PolicyReadout({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "warning";
}) {
  return (
    <div
      className={cn(
        "rounded-lg px-2 py-1.5 ring-1",
        tone === "warning"
          ? "bg-warning-bg text-warning-fg ring-warning-border"
          : "bg-surface-2 text-content-2 ring-line",
      )}
    >
      <div className="text-[9px] font-black uppercase tracking-wider text-content-3">
        {label}
      </div>
      <div className="font-mono text-[11px] font-black">{value}</div>
    </div>
  );
}

type IssuePolicyEvidenceRow = {
  policyKey: string;
  category: string;
  materialCode: string;
  materialName: string;
  uom: string;
  stepName: string;
  theoreticalQty: number;
  plannedIssueQty: number;
  templateMode: string;
  templateValue: number | string;
  policySource: string;
};

function issuePolicyRowsFromPreview(preview: any): IssuePolicyEvidenceRow[] {
  const candidates = [
    ...previewArray(preview?.material_plan_lines),
    ...previewArray(preview?.bom?.material_plan_lines),
    ...previewArray(preview?.bom_snapshot?.material_plan_lines),
  ];
  const byKey = new Map<string, IssuePolicyEvidenceRow>();
  candidates.forEach((row: any) => {
    const policyKey = String(row?.policy_key || "").trim();
    if (!policyKey || byKey.has(policyKey)) return;
    byKey.set(policyKey, {
      policyKey,
      category: String(
        row?.category_code || row?.category || row?.material_category || "",
      ).toUpperCase(),
      materialCode: String(row?.material_code || row?.code || "").trim(),
      materialName: String(row?.material_name || row?.name || "").trim(),
      uom: String(row?.uom || row?.stock_uom || "KG").toUpperCase(),
      stepName: String(row?.step_name || row?.step || "").trim(),
      theoreticalQty: Number(row?.theoretical_qty || 0),
      plannedIssueQty: Number(
        row?.planned_issue_qty ?? row?.quantity ?? row?.qty ?? 0,
      ),
      templateMode: String(row?.template_issue_policy_mode || "NONE"),
      templateValue: row?.template_issue_policy_value ?? "",
      policySource: String(row?.policy_source || ""),
    });
  });
  return Array.from(byKey.values());
}

function mergePolicyRowsWithOverrides(
  rows: IssuePolicyEvidenceRow[],
  overrides: Array<Record<string, any>>,
) {
  const byKey = new Map(rows.map((row) => [row.policyKey, row]));
  overrides.forEach((override) => {
    const key = String(override?.policy_key || "").trim();
    if (key && !byKey.has(key)) byKey.set(key, policyRowFromOverride(override));
  });
  return Array.from(byKey.values());
}

function policyRowFromOverride(row: Record<string, any>): IssuePolicyEvidenceRow {
  const policyKey = String(row?.policy_key || "").trim();
  const [category = "", material = ""] = policyKey.split(":");
  return {
    policyKey,
    category,
    materialCode: material,
    materialName: material,
    uom: "KG",
    stepName: "",
    theoreticalQty: 0,
    plannedIssueQty: 0,
    templateMode: "NONE",
    templateValue: "",
    policySource: "order_override",
  };
}

function policyQtyLabel(value: unknown, uom: string) {
  const qty = Number(value);
  if (!Number.isFinite(qty) || qty <= 0) return "—";
  return `${fmtCompact(qty, 3)} ${uom || ""}`.trim();
}

function policyModeLabel(mode: unknown) {
  const key = String(mode || "NONE").toUpperCase();
  if (key === "PERCENT_OVER_THEORY") return "% over theory";
  if (key === "FIXED_EXTRA_KG") return "fixed extra KG";
  if (key === "MINIMUM_ISSUE_KG") return "minimum issue KG";
  if (key === "NONE") return "no over-issue";
  return key.replaceAll("_", " ").toLowerCase();
}

// ─── Master picker ─────────────────────────────────────────────

function MasterPicker({
  masters,
  value,
  onChange,
}: {
  masters: ProductMaster[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [search, setSearch] = React.useState("");
  const selectableMasters = React.useMemo(
    () =>
      masters.filter(
        (m) => m.active !== false && m.is_current_version !== false,
      ),
    [masters],
  );
  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return selectableMasters.slice(0, 6);
    return selectableMasters
      .filter(
        (m) =>
          m.code.toLowerCase().includes(q) || m.name.toLowerCase().includes(q),
      )
      .slice(0, 12);
  }, [selectableMasters, search]);

  if (value) {
    const m = masters.find((x) => x.id === value);
    if (m && m.active !== false && m.is_current_version !== false) {
      return (
        <div className="flex items-center gap-3 rounded-xl border border-order-border bg-order-bg px-3.5 py-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-surface-1 text-order-fg ring-1 ring-order-border">
            <Package className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate font-display text-sm font-black text-content-1">
              {m.name}
            </div>
            <div className="truncate font-mono text-[11px] font-bold text-content-3">
              {m.code} · {m.layer_template.length} layers ·{" "}
              {(m.variant_axes || []).length} axes
            </div>
          </div>
          <button
            type="button"
            onClick={() => onChange("")}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-line bg-surface-1 px-2.5 py-1.5 text-[11px] font-bold text-content-3 hover:border-order-border hover:text-order-fg"
          >
            <X className="h-3 w-3" /> Change
          </button>
        </div>
      );
    }
    return (
      <div className="flex items-center gap-3 rounded-xl border border-warning-border bg-warning-bg px-3.5 py-2.5">
        <AlertTriangle className="h-4 w-4 shrink-0 text-warning-fg" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-black text-warning-fg">
            Product Master is no longer selectable
          </div>
          <div className="text-[11px] font-semibold text-warning-fg">
            This line points to a master that is unavailable for order placement.
            Pick an order-ready Product Master before placing the order.
          </div>
        </div>
        <button
          type="button"
          onClick={() => onChange("")}
          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-warning-border bg-surface-1 px-2.5 py-1.5 text-[11px] font-bold text-warning-fg hover:border-warning-border"
        >
          <X className="h-3 w-3" /> Pick order-ready
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-content-4" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search product master code or name…"
          className={cn(INP, "pl-9")}
          autoFocus
        />
      </div>
      <div className="overflow-hidden rounded-xl ring-1 ring-line">
        <div className="flex items-center justify-between bg-surface-2 px-3 py-1.5">
          <span className={LABEL}>Catalog masters</span>
          <span className="text-[10px] font-bold text-content-4">
            {filtered.length}
            {search ? " match" : " active shown · type to search"}
          </span>
        </div>
        {filtered.map((m) => {
          const kind = String(m.product_kind || "POUCH").toUpperCase();
          return (
            <button
              key={m.id}
              type="button"
              data-testid={`sales-master-option-${m.code}`}
              onClick={() => onChange(m.id)}
              className="group flex w-full items-center gap-3 border-t border-line px-3 py-2.5 text-left transition hover:bg-order-bg"
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-order-fg to-order-fg text-white shadow-sm">
                <Package className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-extrabold text-content-1">
                  {m.name}
                </span>
                <span className="block truncate font-mono text-[10px] font-bold text-content-3">
                  {m.code}
                </span>
              </span>
              <span className="hidden shrink-0 items-center gap-1 sm:flex">
                <span className="rounded-md bg-info-bg px-1.5 py-0.5 text-[9px] font-extrabold text-primary ring-1 ring-info-border">
                  {kind}
                </span>
                <span className="rounded-md bg-success-bg px-1.5 py-0.5 text-[9px] font-extrabold text-success-fg ring-1 ring-success-border">
                  {m.layer_template.length}L
                </span>
                <span className="rounded-md bg-order-bg px-1.5 py-0.5 text-[9px] font-extrabold text-order-fg ring-1 ring-order-border">
                  {(m.variant_axes || []).length} axes
                </span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-content-4 transition group-hover:text-order-fg" />
            </button>
          );
        })}
        {filtered.length === 0 ? (
          <div className="border-t border-line px-3 py-5 text-center text-xs font-semibold text-content-3">
            No masters match &ldquo;{search}&rdquo;.
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ─── Size axis as a clean Select ──────────────────────────────────

function SizeAxis({
  sizes,
  value,
  onChange,
  line,
  allowAdHoc,
  onPatch,
}: {
  sizes: any[];
  value: string;
  onChange: (code: string) => void;
  line: SalesOrderLine;
  allowAdHoc: boolean;
  onPatch: (patch: Partial<SalesOrderLine>) => void;
}) {
  const adHoc = adHocSizeFromLine(line);
  const adHocActive = Boolean(adHoc && value === adHoc.code);
  const savedSizes = sizes.slice(0, 5);
  return (
    <div className="space-y-3">
      <SoField label="Size" hint="geometry · PM axis">
        <SoSelect
          aria-label="Size"
          value={adHocActive ? "__adhoc__" : value}
          onChange={(next) => {
            if (next === "__adhoc__") {
              const patch = buildAdHocSizePatch(
                line,
                adHoc || defaultAdHocSize(sizes[0]),
              );
              onPatch(patch);
              return;
            }
            onChange(next);
          }}
        >
          {!value ? <option value="">Pick a size</option> : null}
          {sizes.map((s: any) => (
            <option key={s.id || s.code} value={s.code}>
              {s.code} · {s.width_mm}×{s.height_mm || 0}
              {s.gusset_mm ? `+${s.gusset_mm}G` : ""}
            </option>
          ))}
          {allowAdHoc ? (
            <option value="__adhoc__">+ New size under this Product Master</option>
          ) : null}
        </SoSelect>
        <div className="mt-1 text-[10px] font-semibold text-content-3">
          {sizes.length} saved size{sizes.length === 1 ? "" : "s"}
          {allowAdHoc ? " · ad-hoc allowed by PM" : " · ad-hoc blocked by PM"}
        </div>
      </SoField>

      {allowAdHoc && !adHocActive ? (
        <button
          type="button"
          onClick={() =>
            onPatch(
              buildAdHocSizePatch(line, adHoc || defaultAdHocSize(sizes[0])),
            )
          }
          className="flex w-full items-center justify-between gap-3 rounded-xl border border-info-border bg-info-bg px-3 py-2 text-left text-[11px] font-bold text-primary transition hover:bg-info-bg/80"
        >
          <span>
            Ad-hoc pouch size is allowed on this Product Master. Open width,
            height, gusset, stock form and pouch-style fields.
          </span>
          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-surface-1 text-primary ring-1 ring-info-border">
            <Plus className="h-3.5 w-3.5" />
          </span>
        </button>
      ) : null}

      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
          {savedSizes.map((s: any) => {
            const active = value === s.code && !adHocActive;
            return (
              <button
                key={s.id || s.code}
                type="button"
                onClick={() => onChange(s.code)}
                className={cn(
                  "min-h-[58px] rounded-xl border px-3 py-2 text-left transition",
                  active
                    ? "border-order-border bg-info-bg ring-2 ring-info-border"
                    : "border-line bg-surface-1 hover:border-order-border hover:bg-info-bg",
                )}
              >
                <div className="font-mono text-[12px] font-black text-content-1">
                  {compactSizeCode(s)}
                </div>
                <div className="mt-0.5 text-[10px] font-bold text-content-3">
                  {s.stock_form || "open web"}
                </div>
              </button>
            );
          })}
          <button
            type="button"
            disabled={!allowAdHoc}
            onClick={() =>
              allowAdHoc
                ? onPatch(
                    buildAdHocSizePatch(
                      line,
                      adHoc || defaultAdHocSize(sizes[0]),
                    ),
                  )
                : undefined
            }
            className={cn(
              "min-h-[58px] rounded-xl border px-3 py-2 text-left transition",
              allowAdHoc && adHocActive
                ? "border-info-border bg-info-bg ring-2 ring-info-border"
                : allowAdHoc
                  ? "border-dashed border-info-border bg-info-bg/60 text-primary hover:bg-info-bg"
                  : "cursor-not-allowed border-dashed border-line bg-surface-2 text-content-4",
            )}
          >
            <div className="font-mono text-[12px] font-black">
              {allowAdHoc ? "+ New size" : "Ad-hoc blocked"}
            </div>
            <div className="mt-0.5 text-[10px] font-bold">
              {allowAdHoc ? "bounded by PM axis" : "enable in Product Master"}
            </div>
          </button>
        </div>

      {allowAdHoc && adHocActive ? (
        <div className="rounded-xl border border-info-border bg-info-bg p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className={LABEL}>Ad-hoc pouch size</div>
              <div className="text-[11px] font-semibold text-primary">
                New size is allowed only inside this Product Master; preview and submit carry the geometry.
              </div>
            </div>
            <span className="rounded-full bg-surface-1 px-2 py-1 font-mono text-[10px] font-black text-primary ring-1 ring-info-border">
              {adHoc?.code || value}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
            <AdHocNumberField
              label="Width"
              value={adHoc?.width_mm}
              onChange={(width_mm) => onPatch(buildAdHocSizePatch(line, { width_mm }))}
            />
            <AdHocNumberField
              label="Height"
              value={adHoc?.height_mm}
              onChange={(height_mm) => onPatch(buildAdHocSizePatch(line, { height_mm }))}
            />
            <AdHocNumberField
              label="Gusset"
              value={adHoc?.gusset_mm}
              onChange={(gusset_mm) => onPatch(buildAdHocSizePatch(line, { gusset_mm }))}
            />
            <SoField label="Stock form">
              <SoSelect
                value={String(adHoc?.stock_form || "OPEN_WEB")}
                onChange={(stock_form) => onPatch(buildAdHocSizePatch(line, { stock_form }))}
                className="h-9"
              >
                <option value="OPEN_WEB">Open web</option>
                <option value="LAYFLAT_TUBE">Layflat tube</option>
                <option value="FOLDED_WEB">Folded web</option>
              </SoSelect>
            </SoField>
            <SoField label="Pouch style">
              <SoSelect
                value={String(adHoc?.pouch_style || "STANDUP")}
                onChange={(pouch_style) => onPatch(buildAdHocSizePatch(line, { pouch_style }))}
                className="h-9"
              >
                <option value="STANDUP">Standup pouch</option>
                <option value="CENTER_SEAL">Center seal</option>
                <option value="THREE_SIDE_SEAL">3-side seal</option>
                <option value="ROLL">Roll</option>
              </SoSelect>
            </SoField>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AdHocNumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: unknown;
  onChange: (value: number) => void;
}) {
  return (
    <SoField label={label}>
      <input
        type="number"
        min={0}
        step={0.1}
        value={
          typeof value === "number" || typeof value === "string" ? value : ""
        }
        onChange={(event) => onChange(Number(event.target.value) || 0)}
        className={cn(INP, MONO, "h-9")}
      />
    </SoField>
  );
}

function compactSizeCode(size: any) {
  const width = fmtCompact(size?.width_mm, 3);
  const height = Number(size?.height_mm || 0) > 0 ? fmtCompact(size.height_mm, 3) : "";
  const gusset = Number(size?.gusset_mm || 0) > 0 ? `+${fmtCompact(size.gusset_mm, 3)}G` : "";
  if (width && height) return `${width}x${height}${gusset}`;
  if (width && width !== "0") return `${width} mm`;
  return String(size?.code || "");
}

function defaultAdHocSize(firstSize?: any) {
  return {
    width_mm: Number(firstSize?.width_mm || 0) || 0,
    height_mm: Number(firstSize?.height_mm || 0) || 0,
    gusset_mm: Number(firstSize?.gusset_mm || 0) || 0,
    stock_form: firstSize?.stock_form || "OPEN_WEB",
    width_basis: firstSize?.width_basis || "OPEN_WEB_WIDTH",
    pouch_style: firstSize?.pouch_style || "STANDUP",
    roll_width_mm: Number(firstSize?.roll_width_mm || 0) || 0,
    child_target_width_mm: Number(firstSize?.child_target_width_mm || firstSize?.roll_width_mm || 0) || 0,
  };
}

function buildAdHocSizePatch(
  line: SalesOrderLine,
  patch: Record<string, any>,
): Partial<SalesOrderLine> {
  const current: Record<string, any> =
    adHocSizeFromLine(line) || defaultAdHocSize();
  const next: Record<string, any> = {
    ...current,
    ...patch,
    ad_hoc: true,
    is_ad_hoc: true,
  };
  const code = adHocSizeCode(next);
  next.code = code;
  next.size_code = code;
  next.label = code;
  return {
    size_code: code,
    axis_values: {
      ...sanitizeAxisValues(line.axis_values),
      size: next,
    },
  };
}

function adHocSizeCode(size: Record<string, any>) {
  const width = fmtCompact(size.width_mm, 3);
  const height = fmtCompact(size.height_mm, 3);
  const gusset = Number(size.gusset_mm || 0) > 0 ? `+${fmtCompact(size.gusset_mm, 3)}G` : "";
  if (width !== "0" && height !== "0") return `ADHOC-${width}X${height}${gusset}`;
  if (width !== "0") return `ADHOC-${width}`;
  return "ADHOC-SIZE";
}

function adHocSizeFromLine(line: SalesOrderLine): (ProductMasterSize & Record<string, any>) | null {
  const raw = (line.axis_values || {}).size;
  if (!isStructuredSizeValue(raw)) return null;
  const code = String(raw.size_code || raw.code || line.size_code || adHocSizeCode(raw)).trim();
  return {
    id: code,
    product_master: line.product_master,
    code,
    label: String(raw.label || code),
    active: true,
    width_mm: Number(raw.width_mm || 0),
    height_mm: Number(raw.height_mm || 0),
    gusset_mm: Number(raw.gusset_mm || 0),
    roll_width_mm: Number(raw.roll_width_mm || raw.child_target_width_mm || 0) || null,
    child_target_width_mm: Number(raw.child_target_width_mm || raw.roll_width_mm || 0) || null,
    stock_form: raw.stock_form || "OPEN_WEB",
    width_basis: raw.width_basis || "OPEN_WEB_WIDTH",
    pouch_style: raw.pouch_style || "STANDUP",
    pouch_style_master: raw.pouch_style_master || null,
    pouch_style_master_code: raw.pouch_style_master_code || null,
    pouch_style_roll_axis: raw.pouch_style_roll_axis || null,
    trim_loss_mm: raw.trim_loss_mm,
    flap_tape_mm: raw.flap_tape_mm,
    ad_hoc: true,
    is_ad_hoc: true,
  };
}

function clearAdHocSize(values: Record<string, any>) {
  const next = sanitizeAxisValues(values);
  if (isStructuredSizeValue(next.size)) delete next.size;
  return next;
}

function isStructuredSizeValue(value: unknown): value is Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return Boolean(
    row.ad_hoc ||
      row.is_ad_hoc ||
      row.width_mm ||
      row.height_mm ||
      row.gusset_mm ||
      row.roll_width_mm ||
      row.child_target_width_mm ||
      row.pouch_style ||
      row.stock_form,
  );
}

// ─── Catalog axes (POD / inner / outer) ───────────────────────────

function CatalogAxesGrid({
  master,
  line,
  onPatch,
}: {
  master: ProductMaster;
  line: SalesOrderLine;
  onPatch: (p: Partial<SalesOrderLine>) => void;
}) {
  // Inner-pouch packaging axis is rendered by the dedicated InnerPouchSelect.
  const catalogAxes = (master.variant_axes || []).filter(
    (a: VariantAxisDef) =>
      axisCatalogSource(a) &&
      String(a.axis) !== "addons" &&
      !(
        axisCatalogSource(a) === "packaging_material" &&
        packagingAxisRole(a, master) === "inner"
      ),
  );
  if (catalogAxes.length === 0) return null;
  return (
    <>
      {catalogAxes.map((axis, i) => (
        <CatalogAxisField
          key={`${String(axis.axis)}-${i}`}
          master={master}
          axis={axis}
          value={String(
            axisScalarValue(line.axis_values[String(axis.axis)]) ||
              axis.default_value ||
              "",
          )}
          onChange={(v) =>
            onPatch({
              axis_values: patchAxisValue(
                line.axis_values,
                String(axis.axis),
                v,
              ),
            })
          }
        />
      ))}
    </>
  );
}

// Inner-pouch selection binds only to a Product Master-declared inner packaging axis.
function InnerPouchSelect({
  master,
  line,
  onPatch,
}: {
  master: ProductMaster;
  line: SalesOrderLine;
  onPatch: (p: Partial<SalesOrderLine>) => void;
}) {
  const innerAxis = (master.variant_axes || []).find(
    (a: VariantAxisDef) =>
      axisCatalogSource(a) === "packaging_material" &&
      packagingAxisRole(a, master) === "inner",
  );
  const axisKey = innerAxis ? String(innerAxis.axis) : "";
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["sales-inner-pouch-options", master.id],
    queryFn: async () => {
      if (!innerAxis) return [];
      const list = await masterDataService.getPackaging();
      return dedupeByCode(
        list.filter(
          (p: PackagingMaterial) =>
            String(p.status || "").toUpperCase() === "ACTIVE" &&
            packagingKind(p) === "INNER_POUCH" &&
            packagingMaterialAllowedForSales(p, innerAxis, master),
        ),
      );
    },
    enabled: !!innerAxis,
    staleTime: 60_000,
  });
  if (!innerAxis) return null;
  const value = String(axisScalarValue(line.axis_values[axisKey]) || "");
  return (
    <SoField label="Inner pouch" hint="catalog · INNER_POUCH">
      <SoSelect
        aria-label="Inner pouch"
        value={value || "__none"}
        onChange={(v) =>
          onPatch({
            axis_values: patchAxisValue(
              line.axis_values,
              axisKey,
              v === "__none" ? "" : v,
            ),
          })
        }
      >
        <option value="__none">
          {isLoading ? "Loading…" : "— None (no inner carrier) —"}
        </option>
        {rows.map((p: PackagingMaterial) => (
          <option key={p.id} value={p.code}>
            {p.code} · {p.name}
          </option>
        ))}
      </SoSelect>
      {innerAxis?.required ? (
        <div className="mt-1 text-[10px] font-bold text-danger-fg">
          required
        </div>
      ) : null}
    </SoField>
  );
}

function CatalogAxisField({
  master,
  axis,
  value,
  onChange,
}: {
  master: ProductMaster;
  axis: VariantAxisDef;
  value: string;
  onChange: (v: string) => void;
}) {
  const source = axisCatalogSource(axis);
  const filter = axis.master_data_filter || {};
  const allowedKey = axisAllowedCodes(axis)
    ? Array.from(axisAllowedCodes(axis) || [])
        .sort()
        .join("|")
    : "all";
  const { data: options = [], isLoading } = useQuery({
    queryKey: [
      "catalog-axis-options",
      master.id,
      axis.axis,
      source,
      filter,
      allowedKey,
    ],
    queryFn: async () => {
      if (source === "pod_sku_variant") {
        const list = await masterDataService.getPodSkuVariants({
          active: true,
        });
        return dedupeByCode(
          filterRowsByAxisCodes(list, axis, (p: PodSkuVariant) => p.code).map(
            (p: PodSkuVariant) => ({
              id: p.id,
              code: p.code,
              label: p.name || p.pod_sku_name || p.code,
              sub: [
                p.pod_thickness_micron ? `${p.pod_thickness_micron}μ` : null,
                p.pod_fixed_height_mm ? `${p.pod_fixed_height_mm}mm` : null,
              ]
                .filter(Boolean)
                .join(" · "),
            }),
          ),
        );
      }
      if (source === "packaging_material") {
        const list = await masterDataService.getPackaging();
        let rows = list.filter((p: PackagingMaterial) => p.status === "ACTIVE");
        rows = rows.filter((p: PackagingMaterial) =>
          packagingMaterialAllowedForSales(p, axis, master),
        );
        rows = filterRowsByAxisCodes(
          rows,
          axis,
          (p: PackagingMaterial) => p.code,
        );
        return dedupeByCode(
          rows.map((p: PackagingMaterial) => ({
            id: p.id,
            code: p.code,
            label: p.name,
            sub: [p.packaging_kind, p.base_uom].filter(Boolean).join(" · "),
          })),
        );
      }
      if (source === "addon") {
        const list = await masterDataService.getAddons();
        return dedupeByCode(
          filterRowsByAxisCodes(list, axis, (a: Addon) => a.code).map(
            (a: Addon) => ({
              id: a.id,
              code: a.code,
              label: a.name || a.code,
              sub: "Add-on",
            }),
          ),
        );
      }
      return [];
    },
    staleTime: 60_000,
  });

  // Fallback: if the catalog returned nothing but the master DID list explicit
  // allowed codes on the axis, surface those raw codes so the dropdown is never
  // empty when the master clearly says "these are pickable".
  const allowedSet = axisAllowedCodes(axis);
  const effectiveOptions = React.useMemo(() => {
    if (options.length > 0) return options;
    if (!allowedSet) return [];
    return Array.from(allowedSet)
      .sort()
      .map((code) => ({
        id: code,
        code,
        label: code,
        sub: "from master · allowed list",
      }));
  }, [options, allowedSet]);

  const isPod = source === "pod_sku_variant";
  const isPackaging = source === "packaging_material";

  return (
    <SoField
      label={String(axis.label || String(axis.axis).replace(/_/g, " "))}
      hint={
        isPod
          ? "catalog · POD"
          : isPackaging
            ? "catalog · packaging"
            : "catalog ref"
      }
    >
      <SoSelect
        aria-label={String(axis.label || axis.axis)}
        value={value || "__none"}
        onChange={(v) => onChange(v === "__none" ? "" : v)}
      >
        <option value="__none">{isLoading ? "Loading…" : "— None —"}</option>
        {effectiveOptions.map((o) => (
          <option key={o.id} value={o.code}>
            {o.code} · {o.label}
            {o.sub ? ` · ${o.sub}` : ""}
          </option>
        ))}
      </SoSelect>
      {axis.required ? (
        <div className="mt-1 text-[10px] font-bold text-danger-fg">
          required
        </div>
      ) : null}
      {axis.auto_demand_in_house ? (
        <div className="mt-1 flex items-center gap-1 text-[10px] font-bold text-order-fg">
          <PackageCheck className="h-3 w-3" /> in-house produced · auto-demand
          if shortage
        </div>
      ) : null}
    </SoField>
  );
}

function AddonPicker({
  addons,
  selected,
  selectedSize,
  orderQty,
  orderUom,
  onChange,
}: {
  addons: Addon[];
  selected: string[];
  selectedSize?: ProductMasterSize;
  orderQty: number;
  orderUom: string;
  onChange: (codes: string[]) => void;
}) {
  if (!addons.length) {
    return (
      <div className="rounded-xl border border-dashed border-line bg-surface-2 px-3 py-3 text-center text-xs font-semibold text-content-3">
        No add-ons configured for this product.
      </div>
    );
  }
  const selectedRows = addons.filter((addon) => selected.includes(addon.code));
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {addons.map((a) => {
          const active = selected.includes(a.code);
          return (
            <button
              key={a.id}
              type="button"
              onClick={() =>
                onChange(
                  active
                    ? selected.filter((x) => x !== a.code)
                    : [...selected, a.code],
                )
              }
              className={cn(
                "rounded-full px-3 py-1.5 text-left text-[11px] font-bold ring-1 ring-inset",
                active
                  ? "bg-warning-fg text-white ring-warning-border shadow-sm"
                  : "bg-surface-1 text-content-2 ring-line hover:bg-warning-bg hover:text-warning-fg hover:ring-warning-border",
              )}
            >
              <span>{a.name || a.code}</span>
              <span
                className={cn(
                  "ml-1 font-mono text-[9px] uppercase",
                  active ? "text-warning-border" : "text-content-4",
                )}
              >
                {addonUsageKind(a)}
              </span>
            </button>
          );
        })}
      </div>
      {selectedRows.length ? (
        <div className="rounded-xl border border-warning-border bg-warning-bg px-3 py-2">
          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-warning-fg">
            Add-on usage preview
          </div>
          <div className="mt-1 space-y-1">
            {selectedRows.map((addon) => (
              <div
                key={`addon-preview-${addon.id}`}
                className="text-[11px] font-semibold text-warning-fg"
              >
                <span className="font-bold">{addon.name || addon.code}</span>
                <span className="text-warning-fg">
                  {" "}
                  · {addonUsagePreview(addon, selectedSize, orderQty, orderUom)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function addonUsageKind(addon: Addon) {
  const mode = String(addon.weight_mode || "").toUpperCase();
  const uom = String(
    addon.addon_purchase_uom || addon.base_uom || "",
  ).toUpperCase();
  if (mode === "PER_MM") return uom === "METER" ? "run length" : "per mm";
  if (mode === "PER_PIECE") return "count/pouch";
  if (mode === "FIXED") return "multiplier";
  return "usage";
}

function firstFiniteNumber(...values: unknown[]) {
  for (const value of values) {
    const next = Number(value);
    if (Number.isFinite(next)) return next;
  }
  return 0;
}

function applyLaneTrimOverride(
  plan: ReturnType<typeof computeWebWidthPlan>,
  childTargetWidthMm: number,
  laneCount: number,
  trimMm: number,
) {
  const child = Number(childTargetWidthMm || 0);
  const lane = Math.max(1, Number(laneCount || 1));
  const trim = Math.max(0, Number(trimMm || 0));
  if (!child) return { ...plan, trim_mm: trim };
  const computed = Math.round((child * lane + trim) * 100) / 100;
  const planned =
    plan.selected_standard_parent_width_mm &&
    plan.selected_standard_parent_width_mm >= computed
      ? plan.selected_standard_parent_width_mm
      : computed;
  const remainder = Math.max(0, Math.round((planned - computed) * 100) / 100);
  const remainderDisposition =
    remainder <= 0
      ? "NONE"
      : remainder >= plan.min_remainder_mm
        ? "KEEP"
        : "SCRAP";
  return {
    ...plan,
    trim_mm: trim,
    computed_run_width_mm: computed,
    planned_parent_width_mm: planned,
    remainder_mm: remainder,
    remainder_disposition: remainderDisposition as "NONE" | "KEEP" | "SCRAP",
  };
}

function fmtCompact(value: unknown, digits = 1) {
  const next = Number(value);
  if (!Number.isFinite(next)) return "0";
  return next.toLocaleString("en-IN", { maximumFractionDigits: digits });
}

function addonUsagePreview(
  addon: Addon,
  selectedSize?: ProductMasterSize,
  orderQty = 0,
  orderUom = "PCS",
) {
  const mode = String(addon.weight_mode || "").toUpperCase();
  const uom = String(
    addon.addon_purchase_uom || addon.base_uom || "KG",
  ).toUpperCase();
  const qty = Math.max(0, Number(orderQty || 0));
  const qtyLabel =
    String(orderUom || "PCS").toUpperCase() === "PCS"
      ? "pouches"
      : `${String(orderUom || "units").toUpperCase()} entered`;
  const weightValue = Math.max(0, Number(addon.weight_value || 0));
  const widthMm = Math.max(0, Number(selectedSize?.width_mm || 0));
  const heightMm = Math.max(0, Number(selectedSize?.height_mm || 0));
  const dimensionMm = widthMm || heightMm;

  if (mode === "PER_MM" && dimensionMm > 0) {
    const meterQty = (dimensionMm * qty) / 1000;
    const weightKg = (weightValue * dimensionMm * qty) / 1000;
    const stockPart =
      uom === "METER"
        ? `${fmtAddonNumber(meterQty)} METER stock`
        : `${fmtAddonNumber(weightKg)} KG stock`;
    return `1 run/pouch x ${fmtAddonNumber(dimensionMm)} mm x ${fmtAddonNumber(qty, 0)} ${qtyLabel} = ${stockPart}; weight math ${fmtAddonNumber(weightKg)} KG`;
  }
  if (mode === "PER_MM") {
    return `Runs per pouch; stock uses selected size length once width/height is known. Weight value ${fmtAddonNumber(weightValue)} g/mm.`;
  }
  if (mode === "PER_PIECE") {
    const pieces = qty;
    const weightKg = (weightValue * qty) / 1000;
    return `Count per pouch: 1 x ${fmtAddonNumber(qty, 0)} ${qtyLabel} = ${fmtAddonNumber(pieces, 0)} ${uom}; weight math ${fmtAddonNumber(weightKg)} KG`;
  }
  return `Multiplier per pouch: 1 x ${fmtAddonNumber(qty, 0)} ${qtyLabel}; stock UOM ${uom}.`;
}

function fmtAddonNumber(value: number, digits = 2) {
  if (!Number.isFinite(value)) return "0";
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

// ─── Helpers ─────────────────────────────────────────────────────

function applyOverlay(
  overlay: any,
  onPatch: (p: Partial<SalesOrderLine>) => void,
) {
  const patch: Partial<SalesOrderLine> = {
    customer_product_overlay: overlay.id,
    artwork_assignment: undefined,
    artwork_mode: overlay.default_artwork ? "OVERLAY_DEFAULT" : "DEFER",
  };
  if (overlay.default_price_basis)
    patch.price_basis = overlay.default_price_basis;
  const cleanAxisValues = sanitizeAxisValues(overlay.axis_values);
  const overlaySize = String(
    cleanAxisValues.size || overlay.size_variant_code || "",
  ).trim();
  if (overlaySize) {
    patch.size_code = overlaySize;
    cleanAxisValues.size = overlaySize;
  }
  if (Object.keys(cleanAxisValues).length) patch.axis_values = cleanAxisValues;
  onPatch(patch);
}

function findAxis(master: ProductMaster, ...names: string[]) {
  const wanted = new Set(names.map(normalizeCode));
  return (master.variant_axes || []).find((axis: VariantAxisDef) =>
    wanted.has(normalizeCode(axis.axis)),
  );
}

function axisAllowsAdHoc(axis?: VariantAxisDef) {
  return Boolean(
    axis &&
      ((axis as any).allow_ad_hoc ||
        (axis as any).allow_custom ||
        (axis as any).allow_new),
  );
}

function hasLayerMaterialAxis(master?: ProductMaster | null) {
  return Boolean(
    (master?.variant_axes || []).some((axis: VariantAxisDef) => {
      const key = normalizeCode(axis.axis);
      const type = normalizeCode((axis as any).type);
      return (
        [
          "LAYER_MATERIAL_OVERRIDES",
          "LAYER_MATERIALS",
          "FILM_VARIANT_BY_LAYER",
          "LAYER_FILM_VARIANTS",
          "MATERIAL_BY_LAYER",
        ].includes(key) ||
        [
          "LAYER_MATERIAL_ENUM",
          "PER_LAYER_MATERIAL_ENUM",
          "LAYER_FILM_VARIANT_ENUM",
          "PER_LAYER_FILM_VARIANT_ENUM",
        ].includes(type)
      );
    }),
  );
}

function layerAllowedFilmCodes(row: any, selected?: string) {
  const keys = [
    "film_variant_options",
    "allowed_film_variant_codes",
    "alternate_film_variant_codes",
    "allowed_alternate_film_variant_codes",
    "allowed_material_codes",
    "alternate_material_codes",
    "material_options",
  ];
  const codes: string[] = [];
  const pushCode = (value: any) => {
    if (Array.isArray(value)) {
      value.forEach(pushCode);
      return;
    }
    if (value && typeof value === "object") {
      pushCode(
        value.code ||
          value.material_code ||
          value.film_variant_code ||
          value.value ||
          value.id,
      );
      return;
    }
    const code = String(value || "").trim().toUpperCase();
    if (code) codes.push(code);
  };
  pushCode(row?.film_variant_code || row?.material_code);
  pushCode(selected);
  keys.forEach((key) => pushCode(row?.[key]));
  return Array.from(new Set(codes));
}

function normalizeCode(value: unknown) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function axisScalarValue(value: unknown): any {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value))
    return value
      .map(axisScalarValue)
      .filter((v) => v !== undefined && v !== "");
  if (typeof value === "object") {
    const row = value as Record<string, unknown>;
    return axisScalarValue(
      row.code ||
        row.value ||
        row.id ||
        row.material_code ||
        row.pod_sku_code ||
        row.addon_code ||
        row.size_code,
    );
  }
  return value;
}

function sanitizeAxisValues(raw: unknown): Record<string, any> {
  const src =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, any>)
      : {};
  const out: Record<string, any> = {};
  const structured = new Set([
    "layer_thicknesses",
    "layer_grades",
    "layer_material_overrides",
    "layer_materials",
    "film_variant_by_layer",
    "layer_film_variants",
    "material_by_layer",
  ]);
  Object.entries(src).forEach(([key, value]) => {
    if (
      ["size", "size_code", "geometry"].includes(key) &&
      isStructuredSizeValue(value)
    ) {
      out[key] = value;
      return;
    }
    if (structured.has(key) && value && typeof value === "object") {
      out[key] = value;
      return;
    }
    const scalar = axisScalarValue(value);
    if (
      scalar === undefined ||
      scalar === "" ||
      (Array.isArray(scalar) && scalar.length === 0)
    )
      return;
    out[key] = scalar;
  });
  return out;
}

function patchAxisValue(
  values: Record<string, any>,
  key: string,
  value: string,
) {
  const next = sanitizeAxisValues(values);
  if (value) next[key] = value;
  else delete next[key];
  return next;
}

function axisCatalogSource(
  axis?: VariantAxisDef,
): "pod_sku_variant" | "packaging_material" | "addon" | "" {
  if (!axis) return "";
  if (axis.master_data_source) return axis.master_data_source as any;
  const axisName = normalizeCode(axis.axis);
  const axisType = normalizeCode((axis as any).type);
  if (
    axisType === "PACKAGING_REF" ||
    [
      "PACKAGING",
      "PACKAGING_REF",
      "PACKAGING_INNER",
      "PACKAGING_OUTER",
      "PACKAGING_OTHER",
      "PACKAGING_EXTRA",
    ].includes(axisName)
  ) {
    return "packaging_material";
  }
  if (
    axisType === "POD_REF" ||
    ["POD", "POD_REF", "POD_VARIANT", "POD_SKU_VARIANT"].includes(axisName)
  ) {
    return "pod_sku_variant";
  }
  return "";
}

function axisOptionCode(option: unknown) {
  if (typeof option === "string" || typeof option === "number")
    return normalizeCode(option);
  if (!option || typeof option !== "object") return "";
  const row = option as Record<string, unknown>;
  return normalizeCode(
    row.code ||
      row.material_code ||
      row.pod_sku_code ||
      row.addon_code ||
      row.id,
  );
}

function axisAllowedCodes(axis?: VariantAxisDef) {
  const options = (axis as any)?.options;
  if (!Array.isArray(options) || options.length === 0) return null;
  const codes = new Set(options.map(axisOptionCode).filter(Boolean));
  return codes.size ? codes : null;
}

function filterRowsByAxisCodes<T>(
  rows: T[],
  axis: VariantAxisDef | undefined,
  codeOf: (row: T) => unknown,
) {
  const allowed = axisAllowedCodes(axis);
  if (!allowed) return rows;
  return rows.filter((row) => allowed.has(normalizeCode(codeOf(row))));
}

function packagingKind(
  material?: PackagingMaterial | Record<string, any> | null,
) {
  const raw = normalizeCode(
    (material as any)?.packaging_kind || (material as any)?.kind,
  );
  if (raw === "GUNNY") return "GONNY";
  if (raw === "CARTON") return "BOX";
  return raw;
}

function canonicalPackagingRole(role?: string) {
  const raw = normalizeCode(role || "PRIMARY_INNER");
  if (raw === "FINAL_CARTON" || raw === "FINAL_OUTER" || raw === "TAPE")
    return "EXTRA";
  if (
    raw === "PRIMARY_INNER" ||
    raw === "FINAL_GUNNY" ||
    raw === "ROLL_DISPATCH" ||
    raw === "EXTRA"
  )
    return raw;
  return "EXTRA";
}

function packagingLineMatchesAxis(
  line: Record<string, any>,
  axis: VariantAxisDef,
  master: ProductMaster,
) {
  const role = canonicalPackagingRole(line.role);
  const kind = packagingKind(line);
  const product = normalizeCode(master.product_kind);
  const axisName = normalizeCode(axis.axis);
  const axisRole = packagingAxisRole(axis, master);
  if (axisRole === "inner" || axisName === "PACKAGING_INNER") {
    return (
      product === "POUCH" && role === "PRIMARY_INNER" && kind === "INNER_POUCH"
    );
  }
  if (axisRole === "outer" || axisName === "PACKAGING_OUTER") {
    if (product === "ROLL" || product === "POD")
      return role === "ROLL_DISPATCH" && kind === "SHEET";
    if (product === "POUCH")
      return role === "FINAL_GUNNY" && ["GONNY", "SHEET"].includes(kind);
  }
  if (axisRole === "other") return role === "EXTRA";
  return false;
}

function packagingLineAllowedCodes(
  master: ProductMaster,
  axis: VariantAxisDef,
) {
  const lines = master.fixed_attributes?.packaging_lines;
  if (!Array.isArray(lines)) return null;
  const codes = new Set<string>();
  lines.forEach((line: Record<string, any>) => {
    if (!packagingLineMatchesAxis(line, axis, master)) return;
    const code = normalizeCode(
      line.material_code || line.code || line.material,
    );
    if (code) codes.add(code);
  });
  return codes.size ? codes : null;
}

function packagingMaterialAllowedForSales(
  material: PackagingMaterial,
  axis: VariantAxisDef,
  master: ProductMaster,
) {
  const explicitAllowed = packagingLineAllowedCodes(master, axis);
  if (explicitAllowed) return explicitAllowed.has(normalizeCode(material.code));

  const product = normalizeCode(master.product_kind);
  const kind = packagingKind(material);
  const axisName = normalizeCode(axis.axis);
  const axisRole = packagingAxisRole(axis, master);
  if (axisRole === "inner" || axisName === "PACKAGING_INNER") {
    return product === "POUCH" && kind === "INNER_POUCH";
  }
  if (axisRole === "outer" || axisName === "PACKAGING_OUTER") {
    if (product === "ROLL" || product === "POD") return kind === "SHEET";
    if (product === "POUCH") return ["GONNY", "SHEET"].includes(kind);
  }
  if (axisRole === "other")
    return !["INNER_POUCH", "GONNY", "SHEET"].includes(kind);
  if (axisRole === "generic") {
    if (product === "ROLL" || product === "POD") return kind === "SHEET";
    if (product === "POUCH")
      return ["INNER_POUCH", "GONNY", "SHEET"].includes(kind);
  }

  const rawFilterKind = axis.master_data_filter?.packaging_kind;
  const filterKinds = Array.isArray(rawFilterKind)
    ? rawFilterKind.map((value) => normalizeCode(value)).filter(Boolean)
    : [normalizeCode(rawFilterKind)].filter(Boolean);
  if (filterKinds.length)
    return filterKinds
      .map((value) => (value === "GUNNY" ? "GONNY" : value))
      .includes(kind);
  return true;
}

function packagingAxisRole(
  axis: VariantAxisDef,
  master: ProductMaster,
): "inner" | "outer" | "other" | "generic" {
  const product = normalizeCode(master.product_kind);
  const axisName = normalizeCode(axis.axis);
  const label = normalizeCode(axis.label);
  const type = normalizeCode((axis as any).type);
  const combined = `${axisName} ${label} ${type}`;
  if (combined.includes("INNER")) return "inner";
  if (
    combined.includes("OUTER") ||
    combined.includes("GUNNY") ||
    combined.includes("GONNY") ||
    combined.includes("SHEET") ||
    combined.includes("ROLL_DISPATCH")
  )
    return "outer";
  if (
    combined.includes("OTHER") ||
    combined.includes("EXTRA") ||
    combined.includes("EOD") ||
    combined.includes("TAPE") ||
    combined.includes("LABEL") ||
    combined.includes("TAG")
  )
    return "other";
  if (axisName === "PACKAGING" && product === "POUCH") return "inner";
  return "generic";
}

function hasInnerPackagingAxis(master?: ProductMaster) {
  return (
    !!master &&
    (master.variant_axes || []).some(
      (axis: VariantAxisDef) =>
        axisCatalogSource(axis) === "packaging_material" &&
        packagingAxisRole(axis, master) === "inner",
    )
  );
}

function hasInnerPackingConfig(
  master: ProductMaster | undefined,
  overlay: any,
) {
  if (!isPouchOutput(master)) return false;
  if (hasInnerPackagingAxis(master)) return true;
  if (effectiveInnerPackPcs(null, master, overlay) > 0) return true;
  const lines = master?.fixed_attributes?.packaging_lines;
  return (
    Array.isArray(lines) &&
    lines.some((item: any) => normalizeCode(item?.role) === "PRIMARY_INNER")
  );
}

function artworkColorCode(artwork: Artwork) {
  const front = Number(artwork.front_colors_count ?? artwork.colors_count ?? 0);
  const back = Number(artwork.back_colors_count ?? 0);
  return back > 0 ? `${front}F${back}B` : `${front}F`;
}

function artworkToColorway(
  artwork: Artwork,
  inkBaseFamily: "POLY" | "PET",
): ArtworkColorway {
  const accent = firstArtworkSwatch(artwork, inkBaseFamily);
  return {
    id: artwork.id,
    name: `${artwork.design_code} · ${artwork.name}`,
    family: artworkColorCode(artwork),
    thumbnail_url: artwork.primary_image || artwork.image || undefined,
    accent_hex: accent || undefined,
    is_approved: artwork.status === "APPROVED",
    color_count: Number(
      artwork.colors_count || artwork.front_colors_count || 0,
    ),
  };
}

function artworkSlots(
  artwork: Artwork,
  names: string[] | undefined,
  inkBaseFamily: "POLY" | "PET",
) {
  return (names || []).map((name, index) => ({
    index: index + 1,
    name,
    ...inkSlotForColor(artwork, name, inkBaseFamily),
  }));
}

function artworkToAssignment(
  artwork: Artwork,
  inkBaseFamily: "POLY" | "PET",
): ArtworkAssignment {
  const frontNames = artwork.front_colors?.length
    ? artwork.front_colors
    : artwork.color_list?.slice(
        0,
        artwork.front_colors_count || artwork.colors_count || 0,
      );
  const backNames = artwork.back_colors || [];
  const accent = firstArtworkSwatch(artwork, inkBaseFamily);
  return {
    artwork_id: artwork.id,
    design_family_code: artwork.design_code,
    design_family_name: artwork.name,
    colorway_id: artwork.id,
    colorway_name: artwork.name,
    accent_hex: accent || undefined,
    color_count: Number(artwork.colors_count || frontNames?.length || 0),
    ink_gsm_total: Number(artwork.ink_gsm_total || 0),
    cover_url: artwork.primary_image || artwork.image || undefined,
    front_colors: artworkSlots(artwork, frontNames, inkBaseFamily),
    back_colors: artworkSlots(artwork, backNames, inkBaseFamily),
    cylinder_required: artwork.print_type === "ROTO",
    cylinder_ready: !!artwork.cylinder_ready,
    artwork_approved: artwork.status === "APPROVED",
    print_type: artwork.print_type,
    film_type: artwork.substrate_mode,
    substrate_mode: artwork.substrate_mode,
  };
}

function artworkFilmType(artwork: Artwork): "SHEET" | "TUBING" {
  const form = normalizeCode(artwork.substrate_mode || "");
  return form === "TUBING" ? "TUBING" : "SHEET";
}

function uniqueArtworks(items: Artwork[]) {
  const seen = new Set<string>();
  const out: Artwork[] = [];
  for (const item of items) {
    if (!item?.id || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

function artworkSelectableForLine(
  artwork: Artwork,
  _master: ProductMaster | undefined,
  printType: string,
  filmType: string,
) {
  if (!artwork || artwork.status !== "APPROVED") return false;
  const artworkPrint = normalizeCode(artwork.print_type || "");
  const wantedPrint = normalizeCode(printType || "");
  if (artworkPrint && wantedPrint && artworkPrint !== wantedPrint) return false;
  const artworkFilm = normalizeCode(artwork.substrate_mode || "");
  const wantedFilm = normalizeCode(filmType || "");
  if (artworkFilm && wantedFilm && artworkFilm !== wantedFilm) return false;
  return true;
}

function filmTypeForSize(
  size: ProductMasterSize | undefined,
  master: ProductMaster,
): "SHEET" | "TUBING" | "" {
  const stock = normalizeCode(
    size?.stock_form || size?.roll_form || size?.width_basis,
  );
  if (
    stock.includes("TUBE") ||
    stock.includes("TUBING") ||
    stock.includes("LAYFLAT")
  )
    return "TUBING";
  if (
    stock.includes("SHEET") ||
    stock.includes("OPEN") ||
    stock.includes("FOLDED")
  )
    return "SHEET";
  const fixed = normalizeCode(
    master.fixed_attributes?.stock_form ||
      master.fixed_attributes?.default_stock_form ||
      master.fixed_attributes?.pouch_style_stock_form ||
      master.fixed_attributes?.pouch_style_default_stock_form ||
      master.fixed_attributes?.roll_form ||
      master.fixed_attributes?.substrate_mode ||
      master.fixed_attributes?.film_type,
  );
  if (fixed.includes("TUBE") || fixed.includes("TUBING") || fixed.includes("LAYFLAT"))
    return "TUBING";
  if (fixed === "SHEET" || fixed.includes("OPEN") || fixed.includes("FOLDED"))
    return "SHEET";
  return "";
}

function resolveInkBaseFamilyFromPreview(preview: any): "POLY" | "PET" {
  const fromPrint = String(
    preview?.printing_snapshot?.ink_base_family ||
      preview?.printing?.ink_base_family ||
      "",
  ).toUpperCase();
  if (fromPrint === "PET") return "PET";
  if (fromPrint === "POLY") return "POLY";
  return resolveInkBaseFamilyFromLayers(
    preview?.layer_snapshot || preview?.film_layers || [],
  );
}

function resolveInkBaseFamilyFromLayers(layers: any): "POLY" | "PET" {
  for (const layer of Array.isArray(layers) ? layers : []) {
    const density = Number(layer?.density_g_cm3 ?? layer?.density_gcm3 ?? 0);
    if (Number.isFinite(density) && density > 1.3) return "PET";
  }
  return "POLY";
}

function firstArtworkSwatch(artwork: Artwork, family: "POLY" | "PET") {
  const colors = [
    ...(artwork.front_colors || []),
    ...(artwork.back_colors || []),
    ...(artwork.color_list || []),
  ];
  for (const color of colors) {
    const slot = inkSlotForColor(artwork, color, family);
    if (slot.hex) return slot.hex;
  }
  return "";
}

function inkSlotForColor(
  artwork: Artwork,
  color: string,
  family: "POLY" | "PET",
) {
  return {
    hex: "",
    role: family,
    ink_base_family: family,
    ink_material_id: undefined,
    swatch_source: "ARTWORK_COLOR",
  };
}

function buildArtworkBlockers(
  line: SalesOrderLine,
  master: ProductMaster | undefined,
  artworks: Artwork[],
  overlay?: any,
) {
  const blockers: string[] = [];
  if (!master?.fixed_attributes?.print_capable) return blockers;
  if (line.artwork_mode === "DEFER") return blockers;
  const assignmentId =
    line.artwork_assignment?.artwork_id ||
    (line.artwork_mode === "OVERLAY_DEFAULT" ? overlay?.default_artwork : "");
  if (!assignmentId) {
    if (line.artwork_mode === "OVERLAY_DEFAULT")
      blockers.push(
        "Artwork: selected customer overlay has no default artwork.",
      );
    else blockers.push("Artwork: pick an approved artwork.");
    return blockers;
  }
  const artwork = artworks.find((item) => item.id === assignmentId);
  if (!artwork) {
    blockers.push(
      "Artwork: selected artwork is not in the approved list for this print method and SHEET/TUBING form.",
    );
    return blockers;
  }
  if (
    !artworkSelectableForLine(artwork, master, line.print_type, line.film_type)
  ) {
    blockers.push(
      "Artwork: selected artwork does not match the selected print method or SHEET/TUBING form.",
    );
    return blockers;
  }
  return blockers;
}

function buildPackingBlockers(
  line: SalesOrderLine,
  master: ProductMaster | undefined,
  preview: any,
) {
  const blockers: string[] = [];
  if (!isPouchOutput(master)) return blockers;
  const override = Number(line.inner_pouch_pcs_per_pack || 0);
  if (
    line.inner_pouch_pcs_per_pack &&
    (!Number.isFinite(override) || override <= 0)
  ) {
    blockers.push("Packing: pcs per inner pouch must be greater than zero.");
    return blockers;
  }
  if (override > 0) {
    const primary = preview?.packaging_snapshot?.primary_inner_pack || {};
    if (!primary?.material_id && !primary?.material_code) {
      blockers.push(
        "Packing: pick an inner-pouch packaging axis or Product Master default before overriding pcs per inner.",
      );
    }
  }
  return blockers;
}

function sameStringList(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function assignmentColorSignature(assignment?: ArtworkAssignment) {
  const slots = [
    ...(assignment?.front_colors || []),
    ...(assignment?.back_colors || []),
  ];
  return slots
    .map(
      (slot) =>
        `${slot.index}:${slot.name}:${slot.hex || ""}:${slot.role || ""}:${slot.swatch_source || ""}`,
    )
    .join("|");
}

function isPouchOutput(master?: ProductMaster) {
  if (!master) return false;
  const fg = String(
    master.fixed_attributes?.fg_type || master.product_kind || "",
  ).toUpperCase();
  return fg === "POUCH";
}

function effectiveInnerPackPcs(
  preview: any,
  master: ProductMaster | undefined,
  overlay: any,
) {
  const previewPcs = Number(
    preview?.packaging_snapshot?.primary_inner_pack?.pcs_per_pack || 0,
  );
  if (Number.isFinite(previewPcs) && previewPcs > 0) return previewPcs;
  const overlayPcs = Number(
    overlay?.default_packing_recipe?.primary_inner_pack?.pcs_per_pack ||
      overlay?.default_packing_recipe?.pcs_per_inner ||
      0,
  );
  if (Number.isFinite(overlayPcs) && overlayPcs > 0) return overlayPcs;
  const lines = master?.fixed_attributes?.packaging_lines;
  if (Array.isArray(lines)) {
    const row = lines.find(
      (item: any) => normalizeCode(item?.role) === "PRIMARY_INNER",
    );
    const pcs = Number(row?.pcs_per_pack || 0);
    if (Number.isFinite(pcs) && pcs > 0) return pcs;
  }
  return 0;
}

function previewArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function previewMaterialEvidenceCount(preview: any) {
  if (!preview) return 0;
  const bom = preview.bom || {};
  const snapshot = preview.bom_snapshot || {};
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
  ];
  return groups.reduce((sum, group) => sum + group.length, 0);
}

function previewHasBomIssues(preview: any) {
  if (!preview) return false;
  const bom = preview.bom || {};
  return (
    [
      ...previewArray(preview.pre_submit_blockers),
      ...previewArray(preview.blockers),
      ...previewArray(preview.errors),
      ...previewArray(bom.errors),
    ].length > 0
  );
}

function previewResolverBlocker(preview: any) {
  if (!preview || preview.source !== "PREVIEW_API_ERROR") return "";
  const bom = preview.bom || {};
  const issues = [
    ...previewArray(preview.errors),
    ...previewArray(preview.blockers),
    ...previewArray(preview.pre_submit_blockers),
    ...previewArray(bom.errors),
  ]
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  return issues[0] || "backend rejected the live BOM preview";
}

function previewErrorMessage(error: any) {
  const raw = errorText(error);
  if (
    /product[_\s-]*master/i.test(raw) &&
    /(invalid|inactive|current version|not the current)/i.test(raw)
  ) {
    return "Selected Product Master is unavailable for order placement. Pick an order-ready Product Master before placing the order.";
  }
  return raw || "backend rejected the live BOM preview";
}

function errorText(error: any): string {
  const candidates = [
    error?.response?.data?.detail,
    error?.response?.data?.message,
    error?.response?.data?.error,
    error?.response?.data,
    error?.message,
  ];
  for (const value of candidates) {
    const text = flattenErrorText(value);
    if (text) return text;
  }
  return "";
}

function flattenErrorText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value))
    return value.map(flattenErrorText).filter(Boolean).join(" · ");
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => {
        const text = flattenErrorText(item);
        return text ? `${key}: ${text}` : "";
      })
      .filter(Boolean)
      .join(" · ");
  }
  return String(value);
}

function buildLinePackagingSnapshot(line: SalesOrderLine) {
  const pcsPerPack = Number(line.inner_pouch_pcs_per_pack || 0);
  if (!Number.isFinite(pcsPerPack) || pcsPerPack <= 0) return undefined;
  return {
    primary_inner_pack: {
      enabled: true,
      pcs_per_pack: Math.floor(pcsPerPack),
      basis: "PCS_PER_PACK",
    },
  };
}

function masterChemistrySummary(master?: ProductMaster | null) {
  const fixed = (master?.fixed_attributes || {}) as Record<string, any>;
  const adhesive = Number(fixed.adhesive_gsm ?? fixed.adhesive_gsm_total ?? 0);
  const solvent = Number(fixed.solvent_gsm ?? fixed.solvent_gsm_total ?? 0);
  const safeAdhesive = Number.isFinite(adhesive) && adhesive > 0 ? adhesive : 0;
  const safeSolvent = Number.isFinite(solvent) && solvent > 0 ? solvent : 0;
  const total = safeAdhesive + safeSolvent;
  const parts = [
    safeAdhesive > 0
      ? {
          label: `ADH ${Number(safeAdhesive.toFixed(3)).toString()}`,
          code: fixed.adhesive_material_code || "",
        }
      : null,
    safeSolvent > 0
      ? {
          label: `SOL ${Number(safeSolvent.toFixed(3)).toString()}`,
          code: fixed.solvent_material_code || "",
        }
      : null,
  ].filter(Boolean) as Array<{ label: string; code: string }>;
  return {
    adhesive: safeAdhesive,
    solvent: safeSolvent,
    total,
    parts,
    label: total > 0 ? `A&S${Number(total.toFixed(3)).toString()}` : "",
  };
}

function buildLineChemistrySnapshot(master?: ProductMaster | null) {
  const summary = masterChemistrySummary(master);
  if (summary.total <= 0) return {};
  const fixed = (master?.fixed_attributes || {}) as Record<string, any>;
  return {
    adhesive_gsm: summary.adhesive,
    adhesive_material_id: fixed.adhesive_material_id || undefined,
    adhesive_material_code: fixed.adhesive_material_code || undefined,
    adhesive_material_name: fixed.adhesive_material_name || undefined,
    solvent_gsm: summary.solvent,
    solvent_material_id: fixed.solvent_material_id || undefined,
    solvent_material_code: fixed.solvent_material_code || undefined,
    solvent_material_name: fixed.solvent_material_name || undefined,
    display_gsm_total: summary.total,
    display_label: summary.label,
  };
}

function dedupeByCode<T extends { code: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const r of rows) {
    const key = String(r.code || "").trim();
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

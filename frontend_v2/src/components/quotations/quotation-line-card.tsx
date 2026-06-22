"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  ChevronDown,
  Copy as CopyIcon,
  Loader2,
  Package,
  Save,
  Trash2,
  Wand2,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
  quotationService,
  type CostingResult,
  type ProductMasterBom,
  type QuoteLineInnerPack,
  type QuoteLineSpec,
} from "@/services/quotation";
import CatalogLinePicker, {
  type CatalogPickerSelection,
} from "@/components/quotations/catalog-line-picker";
import CostingRail from "@/components/quotations/costing-rail";
import LineSpecBuilder, {
  lineSpecToBackendSpec,
  type LineSpecValue,
} from "@/components/quotations/line-spec-builder";
import VarianceRibbon from "@/components/quotations/variance-ribbon";
import ProductionPreviewCard from "@/components/quotations/production-preview-card";
import {
  bomStripText,
  diffSpecVsMaster,
  type MasterSnapshot,
} from "@/components/quotations/line-spec-diff";

// ─────────────────────────────────────────────────────────────────────────
// Types — Draft item shape carried in workspace state.
// ─────────────────────────────────────────────────────────────────────────

export interface DraftItem {
  id?: string;
  local_id: string;
  line_no: number;
  /**
   * Persisted as `line_kind` on the backend ("CATALOG" | "AD_HOC"). The
   * frontend deals with it as `origin`.
   */
  line_kind: "CATALOG" | "AD_HOC";
  line_name: string;
  qty: number;
  uom: "PCS" | "KG";
  rate: number;
  margin_pct?: number | null;
  margin_lock: boolean;
  spec_snapshot: Record<string, unknown> & QuoteLineSpec;
  costing_snapshot?: Record<string, unknown>;
  /** Legacy field — kept for backward compatibility with workspace state. */
  adhoc_draft?: unknown;
}

function inr(v: number | undefined | null): string {
  if (v === undefined || v === null || !Number.isFinite(v)) return "—";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(v);
}

// ─────────────────────────────────────────────────────────────────────────
// spec_snapshot ↔ LineSpecValue conversion
// ─────────────────────────────────────────────────────────────────────────

const EMPTY_SPEC: LineSpecValue = {
  origin: "AD_HOC",
  width_mm: 0,
  height_mm: 0,
  gusset_mm: 0,
  flap_mm: 0,
  layers: [],
  adhesive: { gsm: 0, rate_per_kg: 0, name: "" },
  ink: { gsm: 0, rate_per_kg: 0, name: "", coverage: "MANUAL" },
  addons: [],
  features: {},
};

function specSnapshotToLineSpec(item: DraftItem): LineSpecValue {
  const s = (item.spec_snapshot || {}) as Record<string, unknown> &
    QuoteLineSpec & {
      adhesive?: {
        material_id?: string;
        code?: string;
        name?: string;
        gsm?: number;
        rate_per_kg?: number;
      };
      ink?: {
        material_id?: string;
        code?: string;
        name?: string;
        gsm?: number;
        rate_per_kg?: number;
        coverage?: string;
      };
      addons?: Array<{
        material_id?: string;
        code?: string;
        name: string;
        qty_per_pouch?: number;
        rate_per_kg?: number;
      }>;
      features?: Record<string, boolean>;
      product_master_id?: string;
      product_master_code?: string;
      product_master_name?: string;
      size_id?: string;
      size_code?: string;
      size_label?: string;
      base_product_master_id?: string;
      base_product_master_code?: string;
      base_product_master_name?: string;
      base_size_id?: string;
      base_size_code?: string;
      base_size_label?: string;
      pouch_style_id?: string;
      pouch_style_code?: string;
      pouch_style_roll_axis?: string;
      stock_form?: string;
      width_basis?: string;
      film_area_width_mm?: number | null;
      print_capable?: boolean | null;
      artwork_required?: boolean | null;
      artwork_id?: string | null;
      artwork_code?: string | null;
      artwork_name?: string | null;
      artwork_print_type?: string | null;
      artwork_substrate_mode?: string | null;
      artwork_front_colors_count?: number | null;
      artwork_back_colors_count?: number | null;
      artwork_ink_gsm_total?: number | null;
      child_target_width_mm?: number | null;
      child_web_width_mm?: number | null;
      optional_inner_pack?: QuoteLineInnerPack | null;
      save_as_master?: boolean;
    };
  const adhesive = s.adhesive || {
    gsm: Number(s.adhesive_gsm ?? EMPTY_SPEC.adhesive.gsm),
    rate_per_kg: Number(
      s.adhesive_rate_per_kg ?? EMPTY_SPEC.adhesive.rate_per_kg,
    ),
    name: s.adhesive_name || "",
  };
  const ink = s.ink || {
    gsm: Number(s.ink_gsm ?? EMPTY_SPEC.ink.gsm),
    rate_per_kg: Number(s.ink_rate_per_kg ?? EMPTY_SPEC.ink.rate_per_kg),
    name: s.ink_name || "",
    coverage: "MANUAL",
  };
  const hasLayerArray = Array.isArray(s.layers);
  const layers =
    (s.layers as Array<Record<string, unknown>> | undefined)?.map((l, idx) => ({
      position: (l.position as string) || `L${idx + 1}`,
      material_id: (l.material_id as string) || undefined,
      material_code: (l.material_code as string) || "",
      material_name: (l.material_name as string) || (l.name as string) || "",
      micron: Number(l.micron ?? 0),
      gsm: Number(l.gsm ?? 0),
      gsm_auto:
        typeof l.gsm_auto === "boolean" ? l.gsm_auto : undefined,
      rate_per_kg: Number(l.rate_per_kg ?? 0),
      density_gcm3: (l.density_gcm3 as number | undefined) ?? undefined,
    })) || [];
  return {
    origin: item.line_kind,
    product_master_id: s.product_master_id,
    product_master_code: s.product_master_code,
    product_master_name: s.product_master_name,
    size_id: s.size_id,
    size_code: s.size_code,
    size_label: s.size_label,
    base_product_master_id: s.base_product_master_id,
    base_product_master_code: s.base_product_master_code,
    base_product_master_name: s.base_product_master_name,
    base_size_id: s.base_size_id,
    base_size_code: s.base_size_code,
    base_size_label: s.base_size_label,
    pouch_style_id: s.pouch_style_id || undefined,
    pouch_style_code: s.pouch_style_code || undefined,
    pouch_style_roll_axis: s.pouch_style_roll_axis || undefined,
    stock_form: s.stock_form || undefined,
    width_basis: s.width_basis || undefined,
    film_area_width_mm:
      typeof s.film_area_width_mm === "number" ? s.film_area_width_mm : null,
    print_capable:
      typeof s.print_capable === "boolean" ? s.print_capable : undefined,
    artwork_required:
      typeof s.artwork_required === "boolean" ? s.artwork_required : undefined,
    artwork_id: s.artwork_id || undefined,
    artwork_code: s.artwork_code || undefined,
    artwork_name: s.artwork_name || undefined,
    artwork_print_type: s.artwork_print_type || undefined,
    artwork_substrate_mode: s.artwork_substrate_mode || undefined,
    artwork_front_colors_count:
      typeof s.artwork_front_colors_count === "number"
        ? s.artwork_front_colors_count
        : undefined,
    artwork_back_colors_count:
      typeof s.artwork_back_colors_count === "number"
        ? s.artwork_back_colors_count
        : undefined,
    artwork_ink_gsm_total:
      typeof s.artwork_ink_gsm_total === "number"
        ? s.artwork_ink_gsm_total
        : undefined,
    child_target_width_mm:
      typeof s.child_target_width_mm === "number"
        ? s.child_target_width_mm
        : typeof s.child_web_width_mm === "number"
          ? s.child_web_width_mm
        : null,
    width_mm: Number(s.width_mm ?? EMPTY_SPEC.width_mm),
    height_mm: Number(s.height_mm ?? EMPTY_SPEC.height_mm),
    gusset_mm: Number(s.gusset_mm ?? EMPTY_SPEC.gusset_mm),
    flap_mm: Number(s.flap_mm ?? EMPTY_SPEC.flap_mm),
    layers: hasLayerArray ? layers : EMPTY_SPEC.layers,
    adhesive: {
      material_id: adhesive.material_id,
      code: adhesive.code,
      name: adhesive.name || "",
      gsm: Number(adhesive.gsm ?? 0),
      rate_per_kg: Number(adhesive.rate_per_kg ?? 0),
    },
    ink: {
      material_id: ink.material_id,
      code: ink.code,
      name: ink.name || "",
      coverage: ink.coverage || "MANUAL",
      gsm: Number(ink.gsm ?? 0),
      rate_per_kg: Number(ink.rate_per_kg ?? 0),
    },
    addons: (s.addons || []).map((a) => ({
      material_id: a.material_id || undefined,
      code: a.code,
      name: a.name,
      qty_per_pouch: Number(a.qty_per_pouch ?? 1),
      rate_per_kg: Number(a.rate_per_kg ?? 0),
    })),
    optional_inner_pack: s.optional_inner_pack || null,
    features: s.features || {},
    save_as_master:
      typeof s.save_as_master === "boolean"
        ? s.save_as_master
        : item.line_kind === "AD_HOC",
  };
}

function lineSpecToSpecSnapshot(
  value: LineSpecValue,
  masterSnapshot?: MasterSnapshot,
): Record<string, unknown> & QuoteLineSpec {
  const snapshot = normalizeLineSpecForRules(value);
  return {
    product_master_id: snapshot.product_master_id,
    product_master_code: snapshot.product_master_code,
    product_master_name: snapshot.product_master_name,
    size_id: snapshot.size_id,
    size_code: snapshot.size_code,
    size_label: snapshot.size_label,
    base_product_master_id: snapshot.base_product_master_id,
    base_product_master_code: snapshot.base_product_master_code,
    base_product_master_name: snapshot.base_product_master_name,
    base_size_id: snapshot.base_size_id,
    base_size_code: snapshot.base_size_code,
    base_size_label: snapshot.base_size_label,
    pouch_style_id: snapshot.pouch_style_id,
    pouch_style_code: snapshot.pouch_style_code,
    pouch_style_roll_axis: snapshot.pouch_style_roll_axis,
    stock_form: snapshot.stock_form,
    width_basis: snapshot.width_basis,
    film_area_width_mm: snapshot.film_area_width_mm,
    print_capable: snapshot.print_capable,
    artwork_required: snapshot.artwork_required,
    artwork_id: snapshot.artwork_id,
    artwork_code: snapshot.artwork_code,
    artwork_name: snapshot.artwork_name,
    artwork_print_type: snapshot.artwork_print_type,
    artwork_substrate_mode: snapshot.artwork_substrate_mode,
    artwork_front_colors_count: snapshot.artwork_front_colors_count,
    artwork_back_colors_count: snapshot.artwork_back_colors_count,
    artwork_ink_gsm_total: snapshot.artwork_ink_gsm_total,
    child_target_width_mm: snapshot.child_target_width_mm || undefined,
    child_web_width_mm: snapshot.child_target_width_mm || undefined,
    width_mm: snapshot.width_mm,
    height_mm: snapshot.height_mm,
    gusset_mm: snapshot.gusset_mm,
    flap_mm: snapshot.flap_mm,
    layers: snapshot.layers,
    adhesive: snapshot.adhesive,
    ink: snapshot.ink,
    adhesive_name: snapshot.adhesive.name,
    adhesive_gsm: snapshot.adhesive.gsm,
    adhesive_rate_per_kg: snapshot.adhesive.rate_per_kg,
    ink_name: snapshot.ink.name,
    ink_gsm: snapshot.ink.gsm,
    ink_rate_per_kg: snapshot.ink.rate_per_kg,
    addons: snapshot.addons,
    optional_inner_pack: snapshot.optional_inner_pack || null,
    features: snapshot.features,
    save_as_master: snapshot.save_as_master,
    master_snapshot: masterSnapshot,
  };
}

function normalizeLineSpecForRules(value: LineSpecValue): LineSpecValue {
  const layerCount = (value.layers || []).length;
  const adhesive =
    layerCount > 1
      ? value.adhesive
      : { material_id: null, code: "", name: "", gsm: 0, rate_per_kg: 0 };
  const ink = value.print_capable
    ? value.ink
    : {
        material_id: null,
        code: "",
        name: "",
        gsm: 0,
        rate_per_kg: 0,
        coverage: "MANUAL",
      };
  if (!value.print_capable) {
    return {
      ...value,
      adhesive,
      ink,
      artwork_id: null,
      artwork_code: null,
      artwork_name: null,
      artwork_print_type: null,
      artwork_substrate_mode: null,
      artwork_front_colors_count: null,
      artwork_back_colors_count: null,
      artwork_ink_gsm_total: null,
    };
  }
  return { ...value, adhesive, ink };
}

// ─────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────

interface QuotationLineCardProps {
  item: DraftItem;
  customerId?: string;
  plantId?: string;
  isOpen: boolean;
  onToggle: () => void;
  onChange: (next: DraftItem) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onSaveLine?: () => void;
  canPersist: boolean;
}

export default function QuotationLineCard({
  item,
  customerId,
  plantId,
  isOpen,
  onToggle,
  onChange,
  onRemove,
  onDuplicate,
  onSaveLine,
  canPersist,
}: QuotationLineCardProps) {
  const { toast } = useToast();
  const lineSpec = useMemo(() => specSnapshotToLineSpec(item), [item]);
  const masterSnapshot = (
    item.spec_snapshot as { master_snapshot?: MasterSnapshot } | undefined
  )?.master_snapshot;
  const [bomData, setBomData] = useState<ProductMasterBom | null>(null);
  const hydrationPmId =
    item.line_kind === "AD_HOC"
      ? lineSpec.product_master_id || lineSpec.base_product_master_id
      : lineSpec.product_master_id;

  // ── BOM hydration when a Product Master is attached ────────────────────
  const bomMut = useMutation({
    mutationFn: (pmId: string) => quotationService.getProductMasterBom(pmId),
    onSuccess: (data, pmId) => {
      setBomData(data);
      // First hydration only — when spec doesn't yet have layers OR pm just changed.
      const currentSpec = (item.spec_snapshot || {}) as Record<string, unknown>;
      const layers = (currentSpec.layers as unknown[]) || [];
      const isAdHoc = item.line_kind === "AD_HOC";
      const selectedSizeId = isAdHoc ? lineSpec.base_size_id : lineSpec.size_id;
      const selectedBomSize = (data.sizes || []).find(
        (s) => s.id === selectedSizeId,
      );
      const masterAlreadyAttached =
        (
          currentSpec.master_snapshot as
            | { product_master_id?: string }
            | undefined
        )?.product_master_id === pmId;
      if (!masterAlreadyAttached || layers.length === 0) {
        const hydratedSpec: LineSpecValue = {
          ...lineSpec,
          origin: item.line_kind,
          product_master_id: isAdHoc ? undefined : data.product_master_id,
          product_master_code: isAdHoc ? undefined : data.product_master_code,
          product_master_name: isAdHoc ? undefined : data.product_master_name,
          base_product_master_id: isAdHoc
            ? data.product_master_id
            : lineSpec.base_product_master_id,
          base_product_master_code: isAdHoc
            ? data.product_master_code
            : lineSpec.base_product_master_code,
          base_product_master_name: isAdHoc
            ? data.product_master_name
            : lineSpec.base_product_master_name,
          size_id: lineSpec.size_id,
          size_code: lineSpec.size_code,
          size_label: lineSpec.size_label,
          pouch_style_id:
            lineSpec.pouch_style_id ||
            selectedBomSize?.pouch_style_master ||
            selectedBomSize?.pouch_style_id ||
            data.default_pouch_style_id ||
            undefined,
          pouch_style_code:
            lineSpec.pouch_style_code ||
            selectedBomSize?.pouch_style_master_code ||
            selectedBomSize?.pouch_style ||
            undefined,
          pouch_style_roll_axis:
            lineSpec.pouch_style_roll_axis ||
            selectedBomSize?.pouch_style_roll_axis ||
            undefined,
          stock_form: lineSpec.stock_form || selectedBomSize?.stock_form || undefined,
          width_basis: lineSpec.width_basis || selectedBomSize?.width_basis || undefined,
          film_area_width_mm:
            lineSpec.film_area_width_mm ?? selectedBomSize?.film_area_width_mm,
          print_capable: data.print_capable,
          artwork_required: data.artwork_required,
          child_target_width_mm:
            lineSpec.child_target_width_mm ??
            selectedBomSize?.child_target_width_mm,
          width_mm: lineSpec.width_mm,
          height_mm: lineSpec.height_mm,
          gusset_mm: lineSpec.gusset_mm,
          flap_mm: lineSpec.flap_mm,
          layers: data.layers.map((l, idx) => ({
            position: l.position || `L${idx + 1}`,
            material_id: l.material_id || undefined,
            material_code: l.material_code,
            material_name: l.material_name,
            micron: l.micron,
            gsm: l.gsm,
            gsm_auto: Boolean(l.density_gcm3),
            rate_per_kg: l.rate_per_kg,
            density_gcm3: l.density_gcm3 || undefined,
          })),
          adhesive: {
            material_id: data.adhesive.material_id || undefined,
            code: data.adhesive.code,
            name: data.adhesive.name || "",
            gsm: data.adhesive.gsm,
            rate_per_kg: data.adhesive.rate_per_kg,
          },
          ink: {
            material_id: data.ink.material_id || undefined,
            code: data.ink.code,
            name: data.ink.name || "",
            gsm: data.ink.gsm,
            rate_per_kg: data.ink.rate_per_kg,
            coverage: data.ink.coverage || "MANUAL",
          },
          addons: data.addons.map((a) => ({
            material_id: a.material_id || undefined,
            code: a.code,
            name: a.name,
            qty_per_pouch: a.qty_per_pouch,
            rate_per_kg: a.rate_per_kg,
          })),
          features: {},
          optional_inner_pack: lineSpec.optional_inner_pack || null,
          save_as_master: isAdHoc ? lineSpec.save_as_master !== false : false,
        };
        // Build the master_snapshot baseline.
        const normalizedHydratedSpec = normalizeLineSpecForRules(hydratedSpec);
        const baseline: MasterSnapshot = {
          product_master_id: data.product_master_id,
          product_master_code: data.product_master_code,
          product_master_name: data.product_master_name,
          width_mm: lineSpec.width_mm,
          height_mm: lineSpec.height_mm,
          gusset_mm: lineSpec.gusset_mm,
          flap_mm: lineSpec.flap_mm,
          pouch_style_id: hydratedSpec.pouch_style_id,
          pouch_style_code: hydratedSpec.pouch_style_code,
          pouch_style_roll_axis: hydratedSpec.pouch_style_roll_axis,
          stock_form: hydratedSpec.stock_form,
          width_basis: hydratedSpec.width_basis,
          film_area_width_mm: hydratedSpec.film_area_width_mm,
          print_capable: hydratedSpec.print_capable,
          artwork_required: hydratedSpec.artwork_required,
          artwork_id: hydratedSpec.artwork_id,
          artwork_code: hydratedSpec.artwork_code,
          artwork_name: hydratedSpec.artwork_name,
          artwork_print_type: hydratedSpec.artwork_print_type,
          artwork_substrate_mode: hydratedSpec.artwork_substrate_mode,
          artwork_front_colors_count: hydratedSpec.artwork_front_colors_count,
          artwork_back_colors_count: hydratedSpec.artwork_back_colors_count,
          artwork_ink_gsm_total: hydratedSpec.artwork_ink_gsm_total,
          child_target_width_mm: hydratedSpec.child_target_width_mm,
          layers: normalizedHydratedSpec.layers.map((l) => ({ ...l })),
          adhesive: { ...normalizedHydratedSpec.adhesive },
          ink: { ...normalizedHydratedSpec.ink },
          addons: normalizedHydratedSpec.addons.map((a) => ({ ...a })),
          features: {},
        };
        onChange({
          ...item,
          spec_snapshot: lineSpecToSpecSnapshot(normalizedHydratedSpec, baseline),
        });
      }
    },
  });

  useEffect(() => {
    const pmId = hydrationPmId;
    if (!pmId) {
      setBomData(null);
      return;
    }
    if (bomData && bomData.product_master_id === pmId) return;
    bomMut.mutate(pmId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrationPmId]);

  // ── Diff detection ─────────────────────────────────────────────────────
  const modifiedFields = useMemo(() => {
    if (item.line_kind !== "CATALOG" || !masterSnapshot) return [];
    const spec = item.spec_snapshot as QuoteLineSpec & {
      features?: Record<string, boolean>;
    };
    return diffSpecVsMaster(spec, masterSnapshot);
  }, [item.spec_snapshot, item.line_kind, masterSnapshot]);

  const modifiedPaths = useMemo(
    () => new Set(modifiedFields.map((f) => f.path)),
    [modifiedFields],
  );

  // ── Live cost preview (debounced) ──────────────────────────────────────
  const previewMut = useMutation({
    mutationFn: () =>
      quotationService.costPreview({
        spec: lineSpecToBackendSpec(lineSpec),
        customer_id: customerId || null,
        plant_id: plantId || null,
        manual_margin_pct: item.margin_lock ? (item.margin_pct ?? null) : null,
        manual_rate: item.margin_lock ? null : item.rate || null,
      }),
    onSuccess: (data) => {
      onChange({
        ...item,
        margin_pct: item.margin_lock
          ? item.margin_pct
          : Number(data.margin_pct || 0),
        rate:
          item.margin_lock && data.suggested_rate
            ? Number(data.suggested_rate)
            : item.rate,
        costing_snapshot: {
          material_cost_per_kg: data.material_cost_per_kg,
          conversion_cost_per_kg: data.conversion_cost_per_kg,
          total_cost_per_kg: data.total_cost_per_kg,
          margin_pct: data.margin_pct,
          margin_source: data.margin_source,
          suggested_rate: data.suggested_rate,
          breakdown: data.breakdown,
          warnings: data.warnings,
          is_indicative: data.is_indicative,
        },
      });
    },
  });

  const previewKey = JSON.stringify({
    s: lineSpec,
    m: item.margin_lock,
    p: item.margin_pct,
    r: item.rate,
    c: customerId,
    pl: plantId,
  });
  useEffect(() => {
    if (!lineSpec.width_mm || !lineSpec.height_mm) return;
    if ((lineSpec.layers || []).length === 0) return;
    const t = setTimeout(() => previewMut.mutate(), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey]);

  // ── Promote modified BOM back to master ────────────────────────────────
  const promoteMut = useMutation({
    mutationFn: (pmId: string) =>
      quotationService.updateProductMasterBom(pmId, {
        layers: lineSpec.layers,
        adhesive: normalizeLineSpecForRules(lineSpec).adhesive,
        ink: normalizeLineSpecForRules(lineSpec).ink,
        addons: lineSpec.addons,
      }),
    onSuccess: () => {
      toast({
        title: "Master updated",
        description: "Future orders of this product will use the new BOM.",
      });
      // Restamp master_snapshot so the line shows MATCHES MASTER going forward.
      const baseline: MasterSnapshot = {
        width_mm: lineSpec.width_mm,
        height_mm: lineSpec.height_mm,
        gusset_mm: lineSpec.gusset_mm,
        flap_mm: lineSpec.flap_mm,
        pouch_style_id: lineSpec.pouch_style_id,
        pouch_style_code: lineSpec.pouch_style_code,
        pouch_style_roll_axis: lineSpec.pouch_style_roll_axis,
        stock_form: lineSpec.stock_form,
        width_basis: lineSpec.width_basis,
        film_area_width_mm: lineSpec.film_area_width_mm,
        print_capable: lineSpec.print_capable,
        artwork_required: lineSpec.artwork_required,
        artwork_id: lineSpec.artwork_id,
        artwork_code: lineSpec.artwork_code,
        artwork_name: lineSpec.artwork_name,
        artwork_print_type: lineSpec.artwork_print_type,
        artwork_substrate_mode: lineSpec.artwork_substrate_mode,
        artwork_front_colors_count: lineSpec.artwork_front_colors_count,
        artwork_back_colors_count: lineSpec.artwork_back_colors_count,
        artwork_ink_gsm_total: lineSpec.artwork_ink_gsm_total,
        child_target_width_mm: lineSpec.child_target_width_mm,
        layers: lineSpec.layers.map((l) => ({ ...l })),
        adhesive: { ...normalizeLineSpecForRules(lineSpec).adhesive },
        ink: { ...normalizeLineSpecForRules(lineSpec).ink },
        addons: lineSpec.addons.map((a) => ({ ...a })),
        features: {},
      };
      onChange({
        ...item,
        spec_snapshot: lineSpecToSpecSnapshot(lineSpec, baseline),
      });
    },
    onError: (e: Error) =>
      toast({
        title: "Promote failed",
        description: e.message,
        variant: "destructive",
      }),
  });

  // ── Handlers ───────────────────────────────────────────────────────────

  const handleSpecChange = (next: LineSpecValue) => {
    const normalized = normalizeLineSpecForRules(next);
    onChange({
      ...item,
      spec_snapshot: lineSpecToSpecSnapshot(normalized, masterSnapshot),
    });
  };

  const handleResetToMaster = () => {
    if (!masterSnapshot) return;
    const resetSpec: LineSpecValue = {
      ...lineSpec,
      width_mm: Number(masterSnapshot.width_mm ?? lineSpec.width_mm),
      height_mm: Number(masterSnapshot.height_mm ?? lineSpec.height_mm),
      gusset_mm: Number(masterSnapshot.gusset_mm ?? lineSpec.gusset_mm),
      flap_mm: Number(masterSnapshot.flap_mm ?? lineSpec.flap_mm),
      pouch_style_id: masterSnapshot.pouch_style_id || lineSpec.pouch_style_id,
      pouch_style_code:
        masterSnapshot.pouch_style_code || lineSpec.pouch_style_code,
      pouch_style_roll_axis:
        masterSnapshot.pouch_style_roll_axis || lineSpec.pouch_style_roll_axis,
      stock_form: masterSnapshot.stock_form || lineSpec.stock_form,
      width_basis: masterSnapshot.width_basis || lineSpec.width_basis,
      film_area_width_mm:
        masterSnapshot.film_area_width_mm ?? lineSpec.film_area_width_mm,
      print_capable: masterSnapshot.print_capable ?? lineSpec.print_capable,
      artwork_required:
        masterSnapshot.artwork_required ?? lineSpec.artwork_required,
      artwork_id: masterSnapshot.artwork_id ?? lineSpec.artwork_id,
      artwork_code: masterSnapshot.artwork_code ?? lineSpec.artwork_code,
      artwork_name: masterSnapshot.artwork_name ?? lineSpec.artwork_name,
      artwork_print_type:
        masterSnapshot.artwork_print_type ?? lineSpec.artwork_print_type,
      artwork_substrate_mode:
        masterSnapshot.artwork_substrate_mode ?? lineSpec.artwork_substrate_mode,
      artwork_front_colors_count:
        masterSnapshot.artwork_front_colors_count ??
        lineSpec.artwork_front_colors_count,
      artwork_back_colors_count:
        masterSnapshot.artwork_back_colors_count ??
        lineSpec.artwork_back_colors_count,
      artwork_ink_gsm_total:
        masterSnapshot.artwork_ink_gsm_total ?? lineSpec.artwork_ink_gsm_total,
      child_target_width_mm:
        masterSnapshot.child_target_width_mm ?? lineSpec.child_target_width_mm,
      layers: (masterSnapshot.layers || []).map((l) => ({ ...l })),
      adhesive: masterSnapshot.adhesive
        ? { ...masterSnapshot.adhesive }
        : lineSpec.adhesive,
      ink: masterSnapshot.ink ? { ...masterSnapshot.ink } : lineSpec.ink,
      addons: (masterSnapshot.addons || []).map((a) => ({ ...a })),
      features: {},
    };
    handleSpecChange(resetSpec);
  };

  const handleCatalogPick = (sel: CatalogPickerSelection | null) => {
    if (!sel) {
      onChange({
        ...item,
        line_name: item.line_kind === "AD_HOC" ? item.line_name : "Catalog line",
        spec_snapshot:
          item.line_kind === "AD_HOC"
            ? {
                ...(item.spec_snapshot || {}),
                base_product_master_id: undefined,
                base_product_master_code: undefined,
                base_product_master_name: undefined,
                base_size_id: undefined,
                base_size_code: undefined,
                base_size_label: undefined,
                pouch_style_id: undefined,
                pouch_style_code: undefined,
                pouch_style_roll_axis: undefined,
                stock_form: undefined,
                width_basis: undefined,
                film_area_width_mm: undefined,
                print_capable: undefined,
                artwork_required: undefined,
                child_web_width_mm: undefined,
                flap_mm: undefined,
                master_snapshot: undefined,
              }
            : {},
      });
      setBomData(null);
      return;
    }
    if (item.line_kind === "AD_HOC") {
      const current = (item.spec_snapshot || {}) as QuoteLineSpec;
      const nextName =
        item.line_name && item.line_name !== "Ad-hoc pouch"
          ? item.line_name
          : sel.size_label
            ? `New ${sel.product_master_name} · ${sel.size_label}`
            : `New ${sel.product_master_name}`;
      onChange({
        ...item,
        line_name: nextName,
        uom: (sel.qty_uom as DraftItem["uom"]) || item.uom,
        spec_snapshot: {
          ...current,
          product_master_id: undefined,
          product_master_code: undefined,
          product_master_name: undefined,
          size_id: undefined,
          size_code: undefined,
          size_label: undefined,
          base_product_master_id: sel.product_master_id,
          base_product_master_code: sel.product_master_code,
          base_product_master_name: sel.product_master_name,
          base_size_id: sel.size_id || undefined,
          base_size_code: sel.size_code || undefined,
          base_size_label: sel.size_label || undefined,
          pouch_style_id: sel.pouch_style_id || undefined,
          pouch_style_code: sel.pouch_style_code || undefined,
          pouch_style_roll_axis: sel.pouch_style_roll_axis || undefined,
          stock_form: sel.stock_form || undefined,
          width_basis: sel.width_basis || undefined,
          film_area_width_mm: sel.film_area_width_mm || undefined,
          print_capable: undefined,
          artwork_required: undefined,
          child_web_width_mm: sel.child_target_width_mm || undefined,
          width_mm: sel.width_mm || current.width_mm,
          height_mm: sel.height_mm || current.height_mm,
          gusset_mm: sel.gusset_mm || current.gusset_mm,
          flap_mm: sel.flap_mm || current.flap_mm,
          save_as_master: current.save_as_master !== false,
        },
      });
      return;
    }
    // Set PM + size geometry; the bomMut effect picks up the new PM id and hydrates the rest.
    onChange({
      ...item,
      line_name: sel.size_label
        ? `${sel.product_master_name} · ${sel.size_label}`
        : sel.product_master_name,
      uom: (sel.qty_uom as DraftItem["uom"]) || item.uom,
      spec_snapshot: {
        ...(item.spec_snapshot || {}),
        product_master_id: sel.product_master_id,
        product_master_code: sel.product_master_code,
        product_master_name: sel.product_master_name,
        size_id: sel.size_id || undefined,
        size_code: sel.size_code || undefined,
        size_label: sel.size_label || undefined,
        pouch_style_id: sel.pouch_style_id || undefined,
        pouch_style_code: sel.pouch_style_code || undefined,
        pouch_style_roll_axis: sel.pouch_style_roll_axis || undefined,
        stock_form: sel.stock_form || undefined,
        width_basis: sel.width_basis || undefined,
        film_area_width_mm: sel.film_area_width_mm || undefined,
        print_capable: undefined,
        artwork_required: undefined,
        child_web_width_mm: sel.child_target_width_mm || undefined,
        width_mm:
          sel.width_mm || (item.spec_snapshot as QuoteLineSpec).width_mm,
        height_mm:
          sel.height_mm || (item.spec_snapshot as QuoteLineSpec).height_mm,
        gusset_mm:
          sel.gusset_mm || (item.spec_snapshot as QuoteLineSpec).gusset_mm,
        flap_mm:
          sel.flap_mm || (item.spec_snapshot as QuoteLineSpec).flap_mm,
      },
    });
  };

  const kindBadge =
    item.line_kind === "AD_HOC" ? (
      <span className="inline-flex items-center gap-1 h-5 px-2 rounded-full text-[9px] font-extrabold uppercase tracking-widest bg-order-bg text-order-fg ring-1 ring-order-border">
        <Wand2 className="h-3 w-3" strokeWidth={2.5} />
        Ad-hoc
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 h-5 px-2 rounded-full text-[9px] font-extrabold uppercase tracking-widest bg-success-bg text-success-fg ring-1 ring-success-border">
        <Package className="h-3 w-3" strokeWidth={2.5} />
        Catalog
      </span>
    );

  const lineTotal = item.qty * item.rate;
  const stripText = bomStripText(
    lineSpec as unknown as QuoteLineSpec & {
      features?: Record<string, boolean>;
    },
  );
  const costing = item.costing_snapshot as
    | {
        material_cost_per_kg?: number;
        conversion_cost_per_kg?: number;
        total_cost_per_kg?: number;
        margin_pct?: number;
        margin_source?: string;
        suggested_rate?: number;
        breakdown?: CostingResult["breakdown"];
        warnings?: string[];
        is_indicative?: boolean;
      }
    | undefined;
  const totalCost = Number(costing?.total_cost_per_kg || 0);
  const margin = Number(costing?.margin_pct || item.margin_pct || 0);
  const adHocNeedsBase =
    item.line_kind === "AD_HOC" && !lineSpec.base_product_master_id;

  return (
    <div className="rounded-2xl bg-surface-1 ring-1 ring-line shadow-[0_18px_42px_-34px_rgba(15,23,42,0.32)] overflow-hidden">
      {/* Compact row */}
      <div className="px-4 py-3 flex items-center gap-3">
        <button
          onClick={onToggle}
          className="h-7 w-7 inline-flex items-center justify-center rounded-lg text-content-3 hover:bg-surface-2"
          aria-label={isOpen ? "Collapse line" : "Expand line"}
        >
          <ChevronDown
            className={cn(
              "h-4 w-4 transition-transform",
              isOpen ? "rotate-180" : "rotate-0",
            )}
            strokeWidth={2.5}
          />
        </button>
        <span className="font-mono text-[11px] font-extrabold text-content-4 w-8 text-center">
          #{item.line_no}
        </span>
        {kindBadge}
        <div className="flex-1 min-w-0">
          <input
            value={item.line_name}
            onChange={(e) => onChange({ ...item, line_name: e.target.value })}
            className="w-full text-sm font-extrabold text-content-1 bg-transparent outline-none truncate"
            placeholder="Line name"
          />
          {stripText ? (
            <div className="mt-0.5 text-[10px] font-bold font-mono text-content-3 truncate">
              {stripText}
            </div>
          ) : null}
        </div>
        {item.line_kind === "CATALOG" && modifiedFields.length > 0 ? (
          <span className="inline-flex items-center h-5 px-2 rounded-full text-[10px] font-extrabold uppercase tracking-widest bg-warning-bg text-warning-fg ring-1 ring-warning-border">
            Modified · {modifiedFields.length}
          </span>
        ) : null}
        {item.line_kind === "CATALOG" &&
        masterSnapshot &&
        modifiedFields.length === 0 ? (
          <span className="inline-flex items-center h-5 px-2 rounded-full text-[10px] font-extrabold uppercase tracking-widest bg-success-bg text-success-fg ring-1 ring-success-border">
            Master
          </span>
        ) : null}
        <div className="hidden md:flex items-center gap-2">
          <div className="font-mono text-xs font-bold text-content-3">
            QTY <span className="text-content-1">{inr(item.qty)}</span>{" "}
            {item.uom}
          </div>
          <div className="font-mono text-xs font-bold text-content-3">
            ₹ <span className="text-content-1">{inr(item.rate)}</span>
          </div>
          <div className="font-mono text-xs font-extrabold text-content-1">
            ₹ {inr(lineTotal)}
          </div>
        </div>
        {item.margin_pct !== null && item.margin_pct !== undefined ? (
          <span className="inline-flex items-center h-5 px-2 rounded-full text-[10px] font-extrabold uppercase tracking-widest bg-order-bg text-order-fg ring-1 ring-order-border font-mono">
            {inr(item.margin_pct)}%
          </span>
        ) : null}
        <button
          onClick={onDuplicate}
          className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-content-4 hover:text-content-2 hover:bg-surface-2"
          title="Duplicate line"
        >
          <CopyIcon className="h-4 w-4" />
        </button>
        <button
          onClick={onRemove}
          className="h-8 w-8 inline-flex items-center justify-center rounded-lg text-content-4 hover:text-danger-fg hover:bg-danger-bg"
          title="Remove line"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      {/* Expanded body */}
      {isOpen ? (
        <div className="border-t border-line p-4 bg-surface-2 space-y-4">
          {/* Price/cost ribbon */}
          <div className="rounded-xl bg-gradient-to-r from-order-fg via-order-fg to-order-fg text-white p-3 flex flex-wrap items-center gap-3 shadow-[0_18px_42px_-30px_rgba(99,102,241,0.6)]">
            <RibbonStat label="Cost ₹/kg" value={`₹ ${inr(totalCost)}`} />
            <RibbonStat label="Rate ₹/kg" value={`₹ ${inr(item.rate)}`} />
            <RibbonStat label="Margin" value={`${inr(margin)}%`} />
            <RibbonStat label="Line total" value={`₹ ${inr(lineTotal)}`} />
            {costing?.margin_source ? (
              <span className="ml-auto inline-flex items-center h-6 px-2.5 rounded-full text-[10px] font-extrabold uppercase tracking-widest bg-surface-1/15 ring-1 ring-surface-1/25">
                Margin: {costing.margin_source}
              </span>
            ) : null}
            {previewMut.isPending ? (
              <Loader2 className="h-4 w-4 text-white/80 animate-spin" />
            ) : null}
          </div>

          <CatalogLinePicker
            title={
              item.line_kind === "AD_HOC"
                ? "Base Product Master"
                : "Product Master"
            }
            helper={
              item.line_kind === "AD_HOC"
                ? "Pick the closest current master to copy layer stack, route, feature defaults, and costing context. The final size and BOM remain editable for this quote."
                : "Pick the current Product Master and one of its saved sizes for a repeat quotation."
            }
            sizeTitle={
              item.line_kind === "AD_HOC" ? "Starting size" : "Saved size"
            }
            sizeHelper={
              item.line_kind === "AD_HOC"
                ? "Optional. A size only seeds dimensions; it is not reused as the final Product Master size."
                : undefined
            }
            valuePmId={
              item.line_kind === "AD_HOC"
                ? ((item.spec_snapshot as { base_product_master_id?: string })
                    .base_product_master_id || null)
                : ((item.spec_snapshot as { product_master_id?: string })
                    .product_master_id || null)
            }
            valuePmCode={
              item.line_kind === "AD_HOC"
                ? ((item.spec_snapshot as { base_product_master_code?: string })
                    .base_product_master_code || null)
                : ((item.spec_snapshot as { product_master_code?: string })
                    .product_master_code || null)
            }
            valuePmName={
              item.line_kind === "AD_HOC"
                ? ((item.spec_snapshot as { base_product_master_name?: string })
                    .base_product_master_name || null)
                : ((item.spec_snapshot as { product_master_name?: string })
                    .product_master_name ||
                  item.line_name ||
                  null)
            }
            valueSizeId={
              item.line_kind === "AD_HOC"
                ? ((item.spec_snapshot as { base_size_id?: string })
                    .base_size_id || null)
                : ((item.spec_snapshot as { size_id?: string }).size_id ||
                  null)
            }
            onChange={handleCatalogPick}
          />

          {adHocNeedsBase ? (
            <div className="rounded-xl border border-order-border bg-order-bg p-4">
              <div className="text-[11px] font-extrabold uppercase tracking-widest text-order-fg">
                Start with Product Master layer stack
              </div>
              <div className="mt-1 text-[12px] font-semibold text-content-2">
                Pick a current base Product Master above. The quote will copy its
                route, film stack, ink/addon defaults, and rates first; then you
                can select a new approved pouch style and edit this quote line.
              </div>
            </div>
          ) : (
            <>
          {item.line_kind === "AD_HOC" ? (
            <div className="rounded-xl border border-order-border bg-order-bg p-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-[11px] font-extrabold uppercase tracking-widest text-order-fg">
                  New product promotion
                </div>
                <div className="mt-1 text-[12px] font-semibold text-content-2">
                  When this quote is converted, create a current Product Master
                  and a saved size from this custom pouch spec.
                </div>
              </div>
              <label className="inline-flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-widest text-order-fg">
                <input
                  type="checkbox"
                  checked={lineSpec.save_as_master !== false}
                  onChange={(e) =>
                    handleSpecChange({
                      ...lineSpec,
                      save_as_master: e.target.checked,
                    })
                  }
                />
                Save as Product Master
              </label>
            </div>
          ) : null}

          {/* Variance ribbon — catalog only, only after master_snapshot attached */}
          {item.line_kind === "CATALOG" && masterSnapshot ? (
            <VarianceRibbon
              modifiedFields={modifiedFields}
              masterCode={
                (item.spec_snapshot as { product_master_code?: string })
                  .product_master_code || undefined
              }
              onReset={handleResetToMaster}
              onPromote={() => {
                const pmId = (
                  item.spec_snapshot as { product_master_id?: string }
                ).product_master_id;
                if (pmId) promoteMut.mutate(pmId);
              }}
              canPromote={modifiedFields.length > 0 && !promoteMut.isPending}
            />
          ) : null}

          {/* Builder + Right rail (cost + production preview) */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
            <div>
              <LineSpecBuilder
                value={lineSpec}
                onChange={handleSpecChange}
                catalogAddons={bomData?.addons || []}
                modifiedPaths={modifiedPaths}
              />

              <MaterialBreakdownPanel
                spec={lineSpec}
                breakdown={costing?.breakdown || null}
                materialCostPerKg={Number(costing?.material_cost_per_kg || 0)}
              />

              {/* Qty + UOM */}
              <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3 rounded-xl border border-line bg-surface-1 p-3">
                <label className="block">
                  <span className="text-[10px] font-extrabold uppercase tracking-widest text-content-3">
                    Quantity
                  </span>
                  <input
                    type="number"
                    value={item.qty}
                    onChange={(e) =>
                      onChange({ ...item, qty: Number(e.target.value) })
                    }
                    className="mt-1 h-10 w-full rounded-lg border border-line px-3 text-sm font-bold font-mono text-right outline-none focus:border-order-border focus:ring-2 focus:ring-order-border"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] font-extrabold uppercase tracking-widest text-content-3">
                    UOM
                  </span>
                  <select
                    value={item.uom}
                    onChange={(e) =>
                      onChange({
                        ...item,
                        uom: e.target.value as DraftItem["uom"],
                      })
                    }
                    className="mt-1 h-10 w-full rounded-lg border border-line px-3 text-sm font-bold outline-none focus:border-order-border focus:ring-2 focus:ring-order-border"
                  >
                    <option value="KG">KG</option>
                    <option value="PCS">PCS</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-[10px] font-extrabold uppercase tracking-widest text-content-3">
                    Rate ₹
                  </span>
                  <input
                    type="number"
                    value={Number(item.rate) || ""}
                    onChange={(e) =>
                      onChange({
                        ...item,
                        rate: Number(e.target.value),
                        margin_lock: false,
                      })
                    }
                    className="mt-1 h-10 w-full rounded-lg border border-line px-3 text-sm font-bold font-mono text-right outline-none focus:border-order-border focus:ring-2 focus:ring-order-border"
                  />
                </label>
                <div>
                  <div className="text-[10px] font-extrabold uppercase tracking-widest text-content-3">
                    Line total
                  </div>
                  <div className="mt-1 h-10 inline-flex items-center font-mono font-extrabold text-content-1">
                    ₹ {inr(lineTotal)}
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <CostingRail
                result={
                  costing
                    ? ({
                        material_cost_per_kg: costing.material_cost_per_kg || 0,
                        conversion_cost_per_kg:
                          costing.conversion_cost_per_kg || 0,
                        total_cost_per_kg: costing.total_cost_per_kg || 0,
                        margin_pct: costing.margin_pct || 0,
                        margin_source:
                          (costing.margin_source as CostingResult["margin_source"]) ||
                          "COMPANY_DEFAULT",
                        suggested_rate: costing.suggested_rate || 0,
                        is_indicative: Boolean(costing.is_indicative),
                        warnings: costing.warnings || [],
                        breakdown:
                          (costing.breakdown as CostingResult["breakdown"]) || {
                            materials: [],
                            conversion: [],
                          },
                      } as CostingResult)
                    : null
                }
                isLoading={previewMut.isPending}
                marginLock={item.margin_lock}
                onToggleLock={(v) => onChange({ ...item, margin_lock: v })}
                manualMargin={Number(item.margin_pct || 25)}
                onManualMargin={(v) =>
                  onChange({ ...item, margin_pct: v, margin_lock: true })
                }
                manualRate={item.rate}
                onManualRate={(v) =>
                  onChange({ ...item, rate: v, margin_lock: false })
                }
                floorMargin={
                  costing?.margin_source && costing.margin_source !== "MANUAL"
                    ? Number(costing.margin_pct || 0)
                    : null
                }
                floorSource={costing?.margin_source || null}
              />

              <ProductionPreviewCard
                spec={lineSpecToBackendSpec(lineSpec)}
                plantId={plantId}
                qty={item.qty}
                qtyUom={item.uom}
              />

              {costing?.margin_source === "CUSTOMER" ? (
                <div className="rounded-xl border border-success-border bg-success-bg p-3 text-[11px] font-bold text-success-fg">
                  <div className="text-[10px] font-extrabold uppercase tracking-widest text-success-fg mb-1">
                    Customer overlay applied
                  </div>
                  Margin floor of {inr(costing.margin_pct)}% comes from a
                  customer-specific product overlay. Override only with
                  approval.
                </div>
              ) : null}
            </div>
          </div>
            </>
          )}

          {/* Save / remove */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-line">
            {canPersist && onSaveLine ? (
              <button
                onClick={onSaveLine}
                className="h-9 px-3 inline-flex items-center gap-2 rounded-lg bg-order-fg text-white font-extrabold text-xs uppercase tracking-widest hover:bg-order-fg"
              >
                <Save className="h-3.5 w-3.5" />
                Save line
              </button>
            ) : null}
            <button
              onClick={onRemove}
              className="h-9 px-3 inline-flex items-center gap-2 rounded-lg text-danger-fg hover:bg-danger-bg font-bold text-xs uppercase tracking-widest"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Remove
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RibbonStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[9px] font-extrabold uppercase tracking-widest text-white/70">
        {label}
      </div>
      <div className="font-mono text-base font-extrabold">{value}</div>
    </div>
  );
}

function MaterialBreakdownPanel({
  spec,
  breakdown,
  materialCostPerKg,
}: {
  spec: LineSpecValue;
  breakdown: CostingResult["breakdown"] | null;
  materialCostPerKg: number;
}) {
  const liveRows = breakdown?.materials || [];
  const fallbackRows = useMemo(() => {
    const totalGsm =
      (spec.layers || []).reduce((sum, layer) => sum + Number(layer.gsm || 0), 0) +
      ((spec.layers || []).length > 1 ? Number(spec.adhesive?.gsm || 0) : 0) +
      (spec.print_capable ? Number(spec.ink?.gsm || 0) : 0);
    const gsmContribution = (gsm: number, rate: number) =>
      totalGsm > 0 ? (Number(gsm || 0) / totalGsm) * Number(rate || 0) : 0;
    const rows: Array<{
      kind: string;
      name: string;
      usage: string;
      contribution_per_kg?: number;
    }> = [];
    for (const layer of spec.layers || []) {
      rows.push({
        kind: "FILM",
        name:
          layer.material_name ||
          layer.material_code ||
          layer.position ||
          "Film layer",
        usage: `${inr(layer.micron)} µ · ${inr(layer.gsm)} gsm`,
        contribution_per_kg: gsmContribution(
          Number(layer.gsm || 0),
          Number(layer.rate_per_kg || 0),
        ),
      });
    }
    if ((spec.layers || []).length > 1 && Number(spec.adhesive?.gsm || 0) > 0) {
      rows.push({
        kind: "ADHESIVE",
        name: spec.adhesive.name || "Adhesive",
        usage: `${inr(spec.adhesive.gsm)} gsm`,
        contribution_per_kg: gsmContribution(
          Number(spec.adhesive.gsm || 0),
          Number(spec.adhesive.rate_per_kg || 0),
        ),
      });
    }
    if (spec.print_capable && Number(spec.ink?.gsm || 0) > 0) {
      rows.push({
        kind: "INK",
        name: spec.ink.name || "Ink",
        usage: `${inr(spec.ink.gsm)} gsm`,
        contribution_per_kg: gsmContribution(
          Number(spec.ink.gsm || 0),
          Number(spec.ink.rate_per_kg || 0),
        ),
      });
    }
    for (const addon of spec.addons || []) {
      rows.push({
        kind: "ADD-ON",
        name: addon.name,
        usage: `${inr(addon.qty_per_pouch || 0)} / pouch`,
        contribution_per_kg:
          Number(addon.rate_per_kg || 0) *
          Number(addon.qty_per_pouch || 1),
      });
    }
    if (spec.optional_inner_pack?.name) {
      rows.push({
        kind: "PACKING",
        name: spec.optional_inner_pack.name,
        usage: spec.optional_inner_pack.pcs_per_inner
          ? `${inr(spec.optional_inner_pack.pcs_per_inner)} pcs / inner`
          : "optional",
        contribution_per_kg: Number(spec.optional_inner_pack.rate_per_kg || 0),
      });
    }
    return rows;
  }, [spec]);

  const rows =
    liveRows.length > 0
      ? liveRows.map((row) => ({
          kind: row.kind || "MAT",
          name: row.name || row.stage || "Material",
          usage:
            row.gsm !== undefined
              ? `${inr(row.gsm)} gsm${
                  row.micron !== undefined ? ` · ${inr(row.micron)} µ` : ""
                }`
              : row.qty_per_pouch !== undefined
                ? `${inr(row.qty_per_pouch)} / pouch${
                    row.unit_rate_per_kg !== undefined
                      ? ` · ₹ ${inr(row.unit_rate_per_kg)}`
                      : ""
                  }`
              : row.scrap_pct !== undefined
                ? `scrap ${inr(row.scrap_pct)}%`
                : "costed",
          contribution_per_kg: row.contribution_per_kg,
        }))
      : fallbackRows;

  return (
    <div className="mt-4 rounded-xl border border-line bg-surface-1 overflow-hidden">
      <div className="border-b border-line px-3 py-2 flex items-center justify-between gap-2">
        <div>
          <div className="text-[11px] font-extrabold uppercase tracking-widest text-content-2">
            Live BOM · material breakdown
          </div>
          <div className="text-[10px] font-bold text-content-4">
            Film, adhesive, ink, add-ons and packing from the current quote spec.
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-order-bg px-2 py-1 text-[10px] font-extrabold uppercase tracking-widest text-order-fg ring-1 ring-order-border">
          ₹ {inr(materialCostPerKg)} / kg
        </span>
      </div>
      {rows.length === 0 ? (
        <div className="p-3 text-[11px] font-bold text-content-4">
          Pick a Product Master, size and material stack to preview the BOM.
        </div>
      ) : (
        <div className="divide-y divide-line">
          {rows.map((row, idx) => (
            <div
              key={`${row.kind}-${row.name}-${idx}`}
              className="grid grid-cols-[82px_1fr_110px_90px] gap-2 px-3 py-2 text-[11px] font-semibold"
            >
              <span className="font-mono text-[10px] font-extrabold uppercase tracking-widest text-content-4">
                {row.kind}
              </span>
              <span className="truncate text-content-2">{row.name}</span>
              <span className="font-mono text-right text-content-3">
                {row.usage}
              </span>
              <span className="font-mono text-right font-extrabold text-content-1">
                ₹ {inr(row.contribution_per_kg)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

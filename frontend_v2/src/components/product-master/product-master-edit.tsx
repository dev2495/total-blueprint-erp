"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Boxes,
  CheckCircle2,
  Disc,
  Loader2,
  Package,
  Palette,
  Plus,
  Save,
  Trash2,
  Workflow,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  ValidationFooter,
  type CheckLine,
} from "@/components/erp/validation-footer";
import {
  RichHero,
  RichSection,
  PouchStylePicker,
  LayerStatePill,
} from "@/components/product-master/pm-edit-shell";
import { LiveBomRail } from "@/components/erp/live-bom-rail";
import { ProductVisual } from "@/components/erp/product-visual";
import { RouteTimeline } from "@/components/erp/route-timeline";
import { templateService } from "@/services/templates";
import {
  masterDataService,
  type Material,
  type PackagingMaterial,
  type PodSkuVariant,
  type Addon,
} from "@/services/master-data";
import { recipeService } from "@/services/recipes";
import { engineeringService, type Artwork } from "@/services/engineering";
import {
  autoRollWidthMm,
  resolveProductOutputKind,
} from "@/lib/product-geometry";
import { ProductSizeWorkspace } from "@/components/product-master/size-workspace";
import {
  productMasterService,
  type LayerTemplateRow,
  type PreviewBomRequest,
  type ProductKind,
  type ProductMaster,
  type ProductMasterSize,
  type ReportingGroup,
  type VariantAxisDef,
} from "@/services/product-master";
import {
  LayerAllowedGradePicker,
  LayerDefaultGradeSelect,
  LayerThicknessSelect,
  gradeOptionsForLayer,
  sanitizeLayerForFilm,
} from "@/components/product-master/layer-master-controls";

interface ProductMasterEditWorkspaceProps {
  productId: string;
}

const REPORTING_GROUPS: ReportingGroup[] = [
  "FILM",
  "PRINTED",
  "LAMINATED",
  "SEMI_FG",
  "FG",
  "PACKAGING",
  "POD",
  "OTHER",
];

const AXIS_DEFS: VariantAxisDef[] = [
  { axis: "size", type: "geometry", required: true, label: "Size / geometry" },
  {
    axis: "layer_thicknesses",
    type: "per_layer_number",
    label: "Per-layer thickness",
  },
  { axis: "layer_grades", type: "per_layer_enum", label: "Per-layer grade" },
  {
    axis: "layer_widths",
    type: "per_layer_number",
    label: "Roll width override",
  },
  { axis: "addons", type: "multi_enum", label: "Add-ons" },
  {
    axis: "packaging_inner",
    type: "catalog_ref",
    label: "Inner packaging",
    master_data_source: "packaging_material",
    master_data_filter: { packaging_kind: "INNER_POUCH" },
  },
  // packaging_outer dropped — outer packing is no longer on the master; packing yard ticks it per order at EOD.
  {
    axis: "pod_variant",
    type: "catalog_ref",
    label: "POD variant",
    master_data_source: "pod_sku_variant",
  },
  { axis: "artwork_mode", type: "enum", label: "Artwork mode" },
];

/**
 * Legacy axes that still live in some older masters / older seed data:
 * - `pod` → canonical `pod_variant`
 * - `packaging` → canonical `packaging_inner`
 * Map any axis the master stored under a legacy key to its canonical equivalent
 * so the edit tri-state shows the right state (and patches the right row).
 */
const AXIS_ALIAS: Record<string, string> = {
  pod: "pod_variant",
  pod_ref: "pod_variant",
  packaging: "packaging_inner",
  packaging_ref: "packaging_inner",
};

function canonicalAxisKey(axisKey: string): string {
  return AXIS_ALIAS[axisKey] || axisKey;
}

const PRODUCTION_MASTER_CATALOG_AXES = new Set([
  "packaging_inner",
  "packaging_outer",
  "packaging",
  "pod_variant",
  "addons",
]);

function isProductionMasterKind(kind?: string | null): boolean {
  const normalized = String(kind || "").toUpperCase();
  return normalized === "PACKAGING" || normalized === "POD";
}

function isRollLikeOutput(
  kind?: string | null,
  packagingKind?: string | null,
  fixedFgType?: string | null,
): boolean {
  return resolveProductOutputKind(kind, packagingKind, fixedFgType) === "ROLL";
}

function normalizePrintType(value: unknown): "FLEXO" | "ROTO" {
  const raw = String(value || "").trim().toUpperCase();
  return raw === "ROTO" ? "ROTO" : "FLEXO";
}

function substrateModeFromStockForm(value: unknown): "SHEET" | "TUBING" {
  const raw = String(value || "").trim().toUpperCase();
  if (raw === "TUBING") return "TUBING";
  if (raw === "SHEET") return "SHEET";
  if (
    raw.includes("TUBE") ||
    raw.includes("TUBING") ||
    raw.includes("LAYFLAT")
  ) {
    return "TUBING";
  }
  return "SHEET";
}

function substrateModeForSize(size: ProductMasterSize): "SHEET" | "TUBING" {
  return substrateModeFromStockForm(
    size.stock_form || size.roll_form || size.width_basis,
  );
}

function artworkSubstrateModesForDraft(
  draft: ProductMaster,
  sizes: ProductMasterSize[],
): Set<"SHEET" | "TUBING"> {
  const activeSizes = sizes.filter((size) => size.active !== false);
  const modes = new Set<"SHEET" | "TUBING">();
  activeSizes.forEach((size) => {
    if (size.stock_form || size.roll_form || size.width_basis) {
      modes.add(substrateModeForSize(size));
    }
  });
  if (modes.size) return modes;
  const fixed = draft.fixed_attributes || {};
  modes.add(
    substrateModeFromStockForm(
      fixed.stock_form ||
        fixed.default_stock_form ||
        fixed.pouch_style_stock_form ||
        fixed.pouch_style_default_stock_form ||
        fixed.roll_form ||
        fixed.substrate_mode ||
        fixed.film_type,
    ),
  );
  return modes;
}

function resolveArtworkSubstrateMode(
  draft: ProductMaster,
  sizes: ProductMasterSize[],
): "SHEET" | "TUBING" {
  const modes = artworkSubstrateModesForDraft(draft, sizes);
  if (modes.size === 1 && modes.has("TUBING")) return "TUBING";
  return "SHEET";
}

function hasMixedArtworkSubstrateModes(
  draft: ProductMaster,
  sizes: ProductMasterSize[],
): boolean {
  return artworkSubstrateModesForDraft(draft, sizes).size > 1;
}

function artworkCompatibleWithPrintContext(
  artwork: Artwork,
  printType: "FLEXO" | "ROTO",
  substrateMode: "SHEET" | "TUBING",
) {
  if (String(artwork.status || "").toUpperCase() !== "APPROVED") return false;
  return (
    normalizePrintType(artwork.print_type) === printType &&
    substrateModeFromStockForm(artwork.substrate_mode) === substrateMode
  );
}

function normalizeLayerRow(row: any, index: number): LayerTemplateRow {
  const filmCode = String(
    row?.film_variant_code ||
      row?.material_code ||
      row?.code ||
      row?.name ||
      "",
  ).trim();
  return {
    role: row?.role || row?.layer_role || row?.layer || `layer-${index + 1}`,
    film_variant_code: filmCode,
    film_variant_id: row?.film_variant_id || row?.material_id || null,
    thickness_micron: Number(
      row?.thickness_micron ?? row?.thickness_um ?? row?.micron ?? 0,
    ),
    thickness_options: Array.isArray(row?.thickness_options)
      ? row.thickness_options
      : [],
    default_grade: String(
      row?.default_grade || row?.grade || row?.grade_name || "",
    ).trim(),
    grade_options: Array.isArray(row?.grade_options) ? row.grade_options : [],
    grade_apportion: row?.grade_apportion || row?.grade_mode || "fixed",
    thickness_apportion: row?.thickness_apportion || "fixed_um",
    default_input_roll_width_mm:
      row?.default_input_roll_width_mm ?? row?.roll_width_mm ?? null,
    notes: row?.notes || "",
  };
}

function normalizeProductMasterDraft(master: ProductMaster): ProductMaster {
  const rows = Array.isArray(master.layer_template)
    ? master.layer_template
    : [];
  const layerTemplate = rows.map((row, index) => normalizeLayerRow(row, index));
  const canonicalRows =
    Array.isArray(master.canonical_layer_stack) &&
    master.canonical_layer_stack.length
      ? master.canonical_layer_stack.map((row, index) =>
          normalizeLayerRow(row, index),
        )
      : layerTemplate;
  return {
    ...master,
    layer_template: layerTemplate,
    canonical_layer_stack: canonicalRows,
  };
}

function variantAxesForProductKind(
  kind: string | undefined | null,
  axes: VariantAxisDef[] | undefined,
): VariantAxisDef[] {
  const rows = axes || [];
  const normalized = String(kind || "").toUpperCase();
  if (isProductionMasterKind(normalized)) {
    return rows.filter(
      (axis) =>
        !PRODUCTION_MASTER_CATALOG_AXES.has(
          canonicalAxisKey(String(axis.axis)),
        ),
    );
  }
  if (normalized !== "POUCH") {
    return rows.filter(
      (axis) => canonicalAxisKey(String(axis.axis)) !== "packaging_inner",
    );
  }
  return rows;
}

function findAxisOnDraft(
  axes: VariantAxisDef[] | undefined,
  canonical: string,
): VariantAxisDef | undefined {
  if (!axes) return undefined;
  return axes.find((a) => canonicalAxisKey(String(a.axis)) === canonical);
}

function axisMode(axis: VariantAxisDef | undefined) {
  if (!axis) return "off";
  return axis.required ? "required" : "optional";
}

function axisModeCopy(mode: "off" | "optional" | "required") {
  if (mode === "required") return "Required in sales/planner before submit.";
  if (mode === "optional")
    return "Can be skipped; if entered it becomes part of matching and BOM.";
  return "Not part of this master’s final product tuple.";
}

function firstAxisOption(axis?: VariantAxisDef): string {
  const options = (axis as any)?.options;
  if (!Array.isArray(options)) return "";
  for (const option of options) {
    if (typeof option === "string" || typeof option === "number") {
      const value = String(option || "").trim();
      if (value) return value;
      continue;
    }
    if (option && typeof option === "object") {
      const row = option as Record<string, unknown>;
      const value = String(
        row.code ||
          row.material_code ||
          row.pod_sku_code ||
          row.addon_code ||
          row.id ||
          "",
      ).trim();
      if (value) return value;
    }
  }
  return "";
}

function axisValuePresent(value: any): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object")
    return Object.values(value).some(
      (nested) => nested !== "" && nested !== null && nested !== undefined,
    );
  return value !== "" && value !== null && value !== undefined;
}

function previewAxisValuesForDraft(
  master: ProductMaster | null,
  sizes: ProductMasterSize[],
): Record<string, any> {
  if (!master) return {};
  const size = sizes.find((row) => row.active !== false) || sizes[0];
  const values: Record<string, any> = {};
  if (size?.code) values.size = size.code;
  for (const axis of master.variant_axes || []) {
    const key = String(axis.axis || "");
    const canonical = canonicalAxisKey(key);
    if (!key || canonical === "size") continue;
    if (
      isProductionMasterKind(master.product_kind) &&
      PRODUCTION_MASTER_CATALOG_AXES.has(canonical)
    )
      continue;
    if (canonical === "layer_thicknesses") {
      values[key] = Object.fromEntries(
        master.layer_template.map((row, idx) => [
          String(idx + 1),
          row.thickness_micron,
        ]),
      );
      continue;
    }
    if (canonical === "layer_grades") {
      const allowed = new Set(
        (Array.isArray((axis as any).options) ? (axis as any).options : [])
          .map((option: unknown) => String(option || "").trim())
          .filter(Boolean),
      );
      const gradeEntries = master.layer_template
        .map(
          (row, idx) =>
            [String(idx + 1), String(row.default_grade || "").trim()] as const,
        )
        .filter(([, grade]) => grade && (!allowed.size || allowed.has(grade)));
      if (gradeEntries.length) values[key] = Object.fromEntries(gradeEntries);
      continue;
    }
    if (canonical === "layer_widths") {
      values[key] = Object.fromEntries(
        master.layer_template.map((row, idx) => [
          String(idx + 1),
          row.default_input_roll_width_mm ||
            size?.roll_width_mm ||
            size?.width_mm ||
            0,
        ]),
      );
      continue;
    }
    if (canonical === "addons") {
      values[key] = [];
      continue;
    }
    const suggested = String(
      (axis as any).default_value || firstAxisOption(axis) || "",
    );
    if (suggested) values[key] = suggested;
  }
  return values;
}

function previewPackagingSnapshotFromFixed(fixed: Record<string, any>) {
  const podVariant =
    fixed?.pod_variant ||
    fixed?.pod_variant_id ||
    fixed?.pod_variant_code ||
    "";
  return {
    primary_inner_pack: fixed?.primary_inner_pack || {},
    packaging_lines: Array.isArray(fixed?.packaging_lines)
      ? fixed.packaging_lines
      : [],
    pod: fixed?.pod_enabled
      ? {
          enabled: true,
          pod_sku_variant_id: podVariant,
          pod_variant: podVariant,
          pod_sku_code: fixed?.pod_variant_code || "",
        }
      : { enabled: false },
  };
}

export function ProductMasterEditWorkspace({
  productId,
}: ProductMasterEditWorkspaceProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: master, isLoading } = useQuery({
    queryKey: ["product-master", productId],
    queryFn: () => productMasterService.get(productId),
  });
  const { data: sizes } = useQuery({
    queryKey: ["product-master-sizes", productId],
    queryFn: () => productMasterService.listSizes(productId),
    enabled: !!productId,
  });
  const { data: templates = [] } = useQuery({
    queryKey: ["templates", "live"],
    queryFn: () => templateService.getLiveTemplateOptions(),
    staleTime: 5 * 60_000,
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 5000),
    meta: { suppressGlobalError: true },
  });
  const effectiveTemplateId =
    master?.template || master?.default_template || null;
  const { data: routeInfo } = useQuery({
    queryKey: ["product-master-template", productId, effectiveTemplateId],
    queryFn: () => productMasterService.getTemplate(productId),
    enabled: !!productId && !!effectiveTemplateId,
    staleTime: 60_000,
  });
  const { data: filmVariants = [] } = useQuery({
    queryKey: ["master-film-variants"],
    queryFn: masterDataService.getFilmVariants,
    staleTime: 60_000,
  });
  const { data: grades = [] } = useQuery({
    queryKey: ["recipe-grades"],
    queryFn: () => recipeService.getGrades(),
    staleTime: 60_000,
  });
  const { data: recipes = [] } = useQuery({
    queryKey: ["extrusion-recipes", "active"],
    queryFn: () => recipeService.getAll({ is_active: true }),
    staleTime: 60_000,
  });
  const { data: packagingMaterials = [] } = useQuery({
    queryKey: ["master-packaging-materials"],
    queryFn: masterDataService.getPackaging,
    staleTime: 60_000,
  });
  const { data: podVariants = [] } = useQuery({
    queryKey: ["master-pod-sku-variants", "active"],
    queryFn: () => masterDataService.getPodSkuVariants({ active: true }),
    staleTime: 60_000,
  });
  const { data: addonCatalog = [] } = useQuery({
    queryKey: ["master-addons"],
    queryFn: masterDataService.getAddons,
    staleTime: 60_000,
  });
  const { data: adhesiveSolvents = [] } = useQuery({
    queryKey: ["master-adhesives-solvents"],
    queryFn: () => masterDataService.getAdhesivesSolvents(),
    staleTime: 60_000,
  });
  // Approved artworks — surfaced as Default fallback artwork picker on the
  // Printing 2-knob card when print_capable=true. Optional; sets
  // fixed_attributes.default_artwork_id which the order flow uses when no
  // customer overlay default and no per-line artwork is provided.
  const { data: approvedArtworks = [] } = useQuery<Artwork[]>({
    queryKey: ["pm-edit-approved-artworks"],
    queryFn: () => engineeringService.getArtworks({ status: "APPROVED" }),
    staleTime: 60_000,
  });

  const [draft, setDraft] = React.useState<ProductMaster | null>(null);
  const [draftSizes, setDraftSizes] = React.useState<ProductMasterSize[]>([]);

  React.useEffect(() => {
    if (master) setDraft(normalizeProductMasterDraft(master));
  }, [master]);
  React.useEffect(() => {
    if (sizes) setDraftSizes(sizes);
  }, [sizes]);

  const visibleVariantAxes = React.useMemo(
    () => variantAxesForProductKind(draft?.product_kind, draft?.variant_axes),
    [draft?.product_kind, draft?.variant_axes],
  );
  const previewAxisValues = React.useMemo(
    () => previewAxisValuesForDraft(draft, draftSizes),
    [draft, draftSizes],
  );
  const livePreviewPayload = React.useMemo<PreviewBomRequest | null>(() => {
    if (!draft || !draftSizes.length || !draft.template) return null;
    const rollLike = isRollLikeOutput(
      draft.product_kind,
      draft.packaging_kind,
      draft.fixed_attributes?.fg_type,
    );
    return {
      product_master: draft.id,
      template_id: draft.template,
      axis_values: previewAxisValues,
      quantity:
        String(draft.product_kind || "").toUpperCase() === "ROLL" ? 1000 : 1000,
      quantity_uom: rollLike ? "KG" : "PCS",
      printing: { enabled: false },
      packaging_snapshot: previewPackagingSnapshotFromFixed(
        draft.fixed_attributes || {},
      ),
    };
  }, [draft, draftSizes.length, previewAxisValues]);
  const livePreviewAxesReady = React.useMemo(() => {
    if (!draft) return false;
    return visibleVariantAxes.every(
      (axis) =>
        !axis.required ||
        axisValuePresent(previewAxisValues[String(axis.axis || "")]),
    );
  }, [draft, previewAxisValues, visibleVariantAxes]);
  const {
    data: livePreview,
    isFetching: livePreviewLoading,
    error: livePreviewError,
  } = useQuery({
    queryKey: [
      "product-master-edit-live-preview",
      productId,
      livePreviewPayload,
    ],
    queryFn: () => productMasterService.previewBom(livePreviewPayload!),
    enabled:
      !!livePreviewPayload &&
      !!previewAxisValues.size &&
      !!draft?.layer_template?.length &&
      livePreviewAxesReady,
    retry: false,
    staleTime: 15_000,
  });

  const updateMutation = useMutation({
    mutationFn: () => {
      if (!draft) throw new Error("Product master draft is not loaded.");
      const codeChanged = Boolean(
        master?.code && draft.code && draft.code !== master.code,
      );
      const sizePayloads = draftSizes.map((size) => {
        const {
          id,
          product_master,
          product_master_code,
          product_master_name,
          created_at,
          updated_at,
          ...payload
        } = size as any;
        return payload;
      });
      return productMasterService.clone(productId, {
        ...(codeChanged ? { code: draft.code } : {}),
        name: draft.name,
        product_kind: draft.product_kind,
        packaging_kind: draft.packaging_kind ?? null,
        template: draft.template,
        default_template: draft.template || draft.default_template || null,
        default_reporting_group: draft.default_reporting_group,
        reusable_policy: draft.reusable_policy,
        layer_template: draft.layer_template,
        canonical_layer_stack: draft.layer_template,
        variant_axes: variantAxesForProductKind(
          draft.product_kind,
          draft.variant_axes,
        ),
        fixed_attributes: draft.fixed_attributes?.print_capable
          ? {
              ...(draft.fixed_attributes || {}),
              print_type: normalizePrintType(draft.fixed_attributes?.print_type),
            }
          : draft.fixed_attributes,
        description: draft.description,
        active: true,
        disable_source: true,
        copy_sizes: false,
        copy_variants: false,
        sizes: sizePayloads,
      });
    },
    onSuccess: async (created) => {
      queryClient.invalidateQueries({
        queryKey: ["product-master", productId],
      });
      queryClient.invalidateQueries({
        queryKey: ["product-master", created.id],
      });
      queryClient.invalidateQueries({
        queryKey: ["product-master-sizes", productId],
      });
      queryClient.invalidateQueries({
        queryKey: ["product-master-sizes", created.id],
      });
      queryClient.invalidateQueries({
        queryKey: ["product-master-template", created.id],
      });
      queryClient.invalidateQueries({ queryKey: ["product-masters"] });
      toast({
        title: "New master version saved",
        description:
          "The previous master was disabled for audit and old orders.",
      });
      router.push(`/master/products/${created.id}`);
    },
    onError: (err: any) => {
      toast({
        title: "Save failed",
        description: err?.message || "Try again",
        variant: "destructive",
      });
    },
  });

  if (isLoading || !draft) {
    return (
      <div className="space-y-3">
        <div className="h-32 animate-pulse rounded-3xl bg-surface-2" />
        <div className="h-72 animate-pulse rounded-2xl bg-surface-2" />
      </div>
    );
  }

  const checks: CheckLine[] = computeChecks(draft, draftSizes, filmVariants);
  const printType = normalizePrintType(draft.fixed_attributes?.print_type);
  const artworkSubstrateMode = resolveArtworkSubstrateMode(draft, draftSizes);
  const mixedArtworkSubstrateModes = hasMixedArtworkSubstrateModes(
    draft,
    draftSizes,
  );
  const compatibleApprovedArtworks = mixedArtworkSubstrateModes
    ? []
    : approvedArtworks.filter((artwork) =>
        artworkCompatibleWithPrintContext(
          artwork,
          printType,
          artworkSubstrateMode,
        ),
      );
  const selectedDefaultArtwork = compatibleApprovedArtworks.find(
    (artwork) =>
      String(artwork.id) === String(draft.fixed_attributes?.default_artwork_id),
  );
  const incompatibleDefaultArtwork =
    draft.fixed_attributes?.default_artwork_id && !selectedDefaultArtwork
      ? approvedArtworks.find(
          (artwork) =>
            String(artwork.id) ===
            String(draft.fixed_attributes?.default_artwork_id),
        ) || null
      : null;
  if (draft.fixed_attributes?.print_capable && incompatibleDefaultArtwork) {
    checks.push({
      label: "Default artwork matches print method + sheet/tube form",
      ok: false,
      tone: "error",
    });
  }
  if (
    draft.fixed_attributes?.print_capable &&
    draft.fixed_attributes?.default_artwork_id &&
    mixedArtworkSubstrateModes
  ) {
    checks.push({
      label: "Master-level default artwork is disabled for mixed SHEET/TUBING sizes",
      ok: false,
      tone: "error",
    });
  }
  const totalThickness = draft.layer_template.reduce(
    (s, l) => s + l.thickness_micron,
    0,
  );
  const errorCount = checks.filter((c) => !c.ok && c.tone !== "warn").length;
  const routeSteps = (routeInfo?.route_steps || []).map((step) => ({
    index: step.index,
    label: step.name || step.process_code || `Step ${step.index}`,
    transition: step.transition,
    tag: step.roll_behavior,
    artwork_step: !!step.has_artwork,
  }));
  const isMultiLayer = draft.layer_template.length > 1;
  const adhesiveOptions = adhesiveSolvents.filter(
    (m: Material) => String(m.category || "").toUpperCase() === "ADHESIVE",
  );
  const solventOptions = adhesiveSolvents.filter(
    (m: Material) => String(m.category || "").toUpperCase() === "SOLVENT",
  );
  const addonsAxisMode = axisMode(
    findAxisOnDraft(draft.variant_axes, "addons"),
  ) as "off" | "optional" | "required";
  const outputKind = resolveProductOutputKind(
    draft.product_kind,
    draft.packaging_kind,
    draft.fixed_attributes?.fg_type,
  );
  const sizeSectionTitle =
    outputKind === "ROLL"
      ? "Roll size · roll width and roll form"
      : outputKind === "POUCH"
        ? "Pouch size · style formula and child web width"
        : "Size setup · choose physical output first";
  const sizeSectionSubtitle =
    outputKind === "ROLL"
      ? "Roll, POD, and packing-sheet masters use roll width directly. No pouch-style or gusset fields are shown."
      : outputKind === "POUCH"
        ? "Pouch masters use the selected pouch-style formula. Only fields allowed by that style are shown; manual override wins when set."
        : "Pick a product output type so the editor can show the correct pouch or roll fields.";

  function patchDraft(patch: Partial<ProductMaster>) {
    setDraft((d) => (d ? { ...d, ...patch } : d));
  }
  function patchFixed(patch: Record<string, any>) {
    setDraft((d) => {
      if (!d) return d;
      const nextFixed = { ...(d.fixed_attributes || {}), ...patch };
      if (nextFixed.print_capable) {
        nextFixed.print_type = normalizePrintType(nextFixed.print_type);
      }
      let nextAxes = d.variant_axes;
      // Keep the artwork_mode axis in sync with the Printing contract toggles
      // so section 4's grid and section 5's switches never disagree:
      // print_capable=false → artwork_mode OFF (removed)
      // print_capable=true, art_req=false → artwork_mode OPTIONAL
      // print_capable=true, art_req=true → artwork_mode REQUIRED
      if ("print_capable" in patch || "artwork_required" in patch) {
        const printOn = !!nextFixed.print_capable;
        const artReq = !!nextFixed.artwork_required;
        const without = nextAxes.filter(
          (a) => canonicalAxisKey(String(a.axis)) !== "artwork_mode",
        );
        if (!printOn) {
          nextAxes = without;
        } else {
          const def = AXIS_DEFS.find((a) => String(a.axis) === "artwork_mode")!;
          nextAxes = [...without, { ...def, required: artReq }];
        }
      }
      return { ...d, fixed_attributes: nextFixed, variant_axes: nextAxes };
    });
  }
  function patchLayer(idx: number, patch: Partial<LayerTemplateRow>) {
    setDraft((d) => {
      if (!d) return d;
      const next = [...d.layer_template];
      next[idx] = { ...next[idx], ...patch };
      return { ...d, layer_template: next };
    });
  }
  function addLayer() {
    setDraft((d) => {
      if (!d) return d;
      return {
        ...d,
        layer_template: [
          ...d.layer_template,
          {
            role: `layer-${d.layer_template.length + 1}`,
            film_variant_code: "",
            thickness_micron: 0,
            thickness_apportion: "per_layer",
            grade_apportion: "fixed",
          },
        ],
      };
    });
  }
  function removeLayer(idx: number) {
    setDraft((d) => {
      if (!d) return d;
      return {
        ...d,
        layer_template: d.layer_template.filter((_, i) => i !== idx),
      };
    });
  }
  function patchAxis(
    axis: VariantAxisDef["axis"],
    required: boolean,
    included: boolean,
  ) {
    setDraft((d) => {
      if (!d) return d;
      const canonical = canonicalAxisKey(String(axis));
      // Match by canonical key so a master that stored the legacy `pod` /
      // `packaging` axis name is updated in-place instead of duplicated.
      const has = d.variant_axes.some(
        (a) => canonicalAxisKey(String(a.axis)) === canonical,
      );
      if (!included) {
        return {
          ...d,
          variant_axes: d.variant_axes.filter(
            (a) => canonicalAxisKey(String(a.axis)) !== canonical,
          ),
        };
      }
      const def = AXIS_DEFS.find((a) => String(a.axis) === canonical)!;
      const next = has
        ? d.variant_axes.map((a) =>
            canonicalAxisKey(String(a.axis)) === canonical
              ? { ...a, required }
              : a,
          )
        : [...d.variant_axes, { ...def, required }];
      return { ...d, variant_axes: next };
    });
  }
  /**
   * Patch the `options` (allowed catalog codes) array on a catalog-backed axis.
   * Ensures the axis row exists in variant_axes (cloned from AXIS_DEFS) before
   * applying the new options array. Matches by canonical key so legacy
   * `pod`/`packaging` axes are also updated in place.
   */
  function patchAxisOptions(axis: VariantAxisDef["axis"], options: string[]) {
    setDraft((d) => {
      if (!d) return d;
      const canonical = canonicalAxisKey(String(axis));
      const has = d.variant_axes.some(
        (a) => canonicalAxisKey(String(a.axis)) === canonical,
      );
      const def = AXIS_DEFS.find((a) => String(a.axis) === canonical);
      if (has) {
        return {
          ...d,
          variant_axes: d.variant_axes.map((a) =>
            canonicalAxisKey(String(a.axis)) === canonical
              ? ({ ...a, options } as VariantAxisDef)
              : a,
          ),
        };
      }
      if (!def) return d;
      return {
        ...d,
        variant_axes: [
          ...d.variant_axes,
          { ...def, options } as VariantAxisDef,
        ],
      };
    });
  }
  function toggleAxisOptionCode(axis: VariantAxisDef["axis"], code: string) {
    const canonical = canonicalAxisKey(String(axis));
    const found = draft
      ? findAxisOnDraft(draft.variant_axes, canonical)
      : undefined;
    const current: string[] = Array.isArray((found as any)?.options)
      ? ((found as any).options as any[]).map(String)
      : [];
    const next = current.includes(code)
      ? current.filter((c) => c !== code)
      : [...current, code];
    patchAxisOptions(axis, next);
  }
  function setAxisFlags(
    axis: VariantAxisDef["axis"],
    patch: { required?: boolean; auto_demand_in_house?: boolean },
  ) {
    setDraft((d) => {
      if (!d) return d;
      const canonical = canonicalAxisKey(String(axis));
      const has = d.variant_axes.some(
        (a) => canonicalAxisKey(String(a.axis)) === canonical,
      );
      if (!has) {
        const def = AXIS_DEFS.find((a) => String(a.axis) === canonical);
        if (!def) return d;
        return {
          ...d,
          variant_axes: [
            ...d.variant_axes,
            { ...def, ...patch } as VariantAxisDef,
          ],
        };
      }
      return {
        ...d,
        variant_axes: d.variant_axes.map((a) =>
          canonicalAxisKey(String(a.axis)) === canonical
            ? ({ ...a, ...patch } as VariantAxisDef)
            : a,
        ),
      };
    });
  }
  function patchSize(idx: number, patch: Partial<ProductMasterSize>) {
    setDraftSizes((arr) => {
      const next = [...arr];
      next[idx] = { ...next[idx], ...patch };
      return next;
    });
  }
  function addSize() {
    const isRoll = isRollLikeOutput(
      draft?.product_kind,
      draft?.packaging_kind,
      draft?.fixed_attributes?.fg_type,
    );
    setDraftSizes((arr) => [
      ...arr,
      {
        id: `tmp-${Math.random().toString(36).slice(2, 8)}`,
        product_master: productId,
        code: `SZ-${arr.length + 1}`,
        label: `Size ${arr.length + 1}`,
        width_mm: 0,
        height_mm: isRoll ? 0 : 0,
        gusset_mm: 0,
        roll_width_mm: null,
        thickness_micron: null,
        standard_qty: null,
        pouch_style: isRoll ? "" : "STAND_UP",
        roll_form: isRoll ? "FLAT" : "",
        stock_form: "OPEN_WEB",
        width_basis: "OPEN_WEB_WIDTH",
        film_area_width_mm: null,
        slit_policy: "SLIT_ALLOWED",
        trim_loss_mm: 10,
        trim_apply_to: "WIDTH",
        flap_tape_mm: 0,
        gusset_apply_to: "HEIGHT",
        gusset_factor: 1,
        adjustments: [],
        geometry_config: isRoll
          ? {
              roll_form: "FLAT",
              trim_loss_mm: 10,
              trim_apply_to: "WIDTH",
              adjustments: [],
            }
          : {
              pouch_style: "STAND_UP",
              trim_loss_mm: 10,
              trim_apply_to: "WIDTH",
              flap_tape_mm: 0,
              gusset_apply_to: "HEIGHT",
              gusset_factor: 1,
              adjustments: [],
            },
        qty_uom: "KG",
        notes: "",
        active: true,
        sort_order: arr.length + 1,
      },
    ]);
  }
  function removeSize(idx: number) {
    setDraftSizes((arr) => arr.filter((_, i) => i !== idx));
  }
  function patchChemistryMaterial(kind: "adhesive" | "solvent", value: string) {
    const options = kind === "adhesive" ? adhesiveOptions : solventOptions;
    const picked = options.find(
      (m: Material) => m.id === value || m.code === value,
    );
    const prefix = kind;
    if (!picked) {
      patchFixed({
        [`${prefix}_material_id`]: null,
        [`${prefix}_material_code`]: "",
        [`${prefix}_material_name`]: "",
        [`${prefix}_gsm`]: "",
      });
      return;
    }
    patchFixed({
      [`${prefix}_material_id`]: picked.id,
      [`${prefix}_material_code`]: picked.code,
      [`${prefix}_material_name`]: picked.name,
    });
  }

  return (
    <div className="relative space-y-6">
      {/* Ambient color blobs — purely decorative, soften the canvas */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 -left-32 h-80 w-80 rounded-full bg-order-bg blur-3xl -z-10"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-40 -right-32 h-80 w-80 rounded-full bg-order-bg blur-3xl -z-10"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute bottom-0 left-1/3 h-72 w-72 rounded-full bg-success-bg blur-3xl -z-10"
      />
      {(() => {
        const kind = String(draft.product_kind || "").toUpperCase();
        const isProductionMaster = kind === "PACKAGING" || kind === "POD";
        return (
          <>
            <RichHero
              eyebrow={
                isProductionMaster
                  ? `Production master · Edit · ${draft.code}`
                  : `Master · Edit · ${draft.code}`
              }
              title={draft.name || "Untitled product master"}
              subtitle={
                isProductionMaster
                  ? `${kind} production master · launched by the Stock Launcher (not sold to customers). Each variant must be manually linked to an existing fixed SKU in /master/${kind === "PACKAGING" ? "packaging" : "pod"} before in-house consumption can use it.`
                  : "The full engineering contract: route, sizes, layers, axes, printing. Saving creates a new active version and disables the current master so old orders keep their original record."
              }
              chips={[
                {
                  label: "Layers",
                  value: `${draft.layer_template.length}`,
                  icon: <Boxes className="h-3.5 w-3.5" />,
                },
                { label: "Sizes", value: `${draftSizes.length}` },
                {
                  label: "Axes",
                  value: `${visibleVariantAxes.length}`,
                  icon: <Workflow className="h-3.5 w-3.5" />,
                },
                { label: "Total μ", value: `${totalThickness}` },
                {
                  label: "Active",
                  value: draft.active ? "Yes" : "No",
                  tone: draft.active ? "ok" : "warn",
                },
              ]}
              actions={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => router.push(`/master/products/${productId}`)}
                  className="gap-1 rounded-xl border-line bg-surface-1/80 text-content-2 hover:bg-surface-1"
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> Back
                </Button>
              }
            />
            {/* Production-master banner — surfaces the manual
 catalog-link model and reminds the admin this isn't
 a sales master. */}
            {isProductionMaster ? (
              <div className="rounded-2xl border border-order-border bg-gradient-to-r from-order-bg via-white to-order-bg px-4 py-3 shadow-sm ring-1 ring-order-border">
                <div className="flex flex-wrap items-start gap-3">
                  <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-gradient-to-br from-order-fg to-order-fg text-white shadow-md">
                    <Workflow className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] font-black uppercase tracking-[0.22em] text-order-fg">
                      Production master · stock launcher only
                    </div>
                    <div className="font-display text-sm font-black text-content-1 mt-0.5">
                      Sales doesn&apos;t pick this · planner launches in-house
                      production after manual SKU link
                    </div>
                    <div className="mt-1 text-[11px] text-content-2 leading-relaxed">
                      Each variant of this {kind} master is a production
                      contract. It does not create a SKU. Link it manually to an
                      existing fixed row in{" "}
                      <a
                        href={`/master/${kind === "PACKAGING" ? "packaging" : "pod"}`}
                        className="font-bold text-order-fg underline-offset-2 hover:underline"
                      >
                        {kind === "PACKAGING"
                          ? "/master/packaging"
                          : "/master/pod"}
                      </a>
                      ; that row remains the stock, purchase, and consumption
                      identity.
                      {kind === "POD"
                        ? " POD is roll-form output, so sizes use roll geometry and KG stock."
                        : " INNER_POUCH stays PCS; SHEET stays roll-form/KG."}
                    </div>
                  </div>
                  <a
                    href={`/master/${kind === "PACKAGING" ? "packaging" : "pod"}`}
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-surface-1 px-3 text-[11px] font-bold text-order-fg ring-1 ring-order-border hover:bg-order-bg"
                  >
                    Open catalog <ArrowRight className="h-3.5 w-3.5" />
                  </a>
                </div>
              </div>
            ) : null}
          </>
        );
      })()}

      <div className="grid grid-cols-1 gap-6">
        <div className="space-y-6">
          <RichSection
            index={1}
            tone="indigo"
            icon={<Workflow className="h-5 w-5" />}
            eyebrow="Identity"
            title="Header & live route"
            subtitle="The stable identity that sales & planner read."
          >
            <div className="space-y-4">
              {/* Top row · code + reporting group as tonal cards */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <FormField label="Master code" tone="indigo">
                  <Input
                    value={draft.code}
                    onChange={(e) =>
                      patchDraft({ code: e.target.value.toUpperCase() })
                    }
                    className="h-10 rounded-xl font-mono font-bold bg-surface-1/80"
                  />
                </FormField>
                <FormField label="Reporting group" tone="violet">
                  <Select
                    value={draft.default_reporting_group}
                    onValueChange={(v) =>
                      patchDraft({
                        default_reporting_group: v as ReportingGroup,
                      })
                    }
                  >
                    <SelectTrigger className="h-10 rounded-xl bg-surface-1/80">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {REPORTING_GROUPS.map((g) => (
                        <SelectItem key={g} value={g}>
                          {g}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
              </div>

              {/* Master name — full width hero field */}
              <FormField label="Master name" tone="indigo" prominent>
                <Input
                  value={draft.name}
                  onChange={(e) => patchDraft({ name: e.target.value })}
                  className="h-12 rounded-xl text-base font-bold bg-surface-1/80"
                />
              </FormField>

              {/* Product kind + template */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <FormField label="Product kind" tone="emerald">
                  <Select
                    value={draft.product_kind}
                    onValueChange={(v) => {
                      const next = v as ProductKind;
                      // Reset packaging_kind when switching away from PACKAGING; default it
                      // to INNER_POUCH when switching INTO PACKAGING (admin can change to SHEET).
                      const patch: Partial<ProductMaster> = {
                        product_kind: next,
                        variant_axes: variantAxesForProductKind(
                          next,
                          draft.variant_axes,
                        ),
                        fixed_attributes: {
                          ...(draft.fixed_attributes || {}),
                          fg_type:
                            next === "ROLL" || next === "POD"
                              ? "ROLL"
                              : "POUCH",
                        },
                      };
                      if (next === "PACKAGING" && !draft.packaging_kind) {
                        patch.packaging_kind = "INNER_POUCH";
                      } else if (next !== "PACKAGING") {
                        patch.packaging_kind = null;
                      }
                      patchDraft(patch);
                    }}
                  >
                    <SelectTrigger className="h-10 rounded-xl bg-surface-1/80">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(
                        [
                          "POUCH",
                          "ROLL",
                          "PACKAGING",
                          "POD",
                          "OTHER",
                        ] as ProductKind[]
                      ).map((k) => (
                        <SelectItem key={k} value={k}>
                          {k}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
                <FormField label="Live route / template" tone="fuchsia">
                  <Select
                    value={draft.template || ""}
                    onValueChange={(v) =>
                      patchDraft({
                        template: v,
                        template_name: templates.find((t: any) => t.id === v)
                          ?.name,
                      })
                    }
                  >
                    <SelectTrigger className="h-10 rounded-xl bg-surface-1/80">
                      <SelectValue placeholder="Pick a live template" />
                    </SelectTrigger>
                    <SelectContent>
                      {templates.map((t: any) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name || t.code}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
              </div>

              {/* Packaging sub-type — only when product_kind=PACKAGING.
 Drives which sales axis the master's variants surface in
 (INNER_POUCH → inner-pouch axis · SHEET → roll-form
 packing). POD masters are always roll-form, no extra
 knob. POUCH/ROLL masters skip this entirely. */}
              {String(draft.product_kind || "").toUpperCase() ===
              "PACKAGING" ? (
                <FormField
                  label="Packing sub-type · what does this master produce?"
                  tone="amber"
                  prominent
                >
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {[
                      {
                        value: "INNER_POUCH" as const,
                        label: "Inner pouch carrier",
                        hint: "Goes inside a gunny / outer · sales picks per order from this master's variants",
                      },
                      {
                        value: "SHEET" as const,
                        label: "Sheet / Roll for packing",
                        hint: "Roll-form film used as wrap or outer sheet",
                      },
                    ].map((opt) => {
                      const active =
                        (draft.packaging_kind || "INNER_POUCH") === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() =>
                            patchDraft({
                              packaging_kind: opt.value,
                              fixed_attributes: {
                                ...(draft.fixed_attributes || {}),
                                fg_type:
                                  opt.value === "SHEET" ? "ROLL" : "POUCH",
                              },
                            })
                          }
                          className={cn(
                            "rounded-2xl border bg-surface-1 px-3.5 py-3 text-left shadow-sm transition",
                            active
                              ? "border-warning-border ring-2 ring-warning-border bg-gradient-to-br from-warning-bg to-warm"
                              : "border-line hover:border-warning-border hover:bg-warning-bg",
                          )}
                        >
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span
                              className={cn(
                                "font-display text-sm font-black",
                                active ? "text-warning-fg" : "text-content-1",
                              )}
                            >
                              {opt.label}
                            </span>
                            {active ? (
                              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-warning-fg text-[10px] font-black text-white shadow ring-2 ring-surface-1">
                                ✓
                              </span>
                            ) : null}
                          </div>
                          <div
                            className={cn(
                              "text-[11px] leading-snug",
                              active ? "text-warning-fg" : "text-content-3",
                            )}
                          >
                            {opt.hint}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </FormField>
              ) : null}

              <FormField label="Description" tone="slate">
                <Textarea
                  value={draft.description || ""}
                  onChange={(e) => patchDraft({ description: e.target.value })}
                  className="min-h-[64px] rounded-xl bg-surface-1/80"
                />
              </FormField>

              {/* Active toggle — vibrant card */}
              <div
                className={cn(
                  "flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 shadow-sm ring-1 transition",
                  draft.active
                    ? "border-success-border bg-gradient-to-r from-success-bg via-white to-success-bg ring-success-border"
                    : "border-danger-border bg-gradient-to-r from-danger-bg via-white to-warm ring-danger-border",
                )}
              >
                <div className="flex items-center gap-3">
                  <span
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-xl text-white shadow-md",
                      draft.active
                        ? "bg-gradient-to-br from-success-fg to-success-bg0"
                        : "bg-gradient-to-br from-danger-solid to-warm",
                    )}
                  >
                    {draft.active ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      <AlertTriangle className="h-4 w-4" />
                    )}
                  </span>
                  <div>
                    <div
                      className={cn(
                        "font-display text-sm font-black",
                        draft.active ? "text-success-fg" : "text-danger-fg",
                      )}
                    >
                      {draft.active
                        ? "Active — sales & planner can pick"
                        : "Inactive — hidden from sales & planner"}
                    </div>
                    <div className="text-[11px] text-content-3">
                      Saved as part of the master record.
                    </div>
                  </div>
                </div>
                <Switch
                  checked={draft.active}
                  onCheckedChange={(v) => patchDraft({ active: v })}
                />
              </div>
            </div>

            <div className="mt-5">
              <div className="mb-2 flex items-center justify-between">
                <Label className="text-[10px] font-black uppercase tracking-[0.22em] text-content-3">
                  Live route preview
                </Label>
                <span className="text-[11px] text-content-3">
                  Process names come from the live template.
                </span>
              </div>
              {routeSteps.length ? (
                <RouteTimeline
                  steps={routeSteps}
                  helperText="Highlight the artwork-bearing step. Stop step controls planner stock commitment."
                />
              ) : (
                <div className="flex items-start gap-2 rounded-xl border border-warning-border bg-warning-bg px-4 py-3 text-xs text-warning-fg">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
                  <span>
                    {draft.template
                      ? "Template is bound, but it has no route steps published yet. Publish/sync route steps on the template before using this master for production."
                      : "Pick a live route template so sales, planner, WCM, and BOM can resolve the same process path."}
                  </span>
                </div>
              )}
            </div>
          </RichSection>

          <RichSection
            index={2}
            tone="violet"
            icon={<Workflow className="h-5 w-5" />}
            eyebrow="Variant axes"
            title={
              isProductionMasterKind(draft.product_kind)
                ? "What defines produced variants"
                : "What sales picks per order"
            }
            subtitle={
              isProductionMasterKind(draft.product_kind)
                ? "Catalog SKU is linked manually after variant creation"
                : "Off = never asked · Optional = skippable · Required = sales must enter"
            }
          >
            {(() => {
              const kind = String(draft.product_kind || "").toUpperCase();
              if (kind === "POUCH") {
                return (
                  <div className="mb-3 flex items-start gap-2 rounded-xl border border-warning-border bg-gradient-to-r from-warning-bg via-white to-warm px-3 py-2 text-[11px] text-warning-fg">
                    <Package className="mt-0.5 h-4 w-4 flex-none text-warning-fg" />
                    <span>
                      <strong>Inner pouch axis</strong> below lets sales pick
                      which inner-pouch SKU goes with this pouch. Customer
                      overlay can override{" "}
                      <code className="rounded bg-warning-bg px-1 font-mono text-[10px] text-warning-fg">
                        pcs_per_inner
                      </code>
                      . All other packing (gunny, sheet, tape, label, tag) is
                      ticked at{" "}
                      <a
                        href="/logistics/packing/order-ticks"
                        className="font-bold underline-offset-2 hover:underline"
                      >
                        EOD per order
                      </a>
                      .
                    </span>
                  </div>
                );
              }
              if (kind === "PACKAGING" || kind === "POD") {
                return (
                  <div className="mb-3 flex items-start gap-2 rounded-xl border border-order-border bg-gradient-to-r from-order-bg via-white to-order-bg px-3 py-2 text-[11px] text-order-fg">
                    <Workflow className="mt-0.5 h-4 w-4 flex-none text-order-fg" />
                    <span>
                      This is a <strong>{kind}</strong> production master. It
                      does not pick Packaging/POD catalog values as inputs and
                      it does not create SKUs. Use size/layer axes to create the
                      variant, then manually link that variant to one existing
                      catalog SKU.
                    </span>
                  </div>
                );
              }
              return null;
            })()}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {AXIS_DEFS.filter((d) => d.axis !== "artwork_mode")
                .filter((d) => {
                  // Inner pouch is POUCH-only — hide for rolls/POD/other.
                  // Outer-packaging axis is dropped entirely (PM no longer carries packing).
                  if (d.axis === "packaging_outer") return false;
                  if (
                    isProductionMasterKind(draft.product_kind) &&
                    PRODUCTION_MASTER_CATALOG_AXES.has(
                      canonicalAxisKey(String(d.axis)),
                    )
                  ) {
                    return false;
                  }
                  if (d.axis === "packaging_inner") {
                    return (
                      String(draft.product_kind || "").toUpperCase() === "POUCH"
                    );
                  }
                  return true;
                })
                .map((def) => {
                  // Alias-aware: a master storing the legacy `pod` / `packaging`
                  // axis name still resolves to the canonical `pod_variant` /
                  // `packaging_inner` card so the tri-state reflects reality.
                  // artwork_mode is hidden here because it's a derived axis —
                  // its required/optional/off state always mirrors the Printing
                  // contract toggles in section 5. We keep them in sync in patchFixed.
                  const found = findAxisOnDraft(
                    draft.variant_axes,
                    String(def.axis),
                  );
                  const mode = axisMode(found);
                  return (
                    <div
                      key={def.axis}
                      className={cn(
                        "rounded-xl border bg-surface-1 px-3 py-2.5",
                        mode === "required" &&
                          "border-info-border ring-1 ring-info-border",
                        mode === "optional" &&
                          "border-order-border ring-1 ring-order-border",
                        mode === "off" && "border-line",
                      )}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-bold text-content-1">
                            {def.label || def.axis}
                          </div>
                          <div className="text-[11px] text-content-3">
                            {def.type.replaceAll("_", " ")}
                          </div>
                        </div>
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wider ring-1 ring-inset",
                            mode === "required" &&
                              "bg-primary text-white ring-primary",
                            mode === "optional" &&
                              "bg-order-bg text-order-fg ring-order-border",
                            mode === "off" &&
                              "bg-surface-2 text-content-3 ring-line",
                          )}
                        >
                          {mode}
                        </span>
                      </div>
                      <div className="mt-2 grid grid-cols-3 gap-1 rounded-full bg-surface-2 p-1">
                        <button
                          type="button"
                          onClick={() => patchAxis(def.axis, false, false)}
                          className={cn(
                            "rounded-full px-2 py-1 text-[10px] font-bold uppercase",
                            mode === "off"
                              ? "bg-surface-1 text-content-1 shadow-sm"
                              : "text-content-3",
                          )}
                        >
                          Off
                        </button>
                        <button
                          type="button"
                          onClick={() => patchAxis(def.axis, false, true)}
                          className={cn(
                            "rounded-full px-2 py-1 text-[10px] font-bold uppercase",
                            mode === "optional"
                              ? "bg-surface-1 text-order-fg shadow-sm"
                              : "text-content-3",
                          )}
                        >
                          Optional
                        </button>
                        <button
                          type="button"
                          onClick={() => patchAxis(def.axis, true, true)}
                          className={cn(
                            "rounded-full px-2 py-1 text-[10px] font-bold uppercase",
                            mode === "required"
                              ? "bg-primary text-white shadow-sm"
                              : "text-content-3",
                          )}
                        >
                          Required
                        </button>
                      </div>
                      <div className="mt-2 text-[11px] text-content-3">
                        {axisModeCopy(mode as "off" | "optional" | "required")}
                      </div>
                    </div>
                  );
                })}
            </div>
          </RichSection>

          <RichSection
            index={3}
            tone="blue"
            icon={<Boxes className="h-5 w-5" />}
            eyebrow="Layer template"
            title="Per layer — film identity locked, μ + grade Fixed/Variable"
            subtitle="Default thickness + default grade are always required. 2+ allowed grades = Variable (picked per variant). Grade list is the full catalog."
            actions={
              <Button
                size="sm"
                variant="outline"
                className="rounded-xl"
                onClick={addLayer}
              >
                <Plus className="mr-1 h-3.5 w-3.5" /> Add layer
              </Button>
            }
          >
            <div className="space-y-3">
              {draft.layer_template.map((row, i) => (
                <LayerCard
                  key={i}
                  index={i}
                  layer={row}
                  filmVariants={filmVariants}
                  grades={grades}
                  recipes={recipes}
                  onPatch={(patch) => patchLayer(i, patch)}
                  onPickFilm={(picked) =>
                    patchLayer(
                      i,
                      sanitizeLayerForFilm(row, picked, grades, recipes),
                    )
                  }
                  onRemove={() => removeLayer(i)}
                />
              ))}
              {draft.layer_template.length === 0 ? (
                <div className="rounded-xl border border-dashed border-info-border bg-info-bg p-6 text-center text-xs text-primary">
                  No layers yet. Click <strong>Add layer</strong> above.
                </div>
              ) : null}
            </div>
            <p className="mt-3 flex items-center gap-1.5 text-[11px] text-content-3">
              <AlertTriangle className="h-3.5 w-3.5 text-warning-fg" />
              Total default thickness{" "}
              <strong className="ml-1 text-content-2">
                {totalThickness} μ
              </strong>
              . No global thickness or grade — per-layer only.
            </p>
          </RichSection>

          <RichSection
            index={4}
            tone="emerald"
            icon={<span className="text-lg leading-none">📐</span>}
            eyebrow="Sizes & geometry"
            title={sizeSectionTitle}
            subtitle={sizeSectionSubtitle}
          >
            <ProductSizeWorkspace
              rows={draftSizes}
              productId={productId}
              kind={draft.product_kind}
              packagingKind={draft.packaging_kind ?? null}
              fixedFgType={draft.fixed_attributes?.fg_type ?? null}
              onAdd={addSize}
              onPatch={patchSize}
              onRemove={removeSize}
              onBulkApply={setDraftSizes}
              onRequestSave={() => updateMutation.mutate()}
              canRequestSave={!updateMutation.isPending && errorCount === 0}
              isSaving={updateMutation.isPending}
            />
          </RichSection>

          <RichSection
            index={5}
            tone="fuchsia"
            icon={<Palette className="h-5 w-5" />}
            eyebrow="Printing"
            title="2 knobs — print capable + artwork compulsory"
            subtitle="Together they decide whether printing is possible and whether artwork blocks production release."
          >
            <PrintingTwoKnob
              printCapable={!!draft.fixed_attributes?.print_capable}
              artworkRequired={!!draft.fixed_attributes?.artwork_required}
              printType={printType}
              substrateMode={artworkSubstrateMode}
              mixedSubstrateModes={mixedArtworkSubstrateModes}
              defaultArtworkId={String(
                draft.fixed_attributes?.default_artwork_id || "",
              )}
              artworks={compatibleApprovedArtworks}
              incompatibleDefaultArtwork={incompatibleDefaultArtwork}
              productionMaster={
                String(draft.product_kind || "").toUpperCase() ===
                  "PACKAGING" ||
                String(draft.product_kind || "").toUpperCase() === "POD"
              }
              onChange={(p) => patchFixed(p)}
              onChangeDefaultArtwork={(id) =>
                patchFixed({ default_artwork_id: id || null } as any)
              }
            />
          </RichSection>

          {isMultiLayer ? (
            <RichSection
              index={6}
              tone="amber"
              icon={<Package className="h-5 w-5" />}
              eyebrow="Advanced · chemistry"
              title="Adhesive & solvent defaults"
              subtitle="One adhesive + one solvent per master. GSM × area flows into live BOM, sales orders, WIP, and dispatch consumption."
            >
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <div className="rounded-xl border border-line bg-surface-1 p-3">
                  <div className="mb-3 flex items-start gap-2">
                    <Package className="mt-0.5 h-4 w-4 text-success-fg" />
                    <div>
                      <div className="text-sm font-black text-content-1">
                        Adhesive
                      </div>
                      <div className="text-[11px] text-content-3">
                        Consumed from selected adhesive master by GSM × area.
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-3">
                    <div>
                      <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-content-3">
                        Material
                      </Label>
                      <Select
                        value={
                          draft.fixed_attributes?.adhesive_material_id ||
                          "__none__"
                        }
                        onValueChange={(v) =>
                          patchChemistryMaterial(
                            "adhesive",
                            v === "__none__" ? "" : v,
                          )
                        }
                      >
                        <SelectTrigger className="mt-1 h-9 rounded-xl text-xs">
                          <SelectValue placeholder="Select adhesive" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">No adhesive</SelectItem>
                          {adhesiveOptions.map((m: Material) => (
                            <SelectItem
                              key={m.id || m.code}
                              value={m.id || m.code}
                            >
                              {m.code} · {m.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-content-3">
                        GSM
                      </Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        className="mt-1 h-9 rounded-xl text-right text-xs"
                        value={draft.fixed_attributes?.adhesive_gsm ?? ""}
                        onChange={(e) =>
                          patchFixed({
                            adhesive_gsm:
                              e.target.value === ""
                                ? ""
                                : Number(e.target.value),
                          })
                        }
                      />
                    </div>
                  </div>
                  {draft.fixed_attributes?.adhesive_material_code ? (
                    <div className="mt-2 rounded-lg bg-success-bg px-2 py-1.5 text-[11px] font-semibold text-success-fg">
                      {draft.fixed_attributes.adhesive_material_code} ·{" "}
                      {draft.fixed_attributes.adhesive_gsm || 0} GSM
                    </div>
                  ) : null}
                </div>

                <div className="rounded-xl border border-line bg-surface-1 p-3">
                  <div className="mb-3 flex items-start gap-2">
                    <Disc className="mt-0.5 h-4 w-4 text-info-fg" />
                    <div>
                      <div className="text-sm font-black text-content-1">
                        Solvent
                      </div>
                      <div className="text-[11px] text-content-3">
                        Consumed from selected solvent master by GSM × area.
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-3">
                    <div>
                      <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-content-3">
                        Material
                      </Label>
                      <Select
                        value={
                          draft.fixed_attributes?.solvent_material_id ||
                          "__none__"
                        }
                        onValueChange={(v) =>
                          patchChemistryMaterial(
                            "solvent",
                            v === "__none__" ? "" : v,
                          )
                        }
                      >
                        <SelectTrigger className="mt-1 h-9 rounded-xl text-xs">
                          <SelectValue placeholder="Select solvent" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">No solvent</SelectItem>
                          {solventOptions.map((m: Material) => (
                            <SelectItem
                              key={m.id || m.code}
                              value={m.id || m.code}
                            >
                              {m.code} · {m.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-[10px] font-black uppercase tracking-[0.2em] text-content-3">
                        GSM
                      </Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        className="mt-1 h-9 rounded-xl text-right text-xs"
                        value={draft.fixed_attributes?.solvent_gsm ?? ""}
                        onChange={(e) =>
                          patchFixed({
                            solvent_gsm:
                              e.target.value === ""
                                ? ""
                                : Number(e.target.value),
                          })
                        }
                      />
                    </div>
                  </div>
                  {draft.fixed_attributes?.solvent_material_code ? (
                    <div className="mt-2 rounded-lg bg-info-bg px-2 py-1.5 text-[11px] font-semibold text-info-fg">
                      {draft.fixed_attributes.solvent_material_code} ·{" "}
                      {draft.fixed_attributes.solvent_gsm || 0} GSM
                    </div>
                  ) : null}
                </div>
              </div>
            </RichSection>
          ) : null}

          {/* Sales-pickable menu — only for sales-facing masters
 (POUCH / ROLL / OTHER). PACKAGING + POD masters are
 production masters, not sales masters: sales never picks
 them, the stock launcher launches them. Hiding this
 section keeps the surface honest. */}
          {String(draft.product_kind || "").toUpperCase() === "PACKAGING" ||
          String(draft.product_kind || "").toUpperCase() === "POD" ? null : (
            <RichSection
              index={7}
              tone="violet"
              icon={<Workflow className="h-5 w-5" />}
              eyebrow="Advanced · catalog allow-list"
              title="Sales-pickable menu"
              subtitle={
                String(draft.product_kind || "").toUpperCase() === "POUCH"
                  ? "Pick which Inner pouch + POD + Add-on catalog SKUs sales can choose from. Outer (gunny/sheet/tape/etc) is no longer here — packing yard ticks at EOD."
                  : "Pick which POD + Add-on catalog SKUs sales can choose from. Outer packing isn't on the master — packing yard ticks at EOD. Inner pouch axis is POUCH-only."
              }
            >
              <AxisAllowedRegistry
                draft={draft}
                packagingMaterials={packagingMaterials}
                podVariants={podVariants}
                addonCatalog={addonCatalog}
                onToggleCode={toggleAxisOptionCode}
                onSetAxisFlags={setAxisFlags}
                onPatchOptions={patchAxisOptions}
                onPatchFixed={patchFixed}
              />
            </RichSection>
          )}
        </div>

        <aside className="grid gap-4 xl:grid-cols-2">
          {(() => {
            const kind = String(draft.product_kind || "").toUpperCase();
            const visualKind =
              outputKind === "ROLL" || outputKind === "POUCH"
                ? outputKind
                : kind;
            const usesProductVisual =
              visualKind === "POUCH" || visualKind === "ROLL";
            return (
              <RichSection
                tone="emerald"
                icon={<span className="text-sm">🧪</span>}
                title="Live anatomy"
                subtitle={`${kind} → ${visualKind} · ${draft.layer_template.length} layers · ${totalThickness}μ`}
              >
                {usesProductVisual ? (
                  <ProductVisual
                    kind={visualKind as ProductKind}
                    layers={draft.layer_template}
                    width_mm={draftSizes[0]?.width_mm}
                    height_mm={draftSizes[0]?.height_mm}
                    gusset_mm={draftSizes[0]?.gusset_mm}
                    roll_width_mm={
                      draftSizes[0]?.roll_width_mm ||
                      autoRollWidthMm(draftSizes[0] || {}, visualKind)
                    }
                    addons={
                      draft.fixed_attributes?.print_capable ? ["PRINT"] : []
                    }
                    title="Draft"
                    subtitle={`${draft.layer_template.length} layers · ${totalThickness}μ`}
                  />
                ) : (
                  <FlatFilmVisual
                    layers={draft.layer_template}
                    sizeRow={draftSizes[0]}
                    kind={kind}
                  />
                )}
              </RichSection>
            );
          })()}

          <LiveBomRail
            title="Live preview"
            subtitle="Backend preview from saved master + first active size"
            preview={livePreview || null}
            loading={livePreviewLoading}
            scope="variant"
            masterFlags={{
              print_capable: !!draft.fixed_attributes?.print_capable,
              pod_locked: !!(
                draft.fixed_attributes?.pod_enabled &&
                (draft.fixed_attributes?.pod_variant ||
                  draft.fixed_attributes?.pod_variant_code)
              ),
              addons_axis: addonsAxisMode,
            }}
            badge={
              livePreviewError ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-warning-bg px-2 py-0.5 text-[10px] font-bold text-warning-fg ring-1 ring-warning-border">
                  <AlertTriangle className="h-3 w-3" /> preview needs save/axes
                </span>
              ) : undefined
            }
          />
        </aside>
      </div>

      <ValidationFooter
        checks={checks}
        autosaveLabel="Version draft ready"
        primaryActions={
          <Button
            onClick={() => updateMutation.mutate()}
            disabled={updateMutation.isPending || errorCount > 0}
            className="gap-1.5 rounded-xl"
          >
            {updateMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save new version
          </Button>
        }
        secondaryActions={
          <Button
            variant="outline"
            onClick={() => router.push(`/master/products/${productId}`)}
            className="rounded-xl"
          >
            Cancel
          </Button>
        }
      />
    </div>
  );
}

function computeChecks(
  draft: ProductMaster,
  sizes: ProductMasterSize[],
  films: Material[],
): CheckLine[] {
  const out: CheckLine[] = [
    {
      label: "Master code & name",
      ok: !!draft.code && !!draft.name,
      tone: "error",
    },
    {
      label: "Live route/template selected",
      ok: !!draft.template,
      tone: "error",
    },
    { label: "At least one size", ok: sizes.length > 0, tone: "error" },
    {
      label: "At least one layer",
      ok: draft.layer_template.length > 0,
      tone: "error",
    },
  ];
  const layersValid = draft.layer_template.every((layer) => {
    return Boolean(layer.film_variant_code);
  });
  out.push({
    label: "Each layer has a fixed film/material",
    ok: layersValid,
    tone: "error",
  });
  if (draft.fixed_attributes?.print_capable) {
    out.push({
      label: "Printing contract has artwork gate",
      ok: !!draft.fixed_attributes?.artwork_required,
      tone: "warn",
    });
  }
  return out;
}

/**
 * FormField — vibrant label + field wrapper for PM Edit. Each field gets a
 * tone-tinted label background so the form reads as a polished spec card
 * instead of stacked plain inputs. Children are the actual input/select.
 */
const FORM_FIELD_TONE: Record<
  string,
  { label: string; ring: string; dot: string; bg: string }
> = {
  indigo: {
    label: "text-order-fg",
    ring: "ring-order-border",
    dot: "bg-order-fg",
    bg: "bg-gradient-to-br from-order-bg to-white",
  },
  violet: {
    label: "text-order-fg",
    ring: "ring-order-border",
    dot: "bg-order-fg",
    bg: "bg-gradient-to-br from-order-bg to-white",
  },
  emerald: {
    label: "text-success-fg",
    ring: "ring-success-border",
    dot: "bg-success-fg",
    bg: "bg-gradient-to-br from-success-bg to-white",
  },
  amber: {
    label: "text-warning-fg",
    ring: "ring-warning-border",
    dot: "bg-warning-fg",
    bg: "bg-gradient-to-br from-warning-bg to-white",
  },
  fuchsia: {
    label: "text-order-fg",
    ring: "ring-order-border",
    dot: "bg-order-fg",
    bg: "bg-gradient-to-br from-order-bg to-white",
  },
  blue: {
    label: "text-primary",
    ring: "ring-info-border",
    dot: "bg-primary",
    bg: "bg-gradient-to-br from-info-bg to-surface-1",
  },
  slate: {
    label: "text-content-3",
    ring: "ring-line",
    dot: "bg-line",
    bg: "bg-gradient-to-br from-surface-2 to-white",
  },
};
function FormField({
  label,
  tone = "slate",
  prominent,
  children,
}: {
  label: string;
  tone?: keyof typeof FORM_FIELD_TONE;
  prominent?: boolean;
  children: React.ReactNode;
}) {
  const t = FORM_FIELD_TONE[tone] || FORM_FIELD_TONE.slate;
  return (
    <div
      className={cn(
        "rounded-2xl ring-1 p-3 shadow-sm",
        t.ring,
        t.bg,
        prominent && "p-4",
      )}
    >
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className={cn("inline-block h-1.5 w-1.5 rounded-full", t.dot)} />
        <Label
          className={cn(
            "text-[10px] font-black uppercase tracking-[0.22em]",
            t.label,
          )}
        >
          {label}
        </Label>
      </div>
      {children}
    </div>
  );
}

/**
 * FlatFilmVisual — rendered for PACKAGING / OTHER masters in place of the
 * roll/pouch ProductVisual. Shows a stacked-layer flat film representation
 * (which is what an inner-pouch / sheet / gunny actually is at master level).
 */
function FlatFilmVisual({
  layers,
  sizeRow,
  kind,
}: {
  layers: LayerTemplateRow[];
  sizeRow?: ProductMasterSize;
  kind: string;
}) {
  const total = layers.reduce((s, l) => s + (l.thickness_micron || 0), 0);
  const COLORS = [
    "bg-info-fg",
    "bg-info-fg",
    "bg-success-fg",
    "bg-warning-fg",
    "bg-order-fg",
    "bg-danger-fg",
  ];
  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-success-border bg-gradient-to-br from-success-bg via-white to-success-bg p-4">
        <div className="text-[10px] font-black uppercase tracking-[0.18em] text-success-fg mb-2">
          Flat film stack · {kind}
        </div>
        {/* Layer stack — proportional thickness bars */}
        {layers.length === 0 ? (
          <div className="rounded-xl border border-dashed border-success-border bg-surface-1/60 p-6 text-center text-xs text-success-fg">
            No layers yet
          </div>
        ) : (
          <div className="space-y-1.5">
            {layers.map((l, i) => {
              const pct =
                total > 0
                  ? Math.max(2, ((l.thickness_micron || 0) / total) * 100)
                  : 100 / layers.length;
              return (
                <div key={i} className="flex items-center gap-2">
                  <span className="font-mono text-[10px] font-black text-content-3 w-6">
                    L{i + 1}
                  </span>
                  <div className="flex-1 h-5 rounded-md bg-surface-2 overflow-hidden ring-1 ring-line">
                    <div
                      className={cn(
                        "h-full shadow-inner",
                        COLORS[i % COLORS.length],
                      )}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="font-mono text-[10px] font-bold text-content-2 w-14 text-right">
                    {l.thickness_micron || 0}μ
                  </span>
                  <span className="font-mono text-[9px] text-content-3 w-20 truncate">
                    {l.film_variant_code || "—"}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        <div className="mt-3 flex items-center justify-between rounded-lg bg-surface-1 px-3 py-1.5 ring-1 ring-success-border">
          <span className="text-[10px] font-black uppercase tracking-[0.18em] text-content-3">
            Total thickness
          </span>
          <span className="font-mono font-black text-success-fg">
            {total} μ
          </span>
        </div>
        {sizeRow ? (
          <div className="mt-2 grid grid-cols-2 gap-2 text-[10px]">
            <div className="rounded-lg bg-surface-1 px-2 py-1 ring-1 ring-success-border">
              <div className="font-black uppercase tracking-wider text-content-3">
                Width
              </div>
              <div className="font-mono font-bold text-content-1">
                {sizeRow.width_mm || 0} mm
              </div>
            </div>
            <div className="rounded-lg bg-surface-1 px-2 py-1 ring-1 ring-success-border">
              <div className="font-black uppercase tracking-wider text-content-3">
                Height
              </div>
              <div className="font-mono font-bold text-content-1">
                {sizeRow.height_mm || 0} mm
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * LayerCard — per-layer rich editor. Replaces the old table row with a
 * proper card that separates:
 * - Film identity (locked, single picker)
 * - μ thickness · Fixed / Variable toggle. When Variable, surfaces an
 * allowed-thicknesses picker. When Fixed, just one default.
 * - Grade · Fixed / Variable toggle. When Variable, surfaces the allowed
 * grades multi-select from the full catalog. When Fixed, one default.
 * - Optional roll-width override (rare; advanced)
 *
 * The user can flip the toggle and the previously-set "default" stays —
 * we only toggle whether more than one option is allowed.
 */
function LayerCard({
  index,
  layer,
  filmVariants,
  grades,
  recipes,
  onPatch,
  onPickFilm,
  onRemove,
}: {
  index: number;
  layer: LayerTemplateRow;
  filmVariants: Material[];
  grades: any[];
  recipes: any[];
  onPatch: (patch: Partial<LayerTemplateRow>) => void;
  onPickFilm: (picked: Material | undefined) => void;
  onRemove: () => void;
}) {
  const gradeOptions: string[] = Array.isArray((layer as any).grade_options)
    ? (layer as any).grade_options
    : [];
  const gradeMode = String(
    (layer as any).grade_apportion || (layer as any).grade_mode || "",
  ).toLowerCase();
  const gradeVariable =
    gradeMode === "variable" || (!gradeMode && gradeOptions.length >= 2);
  const thickVariable =
    String((layer as any).thickness_apportion || "").toLowerCase() ===
    "variable";
  const [showRollOverride, setShowRollOverride] = React.useState<boolean>(
    !!(layer as any).default_input_roll_width_mm,
  );
  const allGradeOptions = gradeOptionsForLayer(
    layer,
    filmVariants,
    grades as any,
    recipes as any,
  );

  return (
    <div className="relative overflow-hidden rounded-2xl border border-info-border bg-gradient-to-br from-white via-info-bg to-info-bg p-4 shadow-sm ring-1 ring-surface-1/40">
      <div className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-primary to-info-fg" />
      <div className="relative pl-2">
        {/* Header — layer number + Fixed/Variable summary pills + delete */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-info-fg text-white shadow-md font-black text-sm">
              L{index + 1}
            </span>
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-primary">
                Layer {index + 1}
              </div>
              <div className="font-display text-sm font-black text-content-1">
                {layer.role || `Layer ${index + 1}`}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <LayerStatePill axis="μ thickness" variable={thickVariable} />
            <LayerStatePill axis="G grade" variable={gradeVariable} />
            <button
              type="button"
              onClick={onRemove}
              className="ml-1 flex h-8 w-8 items-center justify-center rounded-lg text-danger-fg hover:bg-danger-bg"
              title="Remove layer"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Film picker */}
        <div className="mb-3">
          <Label className="text-[10px] font-black uppercase tracking-[0.18em] text-primary">
            Film variant · locked at master
          </Label>
          {filmVariants.length ? (
            <>
              <Select
                value={layer.film_variant_id || layer.film_variant_code || ""}
                onValueChange={(v) => {
                  const picked = filmVariants.find(
                    (m) => m.id === v || m.code === v,
                  );
                  onPickFilm(picked);
                }}
              >
                <SelectTrigger className="mt-1 h-10 rounded-xl bg-surface-1">
                  <SelectValue placeholder="Select film" />
                </SelectTrigger>
                <SelectContent>
                  {filmVariants.map((m) => (
                    <SelectItem key={m.id || m.code} value={m.id || m.code}>
                      {m.code} · {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {layer.film_variant_code ? (
                <div className="mt-1 rounded-lg bg-surface-1 px-2 py-1 font-mono text-[10px] font-bold text-content-2 ring-1 ring-line">
                  Current film · {layer.film_variant_code}
                </div>
              ) : null}
            </>
          ) : (
            <div className="mt-1 rounded-xl border border-warning-border bg-warning-bg px-3 py-2 text-xs font-semibold text-warning-fg">
              Add film variants first
            </div>
          )}
        </div>

        {/* μ thickness — toggle + default + (variable) allowed */}
        <LayerAxisBlock
          title="μ thickness"
          axisColor="blue"
          variable={thickVariable}
          onToggle={(v) =>
            onPatch({
              thickness_apportion: v ? "variable" : "per_layer",
            } as any)
          }
          helperFixed="One thickness used by every variant"
          helperVariable="Default + allowed list — sales/planner pick per variant"
          defaultEditor={
            <LayerThicknessSelect
              layer={layer}
              films={filmVariants}
              recipes={recipes}
              onChange={(patch) => onPatch(patch)}
            />
          }
          allowedEditor={
            null /* current model stores allowed thicknesses implicitly via recipe range */
          }
        />

        {/* Grade — toggle + default + (variable) allowed list from full catalog */}
        <LayerAxisBlock
          title="Grade"
          axisColor="emerald"
          variable={gradeVariable}
          onToggle={(v) => {
            if (!v) {
              // Variable → Fixed: collapse the allowed list to just the default
              const def = String(
                (layer as any).default_grade || gradeOptions[0] || "",
              );
              onPatch({
                grade_apportion: "fixed",
                grade_options: def ? [def] : [],
                default_grade: def,
              } as any);
            } else {
              // Fixed → Variable: keep the current default and expose the full
              // active Grade Master list as allowed choices.
              const def = String(
                (layer as any).default_grade || allGradeOptions[0] || "",
              );
              const opts = Array.from(
                new Set([
                  ...(def ? [def] : []),
                  ...gradeOptions,
                  ...allGradeOptions,
                ]),
              );
              onPatch({
                grade_apportion: "variable",
                grade_options: opts,
                default_grade: def,
              } as any);
            }
          }}
          helperFixed="One grade used by every variant"
          helperVariable="Default + allowed grades from the full catalog — sales/planner pick per variant"
          defaultEditor={
            <LayerDefaultGradeSelect
              layer={layer}
              films={filmVariants}
              grades={grades}
              recipes={recipes}
              onChange={(patch) => {
                if (!gradeVariable && patch.default_grade) {
                  onPatch({
                    ...patch,
                    grade_apportion: "fixed",
                    grade_options: [String(patch.default_grade)],
                  } as any);
                  return;
                }
                onPatch(
                  gradeVariable
                    ? ({ ...patch, grade_apportion: "variable" } as any)
                    : patch,
                );
              }}
            />
          }
          allowedEditor={
            <LayerAllowedGradePicker
              layer={layer}
              films={filmVariants}
              grades={grades}
              recipes={recipes}
              onChange={(patch) => onPatch(patch)}
            />
          }
        />

        {/* Advanced — roll-width override (rare) */}
        <div className="mt-3 rounded-xl bg-surface-2 px-3 py-2">
          <button
            type="button"
            onClick={() => setShowRollOverride((v) => !v)}
            className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-content-3 hover:text-content-1"
          >
            <span
              className={cn(
                "inline-block h-1.5 w-1.5 rounded-full",
                showRollOverride ? "bg-danger-solid" : "bg-line",
              )}
            />
            Advanced · per-layer roll-width override
            <span className="text-[9px] text-content-3 normal-case font-normal">
              {showRollOverride ? "(hide)" : "(rare — click to show)"}
            </span>
          </button>
          {showRollOverride ? (
            <div className="mt-2 grid grid-cols-[minmax(0,1fr)_140px] gap-2 items-end">
              <div className="text-[11px] text-content-3">
                Fallback input roll width for BOM, used when no size-level
                override is set on the order.
              </div>
              <Input
                type="number"
                placeholder="auto"
                value={(layer as any).default_input_roll_width_mm || ""}
                onChange={(e) =>
                  onPatch({
                    default_input_roll_width_mm: e.target.value
                      ? Number(e.target.value)
                      : null,
                  } as any)
                }
                className="h-9 rounded-lg text-right text-xs"
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * LayerAxisBlock — per-axis (μ thickness, grade) wrapper inside LayerCard
 * with a Fixed/Variable segmented toggle, contextual helper line, and
 * editors that swap based on the toggle state.
 */
function LayerAxisBlock({
  title,
  axisColor,
  variable,
  onToggle,
  helperFixed,
  helperVariable,
  defaultEditor,
  allowedEditor,
}: {
  title: string;
  axisColor: "blue" | "emerald";
  variable: boolean;
  onToggle: (variable: boolean) => void;
  helperFixed: string;
  helperVariable: string;
  defaultEditor: React.ReactNode;
  allowedEditor: React.ReactNode;
}) {
  const toneActive =
    axisColor === "blue"
      ? "bg-primary text-white ring-primary"
      : "bg-success-fg text-white ring-success-border";
  const toneInactive =
    "bg-surface-1 text-content-3 ring-line hover:bg-surface-2";
  return (
    <div className="mb-3 rounded-xl border border-line bg-surface-1 p-3 shadow-sm">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "text-[10px] font-black uppercase tracking-[0.18em]",
              axisColor === "blue" ? "text-primary" : "text-success-fg",
            )}
          >
            {title}
          </span>
          <span className="text-[10px] text-content-3">
            {variable ? helperVariable : helperFixed}
          </span>
        </div>
        <div className="inline-flex gap-1 rounded-full bg-surface-2 p-1 ring-1 ring-line">
          <button
            type="button"
            onClick={() => onToggle(false)}
            className={cn(
              "rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider ring-1 ring-inset transition",
              !variable ? toneActive : toneInactive,
            )}
          >
            Fixed
          </button>
          <button
            type="button"
            onClick={() => onToggle(true)}
            className={cn(
              "rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider ring-1 ring-inset transition",
              variable ? toneActive : toneInactive,
            )}
          >
            Variable
          </button>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 items-start">
        <div>
          <div className="text-[9px] font-black uppercase tracking-wider text-content-3 mb-1">
            Default {variable ? "(required)" : ""}
          </div>
          {defaultEditor}
        </div>
        {variable && allowedEditor ? (
          <div>
            <div className="text-[9px] font-black uppercase tracking-wider text-success-fg mb-1">
              Allowed list · sales/planner picks one per variant
            </div>
            {allowedEditor}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-line bg-surface-1 px-3 py-2.5">
      <div>
        <div className="text-sm font-bold text-content-1">{label}</div>
        {description ? (
          <div className="text-[11px] text-content-3">{description}</div>
        ) : null}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

/**
 * PrintingTwoKnob — the 2 printing knobs (`print_capable`, `artwork_required`)
 * with a live state badge explaining exactly what happens for the current combo.
 *
 * print_capable=false → "No printing" (plain master)
 * print_capable=true, artwork_required=false → "Print capable · artwork OPTIONAL"
 * Ink GSM is NOT counted in BOM
 * until an artwork is assigned
 * on the order. Can dispatch
 * without artwork.
 * print_capable=true, artwork_required=true → "Print compulsory · artwork REQUIRED"
 * Block production release
 * until artwork is selected.
 */
function PrintingTwoKnob({
  printCapable,
  artworkRequired,
  printType,
  substrateMode,
  mixedSubstrateModes,
  defaultArtworkId,
  artworks,
  incompatibleDefaultArtwork,
  productionMaster = false,
  onChange,
  onChangeDefaultArtwork,
}: {
  printCapable: boolean;
  artworkRequired: boolean;
  printType: "FLEXO" | "ROTO";
  substrateMode: "SHEET" | "TUBING";
  mixedSubstrateModes?: boolean;
  defaultArtworkId: string;
  artworks: Artwork[];
  incompatibleDefaultArtwork?: Artwork | null;
  /** True for PACKAGING + POD masters — copy talks about stock launcher/planner instead of sales. */
  productionMaster?: boolean;
  onChange: (patch: {
    print_capable?: boolean;
    artwork_required?: boolean;
    print_type?: "FLEXO" | "ROTO";
  }) => void;
  onChangeDefaultArtwork: (id: string) => void;
}) {
  type State = "OFF" | "CAPABLE_OPTIONAL" | "REQUIRED";
  const state: State = !printCapable
    ? "OFF"
    : artworkRequired
      ? "REQUIRED"
      : "CAPABLE_OPTIONAL";

  // For production masters (PACKAGING / POD) the artwork picker is the
  // Stock Launcher (or planner before release) — not sales. Same 3-state
  // model, mode-aware copy.
  const STATE_META: Record<
    State,
    {
      tone: string;
      ring: string;
      title: string;
      eyebrow: string;
      body: string;
      bom: string;
    }
  > = productionMaster
    ? {
        OFF: {
          tone: "bg-gradient-to-br from-surface-2 to-surface-2",
          ring: "ring-line",
          title: "No printing",
          eyebrow: "Plain production master",
          body: "This stock launches as unprinted production runs. No artwork ever attached. Routes skip print step.",
          bom: "BOM has no ink rows. Weight = layers + chemistry only.",
        },
        CAPABLE_OPTIONAL: {
          tone: "bg-gradient-to-br from-warning-bg to-warm",
          ring: "ring-warning-border",
          title: "Print capable · artwork OPTIONAL",
          eyebrow:
            "Stock launcher / planner decides per run · ships without artwork allowed",
          body: "When the Stock Launcher creates a production run, the launcher may attach an approved artwork. If not, the planner can still attach one before release. If neither does, production runs as a warning-print job (date stamps, batch codes, plain) — no artwork ID required.",
          bom: "Ink rows in BOM = ZERO until an artwork is attached on the production order. No fake GSM. Once attached, ink + per-color breakdown appear.",
        },
        REQUIRED: {
          tone: "bg-gradient-to-br from-order-bg to-order-bg",
          ring: "ring-order-border",
          title: "Print compulsory · artwork REQUIRED",
          eyebrow:
            "Artwork-gated production · launcher must pick (default below)",
          body: "Stock Launcher MUST pick an approved artwork at launch time (or planner attaches one before release). The Default fallback below pre-fills the launch form so the launcher just confirms (or overrides). Planner blocks release until an artwork ID is on the production order.",
          bom: "Ink GSM, color list, and ink mapping pulled from the approved artwork and added to BOM weight.",
        },
      }
    : {
        OFF: {
          tone: "bg-gradient-to-br from-surface-2 to-surface-2",
          ring: "ring-line",
          title: "No printing",
          eyebrow: "Plain master",
          body: "Sales cannot attach artwork. Master ships unprinted. Saves an artwork-gate step at planning.",
          bom: "BOM has no ink rows. Weight = layers + chemistry only.",
        },
        CAPABLE_OPTIONAL: {
          tone: "bg-gradient-to-br from-warning-bg to-warm",
          ring: "ring-warning-border",
          title: "Print capable · artwork OPTIONAL",
          eyebrow: "Warning-print mode · ships without artwork",
          body: "Sales MAY attach an approved artwork. If they don't, the order still goes to production as a warning-print run (date stamps, batch codes, plain) — no artwork ID required. No master-level default needed: each order decides.",
          bom: "Ink rows in BOM = ZERO until an artwork is attached on the line. No fake GSM. When an artwork is attached, ink + per-color breakdown appear.",
        },
        REQUIRED: {
          tone: "bg-gradient-to-br from-order-bg to-order-bg",
          ring: "ring-order-border",
          title: "Print compulsory · artwork REQUIRED",
          eyebrow: "Artwork-gated production · default fallback shown below",
          body: "Sales MUST pick an approved artwork before submit. The Default fallback artwork below pre-fills the line so sales just confirms (or overrides). Planner blocks release until an artwork ID is on the line.",
          bom: "Ink GSM, color list, and ink mapping are pulled from the approved artwork and added to BOM weight.",
        },
      };
  const meta = STATE_META[state];

  return (
    <div className="space-y-4">
      {/* The 2 knobs */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => onChange({ print_capable: !printCapable })}
          className={cn(
            "group relative flex items-start gap-3 rounded-2xl border bg-surface-1 px-4 py-3 text-left shadow-sm transition hover:shadow-md",
            printCapable
              ? "border-order-border ring-2 ring-order-border"
              : "border-line",
          )}
        >
          <span
            className={cn(
              "flex h-9 w-9 flex-none items-center justify-center rounded-xl",
              printCapable
                ? "bg-gradient-to-br from-order-fg to-order-fg text-white shadow-md"
                : "bg-surface-2 text-content-3",
            )}
          >
            <Palette className="h-4 w-4" />
          </span>
          <div className="flex-1">
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-order-fg">
              Knob 1
            </div>
            <div className="text-sm font-black text-content-1">
              Print capable
            </div>
            <div className="text-[11px] text-content-3">
              Can this master carry artwork at all? Off = plain unprinted
              master.
            </div>
          </div>
          <span
            className={cn(
              "ml-2 inline-flex h-6 items-center rounded-full px-2 text-[10px] font-black uppercase tracking-wider ring-1",
              printCapable
                ? "bg-order-fg text-white ring-order-border shadow-sm"
                : "bg-surface-2 text-content-3 ring-line",
            )}
          >
            {printCapable ? "ON" : "OFF"}
          </span>
        </button>

        <button
          type="button"
          disabled={!printCapable}
          onClick={() => onChange({ artwork_required: !artworkRequired })}
          className={cn(
            "group relative flex items-start gap-3 rounded-2xl border bg-surface-1 px-4 py-3 text-left shadow-sm transition",
            !printCapable && "opacity-60 cursor-not-allowed",
            printCapable && "hover:shadow-md",
            printCapable && artworkRequired
              ? "border-order-border ring-2 ring-order-border"
              : "border-line",
          )}
        >
          <span
            className={cn(
              "flex h-9 w-9 flex-none items-center justify-center rounded-xl",
              printCapable && artworkRequired
                ? "bg-gradient-to-br from-order-fg to-danger-solid text-white shadow-md"
                : "bg-surface-2 text-content-3",
            )}
          >
            <CheckCircle2 className="h-4 w-4" />
          </span>
          <div className="flex-1">
            <div className="text-[10px] font-black uppercase tracking-[0.18em] text-order-fg">
              Knob 2
            </div>
            <div className="text-sm font-black text-content-1">
              Artwork compulsory
            </div>
            <div className="text-[11px] text-content-3">
              {printCapable
                ? "Block release until artwork is on the line. Off = can dispatch unprinted."
                : "Enable Knob 1 first."}
            </div>
          </div>
          <span
            className={cn(
              "ml-2 inline-flex h-6 items-center rounded-full px-2 text-[10px] font-black uppercase tracking-wider ring-1",
              printCapable && artworkRequired
                ? "bg-order-fg text-white ring-order-border shadow-sm"
                : "bg-surface-2 text-content-3 ring-line",
            )}
          >
            {printCapable && artworkRequired ? "ON" : "OFF"}
          </span>
        </button>
      </div>

      {printCapable ? (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="rounded-2xl border border-line bg-surface-1 p-3 shadow-sm">
            <Label className="text-[10px] font-black uppercase tracking-[0.18em] text-order-fg">
              Allowed print method
            </Label>
            <Select
              value={printType}
              onValueChange={(v) => {
                onChange({ print_type: v as "FLEXO" | "ROTO" });
                if (defaultArtworkId) onChangeDefaultArtwork("");
              }}
            >
              <SelectTrigger className="mt-2 h-10 rounded-xl bg-surface-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="FLEXO">FLEXO · no cylinders required</SelectItem>
                <SelectItem value="ROTO">ROTO · cylinders required</SelectItem>
              </SelectContent>
            </Select>
            <p className="mt-2 text-[11px] leading-4 text-content-3">
              This must match the printing process on the route. Sales,
              planner, and artwork pickers use this value to reject the wrong
              artwork method.
            </p>
          </div>

          <div className="rounded-2xl border border-info-border bg-info-bg p-3 shadow-sm">
            <Label className="text-[10px] font-black uppercase tracking-[0.18em] text-primary">
              Artwork form from pouch style
            </Label>
            <div className="mt-2 flex h-10 items-center justify-between rounded-xl bg-surface-1 px-3 ring-1 ring-info-border">
              <span className="text-sm font-black text-content-1">
                {mixedSubstrateModes ? "MIXED" : substrateMode}
              </span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-content-3">
                {mixedSubstrateModes
                  ? "fallback disabled"
                  : substrateMode === "TUBING"
                  ? "lay-flat tube"
                  : "open web / sheet"}
              </span>
            </div>
            <p className="mt-2 text-[11px] leading-4 text-content-3">
              {mixedSubstrateModes
                ? "Sizes on this master include both SHEET and TUBING forms, so artwork must be selected per order size."
                : "Not a free toggle. Size/pouch-style stock form decides whether approved artwork must be SHEET or TUBING."}
            </p>
          </div>
        </div>
      ) : null}

      {printCapable && incompatibleDefaultArtwork ? (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-danger-border bg-danger-bg px-4 py-3 text-danger-fg">
          <div className="min-w-0 text-xs">
            <div className="font-bold">Saved fallback artwork is incompatible</div>
            <div className="mt-0.5 text-[11px]">
              {(incompatibleDefaultArtwork as any).design_code ||
                incompatibleDefaultArtwork.id}{" "}
              is not {printType} ·{" "}
              {mixedSubstrateModes ? "single-form master" : substrateMode}.
              Pick a compatible artwork or clear the fallback before saving
              this version.
            </div>
          </div>
          <button
            type="button"
            onClick={() => onChangeDefaultArtwork("")}
            className="rounded-full bg-surface-1 px-3 py-1 text-[11px] font-black text-danger-fg ring-1 ring-danger-border"
          >
            Clear
          </button>
        </div>
      ) : null}

      {/* Live combo state — what happens in BOM + sales/planner today */}
      <div
        className={cn(
          "rounded-2xl border px-4 py-3 ring-1 shadow-sm",
          meta.tone,
          meta.ring,
        )}
      >
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "flex h-9 w-9 flex-none items-center justify-center rounded-xl text-white shadow-md",
              state === "OFF" &&
                "bg-gradient-to-br from-surface-2 to-surface-2",
              state === "CAPABLE_OPTIONAL" &&
                "bg-gradient-to-br from-warning-fg to-warm",
              state === "REQUIRED" &&
                "bg-gradient-to-br from-order-fg to-order-fg",
            )}
          >
            <Disc className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="text-[10px] font-black uppercase tracking-[0.22em] text-content-3">
              {meta.eyebrow}
            </div>
            <div className="font-display text-sm font-black text-content-1">
              {meta.title}
            </div>
            <div className="mt-1 text-[12px] text-content-2">{meta.body}</div>
            <div className="mt-2 inline-flex items-start gap-1.5 rounded-lg bg-surface-1/80 px-2.5 py-1.5 text-[11px] font-semibold text-content-2 ring-1 ring-surface-1/40">
              <span className="font-black uppercase text-[9px] tracking-wider text-content-3">
                BOM
              </span>
              <span>{meta.bom}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Default fallback artwork — shown ONLY when BOTH knobs are on
 (artwork is required). When artwork is optional we don't surface
 a default: each order decides whether to attach an artwork or
 run as a warning-print order, so a master-level default would be
 misleading. Until any artwork is on the line, the BOM resolver
 writes ZERO ink rows — no fake GSM. */}
      {printCapable && artworkRequired ? (
        <div className="rounded-2xl border border-order-border bg-gradient-to-br from-order-bg via-white to-danger-bg p-3 shadow-sm ring-1 ring-order-border">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <Label className="text-[10px] font-black uppercase tracking-[0.18em] text-order-fg">
              Default fallback artwork (optional pre-fill)
            </Label>
            <span className="text-[10px] font-bold text-content-3">
              {artworks.length} compatible approved artworks
            </span>
          </div>
          <Select
            value={defaultArtworkId || "__none"}
            onValueChange={(v) =>
              onChangeDefaultArtwork(v === "__none" ? "" : v)
            }
          >
            <SelectTrigger className="h-10 rounded-xl bg-surface-1">
              <SelectValue placeholder="— No default · sales picks per order —" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">
                — No default · sales picks per order —
              </SelectItem>
              {incompatibleDefaultArtwork ? (
                <SelectItem
                  value={String(incompatibleDefaultArtwork.id)}
                  disabled
                >
                  Incompatible ·{" "}
                  {(incompatibleDefaultArtwork as any).design_code ||
                    incompatibleDefaultArtwork.id}
                </SelectItem>
              ) : null}
              {artworks.map((a) => (
                <SelectItem key={a.id} value={String(a.id)}>
                  {(a as any).design_code || a.id}
                  {a.name ? ` · ${a.name}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="mt-1.5 text-[10px] text-content-3">
            Pre-fills the sales line so the packer/planner sees an artwork as
            soon as the order is created. Sales can override per order. Customer
            overlay also overrides this. <strong>BOM ink stays at zero</strong>{" "}
            until an artwork is actually on the line.
          </div>
        </div>
      ) : null}

      {/* When print-capable but artwork is OPTIONAL we explicitly DON'T
 surface a master-level default artwork. Tell the admin why so
 they don't go hunting for it. */}
      {printCapable && !artworkRequired ? (
        <div className="flex items-start gap-2 rounded-xl border border-warning-border bg-warning-bg px-3 py-2 text-[11px] text-warning-fg">
          <Disc className="mt-0.5 h-3.5 w-3.5 flex-none text-warning-fg" />
          <span>
            No master-level default artwork because artwork is{" "}
            <strong>optional</strong> for this master. Each order decides at
            sales time: attach an artwork → ink + colors come from it · skip →
            warning-print run with <strong>zero ink</strong> in BOM. Turn on
            Knob 2 above if you want to set a default pre-fill.
          </span>
        </div>
      ) : null}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AxisAllowedRegistry — section 7 of the edit workspace.
//
// For each catalog-backed axis (packaging_inner, packaging_outer, pod_variant,
// addons), shows the multiple allowed catalog codes the master accepts, with
// chip-style add/remove. Sales picks from this registry at order time — the
// multiplicity rule below is informational (admin still controls it via the
// existing variant_axes.required toggle in section 4).
// ─────────────────────────────────────────────────────────────────────────────

type RegistryEntry = {
  axis: VariantAxisDef["axis"];
  label: string;
  productKinds?: string[]; // when set, only render for these product kinds
  source: "packaging_material" | "pod_sku_variant" | "addon";
  packagingKind?:
    | "INNER_POUCH"
    | "GONNY"
    | "SHEET"
    | "BOX"
    | "TAPE"
    | "LABEL"
    | "TAG";
  multiplicity: "one" | "many";
  multiplicityCopy: string;
  tone: { bg: string; ring: string; text: string };
  consumption: string;
};

// PM-locked packing rows (gunny/sheet/EOD extras) intentionally dropped — those
// are now tagged by packing yard at EOD per order (see /logistics/packing).
// Only inner-pouch (POUCH-only, has real per-customer pcs_per_inner variance),
// POD, and add-ons live on the master.
const AXIS_REGISTRY: RegistryEntry[] = [
  {
    axis: "packaging_inner",
    label: "Inner pouch",
    productKinds: ["POUCH"],
    source: "packaging_material",
    packagingKind: "INNER_POUCH",
    multiplicity: "one",
    multiplicityCopy: "Sales picks 1 per order",
    tone: {
      bg: "bg-warning-bg",
      ring: "ring-warning-border",
      text: "text-warning-fg",
    },
    consumption: "auto · ceil(total_pouches / pcs_per_inner)",
  },
  {
    axis: "pod_variant",
    label: "POD variant",
    source: "pod_sku_variant",
    multiplicity: "one",
    multiplicityCopy: "Sales picks 1 per order",
    tone: {
      bg: "bg-order-bg",
      ring: "ring-order-border",
      text: "text-order-fg",
    },
    consumption: "1 per pouch · auto-demand on shortage",
  },
  {
    axis: "addons",
    label: "Add-ons (zipper, valve, spout, etc.)",
    source: "addon",
    multiplicity: "many",
    multiplicityCopy: "Sales picks any number per order",
    tone: {
      bg: "bg-danger-bg",
      ring: "ring-danger-border",
      text: "text-danger-fg",
    },
    consumption: "Per-piece · multiplied by order qty",
  },
];

function AxisAllowedRegistry({
  draft,
  packagingMaterials,
  podVariants,
  addonCatalog,
  onToggleCode,
  onSetAxisFlags,
  onPatchOptions,
  onPatchFixed,
}: {
  draft: ProductMaster;
  packagingMaterials: PackagingMaterial[];
  podVariants: PodSkuVariant[];
  addonCatalog: Addon[];
  onToggleCode: (axis: VariantAxisDef["axis"], code: string) => void;
  onSetAxisFlags: (
    axis: VariantAxisDef["axis"],
    patch: { required?: boolean; auto_demand_in_house?: boolean },
  ) => void;
  onPatchOptions: (axis: VariantAxisDef["axis"], options: string[]) => void;
  onPatchFixed: (patch: Record<string, any>) => void;
}) {
  const kind = String(draft.product_kind || "").toUpperCase();
  const visible = AXIS_REGISTRY.filter(
    (r) => !r.productKinds || r.productKinds.includes(kind),
  );
  return (
    <div className="space-y-3">
      {visible.map((entry, i) => (
        <AxisAllowedCard
          key={`${entry.axis}-${entry.packagingKind || "any"}-${i}`}
          entry={entry}
          draft={draft}
          packagingMaterials={packagingMaterials}
          podVariants={podVariants}
          addonCatalog={addonCatalog}
          onToggleCode={onToggleCode}
          onSetAxisFlags={onSetAxisFlags}
          onPatchOptions={onPatchOptions}
          onPatchFixed={onPatchFixed}
        />
      ))}
    </div>
  );
}

function AxisAllowedCard({
  entry,
  draft,
  packagingMaterials,
  podVariants,
  addonCatalog,
  onToggleCode,
  onSetAxisFlags,
  onPatchFixed,
}: {
  entry: RegistryEntry;
  draft: ProductMaster;
  packagingMaterials: PackagingMaterial[];
  podVariants: PodSkuVariant[];
  addonCatalog: Addon[];
  onToggleCode: (axis: VariantAxisDef["axis"], code: string) => void;
  onSetAxisFlags: (
    axis: VariantAxisDef["axis"],
    patch: { required?: boolean; auto_demand_in_house?: boolean },
  ) => void;
  onPatchOptions: (axis: VariantAxisDef["axis"], options: string[]) => void;
  onPatchFixed: (patch: Record<string, any>) => void;
}) {
  const axisRow = findAxisOnDraft(draft.variant_axes, String(entry.axis));
  const allowedCodes: string[] = Array.isArray((axisRow as any)?.options)
    ? ((axisRow as any).options as any[])
        .map((o) =>
          typeof o === "string" || typeof o === "number"
            ? String(o)
            : String(o?.code || o?.value || o?.id || ""),
        )
        .filter(Boolean)
    : [];

  // Build the picker's catalog list — filtered by source & packaging_kind.
  const allCatalogRows: Array<{ code: string; name: string }> = (() => {
    if (entry.source === "packaging_material") {
      const filtered = entry.packagingKind
        ? packagingMaterials.filter((m) => {
            const k = String((m as any).packaging_kind || "").toUpperCase();
            const want: string[] =
              entry.packagingKind === "GONNY"
                ? ["GONNY", "GUNNY"]
                : [String(entry.packagingKind)];
            return want.includes(k);
          })
        : packagingMaterials;
      return filtered.map((m) => ({ code: m.code, name: m.name || m.code }));
    }
    if (entry.source === "pod_sku_variant") {
      return podVariants.map((p) => ({
        code: p.code,
        name: p.name || p.pod_sku_name || p.code,
      }));
    }
    return addonCatalog.map((a) => ({ code: a.code, name: a.name || a.code }));
  })();

  // Rows that are NOT yet allowed — show them in the "add" picker.
  const pickable = allCatalogRows.filter((r) => !allowedCodes.includes(r.code));

  const required = Boolean(axisRow?.required);
  const autoDemand = Boolean((axisRow as any)?.auto_demand_in_house);
  const defaultInnerPcs =
    entry.axis === "packaging_inner"
      ? defaultPrimaryInnerPcs(draft.fixed_attributes)
      : 0;

  return (
    <div
      className={cn(
        "rounded-2xl ring-1 px-4 py-3",
        entry.tone.bg,
        entry.tone.ring,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div
            className={cn(
              "text-[10px] font-black uppercase tracking-[0.18em]",
              entry.tone.text,
            )}
          >
            {entry.label}
          </div>
          <div className="mt-0.5 text-[11px] font-bold text-content-2">
            {entry.multiplicityCopy}
            <span className="ml-1 text-content-3 font-medium">
              · {entry.consumption}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
          <span
            className={cn(
              "inline-flex items-center rounded-full px-2 py-0.5 font-bold ring-1",
              entry.multiplicity === "one"
                ? "bg-surface-1 text-content-2 ring-line"
                : "bg-surface-1 text-content-2 ring-line",
            )}
          >
            {entry.multiplicity === "one" ? "pick 1" : "pick many"}
          </span>
          <button
            type="button"
            onClick={() => onSetAxisFlags(entry.axis, { required: !required })}
            className={cn(
              "inline-flex items-center rounded-full px-2 py-0.5 font-bold ring-1",
              required
                ? "bg-primary text-white ring-primary"
                : "bg-surface-1 text-content-3 ring-line hover:bg-surface-2",
            )}
            title="Toggle required/optional"
          >
            {required ? "required" : "optional"}
          </button>
          {entry.source !== "addon" ? (
            <button
              type="button"
              onClick={() =>
                onSetAxisFlags(entry.axis, {
                  auto_demand_in_house: !autoDemand,
                })
              }
              className={cn(
                "inline-flex items-center rounded-full px-2 py-0.5 font-bold ring-1",
                autoDemand
                  ? "bg-success-fg text-white ring-success-border"
                  : "bg-surface-1 text-content-3 ring-line hover:bg-surface-2",
              )}
              title="Auto-fire in-house stock launcher on shortage"
            >
              auto-demand {autoDemand ? "on" : "off"}
            </button>
          ) : null}
        </div>
      </div>

      {/* Allowed code chips */}
      <div className="mt-3">
        <div className="text-[10px] font-bold uppercase tracking-wider text-content-3 mb-1">
          Allowed codes · {allowedCodes.length}
        </div>
        {allowedCodes.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line-strong bg-surface-1/40 px-3 py-2 text-[11px] italic text-content-3">
            No allowed codes yet — add at least one so sales can pick this{" "}
            {entry.label.toLowerCase()} on an order.
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {allowedCodes.map((code) => {
              const meta = allCatalogRows.find((r) => r.code === code);
              return (
                <span
                  key={code}
                  className="inline-flex items-center gap-1 rounded-md bg-surface-1 px-2 py-0.5 text-[11px] font-mono font-bold text-content-2 ring-1 ring-line"
                >
                  {code}
                  {meta?.name && meta.name !== code ? (
                    <span className="text-[10px] font-medium text-content-3">
                      {" "}
                      · {meta.name}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => onToggleCode(entry.axis, code)}
                    className="ml-0.5 rounded-full p-0.5 text-danger-fg hover:bg-danger-bg"
                    title="Remove from allowed list"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              );
            })}
          </div>
        )}
      </div>

      {entry.axis === "packaging_inner" ? (
        <div className="mt-3 rounded-xl border border-warning-border bg-surface-1/70 px-3 py-2">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[180px]">
              <div className="text-[10px] font-bold uppercase tracking-wider text-warning-fg">
                Default pcs / inner
              </div>
              <Input
                type="number"
                min={1}
                step={1}
                value={defaultInnerPcs || ""}
                placeholder="e.g. 100"
                onChange={(e) =>
                  onPatchFixed(
                    primaryInnerPackPatch(
                      draft.fixed_attributes,
                      allowedCodes[0] || "",
                      Number(e.target.value),
                      packagingMaterials,
                    ),
                  )
                }
                className="mt-1 h-9 rounded-lg border-warning-border bg-surface-1 font-mono text-xs font-bold"
              />
            </div>
            <div className="max-w-xl text-[11px] leading-5 text-warning-fg">
              Sales can override per order; customer overlay can override per
              customer. Blank uses the selected inner-pouch catalog row default.
            </div>
          </div>
        </div>
      ) : null}

      {/* Add picker */}
      <div className="mt-3">
        <div className="text-[10px] font-bold uppercase tracking-wider text-content-3 mb-1">
          Add from catalog · {pickable.length} available
        </div>
        {pickable.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line bg-surface-1/40 px-3 py-2 text-[11px] italic text-content-3">
            All matching catalog rows are already allowed.
          </div>
        ) : (
          <Select
            value=""
            onValueChange={(v) => {
              if (v) onToggleCode(entry.axis, v);
            }}
          >
            <SelectTrigger className="h-9 rounded-lg bg-surface-1 text-xs">
              <SelectValue placeholder="Pick a catalog row to allow…" />
            </SelectTrigger>
            <SelectContent>
              {pickable.map((r) => (
                <SelectItem key={r.code} value={r.code}>
                  <span className="font-mono font-bold">{r.code}</span>
                  {r.name && r.name !== r.code ? (
                    <span className="ml-2 text-content-3 text-xs">
                      {r.name}
                    </span>
                  ) : null}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  );
}

function defaultPrimaryInnerPcs(fixed?: Record<string, any>) {
  const direct = Number(fixed?.primary_inner_pack?.pcs_per_pack || 0);
  if (Number.isFinite(direct) && direct > 0) return direct;
  const lines = fixed?.packaging_lines;
  if (!Array.isArray(lines)) return 0;
  const row = lines.find(
    (line: any) =>
      canonicalAxisKey(String(line?.role || "")) === "primary_inner" ||
      String(line?.role || "").toUpperCase() === "PRIMARY_INNER",
  );
  const pcs = Number(row?.pcs_per_pack || 0);
  return Number.isFinite(pcs) && pcs > 0 ? pcs : 0;
}

function primaryInnerPackPatch(
  fixed: Record<string, any> | undefined,
  materialCode: string,
  pcsRaw: number,
  materials: PackagingMaterial[],
) {
  const pcs = Number.isFinite(pcsRaw) && pcsRaw > 0 ? Math.floor(pcsRaw) : 0;
  const picked = materials.find(
    (m) =>
      String(m.code || "").toUpperCase() ===
      String(materialCode || "").toUpperCase(),
  );
  const currentLines = Array.isArray(fixed?.packaging_lines)
    ? fixed?.packaging_lines
    : [];
  const primaryLine = {
    role: "PRIMARY_INNER",
    material: picked?.id || null,
    material_id: picked?.id || null,
    material_code: picked?.code || materialCode || "",
    material_name: picked?.name || "",
    uom: picked?.base_uom || "PCS",
    supply_mode: picked?.packaging_supply_mode || "",
    packaging_kind: picked?.packaging_kind || "INNER_POUCH",
    basis: "PCS_PER_PACK",
    pcs_per_pack: pcs || undefined,
  };
  const kept = currentLines.filter(
    (line: any) => String(line?.role || "").toUpperCase() !== "PRIMARY_INNER",
  );
  return {
    primary_inner_pack: {
      enabled: pcs > 0,
      material_id: picked?.id || null,
      material_code: picked?.code || materialCode || "",
      material_name: picked?.name || "",
      supply_mode: picked?.packaging_supply_mode || "",
      packaging_kind: picked?.packaging_kind || "INNER_POUCH",
      basis: "PCS_PER_PACK",
      pcs_per_pack: pcs || undefined,
    },
    packaging_lines: pcs > 0 ? [primaryLine, ...kept] : kept,
  };
}

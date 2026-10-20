"use client";

import { PmStepNav } from "./pm-step-nav";
import { SpecPlate } from "@/components/plate/spec-plate";
import { specFromMasterLine } from "@/components/plate/spec-from-master";
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
import { FieldLabelProvider } from "@/components/ui/field-label";
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
    axis: "layer_material_overrides",
    type: "per_layer_material_enum",
    label: "Per-layer film variant",
  },
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
  const filmOptions = normalizeLayerFilmOptions(row, filmCode);
  return {
    role: row?.role || row?.layer_role || row?.layer || `layer-${index + 1}`,
    film_variant_code: filmCode,
    film_variant_id: row?.film_variant_id || row?.material_id || null,
    film_variant_options: filmOptions,
    allowed_film_variant_codes: filmOptions,
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
    setup_pending: Boolean(
      row?.setup_pending || row?.material_setup_pending || row?.layer_setup_pending,
    ),
  };
}

function normalizeLayerFilmOptions(row: any, defaultCode?: string): string[] {
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
  pushCode(defaultCode);
  keys.forEach((key) => pushCode(row?.[key]));
  return Array.from(new Set(codes));
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

function variantAxisDefsForProductKind(
  kind: string | undefined | null,
  defs: VariantAxisDef[] = AXIS_DEFS,
): VariantAxisDef[] {
  const normalized = String(kind || "").toUpperCase();
  if (isProductionMasterKind(normalized)) {
    return defs.filter(
      (axis) =>
        !PRODUCTION_MASTER_CATALOG_AXES.has(
          canonicalAxisKey(String(axis.axis)),
        ),
    );
  }
  if (normalized !== "POUCH") {
    return defs.filter(
      (axis) => canonicalAxisKey(String(axis.axis)) !== "packaging_inner",
    );
  }
  return defs;
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
  return "Fixed by this master: sales does not choose it.";
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
  const customerFacingCode =
    draft?.display_code ||
    draft?.version_group ||
    String(draft?.code || "").replace(/-V\d+$/i, "");

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
      const sizePayloads = draftSizes.map((size) => {
        const {
          product_master,
          product_master_code,
          product_master_name,
          created_at,
          updated_at,
          ...payload
        } = size as any;
        return { id: String(size.id || "").startsWith("tmp-") ? undefined : size.id, ...payload };
      });
      return productMasterService.workspaceSave(productId, {
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
        sizes: sizePayloads,
      });
    },
    onSuccess: async (saved) => {
      queryClient.invalidateQueries({
        queryKey: ["product-master", productId],
      });
      queryClient.invalidateQueries({
        queryKey: ["product-master-sizes", productId],
      });
      queryClient.invalidateQueries({
        queryKey: ["product-master-template", productId],
      });
      queryClient.invalidateQueries({ queryKey: ["product-masters"] });
      queryClient.invalidateQueries({ queryKey: ["planner-control-hub-pq-v3"] });
      queryClient.invalidateQueries({ queryKey: ["planner-control-hub-ct-v3"] });
      const revision = saved.revision_summary;
      toast({
        title: "Product Master saved",
        description: revision
          ? `${revision.refreshed} open line(s) revised; ${revision.queues_rebuilt || 0} untouched planner queue(s) rebuilt. ${revision.skipped || 0} released, allocated, or started line(s) stayed frozen.`
          : "Open demand follows the saved master. Released, allocated, consumed, or started work stays frozen for audit.",
      });
      router.push(`/master/products/${saved.id}`);
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
  // A lamination pass joins two webs: a product with N layers runs N - 1 passes; any
  // further pass on the shared route is skipped for this product.
  const laminationPassesNeeded = Math.max(0, (draft.layer_template?.length || 0) - 1);
  let laminationPassSeen = 0;
  const routeSteps = (routeInfo?.route_steps || []).map((step) => {
    const isLamination = String(step.roll_behavior || "").toUpperCase() === "MULTI_INPUT_COMBINE";
    if (isLamination) laminationPassSeen += 1;
    const skipped = isLamination && laminationPassSeen > laminationPassesNeeded;
    return {
    skipped,
    skipReason: skipped
      ? laminationPassesNeeded === 0
        ? "skipped · 1 layer"
        : `skipped · ${draft.layer_template.length} layers`
      : undefined,
    index: step.index,
    label: step.name || step.process_code || `Step ${step.index}`,
    transition: step.transition,
    tag: step.roll_behavior,
    artwork_step: !!step.has_artwork,
    routeNodeId: step.route_node_id,
    branchKey: step.branch_key,
    joinKey: step.join_key,
    parallelGroup: step.parallel_group,
    predecessorNodeIds: step.predecessor_node_ids,
    successorNodeIds: step.successor_node_ids,
    isJoin: !!step.is_join,
    isParallelStart: !!step.is_parallel_start,
    };
  });
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
  const pendingLayerCount = draft.layer_template.filter(
    (layer) => layer.setup_pending || !layer.film_variant_code,
  ).length;
  const layerMaterialStack = draft.layer_template
    .map((layer, index) => layer.film_variant_code || `L${index + 1} pending`)
    .join(" / ");
  const enabledAxisLabels = visibleVariantAxes
    .filter((axis) => axisMode(axis) !== "off")
    .map((axis) => axis.label || String(axis.axis).replace(/_/g, " "));
  const visibleAxisDefs = variantAxisDefsForProductKind(
    draft.product_kind,
  ).filter((def) => def.axis !== "artwork_mode");
  const adHocAxisLabels = visibleVariantAxes
    .filter((axis) => Boolean(axis.allow_ad_hoc || axis.allow_custom))
    .map((axis) => axis.label || String(axis.axis).replace(/_/g, " "));
  const catalogAxisLabels = visibleVariantAxes
    .filter((axis) => Boolean(axis.master_data_source))
    .map((axis) => axis.label || String(axis.axis).replace(/_/g, " "));
  const routeSourceCopy =
    draft.fixed_attributes?.film_source === "PURCHASED"
      ? "Purchase film allotment"
      : "Create roll step when route recipe is present";
  const issuePolicyCopy = draft.fixed_attributes?.issue_policy_name
    ? String(draft.fixed_attributes.issue_policy_name)
    : "Template default; order override allowed with reason";

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
            setup_pending: true,
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
    patch: {
      required?: boolean;
      auto_demand_in_house?: boolean;
      allow_ad_hoc?: boolean;
      allow_custom?: boolean;
    },
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
      {(() => {
        const kind = String(draft.product_kind || "").toUpperCase();
        const isProductionMaster = kind === "PACKAGING" || kind === "POD";
        return (
          <>
            <RichHero
              eyebrow={
                isProductionMaster
                  ? `Production master · Edit · ${customerFacingCode}`
                  : `Master · Edit · ${customerFacingCode}`
              }
              title={draft.name || "Untitled product master"}
              subtitle={
                isProductionMaster
                  ? `${kind} production master · launched by the Stock Launcher (not sold to customers). Each variant must be manually linked to an existing fixed SKU in /master/${kind === "PACKAGING" ? "packaging" : "pod"} before in-house consumption can use it.`
                  : "The full engineering contract: route, sizes, layers, axes, printing. Saving refreshes clean open demand while released orders keep their frozen audit snapshot."
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
            <div className="flex flex-wrap items-center gap-2 rounded-[14px] bg-surface-2 px-4 py-2.5 text-[12.5px] text-content-3">
              <span className="font-medium text-content-2">Active on save.</span>
              Clean open demand picks up the change; released, allocated or started lines keep their original snapshot for audit.
            </div>
            {/* Production-master banner — surfaces the manual
 catalog-link model and reminds the admin this isn't
 a sales master. */}
            {isProductionMaster ? (
              <div className="rounded-[16px] border border-line bg-surface-1 px-4 py-3 shadow-[var(--shadow-sm)]">
                <div className="flex flex-wrap items-start gap-3">
                  <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-surface-2 text-content-2 ring-1 ring-line">
                    <Workflow className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-caption font-semibold uppercase tracking-[0.12em] text-order-fg">
                      Production master · stock launcher only
                    </div>
                    <div className="font-display text-sm font-semibold text-content-1 mt-0.5">
                      Sales doesn&apos;t pick this · planner launches in-house
                      production after manual SKU link
                    </div>
                    <div className="mt-1 text-caption text-content-2 leading-relaxed">
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
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-surface-1 px-3 text-caption font-bold text-order-fg ring-1 ring-order-border hover:bg-order-bg"
                  >
                    Open catalog <ArrowRight className="h-3.5 w-3.5" />
                  </a>
                </div>
              </div>
            ) : null}
          </>
        );
      })()}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[188px_minmax(0,1fr)_360px]">
        <PmStepNav className="xl:col-span-2 2xl:col-span-1" />
        <div className="min-w-0 space-y-6">
          <div className="flex items-baseline gap-3 px-1 pt-2" data-testid="pm-group-1">
            <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-content-4">Part 1</span>
            <div className="min-w-0">
              <div className="text-[18px] font-semibold tracking-[-0.015em] text-content-1">What it is</div>
              <div className="text-[12.5px] text-content-3">Name, kind, route and the rules every order of this product follows</div>
            </div>
          </div>
          <RichSection
            id="pm-basics"
            index={1}
            tone="indigo"
            icon={<Workflow className="h-5 w-5" />}
            eyebrow="Basics"
            title="Name, kind and route"
            subtitle="What sales and the planner see first. The route is the live template this product runs on."
          >
            <div className="space-y-4">
              {/* Top row · code + reporting group as tonal cards */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <FormField label="Master reference" tone="indigo">
                  <div className="flex h-10 items-center rounded-xl border border-border/70 bg-surface-1/80 px-3 font-mono text-sm font-bold text-content-1">
                    {customerFacingCode || "Assigned on save"}
                  </div>
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
                              ? "border-warning-border ring-2 ring-warning-border bg-warning-bg"
                              : "border-line hover:border-warning-border hover:bg-warning-bg",
                          )}
                        >
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span
                              className={cn(
                                "font-display text-sm font-semibold",
                                active ? "text-warning-fg" : "text-content-1",
                              )}
                            >
                              {opt.label}
                            </span>
                            {active ? (
                              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-warning-fg text-caption font-semibold text-white shadow ring-2 ring-surface-1">
                                ✓
                              </span>
                            ) : null}
                          </div>
                          <div
                            className={cn(
                              "text-caption leading-snug",
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
                    ? "border-success-border bg-success-bg ring-success-border"
                    : "border-danger-border bg-danger-bg ring-danger-border",
                )}
              >
                <div className="flex items-center gap-3">
                  <span
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-xl text-white",
                      draft.active
                        ? "bg-plate"
                        : "bg-plate",
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
                        "font-display text-sm font-semibold",
                        draft.active ? "text-success-fg" : "text-danger-fg",
                      )}
                    >
                      {draft.active
                        ? "Active — sales & planner can pick"
                        : "Inactive — hidden from sales & planner"}
                    </div>
                    <div className="text-caption text-content-3">
                      Saved as part of the master record.
                    </div>
                  </div>
                </div>
                <Switch
                  checked={draft.active}
                  onCheckedChange={(v) => patchDraft({ active: v })}
                  aria-label="Master active"
                />
              </div>
            </div>

            <div className="mt-5">
              <div className="mb-2 flex items-center justify-between">
                <Label className="text-[12px] font-semibold text-content-2">
                  Live route preview
                </Label>
                <span className="text-caption text-content-3">
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
            id="pm-rules"
            index={2}
            tone="emerald"
            icon={<CheckCircle2 className="h-5 w-5" />}
            eyebrow="Summary"
            title="Rules every order of this product follows"
            subtitle="A read-only summary of the layers, what sales can change, and where the BOM comes from."
          >
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
              <div className="rounded-[14px] bg-surface-2 p-3.5">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-[12.5px] font-semibold text-content-1">
                    Layer contract
                  </span>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-caption font-semibold ring-1",
                      pendingLayerCount
                        ? "bg-warning-bg text-warning-fg ring-warning-border"
                        : "bg-success-bg text-success-fg ring-success-border",
                    )}
                  >
                    {pendingLayerCount ? `${pendingLayerCount} pending` : "ready"}
                  </span>
                </div>
                <div className="font-display text-lg font-semibold text-content-1">
                  {draft.layer_template.length} layer
                  {draft.layer_template.length === 1 ? "" : "s"}
                </div>
                <div className="mt-1 font-mono text-caption font-bold text-content-2">
                  {layerMaterialStack || "No layers yet"}
                </div>
                <div className="mt-2 text-caption leading-5 text-content-3">
                  Thickness and grade are per-layer axes only. Sales labels show
                  thickness separately from layer material codes.
                </div>
              </div>

              <div className="rounded-[14px] bg-surface-2 p-3.5">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-[12.5px] font-semibold text-content-1">
                    Order axes
                  </span>
                  <span className="rounded-full bg-surface-1 px-2 py-0.5 text-caption font-semibold text-order-fg ring-1 ring-order-border">
                    {enabledAxisLabels.length || 0} enabled
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {(enabledAxisLabels.length ? enabledAxisLabels : ["No axes"]).map(
                    (label) => (
                      <span
                        key={label}
                        className="rounded-full bg-surface-1 px-2 py-1 text-caption font-bold text-content-2 ring-1 ring-line"
                      >
                        {label}
                      </span>
                    ),
                  )}
                </div>
                <div className="mt-3 rounded-xl border border-dashed border-order-border bg-surface-1/70 px-2 py-2 text-caption text-content-3">
                  Sales may add new values only for:
                  <strong className="ml-1 text-order-fg">
                    {adHocAxisLabels.length ? adHocAxisLabels.join(", ") : "none"}
                  </strong>
                </div>
              </div>

              <div className="rounded-[14px] bg-surface-2 p-3.5">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-[12.5px] font-semibold text-content-1">
                    Where the BOM comes from
                  </span>
                  <span className="rounded-full bg-surface-1 px-2 py-0.5 text-caption font-semibold text-warning-fg ring-1 ring-warning-border">
                    set by the system
                  </span>
                </div>
                <div className="space-y-2 text-caption leading-5 text-content-2">
                  <div>
                    <strong className="text-content-1">Film:</strong>{" "}
                    {routeSourceCopy}
                  </div>
                  <div>
                    <strong className="text-content-1">Issue policy:</strong>{" "}
                    {issuePolicyCopy}
                  </div>
                  <div>
                    <strong className="text-content-1">Catalog axes:</strong>{" "}
                    {catalogAxisLabels.length
                      ? catalogAxisLabels.join(", ")
                      : "none"}
                  </div>
                </div>
              </div>
            </div>
          </RichSection>

          <div className="flex items-baseline gap-3 px-1 pt-2" data-testid="pm-group-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-content-4">Part 2</span>
            <div className="min-w-0">
              <div className="text-[18px] font-semibold tracking-[-0.015em] text-content-1">What is fixed</div>
              <div className="text-[12.5px] text-content-3">Layers, printing and adhesive · sales cannot change these</div>
            </div>
          </div>
          <RichSection
            id="pm-layers"
            index={3}
            tone="blue"
            icon={<Boxes className="h-5 w-5" />}
            eyebrow="Layers"
            title="Layers: film, micron and grade"
            subtitle="Each layer has a default film. Micron and grade are fixed, or chosen per order within the limits set here. Other films can be allowed per layer."
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
            <p className="mt-3 flex items-center gap-1.5 text-caption text-content-3">
              <AlertTriangle className="h-3.5 w-3.5 text-warning-fg" />
              Total default thickness{" "}
              <strong className="ml-1 text-content-2">
                {totalThickness} μ
              </strong>
              . No global thickness or grade — per-layer only.
            </p>
          </RichSection>

          <RichSection
            id="pm-printing"
            index={4}
            tone="fuchsia"
            icon={<Palette className="h-5 w-5" />}
            eyebrow="Printing"
            title="Can it be printed, and must artwork be ready first?"
            subtitle="Print capable lets orders carry artwork. Artwork compulsory stops release until approved artwork is attached."
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
              id="pm-chemistry"
              index={5}
              tone="amber"
              icon={<Package className="h-5 w-5" />}
              eyebrow="Adhesive & solvent"
              title="Adhesive & solvent defaults"
              subtitle="One adhesive + one solvent per master. GSM × area flows into live BOM, sales orders, WIP, and dispatch consumption."
            >
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                <div className="rounded-xl border border-line bg-surface-1 p-3">
                  <div className="mb-3 flex items-start gap-2">
                    <Package className="mt-0.5 h-4 w-4 text-success-fg" />
                    <div>
                      <div className="text-sm font-semibold text-content-1">
                        Adhesive
                      </div>
                      <div className="text-caption text-content-3">
                        Consumed from selected adhesive master by GSM × area.
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-3">
                    <div>
                      <Label className="text-[12px] font-semibold text-content-2">
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
                          {adhesiveOptions.map((m: Material, index) => (
                            <SelectItem
                              key={`${m.id || m.code}-${index}`}
                              value={m.id || m.code}
                            >
                              {m.code} · {m.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-[12px] font-semibold text-content-2">
                        GSM
                      </Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        aria-label="Adhesive GSM"
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
                    <div className="mt-2 rounded-lg bg-success-bg px-2 py-1.5 text-caption font-semibold text-success-fg">
                      {draft.fixed_attributes.adhesive_material_code} ·{" "}
                      {draft.fixed_attributes.adhesive_gsm || 0} GSM
                    </div>
                  ) : null}
                </div>

                <div className="rounded-xl border border-line bg-surface-1 p-3">
                  <div className="mb-3 flex items-start gap-2">
                    <Disc className="mt-0.5 h-4 w-4 text-info-fg" />
                    <div>
                      <div className="text-sm font-semibold text-content-1">
                        Solvent
                      </div>
                      <div className="text-caption text-content-3">
                        Consumed from selected solvent master by GSM × area.
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-3">
                    <div>
                      <Label className="text-[12px] font-semibold text-content-2">
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
                          {solventOptions.map((m: Material, index) => (
                            <SelectItem
                              key={`${m.id || m.code}-${index}`}
                              value={m.id || m.code}
                            >
                              {m.code} · {m.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-[12px] font-semibold text-content-2">
                        GSM
                      </Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        aria-label="Solvent GSM"
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
                    <div className="mt-2 rounded-lg bg-info-bg px-2 py-1.5 text-caption font-semibold text-info-fg">
                      {draft.fixed_attributes.solvent_material_code} ·{" "}
                      {draft.fixed_attributes.solvent_gsm || 0} GSM
                    </div>
                  ) : null}
                </div>
              </div>
            </RichSection>
          ) : null}

          <div className="flex items-baseline gap-3 px-1 pt-2" data-testid="pm-group-3">
            <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-content-4">Part 3</span>
            <div className="min-w-0">
              <div className="text-[18px] font-semibold tracking-[-0.015em] text-content-1">What sales choose</div>
              <div className="text-[12.5px] text-content-3">Allowed axes, sizes and add-ons an order may pick</div>
            </div>
          </div>
          <RichSection
            id="pm-sales-choices"
            index={isMultiLayer ? 6 : 5}
            tone="violet"
            icon={<Workflow className="h-5 w-5" />}
            eyebrow="What sales can change"
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
                  <div className="mb-3 flex items-start gap-2 rounded-xl border border-warning-border bg-warning-bg px-3 py-2 text-caption text-warning-fg">
                    <Package className="mt-0.5 h-4 w-4 flex-none text-warning-fg" />
                    <span>
                      <strong>Inner pouch axis</strong> below lets sales pick
                      which inner-pouch SKU goes with this pouch. Customer
                      overlay can override{" "}
                      <code className="rounded bg-warning-bg px-1 font-mono text-caption text-warning-fg">
                        pcs_per_inner
                      </code>
                      . All other packing (gunny, sheet, tape, label, tag) is
                      ticked at{" "}
                      <a
                        href="/logistics/packing/audit"
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
                  <div className="mb-3 flex items-start gap-2 rounded-xl border border-order-border bg-surface-1 px-3 py-2 text-caption text-order-fg">
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
            <div className="mb-3 rounded-[14px] bg-surface-2 p-3.5">
              <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="text-[12px] font-semibold text-content-2">
                    Sales ad-hoc permissions
                  </div>
                  <div className="mt-0.5 text-caption font-semibold text-content-3">
                    These switches decide whether sales can add a new value inside this Product Master. Off axes stay blocked.
                  </div>
                </div>
                <span className="rounded-full bg-surface-1 px-2 py-0.5 text-caption font-semibold text-success-fg ring-1 ring-success-border">
                  {adHocAxisLabels.length ? `${adHocAxisLabels.length} allowed` : "none allowed"}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {visibleAxisDefs.map((def) => {
                  const found = findAxisOnDraft(
                    draft.variant_axes,
                    String(def.axis),
                  );
                  const mode = axisMode(found);
                  const adHocAllowed = Boolean(
                    (found as any)?.allow_ad_hoc || (found as any)?.allow_custom,
                  );
                  return (
                    <button
                      key={`adhoc-${def.axis}`}
                      type="button"
                      disabled={mode === "off"}
                      onClick={() =>
                        setAxisFlags(def.axis, {
                          allow_ad_hoc: !adHocAllowed,
                          allow_custom: !adHocAllowed,
                        })
                      }
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-caption font-semibold uppercase tracking-wide ring-1 transition",
                        adHocAllowed
                          ? "bg-success-bg text-success-fg ring-success-border"
                          : "bg-surface-1 text-content-3 ring-line hover:bg-surface-2",
                        mode === "off" && "cursor-not-allowed opacity-45",
                      )}
                      title={
                        mode === "off"
                          ? "Enable this axis first"
                          : "Toggle bounded ad-hoc entry in sales and planner"
                      }
                    >
                      {def.label || def.axis}
                      <span className="rounded-full bg-surface-1/70 px-1.5 py-0.5">
                        {mode === "off" ? "off" : adHocAllowed ? "ad-hoc on" : "ad-hoc off"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {visibleAxisDefs.map((def) => {
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
                  const adHocAllowed = Boolean(
                    (found as any)?.allow_ad_hoc || (found as any)?.allow_custom,
                  );
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
                          <div className="text-caption text-content-3">
                            {def.type.replaceAll("_", " ")}
                          </div>
                        </div>
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-caption font-semibold uppercase tracking-wider ring-1 ring-inset",
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
                            "rounded-full px-2 py-1 text-caption font-bold uppercase",
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
                            "rounded-full px-2 py-1 text-caption font-bold uppercase",
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
                            "rounded-full px-2 py-1 text-caption font-bold uppercase",
                            mode === "required"
                              ? "bg-primary text-white shadow-sm"
                              : "text-content-3",
                          )}
                        >
                          Required
                        </button>
                      </div>
                      <div className="mt-2 text-caption text-content-3">
                        {axisModeCopy(mode as "off" | "optional" | "required")}
                      </div>
                      {def.axis === "size" ? (
                        <div className="mt-2 rounded-lg border border-info-border bg-info-bg px-2 py-2 text-caption font-semibold leading-5 text-primary">
                          When allowed, sales can add a new pouch size inside
                          this Product Master. It still resolves through this
                          master&apos;s route, layers, BOM and approval rules.
                        </div>
                      ) : null}
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface-2 px-2 py-1.5">
                        <span className="text-[12px] font-semibold text-content-2">
                          {def.axis === "size" ? "Ad-hoc size in sales" : "Ad-hoc value"}
                        </span>
                        <button
                          type="button"
                          disabled={mode === "off"}
                          onClick={() =>
                            setAxisFlags(def.axis, {
                              allow_ad_hoc: !adHocAllowed,
                              allow_custom: !adHocAllowed,
                            })
                          }
                          className={cn(
                            "rounded-full px-2 py-0.5 text-caption font-semibold uppercase ring-1",
                            adHocAllowed
                              ? "bg-success-bg text-success-fg ring-success-border"
                              : "bg-surface-1 text-content-3 ring-line",
                            mode === "off" &&
                              "cursor-not-allowed opacity-50",
                          )}
                          title="Allow sales/planner to add a bounded value for this Product Master axis"
                        >
                          {adHocAllowed ? "allowed" : "blocked"}
                        </button>
                      </div>
                    </div>
                  );
                })}
            </div>
          </RichSection>

          <RichSection
            id="pm-sizes"
            index={isMultiLayer ? 7 : 6}
            tone="emerald"
            icon={<span className="text-lg leading-none">📐</span>}
            eyebrow="Sizes & web width"
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

          {/* Sales-pickable menu — only for sales-facing masters
 (POUCH / ROLL / OTHER). PACKAGING + POD masters are
 production masters, not sales masters: sales never picks
 them, the stock launcher launches them. Hiding this
 section keeps the surface honest. */}
          {String(draft.product_kind || "").toUpperCase() === "PACKAGING" ||
          String(draft.product_kind || "").toUpperCase() === "POD" ? null : (
            <RichSection
              id="pm-addons"
              index={isMultiLayer ? 8 : 7}
              tone="violet"
              icon={<Workflow className="h-5 w-5" />}
              eyebrow="Add-ons & packing"
              title="What sales can add: inner pouch, POD, add-ons"
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

        <aside tabIndex={0} aria-label="Live preview" className="grid content-start gap-4 md:grid-cols-2 xl:sticky xl:top-16 xl:max-h-[calc(100vh-5rem)] xl:grid-cols-1 xl:self-start xl:overflow-y-auto xl:pr-1">
          {(() => {
            const kind = String(draft.product_kind || "").toUpperCase();
            const visualKind =
              outputKind === "ROLL" || outputKind === "POUCH"
                ? outputKind
                : kind;
            const usesProductVisual =
              visualKind === "POUCH" || visualKind === "ROLL";
            const firstSize = draftSizes.find((row: any) => row.active !== false) || draftSizes[0];
            const fixed = draft.fixed_attributes || {};
            const adhesiveGsm = Number(fixed.adhesive_gsm || 0) + Number(fixed.solvent_gsm || 0);
            return (
              <>
                <SpecPlate
                  data={specFromMasterLine({
                    layers: draft.layer_template,
                    size: firstSize,
                    showRanges: true,
                  })}
                  caption="Spec plate"
                  captionRight={
                    <span className="text-plate-fg-3">
                      {firstSize ? `first active size · ${firstSize.code}` : "no size yet"}
                    </span>
                  }
                  facts={[
                    { label: "Kind", value: `${kind.toLowerCase()} → ${String(visualKind).toLowerCase()}` },
                    { label: "Route", value: draft.template_name || "" },
                    {
                      label: "Print",
                      value: fixed.print_capable
                        ? fixed.artwork_required
                          ? "compulsory"
                          : "capable"
                        : "plain",
                    },
                    { label: "Sizes", value: `${draftSizes.length}` },
                    { label: "Adhesive", value: adhesiveGsm > 0 ? `${adhesiveGsm} gsm` : "" },
                  ]}
                  testId="pm-spec-plate"
                  narrow
                  emptyText="Add a layer and a size to see the spec."
                />
                <section className="rounded-[18px] border border-line bg-surface-1 p-4 shadow-[var(--shadow-sm)]">
                  <div className="mb-2 flex items-baseline justify-between gap-2">
                    <span className="text-[13px] font-semibold text-content-1">Anatomy</span>
                    <span className="text-[12px] text-content-3">
                      {draft.layer_template.length} layers · {totalThickness}μ
                    </span>
                  </div>
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
                </section>
              </>
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
                <span className="inline-flex items-center gap-1 rounded-full bg-warning-bg px-2 py-0.5 text-caption font-bold text-warning-fg ring-1 ring-warning-border">
                  <AlertTriangle className="h-3 w-3" /> preview needs save/axes
                </span>
              ) : undefined
            }
          />
        </aside>
      </div>

      <ValidationFooter
        checks={checks}
        autosaveLabel="Master draft ready"
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
            Save master
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
    bg: "bg-surface-1",
  },
  violet: {
    label: "text-order-fg",
    ring: "ring-order-border",
    dot: "bg-order-fg",
    bg: "bg-surface-1",
  },
  emerald: {
    label: "text-success-fg",
    ring: "ring-success-border",
    dot: "bg-success-fg",
    bg: "bg-success-bg",
  },
  amber: {
    label: "text-warning-fg",
    ring: "ring-warning-border",
    dot: "bg-warning-fg",
    bg: "bg-warning-bg",
  },
  fuchsia: {
    label: "text-order-fg",
    ring: "ring-order-border",
    dot: "bg-order-fg",
    bg: "bg-surface-1",
  },
  blue: {
    label: "text-primary",
    ring: "ring-info-border",
    dot: "bg-primary",
    bg: "bg-surface-1",
  },
  slate: {
    label: "text-content-3",
    ring: "ring-line",
    dot: "bg-line",
    bg: "bg-surface-1",
  },
};
function FormField({
  label,
  prominent,
  children,
}: {
  label: string;
  tone?: keyof typeof FORM_FIELD_TONE;
  prominent?: boolean;
  children: React.ReactNode;
}) {
  const labelId = React.useId();
  return (
    <div className={cn("grid gap-1.5", prominent && "gap-2")}>
      <Label id={labelId} className="text-[11.5px] font-semibold tracking-[0.01em] text-content-3">
        {label}
      </Label>
      <FieldLabelProvider id={labelId}>{children}</FieldLabelProvider>
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
      <div className="rounded-2xl border border-success-border bg-success-bg p-4">
        <div className="text-[12px] font-semibold text-content-2 mb-2">
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
                  <span className="font-mono text-caption font-semibold text-content-3 w-6">
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
                  <span className="font-mono text-caption font-bold text-content-2 w-14 text-right">
                    {l.thickness_micron || 0}μ
                  </span>
                  <span className="font-mono text-caption text-content-3 w-20 truncate">
                    {l.film_variant_code || "—"}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        <div className="mt-3 flex items-center justify-between rounded-lg bg-surface-1 px-3 py-1.5 ring-1 ring-success-border">
          <span className="text-[12px] font-semibold text-content-2">
            Total thickness
          </span>
          <span className="font-mono font-semibold text-success-fg">
            {total} μ
          </span>
        </div>
        {sizeRow ? (
          <div className="mt-2 grid grid-cols-2 gap-2 text-caption">
            <div className="rounded-lg bg-surface-1 px-2 py-1 ring-1 ring-success-border">
              <div className="font-semibold uppercase tracking-wider text-content-3">
                Width
              </div>
              <div className="font-mono font-bold text-content-1">
                {sizeRow.width_mm || 0} mm
              </div>
            </div>
            <div className="rounded-lg bg-surface-1 px-2 py-1 ring-1 ring-success-border">
              <div className="font-semibold uppercase tracking-wider text-content-3">
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
  const defaultFilmCode = String(layer.film_variant_code || "")
    .trim()
    .toUpperCase();
  const allowedFilmCodes = Array.from(
    new Set(
      [
        defaultFilmCode,
        ...((layer.film_variant_options || []) as any[]),
        ...((layer.allowed_film_variant_codes || []) as any[]),
      ]
        .map((code) => String(code || "").trim().toUpperCase())
      .filter(Boolean),
    ),
  );
  const layerFilmPool = filmVariants.filter((film) =>
    allowedFilmCodes.includes(String(film.code || "").toUpperCase()),
  );
  const gradeFilmPool = layerFilmPool.length ? layerFilmPool : filmVariants;
  const allGradeOptions = gradeOptionsForLayer(
    layer,
    gradeFilmPool,
    grades as any,
    recipes as any,
  );
  const patchAllowedFilms = (codes: string[]) => {
    const normalized = Array.from(
      new Set(
        [
          defaultFilmCode,
          ...codes.map((code) => String(code || "").trim().toUpperCase()),
        ].filter(Boolean),
      ),
    );
    onPatch({
      film_variant_options: normalized,
      allowed_film_variant_codes: normalized,
    } as any);
  };
  const allowedFilmRows = allowedFilmCodes.map((code) => {
    const meta = filmVariants.find(
      (film) => String(film.code || "").toUpperCase() === code,
    );
    return { code, name: meta?.name || code };
  });
  const pickableFilmRows = filmVariants.filter(
    (film) =>
      !allowedFilmCodes.includes(String(film.code || "").toUpperCase()),
  );
  const isSetupPending = Boolean(layer.setup_pending || !layer.film_variant_code);

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-[16px] border bg-surface-1 p-4",
        isSetupPending ? "border-warning-border" : "border-line",
      )}
    >
      <div className="relative">
        {/* Header — layer number + Fixed/Variable summary pills + delete */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-plate font-mono text-[12.5px] font-semibold text-plate-fg">
              L{index + 1}
            </span>
            <div>
              <div className="text-[12px] font-semibold text-content-2">
                Layer {index + 1}
              </div>
              <div className="font-display text-sm font-semibold text-content-1">
                {layer.role || `Layer ${index + 1}`}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {isSetupPending ? (
              <span className="rounded-full bg-warning-bg px-2 py-1 text-[12.5px] font-semibold text-content-1 ring-1 ring-warning-border">
                setup needed
              </span>
            ) : null}
            <span
              className={cn(
                "rounded-full px-2 py-1 text-caption font-semibold uppercase ring-1",
                allowedFilmCodes.length > 1
                  ? "bg-info-bg text-primary ring-info-border"
                  : "bg-surface-1 text-content-3 ring-line",
              )}
            >
              Film {allowedFilmCodes.length > 1 ? "variable" : "fixed"}
            </span>
            <LayerStatePill axis="μ thickness" variable={thickVariable} />
            <LayerStatePill axis="G grade" variable={gradeVariable} />
            <button
              type="button"
              onClick={onRemove}
              className="ml-1 flex h-8 w-8 items-center justify-center rounded-lg text-danger-fg hover:bg-danger-bg"
              title="Remove layer"
              aria-label="Remove layer"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Film picker */}
        <div className="mb-3">
          <Label className="text-[12px] font-semibold text-content-2">
            Default film variant · Product Master owned
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
                  {filmVariants.map((m, index) => (
                    <SelectItem
                      key={`${m.id || m.code}-${index}`}
                      value={m.id || m.code}
                    >
                      {m.code} · {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {layer.film_variant_code ? (
                <div className="mt-1 rounded-lg bg-surface-1 px-2 py-1 font-mono text-caption font-bold text-content-2 ring-1 ring-line">
                  Default film · {layer.film_variant_code}
                </div>
              ) : (
                <div className="mt-1 rounded-lg bg-warning-bg px-2 py-1 text-caption font-bold text-warning-fg ring-1 ring-warning-border">
                  Pick the film variant for this layer slot. Grade and thickness
                  presets follow the selected film/recipe.
                </div>
              )}
              <div className="mt-3 rounded-xl border border-info-border bg-surface-1/80 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-[12px] font-semibold text-content-2">
                      Allowed film variants · {allowedFilmRows.length}
                    </div>
                    <div className="text-caption font-semibold text-content-3">
                      Sales/planner can switch this layer only to these PM-approved
                      variants.
                    </div>
                  </div>
                  {pickableFilmRows.length ? (
                    <Select
                      onValueChange={(value) => {
                        const picked = filmVariants.find(
                          (film) => film.id === value || film.code === value,
                        );
                        const code = String(picked?.code || value || "")
                          .trim()
                          .toUpperCase();
                        if (code) patchAllowedFilms([...allowedFilmCodes, code]);
                      }}
                    >
                      <SelectTrigger className="h-8 w-[220px] rounded-lg bg-surface-1 text-xs">
                        <SelectValue placeholder="+ Add allowed film" />
                      </SelectTrigger>
                      <SelectContent>
                        {pickableFilmRows.map((film) => (
                          <SelectItem
                            key={film.id || film.code}
                            value={film.id || film.code}
                          >
                            {film.code} · {film.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : null}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {allowedFilmRows.map((film) => {
                    const isDefault =
                      String(film.code).toUpperCase() === defaultFilmCode;
                    return (
                      <span
                        key={film.code}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-md px-2 py-1 font-mono text-caption font-semibold ring-1",
                          isDefault
                            ? "bg-info-bg text-primary ring-info-border"
                            : "bg-surface-2 text-content-2 ring-line",
                        )}
                      >
                        {film.code}
                        <span className="font-sans font-semibold normal-case text-content-3">
                          {isDefault ? "default" : film.name}
                        </span>
                        {!isDefault ? (
                          <button
                            type="button"
                            onClick={() =>
                              patchAllowedFilms(
                                allowedFilmCodes.filter(
                                  (code) => code !== film.code,
                                ),
                              )
                            }
                            className="-my-1 grid h-6 w-6 place-items-center rounded-full text-danger-fg hover:bg-danger-bg"
                            title="Remove allowed film"
                            aria-label={`Remove ${film.code} from allowed films`}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        ) : null}
                      </span>
                    );
                  })}
                  {allowedFilmRows.length <= 1 ? (
                    <span className="rounded-md bg-surface-2 px-2 py-1 text-caption font-bold text-content-3 ring-1 ring-line">
                      No alternates approved yet
                    </span>
                  ) : null}
                </div>
              </div>
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
              films={gradeFilmPool}
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
              films={gradeFilmPool}
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
              films={gradeFilmPool}
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
            className="flex items-center gap-1.5 text-[12px] font-semibold text-content-2 hover:text-content-1"
          >
            <span
              className={cn(
                "inline-block h-1.5 w-1.5 rounded-full",
                showRollOverride ? "bg-danger-solid" : "bg-line",
              )}
            />
            Advanced · per-layer roll-width override
            <span className="text-caption text-content-3 normal-case font-normal">
              {showRollOverride ? "(hide)" : "(rare — click to show)"}
            </span>
          </button>
          {showRollOverride ? (
            <div className="mt-2 grid grid-cols-[minmax(0,1fr)_140px] gap-2 items-end">
              <div className="text-caption text-content-3">
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
              "text-[12.5px] font-semibold",
              axisColor === "blue" ? "text-primary" : "text-success-fg",
            )}
          >
            {title}
          </span>
          <span className="text-caption text-content-3">
            {variable ? helperVariable : helperFixed}
          </span>
        </div>
        <div className="inline-flex gap-1 rounded-full bg-surface-2 p-1 ring-1 ring-line">
          <button
            type="button"
            onClick={() => onToggle(false)}
            className={cn(
              "rounded-full px-2.5 py-0.5 text-caption font-semibold uppercase tracking-wider ring-1 ring-inset transition",
              !variable ? toneActive : toneInactive,
            )}
          >
            Fixed
          </button>
          <button
            type="button"
            onClick={() => onToggle(true)}
            className={cn(
              "rounded-full px-2.5 py-0.5 text-caption font-semibold uppercase tracking-wider ring-1 ring-inset transition",
              variable ? toneActive : toneInactive,
            )}
          >
            Variable
          </button>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 items-start">
        <div>
          <div className="text-[12px] font-semibold text-content-2 mb-1">
            Default {variable ? "(required)" : ""}
          </div>
          {defaultEditor}
        </div>
        {variable && allowedEditor ? (
          <div>
            <div className="text-[12px] font-semibold text-content-2 mb-1">
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
          <div className="text-caption text-content-3">{description}</div>
        ) : null}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
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
          tone: "bg-surface-1",
          ring: "ring-line",
          title: "No printing",
          eyebrow: "Plain production master",
          body: "This stock launches as unprinted production runs. No artwork ever attached. Routes skip print step.",
          bom: "BOM has no ink rows. Weight = layers + chemistry only.",
        },
        CAPABLE_OPTIONAL: {
          tone: "bg-warning-bg",
          ring: "ring-warning-border",
          title: "Print capable · artwork OPTIONAL",
          eyebrow:
            "Stock launcher / planner decides per run · ships without artwork allowed",
          body: "When the Stock Launcher creates a production run, the launcher may attach an approved artwork. If not, the planner can still attach one before release. If neither does, production runs as a warning-print job (date stamps, batch codes, plain) — no artwork ID required.",
          bom: "Ink rows in BOM = ZERO until an artwork is attached on the production order. No fake GSM. Once attached, total ink theory appears.",
        },
        REQUIRED: {
          tone: "bg-surface-1",
          ring: "ring-order-border",
          title: "Print compulsory · artwork REQUIRED",
          eyebrow:
            "Artwork-gated production · launcher must pick (default below)",
          body: "Stock Launcher MUST pick an approved artwork at launch time (or planner attaches one before release). The Default fallback below pre-fills the launch form so the launcher just confirms (or overrides). Planner blocks release until an artwork ID is on the production order.",
          bom: "Ink GSM and color list are pulled from the approved artwork and added to BOM weight.",
        },
      }
    : {
        OFF: {
          tone: "bg-surface-1",
          ring: "ring-line",
          title: "No printing",
          eyebrow: "Plain master",
          body: "Sales cannot attach artwork. Master ships unprinted. Saves an artwork-gate step at planning.",
          bom: "BOM has no ink rows. Weight = layers + chemistry only.",
        },
        CAPABLE_OPTIONAL: {
          tone: "bg-warning-bg",
          ring: "ring-warning-border",
          title: "Print capable · artwork OPTIONAL",
          eyebrow: "Warning-print mode · ships without artwork",
          body: "Sales MAY attach an approved artwork. If they don't, the order still goes to production as a warning-print run (date stamps, batch codes, plain) — no artwork ID required. No master-level default needed: each order decides.",
          bom: "Ink rows in BOM = ZERO until an artwork is attached on the line. No fake GSM. When an artwork is attached, total ink theory appears.",
        },
        REQUIRED: {
          tone: "bg-surface-1",
          ring: "ring-order-border",
          title: "Print compulsory · artwork REQUIRED",
          eyebrow: "Artwork-gated production · default fallback shown below",
          body: "Sales MUST pick an approved artwork before submit. The Default fallback artwork below pre-fills the line so sales just confirms (or overrides). Planner blocks release until an artwork ID is on the line.",
          bom: "Ink GSM and color list are pulled from the approved artwork and added to BOM weight.",
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
                ? "bg-plate text-plate-fg"
                : "bg-surface-2 text-content-3",
            )}
          >
            <Palette className="h-4 w-4" />
          </span>
          <div className="flex-1">
            <div className="text-[12px] font-semibold text-content-2">
              Knob 1
            </div>
            <div className="text-sm font-semibold text-content-1">
              Print capable
            </div>
            <div className="text-caption text-content-3">
              Can this master carry artwork at all? Off = plain unprinted
              master.
            </div>
          </div>
          <span
            className={cn(
              "ml-2 inline-flex h-6 items-center rounded-full px-2 text-caption font-semibold uppercase tracking-wider ring-1",
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
                ? "bg-plate text-plate-fg"
                : "bg-surface-2 text-content-3",
            )}
          >
            <CheckCircle2 className="h-4 w-4" />
          </span>
          <div className="flex-1">
            <div className="text-[12px] font-semibold text-content-2">
              Knob 2
            </div>
            <div className="text-sm font-semibold text-content-1">
              Artwork compulsory
            </div>
            <div className="text-caption text-content-3">
              {printCapable
                ? "Block release until artwork is on the line. Off = can dispatch unprinted."
                : "Enable Knob 1 first."}
            </div>
          </div>
          <span
            className={cn(
              "ml-2 inline-flex h-6 items-center rounded-full px-2 text-caption font-semibold uppercase tracking-wider ring-1",
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
            <Label className="text-[12px] font-semibold text-content-2">
              Allowed print method
            </Label>
            <Select
              value={printType}
              onValueChange={(v) => {
                onChange({ print_type: v as "FLEXO" | "ROTO" });
                if (defaultArtworkId) onChangeDefaultArtwork("");
              }}
            >
              <SelectTrigger className="mt-2 h-10 rounded-xl bg-surface-1" aria-label="Allowed print method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="FLEXO">FLEXO · no cylinders required</SelectItem>
                <SelectItem value="ROTO">ROTO · cylinders required</SelectItem>
              </SelectContent>
            </Select>
            <p className="mt-2 text-caption leading-4 text-content-3">
              This must match the printing process on the route. Sales,
              planner, and artwork pickers use this value to reject the wrong
              artwork method.
            </p>
          </div>

          <div className="rounded-2xl border border-info-border bg-info-bg p-3 shadow-sm">
            <Label className="text-[12px] font-semibold text-content-2">
              Artwork form from pouch style
            </Label>
            <div className="mt-2 flex h-10 items-center justify-between rounded-xl bg-surface-1 px-3 ring-1 ring-info-border">
              <span className="text-sm font-semibold text-content-1">
                {mixedSubstrateModes ? "MIXED" : substrateMode}
              </span>
              <span className="text-[12px] font-semibold text-content-2">
                {mixedSubstrateModes
                  ? "fallback disabled"
                  : substrateMode === "TUBING"
                  ? "lay-flat tube"
                  : "open web / sheet"}
              </span>
            </div>
            <p className="mt-2 text-caption leading-4 text-content-3">
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
            <div className="mt-0.5 text-caption">
              {(incompatibleDefaultArtwork as any).design_code ||
                incompatibleDefaultArtwork.id}{" "}
              is not {printType} ·{" "}
              {mixedSubstrateModes ? "single-form master" : substrateMode}.
              Pick a compatible artwork or clear the fallback before saving.
            </div>
          </div>
          <button
            type="button"
            onClick={() => onChangeDefaultArtwork("")}
            className="rounded-full bg-surface-1 px-3 py-1 text-caption font-semibold text-danger-fg ring-1 ring-danger-border"
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
              "flex h-9 w-9 flex-none items-center justify-center rounded-xl text-white",
              state === "OFF" &&
                "bg-surface-1",
              state === "CAPABLE_OPTIONAL" &&
                "bg-plate",
              state === "REQUIRED" &&
                "bg-plate",
            )}
          >
            <Disc className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="text-[12px] font-semibold text-content-2">
              {meta.eyebrow}
            </div>
            <div className="font-display text-sm font-semibold text-content-1">
              {meta.title}
            </div>
            <div className="mt-1 text-[12px] text-content-2">{meta.body}</div>
            <div className="mt-2 inline-flex items-start gap-1.5 rounded-lg bg-surface-1/80 px-2.5 py-1.5 text-caption font-semibold text-content-2 ring-1 ring-surface-1/40">
              <span className="text-[12px] font-semibold text-content-2">
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
        <div className="rounded-[14px] bg-surface-2 p-3.5">
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <Label className="text-[12px] font-semibold text-content-2">
              Default fallback artwork (optional pre-fill)
            </Label>
            <span className="text-caption font-bold text-content-3">
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
          <div className="mt-1.5 text-caption text-content-3">
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
        <div className="flex items-start gap-2 rounded-xl border border-warning-border bg-warning-bg px-3 py-2 text-caption text-warning-fg">
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
    patch: {
      required?: boolean;
      auto_demand_in_house?: boolean;
      allow_ad_hoc?: boolean;
      allow_custom?: boolean;
    },
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
    patch: {
      required?: boolean;
      auto_demand_in_house?: boolean;
      allow_ad_hoc?: boolean;
      allow_custom?: boolean;
    },
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
  const uniqueAllowedCodes = Array.from(new Set(allowedCodes));

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
  const uniqueCatalogRows = Array.from(
    new Map(allCatalogRows.map((row) => [row.code, row])).values(),
  );
  const pickable = uniqueCatalogRows.filter(
    (r) => !uniqueAllowedCodes.includes(r.code),
  );

  const required = Boolean(axisRow?.required);
  // Missing flag means on: order confirm creates in-house demand unless the master says off.
  const autoDemand = (axisRow as any)?.auto_demand_in_house !== false;
  const adHocAllowed = Boolean(
    (axisRow as any)?.allow_ad_hoc || (axisRow as any)?.allow_custom,
  );
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
              "text-[12.5px] font-semibold",
              entry.tone.text,
            )}
          >
            {entry.label}
          </div>
          <div className="mt-0.5 text-caption font-bold text-content-2">
            {entry.multiplicityCopy}
            <span className="ml-1 text-content-3 font-medium">
              · {entry.consumption}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-caption">
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
          <button
            type="button"
            onClick={() =>
              onSetAxisFlags(entry.axis, {
                allow_ad_hoc: !adHocAllowed,
                allow_custom: !adHocAllowed,
              })
            }
            className={cn(
              "inline-flex items-center rounded-full px-2 py-0.5 font-bold ring-1",
              adHocAllowed
                ? "bg-success-bg text-success-fg ring-success-border"
                : "bg-surface-1 text-content-3 ring-line hover:bg-surface-2",
            )}
            title="Allow sales/planner to request a new bounded catalog-backed value"
          >
            ad-hoc {adHocAllowed ? "allowed" : "blocked"}
          </button>
        </div>
      </div>

      {/* Allowed code chips */}
      <div className="mt-3">
        <div className="text-[12px] font-semibold text-content-2 mb-1">
          Allowed codes · {uniqueAllowedCodes.length}
        </div>
        {uniqueAllowedCodes.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line-strong bg-surface-1/40 px-3 py-2 text-caption italic text-content-3">
            No allowed codes yet — add at least one so sales can pick this{" "}
            {entry.label.toLowerCase()} on an order.
          </div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {uniqueAllowedCodes.map((code) => {
              const meta = uniqueCatalogRows.find((r) => r.code === code);
              return (
                <span
                  key={code}
                  className="inline-flex items-center gap-1 rounded-md bg-surface-1 px-2 py-0.5 text-caption font-mono font-bold text-content-2 ring-1 ring-line"
                >
                  {code}
                  {meta?.name && meta.name !== code ? (
                    <span className="text-caption font-medium text-content-3">
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
        <InnerPouchDefault
          fixed={draft.fixed_attributes}
          allowedCodes={uniqueAllowedCodes}
          materials={packagingMaterials}
          defaultPcs={defaultInnerPcs}
          onPatchFixed={onPatchFixed}
        />
      ) : null}

      {/* Add picker */}
      <div className="mt-3">
        <div className="text-[12px] font-semibold text-content-2 mb-1">
          Add from catalog · {pickable.length} available
        </div>
        {pickable.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line bg-surface-1/40 px-3 py-2 text-caption italic text-content-3">
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
              {pickable.map((r, index) => (
                <SelectItem key={`${r.code}-${index}`} value={r.code}>
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

const SUPPLY_LABEL: Record<string, string> = {
  IN_HOUSE: "Made in our plant",
  PURCHASED: "Bought",
  BOTH: "Made here or bought",
};

/**
 * Default inner pouch for this product. Pouching consumes it automatically (one per
 * N pouches); every other packing item is taken off at the evening packing count.
 */
function InnerPouchDefault({
  fixed,
  allowedCodes,
  materials,
  defaultPcs,
  onPatchFixed,
}: {
  fixed: Record<string, any> | undefined;
  allowedCodes: string[];
  materials: PackagingMaterial[];
  defaultPcs: number;
  onPatchFixed: (patch: Record<string, any>) => void;
}) {
  const savedCode = String(fixed?.primary_inner_pack?.material_code || "");
  const savedEnabled = Boolean(fixed?.primary_inner_pack?.enabled);
  const savedInList = allowedCodes.some((code) => code.toUpperCase() === savedCode.toUpperCase());
  const selectedCode = savedInList ? savedCode : allowedCodes[0] || "";
  const picked = materials.find((m) => String(m.code || "").toUpperCase() === selectedCode.toUpperCase());
  const supply = String(picked?.packaging_supply_mode || "").toUpperCase();
  const makesHere = supply === "IN_HOUSE" || supply === "BOTH";

  // Keep the default on an allowed pouch: if it was removed from the list, move it to the
  // first allowed one, or switch the default off when none is left.
  React.useEffect(() => {
    if (!savedEnabled || savedInList || materials.length === 0) return;
    onPatchFixed(primaryInnerPackPatch(fixed, allowedCodes[0] || "", allowedCodes.length ? defaultPcs : 0, materials));
  }, [savedEnabled, savedInList, materials, allowedCodes, defaultPcs, fixed, onPatchFixed]);

  return (
    <div className="mt-3 rounded-xl border border-warning-border bg-surface-1/70 px-3 py-2.5" data-testid="pm-inner-pouch-default">
      {allowedCodes.length === 0 ? (
        <div className="text-caption text-warning-fg">
          Add an inner pouch below first. Then choose the default and how many pouches go in one.
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1">
            <div className="text-[12px] font-semibold text-content-2">Default inner pouch</div>
            <Select
              value={selectedCode}
              onValueChange={(code) => onPatchFixed(primaryInnerPackPatch(fixed, code, defaultPcs, materials))}
            >
              <SelectTrigger className="mt-1 h-9 rounded-lg border-warning-border bg-surface-1 text-xs" aria-label="Default inner pouch">
                <SelectValue placeholder="Choose the default inner pouch" />
              </SelectTrigger>
              <SelectContent>
                {allowedCodes.map((code) => {
                  const row = materials.find((m) => String(m.code || "").toUpperCase() === code.toUpperCase());
                  return (
                    <SelectItem key={code} value={code}>
                      <span className="font-mono font-bold">{code}</span>
                      {row?.name && row.name !== code ? <span className="ml-2 text-content-3">{row.name}</span> : null}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
          <div className="w-[150px]">
            <div className="text-[12px] font-semibold text-content-2">Pouches per inner</div>
            <Input
              type="number"
              min={1}
              step={1}
              value={defaultPcs || ""}
              placeholder="e.g. 100"
              aria-label="Pouches per inner pouch"
              onChange={(e) =>
                onPatchFixed(primaryInnerPackPatch(fixed, selectedCode, Number(e.target.value), materials))
              }
              className="mt-1 h-9 rounded-lg border-warning-border bg-surface-1 font-mono text-xs font-bold"
            />
          </div>
        </div>
      )}
      {picked ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-content-2">
          <span className="rounded-full bg-surface-2 px-2 py-0.5 font-semibold text-content-1">
            {SUPPLY_LABEL[supply] || "Supply not set"}
          </span>
          {makesHere ? (
            picked.product_master_link?.master_name || picked.production_template_name || picked.production_template ? (
              <span>
                Made from{" "}
                <b>
                  {picked.product_master_link
                    ? `${picked.product_master_link.master_code} · ${picked.product_master_link.master_name}`
                    : picked.production_template_name || "its production route"}
                </b>
                ; a shortage creates a stock order when the sales order is confirmed.
              </span>
            ) : (
              <span className="font-semibold text-warning-fg">
                No product master is linked to make this pouch, so in-house demand cannot be planned. Link one on the packaging master.
              </span>
            )
          ) : null}
        </div>
      ) : null}
      <div className="mt-1.5 text-caption leading-5 text-content-3">
        {defaultPcs > 0 && picked
          ? `Pouching uses 1 inner pouch per ${defaultPcs} pouches automatically. Gonnies, cartons and extras are counted at the evening packing count. `
          : "Blank pouches-per-inner means no inner pouch by default. "}
        Sales can change it per order; a customer overlay can change it per customer.
      </div>
    </div>
  );
}

function primaryInnerPackPatch(
  fixed: Record<string, any> | undefined,
  materialCode: string,
  pcsRaw: number,
  materials: PackagingMaterial[],
) {
  const picked = materials.find(
    (m) =>
      String(m.code || "").toUpperCase() ===
      String(materialCode || "").toUpperCase(),
  );
  // Never switch the inner pouch on without a real packing material behind it.
  const pcs = picked && Number.isFinite(pcsRaw) && pcsRaw > 0 ? Math.floor(pcsRaw) : 0;
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

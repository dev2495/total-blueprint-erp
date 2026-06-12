"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  CheckCircle2,
  ClipboardCheck,
  Factory,
  FileText,
  Filter,
  Gauge,
  Layers,
  Loader2,
  Lock,
  MapPin,
  Package,
  PackageCheck,
  Palette,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Unlock,
  UserSquare,
  Workflow,
  Zap,
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
import { useToast } from "@/hooks/use-toast";
import { describeApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

import { GradientHero } from "@/components/erp/gradient-hero";
import { StepStrip } from "@/components/erp/step-strip";
import { SectionCardV3 } from "@/components/erp/section-card";
import { RouteTimeline } from "@/components/erp/route-timeline";
import {
  ValidationFooter,
  type CheckLine,
} from "@/components/erp/validation-footer";
import {
  AxisLayerMatrix,
  type LayerRowState,
} from "@/components/erp/axis-layer-matrix";
import { LiveBomRail } from "@/components/erp/live-bom-rail";

import {
  masterDataService,
  type PackagingMaterial,
  type PodSkuVariant,
} from "@/services/master-data";
import { engineeringService } from "@/services/engineering";
import {
  productMasterService,
  stockLauncherService,
  type CommitmentScope,
  type PreviewBomResult,
  type ProductMaster,
  type ProductKind,
} from "@/services/product-master";

const STEPS = [
  { id: "master", label: "What to build", description: "Pick Product Master" },
  { id: "commitment", label: "Commitment", description: "Reuse lock" },
  { id: "stop", label: "Build up to", description: "Route stop" },
  { id: "axes", label: "Spec / axes", description: "Size + layers" },
  { id: "quantity", label: "Quantity", description: "Qty + plant" },
  { id: "preview", label: "Launch", description: "Preview + release" },
];

const KIND_FILTERS: Array<{
  id: ProductKind | "ALL";
  label: string;
  description: string;
}> = [
  { id: "ALL", label: "All", description: "Every active Product Master" },
  {
    id: "POUCH",
    label: "Pouch",
    description: "Finished goods and WIP pouch routes",
  },
  {
    id: "ROLL",
    label: "Roll",
    description: "Plain or semi-finished roll stock",
  },
  {
    id: "PACKAGING",
    label: "Packaging",
    description: "In-house packing SKU links",
  },
  { id: "POD", label: "POD", description: "In-house POD roll SKU links" },
];

const KIND_TONE: Record<string, string> = {
  POUCH: "bg-info-bg text-primary ring-info-border",
  ROLL: "bg-success-bg text-success-fg ring-success-border",
  PACKAGING: "bg-warning-bg text-warning-fg ring-warning-border",
  POD: "bg-order-bg text-order-fg ring-order-border",
  OTHER: "bg-surface-2 text-content-2 ring-line",
};

export function StockLauncherV3Workspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const initialMaster =
    searchParams?.get("product_master") || searchParams?.get("master") || "";

  const [stepId, setStepId] = React.useState("master");
  const [kindFilter, setKindFilter] = React.useState<ProductKind | "ALL">(
    "ALL",
  );
  const [masterSearch, setMasterSearch] = React.useState("");
  const [showDerived, setShowDerived] = React.useState(false);
  const [scope, setScope] = React.useState<CommitmentScope>("GENERIC");
  const [productMasterId, setProductMasterId] = React.useState(initialMaster);
  const [templateId, setTemplateId] = React.useState<string>("");
  const [committedCustomer, setCommittedCustomer] = React.useState<string>("");
  const [committedArtwork, setCommittedArtwork] = React.useState<string>("");
  const [startStep, setStartStep] = React.useState(1);
  const [stopStep, setStopStep] = React.useState(2);
  const [sizeCode, setSizeCode] = React.useState<string>("");
  const [layerValues, setLayerValues] = React.useState<
    Record<number, LayerRowState>
  >({});
  const [wipRollWidthMm, setWipRollWidthMm] = React.useState<number | "">("");
  const [quantity, setQuantity] = React.useState(500);
  const [qtyUom, setQtyUom] = React.useState<"KG" | "PCS">("KG");
  const [packagingMaterialId, setPackagingMaterialId] = React.useState("");
  const [podVariantId, setPodVariantId] = React.useState("");

  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: masterDataService.getCustomers,
    staleTime: 60_000,
  });
  const { data: masters = [] } = useQuery({
    queryKey: ["product-masters", "v3", "active"],
    queryFn: () =>
      productMasterService.list({ active: true, for_planner: true }),
    staleTime: 30_000,
  });
  const { data: packagingMaterials = [] } = useQuery({
    queryKey: ["master-packaging"],
    queryFn: masterDataService.getPackaging,
    staleTime: 60_000,
  });
  const { data: podVariants = [] } = useQuery({
    queryKey: ["master-pod-sku-variants", "active"],
    queryFn: () => masterDataService.getPodSkuVariants({ active: true }),
    staleTime: 60_000,
  });
  const { data: artworks = [] } = useQuery({
    queryKey: ["planner-artworks", "approved"],
    queryFn: () => engineeringService.getArtworks({ status: "APPROVED" }),
    staleTime: 60_000,
  });

  const master: ProductMaster | undefined = masters.find(
    (m) => m.id === productMasterId,
  );
  const { data: sizes = [] } = useQuery({
    queryKey: ["product-master-sizes", productMasterId],
    queryFn: () => productMasterService.listSizes(productMasterId),
    enabled: !!productMasterId,
  });
  const { data: routeInfo } = useQuery({
    queryKey: ["product-master-template", productMasterId],
    queryFn: () => productMasterService.getTemplate(productMasterId),
    enabled: !!productMasterId,
  });

  const masterKind = (master?.product_kind || "OTHER") as ProductKind;
  const isPackagingMaster = masterKind === "PACKAGING";
  const isPodMaster = masterKind === "POD";
  const isInHouseCatalogMaster = isPackagingMaster || isPodMaster;
  const isPodBulkLaunch = isPodMaster;
  const linkedPackagingMaterials = React.useMemo(
    () =>
      !master
        ? []
        : packagingMaterials.filter(
            (material: PackagingMaterial) =>
              String(material.product_master_link?.master_id || "") ===
              String(master.id),
          ),
    [master, packagingMaterials],
  );
  const linkedPodVariants = React.useMemo(
    () =>
      !master
        ? []
        : podVariants.filter(
            (pod: PodSkuVariant) =>
              String(pod.material_product_master_link?.master_id || "") ===
              String(master.id),
          ),
    [master, podVariants],
  );

  React.useEffect(() => {
    if (master) {
      const next: Record<number, LayerRowState> = {};
      master.layer_template.forEach((row, i) => {
        next[i + 1] = {
          role: row.role,
          film_variant_code:
            row.film_variant_code ||
            (row as any).material_code ||
            (row as any).code,
          thickness_micron: row.thickness_micron,
          grade: row.default_grade,
        };
      });
      setLayerValues(next);
      setTemplateId(master.template || master.default_template || "");
      setSizeCode("");
      setWipRollWidthMm("");
    }
  }, [master?.id]);

  React.useEffect(() => {
    if (!sizeCode && sizes.length) setSizeCode(sizes[0].code);
  }, [sizes, sizeCode]);

  React.useEffect(() => {
    if (!master) return;
    if (isInHouseCatalogMaster && scope !== "GENERIC") {
      setScope("GENERIC");
      setCommittedCustomer("");
      setCommittedArtwork("");
    }
    if (isPackagingMaster) {
      const next = linkedPackagingMaterials[0];
      setPackagingMaterialId((current) => current || next?.id || "");
      setPodVariantId("");
      setQtyUom((next?.base_uom === "PCS" ? "PCS" : "KG") as "KG" | "PCS");
    } else if (isPodMaster) {
      const next = linkedPodVariants[0];
      setPodVariantId((current) => current || next?.id || "");
      setPackagingMaterialId("");
      setQtyUom("KG");
    } else {
      setPackagingMaterialId("");
      setPodVariantId("");
      setQtyUom("KG");
    }
  }, [
    isInHouseCatalogMaster,
    isPackagingMaster,
    isPodMaster,
    linkedPackagingMaterials,
    linkedPodVariants,
    master,
    scope,
  ]);

  const selectedPackaging = packagingMaterials.find(
    (m: PackagingMaterial) =>
      m.id === packagingMaterialId || m.code === packagingMaterialId,
  );
  const selectedPod = podVariants.find(
    (p: PodSkuVariant) => p.id === podVariantId || p.code === podVariantId,
  );

  const axisValues = React.useMemo(() => {
    const layer_thicknesses: Record<string, number> = {};
    const layer_grades: Record<string, string> = {};
    Object.entries(layerValues).forEach(([k, v]) => {
      if (v.thickness_micron != null) layer_thicknesses[k] = v.thickness_micron;
      if (v.grade != null) layer_grades[k] = v.grade;
    });
    const axis: Record<string, any> = {
      size: sizeCode,
      layer_thicknesses,
      layer_grades,
    };
    if (selectedPackaging?.code || packagingMaterialId)
      axis.packaging = selectedPackaging?.code || packagingMaterialId;
    if (selectedPod?.code || podVariantId)
      axis.pod = selectedPod?.code || podVariantId;
    return axis;
  }, [
    layerValues,
    sizeCode,
    packagingMaterialId,
    podVariantId,
    selectedPackaging?.code,
    selectedPod?.code,
  ]);

  const routeSteps = (routeInfo?.route_steps || []).map((step) => ({
    index: step.index,
    label: step.name || step.process_code || `Step ${step.index}`,
    transition: step.transition || "—",
    artwork_step: Boolean(step.has_artwork),
  }));
  const steps = routeSteps;
  const firstArtworkStep = steps.find((step) => step.artwork_step)?.index;
  const routeStepIndexes = React.useMemo(
    () => steps.map((step) => step.index).sort((a, b) => a - b),
    [steps],
  );
  const routeFirst = routeStepIndexes[0] ?? 0;
  const routeLast = routeStepIndexes.length
    ? routeStepIndexes[routeStepIndexes.length - 1]
    : stopStep;
  const activeStartStep =
    routeStepIndexes.length && routeStepIndexes.includes(startStep)
      ? startStep
      : routeFirst;
  const activeStopStep =
    routeStepIndexes.length && routeStepIndexes.includes(stopStep)
      ? stopStep
      : routeLast;
  const routeSelectionReady =
    routeStepIndexes.length > 0 &&
    routeStepIndexes.includes(activeStartStep) &&
    routeStepIndexes.includes(activeStopStep);
  const isFullRoute =
    routeStepIndexes.length > 0 && activeStopStep >= routeLast;
  const selectedSize = sizes.find((s) => s.code === sizeCode);
  const selectedSizeDefaultRollWidth = Number(
    selectedSize?.roll_width_mm ||
      selectedSize?.child_target_width_mm ||
      selectedSize?.width_mm ||
      0,
  );
  const wipRollWidthOptions = React.useMemo(
    () =>
      Array.from(
        new Set(
          sizes
            .flatMap((size) => [
              size.roll_width_mm,
              size.child_target_width_mm,
              size.width_mm,
            ])
            .map((value) => Number(value || 0))
            .filter((value) => Number.isFinite(value) && value > 0),
        ),
      ).sort((a, b) => a - b),
    [sizes],
  );
  const wipRollWidthForPayload =
    !isFullRoute && !isPackagingMaster && !isPodBulkLaunch
      ? Number(wipRollWidthMm || 0) || selectedSizeDefaultRollWidth || undefined
      : undefined;
  const derivedStockStrategy = isPackagingMaster
    ? "PACKAGING_STOCK"
    : isPodBulkLaunch
      ? "POD_BULK"
    : isFullRoute
      ? "FINAL_STOCK"
      : "INTERMEDIATE_POOL";
  const derivedPlannerStockClass = isPackagingMaster
    ? "PACKAGING_STOCK"
    : isPodBulkLaunch
      ? "POD_STOCK"
    : !isFullRoute
      ? activeStopStep <= routeFirst
        ? "EXTRUDED_BASE_ROLL"
        : "SHARED_INVARIANT_ROLL"
      : masterKind === "ROLL"
        ? "FINAL_PLAIN_ROLL"
        : "FINAL_PRODUCT";
  const derivedOutputType = isPackagingMaster
    ? "PACKAGING_STOCK"
    : isPodBulkLaunch
      ? "POD_BULK"
    : !isFullRoute
      ? "WIP_ROLL"
      : masterKind === "POUCH"
        ? "FG_POUCH"
        : "FG_ROLL";
  const validateLauncherMode = isPackagingMaster
    ? "PACKAGING"
    : isPodBulkLaunch
      ? "POD_STOCK"
      : scope;
  const createLauncherMode = isPackagingMaster
    ? "PACKAGING"
    : isPodBulkLaunch
      ? "POD_STOCK"
      : scope;
  const stockPurpose = isPackagingMaster
    ? "PACKAGING"
    : isPodBulkLaunch
      ? "POD"
      : "PRODUCT";
  const routeIsOneBased = routeStepIndexes.length > 0 && routeFirst === 1;
  const toBackendStep = React.useCallback(
    (value: number) => Math.max(0, routeIsOneBased ? value - 1 : value),
    [routeIsOneBased],
  );
  const backendStartStep = React.useMemo(
    () => toBackendStep(activeStartStep),
    [activeStartStep, toBackendStep],
  );
  const backendStopStep = React.useMemo(
    () => toBackendStep(activeStopStep),
    [activeStopStep, toBackendStep],
  );

  React.useEffect(() => {
    if (!steps.length) return;
    const first = steps[0]?.index ?? 0;
    const last = steps[steps.length - 1]?.index ?? first;
    if (!steps.some((s) => s.index === startStep)) setStartStep(first);
    if (!steps.some((s) => s.index === stopStep)) setStopStep(last);
  }, [routeInfo?.route_steps, startStep, stopStep, steps]);

  React.useEffect(() => {
    if (!steps.length || firstArtworkStep == null) return;
    const ordered = steps.map((s) => s.index).sort((a, b) => a - b);
    const first = ordered[0] ?? 0;
    const previous = [...ordered]
      .reverse()
      .find((idx) => idx < firstArtworkStep);
    if (
      (scope === "GENERIC" || scope === "CUSTOMER") &&
      previous != null &&
      stopStep >= firstArtworkStep
    ) {
      setStopStep(previous);
      if (startStep > previous) setStartStep(first);
    }
    if (
      (scope === "ARTWORK" || scope === "CUSTOMER_ARTWORK") &&
      stopStep < firstArtworkStep
    ) {
      setStopStep(firstArtworkStep);
    }
  }, [scope, firstArtworkStep, startStep, stopStep, steps]);

  React.useEffect(() => {
    if (!selectedSize || isFullRoute || isPackagingMaster || isPodBulkLaunch)
      return;
    setWipRollWidthMm(
      selectedSizeDefaultRollWidth > 0 ? selectedSizeDefaultRollWidth : "",
    );
  }, [
    selectedSize?.id,
    selectedSizeDefaultRollWidth,
    isFullRoute,
    isPackagingMaster,
    isPodBulkLaunch,
  ]);

  const validate = useQuery({
    queryKey: [
      "stock-pool-validate",
      productMasterId,
      templateId,
      axisValues,
      scope,
      committedCustomer,
      committedArtwork,
      backendStartStep,
      backendStopStep,
      stockPurpose,
      packagingMaterialId,
      podVariantId,
      quantity,
      qtyUom,
      wipRollWidthForPayload,
    ],
    enabled: !!productMasterId && !!templateId && routeSelectionReady,
    queryFn: () =>
      stockLauncherService.validate({
        product_master: productMasterId,
        template_id: templateId,
        axis_values: axisValues,
        quantity,
        quantity_uom: qtyUom,
        commitment_scope: scope,
        committed_customer: committedCustomer || undefined,
        committed_artwork: committedArtwork || undefined,
        start_step_index: backendStartStep,
        stop_step_index: backendStopStep,
        launcher_mode: validateLauncherMode,
        stock_purpose: stockPurpose,
        packaging_material: isPackagingMaster
          ? packagingMaterialId || undefined
          : undefined,
        pod_sku_variant_id: isPodBulkLaunch
          ? podVariantId || undefined
          : undefined,
        wip_roll_width_mm: wipRollWidthForPayload,
        target_roll_width_mm: wipRollWidthForPayload,
        printing: master?.fixed_attributes?.print_capable
          ? { enabled: false, defer_artwork_to_planner: true }
          : { enabled: false },
        addons: [],
      }),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      stockLauncherService.create({
        product_master: productMasterId,
        template_id: templateId,
        axis_values: axisValues,
        quantity,
        quantity_uom: qtyUom,
        commitment_scope: scope,
        committed_customer: committedCustomer || undefined,
        committed_artwork: committedArtwork || undefined,
        start_step_index: backendStartStep,
        stop_step_index: backendStopStep,
        stock_strategy: derivedStockStrategy,
        planner_stock_class: derivedPlannerStockClass,
        output_type: derivedOutputType,
        stock_owner: "Internal",
        launcher_mode: createLauncherMode,
        stock_purpose: stockPurpose,
        packaging_material: isPackagingMaster
          ? packagingMaterialId || undefined
          : undefined,
        pod_sku_variant_id: isPodBulkLaunch
          ? podVariantId || undefined
          : undefined,
        wip_roll_width_mm: wipRollWidthForPayload,
        target_roll_width_mm: wipRollWidthForPayload,
        printing: master?.fixed_attributes?.print_capable
          ? { enabled: false, defer_artwork_to_planner: true }
          : { enabled: false },
        addons: [],
        auto_release: true,
      }),
    onSuccess: (data: any) => {
      toast({
        title: "Stock order created",
        description: data?.stock_order_number || "",
      });
      router.push("/dashboard/planner/control-tower/stock-intelligence");
    },
    onError: (err: any) =>
      toast({
        title: "Could not create",
        description: err?.message || "Try again",
        variant: "destructive",
      }),
  });

  const validation = validate.data;

  // Map the planner's validation response into the shared PreviewBomResult shape
  // so the LiveBomRail can render geometry + layers + materials + step ribbon
  // + checks consistently with Sales Create. Keeps the planner-specific intel
  // (eligible_demand, commitment_safety, required_material) on dedicated cards
  // below.
  const railPreview: PreviewBomResult | null = React.useMemo(() => {
    if (!validation) return null;
    return {
      variant_status: "EXISTS",
      invariant_signature:
        validation.invariant_signature ||
        master?.invariant_signature ||
        "INV-?",
      geometry_snapshot: validation.geometry_snapshot || {
        width_mm: sizes.find((s) => s.code === sizeCode)?.width_mm,
        height_mm: sizes.find((s) => s.code === sizeCode)?.height_mm,
        gusset_mm: sizes.find((s) => s.code === sizeCode)?.gusset_mm,
        roll_width_mm:
          wipRollWidthForPayload ||
          sizes.find((s) => s.code === sizeCode)?.roll_width_mm,
        child_target_width_mm:
          wipRollWidthForPayload ||
          sizes.find((s) => s.code === sizeCode)?.child_target_width_mm,
        wip_roll_width_mm: wipRollWidthForPayload,
        size_code: sizeCode,
      },
      layer_snapshot:
        Array.isArray(validation.layer_snapshot) &&
        validation.layer_snapshot.length
          ? validation.layer_snapshot
          : Object.entries(layerValues).map(([k, v]) => ({
              role: v.role,
              film_variant_code: v.film_variant_code,
              thickness_micron: v.thickness_micron,
              grade: v.grade,
              roll_width_mm:
                wipRollWidthForPayload ||
                selectedSizeDefaultRollWidth ||
                undefined,
              layer_index: Number(k),
            })),
      bom: validation.bom_snapshot || {},
      bom_snapshot: validation.bom_snapshot || {},
      bom_by_step: validation.bom_by_step || [],
      blockers: Array.isArray(validation.blockers) ? validation.blockers : [],
      warnings: [],
      unit_weight_g: undefined,
      total_weight_kg: qtyUom === "KG" ? quantity : undefined,
      checks: [
        {
          label: "Invariant signature resolved",
          ok: !!validation.invariant_signature,
          tone: "error",
        },
        {
          label: "Geometry snapshot captured",
          ok: !!validation.geometry_snapshot,
          tone: "warn",
        },
        {
          label: "Layer snapshot captured",
          ok:
            Array.isArray(validation.layer_snapshot) &&
            validation.layer_snapshot.length > 0,
          tone: "warn",
        },
        {
          label: "Stop rule valid for scope",
          ok: !!validation.valid,
          tone: "error",
        },
      ],
    };
  }, [
    validation,
    master,
    sizes,
    sizeCode,
    layerValues,
    qtyUom,
    quantity,
    wipRollWidthForPayload,
    selectedSizeDefaultRollWidth,
  ]);

  const masterFlagsForRail = master
    ? {
        print_capable: !!master.fixed_attributes?.print_capable,
        pod_locked: !!(
          master.fixed_attributes?.pod_enabled &&
          (master.fixed_attributes?.pod_variant_code ||
            master.fixed_attributes?.pod_variant)
        ),
        addons_axis: ((master.variant_axes || []).find(
          (a) => String(a.axis) === "addons" || String(a.axis) === "addon",
        )?.required
          ? "required"
          : (master.variant_axes || []).some(
                (a) =>
                  String(a.axis) === "addons" || String(a.axis) === "addon",
              )
            ? "optional"
            : "off") as "off" | "optional" | "required",
      }
    : undefined;
  const validationIssues = React.useMemo(() => {
    const issues = [
      ...(Array.isArray(validation?.reasons) ? validation.reasons : []),
      ...(Array.isArray(validation?.blockers) ? validation.blockers : []),
    ]
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    if (validate.isError)
      issues.push(describeApiError(validate.error, "Validation failed."));
    return Array.from(new Set(issues));
  }, [
    validate.error,
    validate.isError,
    validation?.blockers,
    validation?.reasons,
  ]);
  const masterLaunchIssues = React.useMemo(() => {
    if (!master) return [];
    const issues: string[] = [];
    if (!templateId) issues.push("No live template is bound.");
    if (templateId && !routeSelectionReady)
      issues.push("No route steps are exposed for this template.");
    if (!master.layer_template.length)
      issues.push("No film layer template is defined.");
    if (sizes.length === 0)
      issues.push("No active size/roll-width row is defined.");
    if (Object.keys(layerValues).length < master.layer_template.length)
      issues.push("Not all layer axes are filled.");
    if (
      !isFullRoute &&
      !isPackagingMaster &&
      !isPodBulkLaunch &&
      !(Number(wipRollWidthForPayload || 0) > 0)
    )
      issues.push("Enter WIP roll width for the stopped stock pool.");
    if (isPackagingMaster && !selectedPackaging)
      issues.push(
        "This Packaging Product Master has no active linked packaging SKU.",
      );
    if (isPodMaster && !selectedPod)
      issues.push("This POD Product Master has no active linked POD SKU.");
    return issues;
  }, [
    isFullRoute,
    isPackagingMaster,
    isPodMaster,
    isPodBulkLaunch,
    layerValues,
    master,
    routeSelectionReady,
    selectedPackaging,
    selectedPod,
    sizes.length,
    templateId,
    wipRollWidthForPayload,
  ]);
  const totalThickness = (validation?.layer_snapshot || []).reduce(
    (sum: number, layer: any) =>
      sum + Number(layer.thickness_micron || layer.thickness_um || 0),
    0,
  );
  const rollWidth = Number(
    (validation?.geometry_snapshot || {}).roll_width_mm ||
      (validation?.geometry_snapshot || {}).effective_width_mm ||
      (validation?.layer_snapshot || [])[0]?.roll_width_mm ||
      0,
  );
  const displayRollWidth =
    !isFullRoute && !isPackagingMaster && !isPodBulkLaunch
      ? Number(wipRollWidthForPayload || 0) || rollWidth
      : rollWidth;
  const bomMaterialCount = (validation?.bom_by_step || []).reduce(
    (sum: number, step: any) =>
      sum +
      (step.materials || []).filter(
        (mat: any) => mat.material_code && Number(mat.qty || 0) > 0,
      ).length,
    0,
  );
  const stockMathReady =
    !masterLaunchIssues.length &&
    (isPodBulkLaunch
      ? !!selectedPod
      : totalThickness > 0 && displayRollWidth > 0 && bomMaterialCount > 0);
  const checks: CheckLine[] = [
    {
      label: "Product master",
      ok: !!productMasterId && !masterLaunchIssues.length,
      tone: "error",
    },
    {
      label: "Template & route stop",
      ok:
        !!templateId &&
        routeSelectionReady &&
        backendStopStep >= backendStartStep,
      tone: "error",
    },
    {
      label: "Commitment safety",
      ok: !!validation?.valid && !validationIssues.length,
      tone: "error",
    },
    {
      label: "Axes complete",
      ok: !!sizeCode && !masterLaunchIssues.length,
      tone: "error",
    },
    { label: "Stock math + BOM", ok: stockMathReady, tone: "error" },
  ];
  const completed = computeCompleted({
    productMasterId,
    scope,
    stopStep: activeStopStep,
    sizeCode,
    quantity,
  });
  const requiredMaterial = validation?.required_material;

  const masterSelectIssues = React.useCallback((candidate: ProductMaster) => {
    const issues: string[] = [];
    if (!candidate.template && !candidate.default_template)
      issues.push("no template");
    if (!candidate.layer_template.length) issues.push("no layers");
    if (candidate.sizes_count === 0) issues.push("no sizes");
    if (
      (candidate.product_kind === "PACKAGING" ||
        candidate.product_kind === "POD") &&
      (candidate.catalog_links_count || 0) <= 0
    )
      issues.push("no SKU link");
    return issues;
  }, []);
  const filteredMasters = React.useMemo(() => {
    const q = masterSearch.trim().toLowerCase();
    return masters.filter((candidate) => {
      if (kindFilter !== "ALL" && candidate.product_kind !== kindFilter)
        return false;
      if (!q) return true;
      return `${candidate.code} ${candidate.name} ${candidate.product_kind}`
        .toLowerCase()
        .includes(q);
    });
  }, [kindFilter, masterSearch, masters]);
  const catalogSkuLabel = isPackagingMaster
    ? selectedPackaging
      ? `${selectedPackaging.code} - ${selectedPackaging.name}`
      : "No packaging SKU linked"
    : isPodMaster
      ? selectedPod
        ? `${selectedPod.code} - ${selectedPod.name || selectedPod.pod_sku_name}`
        : "No POD SKU linked"
      : "Not required";
  const firstBlocker =
    masterLaunchIssues[0] ||
    validationIssues[0] ||
    (!productMasterId ? "Pick a Product Master." : "");
  const createDisabled =
    !routeSelectionReady ||
    !validation?.valid ||
    !stockMathReady ||
    !productMasterId ||
    !!firstBlocker ||
    quantity <= 0 ||
    createMutation.isPending;
  const demand = validation?.eligible_demand as any;
  const demandComputed = Boolean(demand?.computed);
  const launchTitle = isPackagingMaster
    ? "Create packaging order -> production"
    : isPodMaster
      ? "Create POD bulk stock"
      : isFullRoute
        ? "Create stock order -> production"
        : "Create WIP pool -> production";
  const routeStopLabel =
    steps.find((step) => step.index === activeStopStep)?.label ||
    `Step ${activeStopStep}`;
  const routeStartLabel =
    steps.find((step) => step.index === activeStartStep)?.label ||
    `Step ${activeStartStep}`;
  const launchKindLabel = isPackagingMaster
    ? "Packaging stock"
    : isPodMaster
      ? "POD bulk roll"
      : isFullRoute
        ? "Finished stock"
        : "WIP pool";
  const stopBeforeArtwork =
    firstArtworkStep == null
      ? routeLast
      : ([...routeStepIndexes]
          .reverse()
          .find((idx) => idx < firstArtworkStep) ?? routeFirst);
  const fullRouteBlocked =
    firstArtworkStep != null &&
    (scope === "GENERIC" || scope === "CUSTOMER") &&
    !isInHouseCatalogMaster;
  const allIssues = React.useMemo(
    () =>
      Array.from(
        new Set([
          ...masterLaunchIssues,
          ...validationIssues,
          ...(!productMasterId ? ["Pick a Product Master."] : []),
        ]),
      ),
    [masterLaunchIssues, productMasterId, validationIssues],
  );

  return (
    <div className="space-y-5">
      <GradientHero
        eyebrow="PLANNER · LAUNCH STOCK"
        title="Launch stock from any Product Master"
        subtitle="Pick what to build, choose the commitment, choose how far the route should run, confirm the spec, then send the stock order straight to production. Packaging and POD are selected as Product Masters with live catalog SKU links."
        palette="indigo"
        chips={[
          {
            label: "Master",
            value: master?.code || "Pick one",
            icon: <Package className="h-3.5 w-3.5" />,
            tone: master ? "info" : undefined,
          },
          {
            label: "Kind",
            value: master?.product_kind || "Any",
            icon: <Boxes className="h-3.5 w-3.5" />,
            tone: isInHouseCatalogMaster ? "warn" : "violet",
          },
          {
            label: "Commitment",
            value: isInHouseCatalogMaster ? "In-house" : scope,
            icon: <UserSquare className="h-3.5 w-3.5" />,
            tone: scope === "GENERIC" ? "violet" : "ok",
          },
          {
            label: "Build to",
            value: isFullRoute ? "Full route" : routeStopLabel,
            icon: <Workflow className="h-3.5 w-3.5" />,
            tone: isFullRoute ? "ok" : "info",
          },
          {
            label: "Qty",
            value: `${quantity.toLocaleString()} ${qtyUom}`,
            icon: <Gauge className="h-3.5 w-3.5" />,
            tone: "info",
          },
          {
            label: "Status",
            value:
              validation?.valid && !firstBlocker
                ? "Ready"
                : firstBlocker
                  ? "Blocked"
                  : "Pending",
            tone:
              validation?.valid && !firstBlocker
                ? "ok"
                : firstBlocker
                  ? "error"
                  : "warn",
            icon:
              validation?.valid && !firstBlocker ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : (
                <AlertTriangle className="h-3.5 w-3.5" />
              ),
          },
        ]}
      >
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <HeroDecision
            label="What to build"
            value={master?.code || "Pick Product Master"}
          />
          <HeroDecision
            label="Commitment"
            value={
              isInHouseCatalogMaster
                ? "In-house production"
                : scope.replace("_", " + ")
            }
          />
          <HeroDecision
            label="Launch"
            value={
              validation?.valid && !firstBlocker
                ? "Direct to production"
                : firstBlocker || "Validating"
            }
          />
        </div>
      </GradientHero>

      <StepStrip
        steps={STEPS}
        currentId={stepId}
        completedIds={completed}
        onStepClick={setStepId}
      />

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[minmax(0,1fr)_410px]">
        <div className="space-y-4">
          <SectionCardV3
            index={1}
            title="What to build"
            description="Pick one active Product Master. Packaging and POD live here as kind-tagged masters."
            accent="blue"
          >
            <div className="flex flex-wrap items-center gap-2">
              {KIND_FILTERS.map((filter) => (
                <button
                  key={filter.id}
                  type="button"
                  onClick={() => setKindFilter(filter.id)}
                  className={cn(
                    "inline-flex h-9 items-center gap-2 rounded-full border px-3 text-xs font-black transition",
                    kindFilter === filter.id
                      ? "border-line-strong bg-surface-3 text-white shadow-sm"
                      : "border-line bg-surface-1 text-content-3 hover:border-info-border hover:bg-info-bg",
                  )}
                  title={filter.description}
                >
                  <Filter className="h-3.5 w-3.5" />
                  {filter.label}
                  <span className="rounded-full bg-surface-1/15 px-1.5 text-[10px]">
                    {filter.id === "ALL"
                      ? masters.length
                      : masters.filter((row) => row.product_kind === filter.id)
                          .length}
                  </span>
                </button>
              ))}
              <div className="ml-auto flex min-w-[220px] flex-1 items-center gap-2 rounded-xl border border-line bg-surface-1 px-3 py-2 shadow-sm sm:max-w-sm">
                <Search className="h-4 w-4 text-content-4" />
                <input
                  value={masterSearch}
                  onChange={(event) => setMasterSearch(event.target.value)}
                  placeholder="Search code or name..."
                  className="min-w-0 flex-1 bg-transparent text-sm font-semibold outline-none placeholder:text-content-4"
                />
              </div>
            </div>

            <div className="mt-3 overflow-hidden rounded-2xl border border-line bg-surface-1">
              {filteredMasters.slice(0, 9).map((candidate) => {
                const active = candidate.id === productMasterId;
                const issues = masterSelectIssues(candidate);
                return (
                  <button
                    key={candidate.id}
                    type="button"
                    onClick={() => {
                      if (!issues.length) setProductMasterId(candidate.id);
                    }}
                    disabled={issues.length > 0}
                    className={cn(
                      "flex w-full items-center gap-3 border-b border-line px-3 py-2.5 text-left last:border-b-0 transition",
                      active
                        ? "bg-info-bg ring-1 ring-inset ring-info-border"
                        : "bg-surface-1 hover:bg-surface-2",
                      issues.length ? "cursor-not-allowed opacity-55" : "",
                    )}
                  >
                    <span
                      className={cn(
                        "h-4 w-4 flex-none rounded-full border-2",
                        active
                          ? "border-primary bg-primary"
                          : "border-line-strong bg-surface-1",
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-black text-content-1">
                        {candidate.name}
                      </div>
                      <div className="font-mono text-[11px] font-bold text-primary">
                        {candidate.code}
                      </div>
                    </div>
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-black ring-1",
                        KIND_TONE[candidate.product_kind] || KIND_TONE.OTHER,
                      )}
                    >
                      {candidate.product_kind}
                    </span>
                    <Pill
                      tone={
                        candidate.catalog_links_count
                          ? "emerald"
                          : candidate.product_kind === "PACKAGING" ||
                              candidate.product_kind === "POD"
                            ? "amber"
                            : "slate"
                      }
                    >
                      {candidate.product_kind === "PACKAGING" ||
                      candidate.product_kind === "POD"
                        ? `${candidate.catalog_links_count || 0} SKU links`
                        : `${candidate.layer_template.length} layers`}
                    </Pill>
                    {issues.length ? (
                      <span className="text-[10px] font-bold text-warning-fg">
                        {issues.join(", ")}
                      </span>
                    ) : (
                      <ArrowRight className="h-4 w-4 text-content-4" />
                    )}
                  </button>
                );
              })}
              {!filteredMasters.length ? (
                <div className="px-4 py-8 text-center text-sm font-semibold text-content-3">
                  No matching active Product Masters.
                </div>
              ) : null}
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Live route template">
                <div className="flex min-h-10 items-center justify-between gap-3 rounded-xl border border-line bg-surface-2 px-3 py-2 shadow-sm">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-black text-content-2">
                      {master?.template_name ||
                        routeInfo?.template?.name ||
                        "No live route bound"}
                    </div>
                    <div className="text-[10px] font-semibold text-content-3">
                      Locked from Product Master
                    </div>
                  </div>
                  <Pill tone={templateId ? "emerald" : "amber"}>
                    {templateId ? "Route locked" : "Route missing"}
                  </Pill>
                </div>
              </Field>
              <LinkedSkuPanel
                masterKind={masterKind}
                selectedPackaging={selectedPackaging}
                selectedPod={selectedPod}
                packagingOptions={linkedPackagingMaterials}
                podOptions={linkedPodVariants}
                packagingMaterialId={packagingMaterialId}
                podVariantId={podVariantId}
                onPackagingChange={(value) => {
                  setPackagingMaterialId(value);
                  const next = linkedPackagingMaterials.find(
                    (row) => row.id === value,
                  );
                  setQtyUom(next?.base_uom === "PCS" ? "PCS" : "KG");
                }}
                onPodChange={setPodVariantId}
              />
            </div>

            {master ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <Pill tone="blue">{master.product_kind}</Pill>
                <Pill tone={master.layer_template.length ? "emerald" : "amber"}>
                  {master.layer_template.length} layers
                </Pill>
                <Pill tone={sizes.length ? "violet" : "amber"}>
                  {sizes.length} sizes
                </Pill>
                <Pill tone={templateId ? "slate" : "amber"}>
                  {templateId ? "Route live" : "Route missing"}
                </Pill>
                <Pill
                  tone={
                    isInHouseCatalogMaster
                      ? catalogSkuLabel.includes("No ")
                        ? "amber"
                        : "emerald"
                      : "slate"
                  }
                >
                  {catalogSkuLabel}
                </Pill>
              </div>
            ) : null}
          </SectionCardV3>

          <SectionCardV3
            index={2}
            title="Commitment"
            description="Controls stock reuse. In-house Packaging/POD masters are always internal."
            accent="violet"
          >
            {isInHouseCatalogMaster ? (
              <div className="rounded-2xl border border-success-border bg-success-bg px-4 py-3 text-sm font-semibold text-success-fg">
                <div className="flex items-center gap-2 font-black">
                  <Factory className="h-4 w-4" /> In-house production master
                </div>
                <p className="mt-1 text-xs leading-5">
                  No customer or artwork lock is applied. The linked catalog SKU
                  tells stores and packing what this production order will
                  create.
                </p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
                  {[
                    {
                      id: "GENERIC",
                      label: "Generic pool",
                      icon: <Unlock className="h-4 w-4" />,
                      text: "Widest reuse",
                    },
                    {
                      id: "CUSTOMER",
                      label: "Customer",
                      icon: <Lock className="h-4 w-4" />,
                      text: "Buyer locked",
                    },
                    {
                      id: "ARTWORK",
                      label: "Artwork",
                      icon: <Palette className="h-4 w-4" />,
                      text: "Print locked",
                    },
                    {
                      id: "CUSTOMER_ARTWORK",
                      label: "Customer + art",
                      icon: <ShieldCheck className="h-4 w-4" />,
                      text: "Exact only",
                    },
                  ].map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setScope(item.id as CommitmentScope)}
                      className={cn(
                        "rounded-2xl border px-3 py-3 text-left transition",
                        scope === item.id
                          ? "border-primary bg-info-bg text-primary ring-2 ring-info-border"
                          : "border-line bg-surface-1 text-content-2 hover:border-info-border",
                      )}
                    >
                      <div className="flex items-center justify-between text-xs font-black">
                        {item.label}
                        {item.icon}
                      </div>
                      <div className="mt-1 text-[10px] font-semibold text-content-3">
                        {item.text}
                      </div>
                    </button>
                  ))}
                </div>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Customer lock">
                    <Select
                      value={committedCustomer}
                      onValueChange={setCommittedCustomer}
                      disabled={scope === "GENERIC" || scope === "ARTWORK"}
                    >
                      <SelectTrigger className="h-10 rounded-xl border-line shadow-sm">
                        <SelectValue
                          placeholder={
                            scope === "GENERIC" || scope === "ARTWORK"
                              ? "Not needed"
                              : "Pick customer"
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        {customers.map((customer) => (
                          <SelectItem key={customer.id} value={customer.id}>
                            {customer.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Artwork lock">
                    <Select
                      value={committedArtwork || "__none"}
                      onValueChange={(value) =>
                        setCommittedArtwork(value === "__none" ? "" : value)
                      }
                      disabled={scope === "GENERIC" || scope === "CUSTOMER"}
                    >
                      <SelectTrigger className="h-10 rounded-xl border-line shadow-sm">
                        <SelectValue
                          placeholder={
                            scope === "GENERIC" || scope === "CUSTOMER"
                              ? "Deferred"
                              : "Pick artwork"
                          }
                        />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">No artwork</SelectItem>
                        {artworks.map((artwork: any) => (
                          <SelectItem key={artwork.id} value={artwork.id}>
                            {artwork.design_code || artwork.name || artwork.id}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
              </>
            )}
          </SectionCardV3>

          <SectionCardV3
            index={3}
            title="Build up to"
            description="Choose whether this order becomes a finished stock item or a WIP pool."
            accent="emerald"
            actions={
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ring-inset",
                  validation?.valid
                    ? "bg-success-bg text-success-fg ring-success-border"
                    : "bg-warning-bg text-warning-fg ring-warning-border",
                )}
              >
                {validation?.valid
                  ? "Stop rule valid"
                  : "Stop rule check needed"}
              </span>
            }
          >
            <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => {
                  if (!fullRouteBlocked) setStopStep(routeLast);
                }}
                disabled={fullRouteBlocked}
                className={cn(
                  "rounded-2xl border px-4 py-3 text-left transition",
                  isFullRoute && !fullRouteBlocked
                    ? "border-success-border bg-success-bg ring-2 ring-success-border"
                    : "border-line bg-surface-1 hover:border-success-border",
                  fullRouteBlocked ? "cursor-not-allowed opacity-55" : "",
                )}
              >
                <div className="flex items-center justify-between text-sm font-black text-content-1">
                  Finished stock
                  <PackageCheck className="h-4 w-4 text-success-fg" />
                </div>
                <p className="mt-1 text-[11px] font-semibold leading-5 text-content-3">
                  Run through the full route and create final stock.
                  Generic/customer pools cannot cross the first artwork step.
                </p>
                {fullRouteBlocked ? (
                  <Pill tone="amber">
                    Needs artwork commitment for full route
                  </Pill>
                ) : (
                  <Pill tone={isFullRoute ? "emerald" : "slate"}>
                    Stop:{" "}
                    {steps.find((s) => s.index === routeLast)?.label ||
                      "last step"}
                  </Pill>
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  setStartStep(routeFirst);
                  setStopStep(stopBeforeArtwork);
                }}
                className={cn(
                  "rounded-2xl border px-4 py-3 text-left transition",
                  !isFullRoute
                    ? "border-primary bg-info-bg ring-2 ring-info-border"
                    : "border-line bg-surface-1 hover:border-info-border",
                )}
              >
                <div className="flex items-center justify-between text-sm font-black text-content-1">
                  WIP pool
                  <Zap className="h-4 w-4 text-primary" />
                </div>
                <p className="mt-1 text-[11px] font-semibold leading-5 text-content-3">
                  Stop mid-route and bank reusable rolls. Orders resume from the
                  saved stop in WCM.
                </p>
                <Pill tone={!isFullRoute ? "blue" : "slate"}>
                  Stop:{" "}
                  {steps.find((s) => s.index === stopBeforeArtwork)?.label ||
                    "selected step"}
                </Pill>
              </button>
            </div>
            <RouteTimeline
              steps={steps}
              startIndex={activeStartStep}
              stopIndex={activeStopStep}
              onSelectStop={setStopStep}
              onSelectStart={setStartStep}
              helperText={
                isInHouseCatalogMaster
                  ? "Manual Packaging/POD launch goes straight to production and uses this route as the production build plan."
                  : scope === "GENERIC"
                    ? "Generic and customer scopes must stop before the first artwork step."
                    : scope.includes("ARTWORK")
                      ? "Artwork scopes must stop at or after the first artwork step."
                      : "Customer scope must stop before the artwork step."
              }
            />
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <Mini
                label="Route start"
                value={routeStartLabel}
                subtle={`backend ${backendStartStep}`}
              />
              <Mini
                label="Route stop"
                value={routeStopLabel}
                subtle={`backend ${backendStopStep}`}
              />
              <Mini
                label="Launch kind"
                value={launchKindLabel}
                subtle={
                  isInHouseCatalogMaster
                    ? "catalog linked"
                    : scope.replace("_", " + ")
                }
              />
            </div>
          </SectionCardV3>

          {master ? (
            <SectionCardV3
              index={4}
              title="Spec / axes"
              description="Size, stock form, layer stack and width math from the Product Master."
              accent="blue"
            >
              <div className="space-y-4">
                <div>
                  <Label className="text-[10px] font-black uppercase tracking-[0.22em] text-content-3">
                    Size / roll math
                  </Label>
                  <div className="mt-2 grid max-h-60 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-4">
                    {sizes.map((s) => {
                      const active = s.code === sizeCode;
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => setSizeCode(s.code)}
                          className={cn(
                            "rounded-2xl border px-3 py-2.5 text-left shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-info-border",
                            active
                              ? "border-primary bg-gradient-to-br from-info-bg to-surface-1 ring-2 ring-info-border "
                              : "border-line bg-surface-1 hover:border-info-border hover:shadow-md",
                          )}
                        >
                          <div className="flex items-center justify-between">
                            <div className="text-[10px] font-black uppercase tracking-wider text-content-4">
                              {s.code}
                            </div>
                            <span
                              className={cn(
                                "h-3.5 w-3.5 rounded-full border-2 transition",
                                active
                                  ? "border-primary bg-primary shadow-sm "
                                  : "border-line-strong bg-surface-1",
                              )}
                            />
                          </div>
                          <div className="text-sm font-bold text-content-1">
                            {s.width_mm} mm
                          </div>
                          <div className="text-[10px] text-content-4">
                            {s.label || s.stock_form || "size row"}
                          </div>
                          <div className="mt-1 text-[10px] font-bold text-primary">
                            Roll{" "}
                            {s.roll_width_mm ||
                              s.child_target_width_mm ||
                              s.width_mm ||
                              "-"}{" "}
                            mm
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                  <Mini
                    label="Product size"
                    value={`${selectedSize?.width_mm ?? 0} mm`}
                    subtle={selectedSize?.width_basis || "finished geometry"}
                  />
                  <Mini
                    label={isFullRoute ? "Final roll width" : "WIP roll width"}
                    value={`${displayRollWidth || selectedSizeDefaultRollWidth || 0} mm`}
                    subtle={
                      isFullRoute ? "from size row" : "operator confirmed"
                    }
                  />
                  <Mini
                    label="Width match"
                    value={
                      selectedSize?.slit_policy === "EXACT_ONLY"
                        ? "Exact only"
                        : "Same or wider"
                    }
                    subtle={selectedSize?.slit_policy || "slit policy"}
                  />
                  <Mini
                    label="Stock form"
                    value={
                      selectedSize?.stock_form ||
                      selectedSize?.roll_form ||
                      "Not set"
                    }
                    subtle={
                      selectedSize?.pouch_style_master_code ||
                      selectedSize?.pouch_style ||
                      "size formula"
                    }
                  />
                </div>

                {!isFullRoute && !isPackagingMaster ? (
                  <div className="rounded-2xl border border-info-border bg-info-bg p-3 ring-1 ring-info-border">
                    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[260px_minmax(0,1fr)]">
                      <Field label="Interim WIP roll width">
                        <div className="relative">
                          <Input
                            type="number"
                            min={1}
                            step={0.01}
                            value={wipRollWidthMm}
                            onChange={(event) =>
                              setWipRollWidthMm(
                                event.target.value === ""
                                  ? ""
                                  : Number(event.target.value),
                              )
                            }
                            className="h-11 rounded-xl border-info-border bg-surface-1 pr-12 font-mono text-sm font-black shadow-sm"
                          />
                          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-black text-content-4">
                            mm
                          </span>
                        </div>
                      </Field>
                      <div>
                        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-primary">
                          Product Master roll options
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {wipRollWidthOptions.map((option) => (
                            <button
                              key={option}
                              type="button"
                              onClick={() => setWipRollWidthMm(option)}
                              className={cn(
                                "rounded-full px-3 py-1 text-[11px] font-black ring-1 transition",
                                Number(wipRollWidthMm || 0) === option
                                  ? "bg-primary text-white ring-primary"
                                  : "bg-surface-1 text-primary ring-info-border hover:bg-info-bg",
                              )}
                            >
                              {option} mm
                            </button>
                          ))}
                        </div>
                        <div className="mt-2 text-[11px] font-semibold leading-5 text-primary">
                          This is the parked WIP roll width. Sales demand can
                          resume from this pool when the required width is the
                          same or lower and the size row allows slitting;
                          too-narrow rolls are not shown in planner allocation.
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}

                <div>
                  <Label className="text-[10px] font-black uppercase tracking-[0.22em] text-content-3">
                    Per-layer axes
                  </Label>
                  <div className="mt-2">
                    <AxisLayerMatrix
                      layers={master.layer_template}
                      values={layerValues}
                      fallbackWidthMm={
                        sizes.find((s) => s.code === sizeCode)?.roll_width_mm ??
                        undefined
                      }
                      showWidthColumn={false}
                      onChange={(idx, patch) =>
                        setLayerValues((prev) => ({
                          ...prev,
                          [idx]: {
                            ...(prev[idx] || ({} as LayerRowState)),
                            ...patch,
                          },
                        }))
                      }
                    />
                  </div>
                </div>

                <div className="rounded-xl border border-success-border bg-success-bg px-3 py-2 text-xs text-success-fg ring-1 ring-success-border">
                  <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.22em] text-success-fg">
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                    Stock form proof
                  </div>
                  <p className="mt-1 text-[11px] leading-5">
                    Roll matching uses the physical form, child target width and
                    slit policy from the size row. The operator does not pick a
                    separate roll mode here; the Product Master size row decides
                    whether the stock is open web, lay-flat tube or folded web.
                  </p>
                </div>
              </div>
            </SectionCardV3>
          ) : null}

          <SectionCardV3
            index={5}
            title="Quantity"
            description={
              !isFullRoute && !isPackagingMaster
                ? "This is interim WIP roll weight. It is not the final sales-order quantity."
                : "Only quantity and UOM are operator choices. Stock behavior below is derived from the master, route stop and commitment."
            }
            accent="violet"
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Field
                label={
                  !isFullRoute && !isPackagingMaster
                    ? "Target WIP roll weight"
                    : "Target quantity"
                }
              >
                <Input
                  type="number"
                  value={quantity}
                  onChange={(e) => setQuantity(Number(e.target.value))}
                  className="h-10 rounded-xl border-line shadow-sm"
                />
              </Field>
              <Field label="UOM">
                <Select
                  value={qtyUom}
                  onValueChange={(v) => setQtyUom(v as any)}
                >
                  <SelectTrigger className="h-10 rounded-xl border-line shadow-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="KG">KG</SelectItem>
                    <SelectItem value="PCS">PCS</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <button
              type="button"
              onClick={() => setShowDerived((value) => !value)}
              className="mt-3 inline-flex items-center gap-2 rounded-full border border-line bg-surface-1 px-3 py-1.5 text-xs font-black text-content-2 shadow-sm hover:bg-surface-2"
            >
              <FileText className="h-3.5 w-3.5" />
              {showDerived ? "Hide derived behavior" : "Show derived behavior"}
            </button>
            {showDerived ? (
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
                <Mini
                  label="Stock strategy"
                  value={derivedStockStrategy}
                  subtle={isFullRoute ? "full route" : "route stop"}
                />
                <Mini
                  label="Planner class"
                  value={derivedPlannerStockClass}
                  subtle={masterKind}
                />
                <Mini
                  label="Output type"
                  value={derivedOutputType}
                  subtle={catalogSkuLabel}
                />
                <Mini
                  label="Stock owner"
                  value="Internal"
                  subtle="manual launcher"
                />
              </div>
            ) : null}
            <div className="mt-3 rounded-xl border border-info-border bg-info-bg px-3 py-2 text-xs font-semibold leading-5 text-primary">
              <MapPin className="mr-1 inline h-3.5 w-3.5" />
              Manual launches from this page create the production order
              directly. Low-stock auto demand can still flow to planner demand
              review, but this manual path is an explicit production release.
            </div>
          </SectionCardV3>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-4 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pb-4">
          {/* Live BOM rail — same shell as Sales Create, mapped from planner validation */}
          <LiveBomRail
            title={`Stock pool · ${master?.code || "pick a master"}`}
            subtitle={
              validation?.invariant_signature
                ? `inv ${String(validation.invariant_signature).slice(0, 16)}`
                : "Invariant pending"
            }
            preview={railPreview}
            loading={validate.isFetching}
            scope="order"
            masterFlags={masterFlagsForRail}
            routeSteps={steps.map((s) => ({
              index: s.index,
              name: s.label,
              transition: s.transition,
              has_artwork: s.artwork_step,
            }))}
            routeTemplateName={master?.template_name || undefined}
          />

          {allIssues.length ? (
            <SectionCardV3
              title="Launch blockers"
              description="Fix these before creating stock."
              accent="amber"
            >
              <IssueList title="Release blockers" issues={allIssues} />
            </SectionCardV3>
          ) : null}

          {/* Required material — keep as compact card, planner-specific */}
          {requiredMaterial ? (
            <SectionCardV3
              title="Primary required material"
              description="To launch this stock pool"
              accent="emerald"
            >
              <div className="rounded-xl bg-success-bg ring-1 ring-success-border px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-surface-1 px-2 py-0.5 text-xs font-mono font-bold text-success-fg ring-1 ring-success-border">
                    {requiredMaterial.code}
                  </span>
                  <span className="text-sm font-bold text-content-2 truncate">
                    {requiredMaterial.name}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                  <Mini label="Grade" value={requiredMaterial.grade || "GP"} />
                  <Mini
                    label="Thickness"
                    value={`${requiredMaterial.thickness_micron ?? 0} μ`}
                  />
                  <Mini
                    label="Width"
                    value={`${requiredMaterial.width_mm ?? 0} mm`}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px]">
                  <span className="font-bold uppercase tracking-wider text-success-fg">
                    Target qty
                  </span>
                  <span className="font-mono font-black text-success-fg">
                    {requiredMaterial.target_qty} {requiredMaterial.uom}
                  </span>
                </div>
              </div>
            </SectionCardV3>
          ) : null}

          {/* Matching demand — planner-only signal */}
          <SectionCardV3
            title="Matching demand"
            description="Open sales lines that can pull from this pool"
            accent="emerald"
          >
            {demandComputed ? (
              <div className="grid grid-cols-2 gap-2">
                <Mini
                  label="Eligible orders"
                  value={`${demand?.eligible_orders ?? 0}`}
                  subtle="Can match"
                />
                <Mini
                  label="Exact width"
                  value={`${demand?.exact_match ?? 0}`}
                  subtle="same stock form"
                />
                <Mini
                  label="Slit allowed"
                  value={`${demand?.widening_allowed ?? 0}`}
                  subtle="policy fallback"
                />
                <Mini
                  label="Wrong lock"
                  value={`${demand?.wrong_artwork ?? 0}`}
                  subtle="blocked"
                />
              </div>
            ) : (
              <div className="rounded-xl border border-line bg-surface-2 px-3 py-3 text-xs font-semibold leading-5 text-content-3">
                Demand matching is not computed by the backend for this
                validation response yet. No fake order counts are shown here;
                the order will still create/release using live BOM, route and
                stock-form validation.
              </div>
            )}
          </SectionCardV3>

          {/* Commitment safety — planner-only signal */}
          <SectionCardV3
            title="Commitment safety"
            description="What this pool will and won't match"
            accent="amber"
          >
            <SafetyRow
              label="Customer lock"
              value={
                validation?.commitment_safety?.customer_lock ||
                (committedCustomer ? "Pending" : "None")
              }
              note={
                committedCustomer
                  ? "Locked to picked customer."
                  : "Generic stock has no customer lock."
              }
            />
            <SafetyRow
              label="Artwork lock"
              value={
                validation?.commitment_safety?.artwork_lock ||
                (committedArtwork ? "Pending" : "None")
              }
              note={
                committedArtwork
                  ? "Locked to picked artwork."
                  : "No artwork commitment applied."
              }
            />
            <SafetyRow
              label="Match window"
              value={
                validation?.commitment_safety?.match_window ||
                "Before print only"
              }
              note={
                scope.includes("ARTWORK")
                  ? "After artwork step — must match same artwork."
                  : "Can match any demand before the artwork step."
              }
            />
          </SectionCardV3>
        </aside>
      </div>

      <ValidationFooter
        checks={checks}
        autosaveLabel={
          firstBlocker
            ? `Blocked: ${firstBlocker}`
            : "Ready for direct production release"
        }
        secondaryActions={
          <div className="flex max-w-[560px] flex-wrap items-center gap-1.5">
            <Pill tone={master ? "blue" : "amber"}>
              {master?.code || "No master"}
            </Pill>
            <Pill tone={!isFullRoute ? "violet" : "emerald"}>
              {isFullRoute ? "Full route" : `Stop ${routeStopLabel}`}
            </Pill>
            <Pill tone={!isFullRoute ? "blue" : "slate"}>
              {!isFullRoute && !isPackagingMaster
                ? `${displayRollWidth || 0} mm WIP`
                : `${displayRollWidth || 0} mm`}
            </Pill>
            <Pill tone="slate">
              {quantity.toLocaleString()} {qtyUom}
            </Pill>
            {firstBlocker ? (
              <Pill tone="amber">Blocker live</Pill>
            ) : (
              <Pill tone="emerald">No blockers</Pill>
            )}
          </div>
        }
        primaryActions={
          <>
            <Button
              variant="outline"
              onClick={() => validate.refetch()}
              className="rounded-xl border-success-border bg-success-bg text-success-fg shadow-sm hover:bg-success-bg"
            >
              <CheckCircle2 className="mr-1.5 h-4 w-4" />
              Validate pool
            </Button>
            <Button
              disabled={createDisabled}
              onClick={() => createMutation.mutate()}
              className="gap-1.5 rounded-xl bg-gradient-to-r from-order-fg to-order-fg shadow-lg hover:shadow-xl hover:"
            >
              {createMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ClipboardCheck className="h-4 w-4" />
              )}
              {launchTitle}
            </Button>
          </>
        }
      />
    </div>
  );
}

function HeroDecision({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-surface-1/15 bg-surface-1/10 px-3 py-2 text-white shadow-sm ring-1 ring-surface-1/10">
      <div className="text-[10px] font-black uppercase tracking-[0.2em] text-white/65">
        {label}
      </div>
      <div className="mt-0.5 truncate text-sm font-black">{value}</div>
    </div>
  );
}

function LinkedSkuPanel({
  masterKind,
  selectedPackaging,
  selectedPod,
  packagingOptions,
  podOptions,
  packagingMaterialId,
  podVariantId,
  onPackagingChange,
  onPodChange,
}: {
  masterKind: ProductKind;
  selectedPackaging?: PackagingMaterial;
  selectedPod?: PodSkuVariant;
  packagingOptions: PackagingMaterial[];
  podOptions: PodSkuVariant[];
  packagingMaterialId: string;
  podVariantId: string;
  onPackagingChange: (value: string) => void;
  onPodChange: (value: string) => void;
}) {
  if (masterKind === "PACKAGING") {
    return (
      <Field label="Linked packaging SKU">
        <Select
          value={packagingMaterialId || "__none"}
          onValueChange={(value) =>
            onPackagingChange(value === "__none" ? "" : value)
          }
        >
          <SelectTrigger className="h-10 rounded-xl border-line shadow-sm">
            <SelectValue placeholder="Pick linked packaging SKU" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none">Select packaging SKU</SelectItem>
            {packagingOptions.map((material) => (
              <SelectItem key={material.id} value={material.id}>
                {material.code} - {material.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="mt-2 rounded-xl border border-warning-border bg-warning-bg px-3 py-2 text-[11px] font-semibold leading-5 text-warning-fg">
          <Layers className="mr-1 inline h-3.5 w-3.5" />
          {selectedPackaging
            ? `Creates ${selectedPackaging.code} as live packaging inventory.`
            : "No active linked packaging SKU is available on this Product Master."}
        </div>
      </Field>
    );
  }

  if (masterKind === "POD") {
    return (
      <Field label="Linked POD SKU">
        <Select
          value={podVariantId || "__none"}
          onValueChange={(value) =>
            onPodChange(value === "__none" ? "" : value)
          }
        >
          <SelectTrigger className="h-10 rounded-xl border-line shadow-sm">
            <SelectValue placeholder="Pick linked POD SKU" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none">Select POD SKU</SelectItem>
            {podOptions.map((pod) => (
              <SelectItem key={pod.id} value={pod.id}>
                {pod.code} - {pod.name || pod.pod_sku_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="mt-2 rounded-xl border border-order-border bg-order-bg px-3 py-2 text-[11px] font-semibold leading-5 text-order-fg">
          <Sparkles className="mr-1 inline h-3.5 w-3.5" />
          {selectedPod
            ? `Creates ${selectedPod.code} as in-house POD roll stock.`
            : "No active linked POD SKU is available on this Product Master."}
        </div>
      </Field>
    );
  }

  return (
    <div className="rounded-2xl border border-line bg-surface-2 px-3 py-2 shadow-sm">
      <div className="text-[10px] font-black uppercase tracking-[0.22em] text-content-3">
        Catalog SKU link
      </div>
      <div className="mt-1 text-sm font-bold text-content-2">
        Not required for this Product Master
      </div>
      <div className="text-[10px] font-semibold text-content-3">
        Pouch and roll stock uses the master variant axes and route math.
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label className="text-[10px] font-black uppercase tracking-[0.22em] text-content-3">
        {label}
      </Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function Pill({
  tone,
  children,
}: {
  tone: "blue" | "violet" | "fuchsia" | "amber" | "emerald" | "slate";
  children: React.ReactNode;
}) {
  const map: Record<string, string> = {
    blue: "bg-info-bg text-primary ring-info-border shadow-sm",
    violet: "bg-order-bg text-order-fg ring-order-border shadow-sm",
    fuchsia: "bg-order-bg text-order-fg ring-order-border shadow-sm",
    amber: "bg-warning-bg text-warning-fg ring-warning-border shadow-sm",
    emerald: "bg-success-bg text-success-fg ring-success-border shadow-sm",
    slate: "bg-surface-2 text-content-2 ring-line shadow-sm",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold ring-1 ring-inset",
        map[tone],
      )}
    >
      {children}
    </span>
  );
}

function IssueList({ title, issues }: { title: string; issues: string[] }) {
  if (!issues.length) return null;
  return (
    <div className="rounded-xl border border-warning-border bg-warning-bg px-3 py-2 text-xs text-warning-fg ring-1 ring-warning-border">
      <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-warning-fg">
        <AlertTriangle className="h-3.5 w-3.5" />
        {title}
      </div>
      <ul className="mt-1.5 space-y-1">
        {issues.map((issue) => (
          <li key={issue} className="leading-5">
            {issue}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Mini({
  label,
  value,
  subtle,
}: {
  label: string;
  value: string;
  subtle?: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-gradient-to-br from-surface-2 to-white px-3 py-2 shadow-sm">
      <div className="text-[10px] font-bold uppercase tracking-wider text-content-4">
        {label}
      </div>
      <div className="text-sm font-bold text-content-2">{value}</div>
      {subtle ? (
        <div className="text-[10px] text-content-3">{subtle}</div>
      ) : null}
    </div>
  );
}

function SafetyRow({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="mb-2 flex items-start justify-between rounded-xl border border-line bg-gradient-to-br from-warning-bg to-white px-3 py-2.5 shadow-sm last:mb-0">
      <div>
        <div className="text-[10px] font-bold uppercase tracking-wider text-content-4">
          {label}
        </div>
        <div className="text-sm font-bold text-content-2">{value}</div>
      </div>
      <span className="ml-2 max-w-[120px] text-right text-[10px] font-medium text-content-3">
        {note}
      </span>
    </div>
  );
}

function computeCompleted({
  productMasterId,
  scope,
  stopStep,
  sizeCode,
  quantity,
}: any): string[] {
  const out: string[] = [];
  if (productMasterId) out.push("master");
  if (scope) out.push("commitment");
  if (stopStep >= 0) out.push("stop");
  if (sizeCode) out.push("axes");
  if (quantity > 0) out.push("quantity");
  if (productMasterId && scope && stopStep >= 0 && sizeCode && quantity > 0)
    out.push("preview");
  return out;
}

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

import { SpecPlate } from "@/components/plate/spec-plate";
import { specFromMasterLine } from "@/components/plate/spec-from-master";
import { ChoiceCard, Pill as StatusPill, StepDot } from "@/components/plate/steps";
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

  const [kindFilter, setKindFilter] = React.useState<ProductKind | "ALL">(
    "ALL",
  );
  const [masterSearch, setMasterSearch] = React.useState("");
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
    routeNodeId: step.route_node_id,
    branchKey: step.branch_key,
    joinKey: step.join_key,
    parallelGroup: step.parallel_group,
    predecessorNodeIds: step.predecessor_node_ids,
    successorNodeIds: step.successor_node_ids,
    isJoin: step.is_join,
    isParallelStart: step.is_parallel_start,
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

  const launchReady = !!validation?.valid && !firstBlocker;
  const plateData = master
    ? specFromMasterLine({
        layers: master.layer_template,
        size: selectedSize,
        choices: layerValues as any,
      })
    : null;
  const wipMode = !isFullRoute && !isPackagingMaster;

  return (
    <div className="mx-auto grid max-w-[1400px] gap-4 pb-6">
      <header className="flex flex-wrap items-start gap-4 pt-1">
        <div className="grid min-w-0 gap-1.5">
          <div className="text-[12.5px] text-content-3">Plan · Launch stock</div>
          <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.025em] text-content-1">
            {master ? `Launch ${master.name}` : "Launch stock from a product master"}
          </h1>
          <p className="max-w-3xl text-[13.5px] text-content-3">
            Three decisions: what to build, who it is for, and how far the route runs. The stock order goes straight to production.
          </p>
          <div className="flex flex-wrap gap-1.5">
            <StatusPill tone={master ? "info" : "plain"}>{master?.code || "no master yet"}</StatusPill>
            <StatusPill>{isInHouseCatalogMaster ? "in-house" : scope.replace("_", " + ").toLowerCase()}</StatusPill>
            <StatusPill>{isFullRoute ? "full route" : `stop at ${routeStopLabel.toLowerCase()}`}</StatusPill>
            <StatusPill>
              {quantity.toLocaleString("en-IN")} {qtyUom.toLowerCase()}
            </StatusPill>
            <StatusPill tone={launchReady ? "ok" : firstBlocker ? "warn" : "plain"}>
              {launchReady ? "ready to launch" : firstBlocker ? "blocked" : "checking"}
            </StatusPill>
            <StatusPill>{completed.length} of {STEPS.length} decided</StatusPill>
          </div>
        </div>
      </header>

      {/* ── The three decisions ─────────────────────────────── */}
      <div className="grid gap-4 xl:grid-cols-3">
        <DecisionCard step={1} done={!!master} title="What to build" hint="one active product master">
          <div className="flex flex-wrap gap-1.5">
            {KIND_FILTERS.map((filter) => (
              <button
                key={filter.id}
                type="button"
                onClick={() => setKindFilter(filter.id)}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-medium transition",
                  kindFilter === filter.id
                    ? "bg-plate text-plate-fg"
                    : "bg-surface-2 text-content-2 hover:bg-surface-3/10",
                )}
                title={filter.description}
              >
                {filter.label}
                <span className="tabular-nums opacity-60">
                  {filter.id === "ALL"
                    ? masters.length
                    : masters.filter((row) => row.product_kind === filter.id).length}
                </span>
              </button>
            ))}
          </div>
          <div className="flex h-10 items-center gap-2 rounded-[12px] border border-line-strong bg-surface-1 px-3 focus-within:border-primary focus-within:ring-4 focus-within:ring-info-bg">
            <Search className="h-4 w-4 text-content-4" />
            <input
              value={masterSearch}
              onChange={(event) => setMasterSearch(event.target.value)}
              placeholder="Search code or name..."
              className="min-w-0 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-content-4"
            />
          </div>
          <div className="max-h-[300px] overflow-y-auto rounded-[12px] border border-line">
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
                    "grid w-full grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-2.5 border-b border-line px-3 py-2 text-left transition last:border-b-0",
                    active ? "bg-info-bg" : "bg-surface-1 hover:bg-surface-2",
                    issues.length ? "cursor-not-allowed opacity-55" : "",
                  )}
                >
                  <span
                    className={cn(
                      "h-4 w-4 rounded-full border-2",
                      active ? "border-primary bg-primary" : "border-line-strong bg-surface-1",
                    )}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-content-1">{candidate.name}</span>
                    <span className="block truncate font-mono text-[11.5px] text-content-3">
                      {candidate.code}
                      {issues.length ? ` · ${issues.join(", ")}` : ""}
                    </span>
                  </span>
                  <span className="text-right text-[11.5px] text-content-3">
                    {String(candidate.product_kind || "").toLowerCase()}
                    <span className="block">
                      {candidate.product_kind === "PACKAGING" || candidate.product_kind === "POD"
                        ? `${candidate.catalog_links_count || 0} SKU links`
                        : `${candidate.layer_template.length} layers`}
                    </span>
                  </span>
                </button>
              );
            })}
            {!filteredMasters.length ? (
              <div className="px-4 py-6 text-center text-[13px] text-content-3">
                No matching active Product Masters.
              </div>
            ) : null}
          </div>
          <Field label="Live route template">
            <div className="flex min-h-10 items-center justify-between gap-3 rounded-[12px] bg-surface-2 px-3 py-2">
              <div className="min-w-0">
                <div className="truncate text-[13px] font-medium text-content-1">
                  {master?.template_name || routeInfo?.template?.name || "No live route bound"}
                </div>
                <div className="text-[11.5px] text-content-3">Locked from Product Master</div>
              </div>
              <Pill tone={templateId ? "emerald" : "amber"}>{templateId ? "Route locked" : "Route missing"}</Pill>
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
              const next = linkedPackagingMaterials.find((row) => row.id === value);
              setQtyUom(next?.base_uom === "PCS" ? "PCS" : "KG");
            }}
            onPodChange={setPodVariantId}
          />
          {master ? (
            <div className="flex flex-wrap gap-1.5">
              <Pill tone="blue">{master.product_kind}</Pill>
              <Pill tone={master.layer_template.length ? "slate" : "amber"}>{master.layer_template.length} layers</Pill>
              <Pill tone={sizes.length ? "slate" : "amber"}>{sizes.length} sizes</Pill>
              <Pill tone={isInHouseCatalogMaster ? (catalogSkuLabel.includes("No ") ? "amber" : "emerald") : "slate"}>
                {catalogSkuLabel}
              </Pill>
            </div>
          ) : null}
        </DecisionCard>

        <DecisionCard step={2} done={!!scope} title="Commitment" hint="controls stock reuse">
          {isInHouseCatalogMaster ? (
            <div className="rounded-[13px] bg-success-bg px-3.5 py-3 text-[13px] text-success-fg">
              <div className="flex items-center gap-2 font-semibold">
                <Factory className="h-4 w-4" /> In-house production master
              </div>
              <p className="mt-1 text-[12.5px] leading-5">
                No customer or artwork lock is applied. The linked catalog SKU tells stores and packing what this production order will create.
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                {[
                  { id: "GENERIC", label: "Generic pool", text: "any order may use it", tag: "POOL", icon: <Unlock /> },
                  { id: "CUSTOMER", label: "Customer", text: "held for one buyer", tag: "CUST", icon: <Lock /> },
                  { id: "ARTWORK", label: "Artwork", text: "printed for one artwork", tag: "ART", icon: <Palette /> },
                  { id: "CUSTOMER_ARTWORK", label: "Customer + art", text: "exact match only", tag: "C+A", icon: <ShieldCheck /> },
                ].map((item) => (
                  <ChoiceCard
                    key={item.id}
                    selected={scope === item.id}
                    title={item.label}
                    sub={item.text}
                    tag={item.tag}
                    icon={item.icon}
                    onClick={() => setScope(item.id as CommitmentScope)}
                  />
                ))}
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                <Field label="Customer lock">
                  <Select
                    value={committedCustomer}
                    onValueChange={setCommittedCustomer}
                    disabled={scope === "GENERIC" || scope === "ARTWORK"}
                  >
                    <SelectTrigger className="h-10 rounded-[11px] border-line-strong">
                      <SelectValue
                        placeholder={scope === "GENERIC" || scope === "ARTWORK" ? "Not needed" : "Pick customer"}
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
                    onValueChange={(value) => setCommittedArtwork(value === "__none" ? "" : value)}
                    disabled={scope === "GENERIC" || scope === "CUSTOMER"}
                  >
                    <SelectTrigger className="h-10 rounded-[11px] border-line-strong">
                      <SelectValue placeholder={scope === "GENERIC" || scope === "CUSTOMER" ? "Deferred" : "Pick artwork"} />
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
        </DecisionCard>

        <DecisionCard
          step={3}
          done={routeSelectionReady}
          title="Build up to"
          hint="tap where the route stops"
          aside={
            <span className={cn("text-[12px] font-medium", validation?.valid ? "text-success-fg" : "text-warning-fg")}>
              {validation?.valid ? "stop rule valid" : "stop rule check needed"}
            </span>
          }
        >
          <div className="grid grid-cols-2 gap-2">
            <ChoiceCard
              selected={isFullRoute && !fullRouteBlocked}
              disabled={fullRouteBlocked}
              title="Finished stock"
              sub={
                fullRouteBlocked
                  ? "needs an artwork commitment"
                  : `stop at ${(steps.find((s) => s.index === routeLast)?.label || "last step").toLowerCase()}`
              }
              icon={<PackageCheck />}
              onClick={() => {
                if (!fullRouteBlocked) setStopStep(routeLast);
              }}
            />
            <ChoiceCard
              selected={!isFullRoute}
              title="WIP pool"
              sub={`stop at ${(steps.find((s) => s.index === stopBeforeArtwork)?.label || "selected step").toLowerCase()}`}
              icon={<Zap />}
              onClick={() => {
                setStartStep(routeFirst);
                setStopStep(stopBeforeArtwork);
              }}
            />
          </div>
          <RouteStopList
            steps={steps}
            startIndex={activeStartStep}
            stopIndex={activeStopStep}
            onSelectStop={setStopStep}
            onSelectStart={setStartStep}
          />
          <p className="text-[12px] leading-5 text-content-3">
            {isInHouseCatalogMaster
              ? "Manual Packaging/POD launch goes straight to production and uses this route as the production build plan."
              : scope === "GENERIC"
                ? "Generic and customer scopes must stop before the first artwork step."
                : scope.includes("ARTWORK")
                  ? "Artwork scopes must stop at or after the first artwork step."
                  : "Customer scope must stop before the artwork step."}
          </p>
          <div className="grid grid-cols-3 gap-2">
            <Mini label="Route start" value={routeStartLabel} subtle={`backend ${backendStartStep}`} />
            <Mini label="Route stop" value={routeStopLabel} subtle={`backend ${backendStopStep}`} />
            <Mini
              label="Launch kind"
              value={launchKindLabel}
              subtle={isInHouseCatalogMaster ? "catalog linked" : scope.replace("_", " + ")}
            />
          </div>
        </DecisionCard>
      </div>

      {/* ── Spec, quantity and the safety rail ───────────────── */}
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="grid min-w-0 gap-4">
          {master ? (
            <SpecPlate
              data={plateData}
              caption="Spec · from the product master"
              captionRight={
                <span className="text-plate-fg-3">{selectedSize ? `size ${selectedSize.code}` : "pick a size below"}</span>
              }
              facts={[
                { label: "Product size", value: `${selectedSize?.width_mm ?? 0} mm · ${selectedSize?.width_basis || "finished geometry"}` },
                {
                  label: isFullRoute ? "Final roll width" : "WIP roll width",
                  value: `${displayRollWidth || selectedSizeDefaultRollWidth || 0} mm · ${isFullRoute ? "from size row" : "operator confirmed"}`,
                },
                {
                  label: "Width match",
                  value: selectedSize?.slit_policy === "EXACT_ONLY" ? "Exact only" : "Same or wider",
                },
                {
                  label: "Stock form",
                  value: `${selectedSize?.stock_form || selectedSize?.roll_form || "Not set"} · ${selectedSize?.pouch_style_master_code || selectedSize?.pouch_style || "size formula"}`,
                },
              ]}
              testId="launcher-spec-plate"
            />
          ) : null}

          {master ? (
            <section className="rounded-[18px] border border-line bg-surface-1 shadow-[var(--shadow-sm)]">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line px-5 py-3.5">
                <StepDot state={sizeCode ? "done" : "todo"}>4</StepDot>
                <h2 className="text-[15.5px] font-semibold text-content-1">Size and layers</h2>
                <span className="text-[12.5px] text-content-3">size, stock form, layer stack and width math from the product master</span>
              </div>
              <div className="grid gap-5 p-5">
                <div className="grid gap-2">
                  <div className="text-[12px] font-semibold text-content-2">Size</div>
                  <div className="grid max-h-60 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3 2xl:grid-cols-4">
                    {sizes.map((s) => {
                      const active = s.code === sizeCode;
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => setSizeCode(s.code)}
                          className={cn(
                            "rounded-[13px] border px-3 py-2.5 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                            active
                              ? "border-primary bg-info-bg shadow-[inset_0_0_0_1px_hsl(var(--primary))]"
                              : "border-line-strong bg-surface-1 hover:border-info-border",
                          )}
                        >
                          <div className="font-mono text-[11px] text-content-3">{s.code}</div>
                          <div className={cn("text-[17px] font-semibold tabular-nums tracking-[-0.01em]", active ? "text-primary" : "text-content-1")}>
                            {s.width_mm} mm
                          </div>
                          <div className="truncate text-[12px] text-content-3">{s.label || s.stock_form || "size row"}</div>
                          <div className="mt-0.5 text-[12px] tabular-nums text-content-2">
                            roll {s.roll_width_mm || s.child_target_width_mm || s.width_mm || "-"} mm
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {wipMode ? (
                  <div className="grid gap-3 rounded-[14px] bg-surface-2 p-3.5 lg:grid-cols-[240px_minmax(0,1fr)]">
                    <Field label="Interim WIP roll width">
                      <div className="relative">
                        <Input
                          type="number"
                          min={1}
                          step={0.01}
                          value={wipRollWidthMm}
                          onChange={(event) =>
                            setWipRollWidthMm(event.target.value === "" ? "" : Number(event.target.value))
                          }
                          className="h-11 rounded-[11px] border-line-strong bg-surface-1 pr-12 text-[16px] font-semibold tabular-nums"
                        />
                        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-content-4">mm</span>
                      </div>
                    </Field>
                    <div className="grid gap-2">
                      <div className="text-[12px] font-semibold text-content-2">Product master roll options</div>
                      <div className="flex flex-wrap gap-2">
                        {wipRollWidthOptions.map((option) => (
                          <button
                            key={option}
                            type="button"
                            onClick={() => setWipRollWidthMm(option)}
                            className={cn(
                              "rounded-full px-3 py-1 text-[12.5px] font-medium tabular-nums transition",
                              Number(wipRollWidthMm || 0) === option
                                ? "bg-primary text-primary-foreground"
                                : "bg-surface-1 text-content-2 ring-1 ring-line hover:ring-info-border",
                            )}
                          >
                            {option} mm
                          </button>
                        ))}
                      </div>
                      <p className="text-[12px] leading-5 text-content-3">
                        This is the parked WIP roll width. Sales demand can resume from this pool when the required width is the same or lower and the size row allows slitting; too-narrow rolls are not shown in planner allocation.
                      </p>
                    </div>
                  </div>
                ) : null}

                <div className="grid gap-2">
                  <div className="text-[12px] font-semibold text-content-2">Per-layer axes</div>
                  <AxisLayerMatrix
                    layers={master.layer_template}
                    values={layerValues}
                    fallbackWidthMm={sizes.find((s) => s.code === sizeCode)?.roll_width_mm ?? undefined}
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

                <p className="flex items-start gap-2 text-[12px] leading-5 text-content-3">
                  <SlidersHorizontal className="mt-0.5 h-3.5 w-3.5 flex-none" />
                  Roll matching uses the physical form, child target width and slit policy from the size row. The size row decides whether the stock is open web, lay-flat tube or folded web.
                </p>
              </div>
            </section>
          ) : null}

          <section className="rounded-[18px] border border-line bg-surface-1 shadow-[var(--shadow-sm)]">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-line px-5 py-3.5">
              <StepDot state={quantity > 0 ? "done" : "todo"}>5</StepDot>
              <h2 className="text-[15.5px] font-semibold text-content-1">Quantity</h2>
              <span className="text-[12.5px] text-content-3">
                {wipMode
                  ? "interim WIP roll weight, not the final sales-order quantity"
                  : "only quantity and unit are your choice; the rest follows the master, stop and commitment"}
              </span>
            </div>
            <div className="grid gap-4 p-5">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3 sm:max-w-md">
                <Field label={wipMode ? "Target WIP roll weight" : "Target quantity"}>
                  <Input
                    type="number"
                    value={quantity}
                    onChange={(e) => setQuantity(Number(e.target.value))}
                    className="h-12 rounded-[13px] border-line-strong text-[22px] font-semibold tabular-nums tracking-[-0.02em]"
                  />
                </Field>
                <div className="inline-flex h-12 items-center rounded-[13px] border border-line-strong bg-surface-2 p-1" role="group" aria-label="UOM">
                  {(["KG", "PCS"] as const).map((unit) => (
                    <button
                      key={unit}
                      type="button"
                      onClick={() => setQtyUom(unit)}
                      aria-pressed={qtyUom === unit}
                      className={cn(
                        "h-10 rounded-[10px] px-4 text-[13px] font-semibold transition",
                        qtyUom === unit ? "bg-surface-1 text-content-1 shadow-[var(--shadow-sm)]" : "text-content-3",
                      )}
                    >
                      {unit.toLowerCase()}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
                <Mini label="Stock strategy" value={derivedStockStrategy} subtle={isFullRoute ? "full route" : "route stop"} />
                <Mini label="Planner class" value={derivedPlannerStockClass} subtle={masterKind} />
                <Mini label="Output type" value={derivedOutputType} subtle={catalogSkuLabel} />
                <Mini label="Stock owner" value="Internal" subtle="manual launcher" />
              </div>
              <p className="flex items-start gap-2 rounded-[12px] bg-info-bg px-3 py-2 text-[12.5px] leading-5 text-primary">
                <MapPin className="mt-0.5 h-3.5 w-3.5 flex-none" />
                Manual launches from this page create the production order directly. Low-stock auto demand can still flow to planner demand review, but this manual path is an explicit production release.
              </p>
            </div>
          </section>
        </div>

        <aside className="grid gap-4 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pb-4">
          {allIssues.length ? (
            <SideCard title="Launch blockers" hint="fix these before creating stock" tone="warn">
              <IssueList title="Release blockers" issues={allIssues} />
            </SideCard>
          ) : (
            <SideCard title="Blockers" hint="nothing stops this launch" tone="ok" />
          )}

          {requiredMaterial ? (
            <SideCard title="Primary required material" hint="to launch this stock pool">
              <div className="grid gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="rounded-md bg-surface-2 px-2 py-0.5 font-mono text-[12px] text-content-2">{requiredMaterial.code}</span>
                  <span className="truncate text-[13px] font-medium text-content-1">{requiredMaterial.name}</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <Mini label="Grade" value={requiredMaterial.grade || "GP"} />
                  <Mini label="Thickness" value={`${requiredMaterial.thickness_micron ?? 0} μ`} />
                  <Mini label="Width" value={`${requiredMaterial.width_mm ?? 0} mm`} />
                </div>
                <div className="flex items-center justify-between text-[12.5px]">
                  <span className="text-content-3">Target qty</span>
                  <span className="font-semibold tabular-nums text-content-1">
                    {requiredMaterial.target_qty} {requiredMaterial.uom}
                  </span>
                </div>
              </div>
            </SideCard>
          ) : null}

          <SideCard title="Matching demand" hint="open sales lines that can pull from this pool">
            {demandComputed ? (
              <div className="grid grid-cols-2 gap-2">
                <Mini label="Eligible orders" value={`${demand?.eligible_orders ?? 0}`} subtle="Can match" />
                <Mini label="Exact width" value={`${demand?.exact_match ?? 0}`} subtle="same stock form" />
                <Mini label="Slit allowed" value={`${demand?.widening_allowed ?? 0}`} subtle="policy fallback" />
                <Mini label="Wrong lock" value={`${demand?.wrong_artwork ?? 0}`} subtle="blocked" />
              </div>
            ) : (
              <p className="text-[12.5px] leading-5 text-content-3">
                Demand matching is not computed by the backend for this validation response yet. No fake order counts are shown here; the order will still create/release using live BOM, route and stock-form validation.
              </p>
            )}
          </SideCard>

          <SideCard title="Commitment safety" hint="what this pool will and won't match">
            <div className="grid gap-2">
              <SafetyRow
                label="Customer lock"
                value={validation?.commitment_safety?.customer_lock || (committedCustomer ? "Pending" : "None")}
                note={committedCustomer ? "Locked to picked customer." : "Generic stock has no customer lock."}
              />
              <SafetyRow
                label="Artwork lock"
                value={validation?.commitment_safety?.artwork_lock || (committedArtwork ? "Pending" : "None")}
                note={committedArtwork ? "Locked to picked artwork." : "No artwork commitment applied."}
              />
              <SafetyRow
                label="Match window"
                value={validation?.commitment_safety?.match_window || "Before print only"}
                note={
                  scope.includes("ARTWORK")
                    ? "After artwork step — must match same artwork."
                    : "Can match any demand before the artwork step."
                }
              />
            </div>
          </SideCard>

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
        </aside>
      </div>

      <ValidationFooter
        checks={checks}
        autosaveLabel={firstBlocker ? `Blocked: ${firstBlocker}` : "Ready for direct production release"}
        secondaryActions={
          <div className="hidden max-w-[560px] flex-wrap items-center gap-1.5 md:flex">
            <Pill tone={master ? "blue" : "amber"}>{master?.code || "No master"}</Pill>
            <Pill tone="slate">{isFullRoute ? "Full route" : `Stop ${routeStopLabel}`}</Pill>
            <Pill tone="slate">
              {wipMode ? `${displayRollWidth || 0} mm WIP` : `${displayRollWidth || 0} mm`}
            </Pill>
            <Pill tone="slate">
              {quantity.toLocaleString()} {qtyUom}
            </Pill>
            {firstBlocker ? <Pill tone="amber">Blocker live</Pill> : <Pill tone="emerald">No blockers</Pill>}
          </div>
        }
        primaryActions={
          <>
            <Button variant="outline" onClick={() => validate.refetch()} className="h-10 rounded-[11px]">
              <CheckCircle2 className="mr-1.5 h-4 w-4" />
              Validate pool
            </Button>
            <Button disabled={createDisabled} onClick={() => createMutation.mutate()} className="h-10 gap-1.5 rounded-[11px] px-5">
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />}
              {launchTitle}
            </Button>
          </>
        }
      />
    </div>
  );
}

function DecisionCard({
  step,
  done,
  title,
  hint,
  aside,
  children,
}: {
  step: number;
  done: boolean;
  title: string;
  hint?: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex min-w-0 flex-col rounded-[18px] border border-line bg-surface-1 shadow-[var(--shadow-sm)]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 pb-2 pt-4">
        <StepDot state={done ? "done" : "todo"}>{step}</StepDot>
        <h2 className="text-[15.5px] font-semibold text-content-1">{title}</h2>
        {hint ? <span className="text-[12.5px] text-content-3">{hint}</span> : null}
        {aside ? <span className="ml-auto">{aside}</span> : null}
      </div>
      <div className="grid gap-3 px-5 pb-5 pt-1">{children}</div>
    </section>
  );
}

function SideCard({
  title,
  hint,
  tone = "plain",
  children,
}: {
  title: string;
  hint?: string;
  tone?: "plain" | "ok" | "warn";
  children?: React.ReactNode;
}) {
  return (
    <section className="rounded-[18px] border border-line bg-surface-1 p-4 shadow-[var(--shadow-sm)]">
      <div className="grid grid-cols-[8px_minmax(0,1fr)] items-baseline gap-x-2">
        <span
          aria-hidden
          className={cn(
            "h-2 w-2 rounded-full",
            tone === "ok" ? "bg-success-fg" : tone === "warn" ? "bg-warning-fg" : "bg-line-strong",
          )}
        />
        <h3 className="text-[14px] font-semibold text-content-1">{title}</h3>
        {hint ? <span className="col-start-2 text-[12px] leading-snug text-content-3">{hint}</span> : null}
      </div>
      {children ? <div className="mt-3">{children}</div> : null}
    </section>
  );
}

/** The route as a vertical list: tap a step to stop there, or set where the run starts. */
function RouteStopList({
  steps,
  startIndex,
  stopIndex,
  onSelectStop,
  onSelectStart,
}: {
  steps: Array<{ index: number; label: string; transition?: string; artwork_step?: boolean; branchKey?: string }>;
  startIndex: number;
  stopIndex: number;
  onSelectStop: (index: number) => void;
  onSelectStart: (index: number) => void;
}) {
  const stages = React.useMemo(() => {
    const grouped = new Map<number, typeof steps>();
    for (const step of steps) {
      if (!grouped.has(step.index)) grouped.set(step.index, []);
      grouped.get(step.index)!.push(step);
    }
    return Array.from(grouped.entries()).sort(([a], [b]) => a - b);
  }, [steps]);
  if (!stages.length) {
    return (
      <div className="rounded-[12px] bg-surface-2 px-3 py-3 text-[12.5px] text-content-3">
        Pick a product master to see its route.
      </div>
    );
  }
  return (
    <ol className="grid" aria-label="Route steps">
      {stages.map(([index, stageSteps], i) => {
        const isStop = index === stopIndex;
        const isStart = index === startIndex;
        const inRun = index >= startIndex && index < stopIndex;
        const off = index > stopIndex || index < startIndex;
        const last = i === stages.length - 1;
        return (
          <li key={index} className="relative">
            {!last ? (
              <span
                aria-hidden
                className={cn("absolute bottom-[-6px] left-[17px] top-[30px] w-0.5", inRun ? "bg-primary" : "bg-line")}
              />
            ) : null}
            <div
              className={cn(
                "group grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-3 rounded-[12px] px-1.5 py-2 transition",
                isStop ? "bg-info-bg" : "hover:bg-surface-2",
              )}
            >
              <button
                type="button"
                onClick={() => onSelectStop(index)}
                aria-label={`Stop at stage ${index}`}
                className={cn(
                  "relative z-[1] grid h-6 w-6 place-items-center rounded-full border-2 text-[10.5px] font-semibold",
                  isStop
                    ? "border-primary bg-surface-1 text-primary"
                    : inRun
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-line-strong bg-surface-1 text-content-3",
                )}
              >
                {index}
              </button>
              <button type="button" onClick={() => onSelectStop(index)} className="min-w-0 text-left">
                {stageSteps.map((step) => (
                  <span key={`${step.index}-${step.branchKey || "MAIN"}-${step.label}`} className="block">
                    <span className={cn("block truncate text-[13.5px] font-medium", off ? "text-content-4" : "text-content-1")}>
                      {step.label}
                      {step.artwork_step ? <span className="ml-1.5 rounded-full bg-surface-2 px-1.5 py-0.5 text-[10.5px] font-semibold text-content-3">art</span> : null}
                    </span>
                    {step.transition && step.transition !== "—" ? (
                      <span className="block truncate text-[11.5px] text-content-3">{step.transition.replace(/_/g, " ").toLowerCase()}</span>
                    ) : null}
                  </span>
                ))}
              </button>
              <span className="flex items-center gap-1.5">
                {isStart ? (
                  <span className="text-[11.5px] font-medium text-success-fg">start</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onSelectStart(index)}
                    className="rounded-md px-1.5 py-0.5 text-[11.5px] text-content-3 opacity-0 transition hover:bg-surface-1 hover:text-content-1 focus:opacity-100 group-hover:opacity-100"
                  >
                    start here
                  </button>
                )}
                {isStop ? <span className="text-[11.5px] font-semibold text-primary">stop</span> : null}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
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
        <div className="mt-2 rounded-xl border border-warning-border bg-warning-bg px-3 py-2 text-caption font-semibold leading-5 text-warning-fg">
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
        <div className="mt-2 rounded-xl border border-order-border bg-order-bg px-3 py-2 text-caption font-semibold leading-5 text-order-fg">
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
      <div className="text-[12px] font-semibold text-content-3">
        Catalog SKU link
      </div>
      <div className="mt-1 text-sm font-bold text-content-2">
        Not required for this Product Master
      </div>
      <div className="text-caption font-semibold text-content-3">
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
    <div className={cn("grid gap-1.5", className)}>
      <Label className="text-[12px] font-semibold text-content-2">{label}</Label>
      <div>{children}</div>
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
    blue: "bg-info-bg text-primary",
    violet: "bg-surface-2 text-content-2",
    fuchsia: "bg-surface-2 text-content-2",
    amber: "bg-warning-bg text-warning-fg",
    emerald: "bg-success-bg text-success-fg",
    slate: "bg-surface-2 text-content-2",
  };
  return (
    <span
      className={cn(
        "inline-flex h-6 max-w-full items-center truncate rounded-full px-2.5 text-[12px] font-medium",
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
    <div className="grid gap-1.5" aria-label={title}>
      {issues.map((issue) => (
        <div key={issue} className="flex items-start gap-2 text-[13px] leading-snug text-content-1">
          <span className="mt-[2px] grid h-[16px] w-[16px] flex-none place-items-center rounded-full bg-warning-bg text-[10px] font-bold text-warning-fg">!</span>
          <span className="min-w-0">{issue}</span>
        </div>
      ))}
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
    <div className="min-w-0 rounded-[11px] bg-surface-2 px-3 py-2">
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-content-3">
        {label}
      </div>
      <div className="break-words text-[13.5px] font-semibold leading-snug text-content-1">{value}</div>
      {subtle ? (
        <div className="break-words text-[11.5px] text-content-3">{subtle}</div>
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
    <div className="flex items-start justify-between gap-3 rounded-[11px] bg-surface-2 px-3 py-2.5">
      <div className="min-w-0">
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-content-3">
          {label}
        </div>
        <div className="text-[13.5px] font-semibold text-content-1">{value}</div>
      </div>
      <span className="max-w-[150px] text-right text-[12px] leading-snug text-content-3">
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

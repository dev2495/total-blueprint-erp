"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Boxes,
  Layers,
  Loader2,
  Package,
  Palette,
  PackageCheck,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { RouteTimeline } from "@/components/erp/route-timeline";
import { templateService } from "@/services/templates";
import {
  productMasterService,
  type LayerTemplateRow,
  type ProductKind,
  type ProductMaster,
  type ReportingGroup,
  type VariantAxisDef,
} from "@/services/product-master";
interface ProductMasterCreateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (master: ProductMaster) => void;
}

const KIND_CARDS: Array<{
  id: ProductKind;
  label: string;
  icon: React.ReactNode;
  summary: string;
  accent: string;
}> = [
  {
    id: "POUCH",
    label: "Finished pouch",
    icon: <Package className="h-4 w-4" />,
    summary: "Standup, pillow, or shaped pouches with multi-layer film.",
    accent: "border-info-border bg-info-bg text-primary",
  },
  {
    id: "ROLL",
    label: "Roll / film",
    icon: <Layers className="h-4 w-4" />,
    summary: "Sellable or intermediate film roll. Width / thickness vary.",
    accent: "border-success-border bg-success-bg text-success-fg",
  },
  {
    id: "PACKAGING",
    label: "Packaging",
    icon: <Boxes className="h-4 w-4" />,
    summary: "Bags, gunny, sleeves consumed in BOM, in-house or purchased.",
    accent: "border-warning-border bg-warning-bg text-warning-fg",
  },
  {
    id: "POD",
    label: "POD",
    icon: <PackageCheck className="h-4 w-4" />,
    summary: "Print-on-demand inventory referenced from sales BOM.",
    accent: "border-order-border bg-order-bg text-order-fg",
  },
  {
    id: "OTHER",
    label: "Other",
    icon: <Palette className="h-4 w-4" />,
    summary: "Specialty / one-off categories.",
    accent: "border-order-border bg-order-bg text-order-fg",
  },
];

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

const DEFAULT_VARIANT_AXES: VariantAxisDef[] = [
  { axis: "size", type: "geometry", required: true, label: "Size / geometry" },
  {
    axis: "layer_thicknesses",
    type: "per_layer_number",
    required: true,
    label: "Thickness per layer",
  },
  {
    axis: "layer_grades",
    type: "per_layer_enum",
    required: false,
    label: "Grade per layer",
  },
  {
    axis: "layer_widths",
    type: "per_layer_number",
    required: false,
    label: "Layer roll width override",
  },
];

function blankLayer(index: number): LayerTemplateRow {
  return {
    role: `layer-${index + 1}`,
    film_variant_code: "",
    thickness_micron: 0,
    default_grade: "",
    grade_options: [],
    setup_pending: true,
    thickness_apportion: "per_layer",
    default_input_roll_width_mm: null,
  } as LayerTemplateRow;
}

export function ProductMasterCreateModal({
  open,
  onOpenChange,
  onCreated,
}: ProductMasterCreateModalProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [code, setCode] = React.useState("");
  const [name, setName] = React.useState("");
  const [kind, setKind] = React.useState<ProductKind>("POUCH");
  const [reportingGroup, setReportingGroup] =
    React.useState<ReportingGroup>("FG");
  const [templateId, setTemplateId] = React.useState<string>("");
  const [description, setDescription] = React.useState("");
  const [layerCount, setLayerCount] = React.useState(2);

  React.useEffect(() => {
    if (!open) return;
    setCode("");
    setName("");
    setKind("POUCH");
    setReportingGroup("FG");
    setTemplateId("");
    setDescription("");
    setLayerCount(2);
  }, [open]);

  // Auto-suggest reporting group based on kind.
  React.useEffect(() => {
    if (kind === "POD") setReportingGroup("POD");
    else if (kind === "PACKAGING") setReportingGroup("PACKAGING");
    else if (kind === "ROLL") setReportingGroup("FILM");
    else if (kind === "POUCH") setReportingGroup("FG");
  }, [kind]);

  const templateKind = kind === "POUCH" || kind === "ROLL" ? kind : undefined;
  const { data: templates = [] } = useQuery({
    queryKey: [
      "product-master-create-templates",
      "live",
      templateKind || "any",
    ],
    queryFn: () =>
      templateService.getLiveTemplateOptions(
        templateKind ? { fg_type: templateKind } : undefined,
      ),
    enabled: open,
    staleTime: 5 * 60_000,
    refetchOnMount: "always",
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 5000),
    meta: { suppressGlobalError: true },
  });
  const { data: routeSteps = [], isFetching: routePreviewLoading } = useQuery({
    queryKey: ["product-master-create-route-steps", templateId],
    queryFn: () => templateService.getRouteSteps(templateId),
    enabled: open && !!templateId,
    staleTime: 60_000,
  });

  const normalizedLayers = React.useMemo(
    () =>
      Array.from({ length: Math.max(1, layerCount) }, (_, index) => ({
        ...blankLayer(index),
        role: `layer-${index + 1}`,
        setup_pending: true,
      })),
    [layerCount],
  );

  const createMutation = useMutation({
    mutationFn: () =>
      productMasterService.create({
        code,
        name,
        product_kind: kind,
        default_reporting_group: reportingGroup,
        template: templateId,
        default_template: templateId,
        template_name:
          templates.find((t: any) => t.id === templateId)?.name ?? null,
        layer_template: normalizedLayers,
        canonical_layer_stack: normalizedLayers,
        variant_axes: DEFAULT_VARIANT_AXES,
        fixed_attributes: {
          fg_type: kind === "ROLL" ? "ROLL" : kind === "POUCH" ? "POUCH" : kind,
          trim_loss_mm: 10,
          trim_apply_to: "WIDTH",
          gusset_apply_to: "HEIGHT",
          gusset_factor: 1,
          default_pouch_style: "STAND_UP",
          print_capable: false,
          artwork_required: false,
          layer_count: Math.max(1, layerCount),
          layer_setup_pending: true,
        },
        active: false,
        description,
      }),
    onSuccess: async (master) => {
      queryClient.setQueryData(["product-master", master.id], master);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["product-masters"] }),
        queryClient.invalidateQueries({
          queryKey: ["product-master", master.id],
        }),
      ]);
      toast({
        title: "Product master created",
        description: `${master.name} is ready to configure.`,
      });
      onCreated?.(master);
      onOpenChange(false);
      router.push(`/master/products/${master.id}/edit`);
      router.refresh();
    },
    onError: (err: any) => {
      toast({
        title: "Could not create",
        description: err?.message || "Try again",
        variant: "destructive",
      });
    },
  });

  const valid =
    code.trim().length > 0 &&
    name.trim().length > 0 &&
    !!templateId &&
    layerCount > 0;
  const routeTimelineSteps = React.useMemo(
    () =>
      routeSteps.map((step) => ({
        index: step.index || (step as any).sequence_number || 1,
        label:
          step.name ||
          step.label ||
          step.process_code ||
          `Step ${step.index || 1}`,
        transition:
          (step as any).transition ||
          `${step.input_form || ""}${step.input_form || step.output_form ? " → " : ""}${step.output_form || ""}`,
        tag: step.roll_behavior || (step as any).process_roll_behavior,
        artwork_step: Boolean(
          (step as any).has_artwork || (step as any).artwork_step,
        ),
        routeNodeId: (step as any).route_node_id,
        branchKey: (step as any).branch_key,
        joinKey: (step as any).join_key,
        parallelGroup: (step as any).parallel_group,
        predecessorNodeIds: (step as any).predecessor_node_ids,
        successorNodeIds: (step as any).successor_node_ids,
        isJoin: Boolean((step as any).is_join),
        isParallelStart: Boolean((step as any).is_parallel_start),
      })),
    [routeSteps],
  );

  const handleSubmit = () => {
    if (!valid) return;
    createMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-1rem)] max-w-3xl flex-col gap-0 overflow-hidden rounded-3xl border-none p-0 shadow-2xl sm:max-h-[calc(100dvh-2rem)]">
        <div className="shrink-0 bg-gradient-to-br from-primary via-order-fg to-order-fg px-6 py-5 text-white">
          <DialogHeader className="space-y-1 border-none pb-0">
            <div className="text-[10px] font-black uppercase tracking-[0.28em] text-white/70">
              Master · Product
            </div>
            <DialogTitle className="font-display text-2xl font-bold leading-tight text-white">
              New Product Master
            </DialogTitle>
            <DialogDescription className="text-white/80">
              Capture only the stable starting contract: identity, live route,
              and layer count. Film, grade, thickness, sizes, add-ons, POD,
              packing, artwork, and overlays continue in the workspace.
            </DialogDescription>
          </DialogHeader>
        </div>
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-6">
          <div className="space-y-2">
            <Label className="text-[10px] font-black uppercase tracking-[0.22em] text-content-3">
              Product kind
            </Label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {KIND_CARDS.map((k) => {
                const isActive = k.id === kind;
                return (
                  <button
                    key={k.id}
                    type="button"
                    onClick={() => setKind(k.id)}
                    className={cn(
                      "flex items-start gap-2 rounded-xl border px-3 py-2.5 text-left shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-info-border",
                      isActive
                        ? "border-primary bg-gradient-to-br from-info-bg to-surface-1 ring-2 ring-info-border "
                        : "border-line bg-surface-1 hover:border-info-border hover:shadow-md",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-md ring-1 ring-inset",
                        isActive
                          ? "bg-primary text-white ring-primary shadow-sm "
                          : k.accent,
                      )}
                    >
                      {k.icon}
                    </span>
                    <div>
                      <div className="text-sm font-bold text-content-1">
                        {k.label}
                      </div>
                      <div className="text-[11px] leading-4 text-content-3">
                        {k.summary}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Per-kind info banner — sets correct expectations after kind selection */}
            {kind === "POD" && (
              <div className="mt-3 flex items-start gap-2 rounded-xl border border-order-border bg-order-bg px-3 py-2.5 text-xs text-order-fg ring-1 ring-order-border">
                <PackageCheck className="mt-0.5 h-3.5 w-3.5 flex-none text-order-fg" />
                <div>
                  <div className="font-bold text-order-fg">
                    POD recipe — manual fixed-SKU link
                  </div>
                  <div className="text-order-fg">
                    Define axes (width, thickness, grade) once. Create the POD
                    variant here, then manually link it to an existing fixed POD
                    roll SKU in{" "}
                    <span className="font-mono font-bold">/master/pod</span>.
                  </div>
                </div>
              </div>
            )}
            {kind === "PACKAGING" && (
              <div className="mt-3 flex items-start gap-2 rounded-xl border border-warning-border bg-warning-bg px-3 py-2.5 text-xs text-warning-fg ring-1 ring-warning-border">
                <Boxes className="mt-0.5 h-3.5 w-3.5 flex-none text-warning-fg" />
                <div>
                  <div className="font-bold text-warning-fg">
                    Packaging recipe — manual fixed-SKU link
                  </div>
                  <div className="text-warning-fg">
                    Define axes (capacity, thickness, grade). Create the
                    packaging variant here, then manually link it to an existing
                    fixed packaging SKU in{" "}
                    <span className="font-mono font-bold">
                      /master/packaging
                    </span>
                    .
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label className="text-[10px] font-black uppercase tracking-[0.22em] text-content-3">
                Master code
              </Label>
              <Input
                placeholder="e.g. PM-DRY-PET-LD"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                className="mt-1 h-10 rounded-xl"
              />
            </div>
            <div>
              <Label className="text-[10px] font-black uppercase tracking-[0.22em] text-content-3">
                Reporting group
              </Label>
              <Select
                value={reportingGroup}
                onValueChange={(v) => setReportingGroup(v as ReportingGroup)}
              >
                <SelectTrigger className="mt-1 h-10 rounded-xl">
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
            </div>
            <div className="sm:col-span-2">
              <Label className="text-[10px] font-black uppercase tracking-[0.22em] text-content-3">
                Master name
              </Label>
              <Input
                placeholder="e.g. Dry Fruit Standup Pouch — PET/LD food-grade"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="mt-1 h-10 rounded-xl"
              />
            </div>
            <div className="sm:col-span-2">
              <Label className="text-[10px] font-black uppercase tracking-[0.22em] text-content-3">
                Live route / template
              </Label>
              <Select
                value={templateId}
                onValueChange={(v) => setTemplateId(v)}
              >
                <SelectTrigger className="mt-1 h-10 rounded-xl">
                  <SelectValue placeholder="Required: pick the route template this master will use" />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t: any) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name || t.code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!templateId && (
                <div className="mt-1 text-[11px] font-semibold text-warning-fg">
                  Required. Sales/planner BOM and WCM steps come from this
                  template.
                </div>
              )}
              <div className="mt-3">
                {templateId && routePreviewLoading ? (
                  <div className="flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-4 py-3 text-xs font-semibold text-content-3">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading route preview...
                  </div>
                ) : templateId && routeTimelineSteps.length ? (
                  <RouteTimeline
                    steps={routeTimelineSteps}
                    helperText="This is the live route that sales, planner, WCM, and BOM preview will use after create."
                  />
                ) : templateId ? (
                  <div className="flex items-start gap-2 rounded-xl border border-warning-border bg-warning-bg px-4 py-3 text-xs font-semibold text-warning-fg">
                    <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
                    Template is selected but has no route steps yet. You can
                    still create the master, but planner/WCM will need the
                    template route fixed before go-live use.
                  </div>
                ) : null}
              </div>
            </div>
            <div className="space-y-3 rounded-2xl border border-info-border bg-info-bg p-3 sm:col-span-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <Label className="text-[10px] font-black uppercase tracking-[0.22em] text-primary">
                    Number of layers
                  </Label>
                  <div className="mt-0.5 text-[11px] text-primary">
                    This creates blank layer slots only. The edit workspace
                    selects the real film, allowed grades, thickness options,
                    and layer axes.
                  </div>
                </div>
                <span className="rounded-full bg-surface-1 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-primary ring-1 ring-info-border">
                  workspace setup
                </span>
              </div>
              <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-info-border bg-surface-1 p-3 shadow-sm">
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 w-10 rounded-xl p-0"
                  disabled={layerCount <= 1}
                  onClick={() => setLayerCount((n) => Math.max(1, n - 1))}
                >
                  -
                </Button>
                <div className="text-center">
                  <div className="font-display text-3xl font-black text-content-1">
                    {layerCount}
                  </div>
                  <div className="text-[11px] font-semibold text-content-3">
                    layer slot{layerCount === 1 ? "" : "s"} opened in edit
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 w-10 rounded-xl p-0"
                  onClick={() => setLayerCount((n) => Math.min(9, n + 1))}
                >
                  +
                </Button>
              </div>
              <div className="rounded-xl border border-warning-border bg-warning-bg px-3 py-2 text-[11px] font-semibold text-warning-fg">
                New masters stay inactive until the layer materials and
                required axes are configured. Sales and planner only see active
                active masters.
              </div>
            </div>
            <div className="sm:col-span-2">
              <Label className="text-[10px] font-black uppercase tracking-[0.22em] text-content-3">
                Description (optional)
              </Label>
              <Textarea
                placeholder="What this master covers, special constraints, notes for sales/planner."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="mt-1 min-h-[64px] rounded-xl"
              />
            </div>
            <div className="flex items-center justify-between rounded-xl border border-warning-border bg-warning-bg px-3 py-2 sm:col-span-2">
              <div>
                <div className="text-sm font-bold text-warning-fg">
                  Created inactive until configured
                </div>
                <div className="text-[11px] text-warning-fg">
                  Activate from the edit workspace after films, axes, sizes and
                  policies pass validation.
                </div>
              </div>
              <span className="rounded-full bg-surface-1 px-3 py-1 text-[10px] font-black uppercase tracking-[0.18em] text-warning-fg ring-1 ring-warning-border">
                hidden
              </span>
            </div>
          </div>
        </div>
        <DialogFooter className="shrink-0 border-t border-line bg-surface-2 px-6 py-4">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="rounded-xl"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!valid || createMutation.isPending}
            className="gap-1.5 rounded-xl bg-gradient-to-r from-primary to-order-fg shadow-lg hover:shadow-xl hover:"
          >
            {createMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : null}
            Create & open workspace
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

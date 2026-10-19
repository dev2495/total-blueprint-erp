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
import { ChoiceCard, StepSection } from "@/components/plate/steps";
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

  const LABEL_CLS = "text-[12px] font-semibold text-content-2";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-1rem)] max-w-3xl flex-col gap-0 overflow-hidden rounded-[20px] border border-line p-0 shadow-[var(--shadow-lg)] sm:max-h-[calc(100dvh-2rem)]">
        <div className="shrink-0 border-b border-line px-6 pb-4 pt-5">
          <DialogHeader className="space-y-1 border-none pb-0 text-left">
            <div className="text-[12.5px] text-content-3">
              Products · New product master
            </div>
            <DialogTitle className="text-[22px] font-semibold leading-tight tracking-[-0.02em] text-content-1">
              New Product Master
            </DialogTitle>
            <DialogDescription className="text-[13px] text-content-3">
              Start with what it is and the route it runs on. Films, grades, thickness, sizes, add-ons, packing and artwork open in the workspace right after.
            </DialogDescription>
          </DialogHeader>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-1">
          <StepSection step={1} state={kind ? "done" : "todo"} title="Product kind" hint="what this master produces">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {KIND_CARDS.map((k) => (
                <ChoiceCard
                  key={k.id}
                  selected={k.id === kind}
                  title={k.label}
                  sub={k.summary}
                  icon={k.icon}
                  onClick={() => setKind(k.id)}
                />
              ))}
            </div>
            {kind === "POD" && (
              <div className="flex items-start gap-2 rounded-[12px] bg-surface-2 px-3 py-2.5 text-[12.5px] text-content-2">
                <PackageCheck className="mt-0.5 h-3.5 w-3.5 flex-none text-content-3" />
                <div>
                  <span className="font-semibold text-content-1">POD recipe, manual fixed-SKU link.</span>{" "}
                  Define axes (width, thickness, grade) once. Create the POD variant here, then link it to an existing fixed POD roll SKU in{" "}
                  <span className="font-mono">/master/pod</span>.
                </div>
              </div>
            )}
            {kind === "PACKAGING" && (
              <div className="flex items-start gap-2 rounded-[12px] bg-surface-2 px-3 py-2.5 text-[12.5px] text-content-2">
                <Boxes className="mt-0.5 h-3.5 w-3.5 flex-none text-content-3" />
                <div>
                  <span className="font-semibold text-content-1">Packaging recipe, manual fixed-SKU link.</span>{" "}
                  Define axes (capacity, thickness, grade). Create the packaging variant here, then link it to an existing fixed packaging SKU in{" "}
                  <span className="font-mono">/master/packaging</span>.
                </div>
              </div>
            )}
          </StepSection>

          <StepSection
            step={2}
            state={code.trim() && name.trim() ? "done" : "todo"}
            title="Name and code"
            hint="what sales and the planner see"
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label className={LABEL_CLS}>Master code</Label>
                <Input
                  placeholder="e.g. PM-DRY-PET-LD"
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  className="h-10 rounded-[11px] font-mono"
                />
              </div>
              <div className="grid gap-1.5">
                <Label className={LABEL_CLS}>Reporting group</Label>
                <Select
                  value={reportingGroup}
                  onValueChange={(v) => setReportingGroup(v as ReportingGroup)}
                >
                  <SelectTrigger className="h-10 rounded-[11px]">
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
              <div className="grid gap-1.5 sm:col-span-2">
                <Label className={LABEL_CLS}>Master name</Label>
                <Input
                  placeholder="e.g. Dry Fruit Standup Pouch — PET/LD food-grade"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-11 rounded-[11px] text-[15px] font-medium"
                />
              </div>
            </div>
          </StepSection>

          <StepSection
            step={3}
            state={templateId ? "done" : "todo"}
            title="Live route"
            hint="sales, planner, floor and the BOM follow this template"
          >
            <Select value={templateId} onValueChange={(v) => setTemplateId(v)}>
              <SelectTrigger className="h-10 rounded-[11px]">
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
            {!templateId ? (
              <div className="text-[12.5px] text-warning-fg">
                Required. Sales/planner BOM and WCM steps come from this template.
              </div>
            ) : null}
            {templateId && routePreviewLoading ? (
              <div className="flex items-center gap-2 rounded-[12px] bg-surface-2 px-4 py-3 text-[12.5px] text-content-3">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading route preview...
              </div>
            ) : templateId && routeTimelineSteps.length ? (
              <RouteTimeline
                steps={routeTimelineSteps}
                helperText="This is the live route that sales, planner, WCM, and BOM preview will use after create."
              />
            ) : templateId ? (
              <div className="flex items-start gap-2 rounded-[12px] bg-warning-bg px-4 py-3 text-[12.5px] text-warning-fg">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" />
                Template is selected but has no route steps yet. You can still create the master, but planner/WCM will need the template route fixed before go-live use.
              </div>
            ) : null}
          </StepSection>

          <StepSection
            step={4}
            state="done"
            title="Number of layers"
            hint="blank slots now; films, grades and microns are set in the workspace"
          >
            <div className="flex items-center gap-4">
              <Button
                type="button"
                variant="outline"
                className="h-11 w-11 rounded-[12px] p-0 text-lg"
                disabled={layerCount <= 1}
                onClick={() => setLayerCount((n) => Math.max(1, n - 1))}
                aria-label="One layer fewer"
              >
                -
              </Button>
              <div className="min-w-[96px] text-center">
                <div className="text-[34px] font-semibold leading-none tabular-nums tracking-[-0.03em] text-content-1">
                  {layerCount}
                </div>
                <div className="mt-1 text-[12px] text-content-3">
                  layer slot{layerCount === 1 ? "" : "s"}
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                className="h-11 w-11 rounded-[12px] p-0 text-lg"
                onClick={() => setLayerCount((n) => Math.min(9, n + 1))}
                aria-label="One layer more"
              >
                +
              </Button>
              <div className="ml-2 flex min-w-0 flex-1 items-center gap-1" aria-hidden>
                {Array.from({ length: layerCount }).map((_, i) => (
                  <span key={i} className="h-8 flex-1 rounded-md bg-surface-2 ring-1 ring-line" />
                ))}
              </div>
            </div>
          </StepSection>

          <StepSection step={5} state="idle" title="Description" hint="optional" last>
            <Textarea
              placeholder="What this master covers, special constraints, notes for sales/planner."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="min-h-[64px] rounded-[11px]"
            />
            <div className="rounded-[12px] bg-surface-2 px-3 py-2.5 text-[12.5px] text-content-3">
              <span className="font-semibold text-content-2">Created inactive until configured.</span>{" "}
              Sales and the planner only see active masters. Activate from the workspace after films, axes, sizes and policies pass validation.
            </div>
          </StepSection>
        </div>
        <DialogFooter className="shrink-0 border-t border-line px-6 py-4">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="h-10 rounded-[11px]"
          >
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!valid || createMutation.isPending}
            className="h-10 gap-1.5 rounded-[11px] px-5"
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

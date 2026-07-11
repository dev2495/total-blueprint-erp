"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Copy,
  Layers,
  Loader2,
  Plus,
  Route,
  ShieldCheck,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { masterDataService, type Material } from "@/services/master-data";
import {
  productMasterService,
  type LayerTemplateRow,
  type ProductMaster,
  type ProductMasterClonePayload,
} from "@/services/product-master";
import { templateService } from "@/services/templates";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: ProductMaster | null;
}

function versionRoot(code?: string | null) {
  const root = String(code || "")
    .trim()
    .toUpperCase();
  const match = root.match(/^(.*)-V\d+$/);
  return match?.[1] || root;
}

function defaultCloneCode(source: ProductMaster | null) {
  if (!source?.code) return "";
  return `${versionRoot(source.code)}-COPY`;
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

function cloneLayers(source: ProductMaster | null): LayerTemplateRow[] {
  const rows = Array.isArray(source?.layer_template)
    ? source!.layer_template
    : [];
  return rows.map((row, index) => normalizeLayerRow(row, index));
}

function cleanLayers(rows: LayerTemplateRow[]) {
  return rows
    .map((row, index) => ({
      ...row,
      role: String(row.role || `layer-${index + 1}`).trim(),
      film_variant_code: String(row.film_variant_code || "")
        .trim()
        .toUpperCase(),
      thickness_micron: Number(row.thickness_micron || 0),
      default_grade: String(row.default_grade || "").trim(),
    }))
    .filter(
      (row) => row.role || row.film_variant_code || row.thickness_micron > 0,
    );
}

export function ProductMasterCloneDialog({
  open,
  onOpenChange,
  source,
}: Props) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [code, setCode] = React.useState("");
  const [name, setName] = React.useState("");
  const [templateId, setTemplateId] = React.useState<string>("__none__");
  const [layers, setLayers] = React.useState<LayerTemplateRow[]>([]);
  const [description, setDescription] = React.useState("");
  const [disableSource, setDisableSource] = React.useState(false);

  React.useEffect(() => {
    if (!source || !open) return;
    setCode(defaultCloneCode(source));
    setName(`${source.name} copy`);
    setTemplateId(source.template || source.default_template || "__none__");
    setLayers(cloneLayers(source));
    setDescription(source.description || "");
    setDisableSource(false);
  }, [source, open]);

  const { data: templates = [] } = useQuery({
    queryKey: ["templates", "live"],
    queryFn: () => templateService.getLiveTemplateOptions(),
    staleTime: 5 * 60_000,
    enabled: open,
  });
  const { data: filmVariants = [] } = useQuery<Material[]>({
    queryKey: ["master-film-variants"],
    queryFn: masterDataService.getFilmVariants,
    staleTime: 60_000,
    enabled: open,
  });

  const cloneMutation = useMutation({
    mutationFn: async () => {
      if (!source) throw new Error("Pick a product master first.");
      const nextLayers = cleanLayers(layers);
      const template = templateId === "__none__" ? null : templateId;
      const payload: ProductMasterClonePayload = {
        code: code.trim() || undefined,
        name: name.trim() || undefined,
        product_kind: source.product_kind,
        packaging_kind: source.packaging_kind ?? null,
        template,
        default_template: template,
        layer_template: nextLayers,
        canonical_layer_stack: nextLayers,
        fixed_attributes: {
          ...(source.fixed_attributes || {}),
          layer_count: nextLayers.length,
        },
        description,
        disable_source: disableSource,
        confirm_new_revision: disableSource,
        copy_sizes: true,
        copy_variants: false,
      };
      return productMasterService.clone(source.id, payload);
    },
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ["product-masters"] });
      await queryClient.invalidateQueries({
        queryKey: ["product-master", source?.id],
      });
      await queryClient.invalidateQueries({
        queryKey: ["product-master-sizes", created.id],
      });
      toast({
        title: disableSource ? "New version created" : "Product master cloned",
        description: disableSource
          ? "The old master is disabled and kept in the audit tab."
          : "Sizes were copied; variants can be regenerated or linked on the new master.",
      });
      onOpenChange(false);
      router.push(`/master/products/${created.id}/edit`);
    },
    onError: (err: any) => {
      toast({
        title: "Clone failed",
        description: err?.message || "Try again",
        variant: "destructive",
      });
    },
  });

  function patchLayer(index: number, patch: Partial<LayerTemplateRow>) {
    setLayers((rows) =>
      rows.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }

  function addLayer() {
    setLayers((rows) => [
      ...rows,
      {
        role: `layer-${rows.length + 1}`,
        film_variant_code: "",
        film_variant_id: null,
        thickness_micron: 0,
        default_grade: "",
        grade_options: [],
        grade_apportion: "fixed",
        thickness_apportion: "fixed_um",
      },
    ]);
  }

  if (!source) return null;

  const routeName =
    templates.find((template: any) => template.id === templateId)?.name ||
    "No route selected";
  const isValid = Boolean(name.trim()) && Boolean(code.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] max-w-5xl flex-col overflow-hidden rounded-2xl p-0">
        <DialogHeader className="border-b border-line bg-gradient-to-r from-order-bg via-white to-order-bg px-5 py-4">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-order-fg text-white shadow-sm">
              <Copy className="h-4 w-4" />
            </span>
            <div>
              <DialogTitle className="font-display text-lg font-black text-content-1">
                Clone product master
              </DialogTitle>
              <DialogDescription className="mt-0.5 text-xs text-content-3">
                Copy sizes, axes, packing/POD settings, and master defaults.
                Change route and layer stack before the new master is created.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-5 lg:grid-cols-[330px_minmax(0,1fr)]">
          <aside className="space-y-4">
            <section className="rounded-2xl border border-line bg-surface-1 p-4 shadow-sm">
              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-content-3">
                Source
              </div>
              <div className="mt-2 rounded-xl bg-surface-2 p-3">
                <div className="font-mono text-xs font-black text-order-fg">
                  {source.code}
                </div>
                <div className="mt-1 text-sm font-bold text-content-1">
                  {source.name}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] font-black uppercase">
                  <span className="rounded-full bg-info-bg px-2 py-0.5 text-primary ring-1 ring-info-border">
                    {source.product_kind}
                  </span>
                  {source.packaging_kind ? (
                    <span className="rounded-full bg-warning-bg px-2 py-0.5 text-warning-fg ring-1 ring-warning-border">
                      {source.packaging_kind}
                    </span>
                  ) : null}
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 ring-1",
                      source.active
                        ? "bg-success-bg text-success-fg ring-success-border"
                        : "bg-danger-bg text-danger-fg ring-danger-border",
                    )}
                  >
                    {source.active ? "active" : "disabled"}
                  </span>
                </div>
              </div>
            </section>

            <section className="space-y-3 rounded-2xl border border-line bg-surface-1 p-4 shadow-sm">
              <div className="grid gap-2">
                <Label className="text-[10px] font-black uppercase tracking-wider text-content-3">
                  New code
                </Label>
                <Input
                  value={code}
                  onChange={(event) =>
                    setCode(event.target.value.toUpperCase())
                  }
                  className="font-mono"
                />
              </div>
              <div className="grid gap-2">
                <Label className="text-[10px] font-black uppercase tracking-wider text-content-3">
                  New name
                </Label>
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <div className="grid gap-2">
                <Label className="text-[10px] font-black uppercase tracking-wider text-content-3">
                  Route at create
                </Label>
                <Select value={templateId} onValueChange={setTemplateId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select route" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No route yet</SelectItem>
                    {templates.map((template: any) => (
                      <SelectItem key={template.id} value={template.id}>
                        {template.name || template.code || template.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="inline-flex items-center gap-1.5 rounded-lg bg-info-bg px-2 py-1 text-[10px] font-bold text-primary ring-1 ring-info-border">
                  <Route className="h-3 w-3" />
                  {routeName}
                </div>
              </div>
              <div className="grid gap-2">
                <Label className="text-[10px] font-black uppercase tracking-wider text-content-3">
                  Note
                </Label>
                <Textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={4}
                />
              </div>
              <label className="flex items-start gap-3 rounded-xl border border-warning-border bg-warning-bg p-3">
                <Switch
                  checked={disableSource}
                  onCheckedChange={setDisableSource}
                />
                <span>
                  <span className="block text-xs font-black text-warning-fg">
                    Save as active replacement
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-warning-fg">
                    Disable the active master after creating this one. Existing
                    orders keep their frozen audit record.
                  </span>
                </span>
              </label>
            </section>
          </aside>

          <section className="min-w-0 rounded-2xl border border-line bg-surface-1 shadow-sm">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
              <div>
                <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-order-fg">
                  <Layers className="h-3.5 w-3.5" />
                  Layer stack at create
                </div>
                <div className="mt-0.5 text-xs text-content-3">
                  Edit the copied stack now, or leave it unchanged and refine in
                  the editor.
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addLayer}
                className="gap-1.5 rounded-xl"
              >
                <Plus className="h-3.5 w-3.5" />
                Layer
              </Button>
            </header>
            <div className="space-y-3 p-4">
              {layers.length === 0 ? (
                <div className="rounded-xl border border-dashed border-line bg-surface-2 p-6 text-center text-sm text-content-3">
                  No layer rows. This is valid for packaging/POD setup that will
                  be completed later.
                </div>
              ) : (
                layers.map((layer, index) => (
                  <div
                    key={index}
                    className="rounded-xl border border-line bg-surface-2 p-3"
                  >
                    <div className="mb-2 flex items-center justify-between">
                      <span className="rounded-lg bg-order-bg px-2 py-0.5 text-[10px] font-black text-order-fg">
                        L{index + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setLayers((rows) =>
                            rows.filter((_, i) => i !== index),
                          )
                        }
                        className="rounded-lg p-1 text-content-4 hover:bg-danger-bg hover:text-danger-fg"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="grid gap-2 md:grid-cols-[1fr_1.5fr_120px_120px]">
                      <div className="grid gap-1">
                        <Label className="text-[9px] font-black uppercase tracking-wider text-content-3">
                          Role
                        </Label>
                        <Input
                          value={layer.role || ""}
                          onChange={(event) =>
                            patchLayer(index, { role: event.target.value })
                          }
                        />
                      </div>
                      <div className="grid gap-1">
                        <Label className="text-[9px] font-black uppercase tracking-wider text-content-3">
                          Film variant
                        </Label>
                        <Select
                          value={layer.film_variant_code || "__none__"}
                          onValueChange={(value) => {
                            const picked = filmVariants.find(
                              (film) => film.code === value,
                            );
                            patchLayer(index, {
                              film_variant_code:
                                value === "__none__" ? "" : value,
                              film_variant_id: picked?.id || null,
                            });
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Film" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">
                              Select film
                            </SelectItem>
                            {filmVariants.map((film) => (
                              <SelectItem key={film.id} value={film.code}>
                                {film.code} - {film.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {layer.film_variant_code ? (
                          <div className="mt-1 rounded-lg bg-surface-1 px-2 py-1 font-mono text-[10px] font-bold text-content-2 ring-1 ring-line">
                            Current film · {layer.film_variant_code}
                          </div>
                        ) : null}
                      </div>
                      <div className="grid gap-1">
                        <Label className="text-[9px] font-black uppercase tracking-wider text-content-3">
                          Micron
                        </Label>
                        <Input
                          type="number"
                          value={layer.thickness_micron || 0}
                          onChange={(event) =>
                            patchLayer(index, {
                              thickness_micron: Number(event.target.value || 0),
                            })
                          }
                        />
                      </div>
                      <div className="grid gap-1">
                        <Label className="text-[9px] font-black uppercase tracking-wider text-content-3">
                          Grade
                        </Label>
                        <Input
                          value={layer.default_grade || ""}
                          onChange={(event) =>
                            patchLayer(index, {
                              default_grade: event.target.value.toUpperCase(),
                            })
                          }
                          placeholder="GP"
                        />
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        <DialogFooter className="border-t border-line bg-surface-2 px-5 py-3">
          <div className="mr-auto hidden items-center gap-1.5 text-[11px] font-bold text-success-fg sm:flex">
            <ShieldCheck className="h-3.5 w-3.5" />
            New record keeps historical orders on the old master.
          </div>
          <Button
            type="button"
            variant="outline"
            className="rounded-xl"
            onClick={() => onOpenChange(false)}
            disabled={cloneMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="gap-1.5 rounded-xl"
            onClick={() => cloneMutation.mutate()}
            disabled={!isValid || cloneMutation.isPending}
          >
            {cloneMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
            {disableSource ? "Create version" : "Create clone"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

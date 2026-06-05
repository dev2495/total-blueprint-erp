"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
import { recipeService } from "@/services/recipes";

import {
  type OrderItemDraft,
  type PackagingLine,
  type AdjustmentDraft,
  classifyAddonMaster,
  getOrderItemContractIssues,
  isGussetStyle,
  isSpoutStyle,
  makeAdjustment,
  makeAddon,
  makeLayer,
  normalizePouchStyle,
  asNumber,
} from "./order-draft";
import { type PodSkuVariant } from "@/services/master-data";

function Section({
  title,
  description,
  defaultOpen = true,
  dataTestId,
  className = "",
  children,
}: {
  title: string;
  description: string;
  defaultOpen?: boolean;
  dataTestId?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Collapsible
      data-testid={dataTestId}
      defaultOpen={defaultOpen}
      className={`overflow-hidden rounded-[1.75rem] border border-line bg-[linear-gradient(180deg,rgba(255,255,255,0.97),rgba(248,250,252,0.95))] shadow-[0_22px_55px_-50px_rgba(15,23,42,0.45)] backdrop-blur ${className}`}
    >
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-surface-2 sm:px-6 sm:py-5">
        <div>
          <div className="text-sm font-black uppercase tracking-[0.22em] text-content-2">
            {title}
          </div>
          <div className="mt-1 max-w-3xl text-xs leading-5 text-content-3 sm:text-[13px]">
            {description}
          </div>
        </div>
        <div className="rounded-full border border-line bg-surface-1 p-2 text-content-4 shadow-sm">
          <ChevronDown className="h-4 w-4" />
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-t border-line px-4 py-5 sm:px-6">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function GradeSelector({
  variantId,
  value,
  onChange,
}: {
  variantId: string;
  value?: string | null;
  onChange: (val: string) => void;
}) {
  const { data: grades = [], isLoading } = useQuery({
    queryKey: ["variant-grades", variantId],
    queryFn: () => recipeService.getGrades(variantId),
    enabled: Boolean(variantId),
  });

  if (!variantId) {
    return (
      <div className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs text-content-4">
        Select variant first
      </div>
    );
  }
  if (isLoading) {
    return <Loader2 className="h-4 w-4 animate-spin text-content-4" />;
  }
  return (
    <Select
      value={value || "__NONE__"}
      onValueChange={(val) => onChange(val === "__NONE__" ? "" : val)}
    >
      <SelectTrigger className="bg-surface-1">
        <SelectValue placeholder="Select grade" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__NONE__">Select grade</SelectItem>
        {grades.map((grade: any) => (
          <SelectItem key={grade.id} value={String(grade.id)}>
            {grade.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default function OrderItemTechnicalEditor({
  item,
  templates,
  families,
  variants,
  addonsMaster,
  packagingMaterials,
  podProfiles,
  artworks,
  previewLoading,
  previewError,
  hidePreviewSection = false,
  onPreviewRetry,
  updateItem,
}: {
  item: OrderItemDraft;
  templates: any[];
  families: any[];
  variants: any[];
  addonsMaster: any[];
  packagingMaterials: any[];
  podProfiles: PodSkuVariant[];
  artworks: any[];
  previewLoading: boolean;
  previewError: string;
  hidePreviewSection?: boolean;
  onPreviewRetry: () => void;
  updateItem: (updater: (current: OrderItemDraft) => OrderItemDraft) => void;
}) {
  const activeTemplate = templates.find(
    (template: any) => String(template.id) === String(item.template_id),
  );
  const lockedPouchStyle = normalizePouchStyle(
    activeTemplate?.pouch_style || item.geometry.pouch_style || "",
  );
  const showGussetField =
    item.finished_good_type === "POUCH" && isGussetStyle(lockedPouchStyle);
  const spoutStyle =
    item.finished_good_type === "POUCH" && isSpoutStyle(lockedPouchStyle);
  const hasSpoutAddon = item.addons.some((row) => {
    const meta = addonsMaster.find(
      (addon: any) => String(addon.id) === String(row.addon_id),
    );
    return classifyAddonMaster(meta).isSpoutCompatible;
  });
  const addonOptions = [...addonsMaster].sort((left: any, right: any) => {
    const leftMeta = classifyAddonMaster(left);
    const rightMeta = classifyAddonMaster(right);
    const leftRank = spoutStyle
      ? leftMeta.isSpoutCompatible
        ? 0
        : 1
      : leftMeta.isSpoutCompatible
        ? 1
        : 0;
    const rightRank = spoutStyle
      ? rightMeta.isSpoutCompatible
        ? 0
        : 1
      : rightMeta.isSpoutCompatible
        ? 1
        : 0;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return String(left?.name || "").localeCompare(String(right?.name || ""));
  });
  const previewGeometry =
    item.savedPreview?.physics?.geometry_snapshot ||
    item.savedPreview?.geometry_snapshot ||
    {};
  const previewAddonKg = (item.savedPreview?.bom?.addons || []).reduce(
    (sum: number, row: any) => sum + asNumber(row?.weight_kg, 0),
    0,
  );
  const previewPodKg = (item.savedPreview?.bom?.pod || []).reduce(
    (sum: number, row: any) => sum + asNumber(row?.weight_kg, 0),
    0,
  );
  const contractIssues = getOrderItemContractIssues(
    item,
    addonsMaster,
    lockedPouchStyle,
  );
  const printingHasBackSide = item.printing.substrate_mode === "TUBING";

  useEffect(() => {
    if (item.finished_good_type !== "POUCH") return;
    if (!lockedPouchStyle) return;
    if (normalizePouchStyle(item.geometry.pouch_style) === lockedPouchStyle)
      return;
    updateItem((current) => ({
      ...current,
      geometry: {
        ...current.geometry,
        pouch_style: lockedPouchStyle,
      },
      savedPreview: null,
    }));
  }, [
    item.finished_good_type,
    item.geometry.pouch_style,
    lockedPouchStyle,
    updateItem,
  ]);

  useEffect(() => {
    if (!item.printing.enabled) return;
    if (item.printing.substrate_mode !== "SHEET") return;
    if (asNumber(item.printing.back_colors_count, 0) <= 0) return;
    updateItem((current) => ({
      ...current,
      printing: { ...current.printing, back_colors_count: 0 },
      savedPreview: null,
    }));
  }, [
    item.printing.back_colors_count,
    item.printing.enabled,
    item.printing.substrate_mode,
    updateItem,
  ]);

  return (
    <div className="grid gap-4 2xl:grid-cols-2">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[1.35rem] border border-line bg-surface-1 px-4 py-3 shadow-[0_14px_34px_-30px_rgba(15,23,42,0.35)] sm:px-5 2xl:col-span-2">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.22em] text-content-4">
            Builder Flow
          </div>
          <div className="mt-1 text-sm font-bold text-content-1">
            Product structure, print, chemistry, add-ons, packaging, and preview
            math.
          </div>
        </div>
        <Badge
          className={
            contractIssues.length
              ? "border border-warning-border bg-warning-bg text-warning-fg"
              : "border border-success-border bg-success-bg text-success-fg"
          }
        >
          {contractIssues.length
            ? `${contractIssues.length} contract checks`
            : "Contract ready"}
        </Badge>
      </div>
      <Section
        title="Product Structure"
        description="Geometry, lamination stack, roll form, and physical adjustments."
        dataTestId="sku-variant-section-product-structure"
        className="2xl:col-span-2"
      >
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-4">
            <div className="space-y-2">
              <Label>Template Product</Label>
              <div className="rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm font-bold text-content-2">
                {activeTemplate?.name || "Select template in Basics"}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Final Product Type</Label>
              <div className="rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm font-bold text-content-2">
                {item.finished_good_type}
              </div>
            </div>
            {item.finished_good_type === "ROLL" ? (
              <div className="space-y-2">
                <Label>Roll Form</Label>
                <Select
                  value={item.roll_form || "FLAT"}
                  onValueChange={(value) =>
                    updateItem((current) => ({
                      ...current,
                      roll_form: value as OrderItemDraft["roll_form"],
                      savedPreview: null,
                    }))
                  }
                >
                  <SelectTrigger className="bg-surface-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FLAT">FLAT</SelectItem>
                    <SelectItem value="FOLDED">FOLDED</SelectItem>
                    <SelectItem value="TUBING">TUBING</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label>Pouch Style</Label>
                  <div className="rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm font-bold text-content-2">
                    {lockedPouchStyle
                      ? lockedPouchStyle.replaceAll("_", " ")
                      : "Template style pending"}
                  </div>
                  <p className="text-[11px] text-content-3">
                    {activeTemplate
                      ? "Template is linked. Add the missing pouch style in the LIVE template contract if this is pending."
                      : "Select a LIVE template to lock style and route context."}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Width (mm)</Label>
                  <Input
                    type="number"
                    value={String(item.geometry.base.width_mm)}
                    onChange={(event) =>
                      updateItem((current) => ({
                        ...current,
                        geometry: {
                          ...current.geometry,
                          base: {
                            ...current.geometry.base,
                            width_mm: asNumber(event.target.value, 0),
                          },
                        },
                        savedPreview: null,
                      }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Height (mm)</Label>
                  <Input
                    type="number"
                    value={String(item.geometry.base.height_mm)}
                    onChange={(event) =>
                      updateItem((current) => ({
                        ...current,
                        geometry: {
                          ...current.geometry,
                          base: {
                            ...current.geometry.base,
                            height_mm: asNumber(event.target.value, 0),
                          },
                        },
                        savedPreview: null,
                      }))
                    }
                  />
                </div>
                {showGussetField ? (
                  <div className="space-y-2">
                    <Label>Gusset (mm)</Label>
                    <Input
                      type="number"
                      value={String(item.geometry.gusset_mm || 0)}
                      onChange={(event) =>
                        updateItem((current) => ({
                          ...current,
                          geometry: {
                            ...current.geometry,
                            gusset_mm: asNumber(event.target.value, 0),
                          },
                          savedPreview: null,
                        }))
                      }
                    />
                    <p className="text-[11px] text-content-3">
                      Required for gusseted styles and used directly in
                      effective width math.
                    </p>
                  </div>
                ) : null}
              </>
            )}
          </div>

          {item.finished_good_type === "POUCH" ? (
            <div className="grid gap-3 xl:grid-cols-3">
              <div
                className={`rounded-2xl border px-4 py-3 text-sm ${showGussetField && (item.geometry.gusset_mm || 0) <= 0 ? "border-warning-border bg-warning-bg text-warning-fg" : "border-line bg-surface-2 text-content-3"}`}
              >
                <div className="text-[10px] font-black uppercase tracking-[0.18em]">
                  Rule
                </div>
                <div className="mt-1 font-semibold">
                  {showGussetField
                    ? "This pouch family requires gusset."
                    : "This pouch family does not require gusset input."}
                </div>
              </div>
              <div
                className={`rounded-2xl border px-4 py-3 text-sm ${spoutStyle && !hasSpoutAddon ? "border-warning-border bg-warning-bg text-warning-fg" : "border-line bg-surface-2 text-content-3"}`}
              >
                <div className="text-[10px] font-black uppercase tracking-[0.18em]">
                  Add-on Rule
                </div>
                <div className="mt-1 font-semibold">
                  {spoutStyle
                    ? hasSpoutAddon
                      ? "Spout or fitment add-on linked."
                      : "Spout style requires a spout or fitment add-on."
                    : "Approved add-ons stay optional for this style."}
                </div>
              </div>
              <div className="rounded-2xl border border-line bg-surface-2 px-4 py-3 text-sm text-content-3">
                <div className="text-[10px] font-black uppercase tracking-[0.18em]">
                  Geometry Note
                </div>
                <div className="mt-1 font-semibold">
                  Trim and flap change effective material width and height
                  before BOM math runs.
                </div>
              </div>
            </div>
          ) : null}

          {item.finished_good_type === "POUCH" ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <div className="space-y-2">
                <Label>Trim Loss (mm)</Label>
                <Input
                  type="number"
                  value={String(item.geometry.trim_loss_mm || 0)}
                  onChange={(event) =>
                    updateItem((current) => ({
                      ...current,
                      geometry: {
                        ...current.geometry,
                        trim_loss_mm: asNumber(event.target.value, 0),
                      },
                      savedPreview: null,
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Flap / Tape (mm)</Label>
                <Input
                  type="number"
                  value={String(item.geometry.flap_tape_mm || 0)}
                  onChange={(event) =>
                    updateItem((current) => ({
                      ...current,
                      geometry: {
                        ...current.geometry,
                        flap_tape_mm: asNumber(event.target.value, 0),
                      },
                      savedPreview: null,
                    }))
                  }
                />
              </div>
              <div className="rounded-2xl border border-line bg-surface-2 px-4 py-3 text-sm text-content-3">
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-content-4">
                  Effective Contract
                </div>
                <div className="mt-2 font-semibold">
                  {lockedPouchStyle
                    ? lockedPouchStyle.replaceAll("_", " ")
                    : "Template style pending"}
                </div>
                <div className="mt-1 text-xs text-content-3">
                  Width and height are base dimensions. Gusset, trim, flap, and
                  named adjustments are applied before preview and BOM.
                </div>
              </div>
            </div>
          ) : null}

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Physical Adjustments</Label>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  updateItem((current) => ({
                    ...current,
                    geometry: {
                      ...current.geometry,
                      adjustments: [
                        ...current.geometry.adjustments,
                        makeAdjustment(),
                      ],
                    },
                    savedPreview: null,
                  }))
                }
              >
                <Plus className="mr-2 h-4 w-4" /> Add Adjustment
              </Button>
            </div>
            {item.geometry.adjustments.length === 0 ? (
              <div className="rounded-xl border border-dashed border-line px-4 py-5 text-sm text-content-3">
                No custom adjustments configured.
              </div>
            ) : null}
            {item.geometry.adjustments.map((adjustment, index) => (
              <div
                key={adjustment.localId}
                className="grid gap-2 rounded-2xl border border-line bg-surface-2 p-3 xl:grid-cols-[minmax(0,1fr)_120px_160px_44px]"
              >
                <Input
                  value={adjustment.name}
                  placeholder="Adjustment name"
                  onChange={(event) =>
                    updateItem((current) => ({
                      ...current,
                      geometry: {
                        ...current.geometry,
                        adjustments: current.geometry.adjustments.map(
                          (row, rowIndex) =>
                            rowIndex === index
                              ? { ...row, name: event.target.value }
                              : row,
                        ),
                      },
                      savedPreview: null,
                    }))
                  }
                />
                <Input
                  type="number"
                  value={String(adjustment.value)}
                  onChange={(event) =>
                    updateItem((current) => ({
                      ...current,
                      geometry: {
                        ...current.geometry,
                        adjustments: current.geometry.adjustments.map(
                          (row, rowIndex) =>
                            rowIndex === index
                              ? {
                                  ...row,
                                  value: asNumber(event.target.value, 0),
                                }
                              : row,
                        ),
                      },
                      savedPreview: null,
                    }))
                  }
                />
                <Select
                  value={adjustment.impact}
                  onValueChange={(value) =>
                    updateItem((current) => ({
                      ...current,
                      geometry: {
                        ...current.geometry,
                        adjustments: current.geometry.adjustments.map(
                          (row, rowIndex) =>
                            rowIndex === index
                              ? {
                                  ...row,
                                  impact: value as AdjustmentDraft["impact"],
                                }
                              : row,
                        ),
                      },
                      savedPreview: null,
                    }))
                  }
                >
                  <SelectTrigger className="bg-surface-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="WIDTH">WIDTH</SelectItem>
                    <SelectItem value="HEIGHT">HEIGHT</SelectItem>
                    <SelectItem value="BOTH">BOTH</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-danger-fg"
                  onClick={() =>
                    updateItem((current) => ({
                      ...current,
                      geometry: {
                        ...current.geometry,
                        adjustments: current.geometry.adjustments.filter(
                          (_, rowIndex) => rowIndex !== index,
                        ),
                      },
                      savedPreview: null,
                    }))
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label>Lamination Stack</Label>
                <p className="text-xs text-content-3">
                  Density comes from the selected film family and variant in
                  master data. This builder only selects the source.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  updateItem((current) => ({
                    ...current,
                    film_layers: [...current.film_layers, makeLayer()],
                    savedPreview: null,
                  }))
                }
              >
                <Plus className="mr-2 h-4 w-4" /> Add Layer
              </Button>
            </div>
            {item.film_layers.map((layer, index) => {
              const familyVariants = variants.filter(
                (variant: any) =>
                  String(
                    variant?.parent_family?.id || variant?.parent_family || "",
                  ) === String(layer.family_id),
              );
              const selectedVariant = variants.find(
                (variant: any) =>
                  String(variant.id) === String(layer.variant_id),
              );
              return (
                <div
                  key={layer.localId}
                  className="space-y-4 rounded-3xl border border-line bg-surface-2 p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-[10px] font-black uppercase tracking-[0.2em] text-content-4">
                        Layer {index + 1}
                      </div>
                      <div className="mt-1 text-sm font-semibold text-content-2">
                        {selectedVariant?.name || "Choose family and variant"}
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      className="text-danger-fg"
                      onClick={() =>
                        updateItem((current) => ({
                          ...current,
                          film_layers: current.film_layers.filter(
                            (_, rowIndex) => rowIndex !== index,
                          ),
                          savedPreview: null,
                        }))
                      }
                      disabled={item.film_layers.length === 1}
                    >
                      Remove Layer
                    </Button>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    <div className="space-y-2">
                      <Label>Family</Label>
                      <Select
                        value={layer.family_id || "__NONE__"}
                        onValueChange={(value) =>
                          updateItem((current) => ({
                            ...current,
                            film_layers: current.film_layers.map(
                              (row, rowIndex) =>
                                rowIndex === index
                                  ? {
                                      ...row,
                                      family_id:
                                        value === "__NONE__" ? "" : value,
                                      variant_id: "",
                                      grade_id: null,
                                    }
                                  : row,
                            ),
                            savedPreview: null,
                          }))
                        }
                      >
                        <SelectTrigger className="bg-surface-1">
                          <SelectValue placeholder="Select family" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__NONE__">
                            Select family
                          </SelectItem>
                          {families.map((family: any) => (
                            <SelectItem
                              key={family.id}
                              value={String(family.id)}
                            >
                              {family.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Variant</Label>
                      <Select
                        value={layer.variant_id || "__NONE__"}
                        onValueChange={(value) =>
                          updateItem((current) => ({
                            ...current,
                            film_layers: current.film_layers.map(
                              (row, rowIndex) =>
                                rowIndex === index
                                  ? {
                                      ...row,
                                      variant_id:
                                        value === "__NONE__" ? "" : value,
                                      grade_id: null,
                                    }
                                  : row,
                            ),
                            savedPreview: null,
                          }))
                        }
                      >
                        <SelectTrigger className="bg-surface-1">
                          <SelectValue placeholder="Select variant" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__NONE__">
                            Select variant
                          </SelectItem>
                          {familyVariants.map((variant: any) => (
                            <SelectItem
                              key={variant.id}
                              value={String(variant.id)}
                            >
                              {variant.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Grade</Label>
                      {selectedVariant?.is_extrudable ? (
                        <GradeSelector
                          variantId={String(layer.variant_id || "")}
                          value={layer.grade_id}
                          onChange={(value) =>
                            updateItem((current) => ({
                              ...current,
                              film_layers: current.film_layers.map(
                                (row, rowIndex) =>
                                  rowIndex === index
                                    ? { ...row, grade_id: value || null }
                                    : row,
                              ),
                              savedPreview: null,
                            }))
                          }
                        />
                      ) : (
                        <div className="rounded-xl border border-line bg-surface-1 px-3 py-2 text-xs text-content-4">
                          Not required
                        </div>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label>Thickness (micron)</Label>
                      <Input
                        type="number"
                        value={String(layer.thickness_micron)}
                        onChange={(event) =>
                          updateItem((current) => ({
                            ...current,
                            film_layers: current.film_layers.map(
                              (row, rowIndex) =>
                                rowIndex === index
                                  ? {
                                      ...row,
                                      thickness_micron: asNumber(
                                        event.target.value,
                                        0,
                                      ),
                                    }
                                  : row,
                            ),
                            savedPreview: null,
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Roll Width (mm)</Label>
                      <Input
                        type="number"
                        value={String(layer.roll_width_mm)}
                        onChange={(event) =>
                          updateItem((current) => ({
                            ...current,
                            film_layers: current.film_layers.map(
                              (row, rowIndex) =>
                                rowIndex === index
                                  ? {
                                      ...row,
                                      roll_width_mm: asNumber(
                                        event.target.value,
                                        0,
                                      ),
                                    }
                                  : row,
                            ),
                            savedPreview: null,
                          }))
                        }
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </Section>

      {contractIssues.length ? (
        <div className="overflow-hidden rounded-[1.55rem] border border-warning-border bg-warning-bg shadow-[0_18px_45px_-40px_rgba(146,64,14,0.35)] 2xl:col-span-2">
          <div className="flex items-start justify-between gap-4 px-5 py-4 sm:px-6">
            <div>
              <div className="text-sm font-black uppercase tracking-[0.22em] text-warning-fg">
                Contract Checks
              </div>
              <div className="mt-1 text-sm font-semibold text-warning-fg">
                Fix these before saving or relying on preview math.
              </div>
            </div>
            <Badge className="border border-warning-border bg-surface-1/70 text-warning-fg">
              {contractIssues.length} open
            </Badge>
          </div>
          <div className="border-t border-warning-border px-5 py-4 sm:px-6">
            <div className="grid gap-2 md:grid-cols-2">
              {contractIssues.map((issue) => (
                <div
                  key={issue}
                  className="rounded-2xl border border-warning-border bg-surface-1/75 px-4 py-3 text-sm text-warning-fg"
                >
                  {issue}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <Section
        title="Printing"
        description="Artwork, color counts, print method, and ink load."
        dataTestId="sku-variant-section-printing"
      >
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-2xl border border-line p-4">
            <div>
              <Label>Printing Enabled</Label>
              <p className="text-xs text-content-3">
                Turn on only when this SKU needs printed artwork and ink BOM.
              </p>
            </div>
            <Switch
              checked={item.printing.enabled}
              onCheckedChange={(checked) =>
                updateItem((current) => ({
                  ...current,
                  printing: { ...current.printing, enabled: checked },
                  savedPreview: null,
                }))
              }
            />
          </div>
          {item.printing.enabled ? (
            <div className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3">
              <div className="space-y-2">
                <Label>Method</Label>
                <Select
                  value={item.printing.type}
                  onValueChange={(value) =>
                    updateItem((current) => ({
                      ...current,
                      printing: {
                        ...current.printing,
                        type: value as OrderItemDraft["printing"]["type"],
                      },
                      savedPreview: null,
                    }))
                  }
                >
                  <SelectTrigger className="bg-surface-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="FLEXO">FLEXO</SelectItem>
                    <SelectItem value="ROTO">ROTO</SelectItem>
                    <SelectItem value="DIGITAL">DIGITAL</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Film Type</Label>
                <Select
                  value={item.printing.substrate_mode}
                  onValueChange={(value) =>
                    updateItem((current) => ({
                      ...current,
                      printing: {
                        ...current.printing,
                        substrate_mode:
                          value as OrderItemDraft["printing"]["substrate_mode"],
                        back_colors_count:
                          value === "TUBING"
                            ? current.printing.back_colors_count
                            : 0,
                      },
                      savedPreview: null,
                    }))
                  }
                >
                  <SelectTrigger className="bg-surface-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="SHEET">SHEET</SelectItem>
                    <SelectItem value="TUBING">TUBING</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Total Ink GSM</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={String(item.printing.ink_gsm_total)}
                  onChange={(event) =>
                    updateItem((current) => ({
                      ...current,
                      printing: {
                        ...current.printing,
                        ink_gsm_total: asNumber(event.target.value, 0),
                      },
                      savedPreview: null,
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>Front Colors</Label>
                <Input
                  type="number"
                  value={String(item.printing.front_colors_count)}
                  onChange={(event) =>
                    updateItem((current) => ({
                      ...current,
                      printing: {
                        ...current.printing,
                        front_colors_count: asNumber(event.target.value, 0),
                      },
                      savedPreview: null,
                    }))
                  }
                />
              </div>
              {printingHasBackSide ? (
                <div className="space-y-2">
                  <Label>Back Colors</Label>
                  <Input
                    type="number"
                    value={String(item.printing.back_colors_count)}
                    onChange={(event) =>
                      updateItem((current) => ({
                        ...current,
                        printing: {
                          ...current.printing,
                          back_colors_count: asNumber(event.target.value, 0),
                        },
                        savedPreview: null,
                      }))
                    }
                  />
                </div>
              ) : null}
              <div className="space-y-2">
                <Label>Approved Artwork</Label>
                <Select
                  value={item.printing.artwork_id || "__NONE__"}
                  onValueChange={(value) =>
                    updateItem((current) => ({
                      ...current,
                      printing: {
                        ...current.printing,
                        artwork_id: value === "__NONE__" ? "" : value,
                        defer_artwork_to_planner: false,
                      },
                      savedPreview: null,
                    }))
                  }
                  disabled={item.printing.defer_artwork_to_planner}
                >
                  <SelectTrigger className="bg-surface-1">
                    <SelectValue placeholder="Select artwork" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__NONE__">Select artwork</SelectItem>
                    {artworks.map((artwork: any) => (
                      <SelectItem key={artwork.id} value={String(artwork.id)}>
                        {artwork.design_code} - {artwork.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between rounded-2xl border border-line bg-surface-1 p-4 sm:col-span-2 2xl:col-span-3">
                <div>
                  <Label>Defer Artwork To Planner</Label>
                  <p className="text-xs text-content-3">
                    Allow commercial confirmation before final artwork
                    assignment.
                  </p>
                </div>
                <Switch
                  checked={item.printing.defer_artwork_to_planner}
                  onCheckedChange={(checked) =>
                    updateItem((current) => ({
                      ...current,
                      printing: {
                        ...current.printing,
                        defer_artwork_to_planner: checked,
                        artwork_id: checked ? "" : current.printing.artwork_id,
                      },
                      savedPreview: null,
                    }))
                  }
                />
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-line bg-surface-2 px-4 py-6 text-sm text-content-3">
              Printing is off. Lamination chemistry can still be set below when
              the film stack requires it.
            </div>
          )}
        </div>
      </Section>

      <Section
        title="Chemistry & Lamination"
        description="Adhesive and solvent inputs for laminated structures; independent of printing."
        dataTestId="sku-variant-section-chemistry"
      >
        {item.film_layers.length > 1 ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Adhesive GSM</Label>
              <Input
                type="number"
                step="0.01"
                value={String(item.chemicals.adhesive_gsm)}
                onChange={(event) =>
                  updateItem((current) => ({
                    ...current,
                    chemicals: {
                      ...current.chemicals,
                      adhesive_gsm: asNumber(event.target.value, 0),
                    },
                    savedPreview: null,
                  }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Solvent GSM</Label>
              <Input
                type="number"
                step="0.01"
                value={String(item.chemicals.solvent_gsm)}
                onChange={(event) =>
                  updateItem((current) => ({
                    ...current,
                    chemicals: {
                      ...current.chemicals,
                      solvent_gsm: asNumber(event.target.value, 0),
                    },
                    savedPreview: null,
                  }))
                }
              />
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-line bg-surface-2 px-4 py-5 text-sm text-content-3">
            Chemistry is not required for a single-layer structure.
          </div>
        )}
      </Section>

      <Section
        title="Packaging & POD"
        description="Dispatch packaging, add-ons, and POD reinforcement."
        dataTestId="sku-variant-section-packaging-pod"
        className="2xl:col-span-2"
      >
        <div className="space-y-5">
          {item.finished_good_type === "POUCH" ? (
            <div className="rounded-2xl border border-line p-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Primary Inner Pack</Label>
                  <p className="text-xs text-content-3">
                    This configuration travels to packing and dispatch.
                  </p>
                </div>
                <Switch
                  checked={item.packaging_snapshot.primary_inner_pack.enabled}
                  onCheckedChange={(checked) =>
                    updateItem((current) => ({
                      ...current,
                      packaging_snapshot: {
                        ...current.packaging_snapshot,
                        primary_inner_pack: {
                          ...current.packaging_snapshot.primary_inner_pack,
                          enabled: checked,
                        },
                      },
                      savedPreview: null,
                    }))
                  }
                />
              </div>
              {item.packaging_snapshot.primary_inner_pack.enabled ? (
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Packaging Material</Label>
                    <Select
                      value={
                        item.packaging_snapshot.primary_inner_pack
                          .material_id || "__NONE__"
                      }
                      onValueChange={(value) =>
                        updateItem((current) => ({
                          ...current,
                          packaging_snapshot: {
                            ...current.packaging_snapshot,
                            primary_inner_pack: {
                              ...current.packaging_snapshot.primary_inner_pack,
                              material_id: value === "__NONE__" ? "" : value,
                            },
                          },
                          savedPreview: null,
                        }))
                      }
                    >
                      <SelectTrigger className="bg-surface-1">
                        <SelectValue placeholder="Select packaging material" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__NONE__">
                          Select packaging material
                        </SelectItem>
                        {packagingMaterials
                          .filter(
                            (row: any) =>
                              String(row.packaging_kind || "").toUpperCase() ===
                              "INNER_POUCH",
                          )
                          .map((row: any) => (
                            <SelectItem key={row.id} value={String(row.id)}>
                              {row.code} - {row.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>PCS per Pack</Label>
                    <Input
                      type="number"
                      value={String(
                        item.packaging_snapshot.primary_inner_pack.pcs_per_pack,
                      )}
                      onChange={(event) =>
                        updateItem((current) => ({
                          ...current,
                          packaging_snapshot: {
                            ...current.packaging_snapshot,
                            primary_inner_pack: {
                              ...current.packaging_snapshot.primary_inner_pack,
                              pcs_per_pack: asNumber(event.target.value, 0),
                            },
                          },
                          savedPreview: null,
                        }))
                      }
                    />
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="rounded-2xl border border-line p-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Roll Dispatch Packaging</Label>
                  <p className="text-xs text-content-3">
                    Select allowed roll-pack materials here. Actual qty is
                    captured later in Packing Yard.
                  </p>
                </div>
                <Switch
                  checked={item.packaging_snapshot.roll_dispatch_pack.enabled}
                  onCheckedChange={(checked) =>
                    updateItem((current) => ({
                      ...current,
                      packaging_snapshot: {
                        ...current.packaging_snapshot,
                        roll_dispatch_pack: {
                          ...current.packaging_snapshot.roll_dispatch_pack,
                          enabled: checked,
                        },
                      },
                      savedPreview: null,
                    }))
                  }
                />
              </div>
              {item.packaging_snapshot.roll_dispatch_pack.enabled ? (
                <div className="mt-4 space-y-3">
                  {item.packaging_snapshot.roll_dispatch_pack.lines.map(
                    (packLine, index) => (
                      <div
                        key={`${item.localId}-pack-${index}`}
                        className="space-y-3 rounded-2xl border border-line bg-surface-2 p-4"
                      >
                        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_160px]">
                          <div className="space-y-2">
                            <Label>Packaging Material</Label>
                            <Select
                              value={packLine.material_id || "__NONE__"}
                              onValueChange={(value) => {
                                const nextMaterialId =
                                  value === "__NONE__" ? "" : value;
                                const selectedMaterial =
                                  packagingMaterials.find(
                                    (row: any) =>
                                      String(row.id) === nextMaterialId,
                                  );
                                const inferredUom = String(
                                  selectedMaterial?.base_uom ||
                                    packLine.uom ||
                                    "PCS",
                                ).toUpperCase() as PackagingLine["uom"];
                                updateItem((current) => ({
                                  ...current,
                                  packaging_snapshot: {
                                    ...current.packaging_snapshot,
                                    roll_dispatch_pack: {
                                      ...current.packaging_snapshot
                                        .roll_dispatch_pack,
                                      lines:
                                        current.packaging_snapshot.roll_dispatch_pack.lines.map(
                                          (row, rowIndex) =>
                                            rowIndex === index
                                              ? {
                                                  ...row,
                                                  material_id: nextMaterialId,
                                                  uom: inferredUom,
                                                  qty: 0,
                                                }
                                              : row,
                                        ),
                                    },
                                  },
                                  savedPreview: null,
                                }));
                              }}
                            >
                              <SelectTrigger className="bg-surface-1">
                                <SelectValue placeholder="Packaging material" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__NONE__">
                                  Select packaging material
                                </SelectItem>
                                {packagingMaterials.map((row: any) => (
                                  <SelectItem
                                    key={row.id}
                                    value={String(row.id)}
                                  >
                                    {row.code} - {row.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label>Consumption Basis</Label>
                            <div className="rounded-xl border border-line bg-surface-1 px-3 py-2 text-sm font-medium text-content-2">
                              {packLine.material_id
                                ? `${packLine.uom} actual at packing`
                                : "Select material first"}
                            </div>
                            <p className="text-xs text-content-3">
                              Sales marks what can be used. Packing Yard enters
                              the real qty consumed per roll.
                            </p>
                          </div>
                        </div>
                        <div className="flex justify-end">
                          <Button
                            variant="outline"
                            className="text-danger-fg"
                            onClick={() =>
                              updateItem((current) => ({
                                ...current,
                                packaging_snapshot: {
                                  ...current.packaging_snapshot,
                                  roll_dispatch_pack: {
                                    ...current.packaging_snapshot
                                      .roll_dispatch_pack,
                                    lines:
                                      current.packaging_snapshot.roll_dispatch_pack.lines.filter(
                                        (_, rowIndex) => rowIndex !== index,
                                      ),
                                  },
                                },
                                savedPreview: null,
                              }))
                            }
                          >
                            Remove
                          </Button>
                        </div>
                      </div>
                    ),
                  )}
                  <Button
                    variant="outline"
                    onClick={() =>
                      updateItem((current) => ({
                        ...current,
                        packaging_snapshot: {
                          ...current.packaging_snapshot,
                          roll_dispatch_pack: {
                            ...current.packaging_snapshot.roll_dispatch_pack,
                            lines: [
                              ...current.packaging_snapshot.roll_dispatch_pack
                                .lines,
                              {
                                material_id: "",
                                qty: 0,
                                uom: "PCS",
                                basis: "PER_ROLL",
                              },
                            ],
                          },
                        },
                        savedPreview: null,
                      }))
                    }
                  >
                    <Plus className="mr-2 h-4 w-4" /> Add Allowed Material
                  </Button>
                </div>
              ) : null}
            </div>
          )}

          <div className="rounded-2xl border border-line p-4">
            <div className="flex items-center justify-between">
              <div>
                <Label>Add-ons</Label>
                <p className="text-xs text-content-3">
                  Non-packaging reinforcements and extras.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  updateItem((current) => ({
                    ...current,
                    addons: [...current.addons, makeAddon()],
                    savedPreview: null,
                  }))
                }
              >
                <Plus className="mr-2 h-4 w-4" /> Add Add-on
              </Button>
            </div>
            <div className="mt-4 space-y-3">
              {item.addons.length === 0 ? (
                <div className="text-sm text-content-3">
                  No add-ons linked yet.
                </div>
              ) : null}
              {item.addons.map((addon, index) => {
                const addonMeta = addonsMaster.find(
                  (row: any) => String(row.id) === String(addon.addon_id),
                );
                const mode = String(addonMeta?.weight_mode || "").toUpperCase();
                return (
                  <div
                    key={addon.localId}
                    className="space-y-3 rounded-2xl border border-line bg-surface-2 p-4"
                  >
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      <div className="space-y-2 xl:col-span-2">
                        <Label>Add-on</Label>
                        <Select
                          value={addon.addon_id || "__NONE__"}
                          onValueChange={(value) =>
                            updateItem((current) => ({
                              ...current,
                              addons: current.addons.map((row, rowIndex) =>
                                rowIndex === index
                                  ? {
                                      ...row,
                                      addon_id:
                                        value === "__NONE__" ? "" : value,
                                      applies_to:
                                        mode === "PER_MM"
                                          ? "WIDTH"
                                          : mode === "FIXED"
                                            ? "FIXED"
                                            : "PER_PIECE",
                                    }
                                  : row,
                              ),
                              savedPreview: null,
                            }))
                          }
                        >
                          <SelectTrigger className="bg-surface-1">
                            <SelectValue placeholder="Select add-on" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__NONE__">
                              Select add-on
                            </SelectItem>
                            {addonOptions.map((row: any) => (
                              <SelectItem key={row.id} value={String(row.id)}>
                                {row.code
                                  ? `${row.code} · ${row.name}`
                                  : row.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label>Quantity</Label>
                        <Input
                          type="number"
                          value={String(addon.qty)}
                          onChange={(event) =>
                            updateItem((current) => ({
                              ...current,
                              addons: current.addons.map((row, rowIndex) =>
                                rowIndex === index
                                  ? {
                                      ...row,
                                      qty: asNumber(event.target.value, 0),
                                    }
                                  : row,
                              ),
                              savedPreview: null,
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Application</Label>
                        {mode === "PER_MM" ? (
                          <Select
                            value={addon.applies_to || "WIDTH"}
                            onValueChange={(value) =>
                              updateItem((current) => ({
                                ...current,
                                addons: current.addons.map((row, rowIndex) =>
                                  rowIndex === index
                                    ? {
                                        ...row,
                                        applies_to:
                                          value as OrderItemDraft["addons"][number]["applies_to"],
                                      }
                                    : row,
                                ),
                                savedPreview: null,
                              }))
                            }
                          >
                            <SelectTrigger className="bg-surface-1">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="WIDTH">
                                Per MM - Width
                              </SelectItem>
                              <SelectItem value="HEIGHT">
                                Per MM - Height
                              </SelectItem>
                              <SelectItem value="BOTH">
                                Per MM - Both
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        ) : (
                          <div className="rounded-xl border border-line bg-surface-1 px-3 py-2 text-xs text-content-3">
                            {mode === "FIXED" ? "Fixed Weight" : "Per Piece"}
                          </div>
                        )}
                      </div>
                    </div>
                    {addonMeta ? (
                      <div className="grid gap-2 sm:grid-cols-3">
                        <div className="rounded-xl border border-line bg-surface-1 px-3 py-2 text-xs text-content-3">
                          <span className="font-black uppercase tracking-[0.14em] text-content-4">
                            Code
                          </span>
                          <div className="mt-1 font-semibold text-content-2">
                            {addonMeta.code || "Uncoded"}
                          </div>
                        </div>
                        <div className="rounded-xl border border-line bg-surface-1 px-3 py-2 text-xs text-content-3">
                          <span className="font-black uppercase tracking-[0.14em] text-content-4">
                            Weight Rule
                          </span>
                          <div className="mt-1 font-semibold text-content-2">
                            {String(
                              addonMeta.weight_mode || "PER_PIECE",
                            ).toUpperCase()}
                          </div>
                        </div>
                        <div className="rounded-xl border border-line bg-surface-1 px-3 py-2 text-xs text-content-3">
                          <span className="font-black uppercase tracking-[0.14em] text-content-4">
                            Weight Value
                          </span>
                          <div className="mt-1 font-semibold text-content-2">
                            {asNumber(addonMeta.weight_value, 0).toFixed(4)} g
                          </div>
                        </div>
                      </div>
                    ) : null}
                    <div className="flex justify-end">
                      <Button
                        variant="outline"
                        className="text-danger-fg"
                        onClick={() =>
                          updateItem((current) => ({
                            ...current,
                            addons: current.addons.filter(
                              (_, rowIndex) => rowIndex !== index,
                            ),
                            savedPreview: null,
                          }))
                        }
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-2xl border border-line p-4">
            <div className="flex items-center justify-between">
              <div>
                <Label>POD Reinforcement</Label>
                <p className="text-xs text-content-3">
                  Still stored in the existing POD packaging snapshot.
                </p>
              </div>
              <Switch
                checked={item.packaging_snapshot.pod.enabled}
                onCheckedChange={(checked) =>
                  updateItem((current) => ({
                    ...current,
                    packaging_snapshot: {
                      ...current.packaging_snapshot,
                      pod: {
                        ...current.packaging_snapshot.pod,
                        enabled: checked,
                      },
                    },
                    savedPreview: null,
                  }))
                }
              />
            </div>
            {item.packaging_snapshot.pod.enabled ? (
              <div className="mt-4 space-y-2">
                <Label>POD SKU Variant</Label>
                <Select
                  value={
                    item.packaging_snapshot.pod.pod_sku_variant_id || "__NONE__"
                  }
                  onValueChange={(value) => {
                    const selectedVariant = podProfiles.find(
                      (pod) => String(pod.id) === String(value),
                    );
                    updateItem((current) => ({
                      ...current,
                      packaging_snapshot: {
                        ...current.packaging_snapshot,
                        pod: {
                          ...current.packaging_snapshot.pod,
                          pod_profile_id:
                            value === "__NONE__"
                              ? ""
                              : String(selectedVariant?.material || ""),
                          pod_sku_variant_id: value === "__NONE__" ? "" : value,
                          pod_sku_code:
                            value === "__NONE__"
                              ? ""
                              : String(selectedVariant?.pod_sku_code || ""),
                          pod_sku_name:
                            value === "__NONE__"
                              ? ""
                              : String(selectedVariant?.pod_sku_name || ""),
                        },
                      },
                      savedPreview: null,
                    }));
                  }}
                >
                  <SelectTrigger className="bg-surface-1">
                    <SelectValue placeholder="Select POD SKU variant" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__NONE__">
                      Select POD SKU variant
                    </SelectItem>
                    {podProfiles.map((pod) => (
                      <SelectItem key={pod.id} value={String(pod.id)}>
                        {pod.pod_sku_code} · {pod.code} - {pod.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </div>
        </div>
      </Section>

      {!hidePreviewSection ? (
        <Section
          title="Preview & Commercial"
          description="Live weight, BOM, and validation output from the existing preview engine."
          dataTestId="sku-variant-section-preview-commercial"
          defaultOpen
          className="2xl:col-span-2"
        >
          <div className="space-y-4">
            <div className="grid gap-3 rounded-[1.45rem] border border-line bg-surface-2 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_160px_140px]">
              <div className="space-y-2">
                <Label>Preview Quantity</Label>
                <Input
                  type="number"
                  min="0"
                  step={item.finished_good_type === "ROLL" ? "0.01" : "1"}
                  value={String(item.qty_value)}
                  onChange={(event) =>
                    updateItem((current) => ({
                      ...current,
                      qty_value: asNumber(event.target.value, 0),
                      savedPreview: null,
                    }))
                  }
                  className="h-12 rounded-2xl border-line-strong bg-surface-1 font-black"
                />
              </div>
              <div className="space-y-2">
                <Label>Preview UOM</Label>
                {item.finished_good_type === "ROLL" ? (
                  <div className="flex h-12 items-center rounded-2xl border border-line-strong bg-surface-1 px-3 text-sm font-black text-content-2">
                    KG
                  </div>
                ) : (
                  <Select
                    value={item.qty_uom}
                    onValueChange={(value) =>
                      updateItem((current) => ({
                        ...current,
                        qty_uom: value as OrderItemDraft["qty_uom"],
                        price_basis: value as OrderItemDraft["price_basis"],
                        savedPreview: null,
                      }))
                    }
                  >
                    <SelectTrigger className="h-12 rounded-2xl border-line-strong bg-surface-1 font-black">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="KG">KG</SelectItem>
                      <SelectItem value="PCS">PCS</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div className="flex items-end">
                <div className="rounded-2xl border border-line bg-surface-1 px-4 py-3">
                  <div className="text-[10px] font-black uppercase tracking-[0.18em] text-content-4">
                    Previewing for
                  </div>
                  <div className="mt-1 text-sm font-black text-content-1">
                    {asNumber(item.qty_value, 0).toLocaleString("en-IN", {
                      maximumFractionDigits: item.qty_uom === "KG" ? 3 : 0,
                    })}{" "}
                    {item.qty_uom}
                  </div>
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-3 rounded-[1.45rem] border border-line bg-surface-2 px-4 py-4 sm:flex-row sm:items-end sm:justify-between">
              <div className="space-y-2">
                <div className="text-[10px] font-black uppercase tracking-[0.22em] text-content-4">
                  Preview context
                </div>
                <div className="text-sm font-semibold text-content-2">
                  Previewing for{" "}
                  {asNumber(item.qty_value, 0).toLocaleString("en-IN", {
                    maximumFractionDigits: item.qty_uom === "KG" ? 3 : 0,
                  })}{" "}
                  {item.qty_uom}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{item.finished_good_type}</Badge>
                  {item.printing.enabled ? (
                    <Badge variant="outline">{item.printing.type} PRINT</Badge>
                  ) : (
                    <Badge variant="outline">NO PRINT</Badge>
                  )}
                  {item.packaging_snapshot.pod.enabled ? (
                    <Badge variant="outline">POD ENABLED</Badge>
                  ) : null}
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={onPreviewRetry}
                className="sm:self-start"
              >
                Refresh Preview
              </Button>
            </div>
            {previewLoading ? (
              <div className="flex items-center gap-2 rounded-[1.35rem] border border-line bg-surface-1 px-4 py-4 text-sm text-content-3">
                <Loader2 className="h-4 w-4 animate-spin" /> Calculating
                preview...
              </div>
            ) : previewError ? (
              <div className="rounded-[1.35rem] border border-danger-border bg-danger-bg px-4 py-4 text-sm text-danger-fg">
                {previewError}
              </div>
            ) : item.savedPreview ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  <Card className="border-line bg-surface-1/95 shadow-[0_12px_30px_-28px_rgba(15,23,42,0.32)]">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-xs font-black uppercase tracking-[0.16em] text-content-3">
                        Unit Weight
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-black text-content-1">
                        {item.finished_good_type === "ROLL"
                          ? `${asNumber(item.savedPreview.roll_preview?.weight_kg, item.savedPreview.total_weight_kg).toFixed(2)} KG`
                          : `${asNumber(item.savedPreview.unit_weight_g, 0).toFixed(3)} g`}
                      </div>
                    </CardContent>
                  </Card>
                  <Card className="border-line bg-surface-1/95 shadow-[0_12px_30px_-28px_rgba(15,23,42,0.32)]">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-xs font-black uppercase tracking-[0.16em] text-content-3">
                        Total Weight
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-black text-content-1">
                        {asNumber(item.savedPreview.total_weight_kg, 0).toFixed(
                          3,
                        )}{" "}
                        KG
                      </div>
                    </CardContent>
                  </Card>
                  {item.finished_good_type === "POUCH" ? (
                    <Card className="border-line bg-surface-1/95 shadow-[0_12px_30px_-28px_rgba(15,23,42,0.32)]">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-xs font-black uppercase tracking-[0.16em] text-content-3">
                          Effective Geometry
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2">
                        <div className="text-sm font-black text-content-1">
                          {asNumber(
                            previewGeometry?.effective_width_mm,
                            0,
                          ).toFixed(1)}{" "}
                          W ×{" "}
                          {asNumber(
                            previewGeometry?.effective_height_mm,
                            0,
                          ).toFixed(1)}{" "}
                          H
                        </div>
                        <div className="text-xs text-content-3">
                          Style{" "}
                          {lockedPouchStyle
                            ? lockedPouchStyle.replaceAll("_", " ")
                            : "Template pending"}{" "}
                          · Area{" "}
                          {asNumber(previewGeometry?.area_m2, 0).toFixed(4)} m²
                        </div>
                      </CardContent>
                    </Card>
                  ) : null}
                  {item.finished_good_type === "POUCH" ? (
                    <Card className="border-line bg-surface-1/95 shadow-[0_12px_30px_-28px_rgba(15,23,42,0.32)]">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-xs font-black uppercase tracking-[0.16em] text-content-3">
                          Add-on / POD Mass
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-1 text-sm text-content-2">
                        <div className="flex items-center justify-between">
                          <span>Add-ons</span>
                          <span className="font-black text-content-1">
                            {previewAddonKg.toFixed(4)} KG
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>POD</span>
                          <span className="font-black text-content-1">
                            {previewPodKg.toFixed(4)} KG
                          </span>
                        </div>
                      </CardContent>
                    </Card>
                  ) : null}
                </div>
                <Card className="border-line bg-surface-1/95 shadow-[0_12px_30px_-28px_rgba(15,23,42,0.32)]">
                  <CardHeader>
                    <CardTitle className="text-sm font-black">
                      BOM Snapshot
                    </CardTitle>
                    <CardDescription>
                      Theoretical material issue generated from the current
                      order snapshot.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {(item.savedPreview.bom_preview?.components || [])
                      .length === 0 ? (
                      <div className="text-sm text-content-3">
                        No BOM components resolved yet.
                      </div>
                    ) : (
                      item.savedPreview.bom_preview.components.map(
                        (component, index) => (
                          <div
                            key={`${component.material_name}-${index}`}
                            className="flex items-center justify-between rounded-xl border border-line px-3 py-2 text-sm"
                          >
                            <span className="font-medium text-content-2">
                              {component.material_name}
                            </span>
                            <span className="font-bold text-content-1">
                              {component.qty} {component.uom}
                            </span>
                          </div>
                        ),
                      )
                    )}
                  </CardContent>
                </Card>
              </>
            ) : (
              <div className="rounded-2xl border border-dashed border-line px-4 py-8 text-sm text-content-3">
                Preview will appear once the item has enough data.
              </div>
            )}
          </div>
        </Section>
      ) : null}
    </div>
  );
}

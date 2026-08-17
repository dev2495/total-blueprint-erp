"use client";

import { useForm, useFieldArray, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ExtrusionRecipe, recipeService } from "@/services/recipes";
import { filmVariantService } from "@/services/film-variants";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { GitCompareArrows, History, Loader2, Plus, RefreshCw, ShieldCheck, Snowflake, Trash2 } from "lucide-react";
import { api } from "@/lib/api";

const useGranules = () => {
  return useQuery({
    queryKey: ["granules"],
    queryFn: async () => {
      const { data } = await api.get("/api/master/granules/");
      return data as {
        id: string;
        name: string;
        code: string;
        quality_code_count?: number;
        quality_codes?: Array<{ id: string; code: string; status: string }>;
      }[];
    },
  });
};

const roundPercentage = (value: number) =>
  Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;

const normalizeRecipePayload = (data: z.infer<typeof formSchema>) => {
  const components = data.components.map((component) => ({
    ...component,
    percentage: roundPercentage(component.percentage),
  }));
  const total = roundPercentage(
    components.reduce((acc, item) => acc + item.percentage, 0),
  );
  const delta = roundPercentage(100 - total);
  if (components.length > 0 && Math.abs(delta) <= 0.05) {
    const lastIndex = components.length - 1;
    components[lastIndex] = {
      ...components[lastIndex],
      percentage: roundPercentage(components[lastIndex].percentage + delta),
    };
  }
  return { ...data, components };
};

const formSchema = z.object({
  film_variant: z.string().min(1, "Variant is required"),
  grade: z.string().min(1, "Grade is required"),
  thickness_min_micron: z.coerce
    .number()
    .min(1, "Min thickness must be positive"),
  thickness_max_micron: z.coerce
    .number()
    .min(1, "Max thickness must be positive"),
  components: z
    .array(
      z.object({
        granule: z.string().min(1, "Granule is required"),
        percentage: z.coerce.number().min(0).max(100),
      }),
    )
    .min(1, "At least one component is required")
    .refine(
      (items) => {
        const total = roundPercentage(
          items.reduce(
            (acc, item) => acc + roundPercentage(item.percentage),
            0,
          ),
        );
        return Math.abs(total - 100) <= 0.05;
      },
      { message: "Total percentage must be 100.00%" },
    ),
  change_reason: z.string().max(255, "Keep the change reason under 255 characters").optional(),
});

interface RecipeFormProps {
  initialData?: ExtrusionRecipe;
  onSubmit: (data: z.infer<typeof formSchema>) => void;
  isLoading?: boolean;
  submitError?: string | null;
}

export function RecipeForm({
  initialData,
  onSubmit,
  isLoading,
  submitError,
}: RecipeFormProps) {
  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      film_variant: "",
      grade: "",
      thickness_min_micron: 20,
      thickness_max_micron: 100,
      components: [{ granule: "", percentage: 100 }],
      change_reason: "",
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: "components",
  });
  const watchedComponents =
    useWatch({
      control: form.control,
      name: "components",
    }) || [];
  const watchedContract = useWatch({
    control: form.control,
  });
  const percentageTotal = roundPercentage(
    watchedComponents.reduce(
      (acc, curr) => acc + roundPercentage(Number(curr?.percentage) || 0),
      0,
    ),
  );
  const percentageRemaining = roundPercentage(100 - percentageTotal);
  const totalWithinTolerance = Math.abs(percentageRemaining) <= 0.05;
  const originalComponents = initialData?.components || [];
  const addedFamilies = watchedComponents.filter((row) => row?.granule && !originalComponents.some((item) => String(item.granule) === String(row.granule))).length;
  const removedFamilies = originalComponents.filter((item) => !watchedComponents.some((row) => String(row?.granule) === String(item.granule))).length;
  const changedFamilies = watchedComponents.filter((row) => {
    const previous = originalComponents.find((item) => String(item.granule) === String(row?.granule));
    return previous && roundPercentage(Number(previous.percentage || 0)) !== roundPercentage(Number(row?.percentage || 0));
  }).length;
  const componentsError =
    form.formState.errors.components?.root?.message ||
    form.formState.errors.components?.message;
  const formLevelError =
    typeof form.formState.errors.root?.message === "string"
      ? form.formState.errors.root.message
      : null;

  // Data Queries
  const { data: variants } = useQuery({
    queryKey: ["film-variants"],
    queryFn: filmVariantService.getAll,
  });

  const { data: grades } = useQuery({
    queryKey: ["recipe-grades"],
    queryFn: () => recipeService.getGrades(),
  });

  const { data: granules } = useGranules();

  // Filter extrudable variants
  const extrudableVariants = variants?.filter((v) => v.is_extrudable) || [];

  // Effects
  useEffect(() => {
    if (initialData) {
      form.reset({
        film_variant: initialData.film_variant,
        grade: initialData.grade,
        thickness_min_micron: initialData.thickness_min_micron,
        thickness_max_micron: initialData.thickness_max_micron,
        components: initialData.components.map((c) => ({
          granule: c.granule,
          percentage: c.percentage,
        })),
        change_reason: "",
      });
    }
  }, [initialData, form]);

  const { data: impact, isFetching: impactLoading } = useQuery({
    queryKey: [
      "recipe-impact",
      initialData?.id,
      watchedContract.film_variant,
      watchedContract.grade,
      watchedContract.thickness_min_micron,
      watchedContract.thickness_max_micron,
    ],
    queryFn: () => recipeService.impact(initialData!.id, {
      film_variant: String(watchedContract.film_variant || ""),
      grade: String(watchedContract.grade || ""),
      thickness_min_micron: Number(watchedContract.thickness_min_micron || 0),
      thickness_max_micron: Number(watchedContract.thickness_max_micron || 0),
      components: [],
    }),
    enabled: Boolean(
      initialData?.id &&
      watchedContract.film_variant &&
      watchedContract.grade &&
      watchedContract.thickness_min_micron &&
      watchedContract.thickness_max_micron,
    ),
    staleTime: 15_000,
  });

  const balanceRecipeToHundred = () => {
    const current = form.getValues("components");
    if (!current.length) return;
    const total = roundPercentage(
      current.reduce(
        (acc, item) => acc + roundPercentage(Number(item?.percentage) || 0),
        0,
      ),
    );
    const delta = roundPercentage(100 - total);
    const lastIndex = current.length - 1;
    const currentValue = roundPercentage(
      Number(current[lastIndex]?.percentage) || 0,
    );
    form.setValue(
      `components.${lastIndex}.percentage`,
      roundPercentage(currentValue + delta),
      {
        shouldDirty: true,
        shouldTouch: true,
        shouldValidate: true,
      },
    );
  };

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(
          (data) => {
            if (initialData && !String(data.change_reason || "").trim()) {
              form.setError("change_reason", { message: "Add a short reason so this recipe revision is auditable." });
              return;
            }
            onSubmit(normalizeRecipePayload(data));
          },
          async () => {
            await form.trigger();
          },
        )}
        className="space-y-4"
      >
        {initialData ? (
          <div className="overflow-hidden rounded-2xl border border-primary/20 bg-info-bg/40">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-primary/10 px-4 py-3">
              <div>
                <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.16em] text-primary">
                  <GitCompareArrows className="h-3.5 w-3.5" /> Exact recipe contract
                </div>
                <div className="mt-1 text-base font-black text-content-1">
                  {initialData.film_variant_name} · {initialData.grade_name} · {initialData.thickness_min_micron}–{initialData.thickness_max_micron} μ
                </div>
                <p className="mt-1 text-xs font-medium text-content-3">
                  Only order layers matching this variant, grade and thickness range are affected.
                </p>
              </div>
              <div className="rounded-xl border border-primary/15 bg-surface-1 px-3 py-2 text-right">
                <div className="text-[10px] font-black uppercase tracking-wider text-content-4">Current revision</div>
                <div className="font-mono text-lg font-black tabular-nums text-primary">v{initialData.revision_no || 1}</div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-px bg-primary/10 sm:grid-cols-4">
              {[
                { label: "Matching lines", value: impact?.matched_total ?? "—", icon: History },
                { label: "Will refresh", value: impact?.refreshable ?? "—", icon: RefreshCw },
                { label: "Stay frozen", value: impact?.frozen ?? "—", icon: Snowflake },
                { label: "Released", value: impact?.released ?? "—", icon: ShieldCheck },
              ].map((metric) => (
                <div key={metric.label} className="bg-surface-1 px-3 py-2.5">
                  <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider text-content-4">
                    <metric.icon className="h-3.5 w-3.5" /> {metric.label}
                  </div>
                  <div className="mt-1 font-mono text-lg font-black tabular-nums text-content-1">
                    {impactLoading ? "…" : metric.value}
                  </div>
                </div>
              ))}
            </div>
            {impact?.samples?.length ? (
              <div className="border-t border-primary/10 bg-surface-1 px-4 py-3">
                <div className="mb-2 text-[10px] font-black uppercase tracking-wider text-content-4">Recent matching order lines</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {impact.samples.slice(0, 4).map((sample) => (
                    <div key={sample.line_id} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface-2 px-3 py-2">
                      <div>
                        <div className="font-mono text-xs font-black text-content-1">{sample.order_number}</div>
                        <div className="text-[10px] font-semibold text-content-4">{sample.line_status || sample.order_status}</div>
                      </div>
                      <span className={`rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-wider ${sample.outcome === "FROZEN" ? "bg-info-bg text-primary" : "bg-success-bg text-success-fg"}`}>
                        {sample.outcome === "FROZEN" ? "Keeps old recipe" : "Will refresh"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="grid grid-cols-2 gap-4">
          <FormField
            control={form.control}
            name="film_variant"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Film Variant</FormLabel>
                <Select
                  onValueChange={field.onChange}
                  defaultValue={field.value}
                  value={field.value}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select extrudable variant" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {extrudableVariants.map((v) => (
                      <SelectItem key={v.id} value={String(v.id)}>
                        {v.name} ({v.code})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="grade"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Grade</FormLabel>
                <Select
                  onValueChange={field.onChange}
                  defaultValue={field.value}
                  value={field.value}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select grade" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {grades?.map((g) => (
                      <SelectItem key={g.id} value={String(g.id)}>
                        {g.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="flex gap-4">
          <FormField
            control={form.control}
            name="thickness_min_micron"
            render={({ field }) => (
              <FormItem className="flex-1">
                <FormLabel>Min Thickness (μ)</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    {...field}
                    value={field.value as number}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="thickness_max_micron"
            render={({ field }) => (
              <FormItem className="flex-1">
                <FormLabel>Max Thickness (μ)</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    {...field}
                    value={field.value as number}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="overflow-hidden rounded-2xl border border-line bg-surface-2">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line bg-surface-1 px-4 py-3">
            <div>
              <h3 className="text-sm font-black text-content-1">Family formulation</h3>
              <p className="mt-1 max-w-xl text-xs font-medium text-content-3">
                Define consumption by granule family. WCM chooses one or more internal grade codes and source stores before machine release.
              </p>
              {initialData ? (
                <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] font-black uppercase tracking-wider">
                  <span className="rounded-full bg-success-bg px-2 py-1 text-success-fg">{addedFamilies} added</span>
                  <span className="rounded-full bg-warning-bg px-2 py-1 text-warning-fg">{changedFamilies} changed</span>
                  <span className="rounded-full bg-surface-3 px-2 py-1 text-content-3">{removedFamilies} removed</span>
                </div>
              ) : null}
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={balanceRecipeToHundred}
              >
                Balance to 100%
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => append({ granule: "", percentage: 0 })}
              >
                <Plus className="h-4 w-4 mr-2" /> Add family row
              </Button>
            </div>
          </div>

          <div className="space-y-2 p-4">
          {fields.map((field, index) => (
            <div key={field.id} className="grid items-start gap-2 rounded-xl border border-line bg-surface-1 p-2.5 md:grid-cols-[minmax(0,1fr)_120px_40px]">
              <FormField
                control={form.control}
                name={`components.${index}.granule`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className={index !== 0 ? "sr-only" : ""}>
                      Granule family
                    </FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                      value={field.value}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select granule family" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {granules?.map((g) => (
                          <SelectItem key={g.id} value={String(g.id)}>
                            {g.name} ({g.code})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {field.value ? (() => {
                      const selected = granules?.find((item) => String(item.id) === String(field.value));
                      const codeCount = selected?.quality_code_count ?? selected?.quality_codes?.filter((code) => code.status === "ACTIVE").length ?? 0;
                      return selected ? (
                        <div className="flex flex-wrap items-center gap-2 px-1 text-[11px] font-semibold text-content-3">
                          <span>{selected.code} · {codeCount} active internal grade code{codeCount === 1 ? "" : "s"} available for WCM allocation</span>
                          {initialData ? (() => {
                            const previous = initialData.components.find((component) => String(component.granule) === String(field.value));
                            const next = Number(watchedComponents[index]?.percentage || 0);
                            if (!previous) return <span className="rounded-full bg-success-bg px-2 py-0.5 text-success-fg">New family</span>;
                            const delta = roundPercentage(next - Number(previous.percentage || 0));
                            if (!delta) return null;
                            return <span className="rounded-full bg-warning-bg px-2 py-0.5 text-warning-fg">{delta > 0 ? "+" : ""}{delta.toFixed(2)}%</span>;
                          })() : null}
                        </div>
                      ) : null;
                    })() : null}
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name={`components.${index}.percentage`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className={index !== 0 ? "sr-only" : ""}>
                      Recipe %
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        step="0.01"
                        {...field}
                        value={field.value as number}
                        onChange={(e) =>
                          field.onChange(parseFloat(e.target.value) || 0)
                        }
                        onBlur={(event) =>
                          field.onChange(
                            roundPercentage(
                              parseFloat(event.target.value) || 0,
                            ),
                          )
                        }
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="mt-6 text-destructive"
                onClick={() => remove(index)}
                disabled={fields.length === 1}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          </div>
          {(componentsError || formLevelError || submitError) && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm font-medium text-destructive">
              {submitError || componentsError || formLevelError}
            </div>
          )}
          <div className="mx-4 mb-4 flex items-center justify-between rounded-xl border border-line bg-surface-1 px-3 py-2 text-sm">
            <div className="text-content-3">
              {totalWithinTolerance
                ? "Recipe will auto-balance the last component to land exactly at 100.00%."
                : "Use Balance To 100 or adjust the last row until the remaining value reaches zero."}
            </div>
            <div className="text-right font-semibold text-content-1">
              <div>Total: {percentageTotal.toFixed(2)}%</div>
              <div
                className={
                  totalWithinTolerance ? "text-success-fg" : "text-warning-fg"
                }
              >
                Remaining: {percentageRemaining.toFixed(2)}%
              </div>
            </div>
          </div>
        </div>

        {initialData ? (
          <FormField
            control={form.control}
            name="change_reason"
            render={({ field }) => (
              <FormItem className="rounded-2xl border border-line bg-surface-2 p-4">
                <FormLabel className="flex items-center gap-2 text-sm font-black text-content-1">
                  <History className="h-4 w-4 text-primary" /> Revision reason
                </FormLabel>
                <FormControl>
                  <Textarea
                    {...field}
                    value={field.value || ""}
                    rows={2}
                    placeholder="Example: Split 0.40% master batch into PPA, slip and brightener families"
                  />
                </FormControl>
                <p className="text-xs font-medium text-content-3">
                  Saved with the immutable recipe revision. Released jobs remain on their original formulation.
                </p>
                <FormMessage />
              </FormItem>
            )}
          />
        ) : null}

        <div className="flex justify-end gap-2">
          <Button type="submit" disabled={isLoading || !totalWithinTolerance}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {initialData ? `Publish revision v${(initialData.revision_no || 1) + 1}` : "Save family recipe"}
          </Button>
        </div>
      </form>
    </Form>
  );
}

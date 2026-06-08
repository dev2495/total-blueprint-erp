"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";
import {
  Bookmark,
  BookmarkPlus,
  ChevronDown,
  Layers3,
  PackageCheck,
  Ruler,
  Sparkles,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { normalizeProductSpec, type ProductSpec } from "@/lib/product-spec";
import { type SalesSku, type SalesSkuVariant } from "@/services/sales";
import { formatDisplayDate } from "@/lib/date-format";

export type SalesSavedViewScope =
  | "orders"
  | "sku_catalog"
  | "order_create"
  | "planner_queue"
  | "planner_sku";
export type SalesSavedViewFilters = Record<
  string,
  string | number | boolean | null | undefined
>;

type SalesSavedView = {
  id: string;
  name: string;
  filters: SalesSavedViewFilters;
  createdAt: string;
  updatedAt: string;
  starter?: boolean;
};

type StarterView = {
  name: string;
  filters: SalesSavedViewFilters;
  count?: number;
};

const CHIP_CLASS: Record<string, string> = {
  fgRoll: "border-danger-border bg-danger-bg text-danger-fg",
  fgPouch: "border-warning-border bg-warning-bg text-warning-fg",
  size: "border-info-border bg-info-bg text-info-fg",
  thickness: "border-info-border bg-info-bg text-primary",
  material: "border-info-border bg-info-bg text-primary",
  grade: "border-success-border bg-success-bg text-success-fg",
  print: "border-danger-border bg-danger-bg text-danger-fg",
  template: "border-info-border bg-info-bg text-primary",
  pack: "border-success-border bg-success-bg text-success-fg",
  muted: "border-line bg-surface-2 text-content-3",
};

export type SalesSpecChipTone = keyof typeof CHIP_CLASS;

export type SalesOverflowChipOption = {
  value: string;
  label: string;
  count?: number;
  tone?: SalesSpecChipTone;
};

export const SALES_SUPPORTED_FG_TYPES = ["ROLL", "POUCH"] as const;
export const SALES_MATERIAL_PRIORITY = [
  "PET",
  "PE",
  "LDPE",
  "LLDPE",
  "HDPE",
  "POLYESTER",
  "CPP",
  "BOPP",
  "PP",
  "METALLOCENE",
  "NYLON",
];
export const SALES_GRADE_PRIORITY = [
  "GP",
  "SP",
  "MET10",
  "METALLOCENE",
  "SLIP",
  "NON-SLIP",
  "SURFACE",
  "REVERSE",
];

export function salesMaterialFilterLabel(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const upper = raw.toUpperCase();
  const priorityHit = SALES_MATERIAL_PRIORITY.find((candidate) =>
    new RegExp(`(^|[^A-Z0-9])${candidate}([^A-Z0-9]|$)`).test(upper),
  );
  if (priorityHit) return priorityHit;
  return raw;
}

export function salesSpecMaterialLabels(spec: ProductSpec) {
  return salesUniqueText(
    spec.layers.flatMap((layer) => [
      salesMaterialFilterLabel(layer.variantName),
      salesMaterialFilterLabel(layer.variantCode),
      salesMaterialFilterLabel(layer.label),
    ]),
  );
}

export function salesSpecMatchesMaterialFilter(
  spec: ProductSpec,
  value?: string,
) {
  const normalized = salesMaterialFilterLabel(value);
  if (!normalized) return true;
  const q = normalized.toLowerCase();
  const labels = salesSpecMaterialLabels(spec);
  if (labels.some((label) => label.toLowerCase() === q)) return true;
  return labels.some((label) => {
    const lowered = label.toLowerCase();
    if (lowered.length <= 3 || q.length <= 3) return lowered === q;
    return lowered.includes(q) || q.includes(lowered);
  });
}

export function salesUniqueText(
  values: Array<string | number | null | undefined>,
) {
  return Array.from(
    new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean)),
  );
}

export function salesSortChipOptions(
  options: SalesOverflowChipOption[],
  priority: string[] = [],
) {
  const byValue = new Map<string, SalesOverflowChipOption>();
  options.forEach((option) => {
    if (!option.value || !option.label) return;
    const key = option.value.toLowerCase();
    const current = byValue.get(key);
    if (!current || Number(option.count || 0) > Number(current.count || 0))
      byValue.set(key, option);
  });
  return Array.from(byValue.values()).sort((left, right) => {
    const countDelta = Number(right.count || 0) - Number(left.count || 0);
    if (countDelta !== 0) return countDelta;
    const leftIndex = priority.indexOf(left.value.toUpperCase());
    const rightIndex = priority.indexOf(right.value.toUpperCase());
    if (leftIndex !== -1 || rightIndex !== -1)
      return (
        (leftIndex === -1 ? 999 : leftIndex) -
        (rightIndex === -1 ? 999 : rightIndex)
      );
    return left.label.localeCompare(right.label);
  });
}

function salesSavedViewsKey(scope: SalesSavedViewScope) {
  return `total-poly-print.sales.saved-views.${scope}`;
}

function makeSavedViewId() {
  return `sales-view-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function safeLoadSavedViews(scope: SalesSavedViewScope): SalesSavedView[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(salesSavedViewsKey(scope));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((view): view is SalesSavedView =>
        Boolean(view?.id && view?.name && view?.filters),
      )
      .slice(0, 40);
  } catch {
    return [];
  }
}

function safeSaveSavedViews(
  scope: SalesSavedViewScope,
  views: SalesSavedView[],
) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      salesSavedViewsKey(scope),
      JSON.stringify(views.slice(0, 40)),
    );
  } catch {
    // Browser storage can be unavailable in private or restricted contexts.
  }
}

function defaultStarterViews(scope: SalesSavedViewScope): StarterView[] {
  if (scope === "orders") {
    return [
      {
        name: "My active queue",
        filters: { tab: "queue", statusFilter: "ALL" },
      },
      {
        name: "Awaiting planning",
        filters: { tab: "queue", statusFilter: "PLANNING_REQUIRED" },
      },
      {
        name: "This week's deliveries",
        filters: { tab: "queue", deliveryWindow: "THIS_WEEK" },
      },
      { name: "Overdue", filters: { tab: "queue", deliveryWindow: "OVERDUE" } },
      {
        name: "LDPE rolls",
        filters: { fgTypeFilter: "ROLL", materialFilter: "LDPE" },
      },
      {
        name: "Pouches this week",
        filters: { fgTypeFilter: "POUCH", deliveryWindow: "THIS_WEEK" },
      },
    ];
  }
  if (scope === "sku_catalog") {
    return [
      {
        name: "Active rolls",
        filters: { activeFilter: "active", fgTypeFilter: "ROLL" },
      },
      {
        name: "Active pouches",
        filters: { activeFilter: "active", fgTypeFilter: "POUCH" },
      },
      { name: "Customer-proven", filters: { usageOnly: true } },
      {
        name: "All live templates",
        filters: { activeFilter: "active", templateFilter: "all" },
      },
    ];
  }
  if (scope === "planner_queue") {
    return [
      {
        name: "My planning queue",
        filters: { activeTab: "planning", queueFilter: "ALL" },
      },
      {
        name: "Ready to release",
        filters: { activeTab: "planning", queueFilter: "READY" },
      },
      {
        name: "Artwork blocked",
        filters: { activeTab: "planning", queueFilter: "ARTWORK_GATE" },
      },
      {
        name: "FG direct",
        filters: { activeTab: "planning", sourcePathFilter: "FG" },
      },
      {
        name: "WIP convertible",
        filters: { activeTab: "planning", sourcePathFilter: "WIP" },
      },
    ];
  }
  if (scope === "planner_sku") {
    return [
      { name: "Active presets", filters: { launchFilter: "ALL" } },
      { name: "Final roll / pouch", filters: { launchFilter: "FINAL_ROLL" } },
      {
        name: "Invariant rolls",
        filters: { launchFilter: "SHARED_INVARIANT_ROLL" },
      },
      { name: "POD stock", filters: { launchFilter: "POD_STOCK" } },
      { name: "Packaging stock", filters: { launchFilter: "PACKAGING_STOCK" } },
    ];
  }
  return [
    { name: "Top SKU lane", filters: { fgTypeFilter: "all" } },
    { name: "Roll orders", filters: { fgTypeFilter: "ROLL" } },
    { name: "Pouch orders", filters: { fgTypeFilter: "POUCH" } },
    { name: "LDPE work", filters: { variantFilter: "LDPE" } },
  ];
}

function filterSignature(filters: SalesSavedViewFilters) {
  return JSON.stringify(
    Object.entries(filters)
      .filter(
        ([, value]) =>
          value !== "" &&
          value !== "all" &&
          value !== "ALL" &&
          value !== false &&
          value !== null &&
          value !== undefined,
      )
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

function summarizeFilters(filters: SalesSavedViewFilters) {
  const active = Object.entries(filters)
    .filter(
      ([, value]) =>
        value !== "" &&
        value !== "all" &&
        value !== "ALL" &&
        value !== false &&
        value !== null &&
        value !== undefined,
    )
    .slice(0, 4)
    .map(([key, value]) => `${key.replace(/Filter$/, "")}: ${String(value)}`);
  return active.length ? active.join(" · ") : "No filters";
}

function compactNumber(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(Number(value)))
    return "";
  const num = Number(value);
  if (Number.isInteger(num)) return String(num);
  return num.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function parseNumberRange(value: string) {
  const raw = value.trim();
  if (!raw) return { min: null as number | null, max: null as number | null };
  const parts = raw
    .split(/[,-]/)
    .map((part) => Number(part.trim()))
    .filter(Number.isFinite);
  if (!parts.length) return { min: null, max: null };
  if (parts.length === 1) return { min: parts[0], max: parts[0] };
  return {
    min: Math.min(parts[0], parts[1]),
    max: Math.max(parts[0], parts[1]),
  };
}

function numberMatchesRange(value: number | null, rangeText: string) {
  const { min, max } = parseNumberRange(rangeText);
  if (min === null && max === null) return true;
  if (value === null) return false;
  if (min !== null && max !== null && min === max)
    return Math.round(value) === Math.round(min);
  if (min !== null && value < min) return false;
  if (max !== null && value > max) return false;
  return true;
}

function uniq(values: Array<string | number | null | undefined>) {
  return Array.from(
    new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean)),
  );
}

function fgChipClass(value: string) {
  const normalized = value.toUpperCase();
  if (normalized === "ROLL") return CHIP_CLASS.fgRoll;
  if (normalized === "POUCH") return CHIP_CLASS.fgPouch;
  return CHIP_CLASS.muted;
}

export function formatSalesMoney(value: unknown) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "₹0";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(num);
}

export function formatSalesDate(value?: string | null) {
  if (!value) return "No date";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return formatDisplayDate(parsed, value);
}

export function salesVariantSpecSource(
  sku: Partial<SalesSku> | null | undefined,
  variant: SalesSkuVariant,
) {
  return {
    product_name:
      [sku?.code, sku?.name].filter(Boolean).join(" · ") ||
      variant.sku_name ||
      variant.name,
    template_name: variant.template_name || sku?.template_name,
    sku_variant_code: variant.code,
    sku_variant_name: variant.name,
    geometry_snapshot: {
      ...(variant.geometry_snapshot || {}),
      finished_good_type: variant.finished_good_type,
      roll_form: variant.roll_form || "",
    },
    layer_snapshot: variant.layer_snapshot || [],
    printing_snapshot: variant.printing_snapshot || {},
    addons_snapshot: variant.addons_snapshot || [],
    packaging_snapshot: variant.packaging_snapshot || {},
  };
}

export function specMatchesFilters(
  spec: ProductSpec,
  filters: {
    fgTypeFilter?: string;
    sizeFilter?: string;
    heightFilter?: string;
    variantFilter?: string;
    gradeFilter?: string;
    thicknessFilter?: string;
  },
) {
  const fgType = String(spec.size.finishedGoodType || "").toUpperCase();
  if (
    filters.fgTypeFilter &&
    filters.fgTypeFilter !== "all" &&
    filters.fgTypeFilter !== "ALL" &&
    fgType !== filters.fgTypeFilter.toUpperCase()
  ) {
    return false;
  }
  if (filters.sizeFilter?.trim()) {
    const q = filters.sizeFilter.trim().toLowerCase();
    const numericMatch =
      numberMatchesRange(spec.size.widthMm, q) ||
      numberMatchesRange(spec.size.heightMm, q);
    if (!numericMatch && !spec.size.label.toLowerCase().includes(q))
      return false;
  }
  if (
    filters.heightFilter?.trim() &&
    !numberMatchesRange(spec.size.heightMm, filters.heightFilter)
  )
    return false;
  if (filters.variantFilter?.trim()) {
    const q = filters.variantFilter.trim().toLowerCase();
    const haystack = [
      spec.variantCode,
      spec.variantName,
      spec.templateName,
      ...spec.layers.flatMap((layer) => [
        layer.variantCode,
        layer.variantName,
        layer.label,
      ]),
    ]
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  if (filters.gradeFilter?.trim()) {
    const q = filters.gradeFilter.trim().toLowerCase();
    if (
      !spec.layers
        .map((layer) => layer.grade)
        .join(" ")
        .toLowerCase()
        .includes(q)
    )
      return false;
  }
  if (filters.thicknessFilter?.trim()) {
    const q = filters.thicknessFilter.trim().toLowerCase();
    const range = parseNumberRange(q);
    const hasNumericRange = range.min !== null || range.max !== null;
    if (
      hasNumericRange &&
      spec.layers.some((layer) => numberMatchesRange(layer.thicknessMicron, q))
    )
      return true;
    const haystack = spec.layers
      .map((layer) => `${compactNumber(layer.thicknessMicron)} ${layer.label}`)
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  return true;
}

export function compactSalesNumber(value: number | null | undefined) {
  return compactNumber(value);
}

export function SalesSpecChip({
  children,
  tone = "muted",
  className,
}: {
  children: ReactNode;
  tone?: SalesSpecChipTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex min-h-7 items-center rounded-full border px-3 py-1 text-[11px] font-black leading-none",
        CHIP_CLASS[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function SalesOverflowChipGroup({
  label,
  options,
  value,
  onChange,
  maxInline = 3,
  allValue = "all",
  allLabel = "All",
  disabled = false,
}: {
  label: string;
  options: SalesOverflowChipOption[];
  value: string;
  onChange: (value: string) => void;
  maxInline?: number;
  allValue?: string;
  allLabel?: string;
  disabled?: boolean;
}) {
  const [optionSearch, setOptionSearch] = useState("");
  const cleanOptions = options.filter((option) => option.value && option.label);
  const selectedOverflow = cleanOptions.find(
    (option) =>
      option.value === value &&
      !cleanOptions
        .slice(0, maxInline)
        .some((inline) => inline.value === option.value),
  );
  const inlineOptions = selectedOverflow
    ? [...cleanOptions.slice(0, Math.max(0, maxInline - 1)), selectedOverflow]
    : cleanOptions.slice(0, maxInline);
  const hiddenOptions = cleanOptions.filter(
    (option) => !inlineOptions.some((inline) => inline.value === option.value),
  );
  const searchedHiddenOptions = hiddenOptions.filter((option) => {
    const query = optionSearch.trim().toLowerCase();
    if (!query) return true;
    return `${option.label} ${option.value}`.toLowerCase().includes(query);
  });
  const hasActiveOption =
    value !== allValue && cleanOptions.some((option) => option.value === value);

  useEffect(() => {
    setOptionSearch("");
  }, [label, hiddenOptions.length]);

  function renderButton(option: SalesOverflowChipOption | null) {
    const optionValue = option?.value || allValue;
    const active = option
      ? value === option.value
      : !hasActiveOption && value === allValue;
    const nextValue = active ? allValue : optionValue;
    const toneClass = option ? CHIP_CLASS[option.tone || "muted"] : "";
    return (
      <button
        key={optionValue}
        type="button"
        disabled={disabled}
        onClick={() => onChange(nextValue)}
        className={cn(
          "inline-flex h-9 shrink-0 items-center gap-2 rounded-full border px-3 text-xs font-black leading-none transition hover:-translate-y-0.5 hover:border-info-border hover:bg-info-bg disabled:pointer-events-none disabled:opacity-50",
          active
            ? "border-primary bg-primary text-white shadow-[0_14px_24px_-18px_rgba(37,99,235,0.7)]"
            : option
              ? toneClass
              : "border-line bg-surface-1 text-content-2",
        )}
      >
        <span className="truncate">{option?.label || allLabel}</span>
        {typeof option?.count === "number" ? (
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px]",
              active
                ? "bg-surface-1/20 text-white"
                : "bg-surface-1/70 text-content-3",
            )}
          >
            {option.count}
          </span>
        ) : null}
      </button>
    );
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <span className="inline-flex h-9 shrink-0 items-center text-[10px] font-black uppercase tracking-[0.2em] text-content-3">
        {label}
      </span>
      {renderButton(null)}
      {inlineOptions.map(renderButton)}
      {hiddenOptions.length ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              disabled={disabled}
              className="h-9 shrink-0 rounded-full bg-surface-1 px-3 text-xs font-black shadow-sm"
            >
              +{hiddenOptions.length} more
              <ChevronDown className="ml-1.5 h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="max-h-[22rem] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border-line p-2"
          >
            <DropdownMenuLabel className="text-[10px] font-black uppercase tracking-[0.18em] text-content-3">
              {label} options
            </DropdownMenuLabel>
            {hiddenOptions.length > 8 ? (
              <div className="px-1 pb-2">
                <Input
                  value={optionSearch}
                  onChange={(event) => setOptionSearch(event.target.value)}
                  placeholder={`Search ${label.toLowerCase()}...`}
                  className="h-9 rounded-xl border-line bg-surface-2 text-xs font-semibold"
                />
              </div>
            ) : null}
            {searchedHiddenOptions.map((option) => (
              <DropdownMenuItem
                key={option.value}
                className="rounded-xl p-3"
                onClick={() =>
                  onChange(value === option.value ? allValue : option.value)
                }
              >
                <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
                  <span
                    className={cn(
                      "truncate rounded-full border px-3 py-1 text-xs font-black",
                      CHIP_CLASS[option.tone || "muted"],
                    )}
                  >
                    {option.label}
                  </span>
                  {typeof option.count === "number" ? (
                    <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-black text-content-3">
                      {option.count}
                    </span>
                  ) : null}
                </div>
              </DropdownMenuItem>
            ))}
            {!searchedHiddenOptions.length ? (
              <div className="px-3 py-5 text-center text-xs font-semibold text-content-3">
                No {label.toLowerCase()} options match.
              </div>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

export function SalesSmartRangeFilter({
  label,
  value,
  onChange,
  placeholder,
  suffix,
  presets = [],
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  suffix?: string;
  presets?: Array<{ label: string; value: string; count?: number }>;
  className?: string;
}) {
  const cleanPresets = presets
    .filter((preset) => preset.value && preset.label)
    .slice(0, 18);
  const activePreset = cleanPresets.find((preset) => preset.value === value);
  return (
    <label
      className={cn(
        "inline-flex h-9 min-w-[9.5rem] shrink-0 items-center gap-2 rounded-full border border-line bg-surface-1 px-3 text-xs font-black text-content-2 transition focus-within:border-primary focus-within:ring-4 focus-within:ring-info-border",
        activePreset && "border-info-border bg-info-bg",
        className,
      )}
    >
      <span className="shrink-0 text-[10px] uppercase tracking-[0.16em] text-content-4">
        {label}
      </span>
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="h-6 min-w-0 flex-1 border-0 bg-transparent p-0 text-center text-xs font-black shadow-none focus-visible:ring-0"
      />
      {suffix ? (
        <span className="shrink-0 text-[10px] text-content-4">{suffix}</span>
      ) : null}
      {cleanPresets.length ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`${label} presets`}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line bg-surface-1 text-content-3 hover:border-info-border hover:text-primary"
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="max-h-[20rem] w-[min(18rem,calc(100vw-2rem))] overflow-y-auto rounded-2xl border-line p-2"
          >
            <DropdownMenuLabel className="text-[10px] font-black uppercase tracking-[0.18em] text-content-3">
              {label} presets
            </DropdownMenuLabel>
            <DropdownMenuItem
              className="rounded-xl p-3"
              onClick={() => onChange("")}
            >
              <div className="font-black text-content-1">
                Any {label.toLowerCase()}
              </div>
            </DropdownMenuItem>
            {cleanPresets.map((preset) => (
              <DropdownMenuItem
                key={`${label}-${preset.value}`}
                className="rounded-xl p-3"
                onClick={() => onChange(preset.value)}
              >
                <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
                  <span className="truncate font-black text-content-1">
                    {preset.label}
                  </span>
                  {typeof preset.count === "number" ? (
                    <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-black text-content-3">
                      {preset.count}
                    </span>
                  ) : null}
                </div>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </label>
  );
}

export function SalesSpecChips({
  spec,
  fgType,
  printingLabel,
  compact = false,
  maxAddonLabels = 2,
}: {
  spec: ProductSpec;
  fgType?: string;
  printingLabel?: string;
  compact?: boolean;
  maxAddonLabels?: number;
}) {
  const resolvedFgType = String(
    spec.size.finishedGoodType || fgType || "",
  ).toUpperCase();
  const thicknesses = uniq(
    spec.layers
      .map((layer) => layer.thicknessMicron)
      .filter((value) => value !== null)
      .map((value) => `${compactNumber(value)}μ`),
  );
  const materials = uniq(
    spec.layers.map((layer) => layer.variantName || layer.variantCode),
  );
  const grades = uniq(spec.layers.map((layer) => layer.grade));
  const print =
    printingLabel ||
    spec.podLabels.find((label) => /print|flexo|roto|color/i.test(label)) ||
    "";

  return (
    <div className={cn("flex flex-wrap gap-2", compact && "gap-1.5")}>
      {resolvedFgType ? (
        <span
          className={cn(
            "inline-flex min-h-7 items-center rounded-full border px-3 py-1 text-[11px] font-black leading-none",
            fgChipClass(resolvedFgType),
          )}
        >
          {resolvedFgType}
        </span>
      ) : null}
      <SalesSpecChip tone="size">
        <Ruler className="mr-1.5 h-3.5 w-3.5" />
        {spec.size.label}
      </SalesSpecChip>
      {thicknesses.length ? (
        <SalesSpecChip tone="thickness">
          {thicknesses.join(" + ")}
        </SalesSpecChip>
      ) : (
        <SalesSpecChip tone="muted">Thickness —</SalesSpecChip>
      )}
      {materials.slice(0, compact ? 1 : 3).map((label) => (
        <SalesSpecChip key={`mat-${label}`} tone="material">
          {label}
        </SalesSpecChip>
      ))}
      {materials.length > (compact ? 1 : 3) ? (
        <SalesSpecChip tone="material">
          +{materials.length - (compact ? 1 : 3)} materials
        </SalesSpecChip>
      ) : null}
      {grades.length ? (
        grades.slice(0, compact ? 1 : 3).map((label) => (
          <SalesSpecChip key={`grade-${label}`} tone="grade">
            Grade {label}
          </SalesSpecChip>
        ))
      ) : (
        <SalesSpecChip tone="muted">Grade —</SalesSpecChip>
      )}
      {print ? (
        <SalesSpecChip tone="print">{print}</SalesSpecChip>
      ) : (
        <SalesSpecChip tone="print">No print</SalesSpecChip>
      )}
      {spec.templateName ? (
        <SalesSpecChip tone="template">{spec.templateName}</SalesSpecChip>
      ) : null}
      {spec.hasPod ? (
        spec.podLabels
          .filter((label) => !/print|flexo|roto|color/i.test(label))
          .slice(0, 2)
          .map((label) => (
            <SalesSpecChip key={`pod-${label}`} tone="pack">
              POD {label}
            </SalesSpecChip>
          ))
      ) : (
        <SalesSpecChip tone="muted">No POD</SalesSpecChip>
      )}
      {spec.hasAddons ? (
        spec.addonLabels.slice(0, maxAddonLabels).map((label) => (
          <SalesSpecChip key={`addon-${label}`} tone="pack">
            {label}
          </SalesSpecChip>
        ))
      ) : (
        <SalesSpecChip tone="muted">No add-ons</SalesSpecChip>
      )}
    </div>
  );
}

export function SalesLayerTable({
  spec,
  dense = false,
  className,
}: {
  spec: ProductSpec;
  dense?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-line bg-surface-1",
        className,
      )}
    >
      <div className="grid grid-cols-[3rem_minmax(0,1.35fr)_0.7fr_0.85fr_0.7fr] border-b border-line bg-surface-2 px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-content-3">
        <div>#</div>
        <div>Layer variant</div>
        <div>Grade</div>
        <div>Thickness</div>
        <div>Width</div>
      </div>
      {spec.layers.length ? (
        spec.layers.map((layer) => (
          <div
            key={`${layer.index}-${layer.label}`}
            className={cn(
              "grid grid-cols-[3rem_minmax(0,1.35fr)_0.7fr_0.85fr_0.7fr] items-center gap-0 border-b border-line px-3 last:border-b-0",
              dense ? "py-2 text-xs" : "py-3 text-sm",
            )}
          >
            <div className="font-black text-content-4">L{layer.index}</div>
            <div className="min-w-0">
              <div className="truncate font-black text-content-1">
                {layer.variantName ||
                  layer.variantCode ||
                  `Layer ${layer.index}`}
              </div>
              {layer.variantCode && layer.variantCode !== layer.variantName ? (
                <div className="mt-0.5 truncate text-[11px] font-semibold text-content-3">
                  {layer.variantCode}
                </div>
              ) : null}
            </div>
            <div className="font-bold text-success-fg">
              {layer.grade || "—"}
            </div>
            <div className="font-bold text-primary">
              {layer.thicknessMicron !== null
                ? `${compactNumber(layer.thicknessMicron)}μ`
                : "—"}
            </div>
            <div className="font-bold text-info-fg">
              {layer.widthMm !== null
                ? `${compactNumber(layer.widthMm)}mm`
                : "—"}
            </div>
          </div>
        ))
      ) : (
        <div className="px-4 py-6 text-center text-sm font-semibold text-content-3">
          Layer details are not captured on this record.
        </div>
      )}
    </div>
  );
}

export function SalesProductSpecCard({
  title = "Selected product",
  spec,
  status,
  blockerCount = 0,
  className,
}: {
  title?: string;
  spec: ProductSpec;
  status?: string;
  blockerCount?: number;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-[1.75rem] border border-line bg-surface-1 p-5 shadow-[0_18px_50px_-40px_rgba(15,23,42,0.35)]",
        className,
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="text-[11px] font-black uppercase tracking-[0.18em] text-content-3">
            {title}
          </div>
          <h2 className="mt-1 break-words text-2xl font-black tracking-tight text-content-1">
            {spec.productName}
          </h2>
          <div className="mt-1 text-sm font-bold text-content-3">
            {[
              spec.customerName,
              spec.orderNumber,
              spec.variantCode || spec.variantName,
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {status ? <SalesSpecChip tone="muted">{status}</SalesSpecChip> : null}
          {blockerCount > 0 ? (
            <SalesSpecChip tone="fgRoll">
              {blockerCount} blocker{blockerCount === 1 ? "" : "s"}
            </SalesSpecChip>
          ) : (
            <SalesSpecChip tone="grade">Ready</SalesSpecChip>
          )}
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-info-border bg-info-bg px-4 py-3">
          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-info-fg">
            Final product size
          </div>
          <div className="mt-2 text-xl font-black text-content-1">
            {spec.size.label}
          </div>
        </div>
        <div className="rounded-2xl border border-line bg-surface-2 px-4 py-3">
          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-content-3">
            Order context
          </div>
          <div className="mt-2 text-sm font-black text-content-1">
            {spec.templateName || spec.variantName || "Template pending"}
          </div>
        </div>
      </div>
      <div className="mt-4">
        <SalesSpecChips spec={spec} maxAddonLabels={3} />
      </div>
      <div className="mt-4">
        <SalesLayerTable spec={spec} />
      </div>
    </section>
  );
}

export function SalesOutputSummaryCard({
  title = "Current output",
  status,
  target,
  produced,
  remaining,
  outputLabel,
}: {
  title?: string;
  status?: string;
  target: string;
  produced?: string;
  remaining: string;
  outputLabel: string;
}) {
  return (
    <section className="rounded-[1.75rem] border border-line bg-surface-1 p-5 shadow-[0_18px_50px_-40px_rgba(15,23,42,0.35)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-black uppercase tracking-[0.18em] text-content-3">
            {title}
          </div>
          <h3 className="mt-1 text-xl font-black tracking-tight text-content-1">
            {outputLabel}
          </h3>
        </div>
        {status ? <SalesSpecChip tone="muted">{status}</SalesSpecChip> : null}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-info-border bg-info-bg px-4 py-3">
          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-primary">
            Step target
          </div>
          <div className="mt-2 text-lg font-black text-content-1">{target}</div>
        </div>
        <div className="rounded-2xl border border-success-border bg-success-bg px-4 py-3">
          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-success-fg">
            Produced
          </div>
          <div className="mt-2 text-lg font-black text-content-1">
            {produced || "0"}
          </div>
        </div>
        <div className="rounded-2xl border border-warning-border bg-warning-bg px-4 py-3">
          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-warning-fg">
            Remaining
          </div>
          <div className="mt-2 text-lg font-black text-content-1">
            {remaining}
          </div>
        </div>
      </div>
      <div className="mt-4 h-2 rounded-full bg-surface-2">
        <div
          className="h-full rounded-full bg-surface-3"
          style={{ width: "28%" }}
        />
      </div>
    </section>
  );
}

export function SalesSavedViewsBar({
  scope,
  currentFilters,
  onApply,
  viewCounts,
  className,
}: {
  scope: SalesSavedViewScope;
  currentFilters: SalesSavedViewFilters;
  onApply: (filters: SalesSavedViewFilters) => void;
  viewCounts?: Record<string, number>;
  className?: string;
}) {
  const [savedViews, setSavedViews] = useState<SalesSavedView[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [lastAppliedSavedId, setLastAppliedSavedId] = useState("");
  const starters = useMemo(() => defaultStarterViews(scope), [scope]);
  const activeSignature = filterSignature(currentFilters);
  const activeSavedId =
    savedViews.find((view) => filterSignature(view.filters) === activeSignature)
      ?.id || "";
  const updateTarget =
    savedViews.find(
      (view) => view.id === (activeSavedId || lastAppliedSavedId),
    ) || null;
  const activeStarterName =
    starters.find((view) => filterSignature(view.filters) === activeSignature)
      ?.name || "";

  useEffect(() => {
    setSavedViews(safeLoadSavedViews(scope));
    setLastAppliedSavedId("");
  }, [scope]);

  function persist(nextViews: SalesSavedView[]) {
    setSavedViews(nextViews);
    safeSaveSavedViews(scope, nextViews);
  }

  function openSaveDialog() {
    const now = new Date();
    const viewPrefix = scope.startsWith("planner")
      ? "Planner view"
      : "Sales view";
    setSaveName(
      `${viewPrefix} · ${formatDisplayDate(now)}`,
    );
    setMenuOpen(false);
    setSaveOpen(true);
  }

  function saveCurrentView() {
    const name = saveName.trim();
    if (!name) return;
    const existing = savedViews.find(
      (view) => view.name.toLowerCase() === name.toLowerCase(),
    );
    const now = new Date().toISOString();
    const nextView: SalesSavedView = {
      id: existing?.id || makeSavedViewId(),
      name,
      filters: currentFilters,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    const next = existing
      ? savedViews.map((view) => (view.id === existing.id ? nextView : view))
      : [nextView, ...savedViews];
    persist(next);
    setSaveOpen(false);
  }

  function updateSavedView(id: string) {
    const target = savedViews.find((view) => view.id === id);
    if (!target) return;
    const now = new Date().toISOString();
    const next = savedViews.map((view) =>
      view.id === id
        ? { ...view, filters: currentFilters, updatedAt: now }
        : view,
    );
    persist(next);
    setLastAppliedSavedId(id);
  }

  function deleteView(id: string) {
    persist(savedViews.filter((view) => view.id !== id));
    if (lastAppliedSavedId === id) setLastAppliedSavedId("");
  }

  return (
    <div
      className={cn(
        "rounded-[1.35rem] border border-line bg-surface-1 p-4 shadow-[0_16px_38px_-34px_rgba(15,23,42,0.35)]",
        className,
      )}
      data-testid={`sales-saved-views-${scope}`}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="text-[10px] font-black uppercase tracking-[0.22em] text-primary">
          Saved views
        </div>
        <div className="text-[10px] font-semibold text-content-4">
          click a view to load · save the current filter lens
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {starters.slice(0, 6).map((view, index) => {
          const isActive = activeStarterName === view.name;
          const count = viewCounts?.[view.name] ?? view.count;
          return (
            <button
              key={`starter-${view.name}`}
              type="button"
              onClick={() => {
                setLastAppliedSavedId("");
                onApply(view.filters);
              }}
              className={cn(
                "inline-flex h-9 items-center gap-2 rounded-full border px-4 text-xs font-black transition hover:-translate-y-0.5 hover:border-info-border hover:bg-info-bg",
                isActive
                  ? "border-primary bg-gradient-to-br from-primary to-info-fg text-white shadow-[0_12px_28px_-18px_rgba(37,99,235,0.7)]"
                  : "border-line bg-surface-1 text-content-2",
              )}
            >
              <span
                className={cn(
                  "text-primary",
                  isActive && "text-warning-border",
                )}
              >
                📌
              </span>
              {index === 0 ? (
                <Sparkles className="h-3.5 w-3.5" />
              ) : (
                <Bookmark className="h-3.5 w-3.5" />
              )}
              {view.name}
              {typeof count === "number" ? (
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[10px]",
                    isActive
                      ? "bg-surface-1/25 text-white"
                      : "bg-surface-2 text-content-3",
                  )}
                >
                  {count}
                </span>
              ) : null}
            </button>
          );
        })}
        {savedViews.slice(0, 3).map((view) => {
          const isActive = activeSavedId === view.id;
          return (
            <button
              key={view.id}
              type="button"
              onClick={() => {
                setLastAppliedSavedId(view.id);
                onApply(view.filters);
              }}
              className={cn(
                "inline-flex h-9 items-center gap-2 rounded-full border px-4 text-xs font-black transition hover:-translate-y-0.5 hover:border-info-border hover:bg-info-bg",
                isActive
                  ? "border-primary bg-gradient-to-br from-primary to-info-fg text-white shadow-[0_12px_28px_-18px_rgba(37,99,235,0.7)]"
                  : "border-line bg-surface-1 text-content-2",
              )}
            >
              <Bookmark className="h-3.5 w-3.5" />
              {view.name}
            </button>
          );
        })}
        {updateTarget ? (
          <Button
            type="button"
            variant="outline"
            className="h-9 rounded-full border-info-border bg-info-bg px-4 text-xs font-black text-primary hover:bg-info-bg"
            onClick={() => updateSavedView(updateTarget.id)}
          >
            <Bookmark className="mr-2 h-4 w-4" />
            Update {updateTarget.name}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          className="h-9 rounded-full border-dashed bg-surface-1 px-4 text-xs font-black"
          onClick={openSaveDialog}
        >
          <BookmarkPlus className="mr-2 h-4 w-4" />
          Save new view
        </Button>
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              className="h-9 rounded-full bg-surface-1 text-xs font-black"
            >
              All views
              <ChevronDown className="ml-2 h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-[min(28rem,calc(100vw-2rem))] rounded-2xl border-line p-2 shadow-[0_24px_58px_-28px_rgba(15,23,42,0.38)]"
          >
            <DropdownMenuLabel className="text-[10px] font-black uppercase tracking-[0.18em] text-content-3">
              Starter views
            </DropdownMenuLabel>
            {starters.map((view) => (
              <DropdownMenuItem
                key={`menu-starter-${view.name}`}
                className="rounded-xl p-3"
                onClick={() => {
                  setLastAppliedSavedId("");
                  onApply(view.filters);
                }}
              >
                <div className="min-w-0">
                  <div className="font-black text-content-1">{view.name}</div>
                  <div className="mt-0.5 truncate text-xs text-content-3">
                    {summarizeFilters(view.filters)}
                  </div>
                </div>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[10px] font-black uppercase tracking-[0.18em] text-content-3">
              My saved views
            </DropdownMenuLabel>
            {!savedViews.length ? (
              <div className="px-3 py-5 text-center text-sm font-semibold text-content-3">
                No saved views yet.
              </div>
            ) : (
              savedViews.map((view) => (
                <div
                  key={`menu-${view.id}`}
                  className="flex items-center gap-2 rounded-xl px-1 py-1 hover:bg-surface-2"
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 rounded-lg px-2 py-2 text-left"
                    onClick={() => {
                      setLastAppliedSavedId(view.id);
                      onApply(view.filters);
                      setMenuOpen(false);
                    }}
                  >
                    <div className="truncate text-sm font-black text-content-1">
                      {view.name}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-content-3">
                      {summarizeFilters(view.filters)}
                    </div>
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${view.name}`}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      deleteView(view.id);
                    }}
                    className="flex h-9 w-9 items-center justify-center rounded-full text-content-4 hover:bg-danger-bg hover:text-danger-fg"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="sm:max-w-[28rem]">
          <DialogHeader>
            <DialogTitle>Save view</DialogTitle>
            <DialogDescription>
              Name this filter setup so it can be reused on this browser.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>View name</Label>
            <Input
              value={saveName}
              onChange={(event) => setSaveName(event.target.value)}
              autoFocus
            />
            <div className="rounded-2xl bg-surface-2 px-3 py-2 text-xs font-semibold text-content-3">
              {summarizeFilters(currentFilters)}
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setSaveOpen(false)}
            >
              Cancel
            </Button>
            <Button type="button" onClick={saveCurrentView}>
              Save view
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function SalesVariantCard({
  sku,
  variant,
  selected,
  added,
  onSelect,
  onAdd,
  actionLabel = "Add to queue",
}: {
  sku?: Partial<SalesSku> | null;
  variant: SalesSkuVariant;
  selected?: boolean;
  added?: boolean;
  onSelect?: () => void;
  onAdd?: () => void;
  actionLabel?: string;
}) {
  const spec = normalizeProductSpec(salesVariantSpecSource(sku, variant));
  const printingLabel = variant.printing_snapshot?.enabled
    ? `${variant.printing_snapshot?.type || "PRINT"} F${variant.printing_snapshot?.front_colors_count || 0}/B${variant.printing_snapshot?.back_colors_count || 0}`
    : "No print";
  return (
    <div
      className={cn(
        "rounded-[1.5rem] border bg-surface-1 p-4 transition hover:-translate-y-0.5 hover:border-info-border hover:shadow-[0_18px_44px_-34px_rgba(37,99,235,0.4)]",
        selected
          ? "border-primary bg-info-bg shadow-[0_16px_42px_-34px_rgba(37,99,235,0.45)]"
          : "border-line",
        added && "border-success-border bg-success-bg",
      )}
    >
      <button type="button" className="w-full text-left" onClick={onSelect}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-black text-content-1">
              {variant.code}
            </div>
            <div className="mt-1 line-clamp-2 text-sm font-bold leading-5 text-content-2">
              {variant.name}
            </div>
          </div>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-line bg-surface-1 text-content-3">
            <Layers3 className="h-4 w-4" />
          </div>
        </div>
        <div className="mt-3">
          <SalesSpecChips
            spec={spec}
            fgType={variant.finished_good_type}
            printingLabel={printingLabel}
            compact
            maxAddonLabels={1}
          />
        </div>
        <div className="mt-3 rounded-2xl border border-line bg-surface-1/88 p-2">
          <SalesLayerTable spec={spec} dense />
        </div>
      </button>
      {onAdd ? (
        <Button
          type="button"
          className="mt-3 h-10 w-full rounded-full bg-surface-3 text-xs font-black uppercase tracking-[0.14em] hover:bg-line"
          onClick={onAdd}
        >
          <PackageCheck className="mr-2 h-4 w-4" />
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}

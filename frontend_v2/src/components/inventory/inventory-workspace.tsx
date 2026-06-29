"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  Archive,
  Bookmark,
  BookmarkPlus,
  Boxes,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Edit3,
  Layers3,
  Package,
  RefreshCw,
  Search,
  ShieldCheck,
  TableProperties,
  Thermometer,
  Trash2,
  Warehouse,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SemanticBadge } from "@/components/ui-custom/semantic-badge";
import { SummaryStatCard } from "@/components/ui-custom/summary-stat-card";
import { factoryService } from "@/services/factory";
import {
  inventoryService,
  type GrnHistoryRow,
  type InventoryBulk,
  type PackagingStockRow,
  type PackagingTransactionRow,
  type Vendor,
} from "@/services/inventory";
import { masterDataService } from "@/services/master-data";
import { getRollsByVariant, type RollExplorerRow } from "@/services/rolls";
import { cn } from "@/lib/utils";
import { formatDisplayDateTime } from "@/lib/date-format";

type WorkspaceTab = "rolls" | "bulk" | "packaging" | "grn";
type InnerTab = "pulse" | "browse";
type ViewMode = "table" | "cards";
type FilterOption = { value: string; label: string };
type InventorySavedView = {
  id: string;
  name: string;
  filters: Record<string, string>;
  createdAt: string;
  updatedAt: string;
};

const CHART_COLORS = [
  "#0f766e",
  "#2563eb",
  "#3b82f6",
  "#ea580c",
  "#dc2626",
  "#0891b2",
  "#65a30d",
  "#475569",
];
const AGE_COLUMNS = ["0-7d", "8-30d", "31-60d", ">60d"];
const FILTER_TRIGGER_BASE_CLASS =
  "h-10 rounded-full px-4 text-xs font-black transition-all duration-150 focus:ring-2 focus:ring-success-border data-[state=open]:border-success-border data-[state=open]:bg-success-bg data-[state=open]:text-content-1";
const FILTER_TRIGGER_IDLE_CLASS =
  "border-line bg-surface-1 text-[#0f172a] shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:border-success-border hover:bg-success-bg";
const FILTER_TRIGGER_ACTIVE_CLASS =
  "border-[#0d9488] bg-[#0d9488] text-white shadow-[0_10px_24px_rgba(13,148,136,0.20)] hover:bg-[#0f766e] data-[state=open]:bg-[#0d9488] data-[state=open]:text-white";
const FILTER_MENU_CLASS =
  "rounded-2xl border border-line bg-surface-1 p-2 shadow-[0_20px_40px_-18px_rgba(15,23,42,0.25)]";
const FILTER_ITEM_CLASS =
  "rounded-xl text-sm font-semibold text-content-2 focus:bg-surface-2 focus:text-[#0f172a] data-[state=checked]:bg-[#0d9488] data-[state=checked]:text-white";
const INVENTORY_FILTER_KEYS = [
  "q",
  "plant",
  "location",
  "status",
  "material",
  "category",
  "source_type",
  "age",
  "size",
  "variant",
  "thickness",
  "grade",
  "weight",
  "family",
  "job",
  "print",
  "lamination",
  "granule",
  "availability",
  "value",
  "supply_mode",
  "transaction_type",
  "stock_range",
  "vendor",
  "reference",
  "date_from",
  "date_to",
] as const;
const AGE_FILTER_OPTIONS: FilterOption[] = [
  { value: "ALL", label: "All Age" },
  { value: "Fresh", label: "Fresh <= 7d" },
  { value: "Watch", label: "Watch 8-30d" },
  { value: "Aged", label: "Aged > 30d" },
];
const STATUS_OPTIONS: FilterOption[] = [
  { value: "ALL", label: "All Status" },
  { value: "AVAILABLE", label: "Available" },
  { value: "RESERVED", label: "Reserved" },
  { value: "IN_PROCESS", label: "In Process" },
  { value: "SENT_JOBWORK", label: "Sent Jobwork" },
];
const SOURCE_OPTIONS: FilterOption[] = [
  { value: "ALL", label: "All Source" },
  { value: "ROLL", label: "Roll GRN" },
  { value: "BULK", label: "Bulk GRN" },
  { value: "PACKAGING", label: "Packaging GRN" },
];
const ROLL_WEIGHT_OPTIONS: FilterOption[] = [
  { value: "ALL", label: "All Weight" },
  { value: "0-100", label: "0-100 kg" },
  { value: "100-250", label: "100-250 kg" },
  { value: "250-500", label: "250-500 kg" },
  { value: "500+", label: "500+ kg" },
];
const STOCK_AVAILABILITY_OPTIONS: FilterOption[] = [
  { value: "ALL", label: "All Availability" },
  { value: "AVAILABLE", label: "Available" },
  { value: "LOW", label: "Low Stock" },
  { value: "ZERO", label: "Zero Stock" },
];
const VALUE_BAND_OPTIONS: FilterOption[] = [
  { value: "ALL", label: "All Value" },
  { value: "NO_VALUE", label: "No Value" },
  { value: "0-10000", label: "0-10k" },
  { value: "10000-50000", label: "10k-50k" },
  { value: "50000-100000", label: "50k-1L" },
  { value: "100000+", label: "1L+" },
];
const PACKAGING_STOCK_RANGE_OPTIONS: FilterOption[] = [
  { value: "ALL", label: "All Stock" },
  { value: "ZERO", label: "Zero" },
  { value: "1-500", label: "1-500" },
  { value: "500-2500", label: "500-2,500" },
  { value: "2500+", label: "2,500+" },
];
const PACKAGING_TRANSACTION_OPTIONS: FilterOption[] = [
  { value: "ALL", label: "All Movement" },
  { value: "INWARD", label: "Inward" },
  { value: "CONSUME", label: "Consume" },
  { value: "TRANSFER", label: "Transfer" },
  { value: "ADJUST", label: "Adjust" },
  { value: "PRODUCE", label: "Produce" },
];
const PRINT_OPTIONS: FilterOption[] = [
  { value: "ALL", label: "All Print" },
  { value: "PRINTED", label: "Printed" },
  { value: "UNPRINTED", label: "Unprinted" },
];
const LAMINATION_OPTIONS: FilterOption[] = [
  { value: "ALL", label: "All Lamination" },
  { value: "LAMINATED", label: "Laminated" },
  { value: "UNLAMINATED", label: "Unlaminated" },
];

function num(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatKg(value: number) {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} kg`;
}

function formatQty(value: number, uom = "PCS") {
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${uom}`;
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}

function ageDays(date?: string | null) {
  if (!date) return 0;
  const ts = new Date(date).getTime();
  if (!Number.isFinite(ts)) return 0;
  return Math.max(0, Math.floor((Date.now() - ts) / 86400000));
}

function ageBand(date?: string | null) {
  const days = ageDays(date);
  if (days <= 7) return "Fresh";
  if (days <= 30) return "Watch";
  return "Aged";
}

function includesText(values: unknown[], search: string) {
  if (!search) return true;
  const q = search.toLowerCase();
  return values
    .map((value) => String(value || "").toLowerCase())
    .join(" ")
    .includes(q);
}

function clean(value: unknown) {
  return String(value ?? "").trim();
}

function upper(value: unknown) {
  return clean(value).toUpperCase();
}

function productionBatchLabel(row: any) {
  const batch = clean(row?.production_batch_number);
  return batch ? `Batch ${batch}` : "";
}

function routeNodeLabel(row: any) {
  const route = row?.route_node || {};
  const node = clean(route?.route_node_label || route?.label || route?.name || route?.route_node_id || route?.id || row?.route_node_id);
  const branch = clean(route?.route_branch_key || route?.branch_key || row?.route_branch_key);
  return [node, branch && branch !== node ? branch : ""].filter(Boolean).join(" · ");
}

function formatOptionLabel(value: string) {
  return value.replaceAll("_", " ");
}

function optionsFromPairs(
  pairs: Array<[unknown, unknown]>,
  allLabel: string,
  limit = 120,
): FilterOption[] {
  const seen = new Map<string, string>();
  for (const [rawValue, rawLabel] of pairs) {
    const value = clean(rawValue);
    if (!value || value === "ALL" || seen.has(value)) continue;
    seen.set(value, clean(rawLabel) || value);
  }
  return [
    { value: "ALL", label: allLabel },
    ...Array.from(seen.entries())
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) => a.label.localeCompare(b.label))
      .slice(0, limit),
  ];
}

function optionsFromValues(
  values: unknown[],
  allLabel: string,
  limit = 120,
): FilterOption[] {
  return optionsFromPairs(
    values.map((value) => [value, formatOptionLabel(clean(value))]),
    allLabel,
    limit,
  );
}

function inventorySavedViewsKey(tab: WorkspaceTab) {
  return `total-poly-print.inventory.saved-views.${tab}`;
}

function makeSavedViewId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto)
    return crypto.randomUUID();
  return `view-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function safeLoadSavedViews(tab: WorkspaceTab): InventorySavedView[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(inventorySavedViewsKey(tab));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((view): view is InventorySavedView => {
        return Boolean(
          view &&
            typeof view.id === "string" &&
            typeof view.name === "string" &&
            view.filters &&
            typeof view.filters === "object",
        );
      })
      .slice(0, 20);
  } catch {
    return [];
  }
}

function safeSaveSavedViews(tab: WorkspaceTab, views: InventorySavedView[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      inventorySavedViewsKey(tab),
      JSON.stringify(views.slice(0, 20)),
    );
  } catch {
    // Keep the current session usable even if browser storage is unavailable.
  }
}

function optionLabel(options: FilterOption[], value: string) {
  return (
    options.find((option) => String(option.value) === String(value))?.label ||
    formatOptionLabel(value)
  );
}

function compactFilterSummary(filters: Record<string, string>, limit = 3) {
  const entries = Object.entries(filters).filter(([, value]) => clean(value));
  if (entries.length === 0) return "All stock";
  const labels = entries
    .slice(0, limit)
    .map(
      ([key, value]) =>
        `${formatOptionLabel(key)}: ${formatOptionLabel(value)}`,
    );
  const extra = entries.length > limit ? ` +${entries.length - limit}` : "";
  return `${labels.join(" · ")}${extra}`;
}

function displayPlant(row: any) {
  return (
    row?.plant_name ||
    row?.plant_code ||
    row?.plant_id ||
    "Unassigned plant"
  );
}

function displayLocation(row: any) {
  return (
    row?.location_code ||
    row?.location_name ||
    row?.location ||
    row?.location_id ||
    "Unassigned location"
  );
}

function filterFingerprint(filters: Record<string, string>) {
  return JSON.stringify(
    Object.entries(filters).sort(([a], [b]) => a.localeCompare(b)),
  );
}

function rollExactSize(row: any) {
  const width = num(row.width_mm);
  const thickness = num(row.thickness_micron);
  if (!width && !thickness) return "Size not recorded";
  const widthLabel = width ? `${Math.round(width)}mm` : "width not recorded";
  const thicknessLabel = thickness
    ? `${Math.round(thickness)}u`
    : "thickness not recorded";
  return `${widthLabel} x ${thicknessLabel}`;
}

function rollWidthBand(row: any) {
  const width = num(row.width_mm);
  if (!width) return "Width not recorded";
  if (width <= 500) return "<= 500 mm";
  if (width <= 800) return "501-800 mm";
  if (width <= 1100) return "801-1100 mm";
  return "> 1100 mm";
}

function rollThicknessExact(row: any) {
  const thickness = num(row.thickness_micron);
  return thickness ? `${Math.round(thickness)}u` : "Thickness not recorded";
}

function rollThicknessBand(row: any) {
  const thickness = num(row.thickness_micron);
  if (!thickness) return "Thickness not recorded";
  if (thickness <= 15) return "<= 15u";
  if (thickness <= 30) return "16-30u";
  if (thickness <= 50) return "31-50u";
  return "> 50u";
}

function rollWeightBand(row: any) {
  const weight = num(row.weight_kg);
  if (weight < 100) return "0-100";
  if (weight < 250) return "100-250";
  if (weight < 500) return "250-500";
  return "500+";
}

function rollPrintState(row: any) {
  const text = upper(
    [
      row.print_status,
      row.form_label,
      row.process_state_label,
      row.variant_summary,
      row.display_name,
    ].join(" "),
  );
  if (
    text.includes("UNPRINT") ||
    text.includes("NO PRINT") ||
    text.includes("PLAIN")
  )
    return "UNPRINTED";
  if (text.includes("PRINT")) return "PRINTED";
  return "UNPRINTED";
}

function rollLaminationState(row: any) {
  const text = upper(
    [
      row.lamination_status,
      row.form_label,
      row.process_state_label,
      row.variant_summary,
      row.display_name,
    ].join(" "),
  );
  if (
    text.includes("UNLAM") ||
    text.includes("NO LAM") ||
    text.includes("NON LAM")
  )
    return "UNLAMINATED";
  if (text.includes("LAM")) return "LAMINATED";
  return "UNLAMINATED";
}

function matchesRollSize(row: any, selected: string) {
  if (selected === "ALL") return true;
  return (
    rollWidthBand(row) === selected ||
    rollExactSize(row) === selected ||
    `${rollWidthBand(row)} · ${rollThicknessBand(row)}` === selected
  );
}

function matchesRollThickness(row: any, selected: string) {
  if (selected === "ALL") return true;
  return (
    rollThicknessBand(row) === selected || rollThicknessExact(row) === selected
  );
}

function stockAvailability(kind: "bulk" | "packaging", row: any) {
  const qty = stockQty(kind, row);
  if (qty <= 0) return "ZERO";
  const lowLine = kind === "packaging" ? 100 : 100;
  if (qty <= lowLine) return "LOW";
  return "AVAILABLE";
}

function stockRangeBand(kind: "bulk" | "packaging", row: any) {
  const qty = stockQty(kind, row);
  if (qty <= 0) return "ZERO";
  if (kind === "packaging") {
    if (qty <= 500) return "1-500";
    if (qty <= 2500) return "500-2500";
    return "2500+";
  }
  if (qty <= 100) return "0-100";
  if (qty <= 1000) return "100-1000";
  return "1000+";
}

function stockValueBand(kind: "bulk" | "packaging", row: any) {
  const value = stockQty(kind, row) * num(row.avg_cost);
  if (value <= 0) return "NO_VALUE";
  if (value <= 10000) return "0-10000";
  if (value <= 50000) return "10000-50000";
  if (value <= 100000) return "50000-100000";
  return "100000+";
}

function packagingSupplyMode(row: any, packagingMaterials: any[]) {
  const material = packagingMaterials.find(
    (item) => String(item.id) === String(row.material),
  );
  return upper(
    material?.packaging_supply_mode || row.packaging_supply_mode || "PURCHASED",
  );
}

function packagingBaseUom(row: any, packagingMaterials: any[] = []) {
  const material = packagingMaterials.find(
    (item) => String(item.id) === String(row.material),
  );
  return String(row.base_uom || material?.base_uom || "PCS").toUpperCase();
}

function packagingRowsUom(rows: any[], packagingMaterials: any[] = []) {
  const units = Array.from(
    new Set(
      rows
        .map((row) => packagingBaseUom(row, packagingMaterials))
        .filter(Boolean),
    ),
  );
  return units.length === 1 ? units[0] : "qty";
}

function dateInRange(
  date: string | null | undefined,
  from: string,
  to: string,
) {
  if (!from && !to) return true;
  if (!date) return false;
  const day = date.slice(0, 10);
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}

function ageFromHeatmapColumn(column: string) {
  if (column === "0-7d") return "Fresh";
  if (column === "8-30d") return "Watch";
  return "Aged";
}

function groupSum<T>(
  rows: T[],
  keyFn: (row: T) => string,
  valueFn: (row: T) => number,
  limit = 8,
) {
  const bucket = new Map<string, number>();
  for (const row of rows) {
    const key = keyFn(row) || "Not recorded";
    bucket.set(key, (bucket.get(key) || 0) + valueFn(row));
  }
  return Array.from(bucket.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

function formatShort(value: number) {
  return value.toLocaleString(undefined, {
    maximumFractionDigits: value >= 100 ? 0 : 1,
  });
}

function stockQty(kind: "rolls" | "bulk" | "packaging", row: any) {
  if (kind === "packaging") return num(row.qty);
  if (kind === "bulk") return num(row.qty_kg);
  return num(row.weight_kg);
}

function stockDate(row: any) {
  return row.created_at || row.updated_at || null;
}

function stockTitle(kind: "rolls" | "bulk" | "packaging", row: any) {
  if (kind === "rolls")
    return (
      row.variant_display_name || row.material_name || row.label_id || "Roll"
    );
  return row.material_name || row.material_code || "Material";
}

function stockSubtitle(kind: "rolls" | "bulk" | "packaging", row: any) {
  if (kind === "rolls")
    return `${row.label_id || "No label"} · ${row.plant_name || "Plant"} · ${row.location_name || "Location"}`;
  if (kind === "bulk")
    return `${row.material_code || "Code"} · ${row.granule_quality_code || row.material_category || "Stock"} · ${row.location_name || "Location"}`;
  return `${row.material_code || "SKU"} · ${row.packaging_kind || "Packaging"} · ${row.location_name || "Location"}`;
}

function ageColumn(date?: string | null) {
  const days = ageDays(date);
  if (days <= 7) return "0-7d";
  if (days <= 30) return "8-30d";
  if (days <= 60) return "31-60d";
  return ">60d";
}

export function InventoryWorkspaceShell() {
  const router = useRouter();
  const pathname = usePathname() || "/inventory";
  const readonlySearchParams = useSearchParams();
  const searchParams = readonlySearchParams ?? new URLSearchParams();
  const qc = useQueryClient();

  const routeDefaultTab: WorkspaceTab = "rolls";
  const tab = normalizeTab(searchParams.get("tab"), routeDefaultTab);
  const inner = normalizeInner(searchParams.get("view"));
  const mode = normalizeMode(searchParams.get("mode"));
  const search = searchParams.get("q") || "";
  const plant = searchParams.get("plant") || "ALL";
  const location = searchParams.get("location") || "ALL";
  const status = searchParams.get("status") || "ALL";
  const material = searchParams.get("material") || "ALL";
  const category = searchParams.get("category") || "ALL";
  const sourceType = searchParams.get("source_type") || "ALL";
  const age = searchParams.get("age") || "ALL";
  const size = searchParams.get("size") || "ALL";
  const variant = searchParams.get("variant") || "ALL";
  const thickness = searchParams.get("thickness") || "ALL";
  const grade = searchParams.get("grade") || "ALL";
  const weight = searchParams.get("weight") || "ALL";
  const family = searchParams.get("family") || "ALL";
  const job = searchParams.get("job") || "ALL";
  const print = searchParams.get("print") || "ALL";
  const lamination = searchParams.get("lamination") || "ALL";
  const granule = searchParams.get("granule") || "ALL";
  const availability = searchParams.get("availability") || "ALL";
  const valueBand = searchParams.get("value") || "ALL";
  const supplyMode = searchParams.get("supply_mode") || "ALL";
  const transactionType = searchParams.get("transaction_type") || "ALL";
  const stockRange = searchParams.get("stock_range") || "ALL";
  const vendor = searchParams.get("vendor") || "ALL";
  const reference = searchParams.get("reference") || "ALL";
  const dateFrom = searchParams.get("date_from") || "";
  const dateTo = searchParams.get("date_to") || "";

  function setParam(updates: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (!value || value === "ALL") next.delete(key);
      else next.set(key, value);
    }
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  }

  function switchTab(value: string) {
    setParam({
      tab: value,
      view: "pulse",
      mode: null,
      status: null,
      material: null,
      category: null,
      source_type: null,
      size: null,
      variant: null,
      thickness: null,
      grade: null,
      weight: null,
      family: null,
      job: null,
      print: null,
      lamination: null,
      granule: null,
      availability: null,
      value: null,
      supply_mode: null,
      transaction_type: null,
      stock_range: null,
      vendor: null,
      reference: null,
      date_from: null,
      date_to: null,
    });
  }

  const { data: plants = [] } = useQuery({
    queryKey: ["inventory-workspace-plants"],
    queryFn: factoryService.getPlants,
  });
  const { data: allLocations = [] } = useQuery({
    queryKey: ["inventory-workspace-locations"],
    queryFn: factoryService.getLocations,
  });
  const { data: packagingMaterials = [] } = useQuery({
    queryKey: ["inventory-workspace-packaging-master"],
    queryFn: masterDataService.getPackaging,
  });
  const { data: vendors = [] } = useQuery({
    queryKey: ["inventory-workspace-vendors"],
    queryFn: inventoryService.getVendors,
    enabled: tab === "grn",
    staleTime: 60000,
  });

  const rollsQuery = useQuery({
    queryKey: ["inventory-workspace-rolls", plant, status, material, location],
    queryFn: () =>
      getRollsByVariant({
        plant: plant !== "ALL" ? plant : undefined,
        status:
          status !== "ALL"
            ? status
            : "AVAILABLE,RESERVED,IN_PROCESS,SENT_JOBWORK",
        material: material !== "ALL" ? material : undefined,
        location: location !== "ALL" ? location : undefined,
      }),
    enabled: tab === "rolls",
    staleTime: 30000,
  });
  const bulkQuery = useQuery({
    queryKey: ["inventory-workspace-bulk", plant],
    queryFn: () =>
      inventoryService.getBulkStock({
        plant: plant !== "ALL" ? plant : undefined,
      }),
    enabled: tab === "bulk",
    staleTime: 30000,
  });
  const packagingQuery = useQuery({
    queryKey: ["inventory-workspace-packaging", plant, location],
    queryFn: () =>
      inventoryService.getPackagingStock({
        plant: plant !== "ALL" ? plant : undefined,
        location: location !== "ALL" ? location : undefined,
      }),
    enabled: tab === "packaging",
    staleTime: 30000,
  });
  const packagingTxQuery = useQuery({
    queryKey: [
      "inventory-workspace-packaging-tx",
      material,
      location,
      transactionType,
    ],
    queryFn: () =>
      inventoryService.getPackagingTransactions({
        material: material !== "ALL" ? material : undefined,
        location: location !== "ALL" ? location : undefined,
        type: transactionType !== "ALL" ? transactionType : undefined,
      }),
    enabled: tab === "packaging",
    staleTime: 30000,
  });
  const grnQuery = useQuery({
    queryKey: [
      "inventory-workspace-grn",
      sourceType,
      search,
      material,
      plant,
      location,
      vendor,
      reference,
      dateFrom,
      dateTo,
    ],
    queryFn: () =>
      inventoryService.getGrnHistory({
        source_type: sourceType !== "ALL" ? sourceType : undefined,
        search: search || undefined,
        material: material !== "ALL" ? material : undefined,
        plant: plant !== "ALL" ? plant : undefined,
        location: location !== "ALL" ? location : undefined,
        vendor: vendor !== "ALL" ? vendor : undefined,
        reference: reference !== "ALL" ? reference : undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      }),
    enabled: tab === "grn",
    staleTime: 15000,
  });

  function refreshWorkspace() {
    qc.invalidateQueries({ queryKey: ["inventory-workspace-rolls"] });
    qc.invalidateQueries({ queryKey: ["inventory-workspace-bulk"] });
    qc.invalidateQueries({ queryKey: ["inventory-workspace-packaging"] });
    qc.invalidateQueries({ queryKey: ["inventory-workspace-packaging-tx"] });
    qc.invalidateQueries({ queryKey: ["inventory-workspace-grn"] });
  }

  const allRollRows = useMemo(() => {
    const rows = (rollsQuery.data?.families || []).flatMap((family) =>
      family.variants.flatMap((variant) => variant.rolls || []),
    );
    return rows;
  }, [rollsQuery.data]);

  const allBulkRows = useMemo(
    () => (bulkQuery.data || []) as InventoryBulk[],
    [bulkQuery.data],
  );
  const allPackagingRows = useMemo(
    () => (packagingQuery.data || []) as PackagingStockRow[],
    [packagingQuery.data],
  );
  const packagingTxRows = useMemo(
    () => (packagingTxQuery.data || []) as PackagingTransactionRow[],
    [packagingTxQuery.data],
  );
  const allGrnRows = useMemo(
    () => (grnQuery.data || []) as GrnHistoryRow[],
    [grnQuery.data],
  );

  const packagingTransactionMaterialIds = useMemo(() => {
    if (transactionType === "ALL") return null;
    return new Set(packagingTxRows.map((row) => String(row.material)));
  }, [packagingTxRows, transactionType]);

  const rollRows = useMemo(() => {
    const rows = allRollRows;
    return rows.filter((row) => {
      if (
        plant !== "ALL" &&
        String(row.plant_id || (row as any).plant || "") !== plant
      )
        return false;
      if (
        location !== "ALL" &&
        String(row.location_id || (row as any).location || "") !== location
      )
        return false;
      if (status !== "ALL" && upper(row.status) !== status) return false;
      if (
        material !== "ALL" &&
        String(row.material_id || (row as any).material || "") !== material
      )
        return false;
      if (age !== "ALL" && ageBand(row.created_at) !== age) return false;
      if (!matchesRollSize(row, size)) return false;
      if (
        variant !== "ALL" &&
        clean(row.variant_display_name || row.material_name) !== variant
      )
        return false;
      if (!matchesRollThickness(row, thickness)) return false;
      if (grade !== "ALL" && clean(row.grade_name || row.grade_id) !== grade)
        return false;
      if (weight !== "ALL" && rollWeightBand(row) !== weight) return false;
      if (
        family !== "ALL" &&
        clean(
          row.family_display_name || row.reporting_group || row.material_name,
        ) !== family
      )
        return false;
      if (
        job !== "ALL" &&
        clean(
          row.created_job_number ||
            row.production_job_number ||
            row.created_job_id ||
            row.production_job_id,
        ) !== job
      )
        return false;
      if (print !== "ALL" && rollPrintState(row) !== print) return false;
      if (lamination !== "ALL" && rollLaminationState(row) !== lamination)
        return false;
      return includesText(
        [
          row.label_id,
          row.family_display_name,
          row.variant_display_name,
          row.material_name,
          row.grade_name,
          row.location_name,
          row.plant_name,
          row.status,
          row.stage_name,
          row.created_job_number,
          row.production_batch_number,
          routeNodeLabel(row),
          row.size_line,
          row.print_status,
          row.lamination_status,
        ],
        search,
      );
    });
  }, [
    allRollRows,
    plant,
    location,
    status,
    material,
    age,
    size,
    variant,
    thickness,
    grade,
    weight,
    family,
    job,
    print,
    lamination,
    search,
  ]);

  const bulkRows = useMemo(() => {
    return allBulkRows.filter((row) => {
      if (material !== "ALL" && String(row.material) !== material) return false;
      if (
        category !== "ALL" &&
        String(row.material_category || "").toUpperCase() !== category
      )
        return false;
      if (location !== "ALL" && String(row.location) !== location) return false;
      if (
        granule !== "ALL" &&
        clean(row.granule_quality_code || row.granule_quality_code_id) !==
          granule
      )
        return false;
      if (
        availability !== "ALL" &&
        stockAvailability("bulk", row) !== availability
      )
        return false;
      if (valueBand !== "ALL" && stockValueBand("bulk", row) !== valueBand)
        return false;
      if (age !== "ALL" && ageBand(row.updated_at) !== age) return false;
      return includesText(
        [
          row.material_name,
          row.material_code,
          row.material_category,
          row.granule_quality_code,
          row.plant_name,
          row.location_name,
        ],
        search,
      );
    });
  }, [
    allBulkRows,
    material,
    category,
    location,
    granule,
    availability,
    valueBand,
    age,
    search,
  ]);

  const packagingRows = useMemo(() => {
    return allPackagingRows.filter((row) => {
      if (material !== "ALL" && String(row.material) !== material) return false;
      if (
        category !== "ALL" &&
        String(row.packaging_kind || "").toUpperCase() !== category
      )
        return false;
      if (
        supplyMode !== "ALL" &&
        packagingSupplyMode(row, packagingMaterials as any[]) !== supplyMode
      )
        return false;
      if (
        stockRange !== "ALL" &&
        stockRangeBand("packaging", row) !== stockRange
      )
        return false;
      if (
        packagingTransactionMaterialIds &&
        !packagingTransactionMaterialIds.has(String(row.material))
      )
        return false;
      if (age !== "ALL" && ageBand(row.updated_at) !== age) return false;
      return includesText(
        [
          row.material_name,
          row.material_code,
          row.packaging_kind,
          row.plant_name,
          row.location_name,
        ],
        search,
      );
    });
  }, [
    allPackagingRows,
    material,
    category,
    supplyMode,
    packagingMaterials,
    stockRange,
    packagingTransactionMaterialIds,
    age,
    search,
  ]);

  const grnRows = useMemo(() => {
    return allGrnRows.filter((row) => {
      if (sourceType !== "ALL" && row.source_type !== sourceType) return false;
      if (material !== "ALL" && String(row.material || "") !== material)
        return false;
      if (plant !== "ALL" && String(row.plant || "") !== plant) return false;
      if (location !== "ALL" && String(row.location || "") !== location)
        return false;
      if (age !== "ALL" && ageBand(row.created_at) !== age) return false;
      if (
        vendor !== "ALL" &&
        !includesText([row.vendor_name, row.vendor_code, row.vendor], vendor)
      )
        return false;
      if (
        reference !== "ALL" &&
        !includesText([row.reference, row.batch_no, row.label_id], reference)
      )
        return false;
      if (!dateInRange(row.created_at, dateFrom, dateTo)) return false;
      return includesText(
        [
          row.source_type,
          row.label_id,
          row.material_name,
          row.material_code,
          row.reference,
          row.batch_no,
          row.vendor_name,
          row.vendor_code,
          row.plant_name,
          row.location_name,
        ],
        search,
      );
    });
  }, [
    allGrnRows,
    sourceType,
    material,
    plant,
    location,
    age,
    vendor,
    reference,
    dateFrom,
    dateTo,
    search,
  ]);

  const title =
    tab === "bulk"
      ? "Bulk Inventory"
      : tab === "packaging"
        ? "Packaging Stock"
        : tab === "grn"
          ? "GRN History"
          : "Roll Explorer";
  const description =
    tab === "bulk"
      ? "Material pools by category, quality code, plant, and location."
      : tab === "packaging"
        ? "Daily packaging stock, supply mode, movement mix, and low-stock visibility."
        : tab === "grn"
          ? "All inwards in one auditable ledger with correction trail."
          : "Every individual roll across raw, intermediate, job-work, and finished stock.";

  const rollExactSizeCount = useMemo(
    () => new Set(allRollRows.map(rollExactSize)).size,
    [allRollRows],
  );
  const rollExactThicknessCount = useMemo(
    () => new Set(allRollRows.map(rollThicknessExact)).size,
    [allRollRows],
  );
  const filterOptions = useMemo(() => {
    const useExactRollSize = rollExactSizeCount > 0 && rollExactSizeCount <= 12;
    const useExactRollThickness =
      rollExactThicknessCount > 0 && rollExactThicknessCount <= 12;
    return {
      rollSize: optionsFromValues(
        allRollRows.map((row) =>
          useExactRollSize ? rollExactSize(row) : rollWidthBand(row),
        ),
        "All Size",
      ),
      rollVariant: optionsFromValues(
        allRollRows.map((row) =>
          clean(row.variant_display_name || row.material_name),
        ),
        "All Variant",
      ),
      rollThickness: optionsFromValues(
        allRollRows.map((row) =>
          useExactRollThickness
            ? rollThicknessExact(row)
            : rollThicknessBand(row),
        ),
        "All Thickness",
      ),
      rollGrade: optionsFromValues(
        allRollRows.map((row) => clean(row.grade_name || row.grade_id)),
        "All Grade",
      ),
      rollFamily: optionsFromValues(
        allRollRows.map((row) =>
          clean(
            row.family_display_name || row.reporting_group || row.material_name,
          ),
        ),
        "All Family",
      ),
      rollJob: optionsFromValues(
        allRollRows.map((row) =>
          clean(
            row.created_job_number ||
              row.production_job_number ||
              row.created_job_id ||
              row.production_job_id,
          ),
        ),
        "All Job",
      ),
      bulkMaterial: optionsFromPairs(
        allBulkRows.map((row) => [
          row.material,
          `${row.material_code || "Material"} - ${row.material_name || "Material"}`,
        ]),
        "All Product",
      ),
      bulkCategory: optionsFromValues(
        allBulkRows.map((row) => upper(row.material_category || "OTHER")),
        "All Category",
      ),
      bulkGranule: optionsFromValues(
        allBulkRows.map((row) =>
          clean(row.granule_quality_code || row.granule_quality_code_id),
        ),
        "All Granule",
      ),
      packagingSku: optionsFromPairs(
        (packagingMaterials as any[]).map((row) => [
          row.id,
          `${row.code || "SKU"} - ${row.name || "Packaging"}`,
        ]),
        "All SKU",
      ),
      packagingKind: optionsFromValues(
        allPackagingRows.map((row) => upper(row.packaging_kind || "OTHER")),
        "All Kind",
      ),
      packagingSupplyMode: optionsFromValues(
        (packagingMaterials as any[]).map((row) =>
          upper(row.packaging_supply_mode || "PURCHASED"),
        ),
        "All Supply",
      ),
      grnMaterial: optionsFromPairs(
        allGrnRows.map((row) => [
          row.material,
          `${row.material_code || row.label_id || "Material"} - ${row.material_name || row.label_id || "Material"}`,
        ]),
        "All Material",
      ),
      grnVendor: optionsFromPairs(
        [
          ...(vendors as Vendor[]).map(
            (row) =>
              [
                row.code || row.name,
                row.code ? `${row.code} - ${row.name}` : row.name,
              ] as [unknown, unknown],
          ),
          ...allGrnRows.map(
            (row) =>
              [
                row.vendor_code || row.vendor_name || row.vendor,
                [row.vendor_code, row.vendor_name]
                  .filter(Boolean)
                  .join(" - ") ||
                  row.vendor_name ||
                  row.vendor_code ||
                  row.vendor ||
                  "Vendor",
              ] as [unknown, unknown],
          ),
          ...(vendor !== "ALL" ? [[vendor, vendor] as [unknown, unknown]] : []),
        ],
        "All Vendor",
      ),
    };
  }, [
    allRollRows,
    allBulkRows,
    allPackagingRows,
    allGrnRows,
    packagingMaterials,
    rollExactSizeCount,
    rollExactThicknessCount,
    vendor,
    vendors,
  ]);

  return (
    <div className="min-h-screen rounded-[28px] bg-surface-2 px-4 py-5 text-content-1 md:px-6">
      <div className="mx-auto max-w-[1440px] space-y-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-success-fg to-info-fg text-base font-black text-white shadow-sm">
              T
            </div>
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-content-3">
                Total Poly Print ERP
              </div>
              <div className="text-sm font-black text-content-1">Inventory</div>
            </div>
          </div>
          <Tabs value={tab} onValueChange={switchTab}>
            <TabsList className="flex h-auto flex-wrap justify-start gap-1 rounded-[14px] bg-surface-1/80 p-1 shadow-sm ring-1 ring-line">
              <TabsTrigger
                value="rolls"
                className="gap-2 rounded-[10px] px-4 py-2 text-xs font-black data-[state=active]:bg-surface-3 data-[state=active]:text-white data-[state=active]:shadow-none"
              >
                <Archive className="h-4 w-4" /> Roll Explorer
              </TabsTrigger>
              <TabsTrigger
                value="bulk"
                className="gap-2 rounded-[10px] px-4 py-2 text-xs font-black data-[state=active]:bg-surface-3 data-[state=active]:text-white data-[state=active]:shadow-none"
              >
                <Boxes className="h-4 w-4" /> Bulk Inventory
              </TabsTrigger>
              <TabsTrigger
                value="packaging"
                className="gap-2 rounded-[10px] px-4 py-2 text-xs font-black data-[state=active]:bg-surface-3 data-[state=active]:text-white data-[state=active]:shadow-none"
              >
                <Package className="h-4 w-4" /> Packaging Stock
              </TabsTrigger>
              <TabsTrigger
                value="grn"
                className="gap-2 rounded-[10px] px-4 py-2 text-xs font-black data-[state=active]:bg-surface-3 data-[state=active]:text-white data-[state=active]:shadow-none"
              >
                <ShieldCheck className="h-4 w-4" /> GRN History
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="mb-1 text-[10px] font-black uppercase tracking-[0.22em] text-content-3">
              Inventory · {tab === "grn" ? "Audit" : title}
            </div>
            <h1 className="text-3xl font-black tracking-tight text-content-1">
              {title}
            </h1>
            <p className="mt-1 max-w-3xl text-sm font-semibold leading-6 text-content-3">
              {description}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              className="h-10 rounded-xl border-line bg-surface-1 text-xs font-black shadow-sm hover:bg-surface-2"
              onClick={refreshWorkspace}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
            <Button
              className="h-10 rounded-xl bg-surface-3 text-xs font-black shadow-sm hover:bg-line"
              onClick={() => switchTab("grn")}
            >
              <ShieldCheck className="mr-2 h-4 w-4" />
              GRN History
            </Button>
          </div>
        </header>

        <InventoryFilterBar
          tab={tab}
          search={search}
          plant={plant}
          location={location}
          status={status}
          material={material}
          category={category}
          sourceType={sourceType}
          age={age}
          size={size}
          variant={variant}
          thickness={thickness}
          grade={grade}
          weight={weight}
          family={family}
          job={job}
          print={print}
          lamination={lamination}
          granule={granule}
          availability={availability}
          valueBand={valueBand}
          supplyMode={supplyMode}
          transactionType={transactionType}
          stockRange={stockRange}
          vendor={vendor}
          reference={reference}
          dateFrom={dateFrom}
          dateTo={dateTo}
          plants={plants as any[]}
          locations={allLocations as any[]}
          filterOptions={filterOptions}
          onChange={setParam}
        />

        <Tabs value={tab} onValueChange={switchTab} className="space-y-4">
          <TabsContent value="rolls" className="space-y-4">
            <StockTabHeader
              inner={inner}
              mode={mode}
              onChange={setParam}
              showCards
            />
            {inner === "pulse" ? (
              <InventoryPulsePanel
                kind="rolls"
                rows={rollRows}
                loading={rollsQuery.isLoading}
                onBrowse={setParam}
              />
            ) : (
              <InventoryBrowseTable kind="rolls" rows={rollRows} mode={mode} />
            )}
          </TabsContent>
          <TabsContent value="bulk" className="space-y-4">
            <StockTabHeader
              inner={inner}
              mode={mode}
              onChange={setParam}
              showCards
            />
            {inner === "pulse" ? (
              <InventoryPulsePanel
                kind="bulk"
                rows={bulkRows}
                loading={bulkQuery.isLoading}
                onBrowse={setParam}
              />
            ) : (
              <InventoryBrowseTable kind="bulk" rows={bulkRows} mode={mode} />
            )}
          </TabsContent>
          <TabsContent value="packaging" className="space-y-4">
            <StockTabHeader
              inner={inner}
              mode={mode}
              onChange={setParam}
              showCards
            />
            {inner === "pulse" ? (
              <InventoryPulsePanel
                kind="packaging"
                rows={packagingRows}
                txRows={packagingTxRows}
                loading={packagingQuery.isLoading}
                packagingMaterials={packagingMaterials as any[]}
                onBrowse={setParam}
              />
            ) : (
              <InventoryBrowseTable
                kind="packaging"
                rows={packagingRows}
                mode={mode}
                packagingMaterials={packagingMaterials as any[]}
              />
            )}
          </TabsContent>
          <TabsContent value="grn">
            <GrnHistoryTab
              rows={grnRows}
              loading={grnQuery.isLoading}
              onChanged={() => {
                grnQuery.refetch();
                qc.invalidateQueries({
                  queryKey: ["inventory-workspace-bulk"],
                });
                qc.invalidateQueries({
                  queryKey: ["inventory-workspace-packaging"],
                });
                qc.invalidateQueries({
                  queryKey: ["inventory-workspace-rolls"],
                });
              }}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function normalizeTab(
  value: string | null,
  fallback: WorkspaceTab = "rolls",
): WorkspaceTab {
  if (value === "bulk" || value === "packaging" || value === "grn")
    return value;
  return fallback;
}

function normalizeInner(value: string | null): InnerTab {
  return value === "browse" ? "browse" : "pulse";
}

function normalizeMode(value: string | null): ViewMode {
  return value === "cards" ? "cards" : "table";
}

export function InventoryFilterBar({
  tab,
  search,
  plant,
  location,
  status,
  material,
  category,
  sourceType,
  age,
  size,
  variant,
  thickness,
  grade,
  weight,
  family,
  job,
  print,
  lamination,
  granule,
  availability,
  valueBand,
  supplyMode,
  transactionType,
  stockRange,
  vendor,
  reference,
  dateFrom,
  dateTo,
  plants,
  locations,
  filterOptions,
  onChange,
}: {
  tab: WorkspaceTab;
  search: string;
  plant: string;
  location: string;
  status: string;
  material: string;
  category: string;
  sourceType: string;
  age: string;
  size: string;
  variant: string;
  thickness: string;
  grade: string;
  weight: string;
  family: string;
  job: string;
  print: string;
  lamination: string;
  granule: string;
  availability: string;
  valueBand: string;
  supplyMode: string;
  transactionType: string;
  stockRange: string;
  vendor: string;
  reference: string;
  dateFrom: string;
  dateTo: string;
  plants: any[];
  locations: any[];
  filterOptions: {
    rollSize: FilterOption[];
    rollVariant: FilterOption[];
    rollThickness: FilterOption[];
    rollGrade: FilterOption[];
    rollFamily: FilterOption[];
    rollJob: FilterOption[];
    bulkMaterial: FilterOption[];
    bulkCategory: FilterOption[];
    bulkGranule: FilterOption[];
    packagingSku: FilterOption[];
    packagingKind: FilterOption[];
    packagingSupplyMode: FilterOption[];
    grnMaterial: FilterOption[];
    grnVendor: FilterOption[];
  };
  onChange: (updates: Record<string, string | null>) => void;
}) {
  const activeLocations = locations.filter(
    (row) => plant === "ALL" || String(row.plant) === plant,
  );
  const savedViewScopeTitle =
    tab === "bulk"
      ? "Bulk Inventory"
      : tab === "packaging"
        ? "Packaging Stock"
        : tab === "grn"
          ? "GRN History"
          : "Roll Explorer";
  const searchPlaceholder =
    tab === "grn"
      ? "Search material, vendor, reference, label..."
      : tab === "rolls"
        ? "Search roll label, material, job, location..."
        : tab === "bulk"
          ? "Search material, category, granule, location..."
          : "Search packaging material, code, kind, plant, or location...";
  const resetPayload = {
    q: null,
    plant: null,
    location: null,
    status: null,
    material: null,
    category: null,
    source_type: null,
    age: null,
    size: null,
    variant: null,
    thickness: null,
    grade: null,
    weight: null,
    family: null,
    job: null,
    print: null,
    lamination: null,
    granule: null,
    availability: null,
    value: null,
    supply_mode: null,
    transaction_type: null,
    stock_range: null,
    vendor: null,
    reference: null,
    date_from: null,
    date_to: null,
  };
  const [savedViews, setSavedViews] = useState<InventorySavedView[]>([]);
  const [savedViewsMenuOpen, setSavedViewsMenuOpen] = useState(false);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [savedViewName, setSavedViewName] = useState("");

  useEffect(() => {
    setSavedViews(safeLoadSavedViews(tab));
    setSavedViewsMenuOpen(false);
    setSaveDialogOpen(false);
    setSavedViewName("");
  }, [tab]);

  const currentFilters = useMemo(() => {
    const raw: Record<(typeof INVENTORY_FILTER_KEYS)[number], string> = {
      q: search,
      plant,
      location,
      status,
      material,
      category,
      source_type: sourceType,
      age,
      size,
      variant,
      thickness,
      grade,
      weight,
      family,
      job,
      print,
      lamination,
      granule,
      availability,
      value: valueBand,
      supply_mode: supplyMode,
      transaction_type: transactionType,
      stock_range: stockRange,
      vendor,
      reference,
      date_from: dateFrom,
      date_to: dateTo,
    };
    return Object.fromEntries(
      Object.entries(raw).filter(([, value]) => value && value !== "ALL"),
    ) as Record<string, string>;
  }, [
    age,
    availability,
    category,
    dateFrom,
    dateTo,
    family,
    grade,
    granule,
    job,
    lamination,
    location,
    material,
    plant,
    print,
    reference,
    search,
    size,
    sourceType,
    status,
    stockRange,
    supplyMode,
    tab,
    thickness,
    transactionType,
    valueBand,
    variant,
    vendor,
    weight,
  ]);

  const currentFilterFingerprint = useMemo(
    () => filterFingerprint(currentFilters),
    [currentFilters],
  );
  const activeFilterCount = Object.keys(currentFilters).length;
  const savedViewSummary = compactFilterSummary(currentFilters, 4);
  const currentFilterBadges = useMemo(() => {
    const materialOptions =
      tab === "bulk"
        ? filterOptions.bulkMaterial
        : tab === "packaging"
          ? filterOptions.packagingSku
          : tab === "grn"
            ? filterOptions.grnMaterial
            : filterOptions.rollVariant;
    const categoryOptions =
      tab === "bulk"
        ? filterOptions.bulkCategory
        : tab === "packaging"
          ? filterOptions.packagingKind
          : [];
    const vendorOptions = filterOptions.grnVendor;
    const labelFor = (key: string, value: string) => {
      if (key === "q") return `Search: ${value}`;
      if (key === "plant")
        return `Plant: ${plants.find((row) => String(row.id) === value)?.name || value}`;
      if (key === "location")
        return `Location: ${locations.find((row) => String(row.id) === value)?.name || value}`;
      if (key === "material")
        return `${tab === "packaging" ? "SKU" : "Material"}: ${optionLabel(materialOptions, value)}`;
      if (key === "category")
        return `${tab === "packaging" ? "Kind" : "Category"}: ${optionLabel(categoryOptions, value)}`;
      if (key === "source_type")
        return `Source: ${optionLabel(SOURCE_OPTIONS, value)}`;
      if (key === "size")
        return `Size: ${optionLabel(filterOptions.rollSize, value)}`;
      if (key === "variant")
        return `Variant: ${optionLabel(filterOptions.rollVariant, value)}`;
      if (key === "thickness")
        return `Thickness: ${optionLabel(filterOptions.rollThickness, value)}`;
      if (key === "grade")
        return `Grade: ${optionLabel(filterOptions.rollGrade, value)}`;
      if (key === "weight")
        return `Weight: ${optionLabel(ROLL_WEIGHT_OPTIONS, value)}`;
      if (key === "family")
        return `Family: ${optionLabel(filterOptions.rollFamily, value)}`;
      if (key === "job")
        return `Job: ${optionLabel(filterOptions.rollJob, value)}`;
      if (key === "print") return `Print: ${optionLabel(PRINT_OPTIONS, value)}`;
      if (key === "lamination")
        return `Lamination: ${optionLabel(LAMINATION_OPTIONS, value)}`;
      if (key === "granule")
        return `Granule: ${optionLabel(filterOptions.bulkGranule, value)}`;
      if (key === "availability")
        return `Availability: ${optionLabel(STOCK_AVAILABILITY_OPTIONS, value)}`;
      if (key === "value")
        return `Value: ${optionLabel(VALUE_BAND_OPTIONS, value)}`;
      if (key === "supply_mode")
        return `Supply: ${optionLabel(filterOptions.packagingSupplyMode, value)}`;
      if (key === "transaction_type")
        return `Movement: ${optionLabel(PACKAGING_TRANSACTION_OPTIONS, value)}`;
      if (key === "stock_range")
        return `Stock: ${optionLabel(PACKAGING_STOCK_RANGE_OPTIONS, value)}`;
      if (key === "vendor")
        return `Vendor: ${optionLabel(vendorOptions, value)}`;
      if (key === "age")
        return `Age: ${optionLabel(AGE_FILTER_OPTIONS, value)}`;
      if (key === "date_from") return `From: ${value}`;
      if (key === "date_to") return `To: ${value}`;
      return `${formatOptionLabel(key)}: ${formatOptionLabel(value)}`;
    };
    return Object.entries(currentFilters).map(([key, value]) =>
      labelFor(key, value),
    );
  }, [currentFilters, filterOptions, locations, plants, tab]);

  function persistSavedViews(nextViews: InventorySavedView[]) {
    setSavedViews(nextViews);
    safeSaveSavedViews(tab, nextViews);
  }

  function openSaveViewDialog() {
    const timestamp = formatDisplayDateTime(new Date());
    setSavedViewName(
      activeFilterCount
        ? `${savedViewScopeTitle} view · ${timestamp}`
        : `${savedViewScopeTitle} · All stock`,
    );
    setSavedViewsMenuOpen(false);
    window.setTimeout(() => setSaveDialogOpen(true), 0);
  }

  function saveCurrentView() {
    const name = savedViewName.trim();
    if (!name) {
      toast.error("Name this saved view first.");
      return;
    }
    const now = new Date().toISOString();
    const existing = savedViews.find(
      (view) => view.name.toLowerCase() === name.toLowerCase(),
    );
    const nextView: InventorySavedView = {
      id: existing?.id || makeSavedViewId(),
      name,
      filters: currentFilters,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    const nextViews = [
      nextView,
      ...savedViews.filter((view) => view.id !== nextView.id),
    ].slice(0, 20);
    persistSavedViews(nextViews);
    setSaveDialogOpen(false);
    setSavedViewsMenuOpen(false);
    toast.success(existing ? "Saved view updated." : "Saved view added.");
  }

  function applySavedView(view: InventorySavedView) {
    const resetThenApply: Record<string, string | null> = {};
    INVENTORY_FILTER_KEYS.forEach((key) => {
      resetThenApply[key] = view.filters[key] || null;
    });
    onChange(resetThenApply);
    setSavedViewsMenuOpen(false);
    toast.success(`Loaded view: ${view.name}`);
  }

  function deleteSavedView(viewId: string) {
    const view = savedViews.find((item) => item.id === viewId);
    persistSavedViews(savedViews.filter((item) => item.id !== viewId));
    if (view) toast.success(`Deleted view: ${view.name}`);
  }

  return (
    <div className="rounded-[22px] border border-line bg-surface-1/95 p-3 shadow-[0_18px_60px_rgba(15,23,42,0.06)]">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="relative min-w-[260px] flex-1 xl:max-w-md">
          <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-content-4" />
          <Input
            value={search}
            onChange={(event) => onChange({ q: event.target.value || null })}
            className="h-11 rounded-2xl border-line bg-surface-1 pl-11 text-sm font-semibold text-content-2 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition placeholder:text-content-3 hover:border-success-border hover:bg-success-bg focus-visible:border-success-border focus-visible:ring-2 focus-visible:ring-success-border"
            placeholder={searchPlaceholder}
            data-testid="inventory-search"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {tab === "rolls" ? (
            <>
              <FilterSelect
                value={size}
                onChange={(value) => onChange({ size: value })}
                options={filterOptions.rollSize}
                label="Size"
                testId="inventory-filter-size"
              />
              <FilterSelect
                value={variant}
                onChange={(value) => onChange({ variant: value })}
                options={filterOptions.rollVariant}
                label="Variant"
                testId="inventory-filter-variant"
                widthClassName="w-[190px]"
              />
              <FilterSelect
                value={thickness}
                onChange={(value) => onChange({ thickness: value })}
                options={filterOptions.rollThickness}
                label="Thickness"
                testId="inventory-filter-thickness"
              />
              <FilterSelect
                value={grade}
                onChange={(value) => onChange({ grade: value })}
                options={filterOptions.rollGrade}
                label="Grade"
                testId="inventory-filter-grade"
              />
              <FilterSelect
                value={weight}
                onChange={(value) => onChange({ weight: value })}
                options={ROLL_WEIGHT_OPTIONS}
                label="Weight"
                testId="inventory-filter-weight"
              />
            </>
          ) : null}
          {tab === "bulk" ? (
            <>
              <FilterSelect
                value={material}
                onChange={(value) => onChange({ material: value })}
                options={filterOptions.bulkMaterial}
                label="Product"
                testId="inventory-filter-material"
                widthClassName="w-[240px]"
              />
              <FilterSelect
                value={granule}
                onChange={(value) => onChange({ granule: value })}
                options={filterOptions.bulkGranule}
                label="Granule"
                testId="inventory-filter-granule"
              />
              <FilterSelect
                value={availability}
                onChange={(value) => onChange({ availability: value })}
                options={STOCK_AVAILABILITY_OPTIONS}
                label="Availability"
                testId="inventory-filter-availability"
              />
              <FilterSelect
                value={valueBand}
                onChange={(value) => onChange({ value })}
                options={VALUE_BAND_OPTIONS}
                label="Value"
                testId="inventory-filter-value"
              />
            </>
          ) : null}
          {tab === "packaging" ? (
            <>
              <FilterSelect
                value={material}
                onChange={(value) => onChange({ material: value })}
                options={filterOptions.packagingSku}
                label="SKU"
                testId="inventory-filter-sku"
                widthClassName="w-[240px]"
              />
              <FilterSelect
                value={supplyMode}
                onChange={(value) => onChange({ supply_mode: value })}
                options={filterOptions.packagingSupplyMode}
                label="Supply"
                testId="inventory-filter-supply"
              />
              <FilterSelect
                value={transactionType}
                onChange={(value) => onChange({ transaction_type: value })}
                options={PACKAGING_TRANSACTION_OPTIONS}
                label="Movement"
                testId="inventory-filter-transaction"
              />
              <FilterSelect
                value={stockRange}
                onChange={(value) => onChange({ stock_range: value })}
                options={PACKAGING_STOCK_RANGE_OPTIONS}
                label="Stock"
                testId="inventory-filter-stock-range"
              />
            </>
          ) : null}
          {tab === "grn" ? (
            <>
              <FilterSelect
                value={material}
                onChange={(value) => onChange({ material: value })}
                options={filterOptions.grnMaterial}
                label="Material"
                testId="inventory-filter-grn-material"
                widthClassName="w-[240px]"
              />
              <FilterSelect
                value={vendor}
                onChange={(value) => onChange({ vendor: value })}
                options={filterOptions.grnVendor}
                label="Vendor"
                testId="inventory-filter-vendor"
                widthClassName="w-[190px]"
              />
              <FilterTextInput
                value={reference}
                onChange={(value) => onChange({ reference: value })}
                label="Reference"
                testId="inventory-filter-reference"
              />
              <FilterDateInput
                value={dateFrom}
                onChange={(value) => onChange({ date_from: value })}
                label="From"
                testId="inventory-filter-date-from"
              />
              <FilterDateInput
                value={dateTo}
                onChange={(value) => onChange({ date_to: value })}
                label="To"
                testId="inventory-filter-date-to"
              />
            </>
          ) : null}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
        {tab === "grn" ? (
          <FilterSelect
            value={sourceType}
            onChange={(value) => onChange({ source_type: value })}
            options={SOURCE_OPTIONS}
            label="Source"
            testId="inventory-filter-source"
          />
        ) : null}
        {tab === "rolls" ? (
          <>
            <FilterSelect
              value={status}
              onChange={(value) => onChange({ status: value })}
              options={STATUS_OPTIONS}
              label="Status"
              testId="inventory-filter-status"
            />
            <FilterSelect
              value={family}
              onChange={(value) => onChange({ family: value })}
              options={filterOptions.rollFamily}
              label="Family"
              testId="inventory-filter-family"
            />
            <FilterSelect
              value={print}
              onChange={(value) => onChange({ print: value })}
              options={PRINT_OPTIONS}
              label="Print"
              testId="inventory-filter-print"
            />
            <FilterSelect
              value={lamination}
              onChange={(value) => onChange({ lamination: value })}
              options={LAMINATION_OPTIONS}
              label="Lamination"
              testId="inventory-filter-lamination"
            />
            <FilterSelect
              value={job}
              onChange={(value) => onChange({ job: value })}
              options={filterOptions.rollJob}
              label="Job"
              testId="inventory-filter-job"
            />
          </>
        ) : null}
        {tab === "bulk" || tab === "packaging" ? (
          <FilterSelect
            value={category}
            onChange={(value) => onChange({ category: value })}
            options={
              tab === "bulk"
                ? filterOptions.bulkCategory
                : filterOptions.packagingKind
            }
            label={tab === "bulk" ? "Category" : "Kind"}
            testId="inventory-filter-category"
          />
        ) : null}
        <FilterSelect
          value={age}
          onChange={(value) => onChange({ age: value })}
          options={AGE_FILTER_OPTIONS}
          label="Age"
          testId="inventory-filter-age"
        />
        <Select
          value={plant}
          onValueChange={(value) => onChange({ plant: value, location: null })}
        >
          <SelectTrigger
            data-testid="inventory-filter-plant"
            className={cn(
              FILTER_TRIGGER_BASE_CLASS,
              "w-[160px]",
              plant !== "ALL"
                ? FILTER_TRIGGER_ACTIVE_CLASS
                : FILTER_TRIGGER_IDLE_CLASS,
            )}
          >
            <SelectValue placeholder="Plant" />
          </SelectTrigger>
          <SelectContent className={FILTER_MENU_CLASS}>
            <SelectItem className={FILTER_ITEM_CLASS} value="ALL">
              All plants
            </SelectItem>
            {plants.map((row) => (
              <SelectItem
                className={FILTER_ITEM_CLASS}
                key={row.id}
                value={String(row.id)}
              >
                {row.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={location}
          onValueChange={(value) => onChange({ location: value })}
        >
          <SelectTrigger
            data-testid="inventory-filter-location"
            className={cn(
              FILTER_TRIGGER_BASE_CLASS,
              "w-[180px]",
              location !== "ALL"
                ? FILTER_TRIGGER_ACTIVE_CLASS
                : FILTER_TRIGGER_IDLE_CLASS,
            )}
          >
            <SelectValue placeholder="Location" />
          </SelectTrigger>
          <SelectContent className={FILTER_MENU_CLASS}>
            <SelectItem className={FILTER_ITEM_CLASS} value="ALL">
              All locations
            </SelectItem>
            {activeLocations.map((row) => (
              <SelectItem
                className={FILTER_ITEM_CLASS}
                key={row.id}
                value={String(row.id)}
              >
                {row.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DropdownMenu
          open={savedViewsMenuOpen}
          onOpenChange={setSavedViewsMenuOpen}
        >
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              data-testid="inventory-saved-views-trigger"
              className={cn(
                "h-10 rounded-full border-line bg-surface-1 px-4 text-xs font-black text-[#0f172a] shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition hover:border-success-border hover:bg-success-bg",
                savedViews.length
                  ? "border-success-border bg-success-bg/50 text-success-fg"
                  : "",
              )}
            >
              <Bookmark className="mr-2 h-3.5 w-3.5" />
              Saved views
              {savedViews.length ? (
                <span className="ml-2 rounded-full bg-surface-1 px-1.5 py-0.5 text-[10px] text-success-fg ring-1 ring-success-border">
                  {savedViews.length}
                </span>
              ) : null}
              <ChevronDown className="ml-2 h-3.5 w-3.5 text-content-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-[340px] rounded-2xl border-line bg-surface-1 p-2 shadow-[0_24px_60px_-22px_rgba(15,23,42,0.35)]"
          >
            <div className="rounded-xl bg-surface-2 px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-[0.18em] text-content-3">
                    My saved views
                  </div>
                  <div className="mt-0.5 text-xs font-semibold text-content-3">
                    {savedViewScopeTitle} ·{" "}
                    {activeFilterCount
                      ? `${activeFilterCount} active filters`
                      : "No filters active"}
                  </div>
                </div>
                <span className="grid h-8 w-8 place-items-center rounded-full bg-surface-1 text-success-fg shadow-sm ring-1 ring-line">
                  <Bookmark className="h-4 w-4" />
                </span>
              </div>
              {currentFilterBadges.length ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {currentFilterBadges.slice(0, 4).map((badge) => (
                    <span
                      key={badge}
                      className="max-w-full truncate rounded-full bg-surface-1 px-2 py-1 text-[10px] font-bold text-content-3 ring-1 ring-line"
                    >
                      {badge}
                    </span>
                  ))}
                  {currentFilterBadges.length > 4 ? (
                    <span className="rounded-full bg-surface-1 px-2 py-1 text-[10px] font-bold text-content-3 ring-1 ring-line">
                      +{currentFilterBadges.length - 4}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="mt-2 max-h-[260px] space-y-1 overflow-y-auto pr-1">
              {savedViews.length === 0 ? (
                <div className="rounded-xl border border-dashed border-line bg-surface-1 px-3 py-5 text-center">
                  <BookmarkPlus className="mx-auto h-5 w-5 text-success-fg" />
                  <div className="mt-2 text-sm font-black text-content-1">
                    No saved views yet
                  </div>
                  <div className="mt-1 text-xs font-semibold leading-5 text-content-3">
                    Save this filter setup once, then reload it from any
                    inventory visit.
                  </div>
                </div>
              ) : (
                savedViews.map((view) => {
                  const isCurrent =
                    filterFingerprint(view.filters) ===
                    currentFilterFingerprint;
                  return (
                    <div
                      key={view.id}
                      className={cn(
                        "group flex items-center gap-2 rounded-xl border px-2 py-2 transition",
                        isCurrent
                          ? "border-success-border bg-success-bg"
                          : "border-transparent hover:border-line hover:bg-surface-2",
                      )}
                    >
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        onClick={() => applySavedView(view)}
                      >
                        <span
                          className={cn(
                            "grid h-8 w-8 shrink-0 place-items-center rounded-full",
                            isCurrent
                              ? "bg-success-fg text-white"
                              : "bg-surface-1 text-content-3 ring-1 ring-line",
                          )}
                        >
                          <Bookmark className="h-3.5 w-3.5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="truncate text-sm font-black text-content-1">
                              {view.name}
                            </span>
                            {isCurrent ? (
                              <span className="shrink-0 rounded-full bg-surface-1 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-[0.12em] text-success-fg ring-1 ring-success-border">
                                Current
                              </span>
                            ) : null}
                          </span>
                          <span className="mt-0.5 block truncate text-[11px] font-semibold text-content-3">
                            {compactFilterSummary(view.filters, 2)}
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete saved view ${view.name}`}
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-content-4 opacity-70 transition hover:bg-danger-bg hover:text-danger-fg group-hover:opacity-100"
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          deleteSavedView(view.id);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            <DropdownMenuSeparator className="my-2 bg-surface-2" />
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-black text-success-fg transition hover:bg-success-bg"
              onClick={openSaveViewDialog}
            >
              <BookmarkPlus className="h-4 w-4" />
              Save current filters as view
            </button>
            <div className="px-3 pb-1 pt-1 text-[11px] font-semibold leading-5 text-content-3">
              Views are saved in this browser for {savedViewScopeTitle}.
              Applying a view replaces the current filters.
            </div>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="outline"
          className="h-10 rounded-full border-line bg-surface-1 px-4 text-xs font-black text-[#0f172a] shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition hover:border-success-border hover:bg-success-bg hover:text-[#0f172a]"
          onClick={() => onChange(resetPayload)}
        >
          Reset
        </Button>
      </div>
      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent className="rounded-[24px] border-line bg-surface-1 p-0 shadow-[0_24px_80px_rgba(15,23,42,0.22)] sm:max-w-lg">
          <div className="rounded-t-[24px] bg-gradient-to-br from-success-bg via-white to-info-bg px-6 py-5">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-xl font-black text-content-1">
                <BookmarkPlus className="h-5 w-5 text-success-fg" />
                Save inventory view
              </DialogTitle>
              <DialogDescription className="pt-1 text-sm font-semibold leading-6 text-content-3">
                Name this filter setup so it can be reopened quickly from the
                saved views menu.
              </DialogDescription>
            </DialogHeader>
          </div>
          <div className="space-y-4 px-6 pb-6">
            <div className="space-y-2">
              <Label
                htmlFor="inventory-saved-view-name"
                className="text-xs font-black uppercase tracking-[0.16em] text-content-3"
              >
                View name
              </Label>
              <Input
                id="inventory-saved-view-name"
                data-testid="inventory-saved-view-name"
                value={savedViewName}
                onChange={(event) => setSavedViewName(event.target.value)}
                placeholder="Example: Fresh printed PET rolls"
                className="h-12 rounded-2xl border-line text-base font-bold"
                onKeyDown={(event) => {
                  if (event.key === "Enter") saveCurrentView();
                }}
              />
            </div>
            <div className="rounded-2xl border border-line bg-surface-2 p-3">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-content-3">
                Current filter snapshot
              </div>
              <div className="mt-1 text-sm font-bold leading-6 text-content-2">
                {savedViewSummary}
              </div>
              {currentFilterBadges.length ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {currentFilterBadges.map((badge) => (
                    <span
                      key={badge}
                      className="rounded-full bg-surface-1 px-2 py-1 text-[11px] font-bold text-content-3 ring-1 ring-line"
                    >
                      {badge}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                className="rounded-xl"
                onClick={() => setSaveDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="rounded-xl bg-surface-3 font-black hover:bg-line"
                onClick={saveCurrentView}
              >
                Save view
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FilterSelect({
  value,
  onChange,
  options,
  label,
  testId,
  widthClassName = "w-[155px]",
}: {
  value: string;
  onChange: (value: string) => void;
  options: FilterOption[];
  label: string;
  testId?: string;
  widthClassName?: string;
}) {
  const active = value !== "ALL";
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger
        data-testid={testId}
        className={cn(
          FILTER_TRIGGER_BASE_CLASS,
          widthClassName,
          active ? FILTER_TRIGGER_ACTIVE_CLASS : FILTER_TRIGGER_IDLE_CLASS,
        )}
      >
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent className={FILTER_MENU_CLASS}>
        {options.map((option) => (
          <SelectItem
            className={FILTER_ITEM_CLASS}
            key={option.value}
            value={option.value}
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function FilterTextInput({
  value,
  onChange,
  label,
  testId,
}: {
  value: string;
  onChange: (value: string | null) => void;
  label: string;
  testId: string;
}) {
  const active = value !== "ALL";
  return (
    <Input
      value={active ? value : ""}
      onChange={(event) => onChange(event.target.value || null)}
      placeholder={label}
      data-testid={testId}
      className={cn(
        "h-10 w-[150px] rounded-full px-4 text-xs font-black transition-all duration-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_10px_24px_rgba(15,23,42,0.055)] focus-visible:ring-2 focus-visible:ring-success-border",
        active
          ? "border-success-border bg-gradient-to-br from-success-bg via-white to-success-bg text-success-fg placeholder:text-success-fg shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_12px_28px_rgba(16,185,129,0.14)]"
          : "border-info-border bg-gradient-to-br from-white via-info-bg to-success-bg text-content-2 placeholder:text-content-3 hover:border-success-border hover:from-success-bg hover:via-white hover:to-info-bg hover:text-success-fg",
      )}
    />
  );
}

function FilterDateInput({
  value,
  onChange,
  label,
  testId,
}: {
  value: string;
  onChange: (value: string | null) => void;
  label: string;
  testId: string;
}) {
  const active = Boolean(value);
  return (
    <Input
      value={value}
      onChange={(event) => onChange(event.target.value || null)}
      type="date"
      aria-label={label}
      data-testid={testId}
      className={cn(
        "h-10 w-[148px] rounded-full px-4 text-xs font-black transition-all duration-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.92),0_10px_24px_rgba(15,23,42,0.055)] focus-visible:ring-2 focus-visible:ring-success-border",
        active
          ? "border-success-border bg-gradient-to-br from-success-bg via-white to-success-bg text-success-fg shadow-[inset_0_1px_0_rgba(255,255,255,0.96),0_12px_28px_rgba(16,185,129,0.14)]"
          : "border-info-border bg-gradient-to-br from-white via-info-bg to-success-bg text-content-2 hover:border-success-border hover:from-success-bg hover:via-white hover:to-info-bg hover:text-success-fg",
      )}
    />
  );
}

function StockTabHeader({
  inner,
  mode,
  onChange,
  showCards,
}: {
  inner: InnerTab;
  mode: ViewMode;
  onChange: (updates: Record<string, string | null>) => void;
  showCards?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-[20px] border border-line bg-surface-1/95 p-2 shadow-[0_14px_45px_rgba(15,23,42,0.05)] md:flex-row md:items-center md:justify-between">
      <Tabs value={inner} onValueChange={(value) => onChange({ view: value })}>
        <TabsList className="h-auto gap-1 rounded-2xl bg-surface-2 p-1">
          <TabsTrigger
            value="pulse"
            className="gap-2 rounded-xl px-5 py-2 text-xs font-black data-[state=active]:bg-surface-1 data-[state=active]:text-success-fg data-[state=active]:shadow-sm"
          >
            <Activity className="h-4 w-4" /> Pulse
          </TabsTrigger>
          <TabsTrigger
            value="browse"
            className="gap-2 rounded-xl px-5 py-2 text-xs font-black data-[state=active]:bg-surface-1 data-[state=active]:text-success-fg data-[state=active]:shadow-sm"
          >
            <TableProperties className="h-4 w-4" /> Browse
          </TabsTrigger>
        </TabsList>
      </Tabs>
      {inner === "browse" && showCards ? (
        <Tabs value={mode} onValueChange={(value) => onChange({ mode: value })}>
          <TabsList className="h-auto gap-1 rounded-2xl bg-surface-2 p-1">
            <TabsTrigger
              value="table"
              className="rounded-xl px-4 py-2 text-xs font-black data-[state=active]:bg-surface-1 data-[state=active]:shadow-sm"
            >
              Table
            </TabsTrigger>
            <TabsTrigger
              value="cards"
              className="rounded-xl px-4 py-2 text-xs font-black data-[state=active]:bg-surface-1 data-[state=active]:shadow-sm"
            >
              Cards
            </TabsTrigger>
          </TabsList>
        </Tabs>
      ) : null}
    </div>
  );
}

export function InventoryPulsePanel({
  kind,
  rows,
  txRows = [],
  loading,
  packagingMaterials = [],
  onBrowse,
}: {
  kind: "rolls" | "bulk" | "packaging";
  rows: any[];
  txRows?: PackagingTransactionRow[];
  loading?: boolean;
  packagingMaterials?: any[];
  onBrowse?: (updates: Record<string, string | null>) => void;
}) {
  const metrics = useMemo(() => {
    if (kind === "rolls") {
      const totalKg = rows.reduce((sum, row) => sum + num(row.weight_kg), 0);
      const reserved = rows
        .filter((row) => String(row.status).toUpperCase() === "RESERVED")
        .reduce((sum, row) => sum + num(row.weight_kg), 0);
      return {
        count: rows.length,
        totalKg,
        reserved,
        value: 0,
        aged: rows.filter((row) => ageBand(row.created_at) === "Aged").length,
      };
    }
    if (kind === "bulk") {
      const totalKg = rows.reduce((sum, row) => sum + num(row.qty_kg), 0);
      const value = rows.reduce(
        (sum, row) => sum + num(row.qty_kg) * num(row.avg_cost),
        0,
      );
      return {
        count: rows.length,
        totalKg,
        reserved: 0,
        value,
        aged: rows.filter((row) => ageBand(row.updated_at) === "Aged").length,
      };
    }
    const totalQty = rows.reduce((sum, row) => sum + num(row.qty), 0);
    const value = rows.reduce(
      (sum, row) => sum + num(row.qty) * num(row.avg_cost),
      0,
    );
    return {
      count: rows.length,
      totalKg: totalQty,
      reserved: 0,
      value,
      aged: rows.filter((row) => ageBand(row.updated_at) === "Aged").length,
    };
  }, [kind, rows]);

  const massByMain = useMemo(() => {
    if (kind === "rolls")
      return groupSum(
        rows,
        (row) => row.family_display_name || row.material_name || "Rolls",
        (row) => num(row.weight_kg),
      );
    if (kind === "bulk")
      return groupSum(
        rows,
        (row) => row.material_category || "OTHER",
        (row) => num(row.qty_kg),
      );
    return groupSum(
      rows,
      (row) => row.packaging_kind || "OTHER",
      (row) => num(row.qty),
    );
  }, [kind, rows]);
  const plantData = useMemo(
    () =>
      groupSum(
        rows,
        (row) => displayPlant(row),
        (row) =>
          kind === "packaging"
            ? num(row.qty)
            : kind === "bulk"
              ? num(row.qty_kg)
              : num(row.weight_kg),
      ),
    [kind, rows],
  );
  const ageData = useMemo(
    () =>
      groupSum(
        rows,
        (row) => ageBand(row.created_at || row.updated_at),
        (row) =>
          kind === "packaging"
            ? num(row.qty)
            : kind === "bulk"
              ? num(row.qty_kg)
              : num(row.weight_kg),
        3,
      ),
    [kind, rows],
  );
  const txData = useMemo(
    () =>
      groupSum(
        txRows,
        (row) => row.type || "OTHER",
        (row) => Math.abs(num(row.qty)),
      ),
    [txRows],
  );
  const packagingUom = useMemo(
    () =>
      kind === "packaging" ? packagingRowsUom(rows, packagingMaterials) : "kg",
    [kind, rows, packagingMaterials],
  );
  const stageData = useMemo(() => {
    if (kind === "rolls")
      return groupSum(
        rows,
        (row) => row.stage_name || row.status || "Stock",
        () => 1,
        8,
      );
    if (kind === "bulk")
      return groupSum(
        rows,
        (row) => row.granule_quality_code || row.material_category || "Stock",
        (row) => num(row.qty_kg),
        8,
      );
    return groupSum(
      rows,
      (row) => row.packaging_kind || "Packaging",
      (row) => num(row.qty),
      8,
    );
  }, [kind, rows]);

  if (loading)
    return (
      <div className="rounded-[24px] border border-line bg-surface-1 p-8 text-sm text-content-3">
        Loading inventory pulse...
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <InventoryKpiCard
          label={kind === "rolls" ? "Rolls" : "Stock Nodes"}
          value={metrics.count}
          note="Visible rows"
          icon={Layers3}
          accent="bg-primary"
        />
        <InventoryKpiCard
          label={kind === "packaging" ? "On Hand Qty" : "On Hand KG"}
          value={
            kind === "packaging"
              ? formatQty(metrics.totalKg, packagingUom)
              : formatKg(metrics.totalKg)
          }
          note="Filtered stock position"
          icon={Warehouse}
          accent="bg-success-fg"
        />
        <InventoryKpiCard
          label="Reserved / Locked"
          value={kind === "rolls" ? formatKg(metrics.reserved) : "-"}
          note={
            kind === "rolls" ? "Reserved roll mass" : "No lock column in v1"
          }
          icon={ShieldCheck}
          accent="bg-warning-fg"
        />
        <InventoryKpiCard
          label="Visible Value"
          value={kind === "rolls" ? "-" : formatMoney(metrics.value)}
          note="Based on avg cost"
          icon={Package}
          accent="bg-info-fg"
        />
        <InventoryKpiCard
          label="Aged Lines"
          value={metrics.aged}
          note="More than 30 days"
          icon={AlertTriangle}
          accent="bg-danger-solid"
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <ChartCard
          title={
            kind === "rolls"
              ? "Variant / Family KG"
              : kind === "bulk"
                ? "Category Mass Split"
                : "Stock By Packaging Kind"
          }
          data={massByMain}
          chart="bar"
        />
        <ChartCard title="Plant Allocation" data={plantData} chart="donut" />
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.4fr)]">
        <FreshnessBandCard
          data={ageData}
          total={kind === "packaging" ? metrics.totalKg : metrics.totalKg}
          unit={kind === "packaging" ? packagingUom.toLowerCase() : "kg"}
        />
        <StageDistributionCard
          data={kind === "packaging" && txData.length ? txData : stageData}
          title={
            kind === "rolls"
              ? "Rolls by production stage"
              : kind === "bulk"
                ? "Bulk by quality / category"
                : "Packaging movement / kind"
          }
        />
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <LargestPositionsCard
          kind={kind}
          rows={rows}
          packagingMaterials={packagingMaterials}
          onBrowse={onBrowse}
        />
        <AgeHeatmap kind={kind} rows={rows} onBrowse={onBrowse} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <InventoryHeatmap
          kind={kind}
          rows={rows}
          packagingMaterials={packagingMaterials}
          onBrowse={onBrowse}
        />
        {kind === "packaging" ? (
          <ChartCard title="Packaging Movement Mix" data={txData} chart="bar" />
        ) : (
          <ChartCard
            title="Top Locations"
            data={groupSum(
              rows,
              (row) => displayLocation(row),
              (row) => stockQty(kind, row),
              8,
            )}
            chart="bar"
          />
        )}
      </div>
    </div>
  );
}

function InventoryKpiCard({
  label,
  value,
  note,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string | number;
  note: string;
  icon: any;
  accent: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-[18px] border border-line bg-surface-1 p-4 shadow-[0_18px_50px_rgba(15,23,42,0.06)]">
      <div className={cn("absolute left-0 top-0 h-full w-1", accent)} />
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.18em] text-content-3">
            {label}
          </div>
          <div className="mt-2 text-2xl font-black tracking-tight text-content-1">
            {value}
          </div>
          <div className="mt-1 text-xs font-semibold text-content-3">
            {note}
          </div>
        </div>
        <div className="grid h-10 w-10 place-items-center rounded-2xl bg-surface-2 text-content-2 ring-1 ring-line">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

function FreshnessBandCard({
  data,
  total,
  unit,
}: {
  data: Array<{ name: string; value: number }>;
  total: number;
  unit: string;
}) {
  const ordered = ["Fresh", "Watch", "Aged"].map((name) => ({
    name,
    value: data.find((row) => row.name === name)?.value || 0,
  }));
  const fillClass: Record<string, string> = {
    Fresh: "bg-success-fg",
    Watch: "bg-warning-fg",
    Aged: "bg-danger-solid",
  };
  const textClass: Record<string, string> = {
    Fresh: "text-success-fg",
    Watch: "text-warning-fg",
    Aged: "text-danger-fg",
  };
  const labels: Record<string, string> = {
    Fresh: "Fresh · <= 7 days",
    Watch: "Watch · 8-30 days",
    Aged: "Aged · > 30 days",
  };
  return (
    <Card className="min-w-0 rounded-[22px] border-line bg-surface-1 shadow-[0_18px_55px_rgba(15,23,42,0.06)]">
      <CardHeader className="pb-2">
        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-content-3">
          Freshness Bands
        </div>
        <CardTitle className="text-base font-black text-content-1">
          How old is your stock
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {ordered.map((row) => {
          const pct =
            total > 0 ? Math.max(3, Math.round((row.value / total) * 100)) : 0;
          return (
            <div key={row.name} className="space-y-2">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className={cn("font-black", textClass[row.name])}>
                  {labels[row.name]}
                </span>
                <span className="font-semibold text-content-3">
                  {formatShort(row.value)} {unit}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                <div
                  className={cn("h-full rounded-full", fillClass[row.name])}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

function StageDistributionCard({
  data,
  title,
}: {
  data: Array<{ name: string; value: number }>;
  title: string;
}) {
  const max = Math.max(1, ...data.map((row) => row.value));
  return (
    <Card className="min-w-0 rounded-[22px] border-line bg-surface-1 shadow-[0_18px_55px_rgba(15,23,42,0.06)]">
      <CardHeader className="pb-2">
        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-content-3">
          Stage Distribution
        </div>
        <CardTitle className="text-base font-black text-content-1">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <div className="grid h-[220px] place-items-center text-sm text-content-4">
            No stock split in the current filters.
          </div>
        ) : (
          <div className="flex h-[240px] items-end justify-around gap-4 border-t border-line pt-5">
            {data.slice(0, 8).map((row, index) => (
              <div
                key={row.name}
                className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2"
              >
                <div className="text-xs font-black text-primary">
                  {formatShort(row.value)}
                </div>
                <div
                  className="w-full max-w-[68px] rounded-t-lg bg-primary shadow-sm"
                  style={{
                    height: `${Math.max(18, (row.value / max) * 180)}px`,
                    opacity: 0.92 - index * 0.03,
                  }}
                />
                <div className="w-full truncate text-center text-[11px] font-semibold text-content-3">
                  {row.name.replaceAll("_", " ")}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function LargestPositionsCard({
  kind,
  rows,
  packagingMaterials = [],
  onBrowse,
}: {
  kind: "rolls" | "bulk" | "packaging";
  rows: any[];
  packagingMaterials?: any[];
  onBrowse?: (updates: Record<string, string | null>) => void;
}) {
  const positions = useMemo(() => {
    const grouped = groupSum(
      rows,
      (row) => stockTitle(kind, row),
      (row) => stockQty(kind, row),
      5,
    );
    return grouped.map((item) => {
      const sample = rows.find((row) => stockTitle(kind, row) === item.name);
      const unit =
        kind === "packaging" && sample
          ? packagingBaseUom(sample, packagingMaterials)
          : kind === "packaging"
            ? "qty"
            : "kg";
      return {
        ...item,
        subtitle: sample ? stockSubtitle(kind, sample) : "Filtered stock",
        unit,
      };
    });
  }, [kind, rows, packagingMaterials]);
  return (
    <Card className="rounded-[22px] border-line bg-surface-1 shadow-[0_18px_55px_rgba(15,23,42,0.06)]">
      <CardHeader className="pb-2">
        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-content-3">
          Largest Positions
        </div>
        <CardTitle className="text-base font-black text-content-1">
          Click a row to jump to Browse pre-filtered
        </CardTitle>
      </CardHeader>
      <CardContent>
        {positions.length === 0 ? (
          <div className="grid h-[250px] place-items-center text-sm text-content-4">
            No stock positions.
          </div>
        ) : (
          <div className="divide-y divide-line">
            {positions.map((row, index) => (
              <button
                key={`${row.name}-${index}`}
                type="button"
                className="flex w-full items-center gap-4 py-3 text-left transition hover:bg-surface-2"
                onClick={() => onBrowse?.({ view: "browse", q: row.name })}
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-3 text-sm font-black text-white">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base font-black text-content-1">
                    {row.name}
                  </span>
                  <span className="block truncate text-xs font-semibold text-content-3">
                    {row.subtitle}
                  </span>
                </span>
                <span className="text-lg font-black text-success-fg">
                  {formatShort(row.value)} {row.unit}
                </span>
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ChartCard({
  title,
  data,
  chart,
}: {
  title: string;
  data: Array<{ name: string; value: number }>;
  chart: "bar" | "donut";
}) {
  return (
    <Card className="min-w-0 rounded-[22px] border-line bg-surface-1 shadow-[0_18px_55px_rgba(15,23,42,0.06)]">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.16em] text-content-3">
          <Activity className="h-4 w-4 text-success-fg" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="h-[300px]">
        {data.length === 0 ? (
          <div className="grid h-full place-items-center text-sm text-content-4">
            No measurable stock in the current filters.
          </div>
        ) : chart === "bar" ? (
          <CssBarChart data={data} />
        ) : (
          <div className="grid h-full gap-3 md:grid-cols-[1fr_190px] md:items-center">
            <CssDonut data={data} />
            <div className="space-y-3">
              {data.slice(0, 6).map((entry, index) => {
                const total = data.reduce((sum, row) => sum + row.value, 0);
                const pct =
                  total > 0 ? Math.round((entry.value / total) * 100) : 0;
                return (
                  <div
                    key={entry.name}
                    className="flex items-center justify-between gap-3 text-sm"
                  >
                    <span className="inline-flex min-w-0 items-center gap-2 font-semibold text-content-3">
                      <span
                        className="h-3 w-3 shrink-0 rounded"
                        style={{
                          backgroundColor:
                            CHART_COLORS[index % CHART_COLORS.length],
                        }}
                      />
                      <span className="truncate">{entry.name}</span>
                    </span>
                    <span className="shrink-0 font-black text-content-2">
                      {pct}%
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CssBarChart({
  data,
}: {
  data: Array<{ name: string; value: number }>;
}) {
  const max = Math.max(1, ...data.map((row) => row.value));
  const gridLines = [1, 0.75, 0.5, 0.25, 0];
  return (
    <div className="relative flex h-full flex-col justify-end overflow-hidden">
      <div className="absolute inset-x-0 top-4 bottom-11">
        {gridLines.map((line) => (
          <div
            key={line}
            className="absolute left-12 right-0 border-t border-dashed border-line"
            style={{ top: `${(1 - line) * 100}%` }}
          >
            <span className="absolute -left-12 -top-2 text-[11px] font-semibold text-content-3">
              {formatShort(max * line)}
            </span>
          </div>
        ))}
      </div>
      <div className="relative z-10 ml-12 flex h-[220px] items-end gap-4">
        {data.slice(0, 8).map((entry, index) => (
          <div
            key={entry.name}
            className="flex min-w-0 flex-1 flex-col items-center gap-2"
          >
            <div
              className="w-full max-w-[72px] rounded-t-lg shadow-sm transition hover:opacity-90"
              style={{
                height: `${Math.max(16, (entry.value / max) * 190)}px`,
                backgroundColor: CHART_COLORS[index % CHART_COLORS.length],
              }}
              title={`${entry.name}: ${formatShort(entry.value)}`}
            />
            <div className="w-full truncate text-center text-[11px] font-semibold text-content-3">
              {entry.name.replaceAll("_", " ")}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CssDonut({ data }: { data: Array<{ name: string; value: number }> }) {
  const total = data.reduce((sum, row) => sum + row.value, 0);
  let cursor = 0;
  const stops = data.map((entry, index) => {
    const start = cursor;
    const pct = total > 0 ? (entry.value / total) * 100 : 0;
    cursor += pct;
    return `${CHART_COLORS[index % CHART_COLORS.length]} ${start}% ${cursor}%`;
  });
  return (
    <div className="grid h-full min-h-[220px] place-items-center">
      <div
        className="relative grid h-48 w-48 place-items-center rounded-full"
        style={{ background: `conic-gradient(${stops.join(", ")})` }}
      >
        <div className="grid h-28 w-28 place-items-center rounded-full bg-surface-1 shadow-inner">
          <div className="text-center">
            <div className="text-[10px] font-black uppercase tracking-[0.16em] text-content-3">
              Total
            </div>
            <div className="text-2xl font-black text-content-1">
              {formatShort(total)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AgeHeatmap({
  kind,
  rows,
  onBrowse,
}: {
  kind: "rolls" | "bulk" | "packaging";
  rows: any[];
  onBrowse?: (updates: Record<string, string | null>) => void;
}) {
  const matrix = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    for (const row of rows) {
      const label =
        kind === "rolls"
          ? row.family_display_name || row.material_name || "Rolls"
          : row.material_category ||
            row.packaging_kind ||
            row.material_name ||
            "Material";
      const col = ageColumn(stockDate(row));
      const value = stockQty(kind, row);
      if (!map.has(label)) map.set(label, new Map());
      map.get(label)!.set(col, (map.get(label)!.get(col) || 0) + value);
    }
    const rowEntries = Array.from(map.entries())
      .sort((a, b) => {
        const aTotal = AGE_COLUMNS.reduce(
          (sum, col) => sum + (a[1].get(col) || 0),
          0,
        );
        const bTotal = AGE_COLUMNS.reduce(
          (sum, col) => sum + (b[1].get(col) || 0),
          0,
        );
        return bTotal - aTotal;
      })
      .slice(0, 8);
    const max = Math.max(
      1,
      ...rowEntries.flatMap(([, inner]) =>
        AGE_COLUMNS.map((col) => inner.get(col) || 0),
      ),
    );
    return { rowEntries, max };
  }, [kind, rows]);

  return (
    <Card className="rounded-[22px] border-line bg-surface-1 shadow-[0_18px_55px_rgba(15,23,42,0.06)]">
      <CardHeader className="pb-2">
        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-content-3">
          Age Heatmap
        </div>
        <CardTitle className="text-base font-black text-content-1">
          Family x age band, {kind === "packaging" ? "qty" : "kg"} per cell
        </CardTitle>
      </CardHeader>
      <CardContent>
        {matrix.rowEntries.length === 0 ? (
          <div className="grid h-[250px] place-items-center text-sm text-content-4">
            No dated stock rows in the current filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[560px] space-y-2">
              <div className="grid grid-cols-[128px_repeat(4,minmax(92px,1fr))] gap-2 text-[11px] font-black text-content-3">
                <div />
                {AGE_COLUMNS.map((col) => (
                  <div key={col} className="text-center">
                    {col}
                  </div>
                ))}
              </div>
              {matrix.rowEntries.map(([label, inner]) => (
                <div
                  key={label}
                  className="grid grid-cols-[128px_repeat(4,minmax(92px,1fr))] gap-2"
                >
                  <div className="truncate py-2 text-xs font-black text-content-2">
                    {label}
                  </div>
                  {AGE_COLUMNS.map((col) => {
                    const value = inner.get(col) || 0;
                    const ratio = value / matrix.max;
                    const tone =
                      col === ">60d"
                        ? `rgba(239,68,68,${Math.max(0.08, ratio)})`
                        : col === "31-60d"
                          ? `rgba(245,158,11,${Math.max(0.08, ratio)})`
                          : `rgba(16,185,129,${Math.max(0.08, ratio)})`;
                    return (
                      <button
                        key={col}
                        type="button"
                        data-testid={`inventory-age-heatmap-cell-${kind}`}
                        className="rounded-lg px-2 py-3 text-center text-xs font-black text-content-2 ring-1 ring-line-strong transition hover:ring-2 hover:ring-success-border"
                        style={{
                          backgroundColor: value ? tone : "var(--surface-2)",
                        }}
                        title={`${label} ${col}: ${formatShort(value)}`}
                        onClick={() =>
                          onBrowse?.(
                            kind === "rolls"
                              ? {
                                  view: "browse",
                                  family: label,
                                  age: ageFromHeatmapColumn(col),
                                }
                              : {
                                  view: "browse",
                                  q: label,
                                  age: ageFromHeatmapColumn(col),
                                },
                          )
                        }
                      >
                        {value ? formatShort(value) : "0"}
                      </button>
                    );
                  })}
                </div>
              ))}
              <div className="flex gap-3 pt-3 text-[11px] font-semibold text-content-3">
                <span className="inline-flex items-center gap-1">
                  <span className="h-3 w-3 rounded bg-success-bg" /> low
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-3 w-3 rounded bg-warning-bg" /> mid
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-3 w-3 rounded bg-danger-bg" /> high
                </span>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function InventoryHeatmap({
  kind,
  rows,
  onBrowse,
}: {
  kind: "rolls" | "bulk" | "packaging";
  rows: any[];
  packagingMaterials?: any[];
  onBrowse?: (updates: Record<string, string | null>) => void;
}) {
  const matrix = useMemo(() => {
    const map = new Map<string, Map<string, number>>();
    const exactRollSizeCount =
      kind === "rolls" ? new Set(rows.map(rollExactSize)).size : 0;
    const useExactRollSize = exactRollSizeCount > 0 && exactRollSizeCount <= 8;
    for (const row of rows) {
      const label =
        kind === "rolls"
          ? row.variant_display_name ||
            row.family_display_name ||
            row.material_name ||
            "Roll"
          : row.material_name || "Material";
      const col =
        kind === "rolls"
          ? useExactRollSize
            ? rollExactSize(row)
            : `${rollWidthBand(row)} · ${rollThicknessBand(row)}`
          : kind === "bulk"
            ? String(
                row.granule_quality_code || row.material_category || "Stock",
              )
            : String(row.packaging_kind || "Packaging");
      const value =
        kind === "packaging"
          ? num(row.qty)
          : kind === "bulk"
            ? num(row.qty_kg)
            : num(row.weight_kg);
      if (!map.has(label)) map.set(label, new Map());
      map.get(label)!.set(col, (map.get(label)!.get(col) || 0) + value);
    }
    const cols = Array.from(
      new Set(
        Array.from(map.values()).flatMap((inner) => Array.from(inner.keys())),
      ),
    )
      .sort((a, b) => {
        const aTotal = Array.from(map.values()).reduce(
          (sum, inner) => sum + (inner.get(a) || 0),
          0,
        );
        const bTotal = Array.from(map.values()).reduce(
          (sum, inner) => sum + (inner.get(b) || 0),
          0,
        );
        return bTotal - aTotal;
      })
      .slice(0, 8);
    const rowEntries = Array.from(map.entries())
      .sort((a, b) => {
        const aTotal = cols.reduce((sum, col) => sum + (a[1].get(col) || 0), 0);
        const bTotal = cols.reduce((sum, col) => sum + (b[1].get(col) || 0), 0);
        return bTotal - aTotal;
      })
      .slice(0, 8);
    const max = Math.max(
      1,
      ...rowEntries.flatMap(([, inner]) =>
        cols.map((col) => inner.get(col) || 0),
      ),
    );
    return { cols, rowEntries, max };
  }, [kind, rows]);

  return (
    <Card className="rounded-[22px] border-line bg-surface-1 shadow-[0_18px_55px_rgba(15,23,42,0.06)]">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-content-3">
          <Thermometer className="h-4 w-4 text-danger-fg" />
          Size / Variant Matrix
        </div>
        <CardTitle className="text-base font-black text-content-1">
          Variant x size group, {kind === "packaging" ? "qty" : "kg"} per cell
        </CardTitle>
      </CardHeader>
      <CardContent>
        {matrix.cols.length === 0 ? (
          <div className="grid h-[250px] place-items-center text-sm text-content-4">
            No size or variant rows in the current filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[620px] space-y-2">
              <div className="grid grid-cols-[180px_repeat(8,minmax(80px,1fr))] gap-2 text-[11px] font-black uppercase tracking-[0.12em] text-content-4">
                <div>Variant</div>
                {matrix.cols.map((col) => (
                  <div key={col} className="truncate text-center">
                    {col}
                  </div>
                ))}
              </div>
              {matrix.rowEntries.map(([label, inner]) => (
                <div
                  key={label}
                  className="grid grid-cols-[180px_repeat(8,minmax(80px,1fr))] gap-2"
                >
                  <div className="truncate rounded-lg bg-surface-2 px-3 py-2 text-xs font-bold text-content-2">
                    {label}
                  </div>
                  {matrix.cols.map((col) => {
                    const value = inner.get(col) || 0;
                    const alpha = Math.max(0.08, value / matrix.max);
                    return (
                      <button
                        key={col}
                        type="button"
                        data-testid={`inventory-size-heatmap-cell-${kind}`}
                        className="rounded-lg px-2 py-2 text-center text-xs font-black text-content-1 ring-1 ring-success-border transition hover:ring-2 hover:ring-success-border"
                        style={{
                          backgroundColor: `rgba(13, 148, 136, ${alpha})`,
                        }}
                        title={`${label} ${col}: ${value.toLocaleString()}`}
                        onClick={() =>
                          onBrowse?.(
                            kind === "rolls"
                              ? { view: "browse", variant: label, size: col }
                              : { view: "browse", q: `${label} ${col}` },
                          )
                        }
                      >
                        {value
                          ? value.toLocaleString(undefined, {
                              maximumFractionDigits: 0,
                            })
                          : "-"}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function InventoryBrowseTable({
  kind,
  rows,
  mode,
  packagingMaterials = [],
}: {
  kind: "rolls" | "bulk" | "packaging";
  rows: any[];
  mode: ViewMode;
  packagingMaterials?: any[];
}) {
  if (mode === "cards") {
    return (
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.slice(0, 60).map((row) => (
          <InventoryCard
            key={row.id}
            kind={kind}
            row={row}
            packagingMaterials={packagingMaterials}
          />
        ))}
        {rows.length === 0 ? <EmptyBrowse /> : null}
      </div>
    );
  }
  return (
    <Card className="rounded-[22px] border-line shadow-sm">
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow className="bg-surface-2">
              <TableHead>Item</TableHead>
              <TableHead>Class</TableHead>
              <TableHead>Plant / Location</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead>Age</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.slice(0, 300).map((row) => (
              <InventoryRow
                key={row.id}
                kind={kind}
                row={row}
                packagingMaterials={packagingMaterials}
              />
            ))}
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6}>
                  <EmptyBrowse />
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function InventoryRow({
  kind,
  row,
  packagingMaterials,
}: {
  kind: "rolls" | "bulk" | "packaging";
  row: any;
  packagingMaterials: any[];
}) {
  const material = packagingMaterials.find(
    (item) => String(item.id) === String(row.material),
  );
  const qty =
    kind === "rolls"
      ? formatKg(num(row.weight_kg))
      : kind === "bulk"
        ? formatKg(num(row.qty_kg))
        : formatQty(num(row.qty), packagingBaseUom(row, packagingMaterials));
  const ageDate = row.created_at || row.updated_at;
  return (
    <TableRow>
      <TableCell>
        <div className="font-black text-content-1">
          {kind === "rolls" ? row.label_id : row.material_name}
        </div>
        <div className="text-xs text-content-3">
          {kind === "rolls"
            ? row.variant_display_name || row.material_name
            : row.material_code}
        </div>
        {kind === "rolls" && (productionBatchLabel(row) || routeNodeLabel(row)) ? (
          <div className="mt-1 flex flex-wrap gap-1">
            {productionBatchLabel(row) ? (
              <span className="rounded-full border border-info-border bg-info-bg px-2 py-0.5 text-[10px] font-black text-primary">
                {productionBatchLabel(row)}
              </span>
            ) : null}
            {routeNodeLabel(row) ? (
              <span className="rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[10px] font-bold text-content-3">
                {routeNodeLabel(row)}
              </span>
            ) : null}
          </div>
        ) : null}
      </TableCell>
      <TableCell>
        {kind === "rolls" ? (
          <SemanticBadge kind="jobState" value={row.status} />
        ) : (
          <SemanticBadge
            kind={kind === "bulk" ? "materialCategory" : "packagingKind"}
            value={kind === "bulk" ? row.material_category : row.packaging_kind}
          />
        )}
      </TableCell>
      <TableCell>
        <div className="font-medium">{displayPlant(row)}</div>
        <div className="text-xs text-content-3">{displayLocation(row)}</div>
      </TableCell>
      <TableCell className="text-right font-black">{qty}</TableCell>
      <TableCell>
        <AgePill date={ageDate} />
      </TableCell>
      <TableCell>
        {kind === "packaging"
          ? String(material?.packaging_supply_mode || "PURCHASED").replaceAll(
              "_",
              " ",
            )
          : kind === "bulk"
            ? row.granule_quality_code || "Stock"
            : row.stage_name}
      </TableCell>
    </TableRow>
  );
}

function InventoryCard({
  kind,
  row,
  packagingMaterials,
}: {
  kind: "rolls" | "bulk" | "packaging";
  row: any;
  packagingMaterials: any[];
}) {
  const material = packagingMaterials.find(
    (item) => String(item.id) === String(row.material),
  );
  const title = kind === "rolls" ? row.label_id : row.material_name;
  const qty =
    kind === "rolls"
      ? formatKg(num(row.weight_kg))
      : kind === "bulk"
        ? formatKg(num(row.qty_kg))
        : formatQty(num(row.qty), packagingBaseUom(row, packagingMaterials));
  return (
    <Card className="rounded-[20px] border-line shadow-sm">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-black text-content-1">{title}</div>
            <div className="mt-1 text-xs font-medium text-content-3">
              {kind === "rolls"
                ? row.variant_display_name || row.material_name
                : row.material_code}
            </div>
          </div>
          <AgePill date={row.created_at || row.updated_at} />
        </div>
        <div className="text-2xl font-black tracking-tight text-content-1">
          {qty}
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-surface-2 px-2 py-1 font-bold text-content-3">
            {displayPlant(row)}
          </span>
          <span className="rounded-full bg-surface-2 px-2 py-1 font-bold text-content-3">
            {displayLocation(row)}
          </span>
          {kind === "rolls" && productionBatchLabel(row) ? (
            <span className="rounded-full bg-info-bg px-2 py-1 font-bold text-primary">
              {productionBatchLabel(row)}
            </span>
          ) : null}
          {kind === "rolls" && routeNodeLabel(row) ? (
            <span className="rounded-full bg-surface-2 px-2 py-1 font-bold text-content-3">
              {routeNodeLabel(row)}
            </span>
          ) : null}
          {kind === "packaging" ? (
            <span className="rounded-full bg-success-bg px-2 py-1 font-bold text-success-fg">
              {String(
                material?.packaging_supply_mode || "PURCHASED",
              ).replaceAll("_", " ")}
            </span>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function AgePill({ date }: { date?: string | null }) {
  const band = ageBand(date);
  return (
    <span
      className={cn(
        "rounded-full px-2 py-1 text-[11px] font-black",
        band === "Fresh"
          ? "bg-success-bg text-success-fg"
          : band === "Watch"
            ? "bg-warning-bg text-warning-fg"
            : "bg-danger-bg text-danger-fg",
      )}
    >
      {band} {ageDays(date)}d
    </span>
  );
}

function EmptyBrowse() {
  return (
    <div className="grid min-h-[180px] place-items-center text-center text-sm font-medium text-content-3">
      No rows match the current filters.
    </div>
  );
}

export function GrnHistoryTab({
  rows,
  loading,
  onChanged,
}: {
  rows: GrnHistoryRow[];
  loading?: boolean;
  onChanged: () => void;
}) {
  const [selected, setSelected] = useState<GrnHistoryRow | null>(null);

  if (loading)
    return (
      <div className="rounded-[24px] border border-line bg-surface-1 p-8 text-sm text-content-3">
        Loading GRN history...
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <SummaryStatCard
          label="Inward Rows"
          value={rows.length}
          subLabel="Bulk, roll, and packaging"
          icon={CalendarDays}
          toneClassName="bg-info-bg text-primary"
        />
        <SummaryStatCard
          label="Inward KG / Qty"
          value={rows
            .reduce((sum, row) => sum + num(row.quantity), 0)
            .toLocaleString(undefined, { maximumFractionDigits: 1 })}
          subLabel="Current filtered history"
          icon={Warehouse}
          toneClassName="bg-success-bg text-success-fg"
        />
        <SummaryStatCard
          label="Correction Policy"
          value="Immutable"
          subLabel="Edits post audited deltas"
          icon={ShieldCheck}
          toneClassName="bg-warning-bg text-warning-fg"
        />
      </div>
      <Card className="rounded-[22px] border-line shadow-sm">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-surface-2">
                <TableHead>Date</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Material / Ref</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Plant / Location</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={`${row.source_type}-${row.source_id}`}>
                  <TableCell className="whitespace-nowrap text-xs font-bold text-content-3">
                    {row.created_at
                      ? formatDisplayDateTime(row.created_at)
                      : "-"}
                  </TableCell>
                  <TableCell>
                    <SemanticBadge
                      kind="jobState"
                      value={row.source_type}
                      label={row.source_type}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="font-black text-content-1">
                      {row.label_id || row.material_name || row.material_code}
                    </div>
                    <div className="text-xs text-content-3">
                      {row.reference || row.batch_no || "No reference"}
                    </div>
                  </TableCell>
                  <TableCell>
                    {row.vendor_name || row.vendor_code || "-"}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">
                      {displayPlant(row)}
                    </div>
                    <div className="text-xs text-content-3">
                      {displayLocation(row)}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-black">
                    {formatQty(num(row.quantity), row.uom)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setSelected(row)}
                    >
                      <Edit3 className="mr-2 h-3.5 w-3.5" />
                      Correct
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7}>
                    <EmptyBrowse />
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <CorrectionDialog
        row={selected}
        onOpenChange={(open) => !open && setSelected(null)}
        onChanged={onChanged}
      />
    </div>
  );
}

function CorrectionDialog({
  row,
  onOpenChange,
  onChanged,
}: {
  row: GrnHistoryRow | null;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const qc = useQueryClient();
  const [quantity, setQuantity] = useState("");
  const [avgCost, setAvgCost] = useState("");
  const [reference, setReference] = useState("");
  const [labelId, setLabelId] = useState("");
  const [batchNo, setBatchNo] = useState("");
  const [reason, setReason] = useState("");

  const mutation = useMutation({
    mutationFn: () => {
      if (!row) throw new Error("No GRN row selected.");
      return inventoryService.correctGrnHistoryRow(
        row.source_type,
        row.source_id,
        {
          reason,
          quantity: quantity.trim() ? Number(quantity) : undefined,
          avg_cost: avgCost.trim() ? Number(avgCost) : undefined,
          reference: reference.trim() || undefined,
          label_id: labelId.trim() || undefined,
          batch_no: batchNo.trim() || undefined,
        },
      );
    },
    onSuccess: () => {
      toast.success("GRN correction posted with audit trail.");
      qc.invalidateQueries({ queryKey: ["stock-lifecycle"] });
      qc.invalidateQueries({ queryKey: ["inventory"] });
      onOpenChange(false);
      setQuantity("");
      setAvgCost("");
      setReference("");
      setLabelId("");
      setBatchNo("");
      setReason("");
      onChanged();
    },
    onError: (error: any) => {
      toast.error(
        error?.response?.data?.error || error?.message || "Correction failed",
      );
    },
  });

  return (
    <Dialog open={Boolean(row)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl rounded-[24px]">
        <DialogHeader>
          <DialogTitle className="text-xl font-black">
            Correct GRN History Row
          </DialogTitle>
        </DialogHeader>
        {row ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-warning-border bg-warning-bg p-4 text-sm font-medium text-warning-fg">
              The original GRN remains locked. This action posts a correction
              entry and stores before/after, delta, user, and reason.
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <Label>Corrected quantity</Label>
                <Input
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                  placeholder={String(row.quantity || 0)}
                  type="number"
                  step="0.001"
                />
              </div>
              <div>
                <Label>Corrected unit rate</Label>
                <Input
                  value={avgCost}
                  onChange={(event) => setAvgCost(event.target.value)}
                  placeholder={String(row.avg_cost || 0)}
                  type="number"
                  step="0.01"
                  disabled={row.source_type === "ROLL"}
                />
                <div className="mt-1 text-xs font-medium text-content-3">
                  Per {row.uom || "unit"} rate, not total invoice value.
                </div>
              </div>
              <div>
                <Label>Reference</Label>
                <Input
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
                  placeholder={row.reference || "Reference"}
                />
              </div>
              {row.source_type === "ROLL" ? (
                <>
                  <div>
                    <Label>Label ID</Label>
                    <Input
                      value={labelId}
                      onChange={(event) => setLabelId(event.target.value)}
                      placeholder={row.label_id || "Label"}
                    />
                  </div>
                  <div>
                    <Label>Batch No</Label>
                    <Input
                      value={batchNo}
                      onChange={(event) => setBatchNo(event.target.value)}
                      placeholder={row.batch_no || "Batch"}
                    />
                  </div>
                </>
              ) : null}
            </div>
            <div>
              <Label>Reason required</Label>
              <Textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Explain why this inward correction is needed."
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                disabled={!reason.trim() || mutation.isPending}
                onClick={() => mutation.mutate()}
                className="bg-surface-3 hover:bg-line"
              >
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Post Correction
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  BarChart3,
  CalendarClock,
  CalendarRange,
  CheckCircle2,
  ClipboardList,
  Download,
  ExternalLink,
  Factory,
  FileSpreadsheet,
  FileText,
  History,
  Layers,
  Lock,
  Package,
  PackageCheck,
  Puzzle,
  RefreshCw,
  Scale,
  ShieldCheck,
  Sparkles,
  Wheat,
  Droplets,
  FlaskConical,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";
import { factoryService } from "@/services/factory";
import { inventoryService, type StockCardPayload } from "@/services/inventory";
import { logisticsService } from "@/services/logistics";
import {
  stockLifecycleService,
  type InventoryFinancialPeriod,
  type MasterCatalog,
} from "@/services/stock-lifecycle";

import { OpenStockTab } from "./open-stock-tab";
import { CountTab } from "./count-tab";
import { CloseTab } from "./close-tab";
import { formatDisplayDate } from "@/lib/date-format";

export type StockLifecycleTab =
  | "overview"
  | "open"
  | "count"
  | "close"
  | "snapshots";

interface CategoryDef {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
}

export const CATEGORY_META: CategoryDef[] = [
  {
    key: "FILM_VARIANT",
    label: "Rolls",
    icon: PackageCheck,
    accent: "from-primary to-info-fg",
  },
  {
    key: "GRANULE",
    label: "Granule",
    icon: Wheat,
    accent: "from-warning-fg to-warm",
  },
  {
    key: "INK",
    label: "Ink",
    icon: Droplets,
    accent: "from-order-fg to-danger-solid",
  },
  {
    key: "SOLVENT",
    label: "Solvent",
    icon: FlaskConical,
    accent: "from-success-fg to-success-bg0",
  },
  {
    key: "ADHESIVE",
    label: "Adhesive",
    icon: Sparkles,
    accent: "from-danger-solid to-warm",
  },
  {
    key: "PACKAGING",
    label: "Packaging",
    icon: Package,
    accent: "from-order-fg to-order-fg",
  },
  {
    key: "ADDON",
    label: "Add-ons",
    icon: Puzzle,
    accent: "from-info-fg to-order-fg",
  },
  {
    key: "POD",
    label: "POD",
    icon: Layers,
    accent: "from-surface-2 to-surface-2",
  },
];

const TABS: Array<{
  key: StockLifecycleTab;
  label: string;
  sub: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    key: "overview",
    label: "Overview",
    sub: "Valuation, ageing, movement",
    icon: BarChart3,
  },
  { key: "open", label: "Open stock", sub: "FY opening balances", icon: Scale },
  {
    key: "count",
    label: "Physical count",
    sub: "Floor count and variance",
    icon: ClipboardList,
  },
  {
    key: "close",
    label: "FY close",
    sub: "Annual lock and roll forward",
    icon: Lock,
  },
  {
    key: "snapshots",
    label: "Month close & history",
    sub: "Monthly snapshots, counts, stock card",
    icon: History,
  },
];

const STOCK_CLASS_COLORS: Record<string, string> = {
  BULK: "#6366f1",
  ROLL: "#10b981",
  PACKAGING: "#f59e0b",
  TRADING: "#f43f5e",
  OTHER: "#64748b",
};

function currentFinancialYear() {
  const now = new Date();
  const year =
    now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
  return `${year}-${year + 1}`;
}

function monthShort(value?: string | Date | null) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return "Current";
  return date.toLocaleString("en-IN", { month: "short" });
}

function money(value: unknown, compact = false) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || Math.abs(number) < 1) return "Rs 0";
  if (compact) {
    if (Math.abs(number) >= 10_000_000)
      return `Rs ${(number / 10_000_000).toLocaleString("en-IN", { maximumFractionDigits: 2 })} Cr`;
    if (Math.abs(number) >= 100_000)
      return `Rs ${(number / 100_000).toLocaleString("en-IN", { maximumFractionDigits: 1 })} L`;
  }
  return `Rs ${number.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function qty(value: unknown, digits = 1) {
  const number = Number(value || 0);
  return number.toLocaleString("en-IN", { maximumFractionDigits: digits });
}

function qtyWithUom(value: unknown, uom?: string | null, digits = 2) {
  const suffix = uom ? ` ${uom}` : "";
  return `${qty(value, digits)}${suffix}`;
}

function pct(value: unknown) {
  const number = Number(value || 0);
  return `${number.toLocaleString("en-IN", { maximumFractionDigits: 1 })}%`;
}

function localDateInputValue(value?: string | Date | null) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 10);
}

function stockSourceLabel(row: Record<string, any>) {
  const sourceDoc = String(row.meta?.source_doc || "").replace(/_/g, " ");
  return sourceDoc || String(row.source || "Stock movement").replace(/_/g, " ");
}

function rowValue(row: Record<string, any>) {
  const direct = Number(
    row.value ?? row.display_value ?? row.stock_value ?? row.closing_value ?? 0,
  );
  if (Number.isFinite(direct) && direct > 0) return direct;
  const qtyValue = Number(
    row.qty ?? row.quantity ?? row.qty_kg ?? row.weight_kg ?? 0,
  );
  const rate = Number(row.rate ?? row.avg_cost ?? row.balance_rate ?? 0);
  if (!Number.isFinite(qtyValue) || !Number.isFinite(rate)) return 0;
  return Math.max(0, qtyValue * rate);
}

function rowQty(row: Record<string, any>) {
  return (
    Number(
      row.qty ??
        row.quantity ??
        row.qty_kg ??
        row.weight_kg ??
        row.system_qty ??
        0,
    ) || 0
  );
}

function stockClass(row: Record<string, any>) {
  return String(
    row.stock_class ||
      row.stockClass ||
      row.klass ||
      row.source_type ||
      "OTHER",
  ).toUpperCase();
}

function materialCategory(row: Record<string, any>) {
  return String(row.material_category || row.category || "").toUpperCase();
}

function reportingClass(row: Record<string, any>) {
  const klass = stockClass(row);
  const category = materialCategory(row);
  if (klass === "PACKAGING" || category === "ADDON" || category === "PACKAGING")
    return "PACKAGING";
  if (klass === "ROLL") return "ROLL";
  if (klass === "BULK") return "BULK";
  return klass;
}

function normalizeTab(value: string | null): StockLifecycleTab {
  const raw = String(value || "").toLowerCase();
  if (raw === "opening" || raw === "open-stock") return "open";
  if (raw === "physical-count" || raw === "stock-count") return "count";
  if (
    raw === "yearclose" ||
    raw === "year-close" ||
    raw === "period" ||
    raw === "close"
  )
    return "close";
  if (raw === "stockcard" || raw === "history" || raw === "snapshot")
    return "snapshots";
  if (TABS.some((tab) => tab.key === raw)) return raw as StockLifecycleTab;
  return "overview";
}

function periodTone(status?: string) {
  const normalized = String(status || "").toUpperCase();
  if (normalized === "CLOSED")
    return "border-line-strong bg-surface-3 text-white";
  if (normalized === "CLOSING_IN_PROGRESS")
    return "border-warning-border bg-warning-bg text-warning-fg";
  if (normalized === "OPEN")
    return "border-success-border bg-success-bg text-success-fg";
  return "border-line bg-surface-1 text-content-3";
}

function firstRateGap(rows: Array<Record<string, any>>) {
  return rows.some(
    (row) =>
      rowQty(row) > 0 &&
      !Number(row.rate ?? row.avg_cost ?? row.balance_rate ?? 0),
  );
}

function movementBucket(movements: Record<string, any>, patterns: RegExp[]) {
  return Object.entries(movements || {})
    .filter(([key]) => patterns.some((pattern) => pattern.test(key)))
    .reduce((sum, [, value]) => sum + Number(value || 0), 0);
}

function ageInDays(value?: string | null) {
  if (!value) return 0;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 0;
  return Math.max(0, Math.floor((Date.now() - parsed.getTime()) / 86_400_000));
}

function buildAgeRows(snapshot: any) {
  const rows: Array<{
    code: string;
    name: string;
    stockClass: string;
    days: number;
    value: number;
    qty: number;
  }> = [];
  for (const row of snapshot?.bulk || []) {
    const qtyValue = Number(row.qty_kg ?? row.quantity ?? 0) || 0;
    const klass = materialCategory(row) === "ADDON" ? "PACKAGING" : "BULK";
    rows.push({
      code: row.material_code || "-",
      name: row.material_name || "Bulk material",
      stockClass: klass,
      days: ageInDays(row.updated_at),
      value: qtyValue * Number(row.avg_cost || 0),
      qty: qtyValue,
    });
  }
  for (const row of snapshot?.rolls || []) {
    const qtyValue = Number(row.weight_kg || 0) || 0;
    rows.push({
      code: row.label_id || row.material_code || "-",
      name: row.material_name || "Roll",
      stockClass: "ROLL",
      days: Number(row.age_days || 0),
      value: qtyValue * Number(row.avg_cost || row.rate || 0),
      qty: qtyValue,
    });
  }
  for (const row of snapshot?.packaging || []) {
    const qtyValue = Number(row.qty || row.quantity || 0) || 0;
    rows.push({
      code: row.material_code || "-",
      name: row.material_name || "Packaging",
      stockClass: "PACKAGING",
      days: ageInDays(row.updated_at),
      value: qtyValue * Number(row.avg_cost || 0),
      qty: qtyValue,
    });
  }
  return rows.filter((row) => row.qty > 0);
}

function buildTopMovers(stockCard?: StockCardPayload) {
  const map = new Map<string, { label: string; qty: number; value: number }>();
  for (const row of stockCard?.rows || []) {
    const outQty = Number(
      row.out_qty ||
        (Number(row.qty || 0) < 0 ? Math.abs(Number(row.qty || 0)) : 0),
    );
    if (outQty <= 0) continue;
    const key =
      row.material_id || row.material_code || row.reference || "movement";
    const current = map.get(key) || {
      label:
        [row.material_code, row.material_name].filter(Boolean).join(" - ") ||
        row.reference ||
        "Movement",
      qty: 0,
      value: 0,
    };
    current.qty += outQty;
    current.value += Math.abs(
      Number(
        row.display_value ??
          row.transaction_value ??
          row.value ??
          row.rate ??
          row.balance_rate ??
          0,
      ) || 0,
    );
    map.set(key, current);
  }
  return Array.from(map.values())
    .sort((a, b) => b.value - a.value || b.qty - a.qty)
    .slice(0, 5);
}

function buildPeriodOptions(periods: InventoryFinancialPeriod[]) {
  const map = new Map<string, string>();
  map.set(currentFinancialYear(), currentFinancialYear());
  for (const period of periods) {
    map.set(period.financial_year, period.label || period.financial_year);
  }
  return Array.from(map, ([value, label]) => ({ value, label }));
}

function miniTrendValue(row: Record<string, any>) {
  return (
    Number(
      row.value ??
        row.total_value ??
        row.stock_value ??
        row.kpi?.stock_value ??
        row.kpi?.total_value ??
        0,
    ) || 0
  );
}

function batchWorkflow(batch: Record<string, any>) {
  return ((batch.summary_json || {}).workflow || {}) as Record<string, any>;
}

function batchLabel(batch: Record<string, any>) {
  const workflow = batchWorkflow(batch);
  return (
    workflow.label ||
    workflow.name ||
    batch.name ||
    String(batch.type || "Audit sheet").replace(/_/g, " ")
  );
}

function batchScopeText(batch: Record<string, any>) {
  const workflow = batchWorkflow(batch);
  const filters = (workflow.filters || {}) as Record<string, any>;
  const scope = String(
    batch.scope || workflow.scope || batch.type || "",
  ).replace(/_/g, " ");
  const bits = [
    scope,
    filters.location_name
      ? `Location: ${filters.location_name}`
      : "All plant locations",
    filters.item_search ? `Item: ${filters.item_search}` : "",
    filters.category ? `Category: ${filters.category}` : "",
    filters.roll_stock_form_label
      ? `Roll form: ${filters.roll_stock_form_label}`
      : "",
    filters.granule_code_label
      ? `Granule code: ${filters.granule_code_label}`
      : "",
  ].filter(Boolean);
  return bits.join(" · ");
}

async function downloadBlob(
  url: string,
  payload: Record<string, any>,
  fileName: string,
) {
  const response = await api.post(url, payload, { responseType: "blob" });
  const blobUrl = URL.createObjectURL(response.data);
  const anchor = document.createElement("a");
  anchor.href = blobUrl;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(blobUrl);
}

export function StockLifecycleWorkspace() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const activeTab = normalizeTab(searchParams?.get("tab") ?? null);
  const [plantId, setPlantId] = React.useState("");
  const [financialYear, setFinancialYear] = React.useState(
    currentFinancialYear(),
  );
  const [categoryFilter, setCategoryFilter] = React.useState<string | null>(
    null,
  );

  const { data: plants = [], isLoading: plantsLoading } = useQuery({
    queryKey: ["stock-lifecycle", "plants"],
    queryFn: () => factoryService.getPlants(),
  });

  React.useEffect(() => {
    const requestedPlant = searchParams?.get("plant");
    if (
      requestedPlant &&
      (plants as any[]).some((plant) => String(plant.id) === requestedPlant)
    ) {
      if (plantId !== requestedPlant) setPlantId(requestedPlant);
      return;
    }
    if (!plantId && plants.length > 0)
      setPlantId(String((plants as any[])[0].id));
  }, [plantId, plants, searchParams]);

  const { data: catalog, isLoading: catalogLoading } = useQuery<MasterCatalog>({
    queryKey: ["stock-lifecycle", "catalog", plantId],
    queryFn: () => stockLifecycleService.getCatalog(plantId),
    enabled: Boolean(plantId),
    staleTime: 30_000,
  });

  const { data: periods = [] } = useQuery({
    queryKey: ["stock-lifecycle", "periods"],
    queryFn: stockLifecycleService.getPeriods,
    staleTime: 30_000,
  });

  const selectedPeriod = React.useMemo(
    () =>
      periods.find((period) => period.financial_year === financialYear) || null,
    [financialYear, periods],
  );

  const { data: closePreview, isFetching: closingFetching } = useQuery({
    queryKey: ["stock-lifecycle", "closing-preview", plantId, financialYear],
    queryFn: () =>
      stockLifecycleService.getClosingPreview(plantId, financialYear),
    enabled: Boolean(plantId),
    staleTime: 30_000,
  });

  const { data: auditSnapshot } = useQuery({
    queryKey: ["stock-lifecycle", "audit-snapshot", plantId],
    queryFn: () => stockLifecycleService.getSnapshot(plantId),
    enabled: Boolean(plantId),
    staleTime: 30_000,
  });

  const { data: inventorySnapshot } = useQuery({
    queryKey: ["stock-lifecycle", "inventory-snapshot", plantId],
    queryFn: () => inventoryService.getInventorySnapshot({ plant_id: plantId }),
    enabled: Boolean(plantId),
    staleTime: 30_000,
  });

  const { data: trendRows = [] } = useQuery({
    queryKey: ["stock-lifecycle", "inventory-trend", plantId],
    queryFn: () =>
      inventoryService.getInventoryTrend({ days: 245, plant_id: plantId }),
    enabled: Boolean(plantId),
    staleTime: 60_000,
  });

  const { data: batches = [] } = useQuery({
    queryKey: ["stock-lifecycle", "audit-batches", plantId, financialYear],
    queryFn: () =>
      inventoryService.getAuditBatches({
        plant: plantId,
        financial_year: financialYear,
      }),
    enabled: Boolean(plantId),
    staleTime: 30_000,
  });

  const { data: stockCard } = useQuery({
    queryKey: [
      "stock-lifecycle",
      "overview-stock-card",
      plantId,
      financialYear,
    ],
    queryFn: () =>
      inventoryService.getStockCard({
        plant: plantId,
        financial_year: financialYear,
      }),
    enabled: Boolean(plantId),
    staleTime: 30_000,
  });

  function setActiveTab(tab: StockLifecycleTab) {
    const next = new URLSearchParams(searchParams?.toString() || "");
    next.set("tab", tab);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  async function exportCurrentView() {
    const payload = {
      ...(plantId ? { plant: plantId } : {}),
      ...(financialYear ? { financial_year: financialYear } : {}),
    };
    if (activeTab === "close") {
      await downloadBlob(
        inventoryService.getClosingPreviewExportUrl(),
        payload,
        `closing-preview-${financialYear}.xlsx`,
      );
      return;
    }
    await downloadBlob(
      inventoryService.getStockCardExportUrl(),
      payload,
      `stock-card-${financialYear}.xlsx`,
    );
  }

  const snapshotRows = React.useMemo(() => {
    const rows =
      (auditSnapshot as any)?.rows || (closePreview as any)?.rows || [];
    return Array.isArray(rows) ? (rows as Array<Record<string, any>>) : [];
  }, [auditSnapshot, closePreview]);

  const analytics = React.useMemo(() => {
    const byClass = new Map<
      string,
      { qty: number; value: number; count: number }
    >();
    for (const row of snapshotRows) {
      const klass = reportingClass(row);
      const current = byClass.get(klass) || { qty: 0, value: 0, count: 0 };
      current.qty += rowQty(row);
      current.value += rowValue(row);
      current.count += 1;
      byClass.set(klass, current);
    }
    const totalValue =
      Number(
        (closePreview as any)?.totals?.value ??
          (auditSnapshot as any)?.totals?.value ??
          0,
      ) ||
      Array.from(byClass.values()).reduce((sum, row) => sum + row.value, 0);
    const systemQty = (catalog?.rows || []).reduce(
      (sum, row) => sum + Number(row.system_qty || 0),
      0,
    );
    const skus =
      (catalog?.rows || []).filter((row) => Number(row.system_qty || 0) > 0)
        .length || snapshotRows.length;
    return { byClass, totalValue, systemQty, skus };
  }, [auditSnapshot, catalog?.rows, closePreview, snapshotRows]);

  const ageRows = React.useMemo(
    () => buildAgeRows(inventorySnapshot),
    [inventorySnapshot],
  );
  const deadRows = React.useMemo(
    () =>
      ageRows
        .filter((row) => row.days >= 90)
        .sort((a, b) => b.value - a.value || b.days - a.days),
    [ageRows],
  );
  const ageTotals = React.useMemo(() => {
    const fresh = ageRows
      .filter((row) => row.days <= 30)
      .reduce((sum, row) => sum + row.value, 0);
    const slow = ageRows
      .filter((row) => row.days > 30 && row.days < 90)
      .reduce((sum, row) => sum + row.value, 0);
    const dead = deadRows.reduce((sum, row) => sum + row.value, 0);
    const total = Math.max(fresh + slow + dead, 1);
    return { fresh, slow, dead, total };
  }, [ageRows, deadRows]);

  const topMovers = React.useMemo(() => buildTopMovers(stockCard), [stockCard]);
  const movement = React.useMemo(() => {
    const movements = (closePreview as any)?.movements || {};
    const opening = movementBucket(movements, [/opening/i]);
    const inward = movementBucket(movements, [
      /inward/i,
      /grn/i,
      /produce/i,
      /receipt/i,
      /excess/i,
    ]);
    const consumed = movementBucket(movements, [
      /consume/i,
      /short/i,
      /scrap/i,
    ]);
    const dispatch = movementBucket(movements, [
      /dispatch/i,
      /sale/i,
      /issue/i,
    ]);
    const adjust = movementBucket(movements, [/adjust/i, /correction/i]);
    const closing =
      Number((closePreview as any)?.totals?.bulk_kg || 0) +
      Number((closePreview as any)?.totals?.roll_kg || 0) +
      Number((closePreview as any)?.totals?.packaging_qty || 0);
    return { opening, inward, consumed, dispatch, adjust, closing };
  }, [closePreview]);

  const rateGap = React.useMemo(
    () => firstRateGap(snapshotRows),
    [snapshotRows],
  );
  const periodOptions = React.useMemo(
    () => buildPeriodOptions(periods),
    [periods],
  );
  const selectedPlant = React.useMemo(
    () =>
      (plants as any[]).find((plant) => String(plant.id) === String(plantId)) ||
      (catalog as any)?.plant,
    [catalog, plantId, plants],
  );

  return (
    <div
      data-testid="stock-lifecycle-cockpit"
      className="stock-lifecycle-canvas min-h-screen rounded-[28px] px-3 py-4 sm:px-5 lg:px-7"
    >
      <div className="mx-auto flex max-w-[1560px] flex-col gap-4">
        <Hero
          plantName={
            selectedPlant?.code
              ? `${selectedPlant.code} ${selectedPlant.name}`
              : selectedPlant?.name || "No plant"
          }
          financialYear={financialYear}
          periodStatus={selectedPeriod?.status || "Not started"}
          analytics={analytics}
          deadValue={ageTotals.dead}
          deadCount={deadRows.length}
          lastClose={periods.find((period) => period.status === "CLOSED")}
          rateGap={rateGap}
          loading={plantsLoading || catalogLoading || closingFetching}
        />

        <section className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <nav className="flex min-w-0 flex-wrap gap-2">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  data-testid={`stock-lifecycle-tab-${tab.key}`}
                  onClick={() => setActiveTab(tab.key)}
                  className={cn(
                    "inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-extrabold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-line-strong",
                    active
                      ? "bg-surface-3 text-white shadow-[0_14px_28px_-18px_rgba(15,23,42,0.8)]"
                      : "border border-line bg-surface-1 text-content-3 hover:border-line-strong hover:bg-surface-2",
                  )}
                  title={tab.sub}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              );
            })}
          </nav>
          <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row xl:justify-end">
            <Select
              value={plantId || "__none__"}
              onValueChange={(value) =>
                setPlantId(value === "__none__" ? "" : value)
              }
            >
              <SelectTrigger
                data-testid="stock-lifecycle-plant-select"
                className="h-10 rounded-xl border-line bg-surface-1 text-xs font-bold sm:w-[250px]"
              >
                <SelectValue placeholder="Select plant" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Select plant</SelectItem>
                {(plants as any[]).map((plant) => (
                  <SelectItem key={plant.id} value={String(plant.id)}>
                    {plant.code ? `${plant.code} - ${plant.name}` : plant.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={financialYear} onValueChange={setFinancialYear}>
              <SelectTrigger
                data-testid="stock-lifecycle-fy-select"
                className="h-10 rounded-xl border-line bg-surface-1 text-xs font-bold sm:w-[210px]"
              >
                <SelectValue placeholder="FY period" />
              </SelectTrigger>
              <SelectContent>
                {periodOptions.map((period) => (
                  <SelectItem key={period.value} value={period.value}>
                    {period.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              onClick={exportCurrentView}
              className="h-10 rounded-xl bg-surface-3 px-4 text-xs font-extrabold text-white hover:bg-line"
            >
              <Download className="mr-2 h-4 w-4" />
              Export
            </Button>
          </div>
        </section>

        {activeTab === "overview" ? (
          <OverviewPanel
            analytics={analytics}
            ageTotals={ageTotals}
            deadRows={deadRows}
            topMovers={topMovers}
            trendRows={trendRows as Array<Record<string, any>>}
            movement={movement}
            financialYear={financialYear}
            plantLabel={selectedPlant?.code || selectedPlant?.name || "Plant"}
            rateGap={rateGap}
          />
        ) : activeTab === "open" ? (
          <LifecycleTabShell
            icon={Scale}
            title="Open stock"
            copy="Set approved opening balances for the selected plant and FY. This is a stock lifecycle action, not a GRN."
          >
            {!plantId || !catalog ? (
              <EmptyState message="Select a plant to load opening stock rows." />
            ) : (
              <OpenStockTab
                plantId={plantId}
                catalog={catalog}
                categoryFilter={categoryFilter}
              />
            )}
          </LifecycleTabShell>
        ) : activeTab === "count" ? (
          <LifecycleTabShell
            icon={ClipboardList}
            title="Physical count"
            copy="Use the live system quantity, enter floor counts, capture reasons for variance, and post only approved differences."
          >
            {!plantId || !catalog ? (
              <EmptyState message="Select a plant to load physical count rows." />
            ) : (
              <CountTab
                plantId={plantId}
                catalog={catalog}
                categoryFilter={categoryFilter}
              />
            )}
          </LifecycleTabShell>
        ) : activeTab === "close" ? (
          <LifecycleTabShell
            icon={Lock}
            title="FY close"
            copy="Annual lock only: clear blockers, lock the Indian FY, and generate the next opening from the approved close. Monthly stock close is handled in Month close & history."
          >
            {!plantId || !catalog ? (
              <EmptyState message="Select a plant to preview FY close." />
            ) : (
              <CloseTab
                plantId={plantId}
                catalog={catalog}
                onOpenHistory={() => setActiveTab("snapshots")}
              />
            )}
          </LifecycleTabShell>
        ) : (
          <SnapshotsPanel
            plantId={plantId}
            financialYear={financialYear}
            periods={periods}
            batches={batches as any[]}
            trendRows={trendRows as Array<Record<string, any>>}
            catalog={catalog}
          />
        )}

        <CategoryRail
          active={categoryFilter}
          onChange={setCategoryFilter}
          catalog={catalog}
        />
      </div>
    </div>
  );
}

function Hero({
  plantName,
  financialYear,
  periodStatus,
  analytics,
  deadValue,
  deadCount,
  lastClose,
  rateGap,
  loading,
}: {
  plantName: string;
  financialYear: string;
  periodStatus: string;
  analytics: { totalValue: number; skus: number; systemQty: number };
  deadValue: number;
  deadCount: number;
  lastClose?: InventoryFinancialPeriod;
  rateGap: boolean;
  loading: boolean;
}) {
  return (
    <section className="relative overflow-hidden rounded-[26px] bg-gradient-to-br from-order-fg via-order-fg to-order-fg p-6 text-white shadow-[0_26px_70px_-42px_rgba(15,23,42,0.45)]">
      <div className="absolute -right-16 -top-16 h-60 w-60 rounded-full bg-surface-1/10 blur-3xl" />
      <div className="relative flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[0.22em] text-order-border dark:text-white/80">
            <span className="h-2 w-2 rounded-full bg-success-fg" />
            Stock Lifecycle · Inventory Control Cockpit
          </div>
          <h1 className="mt-1.5 max-w-5xl text-3xl font-extrabold tracking-tight sm:text-4xl">
            Open · Count · Close — plus the analytics that were missing.
          </h1>
          <p className="mt-2 max-w-4xl text-sm font-semibold leading-6 text-order-border dark:text-white/90">
            A controller cockpit for live valuation, ageing, movement waterfall,
            monthly snapshots, dead stock, turnover, and the full
            open-to-count-to-close cycle keyed to a plant and FY period.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <StatusChip tone="light" icon={Factory}>
              {plantName}
            </StatusChip>
            <StatusChip tone="light" icon={CalendarRange}>
              FY {financialYear}
            </StatusChip>
            <StatusChip
              tone={
                String(periodStatus).toUpperCase() === "OPEN"
                  ? "green"
                  : "amber"
              }
              icon={ShieldCheck}
            >
              Period {periodStatus.replace(/_/g, " ")}
            </StatusChip>
            {rateGap ? (
              <StatusChip tone="amber" icon={AlertTriangle}>
                Some rates missing
              </StatusChip>
            ) : null}
          </div>
        </div>
        <div className="grid shrink-0 grid-cols-2 gap-2 text-right sm:min-w-[430px]">
          <HeroMetric
            label="Stock value"
            value={money(analytics.totalValue, true)}
            loading={loading}
          />
          <HeroMetric
            label="SKUs on hand"
            value={qty(analytics.skus, 0)}
            loading={loading}
          />
          <HeroMetric
            label="Ageing 90d+"
            value={money(deadValue, true)}
            sub={`${deadCount} rows`}
            loading={loading}
            tone="amber"
          />
          <HeroMetric
            label="Last close"
            value={lastClose?.financial_year || "None"}
            sub={
              lastClose?.closed_at ? monthShort(lastClose.closed_at) : "pending"
            }
            loading={loading}
          />
        </div>
      </div>
    </section>
  );
}

function HeroMetric({
  label,
  value,
  sub,
  tone = "default",
  loading,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "amber";
  loading?: boolean;
}) {
  return (
    <div className="rounded-2xl bg-surface-1/12 p-3 ring-1 ring-surface-1/15">
      <div className="text-[10px] font-bold uppercase tracking-widest text-order-border dark:text-white/76">
        {label}
      </div>
      <div
        className={cn(
          "mt-1 font-mono text-2xl font-extrabold",
          tone === "amber" && "text-warning-border",
        )}
      >
        {loading ? "..." : value}
      </div>
      {sub ? (
        <div className="mt-1 text-[11px] font-bold text-order-border dark:text-white/72">
          {sub}
        </div>
      ) : null}
    </div>
  );
}

function StatusChip({
  children,
  icon: Icon,
  tone,
}: {
  children: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  tone: "light" | "green" | "amber";
}) {
  const className =
    tone === "green"
      ? "bg-success-fg text-success-border ring-success-border"
      : tone === "amber"
        ? "bg-warning-fg text-warning-border ring-warning-border"
        : "bg-surface-1/15 text-white ring-surface-1/20";
  return (
    <span
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full px-3 text-[11px] font-extrabold ring-1",
        className,
      )}
    >
      {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
      {children}
    </span>
  );
}

function OverviewPanel({
  analytics,
  ageTotals,
  deadRows,
  topMovers,
  trendRows,
  movement,
  financialYear,
  plantLabel,
  rateGap,
}: {
  analytics: {
    byClass: Map<string, { qty: number; value: number; count: number }>;
    totalValue: number;
    skus: number;
    systemQty: number;
  };
  ageTotals: { fresh: number; slow: number; dead: number; total: number };
  deadRows: Array<{
    code: string;
    name: string;
    days: number;
    value: number;
    qty: number;
    stockClass: string;
  }>;
  topMovers: Array<{ label: string; qty: number; value: number }>;
  trendRows: Array<Record<string, any>>;
  movement: {
    opening: number;
    inward: number;
    consumed: number;
    dispatch: number;
    adjust: number;
    closing: number;
  };
  financialYear: string;
  plantLabel: string;
  rateGap: boolean;
}) {
  const bulk = analytics.byClass.get("BULK")?.value || 0;
  const rolls = analytics.byClass.get("ROLL")?.value || 0;
  const packaging = analytics.byClass.get("PACKAGING")?.value || 0;
  const bulkStats = analytics.byClass.get("BULK") || {
    qty: 0,
    value: 0,
    count: 0,
  };
  const rollStats = analytics.byClass.get("ROLL") || {
    qty: 0,
    value: 0,
    count: 0,
  };
  const packagingStats = analytics.byClass.get("PACKAGING") || {
    qty: 0,
    value: 0,
    count: 0,
  };
  const other = Math.max(0, analytics.totalValue - bulk - rolls - packaging);
  const totalForShare = Math.max(analytics.totalValue, 1);
  const outflow = Math.abs(movement.consumed) + Math.abs(movement.dispatch);
  const turnover = movement.closing > 0 ? (outflow / movement.closing) * 12 : 0;
  const classSub = (
    stats: { qty: number; value: number; count: number },
    value: number,
    uom: string,
    missingCopy?: string,
  ) => {
    if (stats.count === 0) return "no on-hand rows";
    if (value <= 0 && stats.qty > 0)
      return `${qty(stats.qty, 1)} ${uom} · ${missingCopy || "rates missing"}`;
    return `${pct((value / totalForShare) * 100)} of value · ${qty(stats.qty, 1)} ${uom}`;
  };

  return (
    <div data-testid="stock-overview-tab" className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard
          label="Total value"
          value={money(analytics.totalValue)}
          sub={rateGap ? "excludes rows without rates" : "from stock snapshot"}
        />
        <KpiCard
          label="Bulk / granule"
          value={money(bulk, true)}
          sub={classSub(bulkStats, bulk, "KG")}
        />
        <KpiCard
          label="Rolls / WIP"
          value={money(rolls, true)}
          sub={classSub(rollStats, rolls, "KG", "roll rates missing")}
        />
        <KpiCard
          label="Packaging + addon"
          value={money(packaging, true)}
          sub={classSub(
            packagingStats,
            packaging,
            "qty",
            "packing rates missing",
          )}
        />
        <KpiCard
          label="Turnover annualised"
          value={turnover > 0 ? `${qty(turnover, 1)}x` : "No outflow"}
          sub="from FY movement qty"
        />
        <KpiCard
          label="Dead stock 90d+"
          value={money(ageTotals.dead, true)}
          sub={`${deadRows.length} rows`}
          tone="amber"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ValueMix
          total={analytics.totalValue}
          rows={[
            { label: "Bulk", value: bulk, color: STOCK_CLASS_COLORS.BULK },
            { label: "Rolls", value: rolls, color: STOCK_CLASS_COLORS.ROLL },
            {
              label: "Packaging",
              value: packaging,
              color: STOCK_CLASS_COLORS.PACKAGING,
            },
            { label: "Other", value: other, color: STOCK_CLASS_COLORS.TRADING },
          ]}
        />
        <AgeingBuckets totals={ageTotals} />
        <TrendCard rows={trendRows} />
      </div>

      <MovementWaterfall
        movement={movement}
        financialYear={financialYear}
        plantLabel={plantLabel}
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <TopMovers rows={topMovers} />
        <DeadStock rows={deadRows} />
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "amber";
}) {
  return (
    <div
      className={cn(
        "rounded-[18px] border p-3 shadow-sm",
        tone === "amber"
          ? "border-warning-border bg-warning-bg"
          : "border-line bg-surface-1",
      )}
    >
      <div
        className={cn(
          "text-[10px] font-extrabold uppercase tracking-[0.13em]",
          tone === "amber" ? "text-warning-fg" : "text-content-3",
        )}
      >
        {label}
      </div>
      <div
        className={cn(
          "mt-1 font-mono text-xl font-extrabold",
          tone === "amber" ? "text-warning-fg" : "text-content-1",
        )}
      >
        {value}
      </div>
      {sub ? (
        <div
          className={cn(
            "mt-1 text-[11px] font-bold",
            tone === "amber" ? "text-warning-fg" : "text-content-3",
          )}
        >
          {sub}
        </div>
      ) : null}
    </div>
  );
}

function ValueMix({
  total,
  rows,
}: {
  total: number;
  rows: Array<{ label: string; value: number; color: string }>;
}) {
  const usableTotal = Math.max(
    total,
    rows.reduce((sum, row) => sum + row.value, 0),
    1,
  );
  let cursor = 0;
  const stops = rows
    .map((row) => {
      const start = cursor;
      const width = Math.max(0, (row.value / usableTotal) * 100);
      cursor += width;
      return `${row.color} ${start}% ${cursor}%`;
    })
    .join(", ");

  return (
    <Panel title="Value by class">
      <div className="flex items-center gap-4">
        <div
          className="grid h-[130px] w-[130px] shrink-0 place-items-center rounded-full"
          style={{ background: `conic-gradient(${stops || "#e2e8f0 0 100%"})` }}
        >
          <div className="grid h-[90px] w-[90px] place-items-center rounded-full bg-surface-1 text-center">
            <div>
              <div className="font-mono text-base font-extrabold">
                {money(total, true)}
              </div>
              <div className="text-[9px] font-bold uppercase text-content-4">
                Total
              </div>
            </div>
          </div>
        </div>
        <div className="min-w-0 space-y-1.5 text-xs font-bold text-content-2">
          {rows.map((row) => (
            <div key={row.label} className="flex min-w-0 items-center gap-2">
              <span
                className="h-3 w-3 rounded"
                style={{ backgroundColor: row.color }}
              />
              <span className="truncate">
                {row.label} · {money(row.value, true)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

function AgeingBuckets({
  totals,
}: {
  totals: { fresh: number; slow: number; dead: number; total: number };
}) {
  return (
    <Panel title="Ageing buckets · days since last movement">
      <div className="space-y-3">
        <AgeBar
          label="0-30 days · fresh"
          value={totals.fresh}
          total={totals.total}
          tone="bg-success-fg"
          text="text-success-fg"
        />
        <AgeBar
          label="31-90 days"
          value={totals.slow}
          total={totals.total}
          tone="bg-warning-fg"
          text="text-warning-fg"
        />
        <AgeBar
          label="90+ days · dead"
          value={totals.dead}
          total={totals.total}
          tone="bg-danger-solid"
          text="text-danger-fg"
        />
      </div>
    </Panel>
  );
}

function AgeBar({
  label,
  value,
  total,
  tone,
  text,
}: {
  label: string;
  value: number;
  total: number;
  tone: string;
  text: string;
}) {
  const width =
    total > 0 ? Math.max(4, Math.min(100, (value / total) * 100)) : 4;
  return (
    <div>
      <div className="flex justify-between gap-3 text-xs font-bold">
        <span>{label}</span>
        <span className={cn("font-mono", text)}>{money(value, true)}</span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-line">
        <div
          className={cn("h-full rounded-full", tone)}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}

function TrendCard({ rows }: { rows: Array<Record<string, any>> }) {
  const visible = rows.slice(-8);
  const values = visible.map(miniTrendValue);
  const max = Math.max(1, ...values);
  return (
    <Panel title="Valuation trend · last snapshots">
      {visible.length ? (
        <>
          <div className="flex h-[76px] items-end gap-1.5">
            {visible.map((row, index) => {
              const value = miniTrendValue(row);
              const height = Math.max(12, (value / max) * 100);
              return (
                <div
                  key={`${row.as_of || row.created_at || index}`}
                  className="flex flex-1 flex-col items-center gap-1"
                >
                  <div
                    className={cn(
                      "w-full rounded-t-md",
                      index === visible.length - 1
                        ? "bg-order-fg"
                        : "bg-order-fg",
                    )}
                    style={{ height: `${height}%` }}
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex justify-between text-[10px] font-bold text-content-4">
            <span>
              {monthShort(visible[0]?.as_of || visible[0]?.created_at)}
            </span>
            <span>
              {monthShort(
                visible[Math.floor(visible.length / 2)]?.as_of ||
                  visible[Math.floor(visible.length / 2)]?.created_at,
              )}
            </span>
            <span>
              {monthShort(visible.at(-1)?.as_of || visible.at(-1)?.created_at)}
            </span>
          </div>
        </>
      ) : (
        <EmptyState
          message="No historical snapshots returned yet. Run the inventory snapshot job or close a period to build this trend."
          compact
        />
      )}
      <div className="mt-3 text-[11px] font-bold leading-5 text-content-3">
        Uses real InventorySnapshot trend rows; empty trend means no captured
        snapshots yet.
      </div>
    </Panel>
  );
}

function MovementWaterfall({
  movement,
  financialYear,
  plantLabel,
}: {
  movement: {
    opening: number;
    inward: number;
    consumed: number;
    dispatch: number;
    adjust: number;
    closing: number;
  };
  financialYear: string;
  plantLabel: string;
}) {
  const rows = [
    {
      label: "Opening",
      value: movement.opening,
      tone: "bg-line",
      text: "text-content-2",
    },
    {
      label: "+ In / GRN",
      value: movement.inward,
      tone: "bg-success-fg",
      text: "text-success-fg",
    },
    {
      label: "- Consumed",
      value: Math.abs(movement.consumed),
      tone: "bg-danger-solid",
      text: "text-danger-fg",
    },
    {
      label: "- Dispatch",
      value: Math.abs(movement.dispatch),
      tone: "bg-danger-fg",
      text: "text-danger-fg",
    },
    {
      label: "+/- Adjust",
      value: Math.abs(movement.adjust),
      tone: "bg-warning-fg",
      text: "text-warning-fg",
    },
    {
      label: "Closing",
      value: movement.closing,
      tone: "bg-order-fg",
      text: "text-order-fg",
    },
  ];
  const max = Math.max(1, ...rows.map((row) => Math.abs(row.value)));
  return (
    <div className="rounded-[18px] border border-line bg-surface-1 p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="text-[10px] font-extrabold uppercase tracking-[0.13em] text-content-3">
          Movement this period · opening + ins - outs +/- adjustments = closing
        </div>
        <span className="inline-flex h-7 items-center rounded-full bg-surface-2 px-3 text-[11px] font-extrabold text-content-3">
          {financialYear} · {plantLabel}
        </span>
      </div>
      <div className="flex h-[170px] items-end gap-2 sm:gap-3">
        {rows.map((row) => {
          const height = Math.max(8, (Math.abs(row.value) / max) * 145);
          return (
            <div
              key={row.label}
              className="flex min-w-0 flex-1 flex-col items-center gap-1.5"
            >
              <div
                className={cn("w-full rounded-md", row.tone)}
                style={{ height }}
              />
              <div
                className={cn("truncate text-[10px] font-extrabold", row.text)}
              >
                {row.label}
              </div>
              <div className="font-mono text-[11px] font-bold text-content-2">
                {qty(row.value)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TopMovers({
  rows,
}: {
  rows: Array<{ label: string; qty: number; value: number }>;
}) {
  return (
    <Panel title="Top movers this FY (by outflow)">
      {rows.length ? (
        <table className="w-full text-xs font-bold">
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.label}
                className="border-b border-line last:border-b-0"
              >
                <td className="py-2 pr-2">{row.label}</td>
                <td className="py-2 text-right font-mono text-danger-fg">
                  {row.value ? `-${money(row.value, true)}` : "-"}
                </td>
                <td className="py-2 text-right text-content-4">
                  {qty(row.qty)} qty
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <EmptyState
          message="No outflow rows returned by the stock-card endpoint for this FY."
          compact
        />
      )}
    </Panel>
  );
}

function DeadStock({
  rows,
}: {
  rows: Array<{
    code: string;
    name: string;
    days: number;
    value: number;
    qty: number;
    stockClass: string;
  }>;
}) {
  return (
    <div className="rounded-[18px] border border-warning-border bg-warning-bg p-4 shadow-sm">
      <div className="mb-3 text-[10px] font-extrabold uppercase tracking-[0.13em] text-warning-fg">
        Dead stock · no movement 90d+
      </div>
      {rows.length ? (
        <table className="w-full text-xs font-bold">
          <tbody>
            {rows.slice(0, 6).map((row) => (
              <tr
                key={`${row.stockClass}-${row.code}-${row.days}`}
                className="border-b border-warning-border last:border-b-0"
              >
                <td className="py-2 pr-2">
                  <div className="text-content-2">{row.name}</div>
                  <div className="text-[10px] text-warning-fg">
                    {row.code} · {row.stockClass}
                  </div>
                </td>
                <td className="py-2 text-right font-mono text-warning-fg">
                  {row.value ? money(row.value, true) : qty(row.qty)}
                </td>
                <td className="py-2 text-right text-warning-fg">
                  {row.days} days
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <EmptyState
          message="No 90+ day stock found in the live snapshot."
          compact
        />
      )}
    </div>
  );
}

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[18px] border border-line bg-surface-1 p-4 shadow-sm">
      <div className="mb-3 text-[10px] font-extrabold uppercase tracking-[0.13em] text-content-3">
        {title}
      </div>
      {children}
    </div>
  );
}

function LifecycleTabShell({
  icon: Icon,
  title,
  copy,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  copy: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[22px] border border-line bg-surface-1 p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-surface-3 text-white">
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-xl font-extrabold tracking-tight text-content-1">
              {title}
            </h2>
            <p className="mt-1 max-w-4xl text-sm font-semibold leading-6 text-content-3">
              {copy}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-success-border bg-success-bg px-3 py-1.5 text-[11px] font-extrabold text-success-fg">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Live backend workflow
        </div>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function SnapshotsPanel({
  plantId,
  financialYear,
  periods,
  batches,
  trendRows,
  catalog,
}: {
  plantId: string;
  financialYear: string;
  periods: InventoryFinancialPeriod[];
  batches: Array<Record<string, any>>;
  trendRows: Array<Record<string, any>>;
  catalog?: MasterCatalog;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const countBatches = batches.filter(
    (batch) => String(batch.type || "").toUpperCase() === "PHYSICAL_COUNT",
  );
  const postedBatches = batches.filter((batch) =>
    ["POSTED", "LOCKED"].includes(String(batch.status || "").toUpperCase()),
  );
  const actionBatches = batches.filter((batch) =>
    ["DRAFT", "SUBMITTED", "APPROVED"].includes(
      String(batch.status || "").toUpperCase(),
    ),
  );
  const recentCounts = countBatches.slice(0, 5);
  const months = React.useMemo(
    () => buildFyMonthTracker(financialYear, countBatches, trendRows),
    [countBatches, financialYear, trendRows],
  );
  const currentMonth = months.find((month) => month.isCurrent) || months[0];
  const [selectedMonthKey, setSelectedMonthKey] = React.useState(
    currentMonth?.key || "",
  );
  React.useEffect(() => {
    if (!months.some((month) => month.key === selectedMonthKey)) {
      setSelectedMonthKey(currentMonth?.key || months[0]?.key || "");
    }
  }, [currentMonth?.key, months, selectedMonthKey]);
  const selectedMonth =
    months.find((month) => month.key === selectedMonthKey) || currentMonth;
  const [selectedBatchId, setSelectedBatchId] = React.useState<string | null>(
    null,
  );
  const [selectedLedgerRow, setSelectedLedgerRow] =
    React.useState<Record<string, any> | null>(null);
  const [monthProofOpen, setMonthProofOpen] = React.useState(false);
  const [eodDate, setEodDate] = React.useState(() => localDateInputValue());
  const batchByNumber = React.useMemo(() => {
    const map = new Map<string, Record<string, any>>();
    for (const batch of batches) {
      if (batch.batch_no) map.set(String(batch.batch_no), batch);
      if (batch.id) map.set(String(batch.id), batch);
    }
    return map;
  }, [batches]);
  const selectedMonthBatches = React.useMemo(() => {
    if (!selectedMonth) return [];
    return countBatches.filter((batch) => monthKeyForDate(batch.posted_at || batch.cutoff_at || batch.created_at) === selectedMonth.key);
  }, [countBatches, selectedMonth]);

  const { data: eodSnapshot, isFetching: eodFetching } = useQuery({
    queryKey: ["stock-lifecycle", "eod-packing-proof", plantId, eodDate],
    queryFn: () =>
      logisticsService.getPackingMaterialCount({
        date: eodDate,
        plant_id: plantId || undefined,
      }),
    enabled: Boolean(plantId && eodDate),
    staleTime: 30_000,
  });

  const openLedgerSource = React.useCallback(
    (row: Record<string, any>) => {
      const meta = row.meta || {};
      if (meta.source_doc === "inventory_audit_batch" && meta.batch_id) {
        setSelectedBatchId(String(meta.batch_id));
        return;
      }
      const ref = String(row.reference || "");
      if (ref.startsWith("PACKING_EOD_COUNT:")) {
        const [, datePart] = ref.split(":");
        if (datePart) setEodDate(datePart);
      }
      setSelectedLedgerRow(row);
    },
    [],
  );

  const monthSnapshotMutation = useMutation({
    mutationFn: () => stockLifecycleService.createInventorySnapshot(plantId),
    onSuccess: () => {
      toast({
        title: "Month-end snapshot captured",
        description:
          "The inventory trend and monthly tracker now have a fresh live stock snapshot.",
      });
      qc.invalidateQueries({
        queryKey: ["stock-lifecycle", "inventory-trend"],
      });
      qc.invalidateQueries({
        queryKey: ["stock-lifecycle", "inventory-snapshot"],
      });
    },
    onError: (err: any) => {
      toast({
        title: "Snapshot failed",
        description:
          err?.response?.data?.detail ||
          err?.response?.data?.error ||
          err?.message ||
          "Please try again.",
        variant: "destructive" as any,
      });
    },
  });

  const cancelBatchMutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      stockLifecycleService.cancelBatch(id, reason),
    onSuccess: () => {
      toast({
        title: "Draft sheet cancelled",
        description: "The annual close blocker list will refresh.",
      });
      qc.invalidateQueries({ queryKey: ["stock-lifecycle", "audit-batches"] });
      qc.invalidateQueries({
        queryKey: ["stock-lifecycle", "closing-preview"],
      });
    },
    onError: (err: any) => {
      toast({
        title: "Cancel failed",
        description:
          err?.response?.data?.detail ||
          err?.response?.data?.error ||
          err?.message ||
          "Please try again.",
        variant: "destructive" as any,
      });
    },
  });

  const cancelDraftBatch = (batch: Record<string, any>) => {
    const label = batch.batch_no || batchLabel(batch);
    if (
      !window.confirm(
        `Cancel ${label}? Posted sheets are untouched; this only cancels unfinished audit work.`,
      )
    )
      return;
    cancelBatchMutation.mutate({
      id: String(batch.id),
      reason:
        "Cancelled from Stock Lifecycle history to clear unfinished audit-sheet blocker.",
    });
  };

  return (
    <div className="space-y-4">
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Panel title="Closed periods and FY locks">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {periods.slice(0, 9).map((period) => (
              <div
                key={period.id}
                className={cn(
                  "rounded-2xl border p-4",
                  periodTone(period.status),
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="font-mono text-lg font-extrabold">
                    {period.financial_year}
                  </div>
                  {period.status === "CLOSED" ? (
                    <Lock className="h-4 w-4" />
                  ) : (
                    <CalendarClock className="h-4 w-4" />
                  )}
                </div>
                <div className="mt-2 text-xs font-bold opacity-80">
                  {period.status.replace(/_/g, " ")}
                </div>
                <div className="mt-3 text-[11px] font-semibold opacity-75">
                  Close:{" "}
                  {period.closed_at
                    ? formatDisplayDate(period.closed_at)
                    : "not closed"}
                </div>
              </div>
            ))}
            {!periods.length ? (
              <EmptyState
                message="No financial periods returned yet."
                compact
              />
            ) : null}
          </div>
        </Panel>
        <Panel title="Monthly close tracker">
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {months.map((month) => (
              <button
                key={month.key}
                type="button"
                onClick={() => setSelectedMonthKey(month.key)}
                className={cn(
                  "rounded-2xl border p-3 text-center transition",
                  month.key === selectedMonth?.key && "ring-2 ring-line-strong",
                  month.counted
                    ? "border-success-border bg-success-bg"
                    : month.snapshot
                      ? "border-info-border bg-info-bg"
                      : "border-line bg-surface-2 hover:border-line-strong",
                )}
              >
                <div className="text-sm font-extrabold text-content-1">
                  {month.label}
                </div>
                <div
                  className={cn(
                    "mt-1 text-[10px] font-extrabold uppercase",
                    month.counted
                      ? "text-success-fg"
                      : month.snapshot
                        ? "text-primary"
                        : "text-content-4",
                  )}
                >
                  {month.counted
                    ? "Count posted"
                    : month.snapshot
                      ? "Snapshot"
                      : "Pending"}
                </div>
                <div className="mt-1 font-mono text-[11px] font-bold text-content-3">
                  {month.count || 0} sheet(s)
                </div>
              </button>
            ))}
          </div>
          {selectedMonth ? (
            <div className="mt-4 rounded-2xl border border-line bg-surface-1 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-sm font-extrabold text-content-1">
                    {selectedMonth.label} month close
                  </div>
                  <div className="mt-1 text-xs font-semibold leading-5 text-content-3">
                    Monthly close captures a stock snapshot for reporting. It
                    does not lock the FY.
                    {selectedMonth.count
                      ? ` ${selectedMonth.count} posted count sheet(s) are linked to this month.`
                      : " No posted count sheet is linked yet."}
                  </div>
                </div>
                <Button
                  type="button"
                  disabled={
                    !plantId ||
                    !selectedMonth.isCurrent ||
                    monthSnapshotMutation.isPending
                  }
                  onClick={() => monthSnapshotMutation.mutate()}
                  className="h-10 rounded-xl bg-surface-3 px-4 text-xs font-extrabold text-white hover:bg-line"
                  title={
                    selectedMonth.isCurrent
                      ? "Capture current live stock as this month's snapshot"
                      : "Historical month snapshots cannot be backdated from this action"
                  }
                >
                  {monthSnapshotMutation.isPending
                    ? "Capturing..."
                    : selectedMonth.isCurrent
                      ? "Capture month-end snapshot"
                      : "Historical month"}
                </Button>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs font-bold">
                <div className="rounded-xl bg-surface-2 p-2">
                  <div className="text-content-4">Count sheets</div>
                  <div className="font-mono text-content-1">
                    {selectedMonth.count}
                  </div>
                </div>
                <div className="rounded-xl bg-surface-2 p-2">
                  <div className="text-content-4">Snapshot</div>
                  <div
                    className={cn(
                      "font-mono",
                      selectedMonth.snapshot
                        ? "text-primary"
                        : "text-content-4",
                    )}
                  >
                    {selectedMonth.snapshot ? "YES" : "NO"}
                  </div>
                </div>
                <div className="rounded-xl bg-surface-2 p-2">
                  <div className="text-content-4">FY lock</div>
                  <div className="font-mono text-content-1">NO</div>
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => setMonthProofOpen(true)}
                className="mt-3 h-9 w-full rounded-xl text-xs font-extrabold"
              >
                <FileText className="mr-2 h-4 w-4" />
                View month proof
              </Button>
            </div>
          ) : null}
        </Panel>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]">
        <Panel title="Audit sheet history">
          {actionBatches.length ? (
            <div className="mb-4 rounded-2xl border border-warning-border bg-warning-bg p-3">
              <div className="text-xs font-extrabold uppercase tracking-[0.13em] text-warning-fg">
                Action required before FY close
              </div>
              <div className="mt-2 grid gap-2">
                {actionBatches.slice(0, 6).map((batch) => (
                  <div
                    key={batch.id}
                    className="flex flex-col gap-2 rounded-xl bg-surface-1 p-3 ring-1 ring-warning-border sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-extrabold text-content-1">
                        {batch.batch_no || batchLabel(batch)}
                      </div>
                      <div className="mt-1 text-[11px] font-bold text-warning-fg">
                        {batch.type?.replace(/_/g, " ")} · {batch.status} ·{" "}
                        {batch.line_count || batch.lines?.length || 0} lines
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => setSelectedBatchId(String(batch.id))}
                        className="h-8 rounded-xl bg-surface-3 px-3 text-xs font-extrabold text-white hover:bg-line"
                      >
                        Open sheet
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={cancelBatchMutation.isPending}
                        onClick={() => cancelDraftBatch(batch)}
                        className="h-8 rounded-xl border-warning-border bg-surface-1 text-xs font-extrabold text-warning-fg hover:bg-warning-bg"
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {recentCounts.length ? (
            <div className="mb-4 grid gap-2 sm:grid-cols-2">
              {recentCounts.map((batch) => (
                <button
                  key={batch.id}
                  type="button"
                  onClick={() => setSelectedBatchId(String(batch.id))}
                  className="rounded-2xl border border-order-border bg-order-bg p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-extrabold text-content-1">
                        {batchLabel(batch)}
                      </div>
                      <div className="mt-1 line-clamp-2 text-[11px] font-bold leading-4 text-order-fg">
                        {batchScopeText(batch)}
                      </div>
                    </div>
                    <span className="shrink-0 rounded-full bg-surface-1 px-2 py-1 font-mono text-[10px] font-extrabold text-order-fg">
                      {batch.line_count || batch.lines?.length || 0} lines
                    </span>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-[0.12em] text-content-3">
                    <span>{batch.batch_no || batch.id}</span>
                    <span>
                      {batch.posted_at
                        ? formatDisplayDate(batch.posted_at)
                        : batch.status}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          ) : null}
          {!batches.length ? (
            <EmptyState message="No audit sheets for this plant/FY." compact />
          ) : (
            <div className="max-h-[460px] overflow-auto">
              <table className="w-full min-w-[620px] text-sm">
                <thead className="sticky top-0 bg-surface-1 text-left text-[10px] font-extrabold uppercase tracking-[0.13em] text-content-3">
                  <tr>
                    <th className="py-2">Sheet</th>
                    <th>Label</th>
                    <th>Scope</th>
                    <th>Status</th>
                    <th className="text-right">Lines</th>
                  </tr>
                </thead>
                <tbody>
                  {batches.slice(0, 40).map((batch) => (
                    <tr
                      key={batch.id}
                      className="border-t border-line transition hover:bg-surface-2/70"
                    >
                      <td className="py-2 pr-2 font-mono text-xs font-bold text-content-2">
                        <button
                          type="button"
                          onClick={() => setSelectedBatchId(String(batch.id))}
                          className="text-left font-mono text-xs font-extrabold text-primary underline-offset-4 hover:underline"
                        >
                          {batch.batch_no || batch.id}
                        </button>
                      </td>
                      <td className="pr-2 text-xs font-bold text-content-2">
                        {batchLabel(batch)}
                      </td>
                      <td className="max-w-[240px] pr-2 text-[11px] font-semibold text-content-3">
                        {batchScopeText(batch)}
                      </td>
                      <td className="pr-2">
                        <span className="rounded-full border border-line bg-surface-2 px-2 py-1 text-[10px] font-extrabold text-content-3">
                          {batch.status}
                        </span>
                      </td>
                      <td className="text-right font-mono text-xs font-bold">
                        {batch.line_count || batch.lines?.length || 0}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-3 rounded-2xl bg-surface-2 p-3 text-xs font-semibold leading-5 text-content-3">
            Posted sheets are immutable. Closed financial years are locked;
            stock adjustments must be posted only in an open financial year.
          </div>
        </Panel>
        <StockCardDrill
          plantId={plantId}
          financialYear={financialYear}
          catalog={catalog}
          postedCount={postedBatches.length}
          batchesByNumber={batchByNumber}
          onOpenBatch={(batchId) => setSelectedBatchId(batchId)}
          onOpenSource={openLedgerSource}
        />
      </section>
      <EodPackingProofPanel
        date={eodDate}
        onDateChange={setEodDate}
        snapshot={eodSnapshot}
        loading={eodFetching}
      />
      <AuditBatchDrawer
        batchId={selectedBatchId}
        onClose={() => setSelectedBatchId(null)}
        onChanged={() => {
          qc.invalidateQueries({ queryKey: ["stock-lifecycle", "audit-batches"] });
          qc.invalidateQueries({ queryKey: ["stock-lifecycle", "stock-card-drill"] });
          qc.invalidateQueries({ queryKey: ["stock-lifecycle", "closing-preview"] });
        }}
      />
      <MonthProofDialog
        open={monthProofOpen}
        onOpenChange={setMonthProofOpen}
        month={selectedMonth}
        batches={selectedMonthBatches}
        trendRows={trendRows}
        onOpenBatch={(batchId) => setSelectedBatchId(batchId)}
      />
      <LedgerSourceDialog
        row={selectedLedgerRow}
        onClose={() => setSelectedLedgerRow(null)}
      />
    </div>
  );
}

function StockCardDrill({
  plantId,
  financialYear,
  catalog,
  postedCount,
  batchesByNumber,
  onOpenBatch,
  onOpenSource,
}: {
  plantId: string;
  financialYear: string;
  catalog?: MasterCatalog;
  postedCount: number;
  batchesByNumber: Map<string, Record<string, any>>;
  onOpenBatch: (batchId: string) => void;
  onOpenSource: (row: Record<string, any>) => void;
}) {
  const searchParams = useSearchParams();
  const initialMaterial = searchParams?.get("material") || "";
  const [material, setMaterial] = React.useState("");
  const [query, setQuery] = React.useState("");
  const materialRows = React.useMemo(() => {
    const rows = catalog?.rows || [];
    const q = query.trim().toLowerCase();
    if (!q) return rows.slice(0, 120);
    return rows
      .filter((row) => `${row.code} ${row.name}`.toLowerCase().includes(q))
      .slice(0, 120);
  }, [catalog?.rows, query]);

  React.useEffect(() => {
    if (!material && materialRows[0]?.id) setMaterial(materialRows[0].id);
  }, [material, materialRows]);

  React.useEffect(() => {
    if (
      initialMaterial &&
      initialMaterial !== material &&
      materialRows.some((row) => row.id === initialMaterial)
    ) {
      setMaterial(initialMaterial);
    }
  }, [initialMaterial, material, materialRows]);

  const { data: card, isFetching } = useQuery({
    queryKey: [
      "stock-lifecycle",
      "stock-card-drill",
      plantId,
      financialYear,
      material,
    ],
    queryFn: () =>
      inventoryService.getStockCard({
        plant: plantId,
        financial_year: financialYear,
        material: material || undefined,
      }),
    enabled: Boolean(plantId && material),
    staleTime: 30_000,
  });

  const rows = card?.rows || [];
  const visible = rows.slice(-80);

  return (
    <Panel title="Stock card drill · ledger proof">
      <div className="mb-3 grid gap-2 md:grid-cols-[220px_minmax(0,1fr)_auto]">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search material..."
          className="h-10 rounded-xl"
        />
        <Select
          value={material || "__none__"}
          onValueChange={(value) =>
            setMaterial(value === "__none__" ? "" : value)
          }
        >
          <SelectTrigger className="h-10 rounded-xl">
            <SelectValue placeholder="Material" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Select material</SelectItem>
            {materialRows.map((row) => (
              <SelectItem key={row.id} value={row.id}>
                {row.code} - {row.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="inline-flex h-10 items-center rounded-xl bg-surface-2 px-3 text-xs font-extrabold text-content-3">
          {isFetching
            ? "Refreshing"
            : `${rows.length} ledger rows · ${postedCount} posted sheets`}
        </div>
      </div>
      <div className="mb-3 grid grid-cols-3 gap-2">
        <KpiCard label="Opening" value={qty(card?.opening_qty || 0)} />
        <KpiCard label="Movement" value={qty(card?.movement_qty || 0)} />
        <KpiCard label="Closing" value={qty(card?.closing_qty || 0)} />
      </div>
      {!visible.length ? (
        <EmptyState
          message="No stock-card ledger rows for the selected material/FY."
          compact
        />
      ) : (
      <div className="max-h-[460px] overflow-auto rounded-2xl border border-line">
        <table className="w-full min-w-[860px] text-xs">
          <thead className="sticky top-0 bg-surface-2 text-left font-extrabold uppercase tracking-[0.13em] text-content-3">
            <tr>
              <th className="px-3 py-2">Date</th>
              <th>Ref</th>
              <th>Type</th>
              <th className="text-right">In</th>
              <th className="text-right">Out</th>
              <th className="text-right">Balance</th>
              <th className="text-right">Value</th>
            </tr>
          </thead>
          <tbody className="font-bold">
            {visible.map((row, index) => (
              <tr
                key={`${row.reference}-${row.at}-${index}`}
                className="border-t border-line"
              >
                <td className="px-3 py-2 text-content-3">
                  {row.at ? formatDisplayDate(row.at) : "-"}
                </td>
                <td className="py-2 pr-2">
                  <button
                    type="button"
                    onClick={() => {
                      const meta = row.meta || {};
                      const mapped =
                        (meta.batch_id && String(meta.batch_id)) ||
                        batchesByNumber.get(String(row.reference || ""))?.id;
                      if (meta.source_doc === "inventory_audit_batch" && mapped) {
                        onOpenBatch(String(mapped));
                        return;
                      }
                      onOpenSource(row);
                    }}
                    className="inline-flex max-w-[260px] items-center gap-1 truncate rounded-lg px-1.5 py-1 text-left font-mono text-primary underline-offset-4 transition hover:bg-primary/10 hover:underline"
                    title={`Open ${row.reference || "source movement"}`}
                  >
                    <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{row.reference || "-"}</span>
                  </button>
                </td>
                <td>{row.source || "-"}</td>
                <td className="text-right font-mono text-success-fg">
                  {row.in_qty ? qty(row.in_qty) : "-"}
                </td>
                <td className="text-right font-mono text-danger-fg">
                  {row.out_qty ? qty(row.out_qty) : "-"}
                </td>
                <td className="text-right font-mono">
                  {qty(row.balance_qty ?? row.qty ?? 0)}
                </td>
                <td className="text-right font-mono">
                  {row.value == null ? "-" : money(row.value, true)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </Panel>
  );
}

function AuditBatchDrawer({
  batchId,
  onClose,
  onChanged,
}: {
  batchId: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const open = Boolean(batchId);
  const detail = useQuery({
    queryKey: ["stock-lifecycle", "audit-batch-detail", batchId],
    queryFn: () => inventoryService.getAuditBatch(String(batchId)),
    enabled: open,
  });
  const items = useQuery({
    queryKey: ["stock-lifecycle", "audit-batch-items", batchId],
    queryFn: () => inventoryService.getAuditBatchItems(String(batchId)),
    enabled: open,
  });
  const preview = useQuery({
    queryKey: ["stock-lifecycle", "audit-batch-preview", batchId],
    queryFn: () => inventoryService.previewAuditBatch(String(batchId)),
    enabled: open,
  });
  const mutate = useMutation({
    mutationFn: async (action: "validate" | "submit" | "approve" | "post" | "cancel") => {
      if (!batchId) return null;
      if (action === "validate") return inventoryService.validateAuditBatch(batchId);
      if (action === "submit") return inventoryService.submitAuditBatch(batchId);
      if (action === "approve") return inventoryService.approveAuditBatch(batchId);
      if (action === "post") return inventoryService.postAuditBatch(batchId);
      return inventoryService.cancelAuditBatch(
        batchId,
        "Cancelled from Stock Lifecycle audit proof drawer.",
      );
    },
    onSuccess: (_, action) => {
      toast({
        title: `Audit sheet ${action} complete`,
        description: "Stock lifecycle proof and blockers are refreshing.",
      });
      qc.invalidateQueries({ queryKey: ["stock-lifecycle"] });
      detail.refetch();
      preview.refetch();
      items.refetch();
      onChanged();
    },
    onError: (err: any) => {
      toast({
        title: "Audit action failed",
        description:
          err?.response?.data?.detail ||
          err?.response?.data?.error ||
          err?.message ||
          "Please try again.",
        variant: "destructive" as any,
      });
    },
  });
  const batch: any = detail.data;
  const rows = (preview.data?.rows?.length ? preview.data.rows : batch?.lines || items.data || []) as Array<Record<string, any>>;
  const status = String(batch?.status || "").toUpperCase();
  const canSubmit = status === "DRAFT";
  const canApprove = status === "SUBMITTED";
  const canPost = status === "APPROVED";
  const canCancel = ["DRAFT", "SUBMITTED", "APPROVED"].includes(status);
  const canValidate = ["DRAFT", "SUBMITTED", "APPROVED"].includes(status);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex max-h-[92vh] max-w-[min(1180px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-[24px] border-line bg-surface-1 p-0">
        <DialogHeader className="border-b border-line bg-surface-2 px-5 py-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <DialogTitle className="truncate text-xl font-extrabold text-content-1">
                {batch?.batch_no || "Audit sheet"}
              </DialogTitle>
              <DialogDescription className="mt-1 text-sm font-semibold text-content-3">
                {batch ? `${batchLabel(batch)} · ${batchScopeText(batch)}` : "Loading audit proof..."}
              </DialogDescription>
            </div>
            {batch ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-9 rounded-xl text-xs font-extrabold"
                  onClick={() => window.open(inventoryService.getAuditBatchExportUrl(batch.id), "_blank")}
                >
                  <FileSpreadsheet className="mr-2 h-4 w-4" />
                  Export
                </Button>
                {canSubmit ? (
                  <Button type="button" className="h-9 rounded-xl text-xs font-extrabold" disabled={mutate.isPending} onClick={() => mutate.mutate("submit")}>
                    Submit
                  </Button>
                ) : null}
                {canApprove ? (
                  <Button type="button" className="h-9 rounded-xl text-xs font-extrabold" disabled={mutate.isPending} onClick={() => mutate.mutate("approve")}>
                    Approve
                  </Button>
                ) : null}
                {canPost ? (
                  <Button
                    type="button"
                    className="h-9 rounded-xl bg-success-fg text-xs font-extrabold text-white hover:bg-success-fg/90"
                    disabled={mutate.isPending}
                    onClick={() => {
                      if (window.confirm(`Post ${batch.batch_no}? This commits stock movement and cannot be edited.`)) mutate.mutate("post");
                    }}
                  >
                    Post
                  </Button>
                ) : null}
                {canCancel ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 rounded-xl border-warning-border text-xs font-extrabold text-warning-fg"
                    disabled={mutate.isPending}
                    onClick={() => {
                      if (window.confirm(`Cancel ${batch.batch_no}? Posted sheets are untouched.`)) mutate.mutate("cancel");
                    }}
                  >
                    Cancel
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {!batch ? (
            <EmptyState message="Loading audit sheet proof..." compact />
          ) : (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-4">
                <ProofMetric label="Status" value={status} />
                <ProofMetric label="Type" value={String(batch.type || "").replace(/_/g, " ")} />
                <ProofMetric label="Cutoff" value={formatDisplayDate(batch.cutoff_at)} />
                <ProofMetric label="Lines" value={String(batch.line_count || rows.length || 0)} />
              </div>
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
                <div className="rounded-2xl border border-line bg-surface-1">
                  <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
                    <div>
                      <div className="text-sm font-extrabold text-content-1">Sheet lines</div>
                      <div className="text-xs font-semibold text-content-3">System, counted/opening, variance, rate, and posted refs.</div>
                    </div>
                    {canValidate ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={mutate.isPending}
                        onClick={() => mutate.mutate("validate")}
                        className="h-8 rounded-xl text-xs font-extrabold"
                      >
                        <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                        Validate
                      </Button>
                    ) : null}
                  </div>
                  <div className="max-h-[470px] overflow-auto">
                    <table className="w-full min-w-[900px] text-xs">
                      <thead className="sticky top-0 bg-surface-2 text-left text-[10px] font-extrabold uppercase tracking-[0.13em] text-content-3">
                        <tr>
                          <th className="px-3 py-2">Material</th>
                          <th>Location</th>
                          <th className="text-right">System</th>
                          <th className="text-right">Count/Open</th>
                          <th className="text-right">Variance</th>
                          <th className="text-right">Rate</th>
                          <th>Ref</th>
                        </tr>
                      </thead>
                      <tbody className="font-bold">
                        {rows.slice(0, 220).map((row, index) => {
                          const ref = row.posted_reference_json || row.refs || row.meta || {};
                          return (
                            <tr key={row.id || `${row.materialCode}-${index}`} className="border-t border-line">
                              <td className="px-3 py-2">
                                <div className="font-mono text-content-1">{row.material_code || row.materialCode || row.material || "-"}</div>
                                <div className="mt-0.5 max-w-[260px] truncate text-[11px] text-content-3">{row.material_name || row.materialName || row.label || ""}</div>
                              </td>
                              <td className="text-content-3">{row.location_name || row.locationCode || row.location || "-"}</td>
                              <td className="text-right font-mono">{qtyWithUom(row.system_qty ?? row.systemQty, row.uom)}</td>
                              <td className="text-right font-mono">{qtyWithUom(row.counted_qty ?? row.countedQty ?? row.opening_qty, row.uom)}</td>
                              <td className={cn("text-right font-mono", Number(row.variance_qty || 0) < 0 ? "text-danger-fg" : Number(row.variance_qty || 0) > 0 ? "text-success-fg" : "text-content-3")}>
                                {qtyWithUom(row.variance_qty ?? 0, row.uom)}
                              </td>
                              <td className="text-right font-mono">{row.rate == null ? "-" : money(row.rate)}</td>
                              <td className="max-w-[240px] truncate font-mono text-[11px] text-content-3" title={JSON.stringify(ref)}>
                                {ref.bulk_transaction_id || ref.packaging_transaction_id || ref.roll_id || ref.line_id || "-"}
                              </td>
                            </tr>
                          );
                        })}
                        {!rows.length ? (
                          <tr>
                            <td colSpan={7} className="px-3 py-8 text-center text-sm font-semibold text-content-3">
                              No lines returned for this audit sheet.
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="rounded-2xl border border-line bg-surface-2 p-4">
                    <div className="text-xs font-extrabold uppercase tracking-[0.16em] text-content-4">Summary</div>
                    <pre className="mt-3 max-h-[210px] overflow-auto rounded-xl bg-surface-1 p-3 text-[11px] font-semibold text-content-3">
                      {JSON.stringify(preview.data?.summary || batch.summary_json || {}, null, 2)}
                    </pre>
                  </div>
                  <div className="rounded-2xl border border-line bg-surface-2 p-4 text-xs font-semibold leading-5 text-content-3">
                    Posted and locked sheets are immutable proof. Draft/submitted/approved sheets can be completed or cancelled from here; annual close blockers refresh after action.
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ProofMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface-2 p-3">
      <div className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-content-4">{label}</div>
      <div className="mt-1 truncate text-sm font-extrabold text-content-1">{value || "-"}</div>
    </div>
  );
}

function MonthProofDialog({
  open,
  onOpenChange,
  month,
  batches,
  trendRows,
  onOpenBatch,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  month: any;
  batches: Array<Record<string, any>>;
  trendRows: Array<Record<string, any>>;
  onOpenBatch: (batchId: string) => void;
}) {
  const monthSnapshots = (trendRows || []).filter(
    (row) => monthKeyForDate(row.as_of || row.created_at || row.snapshot_at) === month?.key,
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl rounded-[24px] border-line bg-surface-1">
        <DialogHeader>
          <DialogTitle className="text-xl font-extrabold text-content-1">
            {month?.label || "Month"} stock proof
          </DialogTitle>
          <DialogDescription className="font-semibold text-content-3">
            Monthly snapshot is reporting proof only. It does not lock the FY.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          <ProofMetric label="Count sheets" value={String(batches.length)} />
          <ProofMetric label="Snapshots" value={String(monthSnapshots.length)} />
          <ProofMetric label="FY lock" value="NO" />
        </div>
        <div className="max-h-[420px] overflow-auto rounded-2xl border border-line">
          <table className="w-full min-w-[620px] text-xs">
            <thead className="bg-surface-2 text-left text-[10px] font-extrabold uppercase tracking-[0.13em] text-content-3">
              <tr>
                <th className="px-3 py-2">Sheet</th>
                <th>Scope</th>
                <th>Status</th>
                <th>Posted</th>
                <th className="text-right">Lines</th>
              </tr>
            </thead>
            <tbody className="font-bold">
              {batches.map((batch) => (
                <tr key={batch.id} className="border-t border-line">
                  <td className="px-3 py-2">
                    <button type="button" onClick={() => onOpenBatch(String(batch.id))} className="font-mono text-primary underline-offset-4 hover:underline">
                      {batch.batch_no || batch.id}
                    </button>
                  </td>
                  <td className="text-content-3">{batchScopeText(batch)}</td>
                  <td>{batch.status}</td>
                  <td>{batch.posted_at ? formatDisplayDate(batch.posted_at) : "-"}</td>
                  <td className="text-right font-mono">{batch.line_count || 0}</td>
                </tr>
              ))}
              {!batches.length ? (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-sm font-semibold text-content-3">
                    No posted physical count sheet is linked to this month yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LedgerSourceDialog({
  row,
  onClose,
}: {
  row: Record<string, any> | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={Boolean(row)} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-2xl rounded-[24px] border-line bg-surface-1">
        <DialogHeader>
          <DialogTitle className="text-xl font-extrabold text-content-1">
            {row?.reference || "Stock movement proof"}
          </DialogTitle>
          <DialogDescription className="font-semibold text-content-3">
            {row ? stockSourceLabel(row) : "Source movement"}
          </DialogDescription>
        </DialogHeader>
        {row ? (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <ProofMetric label="Date" value={row.at ? formatDisplayDate(row.at) : "-"} />
              <ProofMetric label="Type" value={String(row.source || "-").replace(/_/g, " ")} />
              <ProofMetric label="Qty" value={qtyWithUom(row.qty, row.uom)} />
            </div>
            <div className="rounded-2xl border border-line bg-surface-2 p-4">
              <div className="text-xs font-extrabold uppercase tracking-[0.16em] text-content-4">Source metadata</div>
              <pre className="mt-3 max-h-[320px] overflow-auto rounded-xl bg-surface-1 p-3 text-[11px] font-semibold text-content-3">
                {JSON.stringify(row.meta || row, null, 2)}
              </pre>
            </div>
            {String(row.reference || "").startsWith("PACKING_EOD_COUNT:") ? (
              <div className="rounded-2xl border border-info-border bg-info-bg p-3 text-xs font-bold leading-5 text-info-fg">
                This row came from EOD packing count. The EOD proof panel on this page is set to the same count date.
              </div>
            ) : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function EodPackingProofPanel({
  date,
  onDateChange,
  snapshot,
  loading,
}: {
  date: string;
  onDateChange: (date: string) => void;
  snapshot: any;
  loading: boolean;
}) {
  const allocation = snapshot?.eod_allocation || {};
  const rows = allocation.transaction_rows || [];
  return (
    <Panel title="EOD packing stock count proof">
      <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="max-w-3xl text-sm font-semibold leading-6 text-content-3">
          Evening packing count posts packaging stock movement for tape, sheets, labels, tags, boxes, and other manual packing SKUs. Short counts are allocated to same-day allowed packed orders; excess counts are posted as count excess.
        </div>
        <Input
          type="date"
          value={date}
          onChange={(event) => onDateChange(event.target.value)}
          className="h-10 rounded-xl font-mono text-xs font-extrabold lg:w-[170px]"
        />
      </div>
      <div className="grid gap-2 sm:grid-cols-4">
        <KpiCard label="Sessions" value={qty(allocation.sessions || 0, 0)} />
        <KpiCard label="Transactions" value={qty(allocation.transaction_count ?? allocation.transactions ?? 0, 0)} />
        <KpiCard label="Mapped orders" value={qty(allocation.mapped_orders || 0, 0)} />
        <KpiCard label="Unassigned qty" value={qty(allocation.unassigned_qty || 0, 2)} />
      </div>
      {!rows.length ? (
        <EmptyState
          message={
            loading
              ? "Loading EOD packing proof..."
              : "No EOD packing count transaction was posted for this date/plant."
          }
          compact
        />
      ) : (
      <div className="mt-3 max-h-[360px] overflow-auto rounded-2xl border border-line">
        <table className="w-full min-w-[900px] text-xs">
          <thead className="sticky top-0 bg-surface-2 text-left text-[10px] font-extrabold uppercase tracking-[0.13em] text-content-3">
            <tr>
              <th className="px-3 py-2">Time</th>
              <th>Material</th>
              <th>Location</th>
              <th>Type</th>
              <th className="text-right">System</th>
              <th className="text-right">Counted</th>
              <th className="text-right">Delta</th>
              <th>Order</th>
            </tr>
          </thead>
          <tbody className="font-bold">
            {rows.map((row: Record<string, any>) => (
              <tr key={row.id} className="border-t border-line">
                <td className="px-3 py-2 text-content-3">{row.created_at ? formatDisplayDate(row.created_at) : "-"}</td>
                <td>
                  <div className="font-mono text-content-1">{row.material_code}</div>
                  <div className="max-w-[240px] truncate text-[11px] text-content-3">{row.material_name}</div>
                </td>
                <td className="text-content-3">{row.location_name}</td>
                <td>{String(row.type || "").replace(/_/g, " ")}</td>
                <td className="text-right font-mono">{qty(row.system_qty_before, 2)}</td>
                <td className="text-right font-mono">{qty(row.counted_qty, 2)}</td>
                <td className={cn("text-right font-mono", Number(row.delta_qty || 0) < 0 ? "text-danger-fg" : Number(row.delta_qty || 0) > 0 ? "text-success-fg" : "text-content-3")}>
                  {qty(row.delta_qty, 2)}
                </td>
                <td className="font-mono text-content-3">{row.order_number || row.allocation_mode || "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </Panel>
  );
}

function buildFyMonthTracker(
  financialYear: string,
  countBatches: Array<Record<string, any>>,
  trendRows: Array<Record<string, any>>,
) {
  const [startRaw] = String(financialYear || currentFinancialYear()).split("-");
  const startYear = Number(startRaw) || new Date().getFullYear();
  const months = [
    ["Apr", startYear, 3],
    ["May", startYear, 4],
    ["Jun", startYear, 5],
    ["Jul", startYear, 6],
    ["Aug", startYear, 7],
    ["Sep", startYear, 8],
    ["Oct", startYear, 9],
    ["Nov", startYear, 10],
    ["Dec", startYear, 11],
    ["Jan", startYear + 1, 0],
    ["Feb", startYear + 1, 1],
    ["Mar", startYear + 1, 2],
  ] as const;
  const now = new Date();
  return months.map(([label, year, month]) => {
    const key = `${year}-${String(month + 1).padStart(2, "0")}`;
    const count = countBatches.filter((batch) => {
      const date = new Date(
        batch.posted_at || batch.cutoff_at || batch.created_at || "",
      );
      return (
        !Number.isNaN(date.getTime()) &&
        date.getFullYear() === year &&
        date.getMonth() === month
      );
    }).length;
    const snapshot = trendRows.some((row) => {
      const date = new Date(
        row.as_of || row.created_at || row.snapshot_at || "",
      );
      return (
        !Number.isNaN(date.getTime()) &&
        date.getFullYear() === year &&
        date.getMonth() === month
      );
    });
    return {
      key,
      label,
      year,
      month,
      counted: count > 0,
      snapshot,
      count,
      isCurrent: now.getFullYear() === year && now.getMonth() === month,
    };
  });
}

function monthKeyForDate(value?: string | Date | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function CategoryRail({
  active,
  onChange,
  catalog,
}: {
  active: string | null;
  onChange: (value: string | null) => void;
  catalog?: MasterCatalog;
}) {
  const counts = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const row of catalog?.rows || [])
      map.set(row.category, (map.get(row.category) || 0) + 1);
    return map;
  }, [catalog?.rows]);

  return (
    <section className="rounded-[18px] border border-line bg-surface-1/75 p-3 shadow-sm backdrop-blur">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onChange(null)}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[11px] font-extrabold ring-1",
            active === null
              ? "bg-surface-3 text-white ring-line-strong"
              : "bg-surface-1 text-content-3 ring-line hover:bg-surface-2",
          )}
        >
          <Sparkles className="h-3.5 w-3.5" />
          All categories
        </button>
        {CATEGORY_META.map((category) => {
          const Icon = category.icon;
          const selected = active === category.key;
          return (
            <button
              key={category.key}
              type="button"
              onClick={() => onChange(selected ? null : category.key)}
              className={cn(
                "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-[11px] font-extrabold ring-1",
                selected
                  ? "bg-surface-3 text-white ring-line-strong"
                  : "bg-surface-1 text-content-3 ring-line hover:bg-surface-2",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {category.label}
              <span className="font-mono opacity-70">
                {counts.get(category.key) || 0}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function EmptyState({
  message,
  compact = false,
}: {
  message: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-dashed border-line-strong bg-surface-2 text-center text-sm font-semibold text-content-3",
        compact ? "p-5" : "p-10",
      )}
    >
      {message}
    </div>
  );
}

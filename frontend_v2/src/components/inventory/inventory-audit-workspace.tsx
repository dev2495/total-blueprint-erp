"use client";

import { ChangeEvent, type ReactNode, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowDownUp,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  LockKeyhole,
  PackageCheck,
  Plus,
  RefreshCw,
  Scale,
  Search,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { factoryService } from "@/services/factory";
import {
  inventoryService,
  type InventoryAuditBatch,
} from "@/services/inventory";
import { masterDataService } from "@/services/master-data";
import { recipeService } from "@/services/recipes";
import { formatDisplayDateTime } from "@/lib/date-format";

type AuditMode = "OPENING_STOCK" | "PHYSICAL_COUNT" | "FY_CORRECTION";
type StockClass = "BULK" | "ROLL" | "PACKAGING";
type LineSortKey =
  | "class"
  | "material"
  | "location"
  | "system"
  | "entered"
  | "variance"
  | "value"
  | "validation";

const classOptions: Array<{ value: StockClass; label: string; hint: string }> =
  [
    {
      value: "BULK",
      label: "Bulk",
      hint: "Granules, inks, solvents, adhesives",
    },
    {
      value: "ROLL",
      label: "Rolls",
      hint: "Physical roll labels with width and thickness",
    },
    {
      value: "PACKAGING",
      label: "Packaging",
      hint: "Pouches, sheets, gonny, tape, boxes",
    },
  ];

function currentFy() {
  const now = new Date();
  const year =
    now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
  return `${year}-${year + 1}`;
}

function errText(error: any) {
  const data = error?.response?.data;
  if (!data) return error?.message || "Request failed";
  if (typeof data.detail === "string") return data.detail;
  if (Array.isArray(data.detail)) return data.detail.join(", ");
  return JSON.stringify(data.detail || data);
}

function toNumber(value: any) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseCsv(text: string) {
  const [headerLine, ...lines] = text.trim().split(/\r?\n/);
  const headers = headerLine.split(",").map((h) => h.trim());
  return lines
    .map((line) => line.split(",").map((cell) => cell.trim()))
    .filter((cells) => cells.length > 1)
    .map((cells) =>
      Object.fromEntries(
        headers.map((header, index) => [header, cells[index] ?? ""]),
      ),
    );
}

async function downloadBlob(url: string, payload: any, fileName: string) {
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

export function InventoryAuditWorkspace({ mode }: { mode: AuditMode }) {
  const queryClient = useQueryClient();
  const [stockClass, setStockClass] = useState<StockClass>("BULK");
  const [financialYear, setFinancialYear] = useState(currentFy());
  const [selectedPlant, setSelectedPlant] = useState("");
  const [selectedBatchId, setSelectedBatchId] = useState("");
  const [notes, setNotes] = useState("");
  const [line, setLine] = useState<Record<string, any>>({
    status: "AVAILABLE",
    uom: "KG",
  });
  const [lineSearch, setLineSearch] = useState("");
  const [lineSortKey, setLineSortKey] = useState<LineSortKey>("material");
  const [lineSortDirection, setLineSortDirection] = useState<"asc" | "desc">(
    "asc",
  );
  const copy = {
    OPENING_STOCK: {
      title: "Opening Stock",
      subtitle:
        "Use once at go-live or when a new financial year opening is approved. This creates real stock but never creates a vendor GRN.",
      action: "Post Opening Stock",
      sheetLabel: "Opening sheet",
      createLabel: "Start Opening Sheet",
      entryLabel: "Opening Lines",
      qtyLabel: "Opening qty",
      postNoteTitle: "Posting creates starting balances, not purchases",
      postNote:
        "Bulk, rolls, and packaging become real inventory tagged as OPENING. Vendor purchase/inward reports stay clean.",
      empty:
        "No opening lines yet. Start a sheet, download the sample if needed, then add/import Bulk, Rolls, or Packaging.",
      helper: [
        "Select FY and plant.",
        "Add/import the physical opening stock.",
        "Validate row errors.",
        "Post once approved by store/admin.",
      ],
    },
    PHYSICAL_COUNT: {
      title: "Physical Stock Count",
      subtitle:
        "Load live system stock, capture the floor count, and post only the shortage or excess variance.",
      action: "Post Variance",
      sheetLabel: "Count sheet",
      createLabel: "Start Count Sheet",
      entryLabel: "Floor Count Lines",
      qtyLabel: "Counted qty",
      postNoteTitle: "Posting adjusts only the difference",
      postNote:
        "System stock is preserved as reference. ERP posts shortage or excess only, with user, time, and reason.",
      empty:
        "No count lines yet. Start a sheet, click Load Live Stock, then enter counted quantities.",
      helper: [
        "Select plant and optional material/location.",
        "Load live stock into the count sheet.",
        "Enter counted quantity from floor count.",
        "Post shortage/excess variance with notes.",
      ],
    },
    FY_CORRECTION: {
      title: "FY Correction",
      subtitle:
        "Use after year close when an approved backdated correction is required. Normal GRN or stock edits stay blocked for closed periods.",
      action: "Post FY Correction",
      sheetLabel: "Correction sheet",
      createLabel: "Start Correction Sheet",
      entryLabel: "Correction Lines",
      qtyLabel: "Corrected qty",
      postNoteTitle: "Posting creates a controlled correction",
      postNote:
        "Use this only with a written reason. The correction remains visible in audit registers and stock cards.",
      empty:
        "No correction lines yet. Start a correction sheet, write the reason, then add the affected stock rows.",
      helper: [
        "Select the closed FY and plant.",
        "Write the correction reason or source file.",
        "Add only the affected material rows.",
        "Post after approval; audit trail is permanent.",
      ],
    },
  }[mode];

  const { data: plants = [] } = useQuery({
    queryKey: ["factory-plants"],
    queryFn: factoryService.getPlants,
  });
  const { data: locations = [] } = useQuery({
    queryKey: ["factory-locations"],
    queryFn: factoryService.getLocations,
  });
  const { data: materials = [] } = useQuery({
    queryKey: ["master-library"],
    queryFn: () => masterDataService.getLibrary(),
  });
  const { data: grades = [] } = useQuery({
    queryKey: ["recipe-grades"],
    queryFn: () => recipeService.getGrades(),
  });
  const { data: granuleCodes = [] } = useQuery({
    queryKey: ["granule-codes"],
    queryFn: () => masterDataService.getGranuleCodes({ status: "ACTIVE" }),
  });
  const { data: batches = [], isFetching } = useQuery({
    queryKey: ["inventory-audit-batches", mode, financialYear, selectedPlant],
    queryFn: () =>
      inventoryService.getAuditBatches({
        type: mode,
        financial_year: financialYear,
        plant: selectedPlant || undefined,
      }),
  });

  const currentBatch = useMemo(() => {
    return (
      batches.find((batch) => batch.id === selectedBatchId) ||
      batches.find((batch) => batch.status === "DRAFT") ||
      batches[0]
    );
  }, [batches, selectedBatchId]);

  const filteredMaterials = useMemo(() => {
    if (stockClass === "ROLL")
      return materials.filter((m: any) => m.category === "FILM_VARIANT");
    if (stockClass === "PACKAGING")
      return materials.filter((m: any) => m.category === "PACKAGING");
    return materials.filter((m: any) =>
      ["GRANULE", "INK", "SOLVENT", "ADHESIVE"].includes(
        String(m.category || "").toUpperCase(),
      ),
    );
  }, [materials, stockClass]);

  const selectedMaterial = filteredMaterials.find(
    (m: any) => String(m.id) === String(line.material),
  );
  const plantLocations = selectedPlant
    ? locations.filter(
        (loc: any) => String(loc.plant) === String(selectedPlant),
      )
    : locations;
  const visibleLines = useMemo(() => {
    const rows = currentBatch?.lines || [];
    const q = lineSearch.trim().toLowerCase();
    const filtered = q
      ? rows.filter((row) =>
          [
            row.stock_class,
            row.material_code,
            row.material_name,
            row.location_name,
            row.row_errors?.join(" "),
          ]
            .map((value) => String(value || "").toLowerCase())
            .join(" ")
            .includes(q),
        )
      : rows;

    function valueFor(row: any, key: LineSortKey) {
      if (key === "class") return String(row.stock_class || "");
      if (key === "material")
        return `${row.material_code || ""} ${row.material_name || ""}`.toLowerCase();
      if (key === "location")
        return String(row.location_name || "").toLowerCase();
      if (key === "system") return Number(row.system_qty || 0);
      if (key === "entered")
        return Number(
          mode === "OPENING_STOCK" ? row.opening_qty : row.counted_qty || 0,
        );
      if (key === "variance") return Number(row.variance_qty || 0);
      if (key === "value") return Number(row.value || 0);
      return row.row_errors?.length ? "error" : "ok";
    }

    return filtered.slice().sort((left, right) => {
      const leftValue = valueFor(left, lineSortKey);
      const rightValue = valueFor(right, lineSortKey);
      const order = lineSortDirection === "asc" ? 1 : -1;
      if (typeof leftValue === "number" && typeof rightValue === "number")
        return (leftValue - rightValue) * order;
      return String(leftValue).localeCompare(String(rightValue)) * order;
    });
  }, [currentBatch?.lines, lineSearch, lineSortDirection, lineSortKey, mode]);

  function toggleLineSort(nextKey: LineSortKey) {
    if (lineSortKey === nextKey) {
      setLineSortDirection((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setLineSortKey(nextKey);
    setLineSortDirection(
      ["system", "entered", "variance", "value"].includes(nextKey)
        ? "desc"
        : "asc",
    );
  }

  function LineSortHeader({
    id,
    children,
    align = "left",
  }: {
    id: LineSortKey;
    children: ReactNode;
    align?: "left" | "right";
  }) {
    const active = lineSortKey === id;
    return (
      <th className={`px-4 py-3 ${align === "right" ? "text-right" : ""}`}>
        <button
          type="button"
          onClick={() => toggleLineSort(id)}
          className={`inline-flex items-center gap-2 rounded-full px-2 py-1 hover:bg-surface-1 hover:text-content-1 ${active ? "text-content-1" : ""}`}
        >
          <span>{children}</span>
          <ArrowDownUp className="h-3 w-3" />
          {active ? (
            <span className="text-[10px]">
              {lineSortDirection === "asc" ? "ASC" : "DESC"}
            </span>
          ) : null}
        </button>
      </th>
    );
  }

  const createBatch = useMutation({
    mutationFn: () =>
      inventoryService.createAuditBatch({
        type: mode,
        plant: selectedPlant,
        financial_year: financialYear,
        cutoff_at: new Date().toISOString(),
        notes,
      }),
    onSuccess: (batch) => {
      setSelectedBatchId(batch.id);
      toast.success(`${copy.sheetLabel} created`);
      queryClient.invalidateQueries({ queryKey: ["inventory-audit-batches"] });
    },
    onError: (error) =>
      toast.error(`${copy.sheetLabel} was not created`, {
        description: errText(error),
      }),
  });

  const importLines = useMutation({
    mutationFn: ({ batchId, lines }: { batchId: string; lines: any[] }) =>
      inventoryService.importAuditLines(batchId, { lines }),
    onSuccess: (batch) => {
      setSelectedBatchId(batch.id);
      setLine({ status: "AVAILABLE", uom: "KG" });
      toast.success("Line added to working sheet");
      queryClient.invalidateQueries({ queryKey: ["inventory-audit-batches"] });
    },
    onError: (error) =>
      toast.error("Line was not added", { description: errText(error) }),
  });

  const validateBatch = useMutation({
    mutationFn: (batchId: string) =>
      inventoryService.validateAuditBatch(batchId),
    onSuccess: (batch) => {
      toast[batch.validation?.ok ? "success" : "error"](
        batch.validation?.ok ? "Draft validated" : "Draft has row errors",
      );
      queryClient.invalidateQueries({ queryKey: ["inventory-audit-batches"] });
    },
    onError: (error) =>
      toast.error("Validation failed", { description: errText(error) }),
  });

  const postBatch = useMutation({
    mutationFn: (batchId: string) => inventoryService.postAuditBatch(batchId),
    onSuccess: () => {
      toast.success(
        mode === "OPENING_STOCK"
          ? "Opening stock posted"
          : "Stock count variance posted",
      );
      queryClient.invalidateQueries({ queryKey: ["inventory-audit-batches"] });
      queryClient.invalidateQueries({ queryKey: ["bulk-stock"] });
      queryClient.invalidateQueries({ queryKey: ["packaging-stock"] });
    },
    onError: (error) =>
      toast.error("Posting failed", { description: errText(error) }),
  });

  const summary = currentBatch?.summary_json || {};
  const canEdit = !currentBatch || currentBatch.status === "DRAFT";
  const supportsLiveLoad = mode !== "OPENING_STOCK";

  function addManualLine() {
    if (!currentBatch?.id) {
      toast.error("Create or select a draft first");
      return;
    }
    const payload = {
      ...line,
      stock_class: stockClass,
      material: line.material,
      location: line.location,
      uom: line.uom || (selectedMaterial as any)?.base_uom || "KG",
      opening_qty: mode === "OPENING_STOCK" ? toNumber(line.quantity) : 0,
      counted_qty:
        mode !== "OPENING_STOCK" ? toNumber(line.quantity) : undefined,
      quantity: toNumber(line.quantity),
      width_mm: line.width_mm ? toNumber(line.width_mm) : undefined,
      thickness_micron: line.thickness_micron
        ? toNumber(line.thickness_micron)
        : undefined,
      length_m: line.length_m ? toNumber(line.length_m) : undefined,
      rate:
        line.rate === "" || line.rate == null ? undefined : toNumber(line.rate),
    };
    importLines.mutate({ batchId: currentBatch.id, lines: [payload] });
  }

  async function onCsvFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !currentBatch?.id) return;
    if (file.name.toLowerCase().endsWith(".csv")) {
      const text = await file.text();
      const rows = parseCsv(text).map((row) => ({
        ...row,
        stock_class: row.stock_class || stockClass,
      }));
      importLines.mutate({ batchId: currentBatch.id, lines: rows });
    } else {
      uploadFile.mutate({ batchId: currentBatch.id, file });
    }
    event.target.value = "";
  }

  const uploadFile = useMutation({
    mutationFn: ({ batchId, file }: { batchId: string; file: File }) =>
      inventoryService.importAuditLinesFile(batchId, file, stockClass),
    onSuccess: (batch) => {
      setSelectedBatchId(batch.id);
      toast.success("Audit file imported");
      queryClient.invalidateQueries({ queryKey: ["inventory-audit-batches"] });
    },
    onError: (error) =>
      toast.error("File import failed", { description: errText(error) }),
  });

  const preloadLiveStock = useMutation({
    mutationFn: ({ batchId }: { batchId: string }) =>
      inventoryService.loadAuditBatchFromSystemStock(batchId, {
        stock_class: stockClass,
        location: line.location || undefined,
        material: line.material || undefined,
        replace_existing: true,
      }),
    onSuccess: (batch) => {
      setSelectedBatchId(batch.id);
      toast.success("Live stock loaded into draft");
      queryClient.invalidateQueries({ queryKey: ["inventory-audit-batches"] });
    },
    onError: (error) =>
      toast.error("Live stock was not loaded", { description: errText(error) }),
  });

  function downloadSample() {
    window.open(
      inventoryService.getAuditSampleTemplateUrl({
        type: mode,
        stock_class: stockClass,
      }),
      "_blank",
      "noopener,noreferrer",
    );
  }

  function downloadBatchRegister() {
    if (!currentBatch?.id) return;
    window.open(
      inventoryService.getAuditBatchExportUrl(currentBatch.id),
      "_blank",
      "noopener,noreferrer",
    );
  }

  return (
    <div className="space-y-6 pb-10">
      <section className="rounded-[2rem] border border-line bg-gradient-to-br from-surface-3 via-surface-3 to-primary p-6 text-white shadow-[0_24px_80px_rgba(15,23,42,0.16)]">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl space-y-3">
            <Badge className="rounded-full border-surface-1/20 bg-surface-1/10 text-[11px] font-black uppercase tracking-[0.28em] text-white">
              Inventory Audit
            </Badge>
            <div>
              <h1 className="text-3xl font-black tracking-tight sm:text-4xl">
                {copy.title}
              </h1>
              <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-info-border">
                {copy.subtitle}
              </p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-4 lg:min-w-[520px]">
            {[
              ["Bulk kg", summary.bulk_kg || 0],
              ["Roll kg", summary.roll_kg || 0],
              ["Packaging", summary.packaging_qty || 0],
              ["Value", summary.value || 0],
            ].map(([label, value]) => (
              <div
                key={label}
                className="rounded-2xl border border-surface-1/10 bg-surface-1/10 p-3"
              >
                <div className="text-[10px] font-black uppercase tracking-[0.22em] text-info-border">
                  {label}
                </div>
                <div className="mt-2 text-xl font-black">
                  {Number(value).toLocaleString("en-IN", {
                    maximumFractionDigits: 2,
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-4">
        {copy.helper.map((step, index) => (
          <div
            key={step}
            className="rounded-2xl border border-line bg-surface-1 p-4 shadow-sm"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-info-bg text-sm font-black text-primary">
              {index + 1}
            </div>
            <div className="mt-3 text-sm font-bold leading-5 text-content-2">
              {step}
            </div>
          </div>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-[360px_1fr]">
        <Card className="rounded-[1.5rem] border-line bg-surface-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg font-black">
              <PackageCheck className="h-5 w-5 text-primary" />
              {copy.sheetLabel} Control
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2">
              <Label>Financial year</Label>
              <Input
                value={financialYear}
                onChange={(event) => setFinancialYear(event.target.value)}
                placeholder="2026-2027"
              />
            </div>
            <div className="grid gap-2">
              <Label>Plant</Label>
              <Select value={selectedPlant} onValueChange={setSelectedPlant}>
                <SelectTrigger>
                  <SelectValue placeholder="Select plant" />
                </SelectTrigger>
                <SelectContent>
                  {plants.map((plant: any) => (
                    <SelectItem key={plant.id} value={plant.id}>
                      {plant.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Working sheet</Label>
              <Select
                value={currentBatch?.id || ""}
                onValueChange={setSelectedBatchId}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={
                      isFetching ? "Loading..." : "No batch selected"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {batches.map((batch: InventoryAuditBatch) => (
                    <SelectItem key={batch.id} value={batch.id}>
                      {batch.batch_no} · {batch.status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder={
                mode === "FY_CORRECTION"
                  ? "Required correction reason, approval note, or source file reference"
                  : "Notes or source file reference"
              }
            />
            <Button
              className="w-full rounded-2xl bg-surface-3 py-6 font-bold text-white"
              disabled={!selectedPlant || createBatch.isPending}
              onClick={() => createBatch.mutate()}
            >
              <Plus className="mr-2 h-4 w-4" />
              {copy.createLabel}
            </Button>
            {currentBatch ? (
              <div className="rounded-2xl border border-line bg-surface-2 p-4 text-sm">
                <div className="font-black text-content-1">
                  {currentBatch.batch_no}
                </div>
                <div className="mt-1 text-content-3">
                  {currentBatch.line_count || currentBatch.lines?.length || 0}{" "}
                  lines · {currentBatch.status}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={downloadSample}
                  >
                    <Download className="mr-2 h-4 w-4" />
                    Download Sample
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!currentBatch}
                    onClick={downloadBatchRegister}
                  >
                    <Download className="mr-2 h-4 w-4" />
                    Export Posted Sheet
                  </Button>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="rounded-[1.5rem] border-line bg-surface-1">
          <CardHeader>
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <CardTitle className="flex items-center gap-2 text-lg font-black">
                <FileSpreadsheet className="h-5 w-5 text-success-fg" />
                {copy.entryLabel}
              </CardTitle>
              <Tabs
                value={stockClass}
                onValueChange={(value) => setStockClass(value as StockClass)}
              >
                <TabsList className="grid w-full grid-cols-3 rounded-2xl bg-surface-2 lg:w-[360px]">
                  {classOptions.map((option) => (
                    <TabsTrigger key={option.value} value={option.value}>
                      {option.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="grid gap-2 xl:col-span-2">
                <Label>Material</Label>
                <Select
                  value={line.material || ""}
                  onValueChange={(value) =>
                    setLine((prev) => ({ ...prev, material: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select material" />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredMaterials.map((material: any) => (
                      <SelectItem key={material.id} value={material.id}>
                        {material.code} · {material.name || material.code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Location</Label>
                <Select
                  value={line.location || ""}
                  onValueChange={(value) =>
                    setLine((prev) => ({ ...prev, location: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select location" />
                  </SelectTrigger>
                  <SelectContent>
                    {plantLocations.map((location: any) => (
                      <SelectItem key={location.id} value={location.id}>
                        {location.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>{copy.qtyLabel}</Label>
                <Input
                  type="number"
                  value={line.quantity || ""}
                  onChange={(event) =>
                    setLine((prev) => ({
                      ...prev,
                      quantity: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label>UOM</Label>
                <Input
                  value={
                    line.uom || (selectedMaterial as any)?.base_uom || "KG"
                  }
                  onChange={(event) =>
                    setLine((prev) => ({ ...prev, uom: event.target.value }))
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label>Rate (optional)</Label>
                <Input
                  type="number"
                  value={line.rate || ""}
                  onChange={(event) =>
                    setLine((prev) => ({ ...prev, rate: event.target.value }))
                  }
                />
              </div>
              {stockClass === "BULK" &&
              selectedMaterial?.category === "GRANULE" ? (
                <div className="grid gap-2">
                  <Label>Granule code</Label>
                  <Select
                    value={line.granule_code || ""}
                    onValueChange={(value) =>
                      setLine((prev) => ({ ...prev, granule_code: value }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Optional code" />
                    </SelectTrigger>
                    <SelectContent>
                      {granuleCodes
                        .filter(
                          (code: any) =>
                            String(code.granule) === String(line.material),
                        )
                        .map((code: any) => (
                          <SelectItem key={code.id} value={code.id}>
                            {code.code}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
              {stockClass === "ROLL" ? (
                <>
                  <div className="grid gap-2">
                    <Label>Label ID</Label>
                    <Input
                      value={line.label_id || ""}
                      onChange={(event) =>
                        setLine((prev) => ({
                          ...prev,
                          label_id: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Batch no</Label>
                    <Input
                      value={line.batch_no || ""}
                      onChange={(event) =>
                        setLine((prev) => ({
                          ...prev,
                          batch_no: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Grade</Label>
                    <Select
                      value={line.grade || ""}
                      onValueChange={(value) =>
                        setLine((prev) => ({ ...prev, grade: value }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Grade if required" />
                      </SelectTrigger>
                      <SelectContent>
                        {grades.map((grade: any) => (
                          <SelectItem key={grade.id} value={grade.id}>
                            {grade.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label>Width mm</Label>
                    <Input
                      type="number"
                      value={line.width_mm || ""}
                      onChange={(event) =>
                        setLine((prev) => ({
                          ...prev,
                          width_mm: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Thickness micron</Label>
                    <Input
                      type="number"
                      value={line.thickness_micron || ""}
                      onChange={(event) =>
                        setLine((prev) => ({
                          ...prev,
                          thickness_micron: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Stage index</Label>
                    <Input
                      type="number"
                      value={line.stage_index || 0}
                      onChange={(event) =>
                        setLine((prev) => ({
                          ...prev,
                          stage_index: event.target.value,
                        }))
                      }
                    />
                  </div>
                </>
              ) : null}
            </div>

            <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface-2 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-content-3">
                Import CSV or Excel. Start from the sample file so operators
                fill the exact ERP format without guessing columns.
              </div>
              <div className="flex gap-2">
                <Input
                  className="max-w-[220px] bg-surface-1"
                  type="file"
                  accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  disabled={!canEdit || !currentBatch}
                  onChange={onCsvFile}
                />
                {supportsLiveLoad ? (
                  <Button
                    variant="outline"
                    disabled={
                      !canEdit || !currentBatch || preloadLiveStock.isPending
                    }
                    onClick={() =>
                      preloadLiveStock.mutate({ batchId: currentBatch!.id })
                    }
                  >
                    <Scale className="mr-2 h-4 w-4" />
                    Load System Stock
                  </Button>
                ) : null}
                <Button variant="outline" onClick={downloadSample}>
                  <Download className="mr-2 h-4 w-4" />
                  Sample
                </Button>
                <Button
                  variant="outline"
                  disabled={!currentBatch}
                  onClick={() => validateBatch.mutate(currentBatch!.id)}
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Validate
                </Button>
                <Button
                  disabled={!canEdit || !currentBatch}
                  onClick={addManualLine}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add Line
                </Button>
              </div>
            </div>

            <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface-1 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="relative w-full sm:max-w-sm">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-4" />
                <Input
                  className="pl-9"
                  value={lineSearch}
                  onChange={(event) => setLineSearch(event.target.value)}
                  placeholder="Search sheet lines..."
                />
              </div>
              <div className="text-xs font-bold uppercase tracking-[0.14em] text-content-4">
                {visibleLines.length} visible line(s)
              </div>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-line">
              <table className="min-w-[940px] w-full text-left text-sm">
                <thead className="bg-surface-2 text-[11px] font-black uppercase tracking-[0.16em] text-content-3">
                  <tr>
                    <LineSortHeader id="class">Class</LineSortHeader>
                    <LineSortHeader id="material">Material</LineSortHeader>
                    <LineSortHeader id="location">Location</LineSortHeader>
                    <LineSortHeader id="system" align="right">
                      System
                    </LineSortHeader>
                    <LineSortHeader id="entered" align="right">
                      {mode === "OPENING_STOCK"
                        ? "Opening"
                        : "Counted / Corrected"}
                    </LineSortHeader>
                    <LineSortHeader id="variance" align="right">
                      Variance
                    </LineSortHeader>
                    <LineSortHeader id="value" align="right">
                      Value
                    </LineSortHeader>
                    <LineSortHeader id="validation">Validation</LineSortHeader>
                  </tr>
                </thead>
                <tbody>
                  {visibleLines.map((row) => (
                    <tr key={row.id} className="border-t border-line">
                      <td className="px-4 py-3 font-bold">{row.stock_class}</td>
                      <td className="px-4 py-3">
                        <div className="font-bold text-content-1">
                          {row.material_code}
                        </div>
                        <div className="text-xs text-content-3">
                          {row.material_name}
                        </div>
                      </td>
                      <td className="px-4 py-3">{row.location_name}</td>
                      <td className="px-4 py-3 text-right">
                        {Number(row.system_qty || 0).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {Number(
                          mode === "OPENING_STOCK"
                            ? row.opening_qty
                            : row.counted_qty || 0,
                        ).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {Number(row.variance_qty || 0).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        ₹{Number(row.value || 0).toLocaleString("en-IN")}
                      </td>
                      <td className="px-4 py-3">
                        {row.row_errors?.length ? (
                          <Badge
                            variant="destructive"
                            className="max-w-[260px] whitespace-normal"
                          >
                            {row.row_errors.join("; ")}
                          </Badge>
                        ) : (
                          <Badge className="bg-success-bg text-success-fg">
                            OK
                          </Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!currentBatch?.lines?.length ? (
                    <tr>
                      <td
                        colSpan={8}
                        className="px-4 py-10 text-center text-content-3"
                      >
                        {copy.empty}
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-3 rounded-2xl border border-warning-border bg-warning-bg p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-5 w-5 text-warning-fg" />
                <div>
                  <div className="font-black text-warning-fg">
                    {copy.postNoteTitle}
                  </div>
                  <div className="text-sm text-warning-fg">{copy.postNote}</div>
                </div>
              </div>
              <Button
                className="rounded-2xl bg-success-fg py-6 font-black text-white hover:bg-success-fg"
                disabled={
                  !currentBatch ||
                  currentBatch.status !== "DRAFT" ||
                  postBatch.isPending
                }
                onClick={() =>
                  currentBatch && postBatch.mutate(currentBatch.id)
                }
              >
                <CheckCircle2 className="mr-2 h-4 w-4" />
                {copy.action}
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

export function InventoryYearCloseWorkspace() {
  const queryClient = useQueryClient();
  const [financialYear, setFinancialYear] = useState(currentFy());
  const [selectedPlant, setSelectedPlant] = useState("");
  const { data: plants = [] } = useQuery({
    queryKey: ["factory-plants"],
    queryFn: factoryService.getPlants,
  });
  const { data: periods = [] } = useQuery({
    queryKey: ["inventory-audit-periods"],
    queryFn: inventoryService.getAuditPeriods,
  });
  const period =
    periods.find((row) => row.financial_year === financialYear) || periods[0];
  const { data: preview, isFetching } = useQuery({
    queryKey: ["inventory-closing-preview", selectedPlant, financialYear],
    queryFn: () =>
      inventoryService.getClosingPreview({
        plant: selectedPlant || undefined,
        financial_year: financialYear,
      }),
  });
  const closePeriod = useMutation({
    mutationFn: () =>
      inventoryService.closePeriod(period!.id, { plant: selectedPlant }),
    onSuccess: () => {
      toast.success("Financial year closed and next opening batch generated");
      queryClient.invalidateQueries({ queryKey: ["inventory-audit-periods"] });
      queryClient.invalidateQueries({
        queryKey: ["inventory-closing-preview"],
      });
    },
    onError: (error) =>
      toast.error("FY close blocked", { description: errText(error) }),
  });

  async function downloadClosingPreview() {
    try {
      await downloadBlob(
        inventoryService.getClosingPreviewExportUrl(),
        { plant: selectedPlant, financial_year: financialYear },
        `fy-close-${financialYear}.xlsx`,
      );
      toast.success("Closing preview exported");
    } catch (error) {
      toast.error("Closing preview export failed", {
        description: errText(error),
      });
    }
  }

  return (
    <div className="space-y-6 pb-10">
      <section className="rounded-[2rem] border border-line bg-gradient-to-br from-warm via-surface-3 to-surface-3 p-6 text-white">
        <Badge className="rounded-full border-surface-1/20 bg-surface-1/10 text-[11px] font-black uppercase tracking-[0.28em] text-white">
          Year-End Lock
        </Badge>
        <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl">
          Financial Year Close
        </h1>
        <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-warm">
          Review closing stock, clear blockers, lock the year, and generate
          next-year opening stock from the approved closing snapshot.
        </p>
      </section>

      <Card className="rounded-[1.5rem]">
        <CardContent className="grid gap-3 pt-6 md:grid-cols-4">
          <div className="grid gap-2">
            <Label>Financial year</Label>
            <Input
              value={financialYear}
              onChange={(event) => setFinancialYear(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label>Plant</Label>
            <Select value={selectedPlant} onValueChange={setSelectedPlant}>
              <SelectTrigger>
                <SelectValue placeholder="Select plant" />
              </SelectTrigger>
              <SelectContent>
                {plants.map((plant: any) => (
                  <SelectItem key={plant.id} value={plant.id}>
                    {plant.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="outline"
            className="self-end rounded-2xl py-6"
            disabled={!selectedPlant}
            onClick={downloadClosingPreview}
          >
            <Download className="mr-2 h-4 w-4" />
            Export Preview
          </Button>
          <div className="rounded-2xl border border-line bg-surface-2 p-4">
            <div className="text-[11px] font-black uppercase tracking-[0.16em] text-content-3">
              Period status
            </div>
            <div className="mt-2 text-xl font-black">
              {period?.status || "Not started"}
            </div>
          </div>
          <Button
            className="self-end rounded-2xl bg-surface-3 py-6"
            disabled={
              !period ||
              !selectedPlant ||
              closePeriod.isPending ||
              Boolean(preview?.blockers?.length)
            }
            onClick={() => closePeriod.mutate()}
          >
            <LockKeyhole className="mr-2 h-4 w-4" />
            Close FY
          </Button>
        </CardContent>
      </Card>

      <section className="grid gap-4 md:grid-cols-4">
        {[
          ["Bulk kg", preview?.totals?.bulk_kg || 0],
          ["Roll kg", preview?.totals?.roll_kg || 0],
          ["Packaging", preview?.totals?.packaging_qty || 0],
          ["Rows", preview?.totals?.rows || 0],
        ].map(([label, value]) => (
          <Card key={label} className="rounded-[1.25rem]">
            <CardContent className="p-5">
              <div className="text-[11px] font-black uppercase tracking-[0.16em] text-content-3">
                {label}
              </div>
              <div className="mt-2 text-2xl font-black">
                {Number(value).toLocaleString()}
              </div>
            </CardContent>
          </Card>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-[1fr_420px]">
        <Card className="rounded-[1.5rem]">
          <CardHeader>
            <CardTitle>
              Closing preview {isFetching ? "loading..." : ""}
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="min-w-[900px] w-full text-sm">
              <thead className="text-left text-[11px] font-black uppercase tracking-[0.16em] text-content-3">
                <tr>
                  <th className="px-3 py-2">Class</th>
                  <th>Material</th>
                  <th>Location</th>
                  <th className="text-right">Qty</th>
                  <th>UOM</th>
                </tr>
              </thead>
              <tbody>
                {(preview?.rows || []).slice(0, 150).map((row, index) => (
                  <tr
                    key={`${row.stock_class}-${row.material}-${index}`}
                    className="border-t"
                  >
                    <td className="px-3 py-2 font-bold">{row.stock_class}</td>
                    <td>
                      {row.material_code} · {row.material_name}
                    </td>
                    <td>{row.location_name}</td>
                    <td className="text-right">
                      {Number(row.qty || 0).toLocaleString()}
                    </td>
                    <td>{row.uom}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
        <Card className="rounded-[1.5rem]">
          <CardHeader>
            <CardTitle>Close blockers</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {preview?.blockers?.length ? (
              preview.blockers.map((blocker) => (
                <div
                  key={blocker.code}
                  className="rounded-2xl border border-danger-border bg-danger-bg p-4"
                >
                  <div className="font-black text-danger-fg">
                    {blocker.label}
                  </div>
                  <div className="text-sm text-danger-fg">
                    {blocker.count} open item(s)
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-success-border bg-success-bg p-4 font-black text-success-fg">
                No close blockers for selected plant.
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

export function InventoryStockCardWorkspace() {
  const [filters, setFilters] = useState<Record<string, string>>({});
  const { data: plants = [] } = useQuery({
    queryKey: ["factory-plants"],
    queryFn: factoryService.getPlants,
  });
  const { data: locations = [] } = useQuery({
    queryKey: ["factory-locations"],
    queryFn: factoryService.getLocations,
  });
  const { data: materials = [] } = useQuery({
    queryKey: ["master-library"],
    queryFn: () => masterDataService.getLibrary(),
  });
  const { data: stockCard, isFetching } = useQuery({
    queryKey: ["inventory-stock-card", filters],
    queryFn: () => inventoryService.getStockCard(filters),
  });

  async function downloadLedger() {
    try {
      await downloadBlob(
        inventoryService.getStockCardExportUrl(),
        filters,
        "stock-card.xlsx",
      );
      toast.success("Stock card exported");
    } catch (error) {
      toast.error("Stock card export failed", { description: errText(error) });
    }
  }
  return (
    <div className="space-y-6 pb-10">
      <section className="rounded-[2rem] border border-line bg-gradient-to-br from-white via-info-bg to-success-bg p-6">
        <Badge className="rounded-full bg-info-bg text-primary">
          Audit Ledger
        </Badge>
        <h1 className="mt-4 text-3xl font-black tracking-tight text-content-1">
          Material Stock Card
        </h1>
        <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-content-3">
          Opening rows, every movement, and closing balance in one ledger for
          audit export and financial review.
        </p>
        <div className="mt-4">
          <Button
            variant="outline"
            className="rounded-2xl"
            onClick={downloadLedger}
          >
            <Download className="mr-2 h-4 w-4" />
            Export Ledger
          </Button>
        </div>
      </section>
      <Card className="rounded-[1.5rem]">
        <CardContent className="grid gap-3 pt-6 md:grid-cols-5">
          <Select
            value={filters.material || ""}
            onValueChange={(value) =>
              setFilters((prev) => ({ ...prev, material: value }))
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Material" />
            </SelectTrigger>
            <SelectContent>
              {materials.map((m: any) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.code} · {m.name || m.code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filters.plant || ""}
            onValueChange={(value) =>
              setFilters((prev) => ({ ...prev, plant: value }))
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Plant" />
            </SelectTrigger>
            <SelectContent>
              {plants.map((p: any) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={filters.location || ""}
            onValueChange={(value) =>
              setFilters((prev) => ({ ...prev, location: value }))
            }
          >
            <SelectTrigger>
              <SelectValue placeholder="Location" />
            </SelectTrigger>
            <SelectContent>
              {locations.map((l: any) => (
                <SelectItem key={l.id} value={l.id}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="date"
            value={filters.from || ""}
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, from: e.target.value }))
            }
          />
          <Input
            type="date"
            value={filters.to || ""}
            onChange={(e) =>
              setFilters((prev) => ({ ...prev, to: e.target.value }))
            }
          />
        </CardContent>
      </Card>
      <section className="grid gap-4 md:grid-cols-3">
        {[
          ["Opening", stockCard?.opening_qty || 0],
          ["Movements", stockCard?.movement_qty || 0],
          ["Closing", stockCard?.closing_qty || 0],
        ].map(([label, value]) => (
          <Card key={label} className="rounded-[1.25rem]">
            <CardContent className="p-5">
              <div className="text-[11px] font-black uppercase tracking-[0.16em] text-content-3">
                {label}
              </div>
              <div className="mt-2 text-2xl font-black">
                {Number(value).toLocaleString()}
              </div>
            </CardContent>
          </Card>
        ))}
      </section>
      <Card className="rounded-[1.5rem]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="h-5 w-5 text-primary" />
            Stock card rows {isFetching ? "loading..." : ""}
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="min-w-[980px] w-full text-sm">
            <thead className="text-left text-[11px] font-black uppercase tracking-[0.16em] text-content-3">
              <tr>
                <th className="px-3 py-2">Date</th>
                <th>Source</th>
                <th>Reference</th>
                <th>Material</th>
                <th>Location</th>
                <th className="text-right">Qty</th>
                <th>UOM</th>
              </tr>
            </thead>
            <tbody>
              {(stockCard?.rows || []).map((row, index) => (
                <tr key={`${row.reference}-${index}`} className="border-t">
                  <td className="px-3 py-2">
                    {formatDisplayDateTime(row.at)}
                  </td>
                  <td className="font-bold">{row.source}</td>
                  <td>{row.reference}</td>
                  <td>
                    {row.material_code} · {row.material_name}
                  </td>
                  <td>{row.location_name}</td>
                  <td className="text-right">
                    {Number(row.qty || 0).toLocaleString()}
                  </td>
                  <td>{row.uom}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

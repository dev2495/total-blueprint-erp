"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ArrowDownToLine,
  ArrowRightLeft,
  ArrowUpFromLine,
  Blend,
  ClipboardCheck,
  Clock,
  ExternalLink,
  ListChecks,
  MapPin,
  PackageCheck,
  RefreshCw,
  Search,
  Scale,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { describeApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  inkControlService,
  type CurrentShift,
  type FloorBulkStock,
  type InkMaterial,
  type InkFloorMovement,
  type InkFloorSession,
  type Location,
} from "@/services/ink-control";

type WorkspaceTab = "reconcile" | "shift-desk" | "movements" | "counts";
type DeskMode = "issue" | "return" | "mix";
type CountScope = "location" | "plant";

const tabLabels: Record<WorkspaceTab, string> = {
  reconcile: "Reconcile",
  "shift-desk": "Shift Desk",
  movements: "Recent Movements",
  counts: "Posted Counts",
};

const deskModes: Array<{
  key: DeskMode;
  label: string;
  icon: React.ElementType;
}> = [
  { key: "issue", label: "Issue", icon: ArrowDownToLine },
  { key: "return", label: "Return", icon: ArrowUpFromLine },
  { key: "mix", label: "Mix Return", icon: Blend },
];

function asArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === "object" && Array.isArray((value as any).results)) {
    return (value as any).results as T[];
  }
  return [];
}

function n(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function fmt(value: unknown, digits = 3): string {
  return n(value).toLocaleString(undefined, { maximumFractionDigits: digits });
}

function dtLocal(date = new Date()): string {
  const copy = new Date(date);
  copy.setMinutes(copy.getMinutes() - copy.getTimezoneOffset());
  return copy.toISOString().slice(0, 16);
}

function startOfTodayLocal(): string {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return dtLocal(date);
}

function dateOnly(value: string): string {
  return String(value || dtLocal()).slice(0, 10);
}

function localDateOnly(value?: string | null, fallback = dtLocal()): string {
  if (!value) return dateOnly(fallback);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return dateOnly(fallback);
  return dtLocal(parsed).slice(0, 10);
}

function isoFromLocal(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function dateTimeParamToLocalInput(value: string | null): string {
  if (!value) return "";
  const raw = value.trim();
  if (!raw) return "";
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(raw)) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return dtLocal(parsed);
  }
  return raw.slice(0, 16);
}

function locationLabel(location?: Location): string {
  if (!location) return "";
  return `${location.code} - ${location.name}`;
}

function isFloorLikeLocation(location?: Location): boolean {
  if (!location) return false;
  return /floor|print|wip/i.test(`${location.code} ${location.name} ${location.type}`);
}

function materialLabel(material?: InkMaterial): string {
  if (!material) return "";
  const color = material.color_name ? ` - ${material.color_name}` : "";
  const mix = material.is_mix ? " - Mix" : "";
  return `${material.code}${color}${mix}`;
}

function movementLabel(type: InkFloorMovement["type"] | string): string {
  return String(type || "-").replace(/_/g, " ");
}

function movementTone(type: InkFloorMovement["type"] | string): string {
  const normalized = String(type || "").toUpperCase();
  if (normalized === "ISSUE") return "border-info-border bg-info-bg text-info-fg";
  if (normalized === "RETURN") return "border-success-border bg-success-bg text-success-fg";
  if (normalized === "MIX_RETURN") return "border-warning-border bg-warning-bg text-warning-fg";
  return "border-line bg-surface-2 text-content-3";
}

function varianceTone(value: unknown): string {
  const amount = n(value);
  if (amount > 0) return "text-warning-fg";
  if (amount < 0) return "text-info-fg";
  return "text-success-fg";
}

function formatDateTime(value?: string | null): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "-";
  return parsed.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTime(value?: string | null): string {
  if (!value) return "--:--";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "--:--";
  return parsed.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function shiftLabel(shift?: CurrentShift | null, loading = false): string {
  if (loading) return "Resolving";
  if (!shift?.shift_code) return "No shift";
  return `Shift ${shift.shift_code}`;
}

function shiftWindowLabel(shift?: CurrentShift | null, loading = false): string {
  if (loading) return "Resolving from timestamp";
  if (!shift?.shift_code) return "No matching shift window";
  return `${formatTime(shift.started_at)} - ${formatTime(shift.ends_at)}`;
}

export function InkControlWorkspace() {
  const queryClient = useQueryClient();
  const [tab, setTab] = React.useState<WorkspaceTab>("reconcile");
  const [deskMode, setDeskMode] = React.useState<DeskMode>("issue");
  const [plantId, setPlantId] = React.useState("");
  const [storeLocationId, setStoreLocationId] = React.useState("");
  const [floorLocationId, setFloorLocationId] = React.useState("");
  const [materialId, setMaterialId] = React.useState("");
  const [qtyKg, setQtyKg] = React.useState("");
  const [countDrafts, setCountDrafts] = React.useState<Record<string, string>>({});
  const [countSeedKey, setCountSeedKey] = React.useState("");
  const [countSearch, setCountSearch] = React.useState("");
  const [countScope, setCountScope] = React.useState<CountScope>("location");
  const [eventAt, setEventAt] = React.useState(dtLocal());
  const [startAt, setStartAt] = React.useState(startOfTodayLocal());
  const [endAt, setEndAt] = React.useState(dtLocal());
  const [reference, setReference] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [targetColor, setTargetColor] = React.useState("");
  const [targetBase, setTargetBase] = React.useState<"POLY" | "PET">("POLY");
  const [search, setSearch] = React.useState("");

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initialTab = params.get("tab");
    if (initialTab === "shift-desk" || initialTab === "movements" || initialTab === "counts" || initialTab === "reconcile") {
      setTab(initialTab);
    }
    const initialPlant = params.get("plant");
    const initialStore = params.get("store");
    const initialFloor = params.get("floor");
    const initialStart = params.get("start");
    const initialEnd = params.get("end");
    const initialEventAt = params.get("eventAt");
    const initialScope = params.get("scope");
    if (initialPlant) setPlantId(initialPlant);
    if (initialStore) setStoreLocationId(initialStore);
    if (initialFloor) setFloorLocationId(initialFloor);
    if (initialStart) setStartAt(dateTimeParamToLocalInput(initialStart));
    if (initialEnd) setEndAt(dateTimeParamToLocalInput(initialEnd));
    if (initialEventAt) setEventAt(dateTimeParamToLocalInput(initialEventAt));
    if (initialScope === "plant" || initialScope === "location") setCountScope(initialScope);
  }, []);

  const eventAtIso = isoFromLocal(eventAt);
  const startAtIso = isoFromLocal(startAt);
  const endAtIso = isoFromLocal(endAt);

  const plantsQuery = useQuery({
    queryKey: ["plants"],
    queryFn: inkControlService.getPlants,
  });
  const locationsQuery = useQuery({
    queryKey: ["inventory-locations", plantId],
    queryFn: () => inkControlService.getLocations(plantId),
    enabled: Boolean(plantId),
  });
  const inksQuery = useQuery({
    queryKey: ["master-inks"],
    queryFn: inkControlService.getInks,
  });
  const floorStockQuery = useQuery({
    queryKey: ["ink-floor-stock", plantId, floorLocationId],
    queryFn: () => inkControlService.getFloorStock({ plant: plantId, location: floorLocationId }),
    enabled: Boolean(plantId && floorLocationId),
  });
  const countStockQuery = useQuery({
    queryKey: ["ink-floor-count-stock", plantId, floorLocationId, countScope],
    queryFn: () =>
      inkControlService.getFloorStock({
        plant: plantId,
        location: countScope === "location" ? floorLocationId : undefined,
      }),
    enabled: Boolean(plantId && (countScope === "plant" || floorLocationId)),
  });
  const movementsQuery = useQuery({
    queryKey: ["ink-floor-movements", plantId, floorLocationId, startAt, endAt],
    queryFn: () =>
      inkControlService.getMovements({
        plant: plantId,
        location: floorLocationId,
        start_at: startAtIso,
        end_at: endAtIso,
      }),
    enabled: Boolean(plantId && floorLocationId),
  });
  const sessionsQuery = useQuery({
    queryKey: ["ink-floor-sessions", plantId, floorLocationId, startAt, endAt],
    queryFn: () =>
      inkControlService.getSessions({
        plant: plantId,
        location: countScope === "location" ? floorLocationId : undefined,
        status: "POSTED",
        count_start_at: startAtIso,
        count_end_at: endAtIso,
      }),
    enabled: Boolean(plantId && (countScope === "plant" || floorLocationId)),
  });
  const reconcileQuery = useQuery({
    queryKey: ["ink-floor-reconcile", plantId, floorLocationId, startAt, endAt],
    queryFn: () =>
      inkControlService.reconcile({
        plant: plantId,
        location: floorLocationId,
        start_at: startAtIso,
        end_at: endAtIso,
      }),
    enabled: Boolean(plantId && floorLocationId),
  });
  const eventShiftQuery = useQuery({
    queryKey: ["production-current-shift", eventAtIso],
    queryFn: () => inkControlService.getCurrentShift(eventAtIso),
    enabled: Boolean(eventAtIso),
  });
  const windowShiftQuery = useQuery({
    queryKey: ["production-window-shift", startAtIso],
    queryFn: () => inkControlService.getCurrentShift(startAtIso),
    enabled: Boolean(startAtIso),
  });

  const plants = asArray<any>(plantsQuery.data);
  const locations = asArray<Location>(locationsQuery.data);
  const inks = asArray<InkMaterial>(inksQuery.data).filter(
    (ink) => String(ink.status || "ACTIVE").toUpperCase() === "ACTIVE",
  );
  const floorStock = asArray<FloorBulkStock>(floorStockQuery.data).filter(
    (row) => String(row.material_category || "").toUpperCase() === "INK",
  );
  const countStock = asArray<FloorBulkStock>(countStockQuery.data).filter(
    (row) => String(row.material_category || "").toUpperCase() === "INK",
  );
  const movements = movementsQuery.data || [];
  const sessions = sessionsQuery.data || [];
  const selectedFloorLocation = locations.find((location) => location.id === floorLocationId);
  const floorLikeLocations = locations.filter(isFloorLikeLocation);
  const countLocations =
    countScope === "plant"
      ? floorLikeLocations.length
        ? floorLikeLocations
        : locations
      : selectedFloorLocation
        ? [selectedFloorLocation]
        : [];
  const filteredInks = inks.filter((ink) => {
    const hay = `${ink.code} ${ink.name} ${ink.color_name || ""}`.toLowerCase();
    return hay.includes(search.toLowerCase());
  });
  const countRows = React.useMemo(() => {
    const stockByMaterialLocation = new Map<string, FloorBulkStock>();
    for (const row of countStock) {
      const anyRow = row as any;
      const id = String(anyRow.material || anyRow.material_id || "");
      const locationId = String(anyRow.location || anyRow.location_id || "");
      if (!id || !locationId) continue;
      const key = `${id}:${locationId}`;
      const existing = stockByMaterialLocation.get(key);
      if (existing) {
        (existing as any).qty_kg = n((existing as any).qty_kg) + n(row.qty_kg);
      } else {
        stockByMaterialLocation.set(key, { ...row });
      }
    }
    const inkById = new Map(inks.map((ink) => [String(ink.id), ink]));
    const locationById = new Map(countLocations.map((location) => [String(location.id), location]));
    for (const row of countStock) {
      const locationId = String((row as any).location || (row as any).location_id || "");
      if (locationId && !locationById.has(locationId) && countScope === "location") {
        locationById.set(locationId, {
          id: locationId,
          plant: String((row as any).plant || ""),
          code: "",
          name: row.location_name || "Floor",
          type: "",
        });
      }
    }
    const materialLocationKeys = new Set<string>();
    for (const location of locationById.values()) {
      for (const ink of inks) {
        materialLocationKeys.add(`${ink.id}:${location.id}`);
      }
    }
    for (const key of stockByMaterialLocation.keys()) {
      const [, locationId] = key.split(":");
      if (countScope === "plant" && !locationById.has(locationId)) continue;
      materialLocationKeys.add(key);
    }
    return Array.from(materialLocationKeys)
      .map((key) => {
        const [id, locationId] = key.split(":");
        const ink = inkById.get(id);
        const stock = stockByMaterialLocation.get(key);
        const location = locationById.get(locationId);
        const code = ink?.code || stock?.material_code || id.slice(0, 8);
        const name = ink?.name || stock?.material_name || code;
        const color = ink?.color_name || "";
        const locationName = location?.name || stock?.location_name || "Floor";
        const locationCode = location?.code || "";
        const searchText = `${code} ${name} ${color} ${locationCode} ${locationName}`.toLowerCase();
        return {
          row_id: key,
          material_id: id,
          location_id: locationId,
          location_code: locationCode,
          location_name: locationName,
          material: ink,
          code,
          name,
          color,
          base_type: ink?.base_type || "",
          system_qty_kg: n(stock?.qty_kg),
          searchText,
        };
      })
      .sort((a, b) => `${a.location_name}-${a.code}`.localeCompare(`${b.location_name}-${b.code}`));
  }, [countLocations, countScope, countStock, inks]);
  const visibleCountRows = countRows.filter((row) =>
    row.searchText.includes(countSearch.toLowerCase()),
  );

  React.useEffect(() => {
    const seedKey = `${countScope}:${plantId}:${floorLocationId}:${countRows.length}:${fmt(
      countRows.reduce((sum, row) => sum + row.system_qty_kg, 0),
    )}`;
    if (!seedKey || seedKey === ":" || countSeedKey === seedKey || !countRows.length) return;
    setCountDrafts(
      Object.fromEntries(
        countRows.map((row) => [row.row_id, String(row.system_qty_kg || 0)]),
      ),
    );
    setCountSeedKey(seedKey);
  }, [countRows, countScope, countSeedKey, floorLocationId, plantId]);

  React.useEffect(() => {
    if (!plantId && plants.length) setPlantId(plants[0].id);
  }, [plantId, plants]);

  React.useEffect(() => {
    if (!locations.length) return;
    if (!storeLocationId) {
      const store =
        locations.find((loc) => String(loc.type).toUpperCase() === "RM") ||
        locations[0];
      setStoreLocationId(store.id);
    }
    if (!floorLocationId) {
      const floor =
        locations.find((loc) => /floor|print|wip/i.test(`${loc.code} ${loc.name} ${loc.type}`)) ||
        locations[0];
      setFloorLocationId(floor.id);
    }
  }, [floorLocationId, locations, storeLocationId]);

  React.useEffect(() => {
    if (!materialId && filteredInks.length) {
      setMaterialId(filteredInks[0].id);
      setTargetBase(filteredInks[0].base_type === "PET" ? "PET" : "POLY");
    }
  }, [filteredInks, materialId]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["ink-floor-stock"] });
    queryClient.invalidateQueries({ queryKey: ["ink-floor-movements"] });
    queryClient.invalidateQueries({ queryKey: ["ink-floor-sessions"] });
    queryClient.invalidateQueries({ queryKey: ["ink-floor-reconcile"] });
    queryClient.invalidateQueries({ queryKey: ["inventory-bulk"] });
  };

  const commonPayload = () => ({
    material_id: materialId,
    qty_kg: qtyKg,
    event_at: eventAtIso,
    reference,
    notes,
  });

  const issueMutation = useMutation({
    mutationFn: () =>
      inkControlService.issue({
        ...commonPayload(),
        from_location_id: storeLocationId,
        floor_location_id: floorLocationId,
      }),
    onSuccess: () => {
      toast.success("Ink issued to production floor.");
      setQtyKg("");
      invalidate();
    },
    onError: (error) => toast.error(describeApiError(error)),
  });

  const returnMutation = useMutation({
    mutationFn: () =>
      inkControlService.returnInk({
        ...commonPayload(),
        floor_location_id: floorLocationId,
        to_location_id: storeLocationId,
      }),
    onSuccess: () => {
      toast.success("Ink returned to store.");
      setQtyKg("");
      invalidate();
    },
    onError: (error) => toast.error(describeApiError(error)),
  });

  const mixMutation = useMutation({
    mutationFn: () =>
      inkControlService.mixReturn({
        source_material_id: materialId,
        qty_kg: qtyKg,
        floor_location_id: floorLocationId,
        to_location_id: storeLocationId,
        target_base_type: targetBase,
        target_color_name: targetColor,
        event_at: eventAtIso,
        reference,
        notes,
      }),
    onSuccess: () => {
      toast.success("Mix ink returned and added to ink master.");
      setQtyKg("");
      setTargetColor("");
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["master-inks"] });
    },
    onError: (error) => toast.error(describeApiError(error)),
  });

  const countLines = countRows
    .map((row) => ({
      row_id: row.row_id,
      location_id: row.location_id,
      location_name: row.location_name,
      material_id: row.material_id,
      counted_qty_kg: countDrafts[row.row_id] ?? "",
    }))
    .filter((row) => row.counted_qty_kg !== "" && Number.isFinite(Number(row.counted_qty_kg)));
  const countSystemKg = countRows.reduce((sum, row) => sum + row.system_qty_kg, 0);
  const countCountedKg = countRows.reduce((sum, row) => sum + n(countDrafts[row.row_id]), 0);
  const countVarianceKg = countCountedKg - countSystemKg;
  const countSessionCount = new Set(countLines.map((line) => line.location_id)).size;

  const countMutation = useMutation({
    mutationFn: async () => {
      const grouped = new Map<
        string,
        Array<{ material_id: string; counted_qty_kg: number | string }>
      >();
      for (const line of countLines) {
        const bucket = grouped.get(line.location_id) || [];
        bucket.push({
          material_id: line.material_id,
          counted_qty_kg: line.counted_qty_kg,
        });
        grouped.set(line.location_id, bucket);
      }
      const results = [];
      for (const [locationId, lines] of grouped.entries()) {
        const location = locations.find((row) => row.id === locationId);
        results.push(
          await inkControlService.postCount({
            plant_id: plantId,
            location_id: locationId,
            counted_at: eventAtIso,
            reference:
              countScope === "plant"
                ? `${reference || "Plant ink count"} / ${location?.code || location?.name || "floor"}`
                : reference,
            notes:
              countScope === "plant"
                ? `${notes || ""}${notes ? "\n" : ""}Plant-scope count fan-out. Physical location: ${locationLabel(location)}`
                : notes,
            lines,
          }),
        );
      }
      return results;
    },
    onSuccess: () => {
      toast.success(
        `Ink count posted: ${countLines.length} lines across ${countSessionCount || 0} location${
          countSessionCount === 1 ? "" : "s"
        }.`,
      );
      setCountSeedKey("");
      invalidate();
    },
    onError: (error) => toast.error(describeApiError(error)),
  });

  const selectedMaterial = inks.find((ink) => ink.id === materialId);
  const selectedStock = floorStock.find((row) => {
    const anyRow = row as any;
    return anyRow.material === materialId || anyRow.material_id === materialId;
  });
  const canPost = Boolean(plantId && floorLocationId && materialId);
  const floorStockKg = floorStock.reduce((sum, row) => sum + n(row.qty_kg), 0);
  const issuedKg = movements
    .filter((row) => row.type === "ISSUE")
    .reduce((sum, row) => sum + n(row.qty_kg), 0);
  const returnedKg = movements
    .filter((row) => row.type === "RETURN" || row.type === "MIX_RETURN")
    .reduce((sum, row) => sum + n(row.qty_kg), 0);
  const reconciliation = reconcileQuery.data;
  const eventShift = eventShiftQuery.data;
  const windowShift = windowShiftQuery.data;
  const lifecycleDate = localDateOnly(windowShift?.started_at, startAt);
  const countLineTotal = sessions.reduce(
    (sum, session) => sum + (session.count_lines?.length || 0),
    0,
  );
  const busy =
    issueMutation.isPending ||
    returnMutation.isPending ||
    mixMutation.isPending ||
    countMutation.isPending;

  const openStockLifecycle = () => {
    window.location.assign(`/inventory/stock-lifecycle?tab=snapshots&inkDate=${lifecycleDate}`);
  };

  const refreshAll = () => {
    invalidate();
    reconcileQuery.refetch();
    movementsQuery.refetch();
    sessionsQuery.refetch();
    toast.success("Ink control data refreshed.");
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-surface-3 via-surface-2 to-surface-2 px-4 py-4 sm:px-6">
      <div className="mx-auto flex max-w-[1540px] flex-col gap-4">
        <section className="overflow-hidden rounded-lg border border-info-border bg-gradient-to-br from-primary via-info-fg to-success-fg px-4 py-4 text-white shadow-xl">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-white/70">
                <span>Production</span>
                <span>/</span>
                <span className="text-white">Ink Control</span>
                <Badge variant="outline" className="ml-1 rounded-md border-white/30 bg-white/10 text-white">
                  Floor stock model
                </Badge>
              </div>
              <div className="mt-2 flex flex-col gap-2 lg:flex-row lg:items-end">
                <div>
                  <h1 className="text-2xl font-semibold text-white">
                    Ink Control Desk
                  </h1>
                  <p className="mt-1 max-w-3xl text-sm font-medium text-white/78">
                    Issue ink to exact floor locations, count physical ink by timestamp, and reconcile actual floor consumption against artwork GSM theory.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2 lg:ml-4">
                  <Badge variant="outline" className="border-white/30 bg-white/10 text-white">No execution gate</Badge>
                  <Badge variant="outline" className="border-white/30 bg-white/10 text-white">Theory from artwork GSM</Badge>
                  <Badge variant="outline" className="border-white/30 bg-white/10 text-white">Actual from floor count</Badge>
                </div>
              </div>
            </div>

            <div className="grid gap-2 rounded-lg border border-white/15 bg-white/95 p-3 text-content-1 shadow-lg sm:grid-cols-2 xl:w-[820px] xl:grid-cols-[1fr_1fr_1fr_170px]">
              <FilterSelect
                label="Plant"
                value={plantId}
                placeholder="Select plant"
                onValueChange={(value) => {
                  setPlantId(value);
                  setStoreLocationId("");
                  setFloorLocationId("");
                }}
                options={plants.map((plant) => ({
                  value: plant.id,
                  label: `${plant.code} - ${plant.name}`,
                }))}
              />
              <FilterSelect
                label="Store"
                value={storeLocationId}
                placeholder="Store location"
                onValueChange={setStoreLocationId}
                options={locations.map((location) => ({
                  value: location.id,
                  label: locationLabel(location),
                }))}
              />
              <FilterSelect
                label="Floor"
                value={floorLocationId}
                placeholder="Floor location"
                onValueChange={setFloorLocationId}
                options={locations.map((location) => ({
                  value: location.id,
                  label: locationLabel(location),
                }))}
              />
              <ShiftBadge
                label="Entry shift"
                shift={eventShift}
                loading={eventShiftQuery.isFetching}
              />
            </div>
          </div>
        </section>

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Metric
            label="Floor stock"
            value={`${fmt(floorStockKg)} kg`}
            detail={`${floorStock.length} ink lots on floor`}
            icon={PackageCheck}
          />
          <Metric
            label="Issued in window"
            value={`${fmt(issuedKg)} kg`}
            detail={`${movements.filter((row) => row.type === "ISSUE").length} issue movements`}
            icon={ArrowDownToLine}
            tone="info"
          />
          <Metric
            label="Actual consumed"
            value={`${fmt(reconciliation?.totals.actual_consumed_kg)} kg`}
            detail={`Theory ${fmt(reconciliation?.totals.theory_ink_kg)} kg`}
            icon={Scale}
          />
          <Metric
            label="Variance"
            value={`${fmt(reconciliation?.totals.variance_kg)} kg`}
            detail={
              reconciliation?.totals.variance_pct == null
                ? "No theory baseline"
                : `${fmt(reconciliation.totals.variance_pct, 2)}% vs theory`
            }
            icon={Activity}
            tone={n(reconciliation?.totals.variance_kg) > 0 ? "warn" : "ok"}
          />
        </section>

        <Tabs value={tab} onValueChange={(value) => setTab(value as WorkspaceTab)}>
          <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface-1/95 p-2 shadow-sm lg:flex-row lg:items-center lg:justify-between">
            <TabsList className="grid h-auto w-full grid-cols-2 gap-1 bg-surface-2 p-1 lg:w-[680px] lg:grid-cols-4">
              {(Object.keys(tabLabels) as WorkspaceTab[]).map((key) => (
                <TabsTrigger
                  key={key}
                  value={key}
                  className="h-10 rounded-md text-sm font-semibold data-[state=active]:bg-white data-[state=active]:shadow-sm"
                >
                  {tabLabels[key]}
                </TabsTrigger>
              ))}
            </TabsList>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end lg:justify-end">
              <div className="rounded-md border border-line bg-surface-2 px-3 py-2">
                <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase text-content-3">
                  <Clock className="h-3.5 w-3.5" />
                  Analysis from
                </div>
                <Input
                  type="datetime-local"
                  value={startAt}
                  onChange={(event) => setStartAt(event.target.value)}
                  className="h-9 border-line bg-surface-1 font-mono text-xs sm:w-[205px]"
                />
              </div>
              <div className="rounded-md border border-line bg-surface-2 px-3 py-2">
                <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase text-content-3">
                  <Clock className="h-3.5 w-3.5" />
                  Analysis to
                </div>
                <Input
                  type="datetime-local"
                  value={endAt}
                  onChange={(event) => setEndAt(event.target.value)}
                  className="h-9 border-line bg-surface-1 font-mono text-xs sm:w-[205px]"
                />
              </div>
              <Button variant="outline" className="h-10" onClick={refreshAll}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Refresh
              </Button>
            </div>
          </div>

          <TabsContent value="reconcile" className="mt-4">
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
              <Panel
                title="Theory vs actual allocation"
                action={
                  <Button variant="outline" onClick={openStockLifecycle}>
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Stock Lifecycle proof
                  </Button>
                }
              >
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Order / Job</TableHead>
                      <TableHead>Artwork theory</TableHead>
                      <TableHead className="text-right">Theory kg</TableHead>
                      <TableHead className="text-right">Actual kg</TableHead>
                      <TableHead className="text-right">Variance</TableHead>
                      <TableHead className="text-right">Variance %</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(reconciliation?.allocations || []).map((row, index) => (
                      <TableRow key={`${row.job_number}-${index}`}>
                        <TableCell>
                          <div className="font-semibold text-content-1">{row.job_number || "-"}</div>
                          <div className="text-xs text-content-3">{row.sales_order || "-"}</div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="rounded-md">
                            Artwork GSM
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono">{fmt(row.theory_ink_kg)}</TableCell>
                        <TableCell className="text-right font-mono">{fmt(row.actual_allocated_kg)}</TableCell>
                        <TableCell className={cn("text-right font-mono font-semibold", varianceTone(row.variance_kg))}>
                          {fmt(row.variance_kg)}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {row.variance_pct == null ? "-" : `${fmt(row.variance_pct, 2)}%`}
                        </TableCell>
                      </TableRow>
                    ))}
                    {!reconciliation?.allocations?.length ? (
                      <EmptyRow
                        colSpan={6}
                        label={
                          reconcileQuery.isLoading
                            ? "Loading reconciliation window..."
                            : "No job allocation rows in this window"
                        }
                      />
                    ) : null}
                  </TableBody>
                </Table>
              </Panel>

              <aside className="rounded-lg border border-line bg-surface-1 shadow-sm">
                <div className="border-b border-line px-4 py-3">
                  <div className="text-sm font-semibold text-content-1">Reconciliation window</div>
                  <div className="mt-1 text-xs text-content-3">
                    {formatDateTime(startAtIso)} - {formatDateTime(endAtIso)}
                  </div>
                  <div className="mt-2">
                    <Badge variant="outline" className="rounded-md">
                      {shiftLabel(windowShift, windowShiftQuery.isFetching)} · {shiftWindowLabel(windowShift, windowShiftQuery.isFetching)}
                    </Badge>
                  </div>
                </div>
                <div className="space-y-1 p-3">
                  <WindowLine label="Opening count" value={`${fmt(reconciliation?.totals.opening_kg)} kg`} />
                  <WindowLine label="Issues" value={`${fmt(reconciliation?.totals.issued_kg)} kg`} />
                  <WindowLine label="Returns" value={`${fmt(reconciliation?.totals.returned_kg)} kg`} />
                  <WindowLine label="Closing count" value={`${fmt(reconciliation?.totals.closing_kg)} kg`} />
                  <WindowLine label="Actual consumed" value={`${fmt(reconciliation?.totals.actual_consumed_kg)} kg`} strong />
                  <WindowLine label="Theory" value={`${fmt(reconciliation?.totals.theory_ink_kg)} kg`} />
                  <WindowLine
                    label="Variance"
                    value={`${fmt(reconciliation?.totals.variance_kg)} kg`}
                    valueClassName={varianceTone(reconciliation?.totals.variance_kg)}
                  />
                </div>
                <div className="border-t border-line p-3">
                  <Button className="w-full" onClick={refreshAll}>
                    <ListChecks className="mr-2 h-4 w-4" />
                    Refresh reconciliation
                  </Button>
                  <Button variant="outline" className="mt-2 w-full" onClick={() => setTab("counts")}>
                    Review posted counts
                  </Button>
                </div>
              </aside>
            </div>

            <section className="mt-4 rounded-lg border border-line bg-surface-1 p-4 shadow-sm">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="text-sm font-semibold text-content-1">Stock Lifecycle continuity</div>
                  <div className="mt-1 text-sm text-content-3">
                    Posted ink counts and movement audit rows are available in the inventory close cockpit for the same date.
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">{sessions.length} posted counts</Badge>
                  <Badge variant="outline">{countLineTotal} count lines</Badge>
                  <Badge variant="outline">{fmt(returnedKg)} kg returned</Badge>
                  <Button variant="outline" onClick={openStockLifecycle}>
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Open Stock Lifecycle
                  </Button>
                </div>
              </div>
            </section>
          </TabsContent>

          <TabsContent value="shift-desk" className="mt-4">
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
              <Panel title="Production floor movement ticket">
                <div className="mb-4 grid gap-2 sm:grid-cols-4">
                  {deskModes.map((mode) => {
                    const Icon = mode.icon;
                    return (
                      <button
                        key={mode.key}
                        type="button"
                        onClick={() => setDeskMode(mode.key)}
                        className={cn(
                          "flex h-11 items-center justify-center gap-2 rounded-md border px-3 text-sm font-semibold transition",
                          deskMode === mode.key
                            ? "border-info-border bg-info-bg text-info-fg"
                            : "border-line bg-surface-2 text-content-3 hover:bg-surface-3",
                        )}
                      >
                        <Icon className="h-4 w-4" />
                        {mode.label}
                      </button>
                    );
                  })}
                </div>

                <div className="grid gap-3 lg:grid-cols-[minmax(260px,1.35fr)_repeat(3,minmax(150px,1fr))]">
                  <Field label="Ink">
                    <MaterialPicker
                      inks={filteredInks}
                      materialId={materialId}
                      setMaterialId={setMaterialId}
                      search={search}
                      setSearch={setSearch}
                    />
                  </Field>
                  <Field label="Quantity kg">
                    <Input
                      type="number"
                      min="0"
                      step="0.001"
                      value={qtyKg}
                      onChange={(event) => setQtyKg(event.target.value)}
                    />
                  </Field>
                  <Field label="Event time">
                    <Input
                      type="datetime-local"
                      value={eventAt}
                      onChange={(event) => setEventAt(event.target.value)}
                    />
                  </Field>
                  <Field label="Reference">
                    <Input value={reference} onChange={(event) => setReference(event.target.value)} />
                  </Field>
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-[190px_1fr]">
                  <ShiftBadge
                    label="Auto shift"
                    shift={eventShift}
                    loading={eventShiftQuery.isFetching}
                  />
                  <div className="rounded-md border border-line bg-surface-2 px-3 py-2">
                    <div className="text-xs font-semibold text-content-3">Shift window</div>
                    <div className="mt-1 text-sm font-semibold text-content-1">
                      {shiftWindowLabel(eventShift, eventShiftQuery.isFetching)}
                    </div>
                  </div>
                </div>

                {deskMode === "mix" ? (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Field label="Returned mix base">
                      <Select value={targetBase} onValueChange={(value) => setTargetBase(value as "POLY" | "PET")}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="POLY">POLY</SelectItem>
                          <SelectItem value="PET">PET</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Returned mix color">
                      <Input
                        value={targetColor}
                        onChange={(event) => setTargetColor(event.target.value.toUpperCase())}
                        placeholder="Returned mix color"
                      />
                    </Field>
                  </div>
                ) : null}

                <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_auto]">
                  <Textarea
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    className="min-h-20"
                    placeholder="Notes"
                  />
                  <div className="flex items-end justify-end">
                    <DeskAction
                      mode={deskMode}
                      canPost={canPost}
                      qtyKg={qtyKg}
                      targetColor={targetColor}
                      busy={busy}
                      onIssue={() => issueMutation.mutate()}
                      onReturn={() => returnMutation.mutate()}
                      onMix={() => mixMutation.mutate()}
                    />
                  </div>
                </div>
              </Panel>

              <aside className="rounded-lg border border-line bg-surface-1 shadow-sm">
                <div className="border-b border-line px-4 py-3">
                  <div className="text-sm font-semibold text-content-1">Selected ink</div>
                  <div className="mt-1 truncate text-xs text-content-3">
                    {materialLabel(selectedMaterial) || "Select an ink"}
                  </div>
                </div>
                <div className="space-y-1 p-3">
                  <WindowLine label="Floor qty" value={`${fmt(selectedStock?.qty_kg)} kg`} strong />
                  <WindowLine label="Base" value={selectedMaterial?.base_type || "-"} />
                  <WindowLine label="Mix" value={selectedMaterial?.is_mix ? "Yes" : "No"} />
                  <WindowLine label="Store" value={locations.find((loc) => loc.id === storeLocationId)?.code || "-"} />
                  <WindowLine label="Floor" value={locations.find((loc) => loc.id === floorLocationId)?.code || "-"} />
                </div>
              </aside>
            </div>
          </TabsContent>

          <TabsContent value="movements" className="mt-4">
            <Panel title="Recent floor movements">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Ink</TableHead>
                    <TableHead>Path</TableHead>
                    <TableHead>Shift</TableHead>
                    <TableHead>Reference</TableHead>
                    <TableHead className="text-right">Kg</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {movements.slice(0, 80).map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="text-xs text-content-3">{formatDateTime(row.event_at)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn("rounded-md", movementTone(row.type))}>
                          {movementLabel(row.type)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="font-semibold text-content-1">{row.material_code}</div>
                        <div className="text-xs text-content-3">{row.target_material_code || row.material_name}</div>
                      </TableCell>
                      <TableCell className="text-xs text-content-3">
                        {row.source_location_name || "-"} <ArrowRightLeft className="mx-1 inline h-3 w-3" /> {row.destination_location_name || "-"}
                      </TableCell>
                      <TableCell>{row.shift_code || "-"}</TableCell>
                      <TableCell className="max-w-[220px] truncate text-xs text-content-3">{row.reference || "-"}</TableCell>
                      <TableCell className="text-right font-mono">{fmt(row.qty_kg)}</TableCell>
                    </TableRow>
                  ))}
                  {!movements.length ? (
                    <EmptyRow
                      colSpan={7}
                      label={movementsQuery.isLoading ? "Loading movements..." : "No ink movements in this window"}
                    />
                  ) : null}
                </TableBody>
              </Table>
            </Panel>
          </TabsContent>

          <TabsContent value="counts" className="mt-4">
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
              <Panel
                title="Ink stock count snapshot"
                action={
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <Badge variant="outline" className="rounded-md">
                      {countLines.length} lines ready
                    </Badge>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setCountDrafts(
                          Object.fromEntries(
                            countRows.map((row) => [row.row_id, String(row.system_qty_kg || 0)]),
                          ),
                        );
                      }}
                    >
                      Reset to system
                    </Button>
                    <Button
                      disabled={!plantId || !countLines.length || countMutation.isPending}
                      onClick={() => countMutation.mutate()}
                    >
                      <ClipboardCheck className="mr-2 h-4 w-4" />
                      Post count
                    </Button>
                  </div>
                }
              >
                <div className="grid gap-3 border-b border-line bg-surface-2/70 p-4 lg:grid-cols-[210px_230px_180px_1fr]">
                  <Field label="Physical count time">
                    <Input
                      type="datetime-local"
                      value={eventAt}
                      onChange={(event) => setEventAt(event.target.value)}
                    />
                  </Field>
                  <Field label="Count scope">
                    <Select value={countScope} onValueChange={(value) => setCountScope(value as CountScope)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="location">Selected floor location</SelectItem>
                        <SelectItem value="plant">All floor locations in plant</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <ShiftBadge
                    label="Auto shift"
                    shift={eventShift}
                    loading={eventShiftQuery.isFetching}
                  />
                  <Field label="Reference">
                    <Input value={reference} onChange={(event) => setReference(event.target.value)} />
                  </Field>
                  <div className="lg:col-span-4">
                    <Field label="Notes">
                      <Textarea
                        value={notes}
                        onChange={(event) => setNotes(event.target.value)}
                        className="min-h-16"
                        placeholder="Count notes"
                      />
                    </Field>
                  </div>
                </div>
                <div className="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <div className="text-sm font-semibold text-content-1">Count every visible floor stock line</div>
                    <div className="mt-1 text-xs text-content-3">
                      All active ink masters are listed, including zero-stock masters. Location scope posts one session; plant scope posts one session per floor location at the same physical count time.
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge variant="outline" className="rounded-md">
                        <MapPin className="mr-1 h-3.5 w-3.5" />
                        {countScope === "plant"
                          ? `${countLocations.length} floor location${countLocations.length === 1 ? "" : "s"}`
                          : locations.find((row) => row.id === floorLocationId)?.name || "Selected floor"}
                      </Badge>
                      <Badge variant="outline" className="rounded-md">
                        {countRows.length} material-location lines
                      </Badge>
                    </div>
                  </div>
                  <div className="relative w-full lg:w-[320px]">
                    <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-content-3" />
                    <Input
                      value={countSearch}
                      onChange={(event) => setCountSearch(event.target.value)}
                      className="pl-9"
                      placeholder="Search count lines"
                    />
                  </div>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ink master</TableHead>
                      {countScope === "plant" ? <TableHead>Floor location</TableHead> : null}
                      <TableHead>Base</TableHead>
                      <TableHead className="text-right">System kg</TableHead>
                      <TableHead className="w-[180px] text-right">Counted kg</TableHead>
                      <TableHead className="text-right">Variance kg</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleCountRows.map((row) => {
                      const counted = countDrafts[row.row_id] ?? "";
                      const variance = n(counted) - row.system_qty_kg;
                      return (
                        <TableRow key={row.row_id}>
                          <TableCell>
                            <div className="font-semibold text-content-1">{row.code}</div>
                            <div className="text-xs text-content-3">{row.color || row.name}</div>
                          </TableCell>
                          {countScope === "plant" ? (
                            <TableCell>
                              <div className="font-semibold text-content-1">{row.location_code || "-"}</div>
                              <div className="text-xs text-content-3">{row.location_name}</div>
                            </TableCell>
                          ) : null}
                          <TableCell>{row.base_type || "-"}</TableCell>
                          <TableCell className="text-right font-mono">{fmt(row.system_qty_kg)}</TableCell>
                          <TableCell className="text-right">
                            <Input
                              type="number"
                              min="0"
                              step="0.001"
                              value={counted}
                              onChange={(event) =>
                                setCountDrafts((current) => ({
                                  ...current,
                                  [row.row_id]: event.target.value,
                                }))
                              }
                              className="ml-auto h-9 w-[150px] text-right font-mono"
                            />
                          </TableCell>
                          <TableCell className={cn("text-right font-mono font-semibold", varianceTone(variance))}>
                            {fmt(variance)}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {!visibleCountRows.length ? (
                      <EmptyRow
                        colSpan={countScope === "plant" ? 6 : 5}
                        label={inksQuery.isLoading || countStockQuery.isLoading ? "Loading count lines..." : "No ink masters match this search"}
                      />
                    ) : null}
                  </TableBody>
                </Table>
              </Panel>

              <aside className="rounded-lg border border-line bg-surface-1 shadow-sm">
                <div className="border-b border-line px-4 py-3">
                  <div className="text-sm font-semibold text-content-1">Count summary</div>
                  <div className="mt-1 text-xs text-content-3">
                    {formatDateTime(eventAtIso)} · {shiftLabel(eventShift, eventShiftQuery.isFetching)}
                  </div>
                </div>
                <div className="space-y-1 p-3">
                  <WindowLine
                    label="Scope"
                    value={countScope === "plant" ? "Plant floor total" : "Selected floor"}
                  />
                  <WindowLine
                    label="Count sessions"
                    value={String(countSessionCount || 0)}
                  />
                  <WindowLine label="System floor kg" value={`${fmt(countSystemKg)} kg`} />
                  <WindowLine label="Counted floor kg" value={`${fmt(countCountedKg)} kg`} strong />
                  <WindowLine
                    label="Adjustment"
                    value={`${fmt(countVarianceKg)} kg`}
                    valueClassName={varianceTone(countVarianceKg)}
                  />
                  <WindowLine label="Ink masters" value={String(countRows.length)} />
                  <WindowLine label="Posted lines" value={String(countLines.length)} />
                </div>
                <div className="border-t border-line p-3">
                  <Button
                    className="w-full"
                    disabled={!plantId || !countLines.length || countMutation.isPending}
                    onClick={() => countMutation.mutate()}
                  >
                    <ClipboardCheck className="mr-2 h-4 w-4" />
                    Post stock count
                  </Button>
                  <Button variant="outline" className="mt-2 w-full" onClick={openStockLifecycle}>
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Stock Lifecycle posted list
                  </Button>
                </div>

                <div className="border-t border-line px-4 py-3">
                  <div className="text-sm font-semibold text-content-1">Recent posted counts</div>
                </div>
                <div className="max-h-[420px] overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Reference</TableHead>
                        <TableHead>Counted at</TableHead>
                        <TableHead className="text-right">Lines</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sessions.map((session) => (
                        <CountMiniRow
                          key={session.id}
                          session={session}
                          onOpenStockLifecycle={openStockLifecycle}
                        />
                      ))}
                      {!sessions.length ? (
                        <EmptyRow
                          colSpan={3}
                          label={sessionsQuery.isLoading ? "Loading posted counts..." : "No posted counts in this window"}
                        />
                      ) : null}
                    </TableBody>
                  </Table>
                </div>
              </aside>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  placeholder,
  options,
  onValueChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  options: Array<{ value: string; label: string }>;
  onValueChange: (value: string) => void;
}) {
  return (
    <Field label={label}>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger className="h-10">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

function Metric({
  label,
  value,
  detail,
  icon: Icon,
  tone = "plain",
}: {
  label: string;
  value: string;
  detail: string;
  icon: React.ElementType;
  tone?: "plain" | "info" | "warn" | "ok";
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-4 shadow-sm",
        tone === "info"
          ? "border-info-border bg-info-bg"
          : tone === "warn"
            ? "border-warning-border bg-warning-bg"
            : tone === "ok"
              ? "border-success-border bg-success-bg"
              : "border-line bg-surface-1/90",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase text-content-3">{label}</div>
          <div
            className={cn(
              "mt-2 text-2xl font-semibold text-content-1",
              tone === "warn" && "text-warning-fg",
              tone === "ok" && "text-success-fg",
              tone === "info" && "text-info-fg",
            )}
          >
            {value}
          </div>
        </div>
        <div className="rounded-md border border-line bg-surface-2 p-2 text-content-3">
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <div className="mt-2 text-xs text-content-3">{detail}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-semibold text-content-3">{label}</Label>
      {children}
    </div>
  );
}

function ShiftBadge({
  label,
  shift,
  loading,
}: {
  label: string;
  shift?: CurrentShift | null;
  loading?: boolean;
}) {
  return (
    <div className="rounded-md border border-line bg-surface-2 px-3 py-2">
      <div className="text-xs font-semibold text-content-3">{label}</div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-content-1">{shiftLabel(shift, loading)}</span>
        <Badge variant="outline" className="rounded-md text-[11px]">
          Auto
        </Badge>
      </div>
    </div>
  );
}

function MaterialPicker({
  inks,
  materialId,
  setMaterialId,
  search,
  setSearch,
}: {
  inks: InkMaterial[];
  materialId: string;
  setMaterialId: (value: string) => void;
  search: string;
  setSearch: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-content-3" />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="pl-9"
          placeholder="Search ink"
        />
      </div>
      <Select value={materialId} onValueChange={setMaterialId}>
        <SelectTrigger>
          <SelectValue placeholder="Select ink" />
        </SelectTrigger>
        <SelectContent>
          {inks.map((ink) => (
            <SelectItem key={ink.id} value={ink.id}>
              {materialLabel(ink)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function DeskAction({
  mode,
  canPost,
  qtyKg,
  targetColor,
  busy,
  onIssue,
  onReturn,
  onMix,
}: {
  mode: DeskMode;
  canPost: boolean;
  qtyKg: string;
  targetColor: string;
  busy: boolean;
  onIssue: () => void;
  onReturn: () => void;
  onMix: () => void;
}) {
  if (mode === "return") {
    return (
      <Button disabled={!canPost || !qtyKg || busy} onClick={onReturn}>
        <ArrowUpFromLine className="mr-2 h-4 w-4" />
        Return ink
      </Button>
    );
  }
  if (mode === "mix") {
    return (
      <Button disabled={!canPost || !qtyKg || !targetColor || busy} onClick={onMix}>
        <Blend className="mr-2 h-4 w-4" />
        Return as mix
      </Button>
    );
  }
  return (
    <Button disabled={!canPost || !qtyKg || busy} onClick={onIssue}>
      <ArrowDownToLine className="mr-2 h-4 w-4" />
      Issue ink
    </Button>
  );
}

function Panel({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-line bg-surface-1 shadow-sm">
      <div className="flex min-h-14 items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="text-sm font-semibold text-content-1">{title}</div>
        {action}
      </div>
      <div className="overflow-x-auto">{children}</div>
    </section>
  );
}

function EmptyRow({ colSpan, label }: { colSpan: number; label: string }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="h-20 text-center text-sm text-content-3">
        {label}
      </TableCell>
    </TableRow>
  );
}

function WindowLine({
  label,
  value,
  strong,
  valueClassName,
}: {
  label: string;
  value: string;
  strong?: boolean;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-md px-2 py-2 hover:bg-surface-2">
      <span className="text-sm text-content-3">{label}</span>
      <span
        className={cn(
          "text-right font-mono text-sm text-content-1",
          strong && "font-semibold",
          valueClassName,
        )}
      >
        {value}
      </span>
    </div>
  );
}

function CountMiniRow({
  session,
  onOpenStockLifecycle,
}: {
  session: InkFloorSession;
  onOpenStockLifecycle: () => void;
}) {
  return (
    <TableRow>
      <TableCell>
        <button
          type="button"
          onClick={onOpenStockLifecycle}
          className="font-mono text-sm font-semibold text-info-fg hover:underline"
        >
          {session.reference || session.id.slice(0, 8)}
        </button>
      </TableCell>
      <TableCell className="text-xs text-content-3">{formatDateTime(session.counted_at)}</TableCell>
      <TableCell className="text-right font-mono">{session.count_lines?.length || 0}</TableCell>
    </TableRow>
  );
}

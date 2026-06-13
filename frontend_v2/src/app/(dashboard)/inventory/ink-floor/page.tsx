"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDownToLine, ArrowUpFromLine, Blend, ClipboardCheck, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { describeApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { factoryService } from "@/services/factory";
import { inkFloorService } from "@/services/ink-floor";
import { inventoryService, type InventoryBulk, type Location } from "@/services/inventory";
import { masterDataService, type Material } from "@/services/master-data";

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

function dtLocal(): string {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function isoFromLocal(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function locationLabel(location?: Location): string {
  if (!location) return "";
  return `${location.code} - ${location.name}`;
}

function materialLabel(material?: Material): string {
  if (!material) return "";
  const color = material.color_name ? ` - ${material.color_name}` : "";
  const mix = material.is_mix ? " - Mix" : "";
  return `${material.code}${color}${mix}`;
}

export default function InkFloorPage() {
  const queryClient = useQueryClient();
  const [plantId, setPlantId] = React.useState("");
  const [storeLocationId, setStoreLocationId] = React.useState("");
  const [floorLocationId, setFloorLocationId] = React.useState("");
  const [materialId, setMaterialId] = React.useState("");
  const [qtyKg, setQtyKg] = React.useState("");
  const [shiftCode, setShiftCode] = React.useState("");
  const [eventAt, setEventAt] = React.useState(dtLocal());
  const [reference, setReference] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [targetColor, setTargetColor] = React.useState("");
  const [targetBase, setTargetBase] = React.useState<"POLY" | "PET">("POLY");
  const [countQty, setCountQty] = React.useState("");
  const [search, setSearch] = React.useState("");
  const [startAt, setStartAt] = React.useState(dtLocal());
  const [endAt, setEndAt] = React.useState(dtLocal());

  const plantsQuery = useQuery({ queryKey: ["plants"], queryFn: factoryService.getPlants });
  const locationsQuery = useQuery({
    queryKey: ["inventory-locations", plantId],
    queryFn: () => inventoryService.getLocations(plantId),
    enabled: Boolean(plantId),
  });
  const inksQuery = useQuery({ queryKey: ["master-inks"], queryFn: masterDataService.getInks });
  const floorStockQuery = useQuery({
    queryKey: ["ink-floor-stock", plantId, floorLocationId],
    queryFn: () => inventoryService.getBulkStock({ plant: plantId, location: floorLocationId }),
    enabled: Boolean(plantId && floorLocationId),
  });
  const movementsQuery = useQuery({
    queryKey: ["ink-floor-movements", plantId, floorLocationId],
    queryFn: () => inkFloorService.getMovements({ plant: plantId, location: floorLocationId }),
    enabled: Boolean(plantId && floorLocationId),
  });
  const sessionsQuery = useQuery({
    queryKey: ["ink-floor-sessions", plantId, floorLocationId],
    queryFn: () => inkFloorService.getSessions({ plant: plantId, location: floorLocationId }),
    enabled: Boolean(plantId && floorLocationId),
  });
  const reconcileQuery = useQuery({
    queryKey: ["ink-floor-reconcile", plantId, floorLocationId, startAt, endAt],
    queryFn: () =>
      inkFloorService.reconcile({
        plant: plantId,
        location: floorLocationId,
        start_at: isoFromLocal(startAt),
        end_at: isoFromLocal(endAt),
      }),
    enabled: Boolean(plantId && floorLocationId),
  });

  const plants = asArray<any>(plantsQuery.data);
  const locations = asArray<Location>(locationsQuery.data);
  const inks = asArray<Material>(inksQuery.data).filter((ink) => String(ink.status || "ACTIVE").toUpperCase() === "ACTIVE");
  const floorStock = asArray<InventoryBulk>(floorStockQuery.data).filter((row) => String(row.material_category || "").toUpperCase() === "INK");
  const movements = movementsQuery.data || [];
  const sessions = sessionsQuery.data || [];
  const filteredInks = inks.filter((ink) => {
    const hay = `${ink.code} ${ink.name} ${ink.color_name || ""}`.toLowerCase();
    return hay.includes(search.toLowerCase());
  });

  React.useEffect(() => {
    if (!plantId && plants.length) setPlantId(plants[0].id);
  }, [plantId, plants]);

  React.useEffect(() => {
    if (!locations.length) return;
    if (!storeLocationId) {
      const store = locations.find((loc) => String(loc.type).toUpperCase() === "RM") || locations[0];
      setStoreLocationId(store.id);
    }
    if (!floorLocationId) {
      const floor =
        locations.find((loc) => /floor|print|wip/i.test(`${loc.code} ${loc.name} ${loc.type}`)) || locations[0];
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
    event_at: isoFromLocal(eventAt),
    shift_code: shiftCode,
    reference,
    notes,
  });

  const issueMutation = useMutation({
    mutationFn: () =>
      inkFloorService.issue({
        ...commonPayload(),
        from_location_id: storeLocationId,
        floor_location_id: floorLocationId,
      }),
    onSuccess: () => {
      toast.success("Ink issued to floor.");
      setQtyKg("");
      invalidate();
    },
    onError: (error) => toast.error(describeApiError(error)),
  });

  const returnMutation = useMutation({
    mutationFn: () =>
      inkFloorService.returnInk({
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
      inkFloorService.mixReturn({
        source_material_id: materialId,
        qty_kg: qtyKg,
        floor_location_id: floorLocationId,
        to_location_id: storeLocationId,
        target_base_type: targetBase,
        target_color_name: targetColor,
        event_at: isoFromLocal(eventAt),
        shift_code: shiftCode,
        reference,
        notes,
      }),
    onSuccess: () => {
      toast.success("Mix ink returned.");
      setQtyKg("");
      setTargetColor("");
      invalidate();
      queryClient.invalidateQueries({ queryKey: ["master-inks"] });
    },
    onError: (error) => toast.error(describeApiError(error)),
  });

  const countMutation = useMutation({
    mutationFn: () =>
      inkFloorService.postCount({
        plant_id: plantId,
        location_id: floorLocationId,
        counted_at: isoFromLocal(eventAt),
        shift_code: shiftCode,
        reference,
        notes,
        lines: [{ material_id: materialId, counted_qty_kg: countQty }],
      }),
    onSuccess: () => {
      toast.success("Ink count posted.");
      setCountQty("");
      invalidate();
    },
    onError: (error) => toast.error(describeApiError(error)),
  });

  const selectedMaterial = inks.find((ink) => ink.id === materialId);
  const selectedStock = floorStock.find((row) => row.material === materialId);
  const canPost = Boolean(plantId && floorLocationId && materialId);

  return (
    <div className="min-h-screen bg-surface-2 px-4 py-4 sm:px-6">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-4">
        <div className="flex flex-col gap-3 border-b border-line pb-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal text-content-1">Ink Floor</h1>
            <div className="mt-1 flex flex-wrap gap-2 text-xs text-content-3">
              <Badge variant="outline">Floor stock</Badge>
              <Badge variant="outline">Theory vs actual</Badge>
              <Badge variant="outline">Open issue/return</Badge>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-3 lg:w-[760px]">
            <Select value={plantId} onValueChange={(value) => {
              setPlantId(value);
              setStoreLocationId("");
              setFloorLocationId("");
            }}>
              <SelectTrigger>
                <SelectValue placeholder="Plant" />
              </SelectTrigger>
              <SelectContent>
                {plants.map((plant) => (
                  <SelectItem key={plant.id} value={plant.id}>
                    {plant.code} - {plant.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={storeLocationId} onValueChange={setStoreLocationId}>
              <SelectTrigger>
                <SelectValue placeholder="Store location" />
              </SelectTrigger>
              <SelectContent>
                {locations.map((location) => (
                  <SelectItem key={location.id} value={location.id}>
                    {locationLabel(location)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={floorLocationId} onValueChange={setFloorLocationId}>
              <SelectTrigger>
                <SelectValue placeholder="Floor location" />
              </SelectTrigger>
              <SelectContent>
                {locations.map((location) => (
                  <SelectItem key={location.id} value={location.id}>
                    {locationLabel(location)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <Metric label="Floor stock" value={`${fmt(floorStock.reduce((sum, row) => sum + n(row.qty_kg), 0))} kg`} />
          <Metric label="Actual consumed" value={`${fmt(reconcileQuery.data?.totals.actual_consumed_kg)} kg`} tone="dark" />
          <Metric label="Theory" value={`${fmt(reconcileQuery.data?.totals.theory_ink_kg)} kg`} />
          <Metric
            label="Variance"
            value={`${fmt(reconcileQuery.data?.totals.variance_kg)} kg`}
            tone={n(reconcileQuery.data?.totals.variance_kg) > 0 ? "warn" : "ok"}
          />
        </div>

        <Tabs defaultValue="issue" className="space-y-4">
          <TabsList className="grid w-full grid-cols-4 lg:w-[720px]">
            <TabsTrigger value="issue">Issue</TabsTrigger>
            <TabsTrigger value="return">Return</TabsTrigger>
            <TabsTrigger value="count">Count</TabsTrigger>
            <TabsTrigger value="reconcile">Reconcile</TabsTrigger>
          </TabsList>

          <TabsContent value="issue">
            <ActionPanel
              icon={<ArrowDownToLine className="h-4 w-4" />}
              title="Issue To Production"
              materialPicker={<MaterialPicker inks={filteredInks} materialId={materialId} setMaterialId={setMaterialId} search={search} setSearch={setSearch} />}
              selectedMaterial={selectedMaterial}
              qtyKg={qtyKg}
              setQtyKg={setQtyKg}
              eventAt={eventAt}
              setEventAt={setEventAt}
              shiftCode={shiftCode}
              setShiftCode={setShiftCode}
              reference={reference}
              setReference={setReference}
              notes={notes}
              setNotes={setNotes}
              footer={
                <Button disabled={!canPost || !qtyKg || issueMutation.isPending} onClick={() => issueMutation.mutate()}>
                  Issue ink
                </Button>
              }
            />
          </TabsContent>

          <TabsContent value="return">
            <div className="grid gap-4 xl:grid-cols-2">
              <ActionPanel
                icon={<ArrowUpFromLine className="h-4 w-4" />}
                title="Return Same Ink"
                materialPicker={<MaterialPicker inks={filteredInks} materialId={materialId} setMaterialId={setMaterialId} search={search} setSearch={setSearch} />}
                selectedMaterial={selectedMaterial}
                qtyKg={qtyKg}
                setQtyKg={setQtyKg}
                eventAt={eventAt}
                setEventAt={setEventAt}
                shiftCode={shiftCode}
                setShiftCode={setShiftCode}
                reference={reference}
                setReference={setReference}
                notes={notes}
                setNotes={setNotes}
                footer={
                  <Button disabled={!canPost || !qtyKg || returnMutation.isPending} onClick={() => returnMutation.mutate()}>
                    Return ink
                  </Button>
                }
              />
              <div className="rounded-lg border border-line bg-surface-1 p-4">
                <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-content-1">
                  <Blend className="h-4 w-4" />
                  Mix Return
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Mix base">
                    <Select value={targetBase} onValueChange={(value) => setTargetBase(value as "POLY" | "PET")}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="POLY">POLY</SelectItem>
                        <SelectItem value="PET">PET</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Mix color">
                    <Input value={targetColor} onChange={(event) => setTargetColor(event.target.value.toUpperCase())} placeholder="GOLD MIX" />
                  </Field>
                </div>
                <div className="mt-4 flex justify-end">
                  <Button disabled={!canPost || !qtyKg || !targetColor || mixMutation.isPending} onClick={() => mixMutation.mutate()}>
                    Return as mix
                  </Button>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="count">
            <ActionPanel
              icon={<ClipboardCheck className="h-4 w-4" />}
              title="Post Floor Count"
              materialPicker={<MaterialPicker inks={filteredInks} materialId={materialId} setMaterialId={setMaterialId} search={search} setSearch={setSearch} />}
              selectedMaterial={selectedMaterial}
              qtyKg={countQty}
              setQtyKg={setCountQty}
              qtyLabel="Counted kg"
              eventAt={eventAt}
              setEventAt={setEventAt}
              shiftCode={shiftCode}
              setShiftCode={setShiftCode}
              reference={reference}
              setReference={setReference}
              notes={notes}
              setNotes={setNotes}
              footer={
                <Button disabled={!canPost || !countQty || countMutation.isPending} onClick={() => countMutation.mutate()}>
                  Post count
                </Button>
              }
            />
          </TabsContent>

          <TabsContent value="reconcile">
            <div className="rounded-lg border border-line bg-surface-1 p-4">
              <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                <Field label="Start">
                  <Input type="datetime-local" value={startAt} onChange={(event) => setStartAt(event.target.value)} />
                </Field>
                <Field label="End">
                  <Input type="datetime-local" value={endAt} onChange={(event) => setEndAt(event.target.value)} />
                </Field>
                <div className="flex items-end">
                  <Button variant="outline" onClick={() => reconcileQuery.refetch()}>
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Refresh
                  </Button>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
          <DataPanel title="Floor Stock">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ink</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead className="text-right">Kg</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {floorStock.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <div className="font-medium text-content-1">{row.material_code}</div>
                      <div className="text-xs text-content-3">{row.material_name}</div>
                    </TableCell>
                    <TableCell>{row.location_name}</TableCell>
                    <TableCell className="text-right font-mono">{fmt(row.qty_kg)}</TableCell>
                  </TableRow>
                ))}
                {!floorStock.length ? <EmptyRow colSpan={3} label="No ink floor stock" /> : null}
              </TableBody>
            </Table>
          </DataPanel>

          <DataPanel title="Selected Ink">
            <div className="space-y-3 text-sm">
              <Line label="Material" value={materialLabel(selectedMaterial) || "-"} />
              <Line label="Floor qty" value={`${fmt(selectedStock?.qty_kg)} kg`} />
              <Line label="Base" value={selectedMaterial?.base_type || "-"} />
              <Line label="Mix" value={selectedMaterial?.is_mix ? "Yes" : "No"} />
            </div>
          </DataPanel>
        </div>

        <DataPanel title="Reconciliation">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job / Order</TableHead>
                <TableHead className="text-right">Theory kg</TableHead>
                <TableHead className="text-right">Actual kg</TableHead>
                <TableHead className="text-right">Variance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(reconcileQuery.data?.allocations || []).map((row, index) => (
                <TableRow key={`${row.job_number}-${index}`}>
                  <TableCell>
                    <div className="font-medium text-content-1">{row.job_number || "-"}</div>
                    <div className="text-xs text-content-3">{row.sales_order || "-"}</div>
                  </TableCell>
                  <TableCell className="text-right font-mono">{fmt(row.theory_ink_kg)}</TableCell>
                  <TableCell className="text-right font-mono">{fmt(row.actual_allocated_kg)}</TableCell>
                  <TableCell className={cn("text-right font-mono", row.variance_kg > 0 ? "text-warning-fg" : "text-success-fg")}>
                    {fmt(row.variance_kg)}
                  </TableCell>
                </TableRow>
              ))}
              {!reconcileQuery.data?.allocations?.length ? <EmptyRow colSpan={4} label="No job allocation rows in this window" /> : null}
            </TableBody>
          </Table>
        </DataPanel>

        <DataPanel title="Recent Movements">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead>Ink</TableHead>
                <TableHead>Path</TableHead>
                <TableHead>Shift</TableHead>
                <TableHead className="text-right">Kg</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {movements.slice(0, 20).map((row) => (
                <TableRow key={row.id}>
                  <TableCell><Badge variant="outline">{row.type}</Badge></TableCell>
                  <TableCell>
                    <div className="font-medium text-content-1">{row.material_code}</div>
                    <div className="text-xs text-content-3">{row.target_material_code || row.material_name}</div>
                  </TableCell>
                  <TableCell className="text-xs text-content-3">
                    {row.source_location_name || "-"} -&gt; {row.destination_location_name || "-"}
                  </TableCell>
                  <TableCell>{row.shift_code || "-"}</TableCell>
                  <TableCell className="text-right font-mono">{fmt(row.qty_kg)}</TableCell>
                </TableRow>
              ))}
              {!movements.length ? <EmptyRow colSpan={5} label="No ink movements" /> : null}
            </TableBody>
          </Table>
        </DataPanel>

        <DataPanel title="Posted Counts">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Reference</TableHead>
                <TableHead>Counted At</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Lines</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.slice(0, 10).map((session) => (
                <TableRow key={session.id}>
                  <TableCell>{session.reference || session.id.slice(0, 8)}</TableCell>
                  <TableCell>{session.counted_at ? new Date(session.counted_at).toLocaleString() : "-"}</TableCell>
                  <TableCell><Badge variant="outline">{session.status}</Badge></TableCell>
                  <TableCell className="text-right">{session.count_lines?.length || 0}</TableCell>
                </TableRow>
              ))}
              {!sessions.length ? <EmptyRow colSpan={4} label="No posted counts" /> : null}
            </TableBody>
          </Table>
        </DataPanel>
      </div>
    </div>
  );
}

function Metric({ label, value, tone = "plain" }: { label: string; value: string; tone?: "plain" | "dark" | "warn" | "ok" }) {
  return (
    <div className={cn("rounded-lg border border-line bg-surface-1 p-4", tone === "dark" && "border-info-border bg-info-bg")}>
      <div className={cn("text-xs font-medium uppercase text-content-3", tone === "dark" && "text-info-fg")}>{label}</div>
      <div className={cn("mt-2 text-xl font-semibold text-content-1", tone === "dark" && "text-info-fg", tone === "warn" && "text-warning-fg", tone === "ok" && "text-success-fg")}>{value}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-content-3">{label}</Label>
      {children}
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
  inks: Material[];
  materialId: string;
  setMaterialId: (value: string) => void;
  search: string;
  setSearch: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-content-3" />
        <Input value={search} onChange={(event) => setSearch(event.target.value)} className="pl-9" placeholder="Search ink" />
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

function ActionPanel({
  icon,
  title,
  materialPicker,
  selectedMaterial,
  qtyKg,
  setQtyKg,
  qtyLabel = "Quantity kg",
  eventAt,
  setEventAt,
  shiftCode,
  setShiftCode,
  reference,
  setReference,
  notes,
  setNotes,
  footer,
}: {
  icon: React.ReactNode;
  title: string;
  materialPicker: React.ReactNode;
  selectedMaterial?: Material;
  qtyKg: string;
  setQtyKg: (value: string) => void;
  qtyLabel?: string;
  eventAt: string;
  setEventAt: (value: string) => void;
  shiftCode: string;
  setShiftCode: (value: string) => void;
  reference: string;
  setReference: (value: string) => void;
  notes: string;
  setNotes: (value: string) => void;
  footer: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-line bg-surface-1 p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-content-1">
          {icon}
          {title}
        </div>
        <Badge variant="outline">{selectedMaterial?.base_type || "INK"}</Badge>
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(260px,1.2fr)_repeat(4,minmax(140px,1fr))]">
        <Field label="Ink">{materialPicker}</Field>
        <Field label={qtyLabel}>
          <Input type="number" min="0" step="0.001" value={qtyKg} onChange={(event) => setQtyKg(event.target.value)} />
        </Field>
        <Field label="Event time">
          <Input type="datetime-local" value={eventAt} onChange={(event) => setEventAt(event.target.value)} />
        </Field>
        <Field label="Shift">
          <Input value={shiftCode} onChange={(event) => setShiftCode(event.target.value.toUpperCase())} placeholder="A" />
        </Field>
        <Field label="Reference">
          <Input value={reference} onChange={(event) => setReference(event.target.value)} />
        </Field>
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_auto]">
        <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} className="min-h-20" placeholder="Notes" />
        <div className="flex items-end justify-end">{footer}</div>
      </div>
    </div>
  );
}

function DataPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-surface-1">
      <div className="border-b border-line px-4 py-3 text-sm font-semibold text-content-1">{title}</div>
      <div className="overflow-x-auto">{children}</div>
    </section>
  );
}

function EmptyRow({ colSpan, label }: { colSpan: number; label: string }) {
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className="h-16 text-center text-sm text-content-3">
        {label}
      </TableCell>
    </TableRow>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line py-2 last:border-0">
      <span className="text-content-3">{label}</span>
      <span className="text-right font-medium text-content-1">{value}</span>
    </div>
  );
}

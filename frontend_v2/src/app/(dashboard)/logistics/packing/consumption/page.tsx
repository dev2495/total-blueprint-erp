"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  PackageCheck,
  RefreshCcw,
  Save,
  Scale,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  logisticsService,
  type PackingMaterialCountResult,
  type PackingMaterialCountSnapshot,
} from "@/services/logistics";
import { masterDataService, type Location } from "@/services/master-data";

const todayIso = () => new Date().toISOString().slice(0, 10);
const n = (value: unknown, digits = 2) =>
  Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: digits });
const err = (error: any) =>
  error?.response?.data?.error ||
  error?.response?.data?.detail ||
  error?.message ||
  "Request failed.";
const AUTO_POSTED_KINDS = new Set(["INNER_POUCH", "GONNY"]);

function Kpi({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-[14px] border border-surface-1/15 bg-surface-1/10 p-4 text-white shadow-sm backdrop-blur">
      <div className="text-[10px] font-black uppercase tracking-[0.22em] text-white/65">
        {label}
      </div>
      <div className="mt-1 text-2xl font-black tracking-tight">{value}</div>
      <div className="mt-1 text-xs font-semibold text-white/70">{hint}</div>
    </div>
  );
}

function kindTone(kind: string) {
  const normalized = String(kind || "").toUpperCase();
  if (normalized.includes("INNER"))
    return "border-warning-border bg-warning-bg text-warning-fg";
  if (normalized.includes("GONNY"))
    return "border-success-border bg-success-bg text-success-fg";
  if (normalized.includes("LABEL") || normalized.includes("TAG"))
    return "border-info-border bg-info-bg text-primary";
  return "border-line bg-surface-1 text-content-3";
}

export default function PackingConsumptionPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [countDate, setCountDate] = useState(todayIso());
  const [selectedLocationId, setSelectedLocationId] = useState("");
  const [notes, setNotes] = useState("");
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [lastResult, setLastResult] =
    useState<PackingMaterialCountResult | null>(null);

  const locationsQuery = useQuery<Location[]>({
    queryKey: ["packing-material-count-locations"],
    queryFn: () => masterDataService.getLocations(),
    staleTime: 60_000,
  });
  const locations = useMemo(
    () =>
      [...(locationsQuery.data || [])].sort((a, b) =>
        `${a.type}-${a.name}`.localeCompare(`${b.type}-${b.name}`),
      ),
    [locationsQuery.data],
  );
  const selectedLocation = useMemo(
    () =>
      locations.find((location) => location.id === selectedLocationId) || null,
    [locations, selectedLocationId],
  );
  useEffect(() => {
    if (!selectedLocationId && locations.length) {
      const packingLocation =
        locations.find((location) =>
          String(location.name || "")
            .toLowerCase()
            .includes("pack"),
        ) ||
        locations.find(
          (location) => String(location.type || "").toUpperCase() === "FG",
        ) ||
        locations[0];
      setSelectedLocationId(packingLocation.id);
    }
  }, [locations, selectedLocationId]);

  const snapshot = useQuery<PackingMaterialCountSnapshot>({
    queryKey: ["packing-material-count", countDate, selectedLocationId],
    queryFn: () =>
      logisticsService.getPackingMaterialCount({
        date: countDate,
        location_id: selectedLocationId || undefined,
      }),
    enabled: !locations.length || !!selectedLocationId,
  });

  const rows = useMemo(
    () =>
      [...(snapshot.data?.stocks || [])]
        .filter(
          (row) =>
            !AUTO_POSTED_KINDS.has(
              String(row.packaging_kind || "").toUpperCase(),
            ),
        )
        .sort((a, b) =>
          `${a.packaging_kind}-${a.material_code}`.localeCompare(
            `${b.packaging_kind}-${b.material_code}`,
          ),
        ),
    [snapshot.data?.stocks],
  );

  const enteredLines = useMemo(() => {
    return Object.entries(counts)
      .map(([stockId, raw]) => ({
        stock_id: stockId,
        counted_qty: Number(raw),
      }))
      .filter(
        (line) =>
          Number.isFinite(line.counted_qty) &&
          String(counts[line.stock_id]).trim() !== "" &&
          line.counted_qty >= 0,
      );
  }, [counts]);

  const totalDelta = useMemo(() => {
    const bookById = new Map(
      rows.map((row) => [row.id, Number(row.book_qty || 0)]),
    );
    return enteredLines.reduce(
      (sum, line) =>
        sum + (line.counted_qty - Number(bookById.get(line.stock_id) || 0)),
      0,
    );
  }, [enteredLines, rows]);
  const lastAllocation = useMemo(() => {
    const txns = (lastResult?.results || []).flatMap((row) =>
      row.transactions.map((tx) => ({
        ...tx,
        material_code: row.material_code,
      })),
    );
    const consumptionTxns = txns.filter(
      (tx) => String(tx.type || "").toUpperCase() !== "COUNT_EXCESS",
    );
    return {
      qty: consumptionTxns.reduce((sum, tx) => sum + Number(tx.qty || 0), 0),
      orders: new Set(
        consumptionTxns.map((tx) => tx.order_number).filter(Boolean),
      ).size,
      lines: consumptionTxns,
    };
  }, [lastResult]);

  const postMutation = useMutation({
    mutationFn: () =>
      logisticsService.postPackingMaterialCount({
        date: countDate,
        notes,
        lines: enteredLines,
      }),
    onSuccess: (data) => {
      setLastResult(data);
      toast({
        title: "Packing count posted",
        description: `${data.posted_transactions} stock transaction${data.posted_transactions === 1 ? "" : "s"} created.`,
      });
      queryClient.invalidateQueries({
        queryKey: ["packing-material-count", countDate],
      });
      queryClient.invalidateQueries({ queryKey: ["stock-lifecycle"] });
    },
    onError: (error) =>
      toast({
        title: "Count failed",
        description: err(error),
        variant: "destructive",
      }),
  });

  const copyBookQty = () => {
    setCounts(
      Object.fromEntries(
        rows.map((row) => [row.id, String(row.book_qty || 0)]),
      ),
    );
  };

  return (
    <div
      className="mx-auto max-w-[1600px] space-y-5 p-4 lg:p-6"
      data-testid="packing-consumption-page"
    >
      <section className="overflow-hidden rounded-[22px] border border-success-border bg-gradient-to-br from-success-fg via-info-fg to-primary p-5 text-white shadow-xl ">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="text-[11px] font-black uppercase tracking-[0.24em] text-white/70">
              Logistics · Packing materials
            </div>
            <h1 className="mt-1 text-2xl font-black tracking-tight">
              Evening packing count
            </h1>
            <div className="mt-2 flex flex-wrap gap-2">
              <span className="rounded-full border border-surface-1/20 bg-surface-1/10 px-3 py-1 text-xs font-black">
                Sheet · tape · label · box
              </span>
              <span className="rounded-full border border-surface-1/20 bg-surface-1/10 px-3 py-1 text-xs font-black">
                same-day orders
              </span>
              <span className="rounded-full border border-surface-1/20 bg-surface-1/10 px-3 py-1 text-xs font-black">
                location closing count
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/logistics/packing"
              className="inline-flex h-10 items-center rounded-full border border-surface-1/20 bg-surface-1/10 px-3 text-sm font-black text-white transition hover:bg-surface-1/20"
            >
              <ArrowLeft className="mr-1.5 h-4 w-4" /> Packing Yard
            </Link>
            <Link
              href={`/inventory/stock-lifecycle?tab=count&scope=PACKING${selectedLocation?.plant ? `&plant=${selectedLocation.plant}` : ""}${selectedLocationId ? `&location=${selectedLocationId}` : ""}`}
              className="inline-flex h-10 items-center rounded-full border border-surface-1/20 bg-surface-1/10 px-3 text-sm font-black text-white transition hover:bg-surface-1/20"
            >
              <ClipboardList className="mr-1.5 h-4 w-4" /> Stock Lifecycle
            </Link>
            <Select
              value={selectedLocationId}
              onValueChange={setSelectedLocationId}
            >
              <SelectTrigger className="h-10 min-w-[220px] rounded-full border-surface-1/20 bg-surface-1 text-content-1">
                <SelectValue
                  placeholder={
                    locationsQuery.isLoading
                      ? "Loading locations"
                      : "Pick count location"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {locations.map((location) => (
                  <SelectItem key={location.id} value={location.id}>
                    {location.name} · {location.type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              data-testid="packing-count-date"
              type="date"
              value={countDate}
              onChange={(event) => setCountDate(event.target.value)}
              className="h-10 w-[160px] rounded-full border-surface-1/20 bg-surface-1 text-content-1"
            />
            <Button
              type="button"
              variant="secondary"
              onClick={() => snapshot.refetch()}
              disabled={snapshot.isFetching}
            >
              <RefreshCcw className="mr-1.5 h-4 w-4" /> Refresh
            </Button>
          </div>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi
            label="Manual SKUs"
            value={n(rows.length, 0)}
            hint="all masters except inner pouch + gonny"
          />
          <Kpi
            label="Book stock"
            value={n(snapshot.data?.totals.book_qty || 0, 2)}
            hint="current system balance"
          />
          <Kpi
            label="Same-day orders"
            value={n(snapshot.data?.totals.throughput_orders || 0, 0)}
            hint="eligible allocation pool"
          />
          <Kpi
            label="Entered delta"
            value={n(totalDelta, 2)}
            hint="positive excess / negative consume"
          />
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-3">
          <div className="rounded-[14px] border border-surface-1/15 bg-surface-1/10 px-4 py-3 text-sm font-black text-white">
            Scope:{" "}
            {selectedLocation
              ? `${selectedLocation.name} · ${selectedLocation.type}`
              : "Pick location"}
          </div>
          <div className="rounded-[14px] border border-surface-1/15 bg-surface-1/10 px-4 py-3 text-sm font-black text-white">
            Posted rows: {n(enteredLines.length, 0)}
          </div>
          <div className="rounded-[14px] border border-surface-1/15 bg-surface-1/10 px-4 py-3 text-sm font-black text-white">
            Stock Lifecycle: packing scope
          </div>
        </div>
      </section>

      {snapshot.isError ? (
        <div className="rounded-[16px] border border-danger-border bg-danger-bg p-4 text-sm font-semibold text-danger-fg">
          {err(snapshot.error)}
        </div>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <div className="rounded-[18px] border border-line bg-surface-1 p-4 shadow-sm">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.24em] text-success-fg">
                  Closing stock
                </div>
                <h2 className="text-lg font-black text-content-1">
                  Location closing count for manual packing SKUs
                </h2>
                <p className="mt-1 text-xs font-semibold text-content-3">
                  Tape, sheets, labels, tags, boxes, and other manual packing
                  masters. Inner pouch and gonny remain posted by Packing Yard.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  data-testid="packing-count-copy-book"
                  onClick={copyBookQty}
                  disabled={!rows.length}
                >
                  Copy book qty
                </Button>
                <Button
                  type="button"
                  data-testid="packing-count-submit"
                  onClick={() => postMutation.mutate()}
                  disabled={!enteredLines.length || postMutation.isPending}
                >
                  <Save className="mr-1.5 h-4 w-4" />{" "}
                  {postMutation.isPending ? "Posting..." : "Post count"}
                </Button>
              </div>
            </div>
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full border-separate border-spacing-y-2">
                <thead>
                  <tr className="text-left text-[10px] font-black uppercase tracking-[0.2em] text-content-4">
                    <th className="px-3 py-2">Material</th>
                    <th className="px-3 py-2">Location</th>
                    <th className="px-3 py-2 text-right">Book</th>
                    <th className="px-3 py-2">Counted</th>
                    <th className="px-3 py-2 text-right">Delta</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const raw = counts[row.id] ?? "";
                    const counted = raw.trim() === "" ? null : Number(raw);
                    const delta =
                      counted === null || !Number.isFinite(counted)
                        ? null
                        : counted - Number(row.book_qty || 0);
                    return (
                      <tr
                        key={row.id}
                        className="rounded-[14px] bg-surface-2 text-sm font-semibold text-content-2"
                      >
                        <td className="rounded-l-[14px] border-y border-l border-line px-3 py-3">
                          <div className="font-mono text-sm font-black text-content-1">
                            {row.material_code}
                          </div>
                          <div className="mt-1 line-clamp-1 text-xs text-content-3">
                            {row.material_name}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            <span
                              className={`inline-flex rounded-md border px-2 py-0.5 text-[10px] font-black uppercase ${kindTone(row.packaging_kind)}`}
                            >
                              {row.packaging_kind || "PACKING"}
                            </span>
                            {row.is_virtual ? (
                              <span className="inline-flex rounded-md border border-order-border bg-order-bg px-2 py-0.5 text-[10px] font-black uppercase text-order-fg">
                                no stock row yet
                              </span>
                            ) : null}
                          </div>
                        </td>
                        <td className="border-y border-line px-3 py-3">
                          <div>{row.location_name}</div>
                          <div className="mt-1 text-xs text-content-3">
                            {row.plant_name}
                          </div>
                        </td>
                        <td className="border-y border-line px-3 py-3 text-right font-mono font-black">
                          {n(row.book_qty)} {row.base_uom}
                        </td>
                        <td className="border-y border-line px-3 py-3">
                          <Input
                            data-testid={`packing-count-line-${row.id}`}
                            value={raw}
                            onChange={(event) =>
                              setCounts((current) => ({
                                ...current,
                                [row.id]: event.target.value,
                              }))
                            }
                            type="number"
                            step="0.001"
                            min="0"
                            placeholder="Closing qty"
                            className="h-11 min-w-[150px] bg-surface-1 font-mono font-black"
                          />
                        </td>
                        <td
                          className={`rounded-r-[14px] border-y border-r border-line px-3 py-3 text-right font-mono font-black ${delta === null ? "text-content-4" : delta < 0 ? "text-danger-fg" : delta > 0 ? "text-success-fg" : "text-content-2"}`}
                        >
                          {delta === null ? "-" : n(delta)}
                        </td>
                      </tr>
                    );
                  })}
                  {!rows.length && (
                    <tr>
                      <td
                        colSpan={5}
                        className="rounded-[16px] border border-dashed border-line bg-surface-1 p-8 text-center text-sm font-semibold text-content-3"
                      >
                        No countable packing masters found for this location.
                        Inner pouch and gonny are intentionally hidden here.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-[18px] border border-line bg-surface-1 p-4 shadow-sm">
            <div className="text-[10px] font-black uppercase tracking-[0.24em] text-content-4">
              Count note
            </div>
            <Textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Shift note, missing bundle, count correction..."
              className="mt-2 min-h-24 rounded-2xl"
            />
          </div>
        </div>

        <aside className="space-y-4">
          <div className="rounded-[18px] border border-info-border bg-info-bg p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-primary" />
              <div className="text-sm font-black text-content-1">
                Same-day allocation pool
              </div>
            </div>
            <div className="mt-3 max-h-[360px] space-y-2 overflow-y-auto pr-1">
              {(snapshot.data?.throughput || []).map((row) => (
                <div
                  key={`${row.sales_order_item_id}-${row.location_id}`}
                  className="rounded-[14px] border border-info-border bg-surface-1 p-3"
                >
                  <div className="font-mono text-sm font-black text-content-1">
                    {row.order_number || "SO"}
                  </div>
                  <div className="mt-1 text-xs font-semibold text-content-3">
                    {row.customer_name || "Customer"} · {row.location_name}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className="rounded-md border border-info-border bg-info-bg px-2 py-0.5 text-[10px] font-black uppercase text-primary">
                      {n(row.units, 0)} units
                    </span>
                    {row.sources.slice(0, 3).map((source) => (
                      <span
                        key={`${source.source}-${source.label}`}
                        className="rounded-md border border-line bg-surface-2 px-2 py-0.5 text-[10px] font-black uppercase text-content-3"
                      >
                        {source.source}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
              {!snapshot.data?.throughput?.length ? (
                <div className="rounded-[14px] border border-dashed border-info-border bg-surface-1/70 p-5 text-center text-sm font-semibold text-primary">
                  No packing throughput on this date.
                </div>
              ) : null}
            </div>
          </div>

          {lastResult ? (
            <div className="rounded-[18px] border border-success-border bg-success-bg p-4 shadow-sm">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-success-fg" />
                <div className="text-sm font-black text-content-1">
                  Last posted count
                </div>
              </div>
              <div className="mt-3 rounded-[12px] bg-surface-1 p-3 font-mono text-xs font-black text-content-2">
                {lastResult.session_id}
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="rounded-[12px] bg-surface-1 p-3">
                  <div className="text-[10px] font-black uppercase tracking-[0.18em] text-content-4">
                    Rows
                  </div>
                  <div className="text-xl font-black">
                    {n(lastResult.results.length, 0)}
                  </div>
                </div>
                <div className="rounded-[12px] bg-surface-1 p-3">
                  <div className="text-[10px] font-black uppercase tracking-[0.18em] text-content-4">
                    Txns
                  </div>
                  <div className="text-xl font-black">
                    {n(lastResult.posted_transactions, 0)}
                  </div>
                </div>
                <div className="rounded-[12px] bg-surface-1 p-3">
                  <div className="text-[10px] font-black uppercase tracking-[0.18em] text-content-4">
                    Consumed
                  </div>
                  <div className="text-xl font-black">
                    {n(lastAllocation.qty)}
                  </div>
                </div>
                <div className="rounded-[12px] bg-surface-1 p-3">
                  <div className="text-[10px] font-black uppercase tracking-[0.18em] text-content-4">
                    Mapped SO
                  </div>
                  <div className="text-xl font-black">
                    {n(lastAllocation.orders, 0)}
                  </div>
                </div>
              </div>
              {lastAllocation.lines.length ? (
                <div className="mt-3 max-h-40 space-y-1.5 overflow-y-auto pr-1">
                  {lastAllocation.lines.slice(0, 8).map((tx) => (
                    <div
                      key={tx.id}
                      className="flex items-center justify-between gap-2 rounded-[10px] bg-surface-1 px-3 py-2 text-xs font-bold text-content-3"
                    >
                      <span className="truncate">
                        {tx.order_number || "unassigned"} · {tx.material_code}
                      </span>
                      <span className="font-mono text-content-1">
                        {n(tx.qty)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="rounded-[18px] border border-line bg-surface-1 p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <Scale className="h-4 w-4 text-content-3" />
              <div className="text-sm font-black text-content-1">
                Posting rule
              </div>
            </div>
            <div className="mt-3 space-y-2 text-sm font-semibold text-content-3">
              <div className="flex items-start gap-2">
                <PackageCheck className="mt-0.5 h-4 w-4 text-success-fg" />{" "}
                Short stock becomes packing consumption.
              </div>
              <div className="flex items-start gap-2">
                <PackageCheck className="mt-0.5 h-4 w-4 text-success-fg" />{" "}
                Excess stock becomes count adjustment.
              </div>
              <div className="flex items-start gap-2">
                <PackageCheck className="mt-0.5 h-4 w-4 text-success-fg" />{" "}
                Allocation only uses orders that allowed that material.
              </div>
              <div className="flex items-start gap-2">
                <PackageCheck className="mt-0.5 h-4 w-4 text-success-fg" />{" "}
                Stock Lifecycle reads the updated packing balance.
              </div>
            </div>
          </div>
        </aside>
      </section>
    </div>
  );
}

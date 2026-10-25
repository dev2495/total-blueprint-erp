"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Boxes, CircleCheck, ClipboardList, Download, FileText, History, Printer, RefreshCw, Scale, Search, Truck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { PanelEmpty } from "@/components/premium";
import { FloorHead, FloorKpi, FloorKpiGrid, floorButtonClass } from "@/components/floor/floor-head";
import { FilterGroup, Pager, apiError as err, clean, kgText as kg, num as n, toolbarSelectClass } from "@/components/logistics/yard-ui";
import { DispatchBoard, gonniesText, rollsText, unitsOfSummary, unitsText, type BayUnit } from "@/components/dispatch/dispatch-board";
import {
  DispatchTray,
  EMPTY_TRANSPORT,
  SlipsSection,
  traySlips,
  type CreatedSlip,
  type TrayLine,
  type TrayOrder,
  type Transport,
} from "@/components/dispatch/dispatch-tray";
import { DispatchHistory } from "@/components/dispatch/dispatch-history";
import { MoveToStockDialog, type StockMoveUnit } from "@/components/dispatch/move-to-stock-dialog";
import { sizeParts } from "@/components/packing/pack-lines-dialog";
import { logisticsService, type DeliveryChallan, type SODispatchSummary } from "@/services/logistics";

const PAGE_SIZE = 8;
type UnitFilter = "ALL" | "CTN" | "ROLL";
type StatusFilter = "ALL" | "READY" | "WAITING";
type SortMode = "READY_DESC" | "GROSS_DESC" | "SO_ASC" | "CUSTOMER_ASC";
type Stage = "pick" | "created" | "closed";

export default function DispatchBayPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [unitFilter, setUnitFilter] = useState<UnitFilter>("ALL");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
  const [customerFilter, setCustomerFilter] = useState("ALL");
  const [sortMode, setSortMode] = useState<SortMode>("READY_DESC");
  const [page, setPage] = useState(1);
  const [tray, setTray] = useState<Record<string, BayUnit>>({});
  const [trayOrders, setTrayOrders] = useState<Record<string, TrayOrder>>({});
  const [trayLines, setTrayLines] = useState<Record<string, TrayLine>>({});
  const [transport, setTransportState] = useState<Transport>(EMPTY_TRANSPORT);
  const [locations, setLocations] = useState<Record<string, string>>({});
  const [stage, setStage] = useState<Stage>("pick");
  const [created, setCreated] = useState<CreatedSlip[]>([]);
  const [printed, setPrinted] = useState<Record<string, number>>({});
  const [dispatched, setDispatched] = useState<Record<string, boolean>>({});
  const [printingAll, setPrintingAll] = useState(false);
  const [historyTab, setHistoryTab] = useState<"ALL" | "POD" | "DRAFT">("ALL");
  const [historySearch, setHistorySearch] = useState("");
  const [bay, setBay] = useState<"ready" | "load" | "history">("ready");
  const [shipClosed, setShipClosed] = useState(false);
  const [moveTarget, setMoveTarget] = useState<{
    orderNumber: string;
    lineNo?: number | null;
    lineName?: string;
    closedLabel: string;
    units: StockMoveUnit[];
  } | null>(null);
  // Deep link from an order page: /logistics/dispatch?history=SO-2026-0254 opens its slips.
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const term = params.get("history");
      if (term) {
        setHistorySearch(term);
        setBay("history");
      } else if (params.get("tab") === "history") {
        setBay("history");
      }
    } catch {
      // Opening on the board is fine.
    }
  }, []);
  const [podChallan, setPodChallan] = useState<DeliveryChallan | null>(null);
  const [podReceivedBy, setPodReceivedBy] = useState("");
  const [podReference, setPodReference] = useState("");
  const [podNotes, setPodNotes] = useState("");

  const board = useQuery({
    queryKey: ["dispatch-board"],
    queryFn: ({ signal }) => logisticsService.getDispatchBoard(signal),
    refetchInterval: 30000,
  });
  // Today's figures and counts only; the history below pages its own slips on the server.
  const challans = useQuery({
    queryKey: ["challan-history", "stats"],
    queryFn: ({ signal }) => logisticsService.getChallanHistory({ limit: 1 }, signal),
    refetchInterval: 60000,
  });
  const challanStats = challans.data?.stats;

  const readyOf = (row: any) => Number(row.available_for_dispatch?.rolls_count || 0) + Number(row.available_for_dispatch?.gonnies_count || 0);
  const grossOf = (row: any) =>
    Number(row.available_for_dispatch?.rolls_gross_kg || row.available_for_dispatch?.rolls_kg || 0) +
    Number(row.available_for_dispatch?.gonnies_gross_kg || 0);
  const allOrders = board.data?.orders || [];
  const customerOptions = useMemo(
    () => Array.from(new Set(allOrders.map((row) => row.sales_order.customer_name).filter(Boolean))).sort(),
    [allOrders],
  );
  const cards = allOrders
    .filter((row) => {
      const term = search.trim().toLowerCase();
      const haystack = `${row.sales_order.order_number} ${row.sales_order.customer_name} ${(row.sales_order as any).job_name || ""}`.toLowerCase();
      if (term && !haystack.includes(term)) return false;
      if (unitFilter === "CTN" && !Number(row.available_for_dispatch?.gonnies_count || 0)) return false;
      if (unitFilter === "ROLL" && !Number(row.available_for_dispatch?.rolls_count || 0)) return false;
      if (statusFilter !== "ALL" && (readyOf(row) ? "READY" : "WAITING") !== statusFilter) return false;
      if (customerFilter !== "ALL" && row.sales_order.customer_name !== customerFilter) return false;
      return true;
    })
    .sort((a, b) => {
      if (sortMode === "GROSS_DESC") return grossOf(b) - grossOf(a);
      if (sortMode === "SO_ASC") return a.sales_order.order_number.localeCompare(b.sales_order.order_number);
      if (sortMode === "CUSTOMER_ASC") return a.sales_order.customer_name.localeCompare(b.sales_order.customer_name);
      return readyOf(b) - readyOf(a);
    });
  const pageCount = Math.max(1, Math.ceil(cards.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pagedCards = cards.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  useEffect(() => setPage(1), [search, unitFilter, statusFilter, customerFilter, sortMode]);

  const trayList = Object.values(tray);
  const summaryIds = Array.from(
    new Set([...pagedCards.map((row) => String(row.sales_order.id)), ...trayList.map((unit) => unit.orderId)]),
  );
  const summaryQueries = useQueries({
    queries: summaryIds.map((id) => ({
      queryKey: ["dispatch-summary", id],
      queryFn: ({ signal }: { signal: AbortSignal }) => logisticsService.getSODispatchableItems(id, signal),
      staleTime: 15_000,
    })),
  });
  const summaries = new Map<string, SODispatchSummary>();
  summaryQueries.forEach((query, index) => {
    if (query.data) summaries.set(summaryIds[index], query.data as SODispatchSummary);
  });
  const summaryError = summaryQueries.find((query) => query.isError)?.error;

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["dispatch-board"] }),
      queryClient.invalidateQueries({ queryKey: ["dispatch-summary"] }),
      queryClient.invalidateQueries({ queryKey: ["challan-history"] }),
      queryClient.invalidateQueries({ queryKey: ["packing-board"] }),
    ]);

  const downloadEpsonJob = async (url: string) => {
    try {
      const response = await fetch(url, { credentials: "include", headers: { Accept: "application/vnd.totalpolyprint.epson-raw" } });
      const contentType = response.headers.get("content-type") || "";
      if (!response.ok || !contentType.includes("application/vnd.totalpolyprint.epson-raw")) {
        let message = `Print job could not be prepared (${response.status}).`;
        if (contentType.includes("application/json")) {
          const body = await response.json();
          message = body?.error || body?.detail || message;
        }
        throw new Error(message);
      }
      const disposition = response.headers.get("content-disposition") || "";
      const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || "total-poly-print.tppprint";
      const objectUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = filename;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
      toast({ title: "Epson job downloaded", description: "The Windows helper prints one 10 × 6-inch form in NLQ mode with no browser scaling." });
      return true;
    } catch (error) {
      toast({ title: "Epson print failed", description: err(error), variant: "destructive" });
      return false;
    }
  };

  // Tray: units from several orders; each remembers its order, line and plant.
  const remember = (units: BayUnit[]) => {
    const nextOrders: Record<string, TrayOrder> = {};
    const nextLines: Record<string, TrayLine> = {};
    units.forEach((unit) => {
      const summary = summaries.get(unit.orderId);
      if (!summary) return;
      const order = summary.sales_order as SODispatchSummary["sales_order"] & { job_name?: string };
      nextOrders[unit.orderId] = {
        id: unit.orderId,
        orderNumber: order.order_number,
        jobName: clean(order.job_name),
        customer: order.customer_name,
        deliveryTo: clean(order.delivery?.delivery_to),
        address: clean(order.delivery?.address),
        location: clean(order.delivery?.location),
      };
      const line = (summary.lines || []).find((item) => item.id === unit.lineId);
      if (line) {
        const parts = sizeParts(line, unit.kind === "ROLL");
        nextLines[unit.lineId] = {
          lineNo: line.line_no,
          name: clean(line.product_name) || "Order line",
          size: parts.metric ? `${parts.metric} ${parts.unit}`.trim() : "",
        };
      }
    });
    setTrayOrders((prev) => ({ ...prev, ...nextOrders }));
    setTrayLines((prev) => ({ ...prev, ...nextLines }));
    setLocations((prev) => {
      const next = { ...prev };
      Object.values(nextOrders).forEach((order) => {
        if (next[order.id] === undefined) next[order.id] = order.location;
      });
      return next;
    });
  };
  const setInTray = (units: BayUnit[], on: boolean) => {
    if (stage !== "pick") return;
    setTray((prev) => {
      const next = { ...prev };
      units.forEach((unit) => {
        if (on) next[unit.id] = unit;
        else delete next[unit.id];
      });
      return next;
    });
    if (on) remember(units);
  };
  const toggleUnit = (unit: BayUnit) => setInTray([unit], !tray[unit.id]);
  const clearTray = () => {
    setTray({});
    setTrayOrders({});
    setTrayLines({});
    setLocations({});
    setShipClosed(false);
  };
  const nextLoad = () => {
    clearTray();
    setTransportState(EMPTY_TRANSPORT);
    setCreated([]);
    setPrinted({});
    setDispatched({});
    setStage("pick");
    setBay("ready");
  };

  const createMutation = useMutation({
    mutationFn: () => {
      const orderIds = Array.from(new Set(trayList.map((unit) => unit.orderId)));
      return logisticsService.createLineSlips({
        groups: orderIds.map((orderId) => ({
          sales_order_id: orderId,
          roll_ids: trayList.filter((unit) => unit.orderId === orderId && unit.kind === "ROLL").map((unit) => unit.id),
          gonny_ids: trayList.filter((unit) => unit.orderId === orderId && unit.kind === "CTN").map((unit) => unit.id),
          ship_to_address_snapshot: { location: clean(locations[orderId]) },
        })),
        transporter_name: clean(transport.transporter),
        vehicle_no: clean(transport.vehicle),
        driver_name: clean(transport.driver),
        driver_phone: clean(transport.phone),
        lr_number: clean(transport.lr),
        e_way_bill_number: clean(transport.eway),
        dispatch_notes: transport.note,
        ship_closed_lines: shipClosed && trayList.some((unit) => unit.closed),
      });
    },
    onSuccess: async (data) => {
      setCreated(data.slips);
      setStage("created");
      setBay("load");
      toast({ title: "Dispatch slips ready", description: data.message });
      await invalidate();
    },
    onError: (error) => toast({ title: "Slips not created", description: err(error), variant: "destructive" }),
  });

  const dispatchMutation = useMutation({
    mutationFn: async ({ ids, shipClosed: confirmClosed }: { ids: string[]; shipClosed: boolean }) => {
      const done: string[] = [];
      for (const id of ids) {
        await logisticsService.dispatchChallan(id, { ship_closed_lines: confirmClosed });
        done.push(id);
        setDispatched((prev) => ({ ...prev, [id]: true }));
      }
      return done;
    },
    onSuccess: async (done) => {
      toast({ title: "Dispatched", description: `${done.length} slip${done.length === 1 ? "" : "s"} marked dispatched.` });
      if (created.length && created.every((slip) => done.includes(slip.id) || dispatched[slip.id])) setStage("closed");
      await invalidate();
    },
    onError: async (error) => {
      toast({ title: "Dispatch stopped", description: err(error), variant: "destructive" });
      await invalidate();
    },
  });

  const deliverMutation = useMutation({
    mutationFn: () => {
      if (!podChallan) throw new Error("Select a dispatch slip first.");
      return logisticsService.confirmPOD(podChallan.id, { received_by: podReceivedBy, reference: podReference, notes: podNotes });
    },
    onSuccess: (data) => {
      toast({ title: data.order_closed ? "POD confirmed · order closed" : "POD confirmed", description: data.message });
      setPodChallan(null);
      setPodReceivedBy("");
      setPodReference("");
      setPodNotes("");
      void invalidate();
    },
    onError: (error) => toast({ title: "POD confirmation failed", description: err(error), variant: "destructive" }),
  });

  const printSlip = async (slip: { id: string }) => {
    const ok = await downloadEpsonJob(logisticsService.getChallanPrintUrl(slip.id, "tpp"));
    if (ok) setPrinted((prev) => ({ ...prev, [slip.id]: (prev[slip.id] || 0) + 1 }));
  };
  const printAll = async () => {
    setPrintingAll(true);
    try {
      for (const slip of created.filter((item) => !printed[item.id])) await printSlip(slip);
    } finally {
      setPrintingAll(false);
    }
  };
  const packingSlip = (orderId: string, units: BayUnit[], pdf?: boolean) => {
    if (!units.length) return;
    const selection = {
      rollIds: units.filter((unit) => unit.kind === "ROLL").map((unit) => unit.id),
      gonnyIds: units.filter((unit) => unit.kind === "CTN").map((unit) => unit.id),
    };
    if (pdf) window.open(logisticsService.getMaterialReadySlipUrl(orderId, selection, "pdf"), "_blank", "noopener,noreferrer");
    else void downloadEpsonJob(logisticsService.getMaterialReadySlipUrl(orderId, selection, "tpp"));
  };
  const jumpTo = (orderId: string) => {
    const row = allOrders.find((item) => item.sales_order.id === orderId);
    if (!row) return;
    setUnitFilter("ALL");
    setStatusFilter("ALL");
    setCustomerFilter("ALL");
    setSearch(row.sales_order.order_number);
  };
  const clearFilters = () => {
    setSearch("");
    setUnitFilter("ALL");
    setStatusFilter("ALL");
    setCustomerFilter("ALL");
    setSortMode("READY_DESC");
  };

  // KPIs, as on the sample.
  const totals = board.data?.totals || {};
  const readyUnits = Number(totals.ready_gonnies || 0) + Number(totals.ready_rolls || 0);
  const readyGross = Number(totals.ready_rolls_gross_kg || totals.ready_rolls_kg || 0) + Number(totals.ready_gonnies_gross_kg || 0);
  const readyNet = allOrders.reduce(
    (sum, row) =>
      sum +
      Number(row.available_for_dispatch?.rolls_net_kg || row.available_for_dispatch?.rolls_kg || 0) +
      Number(row.available_for_dispatch?.gonnies_net_kg || 0),
    0,
  );
  const ordersReady = allOrders.filter((row) => readyOf(row) > 0);
  const waitingOrders = allOrders.length - ordersReady.length;
  const vehiclesToday = challanStats?.vehicles_today || [];
  const dispatchedTodayCount = Number(challanStats?.dispatched_today || 0);
  const slipsTodayCount = Number(challanStats?.slips_today || 0);
  const draftCount = Number(challanStats?.drafts || 0);
  const podPendingCount = Number(challanStats?.pod_pending || 0);
  const deliveredCount = Number(challanStats?.delivered || 0);
  const anyFetching = board.isFetching || challans.isFetching || summaryQueries.some((query) => query.isFetching);
  const boardStatus = board.isLoading
    ? { tone: "neutral" as const, text: "Loading bay…" }
    : board.isError
      ? { tone: "bad" as const, text: board.data ? "Refresh failed · showing last board" : "Board unavailable" }
      : board.isFetching
        ? { tone: "info" as const, text: "Refreshing…" }
        : { tone: "good" as const, text: "Live · auto-refresh 30s" };
  const recentTransporters = challanStats?.recent_transporters || [];
  const trayUnitIds = new Set(Object.keys(tray));
  const v = (value: number) => (board.data ? n(value, 0) : "—");

  return (
    <div className="mx-auto max-w-[1760px] space-y-3" data-testid="dispatch-page">
      <FloorHead
        icon={<Truck />}
        title="Dispatch Bay"
        description="Load released units onto a vehicle, print one slip per order line, and send them out. Only units that Packing Yard has released appear here. Vehicle no. is optional."
        status={boardStatus}
        alerts={
          board.isError || challans.isError ? (
            <>
              {board.isError ? <span role="alert">{err(board.error)}</span> : null}
              {challans.isError ? <span role="alert">Challan history unavailable: {err(challans.error)}</span> : null}
            </>
          ) : null
        }
        actions={
          <>
            <a
              href="/downloads/epson-fx2175ii/TotalPolyPrint-Epson-Setup.exe"
              download="TotalPolyPrint-Epson-Setup.exe"
              data-testid="dispatch-epson-windows-setup"
              title="Install or repair Epson FX-2175II tractor printing on this Windows PC"
              className={floorButtonClass("secondary")}
            >
              <Download /> Epson setup
            </a>
            <button
              type="button"
              onClick={() => void invalidate()}
              disabled={anyFetching}
              className={floorButtonClass("primary")}
              aria-label="Refresh dispatch board and challans"
            >
              <RefreshCw className={cn(anyFetching && "animate-spin motion-reduce:animate-none")} /> Refresh
            </button>
          </>
        }
      />
      <FloorKpiGrid>
        <FloorKpi
          icon={<Boxes />}
          label="Units ready"
          tone="good"
          active={bay === "ready"}
          onClick={() => setBay("ready")}
          value={v(readyUnits)}
          unit="units"
          sub={board.data ? `${gonniesText(Number(totals.ready_gonnies || 0))} · ${rollsText(Number(totals.ready_rolls || 0))}` : "—"}
        />
        <FloorKpi
          icon={<Scale />}
          label="Weight ready"
          value={board.data ? n(readyGross, 2) : "—"}
          unit="kg gross"
          sub={board.data ? `${kg(readyNet)} net product` : "—"}
        />
        <FloorKpi
          icon={<ClipboardList />}
          label="Orders ready"
          value={v(ordersReady.length)}
          unit="orders"
          sub={board.data ? `${new Set(ordersReady.map((row) => row.sales_order.customer_name)).size} customers · ${waitingOrders} in packing` : "—"}
        />
        <FloorKpi
          icon={<Truck />}
          label="Vehicles today"
          tone="info"
          value={challans.data ? n(vehiclesToday.length, 0) : "—"}
          unit="vehicles"
          sub={vehiclesToday.length ? `${vehiclesToday[0]}${vehiclesToday.length > 1 ? ` + ${vehiclesToday.length - 1} more` : ""}` : "none yet"}
        />
        <FloorKpi
          testId="dispatch-kpi-drafts"
          icon={<Printer />}
          label="Slips today"
          tone={draftCount ? "warn" : "neutral"}
          value={challans.data ? n(slipsTodayCount, 0) : "—"}
          unit="slips"
          sub={`${dispatchedTodayCount} dispatched · ${draftCount} draft`}
          active={bay === "history" && historyTab === "DRAFT"}
          onClick={() => {
            setHistoryTab("DRAFT");
            setBay("history");
          }}
        />
        <FloorKpi
          testId="dispatch-kpi-pod"
          icon={<CircleCheck />}
          label="Awaiting POD"
          tone={podPendingCount ? "info" : "neutral"}
          value={challans.data ? n(podPendingCount, 0) : "—"}
          unit="challans"
          sub={`${deliveredCount} delivered all-time`}
          active={bay === "history" && historyTab === "POD"}
          onClick={() => {
            setHistoryTab("POD");
            setBay("history");
          }}
        />
      </FloorKpiGrid>

      {summaryError ? (
        <div role="alert" className="rounded-xl border border-danger-border bg-danger-bg px-4 py-3 text-[12.5px] text-danger-fg">
          Some order details did not load: {err(summaryError)}
        </div>
      ) : null}

      <div className="flex flex-wrap items-end justify-between gap-2 border-b border-line" role="tablist" aria-label="Dispatch Bay views">
        <div className="flex gap-1 overflow-x-auto">
          {(
            [
              ["ready", "Ready to dispatch", readyUnits ? unitsText(readyUnits) : "", Truck],
              [
                "load",
                "This load",
                created.length ? `${created.length} slip${created.length === 1 ? "" : "s"}` : trayList.length ? unitsText(trayList.length) : "",
                FileText,
              ],
              ["history", "Challans & history", podPendingCount ? `${n(podPendingCount, 0)} awaiting POD` : "", History],
            ] as const
          ).map(([value, label, badge, Icon]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={bay === value}
              data-testid={`dispatch-tab-${value}`}
              onClick={() => setBay(value)}
              className={cn(
                "relative flex min-h-[42px] shrink-0 items-center gap-2 px-3.5 text-[13.5px] font-semibold transition-colors",
                bay === value ? "text-content-1" : "text-content-3 hover:text-content-1",
              )}
            >
              <Icon className="h-4 w-4" aria-hidden />
              {label}
              {badge ? (
                <span className={cn("rounded-full px-2 text-[11px] tabular-nums", bay === value ? "bg-primary text-white" : "bg-surface-2 text-content-3")}>
                  {badge}
                </span>
              ) : null}
              {bay === value ? <span className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-primary" aria-hidden /> : null}
            </button>
          ))}
        </div>
        <span className="pb-2 text-[12px] text-content-3">
          {bay === "history"
            ? "Every slip: reprint, dispatch drafts, confirm proof of delivery"
            : bay === "load"
              ? "Print the slips of this load, then mark it dispatched"
              : "Tick lines to load the vehicle · one slip per order line"}
        </span>
      </div>

      {bay !== "history" ? (
      <section className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_400px]">
        {bay === "ready" ? (
        <div className="min-w-0 overflow-hidden rounded-[16px] border border-line bg-surface-1 shadow-[var(--shadow-sm)]">
          <header className="flex flex-wrap items-center gap-2 px-4 py-2.5">
            <Truck className="h-4 w-4 text-content-3" aria-hidden />
            <h2 className="text-[15px] font-semibold text-content-1">Ready to dispatch</h2>
            <span className="text-[12px] text-content-3">Customer → order → line. Tick a line to load it, or open Units for a part load.</span>
            <span className="ml-auto rounded-full bg-surface-2 px-2 py-0.5 text-[11.5px] tabular-nums text-content-2">
              {readyUnits ? unitsText(readyUnits) : "no units"} · {kg(readyGross)}
            </span>
          </header>
          <div className="flex flex-wrap items-center gap-2 border-y border-line px-3 py-2">
            <div className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-4" aria-hidden />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search order, job or customer"
                aria-label="Search dispatch queue"
                className="h-9 rounded-xl pl-9"
              />
            </div>
            <FilterGroup
              label="Unit type"
              testIdPrefix="dispatch-filter-unit"
              value={unitFilter}
              onChange={setUnitFilter}
              options={[
                { value: "ALL", label: "All units", count: allOrders.length },
                { value: "CTN", label: "Gonnies", count: allOrders.filter((row) => Number(row.available_for_dispatch?.gonnies_count || 0)).length },
                { value: "ROLL", label: "Rolls", count: allOrders.filter((row) => Number(row.available_for_dispatch?.rolls_count || 0)).length },
              ]}
            />
            <FilterGroup
              label="Queue status"
              testIdPrefix="dispatch-filter-status"
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: "ALL", label: "Any status" },
                { value: "READY", label: "Ready", count: ordersReady.length },
                { value: "WAITING", label: "Waiting", count: waitingOrders },
              ]}
            />
            <select
              data-testid="dispatch-filter-customer"
              value={customerFilter}
              onChange={(event) => setCustomerFilter(event.target.value)}
              className={cn(toolbarSelectClass, "max-w-[170px]")}
              aria-label="Filter by customer"
            >
              <option value="ALL">All customers</option>
              {customerOptions.map((customer) => (
                <option key={customer} value={customer}>
                  {customer}
                </option>
              ))}
            </select>
            <select
              data-testid="dispatch-filter-sort"
              value={sortMode}
              onChange={(event) => setSortMode(event.target.value as SortMode)}
              className={toolbarSelectClass}
              aria-label="Sort queue"
            >
              <option value="READY_DESC">Ready units first</option>
              <option value="GROSS_DESC">Heaviest first</option>
              <option value="SO_ASC">SO number</option>
              <option value="CUSTOMER_ASC">Customer</option>
            </select>
            <Select value="" onValueChange={jumpTo}>
              <SelectTrigger data-testid="dispatch-sales-order-select" className="h-9 w-full rounded-xl sm:w-[200px]" aria-label="Jump to sales order">
                <SelectValue placeholder="Jump to order…" />
              </SelectTrigger>
              <SelectContent>
                {allOrders.map((row) => (
                  <SelectItem key={row.sales_order.id} value={row.sales_order.id}>
                    {row.sales_order.order_number}
                    {(row.sales_order as any).job_name ? ` · ${(row.sales_order as any).job_name}` : ""} · {row.sales_order.customer_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="button" variant="ghost" size="sm" data-testid="dispatch-filter-clear" onClick={clearFilters}>
              Clear
            </Button>
          </div>
          <div className="p-3">
            {board.isLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div key={index} className="erp-skeleton h-[160px] rounded-2xl" />
                ))}
              </div>
            ) : pagedCards.length ? (
              <DispatchBoard
                rows={pagedCards}
                summaries={summaries}
                tray={trayUnitIds}
                disabled={stage !== "pick"}
                onToggleMany={setInTray}
                onToggle={toggleUnit}
                onPackingSlip={packingSlip}
                onMoveToStock={(order, line, units, closedLabel) =>
                  setMoveTarget({
                    orderNumber: order.sales_order.order_number,
                    lineNo: line.line_no,
                    lineName: clean(line.product_name),
                    closedLabel,
                    units: units.map((unit) => ({
                      id: unit.id,
                      kind: unit.kind,
                      label: unit.dispatchNo || unit.label,
                      kg: unit.net,
                      pcs: unit.pcs || undefined,
                      note: [unit.mode, unit.location].filter(Boolean).join(" · "),
                    })),
                  })
                }
              />
            ) : (
              <PanelEmpty icon={<Truck />} title={allOrders.length ? "No orders match" : "No orders to ship"}>
                {allOrders.length
                  ? "Try clearing the filters."
                  : "Release units from Packing Yard to see them here. Dispatch Bay only shows units that Packing Yard has released."}
              </PanelEmpty>
            )}
          </div>
          <footer className="flex items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-[11.5px] text-content-3">
            <span data-testid="dispatch-queue-total">
              Showing {cards.length ? (safePage - 1) * PAGE_SIZE + 1 : 0}–{(safePage - 1) * PAGE_SIZE + pagedCards.length} of {cards.length} orders · units
              released from Packing Yard only
            </span>
            <Pager page={safePage} pageCount={pageCount} onPageChange={setPage} testId="dispatch-queue-page" />
          </footer>
        </div>
        ) : (
          <div className="min-w-0 space-y-3" data-testid="dispatch-load-panel">
            {created.length ? (
              <SlipsSection
                created={created}
                orders={trayOrders}
                lines={trayLines}
                printed={printed}
                dispatched={dispatched}
                onPrint={(slip) => void printSlip(slip)}
                transport={transport}
              />
            ) : trayList.length ? (
              <section className="rounded-[16px] border border-dashed border-line bg-surface-1 px-5 py-6 text-[13px] text-content-3" data-testid="dispatch-slips-pending">
                <b className="block text-[15px] text-content-1">
                  {traySlips(trayList).length} slip{traySlips(trayList).length === 1 ? "" : "s"} will be created
                </b>
                One per order line. Fill the transport on the right and press Create; the exact text each slip prints on the Epson
                (10 × 6 in, 96 columns) then shows here with print, PDF and QR.
              </section>
            ) : (
              <PanelEmpty icon={<FileText />} title="No load in progress">
                Tick lines on Ready to dispatch to load a vehicle. Older slips are in History.
              </PanelEmpty>
            )}
          </div>
        )}

        <DispatchTray
          units={stage === "pick" ? trayList : trayList}
          orders={trayOrders}
          lines={trayLines}
          stage={stage}
          transport={transport}
          setTransport={(patch) => setTransportState((prev) => ({ ...prev, ...patch }))}
          locations={locations}
          setLocation={(orderId, value) => setLocations((prev) => ({ ...prev, [orderId]: value }))}
          recentTransporters={recentTransporters}
          created={created}
          printed={printed}
          dispatched={dispatched}
          creating={createMutation.isPending}
          dispatching={dispatchMutation.isPending}
          printingAll={printingAll}
          onCreate={() => createMutation.mutate()}
          onClearTray={clearTray}
          onPrintAll={() => void printAll()}
          onDispatchAll={() =>
            dispatchMutation.mutate({ ids: created.filter((slip) => !dispatched[slip.id]).map((slip) => slip.id), shipClosed })
          }
          onNextLoad={nextLoad}
          onRemoveUnits={(units) => setInTray(units, false)}
          onShowHistory={() => setBay("history")}
          shipClosed={shipClosed}
          setShipClosed={setShipClosed}
        />
      </section>
      ) : (
        <DispatchHistory
          dispatchingId={dispatchMutation.isPending ? String(dispatchMutation.variables?.ids?.[0] || "") : ""}
          onPrint={(row) => void downloadEpsonJob(logisticsService.getChallanPrintUrl(row.id, "tpp"))}
          onDispatch={(row) => dispatchMutation.mutate({ ids: [row.id], shipClosed: Boolean(row.line_closed || row.order_closed) })}
          onPod={setPodChallan}
          initialTab={historyTab}
          initialSearch={historySearch}
        />
      )}

      <MoveToStockDialog
        open={Boolean(moveTarget)}
        onOpenChange={(open) => !open && setMoveTarget(null)}
        orderNumber={moveTarget?.orderNumber || ""}
        lineNo={moveTarget?.lineNo}
        lineName={moveTarget?.lineName}
        closedLabel={moveTarget?.closedLabel || ""}
        units={moveTarget?.units || []}
        onMoved={() => void invalidate()}
      />

      <Dialog open={Boolean(podChallan)} onOpenChange={(open) => !open && setPodChallan(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Confirm proof of delivery</DialogTitle>
            <DialogDescription>
              {podChallan?.dc_no} · {podChallan?.customer_name} · {podChallan?.so_number || "sales order"}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="pod-received-by">Received by</Label>
              <Input id="pod-received-by" value={podReceivedBy} onChange={(event) => setPodReceivedBy(event.target.value)} placeholder="Receiver name (optional)" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pod-reference">POD reference</Label>
              <Input id="pod-reference" value={podReference} onChange={(event) => setPodReference(event.target.value)} placeholder="Stamp, receipt or POD number (optional)" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pod-notes">Notes</Label>
              <Textarea id="pod-notes" value={podNotes} onChange={(event) => setPodNotes(event.target.value)} placeholder="Delivery acknowledgement (optional)" />
            </div>
            <div className="rounded-xl border border-warning-border bg-warning-bg px-3 py-2.5 text-[12.5px] text-warning-fg">
              This confirms physical delivery. The sales order closes only when every active line is fully delivered.
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPodChallan(null)}>
              Cancel
            </Button>
            <Button data-testid="dispatch-confirm-pod-submit" disabled={deliverMutation.isPending} onClick={() => deliverMutation.mutate()}>
              {deliverMutation.isPending ? "Confirming…" : "Confirm POD"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

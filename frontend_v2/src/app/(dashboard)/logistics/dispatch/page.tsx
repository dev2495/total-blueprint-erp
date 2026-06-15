"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FileText,
  MapPin,
  Printer,
  Search,
  Send,
  Truck,
} from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  type DeliveryChallan,
  type SODispatchSummary,
} from "@/services/logistics";

const n = (value: unknown, digits = 1) =>
  Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: digits });
const err = (error: any) =>
  error?.response?.data?.error ||
  error?.response?.data?.detail ||
  error?.message ||
  "Request failed.";
const QUEUE_PAGE_SIZE = 8;
const HISTORY_PAGE_SIZE = 6;
const MANIFEST_PAGE_SIZE = 10;
type DispatchUnitFilter = "ALL" | "CTN" | "ROLL";
type DispatchStatusFilter = "ALL" | "READY" | "WAITING";
type DispatchSortMode = "READY_DESC" | "SO_ASC" | "CUSTOMER_ASC" | "GROSS_DESC";

function Tile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-[14px] border border-surface-1/20 bg-surface-1/10 p-3 text-white shadow-sm backdrop-blur">
      <div className="text-[10px] font-black uppercase tracking-[0.18em] text-white/65">
        {label}
      </div>
      <div className="mt-1 text-2xl font-black tracking-tight">{value}</div>
      <div className="mt-1 text-xs font-semibold text-white/70">{hint}</div>
    </div>
  );
}

function Chip({
  children,
  tone = "slate",
}: {
  children: ReactNode;
  tone?:
    | "ctn"
    | "bdl"
    | "roll"
    | "blue"
    | "green"
    | "amber"
    | "violet"
    | "slate"
    | "red";
}) {
  const tones = {
    ctn: "border-warning-border bg-warm text-warm",
    bdl: "border-danger-border bg-danger-bg text-danger-fg",
    roll: "border-info-border bg-info-bg text-info-fg",
    blue: "border-info-border bg-info-bg text-primary",
    green: "border-success-border bg-success-bg text-success-fg",
    amber: "border-warning-border bg-warning-bg text-warning-fg",
    violet: "border-order-border bg-order-bg text-order-fg",
    red: "border-danger-border bg-danger-bg text-danger-fg",
    slate: "border-line bg-surface-1 text-content-3",
  };
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-black uppercase tracking-[0.04em] ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

function MiniMetric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-[10px] border border-line bg-surface-1 p-3">
      <div className="text-[10px] font-black uppercase tracking-[0.22em] text-content-4">
        {label}
      </div>
      <div className="mt-1 text-xl font-black tracking-tight text-content-1">
        {value}
      </div>
      {hint && (
        <div className="mt-0.5 text-[11px] font-semibold text-content-3">
          {hint}
        </div>
      )}
    </div>
  );
}

function Pager({
  page,
  pageCount,
  onPageChange,
  testId,
}: {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  testId: string;
}) {
  if (pageCount <= 1) return null;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-testid={`${testId}-prev`}
        disabled={page <= 1}
        onClick={() => onPageChange(Math.max(1, page - 1))}
      >
        Prev
      </Button>
      {Array.from({ length: pageCount }, (_, index) => index + 1).map(
        (item) => (
          <button
            key={item}
            type="button"
            data-testid={`${testId}-${item}`}
            onClick={() => onPageChange(item)}
            className={`h-8 min-w-8 rounded-lg border px-2 text-xs font-black ${item === page ? "border-order-border bg-order-bg text-order-fg" : "border-line bg-surface-1 text-content-3 hover:border-order-border"}`}
          >
            {item}
          </button>
        ),
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-testid={`${testId}-next`}
        disabled={page >= pageCount}
        onClick={() => onPageChange(Math.min(pageCount, page + 1))}
      >
        Next
      </Button>
    </div>
  );
}

function lifecycle(status: string) {
  const current = String(status || "DRAFT").toUpperCase();
  const stages = ["DRAFT", "DISPATCHED", "IN_TRANSIT", "DELIVERED"];
  const active = Math.max(0, stages.indexOf(current));
  return stages.map((stage, index) => (
    <div key={stage} className="flex min-w-[110px] flex-1 items-center">
      <div
        className={`flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-black ${index <= active ? "bg-success-fg text-white" : "bg-line text-content-3"}`}
      >
        {index + 1}
      </div>
      <div className="ml-2 text-[10px] font-black uppercase tracking-[0.14em] text-content-3">
        {stage.replace("_", " ")}
      </div>
      {index < stages.length - 1 && (
        <div
          className={`mx-3 h-px flex-1 ${index < active ? "bg-success-fg" : "bg-line"}`}
        />
      )}
    </div>
  ));
}

export default function DispatchBayPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [unitFilter, setUnitFilter] = useState<DispatchUnitFilter>("ALL");
  const [statusFilter, setStatusFilter] = useState<DispatchStatusFilter>("ALL");
  const [customerFilter, setCustomerFilter] = useState("ALL");
  const [sortMode, setSortMode] = useState<DispatchSortMode>("READY_DESC");
  const [historySearch, setHistorySearch] = useState("");
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [selectedRolls, setSelectedRolls] = useState<string[]>([]);
  const [selectedGonnies, setSelectedGonnies] = useState<string[]>([]);
  const [finalizeOpen, setFinalizeOpen] = useState(false);
  const [vehicleNo, setVehicleNo] = useState("");
  const [driverName, setDriverName] = useState("");
  const [driverPhone, setDriverPhone] = useState("");
  const [transporterName, setTransporterName] = useState("");
  const [lrNumber, setLrNumber] = useState("");
  const [ewayBill, setEwayBill] = useState("");
  const [notes, setNotes] = useState("");
  const [queuePage, setQueuePage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const [manifestPage, setManifestPage] = useState(1);

  const board = useQuery({
    queryKey: ["dispatch-board"],
    queryFn: logisticsService.getDispatchBoard,
    refetchInterval: 30000,
  });
  const summary = useQuery({
    queryKey: ["dispatch-summary", selectedOrderId],
    queryFn: () => logisticsService.getSODispatchableItems(selectedOrderId),
    enabled: Boolean(selectedOrderId),
  });
  const challans = useQuery({
    queryKey: ["challans"],
    queryFn: () => logisticsService.getChallans(),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["dispatch-board"] });
    queryClient.invalidateQueries({
      queryKey: ["dispatch-summary", selectedOrderId],
    });
    queryClient.invalidateQueries({ queryKey: ["challans"] });
  };
  const openMaterialReadySlip = () => {
    if (!selectedOrderId) return;
    window.open(logisticsService.getMaterialReadySlipUrl(selectedOrderId), "_blank");
  };

  const createChallanMutation = useMutation({
    mutationFn: () =>
      logisticsService.createChallan({
        customer_name: selected?.sales_order.customer_name || "",
        plant_id: selectedPlantId || "",
        sales_order_id: selectedOrderId,
        vehicle_no: vehicleNo,
        driver_name: driverName,
        driver_phone: driverPhone,
        transporter_name: transporterName,
        lr_number: lrNumber,
        e_way_bill_number: ewayBill,
        dispatch_notes: notes,
        ship_to_address_snapshot: {
          customer_name: selected?.sales_order.customer_name || "",
          sales_order_number: selected?.sales_order.order_number || "",
        },
        roll_ids: selectedRolls,
        gonny_ids: selectedGonnies,
      }),
    onSuccess: (data) => {
      toast({ title: "Challan created", description: data.message });
      setFinalizeOpen(false);
      setSelectedRolls([]);
      setSelectedGonnies([]);
      invalidate();
    },
    onError: (error) =>
      toast({
        title: "Challan failed",
        description: err(error),
        variant: "destructive",
      }),
  });

  const dispatchMutation = useMutation({
    mutationFn: (challanId: string) =>
      logisticsService.dispatchChallan(challanId),
    onSuccess: (data) => {
      toast({ title: "Dispatched", description: data.message });
      invalidate();
    },
    onError: (error) =>
      toast({
        title: "Dispatch failed",
        description: err(error),
        variant: "destructive",
      }),
  });

  const deliverMutation = useMutation({
    mutationFn: (challanId: string) =>
      logisticsService.updateChallanStatus(challanId, "DELIVERED"),
    onSuccess: (data) => {
      toast({ title: "Delivered", description: data.message });
      invalidate();
    },
    onError: (error) =>
      toast({
        title: "Delivery update failed",
        description: err(error),
        variant: "destructive",
      }),
  });

  const getReadyUnits = (row: any) =>
    Number(row.available_for_dispatch?.rolls_count || 0) +
    Number(row.available_for_dispatch?.gonnies_count || 0);
  const getGrossReady = (row: any) =>
    Number(
      row.available_for_dispatch?.rolls_gross_kg ||
        row.available_for_dispatch?.rolls_kg ||
        0,
    ) + Number(row.available_for_dispatch?.gonnies_gross_kg || 0);
  const getDispatchStatus = (row: any): Exclude<DispatchStatusFilter, "ALL"> =>
    getReadyUnits(row) > 0 ? "READY" : "WAITING";
  const customerOptions = Array.from(
    new Set(
      (board.data?.orders || [])
        .map((row) => row.sales_order.customer_name)
        .filter(Boolean),
    ),
  ).sort();

  const cards = (board.data?.orders || [])
    .filter((row) => {
      const term = search.trim().toLowerCase();
      const haystack =
        `${row.sales_order.order_number} ${row.sales_order.customer_name}`.toLowerCase();
      const ctn = Number(row.available_for_dispatch?.gonnies_count || 0);
      const roll = Number(row.available_for_dispatch?.rolls_count || 0);
      if (term && !haystack.includes(term)) return false;
      if (unitFilter === "CTN" && !ctn) return false;
      if (unitFilter === "ROLL" && !roll) return false;
      if (statusFilter !== "ALL" && getDispatchStatus(row) !== statusFilter)
        return false;
      if (
        customerFilter !== "ALL" &&
        row.sales_order.customer_name !== customerFilter
      )
        return false;
      return true;
    })
    .sort((a, b) => {
      if (sortMode === "GROSS_DESC") return getGrossReady(b) - getGrossReady(a);
      if (sortMode === "SO_ASC")
        return a.sales_order.order_number.localeCompare(
          b.sales_order.order_number,
        );
      if (sortMode === "CUSTOMER_ASC")
        return a.sales_order.customer_name.localeCompare(
          b.sales_order.customer_name,
        );
      return getReadyUnits(b) - getReadyUnits(a);
    });
  const queuePageCount = Math.max(1, Math.ceil(cards.length / QUEUE_PAGE_SIZE));
  const safeQueuePage = Math.min(queuePage, queuePageCount);
  const queueStartIndex = (safeQueuePage - 1) * QUEUE_PAGE_SIZE;
  const pagedCards = cards.slice(
    queueStartIndex,
    queueStartIndex + QUEUE_PAGE_SIZE,
  );
  const queueShownStart = cards.length ? queueStartIndex + 1 : 0;
  const queueShownEnd = Math.min(
    cards.length,
    queueStartIndex + pagedCards.length,
  );

  useEffect(() => {
    if (
      (!selectedOrderId ||
        !cards.some((row) => row.sales_order.id === selectedOrderId)) &&
      cards[0]?.sales_order?.id
    )
      setSelectedOrderId(cards[0].sales_order.id);
    if (selectedOrderId && !cards.length) setSelectedOrderId("");
  }, [cards, selectedOrderId]);

  useEffect(() => {
    setQueuePage(1);
  }, [search, unitFilter, statusFilter, customerFilter, sortMode]);

  useEffect(() => {
    setQueuePage((current) => Math.min(current, queuePageCount));
  }, [queuePageCount]);

  const selected = summary.data as SODispatchSummary | undefined;
  const selectedRollRows =
    selected?.rolls.filter((roll) => selectedRolls.includes(roll.id)) || [];
  const selectedGonnyRows =
    selected?.gonnies.filter((gonny) => selectedGonnies.includes(gonny.id)) ||
    [];
  const selectedPlantId =
    selectedRollRows[0]?.location?.plant_id ||
    selectedGonnyRows[0]?.location?.plant_id ||
    selected?.rolls[0]?.location?.plant_id ||
    selected?.gonnies[0]?.location?.plant_id ||
    "";
  const selectedGross =
    selectedRollRows.reduce(
      (sum, roll) => sum + Number(roll.gross_weight_kg || roll.weight_kg || 0),
      0,
    ) +
    selectedGonnyRows.reduce(
      (sum, gonny) =>
        sum + Number(gonny.gross_weight_kg || gonny.weight_kg || 0),
      0,
    );
  const selectedPcs = selectedGonnyRows.reduce(
    (sum, gonny) => sum + Number(gonny.qty_pcs || 0),
    0,
  );
  const history = (challans.data || []).filter((row) => {
    const term = historySearch.trim().toLowerCase();
    if (!term) return true;
    return `${row.dc_no} ${row.customer_name} ${row.sales_order__order_number} ${row.vehicle_no}`
      .toLowerCase()
      .includes(term);
  });
  const historyPageCount = Math.max(
    1,
    Math.ceil(history.length / HISTORY_PAGE_SIZE),
  );
  const safeHistoryPage = Math.min(historyPage, historyPageCount);
  const historyStartIndex = (safeHistoryPage - 1) * HISTORY_PAGE_SIZE;
  const pagedHistory = history.slice(
    historyStartIndex,
    historyStartIndex + HISTORY_PAGE_SIZE,
  );
  const historyShownStart = history.length ? historyStartIndex + 1 : 0;
  const historyShownEnd = Math.min(
    history.length,
    historyStartIndex + pagedHistory.length,
  );
  useEffect(() => {
    setHistoryPage(1);
  }, [historySearch]);

  useEffect(() => {
    setHistoryPage((current) => Math.min(current, historyPageCount));
  }, [historyPageCount]);

  const openChallans = history.filter(
    (row) => String(row.status || "").toUpperCase() === "DRAFT",
  ).length;
  const todayDispatches = history.filter(
    (row) =>
      row.dispatch_date &&
      new Date(row.dispatch_date).toDateString() === new Date().toDateString(),
  ).length;
  const podPendingRows = history.filter((row) =>
    ["DISPATCHED", "IN_TRANSIT"].includes(
      String(row.status || "").toUpperCase(),
    ),
  );
  const movingRows = history.filter((row) =>
    ["DISPATCHED", "IN_TRANSIT"].includes(
      String(row.status || "").toUpperCase(),
    ),
  );
  const readyGross =
    Number(
      board.data?.totals.ready_rolls_gross_kg ||
        board.data?.totals.ready_rolls_kg ||
        0,
    ) + Number(board.data?.totals.ready_gonnies_gross_kg || 0);
  const readyUnits =
    Number(board.data?.totals.ready_rolls || 0) +
    Number(board.data?.totals.ready_gonnies || 0);
  const selectedUnits = selectedRolls.length + selectedGonnies.length;
  const allSelectedUnits = [
    ...(selected?.gonnies || []).map((gonny) => {
      const net = Number(gonny.net_product_weight_kg || 0);
      const explicitTare =
        Number(gonny.inner_pack_tare_kg || 0) +
        Number(gonny.secondary_pack_tare_kg || 0) +
        Number(gonny.extras_tare_kg || 0);
      const gross = Number(gonny.gross_weight_kg || gonny.weight_kg || 0);
      const tare = explicitTare || Math.max(0, gross - net);
      return {
        id: gonny.id,
        unit: gonny.dispatch_unit_no || gonny.label_id,
        kind: "CTN" as const,
        customer: selected?.sales_order.customer_name || "",
        so: selected?.sales_order.order_number || "",
        product: gonny.product_name || "Pouch product",
        productCode: gonny.product_code || "",
        size: gonny.size_label || "-",
        layers: gonny.layers_label || "-",
        thickness: gonny.thickness_label || "-",
        grade: gonny.grade_label || "-",
        gross,
        tare,
        net,
        pcs: Number(gonny.qty_pcs || 0),
        selected: selectedGonnies.includes(gonny.id),
      };
    }),
    ...(selected?.rolls || []).map((roll) => {
      const net = Number(roll.net_weight_kg || roll.weight_kg || 0);
      const tare = Number(roll.tare_weight_kg || 0);
      const gross = Number(roll.gross_weight_kg || roll.weight_kg || net + tare);
      return {
        id: roll.id,
        unit: roll.dispatch_unit_no || roll.label_id,
        kind: "ROLL" as const,
        customer: selected?.sales_order.customer_name || "",
        so: selected?.sales_order.order_number || "",
        product: roll.product_name || roll.material__name || "Roll product",
        productCode: roll.product_code || "",
        size: roll.size_label || (roll.width_mm ? `${n(roll.width_mm, 0)}MM` : "-"),
        layers: roll.layers_label || "-",
        thickness: roll.thickness_label || "-",
        grade: roll.grade_label || "-",
        gross,
        tare,
        net,
        pcs: 0,
        selected: selectedRolls.includes(roll.id),
      };
    }),
  ];
  const orderReadyGross = allSelectedUnits.reduce(
    (sum, row) => sum + Number(row.gross || 0),
    0,
  );
  const orderReadyNet = allSelectedUnits.reduce(
    (sum, row) => sum + Number(row.net || 0),
    0,
  );
  const orderReadyPcs = allSelectedUnits.reduce(
    (sum, row) => sum + Number(row.pcs || 0),
    0,
  );
  const orderProductPreview = Array.from(
    new Set(
      allSelectedUnits
        .map((row) => row.product)
        .filter((value) => value && value !== "Roll product" && value !== "Pouch product"),
    ),
  ).slice(0, 3);
  const manifestPageCount = Math.max(
    1,
    Math.ceil(allSelectedUnits.length / MANIFEST_PAGE_SIZE),
  );
  const safeManifestPage = Math.min(manifestPage, manifestPageCount);
  const manifestStartIndex = (safeManifestPage - 1) * MANIFEST_PAGE_SIZE;
  const pagedManifestUnits = allSelectedUnits.slice(
    manifestStartIndex,
    manifestStartIndex + MANIFEST_PAGE_SIZE,
  );
  const manifestShownStart = allSelectedUnits.length
    ? manifestStartIndex + 1
    : 0;
  const manifestShownEnd = Math.min(
    allSelectedUnits.length,
    manifestStartIndex + pagedManifestUnits.length,
  );
  const selectedCapacity = Math.min(
    100,
    Math.round((selectedGross / 12000) * 100),
  );
  const routeCounts = (board.data?.orders || []).reduce(
    (acc, row) => {
      acc.roll += Number(row.available_for_dispatch.rolls_count || 0);
      acc.ctn += Number(row.available_for_dispatch.gonnies_count || 0);
      return acc;
    },
    { roll: 0, ctn: 0 },
  );
  const clearFilters = () => {
    setSearch("");
    setUnitFilter("ALL");
    setStatusFilter("ALL");
    setCustomerFilter("ALL");
    setSortMode("READY_DESC");
    setQueuePage(1);
  };

  const toggle = (
    id: string,
    list: string[],
    setter: (value: string[]) => void,
  ) => {
    setter(
      list.includes(id) ? list.filter((value) => value !== id) : [...list, id],
    );
  };

  const selectOrder = (id: string) => {
    setSelectedOrderId(id);
    setSelectedRolls([]);
    setSelectedGonnies([]);
    setManifestPage(1);
  };

  useEffect(() => {
    setManifestPage((current) => Math.min(current, manifestPageCount));
  }, [manifestPageCount]);

  return (
    <div
      className="mx-auto max-w-[1900px] space-y-4 p-4 lg:p-6"
      data-testid="dispatch-page"
    >
      <section className="overflow-hidden rounded-[22px] border border-order-border bg-gradient-to-br from-info-fg via-order-fg to-order-fg p-5 text-white shadow-xl ">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="text-[11px] font-black uppercase tracking-[0.24em] text-white/70">
              Operations · Dispatch Bay
            </div>
            <h1 className="mt-1 text-2xl font-black tracking-tight">
              Trip to dock to docs to load to ship.
            </h1>
            <p className="mt-1 max-w-3xl text-sm font-semibold leading-6 text-white/78">
              Every dispatch unit, whether gonny, carton, bundle, or unpacked
              roll, keeps its SO, customer, weight, batch, and label through
              challan creation and loading.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full border border-surface-1/20 bg-surface-1/10 px-3 py-1.5 text-xs font-black text-white shadow-sm backdrop-blur">
              {n(cards.length, 0)} orders shown
            </span>
            <span className="rounded-full border border-surface-1/20 bg-surface-1/10 px-3 py-1.5 text-xs font-black text-white shadow-sm backdrop-blur">
              {n(routeCounts.ctn, 0)} CTN
            </span>
            <span className="rounded-full border border-surface-1/20 bg-surface-1/10 px-3 py-1.5 text-xs font-black text-white shadow-sm backdrop-blur">
              {n(routeCounts.roll, 0)} ROLL
            </span>
          </div>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-8">
          <Tile
            label="Ready units"
            value={n(readyUnits, 0)}
            hint={`${n(board.data?.totals.ready_gonnies || 0, 0)} CTN · ${n(board.data?.totals.ready_rolls || 0, 0)} ROLL`}
          />
          <Tile
            label="Trips open"
            value={n(openChallans, 0)}
            hint="draft challans"
          />
          <Tile
            label="Loading now"
            value={n(
              history.filter((row) => row.status === "DISPATCHED").length,
              0,
            )}
            hint="sent docs"
          />
          <Tile
            label="Awaiting docs"
            value={n(openChallans, 0)}
            hint="need vehicle or LR"
          />
          <Tile
            label="Gross ready"
            value={`${n(readyGross)} kg`}
            hint="shipment weight"
          />
          <Tile
            label="Value out today"
            value={n(todayDispatches, 0)}
            hint="trips shipped"
          />
          <Tile
            label="Avg dock time"
            value={`${n(Math.max(12, selectedUnits * 9), 0)}m`}
            hint="selected tray"
          />
          <Tile label="On-time trips" value="Live" hint="7-day rolling" />
        </div>
      </section>

      <section className="sticky top-2 z-[1] rounded-[18px] border border-line bg-surface-1/95 p-3 shadow-sm backdrop-blur">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10px] font-black uppercase tracking-[0.22em] text-content-4">
              Filters
            </span>
            <select
              data-testid="dispatch-filter-unit"
              value={unitFilter}
              onChange={(event) =>
                setUnitFilter(event.target.value as DispatchUnitFilter)
              }
              className="h-9 rounded-full border border-line bg-surface-1 px-3 text-sm font-bold text-content-2 shadow-sm"
            >
              <option value="ALL">All units</option>
              <option value="CTN">CTN only</option>
              <option value="ROLL">Roll only</option>
            </select>
            <select
              data-testid="dispatch-filter-status"
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(event.target.value as DispatchStatusFilter)
              }
              className="h-9 rounded-full border border-line bg-surface-1 px-3 text-sm font-bold text-content-2 shadow-sm"
            >
              <option value="ALL">Status: any</option>
              <option value="READY">Ready</option>
              <option value="WAITING">Waiting</option>
            </select>
            <select
              data-testid="dispatch-filter-customer"
              value={customerFilter}
              onChange={(event) => setCustomerFilter(event.target.value)}
              className="h-9 max-w-[220px] rounded-full border border-line bg-surface-1 px-3 text-sm font-bold text-content-2 shadow-sm"
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
              onChange={(event) =>
                setSortMode(event.target.value as DispatchSortMode)
              }
              className="h-9 rounded-full border border-line bg-surface-1 px-3 text-sm font-bold text-content-2 shadow-sm"
            >
              <option value="READY_DESC">Ready units first</option>
              <option value="GROSS_DESC">Gross kg first</option>
              <option value="SO_ASC">SO number</option>
              <option value="CUSTOMER_ASC">Customer</option>
            </select>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="dispatch-filter-clear"
              onClick={clearFilters}
            >
              Clear
            </Button>
          </div>
          <div className="grid gap-2 xl:ml-auto xl:w-[620px] xl:grid-cols-[1fr_260px]">
            <div className="relative">
              <Search className="absolute left-4 top-3.5 h-4 w-4 text-content-4" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search SO, carton, bundle, roll..."
                className="h-12 rounded-2xl border-line bg-surface-1 pl-10 shadow-sm"
              />
            </div>
            <Select value={selectedOrderId} onValueChange={selectOrder}>
              <SelectTrigger
                data-testid="dispatch-sales-order-select"
                className="h-12 rounded-2xl border-line bg-surface-1 shadow-sm"
              >
                <SelectValue placeholder="Select sales order" />
              </SelectTrigger>
              <SelectContent>
                {cards.map((row) => (
                  <SelectItem
                    key={row.sales_order.id}
                    value={row.sales_order.id}
                  >
                    {row.sales_order.order_number} •{" "}
                    {row.sales_order.customer_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(280px,360px)_minmax(0,1fr)] 2xl:grid-cols-[minmax(280px,320px)_minmax(820px,1fr)_minmax(260px,300px)]">
        <aside className="space-y-4 xl:col-span-2 2xl:col-span-1">
          <div className="rounded-[18px] border border-line bg-surface-1 p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="text-base font-black text-content-1">
                  Ready units · {n(readyUnits, 0)}
                </h3>
                <div className="text-[10px] font-black uppercase tracking-[0.24em] text-content-4">
                  pick a sales order, then select units
                </div>
              </div>
            </div>
            <div className="mb-3 flex flex-wrap gap-2">
              <button
                type="button"
                data-testid="dispatch-unit-filter-all"
                onClick={() => setUnitFilter("ALL")}
                className={`rounded-full border px-3 py-1.5 text-sm font-black transition ${unitFilter === "ALL" ? "border-order-border bg-order-bg text-order-fg" : "border-line bg-surface-1 text-content-2 hover:border-order-border"}`}
              >
                All {n(readyUnits, 0)}
              </button>
              <button
                type="button"
                data-testid="dispatch-unit-filter-ctn"
                onClick={() => setUnitFilter("CTN")}
                className={`rounded-full border px-3 py-1.5 text-sm font-black transition ${unitFilter === "CTN" ? "border-warning-border bg-warm text-warm" : "border-warning-border bg-surface-1 text-content-2 hover:bg-warm"}`}
              >
                CTN {n(routeCounts.ctn, 0)}
              </button>
              <button
                type="button"
                data-testid="dispatch-unit-filter-roll"
                onClick={() => setUnitFilter("ROLL")}
                className={`rounded-full border px-3 py-1.5 text-sm font-black transition ${unitFilter === "ROLL" ? "border-info-border bg-info-bg text-info-fg" : "border-info-border bg-surface-1 text-content-2 hover:bg-info-bg"}`}
              >
                ROLL {n(routeCounts.roll, 0)}
              </button>
            </div>
            <div className="max-h-[calc(100dvh-400px)] space-y-2 overflow-y-auto overscroll-contain pr-1">
              {pagedCards.map((row) => {
                const units =
                  Number(row.available_for_dispatch.rolls_count || 0) +
                  Number(row.available_for_dispatch.gonnies_count || 0);
                const gross =
                  Number(
                    row.available_for_dispatch.rolls_gross_kg ||
                      row.available_for_dispatch.rolls_kg ||
                      0,
                  ) + Number(row.available_for_dispatch.gonnies_gross_kg || 0);
                const pending =
                  Number(row.packing_pending?.open_gonnies_count || 0) +
                  Number(row.packing_pending?.unpacked_batch_count || 0) +
                  Number(row.packing_pending?.unreleased_rolls_count || 0);
                return (
                  <button
                    key={row.sales_order.id}
                    data-testid="dispatch-order-card"
                    data-unit-roll={
                      Number(row.available_for_dispatch.rolls_count || 0) > 0
                        ? "true"
                        : "false"
                    }
                    data-unit-ctn={
                      Number(row.available_for_dispatch.gonnies_count || 0) > 0
                        ? "true"
                        : "false"
                    }
                    data-status={getDispatchStatus(row)}
                    data-customer={row.sales_order.customer_name}
                    onClick={() => selectOrder(row.sales_order.id)}
                    className={`relative w-full overflow-hidden rounded-[14px] border p-4 text-left shadow-sm transition ${selectedOrderId === row.sales_order.id ? "border-order-border bg-gradient-to-b from-order-bg to-white" : "border-line bg-surface-1 hover:-translate-y-0.5 hover:border-order-border"}`}
                  >
                    <span
                      className={`absolute inset-y-0 left-0 w-1 ${units ? "bg-success-fg" : "bg-warning-fg"}`}
                    />
                    <div className="pl-1">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-mono text-sm font-black text-content-1">
                            {row.sales_order.order_number}
                          </div>
                          <div className="mt-0.5 line-clamp-1 text-sm font-black text-content-1">
                            {row.sales_order.customer_name}
                          </div>
                        </div>
                        <Chip tone={units ? "green" : "amber"}>
                          {units ? "ready" : "waiting"}
                        </Chip>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        <Chip tone="ctn">
                          CTN{" "}
                          {n(row.available_for_dispatch.gonnies_count || 0, 0)}
                        </Chip>
                        <Chip tone="roll">
                          ROLL{" "}
                          {n(row.available_for_dispatch.rolls_count || 0, 0)}
                        </Chip>
                        <Chip tone="blue">{n(gross)} kg</Chip>
                      </div>
                      <div className="mt-3 flex items-center justify-between text-[11px] font-semibold text-content-3">
                        <span>{pending} still in packing</span>
                        <span>{units} ready</span>
                      </div>
                    </div>
                  </button>
                );
              })}
              {!cards.length && (
                <div className="rounded-[14px] border border-dashed border-line p-8 text-center text-sm font-semibold text-content-3">
                  No dispatch-ready orders found.
                </div>
              )}
            </div>
            <div className="mt-3 rounded-[14px] border border-line bg-surface-1 p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div
                  data-testid="dispatch-queue-total"
                  className="text-xs font-bold text-content-3"
                >
                  Showing {queueShownStart}-{queueShownEnd} of {cards.length}{" "}
                  orders
                </div>
                <Pager
                  page={safeQueuePage}
                  pageCount={queuePageCount}
                  onPageChange={setQueuePage}
                  testId="dispatch-queue-page"
                />
              </div>
            </div>
          </div>

          <div className="rounded-[18px] border border-line bg-surface-1 p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-black text-content-1">
                Open trips · {n(openChallans, 0)}
              </h3>
              <Chip tone="blue">Drafts</Chip>
            </div>
            <div className="mt-3 space-y-2">
              {history.slice(0, 4).map((row) => (
                <div
                  key={row.id}
                  className="rounded-[14px] border border-line p-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="font-mono text-sm font-black">
                      {row.dc_no}
                    </div>
                    <Chip tone={row.status === "DRAFT" ? "amber" : "green"}>
                      {row.status}
                    </Chip>
                  </div>
                  <div className="mt-1 text-xs font-semibold text-content-3">
                    {row.vehicle_no || "Vehicle pending"} · {row.customer_name}
                  </div>
                </div>
              ))}
              {!history.length && (
                <div className="text-sm font-semibold text-content-3">
                  No trips yet.
                </div>
              )}
            </div>
          </div>
        </aside>

        <main className="min-w-0 space-y-4">
          {!selected ? (
            <div className="rounded-[18px] border border-dashed border-line-strong bg-surface-1 p-12 text-center">
              <Truck className="mx-auto h-10 w-10 text-content-4" />
              <h2 className="mt-3 text-xl font-black">Select a ready order.</h2>
              <p className="mt-2 text-sm font-semibold text-content-3">
                Dispatch Bay only shows units explicitly released from Packing
                Yard.
              </p>
            </div>
          ) : (
            <>
              <div className="rounded-[18px] border border-order-border bg-order-bg p-5 shadow-sm">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.28em] text-order-fg">
                      Sales order details
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <h2 className="text-2xl font-black tracking-tight text-content-1">
                        {selected.sales_order.order_number}
                      </h2>
                      <Chip tone="blue">{selected.sales_order.status}</Chip>
                      <Chip tone="green">{allSelectedUnits.length} ready units</Chip>
                    </div>
                    <p className="mt-1 max-w-3xl text-sm font-semibold text-content-3">
                      {selected.sales_order.customer_name}
                      {orderProductPreview.length
                        ? ` · ${orderProductPreview.join(" · ")}`
                        : ""}
                    </p>
                  </div>
                  <div className="grid min-w-[340px] grid-cols-2 gap-2">
                    <MiniMetric
                      label="Selected"
                      value={n(selectedUnits, 0)}
                      hint="units"
                    />
                    <MiniMetric
                      label="Selected gross"
                      value={`${n(selectedGross)} kg`}
                      hint="truck weight"
                    />
                  </div>
                </div>
                <div className="mt-4 grid gap-2 md:grid-cols-3 xl:grid-cols-6">
                  <div className="rounded-[12px] border border-line bg-surface-1 p-3">
                    <div className="text-[10px] font-black uppercase tracking-[0.22em] text-content-4">
                      Ready gross
                    </div>
                    <div className="mt-1 font-mono font-black">{n(orderReadyGross)} kg</div>
                    <div className="text-xs font-semibold text-content-3">
                      all released units
                    </div>
                  </div>
                  <div className="rounded-[12px] border border-line bg-surface-1 p-3">
                    <div className="text-[10px] font-black uppercase tracking-[0.22em] text-content-4">
                      Ready net
                    </div>
                    <div className="mt-1 font-mono font-black">{n(orderReadyNet)} kg</div>
                    <div className="text-xs font-semibold text-content-3">
                      product weight
                    </div>
                  </div>
                  <div className="rounded-[12px] border border-line bg-surface-1 p-3">
                    <div className="text-[10px] font-black uppercase tracking-[0.22em] text-content-4">
                      Ready pcs
                    </div>
                    <div className="mt-1 font-mono font-black">{n(orderReadyPcs, 0)}</div>
                    <div className="text-xs font-semibold text-content-3">
                      pouch count
                    </div>
                  </div>
                  <div className="rounded-[12px] border border-line bg-surface-1 p-3">
                    <div className="text-[10px] font-black uppercase tracking-[0.22em] text-content-4">
                      Ordered
                    </div>
                    <div className="mt-1 font-mono font-black">{n(selected.ordered_qty)}</div>
                    <div className="text-xs font-semibold text-content-3">
                      sales quantity
                    </div>
                  </div>
                  <div className="rounded-[12px] border border-line bg-surface-1 p-3">
                    <div className="text-[10px] font-black uppercase tracking-[0.22em] text-content-4">
                      Produced
                    </div>
                    <div className="mt-1 font-mono font-black">
                      {n(selected.produced_qty.rolls_kg)} kg
                    </div>
                    <div className="text-xs font-semibold text-content-3">
                      {n(selected.produced_qty.batches_pcs, 0)} pcs
                    </div>
                  </div>
                  <div className="rounded-[12px] border border-line bg-surface-1 p-3">
                    <div className="text-[10px] font-black uppercase tracking-[0.22em] text-content-4">
                      Pending
                    </div>
                    <div className="mt-1 font-mono font-black">
                      {n(selected.packing_pending?.unreleased_rolls_count || 0, 0)}
                    </div>
                    <div className="text-xs font-semibold text-content-3">
                      unreleased rolls
                    </div>
                  </div>
                </div>
              </div>

              <div className="overflow-hidden rounded-[18px] border border-line bg-surface-1 shadow-sm">
                <div className="flex flex-col gap-3 border-b border-line p-5 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h3 className="text-base font-black text-content-1">
                      Manifest ·{" "}
                      {selectedUnits ||
                        selected.rolls.length + selected.gonnies.length}{" "}
                      units
                    </h3>
                    <div className="text-[10px] font-black uppercase tracking-[0.24em] text-content-4">
                      select rows to build challan · rolls and gonnies are equal
                      dispatch units
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      data-testid="dispatch-material-ready-slip"
                      disabled={!selectedOrderId || !allSelectedUnits.length}
                      onClick={openMaterialReadySlip}
                    >
                      <Printer className="mr-1.5 h-3.5 w-3.5" /> Ready slip
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      data-testid="dispatch-select-all-units"
                      disabled={!allSelectedUnits.length}
                      onClick={() => {
                        const rollIds = (selected?.rolls || []).map(
                          (roll) => roll.id,
                        );
                        const gonnyIds = (selected?.gonnies || []).map(
                          (gonny) => gonny.id,
                        );
                        const allAlreadySelected =
                          selectedRolls.length === rollIds.length &&
                          selectedGonnies.length === gonnyIds.length;
                        setSelectedRolls(allAlreadySelected ? [] : rollIds);
                        setSelectedGonnies(allAlreadySelected ? [] : gonnyIds);
                      }}
                    >
                      {selectedUnits ? "Clear selection" : "Select all units"}
                    </Button>
                    <Chip tone="green">Released only</Chip>
                    <Chip tone="blue">SO locked</Chip>
                  </div>
                </div>
                <div className="max-h-[640px] overflow-auto">
                  <table className="w-full min-w-[1180px] text-sm">
                    <thead className="sticky top-0 bg-surface-2 text-[10px] uppercase tracking-[0.22em] text-content-4">
                      <tr>
                        <th className="px-4 py-3 text-left">#</th>
                        <th className="text-left">Unit</th>
                        <th className="text-left">Product</th>
                        <th className="text-left">Size</th>
                        <th className="text-left">Layers · THK</th>
                        <th className="text-right">Gross</th>
                        <th className="text-right">Tare</th>
                        <th className="text-right">Net</th>
                        <th className="text-right">PCS</th>
                        <th className="px-4 text-right">State</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {pagedManifestUnits.map((unit, index) => (
                        <tr
                          key={unit.id}
                          className={
                            unit.selected
                              ? unit.kind === "ROLL"
                                ? "bg-info-bg"
                                : "bg-success-bg"
                              : ""
                          }
                        >
                          <td className="px-4 py-4 font-mono">
                            {manifestStartIndex + index + 1}
                          </td>
                          <td>
                            <button
                              data-testid={
                                unit.kind === "ROLL"
                                  ? `dispatch-roll-checkbox-${unit.id}`
                                  : `dispatch-gonny-checkbox-${unit.id}`
                              }
                              onClick={() =>
                                unit.kind === "ROLL"
                                  ? toggle(
                                      unit.id,
                                      selectedRolls,
                                      setSelectedRolls,
                                    )
                                  : toggle(
                                      unit.id,
                                      selectedGonnies,
                                      setSelectedGonnies,
                                    )
                              }
                              className="flex items-center gap-2 text-left"
                            >
                              <Chip
                                tone={unit.kind === "ROLL" ? "roll" : "ctn"}
                              >
                                {unit.kind}
                              </Chip>
                              <span className="break-all font-mono font-black">
                                {unit.unit}
                              </span>
                            </button>
                          </td>
                          <td>
                            <div className="max-w-[260px] font-black text-content-1">
                              {unit.product}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-1">
                              <Chip tone={unit.kind === "ROLL" ? "roll" : "ctn"}>
                                {unit.kind === "ROLL" ? "ROLL" : "POUCH"}
                              </Chip>
                              {unit.productCode && (
                                <span className="font-mono text-[11px] font-bold text-content-3">
                                  {unit.productCode}
                                </span>
                              )}
                            </div>
                          </td>
                          <td>
                            <div className="font-mono font-black">{unit.size}</div>
                            <div className="text-xs font-semibold text-content-3">
                              {unit.so}
                            </div>
                          </td>
                          <td>
                            <div className="font-black">{unit.layers}</div>
                            <div className="flex flex-wrap gap-1 text-xs font-semibold text-content-3">
                              <span>
                                {unit.thickness !== "-" ? `${unit.thickness} micron` : "thickness -"}
                              </span>
                              {unit.grade && unit.grade !== "-" && (
                                <span>· {unit.grade}</span>
                              )}
                            </div>
                          </td>
                          <td className="text-right font-mono font-black">
                            {n(unit.gross)} kg
                          </td>
                          <td className="text-right font-mono">
                            {n(unit.tare)} kg
                          </td>
                          <td className="text-right font-mono font-black">
                            {n(unit.net)} kg
                          </td>
                          <td className="text-right font-mono font-black">
                            {unit.pcs ? n(unit.pcs, 0) : "-"}
                          </td>
                          <td className="px-4 text-right text-success-fg">
                            {unit.selected ? "selected" : "ready"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!allSelectedUnits.length && (
                    <div className="p-10 text-center text-sm font-semibold text-content-3">
                      No released units are waiting for this order.
                    </div>
                  )}
                </div>
                <div className="border-t border-line bg-surface-2 p-5">
                  <div className="mb-3 flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                    <span>
                      <b>Totals:</b> {n(selectedGross)} kg · {n(selectedPcs, 0)}{" "}
                      pcs · {selectedUnits} selected
                    </span>
                    <span
                      data-testid="dispatch-manifest-total"
                      className="text-xs font-semibold text-content-3"
                    >
                      Showing {manifestShownStart}-{manifestShownEnd} of{" "}
                      {allSelectedUnits.length} units · Capacity{" "}
                      {selectedCapacity}%
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-surface-1">
                    <span
                      className="block h-full rounded-full bg-primary"
                      style={{ width: `${selectedCapacity}%` }}
                    />
                  </div>
                  <div className="mt-3 flex justify-end">
                    <Pager
                      page={safeManifestPage}
                      pageCount={manifestPageCount}
                      onPageChange={setManifestPage}
                      testId="dispatch-manifest-page"
                    />
                  </div>
                </div>
              </div>

              <div className="sticky bottom-3 rounded-[18px] border border-line bg-surface-1/95 p-4 shadow-xl backdrop-blur">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="text-sm font-bold text-content-3">
                    Finalize challan for {selectedUnits} selected units ·{" "}
                    {n(selectedGross)} kg gross.
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    data-testid="dispatch-ready-slip-sticky"
                    disabled={!selectedOrderId || !allSelectedUnits.length}
                    onClick={openMaterialReadySlip}
                  >
                    <Printer className="mr-2 h-4 w-4" /> Ready slip
                  </Button>
                  <Button
                    data-testid="dispatch-create-trigger"
                    disabled={!selectedPlantId || selectedUnits === 0}
                    onClick={() => setFinalizeOpen(true)}
                  >
                    <Send className="mr-2 h-4 w-4" /> Create challan
                  </Button>
                </div>
              </div>
            </>
          )}
        </main>

        <aside className="space-y-4">
          <div className="rounded-[18px] border border-line bg-surface-1 p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-black text-content-1">
                In-transit · {n(movingRows.length, 0)}
              </h3>
              <span className="font-mono text-[10px] font-bold text-content-4">
                live GPS
              </span>
            </div>
            <div className="mt-3 space-y-2">
              {movingRows.slice(0, 3).map((row, index) => (
                <div
                  key={row.id}
                  className="rounded-[12px] border border-line p-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="font-mono text-sm font-black">
                      {row.dc_no}
                    </div>
                    <Chip tone="blue">{String(row.status).toLowerCase()}</Chip>
                  </div>
                  <div className="mt-1 flex items-center gap-1 text-xs font-semibold text-content-3">
                    <MapPin className="h-3 w-3" /> {row.vehicle_no || "vehicle"}{" "}
                    · ETA today
                  </div>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
                    <span
                      className={`block h-full rounded-full ${index === 1 ? "bg-order-fg" : "bg-success-fg"}`}
                      style={{ width: `${58 + index * 12}%` }}
                    />
                  </div>
                </div>
              ))}
              {!movingRows.length && (
                <div className="text-sm font-semibold text-content-3">
                  No trips in transit.
                </div>
              )}
            </div>
          </div>

          <div className="rounded-[18px] border border-line bg-surface-1 p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-black text-content-1">POD inbox</h3>
              <Chip tone="green">{n(podPendingRows.length, 0)}</Chip>
            </div>
            <div className="mt-3 space-y-2">
              {podPendingRows.slice(0, 2).map((row) => (
                <div
                  key={row.id}
                  className="rounded-[12px] border border-line p-3"
                >
                  <div className="font-mono text-sm font-black">
                    {row.dc_no}
                  </div>
                  <div className="mt-1 text-xs font-semibold text-content-3">
                    {row.customer_name} · driver photo + signed LR
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    data-testid={`dispatch-deliver-${row.id}`}
                    disabled={deliverMutation.isPending}
                    onClick={() => deliverMutation.mutate(row.id)}
                    className="mt-2 h-8"
                  >
                    Mark delivered
                  </Button>
                </div>
              ))}
              {!podPendingRows.length && (
                <div className="rounded-[12px] border border-dashed border-line p-4 text-sm font-semibold text-content-3">
                  No pending POD. Delivered trips stay in dispatch history.
                </div>
              )}
            </div>
          </div>

          <div className="rounded-[18px] border border-order-border bg-order-bg p-5 shadow-sm">
            <h3 className="text-base font-black text-content-1">
              Today outbound
            </h3>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <MiniMetric label="Kg out" value={`${n(readyGross)} kg`} />
              <MiniMetric label="Trips" value={n(todayDispatches, 0)} />
              <MiniMetric label="Customers" value={n(cards.length, 0)} />
              <MiniMetric label="Selected" value={n(selectedUnits, 0)} />
            </div>
          </div>

          <div className="rounded-[18px] border border-line bg-surface-1 p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black text-content-1">
                Dispatch history
              </h3>
              <FileText className="h-4 w-4 text-content-3" />
            </div>
            <Input
              data-testid="dispatch-history-search"
              value={historySearch}
              onChange={(event) => setHistorySearch(event.target.value)}
              placeholder="Search challan..."
              className="mt-3 rounded-xl"
            />
            <div className="mt-3 max-h-[360px] space-y-2 overflow-y-auto overscroll-contain pr-1">
              {pagedHistory.map((row: DeliveryChallan) => (
                <div
                  key={row.id}
                  data-testid={`dispatch-challan-row-${row.id}`}
                  className="rounded-[12px] border border-line p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-mono text-sm font-black">
                      {row.dc_no}
                    </div>
                    <Chip tone={row.status === "DRAFT" ? "amber" : "green"}>
                      {row.status}
                    </Chip>
                  </div>
                  <div className="mt-1 text-xs font-semibold text-content-3">
                    {row.customer_name} · {row.vehicle_no || "vehicle pending"}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      data-testid={`dispatch-print-${row.id}`}
                      onClick={() =>
                        window.open(
                          logisticsService.getChallanPrintUrl(row.id),
                          "_blank",
                        )
                      }
                    >
                      <Printer className="mr-1 h-3 w-3" /> Print
                    </Button>
                    {row.status === "DRAFT" && (
                      <Button
                        size="sm"
                        data-testid={`dispatch-send-${row.id}`}
                        onClick={() => dispatchMutation.mutate(row.id)}
                      >
                        Dispatch
                      </Button>
                    )}
                    {["DISPATCHED", "IN_TRANSIT"].includes(
                      String(row.status || "").toUpperCase(),
                    ) && (
                      <Button
                        size="sm"
                        variant="outline"
                        data-testid={`dispatch-deliver-history-${row.id}`}
                        disabled={deliverMutation.isPending}
                        onClick={() => deliverMutation.mutate(row.id)}
                      >
                        Mark delivered
                      </Button>
                    )}
                  </div>
                  <div className="mt-3 hidden min-w-[360px] items-center sm:flex">
                    {lifecycle(row.status)}
                  </div>
                </div>
              ))}
              {!history.length && (
                <div className="rounded-[12px] border border-dashed border-line p-6 text-center text-sm font-semibold text-content-3">
                  No challans match this search.
                </div>
              )}
            </div>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div
                data-testid="dispatch-history-total"
                className="text-xs font-bold text-content-3"
              >
                Showing {historyShownStart}-{historyShownEnd} of{" "}
                {history.length} challans
              </div>
              <Pager
                page={safeHistoryPage}
                pageCount={historyPageCount}
                onPageChange={setHistoryPage}
                testId="dispatch-history-page"
              />
            </div>
          </div>
        </aside>
      </section>

      <Dialog open={finalizeOpen} onOpenChange={setFinalizeOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Finalize dispatch challan</DialogTitle>
          </DialogHeader>
          <div className="rounded-3xl border border-info-border bg-info-bg p-4 text-sm">
            <div className="grid gap-3 md:grid-cols-4">
              <div>
                <b>{selected?.sales_order.order_number || "-"}</b>
                <br />
                Sales order
              </div>
              <div>
                <b>{selected?.sales_order.customer_name || "-"}</b>
                <br />
                Customer
              </div>
              <div>
                <b>{selectedUnits}</b>
                <br />
                Units
              </div>
              <div>
                <b>{n(selectedGross)}</b>
                <br />
                Gross kg
              </div>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <Label>Vehicle number</Label>
              <Input
                value={vehicleNo}
                onChange={(event) => setVehicleNo(event.target.value)}
                placeholder="MH-XX-AB-XXXX"
              />
            </div>
            <div>
              <Label>Transporter</Label>
              <Input
                value={transporterName}
                onChange={(event) => setTransporterName(event.target.value)}
                placeholder="Transporter name"
              />
            </div>
            <div>
              <Label>Driver name</Label>
              <Input
                value={driverName}
                onChange={(event) => setDriverName(event.target.value)}
              />
            </div>
            <div>
              <Label>Driver phone</Label>
              <Input
                value={driverPhone}
                onChange={(event) => setDriverPhone(event.target.value)}
              />
            </div>
            <div>
              <Label>LR number</Label>
              <Input
                value={lrNumber}
                onChange={(event) => setLrNumber(event.target.value)}
              />
            </div>
            <div>
              <Label>E-way bill</Label>
              <Input
                value={ewayBill}
                onChange={(event) => setEwayBill(event.target.value)}
              />
            </div>
            <div className="md:col-span-2">
              <Label>Dispatch notes</Label>
              <Textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
            </div>
          </div>
          <div className="rounded-3xl bg-surface-2 p-4 text-sm">
            <b>Selected units:</b> {selectedRolls.length} rolls,{" "}
            {selectedGonnies.length} gonnies · {n(selectedGross)} kg gross ·{" "}
            {n(selectedPcs, 0)} pcs
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFinalizeOpen(false)}>
              Cancel
            </Button>
            <Button
              data-testid="dispatch-create-submit"
              disabled={!selectedPlantId || createChallanMutation.isPending}
              onClick={() => createChallanMutation.mutate()}
            >
              {createChallanMutation.isPending
                ? "Creating..."
                : "Create challan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

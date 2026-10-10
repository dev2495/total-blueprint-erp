"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  CircleCheck,
  Download,
  FileText,
  Layers,
  MapPin,
  PackageOpen,
  Printer,
  RefreshCw,
  Search,
  Send,
  Truck,
} from "lucide-react";

import { GATE_QR_STICKER_HINT, PrintGateQrLabelButton, useGateQrLabelAccess } from "@/components/gate/print-qr-label-button";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { cn } from "@/lib/utils";
import {
  HeroChip,
  HeroStat,
  HeroStats,
  PageHero,
  Panel,
  PanelEmpty,
  heroButtonClass,
} from "@/components/premium";
import {
  ActionBar,
  FilterGroup,
  ManifestTable,
  OrderMetric,
  Pager,
  Pill,
  ProductSpecCell,
  SelectBox,
  StagePill,
  Td,
  Th,
  UnitCell,
  WeightStack,
  apiError as err,
  clean,
  kgText as kg,
  lineScopeKey,
  lineScopeName,
  lineScopeSpec,
  num as n,
  titleCase,
  toolbarSelectClass,
} from "@/components/logistics/yard-ui";
import {
  logisticsService,
  type DeliveryChallan,
  type SODispatchSummary,
} from "@/services/logistics";

const QUEUE_PAGE_SIZE = 8;
const HISTORY_PAGE_SIZE = 6;
const MANIFEST_PAGE_SIZE = 10;
type DispatchUnitFilter = "ALL" | "CTN" | "ROLL";
type DispatchStatusFilter = "ALL" | "READY" | "WAITING";
type DispatchSortMode = "READY_DESC" | "SO_ASC" | "CUSTOMER_ASC" | "GROSS_DESC";

const LIFECYCLE = ["DRAFT", "DISPATCHED", "IN_TRANSIT", "DELIVERED"] as const;

function Lifecycle({ status }: { status: string }) {
  const current = String(status || "DRAFT").toUpperCase();
  const active = Math.max(0, LIFECYCLE.indexOf(current as (typeof LIFECYCLE)[number]));
  return (
    <ol className="flex items-center gap-1.5" aria-label={`Challan status ${titleCase(current)}`}>
      {LIFECYCLE.map((stage, index) => (
        <li key={stage} className="flex items-center gap-1.5">
          <span
            className={cn(
              "grid h-5 w-5 place-items-center rounded-full text-[10px] font-semibold",
              index <= active ? "bg-success-fg text-white" : "bg-surface-2 text-content-4 ring-1 ring-line",
            )}
            title={titleCase(stage)}
          >
            {index < active || current === "DELIVERED" ? <Check className="h-3 w-3" strokeWidth={3} /> : index + 1}
          </span>
          <span className={cn("hidden text-[11px] 2xl:inline", index <= active ? "text-content-2" : "text-content-4")}>
            {titleCase(stage)}
          </span>
          {index < LIFECYCLE.length - 1 ? (
            <span className={cn("h-px w-3 2xl:w-5", index < active ? "bg-success-fg" : "bg-line")} aria-hidden />
          ) : null}
        </li>
      ))}
    </ol>
  );
}

const challanTone = (status: string) => {
  const s = String(status || "").toUpperCase();
  if (s === "DRAFT") return "warn" as const;
  if (s === "DELIVERED") return "good" as const;
  if (s === "CANCELLED") return "bad" as const;
  return "info" as const;
};

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
  const [podChallan, setPodChallan] = useState<DeliveryChallan | null>(null);
  const [podReceivedBy, setPodReceivedBy] = useState("");
  const [podReference, setPodReference] = useState("");
  const [podNotes, setPodNotes] = useState("");
  const [notes, setNotes] = useState("");
  const [transporterName, setTransporterName] = useState("");
  const [dispatchLocation, setDispatchLocation] = useState("");
  const [queuePage, setQueuePage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const [manifestPage, setManifestPage] = useState(1);
  const [lineFilter, setLineFilter] = useState("ALL");
  const qrStickers = useGateQrLabelAccess();

  const board = useQuery({
    queryKey: ["dispatch-board"],
    queryFn: ({ signal }) => logisticsService.getDispatchBoard(signal),
    refetchInterval: 30000,
  });
  const summary = useQuery({
    queryKey: ["dispatch-summary", selectedOrderId],
    queryFn: ({ signal }) => logisticsService.getSODispatchableItems(selectedOrderId, signal),
    enabled: Boolean(selectedOrderId),
    placeholderData: undefined,
  });
  const challans = useQuery({
    queryKey: ["challans"],
    queryFn: () => logisticsService.getChallans(),
    refetchInterval: 60000,
  });

  const invalidate = async (orderId = selectedOrderId) => {
    const summaryKey = ["dispatch-summary", orderId] as const;
    await queryClient.cancelQueries({ queryKey: summaryKey, exact: true });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["dispatch-board"] }),
      queryClient.invalidateQueries({ queryKey: summaryKey, exact: true }),
      queryClient.invalidateQueries({ queryKey: ["challans"] }),
      queryClient.invalidateQueries({ queryKey: ["packing-board"] }),
    ]);
  };

  const downloadEpsonJob = async (url: string) => {
    try {
      const response = await fetch(url, {
        credentials: "include",
        headers: { Accept: "application/vnd.totalpolyprint.epson-raw" },
      });
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
      toast({
        title: "Epson job downloaded",
        description: "The Windows helper prints one 10 × 6-inch form in NLQ mode with no browser scaling.",
      });
    } catch (error) {
      toast({ title: "Epson print failed", description: err(error), variant: "destructive" });
    }
  };

  const createChallanMutation = useMutation({
    mutationFn: () =>
      logisticsService.createChallan({
        customer_name: selected?.sales_order.customer_name || "",
        plant_id: selectedPlantId || "",
        sales_order_id: selectedOrderId,
        transporter_name: transporterName.trim(),
        dispatch_notes: notes,
        ship_to_address_snapshot: { location: dispatchLocation.trim() },
        roll_ids: selectedRolls,
        gonny_ids: selectedGonnies,
      }),
    onSuccess: async (data) => {
      toast({ title: "Challan created", description: data.message });
      setFinalizeOpen(false);
      setSelectedRolls([]);
      setSelectedGonnies([]);
      setTransporterName("");
      setDispatchLocation("");
      setNotes("");
      await invalidate(selectedOrderId);
    },
    onError: (error) => toast({ title: "Challan failed", description: err(error), variant: "destructive" }),
  });

  const dispatchMutation = useMutation({
    mutationFn: (challanId: string) => logisticsService.dispatchChallan(challanId),
    onSuccess: (data) => {
      toast({ title: "Dispatched", description: data.message });
      invalidate();
    },
    onError: (error) => toast({ title: "Dispatch failed", description: err(error), variant: "destructive" }),
  });

  const deliverMutation = useMutation({
    mutationFn: () => {
      if (!podChallan) throw new Error("Select a dispatch slip first.");
      return logisticsService.confirmPOD(podChallan.id, {
        received_by: podReceivedBy,
        reference: podReference,
        notes: podNotes,
      });
    },
    onSuccess: (data) => {
      toast({ title: data.order_closed ? "POD confirmed · order closed" : "POD confirmed", description: data.message });
      setPodChallan(null);
      setPodReceivedBy("");
      setPodReference("");
      setPodNotes("");
      invalidate();
    },
    onError: (error) => toast({ title: "POD confirmation failed", description: err(error), variant: "destructive" }),
  });

  const getReadyUnits = (row: any) =>
    Number(row.available_for_dispatch?.rolls_count || 0) + Number(row.available_for_dispatch?.gonnies_count || 0);
  const getGrossReady = (row: any) =>
    Number(row.available_for_dispatch?.rolls_gross_kg || row.available_for_dispatch?.rolls_kg || 0) +
    Number(row.available_for_dispatch?.gonnies_gross_kg || 0);
  const getDispatchStatus = (row: any): Exclude<DispatchStatusFilter, "ALL"> =>
    getReadyUnits(row) > 0 ? "READY" : "WAITING";
  const customerOptions = useMemo(
    () =>
      Array.from(new Set((board.data?.orders || []).map((row) => row.sales_order.customer_name).filter(Boolean))).sort(),
    [board.data?.orders],
  );

  const cards = (board.data?.orders || [])
    .filter((row) => {
      const term = search.trim().toLowerCase();
      const haystack = `${row.sales_order.order_number} ${row.sales_order.customer_name}`.toLowerCase();
      const ctn = Number(row.available_for_dispatch?.gonnies_count || 0);
      const roll = Number(row.available_for_dispatch?.rolls_count || 0);
      if (term && !haystack.includes(term)) return false;
      if (unitFilter === "CTN" && !ctn) return false;
      if (unitFilter === "ROLL" && !roll) return false;
      if (statusFilter !== "ALL" && getDispatchStatus(row) !== statusFilter) return false;
      if (customerFilter !== "ALL" && row.sales_order.customer_name !== customerFilter) return false;
      return true;
    })
    .sort((a, b) => {
      if (sortMode === "GROSS_DESC") return getGrossReady(b) - getGrossReady(a);
      if (sortMode === "SO_ASC") return a.sales_order.order_number.localeCompare(b.sales_order.order_number);
      if (sortMode === "CUSTOMER_ASC") return a.sales_order.customer_name.localeCompare(b.sales_order.customer_name);
      return getReadyUnits(b) - getReadyUnits(a);
    });
  const queuePageCount = Math.max(1, Math.ceil(cards.length / QUEUE_PAGE_SIZE));
  const safeQueuePage = Math.min(queuePage, queuePageCount);
  const queueStartIndex = (safeQueuePage - 1) * QUEUE_PAGE_SIZE;
  const pagedCards = cards.slice(queueStartIndex, queueStartIndex + QUEUE_PAGE_SIZE);
  const queueShownStart = cards.length ? queueStartIndex + 1 : 0;
  const queueShownEnd = Math.min(cards.length, queueStartIndex + pagedCards.length);

  useEffect(() => {
    if ((!selectedOrderId || !cards.some((row) => row.sales_order.id === selectedOrderId)) && cards[0]?.sales_order?.id)
      setSelectedOrderId(cards[0].sales_order.id);
    if (selectedOrderId && !cards.length) setSelectedOrderId("");
  }, [cards, selectedOrderId]);

  useEffect(() => {
    setQueuePage(1);
  }, [search, unitFilter, statusFilter, customerFilter, sortMode]);

  useEffect(() => {
    setQueuePage((current) => Math.min(current, queuePageCount));
  }, [queuePageCount]);

  const selectedSummary = summary.data as SODispatchSummary | undefined;
  const selected =
    selectedOrderId &&
    cards.some((row) => String(row.sales_order.id) === selectedOrderId) &&
    String(selectedSummary?.sales_order.id || "") === selectedOrderId
      ? selectedSummary
      : undefined;
  const deliveryContext = selected?.sales_order.delivery;
  const canonicalDispatchLocation = clean(deliveryContext?.location);
  const locationIsOverride = Boolean(
    clean(dispatchLocation) && clean(dispatchLocation).toLocaleLowerCase() !== canonicalDispatchLocation.toLocaleLowerCase(),
  );
  const openFinalizeDialog = () => {
    setTransporterName("");
    setDispatchLocation(canonicalDispatchLocation);
    setNotes("");
    setFinalizeOpen(true);
  };
  const selectedRollRows = selected?.rolls.filter((roll) => selectedRolls.includes(roll.id)) || [];
  const selectedGonnyRows = selected?.gonnies.filter((gonny) => selectedGonnies.includes(gonny.id)) || [];
  const selectedPlantIds = Array.from(
    new Set(
      [...selectedRollRows.map((r) => r.location?.plant_id), ...selectedGonnyRows.map((g) => g.location?.plant_id)]
        .map((id) => clean(id))
        .filter(Boolean),
    ),
  );
  const selectedPlantNames = Array.from(
    new Set(
      [...selectedRollRows.map((r) => r.location?.plant_name), ...selectedGonnyRows.map((g) => g.location?.plant_name)]
        .map((name) => clean(name))
        .filter(Boolean),
    ),
  );
  const mixedPlants = selectedPlantIds.length > 1;
  const selectedPlantId =
    selectedPlantIds[0] || selected?.rolls[0]?.location?.plant_id || selected?.gonnies[0]?.location?.plant_id || "";
  const selectedGross =
    selectedRollRows.reduce((sum, roll) => sum + Number(roll.gross_weight_kg || roll.weight_kg || 0), 0) +
    selectedGonnyRows.reduce((sum, gonny) => sum + Number(gonny.gross_weight_kg || gonny.weight_kg || 0), 0);
  const selectedNet =
    selectedRollRows.reduce((sum, roll) => sum + Number(roll.net_weight_kg || roll.weight_kg || 0), 0) +
    selectedGonnyRows.reduce((sum, gonny) => sum + Number(gonny.net_product_weight_kg || 0), 0);
  const selectedPcs = selectedGonnyRows.reduce((sum, gonny) => sum + Number(gonny.qty_pcs || 0), 0);

  const allChallans = challans.data || [];
  const history = allChallans.filter((row) => {
    const term = historySearch.trim().toLowerCase();
    if (!term) return true;
    return `${row.dc_no} ${row.customer_name} ${row.so_number} ${row.vehicle_no} ${row.transporter_name || ""}`
      .toLowerCase()
      .includes(term);
  });
  const historyPageCount = Math.max(1, Math.ceil(history.length / HISTORY_PAGE_SIZE));
  const safeHistoryPage = Math.min(historyPage, historyPageCount);
  const historyStartIndex = (safeHistoryPage - 1) * HISTORY_PAGE_SIZE;
  const pagedHistory = history.slice(historyStartIndex, historyStartIndex + HISTORY_PAGE_SIZE);
  const historyShownStart = history.length ? historyStartIndex + 1 : 0;
  const historyShownEnd = Math.min(history.length, historyStartIndex + pagedHistory.length);
  useEffect(() => {
    setHistoryPage(1);
  }, [historySearch]);
  useEffect(() => {
    setHistoryPage((current) => Math.min(current, historyPageCount));
  }, [historyPageCount]);

  const statusOf = (row: DeliveryChallan) => String(row.status || "").toUpperCase();
  const draftChallans = allChallans.filter((row) => statusOf(row) === "DRAFT");
  const podPendingRows = allChallans.filter((row) => ["DISPATCHED", "IN_TRANSIT"].includes(statusOf(row)));
  const todayDispatches = allChallans.filter(
    (row) => row.dispatch_date && new Date(row.dispatch_date).toDateString() === new Date().toDateString(),
  ).length;
  const deliveredCount = allChallans.filter((row) => statusOf(row) === "DELIVERED").length;
  const totals = board.data?.totals || {};
  const readyGross =
    Number(totals.ready_rolls_gross_kg || totals.ready_rolls_kg || 0) + Number(totals.ready_gonnies_gross_kg || 0);
  const readyUnits = Number(totals.ready_rolls || 0) + Number(totals.ready_gonnies || 0);
  const selectedUnits = selectedRolls.length + selectedGonnies.length;

  const allUnits = [
    ...(selected?.gonnies || []).map((gonny) => {
      const net = Number(gonny.net_product_weight_kg || 0);
      const explicitTare =
        Number(gonny.inner_pack_tare_kg || 0) + Number(gonny.secondary_pack_tare_kg || 0) + Number(gonny.extras_tare_kg || 0);
      const gross = Number(gonny.gross_weight_kg || gonny.weight_kg || 0);
      return {
        id: gonny.id,
        row: gonny as any,
        unit: gonny.label_id || gonny.dispatch_unit_no,
        kind: "CTN" as const,
        lineKey: lineScopeKey(gonny, `ctn-${gonny.id}`),
        lineName: lineScopeName(gonny, "Pouch product"),
        lineSpec: lineScopeSpec(gonny),
        product: gonny.product_name || "Pouch product",
        location: gonny.location?.name,
        plantId: clean(gonny.location?.plant_id),
        contentMode: gonny.content_mode,
        packs: gonny.primary_pack_count,
        gross,
        tare: explicitTare || Math.max(0, gross - net),
        net,
        pcs: Number(gonny.qty_pcs || 0),
        selected: selectedGonnies.includes(gonny.id),
      };
    }),
    ...(selected?.rolls || []).map((roll) => {
      const net = Number(roll.net_weight_kg || roll.weight_kg || 0);
      const tare = Number(roll.tare_weight_kg || 0);
      return {
        id: roll.id,
        row: roll as any,
        unit: roll.label_id || roll.dispatch_unit_no,
        kind: "ROLL" as const,
        lineKey: lineScopeKey(roll, `roll-${roll.id}`),
        lineName: lineScopeName(roll, "Roll product"),
        lineSpec: lineScopeSpec(roll),
        product: roll.product_name || roll.material__name || "Roll product",
        location: roll.location?.name,
        plantId: clean(roll.location?.plant_id),
        contentMode: roll.release_mode === "UNPACKED" ? "Unpacked" : "Packed",
        packs: null,
        gross: Number(roll.gross_weight_kg || roll.weight_kg || net + tare),
        tare,
        net,
        pcs: 0,
        selected: selectedRolls.includes(roll.id),
      };
    }),
  ];
  const lineScopes = Array.from(
    allUnits
      .reduce((map, unit) => {
        const current = map.get(unit.lineKey) || {
          key: unit.lineKey,
          name: unit.lineName,
          spec: unit.lineSpec,
          units: 0,
          rolls: 0,
          ctn: 0,
          gross: 0,
          net: 0,
          pcs: 0,
        };
        current.units += 1;
        current.rolls += unit.kind === "ROLL" ? 1 : 0;
        current.ctn += unit.kind === "CTN" ? 1 : 0;
        current.gross += Number(unit.gross || 0);
        current.net += Number(unit.net || 0);
        current.pcs += Number(unit.pcs || 0);
        map.set(unit.lineKey, current);
        return map;
      }, new Map<string, { key: string; name: string; spec: string; units: number; rolls: number; ctn: number; gross: number; net: number; pcs: number }>())
      .values(),
  );
  const visibleUnits = lineFilter === "ALL" ? allUnits : allUnits.filter((unit) => unit.lineKey === lineFilter);
  const selectedManifestUnits = allUnits.filter((unit) => unit.selected);
  const selectedLineScopes = lineScopes
    .map((scope) => {
      const units = selectedManifestUnits.filter((unit) => unit.lineKey === scope.key);
      return {
        ...scope,
        units: units.length,
        rolls: units.filter((u) => u.kind === "ROLL").length,
        ctn: units.filter((u) => u.kind === "CTN").length,
        gross: units.reduce((sum, u) => sum + u.gross, 0),
      };
    })
    .filter((scope) => scope.units > 0);
  const visibleRollIds = visibleUnits.filter((unit) => unit.kind === "ROLL").map((unit) => unit.id);
  const visibleGonnyIds = visibleUnits.filter((unit) => unit.kind === "CTN").map((unit) => unit.id);
  const readySlipUnits = selectedUnits || visibleUnits.length;
  const readySlipLabel = selectedUnits ? "selected" : "visible";
  const allVisibleSelected = visibleUnits.length > 0 && visibleUnits.every((unit) => unit.selected);
  const orderReadyGross = allUnits.reduce((sum, row) => sum + Number(row.gross || 0), 0);
  const orderReadyNet = allUnits.reduce((sum, row) => sum + Number(row.net || 0), 0);
  const orderReadyPcs = allUnits.reduce((sum, row) => sum + Number(row.pcs || 0), 0);
  const manifestPageCount = Math.max(1, Math.ceil(visibleUnits.length / MANIFEST_PAGE_SIZE));
  const safeManifestPage = Math.min(manifestPage, manifestPageCount);
  const manifestStartIndex = (safeManifestPage - 1) * MANIFEST_PAGE_SIZE;
  const pagedUnits = visibleUnits.slice(manifestStartIndex, manifestStartIndex + MANIFEST_PAGE_SIZE);
  const manifestShownStart = visibleUnits.length ? manifestStartIndex + 1 : 0;
  const manifestShownEnd = Math.min(visibleUnits.length, manifestStartIndex + pagedUnits.length);
  const routeCounts = (board.data?.orders || []).reduce(
    (acc, row) => {
      acc.roll += Number(row.available_for_dispatch.rolls_count || 0) > 0 ? 1 : 0;
      acc.ctn += Number(row.available_for_dispatch.gonnies_count || 0) > 0 ? 1 : 0;
      return acc;
    },
    { roll: 0, ctn: 0 },
  );
  const stillInPacking =
    Number(selected?.packing_pending?.open_gonnies_count || 0) +
    Number(selected?.packing_pending?.unpacked_batch_count || 0) +
    Number(selected?.packing_pending?.unreleased_rolls_count || 0) +
    Number(selected?.packing_pending?.unreleased_sealed_gonnies_count || 0);

  const getReadySlipSelection = () => {
    if (!selectedOrderId) return;
    const hasExplicitSelection = selectedRolls.length + selectedGonnies.length > 0;
    const rollIds = hasExplicitSelection ? selectedRolls : visibleRollIds;
    const gonnyIds = hasExplicitSelection ? selectedGonnies : visibleGonnyIds;
    if (rollIds.length + gonnyIds.length === 0) return;
    return { rollIds, gonnyIds };
  };
  const printMaterialReadySlipOnEpson = async () => {
    if (!selectedOrderId) return;
    const selection = getReadySlipSelection();
    if (!selection) return;
    await downloadEpsonJob(logisticsService.getMaterialReadySlipUrl(selectedOrderId, selection, "tpp"));
  };
  const openMaterialReadySlipPdf = () => {
    if (!selectedOrderId) return;
    const selection = getReadySlipSelection();
    if (!selection) return;
    window.open(logisticsService.getMaterialReadySlipUrl(selectedOrderId, selection, "pdf"), "_blank", "noopener,noreferrer");
  };
  const clearFilters = () => {
    setSearch("");
    setUnitFilter("ALL");
    setStatusFilter("ALL");
    setCustomerFilter("ALL");
    setSortMode("READY_DESC");
    setQueuePage(1);
  };
  const toggle = (id: string, list: string[], setter: (value: string[]) => void) => {
    setter(list.includes(id) ? list.filter((value) => value !== id) : [...list, id]);
  };
  const toggleUnit = (unit: (typeof allUnits)[number]) =>
    unit.kind === "ROLL" ? toggle(unit.id, selectedRolls, setSelectedRolls) : toggle(unit.id, selectedGonnies, setSelectedGonnies);
  const selectOrder = (id: string) => {
    setSelectedOrderId(id);
    setSelectedRolls([]);
    setSelectedGonnies([]);
    setLineFilter("ALL");
    setManifestPage(1);
  };
  const toggleAllVisible = () => {
    setSelectedRolls(
      allVisibleSelected
        ? selectedRolls.filter((id) => !visibleRollIds.includes(id))
        : Array.from(new Set([...selectedRolls, ...visibleRollIds])),
    );
    setSelectedGonnies(
      allVisibleSelected
        ? selectedGonnies.filter((id) => !visibleGonnyIds.includes(id))
        : Array.from(new Set([...selectedGonnies, ...visibleGonnyIds])),
    );
  };

  useEffect(() => {
    setManifestPage((current) => Math.min(current, manifestPageCount));
  }, [manifestPageCount]);

  useEffect(() => {
    if (lineFilter !== "ALL" && !lineScopes.some((scope) => scope.key === lineFilter)) {
      setLineFilter("ALL");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineFilter, lineScopes.length]);

  const anyFetching = board.isFetching || challans.isFetching || summary.isFetching;
  const refreshAll = () => {
    void Promise.all([board.refetch(), challans.refetch(), ...(selectedOrderId ? [summary.refetch()] : [])]);
  };
  const boardStatus = board.isLoading
    ? { tone: "neutral" as const, text: "Loading bay…" }
    : board.isError
      ? { tone: "bad" as const, text: board.data ? "Refresh failed · showing last board" : "Board unavailable" }
      : board.isFetching
        ? { tone: "info" as const, text: "Refreshing…" }
        : { tone: "good" as const, text: "Live · auto-refresh 30s" };

  return (
    <div className="mx-auto max-w-[1760px] space-y-4" data-testid="dispatch-page">
      <PageHero
        compact
        eyebrow="Operations · Dispatch Bay"
        icon={<Truck />}
        title="Dispatch Bay"
        description="Build challans from units released by Packing Yard, print slips, ship, and confirm delivery."
        meta={
          <>
            <HeroChip tone={boardStatus.tone}>{boardStatus.text}</HeroChip>
            {board.isError ? <span role="alert" className="text-[12px] text-white/70">{err(board.error)}</span> : null}
            {challans.isError ? (
              <span role="alert" className="text-[12px] text-white/70">Challan history unavailable: {err(challans.error)}</span>
            ) : null}
          </>
        }
        actions={
          <>
            <a
              href="/downloads/epson-fx2175ii/TotalPolyPrint-Epson-Setup.exe"
              download="TotalPolyPrint-Epson-Setup.exe"
              data-testid="dispatch-epson-windows-setup"
              title="Install or repair Epson FX-2175II tractor printing on this Windows PC"
              className={heroButtonClass("ghost")}
            >
              <Download /> Epson setup
            </a>
            <button
              type="button"
              onClick={refreshAll}
              disabled={anyFetching}
              className={heroButtonClass("primary")}
              aria-label="Refresh dispatch board, challans, and selected order"
            >
              <RefreshCw className={cn(anyFetching && "animate-spin motion-reduce:animate-none")} /> Refresh
            </button>
          </>
        }
      >
        <HeroStats columns={6}>
          <HeroStat label="Orders ready" value={board.data ? n(totals.orders || 0, 0) : "—"} hint="with released units" />
          <HeroStat
            label="Units ready"
            tone="good"
            value={board.data ? n(readyUnits, 0) : "—"}
            hint={board.data ? `${n(totals.ready_gonnies || 0, 0)} cartons · ${n(totals.ready_rolls || 0, 0)} rolls` : "—"}
          />
          <HeroStat label="Weight ready" value={board.data ? kg(readyGross) : "—"} hint="gross shipment weight" />
          <HeroStat
            label="Draft challans"
            tone={draftChallans.length ? "warn" : "neutral"}
            value={challans.data ? n(draftChallans.length, 0) : "—"}
            hint="created, not yet shipped"
          />
          <HeroStat
            label="Awaiting POD"
            tone={podPendingRows.length ? "info" : "neutral"}
            value={challans.data ? n(podPendingRows.length, 0) : "—"}
            hint="dispatched or in transit"
          />
          <HeroStat
            label="Shipped today"
            value={challans.data ? n(todayDispatches, 0) : "—"}
            hint={challans.data ? `${n(deliveredCount, 0)} delivered all-time` : "—"}
          />
        </HeroStats>
      </PageHero>

      <section className="flex flex-col gap-2.5 rounded-[18px] border border-line bg-surface-1 p-2.5 shadow-[var(--shadow-sm)] xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-4" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search order or customer"
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
              { value: "ALL", label: "All units", count: board.data?.orders?.length || 0 },
              { value: "CTN", label: "Cartons", count: routeCounts.ctn },
              { value: "ROLL", label: "Rolls", count: routeCounts.roll },
            ]}
          />
          <FilterGroup
            label="Queue status"
            testIdPrefix="dispatch-filter-status"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: "ALL", label: "Any status" },
              { value: "READY", label: "Ready" },
              { value: "WAITING", label: "Waiting" },
            ]}
          />
          <select
            data-testid="dispatch-filter-customer"
            value={customerFilter}
            onChange={(event) => setCustomerFilter(event.target.value)}
            className={cn(toolbarSelectClass, "max-w-[200px]")}
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
            onChange={(event) => setSortMode(event.target.value as DispatchSortMode)}
            className={toolbarSelectClass}
            aria-label="Sort queue"
          >
            <option value="READY_DESC">Ready units first</option>
            <option value="GROSS_DESC">Heaviest first</option>
            <option value="SO_ASC">SO number</option>
            <option value="CUSTOMER_ASC">Customer</option>
          </select>
          <Button type="button" variant="ghost" size="sm" data-testid="dispatch-filter-clear" onClick={clearFilters}>
            Clear
          </Button>
        </div>
        <Select value={selectedOrderId} onValueChange={selectOrder}>
          <SelectTrigger data-testid="dispatch-sales-order-select" className="h-9 w-full rounded-xl xl:w-[300px]" aria-label="Jump to sales order">
            <SelectValue placeholder="Jump to order" />
          </SelectTrigger>
          <SelectContent>
            {cards.map((row) => (
              <SelectItem key={row.sales_order.id} value={row.sales_order.id}>
                {row.sales_order.order_number} • {row.sales_order.customer_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </section>

      <section className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="min-w-0">
          <div className="flex flex-col overflow-hidden rounded-[18px] border border-line bg-surface-1 shadow-[var(--shadow-sm)] xl:sticky xl:top-[88px] xl:max-h-[calc(100dvh-104px)]">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div>
                <div className="text-[13.5px] font-semibold text-content-1">Orders to ship</div>
                <div className="text-[11.5px] text-content-3">Only units released from Packing Yard</div>
              </div>
              <Pill tone="neutral">{n(cards.length, 0)}</Pill>
            </div>
            <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain p-2">
              {board.isLoading ? Array.from({ length: 6 }).map((_, i) => <div key={i} className="erp-skeleton h-[86px] rounded-xl" />) : null}
              {pagedCards.map((row) => {
                const units = getReadyUnits(row);
                const gross = getGrossReady(row);
                const pending =
                  Number(row.packing_pending?.open_gonnies_count || 0) +
                  Number(row.packing_pending?.unpacked_batch_count || 0) +
                  Number(row.packing_pending?.unreleased_rolls_count || 0);
                const active = selectedOrderId === row.sales_order.id;
                return (
                  <button
                    key={row.sales_order.id}
                    type="button"
                    data-testid="dispatch-order-card"
                    data-unit-roll={Number(row.available_for_dispatch.rolls_count || 0) > 0 ? "true" : "false"}
                    data-unit-ctn={Number(row.available_for_dispatch.gonnies_count || 0) > 0 ? "true" : "false"}
                    data-status={getDispatchStatus(row)}
                    data-customer={row.sales_order.customer_name}
                    aria-current={active ? "true" : undefined}
                    onClick={() => selectOrder(row.sales_order.id)}
                    className={cn(
                      "relative w-full rounded-xl border px-3 py-2.5 text-left transition-[background-color,border-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active ? "border-primary/40 bg-info-bg shadow-[var(--shadow-sm)]" : "border-transparent hover:border-line hover:bg-surface-2",
                    )}
                  >
                    {active ? <span className="absolute inset-y-2.5 left-0 w-[3px] rounded-r-full bg-primary" aria-hidden /> : null}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-mono text-[12.5px] font-semibold text-content-1">{row.sales_order.order_number}</div>
                        <div className="mt-0.5 truncate text-[12px] text-content-2">{row.sales_order.customer_name}</div>
                      </div>
                      <Pill tone={units ? "good" : "warn"} dot>
                        {units ? "Ready" : "Waiting"}
                      </Pill>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-content-3">
                      {Number(row.available_for_dispatch.gonnies_count || 0) ? (
                        <span>{n(row.available_for_dispatch.gonnies_count, 0)} cartons</span>
                      ) : null}
                      {Number(row.available_for_dispatch.rolls_count || 0) ? (
                        <span>{n(row.available_for_dispatch.rolls_count, 0)} rolls</span>
                      ) : null}
                      <span className="font-medium text-content-1 tabular-nums">{kg(gross)}</span>
                      {pending ? <span className="text-warning-fg">{n(pending, 0)} still in packing</span> : null}
                    </div>
                  </button>
                );
              })}
              {!board.isLoading && !cards.length ? (
                <PanelEmpty icon={<Truck />} title="No orders match">
                  {board.data?.orders?.length ? "Try clearing the filters." : "Release units from Packing Yard to see them here."}
                </PanelEmpty>
              ) : null}
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-2.5">
              <div data-testid="dispatch-queue-total" className="text-[11.5px] text-content-3">
                Showing {queueShownStart}-{queueShownEnd} of {cards.length} orders
              </div>
              <Pager page={safeQueuePage} pageCount={queuePageCount} onPageChange={setQueuePage} testId="dispatch-queue-page" />
            </div>
          </div>
        </aside>

        <main className="min-w-0 space-y-4">
          {summary.isError && selectedOrderId ? (
            <div role="alert" className="rounded-xl border border-danger-border bg-danger-bg px-4 py-3 text-[12.5px] text-danger-fg">
              Order manifest unavailable: {err(summary.error)}
            </div>
          ) : null}
          {!selected ? (
            selectedOrderId && summary.isFetching ? (
              <div className="space-y-4">
                <div className="erp-skeleton h-[180px] rounded-[18px]" />
                <div className="erp-skeleton h-[380px] rounded-[18px]" />
              </div>
            ) : (
              <Panel>
                <PanelEmpty icon={<Truck />} title="Select an order to ship">
                  Dispatch Bay only shows units that Packing Yard has released.
                </PanelEmpty>
              </Panel>
            )
          ) : (
            <>
              <section className="erp-enter rounded-[18px] border border-line bg-surface-1 p-4 shadow-[var(--shadow-sm)] md:p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/sales/orders/${selected.sales_order.id}`}
                        className="font-mono text-[18px] font-semibold tracking-[-0.01em] text-content-1 hover:underline"
                      >
                        {selected.sales_order.order_number}
                      </Link>
                      <Pill tone="good" dot>
                        {n(allUnits.length, 0)} units ready
                      </Pill>
                      <Pill tone="neutral">{titleCase(selected.sales_order.status)}</Pill>
                    </div>
                    <div className="mt-0.5 text-[13px] text-content-2">{selected.sales_order.customer_name}</div>
                    <div className="mt-2 flex items-start gap-1.5 text-[12px] text-content-3">
                      <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>
                        <span className="font-medium text-content-1">
                          {clean(deliveryContext?.delivery_to) || selected.sales_order.customer_name}
                        </span>
                        {clean(deliveryContext?.address) ? ` · ${deliveryContext?.address}` : canonicalDispatchLocation ? ` · ${canonicalDispatchLocation}` : " · Delivery address not recorded on the order"}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button asChild variant="outline" size="sm">
                      <Link href="/logistics/packing">
                        <PackageOpen className="mr-1.5 h-3.5 w-3.5" /> Packing Yard
                      </Link>
                    </Button>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
                  <OrderMetric label="Ready units" value={n(allUnits.length, 0)} sub={`${n(selected.rolls.length, 0)} rolls · ${n(selected.gonnies.length, 0)} cartons`} tone="good" />
                  <OrderMetric label="Ready net" value={kg(orderReadyNet)} sub={orderReadyPcs ? `${n(orderReadyPcs, 0)} pcs` : "product weight"} />
                  <OrderMetric label="Ready gross" value={kg(orderReadyGross)} sub="truck weight" />
                  <OrderMetric label="Ordered" value={n(selected.ordered_qty)} sub="sales quantity" />
                  <OrderMetric
                    label="Produced"
                    value={selected.produced_qty.rolls_kg ? kg(selected.produced_qty.rolls_kg) : `${n(selected.produced_qty.batches_pcs, 0)} pcs`}
                    sub={selected.produced_qty.rolls_kg && selected.produced_qty.batches_pcs ? `${n(selected.produced_qty.batches_pcs, 0)} pcs` : "to date"}
                  />
                  <OrderMetric
                    label="Still in packing"
                    value={n(stillInPacking, 0)}
                    sub="not yet released"
                    tone={stillInPacking ? "warn" : undefined}
                  />
                </div>
              </section>

              {lineScopes.length > 1 ? (
                <section className="rounded-[18px] border border-line bg-surface-1 p-4 shadow-[var(--shadow-sm)]">
                  <div className="mb-2 flex items-center gap-2 text-[12px] font-medium text-content-3">
                    <Layers className="h-3.5 w-3.5" /> Sales-order lines
                  </div>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    <button
                      type="button"
                      data-testid="dispatch-line-filter-all"
                      aria-pressed={lineFilter === "ALL"}
                      onClick={() => {
                        setLineFilter("ALL");
                        setManifestPage(1);
                      }}
                      className={cn(
                        "shrink-0 rounded-xl border px-3 py-2 text-left transition",
                        lineFilter === "ALL" ? "border-content-1 bg-content-1 text-surface-1" : "border-line bg-surface-1 text-content-2 hover:border-line-strong",
                      )}
                    >
                      <div className="text-[12.5px] font-semibold">All lines</div>
                      <div className="text-[11.5px] opacity-75">
                        {n(allUnits.length, 0)} units · {kg(orderReadyGross)}
                      </div>
                    </button>
                    {lineScopes.map((scope, index) => (
                      <button
                        key={scope.key}
                        type="button"
                        data-testid={`dispatch-line-filter-${index + 1}`}
                        aria-pressed={lineFilter === scope.key}
                        onClick={() => {
                          setLineFilter(scope.key);
                          setManifestPage(1);
                        }}
                        className={cn(
                          "w-[240px] shrink-0 rounded-xl border px-3 py-2 text-left transition",
                          lineFilter === scope.key ? "border-content-1 bg-content-1 text-surface-1" : "border-line bg-surface-1 text-content-2 hover:border-line-strong",
                        )}
                      >
                        <div className="truncate text-[12.5px] font-semibold">{scope.name}</div>
                        <div className="truncate text-[11.5px] opacity-75">
                          {scope.spec} · {n(scope.units, 0)} units · {kg(scope.gross)}
                        </div>
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}

              <Panel
                flush
                icon={<Truck />}
                title={`Manifest · ${n(visibleUnits.length, 0)} units`}
                description="Tick the units going on this truck. Every row shows the full product so loaders can match labels."
                actions={
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      data-testid="dispatch-select-all-units"
                      disabled={!visibleUnits.length}
                      onClick={toggleAllVisible}
                    >
                      {allVisibleSelected ? "Clear visible" : "Select visible"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      data-testid="dispatch-material-ready-slip"
                      disabled={!selectedOrderId || readySlipUnits === 0}
                      onClick={printMaterialReadySlipOnEpson}
                    >
                      <Printer className="mr-1.5 h-3.5 w-3.5" /> Epson slip · {readySlipLabel}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      data-testid="dispatch-material-ready-slip-pdf"
                      disabled={!selectedOrderId || readySlipUnits === 0}
                      onClick={openMaterialReadySlipPdf}
                    >
                      <FileText className="mr-1.5 h-3.5 w-3.5" /> A4 PDF
                    </Button>
                  </div>
                }
              >
                {visibleUnits.length ? (
                  <ManifestTable label="Dispatch manifest" minWidth={900} className="max-h-[640px]">
                    <thead>
                      <tr>
                        <Th className="w-[48px]" />
                        <Th className="w-[150px]">Unit</Th>
                        <Th>Product &amp; specification</Th>
                        <Th align="right" className="w-[96px]">Contents</Th>
                        <Th align="right" className="w-[150px]">Weight</Th>
                        <Th className="w-[128px]">Status</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedUnits.map((unit, index) => (
                        <tr
                          key={unit.id}
                          className={cn("erp-manifest-row cursor-pointer", unit.selected && "is-selected")}
                          onClick={(event) => {
                            if ((event.target as HTMLElement).closest("button,a")) return;
                            toggleUnit(unit);
                          }}
                        >
                          <Td>
                            <SelectBox
                              checked={unit.selected}
                              onChange={() => toggleUnit(unit)}
                              label={`Select ${unit.kind === "ROLL" ? "roll" : "carton"} ${unit.unit}`}
                              testId={unit.kind === "ROLL" ? `dispatch-roll-checkbox-${unit.id}` : `dispatch-gonny-checkbox-${unit.id}`}
                              index={manifestStartIndex + index + 1}
                            />
                          </Td>
                          <Td>
                            <UnitCell label={unit.unit} kind={unit.kind === "ROLL" ? "ROLL" : "CTN"} location={unit.location} />
                          </Td>
                          <Td>
                            <ProductSpecCell row={unit.row} fallbackName={unit.product} />
                          </Td>
                          <Td align="right">
                            {unit.pcs ? (
                              <div className="text-[13px] font-semibold tabular-nums text-content-1">
                                {n(unit.pcs, 0)}
                                <span className="ml-0.5 text-[10.5px] font-normal text-content-4">pcs</span>
                              </div>
                            ) : (
                              <div className="text-[12.5px] text-content-2">1 roll</div>
                            )}
                            <div className="mt-0.5 text-[11px] text-content-3">
                              {unit.packs ? `${n(unit.packs, 0)} inner packs` : titleCase(unit.contentMode || (unit.kind === "ROLL" ? "Packed" : "Loose pouches"))}
                            </div>
                          </Td>
                          <Td align="right">
                            <WeightStack net={unit.net} tare={unit.tare} gross={unit.gross} />
                          </Td>
                          <Td>
                            <StagePill stage={unit.selected ? "SELECTED" : "READY"} />
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </ManifestTable>
                ) : (
                  <div className="px-5 pb-5">
                    <PanelEmpty title="No released units on this line" />
                  </div>
                )}
                <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-2.5">
                  <div data-testid="dispatch-manifest-total" className="text-[11.5px] text-content-3">
                    Showing {manifestShownStart}-{manifestShownEnd} of {visibleUnits.length} visible units
                  </div>
                  <Pager page={safeManifestPage} pageCount={manifestPageCount} onPageChange={setManifestPage} testId="dispatch-manifest-page" />
                </div>
              </Panel>

              <ActionBar>
                <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
                  <span className="font-semibold text-content-1">
                    {selectedUnits ? `${selectedUnits} unit${selectedUnits > 1 ? "s" : ""} selected` : "No units selected"}
                  </span>
                  {selectedUnits ? (
                    <>
                      <span className="tabular-nums text-content-2">{kg(selectedNet)} net</span>
                      <span className="tabular-nums text-content-2">{kg(selectedGross)} gross</span>
                      {selectedPcs ? <span className="tabular-nums text-content-2">{n(selectedPcs, 0)} pcs</span> : null}
                    </>
                  ) : (
                    <span className="text-content-3">Tick units in the manifest to build a challan.</span>
                  )}
                  {mixedPlants ? (
                    <span className="inline-flex items-center gap-1 text-warning-fg">
                      <AlertTriangle className="h-3.5 w-3.5" /> Units from {selectedPlantNames.join(" & ") || "several plants"} · one challan per plant
                    </span>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    data-testid="dispatch-ready-slip-sticky"
                    disabled={!selectedOrderId || readySlipUnits === 0}
                    onClick={printMaterialReadySlipOnEpson}
                  >
                    <Printer className="mr-2 h-4 w-4" /> Packing slip
                  </Button>
                  <Button
                    data-testid="dispatch-create-trigger"
                    disabled={!selectedPlantId || selectedUnits === 0 || mixedPlants}
                    onClick={openFinalizeDialog}
                  >
                    <Send className="mr-2 h-4 w-4" /> Create challan
                  </Button>
                </div>
              </ActionBar>
            </>
          )}
        </main>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
        <Panel
          icon={<CircleCheck />}
          title="Awaiting proof of delivery"
          description="Dispatched challans. Confirm POD once the customer receives the goods."
          actions={<Pill tone="info">{challans.data ? n(podPendingRows.length, 0) : "—"}</Pill>}
        >
          {!challans.data ? (
            <PanelEmpty title={challans.isLoading ? "Loading challans…" : "POD status unavailable"} />
          ) : podPendingRows.length ? (
            <ul className="divide-y divide-line">
              {podPendingRows.slice(0, 6).map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[12.5px] font-semibold text-content-1">{row.dc_no}</span>
                      <Pill tone="info" dot>{titleCase(row.status)}</Pill>
                    </div>
                    <div className="mt-0.5 truncate text-[12px] text-content-3">
                      {row.customer_name} · {row.so_number || "sales order"}
                      {row.dispatch_date ? ` · ${new Date(row.dispatch_date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : ""}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    data-testid={`dispatch-deliver-${row.id}`}
                    disabled={deliverMutation.isPending}
                    onClick={() => setPodChallan(row)}
                  >
                    Confirm POD
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <PanelEmpty icon={<CircleCheck />} title="No deliveries awaiting POD" />
          )}
        </Panel>

        <Panel
          flush
          icon={<FileText />}
          title="Challans"
          description="Print, dispatch drafts, and track every challan through delivery."
          actions={
            <div className="relative w-56">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-content-4" />
              <Input
                data-testid="dispatch-history-search"
                value={historySearch}
                onChange={(event) => setHistorySearch(event.target.value)}
                placeholder="Search challan, customer, SO"
                className="h-8 rounded-lg pl-8 text-[12.5px]"
              />
            </div>
          }
        >
          {history.length && qrStickers.allowed ? (
            <p className="border-t border-line px-4 py-2 text-[11.5px] text-content-3">
              <span className="font-semibold text-content-2">QR sticker:</span> {GATE_QR_STICKER_HINT}
            </p>
          ) : null}
          {history.length ? (
            <ul className="divide-y divide-line border-t border-line">
              {pagedHistory.map((row: DeliveryChallan) => {
                const status = statusOf(row);
                const sendingThis = dispatchMutation.isPending && dispatchMutation.variables === row.id;
                return (
                  <li key={row.id} data-testid={`dispatch-challan-row-${row.id}`} className="px-4 py-3">
                    <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[12.5px] font-semibold text-content-1">{row.dc_no}</span>
                          <Pill tone={challanTone(status)} dot>{titleCase(status)}</Pill>
                        </div>
                        <div className="mt-0.5 truncate text-[12px] text-content-3">
                          {row.customer_name} · {row.so_number || "sales order"}
                          {row.transporter_name ? ` · ${row.transporter_name}` : ""}
                          {row.vehicle_no ? ` · ${row.vehicle_no}` : ""}
                        </div>
                        <div className="mt-2">
                          <Lifecycle status={status} />
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          data-testid={`dispatch-print-${row.id}`}
                          onClick={() => void downloadEpsonJob(logisticsService.getChallanPrintUrl(row.id, "tpp"))}
                        >
                          <Printer className="mr-1 h-3.5 w-3.5" /> Epson
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          data-testid={`dispatch-pdf-${row.id}`}
                          onClick={() => window.open(logisticsService.getChallanPrintUrl(row.id, "pdf"), "_blank", "noopener,noreferrer")}
                        >
                          <FileText className="mr-1 h-3.5 w-3.5" /> PDF
                        </Button>
                        {status !== "CANCELLED" ? (
                          <PrintGateQrLabelButton kind="SALES_DC" id={row.id} reference={row.dc_no} showHint={false} />
                        ) : null}
                        {status === "DRAFT" ? (
                          <Button
                            size="sm"
                            data-testid={`dispatch-send-${row.id}`}
                            disabled={dispatchMutation.isPending}
                            onClick={() => dispatchMutation.mutate(row.id)}
                          >
                            <Send className="mr-1 h-3.5 w-3.5" /> {sendingThis ? "Dispatching…" : "Dispatch"}
                          </Button>
                        ) : null}
                        {["DISPATCHED", "IN_TRANSIT"].includes(status) ? (
                          <Button
                            size="sm"
                            variant="outline"
                            data-testid={`dispatch-deliver-history-${row.id}`}
                            disabled={deliverMutation.isPending}
                            onClick={() => setPodChallan(row)}
                          >
                            Confirm POD
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="px-5 pb-5">
              <PanelEmpty title={challans.isLoading ? "Loading challans…" : "No challans match this search"} />
            </div>
          )}
          <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-2.5">
            <div data-testid="dispatch-history-total" className="text-[11.5px] text-content-3">
              Showing {historyShownStart}-{historyShownEnd} of {history.length} challans
            </div>
            <Pager page={safeHistoryPage} pageCount={historyPageCount} onPageChange={setHistoryPage} testId="dispatch-history-page" />
          </div>
        </Panel>
      </section>

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

      <Dialog open={finalizeOpen} onOpenChange={setFinalizeOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create dispatch challan</DialogTitle>
            <DialogDescription>
              {selected?.sales_order.order_number || "-"} · {selected?.sales_order.customer_name || "-"}
              {selectedPlantNames.length === 1 ? ` · from ${selectedPlantNames[0]}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <OrderMetric label="Units" value={n(selectedUnits, 0)} sub={`${n(selectedRolls.length, 0)} rolls · ${n(selectedGonnies.length, 0)} cartons`} />
            <OrderMetric label="Gross" value={kg(selectedGross)} sub="truck weight" />
            <OrderMetric label="Net" value={kg(selectedNet)} sub="product weight" />
            <OrderMetric label="Pieces" value={n(selectedPcs, 0)} sub="packed pouches" />
          </div>
          {selectedLineScopes.length ? (
            <div className="space-y-1.5">
              <div className="text-[12px] font-medium text-content-3">Lines on this challan</div>
              <div className="grid gap-2 md:grid-cols-2">
                {selectedLineScopes.map((scope) => (
                  <div key={scope.key} className="rounded-xl border border-line bg-surface-2 px-3 py-2">
                    <div className="truncate text-[12.5px] font-semibold text-content-1">{scope.name}</div>
                    <div className="mt-0.5 text-[11.5px] text-content-3">
                      {n(scope.units, 0)} units
                      {scope.rolls ? ` · ${n(scope.rolls, 0)} rolls` : ""}
                      {scope.ctn ? ` · ${n(scope.ctn, 0)} cartons` : ""} · {kg(scope.gross)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-line bg-surface-2 p-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] font-medium text-content-3">Delivery to</span>
                <Pill tone="info">From sales order</Pill>
              </div>
              <div className="mt-1.5 text-[13px] font-semibold text-content-1">
                {clean(deliveryContext?.delivery_to) || selected?.sales_order.customer_name || "Not recorded"}
              </div>
              {clean(deliveryContext?.address) ? (
                <div className="mt-1 text-[12px] leading-5 text-content-3">{deliveryContext?.address}</div>
              ) : (
                <div className="mt-2 rounded-lg border border-warning-border bg-warning-bg px-2.5 py-1.5 text-[12px] text-warning-fg">
                  No shipping address on this order or customer. Confirm the location below.
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="dispatch-transporter">Transporter *</Label>
              <div className="relative">
                <Truck className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-4" />
                <Input
                  id="dispatch-transporter"
                  value={transporterName}
                  onChange={(event) => setTransporterName(event.target.value)}
                  placeholder="Transporter or company vehicle"
                  className="pl-9"
                  maxLength={160}
                  autoComplete="organization"
                />
              </div>
              <p className="text-[11.5px] text-content-3">Printed on the challan.</p>
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label htmlFor="dispatch-location">Delivery location *</Label>
                <Pill tone={locationIsOverride ? "warn" : "info"}>{locationIsOverride ? "Override for this challan" : "From address"}</Pill>
              </div>
              <div className="relative">
                <MapPin className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-4" />
                <Input
                  id="dispatch-location"
                  value={dispatchLocation}
                  onChange={(event) => setDispatchLocation(event.target.value)}
                  placeholder="City, destination or delivery address"
                  className="pl-9"
                  maxLength={240}
                />
              </div>
              <p className="text-[11.5px] text-content-3">
                {locationIsOverride
                  ? "Saved on this challan only. The sales order and customer master are unchanged."
                  : canonicalDispatchLocation
                    ? "Prefilled from the sales order / customer."
                    : "No source location on file. Enter a dispatch-only location to continue."}
              </p>
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="dispatch-notes">Internal note</Label>
              <Textarea
                id="dispatch-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Loading instruction or receiver context (not printed on the client slip)"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFinalizeOpen(false)}>
              Cancel
            </Button>
            <Button
              data-testid="dispatch-create-submit"
              disabled={
                !selectedPlantId ||
                selectedUnits === 0 ||
                mixedPlants ||
                !clean(transporterName) ||
                !clean(dispatchLocation) ||
                createChallanMutation.isPending
              }
              onClick={() => createChallanMutation.mutate()}
            >
              {createChallanMutation.isPending ? "Creating…" : "Create challan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

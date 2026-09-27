"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Boxes,
  Check,
  ClipboardList,
  FileText,
  History,
  Layers,
  PackageCheck,
  PackageOpen,
  RefreshCw,
  Scale,
  Search,
  Send,
  Truck,
  X,
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
  FilterGroup,
  ManifestTable,
  OrderMetric,
  Pager,
  Pill,
  ProductSpecCell,
  ProgressRing,
  SelectBox,
  StagePill,
  Td,
  Th,
  UnitCell,
  WeightStack,
  apiError as err,
  titleCase,
  clean,
  kgText as kg,
  lineScopeKey,
  lineScopeName,
  lineScopeSpec,
  micronText,
  num as n,
  toolbarSelectClass,
} from "@/components/logistics/yard-ui";
import {
  logisticsService,
  type Gonny,
  type SOPackingSummary,
} from "@/services/logistics";
import {
  masterDataService,
  type PackagingMaterial,
} from "@/services/master-data";

const QUEUE_PAGE_SIZE = 8;
const WORK_PAGE_SIZE = 8;

function getGonnyExpected(gonny: Gonny) {
  return Number(
    gonny.expected_gross_weight_kg ??
      gonny.tare_breakdown_json?.expected_gross_weight_kg ??
      gonny.tare_breakdown_json?.gross_weight_kg ??
      0,
  );
}

function getGonnyTare(gonny: Gonny) {
  const explicit =
    Number(gonny.inner_pack_tare_kg || 0) +
    Number(gonny.secondary_pack_tare_kg || 0) +
    Number(gonny.extras_tare_kg || 0);
  const gross = Number(gonny.gross_weight_kg || 0);
  const net = Number(gonny.net_product_weight_kg || 0);
  return explicit || (gross && net ? Math.max(0, gross - net) : 0);
}

function getGonnyWorkRank(gonny: Gonny) {
  if (gonny.released_to_dispatch) return 3;
  if (gonny.gross_weight_kg) return 2;
  return 1;
}

type RouteKind = "POUCH_PACK" | "ROLL_PACK" | "RELEASE_UNPACKED";
type RollPackLineDraft = {
  material_id: string;
  qty: string;
  uom?: string;
  basis?: string;
};
type PackingRouteFilter = "ALL" | "POUCH" | "ROLL" | "RELEASE";
type QueueStatusFilter = "ALL" | "READY" | "WAITING" | "IN_PROGRESS";
type PackingSortMode = "URGENCY" | "READY_DESC" | "SO_ASC" | "CUSTOMER_ASC";

const ROUTE_LABEL: Record<Exclude<PackingRouteFilter, "ALL">, string> = {
  POUCH: "Pouch",
  ROLL: "Roll",
  RELEASE: "Release",
};

export default function PackingYardPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [routeFilter, setRouteFilter] = useState<PackingRouteFilter>("ALL");
  const [statusFilter, setStatusFilter] = useState<QueueStatusFilter>("ALL");
  const [customerFilter, setCustomerFilter] = useState("ALL");
  const [sortMode, setSortMode] = useState<PackingSortMode>("URGENCY");
  const [selectedOrderId, setSelectedOrderId] = useState<string>("");
  const [routeChoice, setRouteChoice] = useState<RouteKind | "">("");
  const [createBatchId, setCreateBatchId] = useState("");
  const [createQty, setCreateQty] = useState("");
  const [contentMode, setContentMode] = useState<
    "LOOSE_POUCHES" | "PRIMARY_PACKS"
  >("LOOSE_POUCHES");
  const [primaryPackCount, setPrimaryPackCount] = useState("");
  const [gonnyMaterialId, setGonnyMaterialId] = useState("");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [sealGonny, setSealGonny] = useState<Gonny | null>(null);
  const [actualGross, setActualGross] = useState("");
  const [varianceReason, setVarianceReason] = useState("");
  const [releaseRolls, setReleaseRolls] = useState<any[]>([]);
  const [selectedRollIds, setSelectedRollIds] = useState<string[]>([]);
  const [releaseMode, setReleaseMode] = useState<"PACKED" | "UNPACKED">(
    "PACKED",
  );
  const [rollPackLines, setRollPackLines] = useState<RollPackLineDraft[]>([]);
  const [queuePage, setQueuePage] = useState(1);
  const [batchPage, setBatchPage] = useState(1);
  const [gonnyPage, setGonnyPage] = useState(1);
  const [rollPage, setRollPage] = useState(1);
  const [lineFilter, setLineFilter] = useState("ALL");

  const board = useQuery({
    queryKey: ["packing-board"],
    queryFn: ({ signal }) => logisticsService.getPackingBoard(signal),
    refetchInterval: 30000,
  });
  const summary = useQuery({
    queryKey: ["packing-summary", selectedOrderId],
    queryFn: ({ signal }) =>
      logisticsService.getSOPackingSummary(selectedOrderId, signal),
    enabled: Boolean(selectedOrderId),
    placeholderData: undefined,
  });
  const packaging = useQuery({
    queryKey: ["packaging-materials"],
    queryFn: masterDataService.getPackaging,
    staleTime: 5 * 60 * 1000,
  });
  const gonnies = useMemo(
    () => (packaging.data || []).filter((p) => p.packaging_kind === "GONNY"),
    [packaging.data],
  );
  const packingMarkMasters = useMemo(
    () =>
      (packaging.data || []).filter(
        (item: any) =>
          String(item?.status || "ACTIVE").toUpperCase() !== "INACTIVE",
      ),
    [packaging.data],
  );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["packing-board"] });
    queryClient.invalidateQueries({
      queryKey: ["packing-summary", selectedOrderId],
    });
    queryClient.invalidateQueries({ queryKey: ["dispatch-board"] });
  };

  const createMutation = useMutation({
    mutationFn: () =>
      logisticsService.createGonny({
        fgBatchId: createBatchId,
        qtyPcs: Number(createQty),
        gonnyMaterialId,
        contentMode,
        primaryPackCount: primaryPackCount
          ? Number(primaryPackCount)
          : undefined,
      }),
    onSuccess: (data) => {
      toast({ title: "Gonny created", description: data.message });
      setCreateDialogOpen(false);
      setCreateBatchId("");
      setCreateQty("");
      setPrimaryPackCount("");
      setGonnyPage(1);
      invalidate();
    },
    onError: (error) =>
      toast({
        title: "Create failed",
        description: err(error),
        variant: "destructive",
      }),
  });

  const sealMutation = useMutation({
    mutationFn: () =>
      logisticsService.sealGonny(
        sealGonny!.id,
        Number(actualGross),
        [],
        varianceReason,
      ),
    onSuccess: (data) => {
      toast({ title: "Gonny sealed", description: data.message });
      setSealGonny(null);
      setActualGross("");
      setVarianceReason("");
      invalidate();
    },
    onError: (error) =>
      toast({
        title: "Seal failed",
        description: err(error),
        variant: "destructive",
      }),
  });

  // Optional extras tagged at release-to-dispatch. Gonny SKU + inner pouch SKU
  // are auto-consumed from the measurable packing events; everything else is
  // mark-only and reconciled by the timestamped packing stock count.
  const [releaseGonnyTarget, setReleaseGonnyTarget] = useState<Gonny | null>(
    null,
  );
  const [releaseGonnyExtras, setReleaseGonnyExtras] = useState<
    Array<{ id: string; material_id: string; qty: string; notes: string }>
  >([]);
  const releaseGonnyMutation = useMutation({
    mutationFn: ({
      gonnyId,
      lines,
    }: {
      gonnyId: string;
      lines: Array<{
        material_id: string;
        qty: number;
        uom?: string;
        notes?: string;
      }>;
    }) => logisticsService.releaseGonny(gonnyId, lines),
    onSuccess: (data) => {
      toast({ title: "Released to dispatch", description: data.message });
      setReleaseGonnyTarget(null);
      setReleaseGonnyExtras([]);
      invalidate();
    },
    onError: (error) =>
      toast({
        title: "Release failed",
        description: err(error),
        variant: "destructive",
      }),
  });

  const releaseRollMutation = useMutation<
    any,
    any,
    {
      rollIds: string[];
      mode: "PACKED" | "UNPACKED";
      lines: RollPackLineDraft[];
    }
  >({
    mutationFn: ({ rollIds, mode, lines }) => {
      const payloadLines = (lines || [])
        .filter((line) => line.material_id)
        .map((line) => ({
          material_id: line.material_id,
          qty: Number(line.qty || 0),
          uom: line.uom,
          basis: line.basis || "MARKED_AT_RELEASE",
        }));
      return rollIds.length > 1
        ? logisticsService.releaseRolls(rollIds, mode, payloadLines)
        : logisticsService.releaseRoll(rollIds[0], mode, payloadLines);
    },
    onSuccess: (data) => {
      toast({ title: "Roll released", description: data.message });
      setReleaseRolls([]);
      setRollPackLines([]);
      setSelectedRollIds([]);
      invalidate();
    },
    onError: (error) =>
      toast({
        title: "Roll release failed",
        description: err(error),
        variant: "destructive",
      }),
  });

  const getQueueRoute = (row: any): Exclude<PackingRouteFilter, "ALL"> => {
    const pendingBatches = Number(row.pending?.batches_count || 0);
    const pendingGonnies =
      Number(row.pending?.open_gonnies_count || 0) +
      Number(row.pending?.sealed_gonnies_count || 0);
    const readyGonnies = Number(row.ready_for_dispatch?.gonnies_count || 0);
    const pendingRolls = Number(row.pending?.rolls_count || 0);
    const readyRolls = Number(row.ready_for_dispatch?.rolls_count || 0);
    if (pendingBatches || pendingGonnies || readyGonnies) return "POUCH";
    if (pendingRolls || readyRolls) return "ROLL";
    return "RELEASE";
  };

  const pendingUnitsOf = (row: any) =>
    Number(row.pending?.batches_count || 0) +
    Number(row.pending?.open_gonnies_count || 0) +
    Number(row.pending?.sealed_gonnies_count || 0) +
    Number(row.pending?.rolls_count || 0);
  const readyUnitsOf = (row: any) =>
    Number(row.ready_for_dispatch?.gonnies_count || 0) +
    Number(row.ready_for_dispatch?.rolls_count || 0);

  const getQueueStatus = (row: any): Exclude<QueueStatusFilter, "ALL"> => {
    const pendingUnits = pendingUnitsOf(row);
    const readyUnits = readyUnitsOf(row);
    if (pendingUnits && readyUnits) return "IN_PROGRESS";
    if (readyUnits) return "READY";
    return "WAITING";
  };

  const customerOptions = useMemo(
    () =>
      Array.from(
        new Set(
          (board.data?.orders || [])
            .map((row) => row.sales_order.customer_name)
            .filter(Boolean),
        ),
      ).sort(),
    [board.data?.orders],
  );

  const cards = (board.data?.orders || [])
    .filter((row) => {
      const term = search.trim().toLowerCase();
      const haystack =
        `${row.sales_order.order_number} ${row.sales_order.customer_name}`.toLowerCase();
      if (term && !haystack.includes(term)) return false;
      if (routeFilter !== "ALL" && getQueueRoute(row) !== routeFilter)
        return false;
      if (statusFilter !== "ALL" && getQueueStatus(row) !== statusFilter)
        return false;
      if (
        customerFilter !== "ALL" &&
        row.sales_order.customer_name !== customerFilter
      )
        return false;
      return true;
    })
    .sort((a, b) => {
      if (sortMode === "READY_DESC") return readyUnitsOf(b) - readyUnitsOf(a);
      if (sortMode === "SO_ASC")
        return a.sales_order.order_number.localeCompare(
          b.sales_order.order_number,
        );
      if (sortMode === "CUSTOMER_ASC")
        return a.sales_order.customer_name.localeCompare(
          b.sales_order.customer_name,
        );
      return (
        pendingUnitsOf(b) +
        readyUnitsOf(b) * 2 -
        (pendingUnitsOf(a) + readyUnitsOf(a) * 2)
      );
    });
  const queuePageCount = Math.max(1, Math.ceil(cards.length / QUEUE_PAGE_SIZE));
  const safeQueuePage = Math.min(queuePage, queuePageCount);
  const queueStartIndex = (safeQueuePage - 1) * QUEUE_PAGE_SIZE;
  const pagedCards = cards.slice(
    queueStartIndex,
    queueStartIndex + QUEUE_PAGE_SIZE,
  );
  const shownStart = cards.length ? queueStartIndex + 1 : 0;
  const shownEnd = Math.min(cards.length, queueStartIndex + pagedCards.length);

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
  }, [search, routeFilter, statusFilter, customerFilter, sortMode]);

  useEffect(() => {
    setQueuePage((current) => Math.min(current, queuePageCount));
  }, [queuePageCount]);

  const selectedSummary = summary.data as SOPackingSummary | undefined;
  const selected =
    selectedOrderId &&
    cards.some((row) => String(row.sales_order.id) === selectedOrderId) &&
    String(selectedSummary?.sales_order.id || "") === selectedOrderId
      ? selectedSummary
      : undefined;
  const rawSelectedBatches = selected?.batches || [];
  const rawSelectedGonnies = [...(selected?.gonnies || [])].sort(
    (left, right) => getGonnyWorkRank(left) - getGonnyWorkRank(right),
  );
  const rawSelectedRollRows = selected?.rolls || [];
  const packingLineScopes = Array.from(
    [
      ...rawSelectedBatches.map((row: any) => ({
        row,
        kind: "BATCH" as const,
        pcs: Number(row.qty_pcs || 0),
        gross: Number(row.qty_kg || 0),
      })),
      ...rawSelectedGonnies.map((row: any) => ({
        row,
        kind: "GONNY" as const,
        pcs: Number(row.qty_pcs || 0),
        gross: Number(row.gross_weight_kg || row.weight_kg || 0),
      })),
      ...rawSelectedRollRows.map((row: any) => ({
        row,
        kind: "ROLL" as const,
        pcs: 0,
        gross: Number(row.gross_weight_kg || row.weight_kg || 0),
      })),
    ]
      .reduce((map, entry) => {
        const key = lineScopeKey(
          entry.row,
          `${entry.kind}-${entry.row?.id || map.size}`,
        );
        const current = map.get(key) || {
          key,
          name: lineScopeName(
            entry.row,
            entry.kind === "ROLL" ? "Roll product" : "Pouch product",
          ),
          spec: lineScopeSpec(entry.row),
          units: 0,
          rolls: 0,
          pcs: 0,
          gross: 0,
        };
        current.units += 1;
        current.rolls += entry.kind === "ROLL" ? 1 : 0;
        current.pcs += entry.pcs;
        current.gross += entry.gross;
        map.set(key, current);
        return map;
      }, new Map<string, { key: string; name: string; spec: string; units: number; rolls: number; pcs: number; gross: number }>())
      .values(),
  );
  const matchesLineFilter = (row: any, prefix: string) =>
    lineFilter === "ALL" ||
    lineScopeKey(row, `${prefix}-${row?.id || ""}`) === lineFilter;
  const selectedBatches = rawSelectedBatches.filter((batch: any) =>
    matchesLineFilter(batch, "BATCH"),
  );
  const selectedGonnies = rawSelectedGonnies.filter((gonny: any) =>
    matchesLineFilter(gonny, "GONNY"),
  );
  const selectedRollRows = rawSelectedRollRows.filter((roll: any) =>
    matchesLineFilter(roll, "ROLL"),
  );
  const selectedBatch = rawSelectedBatches.find(
    (batch) => batch.id === createBatchId,
  );
  const expected = sealGonny ? getGonnyExpected(sealGonny) : 0;
  const variance = actualGross ? Number(actualGross) - expected : 0;
  const variancePct = expected > 0 ? (variance / expected) * 100 : 0;
  const totals = board.data?.totals || {};
  const readyGross =
    Number(totals.ready_gonnies_gross_kg || 0) +
    Number(totals.ready_rolls_gross_kg || totals.ready_rolls_kg || 0);
  const readyNet =
    Number(totals.ready_gonnies_net_kg || 0) +
    Number(totals.ready_rolls_net_kg || totals.ready_rolls_kg || 0);
  const readyUnitsTotal =
    Number(totals.ready_gonnies || 0) + Number(totals.ready_rolls || 0);
  const hasRollWork = Boolean(
    selected &&
      (selectedRollRows.length ||
        (lineFilter === "ALL" &&
          (selected.packing_pending.rolls_count ||
            selected.ready_for_dispatch.rolls_count))),
  );
  const hasPouchWork = Boolean(
    selected &&
      (selectedBatches.length ||
        selectedGonnies.length ||
        (lineFilter === "ALL" &&
          (selected.packing_pending.batches_count ||
            selected.packing_pending.open_gonnies_count ||
            selected.ready_for_dispatch.gonnies_count))),
  );
  const recommendedRoute: RouteKind =
    hasRollWork && !hasPouchWork
      ? "ROLL_PACK"
      : hasPouchWork
        ? "POUCH_PACK"
        : "RELEASE_UNPACKED";
  const activeRoute = (routeChoice || recommendedRoute) as RouteKind;
  const firstSpecRow =
    selectedBatches[0] || selectedRollRows[0] || selectedGonnies[0];
  const productName =
    firstSpecRow?.product_name ||
    selectedBatches[0]?.template_name ||
    selectedRollRows[0]?.material__name ||
    "Order product";
  const lineReadyGonnyRows = selectedGonnies.filter(
    (gonny: any) => gonny.released_to_dispatch,
  );
  const lineReadyRollRows = selectedRollRows.filter(
    (roll: any) => roll.released_to_dispatch,
  );
  const linePendingBatchPcs = selectedBatches.reduce(
    (sum: number, batch: any) => sum + Number(batch.qty_pcs || 0),
    0,
  );
  const lineRollCount =
    lineFilter === "ALL"
      ? Number(
          rawSelectedRollRows.length ||
            selected?.packing_pending.rolls_count ||
            selected?.ready_for_dispatch.rolls_count ||
            0,
        )
      : selectedRollRows.length;
  const selectedGross =
    lineFilter === "ALL"
      ? Number(selected?.ready_for_dispatch.gonnies_gross_kg || 0) +
        Number(
          selected?.ready_for_dispatch.rolls_gross_kg ||
            selected?.ready_for_dispatch.rolls_kg ||
            0,
        )
      : lineReadyGonnyRows.reduce(
          (sum: number, gonny: any) =>
            sum + Number(gonny.gross_weight_kg || gonny.weight_kg || 0),
          0,
        ) +
        lineReadyRollRows.reduce(
          (sum: number, roll: any) =>
            sum + Number(roll.gross_weight_kg || roll.weight_kg || 0),
          0,
        );
  const selectedNet =
    lineFilter === "ALL"
      ? Number(selected?.ready_for_dispatch.gonnies_net_kg || 0) +
        Number(
          selected?.ready_for_dispatch.rolls_net_kg ||
            selected?.ready_for_dispatch.rolls_kg ||
            0,
        )
      : lineReadyGonnyRows.reduce(
          (sum: number, gonny: any) =>
            sum + Number(gonny.net_product_weight_kg || 0),
          0,
        ) +
        lineReadyRollRows.reduce(
          (sum: number, roll: any) =>
            sum + Number(roll.net_weight_kg || roll.weight_kg || 0),
          0,
        );
  const producedPcs =
    selectedBatches.reduce((sum, b: any) => sum + Number(b.qty_pcs || 0), 0) +
    selectedGonnies.reduce((sum, g: any) => sum + Number(g.qty_pcs || 0), 0);
  const producedRollKg = selectedRollRows.reduce(
    (sum, roll: any) => sum + Number(roll.net_weight_kg || roll.weight_kg || 0),
    0,
  );
  const producedLabel =
    hasRollWork && hasPouchWork
      ? `${n(producedRollKg)} kg · ${n(producedPcs, 0)} pcs`
      : hasRollWork
        ? `${n(producedRollKg)} kg`
        : `${n(producedPcs, 0)} pcs`;
  const selectedPendingUnits =
    lineFilter === "ALL"
      ? Number(selected?.packing_pending.batches_count || 0) +
        Number(selected?.packing_pending.rolls_count || 0) +
        Number(selected?.packing_pending.open_gonnies_count || 0) +
        Number(selected?.packing_pending.sealed_gonnies_count || 0)
      : selectedBatches.length +
        selectedGonnies.filter((gonny: any) => !gonny.released_to_dispatch)
          .length +
        selectedRollRows.filter((roll: any) => !roll.released_to_dispatch)
          .length;
  const selectedReadyUnits =
    lineFilter === "ALL"
      ? Number(selected?.ready_for_dispatch.gonnies_count || 0) +
        Number(selected?.ready_for_dispatch.rolls_count || 0)
      : lineReadyGonnyRows.length + lineReadyRollRows.length;
  const selectedProgress =
    selectedPendingUnits + selectedReadyUnits > 0
      ? Math.round(
          (selectedReadyUnits / (selectedPendingUnits + selectedReadyUnits)) *
            100,
        )
      : 0;
  const selectedRollsForBulk = selectedRollRows.filter(
    (roll: any) =>
      selectedRollIds.includes(roll.id) && !roll.released_to_dispatch,
  );
  const openRollIds = selectedRollRows
    .filter((roll: any) => !roll.released_to_dispatch)
    .map((roll: any) => roll.id);
  const bulkNet = selectedRollsForBulk.reduce(
    (sum, roll: any) => sum + Number(roll.net_weight_kg || roll.weight_kg || 0),
    0,
  );
  const bulkGross = selectedRollsForBulk.reduce(
    (sum, roll: any) =>
      sum + Number(roll.gross_weight_kg || roll.weight_kg || 0),
    0,
  );

  const paginate = <T,>(rows: T[], page: number) => {
    const pageCount = Math.max(1, Math.ceil(rows.length / WORK_PAGE_SIZE));
    const safe = Math.min(page, pageCount);
    const start = (safe - 1) * WORK_PAGE_SIZE;
    const paged = rows.slice(start, start + WORK_PAGE_SIZE);
    return {
      pageCount,
      page: safe,
      start,
      paged,
      shownStart: rows.length ? start + 1 : 0,
      shownEnd: Math.min(rows.length, start + paged.length),
    };
  };
  const batchPaging = paginate(selectedBatches, batchPage);
  const gonnyPaging = paginate(selectedGonnies, gonnyPage);
  const rollPaging = paginate(selectedRollRows, rollPage);

  const activeRollCount = releaseRolls.length;
  const activeRollNet = releaseRolls.reduce(
    (sum, roll) => sum + Number(roll.net_weight_kg || roll.weight_kg || 0),
    0,
  );
  const activeRollTare = releaseRolls.reduce(
    (sum, roll) => sum + Number(roll.tare_weight_kg || 0),
    0,
  );
  const activeRollGross = releaseRolls.reduce(
    (sum, roll) => sum + Number(roll.gross_weight_kg || roll.weight_kg || 0),
    0,
  );
  const routeCounts = (board.data?.orders || []).reduce(
    (acc, row) => {
      const route = getQueueRoute(row);
      if (route === "POUCH") acc.pouch += 1;
      else if (route === "ROLL") acc.roll += 1;
      else acc.release += 1;
      return acc;
    },
    { pouch: 0, roll: 0, release: 0 },
  );
  const statusCounts = (board.data?.orders || []).reduce(
    (acc, row) => {
      acc[getQueueStatus(row)] += 1;
      return acc;
    },
    { READY: 0, IN_PROGRESS: 0, WAITING: 0 } as Record<string, number>,
  );
  const clearFilters = () => {
    setSearch("");
    setRouteFilter("ALL");
    setStatusFilter("ALL");
    setCustomerFilter("ALL");
    setSortMode("URGENCY");
    setQueuePage(1);
  };
  const openMaterialReadySlip = () => {
    if (!selectedOrderId || selectedReadyUnits === 0) return;
    const scopedSelection =
      lineFilter === "ALL"
        ? undefined
        : {
            rollIds: lineReadyRollRows
              .map((roll) => String(roll.id))
              .filter(Boolean),
            gonnyIds: lineReadyGonnyRows
              .map((gonny) => String(gonny.id))
              .filter(Boolean),
          };
    window.open(
      logisticsService.getMaterialReadySlipUrl(selectedOrderId, scopedSelection),
      "_blank",
      "noopener,noreferrer",
    );
  };
  const resetWork = () => {
    setSelectedRollIds([]);
    setCreateBatchId("");
    setBatchPage(1);
    setGonnyPage(1);
    setRollPage(1);
  };
  const selectPackingOrder = (orderId: string) => {
    setSelectedOrderId(orderId);
    setLineFilter("ALL");
    resetWork();
  };
  const selectPackingLine = (key: string) => {
    setLineFilter(key);
    resetWork();
  };

  useEffect(() => {
    setRouteChoice("");
    setLineFilter("ALL");
    resetWork();
  }, [selectedOrderId]);

  useEffect(() => {
    if (
      lineFilter !== "ALL" &&
      !packingLineScopes.some((scope) => scope.key === lineFilter)
    ) {
      selectPackingLine("ALL");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineFilter, packingLineScopes.length]);

  const openCreateGonny = (batch: SOPackingSummary["batches"][number]) => {
    setCreateBatchId(batch.id);
    setCreateQty(String(batch.qty_pcs || ""));
    setContentMode(
      (batch as any).default_content_mode === "PRIMARY_PACKS"
        ? "PRIMARY_PACKS"
        : "LOOSE_POUCHES",
    );
    setPrimaryPackCount("");
    if (!gonnyMaterialId && gonnies.length === 1) {
      setGonnyMaterialId(String(gonnies[0].id));
    }
    setCreateDialogOpen(true);
  };

  const openReleaseRolls = (rolls: any[]) => {
    const rollList = rolls.filter(Boolean);
    if (!rollList.length) return;
    const defaultSource =
      rollList.find(
        (roll) =>
          Array.isArray(roll.default_pack_lines) &&
          roll.default_pack_lines.length,
      ) || rollList[0];
    const defaults =
      Array.isArray(defaultSource.default_pack_lines) &&
      defaultSource.default_pack_lines.length
        ? defaultSource.default_pack_lines.map((line: any) => ({
            material_id: String(line.material_id || ""),
            qty: "0",
            uom: String(line.uom || "PCS"),
            basis: "MARKED_AT_RELEASE",
          }))
        : [];
    setReleaseRolls(rollList);
    setReleaseMode(activeRoute === "RELEASE_UNPACKED" ? "UNPACKED" : "PACKED");
    setRollPackLines(defaults);
  };

  const toggleRollPackLine = (line: RollPackLineDraft) => {
    setRollPackLines((current) =>
      current.some((item) => item.material_id === line.material_id)
        ? current.filter((item) => item.material_id !== line.material_id)
        : [...current, line],
    );
  };
  const toggleRollSelection = (rollId: string) => {
    setSelectedRollIds((ids) =>
      ids.includes(rollId)
        ? ids.filter((id) => id !== rollId)
        : [...ids, rollId],
    );
  };

  const anyFetching =
    board.isFetching || packaging.isFetching || summary.isFetching;
  const refreshAll = () => {
    void Promise.all([
      board.refetch(),
      packaging.refetch(),
      ...(selectedOrderId ? [summary.refetch()] : []),
    ]);
  };
  const boardStatus = board.isLoading
    ? { tone: "neutral" as const, text: "Loading yard…" }
    : board.isError
      ? { tone: "bad" as const, text: board.data ? "Refresh failed · showing last board" : "Board unavailable" }
      : board.isFetching
        ? { tone: "info" as const, text: "Refreshing…" }
        : { tone: "good" as const, text: "Live · auto-refresh 30s" };
  const heroValue = (value: number) => (board.data ? n(value, 0) : "—");
  const routeFilterOptions: { value: PackingRouteFilter; label: string; count: number }[] = [
    { value: "ALL", label: "All", count: board.data?.orders?.length || 0 },
    { value: "POUCH", label: "Pouch", count: routeCounts.pouch },
    { value: "ROLL", label: "Roll", count: routeCounts.roll },
    { value: "RELEASE", label: "Release", count: routeCounts.release },
  ];

  return (
    <div className="mx-auto max-w-[1760px] space-y-4" data-testid="packing-page">
      <PageHero
        compact
        eyebrow="Operations · Packing Yard"
        icon={<PackageOpen />}
        title="Packing Yard"
        description="Turn produced batches and rolls into weighed dispatch units, then release them to Dispatch Bay."
        meta={
          <>
            <HeroChip tone={boardStatus.tone}>{boardStatus.text}</HeroChip>
            {board.isError ? (
              <span role="alert" className="text-[12px] text-white/70">
                {err(board.error)}
              </span>
            ) : null}
          </>
        }
        actions={
          <>
            <Link
              href="/logistics/packing/audit"
              data-testid="packing-audit-link"
              className={heroButtonClass("ghost")}
            >
              <History /> Audit
            </Link>
            <Link
              href="/logistics/packing/consumption"
              data-testid="packing-evening-count-link"
              className={heroButtonClass("ghost")}
            >
              <ClipboardList /> Evening count
            </Link>
            <button
              type="button"
              onClick={refreshAll}
              disabled={anyFetching}
              className={heroButtonClass("primary")}
              aria-label="Refresh packing board, packaging materials, and selected order"
            >
              <RefreshCw className={cn(anyFetching && "animate-spin motion-reduce:animate-none")} />
              Refresh
            </button>
          </>
        }
      >
        <HeroStats columns={6}>
          <HeroStat
            testId="packing-route-filter-all"
            label="All orders"
            value={heroValue(board.data?.orders?.length || 0)}
            hint="Tap to show every order"
            active={routeFilter === "ALL"}
            onClick={() => setRouteFilter("ALL")}
          />
          <HeroStat
            testId="packing-route-filter-pouch"
            label="Pouch orders"
            tone="warn"
            value={heroValue(routeCounts.pouch)}
            hint="Batches → gonny / carton"
            active={routeFilter === "POUCH"}
            onClick={() => setRouteFilter("POUCH")}
          />
          <HeroStat
            testId="packing-route-filter-roll"
            label="Roll orders"
            tone="info"
            value={heroValue(routeCounts.roll)}
            hint="Pack or release rolls"
            active={routeFilter === "ROLL"}
            onClick={() => setRouteFilter("ROLL")}
          />
          <HeroStat
            label="Waiting to pack"
            value={board.data ? `${n(totals.pending_pcs || 0, 0)} pcs` : "—"}
            hint={
              board.data
                ? `${n(totals.pending_batches || 0, 0)} batches · ${n(totals.pending_rolls || 0, 0)} rolls`
                : "—"
            }
          />
          <HeroStat
            label="Open / sealed"
            value={
              board.data
                ? `${n(totals.open_gonnies || 0, 0)} / ${n(totals.sealed_waiting_release || 0, 0)}`
                : "—"
            }
            hint="Weigh, then release"
          />
          <HeroStat
            label="Ready for dispatch"
            tone="good"
            value={heroValue(readyUnitsTotal)}
            hint={board.data ? `${n(readyNet)} kg net · ${n(readyGross)} kg gross` : "—"}
          />
        </HeroStats>
      </PageHero>

      {/* Toolbar */}
      <section className="flex flex-col gap-2.5 rounded-[18px] border border-line bg-surface-1 p-2.5 shadow-[var(--shadow-sm)] xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-4" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search order or customer"
              aria-label="Search packing queue"
              className="h-9 rounded-xl pl-9"
            />
          </div>
          <FilterGroup
            label="Packing route"
            testIdPrefix="packing-filter-route"
            value={routeFilter}
            onChange={setRouteFilter}
            options={routeFilterOptions}
          />
          <FilterGroup
            label="Queue status"
            testIdPrefix="packing-filter-status"
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: "ALL", label: "Any status" },
              { value: "READY", label: "Ready", count: statusCounts.READY },
              { value: "IN_PROGRESS", label: "In progress", count: statusCounts.IN_PROGRESS },
              { value: "WAITING", label: "Waiting", count: statusCounts.WAITING },
            ]}
          />
          <select
            data-testid="packing-filter-customer"
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
            data-testid="packing-filter-sort"
            value={sortMode}
            onChange={(event) => setSortMode(event.target.value as PackingSortMode)}
            className={toolbarSelectClass}
            aria-label="Sort queue"
          >
            <option value="URGENCY">Sort: most work</option>
            <option value="READY_DESC">Ready units first</option>
            <option value="SO_ASC">SO number</option>
            <option value="CUSTOMER_ASC">Customer</option>
          </select>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="packing-filter-clear"
            onClick={clearFilters}
          >
            Clear
          </Button>
        </div>
        <Select value={selectedOrderId} onValueChange={selectPackingOrder}>
          <SelectTrigger
            data-testid="packing-sales-order-select"
            className="h-9 w-full rounded-xl xl:w-[300px]"
            aria-label="Jump to sales order"
          >
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
        {/* Queue */}
        <aside className="min-w-0">
          <div className="flex flex-col overflow-hidden rounded-[18px] border border-line bg-surface-1 shadow-[var(--shadow-sm)] xl:sticky xl:top-[88px] xl:max-h-[calc(100dvh-104px)]">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div>
                <div className="text-[13.5px] font-semibold text-content-1">
                  Orders in yard
                </div>
                <div className="text-[11.5px] text-content-3">
                  Sorted by{" "}
                  {sortMode === "URGENCY"
                    ? "most work"
                    : sortMode === "READY_DESC"
                      ? "ready units"
                      : sortMode === "SO_ASC"
                        ? "SO number"
                        : "customer"}
                </div>
              </div>
              <Pill tone="neutral">{n(cards.length, 0)}</Pill>
            </div>
            <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain p-2">
              {board.isLoading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="erp-skeleton h-[92px] rounded-xl" />
                  ))
                : null}
              {pagedCards.map((row) => {
                const readyUnits = readyUnitsOf(row);
                const pendingUnits = pendingUnitsOf(row);
                const total = readyUnits + pendingUnits;
                const readyPct = total
                  ? Math.round((readyUnits / total) * 100)
                  : 0;
                const route = getQueueRoute(row);
                const active = selectedOrderId === row.sales_order.id;
                return (
                  <button
                    key={row.sales_order.id}
                    type="button"
                    data-testid="packing-order-card"
                    data-route={route}
                    data-status={getQueueStatus(row)}
                    data-customer={row.sales_order.customer_name}
                    aria-current={active ? "true" : undefined}
                    onClick={() => selectPackingOrder(row.sales_order.id)}
                    className={cn(
                      "group relative w-full rounded-xl border px-3 py-2.5 text-left transition-[background-color,border-color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active
                        ? "border-primary/40 bg-info-bg shadow-[var(--shadow-sm)]"
                        : "border-transparent hover:border-line hover:bg-surface-2",
                    )}
                  >
                    {active ? (
                      <span className="absolute inset-y-2.5 left-0 w-[3px] rounded-r-full bg-primary" aria-hidden />
                    ) : null}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-mono text-[12.5px] font-semibold text-content-1">
                          {row.sales_order.order_number}
                        </div>
                        <div className="mt-0.5 truncate text-[12px] text-content-2">
                          {row.sales_order.customer_name}
                        </div>
                      </div>
                      <Pill
                        tone={route === "POUCH" ? "warn" : route === "ROLL" ? "info" : "accent"}
                      >
                        {ROUTE_LABEL[route]}
                      </Pill>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] text-content-3">
                      {Number(row.pending.batches_count || 0) ? (
                        <span>{n(row.pending.batches_count, 0)} to pack</span>
                      ) : null}
                      {Number(row.pending.rolls_count || 0) ? (
                        <span>{n(row.pending.rolls_count, 0)} rolls</span>
                      ) : null}
                      {Number(row.pending.open_gonnies_count || 0) ? (
                        <span className="text-info-fg">
                          {n(row.pending.open_gonnies_count, 0)} open
                        </span>
                      ) : null}
                      {Number(row.pending.sealed_gonnies_count || 0) ? (
                        <span className="text-order-fg">
                          {n(row.pending.sealed_gonnies_count, 0)} sealed
                        </span>
                      ) : null}
                      <span className="text-success-fg">{n(readyUnits, 0)} ready</span>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-2">
                        <div
                          className={cn(
                            "h-full rounded-full transition-[width] duration-500",
                            readyPct >= 100 ? "bg-success-fg" : "bg-primary",
                          )}
                          style={{ width: `${readyPct}%` }}
                        />
                      </div>
                      <span className="w-12 text-right text-[11px] tabular-nums text-content-3">
                        {readyUnits}/{total}
                      </span>
                    </div>
                  </button>
                );
              })}
              {!board.isLoading && !cards.length ? (
                <PanelEmpty icon={<PackageOpen />} title="No orders match">
                  {board.data?.orders?.length
                    ? "Try clearing the filters."
                    : "Nothing is waiting in the Packing Yard."}
                </PanelEmpty>
              ) : null}
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-2.5">
              <div data-testid="packing-queue-total" className="text-[11.5px] text-content-3">
                Showing {shownStart}-{shownEnd} of {cards.length} jobs
              </div>
              <Pager
                page={safeQueuePage}
                pageCount={queuePageCount}
                onPageChange={setQueuePage}
                testId="packing-queue-page"
              />
            </div>
          </div>
        </aside>

        {/* Workspace */}
        <main className="min-w-0 space-y-4">
          {summary.isError && selectedOrderId ? (
            <div role="alert" className="rounded-xl border border-danger-border bg-danger-bg px-4 py-3 text-[12.5px] text-danger-fg">
              Order details unavailable: {err(summary.error)}
            </div>
          ) : null}
          {packaging.isError ? (
            <div role="alert" className="rounded-xl border border-danger-border bg-danger-bg px-4 py-3 text-[12.5px] text-danger-fg">
              Packaging materials unavailable: {err(packaging.error)}
            </div>
          ) : null}
          {!selected ? (
            selectedOrderId && summary.isFetching ? (
              <div className="space-y-4">
                <div className="erp-skeleton h-[180px] rounded-[18px]" />
                <div className="erp-skeleton h-[360px] rounded-[18px]" />
              </div>
            ) : (
              <Panel>
                <PanelEmpty icon={<PackageOpen />} title="Pick an order from the queue">
                  Its products, packing route and every physical unit appear here.
                </PanelEmpty>
              </Panel>
            )
          ) : (
            <>
              {/* Order header */}
              <section className="erp-enter rounded-[18px] border border-line bg-surface-1 p-4 shadow-[var(--shadow-sm)] md:p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="flex min-w-0 items-start gap-4">
                    <ProgressRing
                      value={selectedProgress}
                      label={`${selectedProgress}% of yard units released`}
                    />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/sales/orders/${selected.sales_order.id}`}
                          className="font-mono text-[18px] font-semibold tracking-[-0.01em] text-content-1 hover:underline"
                        >
                          {selected.sales_order.order_number}
                        </Link>
                        <Pill
                          dot
                          tone={
                            selectedProgress >= 100
                              ? "good"
                              : selectedProgress > 0
                                ? "info"
                                : "warn"
                          }
                        >
                          {selectedProgress >= 100
                            ? "All units released"
                            : selectedProgress > 0
                              ? "Packing in progress"
                              : "Awaiting packing"}
                        </Pill>
                        <Pill tone="neutral">{titleCase(selected.sales_order.status)}</Pill>
                      </div>
                      <div className="mt-0.5 text-[13px] text-content-2">
                        {selected.sales_order.customer_name}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px] text-content-3">
                        <span className="font-medium text-content-1">{productName}</span>
                        {firstSpecRow?.size_label ? (
                          <span className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono">
                            {firstSpecRow.size_label}
                          </span>
                        ) : null}
                        {micronText(firstSpecRow?.thickness_label) ? (
                          <span className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono">
                            {micronText(firstSpecRow?.thickness_label)}
                          </span>
                        ) : null}
                        {packingLineScopes.length > 1 ? (
                          <span>+ {packingLineScopes.length - 1} more line{packingLineScopes.length > 2 ? "s" : ""}</span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      data-testid="packing-ready-slip"
                      disabled={!selectedOrderId || selectedReadyUnits === 0}
                      onClick={openMaterialReadySlip}
                    >
                      <FileText className="mr-1.5 h-3.5 w-3.5" />
                      {lineFilter === "ALL" ? "Ready slip" : "Line ready slip"}
                    </Button>
                    <Button asChild variant="outline" size="sm">
                      <Link
                        href={`/logistics/packing/audit?sales_order_id=${selected.sales_order.id}`}
                        data-testid="packing-audit-this-order"
                        title="Every packing material consumed for this order"
                      >
                        <History className="mr-1.5 h-3.5 w-3.5" /> Audit this order
                      </Link>
                    </Button>
                    <Button asChild size="sm">
                      <Link href="/logistics/dispatch">
                        <Truck className="mr-1.5 h-3.5 w-3.5" /> Dispatch Bay
                      </Link>
                    </Button>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
                  <OrderMetric label="Ordered" value={n(selected.ordered_qty)} sub="sales quantity" />
                  <OrderMetric label="In yard" value={producedLabel} sub="produced, not shipped" />
                  <OrderMetric
                    label="Still to pack"
                    value={n(selectedPendingUnits, 0)}
                    sub="batches, open & sealed units"
                    tone={selectedPendingUnits ? "warn" : undefined}
                  />
                  <OrderMetric
                    label="Released"
                    value={n(selectedReadyUnits, 0)}
                    sub="units in Dispatch Bay"
                    tone={selectedReadyUnits ? "good" : undefined}
                  />
                  <OrderMetric label="Released net" value={kg(selectedNet)} sub="billable product" />
                  <OrderMetric label="Released gross" value={kg(selectedGross)} sub="with packing tare" />
                </div>
              </section>

              {/* Line scope + route */}
              <section
                data-testid="packing-line-scope"
                className="rounded-[18px] border border-line bg-surface-1 p-4 shadow-[var(--shadow-sm)]"
              >
                <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_auto]">
                  <div className="min-w-0">
                    <div className="mb-2 flex items-center gap-2 text-[12px] font-medium text-content-3">
                      <Layers className="h-3.5 w-3.5" /> Sales-order lines
                    </div>
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      <button
                        type="button"
                        data-testid="packing-line-filter-all"
                        onClick={() => selectPackingLine("ALL")}
                        aria-pressed={lineFilter === "ALL"}
                        className={cn(
                          "shrink-0 rounded-xl border px-3 py-2 text-left transition",
                          lineFilter === "ALL"
                            ? "border-content-1 bg-content-1 text-surface-1"
                            : "border-line bg-surface-1 text-content-2 hover:border-line-strong",
                        )}
                      >
                        <div className="text-[12.5px] font-semibold">All lines</div>
                        <div className="text-[11.5px] opacity-75">
                          {n(rawSelectedBatches.length + rawSelectedGonnies.length + rawSelectedRollRows.length, 0)} units
                        </div>
                      </button>
                      {packingLineScopes.map((scope) => (
                        <button
                          key={scope.key}
                          type="button"
                          data-testid="packing-line-filter"
                          onClick={() => selectPackingLine(scope.key)}
                          aria-pressed={lineFilter === scope.key}
                          className={cn(
                            "w-[240px] shrink-0 rounded-xl border px-3 py-2 text-left transition",
                            lineFilter === scope.key
                              ? "border-content-1 bg-content-1 text-surface-1"
                              : "border-line bg-surface-1 text-content-2 hover:border-line-strong",
                          )}
                        >
                          <div className="truncate text-[12.5px] font-semibold">{scope.name}</div>
                          <div className="truncate text-[11.5px] opacity-75">
                            {scope.spec} · {scope.rolls ? `${n(scope.rolls, 0)} rolls` : `${n(scope.pcs, 0)} pcs`}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="min-w-0">
                    <div className="mb-2 flex items-center gap-2 text-[12px] font-medium text-content-3">
                      <Boxes className="h-3.5 w-3.5" /> Packing route
                    </div>
                    <div className="grid gap-2 sm:grid-cols-3">
                      {(
                        [
                          ["POUCH_PACK", "Pouch → gonny", `${n(lineFilter === "ALL" ? selected.packing_pending.batches_pcs || 0 : linePendingBatchPcs, 0)} pcs waiting`, !hasPouchWork],
                          ["ROLL_PACK", "Pack roll", `${n(lineRollCount, 0)} rolls · sheet / wrap`, !hasRollWork],
                          ["RELEASE_UNPACKED", "Release as-is", "Roll ships unwrapped", !hasRollWork],
                        ] as Array<[RouteKind, string, string, boolean]>
                      ).map(([route, title, copy, disabled]) => (
                        <button
                          key={route}
                          type="button"
                          data-testid={`packing-route-choice-${route}`}
                          disabled={disabled}
                          aria-pressed={activeRoute === route}
                          onClick={() => setRouteChoice(route)}
                          className={cn(
                            "relative min-w-[170px] rounded-xl border px-3 py-2 text-left transition",
                            activeRoute === route
                              ? "border-primary bg-info-bg ring-1 ring-primary/30"
                              : "border-line bg-surface-1 hover:border-line-strong",
                            disabled && "cursor-not-allowed opacity-45",
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[12.5px] font-semibold text-content-1">{title}</span>
                            {recommendedRoute === route ? (
                              <span className="rounded-full bg-success-bg px-1.5 py-0.5 text-[10px] font-semibold text-success-fg">
                                Suggested
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-0.5 text-[11.5px] text-content-3">{copy}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </section>

              {hasPouchWork && activeRoute === "POUCH_PACK" ? (
                <>
                  <Panel
                    flush
                    icon={<PackageOpen />}
                    title="Batches ready to pack"
                    description="Choose a batch to put pouches into a gonny or carton. It stays open until you weigh it."
                    actions={<Pill tone="warn">{n(selectedBatches.length, 0)} batches · {n(linePendingBatchPcs, 0)} pcs</Pill>}
                  >
                    {selectedBatches.length ? (
                      <ManifestTable label="Pouch batches waiting to be packed" minWidth={820} className="max-h-[480px]">
                        <thead>
                          <tr>
                            <Th className="w-[170px]">Batch</Th>
                            <Th>Product &amp; specification</Th>
                            <Th align="right" className="w-[130px]">Pouches</Th>
                            <Th className="w-[130px]">Packs as</Th>
                            <Th align="right" className="w-[150px]">Action</Th>
                          </tr>
                        </thead>
                        <tbody>
                          {batchPaging.paged.map((batch: any) => (
                            <tr key={batch.id} className="erp-manifest-row">
                              <Td>
                                <UnitCell label={batch.batch_number} kind="BATCH" location={batch.location?.name} />
                              </Td>
                              <Td>
                                <ProductSpecCell row={batch} fallbackName="Pouch product" />
                              </Td>
                              <Td align="right">
                                <div className="text-[13px] font-semibold tabular-nums text-content-1">
                                  {n(batch.qty_pcs, 0)}
                                  <span className="ml-0.5 text-[10.5px] font-normal text-content-4">pcs</span>
                                </div>
                                {Number(batch.qty_kg || 0) ? (
                                  <div className="mt-0.5 text-[11.5px] text-content-3 tabular-nums">{kg(batch.qty_kg)} net</div>
                                ) : null}
                              </Td>
                              <Td>
                                <Pill tone={batch.default_content_mode === "PRIMARY_PACKS" ? "accent" : "neutral"}>
                                  {batch.default_content_mode === "PRIMARY_PACKS" ? "Inner packs" : "Loose pouches"}
                                </Pill>
                              </Td>
                              <Td align="right">
                                <Button
                                  size="sm"
                                  data-testid={`packing-create-gonny-${batch.id}`}
                                  onClick={() => openCreateGonny(batch)}
                                >
                                  <PackageCheck className="mr-1.5 h-3.5 w-3.5" /> Create gonny
                                </Button>
                              </Td>
                            </tr>
                          ))}
                        </tbody>
                      </ManifestTable>
                    ) : (
                      <div className="px-5 pb-5">
                        <PanelEmpty title="No pouch batches waiting for this line">
                          Every produced batch has been packed. Open and sealed units are below.
                        </PanelEmpty>
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-2.5">
                      <div data-testid="packing-batch-work-total" className="text-[11.5px] text-content-3">
                        Showing {batchPaging.shownStart}-{batchPaging.shownEnd} of {selectedBatches.length} batches
                      </div>
                      <Pager page={batchPaging.page} pageCount={batchPaging.pageCount} onPageChange={setBatchPage} testId="packing-batch-work-page" />
                    </div>
                  </Panel>

                  <Panel
                    flush
                    icon={<Scale />}
                    title="Packing units"
                    description="Weigh open units to seal them, then release sealed units to Dispatch Bay."
                    actions={
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Pill tone="info" dot>{n(selectedGonnies.filter((g: any) => !g.gross_weight_kg).length, 0)} open</Pill>
                        <Pill tone="accent" dot>{n(selectedGonnies.filter((g: any) => g.gross_weight_kg && !g.released_to_dispatch).length, 0)} sealed</Pill>
                        <Pill tone="good" dot>{n(lineReadyGonnyRows.length, 0)} released</Pill>
                      </div>
                    }
                  >
                    {selectedGonnies.length ? (
                      <ManifestTable label="Gonny and carton packing units" minWidth={900} className="max-h-[560px]">
                        <thead>
                          <tr>
                            <Th className="w-[150px]">Unit</Th>
                            <Th>Product &amp; specification</Th>
                            <Th align="right" className="w-[92px]">Contents</Th>
                            <Th align="right" className="w-[150px]">Weight</Th>
                            <Th className="w-[138px]">Stage</Th>
                            <Th align="right" className="w-[112px]">Action</Th>
                          </tr>
                        </thead>
                        <tbody>
                          {gonnyPaging.paged.map((gonny: Gonny) => {
                            const stage = gonny.released_to_dispatch ? "RELEASED" : gonny.gross_weight_kg ? "SEALED" : "OPEN";
                            const variancePctRow = Number(gonny.gross_variance_pct || 0);
                            return (
                              <tr key={gonny.id} className="erp-manifest-row">
                                <Td>
                                  <UnitCell
                                    label={gonny.label_id || gonny.dispatch_unit_no}
                                    kind="GONNY"
                                    location={gonny.location?.name}
                                    sub={gonny.batch_no ? `from ${gonny.batch_no}` : undefined}
                                  />
                                </Td>
                                <Td>
                                  <ProductSpecCell row={gonny} fallbackName="Pouch product" />
                                </Td>
                                <Td align="right">
                                  <div className="text-[13px] font-semibold tabular-nums text-content-1">
                                    {n(gonny.qty_pcs, 0)}
                                    <span className="ml-0.5 text-[10.5px] font-normal text-content-4">pcs</span>
                                  </div>
                                  <div className="mt-0.5 text-[11px] text-content-3">
                                    {gonny.primary_pack_count
                                      ? `${n(gonny.primary_pack_count, 0)} inner packs`
                                      : gonny.content_mode === "PRIMARY_PACKS"
                                        ? "Inner packs"
                                        : "Loose"}
                                  </div>
                                </Td>
                                <Td align="right">
                                  <WeightStack
                                    net={gonny.net_product_weight_kg}
                                    tare={getGonnyTare(gonny)}
                                    gross={gonny.gross_weight_kg || getGonnyExpected(gonny)}
                                    grossEstimate={!gonny.gross_weight_kg}
                                    note={
                                      gonny.gross_weight_kg && Math.abs(variancePctRow) > 2 ? (
                                        <span className="text-warning-fg" title={gonny.gross_variance_reason || undefined}>
                                          {variancePctRow > 0 ? "+" : ""}
                                          {n(variancePctRow, 1)}% vs expected
                                        </span>
                                      ) : null
                                    }
                                  />
                                </Td>
                                <Td>
                                  <StagePill stage={stage} />
                                </Td>
                                <Td align="right">
                                  {stage === "OPEN" ? (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      data-testid={`packing-seal-gonny-${gonny.id}`}
                                      onClick={() => setSealGonny(gonny)}
                                    >
                                      <Scale className="mr-1.5 h-3.5 w-3.5" /> Weigh
                                    </Button>
                                  ) : stage === "SEALED" ? (
                                    <Button
                                      size="sm"
                                      data-testid={`packing-release-gonny-${gonny.id}`}
                                      onClick={() => {
                                        setReleaseGonnyTarget(gonny);
                                        setReleaseGonnyExtras([]);
                                      }}
                                    >
                                      <Send className="mr-1.5 h-3.5 w-3.5" /> Release
                                    </Button>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 text-[12px] text-success-fg">
                                      <Check className="h-3.5 w-3.5" /> Done
                                    </span>
                                  )}
                                </Td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </ManifestTable>
                    ) : (
                      <div className="px-5 pb-5">
                        <PanelEmpty title="No packing units yet">
                          Create a gonny from a batch above to start.
                        </PanelEmpty>
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-2.5">
                      <div data-testid="packing-gonny-work-total" className="text-[11.5px] text-content-3">
                        Showing {gonnyPaging.shownStart}-{gonnyPaging.shownEnd} of {selectedGonnies.length} gonnies
                      </div>
                      <Pager page={gonnyPaging.page} pageCount={gonnyPaging.pageCount} onPageChange={setGonnyPage} testId="packing-gonny-work-page" />
                    </div>
                  </Panel>
                </>
              ) : null}

              {hasRollWork && (activeRoute === "ROLL_PACK" || activeRoute === "RELEASE_UNPACKED") ? (
                <Panel
                  flush
                  icon={<Boxes />}
                  title={activeRoute === "ROLL_PACK" ? "Rolls · pack and release" : "Rolls · release as-is"}
                  description="Select one or many rolls. Each roll becomes its own dispatch unit."
                  actions={
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        data-testid="packing-roll-select-all"
                        disabled={!openRollIds.length}
                        onClick={() =>
                          setSelectedRollIds(
                            selectedRollIds.length === openRollIds.length ? [] : openRollIds,
                          )
                        }
                      >
                        {selectedRollIds.length ? "Clear selection" : "Select all open"}
                      </Button>
                      <Button
                        size="sm"
                        data-testid="packing-roll-bulk-release"
                        disabled={!selectedRollsForBulk.length}
                        onClick={() => openReleaseRolls(selectedRollsForBulk)}
                      >
                        <PackageCheck className="mr-1.5 h-3.5 w-3.5" />
                        {activeRoute === "ROLL_PACK" ? "Pack & release" : "Release"}{" "}
                        {selectedRollsForBulk.length ? `(${selectedRollsForBulk.length})` : ""}
                      </Button>
                    </div>
                  }
                >
                  {selectedRollsForBulk.length ? (
                    <div className="mx-4 mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-info-border bg-info-bg px-3 py-2 text-[12.5px] text-info-fg">
                      <span className="font-semibold">{selectedRollsForBulk.length} selected</span>
                      <span className="tabular-nums">{kg(bulkNet)} net</span>
                      <span className="tabular-nums">{kg(bulkGross)} gross</span>
                    </div>
                  ) : null}
                  {selectedRollRows.length ? (
                    <ManifestTable label="Roll packing manifest" minWidth={900} className="max-h-[620px]">
                      <thead>
                        <tr>
                          <Th className="w-[48px]" />
                          <Th className="w-[160px]">Roll</Th>
                          <Th>Product &amp; specification</Th>
                          <Th align="right" className="w-[150px]">Weight</Th>
                          <Th className="w-[138px]">Stage</Th>
                          <Th align="right" className="w-[112px]">Action</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {rollPaging.paged.map((roll: any, index: number) => {
                          const isSelected = selectedRollIds.includes(roll.id);
                          return (
                            <tr
                              key={roll.id}
                              className={cn("erp-manifest-row", isSelected && "is-selected")}
                            >
                              <Td>
                                {!roll.released_to_dispatch ? (
                                  <SelectBox
                                    checked={isSelected}
                                    onChange={() => toggleRollSelection(roll.id)}
                                    label={`Select roll ${roll.label_id}`}
                                    testId={`packing-roll-select-${roll.id}`}
                                    index={rollPaging.start + index + 1}
                                  />
                                ) : (
                                  <span className="grid h-6 w-6 place-items-center rounded-md bg-success-bg text-success-fg">
                                    <Check className="h-3.5 w-3.5" />
                                  </span>
                                )}
                              </Td>
                              <Td>
                                <UnitCell
                                  label={roll.label_id || roll.dispatch_unit_no}
                                  kind="ROLL"
                                  location={roll.location?.name}
                                  sub={roll.dispatch_lineage === "STOCK_CLAIM" ? "Stock claim" : roll.split_parent_label ? `split of ${roll.split_parent_label}` : undefined}
                                />
                              </Td>
                              <Td>
                                <ProductSpecCell row={roll} fallbackName="Roll product" />
                              </Td>
                              <Td align="right">
                                <WeightStack
                                  net={roll.net_weight_kg || roll.weight_kg}
                                  tare={roll.tare_weight_kg}
                                  gross={roll.gross_weight_kg || roll.weight_kg}
                                />
                              </Td>
                              <Td>
                                <StagePill stage={roll.released_to_dispatch ? "RELEASED" : "WAITING"} />
                              </Td>
                              <Td align="right">
                                {!roll.released_to_dispatch ? (
                                  <Button
                                    size="sm"
                                    data-testid={`packing-roll-release-${roll.id}`}
                                    onClick={() => openReleaseRolls([roll])}
                                  >
                                    <PackageCheck className="mr-1.5 h-3.5 w-3.5" />
                                    {activeRoute === "ROLL_PACK" ? "Pack" : "Release"}
                                  </Button>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-[12px] text-success-fg">
                                    <Check className="h-3.5 w-3.5" /> Done
                                  </span>
                                )}
                              </Td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </ManifestTable>
                  ) : (
                    <div className="px-5 pb-5">
                      <PanelEmpty title="No rolls on this line">
                        Released rolls are already visible in Dispatch Bay.
                      </PanelEmpty>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-2.5">
                    <div data-testid="packing-roll-work-total" className="text-[11.5px] text-content-3">
                      Showing {rollPaging.shownStart}-{rollPaging.shownEnd} of {selectedRollRows.length} rolls
                    </div>
                    <Pager page={rollPaging.page} pageCount={rollPaging.pageCount} onPageChange={setRollPage} testId="packing-roll-work-page" />
                  </div>
                </Panel>
              ) : null}

              {!hasPouchWork && !hasRollWork ? (
                <Panel>
                  <PanelEmpty icon={<Check />} title="Nothing left to pack on this order">
                    Released units are waiting in Dispatch Bay.
                  </PanelEmpty>
                </Panel>
              ) : null}

              {/* Trace links */}
              <section className="grid gap-3 md:grid-cols-3">
                {[
                  {
                    href: `/logistics/packing/audit?sales_order_id=${selected.sales_order.id}`,
                    icon: <History className="h-4 w-4" />,
                    title: "Packing material audit",
                    copy: "Gonnies, inner pouches and extras used on this order",
                  },
                  {
                    href: `/dashboard/planner/control-tower/completed-trace?search=${encodeURIComponent(selected.sales_order.order_number)}`,
                    icon: <ClipboardList className="h-4 w-4" />,
                    title: "Completed production trace",
                    copy: "Jobs, rolls and batches produced for this order",
                  },
                  {
                    href: `/dashboard/planner/control-tower/plan-queue?search=${encodeURIComponent(selected.sales_order.order_number)}`,
                    icon: <Layers className="h-4 w-4" />,
                    title: "Upstream plan queue",
                    copy: "Anything still planned or running for this order",
                  },
                ].map((item) => (
                  <Link
                    key={item.title}
                    href={item.href}
                    className="group flex items-start gap-3 rounded-2xl border border-line bg-surface-1 p-4 shadow-[var(--shadow-sm)] transition hover:-translate-y-px hover:border-line-strong hover:shadow-[var(--shadow-md)]"
                  >
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-content-2">
                      {item.icon}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2 text-[13px] font-semibold text-content-1">
                        {item.title}
                        <ArrowUpRight className="h-3.5 w-3.5 text-content-4 transition group-hover:text-content-1" />
                      </span>
                      <span className="mt-0.5 block text-[12px] text-content-3">{item.copy}</span>
                    </span>
                  </Link>
                ))}
              </section>
            </>
          )}
        </main>
      </section>

      {/* Create gonny */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent data-testid="packing-create-gonny-dialog" className="max-h-[90vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create gonny</DialogTitle>
            <DialogDescription>
              The unit stays open until you record its actual gross weight.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-xl border border-line bg-surface-2 p-3.5">
              {selectedBatch ? (
                <ProductSpecCell row={selectedBatch} fallbackName="Pouch product" />
              ) : (
                <div className="text-[13px] text-content-3">Select a pouch batch.</div>
              )}
              <div className="mt-2 text-[12px] text-content-3">
                Batch {selectedBatch?.batch_number || "—"} · {n(selectedBatch?.qty_pcs || 0, 0)} pcs available
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="packing-gonny-material">Gonny material</Label>
                <select
                  id="packing-gonny-material"
                  data-testid="packing-gonny-material"
                  value={gonnyMaterialId}
                  onChange={(event) => setGonnyMaterialId(event.target.value)}
                  className="h-10 w-full rounded-xl border border-input bg-surface-1 px-3 text-[13px]"
                >
                  <option value="">Select gonny stock</option>
                  {gonnies.map((item: PackagingMaterial) => (
                    <option key={item.id} value={item.id}>
                      {item.code} • {item.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="packing-gonny-qty">Pouches to pack</Label>
                <Input
                  id="packing-gonny-qty"
                  data-testid="packing-gonny-qty"
                  type="number"
                  min="1"
                  max={selectedBatch?.qty_pcs || undefined}
                  inputMode="numeric"
                  value={createQty}
                  onChange={(event) => setCreateQty(event.target.value)}
                  placeholder={selectedBatch ? String(selectedBatch.qty_pcs) : "Qty pcs"}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="packing-gonny-content-mode">Content mode</Label>
                <select
                  id="packing-gonny-content-mode"
                  data-testid="packing-gonny-content-mode"
                  value={contentMode}
                  onChange={(event) => setContentMode(event.target.value as any)}
                  className="h-10 w-full rounded-xl border border-input bg-surface-1 px-3 text-[13px]"
                >
                  <option value="LOOSE_POUCHES">Loose pouches</option>
                  <option value="PRIMARY_PACKS">Inner packs</option>
                </select>
              </div>
              {contentMode === "PRIMARY_PACKS" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="packing-gonny-inner">Inner pack count</Label>
                  <Input
                    id="packing-gonny-inner"
                    type="number"
                    min="1"
                    value={primaryPackCount}
                    onChange={(event) => setPrimaryPackCount(event.target.value)}
                    placeholder="Auto from sales pcs/pack"
                  />
                </div>
              ) : null}
            </div>
            {selectedBatch && Number(createQty) > Number(selectedBatch.qty_pcs || 0) ? (
              <div className="rounded-xl border border-warning-border bg-warning-bg px-3 py-2 text-[12.5px] text-warning-fg">
                That is more than the {n(selectedBatch.qty_pcs, 0)} pcs left in this batch.
              </div>
            ) : null}
            {!gonnies.length && !packaging.isLoading ? (
              <div className="rounded-xl border border-warning-border bg-warning-bg px-3 py-2 text-[12.5px] text-warning-fg">
                No gonny packaging masters exist yet. Add one in Master → Packaging.
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              data-testid="packing-gonny-submit"
              disabled={
                !createBatchId ||
                !createQty ||
                Number(createQty) <= 0 ||
                !gonnyMaterialId ||
                createMutation.isPending
              }
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? "Creating…" : "Create gonny"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Release rolls */}
      <Dialog open={Boolean(releaseRolls.length)} onOpenChange={(open) => !open && setReleaseRolls([])}>
        <DialogContent
          data-testid="packing-roll-dialog"
          className="max-h-[92vh] w-[calc(100vw-32px)] max-w-4xl overflow-hidden p-0"
        >
          <div className="max-h-[92vh] overflow-y-auto">
            <div className="border-b border-line p-5 sm:p-6">
              <DialogHeader>
                <DialogTitle>
                  {activeRollCount > 1 ? `Release ${activeRollCount} rolls to Dispatch Bay` : "Release roll to Dispatch Bay"}
                </DialogTitle>
                <DialogDescription>
                  Each roll becomes one dispatch unit. Material marks here are reconciled by the evening packing count.
                </DialogDescription>
              </DialogHeader>
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <OrderMetric label="Rolls" value={n(activeRollCount, 0)} />
                <OrderMetric label="Net" value={kg(activeRollNet)} />
                <OrderMetric label="Tare" value={kg(activeRollTare)} />
                <OrderMetric label="Gross" value={kg(activeRollGross)} />
              </div>
            </div>
            {releaseRolls.length ? (
              <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_minmax(340px,1fr)]">
                <div className="space-y-2">
                  <div className="text-[12px] font-medium text-content-3">Rolls in this release</div>
                  <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
                    {releaseRolls.map((roll) => (
                      <div key={roll.id} className="rounded-xl border border-line bg-surface-1 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="break-all font-mono text-[12.5px] font-semibold text-content-1">{roll.label_id}</span>
                          <span className="whitespace-nowrap text-[12px] tabular-nums text-content-2">
                            {kg(roll.net_weight_kg || roll.weight_kg)} net
                          </span>
                        </div>
                        <div className="mt-2">
                          <ProductSpecCell row={roll} fallbackName="Roll product" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="packing-roll-release-mode">Release mode</Label>
                    <select
                      id="packing-roll-release-mode"
                      data-testid="packing-roll-release-mode"
                      value={releaseMode}
                      onChange={(event) => setReleaseMode(event.target.value as any)}
                      className="h-10 w-full rounded-xl border border-input bg-surface-1 px-3 text-[13px]"
                    >
                      <option value="PACKED">Packed roll · sheet / wrap</option>
                      <option value="UNPACKED">Release unpacked roll</option>
                    </select>
                  </div>
                  {releaseMode === "PACKED" ? (
                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-[12px] font-medium text-content-3">Packing materials used</span>
                        <Pill tone={rollPackLines.length ? "good" : "warn"}>{rollPackLines.length} marked</Pill>
                      </div>
                      <div className="grid max-h-[300px] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                        {packingMarkMasters.length ? (
                          packingMarkMasters.map((material: PackagingMaterial, index: number) => {
                            const marked = rollPackLines.some((line) => line.material_id === material.id);
                            return (
                              <button
                                key={material.id}
                                type="button"
                                data-testid={`packing-roll-mark-material-${material.id}`}
                                data-allowed-index={index}
                                aria-pressed={marked}
                                onClick={() =>
                                  toggleRollPackLine({
                                    material_id: String(material.id || ""),
                                    qty: "0",
                                    uom: material.base_uom || "PCS",
                                    basis: "MARKED_AT_RELEASE",
                                  })
                                }
                                className={cn(
                                  "flex items-start gap-2.5 rounded-xl border p-2.5 text-left transition",
                                  marked ? "border-success-border bg-success-bg" : "border-line bg-surface-1 hover:border-line-strong",
                                )}
                              >
                                <span
                                  className={cn(
                                    "mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md border",
                                    marked ? "border-success-fg bg-success-fg text-white" : "border-line-strong",
                                  )}
                                >
                                  {marked ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
                                </span>
                                <span className="min-w-0">
                                  <span className="block truncate text-[12.5px] font-semibold text-content-1">{material.code}</span>
                                  <span className="block truncate text-[11.5px] text-content-3">{material.name || "Packing master"}</span>
                                </span>
                              </button>
                            );
                          })
                        ) : (
                          <div className="rounded-xl border border-warning-border bg-warning-bg p-3 text-[12.5px] text-warning-fg sm:col-span-2">
                            No active packaging masters. Add them before releasing packed rolls.
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-warning-border bg-warning-bg p-3 text-[12.5px] text-warning-fg">
                      Each roll ships as its own unit. No sheet, wrap, tape or label stock is marked.
                    </div>
                  )}
                </div>
              </div>
            ) : null}
            <DialogFooter className="border-t border-line p-4">
              <Button variant="outline" onClick={() => setReleaseRolls([])}>
                Cancel
              </Button>
              <Button
                data-testid="packing-roll-submit"
                disabled={
                  !releaseRolls.length ||
                  releaseRollMutation.isPending ||
                  (releaseMode === "PACKED" && !rollPackLines.length)
                }
                onClick={() =>
                  releaseRollMutation.mutate({
                    rollIds: releaseRolls.map((roll) => String(roll.id)),
                    mode: releaseMode,
                    lines: rollPackLines,
                  })
                }
              >
                {releaseRollMutation.isPending
                  ? "Releasing…"
                  : activeRollCount > 1
                    ? `Release ${activeRollCount} rolls`
                    : "Release roll"}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Seal gonny */}
      <Dialog open={Boolean(sealGonny)} onOpenChange={(open) => !open && setSealGonny(null)}>
        <DialogContent data-testid="packing-seal-gonny-dialog" className="max-h-[90vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Weigh and seal {sealGonny ? clean(sealGonny.dispatch_unit_no || sealGonny.label_id) : "gonny"}</DialogTitle>
            <DialogDescription>
              Put the unit on the scale and enter the actual gross weight.
            </DialogDescription>
          </DialogHeader>
          {sealGonny ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <OrderMetric label="Product net" value={kg(sealGonny.net_product_weight_kg)} sub={`${n(sealGonny.qty_pcs || 0, 0)} pcs`} />
                <OrderMetric
                  label="Inner tare"
                  value={kg(sealGonny.inner_pack_tare_kg)}
                  sub={sealGonny.primary_pack_count ? `${n(sealGonny.primary_pack_count, 0)} inner packs` : "loose"}
                />
                <OrderMetric label="Gonny tare" value={kg(sealGonny.secondary_pack_tare_kg)} sub="from master" />
                <OrderMetric label="Expected gross" value={kg(expected)} sub="net + tare" tone="good" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="packing-gonny-seal-weight">Actual gross weight (kg)</Label>
                <Input
                  id="packing-gonny-seal-weight"
                  data-testid="packing-gonny-seal-weight"
                  type="number"
                  step="0.001"
                  inputMode="decimal"
                  autoFocus
                  value={actualGross}
                  onChange={(event) => setActualGross(event.target.value)}
                  className="h-12 text-[18px] font-semibold tabular-nums"
                />
              </div>
              {actualGross ? (
                <div
                  className={cn(
                    "flex items-center justify-between rounded-xl px-3 py-2.5 text-[13px] font-medium",
                    Math.abs(variancePct) > 2 ? "bg-warning-bg text-warning-fg" : "bg-success-bg text-success-fg",
                  )}
                >
                  <span>Variance vs expected</span>
                  <span className="tabular-nums">
                    {variance > 0 ? "+" : ""}
                    {n(variance, 3)} kg ({n(variancePct, 2)}%)
                  </span>
                </div>
              ) : null}
              {Math.abs(variancePct) > 2 ? (
                <div className="space-y-1.5">
                  <Label htmlFor="packing-gonny-variance-reason">Variance reason (required above 2%)</Label>
                  <Textarea
                    id="packing-gonny-variance-reason"
                    data-testid="packing-gonny-variance-reason"
                    value={varianceReason}
                    onChange={(event) => setVarianceReason(event.target.value)}
                    placeholder="Why does the actual weight differ from expected?"
                  />
                </div>
              ) : null}
              <p className="text-[11.5px] text-content-3">
                Gonny and inner-pouch stock were consumed when this unit was created · see Packing audit.
              </p>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSealGonny(null)}>
              Cancel
            </Button>
            <Button
              data-testid="packing-gonny-seal-submit"
              disabled={
                !actualGross ||
                Number(actualGross) <= 0 ||
                (Math.abs(variancePct) > 2 && !varianceReason.trim()) ||
                sealMutation.isPending
              }
              onClick={() => sealMutation.mutate()}
            >
              {sealMutation.isPending ? "Sealing…" : "Seal unit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ReleaseGonnyDialog
        gonny={releaseGonnyTarget}
        extras={releaseGonnyExtras}
        setExtras={setReleaseGonnyExtras}
        packagingMaterials={packingMarkMasters}
        onCancel={() => {
          setReleaseGonnyTarget(null);
          setReleaseGonnyExtras([]);
        }}
        onSubmit={(lines) =>
          releaseGonnyMutation.mutate({
            gonnyId: releaseGonnyTarget!.id,
            lines,
          })
        }
        submitting={releaseGonnyMutation.isPending}
      />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// ReleaseGonnyDialog — mark-only tagger for the gonny release step.
// These marks do not post stock; stock movement comes from the
// timestamped packing stock count.
// ────────────────────────────────────────────────────────────────────

type GonnyReleaseExtra = {
  id: string;
  material_id: string;
  qty: string;
  notes: string;
};

function ReleaseGonnyDialog({
  gonny,
  extras,
  setExtras,
  packagingMaterials,
  onCancel,
  onSubmit,
  submitting,
}: {
  gonny: Gonny | null;
  extras: GonnyReleaseExtra[];
  setExtras: (next: GonnyReleaseExtra[]) => void;
  packagingMaterials: PackagingMaterial[];
  onCancel: () => void;
  onSubmit: (
    lines: Array<{
      material_id: string;
      qty: number;
      uom?: string;
      notes?: string;
    }>,
  ) => void;
  submitting: boolean;
}) {
  const addExtra = () =>
    setExtras([
      ...extras,
      {
        id: `tmp-${Math.random().toString(36).slice(2, 8)}`,
        material_id: "",
        qty: "",
        notes: "",
      },
    ]);
  const patchExtra = (idx: number, patch: Partial<GonnyReleaseExtra>) => {
    const next = [...extras];
    next[idx] = { ...next[idx], ...patch };
    setExtras(next);
  };
  const removeExtra = (idx: number) => setExtras(extras.filter((_, i) => i !== idx));
  const validLines = extras
    .filter((l) => l.material_id)
    .map((l) => ({
      material_id: l.material_id,
      qty: Number(l.qty || 0),
      uom: packagingMaterials.find((m) => m.id === l.material_id)?.base_uom || "PCS",
      notes: l.notes || undefined,
    }));
  return (
    <Dialog open={Boolean(gonny)} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Release {gonny ? clean(gonny.dispatch_unit_no || gonny.label_id) : ""} to Dispatch Bay</DialogTitle>
          <DialogDescription>
            Optionally mark extra packing materials used. Stock posts from the evening count, not this dialog.
          </DialogDescription>
        </DialogHeader>
        {gonny ? (
          <div className="grid grid-cols-3 gap-2">
            <OrderMetric label="Pouches" value={n(gonny.qty_pcs, 0)} />
            <OrderMetric label="Net" value={kg(gonny.net_product_weight_kg)} />
            <OrderMetric label="Gross" value={kg(gonny.gross_weight_kg || gonny.weight_kg)} />
          </div>
        ) : null}
        <div className="space-y-2">
          {extras.map((ln, idx) => (
            <div key={ln.id} className="grid grid-cols-[minmax(0,1fr)_88px_minmax(0,140px)_32px] items-center gap-2">
              <Select value={ln.material_id} onValueChange={(v) => patchExtra(idx, { material_id: v })}>
                <SelectTrigger className="h-9 text-[12.5px]">
                  <SelectValue placeholder="Packing SKU" />
                </SelectTrigger>
                <SelectContent>
                  {packagingMaterials.length === 0 ? (
                    <div className="px-3 py-2 text-[12px] text-content-3">No catalog SKUs</div>
                  ) : (
                    packagingMaterials.map((m) => (
                      <SelectItem key={m.id} value={m.id!}>
                        {m.code}
                        {m.name && m.name !== m.code ? ` · ${m.name}` : ""}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <Input
                type="number"
                placeholder="Qty"
                value={ln.qty}
                onChange={(e) => patchExtra(idx, { qty: e.target.value })}
                className="h-9 text-right text-[12.5px]"
              />
              <Input
                value={ln.notes}
                placeholder="Notes"
                onChange={(e) => patchExtra(idx, { notes: e.target.value })}
                className="h-9 text-[12.5px]"
              />
              <button
                type="button"
                onClick={() => removeExtra(idx)}
                className="grid h-9 w-8 place-items-center rounded-lg text-content-3 hover:bg-danger-bg hover:text-danger-fg"
                aria-label="Remove material"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
          <Button type="button" size="sm" variant="ghost" onClick={addExtra}>
            + Add packing material
          </Button>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            data-testid="packing-gonny-release-submit"
            disabled={submitting}
            onClick={() => onSubmit(validLines)}
          >
            <Send className="mr-1.5 h-4 w-4" />
            {submitting
              ? "Releasing…"
              : validLines.length > 0
                ? `Release · ${validLines.length} material${validLines.length > 1 ? "s" : ""}`
                : "Release to Dispatch Bay"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

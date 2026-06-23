"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Check,
  ClipboardList,
  History,
  Layers,
  PackageCheck,
  PackageOpen,
  Scale,
  Search,
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
  type Gonny,
  type SOPackingSummary,
} from "@/services/logistics";
import {
  masterDataService,
  type PackagingMaterial,
} from "@/services/master-data";

const n = (value: unknown, digits = 1) =>
  Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: digits });
const kg = (value: unknown) =>
  `${Number(value || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kg`;
const err = (error: any) =>
  error?.response?.data?.error ||
  error?.response?.data?.detail ||
  error?.message ||
  "Request failed.";
const clean = (value: unknown) => String(value ?? "").trim();
const compactStackSpec = (
  layers: unknown,
  thickness: unknown,
  grade: unknown,
) => {
  const parts: string[] = [];
  const layerText = clean(layers);
  if (
    layerText &&
    layerText !== "-" &&
    !/^1\s*layers?$/i.test(layerText)
  ) {
    parts.push(layerText.replace(/\s*layers?$/i, "L"));
  }
  const thicknessText = clean(thickness).replace(/\s*microns?$/i, "");
  if (thicknessText && thicknessText !== "-") parts.push(thicknessText);
  const gradeText = clean(grade);
  if (gradeText && gradeText !== "-") parts.push(gradeText);
  return parts.length ? parts.join(" · ") : "-";
};
const compactUnitLabel = (value: unknown, kind: "ROLL" | "GONNY") => {
  const raw = clean(value);
  if (!raw) return kind;
  if (raw.length <= 18) return raw;
  const terminal = raw.match(/(?:^|-)(\d{2,5})(?:-(?:NEW|MOD|SPL|COMB|REM))?$/i);
  if (terminal) {
    const suffix = terminal[1].replace(/^0+(?=\d)/, "");
    return kind === "ROLL" ? `RDU-${suffix}` : `GNY-${suffix}`;
  }
  const token = raw.replace(/[^A-Z0-9]+/gi, "").slice(-7);
  return `${kind}-${token || raw.slice(-7)}`;
};
const compactLocationLabel = (value: unknown) => {
  const raw = clean(value);
  if (!raw) return "";
  return raw
    .replace(/\bFinished\s+Goods\s+Store\b/i, "FG")
    .replace(/\bDispatch\s+Plant\b/i, "Dispatch")
    .replace(/\s+/g, " ")
    .trim();
};
const netPcsLabel = (net: unknown, pcs: unknown) => {
  const pieces = Number(pcs || 0);
  return pieces > 0
    ? `${n(net)} kg · ${n(pieces, 0)} pcs`
    : `${n(net)} kg`;
};
const lineScopeKey = (row: any, fallback: string) => {
  const explicit = clean(row?.sales_order_item_id);
  if (explicit) return explicit;
  const semantic = [
    clean(row?.product_code),
    clean(row?.product_name || row?.material__name || row?.template_name),
    clean(row?.size_label || row?.width_mm),
    clean(row?.thickness_label),
    clean(row?.grade_label),
  ]
    .filter(Boolean)
    .join("|");
  return semantic || fallback;
};
const lineScopeName = (row: any, fallback: string) =>
  clean(row?.product_name || row?.material__name || row?.template_name) ||
  fallback;
const lineScopeSpec = (row: any) =>
  [
    clean(row?.size_label || (row?.width_mm ? `${row.width_mm}MM` : "")),
    compactStackSpec(row?.layers_label, row?.thickness_label, row?.grade_label),
    clean(row?.product_code),
  ]
    .filter((part) => part && part !== "-")
    .join(" · ") || "Order line";
const productionBatchLabel = (row: any) => {
  const batch = clean(row?.production_batch_number);
  return batch ? `Batch ${batch}` : "";
};
const routeNodeLabel = (row: any) => {
  const route = row?.route_node || {};
  const node = clean(route?.label || route?.name || row?.route_node_id || route?.id);
  const branch = clean(row?.route_branch_key || route?.branch_key);
  return [node, branch && branch !== node ? branch : ""].filter(Boolean).join(" · ");
};
const QUEUE_PAGE_SIZE = 8;
const WORK_PAGE_SIZE = 8;

function Stat({
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
    | "pouch"
    | "roll"
    | "release"
    | "blue"
    | "green"
    | "amber"
    | "violet"
    | "slate"
    | "red";
}) {
  const tones = {
    pouch: "border-warning-border bg-warning-bg text-warning-fg",
    roll: "border-danger-border bg-danger-bg text-danger-fg",
    release: "border-order-border bg-order-bg text-order-fg",
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
  alert = false,
}: {
  label: string;
  value: string;
  hint?: string;
  alert?: boolean;
}) {
  return (
    <div
      className={`rounded-[10px] border p-3 ${alert ? "border-danger-border bg-danger-bg" : "border-line bg-surface-1"}`}
    >
      <div
        className={`text-[10px] font-black uppercase tracking-[0.22em] ${alert ? "text-danger-fg" : "text-content-4"}`}
      >
        {label}
      </div>
      <div
        className={`mt-1 text-xl font-black tracking-tight ${alert ? "text-danger-fg" : "text-content-1"}`}
      >
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

function getGonnyExpected(gonny: Gonny) {
  return Number(
    gonny.expected_gross_weight_kg ??
      gonny.tare_breakdown_json?.expected_gross_weight_kg ??
      gonny.tare_breakdown_json?.gross_weight_kg ??
      0,
  );
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

export default function PackingYardPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [routeFilter, setRouteFilter] = useState<PackingRouteFilter>("ALL");
  const [statusFilter, setStatusFilter] = useState<QueueStatusFilter>("ALL");
  const [customerFilter, setCustomerFilter] = useState("ALL");
  const [variantFilter, setVariantFilter] = useState<PackingRouteFilter>("ALL");
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
    queryFn: logisticsService.getPackingBoard,
    refetchInterval: 30000,
  });
  const summary = useQuery({
    queryKey: ["packing-summary", selectedOrderId],
    queryFn: () => logisticsService.getSOPackingSummary(selectedOrderId),
    enabled: Boolean(selectedOrderId),
  });
  const packaging = useQuery({
    queryKey: ["packaging-materials"],
    queryFn: masterDataService.getPackaging,
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
  const packagingById = useMemo(
    () =>
      new Map((packaging.data || []).map((item) => [String(item.id), item])),
    [packaging.data],
  );
  const materialLabel = (materialId: string) => {
    const material = packagingById.get(String(materialId));
    return material
      ? `${material.code} · ${material.name}`
      : String(materialId || "Allowed material");
  };

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["packing-board"] });
    queryClient.invalidateQueries({
      queryKey: ["packing-summary", selectedOrderId],
    });
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
    mutationFn: ({
      rollIds,
      mode,
      lines,
    }: {
      rollIds: string[];
      mode: "PACKED" | "UNPACKED";
      lines: RollPackLineDraft[];
    }) => {
      const payloadLines: Array<{
        material_id: string;
        qty: number;
        uom?: string;
        basis?: string;
      }> = (lines || [])
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

  const getQueueStatus = (row: any): Exclude<QueueStatusFilter, "ALL"> => {
    const pendingUnits =
      Number(row.pending?.batches_count || 0) +
      Number(row.pending?.open_gonnies_count || 0) +
      Number(row.pending?.sealed_gonnies_count || 0) +
      Number(row.pending?.rolls_count || 0);
    const readyUnits =
      Number(row.ready_for_dispatch?.gonnies_count || 0) +
      Number(row.ready_for_dispatch?.rolls_count || 0);
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
      const route = getQueueRoute(row);
      const status = getQueueStatus(row);
      if (term && !haystack.includes(term)) return false;
      if (routeFilter !== "ALL" && route !== routeFilter) return false;
      if (variantFilter !== "ALL" && route !== variantFilter) return false;
      if (statusFilter !== "ALL" && status !== statusFilter) return false;
      if (
        customerFilter !== "ALL" &&
        row.sales_order.customer_name !== customerFilter
      )
        return false;
      return true;
    })
    .sort((a, b) => {
      const pendingA =
        Number(a.pending?.batches_count || 0) +
        Number(a.pending?.open_gonnies_count || 0) +
        Number(a.pending?.sealed_gonnies_count || 0) +
        Number(a.pending?.rolls_count || 0);
      const pendingB =
        Number(b.pending?.batches_count || 0) +
        Number(b.pending?.open_gonnies_count || 0) +
        Number(b.pending?.sealed_gonnies_count || 0) +
        Number(b.pending?.rolls_count || 0);
      const readyA =
        Number(a.ready_for_dispatch?.gonnies_count || 0) +
        Number(a.ready_for_dispatch?.rolls_count || 0);
      const readyB =
        Number(b.ready_for_dispatch?.gonnies_count || 0) +
        Number(b.ready_for_dispatch?.rolls_count || 0);
      if (sortMode === "READY_DESC") return readyB - readyA;
      if (sortMode === "SO_ASC")
        return a.sales_order.order_number.localeCompare(
          b.sales_order.order_number,
        );
      if (sortMode === "CUSTOMER_ASC")
        return a.sales_order.customer_name.localeCompare(
          b.sales_order.customer_name,
        );
      return pendingB + readyB * 2 - (pendingA + readyA * 2);
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
  }, [
    search,
    routeFilter,
    statusFilter,
    customerFilter,
    variantFilter,
    sortMode,
  ]);

  useEffect(() => {
    setQueuePage((current) => Math.min(current, queuePageCount));
  }, [queuePageCount]);

  const selected = summary.data as SOPackingSummary | undefined;
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
        units: 1,
        pcs: Number(row.qty_pcs || 0),
        gross: Number(row.qty_kg || 0),
      })),
      ...rawSelectedGonnies.map((row: any) => ({
        row,
        kind: "GONNY" as const,
        units: 1,
        pcs: Number(row.qty_pcs || 0),
        gross: Number(row.gross_weight_kg || row.weight_kg || 0),
      })),
      ...rawSelectedRollRows.map((row: any) => ({
        row,
        kind: "ROLL" as const,
        units: 1,
        pcs: 0,
        gross: Number(row.gross_weight_kg || row.weight_kg || 0),
      })),
    ]
      .reduce((map, entry) => {
        const key = lineScopeKey(entry.row, `${entry.kind}-${entry.row?.id || map.size}`);
        const current = map.get(key) || {
          key,
          name: lineScopeName(entry.row, entry.kind === "ROLL" ? "Roll product" : "Pouch product"),
          spec: lineScopeSpec(entry.row),
          units: 0,
          batches: 0,
          gonnies: 0,
          rolls: 0,
          pcs: 0,
          gross: 0,
        };
        current.units += entry.units;
        current.batches += entry.kind === "BATCH" ? 1 : 0;
        current.gonnies += entry.kind === "GONNY" ? 1 : 0;
        current.rolls += entry.kind === "ROLL" ? 1 : 0;
        current.pcs += entry.pcs;
        current.gross += entry.gross;
        map.set(key, current);
        return map;
      }, new Map<string, { key: string; name: string; spec: string; units: number; batches: number; gonnies: number; rolls: number; pcs: number; gross: number }>())
      .values(),
  );
  const matchesLineFilter = (row: any, prefix: string) =>
    lineFilter === "ALL" || lineScopeKey(row, `${prefix}-${row?.id || ""}`) === lineFilter;
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
  const readyGross =
    Number(board.data?.totals.ready_gonnies_gross_kg || 0) +
    Number(
      board.data?.totals.ready_rolls_gross_kg ||
        board.data?.totals.ready_rolls_kg ||
        0,
    );
  const readyNet =
    Number(board.data?.totals.ready_gonnies_net_kg || 0) +
    Number(board.data?.totals.ready_rolls_kg || 0);
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
  const variantFamily =
    hasRollWork && !hasPouchWork
      ? "ROLL"
      : hasRollWork
        ? "ROLL + POUCH"
        : "POUCH";
  const productSize =
    firstSpecRow?.size_label ||
    (selectedRollRows[0]?.width_mm ? `${selectedRollRows[0].width_mm} mm` : "") ||
    "order spec";
  const productLayerSpec = compactStackSpec(
    firstSpecRow?.layers_label,
    firstSpecRow?.thickness_label,
    firstSpecRow?.grade_label,
  );
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
  const lineReadyGonnyPcs =
    lineFilter === "ALL"
      ? Number(selected?.ready_for_dispatch.gonnies_pcs || 0)
      : lineReadyGonnyRows.reduce(
          (sum: number, gonny: any) => sum + Number(gonny.qty_pcs || 0),
          0,
        );
  const lineOpenGonnyCount =
    lineFilter === "ALL"
      ? Number(selected?.packing_pending.open_gonnies_count || 0)
      : selectedGonnies.filter((gonny: any) => !gonny.released_to_dispatch)
          .length;
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
  const selectedProducedRollKg =
    selectedRollRows.reduce(
      (sum, roll: any) =>
        sum + Number(roll.net_weight_kg || roll.weight_kg || 0),
      0,
    ) +
    (lineFilter === "ALL"
      ? Number(
          selected?.ready_for_dispatch.rolls_net_kg ||
            selected?.ready_for_dispatch.rolls_kg ||
            0,
        )
      : 0);
  const selectedProducedPcs =
    selectedBatches.reduce(
      (sum, batch: any) => sum + Number(batch.qty_pcs || 0),
      0,
    ) +
    (lineFilter === "ALL"
      ? Number(selected?.ready_for_dispatch.gonnies_pcs || 0)
      : 0);
  const selectedProducedLabel =
    hasRollWork && hasPouchWork
      ? `${n(selectedProducedRollKg)} kg / ${n(selectedProducedPcs, 0)} pcs`
      : hasRollWork
        ? `${n(selectedProducedRollKg)} kg`
        : `${n(selectedProducedPcs, 0)} pcs`;
  const selectedPendingUnits =
    lineFilter === "ALL"
      ? Number(selected?.packing_pending.batches_count || 0) +
        Number(selected?.packing_pending.rolls_count || 0) +
        Number(selected?.packing_pending.open_gonnies_count || 0)
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
      : selectedReadyUnits
        ? 100
        : 0;
  const selectedRollsForBulk = selectedRollRows.filter(
    (roll: any) =>
      selectedRollIds.includes(roll.id) && !roll.released_to_dispatch,
  );
  const batchPageCount = Math.max(
    1,
    Math.ceil(selectedBatches.length / WORK_PAGE_SIZE),
  );
  const safeBatchPage = Math.min(batchPage, batchPageCount);
  const batchStartIndex = (safeBatchPage - 1) * WORK_PAGE_SIZE;
  const pagedBatches = selectedBatches.slice(
    batchStartIndex,
    batchStartIndex + WORK_PAGE_SIZE,
  );
  const batchShownStart = selectedBatches.length ? batchStartIndex + 1 : 0;
  const batchShownEnd = Math.min(
    selectedBatches.length,
    batchStartIndex + pagedBatches.length,
  );
  const gonnyPageCount = Math.max(
    1,
    Math.ceil(selectedGonnies.length / WORK_PAGE_SIZE),
  );
  const safeGonnyPage = Math.min(gonnyPage, gonnyPageCount);
  const gonnyStartIndex = (safeGonnyPage - 1) * WORK_PAGE_SIZE;
  const pagedGonnies = selectedGonnies.slice(
    gonnyStartIndex,
    gonnyStartIndex + WORK_PAGE_SIZE,
  );
  const gonnyShownStart = selectedGonnies.length ? gonnyStartIndex + 1 : 0;
  const gonnyShownEnd = Math.min(
    selectedGonnies.length,
    gonnyStartIndex + pagedGonnies.length,
  );
  const rollPageCount = Math.max(
    1,
    Math.ceil(selectedRollRows.length / WORK_PAGE_SIZE),
  );
  const safeRollPage = Math.min(rollPage, rollPageCount);
  const rollStartIndex = (safeRollPage - 1) * WORK_PAGE_SIZE;
  const pagedRolls = selectedRollRows.slice(
    rollStartIndex,
    rollStartIndex + WORK_PAGE_SIZE,
  );
  const rollShownStart = selectedRollRows.length ? rollStartIndex + 1 : 0;
  const rollShownEnd = Math.min(
    selectedRollRows.length,
    rollStartIndex + pagedRolls.length,
  );
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
  const clearFilters = () => {
    setSearch("");
    setRouteFilter("ALL");
    setStatusFilter("ALL");
    setCustomerFilter("ALL");
    setVariantFilter("ALL");
    setSortMode("URGENCY");
    setQueuePage(1);
  };
  const openMaterialReadySlip = () => {
    if (!selectedOrderId) return;
    window.open(logisticsService.getMaterialReadySlipUrl(selectedOrderId), "_blank");
  };
  const selectPackingOrder = (orderId: string) => {
    setSelectedOrderId(orderId);
    setLineFilter("ALL");
    setSelectedRollIds([]);
    setCreateBatchId("");
    setBatchPage(1);
    setGonnyPage(1);
    setRollPage(1);
  };
  const selectPackingLine = (key: string) => {
    setLineFilter(key);
    setSelectedRollIds([]);
    setCreateBatchId("");
    setBatchPage(1);
    setGonnyPage(1);
    setRollPage(1);
  };

  useEffect(() => {
    setRouteChoice("");
    setSelectedRollIds([]);
    setLineFilter("ALL");
    setCreateBatchId("");
    setBatchPage(1);
    setGonnyPage(1);
    setRollPage(1);
  }, [selectedOrderId]);

  useEffect(() => {
    if (
      lineFilter !== "ALL" &&
      !packingLineScopes.some((scope) => scope.key === lineFilter)
    ) {
      selectPackingLine("ALL");
    }
  }, [lineFilter, packingLineScopes]);

  useEffect(() => {
    setBatchPage((current) => Math.min(current, batchPageCount));
  }, [batchPageCount]);

  useEffect(() => {
    setGonnyPage((current) => Math.min(current, gonnyPageCount));
  }, [gonnyPageCount]);

  useEffect(() => {
    setRollPage((current) => Math.min(current, rollPageCount));
  }, [rollPageCount]);

  const openCreateGonny = (batch: SOPackingSummary["batches"][number]) => {
    setCreateBatchId(batch.id);
    setCreateQty(String(batch.qty_pcs || ""));
    setContentMode(
      (batch as any).default_content_mode === "PRIMARY_PACKS"
        ? "PRIMARY_PACKS"
        : "LOOSE_POUCHES",
    );
    setPrimaryPackCount("");
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

  const openReleaseRoll = (roll: any) => openReleaseRolls([roll]);
  const toggleRollPackLine = (line: RollPackLineDraft) => {
    setRollPackLines((current) => {
      const exists = current.some((item) => item.material_id === line.material_id);
      if (exists) {
        return current.filter((item) => item.material_id !== line.material_id);
      }
      return [...current, line];
    });
  };
  const toggleRollSelection = (rollId: string) => {
    setSelectedRollIds((ids) =>
      ids.includes(rollId)
        ? ids.filter((id) => id !== rollId)
        : [...ids, rollId],
    );
  };

  return (
    <div
      className="mx-auto max-w-[1900px] space-y-3 p-3 lg:p-4"
      data-testid="packing-page"
    >
      <section className="overflow-hidden rounded-[18px] border border-order-border bg-gradient-to-br from-primary via-order-fg to-order-fg p-4 text-white shadow-xl ">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="text-[11px] font-black uppercase tracking-[0.24em] text-white/70">
              Operations · Packing Yard
            </div>
            <h1 className="mt-1 text-xl font-black tracking-tight">
              Pack, batch, label - order-aware.
            </h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/logistics/packing/audit"
              data-testid="packing-audit-link"
              className="inline-flex items-center rounded-full border border-surface-1/25 bg-surface-1/10 px-3 py-1.5 text-xs font-black text-white shadow-sm backdrop-blur transition hover:-translate-y-0.5 hover:bg-surface-1/20"
            >
              <History className="mr-1.5 h-3.5 w-3.5" /> Audit
            </Link>
            <Link
              href="/logistics/packing/consumption"
              data-testid="packing-evening-count-link"
              className="inline-flex items-center rounded-full border border-surface-1/25 bg-surface-1 px-3 py-1.5 text-xs font-black text-primary shadow-sm transition hover:-translate-y-0.5 hover:bg-info-bg"
            >
              <ClipboardList className="mr-1.5 h-3.5 w-3.5" /> Evening count
            </Link>
            {[
              {
                label: "All routes",
                value: "ALL" as const,
                count: board.data?.orders?.length || 0,
              },
              {
                label: "Pouch",
                value: "POUCH" as const,
                count: routeCounts.pouch,
              },
              {
                label: "Roll",
                value: "ROLL" as const,
                count: routeCounts.roll,
              },
              {
                label: "Release",
                value: "RELEASE" as const,
                count: routeCounts.release,
              },
            ].map((item) => (
              <button
                key={item.value}
                type="button"
                data-testid={`packing-route-filter-${item.value.toLowerCase()}`}
                onClick={() => setRouteFilter(item.value)}
                className={`rounded-full border px-3 py-1.5 text-xs font-black shadow-sm backdrop-blur transition ${routeFilter === item.value ? "border-surface-1 bg-surface-1 text-primary" : "border-surface-1/20 bg-surface-1/10 text-white hover:bg-surface-1/20"}`}
              >
                {item.label} · {n(item.count, 0)}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-8">
          <Stat
            label="In-bound jobs"
            value={n(board.data?.totals.orders || cards.length || 0, 0)}
            hint={`${n(cards.length, 0)} shown now`}
          />
          <Stat
            label="Awaiting decision"
            value={n(board.data?.totals.pending_batches || 0, 0)}
            hint={`${n(board.data?.totals.pending_pcs || 0, 0)} pcs pending`}
          />
          <Stat
            label="Pouch in-progress"
            value={n(board.data?.totals.open_gonnies || 0, 0)}
            hint="open gonnies"
          />
          <Stat
            label="Roll bundling"
            value={n(board.data?.totals.ready_rolls || 0, 0)}
            hint={`${n(board.data?.totals.ready_rolls_kg || 0)} kg net`}
          />
          <Stat
            label="Released unpacked"
            value={n(board.data?.totals.ready_rolls || 0, 0)}
            hint="rolls direct"
          />
          <Stat
            label="Net ready"
            value={`${n(readyNet)} kg`}
            hint="billable product"
          />
          <Stat
            label="Gross ready"
            value={`${n(readyGross)} kg`}
            hint="with tare"
          />
          <Stat
            label="Photos missing"
            value={n(board.data?.totals.photos_missing || 0, 0)}
            hint="photo / hold gaps"
          />
        </div>
      </section>

      <section className="sticky top-2 z-[1] rounded-[16px] border border-line bg-surface-1/95 p-2 shadow-sm backdrop-blur">
        <div className="grid gap-2 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="text-[10px] font-black uppercase tracking-[0.22em] text-content-4">
              Filters
            </span>
            {(
              [
                ["ALL", "All", cards.length],
                ["POUCH", "Pouch", routeCounts.pouch],
                ["ROLL", "Roll", routeCounts.roll],
                ["RELEASE", "Release", routeCounts.release],
              ] as Array<[PackingRouteFilter, string, number]>
            ).map(([value, label, count]) => (
              <button
                key={value}
                type="button"
                data-testid={`packing-filter-route-${value.toLowerCase()}`}
                onClick={() => setRouteFilter(value)}
                className={`h-9 rounded-full border px-3 text-xs font-black transition ${routeFilter === value ? "border-primary bg-primary text-white shadow-sm" : "border-line bg-surface-1 text-content-2 hover:border-primary"}`}
              >
                {label} {n(count, 0)}
              </button>
            ))}
            {(["ALL", "READY", "IN_PROGRESS", "WAITING"] as QueueStatusFilter[]).map(
              (value) => (
                <button
                  key={value}
                  type="button"
                  data-testid={`packing-filter-status-${value.toLowerCase()}`}
                  onClick={() => setStatusFilter(value)}
                  className={`h-9 rounded-full border px-3 text-xs font-black transition ${statusFilter === value ? "border-success-border bg-success-bg text-success-fg shadow-sm" : "border-line bg-surface-1 text-content-2 hover:border-success-border"}`}
                >
                  {value === "ALL" ? "Any status" : value.replace("_", " ")}
                </button>
              ),
            )}
            <select
              data-testid="packing-filter-customer"
              value={customerFilter}
              onChange={(event) => setCustomerFilter(event.target.value)}
              className="h-9 max-w-[190px] rounded-full border border-line bg-surface-1 px-3 text-sm font-bold text-content-2 shadow-sm"
            >
              <option value="ALL">All customers</option>
              {customerOptions.map((customer) => (
                <option key={customer} value={customer}>
                  {customer}
                </option>
              ))}
            </select>
            <select
              data-testid="packing-filter-variant"
              value={variantFilter}
              onChange={(event) =>
                setVariantFilter(event.target.value as PackingRouteFilter)
              }
              className="h-9 rounded-full border border-line bg-surface-1 px-3 text-sm font-bold text-content-2 shadow-sm"
            >
              <option value="ALL">All unit types</option>
              <option value="POUCH">Pouch/gonny</option>
              <option value="ROLL">Rolls</option>
            </select>
            <select
              data-testid="packing-filter-sort"
              value={sortMode}
              onChange={(event) =>
                setSortMode(event.target.value as PackingSortMode)
              }
              className="h-9 rounded-full border border-line bg-surface-1 px-3 text-sm font-bold text-content-2 shadow-sm"
            >
              <option value="URGENCY">Sort: urgency</option>
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
          <div className="grid gap-2 xl:w-[560px] xl:grid-cols-[1fr_230px]">
            <div className="relative">
              <Search className="absolute left-4 top-3.5 h-4 w-4 text-content-4" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search SO, customer, roll, batch..."
                className="h-12 rounded-2xl border-line bg-surface-1 pl-10 shadow-sm"
              />
            </div>
            <Select value={selectedOrderId} onValueChange={selectPackingOrder}>
              <SelectTrigger
                data-testid="packing-sales-order-select"
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

      <section className="grid gap-3 xl:grid-cols-[minmax(200px,248px)_minmax(0,1fr)]">
        <aside className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            <span className="rounded-full border border-order-border bg-order-bg px-2.5 py-1 text-xs font-black text-order-fg">
              All {n(cards.length, 0)}
            </span>
            <span className="rounded-full border border-warning-border bg-surface-1 px-2.5 py-1 text-xs font-black text-content-2">
              P {n(routeCounts.pouch, 0)}
            </span>
            <span className="rounded-full border border-danger-border bg-surface-1 px-2.5 py-1 text-xs font-black text-content-2">
              R {n(routeCounts.roll, 0)}
            </span>
            <span className="rounded-full border border-order-border bg-surface-1 px-2.5 py-1 text-xs font-black text-content-2">
              U {n(routeCounts.release, 0)}
            </span>
          </div>
          <div className="max-h-[calc(100dvh-300px)] space-y-2 overflow-y-auto overscroll-contain pr-1">
            {pagedCards.map((row) => {
              const readyUnits =
                Number(row.ready_for_dispatch.gonnies_count || 0) +
                Number(row.ready_for_dispatch.rolls_count || 0);
              const pendingUnits =
                Number(row.pending.batches_count || 0) +
                Number(row.pending.rolls_count || 0) +
                Number(row.pending.open_gonnies_count || 0);
              const totalUnits = Math.max(1, readyUnits + pendingUnits);
              const readyPct = Math.min(
                100,
                Math.round((readyUnits / totalUnits) * 100),
              );
              const rowRoute: RouteKind =
                Number(row.pending.batches_count || 0) > 0
                  ? "POUCH_PACK"
                  : Number(row.pending.rolls_count || 0) > 0 ||
                      Number(row.ready_for_dispatch.rolls_count || 0) > 0
                    ? "ROLL_PACK"
                    : "RELEASE_UNPACKED";
              return (
                <button
                  key={row.sales_order.id}
                  data-testid="packing-order-card"
                  data-route={getQueueRoute(row)}
                  data-status={getQueueStatus(row)}
                  data-customer={row.sales_order.customer_name}
                  onClick={() => selectPackingOrder(row.sales_order.id)}
                  className={`relative w-full overflow-hidden rounded-[12px] border p-3 text-left shadow-sm transition ${selectedOrderId === row.sales_order.id ? "border-order-border bg-order-bg" : "border-line bg-surface-1 hover:-translate-y-0.5 hover:border-order-border"}`}
                >
                  <span
                    className={`absolute inset-y-0 left-0 w-1 ${rowRoute === "POUCH_PACK" ? "bg-warning-fg" : rowRoute === "ROLL_PACK" ? "bg-danger-fg" : "bg-order-fg"}`}
                  />
                  <div className="pl-1">
                      <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-mono text-xs font-black text-content-1">
                          {row.sales_order.order_number}
                        </div>
                        <div className="mt-0.5 line-clamp-1 text-xs font-black text-content-1">
                          {row.sales_order.customer_name}
                        </div>
                      </div>
                      <Chip
                        tone={
                          rowRoute === "POUCH_PACK"
                            ? "pouch"
                            : rowRoute === "ROLL_PACK"
                              ? "roll"
                              : "release"
                        }
                      >
                        {rowRoute === "POUCH_PACK"
                          ? "POUCH"
                          : rowRoute === "ROLL_PACK"
                            ? "ROLL"
                            : "RELEASE"}
                      </Chip>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      <Chip tone={rowRoute === "POUCH_PACK" ? "pouch" : "roll"}>
                        {rowRoute === "POUCH_PACK" ? "POUCH" : "ROLL"}
                      </Chip>
                      <Chip tone="green">ready {readyUnits}</Chip>
                      <Chip tone="amber">pending {pendingUnits}</Chip>
                    </div>
                    <div className="mt-2 grid grid-cols-4 gap-1.5 text-[10px]">
                      <div>
                        <div className="font-bold text-content-4">Batches</div>
                        <div className="font-black">
                          {n(row.pending.batches_count || 0, 0)}
                        </div>
                      </div>
                      <div>
                        <div className="font-bold text-content-4">Open</div>
                        <div className="font-black text-primary">
                          {n(row.pending.open_gonnies_count || 0, 0)}
                        </div>
                      </div>
                      <div>
                        <div className="font-bold text-content-4">Sealed</div>
                        <div className="font-black text-success-fg">
                          {n(
                            row.pending.sealed_gonnies_count ||
                              row.ready_for_dispatch.gonnies_count ||
                              0,
                            0,
                          )}
                        </div>
                      </div>
                      <div>
                        <div className="font-bold text-content-4">Rolls</div>
                        <div className="font-black">
                          {n(
                            row.ready_for_dispatch.rolls_count ||
                              row.pending.rolls_count ||
                              0,
                            0,
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
                      <span
                        className="block h-full rounded-full bg-primary"
                        style={{ width: `${readyPct}%` }}
                      />
                    </div>
                    <div className="mt-1 flex justify-between text-[11px] font-semibold text-content-3">
                      <span>{readyPct}% of yard units ready</span>
                      <span>
                        {readyUnits} of {readyUnits + pendingUnits}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
            {!cards.length && (
              <div className="rounded-[18px] border border-dashed border-line bg-surface-1 p-8 text-center text-sm font-semibold text-content-3">
                No jobs awaiting packing.
              </div>
            )}
          </div>
          <div className="rounded-[14px] border border-line bg-surface-1 p-3 shadow-sm">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div
                data-testid="packing-queue-total"
                className="text-xs font-bold text-content-3"
              >
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

        <main className="min-w-0 space-y-4">
          {!selected ? (
            <div className="rounded-[18px] border border-dashed border-line-strong bg-surface-1 p-12 text-center">
              <PackageOpen className="mx-auto h-10 w-10 text-content-4" />
              <h2 className="mt-3 text-xl font-black">
                Pick an SO from the queue.
              </h2>
              <p className="mt-2 text-sm font-semibold text-content-3">
                The center panel will show its specs, route, and packing work.
              </p>
            </div>
          ) : (
            <>
              <div className="rounded-[16px] border border-order-border bg-order-bg p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="text-[10px] font-black uppercase tracking-[0.28em] text-order-fg">
                    Selected · order-aware specs
                  </div>
                  <Link
                    href={`/logistics/packing/audit?sales_order_id=${selected.sales_order.id}`}
                    data-testid="packing-audit-this-order"
                    className="inline-flex items-center gap-1.5 rounded-full bg-surface-1 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-content-2 shadow-md ring-1 ring-line hover:shadow-lg hover:text-content-1 transition"
                    title="See every packing material consumed for this order"
                  >
                    <History className="h-3 w-3" /> Audit this order
                  </Link>
                </div>
                <div className="mt-2 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-md bg-info-bg px-2 py-1 font-mono text-sm font-black text-primary">
                        {selected.sales_order.order_number}
                      </span>
                      <span className="text-sm font-black text-content-1">
                        {selected.sales_order.customer_name}
                      </span>
                      <Chip
                        tone={
                          selectedProgress >= 100
                            ? "green"
                            : selectedProgress > 0
                              ? "blue"
                              : "amber"
                        }
                      >
                        {selectedProgress >= 100
                          ? "ready"
                          : selectedProgress > 0
                            ? "in-progress"
                            : "awaiting"}
                      </Chip>
                    </div>
                    <div className="mt-1 text-xs font-semibold text-content-3">
                      Promised dispatch from SO · ready {selectedReadyUnits}{" "}
                      unit{selectedReadyUnits === 1 ? "" : "s"} · pending{" "}
                      {selectedPendingUnits}
                    </div>
                    <h2 className="mt-2 text-xl font-black tracking-tight text-content-1">
                      {productName}
                    </h2>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Chip tone={hasRollWork ? "roll" : "pouch"}>
                        {variantFamily}
                      </Chip>
                      <Chip tone="blue">{productSize}</Chip>
                      {productLayerSpec !== "-" && (
                        <Chip tone="slate">{productLayerSpec}</Chip>
                      )}
                    <Chip tone="violet">tare + gross tracked</Chip>
                    <button
                      type="button"
                      data-testid="packing-ready-slip"
                      disabled={!selectedOrderId}
                      onClick={openMaterialReadySlip}
                      className="inline-flex items-center rounded-md border border-info-border bg-info-bg px-2 py-0.5 text-[11px] font-black uppercase tracking-[0.04em] text-info-fg disabled:opacity-50"
                    >
                      Ready slip
                    </button>
                    </div>
                  </div>
                </div>
                <div className="mt-3 grid gap-2 border-t border-order-border pt-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
                  <MiniMetric
                    label="Ordered"
                    value={n(selected.ordered_qty)}
                    hint="sales quantity"
                  />
                  <MiniMetric
                    label="Produced"
                    value={selectedProducedLabel}
                    hint="yard available"
                  />
                  <MiniMetric
                    label="Ready"
                    value={n(selectedReadyUnits, 0)}
                    hint="dispatch units"
                  />
                  <MiniMetric
                    label="Remaining"
                    value={n(selectedPendingUnits, 0)}
                    hint="packing tasks"
                  />
                  <MiniMetric
                    label="Ready net"
                    value={`${n(selectedNet)} kg`}
                    hint="billable"
                  />
                  <MiniMetric
                    label="Ready gross"
                    value={`${n(selectedGross)} kg`}
                    hint="with tare"
                  />
                </div>
                <div className="mt-3 grid gap-3 border-t border-order-border pt-3 text-xs lg:grid-cols-2">
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-[0.22em] text-content-4">
                      Layers
                    </span>
                    <div className="mt-1 font-semibold text-content-2">
                      {productLayerSpec !== "-"
                        ? productLayerSpec
                        : hasRollWork
                          ? "Roll output from machine terminal"
                          : "Pouch batch output"}{" "}
                      · net/tare/gross audit preserved
                    </div>
                  </div>
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-[0.22em] text-content-4">
                      Packing recipe
                    </span>
                    <div className="mt-1 font-semibold text-content-2">
                      {activeRoute === "POUCH_PACK"
                        ? "Create gonny/carton from pouch batches, seal gross, release"
                        : activeRoute === "ROLL_PACK"
                          ? "Pack roll with sheet or wrap, consume material, release"
                          : "Each roll becomes one direct dispatch unit"}
                    </div>
                  </div>
                </div>
              </div>

              <div
                data-testid="packing-line-scope"
                className="rounded-[14px] border border-line bg-surface-1 p-3 shadow-sm"
              >
                <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                  <div>
                    <h3 className="text-sm font-black text-content-1">
                      Line scope
                    </h3>
                    <p className="mt-0.5 text-xs font-semibold text-content-3">
                      Filter the yard to one sales-order line before packing or
                      releasing units.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      data-testid="packing-line-filter-all"
                      onClick={() => selectPackingLine("ALL")}
                      className={`rounded-full border px-3 py-2 text-xs font-black transition ${
                        lineFilter === "ALL"
                          ? "border-primary bg-primary text-white shadow-sm"
                          : "border-line bg-surface-1 text-content-2 hover:border-primary"
                      }`}
                    >
                      All lines ·{" "}
                      {n(
                        rawSelectedBatches.length +
                          rawSelectedGonnies.length +
                          rawSelectedRollRows.length,
                        0,
                      )}
                    </button>
                    {packingLineScopes.map((scope) => (
                      <button
                        key={scope.key}
                        type="button"
                        data-testid="packing-line-filter"
                        onClick={() => selectPackingLine(scope.key)}
                        className={`min-w-[190px] rounded-[12px] border px-3 py-2 text-left text-xs transition ${
                          lineFilter === scope.key
                            ? "border-order-border bg-order-bg shadow-sm"
                            : "border-line bg-surface-1 hover:border-order-border"
                        }`}
                      >
                        <div className="truncate font-black text-content-1">
                          {scope.name}
                        </div>
                        <div className="mt-0.5 truncate font-semibold text-content-3">
                          {scope.spec || "Order line spec"} ·{" "}
                          {scope.rolls
                            ? `${n(scope.rolls, 0)} rolls`
                            : `${n(scope.pcs, 0)} pcs`}{" "}
                          · {n(scope.gross)} kg
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="rounded-[14px] border border-line bg-surface-1 p-3 shadow-sm">
                <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
                  <div>
                    <h3 className="text-sm font-black text-content-1">
                      Route
                    </h3>
                  </div>
                  <span className="text-[11px] font-semibold text-content-3">
                    Order qty {n(selected.ordered_qty)} ·{" "}
                    {selected.sales_order.status}
                  </span>
                </div>
                <div className="mt-2 grid gap-2 md:grid-cols-3">
                  {(
                    [
                      [
                        "POUCH_PACK",
                        "Pouch or bag to gonny/carton",
                        `${n(lineFilter === "ALL" ? selected.packing_pending.batches_pcs || 0 : linePendingBatchPcs, 0)} pcs waiting`,
                        !hasPouchWork,
                      ],
                      [
                        "ROLL_PACK",
                        "Packed roll with sheet or wrap",
                        `${n(lineRollCount, 0)} rolls`,
                        !hasRollWork,
                      ],
                      [
                        "RELEASE_UNPACKED",
                        "Direct roll dispatch unit",
                        "skips wrap consumption",
                        !hasRollWork,
                      ],
                    ] as Array<[RouteKind, string, string, boolean]>
                  ).map(([route, title, copy, disabled]) => (
                    <button
                      key={route}
                      type="button"
                      data-testid={`packing-route-choice-${route}`}
                      disabled={disabled}
                      onClick={() => setRouteChoice(route)}
                      className={`relative min-h-[74px] rounded-[12px] border p-3 text-left transition ${activeRoute === route ? "border-order-border bg-order-bg shadow-sm" : "border-line bg-surface-1"} ${disabled ? "cursor-not-allowed opacity-45" : "hover:-translate-y-0.5 hover:border-order-border"}`}
                    >
                      {recommendedRoute === route && (
                        <span className="absolute -top-3 left-4 rounded-full bg-success-fg px-3 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-white">
                          Recommended
                        </span>
                      )}
                      <div className="font-mono text-[11px] font-black text-order-fg">
                        {route}
                      </div>
                      <div className="mt-1 text-xs font-black text-content-1">
                        {title}
                      </div>
                      <div className="mt-0.5 text-[11px] font-semibold text-content-3">
                        {copy}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {hasPouchWork && activeRoute === "POUCH_PACK" && (
                <>
                  <div className="rounded-[16px] border border-line bg-surface-1 p-4 shadow-sm">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <h3 className="text-base font-black text-content-1">
                          Pouch batches available · create packing unit
                        </h3>
                        <div className="text-[10px] font-black uppercase tracking-[0.24em] text-content-4">
                          {n(lineFilter === "ALL" ? selected.packing_pending.batches_pcs || 0 : linePendingBatchPcs, 0)}{" "}
                          pouches waiting ·{" "}
                          {n(lineReadyGonnyPcs, 0)}{" "}
                          pcs already released
                        </div>
                      </div>
                      <Chip tone="blue">Form flow</Chip>
                    </div>
                    <div className="mt-4 flex min-h-[58px] items-center gap-3 rounded-[14px] border border-line bg-surface-2 px-4 text-content-2">
                      <PackageOpen className="h-4 w-4 text-content-3" />
                      <span className="flex-1 text-sm font-semibold">
                        Choose a pouch batch below, create one gonny/carton,
                        seal actual gross weight, then release that unit to
                        Dispatch Bay.
                      </span>
                      <Chip tone="green">Batch first</Chip>
                    </div>
                    <div className="mt-3 grid gap-2 sm:grid-cols-4">
                      <MiniMetric
                        label="Produced"
                        value={n(selected.ordered_qty, 0)}
                        hint="order qty"
                      />
                      <MiniMetric
                        label="Packed"
                        value={n(lineReadyGonnyPcs, 0)}
                        hint="released pcs"
                      />
                      <MiniMetric
                        label="In-progress"
                        value={n(lineOpenGonnyCount, 0)}
                        hint="open gonnies"
                      />
                      <MiniMetric
                        label="QA holds"
                        value="0"
                        hint="no hold in yard"
                      />
                    </div>
                  </div>

                  <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_300px]">
                    <div className="rounded-[18px] border border-line bg-surface-1 p-5 shadow-sm">
                      <div className="mb-4 flex items-center justify-between gap-3">
                        <div>
                          <h3 className="text-base font-black text-content-1">
                            Pouch batches waiting for gonnies
                          </h3>
                          <div className="text-[10px] font-black uppercase tracking-[0.24em] text-content-4">
                            Select a batch and create the physical packing unit
                          </div>
                        </div>
                      </div>
                      <div className="max-h-[380px] overflow-auto rounded-[14px] border border-line">
                        <table className="w-full min-w-[660px] text-sm">
                          <thead className="sticky top-0 bg-surface-1 text-[10px] uppercase tracking-[0.22em] text-content-4">
                            <tr>
                              <th className="px-4 py-3 text-left">Product / stack</th>
                              <th className="text-left">Size</th>
                              <th className="text-right">Remaining</th>
                              <th className="px-4 text-right">Action</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-line">
                            {pagedBatches.map((batch) => (
                              <tr key={batch.id}>
                                <td className="px-4 py-4">
                                  <div className="font-black text-content-1">
                                    {batch.product_name ||
                                      batch.template_name ||
                                      "Pouch product"}
                                  </div>
                                  <div className="text-xs font-semibold text-content-3">
                                    {[
                                      compactStackSpec(
                                        batch.layers_label,
                                        batch.thickness_label,
                                        batch.grade_label,
                                      ),
                                      batch.product_code || batch.location?.name,
                                    ]
                                      .filter((part) => part && part !== "-")
                                      .join(" · ")}
                                  </div>
                                  {(productionBatchLabel(batch) || routeNodeLabel(batch)) ? (
                                    <div className="mt-1 flex flex-wrap gap-1">
                                      {productionBatchLabel(batch) ? (
                                        <span className="rounded-full border border-info-border bg-info-bg px-2 py-0.5 text-[10px] font-black text-primary">
                                          {productionBatchLabel(batch)}
                                        </span>
                                      ) : null}
                                      {routeNodeLabel(batch) ? (
                                        <span className="rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[10px] font-bold text-content-3">
                                          {routeNodeLabel(batch)}
                                        </span>
                                      ) : null}
                                    </div>
                                  ) : null}
                                </td>
                                <td className="font-mono font-black">
                                  {batch.size_label || "as SKU"}
                                </td>
                                <td className="text-right font-black">
                                  {n(batch.qty_pcs, 0)} pcs
                                </td>
                                <td className="px-4 text-right">
                                  <Button
                                    size="sm"
                                    data-testid={`packing-create-gonny-${batch.id}`}
                                    onClick={() => openCreateGonny(batch)}
                                  >
                                    Create gonny
                                  </Button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {!selectedBatches.length && (
                          <div className="p-8 text-center text-sm font-semibold text-content-3">
                            No pouch batches are waiting for this line.
                          </div>
                        )}
                      </div>
                      <div className="mt-3 flex flex-col gap-2 rounded-[14px] border border-line bg-surface-1 p-3 sm:flex-row sm:items-center sm:justify-between">
                        <div
                          data-testid="packing-batch-work-total"
                          className="text-xs font-bold text-content-3"
                        >
                          Showing {batchShownStart}-{batchShownEnd} of{" "}
                          {selectedBatches.length} batches
                        </div>
                        <Pager
                          page={safeBatchPage}
                          pageCount={batchPageCount}
                          onPageChange={setBatchPage}
                          testId="packing-batch-work-page"
                        />
                      </div>
                    </div>
                    <div className="rounded-[18px] border border-line bg-surface-1 p-5 shadow-sm">
                      <h3 className="text-base font-black text-content-1">
                        Create gonny
                      </h3>
                      <div className="mt-4 space-y-3">
                        <div>
                          <Label>Batch</Label>
                          <Select
                            value={createBatchId}
                            onValueChange={setCreateBatchId}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select pouch batch" />
                            </SelectTrigger>
                            <SelectContent>
                              {selectedBatches.map((batch) => (
                                <SelectItem key={batch.id} value={batch.id}>
                                  {productionBatchLabel(batch)
                                    ? `${productionBatchLabel(batch)} • `
                                    : ""}
                                  {batch.product_name ||
                                    batch.template_name ||
                                    "Pouch product"}{" "}
                                  • {batch.size_label || "as SKU"} •{" "}
                                  {batch.qty_pcs} pcs
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label>Gonny material</Label>
                          <Select
                            value={gonnyMaterialId}
                            onValueChange={setGonnyMaterialId}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select gonny stock" />
                            </SelectTrigger>
                            <SelectContent>
                              {gonnies.map((item: PackagingMaterial) => (
                                <SelectItem key={item.id} value={item.id}>
                                  {item.code} • {item.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        {(() => {
                          const b = selectedBatch as any;
                          const innerEnabled = !!b?.primary_pack_enabled;
                          const pcsPerPack = Number(b?.pcs_per_pack || 0);
                          return (
                            <>
                              <div>
                                <Label>
                                  {innerEnabled
                                    ? contentMode === "PRIMARY_PACKS"
                                      ? `Inner packs to put in gonny (× ${pcsPerPack} pcs)`
                                      : "Pouches to pack"
                                    : "Pouches to pack"}
                                </Label>
                                <Input
                                  type="number"
                                  min="1"
                                  value={createQty}
                                  onChange={(event) =>
                                    setCreateQty(event.target.value)
                                  }
                                  placeholder={
                                    selectedBatch
                                      ? String(selectedBatch.qty_pcs)
                                      : "Qty pcs"
                                  }
                                />
                              </div>
                              {/* Content mode only matters when the master has an inner-pouch axis
 (selectedBatch.primary_pack_enabled). For loose-only masters the
 select is hidden — we just pack pouches direct. */}
                              {innerEnabled ? (
                                <div>
                                  <Label>Content mode</Label>
                                  <Select
                                    value={contentMode}
                                    onValueChange={(value) =>
                                      setContentMode(value as any)
                                    }
                                  >
                                    <SelectTrigger>
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="LOOSE_POUCHES">
                                        Loose pouches
                                      </SelectItem>
                                      <SelectItem value="PRIMARY_PACKS">
                                        Inner packs
                                      </SelectItem>
                                    </SelectContent>
                                  </Select>
                                  <div className="mt-1 text-[10px] text-content-3">
                                    Inner packs = the inner-pouch SKU is the
                                    unit · pcs_per_inner = {pcsPerPack || "n/a"}
                                  </div>
                                </div>
                              ) : (
                                <div className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-[11px] text-content-3">
                                  <span className="font-bold">Loose-only</span>{" "}
                                  — this master has no inner-pouch axis. Enter
                                  pcs directly above.
                                </div>
                              )}
                            </>
                          );
                        })()}
                        <Button
                          className="w-full"
                          disabled={
                            !createBatchId ||
                            !createQty ||
                            !gonnyMaterialId ||
                            createMutation.isPending
                          }
                          onClick={() => createMutation.mutate()}
                        >
                          {createMutation.isPending
                            ? "Creating..."
                            : "Create gonny"}
                        </Button>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-[18px] border border-line bg-surface-1 p-4 shadow-sm">
                    <h3 className="mb-3 text-base font-black text-content-1">
                      Gonnies in yard
                    </h3>
                    <div className="max-h-[calc(100dvh-330px)] overflow-auto rounded-[14px] border border-line">
                      <table className="w-full min-w-[740px] table-fixed text-[13px]">
                        <colgroup>
                          <col className="w-[92px]" />
                          <col />
                          <col className="w-[82px]" />
                          <col className="w-[86px]" />
                          <col className="w-[116px]" />
                          <col className="w-[78px]" />
                          <col className="w-[86px]" />
                        </colgroup>
                        <thead className="sticky top-0 bg-surface-2 text-[9px] uppercase tracking-[0.14em] text-content-3">
                          <tr>
                            <th className="px-3 py-2 text-left">Unit</th>
                            <th className="px-2 text-left">Product / stack</th>
                            <th className="px-1 text-left">Size</th>
                            <th className="px-1 text-right">Gross</th>
                            <th className="px-1 text-right">Net / pcs</th>
                            <th className="px-1 text-right">Status</th>
                            <th className="px-3 text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-line">
                          {pagedGonnies.map((gonny) => {
                            const displayLabel = compactUnitLabel(
                              gonny.dispatch_unit_no || gonny.label_id,
                              "GONNY",
                            );
                            const stack = compactStackSpec(
                              gonny.layers_label,
                              gonny.thickness_label,
                              gonny.grade_label,
                            );
                            return (
                              <tr
                                key={gonny.id}
                                className="transition-colors hover:bg-info-bg"
                              >
                                <td className="px-3 py-2 align-top">
                                  <div
                                    title={gonny.dispatch_unit_no || gonny.label_id}
                                    className="font-mono text-xs font-black text-content-1"
                                  >
                                    {displayLabel}
                                  </div>
                                  <div className="text-[11px] font-semibold text-content-3">
                                    {gonny.content_mode || "POUCH"}
                                  </div>
                                </td>
                                <td className="px-2 py-2 align-top">
                                  <div className="whitespace-normal break-words text-[13px] font-black leading-4 text-content-1">
                                    {gonny.product_name || "Pouch product"}
                                  </div>
                                  <div className="mt-0.5 whitespace-normal break-words text-[11px] font-bold leading-3 text-content-2">
                                    {[stack, gonny.product_code]
                                      .filter((part) => part && part !== "-")
                                      .join(" · ")}
                                  </div>
                                  {productionBatchLabel(gonny) || routeNodeLabel(gonny) ? (
                                    <div className="mt-1 flex flex-wrap gap-1">
                                      {productionBatchLabel(gonny) ? (
                                        <span className="rounded-full border border-info-border bg-info-bg px-2 py-0.5 text-[10px] font-black text-primary">
                                          {productionBatchLabel(gonny)}
                                        </span>
                                      ) : null}
                                      {routeNodeLabel(gonny) ? (
                                        <span className="rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[10px] font-bold text-content-3">
                                          {routeNodeLabel(gonny)}
                                        </span>
                                      ) : null}
                                    </div>
                                  ) : null}
                                </td>
                                <td className="px-1 py-2 align-top font-mono text-[13px] font-black leading-4">
                                  {gonny.size_label || "as SKU"}
                                </td>
                                <td className="px-1 py-2 align-top text-right font-mono text-[13px] font-black leading-4">
                                  {gonny.gross_weight_kg
                                    ? `${n(gonny.gross_weight_kg)} kg`
                                    : `${n(getGonnyExpected(gonny))} kg exp`}
                                </td>
                                <td className="px-1 py-2 align-top text-right font-mono text-[13px] font-black leading-4">
                                  {netPcsLabel(
                                    gonny.net_product_weight_kg ||
                                      getGonnyExpected(gonny),
                                    gonny.qty_pcs,
                                  )}
                                </td>
                                <td className="px-1 py-2 align-top text-right">
                                  <Chip
                                    tone={
                                      gonny.released_to_dispatch
                                        ? "green"
                                        : gonny.gross_weight_kg
                                          ? "blue"
                                          : "amber"
                                    }
                                  >
                                    {gonny.released_to_dispatch
                                      ? "Dispatch"
                                      : gonny.gross_weight_kg
                                        ? "Sealed"
                                        : "Open"}
                                  </Chip>
                                </td>
                                <td className="px-3 py-2 align-top text-right">
                                  {!gonny.gross_weight_kg && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      data-testid={`packing-seal-gonny-${gonny.id}`}
                                      onClick={() => setSealGonny(gonny)}
                                    >
                                      <Scale className="mr-1 h-3 w-3" /> Seal
                                    </Button>
                                  )}
                                  {gonny.gross_weight_kg &&
                                    !gonny.released_to_dispatch && (
                                      <Button
                                        size="sm"
                                        data-testid={`packing-release-gonny-${gonny.id}`}
                                        onClick={() => {
                                          setReleaseGonnyTarget(gonny);
                                          setReleaseGonnyExtras([]);
                                        }}
                                      >
                                        Send
                                      </Button>
                                    )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      {!selectedGonnies.length && (
                        <div className="p-8 text-center text-sm font-semibold text-content-3">
                          No gonnies created for this line yet.
                        </div>
                      )}
                    </div>
                    <div className="mt-3 flex flex-col gap-2 rounded-[14px] border border-line bg-surface-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div
                        data-testid="packing-gonny-work-total"
                        className="text-xs font-bold text-content-3"
                      >
                        Showing {gonnyShownStart}-{gonnyShownEnd} of{" "}
                        {selectedGonnies.length} gonnies
                      </div>
                      <Pager
                        page={safeGonnyPage}
                        pageCount={gonnyPageCount}
                        onPageChange={setGonnyPage}
                        testId="packing-gonny-work-page"
                      />
                    </div>
                  </div>
                </>
              )}

              {hasRollWork &&
                (activeRoute === "ROLL_PACK" ||
                  activeRoute === "RELEASE_UNPACKED") && (
                  <div className="rounded-[18px] border border-line bg-surface-1 p-4 shadow-sm">
                    <div className="mb-3 flex flex-col gap-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
                      <div className="min-w-0">
                        <h3 className="text-base font-black text-content-1">
                          {activeRoute === "ROLL_PACK"
                            ? "Rolls available · pack and release"
                            : "Release unpacked rolls"}
                        </h3>
                        <div className="text-[10px] font-black uppercase tracking-[0.24em] text-content-4">
                          Select one or many rolls. Allowed materials come from
                          the sales packing axis.
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          data-testid="packing-roll-select-all"
                          disabled={
                            !selectedRollRows.some(
                              (roll: any) => !roll.released_to_dispatch,
                            )
                          }
                          onClick={() => {
                            const openIds = selectedRollRows
                              .filter((roll: any) => !roll.released_to_dispatch)
                              .map((roll: any) => roll.id);
                            setSelectedRollIds(
                              selectedRollIds.length === openIds.length
                                ? []
                                : openIds,
                            );
                          }}
                        >
                          {selectedRollIds.length
                            ? "Clear selection"
                            : "Select all rolls"}
                        </Button>
                        <Button
                          size="sm"
                          data-testid="packing-roll-bulk-release"
                          disabled={!selectedRollsForBulk.length}
                          onClick={() => openReleaseRolls(selectedRollsForBulk)}
                        >
                          Bulk pack & release{" "}
                          {selectedRollsForBulk.length
                            ? `(${selectedRollsForBulk.length})`
                            : ""}
                        </Button>
                        <Chip tone="roll">
                          {n(lineRollCount, 0)} rolls
                        </Chip>
                      </div>
                    </div>
                    <div className="max-h-[calc(100dvh-270px)] overflow-auto rounded-[14px] border border-line">
                      <table className="w-full min-w-[920px] table-fixed text-[12px]">
                        <colgroup>
                          <col className="w-[46px]" />
                          <col className="w-[30%]" />
                          <col className="w-[22%]" />
                          <col className="w-[24%]" />
                          <col className="w-[14%]" />
                          <col className="w-[108px]" />
                        </colgroup>
                        <thead className="sticky top-0 bg-surface-2 text-[9px] uppercase tracking-[0.14em] text-content-3">
                          <tr>
                            <th className="px-3 py-2 text-left">Pick</th>
                            <th className="px-3 text-left">Product</th>
                            <th className="px-3 text-left">Spec</th>
                            <th className="px-3 text-right">Weight</th>
                            <th className="px-3 text-right">Label / location</th>
                            <th className="px-3 text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-line">
                          {pagedRolls.map((roll) => {
                            const rawLabel =
                              roll.dispatch_unit_no || roll.label_id;
                            const displayLabel = compactUnitLabel(
                              rawLabel,
                              "ROLL",
                            );
                            const stack = compactStackSpec(
                              roll.layers_label,
                              roll.thickness_label,
                              roll.grade_label,
                            );
                            return (
                              <tr
                                key={roll.id}
                                className={`transition-colors hover:bg-info-bg ${
                                  roll.released_to_dispatch
                                    ? "bg-success-bg"
                                    : selectedRollIds.includes(roll.id)
                                      ? "bg-info-bg"
                                      : ""
                                }`}
                              >
                                <td className="px-3 py-2 align-middle">
                                  {!roll.released_to_dispatch ? (
                                    <button
                                      type="button"
                                      data-testid={`packing-roll-select-${roll.id}`}
                                      onClick={() =>
                                        toggleRollSelection(roll.id)
                                      }
                                      className={`flex h-7 w-7 items-center justify-center rounded-lg border text-xs font-black transition ${selectedRollIds.includes(roll.id) ? "border-primary bg-primary text-white shadow-sm" : "border-line bg-surface-1 text-content-3 hover:border-info-border"}`}
                                      aria-label={`Select roll ${roll.label_id}`}
                                    >
                                      {selectedRollIds.includes(roll.id) ? (
                                        <Check className="h-4 w-4" />
                                      ) : null}
                                    </button>
                                  ) : (
                                    <Chip tone="green">Ready</Chip>
                                  )}
                                </td>
                                <td className="px-3 py-2 align-middle">
                                  <div
                                    title={
                                      roll.product_name ||
                                      roll.material__name ||
                                      "Roll product"
                                    }
                                    className="whitespace-normal break-words text-[13px] font-black leading-4 text-content-1"
                                  >
                                    {roll.product_name ||
                                      roll.material__name ||
                                      "Roll product"}
                                  </div>
                                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                    <Chip tone="roll">{displayLabel}</Chip>
                                    {productionBatchLabel(roll) ? (
                                      <span className="rounded-full border border-info-border bg-info-bg px-2 py-0.5 text-[10px] font-black text-primary">
                                        {productionBatchLabel(roll)}
                                      </span>
                                    ) : null}
                                    {routeNodeLabel(roll) ? (
                                      <span className="rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[10px] font-bold text-content-3">
                                        {routeNodeLabel(roll)}
                                      </span>
                                    ) : null}
                                    {roll.product_code && (
                                      <span className="font-mono text-[10px] font-bold text-content-3">
                                        {roll.product_code}
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className="px-3 py-2 align-middle">
                                  <div className="font-mono text-[12px] font-black text-content-1">
                                    {roll.size_label ||
                                      (roll.width_mm
                                        ? `${roll.width_mm} mm`
                                        : "-")}
                                  </div>
                                  <div
                                    title={stack}
                                    className="mt-0.5 line-clamp-2 text-[11px] font-bold leading-3 text-content-3"
                                  >
                                    {stack !== "-" ? stack : "Order roll spec"}
                                  </div>
                                </td>
                                <td className="px-3 py-2 align-middle text-right">
                                  <div className="grid grid-cols-3 gap-2">
                                    <div>
                                      <div className="text-[9px] font-black uppercase tracking-[0.12em] text-content-4">
                                        Gross
                                      </div>
                                      <div className="font-mono text-[12px] font-black leading-4 text-content-1">
                                        {n(
                                          roll.gross_weight_kg ||
                                            roll.weight_kg,
                                        )}{" "}
                                        kg
                                      </div>
                                    </div>
                                    <div>
                                      <div className="text-[9px] font-black uppercase tracking-[0.12em] text-content-4">
                                        Tare
                                      </div>
                                      <div className="font-mono text-[12px] font-bold leading-4 text-content-3">
                                        {n(roll.tare_weight_kg || 0)} kg
                                      </div>
                                    </div>
                                    <div>
                                      <div className="text-[9px] font-black uppercase tracking-[0.12em] text-content-4">
                                        Net
                                      </div>
                                      <div className="font-mono text-[12px] font-black leading-4 text-content-1">
                                        {n(
                                          roll.net_weight_kg ||
                                            roll.weight_kg,
                                        )}{" "}
                                        kg
                                      </div>
                                    </div>
                                  </div>
                                </td>
                                <td className="px-3 py-2 align-middle text-right">
                                  <div
                                    title={rawLabel}
                                    className="font-mono text-[11px] font-black leading-3 text-content-1"
                                  >
                                    {displayLabel}
                                  </div>
                                  <div
                                    title={roll.location?.name || ""}
                                    className="truncate text-[10px] font-bold leading-3 text-content-2"
                                  >
                                    {compactLocationLabel(roll.location?.name)}
                                  </div>
                                </td>
                                <td className="px-3 py-2 align-middle text-right">
                                  {!roll.released_to_dispatch ? (
                                    <Button
                                      size="sm"
                                      className="h-8 min-w-[86px] px-2 text-xs"
                                      data-testid={`packing-roll-release-${roll.id}`}
                                      onClick={() => openReleaseRoll(roll)}
                                    >
                                      <PackageCheck className="mr-1 h-3 w-3" />{" "}
                                      {activeRoute === "ROLL_PACK"
                                        ? "Pack"
                                        : "Release"}
                                    </Button>
                                  ) : (
                                    <Chip tone="green">Dispatch bay</Chip>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      {!selectedRollRows.length && (
                        <div className="p-8 text-center text-sm font-semibold text-content-3">
                          No rolls match this line scope. Released rolls are
                          already visible in Dispatch Bay.
                        </div>
                      )}
                    </div>
                    <div className="mt-3 flex flex-col gap-2 rounded-[14px] border border-line bg-surface-2 p-3 sm:flex-row sm:items-center sm:justify-between">
                      <div
                        data-testid="packing-roll-work-total"
                        className="text-xs font-bold text-content-3"
                      >
                        Showing {rollShownStart}-{rollShownEnd} of{" "}
                        {selectedRollRows.length} rolls
                      </div>
                      <Pager
                        page={safeRollPage}
                        pageCount={rollPageCount}
                        onPageChange={setRollPage}
                        testId="packing-roll-work-page"
                      />
                    </div>
                  </div>
                )}
            </>
          )}
        </main>

        <aside className="grid gap-3 lg:grid-cols-2 xl:col-span-2 2xl:grid-cols-4">
          <div className="rounded-[18px] border border-order-border bg-order-bg p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-black text-content-1">
                Live progress · {selected?.sales_order.order_number || "yard"}
              </h3>
              <Chip tone={selectedProgress >= 100 ? "green" : "blue"}>
                {selected ? `${selectedProgress}%` : "Live"}
              </Chip>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <MiniMetric
                label="Packed"
                value={`${n(selectedReadyUnits, 0)}`}
                hint="units ready"
              />
              <MiniMetric
                label="To go"
                value={`${n(selectedPendingUnits, 0)}`}
                hint="yard tasks"
              />
              <MiniMetric label="Net" value={`${n(selectedNet)} kg`} />
              <MiniMetric label="Gross" value={`${n(selectedGross)} kg`} />
              <MiniMetric label="Value" value="Audit" hint="stock card link" />
              <MiniMetric
                label="Photos missing"
                value={n(board.data?.totals.photos_missing || 0, 0)}
                alert={Number(board.data?.totals.photos_missing || 0) > 0}
              />
            </div>
          </div>
          <div className="rounded-[18px] border border-line bg-surface-1 p-5 shadow-sm">
            <h3 className="text-sm font-black text-content-1">
              History & trace
            </h3>
            <div className="mt-3 space-y-2">
              <a className="flex items-center justify-between rounded-xl border border-line px-3 py-2 text-sm font-bold text-content-2">
                <span className="flex items-center gap-2">
                  <History className="h-4 w-4 text-primary" /> Stock Card
                  filtered to SO
                </span>
                <ArrowRight className="h-4 w-4" />
              </a>
              <a className="flex items-center justify-between rounded-xl border border-line px-3 py-2 text-sm font-bold text-content-2">
                <span className="flex items-center gap-2">
                  <ClipboardList className="h-4 w-4 text-order-fg" /> Completed
                  Trace
                </span>
                <ArrowRight className="h-4 w-4" />
              </a>
              <a className="flex items-center justify-between rounded-xl border border-line px-3 py-2 text-sm font-bold text-content-2">
                <span className="flex items-center gap-2">
                  <Layers className="h-4 w-4 text-content-3" /> Upstream plan
                  queue
                </span>
                <ArrowRight className="h-4 w-4" />
              </a>
            </div>
          </div>
        </aside>
      </section>

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent
          data-testid="packing-create-gonny-dialog"
          className="max-h-[90vh] max-w-xl overflow-y-auto"
        >
          <DialogHeader>
            <DialogTitle>Create gonny packing unit</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-3xl bg-surface-2 p-4 text-sm">
              <div className="font-black">
                {selectedBatch?.product_name ||
                  selectedBatch?.template_name ||
                  "Select pouch product"}
              </div>
              <div className="mt-1 text-xs text-content-3">
                {selectedBatch?.size_label || "Size from sales order"} ·
                Available {n(selectedBatch?.qty_pcs || 0, 0)} pcs. The unit
                remains OPEN until gross weight is sealed.
              </div>
            </div>
            <div>
              <Label>Gonny material</Label>
              <select
                data-testid="packing-gonny-material"
                value={gonnyMaterialId}
                onChange={(event) => setGonnyMaterialId(event.target.value)}
                className="mt-1 h-11 w-full rounded-xl border border-line bg-surface-1 px-3 text-sm font-semibold"
              >
                <option value="">Select gonny stock</option>
                {gonnies.map((item: PackagingMaterial) => (
                  <option key={item.id} value={item.id}>
                    {item.code} • {item.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>Pouches to pack</Label>
              <Input
                data-testid="packing-gonny-qty"
                type="number"
                min="1"
                value={createQty}
                onChange={(event) => setCreateQty(event.target.value)}
                placeholder={
                  selectedBatch ? String(selectedBatch.qty_pcs) : "Qty pcs"
                }
              />
            </div>
            <div>
              <Label>Content mode</Label>
              <select
                data-testid="packing-gonny-content-mode"
                value={contentMode}
                onChange={(event) => setContentMode(event.target.value as any)}
                className="mt-1 h-11 w-full rounded-xl border border-line bg-surface-1 px-3 text-sm font-semibold"
              >
                <option value="LOOSE_POUCHES">Loose pouches</option>
                <option value="PRIMARY_PACKS">Inner packs</option>
              </select>
            </div>
            {contentMode === "PRIMARY_PACKS" && (
              <div>
                <Label>Inner pack count</Label>
                <Input
                  type="number"
                  min="1"
                  value={primaryPackCount}
                  onChange={(event) => setPrimaryPackCount(event.target.value)}
                  placeholder="Auto if sales snapshot has pcs/pack"
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              data-testid="packing-gonny-submit"
              disabled={
                !createBatchId ||
                !createQty ||
                !gonnyMaterialId ||
                createMutation.isPending
              }
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? "Creating..." : "Create gonny"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(releaseRolls.length)}
        onOpenChange={(open) => !open && setReleaseRolls([])}
      >
        <DialogContent
          data-testid="packing-roll-dialog"
          className="z-[70] max-h-[92vh] w-[calc(100vw-32px)] max-w-5xl overflow-hidden rounded-[22px] border border-line bg-surface-1 p-0 shadow-[0_24px_90px_-32px_rgba(15,23,42,0.55)]"
        >
          <div className="relative max-h-[92vh] overflow-y-auto overflow-x-hidden bg-surface-1">
            <div className="border-b border-line bg-[linear-gradient(115deg,#eff6ff_0%,#f8fafc_62%,#eef2ff_100%)] p-5 sm:p-6">
              <DialogHeader>
                <DialogTitle>
                  {activeRollCount > 1
                    ? "Bulk release rolls to Dispatch Bay"
                    : "Release roll to Dispatch Bay"}
                </DialogTitle>
              </DialogHeader>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <MiniMetric
                  label="Selected rolls"
                  value={n(activeRollCount, 0)}
                  hint="each becomes a dispatch unit"
                />
                <MiniMetric
                  label="Net"
                  value={`${n(activeRollNet)} kg`}
                  hint="product weight"
                />
                <MiniMetric
                  label="Tare"
                  value={`${n(activeRollTare)} kg`}
                  hint="core + packing"
                />
                <MiniMetric
                  label="Gross"
                  value={`${n(activeRollGross)} kg`}
                  hint="shipment weight"
                />
              </div>
            </div>

            {releaseRolls.length ? (
              <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,0.95fr)_minmax(360px,1.05fr)]">
                <div className="space-y-4">
                  <div className="rounded-[18px] border border-line bg-surface-1 p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-black text-content-1">
                          Rolls in this release
                        </div>
                        <div className="text-[10px] font-black uppercase tracking-[0.2em] text-content-4">
                          one dispatch unit per roll
                        </div>
                      </div>
                      <Chip tone="roll">{activeRollCount} rolls</Chip>
                    </div>
                    <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
                      {releaseRolls.map((roll) => (
                        <div
                          key={roll.id}
                          className="rounded-[14px] border border-line bg-surface-2 p-3"
                        >
                          <div className="break-all font-mono text-sm font-black text-content-1">
                            {roll.label_id}
                          </div>
                          <div className="mt-1 text-xs font-semibold text-content-3">
                            {roll.product_name ||
                              roll.material__name ||
                              "Roll product"}{" "}
                            · {roll.size_label || `${roll.width_mm || "-"} mm`} ·{" "}
                            {roll.layers_label || "-"} ·{" "}
                            {roll.thickness_label && roll.thickness_label !== "-"
                              ? `${roll.thickness_label} micron`
                              : "thickness -"}{" "}
                            · net{" "}
                            {n(roll.net_weight_kg || roll.weight_kg)} kg · tare{" "}
                            {n(roll.tare_weight_kg || 0)} kg · gross{" "}
                            {n(roll.gross_weight_kg || roll.weight_kg)} kg
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-[18px] border border-info-border bg-info-bg p-4">
                    <div className="text-sm font-black text-content-1">
                      How material is consumed
                    </div>
                    <p className="mt-1 text-sm font-semibold leading-6 text-content-3">
                      Packing Yard marks the roll release against the allowed
                      packing list. Actual stock issue is posted by the evening
                      count and allocated back to same-day orders.
                    </p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="rounded-[18px] border border-line bg-surface-1 p-4">
                    <Label>Release mode</Label>
                    <select
                      data-testid="packing-roll-release-mode"
                      value={releaseMode}
                      onChange={(event) =>
                        setReleaseMode(event.target.value as any)
                      }
                      className="mt-2 h-12 w-full rounded-xl border border-line bg-surface-1 px-3 text-sm font-semibold"
                    >
                      <option value="PACKED">
                        Packed roll with sheet/wrap
                      </option>
                      <option value="UNPACKED">Release unpacked roll</option>
                    </select>
                  </div>

                  {releaseMode === "PACKED" && (
                    <div className="rounded-[18px] border border-line bg-surface-1 p-4">
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-black text-content-1">
                            Packing masters used
                          </div>
                          <div className="text-[10px] font-black uppercase tracking-[0.2em] text-content-4">
                            mark-only · count posts stock
                          </div>
                        </div>
                        <Chip tone="green">{rollPackLines.length} marked</Chip>
                      </div>
                      <div className="max-h-[300px] overflow-y-auto overscroll-contain pr-1">
                        <div className="grid gap-2 sm:grid-cols-2">
                        {packingMarkMasters.length ? (
                          packingMarkMasters.map((material: PackagingMaterial) => {
                            const selected = rollPackLines.some(
                              (line) => line.material_id === material.id,
                            );
                            return (
                              <button
                                key={material.id}
                                type="button"
                                data-testid={`packing-roll-mark-material-${material.id}`}
                                onClick={() =>
                                  toggleRollPackLine({
                                    material_id: String(material.id || ""),
                                    qty: "0",
                                    uom: material.base_uom || "PCS",
                                    basis: "MARKED_AT_RELEASE",
                                  })
                                }
                                className={`flex min-h-[64px] items-start gap-3 rounded-[14px] border p-3 text-left transition ${
                                  selected
                                    ? "border-success-border bg-success-bg text-content-1"
                                    : "border-line bg-surface-1 text-content-3 hover:border-order-border"
                                }`}
                              >
                                <span
                                  className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${
                                    selected
                                      ? "border-success-fg bg-success-fg text-white"
                                      : "border-line bg-surface-2 text-content-4"
                                  }`}
                                >
                                  {selected ? <Check className="h-4 w-4" /> : null}
                                </span>
                                <span className="min-w-0">
                                  <span className="block break-words text-sm font-black">
                                    {material.code}
                                  </span>
                                  <span className="mt-0.5 block break-words text-xs font-semibold">
                                    {material.name || "Packing master"}
                                  </span>
                                  <span className="mt-1 block text-[10px] font-black uppercase tracking-[0.16em] text-content-4">
                                    {material.packaging_kind || "PACKING"}
                                  </span>
                                </span>
                              </button>
                            );
                          })
                        ) : (
                          <div className="rounded-[14px] border border-warning-border bg-warning-bg p-4 text-sm font-semibold text-warning-fg">
                            No active packaging masters are available to mark.
                            Add packaging masters before releasing packed rolls.
                          </div>
                        )}
                        </div>
                      </div>
                    </div>
                  )}

                  {releaseMode === "UNPACKED" && (
                    <div className="rounded-[18px] border border-warning-border bg-warning-bg p-4 text-sm font-semibold text-warning-fg">
                      Each selected roll becomes its own dispatch batch/unit. No
                      sheet, wrap, tape, or label stock is posted here.
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            <DialogFooter className="border-t border-line bg-surface-1 p-4">
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
                  ? "Releasing..."
                  : activeRollCount > 1
                    ? `Release ${activeRollCount} rolls`
                    : "Release roll"}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(sealGonny)}
        onOpenChange={(open) => !open && setSealGonny(null)}
      >
        <DialogContent
          data-testid="packing-seal-gonny-dialog"
          className="max-h-[90vh] max-w-xl overflow-y-auto"
        >
          <DialogHeader>
            <DialogTitle>Seal gonny with actual gross weight</DialogTitle>
          </DialogHeader>
          {sealGonny && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-order-border bg-gradient-to-br from-order-bg via-white to-info-bg p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-mono text-sm font-black text-content-1">
                    {sealGonny.label_id}
                  </div>
                  <span className="rounded-full bg-info-bg px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-primary ring-1 ring-info-border">
                    {n(sealGonny.qty_pcs || 0, 0)} pouches inside
                  </span>
                </div>
                {/* Per-source tare breakdown — net (from FG batch × unit_weight),
 inner tare (from inner-pouch master) × N inner packs,
 gonny tare (from gonny master), expected gross = sum. */}
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="rounded-xl bg-surface-1 px-2 py-1.5 ring-1 ring-info-border">
                    <div className="text-[9px] font-black uppercase tracking-wider text-primary">
                      Product net
                    </div>
                    <div className="font-mono text-sm font-black text-content-1">
                      {kg(sealGonny.net_product_weight_kg)}
                    </div>
                    <div className="text-[10px] text-content-3">
                      from FG × unit wt
                    </div>
                  </div>
                  <div className="rounded-xl bg-surface-1 px-2 py-1.5 ring-1 ring-warning-border">
                    <div className="text-[9px] font-black uppercase tracking-wider text-warning-fg">
                      Inner tare
                    </div>
                    <div className="font-mono text-sm font-black text-content-1">
                      {n(sealGonny.inner_pack_tare_kg)} kg
                    </div>
                    <div className="text-[10px] text-content-3">
                      {(sealGonny as any).primary_pack_count
                        ? `${n((sealGonny as any).primary_pack_count, 0)} × inner master`
                        : "loose · no inner"}
                    </div>
                  </div>
                  <div className="rounded-xl bg-surface-1 px-2 py-1.5 ring-1 ring-order-border">
                    <div className="text-[9px] font-black uppercase tracking-wider text-order-fg">
                      Gonny tare
                    </div>
                    <div className="font-mono text-sm font-black text-content-1">
                      {n(sealGonny.secondary_pack_tare_kg)} kg
                    </div>
                    <div className="text-[10px] text-content-3">
                      from gonny master
                    </div>
                  </div>
                  <div className="rounded-xl bg-gradient-to-br from-success-bg to-success-bg px-2 py-1.5 ring-1 ring-success-border">
                    <div className="text-[9px] font-black uppercase tracking-wider text-success-fg">
                      Expected gross
                    </div>
                    <div className="font-mono text-sm font-black text-success-fg">
                      {kg(expected)}
                    </div>
                    <div className="text-[10px] text-success-fg">
                      net + tare
                    </div>
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-2 text-[10px] text-content-3">
                  <span className="inline-flex items-center gap-1 rounded bg-success-bg px-1.5 py-0.5 font-bold text-success-fg">
                    AUTO-CONSUMED
                  </span>
                  <span>
                    Gonny SKU + inner pouch SKU posted to PackagingTransaction
                    at create — visible in{" "}
                    <strong>/logistics/packing/audit</strong>.
                  </span>
                </div>
              </div>
              <div>
                <Label>Actual gonny gross weight (kg)</Label>
                <Input
                  data-testid="packing-gonny-seal-weight"
                  type="number"
                  step="0.001"
                  value={actualGross}
                  onChange={(event) => setActualGross(event.target.value)}
                />
              </div>
              <div
                className={`rounded-2xl p-3 text-sm font-bold ${Math.abs(variancePct) > 2 ? "bg-warning-bg text-warning-fg" : "bg-success-bg text-success-fg"}`}
              >
                Variance: {n(variance, 3)} kg ({n(variancePct, 2)}%)
              </div>
              {Math.abs(variancePct) > 2 && (
                <div>
                  <Label>Variance reason</Label>
                  <Textarea
                    data-testid="packing-gonny-variance-reason"
                    value={varianceReason}
                    onChange={(event) => setVarianceReason(event.target.value)}
                    placeholder="Explain why actual gonny weight differs from expected."
                  />
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSealGonny(null)}>
              Cancel
            </Button>
            <Button
              data-testid="packing-gonny-seal-submit"
              disabled={
                !actualGross ||
                (Math.abs(variancePct) > 2 && !varianceReason.trim()) ||
                sealMutation.isPending
              }
              onClick={() => sealMutation.mutate()}
            >
              {sealMutation.isPending ? "Sealing..." : "Seal gonny"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Release gonny to dispatch — with optional extras tagging.
 Gonny SKU + inner pouch SKU are auto-consumed from packing events.
 Sheet / tape / label / tag are ticked here per order. */}
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
// ReleaseGonnyDialog — inline mark-only tagger for the gonny release step.
//
// Replaces the now-deleted standalone /logistics/packing/order-ticks page.
// Per-order audit (in /logistics/packing/audit) is fed by the same backend
// endpoint. These marks do not post stock; stock movement comes from the
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
  const open = Boolean(gonny);
  const allowed = packagingMaterials;
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
  const removeExtra = (idx: number) =>
    setExtras(extras.filter((_, i) => i !== idx));
  const validLines = extras
    .filter((l) => l.material_id)
    .map((l) => ({
      material_id: l.material_id,
      qty: Number(l.qty || 0),
      uom:
        packagingMaterials.find((m) => m.id === l.material_id)?.base_uom ||
        "PCS",
      notes: l.notes || undefined,
    }));
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
    >
      <DialogContent className="max-w-xl rounded-2xl p-0 overflow-hidden">
        <div className="border-b border-order-border bg-gradient-to-r from-order-bg via-white to-warning-bg px-5 py-3">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-order-fg to-order-fg text-white shadow-sm">
                <PackageCheck className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-black uppercase tracking-[0.22em] text-order-fg">
                  Release to dispatch
                </div>
                <DialogTitle className="text-base font-black">
                  {gonny?.label_id || "—"}
                </DialogTitle>
                <div className="text-[11px] text-content-3 mt-0.5">
                  Mark any packing masters used on this gonny release.
                  <span className="ml-1 text-success-fg font-bold">
                    Stock posts from count, not this dialog.
                  </span>
                </div>
              </div>
            </div>
          </DialogHeader>
        </div>
        <div className="px-5 py-4 space-y-3">
          {extras.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line bg-surface-2 p-4 text-center text-xs text-content-3">
              No extras to tag. Press <strong>Release</strong> to send to
              dispatch, or add a line if you used any additional packing
              master.
            </div>
          ) : (
            <div className="space-y-2">
              {extras.map((ln, idx) => (
                <div
                  key={ln.id}
                  className="grid grid-cols-[minmax(0,1fr)_96px_minmax(0,160px)_32px] gap-2 items-center"
                >
                  <Select
                    value={ln.material_id}
                    onValueChange={(v) => patchExtra(idx, { material_id: v })}
                  >
                    <SelectTrigger className="h-9 rounded-lg text-xs bg-surface-1">
                      <SelectValue placeholder="Pick packing SKU" />
                    </SelectTrigger>
                    <SelectContent>
                      {allowed.length === 0 ? (
                        <div className="px-3 py-2 text-xs text-content-3 italic">
                          No catalog SKUs
                        </div>
                      ) : (
                        allowed.map((m) => (
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
                    placeholder="qty optional"
                    value={ln.qty}
                    onChange={(e) => patchExtra(idx, { qty: e.target.value })}
                    className="h-9 rounded-lg text-right text-xs"
                  />
                  <Input
                    value={ln.notes}
                    placeholder="notes (optional)"
                    onChange={(e) => patchExtra(idx, { notes: e.target.value })}
                    className="h-9 rounded-lg text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => removeExtra(idx)}
                    className="flex h-9 w-8 items-center justify-center rounded-lg text-danger-fg hover:bg-danger-bg"
                    aria-label="Remove"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={addExtra}
            className="rounded-xl"
          >
            + Add extra
          </Button>
        </div>
        <DialogFooter className="border-t border-line bg-surface-2 px-5 py-3">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            data-testid="packing-gonny-release-submit"
            disabled={submitting}
            onClick={() => onSubmit(validLines)}
            className="bg-gradient-to-r from-order-fg to-warning-fg text-white shadow-md hover:shadow-lg"
          >
            {submitting
              ? "Releasing..."
              : validLines.length > 0
                ? `Release · tag ${validLines.length} extra(s)`
                : "Release"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

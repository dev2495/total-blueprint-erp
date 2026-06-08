"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { Chip, ChipGroup } from "@/components/ds/chip";
import { GeoTile } from "@/components/ds/geo-tile";
import { FilterChip } from "@/components/ds/filter-chip";
import {
  BomPreviewPanel,
  type BomPreviewData,
  type BomStep,
  type BomLine,
} from "@/components/ds/bom-preview-panel";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

import { usePlannerControlHub } from "@/hooks/use-planner";
import type { PlannerControlOrder } from "@/services/planner";
import type { TowerTabContext } from "./types";
import { formatDisplayDate } from "@/lib/date-format";

export interface DemandTabProps {
  context: TowerTabContext;
}

type DueBucket = "all" | "overdue" | "today" | "7d" | "14d" | "30d";

const DUE_OPTIONS: Array<{ value: DueBucket; label: string }> = [
  { value: "all", label: "Any" },
  { value: "overdue", label: "Overdue" },
  { value: "today", label: "Today" },
  { value: "7d", label: "≤ 7 days" },
  { value: "14d", label: "≤ 14 days" },
  { value: "30d", label: "≤ 30 days" },
];

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "all", label: "All" },
  { value: "blocked", label: "Blocked" },
  { value: "ready", label: "Ready" },
  { value: "review", label: "Review" },
];

function dayKey(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function bucketFor(deliveryDate: string | null | undefined): DueBucket {
  if (!deliveryDate) return "all";
  const due = new Date(deliveryDate);
  if (Number.isNaN(due.getTime())) return "all";
  const today = dayKey(new Date());
  const dueKey = dayKey(due);
  const diffDays = Math.round((dueKey - today) / 86_400_000);
  if (diffDays < 0) return "overdue";
  if (diffDays === 0) return "today";
  if (diffDays <= 7) return "7d";
  if (diffDays <= 14) return "14d";
  if (diffDays <= 30) return "30d";
  return "all";
}

function bucketIncludes(filter: DueBucket, row: DueBucket): boolean {
  if (filter === "all") return true;
  if (filter === "overdue") return row === "overdue";
  if (filter === "today") return row === "today" || row === "overdue";
  if (filter === "7d")
    return row === "today" || row === "overdue" || row === "7d";
  if (filter === "14d") return row !== "30d" && row !== "all";
  if (filter === "30d") return row !== "all";
  return true;
}

function statusKind(
  status: string,
): "info" | "warn" | "danger" | "success" | "neutral" {
  const upper = String(status || "").toUpperCase();
  if (upper.includes("BLOCK")) return "danger";
  if (upper.includes("READY") || upper.includes("RELEASE")) return "success";
  if (upper.includes("PLAN")) return "info";
  if (upper.includes("REVIEW") || upper.includes("HOLD")) return "warn";
  return "neutral";
}

function effectiveStatusBucket(
  order: PlannerControlOrder,
): "blocked" | "ready" | "review" | "other" {
  const blockers = Number(order.release_checklist?.blocked_count ?? 0);
  if (blockers > 0) return "blocked";
  if (order.release_checklist?.release_ready) return "ready";
  if (order.artwork_gate?.active || order.partial_replan_required)
    return "review";
  return "other";
}

function formatQty(value: number | undefined | null, uom?: string) {
  if (value === undefined || value === null || Number.isNaN(value)) return "—";
  const fixed =
    Math.abs(value) >= 100
      ? Math.round(value).toLocaleString("en-IN")
      : value.toFixed(2);
  return uom ? `${fixed} ${uom}` : fixed;
}

function formatDate(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return formatDisplayDate(d);
}

function ceilPositive(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.ceil(value);
}

function estimatedPackingQty(order: PlannerControlOrder, line: any) {
  const explicit = Number(line?.qty ?? line?.quantity ?? line?.target_qty ?? 0);
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  const basis = String(line?.basis ?? "").toUpperCase();
  const pcsPerPack = Number(line?.pcs_per_pack ?? line?.pcs ?? 0);
  const kgPerPack = Number(line?.kg_per_pack ?? line?.kg_per_bag ?? 0);
  const explicitRequiredPcs = Number(order.required_qty_pcs ?? 0);
  const requiredKg = Number(order.required_qty_kg ?? 0);
  const unitWeightG = Number(order.unit_weight_g ?? 0);
  const requiredPcs =
    explicitRequiredPcs > 0
      ? explicitRequiredPcs
      : requiredKg > 0 && unitWeightG > 0
        ? (requiredKg * 1000) / unitWeightG
        : 0;
  if (
    (basis === "PCS_PER_PACK" ||
      basis === "PRIMARY_INNER_PACK" ||
      pcsPerPack > 0) &&
    requiredPcs > 0 &&
    pcsPerPack > 0
  ) {
    return ceilPositive(requiredPcs / pcsPerPack);
  }
  if (
    (basis === "KG_PER_PACK" || kgPerPack > 0) &&
    requiredKg > 0 &&
    kgPerPack > 0
  ) {
    return ceilPositive(requiredKg / kgPerPack);
  }
  return 0;
}

function buildBomData(order: PlannerControlOrder): BomPreviewData {
  const lines = order.material_plan_lines ?? [];
  const grouped = new Map<string, BomStep>();
  for (const line of lines) {
    const key = `${line.step_sequence ?? "0"}-${line.step_name ?? "Step"}`;
    const existing = grouped.get(key);
    const stepLine: BomLine = {
      material_name: line.material_name,
      material_code: line.material_code ?? undefined,
      qty: Number(line.theoretical_qty || 0),
      uom: line.uom,
      kind: line.category_code,
    };
    if (existing) {
      existing.lines = [...(existing.lines ?? []), stepLine];
      existing.theoretical_qty =
        (existing.theoretical_qty ?? 0) + (Number(line.theoretical_qty) || 0);
    } else {
      grouped.set(key, {
        step_sequence: line.step_sequence ?? null,
        step_name: line.step_name ?? "Step",
        lines: [stepLine],
        theoretical_qty: Number(line.theoretical_qty || 0),
        planned_issue_qty: Number(line.planned_issue_qty || 0),
      });
    }
  }
  const sortedSteps = Array.from(grouped.values()).sort(
    (a, b) => Number(a.step_sequence ?? 0) - Number(b.step_sequence ?? 0),
  );

  const packaging_lines: BomLine[] = [];
  const pkg = order.packaging_snapshot;
  const frozenPackagingLines =
    pkg && Array.isArray(pkg.packaging_lines)
      ? pkg.packaging_lines
      : pkg && Array.isArray(pkg.lines)
        ? pkg.lines
        : [];
  for (const line of frozenPackagingLines) {
    if (line) {
      packaging_lines.push({
        material_name: line.material_name ?? line.material ?? line.code,
        material_code: line.material_code,
        qty: estimatedPackingQty(order, line),
        uom: line.uom ?? "PCS",
        supply_mode: line.supply_mode ?? line.packaging_supply_mode,
        kind: line.role ?? line.kind ?? "PACKAGING",
      });
    }
  }
  const pod = pkg?.pod;
  const podMaterialId = String(pod?.pod_profile_id ?? pod?.material_id ?? "");
  const podPlanLine = podMaterialId
    ? lines.find((line) => String(line.material_id ?? "") === podMaterialId)
    : undefined;
  const pod_lines: BomLine[] = pod?.enabled
    ? [
        {
          material_name: pod.pod_sku_name ?? pod.material_name ?? "POD roll",
          material_code: pod.pod_sku_code ?? pod.material_code,
          qty: Number(
            pod.qty ??
              podPlanLine?.theoretical_qty ??
              podPlanLine?.planned_issue_qty ??
              0,
          ),
          uom: "KG",
          supply_mode: pod.supply_mode,
          kind: "POD",
        },
      ]
    : [];

  return {
    bom_by_step: sortedSteps,
    packaging_lines,
    pod_lines,
    variant_code: order.spec_signature
      ? order.spec_signature.slice(0, 8)
      : undefined,
    variant_created: false,
  };
}

function geometryTiles(order: PlannerControlOrder): React.ReactNode[] {
  const tiles: React.ReactNode[] = [];
  const dims = order.effective_dims;
  if (dims?.width_mm) {
    tiles.push(
      <GeoTile
        key="width"
        label="Width"
        value={Math.round(dims.width_mm)}
        unit="mm"
        tone="info"
      />,
    );
  }
  if (dims?.height_mm) {
    tiles.push(
      <GeoTile
        key="height"
        label="Height"
        value={Math.round(dims.height_mm)}
        unit="mm"
        tone="info"
      />,
    );
  }
  const thickness = order.roll_invariants?.thickness_micron;
  if (thickness) {
    tiles.push(
      <GeoTile
        key="thickness"
        label="Thickness"
        value={Number(thickness).toFixed(0)}
        unit="μ"
        tone="thick"
      />,
    );
  }
  if (order.fg_type) {
    const fgKind = String(order.fg_type).toUpperCase().includes("ROLL")
      ? "fg-roll"
      : "fg-pouch";
    tiles.push(
      <GeoTile
        key="fg-type"
        label="FG type"
        value={String(order.fg_type)}
        tone={fgKind}
      />,
    );
  }
  if (order.required_qty_kg) {
    tiles.push(
      <GeoTile
        key="qty"
        label="Required"
        value={formatQty(order.required_qty_kg, "kg")}
        tone="neutral"
      />,
    );
  }
  return tiles;
}

export function DemandTab({ context }: DemandTabProps) {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [dueFilter, setDueFilter] = useState<DueBucket>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const controlHub = usePlannerControlHub({
    planning_limit: 60,
    active_limit: 12,
    history_limit: 0,
  });

  const allOrders = controlHub.data?.orders ?? [];
  const salesOrders = useMemo(
    () =>
      allOrders.filter(
        (o) => String(o.order_kind || "").toLowerCase() === "sales",
      ),
    [allOrders],
  );

  const customers = useMemo(() => {
    const set = new Set<string>();
    for (const order of salesOrders) {
      const name = order.customer_name?.trim();
      if (name) set.add(name);
    }
    return Array.from(set).sort();
  }, [salesOrders]);

  const [customerFilter, setCustomerFilter] = useState<string>("all");

  const filtered = useMemo(() => {
    const search = context.search.toLowerCase();
    return salesOrders.filter((order) => {
      if (customerFilter !== "all" && order.customer_name !== customerFilter)
        return false;
      if (
        statusFilter !== "all" &&
        effectiveStatusBucket(order) !== statusFilter
      )
        return false;
      const bucket = bucketFor(order.delivery_date);
      if (!bucketIncludes(dueFilter, bucket)) return false;
      if (search) {
        const haystack = [
          order.order_number,
          order.customer_name,
          order.template_name,
          order.display_name,
          order.spec_signature,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
  }, [salesOrders, customerFilter, statusFilter, dueFilter, context.search]);

  const selected = useMemo(
    () =>
      salesOrders.find((o) => `${o.order_kind}:${o.order_id}` === selectedId) ??
      null,
    [salesOrders, selectedId],
  );

  const goToReleases = (mode: "direct-fg" | "match-wip" | "fresh") => {
    if (!selected) return;
    const params = new URLSearchParams({
      mode,
      order_kind: String(selected.order_kind),
      order_id: String(selected.order_id),
    });
    if (selected.sales_order_item_id)
      params.set("so_item_id", selected.sales_order_item_id);
    router.push(
      `/dashboard/planner/control-tower/plan-queue?${params.toString()}`,
    );
  };

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-content-3">
          Filters
        </span>
        <FilterChip
          label="Status"
          value={
            statusFilter !== "all"
              ? STATUS_OPTIONS.find((o) => o.value === statusFilter)?.label
              : undefined
          }
          onClick={() => {
            const order = STATUS_OPTIONS.map((o) => o.value);
            const idx = order.indexOf(statusFilter);
            setStatusFilter(order[(idx + 1) % order.length]);
          }}
          onClear={
            statusFilter !== "all" ? () => setStatusFilter("all") : undefined
          }
          active={statusFilter !== "all"}
        />
        <FilterChip
          label="Customer"
          value={customerFilter !== "all" ? customerFilter : undefined}
          onClick={() => {
            const order = ["all", ...customers];
            const idx = order.indexOf(customerFilter);
            setCustomerFilter(order[(idx + 1) % order.length]);
          }}
          onClear={
            customerFilter !== "all"
              ? () => setCustomerFilter("all")
              : undefined
          }
          active={customerFilter !== "all"}
        />
        <FilterChip
          label="Due"
          value={
            dueFilter !== "all"
              ? DUE_OPTIONS.find((o) => o.value === dueFilter)?.label
              : undefined
          }
          onClick={() => {
            const order = DUE_OPTIONS.map((o) => o.value);
            const idx = order.indexOf(dueFilter);
            setDueFilter(order[(idx + 1) % order.length]);
          }}
          onClear={dueFilter !== "all" ? () => setDueFilter("all") : undefined}
          active={dueFilter !== "all"}
        />
        <span className="ml-auto text-[11px] text-content-3">
          {filtered.length} of {salesOrders.length} sales lines
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[960px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-2 text-[11px] uppercase tracking-wide text-content-3">
              <th className="px-5 py-2 text-left font-semibold">SO</th>
              <th className="px-3 py-2 text-left font-semibold">Customer</th>
              <th className="px-3 py-2 text-left font-semibold">Variant</th>
              <th className="px-3 py-2 text-right font-semibold">Required</th>
              <th className="px-3 py-2 text-left font-semibold">Due</th>
              <th className="px-3 py-2 text-left font-semibold">Status</th>
              <th className="px-5 py-2 text-right font-semibold"></th>
            </tr>
          </thead>
          <tbody>
            {controlHub.isLoading ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-5 py-10 text-center text-sm text-content-3"
                >
                  Loading planner queue…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-5 py-10 text-center text-sm text-content-3"
                >
                  No demand matches the current filters.
                </td>
              </tr>
            ) : (
              filtered.map((order) => {
                const id = `${order.order_kind}:${order.order_id}`;
                const isSelected = id === selectedId;
                const blockers = order.release_checklist?.blocked_count ?? 0;
                return (
                  <tr
                    key={id}
                    onClick={() => setSelectedId(id)}
                    className={cn(
                      "cursor-pointer border-b border-line transition-colors hover:bg-info-bg",
                      isSelected && "bg-info-bg",
                    )}
                  >
                    <td className="px-5 py-2.5 align-top">
                      <div className="font-mono-token text-[13px] font-semibold text-content-1">
                        {order.order_number || "—"}
                      </div>
                      {order.action_recommendation && (
                        <div className="text-[10px] text-content-3">
                          {order.action_recommendation.label}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5 align-top text-content-2">
                      {order.customer_name || "—"}
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <div className="text-content-2">
                        {order.display_name || order.template_name || "—"}
                      </div>
                      <ChipGroup className="mt-1" spacing="tight">
                        {order.fg_type && (
                          <Chip
                            kind={
                              String(order.fg_type)
                                .toUpperCase()
                                .includes("ROLL")
                                ? "fg-roll"
                                : "fg-pouch"
                            }
                            size="sm"
                          >
                            {order.fg_type}
                          </Chip>
                        )}
                        {order.effective_dims?.width_mm ? (
                          <Chip kind="info" size="sm" mono>
                            {Math.round(order.effective_dims.width_mm)}
                            {order.effective_dims.height_mm
                              ? `×${Math.round(order.effective_dims.height_mm)}`
                              : "mm"}
                          </Chip>
                        ) : null}
                        {order.roll_invariants?.thickness_micron ? (
                          <Chip kind="thick" size="sm" mono>
                            {Math.round(
                              Number(order.roll_invariants.thickness_micron),
                            )}
                            μ
                          </Chip>
                        ) : null}
                      </ChipGroup>
                    </td>
                    <td className="px-3 py-2.5 align-top text-right font-mono-token tabular-nums text-content-1">
                      {formatQty(order.required_qty_kg, "kg")}
                    </td>
                    <td className="px-3 py-2.5 align-top text-content-2">
                      {formatDate(order.delivery_date)}
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <ChipGroup spacing="tight">
                        <Chip kind={statusKind(order.status)} size="sm">
                          {order.status || "—"}
                        </Chip>
                        {blockers > 0 ? (
                          <Chip kind="danger" size="sm">
                            {blockers} blockers
                          </Chip>
                        ) : null}
                      </ChipGroup>
                    </td>
                    <td className="px-5 py-2.5 text-right align-top">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedId(id);
                        }}
                      >
                        Open
                      </Button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <Sheet
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
      >
        <SheetContent className="w-[min(34rem,calc(100vw-1rem))] sm:max-w-none overflow-y-auto">
          {selected && (
            <div className="flex flex-col gap-4">
              <SheetHeader className="space-y-1 pb-2 text-left">
                <SheetTitle className="font-display text-lg leading-tight">
                  {selected.order_number}
                </SheetTitle>
                <SheetDescription className="text-xs text-content-3">
                  {selected.customer_name || "Customer pending"} ·{" "}
                  {selected.display_name || selected.template_name}
                </SheetDescription>
                <ChipGroup className="pt-1" spacing="tight">
                  <Chip kind={statusKind(selected.status)}>
                    {selected.status || "—"}
                  </Chip>
                  <Chip kind="neutral">{selected.fg_type || "—"}</Chip>
                  {selected.delivery_date ? (
                    <Chip kind="info">
                      Due {formatDate(selected.delivery_date)}
                    </Chip>
                  ) : null}
                </ChipGroup>
              </SheetHeader>

              <section className="space-y-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-content-3">
                  Spec
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  {geometryTiles(selected)}
                </div>
              </section>

              <section className="space-y-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-content-3">
                  BOM
                </h3>
                <BomPreviewPanel
                  data={buildBomData(selected)}
                  sticky={false}
                  className="!w-full !static"
                  style={{ width: "auto" }}
                />
              </section>

              <section className="space-y-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-content-3">
                  Release
                </h3>
                {selected.release_checklist?.blocked_count ? (
                  <div className="rounded-lg border border-danger-border bg-danger-bg px-3 py-2 text-xs text-danger-fg">
                    {selected.release_checklist.blocked_count} blocker(s) —
                    resolve before release.
                  </div>
                ) : null}
                <div className="grid gap-2">
                  <Button
                    variant="default"
                    disabled={
                      !selected.sales_order_item_id ||
                      !!selected.release_checklist?.blocked_count
                    }
                    onClick={() => goToReleases("direct-fg")}
                  >
                    Direct FG · assign existing finished stock
                  </Button>
                  <Button
                    variant="outline"
                    disabled={
                      !selected.sales_order_item_id ||
                      !!selected.release_checklist?.blocked_count
                    }
                    onClick={() => goToReleases("match-wip")}
                  >
                    Match WIP · claim a WIP roll
                  </Button>
                  <Button
                    variant="outline"
                    disabled={!!selected.release_checklist?.blocked_count}
                    onClick={() => goToReleases("fresh")}
                  >
                    Fresh · create new PSO
                  </Button>
                </div>
                {!selected.sales_order_item_id ? (
                  <Chip kind="warn" size="sm">
                    Stock-order context — Direct FG / Match WIP unavailable.
                  </Chip>
                ) : null}
              </section>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

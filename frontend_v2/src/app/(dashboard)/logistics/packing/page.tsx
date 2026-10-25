"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Boxes, ClipboardList, History, PackageCheck, PackageOpen, RefreshCw, Scale, Search, ShieldAlert, Truck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PackingCheckHeldNotice } from "@/components/packing/packing-check-panel";
import { PackLinesDialog, batchNetKg, packLineState, packLinesOf } from "@/components/packing/pack-lines-dialog";
import { PackingHistory } from "@/components/packing/packing-history";
import { YardOrderCard, lineHasWork, type YardMode } from "@/components/packing/yard-order-card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { PanelEmpty } from "@/components/premium";
import { FloorHead, FloorKpi, FloorKpiGrid, floorButtonClass } from "@/components/floor/floor-head";
import { FilterGroup, Pager, apiError as err, num as n, toolbarSelectClass } from "@/components/logistics/yard-ui";
import { logisticsService, type SOPackingSummary } from "@/services/logistics";
import { masterDataService, type PackagingMaterial } from "@/services/master-data";

const PAGE_SIZE = 6;

type RouteFilter = "ALL" | "POUCH" | "ROLL" | "RELEASE";
type SortMode = "URGENCY" | "READY_DESC" | "SO_ASC" | "CUSTOMER_ASC";
type YardTab = YardMode | "history";

const orderOfUid = (uid: string) => uid.split("::")[0];

export default function PackingYardPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<YardTab>("queue");
  const [search, setSearch] = useState("");
  const [routeFilter, setRouteFilter] = useState<RouteFilter>("ALL");
  const [customerFilter, setCustomerFilter] = useState("ALL");
  const [sortMode, setSortMode] = useState<SortMode>("URGENCY");
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState("");
  const [packKeys, setPackKeys] = useState<string[]>([]);
  const [packOpen, setPackOpen] = useState(false);

  const board = useQuery({
    queryKey: ["packing-board"],
    queryFn: ({ signal }) => logisticsService.getPackingBoard(signal),
    refetchInterval: 30000,
  });
  const packaging = useQuery({
    queryKey: ["packaging-materials"],
    queryFn: masterDataService.getPackaging,
    staleTime: 5 * 60 * 1000,
  });
  const checks = useQuery({
    queryKey: ["packing-check-queue", "ALL"],
    queryFn: ({ signal }) => logisticsService.getPackingCheckQueue(undefined, signal),
    refetchInterval: 30_000,
  });
  const heldChecks = (checks.data || []).filter((row) => row.status === "HELD");
  const gonnyMasters = useMemo(
    () => (packaging.data || []).filter((p) => p.packaging_kind === "GONNY") as PackagingMaterial[],
    [packaging.data],
  );
  const markMasters = useMemo(
    () =>
      (packaging.data || []).filter(
        (item: any) => String(item?.status || "ACTIVE").toUpperCase() !== "INACTIVE",
      ) as PackagingMaterial[],
    [packaging.data],
  );

  const routeOf = (row: any): Exclude<RouteFilter, "ALL"> => {
    const pouch =
      Number(row.pending?.batches_count || 0) +
      Number(row.pending?.open_gonnies_count || 0) +
      Number(row.pending?.sealed_gonnies_count || 0) +
      Number(row.ready_for_dispatch?.gonnies_count || 0);
    if (pouch) return "POUCH";
    if (Number(row.pending?.rolls_count || 0) || Number(row.ready_for_dispatch?.rolls_count || 0)) return "ROLL";
    return "RELEASE";
  };
  const readyWork = (row: any) => Number(row.pending?.batches_count || 0) + Number(row.pending?.rolls_count || 0);
  const inProgressWork = (row: any) =>
    Number(row.pending?.open_gonnies_count || 0) + Number(row.pending?.sealed_gonnies_count || 0);
  const releasedOf = (row: any) =>
    Number(row.ready_for_dispatch?.gonnies_count || 0) + Number(row.ready_for_dispatch?.rolls_count || 0);
  const statusOf = (row: any) => (releasedOf(row) || inProgressWork(row) ? "IN_PROGRESS" : "WAITING");

  const allOrders = board.data?.orders || [];
  const tabOrders = useMemo(
    () => allOrders.filter((row) => (tab === "progress" ? inProgressWork(row) > 0 : readyWork(row) > 0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allOrders, tab],
  );
  const customerOptions = useMemo(
    () => Array.from(new Set(allOrders.map((row) => row.sales_order.customer_name).filter(Boolean))).sort(),
    [allOrders],
  );
  const routeCounts = tabOrders.reduce(
    (acc, row) => {
      acc[routeOf(row)] += 1;
      return acc;
    },
    { POUCH: 0, ROLL: 0, RELEASE: 0 } as Record<Exclude<RouteFilter, "ALL">, number>,
  );
  const cards = tabOrders
    .filter((row) => {
      const term = search.trim().toLowerCase();
      const haystack = `${row.sales_order.order_number} ${row.sales_order.customer_name} ${row.sales_order.job_name || ""}`.toLowerCase();
      if (term && !haystack.includes(term)) return false;
      if (routeFilter !== "ALL" && routeOf(row) !== routeFilter) return false;
      if (customerFilter !== "ALL" && row.sales_order.customer_name !== customerFilter) return false;
      return true;
    })
    .sort((a, b) => {
      if (sortMode === "READY_DESC") return Number(b.ready_kg || 0) - Number(a.ready_kg || 0);
      if (sortMode === "SO_ASC") return a.sales_order.order_number.localeCompare(b.sales_order.order_number);
      if (sortMode === "CUSTOMER_ASC") return a.sales_order.customer_name.localeCompare(b.sales_order.customer_name);
      return readyWork(b) * 2 + inProgressWork(b) - (readyWork(a) * 2 + inProgressWork(a));
    });
  const pageCount = Math.max(1, Math.ceil(cards.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pagedCards = cards.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  useEffect(() => setPage(1), [search, routeFilter, customerFilter, sortMode, tab]);

  // Order summaries for the cards on screen and for every order with a ticked line.
  const pickedOrderIds = Array.from(new Set(Array.from(picked).map(orderOfUid)));
  const summaryIds = Array.from(
    new Set([...pagedCards.map((row) => String(row.sales_order.id)), ...pickedOrderIds, ...packKeys.map(orderOfUid)]),
  );
  const summaryQueries = useQueries({
    queries: summaryIds.map((id) => ({
      queryKey: ["packing-summary", id],
      queryFn: ({ signal }: { signal: AbortSignal }) => logisticsService.getSOPackingSummary(id, signal),
      staleTime: 15_000,
    })),
  });
  const summaries = new Map<string, SOPackingSummary>();
  summaryQueries.forEach((query, index) => {
    if (query.data) summaries.set(summaryIds[index], query.data as SOPackingSummary);
  });
  const summaryError = summaryQueries.find((query) => query.isError)?.error;

  // Drop ticks whose line has nothing left to pack (released, or packed by someone else).
  useEffect(() => {
    if (packOpen) return;
    setPicked((current) => {
      let changed = false;
      const next = new Set<string>();
      current.forEach((uid) => {
        const summary = summaries.get(orderOfUid(uid));
        if (!summary) {
          next.add(uid);
          return;
        }
        const line = packLinesOf(summary).find((item) => item.uid === uid);
        if (line && lineHasWork(line)) next.add(uid);
        else changed = true;
      });
      return changed ? next : current;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summaryQueries.map((query) => query.dataUpdatedAt).join("|"), packOpen]);

  const pickedLines = Array.from(picked)
    .map((uid) => packLinesOf(summaries.get(orderOfUid(uid))).find((line) => line.uid === uid))
    .filter(Boolean) as ReturnType<typeof packLinesOf>;
  const pickedPcs = pickedLines.reduce((sum, line) => sum + packLineState(line).pendingPcs, 0);
  const pickedRolls = pickedLines.reduce((sum, line) => sum + packLineState(line).openRolls.length, 0);
  const pickedKg = pickedLines.reduce(
    (sum, line) =>
      sum +
      line.batches.reduce((s, batch) => s + batchNetKg(batch), 0) +
      packLineState(line).openRolls.reduce((s, roll) => s + Number(roll.net_weight_kg || roll.weight_kg || 0), 0),
    0,
  );

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["packing-board"] }),
      queryClient.invalidateQueries({ queryKey: ["packing-summary"] }),
      queryClient.invalidateQueries({ queryKey: ["packing-check-queue"] }),
      queryClient.invalidateQueries({ queryKey: ["packing-release-history"] }),
      queryClient.invalidateQueries({ queryKey: ["dispatch-board"] }),
    ]);
  const togglePick = (uid: string) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  const setPicks = (uids: string[], on: boolean) =>
    setPicked((current) => {
      const next = new Set(current);
      uids.forEach((uid) => (on ? next.add(uid) : next.delete(uid)));
      return next;
    });
  const openPack = (uids: string[]) => {
    if (!uids.length) return;
    setPackKeys(uids);
    setPackOpen(true);
  };
  const clearFilters = () => {
    setSearch("");
    setRouteFilter("ALL");
    setCustomerFilter("ALL");
    setSortMode("URGENCY");
  };
  const jumpTo = (orderId: string) => {
    const row = allOrders.find((item) => item.sales_order.id === orderId);
    if (!row) return;
    setRouteFilter("ALL");
    setCustomerFilter("ALL");
    setSearch(row.sales_order.order_number);
    setTab(readyWork(row) > 0 || !inProgressWork(row) ? "queue" : "progress");
  };

  const totals = board.data?.totals || {};
  const value = (v: number, digits = 0) => (board.data ? n(v, digits) : "—");
  const readyKg = Number(totals.ready_pouch_kg || 0) + Number(totals.ready_roll_kg || 0);
  const releasedToday = Number(totals.released_today_gonnies || 0) + Number(totals.released_today_rolls || 0);
  const alerts = heldChecks.length + Number(totals.variance_units || 0);
  const inProgressUnits = Number(totals.open_gonnies || 0) + Number(totals.sealed_waiting_release || 0);
  const anyFetching = board.isFetching || packaging.isFetching || summaryQueries.some((query) => query.isFetching);
  const boardStatus = board.isLoading
    ? { tone: "neutral" as const, text: "Loading yard…" }
    : board.isError
      ? { tone: "bad" as const, text: board.data ? "Refresh failed · showing last board" : "Board unavailable" }
      : board.isFetching
        ? { tone: "info" as const, text: "Refreshing…" }
        : { tone: "good" as const, text: "Live · auto-refresh 30s" };

  return (
    <div className="mx-auto max-w-[1760px] space-y-3 pb-24" data-testid="packing-page">
      <FloorHead
        icon={<PackageOpen />}
        title="Packing Yard"
        description="Turn produced batches and rolls into weighed dispatch units. Tick the lines that are ready, pack and weigh them, release — each line goes to Dispatch Bay as its own slip."
        status={boardStatus}
        alerts={board.isError ? <span role="alert">{err(board.error)}</span> : null}
        actions={
          <>
            <Link href="/logistics/packing/audit" data-testid="packing-audit-link" className={floorButtonClass("secondary")}>
              <History /> Audit
            </Link>
            <Link href="/logistics/packing/consumption" data-testid="packing-evening-count-link" className={floorButtonClass("secondary")}>
              <ClipboardList /> Evening count
            </Link>
            <button
              type="button"
              onClick={() => void invalidate()}
              disabled={anyFetching}
              className={floorButtonClass("primary")}
              aria-label="Refresh packing board, orders and packing checks"
            >
              <RefreshCw className={cn(anyFetching && "animate-spin motion-reduce:animate-none")} />
              Refresh
            </button>
          </>
        }
      />

      <PackingCheckHeldNotice onOpenOrder={jumpTo} />

      <FloorKpiGrid>
        <FloorKpi
          testId="packing-kpi-ready"
          icon={<PackageOpen />}
          label="Lines ready to pack"
          tone="warn"
          value={value(Number(totals.ready_lines || 0))}
          unit="lines"
          sub={
            board.data
              ? `${n(totals.pending_batches || 0, 0)} batches · ${n(totals.pending_rolls || 0, 0)} rolls · ${n(totals.pending_pcs || 0, 0)} pcs`
              : "—"
          }
          active={tab === "queue"}
          onClick={() => setTab("queue")}
        />
        <FloorKpi
          icon={<Scale />}
          label="Weight ready"
          value={board.data ? n(readyKg, 1) : "—"}
          unit="kg net"
          sub={board.data ? `${n(totals.ready_pouch_kg || 0, 1)} kg pouches · ${n(totals.ready_roll_kg || 0, 1)} kg rolls` : "—"}
        />
        <FloorKpi
          icon={<Boxes />}
          label="Packed today"
          tone="info"
          value={value(Number(totals.gonnies_packed_today || 0))}
          unit="gonnies"
          sub={board.data ? `+ ${n(totals.released_today_rolls || 0, 0)} rolls released · since midnight` : "—"}
        />
        <FloorKpi
          testId="packing-kpi-progress"
          icon={<PackageCheck />}
          label="Open / sealed"
          tone="info"
          value={
            board.data ? (
              <>
                {n(totals.open_gonnies || 0, 0)}
                <span className="px-1 text-[13px] font-medium text-content-3">open /</span>
                {n(totals.sealed_waiting_release || 0, 0)}
              </>
            ) : (
              "—"
            )
          }
          unit="sealed"
          sub="weigh open units, then release sealed ones"
          active={tab === "progress"}
          onClick={() => setTab("progress")}
        />
        <FloorKpi
          testId="packing-kpi-released"
          icon={<Truck />}
          label="Released today"
          tone="good"
          value={value(releasedToday)}
          unit="units"
          sub={
            board.data
              ? `Ready for dispatch · ${n(totals.released_today_net_kg || 0, 1)} kg net · ${n(totals.released_today_gross_kg || 0, 1)} kg gross`
              : "Ready for dispatch"
          }
          active={tab === "history"}
          onClick={() => setTab("history")}
        />
        <FloorKpi
          testId="packing-kpi-alerts"
          icon={<ShieldAlert />}
          label="Variance alerts"
          tone={alerts ? "bad" : "neutral"}
          value={board.data ? n(alerts, 0) : "—"}
          unit="to decide"
          sub={`${heldChecks.length} held check${heldChecks.length === 1 ? "" : "s"} · ${n(totals.variance_units || 0, 0)} gonnies over ±2%`}
          onClick={() => setTab("progress")}
        />
      </FloorKpiGrid>

      <section className="overflow-hidden rounded-[16px] border border-line bg-surface-1 shadow-[var(--shadow-sm)]">
        <div className="flex flex-wrap items-end justify-between gap-2 border-b border-line px-3 pt-2" role="tablist" aria-label="Packing yard views">
          <div className="flex gap-1">
            {(
              [
                ["queue", "Queue · ready to pack", board.data ? Number(totals.ready_lines || 0) : null],
                ["progress", "In progress", board.data ? inProgressUnits : null],
                ["history", "History", board.data ? releasedToday : null],
              ] as const
            ).map(([value, label, count]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                data-testid={`packing-tab-${value}`}
                onClick={() => setTab(value)}
                className={cn(
                  "relative flex min-h-[40px] items-center gap-2 px-3 text-[13px] font-semibold transition-colors",
                  tab === value ? "text-content-1" : "text-content-3 hover:text-content-1",
                )}
              >
                {label}
                {count != null ? (
                  <span className={cn("rounded-full px-1.5 text-[11px] tabular-nums", tab === value ? "bg-primary text-white" : "bg-surface-2 text-content-3")}>
                    {n(count, 0)}
                  </span>
                ) : null}
                {tab === value ? <span className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-primary" aria-hidden /> : null}
              </button>
            ))}
          </div>
          <span className="pb-2 text-[12px] text-content-3">
            {tab === "history"
              ? "Released lines leave the queue and land here with every detail"
              : tab === "progress"
                ? "Open units to weigh · sealed units to release · checks to close"
                : "Waiting to pack · tick ready lines, then Pack selected"}
          </span>
        </div>
        {tab !== "history" ? (
          <div className="flex flex-wrap items-center gap-2 p-2">
            <FilterGroup
              label="Packing route"
              testIdPrefix="packing-filter-route"
              value={routeFilter}
              onChange={setRouteFilter}
              options={[
                { value: "ALL", label: "All", count: tabOrders.length },
                { value: "POUCH", label: "Pouch", count: routeCounts.POUCH },
                { value: "ROLL", label: "Roll", count: routeCounts.ROLL },
                { value: "RELEASE", label: "Release", count: routeCounts.RELEASE },
              ]}
            />
            <div className="relative min-w-[180px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-4" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search order, job name, customer, product"
                aria-label="Search packing queue"
                className="h-9 rounded-xl pl-9"
              />
            </div>
            <select
              data-testid="packing-filter-customer"
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
              data-testid="packing-filter-sort"
              value={sortMode}
              onChange={(event) => setSortMode(event.target.value as SortMode)}
              className={toolbarSelectClass}
              aria-label="Sort queue"
            >
              <option value="URGENCY">Sort: most work</option>
              <option value="READY_DESC">Most weight ready</option>
              <option value="SO_ASC">SO number</option>
              <option value="CUSTOMER_ASC">Customer</option>
            </select>
            <Select value="" onValueChange={jumpTo}>
              <SelectTrigger data-testid="packing-sales-order-select" className="h-9 w-full rounded-xl sm:w-[190px]" aria-label="Jump to order">
                <SelectValue placeholder="Jump to order…" />
              </SelectTrigger>
              <SelectContent>
                {allOrders.map((row) => (
                  <SelectItem key={row.sales_order.id} value={row.sales_order.id}>
                    {row.sales_order.order_number}
                    {row.sales_order.job_name ? ` · ${row.sales_order.job_name}` : ""} · {row.sales_order.customer_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="button" variant="ghost" size="sm" data-testid="packing-filter-clear" onClick={clearFilters}>
              Clear
            </Button>
          </div>
        ) : null}
      </section>

      {summaryError ? (
        <div role="alert" className="rounded-xl border border-danger-border bg-danger-bg px-4 py-3 text-[12.5px] text-danger-fg">
          Some order details did not load: {err(summaryError)}
        </div>
      ) : null}
      {packaging.isError ? (
        <div role="alert" className="rounded-xl border border-danger-border bg-danger-bg px-4 py-3 text-[12.5px] text-danger-fg">
          Packaging materials unavailable: {err(packaging.error)}
        </div>
      ) : null}

      {tab === "history" ? (
        <PackingHistory search={search} />
      ) : (
        <>
          <div className="space-y-3" data-testid="packing-orders">
            {board.isLoading ? Array.from({ length: 3 }).map((_, i) => <div key={i} className="erp-skeleton h-[180px] rounded-[16px]" />) : null}
            {pagedCards.map((row) => (
                <YardOrderCard
                  key={row.sales_order.id}
                  route={routeOf(row)}
                  status={statusOf(row)}
                  row={row}
                  summary={summaries.get(String(row.sales_order.id))}
                  mode={tab}
                  picked={picked}
                  heldBatches={heldChecks}
                  expanded={expanded === row.sales_order.id}
                  onToggleExpand={() => setExpanded((current) => (current === row.sales_order.id ? "" : row.sales_order.id))}
                  onTogglePick={togglePick}
                  onToggleAll={setPicks}
                  onPack={openPack}
                  onReadySlip={() =>
                    window.open(logisticsService.getMaterialReadySlipUrl(row.sales_order.id), "_blank", "noopener,noreferrer")
                  }
                  onShowProgress={() => setTab("progress")}
                />
            ))}
            {!board.isLoading && !cards.length ? (
              <div className="rounded-[16px] border border-line bg-surface-1 px-5 py-8">
                <PanelEmpty icon={<PackageOpen />} title={tab === "progress" ? "No open or sealed units" : "No orders match"}>
                  {tab === "progress"
                    ? "Pack a gonny from the queue; it shows here until it is weighed and released."
                    : tabOrders.length
                      ? "Try clearing the filters."
                      : "Nothing is waiting in the Packing Yard."}
                </PanelEmpty>
              </div>
            ) : null}
          </div>
          <div className="flex items-center justify-between gap-2 px-1">
            <span data-testid="packing-queue-total" className="text-[11.5px] text-content-3">
              Showing {cards.length ? (safePage - 1) * PAGE_SIZE + 1 : 0}-{Math.min(cards.length, safePage * PAGE_SIZE)} of {cards.length} jobs
            </span>
            <Pager page={safePage} pageCount={pageCount} onPageChange={setPage} testId="packing-queue-page" />
          </div>
        </>
      )}

      {picked.size && tab === "queue" ? (
        <div className="sticky bottom-3 z-20" data-testid="packing-select-bar">
          <div className="flex flex-col gap-2 rounded-2xl border border-primary/40 bg-surface-1/95 p-3 shadow-[var(--shadow-lg)] backdrop-blur-xl md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
              <b className="text-content-1">
                {picked.size} line{picked.size === 1 ? "" : "s"} selected
              </b>
              <span className="text-content-2">
                {pickedOrderIds.length} order{pickedOrderIds.length === 1 ? "" : "s"}
              </span>
              {pickedPcs ? <span className="tabular-nums text-content-2">{n(pickedPcs, 0)} pcs</span> : null}
              {pickedRolls ? <span className="tabular-nums text-content-2">{pickedRolls} rolls</span> : null}
              <span className="tabular-nums text-content-2">{n(pickedKg, 2)} kg net</span>
              <span className="flex items-center gap-1 text-[12px] text-content-3">
                <Truck className="h-3.5 w-3.5" aria-hidden /> One tab per line next. Each line goes to Dispatch Bay as its own slip.
              </span>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" data-testid="packing-select-clear" onClick={() => setPicked(new Set())}>
                Clear
              </Button>
              <Button
                type="button"
                data-testid="packing-pack-selected"
                disabled={packaging.isLoading}
                onClick={() => openPack(Array.from(picked))}
              >
                <PackageCheck className="mr-1.5 h-4 w-4" /> Pack selected · {picked.size}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <PackLinesDialog
        open={packOpen}
        onOpenChange={(open) => {
          setPackOpen(open);
          if (!open) {
            setPicked((current) => {
              const next = new Set(current);
              packKeys.forEach((uid) => next.delete(uid));
              return next;
            });
            setPackKeys([]);
          }
        }}
        summaries={Array.from(new Set(packKeys.map(orderOfUid)))
          .map((id) => summaries.get(id))
          .filter(Boolean) as SOPackingSummary[]}
        lineKeys={packKeys}
        gonnyMasters={gonnyMasters}
        markMasters={markMasters}
        onChanged={invalidate}
      />
    </div>
  );
}

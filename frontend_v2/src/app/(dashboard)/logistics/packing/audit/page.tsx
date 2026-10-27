"use client";

/**
 * /logistics/packing/audit — what packing material each order used.
 *
 * Inner pouches are taken at packing, one row per unit. Everything else (gonny, box, tape,
 * extras) is only ticked at release; the evening count books what was really used and shares
 * it over the order lines that ticked it. Three views: evening counts (one card per count),
 * inner pouches at packing, and ticks at release. Filters by date, customer, material and
 * order; CSV export of the view on screen.
 */

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, ClipboardList, Download, Package, Search, ShieldCheck, Tag, X } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FloorHead, FloorKpi, FloorKpiGrid, floorButtonClass } from "@/components/floor/floor-head";
import { Pager, Pill, num as n } from "@/components/logistics/yard-ui";
import { PanelEmpty } from "@/components/premium";
import { cn } from "@/lib/utils";
import { formatDisplayDateTime } from "@/lib/date-format";
import { logisticsService, type PackingCountSession } from "@/services/logistics";
import { masterDataService, type Customer, type PackagingMaterial } from "@/services/master-data";

type View = "count" | "inner" | "ticks";
const SESSIONS_PER_PAGE = 8;
const ROWS_PER_PAGE = 40;

const qtyText = (value: number | null | undefined, uom: string) => {
  const number = Math.abs(Number(value || 0));
  const decimals = Number.isInteger(number) ? 0 : 3;
  return `${number.toLocaleString("en-IN", { maximumFractionDigits: decimals })} ${String(uom || "").toLowerCase()}`;
};

function kgText(value: number | null | undefined) {
  return `${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 3 })} kg`;
}

/** One evening count: per material book → counted → used, the ticks, and the split to order lines. */
function CountCard({ session }: { session: PackingCountSession }) {
  return (
    <article className="overflow-hidden rounded-2xl border border-line bg-surface-1 shadow-[var(--shadow-sm)]" data-testid="packing-count-card">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-surface-2 px-4 py-2.5">
        <ClipboardList className="h-4 w-4 text-primary" aria-hidden />
        <b className="text-[14px] text-content-1">Evening count · {formatDisplayDateTime(session.counted_at)}</b>
        {session.counted_by ? <span className="text-[12px] text-content-3">counted by {session.counted_by}</span> : null}
        {session.notes ? <span className="text-[12px] italic text-content-3">“{session.notes}”</span> : null}
        <span className="ml-auto flex flex-wrap gap-1.5">
          <Pill tone="neutral">
            {session.materials.length} material{session.materials.length === 1 ? "" : "s"} · {session.used_lines} line booking
            {session.used_lines === 1 ? "" : "s"}
          </Pill>
          {session.mismatches ? (
            <Pill tone="warn" dot>
              {session.mismatches} tick mismatch{session.mismatches === 1 ? "" : "es"}
            </Pill>
          ) : (
            <Pill tone="good" dot>
              ticks match the count
            </Pill>
          )}
        </span>
      </header>
      <div className="divide-y divide-line">
        {session.materials.map((material) => (
          <MaterialRow key={`${material.material_id}-${material.location_name}`} material={material} />
        ))}
      </div>
    </article>
  );
}

function MaterialRow({ material }: { material: PackingCountSession["materials"][number] }) {
  const [all, setAll] = React.useState(false);
  const split = all ? material.split : material.split.slice(0, 8);
  return (
    <div className="grid gap-3 px-4 py-3 lg:grid-cols-[minmax(0,240px)_minmax(0,320px)_minmax(0,1fr)]">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-mono text-[13px] font-semibold text-content-1">{material.code}</span>
          {material.kind ? <Pill tone="info">{material.kind}</Pill> : null}
        </div>
        <div className="truncate text-[12px] text-content-3">
          {material.name && material.name !== material.code ? material.name : "Packing material"}
          {material.location_name ? ` · ${material.location_name}` : ""}
        </div>
      </div>
      <div className="flex items-stretch gap-1.5 text-center text-[11px] text-content-3">
        {[
          ["Book", material.book_qty],
          ["Counted", material.counted_qty],
        ].map(([label, value]) => (
          <div key={label as string} className="min-w-[64px] rounded-lg border border-line bg-surface-2 px-2 py-1">
            <div>{label}</div>
            <div className="font-mono text-[13px] font-semibold tabular-nums text-content-1">{value == null ? "—" : n(Number(value), 3)}</div>
          </div>
        ))}
        <div className="min-w-[72px] rounded-lg border border-info-border bg-info-bg px-2 py-1">
          <div>Used</div>
          <div className="font-mono text-[14px] font-bold tabular-nums text-primary">{qtyText(material.used_qty, material.uom)}</div>
        </div>
        <div className={cn("min-w-[64px] rounded-lg border px-2 py-1", material.mismatch ? "border-warning-border bg-warning-bg" : "border-line bg-surface-2")}>
          <div>Ticks</div>
          <div className={cn("font-mono text-[13px] font-semibold tabular-nums", material.mismatch ? "text-warning-fg" : "text-content-1")}>
            {n(material.ticks, 0)}
          </div>
        </div>
      </div>
      <div className="min-w-0 space-y-1.5">
        {material.mismatch ? (
          <p className="flex items-start gap-1.5 text-[12px] text-warning-fg" data-testid="packing-count-mismatch">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
            The yard ticked {n(material.ticks, 0)} but the count says {qtyText(material.used_qty, material.uom)} used. Check the count
            or the ticks; the usage was shared by ticks.
          </p>
        ) : null}
        {split.length ? (
          <div className="flex flex-wrap gap-1.5">
            {split.map((row, index) => (
              <Link
                key={`${row.sales_order_id}-${row.line_no}-${index}`}
                href={`/sales/orders/${row.sales_order_id}`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface-1 px-2 py-1 text-[12px] hover:border-line-strong"
                title={`${row.customer_name} · ${row.basis === "MARKED" ? `${n(row.units, 0)} tick${row.units === 1 ? "" : "s"}` : "by packing plan"}`}
              >
                <span className="font-mono font-semibold text-content-1">
                  {row.sales_order_no}
                  {row.line_no ? ` L${row.line_no}` : ""}
                </span>
                <span className="font-mono tabular-nums text-primary">{qtyText(row.qty, material.uom)}</span>
              </Link>
            ))}
            {material.split.length > 8 ? (
              <button type="button" className="text-[12px] font-semibold text-primary hover:underline" onClick={() => setAll((value) => !value)}>
                {all ? "Show fewer" : `+${material.split.length - 8} more`}
              </button>
            ) : null}
          </div>
        ) : null}
        {material.unassigned_qty ? (
          <p className="text-[12px] text-content-3">
            <b className="text-content-2">{qtyText(material.unassigned_qty, material.uom)}</b> not on any order (no order ticked or marked it, and
            no order packed that day has it in its packing plan)
          </p>
        ) : null}
        {material.excess_qty ? (
          <p className="text-[12px] text-success-fg">Found {qtyText(material.excess_qty, material.uom)} more than the book (added back to stock)</p>
        ) : null}
        {!split.length && !material.unassigned_qty && !material.excess_qty ? (
          <p className="text-[12px] text-content-3">Count matched the book; nothing used.</p>
        ) : null}
      </div>
    </div>
  );
}

export default function PackingAuditPage() {
  const searchParams = useSearchParams();
  // Local calendar dates (IST), not UTC: just after midnight the range must still include today.
  const localDay = (time: number) => new Date(time - new Date(time).getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  const today = localDay(Date.now());
  const monthAgo = localDay(Date.now() - 30 * 86400_000);
  const [view, setView] = React.useState<View>("count");
  const [dateFrom, setDateFrom] = React.useState(monthAgo);
  const [dateTo, setDateTo] = React.useState(today);
  const [customerId, setCustomerId] = React.useState("");
  const [materialId, setMaterialId] = React.useState("");
  const [orderNo, setOrderNo] = React.useState("");
  const deferredOrderNo = React.useDeferredValue(orderNo.trim());
  const [page, setPage] = React.useState(1);
  // Deep-link from Packing Yard: /audit?sales_order_id=<uuid> filters to one SO.
  const [salesOrderId, setSalesOrderId] = React.useState(searchParams?.get("sales_order_id") || "");
  React.useEffect(() => {
    const next = searchParams?.get("sales_order_id") || "";
    if (next !== salesOrderId) setSalesOrderId(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  React.useEffect(() => setPage(1), [view, dateFrom, dateTo, customerId, materialId, deferredOrderNo, salesOrderId]);

  const { data: customers = [] } = useQuery({
    queryKey: ["sales-customers"],
    queryFn: () => masterDataService.getCustomers(),
    staleTime: 60_000,
  });
  const { data: materials = [] } = useQuery({
    queryKey: ["packaging-materials-all"],
    queryFn: () => masterDataService.getPackaging(),
    staleTime: 60_000,
  });

  const sessions = useQuery({
    queryKey: ["packing-count-sessions", { dateFrom, dateTo, materialId, deferredOrderNo, page }],
    queryFn: ({ signal }) =>
      logisticsService.getPackingCountSessions(
        {
          date_from: dateFrom,
          date_to: dateTo,
          material_id: materialId,
          sales_order_no: deferredOrderNo,
          limit: SESSIONS_PER_PAGE,
          offset: (page - 1) * SESSIONS_PER_PAGE,
        },
        signal,
      ),
    placeholderData: keepPreviousData,
  });
  const list = useQuery({
    queryKey: ["packing-audit", { dateFrom, dateTo, customerId, materialId, deferredOrderNo, salesOrderId }],
    queryFn: () =>
      logisticsService.listOrderPackingConsumption({
        view: "all",
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        customer_id: customerId || undefined,
        material_id: materialId || undefined,
        sales_order_no: deferredOrderNo || undefined,
        sales_order_id: salesOrderId || undefined,
        limit: 1000,
      }),
    placeholderData: keepPreviousData,
    staleTime: 15_000,
  });

  const allRows = list.data?.rows || [];
  const countRows = allRows.filter((row) => row.stock_effect === "COUNT");
  const innerRows = allRows.filter((row) => row.stock_effect === "AT_PACKING");
  const tickRows = allRows.filter((row) => row.stock_effect === "MARK_ONLY");
  const rows = view === "inner" ? innerRows : view === "ticks" ? tickRows : [];
  const pageCount = Math.max(1, Math.ceil(rows.length / ROWS_PER_PAGE));
  const safePage = Math.min(page, pageCount);
  const pagedRows = rows.slice((safePage - 1) * ROWS_PER_PAGE, safePage * ROWS_PER_PAGE);
  const waitingTicks = tickRows.filter((row) => !row.counted).length;
  const sessionCount = Number(sessions.data?.count || 0);
  const sessionPages = Math.max(1, Math.ceil(sessionCount / SESSIONS_PER_PAGE));
  const mismatchCount = (sessions.data?.results || []).reduce((sum, session) => sum + session.mismatches, 0);

  const exportCsv = () => {
    const head =
      view === "count"
        ? ["Counted at", "Counted by", "Material", "Kind", "Book", "Counted", "Used", "Ticks", "Order", "Line", "Customer", "Booked qty", "UOM"]
        : [
            "When",
            "Order",
            "Line",
            "Customer",
            "Material code",
            "Material name",
            "Kind",
            "Qty",
            "UOM",
            "Location",
            view === "ticks" ? "Ticked by" : "By",
            "Notes",
            view === "ticks" ? "Counted" : "Basis",
          ];
    const body =
      view === "count"
        ? (sessions.data?.results || []).flatMap((session) =>
            session.materials.flatMap((material) =>
              (material.split.length ? material.split : [null]).map((row) => [
                formatDisplayDateTime(session.counted_at),
                session.counted_by,
                material.code,
                material.kind,
                material.book_qty ?? "",
                material.counted_qty ?? "",
                material.used_qty,
                material.ticks,
                row?.sales_order_no || "",
                row?.line_no ? `L${row.line_no}` : "",
                row?.customer_name || "",
                row ? row.qty : "",
                material.uom,
              ]),
            ),
          )
        : rows.map((row) => [
            formatDisplayDateTime(row.created_at),
            row.sales_order_no,
            row.line_no ? `L${row.line_no}` : "",
            row.customer_name || "",
            row.material_code,
            row.material_name,
            row.packaging_kind,
            Math.abs(row.qty),
            row.uom,
            row.location_name,
            row.ticked_by,
            String(row.notes || "").replace(/[\r\n,]/g, " "),
            view === "ticks" ? (row.counted ? "yes" : "waiting") : row.basis || "",
          ]);
    const csv = [head, ...body].map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `packing-audit-${view}-${dateFrom}_to_${dateTo}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const clearFilters = () => {
    setDateFrom(monthAgo);
    setDateTo(today);
    setCustomerId("");
    setMaterialId("");
    setOrderNo("");
  };

  return (
    <div className="mx-auto max-w-[1760px] space-y-3 pb-16" data-testid="packing-audit-page">
      <FloorHead
        icon={<ShieldCheck />}
        title="Packing audit"
        description="What packing material each order used. Inner pouches are taken at packing. Gonny, box, tape and extras are only ticked at release; the evening count books what was really used and shares it over the order lines that ticked it."
        actions={
          <>
            <Link href="/logistics/packing" className={floorButtonClass("secondary")}>
              <ArrowLeft /> Packing Yard
            </Link>
            <Link href="/logistics/packing/consumption" className={floorButtonClass("secondary")}>
              <ClipboardList /> Evening count
            </Link>
            <button
              type="button"
              onClick={exportCsv}
              disabled={view === "count" ? !(sessions.data?.results || []).length : !rows.length}
              className={floorButtonClass("primary")}
            >
              <Download /> Export CSV
            </button>
          </>
        }
      />

      <FloorKpiGrid>
        <FloorKpi
          icon={<ClipboardList />}
          label="Evening counts"
          tone="info"
          value={sessions.data ? n(sessionCount, 0) : "—"}
          unit="counts"
          sub="in the date range"
          active={view === "count"}
          onClick={() => setView("count")}
        />
        <FloorKpi
          icon={<Package />}
          label="Booked by counts"
          value={list.data ? n(countRows.length, 0) : "—"}
          unit="line bookings"
          sub={`${new Set(countRows.map((row) => row.sales_order_no)).size} orders`}
          onClick={() => setView("count")}
        />
        <FloorKpi
          icon={<Package />}
          label="Inner pouches at packing"
          tone="good"
          value={list.data ? n(innerRows.length, 0) : "—"}
          unit="records"
          sub={`${new Set(innerRows.map((row) => row.sales_order_no)).size} orders`}
          active={view === "inner"}
          onClick={() => setView("inner")}
        />
        <FloorKpi
          icon={<Tag />}
          label="Ticks at release"
          value={list.data ? n(tickRows.length, 0) : "—"}
          unit="ticks"
          sub="no stock effect until the count"
          active={view === "ticks"}
          onClick={() => setView("ticks")}
        />
        <FloorKpi
          icon={<AlertTriangle />}
          label="Waiting for a count"
          tone={waitingTicks ? "warn" : "neutral"}
          value={list.data ? n(waitingTicks, 0) : "—"}
          unit="ticks"
          sub="ticked after the last count"
          onClick={() => setView("ticks")}
        />
        <FloorKpi
          icon={<ShieldCheck />}
          label="Tick mismatches"
          tone={mismatchCount ? "bad" : "neutral"}
          value={sessions.data ? n(mismatchCount, 0) : "—"}
          unit="on this page"
          sub="ticks differ from what was counted"
          onClick={() => setView("count")}
        />
      </FloorKpiGrid>

      <section className="overflow-hidden rounded-[16px] border border-line bg-surface-1 shadow-[var(--shadow-sm)]">
        <div className="flex flex-wrap items-end justify-between gap-2 border-b border-line px-3 pt-1" role="tablist" aria-label="Packing audit views">
          <div className="flex gap-1 overflow-x-auto">
            {(
              [
                ["count", "Evening counts", sessions.data ? sessionCount : null],
                ["inner", "Inner pouches · at packing", list.data ? innerRows.length : null],
                ["ticks", "Ticks at release", list.data ? tickRows.length : null],
              ] as const
            ).map(([value, label, count]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={view === value}
                data-testid={`packing-audit-tab-${value}`}
                onClick={() => setView(value)}
                className={cn(
                  "relative flex min-h-[42px] shrink-0 items-center gap-2 px-3 text-[13px] font-semibold transition-colors",
                  view === value ? "text-content-1" : "text-content-3 hover:text-content-1",
                )}
              >
                {label}
                {count != null ? (
                  <span className={cn("rounded-full px-1.5 text-[11px] tabular-nums", view === value ? "bg-primary text-white" : "bg-surface-2 text-content-3")}>
                    {n(count, 0)}
                  </span>
                ) : null}
                {view === value ? <span className="absolute inset-x-2 -bottom-px h-[2px] rounded-full bg-primary" aria-hidden /> : null}
              </button>
            ))}
          </div>
          <span className="pb-2 text-[12px] text-content-3">
            {view === "count"
              ? "One card per evening count: book, counted, used, and the share each order line took"
              : view === "inner"
                ? "Inner pouches taken at packing, one record per batch or unit"
                : "Ticked at release; booked only when the evening count runs"}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 p-2">
          <label className="flex items-center gap-1.5 text-[12px] text-content-3">
            From
            <Input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="h-9 w-[150px] rounded-xl" aria-label="Date from" />
          </label>
          <label className="flex items-center gap-1.5 text-[12px] text-content-3">
            to
            <Input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="h-9 w-[150px] rounded-xl" aria-label="Date to" />
          </label>
          <Select value={customerId || "__all"} onValueChange={(value) => setCustomerId(value === "__all" ? "" : value)}>
            <SelectTrigger className="h-9 w-[190px] rounded-xl" aria-label="Customer">
              <SelectValue placeholder="All customers" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">All customers</SelectItem>
              {customers.map((customer: Customer) => (
                <SelectItem key={customer.id} value={customer.id!}>
                  {customer.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={materialId || "__all"} onValueChange={(value) => setMaterialId(value === "__all" ? "" : value)}>
            <SelectTrigger className="h-9 w-[220px] rounded-xl" aria-label="Packing material">
              <SelectValue placeholder="All packing materials" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">All packing materials</SelectItem>
              {materials.map((material: PackagingMaterial) => (
                <SelectItem key={material.id} value={material.id!}>
                  {material.code}
                  {material.name && material.name !== material.code ? ` · ${material.name}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative min-w-[180px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-4" aria-hidden />
            <Input
              value={orderNo}
              onChange={(event) => setOrderNo(event.target.value)}
              placeholder="Order number, e.g. SO-2026-0469"
              className="h-9 rounded-xl pl-9"
              aria-label="Order number"
            />
          </div>
          {salesOrderId ? (
            <Link
              href="/logistics/packing/audit"
              className="inline-flex h-9 items-center gap-1 rounded-xl border border-info-border bg-info-bg px-3 text-[12px] font-semibold text-info-fg"
            >
              One order <X className="h-3.5 w-3.5" aria-hidden />
            </Link>
          ) : null}
          <button type="button" className="h-9 px-2 text-[12px] font-semibold text-content-3 hover:text-content-1" onClick={clearFilters}>
            Clear
          </button>
          {view === "count" && customerId ? <span className="text-[11.5px] text-content-4">customer filter applies to the lists</span> : null}
        </div>
      </section>

      {list.data?.weight_summary ? (
        <section
          className="grid gap-3 rounded-2xl border border-line bg-surface-1 p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-4"
          data-testid="packing-weight-summary"
          aria-label="Product weight against dispatch weight"
        >
          {[
            { label: "Our product", value: list.data.weight_summary.product_kg, sub: `machine output in ${list.data.weight_summary.sealed_units} sealed gonnies` },
            { label: "Dispatch weight (gross)", value: list.data.weight_summary.dispatch_gross_kg, sub: "weighed at sealing" },
            {
              label: "Packing in the dispatch weight",
              value: list.data.weight_summary.packing_kg,
              sub: `inner pouches ${kgText(list.data.weight_summary.inner_pouch_tare_kg)} + gonny ${kgText(list.data.weight_summary.gonny_tare_kg)} expected`,
            },
            {
              label: "In-house inner pouches taken",
              value: list.data.weight_summary.inner_pouch_taken_kg,
              sub: "by weight at the machine; bought pouches and other packing go to the evening count",
            },
          ].map((tile) => (
            <div key={tile.label} className="min-w-0">
              <div className="text-caption font-semibold text-content-3">{tile.label}</div>
              <div className="mt-0.5 font-mono text-lg font-semibold tabular-nums text-content-1">{kgText(tile.value)}</div>
              <div className="text-caption text-content-3">{tile.sub}</div>
            </div>
          ))}
        </section>
      ) : null}

      {view === "count" ? (
        <div className="space-y-3">
          {sessions.isLoading ? (
            Array.from({ length: 2 }).map((_, index) => <div key={index} className="erp-skeleton h-[180px] rounded-2xl" />)
          ) : (sessions.data?.results || []).length ? (
            (sessions.data?.results || []).map((session) => <CountCard key={session.session_id} session={session} />)
          ) : (
            <div className="rounded-[16px] border border-line bg-surface-1 px-5 py-8">
              <PanelEmpty icon={<ClipboardList />} title="No evening counts in this range">
                Counts posted from Evening count appear here with what each order line took.
              </PanelEmpty>
            </div>
          )}
          <div className="flex items-center justify-between px-1 text-[11.5px] text-content-3">
            <span>
              {sessionCount ? `${(page - 1) * SESSIONS_PER_PAGE + 1}–${Math.min(sessionCount, page * SESSIONS_PER_PAGE)} of ${n(sessionCount, 0)} counts` : ""}
            </span>
            <Pager page={page} pageCount={sessionPages} onPageChange={setPage} testId="packing-count-page" />
          </div>
        </div>
      ) : (
        <section className="overflow-hidden rounded-[16px] border border-line bg-surface-1 shadow-[var(--shadow-sm)]">
          {pagedRows.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-[12.5px]">
                <thead className="bg-surface-2 text-[11px] text-content-3">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">When</th>
                    <th className="px-3 py-2 text-left font-medium">Order · line</th>
                    <th className="px-3 py-2 text-left font-medium">Customer</th>
                    <th className="px-3 py-2 text-left font-medium">Material</th>
                    <th className="px-3 py-2 text-right font-medium">{view === "ticks" ? "Ticked" : "Taken"}</th>
                    <th className="px-3 py-2 text-left font-medium">Location</th>
                    <th className="px-3 py-2 text-left font-medium">{view === "ticks" ? "Ticked by · count" : "Basis"}</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedRows.map((row) => (
                    <tr key={row.id} className="border-t border-line align-top">
                      <td className="whitespace-nowrap px-3 py-2 text-content-2">{formatDisplayDateTime(row.created_at)}</td>
                      <td className="whitespace-nowrap px-3 py-2">
                        {row.sales_order_id ? (
                          <Link href={`/sales/orders/${row.sales_order_id}`} className="font-mono font-semibold text-content-1 hover:underline">
                            {row.sales_order_no}
                          </Link>
                        ) : (
                          <span className="font-mono text-content-3">—</span>
                        )}
                        {row.line_no ? <span className="ml-1 rounded border border-line px-1 font-mono text-[11px] text-content-2">L{row.line_no}</span> : null}
                      </td>
                      <td className="max-w-[220px] truncate px-3 py-2 text-content-2">{row.customer_name || "—"}</td>
                      <td className="px-3 py-2">
                        <span className="font-mono font-semibold text-content-1">{row.material_code}</span>
                        {row.material_name && row.material_name !== row.material_code ? <span className="text-content-3"> · {row.material_name}</span> : null}
                        {row.packaging_kind ? (
                          <Pill tone="info" className="ml-1.5">
                            {row.packaging_kind}
                          </Pill>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums text-content-1">{qtyText(row.qty, row.uom)}</td>
                      <td className="max-w-[200px] truncate px-3 py-2 text-content-3">{row.location_name || "—"}</td>
                      <td className="px-3 py-2">
                        {view === "ticks" ? (
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="text-content-2">{row.ticked_by || "—"}</span>
                            <Pill tone={row.counted ? "good" : "warn"} dot>
                              {row.counted ? "counted" : "waiting for the count"}
                            </Pill>
                          </span>
                        ) : (
                          <span className="text-content-3">{row.basis === "PER_PACK" ? "per inner pack" : row.basis || "at packing"}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="px-5 py-8">
              <PanelEmpty
                icon={view === "ticks" ? <Tag /> : <Package />}
                title={list.isLoading ? "Loading…" : view === "ticks" ? "No ticks in this range" : "No inner pouches taken in this range"}
              >
                {view === "ticks"
                  ? "Ticks are made in Packing Yard when gonnies and rolls are released."
                  : "In-house inner pouches are taken at the machine's last pouching step when output is logged."}
              </PanelEmpty>
            </div>
          )}
          <footer className="flex items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-[11.5px] text-content-3">
            <span>
              {rows.length ? `${(safePage - 1) * ROWS_PER_PAGE + 1}–${Math.min(rows.length, safePage * ROWS_PER_PAGE)} of ${n(rows.length, 0)} records` : "0 records"}
              {allRows.length >= 1000 ? " · newest 1,000 shown, narrow the dates to see older" : ""}
            </span>
            <Pager page={safePage} pageCount={pageCount} onPageChange={setPage} testId="packing-audit-rows" />
          </footer>
        </section>
      )}
    </div>
  );
}

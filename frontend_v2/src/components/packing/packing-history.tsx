"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, FileText, History, Search, Truck, User } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PanelEmpty } from "@/components/premium";
import { JobNameTag } from "@/components/spine/job-name-tag";
import { Pager, Pill, apiError as err, clean, kgText as kg, lineScopeSpec, num as n } from "@/components/logistics/yard-ui";
import { logisticsService, type PackingReleaseRow } from "@/services/logistics";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 60;
type Range = "today" | "week" | "all";
const RANGE_DAYS: Record<Range, number | undefined> = { today: 0, week: 6, all: undefined };

type ReleaseGroup = {
  key: string;
  at: string | null;
  by: string;
  kind: "GONNY" | "ROLL";
  order: PackingReleaseRow["sales_order"];
  sample: PackingReleaseRow;
  units: PackingReleaseRow[];
};

/** Units released together (same line, same minute, same person) read as one line release. */
function groupReleases(rows: PackingReleaseRow[]): ReleaseGroup[] {
  const groups = new Map<string, ReleaseGroup>();
  rows.forEach((row) => {
    const key = [row.kind, row.sales_order_item_id || row.id, String(row.released_at || "").slice(0, 16), row.released_by].join("|");
    const group = groups.get(key) || {
      key,
      at: row.released_at,
      by: row.released_by,
      kind: row.kind,
      order: row.sales_order,
      sample: row,
      units: [],
    };
    group.units.push(row);
    groups.set(key, group);
  });
  return Array.from(groups.values());
}

const timeOf = (value: string | null) => {
  if (!value) return { time: "—", day: "" };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { time: "—", day: "" };
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return {
    time: date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
    day: sameDay ? "today" : date.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
  };
};

function ReleaseRow({ group }: { group: ReleaseGroup }) {
  const [open, setOpen] = React.useState(false);
  const isGonny = group.kind === "GONNY";
  const pcs = group.units.reduce((sum, unit) => sum + Number(unit.qty_pcs || 0), 0);
  const net = group.units.reduce((sum, unit) => sum + Number(unit.net_kg || 0), 0);
  const gross = group.units.reduce((sum, unit) => sum + Number(unit.gross_kg || 0), 0);
  const marks = Array.from(
    new Map(group.units.flatMap((unit) => unit.marks).map((mark) => [mark.material_id, mark])).values(),
  );
  const markCount = (materialId: string) =>
    group.units.reduce((sum, unit) => sum + unit.marks.filter((mark) => mark.material_id === materialId).reduce((s, m) => s + Number(m.qty || 0), 0), 0);
  const slips = Array.from(new Map(group.units.filter((unit) => unit.slip).map((unit) => [unit.slip!.id, unit.slip!])).values());
  const when = timeOf(group.at);
  return (
    <div className="border-t border-line" data-testid={`packing-history-row-${group.units[0].id}`}>
      <div className="grid items-center gap-x-4 gap-y-2 px-4 py-2.5 md:grid-cols-[96px_minmax(0,1.4fr)_170px_minmax(0,1fr)_auto]">
        <div className="text-[12px] text-content-3">
          <div className="text-[14px] font-bold tabular-nums text-content-1">{when.time}</div>
          <div>{when.day}</div>
          <div className="flex items-center gap-1 truncate">
            <User className="h-3 w-3 shrink-0" aria-hidden />
            <span className="truncate">{group.by || "—"}</span>
          </div>
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <JobNameTag name={group.order.job_name} />
            {group.order.id ? (
              <Link href={`/sales/orders/${group.order.id}`} className="font-mono text-[12px] font-semibold text-content-2 hover:underline">
                {group.order.order_number}
              </Link>
            ) : null}
            <span className="truncate text-[12px] text-content-3">{group.order.customer_name}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11.5px] text-content-3">
            <Pill tone={isGonny ? "warn" : "info"}>{clean(group.sample.product_name) || (isGonny ? "Pouch" : "Roll")}</Pill>
            <span>{lineScopeSpec(group.sample)}</span>
          </div>
        </div>
        <div className="text-[12px] text-content-3">
          <div className="text-[13px] font-semibold text-content-1">
            {group.units.length} {isGonny ? `gonn${group.units.length === 1 ? "y" : "ies"}` : `roll${group.units.length === 1 ? "" : "s"}`}
          </div>
          <div className="tabular-nums">
            {isGonny ? `${n(pcs, 0)} pcs · ` : ""}
            {kg(net)} net · {kg(gross)} gross
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          {marks.length ? (
            marks.slice(0, 5).map((mark) => (
              <Pill key={mark.material_id} tone="neutral" title={mark.name}>
                {mark.code || "Item"} × {n(markCount(mark.material_id), 0)}
              </Pill>
            ))
          ) : (
            <Pill tone="neutral">{isGonny ? "no extra items" : "no marks · unpacked"}</Pill>
          )}
          {marks.length > 5 ? <Pill tone="neutral">+{marks.length - 5}</Pill> : null}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {slips.length ? (
            slips.map((slip) => (
              <Pill key={slip.id} tone={String(slip.status).toUpperCase() === "DRAFT" ? "accent" : "good"}>
                <Truck className="mr-1 inline h-3 w-3" aria-hidden />
                {slip.dc_no}
                {String(slip.status).toUpperCase() === "DRAFT" ? "" : ` · ${String(slip.status).replace(/_/g, " ").toLowerCase()}`}
              </Pill>
            ))
          ) : (
            <Pill tone="info">
              <FileText className="mr-1 inline h-3 w-3" aria-hidden />
              Own slip · in Dispatch Bay
            </Pill>
          )}
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            className="flex min-h-[32px] items-center gap-1 rounded-lg px-2 text-[12px] font-semibold text-content-2 hover:bg-surface-2"
          >
            Details <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden />
          </button>
        </div>
      </div>
      {open ? (
        <div className="grid gap-3 border-t border-line bg-surface-2/40 px-4 py-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div className="overflow-x-auto rounded-xl border border-line bg-surface-1">
            <table className="w-full min-w-[520px] text-[12px]">
              <thead className="bg-surface-2 text-[11px] text-content-3">
                <tr>
                  <th className="px-3 py-1.5 text-left font-medium">{isGonny ? "Gonny" : "Roll"}</th>
                  {isGonny ? <th className="px-3 py-1.5 text-right font-medium">Packs</th> : null}
                  {isGonny ? <th className="px-3 py-1.5 text-right font-medium">Pcs</th> : null}
                  <th className="px-3 py-1.5 text-right font-medium">Net</th>
                  <th className="px-3 py-1.5 text-right font-medium">Gross</th>
                  {isGonny ? <th className="px-3 py-1.5 text-right font-medium">vs expected</th> : <th className="px-3 py-1.5 text-left font-medium">Mode</th>}
                </tr>
              </thead>
              <tbody>
                {group.units.map((unit) => (
                  <tr key={unit.id} className="border-t border-line">
                    <td className="px-3 py-1.5 font-mono font-semibold text-content-1">
                      {unit.unit}
                      {unit.batch_no ? <span className="ml-1 font-sans text-[11px] font-normal text-content-3">{unit.batch_no}</span> : null}
                    </td>
                    {isGonny ? <td className="px-3 py-1.5 text-right tabular-nums">{unit.primary_pack_count ?? "—"}</td> : null}
                    {isGonny ? <td className="px-3 py-1.5 text-right tabular-nums">{n(unit.qty_pcs, 0)}</td> : null}
                    <td className="px-3 py-1.5 text-right tabular-nums">{kg(unit.net_kg)}</td>
                    <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{kg(unit.gross_kg)}</td>
                    {isGonny ? (
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {unit.gross_variance_pct == null ? "—" : `${unit.gross_variance_pct > 0 ? "+" : ""}${n(unit.gross_variance_pct, 1)}%`}
                      </td>
                    ) : (
                      <td className="px-3 py-1.5">{unit.release_mode === "UNPACKED" ? "Unpacked" : "Packed"}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="space-y-2">
            <div className="text-[12px] font-semibold text-content-2">Evening-count marks · booked to {group.order.order_number}</div>
            {marks.length ? (
              <ul className="space-y-1">
                {marks.map((mark) => (
                  <li key={mark.material_id} className="flex items-center justify-between rounded-lg border border-success-border bg-success-bg px-2.5 py-1.5 text-[12px]">
                    <span>
                      <b className="font-mono text-content-1">{mark.code}</b> <span className="text-content-3">{mark.name}</span>
                    </span>
                    <span className="tabular-nums text-content-2">ticked on {n(markCount(mark.material_id), 0)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12px] text-content-3">Nothing ticked on this release.</p>
            )}
            <div className="flex flex-wrap gap-2 pt-1">
              {group.order.id ? (
                <Button asChild size="sm" variant="outline">
                  <a
                    href={logisticsService.getMaterialReadySlipUrl(group.order.id, {
                      rollIds: isGonny ? [] : group.units.map((unit) => unit.id),
                      gonnyIds: isGonny ? group.units.map((unit) => unit.id) : [],
                    })}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <FileText className="mr-1 h-3.5 w-3.5" aria-hidden /> Line ready slip
                  </a>
                </Button>
              ) : null}
              <Button asChild size="sm" variant="outline">
                <Link href="/logistics/dispatch">
                  <Truck className="mr-1 h-3.5 w-3.5" aria-hidden /> Open in Dispatch Bay
                </Link>
              </Button>
              {group.order.id ? (
                <Button asChild size="sm" variant="ghost">
                  <Link href={`/logistics/packing/audit?sales_order_id=${group.order.id}`}>
                    <History className="mr-1 h-3.5 w-3.5" aria-hidden /> Audit
                  </Link>
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Released from packing: newest first, one row per line release with every gonny and weight. */
export function PackingHistory({ salesOrderId, search: outerSearch }: { salesOrderId?: string; search?: string }) {
  const [range, setRange] = React.useState<Range>("week");
  const [search, setSearch] = React.useState("");
  const [term, setTerm] = React.useState("");
  const [page, setPage] = React.useState(1);
  React.useEffect(() => {
    const timer = window.setTimeout(() => setTerm((search || outerSearch || "").trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search, outerSearch]);
  React.useEffect(() => setPage(1), [term, range, salesOrderId]);
  const history = useQuery({
    queryKey: ["packing-release-history", term, salesOrderId || "ALL", range, page],
    queryFn: ({ signal }) =>
      logisticsService.getPackingReleaseHistory(
        {
          search: term || undefined,
          sales_order_id: salesOrderId,
          days: RANGE_DAYS[range],
          limit: PAGE_SIZE,
          offset: (page - 1) * PAGE_SIZE,
        },
        signal,
      ),
    placeholderData: (previous) => previous,
  });
  const groups = groupReleases(history.data?.results || []);
  const total = history.data?.total || 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <section className="overflow-hidden rounded-[16px] border border-line bg-surface-1 shadow-[var(--shadow-sm)]" data-testid="packing-history">
      <header className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-content-3" aria-hidden />
          <h2 className="text-[15px] font-semibold text-content-1">Released from packing</h2>
          <span className="text-[12px] text-content-3">
            {groups.length} line release{groups.length === 1 ? "" : "s"} · {n(total, 0)} units
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-xl border border-line bg-surface-2 p-0.5" role="group" aria-label="History range">
            {(
              [
                ["today", "Today"],
                ["week", "7 days"],
                ["all", "All"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={range === value}
                data-testid={`packing-history-range-${value}`}
                onClick={() => setRange(value)}
                className={cn(
                  "min-h-[30px] rounded-[10px] px-3 text-[12px] font-semibold transition-colors",
                  range === value ? "bg-surface-1 text-content-1 shadow-[var(--shadow-sm)]" : "text-content-3 hover:text-content-1",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="relative w-full sm:w-56">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-4" aria-hidden />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search history"
              aria-label="Search release history"
              data-testid="packing-history-search"
              className="h-9 rounded-xl pl-9"
            />
          </div>
        </div>
      </header>
      {history.isError ? (
        <div role="alert" className="mx-4 mb-3 rounded-xl border border-danger-border bg-danger-bg px-3 py-2 text-[12.5px] text-danger-fg">
          History unavailable: {err(history.error)}
        </div>
      ) : null}
      {groups.length ? (
        groups.map((group) => <ReleaseRow key={group.key} group={group} />)
      ) : (
        <div className="border-t border-line px-5 py-6">
          <PanelEmpty icon={<History />} title={history.isLoading ? "Loading history…" : "Nothing released in this range"}>
            {term ? "No release matches this search." : "Release a line from the queue and it appears here with every gonny and weight."}
          </PanelEmpty>
        </div>
      )}
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-[11.5px] text-content-3">
        <span data-testid="packing-history-total">
          Every detail is kept: who, when, gonnies with weights, evening-count marks and the slip.
        </span>
        <Pager page={Math.min(page, pageCount)} pageCount={pageCount} onPageChange={setPage} testId="packing-history-page" />
      </footer>
    </section>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, ClipboardList, Plus, Search, Ticket } from "lucide-react";

import { LoadFailure, RightsDenied, docDate, docDateTime, useDebounced, useDocumentRights } from "@/components/outward/document-rights";
import { PageHero, Panel, PanelEmpty } from "@/components/premium";
import { cn } from "@/lib/utils";
import { GATE_PASS_TABS, gatePassesApi, type GatePass, type GatePassKind, type GatePassTab } from "@/services/gate-passes";

import { GatePassStatusPill, KindBadge, itemSummary } from "./gate-pass-common";

const PAGE_SIZE = 25;

export function GatePassList() {
  const rights = useDocumentRights();
  const canView = rights.has("documents.view") || rights.has("gatepass.manage");
  const canManage = rights.has("gatepass.manage");
  const [tab, setTab] = useState<GatePassTab>("OPEN");
  const [plant, setPlant] = useState("");
  const [kind, setKind] = useState<GatePassKind | "">("");
  const [vendor, setVendor] = useState("");
  const [machine, setMachine] = useState("");
  const [searchText, setSearchText] = useState("");
  const search = useDebounced(searchText.trim());
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [tab, plant, kind, vendor, machine, search]);

  const filters = { plant, kind: kind || undefined, vendor, machine, search: search || undefined };
  const listQ = useQuery({
    queryKey: ["inventory", "gate-passes", "list", tab, filters, page],
    queryFn: () => gatePassesApi.list({ ...filters, status: tab, page, page_size: PAGE_SIZE }),
    enabled: canView,
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    meta: { suppressGlobalError: true },
  });
  const optionsQ = useQuery({
    queryKey: ["inventory", "documents", "form-options", plant],
    queryFn: () => gatePassesApi.formOptions({ plant: plant || undefined }),
    enabled: canView,
    staleTime: 5 * 60_000,
    retry: false,
    meta: { suppressGlobalError: true },
  });

  if (rights.loading) return <div className="h-40 animate-pulse rounded-3xl bg-surface-2" />;
  if (!canView) {
    return (
      <RightsDenied
        title="Gate passes are for the inventory team"
        body="Inventory users, administrators and owners see and raise returnable (RGP) and non-returnable (NRGP) gate passes. Other accounts need a documents right in the role matrix."
      />
    );
  }

  const rows = listQ.data?.results ?? [];
  const count = listQ.data?.count ?? 0;
  const counts = listQ.data?.counts;
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const options = optionsQ.data;

  return (
    <div className="mx-auto max-w-[1400px] space-y-4" data-testid="gate-pass-list">
      <PageHero
        eyebrow="Inventory · items leaving the factory"
        icon={<Ticket />}
        title="Gate passes"
        description="Numbered RGP / NRGP for machine parts, tools and equipment going out for repair, calibration, trial, sample or scrap. The watchman scans the printed QR when the items leave; returns close the pass. Gate passes never move stock."
        actions={
          canManage ? (
            <Link href="/inventory/gate-passes/new" className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-white/10 px-4 text-[13px] font-semibold text-white hover:bg-white/15">
              <Plus className="h-4 w-4" /> New gate pass
            </Link>
          ) : null
        }
        compact
      >
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-[13px] text-white/80">
          <span>
            <span className="text-[22px] font-semibold tabular-nums text-white">{counts?.OPEN ?? "—"}</span> open
          </span>
          <span>
            <span className={cn("text-[22px] font-semibold tabular-nums", counts?.OVERDUE ? "text-[var(--viz-critical)]" : "text-white")}>{counts?.OVERDUE ?? "—"}</span> overdue
          </span>
        </div>
      </PageHero>

      <div className="flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Gate pass status">
        {GATE_PASS_TABS.map((t, i) => {
          const active = t.key === tab;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active}
              title={t.hint}
              tabIndex={active ? 0 : -1}
              onClick={() => setTab(t.key)}
              onKeyDown={(event) => {
                const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
                const next = event.key === "Home" ? 0 : event.key === "End" ? GATE_PASS_TABS.length - 1 : delta ? (i + delta + GATE_PASS_TABS.length) % GATE_PASS_TABS.length : -1;
                if (next < 0) return;
                event.preventDefault();
                setTab(GATE_PASS_TABS[next].key);
                (event.currentTarget.parentElement?.children[next] as HTMLButtonElement | undefined)?.focus();
              }}
              className={cn(
                "inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-full border px-4 text-[13px] font-semibold transition-colors",
                active ? "border-transparent bg-content-1 text-surface-1" : "border-line bg-surface-1 text-content-2 hover:bg-surface-2",
                t.key === "OVERDUE" && counts?.OVERDUE && !active ? "border-danger-border text-danger-fg" : "",
              )}
            >
              {t.label}
              <span className={cn("rounded-full px-2 py-0.5 text-[11px] tabular-nums", active ? "bg-white/15" : "bg-surface-2")}>{counts?.[t.key] ?? "–"}</span>
            </button>
          );
        })}
      </div>

      <Panel bodyClassName="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_repeat(4,minmax(0,0.8fr))]">
          <label className="relative block">
            <span className="sr-only">Search gate passes</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-4" />
            <input
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Number, party, item, serial, vehicle"
              className="h-11 w-full rounded-xl border border-line bg-surface-2 pl-9 pr-3 text-[14px] text-content-1 outline-none focus:border-primary focus:ring-2 focus:ring-info-border"
            />
          </label>
          <FilterSelect label="Factory" value={plant} onChange={(v) => { setPlant(v); setMachine(""); }} options={(options?.plants ?? []).map((p) => [p.id, p.name])} all="All factories" />
          <FilterSelect label="Type" value={kind} onChange={(v) => setKind(v as GatePassKind | "")} options={[["RETURNABLE", "Returnable (RGP)"], ["NON_RETURNABLE", "Non-returnable (NRGP)"]]} all="RGP and NRGP" />
          <FilterSelect label="Vendor" value={vendor} onChange={setVendor} options={(options?.vendors ?? []).map((v) => [v.id, v.name])} all="All parties" />
          <FilterSelect label="Machine" value={machine} onChange={setMachine} options={(options?.machines ?? []).map((m) => [m.id, `${m.name} (${m.code})`])} all="All machines" />
        </div>

        {listQ.isError ? <LoadFailure subject="Gate passes" error={listQ.error} retry={() => void listQ.refetch()} /> : null}

        {listQ.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-[76px] animate-pulse rounded-2xl bg-surface-2" />
            ))}
          </div>
        ) : rows.length ? (
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line" aria-label="Gate passes">
            {rows.map((row) => (
              <GatePassRow key={row.id} row={row} />
            ))}
          </ul>
        ) : !listQ.isError ? (
          <PanelEmpty icon={<ClipboardList />} title={tab === "OVERDUE" ? "Nothing overdue" : tab === "OPEN" ? "No open gate passes" : "No gate passes for these filters"}>
            {canManage && (tab === "OPEN" || tab === "DRAFT") ? (
              <Link href="/inventory/gate-passes/new" className="font-semibold text-primary hover:underline">
                Raise a gate pass
              </Link>
            ) : (
              "Try another status, factory or search."
            )}
          </PanelEmpty>
        ) : null}

        <div className="flex items-center justify-between gap-3 text-[13px] text-content-3">
          <span className="tabular-nums">
            {count.toLocaleString("en-IN")} gate pass{count === 1 ? "" : "es"}
            {tab === "OPEN" || tab === "OVERDUE" ? " · earliest due first" : ""}
          </span>
          <div className="flex items-center gap-2">
            <button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-surface-1 disabled:opacity-40">
              <ChevronLeft className="h-5 w-5" />
            </button>
            <span className="min-w-[64px] text-center tabular-nums">
              {page} / {pages}
            </span>
            <button type="button" aria-label="Next page" disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-surface-1 disabled:opacity-40">
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
        </div>
      </Panel>
    </div>
  );
}

function FilterSelect({ label, value, onChange, options, all }: { label: string; value: string; onChange: (value: string) => void; options: Array<[string, string]>; all: string }) {
  return (
    <label className="block">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="h-11 w-full rounded-xl border border-line bg-surface-2 px-3 text-[14px] text-content-1 outline-none focus:border-primary">
        <option value="">{all}</option>
        {options.map(([id, name]) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}

function GatePassRow({ row }: { row: GatePass }) {
  const returned = row.lines.filter((line) => Number(line.outstanding_quantity) === 0).length;
  return (
    <li>
      <Link
        href={`/inventory/gate-passes/${row.id}`}
        className="flex min-h-[76px] items-center gap-3 px-3 py-3 transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border sm:px-4"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <KindBadge kind={row.kind} />
            <span className="font-mono text-[14px] font-semibold text-content-1">{row.display_number}</span>
            <GatePassStatusPill gatePass={row} />
          </div>
          <div className="mt-0.5 truncate text-[13px] text-content-1">
            {row.party_name} · <span className="text-content-3">{row.purpose_label}</span>
          </div>
          <div className="mt-0.5 truncate text-[12.5px] text-content-3">
            {itemSummary(row)} · {row.plant_name}
            {row.kind === "RETURNABLE" && ["OUT", "PARTLY_RETURNED"].includes(row.status) ? ` · ${returned}/${row.line_count} lines back` : ""}
          </div>
        </div>
        <div className="shrink-0 text-right text-[12.5px]">
          {row.kind === "RETURNABLE" && row.expected_return_date ? (
            <>
              <div className={cn("font-semibold tabular-nums", row.is_overdue ? "text-danger-fg" : "text-content-1")}>{docDate(row.expected_return_date)}</div>
              <div className="text-[11px] text-content-4">due back</div>
            </>
          ) : (
            <>
              <div className="font-semibold tabular-nums text-content-1">{docDateTime(row.out_at ?? row.issued_at ?? row.created_at)}</div>
              <div className="text-[11px] text-content-4">{row.out_at ? "left" : row.issued_at ? "issued" : "drafted"}</div>
            </>
          )}
        </div>
        <ChevronRight className="hidden h-5 w-5 shrink-0 text-content-4 sm:block" aria-hidden />
      </Link>
    </li>
  );
}

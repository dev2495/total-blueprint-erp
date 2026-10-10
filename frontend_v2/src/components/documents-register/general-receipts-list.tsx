"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowUpRight, History, Plus, ReceiptText, Search, Wrench } from "lucide-react";

import { PageHero, Panel, PanelEmpty } from "@/components/premium";
import { cn } from "@/lib/utils";
import { BillAccessDenied, TonePill, billDate, billDateTime, inr, useDocumentAccess } from "@/components/inventory/gate-bills/bill-common";
import { generalReceiptsApi, LINE_CATEGORY_LABEL, type GeneralReceipt, type LineCategory, type MachineEvent, type ReceiptType } from "@/services/general-receipts";
import { ErrorBanner, ListSkeleton, Pager, PlantSelect, fieldClass, labelClass, useDebounced } from "./shared";

const PAGE_SIZE = 25;
type TabKey = "receipts" | "machines";

/** /inventory/general-receipts: register of non-stock receipts and the per-machine history. */
export function GeneralReceiptsPage() {
  const access = useDocumentAccess();
  const router = useRouter();
  const pathname = usePathname() || "/inventory/general-receipts";
  const params = useSearchParams();
  const tab: TabKey = params?.get("tab") === "machines" ? "machines" : "receipts";
  const setTab = (next: TabKey) => {
    const query = new URLSearchParams(params?.toString() ?? "");
    if (next === "receipts") query.delete("tab");
    else query.set("tab", next);
    router.replace(`${pathname}${query.toString() ? `?${query}` : ""}`, { scroll: false });
  };
  if (access.loading) return <div className="h-40 animate-pulse rounded-3xl bg-surface-2" role="status" aria-label="Loading" />;
  if (!access.view) return <BillAccessDenied title="General receipts are for the Inventory team" />;
  return (
    <div className="mx-auto max-w-[1400px] space-y-4" data-testid="general-receipts">
      <PageHero
        eyebrow="Inventory · bills & documents"
        icon={<ReceiptText />}
        title="General receipts"
        description="Spares, machinery, tools, services and charges: what came in or what work was done, who confirmed it and when — and against which machine. These never change stock."
        actions={
          access.manage ? (
            <Link href="/inventory/general-receipts/new" className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-white px-4 text-[13px] font-semibold text-content-1 hover:bg-white/90">
              <Plus className="h-4 w-4" /> New general receipt
            </Link>
          ) : null
        }
        compact
      />
      <div className="flex gap-1.5" role="tablist" aria-label="General receipt views">
        {([
          { key: "receipts", label: "Receipts" },
          { key: "machines", label: "Machine history" },
        ] as Array<{ key: TabKey; label: string }>).map((t, i, all) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            tabIndex={tab === t.key ? 0 : -1}
            onClick={() => setTab(t.key)}
            onKeyDown={(event) => {
              if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
              event.preventDefault();
              const next = all[(i + (event.key === "ArrowRight" ? 1 : -1) + all.length) % all.length];
              setTab(next.key);
              (event.currentTarget.parentElement?.children[all.indexOf(next)] as HTMLButtonElement | undefined)?.focus();
            }}
            className={cn("inline-flex min-h-[44px] items-center rounded-full border px-4 text-[13px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border", tab === t.key ? "border-transparent bg-content-1 text-surface-1" : "border-line bg-surface-1 text-content-2 hover:bg-surface-2")}
          >
            {t.label}
          </button>
        ))}
      </div>
      <section role="tabpanel">{tab === "receipts" ? <ReceiptsTab canCreate={access.manage} /> : <MachineHistoryTab initialMachine={params?.get("machine") ?? ""} />}</section>
    </div>
  );
}

function ReceiptsTab({ canCreate }: { canCreate: boolean }) {
  const [plant, setPlant] = useState("");
  const [type, setType] = useState<ReceiptType | "">("");
  const [category, setCategory] = useState<LineCategory | "">("");
  const [status, setStatus] = useState<"" | "POSTED" | "REVERSED">("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [searchText, setSearchText] = useState("");
  const search = useDebounced(searchText.trim(), 350);
  const [page, setPage] = useState(1);
  const filters = useMemo(() => ({ plant, receipt_type: type, line_category: category, status, date_from: dateFrom || undefined, date_to: dateTo || undefined, search: search || undefined }), [plant, type, category, status, dateFrom, dateTo, search]);
  useEffect(() => setPage(1), [filters]);
  const invalid = Boolean(dateFrom && dateTo && dateFrom > dateTo);
  const q = useQuery({
    queryKey: ["general-receipts", "list", filters, page],
    queryFn: () => generalReceiptsApi.list({ ...filters, page, page_size: PAGE_SIZE }),
    placeholderData: keepPreviousData,
    enabled: !invalid,
    meta: { suppressGlobalError: true },
  });
  const rows = q.data?.results ?? [];
  const count = q.data?.count ?? 0;
  return (
    <Panel bodyClassName="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.6fr)_repeat(4,minmax(0,1fr))]">
        <label className="relative block">
          <span className="sr-only">Search</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-4" aria-hidden />
          <input value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Search GR no., party, invoice, item or serial" className={cn(fieldClass, "pl-9")} />
        </label>
        <PlantSelect value={plant} onChange={setPlant} />
        <label className={labelClass}>
          <span className="sr-only">Type</span>
          <select value={type} onChange={(e) => setType(e.target.value as ReceiptType | "")} className={fieldClass}>
            <option value="">Goods and services</option>
            <option value="GOODS">Goods</option>
            <option value="SERVICE">Services</option>
          </select>
        </label>
        <label className={labelClass}>
          <span className="sr-only">Line type</span>
          <select value={category} onChange={(e) => setCategory(e.target.value as LineCategory | "")} className={fieldClass}>
            <option value="">Any line type</option>
            {Object.entries(LINE_CATEGORY_LABEL).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </select>
        </label>
        <label className={labelClass}>
          <span className="sr-only">Status</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as "" | "POSTED" | "REVERSED")} className={fieldClass}>
            <option value="">Posted and reversed</option>
            <option value="POSTED">Posted</option>
            <option value="REVERSED">Reversed</option>
          </select>
        </label>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:w-1/2">
        <label className={labelClass}>
          Received from
          <input type="date" value={dateFrom} max={dateTo || undefined} onChange={(e) => setDateFrom(e.target.value)} className={cn(fieldClass, "mt-1")} />
        </label>
        <label className={labelClass}>
          Received to
          <input type="date" value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} className={cn(fieldClass, "mt-1")} />
        </label>
      </div>
      {invalid ? <p role="alert" className="text-[12px] font-medium text-danger-fg">“From” must be on or before “To”.</p> : null}
      {q.isError ? <ErrorBanner error={q.error} onRetry={() => void q.refetch()} title="Could not load general receipts." /> : null}
      {q.isLoading ? (
        <ListSkeleton rows={4} height={72} />
      ) : rows.length ? (
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line">
          {rows.map((receipt) => <ReceiptRow key={receipt.id} receipt={receipt} />)}
        </ul>
      ) : !q.isError ? (
        <PanelEmpty icon={<ReceiptText />} title="No general receipts">
          {canCreate ? "Record one from a classified bill (spares, machinery or service), or start a new one here." : "Nothing recorded for these filters."}
        </PanelEmpty>
      ) : null}
      <Pager page={page} pages={Math.max(1, Math.ceil(count / PAGE_SIZE))} count={count} noun="receipt" onPage={setPage} />
    </Panel>
  );
}

function ReceiptRow({ receipt }: { receipt: GeneralReceipt }) {
  const preview = receipt.lines.slice(0, 2).map((l) => l.description).join(" · ");
  return (
    <li>
      <Link href={`/inventory/general-receipts/${receipt.id}`} className="flex min-h-[72px] items-center gap-3 px-3 py-3 hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-info-border sm:px-4">
        <span className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", receipt.receipt_type === "SERVICE" ? "bg-info-bg text-info-fg" : "bg-success-bg text-success-fg")}>
          {receipt.receipt_type === "SERVICE" ? <Wrench className="h-5 w-5" aria-hidden /> : <ReceiptText className="h-5 w-5" aria-hidden />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[13.5px] font-semibold text-content-1">{receipt.number}</span>
            <span className="truncate text-[13.5px] text-content-1">{receipt.vendor_name || receipt.party_name}</span>
            {receipt.status === "REVERSED" ? <TonePill tone="danger">Reversed</TonePill> : null}
          </span>
          <span className="block truncate text-[12.5px] text-content-3">
            {billDateTime(receipt.received_at)} · {receipt.plant_name} · {receipt.receipt_type_label}
            {receipt.invoice_number ? ` · Inv ${receipt.invoice_number}` : ""}
            {receipt.document ? ` · Bill ${receipt.document.ref}` : ""}
          </span>
          <span className="block truncate text-[12.5px] text-content-2">
            {preview}
            {receipt.line_count > 2 ? ` +${receipt.line_count - 2} more` : ""}
            {receipt.machines.length ? ` · ${receipt.machines.join(", ")}` : ""}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block text-[14px] font-semibold tabular-nums text-content-1">{inr(receipt.total_with_gst)}</span>
          <span className="block text-[11px] text-content-4">incl. GST</span>
        </span>
      </Link>
    </li>
  );
}

function MachineHistoryTab({ initialMachine }: { initialMachine: string }) {
  const [plant, setPlant] = useState("");
  const [machine, setMachine] = useState(initialMachine);
  const optionsQ = useQuery({
    queryKey: ["documents", "gr-options", plant ? [plant] : []],
    queryFn: () => generalReceiptsApi.options(plant ? [plant] : []),
    staleTime: 5 * 60_000,
    meta: { suppressGlobalError: true },
  });
  const historyQ = useQuery({
    queryKey: ["general-receipts", "machine-history", machine],
    queryFn: () => generalReceiptsApi.machineHistory(machine),
    enabled: Boolean(machine),
    meta: { suppressGlobalError: true },
  });
  const machines = optionsQ.data?.machines ?? [];
  const data = historyQ.data;
  return (
    <div className="space-y-4">
      <Panel bodyClassName="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div>
          <span className={labelClass}>Factory</span>
          <div className="mt-1"><PlantSelect value={plant} onChange={(value) => { setPlant(value); setMachine(""); }} /></div>
        </div>
        <label className={labelClass}>
          Machine
          <select value={machine} onChange={(e) => setMachine(e.target.value)} className={cn(fieldClass, "mt-1")} disabled={optionsQ.isLoading}>
            <option value="">{optionsQ.isLoading ? "Loading machines…" : "Choose a machine"}</option>
            {machines.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.code}) · {m.plant_name}</option>)}
          </select>
        </label>
      </Panel>
      {optionsQ.isError ? <ErrorBanner error={optionsQ.error} onRetry={() => void optionsQ.refetch()} title="Could not load machines." /> : null}
      {!machine ? (
        <PanelEmpty icon={<History />} title="Choose a machine">Every spare fitted, service visit and gate pass for that machine appears here, newest first — e.g. “last barrel seal for the Mamata machine: vendor, rate, date”.</PanelEmpty>
      ) : historyQ.isLoading ? (
        <ListSkeleton rows={3} height={64} />
      ) : historyQ.isError ? (
        <ErrorBanner error={historyQ.error} onRetry={() => void historyQ.refetch()} title="Could not load the machine history." />
      ) : data ? (
        <Panel title={`${data.machine.name} (${data.machine.code})`} description={`${data.machine.plant_name} · ${data.totals.lines} receipt line${data.totals.lines === 1 ? "" : "s"} (${data.totals.service_lines} service) · ${inr(data.totals.amount)} before GST`}>
          {data.events.length ? (
            <ol className="space-y-3">
              {data.events.map((event, i) => <MachineEventRow key={`${event.kind}-${i}`} event={event} />)}
            </ol>
          ) : (
            <PanelEmpty icon={<History />} title="Nothing recorded for this machine yet" />
          )}
        </Panel>
      ) : null}
    </div>
  );
}

function MachineEventRow({ event }: { event: MachineEvent }) {
  if (event.kind === "GENERAL_RECEIPT") {
    return (
      <li className="flex gap-3">
        <span className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", event.receipt_type === "SERVICE" ? "bg-info-bg text-info-fg" : "bg-success-bg text-success-fg")}>
          {event.receipt_type === "SERVICE" ? <Wrench className="h-4 w-4" aria-hidden /> : <ReceiptText className="h-4 w-4" aria-hidden />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className={cn("text-[13px] font-semibold", event.status === "REVERSED" ? "text-content-3 line-through" : "text-content-1")}>{event.description}</span>
            <span className="text-[13px] tabular-nums text-content-1">{inr(event.amount)}</span>
          </div>
          <div className="text-[12px] text-content-3">
            {billDate(event.at)} · {event.quantity} {event.uom}{event.rate ? ` × ${inr(event.rate)}` : ""} · {event.line_category_label ?? LINE_CATEGORY_LABEL[event.line_category]} · {event.disposition_label} · {event.party}
            {event.serial_no ? ` · S/N ${event.serial_no}` : ""} ·{" "}
            <Link href={`/inventory/general-receipts/${event.receipt_id}`} className="font-mono text-primary hover:underline">{event.number}</Link>
            {event.status === "REVERSED" ? " (reversed)" : ""}
          </div>
        </div>
      </li>
    );
  }
  const out = event.kind === "GATE_PASS_OUT";
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-warning-bg text-warning-fg">
        {out ? <ArrowUpRight className="h-4 w-4" aria-hidden /> : <ArrowDownLeft className="h-4 w-4" aria-hidden />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-content-1">{out ? "Left on gate pass" : "Came back on gate pass"}: {event.description}</div>
        <div className="text-[12px] text-content-3">
          {billDateTime(event.at)} · {event.quantity} {event.uom} · {event.party} ·{" "}
          <Link href={`/inventory/gate-passes/${event.gate_pass_id}`} className="font-mono text-primary hover:underline">{event.number}</Link>
          {out && event.expected_return_date ? ` · due back ${billDate(event.expected_return_date)}` : ""}
          {out ? ` · ${event.returned_quantity} back so far` : ""}
        </div>
      </div>
    </li>
  );
}

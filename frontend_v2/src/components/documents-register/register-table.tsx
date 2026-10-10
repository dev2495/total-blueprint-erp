"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Download, FileSearch, Loader2, Plus, Search, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";

import { Panel, PanelEmpty } from "@/components/premium";
import { cn } from "@/lib/utils";
import { gateErrorMessage } from "@/components/gate/use-gate-operation";
import { CATEGORY_META, gateBillsApi, VOID_CODE_LABEL, type BillQueueFilter, type DocumentCategory, type InwardBill, type RegisterFilters } from "@/services/gate-bills";
import { StagePill, SourceChip, billDate, billDateTime, billRef, inr, localIsoDate, saveBlob, useNowTick } from "@/components/inventory/gate-bills/bill-common";
import { DocumentRow, nextStepLabel } from "./document-row";
import { ErrorBanner, ListSkeleton, Pager, PlantSelect, VendorPicker, fieldClass, labelClass, useDebounced, type PartyValue } from "./shared";

const PAGE_SIZE = 25;

export type RegisterMode = "ALL" | "FILED" | "FOLLOWUP";

const STATUS_OPTIONS: Array<{ value: BillQueueFilter; label: string }> = [
  { value: "ALL", label: "Every status" },
  { value: "OPEN", label: "Open (waiting or partly received)" },
  { value: "NEEDS_CLASSIFYING", label: "Needs classifying" },
  { value: "WAITING_RECEIPT", label: "Waiting for receipt" },
  { value: "PARTIAL_GRN", label: "Partly received" },
  { value: "RECEIPTED", label: "Received" },
  { value: "FILED", label: "Filed" },
  { value: "VOID", label: "Voided" },
];

const ORDERING: Array<{ value: NonNullable<RegisterFilters["ordering"]>; label: string }> = [
  { value: "-arrival_at", label: "Newest arrival first" },
  { value: "arrival_at", label: "Oldest arrival first" },
  { value: "-invoice_date", label: "Newest bill date first" },
  { value: "-total_amount", label: "Largest amount first" },
];

const MODE_COPY: Record<RegisterMode, { title: string; description: string; empty: string }> = {
  ALL: { title: "All documents", description: "Every bill and document: gate photos and office uploads, at every stage.", empty: "No documents match these filters. Clear a filter or widen the dates." },
  FILED: { title: "Filed records", description: "Utility, fee, transport and other record-only paper, plus supporting papers attached to a bill.", empty: "Nothing filed for these filters yet." },
  FOLLOWUP: {
    title: "Non-stock follow-ups",
    description: "Bills voided as “non-stock” before the register existed. Record a General Receipt for what each one delivered; the original void stays in the history.",
    empty: "No old non-stock voids are waiting. Every one has a General Receipt.",
  },
};

export function RegisterTable({ mode }: { mode: RegisterMode }) {
  const now = useNowTick(30_000);
  const [status, setStatus] = useState<BillQueueFilter>("ALL");
  const [plant, setPlant] = useState("");
  const [category, setCategory] = useState("");
  const [source, setSource] = useState<"" | "GATE" | "OFFICE">("");
  const [party, setParty] = useState<PartyValue>({ vendorId: null, vendorName: "", partyName: "" });
  const [basis, setBasis] = useState<"arrival" | "invoice">("arrival");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [ordering, setOrdering] = useState<NonNullable<RegisterFilters["ordering"]>>("-arrival_at");
  const [searchText, setSearchText] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [exporting, setExporting] = useState(false);
  const search = useDebounced(searchText.trim(), 350);
  const [page, setPage] = useState(1);

  const filters: RegisterFilters = useMemo(
    () => ({
      status: mode === "FILED" ? "FILED" : mode === "FOLLOWUP" ? "NON_STOCK_FOLLOWUP" : status,
      plant,
      category: mode === "FOLLOWUP" ? undefined : category || undefined,
      source: source || undefined,
      vendor: party.vendorId || undefined,
      date_basis: basis,
      date_from: dateFrom || undefined,
      date_to: dateTo || undefined,
      search: search || undefined,
      ordering,
    }),
    [mode, status, plant, category, source, party.vendorId, basis, dateFrom, dateTo, search, ordering],
  );
  useEffect(() => setPage(1), [filters]);
  const datesInvalid = Boolean(dateFrom && dateTo && dateFrom > dateTo);

  const listQ = useQuery({
    queryKey: ["inventory", "gate-bills", "register", filters, page],
    queryFn: () => gateBillsApi.list({ ...filters, page, page_size: PAGE_SIZE }),
    placeholderData: keepPreviousData,
    enabled: !datesInvalid,
    meta: { suppressGlobalError: true },
  });

  const exportCsv = async () => {
    setExporting(true);
    try {
      const blob = await gateBillsApi.registerCsv(filters);
      saveBlob(blob, `documents-register-${localIsoDate()}.csv`);
    } catch (error) {
      toast.error(gateErrorMessage(error, "Could not export the register."));
    } finally {
      setExporting(false);
    }
  };

  const rows = listQ.data?.results ?? [];
  const count = listQ.data?.count ?? 0;
  const copy = MODE_COPY[mode];
  const activeFilters = [plant, category, source, party.vendorId, dateFrom, dateTo].filter(Boolean).length + (mode === "ALL" && status !== "ALL" ? 1 : 0);

  return (
    <Panel
      title={copy.title}
      description={copy.description}
      actions={
        mode !== "FOLLOWUP" ? (
          <button
            type="button"
            onClick={() => void exportCsv()}
            disabled={exporting || datesInvalid}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-line bg-surface-1 px-3 text-[13px] font-semibold text-content-1 hover:bg-surface-2 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border"
          >
            {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Export CSV
          </button>
        ) : null
      }
      bodyClassName="space-y-3"
    >
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="relative block flex-1">
          <span className="sr-only">Search</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-4" aria-hidden />
          <input value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Search invoice no., party, vendor or bill ref" className={cn(fieldClass, "pl-9")} />
        </label>
        <button
          type="button"
          aria-expanded={showFilters}
          onClick={() => setShowFilters((v) => !v)}
          className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-line bg-surface-1 px-4 text-[13px] font-semibold text-content-1 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border"
        >
          <SlidersHorizontal className="h-4 w-4" /> Filters{activeFilters ? ` (${activeFilters})` : ""}
        </button>
      </div>
      {showFilters ? (
        <div className="grid gap-3 rounded-2xl border border-line bg-surface-2/60 p-3 sm:grid-cols-2 lg:grid-cols-4">
          {mode === "ALL" ? (
            <label className={labelClass}>
              Status
              <select value={status} onChange={(e) => setStatus(e.target.value as BillQueueFilter)} className={cn(fieldClass, "mt-1")}>
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
          ) : null}
          {mode !== "FOLLOWUP" ? (
            <label className={labelClass}>
              Category
              <select value={category} onChange={(e) => setCategory(e.target.value)} className={cn(fieldClass, "mt-1")}>
                <option value="">Any category</option>
                <option value="NONE">Not classified</option>
                {Object.entries(CATEGORY_META).map(([code, meta]) => (
                  <option key={code} value={code}>{meta.label}</option>
                ))}
              </select>
            </label>
          ) : null}
          <label className={labelClass}>
            Source
            <select value={source} onChange={(e) => setSource(e.target.value as "" | "GATE" | "OFFICE")} className={cn(fieldClass, "mt-1")}>
              <option value="">Gate and office</option>
              <option value="GATE">Gate photo</option>
              <option value="OFFICE">Office upload</option>
            </select>
          </label>
          <div>
            <span className={labelClass}>Factory</span>
            <div className="mt-1">
              <PlantSelect value={plant} onChange={setPlant} />
            </div>
          </div>
          <div className="sm:col-span-2">
            <VendorPicker value={party} onChange={setParty} label="Vendor" allowParty={false} />
          </div>
          <label className={labelClass}>
            Dates by
            <select value={basis} onChange={(e) => setBasis(e.target.value as "arrival" | "invoice")} className={cn(fieldClass, "mt-1")}>
              <option value="arrival">Arrival / upload date</option>
              <option value="invoice">Bill date</option>
            </select>
          </label>
          <label className={labelClass}>
            Order
            <select value={ordering} onChange={(e) => setOrdering(e.target.value as NonNullable<RegisterFilters["ordering"]>)} className={cn(fieldClass, "mt-1")}>
              {ORDERING.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            From
            <input type="date" value={dateFrom} max={dateTo || undefined} onChange={(e) => setDateFrom(e.target.value)} className={cn(fieldClass, "mt-1")} />
          </label>
          <label className={labelClass}>
            To
            <input type="date" value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} className={cn(fieldClass, "mt-1")} />
          </label>
          {datesInvalid ? <p role="alert" className="text-[12px] font-medium text-danger-fg sm:col-span-2">“From” must be on or before “To”.</p> : null}
          {activeFilters ? (
            <button
              type="button"
              onClick={() => {
                setStatus("ALL");
                setPlant("");
                setCategory("");
                setSource("");
                setParty({ vendorId: null, vendorName: "", partyName: "" });
                setDateFrom("");
                setDateTo("");
              }}
              className="min-h-[44px] self-end rounded-xl px-3 text-left text-[13px] font-semibold text-primary hover:underline sm:col-span-2 lg:col-span-1"
            >
              Clear filters
            </button>
          ) : null}
        </div>
      ) : null}

      {listQ.isError ? <ErrorBanner error={listQ.error} onRetry={() => void listQ.refetch()} title="Could not load the register." /> : null}
      {listQ.isPlaceholderData ? <p role="status" className="text-[12.5px] text-content-3">Updating… the previous results stay visible until the new list loads.</p> : null}
      {listQ.isLoading ? (
        <ListSkeleton />
      ) : rows.length ? (
        <>
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line lg:hidden" aria-label={copy.title}>
            {rows.map((bill) => (
              <DocumentRow key={bill.id} bill={bill} now={now} />
            ))}
          </ul>
          <div className="hidden overflow-x-auto rounded-2xl border border-line lg:block">
            <table className="w-full min-w-[980px] text-left text-[13px]">
              <thead className="bg-surface-2 text-[11.5px] uppercase tracking-[0.06em] text-content-3">
                <tr>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Ref</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Party</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Bill no. · date</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">Total</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Category</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Factory</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Arrived</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Stage</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">{mode === "FOLLOWUP" ? "Action" : "Next"}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((bill) => (
                  <RegisterRow key={bill.id} bill={bill} mode={mode} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : !listQ.isError ? (
        <PanelEmpty icon={<FileSearch />} title="No documents">
          {copy.empty}
        </PanelEmpty>
      ) : null}
      <Pager page={page} pages={Math.max(1, Math.ceil(count / PAGE_SIZE))} count={count} noun="document" onPage={setPage} />
    </Panel>
  );
}

function RegisterRow({ bill, mode }: { bill: InwardBill; mode: RegisterMode }) {
  const href = `/inventory/gate-bills/${bill.id}`;
  return (
    <tr className="hover:bg-surface-2">
      <td className="px-3 py-2.5">
        <Link href={href} className="font-mono font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border">
          {billRef(bill.id)}
        </Link>
        <div className="mt-0.5"><SourceChip source={bill.source} /></div>
      </td>
      <td className="max-w-[220px] px-3 py-2.5">
        <div className="truncate font-medium text-content-1">{bill.party_display || bill.review_data?.vendor_name || "—"}</div>
        {bill.attached_to ? <div className="truncate text-[12px] text-content-3">Attached to {bill.attached_to.ref}</div> : null}
      </td>
      <td className="px-3 py-2.5">
        <div className="font-mono text-content-1">{bill.invoice_number || "—"}</div>
        <div className="text-[12px] text-content-3">{billDate(bill.invoice_date)}</div>
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-content-1">{inr(bill.total_amount)}</td>
      <td className="px-3 py-2.5 text-content-2">{bill.category ? CATEGORY_META[bill.category as DocumentCategory]?.label : <span className="text-content-4">Not classified</span>}</td>
      <td className="px-3 py-2.5 text-content-2">{bill.plant_name}{bill.ship_to_plant_name ? <div className="text-[12px] text-content-3">→ {bill.ship_to_plant_name}</div> : null}</td>
      <td className="px-3 py-2.5 text-content-2">{billDateTime(bill.arrival_at)}</td>
      <td className="px-3 py-2.5">
        <StagePill bill={bill} />
        {bill.status === "VOID" && bill.resolution_code ? <div className="mt-0.5 text-[11.5px] text-content-3">{VOID_CODE_LABEL[bill.resolution_code] ?? bill.resolution_code}</div> : null}
      </td>
      <td className="px-3 py-2.5">
        {mode === "FOLLOWUP" && bill.allowed_actions?.includes("followup") ? (
          <Link href={`/inventory/general-receipts/new?followup=${bill.id}`} className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg bg-primary px-3 text-[12.5px] font-semibold text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border">
            <Plus className="h-3.5 w-3.5" /> General receipt
          </Link>
        ) : (
          <Link href={href} className="text-[12.5px] font-semibold text-primary hover:underline">{nextStepLabel(bill)}</Link>
        )}
      </td>
    </tr>
  );
}

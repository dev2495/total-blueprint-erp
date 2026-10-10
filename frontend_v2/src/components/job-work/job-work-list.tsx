"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, ClipboardList, Factory, FileText, Search, Truck } from "lucide-react";

import { PageHero, Panel, PanelEmpty } from "@/components/premium";
import { cn } from "@/lib/utils";
import { factoryService } from "@/services/factory";
import { gateBillsApi } from "@/services/gate-bills";
import { inventoryService } from "@/services/inventory";
import { jobWorkApi, type JobWorkOrderRow, type JobWorkTab } from "@/services/job-work";

import { Chip, ErrorBanner, fmtDate, fmtKg, inputClass, JobWorkAccessDenied, JobWorkStatusPill, jobWorkError, Notice, useJobWorkAccess } from "./job-work-common";
import { CreateOrderDialog } from "./create-order-dialog";
import { JobWorkReports } from "./job-work-reports";
import { LegacyReconcile } from "./legacy-reconcile";

type ViewTab = JobWorkTab | "REPORTS" | "LEGACY";
const PAGE_SIZE = 25;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIST_TABS: Array<{ key: JobWorkTab; label: string; hint: string }> = [
  { key: "OPEN", label: "Open", hint: "Drafts, orders at the job worker and orders waiting to close" },
  { key: "AT_VENDOR", label: "At vendor", hint: "Material is still with the job worker" },
  { key: "OVERDUE", label: "Overdue", hint: "Past the expected return date, or material held 300+ days (ITC-04)" },
  { key: "CLOSED", label: "Closed", hint: "Closed, short-closed and cancelled orders" },
];

function useDebounced<T>(value: T, delay = 350) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), delay);
    return () => window.clearTimeout(t);
  }, [value, delay]);
  return v;
}

export function JobWorkList() {
  const access = useJobWorkAccess();
  const params = useSearchParams();
  const router = useRouter();
  const billParam = params?.get("bill") ?? "";
  const billId = UUID.test(billParam) ? billParam : "";
  const initialTab = (params?.get("tab") || "OPEN").toUpperCase() as ViewTab;
  const [tab, setTab] = useState<ViewTab>(["OPEN", "AT_VENDOR", "OVERDUE", "CLOSED", "REPORTS", "LEGACY"].includes(initialTab) ? initialTab : "OPEN");
  const [plant, setPlant] = useState(params?.get("plant") || "");
  const [vendor, setVendor] = useState(params?.get("vendor") && !billId ? params.get("vendor")! : "");
  const [searchText, setSearchText] = useState("");
  const search = useDebounced(searchText.trim());
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [tab, plant, vendor, search]);

  const listTab = LIST_TABS.some((t) => t.key === tab) ? (tab as JobWorkTab) : null;
  const listQ = useQuery({
    queryKey: ["jobwork", "list", listTab, plant, vendor, search, page],
    queryFn: () => jobWorkApi.list({ tab: listTab || "OPEN", plant, vendor, search, page, page_size: PAGE_SIZE }),
    enabled: access.canView && Boolean(listTab) && !billId,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: true,
    meta: { suppressGlobalError: true },
  });
  const plantsQ = useQuery({ queryKey: ["factory-plants"], queryFn: factoryService.getPlants, enabled: access.canView, staleTime: 5 * 60_000, meta: { suppressGlobalError: true } });
  const vendorsQ = useQuery({ queryKey: ["vendors"], queryFn: inventoryService.getVendors, enabled: access.canView, staleTime: 5 * 60_000, meta: { suppressGlobalError: true } });
  const jobVendors = useMemo(() => (vendorsQ.data || []).filter((v) => ["JOBWORK", "BOTH"].includes(String(v.type).toUpperCase())), [vendorsQ.data]);

  if (access.loading) return <div className="h-40 animate-pulse rounded-3xl bg-surface-2" />;
  if (!access.canView) return <JobWorkAccessDenied />;
  if (billId) return <BillOrderPicker billId={billId} vendorParam={params?.get("vendor") || ""} onExit={() => router.replace("/inventory/job-work")} />;

  const rows = listQ.data?.results ?? [];
  const count = listQ.data?.count ?? 0;
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const counts = listQ.data?.tab_counts;
  const tabs: Array<{ key: ViewTab; label: string; hint: string; count?: number }> = [
    ...LIST_TABS.map((t) => ({ ...t, count: counts?.[t.key] })),
    { key: "REPORTS", label: "Reports", hint: "Material at job workers by age, and yield / wastage by job worker" },
    ...(access.isOwner ? [{ key: "LEGACY" as ViewTab, label: "Before upgrade", hint: "Owner: settle rolls the old job-work screen left at the job worker" }] : []),
  ];

  return (
    <div className="mx-auto max-w-[1400px] space-y-4" data-testid="jobwork-page">
      <PageHero
        eyebrow="Inventory · outside processing"
        icon={<Truck />}
        title="Job work"
        description="Send rolls to job workers on a printed challan, receive pieces, rolls, balance material and wastage back, link the job worker's bill and close the order. Material at a job worker is tracked until every sent roll is settled."
        actions={access.canManage ? <CreateOrderDialog defaultPlant={plant || undefined} triggerClassName="min-h-[44px]" /> : null}
        compact
      />

      <div className="flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Job-work views">
        {tabs.map((t, i) => {
          const active = t.key === tab;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              title={t.hint}
              onClick={() => setTab(t.key)}
              onKeyDown={(event) => {
                const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
                if (!delta) return;
                event.preventDefault();
                const next = (i + delta + tabs.length) % tabs.length;
                setTab(tabs[next].key);
                (event.currentTarget.parentElement?.children[next] as HTMLButtonElement | undefined)?.focus();
              }}
              className={cn(
                "inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-full border px-4 text-[13px] font-semibold transition-colors",
                active ? "border-transparent bg-content-1 text-surface-1" : "border-line bg-surface-1 text-content-2 hover:bg-surface-2",
              )}
            >
              {t.label}
              {t.count !== undefined ? <span className={cn("rounded-full px-2 py-0.5 text-[11px] tabular-nums", active ? "bg-white/15" : "bg-surface-2")}>{t.count}</span> : null}
            </button>
          );
        })}
      </div>

      {tab === "LEGACY" ? (
        <LegacyReconcile plant={plant} />
      ) : tab === "REPORTS" ? (
        <JobWorkReports plant={plant} vendor={vendor} plants={plantsQ.data || []} vendors={jobVendors} onPlant={setPlant} onVendor={setVendor} />
      ) : (
        <Panel bodyClassName="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <label className="relative block">
              <span className="sr-only">Search orders</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-4" />
              <input value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Search JWO, challan, return, job no. or vendor" className={cn(inputClass, "pl-9")} />
            </label>
            <label className="block">
              <span className="sr-only">Plant</span>
              <select value={plant} onChange={(e) => setPlant(e.target.value)} className={inputClass}>
                <option value="">All plants</option>
                {(plantsQ.data || []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="sr-only">Job worker</span>
              <select value={vendor} onChange={(e) => setVendor(e.target.value)} className={inputClass}>
                <option value="">All job workers</option>
                {jobVendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {listQ.isPlaceholderData ? <p role="status" className="text-sm text-content-3">Updating… the previous results stay visible until the list loads.</p> : null}
          {listQ.isError ? <ErrorBanner message={jobWorkError(listQ.error, "Job-work orders could not load.")} onRetry={() => void listQ.refetch()} /> : null}
          {listQ.isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-[76px] animate-pulse rounded-2xl bg-surface-2" />
              ))}
            </div>
          ) : rows.length ? (
            <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line" aria-label="Job-work orders">
              {rows.map((row) => (
                <OrderRow key={row.id} row={row} />
              ))}
            </ul>
          ) : !listQ.isError ? (
            <PanelEmpty icon={<ClipboardList />} title={search || plant || vendor ? "No orders match these filters" : tab === "OVERDUE" ? "Nothing is overdue" : tab === "AT_VENDOR" ? "No material is at a job worker" : "No job-work orders yet"}>
              {tab === "OPEN" && access.canManage && !search ? "Create an order, then send rolls on a printed challan." : "Try another view, plant or job worker."}
            </PanelEmpty>
          ) : null}
          <div className="flex items-center justify-between gap-3 text-[13px] text-content-3">
            <span className="tabular-nums">
              {count.toLocaleString("en-IN")} order{count === 1 ? "" : "s"}
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
      )}
    </div>
  );
}

function OrderRow({ row, href }: { row: JobWorkOrderRow; href?: string }) {
  return (
    <li>
      <Link
        href={href || `/inventory/job-work/${row.id}`}
        className="flex min-h-[76px] items-center gap-3 px-3 py-3 transition-colors hover:bg-surface-2 focus-visible:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border sm:px-4"
      >
        <span className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-content-3 sm:flex">
          <Factory className="h-5 w-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[13.5px] font-semibold text-content-1">{row.number}</span>
            <JobWorkStatusPill status={row.status} />
            {row.overdue ? <Chip tone="bad">Overdue</Chip> : null}
            {row.itc04_alert ? <Chip tone="warn" title="Material at the job worker for 300+ days; GST allows one year">ITC-04</Chip> : null}
            {row.mode === "EMERGENCY" ? <Chip tone="info">Emergency</Chip> : null}
            {row.is_legacy ? <Chip>Before upgrade</Chip> : null}
          </div>
          <div className="mt-0.5 truncate text-[12.5px] text-content-2">
            {row.vendor_name} · {row.plant_name}
            {row.production_job_number ? ` · ${row.production_job_number}` : ""}
            {row.process_name ? ` · ${row.process_name}` : ""}
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-3 text-[12px] text-content-3">
            <span>Expects {row.expected_output_label.toLowerCase()}{row.expected_qty ? ` · ${row.expected_qty} ${row.expected_uom}` : ""}</span>
            {row.expected_return_date ? <span>Back by {fmtDate(row.expected_return_date)}</span> : null}
            {row.rate ? <span>₹{row.rate}/{row.rate_uom}</span> : null}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[15px] font-semibold tabular-nums text-content-1">{row.open_lines ? fmtKg(row.at_vendor_kg) : "—"}</div>
          <div className="text-[11px] text-content-4">{row.open_lines ? `at vendor${row.oldest_open_days !== null ? ` · ${row.oldest_open_days}d` : ""}` : row.status === "DRAFT" ? "not sent" : "none at vendor"}</div>
        </div>
        <ChevronRight className="hidden h-5 w-5 shrink-0 text-content-4 sm:block" aria-hidden />
      </Link>
    </li>
  );
}

/** Bill mode (from Bills & documents → Job work): pick the order a job worker's bill belongs to. */
function BillOrderPicker({ billId, vendorParam, onExit }: { billId: string; vendorParam: string; onExit: () => void }) {
  const access = useJobWorkAccess();
  const billQ = useQuery({ queryKey: ["inventory", "gate-bills", "detail", billId], queryFn: () => gateBillsApi.get(billId), enabled: access.canLinkBill, retry: false, meta: { suppressGlobalError: true } });
  const header = billQ.data as (typeof billQ.data & { vendor?: string | null; vendor_name?: string | null; invoice_number?: string | null }) | undefined;
  const vendorId = (UUID.test(vendorParam) ? vendorParam : "") || header?.vendor || String(header?.review_data?.vendor_id || "");
  const ordersQ = useQuery({
    queryKey: ["jobwork", "open-orders", vendorId, billId],
    queryFn: () => jobWorkApi.openOrders({ vendor: vendorId || undefined, bill: billId }),
    enabled: access.canLinkBill && Boolean(vendorId),
    meta: { suppressGlobalError: true },
  });
  const vendorName = header?.vendor_name || header?.review_data?.vendor_name || ordersQ.data?.[0]?.vendor_name || "";
  const invoice = header?.invoice_number || header?.review_data?.invoice_number || "";

  return (
    <div className="mx-auto max-w-[1100px] space-y-4" data-testid="jobwork-bill-picker">
      <PageHero
        eyebrow="Bills & documents · job work"
        icon={<FileText />}
        title="Pick the order this bill belongs to"
        description="A job worker's bill is linked to the return it charges for. Choose the job-work order, then record what came back with the bill beside the form."
        actions={
          <button type="button" onClick={onExit} className="inline-flex min-h-[44px] items-center rounded-xl bg-white/10 px-4 text-[13px] font-semibold text-white hover:bg-white/15">
            All job work
          </button>
        }
        compact
      />
      {!access.canLinkBill ? (
        <Notice tone="bad" title="Bill linking needs bill-receiving rights">Inventory store staff and administrators link bills. You can still open orders from the job-work list.</Notice>
      ) : billQ.isError ? (
        <ErrorBanner message={jobWorkError(billQ.error, "The bill could not load.")} onRetry={() => void billQ.refetch()} />
      ) : (
        <Panel
          title={billQ.isLoading ? "Loading bill…" : `Bill ${billId.slice(0, 8).toUpperCase()}${vendorName ? ` · ${vendorName}` : ""}`}
          description={invoice ? `Invoice ${invoice}` : "Invoice number not entered yet"}
          bodyClassName="space-y-3"
        >
          {!vendorId && !billQ.isLoading ? (
            <Notice tone="warn" title="The bill has no vendor yet">Classify the bill (vendor and invoice number) in Bills &amp; documents first, so its open job-work orders can be listed.</Notice>
          ) : null}
          {ordersQ.isError ? <ErrorBanner message={jobWorkError(ordersQ.error, "Open orders could not load.")} onRetry={() => void ordersQ.refetch()} /> : null}
          {ordersQ.isLoading ? (
            <div className="h-24 animate-pulse rounded-2xl bg-surface-2" />
          ) : ordersQ.data && ordersQ.data.length ? (
            <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line" aria-label="Open orders for this job worker">
              {ordersQ.data.map((row) => (
                <OrderRow key={row.id} row={row} href={`/inventory/job-work/${row.id}?bill=${billId}`} />
              ))}
            </ul>
          ) : vendorId && !ordersQ.isError ? (
            <PanelEmpty icon={<ClipboardList />} title="No open orders for this job worker">
              Material must have been sent on a job-work order before its return can be booked. Check the vendor on the bill, or create the order first.
            </PanelEmpty>
          ) : null}
        </Panel>
      )}
    </div>
  );
}

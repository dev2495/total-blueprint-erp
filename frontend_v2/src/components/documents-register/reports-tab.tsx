"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Database, HardDrive } from "lucide-react";

import { CompositionBar, Panel, PanelEmpty, RankedBars, StatCard, StatGrid } from "@/components/premium";
import { cn } from "@/lib/utils";
import { CATEGORY_META, gateBillsApi, type DocumentCategory, type StorageReport } from "@/services/gate-bills";
import { LINE_CATEGORY_LABEL, type LineCategory } from "@/services/general-receipts";
import { inr, localIsoDate } from "@/components/inventory/gate-bills/bill-common";
import { ErrorBanner, PlantSelect, fieldClass, labelClass } from "./shared";

const AGE_LABEL: Record<string, string> = { le_1d: "Up to 1 day", d2_3: "2–3 days", d4_7: "4–7 days", gt_7d: "More than 7 days" };

function monthStart() {
  const now = new Date();
  return localIsoDate(new Date(now.getFullYear(), now.getMonth(), 1));
}

const num = (value: string | null | undefined) => (value ? Number(value) : 0);

export function ReportsTab({ showStorage }: { showStorage: boolean }) {
  const [plant, setPlant] = useState("");
  const [dateFrom, setDateFrom] = useState(monthStart);
  const [dateTo, setDateTo] = useState(() => localIsoDate());
  const [basis, setBasis] = useState<"arrival" | "invoice">("arrival");
  const invalid = !dateFrom || !dateTo || dateFrom > dateTo;
  const q = useQuery({
    queryKey: ["documents", "report-summary", plant, dateFrom, dateTo, basis],
    queryFn: () => gateBillsApi.reportSummary({ plant, date_from: dateFrom, date_to: dateTo, date_basis: basis }),
    enabled: !invalid,
    meta: { suppressGlobalError: true },
  });
  const data = q.data;
  const statusParts = useMemo(
    () =>
      data
        ? [
            { label: "Waiting", value: data.by_status.PENDING_GRN ?? 0 },
            { label: "Partly received", value: data.by_status.PARTIAL_GRN ?? 0 },
            { label: "Received", value: data.by_status.RECEIPTED ?? 0 },
            { label: "Filed", value: data.by_status.FILED ?? 0 },
            { label: "Voided", value: data.by_status.VOID ?? 0 },
          ]
        : [],
    [data],
  );

  return (
    <div className="space-y-4">
      <Panel bodyClassName="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <span className={labelClass}>Factory</span>
          <div className="mt-1"><PlantSelect value={plant} onChange={setPlant} /></div>
        </div>
        <label className={labelClass}>
          Dates by
          <select value={basis} onChange={(e) => setBasis(e.target.value as "arrival" | "invoice")} className={cn(fieldClass, "mt-1")}>
            <option value="arrival">Arrival / upload date</option>
            <option value="invoice">Bill date</option>
          </select>
        </label>
        <label className={labelClass}>
          From
          <input type="date" value={dateFrom} max={dateTo} onChange={(e) => setDateFrom(e.target.value)} className={cn(fieldClass, "mt-1")} />
        </label>
        <label className={labelClass}>
          To
          <input type="date" value={dateTo} min={dateFrom} onChange={(e) => setDateTo(e.target.value)} className={cn(fieldClass, "mt-1")} />
        </label>
        {invalid ? <p role="alert" className="text-[12px] font-medium text-danger-fg sm:col-span-2">Choose a “From” date on or before “To” (up to 366 days).</p> : null}
      </Panel>

      {q.isError ? <ErrorBanner error={q.error} onRetry={() => void q.refetch()} title="Could not load the report." /> : null}
      <StatGrid columns={4}>
        <StatCard label="Documents in period" value={data?.documents ?? 0} loading={q.isLoading} hint={data ? `${data.by_source.GATE ?? 0} gate · ${data.by_source.OFFICE ?? 0} office` : undefined} />
        <StatCard label="Open now" value={data?.open_total ?? 0} loading={q.isLoading} tone={data && data.open_total ? "warn" : undefined} hint={data ? `${data.needs_classifying} need classifying` : undefined} />
        <StatCard label="Filed in period" value={data?.filed_count ?? 0} loading={q.isLoading} />
        <StatCard label="Possible duplicates" value={data?.duplicates_flagged ?? 0} loading={q.isLoading} tone={data && data.duplicates_flagged ? "bad" : undefined} hint="Same vendor + bill no. + financial year" />
      </StatGrid>

      {data ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Where documents stand" description="Documents in the period by status.">
            <CompositionBar parts={statusParts} valueFormat={(v) => String(v)} />
          </Panel>
          <Panel title="Open documents by age" description="All open documents now, whatever their date (selected factory only).">
            <RankedBars items={data.open_ageing.map((row) => ({ key: row.bucket, label: AGE_LABEL[row.bucket], value: row.count }))} valueFormat={(v) => String(v)} />
          </Panel>
          <Panel title="Bill amounts by category" description="Each bill counted once; voided bills excluded.">
            {data.by_category.length ? (
              <RankedBars
                items={data.by_category.map((row) => ({
                  key: row.category || "NONE",
                  label: row.category ? CATEGORY_META[row.category as DocumentCategory]?.label ?? row.label : "Not classified",
                  value: num(row.total_amount),
                  sub: `${row.count} document${row.count === 1 ? "" : "s"}${row.without_amount ? ` · ${row.without_amount} without amount` : ""}`,
                }))}
                valueFormat={(v) => inr(v, true)}
                limit={10}
              />
            ) : (
              <PanelEmpty icon={<BarChart3 />} title="No documents in this period" />
            )}
          </Panel>
          <Panel title="Top vendors by bill total" description="Typed bill totals, voided bills excluded.">
            {data.top_vendors.length ? (
              <RankedBars items={data.top_vendors.map((row, i) => ({ key: `${row.vendor ?? row.name}-${i}`, label: row.name, value: num(row.total_amount), sub: `${row.count} bill${row.count === 1 ? "" : "s"}` }))} valueFormat={(v) => inr(v, true)} limit={10} />
            ) : (
              <PanelEmpty icon={<BarChart3 />} title="No bill totals entered yet" />
            )}
          </Panel>
          <Panel title="General receipt spend by line type" description={`${data.general_receipts.count} receipts · ${inr(data.general_receipts.amount, true)} before GST`}>
            {data.general_receipts.by_line_category.length ? (
              <RankedBars items={data.general_receipts.by_line_category.map((row) => ({ key: row.line_category, label: LINE_CATEGORY_LABEL[row.line_category as LineCategory] ?? row.line_category, value: num(row.amount), sub: `${row.count} line${row.count === 1 ? "" : "s"}` }))} valueFormat={(v) => inr(v, true)} />
            ) : (
              <PanelEmpty icon={<BarChart3 />} title="No general receipts in this period" />
            )}
          </Panel>
          <Panel title="Top 10 machines by spend" description="Spares and services recorded against a machine.">
            {data.general_receipts.by_machine.length ? (
              <RankedBars items={data.general_receipts.by_machine.map((row) => ({ key: row.machine, label: `${row.name} (${row.code}) · ${row.plant_name}`, value: num(row.amount), sub: `${row.count} line${row.count === 1 ? "" : "s"}` }))} valueFormat={(v) => inr(v, true)} limit={10} />
            ) : (
              <PanelEmpty icon={<BarChart3 />} title="No machine-linked lines yet" />
            )}
          </Panel>
          <p className="text-[12px] text-content-4 lg:col-span-2">{data.amount_note}</p>
        </div>
      ) : null}
      {showStorage ? <StorageCard /> : null}
    </div>
  );
}

function gb(bytes: number | null | undefined) {
  if (bytes === null || bytes === undefined) return "—";
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

const STORAGE_STATUS: Record<StorageReport["status"], { label: string; tone: string; body: string }> = {
  OK: { label: "Healthy", tone: "border-success-border bg-success-bg text-success-fg", body: "Bill images fit comfortably. Nothing to do." },
  PLAN_AHEAD: { label: "Plan ahead", tone: "border-warning-border bg-warning-bg text-warning-fg", body: "At the current pace a storage threshold is less than 90 days away. Plan more disk or moving images out of the database." },
  ACTION_NEEDED: { label: "Action needed", tone: "border-danger-border bg-danger-bg text-danger-fg", body: "A storage threshold is already crossed. Add disk space or move images now so backups keep running." },
};

/** Owner/Admin: how much of the database bill images use and how fast it grows. */
function StorageCard() {
  const q = useQuery({ queryKey: ["documents", "storage"], queryFn: gateBillsApi.storage, staleTime: 5 * 60_000, meta: { suppressGlobalError: true } });
  const data = q.data;
  const status = data ? STORAGE_STATUS[data.status] : null;
  return (
    <Panel title="Document storage" description="Owner / admin only. Bill and document images are kept inside the PostgreSQL database and every backup." icon={<Database />}>
      {q.isLoading ? <div className="h-24 animate-pulse rounded-xl bg-surface-2" /> : null}
      {q.isError ? <ErrorBanner error={q.error} onRetry={() => void q.refetch()} title="Could not measure storage." /> : null}
      {data && status ? (
        <div className="space-y-3">
          <div className={cn("rounded-xl border px-3 py-2.5 text-[13px]", status.tone)}>
            <b>{status.label}.</b> {status.body}
            {data.warnings.length ? <ul className="mt-1 list-disc pl-5">{data.warnings.map((w) => <li key={w}>{w}</li>)}</ul> : null}
          </div>
          <dl className="grid gap-3 text-[13px] sm:grid-cols-2 lg:grid-cols-4">
            <div><dt className="text-content-3">Database size</dt><dd className="text-[18px] font-semibold tabular-nums text-content-1">{gb(data.database_bytes)}</dd></div>
            <div><dt className="text-content-3">Document images share</dt><dd className="text-[18px] font-semibold tabular-nums text-content-1">{gb(data.document_bytes)}{data.document_share_pct !== null ? ` · ${data.document_share_pct}%` : ""}</dd></div>
            <div><dt className="text-content-3">Growth, last 30 days</dt><dd className="text-[18px] font-semibold tabular-nums text-content-1">{gb(data.growth_30d_bytes)}</dd><dd className="text-[12px] text-content-4">≈ {gb(data.projected_daily_bytes)} per day</dd></div>
            <div>
              <dt className="text-content-3">Days to threshold</dt>
              <dd className="text-[18px] font-semibold tabular-nums text-content-1">{data.days_to_database_threshold ?? "—"} <span className="text-[12px] font-normal text-content-3">database</span></dd>
              <dd className="text-[12px] text-content-3"><HardDrive className="mr-1 inline h-3.5 w-3.5" aria-hidden />{data.days_to_disk_threshold ?? "—"} days to disk limit</dd>
            </div>
          </dl>
          <p className="text-[12px] leading-relaxed text-content-4">
            Thresholds: database {gb(data.thresholds.database_warn_bytes)}; disk free below {data.thresholds.disk_free_warn_pct}%. Pages {data.page_counts.inward_pages.toLocaleString("en-IN")} inward ·{" "}
            {data.page_counts.outward_pages.toLocaleString("en-IN")} outward · {data.page_counts.original_files.toLocaleString("en-IN")} original PDFs. “—” means growth is too small to project.
          </p>
        </div>
      ) : null}
    </Panel>
  );
}

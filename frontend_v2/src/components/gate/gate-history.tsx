"use client";

import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, FileCheck2, FileWarning, History, Link2, PencilLine, Search, ShieldCheck, Users } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  gateApi,
  type GateDirection,
  type GateGoodsMovement,
  type GateMatchCandidate,
  type GateVisitor,
  type VisitorStatus,
} from "@/services/gate";
import { useGate } from "./gate-shell";
import {
  DIRECTION_META,
  gateAmount,
  gateDay,
  gateDayTime,
  gateElapsed,
  gateQty,
  isoDaysAgo,
  normalizeInvoice,
  normalizeVehicle,
  reconMeta,
  RECON_META,
  todayIso,
  VISITOR_STATUS_META,
} from "./gate-format";
import { DirectionBadge, EmptyState, FieldError, FieldLabel, GateAction, GateSheet, OperationBanner, PlateChip, TonePill } from "./gate-ui";
import { RegisterLedger } from "./register-ledger";
import { useVisitorSelfie } from "./visitor-cards";
import { gateFieldErrors, useGateOperation } from "./use-gate-operation";

const PAGE_SIZE = 50;

function useDebounced<T>(value: T, delay = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), delay);
    return () => window.clearTimeout(t);
  }, [value, delay]);
  return v;
}

type ReconFilter = "" | "MATCHED" | "UNMATCHED" | "DISCREPANCY";

export function GateHistory() {
  const { plants } = useGate();
  const [tab, setTab] = useState<"goods" | "visitors">("goods");
  const [plant, setPlant] = useState("");
  const [dateFrom, setDateFrom] = useState(isoDaysAgo(6));
  const [dateTo, setDateTo] = useState(todayIso());
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounced(search.trim());

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 px-1 pt-1">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-content-4">Admin · Owner</div>
          <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-content-1">Gate history</h1>
          <p className="text-[14px] text-content-3">Every gate movement and visit, checked against ERP documents. Corrections are append-only.</p>
        </div>
        <div className="grid grid-cols-2 gap-1 rounded-2xl bg-surface-1 p-1 shadow-[var(--gate-shadow)]" role="tablist">
          {(
            [
              { key: "goods", label: "Goods", icon: <FileCheck2 className="h-4 w-4" /> },
              { key: "visitors", label: "Visitors", icon: <Users className="h-4 w-4" /> },
            ] as const
          ).map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={tab === item.key}
              onClick={() => setTab(item.key)}
              className={cn(
                "gate-press flex min-h-[44px] items-center justify-center gap-2 rounded-xl px-4 text-[14px] font-semibold",
                tab === item.key ? "bg-surface-2 text-content-1" : "text-content-3",
              )}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="gate-card grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.6fr)_repeat(3,minmax(0,1fr))]">
        <label className="relative block">
          <span className="sr-only">Search</span>
          <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-content-4" />
          <input
            className="gate-field !pl-12"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tab === "goods" ? "Invoice, vehicle, party, product" : "Name, mobile, company"}
            aria-label="Search history"
          />
        </label>
        <label className="block">
          <span className="sr-only">Plant</span>
          <select className="gate-field" value={plant} onChange={(e) => setPlant(e.target.value)} aria-label="Plant">
            <option value="">All plants</option>
            {plants.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="sr-only">From date</span>
          <input type="date" className="gate-field gate-num" value={dateFrom} max={dateTo} onChange={(e) => setDateFrom(e.target.value)} aria-label="From date" />
        </label>
        <label className="block">
          <span className="sr-only">To date</span>
          <input type="date" className="gate-field gate-num" value={dateTo} min={dateFrom} max={todayIso()} onChange={(e) => setDateTo(e.target.value)} aria-label="To date" />
        </label>
      </div>

      {tab === "goods" ? (
        <GoodsHistory plant={plant} dateFrom={dateFrom} dateTo={dateTo} search={debouncedSearch} />
      ) : (
        <VisitorHistory plant={plant} dateFrom={dateFrom} dateTo={dateTo} search={debouncedSearch} />
      )}
    </div>
  );
}

function GoodsHistory({ plant, dateFrom, dateTo, search }: { plant: string; dateFrom: string; dateTo: string; search: string }) {
  const [direction, setDirection] = useState<"" | GateDirection>("");
  const [recon, setRecon] = useState<ReconFilter>("");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => setPage(1), [plant, dateFrom, dateTo, search, direction, recon]);

  const query = useQuery({
    queryKey: ["gate", "goods", "history", { plant, dateFrom, dateTo, search, direction, recon, page }],
    queryFn: () =>
      gateApi.listGoods({
        plant,
        date_from: dateFrom,
        date_to: dateTo,
        search,
        direction,
        reconciliation_status: recon,
        page,
        page_size: PAGE_SIZE,
      }),
    placeholderData: keepPreviousData,
    meta: { suppressGlobalError: true },
  });
  const rows = query.data?.results ?? [];
  const count = query.data?.count ?? 0;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <ChipGroup
          value={direction}
          onChange={(v) => setDirection(v as "" | GateDirection)}
          options={[
            { value: "", label: "Both directions" },
            { value: "INWARD", label: "Inward", tone: DIRECTION_META.INWARD.tone },
            { value: "OUTWARD", label: "Outward", tone: DIRECTION_META.OUTWARD.tone },
          ]}
        />
        <span className="mx-1 hidden h-6 w-px bg-[var(--border-default)] sm:block" />
        <ChipGroup
          value={recon}
          onChange={(v) => setRecon(v as ReconFilter)}
          options={[
            { value: "", label: "All ERP states" },
            { value: "MATCHED", label: RECON_META.MATCHED.label, tone: RECON_META.MATCHED.tone },
            { value: "UNMATCHED", label: RECON_META.UNMATCHED.label, tone: RECON_META.UNMATCHED.tone },
            { value: "DISCREPANCY", label: RECON_META.DISCREPANCY.label, tone: RECON_META.DISCREPANCY.tone },
          ]}
        />
      </div>

      {query.isError ? (
        <div className="gate-card p-4 text-[14px] text-content-3">Could not load gate history. {String((query.error as Error)?.message || "")}</div>
      ) : rows.length ? (
        <>
          <RegisterLedger rows={rows} onOpen={(row) => setOpenId(row.id)} showPlant={!plant} />
          <Pager page={page} count={count} onPage={setPage} loading={query.isFetching} />
        </>
      ) : (
        <div className="gate-card">
          <EmptyState icon={<History className="h-6 w-6" />} title={query.isLoading ? "Loading…" : "No movements for these filters"} />
        </div>
      )}

      <GoodsDetailSheet id={openId} onClose={() => setOpenId(null)} />
    </section>
  );
}

function ChipGroup({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string; tone?: string }>;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value || "all"}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "gate-press inline-flex min-h-[40px] items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-semibold",
              active ? "border-transparent bg-[var(--gate-ink-2)] text-white" : "border-line bg-surface-1 text-content-2",
            )}
          >
            {option.tone ? <span className="h-2 w-2 rounded-full" style={{ background: option.tone }} /> : null}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function Pager({ page, count, onPage, loading }: { page: number; count: number; onPage: (p: number) => void; loading?: boolean }) {
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  return (
    <div className="flex items-center justify-between gap-3 px-1 text-[13px] text-content-3">
      <span className="gate-num">
        {count.toLocaleString("en-IN")} record{count === 1 ? "" : "s"}
        {loading ? " · refreshing" : ""}
      </span>
      <div className="flex items-center gap-2">
        <button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} className="gate-press flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-surface-1 disabled:opacity-40" aria-label="Previous page">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <span className="gate-num min-w-[64px] text-center">
          {page} / {pages}
        </span>
        <button type="button" disabled={page >= pages} onClick={() => onPage(page + 1)} className="gate-press flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-surface-1 disabled:opacity-40" aria-label="Next page">
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}

function GoodsDetailSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const [mode, setMode] = useState<"view" | "correct" | "reconcile">("view");
  useEffect(() => setMode("view"), [id]);
  const detail = useQuery({
    queryKey: ["gate", "goods", "detail", id],
    queryFn: () => gateApi.getGoods(id!),
    enabled: Boolean(id),
    meta: { suppressGlobalError: true },
  });
  const audit = useQuery({
    queryKey: ["gate", "audit", id],
    queryFn: () => gateApi.audit({ object_id: id, page_size: 100 }),
    enabled: Boolean(id),
    meta: { suppressGlobalError: true },
  });
  const row = detail.data;
  const recon = reconMeta(row?.reconciliation_status);

  return (
    <GateSheet
      open={Boolean(id)}
      onOpenChange={(open) => !open && onClose()}
      title={mode === "correct" ? "Correct entry" : mode === "reconcile" ? "Link ERP document" : row ? row.invoice_number : "Gate movement"}
      description={row ? `${DIRECTION_META[row.direction]?.label} · ${gateDayTime(row.logged_at)}${row.plant_name ? ` · ${row.plant_name}` : ""}` : undefined}
      tall
    >
      {detail.isLoading ? (
        <div className="py-10 text-center text-[14px] text-content-3">Loading…</div>
      ) : detail.isError || !row ? (
        <div className="py-10 text-center text-[14px] text-content-3">Could not load this movement.</div>
      ) : mode === "correct" ? (
        <CorrectionForm row={row} onDone={() => setMode("view")} />
      ) : mode === "reconcile" ? (
        <ReconcileForm row={row} onDone={() => setMode("view")} />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <DirectionBadge direction={row.direction} />
            <PlateChip value={row.vehicle_number} />
            <TonePill label={recon.label} tone={recon.tone} soft={recon.soft} edge={recon.edge} dot />
          </div>

          <dl className="gate-ledger text-[14px]">
            <DetailRow label={DIRECTION_META[row.direction]?.party ?? "Party"}>{row.party_name}</DetailRow>
            <DetailRow label="Invoice">
              <span className="font-mono font-semibold">{row.invoice_number}</span>
              {row.invoice_date ? <span className="text-content-3"> · {gateDay(row.invoice_date, true)}</span> : null}
            </DetailRow>
            <DetailRow label="ERP doc">
              {row.document_id ? (
                <span className="font-mono">
                  {row.document_kind} · {row.document_reference || row.document_snapshot?.reference || "linked"}
                </span>
              ) : (
                <span className="text-content-3">Not linked — {recon.hint.toLowerCase()}</span>
              )}
            </DetailRow>
            <DetailRow label="Logged by">{row.created_by_name || "—"}</DetailRow>
            {row.notes ? <DetailRow label="Note">{row.notes}</DetailRow> : null}
          </dl>

          <div>
            <div className="mb-1.5 px-1 text-[12px] font-semibold uppercase tracking-[0.1em] text-content-4">Items observed at gate</div>
            {row.lines?.length ? (
              <ul className="gate-ledger text-[14px]">
                {row.lines.map((line, i) => (
                  <li key={line.id ?? i} className="gate-ledger-row grid grid-cols-[1fr_auto_auto] gap-3 px-3 py-2.5">
                    <span className="truncate">{line.product_name}</span>
                    <span className="gate-num font-mono">
                      {gateQty(line.quantity)} {line.uom}
                    </span>
                    <span className="gate-num w-[110px] text-right font-mono text-content-3">{gateAmount(line.amount)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-1 text-[14px] text-content-3">No separate observation — ERP document lines apply.</p>
            )}
          </div>

          {row.discrepancies?.length ? (
            <div className="rounded-2xl border p-3" style={{ borderColor: "var(--gate-alert-edge)", background: "var(--gate-alert-soft)" }}>
              <div className="mb-1 flex items-center gap-2 text-[14px] font-semibold" style={{ color: "var(--gate-alert)" }}>
                <FileWarning className="h-4 w-4" /> ERP mismatch
              </div>
              <ul className="list-disc space-y-0.5 pl-5 text-[13px] text-content-2">
                {row.discrepancies.map((d, i) => (
                  <li key={i}>{typeof d === "string" ? d : d.message || d.field || "Difference"}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {row.document_snapshot && row.document_id ? <GateVsErp row={row} /> : null}

          <div className="grid grid-cols-2 gap-2">
            <GateAction tone="plain" size="md" onClick={() => setMode("correct")}>
              <PencilLine className="h-5 w-5" /> Correct
            </GateAction>
            <GateAction tone="ink" size="md" onClick={() => setMode("reconcile")}>
              <Link2 className="h-5 w-5" /> {row.document_id ? "Re-link ERP" : "Link ERP doc"}
            </GateAction>
          </div>

          <AuditTimeline loading={audit.isLoading} error={audit.isError} events={audit.data?.results ?? []} />
        </div>
      )}
    </GateSheet>
  );
}

/** Side-by-side: what the gate saw vs the ERP document captured at match time. */
function GateVsErp({ row }: { row: GateGoodsMovement }) {
  const snap = row.document_snapshot || {};
  const sumLines = (lines?: Array<{ product_name: string; quantity: string | number; uom: string }>) =>
    (lines || []).map((l) => `${l.product_name} ${gateQty(l.quantity)} ${l.uom}`).join(" · ") || "—";
  const rows: Array<[string, string, string]> = [
    ["Invoice", row.invoice_number, snap.invoice_number || "—"],
    ["Inv. date", row.invoice_date ? gateDay(row.invoice_date, true) : "—", snap.invoice_date ? gateDay(snap.invoice_date, true) : "—"],
    ["Items", sumLines(row.lines), sumLines(snap.lines)],
    ["Amount", gateAmount(row.amount ?? null), gateAmount(snap.amount ?? null)],
  ];
  return (
    <div>
      <div className="mb-1.5 px-1 text-[12px] font-semibold uppercase tracking-[0.1em] text-content-4">Gate vs ERP</div>
      <div className="gate-ledger overflow-hidden text-[13px]">
        <div className="grid grid-cols-[80px_1fr_1fr] gap-2 px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-content-4">
          <span />
          <span>Gate</span>
          <span>ERP {snap.reference ? `· ${snap.reference}` : ""}</span>
        </div>
        {rows.map(([label, gate, erp]) => {
          const differs = gate !== erp && erp !== "—";
          return (
            <div key={label} className="gate-ledger-row grid grid-cols-[80px_1fr_1fr] gap-2 px-3 py-2">
              <span className="text-[12px] font-semibold text-content-4">{label}</span>
              <span className={cn("font-mono", differs ? "font-semibold text-[var(--gate-alert)]" : "text-content-1")}>{gate}</span>
              <span className="font-mono text-content-2">{erp}</span>
            </div>
          );
        })}
        {snap.amount_basis ? <div className="gate-ledger-row px-3 py-2 text-[12px] text-content-4">Amount basis: {snap.amount_basis}</div> : null}
        {snap.warnings?.length ? (
          <div className="gate-ledger-row px-3 py-2 text-[12px]" style={{ color: "var(--gate-pending)" }}>
            Source caveats: {snap.warnings.join(" · ")}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="gate-ledger-row flex gap-3 px-3 py-2.5">
      <dt className="w-[88px] shrink-0 text-[12px] font-semibold uppercase tracking-[0.08em] text-content-4">{label}</dt>
      <dd className="min-w-0 flex-1 text-content-1">{children}</dd>
    </div>
  );
}

function AuditTimeline({ events, loading, error }: { events: Array<import("@/services/gate").GateAuditEvent>; loading: boolean; error: boolean }) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-2 px-1 text-[12px] font-semibold uppercase tracking-[0.1em] text-content-4">
        <ShieldCheck className="h-4 w-4" /> Audit trail · append-only
      </div>
      {loading ? (
        <p className="px-1 text-[13px] text-content-3">Loading…</p>
      ) : error ? (
        <p className="px-1 text-[13px] text-content-3">Audit trail unavailable.</p>
      ) : events.length ? (
        <ol className="relative space-y-3 border-l-2 border-[var(--gate-rule-strong)] pl-4">
          {events.map((event) => (
            <li key={event.id} className="relative">
              <span className="absolute -left-[23px] top-1 h-3 w-3 rounded-full border-2 border-surface-1 bg-[var(--gate-ink-2)]" />
              <div className="text-[14px] font-semibold text-content-1">{event.action.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}</div>
              <div className="gate-num text-[12px] text-content-3">
                {gateDayTime(event.created_at)} · {event.actor_name || event.actor || "System"}
              </div>
              {event.reason ? <div className="mt-1 rounded-xl bg-surface-2 px-3 py-2 text-[13px] text-content-2">“{event.reason}”</div> : null}
              <SnapshotDiff before={event.before} after={event.after} />
            </li>
          ))}
        </ol>
      ) : (
        <p className="px-1 text-[13px] text-content-3">No events yet.</p>
      )}
    </section>
  );
}

function SnapshotDiff({ before, after }: { before?: Record<string, unknown> | null; after?: Record<string, unknown> | null }) {
  // Creation events have no "before"; only corrections/reconciliations show a diff.
  if (!before || !after || !Object.keys(before).length) return null;
  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).filter(
    (k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]) && typeof after[k] !== "object",
  );
  if (!keys.length) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-[12px]">
      {keys.slice(0, 8).map((key) => (
        <li key={key} className="text-content-3">
          <span className="font-semibold text-content-2">{key.replace(/_/g, " ")}</span>: <s className="font-mono">{String(before[key] ?? "—")}</s> →{" "}
          <span className="font-mono text-content-1">{String(after[key] ?? "—")}</span>
        </li>
      ))}
    </ul>
  );
}

function CorrectionForm({ row, onDone }: { row: GateGoodsMovement; onDone: () => void }) {
  const qc = useQueryClient();
  const [invoice, setInvoice] = useState(row.invoice_number);
  const [vehicle, setVehicle] = useState(row.vehicle_number);
  const [invoiceDate, setInvoiceDate] = useState(row.invoice_date || "");
  const [notes, setNotes] = useState(row.notes || "");
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const op = useGateOperation<Record<string, unknown>, GateGoodsMovement>({
    send: ({ client_token, ...payload }) => gateApi.correctGoods(row.id, { client_token, ...(payload as { reason: string }) }),
    onSaved: () => qc.invalidateQueries({ queryKey: ["gate"] }),
  });
  const changes: Record<string, unknown> = {};
  if (normalizeInvoice(invoice).trim() !== row.invoice_number) changes.invoice_number = normalizeInvoice(invoice).trim();
  if (normalizeVehicle(vehicle).trim() !== row.vehicle_number) changes.vehicle_number = normalizeVehicle(vehicle).trim();
  if ((invoiceDate || "") !== (row.invoice_date || "")) changes.invoice_date = invoiceDate || null;
  if (notes.trim() !== (row.notes || "")) changes.notes = notes.trim();
  const serverErrors = op.phase === "rejected" ? gateFieldErrors(op.error) : {};
  const reasonError = touched && reason.trim().length < 5 ? "Write why this is being corrected (at least 5 characters)." : serverErrors.reason;

  if (op.phase === "saved") {
    return (
      <div className="space-y-4 py-4 text-center">
        <p className="text-[16px] font-semibold text-content-1">Correction recorded</p>
        <p className="text-[14px] text-content-3">The original entry and your reason are kept in the audit trail.</p>
        <GateAction tone="ink" className="w-full" onClick={onDone}>
          Back to entry
        </GateAction>
      </div>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (reason.trim().length < 5 || !Object.keys(changes).length) return;
        void op.submit({ reason: reason.trim(), ...changes });
      }}
    >
      <fieldset disabled={op.locked} className="space-y-4">
        <div>
          <FieldLabel>Invoice number</FieldLabel>
          <input className="gate-field font-mono" value={invoice} onChange={(e) => setInvoice(e.target.value)} maxLength={80} />
          <FieldError message={serverErrors.invoice_number} />
        </div>
        <div>
          <FieldLabel>Vehicle number</FieldLabel>
          <input className="gate-field font-mono uppercase" value={vehicle} onChange={(e) => setVehicle(normalizeVehicle(e.target.value))} maxLength={40} />
          <FieldError message={serverErrors.vehicle_number} />
        </div>
        <div>
          <FieldLabel>Invoice date</FieldLabel>
          <input type="date" className="gate-field" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
        </div>
        <div>
          <FieldLabel>Note</FieldLabel>
          <textarea className="gate-field" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} rows={2} />
        </div>
        <div>
          <FieldLabel required>Reason for correction</FieldLabel>
          <textarea
            className="gate-field"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            rows={2}
            placeholder="e.g. Watchman typed wrong vehicle digit; verified from weighbridge slip"
            aria-invalid={Boolean(reasonError) || undefined}
          />
          <FieldError message={reasonError} />
        </div>
      </fieldset>
      {touched && !Object.keys(changes).length ? <p className="text-[13px] text-content-3">Change at least one field to record a correction.</p> : null}
      <OperationBanner phase={op.phase} error={op.error} onRetry={() => void op.retry()} />
      {op.phase !== "uncertain" ? (
        <div className="grid grid-cols-2 gap-2">
          <GateAction tone="plain" size="md" onClick={onDone} disabled={op.phase === "sending"}>
            Cancel
          </GateAction>
          <GateAction tone="ink" size="md" type="submit" busy={op.phase === "sending"}>
            Save correction
          </GateAction>
        </div>
      ) : null}
    </form>
  );
}

function ReconcileForm({ row, onDone }: { row: GateGoodsMovement; onDone: () => void }) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<GateMatchCandidate | null>(null);
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const match = useQuery({
    queryKey: ["gate", "match", "owner", row.id],
    queryFn: () =>
      gateApi.match({
        plant: row.plant,
        direction: row.direction,
        invoice_number: row.invoice_number,
        party_kind: row.party_kind,
        party_id: row.party_id,
      }),
    meta: { suppressGlobalError: true },
  });
  const op = useGateOperation<{ reason: string; document_kind: string; document_id: string }, GateGoodsMovement>({
    send: (payload) => gateApi.reconcileGoods(row.id, payload),
    onSaved: () => qc.invalidateQueries({ queryKey: ["gate"] }),
  });
  const candidates = useMemo(() => (match.data?.candidates ?? []).filter((c) => c.id !== row.document_id), [match.data, row.document_id]);
  const reasonError = touched && reason.trim().length < 5 ? "Write why this document is the right one." : undefined;

  if (op.phase === "saved") {
    const recon = reconMeta(op.result?.reconciliation_status);
    return (
      <div className="space-y-4 py-4 text-center">
        <p className="text-[16px] font-semibold text-content-1">ERP document linked</p>
        <TonePill label={recon.label} tone={recon.tone} soft={recon.soft} edge={recon.edge} dot className="mx-auto" />
        <GateAction tone="ink" className="w-full" onClick={onDone}>
          Back to entry
        </GateAction>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-[14px] text-content-3">
        Only documents for the same plant, direction and {DIRECTION_META[row.direction]?.party.toLowerCase()} can be linked. Source ERP transactions are not changed.
      </p>
      {match.isLoading ? (
        <p className="text-[14px] text-content-3">Searching ERP documents…</p>
      ) : candidates.length ? (
        <div className="space-y-2" role="radiogroup" aria-label="ERP documents">
          {candidates.map((c) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={selected?.id === c.id}
              disabled={op.locked}
              onClick={() => setSelected(c)}
              className={cn("gate-press block w-full rounded-2xl border p-3 text-left", selected?.id === c.id ? "border-[var(--gate-in)] bg-[var(--gate-in-soft)]" : "border-line bg-surface-2")}
            >
              <div className="flex justify-between gap-3">
                <span className="font-mono text-[14px] font-semibold text-content-1">
                  {c.kind} · {c.reference}
                </span>
                <span className="text-[13px] text-content-3">{gateDay(c.invoice_date, true)}</span>
              </div>
              <div className="mt-1 text-[13px] text-content-2">
                {c.lines.map((l) => `${l.product_name} ${gateQty(l.quantity)} ${l.uom}`).join(" · ")}
              </div>
              {c.amount != null ? (
                <div className="gate-num mt-1 font-mono text-[13px] text-content-3">
                  {gateAmount(c.amount)} {c.amount_basis ? `(${c.amount_basis})` : ""}
                </div>
              ) : null}
            </button>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-line p-4 text-[14px] text-content-3">
          No ERP document found for invoice <span className="font-mono">{row.invoice_number}</span> and this party. If the invoice was typed wrong, correct it first.
        </div>
      )}
      <div>
        <FieldLabel required>Reason</FieldLabel>
        <textarea className="gate-field" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} disabled={op.locked} aria-invalid={Boolean(reasonError) || undefined} />
        <FieldError message={reasonError} />
      </div>
      <OperationBanner phase={op.phase} error={op.error} onRetry={() => void op.retry()} />
      {op.phase !== "uncertain" ? (
        <div className="grid grid-cols-2 gap-2">
          <GateAction tone="plain" size="md" onClick={onDone} disabled={op.phase === "sending"}>
            Cancel
          </GateAction>
          <GateAction
            tone="ink"
            size="md"
            busy={op.phase === "sending"}
            disabled={!selected}
            onClick={() => {
              setTouched(true);
              if (!selected || reason.trim().length < 5) return;
              void op.submit({ reason: reason.trim(), document_kind: selected.kind, document_id: selected.id });
            }}
          >
            Link document
          </GateAction>
        </div>
      ) : null}
    </div>
  );
}

function VisitorHistory({ plant, dateFrom, dateTo, search }: { plant: string; dateFrom: string; dateTo: string; search: string }) {
  const [status, setStatus] = useState<"" | VisitorStatus>("");
  const [page, setPage] = useState(1);
  const [photoFor, setPhotoFor] = useState<GateVisitor | null>(null);
  useEffect(() => setPage(1), [plant, dateFrom, dateTo, search, status]);
  const query = useQuery({
    queryKey: ["gate", "visitors", "history", { plant, dateFrom, dateTo, search, status, page }],
    queryFn: () => gateApi.listVisitors({ plant, date_from: dateFrom, date_to: dateTo, search, status, page, page_size: PAGE_SIZE }),
    placeholderData: keepPreviousData,
    meta: { suppressGlobalError: true },
  });
  const rows = query.data?.results ?? [];

  return (
    <section className="space-y-3">
      <ChipGroup
        value={status}
        onChange={(v) => setStatus(v as "" | VisitorStatus)}
        options={[
          { value: "", label: "All" },
          ...(["PENDING", "INSIDE", "EXITED", "CANCELLED"] as VisitorStatus[]).map((s) => ({ value: s, label: VISITOR_STATUS_META[s].label, tone: VISITOR_STATUS_META[s].tone })),
        ]}
      />
      {query.isError ? (
        <div className="gate-card p-4 text-[14px] text-content-3">Could not load visitor history.</div>
      ) : rows.length ? (
        <>
          <div className="gate-ledger overflow-x-auto">
            <table className="w-full min-w-[820px] text-[13px]">
              <thead>
                <tr className="text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-content-4">
                  <th className="px-3 py-3">Visitor</th>
                  <th className="px-3 py-3">Purpose · company</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3">Registered</th>
                  <th className="px-3 py-3">In · out</th>
                  <th className="px-3 py-3">ID</th>
                  <th className="px-3 py-3" />
                </tr>
              </thead>
              <tbody>
                {rows.map((v) => {
                  const meta = VISITOR_STATUS_META[v.status] ?? VISITOR_STATUS_META.PENDING;
                  return (
                    <tr key={v.id} className="border-t border-[var(--gate-rule-strong)] align-top">
                      <td className="px-3 py-2.5">
                        <div className="font-semibold text-content-1">{v.name}</div>
                        <div className="gate-num font-mono text-content-3">{v.mobile}</div>
                        {!plant && v.plant_name ? <div className="text-[12px] text-content-4">{v.plant_name}</div> : null}
                      </td>
                      <td className="px-3 py-2.5 text-content-2">
                        {v.purpose}
                        {v.company ? <div className="text-content-3">{v.company}</div> : null}
                      </td>
                      <td className="px-3 py-2.5">
                        <TonePill label={meta.label} tone={meta.tone} soft={meta.soft} edge={meta.edge} dot />
                        {v.source ? <div className="mt-1 text-[11px] text-content-4">{v.source === "WATCHMAN" ? "Walk-in" : "QR"}</div> : null}
                      </td>
                      <td className="gate-num px-3 py-2.5 text-content-2">{gateDayTime(v.submitted_at)}</td>
                      <td className="gate-num px-3 py-2.5 text-content-2">
                        {v.entry_at ? gateDayTime(v.entry_at) : "—"}
                        <div className="text-content-3">{v.exit_at ? `${gateDayTime(v.exit_at)} · ${gateElapsed(v.entry_at, v.exit_at)}` : v.entry_at ? "still inside" : ""}</div>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-content-3">{v.government_id_masked || "—"}</td>
                      <td className="px-3 py-2.5 text-right">
                        {v.has_selfie ? (
                          <button type="button" onClick={() => setPhotoFor(v)} className="gate-press min-h-[40px] rounded-xl border border-line px-3 text-[13px] font-semibold text-content-2">
                            Photo
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Pager page={page} count={query.data?.count ?? 0} onPage={setPage} loading={query.isFetching} />
        </>
      ) : (
        <div className="gate-card">
          <EmptyState icon={<Users className="h-6 w-6" />} title={query.isLoading ? "Loading…" : "No visitors for these filters"} />
        </div>
      )}
      <PhotoSheet visitor={photoFor} onClose={() => setPhotoFor(null)} />
    </section>
  );
}

function PhotoSheet({ visitor, onClose }: { visitor: GateVisitor | null; onClose: () => void }) {
  const url = useVisitorSelfie(visitor, Boolean(visitor));
  return (
    <GateSheet open={Boolean(visitor)} onOpenChange={(open) => !open && onClose()} title={visitor?.name ?? "Visitor"} description="Private visitor photo · owner only">
      <div className="flex justify-center pb-2">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={`Photo of ${visitor?.name}`} className="max-h-[60dvh] rounded-2xl object-contain" />
        ) : (
          <p className="py-10 text-[14px] text-content-3">Loading photo…</p>
        )}
      </div>
    </GateSheet>
  );
}

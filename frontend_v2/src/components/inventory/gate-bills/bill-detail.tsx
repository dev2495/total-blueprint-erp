"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  CheckCircle2,
  Circle,
  ClipboardCheck,
  Link2,
  Loader2,
  PackagePlus,
  Save,
  Search,
} from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Panel } from "@/components/premium";
import { getApiErrorStatus } from "@/lib/api";
import { cn } from "@/lib/utils";
import { inventoryService } from "@/services/inventory";
import {
  BILL_STATUS_META,
  gateBillsApi,
  RECEIPT_KIND_LABEL,
  VOID_REASONS,
  type BillReceiptRef,
  type InwardBill,
  type VoidCode,
} from "@/services/gate-bills";
import { gateErrorMessage, useGateOperation } from "@/components/gate/use-gate-operation";
import {
  BILL_POLL_MS,
  BillAccessDenied,
  BillStatusPill,
  billDateTime,
  billRef,
  useBillReviewAccess,
  useNowTick,
  waitingLabel,
} from "./bill-common";
import { BillViewer } from "./bill-viewer";

export function billQueryKey(id: string) {
  return ["inventory", "gate-bills", "detail", id] as const;
}

/** Shared invalidation after any receiving action (queue + counts + bell). */
export function invalidateBillViews(qc: ReturnType<typeof useQueryClient>, id?: string) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: ["inventory", "gate-bills"] }),
    id ? qc.invalidateQueries({ queryKey: billQueryKey(id) }) : Promise.resolve(),
    qc.invalidateQueries({ queryKey: ["notifications"] }),
  ]);
}

export function useBill(id: string, enabled = true) {
  return useQuery({
    queryKey: billQueryKey(id),
    queryFn: () => gateBillsApi.get(id),
    enabled: enabled && Boolean(id),
    refetchInterval: BILL_POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    retry: (count, error) => ![403, 404].includes(getApiErrorStatus(error) ?? 0) && count < 2,
    meta: { suppressGlobalError: true },
  });
}

const fieldClass =
  "h-11 w-full rounded-xl border border-line bg-surface-2 px-3 text-[14px] text-content-1 outline-none focus:border-primary focus:ring-2 focus:ring-info-border disabled:opacity-60";

export function GateBillDetail({ id }: { id: string }) {
  const access = useBillReviewAccess();
  const billQ = useBill(id, access.allowed);
  const now = useNowTick(15_000);
  const [dialog, setDialog] = useState<null | "match" | "complete" | "void">(null);
  const [reviewDirty, setReviewDirty] = useState(false);

  if (access.loading) return <div className="h-40 animate-pulse rounded-3xl bg-surface-2" />;
  if (!access.allowed) return <BillAccessDenied />;

  const status = getApiErrorStatus(billQ.error);
  if (billQ.isLoading) return <div className="h-[60vh] animate-pulse rounded-3xl bg-surface-2" />;
  if (!billQ.data) {
    return (
      <div className="mx-auto mt-10 max-w-[520px] rounded-3xl border border-line bg-surface-1 p-6 text-center">
        <h1 className="text-lg font-semibold text-content-1">{status === 404 ? "Bill not found" : "Could not load this bill"}</h1>
        <p className="mt-2 text-sm text-content-3">{status === 404 ? "It may belong to a factory outside your receiving scope." : gateErrorMessage(billQ.error, "Check the connection and retry.")}</p>
        <div className="mt-4 flex justify-center gap-2">
          <button type="button" onClick={() => void billQ.refetch()} className="min-h-[44px] rounded-xl border border-line px-4 text-sm font-semibold">
            Retry
          </button>
          <Link href="/inventory/gate-bills" className="inline-flex min-h-[44px] items-center rounded-xl px-4 text-sm font-semibold text-primary">
            Back to gate bills
          </Link>
        </div>
      </div>
    );
  }

  const bill = billQ.data;
  const open = bill.status === "PENDING_GRN" || bill.status === "PARTIAL_GRN";
  const refs = bill.receipt_refs || [];

  return (
    <div className="mx-auto max-w-[1500px] space-y-4" data-testid="gate-bill-detail">
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/inventory/gate-bills" className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-2 text-[13px] font-semibold text-content-2 hover:bg-surface-2">
          <ArrowLeft className="h-4 w-4" /> Gate bills
        </Link>
        <h1 className="min-w-0 text-[20px] font-semibold tracking-[-0.01em] text-content-1">
          Bill <span className="font-mono">{billRef(bill.id)}</span> · {bill.plant_name}
        </h1>
        <BillStatusPill status={bill.status} />
        {billQ.isError ? (
          <span role="status" className="inline-flex items-center gap-1 text-[12px] font-medium text-danger-fg">
            <AlertTriangle className="h-3.5 w-3.5" /> Live refresh failed — showing last loaded state
          </span>
        ) : null}
      </div>

      {bill.duplicate_warning?.possible_duplicate ? (
        <div className="rounded-2xl border border-warning-border bg-warning-bg px-4 py-3 text-[13px] text-content-2">
          <span className="font-semibold text-warning-fg">Possible repeat upload.</span> The same photos were uploaded at this factory before:{" "}
          {bill.duplicate_warning.bill_ids.map((other, i) => (
            <span key={other}>
              {i ? ", " : ""}
              <Link href={`/inventory/gate-bills/${other}`} className="font-mono font-semibold text-primary hover:underline">
                {billRef(other)}
              </Link>
            </span>
          ))}
          . If it is the same delivery, resolve this one as a duplicate.
        </div>
      ) : null}

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(360px,0.7fr)]">
        <Panel title="Bill photo" description={`${bill.page_count} page${bill.page_count === 1 ? "" : "s"} · arrived ${billDateTime(bill.arrival_at)} · by ${bill.created_by_name}`}>
          <BillViewer pages={bill.pages} billLabel={`Bill ${billRef(bill.id)}`} />
        </Panel>

        <div className="min-w-0 space-y-4">
          <Panel title={open ? "Next step" : "Closed"} description={BILL_STATUS_META[bill.status]?.hint}>
            {open ? (
              <div className="space-y-2">
                <div className="flex items-baseline justify-between text-[13px] text-content-3">
                  <span>Waiting since arrival</span>
                  <span className="text-[18px] font-semibold tabular-nums text-content-1">{waitingLabel(bill.arrival_at, now)}</span>
                </div>
                <Link
                  href={`/inventory/grn?inward_bill_id=${bill.id}`}
                  onClick={(event) => {
                    if (!reviewDirty) return;
                    event.preventDefault();
                    document.querySelector<HTMLButtonElement>('[data-bill-review-save]')?.focus();
                  }}
                  className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-[14px] font-semibold text-primary-foreground hover:brightness-105"
                >
                  <PackagePlus className="h-4 w-4" /> {refs.length ? "Post another GRN for this bill" : "Create GRN from this bill"}
                </Link>
                {reviewDirty ? <p role="status" className="text-[13px] font-medium text-warning-fg">Save the bill details below before opening its GRN.</p> : null}
                <ActionButton icon={<Link2 className="h-4 w-4" />} onClick={() => setDialog("match")}>
                  Match an existing GRN / receipt
                </ActionButton>
                {bill.status === "PARTIAL_GRN" && refs.length ? (
                  <ActionButton icon={<ClipboardCheck className="h-4 w-4" />} onClick={() => setDialog("complete")} tone="good">
                    Confirm all bill lines received
                  </ActionButton>
                ) : null}
                {bill.status === "PENDING_GRN" ? (
                  <ActionButton icon={<Ban className="h-4 w-4" />} onClick={() => setDialog("void")} tone="muted">
                    No GRN needed (duplicate / non-stock)…
                  </ActionButton>
                ) : null}
                <p className="pt-1 text-[12px] leading-relaxed text-content-4">
                  Posting or matching keeps the bill “Partly received” so mixed classes or several POs are not hidden. Close it only when every
                  line on the paper is received.
                </p>
              </div>
            ) : (
              <div className="space-y-1 text-[13px] text-content-2">
                <div>
                  {bill.status === "RECEIPTED" ? "All lines received" : "Resolved without a GRN"} · {billDateTime(bill.resolved_at)}
                </div>
                {bill.resolution_code ? <div className="text-content-3">Reason code: {bill.resolution_code.replace(/_/g, " ").toLowerCase()}</div> : null}
                {bill.resolution_reason ? <div className="rounded-xl bg-surface-2 px-3 py-2 text-content-2">“{bill.resolution_reason}”</div> : null}
              </div>
            )}
          </Panel>

          <ReviewPanel bill={bill} disabled={!open} onDirtyChange={setReviewDirty} />

          <Panel title="Receipts linked" description={refs.length ? undefined : "No GRN or receipt linked yet."}>
            {refs.length ? <ReceiptList refs={refs} /> : null}
          </Panel>

          <Panel title="Timeline">
            <Timeline bill={bill} />
          </Panel>
        </div>
      </div>

      <MatchDialog bill={bill} open={dialog === "match"} onClose={() => setDialog(null)} />
      <CompleteDialog bill={bill} open={dialog === "complete"} onClose={() => setDialog(null)} />
      <VoidDialog bill={bill} open={dialog === "void"} onClose={() => setDialog(null)} />
    </div>
  );
}

function ActionButton({ icon, children, onClick, tone }: { icon: React.ReactNode; children: React.ReactNode; onClick: () => void; tone?: "good" | "muted" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border px-4 text-[14px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border",
        tone === "good"
          ? "border-success-border bg-success-bg text-success-fg hover:brightness-95"
          : tone === "muted"
            ? "border-line bg-surface-1 text-content-3 hover:bg-surface-2"
            : "border-line bg-surface-1 text-content-1 hover:bg-surface-2",
      )}
    >
      {icon}
      {children}
    </button>
  );
}

export function ReceiptList({ refs }: { refs: BillReceiptRef[] }) {
  return (
    <ul className="divide-y divide-line">
      {refs.map((ref) => (
        <li key={`${ref.kind}-${ref.id}`} className="py-2.5 first:pt-0 last:pb-0">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-[13px] font-semibold text-content-1">
              {RECEIPT_KIND_LABEL[ref.kind] ?? ref.kind} · <span className="font-mono">{ref.reference || ref.id.slice(0, 8)}</span>
            </span>
            <span className="shrink-0 text-[13px] tabular-nums text-content-2">
              {ref.quantities_by_uom && Object.keys(ref.quantities_by_uom).length
                ? Object.entries(ref.quantities_by_uom).map(([uom, quantity]) => `${quantity} ${uom}`).join(" · ")
                : `${ref.quantity ?? "—"} ${ref.uom ?? ""}`}
            </span>
          </div>
          <div className="mt-0.5 truncate text-[12px] text-content-3">
            {ref.vendor_name || "Vendor —"} · Inv {ref.invoice_number || "—"} · Posted {billDateTime(ref.received_at)}
            {ref.quality_status ? ` · QC ${String(ref.quality_status).toLowerCase()}` : ""}
          </div>
        </li>
      ))}
    </ul>
  );
}

function Timeline({ bill }: { bill: InwardBill }) {
  const steps: Array<{ done: boolean; title: string; when?: string | null; body?: string }> = [
    { done: true, title: "Arrived at gate", when: bill.arrival_at, body: `Photographed by ${bill.created_by_name} · ${bill.plant_name}` },
    ...(bill.receipt_refs || []).map((ref) => ({
      done: true,
      title: `${RECEIPT_KIND_LABEL[ref.kind] ?? ref.kind} linked`,
      body: `${ref.reference || ""} · receipt posted ${billDateTime(ref.received_at)}`,
    })),
    bill.status === "VOID"
      ? { done: true, title: "Resolved without GRN", when: bill.resolved_at, body: bill.resolution_reason }
      : { done: bill.status === "RECEIPTED", title: "All lines received", when: bill.resolved_at, body: bill.status === "RECEIPTED" ? bill.resolution_reason : "Waiting for inventory to confirm" },
  ];
  return (
    <ol className="space-y-3">
      {steps.map((step, i) => (
        <li key={i} className="flex gap-3">
          {step.done ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success-fg" aria-hidden /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-content-4" aria-hidden />}
          <div className="min-w-0">
            <div className={cn("text-[13px] font-semibold", step.done ? "text-content-1" : "text-content-3")}>{step.title}</div>
            <div className="text-[12px] text-content-3">
              {step.when ? billDateTime(step.when) : ""}
              {step.body ? `${step.when ? " · " : ""}${step.body}` : ""}
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Inventory-entered details (master vendor + paper fields). Never from the image. */
function ReviewPanel({ bill, disabled, onDirtyChange }: { bill: InwardBill; disabled: boolean; onDirtyChange: (dirty: boolean) => void }) {
  const qc = useQueryClient();
  const vendorsQ = useQuery({ queryKey: ["vendors"], queryFn: () => inventoryService.getVendors(), staleTime: 60_000, meta: { suppressGlobalError: true } });
  const review = bill.review_data || {};
  const [vendorId, setVendorId] = useState(String(review.vendor_id || ""));
  const [invoice, setInvoice] = useState(String(review.invoice_number || ""));
  const [invoiceDate, setInvoiceDate] = useState(String(review.invoice_date || ""));
  const [vehicle, setVehicle] = useState(String(review.vehicle_number || ""));
  const [notes, setNotes] = useState(String(review.notes || ""));
  const [dirty, setDirty] = useState(false);
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);

  // Adopt server values when not editing (another reviewer may have saved).
  useEffect(() => {
    if (dirty) return;
    setVendorId(String(review.vendor_id || ""));
    setInvoice(String(review.invoice_number || ""));
    setInvoiceDate(String(review.invoice_date || ""));
    setVehicle(String(review.vehicle_number || ""));
    setNotes(String(review.notes || ""));
  }, [review.vendor_id, review.invoice_number, review.invoice_date, review.vehicle_number, review.notes, dirty]);

  const op = useGateOperation<Record<string, unknown>, InwardBill>({
    send: (payload) => gateBillsApi.review(bill.id, payload as Parameters<typeof gateBillsApi.review>[1]),
    onSaved: (saved) => {
      qc.setQueryData(billQueryKey(bill.id), saved);
      setDirty(false);
      return invalidateBillViews(qc, bill.id);
    },
  });
  const conflict = op.phase === "rejected" && getApiErrorStatus(op.error) === 409;
  useEffect(() => {
    if (conflict) void invalidateBillViews(qc, bill.id);
  }, [conflict, qc, bill.id]);

  const change = (setter: (v: string) => void) => (v: string) => {
    setter(v);
    setDirty(true);
    if (op.phase === "saved" || op.phase === "rejected") op.reset();
  };

  const save = () => {
    const payload: Record<string, unknown> = {};
    if (vendorId && vendorId !== String(review.vendor_id || "")) payload.vendor_id = vendorId;
    if (invoice !== String(review.invoice_number || "")) payload.invoice_number = invoice.trim();
    if (invoiceDate !== String(review.invoice_date || "")) payload.invoice_date = invoiceDate || null;
    if (vehicle !== String(review.vehicle_number || "")) payload.vehicle_number = vehicle.trim().toUpperCase();
    if (notes !== String(review.notes || "")) payload.notes = notes.trim();
    if (!Object.keys(payload).length) return setDirty(false);
    void op.submit(payload);
  };

  const vendors = (vendorsQ.data || []) as Array<{ id: string; name: string; code?: string }>;
  return (
    <Panel title="Bill details" description="Typed by inventory from the photo. Used to prefill the GRN; does not post stock.">
      <fieldset disabled={disabled || op.locked} className="space-y-2.5">
        <label className="block text-[12px] font-semibold text-content-3">
          Vendor (master)
          <select value={vendorId} onChange={(e) => change(setVendorId)(e.target.value)} className={cn(fieldClass, "mt-1")}>
            <option value="">{vendorsQ.isLoading ? "Loading vendors…" : "Choose vendor"}</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
                {v.code ? ` (${v.code})` : ""}
              </option>
            ))}
          </select>
        </label>
        <div className="grid gap-2.5 sm:grid-cols-2">
          <label className="block text-[12px] font-semibold text-content-3">
            Invoice number
            <input value={invoice} onChange={(e) => change(setInvoice)(e.target.value)} maxLength={80} className={cn(fieldClass, "mt-1 font-mono")} />
          </label>
          <label className="block text-[12px] font-semibold text-content-3">
            Invoice date
            <input type="date" value={invoiceDate} onChange={(e) => change(setInvoiceDate)(e.target.value)} className={cn(fieldClass, "mt-1")} />
          </label>
        </div>
        <label className="block text-[12px] font-semibold text-content-3">
          Vehicle number
          <input value={vehicle} onChange={(e) => change(setVehicle)(e.target.value)} maxLength={40} className={cn(fieldClass, "mt-1 font-mono uppercase")} />
        </label>
        <label className="block text-[12px] font-semibold text-content-3">
          Note
          <textarea value={notes} onChange={(e) => change(setNotes)(e.target.value)} maxLength={500} rows={2} className={cn(fieldClass, "mt-1 h-auto py-2")} />
        </label>
      </fieldset>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-bill-review-save
          onClick={op.phase === "uncertain" ? () => void op.retry() : save}
          disabled={disabled || !dirty || op.phase === "sending"}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-line bg-surface-1 px-4 text-[13px] font-semibold text-content-1 hover:bg-surface-2 disabled:opacity-50"
        >
          {op.phase === "sending" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {op.phase === "uncertain" ? "Save again (same request)" : "Save details"}
        </button>
        <OpStatus phase={op.phase} error={op.error} savedText="Details saved" conflict={conflict} />
      </div>
    </Panel>
  );
}

function OpStatus({ phase, error, savedText, conflict }: { phase: string; error: unknown; savedText: string; conflict?: boolean }) {
  if (phase === "saved") return <span className="text-[12px] font-medium text-success-fg">{savedText}</span>;
  if (conflict) return <span className="text-[12px] font-medium text-warning-fg">Someone else changed this bill — refreshed. Check and try again.</span>;
  if (phase === "rejected") return <span className="text-[12px] font-medium text-danger-fg">{gateErrorMessage(error)}</span>;
  if (phase === "uncertain")
    return <span className="text-[12px] font-medium text-warning-fg">Not confirmed: {gateErrorMessage(error)} Retrying sends the same request.</span>;
  return null;
}

function ConfirmFooter({
  busy,
  disabled,
  label,
  onConfirm,
  onCancel,
  phase,
  error,
  conflict,
  tone,
}: {
  busy: boolean;
  disabled: boolean;
  label: string;
  onConfirm: () => void;
  onCancel: () => void;
  phase: string;
  error: unknown;
  conflict: boolean;
  tone?: "danger";
}) {
  return (
    <div className="space-y-2 border-t border-line pt-3">
      <OpStatus phase={phase} error={error} savedText="Saved" conflict={conflict} />
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={busy || phase === "uncertain"} className="min-h-[44px] rounded-xl border border-line px-4 text-[13px] font-semibold text-content-2 disabled:opacity-50">
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={disabled || busy}
          className={cn(
            "inline-flex min-h-[44px] items-center gap-2 rounded-xl px-4 text-[13px] font-semibold text-white disabled:opacity-50",
            tone === "danger" ? "bg-danger-solid" : "bg-primary",
          )}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {phase === "uncertain" ? "Send same request again" : label}
        </button>
      </div>
    </div>
  );
}

function useResolveOp(bill: InwardBill, send: (payload: Record<string, unknown> & { client_token: string }) => Promise<InwardBill>, onDone: () => void) {
  const qc = useQueryClient();
  const op = useGateOperation<Record<string, unknown>, InwardBill>({
    send,
    onSaved: (saved) => {
      qc.setQueryData(billQueryKey(bill.id), saved);
      onDone();
      return invalidateBillViews(qc, bill.id);
    },
  });
  const conflict = op.phase === "rejected" && getApiErrorStatus(op.error) === 409;
  useEffect(() => {
    if (conflict) void invalidateBillViews(qc, bill.id);
  }, [conflict, qc, bill.id]);
  return { op, conflict };
}

function DialogShell({ open, onClose, title, description, children, locked }: { open: boolean; onClose: () => void; title: string; description: string; children: React.ReactNode; locked: boolean }) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && !locked && onClose()}>
      <DialogContent className="max-h-[92dvh] w-[calc(100vw-1.5rem)] max-w-[640px] overflow-y-auto">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        {children}
      </DialogContent>
    </Dialog>
  );
}

function ReasonField({ value, onChange, placeholder, disabled }: { value: string; onChange: (v: string) => void; placeholder: string; disabled?: boolean }) {
  const short = value.trim().length > 0 && value.trim().length < 5;
  return (
    <label className="block text-[12px] font-semibold text-content-3">
      Reason (recorded in the audit, 5–500 characters)
      <textarea disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)} rows={2} maxLength={500} placeholder={placeholder} className={cn(fieldClass, "mt-1 h-auto py-2")} aria-invalid={short || undefined} />
      {short ? <span className="mt-1 block text-danger-fg">At least 5 characters.</span> : null}
    </label>
  );
}

function MatchDialog({ bill, open, onClose }: { bill: InwardBill; open: boolean; onClose: () => void }) {
  const [search, setSearch] = useState(String(bill.review_data?.invoice_number || ""));
  const [selected, setSelected] = useState<BillReceiptRef[]>([]);
  const [reason, setReason] = useState("");
  const [complete, setComplete] = useState(false);
  const vendorFilter = bill.review_data?.vendor_id ? String(bill.review_data.vendor_id) : undefined;
  const candQ = useQuery({
    queryKey: ["inventory", "gate-bills", "candidates", bill.id, search.trim(), vendorFilter],
    queryFn: () => gateBillsApi.candidates(bill.id, { search: search.trim() || undefined, vendor_id: vendorFilter }),
    enabled: open,
    meta: { suppressGlobalError: true },
  });
  const { op, conflict } = useResolveOp(bill, (payload) => gateBillsApi.linkReceipts(bill.id, payload as Parameters<typeof gateBillsApi.linkReceipts>[1]), () => undefined);
  useEffect(() => {
    if (!open) {
      setSelected([]);
      setReason("");
      setComplete(false);
      op.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const vendorLock = selected[0]?.vendor_id ?? null;
  const toggle = (ref: BillReceiptRef) =>
    setSelected((cur) => (cur.some((r) => r.kind === ref.kind && r.id === ref.id) ? cur.filter((r) => !(r.kind === ref.kind && r.id === ref.id)) : [...cur, ref]));
  const saved = op.phase === "saved";

  return (
    <DialogShell open={open} onClose={onClose} locked={op.locked} title="Match existing GRN / receipt" description="Link receipts already posted at this factory to this bill. Matching never posts or changes stock.">
      {saved ? (
        <div className="space-y-3 py-2 text-[14px]">
          <p className="font-semibold text-success-fg">
            Linked {selected.length} receipt{selected.length === 1 ? "" : "s"}. Bill is now {BILL_STATUS_META[op.result?.status ?? "PARTIAL_GRN"]?.label.toLowerCase()}.
          </p>
          <button type="button" onClick={onClose} className="min-h-[44px] rounded-xl bg-primary px-4 text-[13px] font-semibold text-white">
            Done
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <label className="relative block">
            <span className="sr-only">Search vendor invoice number</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-4" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Vendor invoice number" className={cn(fieldClass, "pl-9")} disabled={op.locked} />
          </label>
          {vendorFilter ? <p className="text-[12px] text-content-3">Showing receipts from the reviewed vendor only.</p> : null}
          <div className="max-h-[40vh] overflow-y-auto rounded-xl border border-line" role="group" aria-label="Receipt candidates">
            {candQ.isLoading ? (
              <div className="p-4 text-[13px] text-content-3">Searching receipts…</div>
            ) : candQ.isError ? (
              <div className="p-4 text-[13px] text-danger-fg">Could not load receipts. {gateErrorMessage(candQ.error)}</div>
            ) : (candQ.data ?? []).length ? (
              <ul className="divide-y divide-line">
                {(candQ.data ?? []).map((ref) => {
                  const checked = selected.some((r) => r.kind === ref.kind && r.id === ref.id);
                  const blocked = Boolean(vendorLock) && ref.vendor_id !== vendorLock && !checked;
                  return (
                    <li key={`${ref.kind}-${ref.id}`}>
                      <label className={cn("flex min-h-[56px] cursor-pointer items-start gap-3 px-3 py-2.5", blocked ? "opacity-40" : "hover:bg-surface-2")}>
                        <input type="checkbox" className="mt-1 h-5 w-5 accent-[hsl(var(--primary))]" checked={checked} disabled={blocked || op.locked} onChange={() => toggle(ref)} />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-[13px] font-semibold text-content-1">
                              {RECEIPT_KIND_LABEL[ref.kind] ?? ref.kind} · <span className="font-mono">{ref.reference}</span>
                            </span>
                            <span className="text-[13px] tabular-nums text-content-2">
                              {ref.quantities_by_uom && Object.keys(ref.quantities_by_uom).length
                                ? Object.entries(ref.quantities_by_uom).map(([uom, quantity]) => `${quantity} ${uom}`).join(" · ")
                                : `${ref.quantity ?? "—"} ${ref.uom ?? ""}`}
                            </span>
                          </span>
                          <span className="block truncate text-[12px] text-content-3">
                            {ref.vendor_name} · Inv {ref.invoice_number || "—"} · {billDateTime(ref.received_at)}
                            {blocked ? " · different vendor" : ""}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="p-4 text-[13px] text-content-3">No unlinked receipts at this factory from 24 hours before arrival onwards{search ? " matching this invoice" : ""}.</div>
            )}
          </div>
          <ReasonField disabled={op.locked} value={reason} onChange={setReason} placeholder="e.g. GRN posted from PO before photo was reviewed" />
          <label className="flex min-h-[44px] items-start gap-3 rounded-xl border border-line px-3 py-2.5 text-[13px] text-content-2">
            <input type="checkbox" className="mt-0.5 h-5 w-5" checked={complete} onChange={(e) => setComplete(e.target.checked)} disabled={op.locked} />
            <span>
              <span className="font-semibold text-content-1">These receipts cover every line on the bill</span> — close it as received. Leave unticked if more GRNs are still needed.
            </span>
          </label>
          <ConfirmFooter
            busy={op.phase === "sending"}
            disabled={!selected.length || reason.trim().length < 5}
            label={`Link ${selected.length || ""} receipt${selected.length === 1 ? "" : "s"}${complete ? " & close" : ""}`}
            onConfirm={() =>
              op.phase === "uncertain"
                ? void op.retry()
                : void op.submit({ receipt_refs: selected.map((r) => ({ kind: r.kind, id: r.id })), reason: reason.trim(), bill_complete: complete })
            }
            onCancel={onClose}
            phase={op.phase}
            error={op.error}
            conflict={conflict}
          />
        </div>
      )}
    </DialogShell>
  );
}

function CompleteDialog({ bill, open, onClose }: { bill: InwardBill; open: boolean; onClose: () => void }) {
  const [reason, setReason] = useState("All bill lines received");
  const [confirm, setConfirm] = useState(false);
  const { op, conflict } = useResolveOp(bill, (payload) => gateBillsApi.complete(bill.id, payload as Parameters<typeof gateBillsApi.complete>[1]), onClose);
  useEffect(() => {
    if (!open) {
      setConfirm(false);
      op.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const refs = bill.receipt_refs || [];
  return (
    <DialogShell open={open} onClose={onClose} locked={op.locked} title="Confirm all bill lines received" description="Closes the bill as received. No stock is posted by this step.">
      <div className="space-y-3">
        <div className="rounded-xl border border-line p-3">
          <ReceiptList refs={refs} />
        </div>
        <ReasonField disabled={op.locked} value={reason} onChange={setReason} placeholder="e.g. All lines received across 2 GRNs" />
        <label className="flex min-h-[44px] items-start gap-3 rounded-xl border border-success-border bg-success-bg px-3 py-2.5 text-[13px] text-content-1">
          <input type="checkbox" className="mt-0.5 h-5 w-5" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} disabled={op.locked} />
          I checked the bill photo: every line on it is covered by the receipts above.
        </label>
        <ConfirmFooter
          busy={op.phase === "sending"}
          disabled={!confirm || reason.trim().length < 5}
          label="Close bill as received"
          onConfirm={() => (op.phase === "uncertain" ? void op.retry() : void op.submit({ reason: reason.trim() }))}
          onCancel={onClose}
          phase={op.phase}
          error={op.error}
          conflict={conflict}
        />
      </div>
    </DialogShell>
  );
}

function VoidDialog({ bill, open, onClose }: { bill: InwardBill; open: boolean; onClose: () => void }) {
  const [code, setCode] = useState<VoidCode>("NON_STOCK");
  const [reason, setReason] = useState("");
  const [duplicateOf, setDuplicateOf] = useState(bill.duplicate_warning?.bill_ids?.[0] ?? "");
  const { op, conflict } = useResolveOp(bill, (payload) => gateBillsApi.void(bill.id, payload as Parameters<typeof gateBillsApi.void>[1]), onClose);
  useEffect(() => {
    if (!open) {
      setReason("");
      op.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const dupIds = useMemo(() => bill.duplicate_warning?.bill_ids ?? [], [bill.duplicate_warning]);
  const uuidOk = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(duplicateOf.trim());
  return (
    <DialogShell
      open={open}
      onClose={onClose}
      locked={op.locked}
      title="Resolve without a GRN"
      description="For paperwork that should not create stock. The bill and its photos are kept with your explained reason; nothing is deleted."
    >
      <div className="space-y-3">
        <fieldset className="space-y-1.5" disabled={op.locked}>
          <legend className="mb-1 text-[12px] font-semibold text-content-3">Why is no GRN needed?</legend>
          {VOID_REASONS.map((r) => (
            <label key={r.code} className={cn("flex min-h-[48px] cursor-pointer items-start gap-3 rounded-xl border px-3 py-2", code === r.code ? "border-primary bg-info-bg" : "border-line")}>
              <input type="radio" name="void-code" className="mt-1 h-4 w-4" checked={code === r.code} onChange={() => setCode(r.code)} />
              <span>
                <span className="block text-[13px] font-semibold text-content-1">{r.label}</span>
                <span className="block text-[12px] text-content-3">{r.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {code === "DUPLICATE" ? (
          <label className="block text-[12px] font-semibold text-content-3">
            Duplicate of bill (same factory)
            {dupIds.length ? (
              <select disabled={op.locked} value={duplicateOf} onChange={(e) => setDuplicateOf(e.target.value)} className={cn(fieldClass, "mt-1 font-mono")}>
                {dupIds.map((other) => (
                  <option key={other} value={other}>
                    {billRef(other)}
                  </option>
                ))}
              </select>
            ) : (
              <input disabled={op.locked} value={duplicateOf} onChange={(e) => setDuplicateOf(e.target.value)} placeholder="Paste the other bill's full ID from its page address" className={cn(fieldClass, "mt-1 font-mono")} />
            )}
          </label>
        ) : null}
        <ReasonField disabled={op.locked} value={reason} onChange={setReason} placeholder="Explain for the audit, e.g. AMC service invoice — no stock" />
        <ConfirmFooter
          busy={op.phase === "sending"}
          disabled={reason.trim().length < 5 || (code === "DUPLICATE" && !uuidOk)}
          label="Resolve without GRN"
          tone="danger"
          onConfirm={() =>
            op.phase === "uncertain"
              ? void op.retry()
              : void op.submit({ resolution_code: code, reason: reason.trim(), ...(code === "DUPLICATE" ? { duplicate_of: duplicateOf.trim() } : {}) })
          }
          onCancel={onClose}
          phase={op.phase}
          error={op.error}
          conflict={conflict}
        />
      </div>
    </DialogShell>
  );
}

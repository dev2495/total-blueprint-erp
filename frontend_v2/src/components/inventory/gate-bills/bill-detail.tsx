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
  Download,
  FileArchive,
  Loader2,
  MoreHorizontal,
  Paperclip,
  RotateCcw,
  Search,
  Unlink,
} from "lucide-react";
import { toast } from "sonner";

import { BillWorkspace } from "@/components/documents/bill-workspace";
import { inwardBillDocument } from "@/components/documents/inward-bill-document";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Panel } from "@/components/premium";
import { getApiErrorStatus } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  BILL_STATUS_META,
  FILEABLE_DOC_TYPES,
  gateBillsApi,
  RECEIPT_KIND_LABEL,
  VOID_CODE_LABEL,
  VOID_REASONS,
  type BillAction,
  type BillReceiptRef,
  type DocumentType,
  type InwardBill,
  type VoidCode,
} from "@/services/gate-bills";
import { gateErrorMessage, useGateOperation } from "@/components/gate/use-gate-operation";
import { fieldClass, labelClass } from "@/components/documents-register/shared";
import {
  BILL_POLL_MS,
  BillAccessDenied,
  SourceChip,
  StagePill,
  billDate,
  billDateTime,
  billRef,
  documentStage,
  inr,
  saveBlob,
  useDocumentAccess,
  useNowTick,
  waitingLabel,
} from "./bill-common";
import { ClassifyCard } from "./bill-classify";
import { NextStepCard, type DialogKind } from "./bill-next-step";

export function billQueryKey(id: string) {
  return ["inventory", "gate-bills", "detail", id] as const;
}

/** Shared invalidation after any receiving action (queue + counts + bell). */
export function invalidateBillViews(qc: ReturnType<typeof useQueryClient>, id?: string) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: ["inventory", "gate-bills"] }),
    id ? qc.invalidateQueries({ queryKey: billQueryKey(id) }) : Promise.resolve(),
    qc.invalidateQueries({ queryKey: ["notifications"] }),
    qc.invalidateQueries({ queryKey: ["documents"] }),
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

const can = (bill: InwardBill, action: BillAction) => Boolean(bill.allowed_actions?.includes(action));

/**
 * /inventory/gate-bills/[id]: the bill beside its work. Left pane: header,
 * classify card, next step, receipts, supporting papers, originals, timeline.
 * Right pane (or float / pop-out / phone sheet): the pages in <BillWorkspace>.
 */
export function GateBillDetail({ id }: { id: string }) {
  const access = useDocumentAccess();
  const billQ = useBill(id, access.view && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
  const now = useNowTick(15_000);
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const [headerDirty, setHeaderDirty] = useState(false);
  const bill = billQ.data;
  const doc = useMemo(() => {
    if (!bill) return null;
    const base = inwardBillDocument(bill);
    const stage = documentStage(bill);
    return {
      ...base,
      label: `Bill ${billRef(bill.id)}${bill.party_display ? ` · ${bill.party_display}` : ""}`,
      statusLabel: stage.label,
      meta: [`${bill.source === "OFFICE" ? "Uploaded" : "Arrived"} ${billDateTime(bill.arrival_at)}`, bill.plant_name, `${bill.page_count} page${bill.page_count === 1 ? "" : "s"}`].join(" · "),
    };
  }, [bill]);

  if (access.loading) return <div className="h-40 animate-pulse rounded-3xl bg-surface-2" role="status" aria-label="Loading" />;
  if (!access.view) return <BillAccessDenied />;
  const validId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  const status = validId ? getApiErrorStatus(billQ.error) : 404;
  if (validId && billQ.isLoading) return <div className="h-[60vh] animate-pulse rounded-3xl bg-surface-2" role="status" aria-label="Loading bill" />;
  if (!bill) {
    if (status === 403) return <BillAccessDenied title="You cannot open this document" />;
    return (
      <div className="mx-auto mt-10 max-w-[520px] rounded-3xl border border-line bg-surface-1 p-6 text-center" role="alert">
        <h1 className="text-lg font-semibold text-content-1">{status === 404 ? "Document not found" : "Could not load this document"}</h1>
        <p className="mt-2 text-sm text-content-3">{status === 404 ? "The link may be wrong, or the document belongs to a factory outside your access." : gateErrorMessage(billQ.error, "Check the connection and retry.")}</p>
        <div className="mt-4 flex justify-center gap-2">
          <button type="button" onClick={() => void billQ.refetch()} className="min-h-[44px] rounded-xl border border-line px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border">
            Retry
          </button>
          <Link href="/inventory/gate-bills" className="inline-flex min-h-[44px] items-center rounded-xl px-4 text-sm font-semibold text-primary">
            Back to bills & documents
          </Link>
        </div>
      </div>
    );
  }

  const open = bill.status === "PENDING_GRN" || bill.status === "PARTIAL_GRN";
  const refs = bill.receipt_refs || [];
  const overflow = [
    can(bill, "attach") ? { key: "attach" as const, label: "Attach to another bill…", icon: <Paperclip className="h-4 w-4" /> } : null,
    can(bill, "file") ? { key: "file" as const, label: "File as record…", icon: <FileArchive className="h-4 w-4" /> } : null,
    can(bill, "detach") ? { key: "detach" as const, label: "Detach from main bill…", icon: <Unlink className="h-4 w-4" /> } : null,
    can(bill, "reopen") ? { key: "reopen" as const, label: "Reopen…", icon: <RotateCcw className="h-4 w-4" /> } : null,
    can(bill, "void") ? { key: "void" as const, label: "Void…", icon: <Ban className="h-4 w-4" />, danger: true } : null,
  ].filter(Boolean) as Array<{ key: DialogKind; label: string; icon: React.ReactNode; danger?: boolean }>;

  return (
    <BillWorkspace document={doc}>
      <div className="mx-auto max-w-[900px] space-y-4 pb-10" data-testid="gate-bill-detail">
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/inventory/gate-bills" className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-2 text-[13px] font-semibold text-content-2 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border">
            <ArrowLeft className="h-4 w-4" /> Bills & documents
          </Link>
          {overflow.length ? (
            <div className="ml-auto">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-line bg-surface-1 px-3 text-[13px] font-semibold text-content-2 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border">
                    <MoreHorizontal className="h-4 w-4" aria-hidden /> More actions
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[220px]">
                  {overflow.map((item, i) => (
                    <div key={item.key}>
                      {item.danger && i > 0 ? <DropdownMenuSeparator /> : null}
                      <DropdownMenuItem onSelect={() => setDialog(item.key)} className={cn("min-h-[40px] gap-2", item.danger ? "text-danger-fg" : "")}>
                        {item.icon}
                        {item.label}
                      </DropdownMenuItem>
                    </div>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ) : null}
        </div>

        <section className="rounded-2xl border border-line bg-surface-1 p-4" aria-label="Document summary">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="min-w-0 text-[19px] font-semibold tracking-[-0.01em] text-content-1">
              Bill <span className="font-mono">{billRef(bill.id)}</span>
              {bill.party_display ? <span className="text-content-2"> · {bill.party_display}</span> : null}
            </h1>
            <StagePill bill={bill} />
            <SourceChip source={bill.source} />
          </div>
          <div className="mt-1 text-[13px] text-content-3">
            {bill.source === "OFFICE" ? "Uploaded at the office" : "Arrived at the gate"} {billDateTime(bill.arrival_at)} by {bill.created_by_name} · {bill.plant_name}
            {bill.ship_to_plant_name ? ` → shipped to ${bill.ship_to_plant_name}` : ""} · {bill.page_count} page{bill.page_count === 1 ? "" : "s"}
            {open ? ` · waiting ${waitingLabel(bill.arrival_at, now)}` : ""}
          </div>
          {bill.attached_to ? (
            <p className="mt-2 rounded-xl border border-info-border bg-info-bg px-3 py-2 text-[13px] text-content-1">
              Supporting paper of{" "}
              <Link href={`/inventory/gate-bills/${bill.attached_to.id}`} className="font-mono font-semibold text-primary hover:underline">
                {bill.attached_to.ref}
              </Link>
              {bill.attached_to.party_display ? ` · ${bill.attached_to.party_display}` : ""}
              {bill.attached_to.invoice_number ? ` · Inv ${bill.attached_to.invoice_number}` : ""}
            </p>
          ) : null}
          {billQ.isError ? (
            <p role="status" className="mt-2 inline-flex flex-wrap items-center gap-1 text-[12px] font-medium text-danger-fg">
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> Live refresh failed — showing the last loaded state.
              <button type="button" onClick={() => void billQ.refetch()} className="underline">Retry</button>
            </p>
          ) : null}
        </section>

        <DuplicateNotices bill={bill} />

        <ClassifyCard bill={bill} editable={can(bill, "classify")} onDirtyChange={setHeaderDirty} />

        <NextStepCard bill={bill} headerDirty={headerDirty} onDialog={setDialog} />

        <Panel title="Receipts linked" description={refs.length ? undefined : "Nothing received against this document yet."}>
          {refs.length ? <ReceiptList refs={refs} /> : null}
        </Panel>

        {bill.supporting_documents?.length ? (
          <Panel title="Supporting papers" description="Transport LRs and other papers filed under this bill.">
            <ul className="divide-y divide-line">
              {bill.supporting_documents.map((row) => (
                <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
                  <span className="min-w-0">
                    <Link href={`/inventory/gate-bills/${row.id}`} className="font-mono text-[13px] font-semibold text-primary hover:underline">{row.ref}</Link>
                    <span className="text-[13px] text-content-2"> · {row.doc_type_label || "Document"}{row.party_display ? ` · ${row.party_display}` : ""}</span>
                    <span className="block text-[12px] text-content-3">{row.invoice_number ? `No. ${row.invoice_number} · ` : ""}{row.page_count ?? "—"} page{row.page_count === 1 ? "" : "s"}</span>
                  </span>
                  <span className="text-[13px] font-semibold tabular-nums text-content-1">{inr(row.total_amount)}</span>
                </li>
              ))}
            </ul>
          </Panel>
        ) : null}

        {bill.original_files?.length ? <OriginalFiles bill={bill} /> : null}

        <Panel title="Timeline">
          <Timeline bill={bill} />
        </Panel>
      </div>

      <MatchDialog bill={bill} open={dialog === "match"} onClose={() => setDialog(null)} />
      <CompleteDialog bill={bill} open={dialog === "complete"} onClose={() => setDialog(null)} />
      <VoidDialog bill={bill} open={dialog === "void"} onClose={() => setDialog(null)} />
      <FileDialog bill={bill} open={dialog === "file"} onClose={() => setDialog(null)} />
      <AttachDialog bill={bill} open={dialog === "attach"} onClose={() => setDialog(null)} />
      <ReasonDialog
        bill={bill}
        open={dialog === "reopen"}
        onClose={() => setDialog(null)}
        title="Reopen document"
        description="Moves it back to “waiting” so it can be classified and handled again. The filing or void stays in the audit history."
        confirmLabel="Reopen"
        placeholder="e.g. Filed under the wrong category — it is a spares bill"
        send={(payload) => gateBillsApi.reopen(bill.id, payload)}
      />
      <ReasonDialog
        bill={bill}
        open={dialog === "detach"}
        onClose={() => setDialog(null)}
        title="Detach from main bill"
        description="The paper becomes a separate waiting document again. The attachment stays in the audit history of both bills."
        confirmLabel="Detach"
        placeholder="e.g. LR belongs to a different delivery"
        send={(payload) => gateBillsApi.detach(bill.id, payload)}
      />
    </BillWorkspace>
  );
}

function DuplicateNotices({ bill }: { bill: InwardBill }) {
  const sameInvoice = bill.duplicate_candidates ?? [];
  const samePhotos = bill.duplicate_warning?.possible_duplicate ? bill.duplicate_warning.bill_ids : [];
  if (!sameInvoice.length && !samePhotos.length) return null;
  return (
    <div className="space-y-2" role="status">
      {sameInvoice.length ? (
        <div className="rounded-2xl border border-warning-border bg-warning-bg px-4 py-3 text-[13px] text-content-1">
          <span className="font-semibold text-warning-fg">Same invoice already recorded.</span> {bill.invoice_number} from {bill.party_display} is also on{" "}
          {sameInvoice.map((row, i) => (
            <span key={row.id}>
              {i ? ", " : ""}
              <Link href={`/inventory/gate-bills/${row.id}`} className="font-mono font-semibold text-primary hover:underline">{row.ref}</Link> ({row.plant_name}, {BILL_STATUS_META[row.status]?.label.toLowerCase() ?? row.status})
            </span>
          ))}
          . If it is the same paper, void this one as a duplicate. Filing or receiving it anyway needs a reason.
        </div>
      ) : null}
      {samePhotos.length ? (
        <div className="rounded-2xl border border-warning-border bg-warning-bg px-4 py-3 text-[13px] text-content-1">
          <span className="font-semibold text-warning-fg">Same photos uploaded before</span> at this factory:{" "}
          {samePhotos.map((other, i) => (
            <span key={other}>
              {i ? ", " : ""}
              <Link href={`/inventory/gate-bills/${other}`} className="font-mono font-semibold text-primary hover:underline">{billRef(other)}</Link>
            </span>
          ))}
          .
        </div>
      ) : null}
    </div>
  );
}

function OriginalFiles({ bill }: { bill: InwardBill }) {
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <Panel title="Original files" description="The PDF exactly as it was uploaded. The pages beside the form are images made from it.">
      <ul className="divide-y divide-line">
        {(bill.original_files ?? []).map((file) => (
          <li key={file.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-semibold text-content-1">{file.file_name}</span>
              <span className="block text-[12px] text-content-3">
                {file.page_count} page{file.page_count === 1 ? "" : "s"} · {(file.byte_size / 1024 / 1024).toFixed(2)} MB · {billDateTime(file.created_at)}
              </span>
            </span>
            <button
              type="button"
              disabled={busy === file.id}
              onClick={async () => {
                setBusy(file.id);
                try {
                  saveBlob(await gateBillsApi.originalBlob(file.download_url), file.file_name);
                } catch (error) {
                  toast.error(gateErrorMessage(error, "Could not download the original."));
                } finally {
                  setBusy(null);
                }
              }}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-line px-3 text-[13px] font-semibold text-content-1 hover:bg-surface-2 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border"
            >
              {busy === file.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function ReceiptList({ refs }: { refs: BillReceiptRef[] }) {
  return (
    <ul className="divide-y divide-line">
      {refs.map((ref) => {
        const reversed = ref.receipt_status === "REVERSED";
        const label = (
          <>
            {RECEIPT_KIND_LABEL[ref.kind] ?? ref.kind} · <span className="font-mono">{ref.reference || ref.id.slice(0, 8)}</span>
          </>
        );
        return (
          <li key={`${ref.kind}-${ref.id}`} className="py-2.5 first:pt-0 last:pb-0">
            <div className="flex items-center justify-between gap-2">
              <span className={cn("truncate text-[13px] font-semibold", reversed ? "text-content-3 line-through" : "text-content-1")}>
                {ref.kind === "GENERAL_RECEIPT" ? (
                  <Link href={`/inventory/general-receipts/${ref.id}`} className="hover:underline">{label}</Link>
                ) : (
                  label
                )}
              </span>
              <span className="shrink-0 text-[13px] tabular-nums text-content-2">
                {ref.quantities_by_uom && Object.keys(ref.quantities_by_uom).length
                  ? Object.entries(ref.quantities_by_uom).map(([uom, quantity]) => `${quantity} ${uom}`).join(" · ")
                  : `${ref.quantity ?? "—"} ${ref.uom ?? ""}`}
              </span>
            </div>
            <div className="mt-0.5 truncate text-[12px] text-content-3">
              {ref.vendor_name || "Vendor —"} · Inv {ref.invoice_number || "—"} · Posted {billDateTime(ref.received_at)}
              {ref.quality_status && ref.kind !== "GENERAL_RECEIPT" ? ` · QC ${String(ref.quality_status).toLowerCase()}` : ""}
            </div>
            {reversed ? <div className="mt-1 text-[12px] font-semibold text-danger-fg">Reversed — kept here for history. Record a new receipt if the items were received.</div> : null}
          </li>
        );
      })}
    </ul>
  );
}

const ACTION_LABEL: Record<string, string> = {
  BILL_ARRIVED: "Photographed at the gate",
  BILL_OFFICE_UPLOADED: "Uploaded at the office",
  BILL_REVIEWED: "GRN details saved",
  BILL_CLASSIFIED: "Details / category saved",
  BILL_LINKED: "Receipt linked",
  BILL_RECEIPTED: "Confirmed all lines received",
  BILL_FILED: "Filed as a record",
  BILL_ATTACHED: "Attached to another bill",
  BILL_SUPPORT_ADDED: "Supporting paper attached",
  BILL_SUPPORT_REMOVED: "Supporting paper removed",
  BILL_DETACHED: "Detached from main bill",
  BILL_REOPENED: "Reopened",
  BILL_VOIDED: "Voided",
  NON_STOCK_FOLLOWUP: "General receipt recorded for the old non-stock void",
  BILL_REF_REVERSED: "Linked general receipt reversed",
};

function Timeline({ bill }: { bill: InwardBill }) {
  const events = bill.timeline ?? [];
  const closed = bill.status === "RECEIPTED" || bill.status === "FILED" || bill.status === "VOID";
  return (
    <ol className="space-y-3">
      {events.map((event) => (
        <li key={event.id} className="flex gap-3">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success-fg" aria-hidden />
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-content-1">{ACTION_LABEL[event.action] ?? event.action.replace(/_/g, " ").toLowerCase()}</div>
            <div className="text-[12px] text-content-3">
              {billDateTime(event.created_at)}
              {event.actor_name ? ` · ${event.actor_name}` : ""}
              {event.reason ? ` · “${event.reason}”` : ""}
            </div>
          </div>
        </li>
      ))}
      {!closed ? (
        <li className="flex gap-3">
          <Circle className="mt-0.5 h-4 w-4 shrink-0 text-content-4" aria-hidden />
          <div className="text-[13px] font-semibold text-content-3">{bill.status === "PARTIAL_GRN" ? "Waiting for confirmation that every line is received" : "Waiting for the next step"}</div>
        </li>
      ) : null}
      {bill.status === "VOID" && bill.resolution_code ? <li className="text-[12px] text-content-3">Void reason: {VOID_CODE_LABEL[bill.resolution_code] ?? bill.resolution_code}</li> : null}
    </ol>
  );
}

/* ------------------------------------------------------------------ */
/* Dialogs                                                             */
/* ------------------------------------------------------------------ */

export function OpStatus({ phase, error, savedText, conflict }: { phase: string; error: unknown; savedText: string; conflict?: boolean }) {
  if (phase === "saved") return <span role="status" className="text-[12px] font-medium text-success-fg">{savedText}</span>;
  if (conflict) return <span role="alert" className="text-[12px] font-medium text-warning-fg">{gateErrorMessage(error, "Someone else changed this document — refreshed. Check and try again.")}</span>;
  if (phase === "rejected") return <span role="alert" className="text-[12px] font-medium text-danger-fg">{gateErrorMessage(error)}</span>;
  if (phase === "uncertain") return <span role="alert" className="text-[12px] font-medium text-warning-fg">Not confirmed: {gateErrorMessage(error)} Retrying sends the same request.</span>;
  return null;
}

function ConfirmFooter({ busy, disabled, label, onConfirm, onCancel, phase, error, conflict, tone }: { busy: boolean; disabled: boolean; label: string; onConfirm: () => void; onCancel: () => void; phase: string; error: unknown; conflict: boolean; tone?: "danger" }) {
  return (
    <div className="space-y-2 border-t border-line pt-3">
      <OpStatus phase={phase} error={error} savedText="Saved" conflict={conflict} />
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={busy || phase === "uncertain"} className="min-h-[44px] rounded-xl border border-line px-4 text-[13px] font-semibold text-content-2 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border">
          Cancel
        </button>
        <button type="button" onClick={onConfirm} disabled={disabled || busy} className={cn("inline-flex min-h-[44px] items-center gap-2 rounded-xl px-4 text-[13px] font-semibold text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border", tone === "danger" ? "bg-danger-solid" : "bg-primary")}>
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

function ReasonField({ value, onChange, placeholder, disabled, label = "Reason (recorded in the audit, 5–500 characters)", optional }: { value: string; onChange: (v: string) => void; placeholder: string; disabled?: boolean; label?: string; optional?: boolean }) {
  const short = !optional && value.trim().length > 0 && value.trim().length < 5;
  return (
    <label className={labelClass}>
      {label}
      <textarea disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)} rows={2} maxLength={500} placeholder={placeholder} className={cn(fieldClass, "mt-1 h-auto py-2")} aria-invalid={short || undefined} />
      {short ? <span className="mt-1 block text-danger-fg">At least 5 characters.</span> : null}
    </label>
  );
}

function MatchDialog({ bill, open, onClose }: { bill: InwardBill; open: boolean; onClose: () => void }) {
  const [search, setSearch] = useState(String(bill.invoice_number || bill.review_data?.invoice_number || ""));
  const [selected, setSelected] = useState<BillReceiptRef[]>([]);
  const [reason, setReason] = useState("");
  const [complete, setComplete] = useState(false);
  const vendorFilter = bill.vendor || (bill.review_data?.vendor_id ? String(bill.review_data.vendor_id) : undefined);
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
    <DialogShell open={open} onClose={onClose} locked={op.locked} title="Match an existing receipt" description="Link GRNs, PO receipts or general receipts already posted at this factory. Matching never posts or changes stock.">
      {saved ? (
        <div className="space-y-3 py-2 text-[14px]">
          <p className="font-semibold text-success-fg">Linked {selected.length} receipt{selected.length === 1 ? "" : "s"}. The bill is now {BILL_STATUS_META[op.result?.status ?? "PARTIAL_GRN"]?.label.toLowerCase()}.</p>
          <button type="button" onClick={onClose} className="min-h-[44px] rounded-xl bg-primary px-4 text-[13px] font-semibold text-white">Done</button>
        </div>
      ) : (
        <div className="space-y-3">
          <label className="relative block">
            <span className="sr-only">Search invoice number or receipt number</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-4" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Invoice no. or receipt no." className={cn(fieldClass, "pl-9")} disabled={op.locked} />
          </label>
          {vendorFilter ? <p className="text-[12px] text-content-3">Showing receipts from this bill’s vendor only.</p> : null}
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
                        <input type="checkbox" className="mt-1 h-5 w-5" checked={checked} disabled={blocked || op.locked} onChange={() => toggle(ref)} />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-[13px] font-semibold text-content-1">{RECEIPT_KIND_LABEL[ref.kind] ?? ref.kind} · <span className="font-mono">{ref.reference}</span></span>
                            <span className="text-[13px] tabular-nums text-content-2">
                              {ref.quantities_by_uom && Object.keys(ref.quantities_by_uom).length ? Object.entries(ref.quantities_by_uom).map(([uom, quantity]) => `${quantity} ${uom}`).join(" · ") : `${ref.quantity ?? "—"} ${ref.uom ?? ""}`}
                            </span>
                          </span>
                          <span className="block truncate text-[12px] text-content-3">{ref.vendor_name} · Inv {ref.invoice_number || "—"} · {billDateTime(ref.received_at)}{blocked ? " · different vendor" : ""}</span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="p-4 text-[13px] text-content-3">No unlinked receipts found for this factory{search ? " matching this search" : ""}.</div>
            )}
          </div>
          <ReasonField disabled={op.locked} value={reason} onChange={setReason} placeholder="e.g. GRN posted from the PO before the photo was reviewed" />
          <label className="flex min-h-[44px] items-start gap-3 rounded-xl border border-line px-3 py-2.5 text-[13px] text-content-2">
            <input type="checkbox" className="mt-0.5 h-5 w-5" checked={complete} onChange={(e) => setComplete(e.target.checked)} disabled={op.locked} />
            <span><span className="font-semibold text-content-1">These receipts cover every line on the bill</span> — close it as received. Leave unticked if more receipts are still needed.</span>
          </label>
          <ConfirmFooter
            busy={op.phase === "sending"}
            disabled={!selected.length || reason.trim().length < 5}
            label={`Link ${selected.length || ""} receipt${selected.length === 1 ? "" : "s"}${complete ? " & close" : ""}`}
            onConfirm={() => (op.phase === "uncertain" ? void op.retry() : void op.submit({ receipt_refs: selected.map((r) => ({ kind: r.kind, id: r.id })), reason: reason.trim(), bill_complete: complete }))}
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
  return (
    <DialogShell open={open} onClose={onClose} locked={op.locked} title="Confirm all bill lines received" description="Closes the bill as received. Nothing is posted by this step.">
      <div className="space-y-3">
        <div className="rounded-xl border border-line p-3"><ReceiptList refs={bill.receipt_refs || []} /></div>
        <ReasonField disabled={op.locked} value={reason} onChange={setReason} placeholder="e.g. All lines received across 2 GRNs" />
        <label className="flex min-h-[44px] items-start gap-3 rounded-xl border border-success-border bg-success-bg px-3 py-2.5 text-[13px] text-content-1">
          <input type="checkbox" className="mt-0.5 h-5 w-5" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} disabled={op.locked} />
          I checked the bill: every line on it is covered by the receipts above.
        </label>
        <ConfirmFooter busy={op.phase === "sending"} disabled={!confirm || reason.trim().length < 5} label="Close bill as received" onConfirm={() => (op.phase === "uncertain" ? void op.retry() : void op.submit({ reason: reason.trim() }))} onCancel={onClose} phase={op.phase} error={op.error} conflict={conflict} />
      </div>
    </DialogShell>
  );
}

function VoidDialog({ bill, open, onClose }: { bill: InwardBill; open: boolean; onClose: () => void }) {
  const [code, setCode] = useState<VoidCode>("DUPLICATE");
  const [reason, setReason] = useState("");
  const options = useMemo(() => {
    const rows = (bill.duplicate_candidates ?? []).map((row) => ({ id: row.id, label: `${row.ref} · ${row.plant_name} · ${BILL_STATUS_META[row.status]?.label ?? row.status}` }));
    for (const other of bill.duplicate_warning?.bill_ids ?? []) if (!rows.some((r) => r.id === other)) rows.push({ id: other, label: `${billRef(other)} · same photos` });
    return rows;
  }, [bill.duplicate_candidates, bill.duplicate_warning]);
  const [duplicateOf, setDuplicateOf] = useState("");
  const { op, conflict } = useResolveOp(bill, (payload) => gateBillsApi.void(bill.id, payload as Parameters<typeof gateBillsApi.void>[1]), onClose);
  useEffect(() => {
    if (open) {
      setDuplicateOf(options[0]?.id ?? "");
      setCode(options.length ? "DUPLICATE" : "UNREADABLE");
    } else {
      setReason("");
      op.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const uuidOk = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(duplicateOf.trim());
  return (
    <DialogShell open={open} onClose={onClose} locked={op.locked} title="Void this document" description="For paper that should not be received or filed. The pages and your reason are kept; nothing is deleted. Non-stock bills are not voided — record a General Receipt or file them.">
      <div className="space-y-3">
        <fieldset className="space-y-1.5" disabled={op.locked}>
          <legend className="mb-1 text-[12px] font-semibold text-content-3">Why void it?</legend>
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
          options.length ? (
            <label className={labelClass}>
              Duplicate of
              <select disabled={op.locked} value={duplicateOf} onChange={(e) => setDuplicateOf(e.target.value)} className={cn(fieldClass, "mt-1 font-mono")}>
                {options.map((row) => <option key={row.id} value={row.id}>{row.label}</option>)}
              </select>
            </label>
          ) : (
            <div className={labelClass}>
              Duplicate of
              <DuplicatePicker billId={bill.id} disabled={op.locked} value={duplicateOf} onChange={setDuplicateOf} />
            </div>
          )
        ) : null}
        <ReasonField disabled={op.locked} value={reason} onChange={setReason} placeholder="Explain for the audit, e.g. Same courier copy as the gate photo" />
        <ConfirmFooter
          busy={op.phase === "sending"}
          disabled={reason.trim().length < 5 || (code === "DUPLICATE" && !uuidOk)}
          label="Void document"
          tone="danger"
          onConfirm={() => (op.phase === "uncertain" ? void op.retry() : void op.submit({ resolution_code: code, reason: reason.trim(), ...(code === "DUPLICATE" ? { duplicate_of: duplicateOf.trim() } : {}) }))}
          onCancel={onClose}
          phase={op.phase}
          error={op.error}
          conflict={conflict}
        />
      </div>
    </DialogShell>
  );
}

/** Find the original document by bill number, party or vendor when no duplicate was detected automatically. */
function DuplicatePicker({ billId, value, onChange, disabled }: { billId: string; value: string; onChange: (id: string) => void; disabled?: boolean }) {
  const [term, setTerm] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const handle = window.setTimeout(() => setQuery(term.trim()), 300);
    return () => window.clearTimeout(handle);
  }, [term]);
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(query);
  const results = useQuery({
    queryKey: ["gate-bill-duplicate-search", query],
    queryFn: () => gateBillsApi.list({ status: "ALL", search: query, page_size: 8 }),
    enabled: query.length >= 2 && !isUuid,
    staleTime: 15_000,
  });
  useEffect(() => {
    if (isUuid && query.toLowerCase() !== billId.toLowerCase()) onChange(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isUuid, query]);
  const rows = (results.data?.results ?? []).filter((row) => row.id !== billId);
  return (
    <div className="mt-1 space-y-2">
      <input
        disabled={disabled}
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Search the original by bill number, party or vendor"
        aria-label="Search for the original document"
        className={fieldClass}
      />
      {query.length >= 2 && !isUuid ? (
        results.isLoading ? (
          <span className="block text-[12px] text-content-3">Searching…</span>
        ) : results.isError ? (
          <span className="block text-[12px] text-danger-fg">Search failed. {gateErrorMessage(results.error, "Try again.")}</span>
        ) : rows.length === 0 ? (
          <span className="block text-[12px] text-content-3">No other document matches “{query}”.</span>
        ) : (
          <div role="radiogroup" aria-label="Original document" className="space-y-1.5">
            {rows.map((row) => (
              <label key={row.id} className={cn("flex min-h-[44px] cursor-pointer items-start gap-3 rounded-xl border px-3 py-2", value === row.id ? "border-primary bg-info-bg" : "border-line")}>
                <input type="radio" name="duplicate-of" className="mt-1 h-4 w-4" checked={value === row.id} onChange={() => onChange(row.id)} disabled={disabled} />
                <span className="text-[12.5px] text-content-1">
                  <span className="font-mono font-semibold">{billRef(row.id)}</span> · {row.party_display || "No party yet"} · {row.invoice_number || "no bill no."} · {row.plant_name}
                  <span className="block text-[11.5px] text-content-3">{BILL_STATUS_META[row.status]?.label ?? row.status}</span>
                </span>
              </label>
            ))}
          </div>
        )
      ) : (
        <span className="block text-[11.5px] text-content-3">Type at least 2 characters, or paste the other document&apos;s full ID.</span>
      )}
    </div>
  );
}

function FileDialog({ bill, open, onClose }: { bill: InwardBill; open: boolean; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [override, setOverride] = useState("");
  const [originalRef, setOriginalRef] = useState(bill.original_invoice_ref ?? "");
  const { op, conflict } = useResolveOp(bill, (payload) => gateBillsApi.file(bill.id, payload as Parameters<typeof gateBillsApi.file>[1]), onClose);
  useEffect(() => {
    if (!open) {
      setReason("");
      setOverride("");
      op.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const missing = [
    !(bill.vendor || bill.party_name) ? "vendor or party" : null,
    !bill.invoice_number ? "bill number" : null,
    !bill.invoice_date ? "bill date" : null,
    !bill.total_amount ? "bill total" : null,
  ].filter(Boolean) as string[];
  const duplicates = bill.duplicate_candidates ?? [];
  const note = bill.doc_type === "DEBIT_NOTE" || bill.doc_type === "CREDIT_NOTE";
  const eligible = Boolean(bill.allowed_actions?.includes("file")) || FILEABLE_DOC_TYPES.includes(bill.doc_type as DocumentType);
  return (
    <DialogShell open={open} onClose={onClose} locked={op.locked} title="File as a record" description="For paper with nothing to receive: utility bills, fees, transport, debit / credit notes. It leaves the inbox and stays searchable under Filed.">
      <div className="space-y-3">
        {!eligible ? <p role="alert" className="rounded-xl border border-warning-border bg-warning-bg px-3 py-2 text-[13px]">Choose a record-only category (utility, fee, transport, other expense) or a note / report document type first.</p> : null}
        {missing.length ? (
          <p role="alert" className="rounded-xl border border-warning-border bg-warning-bg px-3 py-2 text-[13px] text-content-1">Save the {missing.join(", ")} in the details card before filing.</p>
        ) : (
          <dl className="grid grid-cols-2 gap-2 rounded-xl border border-line p-3 text-[13px]">
            <dt className="text-content-3">Party</dt>
            <dd className="font-medium text-content-1">{bill.party_display}</dd>
            <dt className="text-content-3">Bill no. · date</dt>
            <dd className="font-mono text-content-1">{bill.invoice_number} · {billDate(bill.invoice_date)}</dd>
            <dt className="text-content-3">Total</dt>
            <dd className="tabular-nums text-content-1">{inr(bill.total_amount)}</dd>
            {bill.due_date ? (
              <>
                <dt className="text-content-3">Due</dt>
                <dd className="text-content-1">{billDate(bill.due_date)} (reminder from 3 days before)</dd>
              </>
            ) : null}
            {bill.valid_until ? (
              <>
                <dt className="text-content-3">Valid until</dt>
                <dd className="text-content-1">{billDate(bill.valid_until)} (reminders at 60 / 30 / 7 / 0 days)</dd>
              </>
            ) : null}
          </dl>
        )}
        {note ? (
          <label className={labelClass}>
            Original invoice number (optional)
            <input value={originalRef} onChange={(e) => setOriginalRef(e.target.value)} maxLength={80} disabled={op.locked} className={cn(fieldClass, "mt-1 font-mono")} placeholder="The invoice this note adjusts" />
          </label>
        ) : null}
        <ReasonField optional label="Note for the record (optional)" disabled={op.locked} value={reason} onChange={setReason} placeholder="e.g. Monthly HT power bill — passed to accounts" />
        {duplicates.length ? (
          <div className="space-y-2 rounded-xl border border-warning-border bg-warning-bg p-3">
            <p className="text-[13px] text-content-1"><b>The same invoice is already recorded</b> on {duplicates.map((d) => d.ref).join(", ")}. Void this one as a duplicate instead, or give a reason to file it anyway.</p>
            <ReasonField disabled={op.locked} value={override} onChange={setOverride} label="Reason to file it anyway" placeholder="e.g. Supplementary bill issued with the same number" />
          </div>
        ) : null}
        <ConfirmFooter
          busy={op.phase === "sending"}
          disabled={!eligible || missing.length > 0 || (duplicates.length > 0 && override.trim().length < 5)}
          label="File as record"
          onConfirm={() =>
            op.phase === "uncertain"
              ? void op.retry()
              : void op.submit({
                  ...(reason.trim() ? { reason: reason.trim() } : {}),
                  header_version: bill.header_version,
                  ...(note && originalRef.trim() ? { original_invoice_ref: originalRef.trim() } : {}),
                  ...(duplicates.length ? { duplicate_override_reason: override.trim() } : {}),
                })
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

function AttachDialog({ bill, open, onClose }: { bill: InwardBill; open: boolean; onClose: () => void }) {
  const [search, setSearch] = useState("");
  const [target, setTarget] = useState<InwardBill | null>(null);
  const [reason, setReason] = useState("");
  const listQ = useQuery({
    queryKey: ["inventory", "gate-bills", "attach-targets", bill.plant, search.trim()],
    queryFn: () => gateBillsApi.list({ status: "ALL", plant: bill.plant, search: search.trim() || undefined, ordering: "-arrival_at", page_size: 25 }),
    enabled: open,
    meta: { suppressGlobalError: true },
  });
  const { op, conflict } = useResolveOp(bill, (payload) => gateBillsApi.attach(bill.id, payload as Parameters<typeof gateBillsApi.attach>[1]), onClose);
  useEffect(() => {
    if (!open) {
      setTarget(null);
      setReason("");
      op.reset();
    } else if (bill.doc_type === "LR_TRANSPORT") {
      setReason((current) => current || "Transport LR for this delivery");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const rows = (listQ.data?.results ?? []).filter((row) => row.id !== bill.id && row.status !== "VOID" && !row.attached_to);
  return (
    <DialogShell open={open} onClose={onClose} locked={op.locked} title="Attach to another bill" description={`Files this paper under the main bill of the same delivery (same factory: ${bill.plant_name}). It stays viewable from that bill, with its amount listed there.`}>
      <div className="space-y-3">
        <label className="relative block">
          <span className="sr-only">Search the main bill</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-4" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search invoice no., party or bill ref" className={cn(fieldClass, "pl-9")} disabled={op.locked} />
        </label>
        <div className="max-h-[40vh] overflow-y-auto rounded-xl border border-line" role="radiogroup" aria-label="Main bill">
          {listQ.isLoading ? (
            <div className="p-4 text-[13px] text-content-3">Loading bills…</div>
          ) : listQ.isError ? (
            <div className="p-4 text-[13px] text-danger-fg">Could not load bills. {gateErrorMessage(listQ.error)}</div>
          ) : rows.length ? (
            <ul className="divide-y divide-line">
              {rows.map((row) => (
                <li key={row.id}>
                  <label className={cn("flex min-h-[56px] cursor-pointer items-start gap-3 px-3 py-2.5", target?.id === row.id ? "bg-info-bg" : "hover:bg-surface-2")}>
                    <input type="radio" name="attach-target" className="mt-1 h-4 w-4" checked={target?.id === row.id} onChange={() => setTarget(row)} disabled={op.locked} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold text-content-1"><span className="font-mono">{billRef(row.id)}</span> · {row.party_display || "Party not entered"}</span>
                      <span className="block truncate text-[12px] text-content-3">{row.invoice_number ? `Inv ${row.invoice_number} · ` : ""}{billDateTime(row.arrival_at)} · {BILL_STATUS_META[row.status]?.label}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-4 text-[13px] text-content-3">No other bill at {bill.plant_name}{search ? " matches this search" : ""}.</div>
          )}
        </div>
        <ReasonField disabled={op.locked} value={reason} onChange={setReason} placeholder="e.g. Transport LR for the 6 film rolls on invoice S1001 (freight to pay)" />
        <ConfirmFooter busy={op.phase === "sending"} disabled={!target || reason.trim().length < 5} label="Attach and file" onConfirm={() => (op.phase === "uncertain" ? void op.retry() : target ? void op.submit({ target_bill_id: target.id, reason: reason.trim() }) : undefined)} onCancel={onClose} phase={op.phase} error={op.error} conflict={conflict} />
      </div>
    </DialogShell>
  );
}

function ReasonDialog({ bill, open, onClose, title, description, confirmLabel, placeholder, send }: { bill: InwardBill; open: boolean; onClose: () => void; title: string; description: string; confirmLabel: string; placeholder: string; send: (payload: { client_token: string; reason: string }) => Promise<InwardBill> }) {
  const [reason, setReason] = useState("");
  const { op, conflict } = useResolveOp(bill, (payload) => send(payload as { client_token: string; reason: string }), onClose);
  useEffect(() => {
    if (!open) {
      setReason("");
      op.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return (
    <DialogShell open={open} onClose={onClose} locked={op.locked} title={title} description={description}>
      <div className="space-y-3">
        <ReasonField disabled={op.locked} value={reason} onChange={setReason} placeholder={placeholder} />
        <ConfirmFooter busy={op.phase === "sending"} disabled={reason.trim().length < 5} label={confirmLabel} onConfirm={() => (op.phase === "uncertain" ? void op.retry() : void op.submit({ reason: reason.trim() }))} onCancel={onClose} phase={op.phase} error={op.error} conflict={conflict} />
      </div>
    </DialogShell>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Printer, Undo2 } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Panel } from "@/components/premium";
import { getApiErrorStatus } from "@/lib/api";
import { cn } from "@/lib/utils";
import { gateErrorMessage, useGateOperation } from "@/components/gate/use-gate-operation";
import { BillAccessDenied, TonePill, billDate, billDateTime, inr, useDocumentAccess } from "@/components/inventory/gate-bills/bill-common";
import { generalReceiptsApi, type GeneralReceipt } from "@/services/general-receipts";
import { ErrorBanner, fieldClass, labelClass } from "./shared";

export function generalReceiptKey(id: string) {
  return ["general-receipts", "detail", id] as const;
}

/** /inventory/general-receipts/[id]: read-only receipt, print layout and Owner/Admin reversal. */
export function GeneralReceiptDetail({ id }: { id: string }) {
  const access = useDocumentAccess();
  const q = useQuery({
    queryKey: generalReceiptKey(id),
    queryFn: () => generalReceiptsApi.get(id),
    enabled: access.view && Boolean(id),
    retry: (count, error) => ![403, 404].includes(getApiErrorStatus(error) ?? 0) && count < 2,
    meta: { suppressGlobalError: true },
  });
  const [reverseOpen, setReverseOpen] = useState(false);

  if (access.loading) return <div className="h-40 animate-pulse rounded-3xl bg-surface-2" role="status" aria-label="Loading" />;
  if (!access.view) return <BillAccessDenied title="General receipts are for the Inventory team" />;
  if (q.isLoading) return <div className="h-[50vh] animate-pulse rounded-3xl bg-surface-2" role="status" aria-label="Loading receipt" />;
  const receipt = q.data;
  if (!receipt) {
    const status = id ? getApiErrorStatus(q.error) : 404;
    return (
      <div className="mx-auto mt-10 max-w-[560px] space-y-3">
        {status === 404 ? (
          <div className="rounded-3xl border border-line bg-surface-1 p-6 text-center" role="alert">
            <h1 className="text-lg font-semibold text-content-1">General receipt not found</h1>
            <p className="mt-2 text-sm text-content-3">The link may be wrong, or the receipt belongs to a factory outside your access.</p>
          </div>
        ) : (
          <ErrorBanner error={q.error} onRetry={() => void q.refetch()} title="Could not load this general receipt." />
        )}
        <Link href="/inventory/general-receipts" className="inline-flex min-h-[44px] items-center text-sm font-semibold text-primary">Back to general receipts</Link>
      </div>
    );
  }
  const reversed = receipt.status === "REVERSED";
  return (
    <div className="mx-auto max-w-[1100px] space-y-4 print:max-w-none print:space-y-2" data-testid="general-receipt-detail">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <Link href="/inventory/general-receipts" className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-2 text-[13px] font-semibold text-content-2 hover:bg-surface-2">
          <ArrowLeft className="h-4 w-4" /> General receipts
        </Link>
        <div className="ml-auto flex flex-wrap gap-2">
          <button type="button" onClick={() => window.print()} className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-line bg-surface-1 px-3 text-[13px] font-semibold text-content-1 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border">
            <Printer className="h-4 w-4" /> Print
          </button>
          {access.master && receipt.status === "POSTED" ? (
            <button type="button" onClick={() => setReverseOpen(true)} className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-danger-border bg-surface-1 px-3 text-[13px] font-semibold text-danger-fg hover:bg-danger-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border">
              <Undo2 className="h-4 w-4" /> Reverse…
            </button>
          ) : null}
        </div>
      </div>

      <section className="rounded-2xl border border-line bg-surface-1 p-4 print:border-0 print:p-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-content-3">General receipt · {receipt.receipt_type_label}</div>
            <h1 className="font-mono text-[22px] font-semibold text-content-1">{receipt.number}</h1>
            <div className="text-[13px] text-content-3">{receipt.plant_name}</div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <TonePill tone={reversed ? "danger" : "good"}>{reversed ? "Reversed" : "Posted"}</TonePill>
            <span className="text-[12px] text-content-3">No stock posted</span>
          </div>
        </div>
        {reversed ? (
          <p role="status" className="mt-3 rounded-xl border border-danger-border bg-danger-bg px-3 py-2 text-[13px] text-content-1">
            Reversed {billDateTime(receipt.reversed_at)} by {receipt.reversed_by_name}: “{receipt.reversal_reason}”. It stays linked to its bill for history.
          </p>
        ) : null}
        <dl className="mt-4 grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Party">{receipt.vendor_name || receipt.party_name}{receipt.vendor_code ? <span className="text-content-3"> ({receipt.vendor_code})</span> : null}</Field>
          <Field label="Bill / invoice">{receipt.invoice_number ? <span className="font-mono">{receipt.invoice_number}</span> : "—"}{receipt.invoice_date ? ` · ${billDate(receipt.invoice_date)}` : ""}</Field>
          <Field label="Bill in register">
            {receipt.document ? (
              <Link href={`/inventory/gate-bills/${receipt.document.id}`} className="font-mono font-semibold text-primary hover:underline print:text-content-1 print:no-underline">{receipt.document.ref}</Link>
            ) : (
              "Not linked yet"
            )}
            {receipt.document?.followup ? <span className="text-content-3"> (follow-up of an old non-stock void)</span> : null}
          </Field>
          <Field label={receipt.receipt_type === "SERVICE" ? "Work confirmed by" : "Received by"}>{receipt.received_by_name}</Field>
          <Field label={receipt.receipt_type === "SERVICE" ? "Confirmed at" : "Received at"}>{billDateTime(receipt.received_at)}</Field>
          <Field label="Recorded by">{receipt.created_by_name} · {billDateTime(receipt.created_at)}</Field>
          {receipt.reference ? <Field label="PO / work order">{receipt.reference}</Field> : null}
          {receipt.notes ? <Field label="Note">{receipt.notes}</Field> : null}
        </dl>
      </section>

      <Panel title="Lines" className="print:border-0 print:shadow-none">
        <div className="space-y-2 lg:hidden print:hidden">
          {receipt.lines.map((line) => (
            <div key={line.id} className="rounded-xl border border-line p-3 text-[13px]">
              <div className="flex items-start justify-between gap-2">
                <span className="font-semibold text-content-1">{line.line_no}. {line.description}</span>
                <span className="shrink-0 tabular-nums font-semibold">{inr(line.amount)}</span>
              </div>
              <div className="mt-1 text-[12px] text-content-3">
                {line.line_category_label} · {line.quantity} {line.uom}{line.rate ? ` × ${inr(line.rate)}` : ""}{line.gst_rate ? ` · GST ${Number(line.gst_rate)}%` : ""} · {line.disposition_label}
              </div>
              {line.machine || line.equipment_text ? <div className="text-[12px] text-content-2">{line.machine ? `${line.machine.name} (${line.machine.code})` : line.equipment_text}</div> : null}
              {line.serial_no ? <div className="font-mono text-[12px] text-content-3">S/N {line.serial_no}</div> : null}
              {line.gate_pass_line ? <div className="text-[12px] text-content-2">Back on {line.gate_pass_line.gate_pass_number} line {line.gate_pass_line.line_no}{line.returned_quantity ? ` · ${line.returned_quantity}` : ""}</div> : null}
              {line.remarks ? <div className="text-[12px] text-content-3">{line.remarks}</div> : null}
            </div>
          ))}
        </div>
        <div className="hidden overflow-x-auto lg:block print:block">
          <table className="w-full min-w-[860px] text-left text-[13px] print:min-w-0 print:text-[11px]">
            <thead className="bg-surface-2 text-[11.5px] uppercase tracking-[0.05em] text-content-3 print:bg-transparent">
              <tr>
                <th scope="col" className="px-2 py-2">#</th>
                <th scope="col" className="px-2 py-2">Description</th>
                <th scope="col" className="px-2 py-2">Type</th>
                <th scope="col" className="px-2 py-2 text-right">Qty</th>
                <th scope="col" className="px-2 py-2 text-right">Rate</th>
                <th scope="col" className="px-2 py-2 text-right">Amount</th>
                <th scope="col" className="px-2 py-2 text-right">GST</th>
                <th scope="col" className="px-2 py-2">Machine / equipment</th>
                <th scope="col" className="px-2 py-2">What happened</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {receipt.lines.map((line) => (
                <tr key={line.id} className="align-top">
                  <td className="px-2 py-2 tabular-nums">{line.line_no}</td>
                  <td className="px-2 py-2">
                    <div className="font-medium text-content-1">{line.description}</div>
                    {line.serial_no ? <div className="font-mono text-[12px] text-content-3">S/N {line.serial_no}</div> : null}
                    {line.gate_pass_line ? <div className="text-[12px] text-content-2">Back on {line.gate_pass_line.gate_pass_number} line {line.gate_pass_line.line_no}{line.returned_quantity ? ` (${line.returned_quantity})` : ""}</div> : null}
                    {line.remarks ? <div className="text-[12px] text-content-3">{line.remarks}</div> : null}
                  </td>
                  <td className="px-2 py-2">{line.line_category_label}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{line.quantity} {line.uom}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{inr(line.rate)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{inr(line.amount)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{line.gst_rate ? `${Number(line.gst_rate)}%` : "—"}</td>
                  <td className="px-2 py-2">{line.machine ? `${line.machine.name} (${line.machine.code})` : line.equipment_text || "—"}</td>
                  <td className="px-2 py-2">{line.disposition_label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="mt-3 grid grid-cols-3 gap-2 rounded-xl bg-surface-2 p-3 text-[13px] print:bg-transparent">
          <div><dt className="text-content-3">Before GST</dt><dd className="font-semibold tabular-nums">{inr(receipt.amount)}</dd></div>
          <div><dt className="text-content-3">GST</dt><dd className="font-semibold tabular-nums">{inr(receipt.gst_amount)}</dd></div>
          <div><dt className="text-content-3">Total</dt><dd className="font-semibold tabular-nums">{inr(receipt.total_with_gst)}</dd></div>
        </dl>
      </Panel>

      <div className="hidden gap-8 pt-10 text-[12px] print:grid print:grid-cols-2">
        <div className="border-t border-content-3 pt-1">{receipt.receipt_type === "SERVICE" ? "Work confirmed by" : "Received by"}: {receipt.received_by_name}</div>
        <div className="border-t border-content-3 pt-1">Store / accounts</div>
      </div>

      {access.master ? <ReverseDialog receipt={receipt} open={reverseOpen} onClose={() => setReverseOpen(false)} /> : null}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-content-3">{label}</dt>
      <dd className="break-words text-content-1">{children}</dd>
    </div>
  );
}

function ReverseDialog({ receipt, open, onClose }: { receipt: GeneralReceipt; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const op = useGateOperation<{ reason: string }, GeneralReceipt>({
    send: (payload) => generalReceiptsApi.reverse(receipt.id, payload),
    onSaved: (saved) => {
      qc.setQueryData(generalReceiptKey(receipt.id), saved);
      onClose();
      return Promise.all([qc.invalidateQueries({ queryKey: ["general-receipts"] }), qc.invalidateQueries({ queryKey: ["inventory", "gate-bills"] })]);
    },
  });
  useEffect(() => {
    if (!open) {
      setReason("");
      op.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const short = reason.trim().length > 0 && reason.trim().length < 5;
  return (
    <Dialog open={open} onOpenChange={(next) => !next && !op.locked && onClose()}>
      <DialogContent className="w-[calc(100vw-1.5rem)] max-w-[560px]">
        <DialogTitle>Reverse {receipt.number}</DialogTitle>
        <DialogDescription>
          Marks the receipt reversed. It is never deleted and stays linked to its bill, flagged as reversed. A receipt that brought items back on a gate pass cannot be reversed.
        </DialogDescription>
        {receipt.has_gate_pass_returns ? (
          <p role="alert" className="rounded-xl border border-warning-border bg-warning-bg px-3 py-2 text-[13px]">This receipt recorded items coming back on a gate pass, so the server will refuse to reverse it. Correct the gate pass first.</p>
        ) : null}
        <label className={labelClass}>
          Reason (recorded in the audit, 5–500 characters)
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} disabled={op.locked} className={cn(fieldClass, "mt-1 h-auto py-2")} aria-invalid={short || undefined} placeholder="e.g. Recorded against the wrong bill" />
          {short ? <span className="mt-1 block text-danger-fg">At least 5 characters.</span> : null}
        </label>
        {op.phase === "rejected" ? <p role="alert" className="text-[12.5px] font-medium text-danger-fg">{gateErrorMessage(op.error)}</p> : null}
        {op.phase === "uncertain" ? <p role="alert" className="text-[12.5px] font-medium text-warning-fg">Not confirmed: {gateErrorMessage(op.error)} Retrying sends the same request.</p> : null}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={op.locked} className="min-h-[44px] rounded-xl border border-line px-4 text-[13px] font-semibold text-content-2 disabled:opacity-50">Cancel</button>
          <button
            type="button"
            disabled={reason.trim().length < 5 || op.phase === "sending"}
            onClick={() => (op.phase === "uncertain" ? void op.retry() : void op.submit({ reason: reason.trim() }))}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-danger-solid px-4 text-[13px] font-semibold text-white disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border"
          >
            {op.phase === "sending" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
            {op.phase === "uncertain" ? "Send same request again" : "Reverse receipt"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

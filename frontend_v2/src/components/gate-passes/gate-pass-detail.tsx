"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Ban, CheckCircle2, ClipboardCheck, Clock3, FileImage, PackageCheck, Pencil, Send, Undo2 } from "lucide-react";
import { toast } from "sonner";

import { PrintGateQrLabelButton } from "@/components/gate/print-qr-label-button";
import { useGateOperation } from "@/components/gate/use-gate-operation";
import { ActionFeedback, LoadFailure, RightsDenied, docDate, docDateTime, useDocumentRights } from "@/components/outward/document-rights";
import { PageThumb } from "@/components/outward/outward-common";
import { ReasonDialog } from "@/components/outward/reason-dialog";
import { Panel } from "@/components/premium";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getApiErrorStatus } from "@/lib/api";
import { cn } from "@/lib/utils";
import { gatePassesApi, type GatePass } from "@/services/gate-passes";

import { GatePassStatusPill, KIND_HELP, KindBadge, PrintGatePassButton } from "./gate-pass-common";
import { GatePassForm } from "./gate-pass-form";

const ACTION_LABEL: Record<string, string> = {
  GATE_PASS_DRAFTED: "Draft created",
  GATE_PASS_EDITED: "Draft edited",
  GATE_PASS_ISSUED: "Issued",
  GATE_PASS_OUT: "Left the gate",
  GATE_PASS_OUT_REVERSED: "Gate exit removed",
  GATE_PASS_RETURNED: "Items returned",
  GATE_PASS_CANCELLED: "Cancelled",
  GATE_PASS_SHORT_CLOSED: "Short-closed",
};

export function GatePassDetail({ id }: { id: string }) {
  const rights = useDocumentRights();
  const canView = rights.has("documents.view") || rights.has("gatepass.manage");
  const qc = useQueryClient();
  const queryKey = useMemo(() => ["inventory", "gate-passes", "detail", id], [id]);
  const detailQ = useQuery({
    queryKey,
    queryFn: () => gatePassesApi.get(id),
    enabled: canView && Boolean(id),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    retry: (count, error) => ![403, 404].includes(getApiErrorStatus(error) ?? 0) && count < 2,
    meta: { suppressGlobalError: true },
  });
  const [editing, setEditing] = useState(false);
  const [dialog, setDialog] = useState<"cancel" | "short-close" | "receive" | null>(null);
  const gatePass = detailQ.data ?? null;

  const apply = useCallback(
    (next: GatePass) => {
      qc.setQueryData(queryKey, next);
      void qc.invalidateQueries({ queryKey: ["inventory", "gate-passes", "list"] });
    },
    [qc, queryKey],
  );

  const issueOp = useGateOperation<{ version: number }, GatePass>({
    send: (payload) => gatePassesApi.issue(id, payload),
    onSaved: (next) => {
      apply(next);
      toast.success(`Issued as ${next.number}. Print it and hand it over with the items.`);
    },
  });

  if (rights.loading) return <div className="h-40 animate-pulse rounded-3xl bg-surface-2" />;
  if (!canView) return <RightsDenied title="Gate passes are for the inventory team" body="Ask an administrator for a documents right if you need to see gate passes." />;
  if (!id) return <RightsDenied title="This link is not valid" body="Open the gate pass again from the list." href="/inventory/gate-passes" linkLabel="Gate passes" />;
  if (detailQ.isError && !gatePass) {
    if (getApiErrorStatus(detailQ.error) === 404) return <RightsDenied title="This gate pass is not available" body="The link may be old. Find it again in the gate pass list." href="/inventory/gate-passes" linkLabel="Gate passes" />;
    return (
      <div className="mx-auto max-w-[1100px] space-y-3">
        <BackLink />
        <LoadFailure subject="This gate pass" error={detailQ.error} retry={() => void detailQ.refetch()} />
      </div>
    );
  }
  if (!gatePass) {
    return (
      <div className="mx-auto max-w-[1100px] space-y-3" role="status" aria-label="Loading gate pass">
        <div className="h-10 w-56 animate-pulse rounded-xl bg-surface-2" />
        <div className="h-[200px] animate-pulse rounded-3xl bg-surface-2" />
        <div className="h-[260px] animate-pulse rounded-3xl bg-surface-2" />
      </div>
    );
  }

  const actions = new Set(gatePass.actions);
  if (editing && actions.has("edit")) {
    return (
      <div className="mx-auto max-w-[1100px] space-y-4">
        <BackLink />
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-content-1">Edit draft {gatePass.display_number}</h1>
        <GatePassForm
          source={gatePass}
          onCancel={() => setEditing(false)}
          onSaved={(saved, issueNow) => {
            apply(saved);
            setEditing(false);
            toast.success("Draft saved.");
            if (issueNow) void issueOp.submit({ version: saved.version });
          }}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1100px] space-y-4 pb-10" data-testid="gate-pass-detail">
      <BackLink />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <KindBadge kind={gatePass.kind} />
            <h1 className="font-mono text-[22px] font-semibold tracking-[-0.02em] text-content-1">{gatePass.display_number}</h1>
            <GatePassStatusPill gatePass={gatePass} />
          </div>
          <p className="mt-1 text-[14px] text-content-2">
            {gatePass.party_name} · {gatePass.purpose_label} · {gatePass.plant_name}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <PrintGatePassButton gatePass={gatePass} />
          {gatePass.status === "ISSUED" || gatePass.status === "OUT" ? (
            <PrintGateQrLabelButton kind="GATE_PASS" id={gatePass.id} reference={gatePass.display_number} size="default" className="max-w-[300px]" />
          ) : null}
          {actions.has("edit") ? (
            <Button type="button" variant="outline" onClick={() => setEditing(true)}>
              <Pencil className="h-4 w-4" /> Edit draft
            </Button>
          ) : null}
          {actions.has("issue") ? (
            <Button type="button" disabled={issueOp.locked} onClick={() => void issueOp.submit({ version: gatePass.version })}>
              <Send className="h-4 w-4" /> Issue
            </Button>
          ) : null}
          {actions.has("receive_back") ? (
            <Button type="button" variant="success" onClick={() => setDialog("receive")}>
              <PackageCheck className="h-4 w-4" /> Receive back
            </Button>
          ) : null}
          {actions.has("short_close") ? (
            <Button type="button" variant="outline" onClick={() => setDialog("short-close")}>
              <ClipboardCheck className="h-4 w-4" /> Short-close
            </Button>
          ) : null}
          {actions.has("cancel") ? (
            <Button type="button" variant="ghost" onClick={() => setDialog("cancel")}>
              <Ban className="h-4 w-4" /> Cancel pass
            </Button>
          ) : null}
        </div>
      </div>
      <ActionFeedback phase={issueOp.phase} error={issueOp.error} onRetry={() => void issueOp.retry()} onRelease={issueOp.release} />
      {detailQ.isError ? <LoadFailure subject="The latest details" error={detailQ.error} retry={() => void detailQ.refetch()} /> : null}
      <NextStep gatePass={gatePass} />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <LinesPanel gatePass={gatePass} />
          <ReturnsPanel gatePass={gatePass} />
          <OutwardPanel gatePass={gatePass} />
        </div>
        <div className="space-y-4">
          <FactsPanel gatePass={gatePass} />
          <TimelinePanel gatePass={gatePass} />
        </div>
      </div>

      <ReasonDialog
        open={dialog === "cancel"}
        onOpenChange={(open) => !open && setDialog(null)}
        title={`Cancel ${gatePass.display_number}?`}
        description="A cancelled pass can never be used at the gate. The number stays on record."
        confirmLabel="Cancel gate pass"
        destructive
        placeholder="e.g. Repair done on site instead"
        onSubmit={(payload) => gatePassesApi.cancel(gatePass.id, payload)}
        onDone={(next) => {
          apply(next);
          toast.success("Gate pass cancelled.");
        }}
      />
      <ReasonDialog
        open={dialog === "short-close"}
        onOpenChange={(open) => !open && setDialog(null)}
        title={`Short-close ${gatePass.display_number}?`}
        description="Use this when the remaining items will not come back (scrapped by the vendor, replaced, lost). The outstanding quantity stays visible in the history."
        confirmLabel="Short-close"
        placeholder="e.g. Vendor scrapped the worn roller; replacement billed separately"
        onSubmit={(payload) => gatePassesApi.shortClose(gatePass.id, payload)}
        onDone={(next) => {
          apply(next);
          toast.success("Gate pass short-closed.");
        }}
      />
      <ReceiveBackDialog open={dialog === "receive"} onOpenChange={(open) => !open && setDialog(null)} gatePass={gatePass} onDone={apply} />
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/inventory/gate-passes" className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-1 text-[13px] font-semibold text-content-2 hover:text-content-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border">
      <ArrowLeft className="h-4 w-4" /> Gate passes
    </Link>
  );
}

function NextStep({ gatePass }: { gatePass: GatePass }) {
  const text: Record<string, string> = {
    DRAFT: "Draft: check the items, then Issue. A draft cannot be used at the gate.",
    ISSUED: "Issued: print it and send it with the items. When the watchman scans its QR at the gate, it moves to ‘Out of factory’.",
    OUT: gatePass.kind === "RETURNABLE" ? "Out of the factory. Record items as they come back (General Receipt against the vendor bill, or Receive back here)." : "Left the factory.",
    PARTLY_RETURNED: "Some items are back. The pass stays open until the rest return, or short-close it with a reason.",
    RETURNED: "Every item is back. The pass is closed.",
    CLOSED: "Non-returnable pass: closed when it left the gate.",
    SHORT_CLOSED: `Short-closed: ${gatePass.close_reason}`,
    CANCELLED: `Cancelled: ${gatePass.close_reason}`,
  };
  const tone = gatePass.is_overdue ? "border-danger-border bg-danger-bg text-danger-fg" : ["RETURNED", "CLOSED"].includes(gatePass.status) ? "border-success-border bg-success-bg text-success-fg" : "border-info-border bg-info-bg text-info-fg";
  return (
    <p role="status" className={cn("flex items-start gap-2 rounded-2xl border px-4 py-3 text-[13px]", tone)}>
      {["RETURNED", "CLOSED"].includes(gatePass.status) ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <Clock3 className="mt-0.5 h-4 w-4 shrink-0" />}
      <span>
        {gatePass.is_overdue ? `Overdue by ${gatePass.days_overdue} day${gatePass.days_overdue === 1 ? "" : "s"} (expected ${docDate(gatePass.expected_return_date)}). ` : ""}
        {text[gatePass.status] ?? gatePass.status_label}
      </span>
    </p>
  );
}

function FactsPanel({ gatePass }: { gatePass: GatePass }) {
  const rows: Array<[string, React.ReactNode]> = [
    ["Type", KIND_HELP[gatePass.kind].title],
    ["Party", gatePass.party_name],
    ["Address", gatePass.party_address || "—"],
    ["GSTIN", gatePass.party_gstin ? <span className="font-mono">{gatePass.party_gstin}</span> : "—"],
    ["Purpose", gatePass.purpose_label],
    ["Expected back", gatePass.kind === "RETURNABLE" ? docDate(gatePass.expected_return_date) : "Not returnable"],
    ["Carried by", gatePass.carried_by || "—"],
    ["Vehicle", gatePass.vehicle_number ? <span className="font-mono">{gatePass.vehicle_number}</span> : "—"],
    ["Issued", gatePass.issued_at ? `${docDateTime(gatePass.issued_at)} · ${gatePass.issued_by_name}` : "Not issued"],
    ["Left the gate", gatePass.out_at ? docDateTime(gatePass.out_at) : "Not yet"],
    ["Closed", gatePass.closed_at ? `${docDateTime(gatePass.closed_at)}${gatePass.closed_by_name ? ` · ${gatePass.closed_by_name}` : ""}` : "—"],
    ["Approx. value", gatePass.approx_value_total ? `₹${Number(gatePass.approx_value_total).toLocaleString("en-IN", { minimumFractionDigits: 2 })}` : "—"],
    ["Notes", gatePass.notes || "—"],
  ];
  return (
    <Panel title="Details">
      <dl className="space-y-1.5 text-[13px]">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[110px_minmax(0,1fr)] gap-2">
            <dt className="text-content-3">{label}</dt>
            <dd className="min-w-0 break-words text-content-1">{value}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

function LinesPanel({ gatePass }: { gatePass: GatePass }) {
  const returnable = gatePass.kind === "RETURNABLE";
  return (
    <Panel title={`Items (${gatePass.line_count})`} flush>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-[13px]">
          <thead className="bg-surface-2 text-left text-[11.5px] uppercase tracking-[0.06em] text-content-3">
            <tr>
              <th className="px-3 py-2 font-semibold">#</th>
              <th className="px-3 py-2 font-semibold">Item</th>
              <th className="px-3 py-2 text-right font-semibold">Qty</th>
              {returnable ? <th className="px-3 py-2 text-right font-semibold">Back</th> : null}
              {returnable ? <th className="px-3 py-2 text-right font-semibold">Still out</th> : null}
              <th className="px-3 py-2 text-right font-semibold">Approx. ₹</th>
            </tr>
          </thead>
          <tbody>
            {gatePass.lines.map((line) => (
              <tr key={line.id} className="border-t border-line align-top">
                <td className="px-3 py-2 tabular-nums text-content-3">{line.line_no}</td>
                <td className="px-3 py-2">
                  <div className="font-semibold text-content-1">{line.description}</div>
                  <div className="text-[12px] text-content-3">{[line.machine_name || line.equipment_text, line.serial_no ? `Sr ${line.serial_no}` : "", line.remarks].filter(Boolean).join(" · ")}</div>
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                  {line.quantity} {line.uom}
                </td>
                {returnable ? <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-success-fg">{line.returned_quantity}</td> : null}
                {returnable ? <td className={cn("whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums", Number(line.outstanding_quantity) > 0 ? "text-content-1" : "text-content-4")}>{line.outstanding_quantity}</td> : null}
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-content-2">{line.approx_value ? Number(line.approx_value).toLocaleString("en-IN", { minimumFractionDigits: 2 }) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function ReturnsPanel({ gatePass }: { gatePass: GatePass }) {
  if (gatePass.kind !== "RETURNABLE") return null;
  const returns = gatePass.returns ?? [];
  const receipts = gatePass.general_receipt_lines ?? [];
  return (
    <Panel title="Returns" description="Every return is recorded once and never edited.">
      {returns.length ? (
        <ul className="space-y-2 text-[13px]">
          {returns.map((row) => (
            <li key={row.id} className="rounded-xl border border-line px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold text-content-1">
                  {row.quantity} {row.uom} · line {row.line_no} {row.description}
                </span>
              </div>
              <div className="text-[12px] text-content-3">
                {docDateTime(row.returned_at)} · received by {row.received_by_name}
                {row.general_receipt_number ? ` · General Receipt ${row.general_receipt_number}` : row.general_receipt_line_id ? " · via General Receipt" : " · received back without a bill"}
              </div>
              {row.notes ? <div className="text-[12px] text-content-2">{row.notes}</div> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-content-3">Nothing has come back yet.</p>
      )}
      {receipts.length ? (
        <div className="mt-3">
          <div className="text-[12px] font-semibold uppercase tracking-[0.08em] text-content-4">Linked General Receipt lines</div>
          <ul className="mt-1 space-y-1 text-[13px]">
            {receipts.map((row) => (
              <li key={row.id}>
                <Link href={`/inventory/general-receipts/${row.receipt_id}`} className="font-mono font-semibold text-primary hover:underline">
                  {row.receipt_number}
                </Link>{" "}
                · line {row.line_no} {row.description} · {row.quantity} {row.uom} · {docDate(row.received_at)}
                {row.receipt_status === "REVERSED" ? <span className="ml-1 font-semibold text-danger-fg">(reversed)</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Panel>
  );
}

function OutwardPanel({ gatePass }: { gatePass: GatePass }) {
  const rows = gatePass.outward_documents ?? [];
  if (["DRAFT", "CANCELLED"].includes(gatePass.status) && !rows.length) return null;
  return (
    <Panel title="Gate exit photos" description="Outward photos the gate linked to this pass (QR scan or office match).">
      {rows.length ? (
        <ul className="space-y-2">
          {rows.map((row) => {
            const body = (
              <span className="flex items-center gap-3">
                <PageThumb url={row.thumb_url} alt={`Gate photo ${docDateTime(row.departed_at)}`} className="h-14 w-11 shrink-0" />
                <span className="min-w-0 text-[13px]">
                  <span className={cn("block font-semibold", row.active ? "text-content-1" : "text-content-3 line-through")}>Left {docDateTime(row.departed_at)}</span>
                  <span className="block text-[12px] text-content-3">
                    {row.vehicle_number || "No vehicle noted"} · {row.page_count} page{row.page_count === 1 ? "" : "s"} · {row.link_source === "QR" ? "QR at the gate" : "office match"} · by {row.recorded_by_name}
                  </span>
                  {!row.active ? <span className="block text-[12px] text-content-3">Link removed: {row.removed_reason}</span> : null}
                </span>
              </span>
            );
            return (
              <li key={row.link_id}>
                {row.can_open ? (
                  <Link href={`/inventory/outward-documents/${row.document_id}`} className="block rounded-xl border border-line px-3 py-2 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border">
                    {body}
                  </Link>
                ) : (
                  <div className="rounded-xl border border-line px-3 py-2">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="flex items-center gap-2 text-[13px] text-content-3">
          <FileImage className="h-4 w-4" /> Not photographed at the gate yet.
        </p>
      )}
    </Panel>
  );
}

function TimelinePanel({ gatePass }: { gatePass: GatePass }) {
  const events = gatePass.timeline ?? [];
  return (
    <Panel title="History">
      <ol className="space-y-2 text-[13px]">
        {events.map((event) => (
          <li key={event.id}>
            <div className="font-semibold text-content-1">{ACTION_LABEL[event.action] ?? event.action}</div>
            <div className="text-[12px] text-content-3">
              {docDateTime(event.created_at)} · {event.actor_name}
            </div>
            {event.reason ? <div className="text-[12px] text-content-2">{event.reason}</div> : null}
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function ReceiveBackDialog({ open, onOpenChange, gatePass, onDone }: { open: boolean; onOpenChange: (open: boolean) => void; gatePass: GatePass; onDone: (next: GatePass) => void }) {
  const outstanding = gatePass.lines.filter((line) => Number(line.outstanding_quantity) > 0);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [reason, setReason] = useState("");
  const op = useGateOperation<{ reason: string; lines: Array<{ line_id: string; quantity: string }> }, GatePass>({
    send: (payload) => gatePassesApi.receiveBack(gatePass.id, payload),
    onSaved: (next) => {
      onDone(next);
      toast.success(next.status === "RETURNED" ? "Everything is back. The pass is closed." : "Return recorded.");
      onOpenChange(false);
    },
  });
  const { reset } = op;
  useEffect(() => {
    if (open) {
      setQuantities({});
      setReason("");
      reset();
    }
  }, [open, reset]);

  const lines = outstanding
    .map((line) => ({ line, value: (quantities[line.id] ?? "").trim() }))
    .filter((row) => row.value !== "" && Number(row.value) > 0);
  const invalid = outstanding.some((line) => {
    const value = (quantities[line.id] ?? "").trim();
    if (!value) return false;
    return !/^\d+(\.\d{1,3})?$/.test(value) || Number(value) > Number(line.outstanding_quantity);
  });
  const valid = lines.length > 0 && !invalid && reason.trim().length >= 5;

  return (
    <Dialog open={open} onOpenChange={(next) => (op.locked ? undefined : onOpenChange(next))}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Receive items back</DialogTitle>
          <DialogDescription>
            For items that came back without a supplier bill. When a bill comes with them, record a General Receipt against the bill instead — it closes these lines too.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid && !op.locked) void op.submit({ reason: reason.trim(), lines: lines.map((row) => ({ line_id: row.line.id, quantity: row.value })) });
          }}
        >
          <ul className="space-y-2">
            {outstanding.map((line) => {
              const value = quantities[line.id] ?? "";
              const over = value.trim() !== "" && Number(value) > Number(line.outstanding_quantity);
              return (
                <li key={line.id} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2">
                  <div className="min-w-0 flex-1 text-[13px]">
                    <div className="font-semibold text-content-1">
                      {line.line_no}. {line.description}
                    </div>
                    <div className="text-[12px] text-content-3">
                      Still out: {line.outstanding_quantity} {line.uom}
                    </div>
                  </div>
                  <label className="flex items-center gap-1.5 text-[12px] text-content-3">
                    <span className="sr-only">Quantity back for line {line.line_no}</span>
                    <input
                      value={value}
                      inputMode="decimal"
                      disabled={op.locked}
                      onChange={(e) => setQuantities((q) => ({ ...q, [line.id]: e.target.value }))}
                      placeholder="0"
                      aria-invalid={over}
                      className={cn("h-10 w-24 rounded-lg border bg-surface-2 px-2 text-right text-[13.5px] tabular-nums outline-none focus:border-primary", over ? "border-danger-border" : "border-line")}
                    />
                    {line.uom}
                  </label>
                  <Button type="button" variant="ghost" size="sm" disabled={op.locked} onClick={() => setQuantities((q) => ({ ...q, [line.id]: line.outstanding_quantity }))}>
                    <Undo2 className="h-4 w-4" /> All
                  </Button>
                </li>
              );
            })}
          </ul>
          {invalid ? <p className="text-[12.5px] text-danger-fg">A quantity is more than what is still out, or not a number.</p> : null}
          <label className="block text-[13px] font-semibold text-content-2" htmlFor="gp-receive-reason">
            Note (who brought it, condition)
          </label>
          <textarea id="gp-receive-reason" value={reason} disabled={op.locked} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} placeholder="e.g. Roller back after milling, checked by Ramesh" className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-[14px] text-content-1 outline-none focus:border-primary" />
          <ActionFeedback phase={op.phase} error={op.error} onRetry={() => void op.retry()} onRelease={op.release} />
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" disabled={op.locked} onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button type="submit" variant="success" disabled={!valid || op.locked}>
              <PackageCheck className="h-4 w-4" /> Record return
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

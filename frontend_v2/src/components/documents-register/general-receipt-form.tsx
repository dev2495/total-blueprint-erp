"use client";

import { useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, CheckCircle2, Loader2, Plus, ReceiptText, Trash2, Undo2 } from "lucide-react";

import { BillWorkspace, useBillWorkspaceLayout } from "@/components/documents/bill-workspace";
import { inwardBillDocument } from "@/components/documents/inward-bill-document";
import { Panel } from "@/components/premium";
import { useAuth } from "@/components/auth-provider";
import { cn } from "@/lib/utils";
import { gateErrorMessage, useGateOperation } from "@/components/gate/use-gate-operation";
import { useBill } from "@/components/inventory/gate-bills/bill-detail";
import { BillAccessDenied, billRef, inr, useDocumentAccess } from "@/components/inventory/gate-bills/bill-common";
import {
  DISPOSITION_LABEL,
  generalReceiptsApi,
  GENERAL_UOMS,
  GST_RATES,
  LINE_CATEGORY_LABEL,
  type Disposition,
  type GeneralReceipt,
  type GeneralReceiptInput,
  type LineCategory,
  type OpenGatePassLine,
  type ReceiptType,
} from "@/services/general-receipts";
import type { InwardBill } from "@/services/gate-bills";
import { ErrorBanner, FieldError, VendorPicker, fieldClass, labelClass, useDebounced, type PartyValue } from "./shared";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type LineDraft = {
  key: string;
  line_category: LineCategory;
  description: string;
  quantity: string;
  uom: string;
  rate: string;
  gst_rate: string;
  disposition: Disposition;
  machine: string;
  equipment_text: string;
  serial_no: string;
  remarks: string;
  gate_pass_line: string;
  returned_quantity: string;
};

let lineSeq = 0;
function newLine(type: ReceiptType): LineDraft {
  return {
    key: `l${++lineSeq}`,
    line_category: type === "SERVICE" ? "SERVICE" : "SPARES",
    description: "",
    quantity: "1",
    uom: type === "SERVICE" ? "JOB" : "NOS",
    rate: "",
    gst_rate: "18",
    disposition: type === "SERVICE" ? "NOT_APPLICABLE" : "KEPT_IN_STORE",
    machine: "",
    equipment_text: "",
    serial_no: "",
    remarks: "",
    gate_pass_line: "",
    returned_quantity: "",
  };
}

const decimal = (value: string) => value.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
const n = (value: string) => (value.trim() === "" ? null : Number(value));
function lineAmount(line: LineDraft) {
  const q = n(line.quantity);
  const r = n(line.rate);
  return q !== null && r !== null && Number.isFinite(q) && Number.isFinite(r) ? Math.round(q * r * 100) / 100 : null;
}

function localDateTimeValue(date = new Date()) {
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

type ServerErrors = { top: Record<string, string>; lines: Record<number, Record<string, string>> };

/** Map DRF errors (nested `lines: [{field: [...]}]` and service keys `lines[2].machine`) to fields. */
function serverErrors(error: unknown): ServerErrors {
  const out: ServerErrors = { top: {}, lines: {} };
  const data = (error as { response?: { data?: { detail?: unknown } } } | null)?.response?.data;
  const detail = data && typeof data === "object" ? (data as { detail?: unknown }).detail : null;
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return out;
  const text = (value: unknown): string => (Array.isArray(value) ? value.map(text).join(" ") : typeof value === "object" && value ? Object.values(value).map(text).join(" ") : String(value ?? ""));
  for (const [key, value] of Object.entries(detail as Record<string, unknown>)) {
    const match = /^lines\[(\d+)\]\.(\w+)$/.exec(key);
    if (match) {
      const index = Number(match[1]) - 1;
      out.lines[index] = { ...(out.lines[index] ?? {}), [match[2]]: text(value) };
    } else if (key === "lines" && Array.isArray(value)) {
      value.forEach((row, index) => {
        if (row && typeof row === "object" && !Array.isArray(row)) {
          for (const [field, message] of Object.entries(row as Record<string, unknown>)) {
            out.lines[index] = { ...(out.lines[index] ?? {}), [field]: text(message) };
          }
        } else if (row) {
          out.top.lines = `${out.top.lines ? `${out.top.lines} ` : ""}${text(row)}`;
        }
      });
    } else {
      out.top[key] = text(value);
    }
  }
  return out;
}

/**
 * /inventory/general-receipts/new — record spares, machinery, tools, services
 * and charges received (or work confirmed). With `?bill=` the bill sits beside
 * the form and the receipt links to it; `?followup=` records what an old
 * non-stock void delivered. Never posts stock.
 */
export function GeneralReceiptForm() {
  const access = useDocumentAccess();
  const params = useSearchParams();
  const rawBill = params?.get("bill") ?? "";
  const rawFollowup = params?.get("followup") ?? "";
  const billId = UUID.test(rawBill) ? rawBill : "";
  const followupId = !billId && UUID.test(rawFollowup) ? rawFollowup : "";
  const sourceId = billId || followupId;
  const billQ = useBill(sourceId, access.manage && Boolean(sourceId));
  const bill = billQ.data ?? null;
  const doc = useMemo(() => (bill ? inwardBillDocument(bill) : null), [bill]);

  if (access.loading) return <div className="h-40 animate-pulse rounded-3xl bg-surface-2" role="status" aria-label="Loading" />;
  if (!access.manage)
    return <BillAccessDenied title="Recording a general receipt needs the documents manage right" body="Inventory (Store) users, owners and administrators can record general receipts. Ask an administrator to grant documents.manage through the Role matrix or as an extra permission if you need it." />;
  if ((rawBill && !billId) || (rawFollowup && !followupId)) return <InvalidLink />;
  if (sourceId && billQ.isLoading) return <div className="h-[60vh] animate-pulse rounded-3xl bg-surface-2" role="status" aria-label="Loading bill" />;
  if (sourceId && !bill) {
    return (
      <div className="mx-auto mt-10 max-w-[560px] space-y-3">
        <ErrorBanner error={billQ.error} onRetry={() => void billQ.refetch()} title="Could not load the bill for this receipt." />
        <Link href="/inventory/gate-bills" className="inline-flex min-h-[44px] items-center text-sm font-semibold text-primary">Back to bills & documents</Link>
      </div>
    );
  }
  return (
    <BillWorkspace document={doc}>
      <ReceiptFormBody key={sourceId || "free"} bill={bill} mode={billId ? "bill" : followupId ? "followup" : "free"} />
    </BillWorkspace>
  );
}

function InvalidLink() {
  return (
    <div className="mx-auto mt-10 max-w-[520px] rounded-3xl border border-line bg-surface-1 p-6 text-center" role="alert">
      <h1 className="text-lg font-semibold text-content-1">This receipt link is not valid</h1>
      <p className="mt-2 text-sm text-content-3">Open the bill again from Bills & documents and choose “Create general receipt”.</p>
      <Link href="/inventory/gate-bills" className="mt-4 inline-flex min-h-[44px] items-center rounded-xl px-4 text-sm font-semibold text-primary">Bills & documents</Link>
    </div>
  );
}

function ReceiptFormBody({ bill, mode }: { bill: InwardBill | null; mode: "bill" | "followup" | "free" }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useAuth();
  const formId = useId();
  const layout = useBillWorkspaceLayout();
  const billOpen = bill ? bill.status === "PENDING_GRN" || bill.status === "PARTIAL_GRN" : false;
  const blockedReason =
    mode === "bill" && bill && !billOpen
      ? `Bill ${billRef(bill.id)} is already ${bill.status === "FILED" ? "filed" : bill.status === "VOID" ? "voided" : "received"}. Open a bill that is still waiting.`
      : mode === "bill" && bill && !bill.allowed_actions?.includes("general_receipt")
        ? "This bill is classified as record-only paper (utility, fee, transport, other expense). Change its category before receiving against it."
        : mode === "followup" && bill && !bill.needs_followup
          ? bill.followup
            ? `This bill is already followed up by ${bill.followup.number}.`
            : "Only bills voided as non-stock under the old rule can be followed up here."
          : null;

  const [plant, setPlant] = useState(bill?.ship_to_plant ?? bill?.plant ?? "");
  const [receiptType, setReceiptType] = useState<ReceiptType>(bill?.category === "SERVICE" ? "SERVICE" : "GOODS");
  const [party, setParty] = useState<PartyValue>({ vendorId: bill?.vendor ?? null, vendorName: bill?.vendor_name ?? "", partyName: bill?.vendor ? "" : bill?.party_name ?? "" });
  const [invoice, setInvoice] = useState(bill?.invoice_number ?? "");
  const [invoiceDate, setInvoiceDate] = useState(bill?.invoice_date ?? "");
  const [receivedBy, setReceivedBy] = useState(user?.id ? String(user.id) : "");
  const [receivedAt, setReceivedAt] = useState(() => localDateTimeValue());
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [complete, setComplete] = useState(false);
  const [override, setOverride] = useState("");
  const [lines, setLines] = useState<LineDraft[]>(() => [newLine(bill?.category === "SERVICE" ? "SERVICE" : "GOODS")]);
  useEffect(() => {
    if (!receivedBy && user?.id) setReceivedBy(String(user.id));
  }, [receivedBy, user?.id]);

  const machinePlants = useMemo(() => Array.from(new Set([plant, bill?.ship_to_plant ?? ""].filter(Boolean))), [plant, bill?.ship_to_plant]);
  const optionsQ = useQuery({
    queryKey: ["documents", "gr-options", machinePlants],
    queryFn: () => generalReceiptsApi.options(machinePlants),
    staleTime: 5 * 60_000,
    meta: { suppressGlobalError: true },
  });
  const options = optionsQ.data;
  const plantChoices = useMemo(() => {
    const all = options?.plants ?? [];
    if (!bill) return all;
    const allowed = new Set([bill.plant, bill.ship_to_plant].filter(Boolean));
    return all.filter((p) => allowed.has(p.id));
  }, [options?.plants, bill]);

  const op = useGateOperation<Omit<GeneralReceiptInput, "client_token">, GeneralReceipt>({
    send: (payload) => generalReceiptsApi.create(payload as GeneralReceiptInput),
    onSaved: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ["inventory", "gate-bills"] }),
        qc.invalidateQueries({ queryKey: ["documents"] }),
        qc.invalidateQueries({ queryKey: ["general-receipts"] }),
      ]),
  });
  const errors = op.phase === "rejected" ? serverErrors(op.error) : { top: {}, lines: {} };
  const update = (key: string, patch: Partial<LineDraft>) => {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
    if (op.phase === "rejected") op.reset();
  };

  const totals = useMemo(() => {
    let amount = 0;
    let gst = 0;
    for (const line of lines) {
      const a = lineAmount(line) ?? 0;
      amount += a;
      const g = n(line.gst_rate);
      if (g !== null) gst += Math.round(a * g) / 100;
    }
    return { amount, gst, total: amount + gst };
  }, [lines]);

  const clientIssues: string[] = [];
  const lineIssues: Record<string, Record<string, string>> = {};
  for (const [index, line] of lines.entries()) {
    const issues: Record<string, string> = {};
    if (line.description.trim().length < 2) issues.description = "Describe the item or work.";
    const q = n(line.quantity);
    if (q === null || !(q > 0)) issues.quantity = "Enter a quantity above 0.";
    if (line.disposition === "INSTALLED" && !line.machine && !line.equipment_text.trim()) issues.machine = "Choose the machine (or type the equipment) it was installed on.";
    if (line.gate_pass_line && !(Number(line.returned_quantity || line.quantity) > 0)) issues.returned_quantity = "Enter how many came back.";
    if (Object.keys(issues).length) lineIssues[line.key] = issues;
    void index;
  }
  if (receiptType === "SERVICE" && !lines.some((l) => l.line_category === "SERVICE")) clientIssues.push("A service receipt needs at least one Service / labour line.");
  if (receiptType === "GOODS" && lines.every((l) => l.line_category === "SERVICE" || l.line_category === "CHARGE")) clientIssues.push("A goods receipt needs at least one goods line (not only service or freight).");
  if (!plant) clientIssues.push("Choose the receiving factory.");
  if (!party.vendorId && !party.partyName.trim()) clientIssues.push("Choose the vendor or type the party name.");
  const receivedMs = receivedAt ? new Date(receivedAt).getTime() : Number.NaN;
  if (!Number.isFinite(receivedMs)) clientIssues.push("Enter when it was received.");
  else if (receivedMs > Date.now() + 120_000) clientIssues.push("Received time cannot be in the future.");
  const duplicates = mode === "bill" ? bill?.duplicate_candidates ?? [] : [];
  if (duplicates.length && override.trim().length < 5) clientIssues.push("Give a reason to receive a bill whose invoice is already recorded (or void this bill as a duplicate).");
  const invalid = clientIssues.length > 0 || Object.keys(lineIssues).length > 0;
  const [showIssues, setShowIssues] = useState(false);

  const submit = () => {
    if (op.phase === "uncertain") return void op.retry();
    if (invalid) {
      setShowIssues(true);
      return;
    }
    const payload: Omit<GeneralReceiptInput, "client_token"> = {
      plant,
      ...(mode === "bill" && bill ? { document: bill.id, bill_complete: complete } : {}),
      ...(mode === "followup" && bill ? { followup_of_bill: bill.id } : {}),
      vendor: party.vendorId,
      party_name: party.vendorId ? "" : party.partyName.trim(),
      invoice_number: invoice.trim(),
      invoice_date: invoiceDate || null,
      receipt_type: receiptType,
      received_at: new Date(receivedAt).toISOString(),
      received_by: receivedBy || null,
      reference: reference.trim(),
      notes: notes.trim(),
      ...(duplicates.length ? { duplicate_override_reason: override.trim() } : {}),
      lines: lines.map((line) => ({
        line_category: line.line_category,
        description: line.description.trim(),
        quantity: line.quantity,
        uom: line.uom,
        rate: line.rate.trim() || null,
        gst_rate: line.gst_rate || null,
        disposition: line.disposition,
        machine: line.machine || null,
        equipment_text: line.machine ? "" : line.equipment_text.trim(),
        serial_no: line.serial_no.trim(),
        remarks: line.remarks.trim(),
        gate_pass_line: line.gate_pass_line || null,
        returned_quantity: line.gate_pass_line ? line.returned_quantity || line.quantity : null,
      })),
    };
    void op.submit(payload);
  };

  if (op.phase === "saved" && op.result) {
    const saved = op.result;
    return (
      <div className="mx-auto max-w-[760px] py-6">
        <Panel>
          <div className="space-y-3 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-success-fg" aria-hidden />
            <h1 className="text-[20px] font-semibold text-content-1">General receipt {saved.number} recorded</h1>
            <p className="text-[13px] text-content-3">
              {saved.line_count} line{saved.line_count === 1 ? "" : "s"} · {inr(saved.amount)} before GST · received by {saved.received_by_name}.
              {saved.replayed ? " (This was already saved — the original receipt is shown.)" : ""} No stock was posted.
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <Link href={`/inventory/general-receipts/${saved.id}`} className="inline-flex min-h-[44px] items-center rounded-xl bg-primary px-4 text-[13px] font-semibold text-primary-foreground">Open receipt</Link>
              {bill ? <Link href={`/inventory/gate-bills/${bill.id}`} className="inline-flex min-h-[44px] items-center rounded-xl border border-line px-4 text-[13px] font-semibold text-content-1">Back to bill {billRef(bill.id)}</Link> : null}
              <button type="button" onClick={() => router.push("/inventory/general-receipts")} className="inline-flex min-h-[44px] items-center rounded-xl border border-line px-4 text-[13px] font-semibold text-content-1">All general receipts</button>
            </div>
          </div>
        </Panel>
      </div>
    );
  }

  const machines = (options?.machines ?? []).filter((m) => machinePlants.includes(m.plant));
  return (
    <form
      id={formId}
      className="mx-auto max-w-[980px] space-y-4 pb-28"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      noValidate
    >
      <div className="flex flex-wrap items-center gap-2">
        <Link href={bill ? `/inventory/gate-bills/${bill.id}` : "/inventory/general-receipts"} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-2 text-[13px] font-semibold text-content-2 hover:bg-surface-2">
          <ArrowLeft className="h-4 w-4" /> {bill ? `Bill ${billRef(bill.id)}` : "General receipts"}
        </Link>
      </div>
      <div>
        <h1 className="text-[20px] font-semibold tracking-[-0.01em] text-content-1">
          {mode === "followup" ? "General receipt for an old non-stock bill" : "New general receipt"}
        </h1>
        <p className="mt-1 text-[13px] text-content-3">
          Spares, machinery, tools, services and charges: who received it (or confirmed the work) and when. Nothing here changes stock.
          {mode === "followup" ? " The original void stays in the bill history." : ""}
        </p>
      </div>
      {blockedReason ? <p role="alert" className="rounded-xl border border-warning-border bg-warning-bg px-3 py-2.5 text-[13px] text-content-1">{blockedReason}</p> : null}
      {optionsQ.isError ? <ErrorBanner error={optionsQ.error} onRetry={() => void optionsQ.refetch()} title="Could not load machines and receivers." /> : null}

      <fieldset disabled={op.locked || Boolean(blockedReason)} className="space-y-4">
        <Panel title="Receipt">
          <div className="grid gap-3 sm:grid-cols-2">
            <div role="radiogroup" aria-label="Receipt type" className="sm:col-span-2">
              <span className={labelClass}>What came in?</span>
              <div className="mt-1 grid grid-cols-2 gap-2">
                {(["GOODS", "SERVICE"] as ReceiptType[]).map((type) => (
                  <label key={type} className={cn("flex min-h-[56px] cursor-pointer items-start gap-2 rounded-xl border px-3 py-2 focus-within:ring-2 focus-within:ring-info-border", receiptType === type ? "border-primary bg-info-bg" : "border-line")}>
                    <input type="radio" name={`${formId}-type`} className="mt-1 h-4 w-4" checked={receiptType === type} onChange={() => setReceiptType(type)} />
                    <span>
                      <span className="block text-[13px] font-semibold text-content-1">{type === "GOODS" ? "Goods" : "Service / work done"}</span>
                      <span className="block text-[12px] text-content-3">{type === "GOODS" ? "Spares, machines, tools, consumables" : "Repair, visit, labour — confirm the work"}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <label className={labelClass}>
              Receiving factory
              <select value={plant} onChange={(e) => setPlant(e.target.value)} className={cn(fieldClass, "mt-1")} aria-invalid={Boolean(errors.top.plant) || undefined}>
                <option value="">{optionsQ.isLoading ? "Loading…" : "Choose factory"}</option>
                {plantChoices.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}{bill?.ship_to_plant === p.id ? " (ship-to)" : bill?.plant === p.id ? " (bill-to)" : ""}</option>
                ))}
              </select>
              <FieldError message={errors.top.plant} />
            </label>
            <div className="sm:col-span-1">
              <VendorPicker value={party} onChange={setParty} error={errors.top.vendor || errors.top.party_name} />
            </div>
            <label className={labelClass}>
              Bill / invoice number
              <input value={invoice} onChange={(e) => setInvoice(e.target.value)} maxLength={80} className={cn(fieldClass, "mt-1 font-mono")} />
            </label>
            <label className={labelClass}>
              Bill date
              <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className={cn(fieldClass, "mt-1")} />
            </label>
            <label className={labelClass}>
              {receiptType === "SERVICE" ? "Work confirmed by" : "Received by"}
              <select value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} className={cn(fieldClass, "mt-1")} aria-invalid={Boolean(errors.top.received_by) || undefined}>
                {!options ? <option value={receivedBy}>{user?.full_name || user?.username || "Me"}</option> : null}
                {(options?.receivers ?? []).map((r) => (
                  <option key={r.id} value={r.id}>{r.name}{r.id === String(user?.id) ? " (me)" : ""}</option>
                ))}
              </select>
              <FieldError message={errors.top.received_by} />
            </label>
            <label className={labelClass}>
              {receiptType === "SERVICE" ? "Work confirmed at" : "Received at"}
              <input type="datetime-local" value={receivedAt} max={localDateTimeValue()} onChange={(e) => setReceivedAt(e.target.value)} className={cn(fieldClass, "mt-1")} aria-invalid={Boolean(errors.top.received_at) || undefined} />
              <FieldError message={errors.top.received_at} />
            </label>
            <label className={labelClass}>
              PO / work order reference (optional)
              <input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} className={cn(fieldClass, "mt-1")} />
            </label>
            <label className={labelClass}>
              Note (optional)
              <input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} className={cn(fieldClass, "mt-1")} />
            </label>
          </div>
        </Panel>

        <Panel title="Lines" description="One line per item or job. Amount = quantity × rate. Choose the machine for anything fitted or serviced — it builds the machine history.">
          <ol className="space-y-3">
            {lines.map((line, index) => (
              <LineEditor
                key={line.key}
                index={index}
                line={line}
                canRemove={lines.length > 1}
                onChange={(patch) => update(line.key, patch)}
                onRemove={() => setLines((current) => current.filter((l) => l.key !== line.key))}
                machines={machines}
                vendorId={party.vendorId}
                partyName={party.partyName}
                plant={plant}
                serverErrors={errors.lines[index] ?? {}}
                clientErrors={showIssues ? lineIssues[line.key] ?? {} : {}}
              />
            ))}
          </ol>
          <button type="button" onClick={() => setLines((current) => [...current, newLine(receiptType)])} className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-dashed border-line px-4 text-[13px] font-semibold text-content-1 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border">
            <Plus className="h-4 w-4" /> Add line
          </button>
          <FieldError message={errors.top.lines} />
          <dl className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-surface-2 p-3 text-[13px]">
            <div><dt className="text-content-3">Before GST</dt><dd className="font-semibold tabular-nums text-content-1">{inr(totals.amount)}</dd></div>
            <div><dt className="text-content-3">GST</dt><dd className="font-semibold tabular-nums text-content-1">{inr(totals.gst)}</dd></div>
            <div><dt className="text-content-3">Total</dt><dd className="font-semibold tabular-nums text-content-1">{inr(totals.total)}</dd></div>
          </dl>
          {bill?.total_amount && Math.abs(Number(bill.total_amount) - totals.total) > 1 ? (
            <p className="mt-2 text-[12.5px] text-content-3">Bill total is {inr(bill.total_amount)}. A difference is fine when part of the bill is stock, freight on another receipt, or rounding.</p>
          ) : null}
        </Panel>

        {duplicates.length ? (
          <Panel title="Same invoice already recorded">
            <p className="text-[13px] text-content-1">
              {bill?.invoice_number} from {bill?.party_display} is also on {duplicates.map((d) => `${d.ref} (${d.plant_name})`).join(", ")}. If it is the same paper, void this bill as a duplicate instead.
            </p>
            <label className={cn(labelClass, "mt-2")}>
              Reason to receive it anyway
              <textarea value={override} onChange={(e) => setOverride(e.target.value)} rows={2} maxLength={500} className={cn(fieldClass, "mt-1 h-auto py-2")} />
              <FieldError message={errors.top.duplicate_override_reason} />
            </label>
          </Panel>
        ) : null}

        {mode === "bill" && bill ? (
          <label className="flex min-h-[48px] cursor-pointer items-start gap-3 rounded-xl border border-line bg-surface-1 px-3 py-2.5 text-[13px] text-content-2">
            <input type="checkbox" className="mt-0.5 h-5 w-5" checked={complete} onChange={(e) => setComplete(e.target.checked)} />
            <span>
              <span className="block font-semibold text-content-1">This receipt completes the bill</span>
              Tick only if every line on bill {billRef(bill.id)} is covered now. Otherwise the bill stays “Partly received”.
            </span>
          </label>
        ) : null}
      </fieldset>

      {/* Sticky inside the form pane when docked; lifted above the bill sheet on phones. */}
      <div
        className={cn("sticky bottom-0 z-30 border-t border-line bg-surface-1/95 px-4 py-3 backdrop-blur", layout.paneScroll ? "rounded-2xl border shadow-[0_-12px_30px_-12px_rgba(15,23,42,0.22)]" : "-mx-4 sm:mx-0 sm:rounded-2xl sm:border")}
        style={layout.sheetOffset ? { bottom: layout.sheetOffset } : undefined}
      >
        {showIssues && invalid ? (
          <ul role="alert" className="mb-2 list-disc space-y-0.5 pl-5 text-[12.5px] text-danger-fg">
            {clientIssues.map((issue) => <li key={issue}>{issue}</li>)}
            {Object.keys(lineIssues).length ? <li>Check the highlighted lines.</li> : null}
          </ul>
        ) : null}
        {op.phase === "rejected" ? (
          <p role="alert" className="mb-2 flex items-start gap-2 text-[12.5px] font-medium text-danger-fg">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {gateErrorMessage(op.error, "The receipt was refused. Nothing was saved.")}
          </p>
        ) : null}
        {op.phase === "uncertain" ? (
          <div role="alert" className="mb-2 space-y-1 text-[12.5px] text-content-1">
            <p className="font-medium text-warning-fg">Not confirmed: {gateErrorMessage(op.error)} Saving again sends the identical receipt with the same token, so it can never be recorded twice.</p>
            <button type="button" onClick={() => { if (window.confirm("Only unlock if General receipts does not show this receipt. Unlock the form?")) op.release(); }} className="inline-flex min-h-[32px] items-center gap-1 font-semibold text-content-3 underline">
              <Undo2 className="h-3.5 w-3.5" /> I checked — it was not saved, unlock the form
            </button>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[13px] text-content-2">
            {lines.length} line{lines.length === 1 ? "" : "s"} · <b className="tabular-nums">{inr(totals.total)}</b>
          </span>
          <button
            type="submit"
            disabled={op.phase === "sending" || Boolean(blockedReason)}
            className="inline-flex min-h-[48px] items-center gap-2 rounded-xl bg-primary px-5 text-[14px] font-semibold text-primary-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border"
          >
            {op.phase === "sending" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ReceiptText className="h-4 w-4" />}
            {op.phase === "uncertain" ? "Save the same receipt again" : complete ? "Save receipt & complete bill" : "Save general receipt"}
          </button>
        </div>
      </div>
    </form>
  );
}

type MachineOption = { id: string; name: string; code: string; plant: string; plant_name: string; work_center_name: string; status: string };

function LineEditor({
  index,
  line,
  canRemove,
  onChange,
  onRemove,
  machines,
  vendorId,
  partyName,
  plant,
  serverErrors,
  clientErrors,
}: {
  index: number;
  line: LineDraft;
  canRemove: boolean;
  onChange: (patch: Partial<LineDraft>) => void;
  onRemove: () => void;
  machines: MachineOption[];
  vendorId: string | null;
  partyName: string;
  plant: string;
  serverErrors: Record<string, string>;
  clientErrors: Record<string, string>;
}) {
  const id = useId();
  const err = (key: string) => clientErrors[key] || serverErrors[key];
  const amount = lineAmount(line);
  const q = useDebounced(line.description.trim(), 300);
  const suggestQ = useQuery({
    queryKey: ["general-receipts", "suggestions", q, vendorId],
    queryFn: () => generalReceiptsApi.suggestions({ q, vendor: vendorId || undefined }),
    enabled: q.length >= 2,
    staleTime: 60_000,
    meta: { suppressGlobalError: true },
  });
  const suggestions = suggestQ.data ?? [];
  const [returned, setReturned] = useState(Boolean(line.gate_pass_line));
  const openLinesQ = useQuery({
    queryKey: ["general-receipts", "open-gate-pass-lines", vendorId, partyName, plant],
    queryFn: () => generalReceiptsApi.openGatePassLines({ vendor: vendorId || undefined, party: vendorId ? undefined : partyName || undefined, plant: plant || undefined }),
    enabled: returned,
    meta: { suppressGlobalError: true },
  });
  const byPlant = useMemo(() => {
    const groups = new Map<string, MachineOption[]>();
    for (const m of machines) groups.set(m.plant_name, [...(groups.get(m.plant_name) ?? []), m]);
    return Array.from(groups.entries());
  }, [machines]);

  const applySuggestion = (description: string) => {
    const hit = suggestions.find((s) => s.description === description);
    if (!hit) return;
    onChange({
      description: hit.description,
      line_category: hit.line_category,
      uom: hit.uom,
      ...(line.rate ? {} : hit.last_rate ? { rate: String(Number(hit.last_rate)) } : {}),
      ...(hit.last_gst_rate ? { gst_rate: String(Number(hit.last_gst_rate)) } : {}),
    });
  };

  return (
    <li className="rounded-2xl border border-line bg-surface-1 p-3" aria-label={`Line ${index + 1}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[12px] font-semibold uppercase tracking-[0.06em] text-content-3">Line {index + 1}</span>
        {canRemove ? (
          <button type="button" onClick={onRemove} aria-label={`Remove line ${index + 1}`} className="flex h-10 w-10 items-center justify-center rounded-lg text-danger-fg hover:bg-danger-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border">
            <Trash2 className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-6">
        <label className={cn(labelClass, "sm:col-span-4")}>
          Description
          <input
            list={`${id}-suggest`}
            value={line.description}
            onChange={(e) => {
              onChange({ description: e.target.value });
              applySuggestion(e.target.value);
            }}
            maxLength={255}
            placeholder="e.g. Barrel teflon seal 65 mm"
            className={cn(fieldClass, "mt-1")}
            aria-invalid={Boolean(err("description")) || undefined}
          />
          <datalist id={`${id}-suggest`}>
            {suggestions.map((s) => (
              <option key={s.description} value={s.description}>{`${s.vendor_name} · ${s.last_rate ? `₹${Number(s.last_rate)}/${s.uom}` : s.uom} · ${s.number}`}</option>
            ))}
          </datalist>
          <FieldError message={err("description")} />
        </label>
        <label className={cn(labelClass, "sm:col-span-2")}>
          Type
          <select value={line.line_category} onChange={(e) => onChange({ line_category: e.target.value as LineCategory })} className={cn(fieldClass, "mt-1")}>
            {Object.entries(LINE_CATEGORY_LABEL).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </select>
        </label>
        <label className={labelClass}>
          Qty
          <input inputMode="decimal" value={line.quantity} onChange={(e) => onChange({ quantity: decimal(e.target.value) })} className={cn(fieldClass, "mt-1 tabular-nums")} aria-invalid={Boolean(err("quantity")) || undefined} />
          <FieldError message={err("quantity")} />
        </label>
        <label className={labelClass}>
          Unit
          <select value={line.uom} onChange={(e) => onChange({ uom: e.target.value })} className={cn(fieldClass, "mt-1")}>
            {GENERAL_UOMS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
          <FieldError message={err("uom")} />
        </label>
        <label className={labelClass}>
          Rate (₹)
          <input inputMode="decimal" value={line.rate} onChange={(e) => onChange({ rate: decimal(e.target.value) })} className={cn(fieldClass, "mt-1 tabular-nums")} />
        </label>
        <div className={labelClass}>
          Amount
          <div className="mt-1 flex h-11 items-center rounded-xl border border-dashed border-line px-3 text-[14px] tabular-nums text-content-1" aria-live="polite">{amount !== null ? inr(amount) : "—"}</div>
          <FieldError message={err("amount")} />
        </div>
        <label className={labelClass}>
          GST %
          <select value={line.gst_rate} onChange={(e) => onChange({ gst_rate: e.target.value })} className={cn(fieldClass, "mt-1")}>
            <option value="">Not shown</option>
            {GST_RATES.map((g) => <option key={g} value={g}>{g}%</option>)}
          </select>
          <FieldError message={err("gst_rate")} />
        </label>
        <label className={labelClass}>
          What happened
          <select value={line.disposition} onChange={(e) => onChange({ disposition: e.target.value as Disposition })} className={cn(fieldClass, "mt-1")}>
            {Object.entries(DISPOSITION_LABEL).map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </select>
        </label>
        <label className={cn(labelClass, "sm:col-span-3")}>
          Machine
          <select value={line.machine} onChange={(e) => onChange({ machine: e.target.value })} className={cn(fieldClass, "mt-1")} aria-invalid={Boolean(err("machine")) || undefined}>
            <option value="">{machines.length ? "No machine / not listed" : "No machines at this factory"}</option>
            {byPlant.map(([plantName, rows]) => (
              <optgroup key={plantName} label={plantName}>
                {rows.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.code}){m.status !== "ACTIVE" ? ` · ${m.status.toLowerCase()}` : ""}</option>)}
              </optgroup>
            ))}
          </select>
          <FieldError message={err("machine")} />
        </label>
        {!line.machine ? (
          <label className={cn(labelClass, "sm:col-span-3")}>
            Equipment (if not a listed machine)
            <input value={line.equipment_text} onChange={(e) => onChange({ equipment_text: e.target.value })} maxLength={160} placeholder="e.g. Compressor room, weighbridge" className={cn(fieldClass, "mt-1")} />
          </label>
        ) : (
          <div className="hidden sm:col-span-3 sm:block" />
        )}
        <label className={cn(labelClass, "sm:col-span-3")}>
          Serial / asset tag (optional)
          <input value={line.serial_no} onChange={(e) => onChange({ serial_no: e.target.value })} maxLength={80} className={cn(fieldClass, "mt-1 font-mono")} />
        </label>
        <label className={cn(labelClass, "sm:col-span-3")}>
          Remarks (optional)
          <input value={line.remarks} onChange={(e) => onChange({ remarks: e.target.value })} maxLength={255} className={cn(fieldClass, "mt-1")} />
        </label>
      </div>

      <div className="mt-3 rounded-xl border border-line bg-surface-2/60 p-3">
        <label className="flex min-h-[40px] cursor-pointer items-center gap-2 text-[13px] font-semibold text-content-1">
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={returned}
            onChange={(e) => {
              setReturned(e.target.checked);
              if (!e.target.checked) onChange({ gate_pass_line: "", returned_quantity: "" });
            }}
          />
          Came back on a returnable gate pass (RGP)
        </label>
        {returned ? (
          <GatePassPicker
            loading={openLinesQ.isLoading}
            error={openLinesQ.isError ? openLinesQ.error : null}
            rows={openLinesQ.data}
            value={line.gate_pass_line}
            returnedQuantity={line.returned_quantity}
            onChange={(patch) => onChange(patch)}
            onRetry={() => void openLinesQ.refetch()}
            err={err}
          />
        ) : null}
      </div>
    </li>
  );
}

function GatePassPicker({
  loading,
  error,
  rows,
  value,
  returnedQuantity,
  onChange,
  onRetry,
  err,
}: {
  loading: boolean;
  error: unknown;
  rows: OpenGatePassLine[] | null | undefined;
  value: string;
  returnedQuantity: string;
  onChange: (patch: Partial<LineDraft>) => void;
  onRetry: () => void;
  err: (key: string) => string | undefined;
}) {
  if (loading) return <p className="mt-2 text-[12.5px] text-content-3"><Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />Loading open gate passes…</p>;
  if (error) return <div className="mt-2"><ErrorBanner error={error} onRetry={onRetry} title="Could not load open gate passes." /></div>;
  if (rows === null)
    return <p className="mt-2 text-[12.5px] text-content-3">Gate passes are not available on this server yet. Save the receipt without it; the gate pass can be closed from its own page later.</p>;
  if (!rows || !rows.length)
    return <p className="mt-2 text-[12.5px] text-content-3">No open returnable gate pass for this party and factory. Choose the vendor first, or check Gate passes.</p>;
  const chosen = rows.find((r) => r.line_id === value);
  return (
    <div className="mt-2 grid gap-3 sm:grid-cols-4">
      <label className={cn(labelClass, "sm:col-span-3")}>
        Gate pass line
        <select value={value} onChange={(e) => onChange({ gate_pass_line: e.target.value })} className={cn(fieldClass, "mt-1")} aria-invalid={Boolean(err("gate_pass_line")) || undefined}>
          <option value="">Choose the line that came back</option>
          {rows.map((r) => (
            <option key={r.line_id} value={r.line_id}>
              {r.gate_pass_number} · line {r.line_no} · {r.description} · {r.outstanding_quantity} {r.uom} still out{r.machine_name ? ` · ${r.machine_name}` : ""}
            </option>
          ))}
        </select>
        <FieldError message={err("gate_pass_line")} />
      </label>
      <label className={labelClass}>
        Qty back{chosen ? ` (${chosen.uom})` : ""}
        <input inputMode="decimal" value={returnedQuantity} placeholder={chosen?.outstanding_quantity} onChange={(e) => onChange({ returned_quantity: decimal(e.target.value) })} className={cn(fieldClass, "mt-1 tabular-nums")} aria-invalid={Boolean(err("returned_quantity") || err("quantity")) || undefined} />
        <FieldError message={err("returned_quantity")} />
      </label>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Calculator, Loader2, RotateCcw, Save } from "lucide-react";

import { Panel } from "@/components/premium";
import { getApiErrorStatus } from "@/lib/api";
import { cn } from "@/lib/utils";
import { gateErrorMessage, gateFieldErrors, useGateOperation } from "@/components/gate/use-gate-operation";
import { CATEGORY_META, DOCUMENT_TYPE_LABEL, gateBillsApi, type DocumentCategory, type DocumentHeaderInput, type DocumentType, type InwardBill } from "@/services/gate-bills";
import { FieldError, PlantSelect, VendorPicker, fieldClass, labelClass, type PartyValue } from "@/components/documents-register/shared";
import { billDate, inr, localIsoDate } from "./bill-common";

type HeaderForm = {
  docType: DocumentType | "";
  category: DocumentCategory | "";
  party: PartyValue;
  invoice: string;
  invoiceDate: string;
  taxable: string;
  tax: string;
  total: string;
  dueDate: string;
  validUntil: string;
  shipTo: string;
  notes: string;
};

function fromBill(bill: InwardBill): HeaderForm {
  return {
    docType: (bill.doc_type as DocumentType) || "",
    category: (bill.category as DocumentCategory) || "",
    party: { vendorId: bill.vendor ?? null, vendorName: bill.vendor_name ?? "", partyName: bill.vendor ? "" : bill.party_name ?? "" },
    invoice: bill.invoice_number ?? "",
    invoiceDate: bill.invoice_date ?? "",
    taxable: bill.taxable_amount ?? "",
    tax: bill.tax_amount ?? "",
    total: bill.total_amount ?? "",
    dueDate: bill.due_date ?? "",
    validUntil: bill.valid_until ?? "",
    shipTo: bill.ship_to_plant ?? "",
    notes: bill.notes ?? "",
  };
}

const money = (value: string) => value.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");
const num = (value: string) => (value.trim() === "" ? null : Number(value));

/**
 * Office-entered header for one document. Saves with the header_version the
 * form was loaded from; a concurrent edit is refused (409) instead of being
 * silently overwritten.
 */
export function ClassifyCard({ bill, editable, onDirtyChange }: { bill: InwardBill; editable: boolean; onDirtyChange: (dirty: boolean) => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState<HeaderForm>(() => fromBill(bill));
  const [dirty, setDirty] = useState(false);
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange]);
  // Adopt server values when not editing (another user, a GRN or a receipt may have filled them).
  useEffect(() => {
    if (!dirty) setForm(fromBill(bill));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bill.header_version, bill.id, dirty]);

  const op = useGateOperation<DocumentHeaderInput & { header_version: number }, InwardBill>({
    send: (payload) => gateBillsApi.classify(bill.id, payload),
    onSaved: (saved) => {
      qc.setQueryData(["inventory", "gate-bills", "detail", bill.id], saved);
      setDirty(false);
      return Promise.all([qc.invalidateQueries({ queryKey: ["inventory", "gate-bills"] }), qc.invalidateQueries({ queryKey: ["documents"] })]);
    },
  });
  const conflict = op.phase === "rejected" && getApiErrorStatus(op.error) === 409;
  useEffect(() => {
    if (conflict) void qc.invalidateQueries({ queryKey: ["inventory", "gate-bills", "detail", bill.id] });
  }, [conflict, qc, bill.id]);
  const errors = op.phase === "rejected" && !conflict ? gateFieldErrors(op.error) : {};

  const set = <K extends keyof HeaderForm>(key: K, value: HeaderForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setDirty(true);
    if (op.phase === "saved" || op.phase === "rejected") op.reset();
  };

  const sum = useMemo(() => {
    const a = num(form.taxable);
    const b = num(form.tax);
    return a !== null && b !== null && Number.isFinite(a) && Number.isFinite(b) ? Math.round((a + b) * 100) / 100 : null;
  }, [form.taxable, form.tax]);
  const totalNum = num(form.total);
  const mismatch = sum !== null && totalNum !== null && Math.abs(sum - totalNum) > 1;
  const clientErrors: Record<string, string> = {};
  if (form.invoiceDate && form.dueDate && form.dueDate < form.invoiceDate) clientErrors.due_date = "Due date is before the bill date.";
  if (form.invoiceDate && form.validUntil && form.validUntil < form.invoiceDate) clientErrors.valid_until = "Valid-until is before the bill date.";
  if (mismatch) clientErrors.total_amount = `Taxable + tax = ${inr(sum)}, more than ₹1 away from the total.`;
  const blocked = Object.keys(clientErrors).length > 0;

  const save = () => {
    if (op.phase === "uncertain") return void op.retry();
    if (blocked) return;
    void op.submit({
      header_version: bill.header_version ?? 0,
      doc_type: form.docType,
      category: form.category,
      vendor_id: form.party.vendorId,
      party_name: form.party.vendorId ? "" : form.party.partyName.trim(),
      invoice_number: form.invoice.trim(),
      invoice_date: form.invoiceDate || null,
      taxable_amount: form.taxable.trim() || null,
      tax_amount: form.tax.trim() || null,
      total_amount: form.total.trim() || null,
      due_date: form.dueDate || null,
      valid_until: form.validUntil || null,
      ship_to_plant: form.shipTo || null,
      notes: form.notes.trim(),
    });
  };

  if (!editable) return <HeaderSummary bill={bill} />;
  const err = (key: string) => clientErrors[key] || errors[key];

  return (
    <Panel title="What is this paper?" description="Typed from the pages beside this form. Saving never receives or posts anything.">
      <fieldset disabled={op.locked} className="space-y-4">
        <label className={labelClass}>
          Document type
          <select value={form.docType} onChange={(e) => set("docType", e.target.value as DocumentType | "")} className={cn(fieldClass, "mt-1")}>
            <option value="">Choose type</option>
            {Object.entries(DOCUMENT_TYPE_LABEL).map(([code, label]) => (
              <option key={code} value={code}>{label}</option>
            ))}
          </select>
          <FieldError message={errors.doc_type} />
        </label>

        <div role="radiogroup" aria-label="Category" className="space-y-1.5">
          <span className={labelClass}>Category — decides the next step</span>
          <div className="grid gap-2 sm:grid-cols-2">
            {(Object.keys(CATEGORY_META) as DocumentCategory[]).map((code) => {
              const meta = CATEGORY_META[code];
              const on = form.category === code;
              return (
                <label key={code} className={cn("flex min-h-[64px] cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 transition-colors focus-within:ring-2 focus-within:ring-info-border", on ? "border-primary bg-info-bg" : "border-line hover:bg-surface-2")}>
                  <input type="radio" name={`category-${bill.id}`} className="mt-1 h-4 w-4" checked={on} onChange={() => set("category", code)} />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-semibold text-content-1">{meta.label}</span>
                    <span className="block text-[12px] leading-snug text-content-3">{meta.next}</span>
                  </span>
                </label>
              );
            })}
          </div>
          <FieldError message={errors.category} />
        </div>

        <VendorPicker value={form.party} onChange={(value) => set("party", value)} error={errors.vendor_id || errors.party_name} />

        <div className="grid gap-3 sm:grid-cols-2">
          <label className={labelClass}>
            Bill / invoice number
            <input value={form.invoice} onChange={(e) => set("invoice", e.target.value)} maxLength={80} className={cn(fieldClass, "mt-1 font-mono")} aria-invalid={Boolean(errors.invoice_number) || undefined} />
            <FieldError message={errors.invoice_number} />
          </label>
          <label className={labelClass}>
            Bill date
            <input type="date" value={form.invoiceDate} max={localIsoDate()} onChange={(e) => set("invoiceDate", e.target.value)} className={cn(fieldClass, "mt-1")} aria-invalid={Boolean(errors.invoice_date) || undefined} />
            <FieldError message={errors.invoice_date} />
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className={labelClass}>
            Taxable (₹)
            <input inputMode="decimal" value={form.taxable} onChange={(e) => set("taxable", money(e.target.value))} className={cn(fieldClass, "mt-1 tabular-nums")} />
          </label>
          <label className={labelClass}>
            Tax (₹)
            <input inputMode="decimal" value={form.tax} onChange={(e) => set("tax", money(e.target.value))} className={cn(fieldClass, "mt-1 tabular-nums")} />
          </label>
          <label className={labelClass}>
            Total (₹)
            <input inputMode="decimal" value={form.total} onChange={(e) => set("total", money(e.target.value))} className={cn(fieldClass, "mt-1 tabular-nums")} aria-invalid={Boolean(err("total_amount")) || undefined} />
            <FieldError message={err("total_amount")} />
          </label>
        </div>
        {sum !== null && String(sum) !== form.total ? (
          <button type="button" onClick={() => set("total", sum.toFixed(2))} className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg px-2 text-[12.5px] font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border">
            <Calculator className="h-4 w-4" /> Set total = taxable + tax ({inr(sum)})
          </button>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className={labelClass}>
            Payment due date (optional)
            <input type="date" value={form.dueDate} onChange={(e) => set("dueDate", e.target.value)} className={cn(fieldClass, "mt-1")} aria-invalid={Boolean(err("due_date")) || undefined} />
            <span className="mt-1 block font-normal text-content-4">Reminder from 3 days before.</span>
            <FieldError message={err("due_date")} />
          </label>
          <label className={labelClass}>
            Valid until (licence / AMC, optional)
            <input type="date" value={form.validUntil} onChange={(e) => set("validUntil", e.target.value)} className={cn(fieldClass, "mt-1")} aria-invalid={Boolean(err("valid_until")) || undefined} />
            <span className="mt-1 block font-normal text-content-4">Renewal reminders at 60, 30 and 7 days.</span>
            <FieldError message={err("valid_until")} />
          </label>
        </div>

        <div>
          <PlantSelect value={form.shipTo} onChange={(value) => set("shipTo", value)} label="Shipped to (if not this factory)" allLabel={`Same as bill factory (${bill.plant_name})`} />
          <span className="mt-1 block text-[12px] text-content-4">Use when the bill is addressed to {bill.plant_name} but the goods went to another factory. Receipts may then be recorded there.</span>
          <FieldError message={errors.ship_to_plant} />
        </div>

        <label className={labelClass}>
          Note
          <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} maxLength={500} rows={2} className={cn(fieldClass, "mt-1 h-auto py-2")} />
        </label>
      </fieldset>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={(!dirty && op.phase !== "uncertain") || op.phase === "sending" || blocked}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-primary px-4 text-[13px] font-semibold text-primary-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border"
        >
          {op.phase === "sending" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {op.phase === "uncertain" ? "Save again (same request)" : "Save details"}
        </button>
        {dirty && !op.locked ? (
          <button
            type="button"
            onClick={() => {
              setForm(fromBill(bill));
              setDirty(false);
              op.reset();
            }}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-3 text-[13px] font-semibold text-content-3 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border"
          >
            <RotateCcw className="h-4 w-4" /> Discard changes
          </button>
        ) : null}
        {op.phase === "saved" ? <span role="status" className="text-[12.5px] font-medium text-success-fg">Details saved.</span> : null}
        {conflict ? <span role="alert" className="text-[12.5px] font-medium text-warning-fg">Someone else saved this document while you were editing. Their values are loaded behind your edits — check them, then save again or discard yours.</span> : null}
        {op.phase === "rejected" && !conflict && !Object.keys(errors).length ? <span role="alert" className="text-[12.5px] font-medium text-danger-fg">{gateErrorMessage(op.error)}</span> : null}
        {op.phase === "uncertain" ? <span role="alert" className="text-[12.5px] font-medium text-warning-fg">Not confirmed: {gateErrorMessage(op.error)} Saving again sends the same request.</span> : null}
      </div>
    </Panel>
  );
}

function HeaderSummary({ bill }: { bill: InwardBill }) {
  const rows: Array<[string, React.ReactNode]> = [
    ["Type", bill.doc_type_label || "—"],
    ["Category", bill.category_label || "Not classified"],
    ["Party", bill.party_display || "—"],
    ["Bill no.", bill.invoice_number ? <span className="font-mono">{bill.invoice_number}</span> : "—"],
    ["Bill date", billDate(bill.invoice_date)],
    ["Taxable · tax", `${inr(bill.taxable_amount)} · ${inr(bill.tax_amount)}`],
    ["Total", inr(bill.total_amount)],
  ];
  if (bill.due_date) rows.push(["Due", billDate(bill.due_date)]);
  if (bill.valid_until) rows.push(["Valid until", billDate(bill.valid_until)]);
  if (bill.ship_to_plant_name) rows.push(["Shipped to", bill.ship_to_plant_name]);
  if (bill.original_invoice_ref) rows.push(["Original invoice", bill.original_invoice_ref]);
  if (bill.notes) rows.push(["Note", bill.notes]);
  return (
    <Panel title="Bill details" description={bill.classified_by_name ? `Last saved by ${bill.classified_by_name}.` : undefined}>
      <dl className="grid grid-cols-[minmax(0,140px)_minmax(0,1fr)] gap-x-3 gap-y-2 text-[13px]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-content-3">{label}</dt>
            <dd className="min-w-0 break-words text-content-1">{value}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

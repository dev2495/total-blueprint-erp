"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2, Loader2, PackageCheck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Panel, PanelEmpty } from "@/components/premium";
import { cn } from "@/lib/utils";
import { jobWorkApi, type JobWorkLinkBillPayload, type JobWorkUnbilledReturn, type JobWorkUom } from "@/services/job-work";

import { Chip, ErrorBanner, Field, fieldErrors, fmtDateTime, fmtInr, fmtKg, fmtNum, inputClass, isUncertain, JobWorkStatusPill, jobWorkError, newClientToken, Notice, toNumber } from "./job-work-common";

const UOMS: JobWorkUom[] = ["PCS", "KG", "METER", "ROLL"];

/**
 * Bill mode, "Already received — link this bill": a job worker's bill that
 * arrives after the material (often after the order closed, or a monthly bill
 * for several returns) is linked to returns received without one. Saved in one
 * transaction with a frozen retry token; differences are warnings only.
 */
export function BillLinkReturns({ billId, vendorId }: { billId: string; vendorId: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const listQ = useQuery({
    queryKey: ["jobwork", "unbilled-returns", billId, vendorId],
    queryFn: () => jobWorkApi.unbilledReturns({ bill: billId, vendor: vendorId || undefined }),
    enabled: Boolean(vendorId),
    retry: false,
    meta: { suppressGlobalError: true },
  });
  const rows = useMemo(() => listQ.data?.results ?? [], [listQ.data]);
  const bill = listQ.data?.bill ?? null;
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [billing, setBilling] = useState<{ qty: string; uom: JobWorkUom | ""; rate: string; amount: string; complete: boolean }>({ qty: "", uom: "", rate: "", amount: "", complete: false });
  const [failure, setFailure] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pendingRetry, setPendingRetry] = useState(false);
  const frozen = useRef<JobWorkLinkBillPayload | null>(null);

  const chosen = useMemo(() => rows.filter((row) => selected[row.id] && !row.blocked_reason), [rows, selected]);
  const totals = useMemo(
    () => ({ pcs: chosen.reduce((sum, row) => sum + row.output_pcs, 0), kg: chosen.reduce((sum, row) => sum + toNumber(row.output_kg), 0) }),
    [chosen],
  );
  const uom: JobWorkUom = billing.uom || (chosen.some((row) => row.output_pcs > 0) || (!chosen.length && rows.some((row) => row.output_pcs > 0)) ? "PCS" : "KG");
  const warnings = useMemo(() => liveWarnings(chosen, billing, uom, bill?.taxable_amount ?? null), [chosen, billing, uom, bill?.taxable_amount]);
  const selectable = rows.filter((row) => !row.blocked_reason);
  const allSelected = selectable.length > 0 && selectable.every((row) => selected[row.id]);
  // While a possibly-committed attempt is pending, the form is frozen so a retry resends it unchanged.
  const locked = pendingRetry;
  const linkLabel = chosen.length ? `Link bill to ${chosen.length} return${chosen.length === 1 ? "" : "s"}` : "Link bill";

  const mutation = useMutation({
    mutationFn: (payload: JobWorkLinkBillPayload) => jobWorkApi.linkBill(payload),
    onSuccess: (result) => {
      frozen.current = null;
      setPendingRetry(false);
      qc.invalidateQueries({ queryKey: ["jobwork"] });
      qc.invalidateQueries({ queryKey: ["inventory", "gate-bills"] });
      toast.success(`Bill linked to ${result.return_count} return${result.return_count === 1 ? "" : "s"}${result.replayed ? " (already saved)" : ""}.`);
      for (const warning of result.warnings) toast.warning(warning.message);
      router.push(`/inventory/gate-bills/${billId}`);
    },
    onError: (error) => {
      const uncertain = isUncertain(error);
      if (!uncertain) frozen.current = null;
      setPendingRetry(uncertain);
      setErrors(fieldErrors(error));
      setFailure(jobWorkError(error, "The bill was not linked."));
      if (!uncertain) void listQ.refetch();
    },
  });

  const toggle = (id: string, on: boolean) => {
    if (locked) return;
    setSelected((prev) => ({ ...prev, [id]: on }));
  };

  const submit = () => {
    const local: Record<string, string> = {};
    if (!chosen.length) local.return_ids = "Tick the returns this bill charges for.";
    for (const [field, value] of [["billed_qty", billing.qty], ["billed_rate", billing.rate], ["billed_amount", billing.amount]] as const) {
      if (value && !(toNumber(value) >= 0 && /^\d+(\.\d+)?$/.test(value.trim()))) local[field] = "Enter a number (no commas), or leave it blank.";
    }
    setErrors(local);
    if (Object.keys(local).length) {
      setFailure(Object.values(local)[0]);
      return;
    }
    setFailure(null);
    const payload: JobWorkLinkBillPayload = frozen.current ?? {
      client_token: newClientToken(),
      bill_id: billId,
      return_ids: chosen.map((row) => row.id),
      billed_qty: billing.qty.trim() || null,
      billed_uom: billing.qty.trim() ? uom : "",
      billed_rate: billing.rate.trim() || null,
      billed_amount: billing.amount.trim() || null,
      complete: billing.complete,
    };
    frozen.current = payload;
    mutation.mutate(payload);
  };

  const setQty = (qty: string) => setBilling((prev) => ({ ...prev, qty, amount: prev.rate && qty ? (toNumber(qty) * toNumber(prev.rate)).toFixed(2) : prev.amount }));
  const setRate = (rate: string) => setBilling((prev) => ({ ...prev, rate, amount: prev.qty && rate ? (toNumber(prev.qty) * toNumber(rate)).toFixed(2) : prev.amount }));

  return (
    <Panel
      title="Already received — link this bill"
      icon={<Link2 />}
      description={`Returns from ${listQ.data?.vendor.name || "this job worker"} that came back without a bill, on open or closed orders. Tick the ones this bill charges for; a monthly bill can cover several returns and orders.`}
      bodyClassName="space-y-3"
    >
      {!vendorId ? null : listQ.isError ? (
        <ErrorBanner message={jobWorkError(listQ.error, "Returns waiting for a bill could not load.")} onRetry={() => void listQ.refetch()} />
      ) : listQ.isLoading ? (
        <div className="space-y-2" aria-busy="true">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="h-[68px] animate-pulse rounded-2xl bg-surface-2" />
          ))}
        </div>
      ) : bill && !bill.open ? (
        <Notice tone="bad" title="This bill is already closed">Open it from Bills &amp; documents to see what it is linked to.</Notice>
      ) : !rows.length ? (
        <PanelEmpty icon={<PackageCheck />} title={`Nothing from ${listQ.data?.vendor.name || "this job worker"} is waiting for a bill`}>
          Returns booked with a bill, or linked to one already, are not listed. If the material has not come back yet, pick its order above.
        </PanelEmpty>
      ) : (
        <>
          {failure ? <ErrorBanner message={failure} /> : null}
          {pendingRetry ? (
            <Notice tone="warn">
              The last attempt may have reached the server. Linking again resends the same request, so the bill cannot be linked twice.{" "}
              <button type="button" className="font-semibold underline-offset-2 hover:underline" onClick={() => { frozen.current = null; setPendingRetry(false); setFailure(null); }}>
                Start over with my edits
              </button>
            </Notice>
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-content-3">
            <label className="inline-flex min-h-[44px] items-center gap-2 font-semibold text-content-2">
              <input type="checkbox" className="h-4 w-4" checked={allSelected} disabled={locked || !selectable.length} onChange={(e) => setSelected(Object.fromEntries(selectable.map((row) => [row.id, e.target.checked])))} />
              Select all ({selectable.length})
            </label>
            <span className="tabular-nums">
              {chosen.length} selected · {fmtNum(totals.pcs)} pcs · {fmtKg(totals.kg)}
            </span>
          </div>
          {errors.return_ids ? <p className="text-[12.5px] text-danger-fg" role="alert">{String(errors.return_ids)}</p> : null}
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line" aria-label="Returns without a bill">
            {rows.map((row) => (
              <ReturnRow key={row.id} row={row} checked={Boolean(selected[row.id])} disabled={locked || Boolean(row.blocked_reason)} onChange={(on) => toggle(row.id, on)} />
            ))}
          </ul>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Billed quantity" error={errors.billed_qty} htmlFor="jw-late-qty">
              <div className="flex gap-2">
                <input id="jw-late-qty" inputMode="decimal" value={billing.qty} disabled={locked} onChange={(e) => setQty(e.target.value)} placeholder={uom === "PCS" ? String(totals.pcs || "") : totals.kg ? totals.kg.toFixed(3) : ""} className={inputClass} />
                <select aria-label="Billed unit" value={uom} disabled={locked} onChange={(e) => setBilling((prev) => ({ ...prev, uom: e.target.value as JobWorkUom }))} className={cn(inputClass, "w-24")}>
                  {UOMS.map((unit) => (
                    <option key={unit} value={unit}>
                      {unit}
                    </option>
                  ))}
                </select>
              </div>
            </Field>
            <Field label="Billed rate (₹)" error={errors.billed_rate} htmlFor="jw-late-rate" hint={chosen[0]?.order_rate ? `Agreed ₹${chosen[0].order_rate}/${chosen[0].order_rate_uom.toLowerCase()}` : undefined}>
              <input id="jw-late-rate" inputMode="decimal" value={billing.rate} disabled={locked} onChange={(e) => setRate(e.target.value)} className={inputClass} />
            </Field>
            <Field label="Taxable amount (₹)" error={errors.billed_amount} htmlFor="jw-late-amount" hint={bill?.taxable_amount ? `Bill header: ${fmtInr(bill.taxable_amount)}` : undefined}>
              <input id="jw-late-amount" inputMode="decimal" value={billing.amount} disabled={locked} onChange={(e) => setBilling((prev) => ({ ...prev, amount: e.target.value }))} className={inputClass} />
            </Field>
            <label className="flex min-h-[44px] items-center gap-2 self-end text-[13px] text-content-2">
              <input type="checkbox" className="h-4 w-4" checked={billing.complete} disabled={locked} onChange={(e) => setBilling((prev) => ({ ...prev, complete: e.target.checked }))} />
              Bill complete — nothing more is charged on it
            </label>
          </div>
          {warnings.length ? (
            <Notice tone="warn" title="Check before linking (saved as warnings; they do not block)">
              <ul className="list-disc pl-4">
                {warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </Notice>
          ) : null}
          <div className="flex flex-col gap-2 border-t border-line pt-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[12.5px] text-content-3">Linking moves no stock. The bill shows these returns as its receipts{billing.complete ? " and is marked complete" : ""}.</p>
            <Button type="button" onClick={submit} disabled={mutation.isPending || !chosen.length} className="min-h-[44px]" data-testid="jobwork-link-bill">
              {mutation.isPending ? <Loader2 className="animate-spin" /> : <Link2 />}
              {pendingRetry ? "Retry link" : linkLabel}
            </Button>
          </div>
        </>
      )}
    </Panel>
  );
}

function ReturnRow({ row, checked, disabled, onChange }: { row: JobWorkUnbilledReturn; checked: boolean; disabled: boolean; onChange: (on: boolean) => void }) {
  return (
    <li>
      <label className={cn("flex min-h-[68px] items-start gap-3 px-3 py-3 sm:px-4", disabled ? "opacity-70" : "cursor-pointer hover:bg-surface-2")}>
        <input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-label={`Link ${row.number}`} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[13px] font-semibold text-content-1">{row.number}</span>
            <span className="text-[12px] text-content-3">{fmtDateTime(row.received_at)}</span>
            <JobWorkStatusPill status={row.order_status} />
          </span>
          <span className="mt-0.5 block truncate text-[12.5px] text-content-2">
            {row.order_number}
            {row.production_job_number ? ` · ${row.production_job_number}` : ""}
            {row.process_name ? ` · ${row.process_name}` : ""}
            {row.vendor_document_no ? ` · their doc ${row.vendor_document_no}` : ""}
          </span>
          {row.blocked_reason ? <span className="mt-0.5 block text-[12px] text-danger-fg">{row.blocked_reason}</span> : null}
        </span>
        <span className="shrink-0 text-right text-[12.5px] tabular-nums">
          {row.output_pcs ? <span className="block font-semibold text-content-1">{fmtNum(row.output_pcs)} pcs</span> : null}
          <span className={cn("block", row.output_pcs ? "text-content-3" : "font-semibold text-content-1")}>{fmtKg(row.output_kg)}</span>
          {row.order_rate ? <Chip>₹{row.order_rate}/{row.order_rate_uom.toLowerCase()}</Chip> : null}
        </span>
      </label>
    </li>
  );
}

/** Mirrors the server's bill-level checks (warnings only). */
function liveWarnings(chosen: JobWorkUnbilledReturn[], billing: { qty: string; rate: string; amount: string }, uom: JobWorkUom, taxable: string | null): string[] {
  const out: string[] = [];
  if (!chosen.length) return out;
  const qty = toNumber(billing.qty);
  const rate = toNumber(billing.rate);
  const amount = toNumber(billing.amount);
  const noun = `the ${chosen.length} selected return${chosen.length === 1 ? "" : "s"}`;
  if (billing.qty) {
    if (uom === "PCS") {
      const pcs = chosen.reduce((sum, row) => sum + row.output_pcs, 0);
      if (qty !== pcs) out.push(`The bill charges ${fmtNum(qty)} pcs but ${noun} received ${fmtNum(pcs)} pcs.`);
    } else if (uom === "KG") {
      const kg = chosen.reduce((sum, row) => sum + toNumber(row.output_kg), 0);
      if (Math.abs(qty - kg) > 0.5) out.push(`The bill charges ${fmtNum(qty)} kg but ${noun} received ${fmtKg(kg)} of output.`);
    }
  }
  if (billing.rate) {
    const agreed = new Map<string, string[]>();
    const cards = new Set<string>();
    const seen = new Set<string>();
    for (const row of chosen) {
      if (seen.has(row.order_id)) continue;
      seen.add(row.order_id);
      if (row.order_rate && (!row.order_rate_uom || row.order_rate_uom === uom) && Math.abs(toNumber(row.order_rate) - rate) > 0.00005) {
        const key = `${row.order_rate}|${row.order_rate_uom || uom}`;
        agreed.set(key, [...(agreed.get(key) ?? []), row.order_number]);
      }
      const card = row.vendor_rate;
      if (card && card.uom === uom && !cards.has(`${card.process_code}|${card.uom}`)) {
        cards.add(`${card.process_code}|${card.uom}`);
        if (Math.abs(toNumber(card.rate) - rate) > 0.00005) out.push(`Billed rate ₹${billing.rate} differs from the rate card ₹${card.rate} per ${card.uom.toLowerCase()}.`);
      }
    }
    agreed.forEach((orders, key) => {
      const [agreedRate, agreedUom] = key.split("|");
      out.push(`Billed rate ₹${billing.rate} differs from the ₹${agreedRate} per ${agreedUom.toLowerCase()} agreed on ${orders.join(", ")}.`);
    });
  }
  if (billing.qty && billing.rate && billing.amount && Math.abs(qty * rate - amount) > 1) out.push(`Amount ₹${billing.amount} is not ${billing.qty} × ₹${billing.rate} = ${fmtInr(qty * rate)}.`);
  if (billing.amount && taxable !== null && Math.abs(toNumber(taxable) - amount) > 1) out.push(`The bill's taxable value ${fmtInr(taxable)} differs from the job-work amount ${fmtInr(amount)}.`);
  return out;
}

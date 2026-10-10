"use client";

import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Search, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { jobWorkApi, type JobWorkDispatchPayload, type JobWorkEligibleBulk, type JobWorkOrderDetail } from "@/services/job-work";

import { ErrorBanner, Field, fmtInr, fmtKg, inputClass, isUncertain, jobWorkError, newClientToken, todayIso, toNumber } from "./job-work-common";

type BulkRow = { key: string; source: JobWorkEligibleBulk; quantity: string; value: string };

/** Send rolls / bulk to the job worker: issues a numbered Rule 45 challan (JWC) with a gate QR. */
export function DispatchDialog({ order, open, onOpenChange, onPrint }: { order: JobWorkOrderDetail; open: boolean; onOpenChange: (open: boolean) => void; onPrint: (url: string) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[94dvh] w-[calc(100vw-16px)] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Send material to {order.vendor_name}</DialogTitle>
          <DialogDescription>
            Pick the rolls going out. Saving issues a job-work challan (GST Rule 45) with a QR for the gate; the rolls move to the job worker until a return settles them.
          </DialogDescription>
        </DialogHeader>
        {open ? <DispatchForm order={order} onDone={() => onOpenChange(false)} onPrint={onPrint} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function DispatchForm({ order, onDone, onPrint }: { order: JobWorkOrderDetail; onDone: () => void; onPrint: (url: string) => void }) {
  const qc = useQueryClient();
  const [scope, setScope] = useState<"job" | "plant">(order.production_job ? "job" : "plant");
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<Record<string, string>>({}); // roll id → value
  const [bulkRows, setBulkRows] = useState<BulkRow[]>([]);
  const [bulkChoice, setBulkChoice] = useState("");
  const [hsn, setHsn] = useState("3920");
  const [purpose, setPurpose] = useState(`Job work – ${order.process?.name || "processing"}`);
  const [returnDate, setReturnDate] = useState(order.expected_return_date || "");
  const [vehicle, setVehicle] = useState("");
  const [notes, setNotes] = useState("");
  const [failure, setFailure] = useState<string | null>(null);
  const [pendingRetry, setPendingRetry] = useState(false);
  const frozen = useRef<JobWorkDispatchPayload | null>(null);

  const rollsQ = useQuery({
    queryKey: ["jobwork", "eligible-rolls", order.id, scope, search],
    queryFn: () => jobWorkApi.eligibleRolls(order.id, { scope, search: search.trim() || undefined }),
    meta: { suppressGlobalError: true },
  });
  const bulkQ = useQuery({ queryKey: ["jobwork", "eligible-bulk", order.id], queryFn: () => jobWorkApi.eligibleBulk(order.id), meta: { suppressGlobalError: true } });
  const rolls = rollsQ.data?.results || [];
  const rollById = useMemo(() => new Map(rolls.map((roll) => [roll.id, roll])), [rolls]);
  const [pickedMeta, setPickedMeta] = useState<Record<string, { label: string; kg: number }>>({});

  const toggleRoll = (id: string) => {
    const roll = rollById.get(id);
    setPicked((prev) => {
      const next = { ...prev };
      if (id in next) delete next[id];
      else next[id] = roll?.suggested_value || "";
      return next;
    });
    if (roll) setPickedMeta((prev) => ({ ...prev, [id]: { label: roll.label_id, kg: toNumber(roll.weight_kg) } }));
  };
  const pickedIds = Object.keys(picked);
  const totalKg = pickedIds.reduce((sum, id) => sum + (pickedMeta[id]?.kg || 0), 0) + bulkRows.filter((row) => row.source.uom === "KG").reduce((sum, row) => sum + toNumber(row.quantity), 0);
  const totalValue = pickedIds.reduce((sum, id) => sum + toNumber(picked[id]), 0) + bulkRows.reduce((sum, row) => sum + toNumber(row.value), 0);
  const missingValue = pickedIds.filter((id) => !(toNumber(picked[id]) > 0));

  const addBulk = () => {
    const source = (bulkQ.data || []).find((row) => `${row.material_id}|${row.location_id}|${row.granule_code_id || ""}` === bulkChoice);
    if (!source) return;
    setBulkRows((prev) => [...prev, { key: `${bulkChoice}|${Date.now()}`, source, quantity: "", value: "" }]);
    setBulkChoice("");
  };

  const mutation = useMutation({
    mutationFn: (payload: JobWorkDispatchPayload) => jobWorkApi.dispatch(order.id, payload),
    onSuccess: (result) => {
      frozen.current = null;
      setPendingRetry(false);
      qc.setQueryData(["jobwork", "detail", order.id], result.order);
      qc.invalidateQueries({ queryKey: ["jobwork"] });
      const challan = result.order.challans.find((row) => row.id === result.challan_id);
      toast.success(`Challan ${result.challan_number} issued${result.replayed ? " (already saved)" : ""}.`, {
        action: challan ? { label: "Print", onClick: () => onPrint(challan.pdf_url) } : undefined,
      });
      onDone();
    },
    onError: (error) => {
      const uncertain = isUncertain(error);
      if (!uncertain) frozen.current = null;
      setPendingRetry(uncertain);
      setFailure(jobWorkError(error, "Nothing was sent."));
    },
  });

  const submit = () => {
    if (!pickedIds.length && !bulkRows.length) return setFailure("Pick at least one roll or add a bulk quantity.");
    if (!/^[0-9]{4,8}$/.test(hsn.trim())) return setFailure("Enter the HSN code (4 to 8 digits) printed on the challan.");
    if (missingValue.length) return setFailure(`Enter the value of ${missingValue.map((id) => pickedMeta[id]?.label || id).join(", ")} — Rule 45 challans show the value of goods.`);
    const badBulk = bulkRows.find((row) => !(toNumber(row.quantity) > 0) || toNumber(row.quantity) > toNumber(row.source.quantity));
    if (badBulk) return setFailure(`${badBulk.source.material_name}: quantity must be more than 0 and at most ${badBulk.source.quantity} ${badBulk.source.uom}.`);
    setFailure(null);
    const payload: JobWorkDispatchPayload = frozen.current ?? {
      client_token: newClientToken(),
      rolls: pickedIds.map((id) => ({ roll_id: id, value: picked[id] || null })),
      bulk_items: bulkRows.map((row) => ({
        material_id: row.source.material_id,
        location_id: row.source.location_id,
        granule_code_id: row.source.granule_code_id,
        quantity: row.quantity,
        value: row.value || null,
      })),
      hsn_code: hsn.trim(),
      purpose: purpose.trim(),
      expected_return_date: returnDate || null,
      vehicle_no: vehicle.trim(),
      notes: notes.trim(),
    };
    frozen.current = payload;
    mutation.mutate(payload);
  };

  return (
    <div className="space-y-4">
      {failure ? <ErrorBanner message={failure} /> : null}
      {pendingRetry ? (
        <p className="text-[12.5px] text-content-3" role="status">
          The last attempt may have reached the server. Pressing Issue challan again resends the same challan, so it cannot be issued twice.{" "}
          <button type="button" className="font-semibold text-primary hover:underline" onClick={() => { frozen.current = null; setPendingRetry(false); setFailure(null); }}>
            Start over with my edits
          </button>
        </p>
      ) : null}

      <section aria-label="Rolls" className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative min-w-[220px] flex-1">
            <span className="sr-only">Search rolls</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-4" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Roll label, material or job" className={cn(inputClass, "pl-9")} />
          </label>
          {order.production_job ? (
            <select aria-label="Which rolls" value={scope} onChange={(e) => setScope(e.target.value as "job" | "plant")} className={cn(inputClass, "w-auto")}>
              <option value="job">Rolls of {order.production_job.job_number}</option>
              <option value="plant">All rolls at {order.plant_name}</option>
            </select>
          ) : null}
        </div>
        {rollsQ.isError ? <ErrorBanner message={jobWorkError(rollsQ.error, "Rolls could not load.")} onRetry={() => void rollsQ.refetch()} /> : null}
        <div className="max-h-[42dvh] overflow-auto rounded-xl border border-line">
          {rollsQ.isLoading ? (
            <div className="h-24 animate-pulse bg-surface-2" />
          ) : rolls.length ? (
            <table className="w-full min-w-[640px] text-[13px]">
              <thead className="sticky top-0 bg-surface-2 text-left text-[11.5px] uppercase tracking-wide text-content-3">
                <tr>
                  <th className="w-10 px-3 py-2"><span className="sr-only">Send</span></th>
                  <th className="px-2 py-2 font-semibold">Roll</th>
                  <th className="px-2 py-2 font-semibold">Material</th>
                  <th className="px-2 py-2 text-right font-semibold">Weight</th>
                  <th className="px-2 py-2 font-semibold">Location</th>
                  <th className="px-2 py-2 text-right font-semibold">Value (₹)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rolls.map((roll) => {
                  const checked = roll.id in picked;
                  return (
                    <tr key={roll.id} className={cn(roll.blocked_reason ? "opacity-60" : "", checked ? "bg-info-bg/40" : "")}>
                      <td className="px-3 py-1.5">
                        <input type="checkbox" aria-label={`Send ${roll.label_id}`} checked={checked} disabled={Boolean(roll.blocked_reason)} onChange={() => toggleRoll(roll.id)} />
                      </td>
                      <td className="px-2 py-1.5">
                        <span className="font-mono font-semibold">{roll.label_id}</span>
                        {roll.blocked_reason ? <span className="block text-[11.5px] text-danger-fg">{roll.blocked_reason}</span> : roll.production_job_number ? <span className="block text-[11.5px] text-content-3">{roll.production_job_number}</span> : null}
                      </td>
                      <td className="px-2 py-1.5">{roll.material_name}{roll.width_mm ? ` · ${roll.width_mm} mm` : ""}{roll.thickness_micron ? ` · ${roll.thickness_micron} µ` : ""}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{fmtKg(roll.weight_kg)}</td>
                      <td className="px-2 py-1.5">{roll.location_name}</td>
                      <td className="px-2 py-1.5 text-right">
                        {checked ? (
                          <input
                            aria-label={`Value of ${roll.label_id}`}
                            inputMode="decimal"
                            value={picked[roll.id]}
                            onChange={(e) => setPicked((prev) => ({ ...prev, [roll.id]: e.target.value }))}
                            className={cn(inputClass, "h-9 w-28 text-right", !(toNumber(picked[roll.id]) > 0) && "border-danger-border")}
                          />
                        ) : (
                          <span className="tabular-nums text-content-3">{roll.suggested_value ? fmtInr(roll.suggested_value) : "—"}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p className="p-4 text-[13px] text-content-3">No roll in stock matches. {scope === "job" ? "Switch to all rolls at the plant, or" : ""} check the search.</p>
          )}
        </div>
      </section>

      <section aria-label="Bulk material" className="space-y-2">
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Add bulk material (optional)" className="min-w-[240px] flex-1">
            <select value={bulkChoice} onChange={(e) => setBulkChoice(e.target.value)} className={inputClass}>
              <option value="">{bulkQ.isLoading ? "Loading bulk stock…" : "Choose material and location"}</option>
              {(bulkQ.data || []).map((row) => (
                <option key={`${row.material_id}|${row.location_id}|${row.granule_code_id || ""}`} value={`${row.material_id}|${row.location_id}|${row.granule_code_id || ""}`}>
                  {row.material_name}{row.granule_code ? ` (${row.granule_code})` : ""} · {row.location_name} · {row.quantity} {row.uom}
                </option>
              ))}
            </select>
          </Field>
          <Button type="button" variant="outline" onClick={addBulk} disabled={!bulkChoice} className="min-h-[44px]">
            <Plus /> Add
          </Button>
        </div>
        {bulkRows.map((row, index) => (
          <div key={row.key} className="grid items-end gap-2 rounded-xl border border-line p-2 sm:grid-cols-[minmax(0,1fr)_140px_140px_44px]">
            <div className="text-[13px]">
              <div className="font-semibold">{row.source.material_name}</div>
              <div className="text-[12px] text-content-3">{row.source.location_name} · {row.source.quantity} {row.source.uom} in stock</div>
            </div>
            <Field label={`Quantity (${row.source.uom})`}>
              <input inputMode="decimal" value={row.quantity} onChange={(e) => setBulkRows((prev) => prev.map((r, i) => (i === index ? { ...r, quantity: e.target.value, value: r.source.rate ? String((toNumber(r.source.rate) * toNumber(e.target.value)).toFixed(2)) : r.value } : r)))} className={inputClass} />
            </Field>
            <Field label="Value (₹)">
              <input inputMode="decimal" value={row.value} onChange={(e) => setBulkRows((prev) => prev.map((r, i) => (i === index ? { ...r, value: e.target.value } : r)))} className={inputClass} />
            </Field>
            <button type="button" aria-label={`Remove ${row.source.material_name}`} onClick={() => setBulkRows((prev) => prev.filter((_, i) => i !== index))} className="flex h-11 w-11 items-center justify-center rounded-xl border border-line text-content-3 hover:text-danger-fg">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </section>

      <section aria-label="Challan details" className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <Field label="HSN code" hint="Printed on every challan line (e.g. 3920 plastic film).">
          <input value={hsn} onChange={(e) => setHsn(e.target.value)} inputMode="numeric" className={inputClass} />
        </Field>
        <Field label="Purpose on the challan">
          <input value={purpose} onChange={(e) => setPurpose(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Expected back by">
          <input type="date" min={todayIso()} value={returnDate} onChange={(e) => setReturnDate(e.target.value)} className={inputClass} />
        </Field>
        <Field label="Vehicle number">
          <input value={vehicle} onChange={(e) => setVehicle(e.target.value.toUpperCase())} placeholder="DD03U9802" className={inputClass} />
        </Field>
        <Field label="Note on the challan" className="md:col-span-2 lg:col-span-4">
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" className={inputClass} />
        </Field>
      </section>

      <div className="sticky bottom-0 -mx-1 flex flex-col gap-2 rounded-xl border border-line bg-surface-1 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-[13px] text-content-2" aria-live="polite">
          <span className="font-semibold text-content-1">{pickedIds.length} roll{pickedIds.length === 1 ? "" : "s"}</span>
          {bulkRows.length ? ` + ${bulkRows.length} bulk line${bulkRows.length === 1 ? "" : "s"}` : ""} · {fmtKg(totalKg)} · {fmtInr(totalValue)}
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onDone} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={mutation.isPending || (!pickedIds.length && !bulkRows.length)} data-testid="jobwork-dispatch-submit">
            {mutation.isPending ? <Loader2 className="animate-spin" /> : <Send />}
            {pendingRetry ? "Retry challan" : "Issue challan"}
          </Button>
        </div>
      </div>
    </div>
  );
}

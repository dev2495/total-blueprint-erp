"use client";

import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCheck, Loader2, PackageCheck, Plus, Scale, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useBillWorkspaceLayout } from "@/components/documents/bill-workspace";
import { Panel } from "@/components/premium";
import { cn } from "@/lib/utils";
import { masterDataService } from "@/services/master-data";
import { recipeService } from "@/services/recipes";
import type { InwardBill } from "@/services/gate-bills";
import { jobWorkApi, type JobWorkActionResult, type JobWorkOrderDetail, type JobWorkReturnPayload, type JobWorkSentLine, type JobWorkUom, type SentDisposition } from "@/services/job-work";

import { Chip, ErrorBanner, Field, fieldErrors, fmtInr, fmtKg, fmtNum, inputClass, isUncertain, jobWorkError, newClientToken, Notice, pickLocation, toNumber, usePlantLocations } from "./job-work-common";

type LineState = { disposition: "" | SentDisposition; returned: string; consumed: string; location: string };
type RollRow = { key: string; material_id: string; weight_kg: string; width_mm: string; thickness_micron: string; grade_id: string; label_id: string; location_id: string };
type BulkRow = { key: string; material_id: string; quantity: string; location_id: string };

function nowLocal() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
let rowSeq = 0;
const nextKey = () => `row-${++rowSeq}`;

/**
 * Receive job work back. One submission = one numbered return (JWR):
 * every sent roll it covers is settled (used up / back unused / partly used),
 * outputs become stock (FG batch, rolls, bulk), wastage is logged against the
 * job and — when opened from a bill — the bill is linked in the same save.
 */
export function ReceivePanel({ order, bill, onDone, onCancel }: { order: JobWorkOrderDetail; bill: InwardBill | null; onDone: (result: JobWorkActionResult) => void; onCancel: () => void }) {
  const qc = useQueryClient();
  const layout = useBillWorkspaceLayout();
  // Beside a docked bill the form pane is about half the screen, so multi-column
  // rows only open up on very wide screens.
  const docked = layout.paneScroll;
  const wideGrid = docked ? "sm:grid-cols-2 2xl:grid-cols-4" : "sm:grid-cols-2 lg:grid-cols-4";
  const openLines = useMemo(() => order.sent_lines.filter((line) => line.is_open), [order.sent_lines]);
  const locationsQ = usePlantLocations(order.plant);
  const locations = locationsQ.data || [];
  const defaultBalanceLoc = pickLocation(locations, "RM")?.id || "";
  const defaultFgLoc = pickLocation(locations, "FG")?.id || "";
  const defaultWipLoc = pickLocation(locations, "WIP")?.id || "";
  const billHeader = bill as (InwardBill & { invoice_number?: string | null; invoice_date?: string | null; taxable_amount?: string | null }) | null;

  const [receivedAt, setReceivedAt] = useState(nowLocal());
  const [docNo, setDocNo] = useState(billHeader?.invoice_number || String(bill?.review_data?.invoice_number || ""));
  const [docDate, setDocDate] = useState(billHeader?.invoice_date || String(bill?.review_data?.invoice_date || "") || "");
  const [lines, setLines] = useState<Record<string, LineState>>({});
  const [fgOn, setFgOn] = useState(order.expected_output_kind === "FG_PCS");
  const [fg, setFg] = useState({ pcs: "", boxes: "", kg: "", location: "", inner: "FACTORY" as "FACTORY" | "VENDOR" });
  const [rolls, setRolls] = useState<RollRow[]>(order.expected_output_kind === "ROLLS" ? [{ key: nextKey(), material_id: "", weight_kg: "", width_mm: "", thickness_micron: "", grade_id: "", label_id: "", location_id: "" }] : []);
  const [bulk, setBulk] = useState<BulkRow[]>(order.expected_output_kind === "BULK" ? [{ key: nextKey(), material_id: "", quantity: "", location_id: "" }] : []);
  const [wasteOn, setWasteOn] = useState(true);
  const [waste, setWaste] = useState({ kg: "", bags: "", returned: true, notes: "" });
  const [varianceReason, setVarianceReason] = useState("");
  const [billing, setBilling] = useState({ qty: "", uom: (order.rate_uom || (order.expected_output_kind === "FG_PCS" ? "PCS" : "KG")) as JobWorkUom, rate: order.rate || "", amount: "", complete: false });
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pendingRetry, setPendingRetry] = useState(false);
  const frozen = useRef<JobWorkReturnPayload | null>(null);

  const filmsQ = useQuery({ queryKey: ["materials-variants"], queryFn: masterDataService.getFilmVariants, enabled: rolls.length > 0, staleTime: 5 * 60_000, meta: { suppressGlobalError: true } });
  const gradesQ = useQuery({ queryKey: ["recipe-grades"], queryFn: () => recipeService.getGrades(), enabled: rolls.length > 0, staleTime: 5 * 60_000, meta: { suppressGlobalError: true } });
  const films = filmsQ.data || [];
  const filmById = useMemo(() => new Map(films.map((film) => [String(film.id), film])), [films]);
  const bulkMaterials = useMemo(() => {
    const map = new Map<string, string>();
    for (const line of order.sent_lines) if (line.kind === "BULK" && line.material_id) map.set(line.material_id, line.material_name);
    return Array.from(map.entries());
  }, [order.sent_lines]);

  const blankLine: LineState = { disposition: "", returned: "", consumed: "", location: "" };
  const setLine = (id: string, patch: Partial<LineState>) => setLines((prev) => ({ ...prev, [id]: { ...blankLine, ...(prev[id] || {}), ...patch } }));
  const markAllUsed = () => setLines(Object.fromEntries(openLines.map((line) => [line.id, { disposition: "PROCESSED" as SentDisposition, returned: "", consumed: line.kind === "BULK" ? line.open_qty : "", location: "" }])));

  /* ------------------------------------------------ live material balance */
  const unitWeight = toNumber(order.production_job?.unit_weight_g);
  const fgKg = fgOn ? (fg.kg ? toNumber(fg.kg) : (toNumber(fg.pcs) * unitWeight) / 1000) : 0;
  const balance = useMemo(() => {
    let settled = 0;
    let returned = 0;
    let closesAll = true;
    for (const line of openLines) {
      const state = lines[line.id];
      const perKg = toNumber(line.quantity) > 0 ? toNumber(line.qty_kg) / toNumber(line.quantity) : 0;
      if (!state?.disposition) {
        closesAll = false;
        continue;
      }
      if (line.kind === "ROLL") {
        settled += toNumber(line.open_kg);
        if (state.disposition === "RETURNED") returned += toNumber(line.open_kg);
        if (state.disposition === "PARTLY_USED") returned += toNumber(state.returned);
      } else {
        const consumed = state.disposition === "RETURNED" ? 0 : state.disposition === "PROCESSED" && !state.consumed ? toNumber(line.open_qty) : toNumber(state.consumed);
        const back = state.disposition === "PROCESSED" ? 0 : state.disposition === "RETURNED" && !state.returned ? toNumber(line.open_qty) : toNumber(state.returned);
        settled += (consumed + back) * perKg;
        returned += back * perKg;
        if (consumed + back < toNumber(line.open_qty) - 0.0005) closesAll = false;
      }
    }
    const output = fgKg + rolls.reduce((sum, row) => sum + toNumber(row.weight_kg), 0) + bulk.reduce((sum, row) => sum + toNumber(row.quantity), 0);
    const wastage = wasteOn ? toNumber(waste.kg) : 0;
    const variance = settled - (output + returned + wastage);
    const prior = order.totals;
    const cumSettled = toNumber(prior.settled_kg) + settled;
    const cumVariance = cumSettled - (toNumber(prior.output_kg) + toNumber(prior.balance_kg) + toNumber(prior.wastage_kg) + output + returned + wastage);
    const cumPct = cumSettled > 0 ? (cumVariance / cumSettled) * 100 : null;
    const tolerance = toNumber(order.wastage_tolerance_pct);
    return { settled, returned, output, wastage, variance, pct: settled > 0 ? (variance / settled) * 100 : null, cumPct, cumVariance, closesAll: closesAll && openLines.length > 0, tolerance };
  }, [openLines, lines, fgKg, rolls, bulk, wasteOn, waste.kg, order.totals, order.wastage_tolerance_pct]);
  const needReason = (balance.closesAll || openLines.length === 0) && balance.cumPct !== null && Math.abs(balance.cumPct) > balance.tolerance;

  /* ----------------------------------------------------- bill preview */
  const billWarnings = useMemo(() => {
    if (!bill) return [] as string[];
    const out: string[] = [];
    const qty = toNumber(billing.qty);
    const rate = toNumber(billing.rate);
    if (billing.qty && billing.uom === "PCS" && fgOn && qty !== toNumber(fg.pcs)) out.push(`Bill charges ${fmtNum(qty)} pcs; you are receiving ${fmtNum(fg.pcs)} pcs.`);
    if (billing.rate && order.rate && billing.uom === order.rate_uom && Math.abs(rate - toNumber(order.rate)) > 0.00005) out.push(`Billed rate ₹${billing.rate} differs from the agreed ₹${order.rate} per ${order.rate_uom.toLowerCase()}.`);
    if (billing.rate && order.vendor_rate && billing.uom === order.vendor_rate.uom && Math.abs(rate - toNumber(order.vendor_rate.rate)) > 0.00005) out.push(`Billed rate differs from the rate card (₹${order.vendor_rate.rate}).`);
    if (billing.qty && billing.rate && billing.amount && Math.abs(qty * rate - toNumber(billing.amount)) > 1) out.push(`Amount ₹${billing.amount} is not ${billing.qty} × ₹${billing.rate} = ${fmtInr(qty * rate)}.`);
    return out;
  }, [bill, billing, fgOn, fg.pcs, order.rate, order.rate_uom, order.vendor_rate]);

  /* ------------------------------------------------------------ submit */
  const mutation = useMutation({
    mutationFn: (payload: JobWorkReturnPayload) => jobWorkApi.receive(order.id, payload),
    onSuccess: (result) => {
      frozen.current = null;
      setPendingRetry(false);
      qc.setQueryData(["jobwork", "detail", order.id], result.order);
      qc.invalidateQueries({ queryKey: ["jobwork"] });
      if (bill) qc.invalidateQueries({ queryKey: ["inventory", "gate-bills"] });
      toast.success(`Return ${result.return_number} saved${result.replayed ? " (already saved)" : ""}.`);
      for (const warning of result.warnings || []) toast.warning(warning.message);
      onDone(result);
    },
    onError: (error) => {
      const uncertain = isUncertain(error);
      if (!uncertain) frozen.current = null;
      setPendingRetry(uncertain);
      setErrors(fieldErrors(error));
      setFailure(jobWorkError(error, "Nothing was received."));
    },
  });

  const validate = () => {
    const local: Record<string, string> = {};
    const chosen = openLines.filter((line) => lines[line.id]?.disposition);
    for (const line of chosen) {
      const state = lines[line.id];
      if (line.kind === "ROLL" && state.disposition === "PARTLY_USED" && !(toNumber(state.returned) > 0 && toNumber(state.returned) < toNumber(line.open_kg))) {
        local.sent_lines = `${line.roll_label}: the balance roll must weigh more than 0 and less than ${line.open_kg} kg.`;
      }
      if (line.kind === "BULK" && state.disposition === "PARTLY_USED" && !(toNumber(state.consumed) + toNumber(state.returned) > 0)) {
        local.sent_lines = `${line.material_name}: enter the used and returned quantities.`;
      }
    }
    if (fgOn) {
      if (!(toNumber(fg.pcs) > 0)) local.fg = "Enter the pieces received.";
      else if (!fg.kg && unitWeight <= 0) local.fg = "This job has no unit weight; enter the weight of the pieces in kg.";
    }
    rolls.forEach((row, index) => {
      if (!row.material_id || !(toNumber(row.weight_kg) > 0) || !(toNumber(row.width_mm) > 0) || !(toNumber(row.thickness_micron) > 0)) local.output_rolls = `Output roll ${index + 1}: choose the film and enter weight, width and micron.`;
      else if (filmById.get(row.material_id)?.is_extrudable && !row.grade_id) local.output_rolls = `Output roll ${index + 1}: choose the grade.`;
    });
    bulk.forEach((row, index) => {
      if (!row.material_id || !(toNumber(row.quantity) > 0)) local.output_bulk = `Bulk line ${index + 1}: choose the material and quantity.`;
    });
    if (wasteOn && waste.kg && !(toNumber(waste.kg) > 0)) local.wastage = "Wastage must be more than zero, or switch it off.";
    if (!chosen.length && !fgOn && !rolls.length && !bulk.length && !(wasteOn && toNumber(waste.kg) > 0)) local.sent_lines = "Record what came back: settle sent rolls, add output or wastage.";
    if (needReason && !varianceReason.trim()) local.variance_reason = "Explain the difference before saving.";
    if (bill && billing.amount && !(toNumber(billing.amount) >= 0)) local.bill = "Enter the billed amount as a number.";
    return local;
  };

  const submit = () => {
    const local = validate();
    setErrors(local);
    if (Object.keys(local).length) {
      setFailure(Object.values(local)[0]);
      return;
    }
    setFailure(null);
    const payload: JobWorkReturnPayload = frozen.current ?? {
      client_token: newClientToken(),
      received_at: receivedAt ? new Date(receivedAt).toISOString() : null,
      vendor_document_no: docNo.trim(),
      vendor_document_date: docDate || null,
      sent_lines: openLines
        .filter((line) => lines[line.id]?.disposition)
        .map((line) => {
          const state = lines[line.id];
          const location = state.location || defaultBalanceLoc;
          if (line.kind === "ROLL") {
            return {
              sent_line_id: line.id,
              disposition: state.disposition as SentDisposition,
              returned_qty: state.disposition === "PARTLY_USED" ? state.returned : null,
              location_id: state.disposition === "PROCESSED" ? null : location,
            };
          }
          return {
            sent_line_id: line.id,
            disposition: state.disposition as SentDisposition,
            consumed_qty: state.consumed || null,
            returned_qty: state.returned || null,
            location_id: state.disposition === "PROCESSED" ? null : location,
          };
        }),
      fg: fgOn
        ? { qty_pcs: Math.round(toNumber(fg.pcs)), boxes: fg.boxes ? Math.round(toNumber(fg.boxes)) : null, qty_kg: fg.kg || null, location_id: fg.location || defaultFgLoc, inner_pack_source: fg.inner }
        : null,
      output_rolls: rolls.map((row) => ({
        material_id: row.material_id,
        weight_kg: row.weight_kg,
        width_mm: row.width_mm,
        thickness_micron: row.thickness_micron,
        grade_id: row.grade_id || null,
        label_id: row.label_id.trim(),
        location_id: row.location_id || defaultWipLoc,
      })),
      output_bulk: bulk.map((row) => ({ material_id: row.material_id, quantity: row.quantity, location_id: row.location_id || defaultWipLoc })),
      wastage: wasteOn && toNumber(waste.kg) > 0 ? { kg: waste.kg, bags: waste.bags ? Math.round(toNumber(waste.bags)) : null, returned_to_factory: waste.returned, notes: waste.notes.trim() } : null,
      variance_reason: varianceReason.trim(),
      bill: bill
        ? { bill_id: bill.id, billed_qty: billing.qty || null, billed_uom: billing.qty ? billing.uom : "", billed_rate: billing.rate || null, billed_amount: billing.amount || null, complete: billing.complete }
        : null,
      notes: notes.trim(),
    };
    frozen.current = payload;
    mutation.mutate(payload);
  };

  const locationSelect = (value: string, onChange: (v: string) => void, fallback: string, label: string) => (
    <select aria-label={label} value={value || fallback} onChange={(e) => onChange(e.target.value)} className={inputClass}>
      {locations.map((loc) => (
        <option key={loc.id} value={loc.id}>
          {loc.name}
        </option>
      ))}
    </select>
  );

  return (
    <div className="space-y-4 pb-2" data-testid="jobwork-receive-panel">
      <Panel title={`Receive from ${order.vendor_name}`} icon={<PackageCheck />} description={`${order.number} · expects ${order.expected_output_label.toLowerCase()}${order.expected_qty ? ` (${fmtNum(order.expected_qty)} ${order.expected_uom})` : ""}. Settle every roll the job worker processed or sent back.`} bodyClassName="space-y-3">
        {failure ? <ErrorBanner message={failure} /> : null}
        {pendingRetry ? (
          <Notice tone="warn">
            The last attempt may have reached the server. Saving again resends the same return, so it cannot post twice.{" "}
            <button type="button" className="font-semibold underline-offset-2 hover:underline" onClick={() => { frozen.current = null; setPendingRetry(false); setFailure(null); }}>
              Start over with my edits
            </button>
          </Notice>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Received on" htmlFor="jwr-at">
            <input id="jwr-at" type="datetime-local" value={receivedAt} max={nowLocal()} onChange={(e) => setReceivedAt(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Job worker's challan / bill no." htmlFor="jwr-doc" error={errors.vendor_document_no}>
            <input id="jwr-doc" value={docNo} onChange={(e) => setDocNo(e.target.value)} placeholder="JW/0001" className={inputClass} />
          </Field>
          <Field label="Its date" htmlFor="jwr-docdate">
            <input id="jwr-docdate" type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} className={inputClass} />
          </Field>
        </div>
      </Panel>

      <Panel
        title="Sent material"
        description="For each roll still at the job worker: used up, came back unused, or partly used (enter the balance weight). Leave a roll on 'Still there' if it has not come back yet."
        actions={openLines.length ? (
          <Button type="button" variant="outline" size="sm" onClick={markAllUsed}>
            <CheckCheck /> Mark all used up
          </Button>
        ) : null}
        bodyClassName="space-y-2"
      >
        {errors.sent_lines ? <p className="text-[12.5px] text-danger-fg" role="alert">{errors.sent_lines}</p> : null}
        {openLines.length ? (
          <ul className="divide-y divide-line rounded-xl border border-line">
            {openLines.map((line) => (
              <SentLineRow key={line.id} docked={docked} line={line} state={lines[line.id]} onChange={(patch) => setLine(line.id, patch)} locationSelect={(value, onChange) => locationSelect(value, onChange, defaultBalanceLoc, `Back in stock at, ${line.roll_label || line.material_name}`)} />
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-content-3">Nothing is left at the job worker. You can still book late output or wastage.</p>
        )}
      </Panel>

      <Panel title="What came back" description="Output becomes normal stock: pieces as an FG batch for packing and dispatch, rolls with lineage from the rolls used." bodyClassName="space-y-4">
        <div className="flex flex-wrap gap-2">
          <ToggleChip on={fgOn} onClick={() => setFgOn((v) => !v)} label="Finished pieces" disabled={!order.production_job?.has_template} />
          <ToggleChip on={rolls.length > 0} onClick={() => setRolls((prev) => (prev.length ? [] : [{ key: nextKey(), material_id: "", weight_kg: "", width_mm: "", thickness_micron: "", grade_id: "", label_id: "", location_id: "" }]))} label="Output rolls" />
          <ToggleChip on={bulk.length > 0} onClick={() => setBulk((prev) => (prev.length ? [] : [{ key: nextKey(), material_id: "", quantity: "", location_id: "" }]))} label="Bulk output" disabled={!bulkMaterials.length} />
        </div>
        {!order.production_job?.has_template && order.expected_output_kind === "FG_PCS" ? (
          <Notice tone="warn">Finished pieces need a production job with a product template; this order has none.</Notice>
        ) : null}
        {fgOn ? (
          <fieldset className="space-y-2 rounded-xl border border-line p-3">
            <legend className="px-1 text-[12px] font-semibold text-content-2">Finished pieces</legend>
            {errors.fg ? <p className="text-[12.5px] text-danger-fg" role="alert">{errors.fg}</p> : null}
            <div className={cn("grid gap-3", wideGrid)}>
              <Field label="Pieces" htmlFor="jwr-pcs">
                <input id="jwr-pcs" inputMode="numeric" value={fg.pcs} onChange={(e) => setFg((p) => ({ ...p, pcs: e.target.value }))} placeholder="24000" className={inputClass} />
              </Field>
              <Field label="Boxes / bags" htmlFor="jwr-boxes" hint="Kept on the batch; the packing yard packs from it.">
                <input id="jwr-boxes" inputMode="numeric" value={fg.boxes} onChange={(e) => setFg((p) => ({ ...p, boxes: e.target.value }))} placeholder="72" className={inputClass} />
              </Field>
              <Field label="Weight (kg)" htmlFor="jwr-fgkg" hint={unitWeight > 0 ? `Blank = pieces × ${fmtNum(unitWeight)} g = ${fmtKg(((toNumber(fg.pcs) || 0) * unitWeight) / 1000)}` : "Required: the job has no unit weight."}>
                <input id="jwr-fgkg" inputMode="decimal" value={fg.kg} onChange={(e) => setFg((p) => ({ ...p, kg: e.target.value }))} className={inputClass} />
              </Field>
              <Field label="Store at">{locationSelect(fg.location, (v) => setFg((p) => ({ ...p, location: v })), defaultFgLoc, "FG location")}</Field>
            </div>
            {order.production_job?.inner_pack_enabled ? (
              <Field label="Inner packs" hint="The order packs pieces in inner packs. Factory store packs are consumed now, like an in-house final step.">
                <select value={fg.inner} onChange={(e) => setFg((p) => ({ ...p, inner: e.target.value as "FACTORY" | "VENDOR" }))} className={inputClass}>
                  <option value="FACTORY">Packed in our inner packs (consume from the store at the FG location)</option>
                  <option value="VENDOR">Packed in the job worker&apos;s own inner packs</option>
                </select>
              </Field>
            ) : null}
          </fieldset>
        ) : null}

        {rolls.length ? (
          <fieldset className="space-y-2 rounded-xl border border-line p-3">
            <legend className="px-1 text-[12px] font-semibold text-content-2">Output rolls</legend>
            {errors.output_rolls ? <p className="text-[12.5px] text-danger-fg" role="alert">{errors.output_rolls}</p> : null}
            {rolls.map((row, index) => {
              const film = filmById.get(row.material_id);
              const update = (patch: Partial<RollRow>) => setRolls((prev) => prev.map((r) => (r.key === row.key ? { ...r, ...patch } : r)));
              return (
                <div key={row.key} className="grid gap-2 rounded-lg bg-surface-2/60 p-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_minmax(0,1.3fr)_44px]">
                  <Field label={`Roll ${index + 1} film`}>
                    <select value={row.material_id} onChange={(e) => update({ material_id: e.target.value, grade_id: "" })} className={inputClass}>
                      <option value="">{filmsQ.isLoading ? "Loading films…" : "Choose film"}</option>
                      {films.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name || f.code}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Weight kg"><input inputMode="decimal" value={row.weight_kg} onChange={(e) => update({ weight_kg: e.target.value })} className={inputClass} /></Field>
                  <Field label="Width mm"><input inputMode="decimal" value={row.width_mm} onChange={(e) => update({ width_mm: e.target.value })} className={inputClass} /></Field>
                  <Field label="Micron"><input inputMode="decimal" value={row.thickness_micron} onChange={(e) => update({ thickness_micron: e.target.value })} className={inputClass} /></Field>
                  <Field label="Store at">{locationSelect(row.location_id, (v) => update({ location_id: v }), defaultWipLoc, `Roll ${index + 1} location`)}</Field>
                  <div className="flex items-end">
                    <button type="button" aria-label={`Remove output roll ${index + 1}`} onClick={() => setRolls((prev) => prev.filter((r) => r.key !== row.key))} className="flex h-11 w-11 items-center justify-center rounded-xl border border-line text-content-3 hover:text-danger-fg">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  {film?.is_extrudable ? (
                    <Field label="Grade" className="sm:col-span-2">
                      <select value={row.grade_id} onChange={(e) => update({ grade_id: e.target.value })} className={inputClass}>
                        <option value="">Choose grade</option>
                        {(gradesQ.data || []).map((grade) => (
                          <option key={grade.id} value={grade.id}>
                            {grade.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                  ) : null}
                  <Field label="Label (optional)" className="sm:col-span-2" hint="Blank = next roll number for the job.">
                    <input value={row.label_id} onChange={(e) => update({ label_id: e.target.value })} className={inputClass} />
                  </Field>
                </div>
              );
            })}
            <Button type="button" variant="outline" size="sm" onClick={() => setRolls((prev) => [...prev, { ...prev[prev.length - 1], key: nextKey(), weight_kg: "", label_id: "" }])}>
              <Plus /> Another roll
            </Button>
          </fieldset>
        ) : null}

        {bulk.length ? (
          <fieldset className="space-y-2 rounded-xl border border-line p-3">
            <legend className="px-1 text-[12px] font-semibold text-content-2">Bulk output</legend>
            {errors.output_bulk ? <p className="text-[12.5px] text-danger-fg" role="alert">{errors.output_bulk}</p> : null}
            {bulk.map((row, index) => {
              const update = (patch: Partial<BulkRow>) => setBulk((prev) => prev.map((r) => (r.key === row.key ? { ...r, ...patch } : r)));
              return (
                <div key={row.key} className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.3fr)_44px]">
                  <Field label={`Material ${index + 1}`}>
                    <select value={row.material_id} onChange={(e) => update({ material_id: e.target.value })} className={inputClass}>
                      <option value="">Choose material</option>
                      {bulkMaterials.map(([id, name]) => (
                        <option key={id} value={id}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Quantity"><input inputMode="decimal" value={row.quantity} onChange={(e) => update({ quantity: e.target.value })} className={inputClass} /></Field>
                  <Field label="Store at">{locationSelect(row.location_id, (v) => update({ location_id: v }), defaultWipLoc, `Bulk ${index + 1} location`)}</Field>
                  <div className="flex items-end">
                    <button type="button" aria-label={`Remove bulk line ${index + 1}`} onClick={() => setBulk((prev) => prev.filter((r) => r.key !== row.key))} className="flex h-11 w-11 items-center justify-center rounded-xl border border-line text-content-3 hover:text-danger-fg">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </fieldset>
        ) : null}

        <fieldset className="space-y-2 rounded-xl border border-line p-3">
          <legend className="px-1 text-[12px] font-semibold text-content-2">
            <label className="inline-flex items-center gap-2">
              <input type="checkbox" checked={wasteOn} onChange={(e) => setWasteOn(e.target.checked)} /> Wastage
            </label>
          </legend>
          {errors.wastage ? <p className="text-[12.5px] text-danger-fg" role="alert">{errors.wastage}</p> : null}
          {wasteOn ? (
            <div className={cn("grid gap-3", wideGrid)}>
              <Field label="Weight (kg)"><input inputMode="decimal" value={waste.kg} onChange={(e) => setWaste((p) => ({ ...p, kg: e.target.value }))} placeholder="120.5" className={inputClass} /></Field>
              <Field label="Bags"><input inputMode="numeric" value={waste.bags} onChange={(e) => setWaste((p) => ({ ...p, bags: e.target.value }))} placeholder="10" className={inputClass} /></Field>
              <Field label="Where is it?">
                <select value={waste.returned ? "yes" : "no"} onChange={(e) => setWaste((p) => ({ ...p, returned: e.target.value === "yes" }))} className={inputClass}>
                  <option value="yes">Returned to the factory</option>
                  <option value="no">Kept by the job worker</option>
                </select>
              </Field>
              <Field label="Note"><input value={waste.notes} onChange={(e) => setWaste((p) => ({ ...p, notes: e.target.value }))} className={inputClass} /></Field>
            </div>
          ) : null}
        </fieldset>
      </Panel>

      <Panel title="Material balance" icon={<Scale />} description={`Sent material settled now must equal output + balance back + wastage (tolerance ${order.wastage_tolerance_pct}%).`} bodyClassName="space-y-3">
        <div className="grid grid-cols-2 gap-2 text-[13px] sm:grid-cols-5" aria-live="polite">
          <Stat label="Settled now" value={fmtKg(balance.settled)} />
          <Stat label="Output" value={fmtKg(balance.output)} />
          <Stat label="Balance back" value={fmtKg(balance.returned)} />
          <Stat label="Wastage" value={fmtKg(balance.wastage)} />
          <Stat
            label="Difference"
            value={`${fmtKg(balance.variance)}${balance.pct !== null ? ` (${balance.pct.toFixed(1)}%)` : ""}`}
            tone={balance.pct !== null && Math.abs(balance.pct) > balance.tolerance ? "bad" : "good"}
          />
        </div>
        <BalanceMeter settled={balance.settled} output={balance.output} returned={balance.returned} wastage={balance.wastage} />
        {!balance.closesAll && openLines.length ? (
          <p className="text-[12.5px] text-content-3">Some material stays at the job worker; the full balance is checked when the last of it comes back.</p>
        ) : balance.cumPct !== null ? (
          <p className={cn("text-[12.5px]", needReason ? "text-danger-fg" : "text-content-3")}>
            Whole order after this return: difference {fmtKg(balance.cumVariance)} ({balance.cumPct.toFixed(1)}%).
          </p>
        ) : null}
        {needReason || varianceReason ? (
          <Field label="Why does the balance not match?" error={errors.variance_reason} htmlFor="jwr-var">
            <input id="jwr-var" value={varianceReason} onChange={(e) => setVarianceReason(e.target.value)} placeholder="e.g. Vendor kept 3 bags of trim; recovery note follows" className={inputClass} />
          </Field>
        ) : null}
      </Panel>

      {bill ? (
        <Panel title="Job worker's bill" description="Linked to this return in the same save. Differences are saved as warnings on the return; they do not block it." bodyClassName="space-y-3">
          {errors.bill ? <p className="text-[12.5px] text-danger-fg" role="alert">{errors.bill}</p> : null}
          <div className={cn("grid gap-3", wideGrid)}>
            <Field label="Billed quantity">
              <div className="flex gap-2">
                <input inputMode="decimal" value={billing.qty} onChange={(e) => setBilling((p) => ({ ...p, qty: e.target.value, amount: p.rate ? (toNumber(e.target.value) * toNumber(p.rate)).toFixed(2) : p.amount }))} placeholder={fg.pcs || "28825"} className={inputClass} />
                <select aria-label="Billed unit" value={billing.uom} onChange={(e) => setBilling((p) => ({ ...p, uom: e.target.value as JobWorkUom }))} className={cn(inputClass, "w-24")}>
                  {(["PCS", "KG", "METER", "ROLL"] as JobWorkUom[]).map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </div>
            </Field>
            <Field label="Billed rate (₹)" hint={order.rate ? `Agreed ₹${order.rate}/${order.rate_uom.toLowerCase()}` : undefined}>
              <input inputMode="decimal" value={billing.rate} onChange={(e) => setBilling((p) => ({ ...p, rate: e.target.value, amount: p.qty ? (toNumber(p.qty) * toNumber(e.target.value)).toFixed(2) : p.amount }))} className={inputClass} />
            </Field>
            <Field label="Taxable amount (₹)" hint={billHeader?.taxable_amount ? `Bill header: ${fmtInr(billHeader.taxable_amount)}` : undefined}>
              <input inputMode="decimal" value={billing.amount} onChange={(e) => setBilling((p) => ({ ...p, amount: e.target.value }))} className={inputClass} />
            </Field>
            <label className="flex min-h-[44px] items-center gap-2 self-end text-[13px] text-content-2">
              <input type="checkbox" checked={billing.complete} onChange={(e) => setBilling((p) => ({ ...p, complete: e.target.checked }))} />
              Bill complete — nothing more will be received against it
            </label>
          </div>
          {billWarnings.length ? (
            <Notice tone="warn" title="Check before saving">
              <ul className="list-disc pl-4">
                {billWarnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </Notice>
          ) : null}
        </Panel>
      ) : null}

      <Panel bodyClassName="space-y-2">
        <Field label="Note (optional)" htmlFor="jwr-notes">
          <input id="jwr-notes" value={notes} onChange={(e) => setNotes(e.target.value)} className={inputClass} />
        </Field>
      </Panel>

      <div
        className="sticky bottom-0 z-30 flex flex-col gap-2 rounded-2xl border border-line bg-surface-1 p-3 shadow-[0_-12px_30px_-12px_rgba(15,23,42,0.22)] sm:flex-row sm:items-center sm:justify-between"
        style={!layout.paneScroll && layout.sheetOffset ? { bottom: layout.sheetOffset } : undefined}
      >
        <div className="text-[12.5px] text-content-2">
          {Object.values(lines).filter((l) => l.disposition).length} sent line(s) settled · output {fmtKg(balance.output)}
          {fgOn && fg.pcs ? ` · ${fmtNum(fg.pcs)} pcs` : ""}
          {bill ? <Chip tone="info">Bill linked on save</Chip> : null}
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onCancel} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={mutation.isPending || locationsQ.isLoading} data-testid="jobwork-receive-submit">
            {mutation.isPending ? <Loader2 className="animate-spin" /> : <PackageCheck />}
            {pendingRetry ? "Retry save" : "Save return"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function ToggleChip({ on, onClick, label, disabled }: { on: boolean; onClick: () => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={disabled}
      onClick={onClick}
      className={cn("inline-flex min-h-[40px] items-center rounded-full border px-4 text-[13px] font-semibold disabled:opacity-40", on ? "border-primary bg-info-bg text-info-fg" : "border-line bg-surface-1 text-content-2 hover:bg-surface-2")}
    >
      {label}
    </button>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-xl border border-line bg-surface-2/60 px-3 py-2">
      <div className="text-[11.5px] text-content-3">{label}</div>
      <div className={cn("font-semibold tabular-nums", tone === "bad" ? "text-danger-fg" : tone === "good" ? "text-success-fg" : "text-content-1")}>{value}</div>
    </div>
  );
}

function BalanceMeter({ settled, output, returned, wastage }: { settled: number; output: number; returned: number; wastage: number }) {
  const total = Math.max(settled, output + returned + wastage, 0.0001);
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / total) * 100))}%`;
  const gap = Math.max(settled - (output + returned + wastage), 0);
  return (
    <div className="space-y-1" aria-hidden>
      <div className="flex h-3 overflow-hidden rounded-full bg-surface-2">
        <span className="bg-success" style={{ width: pct(output) }} />
        <span className="bg-info" style={{ width: pct(returned) }} />
        <span className="bg-warning" style={{ width: pct(wastage) }} />
        <span className="bg-danger-bg" style={{ width: pct(gap) }} />
      </div>
      <div className="flex flex-wrap gap-3 text-[11.5px] text-content-3">
        <span>■ output</span>
        <span>■ balance back</span>
        <span>■ wastage</span>
        <span>□ unexplained</span>
      </div>
    </div>
  );
}

function SentLineRow({ line, state, onChange, locationSelect, docked }: { line: JobWorkSentLine; state?: LineState; onChange: (patch: Partial<LineState>) => void; locationSelect: (value: string, onChange: (v: string) => void) => React.ReactNode; docked: boolean }) {
  const disposition = state?.disposition || "";
  return (
    <li
      className={cn(
        "grid gap-2 px-3 py-2.5 text-[13px]",
        docked
          ? "sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] 2xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.6fr)]"
          : "lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.6fr)]",
      )}
    >
      <div className="min-w-0">
        <div className="font-semibold text-content-1">
          {line.kind === "ROLL" ? <span className="font-mono">{line.roll_label}</span> : line.material_name}
          {line.itc04_alert ? <Chip tone="warn" title="At the job worker for 300+ days">ITC-04</Chip> : null}
        </div>
        <div className="text-[12px] text-content-3">
          {line.kind === "ROLL" ? `${line.material_name}${line.width_mm ? ` · ${line.width_mm} mm` : ""} · ` : ""}
          {fmtNum(line.open_qty)} {line.uom} open · {line.challan_number || "before upgrade"} · {line.age_days ?? 0} d
        </div>
      </div>
      <select aria-label={`What happened to ${line.roll_label || line.material_name}`} value={disposition} onChange={(e) => onChange({ disposition: e.target.value as LineState["disposition"] })} className={inputClass}>
        <option value="">Still at the job worker</option>
        <option value="PROCESSED">Used up</option>
        <option value="RETURNED">Came back unused</option>
        <option value="PARTLY_USED">Partly used</option>
      </select>
      <div className={cn("grid gap-2 sm:grid-cols-2", docked ? "empty:hidden sm:col-span-2 2xl:col-span-1" : "")}>
        {line.kind === "ROLL" && disposition === "PARTLY_USED" ? (
          <input aria-label={`Balance weight of ${line.roll_label} (kg)`} inputMode="decimal" value={state?.returned || ""} onChange={(e) => onChange({ returned: e.target.value })} placeholder={`Balance kg (< ${line.open_kg})`} className={inputClass} />
        ) : null}
        {line.kind === "BULK" && disposition && disposition !== "RETURNED" ? (
          <input aria-label={`Used quantity of ${line.material_name}`} inputMode="decimal" value={state?.consumed || ""} onChange={(e) => onChange({ consumed: e.target.value })} placeholder={`Used ${line.uom}${disposition === "PROCESSED" ? ` (blank = ${line.open_qty})` : ""}`} className={inputClass} />
        ) : null}
        {line.kind === "BULK" && (disposition === "RETURNED" || disposition === "PARTLY_USED") ? (
          <input aria-label={`Returned quantity of ${line.material_name}`} inputMode="decimal" value={state?.returned || ""} onChange={(e) => onChange({ returned: e.target.value })} placeholder={`Back ${line.uom}${disposition === "RETURNED" ? ` (blank = ${line.open_qty})` : ""}`} className={inputClass} />
        ) : null}
        {disposition === "RETURNED" || disposition === "PARTLY_USED" ? locationSelect(state?.location || "", (v) => onChange({ location: v })) : null}
      </div>
    </li>
  );
}

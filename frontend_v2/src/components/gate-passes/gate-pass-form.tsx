"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Loader2, Plus, Trash2, X } from "lucide-react";

import { gateFieldErrors, useGateOperation } from "@/components/gate/use-gate-operation";
import { ActionFeedback, LoadFailure, useDebounced } from "@/components/outward/document-rights";
import { Panel } from "@/components/premium";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { GATE_PASS_DEFAULT_PURPOSE, gatePassesApi, type GatePass, type GatePassFormOptions, type GatePassInput, type GatePassKind } from "@/services/gate-passes";

import { KIND_HELP } from "./gate-pass-common";

type LineDraft = { key: string; description: string; quantity: string; uom: string; machine: string; equipment_text: string; serial_no: string; approx_value: string; remarks: string };
type FormState = {
  kind: GatePassKind;
  plant: string;
  vendor: { id: string; name: string } | null;
  party_name: string;
  party_address: string;
  party_gstin: string;
  purpose: string;
  expected_return_date: string;
  vehicle_number: string;
  carried_by: string;
  notes: string;
  lines: LineDraft[];
};

const GSTIN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

let lineSeq = 0;
const newLine = (uom = "NOS"): LineDraft => ({ key: `gp-line-${++lineSeq}`, description: "", quantity: "1", uom, machine: "", equipment_text: "", serial_no: "", approx_value: "", remarks: "" });

function todayLocal() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function initialState(source?: GatePass | null): FormState {
  if (!source) {
    return { kind: "RETURNABLE", plant: "", vendor: null, party_name: "", party_address: "", party_gstin: "", purpose: GATE_PASS_DEFAULT_PURPOSE.RETURNABLE, expected_return_date: "", vehicle_number: "", carried_by: "", notes: "", lines: [newLine()] };
  }
  return {
    kind: source.kind,
    plant: source.plant,
    vendor: source.vendor ? { id: source.vendor, name: source.vendor_name } : null,
    party_name: source.vendor ? "" : source.party_name,
    party_address: source.party_address,
    party_gstin: source.party_gstin,
    purpose: source.purpose,
    expected_return_date: source.expected_return_date ?? "",
    vehicle_number: source.vehicle_number,
    carried_by: source.carried_by,
    notes: source.notes,
    lines: source.lines.map((line) => ({
      key: `gp-line-${++lineSeq}`,
      description: line.description,
      quantity: line.quantity,
      uom: line.uom,
      machine: line.machine ?? "",
      equipment_text: line.equipment_text,
      serial_no: line.serial_no,
      approx_value: line.approx_value ?? "",
      remarks: line.remarks,
    })),
  };
}

function toPayload(state: FormState): GatePassInput {
  return {
    kind: state.kind,
    plant: state.plant,
    vendor: state.vendor?.id ?? null,
    party_name: state.vendor ? state.vendor.name : state.party_name.trim(),
    party_address: state.party_address.trim(),
    party_gstin: state.party_gstin.trim().toUpperCase(),
    purpose: state.purpose,
    expected_return_date: state.kind === "RETURNABLE" ? state.expected_return_date || null : null,
    vehicle_number: state.vehicle_number.trim(),
    carried_by: state.carried_by.trim(),
    notes: state.notes.trim(),
    lines: state.lines.map((line) => ({
      description: line.description.trim(),
      quantity: line.quantity.trim(),
      uom: line.uom,
      machine: line.machine || null,
      equipment_text: line.machine ? "" : line.equipment_text.trim(),
      serial_no: line.serial_no.trim(),
      approx_value: line.approx_value.trim() ? line.approx_value.trim() : null,
      remarks: line.remarks.trim(),
    })),
  };
}

function clientErrors(state: FormState): string[] {
  const errors: string[] = [];
  if (!state.plant) errors.push("Choose the factory the items leave from.");
  if (!state.vendor && !state.party_name.trim()) errors.push("Choose a vendor or type who the items go to.");
  if (state.kind === "RETURNABLE") {
    if (!state.expected_return_date) errors.push("A returnable gate pass needs an expected return date.");
    else if (state.expected_return_date < todayLocal()) errors.push("The expected return date cannot be in the past.");
  }
  if (state.party_gstin.trim() && !GSTIN.test(state.party_gstin.trim().toUpperCase())) errors.push("GSTIN must be 15 characters, e.g. 24ABCDE1234F1Z5.");
  if (!state.lines.length) errors.push("Add at least one item.");
  state.lines.forEach((line, index) => {
    if (!line.description.trim()) errors.push(`Line ${index + 1}: describe the item.`);
    const qty = Number(line.quantity);
    if (!(qty > 0) || !/^\d+(\.\d{1,3})?$/.test(line.quantity.trim())) errors.push(`Line ${index + 1}: quantity must be more than 0 (up to 3 decimals).`);
    if (line.approx_value.trim() && !/^\d+(\.\d{1,2})?$/.test(line.approx_value.trim())) errors.push(`Line ${index + 1}: approximate value must be a number (up to 2 decimals).`);
  });
  return errors;
}

/**
 * Create a draft gate pass, or edit an existing draft (version-checked).
 * `onSaved(pass, issueNow)` runs after the server stored the draft.
 */
export function GatePassForm({ source, onSaved, onCancel }: { source?: GatePass | null; onSaved: (pass: GatePass, issueNow: boolean) => void; onCancel?: () => void }) {
  const [state, setState] = useState<FormState>(() => initialState(source));
  const [showErrors, setShowErrors] = useState(false);
  const issueNowRef = useRef(false);
  const optionsQ = useQuery({
    queryKey: ["inventory", "documents", "form-options", state.plant],
    queryFn: () => gatePassesApi.formOptions({ plant: state.plant || undefined }),
    staleTime: 5 * 60_000,
    meta: { suppressGlobalError: true },
  });
  const options = optionsQ.data;
  useEffect(() => {
    if (!state.plant && options?.plants.length === 1) setState((s) => ({ ...s, plant: options.plants[0].id }));
  }, [options, state.plant]);

  const op = useGateOperation<GatePassInput & { version?: number }, GatePass>({
    send: (payload) => (source ? gatePassesApi.update(source.id, { ...payload, version: source.version }) : gatePassesApi.create(payload)),
    onSaved: (saved) => onSaved(saved, issueNowRef.current),
  });
  const errors = clientErrors(state);
  const fieldErrors = op.phase === "rejected" ? gateFieldErrors(op.error) : {};
  const machines = useMemo(() => (options?.machines ?? []).filter((m) => !state.plant || m.plant === state.plant), [options, state.plant]);
  const purposes = (options?.purposes ?? []).filter((p) => (state.kind === "RETURNABLE" ? p.value !== "SCRAP_SALE" : true));
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setState((s) => ({ ...s, [key]: value }));
  const setLine = (key: string, patch: Partial<LineDraft>) => setState((s) => ({ ...s, lines: s.lines.map((line) => (line.key === key ? { ...line, ...patch } : line)) }));

  const submit = (issueNow: boolean) => {
    setShowErrors(true);
    if (errors.length || op.locked) return;
    issueNowRef.current = issueNow;
    void op.submit(toPayload(state));
  };

  if (optionsQ.isError && !options) return <LoadFailure subject="Factories, vendors and machines" error={optionsQ.error} retry={() => void optionsQ.refetch()} />;

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit(false);
      }}
      noValidate
    >
      <Panel title="Type of gate pass">
        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Type of gate pass">
          {(["RETURNABLE", "NON_RETURNABLE"] as GatePassKind[]).map((kind) => {
            const active = state.kind === kind;
            return (
              <button
                key={kind}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={op.locked}
                onClick={() => setState((s) => ({ ...s, kind, purpose: kind === s.kind ? s.purpose : GATE_PASS_DEFAULT_PURPOSE[kind], expected_return_date: kind === "RETURNABLE" ? s.expected_return_date : "" }))}
                className={cn(
                  "rounded-2xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border",
                  active ? "border-primary bg-info-bg" : "border-line bg-surface-1 hover:bg-surface-2",
                )}
              >
                <span className="flex items-center gap-2 text-[14px] font-semibold text-content-1">
                  <span className={cn("flex h-5 w-5 items-center justify-center rounded-full border", active ? "border-primary bg-primary text-white" : "border-line")}>{active ? <Check className="h-3 w-3" /> : null}</span>
                  {KIND_HELP[kind].title}
                </span>
                <span className="mt-1 block text-[12.5px] leading-relaxed text-content-3">{KIND_HELP[kind].body}</span>
              </button>
            );
          })}
        </div>
      </Panel>

      <Panel title="Where the items go">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Factory (items leave from)" error={fieldErrors.plant}>
            {(id) => (
              <select id={id} value={state.plant} disabled={op.locked} onChange={(e) => setState((s) => ({ ...s, plant: e.target.value, lines: s.lines.map((line) => ({ ...line, machine: "" })) }))} className={inputClass}>
                <option value="">Choose factory</option>
                {(options?.plants ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Purpose" error={fieldErrors.purpose}>
            {(id) => (
              <select id={id} value={state.purpose} disabled={op.locked} onChange={(e) => set("purpose", e.target.value)} className={inputClass}>
                {purposes.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <VendorPicker
            value={state.vendor}
            disabled={op.locked}
            onChange={(vendor) =>
              setState((s) => ({
                ...s,
                vendor: vendor ? { id: vendor.id, name: vendor.name } : null,
                party_address: vendor ? vendor.address || s.party_address : s.party_address,
                party_gstin: vendor ? (GSTIN.test((vendor.gstin || "").toUpperCase()) ? vendor.gstin.toUpperCase() : "") : s.party_gstin,
              }))
            }
            error={fieldErrors.vendor}
          />
          {!state.vendor ? (
            <Field label="Or party name (not in vendor list)" error={fieldErrors.party_name}>
              {(id) => <input id={id} value={state.party_name} disabled={op.locked} maxLength={255} onChange={(e) => set("party_name", e.target.value)} placeholder="e.g. Baba Vishwakarma Engg" className={inputClass} />}
            </Field>
          ) : (
            <div />
          )}
          <Field label="Address" error={fieldErrors.party_address}>
            {(id) => <textarea id={id} value={state.party_address} disabled={op.locked} rows={2} maxLength={1000} onChange={(e) => set("party_address", e.target.value)} className={cn(inputClass, "h-auto py-2")} />}
          </Field>
          <Field label="GSTIN (optional)" error={fieldErrors.party_gstin}>
            {(id) => <input id={id} value={state.party_gstin} disabled={op.locked} maxLength={15} onChange={(e) => set("party_gstin", e.target.value.toUpperCase())} placeholder="24ABCDE1234F1Z5" className={cn(inputClass, "font-mono")} />}
          </Field>
          {state.kind === "RETURNABLE" ? (
            <Field label="Expected back by" error={fieldErrors.expected_return_date}>
              {(id) => <input id={id} type="date" min={todayLocal()} value={state.expected_return_date} disabled={op.locked} onChange={(e) => set("expected_return_date", e.target.value)} className={inputClass} />}
            </Field>
          ) : null}
          <Field label="Carried by (optional)">
            {(id) => <input id={id} value={state.carried_by} disabled={op.locked} maxLength={120} onChange={(e) => set("carried_by", e.target.value)} placeholder="Driver / vendor staff" className={inputClass} />}
          </Field>
          <Field label="Vehicle (optional)" error={fieldErrors.vehicle_number}>
            {(id) => <input id={id} value={state.vehicle_number} disabled={op.locked} maxLength={20} onChange={(e) => set("vehicle_number", e.target.value.toUpperCase())} placeholder="GJ15AB1234" className={cn(inputClass, "font-mono")} />}
          </Field>
          <Field label="Notes (optional, printed)">
            {(id) => <input id={id} value={state.notes} disabled={op.locked} maxLength={500} onChange={(e) => set("notes", e.target.value)} className={inputClass} />}
          </Field>
        </div>
      </Panel>

      <Panel
        title="Items"
        description="One line per item or set. Link a machine when the part belongs to one, so the machine history shows it."
        actions={
          <Button type="button" variant="outline" size="sm" disabled={op.locked || state.lines.length >= 50} onClick={() => set("lines", [...state.lines, newLine(state.lines.at(-1)?.uom ?? "NOS")])}>
            <Plus className="h-4 w-4" /> Add item
          </Button>
        }
      >
        <ol className="space-y-3">
          {state.lines.map((line, index) => (
            <li key={line.key} className="rounded-2xl border border-line p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-content-4">Item {index + 1}</span>
                <Button type="button" variant="ghost" size="sm" disabled={op.locked || state.lines.length === 1} onClick={() => set("lines", state.lines.filter((row) => row.key !== line.key))} aria-label={`Remove item ${index + 1}`}>
                  <Trash2 className="h-4 w-4" /> Remove
                </Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_110px_110px]">
                <Field label="Description">
                  {(id) => <input id={id} value={line.description} disabled={op.locked} maxLength={255} onChange={(e) => setLine(line.key, { description: e.target.value })} placeholder="e.g. Printing roller for milling" className={inputClass} />}
                </Field>
                <Field label="Qty">
                  {(id) => <input id={id} value={line.quantity} disabled={op.locked} inputMode="decimal" onChange={(e) => setLine(line.key, { quantity: e.target.value })} className={cn(inputClass, "text-right tabular-nums")} />}
                </Field>
                <Field label="Unit">
                  {(id) => (
                    <select id={id} value={line.uom} disabled={op.locked} onChange={(e) => setLine(line.key, { uom: e.target.value })} className={inputClass}>
                      {(options?.uoms ?? ["NOS"]).map((uom) => (
                        <option key={uom} value={uom}>
                          {uom}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Machine (optional)">
                  {(id) => (
                    <select id={id} value={line.machine} disabled={op.locked || !state.plant} onChange={(e) => setLine(line.key, { machine: e.target.value })} className={inputClass}>
                      <option value="">{state.plant ? "Not a machine part" : "Choose factory first"}</option>
                      {machines.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} ({m.code}) · {m.work_center}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                {!line.machine ? (
                  <Field label="Equipment (optional)">
                    {(id) => <input id={id} value={line.equipment_text} disabled={op.locked} maxLength={160} onChange={(e) => setLine(line.key, { equipment_text: e.target.value })} placeholder="e.g. Dispatch scale 300 kg" className={inputClass} />}
                  </Field>
                ) : (
                  <div />
                )}
                <Field label="Serial no. (optional)">
                  {(id) => <input id={id} value={line.serial_no} disabled={op.locked} maxLength={80} onChange={(e) => setLine(line.key, { serial_no: e.target.value })} className={cn(inputClass, "font-mono")} />}
                </Field>
                <Field label="Approx. value ₹ (optional)">
                  {(id) => <input id={id} value={line.approx_value} disabled={op.locked} inputMode="decimal" onChange={(e) => setLine(line.key, { approx_value: e.target.value })} className={cn(inputClass, "text-right tabular-nums")} />}
                </Field>
              </div>
              <div className="mt-2">
                <Field label="Remarks (optional)">
                  {(id) => <input id={id} value={line.remarks} disabled={op.locked} maxLength={255} onChange={(e) => setLine(line.key, { remarks: e.target.value })} placeholder="e.g. Milling 0.5 mm, bearing to be replaced" className={inputClass} />}
                </Field>
              </div>
            </li>
          ))}
        </ol>
      </Panel>

      {showErrors && errors.length ? (
        <ul role="alert" className="space-y-1 rounded-2xl border border-danger-border bg-danger-bg px-4 py-3 text-[13px] text-danger-fg">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      ) : null}
      <ActionFeedback phase={op.phase} error={op.error} onRetry={() => void op.retry()} onRelease={op.release} />

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface-1/95 px-1 py-3 backdrop-blur">
        {onCancel ? (
          <Button type="button" variant="ghost" disabled={op.locked} onClick={onCancel}>
            <X className="h-4 w-4" /> Discard changes
          </Button>
        ) : null}
        <Button type="submit" variant="outline" disabled={op.locked}>
          {op.phase === "sending" && !issueNowRef.current ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {source ? "Save draft" : "Save as draft"}
        </Button>
        <Button type="button" disabled={op.locked} onClick={() => submit(true)}>
          {op.phase === "sending" && issueNowRef.current ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Save and issue
        </Button>
      </div>
    </form>
  );
}

const inputClass = "h-10 w-full rounded-lg border border-line bg-surface-2 px-3 text-[13.5px] text-content-1 outline-none focus:border-primary focus:ring-2 focus:ring-info-border disabled:opacity-60";

function Field({ label, error, children }: { label: string; error?: string; children: (id: string) => React.ReactNode }) {
  const id = useId();
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1 block text-[12px] font-semibold text-content-2">
        {label}
      </label>
      {children(id)}
      {error ? <p className="mt-1 text-[12px] text-danger-fg">{error}</p> : null}
    </div>
  );
}

type VendorOption = GatePassFormOptions["vendors"][number];

/** Accessible vendor combobox backed by the gate-pass form options search. */
function VendorPicker({ value, onChange, disabled, error }: { value: { id: string; name: string } | null; onChange: (vendor: VendorOption | null) => void; disabled?: boolean; error?: string }) {
  const id = useId();
  const listId = `${id}-list`;
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const q = useDebounced(text.trim(), 250);
  const searchQ = useQuery({
    queryKey: ["inventory", "documents", "vendor-search", q],
    queryFn: () => gatePassesApi.formOptions({ q }),
    enabled: open,
    staleTime: 60_000,
    meta: { suppressGlobalError: true },
  });
  const rows = (searchQ.data?.vendors ?? []).slice(0, 8);
  useEffect(() => setActive(0), [q]);

  if (value) {
    return (
      <div className="min-w-0">
        <span className="mb-1 block text-[12px] font-semibold text-content-2">Vendor</span>
        <div className="flex h-10 items-center justify-between gap-2 rounded-lg border border-line bg-surface-1 px-3 text-[13.5px]">
          <span className="truncate font-semibold text-content-1">{value.name}</span>
          <button type="button" disabled={disabled} onClick={() => onChange(null)} className="inline-flex min-h-[32px] items-center gap-1 rounded-md px-2 text-[12px] font-semibold text-content-2 hover:bg-surface-2" aria-label="Clear vendor">
            <X className="h-3.5 w-3.5" /> Change
          </button>
        </div>
      </div>
    );
  }
  const choose = (vendor: VendorOption) => {
    onChange(vendor);
    setText("");
    setOpen(false);
  };
  return (
    <div className="relative min-w-0">
      <label htmlFor={id} className="mb-1 block text-[12px] font-semibold text-content-2">
        Vendor (search)
      </label>
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && rows[active] ? `${listId}-${rows[active].id}` : undefined}
        value={text}
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setActive((n) => Math.min(rows.length - 1, n + 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActive((n) => Math.max(0, n - 1));
          } else if (event.key === "Enter" && open && rows[active]) {
            event.preventDefault();
            choose(rows[active]);
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
        placeholder="Type vendor name or code"
        className={inputClass}
      />
      {open ? (
        <ul id={listId} role="listbox" className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-line bg-surface-1 py-1 shadow-lg">
          {searchQ.isLoading ? (
            <li className="px-3 py-2 text-[13px] text-content-3">Searching…</li>
          ) : rows.length ? (
            rows.map((vendor, index) => (
              <li
                key={vendor.id}
                id={`${listId}-${vendor.id}`}
                role="option"
                aria-selected={index === active}
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(vendor);
                }}
                className={cn("cursor-pointer px-3 py-2 text-[13px]", index === active ? "bg-surface-2" : "")}
              >
                <span className="font-semibold text-content-1">{vendor.name}</span> <span className="text-content-3">{vendor.code}</span>
              </li>
            ))
          ) : (
            <li className="px-3 py-2 text-[13px] text-content-3">{searchQ.isError ? "Vendor search failed. Type the party name instead." : "No active vendor matches. Type the party name instead."}</li>
          )}
        </ul>
      ) : null}
      {error ? <p className="mt-1 text-[12px] text-danger-fg">{error}</p> : null}
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  CircleAlert,
  FileCheck2,
  FileQuestion,
  Loader2,
  Plus,
  ScanSearch,
  Trash2,
  Unlink,
} from "lucide-react";

import { getApiErrorStatus } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  gateApi,
  type GateDirection,
  type GateGoodsInput,
  type GateGoodsMovement,
  type GateMatchCandidate,
  type GateProduct,
} from "@/services/gate";
import { useGate } from "./gate-shell";
import {
  DIRECTION_META,
  gateAmount,
  gateDay,
  gateQty,
  gateTime,
  normalizeInvoice,
  normalizeVehicle,
  reconMeta,
} from "./gate-format";
import {
  DirectionGlyph,
  FieldError,
  FieldLabel,
  GateAction,
  MasterPicker,
  OperationBanner,
  PickerField,
  PlateChip,
  TonePill,
} from "./gate-ui";
import { gateFieldErrors, useGateOperation } from "./use-gate-operation";

type LineDraft = {
  key: string;
  product: GateProduct | null;
  quantity: string;
  uom: string;
  amount: string;
};

let lineSeq = 0;
function blankLine(): LineDraft {
  lineSeq += 1;
  return { key: `line-${lineSeq}`, product: null, quantity: "", uom: "", amount: "" };
}

function useDebounced<T>(value: T, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function sanitizeDecimal(value: string, places: number) {
  const cleaned = value.replace(/[^0-9.]/g, "");
  const [whole, ...rest] = cleaned.split(".");
  if (!rest.length) return whole.slice(0, 12);
  return `${whole.slice(0, 12)}.${rest.join("").slice(0, places)}`;
}

export function GoodsEntry({ initialDirection }: { initialDirection: GateDirection }) {
  const { plantId, plant } = useGate();
  const qc = useQueryClient();
  const [direction, setDirection] = useState<GateDirection>(initialDirection);
  const [invoice, setInvoice] = useState("");
  const [vehicle, setVehicle] = useState("");
  const [partyId, setPartyId] = useState("");
  const [partyName, setPartyName] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>(() => [blankLine()]);
  const [candidateId, setCandidateId] = useState<string | null>(null);
  const [candidateDismissed, setCandidateDismissed] = useState(false);
  const [recordObserved, setRecordObserved] = useState(false);
  const [picker, setPicker] = useState<null | { kind: "party" } | { kind: "product"; key: string }>(null);
  const [search, setSearch] = useState("");
  const [touched, setTouched] = useState(false);

  const meta = DIRECTION_META[direction];
  const partyKind = meta.partyKind;

  const mastersQuery = useQuery({
    queryKey: ["gate", "masters", plantId, search],
    queryFn: () => gateApi.masters({ plant: plantId, q: search || undefined }),
    enabled: Boolean(plantId),
    staleTime: 60_000,
    placeholderData: (previous) => previous,
    meta: { suppressGlobalError: true },
  });
  const masters = mastersQuery.data;
  const units = masters?.units?.length ? masters.units : ["KG", "PCS", "METER", "ROLL", "BOX"];

  const debouncedInvoice = useDebounced(normalizeInvoice(invoice).trim(), 550);
  const matchQuery = useQuery({
    queryKey: ["gate", "match", plantId, direction, debouncedInvoice, partyId],
    queryFn: () =>
      gateApi.match({
        plant: plantId,
        direction,
        invoice_number: debouncedInvoice,
        party_kind: partyId ? partyKind : undefined,
        party_id: partyId || undefined,
      }),
    enabled: Boolean(plantId) && debouncedInvoice.length >= 2,
    staleTime: 30_000,
    retry: false,
    meta: { suppressGlobalError: true },
  });

  const candidates = useMemo(() => matchQuery.data?.candidates ?? [], [matchQuery.data]);
  const candidate: GateMatchCandidate | null = candidates.find((c) => c.id === candidateId) ?? null;

  // A single exact ERP match fills the entry; the watchman can unlink it.
  useEffect(() => {
    if (candidateDismissed) return;
    if (matchQuery.data?.status === "MATCHED" && candidates.length === 1) setCandidateId(candidates[0].id);
    else if (candidateId && !candidates.some((c) => c.id === candidateId)) setCandidateId(null);
  }, [matchQuery.data, candidates, candidateId, candidateDismissed]);

  useEffect(() => {
    setCandidateDismissed(false);
  }, [debouncedInvoice, partyId, direction]);

  useEffect(() => {
    if (!candidate) return;
    setPartyId(candidate.party_id);
    setPartyName(candidate.party_name);
    if (candidate.invoice_date) setInvoiceDate(candidate.invoice_date);
    // Vehicle number is the watchman's own observation: never prefilled from ERP.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidate?.id]);

  const needsLines = !candidate || recordObserved;

  const op = useGateOperation<Omit<GateGoodsInput, "client_token">, GateGoodsMovement>({
    send: (payload) => gateApi.createGoods(payload),
    onSaved: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ["gate", "goods"] }),
        qc.invalidateQueries({ queryKey: ["gate", "summary"] }),
      ]),
  });
  const locked = op.locked;
  const serverErrors = op.phase === "rejected" ? gateFieldErrors(op.error) : {};

  const errors = useMemo(() => {
    const out: Record<string, string> = {};
    if (normalizeInvoice(invoice).trim().length < 1) out.invoice_number = "Type the invoice number from the paper.";
    if (normalizeVehicle(vehicle).replace(/\s/g, "").length < 4) out.vehicle_number = "Type the vehicle number from the plate.";
    if (!partyId) out.party_id = `Choose the ${meta.party.toLowerCase()} from the master list.`;
    if (needsLines) {
      lines.forEach((line, index) => {
        if (!line.product) out[`line-${index}-product`] = "Choose a product.";
        if (!(Number(line.quantity) > 0)) out[`line-${index}-quantity`] = "Enter the counted quantity.";
        if (!line.uom) out[`line-${index}-uom`] = "Choose a unit.";
      });
    }
    return out;
  }, [invoice, vehicle, partyId, needsLines, lines, meta.party]);
  const show = (key: string) => (touched ? errors[key] : undefined) || serverErrors[key];

  const buildPayload = (): Omit<GateGoodsInput, "client_token"> => {
    const payload: Omit<GateGoodsInput, "client_token"> = {
      plant: plantId,
      direction,
      invoice_number: normalizeInvoice(invoice).trim(),
      vehicle_number: normalizeVehicle(vehicle).trim(),
      party_kind: candidate?.party_kind ?? partyKind,
      party_id: partyId,
    };
    if (invoiceDate) payload.invoice_date = invoiceDate;
    if (candidate) {
      payload.document_kind = candidate.kind;
      payload.document_id = candidate.id;
    }
    if (needsLines) {
      payload.lines = lines.map((line) => ({
        product_kind: line.product!.kind,
        product_id: line.product!.id,
        quantity: line.quantity,
        uom: line.uom,
        amount: line.amount ? line.amount : null,
      }));
    }
    const trimmedNotes = notes.trim();
    if (trimmedNotes) payload.notes = trimmedNotes;
    return payload;
  };

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (locked || Object.keys(errors).length) {
      const first = document.querySelector('[aria-invalid="true"], [data-invalid="true"]') as HTMLElement | null;
      first?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    void op.submit(buildPayload());
  };

  const switchDirection = (next: GateDirection) => {
    if (locked || next === direction) return;
    setDirection(next);
    setPartyId("");
    setPartyName("");
    setCandidateId(null);
  };

  const resetForNext = () => {
    op.reset();
    setInvoice("");
    setVehicle("");
    setPartyId("");
    setPartyName("");
    setInvoiceDate("");
    setNotes("");
    setLines([blankLine()]);
    setCandidateId(null);
    setRecordObserved(false);
    setTouched(false);
    window.scrollTo({ top: 0 });
  };

  if (op.phase === "saved" && op.result) {
    return <GoodsReceipt movement={op.result} onNext={resetForNext} refreshPending={op.refreshPending} />;
  }

  const partyOptions = (masters?.parties ?? [])
    .filter((p) => p.kind === partyKind)
    .map((p) => ({ id: p.id, title: p.name, meta: p.code ?? undefined }));
  const productOptions = (masters?.products ?? []).map((p) => ({
    id: `${p.kind}:${p.id}`,
    title: p.name,
    subtitle: [p.kind === "MATERIAL" ? "Material" : p.kind === "PRODUCT" ? "Product" : p.kind === "TRADING" ? "Trading good" : p.kind, p.uom].filter(Boolean).join(" · "),
    meta: p.code ?? undefined,
  }));
  const activeLine = picker?.kind === "product" ? lines.find((l) => l.key === picker.key) : undefined;

  return (
    <form onSubmit={onSubmit} noValidate className="mx-auto max-w-[640px] pb-24">
      {/* Lane switch: the whole entry is tinted by direction. */}
      <div className="grid grid-cols-2 gap-2 rounded-[20px] bg-surface-1 p-1.5 shadow-[var(--gate-shadow)]" role="radiogroup" aria-label="Direction">
        {(["INWARD", "OUTWARD"] as GateDirection[]).map((value) => {
          const active = value === direction;
          const m = DIRECTION_META[value];
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={locked}
              onClick={() => switchDirection(value)}
              className="gate-press flex min-h-[60px] items-center justify-center gap-2 rounded-2xl text-[16px] font-semibold disabled:opacity-60"
              style={active ? { background: m.tone, color: "#fff" } : { color: "var(--content-3)" }}
            >
              <DirectionGlyph direction={value} className={active ? "h-5 w-5 !text-white" : "h-5 w-5"} />
              <span style={active ? { color: "#fff" } : undefined}>{m.label}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 px-1 text-[13px] text-content-3">
        {meta.verb} at <span className="font-semibold text-content-2">{plant?.name}</span>. Time is stamped by the server when you save.
      </p>

      <fieldset disabled={locked} className="mt-4 space-y-4">
        <section className="gate-card space-y-4 p-4">
          <div>
            <FieldLabel required hint="Type from paper">
              {direction === "INWARD" ? "Supplier invoice no." : "Invoice / challan no."}
            </FieldLabel>
            <input
              className="gate-field font-mono text-[18px] font-semibold tracking-[0.03em]"
              value={invoice}
              onChange={(e) => setInvoice(normalizeInvoice(e.target.value))}
              autoCapitalize="characters"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              maxLength={80}
              enterKeyHint="next"
              placeholder="e.g. INV/2026/0412"
              aria-invalid={Boolean(show("invoice_number")) || undefined}
            />
            <FieldError message={show("invoice_number")} />
          </div>

          <div>
            <FieldLabel required hint="Type from plate">Vehicle number</FieldLabel>
            <div className="gate-plate" aria-invalid={Boolean(show("vehicle_number")) || undefined}>
              <span className="gate-plate__strip" aria-hidden>
                IND
              </span>
              <input
                className="gate-plate__input"
                value={vehicle}
                onChange={(e) => setVehicle(normalizeVehicle(e.target.value))}
                autoCapitalize="characters"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                maxLength={40}
                enterKeyHint="next"
                placeholder="GJ 01 AB 1234"
                aria-label="Vehicle number"
              />
            </div>
            <FieldError message={show("vehicle_number")} />
          </div>

          <div>
            <FieldLabel required>{meta.party}</FieldLabel>
            <PickerField
              value={partyName}
              placeholder={`Choose ${meta.party.toLowerCase()}`}
              onOpen={() => setPicker({ kind: "party" })}
              invalid={Boolean(show("party_id"))}
              disabled={locked || Boolean(candidate)}
              sub={candidate ? "From ERP document" : undefined}
            />
            <FieldError message={show("party_id")} />
          </div>
        </section>

        <MatchPanel
          loading={matchQuery.isFetching}
          ready={debouncedInvoice.length >= 2}
          errored={matchQuery.isError}
          status={matchQuery.data?.status}
          candidates={candidates}
          selectedId={candidateId}
          onSelect={(id) => {
            setCandidateDismissed(false);
            setCandidateId(id);
          }}
          onUnlink={() => {
            setCandidateDismissed(true);
            setCandidateId(null);
          }}
          direction={direction}
          forbidden={getApiErrorStatus(matchQuery.error) === 403}
        />

        {candidate ? (
          <label className="gate-card flex min-h-[60px] cursor-pointer items-center gap-3 px-4 py-3">
            <input
              type="checkbox"
              checked={recordObserved}
              onChange={(e) => setRecordObserved(e.target.checked)}
              className="h-6 w-6 shrink-0 accent-[var(--gate-in)]"
            />
            <span>
              <span className="block text-[15px] font-semibold text-content-1">Counted something different?</span>
              <span className="block text-[13px] text-content-3">Record what you actually saw. The owner reviews the difference.</span>
            </span>
          </label>
        ) : null}

        {needsLines ? (
          <section className="space-y-3">
            <div className="flex items-end justify-between px-1">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-content-4">
                  {candidate ? "Observed at gate" : "Goods on vehicle"}
                </div>
                <h2 className="text-[17px] font-semibold text-content-1">Items</h2>
              </div>
              <span className="text-[13px] text-content-3">{lines.length} line{lines.length === 1 ? "" : "s"}</span>
            </div>
            {lines.map((line, index) => (
              <LineCard
                key={line.key}
                index={index}
                line={line}
                units={units}
                canRemove={lines.length > 1}
                errors={{
                  product: show(`line-${index}-product`),
                  quantity: show(`line-${index}-quantity`),
                  uom: show(`line-${index}-uom`),
                }}
                onPick={() => setPicker({ kind: "product", key: line.key })}
                onChange={(patch) => setLines((all) => all.map((l) => (l.key === line.key ? { ...l, ...patch } : l)))}
                onRemove={() => setLines((all) => all.filter((l) => l.key !== line.key))}
              />
            ))}
            {serverErrors.lines ? <FieldError message={serverErrors.lines} /> : null}
            <GateAction tone="plain" size="md" className="w-full" onClick={() => setLines((all) => [...all, blankLine()])} disabled={lines.length >= 50}>
              <Plus className="h-5 w-5" /> Add another item
            </GateAction>
          </section>
        ) : null}

        <section className="gate-card space-y-4 p-4">
          <div>
            <FieldLabel hint={candidate?.invoice_date ? "From ERP document" : "Optional"}>Invoice date</FieldLabel>
            <input
              type="date"
              className="gate-field gate-num"
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
              disabled={locked || Boolean(candidate?.invoice_date)}
              max={new Date(Date.now() + 86400000).toISOString().slice(0, 10)}
            />
            <FieldError message={serverErrors.invoice_date} />
          </div>
          <div>
            <FieldLabel hint="Optional">Note for owner</FieldLabel>
            <textarea
              className="gate-field"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={500}
              rows={2}
              placeholder="Seal broken, short boxes, driver name…"
            />
          </div>
        </section>
      </fieldset>

      <div className="mt-4">
        <OperationBanner phase={op.phase} error={op.error} onRetry={() => void op.retry()} onRelease={op.release} />
      </div>

      {op.phase !== "uncertain" ? (
        <div className="gate-safe-bottom sticky bottom-[76px] z-30 mt-4 lg:bottom-4">
          <GateAction
            type="submit"
            tone={direction === "INWARD" ? "in" : "out"}
            className="w-full shadow-[0_10px_30px_-12px_rgba(15,23,42,0.45)]"
            busy={op.phase === "sending"}
          >
            {op.phase === "sending" ? "Saving to register…" : `Save ${meta.label.toLowerCase()} entry`}
          </GateAction>
        </div>
      ) : null}

      <MasterPicker
        open={picker?.kind === "party"}
        onOpenChange={(open) => !open && setPicker(null)}
        title={`Choose ${meta.party.toLowerCase()}`}
        description="From the ERP master list"
        options={partyOptions}
        loading={mastersQuery.isFetching}
        error={mastersQuery.isError ? "Could not load the master list. Check the connection." : null}
        selectedId={partyId}
        onSearch={setSearch}
        onSelect={(id) => {
          const found = masters?.parties.find((p) => p.id === id);
          setPartyId(id);
          setPartyName(found?.name ?? "");
        }}
      />
      <MasterPicker
        open={picker?.kind === "product"}
        onOpenChange={(open) => !open && setPicker(null)}
        title="Choose item"
        description="Materials, products and trading goods from the ERP"
        options={productOptions}
        loading={mastersQuery.isFetching}
        error={mastersQuery.isError ? "Could not load the master list. Check the connection." : null}
        selectedId={activeLine?.product ? `${activeLine.product.kind}:${activeLine.product.id}` : undefined}
        onSearch={setSearch}
        onSelect={(compound) => {
          if (picker?.kind !== "product") return;
          const [kind, ...rest] = compound.split(":");
          const id = rest.join(":");
          const found = masters?.products.find((p) => p.id === id && p.kind === kind) ?? null;
          setLines((all) =>
            all.map((l) =>
              l.key === picker.key ? { ...l, product: found, uom: l.uom || (found?.uom ? String(found.uom).toUpperCase() : "") } : l,
            ),
          );
        }}
      />
    </form>
  );
}

function LineCard({
  index,
  line,
  units,
  canRemove,
  errors,
  onPick,
  onChange,
  onRemove,
}: {
  index: number;
  line: LineDraft;
  units: string[];
  canRemove: boolean;
  errors: { product?: string; quantity?: string; uom?: string };
  onPick: () => void;
  onChange: (patch: Partial<LineDraft>) => void;
  onRemove: () => void;
}) {
  const unitChoices = Array.from(new Set([...(line.product?.uom ? [String(line.product.uom).toUpperCase()] : []), ...units]));
  return (
    <div className="gate-card space-y-3 p-4">
      <div className="flex items-center justify-between">
        <span className="gate-num text-[12px] font-semibold uppercase tracking-[0.1em] text-content-4">Item {index + 1}</span>
        {canRemove ? (
          <button
            type="button"
            onClick={onRemove}
            className="gate-press -mr-2 flex h-11 items-center gap-1.5 rounded-xl px-3 text-[13px] font-semibold text-content-3"
            aria-label={`Remove item ${index + 1}`}
          >
            <Trash2 className="h-4 w-4" /> Remove
          </button>
        ) : null}
      </div>
      <div>
        <PickerField
          value={line.product?.name}
          placeholder="Choose item from master"
          onOpen={onPick}
          invalid={Boolean(errors.product)}
          sub={line.product?.code ?? undefined}
        />
        <FieldError message={errors.product} />
      </div>
      <div className="grid grid-cols-[1fr_1fr] gap-3">
        <div>
          <FieldLabel required>Quantity</FieldLabel>
          <input
            className="gate-field gate-num font-mono text-[18px] font-semibold"
            value={line.quantity}
            onChange={(e) => onChange({ quantity: sanitizeDecimal(e.target.value, 4) })}
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            aria-invalid={Boolean(errors.quantity) || undefined}
          />
          <FieldError message={errors.quantity} />
        </div>
        <div>
          <FieldLabel hint="If on paper">Amount ₹</FieldLabel>
          <input
            className="gate-field gate-num font-mono"
            value={line.amount}
            onChange={(e) => onChange({ amount: sanitizeDecimal(e.target.value, 2) })}
            inputMode="decimal"
            autoComplete="off"
            placeholder="Not known"
          />
        </div>
      </div>
      <div>
        <FieldLabel required>Unit</FieldLabel>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={`Unit for item ${index + 1}`}>
          {unitChoices.map((unit) => (
            <button
              key={unit}
              type="button"
              role="radio"
              aria-checked={line.uom === unit}
              onClick={() => onChange({ uom: unit })}
              className={cn(
                "gate-press min-h-[44px] min-w-[64px] rounded-xl border px-3 font-mono text-[14px] font-semibold",
                line.uom === unit ? "border-transparent text-white" : "border-[var(--gate-field-edge)] bg-[var(--gate-field)] text-content-2",
              )}
              style={line.uom === unit ? { background: "var(--gate-ink-2)" } : undefined}
            >
              {unit}
            </button>
          ))}
        </div>
        <FieldError message={errors.uom} />
      </div>
    </div>
  );
}

function MatchPanel({
  loading,
  ready,
  errored,
  forbidden,
  status,
  candidates,
  selectedId,
  onSelect,
  onUnlink,
  direction,
}: {
  loading: boolean;
  ready: boolean;
  errored: boolean;
  forbidden: boolean;
  status?: string;
  candidates: GateMatchCandidate[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onUnlink: () => void;
  direction: GateDirection;
}) {
  if (!ready) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-dashed border-line px-4 py-3 text-[14px] text-content-3">
        <ScanSearch className="h-5 w-5 shrink-0" />
        Type the invoice number to look for the ERP {direction === "INWARD" ? "receipt" : "dispatch"} document.
      </div>
    );
  }
  if (loading && !candidates.length) {
    return (
      <div className="gate-card flex items-center gap-3 px-4 py-4 text-[14px] text-content-2">
        <Loader2 className="h-5 w-5 animate-spin text-content-4" /> Looking for a matching ERP document…
      </div>
    );
  }
  if (errored) {
    return (
      <div className="flex items-start gap-3 rounded-2xl border px-4 py-3 text-[14px]" style={{ borderColor: "var(--gate-pending-edge)", background: "var(--gate-pending-soft)" }}>
        <CircleAlert className="mt-0.5 h-5 w-5 shrink-0" style={{ color: "var(--gate-pending)" }} />
        <span className="text-content-2">
          {forbidden ? "ERP lookup is not available for this gate." : "ERP lookup failed."} You can still save — record the items you see and the owner will review it.
        </span>
      </div>
    );
  }

  const selected = candidates.find((c) => c.id === selectedId) ?? null;
  if (selected) {
    return (
      <section
        className="gate-card gate-rise overflow-hidden"
        style={{ boxShadow: `0 0 0 1.5px var(--gate-inside-edge), var(--gate-shadow)` }}
      >
        <div className="flex items-center gap-3 px-4 pt-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: "var(--gate-inside-soft)", color: "var(--gate-inside)" }}>
            <FileCheck2 className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-semibold uppercase tracking-[0.1em]" style={{ color: "var(--gate-inside)" }}>
              ERP document matched
            </div>
            <div className="truncate font-mono text-[15px] font-semibold text-content-1">{selected.reference}</div>
          </div>
          <button
            type="button"
            onClick={onUnlink}
            className="gate-press flex h-11 items-center gap-1.5 rounded-xl px-3 text-[13px] font-semibold text-content-3"
          >
            <Unlink className="h-4 w-4" /> Not this
          </button>
        </div>
        <CandidateBody candidate={selected} />
      </section>
    );
  }

  if (status === "AMBIGUOUS" && candidates.length) {
    return (
      <section className="space-y-2">
        <div className="px-1 text-[14px] font-semibold text-content-1">More than one ERP document fits — choose the one on the paper</div>
        {candidates.map((c) => (
          <button key={c.id} type="button" onClick={() => onSelect(c.id)} className="gate-card gate-press block w-full overflow-hidden text-left">
            <div className="flex items-center justify-between gap-3 px-4 pt-3">
              <span className="font-mono text-[15px] font-semibold text-content-1">{c.reference}</span>
              <span className="text-[13px] text-content-3">{gateDay(c.invoice_date, true)}</span>
            </div>
            <CandidateBody candidate={c} compact />
          </button>
        ))}
      </section>
    );
  }

  return (
    <div className="flex items-start gap-3 rounded-2xl border px-4 py-3" style={{ borderColor: "var(--gate-pending-edge)", background: "var(--gate-pending-soft)" }}>
      <FileQuestion className="mt-0.5 h-5 w-5 shrink-0" style={{ color: "var(--gate-pending)" }} />
      <div className="text-[14px]">
        <div className="font-semibold text-content-1">No ERP document found</div>
        <p className="mt-0.5 text-content-2">
          {candidates.length
            ? "A document exists but you unlinked it. Record the items you see."
            : "Save it anyway with the items you see. It will be marked for owner review — nothing is guessed."}
        </p>
      </div>
    </div>
  );
}

function CandidateBody({ candidate, compact }: { candidate: GateMatchCandidate; compact?: boolean }) {
  return (
    <div className="px-4 pb-4 pt-2">
      {candidate.warnings?.length ? (
        <div className="mb-2 rounded-xl border px-3 py-2 text-[13px]" style={{ borderColor: "var(--gate-pending-edge)", background: "var(--gate-pending-soft)" }}>
          <div className="font-semibold" style={{ color: "var(--gate-pending)" }}>
            ERP document caveat — owner will review
          </div>
          <ul className="mt-0.5 list-disc pl-4 text-content-2">
            {candidate.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="text-[14px] text-content-2">
        <span className="font-semibold text-content-1">{candidate.party_name}</span>
        {candidate.invoice_date ? <span className="text-content-3"> · {gateDay(candidate.invoice_date, true)}</span> : null}
      </div>
      <ul className="mt-2 divide-y divide-[var(--gate-rule)] rounded-xl bg-[var(--gate-paper)] px-3">
        {candidate.lines.slice(0, compact ? 2 : 50).map((line, i) => (
          <li key={`${line.product_id}-${i}`} className="flex items-baseline justify-between gap-3 py-2 text-[14px]">
            <span className="min-w-0 truncate text-content-1">{line.product_name}</span>
            <span className="gate-num shrink-0 font-mono text-content-2">
              {gateQty(line.quantity)} <span className="text-content-4">{line.uom}</span>
            </span>
          </li>
        ))}
        {compact && candidate.lines.length > 2 ? (
          <li className="py-2 text-[13px] text-content-4">+{candidate.lines.length - 2} more</li>
        ) : null}
      </ul>
      {candidate.amount !== undefined && candidate.amount !== null ? (
        <div className="mt-2 flex justify-between text-[14px]">
          <span className="text-content-3">Amount{candidate.amount_basis ? ` (${candidate.amount_basis})` : ""}</span>
          <span className="gate-num font-mono font-semibold text-content-1">{gateAmount(candidate.amount)}</span>
        </div>
      ) : null}
    </div>
  );
}

export function GoodsReceipt({
  movement,
  onNext,
  refreshPending,
}: {
  movement: GateGoodsMovement;
  onNext: () => void;
  refreshPending?: boolean;
}) {
  const router = useRouter();
  const recon = reconMeta(movement.reconciliation_status);
  const meta = DIRECTION_META[movement.direction] ?? DIRECTION_META.INWARD;
  return (
    <div className="mx-auto max-w-[560px]">
      <div className="gate-card gate-rise overflow-hidden">
        <div className="px-5 pb-5 pt-6 text-center" style={{ background: meta.soft }}>
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-surface-1" style={{ color: "var(--gate-inside)" }}>
            <CheckCircle2 className="h-9 w-9" />
          </div>
          <h1 className="mt-3 text-[22px] font-semibold tracking-[-0.02em] text-content-1">Saved to gate register</h1>
          <p className="mt-1 text-[14px] text-content-3">
            {meta.label} · {gateDay(movement.logged_at, true)} at <span className="gate-num font-semibold text-content-2">{gateTime(movement.logged_at)}</span>
          </p>
          {refreshPending ? (
            <p className="mt-2 text-[13px] font-medium text-content-3">Saved. Today&apos;s lists will refresh when the connection settles.</p>
          ) : null}
          {movement.replayed ? (
            <p className="mt-2 text-[13px] font-medium text-content-3">This entry was already saved — no duplicate was created.</p>
          ) : null}
        </div>
        <dl className="gate-ledger m-4 text-[14px]">
          <ReceiptRow label="Invoice">
            <span className="font-mono font-semibold">{movement.invoice_number}</span>
          </ReceiptRow>
          <ReceiptRow label="Vehicle">
            <PlateChip value={movement.vehicle_number} />
          </ReceiptRow>
          <ReceiptRow label={meta.party}>{movement.party_name}</ReceiptRow>
          {movement.lines?.map((line, i) => (
            <ReceiptRow key={line.id ?? i} label={i === 0 ? "Items" : ""}>
              <span className="flex w-full justify-between gap-3">
                <span className="truncate">{line.product_name}</span>
                <span className="gate-num shrink-0 font-mono">
                  {gateQty(line.quantity)} {line.uom}
                </span>
              </span>
            </ReceiptRow>
          ))}
          <ReceiptRow label="ERP check">
            <TonePill label={recon.label} tone={recon.tone} soft={recon.soft} edge={recon.edge} dot />
          </ReceiptRow>
        </dl>
        <div className="grid gap-2 px-4 pb-4">
          <GateAction tone={movement.direction === "INWARD" ? "in" : "out"} onClick={onNext}>
            New {meta.label.toLowerCase()} entry
          </GateAction>
          <GateAction tone="plain" onClick={() => router.push("/gate/register")}>
            See today&apos;s register
          </GateAction>
        </div>
      </div>
      <p className="mt-3 text-center text-[12px] text-content-4">
        Receipt {movement.id.slice(0, 8).toUpperCase()} · <Link href="/gate" className="underline">Gate home</Link>
      </p>
    </div>
  );
}

function ReceiptRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="gate-ledger-row flex items-center gap-3 px-3 py-2.5">
      <dt className="w-[76px] shrink-0 text-[12px] font-semibold uppercase tracking-[0.08em] text-content-4">{label}</dt>
      <dd className="min-w-0 flex-1 text-content-1">{children}</dd>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock3, FileImage, Loader2, QrCode, ScanLine, Truck, TriangleAlert, X } from "lucide-react";

import { getApiErrorStatus } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  OUTWARD_MAX_CODES,
  OUTWARD_MAX_PAGES,
  OUTWARD_STATUS_META,
  outwardApi,
  type OutwardDocument,
  type QrChip,
} from "@/services/outward";
import { useGate } from "./gate-shell";
import { gateDay, gateTime, todayIso } from "./gate-format";
import { GateAction, GateSheet, OperationBanner, SectionHeading } from "./gate-ui";
import { FactoryChoice, PageCaptureSection, usePageDrafts, type CaptureCopy } from "./page-capture";
import { QrScanner } from "./qr-scanner";
import { gateErrorMessage, useGateOperation } from "./use-gate-operation";

/*
 * Watchman outward departure: scan the ERP QR printed on the paper (optional),
 * photograph every page, note the vehicle, record. The server stamps the time,
 * links recognised documents and the office matches the rest. Nothing typed
 * except the optional vehicle number; nothing here changes stock.
 */

const OUT_COPY: CaptureCopy = {
  noun: "paper",
  sectionTitle: "Paper pages",
  headingId: "outward-pages",
  takeLabel: "Photograph paper",
  takeHint: "Every paper leaving with the goods: challan, invoice, gate pass. Keep all four edges in the photo.",
  tooManyPages: `One departure can have at most ${OUTWARD_MAX_PAGES} pages. Extra photos were not added.`,
  pageAlt: (n) => `Outward paper page ${n}`,
  fullAlt: "Outward paper page full size",
};

const OUT_TONE = { color: "var(--gate-out)", soft: "var(--gate-out-soft)", edge: "var(--gate-out-edge)" };

type CodeRow = { raw: string; state: "checking" | "ok" | "bad" | "unchecked"; chip?: QrChip; error?: string };

export function normaliseVehicle(value: string) {
  return value.toUpperCase().replace(/[\s\-./]/g, "");
}

export function isValidVehicle(value: string) {
  return value === "" || /^[A-Z0-9]{4,15}$/.test(value);
}

export function OutwardCapture() {
  const { plants, plant, plantId, setPlantId } = useGate();
  const qc = useQueryClient();
  const drafts = usePageDrafts(OUTWARD_MAX_PAGES, OUT_COPY);
  const { pages, preparing } = drafts;
  const [codes, setCodes] = useState<CodeRow[]>([]);
  const [noQr, setNoQr] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanNote, setScanNote] = useState<string | null>(null);
  const [vehicle, setVehicle] = useState("");
  const [progress, setProgress] = useState<number | null>(null);
  const codesRef = useRef(codes);
  codesRef.current = codes;

  const recent = useQuery({
    queryKey: ["gate", "outward", "mine", plantId, 1],
    queryFn: () => outwardApi.listMine(plantId, 1),
    enabled: Boolean(plantId),
    staleTime: 30_000,
    meta: { suppressGlobalError: true },
  });
  const recentVehicles = recent.data?.recent_vehicles ?? [];

  const op = useGateOperation<{ plant: string; images: Blob[]; vehicle_number: string; scanned_codes: string[] }, OutwardDocument>({
    send: async (payload) => {
      setProgress(0);
      try {
        return await outwardApi.capture(payload, setProgress);
      } finally {
        setProgress(null);
      }
    },
    onSaved: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ["gate", "outward", "mine"] }),
        qc.invalidateQueries({ queryKey: ["gate", "outward", "today"] }),
        qc.invalidateQueries({ queryKey: ["gate", "summary"] }),
      ]),
  });
  const locked = op.locked || preparing;

  const check = useCallback(
    async (raw: string) => {
      if (!plantId) return;
      setCodes((rows) => rows.map((row) => (row.raw === raw ? { raw, state: "checking" } : row)));
      try {
        const chip = await outwardApi.resolveCode(raw, plantId);
        setCodes((rows) => rows.map((row) => (row.raw === raw ? { raw, state: "ok", chip } : row)));
      } catch (error) {
        const status = getApiErrorStatus(error);
        const definite = status !== null && status >= 400 && status < 500 && status !== 408 && status !== 429;
        setCodes((rows) =>
          rows.map((row) =>
            row.raw === raw
              ? definite
                ? { raw, state: "bad", error: gateErrorMessage(error, "This code is not an ERP document code.") }
                : { raw, state: "unchecked", error: "Could not check now. It is still sent with the photos and checked by the office." }
              : row,
          ),
        );
      }
    },
    [plantId],
  );

  // A different gate changes the plant check: re-check every code.
  useEffect(() => {
    codesRef.current.forEach((row) => void check(row.raw));
  }, [check]);

  const addCode = useCallback(
    (raw: string) => {
      const value = raw.trim();
      if (!value) return;
      if (codesRef.current.some((row) => row.raw === value)) {
        setScanNote("Already scanned.");
        return;
      }
      if (codesRef.current.length >= OUTWARD_MAX_CODES) {
        setScanNote(`At most ${OUTWARD_MAX_CODES} codes per departure.`);
        return;
      }
      setScanNote(null);
      setNoQr(false);
      setCodes((rows) => [...rows, { raw: value, state: "checking" }]);
      void check(value);
    },
    [check],
  );

  const normalisedVehicle = normaliseVehicle(vehicle);
  const vehicleOk = isValidVehicle(normalisedVehicle);

  // Leaving with unsent pages (or an unconfirmed upload) must never look saved.
  useEffect(() => {
    const dirty = ((pages.length > 0 || codes.length > 0) && op.phase !== "saved") || op.phase === "sending" || op.phase === "uncertain";
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [pages.length, codes.length, op.phase]);

  const submit = () => {
    if (!plantId || !pages.length || locked || !vehicleOk) return;
    void op.submit({ plant: plantId, images: pages.map((p) => p.blob), vehicle_number: normalisedVehicle, scanned_codes: codes.map((row) => row.raw) });
  };

  const startNext = () => {
    drafts.reset();
    setCodes([]);
    setNoQr(false);
    setVehicle("");
    setScanNote(null);
    op.reset();
    window.scrollTo({ top: 0 });
  };

  if (op.phase === "saved" && op.result) {
    return (
      <div className="mx-auto max-w-[640px] space-y-6">
        <DepartureReceipt document={op.result} refreshPending={op.refreshPending} onNext={startNext} />
        <TodayDepartures />
      </div>
    );
  }

  const recognised = codes.filter((row) => row.state === "ok").length;

  return (
    <div className="mx-auto max-w-[640px] space-y-5 pb-28">
      <header className="px-1 pt-1">
        <div className="text-[13px] font-medium text-content-3">Goods going out</div>
        <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-content-1">Record outward</h1>
        <p className="mt-1 text-[14px] leading-relaxed text-content-3">
          Scan the QR on the ERP paper, photograph every page and note the vehicle. The leaving time is stamped by the server; the office checks the rest.
        </p>
      </header>

      <FactoryChoice plants={plants} plant={plant} plantId={plantId} setPlantId={setPlantId} locked={locked || codes.length > 0 || pages.length > 0} tone="var(--gate-out)" headingId="outward-factory" />

      <section aria-labelledby="outward-codes" className="space-y-3">
        <div className="flex items-end justify-between px-1">
          <h2 id="outward-codes" className="text-[17px] font-semibold text-content-1">
            <StepNumber n={1} /> Scan QR
          </h2>
          <span className="gate-num text-[13px] text-content-3">{codes.length ? `${recognised} recognised` : noQr ? "No QR" : "Optional"}</span>
        </div>
        {codes.length ? (
          <ul className="space-y-2" aria-label="Scanned codes">
            {codes.map((row) => (
              <CodeChipRow key={row.raw} row={row} disabled={locked} onRemove={() => setCodes((rows) => rows.filter((item) => item.raw !== row.raw))} onRetry={() => void check(row.raw)} />
            ))}
          </ul>
        ) : null}
        {noQr && !codes.length ? (
          <div className="gate-card flex items-center gap-3 px-4 py-3 text-[14px] text-content-2">
            <QrCode className="h-5 w-5 shrink-0 text-content-4" />
            <span className="min-w-0 flex-1">No QR on the paper. The office will match it from the photos.</span>
            <button type="button" disabled={locked} onClick={() => setNoQr(false)} className="gate-press min-h-[44px] rounded-xl px-3 text-[14px] font-semibold text-content-1">
              Undo
            </button>
          </div>
        ) : null}
        <div className={cn("grid gap-2", !codes.length && !noQr ? "grid-cols-1 sm:grid-cols-[2fr_1fr]" : "grid-cols-1")}>
          <GateAction tone="out" onClick={() => setScanning(true)} disabled={locked || !plantId || codes.length >= OUTWARD_MAX_CODES}>
            <ScanLine className="h-6 w-6" /> {codes.length ? "Scan another QR" : "Scan QR"}
          </GateAction>
          {!codes.length && !noQr ? (
            <GateAction tone="plain" size="md" onClick={() => setNoQr(true)} disabled={locked}>
              No QR
            </GateAction>
          ) : null}
        </div>
        {scanNote ? <p className="px-1 text-[13px] text-content-3">{scanNote}</p> : null}
      </section>

      <div>
        <h2 className="sr-only">Step 2: photograph the pages</h2>
        <div className="mb-1 flex items-center gap-2 px-1 text-[13px] font-semibold text-content-3">
          <StepNumber n={2} /> Photograph every page
        </div>
        <PageCaptureSection drafts={drafts} copy={OUT_COPY} tone={OUT_TONE} locked={locked} canStart={Boolean(plantId)} />
      </div>

      <section aria-labelledby="outward-vehicle" className="space-y-2">
        <h2 id="outward-vehicle" className="px-1 text-[17px] font-semibold text-content-1">
          <StepNumber n={3} /> Vehicle number
        </h2>
        <label className="block">
          <span className="sr-only">Vehicle number</span>
          <input
            value={vehicle}
            onChange={(e) => setVehicle(e.target.value.toUpperCase())}
            disabled={locked}
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            maxLength={20}
            placeholder="GJ15AB1234"
            aria-invalid={!vehicleOk}
            aria-describedby="outward-vehicle-hint"
            className="gate-num h-14 w-full rounded-2xl border bg-[var(--gate-field)] px-4 text-[20px] font-semibold tracking-[0.08em] text-content-1 outline-none focus:border-[var(--gate-out)] disabled:opacity-60"
            style={{ borderColor: vehicleOk ? "var(--gate-field-edge)" : "var(--gate-alert)" }}
          />
        </label>
        <p id="outward-vehicle-hint" className={cn("px-1 text-[13px]", vehicleOk ? "text-content-3" : "font-semibold")} style={vehicleOk ? undefined : { color: "var(--gate-alert)" }}>
          {vehicleOk ? "Optional, but it helps the office match faster." : "Use letters and digits only, for example GJ15AB1234."}
        </p>
        {recentVehicles.length ? (
          <div className="flex flex-wrap gap-2" aria-label="Recent vehicles at this gate">
            {recentVehicles.map((value) => (
              <button
                key={value}
                type="button"
                disabled={locked}
                onClick={() => setVehicle(value)}
                aria-pressed={normalisedVehicle === value}
                className={cn(
                  "gate-press gate-num min-h-[44px] rounded-full border px-4 text-[14px] font-semibold",
                  normalisedVehicle === value ? "border-transparent text-white" : "border-line bg-surface-1 text-content-1",
                )}
                style={normalisedVehicle === value ? { background: "var(--gate-out)" } : undefined}
              >
                {value}
              </button>
            ))}
          </div>
        ) : null}
      </section>

      <OperationBanner
        phase={op.phase}
        error={op.error}
        onRetry={() => void op.retry()}
        onRelease={op.release}
        releaseLabel="Edit departure"
        uncertainHint="Check “Left today” below before editing. Sending again uses the same upload and cannot record the departure twice."
      />

      {op.phase !== "uncertain" ? (
        <div className="gate-safe-bottom sticky bottom-[76px] z-30 lg:bottom-4">
          <GateAction
            tone="out"
            className="w-full shadow-[0_10px_30px_-12px_rgba(15,23,42,0.45)]"
            disabled={!pages.length || !plantId || preparing || !vehicleOk || codes.some((row) => row.state === "checking")}
            busy={op.phase === "sending"}
            onClick={submit}
          >
            {op.phase === "sending"
              ? progress !== null && progress < 1
                ? `Uploading… ${Math.round(progress * 100)}%`
                : "Saving departure…"
              : pages.length
                ? `Record outward · ${pages.length} page${pages.length === 1 ? "" : "s"}`
                : "Record outward"}
          </GateAction>
        </div>
      ) : null}

      <TodayDepartures />

      <GateSheet open={scanning} onOpenChange={setScanning} title="Scan the QR on the paper" description={plant ? `Gate: ${plant.name}` : undefined} tall>
        {scanning ? (
          <div className="space-y-3">
            <QrScanner onCode={addCode} onClose={() => setScanning(false)} />
            {codes.length ? (
              <ul className="space-y-2" aria-label="Scanned so far">
                {codes.map((row) => (
                  <CodeChipRow key={row.raw} row={row} compact />
                ))}
              </ul>
            ) : null}
            {scanNote ? <p className="text-center text-[13px] text-content-3">{scanNote}</p> : null}
          </div>
        ) : null}
      </GateSheet>
    </div>
  );
}

function StepNumber({ n }: { n: number }) {
  return (
    <span className="gate-num mr-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-bold text-white" style={{ background: "var(--gate-out)" }} aria-hidden>
      {n}
    </span>
  );
}

function CodeChipRow({ row, onRemove, onRetry, disabled, compact }: { row: CodeRow; onRemove?: () => void; onRetry?: () => void; disabled?: boolean; compact?: boolean }) {
  const ok = row.state === "ok";
  const bad = row.state === "bad";
  const tone = ok
    ? { color: "var(--gate-inside)", background: "var(--gate-inside-soft)", borderColor: "var(--gate-inside-edge)" }
    : bad
      ? { color: "var(--gate-alert)", background: "var(--gate-alert-soft)", borderColor: "var(--gate-alert-edge)" }
      : { color: "var(--gate-pending)", background: "var(--gate-pending-soft)", borderColor: "var(--gate-pending-edge)" };
  return (
    <li className="flex items-start gap-3 rounded-2xl border px-3 py-2.5" style={{ background: tone.background, borderColor: tone.borderColor }} role="status">
      <span className="mt-0.5 shrink-0" style={{ color: tone.color }}>
        {row.state === "checking" ? <Loader2 className="h-5 w-5 animate-spin" /> : ok ? <CheckCircle2 className="h-5 w-5" /> : <TriangleAlert className="h-5 w-5" />}
      </span>
      <span className="min-w-0 flex-1">
        {row.state === "checking" ? (
          <span className="block text-[14px] font-semibold text-content-1">Checking code…</span>
        ) : ok && row.chip ? (
          <>
            <span className="block text-[15px] font-semibold text-content-1">
              Recognised: <span className="font-mono">{row.chip.reference}</span>
              {row.chip.summary ? <span className="font-normal text-content-2"> · {row.chip.summary}</span> : null}
            </span>
            <span className="block truncate text-[13px] text-content-3">
              {row.chip.kind_label}
              {row.chip.party_name ? ` · ${row.chip.party_name}` : ""}
            </span>
            {!compact && row.chip.warnings?.length ? <span className="mt-0.5 block text-[13px] font-semibold" style={{ color: "var(--gate-pending)" }}>{row.chip.warnings[0]}</span> : null}
          </>
        ) : (
          <>
            <span className="block text-[14px] font-semibold text-content-1">{bad ? "Not recognised" : "Not checked yet"}</span>
            <span className="block text-[13px] text-content-2">{row.error}</span>
          </>
        )}
      </span>
      {!compact && row.state === "unchecked" && onRetry ? (
        <button type="button" onClick={onRetry} disabled={disabled} className="gate-press min-h-[44px] shrink-0 rounded-xl px-3 text-[14px] font-semibold text-content-1">
          Retry
        </button>
      ) : null}
      {!compact && onRemove ? (
        <button type="button" onClick={onRemove} disabled={disabled} aria-label="Remove this code" className="gate-press flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-1/70 text-content-2 disabled:opacity-40">
          <X className="h-5 w-5" />
        </button>
      ) : null}
    </li>
  );
}

function DepartureReceipt({ document, refreshPending, onNext }: { document: OutwardDocument; refreshPending: boolean; onNext: () => void }) {
  const matched = document.status === "MATCHED";
  const unknown = document.scanned_refs.filter((row) => row.status === "INVALID").length;
  return (
    <div className="gate-card gate-rise overflow-hidden" role="status">
      <div className="px-5 pb-5 pt-6 text-center" style={{ background: "var(--gate-out-soft)" }}>
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-surface-1" style={{ color: "var(--gate-inside)" }}>
          <CheckCircle2 className="h-9 w-9" />
        </div>
        <h1 className="mt-3 text-[22px] font-semibold tracking-[-0.02em] text-content-1">Outward recorded</h1>
        <p className="mt-1 text-[15px] text-content-2">
          {document.plant_name} · {gateDay(document.departed_at, true)} at <span className="gate-num font-semibold">{gateTime(document.departed_at)}</span>
        </p>
        <p className="mt-1 text-[12px] text-content-4">Server time · leaving time is fixed and cannot be changed</p>
        {document.replayed ? <p className="mt-2 text-[13px] text-content-3">This departure was already saved — it was not recorded twice.</p> : null}
        {refreshPending ? <p className="mt-2 text-[13px] text-content-3">Saved. Today&apos;s list will refresh when the connection settles.</p> : null}
      </div>
      <div className="space-y-2 p-4">
        {document.links.length ? (
          <ul className="space-y-2" aria-label="Recognised documents">
            {document.links.map((link) => (
              <li key={link.id} className="flex items-start gap-3 rounded-2xl border px-3 py-2.5" style={{ borderColor: "var(--gate-inside-edge)", background: "var(--gate-inside-soft)" }}>
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" style={{ color: "var(--gate-inside)" }} />
                <span className="min-w-0">
                  <span className="block font-mono text-[15px] font-semibold text-content-1">{link.reference}</span>
                  <span className="block truncate text-[13px] text-content-3">
                    {link.kind_label}
                    {link.party_name ? ` · ${link.party_name}` : ""}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
        <dl className="gate-ledger text-[14px]">
          <Row label="Pages">
            <span className="inline-flex items-center gap-1.5">
              <FileImage className="h-4 w-4 text-content-4" />
              {document.page_count}
            </span>
          </Row>
          <Row label="Vehicle">{document.vehicle_number ? <span className="gate-num font-semibold">{document.vehicle_number}</span> : <span className="text-content-3">Not noted</span>}</Row>
          <Row label="Status">{matched ? "Matched to ERP" : "Office will match"}</Row>
          <Row label="Ref">
            <span className="font-mono">{document.reference}</span>
          </Row>
        </dl>
        {unknown ? (
          <p className="rounded-2xl border px-4 py-3 text-[13px]" style={{ borderColor: "var(--gate-pending-edge)", background: "var(--gate-pending-soft)", color: "var(--content-2)" }}>
            {unknown} scanned code{unknown === 1 ? " was" : "s were"} not recognised. The photos are saved; the office will check {unknown === 1 ? "it" : "them"}.
          </p>
        ) : null}
      </div>
      <div className="grid gap-2 px-4 pb-4">
        <GateAction tone="out" onClick={onNext}>
          <Truck className="h-5 w-5" /> Next vehicle
        </GateAction>
        <Link href="/gate" className="gate-press flex min-h-[52px] items-center justify-center rounded-2xl text-[15px] font-semibold text-content-2">
          Gate home
        </Link>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="gate-ledger-row flex items-center gap-3 px-3 py-2.5">
      <dt className="w-[72px] shrink-0 text-[12px] font-semibold uppercase tracking-[0.08em] text-content-4">{label}</dt>
      <dd className="min-w-0 flex-1 text-content-1">{children}</dd>
    </div>
  );
}

/** The watchman's own departures today and whether the office has matched them. */
export function TodayDepartures() {
  const { plantId } = useGate();
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [plantId]);
  const q = useQuery({
    queryKey: ["gate", "outward", "mine", plantId, page],
    queryFn: () => outwardApi.listMine(plantId, page),
    enabled: Boolean(plantId),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    meta: { suppressGlobalError: true },
  });
  const rows = useMemo(() => q.data?.results ?? [], [q.data]);
  return (
    <section aria-label="Left today">
      <SectionHeading eyebrow="Departures you recorded" title="Left today" />
      {q.isError ? (
        <div className="gate-card flex items-center justify-between gap-3 p-4 text-[14px] text-content-3">
          <span>Could not refresh today&apos;s departures.</span>
          <button type="button" onClick={() => void q.refetch()} className="gate-press min-h-[44px] rounded-xl px-3 font-semibold text-content-1">
            Retry
          </button>
        </div>
      ) : rows.length ? (
        <ul className="gate-ledger overflow-hidden">
          {rows.map((row) => {
            const matched = row.status === "MATCHED";
            return (
              <li key={row.id} className="gate-ledger-row flex items-center gap-3 px-4 py-3">
                <span className="gate-num w-[64px] shrink-0 text-[15px] font-semibold text-content-1">{gateTime(row.departed_at)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] text-content-2">
                    {row.links.length ? row.links.map((link) => link.reference).join(", ") : `${row.page_count} page${row.page_count === 1 ? "" : "s"}`}
                  </span>
                  <span className="block truncate text-[12px] text-content-4">
                    {row.vehicle_number || "No vehicle noted"} · <span className="font-mono">{row.reference}</span>
                  </span>
                </span>
                <span
                  className="inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] font-semibold"
                  style={
                    matched
                      ? { color: "var(--gate-inside)", background: "var(--gate-inside-soft)", borderColor: "var(--gate-inside-edge)" }
                      : { color: "var(--gate-pending)", background: "var(--gate-pending-soft)", borderColor: "var(--gate-pending-edge)" }
                  }
                >
                  {matched ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clock3 className="h-3.5 w-3.5" />}
                  {OUTWARD_STATUS_META[row.status]?.short ?? row.status}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="gate-card p-4 text-[14px] text-content-3">{q.isLoading ? "Loading…" : "No departures recorded by you today yet."}</div>
      )}
      {q.data && q.data.count > 25 ? (
        <div className="mt-3 flex items-center justify-between gap-2 text-sm text-content-3">
          <button type="button" disabled={page === 1 || q.isFetching} onClick={() => setPage((n) => n - 1)} className="gate-press min-h-[44px] rounded-xl border border-line px-3 disabled:opacity-40">Previous</button>
          <span className="gate-num">{page} / {Math.ceil(q.data.count / 25)}</span>
          <button type="button" disabled={!q.data.next || q.isFetching} onClick={() => setPage((n) => n + 1)} className="gate-press min-h-[44px] rounded-xl border border-line px-3 disabled:opacity-40">Next</button>
        </div>
      ) : null}
    </section>
  );
}

/**
 * Departures recorded today for the gate-home tile. Watchman: own (server
 * forces today/own); Owner/Admin: everyone at this gate today. Undefined when
 * this account cannot read outward records.
 */
export function useOutwardTodayCount(enabled: boolean) {
  const { plantId, isWatchman } = useGate();
  const q = useQuery({
    queryKey: ["gate", "outward", "today", plantId, isWatchman],
    queryFn: () =>
      isWatchman ? outwardApi.listMine(plantId, 1) : outwardApi.list({ plant: plantId, date_from: todayIso(), date_to: todayIso(), page_size: 1 }),
    enabled: enabled && Boolean(plantId),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    retry: false,
    meta: { suppressGlobalError: true },
  });
  return { count: q.data?.count, loading: q.isLoading };
}

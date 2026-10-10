"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, CheckCircle2, Clock3, FileImage } from "lucide-react";

import {
  BILL_MAX_PAGES,
  BILL_STATUS_META,
  gateBillsApi,
  type InwardBill,
} from "@/services/gate-bills";
import { useGate } from "./gate-shell";
import { gateDay, gateTime } from "./gate-format";
import { GateAction, OperationBanner, SectionHeading } from "./gate-ui";
import { FactoryChoice, PageCaptureSection, usePageDrafts, type CaptureCopy } from "./page-capture";
import { useGateOperation } from "./use-gate-operation";

/*
 * Watchman inward arrival = photos of the bill, nothing typed.
 * Pages are kept only in memory (Blob + object URL) in the order shown; the
 * upload freezes token + files so a lost response retries the same request.
 * The camera/page list is shared with the outward flow (page-capture.tsx).
 */

const BILL_COPY: CaptureCopy = {
  noun: "bill",
  sectionTitle: "Bill pages",
  headingId: "bill-pages",
  takeLabel: "Take bill photo",
  takeHint: "Hold the phone flat over the bill. Keep all four edges in the photo.",
  tooManyPages: `A bill can have at most ${BILL_MAX_PAGES} pages. Extra photos were not added.`,
  pageAlt: (n) => `Bill page ${n}`,
  fullAlt: "Bill page full size",
};

const IN_TONE = { color: "var(--gate-in)", soft: "var(--gate-in-soft)", edge: "var(--gate-in-edge)" };

export function BillCapture() {
  const { plants, plant, plantId, setPlantId } = useGate();
  const qc = useQueryClient();
  const drafts = usePageDrafts(BILL_MAX_PAGES, BILL_COPY);
  const { pages, preparing } = drafts;
  const [progress, setProgress] = useState<number | null>(null);

  const op = useGateOperation<{ plant: string; images: Blob[] }, InwardBill>({
    send: async (payload) => {
      setProgress(0);
      try {
        return await gateBillsApi.upload(payload, setProgress);
      } finally {
        setProgress(null);
      }
    },
    onSaved: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ["gate", "bills", "mine"] }),
        qc.invalidateQueries({ queryKey: ["gate", "summary"] }),
      ]),
  });
  const locked = op.locked || preparing;

  // Leaving with unsent pages (or an unconfirmed upload) must never look saved.
  useEffect(() => {
    const dirty = (pages.length > 0 && op.phase !== "saved") || op.phase === "sending" || op.phase === "uncertain";
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [pages.length, op.phase]);

  const submit = () => {
    if (!plantId || !pages.length || locked) return;
    void op.submit({ plant: plantId, images: pages.map((p) => p.blob) });
  };

  const startNext = () => {
    drafts.reset();
    op.reset();
    window.scrollTo({ top: 0 });
  };

  if (op.phase === "saved" && op.result) {
    return (
      <div className="mx-auto max-w-[640px] space-y-6">
        <ArrivalReceipt bill={op.result} refreshPending={op.refreshPending} onNext={startNext} />
        <TodayArrivals />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[640px] space-y-5 pb-28">
      <header className="px-1 pt-1">
        <div className="text-[13px] font-medium text-content-3">Goods coming in</div>
        <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-content-1">Take bill photo</h1>
        <p className="mt-1 text-[14px] leading-relaxed text-content-3">
          Photograph every page of the bill. Nothing to type — the store team enters the details. Arrival time is stamped by the server.
        </p>
      </header>

      <FactoryChoice plants={plants} plant={plant} plantId={plantId} setPlantId={setPlantId} locked={locked} tone="var(--gate-in)" headingId="bill-factory" />

      <PageCaptureSection drafts={drafts} copy={BILL_COPY} tone={IN_TONE} locked={locked} canStart={Boolean(plantId)} />

      <OperationBanner
        phase={op.phase}
        error={op.error}
        onRetry={() => void op.retry()}
        onRelease={op.release}
        releaseLabel="Edit pages"
        uncertainHint="Check “Today's arrivals” below before editing. Sending again uses the same upload and cannot record the bill twice."
      />

      {op.phase !== "uncertain" ? (
        <div className="gate-safe-bottom sticky bottom-[76px] z-30 lg:bottom-4">
          <GateAction
            tone="in"
            className="w-full shadow-[0_10px_30px_-12px_rgba(15,23,42,0.45)]"
            disabled={!pages.length || !plantId || preparing}
            busy={op.phase === "sending"}
            onClick={submit}
          >
            {op.phase === "sending"
              ? progress !== null && progress < 1
                ? `Uploading bill… ${Math.round(progress * 100)}%`
                : "Saving arrival…"
              : pages.length
                ? `Record arrival · ${pages.length} page${pages.length === 1 ? "" : "s"}`
                : "Record arrival"}
          </GateAction>
        </div>
      ) : null}

      <TodayArrivals />
    </div>
  );
}

function ArrivalReceipt({ bill, refreshPending, onNext }: { bill: InwardBill; refreshPending: boolean; onNext: () => void }) {
  const dup = bill.duplicate_warning?.possible_duplicate;
  return (
    <div className="gate-card gate-rise overflow-hidden" role="status">
      <div className="px-5 pb-5 pt-6 text-center" style={{ background: "var(--gate-in-soft)" }}>
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-surface-1" style={{ color: "var(--gate-inside)" }}>
          <CheckCircle2 className="h-9 w-9" />
        </div>
        <h1 className="mt-3 text-[22px] font-semibold tracking-[-0.02em] text-content-1">Arrival recorded</h1>
        <p className="mt-1 text-[15px] text-content-2">
          {bill.plant_name} · {gateDay(bill.arrival_at, true)} at <span className="gate-num font-semibold">{gateTime(bill.arrival_at)}</span>
        </p>
        <p className="mt-1 text-[12px] text-content-4">Server time · the store team has been notified</p>
        {bill.replayed ? <p className="mt-2 text-[13px] text-content-3">This bill was already saved — it was not recorded twice.</p> : null}
        {refreshPending ? <p className="mt-2 text-[13px] text-content-3">Saved. Today&apos;s list will refresh when the connection settles.</p> : null}
      </div>
      <dl className="gate-ledger m-4 text-[14px]">
        <Row label="Pages">
          <span className="inline-flex items-center gap-1.5">
            <FileImage className="h-4 w-4 text-content-4" />
            {bill.page_count}
          </span>
        </Row>
        <Row label="Status">{BILL_STATUS_META[bill.status]?.label ?? bill.status}</Row>
        <Row label="Ref">
          <span className="font-mono">{bill.id.slice(0, 8).toUpperCase()}</span>
        </Row>
      </dl>
      {dup ? (
        <p className="mx-4 mb-3 rounded-2xl border px-4 py-3 text-[13px]" style={{ borderColor: "var(--gate-pending-edge)", background: "var(--gate-pending-soft)", color: "var(--content-2)" }}>
          These photos look the same as a bill already uploaded here. It is saved anyway — the store team will check whether it is a repeat.
        </p>
      ) : null}
      <div className="grid gap-2 px-4 pb-4">
        <GateAction tone="in" onClick={onNext}>
          <Camera className="h-5 w-5" /> Next bill
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

/** The watchman's own arrivals today and whether the store has received them. */
export function TodayArrivals() {
  const { plantId } = useGate();
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [plantId]);
  const q = useQuery({
    queryKey: ["gate", "bills", "mine", plantId, page],
    queryFn: () => gateBillsApi.listMine(plantId, page),
    enabled: Boolean(plantId),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    meta: { suppressGlobalError: true },
  });
  const rows = useMemo(() => q.data?.results ?? [], [q.data]);
  return (
    <section aria-label="Today's arrivals">
      <SectionHeading eyebrow="Bills you recorded" title="Today's arrivals" />
      {q.isError ? (
        <div className="gate-card flex items-center justify-between gap-3 p-4 text-[14px] text-content-3">
          <span>Could not refresh today&apos;s arrivals.</span>
          <button type="button" onClick={() => void q.refetch()} className="gate-press min-h-[44px] rounded-xl px-3 font-semibold text-content-1">
            Retry
          </button>
        </div>
      ) : rows.length ? (
        <ul className="gate-ledger overflow-hidden">
          {rows.map((bill) => {
            const meta = BILL_STATUS_META[bill.status];
            const received = bill.status === "RECEIPTED";
            return (
              <li key={bill.id} className="gate-ledger-row flex items-center gap-3 px-4 py-3">
                <span className="gate-num w-[64px] shrink-0 text-[15px] font-semibold text-content-1">{gateTime(bill.arrival_at)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] text-content-2">
                    {bill.page_count} page{bill.page_count === 1 ? "" : "s"} · {bill.plant_name}
                  </span>
                  <span className="font-mono text-[12px] text-content-4">{bill.id.slice(0, 8).toUpperCase()}</span>
                </span>
                <span
                  className="inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] font-semibold"
                  style={
                    received
                      ? { color: "var(--gate-inside)", background: "var(--gate-inside-soft)", borderColor: "var(--gate-inside-edge)" }
                      : { color: "var(--gate-pending)", background: "var(--gate-pending-soft)", borderColor: "var(--gate-pending-edge)" }
                  }
                >
                  {received ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Clock3 className="h-3.5 w-3.5" />}
                  {meta?.short ?? bill.status}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="gate-card p-4 text-[14px] text-content-3">{q.isLoading ? "Loading…" : "No bills recorded by you today yet."}</div>
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

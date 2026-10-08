"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  Camera,
  CheckCircle2,
  Clock3,
  FileImage,
  ImagePlus,
  Loader2,
  MapPin,
  RotateCcw,
  Trash2,
  TriangleAlert,
} from "lucide-react";

import { cn } from "@/lib/utils";
import {
  BILL_ACCEPT,
  BILL_MAX_BYTES,
  BILL_MAX_PAGES,
  BILL_MIN_EDGE,
  BILL_STATUS_META,
  gateBillsApi,
  type InwardBill,
} from "@/services/gate-bills";
import { useGate } from "./gate-shell";
import { gateDay, gateTime } from "./gate-format";
import { GateAction, GateSheet, OperationBanner, SectionHeading } from "./gate-ui";
import { useGateOperation } from "./use-gate-operation";

/*
 * Watchman inward arrival = photos of the bill, nothing typed.
 * Pages are kept only in memory (Blob + object URL) in the order shown; the
 * upload freezes token + files so a lost response retries the same request.
 */

type DraftPage = { key: string; blob: Blob; url: string; width: number; height: number; note?: string };

const MAX_PIXELS = 40_000_000;
const REENCODE_LONG_EDGE = 3200; // above the server's 2400 normalisation: no legibility loss

let pageSeq = 0;
const nextKey = () => `bill-page-${++pageSeq}`;

async function decode(file: Blob): Promise<{ width: number; height: number; bitmap?: ImageBitmap }> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
    return { width: bitmap.width, height: bitmap.height, bitmap };
  }
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("decode"));
      el.src = url;
    });
    return { width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function reencode(bitmap: ImageBitmap): Promise<Blob> {
  const scale = Math.min(1, REENCODE_LONG_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This phone could not prepare the photo.");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  for (const quality of [0.92, 0.88, 0.84]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob && blob.size <= BILL_MAX_BYTES) return blob;
  }
  throw new Error("This photo is too large even after preparing it. Retake it a little further away.");
}

/** Validate one picked/captured file against the server contract; never crops. */
async function preparePage(file: File): Promise<DraftPage> {
  const type = (file.type || "").toLowerCase();
  const name = file.name.toLowerCase();
  if (type === "image/heic" || type === "image/heif" || name.endsWith(".heic") || name.endsWith(".heif")) {
    throw new Error("HEIC photos are not accepted. Use the Take bill photo button, or set the iPhone camera to “Most Compatible” (JPEG).");
  }
  if (!["image/jpeg", "image/png", "image/webp"].includes(type)) {
    throw new Error("Only JPEG, PNG or WebP photos of the bill can be uploaded (no PDF).");
  }
  let decoded: Awaited<ReturnType<typeof decode>>;
  try {
    decoded = await decode(file);
  } catch {
    throw new Error("This photo could not be opened. Please retake it.");
  }
  const { width, height, bitmap } = decoded;
  try {
    if (Math.min(width, height) < BILL_MIN_EDGE) {
      throw new Error(`Photo is too small (${width}×${height}). Take it closer so the bill fills the frame.`);
    }
    let blob: Blob = file;
    let note: string | undefined;
    if (file.size > BILL_MAX_BYTES || width * height > MAX_PIXELS) {
      if (!bitmap) throw new Error("Photo is larger than 10 MB. Retake it with a lower camera resolution.");
      blob = await reencode(bitmap);
      note = "Prepared for upload (large photo)";
    }
    return { key: nextKey(), blob, url: URL.createObjectURL(blob), width, height, note };
  } finally {
    bitmap?.close();
  }
}

export function BillCapture() {
  const { plants, plant, plantId, setPlantId } = useGate();
  const qc = useQueryClient();
  const [pages, setPages] = useState<DraftPage[]>([]);
  const [pickError, setPickError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [viewKey, setViewKey] = useState<string | null>(null);
  const [replaceKey, setReplaceKey] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const pagesRef = useRef(pages);
  pagesRef.current = pages;

  // Release object URLs on unmount.
  useEffect(() => () => pagesRef.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

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

  const addFiles = useCallback(
    async (files: FileList | null, replace?: string | null) => {
      if (!files?.length) return;
      setPickError(null);
      setPreparing(true);
      try {
        const room = replace ? 1 : BILL_MAX_PAGES - pagesRef.current.length;
        const list = Array.from(files).slice(0, Math.max(0, room));
        if (!replace && files.length > room) setPickError(`A bill can have at most ${BILL_MAX_PAGES} pages. Extra photos were not added.`);
        const prepared: DraftPage[] = [];
        for (const file of list) {
          try {
            prepared.push(await preparePage(file));
          } catch (error) {
            setPickError(error instanceof Error ? error.message : "Photo could not be used.");
          }
        }
        if (!prepared.length) return;
        setPages((current) => {
          if (replace) {
            return current.map((p) => {
              if (p.key !== replace) return p;
              URL.revokeObjectURL(p.url);
              return prepared[0];
            });
          }
          return [...current, ...prepared];
        });
      } finally {
        setPreparing(false);
        setReplaceKey(null);
      }
    },
    [],
  );

  const removePage = (key: string) =>
    setPages((current) => {
      const target = current.find((p) => p.key === key);
      if (target) URL.revokeObjectURL(target.url);
      return current.filter((p) => p.key !== key);
    });

  const movePage = (key: string, delta: -1 | 1) =>
    setPages((current) => {
      const index = current.findIndex((p) => p.key === key);
      const to = index + delta;
      if (index < 0 || to < 0 || to >= current.length) return current;
      const next = [...current];
      [next[index], next[to]] = [next[to], next[index]];
      return next;
    });

  const submit = () => {
    if (!plantId || !pages.length || locked) return;
    void op.submit({ plant: plantId, images: pages.map((p) => p.blob) });
  };

  const startNext = () => {
    pagesRef.current.forEach((p) => URL.revokeObjectURL(p.url));
    setPages([]);
    setPickError(null);
    op.reset();
    window.scrollTo({ top: 0 });
  };

  const viewing = pages.find((p) => p.key === viewKey) ?? null;

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

      {plants.length > 1 ? (
        <section aria-labelledby="bill-factory">
          <h2 id="bill-factory" className="mb-2 px-1 text-[13px] font-semibold text-content-2">
            Factory gate
          </h2>
          <div className="grid gap-2" role="radiogroup" aria-label="Factory gate">
            {plants.map((p) => {
              const active = p.id === plantId;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={locked}
                  onClick={() => setPlantId(p.id)}
                  className={cn(
                    "gate-press flex min-h-[56px] items-center gap-3 rounded-2xl border px-4 text-left disabled:opacity-60",
                    active ? "border-transparent text-white" : "border-line bg-surface-1 text-content-1",
                  )}
                  style={active ? { background: "var(--gate-in)" } : undefined}
                >
                  <MapPin className="h-5 w-5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-[16px] font-semibold">{p.name}</span>
                  {active ? <CheckCircle2 className="h-5 w-5 shrink-0" /> : null}
                </button>
              );
            })}
          </div>
        </section>
      ) : (
        <div className="flex items-center gap-2 px-1 text-[14px] text-content-2">
          <MapPin className="h-4 w-4 text-content-4" />
          Recording at <span className="font-semibold text-content-1">{plant?.name}</span>
        </div>
      )}

      <input
        ref={cameraRef}
        type="file"
        accept={BILL_ACCEPT}
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const target = replaceKey;
          void addFiles(e.target.files, target);
          e.target.value = "";
        }}
      />
      <input
        ref={galleryRef}
        type="file"
        accept={BILL_ACCEPT}
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          void addFiles(e.target.files, null);
          e.target.value = "";
        }}
      />

      <section aria-labelledby="bill-pages" className="space-y-3">
        <div className="flex items-end justify-between px-1">
          <h2 id="bill-pages" className="text-[17px] font-semibold text-content-1">
            Bill pages
          </h2>
          <span className="gate-num text-[13px] text-content-3">
            {pages.length} / {BILL_MAX_PAGES}
          </span>
        </div>

        {pages.length === 0 ? (
          <button
            type="button"
            onClick={() => { setReplaceKey(null); cameraRef.current?.click(); }}
            disabled={locked || !plantId}
            className="gate-press flex min-h-[180px] w-full flex-col items-center justify-center gap-3 rounded-[22px] border-2 border-dashed px-6 text-center disabled:opacity-60"
            style={{ borderColor: "var(--gate-in-edge)", background: "var(--gate-in-soft)", color: "var(--gate-in)" }}
          >
            {preparing ? <Loader2 className="h-10 w-10 animate-spin" /> : <Camera className="h-10 w-10" />}
            <span className="text-[18px] font-semibold">Take bill photo</span>
            <span className="text-[13px] text-content-3">Hold the phone flat over the bill. Keep all four edges in the photo.</span>
          </button>
        ) : (
          <ol className="space-y-3">
            {pages.map((page, index) => (
              <li key={page.key} className="gate-card overflow-hidden">
                <button
                  type="button"
                  onClick={() => setViewKey(page.key)}
                  className="gate-press relative block w-full bg-[var(--gate-paper)]"
                  aria-label={`View page ${index + 1} full screen`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={page.url} alt={`Bill page ${index + 1}`} className="mx-auto max-h-[320px] w-full object-contain" />
                  <span className="gate-num absolute left-3 top-3 rounded-full bg-[var(--gate-ink)] px-3 py-1 text-[13px] font-semibold text-white">
                    Page {index + 1}
                  </span>
                </button>
                <div className="flex items-center gap-1.5 border-t border-line p-2">
                  <span className="min-w-0 flex-1 truncate px-2 text-[12px] text-content-3">
                    {page.width}×{page.height}
                    {page.note ? ` · ${page.note}` : ""}
                  </span>
                  <IconButton label={`Move page ${index + 1} up`} disabled={locked || index === 0} onClick={() => movePage(page.key, -1)}>
                    <ArrowUp className="h-5 w-5" />
                  </IconButton>
                  <IconButton label={`Move page ${index + 1} down`} disabled={locked || index === pages.length - 1} onClick={() => movePage(page.key, 1)}>
                    <ArrowDown className="h-5 w-5" />
                  </IconButton>
                  <IconButton
                    label={`Retake page ${index + 1}`}
                    disabled={locked}
                    onClick={() => {
                      setReplaceKey(page.key);
                      cameraRef.current?.click();
                    }}
                  >
                    <RotateCcw className="h-5 w-5" />
                  </IconButton>
                  <IconButton label={`Remove page ${index + 1}`} disabled={locked} onClick={() => removePage(page.key)}>
                    <Trash2 className="h-5 w-5" />
                  </IconButton>
                </div>
              </li>
            ))}
          </ol>
        )}

        <div className="grid grid-cols-2 gap-2">
          {pages.length > 0 ? (
            <GateAction tone="plain" size="md" onClick={() => { setReplaceKey(null); cameraRef.current?.click(); }} disabled={locked || pages.length >= BILL_MAX_PAGES}>
              <Camera className="h-5 w-5" /> Add page
            </GateAction>
          ) : null}
          <GateAction
            tone="plain"
            size="md"
            onClick={() => { setReplaceKey(null); galleryRef.current?.click(); }}
            disabled={locked || pages.length >= BILL_MAX_PAGES || !plantId}
            className={pages.length === 0 ? "col-span-2" : undefined}
          >
            <ImagePlus className="h-5 w-5" /> From gallery
          </GateAction>
        </div>

        {pickError ? (
          <p role="alert" className="flex items-start gap-2 rounded-2xl border px-4 py-3 text-[14px]" style={{ borderColor: "var(--gate-alert-edge)", background: "var(--gate-alert-soft)", color: "var(--gate-alert)" }}>
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {pickError}
          </p>
        ) : null}
      </section>

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

      <GateSheet open={Boolean(viewing)} onOpenChange={(open) => !open && setViewKey(null)} title={viewing ? `Page ${pages.indexOf(viewing) + 1}` : "Page"} tall>
        {viewing ? (
          <div className="overflow-auto rounded-2xl bg-[var(--gate-paper)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={viewing.url} alt="Bill page full size" className="h-auto w-full" />
          </div>
        ) : null}
      </GateSheet>
    </div>
  );
}

function IconButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="gate-press flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-content-2 disabled:opacity-35"
    >
      {children}
    </button>
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

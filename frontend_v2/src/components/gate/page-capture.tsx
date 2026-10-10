"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Camera, CheckCircle2, ImagePlus, Loader2, MapPin, RotateCcw, Trash2, TriangleAlert } from "lucide-react";

import { cn } from "@/lib/utils";
import { BILL_ACCEPT, BILL_MAX_BYTES, BILL_MIN_EDGE } from "@/services/gate-bills";
import type { GatePlant } from "@/services/gate";
import { GateAction, GateSheet } from "./gate-ui";

/*
 * Shared watchman camera capture for document pages (inward bills, outward
 * papers). Pages live only in memory (Blob + object URL) in the order shown;
 * the caller freezes token + files on submit so a lost response retries the
 * same request. Server contract: JPEG/PNG/WebP ≤ 10 MB, ≥ 320 px short edge,
 * ≤ 40 MP (apps/gate/bill_serializers.py, apps/gate/image_pages.py).
 */

export type DraftPage = { key: string; blob: Blob; url: string; width: number; height: number; note?: string };

export type CaptureCopy = {
  /** "bill" / "paper" — used in validation messages. */
  noun: string;
  /** Section heading, e.g. "Bill pages". */
  sectionTitle: string;
  /** id of the section heading (aria-labelledby). */
  headingId: string;
  /** Big empty-state button, e.g. "Take bill photo". */
  takeLabel: string;
  takeHint: string;
  /** "A bill can have at most 6 pages." */
  tooManyPages: string;
  pageAlt: (n: number) => string;
  fullAlt: string;
};

export type CaptureTone = { color: string; soft: string; edge: string };

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
export async function preparePage(file: File, copy: Pick<CaptureCopy, "noun" | "takeLabel">): Promise<DraftPage> {
  const type = (file.type || "").toLowerCase();
  const name = file.name.toLowerCase();
  if (type === "image/heic" || type === "image/heif" || name.endsWith(".heic") || name.endsWith(".heif")) {
    throw new Error(`HEIC photos are not accepted. Use the ${copy.takeLabel} button, or set the iPhone camera to “Most Compatible” (JPEG).`);
  }
  if (!["image/jpeg", "image/png", "image/webp"].includes(type)) {
    throw new Error(`Only JPEG, PNG or WebP photos of the ${copy.noun} can be uploaded (no PDF).`);
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
      throw new Error(`Photo is too small (${width}×${height}). Take it closer so the ${copy.noun} fills the frame.`);
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

/** In-memory page list with add / replace / reorder / remove; object URLs are always revoked. */
export function usePageDrafts(maxPages: number, copy: Pick<CaptureCopy, "noun" | "takeLabel" | "tooManyPages">) {
  const [pages, setPages] = useState<DraftPage[]>([]);
  const [pickError, setPickError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [replaceKey, setReplaceKey] = useState<string | null>(null);
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const copyRef = useRef(copy);
  copyRef.current = copy;

  // Release object URLs on unmount.
  useEffect(() => () => pagesRef.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  const addFiles = useCallback(
    async (files: FileList | null, replace?: string | null) => {
      if (!files?.length) return;
      setPickError(null);
      setPreparing(true);
      try {
        const room = replace ? 1 : maxPages - pagesRef.current.length;
        const list = Array.from(files).slice(0, Math.max(0, room));
        if (!replace && files.length > room) setPickError(copyRef.current.tooManyPages);
        const prepared: DraftPage[] = [];
        for (const file of list) {
          try {
            prepared.push(await preparePage(file, copyRef.current));
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
    [maxPages],
  );

  const removePage = useCallback(
    (key: string) =>
      setPages((current) => {
        const target = current.find((p) => p.key === key);
        if (target) URL.revokeObjectURL(target.url);
        return current.filter((p) => p.key !== key);
      }),
    [],
  );

  const movePage = useCallback(
    (key: string, delta: -1 | 1) =>
      setPages((current) => {
        const index = current.findIndex((p) => p.key === key);
        const to = index + delta;
        if (index < 0 || to < 0 || to >= current.length) return current;
        const next = [...current];
        [next[index], next[to]] = [next[to], next[index]];
        return next;
      }),
    [],
  );

  const reset = useCallback(() => {
    pagesRef.current.forEach((p) => URL.revokeObjectURL(p.url));
    setPages([]);
    setPickError(null);
  }, []);

  return { pages, pickError, preparing, replaceKey, setReplaceKey, addFiles, removePage, movePage, reset, maxPages };
}

export type PageDrafts = ReturnType<typeof usePageDrafts>;

/** Factory radio list (only when the account is assigned to more than one gate). */
export function FactoryChoice({
  plants,
  plant,
  plantId,
  setPlantId,
  locked,
  tone,
  headingId,
}: {
  plants: GatePlant[];
  plant: GatePlant | null;
  plantId: string;
  setPlantId: (id: string) => void;
  locked: boolean;
  tone: string;
  headingId: string;
}) {
  if (plants.length <= 1) {
    return (
      <div className="flex items-center gap-2 px-1 text-[14px] text-content-2">
        <MapPin className="h-4 w-4 text-content-4" />
        Recording at <span className="font-semibold text-content-1">{plant?.name}</span>
      </div>
    );
  }
  return (
    <section aria-labelledby={headingId}>
      <h2 id={headingId} className="mb-2 px-1 text-[13px] font-semibold text-content-2">
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
              style={active ? { background: tone } : undefined}
            >
              <MapPin className="h-5 w-5 shrink-0" />
              <span className="min-w-0 flex-1 truncate text-[16px] font-semibold">{p.name}</span>
              {active ? <CheckCircle2 className="h-5 w-5 shrink-0" /> : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function IconButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
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

/**
 * Hidden camera/gallery inputs + the page list (view full screen, reorder,
 * retake, remove) + "Add page" / "From gallery" + pick errors + viewer sheet.
 */
export function PageCaptureSection({
  drafts,
  copy,
  tone,
  locked,
  canStart,
}: {
  drafts: PageDrafts;
  copy: CaptureCopy;
  tone: CaptureTone;
  locked: boolean;
  /** False until a gate/plant is chosen. */
  canStart: boolean;
}) {
  const { pages, pickError, preparing, replaceKey, setReplaceKey, addFiles, removePage, movePage, maxPages } = drafts;
  const [viewKey, setViewKey] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const viewing = pages.find((p) => p.key === viewKey) ?? null;

  return (
    <>
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

      <section aria-labelledby={copy.headingId} className="space-y-3">
        <div className="flex items-end justify-between px-1">
          <h2 id={copy.headingId} className="text-[17px] font-semibold text-content-1">
            {copy.sectionTitle}
          </h2>
          <span className="gate-num text-[13px] text-content-3">
            {pages.length} / {maxPages}
          </span>
        </div>

        {pages.length === 0 ? (
          <button
            type="button"
            onClick={() => { setReplaceKey(null); cameraRef.current?.click(); }}
            disabled={locked || !canStart}
            className="gate-press flex min-h-[180px] w-full flex-col items-center justify-center gap-3 rounded-[22px] border-2 border-dashed px-6 text-center disabled:opacity-60"
            style={{ borderColor: tone.edge, background: tone.soft, color: tone.color }}
          >
            {preparing ? <Loader2 className="h-10 w-10 animate-spin" /> : <Camera className="h-10 w-10" />}
            <span className="text-[18px] font-semibold">{copy.takeLabel}</span>
            <span className="text-[13px] text-content-3">{copy.takeHint}</span>
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
                  <img src={page.url} alt={copy.pageAlt(index + 1)} className="mx-auto max-h-[320px] w-full object-contain" />
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
            <GateAction tone="plain" size="md" onClick={() => { setReplaceKey(null); cameraRef.current?.click(); }} disabled={locked || pages.length >= maxPages}>
              <Camera className="h-5 w-5" /> Add page
            </GateAction>
          ) : null}
          <GateAction
            tone="plain"
            size="md"
            onClick={() => { setReplaceKey(null); galleryRef.current?.click(); }}
            disabled={locked || pages.length >= maxPages || !canStart}
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

      <GateSheet open={Boolean(viewing)} onOpenChange={(open) => !open && setViewKey(null)} title={viewing ? `Page ${pages.indexOf(viewing) + 1}` : "Page"} tall>
        {viewing ? (
          <div className="overflow-auto rounded-2xl bg-[var(--gate-paper)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={viewing.url} alt={copy.fullAlt} className="h-auto w-full" />
          </div>
        ) : null}
      </GateSheet>
    </>
  );
}

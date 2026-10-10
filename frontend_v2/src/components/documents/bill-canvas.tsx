"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Download,
  Keyboard,
  Loader2,
  Maximize,
  MoveHorizontal,
  PinOff,
  RotateCw,
  ScanSearch,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { toast } from "sonner";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { describeApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { documentPagesApi, type PageRotation } from "@/services/document-pages";
import { gateBillsApi, type BillPage } from "@/services/gate-bills";

import {
  MAX_ZOOM,
  MIN_ZOOM,
  type BillRegion,
  type BillViewPatch,
  type BillViewState,
  type BillZoom,
  type ViewRotation,
} from "./use-bill-view-state";

/* ------------------------------------------------------------------ */
/* Private image cache (object URLs in memory only, revoked on dispose) */
/* ------------------------------------------------------------------ */

type CacheEntry = { promise: Promise<string>; url?: string };

/**
 * Authenticated page images fetched as blobs (same approach as the original
 * viewer: `gateBillsApi.pageObjectUrl`). Object URLs live only in memory and are
 * revoked when a page leaves the document or the owner unmounts.
 */
export class BillImageCache {
  private entries = new Map<string, CacheEntry>();
  private disposed = false;

  peek(src: string) {
    return this.entries.get(src)?.url;
  }

  load(src: string): Promise<string> {
    const existing = this.entries.get(src);
    if (existing) return existing.promise;
    const entry: CacheEntry = {
      promise: gateBillsApi.pageObjectUrl(src).then(
        (url) => {
          if (this.disposed || this.entries.get(src) !== entry) {
            URL.revokeObjectURL(url);
            throw new Error("Image cache released");
          }
          entry.url = url;
          return url;
        },
        (error) => {
          if (this.entries.get(src) === entry) this.entries.delete(src);
          throw error;
        },
      ),
    };
    this.entries.set(src, entry);
    return entry.promise;
  }

  prefetch(src?: string | null) {
    if (!src || this.disposed) return;
    this.load(src).catch(() => undefined);
  }

  /** Drop (and revoke) every image that is not in `keep`. */
  retain(keep: Set<string>) {
    for (const [src, entry] of this.entries) {
      if (keep.has(src)) continue;
      if (entry.url) URL.revokeObjectURL(entry.url);
      this.entries.delete(src);
    }
  }

  revive() {
    this.disposed = false;
  }

  dispose() {
    this.disposed = true;
    for (const entry of this.entries.values()) if (entry.url) URL.revokeObjectURL(entry.url);
    this.entries.clear();
  }
}

export function useBillImageCache() {
  const ref = useRef<BillImageCache | null>(null);
  if (!ref.current) ref.current = new BillImageCache();
  const cache = ref.current;
  useEffect(() => {
    cache.revive();
    return () => cache.dispose();
  }, [cache]);
  return cache;
}

type ImageState = { src: string; url: string | null; status: "idle" | "loading" | "ready" | "error" };

function usePageImage(cache: BillImageCache, src: string | undefined, nonce = 0): ImageState {
  const [state, setState] = useState<ImageState>(() => {
    const cached = src ? cache.peek(src) : undefined;
    return { src: src ?? "", url: cached ?? null, status: cached ? "ready" : src ? "loading" : "idle" };
  });
  useEffect(() => {
    if (!src) {
      setState({ src: "", url: null, status: "idle" });
      return;
    }
    const cached = cache.peek(src);
    if (cached) {
      setState({ src, url: cached, status: "ready" });
      return;
    }
    let cancelled = false;
    setState({ src, url: null, status: "loading" });
    cache.load(src).then(
      (url) => !cancelled && setState({ src, url, status: "ready" }),
      () => !cancelled && setState({ src, url: null, status: "error" }),
    );
    return () => {
      cancelled = true;
    };
  }, [cache, src, nonce]);
  // Never show the previous page's image for a new src.
  if (state.src !== (src ?? "")) {
    const cached = src ? cache.peek(src) : undefined;
    return { src: src ?? "", url: cached ?? null, status: cached ? "ready" : src ? "loading" : "idle" };
  }
  return state;
}

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

const INSET = 8;
const ZOOM_STEPS = [0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 2.5, 3, 4];

export function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

interface BaseGeometry {
  cw: number;
  ch: number;
  iw: number;
  ih: number;
  bw: number;
  bh: number;
  fitW: number;
  fitP: number;
  minFactor: number;
}

interface Placement extends BaseGeometry {
  scale: number;
  factor: number;
  dw: number;
  dh: number;
  px: number;
  py: number;
}

function baseGeometry(width: number, height: number, iw: number, ih: number, rotation: number): BaseGeometry {
  const cw = Math.max(40, width - INSET * 2);
  const ch = Math.max(40, height - INSET * 2);
  const sideways = rotation % 180 !== 0;
  const bw = sideways ? ih : iw;
  const bh = sideways ? iw : ih;
  const fitW = cw / bw;
  const fitP = Math.min(cw / bw, ch / bh);
  return { cw, ch, iw, ih, bw, bh, fitW, fitP, minFactor: Math.min(MIN_ZOOM, fitP / fitW) };
}

function factorFor(base: BaseGeometry, zoom: BillZoom) {
  if (zoom === "fit-width") return 1;
  if (zoom === "fit-page") return base.fitP / base.fitW;
  return clampNumber(zoom, base.minFactor, MAX_ZOOM);
}

function place(base: BaseGeometry, zoom: BillZoom, center: { x: number; y: number } | null): Placement {
  const factor = factorFor(base, zoom);
  const scale = base.fitW * factor;
  const dw = base.bw * scale;
  const dh = base.bh * scale;
  const cx = center?.x ?? 0.5;
  const cy = center?.y ?? (dh > base.ch ? base.ch / 2 / dh : 0.5);
  let px = base.cw / 2 - cx * dw;
  let py = base.ch / 2 - cy * dh;
  px = dw <= base.cw ? (base.cw - dw) / 2 : clampNumber(px, base.cw - dw, 0);
  py = dh <= base.ch ? (base.ch - dh) / 2 : clampNumber(py, base.ch - dh, 0);
  return { ...base, factor, scale, dw, dh, px, py };
}

function centerFor(base: BaseGeometry, factor: number, px: number, py: number) {
  const dw = base.bw * base.fitW * factor;
  const dh = base.bh * base.fitW * factor;
  return { x: (base.cw / 2 - px) / dw, y: (base.ch / 2 - py) / dh };
}

/** Zoom to `factor` keeping the page point under (mx, my) (inner coordinates) still. */
function zoomAround(p: Placement, mx: number, my: number, factor: number) {
  const next = clampNumber(factor, p.minFactor, MAX_ZOOM);
  const u = (mx - p.px) / p.dw;
  const v = (my - p.py) / p.dh;
  const dw = p.bw * p.fitW * next;
  const dh = p.bh * p.fitW * next;
  const px = mx - u * dw;
  const py = my - v * dh;
  return { zoom: next, center: { x: (p.cw / 2 - px) / dw, y: (p.ch / 2 - py) / dh } };
}

export function nextZoomStep(factor: number, direction: 1 | -1) {
  if (direction > 0) return ZOOM_STEPS.find((step) => step > factor * 1.01) ?? MAX_ZOOM;
  return [...ZOOM_STEPS].reverse().find((step) => step < factor * 0.99) ?? MIN_ZOOM;
}

/** Image-normalised region → normalised rect in the rotated view. */
function regionToView(region: BillRegion, rotation: number): BillRegion {
  const { x, y, w, h } = region;
  switch (rotation) {
    case 90:
      return { x: 1 - (y + h), y: x, w: h, h: w };
    case 180:
      return { x: 1 - (x + w), y: 1 - (y + h), w, h };
    case 270:
      return { x: y, y: 1 - (x + w), w: h, h: w };
    default:
      return { ...region };
  }
}

/** Normalised rect in the rotated view → image-normalised region. */
function viewToRegion(rect: BillRegion, rotation: number): BillRegion {
  const { x, y, w, h } = rect;
  switch (rotation) {
    case 90:
      return { x: y, y: 1 - (x + w), w: h, h: w };
    case 180:
      return { x: 1 - (x + w), y: 1 - (y + h), w, h };
    case 270:
      return { x: 1 - (y + h), y: x, w: h, h: w };
    default:
      return { ...rect };
  }
}

function regionView(base: BaseGeometry, pin: BillRegion, rotation: number) {
  const r = regionToView(pin, rotation);
  const scale = Math.min(base.cw / Math.max(1, r.w * base.bw), base.ch / Math.max(1, r.h * base.bh)) * 0.94;
  return { zoom: clampNumber(scale / base.fitW, base.minFactor, MAX_ZOOM), center: { x: r.x + r.w / 2, y: r.y + r.h / 2 } };
}

/* ------------------------------------------------------------------ */
/* Shared rotation saves (optimistic, survive viewer remounts)        */
/* ------------------------------------------------------------------ */

const savedRotations = new Map<string, ViewRotation>();

export function serverRotation(page: BillPage | undefined): ViewRotation {
  if (!page) return 0;
  const saved = savedRotations.get(page.id);
  const server = (page.display_rotation ?? 0) as ViewRotation;
  if (saved !== undefined && saved === server) savedRotations.delete(page.id);
  return saved ?? server;
}

export function viewRotation(view: BillViewState, page: BillPage | undefined): ViewRotation {
  if (!page) return 0;
  return view.rotations[page.id] ?? serverRotation(page);
}

/* ------------------------------------------------------------------ */
/* Small UI pieces                                                     */
/* ------------------------------------------------------------------ */

export function ViewerButton({
  label,
  onClick,
  disabled,
  active,
  children,
  className,
  testId,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active === undefined ? undefined : active}
      data-testid={testId}
      className={cn(
        "inline-flex h-8 min-w-8 shrink-0 items-center justify-center gap-1 rounded-lg border px-1.5 text-[12px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:min-w-11",
        active ? "border-info-border bg-info-bg text-info-fg" : "border-line bg-surface-1 text-content-2 hover:bg-surface-2",
        className,
      )}
    >
      {children}
    </button>
  );
}

const SHORTCUTS: Array<[string, string]> = [
  ["Alt + B", "Show / hide the bill"],
  ["Alt + ← / →", "Previous / next page"],
  ["Alt + = / −", "Zoom in / out"],
  ["Alt + 0", "Fit width"],
  ["Alt + R", "Rotate view"],
];

export function ShortcutsPopover({ includeToggle = true }: { includeToggle?: boolean }) {
  const rows = includeToggle ? SHORTCUTS : SHORTCUTS.slice(1);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts"
          className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-1 text-content-2 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border md:inline-flex"
        >
          <Keyboard className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(19rem,calc(100vw-1rem))] p-3">
        <div className="mb-2 text-[12px] font-semibold text-content-1">Bill shortcuts</div>
        <dl className="space-y-1.5 text-[12px]">
          {rows.map(([keys, label]) => (
            <div key={keys} className="flex items-center justify-between gap-3">
              <dt>
                <kbd className="rounded-md border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-content-1">{keys}</kbd>
              </dt>
              <dd className="text-right text-content-3">{label}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 border-t border-line pt-2 text-[11.5px] leading-snug text-content-3">
          Shortcuts work while typing in the form. Drag to move the page, Ctrl/⌘ + scroll or pinch to zoom, double-click to zoom in, Shift-drag (or
          <Crosshair className="mx-1 inline h-3 w-3" aria-hidden />
          then drag) to pin an area.
        </p>
      </PopoverContent>
    </Popover>
  );
}

function Thumb({
  cache,
  page,
  index,
  active,
  rotation,
  onSelect,
}: {
  cache: BillImageCache;
  page: BillPage;
  index: number;
  active: boolean;
  rotation: number;
  onSelect: () => void;
}) {
  const img = usePageImage(cache, page.thumb_url || page.image_url);
  const sideways = rotation % 180 !== 0;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-label={`Page ${index + 1}`}
      title={`Page ${index + 1}`}
      onClick={onSelect}
      className={cn(
        "relative flex h-[--thumb-h] w-[--thumb-w] shrink-0 items-center justify-center overflow-hidden rounded-md border bg-surface-2 [--thumb-h:60px] [--thumb-w:46px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border [@media(pointer:coarse)]:[--thumb-h:64px] [@media(pointer:coarse)]:[--thumb-w:48px]",
        active ? "border-primary ring-2 ring-info-border" : "border-line opacity-80 hover:opacity-100",
      )}
    >
      {img.url ? (
        <img
          src={img.url}
          alt=""
          draggable={false}
          className={cn("max-w-none object-cover object-top", sideways ? "absolute left-1/2 top-1/2" : "h-full w-full")}
          style={
            sideways
              ? { width: "var(--thumb-h)", height: "var(--thumb-w)", transform: `translate(-50%, -50%) rotate(${rotation}deg)` }
              : rotation
                ? { transform: `rotate(${rotation}deg)` }
                : undefined
          }
        />
      ) : img.status === "error" ? (
        <span className="text-[10px] text-danger-fg">!</span>
      ) : (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-content-4 motion-reduce:animate-none" aria-hidden />
      )}
      <span className="absolute bottom-0.5 right-0.5 rounded bg-surface-1 px-1 text-[10px] font-semibold tabular-nums text-content-1">{index + 1}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Canvas                                                              */
/* ------------------------------------------------------------------ */

export interface BillCanvasHandle {
  zoomStep: (direction: 1 | -1) => void;
  fitWidth: () => void;
  rotate: () => void;
  goTo: (delta: number) => void;
}

export interface BillCanvasProps {
  pages: BillPage[];
  /** Used for alt text and the download file name. */
  label: string;
  view: BillViewState;
  onView: (patch: BillViewPatch) => void;
  cache: BillImageCache;
  className?: string;
  /** Extra controls at the end of the toolbar (mode buttons, close…). */
  toolbarEnd?: ReactNode;
  showStrip?: boolean;
  showHints?: boolean;
  /** Include Alt+B in the shortcut list. */
  shortcutsIncludeToggle?: boolean;
}

type Gesture =
  | { kind: "pan"; id: number; startX: number; startY: number; px: number; py: number; moved: boolean }
  | { kind: "pinch"; startDist: number; startFactor: number; startPx: number; startPy: number; midX: number; midY: number }
  | { kind: "select"; id: number; startX: number; startY: number; x: number; y: number };

/**
 * Zoomable, pannable, rotatable page canvas with page strip and region pin.
 * Controlled through `view` / `onView`; rotation only changes the view (the
 * stored image is immutable evidence) unless "Save rotation for everyone" is used.
 */
export const BillCanvas = forwardRef<BillCanvasHandle, BillCanvasProps>(function BillCanvas(
  { pages, label, view, onView, cache, className, toolbarEnd, showStrip = true, showHints = true, shortcutsIncludeToggle = true },
  ref,
) {
  const count = pages.length;
  // The viewport only exists while there are pages; observers re-attach when they arrive.
  const hasPages = count > 0;
  const index = clampNumber(view.page, 0, Math.max(0, count - 1));
  const page = pages[index];
  const rotation = viewRotation(view, page);
  const savedRotation = serverRotation(page);
  const [retry, setRetry] = useState(0);
  const full = usePageImage(cache, page?.image_url, retry);
  const thumb = usePageImage(cache, page ? page.thumb_url || undefined : undefined);
  const [natural, setNatural] = useState<Record<string, { w: number; h: number }>>({});
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [live, setLive] = useState<{ zoom: number; center: { x: number; y: number } } | null>(null);
  const [selection, setSelection] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [pinMode, setPinMode] = useState(false);
  const [savingRotation, setSavingRotation] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [, forceRender] = useState(0);
  const viewportRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());

  // Keep the cache to this document's pages; prefetch the neighbours.
  const srcKey = pages.map((p) => `${p.image_url}|${p.thumb_url ?? ""}`).join(",");
  useEffect(() => {
    const keep = new Set<string>();
    for (const p of pages) {
      keep.add(p.image_url);
      if (p.thumb_url) keep.add(p.thumb_url);
    }
    cache.retain(keep);
  }, [cache, srcKey]);
  useEffect(() => {
    if (full.status !== "ready") return;
    cache.prefetch(pages[index + 1]?.image_url);
  }, [cache, full.status, index, srcKey]);

  // Clamp a stale stored page index.
  useEffect(() => {
    if (count && view.page > count - 1) onView({ page: count - 1, center: null });
  }, [count, view.page, onView]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setSize((prev) => (Math.abs(prev.width - rect.width) < 0.5 && Math.abs(prev.height - rect.height) < 0.5 ? prev : { width: rect.width, height: rect.height }));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasPages]);

  const nat = page ? natural[page.id] ?? (page.width > 0 && page.height > 0 ? { w: page.width, h: page.height } : { w: 1000, h: 1414 }) : { w: 1000, h: 1414 };
  const base = useMemo(() => baseGeometry(size.width, size.height, nat.w, nat.h, rotation), [size.width, size.height, nat.w, nat.h, rotation]);
  const pinActive = Boolean(view.pin && view.pinFollow);
  const target = live ?? (pinActive && view.pin ? regionView(base, view.pin, rotation) : { zoom: view.zoom, center: view.center });
  const p = place(base, target.zoom, target.center);
  const placementRef = useRef(p);
  placementRef.current = p;

  const commit = useCallback(
    (zoom: BillZoom, center: { x: number; y: number } | null) => onView({ zoom, center, pinFollow: false }),
    [onView],
  );

  const goTo = useCallback(
    (delta: number) => {
      if (!count) return;
      onView((v) => {
        const next = clampNumber(clampNumber(v.page, 0, count - 1) + delta, 0, count - 1);
        return next === v.page ? {} : { page: next, center: null, pinFollow: Boolean(v.pin) };
      });
    },
    [count, onView],
  );

  const zoomStep = useCallback(
    (direction: 1 | -1) => {
      const cur = placementRef.current;
      const next = nextZoomStep(cur.factor, direction);
      const z = zoomAround(cur, cur.cw / 2, cur.ch / 2, next);
      commit(z.zoom, z.center);
    },
    [commit],
  );

  const fitWidth = useCallback(() => onView({ zoom: "fit-width", center: null, pinFollow: false }), [onView]);
  const fitPage = useCallback(() => onView({ zoom: "fit-page", center: null, pinFollow: false }), [onView]);

  const rotate = useCallback(() => {
    if (!page) return;
    onView((v) => ({ rotations: { ...v.rotations, [page.id]: (((viewRotation(v, page) + 90) % 360) as ViewRotation) }, center: null }));
  }, [onView, page]);

  useImperativeHandle(ref, () => ({ zoomStep, fitWidth, rotate, goTo }), [zoomStep, fitWidth, rotate, goTo]);

  const saveRotation = async () => {
    if (!page?.page_kind || savingRotation) return;
    const previous = savedRotations.get(page.id);
    const value = rotation as PageRotation;
    savedRotations.set(page.id, value);
    setSavingRotation(true);
    forceRender((n) => n + 1);
    try {
      await documentPagesApi.saveRotation({ page_kind: page.page_kind, page_id: page.id, rotation: value });
      toast.success(`Page ${index + 1} now opens ${value ? `rotated ${value}°` : "upright"} for everyone.`);
    } catch (error) {
      if (previous === undefined) savedRotations.delete(page.id);
      else savedRotations.set(page.id, previous);
      toast.error(`Could not save the rotation: ${describeApiError(error, "check the connection and try again.")}`);
    } finally {
      setSavingRotation(false);
      forceRender((n) => n + 1);
    }
  };

  const download = async () => {
    if (!page || downloading) return;
    setDownloading(true);
    try {
      const blob = await gateBillsApi.pageBlob(page.image_url);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${label.replace(/[^\w.-]+/g, "-").replace(/-+/g, "-")}-page-${page.page_number || index + 1}.jpg`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch (error) {
      toast.error(`Could not download this page: ${describeApiError(error, "check the connection and try again.")}`);
    } finally {
      setDownloading(false);
    }
  };

  /* ---------------- pointer / wheel / keyboard ---------------- */

  const local = (event: { clientX: number; clientY: number }) => {
    const rect = viewportRef.current?.getBoundingClientRect();
    return { x: event.clientX - (rect?.left ?? 0) - INSET, y: event.clientY - (rect?.top ?? 0) - INSET };
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if ((event.target as HTMLElement).closest("[data-canvas-control]")) return;
    const el = viewportRef.current;
    if (!el || !page) return;
    el.setPointerCapture?.(event.pointerId);
    const pt = local(event);
    pointers.current.set(event.pointerId, pt);
    const cur = placementRef.current;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = {
        kind: "pinch",
        startDist: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)),
        startFactor: cur.factor,
        startPx: cur.px,
        startPy: cur.py,
        midX: (a.x + b.x) / 2,
        midY: (a.y + b.y) / 2,
      };
      setSelection(null);
      return;
    }
    if (pointers.current.size > 2) return;
    if (event.shiftKey || pinMode) {
      gesture.current = { kind: "select", id: event.pointerId, startX: pt.x, startY: pt.y, x: pt.x, y: pt.y };
      setSelection({ x: pt.x, y: pt.y, w: 0, h: 0 });
      return;
    }
    gesture.current = { kind: "pan", id: event.pointerId, startX: pt.x, startY: pt.y, px: cur.px, py: cur.py, moved: false };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || !pointers.current.has(event.pointerId)) return;
    const pt = local(event);
    pointers.current.set(event.pointerId, pt);
    const cur = placementRef.current;
    if (g.kind === "pinch" && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.max(10, Math.hypot(a.x - b.x, a.y - b.y));
      const factor = clampNumber((g.startFactor * dist) / g.startDist, cur.minFactor, MAX_ZOOM);
      const startPlacement = { ...cur, factor: g.startFactor, px: g.startPx, py: g.startPy, dw: cur.bw * cur.fitW * g.startFactor, dh: cur.bh * cur.fitW * g.startFactor };
      const z = zoomAround(startPlacement, g.midX, g.midY, factor);
      const midX = (a.x + b.x) / 2;
      const midY = (a.y + b.y) / 2;
      // follow the fingers' midpoint as well
      const dw = cur.bw * cur.fitW * z.zoom;
      const dh = cur.bh * cur.fitW * z.zoom;
      setLive({ zoom: z.zoom, center: { x: z.center.x - (midX - g.midX) / dw, y: z.center.y - (midY - g.midY) / dh } });
      return;
    }
    if (g.kind === "select" && g.id === event.pointerId) {
      g.x = pt.x;
      g.y = pt.y;
      setSelection({ x: Math.min(g.startX, pt.x), y: Math.min(g.startY, pt.y), w: Math.abs(pt.x - g.startX), h: Math.abs(pt.y - g.startY) });
      return;
    }
    if (g.kind === "pan" && g.id === event.pointerId) {
      const dx = pt.x - g.startX;
      const dy = pt.y - g.startY;
      if (!g.moved && Math.hypot(dx, dy) < 3) return;
      g.moved = true;
      setLive({ zoom: cur.factor, center: centerFor(cur, cur.factor, g.px + dx, g.py + dy) });
    }
  };

  const finishGesture = (event: React.PointerEvent<HTMLDivElement>, cancelled = false) => {
    const g = gesture.current;
    pointers.current.delete(event.pointerId);
    viewportRef.current?.releasePointerCapture?.(event.pointerId);
    if (!g) return;
    const cur = placementRef.current;
    if (g.kind === "select") {
      gesture.current = null;
      setSelection(null);
      setPinMode(false);
      const w = Math.abs(g.x - g.startX);
      const h = Math.abs(g.y - g.startY);
      if (cancelled || w < 12 || h < 12) return;
      const x0 = clampNumber((Math.min(g.startX, g.x) - cur.px) / cur.dw, 0, 1);
      const y0 = clampNumber((Math.min(g.startY, g.y) - cur.py) / cur.dh, 0, 1);
      const x1 = clampNumber((Math.max(g.startX, g.x) - cur.px) / cur.dw, 0, 1);
      const y1 = clampNumber((Math.max(g.startY, g.y) - cur.py) / cur.dh, 0, 1);
      if (x1 - x0 < 0.01 || y1 - y0 < 0.01) return;
      onView({ pin: viewToRegion({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, rotation), pinFollow: true, center: null });
      return;
    }
    if (g.kind === "pinch") {
      if (pointers.current.size < 2) {
        gesture.current = null;
        if (live) commit(live.zoom, live.center);
        setLive(null);
        // a remaining finger continues as a pan
        const rest = [...pointers.current.entries()][0];
        if (rest) {
          const after = live ? place(base, live.zoom, live.center) : cur;
          gesture.current = { kind: "pan", id: rest[0], startX: rest[1].x, startY: rest[1].y, px: after.px, py: after.py, moved: true };
        }
      }
      return;
    }
    if (g.kind === "pan" && g.id === event.pointerId) {
      gesture.current = null;
      if (live) commit(live.zoom, live.center);
      setLive(null);
    }
  };

  const onDoubleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("[data-canvas-control]") || !page) return;
    const cur = placementRef.current;
    if (cur.factor > 1.05) {
      fitWidth();
      return;
    }
    const pt = local(event);
    const z = zoomAround(cur, pt.x, pt.y, Math.max(2, cur.factor * 2));
    commit(z.zoom, z.center);
  };

  // Non-passive wheel: Ctrl/⌘ + wheel (and trackpad pinch) zooms at the cursor;
  // a plain wheel pans the page and only scrolls the page around it at the edges.
  const wheelState = useRef({ onView: commit });
  wheelState.current = { onView: commit };
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      const cur = placementRef.current;
      const rect = el.getBoundingClientRect();
      const mx = event.clientX - rect.left - INSET;
      const my = event.clientY - rect.top - INSET;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1;
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const factor = cur.factor * Math.exp(-event.deltaY * unit * 0.0022);
        const z = zoomAround(cur, mx, my, factor);
        wheelState.current.onView(z.zoom, z.center);
        return;
      }
      const dx = event.shiftKey && !event.deltaX ? event.deltaY * unit : event.deltaX * unit;
      const dy = event.shiftKey && !event.deltaX ? 0 : event.deltaY * unit;
      const px = cur.dw <= cur.cw ? cur.px : clampNumber(cur.px - dx, cur.cw - cur.dw, 0);
      const py = cur.dh <= cur.ch ? cur.py : clampNumber(cur.py - dy, cur.ch - cur.dh, 0);
      if (Math.abs(px - cur.px) < 0.5 && Math.abs(py - cur.py) < 0.5) return;
      event.preventDefault();
      wheelState.current.onView(cur.factor, centerFor(cur, cur.factor, px, py));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [hasPages]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const cur = placementRef.current;
    const step = event.shiftKey ? 160 : 60;
    const pan = (dx: number, dy: number) => {
      const px = cur.dw <= cur.cw ? cur.px : clampNumber(cur.px + dx, cur.cw - cur.dw, 0);
      const py = cur.dh <= cur.ch ? cur.py : clampNumber(cur.py + dy, cur.ch - cur.dh, 0);
      if (Math.abs(px - cur.px) < 0.5 && Math.abs(py - cur.py) < 0.5) return false;
      commit(cur.factor, centerFor(cur, cur.factor, px, py));
      return true;
    };
    switch (event.key) {
      case "ArrowLeft":
        event.preventDefault();
        if (!pan(step, 0)) goTo(-1);
        break;
      case "ArrowRight":
        event.preventDefault();
        if (!pan(-step, 0)) goTo(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        pan(0, step);
        break;
      case "ArrowDown":
        event.preventDefault();
        pan(0, -step);
        break;
      case "PageUp":
        event.preventDefault();
        goTo(-1);
        break;
      case "PageDown":
        event.preventDefault();
        goTo(1);
        break;
      case "+":
      case "=":
        event.preventDefault();
        zoomStep(1);
        break;
      case "-":
      case "_":
        event.preventDefault();
        zoomStep(-1);
        break;
      case "0":
        event.preventDefault();
        fitWidth();
        break;
      case "Escape":
        if (pinMode) {
          event.preventDefault();
          setPinMode(false);
        }
        break;
    }
  };

  if (!count || !page) {
    return (
      <div className={cn("flex min-h-[200px] flex-1 items-center justify-center rounded-xl border border-dashed border-line p-6 text-center text-[13px] text-content-3", className)}>
        This document has no pages.
      </div>
    );
  }

  const zoomPercent = Math.round(p.factor * 100);
  const isFitWidth = !live && !pinActive && view.zoom === "fit-width";
  const isFitPage = !live && !pinActive && view.zoom === "fit-page";
  const pinRect = view.pin ? regionToView(view.pin, rotation) : null;
  const rotationDiffers = Boolean(page.page_kind) && rotation !== savedRotation;
  const sideways = rotation % 180 !== 0;
  const imgW = nat.w * p.scale;
  const imgH = nat.h * p.scale;

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)} data-testid="bill-canvas">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1 border-b border-line px-2 py-1.5 max-md:gap-0.5 max-md:px-1.5" role="toolbar" aria-label="Bill page controls">
        <ViewerButton label="Previous page" onClick={() => goTo(-1)} disabled={index === 0} testId="bill-prev-page">
          <ChevronLeft className="h-4 w-4" />
        </ViewerButton>
        <span className="min-w-[44px] text-center text-[12px] font-semibold tabular-nums text-content-2" aria-live="polite" data-testid="bill-page-indicator">
          {index + 1} / {count}
        </span>
        <ViewerButton label="Next page" onClick={() => goTo(1)} disabled={index >= count - 1} testId="bill-next-page">
          <ChevronRight className="h-4 w-4" />
        </ViewerButton>
        <span className="mx-0.5 h-5 w-px bg-line" aria-hidden />
        <ViewerButton label="Zoom out" onClick={() => zoomStep(-1)} disabled={p.factor <= p.minFactor + 0.001} className="max-md:hidden">
          <ZoomOut className="h-4 w-4" />
        </ViewerButton>
        <span
          className="min-w-[42px] text-center text-[12px] font-semibold tabular-nums text-content-2 max-md:min-w-[36px] max-md:text-[11px]"
          aria-live="polite"
          data-testid="bill-zoom-level"
        >
          {zoomPercent}%
        </span>
        <ViewerButton label="Zoom in" onClick={() => zoomStep(1)} disabled={p.factor >= MAX_ZOOM - 0.001} className="max-md:hidden">
          <ZoomIn className="h-4 w-4" />
        </ViewerButton>
        <ViewerButton label="Fit width" onClick={fitWidth} active={isFitWidth}>
          <MoveHorizontal className="h-4 w-4" />
        </ViewerButton>
        <ViewerButton label="Fit page" onClick={fitPage} active={isFitPage}>
          <Maximize className="h-4 w-4" />
        </ViewerButton>
        <span className="mx-0.5 h-5 w-px bg-line max-md:hidden" aria-hidden />
        <ViewerButton label="Rotate view 90°" onClick={rotate} testId="bill-rotate">
          <RotateCw className="h-4 w-4" />
        </ViewerButton>
        <ViewerButton label={pinMode ? "Cancel pinning" : "Pin an area: drag a box around it"} onClick={() => setPinMode((v) => !v)} active={pinMode}>
          <Crosshair className="h-4 w-4" />
        </ViewerButton>
        <ViewerButton label="Download original page" onClick={() => void download()} disabled={downloading} className="max-md:hidden">
          {downloading ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Download className="h-4 w-4" />}
        </ViewerButton>
        <ShortcutsPopover includeToggle={shortcutsIncludeToggle} />
        {toolbarEnd ? <div className="ml-auto flex items-center gap-1">{toolbarEnd}</div> : null}
      </div>

      {rotationDiffers ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-info-bg px-3 py-1.5 text-[12px] text-info-fg" role="status">
          <span>Rotated for you only.</span>
          <button
            type="button"
            onClick={() => void saveRotation()}
            disabled={savingRotation}
            data-testid="bill-save-rotation"
            className="inline-flex min-h-[28px] items-center gap-1 rounded-md border border-info-border bg-surface-1 px-2 font-semibold text-content-1 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border disabled:opacity-60 [@media(pointer:coarse)]:min-h-[44px]"
          >
            {savingRotation ? <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> : null}
            Save rotation for everyone
          </button>
        </div>
      ) : null}

      {/* Viewport */}
      <div
        ref={viewportRef}
        role="region"
        aria-roledescription="zoomable image"
        aria-label={`${label}, page ${index + 1} of ${count}. Arrow keys move the page, plus and minus zoom.`}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => finishGesture(e)}
        onPointerCancel={(e) => finishGesture(e, true)}
        onDoubleClick={onDoubleClick}
        onKeyDown={onKeyDown}
        data-testid="bill-viewport"
        className={cn(
          "relative min-h-[160px] flex-1 select-none overflow-hidden bg-[repeating-conic-gradient(var(--surface-2)_0%_25%,var(--surface-1)_0%_50%)] [background-size:16px_16px] [touch-action:none] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-info-border",
          pinMode ? "cursor-crosshair" : p.dw > p.cw + 1 || p.dh > p.ch + 1 ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in",
        )}
      >
        {size.width > 0 ? (
          <div
            className="absolute left-0 top-0 will-change-transform"
            style={{ width: p.dw, height: p.dh, transform: `translate3d(${INSET + p.px}px, ${INSET + p.py}px, 0)` }}
          >
            <div className="absolute inset-0 rounded-[2px] bg-surface-1 shadow-[0_1px_6px_rgba(15,23,42,0.18)]" aria-hidden />
            {full.url || thumb.url ? (
              <img
                src={full.url ?? thumb.url ?? undefined}
                alt={`${label} page ${index + 1}`}
                draggable={false}
                onLoad={(event) => {
                  if (!full.url || !page) return;
                  const img = event.currentTarget;
                  if (img.naturalWidth && img.naturalHeight && (!page.width || !page.height)) {
                    setNatural((prev) => ({ ...prev, [page.id]: { w: img.naturalWidth, h: img.naturalHeight } }));
                  }
                }}
                className={cn("pointer-events-none absolute left-1/2 top-1/2 max-w-none select-none", !full.url && "blur-[1px]")}
                style={{ width: imgW, height: imgH, transform: `translate(-50%, -50%) rotate(${rotation}deg)` }}
              />
            ) : null}
            {pinRect ? (
              <div
                className="pointer-events-none absolute rounded-sm border-2 border-dashed border-primary/70"
                style={{ left: pinRect.x * p.dw, top: pinRect.y * p.dh, width: pinRect.w * p.dw, height: pinRect.h * p.dh }}
                aria-hidden
              />
            ) : null}
          </div>
        ) : null}

        {full.status === "loading" ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface-1 px-3 py-1.5 text-[12px] font-semibold text-content-2 shadow-sm">
              <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> Loading page {index + 1}…
            </span>
          </div>
        ) : null}
        {full.status === "error" ? (
          <div className="absolute inset-0 flex items-center justify-center p-4" data-canvas-control role="alert">
            <div className="max-w-[280px] rounded-xl border border-danger-border bg-surface-1 p-3 text-center text-[13px] text-danger-fg shadow-sm">
              Could not load page {index + 1}. Check the connection and try again.
              <button
                type="button"
                onClick={() => setRetry((n) => n + 1)}
                className="mx-auto mt-2 flex min-h-[36px] items-center rounded-lg border border-line bg-surface-1 px-3 font-semibold text-content-1 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border [@media(pointer:coarse)]:min-h-[44px]"
              >
                Retry
              </button>
            </div>
          </div>
        ) : null}

        {selection ? (
          <div
            className="pointer-events-none absolute border-2 border-primary bg-[color-mix(in_srgb,var(--info-bg)_45%,transparent)]"
            style={{ left: INSET + selection.x, top: INSET + selection.y, width: selection.w, height: selection.h }}
            aria-hidden
          />
        ) : null}

        {pinMode && !selection ? (
          <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center">
            <span className="rounded-full bg-content-1 px-3 py-1 text-[12px] font-semibold text-surface-1">Drag a box around the part to keep in view</span>
          </div>
        ) : null}

        {view.pin ? (
          <div className="absolute left-2 top-2 flex items-center gap-1" data-canvas-control>
            <span className="rounded-full border border-info-border bg-surface-1 px-2.5 py-1 text-[11.5px] font-semibold text-info-fg shadow-sm">Pinned area</span>
            {!pinActive ? (
              <button
                type="button"
                onClick={() => onView({ pinFollow: true, center: null })}
                className="inline-flex min-h-[28px] items-center gap-1 rounded-full border border-line bg-surface-1 px-2.5 text-[11.5px] font-semibold text-content-1 shadow-sm hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border [@media(pointer:coarse)]:min-h-[44px]"
              >
                <ScanSearch className="h-3.5 w-3.5" aria-hidden /> Back to pin
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => onView({ pin: null, pinFollow: false, center: null })}
              data-testid="bill-clear-pin"
              className="inline-flex min-h-[28px] items-center gap-1 rounded-full border border-line bg-surface-1 px-2.5 text-[11.5px] font-semibold text-content-1 shadow-sm hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border [@media(pointer:coarse)]:min-h-[44px]"
            >
              <PinOff className="h-3.5 w-3.5" aria-hidden /> Clear pin
            </button>
          </div>
        ) : null}
        <span className="sr-only">{sideways ? `Rotated ${rotation} degrees.` : ""}</span>
      </div>

      {/* Page strip */}
      {showStrip && count > 1 ? (
        <div className="flex items-center gap-1.5 overflow-x-auto border-t border-line px-2 py-1.5" role="tablist" aria-label="Pages">
          {pages.map((pg, i) => (
            <Thumb
              key={pg.id}
              cache={cache}
              page={pg}
              index={i}
              active={i === index}
              rotation={viewRotation(view, pg)}
              onSelect={() => onView({ page: i, center: null, pinFollow: Boolean(view.pin) })}
            />
          ))}
        </div>
      ) : null}
      {showHints ? (
        <div className="hidden border-t border-line px-3 py-1 text-[11px] text-content-4 md:block">
          Drag to move · Ctrl/⌘ + scroll to zoom · double-click to zoom in · Shift-drag to pin an area
        </div>
      ) : null}
    </div>
  );
});

/* ------------------------------------------------------------------ */
/* Keyboard shortcuts                                                  */
/* ------------------------------------------------------------------ */

/**
 * Alt shortcuts for the bill: Alt+B toggle, Alt+←/→ page, Alt+= / Alt+− zoom,
 * Alt+0 fit width, Alt+R rotate. Uses `event.code` so macOS Option characters
 * (∫, ®) are never typed into the form, and ignores AltGr (Ctrl+Alt).
 */
export function useBillShortcuts(
  enabled: boolean,
  actions: { toggle?: () => void; page: (delta: number) => void; zoom: (direction: 1 | -1) => void; fitWidth: () => void; rotate: () => void },
) {
  const ref = useRef(actions);
  ref.current = actions;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      // Every shortcut needs Alt, so it also works while typing in a form field;
      // plain keys are never captured. Ctrl+Alt (AltGr) is left to the keyboard layout.
      if (!event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented) return;
      const a = ref.current;
      let handled = true;
      switch (event.code) {
        case "KeyB":
          if (a.toggle) a.toggle();
          else handled = false;
          break;
        case "ArrowLeft":
          a.page(-1);
          break;
        case "ArrowRight":
          a.page(1);
          break;
        case "Equal":
        case "NumpadAdd":
          a.zoom(1);
          break;
        case "Minus":
        case "NumpadSubtract":
          a.zoom(-1);
          break;
        case "Digit0":
        case "Numpad0":
          a.fitWidth();
          break;
        case "KeyR":
          a.rotate();
          break;
        default:
          handled = false;
      }
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [enabled]);
}

/** Zoom / page / rotate on the stored state when no canvas is mounted (hidden or pop-out). */
export function stateActions(pages: BillPage[], update: (patch: BillViewPatch) => void) {
  return {
    page: (delta: number) =>
      update((v) => {
        const next = clampNumber(v.page + delta, 0, Math.max(0, pages.length - 1));
        return next === v.page ? {} : { page: next, center: null, pinFollow: Boolean(v.pin) };
      }),
    zoom: (direction: 1 | -1) =>
      update((v) => ({ zoom: nextZoomStep(typeof v.zoom === "number" ? v.zoom : 1, direction), pinFollow: false })),
    fitWidth: () => update({ zoom: "fit-width", center: null, pinFollow: false }),
    rotate: () =>
      update((v) => {
        const page = pages[clampNumber(v.page, 0, Math.max(0, pages.length - 1))];
        if (!page) return {};
        return { rotations: { ...v.rotations, [page.id]: (((viewRotation(v, page) + 90) % 360) as ViewRotation) }, center: null };
      }),
  };
}

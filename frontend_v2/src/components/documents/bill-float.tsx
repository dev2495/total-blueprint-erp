"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FileImage, GripHorizontal, Minimize2, RotateCcw } from "lucide-react";

import { cn } from "@/lib/utils";

import { FLOAT_STORAGE_KEY, readLocalJson, writeLocalJson } from "./use-bill-view-state";

export interface FloatGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
  minimised: boolean;
}

const MIN_W = 300;
const MIN_H = 260;
const EDGE = 8;

function viewport() {
  if (typeof window === "undefined") return { w: 1366, h: 768 };
  return { w: window.innerWidth, h: window.innerHeight };
}

export function defaultFloatGeometry(): FloatGeometry {
  const { w: vw, h: vh } = viewport();
  // Tablets get half the screen; laptops ~42 % (the form keeps the rest).
  const w = Math.round(Math.min(600, Math.max(MIN_W + 40, vw * (vw < 1024 ? 0.5 : 0.42))));
  const h = Math.round(Math.min(vh - 120, Math.max(MIN_H, vh * 0.78)));
  return { x: Math.max(EDGE, vw - w - 24), y: Math.max(EDGE, Math.min(96, vh - h - EDGE)), w, h, minimised: false };
}

/** Keep the window on screen (title bar always reachable) and within size limits. */
export function clampFloat(geo: FloatGeometry): FloatGeometry {
  const { w: vw, h: vh } = viewport();
  const w = Math.round(Math.max(Math.min(MIN_W, vw - EDGE * 2), Math.min(geo.w, vw - EDGE * 2)));
  const h = Math.round(Math.max(Math.min(MIN_H, vh - EDGE * 2), Math.min(geo.h, vh - EDGE * 2)));
  const x = Math.round(Math.max(EDGE, Math.min(geo.x, vw - w - EDGE)));
  const y = Math.round(Math.max(EDGE, Math.min(geo.y, vh - h - EDGE)));
  return { x, y, w, h, minimised: geo.minimised };
}

function validGeometry(raw: unknown): FloatGeometry | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (![r.x, r.y, r.w, r.h].every((v) => typeof v === "number" && Number.isFinite(v))) return null;
  return { x: r.x as number, y: r.y as number, w: r.w as number, h: r.h as number, minimised: r.minimised === true };
}

export function usePortalTarget() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useEffect(() => setTarget(document.body), []);
  return target;
}

type Drag = { kind: "move" | "resize"; id: number; sx: number; sy: number; start: FloatGeometry };

/**
 * Non-modal, draggable and resizable picture-in-picture window for the bill.
 * Rendered in a portal on <body>, outside the form, so opening dropdowns or date
 * pickers in the form never closes or re-mounts it. Geometry is remembered in
 * localStorage (layout only) and clamped into the viewport on resize.
 */
export function BillFloat({
  title,
  status,
  meta,
  actions,
  children,
  onMinimisedChange,
}: {
  title: ReactNode;
  status?: ReactNode;
  /** Secondary actions shown on the second title-bar line (e.g. "Open bill"). */
  meta?: ReactNode;
  /** Mode buttons / header actions rendered in the title bar. */
  actions?: ReactNode;
  children: ReactNode;
  onMinimisedChange?: (minimised: boolean) => void;
}) {
  const target = usePortalTarget();
  const [geo, setGeo] = useState<FloatGeometry>(() => clampFloat(readLocalJson(FLOAT_STORAGE_KEY, defaultFloatGeometry(), validGeometry)));
  const drag = useRef<Drag | null>(null);
  const geoRef = useRef(geo);
  geoRef.current = geo;
  const [dragging, setDragging] = useState(false);

  const commit = useCallback((next: FloatGeometry) => {
    const clamped = clampFloat(next);
    setGeo(clamped);
    writeLocalJson(FLOAT_STORAGE_KEY, clamped);
  }, []);

  useEffect(() => {
    const onResize = () => setGeo((g) => clampFloat(g));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    onMinimisedChange?.(geo.minimised);
  }, [geo.minimised, onMinimisedChange]);

  const start = (kind: Drag["kind"]) => (event: React.PointerEvent<HTMLElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (kind === "move" && (event.target as HTMLElement).closest("button,a,input,select,[data-no-drag]")) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    drag.current = { kind, id: event.pointerId, sx: event.clientX, sy: event.clientY, start: geo };
    setDragging(true);
  };
  const move = (event: React.PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    const dx = event.clientX - d.sx;
    const dy = event.clientY - d.sy;
    setGeo(
      clampFloat(
        d.kind === "move"
          ? { ...d.start, x: d.start.x + dx, y: d.start.y + dy }
          : { ...d.start, w: Math.max(MIN_W, d.start.w + dx), h: Math.max(MIN_H, d.start.h + dy) },
      ),
    );
  };
  const end = (event: React.PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    writeLocalJson(FLOAT_STORAGE_KEY, geoRef.current);
  };

  // Keyboard: arrows move, Shift+arrows resize (when the title bar is focused).
  const onHandleKey = (event: React.KeyboardEvent<HTMLElement>) => {
    const step = 24;
    const map: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const delta = map[event.key];
    if (!delta || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    commit(event.shiftKey ? { ...geo, w: geo.w + delta[0], h: geo.h + delta[1] } : { ...geo, x: geo.x + delta[0], y: geo.y + delta[1] });
  };

  if (!target) return null;

  if (geo.minimised) {
    return createPortal(
      <button
        type="button"
        onClick={() => commit({ ...geo, minimised: false })}
        aria-label="Show the floating bill"
        data-testid="bill-float-chip"
        className="fixed right-3 top-1/2 z-[45] -translate-y-1/2 inline-flex min-h-[44px] items-center gap-2 rounded-full border border-info-border bg-surface-1 px-4 text-[13px] font-semibold text-content-1 shadow-lg hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border"
      >
        <FileImage className="h-4 w-4 text-info-fg" aria-hidden /> Bill ▸
      </button>,
      target,
    );
  }

  return createPortal(
    <section
      role="dialog"
      aria-modal="false"
      aria-label="Floating bill viewer"
      data-testid="bill-float"
      className={cn(
        "fixed z-[45] flex flex-col overflow-hidden rounded-2xl border border-line bg-surface-1 shadow-[0_24px_60px_-20px_rgba(15,23,42,0.45)]",
        dragging && "select-none",
      )}
      style={{ left: geo.x, top: geo.y, width: geo.w, height: geo.h }}
    >
      <header
        className="cursor-move touch-none border-b border-line bg-surface-2 px-2 py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-info-border"
        onPointerDown={start("move")}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        tabIndex={0}
        onKeyDown={onHandleKey}
        aria-label="Move the bill window: arrow keys move it, Shift + arrow keys resize it"
      >
        <div className="flex items-center gap-2">
          <GripHorizontal className="h-4 w-4 shrink-0 text-content-4" aria-hidden />
          <div className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-content-1" title={typeof title === "string" ? title : undefined}>
            {title}
          </div>
          <div className="flex shrink-0 items-center gap-1" data-no-drag>
            <button
              type="button"
              onClick={() => commit({ ...defaultFloatGeometry() })}
              aria-label="Reset the bill window position and size"
              title="Reset position and size"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-surface-1 text-content-2 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => commit({ ...geo, minimised: true })}
              aria-label="Minimise the bill window"
              title="Minimise"
              data-testid="bill-float-minimise"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-surface-1 text-content-2 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
            >
              <Minimize2 className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="mt-1 flex min-w-0 items-center gap-1.5 pl-6">
          {status}
          {meta}
          <span className="min-w-0 flex-1" />
          {actions ? (
            <div className="flex shrink-0 items-center" data-no-drag>
              {actions}
            </div>
          ) : null}
        </div>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      <div
        role="presentation"
        onPointerDown={start("resize")}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        title="Drag to resize"
        className="absolute bottom-0 right-0 h-5 w-5 cursor-nwse-resize touch-none [@media(pointer:coarse)]:h-8 [@media(pointer:coarse)]:w-8"
      >
        <svg viewBox="0 0 10 10" className="absolute bottom-1 right-1 h-2.5 w-2.5 text-content-4" aria-hidden>
          <path d="M9 1 1 9M9 5 5 9" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" />
        </svg>
      </div>
    </section>,
    target,
  );
}

"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronUp, FileImage, Maximize2, Minimize2 } from "lucide-react";

import { cn } from "@/lib/utils";

import { usePortalTarget } from "./bill-float";
import type { BillSheetSnap } from "./use-bill-view-state";

/** Height of the collapsed sheet (bill reference + "View"). */
export const SHEET_PEEK = 72;
const TOP_GAP = 48;

function isEditable(el: Element | null) {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
  if (el.tagName !== "INPUT") return false;
  return !["button", "checkbox", "radio", "submit", "reset", "range", "color", "file"].includes((el as HTMLInputElement).type);
}

/** Visual viewport height and whether the on-screen keyboard is open. */
function useVisualViewport() {
  const [state, setState] = useState(() => ({ height: typeof window === "undefined" ? 800 : window.innerHeight, keyboard: false }));
  useEffect(() => {
    const vv = window.visualViewport;
    const read = () => {
      const visible = vv ? vv.height * (vv.scale || 1) : window.innerHeight;
      const keyboard = Boolean(vv) && window.innerHeight - visible > 120 && isEditable(document.activeElement);
      const height = keyboard ? window.innerHeight : vv ? Math.min(window.innerHeight, visible) : window.innerHeight;
      setState((prev) => (prev.height === Math.round(height) && prev.keyboard === keyboard ? prev : { height: Math.round(height), keyboard }));
    };
    read();
    vv?.addEventListener("resize", read);
    window.addEventListener("resize", read);
    document.addEventListener("focusin", read);
    document.addEventListener("focusout", read);
    return () => {
      vv?.removeEventListener("resize", read);
      window.removeEventListener("resize", read);
      document.removeEventListener("focusin", read);
      document.removeEventListener("focusout", read);
    };
  }, []);
  return state;
}

/**
 * Phone bottom sheet with peek / half / full snaps. Pinch-zoom and pan happen in
 * the canvas inside. While the on-screen keyboard is open the sheet drops to
 * peek (so the field being typed stays visible) and returns afterwards.
 */
export function BillSheet({
  snap,
  onSnap,
  title,
  status,
  actions,
  children,
}: {
  snap: BillSheetSnap;
  onSnap: (snap: BillSheetSnap) => void;
  title: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const target = usePortalTarget();
  const { height: vh, keyboard } = useVisualViewport();
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const drag = useRef<{ id: number; sy: number; start: number; lastY: number; lastT: number; v: number; moved: boolean } | null>(null);
  const autoDropped = useRef<BillSheetSnap | null>(null);
  const snapRef = useRef(snap);
  snapRef.current = snap;

  const heights: Record<BillSheetSnap, number> = {
    peek: SHEET_PEEK,
    half: Math.round(Math.max(SHEET_PEEK + 160, vh * 0.5)),
    full: Math.round(Math.max(SHEET_PEEK + 200, vh - TOP_GAP)),
  };

  // Keyboard open → peek; keyboard closed → restore what the user had.
  useEffect(() => {
    if (keyboard) {
      if (snapRef.current !== "peek") {
        autoDropped.current = snapRef.current;
        onSnap("peek");
      }
    } else if (autoDropped.current) {
      const restore = autoDropped.current;
      autoDropped.current = null;
      onSnap(restore);
    }
  }, [keyboard, onSnap]);

  const choose = (next: BillSheetSnap) => {
    autoDropped.current = null;
    onSnap(next);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button,a")) return;
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    const now = performance.now();
    drag.current = { id: event.pointerId, sy: event.clientY, start: heights[snap], lastY: event.clientY, lastT: now, v: 0, moved: false };
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    const now = performance.now();
    const dy = event.clientY - d.sy;
    if (!d.moved && Math.abs(dy) < 4) return;
    d.moved = true;
    d.v = (event.clientY - d.lastY) / Math.max(1, now - d.lastT);
    d.lastY = event.clientY;
    d.lastT = now;
    setDragHeight(Math.max(SHEET_PEEK, Math.min(heights.full, d.start - dy)));
  };
  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    drag.current = null;
    const current = dragHeight;
    setDragHeight(null);
    if (!d.moved || current === null) {
      choose(snap === "peek" ? "half" : "peek");
      return;
    }
    // Snap to the point nearest to where the gesture was heading (a flick carries on).
    const velocity = Math.max(-3, Math.min(3, d.v));
    const projected = current - velocity * 220;
    const order: BillSheetSnap[] = ["peek", "half", "full"];
    let best: BillSheetSnap = "peek";
    for (const s of order) if (Math.abs(heights[s] - projected) < Math.abs(heights[best] - projected)) best = s;
    choose(best);
  };

  if (!target) return null;
  const height = dragHeight ?? heights[snap];
  const showBody = (dragHeight ?? heights[snap]) > SHEET_PEEK + 40;

  return createPortal(
    <section
      aria-label="Bill viewer"
      data-testid="bill-sheet"
      data-snap={snap}
      className={cn(
        "fixed inset-x-0 bottom-0 z-[45] flex flex-col overflow-hidden rounded-t-2xl border-t border-line bg-surface-1 shadow-[0_-16px_40px_-12px_rgba(15,23,42,0.35)]",
        dragHeight === null && "transition-[height] duration-200 ease-out motion-reduce:transition-none",
      )}
      style={{ height, paddingBottom: snap === "peek" ? "env(safe-area-inset-bottom)" : undefined }}
    >
      <div
        className="relative flex shrink-0 touch-none items-center gap-2 px-3 pb-2 pt-3"
        style={{ minHeight: SHEET_PEEK }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <span className="absolute left-1/2 top-1.5 h-1 w-10 -translate-x-1/2 rounded-full bg-line-strong" aria-hidden />
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-info-bg text-info-fg">
          <FileImage className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold text-content-1">{title}</div>
          {status || (actions && snap !== "peek") ? (
            <div className="mt-0.5 flex min-w-0 items-center gap-1">
              {status}
              {actions && snap !== "peek" ? <div className="ml-auto flex shrink-0 items-center">{actions}</div> : null}
            </div>
          ) : null}
        </div>
        {snap === "full" ? (
          <button
            type="button"
            onClick={() => choose("half")}
            aria-label="Make the bill smaller"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line bg-surface-1 text-content-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border"
          >
            <Minimize2 className="h-4 w-4" />
          </button>
        ) : snap === "half" ? (
          <button
            type="button"
            onClick={() => choose("full")}
            aria-label="Show the bill full screen"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-line bg-surface-1 text-content-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => choose(snap === "peek" ? "half" : "peek")}
          aria-expanded={snap !== "peek"}
          data-testid="bill-sheet-toggle"
          className="inline-flex h-11 shrink-0 items-center gap-1 rounded-xl border border-info-border bg-info-bg px-3 text-[13px] font-semibold text-info-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border"
        >
          {snap === "peek" ? (
            <>
              View <ChevronUp className="h-4 w-4" aria-hidden />
            </>
          ) : (
            <>
              Hide <ChevronDown className="h-4 w-4" aria-hidden />
            </>
          )}
        </button>
      </div>
      {showBody ? <div className="flex min-h-0 flex-1 flex-col border-t border-line">{children}</div> : null}
    </section>,
    target,
  );
}

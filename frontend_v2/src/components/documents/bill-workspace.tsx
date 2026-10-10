"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ExternalLink, FileImage, PanelRight, PanelRightClose, PictureInPicture2 } from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";

import { BillCanvas, clampNumber, stateActions, useBillImageCache, useBillShortcuts, type BillCanvasHandle } from "./bill-canvas";
import { BillFloat, usePortalTarget } from "./bill-float";
import { BillSheet, SHEET_PEEK } from "./bill-sheet";
import { WorkspaceStatusChip, type WorkspaceDocument } from "./bill-workspace-shared";
import {
  DEFAULT_SPLIT,
  SPLIT_STORAGE_KEY,
  readLocalJson,
  useBillViewState,
  useBillViewSync,
  useDeviceClass,
  writeLocalJson,
  type BillSheetSnap,
  type BillWorkspaceMode,
} from "./use-bill-view-state";

/* ------------------------------------------------------------------ */
/* Contract (docs/documents-jobwork/SPEC.md §3.1)                      */
/* ------------------------------------------------------------------ */

export type { WorkspaceDocument, WorkspaceTone } from "./bill-workspace-shared";
export { WorkspaceStatusChip } from "./bill-workspace-shared";
export { BillPopoutView } from "./bill-popout";

export interface BillWorkspaceProps {
  document: WorkspaceDocument | null;
  headerActions?: ReactNode;
  defaultMode?: "dock" | "float" | "hidden";
  /** The form. When `document` is null it renders unchanged, full width. */
  children: ReactNode;
}

export type BillWorkspaceEffectiveMode = "dock" | "float" | "hidden" | "popout" | "sheet";

export interface BillWorkspaceLayout {
  /** A document is shown next to / over the form. */
  active: boolean;
  mode: BillWorkspaceEffectiveMode | null;
  /**
   * The form sits in its own scroll pane (dock split). Fixed footers inside the
   * form should become `sticky bottom-0` so they stay inside the form pane and
   * never cover the bill.
   */
  paneScroll: boolean;
  /** Pixels a bottom-fixed footer must leave free for the phone bill sheet. */
  sheetOffset: number;
}

const LayoutContext = createContext<BillWorkspaceLayout>({ active: false, mode: null, paneScroll: false, sheetOffset: 0 });

/** Layout facts for forms rendered inside `<BillWorkspace>`. */
export function useBillWorkspaceLayout() {
  return useContext(LayoutContext);
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const FORM_MIN = 520;
const BILL_MIN = 360;
const DIVIDER = 12;
const BOTTOM_GAP = 12;

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function validRatio(raw: unknown) {
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0.2 && raw < 0.85 ? raw : null;
}

/** Document Y of an element's layout box (ignores transforms such as page-enter animations). */
function documentTop(el: HTMLElement) {
  let top = 0;
  let node: HTMLElement | null = el;
  while (node) {
    top += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  return top;
}

function ModeButton({ label, active, onClick, children, testId }: { label: string; active?: boolean; onClick: () => void; children: ReactNode; testId: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        "inline-flex h-7 w-8 items-center justify-center rounded-md text-content-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border motion-reduce:transition-none [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11",
        active ? "bg-surface-1 text-info-fg shadow-sm ring-1 ring-info-border" : "hover:bg-surface-1",
      )}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Workspace                                                           */
/* ------------------------------------------------------------------ */

/**
 * Keeps a bill (or any document) beside the form it is being typed into.
 *
 * - Desktop (≥1024 px, room for form ≥520 px + bill ≥360 px): dock split — form
 *   left, bill right, both filling the viewport below the app header and
 *   scrolling on their own; draggable, keyboard-accessible divider.
 * - Float: non-modal draggable / resizable picture-in-picture (default 768–1023 px).
 * - Pop-out: a bare viewer window kept in sync through BroadcastChannel.
 * - Hidden: slim rail with "Show bill (Alt+B)".
 * - Phone (<768 px): bottom sheet with peek / half / full.
 *
 * The form (`children`) stays mounted in one stable element whatever the mode,
 * so switching layouts never resets typed data.
 */
export function BillWorkspace({ document: doc, headerActions, defaultMode, children }: BillWorkspaceProps) {
  const device = useDeviceClass();
  const docId = doc?.id ?? "";
  const pages = useMemo(() => doc?.pages ?? [], [doc?.pages]);
  const { view, update } = useBillViewState(docId);
  const cache = useBillImageCache();
  const portalTarget = usePortalTarget();
  const paneId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<BillCanvasHandle>(null);
  const popupRef = useRef<Window | null>(null);
  const paneScrollTop = useRef(0);
  const [rootWidth, setRootWidth] = useState(0);
  const [paneHeight, setPaneHeight] = useState<number | null>(null);
  const [ratio, setRatio] = useState(() => readLocalJson(SPLIT_STORAGE_KEY, DEFAULT_SPLIT, validRatio));
  const [resizing, setResizing] = useState(false);

  /* ---------------- mode ---------------- */

  const canDock = device === "desktop" && (rootWidth === 0 || rootWidth >= FORM_MIN + BILL_MIN + DIVIDER);
  const preferred: BillWorkspaceMode = view.mode ?? defaultMode ?? (device === "desktop" ? "dock" : "float");
  let mode: BillWorkspaceEffectiveMode | null = null;
  if (doc) {
    if (device === "phone") mode = "sheet";
    else if (preferred === "dock") mode = canDock ? "dock" : "float";
    else if (preferred === "popout" && !doc.popoutHref) mode = "float";
    else mode = preferred;
  }
  const visibleMode: "dock" | "float" | null = mode === "dock" || mode === "float" ? mode : null;

  const setMode = useCallback(
    (next: BillWorkspaceMode) =>
      update((v) => ({
        mode: next,
        lastVisibleMode: next === "dock" || next === "float" ? next : visibleMode ?? v.lastVisibleMode,
      })),
    [update, visibleMode],
  );

  const sync = useBillViewSync(docId, "workspace", view, update, { enabled: Boolean(doc) });

  const restoreFromPopout = useCallback(() => {
    popupRef.current = null;
    update((v) => (v.mode === "popout" ? { mode: v.lastVisibleMode } : {}));
  }, [update]);

  const openPopout = useCallback(() => {
    if (!doc?.popoutHref) return;
    const width = Math.round(Math.min(1100, Math.max(640, window.screen.availWidth / 2)));
    const height = Math.round(Math.max(600, window.screen.availHeight - 80));
    const popup = window.open(doc.popoutHref, `bill-view-${doc.id}`, `popup=yes,width=${width},height=${height}`);
    if (!popup) {
      toast.error("The browser blocked the bill window. Allow pop-ups for this site, or use Float instead.");
      return;
    }
    popupRef.current = popup;
    popup.focus?.();
    setMode("popout");
  }, [doc?.id, doc?.popoutHref, setMode]);

  const bringBack = useCallback(() => {
    sync.requestBringBack();
    try {
      popupRef.current?.close();
    } catch {
      // window already gone
    }
    restoreFromPopout();
  }, [restoreFromPopout, sync]);

  // Leave pop-out mode when the bill window closes (bye message / closed handle / never opened).
  const hadPeer = useRef(false);
  useEffect(() => {
    if (mode !== "popout") {
      hadPeer.current = false;
      return;
    }
    if (sync.peerOpen) {
      hadPeer.current = true;
    }
    const poll = window.setInterval(() => {
      if (popupRef.current?.closed) restoreFromPopout();
    }, 700);
    // A window we just opened gets time to load; otherwise (closed, or this tab was
    // reloaded and no pop-out answered) the bill comes back quickly.
    const grace = popupRef.current && !hadPeer.current ? 15000 : 2500;
    const timer = sync.peerOpen ? undefined : window.setTimeout(restoreFromPopout, grace);
    return () => {
      window.clearInterval(poll);
      if (timer) window.clearTimeout(timer);
    };
  }, [mode, sync.peerOpen, restoreFromPopout]);

  const toggle = useCallback(() => {
    if (!doc) return;
    if (mode === "sheet") update((v) => ({ sheet: v.sheet === "peek" ? "half" : "peek" }));
    else if (mode === "popout") bringBack();
    else if (mode === "hidden") update((v) => ({ mode: v.lastVisibleMode }));
    else if (visibleMode) update({ mode: "hidden", lastVisibleMode: visibleMode });
  }, [bringBack, doc, mode, update, visibleMode]);

  const fallback = useMemo(() => stateActions(pages, update), [pages, update]);
  useBillShortcuts(Boolean(doc), {
    toggle,
    page: (d) => (canvasRef.current ? canvasRef.current.goTo(d) : fallback.page(d)),
    zoom: (d) => (canvasRef.current ? canvasRef.current.zoomStep(d) : fallback.zoom(d)),
    fitWidth: () => (canvasRef.current ? canvasRef.current.fitWidth() : fallback.fitWidth()),
    rotate: () => (canvasRef.current ? canvasRef.current.rotate() : fallback.rotate()),
  });

  /* ---------------- dock geometry ---------------- */

  useIsoLayoutEffect(() => {
    const el = rootRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    setRootWidth(el.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setRootWidth((prev) => (Math.abs(prev - width) < 1 ? prev : width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const docked = mode === "dock";
  useIsoLayoutEffect(() => {
    if (!docked) return;
    const html = document.documentElement;
    const previousOverflow = html.style.overflow;
    const pageScroll = window.scrollY;
    // The page itself never scrolls in dock mode; each pane scrolls on its own.
    html.style.overflow = "hidden";
    window.scrollTo(0, 0);
    const pane = paneRef.current;
    if (pane && pageScroll > 0) {
      pane.scrollTop = pageScroll;
      paneScrollTop.current = pane.scrollTop;
    }
    const measure = () => {
      const root = rootRef.current;
      if (!root) return;
      const height = Math.max(360, Math.floor(window.innerHeight - documentTop(root) - BOTTOM_GAP));
      setPaneHeight((prev) => (prev === height ? prev : height));
    };
    // Focus / scrollIntoView inside the form may try to scroll the (locked) page too.
    const keepPageTop = () => {
      if (window.scrollY !== 0 || window.scrollX !== 0) window.scrollTo(0, 0);
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", keepPageTop, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(document.body);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", keepPageTop);
      html.style.overflow = previousOverflow;
      setPaneHeight(null);
      // Keep the same part of the form in view in the page-scrolling layouts.
      const top = paneScrollTop.current;
      requestAnimationFrame(() => {
        if (rootRef.current?.isConnected) window.scrollTo(0, top);
      });
    };
  }, [docked]);

  const avail = Math.max(0, rootWidth - DIVIDER);
  const minRatio = avail ? FORM_MIN / avail : 0.4;
  const maxRatio = avail ? Math.max(minRatio, (avail - BILL_MIN) / avail) : 0.7;
  const effectiveRatio = clampNumber(ratio, minRatio, maxRatio);
  const formWidth = Math.round(effectiveRatio * avail);

  const setRatioClamped = useCallback(
    (next: number, persist: boolean) => {
      const value = clampNumber(next, minRatio, maxRatio);
      setRatio(value);
      if (persist) writeLocalJson(SPLIT_STORAGE_KEY, value);
    },
    [minRatio, maxRatio],
  );

  const dividerDrag = useRef<{ id: number; left: number } | null>(null);
  const onDividerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const root = rootRef.current;
    if (!root) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dividerDrag.current = { id: event.pointerId, left: root.getBoundingClientRect().left };
    setResizing(true);
  };
  const onDividerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const d = dividerDrag.current;
    if (!d || d.id !== event.pointerId || !avail) return;
    setRatioClamped((event.clientX - d.left - DIVIDER / 2) / avail, false);
  };
  const onDividerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const d = dividerDrag.current;
    if (!d || d.id !== event.pointerId) return;
    dividerDrag.current = null;
    setResizing(false);
    writeLocalJson(SPLIT_STORAGE_KEY, clampNumber(ratio, minRatio, maxRatio));
  };
  const onDividerKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 0.1 : 0.02;
    let next: number | null = null;
    if (event.key === "ArrowLeft") next = effectiveRatio - step;
    else if (event.key === "ArrowRight") next = effectiveRatio + step;
    else if (event.key === "Home") next = minRatio;
    else if (event.key === "End") next = maxRatio;
    else if (event.key === "Enter") next = DEFAULT_SPLIT;
    if (next === null) return;
    event.preventDefault();
    setRatioClamped(next, true);
  };

  /* ---------------- pieces ---------------- */

  const onSheetSnap = useCallback((snap: BillSheetSnap) => update({ sheet: snap }), [update]);

  const layout = useMemo<BillWorkspaceLayout>(
    () => ({ active: Boolean(doc), mode, paneScroll: mode === "dock", sheetOffset: mode === "sheet" ? SHEET_PEEK : 0 }),
    [doc, mode],
  );

  const status = doc ? <WorkspaceStatusChip label={doc.statusLabel} tone={doc.statusTone} /> : null;

  const modeSwitch = doc ? (
    <div role="group" aria-label="Bill layout" className="inline-flex items-center gap-0.5 rounded-lg border border-line bg-surface-2 p-0.5">
      {device === "desktop" && canDock ? (
        <ModeButton label="Dock beside the form" active={mode === "dock"} onClick={() => setMode("dock")} testId="bill-mode-dock">
          <PanelRight className="h-4 w-4" />
        </ModeButton>
      ) : null}
      <ModeButton label="Float over the form" active={mode === "float"} onClick={() => setMode("float")} testId="bill-mode-float">
        <PictureInPicture2 className="h-4 w-4" />
      </ModeButton>
      {doc.popoutHref ? (
        <ModeButton label="Open in another window" active={mode === "popout"} onClick={openPopout} testId="bill-mode-popout">
          <ExternalLink className="h-4 w-4" />
        </ModeButton>
      ) : null}
      <ModeButton label="Hide the bill (Alt+B)" active={mode === "hidden"} onClick={() => setMode("hidden")} testId="bill-mode-hide">
        <PanelRightClose className="h-4 w-4" />
      </ModeButton>
    </div>
  ) : null;

  const canvas = doc ? <BillCanvas ref={canvasRef} pages={pages} label={doc.label} view={view} onView={update} cache={cache} showHints={mode !== "sheet"} /> : null;

  const rail =
    doc && portalTarget && (mode === "hidden" || mode === "popout")
      ? createPortal(
          <div
            className="fixed right-2 top-1/2 z-[44] flex -translate-y-1/2 flex-col items-center gap-1 rounded-2xl border border-line bg-surface-1 p-1 shadow-lg"
            data-testid="bill-rail"
          >
            {mode === "popout" ? (
              <>
                <span className="flex flex-col items-center gap-1.5 px-1 pb-1 pt-2 text-info-fg">
                  <ExternalLink className="h-4 w-4" aria-hidden />
                  <span className="rotate-180 text-[12px] font-semibold [writing-mode:vertical-rl]">Bill open in another window</span>
                </span>
                <button
                  type="button"
                  onClick={bringBack}
                  aria-label="Bring the bill back into this window"
                  data-testid="bill-bring-back"
                  className="flex min-w-[36px] flex-col items-center rounded-xl border border-info-border bg-info-bg px-1.5 py-2 text-[12px] font-semibold text-info-fg hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border [@media(pointer:coarse)]:min-w-[44px]"
                >
                  <span className="rotate-180 [writing-mode:vertical-rl]">Bring back</span>
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={toggle}
                aria-label="Show bill (Alt+B)"
                title="Show bill (Alt+B)"
                data-testid="bill-show"
                className="flex min-w-[36px] flex-col items-center gap-1.5 rounded-xl px-1.5 py-2 text-content-1 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border [@media(pointer:coarse)]:min-w-[44px]"
              >
                <FileImage className="h-4 w-4 text-info-fg" aria-hidden />
                <span className="rotate-180 text-[12px] font-semibold [writing-mode:vertical-rl]">Show bill</span>
                <kbd className="rounded border border-line bg-surface-2 px-1 font-mono text-[9.5px] text-content-3">Alt+B</kbd>
              </button>
            )}
          </div>,
          portalTarget,
        )
      : null;

  return (
    <LayoutContext.Provider value={layout}>
      <div
        ref={rootRef}
        data-bill-workspace={mode ?? "off"}
        className={cn("w-full min-w-0", docked && "flex items-stretch")}
        style={
          docked
            ? { height: paneHeight ?? "calc(100dvh - 8rem)" }
            : mode === "sheet"
              ? { paddingBottom: SHEET_PEEK }
              : undefined
        }
      >
        <div
          ref={paneRef}
          id={paneId}
          data-testid={doc ? "bill-workspace-form" : undefined}
          onScroll={docked ? (event) => (paneScrollTop.current = event.currentTarget.scrollTop) : undefined}
          className={cn(
            "min-w-0",
            docked && "shrink-0 overflow-y-auto overscroll-contain pr-1 [scrollbar-gutter:stable]",
            (mode === "hidden" || mode === "popout") && "pr-12",
          )}
          style={docked ? { width: formWidth || `${Math.round(DEFAULT_SPLIT * 100)}%` } : undefined}
        >
          {children}
        </div>
        {docked && doc ? (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-controls={paneId}
            aria-label="Resize form and bill"
            aria-valuemin={Math.round(minRatio * 100)}
            aria-valuemax={Math.round(maxRatio * 100)}
            aria-valuenow={Math.round(effectiveRatio * 100)}
            aria-valuetext={`Form ${Math.round(effectiveRatio * 100)} percent, bill ${100 - Math.round(effectiveRatio * 100)} percent`}
            tabIndex={0}
            onPointerDown={onDividerDown}
            onPointerMove={onDividerMove}
            onPointerUp={onDividerUp}
            onPointerCancel={onDividerUp}
            onDoubleClick={() => setRatioClamped(DEFAULT_SPLIT, true)}
            onKeyDown={onDividerKey}
            data-testid="bill-divider"
            className="group relative flex shrink-0 cursor-col-resize touch-none items-center justify-center focus-visible:outline-none"
            style={{ width: DIVIDER }}
            title="Drag to resize · ←/→ when focused · double-click to reset"
          >
            <span
              className={cn(
                "h-full w-px bg-line transition-colors group-hover:bg-primary group-focus-visible:w-[3px] group-focus-visible:bg-primary motion-reduce:transition-none",
                resizing && "w-[3px] bg-primary",
              )}
              aria-hidden
            />
            <span className="absolute top-1/2 h-10 w-1.5 -translate-y-1/2 rounded-full bg-line-strong opacity-70 group-hover:bg-primary" aria-hidden />
          </div>
        ) : null}
        {docked && doc ? (
          <aside
            aria-label={`Bill: ${doc.label}`}
            data-testid="bill-dock"
            className={cn("flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border border-line bg-surface-1 shadow-sm", resizing && "select-none")}
          >
            <div className="flex items-start gap-2 border-b border-line px-3 py-2">
              <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-info-bg text-info-fg">
                <FileImage className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <h2 className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-content-1" title={doc.label}>
                    {doc.label}
                  </h2>
                  {modeSwitch}
                </div>
                <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
                  {status}
                  {doc.meta ? (
                    <span className="min-w-0 flex-1 truncate text-[11.5px] text-content-3" title={doc.meta}>
                      {doc.meta}
                    </span>
                  ) : (
                    <span className="flex-1" />
                  )}
                  {headerActions ? <div className="flex shrink-0 items-center gap-1">{headerActions}</div> : null}
                </div>
              </div>
            </div>
            {canvas}
          </aside>
        ) : null}
      </div>
      {doc && mode === "float" ? (
        <BillFloat title={doc.label} status={status} meta={headerActions} actions={modeSwitch}>
          {canvas}
        </BillFloat>
      ) : null}
      {doc && mode === "sheet" ? (
        <BillSheet snap={view.sheet} onSnap={onSheetSnap} title={doc.label} status={status} actions={headerActions}>
          {canvas}
        </BillSheet>
      ) : null}
      {rail}
    </LayoutContext.Provider>
  );
}

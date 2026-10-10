"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FileImage, Link2, Link2Off, Loader2, Lock, X } from "lucide-react";

import { getApiErrorStatus, describeApiError } from "@/lib/api";
import { cn } from "@/lib/utils";

import { BillCanvas, useBillImageCache, useBillShortcuts, type BillCanvasHandle } from "./bill-canvas";
import { usePortalTarget } from "./bill-float";
import { WorkspaceStatusChip, type WorkspaceDocument } from "./bill-workspace-shared";
import { useBillViewState, useBillViewSync } from "./use-bill-view-state";

/**
 * Full-window frame for the pop-out viewer. It sits above the dashboard chrome
 * (sidebar and header) so the second window shows only the document.
 */
export function BillPopoutFrame({ children }: { children: ReactNode }) {
  const target = usePortalTarget();
  useEffect(() => {
    const html = document.documentElement;
    const previous = html.style.overflow;
    html.style.overflow = "hidden";
    return () => {
      html.style.overflow = previous;
    };
  }, []);
  if (!target) return null;
  return createPortal(
    <div className="fixed inset-0 z-[45] flex flex-col bg-surface-0 text-content-1" data-testid="bill-popout">
      {children}
    </div>,
    target,
  );
}

export function BillPopoutMessage({ title, body, icon, action }: { title: string; body?: ReactNode; icon?: ReactNode; action?: ReactNode }) {
  return (
    <BillPopoutFrame>
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="max-w-[440px] rounded-2xl border border-line bg-surface-1 p-6 text-center shadow-sm">
          {icon ? <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-2 text-content-3">{icon}</div> : null}
          <h1 className="text-[16px] font-semibold text-content-1">{title}</h1>
          {body ? <div className="mt-2 text-[13px] leading-relaxed text-content-3">{body}</div> : null}
          {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
        </div>
      </div>
    </BillPopoutFrame>
  );
}

function closeWindow(onBlocked: () => void) {
  window.close();
  // Browsers only let scripts close windows they opened; otherwise ask the user.
  window.setTimeout(() => {
    if (!window.closed) onBlocked();
  }, 250);
}

function PopoutViewer({ doc }: { doc: WorkspaceDocument }) {
  const { view, update } = useBillViewState(doc.id);
  const cache = useBillImageCache();
  const canvasRef = useRef<BillCanvasHandle>(null);
  const [closeHint, setCloseHint] = useState(false);
  const sync = useBillViewSync(doc.id, "popout", view, update, {
    enabled: true,
    onBringBack: () => closeWindow(() => setCloseHint(true)),
  });

  useBillShortcuts(true, {
    page: (d) => canvasRef.current?.goTo(d),
    zoom: (d) => canvasRef.current?.zoomStep(d),
    fitWidth: () => canvasRef.current?.fitWidth(),
    rotate: () => canvasRef.current?.rotate(),
  });

  useEffect(() => {
    const previous = document.title;
    document.title = `${doc.label} · Bill viewer`;
    return () => {
      document.title = previous;
    };
  }, [doc.label]);

  return (
    <BillPopoutFrame>
      <header className="flex flex-wrap items-center gap-2 border-b border-line bg-surface-1 px-3 py-2">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-info-bg text-info-fg">
          <FileImage className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1 basis-[14rem]">
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <h1 className="min-w-0 truncate text-[14px] font-semibold text-content-1">{doc.label}</h1>
            <WorkspaceStatusChip label={doc.statusLabel} tone={doc.statusTone} />
          </div>
          {doc.meta ? <div className="truncate text-[12px] text-content-3">{doc.meta}</div> : null}
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-semibold",
            sync.peerOpen ? "border-success-border bg-success-bg text-success-fg" : "border-line bg-surface-2 text-content-3",
          )}
          role="status"
          data-testid="bill-popout-sync"
        >
          {sync.peerOpen ? <Link2 className="h-3.5 w-3.5" aria-hidden /> : <Link2Off className="h-3.5 w-3.5" aria-hidden />}
          {sync.peerOpen ? "Follows the form window" : "Form window not open"}
        </span>
        <button
          type="button"
          onClick={() => closeWindow(() => setCloseHint(true))}
          className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-line bg-surface-1 px-3 text-[12.5px] font-semibold text-content-2 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border [@media(pointer:coarse)]:min-h-[44px]"
        >
          <X className="h-4 w-4" aria-hidden /> Close window
        </button>
      </header>
      {closeHint ? (
        <div role="status" className="border-b border-info-border bg-info-bg px-3 py-2 text-[12.5px] text-info-fg">
          The bill is back beside the form. Close this window or tab to finish.
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col bg-surface-1">
        <BillCanvas ref={canvasRef} pages={doc.pages} label={doc.label} view={view} onView={update} cache={cache} shortcutsIncludeToggle={false} />
      </div>
    </BillPopoutFrame>
  );
}

type LoadState = { status: "loading" } | { status: "ready"; doc: WorkspaceDocument } | { status: "error"; error: unknown };

/**
 * Bare full-window viewer for one document, opened from the workspace's
 * "Open in another window" button. Page, zoom, rotation and pin stay in step
 * with the form window through `BroadcastChannel("bill-view-" + id)`.
 */
export function BillPopoutView({ loadDocument }: { loadDocument: () => Promise<WorkspaceDocument> }) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const loadRef = useRef(loadDocument);
  loadRef.current = loadDocument;

  useEffect(() => {
    let cancelled = false;
    setState((prev) => (prev.status === "ready" ? prev : { status: "loading" }));
    loadRef.current().then(
      (doc) => !cancelled && setState({ status: "ready", doc }),
      (error) => !cancelled && setState({ status: "error", error }),
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (state.status === "loading") {
    return (
      <BillPopoutFrame>
        <div className="flex flex-1 items-center justify-center gap-2 text-[13px] text-content-3" role="status">
          <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden /> Loading the bill…
        </div>
      </BillPopoutFrame>
    );
  }
  if (state.status === "error") {
    const code = getApiErrorStatus(state.error);
    if (code === 403)
      return (
        <BillPopoutMessage
          icon={<Lock className="h-6 w-6" />}
          title="You cannot open this bill"
          body="Bills and documents are for the inventory team. Ask an administrator for the documents permission if you need it."
        />
      );
    if (code === 404) return <BillPopoutMessage title="This bill is no longer available" body="It may belong to another factory or the link is wrong. Open it again from the bill register." />;
    return (
      <BillPopoutMessage
        title="The bill could not be loaded"
        body={describeApiError(state.error, "Check the connection and try again.")}
        action={
          <button
            type="button"
            onClick={() => setAttempt((n) => n + 1)}
            className="inline-flex min-h-[44px] items-center rounded-xl border border-line bg-surface-1 px-4 text-[13px] font-semibold text-content-1 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border"
          >
            Retry
          </button>
        }
      />
    );
  }
  return <PopoutViewer doc={state.doc} />;
}

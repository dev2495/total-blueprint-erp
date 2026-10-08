"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Expand, Loader2, RotateCw, ZoomIn, ZoomOut } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { gateBillsApi, type BillPage } from "@/services/gate-bills";

type Zoom = "fit" | 1 | 2;

/** Loads a private page as an object URL (memory only) and revokes it on change. */
function usePageUrl(page?: BillPage) {
  const [state, setState] = useState<{ url: string | null; error: boolean; loading: boolean }>({ url: null, error: false, loading: false });
  const src = page?.image_url;
  useEffect(() => {
    if (!src) return;
    let cancelled = false;
    let created: string | null = null;
    setState({ url: null, error: false, loading: true });
    gateBillsApi
      .pageObjectUrl(src)
      .then((url) => {
        if (cancelled) return URL.revokeObjectURL(url);
        created = url;
        setState({ url, error: false, loading: false });
      })
      .catch(() => !cancelled && setState({ url: null, error: true, loading: false }));
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [src]);
  return state;
}

function ToolButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-surface-1 text-content-2 transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function PageImage({ page, zoom, rotation, onRetry, alt }: { page?: BillPage; zoom: Zoom; rotation: number; onRetry?: () => void; alt: string }) {
  const { url, error, loading } = usePageUrl(page);
  const sideways = rotation % 180 !== 0;
  if (error)
    return (
      <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-2 text-[13px] text-danger-fg">
        Could not load this page.
        {onRetry ? (
          <button type="button" onClick={onRetry} className="rounded-lg border border-line px-3 py-1.5 text-content-1">
            Retry
          </button>
        ) : null}
      </div>
    );
  if (loading || !url)
    return (
      <div className="flex h-full min-h-[280px] items-center justify-center text-content-4">
        <Loader2 className="h-6 w-6 animate-spin" aria-label="Loading bill page" />
      </div>
    );
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt}
      draggable={false}
      className={cn("mx-auto block select-none transition-transform duration-150", zoom === "fit" ? "max-h-full max-w-full object-contain" : "max-w-none")}
      style={{
        transform: `rotate(${rotation}deg)`,
        width: zoom === "fit" ? undefined : `${(page?.width || 1000) * (zoom === 1 ? 0.5 : 1)}px`,
        margin: sideways && zoom !== "fit" ? "15% auto" : undefined,
      }}
    />
  );
}

/**
 * Bill viewer: large, legible pages with page strip, zoom, rotate-view and a
 * full-screen dialog. Rotation only changes the view, never the stored image.
 */
export function BillViewer({ pages, billLabel, className, compact }: { pages: BillPage[]; billLabel: string; className?: string; compact?: boolean }) {
  const [index, setIndex] = useState(0);
  const [zoom, setZoom] = useState<Zoom>("fit");
  const [rotation, setRotation] = useState(0);
  const [full, setFull] = useState(false);
  const [retry, setRetry] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(false);
  const page = pages[Math.min(index, pages.length - 1)];
  const regionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setIndex((i) => Math.min(i, Math.max(0, pages.length - 1)));
  }, [pages.length]);
  useEffect(() => setRotation(0), [index]);

  const go = useCallback((delta: number) => setIndex((i) => Math.max(0, Math.min(pages.length - 1, i + delta))), [pages.length]);
  const onKey = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      go(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      go(-1);
    }
  };

  const download = async () => {
    if (!page) return;
    setDownloading(true);
    setDownloadError(false);
    try {
      const blob = await gateBillsApi.pageBlob(page.image_url);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${billLabel}-page-${page.page_number}.jpg`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setDownloadError(true);
    } finally {
      setDownloading(false);
    }
  };

  if (!pages.length) return <div className="rounded-2xl border border-dashed border-line p-8 text-center text-sm text-content-3">No pages.</div>;

  const toolbar = (
    <div className="flex flex-wrap items-center gap-1.5">
      <ToolButton label="Previous page" onClick={() => go(-1)} disabled={index === 0}>
        <ChevronLeft className="h-5 w-5" />
      </ToolButton>
      <span className="min-w-[78px] text-center text-[13px] font-semibold tabular-nums text-content-2" aria-live="polite">
        Page {index + 1} of {pages.length}
      </span>
      <ToolButton label="Next page" onClick={() => go(1)} disabled={index >= pages.length - 1}>
        <ChevronRight className="h-5 w-5" />
      </ToolButton>
      <span className="mx-1 h-6 w-px bg-line" aria-hidden />
      <ToolButton label="Zoom out" onClick={() => setZoom((z) => (z === 2 ? 1 : "fit"))} disabled={zoom === "fit"}>
        <ZoomOut className="h-5 w-5" />
      </ToolButton>
      <ToolButton label="Zoom in" onClick={() => setZoom((z) => (z === "fit" ? 1 : 2))} disabled={zoom === 2}>
        <ZoomIn className="h-5 w-5" />
      </ToolButton>
      <ToolButton label="Rotate view" onClick={() => setRotation((r) => (r + 90) % 360)}>
        <RotateCw className="h-5 w-5" />
      </ToolButton>
      {!full ? (
        <ToolButton label="Full screen" onClick={() => setFull(true)}>
          <Expand className="h-5 w-5" />
        </ToolButton>
      ) : null}
      <ToolButton label="Download this page" onClick={() => void download()} disabled={downloading}>
        {downloading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Download className="h-5 w-5" />}
      </ToolButton>
    </div>
  );

  const stage = (heightClass: string) => (
    <div
      ref={regionRef}
      role="region"
      aria-label={`Bill page ${index + 1} of ${pages.length}`}
      tabIndex={0}
      onKeyDown={onKey}
      className={cn(
        "relative overflow-auto rounded-2xl border border-line bg-[repeating-conic-gradient(var(--surface-2)_0%_25%,var(--surface-1)_0%_50%)] [background-size:16px_16px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info-border",
        heightClass,
        zoom === "fit" ? "flex items-center justify-center p-2" : "p-2",
      )}
    >
      <PageImage key={`${page?.id}-${retry}`} page={page} zoom={zoom} rotation={rotation} alt={`${billLabel} page ${index + 1}`} onRetry={() => setRetry((n) => n + 1)} />
    </div>
  );

  const strip =
    pages.length > 1 ? (
      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Bill pages">
        {pages.map((p, i) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={i === index}
            onClick={() => setIndex(i)}
            className={cn(
              "min-h-[44px] shrink-0 rounded-xl border px-3 text-[13px] font-semibold tabular-nums",
              i === index ? "border-primary bg-info-bg text-primary" : "border-line bg-surface-1 text-content-2",
            )}
          >
            Page {i + 1}
          </button>
        ))}
      </div>
    ) : null;

  return (
    <div className={cn("space-y-2", className)}>
      {toolbar}
      {downloadError ? <p role="alert" className="text-sm text-danger-fg">Could not download this page. Check the connection and try again.</p> : null}
      {strip}
      {stage(compact ? "h-[52vh] min-h-[320px]" : "h-[62vh] min-h-[360px] lg:h-[calc(100vh-15rem)]")}
      <Dialog open={full} onOpenChange={setFull}>
        <DialogContent className="flex h-[96dvh] w-[96vw] max-w-[96vw] flex-col gap-3 p-3 sm:p-4">
          <DialogTitle className="text-base">{billLabel}</DialogTitle>
          <DialogDescription className="sr-only">Full-screen bill viewer. Use arrow keys to change page; Escape closes.</DialogDescription>
          {toolbar}
          {strip}
          <div className="min-h-0 flex-1">{stage("h-full")}</div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { Button } from "@/components/ui/button";

/** Paint document pages only: no PDF scripts, forms, links or embedded HTML. */
export function PdfArtworkPreview({ url, title, compact = false }: { url: string; title: string; compact?: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: "200px" });
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let task: ReturnType<typeof import("pdfjs-dist").getDocument> | undefined;
    setDocument(null);
    setPage(1);
    setError("");
    setLoading(true);
    import("pdfjs-dist").then(async (pdfjs) => {
      if (cancelled) return;
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
      task = pdfjs.getDocument({ url, withCredentials: true, enableXfa: false, cMapUrl: "/pdfjs/cmaps/", cMapPacked: true, standardFontDataUrl: "/pdfjs/standard_fonts/", wasmUrl: "/pdfjs/wasm/" });
      const loaded = await task.promise;
      if (!cancelled) setDocument(loaded);
    }).catch(() => { if (!cancelled) { setError("PDF preview could not be loaded."); setLoading(false); } });
    return () => { cancelled = true; if (task) void task.destroy(); };
  }, [url, visible]);

  useEffect(() => {
    if (!document || !canvas.current) return;
    let cancelled = false;
    let render: ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]> | undefined;
    setLoading(true);
    document.getPage(page).then(async (pdfPage) => {
      if (cancelled || !canvas.current) return;
      const base = pdfPage.getViewport({ scale: 1 });
      const width = Math.min(container.current?.clientWidth || 600, 1000);
      const viewport = pdfPage.getViewport({ scale: width / base.width });
      canvas.current.width = viewport.width;
      canvas.current.height = viewport.height;
      render = pdfPage.render({ canvas: canvas.current, viewport });
      await render.promise;
      if (!cancelled) setLoading(false);
    }).catch(() => { if (!cancelled) { setError("This PDF page could not be rendered."); setLoading(false); } });
    return () => { cancelled = true; render?.cancel(); };
  }, [document, page]);

  return <div ref={container} className={compact ? "h-full w-full overflow-hidden bg-surface-1" : "w-full rounded-xl border border-line bg-surface-1"}>
    {loading && !error && <div role="status" className="p-3 text-xs text-content-3">Loading PDF…</div>}
    {error && <div role="alert" className="p-3 text-xs text-danger-fg">{error}</div>}
    <div className={compact ? "h-full overflow-hidden" : "max-h-[240px] overflow-auto"}>
      <canvas ref={canvas} role="img" aria-label={title} className="mx-auto max-w-full" />
    </div>
    {!compact && <div className="flex items-center justify-between gap-2 border-t border-line p-2">
      <Button type="button" size="sm" variant="outline" disabled={!document || page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
      <span className="text-xs">Page {page} of {document?.numPages ?? "…"}</span>
      <Button type="button" size="sm" variant="outline" disabled={!document || page >= document.numPages} onClick={() => setPage(page + 1)}>Next</Button>
      <a href={url} download className="text-xs underline">Download PDF</a>
    </div>}
  </div>;
}

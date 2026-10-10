"use client";

import { useRef, useState } from "react";
import { Expand } from "lucide-react";

import { BillCanvas, ViewerButton, useBillImageCache, useBillShortcuts, type BillCanvasHandle } from "@/components/documents/bill-canvas";
import { useBillViewState } from "@/components/documents/use-bill-view-state";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { BillPage } from "@/services/gate-bills";

/**
 * Bill viewer for pages that show a bill on its own (bill detail / review).
 * A thin wrapper over the shared `BillCanvas`: fit-width by default, zoom
 * 50–400 % (buttons, Ctrl/⌘ + wheel, pinch), drag to pan, rotate, region pin,
 * page strip and a full-screen dialog. Rotation only changes the view unless
 * "Save rotation for everyone" is used. Pass `documentId` to share the reading
 * state (page, zoom, rotation) with the GRN workspace of the same bill.
 */
export function BillViewer({
  pages,
  billLabel,
  className,
  compact,
  documentId,
}: {
  pages: BillPage[];
  billLabel: string;
  className?: string;
  compact?: boolean;
  documentId?: string;
}) {
  const stateKey = documentId || (pages[0] ? `pages-${pages[0].id}` : "");
  const { view, update } = useBillViewState(stateKey);
  const cache = useBillImageCache();
  const canvasRef = useRef<BillCanvasHandle>(null);
  const [full, setFull] = useState(false);

  useBillShortcuts(pages.length > 0, {
    page: (d) => canvasRef.current?.goTo(d),
    zoom: (d) => canvasRef.current?.zoomStep(d),
    fitWidth: () => canvasRef.current?.fitWidth(),
    rotate: () => canvasRef.current?.rotate(),
  });

  if (!pages.length) return <div className="rounded-2xl border border-dashed border-line p-8 text-center text-sm text-content-3">No pages.</div>;

  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-2xl border border-line bg-surface-1",
        compact ? "h-[52vh] min-h-[320px]" : "h-[62vh] min-h-[360px] lg:h-[calc(100vh-15rem)]",
        className,
      )}
    >
      {full ? (
        <div className="flex flex-1 items-center justify-center p-6 text-[13px] text-content-3">Showing in full screen.</div>
      ) : (
        <BillCanvas
          ref={canvasRef}
          pages={pages}
          label={billLabel}
          view={view}
          onView={update}
          cache={cache}
          shortcutsIncludeToggle={false}
          toolbarEnd={
            <ViewerButton label="Full screen" onClick={() => setFull(true)}>
              <Expand className="h-4 w-4" />
            </ViewerButton>
          }
        />
      )}
      <Dialog open={full} onOpenChange={setFull}>
        <DialogContent className="flex h-[96dvh] w-[96vw] max-w-[96vw] flex-col gap-2 p-3 sm:p-4">
          <DialogTitle className="pr-10 text-base">{billLabel}</DialogTitle>
          <DialogDescription className="sr-only">Full-screen bill viewer. Alt + arrow keys change the page; Escape closes.</DialogDescription>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-line">
            {full ? (
              <BillCanvas ref={canvasRef} pages={pages} label={billLabel} view={view} onView={update} cache={cache} shortcutsIncludeToggle={false} />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

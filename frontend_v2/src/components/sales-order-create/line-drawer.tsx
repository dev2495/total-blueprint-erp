"use client";

/**
 * Sales order composer — the line drawer.
 *
 * The full line editor in a wide sheet over the order: the line tabs on top switch lines without
 * closing (Alt ← / Alt →), the editor scrolls on the left with its plate and live preview on the
 * right, and the footer holds remove, duplicate, the line's status and value, and the two ways out.
 */

import * as React from "react";
import { ChevronLeft, ChevronRight, Copy, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { ProductMaster } from "@/services/product-master";

import { LineEditor } from "./line-editor";
import { lineIssues, shortIssue } from "./lines-table";
import type { SalesOrderLine } from "./types";

export function LineDrawer({
  lines,
  activeId,
  masters,
  customerId,
  perLineIssues,
  onSelect,
  onClose,
  onPatch,
  onAdd,
  onRemove,
  onDuplicate,
}: {
  lines: SalesOrderLine[];
  activeId: string | null;
  masters: ProductMaster[];
  customerId: string;
  perLineIssues: Record<string, string[]>;
  onSelect: (id: string) => void;
  onClose: () => void;
  onPatch: (id: string, patch: Partial<SalesOrderLine>) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onDuplicate: (id: string) => void;
}) {
  const index = lines.findIndex((line) => line.id === activeId);
  const line = index >= 0 ? lines[index] : undefined;
  const master = line ? masters.find((row) => row.id === line.product_master) : undefined;
  const issues = line ? lineIssues(line, perLineIssues) : [];
  const ready = issues.length === 0;
  const rate = parseFloat(line?.unit_price || "0") || 0;
  const value = rate * (Number(line?.qty_value) || 0);
  const patch = React.useCallback(
    (next: Partial<SalesOrderLine>) => {
      if (activeId) onPatch(activeId, next);
    },
    [activeId, onPatch],
  );
  const step = React.useCallback(
    (by: -1 | 1) => {
      const next = lines[index + by];
      if (next) onSelect(next.id);
    },
    [index, lines, onSelect],
  );
  React.useEffect(() => {
    if (!line) return;
    const onKey = (event: KeyboardEvent) => {
      if (!event.altKey || event.metaKey || event.ctrlKey) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        step(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        step(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [line, step]);

  return (
    <Sheet open={Boolean(line)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        aria-describedby={undefined}
        tabIndex={-1}
        className="flex w-full max-w-none flex-col gap-0 overflow-hidden p-0 outline-none sm:w-[min(1240px,calc(100vw-72px))] sm:max-w-[calc(100vw-72px)]"
        data-testid="sales-line-drawer"
        onOpenAutoFocus={(event) => {
          // A blank line starts in the product search; an existing line keeps the page still.
          event.preventDefault();
          const root = event.currentTarget as HTMLElement | null;
          const search = root?.querySelector<HTMLInputElement>('input[placeholder^="Search product master"]');
          (search || root)?.focus({ preventScroll: true });
        }}
      >
        {line ? (
          <>
            <header className="flex flex-wrap items-end gap-x-4 gap-y-2 border-b border-line bg-surface-1 px-4 pb-0 pr-14 pt-3 sm:px-5 sm:pr-14">
              <div className="min-w-0 pb-2.5">
                <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-primary">
                  Line {index + 1} of {lines.length} · build
                </div>
                <SheetTitle className="flex min-w-0 items-baseline gap-2 text-[18px] font-semibold tracking-[-0.015em] text-content-1">
                  <span className="truncate">{master?.name || "New line"}</span>
                  {master?.code ? <span className="shrink-0 font-mono text-[12px] font-medium text-content-3">{master.code}</span> : null}
                </SheetTitle>
              </div>
              <nav aria-label="Lines on this order" className="-mb-px flex min-w-0 flex-1 items-end gap-1 overflow-x-auto" data-testid="sales-line-drawer-tabs">
                {lines.map((row, rowIndex) => {
                  const rowMaster = masters.find((m) => m.id === row.product_master);
                  const rowReady = lineIssues(row, perLineIssues).length === 0;
                  const current = row.id === line.id;
                  return (
                    <button
                      key={row.id}
                      type="button"
                      onClick={() => onSelect(row.id)}
                      aria-current={current ? "true" : undefined}
                      className={cn(
                        "inline-flex h-9 max-w-[200px] shrink-0 items-center gap-1.5 rounded-t-[10px] border border-b-0 px-3 text-[12.5px] font-medium transition-colors",
                        current ? "border-line bg-surface-2 text-content-1" : "border-transparent text-content-3 hover:bg-surface-2 hover:text-content-1",
                      )}
                      title={rowReady ? "Ready" : lineIssues(row, perLineIssues)[0]}
                    >
                      <span className="font-mono text-[11px] text-content-4">{rowIndex + 1}</span>
                      <span className="truncate">{rowMaster?.name || rowMaster?.code || "New line"}</span>
                      <span aria-hidden className={cn("h-1.5 w-1.5 shrink-0 rounded-full", rowReady ? "bg-success-fg" : "bg-warning-fg")} />
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={onAdd}
                  className="inline-flex h-9 shrink-0 items-center gap-1 rounded-t-[10px] px-3 text-[12.5px] font-semibold text-primary hover:bg-info-bg"
                  data-testid="sales-line-drawer-add"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden /> Add line
                </button>
              </nav>
              <div className="flex items-center gap-1 pb-2.5">
                <button
                  type="button"
                  aria-label="Previous line (Alt ←)"
                  title="Previous line (Alt ←)"
                  disabled={index <= 0}
                  onClick={() => step(-1)}
                  className="grid h-8 w-8 place-items-center rounded-[8px] border border-line text-content-2 hover:bg-surface-2 disabled:opacity-40"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label="Next line (Alt →)"
                  title="Next line (Alt →)"
                  disabled={index >= lines.length - 1}
                  onClick={() => step(1)}
                  className="grid h-8 w-8 place-items-center rounded-[8px] border border-line text-content-2 hover:bg-surface-2 disabled:opacity-40"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-hidden">
              <LineEditor
                key={line.id}
                layout="drawer"
                line={line}
                masters={masters}
                customerId={customerId}
                lineIndex={index}
                onPatch={patch}
                onCollapse={onClose}
                onAdd={onAdd}
              />
            </div>

            <footer className="flex flex-wrap items-center gap-2 border-t border-line bg-surface-1 px-4 py-2.5 pb-[calc(0.625rem+env(safe-area-inset-bottom,0px))] sm:px-5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onRemove(line.id)}
                className="h-9 gap-1.5 rounded-[10px] border-danger-border text-danger-fg hover:bg-danger-bg hover:text-danger-fg"
                data-testid="sales-line-drawer-remove"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden /> Remove
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => onDuplicate(line.id)} className="h-9 gap-1.5 rounded-[10px]">
                <Copy className="h-3.5 w-3.5" aria-hidden /> Duplicate
              </Button>
              <div className="ml-auto flex min-w-0 items-center gap-2.5">
                <span
                  className={cn(
                    "inline-flex min-w-0 max-w-[280px] items-center gap-1.5 truncate rounded-full px-2.5 py-1 text-[12px] font-semibold",
                    ready ? "bg-success-bg text-success-fg" : "bg-warning-bg text-warning-fg",
                  )}
                  title={issues.join("\n") || "Ready to place"}
                  data-testid="sales-line-drawer-status"
                >
                  <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
                  <span className="truncate">{ready ? "Ready" : shortIssue(issues[0])}</span>
                  {issues.length > 1 ? <span className="shrink-0 opacity-80">+{issues.length - 1}</span> : null}
                </span>
                <span className="font-mono text-[15px] font-semibold tabular-nums text-content-1">
                  {value > 0 ? `₹${Math.round(value).toLocaleString("en-IN")}` : "₹ —"}
                </span>
              </div>
              <div className="flex w-full items-center gap-2 sm:w-auto">
                <Button type="button" variant="outline" size="sm" onClick={onClose} className="h-9 flex-1 rounded-[10px] sm:flex-none" data-testid="sales-line-done">
                  Done with this line
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={!ready}
                  onClick={onAdd}
                  className="h-9 flex-1 gap-1.5 rounded-[10px] sm:flex-none"
                  title={ready ? "Keep this line and start the next" : "Fix this line first"}
                  data-testid="sales-line-save-add"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden /> Save &amp; add another
                </Button>
              </div>
            </footer>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

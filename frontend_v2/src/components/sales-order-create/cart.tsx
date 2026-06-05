"use client";

/**
 * Sales Order Create — line-tab workbench.
 *
 * Matches mockups/sales-order-create-redesign.html: a light row of line-tab
 * chips, then a slim active-line toolbar (duplicate / remove), then the full
 * LineEditor workspace (8 section cards + live preview rail).
 */

import * as React from "react";
import { AlertCircle, Plus, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { LineEditor } from "./line-editor";
import type { SalesOrderLine, SalesOrderDraft } from "./types";
import type { ProductMaster } from "@/services/product-master";

export interface CartProps {
  draft: SalesOrderDraft;
  masters: ProductMaster[];
  onAddLine: () => void;
  onRemoveLine: (id: string) => void;
  onDuplicateLine: (id: string) => void;
  onUpdateLine: (id: string, patch: Partial<SalesOrderLine>) => void;
  onExpandLine: (id: string | null) => void;
  perLineIssues: Record<string, string[]>;
}

export function Cart({
  draft,
  masters,
  onAddLine,
  onRemoveLine,
  onDuplicateLine,
  onUpdateLine,
  onExpandLine,
  perLineIssues,
}: CartProps) {
  const customerId = draft.customer || undefined;

  if (draft.lines.length === 0) {
    return (
      <div className="rounded-[18px] border border-dashed border-order-border bg-surface-1 p-10 text-center shadow-sm">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-order-bg ring-1 ring-order-border">
          <ShoppingBag className="h-7 w-7 text-order-fg" />
        </div>
        <div className="mt-4 text-base font-black text-content-1">
          Start the first production line
        </div>
        <p className="mt-1 text-sm text-content-3">
          Use a customer overlay, repeat-order shortcut, or build manually from
          product-master axes.
        </p>
        <Button
          onClick={onAddLine}
          className="mt-5 gap-1.5 rounded-xl bg-surface-3 text-white shadow-lg hover:bg-line"
          disabled={!draft.customer}
        >
          <Plus className="h-4 w-4" />
          {draft.customer ? "Add line" : "Pick customer first"}
        </Button>
      </div>
    );
  }

  const activeLineId = draft.expanded_line_id || draft.lines[0]?.id;
  const activeLine =
    draft.lines.find((line) => line.id === activeLineId) || draft.lines[0];
  const activeIndex = draft.lines.findIndex(
    (line) => line.id === activeLine?.id,
  );
  const activeMaster = masters.find(
    (master) => master.id === activeLine?.product_master,
  );
  const totalKg = draft.lines.reduce(
    (sum, l) =>
      String(l.qty_uom).toUpperCase() === "KG"
        ? sum + (Number(l.qty_value) || 0)
        : sum,
    0,
  );

  return (
    <div className="space-y-3">
      {/* Line-tab chips */}
      <div className="flex flex-wrap items-center gap-2">
        {draft.lines.map((line, idx) => {
          const master = masters.find(
            (item) => item.id === line.product_master,
          );
          const issues = perLineIssues[line.id] || [];
          const isActive = line.id === activeLine?.id;
          const qtyLabel =
            line.qty_value > 0
              ? `${Number(line.qty_value).toLocaleString()}${String(line.qty_uom).toLowerCase()}`
              : "";
          return (
            <button
              key={line.id}
              type="button"
              onClick={() => onExpandLine(line.id)}
              className={cn(
                "inline-flex h-9 max-w-[260px] items-center gap-2 rounded-full px-3.5 text-xs font-black ring-1 transition",
                isActive
                  ? "bg-surface-3 text-white ring-line-strong"
                  : issues.length
                    ? "bg-warning-bg text-warning-fg ring-warning-border hover:bg-warning-bg"
                    : "bg-surface-1 text-content-3 ring-line hover:bg-surface-2",
              )}
            >
              <span
                className={cn(
                  "grid h-5 w-5 place-items-center rounded-full text-[10px]",
                  isActive
                    ? "bg-surface-1 text-content-1"
                    : issues.length
                      ? "bg-warning-fg text-white"
                      : "bg-surface-2 text-content-3",
                )}
              >
                {idx + 1}
              </span>
              <span className="truncate">
                {master?.code || "New line"}
                {line.size_code ? ` · ${line.size_code}` : ""}
                {qtyLabel ? ` · ${qtyLabel}` : ""}
              </span>
              {issues.length ? (
                <AlertCircle className="h-3.5 w-3.5 flex-none" />
              ) : null}
            </button>
          );
        })}
        <button
          type="button"
          onClick={onAddLine}
          className="inline-flex h-9 items-center gap-1 rounded-full bg-order-bg px-3.5 text-xs font-black text-order-fg ring-1 ring-order-border hover:bg-order-bg"
        >
          <Plus className="h-3.5 w-3.5" /> Add line
        </button>
        <span className="ml-auto text-[11px] font-bold text-content-4">
          {draft.lines.length} line{draft.lines.length === 1 ? "" : "s"}
          {totalKg > 0 ? ` · ${totalKg.toLocaleString()} KG` : ""} · sends to
          planner
        </span>
      </div>

      {/* Active line */}
      {activeLine ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-[18px] border border-line bg-surface-1 px-4 py-2.5 shadow-sm">
            <div className="min-w-0">
              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-order-fg">
                Line {activeIndex + 1} · build
              </div>
              <div className="truncate font-display text-sm font-black text-content-1">
                {activeMaster
                  ? activeMaster.name
                  : "Pick a product master, axes, artwork, packing & quantity"}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onDuplicateLine(activeLine.id)}
                className="h-8 rounded-lg border-line text-[11px] font-bold"
              >
                Duplicate
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onRemoveLine(activeLine.id)}
                className="h-8 rounded-lg border-danger-border text-[11px] font-bold text-danger-fg hover:bg-danger-bg"
              >
                Remove
              </Button>
            </div>
          </div>
          <LineEditor
            line={activeLine}
            masters={masters}
            customerId={customerId}
            lineIndex={activeIndex}
            onPatch={(patch) => onUpdateLine(activeLine.id, patch)}
            onCollapse={() => onExpandLine(activeLine.id)}
            onAdd={onAddLine}
          />
        </div>
      ) : null}
    </div>
  );
}

"use client";

/**
 * Sales order composer — the lines.
 *
 * Every line is a card. A closed line shows its spec plate (size, layers, micron, grade)
 * with quantity and amount; the open line shows the same plate above the step-by-step
 * editor and the live preview. Clicking a closed line opens it.
 */

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Copy, Pencil, Plus, ShoppingBag, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SpecPlate } from "@/components/plate/spec-plate";
import { specFromMasterLine } from "@/components/plate/spec-from-master";
import { Pill } from "@/components/plate/steps";
import { productMasterService, type ProductMaster } from "@/services/product-master";

import { LineEditor } from "./line-editor";
import type { SalesOrderDraft, SalesOrderLine } from "./types";

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
      <section className="grid place-items-center rounded-[18px] border border-dashed border-line-strong bg-surface-1 px-6 py-10 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-surface-2 text-content-3">
          <ShoppingBag className="h-6 w-6" />
        </span>
        <div className="mt-3 text-[16px] font-semibold text-content-1">No lines yet</div>
        <p className="mt-1 max-w-md text-[13px] text-content-3">
          {draft.customer
            ? "Search a product above, tap one of this customer's usual items, or start a blank line."
            : "Pick the customer first, then add the lines."}
        </p>
        <Button onClick={onAddLine} className="mt-4 h-10 gap-1.5 rounded-[11px]" disabled={!draft.customer}>
          <Plus className="h-4 w-4" />
          {draft.customer ? "Add line" : "Pick customer first"}
        </Button>
      </section>
    );
  }

  const activeLineId = draft.expanded_line_id;

  return (
    <div className="grid gap-3" data-testid="sales-cart">
      {draft.lines.map((line, idx) => {
        const master = masters.find((item) => item.id === line.product_master);
        const issues = perLineIssues[line.id] || [];
        const isActive = line.id === activeLineId;
        const lineTotal = line.qty_value * (parseFloat(line.unit_price || "0") || 0);
        return (
          <section
            key={line.id}
            className={cn(
              "overflow-hidden rounded-[18px] border bg-surface-1 shadow-[var(--shadow-sm)] transition-shadow",
              isActive ? "border-line-strong shadow-[var(--shadow-md)]" : "border-line hover:shadow-[var(--shadow-md)]",
            )}
            data-testid={`sales-line-${idx + 1}`}
          >
            <LineHeader
              index={idx}
              line={line}
              master={master}
              issues={issues}
              lineTotal={lineTotal}
              isActive={isActive}
              onToggle={() => onExpandLine(isActive ? null : line.id)}
              onDuplicate={() => onDuplicateLine(line.id)}
              onRemove={() => onRemoveLine(line.id)}
            />
            {isActive ? (
              <div className="pt-3">
                <LineEditor
                  line={line}
                  masters={masters}
                  customerId={customerId}
                  lineIndex={idx}
                  onPatch={(patch) => onUpdateLine(line.id, patch)}
                  onCollapse={() => onExpandLine(null)}
                  onAdd={onAddLine}
                />
              </div>
            ) : (
              <ClosedLinePlate line={line} master={master} onOpen={() => onExpandLine(line.id)} />
            )}
          </section>
        );
      })}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={onAddLine} className="h-10 gap-1.5 rounded-[11px]">
          <Plus className="h-4 w-4" /> Add line
        </Button>
        <span className="text-[12.5px] text-content-3">
          The line label carries into the planner, the floor, packing and dispatch.
        </span>
      </div>
    </div>
  );
}

function LineHeader({
  index,
  line,
  master,
  issues,
  lineTotal,
  isActive,
  onToggle,
  onDuplicate,
  onRemove,
}: {
  index: number;
  line: SalesOrderLine;
  master?: ProductMaster;
  issues: string[];
  lineTotal: number;
  isActive: boolean;
  onToggle: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const artworkPill =
    master?.fixed_attributes?.print_capable
      ? line.artwork_mode === "DEFER"
        ? { tone: "warn" as const, text: "artwork later" }
        : line.artwork_assignment?.artwork_id
          ? { tone: "ok" as const, text: "artwork set" }
          : { tone: "warn" as const, text: "artwork needed" }
      : null;
  return (
    <div className="grid gap-3 px-4 pt-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:px-5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className="font-mono text-[11px] font-semibold tracking-[0.06em] text-content-4">LINE {index + 1}</span>
          <span className="min-w-0 text-[17px] font-semibold leading-snug tracking-[-0.015em] text-content-1">
            {master?.name || line.line_label || "New line"}
          </span>
          <span className="font-mono text-[12px] text-content-3">{master?.code || "pick a product master"}</span>
        </div>
        {line.line_label && !isActive ? (
          <div className="mt-0.5 line-clamp-1 text-[12.5px] text-content-3" title={line.line_label}>
            {line.line_label}
          </div>
        ) : null}
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {issues.length ? (
            <Pill tone="warn">
              <AlertCircle className="h-3 w-3" />
              {issues[0]}
              {issues.length > 1 ? ` +${issues.length - 1}` : ""}
            </Pill>
          ) : !(parseFloat(line.unit_price || "0") > 0) ? (
            <Pill tone="warn">rate needed</Pill>
          ) : (
            <Pill tone="ok">Ready</Pill>
          )}
          {line.customer_product_overlay ? <Pill tone="info">customer item</Pill> : null}
          {artworkPill ? <Pill tone={artworkPill.tone}>{artworkPill.text}</Pill> : null}
        </div>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-2 sm:grid sm:justify-items-end sm:text-right">
        <div>
          <div
            className={cn(
              "text-[24px] font-semibold leading-none tabular-nums tracking-[-0.025em]",
              lineTotal > 0 ? "text-content-1" : "text-content-4",
            )}
          >
            {lineTotal > 0 ? `₹${Math.round(lineTotal).toLocaleString("en-IN")}` : "₹ —"}
          </div>
          <div className="mt-1 text-[12.5px] tabular-nums text-content-3">
            {line.qty_value > 0 ? `${Number(line.qty_value).toLocaleString("en-IN")} ${line.qty_uom.toLowerCase()}` : "no quantity"}
            {(parseFloat(line.unit_price || "0") || 0) > 0 ? ` × ₹${line.unit_price} / ${line.price_basis.toLowerCase()}` : " · rate pending"}
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <Button
            variant={isActive ? "outline" : "ghost"}
            size="sm"
            onClick={onToggle}
            className="h-8 gap-1 rounded-[9px] text-[12.5px]"
            aria-label={isActive ? `Close line ${index + 1}` : `Expand line ${index + 1}`}
          >
            <Pencil className="h-3.5 w-3.5" />
            {isActive ? "Done" : "Edit"}
          </Button>
          <Button variant="ghost" size="sm" onClick={onDuplicate} className="h-8 gap-1 rounded-[9px] text-[12.5px] text-content-2">
            <Copy className="h-3.5 w-3.5" /> Duplicate
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onRemove}
            className="h-8 gap-1 rounded-[9px] text-[12.5px] text-danger-fg hover:bg-danger-bg hover:text-danger-fg"
          >
            <Trash2 className="h-3.5 w-3.5" /> Remove
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Spec plate for a closed line, built from the master, the picked size and the layer choices. */
function ClosedLinePlate({ line, master, onOpen }: { line: SalesOrderLine; master?: ProductMaster; onOpen: () => void }) {
  const { data: sizes = [] } = useQuery({
    queryKey: ["product-master-sizes", line.product_master],
    queryFn: () => productMasterService.listSizes(line.product_master),
    enabled: !!line.product_master,
    staleTime: 60_000,
  });
  const size = sizes.find((row) => row.code === line.size_code);
  const data = master
    ? specFromMasterLine({ layers: master.layer_template, size, choices: line.layer_values })
    : null;
  const facts = [
    { label: "Size code", value: line.size_code || "" },
    {
      label: "Print",
      value: master?.fixed_attributes?.print_capable
        ? [line.print_type, line.artwork_assignment?.design_family_code || (line.artwork_mode === "DEFER" ? "artwork later" : "")]
            .filter(Boolean)
            .join(" · ")
        : master
          ? "plain"
          : "",
    },
    { label: "Lanes", value: line.preferred_lane_count ? `${line.preferred_lane_count}-up` : "" },
    { label: "Add-ons", value: line.addons.length ? line.addons.join(", ") : "" },
    { label: "Packing note", value: line.remarks || "" },
  ];
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
      className="block w-full cursor-pointer rounded-b-[18px] px-4 pb-4 pt-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:px-5"
      aria-label="Open this line"
    >
      <SpecPlate data={data} size="md" facts={facts} testId={`sales-line-plate-${line.id}`} emptyText="Open this line to pick a product master." />
    </div>
  );
}

"use client";

/**
 * Sales Order Create — line-tab workbench.
 *
 * Matches mockups/sales-order-create-redesign.html: a light row of line-tab
 * chips, then a slim active-line toolbar (duplicate / remove), then the full
 * LineEditor workspace (8 section cards + live preview rail).
 */

import * as React from "react";
import { AlertCircle, Package, Plus, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { LineEditor } from "./line-editor";
import type { SalesOrderLine, SalesOrderDraft } from "./types";
import type { ProductMaster } from "@/services/product-master";

const LINE_TABLE_GRID =
  "grid-cols-[52px_minmax(250px,1.35fr)_minmax(300px,1.5fr)_142px_120px_126px_132px]";

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
      <div className="overflow-hidden rounded-[18px] border border-line bg-surface-1 shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <div>
            <div className="text-sm font-black text-content-1">Lines</div>
            <div className="text-[11px] font-semibold text-content-3">
              The same label carries into planner, WCM, packing and dispatch.
            </div>
          </div>
        </div>
        <div className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="rounded-2xl border border-dashed border-order-border bg-gradient-to-br from-surface-1 via-info-bg to-order-bg p-8 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-order-bg ring-1 ring-order-border">
              <ShoppingBag className="h-7 w-7 text-order-fg" />
            </div>
            <div className="mt-4 text-base font-black text-content-1">
              Start the first production line
            </div>
            <p className="mt-1 text-sm text-content-3">
              Pick quantity and price first, then choose an order-ready Product
              Master and its allowed axes.
            </p>
            <Button
              onClick={onAddLine}
              className="mt-5 gap-1.5 rounded-xl bg-primary text-white shadow-lg hover:bg-primary/90"
              disabled={!draft.customer}
            >
              <Plus className="h-4 w-4" />
              {draft.customer ? "Add line" : "Pick customer first"}
            </Button>
          </div>
          <div className="rounded-2xl border border-info-border bg-info-bg p-5">
            <div className="flex h-full flex-col items-center justify-center text-center">
              <span className="grid h-12 w-12 place-items-center rounded-2xl bg-surface-1 text-primary ring-1 ring-info-border">
                <Package className="h-6 w-6" />
              </span>
              <div className="mt-3 text-sm font-black text-content-1">
                Live BOM preview
              </div>
              <div className="mt-1 max-w-[240px] text-xs font-semibold leading-5 text-content-3">
                Film, ink, add-ons, POD and packing evidence appears as soon as
                the line has a master and axes.
              </div>
            </div>
          </div>
        </div>
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
      <div className="overflow-hidden rounded-[16px] border border-line bg-surface-1 shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
          <div>
            <div className="text-sm font-black text-content-1">Lines</div>
            <div className="text-[11px] font-semibold text-content-3">
              The same label carries into planner, WCM, packing and dispatch.
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onAddLine}
              className="h-8 rounded-lg border-line text-[11px] font-bold"
            >
              <Plus className="h-3.5 w-3.5" /> Add line
            </Button>
            {activeLine ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => onDuplicateLine(activeLine.id)}
                className="h-8 rounded-lg border-line text-[11px] font-bold"
              >
                Duplicate
              </Button>
            ) : null}
          </div>
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[1120px]">
            <div
              className={cn(
                "grid bg-surface-2 text-[10px] font-black uppercase tracking-[0.14em] text-content-4",
                LINE_TABLE_GRID,
              )}
            >
              <LineHeaderCell first>#</LineHeaderCell>
              <LineHeaderCell>Line label</LineHeaderCell>
              <LineHeaderCell>Spec spine</LineHeaderCell>
              <LineHeaderCell>Artwork</LineHeaderCell>
              <LineHeaderCell>Qty</LineHeaderCell>
              <LineHeaderCell>Total</LineHeaderCell>
              <LineHeaderCell>Status</LineHeaderCell>
            </div>
            {draft.lines.map((line, idx) => {
              const master = masters.find(
                (item) => item.id === line.product_master,
              );
              const issues = perLineIssues[line.id] || [];
              const isActive = line.id === activeLine?.id;
              const status = issues.length ? "Blocked" : "Ready";
              const lineTotal =
                line.qty_value * (parseFloat(line.unit_price || "0") || 0);
              return (
                <button
                  key={line.id}
                  type="button"
                  onClick={() => onExpandLine(line.id)}
                  className={cn(
                    "grid w-full items-stretch border-t border-line text-left transition",
                    LINE_TABLE_GRID,
                    isActive
                      ? "bg-warning-bg/65 shadow-[inset_4px_0_0_var(--warning)]"
                      : "bg-surface-1 hover:bg-info-bg/60",
                  )}
                >
                  <LineCell first isActive={isActive}>
                    <span
                      className={cn(
                        "grid h-7 w-7 place-items-center rounded-lg text-[12px] font-black",
                        isActive
                          ? "bg-primary text-white"
                          : "bg-surface-2 text-content-3 ring-1 ring-line",
                      )}
                    >
                      {idx + 1}
                    </span>
                  </LineCell>
                  <LineCell isActive={isActive}>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-black text-content-1">
                        {line.line_label || master?.name || "New sales product"}
                      </div>
                      <div className="truncate font-mono text-[10px] font-bold text-content-3">
                        {master?.code || "Pick Product Master"}
                      </div>
                    </div>
                  </LineCell>
                  <LineCell isActive={isActive}>
                    <SpecSpine line={line} master={master} />
                  </LineCell>
                  <LineCell isActive={isActive}>
                    <span
                      className={cn(
                        "inline-flex rounded-full px-2 py-1 text-[10px] font-black ring-1",
                        line.artwork_mode === "DEFER"
                          ? "bg-warning-bg text-warning-fg ring-warning-border"
                          : line.artwork_assignment?.artwork_id
                            ? "bg-success-bg text-success-fg ring-success-border"
                            : "bg-surface-2 text-content-3 ring-line",
                      )}
                    >
                      {line.artwork_mode === "DEFER"
                        ? "Defer"
                        : line.artwork_assignment?.artwork_id
                          ? "Artwork set"
                          : "Not print-capable"}
                    </span>
                  </LineCell>
                  <LineCell isActive={isActive}>
                    <span className="font-mono text-sm font-black text-content-1">
                      {line.qty_value > 0
                        ? `${Number(line.qty_value).toLocaleString()} ${line.qty_uom}`
                        : "—"}
                    </span>
                  </LineCell>
                  <LineCell isActive={isActive}>
                    <span className="font-mono text-sm font-black text-content-1">
                      {lineTotal > 0
                        ? `₹${Math.round(lineTotal).toLocaleString("en-IN")}`
                        : "—"}
                    </span>
                  </LineCell>
                  <LineCell isActive={isActive}>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-black ring-1",
                        issues.length
                          ? "bg-danger-bg text-danger-fg ring-danger-border"
                          : "bg-success-bg text-success-fg ring-success-border",
                      )}
                    >
                      {issues.length ? (
                        <AlertCircle className="h-3 w-3" />
                      ) : null}
                      {status}
                    </span>
                  </LineCell>
                </button>
              );
            })}
          </div>
        </div>
        <div className="border-t border-line px-4 py-2 text-right text-[11px] font-bold text-content-4">
          {draft.lines.length} line{draft.lines.length === 1 ? "" : "s"}
          {totalKg > 0 ? ` · ${totalKg.toLocaleString()} KG` : ""} · sends to
          planner
        </div>
      </div>

      {/* Active line */}
      {activeLine ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-[18px] border border-line bg-surface-1 px-4 py-2.5 shadow-sm">
            <div className="min-w-0">
              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-order-fg">
                Line {activeIndex + 1} · build
              </div>
              <div className="truncate text-sm font-black text-content-1">
                {activeLine.line_label ||
                  activeMaster?.name ||
                  "Enter qty, price, order-ready Product Master, axes, artwork and packing"}
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

function LineHeaderCell({
  children,
  first = false,
}: {
  children: React.ReactNode;
  first?: boolean;
}) {
  return (
    <div
      className={cn(
        "min-w-0 px-3 py-2",
        !first && "border-l border-line",
      )}
    >
      {children}
    </div>
  );
}

function LineCell({
  children,
  first = false,
  isActive = false,
}: {
  children: React.ReactNode;
  first?: boolean;
  isActive?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-center px-3 py-3",
        !first && (isActive ? "border-l border-warning-border" : "border-l border-line"),
      )}
    >
      {children}
    </div>
  );
}

function SpecSpine({
  line,
  master,
}: {
  line: SalesOrderLine;
  master?: ProductMaster;
}) {
  const tokens: Array<{ label: string; tone: "blue" | "green" | "violet" | "amber" | "slate" }> = [];
  if (line.size_code) tokens.push({ label: line.size_code, tone: "blue" });
  const layers = (master?.layer_template || [])
    .map((row, index) => {
      const state = line.layer_values?.[index + 1] || {};
      const film = state.film_variant_code || row.film_variant_code;
      const grade = state.grade || row.default_grade;
      return [film, grade].filter(Boolean).join(" ");
    })
    .filter(Boolean);
  if (layers.length) tokens.push({ label: layers.join("/"), tone: "green" });
  if (line.addons.length) tokens.push({ label: line.addons.join("+"), tone: "violet" });
  const pod = line.axis_values?.pod_variant || line.axis_values?.pod;
  if (pod) tokens.push({ label: String(pod), tone: "amber" });
  const inner = line.axis_values?.packaging_inner;
  if (inner) tokens.push({ label: String(inner), tone: "slate" });

  if (!tokens.length) {
    return (
      <div className="text-[11px] font-semibold text-content-4">
        Pick Product Master axes
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-wrap gap-1.5">
      {tokens.slice(0, 5).map((token) => (
        <span
          key={`${token.tone}-${token.label}`}
          className={cn(
            "max-w-[180px] truncate rounded-full px-2 py-1 font-mono text-[10px] font-black ring-1",
            token.tone === "blue" &&
              "bg-info-bg text-primary ring-info-border",
            token.tone === "green" &&
              "bg-success-bg text-success-fg ring-success-border",
            token.tone === "violet" &&
              "bg-order-bg text-order-fg ring-order-border",
            token.tone === "amber" &&
              "bg-warning-bg text-warning-fg ring-warning-border",
            token.tone === "slate" &&
              "bg-surface-2 text-content-2 ring-line",
          )}
        >
          {token.label}
        </span>
      ))}
    </div>
  );
}

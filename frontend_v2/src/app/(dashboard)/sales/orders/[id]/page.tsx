"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Clock,
  Factory,
  FileText,
  GitBranch,
  GitMerge,
  Layers,
  Loader2,
  Lock,
  Package,
  PackageCheck,
  Route,
  ShieldCheck,
  Truck,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusBadge } from "@/components/ui-custom/status-badge";
import { formatDisplayDate } from "@/lib/date-format";
import { cn } from "@/lib/utils";
import { analyticsApi, type OrderTrackingResponse } from "@/services/analytics";
import { salesService, type SalesOrder, type SalesOrderLine } from "@/services/sales";

const LINE_PROGRESS_TONES = [
  { fill: "#2563eb", bg: "rgba(37,99,235,.14)", text: "text-primary", border: "border-info-border" },
  { fill: "#10b981", bg: "rgba(16,185,129,.14)", text: "text-success-fg", border: "border-success-border" },
  { fill: "#7c3aed", bg: "rgba(124,58,237,.13)", text: "text-order-fg", border: "border-order-border" },
  { fill: "#f59e0b", bg: "rgba(245,158,11,.16)", text: "text-warning-fg", border: "border-warning-border" },
  { fill: "#ef4444", bg: "rgba(239,68,68,.12)", text: "text-danger-fg", border: "border-danger-border" },
  { fill: "#0891b2", bg: "rgba(8,145,178,.13)", text: "text-primary", border: "border-info-border" },
];

function safeNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function fmtKg(value: unknown, digits = 1): string {
  return safeNumber(value).toLocaleString("en-IN", { maximumFractionDigits: digits });
}

function fmtQty(value: unknown): string {
  return safeNumber(value).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function fmtDate(value?: string | null): string {
  if (!value) return "--";
  return formatDisplayDate(value);
}

function percent(done: number, target: number): number {
  if (!Number.isFinite(target) || target <= 0) return 0;
  return Math.max(0, Math.min(100, (done / target) * 100));
}

function flowBandMetrics({
  orderedKg,
  producedKg,
  packedKg,
  dispatchedKg,
}: {
  orderedKg: number;
  producedKg: number;
  packedKg: number;
  dispatchedKg: number;
}) {
  const bounded = (value: number) => Math.max(0, Math.min(orderedKg, value));
  const dispatched = bounded(dispatchedKg);
  const packed = Math.max(0, bounded(packedKg) - dispatched);
  const produced = Math.max(0, bounded(producedKg) - Math.max(bounded(packedKg), dispatched));
  const covered = Math.max(bounded(producedKg), bounded(packedKg), dispatched);
  return {
    dispatchedPct: orderedKg > 0 ? (dispatched / orderedKg) * 100 : 0,
    packedPct: orderedKg > 0 ? (packed / orderedKg) * 100 : 0,
    producedPct: orderedKg > 0 ? (produced / orderedKg) * 100 : 0,
    completePct: orderedKg > 0 ? (covered / orderedKg) * 100 : 0,
    openKg: Math.max(0, orderedKg - covered),
  };
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, any>) : {};
}

function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function lineLabel(line: any, index: number): string {
  return (
    String(line?.line_name || "").trim() ||
    String(line?.product_master_code || line?.product_master_name || "").trim() ||
    String(line?.template_name || "").trim() ||
    `Line ${index + 1}`
  );
}

function lineOrderedKg(line: any): number {
  const explicit = safeNumber(line?.total_weight_kg);
  if (explicit > 0) return explicit;
  const qty = safeNumber(line?.qty_value);
  const uom = String(line?.qty_uom || line?.uom || "").toUpperCase();
  if (uom === "KG") return qty;
  const unitWeight = safeNumber(line?.unit_weight_g);
  if (uom === "PCS" && unitWeight > 0) return (qty * unitWeight) / 1000;
  return qty;
}

function batchRows(line: any): any[] {
  return asArray(line?.production_batch_summary?.batches);
}

function lineMetrics(line: any) {
  const batches = batchRows(line);
  const orderedKg = lineOrderedKg(line);
  const producedKg =
    safeNumber(line?.production_batch_summary?.produced_kg) ||
    batches.reduce((sum, batch) => sum + safeNumber(batch?.produced_qty_kg), 0) ||
    safeNumber(line?.qty_final_output);
  const packedKg =
    batches.reduce((sum, batch) => sum + safeNumber(batch?.packed_qty_kg), 0) ||
    safeNumber(line?.qty_dispatchable);
  const dispatchedKg =
    safeNumber(line?.production_batch_summary?.dispatched_kg) ||
    batches.reduce((sum, batch) => sum + safeNumber(batch?.dispatched_qty_kg), 0) ||
    safeNumber(line?.qty_dispatched);
  return {
    orderedKg,
    producedKg,
    packedKg,
    dispatchedKg,
    openKg: flowBandMetrics({ orderedKg, producedKg, packedKg, dispatchedKg }).openKg,
    completionPct: flowBandMetrics({ orderedKg, producedKg, packedKg, dispatchedKg }).completePct,
    batches,
  };
}

function orderMetrics(order: SalesOrder, tracking?: OrderTrackingResponse) {
  const items = order.items || [];
  const fallbackOrdered = items.reduce((sum, line) => sum + lineOrderedKg(line), 0) || safeNumber(order.total_weight_kg);
  const kpi = (tracking?.kpi_snapshot || {}) as Record<string, any>;
  return {
    orderedKg: safeNumber(kpi.ordered_kg) || fallbackOrdered,
    producedKg: safeNumber(kpi.produced_kg) || safeNumber(order.fulfillment_summary?.produced_kg),
    packedKg: safeNumber(kpi.packed_kg),
    dispatchedKg: safeNumber(kpi.dispatched_kg) || safeNumber(order.fulfillment_summary?.dispatched_kg),
    dispatchableKg: safeNumber(kpi.dispatchable_kg),
    scrapKg: safeNumber(kpi.scrap_kg),
    activeJobs: safeNumber(kpi.active_jobs) || (tracking?.active_jobs || []).length,
    completedJobs: safeNumber(kpi.completed_jobs) || (tracking?.completed_jobs || []).length,
    wipKg: safeNumber(kpi.wip_kg),
    fgKg: safeNumber(kpi.fg_kg),
  };
}

function jobsForLine(tracking: OrderTrackingResponse | undefined, line: any): any[] {
  const lineId = String(line?.id || "").trim();
  if (!lineId) return [];
  return (tracking?.job_steps || []).filter((job) => String((job as any).sales_order_item_id || "") === lineId);
}

function routeNodesForLine(line: any, jobs: any[]) {
  const batches = batchRows(line);
  const graphBatch = batches.find((batch) => Array.isArray(batch?.route_graph?.nodes) && batch.route_graph.nodes.length);
  const nodes = asArray(graphBatch?.route_graph?.nodes)
    .map((node) => asRecord(node))
    .sort((a, b) => safeNumber(a.route_index) - safeNumber(b.route_index));
  if (nodes.length) {
    const activeNodeId = String(graphBatch?.current_route_node_id || "").trim();
    const activeIndex = safeNumber(graphBatch?.current_step_index);
    return nodes.map((node) => ({
      id: String(node.id || node.process_code || node.label || ""),
      label: String(node.label || node.process_code || "Step"),
      branch: String(node.branch_key || "MAIN"),
      join: String(node.join_key || ""),
      parallel: String(node.parallel_group || ""),
      active: activeNodeId ? activeNodeId === String(node.id || "") : safeNumber(node.route_index) === activeIndex,
      done: safeNumber(node.route_index) < activeIndex,
    }));
  }
  return jobs.map((job) => ({
    id: String((job as any).route_node_id || job.job_id),
    label: String((job as any).route_node?.route_node_label || job.step_name || job.process_code || "Step"),
    branch: String((job as any).route_branch_key || (job as any).route_node?.route_branch_key || "MAIN"),
    join: String((job as any).route_node?.join_key || ""),
    parallel: String((job as any).route_node?.parallel_group || ""),
    active: !["COMPLETED", "CANCELLED"].includes(String(job.state || "").toUpperCase()),
    done: String(job.state || "").toUpperCase() === "COMPLETED",
  }));
}

function geometrySummary(line: any) {
  const geometry = asRecord(line?.geometry_snapshot);
  const base = asRecord(geometry.base);
  return {
    width: base.width_mm ?? geometry.width_mm ?? geometry.roll_width_mm ?? geometry.final_web_width_mm,
    height: base.height_mm ?? geometry.height_mm,
    gusset: base.gusset_mm ?? geometry.gusset_mm,
    rollWidth: geometry.final_web_width_mm ?? geometry.roll_width_mm,
    style: geometry.pouch_style || geometry.pouch_style_code || geometry.roll_form,
  };
}

function bomComponents(line: any): any[] {
  return asArray(line?.bom_snapshot?.components || line?.bom_snapshot?.materials || line?.material_plan_summary?.components);
}

function lineSpecChips(line: any): Array<{ label: string; tone: "slate" | "blue" | "green" | "amber" | "violet" }> {
  const geometry = geometrySummary(line);
  const layers = asArray(line?.layer_snapshot?.layers || line?.layer_snapshot || line?.bom_snapshot?.layers);
  const chips = [
    { label: String(line?.product_master_code || line?.product_master_name || "").trim(), tone: "violet" as const },
    { label: String(line?.template_name || "").trim(), tone: "slate" as const },
    { label: geometry.style ? `Style ${geometry.style}` : "", tone: "blue" as const },
    { label: geometry.rollWidth ? `Web ${fmtQty(geometry.rollWidth)} mm` : "", tone: "green" as const },
    { label: geometry.width ? `Width ${fmtQty(geometry.width)} mm` : "", tone: "blue" as const },
    { label: geometry.height ? `Height ${fmtQty(geometry.height)} mm` : "", tone: "blue" as const },
    { label: layers.length ? `${layers.length} layer${layers.length === 1 ? "" : "s"}` : "", tone: "amber" as const },
  ].filter((chip) => chip.label);
  return chips.slice(0, 8);
}

function LineSpecChips({ line }: { line: any }) {
  const toneClass = {
    slate: "border-line bg-surface-2 text-content-2",
    blue: "border-info-border bg-info-bg text-primary",
    green: "border-success-border bg-success-bg text-success-fg",
    amber: "border-warning-border bg-warning-bg text-warning-fg",
    violet: "border-order-border bg-order-bg text-order-fg",
  };
  const chips = lineSpecChips(line);
  if (!chips.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {chips.map((chip, index) => (
        <span
          key={`${chip.label}-${index}`}
          className={cn(
            "inline-flex max-w-full items-center truncate rounded-lg border px-2.5 py-1 text-[10px] font-black uppercase tracking-wide",
            toneClass[chip.tone],
          )}
        >
          {chip.label}
        </span>
      ))}
    </div>
  );
}

function ProgressLegend({
  orderedKg,
  producedKg,
  packedKg,
  dispatchedKg,
}: {
  orderedKg: number;
  producedKg: number;
  packedKg: number;
  dispatchedKg: number;
}) {
  const openKg = flowBandMetrics({ orderedKg, producedKg, packedKg, dispatchedKg }).openKg;
  const rows = [
    { label: "Ordered", value: orderedKg, className: "text-content-1" },
    { label: "Produced", value: producedKg, className: "text-primary" },
    { label: "Ready", value: packedKg, className: "text-order-fg" },
    { label: "Dispatched", value: dispatchedKg, className: "text-success-fg" },
    { label: "WIP/open", value: openKg, className: "text-content-3" },
  ];
  return (
    <div className="mt-3 grid grid-cols-2 gap-2 text-[10px] sm:grid-cols-5">
      {rows.map((row) => (
        <div key={row.label} className="rounded-lg border border-line bg-surface-1 px-2.5 py-2">
          <div className="font-black uppercase tracking-wide text-content-4">{row.label}</div>
          <div className={cn("mt-0.5 font-mono text-[12px] font-black", row.className)}>{fmtKg(row.value)} kg</div>
        </div>
      ))}
    </div>
  );
}

function LineColorIcon({ index, className }: { index: number; className?: string }) {
  const tone = LINE_PROGRESS_TONES[index % LINE_PROGRESS_TONES.length];
  return (
    <span
      className={cn("inline-flex h-4 w-4 flex-none items-center justify-center rounded-full text-[8px] font-black text-white shadow-sm ring-1 ring-white/70", className)}
      style={{ background: tone.fill }}
      title={`Line ${index + 1}`}
    >
      {index + 1}
    </span>
  );
}

function lineRouteCompletionPercent(line: any): number {
  const batches = batchRows(line);
  const percents = batches
    .map((batch) => {
      const graph = asRecord(batch?.route_graph);
      const nodes = asArray(graph.nodes)
        .map((node) => asRecord(node))
        .sort((a, b) => safeNumber(a.route_index) - safeNumber(b.route_index));
      if (!nodes.length) return 0;
      const status = String(batch?.status || "").trim().toUpperCase();
      if (["COMPLETED", "PACKED", "DISPATCHED", "CLOSED"].some((token) => status.includes(token))) return 100;
      const currentNodeId = String(batch?.current_route_node_id || "").trim();
      const currentIndex = safeNumber(batch?.current_step_index);
      let activePosition = currentNodeId
        ? nodes.findIndex((node) => String(node.id || "").trim() === currentNodeId)
        : -1;
      if (activePosition < 0 && Number.isFinite(currentIndex)) {
        activePosition = nodes.findIndex((node) => safeNumber(node.route_index) === currentIndex);
      }
      if (activePosition < 0) return 0;
      const liveCredit = status === "PLANNED" ? 0.15 : 0.5;
      return Math.max(0, Math.min(100, ((activePosition + liveCredit) / nodes.length) * 100));
    })
    .filter((value) => value > 0);
  if (!percents.length) return 0;
  return percents.reduce((sum, value) => sum + value, 0) / percents.length;
}

function LineContributionBar({ lines }: { lines: SalesOrderLine[] }) {
  const rows = lines
    .map((line, index) => {
      const metrics = lineMetrics(line);
      return {
        line,
        index,
        metrics,
        progressPct: Math.max(metrics.completionPct, lineRouteCompletionPercent(line)),
      };
    })
    .filter((row) => row.metrics.orderedKg > 0);
  const totalKg = rows.reduce((sum, row) => sum + row.metrics.orderedKg, 0);
  if (!rows.length || totalKg <= 0) return null;
  return (
    <div className="mt-4">
      <div className="mb-1 flex items-center justify-between text-[10px] font-black uppercase tracking-[0.16em] text-content-4">
        <span>Line-wise route completion</span>
        <span>{rows.length} commercial line{rows.length === 1 ? "" : "s"}</span>
      </div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface-2 ring-1 ring-line">
        {rows.map((row) => {
          const tone = LINE_PROGRESS_TONES[row.index % LINE_PROGRESS_TONES.length];
          const segmentPct = Math.max(3, (row.metrics.orderedKg / totalKg) * 100);
          return (
            <div
              key={row.line.id || row.index}
              className="h-full overflow-hidden"
              style={{ width: `${segmentPct}%`, background: tone.bg }}
              title={`${lineLabel(row.line, row.index)} · ${fmtKg(row.metrics.orderedKg)} KG · ${Math.round(row.progressPct)}% route/live complete`}
            >
              <div className="h-full" style={{ width: `${row.progressPct}%`, background: tone.fill }} />
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {rows.slice(0, 8).map((row) => {
          const tone = LINE_PROGRESS_TONES[row.index % LINE_PROGRESS_TONES.length];
          return (
            <span
              key={row.line.id || row.index}
              className={cn(
                "inline-flex items-center gap-1 rounded-md border bg-surface-1 px-2 py-1 text-[10px] font-black uppercase tracking-wide",
                tone.text,
                tone.border,
              )}
            >
              <LineColorIcon index={row.index} />
              L{row.index + 1} · {fmtKg(row.metrics.orderedKg)} KG · {Math.round(row.progressPct)}%
            </span>
          );
        })}
      </div>
    </div>
  );
}

function MetricTile({
  label,
  value,
  sub,
  tone = "slate",
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "slate" | "blue" | "green" | "amber" | "rose";
  icon: ReactNode;
}) {
  const toneClass =
    tone === "blue"
      ? "bg-info-bg text-primary ring-info-border"
      : tone === "green"
        ? "bg-success-bg text-success-fg ring-success-border"
        : tone === "amber"
          ? "bg-warning-bg text-warning-fg ring-warning-border"
          : tone === "rose"
            ? "bg-danger-bg text-danger-fg ring-danger-border"
            : "bg-surface-2 text-content-2 ring-line";
  return (
    <div className="rounded-xl border border-line bg-surface-1 p-4 shadow-sm">
      <div className={cn("mb-3 flex h-9 w-9 items-center justify-center rounded-lg ring-1", toneClass)}>
        {icon}
      </div>
      <div className="text-[10px] font-black uppercase tracking-[0.18em] text-content-4">{label}</div>
      <div className="mt-1 font-mono text-xl font-black text-content-1">{value}</div>
      {sub ? <div className="mt-1 text-[11px] font-semibold text-content-3">{sub}</div> : null}
    </div>
  );
}

function ProgressBar({
  orderedKg,
  producedKg,
  packedKg,
  dispatchedKg,
}: {
  orderedKg: number;
  producedKg: number;
  packedKg: number;
  dispatchedKg: number;
}) {
  const bands = flowBandMetrics({ orderedKg, producedKg, packedKg, dispatchedKg });
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[10px] font-black uppercase tracking-[0.16em] text-content-4">
        <span>Produced / ready / dispatched</span>
        <span>{Math.round(bands.completePct)}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-info-bg ring-1 ring-line">
        <div className="flex h-full">
          <div className="bg-success-fg" style={{ width: `${bands.dispatchedPct}%` }} />
          <div className="bg-order-fg" style={{ width: `${bands.packedPct}%` }} />
          <div className="bg-primary" style={{ width: `${bands.producedPct}%` }} />
        </div>
      </div>
    </div>
  );
}

function RouteStrip({ line, jobs }: { line: SalesOrderLine; jobs: any[] }) {
  const nodes = routeNodesForLine(line, jobs);
  if (!nodes.length) {
    return <div className="rounded-lg border border-dashed border-line bg-surface-2 px-3 py-2 text-[11px] font-semibold text-content-3">Route not released yet.</div>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {nodes.map((node, index) => (
        <span
          key={`${node.id}-${index}`}
          className={cn(
            "inline-flex max-w-[180px] items-center gap-1 truncate rounded-lg border px-2.5 py-1.5 text-[10px] font-black uppercase tracking-wide",
            node.active
              ? "border-info-border bg-info-bg text-primary"
              : node.done
                ? "border-success-border bg-success-bg text-success-fg"
                : "border-line bg-surface-2 text-content-3",
          )}
          title={[node.label, node.branch, node.parallel, node.join].filter(Boolean).join(" · ")}
        >
          {index > 0 ? <span className="text-content-4">-&gt;</span> : null}
          {node.parallel ? <GitBranch className="h-3 w-3" /> : null}
          {node.join ? <GitMerge className="h-3 w-3" /> : null}
          <span className="truncate">{node.label}</span>
        </span>
      ))}
    </div>
  );
}

function LineTrackerCard({
  line,
  index,
  tracking,
}: {
  line: SalesOrderLine;
  index: number;
  tracking?: OrderTrackingResponse;
}) {
  const metrics = lineMetrics(line);
  const jobs = jobsForLine(tracking, line);
  const batches = metrics.batches;
  const activeJobs = jobs.filter((job) => !["COMPLETED", "CANCELLED"].includes(String(job.state || "").toUpperCase()));
  return (
    <Card className="overflow-hidden rounded-xl border-line bg-surface-1 shadow-sm">
      <CardContent className="p-0">
        <div className="grid gap-0 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,.85fr)]">
          <div className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="font-mono text-sm font-black text-content-1">{lineLabel(line, index)}</div>
                  <Badge variant="outline" className="rounded-full text-[10px] font-black uppercase">
                    {line.line_status_display || line.line_status || "Line"}
                  </Badge>
                  {batches.length ? (
                    <Badge className="rounded-full bg-info-bg text-primary ring-1 ring-info-border">
                      {batches.length} batch{batches.length === 1 ? "" : "es"}
                    </Badge>
                  ) : null}
                </div>
                <div className="mt-1 text-xs font-semibold text-content-3">
                  {line.template_name || line.product_master_name || "Template"} · {fmtKg(metrics.orderedKg)} KG target
                </div>
                <LineSpecChips line={line} />
              </div>
              <div className="text-right">
                <div className="font-mono text-lg font-black text-content-1">{Math.round(metrics.completionPct)}%</div>
                <div className="text-[10px] font-black uppercase tracking-wide text-content-4">complete</div>
              </div>
            </div>
            <div className="mt-4">
              <ProgressBar
                orderedKg={metrics.orderedKg}
                producedKg={metrics.producedKg}
                packedKg={metrics.packedKg}
                dispatchedKg={metrics.dispatchedKg}
              />
            </div>
            <div className="mt-4">
              <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-content-4">
                <Route className="h-3.5 w-3.5" /> Route and stage flow
              </div>
              <RouteStrip line={line} jobs={jobs} />
            </div>
            {jobs.length ? (
              <div className="mt-4 grid gap-2">
                {jobs.slice(0, 6).map((job) => (
                  <div key={job.job_id} className="grid gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-[11px] md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                    <div className="min-w-0">
                      <div className="truncate font-mono font-black text-content-1">{job.job_number}</div>
                      <div className="truncate text-content-3">
                        {job.step_name || job.process_code || "Step"} · {job.work_center || "WC pending"} · {job.production_batch_number || "batch pending"}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="rounded-full text-[9px] font-black uppercase">
                        {String(job.state || "").replace(/_/g, " ")}
                      </Badge>
                      <span className="font-mono text-[10px] font-black text-content-2">{fmtKg(job.produced_kg)} KG</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <div className="border-t border-line bg-surface-2 p-5 xl:border-l xl:border-t-0">
            <div className="grid grid-cols-2 gap-2">
              <MiniStat label="Ordered" value={`${fmtKg(metrics.orderedKg)} KG`} />
              <MiniStat label="Produced" value={`${fmtKg(metrics.producedKg)} KG`} />
              <MiniStat label="Packed" value={`${fmtKg(metrics.packedKg)} KG`} />
              <MiniStat label="Dispatched" value={`${fmtKg(metrics.dispatchedKg)} KG`} />
              <MiniStat label="Open" value={`${fmtKg(metrics.openKg)} KG`} />
              <MiniStat label="Live jobs" value={String(activeJobs.length)} />
            </div>
            <div className="mt-4 space-y-2">
              <div className="text-[10px] font-black uppercase tracking-[0.16em] text-content-4">Batch/lots</div>
              {batches.length ? (
                batches.slice(0, 6).map((batch) => (
                  <div key={batch.id || batch.batch_number} className="rounded-lg border border-line bg-surface-1 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-mono text-[11px] font-black text-content-1">{batch.batch_number}</span>
                      <Badge variant="outline" className="rounded-full text-[8px] font-black uppercase">
                        {String(batch.status || "PLANNED").replace(/_/g, " ")}
                      </Badge>
                    </div>
                    <div className="mt-1 truncate text-[10px] font-semibold text-content-3">
                      {batch.current_route_node_label || batch.current_route_process_code || "Route pending"} · {batch.current_route_branch_key || "MAIN"}
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-lg border border-dashed border-line bg-surface-1 px-3 py-4 text-center text-[11px] font-semibold text-content-3">
                  Not released into production yet.
                </div>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface-1 px-3 py-2">
      <div className="text-[9px] font-black uppercase tracking-wide text-content-4">{label}</div>
      <div className="mt-1 font-mono text-sm font-black text-content-1">{value}</div>
    </div>
  );
}

function TechnicalLine({ line, index }: { line: SalesOrderLine; index: number }) {
  const geometry = geometrySummary(line);
  const components = bomComponents(line);
  return (
    <Card className="rounded-xl border-line bg-surface-1 shadow-sm">
      <CardContent className="p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-mono text-sm font-black text-content-1">{lineLabel(line, index)}</div>
            <div className="mt-1 text-xs font-semibold text-content-3">{line.template_name || "Technical snapshot"}</div>
            <LineSpecChips line={line} />
          </div>
          <Badge variant="outline" className="rounded-full text-[10px] font-black uppercase">
            {line.qty_value} {line.qty_uom}
          </Badge>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-line bg-surface-2 p-4">
            <div className="mb-3 flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.16em] text-content-4">
              <Package className="h-4 w-4 text-primary" /> Product geometry
            </div>
            <div className="grid grid-cols-2 gap-2">
              <MiniStat label="Width" value={geometry.width ? `${fmtQty(geometry.width)} mm` : "--"} />
              <MiniStat label="Height" value={geometry.height ? `${fmtQty(geometry.height)} mm` : "--"} />
              <MiniStat label="Gusset" value={geometry.gusset ? `${fmtQty(geometry.gusset)} mm` : "--"} />
              <MiniStat label="Roll web" value={geometry.rollWidth ? `${fmtQty(geometry.rollWidth)} mm` : "--"} />
            </div>
            {geometry.style ? <div className="mt-3 text-xs font-bold text-content-3">Style: {String(geometry.style)}</div> : null}
          </div>
          <div className="rounded-xl border border-line bg-surface-2 p-4">
            <div className="mb-3 flex items-center gap-2 text-[11px] font-black uppercase tracking-[0.16em] text-content-4">
              <Layers className="h-4 w-4 text-primary" /> BOM and materials
            </div>
            {components.length ? (
              <div className="space-y-2">
                {components.slice(0, 8).map((component, cIndex) => (
                  <div key={component.id || component.material_id || cIndex} className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface-1 px-3 py-2 text-xs">
                    <span className="min-w-0 truncate font-bold text-content-2">
                      {component.material_code || component.material_name || component.name || `Material ${cIndex + 1}`}
                    </span>
                    <span className="font-mono font-black text-primary">
                      {component.required_qty || component.qty || component.thickness_micron || "--"}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-line bg-surface-1 px-3 py-8 text-center text-sm font-semibold italic text-content-3">
                No BOM architecture defined on this order snapshot.
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function SalesOrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const id = Array.isArray(params?.id) ? params.id[0] : String(params?.id || "");

  const orderQuery = useQuery({
    queryKey: ["sales-order", id],
    queryFn: () => salesService.getOrder(id),
    enabled: Boolean(id),
  });
  const trackingQuery = useQuery({
    queryKey: ["sales-order-tracking", id],
    queryFn: () => analyticsApi.getOrderTracking(id),
    enabled: Boolean(id),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const confirmMutation = useMutation({
    mutationFn: () => salesService.confirmOrder(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sales-order", id] });
      queryClient.invalidateQueries({ queryKey: ["sales-order-tracking", id] });
    },
  });

  if (orderQuery.isLoading) {
    return (
      <div className="flex h-[70vh] items-center justify-center">
        <div className="text-center">
          <Loader2 className="mx-auto h-10 w-10 animate-spin text-primary" />
          <div className="mt-3 text-[11px] font-black uppercase tracking-[0.22em] text-content-4">Loading sales order</div>
        </div>
      </div>
    );
  }

  const order = orderQuery.data;
  if (orderQuery.error || !order) {
    return (
      <div className="flex h-[70vh] flex-col items-center justify-center text-center">
        <FileText className="mb-4 h-12 w-12 text-danger-fg" />
        <h1 className="text-2xl font-black text-content-1">Sales order not found</h1>
        <Button className="mt-6 rounded-xl" onClick={() => router.back()}>
          Go back
        </Button>
      </div>
    );
  }

  const tracking = trackingQuery.data;
  const metrics = orderMetrics(order, tracking);
  const items = order.items || [];
  const completePct = percent(metrics.producedKg + metrics.dispatchedKg, metrics.orderedKg);
  const docs = [
    { label: "Sales protocol", detail: "Commercial order snapshot", icon: <FileText className="h-5 w-5" /> },
    { label: "Technical sheet", detail: "Geometry, BOM, route, specs", icon: <Layers className="h-5 w-5" /> },
    { label: "Dispatch ledger", detail: "Customer dispatch evidence", icon: <Truck className="h-5 w-5" /> },
  ];

  return (
    <div className="erp-soft-canvas min-h-screen space-y-6 p-5 lg:p-8">
      <section className="rounded-2xl border border-line bg-surface-1 p-5 shadow-sm">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <Button
              variant="ghost"
              size="sm"
              className="mb-3 h-auto p-0 text-content-4 hover:bg-transparent hover:text-content-2"
              onClick={() => router.back()}
            >
              <ArrowLeft className="mr-2 h-4 w-4" /> Back to sales orders
            </Button>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-info-bg px-3 py-1 font-mono text-[10px] font-black uppercase tracking-wider text-primary ring-1 ring-info-border">
                {order.order_number}
              </span>
              <StatusBadge status={order.status} />
              {trackingQuery.isFetching ? (
                <Badge variant="outline" className="rounded-full text-[10px] font-black uppercase">
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" /> refreshing
                </Badge>
              ) : null}
            </div>
            <h1 className="mt-3 truncate text-3xl font-black tracking-tight text-content-1">{order.customer_name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-sm font-semibold text-content-3">
              <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-4 w-4 text-primary" /> Placed {fmtDate(order.created_at)}</span>
              <span className="inline-flex items-center gap-1.5"><Clock className="h-4 w-4 text-primary" /> Due {fmtDate(order.delivery_date)}</span>
              <span>{items.length} line{items.length === 1 ? "" : "s"}</span>
              <span>{fmtKg(metrics.orderedKg)} kg ordered</span>
            </div>
          </div>
          <div className="grid min-w-[300px] gap-3 rounded-xl border border-line bg-surface-2 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.18em] text-content-4">Fulfillment truth</div>
                <div className="mt-1 text-xs font-semibold text-content-3">Live production, packing, and dispatch status</div>
              </div>
              <div className="text-right">
                <div className="font-mono text-2xl font-black text-primary">{Math.round(completePct)}%</div>
                <div className="text-[9px] font-black uppercase tracking-wide text-content-4">complete</div>
              </div>
            </div>
            <ProgressBar
              orderedKg={metrics.orderedKg}
              producedKg={metrics.producedKg}
              packedKg={metrics.packedKg}
              dispatchedKg={metrics.dispatchedKg}
            />
            <ProgressLegend
              orderedKg={metrics.orderedKg}
              producedKg={metrics.producedKg}
              packedKg={metrics.packedKg}
              dispatchedKg={metrics.dispatchedKg}
            />
            <LineContributionBar lines={items} />
            <div className="flex flex-wrap gap-2">
              {order.status === "DRAFT" ? (
                <Button className="rounded-xl bg-primary text-white" onClick={() => confirmMutation.mutate()} disabled={confirmMutation.isPending}>
                  {confirmMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Lock className="mr-2 h-4 w-4" />}
                  Confirm commercial
                </Button>
              ) : null}
              <Button asChild variant="outline" className="rounded-xl">
                <Link href={`/sales/orders/${id}/dispatches`}>
                  <Truck className="mr-2 h-4 w-4" /> Dispatch ledger
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricTile label="Ordered" value={`${fmtKg(metrics.orderedKg)} kg`} sub={`${items.length} commercial line${items.length === 1 ? "" : "s"}`} tone="blue" icon={<Package className="h-5 w-5" />} />
        <MetricTile label="Produced" value={`${fmtKg(metrics.producedKg)} kg`} sub={`${fmtKg(metrics.wipKg)} kg WIP`} tone="green" icon={<Factory className="h-5 w-5" />} />
        <MetricTile label="Dispatchable" value={`${fmtKg(metrics.dispatchableKg)} kg`} sub={`${fmtKg(metrics.fgKg)} kg FG ready`} tone="amber" icon={<PackageCheck className="h-5 w-5" />} />
        <MetricTile label="Live jobs" value={String(metrics.activeJobs)} sub={`${metrics.completedJobs} closed jobs`} tone="slate" icon={<Activity className="h-5 w-5" />} />
      </section>

      <Tabs defaultValue="lines" className="space-y-4">
        <TabsList className="h-auto flex-wrap rounded-xl border border-line bg-surface-1 p-1">
          <TabsTrigger value="lines" className="rounded-lg text-[11px] font-black uppercase tracking-wide">Lines + live route</TabsTrigger>
          <TabsTrigger value="technical" className="rounded-lg text-[11px] font-black uppercase tracking-wide">Technical + BOM</TabsTrigger>
          <TabsTrigger value="documents" className="rounded-lg text-[11px] font-black uppercase tracking-wide">Documents</TabsTrigger>
          <TabsTrigger value="audit" className="rounded-lg text-[11px] font-black uppercase tracking-wide">Audit</TabsTrigger>
        </TabsList>

        <TabsContent value="lines" className="space-y-3">
          {items.map((line, index) => (
            <LineTrackerCard key={line.id || index} line={line} index={index} tracking={tracking} />
          ))}
          {!items.length ? (
            <Card className="rounded-xl border-dashed border-line bg-surface-1">
              <CardContent className="p-8 text-center text-sm font-semibold text-content-3">No sales lines captured.</CardContent>
            </Card>
          ) : null}
        </TabsContent>

        <TabsContent value="technical" className="space-y-3">
          {items.map((line, index) => (
            <TechnicalLine key={line.id || index} line={line} index={index} />
          ))}
        </TabsContent>

        <TabsContent value="documents">
          <div className="grid gap-3 md:grid-cols-3">
            {docs.map((doc) => (
              <Card key={doc.label} className="rounded-xl border-line bg-surface-1 shadow-sm">
                <CardContent className="flex items-center justify-between gap-4 p-5">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-info-bg text-primary ring-1 ring-info-border">{doc.icon}</div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-black text-content-1">{doc.label}</div>
                      <div className="mt-1 truncate text-xs font-semibold text-content-3">{doc.detail}</div>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" className="rounded-lg" asChild>
                    <Link href={doc.label === "Dispatch ledger" ? `/sales/orders/${id}/dispatches` : "#"}>Open</Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="audit" className="space-y-3">
          <Card className="rounded-xl border-line bg-surface-1 shadow-sm">
            <CardContent className="p-5">
              <div className="mb-4 flex items-center gap-2 text-sm font-black text-content-1">
                <ShieldCheck className="h-5 w-5 text-success-fg" /> Production and material audit
              </div>
              <div className="grid gap-3 lg:grid-cols-2">
                <div className="rounded-xl border border-line bg-surface-2 p-4">
                  <div className="mb-3 text-[10px] font-black uppercase tracking-[0.18em] text-content-4">Material control</div>
                  {(tracking?.material_audit?.materials || []).slice(0, 10).map((row: any, index: number) => (
                    <div key={`${row.material_code}-${index}`} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-line py-2 text-xs last:border-0">
                      <div className="min-w-0 truncate font-bold text-content-2">{row.material_code} · {row.material_name}</div>
                      <div className="font-mono font-black text-content-1">{fmtKg(row.required_kg)} kg</div>
                    </div>
                  ))}
                  {!tracking?.material_audit?.materials?.length ? (
                    <div className="text-sm font-semibold italic text-content-3">No material issue/consumption evidence yet.</div>
                  ) : null}
                </div>
                <div className="rounded-xl border border-line bg-surface-2 p-4">
                  <div className="mb-3 text-[10px] font-black uppercase tracking-[0.18em] text-content-4">Latest events</div>
                  {(tracking?.audit_timeline || []).slice(0, 10).map((event: any, index: number) => (
                    <div key={`${event.entity_id}-${index}`} className="border-b border-line py-2 text-xs last:border-0">
                      <div className="font-bold text-content-1">{event.message || event.event_type}</div>
                      <div className="mt-0.5 text-content-3">{fmtDate(event.timestamp)} · {event.actor || "system"}</div>
                    </div>
                  ))}
                  {!tracking?.audit_timeline?.length ? (
                    <div className="text-sm font-semibold italic text-content-3">No audit events recorded yet.</div>
                  ) : null}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

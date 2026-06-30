"use client";

import { useMemo, useState } from "react";

import { Chip, ChipGroup } from "@/components/ds/chip";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { formatDisplayDateTime } from "@/lib/date-format";

import { usePlannerJobs } from "@/hooks/use-planner";
import type { ProductionJob } from "@/services/production";
import type { TowerTabContext } from "./types";

type Band = "planned" | "released" | "running" | "done";

const BANDS: Array<{
  id: Band;
  label: string;
  hint: string;
  tone: "info" | "process" | "warn" | "success";
}> = [
  { id: "planned", label: "Planned", hint: "Awaiting release", tone: "info" },
  {
    id: "released",
    label: "Released",
    hint: "Cleared to run",
    tone: "process",
  },
  { id: "running", label: "Running", hint: "On the floor now", tone: "warn" },
  {
    id: "done",
    label: "Done · 24h",
    hint: "Recently completed",
    tone: "success",
  },
];

function bandFor(job: ProductionJob): Band | null {
  const state = String(job.job_state || "").toUpperCase();
  if (state === "WAITING" || state === "PLANNED") return "planned";
  if (state === "RELEASED" || state === "PAUSED") return "released";
  if (state === "EXECUTING") return "running";
  if (state === "COMPLETED") {
    const closed = (job as any).closed_at || (job as any).completed_at;
    if (!closed) return null;
    const ms = Date.now() - new Date(closed).getTime();
    if (ms <= 86_400_000) return "done";
    return null;
  }
  return null;
}

function progressPct(job: ProductionJob): number {
  const target = Number(job.step_target_primary || job.quantity || 0);
  const done = Number(
    job.step_produced_primary || (job as any).produced_qty || 0,
  );
  if (!target) return 0;
  return Math.max(0, Math.min(100, Math.round((done / target) * 100)));
}

function progressKind(pct: number): "success" | "info" | "warn" {
  if (pct >= 90) return "success";
  if (pct >= 30) return "info";
  return "warn";
}

function formatQty(value: number | null | undefined, uom?: string) {
  if (value == null || Number.isNaN(value)) return "—";
  return uom ? `${Number(value).toFixed(0)} ${uom}` : Number(value).toFixed(0);
}

function formatDateTime(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return formatDisplayDateTime(d);
}

function jobLineLabel(job: ProductionJob): string {
  return (
    String(
      job.sales_order_line_label ||
        (job as any).line_label ||
        (job as any).display_label ||
        job.product_name ||
        job.template_name ||
        "",
    ).trim() || "—"
  );
}

export function QueueTab({ context }: { context: TowerTabContext }) {
  const [selectedJob, setSelectedJob] = useState<ProductionJob | null>(null);
  const { data, isLoading } = usePlannerJobs();
  const jobs = data ?? [];

  const grouped = useMemo(() => {
    const search = context.search.toLowerCase();
    const buckets: Record<Band, ProductionJob[]> = {
      planned: [],
      released: [],
      running: [],
      done: [],
    };
    for (const job of jobs) {
      const band = bandFor(job);
      if (!band) continue;
      if (search) {
        const haystack = [
          job.job_number,
          job.sales_order_line_label,
          (job as any).line_label,
          job.template_name,
          job.product_name,
          job.order_number,
          job.customer_name,
          job.work_center_name,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(search)) continue;
      }
      buckets[band].push(job);
    }
    return buckets;
  }, [jobs, context.search]);

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap gap-2 border-b border-line px-5 py-3 text-[11px] text-content-3">
        <span className="font-semibold uppercase tracking-wide">Queue</span>
        {BANDS.map((band) => (
          <Chip key={band.id} kind={band.tone} size="sm">
            {band.label} · {grouped[band.id].length}
          </Chip>
        ))}
        <span className="ml-auto">{jobs.length} total jobs</span>
      </div>

      <div className="grid gap-4 px-5 py-4 lg:grid-cols-2 xl:grid-cols-4">
        {BANDS.map((band) => {
          const list = grouped[band.id];
          return (
            <section
              key={band.id}
              className="flex min-h-[180px] flex-col gap-2 rounded-xl border border-line bg-surface-2 p-3"
            >
              <header className="flex items-center justify-between">
                <div>
                  <div className="font-display text-sm font-semibold text-content-1">
                    {band.label}
                  </div>
                  <div className="text-[10px] text-content-3">{band.hint}</div>
                </div>
                <Chip kind={band.tone} size="sm">
                  {list.length}
                </Chip>
              </header>

              {isLoading ? (
                <div className="rounded-lg border border-dashed border-line bg-surface-1 p-3 text-[11px] italic text-content-3">
                  Loading…
                </div>
              ) : list.length === 0 ? (
                <div className="rounded-lg border border-dashed border-line bg-surface-1 p-3 text-[11px] italic text-content-4">
                  Nothing in this band.
                </div>
              ) : (
                list.map((job) => {
                  const pct = progressPct(job);
                  const isSelected = selectedJob?.id === job.id;
                  return (
                    <button
                      key={job.id}
                      type="button"
                      onClick={() => setSelectedJob(job)}
                      className={cn(
                        "flex flex-col gap-1 rounded-lg border bg-surface-1 px-3 py-2 text-left transition-colors hover:border-info-border hover:bg-info-bg",
                        isSelected
                          ? "border-info-border bg-info-bg"
                          : "border-line",
                      )}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-mono-token text-[12px] font-semibold text-content-1">
                          {job.job_number}
                        </span>
                        <Chip kind={progressKind(pct)} size="sm" mono>
                          {pct}%
                        </Chip>
                      </div>
                      <div className="truncate text-[12px] text-content-2">
                        {jobLineLabel(job)}
                      </div>
                      <div className="text-[10px] text-content-3">
                        {job.order_number || "—"} ·{" "}
                        {job.work_center_name || "WC pending"}
                      </div>
                      <ChipGroup spacing="tight">
                        {job.process_code && (
                          <Chip kind="process" size="sm">
                            {job.process_code}
                          </Chip>
                        )}
                        {job.is_on_hold && (
                          <Chip kind="warn" size="sm">
                            Hold
                          </Chip>
                        )}
                      </ChipGroup>
                    </button>
                  );
                })
              )}
            </section>
          );
        })}
      </div>

      <Sheet
        open={!!selectedJob}
        onOpenChange={(open) => {
          if (!open) setSelectedJob(null);
        }}
      >
        <SheetContent className="w-[min(30rem,calc(100vw-1rem))] sm:max-w-none overflow-y-auto">
          {selectedJob && (
            <div className="flex flex-col gap-4">
              <SheetHeader className="space-y-1 pb-2 text-left">
                <SheetTitle className="font-display text-lg">
                  {selectedJob.job_number}
                </SheetTitle>
                <SheetDescription className="text-xs text-content-3">
                  {jobLineLabel(selectedJob)} ·{" "}
                  {selectedJob.process_code || "—"}
                </SheetDescription>
                <ChipGroup className="pt-1" spacing="tight">
                  <Chip
                    kind={
                      selectedJob.job_state === "EXECUTING" ? "warn" : "info"
                    }
                  >
                    {selectedJob.job_state}
                  </Chip>
                  {selectedJob.is_on_hold && <Chip kind="danger">On hold</Chip>}
                  {selectedJob.work_center_name && (
                    <Chip kind="neutral">{selectedJob.work_center_name}</Chip>
                  )}
                </ChipGroup>
              </SheetHeader>

              <section className="grid grid-cols-2 gap-2 text-[12px]">
                <Meta
                  label="Sales order"
                  value={selectedJob.order_number || "—"}
                />
                <Meta
                  label="Customer"
                  value={selectedJob.customer_name || "—"}
                />
                <Meta
                  label="Quantity"
                  value={formatQty(selectedJob.quantity, selectedJob.uom)}
                />
                <Meta
                  label="Remaining"
                  value={formatQty(selectedJob.remaining_qty, selectedJob.uom)}
                />
                <Meta
                  label="Step target"
                  value={formatQty(
                    selectedJob.step_target_primary,
                    selectedJob.primary_uom,
                  )}
                />
                <Meta
                  label="Produced"
                  value={formatQty(
                    selectedJob.step_produced_primary,
                    selectedJob.primary_uom,
                  )}
                />
                <Meta
                  label="Planned date"
                  value={formatDateTime(selectedJob.planned_date)}
                />
                <Meta
                  label="Priority"
                  value={String(selectedJob.priority ?? "—")}
                />
              </section>

              {selectedJob.is_on_hold && selectedJob.hold_reason ? (
                <section className="rounded-lg border border-warning-border bg-warning-bg px-3 py-2 text-xs text-warning-fg">
                  <div className="font-semibold">Hold reason</div>
                  <div className="mt-1">{selectedJob.hold_reason}</div>
                </section>
              ) : null}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-surface-1 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-content-3">
        {label}
      </div>
      <div className="mt-0.5 font-mono-token text-[13px] text-content-1">
        {value}
      </div>
    </div>
  );
}

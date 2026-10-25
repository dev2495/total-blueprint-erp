"use client";

import * as React from "react";
import { AlertCircle, CheckCircle2, Cpu, Cylinder, Package } from "lucide-react";

import { ArtworkButton } from "@/components/machine/cylinder-artwork";
import { ElapsedStalledBadge, InkColorSwatches } from "@/components/wcm/queue-card-chips";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { inchesText } from "@/lib/size-naming";
import { normalizeProductSpec } from "@/lib/product-spec";

const clean = (value: unknown) => String(value ?? "").trim();
const firstNonEmpty = (...values: unknown[]) => values.map(clean).find(Boolean) || "";
const num = (value: unknown) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
const qty = (value: number, uom: string) =>
  `${value.toLocaleString("en-IN", { maximumFractionDigits: uom === "PCS" ? 0 : 1 })} ${uom}`;
const trim1 = (value: number) => String(Math.round(value * 10) / 10);
/** "STAND_UP" → "Stand up"; labels that are already words stay as they are. */
const human = (value: unknown) => {
  const text = clean(value);
  if (!/^[A-Z0-9_\- ]+$/.test(text) || !/[A-Z]/.test(text)) return text;
  const words = text.replace(/[_-]+/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
};
/** "PET 12 micron" → "PET": the micron is shown beside it. */
const layerName = (value: unknown) => clean(value).replace(/\s*\d+(?:\.\d+)?\s*(?:micron|mic|µm?|u)\b\.?/i, "").trim();

type Gate = "ok" | "warn" | "bad" | "skip" | "unknown";

/** Everything a queue row shows, from the WCM queue serializer. */
export function queueRowModel(assignment: any) {
  const job = assignment?.job_details || {};
  const spec = normalizeProductSpec(job);
  const status = String(assignment?.status || "WC_READY").toUpperCase();
  const priority = Number(job?.priority ?? 50);
  const inkColors: string[] = Array.isArray(assignment?.ink_colors) ? assignment.ink_colors : [];
  const artwork = {
    id: firstNonEmpty(assignment?.artwork_id, job?.artwork_id, job?.committed_artwork_id),
    code: firstNonEmpty(assignment?.artwork_code, job?.artwork_code, job?.committed_artwork_code),
    name: firstNonEmpty(assignment?.artwork_name, job?.artwork_name, job?.committed_artwork_name),
  };
  // Same reading as the cylinder chip: the status wins, the ready flag only fills a missing status.
  const cylinderStatus =
    String(assignment?.cylinder_status || "").toUpperCase() ||
    (assignment?.cylinder_ready === true ? "READY" : assignment?.cylinder_ready === false ? "MISSING" : "NA");
  const needsCylinders = Boolean(
    assignment?.current_step_print_capable || job?.current_step_print_capable || artwork.id || artwork.code || artwork.name || inkColors.length,
  );
  const materialBlocked = Boolean(assignment?.material_blocked);
  const materialBlockReason = clean(assignment?.material_block_reason);
  const inputForm = String(job?.input_form || "").toUpperCase();
  const outputForm = String(job?.output_form || spec.size.finishedGoodType || "OUTPUT").toUpperCase();
  const rollCount = Math.max(
    Array.isArray(assignment?.allocated_roll_details) ? assignment.allocated_roll_details.length : 0,
    Array.isArray(assignment?.allocated_rolls) ? assignment.allocated_rolls.length : 0,
  );
  const lineUom = String(job?.uom || "").toUpperCase() === "PCS" ? "PCS" : "KG";
  const ordered = num(job?.quantity) ?? num(job?.order_reference_target_kg ?? job?.total_weight_kg) ?? 0;
  const remaining =
    num(job?.remaining_qty ?? job?.order_remaining_primary ?? job?.order_remaining_qty ?? job?.remaining_qty_kg) ??
    (ordered > 0 ? Math.max(0, ordered - Number(job?.produced_qty ?? job?.step_produced_primary ?? 0)) : null);
  const produced =
    num(job?.order_produced_primary ?? job?.order_produced_qty ?? job?.produced_qty ?? job?.produced_qty_kg ?? job?.step_produced_primary) ??
    (remaining != null ? Math.max(0, ordered - remaining) : 0);
  const percent = ordered > 0 ? Math.min(100, Math.max(0, (produced / ordered) * 100)) : 0;
  const stepNo = num(job?.current_step_index) != null ? Number(job.current_step_index) + 1 : null;
  const stepCount = num(job?.route_step_count ?? job?.total_steps ?? job?.step_count);
  const process = firstNonEmpty(job?.current_process_name, job?.process_name, job?.current_process_code, job?.route_node_label);
  const blockers = [
    materialBlocked ? materialBlockReason || "Material gate blocked" : "",
    needsCylinders && cylinderStatus === "MISSING" ? "Cylinders or artwork pending" : "",
    inputForm === "ROLL" && rollCount === 0 ? "WIP rolls pending" : "",
    !assignment?.assigned_machine ? "Machine not assigned" : "",
    assignment?.is_stalled ? "Stalled job" : "",
  ].filter(Boolean);
  const gates: Record<"M" | "R" | "I" | "C", { state: Gate; title: string }> = {
    M: assignment?.assigned_machine
      ? { state: "ok", title: `Machine · ${clean(assignment?.assigned_machine_name) || "assigned"}` }
      : { state: "warn", title: "Machine not assigned" },
    R:
      inputForm !== "ROLL"
        ? { state: "skip", title: "Bulk input · no rolls at this step" }
        : rollCount
          ? { state: "ok", title: `${rollCount} roll${rollCount === 1 ? "" : "s"} allocated` }
          : { state: "warn", title: "Rolls pending" },
    I: materialBlocked
      ? { state: "bad", title: materialBlockReason || "Material blocked" }
      : status === "EXECUTION_READY"
        ? { state: "ok", title: "Issue recorded" }
        : { state: "unknown", title: "Issue is checked when the job is opened" },
    C: !needsCylinders || cylinderStatus === "NA" || cylinderStatus === "NOT_REQUIRED"
      ? { state: "skip", title: "No cylinders for this step" }
      : cylinderStatus === "MISSING"
        ? { state: "warn", title: "Cylinders or artwork missing" }
        : { state: "ok", title: "Cylinders ready" },
  };
  const width = Number(spec.size.widthMm || 0);
  const height = Number(spec.size.heightMm || 0);
  const gusset = Number(spec.size.gussetMm || 0);
  const size =
    width && height
      ? { metric: `${trim1(width)} × ${trim1(height)}${gusset ? ` + ${trim1(gusset)} G` : ""}`, unit: "mm", imperial: inchesText(width, height) }
      : width
        ? { metric: trim1(width), unit: "mm web", imperial: inchesText(width) }
        : { metric: clean(spec.size.label), unit: "", imperial: "" };
  const gauge = spec.layers.reduce((sum, layer) => sum + Number(layer.thicknessMicron || 0), 0);
  return {
    job,
    spec,
    status,
    priority,
    inkColors,
    artwork,
    needsCylinders,
    cylinderStatus,
    materialBlocked,
    materialBlockReason,
    inputForm,
    outputForm,
    rollCount,
    lineUom,
    ordered,
    produced,
    percent,
    stepNo,
    stepCount,
    process,
    blockers,
    gates,
    size,
    gauge,
    jobName: clean((job as any)?.job_name),
    jobNumber: clean(job?.job_number),
    customer: firstNonEmpty(job?.customer_name, spec.customerName) || "Customer not captured",
    orderNumber: firstNonEmpty(job?.order_number, spec.orderNumber),
    product: firstNonEmpty(spec.productName, job?.product_name),
    form: [human(spec.pouchStyle || spec.size.formLabel), clean((job as any)?.lanes_label)].filter(Boolean).join(" · "),
    machineName: clean(assignment?.assigned_machine_name),
    elapsedMinutes: assignment?.elapsed_minutes as number | null | undefined,
    stalled: Boolean(assignment?.is_stalled),
  };
}

export const priorityTone = (priority: number) =>
  priority >= 80 ? "danger" : priority >= 50 ? "warning" : "order";

function GateChip({ letter, gate }: { letter: string; gate: { state: Gate; title: string } }) {
  return (
    <span
      title={gate.title}
      aria-label={`${letter}: ${gate.title}`}
      className={cn(
        "grid h-[22px] w-[22px] place-items-center rounded-md border font-mono text-[11px] font-bold",
        gate.state === "ok"
          ? "border-success-border bg-success-bg text-success-fg"
          : gate.state === "warn"
            ? "border-warning-border bg-warning-bg text-warning-fg"
            : gate.state === "bad"
              ? "border-danger-border bg-danger-bg text-danger-fg"
              : gate.state === "skip"
                ? "border-line bg-surface-2 text-content-4"
                : "border-line bg-surface-1 text-content-3",
      )}
    >
      {letter}
    </span>
  );
}

/** One line of the WC queue, as on the approved sample. */
export function WcmQueueRow({
  assignment,
  selected,
  running,
  onSelect,
  onShortClose,
  onCancel,
}: {
  assignment: any;
  selected: boolean;
  running: boolean;
  onSelect: () => void;
  onShortClose?: () => void;
  onCancel?: () => void;
}) {
  const row = queueRowModel(assignment);
  const tone = priorityTone(row.priority);
  const hasStarted =
    ["EXECUTING", "PAUSED"].includes(String(row.job?.job_state || "").toUpperCase()) ||
    String(row.job?.status || "").toUpperCase() === "RUNNING" ||
    Number(row.job?.produced_qty || row.job?.step_produced_primary || 0) > 0;
  const statusLabel =
    row.status === "EXECUTION_READY" ? "Execution ready" : row.status === "ASSIGNED" ? `Assigned${row.machineName ? ` · ${row.machineName}` : ""}` : "WC Ready";
  const Glyph = row.inputForm === "ROLL" && row.outputForm === "ROLL" ? Cylinder : Package;
  return (
    <article
      data-testid={`wcm-assignment-row-${assignment.id}`}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        "relative cursor-pointer border-b border-line py-2.5 pl-4 pr-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary",
        selected ? "bg-info-bg" : "bg-surface-1 hover:bg-surface-2/60",
        row.materialBlocked && "bg-danger-bg",
      )}
    >
      <i
        aria-hidden
        className={cn(
          "absolute inset-y-0 left-0 w-1",
          row.materialBlocked ? "bg-danger-solid" : tone === "danger" ? "bg-danger-solid" : tone === "warning" ? "bg-warning-fg" : "bg-plate",
          selected && "w-1.5",
        )}
      />
      <div className="flex items-center gap-1.5">
        <span className="rounded bg-primary px-1 py-px text-[9.5px] font-bold uppercase tracking-[0.08em] text-white">Job</span>
        <b className="min-w-0 flex-1 truncate font-mono text-[13.5px] font-bold text-primary" title={row.jobName || row.jobNumber}>
          {row.jobName || row.jobNumber || "Job"}
        </b>
        <span className="flex gap-0.5" aria-label="Gates">
          {(["M", "R", "I", "C"] as const).map((letter) => (
            <GateChip key={letter} letter={letter} gate={row.gates[letter]} />
          ))}
        </span>
      </div>
      <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] text-content-3">
        <b className="text-[13px] font-semibold text-content-1">{row.customer}</b>
        {row.orderNumber ? <span className="font-mono font-semibold text-primary">{row.orderNumber}</span> : null}
        {row.process ? (
          <>
            <span className="text-content-4">·</span>
            <span>
              {row.process}
              {row.stepNo ? ` · ${row.stepNo}${row.stepCount ? `/${row.stepCount}` : ""}` : ""}
            </span>
          </>
        ) : null}
        {running || row.stalled ? (
          <span onClick={(event) => event.stopPropagation()}>
            <ElapsedStalledBadge elapsedMinutes={row.elapsedMinutes} isStalled={row.stalled} />
          </span>
        ) : null}
        <span className="ml-auto flex items-center gap-1">
          <span
            className={cn(
              "rounded-md border px-1.5 py-px text-[11px] font-bold",
              tone === "danger"
                ? "border-danger-border bg-danger-bg text-danger-fg"
                : tone === "warning"
                  ? "border-warning-border bg-warning-bg text-warning-fg"
                  : "border-order-border bg-order-bg text-order-fg",
            )}
            title={`Priority ${row.priority}`}
          >
            ▲ {row.priority}
          </span>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-md border px-1.5 py-px text-[11px] font-semibold",
              row.status === "EXECUTION_READY"
                ? "border-success-border bg-success-bg text-success-fg"
                : row.status === "ASSIGNED"
                  ? "border-success-border bg-success-bg text-success-fg"
                  : "border-info-border bg-info-bg text-info-fg",
            )}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
            {statusLabel}
          </span>
        </span>
      </div>
      <div className="mt-1.5 grid grid-cols-[34px_minmax(0,1fr)] gap-x-2.5">
        <span className="row-span-3 mt-1 grid h-9 w-9 place-items-center rounded-lg border border-info-border bg-info-bg text-primary" aria-hidden>
          <Glyph className="h-[18px] w-[18px]" />
        </span>
        <div className="flex flex-wrap items-baseline gap-x-1.5">
          {row.size.metric ? <span className="font-mono text-[16px] font-bold text-content-1">{row.size.metric}</span> : null}
          {row.size.unit ? <span className="text-[11px] text-content-3">{row.size.unit}</span> : null}
          {row.size.imperial ? <span className="text-[14px] font-semibold text-content-3">{row.size.imperial}</span> : null}
        </div>
        <div className="truncate text-[12px] text-content-2" title={row.product}>
          {row.form ? <span className="font-medium">{row.form} · </span> : null}
          <span className="uppercase">{row.product}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {row.spec.layers.slice(0, 4).map((layer, index) => (
            <React.Fragment key={`${layer.index}-${index}`}>
              {index ? <span className="text-[10px] text-content-4">+</span> : null}
              <span className="inline-flex items-center rounded-md border border-line bg-surface-2 px-1.5 py-px font-mono text-[10.5px] text-content-2">
                {layerName(layer.variantCode || layer.variantName) || "Layer"}
                {layer.thicknessMicron ? ` ${trim1(Number(layer.thicknessMicron))}µ` : ""}
              </span>
            </React.Fragment>
          ))}
          {row.gauge && row.spec.layers.length > 1 ? <b className="font-mono text-[11px] text-content-1">= {trim1(row.gauge)}µ</b> : null}
          {row.inkColors.length ? <InkColorSwatches colors={row.inkColors} /> : null}
        </div>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold",
            row.machineName ? "border-success-border bg-success-bg text-success-fg" : "border-warning-border bg-warning-bg text-warning-fg",
          )}
        >
          <Cpu className="h-3 w-3" aria-hidden />
          {row.machineName || "Machine not assigned"}
        </span>
        {row.needsCylinders && (row.artwork.id || row.artwork.code || row.artwork.name) ? (
          <span onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
            <ArtworkButton artworkId={row.artwork.id || null} artworkCode={row.artwork.code || null} artworkName={row.artwork.name || null} />
          </span>
        ) : null}
        {row.needsCylinders && row.gates.C.state !== "skip" ? (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold",
              row.gates.C.state === "ok" ? "border-success-border bg-success-bg text-success-fg" : "border-danger-border bg-danger-bg text-danger-fg",
            )}
          >
            {row.gates.C.state === "ok" ? <CheckCircle2 className="h-3 w-3" aria-hidden /> : <AlertCircle className="h-3 w-3" aria-hidden />}
            {row.gates.C.state === "ok" ? "Cylinder ready" : "Cylinder missing"}
          </span>
        ) : null}
        {row.spec.podLabels.map((label) => (
          <span key={`pod-${label}`} className="rounded-md border border-info-border bg-info-bg px-1.5 py-0.5 text-[11px] font-semibold text-info-fg">
            POD · {label}
          </span>
        ))}
        {row.spec.addonLabels.map((label) => (
          <span key={`addon-${label}`} className="rounded-md border border-warning-border bg-warning-bg px-1.5 py-0.5 text-[11px] font-semibold text-warning-fg">
            + {label}
          </span>
        ))}
        <span className="rounded-md border border-order-border bg-order-bg px-1.5 py-0.5 text-[11px] font-semibold text-order-fg">
          {row.inputForm || "INPUT"} → {row.outputForm}
        </span>
        <span className={cn("rounded-md border px-1.5 py-0.5 text-[11px] font-semibold", row.rollCount ? "border-info-border bg-info-bg text-info-fg" : "border-line bg-surface-2 text-content-3")}>
          Rolls · {row.rollCount}
        </span>
        {row.materialBlocked ? (
          <span className="inline-flex items-center gap-1 rounded-md border border-danger-border bg-danger-bg px-1.5 py-0.5 text-[11px] font-semibold text-danger-fg">
            <AlertCircle className="h-3 w-3" aria-hidden /> Material blocked
          </span>
        ) : null}
        <TooltipProvider delayDuration={100}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className={cn(
                  "rounded-md border px-1.5 py-0.5 text-[11px] font-semibold",
                  row.blockers.length ? "border-warning-border bg-warning-bg text-warning-fg" : "border-success-border bg-success-bg text-success-fg",
                )}
              >
                Blockers · {row.blockers.length || "clear"}
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[320px] rounded-xl border-line bg-surface-1 p-2.5 text-xs text-content-2 shadow-xl">
              {row.blockers.length ? row.blockers.map((reason) => <div key={reason}>{reason}</div>) : "No blockers"}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <span className="ml-auto" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Job actions"
                className="grid h-7 w-7 place-items-center rounded-md text-content-3 hover:bg-surface-2 hover:text-content-1"
              >
                ⋯
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              {running && assignment.assigned_machine ? (
                <DropdownMenuItem asChild>
                  <a href={`/production/machine/${assignment.assigned_machine}`}>Open machine terminal</a>
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem disabled={!(running && hasStarted)} onClick={onShortClose}>
                Short close step
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!( !running || !hasStarted)} className="text-danger-fg focus:text-danger-fg" onClick={onCancel}>
                Cancel job
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-[11.5px] text-content-3">
        <span className="min-w-0 flex-1 truncate">
          Sales order output · <b className="text-content-1">{qty(row.produced, row.lineUom)}</b> of{" "}
          <b className="text-content-1">{qty(row.ordered, row.lineUom)}</b>
        </span>
        <span className="font-mono tabular-nums">{Math.round(row.percent)}%</span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-2">
        <span
          className={cn("block h-full rounded-full", row.materialBlocked ? "bg-danger-solid" : row.percent >= 100 ? "bg-success-fg" : "bg-primary")}
          style={{ width: `${row.percent}%` }}
        />
      </div>
    </article>
  );
}

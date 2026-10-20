"use client";

/**
 * Feed for one step, with every figure kept apart so nobody has to work it out on the floor:
 * this step's target, what it has done, what it can run right now and what is left; then each
 * earlier step's own progress (parallel printing and extrusion show as two rows) and, for
 * lamination, each lane's film with the lane that limits the output marked. Figures come from
 * the job context's upstream_feed; nothing here changes a rule.
 */
import Link from "next/link";

import { cn } from "@/lib/utils";

export interface JobWorkerHold {
  order_id: string;
  order_number: string;
  vendor: string;
  status: string;
  sent_kg: number;
  at_vendor_kg: number;
  link: string;
}

export interface StepFeedStep {
  node_id: string;
  at_job_worker?: JobWorkerHold | null;
  job_number?: string;
  process_code?: string;
  job_state?: string;
  done?: boolean;
  skipped?: boolean;
  feeds_lane?: boolean;
  target_kg?: number;
  produced_kg?: number;
  remaining_kg?: number;
}

export interface StepFeedLane {
  label: string;
  material_name: string;
  share: number;
  need_kg: number;
  loaded_kg: number;
  waiting_kg: number;
  on_hand_kg: number;
}

export interface UpstreamFeed {
  at_job_worker?: JobWorkerHold | null;
  steps: StepFeedStep[];
  lanes: StepFeedLane[];
  upstream_done: boolean;
  step_target_kg: number;
  step_produced_kg: number;
  step_remaining_kg: number;
  loaded_kg: number;
  waiting_kg: number;
  on_hand_kg: number;
  combinable_kg: number | null;
  can_run_now_kg: number;
}

const kg = (value?: number | null) =>
  `${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 1 })} kg`;

const STATE_LABEL: Record<string, string> = {
  EXECUTING: "running",
  PAUSED: "paused",
  COMPLETED: "done",
  RELEASED: "released",
  WAITING: "waiting",
  PLANNED: "planned",
};

export function StepFeedCard({
  feed,
  className,
  testId = "step-feed",
}: {
  feed?: UpstreamFeed | null;
  className?: string;
  testId?: string;
}) {
  if (!feed) return null;
  const steps = (feed.steps || []).filter((step) => !step.skipped);
  const lanes = feed.lanes || [];
  const limiting = lanes.length
    ? lanes.reduce((low, lane) => {
        const cap = lane.share > 0 ? lane.on_hand_kg / lane.share : Infinity;
        const lowCap = low.share > 0 ? low.on_hand_kg / low.share : Infinity;
        return cap < lowCap ? lane : low;
      }, lanes[0])
    : null;
  const figures: Array<[string, string, string?]> = [
    ["Step target", kg(feed.step_target_kg)],
    ["Done", kg(feed.step_produced_kg)],
    ["Can run now", kg(feed.can_run_now_kg), "now"],
    ["Left", kg(feed.step_remaining_kg)],
  ];
  return (
    <section className={cn("rounded-[16px] border border-line bg-surface-1 p-4", className)} data-testid={testId}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[14px] font-semibold text-content-1">Feed for this step</h3>
        <span
          className={cn(
            "rounded-full px-2.5 py-0.5 text-[12px] font-medium ring-1",
            feed.upstream_done
              ? "bg-success-bg text-success-fg ring-success-border"
              : "bg-warning-bg text-warning-fg ring-warning-border",
          )}
          data-testid={`${testId}-upstream`}
        >
          {steps.length === 0 ? "first step" : feed.upstream_done ? "earlier steps done" : "earlier steps still running"}
        </span>
      </div>

      {feed.at_job_worker ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-[12px] bg-order-bg px-3 py-2 text-[13px] text-order-fg ring-1 ring-order-border" data-testid={`${testId}-at-job-worker`}>
          <span>
            <span className="font-semibold">This step is at a job worker</span> · {feed.at_job_worker.vendor} ·{" "}
            <span className="tabular-nums">{kg(feed.at_job_worker.at_vendor_kg)}</span> still there of{" "}
            <span className="tabular-nums">{kg(feed.at_job_worker.sent_kg)}</span> sent
          </span>
          <Link href={feed.at_job_worker.link} className="font-semibold underline-offset-2 hover:underline">
            {feed.at_job_worker.order_number || "Job-work order"}
          </Link>
        </div>
      ) : null}

      <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {figures.map(([label, value, tone]) => (
          <div
            key={label}
            className={cn(
              "rounded-[12px] px-3 py-2 ring-1",
              tone === "now" ? "bg-info-bg ring-info-border" : "bg-surface-2 ring-line",
            )}
            data-testid={`${testId}-${label.toLowerCase().replace(/\s+/g, "-")}`}
          >
            <dt className="text-[12px] text-content-3">{label}</dt>
            <dd className={cn("mt-0.5 text-[16px] font-semibold tabular-nums", tone === "now" ? "text-info-fg" : "text-content-1")}>
              {value}
            </dd>
          </div>
        ))}
      </dl>

      {steps.length ? (
        <div className="mt-3">
          <div className="text-[12px] font-medium text-content-3">From earlier steps</div>
          <ul className="mt-1.5 grid gap-1.5">
            {steps.map((step) => {
              const pct = step.target_kg ? Math.min(100, ((step.produced_kg || 0) / step.target_kg) * 100) : 0;
              return (
                <li key={step.node_id} className="rounded-[10px] bg-surface-2 px-3 py-2 ring-1 ring-line" data-testid={`${testId}-step-${step.process_code}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
                    <span className="font-medium text-content-1">
                      {step.process_code}
                      {step.job_number ? <span className="ml-1.5 font-mono text-[11.5px] text-content-3">{step.job_number}</span> : null}
                    </span>
                    <span className="tabular-nums text-content-2">
                      {kg(step.produced_kg)} of {kg(step.target_kg)}
                      <span className={cn("ml-2 rounded-full px-2 py-0.5 text-[11.5px]", step.done ? "bg-success-bg text-success-fg" : step.at_job_worker ? "bg-order-bg text-order-fg ring-1 ring-order-border" : "bg-surface-1 text-content-3 ring-1 ring-line")}>
                        {step.at_job_worker && !step.done
                          ? `at ${step.at_job_worker.vendor} · ${kg(step.at_job_worker.at_vendor_kg)} out`
                          : STATE_LABEL[String(step.job_state || "").toUpperCase()] || String(step.job_state || "").toLowerCase()}
                      </span>
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-1">
                    <div className={cn("h-full rounded-full", step.done ? "bg-success-fg" : "bg-primary")} style={{ width: `${pct}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {lanes.length ? (
        <div className="mt-3">
          <div className="text-[12px] font-medium text-content-3">
            Lanes · output is limited by the lane with the least film for its share
          </div>
          <div className="mt-1.5 overflow-x-auto">
            <table className="w-full min-w-[460px] text-[12.5px]">
              <thead>
                <tr className="text-left text-content-3">
                  <th className="py-1 pr-3 font-medium">Lane</th>
                  <th className="py-1 pr-3 text-right font-medium">Share</th>
                  <th className="py-1 pr-3 text-right font-medium">Loaded</th>
                  <th className="py-1 pr-3 text-right font-medium">Waiting</th>
                  <th className="py-1 text-right font-medium">Still needs</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {lanes.map((lane) => {
                  const isLimit = limiting === lane;
                  return (
                    <tr key={lane.label} className={cn("border-t border-line", isLimit && "bg-warning-bg")} data-testid={`${testId}-lane`}>
                      <td className="py-1.5 pr-3 text-content-1">
                        {lane.label} · {lane.material_name}
                        {isLimit ? <span className="ml-1.5 text-[11.5px] font-medium text-warning-fg">limits output</span> : null}
                      </td>
                      <td className="py-1.5 pr-3 text-right text-content-2">{Math.round(lane.share * 100)}%</td>
                      <td className="py-1.5 pr-3 text-right text-content-2">{kg(lane.loaded_kg)}</td>
                      <td className="py-1.5 pr-3 text-right text-content-2">{kg(lane.waiting_kg)}</td>
                      <td className="py-1.5 text-right text-content-2">{kg(lane.need_kg)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <p className="mt-3 text-[12px] leading-5 text-content-3">
        Can run now = film loaded on this step plus finished rolls waiting from earlier steps
        {lanes.length ? ", taken lane by lane (film ÷ share, the smallest wins)" : ""}, capped at what this step still needs.
        {feed.waiting_kg > 0 ? ` ${kg(feed.waiting_kg)} is waiting to be loaded.` : ""}
      </p>
    </section>
  );
}

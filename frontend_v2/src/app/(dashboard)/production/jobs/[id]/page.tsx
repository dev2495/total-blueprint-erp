"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, ClipboardList, Cog, Factory, Layers } from "lucide-react";

import { api } from "@/lib/api";
import {
  HeroChip,
  HeroStat,
  HeroStats,
  Meter,
  PageHero,
  Panel,
  PanelEmpty,
  heroButtonClass,
} from "@/components/premium";
import { count, sentence } from "@/components/premium/format";

const qty = (value: unknown, uom?: string) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}${uom ? ` ${String(uom).toLowerCase()}` : ""}`;
};

/**
 * Read-only job summary. Activity feeds, trace results and audit entries link
 * here; it shows where the job stands and routes onward to the terminals.
 */
export default function ProductionJobPage() {
  const params = useParams<{ id: string }>();
  const jobId = String(params?.id || "");
  const job = useQuery({
    queryKey: ["production-job", jobId],
    queryFn: async () => (await api.get(`/api/production/jobs/${jobId}/`)).data,
    enabled: Boolean(jobId),
  });
  const j: any = job.data || {};
  const planned = Number(j.quantity || 0);
  const produced = Number(j.produced_qty || 0);
  const progress = planned > 0 ? Math.min(100, Math.round((produced / planned) * 100)) : 0;
  const state = String(j.job_state || j.status || "").toUpperCase();
  const layers: any[] = Array.isArray(j.layers) ? j.layers : [];

  if (job.isError) {
    return (
      <div className="mx-auto max-w-3xl">
        <Panel>
          <PanelEmpty icon={<ClipboardList />} title="Job not found">
            It may have been removed, or you may not have access to it.
          </PanelEmpty>
        </Panel>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      <PageHero
        compact
        eyebrow="Production job"
        icon={<ClipboardList />}
        title={job.data ? j.job_number : "Loading job…"}
        description={job.data ? [j.product_name || j.template_name, j.customer_name].filter(Boolean).join(" · ") : undefined}
        meta={
          job.data ? (
            <>
              <HeroChip tone={state === "COMPLETED" ? "good" : state === "EXECUTING" ? "info" : state.includes("BLOCK") ? "bad" : "neutral"}>{sentence(state)}</HeroChip>
              {j.order_number ? <HeroChip>{j.order_number}</HeroChip> : null}
              {j.priority ? <HeroChip>Priority {sentence(j.priority)}</HeroChip> : null}
            </>
          ) : null
        }
        actions={
          <>
            {j.machine ? (
              <Link href={`/production/machine/${j.machine}`} className={heroButtonClass("ghost")}>
                <Cog /> Machine terminal
              </Link>
            ) : null}
            {j.job_number ? (
              <Link
                href={`/dashboard/planner/control-tower/completed-trace?search=${encodeURIComponent(j.job_number)}`}
                className={heroButtonClass("primary")}
              >
                <Layers /> Trace
              </Link>
            ) : null}
          </>
        }
      >
        <HeroStats columns={4}>
          <HeroStat label="Planned" value={job.data ? qty(j.quantity, j.uom) : "—"} hint={j.total_weight_kg ? `${qty(j.total_weight_kg)} kg total` : undefined} />
          <HeroStat label="Produced" tone="good" value={job.data ? qty(j.produced_qty, j.uom) : "—"} hint={`${progress}% of plan`} />
          <HeroStat label="Remaining" value={job.data ? qty(j.remaining_qty, j.uom) : "—"} />
          <HeroStat label="Process" value={job.data ? j.process_code || sentence(j.process_category) || "—" : "—"} hint={j.current_process || undefined} />
        </HeroStats>
      </PageHero>

      {job.isLoading ? (
        <div className="erp-skeleton h-[320px] rounded-[18px]" />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <Panel icon={<Factory />} title="Where it runs">
            <Meter label="Progress" value={progress} max={100} display={`${progress}%`} tone={progress >= 100 ? "good" : "info"} />
            <dl className="mt-4 grid gap-x-6 gap-y-3 text-[13px] sm:grid-cols-2">
              {[
                ["Work centre", j.work_center_name],
                ["Machine", j.machine_name],
                ["Operator", j.operator_name],
                ["Planned for", j.planned_date],
                ["Production batch", j.production_batch_number],
                ["Order line", j.sales_order_line_label],
                ["From", j.from_location],
                ["To", j.to_location],
                ["Input → output", [j.input_form, j.output_form].filter(Boolean).join(" → ")],
                ["Closed", j.closed_at ? new Date(j.closed_at).toLocaleString("en-IN") : ""],
              ].map(([label, value]) => (
                <div key={label as string}>
                  <dt className="text-[11.5px] text-content-3">{label}</dt>
                  <dd className="mt-0.5 font-medium text-content-1">{value ? String(value) : "—"}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-4 flex flex-wrap gap-2">
              {j.work_center ? (
                <Link href={`/production/work-center/${j.work_center}`} className="inline-flex items-center gap-1 rounded-full border border-line px-3 py-1.5 text-[12.5px] font-medium text-content-2 hover:bg-surface-2">
                  Work-centre terminal <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              ) : null}
              {j.order_number ? (
                <Link
                  href={`/dashboard/planner/control-tower/plan-queue?search=${encodeURIComponent(j.order_number)}`}
                  className="inline-flex items-center gap-1 rounded-full border border-line px-3 py-1.5 text-[12.5px] font-medium text-content-2 hover:bg-surface-2"
                >
                  Order in plan queue <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              ) : null}
            </div>
          </Panel>
          <Panel icon={<Layers />} title="Specification" description={j.product_spec || j.template_name || undefined}>
            {layers.length ? (
              <ul className="space-y-2">
                {layers.map((layer: any, index: number) => (
                  <li key={index} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface-2/60 px-3 py-2 text-[12.5px]">
                    <span className="flex items-center gap-2">
                      <span className="grid h-5 w-5 place-items-center rounded-md bg-surface-1 text-[10px] font-semibold text-content-3">{index + 1}</span>
                      <span className="text-content-1">{layer.material_code || layer.material_name || layer.name || `Layer ${index + 1}`}</span>
                    </span>
                    <span className="tabular-nums text-content-3">
                      {layer.thickness_micron || layer.thickness_um ? `${layer.thickness_micron || layer.thickness_um} µ` : ""}
                      {layer.grade_code ? ` · ${layer.grade_code}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <PanelEmpty title="No layer stack recorded" />
            )}
            {Array.isArray(j.ink_colors) && j.ink_colors.length ? (
              <div className="mt-3 text-[12px] text-content-3">
                Inks: <span className="text-content-1">{j.ink_colors.map((c: any) => (typeof c === "string" ? c : c?.name || c?.code)).join(", ")}</span> ·{" "}
                {count(j.ink_colors.length)} colours
              </div>
            ) : null}
          </Panel>
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Wrench } from "lucide-react";

import { JobRecord } from "@/components/maintenance/job-record";
import { fmtDateTime } from "@/components/maintenance/ui";
import { PageHero } from "@/components/premium/page-hero";
import { maintenanceService, type MaintenanceJob } from "@/services/maintenance";

/** Full-page job record; the phone lands here from a machine scan. */
export default function MaintenanceJobPage() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id || "");
  const [job, setJob] = useState<MaintenanceJob | null>(null);
  const { data, isLoading, error } = useQuery({ queryKey: ["maintenance", "job", id], queryFn: () => maintenanceService.job(id), enabled: Boolean(id) });
  const { data: history = [] } = useQuery({ queryKey: ["maintenance", "job-history", id], queryFn: () => maintenanceService.jobHistory(id), enabled: Boolean(id) });
  useEffect(() => {
    if (data) setJob(data);
  }, [data]);

  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-10">
      <PageHero
        compact
        icon={<Wrench />}
        eyebrow={job ? `${job.machine_detail?.code} · ${job.machine_detail?.name}` : "Maintenance"}
        title={job ? job.title : isLoading ? "Loading…" : "Job"}
        description={job?.title_hi || (job?.kind === "OPERATOR_CHECK" ? "Operator check" : "Technician service")}
        actions={
          job ? (
            <Link href={`/m/${job.machine_detail?.code}`} className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm font-semibold text-white">
              Machine card
            </Link>
          ) : null
        }
      />
      {error ? <div className="rounded-xl border border-danger-border bg-danger-bg px-3 py-3 text-sm text-danger-fg">This job could not be loaded.</div> : null}
      {job ? (
        <section className="rounded-2xl border border-line bg-surface-1 p-4">
          <JobRecord job={job} onChanged={setJob} />
        </section>
      ) : null}
      {history.length ? (
        <section className="rounded-2xl border border-line bg-surface-1 p-4">
          <div className="mb-2 text-caption font-semibold uppercase tracking-[0.08em] text-content-3">Edit history</div>
          <ul className="space-y-1 text-caption text-content-2">
            {history.map((row: any) => (
              <li key={row.id}>
                <span className="font-mono">{fmtDateTime(row.created_at)}</span> · {row.actor_name || "system"} · {String(row.action).toLowerCase().replace(/_/g, " ")}
                {row.note ? ` · ${row.note}` : ""}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

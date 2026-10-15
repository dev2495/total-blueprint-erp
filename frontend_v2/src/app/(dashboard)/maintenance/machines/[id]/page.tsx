"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";

import { SectionLabel, fmtDateTime, fmtInr, fmtMinutes } from "@/components/maintenance/ui";
import { HeroStat, HeroStats, PageHero } from "@/components/premium/page-hero";
import { cn } from "@/lib/utils";
import { maintenanceService } from "@/services/maintenance";

/** Everything done on one machine, in date order: jobs, faults and downtime. */
export default function MachineHistoryPage() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id || "");
  const { data, isLoading } = useQuery({ queryKey: ["maintenance", "machine-history", id], queryFn: () => maintenanceService.machineHistory(id), enabled: Boolean(id) });
  const events = data?.events || [];
  const jobs = events.filter((e) => e.kind === "JOB");
  const faults = events.filter((e) => e.kind === "FAULT");
  const downtime = events.filter((e) => e.kind === "DOWNTIME");
  return (
    <div className="space-y-4 pb-10">
      <PageHero
        compact
        icon={<History />}
        eyebrow="Maintenance · machine history"
        title={data ? `${data.machine.code} · ${data.machine.name}` : isLoading ? "Loading…" : "Machine"}
        description={data ? `${data.machine.work_center_name || ""} · ${data.machine.plant_name || ""} · status ${data.machine.status}` : ""}
        actions={data ? <Link href={`/m/${data.machine.code}`} className="rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm font-semibold text-white">Machine card</Link> : null}
      >
        <HeroStats columns={4}>
          <HeroStat label="Jobs" value={jobs.length} />
          <HeroStat label="Faults" value={faults.length} tone="warn" />
          <HeroStat label="Downtime events" value={downtime.length} tone="bad" />
          <HeroStat label="Spares noted" value={fmtInr(jobs.reduce((sum, e) => sum + Number(e.spares_cost || 0), 0))} />
        </HeroStats>
      </PageHero>
      <section className="rounded-2xl border border-line bg-surface-1 p-3">
        <SectionLabel count={events.length}>Timeline</SectionLabel>
        {!isLoading && !events.length ? <div className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-sm text-content-3">Nothing recorded on this machine yet.</div> : null}
        <ol className="space-y-2">
          {events.map((event) => (
            <li key={`${event.kind}-${event.id}`} className={cn("flex gap-3 rounded-xl border px-3 py-2", event.kind === "FAULT" ? "border-danger-border bg-danger-bg/30" : event.kind === "DOWNTIME" ? "border-warning-border bg-warning-bg/30" : "border-line bg-surface-1")}>
              <div className="w-28 shrink-0 font-mono text-caption text-content-3">{fmtDateTime(event.at)}</div>
              <div className="min-w-0 flex-1 text-sm">
                <div className="font-semibold text-content-1">
                  <span className="mr-1.5 rounded-full bg-surface-2 px-1.5 text-caption font-bold uppercase text-content-3">{event.kind}</span>
                  {event.kind === "JOB" ? <Link href={`/maintenance/jobs/${event.id}`} className="text-primary">{event.title}</Link> : event.title}
                </div>
                <div className="text-caption text-content-3">
                  {event.kind === "JOB" ? `${String(event.status).toLowerCase().replace(/_/g, " ")}${event.outcome ? ` · ${String(event.outcome).toLowerCase()}` : ""} · planned ${event.planned_date}${event.by ? ` · ${event.by}` : ""}${event.time_minutes ? ` · ${fmtMinutes(event.time_minutes)}` : ""}${Number(event.spares_cost) ? ` · ${fmtInr(event.spares_cost)}` : ""}${event.attachments ? ` · ${event.attachments} photo(s)` : ""}` : null}
                  {event.kind === "FAULT" ? `${event.severity} · ${String(event.status).toLowerCase().replace(/_/g, " ")} · ${event.machine_running ? "machine running" : "machine stopped"}${event.by ? ` · by ${event.by}` : ""}${event.resolved_at ? ` · resolved ${fmtDateTime(event.resolved_at)}` : ""}` : null}
                  {event.kind === "DOWNTIME" ? `${event.reason} · ${event.hours} h${event.job_number ? ` · ${event.job_number}` : ""}${event.source === "PAUSE" ? " · from terminal pause" : ""}${event.notes ? ` · ${event.notes}` : ""}` : null}
                </div>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Cpu, ExternalLink, History, Loader2 } from "lucide-react";

import { FaultDialog } from "@/components/maintenance/fault-dialog";
import { JobDialog } from "@/components/maintenance/job-dialog";
import { JobRecord } from "@/components/maintenance/job-record";
import { FaultStatusPill, JobStatusPill, Row, SectionLabel, SeverityPill, fmtDate, fmtDateTime } from "@/components/maintenance/ui";
import { HeroStat, HeroStats, PageHero } from "@/components/premium/page-hero";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { describeApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { machineService } from "@/services/machine";
import { maintenanceService, type MaintenanceJob } from "@/services/maintenance";

/**
 * The machine card a phone lands on after scanning the machine QR. One page,
 * panels by role:
 *  - operator: today's checks on this machine, report a fault, open the terminal;
 *  - technician: open jobs and schedules for this machine, add a record;
 *  - supervisor / work-centre manager: the running order with a quick output log;
 *  - owner / plant manager: the queue and the 30-day base report;
 *  - maintenance supervisor: the machine's board (due, overdue, faults, verification).
 */
export default function MachineScanPage() {
  const params = useParams<{ code: string }>();
  const code = String(params?.code || "");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [faultOpen, setFaultOpen] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [activeCheck, setActiveCheck] = useState<MaintenanceJob | null>(null);
  const [logKg, setLogKg] = useState("");
  const [logPcs, setLogPcs] = useState("");

  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["maintenance", "scan-machine", code], queryFn: () => maintenanceService.scanMachine(code), enabled: Boolean(code), refetchInterval: 30_000 });
  const machineId = data?.machine.id;
  const viewer = data?.viewer;
  const role = String(viewer?.role || "").toUpperCase();
  const isOwnerView = ["OWNER", "ADMIN", "SUPER_ADMIN", "PLANT_MANAGER"].includes(role);
  const isSupervisorView = ["WORK_CENTER_MANAGER", "PLANT_MANAGER", "OWNER", "ADMIN", "SUPER_ADMIN"].includes(role) && Boolean(viewer?.can_run_production);
  const isMaintenanceView = ["MAINTENANCE_TECH", "MAINTENANCE_SUPERVISOR"].includes(role);
  const isOperatorView = ["OPERATOR", "WORK_CENTER_MANAGER"].includes(role) || (!isOwnerView && !isMaintenanceView);

  const { data: queue = [] } = useQuery({ queryKey: ["machine-queue", machineId], queryFn: () => machineService.getQueue(machineId as string), enabled: Boolean(machineId) && (isOwnerView || isSupervisorView), refetchInterval: 30_000 });

  const running = data?.production.running[0];
  useEffect(() => {
    if (running && !logKg) setLogKg("");
  }, [running, logKg]);

  const logMutation = useMutation({
    mutationFn: () =>
      machineService.logOutput(machineId as string, running!.id, {
        actual_qty: Number(logKg || 0),
        ...(logPcs ? { output_pcs: Number(logPcs) } : {}),
      }),
    onSuccess: () => {
      toast({ title: "Output logged · माल दर्ज" });
      setLogKg("");
      setLogPcs("");
      refetch();
      queryClient.invalidateQueries({ queryKey: ["machine-queue", machineId] });
    },
    onError: (err) => toast({ variant: "destructive", title: "Could not log", description: describeApiError(err) }),
  });

  const checks = data?.maintenance?.checks_today || [];
  const openJobs = data?.maintenance?.open_jobs || [];
  const faults = data?.maintenance?.open_faults || [];
  const awaiting = data?.maintenance?.awaiting_verification || [];
  const recent = data?.maintenance?.recent || [];
  const report = data?.report_30d;

  const title = data ? `${data.machine.code} · ${data.machine.name}` : isLoading ? "Loading…" : "Machine";

  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-10">
      <PageHero
        compact
        icon={<Cpu />}
        eyebrow={data ? `${data.machine.work_center_name || ""} · ${data.machine.plant_name || ""}` : "Scanned machine"}
        title={title}
        description={
          data
            ? `${data.machine.status === "ACTIVE" ? "Active" : data.machine.status === "DOWN" ? "DOWN · awaiting repair" : "Under maintenance"}${data.machine.assigned_operator ? ` · operator ${data.machine.assigned_operator}` : ""}${running ? ` · running ${running.job_number}` : " · idle"}`
            : ""
        }
        actions={
          data ? (
            <div className="flex flex-wrap gap-2">
              {viewer?.can_view_production ? (
                <Link href={`/production/machine/${data.machine.id}`} className="inline-flex items-center rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm font-semibold text-white" data-testid="scan-open-terminal">
                  <ExternalLink className="mr-1.5 h-4 w-4" /> Terminal
                </Link>
              ) : null}
              {viewer?.can_log_checks || viewer?.can_work || viewer?.can_manage ? (
                <button type="button" className="inline-flex items-center rounded-xl bg-danger-fg px-3 py-2 text-sm font-semibold text-white" onClick={() => setFaultOpen(true)} data-testid="scan-report-fault">
                  <AlertTriangle className="mr-1.5 h-4 w-4" /> Report fault · खराबी
                </button>
              ) : null}
            </div>
          ) : null
        }
      >
        {report ? (
          <HeroStats columns={4}>
            <HeroStat label="Run hours · 30 d" value={report.run_hours.toFixed(1)} />
            <HeroStat label="Downtime h · 30 d" value={report.downtime_hours.toFixed(1)} tone="warn" />
            <HeroStat label="Breakdowns · 30 d" value={report.breakdowns} tone="bad" />
            <HeroStat label="Queued orders" value={data?.production.queued_count ?? 0} />
          </HeroStats>
        ) : null}
      </PageHero>

      {error ? <div className="rounded-xl border border-danger-border bg-danger-bg px-3 py-3 text-sm text-danger-fg">No machine matches code &quot;{code}&quot;. Check the sticker or ask the supervisor.</div> : null}

      {running ? (
        <section className="rounded-2xl border border-line bg-surface-1 p-4" data-testid="scan-running">
          <SectionLabel>{running.job_state === "PAUSED" ? "Paused order · रुका हुआ" : "Running now · अभी चल रहा"}</SectionLabel>
          <div className="text-lg font-semibold text-content-1">{running.order_number || running.job_number}</div>
          <div className="text-sm text-content-2">
            {running.customer} · {running.job_number}
            {running.hold_reason ? ` · ${running.hold_reason}` : ""}
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center">
            {[
              ["Target", `${running.quantity.toLocaleString("en-IN")} ${running.uom.toLowerCase()}`],
              ["Produced", `${running.produced_qty.toLocaleString("en-IN")} ${running.uom.toLowerCase()}`],
              ["Remaining", `${running.remaining_qty.toLocaleString("en-IN")} ${running.uom.toLowerCase()}`],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-line bg-surface-2 px-2 py-2">
                <div className="font-mono text-base font-semibold text-content-1">{value}</div>
                <div className="text-caption font-semibold uppercase tracking-wide text-content-3">{label}</div>
              </div>
            ))}
          </div>
          {isSupervisorView && running.job_state === "EXECUTING" && running.step_output_form === "ROLL" ? (
            <div className="mt-3 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-content-2">
              {running.step_name ? `${running.step_name} makes rolls: ` : "This step makes rolls: "}log each roll with its width and weight on the{" "}
              <Link href={`/production/machine/${data?.machine.id}`} className="font-semibold text-primary">machine terminal</Link>.
            </div>
          ) : null}
          {isSupervisorView && running.job_state === "EXECUTING" && running.step_output_form !== "ROLL" ? (
            <div className="mt-3 rounded-xl border border-success-border bg-success-bg/40 p-3">
              <div className="mb-2 text-caption font-semibold uppercase tracking-wide text-success-fg">Quick log output · माल लिखें</div>
              <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
                <Input type="number" inputMode="decimal" step="0.001" placeholder="kg" aria-label="Output kg" className="h-12 font-mono text-lg" value={logKg} onChange={(event) => setLogKg(event.target.value)} data-testid="scan-log-kg" />
                <Input type="number" inputMode="numeric" placeholder="pcs (optional)" aria-label="Output pieces" className="h-12 font-mono text-lg" value={logPcs} onChange={(event) => setLogPcs(event.target.value)} />
                <Button type="button" className="h-12" disabled={!(Number(logKg) > 0) || logMutation.isPending} onClick={() => logMutation.mutate()} data-testid="scan-log-submit">
                  {logMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Log"}
                </Button>
              </div>
              <div className="mt-1 text-caption text-content-3">Same rules as the terminal: capped by the step target and the issued input. Returns, scrap and roll splits stay on the terminal.</div>
            </div>
          ) : null}
        </section>
      ) : null}

      {isOperatorView || isMaintenanceView || viewer?.can_manage ? (
        checks.length ? (
          <section className="rounded-2xl border border-line bg-surface-1 p-4" data-testid="scan-checks">
            <SectionLabel count={checks.length}>Checks due · आज की जाँच</SectionLabel>
            <div className="space-y-2">
              {checks.map((job) => (
                <div key={job.id} className={cn("rounded-xl border", activeCheck?.id === job.id ? "border-primary" : "border-line")}>
                  <Row
                    onClick={() => setActiveCheck(activeCheck?.id === job.id ? null : job)}
                    tone={job.is_overdue ? "danger" : "warn"}
                    testId={`scan-check-${job.id}`}
                    title={
                      <span className="flex flex-wrap items-center gap-2">
                        {job.title}
                        {job.title_hi ? <span className="text-caption text-content-3">· {job.title_hi}</span> : null}
                        <JobStatusPill status={job.status} overdue={job.is_overdue} />
                      </span>
                    }
                    subtitle={`${job.checklist?.length || 0} checks · planned ${fmtDate(job.planned_date)}`}
                  />
                  {activeCheck?.id === job.id ? (
                    <div className="border-t border-line p-3">
                      <JobRecord job={activeCheck} compact onChanged={(next) => { setActiveCheck(next); refetch(); }} />
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </section>
        ) : viewer?.can_view_maintenance ? (
          <div className="rounded-xl border border-success-border bg-success-bg px-3 py-3 text-sm text-success-fg">No checks due on this machine today · आज कोई जाँच बाकी नहीं</div>
        ) : null
      ) : null}

      {(isMaintenanceView || viewer?.can_manage) && openJobs.length ? (
        <section className="rounded-2xl border border-line bg-surface-1 p-4" data-testid="scan-open-jobs">
          <SectionLabel count={openJobs.length}>Maintenance work · काम</SectionLabel>
          <div className="space-y-2">
            {openJobs.map((job) => (
              <Row key={job.id} onClick={() => setJobId(job.id)} tone={job.is_overdue ? "danger" : "warn"} title={<span className="flex flex-wrap items-center gap-2">{job.title} <JobStatusPill status={job.status} overdue={job.is_overdue} /></span>} subtitle={`Planned ${fmtDate(job.planned_date)}${job.assigned_to_detail ? ` · ${job.assigned_to_detail.name}` : ""}${job.fault_title ? ` · fault: ${job.fault_title}` : ""}`} />
            ))}
          </div>
        </section>
      ) : null}

      {faults.length && viewer?.can_view_maintenance ? (
        <section className="rounded-2xl border border-line bg-surface-1 p-4" data-testid="scan-faults">
          <SectionLabel count={faults.length}>Open faults · खराबी</SectionLabel>
          <div className="space-y-2">
            {faults.map((fault) => (
              <Row key={fault.id} tone={fault.machine_running ? "warn" : "danger"} title={<span className="flex flex-wrap items-center gap-2">{fault.title} <SeverityPill severity={fault.severity} /> <FaultStatusPill status={fault.status} /></span>} subtitle={`${fault.reported_by_name || ""} · ${fmtDateTime(fault.reported_at)}${fault.assigned_to_detail ? ` · ${fault.assigned_to_detail.name}` : ""}`} right={viewer?.can_work || viewer?.can_manage ? <Link href={`/maintenance/faults?focus=${fault.id}`} className="text-caption font-semibold text-primary">Open</Link> : null} />
            ))}
          </div>
        </section>
      ) : null}

      {viewer?.can_manage && awaiting.length ? (
        <section className="rounded-2xl border border-line bg-surface-1 p-4">
          <SectionLabel count={awaiting.length}>Awaiting your verification</SectionLabel>
          <div className="space-y-2">
            {awaiting.map((job) => (
              <Row key={job.id} tone="info" onClick={() => setJobId(job.id)} title={job.title} subtitle={`Done by ${job.completed_by_name} · ${fmtDateTime(job.completed_at)}`} right={<Link href="/maintenance" className="text-caption font-semibold text-primary">Verify on board</Link>} />
            ))}
          </div>
        </section>
      ) : null}

      {(isOwnerView || isSupervisorView) && queue.length ? (
        <section className="rounded-2xl border border-line bg-surface-1 p-4" data-testid="scan-queue">
          <SectionLabel count={queue.length}>Queue on this machine · कतार</SectionLabel>
          <div className="space-y-2">
            {queue.slice(0, 15).map((job: any) => (
              <Row key={job.id} title={<span className="flex flex-wrap items-center gap-2"><span className="font-mono">{job.order_number || job.job_number}</span> {job.customer_name || job.product_name || job.display_name || ""}</span>} subtitle={`${job.job_number} · ${String(job.job_state || job.status || "").toLowerCase().replace(/_/g, " ")}${job.priority ? ` · priority ${job.priority}` : ""}${job.quantity ? ` · ${Number(job.quantity).toLocaleString("en-IN")} ${String(job.uom || "").toLowerCase()}` : ""}`} />
            ))}
          </div>
        </section>
      ) : null}

      {data?.maintenance?.schedules?.length && (isMaintenanceView || viewer?.can_manage) ? (
        <section className="rounded-2xl border border-line bg-surface-1 p-4">
          <SectionLabel count={data.maintenance.schedules.length}>Schedules on this machine</SectionLabel>
          <div className="space-y-1 text-sm">
            {data.maintenance.schedules.map((row) => (
              <div key={row.id} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2">
                <span className="font-semibold text-content-1">{row.name}</span>
                <span className="text-caption text-content-3">{row.next_due_date ? `next ${fmtDate(row.next_due_date)}` : row.interval_type === "RUN_HOURS" ? `${Number(row.run_hours_since || 0).toFixed(0)} / ${row.interval_value} h` : ""}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {recent.length && viewer?.can_view_maintenance ? (
        <section className="rounded-2xl border border-line bg-surface-1 p-4">
          <SectionLabel count={recent.length}>Recent · हाल का</SectionLabel>
          <ul className="space-y-1 text-caption text-content-2">
            {recent.slice(0, 10).map((event) => (
              <li key={`${event.kind}-${event.id}`}>
                <span className="font-mono">{fmtDateTime(event.at)}</span> · {event.kind.toLowerCase()} · {event.title}
                {event.kind === "DOWNTIME" ? ` · ${event.hours} h` : ""}
              </li>
            ))}
          </ul>
          {data ? (
            <Link href={`/maintenance/machines/${data.machine.id}`} className="mt-2 inline-flex items-center text-sm font-semibold text-primary">
              <History className="mr-1 h-4 w-4" /> Full history
            </Link>
          ) : null}
        </section>
      ) : null}

      {data ? <FaultDialog open={faultOpen} onOpenChange={setFaultOpen} machineId={data.machine.id} machineLabel={`${data.machine.code} · ${data.machine.name}`} onReported={() => refetch()} /> : null}
      <JobDialog jobId={jobId} onClose={() => { setJobId(null); refetch(); }} />
    </div>
  );
}

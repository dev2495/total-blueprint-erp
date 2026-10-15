"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, CheckCheck, ClipboardList, Wrench } from "lucide-react";

import { FaultDialog } from "@/components/maintenance/fault-dialog";
import { JobDialog } from "@/components/maintenance/job-dialog";
import { FaultStatusPill, JobStatusPill, Row, SectionLabel, SeverityPill, fmtDate, fmtDateTime } from "@/components/maintenance/ui";
import { HeroStat, HeroStats, PageHero, heroButtonClass } from "@/components/premium/page-hero";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/components/auth-provider";
import { useToast } from "@/hooks/use-toast";
import { describeApiError } from "@/lib/api";
import { factoryService } from "@/services/factory";
import { maintenanceService, type MaintenanceJob } from "@/services/maintenance";

/**
 * The five numbers first: due today, overdue, open faults, machines awaiting
 * repair, completed work awaiting verification. Then the lists behind them.
 */
export default function MaintenanceBoardPage() {
  const { user } = useAuth() as any;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [plantId, setPlantId] = useState<string>("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [faultOpen, setFaultOpen] = useState(false);
  const [verifyJob, setVerifyJob] = useState<MaintenanceJob | null>(null);
  const [verifyNote, setVerifyNote] = useState("");
  const [tab, setTab] = useState<"due_today" | "overdue" | "open_faults" | "awaiting_verification" | "machines_awaiting_repair">("due_today");

  const permissions: string[] = user?.entitlements?.permissions || [];
  const canManage = permissions.includes("*") || permissions.includes("maintenance.manage");

  const { data: plants = [] } = useQuery({ queryKey: ["factory-plants"], queryFn: factoryService.getPlants, staleTime: 10 * 60 * 1000 });
  const { data: board, isLoading } = useQuery({
    queryKey: ["maintenance", "board", plantId],
    queryFn: () => maintenanceService.board(plantId ? { plant_id: plantId } : undefined),
    refetchInterval: 60_000,
  });

  const verifyMutation = useMutation({
    mutationFn: ({ accepted }: { accepted: boolean }) => maintenanceService.verifyJob(verifyJob!.id, accepted, verifyNote),
    onSuccess: (_, variables) => {
      toast({ title: variables.accepted ? "Verified" : "Sent back to the technician" });
      setVerifyJob(null);
      setVerifyNote("");
      queryClient.invalidateQueries({ queryKey: ["maintenance"] });
    },
    onError: (err) => toast({ variant: "destructive", title: "Could not verify", description: describeApiError(err) }),
  });

  const counts = board?.counts;
  const list = useMemo(() => {
    if (!board) return [];
    return board[tab] as any[];
  }, [board, tab]);

  return (
    <div className="space-y-4 pb-10">
      <PageHero
        compact
        icon={<Wrench />}
        eyebrow="Maintenance · रखरखाव"
        title="Maintenance today"
        description="Due checks, overdue work, open faults and what is waiting for your sign-off. Scan a machine QR from your phone to work on the floor."
        actions={
          <div className="flex flex-wrap gap-2">
            <Select value={plantId || "ALL"} onValueChange={(value) => setPlantId(value === "ALL" ? "" : value)}>
              <SelectTrigger className="h-10 w-[180px] rounded-xl border-white/20 bg-white/10 text-white" aria-label="Plant">
                <SelectValue placeholder="All plants" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All plants</SelectItem>
                {plants.map((plant: any) => (
                  <SelectItem key={plant.id} value={plant.id}>
                    {plant.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <button type="button" className={heroButtonClass("primary")} onClick={() => setFaultOpen(true)} data-testid="maintenance-report-fault">
              <AlertTriangle className="mr-1.5 h-4 w-4" /> Report a fault
            </button>
            <Link href="/maintenance/jobs" className={heroButtonClass("ghost")}>
              <ClipboardList className="mr-1.5 h-4 w-4" /> All jobs
            </Link>
          </div>
        }
      >
        <HeroStats columns={5}>
          <HeroStat label="Due today" value={counts?.due_today ?? "–"} tone="warn" active={tab === "due_today"} onClick={() => setTab("due_today")} testId="maintenance-stat-due" />
          <HeroStat label="Overdue" value={counts?.overdue ?? "–"} tone="bad" active={tab === "overdue"} onClick={() => setTab("overdue")} testId="maintenance-stat-overdue" />
          <HeroStat label="Open faults" value={counts?.open_faults ?? "–"} tone="bad" active={tab === "open_faults"} onClick={() => setTab("open_faults")} testId="maintenance-stat-faults" />
          <HeroStat label="Awaiting repair" value={counts?.machines_awaiting_repair ?? "–"} tone="warn" hint="machines down" active={tab === "machines_awaiting_repair"} onClick={() => setTab("machines_awaiting_repair")} />
          <HeroStat label="Awaiting verification" value={counts?.awaiting_verification ?? "–"} tone="info" active={tab === "awaiting_verification"} onClick={() => setTab("awaiting_verification")} testId="maintenance-stat-verify" />
        </HeroStats>
      </PageHero>

      <section className="rounded-2xl border border-line bg-surface-1 p-4" data-testid={`maintenance-board-${tab}`}>
        <SectionLabel count={list.length}>
          {tab === "due_today" ? "Due today" : tab === "overdue" ? "Overdue (planned date passed)" : tab === "open_faults" ? "Open faults" : tab === "awaiting_verification" ? "Completed, waiting for sign-off" : "Machines awaiting repair"}
        </SectionLabel>
        {isLoading ? <div className="text-sm text-content-3">Loading…</div> : null}
        {!isLoading && !list.length ? <div className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-sm text-content-3">Nothing here. {tab === "overdue" ? "No overdue work." : tab === "open_faults" ? "No open faults." : "All clear."}</div> : null}
        <div className="space-y-2">
          {tab === "open_faults"
            ? list.map((fault: any) => (
                <Row
                  key={fault.id}
                  tone={fault.machine_running ? "warn" : "danger"}
                  title={
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-mono">{fault.machine_detail?.code}</span> {fault.title} <SeverityPill severity={fault.severity} /> <FaultStatusPill status={fault.status} />
                    </span>
                  }
                  subtitle={`${fault.reported_by_name || "Reported"} · ${fmtDateTime(fault.reported_at)}${fault.machine_running ? "" : " · machine stopped"}${fault.assigned_to_detail ? ` · ${fault.assigned_to_detail.name}` : ""}`}
                  right={
                    <Link href={`/maintenance/faults?focus=${fault.id}`} className="text-caption font-semibold text-primary">
                      Open
                    </Link>
                  }
                />
              ))
            : tab === "machines_awaiting_repair"
              ? list.map((machine: any) => (
                  <Row key={machine.id} tone="danger" title={`${machine.code} · ${machine.name}`} subtitle={`${machine.work_center_name || ""} · ${machine.plant_name || ""}`} right={<Link href={`/maintenance/machines/${machine.id}`} className="text-caption font-semibold text-primary">History</Link>} />
                ))
              : list.map((job: MaintenanceJob) => (
                  <Row
                    key={job.id}
                    tone={job.is_overdue ? "danger" : tab === "awaiting_verification" ? "info" : "warn"}
                    onClick={() => (tab === "awaiting_verification" && canManage ? setVerifyJob(job) : setJobId(job.id))}
                    testId={`maintenance-board-job-${job.id}`}
                    title={
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-mono">{job.machine_detail?.code}</span> {job.title} <JobStatusPill status={job.status} overdue={job.is_overdue} />
                      </span>
                    }
                    subtitle={`Planned ${fmtDate(job.planned_date)} · ${job.kind === "OPERATOR_CHECK" ? "operator check" : "technician"}${job.assigned_to_detail ? ` · ${job.assigned_to_detail.name}` : ""}${job.completed_by_name ? ` · done by ${job.completed_by_name} ${fmtDateTime(job.completed_at)}` : ""}`}
                    right={tab === "awaiting_verification" && canManage ? <span className="rounded-full bg-info-bg px-2 py-0.5 text-caption font-semibold text-info-fg">Verify</span> : <CalendarClock className="h-4 w-4 text-content-3" />}
                  />
                ))}
        </div>
      </section>

      <JobDialog jobId={jobId} onClose={() => setJobId(null)} />
      <FaultDialog open={faultOpen} onOpenChange={setFaultOpen} />
      <Dialog open={Boolean(verifyJob)} onOpenChange={(open) => (!open ? setVerifyJob(null) : null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Verify: {verifyJob?.title}</DialogTitle>
          </DialogHeader>
          {verifyJob ? (
            <div className="space-y-2 text-sm">
              <div className="text-content-3">
                {verifyJob.machine_detail?.code} · done by {verifyJob.completed_by_name} · {fmtDateTime(verifyJob.completed_at)} · {verifyJob.time_minutes} min
              </div>
              {verifyJob.notes ? <div className="rounded-lg border border-line bg-surface-2 px-3 py-2">{verifyJob.notes}</div> : null}
              {verifyJob.checklist_results?.length ? (
                <ul className="list-disc pl-5 text-caption text-content-2">
                  {verifyJob.checklist_results.map((row) => (
                    <li key={row.code}>
                      {row.code}: {row.status}
                      {row.reading != null ? ` · ${row.reading}` : ""}
                      {row.note ? ` · ${row.note}` : ""}
                    </li>
                  ))}
                </ul>
              ) : null}
              <Button type="button" variant="link" className="px-0" onClick={() => setJobId(verifyJob.id)}>
                Open the full record
              </Button>
              <Textarea rows={2} value={verifyNote} onChange={(event) => setVerifyNote(event.target.value)} placeholder="Verification note (required when sending back)" aria-label="Verification note" />
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={!verifyNote.trim() || verifyMutation.isPending} onClick={() => verifyMutation.mutate({ accepted: false })}>
              Send back
            </Button>
            <Button type="button" disabled={verifyMutation.isPending} onClick={() => verifyMutation.mutate({ accepted: true })} data-testid="maintenance-verify-accept">
              <CheckCheck className="mr-1.5 h-4 w-4" /> Verified
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

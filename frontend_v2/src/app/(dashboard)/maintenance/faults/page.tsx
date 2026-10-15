"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Camera } from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { FaultDialog } from "@/components/maintenance/fault-dialog";
import { JobDialog } from "@/components/maintenance/job-dialog";
import { FaultStatusPill, Row, SectionLabel, SeverityPill, fmtDateTime } from "@/components/maintenance/ui";
import { HeroStat, HeroStats, PageHero, heroButtonClass } from "@/components/premium/page-hero";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { describeApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { maintenanceService, type FaultStatus, type MachineFault } from "@/services/maintenance";
import { useMaintenanceUsers } from "@/components/maintenance/use-users";

export default function MaintenanceFaultsPage() {
  const { user } = useAuth() as any;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const permissions: string[] = user?.entitlements?.permissions || [];
  const canManage = permissions.includes("*") || permissions.includes("maintenance.manage");
  const canWork = canManage || permissions.includes("maintenance.work");
  const [filter, setFilter] = useState<"open" | "all">("open");
  const [reportOpen, setReportOpen] = useState(false);
  const [focus, setFocus] = useState<MachineFault | null>(null);
  const [assignTo, setAssignTo] = useState("");
  const [note, setNote] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const { data: faults = [], isLoading } = useQuery({ queryKey: ["maintenance", "faults", filter], queryFn: () => maintenanceService.faults(filter === "open" ? { open: 1 } : {}), refetchInterval: 60_000 });
  const { data: users = [] } = useMaintenanceUsers();
  const technicians = useMemo(() => users.filter((row) => ["MAINTENANCE_TECH", "MAINTENANCE_SUPERVISOR", "PLANT_MANAGER", "WORK_CENTER_MANAGER", "ADMIN", "OWNER"].includes(String(row.role_info?.code || "").toUpperCase())), [users]);

  useEffect(() => {
    const id = searchParams?.get("focus");
    if (id && faults.length && !focus) {
      const found = faults.find((row) => row.id === id);
      if (found) setFocus(found);
    }
  }, [searchParams, faults, focus]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["maintenance"] });
  const assignMutation = useMutation({
    mutationFn: () => maintenanceService.assignFault(focus!.id, { assigned_to: assignTo || null, create_job: true }),
    onSuccess: (data) => {
      toast({ title: "Assigned", description: data.job ? `Repair job created: ${data.job.title}` : undefined });
      setFocus(data.fault);
      refresh();
    },
    onError: (err) => toast({ variant: "destructive", title: "Could not assign", description: describeApiError(err) }),
  });
  const statusMutation = useMutation({
    mutationFn: (status: FaultStatus) => maintenanceService.setFaultStatus(focus!.id, status, note),
    onSuccess: (fault) => {
      toast({ title: `Fault ${fault.status.toLowerCase().replace("_", " ")}` });
      setFocus(fault);
      setNote("");
      refresh();
    },
    onError: (err) => toast({ variant: "destructive", title: "Could not update", description: describeApiError(err) }),
  });

  const counts = useMemo(() => ({ stopped: faults.filter((f) => !f.machine_running && ["OPEN", "ASSIGNED", "IN_REPAIR"].includes(f.status)).length, open: faults.filter((f) => ["OPEN", "ASSIGNED", "IN_REPAIR"].includes(f.status)).length }), [faults]);

  return (
    <div className="space-y-4 pb-10">
      <PageHero
        compact
        icon={<AlertTriangle />}
        eyebrow="Maintenance · खराबी"
        title="Machine faults"
        description="Reported from the floor. Assigning creates the repair job; resolving brings the machine back to active."
        actions={
          <button type="button" className={heroButtonClass("primary")} onClick={() => setReportOpen(true)} data-testid="faults-report">
            <AlertTriangle className="mr-1.5 h-4 w-4" /> Report a fault
          </button>
        }
      >
        <HeroStats columns={3}>
          <HeroStat label="Open" value={counts.open} tone="warn" />
          <HeroStat label="Machine stopped" value={counts.stopped} tone="bad" />
          <HeroStat label="Showing" value={faults.length} />
        </HeroStats>
      </PageHero>
      <div className="flex gap-2">
        {(["open", "all"] as const).map((key) => (
          <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)} className={cn("rounded-full border px-3 py-1.5 text-sm font-semibold", filter === key ? "border-primary bg-info-bg text-primary" : "border-line bg-surface-1 text-content-2")}>
            {key === "open" ? "Open" : "All"}
          </button>
        ))}
      </div>
      <section className="rounded-2xl border border-line bg-surface-1 p-3">
        <SectionLabel count={faults.length}>Faults</SectionLabel>
        {isLoading ? <div className="text-sm text-content-3">Loading…</div> : null}
        {!isLoading && !faults.length ? <div className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-sm text-content-3">No faults.</div> : null}
        <div className="space-y-2">
          {faults.map((fault) => (
            <Row
              key={fault.id}
              tone={["OPEN", "ASSIGNED", "IN_REPAIR"].includes(fault.status) ? (fault.machine_running ? "warn" : "danger") : undefined}
              onClick={() => {
                setFocus(fault);
                setAssignTo(fault.assigned_to || "");
              }}
              testId={`fault-row-${fault.id}`}
              title={
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-mono">{fault.machine_detail?.code}</span> {fault.title} <SeverityPill severity={fault.severity} /> <FaultStatusPill status={fault.status} />
                </span>
              }
              subtitle={`${fault.reported_by_name || "Reported"} · ${fmtDateTime(fault.reported_at)}${fault.machine_running ? "" : " · machine stopped"}${fault.assigned_to_detail ? ` · ${fault.assigned_to_detail.name}` : ""}${fault.production_job_number ? ` · on ${fault.production_job_number}` : ""}`}
            />
          ))}
        </div>
      </section>

      <FaultDialog open={reportOpen} onOpenChange={setReportOpen} />
      <JobDialog jobId={jobId} onClose={() => setJobId(null)} />
      <Dialog open={Boolean(focus)} onOpenChange={(open) => (!open ? setFocus(null) : null)}>
        <DialogContent className="max-w-xl">
          {focus ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2">
                  {focus.machine_detail?.code} · {focus.title} <SeverityPill severity={focus.severity} /> <FaultStatusPill status={focus.status} />
                </DialogTitle>
                <DialogDescription>
                  {focus.reported_by_name} · {fmtDateTime(focus.reported_at)} · {focus.machine_running ? "machine running" : "machine stopped"}
                </DialogDescription>
              </DialogHeader>
              {focus.description ? <div className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm">{focus.description}</div> : null}
              {focus.resolution_note ? <div className="rounded-lg border border-success-border bg-success-bg px-3 py-2 text-sm text-success-fg">Resolution: {focus.resolution_note}</div> : null}
              <div className="flex flex-wrap items-center gap-2">
                {(focus.attachments || []).map((file) => (
                  <a key={file.id} href={file.url} target="_blank" rel="noreferrer" className="block h-14 w-14 overflow-hidden rounded-lg border border-line bg-surface-2">
                    {file.content_type.startsWith("image/") ? <img src={file.url} alt={file.original_name} className="h-full w-full object-cover" /> : <span className="flex h-full items-center justify-center text-caption">PDF</span>}
                  </a>
                ))}
                <label className="inline-flex h-14 cursor-pointer items-center gap-1 rounded-lg border border-line px-3 text-sm">
                  <Camera className="h-4 w-4" /> {uploading ? "Uploading…" : "Add photo"}
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    capture="environment"
                    className="hidden"
                    aria-label="Add a photo to this fault"
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      setUploading(true);
                      try {
                        await maintenanceService.uploadAttachment(file, { fault: focus.id });
                        const fresh = (await maintenanceService.faults({ machine_id: focus.machine })).find((row) => row.id === focus.id);
                        if (fresh) setFocus(fresh);
                        refresh();
                      } catch (err) {
                        toast({ variant: "destructive", title: "Photo not attached", description: describeApiError(err) });
                      } finally {
                        setUploading(false);
                      }
                    }}
                  />
                </label>
              </div>
              {focus.open_job_id ? (
                <Button type="button" variant="outline" onClick={() => setJobId(focus.open_job_id as string)}>
                  Open repair job
                </Button>
              ) : null}
              {canManage && ["OPEN", "ASSIGNED"].includes(focus.status) ? (
                <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                  <Select value={assignTo || "NONE"} onValueChange={(value) => setAssignTo(value === "NONE" ? "" : value)}>
                    <SelectTrigger aria-label="Assign to">
                      <SelectValue placeholder="Assign to" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="NONE">Unassigned</SelectItem>
                      {technicians.map((row) => (
                        <SelectItem key={row.id} value={row.id}>
                          {row.full_name || row.username}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button type="button" disabled={assignMutation.isPending} onClick={() => assignMutation.mutate()} data-testid="fault-assign">
                    Assign and create repair job
                  </Button>
                </div>
              ) : null}
              {canWork && ["OPEN", "ASSIGNED", "IN_REPAIR"].includes(focus.status) ? (
                <>
                  <Textarea rows={2} value={note} onChange={(event) => setNote(event.target.value)} placeholder="What was done (required to resolve)" aria-label="Resolution note" />
                  <DialogFooter className="gap-2">
                    {focus.status !== "IN_REPAIR" ? (
                      <Button type="button" variant="outline" onClick={() => statusMutation.mutate("IN_REPAIR")} disabled={statusMutation.isPending}>
                        In repair
                      </Button>
                    ) : null}
                    <Button type="button" onClick={() => statusMutation.mutate("RESOLVED")} disabled={statusMutation.isPending || !note.trim()} data-testid="fault-resolve">
                      Resolved · ठीक हो गया
                    </Button>
                    {canManage ? (
                      <Button type="button" variant="ghost" onClick={() => statusMutation.mutate("DISMISSED")} disabled={statusMutation.isPending || !note.trim()}>
                        Dismiss
                      </Button>
                    ) : null}
                  </DialogFooter>
                </>
              ) : null}
              {canManage && focus.status === "RESOLVED" ? (
                <DialogFooter>
                  <Button type="button" onClick={() => statusMutation.mutate("CLOSED")} disabled={statusMutation.isPending}>
                    Close fault
                  </Button>
                </DialogFooter>
              ) : null}
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

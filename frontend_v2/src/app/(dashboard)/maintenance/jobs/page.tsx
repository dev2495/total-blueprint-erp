"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList, Plus } from "lucide-react";

import { useAuth } from "@/components/auth-provider";
import { JobDialog } from "@/components/maintenance/job-dialog";
import { JobStatusPill, Row, SectionLabel, fmtDate, fmtDateTime } from "@/components/maintenance/ui";
import { HeroStat, HeroStats, PageHero, heroButtonClass } from "@/components/premium/page-hero";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { api, describeApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { maintenanceService, type MaintenanceJob } from "@/services/maintenance";

type Filter = "mine" | "open" | "overdue" | "verify" | "done" | "all";

export default function MaintenanceJobsPage() {
  const { user } = useAuth() as any;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const permissions: string[] = user?.entitlements?.permissions || [];
  const canManage = permissions.includes("*") || permissions.includes("maintenance.manage");
  const canWork = canManage || permissions.includes("maintenance.work");
  const [filter, setFilter] = useState<Filter>(canWork && !canManage ? "mine" : "open");
  const [machineFilter, setMachineFilter] = useState("");
  const [search, setSearch] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ machine: "", title: "", planned_date: new Date().toISOString().slice(0, 10), kind: "TECH_SERVICE", assigned_role: "MAINTENANCE_TECH", notes: "", requires_verification: false });

  const params = useMemo(() => {
    const out: Record<string, string | number | boolean> = {};
    if (filter === "mine") out.mine = 1;
    if (filter === "open" || filter === "mine" || filter === "overdue") out.open = 1;
    if (filter === "verify") out.status = "AWAITING_VERIFICATION";
    if (filter === "done") out.status = "DONE,VERIFIED";
    if (machineFilter) out.machine_id = machineFilter;
    return out;
  }, [filter, machineFilter]);

  const { data: jobs = [], isLoading } = useQuery({ queryKey: ["maintenance", "jobs", params], queryFn: () => maintenanceService.jobs(params), refetchInterval: 60_000 });
  const { data: machines = [] } = useQuery({
    queryKey: ["factory-machines-all"],
    queryFn: async () => {
      const { data } = await api.get("/api/factory/machines/", { params: { page_size: 500 } });
      return (Array.isArray(data) ? data : data?.results || data?.data || []) as Array<{ id: string; code: string; name: string }>;
    },
    staleTime: 5 * 60 * 1000,
  });

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return jobs
      .filter((job) => (filter === "overdue" ? job.is_overdue : true))
      .filter((job) => !needle || `${job.title} ${job.machine_detail?.code} ${job.machine_detail?.name} ${job.assigned_to_detail?.name || ""}`.toLowerCase().includes(needle));
  }, [jobs, filter, search]);

  const createMutation = useMutation({
    mutationFn: () => maintenanceService.createJob({ ...(form as any) }),
    onSuccess: (job) => {
      toast({ title: "Job added" });
      setCreateOpen(false);
      queryClient.invalidateQueries({ queryKey: ["maintenance"] });
      setJobId(job.id);
    },
    onError: (err) => toast({ variant: "destructive", title: "Could not add", description: describeApiError(err) }),
  });

  const counts = useMemo(() => ({ open: jobs.filter((j) => ["DUE", "IN_PROGRESS", "ISSUE_FOUND", "UNABLE"].includes(j.status)).length, overdue: jobs.filter((j) => j.is_overdue).length }), [jobs]);

  return (
    <div className="space-y-4 pb-10">
      <PageHero
        compact
        icon={<ClipboardList />}
        eyebrow="Maintenance · काम"
        title={canWork && !canManage ? "My maintenance jobs" : "Maintenance jobs"}
        description="Tap a job to record the work: checks, readings, spares used, time and the outcome."
        actions={
          canWork ? (
            <button type="button" className={heroButtonClass("primary")} onClick={() => setCreateOpen(true)} data-testid="maintenance-add-job">
              <Plus className="mr-1.5 h-4 w-4" /> Add job
            </button>
          ) : null
        }
      >
        <HeroStats columns={3}>
          <HeroStat label="In this list" value={visible.length} />
          <HeroStat label="Open" value={counts.open} tone="warn" />
          <HeroStat label="Overdue" value={counts.overdue} tone="bad" />
        </HeroStats>
      </PageHero>

      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            ["mine", "Mine"],
            ["open", "Open"],
            ["overdue", "Overdue"],
            ["verify", "To verify"],
            ["done", "Done"],
            ["all", "All"],
          ] as Array<[Filter, string]>
        ).map(([key, label]) => (
          <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)} className={cn("rounded-full border px-3 py-1.5 text-sm font-semibold", filter === key ? "border-primary bg-info-bg text-primary" : "border-line bg-surface-1 text-content-2")} data-testid={`maintenance-filter-${key}`}>
            {label}
          </button>
        ))}
        <Select value={machineFilter || "ALL"} onValueChange={(value) => setMachineFilter(value === "ALL" ? "" : value)}>
          <SelectTrigger className="h-9 w-[200px]" aria-label="Machine filter">
            <SelectValue placeholder="All machines" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All machines</SelectItem>
            {machines.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.code} · {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search" aria-label="Search jobs" className="h-9 w-[200px]" />
      </div>

      <section className="rounded-2xl border border-line bg-surface-1 p-3">
        <SectionLabel count={visible.length}>Jobs</SectionLabel>
        {isLoading ? <div className="text-sm text-content-3">Loading…</div> : null}
        {!isLoading && !visible.length ? <div className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-sm text-content-3">No jobs match.</div> : null}
        <div className="space-y-2">
          {visible.map((job: MaintenanceJob) => (
            <Row
              key={job.id}
              tone={job.is_overdue ? "danger" : job.status === "AWAITING_VERIFICATION" ? "info" : job.status === "DUE" ? "warn" : undefined}
              onClick={() => setJobId(job.id)}
              testId={`maintenance-job-row-${job.id}`}
              title={
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-mono">{job.machine_detail?.code}</span> {job.title} <JobStatusPill status={job.status} overdue={job.is_overdue} />
                </span>
              }
              subtitle={`Planned ${fmtDate(job.planned_date)} · ${job.kind === "OPERATOR_CHECK" ? "operator check" : "technician"}${job.assigned_to_detail ? ` · ${job.assigned_to_detail.name}` : ""}${job.completed_at ? ` · done ${fmtDateTime(job.completed_at)}` : ""}${job.fault_title ? ` · fault: ${job.fault_title}` : ""}`}
            />
          ))}
        </div>
      </section>

      <JobDialog jobId={jobId} onClose={() => setJobId(null)} />
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add a maintenance job</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Select value={form.machine} onValueChange={(value) => setForm((f) => ({ ...f, machine: value }))}>
              <SelectTrigger aria-label="Machine">
                <SelectValue placeholder="Machine" />
              </SelectTrigger>
              <SelectContent>
                {machines.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.code} · {m.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input value={form.title} onChange={(event) => setForm((f) => ({ ...f, title: event.target.value }))} placeholder="What needs doing" aria-label="Job title" />
            <div className="grid grid-cols-2 gap-2">
              <Input type="date" value={form.planned_date} onChange={(event) => setForm((f) => ({ ...f, planned_date: event.target.value }))} aria-label="Planned date" />
              <Select value={form.kind} onValueChange={(value) => setForm((f) => ({ ...f, kind: value, assigned_role: value === "OPERATOR_CHECK" ? "OPERATOR" : "MAINTENANCE_TECH" }))}>
                <SelectTrigger aria-label="Kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TECH_SERVICE">Technician service</SelectItem>
                  <SelectItem value="OPERATOR_CHECK">Operator check</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Textarea rows={2} value={form.notes} onChange={(event) => setForm((f) => ({ ...f, notes: event.target.value }))} placeholder="Notes for whoever does it" aria-label="Notes" />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.requires_verification} onChange={(event) => setForm((f) => ({ ...f, requires_verification: event.target.checked }))} /> Needs supervisor verification
            </label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={!form.machine || !form.title.trim() || createMutation.isPending} onClick={() => createMutation.mutate()}>
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

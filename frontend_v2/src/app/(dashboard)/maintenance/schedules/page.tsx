"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarRange, Plus, Trash2 } from "lucide-react";

import { useMaintenanceUsers } from "@/components/maintenance/use-users";
import { Row, SectionLabel, fmtDate, fmtDateTime } from "@/components/maintenance/ui";
import { HeroStat, HeroStats, PageHero, heroButtonClass } from "@/components/premium/page-hero";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { api, describeApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { maintenanceService, type ChecklistItem, type MaintenanceSchedule } from "@/services/maintenance";

const EMPTY: Partial<MaintenanceSchedule> = {
  name: "",
  name_hi: "",
  kind: "OPERATOR_CHECK",
  interval_type: "DAILY",
  interval_value: 1,
  due_rule: "FIXED_CALENDAR",
  anchor_date: new Date().toISOString().slice(0, 10),
  checklist: [],
  assigned_role: "OPERATOR",
  responsible_user: null,
  requires_verification: false,
  is_critical: false,
  estimated_minutes: 0,
  needs_production_stop: false,
  is_active: true,
};

const STARTER_CHECKS: ChecklistItem[] = [
  { code: "OIL", label: "Oil level", label_hi: "तेल", kind: "OK_ISSUE" },
  { code: "NOISE", label: "Unusual noise or vibration", label_hi: "आवाज़ / कंपन", kind: "OK_ISSUE" },
  { code: "LEAK", label: "Leaks (oil, air, water)", label_hi: "लीक", kind: "OK_ISSUE" },
  { code: "GUARD", label: "Safety guards in place", label_hi: "सेफ्टी गार्ड", kind: "OK_ISSUE" },
];

export default function MaintenanceSchedulesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [machineFilter, setMachineFilter] = useState("");
  const [editing, setEditing] = useState<Partial<MaintenanceSchedule> | null>(null);

  const { data: schedules = [], isLoading } = useQuery({ queryKey: ["maintenance", "schedules", machineFilter], queryFn: () => maintenanceService.schedules(machineFilter ? { machine_id: machineFilter } : {}) });
  const { data: machines = [] } = useQuery({
    queryKey: ["factory-machines-all"],
    queryFn: async () => {
      const { data } = await api.get("/api/factory/machines/", { params: { page_size: 500 } });
      return (Array.isArray(data) ? data : data?.results || data?.data || []) as Array<{ id: string; code: string; name: string; work_center_name?: string }>;
    },
    staleTime: 5 * 60 * 1000,
  });
  const { data: users = [] } = useMaintenanceUsers();

  const saveMutation = useMutation({
    mutationFn: () => maintenanceService.saveSchedule(editing as any),
    onSuccess: () => {
      toast({ title: "Schedule saved" });
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ["maintenance"] });
    },
    onError: (err) => toast({ variant: "destructive", title: "Could not save", description: describeApiError(err) }),
  });
  const generateMutation = useMutation({
    mutationFn: () => maintenanceService.generateDue(0),
    onSuccess: (stats) => {
      toast({ title: "Due jobs generated", description: `${stats.created} new job(s) from ${stats.checked} schedule(s).` });
      queryClient.invalidateQueries({ queryKey: ["maintenance"] });
    },
    onError: (err) => toast({ variant: "destructive", title: "Could not generate", description: describeApiError(err) }),
  });
  const deactivateMutation = useMutation({
    mutationFn: (id: string) => maintenanceService.deactivateSchedule(id),
    onSuccess: () => {
      toast({ title: "Schedule switched off" });
      queryClient.invalidateQueries({ queryKey: ["maintenance"] });
    },
  });

  const byMachine = useMemo(() => {
    const groups: Record<string, MaintenanceSchedule[]> = {};
    schedules.forEach((row) => {
      const key = `${row.machine_detail?.code || ""} · ${row.machine_detail?.name || ""}`;
      (groups[key] ||= []).push(row);
    });
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [schedules]);

  const setField = (patch: Partial<MaintenanceSchedule>) => setEditing((current) => ({ ...(current || {}), ...patch }));
  const checklist = editing?.checklist || [];

  return (
    <div className="space-y-4 pb-10">
      <PageHero
        compact
        icon={<CalendarRange />}
        eyebrow="Maintenance · set up"
        title="Maintenance schedules"
        description="Daily, weekly, monthly or running-hour intervals per machine. Fixed-calendar schedules never drift when work is late; interval schedules count from the last completion. Due jobs are created every morning at 05:30."
        actions={
          <div className="flex flex-wrap gap-2">
            <button type="button" className={heroButtonClass("ghost")} onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending} data-testid="schedules-generate">
              Create due jobs now
            </button>
            <button type="button" className={heroButtonClass("primary")} onClick={() => setEditing({ ...EMPTY, machine: machineFilter || undefined })} data-testid="schedules-add">
              <Plus className="mr-1.5 h-4 w-4" /> New schedule
            </button>
          </div>
        }
      >
        <HeroStats columns={3}>
          <HeroStat label="Schedules" value={schedules.length} />
          <HeroStat label="Operator checks" value={schedules.filter((s) => s.kind === "OPERATOR_CHECK").length} />
          <HeroStat label="Technician services" value={schedules.filter((s) => s.kind === "TECH_SERVICE").length} />
        </HeroStats>
      </PageHero>

      <Select value={machineFilter || "ALL"} onValueChange={(value) => setMachineFilter(value === "ALL" ? "" : value)}>
        <SelectTrigger className="h-9 w-[240px]" aria-label="Machine filter">
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

      {isLoading ? <div className="text-sm text-content-3">Loading…</div> : null}
      {!isLoading && !schedules.length ? <div className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-sm text-content-3">No schedules yet. Start with three important machines and their real daily checks.</div> : null}
      {byMachine.map(([machine, rows]) => (
        <section key={machine} className="rounded-2xl border border-line bg-surface-1 p-3">
          <SectionLabel count={rows.length}>{machine}</SectionLabel>
          <div className="space-y-2">
            {rows.map((row) => (
              <Row
                key={row.id}
                onClick={() => setEditing({ ...row, machine: row.machine })}
                testId={`schedule-row-${row.id}`}
                title={
                  <span className="flex flex-wrap items-center gap-2">
                    {row.name}
                    {row.is_critical ? <span className="rounded-full bg-danger-bg px-2 text-caption font-semibold text-danger-fg">critical</span> : null}
                    {row.requires_verification ? <span className="rounded-full bg-info-bg px-2 text-caption font-semibold text-info-fg">verified</span> : null}
                  </span>
                }
                subtitle={`${row.kind === "OPERATOR_CHECK" ? "Operator check" : "Technician"} · ${row.interval_type === "RUN_HOURS" ? `every ${row.interval_value} running hours (${Number(row.run_hours_since || 0).toFixed(1)} h since last)` : `every ${row.interval_value} ${row.interval_type.toLowerCase().replace("ly", "")}${row.interval_value > 1 ? "s" : ""}`} · ${row.due_rule === "FIXED_CALENDAR" ? "fixed calendar" : "after last service"}${row.next_due_date ? ` · next ${fmtDate(row.next_due_date)}` : ""}${row.last_completed_at ? ` · last ${fmtDateTime(row.last_completed_at)}` : ""} · ${row.checklist?.length || 0} checks`}
                right={<span className="text-caption font-semibold text-primary">Edit</span>}
              />
            ))}
          </div>
        </section>
      ))}

      <Dialog open={Boolean(editing)} onOpenChange={(open) => (!open ? setEditing(null) : null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit schedule" : "New schedule"}</DialogTitle>
            <DialogDescription>Keep the operator check short; put detail in the technician service.</DialogDescription>
          </DialogHeader>
          {editing ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Select value={String(editing.machine || "")} onValueChange={(value) => setField({ machine: value })}>
                <SelectTrigger aria-label="Machine" data-testid="schedule-machine">
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
              <Select value={editing.kind} onValueChange={(value) => setField({ kind: value as any, assigned_role: value === "OPERATOR_CHECK" ? "OPERATOR" : "MAINTENANCE_TECH" })}>
                <SelectTrigger aria-label="Kind">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="OPERATOR_CHECK">Operator check (short, on the machine)</SelectItem>
                  <SelectItem value="TECH_SERVICE">Technician service (detailed job)</SelectItem>
                </SelectContent>
              </Select>
              <Input value={editing.name || ""} onChange={(event) => setField({ name: event.target.value })} placeholder="Name, e.g. Daily start-up check" aria-label="Schedule name" data-testid="schedule-name" />
              <Input value={editing.name_hi || ""} onChange={(event) => setField({ name_hi: event.target.value })} placeholder="Hindi name (shown on the phone)" aria-label="Hindi name" />
              <div className="grid grid-cols-[1fr_90px] gap-2">
                <Select value={editing.interval_type} onValueChange={(value) => setField({ interval_type: value as any })}>
                  <SelectTrigger aria-label="Interval">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DAILY">Every N days</SelectItem>
                    <SelectItem value="WEEKLY">Every N weeks</SelectItem>
                    <SelectItem value="MONTHLY">Every N months</SelectItem>
                    <SelectItem value="RUN_HOURS">Every N running hours</SelectItem>
                  </SelectContent>
                </Select>
                <Input type="number" min={1} value={editing.interval_value ?? 1} onChange={(event) => setField({ interval_value: Number(event.target.value || 1) })} aria-label="Interval value" />
              </div>
              <Select value={editing.due_rule} onValueChange={(value) => setField({ due_rule: value as any })}>
                <SelectTrigger aria-label="Due rule">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="FIXED_CALENDAR">Fixed calendar (late work does not move the next date)</SelectItem>
                  <SelectItem value="AFTER_LAST_SERVICE">Interval after the last completion</SelectItem>
                </SelectContent>
              </Select>
              <label className="text-sm">
                <span className="mb-1 block text-[12px] font-semibold text-content-3">First due date</span>
                <Input type="date" value={editing.anchor_date || ""} onChange={(event) => setField({ anchor_date: event.target.value })} aria-label="First due date" />
              </label>
              <Select value={String(editing.responsible_user || "NONE")} onValueChange={(value) => setField({ responsible_user: value === "NONE" ? null : value })}>
                <SelectTrigger aria-label="Responsible person">
                  <SelectValue placeholder="Responsible person" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">Anyone in the role</SelectItem>
                  {users.map((row) => (
                    <SelectItem key={row.id} value={row.id}>
                      {row.full_name || row.username}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex flex-wrap gap-4 text-sm sm:col-span-2">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={Boolean(editing.is_critical)} onChange={(event) => setField({ is_critical: event.target.checked, requires_verification: event.target.checked || editing.requires_verification })} /> Critical (always verified)
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={Boolean(editing.requires_verification)} onChange={(event) => setField({ requires_verification: event.target.checked })} /> Supervisor verifies
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={Boolean(editing.needs_production_stop)} onChange={(event) => setField({ needs_production_stop: event.target.checked })} /> Needs a production stop
                </label>
                <label className="flex items-center gap-2">
                  Est. minutes <Input type="number" className="h-8 w-20" value={editing.estimated_minutes ?? 0} onChange={(event) => setField({ estimated_minutes: Number(event.target.value || 0) })} aria-label="Estimated minutes" />
                </label>
              </div>
              <div className="sm:col-span-2">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[12px] font-semibold text-content-3">Checklist ({checklist.length})</span>
                  <div className="flex gap-1">
                    {!checklist.length ? (
                      <Button type="button" size="sm" variant="ghost" onClick={() => setField({ checklist: STARTER_CHECKS })}>
                        Use starter checks
                      </Button>
                    ) : null}
                    <Button type="button" size="sm" variant="outline" onClick={() => setField({ checklist: [...checklist, { code: `C${checklist.length + 1}`, label: "", label_hi: "", kind: "OK_ISSUE" }] })}>
                      <Plus className="mr-1 h-3.5 w-3.5" /> Add check
                    </Button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  {checklist.map((item, index) => (
                    <div key={index} className={cn("grid items-center gap-1.5", item.kind === "READING" ? "grid-cols-[70px_1fr_1fr_90px_60px_60px_60px_32px]" : "grid-cols-[70px_1fr_1fr_90px_32px]")}>
                      <Input value={item.code} aria-label="Check code" onChange={(event) => setField({ checklist: checklist.map((c, i) => (i === index ? { ...c, code: event.target.value.toUpperCase() } : c)) })} />
                      <Input value={item.label} placeholder="Check" aria-label="Check label" onChange={(event) => setField({ checklist: checklist.map((c, i) => (i === index ? { ...c, label: event.target.value } : c)) })} />
                      <Input value={item.label_hi || ""} placeholder="Hindi" aria-label="Check Hindi label" onChange={(event) => setField({ checklist: checklist.map((c, i) => (i === index ? { ...c, label_hi: event.target.value } : c)) })} />
                      <Select value={item.kind} onValueChange={(value) => setField({ checklist: checklist.map((c, i) => (i === index ? { ...c, kind: value as any } : c)) })}>
                        <SelectTrigger aria-label="Check kind">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="OK_ISSUE">OK / Issue</SelectItem>
                          <SelectItem value="READING">Reading</SelectItem>
                        </SelectContent>
                      </Select>
                      {item.kind === "READING" ? (
                        <>
                          <Input value={item.unit || ""} placeholder="unit" aria-label="Unit" onChange={(event) => setField({ checklist: checklist.map((c, i) => (i === index ? { ...c, unit: event.target.value } : c)) })} />
                          <Input type="number" value={item.min ?? ""} placeholder="min" aria-label="Minimum" onChange={(event) => setField({ checklist: checklist.map((c, i) => (i === index ? { ...c, min: event.target.value === "" ? null : Number(event.target.value) } : c)) })} />
                          <Input type="number" value={item.max ?? ""} placeholder="max" aria-label="Maximum" onChange={(event) => setField({ checklist: checklist.map((c, i) => (i === index ? { ...c, max: event.target.value === "" ? null : Number(event.target.value) } : c)) })} />
                        </>
                      ) : null}
                      <Button type="button" variant="ghost" size="icon" aria-label="Remove check" onClick={() => setField({ checklist: checklist.filter((_, i) => i !== index) })}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
          <DialogFooter className="gap-2">
            {editing?.id ? (
              <Button type="button" variant="ghost" className="text-danger-fg" onClick={() => deactivateMutation.mutate(editing.id as string)} disabled={deactivateMutation.isPending}>
                Switch off
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button type="button" disabled={!editing?.machine || !editing?.name?.trim() || !editing?.anchor_date || saveMutation.isPending} onClick={() => saveMutation.mutate()} data-testid="schedule-save">
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

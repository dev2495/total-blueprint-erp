"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Cpu,
  Factory,
  Gauge,
  Layers,
  ListChecks,
  PackageCheck,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  TimerReset,
  Wrench,
  Zap,
} from "lucide-react";

import { analyticsApi } from "@/services/analytics";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Priority = "HIGH" | "MEDIUM" | "LOW";

type ActionItem = {
  id: string;
  priority: Priority;
  title: string;
  subtitle: string;
  href?: string;
  action_label?: string;
};

type WorkCenterRow = {
  id: string;
  name: string;
  plant?: string;
  machine_count?: number;
  running_machines?: number;
  blocked_jobs?: number;
  pending_jobs?: number;
  oee_avg?: number;
  output_kg?: number;
  scrap_kg?: number;
};

type MachineCluster = {
  key: string;
  label: string;
  count: number;
  hint?: string;
};

type RecentActivity = {
  family?: string;
  title?: string;
  message?: string;
  subtitle?: string;
  description?: string;
  detail?: string;
  date?: string;
  logged_at?: string;
};

const actionFilters = [
  { key: "all", label: "All actions" },
  { key: "high", label: "High priority" },
  { key: "blocked", label: "Blocked jobs" },
  { key: "assignment", label: "Machine assignment" },
  { key: "operator", label: "Operator coverage" },
] as const;

const clusterTone: Record<string, { badge: string; icon: string; href: string }> = {
  running: { badge: "border-success-border bg-success-bg text-success-fg", icon: "text-success-fg", href: "/production/work-center" },
  ready: { badge: "border-info-border bg-info-bg text-info-fg", icon: "text-info-fg", href: "/production/work-center" },
  blocked: { badge: "border-danger-border bg-danger-bg text-danger-fg", icon: "text-danger-fg", href: "/production/work-center" },
  idle: { badge: "border-line bg-surface-2 text-content-2", icon: "text-content-3", href: "/factory/machines" },
  no_operator: { badge: "border-warning-border bg-warning-bg text-warning-fg", icon: "text-warning-fg", href: "/production/work-center" },
  no_machine: { badge: "border-info-border bg-info-bg text-info-fg", icon: "text-info-fg", href: "/production/machine-selector" },
};

const priorityTone: Record<Priority, string> = {
  HIGH: "border-danger-border bg-danger-bg text-danger-fg",
  MEDIUM: "border-warning-border bg-warning-bg text-warning-fg",
  LOW: "border-info-border bg-info-bg text-info-fg",
};

function fmt(value: unknown, decimals = 0) {
  const numeric = typeof value === "number" ? value : Number(value || 0);
  if (!Number.isFinite(numeric)) return "0";
  return numeric.toLocaleString("en-IN", { maximumFractionDigits: decimals });
}

function pct(value: unknown, decimals = 1) {
  return `${fmt(value, decimals)}%`;
}

function kg(value: unknown, decimals = 0) {
  return `${fmt(value, decimals)} kg`;
}

function minutes(value: unknown) {
  return `${fmt(value)} min`;
}

function normalizeActionHref(item: ActionItem) {
  const href = String(item.href || "").trim();
  if (href.includes("/production/machine-selector")) return "/production/machine-selector";
  if (href.includes("/production/work-center")) return href;
  if (href.includes("/factory/")) return href;
  if (/needs a machine/i.test(item.title) || /machine assignment/i.test(item.subtitle)) return "/production/machine-selector";
  return "/production/work-center";
}

function actionKind(item: ActionItem) {
  const text = `${item.title} ${item.subtitle} ${item.action_label || ""}`.toLowerCase();
  if (item.priority === "HIGH" || text.includes("blocked") || text.includes("hold")) return "blocked";
  if (text.includes("machine")) return "assignment";
  if (text.includes("operator")) return "operator";
  return "all";
}

function formatGeneratedAt(value: unknown) {
  if (!value) return "Live sync pending";
  const date = typeof value === "number" ? new Date(value) : new Date(String(value));
  if (Number.isNaN(date.getTime())) return "Synced recently";
  return `Synced ${date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`;
}

function KpiTile({
  label,
  value,
  hint,
  icon,
  tone = "blue",
}: {
  label: string;
  value: string;
  hint: string;
  icon: React.ReactNode;
  tone?: "blue" | "green" | "amber" | "rose" | "slate" | "cyan";
}) {
  const toneClasses = {
    blue: "bg-info-bg text-info-fg ring-info-border",
    green: "bg-success-bg text-success-fg ring-success-border",
    amber: "bg-warning-bg text-warning-fg ring-warning-border",
    rose: "bg-danger-bg text-danger-fg ring-danger-border",
    slate: "bg-surface-2 text-content-2 ring-line",
    cyan: "bg-info-bg text-info-fg ring-info-border",
  }[tone];

  return (
    <div className="min-h-[132px] rounded-lg border border-line bg-white p-4 shadow-[0_1px_0_rgba(15,23,42,0.04),0_10px_28px_rgba(15,23,42,0.05)]">
      <div className="flex items-start justify-between gap-3">
        <div className="text-[10px] font-black uppercase tracking-[0.12em] text-content-3">{label}</div>
        <div className={cn("grid h-9 w-9 place-items-center rounded-lg ring-1", toneClasses)}>{icon}</div>
      </div>
      <div className="mt-4 font-display text-3xl font-black leading-none tracking-[-0.05em] text-content-1">{value}</div>
      <div className="mt-2 text-xs font-bold leading-5 text-content-3">{hint}</div>
    </div>
  );
}

function SectionHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[72px] flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
      <div className="min-w-0">
        <h2 className="font-display text-lg font-black tracking-[-0.03em] text-content-1">{title}</h2>
        <p className="mt-1 text-xs font-semibold leading-5 text-content-3">{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

function EmptyGreen({ text }: { text: string }) {
  return (
    <div className="rounded-lg border border-success-border bg-success-bg p-5 text-sm font-bold leading-6 text-success-fg">
      <CheckCircle2 className="mb-2 h-5 w-5" />
      {text}
    </div>
  );
}

function MiniBar({ value, tone = "green" }: { value: number; tone?: "green" | "amber" | "rose" | "blue" | "slate" }) {
  const color = {
    green: "bg-success-bg0",
    amber: "bg-warning-bg0",
    rose: "bg-danger-bg0",
    blue: "bg-info-bg0",
    slate: "bg-line-strong",
  }[tone];

  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_48px] items-center gap-2">
      <div className="h-2 overflow-hidden rounded-full bg-line">
        <div className={cn("h-full rounded-full", color)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
      <div className="text-right text-xs font-black tabular-nums text-content-2">{pct(value, 1)}</div>
    </div>
  );
}

export default function WorkCenterDashboard() {
  const [filter, setFilter] = useState<(typeof actionFilters)[number]["key"]>("all");
  const [search, setSearch] = useState("");

  const { data, isLoading, isFetching, isError, dataUpdatedAt, refetch } = useQuery({
    queryKey: ["wcm-dashboard"],
    queryFn: () => analyticsApi.getWcmDashboard(),
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: false,
    refetchOnMount: "always",
    placeholderData: (previous) => previous,
  });

  const payload = (data as any) || {};
  const hero = payload.hero || {};
  const summary = payload.summary || {};
  const discipline = payload.discipline || {};
  const costing = payload.costing || {};
  const machineClusters: MachineCluster[] = Array.isArray(payload.machine_clusters) ? payload.machine_clusters : [];
  const workCenters: WorkCenterRow[] = Array.isArray(payload.work_centers) ? payload.work_centers : [];
  const needsAction: ActionItem[] = Array.isArray(payload.needs_action) ? payload.needs_action : [];
  const recentActivity: RecentActivity[] = Array.isArray(payload.recent_activity) ? payload.recent_activity : [];

  const searchText = search.trim().toLowerCase();
  const filteredActions = useMemo(() => {
    return needsAction.filter((item) => {
      const kind = actionKind(item);
      const matchesFilter =
        filter === "all" ||
        (filter === "high" && item.priority === "HIGH") ||
        kind === filter;
      const matchesSearch =
        !searchText ||
        `${item.title} ${item.subtitle} ${item.action_label || ""}`.toLowerCase().includes(searchText);
      return matchesFilter && matchesSearch;
    });
  }, [filter, needsAction, searchText]);

  const activeWorkCenterCount = Number(hero.active_work_centers || workCenters.length || 0);
  const totalMachines = workCenters.reduce((sum, wc) => sum + Number(wc.machine_count || 0), 0);
  const totalOutput = Number(discipline.shift_output_kg || 0) || workCenters.reduce((sum, wc) => sum + Number(wc.output_kg || 0), 0);
  const totalScrap = Number(discipline.scrap_mtd_kg || 0) || workCenters.reduce((sum, wc) => sum + Number(wc.scrap_kg || 0), 0);
  const runningMachines = Number(summary.machines_running || 0);
  const readinessPct = totalMachines > 0 ? (runningMachines / totalMachines) * 100 : 0;
  const generatedLabel = formatGeneratedAt(payload.generated_at || dataUpdatedAt);
  const syncTone = isFetching ? "border-info-border bg-info-bg text-info-fg" : "border-success-border bg-success-bg text-success-fg";

  if (isError) {
    return (
      <div className="rounded-lg border border-danger-border bg-danger-bg p-6 shadow-sm">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-1 h-5 w-5 text-danger-fg" />
          <div>
            <h1 className="font-display text-xl font-black text-danger-fg">Execution Command Deck failed to load</h1>
            <p className="mt-2 max-w-2xl text-sm font-semibold leading-6 text-danger-fg">
              WCM telemetry is unavailable. Retry the sync before assigning machines or releasing the shift handoff.
            </p>
            <Button className="mt-4 rounded-lg" onClick={() => refetch()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Retry sync
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 pb-10">
      <section className="overflow-hidden rounded-lg border border-line bg-[radial-gradient(circle_at_75%_-20%,rgba(37,99,235,0.42),transparent_32%),linear-gradient(135deg,#07111f,#102a50_58%,#17428b)] p-6 text-white shadow-[0_24px_80px_rgba(15,23,42,0.18)]">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-4xl">
            <div className="text-[11px] font-black uppercase tracking-[0.22em] text-white/70">Execution Command Deck</div>
            <h1 className="mt-2 font-display text-[clamp(2rem,3.5vw,3.4rem)] font-black leading-none tracking-[-0.05em]">
              Work Center Command Deck
            </h1>
            <p className="mt-3 max-w-3xl text-sm font-semibold leading-6 text-white/80">
              Live WCM control for machine assignment, operator coverage, roll and ink handoff, blockers, downtime, output, scrap, and shift takeover.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild className="h-11 rounded-lg bg-white text-content-1 hover:bg-line">
              <Link href="/production/work-center">
                <Cpu className="mr-2 h-4 w-4" />
                Open WCM Terminal
              </Link>
            </Button>
            <Button asChild variant="outline" className="h-11 rounded-lg border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white">
              <Link href="/production/machine-selector">
                <Zap className="mr-2 h-4 w-4" />
                Machine Terminal
              </Link>
            </Button>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <Badge className={cn("gap-2 rounded-lg border px-3 py-1.5 text-xs font-black", syncTone)}>
            {isFetching ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            {isFetching ? "Syncing live floor" : generatedLabel}
          </Badge>
          <Badge className="gap-2 rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-black text-white/90">
            <span className="h-2 w-2 rounded-full bg-success-fg shadow-[0_0_0_4px_rgba(52,211,153,0.16)]" />
            Shift {hero.current_shift || "A"}
          </Badge>
          <Badge className="rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-black text-white/90">
            {fmt(activeWorkCenterCount)} assigned work centers
          </Badge>
          <Badge className="rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-black text-white/90">
            {fmt(needsAction.length)} open WCM actions
          </Badge>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
        <KpiTile label="Active Work Centers" value={fmt(activeWorkCenterCount)} hint={`${fmt(totalMachines)} machines mapped`} icon={<Factory className="h-4 w-4" />} tone="blue" />
        <KpiTile label="Executing Jobs" value={fmt(summary.executing_jobs)} hint={`${fmt(summary.ready_jobs)} ready to run`} icon={<Activity className="h-4 w-4" />} tone="green" />
        <KpiTile label="Blocked Jobs" value={fmt(summary.blocked_jobs)} hint={`${fmt(needsAction.length)} WCM actions`} icon={<AlertTriangle className="h-4 w-4" />} tone={Number(summary.blocked_jobs || 0) > 0 ? "rose" : "green"} />
        <KpiTile label="Machines Running" value={fmt(runningMachines)} hint={`${pct(readinessPct, 0)} of mapped machines`} icon={<Cpu className="h-4 w-4" />} tone="cyan" />
        <KpiTile label="No Machine" value={fmt(summary.jobs_without_machine)} hint="released jobs unassigned" icon={<SlidersHorizontal className="h-4 w-4" />} tone={Number(summary.jobs_without_machine || 0) > 0 ? "amber" : "green"} />
        <KpiTile label="Output" value={kg(totalOutput)} hint={`shift ${hero.current_shift || "live"} production`} icon={<PackageCheck className="h-4 w-4" />} tone="green" />
        <KpiTile label="Scrap Rate" value={pct(discipline.scrap_rate_pct, 2)} hint={`${kg(totalScrap)} scrap scope`} icon={<Gauge className="h-4 w-4" />} tone={Number(discipline.scrap_rate_pct || 0) > 4 ? "rose" : "green"} />
        <KpiTile label="Runtime Coverage" value={pct(discipline.runtime_coverage_pct, 1)} hint={`${minutes(discipline.downtime_minutes)} downtime`} icon={<TimerReset className="h-4 w-4" />} tone={Number(discipline.runtime_coverage_pct || 0) >= 85 ? "green" : "amber"} />
      </section>

      <section className="rounded-lg border border-line bg-white p-3 shadow-sm">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap gap-2">
            {actionFilters.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setFilter(item.key)}
                className={cn(
                  "h-9 rounded-lg border px-3 text-xs font-black transition",
                  filter === item.key
                    ? "border-info-border bg-info-bg text-info-fg"
                    : "border-line bg-white text-content-3 hover:border-info-border hover:text-info-fg",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
          <div className="relative min-w-0 xl:w-[380px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-4" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search job, blocker, machine, operator..."
              className="h-9 w-full rounded-lg border border-line bg-surface-2 pl-9 pr-3 text-sm font-semibold text-content-2 outline-none transition placeholder:text-content-4 focus:border-info-border focus:bg-white"
            />
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,0.94fr)_minmax(0,1.06fr)]">
        <article className="overflow-hidden rounded-lg border border-line bg-white shadow-sm">
          <SectionHeader
            title="Assigned Work-Center Escalations"
            subtitle="Jobs that need WCM intervention before execution can continue."
            action={<Badge variant="outline" className="rounded-lg">{fmt(filteredActions.length)} visible</Badge>}
          />
          <div className="space-y-3 p-4">
            {isLoading && !data ? (
              <div className="rounded-lg border border-info-border bg-info-bg p-5 text-sm font-bold text-info-fg">
                <Clock3 className="mb-2 h-5 w-5 animate-spin" />
                Loading WCM telemetry and floor actions.
              </div>
            ) : filteredActions.length ? (
              filteredActions.map((item) => {
                const href = normalizeActionHref(item);
                const kind = actionKind(item);
                return (
                  <Link
                    key={item.id}
                    href={href}
                    className="group block rounded-lg border border-line bg-surface-2 p-4 transition hover:border-info-border hover:bg-white hover:shadow-[0_12px_26px_rgba(15,23,42,0.07)]"
                  >
                    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge className={cn("rounded-md border", priorityTone[item.priority] || priorityTone.LOW)}>
                            {item.priority}
                          </Badge>
                          <Badge variant="outline" className="rounded-md bg-white">
                            {kind === "assignment" ? "Machine assignment" : kind === "operator" ? "Operator coverage" : kind === "blocked" ? "Blocker" : "WCM"}
                          </Badge>
                        </div>
                        <div className="mt-3 truncate text-base font-black tracking-[-0.02em] text-content-1">{item.title}</div>
                        <div className="mt-1 text-sm font-semibold leading-6 text-content-3">{item.subtitle}</div>
                      </div>
                      <div className="flex items-center gap-2 text-sm font-black text-info-fg">
                        {item.action_label || "Open action"}
                        <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
                      </div>
                    </div>
                  </Link>
                );
              })
            ) : (
              <EmptyGreen text={needsAction.length ? "No actions match the current filter. Clear the filter to see the full WCM queue." : "All assigned work centers are clear. No WCM intervention is open right now."} />
            )}
          </div>
        </article>

        <article className="overflow-hidden rounded-lg border border-line bg-white shadow-sm">
          <SectionHeader
            title="Assigned Work Center Board"
            subtitle="Execution load, blockers, output, scrap, and terminal access by work center."
            action={
              <Button asChild variant="outline" size="sm" className="rounded-lg">
                <Link href="/factory/work-centers">Manage work centers</Link>
              </Button>
            }
          />
          <div className="divide-y divide-line">
            {workCenters.length ? (
              workCenters.map((wc) => {
                const oee = Number(wc.oee_avg || 0);
                const oeeTone = oee >= 70 ? "green" : oee >= 55 ? "amber" : oee > 0 ? "rose" : "slate";
                return (
                  <div key={wc.id} className="grid gap-4 p-4 transition hover:bg-surface-2 lg:grid-cols-[minmax(180px,1.05fr)_minmax(220px,1fr)_minmax(190px,0.9fr)_auto] lg:items-center">
                    <div className="min-w-0">
                      <div className="truncate font-black text-content-1">{wc.name}</div>
                      <div className="mt-1 text-xs font-bold text-content-3">{wc.plant || "Plant not tagged"}</div>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-lg border border-line bg-white p-2">
                        <div className="text-[10px] font-black uppercase text-content-4">Run</div>
                        <div className="mt-1 text-sm font-black text-content-1">{fmt(wc.running_machines)}/{fmt(wc.machine_count)}</div>
                      </div>
                      <div className="rounded-lg border border-line bg-white p-2">
                        <div className="text-[10px] font-black uppercase text-content-4">Pend</div>
                        <div className="mt-1 text-sm font-black text-content-1">{fmt(wc.pending_jobs)}</div>
                      </div>
                      <div className="rounded-lg border border-line bg-white p-2">
                        <div className="text-[10px] font-black uppercase text-content-4">Block</div>
                        <div className={cn("mt-1 text-sm font-black", Number(wc.blocked_jobs || 0) > 0 ? "text-danger-fg" : "text-content-1")}>{fmt(wc.blocked_jobs)}</div>
                      </div>
                    </div>
                    <div className="min-w-0 space-y-2">
                      <div className="flex items-center justify-between gap-3 text-xs font-black text-content-3">
                        <span>OEE avg</span>
                        <span>{kg(wc.output_kg, 1)} output · {kg(wc.scrap_kg, 1)} scrap</span>
                      </div>
                      <MiniBar value={oee} tone={oeeTone} />
                    </div>
                    <Button asChild variant="outline" size="sm" className="rounded-lg">
                      <Link href={`/production/work-center/${wc.id}`}>
                        Open terminal
                        <ArrowRight className="ml-1 h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  </div>
                );
              })
            ) : (
              <div className="p-4">
                <EmptyGreen text="No assigned work centers are open for this WCM role. Use the WCM terminal to select an available floor context." />
              </div>
            )}
          </div>
        </article>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <article className="overflow-hidden rounded-lg border border-line bg-white shadow-sm">
          <SectionHeader title="Machine Readiness" subtitle="Status clusters from active machines, released jobs, and operator assignments." />
          <div className="grid gap-3 p-4 sm:grid-cols-2 2xl:grid-cols-3">
            {machineClusters.length ? machineClusters.map((cluster) => {
              const tone = clusterTone[cluster.key] || clusterTone.idle;
              return (
                <Link
                  key={cluster.key}
                  href={tone.href}
                  className="group rounded-lg border border-line bg-surface-2 p-4 transition hover:border-info-border hover:bg-white"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs font-black uppercase tracking-[0.1em] text-content-3">{cluster.label}</div>
                      <div className="mt-2 font-display text-3xl font-black tracking-[-0.05em] text-content-1">{fmt(cluster.count)}</div>
                    </div>
                    <Badge className={cn("rounded-lg border", tone.badge)}>Open</Badge>
                  </div>
                  <p className="mt-3 min-h-[38px] text-xs font-semibold leading-5 text-content-3">{cluster.hint || "Machine status cluster"}</p>
                  <div className={cn("mt-3 inline-flex items-center gap-1 text-xs font-black", tone.icon)}>
                    Review route <ArrowRight className="h-3.5 w-3.5 transition group-hover:translate-x-1" />
                  </div>
                </Link>
              );
            }) : (
              <div className="sm:col-span-2 2xl:col-span-3">
                <EmptyGreen text="Machine readiness is synced. No machine cluster needs separate review right now." />
              </div>
            )}
          </div>
        </article>

        <article className="overflow-hidden rounded-lg border border-line bg-white shadow-sm">
          <SectionHeader title="Execution Discipline" subtitle="Scrap, downtime, ink remix, variance, runtime coverage, and costing readiness." />
          <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
            <KpiTile label="Scrap Rate" value={pct(discipline.scrap_rate_pct, 2)} hint={`${kg(discipline.scrap_mtd_kg, 1)} MTD scrap`} icon={<AlertTriangle className="h-4 w-4" />} tone={Number(discipline.scrap_rate_pct || 0) > 4 ? "rose" : "green"} />
            <KpiTile label="Downtime" value={minutes(discipline.downtime_minutes)} hint="last 30 days in WCM scope" icon={<Clock3 className="h-4 w-4" />} tone={Number(discipline.downtime_minutes || 0) > 0 ? "amber" : "green"} />
            <KpiTile label="Ink Remix" value={pct(discipline.ink_remix_ratio_pct, 2)} hint={`${pct(discipline.variance_pct, 2)} material variance`} icon={<Layers className="h-4 w-4" />} tone={Number(discipline.ink_remix_ratio_pct || 0) > 20 ? "rose" : "green"} />
            <KpiTile label="Cost Coverage" value={pct(costing.avg_actual_cost_coverage_pct ?? discipline.runtime_coverage_pct, 1)} hint={`${fmt(costing.hybrid_jobs)} hybrid jobs`} icon={<Gauge className="h-4 w-4" />} tone="cyan" />
            <KpiTile label="Unmapped Cost" value={fmt(costing.unmapped_jobs)} hint="cost group gaps to fix" icon={<Wrench className="h-4 w-4" />} tone={Number(costing.unmapped_jobs || 0) > 0 ? "amber" : "green"} />
            <KpiTile label="Shift Output" value={kg(discipline.shift_output_kg || totalOutput, 1)} hint="current top shift output" icon={<PackageCheck className="h-4 w-4" />} tone="green" />
          </div>
        </article>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <article className="overflow-hidden rounded-lg border border-line bg-white shadow-sm">
          <SectionHeader
            title="Recent Floor Activity"
            subtitle="Recent production and scrap events from assigned execution scope."
            action={
              <Button asChild variant="outline" size="sm" className="rounded-lg">
                <Link href="/analytics/reports">Open reports</Link>
              </Button>
            }
          />
          <div className="divide-y divide-line">
            {recentActivity.length ? recentActivity.slice(0, 8).map((row, index) => {
              const family = String(row.family || "EVENT").toUpperCase();
              const isScrap = family.includes("SCRAP");
              return (
                <div key={`${family}-${index}`} className="grid gap-3 p-4 transition hover:bg-surface-2 md:grid-cols-[120px_minmax(0,1fr)_auto] md:items-start">
                  <div className="flex items-center gap-2">
                    <span className={cn("h-2.5 w-2.5 rounded-full", isScrap ? "bg-danger-bg0" : "bg-success-bg0")} />
                    <Badge variant="outline" className="rounded-md bg-white">{family}</Badge>
                  </div>
                  <div className="min-w-0">
                    <div className="truncate font-black text-content-1">{row.title || row.message || "Floor activity"}</div>
                    <div className="mt-1 text-sm font-semibold leading-6 text-content-3">{row.subtitle || row.description || row.detail || "Recent WCM event."}</div>
                  </div>
                  <div className="text-xs font-bold text-content-3">{row.date || row.logged_at || "Live"}</div>
                </div>
              );
            }) : (
              <div className="p-4">
                <EmptyGreen text="Floor activity is synced. New production, scrap, and downtime events will appear here as operators log them." />
              </div>
            )}
          </div>
        </article>

        <article className="overflow-hidden rounded-lg border border-line bg-white shadow-sm">
          <SectionHeader title="Shift Handoff" subtitle="WCM takeover checklist generated from live blockers and discipline signals." />
          <div className="grid gap-3 p-4 sm:grid-cols-2">
            <Link href="/production/machine-selector" className="rounded-lg border border-line bg-surface-2 p-4 transition hover:border-info-border hover:bg-white">
              <Cpu className="h-5 w-5 text-info-fg" />
              <div className="mt-3 text-sm font-black text-content-1">Machine assignment</div>
              <p className="mt-1 text-xs font-semibold leading-5 text-content-3">{fmt(summary.jobs_without_machine)} released jobs need machine mapping.</p>
            </Link>
            <Link href="/production/work-center" className="rounded-lg border border-line bg-surface-2 p-4 transition hover:border-info-border hover:bg-white">
              <ShieldCheck className="h-5 w-5 text-success-fg" />
              <div className="mt-3 text-sm font-black text-content-1">Operator coverage</div>
              <p className="mt-1 text-xs font-semibold leading-5 text-content-3">{fmt(summary.jobs_without_operator)} jobs and {fmt(summary.machines_without_operator)} machines need coverage.</p>
            </Link>
            <Link href="/inventory/rolls" className="rounded-lg border border-line bg-surface-2 p-4 transition hover:border-info-border hover:bg-white">
              <PackageCheck className="h-5 w-5 text-info-fg" />
              <div className="mt-3 text-sm font-black text-content-1">Roll and material issue</div>
              <p className="mt-1 text-xs font-semibold leading-5 text-content-3">Verify reserved rolls, bulk, ink, returns, and scrap before takeover.</p>
            </Link>
            <Link href="/factory/machines" className="rounded-lg border border-line bg-surface-2 p-4 transition hover:border-info-border hover:bg-white">
              <ListChecks className="h-5 w-5 text-warning-fg" />
              <div className="mt-3 text-sm font-black text-content-1">Maintenance risk</div>
              <p className="mt-1 text-xs font-semibold leading-5 text-content-3">{fmt(summary.machines_down)} machines down or in maintenance.</p>
            </Link>
          </div>
        </article>
      </section>
    </div>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import Cookies from "js-cookie";
import { toast } from "sonner";
import {
  Activity,
  ArrowUpRight,
  Building2,
  Clock,
  Cpu,
  Database,
  FileBarChart,
  HardDrive,
  ListChecks,
  MemoryStick,
  RefreshCw,
  Server,
  ShieldCheck,
  Timer,
  Trash2,
  Users,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { analyticsApi } from "@/services/analytics";
import { RbacService } from "@/services/rbac";
import { cn } from "@/lib/utils";
import {
  CompositionBar,
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

const ADMIN_LINKS = [
  { href: "/system/users", label: "Users", copy: "Accounts, roles and access", icon: Users },
  { href: "/system/role-matrix", label: "Role matrix", copy: "What each role can see and do", icon: ShieldCheck },
  { href: "/system/audit", label: "Audit centre", copy: "Every change, who and when", icon: ListChecks },
  { href: "/system/company-profile", label: "Company profile", copy: "Legal entities and plants", icon: Building2 },
  { href: "/system/shift-timing", label: "Shift timing", copy: "Shift windows per plant", icon: Timer },
  { href: "/system/report-center", label: "Report centre", copy: "Scheduled report delivery", icon: FileBarChart },
];

function resourceTone(value: number | null) {
  if (value === null) return "neutral" as const;
  if (value >= 90) return "bad" as const;
  if (value >= 75) return "warn" as const;
  return "good" as const;
}

export default function SystemHealthDashboard() {
  const [confirmVacuum, setConfirmVacuum] = useState(false);
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_ALLOW_ROLE_PREVIEW === "true") return;
    Cookies.remove("x_role_override", { path: "/" });
    try {
      window.localStorage.removeItem("x_role_override");
      window.sessionStorage.removeItem("x_role_override");
    } catch {
      // Storage cleanup is best-effort only.
    }
  }, []);

  const health = useQuery({
    queryKey: ["system-health"],
    queryFn: analyticsApi.getSystemHealth,
    refetchInterval: 15000,
    retry: 1,
  });
  const visibility = useQuery({
    queryKey: ["admin-role-visibility-widget"],
    queryFn: RbacService.revalidateRoleVisibility,
    refetchInterval: 60000,
    retry: 1,
  });

  const maintenance = useMutation({
    mutationFn: async (action: "clear_cache" | "vacuum_db") => {
      const res = await analyticsApi.performMaintenance(action);
      if (!res.success) throw new Error(res.message);
      return res;
    },
    onSuccess: (res, action) => {
      toast.success(action === "clear_cache" ? "Cache cleared" : "Database vacuum complete", { description: res.message });
      setConfirmVacuum(false);
      void health.refetch();
    },
    onError: (error: any, action) =>
      toast.error(action === "clear_cache" ? "Could not clear cache" : "Vacuum failed", { description: error?.message }),
  });

  const signoff = useMemo(() => {
    const rows = Object.entries(visibility.data || {}).map(([roleCode, values]: [string, any]) => ({ roleCode, ...values }));
    const total = rows.reduce((acc, row) => acc + (Number(row.total) || 0), 0);
    const approved = rows.reduce((acc, row) => acc + (Number(row.approved) || 0), 0);
    const pending = rows.reduce((acc, row) => acc + (Number(row.pending) || 0), 0);
    const blockers = rows.filter((row) => Number(row.pending) > 0).sort((a, b) => Number(b.pending) - Number(a.pending)).slice(0, 5);
    return { total, approved, pending, blockers };
  }, [visibility.data]);

  const system: any = health.data || {};
  const degraded = system.telemetry_scope === "fallback" || system.telemetry_fresh === false;
  const num = (v: unknown) => (degraded || !Number.isFinite(Number(v)) ? null : Number(v));
  const cpu = num(system.cpu_usage);
  const mem = num(system.memory_usage);
  const disk = num(system.disk_usage);
  const dbLatency = String(system.db_health || "").match(/(\d+)\s*ms/)?.[1];
  const online = String(system.status || "").toLowerCase() === "online";

  return (
    <div className="mx-auto max-w-[1600px] space-y-4" data-testid="admin-dashboard">
      <PageHero
        eyebrow="Command center"
        icon={<Activity />}
        title="System Admin Console"
        description="Server vitals, database health, access sign-off and maintenance for the whole ERP."
        meta={
          <>
            <HeroChip tone={health.isError ? "bad" : online ? "good" : "warn"}>{health.isError ? "Telemetry unavailable" : online ? "Online" : sentence(system.status || "unknown")}</HeroChip>
            {system.version ? <HeroChip>Build {system.version}</HeroChip> : null}
            {system.uptime ? <HeroChip>Up {system.uptime}</HeroChip> : null}
            {degraded ? <HeroChip tone="warn">Telemetry stale</HeroChip> : null}
          </>
        }
        actions={
          <button type="button" onClick={() => void health.refetch()} disabled={health.isFetching} className={heroButtonClass("primary")}>
            <RefreshCw className={cn(health.isFetching && "animate-spin motion-reduce:animate-none")} /> Refresh vitals
          </button>
        }
      >
        <HeroStats columns={4}>
          <HeroStat label="Active users" value={health.data ? count(system.active_users) : "—"} hint="signed in, last 24 h" />
          <HeroStat label="Error rate" tone={String(system.error_rate || "").startsWith("0") ? "good" : "warn"} value={system.error_rate || "—"} hint="failed requests" />
          <HeroStat label="Database latency" tone={dbLatency && Number(dbLatency) > 200 ? "warn" : "good"} value={dbLatency ? `${dbLatency} ms` : "—"} hint={String(system.db_health || "").split("(")[0].trim() || "connection check"} />
          <HeroStat label="Database size" value={system.db_size_mb ? `${count(system.db_size_mb)} MB` : "—"} hint={`${count(system.active_connections || 0)} open connections`} />
        </HeroStats>
      </PageHero>

      {health.isError ? (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-warning-border bg-warning-bg px-4 py-3 text-[13px] text-warning-fg">
          System health did not respond. The rest of the ERP is unaffected.
          <Button size="sm" variant="outline" onClick={() => health.refetch()}>
            Retry
          </Button>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        <Panel icon={<Server />} title="Server resources" description="Live host utilisation">
          {health.isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="erp-skeleton h-10 rounded-lg" />
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              {[
                { label: "CPU", value: cpu, icon: Cpu },
                { label: "Memory", value: mem, icon: MemoryStick },
                { label: "Disk", value: disk, icon: HardDrive },
              ].map((r) => (
                <div key={r.label} className="flex items-center gap-3">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-content-2">
                    <r.icon className="h-4 w-4" />
                  </span>
                  <Meter className="flex-1" label={r.label} value={r.value ?? 0} max={100} display={r.value === null ? "—" : `${r.value}%`} tone={resourceTone(r.value)} />
                </div>
              ))}
              {disk !== null && disk >= 85 ? (
                <div className="rounded-xl border border-warning-border bg-warning-bg px-3 py-2 text-[12px] text-warning-fg">
                  Disk is {disk}% full. Prune old backups and Docker images before it reaches capacity.
                </div>
              ) : null}
            </div>
          )}
        </Panel>

        <Panel
          icon={<ShieldCheck />}
          title="Department sign-off"
          description="Role and module visibility approvals"
          actions={
            <Link href="/system/governance?tab=signoffs" className="text-[12.5px] font-medium text-primary hover:underline">
              Open Governance Console
            </Link>
          }
        >
          {signoff.total ? (
            <>
              <CompositionBar
                parts={[
                  { label: "Approved", value: signoff.approved, color: "var(--viz-good)" },
                  { label: "Pending", value: signoff.pending, color: "var(--viz-warning)" },
                ]}
                valueFormat={count}
              />
              {signoff.blockers.length ? (
                <ul className="mt-4 space-y-1.5">
                  {signoff.blockers.map((b) => (
                    <li key={b.roleCode} className="flex items-center justify-between rounded-lg bg-surface-2/70 px-3 py-2 text-[12.5px]">
                      <span className="text-content-2">{sentence(b.roleCode)}</span>
                      <span className="tabular-nums text-warning-fg">{count(b.pending)} pending</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="mt-3 text-[12.5px] text-success-fg">Every role is signed off.</div>
              )}
            </>
          ) : (
            <PanelEmpty title={visibility.isLoading ? "Loading sign-off…" : "No sign-off records"} />
          )}
        </Panel>

        <Panel icon={<Database />} title="Maintenance" description="Safe housekeeping actions">
          <div className="space-y-2.5">
            <button
              type="button"
              disabled={maintenance.isPending}
              onClick={() => maintenance.mutate("clear_cache")}
              className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface-1 px-3.5 py-3 text-left transition hover:border-line-strong hover:bg-surface-2 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4 text-content-3" />
              <span className="flex-1">
                <span className="block text-[13px] font-semibold text-content-1">Clear application cache</span>
                <span className="block text-[12px] text-content-3">Drops cached reports and dashboards; they rebuild on next view.</span>
              </span>
            </button>
            <div className="rounded-xl border border-line bg-surface-1 px-3.5 py-3">
              <div className="flex items-center gap-3">
                <Database className="h-4 w-4 text-content-3" />
                <span className="flex-1">
                  <span className="block text-[13px] font-semibold text-content-1">Vacuum database</span>
                  <span className="block text-[12px] text-content-3">Reclaims space and refreshes planner statistics. Best run off-shift.</span>
                </span>
              </div>
              <div className="mt-2.5 flex justify-end gap-2">
                {confirmVacuum ? (
                  <>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmVacuum(false)}>
                      Cancel
                    </Button>
                    <Button size="sm" disabled={maintenance.isPending} onClick={() => maintenance.mutate("vacuum_db")}>
                      {maintenance.isPending && maintenance.variables === "vacuum_db" ? "Running…" : "Run vacuum now"}
                    </Button>
                  </>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => setConfirmVacuum(true)}>
                    Vacuum…
                  </Button>
                )}
              </div>
            </div>
          </div>
        </Panel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Panel icon={<Activity />} title="System event stream" description="Latest activity recorded by the platform">
          {(system.logs || []).length ? (
            <ul className="divide-y divide-line">
              {(system.logs || []).map((log: any, i: number) => (
                <li key={i} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
                  <span
                    className={cn(
                      "mt-0.5 rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold",
                      log.level === "ERROR" ? "bg-danger-bg text-danger-fg" : log.level === "WARN" ? "bg-warning-bg text-warning-fg" : "bg-surface-2 text-content-3",
                    )}
                  >
                    {sentence(log.level)}
                  </span>
                  <span className="min-w-0 flex-1 text-[12.5px] text-content-1">{log.message}</span>
                  <span className="flex shrink-0 items-center gap-1 text-[11.5px] text-content-4">
                    <Clock className="h-3 w-3" /> {log.time}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <PanelEmpty title="No recent system events" />
          )}
        </Panel>
        <Panel title="Administration" description="Jump to a system area">
          <div className="grid gap-2 sm:grid-cols-2">
            {ADMIN_LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="group flex items-start gap-3 rounded-xl border border-line bg-surface-1 p-3 transition hover:border-line-strong hover:bg-surface-2">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-content-2 group-hover:bg-content-1 group-hover:text-surface-1">
                  <l.icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between text-[13px] font-semibold text-content-1">
                    {l.label}
                    <ArrowUpRight className="h-3.5 w-3.5 text-content-4" />
                  </span>
                  <span className="block text-[11.5px] text-content-3">{l.copy}</span>
                </span>
              </Link>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

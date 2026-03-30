"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  Cpu,
  Zap,
} from "lucide-react";

import { analyticsApi } from "@/services/analytics";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function fmt(value: unknown, decimals = 0) {
  const numeric = typeof value === "number" ? value : Number(value || 0);
  if (!Number.isFinite(numeric)) return "0";
  return numeric.toLocaleString("en-IN", { maximumFractionDigits: decimals });
}

const clusterTone: Record<string, string> = {
  running: "bg-emerald-50 text-emerald-700 border-emerald-200",
  ready: "bg-sky-50 text-sky-700 border-sky-200",
  blocked: "bg-rose-50 text-rose-700 border-rose-200",
  idle: "bg-slate-50 text-slate-700 border-slate-200",
  no_operator: "bg-amber-50 text-amber-700 border-amber-200",
  no_machine: "bg-violet-50 text-violet-700 border-violet-200",
};

export default function WorkCenterDashboard() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["wcm-dashboard"],
    queryFn: () => analyticsApi.getWcmDashboard(),
  });

  const payload = (data as any) || {};
  const hero = payload.hero || {};
  const summary = payload.summary || {};
  const machineClusters = Array.isArray(payload.machine_clusters) ? payload.machine_clusters : [];
  const workCenters = Array.isArray(payload.work_centers) ? payload.work_centers : [];
  const needsAction = Array.isArray(payload.needs_action) ? payload.needs_action : [];
  const discipline = payload.discipline || {};
  const recentActivity = Array.isArray(payload.recent_activity) ? payload.recent_activity : [];

  if (isError) {
    return (
      <Card className="border border-rose-200 bg-rose-50/80 shadow-sm">
        <CardHeader>
          <CardTitle className="text-rose-900">Execution Command Deck failed to load</CardTitle>
          <CardDescription className="text-rose-700">
            Live WCM telemetry is unavailable right now. Retry after analytics recovers.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => refetch()}>Retry</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6 pb-10">
      <section className="rounded-[30px] border border-slate-200/80 bg-gradient-to-br from-[#0f172a] via-[#162451] to-[#233ea8] p-7 text-white shadow-[0_24px_90px_rgba(15,23,42,0.18)]">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl space-y-3">
            <div className="text-[11px] font-black uppercase tracking-[0.24em] text-indigo-200">Execution Command Deck</div>
            <h1 className="text-4xl font-black tracking-tight">Work Center Command Deck</h1>
            <p className="max-w-2xl text-sm font-semibold leading-6 text-indigo-100/90">
              Shift health, machine readiness, blockers, and live execution discipline for assigned work centers.
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Link href="/production/work-center">
              <Button className="rounded-2xl bg-white text-slate-950 hover:bg-slate-100">
                <Cpu className="mr-2 h-4 w-4" />
                WCM Terminal
              </Button>
            </Link>
            <Link href="/production/machine-selector">
              <Button variant="outline" className="rounded-2xl border-white/30 bg-white/10 text-white hover:bg-white/20">
                <Zap className="mr-2 h-4 w-4" />
                Machine Terminal
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <Card className="rounded-[24px] border border-slate-200/80 bg-white shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription>Active Work Centers</CardDescription>
            <CardTitle className="text-3xl font-black">{fmt(hero.active_work_centers)}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="rounded-[24px] border border-slate-200/80 bg-white shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription>Executing Jobs</CardDescription>
            <CardTitle className="text-3xl font-black">{fmt(summary.executing_jobs)}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="rounded-[24px] border border-slate-200/80 bg-white shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription>Blocked Jobs</CardDescription>
            <CardTitle className="text-3xl font-black">{fmt(summary.blocked_jobs)}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="rounded-[24px] border border-slate-200/80 bg-white shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription>Machines Running</CardDescription>
            <CardTitle className="text-3xl font-black">{fmt(summary.machines_running)}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="rounded-[24px] border border-slate-200/80 bg-white shadow-sm">
          <CardHeader className="pb-2">
            <CardDescription>Current Shift</CardDescription>
            <CardTitle className="text-3xl font-black">{hero.current_shift || "—"}</CardTitle>
          </CardHeader>
        </Card>
      </section>

      <section className="grid gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <Card className="rounded-[26px] border border-slate-200/80 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="text-xl font-black tracking-tight text-slate-950">Assigned Work-Center Escalations</CardTitle>
            <CardDescription>Jobs that need WCM intervention before execution can continue cleanly.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {needsAction.length ? needsAction.map((item: any) => (
              <Link key={item.id} href={item.href || "/production/work-center"} className="block rounded-[20px] border border-slate-200 bg-slate-50/80 p-4 transition hover:border-slate-300 hover:bg-white">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="text-sm font-black text-slate-950">{item.title}</div>
                    <div className="text-sm font-medium leading-6 text-slate-600">{item.subtitle}</div>
                  </div>
                  <Badge className={item.priority === "HIGH" ? "bg-rose-600" : "bg-amber-500"}>{item.priority}</Badge>
                </div>
                <div className="mt-3 inline-flex items-center gap-2 text-sm font-bold text-slate-900">
                  {item.action_label || "Open"}
                  <ArrowRight className="h-4 w-4" />
                </div>
              </Link>
            )) : (
              <div className="rounded-[20px] border border-emerald-200 bg-emerald-50 p-5 text-sm font-semibold text-emerald-800">
                <CheckCircle2 className="mb-2 h-5 w-5" />
                No WCM telemetry is available yet.
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="rounded-[26px] border border-slate-200/80 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="text-xl font-black tracking-tight text-slate-950">Assigned Work Center Board</CardTitle>
            <CardDescription>Execution load, blockers, and output by work center.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {workCenters.length ? workCenters.map((wc: any) => (
              <div key={wc.id} className="rounded-[20px] border border-slate-200 bg-slate-50/70 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-black text-slate-950">{wc.name}</div>
                    <div className="text-xs font-semibold text-slate-500">{wc.plant || "Plant not tagged"}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">{fmt(wc.running_machines)}/{fmt(wc.machine_count)} running</Badge>
                    <Badge variant="outline">{fmt(wc.pending_jobs)} pending</Badge>
                    <Badge variant="outline">{fmt(wc.blocked_jobs)} blocked</Badge>
                  </div>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">OEE Avg</div>
                    <div className="mt-1 text-lg font-black text-slate-900">{fmt(wc.oee_avg, 1)}%</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Output</div>
                    <div className="mt-1 text-lg font-black text-slate-900">{fmt(wc.output_kg, 1)} KG</div>
                  </div>
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Scrap</div>
                    <div className="mt-1 text-lg font-black text-slate-900">{fmt(wc.scrap_kg, 1)} KG</div>
                  </div>
                </div>
              </div>
            )) : (
              <div className="rounded-[20px] border border-slate-200 bg-slate-50 p-5 text-sm font-semibold text-slate-500">No work centers</div>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <Card className="rounded-[26px] border border-slate-200/80 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="text-xl font-black tracking-tight text-slate-950">Execution Discipline</CardTitle>
            <CardDescription>Scrap, downtime, remix, variance, and runtime coverage.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-[18px] border border-slate-200 bg-slate-50/80 p-4">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Scrap Rate</div>
              <div className="mt-1 text-2xl font-black text-slate-950">{fmt(discipline.scrap_rate_pct, 2)}%</div>
            </div>
            <div className="rounded-[18px] border border-slate-200 bg-slate-50/80 p-4">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Downtime</div>
              <div className="mt-1 text-2xl font-black text-slate-950">{fmt(discipline.downtime_minutes)} min</div>
            </div>
            <div className="rounded-[18px] border border-slate-200 bg-slate-50/80 p-4">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Ink Remix</div>
              <div className="mt-1 text-2xl font-black text-slate-950">{fmt(discipline.ink_remix_ratio_pct, 2)}%</div>
            </div>
            <div className="rounded-[18px] border border-slate-200 bg-slate-50/80 p-4">
              <div className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Runtime Coverage</div>
              <div className="mt-1 text-2xl font-black text-slate-950">{fmt(discipline.runtime_coverage_pct, 2)}%</div>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-[26px] border border-slate-200/80 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="text-xl font-black tracking-tight text-slate-950">Recent Floor Activity</CardTitle>
            <CardDescription>Recent production and scrap events from the assigned floor.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {recentActivity.length ? recentActivity.map((row: any, index: number) => (
              <div key={`${row.family}-${index}`} className="flex items-start justify-between gap-3 rounded-[18px] border border-slate-200 bg-slate-50/70 p-4">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="border-slate-200 bg-white">{row.family || "EVENT"}</Badge>
                    <div className="text-sm font-black text-slate-950">{row.title || row.message || "Activity"}</div>
                  </div>
                  <div className="text-sm font-medium leading-6 text-slate-600">{row.subtitle || row.description || row.detail || "Recent floor update."}</div>
                </div>
                <div className="whitespace-nowrap text-xs font-semibold text-slate-500">{row.date || row.logged_at || "—"}</div>
              </div>
            )) : (
              <div className="rounded-[20px] border border-slate-200 bg-slate-50 p-5 text-sm font-semibold text-slate-500">Recent floor activity will appear here once jobs start logging.</div>
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        {machineClusters.map((cluster: any) => (
          <Card key={cluster.key} className="rounded-[24px] border border-slate-200/80 bg-white shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-base font-black tracking-tight text-slate-950">{cluster.label}</CardTitle>
                <Badge variant="outline" className={clusterTone[cluster.key] || "border-slate-200"}>
                  {fmt(cluster.count)}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="text-sm font-medium leading-6 text-slate-600">{cluster.hint}</CardContent>
          </Card>
        ))}
      </section>

      {isLoading ? (
        <Card className="rounded-[24px] border border-slate-200 bg-white shadow-sm">
          <CardContent className="flex items-center gap-3 p-6 text-sm font-semibold text-slate-500">
            <Clock3 className="h-4 w-4 animate-spin" />
            Loading WCM telemetry…
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

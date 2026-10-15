"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { BarChart3 } from "lucide-react";

import { SectionLabel, fmtDateTime, fmtInr } from "@/components/maintenance/ui";
import { HeroStat, HeroStats, PageHero } from "@/components/premium/page-hero";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { factoryService } from "@/services/factory";
import { maintenanceService } from "@/services/maintenance";

type Tab = "compliance" | "downtime" | "recurring-faults" | "spares" | "workload";

const TABS: Array<[Tab, string]> = [
  ["compliance", "Compliance"],
  ["downtime", "Breakdowns & downtime"],
  ["recurring-faults", "Recurring faults"],
  ["spares", "Spares & time"],
  ["workload", "Technician workload"],
];

function Table({ columns, rows, empty }: { columns: Array<[string, (row: any) => any, string?]>; rows: any[]; empty: string }) {
  if (!rows.length) return <div className="rounded-xl border border-dashed border-line px-3 py-6 text-center text-sm text-content-3">{empty}</div>;
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full text-sm">
        <thead className="bg-surface-2 text-caption font-semibold uppercase tracking-wide text-content-3">
          <tr>
            {columns.map(([label, , align]) => (
              <th key={label} className={cn("px-3 py-2 text-left", align === "right" && "text-right")}>
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-t border-line">
              {columns.map(([label, render, align]) => (
                <td key={label} className={cn("px-3 py-2 tabular-nums", align === "right" && "text-right font-mono")}>
                  {render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function MaintenanceReportsPage() {
  const [tab, setTab] = useState<Tab>("compliance");
  const [plantId, setPlantId] = useState("");
  const { data: plants = [] } = useQuery({ queryKey: ["factory-plants"], queryFn: factoryService.getPlants, staleTime: 10 * 60 * 1000 });
  const params: Record<string, string | number> = plantId ? { plant_id: plantId } : {};
  const { data: rows = [], isLoading } = useQuery({ queryKey: ["maintenance", "report", tab, plantId], queryFn: () => maintenanceService.report(tab, params) });
  const { data: compliance = [] } = useQuery({ queryKey: ["maintenance", "report", "compliance", plantId], queryFn: () => maintenanceService.report("compliance", params) });
  const { data: downtime = [] } = useQuery({ queryKey: ["maintenance", "report", "downtime", plantId], queryFn: () => maintenanceService.report("downtime", params) });

  const closed = compliance.reduce((sum: number, r: any) => sum + r.on_time + r.late + r.missed, 0);
  const onTime = compliance.reduce((sum: number, r: any) => sum + r.on_time, 0);
  const breakdowns = downtime.reduce((sum: number, r: any) => sum + r.breakdowns, 0);
  const breakdownHours = downtime.reduce((sum: number, r: any) => sum + r.breakdown_hours, 0);

  return (
    <div className="space-y-4 pb-10">
      <PageHero
        compact
        icon={<BarChart3 />}
        eyebrow="Maintenance · reports"
        title="Maintenance reports"
        description="Compliance per machine and month, breakdowns and downtime from the production downtime log, recurring faults over 90 days, spares and time noted on jobs, and who is carrying the work."
        actions={
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
        }
      >
        <HeroStats columns={4}>
          <HeroStat label="Done on time" value={closed ? `${Math.round((100 * onTime) / closed)}%` : "–"} hint="last 3 months" tone="good" />
          <HeroStat label="Scheduled jobs closed" value={closed} />
          <HeroStat label="Breakdowns" value={breakdowns} hint="last 90 days" tone="bad" />
          <HeroStat label="Breakdown hours" value={breakdownHours.toFixed(1)} tone="warn" />
        </HeroStats>
      </PageHero>
      <div className="flex flex-wrap gap-2">
        {TABS.map(([key, label]) => (
          <button key={key} type="button" aria-pressed={tab === key} onClick={() => setTab(key)} className={cn("rounded-full border px-3 py-1.5 text-sm font-semibold", tab === key ? "border-primary bg-info-bg text-primary" : "border-line bg-surface-1 text-content-2")} data-testid={`maintenance-report-${key}`}>
            {label}
          </button>
        ))}
      </div>
      <section className="rounded-2xl border border-line bg-surface-1 p-3">
        <SectionLabel count={rows.length}>{TABS.find(([key]) => key === tab)?.[1]}</SectionLabel>
        {isLoading ? <div className="text-sm text-content-3">Loading…</div> : null}
        {tab === "compliance" ? (
          <Table
            empty="No scheduled jobs in the period."
            rows={rows}
            columns={[
              ["Machine", (r) => <Link href={`/maintenance/machines/${r.machine_id}`} className="font-semibold text-primary">{r.machine_code} · {r.machine_name}</Link>],
              ["Month", (r) => r.month],
              ["Scheduled", (r) => r.scheduled, "right"],
              ["On time", (r) => r.on_time, "right"],
              ["Late", (r) => r.late, "right"],
              ["Missed", (r) => r.missed, "right"],
              ["Open", (r) => r.open, "right"],
              ["On-time %", (r) => (r.on_time_pct == null ? "–" : `${r.on_time_pct}%`), "right"],
            ]}
          />
        ) : null}
        {tab === "downtime" ? (
          <Table
            empty="No downtime recorded in the period."
            rows={rows}
            columns={[
              ["Machine", (r) => <Link href={`/maintenance/machines/${r.machine_id}`} className="font-semibold text-primary">{r.machine_code} · {r.machine_name}</Link>],
              ["Month", (r) => r.month],
              ["Breakdowns", (r) => r.breakdowns, "right"],
              ["Breakdown h", (r) => r.breakdown_hours.toFixed(1), "right"],
              ["Maintenance h", (r) => r.maintenance_hours.toFixed(1), "right"],
              ["Other stops h", (r) => r.other_hours.toFixed(1), "right"],
              ["Events", (r) => r.events, "right"],
            ]}
          />
        ) : null}
        {tab === "recurring-faults" ? (
          <Table
            empty="No faults in the period."
            rows={rows}
            columns={[
              ["Machine", (r) => <Link href={`/maintenance/machines/${r.machine_id}`} className="font-semibold text-primary">{r.machine_code}</Link>],
              ["Fault", (r) => r.title],
              ["Times", (r) => r.times, "right"],
              ["Stopped machine", (r) => r.stopped_machine, "right"],
              ["Last", (r) => fmtDateTime(r.last_at)],
            ]}
          />
        ) : null}
        {tab === "spares" ? (
          <Table
            empty="No completed jobs in the period."
            rows={rows}
            columns={[
              ["Machine", (r) => <Link href={`/maintenance/machines/${r.machine_id}`} className="font-semibold text-primary">{r.machine_code} · {r.machine_name}</Link>],
              ["Month", (r) => r.month],
              ["Jobs", (r) => r.jobs, "right"],
              ["Time h", (r) => r.time_hours.toFixed(1), "right"],
              ["Spares noted", (r) => fmtInr(r.spares_cost), "right"],
              ["Items", (r) => (r.items || []).map((i: any) => `${i.item} ×${i.qty}`).join(", ")],
            ]}
          />
        ) : null}
        {tab === "workload" ? (
          <Table
            empty="No jobs in the period."
            rows={rows}
            columns={[
              ["Person", (r) => r.name],
              ["Open", (r) => r.open, "right"],
              ["Overdue", (r) => r.overdue, "right"],
              ["Done (30 d)", (r) => r.done, "right"],
              ["Avg hours to close", (r) => (r.avg_close_hours == null ? "–" : r.avg_close_hours.toFixed(1)), "right"],
            ]}
          />
        ) : null}
      </section>
    </div>
  );
}

"use client";

import Link from "next/link";
import { GateBillInboxLink } from "@/components/layout/gate-bill-inbox-link";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowUpRight,
  Boxes,
  Clock3,
  Factory,
  MapPin,
  PackagePlus,
  Stethoscope,
  Warehouse,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { observabilityApi } from "@/services/observability";
import { analyticsApi } from "@/services/analytics";
import {
  CompositionBar,
  HeroChip,
  HeroStat,
  HeroStats,
  PageHero,
  Panel,
  PanelEmpty,
  RankedBars,
  StatCard,
  StatGrid,
  heroButtonClass,
  vizColor,
} from "@/components/premium";
import { Donut } from "@/components/premium/charts";
import { count, inrCompact, kgCompact, pct, relativeTime, sentence } from "@/components/premium/format";

const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

export default function InventoryDashboard() {
  const health = useQuery({
    queryKey: ["inventory-health-stats"],
    queryFn: () => observabilityApi.getHealth(),
    refetchInterval: 30000,
  });
  const alerts = useQuery({
    queryKey: ["inventory-critical-alerts"],
    queryFn: async () => {
      const rows = await observabilityApi.getAlerts({ resolved: false });
      const priority: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
      return [...rows].sort((a: any, b: any) => (priority[a.severity] ?? 9) - (priority[b.severity] ?? 9));
    },
    refetchInterval: 30000,
  });
  const range = useMemo(() => ({ date_from: iso(new Date(Date.now() - 89 * 86400000)), date_to: iso(new Date()) }), []);
  const report = useQuery({
    queryKey: ["inventory-dashboard-report", range],
    queryFn: () => analyticsApi.getReportTab("inventory", range),
    staleTime: 120_000,
  });

  const h: any = health.data || {};
  const r: any = report.data || {};
  const s = r.summary || {};
  const alertRows: any[] = Array.isArray(alerts.data) ? alerts.data : [];
  const loading = !health.data && health.isFetching;
  const rollKg = Number(h.rolls?.available_kg || 0) + Number(h.rolls?.reserved_kg || 0);
  const reservedShare = rollKg > 0 ? (Number(h.rolls?.reserved_kg || 0) / rollKg) * 100 : 0;
  const alertTypes = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of alertRows) map.set(a.type_display || sentence(a.type), (map.get(a.type_display || sentence(a.type)) || 0) + 1);
    return Array.from(map.entries()).map(([name, value]) => ({ name, value }));
  }, [alertRows]);

  return (
    <div className="mx-auto max-w-[1600px] space-y-4" data-testid="inventory-dashboard">
      <GateBillInboxLink />
      <PageHero
        eyebrow="Stock nexus"
        icon={<Warehouse />}
        title="Inventory Control Hub"
        description="What is on hand, where it sits, how old it is and what needs attention — across every plant."
        meta={
          <>
            <HeroChip tone={health.isError ? "bad" : "good"}>{health.isError ? "Health unavailable" : "Live · every 30s"}</HeroChip>
            {r.generated_at ? <HeroChip>Aging as of {relativeTime(r.generated_at)}</HeroChip> : null}
          </>
        }
        actions={
          <>
            <Link href="/analytics/inventory-health" className={heroButtonClass("ghost")}>
              <Stethoscope /> Health diagnostics
            </Link>
            <Link href="/inventory/grn" className={heroButtonClass("primary")}>
              <PackagePlus /> Create GRN
            </Link>
          </>
        }
      >
        <HeroStats columns={4}>
          <HeroStat label="Bulk stock" value={health.data ? kgCompact(h.bulk?.total_kg) : "—"} hint={health.data ? `${count(h.bulk?.sku_count)} SKUs · granules & chemicals` : "—"} />
          <HeroStat label="Rolls on hand" value={health.data ? kgCompact(rollKg) : "—"} hint={health.data ? `${count(Number(h.rolls?.available_count || 0) + Number(h.rolls?.reserved_count || 0))} rolls` : "—"} />
          <HeroStat label="Finished goods" tone="good" value={health.data ? kgCompact(h.rolls?.fg_kg) : "—"} hint={health.data ? `${count(h.rolls?.fg_count)} FG rolls` : "—"} />
          <HeroStat
            label="Open alerts"
            tone={Number(h.alerts?.critical) ? "bad" : Number(h.alerts?.total_open) ? "warn" : "good"}
            value={health.data ? count(h.alerts?.total_open) : "—"}
            hint={health.data ? `${count(h.alerts?.critical)} critical · ${count(h.alerts?.high)} high` : "—"}
          />
        </HeroStats>
      </PageHero>

      <StatGrid columns={4} className="erp-stagger">
        <StatCard label="Available rolls" icon={<Boxes />} value={Number(h.rolls?.available_kg || 0)} format={kgCompact} hint={`${count(h.rolls?.available_count)} rolls free to plan`} loading={loading} href="/inventory/rolls" />
        <StatCard label="Reserved rolls" icon={<Clock3 />} value={Number(h.rolls?.reserved_kg || 0)} format={kgCompact} hint={`${pct(reservedShare)} of roll stock held for orders`} loading={loading} href="/inventory/rolls" />
        <StatCard
          label="Aged stock (90d+)"
          icon={<AlertTriangle />}
          tone={Number(s.aged_stock_weight_kg) > 0 ? "warn" : "good"}
          value={s.aged_stock_weight_kg !== undefined ? Number(s.aged_stock_weight_kg) : null}
          format={kgCompact}
          hint={s.aged_stock_items !== undefined ? `${count(s.aged_stock_items)} items to review` : "from stock aging"}
          loading={!report.data && report.isFetching}
          href="/analytics/reports/inventory"
        />
        <StatCard
          label="Rated stock value"
          icon={<Factory />}
          value={s.estimated_value !== null && s.estimated_value !== undefined ? Number(s.estimated_value) : null}
          format={inrCompact}
          hint={s.valuation_rate_coverage_pct !== undefined ? `${pct(s.valuation_rate_coverage_pct)} of materials have a rate` : "valuation"}
          loading={!report.data && report.isFetching}
          href="/analytics/reports/inventory"
        />
      </StatGrid>

      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        <Panel icon={<Clock3 />} title="Stock aging" description="Roll weight by age band">
          {(r.aging || []).length ? (
            <CompositionBar parts={(r.aging || []).map((a: any) => ({ label: a.range, value: Number(a.weight_kg || 0) }))} valueFormat={kgCompact} />
          ) : (
            <PanelEmpty title={report.isFetching ? "Loading aging…" : "No aging data"} />
          )}
        </Panel>
        <Panel icon={<Boxes />} title="By stage" description="Where roll stock sits in the process">
          {(r.by_stage || []).length ? (
            <div className="grid items-center gap-4 sm:grid-cols-[150px_minmax(0,1fr)]">
              <Donut
                data={(r.by_stage || []).map((x: any) => ({ name: x.stage, value: Number(x.weight_kg || 0) }))}
                height={150}
                centerValue={kgCompact((r.by_stage || []).reduce((sum: number, x: any) => sum + Number(x.weight_kg || 0), 0))}
                valueFormat={kgCompact}
              />
              <ul className="space-y-2 text-[12.5px]">
                {(r.by_stage || []).map((x: any, i: number) => (
                  <li key={x.stage} className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2 text-content-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: vizColor(i) }} />
                      <span className="truncate">{sentence(x.stage)}</span>
                    </span>
                    <span className="tabular-nums">{kgCompact(x.weight_kg)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <PanelEmpty title="No stage data" />
          )}
        </Panel>
        <Panel icon={<AlertTriangle />} title="Alert mix" description={`${count(alertRows.length)} unresolved alerts by type`}>
          {alertTypes.length ? (
            <RankedBars items={alertTypes.map((t) => ({ key: t.name, label: t.name, value: t.value }))} valueFormat={count} colorByIndex />
          ) : (
            <PanelEmpty title="No open alerts" />
          )}
        </Panel>
        <Panel icon={<Boxes />} title="Largest stock families" description="Weight on hand · oldest item age">
          {(r.by_family || []).length ? (
            <RankedBars
              items={(r.by_family || []).map((f: any) => ({
                key: `${f.family}-${f.form_label}`,
                label: f.family,
                value: Number(f.weight_kg || 0),
                sub: `${count(f.count)} items · oldest ${count(f.oldest_age_days)} d${Number(f.reserved_kg) ? ` · ${kgCompact(f.reserved_kg)} reserved` : ""}`,
              }))}
              valueFormat={kgCompact}
              limit={6}
            />
          ) : (
            <PanelEmpty title="No stock families" />
          )}
        </Panel>
        <Panel icon={<MapPin />} title="By location" description="Top storage locations">
          {(r.by_location || []).length ? (
            <RankedBars items={(r.by_location || []).map((l: any) => ({ key: l.location, label: l.location, value: Number(l.weight_kg || 0), sub: `${count(l.count)} items` }))} valueFormat={kgCompact} limit={6} />
          ) : (
            <PanelEmpty title="No location data" />
          )}
        </Panel>
        <Panel icon={<Factory />} title="By plant" description="Roll stock per plant">
          {(r.by_plant || []).length ? (
            <RankedBars items={(r.by_plant || []).map((p: any) => ({ key: p.plant, label: p.plant, value: Number(p.weight_kg || 0) }))} valueFormat={kgCompact} limit={6} colorByIndex />
          ) : (
            <PanelEmpty title="No plant data" />
          )}
        </Panel>
      </div>

      <Panel
        icon={<AlertTriangle />}
        title="Critical action centre"
        description="Unresolved stock alerts, most severe first"
        actions={
          <Link href="/inventory/alerts" className="inline-flex items-center gap-1 text-[12.5px] font-medium text-primary hover:underline">
            All alerts <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        }
      >
        {alerts.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="erp-skeleton h-14 rounded-xl" />
            ))}
          </div>
        ) : alertRows.length ? (
          <ul className="grid gap-2 lg:grid-cols-2">
            {alertRows.slice(0, 10).map((a: any) => {
              const sev = String(a.severity || "").toUpperCase();
              return (
                <li key={a.id} className="flex items-start gap-3 rounded-xl border border-line bg-surface-1 px-3 py-2.5">
                  <span
                    className={cn(
                      "mt-0.5 shrink-0 rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold",
                      sev === "CRITICAL" ? "bg-danger-bg text-danger-fg" : sev === "HIGH" ? "bg-warning-bg text-warning-fg" : "bg-surface-2 text-content-3",
                    )}
                  >
                    {a.severity_display || sentence(sev)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] font-medium text-content-1">
                      {a.type_display || sentence(a.type)}
                      {a.material_code ? <span className="ml-1.5 font-mono text-[11.5px] text-content-3">{a.material_code}</span> : null}
                    </div>
                    <div className="mt-0.5 line-clamp-2 text-[12px] text-content-3">{a.message}</div>
                    <div className="mt-0.5 text-[11px] text-content-4">
                      {a.plant_name ? `${a.plant_name} · ` : ""}
                      {relativeTime(a.created_at)}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <PanelEmpty title="All clear">No unresolved stock alerts.</PanelEmpty>
        )}
      </Panel>
    </div>
  );
}
